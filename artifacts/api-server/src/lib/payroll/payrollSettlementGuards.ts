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