import { db, endPool } from "@workspace/db";
import { sql } from "drizzle-orm";
import { PayrollJournalService } from "../src/lib/payroll/PayrollJournalService.js";

const COMPANY_ID = 1;
const RUN_ID = 31;
const AMOUNT = 36_940_000;
const REPAYMENT_COUNT = 12;
const SALARY_PAYABLE_ACCOUNT_ID = 74_138;
const EMPLOYEE_RECEIVABLE_ACCOUNT_ID = 72_327;

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(`PAYROLL_RUN31_VERIFY_FAILED: ${message}`);
}

try {
  const result = await PayrollJournalService.postKasbonSettlement({
    companyId: COMPANY_ID,
    payrollRunId: RUN_ID,
    salaryPayableAccountId: SALARY_PAYABLE_ACCOUNT_ID,
    employeeReceivableAccountId: EMPLOYEE_RECEIVABLE_ACCOUNT_ID,
    amount: AMOUNT,
    repaymentCount: REPAYMENT_COUNT,
    date: new Date(),
    actor: "payroll-run31-remediation",
  });

  const entryResult = await db.execute<{
    id: number;
    status: string;
    source: string;
    source_id: number;
    ref: string;
    total_debit: string;
    total_credit: string;
  }>(sql`
    SELECT id, status, source, source_id, ref, total_debit, total_credit
    FROM accounting_entries
    WHERE id = ${result.entryId}
      AND company_id = ${COMPANY_ID}
  `);
  const entry = entryResult.rows[0];
  assert(entry, "settlement journal is missing");
  assert(entry.status === "posted", `journal status is ${entry.status}`);
  assert(entry.source === "kasbon", `journal source is ${entry.source}`);
  assert(entry.ref === result.reference, "journal reference is not deterministic");
  assert(Number(entry.total_debit) === AMOUNT && Number(entry.total_credit) === AMOUNT, "journal totals are not balanced");

  const lineResult = await db.execute<{
    account_id: number;
    debit: string;
    credit: string;
  }>(sql`
    SELECT account_id, debit, credit
    FROM accounting_entry_lines
    WHERE entry_id = ${result.entryId}
    ORDER BY id
  `);
  assert(lineResult.rows.length === 2, `expected 2 journal lines, found ${lineResult.rows.length}`);
  assert(
    lineResult.rows.some((line) =>
      line.account_id === SALARY_PAYABLE_ACCOUNT_ID &&
      Number(line.debit) === AMOUNT &&
      Number(line.credit) === 0
    ),
    "salary payable debit line is missing",
  );
  assert(
    lineResult.rows.some((line) =>
      line.account_id === EMPLOYEE_RECEIVABLE_ACCOUNT_ID &&
      Number(line.debit) === 0 &&
      Number(line.credit) === AMOUNT
    ),
    "employee receivable credit line is missing",
  );

  const repaymentResult = await db.execute<{
    count: string;
    total: string;
    linked_entries: string;
    unposted: string;
    missing_keys: string;
  }>(sql`
    SELECT
      COUNT(*)::text AS count,
      COALESCE(SUM(car.amount), 0)::text AS total,
      COUNT(DISTINCT car.entry_id)::text AS linked_entries,
      COUNT(*) FILTER (WHERE car.entry_id IS NULL OR car.posted_at IS NULL)::text AS unposted,
      COUNT(*) FILTER (WHERE car.idempotency_key IS NULL)::text AS missing_keys
    FROM cash_advance_repayments car
    JOIN cash_advances ca ON ca.id = car.advance_id
    WHERE ca.company_id = ${COMPANY_ID}
      AND ca.type = 'kasbon'
      AND car.entry_id = ${result.entryId}
      AND EXISTS (
        SELECT 1
        FROM payroll_items pi
        WHERE pi.run_id = ${RUN_ID}
          AND pi.cash_advance_id = ca.id
      )
  `);
  const repayments = repaymentResult.rows[0];
  assert(repayments, "repayment verification returned no row");
  assert(Number(repayments.count) === REPAYMENT_COUNT, `linked repayment count is ${repayments.count}`);
  assert(Number(repayments.total) === AMOUNT, `linked repayment total is ${repayments.total}`);
  assert(Number(repayments.linked_entries) === 1, "repayments point to multiple entries");
  assert(Number(repayments.unposted) === 0, "one or more repayments are not posted");
  assert(Number(repayments.missing_keys) === 0, "one or more idempotency keys are missing");

  const ledgerResult = await db.execute<{
    count: string;
    total_debit: string;
    total_credit: string;
  }>(sql`
    SELECT
      COUNT(*)::text AS count,
      COALESCE(SUM(debit), 0)::text AS total_debit,
      COALESCE(SUM(credit), 0)::text AS total_credit
    FROM fleet_ledger_entries
    WHERE company_id = ${COMPANY_ID}
      AND source_type = 'kasbon'
      AND source_id = ${entry.source_id}
      AND source_ref = (
        SELECT entry_number FROM accounting_entries WHERE id = ${result.entryId}
      )
      AND is_voided = false
  `);
  const ledger = ledgerResult.rows[0];
  assert(ledger, "fleet ledger verification returned no row");
  assert(Number(ledger.count) === 2, `fleet ledger line count is ${ledger.count}`);
  assert(Number(ledger.total_debit) === AMOUNT && Number(ledger.total_credit) === AMOUNT, "fleet ledger is not balanced");

  const payableResult = await db.execute<{ balance: string }>(sql`
    SELECT COALESCE(SUM(ael.debit - ael.credit), 0)::text AS balance
    FROM accounting_entry_lines ael
    JOIN accounting_entries ae ON ae.id = ael.entry_id
    WHERE ae.company_id = ${COMPANY_ID}
      AND ae.status = 'posted'
      AND ael.account_id = ${SALARY_PAYABLE_ACCOUNT_ID}
  `);

  console.log(JSON.stringify({
    ...result,
    journal: { id: entry.id, status: entry.status, source: entry.source, reference: entry.ref },
    lines: lineResult.rows,
    repayments: { count: repayments.count, total: repayments.total, unposted: repayments.unposted },
    fleetLedger: ledger,
    salaryPayableNetBalance: payableResult.rows[0]?.balance ?? null,
  }, null, 2));
} finally {
  await endPool();
}