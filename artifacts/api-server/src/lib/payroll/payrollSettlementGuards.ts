export type KasbonRepaymentValidationRow = {
  id: number;
  amount: string | number;
  entry_id: number | null;
  posted_at: string | Date | null;
  idempotency_key: string | null;
};

export type SettlementAccountValidationRow = {
  company_id: number | null;
  is_active: boolean;
  is_postable: boolean;
  status: string;
};

export type SettlementPeriodState = {
  is_closed: boolean;
  override_allowed: boolean;
} | undefined;

export type PayrollPaymentEvidenceRow = {
  mutation_id: number;
  mutation_company_id: number | null;
  mutation_amount: string | number;
  mutation_direction: string | null;
  mutation_status: string | null;
  mutation_linked_type: string | null;
  mutation_linked_id: number | null;
  mutation_reconciliation_status: string | null;
  mutation_journal_entry_id: number | null;
  payment_id: number;
  payment_company_id: number | null;
  payment_amount: string | number;
  payment_status: string | null;
  payment_entry_id: number | null;
  payment_source_type: string | null;
  payment_source_doc_id: number | null;
  payment_source_id: number | null;
  match_id: number;
  match_status: string | null;
  match_candidate_type: string | null;
  match_candidate_id: number | null;
};

export function settlementSourceId(payrollRunId: number): number {
  return -Math.abs(payrollRunId);
}

export function settlementReference(payrollRunId: number, period: string): string {
  return `PAYROLL/${period}/R${payrollRunId}-KASBON`;
}

export function repaymentIdempotencyKey(payrollRunId: number, repaymentId: number): string {
  return `PAYROLL-R${payrollRunId}-KASBON-REPAYMENT-${repaymentId}`;
}

export function assertSettlementRows(
  rows: KasbonRepaymentValidationRow[],
  expectedCount: number,
  expectedAmount: number,
): void {
  if (rows.length !== expectedCount) {
    throw new Error(`KASBON_REPAYMENT_COUNT_MISMATCH: expected ${expectedCount}, found ${rows.length}.`);
  }
  const total = rows.reduce((sum, row) => sum + Number(row.amount), 0);
  if (Math.abs(total - expectedAmount) > 0.01) {
    throw new Error(`KASBON_REPAYMENT_AMOUNT_MISMATCH: expected ${expectedAmount.toFixed(2)}, found ${total.toFixed(2)}.`);
  }
  const linked = rows.filter((row) => row.entry_id != null || row.posted_at != null);
  if (linked.length > 0 && linked.length !== rows.length) {
    throw new Error("KASBON_REPAYMENT_PARTIAL_LINK: repayment set is partially linked.");
  }
  if (rows.length > 0 && linked.length === rows.length) {
    const entryIds = new Set(rows.map((row) => row.entry_id));
    if (entryIds.size !== 1 || [...entryIds][0] == null || rows.some((row) => row.posted_at == null)) {
      throw new Error("KASBON_REPAYMENT_LINK_INCONSISTENT: repayment links are not identical and posted.");
    }
  }
}

export function assertSettlementAccounts(
  rows: SettlementAccountValidationRow[],
  companyId: number,
): void {
  if (
    rows.length !== 2 ||
    rows.some((row) =>
      row.company_id !== companyId ||
      !row.is_active ||
      !row.is_postable ||
      row.status !== "ACTIVE"
    )
  ) {
    throw new Error("KASBON_SETTLEMENT_COA_INVALID: settlement accounts are not active/postable in the company.");
  }
}

export function assertSettlementPeriodOpen(state: SettlementPeriodState, period: string): void {
  if (state?.is_closed && !state.override_allowed) {
    throw new Error(`PERIOD_CLOSED: posting period ${period} is locked.`);
  }
}

export function assertPayrollPaymentEvidence(
  rows: PayrollPaymentEvidenceRow[],
  companyId: number,
  payrollRunId: number,
  expectedAmount: number,
): PayrollPaymentEvidenceRow {
  if (rows.length !== 1) {
    throw new Error(
      `PAYROLL_PAYMENT_EVIDENCE_NOT_UNIQUE: expected one approved bank/payment link, found ${rows.length}.`,
    );
  }

  const evidence = rows[0]!;
  const paymentSourceMatches =
    (evidence.payment_source_type === "payroll" && evidence.payment_source_doc_id === payrollRunId) ||
    (evidence.payment_source_type === "hrd_salary_payment" && evidence.payment_source_id === payrollRunId);
  const valid =
    evidence.mutation_company_id === companyId &&
    evidence.payment_company_id === companyId &&
    Math.abs(Number(evidence.mutation_amount) - expectedAmount) <= 0.01 &&
    Math.abs(Number(evidence.payment_amount) - expectedAmount) <= 0.01 &&
    String(evidence.mutation_direction ?? "").toUpperCase() === "OUT" &&
    ["matched", "posted"].includes(String(evidence.mutation_status ?? "").toLowerCase()) &&
    evidence.mutation_linked_type === "accounting_payment" &&
    evidence.mutation_linked_id === evidence.payment_id &&
    String(evidence.mutation_reconciliation_status ?? "").toLowerCase() === "matched" &&
    evidence.payment_status === "posted" &&
    paymentSourceMatches &&
    evidence.match_status === "approved" &&
    evidence.match_candidate_type === "accounting_payment" &&
    evidence.match_candidate_id === evidence.payment_id;

  if (!valid) {
    throw new Error("PAYROLL_PAYMENT_EVIDENCE_INVALID: bank/payment link is not company-scoped, exact, approved, and run-linked.");
  }
  return evidence;
}