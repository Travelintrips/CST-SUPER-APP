/**
 * vendorInvitationService.ts — Phase 2C: Vendor Invitation
 *
 * Service untuk mengundang vendor ke RFQ via mkt_vendor_quotes.
 *
 * Design contract:
 * - Setiap invite menghasilkan satu row di mkt_vendor_quotes (status: 'invited').
 * - Token akses vendor: crypto.randomBytes(32).toString("hex") — 64-char hex, URL-safe.
 * - validUntil: 30 hari dari waktu invite.
 * - Duplicate guard: vendor yang sama pada RFQ yang sama → tolak 409.
 * - quoteCount di mkt_rfqs di-increment atomically dalam satu transaksi.
 * - Activity log: mkt_vendor_invited — fire-and-forget, non-fatal.
 * - WA notification payload: disiapkan tapi TIDAK dikirim (Phase 2D).
 *
 * Tidak throw ke caller — semua error dikembalikan sebagai typed error result.
 */

import { randomBytes } from "crypto";
import { db, mktVendorQuotesTable, mktRfqsTable, suppliersTable } from "@workspace/db";
import { eq, and, sql } from "drizzle-orm";
import { logActivity } from "../activityLog.js";
import { logger } from "../logger.js";
import { enqueueNotification } from "./marketplaceNotificationQueueService.js";
import { createOrderLink } from "./orderLinkService.js";

// ── Vendor deep link builder ──────────────────────────────────────────────────
// Builds a URL for the vendor to access their quote form directly.
// Uses PORTAL_BASE_URL env var in production, REPLIT_DEV_DOMAIN in dev.
function buildVendorDeepLink(token: string): string | null {
  const base =
    process.env["PORTAL_BASE_URL"] ??
    (process.env["REPLIT_DEV_DOMAIN"]
      ? `https://${process.env["REPLIT_DEV_DOMAIN"]}`
      : null);
  if (!base) return null;
  return `${base}/vendor/quote/${token}`;
}

// ── Token generator ───────────────────────────────────────────────────────────
// 32 random bytes → 64-char hex string, URL-safe, cryptographically secure.

function generateVendorToken(): string {
  return randomBytes(32).toString("hex");
}

// ── validUntil default — 30 hari dari sekarang ───────────────────────────────

function defaultValidUntil(): Date {
  const d = new Date();
  d.setDate(d.getDate() + 30);
  return d;
}

// ── Types ─────────────────────────────────────────────────────────────────────

export interface InviteVendorOptions {
  rfqId: number;
  vendorId: number;
  adminId?: string | null;
  adminName?: string | null;
  ipAddress?: string | null;
}

export interface InviteVendorResult {
  ok: true;
  quoteId: number;
  token: string;
  rfqNumber: string;
  vendorName: string;
  status: "invited";
  validUntil: Date;
  /** Payload siap kirim — Phase 2D akan consume ini untuk WA/email. */
  notificationPayload: VendorInviteNotificationPayload;
}

/** Prepared but NOT sent — Phase 2D akan kirim via WA/email. */
export interface VendorInviteNotificationPayload {
  vendorPhone: string | null;
  vendorEmail: string | null;
  vendorName: string;
  rfqId: number;
  rfqNumber: string;
  rfqBuyerName: string;
  rfqBuyerCompany: string | null;
  rfqNotes: string | null;
  quoteId: number;
  token: string;
  validUntil: string; // ISO 8601
  /** TODO Phase 2D: build vendor portal URL dari REPLIT_DEV_DOMAIN / custom domain. */
  deepLinkUrl: string | null;
}

export type InviteVendorErrorCode =
  | "RFQ_NOT_FOUND"
  | "VENDOR_NOT_FOUND"
  | "VENDOR_INACTIVE"
  | "DUPLICATE_INVITE"
  | "DB_ERROR";

export type InviteVendorError =
  | { ok: false; code: "RFQ_NOT_FOUND";    message: string }
  | { ok: false; code: "VENDOR_NOT_FOUND"; message: string }
  | { ok: false; code: "VENDOR_INACTIVE";  message: string }
  | { ok: false; code: "DUPLICATE_INVITE"; message: string; existingQuoteId: number; existingStatus: string }
  | { ok: false; code: "DB_ERROR";         message: string };

// ── Core: invite vendor ke RFQ ────────────────────────────────────────────────

/**
 * inviteVendorToRfq — creates one mkt_vendor_quotes row dalam satu transaksi,
 * increment mkt_rfqs.quote_count, logs activity, prepares WA payload.
 *
 * Returns InviteVendorResult on success, InviteVendorError on any failure.
 * Never throws.
 */
export async function inviteVendorToRfq(
  opts: InviteVendorOptions,
): Promise<InviteVendorResult | InviteVendorError> {
  const { rfqId, vendorId } = opts;

  // ── 1. Validasi RFQ ───────────────────────────────────────────────────────
  let rfq: {
    id: number;
    rfqNumber: string;
    status: string;
    buyerName: string;
    buyerCompany: string | null;
    notes: string | null;
  };

  try {
    const rows = await db
      .select({
        id:          mktRfqsTable.id,
        rfqNumber:   mktRfqsTable.rfqNumber,
        status:      mktRfqsTable.status,
        buyerName:   mktRfqsTable.buyerName,
        buyerCompany: mktRfqsTable.buyerCompany,
        notes:       mktRfqsTable.notes,
      })
      .from(mktRfqsTable)
      .where(eq(mktRfqsTable.id, rfqId))
      .limit(1);

    if (!rows.length) {
      return { ok: false, code: "RFQ_NOT_FOUND", message: `RFQ id=${rfqId} tidak ditemukan` };
    }
    rfq = rows[0]!;
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    logger.warn({ err, rfqId }, "[vendorInvitation] DB error saat lookup RFQ");
    return { ok: false, code: "DB_ERROR", message: msg };
  }

  // ── 2. Validasi vendor ────────────────────────────────────────────────────
  let vendor: {
    id: number;
    name: string;
    phone: string | null;
    contactEmail: string | null;
    isActive: boolean;
  };

  try {
    const rows = await db
      .select({
        id:           suppliersTable.id,
        name:         suppliersTable.name,
        phone:        suppliersTable.phone,
        contactEmail: suppliersTable.contactEmail,
        isActive:     suppliersTable.isActive,
      })
      .from(suppliersTable)
      .where(eq(suppliersTable.id, vendorId))
      .limit(1);

    if (!rows.length) {
      return { ok: false, code: "VENDOR_NOT_FOUND", message: `Vendor id=${vendorId} tidak ditemukan` };
    }
    vendor = rows[0]!;
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    logger.warn({ err, vendorId }, "[vendorInvitation] DB error saat lookup vendor");
    return { ok: false, code: "DB_ERROR", message: msg };
  }

  if (!vendor.isActive) {
    return {
      ok: false,
      code: "VENDOR_INACTIVE",
      message: `Vendor "${vendor.name}" (id=${vendorId}) tidak aktif — aktifkan vendor terlebih dahulu`,
    };
  }

  // ── 3. Duplicate guard ────────────────────────────────────────────────────
  try {
    const existing = await db
      .select({
        id:     mktVendorQuotesTable.id,
        status: mktVendorQuotesTable.status,
      })
      .from(mktVendorQuotesTable)
      .where(
        and(
          eq(mktVendorQuotesTable.rfqId, rfqId),
          eq(mktVendorQuotesTable.vendorId, vendorId),
        ),
      )
      .limit(1);

    if (existing.length) {
      const ex = existing[0]!;
      return {
        ok: false,
        code: "DUPLICATE_INVITE",
        message: `Vendor "${vendor.name}" sudah diundang ke RFQ ${rfq.rfqNumber} (quote_id=${ex.id}, status=${ex.status})`,
        existingQuoteId: ex.id,
        existingStatus: ex.status,
      };
    }
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    logger.warn({ err, rfqId, vendorId }, "[vendorInvitation] DB error saat duplicate check");
    return { ok: false, code: "DB_ERROR", message: msg };
  }

  // ── 4. Insert quote + increment quoteCount (satu transaksi) ──────────────
  // Unique constraint mkt_vendor_quotes_rfq_vendor_unique(rfq_id, vendor_id)
  // menjadi final race guard — jika dua request concurrent lolos SELECT check,
  // hanya satu yang berhasil INSERT; yang lain mendapat error 23505 (unique violation)
  // yang di-catch dan di-convert ke DUPLICATE_INVITE.
  const token = generateVendorToken();
  const validUntil = defaultValidUntil();
  let quoteId: number;

  try {
    await db.transaction(async (tx) => {
      const [quote] = await tx
        .insert(mktVendorQuotesTable)
        .values({
          rfqId,
          vendorId,
          token,
          status: "invited",
          validUntil,
        })
        .returning({ id: mktVendorQuotesTable.id });

      quoteId = quote!.id;

      // Increment quoteCount atomically
      await tx
        .update(mktRfqsTable)
        .set({
          quoteCount: sql`${mktRfqsTable.quoteCount} + 1`,
          updatedAt: new Date(),
        })
        .where(eq(mktRfqsTable.id, rfqId));
    });
  } catch (err: unknown) {
    // Unique constraint violation (23505) → concurrent duplicate invite
    const pgCode = (err as { code?: string }).code;
    if (pgCode === "23505") {
      // Lookup existing quote untuk berikan existingQuoteId yang akurat
      const dup = await db
        .select({ id: mktVendorQuotesTable.id, status: mktVendorQuotesTable.status })
        .from(mktVendorQuotesTable)
        .where(and(eq(mktVendorQuotesTable.rfqId, rfqId), eq(mktVendorQuotesTable.vendorId, vendorId)))
        .limit(1)
        .catch(() => [] as { id: number; status: string }[]);
      const ex = dup[0];
      return {
        ok: false,
        code: "DUPLICATE_INVITE" as const,
        message: `Vendor "${vendor.name}" sudah diundang ke RFQ ${rfq.rfqNumber}${ex ? ` (quote_id=${ex.id}, status=${ex.status})` : ""}`,
        existingQuoteId: ex?.id ?? 0,
        existingStatus: ex?.status ?? "invited",
      };
    }
    const msg = err instanceof Error ? err.message : String(err);
    logger.warn({ err, rfqId, vendorId }, "[vendorInvitation] DB error saat insert quote");
    return { ok: false, code: "DB_ERROR", message: msg };
  }

  // ── Phase 3D: order_links — rfq → vendor_quote (fire-and-forget, non-fatal) ──
  void createOrderLink({
    sourceTable: "mkt_rfqs",
    sourceId: rfqId,
    targetTable: "mkt_vendor_quotes",
    targetId: quoteId!,
    linkType: "rfq_to_vendor_quote",
    createdBy: opts.adminId ?? null,
  }).catch(() => {}); // non-fatal — must NOT block or throw to caller

  // ── 5. Activity log — fire-and-forget ────────────────────────────────────
  logActivity({
    mktRfqId:        rfqId,
    mktVendorQuoteId: quoteId!,
    actorType:       "admin",
    actorId:         opts.adminId ?? null,
    actorName:       opts.adminName ?? null,
    action:          "mkt_vendor_invited",
    description:     `Vendor "${vendor.name}" diundang ke RFQ ${rfq.rfqNumber} (quote_id=${quoteId!}, valid 30 hari)`,
    newValue: {
      rfqId,
      rfqNumber:   rfq.rfqNumber,
      rfqStatus:   rfq.status,
      vendorId,
      vendorName:  vendor.name,
      quoteId:     quoteId!,
      status:      "invited",
      validUntil:  validUntil.toISOString(),
      // token disimpan di log hanya untuk internal audit trail — jangan expose ke API response
      tokenPreview: token.slice(0, 8) + "…",
    },
    ipAddress: opts.ipAddress ?? null,
  }).catch(() => {}); // non-fatal

  logger.info(
    { rfqId, rfqNumber: rfq.rfqNumber, vendorId, vendorName: vendor.name, quoteId: quoteId! },
    "[vendorInvitation] Vendor berhasil diundang",
  );

  // ── 6. Enqueue WA notification ke vendor (Phase 2E.1) ────────────────────
  const notificationPayload: VendorInviteNotificationPayload = {
    vendorPhone:     vendor.phone ?? null,
    vendorEmail:     vendor.contactEmail ?? null,
    vendorName:      vendor.name,
    rfqId,
    rfqNumber:       rfq.rfqNumber,
    rfqBuyerName:    rfq.buyerName,
    rfqBuyerCompany: rfq.buyerCompany ?? null,
    rfqNotes:        rfq.notes ?? null,
    quoteId:         quoteId!,
    token,
    validUntil:      validUntil.toISOString(),
    deepLinkUrl:     buildVendorDeepLink(token),
  };

  // Enqueue ke mkt_notification_queue — worker mengirim asinkron dengan retry
  void enqueueNotification({
    eventType:      "mkt_vendor_invitation_notification",
    recipientType:  "vendor",
    recipientId:    vendorId,
    recipientPhone: vendor.phone ?? null,
    rfqId,
    vendorQuoteId:  quoteId!,
    payloadJson:    notificationPayload as unknown as Record<string, unknown>,
  }).catch(() => {}); // enqueue sendiri non-fatal

  return {
    ok: true,
    quoteId: quoteId!,
    token,
    rfqNumber: rfq.rfqNumber,
    vendorName: vendor.name,
    status: "invited",
    validUntil,
    notificationPayload,
  };
}

// ── Read: list vendor quotes untuk satu RFQ ───────────────────────────────────

export interface VendorQuoteListRow {
  id:           number;
  rfqId:        number;
  vendorId:     number;
  vendorName:   string;
  vendorPhone:  string | null;
  vendorEmail:  string | null;
  status:       string;
  validUntil:   Date | null;
  submittedAt:  Date | null;
  openedAt:     Date | null;
  createdAt:    Date;
  updatedAt:    Date;
  // token intentionally omitted from list — hanya untuk internal audit
}

/**
 * getVendorQuotesForRfq — fetch semua vendor quotes untuk satu RFQ,
 * join dengan suppliers untuk nama/kontak vendor.
 * Token TIDAK disertakan dalam response list.
 */
export async function getVendorQuotesForRfq(rfqId: number): Promise<VendorQuoteListRow[]> {
  const rows = await db
    .select({
      id:          mktVendorQuotesTable.id,
      rfqId:       mktVendorQuotesTable.rfqId,
      vendorId:    mktVendorQuotesTable.vendorId,
      vendorName:  suppliersTable.name,
      vendorPhone: suppliersTable.phone,
      vendorEmail: suppliersTable.contactEmail,
      status:      mktVendorQuotesTable.status,
      validUntil:  mktVendorQuotesTable.validUntil,
      submittedAt: mktVendorQuotesTable.submittedAt,
      openedAt:    mktVendorQuotesTable.openedAt,
      createdAt:   mktVendorQuotesTable.createdAt,
      updatedAt:   mktVendorQuotesTable.updatedAt,
    })
    .from(mktVendorQuotesTable)
    .innerJoin(suppliersTable, eq(mktVendorQuotesTable.vendorId, suppliersTable.id))
    .where(eq(mktVendorQuotesTable.rfqId, rfqId))
    .orderBy(mktVendorQuotesTable.createdAt);

  return rows;
}
