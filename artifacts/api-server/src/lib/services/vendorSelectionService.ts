/**
 * vendorSelectionService.ts — Phase 2E
 * ─────────────────────────────────────────────────────────────────────────────
 * Admin Quote Comparison & Vendor Selection
 *
 * Public API:
 *   getQuoteComparisonData(rfqId)     — comparison view dengan badges + weighted score
 *   selectVendorAndCreatePo(opts)     — atomic selection + PO creation
 *
 * Security:
 *   - token, attachment_url, commission_*, rank_* TIDAK pernah dikembalikan
 *   - attachmentAvailable + attachmentName + downloadEndpoint sebagai pengganti
 *
 * Transaction guarantee:
 *   - Semua DB write dalam satu db.transaction()
 *   - Notification & activity log post-commit (fire-and-forget)
 *
 * Race condition protection:
 *   - STEP 1 UPDATE mkt_rfqs WHERE status<>'awarded' RETURNING id
 *     → jika kosong → 409 RFQ_ALREADY_AWARDED (serializes concurrent admins)
 *   - STEP 2 UPDATE mkt_vendor_quotes WHERE status='submitted' RETURNING id
 *     → jika kosong → 409 QUOTE_NO_LONGER_SUBMITTED (double-guard)
 *   - UNIQUE(rfq_id) + UNIQUE(quote_id) pada mkt_purchase_orders (migration 0018)
 */

import { eq, and, ne, inArray, sql } from "drizzle-orm";
import {
  db,
  mktRfqsTable,
  mktRfqLinesTable,
  mktVendorQuotesTable,
  mktVendorQuoteLinesTable,
  mktPurchaseOrdersTable,
  mktPurchaseOrderLinesTable,
  suppliersTable,
} from "@workspace/db";
import { logActivity } from "../activityLog.js";
import { saveVendorNotification } from "../notificationStore.js";
import { enqueueNotification } from "./marketplaceNotificationQueueService.js";
import { logger } from "../logger.js";
import { createOrderLink } from "./orderLinkService.js";

// ── Types ─────────────────────────────────────────────────────────────────────

export interface ComparisonLine {
  rfqLineId:        number;
  itemName:         string;
  requestedQty:     string;
  targetPricePerUnit: string | null; // buyer budget — admin-only, tidak dikirim ke vendor
  offeredUnitPrice: string;
  offeredQty:       string;
  subtotal:         string;
  currency:         string | null;
  minimumOrderQty:  string | null;
  leadTimeDays:     number | null;
  stockStatus:      string;
  validUntil:       string | null;
  notes:            string | null;
}

export interface ComparisonQuote {
  id:               number;
  rfqId:            number;
  vendorId:         number;
  vendorName:       string;
  vendorPhone:      string | null;
  vendorEmail:      string | null;
  status:           string;
  quotationNumber:  string | null;
  quotationDate:    string | null;
  paymentTerms:     string | null;
  incoterm:         string | null;
  deliveryLocation: string | null;
  notes:            string | null;
  submittedAt:      Date | null;
  openedAt:         Date | null;
  createdAt:        Date;
  // Attachment — private path TIDAK pernah dikembalikan
  attachmentAvailable: boolean;
  attachmentName:      string | null;
  downloadEndpoint:    string | null;
  // Lines
  lines: ComparisonLine[];
  // Computed totals
  totalAmount: number;
  effectiveLeadTimeDays: number | null; // MAX(lead_time_days) across lines
  effectiveMoq:          number;        // SUM(min_order_qty) across lines; 0 if all null
  // Badges & score (only meaningful for submitted quotes)
  badges: {
    bestPrice:       boolean;
    fastestDelivery: boolean;
    lowestMoq:       boolean;
    stockReady:      boolean;
    bestOverall:     boolean;
  };
  weightedScore: number; // 0.0 – 1.0
}

export interface ComparisonData {
  rfq: {
    id:                   number;
    rfqNumber:            string;
    status:               string;
    buyerName:            string;
    buyerEmail:           string;
    requiredDeliveryDate: string | null;
    deliveryAddress:      string | null;
    notes:                string | null;
    winnerSelectedAt:     Date | null;
    winnerSelectedBy:     string | null;
    winningQuoteId:       number | null;
  };
  quotes:           ComparisonQuote[];
  submittedCount:   number;
  recommendedQuoteId: number | null; // quoteId dengan weightedScore tertinggi dari submitted quotes
}

export type SelectVendorResult =
  | { ok: true; poId: number; poNumber: string; vendorName: string; totalAmount: string; selectedAt: Date; selectedBy: string; rejectedCount: number }
  | { ok: false; code: "RFQ_ALREADY_AWARDED" | "QUOTE_NO_LONGER_SUBMITTED" | "RFQ_NOT_FOUND" | "QUOTE_NOT_FOUND" | "DB_ERROR"; message: string };

// ── Scoring helpers ───────────────────────────────────────────────────────────

function normalizeLinear(value: number, min: number, max: number, higherIsBetter: boolean): number {
  if (max === min) return 1.0;
  const raw = (value - min) / (max - min);
  return higherIsBetter ? raw : 1.0 - raw;
}

function computeStockScore(lines: ComparisonLine[]): number {
  if (lines.length === 0) return 0.5;
  const weights: Record<string, number> = {
    available:   1.0,
    limited:     0.75,
    backorder:   0.25,
    unavailable: 0.0,
  };
  const sum = lines.reduce((acc, l) => acc + (weights[l.stockStatus] ?? 0.5), 0);
  return sum / lines.length;
}

// ── getQuoteComparisonData ────────────────────────────────────────────────────

export async function getQuoteComparisonData(rfqId: number): Promise<ComparisonData> {
  // 1. Load RFQ
  const [rfq] = await db
    .select({
      id:                   mktRfqsTable.id,
      rfqNumber:            mktRfqsTable.rfqNumber,
      status:               mktRfqsTable.status,
      buyerName:            mktRfqsTable.buyerName,
      buyerEmail:           mktRfqsTable.buyerEmail,
      requiredDeliveryDate: mktRfqsTable.requiredDeliveryDate,
      deliveryAddress:      mktRfqsTable.deliveryAddress,
      notes:                mktRfqsTable.notes,
      winnerSelectedAt:     mktRfqsTable.winnerSelectedAt,
      winnerSelectedBy:     mktRfqsTable.winnerSelectedBy,
      winningQuoteId:       mktRfqsTable.winningQuoteId,
    })
    .from(mktRfqsTable)
    .where(eq(mktRfqsTable.id, rfqId))
    .limit(1);

  if (!rfq) throw Object.assign(new Error("RFQ not found"), { code: "RFQ_NOT_FOUND" });

  // 2. Load all quotes for this RFQ (all statuses — admin sees full history)
  const rawQuotes = await db
    .select({
      id:               mktVendorQuotesTable.id,
      rfqId:            mktVendorQuotesTable.rfqId,
      vendorId:         mktVendorQuotesTable.vendorId,
      status:           mktVendorQuotesTable.status,
      quotationNumber:  mktVendorQuotesTable.quotationNumber,
      quotationDate:    mktVendorQuotesTable.quotationDate,
      paymentTerms:     mktVendorQuotesTable.paymentTerms,
      incoterm:         mktVendorQuotesTable.incoterm,
      deliveryLocation: mktVendorQuotesTable.deliveryLocation,
      notes:            mktVendorQuotesTable.notes,
      attachmentUrl:    mktVendorQuotesTable.attachmentUrl,       // internal — NOT returned
      attachmentFilename: mktVendorQuotesTable.attachmentFilename,
      submittedAt:      mktVendorQuotesTable.submittedAt,
      openedAt:         mktVendorQuotesTable.openedAt,
      createdAt:        mktVendorQuotesTable.createdAt,
      // Security: token, commissionRate, commissionAmount, netVendorAmount, rankScore, rankBadges NOT selected
      vendorName:  suppliersTable.name,
      vendorPhone: suppliersTable.phone,
      vendorEmail: suppliersTable.contactEmail,
    })
    .from(mktVendorQuotesTable)
    .innerJoin(suppliersTable, eq(mktVendorQuotesTable.vendorId, suppliersTable.id))
    .where(eq(mktVendorQuotesTable.rfqId, rfqId))
    .orderBy(mktVendorQuotesTable.createdAt);

  if (rawQuotes.length === 0) {
    return {
      rfq: { ...rfq, requiredDeliveryDate: rfq.requiredDeliveryDate ?? null },
      quotes: [],
      submittedCount: 0,
      recommendedQuoteId: null,
    };
  }

  // 3. Load all RFQ lines (for target price display)
  const rfqLines = await db
    .select({
      id:                 mktRfqLinesTable.id,
      itemName:           mktRfqLinesTable.itemName,
      requestedQty:       mktRfqLinesTable.requestedQty,
      targetPricePerUnit: mktRfqLinesTable.targetPricePerUnit,
    })
    .from(mktRfqLinesTable)
    .where(eq(mktRfqLinesTable.rfqId, rfqId));

  const rfqLineMap = new Map(rfqLines.map((l: any) => [l.id as number, l as { id: number; itemName: string; requestedQty: string; targetPricePerUnit: string | null }]));

  // 4. Batch-load all quote lines
  const quoteIds = rawQuotes.map((q: any) => q.id as number);
  const allQuoteLines = quoteIds.length > 0
    ? await db
        .select({
          id:             mktVendorQuoteLinesTable.id,
          quoteId:        mktVendorQuoteLinesTable.quoteId,
          rfqLineId:      mktVendorQuoteLinesTable.rfqLineId,
          offeredUnitPrice: mktVendorQuoteLinesTable.offeredUnitPrice,
          offeredQty:     mktVendorQuoteLinesTable.offeredQty,
          subtotal:       mktVendorQuoteLinesTable.subtotal,
          currency:       mktVendorQuoteLinesTable.currency,
          minimumOrderQty: mktVendorQuoteLinesTable.minimumOrderQty,
          leadTimeDays:   mktVendorQuoteLinesTable.leadTimeDays,
          stockStatus:    mktVendorQuoteLinesTable.stockStatus,
          validUntil:     mktVendorQuoteLinesTable.validUntil,
          notes:          mktVendorQuoteLinesTable.notes,
        })
        .from(mktVendorQuoteLinesTable)
        .where(inArray(mktVendorQuoteLinesTable.quoteId, quoteIds))
    : [];

  // 5. Group lines by quoteId
  const linesByQuote = new Map<number, typeof allQuoteLines>();
  for (const l of allQuoteLines) {
    const arr = linesByQuote.get(l.quoteId) ?? [];
    arr.push(l);
    linesByQuote.set(l.quoteId, arr);
  }

  // 6. Build ComparisonQuote array with computed totals (no badges yet)
  const quotes: Array<ComparisonQuote & { _isSubmitted: boolean }> = rawQuotes.map((q: any) => {
    const rawLines = linesByQuote.get(q.id as number) ?? [];
    const lines: ComparisonLine[] = rawLines.map((l: any) => {
      const rfqLine = rfqLineMap.get(l.rfqLineId as number) as { id: number; itemName: string; requestedQty: string; targetPricePerUnit: string | null } | undefined;
      return {
        rfqLineId:          l.rfqLineId,
        itemName:           rfqLine?.itemName ?? "",
        requestedQty:       rfqLine?.requestedQty ?? "0",
        targetPricePerUnit: rfqLine?.targetPricePerUnit ?? null,
        offeredUnitPrice:   l.offeredUnitPrice,
        offeredQty:         l.offeredQty,
        subtotal:           l.subtotal,
        currency:           l.currency,
        minimumOrderQty:    l.minimumOrderQty,
        leadTimeDays:       l.leadTimeDays,
        stockStatus:        l.stockStatus ?? "available",
        validUntil:         l.validUntil,
        notes:              l.notes,
      };
    });

    const totalAmount = rawLines.reduce((s: number, l: any) => s + Number(l.subtotal), 0);
    const leadTimes   = rawLines.map((l: any) => l.leadTimeDays as number | null).filter((v: number | null): v is number => v != null);
    const moqValues   = rawLines.map((l: any) => Number(l.minimumOrderQty ?? 0));

    return {
      id:               q.id,
      rfqId:            q.rfqId,
      vendorId:         q.vendorId,
      vendorName:       q.vendorName,
      vendorPhone:      q.vendorPhone,
      vendorEmail:      q.vendorEmail,
      status:           q.status,
      quotationNumber:  q.quotationNumber,
      quotationDate:    q.quotationDate,
      paymentTerms:     q.paymentTerms,
      incoterm:         q.incoterm,
      deliveryLocation: q.deliveryLocation,
      notes:            q.notes,
      submittedAt:      q.submittedAt,
      openedAt:         q.openedAt,
      createdAt:        q.createdAt,
      attachmentAvailable: q.attachmentUrl != null,
      attachmentName:      q.attachmentFilename ?? null,
      downloadEndpoint:    q.attachmentUrl ? `/api/mkt/admin/rfqs/${rfqId}/quotes/${q.id}/attachment` : null,
      lines,
      totalAmount,
      effectiveLeadTimeDays: leadTimes.length > 0 ? Math.max(...leadTimes) : null,
      effectiveMoq:          moqValues.reduce((s: number, v: number) => s + v, 0),
      badges: { bestPrice: false, fastestDelivery: false, lowestMoq: false, stockReady: false, bestOverall: false },
      weightedScore: 0,
      _isSubmitted: q.status === "submitted",
    };
  });

  // 7. Compute Level 1 badges + Level 2 weighted scores (submitted quotes only)
  const submitted = quotes.filter((q) => q._isSubmitted);
  const submittedCount = submitted.length;

  if (submitted.length > 0) {
    // ── Level 1 badge values ──
    const totals      = submitted.map((q) => q.totalAmount);
    const leadTimes   = submitted.map((q) => q.effectiveLeadTimeDays ?? Number.MAX_SAFE_INTEGER);
    const moqs        = submitted.map((q) => q.effectiveMoq);

    const minTotal    = Math.min(...totals);
    const minLead     = Math.min(...leadTimes);
    const minMoq      = Math.min(...moqs);

    for (const q of submitted) {
      q.badges.bestPrice       = q.totalAmount === minTotal;
      q.badges.fastestDelivery = (q.effectiveLeadTimeDays ?? Number.MAX_SAFE_INTEGER) === minLead;
      q.badges.lowestMoq       = q.effectiveMoq === minMoq;
      q.badges.stockReady      = q.lines.every(
        (l) => l.stockStatus === "available" || l.stockStatus === "limited"
      );
    }

    // ── Level 2 weighted score ──
    const maxTotal  = Math.max(...totals);
    const maxLead   = Math.max(...leadTimes);
    const maxMoq    = Math.max(...moqs);

    for (const q of submitted) {
      const priceScore    = normalizeLinear(q.totalAmount, minTotal, maxTotal, false);          // cheaper = higher
      const leadScore     = q.effectiveLeadTimeDays != null
        ? normalizeLinear(q.effectiveLeadTimeDays, minLead, maxLead, false)  // faster = higher
        : 0.5;
      const stockScore    = computeStockScore(q.lines);
      const moqScore      = normalizeLinear(q.effectiveMoq, minMoq, maxMoq, false);            // lower = higher

      q.weightedScore = (priceScore * 0.40) + (leadScore * 0.25) + (stockScore * 0.20) + (moqScore * 0.15);
    }

    // ── Best Overall badge ──
    const maxScore = Math.max(...submitted.map((q) => q.weightedScore));
    for (const q of submitted) {
      if (Math.abs(q.weightedScore - maxScore) < 0.0001) q.badges.bestOverall = true;
    }
  }

  // 8. Recommended quote = highest weighted score among submitted
  const recommendedQuoteId = submitted.length > 0
    ? (submitted.reduce((best, q) => q.weightedScore > best.weightedScore ? q : best)).id
    : null;

  // Strip internal field before return
  const safeQuotes: ComparisonQuote[] = quotes.map(({ _isSubmitted: _i, ...rest }) => rest);

  return {
    rfq: { ...rfq, requiredDeliveryDate: rfq.requiredDeliveryDate ?? null },
    quotes:    safeQuotes,
    submittedCount,
    recommendedQuoteId,
  };
}

// ── selectVendorAndCreatePo ───────────────────────────────────────────────────

export async function selectVendorAndCreatePo(opts: {
  rfqId:     number;
  quoteId:   number;
  adminId:   string;
  adminName: string;
  notes?:    string;
}): Promise<SelectVendorResult> {
  const { rfqId, quoteId, adminId, adminName } = opts;
  const selectedAt = new Date();

  try {
    const txResult = await db.transaction(async (tx: any) => {
      // ── STEP 1: Atomic guard on mkt_rfqs ──────────────────────────────────
      // UPDATE WHERE status<>'awarded' serializes concurrent admin requests.
      // Si RETURNING kosong → RFQ sudah pernah di-award → 409
      const [rfqAwarded] = await tx
        .update(mktRfqsTable)
        .set({
          status:           "awarded",
          winnerSelectedAt: selectedAt,
          winnerSelectedBy: adminId,
          winningQuoteId:   quoteId,
          updatedAt:        new Date(),
        })
        .where(
          and(
            eq(mktRfqsTable.id, rfqId),
            ne(mktRfqsTable.status, "awarded"),
          )
        )
        .returning({
          id:        mktRfqsTable.id,
          rfqNumber: mktRfqsTable.rfqNumber,
          companyId: mktRfqsTable.companyId,
        });

      if (!rfqAwarded) {
        throw Object.assign(new Error("RFQ_ALREADY_AWARDED"), { _code: "RFQ_ALREADY_AWARDED" });
      }

      // ── STEP 2: Mark selected quote ───────────────────────────────────────
      const [quoteSelected] = await tx
        .update(mktVendorQuotesTable)
        .set({ status: "selected", updatedAt: new Date() })
        .where(
          and(
            eq(mktVendorQuotesTable.id, quoteId),
            eq(mktVendorQuotesTable.status, "submitted"),
          )
        )
        .returning({ id: mktVendorQuotesTable.id, vendorId: mktVendorQuotesTable.vendorId });

      if (!quoteSelected) {
        throw Object.assign(new Error("QUOTE_NO_LONGER_SUBMITTED"), { _code: "QUOTE_NO_LONGER_SUBMITTED" });
      }

      // ── STEP 3: Reject other submitted quotes ─────────────────────────────
      const rejectedRows = await tx
        .update(mktVendorQuotesTable)
        .set({ status: "rejected", updatedAt: new Date() })
        .where(
          and(
            eq(mktVendorQuotesTable.rfqId, rfqId),
            ne(mktVendorQuotesTable.id, quoteId),
            eq(mktVendorQuotesTable.status, "submitted"),
          )
        )
        .returning({ id: mktVendorQuotesTable.id, vendorId: mktVendorQuotesTable.vendorId });

      // ── STEP 4: Load snapshot data ────────────────────────────────────────
      const [quoteDetail] = await tx
        .select({
          vendorId:        mktVendorQuotesTable.vendorId,
          quotationNumber: mktVendorQuotesTable.quotationNumber,
          quotationDate:   mktVendorQuotesTable.quotationDate,
          paymentTerms:    mktVendorQuotesTable.paymentTerms,
          incoterm:        mktVendorQuotesTable.incoterm,
          vendorName:      suppliersTable.name,
          vendorAddress:   suppliersTable.address,
          vendorPhone:     suppliersTable.phone,
        })
        .from(mktVendorQuotesTable)
        .innerJoin(suppliersTable, eq(mktVendorQuotesTable.vendorId, suppliersTable.id))
        .where(eq(mktVendorQuotesTable.id, quoteId))
        .limit(1);

      if (!quoteDetail) {
        throw Object.assign(new Error("QUOTE_NOT_FOUND"), { _code: "QUOTE_NOT_FOUND" });
      }

      const quoteLines = await tx
        .select({
          subtotal:       mktVendorQuoteLinesTable.subtotal,
          currency:       mktVendorQuoteLinesTable.currency,
          leadTimeDays:   mktVendorQuoteLinesTable.leadTimeDays,
          minimumOrderQty: mktVendorQuoteLinesTable.minimumOrderQty,
        })
        .from(mktVendorQuoteLinesTable)
        .where(eq(mktVendorQuoteLinesTable.quoteId, quoteId));

      const grandTotal   = quoteLines.reduce((s: number, l: any) => s + Number(l.subtotal), 0);
      const firstCurrency = quoteLines.find((l: any) => l.currency)?.currency ?? null;
      const leadTimeDays  = quoteLines.length > 0
        ? Math.max(...quoteLines.map((l: any) => (l.leadTimeDays as number | null) ?? 0))
        : null;

      // ── STEP 5: Generate PO number ────────────────────────────────────────
      // Pattern: MKT-PO-YYYYMM-{id padded to 4}
      // Insert with placeholder first, then update with real number using returned id.
      const now    = new Date();
      const yyyymm = `${now.getFullYear()}${String(now.getMonth() + 1).padStart(2, "0")}`;

      // ── STEP 6: INSERT Purchase Order ─────────────────────────────────────
      const [insertedPo] = await tx
        .insert(mktPurchaseOrdersTable)
        .values({
          poNumber:   `MKT-PO-${yyyymm}-PENDING`, // temp; updated below
          rfqId,
          quoteId,
          companyId:  rfqAwarded.companyId ?? null,
          vendorId:   quoteDetail.vendorId,
          status:     "pending",
          totalAmount: grandTotal.toFixed(2),
          taxAmount:   "0.00",
          grandTotal:  grandTotal.toFixed(2),
          createdBy:   adminId,
          // Snapshot immutable fields
          vendorNameSnapshot:      quoteDetail.vendorName,
          vendorAddressSnapshot:   quoteDetail.vendorAddress ?? null,
          paymentTermsSnapshot:    quoteDetail.paymentTerms ?? null,
          incotermSnapshot:        quoteDetail.incoterm ?? null,
          quotationNumberSnapshot: quoteDetail.quotationNumber ?? null,
          quotationDateSnapshot:   quoteDetail.quotationDate ?? null,
          currencySnapshot:        firstCurrency,
          leadTimeDaysSnapshot:    leadTimeDays,
        })
        .returning({ id: mktPurchaseOrdersTable.id });

      // Update po_number with real sequence using PO id
      const poSeq    = String(insertedPo.id).padStart(4, "0");
      const poNumber = `MKT-PO-${yyyymm}-${poSeq}`;

      await tx
        .update(mktPurchaseOrdersTable)
        .set({ poNumber, updatedAt: new Date() })
        .where(eq(mktPurchaseOrdersTable.id, insertedPo.id));

      // ── STEP 7: INSERT PO lines — immutable snapshot from winning quote ─────
      // Load quote lines joined with rfq lines to capture item name + unit.
      const quoteLinesForSnapshot = await tx
        .select({
          offeredQty:     mktVendorQuoteLinesTable.offeredQty,
          offeredUnitPrice: mktVendorQuoteLinesTable.offeredUnitPrice,
          subtotal:       mktVendorQuoteLinesTable.subtotal,
          notes:          mktVendorQuoteLinesTable.notes,
          rfqLineId:      mktVendorQuoteLinesTable.rfqLineId,
          itemName:       mktRfqLinesTable.itemName,
          itemUnit:       mktRfqLinesTable.itemUnit,
        })
        .from(mktVendorQuoteLinesTable)
        .innerJoin(mktRfqLinesTable, eq(mktVendorQuoteLinesTable.rfqLineId, mktRfqLinesTable.id))
        .where(eq(mktVendorQuoteLinesTable.quoteId, quoteId));

      if (quoteLinesForSnapshot.length > 0) {
        await tx.insert(mktPurchaseOrderLinesTable).values(
          quoteLinesForSnapshot.map((l: typeof quoteLinesForSnapshot[number]) => ({
            poId:      insertedPo.id,
            itemName:  l.itemName,
            qty:       l.offeredQty,
            unit:      l.itemUnit ?? null,
            unitPrice: l.offeredUnitPrice,
            subtotal:  l.subtotal,
            notes:     l.notes ?? null,
          })),
        );
      }

      return {
        poId:           insertedPo.id,
        poNumber,
        rfqNumber:      rfqAwarded.rfqNumber,
        companyId:      rfqAwarded.companyId,
        vendorId:       quoteDetail.vendorId,
        vendorName:     quoteDetail.vendorName,
        vendorPhone:    quoteDetail.vendorPhone ?? null,
        totalAmount:    grandTotal.toFixed(2),
        rejectedQuotes: rejectedRows,
      };
    });

    // ── Post-commit: fire-and-forget (TIDAK boleh di dalam transaction) ───────
    const { poId, poNumber, rfqNumber, vendorName, vendorPhone, vendorId, totalAmount, rejectedQuotes, companyId: txCompanyId } = txResult;

    // Phase 3D: order_links — rfq → purchase_order (fire-and-forget, non-fatal)
    void createOrderLink({
      companyId: txCompanyId ?? null,
      sourceTable: "mkt_rfqs",
      sourceId: rfqId,
      targetTable: "mkt_purchase_orders",
      targetId: poId,
      linkType: "rfq_to_purchase_order",
      createdBy: adminId,
    }).catch(() => {});

    void logActivity({
      mktRfqId:         rfqId,
      mktVendorQuoteId: quoteId,
      mktPurchaseOrderId: poId,
      actorType:        "admin",
      actorId:          adminId,
      actorName:        adminName,
      action:           "mkt_vendor_selected",
      description:      `Admin memilih vendor ${vendorName} untuk RFQ ${rfqNumber} (PO: ${poNumber})`,
      newValue:         { quoteId, vendorId, poNumber, totalAmount },
    }).catch(() => {});

    for (const rq of rejectedQuotes) {
      void logActivity({
        mktRfqId:         rfqId,
        mktVendorQuoteId: rq.id,
        actorType:        "admin",
        actorId:          adminId,
        actorName:        adminName,
        action:           "mkt_vendor_rejected",
        description:      `Quote vendor ditolak — vendor_id=${rq.vendorId}`,
        newValue:         { quoteId: rq.id, vendorId: rq.vendorId },
      }).catch(() => {});
    }

    void logActivity({
      mktRfqId:           rfqId,
      mktVendorQuoteId:   quoteId,
      mktPurchaseOrderId: poId,
      actorType:          "admin",
      actorId:            adminId,
      actorName:          adminName,
      action:             "mkt_purchase_order_created",
      description:        `PO ${poNumber} dibuat untuk RFQ ${rfqNumber}`,
      newValue:           { poId, poNumber, vendorName, totalAmount },
    }).catch(() => {});

    // ── Phase 2E.1: WA winner → queue (bukan fire-and-forget langsung) ────────
    void enqueueNotification({
      eventType:      "mkt_vendor_winner_notification",
      recipientType:  "vendor",
      recipientId:    vendorId,
      recipientPhone: vendorPhone ?? null,
      rfqId,
      vendorQuoteId:  quoteId,
      purchaseOrderId: poId,
      payloadJson: { rfqId, rfqNumber, quoteId, poId, poNumber, vendorId, vendorName, totalAmount },
    }).catch(() => {});

    // ── Phase 2E.1: WA rejected → queue untuk setiap vendor yang ditolak ─────
    for (const rq of rejectedQuotes) {
      void (async () => {
        try {
          const [sup] = await db
            .select({ phone: suppliersTable.phone, name: suppliersTable.name })
            .from(suppliersTable)
            .where(eq(suppliersTable.id, rq.vendorId))
            .limit(1);

          void enqueueNotification({
            eventType:      "mkt_vendor_rejected_notification",
            recipientType:  "vendor",
            recipientId:    rq.vendorId,
            recipientPhone: sup?.phone ?? null,
            rfqId,
            vendorQuoteId:  rq.id,
            payloadJson:    { rfqId, rfqNumber, quoteId: rq.id, vendorId: rq.vendorId, vendorName: sup?.name ?? null },
          }).catch(() => {});

          // In-app notification (tetap dipertahankan — UI panel vendor)
          void saveVendorNotification({
            vendorId: rq.vendorId,
            type:     "quote_rejected",
            title:    "❌ Quote Tidak Dipilih",
            message:  `Terima kasih telah mengajukan penawaran untuk RFQ ${rfqNumber}. Kali ini penawaran Anda tidak terpilih.`,
            payload:  { rfqId, quoteId: rq.id, rfqNumber },
          }).catch(() => {});
        } catch { /* non-fatal */ }
      })();
    }

    // In-app notification untuk vendor winner (tetap dipertahankan — UI panel vendor)
    void saveVendorNotification({
      vendorId: vendorId,
      type:     "quote_selected",
      title:    "🎉 Quote Anda Dipilih!",
      message:  `Selamat! Penawaran Anda untuk RFQ ${rfqNumber} telah dipilih. PO ${poNumber} akan segera dikirimkan.`,
      payload:  { rfqId, quoteId, poId, poNumber, rfqNumber, totalAmount },
    }).catch(() => {});

    return {
      ok:           true,
      poId,
      poNumber,
      vendorName,
      totalAmount,
      selectedAt,
      selectedBy:   adminId,
      rejectedCount: rejectedQuotes.length,
    };

  } catch (err: unknown) {
    const code = (err as { _code?: string })._code;
    if (code === "RFQ_ALREADY_AWARDED") {
      return { ok: false, code: "RFQ_ALREADY_AWARDED", message: "RFQ ini sudah pernah di-award sebelumnya" };
    }
    if (code === "QUOTE_NO_LONGER_SUBMITTED") {
      return { ok: false, code: "QUOTE_NO_LONGER_SUBMITTED", message: "Quote tidak lagi dalam status submitted" };
    }
    if (code === "QUOTE_NOT_FOUND") {
      return { ok: false, code: "QUOTE_NOT_FOUND", message: "Quote tidak ditemukan" };
    }
    const msg = err instanceof Error ? err.message : String(err);
    logger.warn({ err, rfqId, quoteId }, "[vendorSelection] selectVendorAndCreatePo error");
    return { ok: false, code: "DB_ERROR", message: msg };
  }
}
