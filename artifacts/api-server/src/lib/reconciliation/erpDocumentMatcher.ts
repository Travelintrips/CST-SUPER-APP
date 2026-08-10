/**
 * Phase 4 — ERP Document Matcher
 *
 * Mencari kecocokan di dokumen ERP yang sudah ada untuk mutasi bank masuk.
 *
 * Sumber aktif (memiliki company_id — isolation terjamin):
 *   expenses, accounting_payments, cash_advances, logistic_orders, sales_documents,
 *   sport_payments, qris_settlements
 *
 * Tenant invoices tetap cross-entity; Sport Center payments dan QRIS settlements
 * sudah company-scoped dan boleh menjadi active matching source.
 *
 * Rules:
 *  - company_id isolation WAJIB untuk active sources.
 *  - Dokumen cancelled, rejected, void, deleted, atau already-reconciled DIKECUALIKAN.
 *  - Amount saja TIDAK boleh menghasilkan auto-match.
 *  - QRIS: satu kandidat kuat → recommendation; lebih dari satu → MULTIPLE_CANDIDATES.
 *  - Bank account match (jika tersedia) → signal tambahan dan memperkuat confidence.
 *  - Matching candidate_type di bank_reconciliation_matches menggunakan KEDUA format
 *    (singular legacy: "expense", dan plural baru: "expenses") untuk dedup yang andal.
 *
 * Evidence hierarchy (prioritas tertinggi → terendah):
 *  1. EXACT_REF_AMOUNT      — referensi exact + nominal exact
 *  2. EXISTING_PAYMENT_REL  — dokumen sudah punya payment relation (entry/journal terkait)
 *  3. EXACT_AMOUNT_DATE_VENDOR — nominal + tanggal exact + vendor cocok
 *  4. AMOUNT_DATE_VENDOR_TOLERANCE — nominal + tanggal dalam toleransi + vendor cocok
 *  5. AMOUNT_UNRESOLVED     — nominal exact + dokumen belum punya relasi pembayaran
 *  6. SIMILARITY_CANDIDATE  — bukti parsial, tidak cukup untuk rekomendasi
 */

import { db } from "@workspace/db";
import {
  RECONCILIATION_CANDIDATE_SOURCES,
  type ReconciliationCandidateSource,
} from "@workspace/db";
import { sql } from "drizzle-orm";
import { logger } from "../logger.js";

// ─── Constants ────────────────────────────────────────────────────────────────

/** Toleransi tanggal default dalam hari untuk fuzzy date matching. */
export const DEFAULT_DATE_TOLERANCE_DAYS = 3;

/** Confidence minimum untuk satu kandidat QRIS menjadi recommendation. */
export const QRIS_MIN_CONFIDENCE = 0.65;

// ─── Evidence priority levels ─────────────────────────────────────────────────

export type EvidenceLevel =
  | "EXACT_REF_AMOUNT"
  | "EXISTING_PAYMENT_REL"
  | "EXACT_AMOUNT_DATE_VENDOR"
  | "AMOUNT_DATE_VENDOR_TOLERANCE"
  | "AMOUNT_UNRESOLVED"
  | "SIMILARITY_CANDIDATE";

/** Angka prioritas — semakin kecil = semakin tinggi prioritas. */
export const EVIDENCE_PRIORITY: Record<EvidenceLevel, number> = {
  EXACT_REF_AMOUNT:              1,
  EXISTING_PAYMENT_REL:          2,
  EXACT_AMOUNT_DATE_VENDOR:      3,
  AMOUNT_DATE_VENDOR_TOLERANCE:  4,
  AMOUNT_UNRESOLVED:             5,
  SIMILARITY_CANDIDATE:          6,
} as const;

/** Skor confidence per evidence level (0–1). */
export const EVIDENCE_CONFIDENCE: Record<EvidenceLevel, number> = {
  EXACT_REF_AMOUNT:              0.98,
  EXISTING_PAYMENT_REL:          0.95,
  EXACT_AMOUNT_DATE_VENDOR:      0.92,
  AMOUNT_DATE_VENDOR_TOLERANCE:  0.82,
  AMOUNT_UNRESOLVED:             0.55,
  SIMILARITY_CANDIDATE:          0.35,
};

// ─── Types ────────────────────────────────────────────────────────────────────

/**
 * Sumber ERP yang memiliki company_id (active matching — company isolation terjamin).
 */
export type ActiveErpSourceType =
  | "expenses"
  | "accounting_payments"
  | "cash_advances"
  | "logistic_orders"
  | "sales_documents"
  | "sport_payments"
  | "qris_settlements";

/**
 * Sumber ERP cross-entity tanpa company_id (informational only — tidak bisa jadi
 * finalRecommendation karena company isolation tidak dapat dijamin).
 */
export type CrossEntitySourceType =
  | "tenant_invoices";

export type ErpSourceType = ActiveErpSourceType | CrossEntitySourceType;

export type ErpReasonCode =
  | "EXACT_AMOUNT"
  | "EXACT_DATE"
  | "EXACT_VENDOR"
  | "EXACT_REF"
  | "DATE_WITHIN_TOLERANCE"
  | "VENDOR_PARTIAL_MATCH"
  | "AMOUNT_DIRECTION_MATCH"
  | "PAYMENT_METHOD_QRIS"
  | "UNRESOLVED_DOCUMENT"
  | "EXISTING_PAYMENT_LINK"
  | "BANK_ACCOUNT_MATCH";

export interface ErpCandidateRaw {
  id: number;
  sourceType: ErpSourceType;
  candidateSource?: ReconciliationCandidateSource | null;
  amount: number;
  documentDate: string;
  ref: string | null;
  vendorName: string | null;
  paymentMethod: string | null;
  bankAccountId: number | null;
  status: string;
  alreadyReconciled: boolean;
  /** True jika dokumen ini sudah punya payment relation (entry/journal terkait). */
  hasPaymentLink: boolean;
  /** False untuk cross-entity sources yang tidak bisa dijamin company isolation-nya. */
  isCompanyScoped: boolean;
}

export interface ErpMatchEvidence {
  level: EvidenceLevel;
  priority: number;
  confidence: number;
  reasonCodes: ErpReasonCode[];
}

export interface ErpMatchResult {
  matched: boolean;
  sourceType: ErpSourceType | null;
  sourceId: number | null;
  confidence: number;
  reasonCodes: ErpReasonCode[];
  evidenceLevel: EvidenceLevel | null;
  allCandidates: Array<{
    sourceType: ErpSourceType;
    sourceId: number;
    confidence: number;
    evidenceLevel: EvidenceLevel;
    reasonCodes: ErpReasonCode[];
    isCompanyScoped: boolean;
  }>;
  isMultipleCandidates: boolean;
  multipleCandidatesCount?: number;
}

export interface ErpMatchInput {
  id: number;
  companyId: number | null;
  amount: number;
  direction: "IN" | "OUT";
  transactionDate: string;
  normalizedDescription: string | null;
  providerName: string | null;
  providerOrderId: string | null;
  bankAccountId: number | null;
  dateTolerance?: number;
}

// ─── Safe SQL helper ──────────────────────────────────────────────────────────

function isoDate(d: string): string {
  const parsed = new Date(d);
  return isNaN(parsed.getTime()) ? d : parsed.toISOString().split("T")[0];
}

// ─── Type mapping: plural (Phase 4) → singular (legacy bank_reconciliation_matches) ──

/**
 * Mapping dari ErpSourceType (plural) ke legacy candidate_type (singular) yang
 * digunakan di kolom bank_reconciliation_matches.candidate_type.
 * Kedua versi dicek saat exclusion lookup agar tidak ada dokumen yang lolos filter.
 */
const LEGACY_TYPE_MAP: Record<ErpSourceType, string> = {
  expenses:             "expense",
  accounting_payments:  "accounting_payment",
  cash_advances:        "cash_advances",   // tidak ada di legacy — tetap sama
  logistic_orders:      "logistic_order",
  sales_documents:      "invoice",
  sport_payments:       "sport_payment",
  qris_settlements:     "qris_settlement",
  tenant_invoices:      "tenant_invoice",
};

function toLegacyType(sourceType: ErpSourceType): string {
  return LEGACY_TYPE_MAP[sourceType] ?? sourceType;
}

// ─── Already-reconciled check ─────────────────────────────────────────────────

/**
 * Mengembalikan Set dari key "<sourceType>:<id>" (KEDUA format: plural dan singular)
 * yang sudah punya approved match di bank_reconciliation_matches untuk company ini.
 */
async function fetchAlreadyReconciled(companyId: number): Promise<Set<string>> {
  try {
    const { rows } = await db.execute(sql.raw(`
      SELECT brm.candidate_type, brm.candidate_id
             ,brm.candidate_source
      FROM bank_reconciliation_matches brm
      JOIN bank_mutations bm ON bm.id = brm.mutation_id
      WHERE brm.status = 'approved'
        AND bm.company_id = ${companyId}
    `));
    const result = new Set<string>();
    for (const r of rows as any[]) {
      const legacyKey  = `${r.candidate_type}:${r.candidate_id}`;
      if (r.candidate_type !== "qris_settlement" ||
          r.candidate_source === RECONCILIATION_CANDIDATE_SOURCES.LEGACY_QRIS) {
        result.add(legacyKey);
      }
      // Juga cek dengan format plural (Phase 4) agar tidak ada yang lolos
      for (const [plural, singular] of Object.entries(LEGACY_TYPE_MAP)) {
        if (singular === r.candidate_type) {
          if (plural !== "qris_settlements" ||
              r.candidate_source === RECONCILIATION_CANDIDATE_SOURCES.LEGACY_QRIS) {
            result.add(`${plural}:${r.candidate_id}`);
          }
        }
      }
    }
    return result;
  } catch {
    return new Set();
  }
}

// ─── Fetch candidates dari setiap sumber ERP ─────────────────────────────────

/**
 * Fetch kandidat dari sumber AKTIF (memiliki company_id).
 * Semua source yang memiliki company_id di-fetch dengan filter perusahaan.
 */
async function fetchActiveCandidates(
  companyId: number,
  amount: number,
  direction: "IN" | "OUT",
  transactionDate: string,
  dateTolerance: number,
  mutationIsQris: boolean,
): Promise<ErpCandidateRaw[]> {
  const txDate   = isoDate(transactionDate);
  const dateFrom = `'${txDate}'::date - ${dateTolerance}`;
  const dateTo   = `'${txDate}'::date + ${dateTolerance}`;
  const amtCond  = (col: string) => `ABS(${col}::numeric - ${Number(amount)}) < 0.01`;
  const qrisSettlementTablesAvailable = mutationIsQris
    ? await db.execute(sql.raw(`
        SELECT to_regclass('public.qris_settlements') AS settlements,
               to_regclass('public.qris_settlement_items') AS items
      `)).then(({ rows }) => Boolean((rows[0] as any)?.settlements && (rows[0] as any)?.items))
      .catch(() => false)
    : false;
  const calculatedSportNet = "GREATEST(0, sp.amount - COALESCE(sp.mdr_amount, 0) - COALESCE(sp.tax_withheld_amount, 0) - COALESCE(sp.other_fee_amount, 0))";
  const sportNet = `(CASE
    WHEN COALESCE(sp.net_amount, 0) > 0
      AND COALESCE(sp.settlement_status, 'unsettled') NOT IN ('unsettled', 'pending')
    THEN sp.net_amount
    ELSE ${calculatedSportNet}
  END)`;
  const sportAmount = mutationIsQris ? sportNet : "sp.amount";
  const sportSettlementDate = "COALESCE(sp.settlement_date, COALESCE(sp.paid_at::date, sp.created_at::date) + 1)";
  const aggregateMatchFilter = qrisSettlementTablesAvailable ? `
           AND NOT EXISTS (
             SELECT 1
             FROM qris_settlement_items qsi_member
             JOIN qris_settlements qs_member ON qs_member.id = qsi_member.settlement_id
             WHERE qsi_member.sport_payment_id = sp.id
               AND ABS(qs_member.net_amount::numeric - ${Number(amount)}) < 0.01
               AND qs_member.settlement_date BETWEEN ${dateFrom} AND ${dateTo}
               AND COALESCE(qs_member.status, 'unsettled') NOT IN ('cancelled', 'reversed')
           )` : "";

  type SourceQuery = { type: ActiveErpSourceType; q: string };

  // Direction semantics:
  //   OUT mutations (uang keluar): expenses, cash_advances, logistic_orders (keluar),
  //                                accounting_payments payment_type outbound/vendor
  //   IN  mutations (uang masuk):  sales_documents, logistic_orders (masuk),
  //                                accounting_payments payment_type inbound/customer
  //
  // Filter direction dilakukan BAIK di SQL (hard constraint) MAUPUN di scoreCandidate
  // (sebagai reason code AMOUNT_DIRECTION_MATCH hanya jika direction cocok).

  const sources: SourceQuery[] = [
    // ── expenses (selalu OUT — bayar tagihan ke vendor/supplier) ─────────
    ...(direction === "OUT" ? [{
      type: "expenses" as ActiveErpSourceType,
      q: `
        SELECT
          e.id,
          'expenses'::text                          AS source_type,
          e.amount::numeric                         AS amount,
          e.date::date::text                        AS doc_date,
          NULL::text                                AS ref,
          COALESCE(e.description, e.vendor_employee, '') AS vendor_name,
          NULL::text                                AS payment_method,
          NULL::integer                             AS bank_account_id,
          COALESCE(e.status, 'draft')               AS status,
          (e.status IN ('posted','approved'))::boolean AS has_payment_link
        FROM expenses e
        WHERE ${amtCond("e.amount")}
          AND e.date::date BETWEEN ${dateFrom} AND ${dateTo}
          AND e.company_id = ${companyId}
          AND COALESCE(e.status, 'draft') NOT IN ('cancelled','rejected','void','deleted','voided')
      `,
    }] : []),
    // ── accounting_payments (IN atau OUT tergantung payment_type) ─────────
    // OUT: payment_type ILIKE '%payment%' atau '%vendor%' atau '%outbound%'
    // IN:  payment_type ILIKE '%receipt%' atau '%customer%' atau '%inbound%'
    {
      type: "accounting_payments" as ActiveErpSourceType,
      q: `
        SELECT
          ap.id,
          'accounting_payments'::text               AS source_type,
          ap.amount::numeric                        AS amount,
          ap.date::date::text                       AS doc_date,
          COALESCE(ap.ref, ap.payment_number)       AS ref,
          COALESCE(ap.partner_name, ap.memo, '')    AS vendor_name,
          NULL::text                                AS payment_method,
          NULL::integer                             AS bank_account_id,
          COALESCE(ap.status::text, 'posted')       AS status,
          (ap.entry_id IS NOT NULL)::boolean        AS has_payment_link
        FROM accounting_payments ap
        WHERE ${amtCond("ap.amount")}
          AND ap.date::date BETWEEN ${dateFrom} AND ${dateTo}
          AND ap.company_id = ${companyId}
          -- sport_payments is the canonical reconciliation candidate for
          -- Sport Center payments; accounting_payments only links the source
          -- payment to its accounting journal.
          AND (ap.source_type IS NULL OR ap.source_type <> 'sport_center')
          AND COALESCE(ap.status::text, 'posted') NOT IN ('cancelled','rejected','void','voided')
          AND ap.voided_at IS NULL
          AND (
            ${ direction === "OUT"
              ? `LOWER(ap.payment_type::text) NOT ILIKE '%receipt%'
                 AND LOWER(ap.payment_type::text) NOT ILIKE '%inbound%'`
              : `LOWER(ap.payment_type::text) NOT ILIKE '%payment%'
                 AND LOWER(ap.payment_type::text) NOT ILIKE '%outbound%'
                 AND LOWER(ap.payment_type::text) NOT ILIKE '%vendor%'`
            }
            OR ap.payment_type IS NULL
          )
      `,
    },
    // ── cash_advances (selalu OUT — pemberian uang muka) ─────────────────
    ...(direction === "OUT" ? [{
      type: "cash_advances" as ActiveErpSourceType,
      q: `
        SELECT
          ca.id,
          'cash_advances'::text                     AS source_type,
          ca.amount::numeric                        AS amount,
          ca.date::date::text                       AS doc_date,
          ca.advance_number                         AS ref,
          ca.party_name                             AS vendor_name,
          ca.payment_method,
          -- cash_bank_account_id adalah COA; resolve ke company_bank_accounts.id
          -- untuk mencocokkan dengan bank_mutations.bank_account_id
          (SELECT cba.id
           FROM company_bank_accounts cba
           WHERE cba.coa_id = ca.cash_bank_account_id
             AND cba.company_id = ${companyId}
           LIMIT 1)                                AS bank_account_id,
          COALESCE(ca.status, 'active')             AS status,
          (ca.entry_id IS NOT NULL)::boolean        AS has_payment_link
        FROM cash_advances ca
        WHERE ${amtCond("ca.amount")}
          AND ca.date::date BETWEEN ${dateFrom} AND ${dateTo}
          AND ca.company_id = ${companyId}
          AND ca.voided_at IS NULL
          AND COALESCE(ca.status, 'active') NOT IN ('cancelled','rejected','voided')
      `,
    }] : []),
    // ── logistic_orders (filter direction dari kolom lo.direction) ─────────
    {
      type: "logistic_orders" as ActiveErpSourceType,
      q: `
        SELECT
          lo.id,
          'logistic_orders'::text                   AS source_type,
          lo.total_price::numeric                   AS amount,
          lo.created_at::date::text                 AS doc_date,
          lo.order_number                           AS ref,
          COALESCE(lo.sender_name, lo.recipient_name, '') AS vendor_name,
          lo.payment_method,
          NULL::integer                             AS bank_account_id,
          COALESCE(lo.status, 'pending')            AS status,
          FALSE::boolean                            AS has_payment_link
        FROM logistic_orders lo
        WHERE ${amtCond("lo.total_price")}
          AND lo.created_at::date BETWEEN ${dateFrom} AND ${dateTo}
          AND lo.company_id = ${companyId}
          AND COALESCE(lo.status, 'pending') NOT IN ('cancelled','rejected','void','deleted','voided')
          AND (
            lo.direction IS NULL
            OR lo.direction = '${direction}'
          )
      `,
    },
    // ── sales_documents (selalu IN — penerimaan dari customer) ────────────
    ...(direction === "IN" ? [{
      type: "sales_documents" as ActiveErpSourceType,
      q: `
        SELECT
          sd.id,
          'sales_documents'::text                   AS source_type,
          sd.total_amount::numeric                  AS amount,
          sd.issue_date::date::text                 AS doc_date,
          sd.doc_number                             AS ref,
          COALESCE(c.name, '')                      AS vendor_name,
          NULL::text                                AS payment_method,
          NULL::integer                             AS bank_account_id,
          COALESCE(sd.status, 'draft')              AS status,
          FALSE::boolean                            AS has_payment_link
        FROM sales_documents sd
        LEFT JOIN customers c ON c.id = sd.customer_id
        WHERE sd.doc_type = 'invoice'
          AND ${amtCond("sd.total_amount")}
          AND sd.issue_date::date BETWEEN ${dateFrom} AND ${dateTo}
          AND sd.company_id = ${companyId}
          AND COALESCE(sd.status, 'draft') NOT IN ('cancelled','rejected','void','deleted','voided')
      `,
    }] : []),
    ...(direction === "IN" ? [{
      type: "sport_payments" as ActiveErpSourceType,
      q: `
        SELECT
          sp.id,
          'sport_payments'::text AS source_type,
          ${sportAmount}::numeric AS amount,
          ${sportSettlementDate}::date::text AS doc_date,
          COALESCE(sp.settlement_reference, CONCAT('SPORT-', sp.booking_id::text)) AS ref,
          COALESCE(sb.customer_name, '') AS vendor_name,
          sp.method AS payment_method,
          sp.bank_account_id,
          COALESCE(sp.status, 'pending') AS status,
          (sp.accounting_payment_id IS NOT NULL)::boolean AS has_payment_link
        FROM sport_payments sp
        LEFT JOIN sport_bookings sb ON sb.id = sp.booking_id
        WHERE ${amtCond(sportAmount)}
          AND sp.company_id = ${companyId}
          AND ${sportSettlementDate} BETWEEN ${dateFrom} AND ${dateTo}
          AND COALESCE(sp.status, 'pending') = 'paid'
           AND COALESCE(sp.method, '') ILIKE '%qris%'
           ${mutationIsQris ? aggregateMatchFilter : ""}
      `,
    }] : []),
    ...(direction === "IN" && mutationIsQris && qrisSettlementTablesAvailable ? [{
      type: "qris_settlements" as ActiveErpSourceType,
      q: `
        SELECT
          qs.id,
          'qris_settlements'::text AS source_type,
          qs.net_amount::numeric AS amount,
          qs.settlement_date::date::text AS doc_date,
          qs.settlement_reference AS ref,
          qs.settlement_reference AS vendor_name,
          'qris'::text AS payment_method,
          NULL::integer AS bank_account_id,
          COALESCE(qs.status, 'unsettled') AS status,
          (qs.bank_mutation_id IS NOT NULL)::boolean AS has_payment_link
        FROM qris_settlements qs
        WHERE ${amtCond("qs.net_amount")}
          AND qs.company_id = ${companyId}
          AND qs.settlement_date BETWEEN ${dateFrom} AND ${dateTo}
          AND COALESCE(qs.status, 'unsettled') NOT IN ('cancelled','reversed')
      `,
    }] : []),
  ];

  const results: ErpCandidateRaw[] = [];

  for (const src of sources) {
    try {
      const { rows } = await db.execute(sql.raw(src.q));
      for (const r of rows as any[]) {
        results.push({
          id:               Number(r.id),
          sourceType:       src.type,
          candidateSource:  src.type === "qris_settlements"
            ? RECONCILIATION_CANDIDATE_SOURCES.LEGACY_QRIS
            : null,
          amount:           Number(r.amount),
          documentDate:     String(r.doc_date ?? ""),
          ref:              r.ref ? String(r.ref) : null,
          vendorName:       r.vendor_name ? String(r.vendor_name) : null,
          paymentMethod:    r.payment_method ? String(r.payment_method) : null,
          bankAccountId:    r.bank_account_id != null ? Number(r.bank_account_id) : null,
          status:           String(r.status ?? ""),
          alreadyReconciled: false,  // diisi setelah batch check
          hasPaymentLink:   Boolean(r.has_payment_link),
        isCompanyScoped:  true,
        });
      }
    } catch (e: any) {
      logger.warn(
        { err: e.message, sourceType: src.type, companyId },
        "[erpDocumentMatcher] fetchActiveCandidates: source dilewati",
      );
    }
  }

  return results;
}

// ─── Evidence scorer ──────────────────────────────────────────────────────────

function scoreCandidate(
  mutation: ErpMatchInput,
  candidate: ErpCandidateRaw,
): ErpMatchEvidence {
  const reasonCodes: ErpReasonCode[] = [];

  // ── Amount — wajib ada untuk level apapun selain SIMILARITY_CANDIDATE ──
  const amountMatch = Math.abs(candidate.amount - mutation.amount) < 0.01;
  if (!amountMatch) {
    return {
      level:       "SIMILARITY_CANDIDATE",
      priority:    EVIDENCE_PRIORITY.SIMILARITY_CANDIDATE,
      confidence:  0.05,
      reasonCodes: [],
    };
  }
  reasonCodes.push("EXACT_AMOUNT");
  reasonCodes.push("AMOUNT_DIRECTION_MATCH");

  // ── Referensi exact ────────────────────────────────────────────────────
  const refMatch =
    candidate.ref != null &&
    mutation.providerOrderId != null &&
    candidate.ref.toUpperCase().trim() === mutation.providerOrderId.toUpperCase().trim();
  if (refMatch) reasonCodes.push("EXACT_REF");

  // ── Tanggal ────────────────────────────────────────────────────────────
  const tolerance  = mutation.dateTolerance ?? DEFAULT_DATE_TOLERANCE_DAYS;
  const mutMs      = new Date(mutation.transactionDate).getTime();
  const docMs      = new Date(candidate.documentDate).getTime();
  const diffDays   = isNaN(mutMs) || isNaN(docMs)
    ? Infinity
    : Math.abs(mutMs - docMs) / 86_400_000;

  const exactDate  = diffDays === 0;
  const withinTol  = diffDays <= tolerance;
  if (exactDate)      reasonCodes.push("EXACT_DATE");
  else if (withinTol) reasonCodes.push("DATE_WITHIN_TOLERANCE");

  // ── Vendor / counterparty ──────────────────────────────────────────────
  let vendorMatch = false;
  if (candidate.vendorName && mutation.normalizedDescription) {
    const cNorm = candidate.vendorName.toLowerCase().replace(/[^a-z0-9]/g, " ").trim();
    const mNorm = mutation.normalizedDescription.toLowerCase().replace(/[^a-z0-9]/g, " ").trim();
    const cTok  = new Set(cNorm.split(/\s+/).filter(t => t.length > 2));
    const mTok  = mNorm.split(/\s+/).filter(t => t.length > 2);
    if (cTok.size > 0 && mTok.length > 0) {
      const overlap = mTok.filter(t => cTok.has(t)).length;
      const ratio   = overlap / Math.max(cTok.size, mTok.length);
      if (ratio >= 0.4) {
        vendorMatch = true;
        reasonCodes.push("EXACT_VENDOR");
      } else if (ratio >= 0.2) {
        reasonCodes.push("VENDOR_PARTIAL_MATCH");
      }
    }
  }

  // ── Bank account match (sinyal tambahan) ───────────────────────────────
  let bankAccountBonus = false;
  if (
    mutation.bankAccountId != null &&
    candidate.bankAccountId != null &&
    mutation.bankAccountId === candidate.bankAccountId
  ) {
    bankAccountBonus = true;
    reasonCodes.push("BANK_ACCOUNT_MATCH");
  }

  // ── Payment method QRIS signal ─────────────────────────────────────────
  const isQris = mutation.providerName === "QRIS" ||
    (mutation.normalizedDescription ?? "").toLowerCase().includes("qris");
  const candidateIsQris = (candidate.paymentMethod ?? "").toLowerCase().includes("qris");
  if (isQris && candidateIsQris) reasonCodes.push("PAYMENT_METHOD_QRIS");

  // ── Payment link signal ────────────────────────────────────────────────
  if (candidate.hasPaymentLink) reasonCodes.push("EXISTING_PAYMENT_LINK");

  // ── Unresolved document signal ─────────────────────────────────────────
  const isUnresolved = !candidate.hasPaymentLink && !candidate.ref;
  if (isUnresolved) reasonCodes.push("UNRESOLVED_DOCUMENT");

  // ── Evidence level determination (sesuai hierarchy) ───────────────────
  let level: EvidenceLevel;

  if (refMatch && amountMatch) {
    level = "EXACT_REF_AMOUNT";
  } else if (candidate.hasPaymentLink && amountMatch) {
    level = "EXISTING_PAYMENT_REL";
  } else if (amountMatch && exactDate && vendorMatch) {
    level = "EXACT_AMOUNT_DATE_VENDOR";
  } else if (amountMatch && withinTol && vendorMatch) {
    level = "AMOUNT_DATE_VENDOR_TOLERANCE";
  } else if (amountMatch && isUnresolved) {
    level = "AMOUNT_UNRESOLVED";
  } else {
    level = "SIMILARITY_CANDIDATE";
  }

  // Bank account match menaikkan confidence satu tingkat jika evidence sudah cukup kuat
  let baseConfidence = EVIDENCE_CONFIDENCE[level];
  if (bankAccountBonus && level !== "EXACT_REF_AMOUNT" && level !== "EXISTING_PAYMENT_REL") {
    baseConfidence = Math.min(0.97, baseConfidence + 0.05);
  }

  return {
    level,
    priority:    EVIDENCE_PRIORITY[level],
    confidence:  baseConfidence,
    reasonCodes,
  };
}

// ─── Main orchestrator ────────────────────────────────────────────────────────

/**
 * runErpDocumentMatching — Phase 4 ERP document matching.
 *
 * 1. Fetch kandidat dari semua sumber AKTIF (company-scoped).
 * 2. Tandai dokumen yang sudah direkonsiliasi (dikecualikan).
 * 3. Score setiap kandidat dengan evidence hierarchy.
 * 4. Kembalikan best match + semua kandidat untuk diagnostik.
 *
 * TIDAK memanggil AI, membuat jurnal, membuat expense, atau tax automation.
 * Tenant invoices remain informational-only; Sport Center payments and QRIS
 * settlements are company-scoped active sources.
 */
export async function runErpDocumentMatching(
  mutation: ErpMatchInput,
): Promise<ErpMatchResult> {
  const { companyId, amount, direction, transactionDate } = mutation;
  const dateTolerance = mutation.dateTolerance ?? DEFAULT_DATE_TOLERANCE_DAYS;

  const empty: ErpMatchResult = {
    matched:              false,
    sourceType:           null,
    sourceId:             null,
    confidence:           0,
    reasonCodes:          [],
    evidenceLevel:        null,
    allCandidates:        [],
    isMultipleCandidates: false,
  };

  // Company isolation: tidak bisa matching tanpa company_id
  if (!companyId) {
    logger.warn("[erpDocumentMatcher] companyId null — ERP matching dilewati");
    return empty;
  }

  // Fetch dari active sources (company-scoped)
  const allRaw = await fetchActiveCandidates(
    companyId,
    amount,
    direction,
    transactionDate,
    dateTolerance,
    mutation.providerName === "QRIS" ||
      (mutation.normalizedDescription ?? "").toLowerCase().includes("qris"),
  );

  if (!allRaw.length) return empty;

  // Tandai already-reconciled (cek KEDUA format type key)
  const reconciledSet = await fetchAlreadyReconciled(companyId);
  for (const c of allRaw) {
    const pluralKey  = `${c.sourceType}:${c.id}`;
    const legacyKey  = `${toLegacyType(c.sourceType)}:${c.id}`;
    c.alreadyReconciled = reconciledSet.has(pluralKey) || reconciledSet.has(legacyKey);
  }

  // Kecualikan dokumen yang sudah direkonsiliasi
  const activeCandidates = allRaw.filter(c => !c.alreadyReconciled);
  if (!activeCandidates.length) return empty;

  // Score setiap kandidat
  const scored = activeCandidates.map(c => ({
    candidate: c,
    evidence:  scoreCandidate(mutation, c),
  }));

  // Urutkan: prioritas tertinggi (angka terkecil) dulu, lalu confidence tertinggi
  scored.sort((a, b) => {
    if (a.evidence.priority !== b.evidence.priority) {
      return a.evidence.priority - b.evidence.priority;
    }
    return b.evidence.confidence - a.evidence.confidence;
  });

  const allCandidatesOutput = scored
    .filter(s => s.evidence.confidence > 0.05)
    .map(s => ({
      sourceType:     s.candidate.sourceType,
      sourceId:       s.candidate.id,
      confidence:     s.evidence.confidence,
      evidenceLevel:  s.evidence.level,
      reasonCodes:    s.evidence.reasonCodes,
      isCompanyScoped: s.candidate.isCompanyScoped,
    }));

  const best = scored[0];
  if (!best) return { ...empty, allCandidates: allCandidatesOutput };

  // Amount-only levels TIDAK boleh menghasilkan auto-match
  const amountOnlyLevels: EvidenceLevel[] = ["AMOUNT_UNRESOLVED", "SIMILARITY_CANDIDATE"];
  const isAmountOnly = amountOnlyLevels.includes(best.evidence.level);

  // Deteksi QRIS: cek multiple candidates
  const isQris = mutation.providerName === "QRIS" ||
    (mutation.normalizedDescription ?? "").toLowerCase().includes("qris");

  if (isQris) {
    // Semua kandidat dengan level AMOUNT_UNRESOLVED atau lebih baik
    const strongCandidates = scored.filter(
      s => EVIDENCE_PRIORITY[s.evidence.level] <= EVIDENCE_PRIORITY.AMOUNT_UNRESOLVED,
    );
    if (strongCandidates.length > 1) {
      return {
        matched:              false,
        sourceType:           null,
        sourceId:             null,
        confidence:           0,
        reasonCodes:          ["PAYMENT_METHOD_QRIS"],
        evidenceLevel:        null,
        allCandidates:        allCandidatesOutput,
        isMultipleCandidates: true,
        multipleCandidatesCount: strongCandidates.length,
      };
    }
  }

  // Amount-only → tetap return sebagai suggestion tapi tidak "matched"
  const finalMatched = !isAmountOnly && best.evidence.confidence >= 0.60;

  return {
    matched:              finalMatched,
    sourceType:           best.candidate.sourceType,
    sourceId:             best.candidate.id,
    confidence:           best.evidence.confidence,
    reasonCodes:          best.evidence.reasonCodes,
    evidenceLevel:        best.evidence.level,
    allCandidates:        allCandidatesOutput,
    isMultipleCandidates: false,
  };
}
