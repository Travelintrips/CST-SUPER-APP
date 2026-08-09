import { db } from "@workspace/db";
import { sql } from "drizzle-orm";
import {
  generateQrisMutationBatchCandidates,
  type QrisMutationBatchCandidate,
  type QrisMutationCandidateInput,
  type QrisPaymentCandidateInput,
} from "./qrisCandidateEngine.js";
import {
  expectedQrisSettlementDate,
  normalizeQrisProvider,
  providerRulesByBankAccountFromRows,
  providerRulesFromRows,
} from "./providerSettlementRules.js";

function esc(value: unknown): string {
  return String(value ?? "").replace(/'/g, "''");
}

function asDate(value: unknown): string | null {
  const result = String(value ?? "").slice(0, 10);
  return /^\d{4}-\d{2}-\d{2}$/.test(result) ? result : null;
}

export interface QrisCandidateGenerationResult {
  dryRun: boolean;
  generated: number;
  candidates: QrisMutationBatchCandidate[];
}

export async function generateQrisCandidates(options: {
  companyId?: number | null;
  from?: string | null;
  to?: string | null;
  dryRun?: boolean;
} = {}): Promise<QrisCandidateGenerationResult> {
  const companyFilter = options.companyId && Number.isInteger(options.companyId)
    ? `AND sp.company_id = ${Number(options.companyId)}`
    : "";
  const mutationCompanyFilter = options.companyId && Number.isInteger(options.companyId)
    ? `AND bm.company_id = ${Number(options.companyId)}`
    : "";
  const dateFilter = options.from ? `AND bm.transaction_date >= '${esc(options.from)}'` : "";
  const toFilter = options.to ? `AND bm.transaction_date <= '${esc(options.to)}'` : "";

  const [paymentRows, mutationRows, holidayRows, ruleRows, existingRows] = await Promise.all([
    db.execute(sql.raw(`
      SELECT
        sp.id, sp.company_id, sp.amount, sp.method, sp.status, sp.paid_at,
        sp.payment_number, sp.booking_id, sb.booking_number,
        sp.provider_code, sp.settlement_date, sp.settlement_rule_version,
        sp.settlement_reference, sp.bank_account_id,
        EXISTS (
          SELECT 1 FROM qris_settlement_items qsi
          WHERE qsi.sport_payment_id = sp.id
        ) AS already_reconciled
      FROM sport_payments sp
      LEFT JOIN sport_bookings sb ON sb.id = sp.booking_id
      WHERE LOWER(COALESCE(sp.method, '')) LIKE '%qris%'
        AND LOWER(COALESCE(sp.status, '')) = 'paid'
        ${companyFilter}
    `)),
    db.execute(sql.raw(`
      SELECT
        bm.id, bm.company_id, bm.bank_account_id, bm.transaction_date, bm.amount,
        bm.direction, bm.source, bm.source_classification, bm.provider_name,
        bm.provider_order_id, bm.description, bm.status
      FROM bank_mutations bm
      WHERE bm.direction = 'IN'
        AND COALESCE(bm.source_classification, 'unknown') <> 'synthetic'
        AND LOWER(COALESCE(bm.status, 'unmatched')) NOT IN
          ('posted', 'approved', 'approved_pending_posting', 'void')
        ${mutationCompanyFilter}
        ${dateFilter}
        ${toFilter}
      ORDER BY bm.transaction_date, bm.id
    `)),
    db.execute(sql.raw(`
      SELECT holiday_date
      FROM qris_business_calendar_holidays
      WHERE is_active = TRUE
        AND (company_id IS NULL OR company_id = ${options.companyId ? Number(options.companyId) : "0"})
    `)).catch(() => ({ rows: [] as unknown[] })),
    db.execute(sql.raw(`
      SELECT company_id, bank_account_id, provider_code, rule_version,
             settlement_delay_business_days, match_window_business_days,
             max_effective_deduction_rate
      FROM qris_provider_settlement_rules
      WHERE is_active = TRUE
        AND (company_id IS NULL OR company_id = ${options.companyId ? Number(options.companyId) : "0"})
    `)).catch(() => ({ rows: [] as unknown[] })),
    db.execute(sql.raw(`
      SELECT mutation_id
      FROM qris_mutation_batch_candidates
    `)).catch(() => ({ rows: [] as unknown[] })),
  ]);

  const holidays = (holidayRows.rows as Array<Record<string, unknown>>)
    .map((row) => asDate(row.holiday_date))
    .filter((value): value is string => Boolean(value));
  const rules = providerRulesFromRows(ruleRows.rows as Array<Record<string, unknown>>);
  const accountRules = providerRulesByBankAccountFromRows(
    ruleRows.rows as Array<Record<string, unknown>>,
  );

  const payments: QrisPaymentCandidateInput[] = (paymentRows.rows as Array<Record<string, unknown>>).map((row) => {
    const providerCode = normalizeQrisProvider(String(row.provider_code ?? "unknown"));
    const providerRule = accountRules[String(row.bank_account_id)]?.[providerCode]
      ?? rules[providerCode];
    return {
      id: Number(row.id),
      companyId: row.company_id == null ? null : Number(row.company_id),
      bankAccountId: row.bank_account_id == null ? null : Number(row.bank_account_id),
      amount: Number(row.amount ?? 0),
      method: String(row.method ?? ""),
      status: String(row.status ?? ""),
      paidAt: row.paid_at as string | null,
      expectedSettlementDate: asDate(row.settlement_date)
        ?? expectedQrisSettlementDate(row.paid_at as string, providerCode, holidays, providerRule),
      settlementRuleVersion: row.settlement_rule_version == null
        ? providerRule?.ruleVersion ?? "legacy-v1"
        : String(row.settlement_rule_version),
      providerName: providerCode,
      providerReference: row.settlement_reference == null ? null : String(row.settlement_reference),
      paymentNumber: row.payment_number == null ? null : String(row.payment_number),
      bookingId: row.booking_id == null ? null : Number(row.booking_id),
      bookingNumber: row.booking_number == null ? null : String(row.booking_number),
      paymentDate: row.paid_at == null
        ? null
        : String(row.paid_at),
      alreadyReconciled: Boolean(row.already_reconciled),
    };
  });
  const mutations: QrisMutationCandidateInput[] = (mutationRows.rows as Array<Record<string, unknown>>).map((row) => ({
    id: Number(row.id),
    companyId: row.company_id == null ? null : Number(row.company_id),
    bankAccountId: row.bank_account_id == null ? null : Number(row.bank_account_id),
    transactionDate: asDate(row.transaction_date) ?? "",
    amount: Number(row.amount ?? 0),
    direction: String(row.direction ?? ""),
    source: row.source == null ? null : String(row.source),
    sourceClassification: row.source_classification == null ? null : String(row.source_classification),
    providerName: row.provider_name == null ? null : String(row.provider_name),
    providerOrderId: row.provider_order_id == null ? null : String(row.provider_order_id),
    description: row.description == null ? null : String(row.description),
    status: row.status == null ? null : String(row.status),
  })).filter((row) => row.transactionDate);

  // Recompute existing provisional rows as well. A bank mutation can be
  // imported before the Sport Center payment sync finishes; skipping an
  // existing mutation would permanently preserve an empty/stale candidate.
  // This table is provisional only, so refreshing it does not approve, post,
  // or consume any bank evidence.
  const candidates = generateQrisMutationBatchCandidates({
    payments,
    mutations,
    holidays,
    providerRules: rules,
    accountProviderRules: accountRules,
  });

  if (!options.dryRun) {
    for (const candidate of candidates) {
      const itemJson = JSON.stringify(candidate.paymentItems);
      await db.execute(sql.raw(`
        INSERT INTO qris_mutation_batch_candidates (
          mutation_id, company_id, source_date, estimated_settlement_date,
          bank_account_id, provider_code, provider_detection_source,
          settlement_rule_version, mutation_source_classification, gross_amount,
          mdr_amount, other_fee_amount, net_amount, payment_items, status,
          reconciliation_status, confidence, observed_deduction,
          effective_deduction_rate, review_reason, generated_at, updated_at
        ) VALUES (
          ${candidate.mutationId},
          ${candidate.companyId == null ? "NULL" : candidate.companyId},
          '${esc(candidate.sourceDate)}',
          '${esc(candidate.estimatedSettlementDate)}',
          ${candidate.bankAccountId == null ? "NULL" : candidate.bankAccountId},
          '${esc(candidate.providerCode)}',
          '${esc(candidate.providerDetectionSource)}',
          '${esc(candidate.settlementRuleVersion)}',
          '${esc(candidate.mutationSourceClassification)}',
          ${candidate.grossAmount},
          ${candidate.observedDeduction},
          0,
          ${candidate.netAmount},
          '${esc(itemJson)}'::jsonb,
          'candidate_review',
          '${candidate.status}',
          ${candidate.confidence},
          ${candidate.observedDeduction},
          ${candidate.effectiveDeductionRate == null ? "NULL" : candidate.effectiveDeductionRate},
          '${esc(candidate.reason)}',
          NOW(),
          NOW()
        )
           ON CONFLICT (mutation_id) DO UPDATE SET
             company_id = EXCLUDED.company_id,
             source_date = EXCLUDED.source_date,
             estimated_settlement_date = EXCLUDED.estimated_settlement_date,
             bank_account_id = EXCLUDED.bank_account_id,
             provider_code = EXCLUDED.provider_code,
             provider_detection_source = EXCLUDED.provider_detection_source,
             settlement_rule_version = EXCLUDED.settlement_rule_version,
             mutation_source_classification = EXCLUDED.mutation_source_classification,
             gross_amount = EXCLUDED.gross_amount,
             mdr_amount = EXCLUDED.mdr_amount,
             other_fee_amount = EXCLUDED.other_fee_amount,
             net_amount = EXCLUDED.net_amount,
             payment_items = EXCLUDED.payment_items,
             status = EXCLUDED.status,
             reconciliation_status = EXCLUDED.reconciliation_status,
             confidence = EXCLUDED.confidence,
             observed_deduction = EXCLUDED.observed_deduction,
             effective_deduction_rate = EXCLUDED.effective_deduction_rate,
             review_reason = EXCLUDED.review_reason,
             generated_at = EXCLUDED.generated_at,
             updated_at = NOW()
      `));
    }
  }

  return { dryRun: options.dryRun !== false, generated: candidates.length, candidates };
}

export async function listQrisCandidates(options: {
  companyId?: number | null;
  status?: string | null;
  limit?: number;
} = {}) {
  const companyFilter = options.companyId && Number.isInteger(options.companyId)
    ? `AND c.company_id = ${Number(options.companyId)}`
    : "";
  const statusFilter = options.status && ["MATCHED", "REVIEW", "UNMATCHED"].includes(options.status)
    ? `AND c.reconciliation_status = '${esc(options.status)}'`
    : "";
  const limit = Math.min(Math.max(Number(options.limit ?? 100), 1), 500);
  const { rows } = await db.execute(sql.raw(`
    SELECT c.*, bm.description, bm.transaction_date, bm.amount AS bank_amount,
           bm.bank_account_id,
           bm.source, bm.provider_name AS bank_provider_name
    FROM qris_mutation_batch_candidates c
    LEFT JOIN bank_mutations bm ON bm.id = c.mutation_id
    WHERE TRUE ${companyFilter} ${statusFilter}
    ORDER BY c.source_date DESC, c.id DESC
    LIMIT ${limit}
  `));
  return rows;
}