/**
 * requoteService.ts — Phase 2F: Requote Flow
 *
 * Memungkinkan admin meminta vendor untuk merevisi quotation mereka.
 *
 * Flow:
 *   Admin menilai quote vendor tidak memuaskan
 *     → POST /api/mkt/admin/rfqs/:rfqId/quotes/:quoteId/request-requote
 *     → mkt_vendor_quotes.status → 'requote_requested'
 *     → mkt_vendor_quotes.requote_notes = notes dari admin
 *     → mkt_vendor_quotes.requote_deadline = deadline (opsional)
 *     → mkt_rfqs.status → 'quoting' (jika belum)
 *     → Activity log
 *
 *   Vendor melihat notifikasi requote di portal mereka (via token)
 *     → GET /api/vendor-quote/:token → status 'requote_requested' + requote_notes
 *     → Vendor edit dan submit ulang
 *
 *   Vendor submit ulang
 *     → POST /api/vendor-quote/:token/submit
 *     → mkt_vendor_quotes.status → 'submitted'
 *     → mkt_vendor_quotes.requote_round += 1
 *
 * Semua fungsi menggunakan typed result union — tidak pernah throw ke caller.
 */

import { db, mktVendorQuotesTable, mktRfqsTable, suppliersTable } from "@workspace/db";
import { eq, and } from "drizzle-orm";
import { logActivity } from "../activityLog.js";
import { logger } from "../logger.js";
import { enqueueNotification } from "./marketplaceNotificationQueueService.js";

// ── Types ─────────────────────────────────────────────────────────────────────

export type RequoteErrorCode =
  | "RFQ_NOT_FOUND"
  | "QUOTE_NOT_FOUND"
  | "WRONG_STATUS"
  | "DB_ERROR";

export type RequoteError = { ok: false; code: RequoteErrorCode; message: string };

export interface RequestRequoteOptions {
  rfqId: number;
  quoteId: number;
  adminId: string;
  adminName: string;
  notes: string;
  deadline?: Date | null;
}

// ── Core: admin request vendor requote ────────────────────────────────────────

/**
 * requestRequote — Admin meminta vendor untuk merevisi quotation.
 *
 * Precondition: quote.status = 'submitted' (hanya quote yang sudah final bisa diminta requote)
 * Postcondition:
 *   - mkt_vendor_quotes.status → 'requote_requested'
 *   - mkt_vendor_quotes.requote_notes = opts.notes
 *   - mkt_vendor_quotes.requote_deadline = opts.deadline (nullable)
 *   - mkt_rfqs.status → 'quoting' jika sebelumnya 'quoted'
 *     (requote berarti admin belum siap pilih vendor → kembali ke fase quoting)
 */
export async function requestRequote(
  opts: RequestRequoteOptions,
): Promise<{ ok: true; quoteId: number; rfqNumber: string; vendorName: string } | RequoteError> {
  const { rfqId, quoteId, adminId, adminName, notes, deadline } = opts;

  if (!notes?.trim()) {
    return { ok: false, code: "WRONG_STATUS", message: "Alasan requote wajib diisi" };
  }

  // ── 1. Validasi RFQ ───────────────────────────────────────────────────────
  let rfq: { id: number; rfqNumber: string; status: string };
  try {
    const rows = await db.select({
      id:        mktRfqsTable.id,
      rfqNumber: mktRfqsTable.rfqNumber,
      status:    mktRfqsTable.status,
    }).from(mktRfqsTable).where(eq(mktRfqsTable.id, rfqId)).limit(1);

    if (!rows.length) return { ok: false, code: "RFQ_NOT_FOUND", message: `RFQ id=${rfqId} tidak ditemukan` };
    rfq = rows[0]!;
  } catch (err) {
    return { ok: false, code: "DB_ERROR", message: err instanceof Error ? err.message : String(err) };
  }

  // ── 2. Validasi quote ─────────────────────────────────────────────────────
  let quote: { id: number; rfqId: number; status: string; vendorId: number; requoteRound: number };
  let vendorName = "Unknown Vendor";

  try {
    const rows = await db.select({
      id:           mktVendorQuotesTable.id,
      rfqId:        mktVendorQuotesTable.rfqId,
      status:       mktVendorQuotesTable.status,
      vendorId:     mktVendorQuotesTable.vendorId,
      requoteRound: mktVendorQuotesTable.requoteRound,
      vendorName:   suppliersTable.name,
    })
    .from(mktVendorQuotesTable)
    .leftJoin(suppliersTable, eq(mktVendorQuotesTable.vendorId, suppliersTable.id))
    .where(and(
      eq(mktVendorQuotesTable.id, quoteId),
      eq(mktVendorQuotesTable.rfqId, rfqId),
    ))
    .limit(1);

    if (!rows.length) {
      return {
        ok: false,
        code: "QUOTE_NOT_FOUND",
        message: `Quote id=${quoteId} tidak ditemukan untuk RFQ id=${rfqId}`,
      };
    }
    const row = rows[0]!;
    quote = {
      id:           row.id,
      rfqId:        row.rfqId,
      status:       row.status,
      vendorId:     row.vendorId,
      requoteRound: row.requoteRound ?? 1,
    };
    vendorName = row.vendorName ?? "Unknown Vendor";
  } catch (err) {
    return { ok: false, code: "DB_ERROR", message: err instanceof Error ? err.message : String(err) };
  }

  // Hanya bisa requote dari status 'submitted'
  if (quote.status !== "submitted") {
    return {
      ok: false,
      code: "WRONG_STATUS",
      message: `Quote harus dalam status 'submitted' untuk diminta requote (current: ${quote.status})`,
    };
  }

  // ── 3. Transisi status dalam satu transaksi ───────────────────────────────
  try {
    await db.transaction(async (tx) => {
      // Update quote → requote_requested
      await tx.update(mktVendorQuotesTable)
        .set({
          status:         "requote_requested" as any, // enum value baru — Drizzle type akan sync setelah build
          requoteNotes:   notes.trim(),
          requoteDeadline: deadline ?? null,
          updatedAt:      new Date(),
        })
        .where(eq(mktVendorQuotesTable.id, quoteId));

      // Jika RFQ sudah masuk 'quoted', kembalikan ke 'quoting'
      // (requote berarti belum semua quote final — perlu review ulang)
      if (rfq.status === "quoted") {
        await tx.update(mktRfqsTable)
          .set({ status: "quoting", updatedAt: new Date() })
          .where(eq(mktRfqsTable.id, rfqId));
      }
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    logger.warn({ err, rfqId, quoteId }, "[requote] DB error saat request-requote");
    return { ok: false, code: "DB_ERROR", message: msg };
  }

  // ── 4. Activity log — fire-and-forget ─────────────────────────────────────
  logActivity({
    mktRfqId:         rfqId,
    mktVendorQuoteId: quoteId,
    actorType:        "admin",
    actorId:          adminId,
    actorName:        adminName,
    action:           "mkt_requote_requested",
    description:      `Requote diminta dari vendor "${vendorName}" (quote_id=${quoteId}) — alasan: ${notes.trim()}`,
    newValue: {
      rfqId,
      rfqNumber:   rfq.rfqNumber,
      quoteId,
      vendorName,
      requoteNotes:   notes.trim(),
      requoteDeadline: deadline?.toISOString() ?? null,
      currentRound:   quote.requoteRound,
      nextRound:      quote.requoteRound + 1, // akan di-increment saat vendor submit
    },
  }).catch(() => {});

  // Enqueue notifikasi ke vendor — fire-and-forget
  enqueueNotification({
    eventType:     "mkt_requote_requested",
    recipientType: "vendor",
    vendorQuoteId: quoteId,
    rfqId,
    payloadJson: {
      rfqNumber:       rfq.rfqNumber,
      vendorName,
      vendorId:        quote.vendorId,
      requoteNotes:    notes.trim(),
      requoteDeadline: deadline?.toISOString() ?? null,
      currentRound:    quote.requoteRound,
      nextRound:       quote.requoteRound + 1,
    },
  }).catch(() => {});

  logger.info(
    { rfqId, rfqNumber: rfq.rfqNumber, quoteId, vendorName, adminId },
    "[requote] Requote requested",
  );

  return { ok: true, quoteId, rfqNumber: rfq.rfqNumber, vendorName };
}

// ── Read: get requote status untuk suatu quote ────────────────────────────────

/**
 * getRequoteStatus — Ambil info requote dari satu vendor quote.
 * Berguna untuk frontend admin menampilkan status requote.
 */
export async function getRequoteStatus(
  rfqId: number,
  quoteId: number,
): Promise<{
  ok: true;
  status: string;
  requoteNotes: string | null;
  requoteDeadline: Date | null;
  requoteRound: number;
} | RequoteError> {
  try {
    const [row] = await db.select({
      status:          mktVendorQuotesTable.status,
      requoteNotes:    mktVendorQuotesTable.requoteNotes,
      requoteDeadline: mktVendorQuotesTable.requoteDeadline,
      requoteRound:    mktVendorQuotesTable.requoteRound,
    })
    .from(mktVendorQuotesTable)
    .where(and(
      eq(mktVendorQuotesTable.id, quoteId),
      eq(mktVendorQuotesTable.rfqId, rfqId),
    ))
    .limit(1);

    if (!row) return { ok: false, code: "QUOTE_NOT_FOUND", message: `Quote id=${quoteId} tidak ditemukan` };

    return {
      ok: true,
      status:          row.status,
      requoteNotes:    row.requoteNotes,
      requoteDeadline: row.requoteDeadline,
      requoteRound:    row.requoteRound ?? 1,
    };
  } catch (err) {
    return { ok: false, code: "DB_ERROR", message: err instanceof Error ? err.message : String(err) };
  }
}
