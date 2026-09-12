/**
 * mktGuest.ts — Sprint 1: Guest RFQ View + Claim
 *
 * Mounted at: /api/mkt/guest
 *
 * Endpoints:
 *   GET  /rfqs/:token          — Guest melihat status RFQ-nya tanpa login
 *   POST /rfqs/:token/claim    — Buyer ter-autentikasi mengklaim guest RFQ ke akunnya
 *
 * Security:
 *   - GET: token di-hash sebelum lookup (HMAC-SHA256); tidak ada raw token di DB query
 *   - POST: wajib requirePortalAuth + validasi kepemilikan token + belum diklaim
 *   - Rate limited pada kedua endpoint
 *   - Activity log pada setiap operasi claim
 *   - Tidak ada field internal (commission, rank, vendor pricing) yang di-expose ke guest
 *
 * Rules:
 *   - Tidak pernah throw ke caller — semua error via typed JSON response
 *   - guest_claimed_at/guest_claimed_by di-set atomically di mkt_rfqs
 *   - mkt_rfq_guest_claims di-insert sebagai audit trail permanen
 *   - logActivity dipanggil di luar transaksi (non-fatal)
 */

import { Router, type Request, type Response } from "express";
import { ipKeyGenerator, rateLimit } from "express-rate-limit";
import { z } from "zod/v4";
import { requirePortalAuth, type PortalAuthReq } from "../lib/supabaseAuth.js";
import { hashToken } from "../lib/tokenUtils.js";
import { logActivity } from "../lib/activityLog.js";
import { logger } from "../lib/logger.js";

const router = Router();

// ── Rate limiters ─────────────────────────────────────────────────────────────

// Guest view: 30 req / 15 menit per token (bukan per IP, agar lebih granular)
const guestViewLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 30,
  standardHeaders: true,
  legacyHeaders: false,
  message: { ok: false, error: "RATE_LIMIT", message: "Terlalu banyak permintaan. Coba lagi dalam 15 menit." },
  keyGenerator: (req) => `mkt-guest-view:${String((req.params as { token?: string }).token ?? ipKeyGenerator(req.ip ?? "unknown"))}`,
});

// Guest claim: 5 req / jam per IP (sangat restriktif — operasi sekali jalan)
const guestClaimLimiter = rateLimit({
  windowMs: 60 * 60 * 1000,
  max: 5,
  standardHeaders: true,
  legacyHeaders: false,
  message: { ok: false, error: "RATE_LIMIT", message: "Terlalu banyak percobaan claim. Coba lagi dalam 1 jam." },
  keyGenerator: (req) => `mkt-guest-claim:${ipKeyGenerator(req.ip ?? "unknown")}`,
});

// ── Zod schemas ───────────────────────────────────────────────────────────────

const TokenParamSchema = z.object({
  token: z.string().min(10).max(512),
});

// ── Helpers ───────────────────────────────────────────────────────────────────

/**
 * Validasi token param. Returns token string atau null jika invalid.
 * Menggunakan Zod safeParse agar tidak throw.
 */
function parseToken(raw: unknown): string | null {
  const result = TokenParamSchema.safeParse({ token: raw });
  return result.success ? result.data.token : null;
}

// ── GET /api/mkt/guest/rfqs/:token ───────────────────────────────────────────
// Guest melihat status RFQ-nya menggunakan token yang diterima saat submit.
// Response hanya berisi field buyer-safe — tidak ada vendor pricing, commission, dll.
router.get("/rfqs/:token", guestViewLimiter, async (req: Request, res: Response) => {
  const token = parseToken(req.params["token"]);
  if (!token) {
    return res.status(400).json({ ok: false, error: "Token tidak valid." });
  }

  const tokenHash = hashToken(token);

  try {
    const { db } = await import("@workspace/db");
    const { sql } = await import("drizzle-orm");

    // Lookup by hash — timing-safe (hash comparison, not raw token)
    const { rows } = await db.execute(sql`
      SELECT
        id,
        rfq_number       AS "rfqNumber",
        status,
        buyer_name       AS "buyerName",
        buyer_email      AS "buyerEmail",
        buyer_company    AS "buyerCompany",
        notes,
        required_delivery_date AS "requiredDeliveryDate",
        delivery_address AS "deliveryAddress",
        destination_place_id AS "destinationPlaceId",
        destination_lat AS "destinationLat",
        destination_lng AS "destinationLng",
        line_count       AS "lineCount",
        quote_count      AS "quoteCount",
        approval_status  AS "approvalStatus",
        email_verified   AS "emailVerified",
        guest_token_expires_at AS "guestTokenExpiresAt",
        guest_claimed_at       AS "guestClaimedAt",
        created_at       AS "createdAt",
        updated_at       AS "updatedAt"
      FROM mkt_rfqs
      WHERE guest_token_hash = ${tokenHash}
        AND guest_token_expires_at > NOW()
      LIMIT 1
    `) as { rows: Record<string, unknown>[] };

    const rfq = rows[0];
    if (!rfq) {
      return res.status(404).json({
        ok: false,
        error: "RFQ tidak ditemukan. Token mungkin tidak valid atau sudah kadaluarsa.",
      });
    }

    // Ambil lines — buyer perlu lihat apa yang di-request
    const { rows: lineRows } = await db.execute(sql`
      SELECT
        id,
        item_name        AS "itemName",
        item_description AS "itemDescription",
        item_unit        AS "itemUnit",
        requested_qty    AS "requestedQty",
        notes,
        sort_order       AS "sortOrder"
      FROM mkt_rfq_lines
      WHERE rfq_id = ${rfq["id"]}
      ORDER BY sort_order ASC, id ASC
    `) as { rows: Record<string, unknown>[] };

    return res.json({
      ok: true,
      data: {
        ...rfq,
        isClaimed: !!rfq["guestClaimedAt"],
        lines: lineRows,
      },
    });
  } catch (err: unknown) {
    logger.error({ err }, "[mktGuest] getRfqByToken error");
    return res.status(500).json({ ok: false, error: "Gagal memuat RFQ." });
  }
});

// ── POST /api/mkt/guest/rfqs/:token/claim ────────────────────────────────────
// Buyer yang sudah login mengklaim guest RFQ ke dalam akunnya.
// Setelah claim: mkt_rfqs.portal_customer_id di-set, guest_claimed_at/by di-set,
// mkt_rfq_guest_claims row di-insert sebagai audit trail.
// Idempotent jika buyer yang sama sudah mengklaim RFQ ini sebelumnya.
router.post("/rfqs/:token/claim", guestClaimLimiter, requirePortalAuth, async (req: Request, res: Response) => {
  const portalCustomerId = (req as PortalAuthReq).portalCustomerId;
  const token = parseToken(req.params["token"]);
  if (!token) {
    return res.status(400).json({ ok: false, error: "Token tidak valid." });
  }

  const tokenHash = hashToken(token);

  try {
    const { db, mktRfqGuestClaimsTable } = await import("@workspace/db");
    const { sql, eq, and } = await import("drizzle-orm");

    // 1. Lookup RFQ by hash — include portal_customer_id untuk idempotency check
    const { rows } = await db.execute(sql`
      SELECT
        id,
        rfq_number          AS "rfqNumber",
        guest_email         AS "guestEmail",
        status,
        guest_token_expires_at AS "guestTokenExpiresAt",
        guest_claimed_at    AS "guestClaimedAt",
        guest_claimed_by    AS "guestClaimedBy",
        portal_customer_id  AS "portalCustomerId"
      FROM mkt_rfqs
      WHERE guest_token_hash = ${tokenHash}
      LIMIT 1
    `) as { rows: Record<string, unknown>[] };

    const rfq = rows[0];

    // 2. RFQ tidak ditemukan
    if (!rfq) {
      return res.status(404).json({ ok: false, error: "RFQ_NOT_FOUND", message: "Token tidak valid atau RFQ tidak ditemukan." });
    }

    const rfqId = rfq["id"] as number;
    const rfqNumber = rfq["rfqNumber"] as string;

    // 3. Token kadaluarsa
    if (rfq["guestTokenExpiresAt"] && new Date(rfq["guestTokenExpiresAt"] as string) < new Date()) {
      return res.status(410).json({ ok: false, error: "TOKEN_EXPIRED", message: "Token sudah kadaluarsa. Hubungi admin untuk bantuan." });
    }

    // 4. Idempotency: buyer yang sama sudah claim → kembalikan sukses
    if (rfq["portalCustomerId"] === portalCustomerId) {
      return res.json({
        ok: true,
        alreadyClaimed: true,
        rfqId,
        rfqNumber,
        message: "RFQ sudah terhubung ke akun Anda.",
      });
    }

    // 5. Sudah diklaim oleh orang lain → forbidden
    if (rfq["guestClaimedAt"] && rfq["portalCustomerId"] && rfq["portalCustomerId"] !== portalCustomerId) {
      return res.status(409).json({ ok: false, error: "ALREADY_CLAIMED", message: "RFQ ini sudah diklaim oleh akun lain." });
    }

    const claimedAt = new Date();
    const claimedByStr = String(portalCustomerId);

    // 6. Ambil email buyer dari portal_customers untuk audit trail
    const { rows: custRows } = await db.execute(sql`
      SELECT email FROM portal_customers WHERE id = ${portalCustomerId} LIMIT 1
    `) as { rows: { email: string }[] };
    const buyerEmail = custRows[0]?.email ?? null;

    // 7. Update mkt_rfqs + insert mkt_rfq_guest_claims dalam satu transaksi
    await db.transaction(async (tx) => {
      // 7a. Link RFQ ke buyer
      await tx.execute(sql`
        UPDATE mkt_rfqs
        SET
          portal_customer_id = ${portalCustomerId},
          guest_claimed_at   = ${claimedAt.toISOString()},
          guest_claimed_by   = ${claimedByStr},
          updated_at         = NOW()
        WHERE id = ${rfqId}
          AND (portal_customer_id IS NULL OR portal_customer_id = ${portalCustomerId})
      `);

      // 7b. Insert audit trail ke mkt_rfq_guest_claims
      await tx.insert(mktRfqGuestClaimsTable).values({
        rfqId,
        guestEmail: (rfq["guestEmail"] as string) ?? buyerEmail ?? "",
        guestToken: token,           // store raw token dalam claims table (encrypted at rest di Supabase)
        claimedByUserId: claimedByStr,
        claimStatus: "claimed",
        claimedAt,
        expiresAt: rfq["guestTokenExpiresAt"] ? new Date(rfq["guestTokenExpiresAt"] as string) : new Date(claimedAt.getTime() + 7 * 24 * 60 * 60 * 1000),
      });
    });

    // 8. Activity log — fire-and-forget, non-fatal
    logActivity({
      mktRfqId:  rfqId,
      actorType: "customer",
      actorId:   claimedByStr,
      actorName: buyerEmail ?? claimedByStr,
      action:    "mkt_guest_rfq_claimed",
      description: `Guest RFQ ${rfqNumber} diklaim oleh buyer (portalCustomerId=${portalCustomerId})`,
      newValue:  {
        rfqId,
        rfqNumber,
        portalCustomerId,
        claimedAt: claimedAt.toISOString(),
      },
      ipAddress: req.ip ?? null,
    }).catch((err) => logger.warn({ err, rfqId }, "[mktGuest] logActivity claim failed (non-fatal)"));

    return res.json({
      ok: true,
      alreadyClaimed: false,
      rfqId,
      rfqNumber,
      message: "RFQ berhasil diklaim. Anda sekarang dapat memantau status di dashboard Anda.",
    });

  } catch (err: unknown) {
    logger.error({ err, portalCustomerId }, "[mktGuest] claimGuestRfq error");
    return res.status(500).json({ ok: false, error: "Gagal mengklaim RFQ." });
  }
});

export default router;
