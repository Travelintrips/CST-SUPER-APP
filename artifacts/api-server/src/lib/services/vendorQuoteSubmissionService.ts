/**
 * vendorQuoteSubmissionService.ts — Phase 2D: Vendor Quote Submission Engine
 *
 * Handles the complete vendor-side lifecycle after invitation:
 *   invited → opened → draft (unlimited saves) → submitted
 *
 * Token contract:
 *   - 64-char hex random opaque token (randomBytes(32))
 *   - Stored plaintext in mkt_vendor_quotes.token (indexed UNIQUE)
 *   - Lookup via SELECT WHERE token = $1 (safe for random tokens — not HMAC)
 *   - Expiry checked against mkt_vendor_quotes.valid_until
 *
 * Security:
 *   - Internal fields NEVER returned: commission_*, rank_*, net_vendor_amount
 *   - Buyer fields NEVER returned: target_price_per_unit
 *   - Submit is transactional + atomic (UPDATE WHERE status != 'submitted' RETURNING id)
 *   - Double-submit returns typed ALREADY_SUBMITTED error (caller returns 409)
 *
 * All functions return typed result union — never throw to caller.
 */

import { timingSafeEqual } from "crypto";
import { randomUUID } from "crypto";
import { eq, and, inArray } from "drizzle-orm";
import {
  db,
  mktVendorQuotesTable,
  mktVendorQuoteLinesTable,
  mktRfqsTable,
  mktRfqLinesTable,
  suppliersTable,
} from "@workspace/db";
import { logActivity } from "../activityLog.js";
import { logger } from "../logger.js";
import { ObjectStorageService } from "../objectStorage.js";

// ── Constants ─────────────────────────────────────────────────────────────────

/** ISO 4217 currencies supported. Add more here without changing validation logic. */
export const ALLOWED_CURRENCIES = new Set([
  "IDR", "USD", "SGD", "EUR", "JPY", "CNY",
  "GBP", "AUD", "HKD", "MYR", "THB", "PHP",
  "KRW", "TWD", "INR", "AED", "SAR",
]);

/** Status yang boleh menerima save/submit dari vendor (termasuk requote_requested untuk resubmit) */
const ACTIVE_STATUSES = new Set(["invited", "opened", "requote_requested"]);

// ── Types: Load ───────────────────────────────────────────────────────────────

/** Semua field yang dikembalikan ke vendor — internal fields dibuang */
export interface VendorQuoteView {
  quote: {
    id: number;
    rfqId: number;
    vendorId: number;
    status: string;
    validUntil: Date | null;       // expiry invite
    openedAt: Date | null;
    submittedAt: Date | null;
    // Header quotation dari vendor
    quotationNumber: string | null;
    quotationDate: string | null;  // DATE string YYYY-MM-DD
    paymentTerms: string | null;
    incoterm: string | null;
    deliveryLocation: string | null;
    notes: string | null;          // grand_notes
    attachmentUrl: string | null;
    // Phase 2F: requote info dari admin — hanya terisi saat status = 'requote_requested'
    requoteNotes: string | null;
    requoteDeadline: Date | null;
    requoteRound: number;
  };
  vendor: {
    id: number;
    name: string;
    phone: string | null;
    email: string | null;
  };
  rfq: {
    id: number;
    rfqNumber: string;
    status: string;
    buyerName: string;
    buyerCompany: string | null;
    notes: string | null;
    deliveryAddress: string | null;
    requiredDeliveryDate: string | null;   // DATE string YYYY-MM-DD
    createdAt: Date;
  };
  rfqLines: RfqLineForVendor[];
  quoteLines: QuoteLineView[];
}

/** RFQ line — buyer target price INTENTIONALLY omitted */
export interface RfqLineForVendor {
  id: number;
  itemName: string;
  itemDescription: string | null;
  itemUnit: string | null;
  requestedQty: string;
  // targetPricePerUnit intentionally excluded — buyer internal
  notes: string | null;
  sortOrder: number;
}

/** Existing quote line view */
export interface QuoteLineView {
  id: number;
  rfqLineId: number;
  vendorCatalogItemId: number | null;
  offeredUnitPrice: string;
  offeredQty: string;
  subtotal: string;
  currency: string | null;
  minimumOrderQty: string | null;
  validUntil: string | null;       // DATE string per line
  leadTimeDays: number | null;
  stockStatus: string | null;
  notes: string | null;
  isPartialQuote: boolean;         // computed: offeredQty < requestedQty
}

// ── Types: Save / Submit ──────────────────────────────────────────────────────

export interface QuoteLineInput {
  rfqLineId: number;
  offeredUnitPrice: number;        // > 0
  offeredQty: number;              // >= 1
  currency: string;                // ISO 4217 — wajib saat submit
  minimumOrderQty?: number;        // >= 1 jika diisi
  validUntil: string;              // YYYY-MM-DD — wajib saat submit
  leadTimeDays?: number;           // >= 0
  stockStatus?: "available" | "limited" | "backorder" | "unavailable";
  notes?: string | null;
  vendorCatalogItemId?: number | null;
}

export interface QuoteHeaderInput {
  quotationNumber?: string | null;
  quotationDate?: string | null;   // YYYY-MM-DD; default CURRENT_DATE
  paymentTerms?: string | null;
  incoterm?: string | null;
  deliveryLocation?: string | null;
  notes?: string | null;           // grand_notes
}

export interface SaveQuoteInput {
  header: QuoteHeaderInput;
  lines: QuoteLineInput[];
}

// ── Types: Error Unions ───────────────────────────────────────────────────────

export type QuoteErrorCode =
  | "TOKEN_INVALID"
  | "TOKEN_EXPIRED"
  | "TOKEN_NOT_ACTIVE"
  | "ALREADY_SUBMITTED"
  | "VALIDATION_ERROR"
  | "RFQ_LINE_MISMATCH"
  | "DB_ERROR";

export type QuoteError =
  | { ok: false; code: "TOKEN_INVALID";    message: string }
  | { ok: false; code: "TOKEN_EXPIRED";    message: string }
  | { ok: false; code: "TOKEN_NOT_ACTIVE"; message: string; currentStatus: string }
  | { ok: false; code: "ALREADY_SUBMITTED"; message: string; submittedAt: Date }
  | { ok: false; code: "VALIDATION_ERROR"; message: string; fields?: string[] }
  | { ok: false; code: "RFQ_LINE_MISMATCH"; message: string }
  | { ok: false; code: "DB_ERROR";         message: string };

// ── Helpers ───────────────────────────────────────────────────────────────────

/**
 * Constant-time token comparison untuk mencegah timing attack.
 * Kedua token adalah 64-char hex string → 32 bytes.
 */
function safeTokenEqual(a: string, b: string): boolean {
  try {
    const bufA = Buffer.from(a, "hex");
    const bufB = Buffer.from(b, "hex");
    if (bufA.length !== 32 || bufB.length !== 32) return false;
    return timingSafeEqual(bufA, bufB);
  } catch {
    return false;
  }
}

function today(): string {
  return new Date().toISOString().slice(0, 10); // YYYY-MM-DD
}

/** Compute subtotal dari price × qty */
function computeSubtotal(price: number, qty: number): string {
  return (price * qty).toFixed(2);
}

// ── Core: Load quote by token ─────────────────────────────────────────────────

/**
 * Lookup dan validasi token.
 * Returns VendorQuoteView on success (WAJIB exclude internal fields).
 */
export async function loadQuoteByToken(
  rawToken: string,
): Promise<{ ok: true; view: VendorQuoteView } | QuoteError> {
  // Basic format guard — token harus 64 hex chars
  if (!rawToken || !/^[0-9a-f]{64}$/i.test(rawToken)) {
    return { ok: false, code: "TOKEN_INVALID", message: "Token tidak valid" };
  }

  try {
    // Lookup by token (safe: opaque random token, bukan HMAC)
    const [quote] = await db
      .select({
        id:               mktVendorQuotesTable.id,
        rfqId:            mktVendorQuotesTable.rfqId,
        vendorId:         mktVendorQuotesTable.vendorId,
        token:            mktVendorQuotesTable.token,
        status:           mktVendorQuotesTable.status,
        validUntil:       mktVendorQuotesTable.validUntil,
        openedAt:         mktVendorQuotesTable.openedAt,
        submittedAt:      mktVendorQuotesTable.submittedAt,
        quotationNumber:  mktVendorQuotesTable.quotationNumber,
        quotationDate:    mktVendorQuotesTable.quotationDate,
        paymentTerms:     mktVendorQuotesTable.paymentTerms,
        incoterm:         mktVendorQuotesTable.incoterm,
        deliveryLocation: mktVendorQuotesTable.deliveryLocation,
        notes:            mktVendorQuotesTable.notes,
        attachmentUrl:    mktVendorQuotesTable.attachmentUrl,
        // Phase 2F: requote fields — exposed to vendor when status = requote_requested
        requoteNotes:    mktVendorQuotesTable.requoteNotes,
        requoteDeadline: mktVendorQuotesTable.requoteDeadline,
        requoteRound:    mktVendorQuotesTable.requoteRound,
        // INTERNAL FIELDS NOT SELECTED: commissionRate, commissionAmount,
        // commissionTaxId, netVendorAmount, rankScore, rankBadges
      })
      .from(mktVendorQuotesTable)
      .where(eq(mktVendorQuotesTable.token, rawToken))
      .limit(1);

    if (!quote) {
      return { ok: false, code: "TOKEN_INVALID", message: "Token tidak ditemukan" };
    }

    // Constant-time comparison (defense-in-depth)
    if (!safeTokenEqual(rawToken.toLowerCase(), quote.token.toLowerCase())) {
      return { ok: false, code: "TOKEN_INVALID", message: "Token tidak valid" };
    }

    // Cek expiry
    if (quote.validUntil && new Date() > quote.validUntil) {
      return { ok: false, code: "TOKEN_EXPIRED", message: "Link undangan sudah kadaluarsa" };
    }

    // Load data pendukung secara paralel
    const [vendorRows, rfqRows, rfqLineRows, quoteLineRows] = await Promise.all([
      db.select({
        id:    suppliersTable.id,
        name:  suppliersTable.name,
        phone: suppliersTable.phone,
        email: suppliersTable.contactEmail,
      }).from(suppliersTable).where(eq(suppliersTable.id, quote.vendorId)).limit(1),

      db.select({
        id:              mktRfqsTable.id,
        rfqNumber:       mktRfqsTable.rfqNumber,
        status:          mktRfqsTable.status,
        buyerName:       mktRfqsTable.buyerName,
        buyerCompany:    mktRfqsTable.buyerCompany,
        notes:           mktRfqsTable.notes,
        deliveryAddress:     mktRfqsTable.deliveryAddress,
        requiredDeliveryDate: mktRfqsTable.requiredDeliveryDate,
        createdAt:           mktRfqsTable.createdAt,
        // INTERNAL NOT SELECTED: companyId, approvalData, dll
      }).from(mktRfqsTable).where(eq(mktRfqsTable.id, quote.rfqId)).limit(1),

      // RFQ lines — target_price_per_unit SENGAJA tidak diselect
      db.select({
        id:              mktRfqLinesTable.id,
        itemName:        mktRfqLinesTable.itemName,
        itemDescription: mktRfqLinesTable.itemDescription,
        itemUnit:        mktRfqLinesTable.itemUnit,
        requestedQty:    mktRfqLinesTable.requestedQty,
        notes:           mktRfqLinesTable.notes,
        sortOrder:       mktRfqLinesTable.sortOrder,
        // targetPricePerUnit intentionally excluded
      }).from(mktRfqLinesTable)
        .where(eq(mktRfqLinesTable.rfqId, quote.rfqId))
        .orderBy(mktRfqLinesTable.sortOrder),

      // Existing quote lines (jika ada)
      db.select({
        id:                 mktVendorQuoteLinesTable.id,
        rfqLineId:          mktVendorQuoteLinesTable.rfqLineId,
        vendorCatalogItemId: mktVendorQuoteLinesTable.vendorCatalogItemId,
        offeredUnitPrice:   mktVendorQuoteLinesTable.offeredUnitPrice,
        offeredQty:         mktVendorQuoteLinesTable.offeredQty,
        subtotal:           mktVendorQuoteLinesTable.subtotal,
        currency:           mktVendorQuoteLinesTable.currency,
        minimumOrderQty:    mktVendorQuoteLinesTable.minimumOrderQty,
        validUntil:         mktVendorQuoteLinesTable.validUntil,
        leadTimeDays:       mktVendorQuoteLinesTable.leadTimeDays,
        stockStatus:        mktVendorQuoteLinesTable.stockStatus,
        notes:              mktVendorQuoteLinesTable.notes,
      }).from(mktVendorQuoteLinesTable)
        .where(eq(mktVendorQuoteLinesTable.quoteId, quote.id)),
    ]);

    const vendor = vendorRows[0];
    const rfq    = rfqRows[0];
    if (!vendor || !rfq) {
      logger.warn({ quoteId: quote.id }, "[vendorQuoteSubmission] vendor/rfq hilang — data corrupt");
      return { ok: false, code: "DB_ERROR", message: "Data tidak ditemukan" };
    }

    // Build rfqLineId → requestedQty map untuk is_partial_quote computation
    const reqQtyMap = new Map<number, string>(
      rfqLineRows.map((l) => [l.id, l.requestedQty])
    );

    const quoteLines: QuoteLineView[] = quoteLineRows.map((ql) => {
      const reqQty = parseFloat(reqQtyMap.get(ql.rfqLineId) ?? "0");
      const offQty = parseFloat(ql.offeredQty);
      return {
        id:                 ql.id,
        rfqLineId:          ql.rfqLineId,
        vendorCatalogItemId: ql.vendorCatalogItemId,
        offeredUnitPrice:   ql.offeredUnitPrice,
        offeredQty:         ql.offeredQty,
        subtotal:           ql.subtotal,
        currency:           ql.currency,
        minimumOrderQty:    ql.minimumOrderQty,
        validUntil:         ql.validUntil,
        leadTimeDays:       ql.leadTimeDays,
        stockStatus:        ql.stockStatus,
        notes:              ql.notes,
        isPartialQuote:     reqQty > 0 && offQty < reqQty,
      };
    });

    const view: VendorQuoteView = {
      quote: {
        id:               quote.id,
        rfqId:            quote.rfqId,
        vendorId:         quote.vendorId,
        status:           quote.status,
        validUntil:       quote.validUntil,
        openedAt:         quote.openedAt,
        submittedAt:      quote.submittedAt,
        quotationNumber:  quote.quotationNumber,
        quotationDate:    quote.quotationDate,
        paymentTerms:     quote.paymentTerms,
        incoterm:         quote.incoterm,
        deliveryLocation: quote.deliveryLocation,
        notes:            quote.notes,
        attachmentUrl:    quote.attachmentUrl,
        requoteNotes:    quote.requoteNotes,
        requoteDeadline: quote.requoteDeadline,
        requoteRound:    quote.requoteRound ?? 1,
      },
      vendor: {
        id:    vendor.id,
        name:  vendor.name,
        phone: vendor.phone,
        email: vendor.email,
      },
      rfq: {
        id:                  rfq.id,
        rfqNumber:           rfq.rfqNumber,
        status:              rfq.status,
        buyerName:           rfq.buyerName,
        buyerCompany:        rfq.buyerCompany,
        notes:               rfq.notes,
        deliveryAddress:     rfq.deliveryAddress,
        requiredDeliveryDate: rfq.requiredDeliveryDate,
        createdAt:           rfq.createdAt,
      },
      rfqLines: rfqLineRows.map((l) => ({
        id:              l.id,
        itemName:        l.itemName,
        itemDescription: l.itemDescription,
        itemUnit:        l.itemUnit,
        requestedQty:    l.requestedQty,
        notes:           l.notes,
        sortOrder:       l.sortOrder,
      })),
      quoteLines,
    };

    return { ok: true, view };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    logger.warn({ err }, "[vendorQuoteSubmission] DB error saat loadQuoteByToken");
    return { ok: false, code: "DB_ERROR", message: msg };
  }
}

// ── Mark as Opened ────────────────────────────────────────────────────────────

/**
 * Transisi invited → opened. Idempotent: jika sudah opened/draft/submitted → skip.
 * Fire-and-forget activity log.
 */
export async function markQuoteOpened(
  quoteId: number,
  rfqId: number,
  vendorId: number,
): Promise<void> {
  try {
    await db
      .update(mktVendorQuotesTable)
      .set({ status: "opened", openedAt: new Date(), updatedAt: new Date() })
      .where(
        and(
          eq(mktVendorQuotesTable.id, quoteId),
          eq(mktVendorQuotesTable.status, "invited"), // hanya dari invited
        ),
      );

    logActivity({
      mktRfqId:         rfqId,
      mktVendorQuoteId: quoteId,
      actorType:        "vendor",
      actorId:          String(vendorId),
      action:           "mkt_vendor_quote_opened",
      description:      `Vendor membuka link quotation (quote_id=${quoteId})`,
    }).catch(() => {});
  } catch (err) {
    // Non-fatal — log tapi jangan block response
    logger.warn({ err, quoteId }, "[vendorQuoteSubmission] markQuoteOpened error — non-fatal");
  }
}

// ── Validation helpers ────────────────────────────────────────────────────────

interface LineValidationResult {
  ok: true;
  lines: Array<{
    rfqLineId: number;
    offeredUnitPrice: string;
    offeredQty: string;
    subtotal: string;
    currency: string;
    minimumOrderQty: string | null;
    validUntil: string;
    leadTimeDays: number | null;
    stockStatus: "available" | "limited" | "backorder" | "unavailable";
    notes: string | null;
    vendorCatalogItemId: number | null;
  }>;
}

function validateLines(
  lines: QuoteLineInput[],
  validRfqLineIds: Set<number>,
  quotationDate: string,
  forSubmit: boolean,
): LineValidationResult | { ok: false; code: "VALIDATION_ERROR"; message: string; fields: string[] } | { ok: false; code: "RFQ_LINE_MISMATCH"; message: string } {
  const errors: string[] = [];

  if (lines.length === 0) {
    return { ok: false, code: "VALIDATION_ERROR", message: "Minimal satu line item harus diisi", fields: ["lines"] };
  }

  // Cek semua rfqLineId valid
  for (const line of lines) {
    if (!validRfqLineIds.has(line.rfqLineId)) {
      return {
        ok: false,
        code: "RFQ_LINE_MISMATCH",
        message: `rfq_line_id=${line.rfqLineId} tidak ada dalam RFQ ini`,
      };
    }
  }

  // Duplicate rfqLineId check
  const seen = new Set<number>();
  for (const line of lines) {
    if (seen.has(line.rfqLineId)) {
      errors.push(`Duplicate rfq_line_id=${line.rfqLineId}`);
    }
    seen.add(line.rfqLineId);
  }

  const validated = lines.map((line, i) => {
    const prefix = `Line[${i + 1}] (rfq_line_id=${line.rfqLineId})`;

    // price > 0
    if (!Number.isFinite(line.offeredUnitPrice) || line.offeredUnitPrice <= 0) {
      errors.push(`${prefix}: price harus > 0`);
    }

    // offered_qty >= 1
    if (!Number.isFinite(line.offeredQty) || line.offeredQty < 1) {
      errors.push(`${prefix}: offered_qty harus >= 1`);
    }

    // currency — wajib saat submit
    if (forSubmit || line.currency) {
      if (!line.currency) {
        errors.push(`${prefix}: currency wajib diisi`);
      } else if (!ALLOWED_CURRENCIES.has(line.currency.toUpperCase())) {
        errors.push(`${prefix}: currency "${line.currency}" tidak didukung`);
      }
    }

    // MOQ >= 1 jika diisi
    if (line.minimumOrderQty !== undefined && line.minimumOrderQty !== null) {
      if (!Number.isFinite(line.minimumOrderQty) || line.minimumOrderQty < 1) {
        errors.push(`${prefix}: minimum_order_qty harus >= 1`);
      }
    }

    // lead_time >= 0
    if (line.leadTimeDays !== undefined && line.leadTimeDays !== null) {
      if (!Number.isInteger(line.leadTimeDays) || line.leadTimeDays < 0) {
        errors.push(`${prefix}: lead_time_days harus >= 0`);
      }
    }

    // valid_until — wajib saat submit, harus >= quotation_date
    if (forSubmit || line.validUntil) {
      if (!line.validUntil) {
        errors.push(`${prefix}: valid_until wajib diisi`);
      } else if (line.validUntil < quotationDate) {
        errors.push(`${prefix}: valid_until tidak boleh sebelum quotation_date (${quotationDate})`);
      }
    }

    return {
      rfqLineId:          line.rfqLineId,
      offeredUnitPrice:   line.offeredUnitPrice.toFixed(2),
      offeredQty:         line.offeredQty.toFixed(3),
      subtotal:           computeSubtotal(line.offeredUnitPrice, line.offeredQty),
      currency:           (line.currency ?? "").toUpperCase() || null as unknown as string,
      minimumOrderQty:    line.minimumOrderQty != null ? line.minimumOrderQty.toFixed(3) : null,
      validUntil:         line.validUntil ?? "",
      leadTimeDays:       line.leadTimeDays ?? null,
      stockStatus:        (line.stockStatus ?? "available") as "available" | "limited" | "backorder" | "unavailable",
      notes:              line.notes ?? null,
      vendorCatalogItemId: line.vendorCatalogItemId ?? null,
    };
  });

  if (errors.length > 0) {
    return { ok: false, code: "VALIDATION_ERROR", message: errors.join("; "), fields: errors };
  }

  return { ok: true, lines: validated };
}

// ── Save Draft ────────────────────────────────────────────────────────────────

/**
 * Simpan draft. Boleh dipanggil berkali-kali.
 * DELETE existing lines → INSERT baru (idempotent overwrite).
 * Status: invited/opened → draft. Jika sudah draft → tetap draft.
 */
export async function saveQuoteDraft(
  quoteId: number,
  rfqId: number,
  vendorId: number,
  rfqLineIds: Set<number>,  // valid rfq_line_ids untuk RFQ ini
  input: SaveQuoteInput,
): Promise<{ ok: true; savedLines: number } | QuoteError> {
  // Resolve quotation_date
  const quotationDate = input.header.quotationDate ?? today();

  // Validasi lines (tidak wajib submit-level strict untuk draft)
  const lineResult = validateLines(input.lines, rfqLineIds, quotationDate, false);
  if (!lineResult.ok) return lineResult;

  try {
    let savedLines = 0;
    await db.transaction(async (tx) => {
      // Guard: tidak boleh save jika sudah submitted
      const [current] = await tx
        .select({ status: mktVendorQuotesTable.status })
        .from(mktVendorQuotesTable)
        .where(eq(mktVendorQuotesTable.id, quoteId))
        .limit(1);

      if (!current) throw Object.assign(new Error("Quote tidak ditemukan"), { _code: "DB_ERROR" });
      if (current.status === "submitted") {
        throw Object.assign(new Error("Quote sudah disubmit"), { _code: "ALREADY_SUBMITTED" });
      }

      // Update header — status transitions invited/opened → opened.
      // Phase 2F: preserve 'requote_requested' status — jangan overwrite ke 'opened'
      // agar vendor masih bisa save draft tanpa merusak requote flow.
      const preserveRequote = current.status === "requote_requested";
      await tx
        .update(mktVendorQuotesTable)
        .set({
          status:           preserveRequote ? ("requote_requested" as any) : "opened",
          quotationNumber:  input.header.quotationNumber ?? null,
          quotationDate:    quotationDate,
          paymentTerms:     input.header.paymentTerms ?? null,
          incoterm:         input.header.incoterm ?? null,
          deliveryLocation: input.header.deliveryLocation ?? null,
          notes:            input.header.notes ?? null,
          updatedAt:        new Date(),
        })
        .where(eq(mktVendorQuotesTable.id, quoteId));

      // Overwrite lines: DELETE existing → INSERT fresh
      await tx
        .delete(mktVendorQuoteLinesTable)
        .where(eq(mktVendorQuoteLinesTable.quoteId, quoteId));

      if (lineResult.lines.length > 0) {
        await tx.insert(mktVendorQuoteLinesTable).values(
          lineResult.lines.map((l) => ({
            quoteId,
            rfqLineId:          l.rfqLineId,
            vendorCatalogItemId: l.vendorCatalogItemId,
            offeredUnitPrice:   l.offeredUnitPrice,
            offeredQty:         l.offeredQty,
            subtotal:           l.subtotal,
            currency:           l.currency || null,
            minimumOrderQty:    l.minimumOrderQty,
            validUntil:         l.validUntil || null,
            leadTimeDays:       l.leadTimeDays,
            stockStatus:        l.stockStatus,
            notes:              l.notes,
          })),
        );
        savedLines = lineResult.lines.length;
      }
    });

    // Activity log — fire and forget
    logActivity({
      mktRfqId:         rfqId,
      mktVendorQuoteId: quoteId,
      actorType:        "vendor",
      actorId:          String(vendorId),
      action:           "mkt_vendor_quote_saved",
      description:      `Vendor menyimpan draft quotation (quote_id=${quoteId}, ${savedLines} lines)`,
      newValue:         { savedLines, quotationDate, paymentTerms: input.header.paymentTerms },
    }).catch(() => {});

    return { ok: true, savedLines };
  } catch (err) {
    const code = (err as { _code?: string })._code;
    if (code === "ALREADY_SUBMITTED") {
      return {
        ok: false,
        code: "ALREADY_SUBMITTED",
        message: "Quote sudah disubmit — tidak dapat diedit",
        submittedAt: new Date(), // placeholder, route akan skip ini
      };
    }
    const msg = err instanceof Error ? err.message : String(err);
    logger.warn({ err, quoteId }, "[vendorQuoteSubmission] saveQuoteDraft error");
    return { ok: false, code: "DB_ERROR", message: msg };
  }
}

// ── Submit ────────────────────────────────────────────────────────────────────

/**
 * Submit final quotation. Transactional + atomic + idempotent.
 *
 * Guard: UPDATE WHERE status IN ('invited','opened','draft') RETURNING id
 * Jika 0 rows → sudah submitted → return ALREADY_SUBMITTED.
 * Validasi lebih strict dari save (currency wajib, valid_until wajib per line).
 */
export async function submitQuote(
  quoteId: number,
  rfqId: number,
  vendorId: number,
  rfqLineIds: Set<number>,
  input: SaveQuoteInput,
): Promise<{ ok: true; submittedAt: Date; wasRequote: boolean } | QuoteError> {
  const quotationDate = input.header.quotationDate ?? today();

  // Strict validation untuk submit
  const lineResult = validateLines(input.lines, rfqLineIds, quotationDate, true);
  if (!lineResult.ok) return lineResult;

  // Wajib: semua rfq_line_ids harus dicakup
  const submittedLineIds = new Set(lineResult.lines.map((l) => l.rfqLineId));
  const missing = [...rfqLineIds].filter((id) => !submittedLineIds.has(id));
  if (missing.length > 0) {
    return {
      ok: false,
      code: "RFQ_LINE_MISMATCH",
      message: `Semua RFQ line harus diisi. Missing rfq_line_id: ${missing.join(", ")}`,
    };
  }

  const submittedAt = new Date();
  // Phase 2F: hoisted so they are accessible after the transaction for wasRequote detection
  let isRequote = false;
  let nextRound = 1;

  try {
    let didUpdate = false;
    await db.transaction(async (tx) => {
      // Phase 2F: Pre-load current status to handle requote round increment
      const [priorRow] = await tx
        .select({
          status:       mktVendorQuotesTable.status,
          requoteRound: mktVendorQuotesTable.requoteRound,
        })
        .from(mktVendorQuotesTable)
        .where(eq(mktVendorQuotesTable.id, quoteId))
        .limit(1);

      isRequote = priorRow?.status === "requote_requested";
      nextRound = isRequote
        ? (priorRow?.requoteRound ?? 1) + 1
        : (priorRow?.requoteRound ?? 1);

      // Atomic guard: UPDATE only if status is still active (including requote_requested)
      const updated = await tx
        .update(mktVendorQuotesTable)
        .set({
          status:           "submitted",
          submittedAt,
          requoteRound:     nextRound,
          // Phase 2F: clear requote fields when vendor resubmits after requote
          ...(isRequote ? { requoteNotes: null, requoteDeadline: null } : {}),
          quotationNumber:  input.header.quotationNumber ?? null,
          quotationDate:    quotationDate,
          paymentTerms:     input.header.paymentTerms ?? null,
          incoterm:         input.header.incoterm ?? null,
          deliveryLocation: input.header.deliveryLocation ?? null,
          notes:            input.header.notes ?? null,
          updatedAt:        new Date(),
        })
        .where(
          and(
            eq(mktVendorQuotesTable.id, quoteId),
            inArray(mktVendorQuotesTable.status, ["invited", "opened", "requote_requested"]),
          ),
        )
        .returning({ id: mktVendorQuotesTable.id });

      if (updated.length === 0) {
        // Sudah submitted (concurrent request atau double-click)
        throw Object.assign(new Error("already_submitted"), { _code: "ALREADY_SUBMITTED" });
      }
      didUpdate = true;

      // Overwrite lines
      await tx
        .delete(mktVendorQuoteLinesTable)
        .where(eq(mktVendorQuoteLinesTable.quoteId, quoteId));

      await tx.insert(mktVendorQuoteLinesTable).values(
        lineResult.lines.map((l) => ({
          quoteId,
          rfqLineId:          l.rfqLineId,
          vendorCatalogItemId: l.vendorCatalogItemId,
          offeredUnitPrice:   l.offeredUnitPrice,
          offeredQty:         l.offeredQty,
          subtotal:           l.subtotal,
          currency:           l.currency || null,
          minimumOrderQty:    l.minimumOrderQty,
          validUntil:         l.validUntil || null,
          leadTimeDays:       l.leadTimeDays,
          stockStatus:        l.stockStatus,
          notes:              l.notes,
        })),
      );
    });

    if (!didUpdate) {
      // Harusnya tidak sampai sini tapi sebagai safety net
      const [existing] = await db
        .select({ submittedAt: mktVendorQuotesTable.submittedAt })
        .from(mktVendorQuotesTable)
        .where(eq(mktVendorQuotesTable.id, quoteId))
        .limit(1);
      return {
        ok: false,
        code: "ALREADY_SUBMITTED",
        message: "Quote sudah disubmit sebelumnya",
        submittedAt: existing?.submittedAt ?? submittedAt,
      };
    }

    // Activity log — fire and forget
    logActivity({
      mktRfqId:         rfqId,
      mktVendorQuoteId: quoteId,
      actorType:        "vendor",
      actorId:          String(vendorId),
      action:           "mkt_vendor_quote_submitted",
      description:      `Vendor mensubmit quotation final (quote_id=${quoteId}, ${lineResult.lines.length} lines)`,
      newValue: {
        lineCount:       lineResult.lines.length,
        quotationDate,
        paymentTerms:    input.header.paymentTerms,
        submittedAt:     submittedAt.toISOString(),
      },
    }).catch(() => {});

    logger.info(
      { quoteId, rfqId, vendorId, submittedAt, isRequote, nextRound },
      "[vendorQuoteSubmission] Quote submitted",
    );

    // Phase 2F: Enqueue requote-submitted notification to admin/buyer (non-fatal)
    if (isRequote) {
      import("./marketplaceNotificationQueueService.js").then(async ({ enqueueNotification }) => {
        await enqueueNotification({
          eventType:     "mkt_requote_submitted",
          recipientType: "admin",
          rfqId,
          vendorQuoteId: quoteId,
          payloadJson: {
            rfqId,
            quoteId,
            vendorId,
            requoteRound: nextRound,
            submittedAt:  submittedAt.toISOString(),
          },
        });
      }).catch((err: unknown) => {
        logger.error({ err, rfqId, quoteId }, "[vendorQuoteSubmission] enqueue mkt_requote_submitted failed");
      });
    }

    return { ok: true, submittedAt, wasRequote: isRequote };
  } catch (err) {
    const code = (err as { _code?: string })._code;
    if (code === "ALREADY_SUBMITTED") {
      const [existing] = await db
        .select({ submittedAt: mktVendorQuotesTable.submittedAt })
        .from(mktVendorQuotesTable)
        .where(eq(mktVendorQuotesTable.id, quoteId))
        .limit(1)
        .catch(() => []);
      return {
        ok: false,
        code: "ALREADY_SUBMITTED",
        message: "Quote sudah disubmit — tidak dapat diedit lagi",
        submittedAt: (existing as { submittedAt?: Date } | undefined)?.submittedAt ?? submittedAt,
      };
    }
    const msg = err instanceof Error ? err.message : String(err);
    logger.warn({ err, quoteId }, "[vendorQuoteSubmission] submitQuote error");
    return { ok: false, code: "DB_ERROR", message: msg };
  }
}

// ── Upload Attachment ─────────────────────────────────────────────────────────

const objectStorage = new ObjectStorageService();

/**
 * Upload attachment ke Supabase Storage (private bucket).
 * Simpan metadata URL ke mkt_vendor_quotes.attachment_url.
 * Overwrite jika sudah ada attachment sebelumnya.
 */
export async function uploadQuoteAttachment(
  quoteId: number,
  rfqId: number,
  vendorId: number,
  buffer: Buffer,
  mimeType: string,
  originalName: string,
): Promise<{ ok: true; attachmentUrl: string } | QuoteError> {
  try {
    // Cek quote masih aktif (belum submitted)
    const [quote] = await db
      .select({ status: mktVendorQuotesTable.status, rfqId: mktVendorQuotesTable.rfqId })
      .from(mktVendorQuotesTable)
      .where(eq(mktVendorQuotesTable.id, quoteId))
      .limit(1);

    if (!quote) return { ok: false, code: "DB_ERROR", message: "Quote tidak ditemukan" };
    if (quote.status === "submitted") {
      return {
        ok: false,
        code: "ALREADY_SUBMITTED",
        message: "Quote sudah disubmit — tidak dapat upload attachment baru",
        submittedAt: new Date(),
      };
    }

    // Upload ke private bucket
    const objectId = randomUUID();
    const safeOriginal = originalName.replace(/[^\w.\-]/g, "_").slice(0, 100);
    const subPath = `mkt-vendor-quote/${quoteId}/${objectId}_${safeOriginal}`;
    const attachmentUrl = await objectStorage.uploadPrivateEntity(buffer, mimeType);

    // Simpan URL ke DB
    await db
      .update(mktVendorQuotesTable)
      .set({ attachmentUrl, updatedAt: new Date() })
      .where(eq(mktVendorQuotesTable.id, quoteId));

    void subPath; // subPath dipakai untuk naming — URL dari uploadPrivateEntity

    logActivity({
      mktRfqId:         rfqId,
      mktVendorQuoteId: quoteId,
      actorType:        "vendor",
      actorId:          String(vendorId),
      action:           "mkt_vendor_quote_attachment_uploaded",
      description:      `Vendor upload attachment (quote_id=${quoteId}, type=${mimeType})`,
    }).catch(() => {});

    return { ok: true, attachmentUrl };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    logger.warn({ err, quoteId }, "[vendorQuoteSubmission] uploadQuoteAttachment error");
    return { ok: false, code: "DB_ERROR", message: msg };
  }
}
