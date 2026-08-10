/**
 * Unified Matching Engine — single source of truth untuk bank reconciliation.
 *
 * Rules:
 *  - Amount match WAJIB untuk auto-approve (tidak ada exception)
 *  - Scoring: Amount +50, Date ±1d +20, Ref exact +20, OCR +10 (max 100)
 *  - Threshold: ≥90 + amount_match = AUTO; 70–89 = MANUAL; <70 = UNMATCHED
 *  - Satu mutation hanya boleh match ke 1 kandidat (unique lock di DB)
 *  - Jurnal hanya dibuat setelah approval (di approveAndCreateJournal)
 */

import {
  db,
  RECONCILIATION_CANDIDATE_SOURCES,
  type ReconciliationCandidateSource,
} from "@workspace/db";
import { sql } from "drizzle-orm";
import { logger } from "../logger.js";
import { captureFailedJob } from "../financial/failedJobSystem.js";
import { classifyMutationDescription, persistClassification } from "../expenseClassificationService.js";
import { postEntryWithClient, type DbClient, type PostingLine } from "../accounting.js";
import { normalizeDescription } from "../bankDescriptionNormalizer.js";
import { JournalMappingError } from "../journalMappingErrors.js";
import {
  resolveJournalForEconomicEvent,
  JournalReuseErrorCode,
} from "./journalReuseEngine.js";
import { isQrisSettlementDescription } from "./qrisSettlement.js";
import {
  isSportPaymentInActiveCanonicalSettlement,
  sportPaymentCanonicalSettlementExclusionSql,
  SPORT_PAYMENT_ALREADY_IN_CANONICAL_SETTLEMENT,
} from "./sportPaymentCanonicalSettlement.js";

// ─── Types ────────────────────────────────────────────────────────────────────

export type CandidateType =
  | "accounting_payment"
  | "logistic_order"
  | "invoice"
  | "expense"
  | "sport_payment"
  | "qris_settlement"
  | "tenant_invoice";

export interface MatchCandidate {
  id: number;
  type: CandidateType;
  /** Source-qualified identity; historical rows may legitimately be null. */
  candidateSource?: ReconciliationCandidateSource | null;
  amount: number;
  date: string;
  ref?: string | null;
  name?: string | null;
  gross_amount?: number | null;
  mdr_amount?: number | null;
  tax_withheld_amount?: number | null;
  other_fee_amount?: number | null;
  settlement_date?: string | null;
  settlement_reference?: string | null;
  settlement_status?: string | null;
  payment_method?: string | null;
  settlement_item_count?: number | null;
  settlement_partial?: boolean;
}

export interface UnifiedScoredMatch {
  candidate: MatchCandidate;
  score: number;
  reason: string[];
  amount_match: boolean;
  date_match: boolean;
  ref_match: boolean;
  ocr_match: boolean;
  vendor_match: boolean;
  confidence: number; // 0-100 display value
}

export interface UnifiedMatchResult {
  status: "auto_matched" | "manual_review" | "unmatched";
  best?: UnifiedScoredMatch;
  all: UnifiedScoredMatch[];
}

export { SPORT_PAYMENT_ALREADY_IN_CANONICAL_SETTLEMENT };

export interface MutationInput {
  id: number;
  amount: number;
  transaction_date: string;
  mutation_key: string;
  provider_order_id?: string | null;
  provider_name?: string | null;
  normalized_description?: string | null;
  uploaded_proof_url?: string | null;
  company_id?: number | null;
  bank_account_id?: number | null;
  direction?: string;
}

type ContraResolution = {
  accountId: number;
  label: string;
  treatment: "ar" | "ap" | "expense" | "revenue" | "asset";
};

function canonicalCandidateType(value: string | null | undefined): string | null {
  if (!value) return null;
  const aliases: Record<string, string> = {
    expenses: "expense",
    accounting_payments: "accounting_payment",
    sales_documents: "invoice",
  };
  return aliases[value] ?? value;
}

function escapeSql(value: string): string {
  return value.replace(/'/g, "''");
}

/**
 * Resolve a per-company leaf COA from its base seed code.
 * Seeded leaf accounts are suffixed with the company abbreviation
 * (e.g. 5-3010-CST), while a few legacy databases still contain the
 * unsuffixed code. Company-owned accounts always win.
 */
async function findCompanyCoa(
  client: DbClient,
  companyId: number | null,
  baseCode: string,
): Promise<number | null> {
  const code = escapeSql(baseCode);
  const companyWhere = companyId != null
    ? `(company_id = ${companyId} OR company_id IS NULL)`
    : "company_id IS NULL";
  const { rows } = await client.execute(sql.raw(`
    SELECT id
    FROM chart_of_accounts
    WHERE ${companyWhere}
      AND (code = '${code}' OR code LIKE '${code}-%')
      AND is_active = TRUE
    ORDER BY CASE WHEN company_id ${companyId != null ? `= ${companyId}` : "IS NULL"} THEN 0 ELSE 1 END,
             LENGTH(code), id
    LIMIT 1
  `));
  return rows[0] && (rows[0] as any).id != null ? Number((rows[0] as any).id) : null;
}

/**
 * Select the contra account for a bank mutation. AR/AP are not a generic
 * fallback anymore: they are only used when the selected candidate represents
 * a receivable or payable settlement. Direct bank expenses go to an expense
 * account, especially bank administration fees.
 */
export async function resolveContraAccount(
  client: DbClient,
  args: {
    direction: string;
    companyId: number | null;
    bankAccountId?: number | null;
    candidateType: string | null;
    candidateId: number | null;
    description: string;
    expenseCategory?: string | null;
    expenseSubtype?: string | null;
    settings: Record<string, unknown>;
  },
): Promise<ContraResolution | null> {
  const {
    direction,
    companyId,
    bankAccountId,
    candidateId,
    description,
    expenseCategory,
    expenseSubtype,
    settings,
  } = args;
  const type = canonicalCandidateType(args.candidateType);

  const normalized = normalizeDescription(description);
  const category = String(expenseCategory ?? normalized.category ?? "").toLowerCase();
  const subtype = String(expenseSubtype ?? "").toLowerCase();

  // A transfer between the company's own cash/bank accounts is an asset
  // movement, not an expense and not an AR/AP settlement.
  if (normalized.isInternalTransfer || category === "internal_transfer") {
    if (companyId != null) {
      const { rows } = await client.execute(sql.raw(`
        SELECT coa_id
        FROM company_bank_accounts
        WHERE company_id = ${companyId}
          AND is_active = TRUE
          ${bankAccountId != null ? `AND id <> ${bankAccountId}` : ""}
          AND coa_id IS NOT NULL
        ORDER BY id
        LIMIT 1
      `)).catch(() => ({ rows: [] as any[] }));
      const assetId = rows[0] && (rows[0] as any).coa_id != null
        ? Number((rows[0] as any).coa_id)
        : null;
      if (assetId) return { accountId: assetId, label: "Akun Bank/Kas Lawan", treatment: "asset" };
    }
    return null;
  }

  if (direction === "IN") {
    // A sport payment is normally posted by the Sport Center module already.
    // If it has not been posted yet, its natural contra is revenue.
    if (type === "sport_payment") {
      const accountId = await findCompanyCoa(client, companyId, "4-1017");
      if (accountId) return { accountId, label: "Pendapatan Booking Sport Center", treatment: "revenue" };
    }

    // Interest income (bunga tabungan / jasa giro) must credit the interest
    // income account (4-2010 Pendapatan Bunga), NOT Piutang Usaha.
    // This check runs before the generic AR fallback so that bank-statement
    // entries with descriptions like "JASA GIRO", "BUNGA TABUNGAN", or
    // "KREDIT BUNGA" are always posted to the correct revenue account.
    if (category === "interest_income") {
      const accountId = await findCompanyCoa(client, companyId, "4-2010");
      if (accountId) return { accountId, label: "Pendapatan Bunga", treatment: "revenue" };
    }

    // Invoice/customer receipt clears receivables. Do not credit revenue
    // again when the source document is an invoice or inbound payment.
    // Only use AR when the candidate is explicitly an invoice / customer receipt
    // (type = "invoice" | "customer_payment") OR when no candidate is selected
    // at all and the description is not interest-related.
    const arId = settings.ar_account_id ? Number(settings.ar_account_id) : null;
    if (arId) return { accountId: arId, label: "Piutang Usaha", treatment: "ar" };
    return null;
  }

  const isInterestTax =
    category === "interest_tax_withholding" ||
    subtype === "interest_tax_withholding";

  const isBankFee =
    !isInterestTax && (
      category === "bank_fee" ||
      subtype === "bank_charge" ||
      normalized.isBankFee
    );

  // A selected vendor/accounting payment means the bank mutation settles an
  // existing payable, so AP is correct for this specific candidate type.
  if (type === "vendor_payment" || type === "accounting_payment") {
    const apId = settings.ap_account_id ? Number(settings.ap_account_id) : null;
    if (apId) return { accountId: apId, label: "Hutang Usaha", treatment: "ap" };
    return null;
  }

  // Expense candidates may already carry their exact expense COA.
  if (type === "expense" && candidateId) {
    const companyWhere = companyId != null
      ? `(e.company_id = ${companyId} OR e.company_id IS NULL)`
      : "1 = 1";
    const { rows } = await client.execute(sql.raw(`
      SELECT COALESCE(e.expense_account_id, ec.expense_account_id) AS expense_account_id
      FROM expenses e
      LEFT JOIN expense_categories ec ON ec.id = e.category_id
      WHERE e.id = ${Number(candidateId)}
        AND ${companyWhere}
        AND e.status <> 'voided'
      LIMIT 1
    `)).catch(() => ({ rows: [] as any[] }));
    const expenseAccountId = rows[0] && (rows[0] as any).expense_account_id != null
      ? Number((rows[0] as any).expense_account_id)
      : null;
    if (expenseAccountId) {
      return { accountId: expenseAccountId, label: "Beban sesuai Expense", treatment: "expense" };
    }
  }

  // Deterministic semantic mappings for direct bank outflows.
  // FAIL-CLOSED (Task #6): no generic 5-2040 fallback. If the category
  // doesn't map to a specific COA prefix → return null so the caller
  // surfaces MANUAL_REVIEW_REQUIRED instead of posting to the wrong account.
  // Task #6: Only map to SPECIFIC, well-known expense codes.
  // "5-2040" (Beban Operasional Lain) is REMOVED as a generic catch-all —
  // unknown categories must go through manual review (return null → NEED_COA_MAPPING).
  const specificCode: string | null =
    isInterestTax ? "5-3044" :
    isBankFee ? "5-3010" :
    category === "utility_electricity" || category === "utility_water" || subtype === "utility" ? "5-2030" :
    category === "payroll" || subtype === "payroll" ? "5-2010" :
    type === "logistic_order" ? "5-1011" :
    null; // No generic "5-2040" fallback — specific COA required

  if (specificCode) {
    const accountId = await findCompanyCoa(client, companyId, specificCode);
    if (accountId) {
      const label =
        isInterestTax ? "Beban PPh Final atas Bunga Bank" :
        isBankFee ? "Beban Bunga & Administrasi Bank" :
        specificCode === "5-2030" ? "Beban Utilitas" :
        specificCode === "5-2010" ? "Beban Gaji & Tunjangan" :
        specificCode === "5-1011" ? "Biaya Pengiriman Langsung" :
        specificCode;
      return { accountId, label, treatment: "expense" };
    }
  }

  // Generic expense category falls back to the purchase_expense_account configured
  // in accounting settings.  This preserves prior behaviour: unknown-category direct
  // outflows that are explicitly labelled "expense" use the company's configured
  // expense account rather than requiring manual review.
  if (category === "expense") {
    const expenseId = settings.purchase_expense_account_id
      ? Number(settings.purchase_expense_account_id)
      : null;
    if (expenseId) return { accountId: expenseId, label: "Beban", treatment: "expense" };
  }

  // Task #6: No generic fallback to 5-2040 / "Beban Operasional Lain".
  // Returning null causes approveAndCreateJournal to reject the approval
  // with a typed error, keeping the mutation in a reviewable state.
  // Admins must configure a specific COA mapping before approval.
  logger.warn(
    { companyId, category, subtype, type: args.candidateType },
    "[FAIL-CLOSED] resolveContraAccount: kategori tidak dikenali — COA spesifik diperlukan (JOURNAL_MAPPING_REQUIRED)",
  );
  return null;
}

// ─── Scoring (max 100 pts) ────────────────────────────────────────────────────

export function scoreUnified(
  mutation: Pick<MutationInput, "amount" | "transaction_date" | "provider_order_id" | "uploaded_proof_url" | "normalized_description">,
  cand: MatchCandidate,
): UnifiedScoredMatch {
  let score = 0;
  const reason: string[] = [];

  // 1. Amount — MANDATORY for auto-approve (+50)
  const amountMatch = Math.abs(Number(cand.amount) - Number(mutation.amount)) < 0.01;
  if (amountMatch) { score += 50; reason.push("nominal cocok (+50)"); }

  // 2. Date ±1 day (+20)
  const mDate = new Date(mutation.transaction_date).getTime();
  const cDate = new Date(cand.date).getTime();
  const diffDays = Math.abs(mDate - cDate) / 86_400_000;
  const dateMatch = diffDays <= 1;
  if (diffDays === 0)     { score += 20; reason.push("tanggal sama (+20)"); }
  else if (diffDays <= 1) { score += 20; reason.push("tanggal beda 1 hari (+20)"); }

  // 3. Booking reference EXACT match (+20)
  let refMatch = false;
  if (cand.ref && mutation.provider_order_id) {
    if (cand.ref.toUpperCase().trim() === mutation.provider_order_id.toUpperCase().trim()) {
      refMatch = true; score += 20; reason.push(`referensi tepat "${cand.ref}" (+20)`);
    }
  }

  // 4. Proof match — boolean only: mutation has uploaded proof (+5)
  const ocrMatch = !!(mutation.uploaded_proof_url);
  if (ocrMatch) { score += 5; reason.push("bukti transfer tersedia (+5)"); }

  // 5. Vendor/counterparty name fuzzy match — token overlap (+10)
  let vendorMatch = false;
  if (cand.name && mutation.normalized_description) {
    const candNorm = cand.name.toLowerCase().replace(/[^a-z0-9]/g, " ").trim();
    const mutNorm  = mutation.normalized_description.toLowerCase().replace(/[^a-z0-9]/g, " ").trim();
    const candTokens = new Set(candNorm.split(/\s+/).filter(t => t.length > 2));
    const mutTokens  = mutNorm.split(/\s+/).filter(t => t.length > 2);
    if (candTokens.size > 0 && mutTokens.length > 0) {
      const overlapCount = mutTokens.filter(t => candTokens.has(t)).length;
      const ratio = overlapCount / Math.max(candTokens.size, mutTokens.length);
      if (ratio >= 0.4) {
        vendorMatch = true;
        score = Math.min(100, score + 10);
        reason.push(`nama vendor cocok (+10)`);
      }
    }
  }

  const confidence = Math.min(100, score);

  return {
    candidate: cand,
    score,
    reason,
    amount_match: amountMatch,
    date_match: dateMatch,
    ref_match: refMatch,
    ocr_match: ocrMatch,
    vendor_match: vendorMatch,
    confidence,
  };
}

// ─── Threshold classifier ─────────────────────────────────────────────────────
// Thresholds: ≥95 = high confidence auto, ≥80 = medium auto, ≥65 = manual review, <65 = unmatched

export function classifyMatch(s: UnifiedScoredMatch): "auto_matched" | "manual_review" | "unmatched" {
  if (s.score >= 90 && s.amount_match) return "auto_matched";
  if (s.score >= 80) return "auto_matched";
  if (s.score >= 65) return "manual_review";
  return "unmatched";
}

export function confidenceLabel(score: number): "high" | "medium" | "low" | "none" {
  if (score >= 95) return "high";
  if (score >= 90) return "high";
  if (score >= 80) return "medium";
  if (score >= 65) return "low";
  return "none";
}

// ─── Fetch candidates (amount-first filter) ───────────────────────────────────

export async function fetchCandidates(
  mutation: Pick<MutationInput, "amount" | "transaction_date" | "company_id" | "direction" | "bank_account_id" | "provider_order_id" | "provider_name" | "normalized_description">,
): Promise<MatchCandidate[]> {
  const candidates: MatchCandidate[] = [];
  const { amount, transaction_date, company_id } = mutation;
  const mutationBankAccountId = mutation.bank_account_id != null ? Number(mutation.bank_account_id) : null;
  const direction = String(mutation.direction ?? "IN").toUpperCase() === "OUT" ? "OUT" : "IN";
  const dateFrom = `'${transaction_date}'::date - 3`;
  const dateTo   = `'${transaction_date}'::date + 3`;
  const amtFilter = `ABS(##AMT##::numeric - ${Number(amount)}) < 0.01`;
  const mutationLooksQris =
    String(mutation.provider_name ?? "").toUpperCase() === "QRIS" ||
    isQrisSettlementDescription(mutation.normalized_description);
  // The aggregate tables may not exist yet on older runtime databases. Keep
  // the source query fail-safe and only add the aggregate candidate when both
  // tables are present.
  const qrisSettlementTablesAvailable = mutationLooksQris
    ? await db.execute(sql.raw(`
        SELECT to_regclass('public.qris_settlements') AS settlements,
               to_regclass('public.qris_settlement_items') AS items
      `)).then(({ rows }) => Boolean((rows[0] as any)?.settlements && (rows[0] as any)?.items))
      .catch(() => false)
    : false;
  const calculatedSportNet = "GREATEST(0, sp.amount - COALESCE(sp.mdr_amount, 0) - COALESCE(sp.tax_withheld_amount, 0) - COALESCE(sp.other_fee_amount, 0))";
  const verifiedSportNet = `(CASE
    WHEN COALESCE(sp.net_amount, 0) > 0
      AND COALESCE(sp.settlement_status, 'unsettled') NOT IN ('unsettled', 'pending')
    THEN sp.net_amount
    ELSE ${calculatedSportNet}
  END)`;
  const qrisAmountFilter = `(ABS(${verifiedSportNet}::numeric - ${Number(amount)}) < 0.01)`;
  const sportAmountFilter = mutationLooksQris
    ? qrisAmountFilter
    : `ABS(sp.amount::numeric - ${Number(amount)}) < 0.01`;
  const settlementDateExpr = `COALESCE(sp.settlement_date, COALESCE(sp.paid_at::date, sp.created_at::date) + 1)`;
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
  const canonicalSportPaymentExclusion =
    `AND ${sportPaymentCanonicalSettlementExclusionSql("sp")}`;

  // R5 fix: isolasi per perusahaan — hanya ambil kandidat dari company yang sama
  const coFilter = company_id ? `AND ##TBL##.company_id = ${Number(company_id)}` : "";

  const sources: Array<{
    q: string;
    type: CandidateType;
    candidateSource?: ReconciliationCandidateSource | null;
  }> = [
    {
      type: "accounting_payment",
      q: `
        SELECT ap.id, ap.amount,
               ap.date::text AS date,
               COALESCE(ap.partner_name, ap.memo, '') AS name,
               ap.ref AS ref
        FROM accounting_payments ap
        WHERE ${amtFilter.replace("##AMT##", "ap.amount")}
          AND ap.date BETWEEN ${dateFrom} AND ${dateTo}
          AND ap.status = 'posted'
          AND ap.payment_type = '${direction === "IN" ? "inbound" : "outbound"}'
          -- Sport Center payments are represented canonically by sport_payments.
          -- Their accounting_payments row is only the accounting/journal link;
          -- including it here would create a second candidate for one event.
          AND (ap.source_type IS NULL OR ap.source_type <> 'sport_center')
          ${coFilter.replace("##TBL##", "ap")}
      `,
    },
    {
      type: "logistic_order",
      q: `
        SELECT lo.id, lo.total_price AS amount,
               lo.created_at::date::text AS date,
               COALESCE(lo.sender_name, '') AS name,
               lo.order_number AS ref
        FROM logistic_orders lo
        WHERE ${amtFilter.replace("##AMT##", "lo.total_price")}
          AND '${direction}' = 'OUT'
          AND lo.created_at::date BETWEEN ${dateFrom} AND ${dateTo}
          ${coFilter.replace("##TBL##", "lo")}
      `,
    },
    {
      type: "invoice",
      q: `
        SELECT sd.id, sd.total_amount AS amount,
               sd.issue_date::text AS date,
               COALESCE(c.name, '') AS name,
               sd.doc_number AS ref
        FROM sales_documents sd
        LEFT JOIN customers c ON c.id = sd.customer_id
        WHERE sd.doc_type = 'invoice'
          AND '${direction}' = 'IN'
          AND ${amtFilter.replace("##AMT##", "sd.total_amount")}
          AND sd.issue_date BETWEEN ${dateFrom} AND ${dateTo}
          ${coFilter.replace("##TBL##", "sd")}
      `,
    },
    {
      type: "expense",
      q: `
        SELECT e.id, e.total AS amount,
               e.date::text AS date,
               COALESCE(e.description, '') AS name,
               e.expense_number AS ref
        FROM expenses e
        WHERE ${amtFilter.replace("##AMT##", "e.total")}
          AND '${direction}' = 'OUT'
          AND e.date BETWEEN ${dateFrom} AND ${dateTo}
          ${coFilter.replace("##TBL##", "e")}
      `,
    },
    {
      // sport_payment: filter per company + bank_account jika tersedia
      type: "sport_payment",
      q: `
        SELECT sp.id,
               ${mutationLooksQris ? verifiedSportNet : "sp.amount"} AS amount,
               ${settlementDateExpr}::text AS date,
               COALESCE(c.name, sb.customer_name, '') AS name,
               CONCAT('SPORT-', sp.booking_id::text) AS ref,
               sp.amount AS gross_amount,
               COALESCE(sp.mdr_amount, 0) AS mdr_amount,
               COALESCE(sp.tax_withheld_amount, 0) AS tax_withheld_amount,
               COALESCE(sp.other_fee_amount, 0) AS other_fee_amount,
               ${settlementDateExpr}::text AS settlement_date,
               sp.settlement_reference,
               sp.method AS payment_method,
               sp.settlement_status,
               1 AS settlement_item_count,
               (COALESCE(sp.settlement_status, 'unsettled') IN ('partial', 'partially_settled', 'partially-settled')) AS settlement_partial
        FROM sport_payments sp
        LEFT JOIN customers c ON c.id = sp.customer_id
        LEFT JOIN sport_bookings sb ON sb.id = sp.booking_id
        WHERE ${sportAmountFilter}
          AND '${direction}' = 'IN'
          ${company_id ? `AND sp.company_id = ${Number(company_id)}` : ""}
          AND ${settlementDateExpr} BETWEEN ${dateFrom} AND ${dateTo}
          AND sp.status = 'paid'
           AND (${mutationLooksQris ? "COALESCE(sp.method, '') ILIKE '%qris%'" : "TRUE"})
           ${aggregateMatchFilter}
           ${canonicalSportPaymentExclusion}
          AND (
            sp.bank_account_id IS NULL
            OR ${mutationBankAccountId != null ? `sp.bank_account_id = ${mutationBankAccountId}` : "TRUE"}
          )
      `,
    },
    ...(mutationLooksQris && qrisSettlementTablesAvailable ? [{
      type: "qris_settlement" as CandidateType,
      candidateSource: RECONCILIATION_CANDIDATE_SOURCES.LEGACY_QRIS,
      q: `
        SELECT qs.id,
               qs.net_amount AS amount,
               qs.settlement_date::text AS date,
               COALESCE(qs.settlement_reference, 'QRIS settlement') AS name,
               qs.settlement_reference AS ref,
               qs.gross_amount,
               qs.mdr_amount,
               qs.tax_withheld_amount,
               qs.other_fee_amount,
               qs.settlement_date::text AS settlement_date,
               qs.settlement_reference,
               'qris' AS payment_method,
               qs.status AS settlement_status,
               COUNT(qsi.id)::int AS settlement_item_count,
               (COALESCE(qs.status, 'unsettled') IN ('partial', 'partially_settled', 'partially-settled')) AS settlement_partial
        FROM qris_settlements qs
        LEFT JOIN qris_settlement_items qsi ON qsi.settlement_id = qs.id
        WHERE ABS(qs.net_amount::numeric - ${Number(amount)}) < 0.01
          AND '${direction}' = 'IN'
          AND qs.company_id = ${company_id ?? "NULL"}
          AND qs.settlement_date BETWEEN ${dateFrom} AND ${dateTo}
          AND COALESCE(qs.status, 'unsettled') NOT IN ('cancelled', 'reversed')
        GROUP BY qs.id
      `,
    }] : []),
    {
      type: "tenant_invoice",
      q: `
        SELECT ti.id, ti.total_amount AS amount,
               ti.created_at::date::text AS date,
               COALESCE(t.name, ti.tenant_name, '') AS name,
               ti.invoice_number AS ref
        FROM tenant_invoices ti
        LEFT JOIN tenants t ON t.id = ti.tenant_id
        WHERE ${amtFilter.replace("##AMT##", "ti.total_amount")}
          AND '${direction}' = 'IN'
          ${coFilter.replace("##TBL##", "ti")}
          AND ti.created_at::date BETWEEN ${dateFrom} AND ${dateTo}
      `,
    },
  ];

  for (const src of sources) {
    try {
      const { rows } = await db.execute(sql.raw(src.q));
      for (const r of rows as any[]) {
        candidates.push({
          id: Number(r.id),
          type: src.type,
          candidateSource: src.candidateSource ?? null,
          amount: Number(r.amount),
          date: String(r.date ?? ""),
          name: r.name ?? null,
          ref: r.ref ?? null,
          gross_amount: r.gross_amount != null ? Number(r.gross_amount) : null,
          mdr_amount: r.mdr_amount != null ? Number(r.mdr_amount) : null,
          tax_withheld_amount: r.tax_withheld_amount != null ? Number(r.tax_withheld_amount) : null,
          other_fee_amount: r.other_fee_amount != null ? Number(r.other_fee_amount) : null,
          settlement_date: r.settlement_date ? String(r.settlement_date) : null,
          settlement_reference: r.settlement_reference ? String(r.settlement_reference) : null,
          settlement_status: r.settlement_status ? String(r.settlement_status) : null,
          payment_method: r.payment_method ? String(r.payment_method) : null,
          settlement_item_count: r.settlement_item_count != null ? Number(r.settlement_item_count) : null,
          settlement_partial: Boolean(r.settlement_partial),
        });
      }
    } catch (e: any) {
      logger.warn({ err: e.message, type: src.type }, "[unifiedMatchingEngine] fetchCandidates: source skipped");
    }
  }

  return candidates;
}

// ─── Audit helper ─────────────────────────────────────────────────────────────

async function writeReconAudit(
  mutationId: number | null,
  action: string,
  actor: string,
  meta: Record<string, unknown>,
): Promise<void> {
  try {
    await db.execute(sql.raw(`
      INSERT INTO bank_reconciliation_audit (mutation_id, action, actor, meta)
      VALUES (${mutationId ?? "NULL"}, '${action.replace(/'/g, "''")}',
              '${actor.replace(/'/g, "''")}',
              '${JSON.stringify(meta).replace(/'/g, "''")}')
    `));
  } catch {}
}

// ─── Main orchestrator ────────────────────────────────────────────────────────

/**
 * runUnifiedMatching — fetch candidates, score, save to bank_reconciliation_matches.
 * Updates bank_mutations.status to 'matched' or 'unmatched'.
 * For auto_matched: also marks the best match as 'approved' in bank_reconciliation_matches.
 * Journal creation is NOT done here — always deferred to approveAndCreateJournal().
 */
export async function runUnifiedMatching(
  mutation: MutationInput,
  actor: string,
): Promise<UnifiedMatchResult> {
  const candidates = await fetchCandidates(mutation); // company_id sudah diteruskan via mutation

  if (!candidates.length) {
    await db.execute(sql.raw(
      `UPDATE bank_mutations SET status = 'unmatched', updated_at = NOW() WHERE id = ${mutation.id}`,
    )).catch(() => {});
    await writeReconAudit(mutation.id, "MATCH_CREATED", actor, { count: 0, status: "unmatched" });

    // Auto-classify expense when no match found and direction is OUT
    // This runs in background (fire-and-forget) — does not block reconciliation response
    if (mutation.direction === "OUT" && mutation.normalized_description) {
      classifyMutationDescription({
        description: mutation.normalized_description,
        amount: mutation.amount,
        direction: "OUT",
        companyId: mutation.company_id ?? null,
        useAi: true,
      })
        .then(result => persistClassification(mutation.id, result))
        .catch(err => logger.warn(
          { err: err.message, mutationId: mutation.id },
          "[unifiedMatchingEngine] auto-classify failed (non-fatal)",
        ));
    }

    return { status: "unmatched", all: [] };
  }

  const scored = candidates
    .map(c => scoreUnified(mutation, c))
    .sort((a, b) => b.score - a.score);

  // Persist all candidate scores
  for (const s of scored) {
    await db.execute(sql.raw(`
      INSERT INTO bank_reconciliation_matches
        (mutation_id, candidate_type, candidate_id, match_score, match_reason,
         amount_match, date_match, name_match, order_id_match, proof_match, status,
         candidate_source)
      VALUES
        (${mutation.id}, '${s.candidate.type}', ${s.candidate.id}, ${s.score},
         '${s.reason.join("; ").replace(/'/g, "''")}',
         ${s.amount_match}, ${s.date_match}, false, ${s.ref_match}, ${s.ocr_match},
         'candidate',
         ${s.candidate.candidateSource ? `'${s.candidate.candidateSource}'` : "NULL"})
      ON CONFLICT DO NOTHING
    `)).catch(() => {});
  }

  const best = scored[0];
  const classification = classifyMatch(best);

  await writeReconAudit(mutation.id, "MATCH_CREATED", actor, {
    count: scored.length,
    best_score: best.score,
    best_type: best.candidate.type,
    best_id: best.candidate.id,
    classification,
    amount_match: best.amount_match,
  });

  if (classification === "auto_matched") {
    // Mark best candidate as approved in matches table
    await db.execute(sql.raw(`
      UPDATE bank_reconciliation_matches
      SET status = 'approved'
      WHERE mutation_id = ${mutation.id}
        AND candidate_type = '${best.candidate.type}'
        AND candidate_id = ${best.candidate.id}
        AND candidate_source IS NOT DISTINCT FROM ${best.candidate.candidateSource ? `'${best.candidate.candidateSource}'` : "NULL"}
    `)).catch(() => {});
    // Set mutation status to 'matched' — journal will be created by approval gate
    await db.execute(sql.raw(
      `UPDATE bank_mutations SET status = 'matched', updated_at = NOW() WHERE id = ${mutation.id}`,
    )).catch(() => {});
    logger.info({ mutationId: mutation.id, score: best.score }, "[unifiedMatchingEngine] auto_matched");
  } else if (classification === "manual_review") {
    await db.execute(sql.raw(
      `UPDATE bank_mutations SET status = 'matched', updated_at = NOW() WHERE id = ${mutation.id}`,
    )).catch(() => {});
  }

  return { status: classification, best, all: scored };
}

// ─── Journal creation after approval ─────────────────────────────────────────

/**
 * approveAndCreateJournal — SINGLE ENTRY POINT untuk reconciliation approval.
 *
 * ALL steps run inside ONE db.transaction():
 *   1. SELECT FOR UPDATE — acquires row lock (prevents double-click / concurrent approve)
 *   2. Guard: already approved / existing approved match check
 *   3. Resolve bank COA + contra account (AR/AP) + bank journal
 *   4. postEntryWithClient — handles: period lock (BLOCKING throw), balance validation,
 *      sequence number (RECON/YYYY/NNNNNN), header+lines INSERT, idempotency, checksum
 *   5. UPDATE bank_mutations: status='approved' + journal_entry_id (ATOMIC — no .catch)
 *   6. UPDATE / INSERT bank_reconciliation_matches (approved)
 *   7. INSERT bank_reconciliation_audit (inside tx — no .catch: must succeed or rollback)
 *   → COMMIT or full ROLLBACK if any step throws
 *
 * Period lock: enforced by _postEntryCore — throws PERIOD_CLOSED for closed periods.
 * Auto-post intentionally disabled — admin must post the draft journal.
 */

/**
 * Translate a raw PostgreSQL / trigger error into a user-friendly Indonesian message.
 * The raw message is logged separately; only the friendly string is shown to the user.
 */
function mapDbErrorToUserMessage(rootMsg: string, originalError: any): string {
  // PostgreSQL error code lives on the cause object (Drizzle unwrap) or the error itself.
  const pgCode: string | undefined =
    originalError?.cause?.code ?? originalError?.code;

  // 23505 — unique_violation (duplicate key)
  if (pgCode === "23505") {
    return "Jurnal untuk mutasi ini sudah ada. Silakan refresh halaman.";
  }

  // 23503 — foreign_key_violation (invalid COA or related record)
  if (pgCode === "23503") {
    return "Akun COA tidak valid. Pastikan kode akun benar.";
  }

  // P0001 — raise_exception (custom trigger / function errors)
  if (pgCode === "P0001") {
    if (rootMsg.includes("IMMUTABILITY_VIOLATION")) {
      return "Jurnal sudah diposting dan tidak bisa diubah. Gunakan reversal untuk koreksi.";
    }
    if (rootMsg.includes("PERIOD_CLOSED")) {
      return "Periode keuangan sudah ditutup. Gunakan entri di periode baru.";
    }
  }

  // Trigger message strings (some DBs surface via message, not code)
  if (rootMsg.includes("IMMUTABILITY_VIOLATION") || rootMsg.includes("immutability")) {
    return "Jurnal sudah diposting dan tidak bisa diubah. Gunakan reversal untuk koreksi.";
  }
  if (rootMsg.includes("PERIOD_CLOSED") || rootMsg.includes("period is closed")) {
    return "Periode keuangan sudah ditutup. Gunakan entri di periode baru.";
  }
  if (rootMsg.includes("duplicate key") || rootMsg.includes("unique constraint")) {
    return "Jurnal untuk mutasi ini sudah ada. Silakan refresh halaman.";
  }
  if (rootMsg.includes("foreign key") || rootMsg.includes("violates foreign key")) {
    return "Akun COA tidak valid. Pastikan kode akun benar.";
  }

  // Fallback: generic but still non-technical
  return "Terjadi kesalahan saat membuat jurnal. Silakan coba lagi atau hubungi tim teknis.";
}

export async function approveAndCreateJournal(
  mutationId: number,
  matchId: number | null,
  candidateType: string | null,
  candidateId: number | null,
  actor: string,
  note?: string,
  /** COA code explicitly chosen by user after a JOURNAL_MAPPING_REQUIRED error.
   *  When provided, bypasses resolveContraAccount and uses this account directly. */
  manualCoaCode?: string | null,
  candidateSource: ReconciliationCandidateSource | null = null,
): Promise<{ ok: boolean; journalEntryId: number | null; error?: string; manual_review_required?: true; code?: string }> {

  let journalEntryId: number | null = null;
  let journalEntryNumber = "";

  try {
    const txResult = await db.transaction(async (tx) => {

       // ── Step 1: Lock mutation row (FOR UPDATE inside tx = real row lock) ──
      const { rows: locked } = await tx.execute(sql.raw(`
        SELECT bm.id, bm.status, bm.amount, bm.direction,
               bm.transaction_date, bm.description, bm.mutation_key,
                bm.company_id, bm.bank_account_id,
                bm.expense_category, bm.expense_suggested_account_subtype
        FROM bank_mutations bm
        WHERE bm.id = ${mutationId}
        FOR UPDATE
      `));
      if (!locked.length) {
        throw Object.assign(new Error("Mutasi tidak ditemukan"), { code: "NOT_FOUND" });
      }
      const mut = locked[0] as Record<string, unknown>;

      const companyId   = mut["company_id"]     != null ? Number(mut["company_id"])     : null;
      const bankAccId   = mut["bank_account_id"] != null ? Number(mut["bank_account_id"]) : null;
      const txDate      = String(mut["transaction_date"] ?? "").split("T")[0];
      const amount      = Number(mut["amount"]);
      const direction   = String(mut["direction"] ?? "IN");

       // A match row is the source of truth. Do not let a stale or tampered
       // browser payload change the candidate selected by the reviewer.
       let selectedCandidateType = candidateType;
       let selectedCandidateId = candidateId;
       let selectedCandidateSource = candidateSource;
       if (matchId) {
         const { rows: matchRows } = await tx.execute(sql.raw(`
           SELECT id, candidate_type, candidate_id, candidate_source
           FROM bank_reconciliation_matches
           WHERE id = ${Number(matchId)} AND mutation_id = ${mutationId}
           FOR UPDATE
         `));
         if (!matchRows.length) {
           throw Object.assign(
             new Error("Kandidat rekonsiliasi tidak ditemukan untuk mutasi ini"),
             { code: "INVALID_MATCH" },
           );
         }
         selectedCandidateType = String((matchRows[0] as any).candidate_type ?? "");
         selectedCandidateId = Number((matchRows[0] as any).candidate_id);
          selectedCandidateSource = (matchRows[0] as any).candidate_source ?? null;
       }

       const selectedType = canonicalCandidateType(selectedCandidateType);
       const allowedCandidateTypes = new Set([
         "accounting_payment",
         "logistic_order",
         "invoice",
         "expense",
         "sport_payment",
        "qris_settlement",
         "tenant_invoice",
       ]);
       if (selectedType && !allowedCandidateTypes.has(selectedType)) {
         throw Object.assign(new Error("Tipe kandidat rekonsiliasi tidak valid"), { code: "INVALID_MATCH" });
       }

       // ── Step 2: Guard — idempotency and conflicting approved match ────────
       if (mut["status"] === "approved" || mut["status"] === "posted") {
         throw Object.assign(new Error("Mutasi sudah diproses sebelumnya"), { code: "CONFLICT" });
       }
       const { rows: existingApproval } = await tx.execute(sql.raw(`
         SELECT id FROM bank_reconciliation_matches
         WHERE mutation_id = ${mutationId} AND status = 'approved'
         LIMIT 2
       `));
       const differentApproval = (existingApproval as any[]).find(
         (row) => Number(row.id) !== Number(matchId),
       );
       if (differentApproval) {
         throw Object.assign(
           new Error("Kandidat lain sudah di-approve untuk mutasi ini"),
           { code: "CONFLICT" },
         );
       }

        // Phase 4C-4: candidate generation can race with canonical settlement
        // posting. Revalidate the source payment while the approval transaction
        // is still open, before any journal or bank mutation changes.
        if (selectedType === "sport_payment" && selectedCandidateId != null) {
          const alreadySettled = await isSportPaymentInActiveCanonicalSettlement(
            tx as unknown as DbClient,
            selectedCandidateId,
          );
          if (alreadySettled) {
            throw Object.assign(
              new Error(
                "Sport Center payment already belongs to an active canonical settlement",
              ),
              { code: SPORT_PAYMENT_ALREADY_IN_CANONICAL_SETTLEMENT },
            );
          }
        }

      // ── Step 3: Resolve bank COA + contra account + journal ───────────────
      // Bank COA: company_bank_accounts.coa_id WHERE id = bank_account_id
      let bankCoaId: number | null = null;
      if (bankAccId) {
        const { rows: cbaRows } = await tx.execute(sql.raw(`
          SELECT coa_id FROM company_bank_accounts WHERE id = ${bankAccId} LIMIT 1
        `)).catch(() => ({ rows: [] as any[] }));
        bankCoaId = (cbaRows[0] as any)?.coa_id ? Number((cbaRows[0] as any).coa_id) : null;
      }

       let contraCoaId: number | null = null;
       let contraLabel = "";
       let contraTreatment: ContraResolution["treatment"] | null = null;
       let journalId:   number | null = null;
       let settings: Record<string, unknown> = {};

      if (companyId) {
        const { rows: settRows } = await tx.execute(sql.raw(`
           SELECT default_bank_account_id, ar_account_id, ap_account_id,
                  purchase_expense_account_id, bank_journal_id
          FROM accounting_settings WHERE company_id = ${companyId} LIMIT 1
        `)).catch(() => ({ rows: [] as any[] }));
        const sett = (settRows[0] as any) ?? {};
         settings = sett;

        if (!bankCoaId && sett.default_bank_account_id) {
          bankCoaId = Number(sett.default_bank_account_id);
        }
        journalId = sett.bank_journal_id ? Number(sett.bank_journal_id) : null;
      }

       // ── Universal Journal Reuse Engine (Phase 7) ─────────────────────────
       // Determines whether an existing posted journal should be reused,
       // a new one created, or the mutation flagged for manual review.
       // FAIL CLOSED: any lookup error → MANUAL_REVIEW_REQUIRED, never silent empty.
       // The engine handles ALL candidate types; no inline queries here.
       let reusedEntry: { id: number; entryNumber: string } | null = null;

       const reuseResolution = await resolveJournalForEconomicEvent(
         tx as unknown as DbClient,
         {
           companyId,
           candidateType: selectedCandidateType,
           candidateId: selectedCandidateId,
            candidateSource: selectedCandidateSource,
           mutationId,
           mutationAmount: amount,
           mutationDate: txDate,
         },
       );

       logger.info(
         { mutationId, candidateType: selectedCandidateType, candidateId: selectedCandidateId,
           decision: reuseResolution.decision, confidence: reuseResolution.confidence,
           reasons: reuseResolution.reasons },
         "[approveAndCreateJournal] JournalReuseEngine decision",
       );

       if (reuseResolution.decision === "REJECT_DUPLICATE") {
         throw Object.assign(
           new Error(
             `Duplikat economic event terdeteksi: jurnal ${reuseResolution.existingJournalNumber ?? reuseResolution.existingJournalId} ` +
             `sudah terhubung ke mutasi bank lain. ${reuseResolution.reasons[0] ?? ""}`,
           ),
           { code: JournalReuseErrorCode.ECONOMIC_EVENT_DUPLICATE },
         );
       }

       if (reuseResolution.decision === "MANUAL_REVIEW_REQUIRED") {
         throw new JournalMappingError(
           "JOURNAL_MAPPING_REQUIRED",
           `Rekonsiliasi memerlukan review manual: ${reuseResolution.reasons[0] ?? "ambiguous economic event"}. ` +
           `Periksa jurnal yang ada sebelum melanjutkan.`,
           { mutationId, code: reuseResolution.evidence["code"] ?? JournalReuseErrorCode.MANUAL_REVIEW_REQUIRED },
         );
       }

       if (reuseResolution.decision === "REUSE_EXISTING_JOURNAL" &&
           reuseResolution.existingJournalId != null) {
         reusedEntry = {
           id: reuseResolution.existingJournalId,
           entryNumber: reuseResolution.existingJournalNumber ?? "",
         };
       }
       // decision === "CREATE_NEW_JOURNAL": reusedEntry stays null → fall through to new journal path

       if (reusedEntry) {
         await tx.execute(sql.raw(`
           UPDATE bank_mutations
           SET status = 'posted',
               journal_entry_id = ${reusedEntry.id},
               approved_by = '${escapeSql(actor)}',
               approved_at = NOW(),
               posted_by = '${escapeSql(actor)}',
               posted_at = NOW(),
               updated_at = NOW()
           WHERE id = ${mutationId}
         `));

         // Promote draft accounting entry → posted.
         // Upstream modules (sport center, payroll, etc.) create journal entries in
         // 'draft' status as provisional records.  Bank reconciliation approval is
         // the authoritative confirmation; we upgrade the status here so the entry
         // appears in Trial Balance and other posted-only views.
         // WHERE status = 'draft' makes this a safe no-op when reusing a fully-posted journal.
         await tx.execute(sql.raw(`
           UPDATE accounting_entries
           SET status = 'posted',
               posted_at = NOW()
           WHERE id = ${reusedEntry.id}
             AND status = 'draft'
         `));

         if (matchId) {
           await tx.execute(sql.raw(`
             UPDATE bank_reconciliation_matches
             SET status = 'approved'
             WHERE id = ${Number(matchId)} AND mutation_id = ${mutationId}
           `));
         } else if (selectedCandidateType && selectedCandidateId) {
           await tx.execute(sql.raw(`
             INSERT INTO bank_reconciliation_matches
               (mutation_id, candidate_type, candidate_id, match_score, match_reason,
                amount_match, date_match, name_match, order_id_match, proof_match, status,
                candidate_source)
             VALUES
               (${mutationId}, '${escapeSql(selectedCandidateType)}', ${Number(selectedCandidateId)},
                100, 'existing posted source journal reused', true, false, false, false, false, 'approved',
                ${selectedCandidateSource ? `'${escapeSql(selectedCandidateSource)}'` : "NULL"})
             ON CONFLICT DO NOTHING
           `));
         }

         const reuseMeta = JSON.stringify({
           match_id: matchId,
           candidate_type: selectedCandidateType,
           candidate_id: selectedCandidateId,
           candidate_source: selectedCandidateSource,
           journal_entry_id: reusedEntry.id,
           reused_existing_entry: true,
           direction,
         }).replace(/'/g, "''");
         await tx.execute(sql.raw(`
           INSERT INTO bank_reconciliation_audit (mutation_id, action, actor, meta)
           VALUES (${mutationId}, 'MATCH_APPROVED', '${escapeSql(actor)}', '${reuseMeta}')
         `));

         return {
           txJournalEntryId: reusedEntry.id,
           entryNumber: reusedEntry.entryNumber,
         };
       }

       // ── Manual COA override (user picked an account after JOURNAL_MAPPING_REQUIRED) ──
       if (manualCoaCode?.trim()) {
         const manualId = await findCompanyCoa(tx as unknown as DbClient, companyId, manualCoaCode.trim());
         if (!manualId) {
           throw new JournalMappingError(
             "COA_NOT_FOUND",
             `Akun COA "${manualCoaCode}" tidak ditemukan atau tidak aktif di perusahaan ini.`,
             { mutationId, manualCoaCode },
           );
         }
         contraCoaId     = manualId;
         contraLabel     = `Akun dipilih manual: ${manualCoaCode}`;
         contraTreatment = "expense";
         logger.info({ mutationId, manualCoaCode, contraCoaId }, "[approveAndCreateJournal] manual COA override applied");
       } else {
         const contra = await resolveContraAccount(tx as unknown as DbClient, {
           direction,
           companyId,
           bankAccountId: bankAccId,
           candidateType: selectedCandidateType,
           candidateId: selectedCandidateId,
           description: String(mut["description"] ?? ""),
           expenseCategory: (mut["expense_category"] as string | null) ?? null,
           expenseSubtype: (mut["expense_suggested_account_subtype"] as string | null) ?? null,
           settings,
         });
         contraCoaId     = contra?.accountId ?? null;
         contraLabel     = contra?.label ?? "";
         contraTreatment = contra?.treatment ?? null;
       }

      // Fallback journal: query by type/name when bank_journal_id not set
      if (!journalId) {
        const { rows: jRows } = await tx.execute(sql.raw(`
          SELECT id FROM accounting_journals
          WHERE ${companyId ? `company_id = ${companyId}` : "company_id IS NULL"}
            AND (LOWER(name) LIKE '%bank%' OR LOWER(code) LIKE '%bank%' OR type = 'bank')
          ORDER BY id ASC LIMIT 1
        `)).catch(() => ({ rows: [] as any[] }));
        journalId = (jRows[0] as any)?.id ? Number((jRows[0] as any).id) : null;
      }

      if (!bankCoaId) {
        throw new JournalMappingError(
          "COA_NOT_FOUND",
          "Akun bank/kas tidak ditemukan. Konfigurasikan 'Default Bank Account' di Accounting Settings.",
          { mutationId, bankAccountId: bankAccId },
        );
      }
      if (!contraCoaId) {
        throw new JournalMappingError(
          "JOURNAL_MAPPING_REQUIRED",
           direction === "IN"
             ? "Akun piutang (AR) tidak dikonfigurasi di Accounting Settings."
             : "Akun beban/utang untuk transaksi ini tidak ditemukan. Konfigurasikan COA beban atau pilih kandidat expense/vendor yang valid.",
          { mutationId, direction },
        );
      }
      if (!journalId) {
        throw new JournalMappingError(
          "JOURNAL_MAPPING_REQUIRED",
          "Jurnal bank tidak ditemukan. Buat jurnal bertipe 'bank' atau konfigurasikan 'Bank Journal' di Accounting Settings.",
          { mutationId },
        );
      }

       // ── Step 4: Build double-entry lines + post via canonical engine ──────
       //   Bank IN:  DEBIT bank COA,   CREDIT AR/revenue
       //   Bank OUT: DEBIT expense/AP, CREDIT bank COA
      const lineDesc = note ?? `Rekon ${direction} ${String(mut["mutation_key"] ?? "").slice(0, 60)}`;
      const lines: PostingLine[] = direction === "IN"
        ? [
            { accountId: bankCoaId,   debit: amount, credit: 0,      description: lineDesc },
            { accountId: contraCoaId, debit: 0,      credit: amount,  description: lineDesc },
          ]
        : [
            { accountId: contraCoaId, debit: amount, credit: 0,      description: lineDesc },
            { accountId: bankCoaId,   debit: 0,      credit: amount,  description: lineDesc },
          ];

      // postEntryWithClient handles: period lock (throws PERIOD_CLOSED if closed),
      // balance validation (throws if debit ≠ credit), sequence number, header+lines
      // INSERT, idempotency (source=bank_reconciliation + sourceId=mutationId),
      // checksum hash, ledger event (fire-and-forget via global db — never poisons tx).
      const entry = await postEntryWithClient(
        tx as unknown as DbClient,
        {
          journalId,
          date:        new Date(txDate),
          ref:         String(mut["mutation_key"] ?? "").slice(0, 100),
          description: String(mut["description"] ?? "").slice(0, 200),
           expenseCategory: contraTreatment === "expense"
             ? String(mut["expense_category"] ?? "bank_reconciliation_expense")
             : null,
          source:      "bank_reconciliation",
          sourceId:    mutationId,
          companyId:   companyId ?? undefined,
          createdById: actor,
          lines,
        },
        "RECON",
        "draft",   // Admin must explicitly post — auto-post disabled
      );

      // ── Step 5: Update mutation ATOMICALLY (inside tx, no .catch) ─────────
      // Status = approved_pending_posting (NOT 'approved') — journal is still
      // a draft. Admin must call POST /:id/post to promote to final posted state.
      await tx.execute(sql.raw(`
        UPDATE bank_mutations
        SET status           = 'approved_pending_posting',
            journal_entry_id = ${entry.id},
            approved_by      = '${actor.replace(/'/g, "''")}',
            approved_at      = NOW(),
            updated_at       = NOW()
        WHERE id = ${mutationId}
      `));

      // ── Step 6: Update/insert approved match record ────────────────────────
      if (matchId) {
        await tx.execute(sql.raw(`
          UPDATE bank_reconciliation_matches
          SET status = 'approved'
          WHERE id = ${matchId} AND mutation_id = ${mutationId}
        `));
       } else if (selectedCandidateType && selectedCandidateId) {
        await tx.execute(sql.raw(`
          INSERT INTO bank_reconciliation_matches
            (mutation_id, candidate_type, candidate_id, match_score, match_reason,
             amount_match, date_match, name_match, order_id_match, proof_match, status,
             candidate_source)
          VALUES
             (${mutationId}, '${escapeSql(selectedCandidateType)}', ${Number(selectedCandidateId)},
             100, 'manual approve', true, false, false, false, false, 'approved',
             ${selectedCandidateSource ? `'${escapeSql(selectedCandidateSource)}'` : "NULL"})
          ON CONFLICT DO NOTHING
        `));
      }

      // ── Step 7: Audit log inside transaction — NO .catch() ────────────────
      // Must succeed or the entire transaction rolls back. This ensures we never
      // commit an approval without a corresponding audit trail.
      const auditMeta = JSON.stringify({
        match_id:         matchId,
         candidate_type:   selectedCandidateType,
         candidate_id:     selectedCandidateId,
        journal_entry_id: entry.id,
        entry_number:     entry.entryNumber,
        bank_coa_id:      bankCoaId,
        contra_coa_id:    contraCoaId,
         contra_label:     contraLabel,
         contra_treatment: contraTreatment,
        amount,
        direction,
        note:             note ?? null,
      }).replace(/'/g, "''");
      await tx.execute(sql.raw(`
        INSERT INTO bank_reconciliation_audit (mutation_id, action, actor, meta)
        VALUES (${mutationId}, 'MATCH_APPROVED', '${actor.replace(/'/g, "''")}', '${auditMeta}')
      `));

      return { txJournalEntryId: entry.id, entryNumber: entry.entryNumber };
    });

    journalEntryId     = txResult.txJournalEntryId;
    journalEntryNumber = txResult.entryNumber;

  } catch (e: any) {
    // captureFailedJob runs OUTSIDE tx — always fires even after rollback
    // Drizzle v0.45+ wraps DB errors as DrizzleError { message: "Failed query: <SQL>", cause: <pgError> }.
    // Unwrap to expose the real PostgreSQL message (e.g. "duplicate key", trigger exceptions).
    const rootMsg: string =
      (e as any)?.cause?.message ?? e.message ?? String(e);

    captureFailedJob(
      "reconciliation_approval",
      { mutationId, matchId, candidateType, candidateId, actor },
      rootMsg,
    ).catch(() => {});
    logger.error({ err: rootMsg, drizzleMsg: e.message, mutationId }, "[approveAndCreateJournal] transaction rolled back");

    // JournalMappingError must propagate its typed code and manual_review_required
    // to the route so it can return 422 instead of swallowing it as a generic 400.
    if (e instanceof JournalMappingError) {
      return {
        ok: false,
        journalEntryId: null,
        error: e.message,
        manual_review_required: true as const,
        code: e.code,
      };
    }

    if (e?.code === SPORT_PAYMENT_ALREADY_IN_CANONICAL_SETTLEMENT) {
      return {
        ok: false,
        journalEntryId: null,
        error: e.message,
        code: e.code,
      };
    }

    // Map raw PostgreSQL / trigger error codes to user-friendly Indonesian messages.
    const userFriendlyError = mapDbErrorToUserMessage(rootMsg, e);
    return { ok: false, journalEntryId: null, error: userFriendlyError };
  }

  // ── Post-commit: fire-and-forget side effects (use global db — outside tx) ──
  writeReconAudit(mutationId, "JOURNAL_CREATED", actor, {
    journal_entry_id: journalEntryId,
    entry_number:     journalEntryNumber,
  }).catch(() => {});

  logger.info(
    { mutationId, journalEntryId, entryNumber: journalEntryNumber, actor },
    "[approveAndCreateJournal] success — all steps committed",
  );

  return { ok: true, journalEntryId };
}
