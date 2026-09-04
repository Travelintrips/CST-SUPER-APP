import { db, RECONCILIATION_CANDIDATE_SOURCES } from "@workspace/db";
import { sql } from "drizzle-orm";

export const CANONICAL_SETTLEMENT_SOURCE =
  RECONCILIATION_CANDIDATE_SOURCES.CANONICAL_SPORT_CENTER;

export type CanonicalSettlementRow = {
  settlement_id: number | string;
  settlement_reference: string | null;
  company_id: number | string | null;
  provider_code: string | null;
  provider_name: string | null;
  bank_account_id: number | string | null;
  /** Internal company_bank_accounts.id resolved from the canonical account number. */
  bank_account_internal_id?: number | string | null;
  settlement_date: string | Date | null;
  gross_amount: number | string | null;
  mdr_amount: number | string | null;
  provider_fee_amount: number | string | null;
  fee_tax_amount: number | string | null;
  tax_withheld_amount: number | string | null;
  adjustment_amount: number | string | null;
  expected_bank_amount: number | string | null;
  settlement_status: string | null;
  settlement_journal_id: number | string | null;
  /** public.bank_mutations.id after the additive identity migration. */
  bank_mutation_id: number | string | null;
  /** Compatibility link; must be null or equal to bank_mutation_id. */
  canonical_bank_mutation_id?: number | string | null;
  settlement_rule_version?: string | null;
  posted_at?: string | Date | null;
  posted_by?: string | null;
  reconciled_at?: string | Date | null;
  reconciled_by?: string | null;
  bank_link_status?: string | null;
};

export type CanonicalSettlementCandidate = {
  id: number;
  type: "qris_settlement";
  candidateType: "qris_settlement";
  candidateId: number;
  candidateSource: typeof CANONICAL_SETTLEMENT_SOURCE;
  amount: number;
  date: string;
  ref: string | null;
  name: string | null;
  gross_amount: number;
  mdr_amount: number;
  provider_fee_amount: number;
  fee_tax_amount: number;
  tax_withheld_amount: number;
  adjustment_amount: number;
  expected_bank_amount: number;
  settlement_date: string | null;
  settlement_reference: string | null;
  settlement_status: string | null;
  provider_code: string | null;
  provider_name: string | null;
  company_id: number | null;
  bank_account_id: number | null;
  settlement_journal_id: number | null;
  /** public.bank_mutations.id after the additive identity migration. */
  bank_mutation_id: number | null;
  /** Compatibility link; always null or equal to bank_mutation_id. */
  canonical_bank_mutation_id: number | null;
  settlement_rule_version: string | null;
};

export type CanonicalSettlementQueueItem = CanonicalSettlementCandidate & {
  queue_status: "active" | "completed";
  audit_status: "undocumented" | "documented";
  outcome_status: "linked" | "audit_documented" | "unresolved_undocumented";
  audit_reason: string | null;
  audit_actor: string | null;
  audit_at: string | null;
  payment_items: Array<{
    paymentId: number;
    grossAmount: number;
    itemStatus: string | null;
  }>;
  bank_status: string | null;
  bank_transaction_date: string | null;
  bank_amount: number | null;
  bank_description: string | null;
};

export type CanonicalSettlementLookupOptions = {
  companyId?: number | null;
  settlementId?: number | null;
  amount?: number | null;
  bankAmount?: number | null;
  absoluteVarianceTolerance?: number | null;
  percentageVarianceTolerance?: number | null;
  /**
   * Keep identity/date/provider-matched settlements visible even when their
   * variance is outside the configured tolerance. Callers must keep these
   * candidates review-only; approval still performs its own strict checks.
   */
  includeOutsideTolerance?: boolean;
  /**
   * May be either the internal company_bank_accounts.id used by public bank
   * mutations or the external account number stored by Sport Center.
   * The lookup normalizes both identities before returning a candidate.
   */
  bankAccountId?: number | string | null;
  providerCode?: string | null;
  from?: string | null;
  to?: string | null;
};

export function shouldApplyCanonicalAmountTolerance(
  options: Pick<
    CanonicalSettlementLookupOptions,
    "bankAmount" | "includeOutsideTolerance"
  >,
): boolean {
  return options.bankAmount != null && options.includeOutsideTolerance !== true;
}

function numberOrNull(value: unknown): number | null {
  if (value === null || value === undefined || value === "") return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function numberOrZero(value: unknown): number {
  return numberOrNull(value) ?? 0;
}

function dateText(value: unknown): string | null {
  if (value === null || value === undefined) return null;
  return String(value).slice(0, 10);
}

/**
 * Canonical eligibility is deliberately stricter than the view's broad
 * posted/reconciled scope. Only an unlinked, posted settlement with its
 * upstream journal is representable as a reconciliation candidate. Its
 * bank_mutation_id, when linked, is public.bank_mutations.id.
 */
export function isCanonicalSettlementEligible(
  row: Pick<
    CanonicalSettlementRow,
    "settlement_status" | "bank_mutation_id" | "canonical_bank_mutation_id" | "settlement_journal_id"
  >,
): boolean {
  return (
    String(row.settlement_status ?? "").toLowerCase() === "posted" &&
    row.bank_mutation_id == null &&
    row.canonical_bank_mutation_id == null &&
    row.settlement_journal_id != null
  );
}

export class CanonicalSettlementEligibilityError extends Error {
  readonly code = "CANONICAL_SETTLEMENT_NOT_ELIGIBLE";

  constructor() {
    super(
      "Canonical settlement must be posted, unlinked, and have an upstream settlement journal.",
    );
    this.name = "CanonicalSettlementEligibilityError";
  }
}

export function assertCanonicalSettlementEligibility(
  row: CanonicalSettlementRow,
): void {
  if (!isCanonicalSettlementEligible(row)) {
    throw new CanonicalSettlementEligibilityError();
  }
}

/**
 * Convert the canonical view row into the existing reconciliation candidate
 * shape. The view's expected_bank_amount is authoritative for matching; no
 * MDR or fee value is inferred from a bank mutation amount.
 */
export function mapCanonicalSettlementRow(
  row: CanonicalSettlementRow,
): CanonicalSettlementCandidate {
  assertCanonicalSettlementEligibility(row);
  return mapCanonicalSettlementDisplayRow(row);
}

function mapCanonicalSettlementDisplayRow(
  row: CanonicalSettlementRow,
): CanonicalSettlementCandidate {

  const id = Number(row.settlement_id);
  const settlementDate = dateText(row.settlement_date);
  const expectedBankAmount = numberOrZero(row.expected_bank_amount);

  return {
    id,
    type: "qris_settlement",
    candidateType: "qris_settlement",
    candidateId: id,
    candidateSource: CANONICAL_SETTLEMENT_SOURCE,
    amount: expectedBankAmount,
    date: settlementDate ?? "",
    ref: row.settlement_reference,
    name: row.settlement_reference,
    gross_amount: numberOrZero(row.gross_amount),
    mdr_amount: numberOrZero(row.mdr_amount),
    provider_fee_amount: numberOrZero(row.provider_fee_amount),
    fee_tax_amount: numberOrZero(row.fee_tax_amount),
    tax_withheld_amount: numberOrZero(row.tax_withheld_amount),
    adjustment_amount: numberOrZero(row.adjustment_amount),
    expected_bank_amount: expectedBankAmount,
    settlement_date: settlementDate,
    settlement_reference: row.settlement_reference,
    settlement_status: row.settlement_status,
    provider_code: row.provider_code,
    provider_name: row.provider_name,
    company_id: numberOrNull(row.company_id),
    bank_account_id: numberOrNull(
      row.bank_account_internal_id ?? row.bank_account_id,
    ),
    settlement_journal_id: numberOrNull(row.settlement_journal_id),
    bank_mutation_id: numberOrNull(row.bank_mutation_id),
    canonical_bank_mutation_id: numberOrNull(row.canonical_bank_mutation_id),
    settlement_rule_version: row.settlement_rule_version == null
      ? null
      : String(row.settlement_rule_version),
  };
}

const CANONICAL_SETTLEMENT_COLUMNS = sql.raw(`
  settlement_id,
  settlement_reference,
  company_id,
  provider_code,
  provider_name,
  bank_account_id,
  settlement_date,
  gross_amount,
  mdr_amount,
  provider_fee_amount,
  fee_tax_amount,
  tax_withheld_amount,
  adjustment_amount,
  expected_bank_amount,
  settlement_status,
  settlement_journal_id,
  bank_mutation_id,
  canonical_bank_mutation_id,
  settlement_rule_version,
  posted_at,
  posted_by,
  reconciled_at,
  reconciled_by,
  bank_link_status
`);

function canonicalEligibilityFilters(
  options: CanonicalSettlementLookupOptions,
) {
  const filters = [
    sql`settlement_status = 'posted'`,
    sql`bank_mutation_id IS NULL`,
    sql`canonical_bank_mutation_id IS NULL`,
    sql`settlement_journal_id IS NOT NULL`,
  ];

  if (options.companyId != null) {
    filters.push(sql`company_id = ${options.companyId}`);
  }
  if (options.settlementId != null) {
    filters.push(sql`settlement_id = ${options.settlementId}`);
  }
  if (options.amount != null) {
    filters.push(sql`ABS(expected_bank_amount::numeric - ${options.amount}) < 0.01`);
  }
  if (shouldApplyCanonicalAmountTolerance(options)) {
    const absoluteTolerance = Math.max(0, Number(options.absoluteVarianceTolerance ?? 0));
    const percentageTolerance = Math.max(0, Number(options.percentageVarianceTolerance ?? 0));
    filters.push(sql`(
      ABS(expected_bank_amount::numeric - ${options.bankAmount}) < 0.01
      OR (
        ${absoluteTolerance} > 0
        AND ABS(expected_bank_amount::numeric - ${options.bankAmount}) <= ${absoluteTolerance}
      )
      OR (
        ${percentageTolerance} > 0
        AND NULLIF(ABS(expected_bank_amount::numeric), 0) IS NOT NULL
        AND ABS(expected_bank_amount::numeric - ${options.bankAmount})
          / NULLIF(ABS(expected_bank_amount::numeric), 0) * 100 <= ${percentageTolerance}
      )
    )`);
  }
  if (options.bankAccountId != null) {
    filters.push(sql`(
      bank_account_id = ${options.bankAccountId}
      OR (
        bank_account_id IS NULL
        AND ABS(expected_bank_amount::numeric - ${options.bankAmount ?? options.amount ?? 0}) < 0.01
      )
    )`);
  }
  if (options.providerCode) {
    filters.push(sql`(
      provider_code = ${options.providerCode}
      OR (
        ${options.providerCode} = 'gpn_qris'
        AND provider_code = 'mandiri_direct'
      )
      OR (
        provider_code IS NULL
        AND ABS(expected_bank_amount::numeric - ${options.bankAmount ?? options.amount ?? 0}) < 0.01
      )
    )`);
  }
  if (options.from) {
    filters.push(sql`settlement_date >= ${options.from}`);
  }
  if (options.to) {
    filters.push(sql`settlement_date <= ${options.to}`);
  }

  return sql.join(filters, sql` AND `);
}

/**
 * Read eligible canonical settlement candidates. This function intentionally
 * does not insert, update, lock, or call any settlement/accounting function.
 */
export async function findCanonicalSettlementCandidates(
  options: CanonicalSettlementLookupOptions = {},
): Promise<CanonicalSettlementCandidate[]> {
  const result = await db.execute(sql`
    SELECT ebs.*, account_identity.bank_account_internal_id
    FROM (
      SELECT ${CANONICAL_SETTLEMENT_COLUMNS}
      FROM sport_center.expected_bank_settlements
      WHERE ${canonicalEligibilityFilters(options)}
    ) ebs
    JOIN LATERAL (
      SELECT
        CASE WHEN COUNT(*) = 1 THEN MIN(cba.id) ELSE NULL END
          AS bank_account_internal_id
      FROM public.company_bank_accounts cba
      WHERE cba.company_id = ebs.company_id
        AND cba.is_active = TRUE
        AND (
          cba.account_number::text = ebs.bank_account_id::text
          OR cba.id::text = ebs.bank_account_id::text
        )
    ) account_identity ON account_identity.bank_account_internal_id IS NOT NULL
    JOIN sport_center.accounting_journals aj
      ON aj.id = ebs.settlement_journal_id
     AND aj.status = 'posted'
    ORDER BY ebs.settlement_date, ebs.settlement_id
  `);

  return (result.rows as Array<CanonicalSettlementRow & {
    bank_account_internal_id?: number | string | null;
  }>).map(mapCanonicalSettlementRow);
}

/**
 * Read the canonical settlement queue and history. This is intentionally
 * separate from findCanonicalSettlementCandidates: the reconciliation
 * candidate adapter only returns unlinked posted batches, while the UI also
 * needs completed batches to explain why an item disappeared from the active
 * queue.
 *
 * The query does not read qris_mutation_batch_candidates and does not mutate
 * either the canonical settlement or bank mutation tables.
 */
export async function listCanonicalSettlementQueue(options: {
  companyId?: number | null;
  includeCompleted?: boolean;
  limit?: number;
} = {}): Promise<CanonicalSettlementQueueItem[]> {
  const limit = Math.min(Math.max(Number(options.limit ?? 100), 1), 500);
  const companyFilter = options.companyId == null
    ? sql``
    : sql`AND ebs.company_id = ${options.companyId}`;
  const activeFilter = options.includeCompleted
    ? sql``
    : sql`
        AND ebs.settlement_status = 'posted'
        AND ebs.bank_mutation_id IS NULL
      `;

  const result = await db.execute(sql`
    SELECT
      ebs.*,
      COALESCE((
        SELECT jsonb_agg(
          jsonb_build_object(
            'paymentId', psi.payment_id,
            'grossAmount', psi.gross_amount,
            'itemStatus', psi.item_status
          )
          ORDER BY psi.payment_id
        )
        FROM sport_center.payment_settlement_items psi
        WHERE psi.settlement_id = ebs.settlement_id
      ), '[]'::jsonb) AS payment_items,
      bm.status::text AS bank_status,
      bm.transaction_date AS bank_transaction_date,
      bm.amount AS bank_amount,
      bm.description AS bank_description,
      audit.reason AS audit_reason,
      audit.actor AS audit_actor,
      audit.created_at AS audit_at
    FROM sport_center.expected_bank_settlements ebs
    JOIN sport_center.accounting_journals aj
      ON aj.id = ebs.settlement_journal_id
     AND aj.status = 'posted'
    LEFT JOIN public.bank_mutations bm
      ON bm.id = ebs.bank_mutation_id
    LEFT JOIN LATERAL (
      SELECT
        ba.meta->>'reason' AS reason,
        ba.actor,
        ba.created_at
      FROM public.bank_reconciliation_audit ba
      WHERE ba.action = 'CANONICAL_SETTLEMENT_AUDIT_RECORDED'
        AND COALESCE(
          ba.meta->>'settlement_id',
          ba.meta->>'canonical_settlement_id'
        ) = ebs.settlement_id::text
      ORDER BY ba.id DESC
      LIMIT 1
    ) audit ON TRUE
    WHERE 1 = 1
      ${companyFilter}
      ${activeFilter}
      AND (
        ebs.settlement_status = 'posted'
        OR ebs.settlement_status = 'reconciled'
        OR ebs.bank_mutation_id IS NOT NULL
      )
    ORDER BY ebs.settlement_date DESC, ebs.settlement_id DESC
    LIMIT ${limit}
  `);

  return (result.rows as Array<CanonicalSettlementRow & {
    payment_items?: unknown;
    bank_status?: unknown;
    bank_transaction_date?: unknown;
    bank_amount?: unknown;
    bank_description?: unknown;
    audit_reason?: unknown;
    audit_actor?: unknown;
    audit_at?: unknown;
  }>).map((row) => {
    // Queue/history includes reconciled rows, so use the display projection
    // without applying the stricter approval-candidate assertion.
    const canonical = mapCanonicalSettlementDisplayRow(row);
    const rawItems = Array.isArray(row.payment_items) ? row.payment_items : [];
    const paymentItems = rawItems
      .map((item) => {
        const value = item as Record<string, unknown>;
        const paymentId = numberOrNull(value.paymentId);
        if (paymentId == null) return null;
        return {
          paymentId,
          grossAmount: numberOrZero(value.grossAmount),
          itemStatus: value.itemStatus == null ? null : String(value.itemStatus),
        };
      })
      .filter((item): item is {
        paymentId: number;
        grossAmount: number;
        itemStatus: string | null;
      } => item != null);

    const linkedMutationId = numberOrNull(
      row.bank_mutation_id,
    );
    const isCompleted =
      String(row.settlement_status ?? "").toLowerCase() === "reconciled"
      || linkedMutationId != null;
    const hasAuditReason =
      row.audit_reason != null && String(row.audit_reason).trim() !== "";

    return {
      ...canonical,
      settlement_status: row.settlement_status,
      bank_mutation_id: linkedMutationId,
      canonical_bank_mutation_id: null,
      queue_status: isCompleted ? "completed" : "active",
      audit_status: row.audit_reason == null || String(row.audit_reason).trim() === ""
        ? "undocumented"
        : "documented",
      outcome_status: isCompleted
        ? "linked"
        : hasAuditReason
          ? "audit_documented"
          : "unresolved_undocumented",
      audit_reason: row.audit_reason == null ? null : String(row.audit_reason),
      audit_actor: row.audit_actor == null ? null : String(row.audit_actor),
      audit_at: row.audit_at == null ? null : String(row.audit_at),
      payment_items: paymentItems,
      bank_status: row.bank_status == null ? null : String(row.bank_status),
      bank_transaction_date: dateText(row.bank_transaction_date),
      bank_amount: numberOrNull(row.bank_amount),
      bank_description: row.bank_description == null ? null : String(row.bank_description),
    };
  });
}

export async function getCanonicalSettlementForReconciliation(
  settlementId: number,
  companyId?: number | null,
): Promise<CanonicalSettlementCandidate | null> {
  const candidates = await findCanonicalSettlementCandidates({
    settlementId,
    companyId,
  });
  return candidates[0] ?? null;
}

/**
 * SQL expression used by the bank-mutation read API. The candidate ID is an
 * internal SQL expression supplied by this server, not user input.
 */
export function canonicalSettlementDetailsSql(
  candidateIdExpression = "m.candidate_id",
): string {
  if (!/^[A-Za-z_][A-Za-z0-9_.]*$/.test(candidateIdExpression)) {
    throw new Error("Invalid canonical settlement candidate ID expression");
  }

  return `
    (
      SELECT jsonb_build_object(
        'candidateType', 'qris_settlement',
        'candidateId', ebs.settlement_id,
        'candidateSource', '${CANONICAL_SETTLEMENT_SOURCE}',
        'amount', ebs.expected_bank_amount,
         'expectedAmount', ebs.expected_bank_amount,
         'actualBankAmount', bm.amount,
         'amountDifference', ABS(ebs.expected_bank_amount::numeric - bm.amount::numeric),
         'varianceAmount', bm.amount::numeric - ebs.expected_bank_amount::numeric,
         'variancePercent', CASE
           WHEN NULLIF(ABS(ebs.expected_bank_amount::numeric), 0) IS NULL THEN NULL
           ELSE ABS(bm.amount::numeric - ebs.expected_bank_amount::numeric)
             / NULLIF(ABS(ebs.expected_bank_amount::numeric), 0) * 100
         END,
         'varianceStatus', CASE
           WHEN ABS(ebs.expected_bank_amount::numeric - bm.amount::numeric) < 0.01
             THEN 'exact_match'
           ELSE 'need_review'
         END,
         'varianceReason', CASE
           WHEN ABS(ebs.expected_bank_amount::numeric - bm.amount::numeric) < 0.01
             THEN 'exact amount match'
           ELSE 'amount_variance'
         END,
        'settlementReference', ebs.settlement_reference,
        'settlementDate', ebs.settlement_date,
         'mutationDate', bm.transaction_date,
        'providerCode', ebs.provider_code,
        'providerName', ebs.provider_name,
        'companyId', ebs.company_id,
        'bankAccountId', ebs.bank_account_id,
        'grossAmount', ebs.gross_amount,
        'mdrAmount', ebs.mdr_amount,
        'providerFeeAmount', ebs.provider_fee_amount,
        'feeTaxAmount', ebs.fee_tax_amount,
        'taxWithheldAmount', ebs.tax_withheld_amount,
        'adjustmentAmount', ebs.adjustment_amount,
        'netAmount', ebs.expected_bank_amount,
        'settlementJournalId', ebs.settlement_journal_id,
        'settlementStatus', ebs.settlement_status,
        'bankMutationId', ebs.bank_mutation_id,
        'settlementRuleVersion', ebs.settlement_rule_version,
        'settlementItemCount', (
          SELECT COUNT(*)
          FROM sport_center.payment_settlement_items psi
          WHERE psi.settlement_id = ebs.settlement_id
        )
      )
       FROM sport_center.expected_bank_settlements ebs
        JOIN public.bank_mutations bm
         ON bm.id = m.mutation_id
        WHERE ebs.settlement_id = ${candidateIdExpression}
         AND ebs.settlement_journal_id IS NOT NULL
         AND (
           (
             -- Approved matches are finalized evidence. Their canonical
             -- settlement is reconciled and linked to this exact mutation,
             -- so keep the detail visible even though it is no longer
             -- eligible for another approval.
             m.status = 'approved'
             AND ebs.settlement_status = 'reconciled'
             AND ebs.bank_mutation_id = m.mutation_id
           )
           OR (
             -- Unapproved candidates must remain unlinked and postable.
             m.status <> 'approved'
             AND ebs.settlement_status = 'posted'
             AND ebs.bank_mutation_id IS NULL
           )
         )
    )
  `;
}