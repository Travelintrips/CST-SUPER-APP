import { db, endPool } from "@workspace/db";
import { sql } from "drizzle-orm";
import { PayrollJournalService } from "../src/lib/payroll/PayrollJournalService.js";

const COMPANY_ID = 1;
const RUN_ID = 31;
const EXPECTED_NET_AMOUNT = 63_210_000;
const APPLY = process.argv.includes("--apply");

function numberArg(name: string): number | null {
  const raw = process.argv.find((arg) => arg.startsWith(`${name}=`))?.split("=")[1];
  if (raw == null || raw === "") return null;
  const value = Number(raw);
  if (!Number.isInteger(value) || value <= 0) {
    throw new Error(`${name} must be a positive integer`);
  }
  return value;
}

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(`PAYROLL_RUN31_VERIFY_FAILED: ${message}`);
}

const bankMutationId = numberArg("--bank-mutation-id");
const accountingPaymentId = numberArg("--accounting-payment-id");
const salaryPayableAccountId = numberArg("--salary-payable-account-id");
const cashBankAccountId = numberArg("--cash-bank-account-id");

try {
  const runResult = await db.execute<{
    id: number;
    company_id: number;
    month: number;
    year: number;
    status: string;
    posting_status: string | null;
    accounting_entry_id: number | null;
    payment_entry_id: number | null;
    posted_at: string | Date | null;
    item_count: string;
    paid_item_count: string;
    gross_total: string;
    net_total: string;
    kasbon_total: string;
  }>(sql`
    SELECT pr.id, pr.company_id, pr.month, pr.year, pr.status, pr.posting_status,
           pr.accounting_entry_id, pr.payment_entry_id, pr.posted_at,
           COUNT(pi.id)::text AS item_count,
           COUNT(*) FILTER (WHERE pi.is_paid)::text AS paid_item_count,
           COALESCE(SUM(pi.base_salary + pi.allowance), 0)::text AS gross_total,
           COALESCE(SUM(pi.net_salary), 0)::text AS net_total,
           COALESCE(SUM(pi.kasbon_deduction), 0)::text AS kasbon_total
    FROM payroll_runs pr
    LEFT JOIN payroll_items pi ON pi.run_id = pr.id
    WHERE pr.id = ${RUN_ID} AND pr.company_id = ${COMPANY_ID}
    GROUP BY pr.id
  `);
  const run = runResult.rows[0];
  assert(run, "payroll run 31 is missing for company 1");
  const netAmount = Number(run.net_total);
  assert(Math.abs(netAmount - EXPECTED_NET_AMOUNT) <= 0.01, `net amount is ${run.net_total}, expected ${EXPECTED_NET_AMOUNT}`);

  const evidenceResult = await db.execute<{
    mutation_id: number;
    transaction_date: string;
    mutation_amount: string;
    mutation_status: string;
    mutation_linked_type: string | null;
    mutation_linked_id: number | null;
    mutation_journal_entry_id: number | null;
    payment_id: number;
    payment_amount: string;
    payment_status: string;
    payment_entry_id: number | null;
    payment_source_type: string | null;
    payment_source_doc_id: number | null;
    payment_source_id: number | null;
    match_id: number;
    match_status: string;
  }>(sql`
    SELECT bm.id AS mutation_id, bm.transaction_date, bm.amount AS mutation_amount,
           bm.status AS mutation_status, bm.linked_transaction_type AS mutation_linked_type,
           bm.linked_transaction_id AS mutation_linked_id,
           bm.journal_entry_id AS mutation_journal_entry_id,
           ap.id AS payment_id, ap.amount AS payment_amount, ap.status AS payment_status,
           ap.entry_id AS payment_entry_id, ap.source_type AS payment_source_type,
           ap.source_doc_id AS payment_source_doc_id, ap.source_id AS payment_source_id,
           brm.id AS match_id, brm.status AS match_status
    FROM bank_mutations bm
    JOIN accounting_payments ap ON ap.id = bm.matched_payment_id
    JOIN bank_reconciliation_matches brm
      ON brm.mutation_id = bm.id
     AND brm.candidate_type = 'accounting_payment'
     AND brm.candidate_id = ap.id
     AND brm.status = 'approved'
    WHERE bm.company_id = ${COMPANY_ID}
      AND bm.amount::numeric = ${netAmount}
      AND bm.direction = 'OUT'
      AND bm.status IN ('matched', 'posted')
      AND bm.linked_transaction_type = 'accounting_payment'
      AND bm.linked_transaction_id = ap.id
      AND ap.company_id = ${COMPANY_ID}
      AND ap.amount::numeric = ${netAmount}
      AND ap.status = 'posted'
      AND (
        (ap.source_type = 'payroll' AND ap.source_doc_id = ${RUN_ID})
        OR (ap.source_type = 'hrd_salary_payment' AND ap.source_id = ${RUN_ID})
      )
    ORDER BY bm.id
  `);

  const candidateResult = await db.execute<{
    mutation_id: number;
    transaction_date: string;
    description: string;
    amount: string;
    direction: string;
    status: string;
    linked_transaction_type: string | null;
    linked_transaction_id: number | null;
    matched_payment_id: number | null;
  }>(sql`
    SELECT bm.id AS mutation_id, bm.transaction_date, bm.description, bm.amount,
           bm.direction, bm.status, bm.linked_transaction_type,
           bm.linked_transaction_id, bm.matched_payment_id
    FROM bank_mutations bm
    WHERE bm.company_id = ${COMPANY_ID}
      AND (
        bm.description ~* '(gaji|salary|payroll)'
        OR EXISTS (
          SELECT 1
          FROM payroll_items pi
          JOIN employees e ON e.id = pi.employee_id
          WHERE pi.run_id = ${RUN_ID}
            AND btrim(concat_ws(' ', e.first_name, e.last_name)) <> ''
            AND bm.description ILIKE '%' || btrim(concat_ws(' ', e.first_name, e.last_name)) || '%'
        )
      )
    ORDER BY bm.transaction_date DESC, bm.id DESC
    LIMIT 100
  `);

  const audit = {
    run: {
      id: run.id,
      companyId: run.company_id,
      period: `${run.year}-${String(run.month).padStart(2, "0")}`,
      status: run.status,
      postingStatus: run.posting_status,
      accountingEntryId: run.accounting_entry_id,
      paymentEntryId: run.payment_entry_id,
    },
    totals: {
      items: Number(run.item_count),
      paidItems: Number(run.paid_item_count),
      gross: run.gross_total,
      net: run.net_total,
      kasbon: run.kasbon_total,
    },
    evidence: evidenceResult.rows,
    candidates: candidateResult.rows,
  };

  if (evidenceResult.rows.length !== 1) {
    console.log(JSON.stringify({
      mode: APPLY ? "apply-request-blocked" : "dry-run",
      outcome: "PAYROLL_PAYMENT_EVIDENCE_MISSING_OR_NON_UNIQUE",
      reason: "Run 31 remains unposted; no unique approved bank/payment record links company 1, run 31, and the exact net amount.",
      audit,
    }, null, 2));
    process.exitCode = 0;
  } else if (!APPLY) {
    console.log(JSON.stringify({
      mode: "dry-run",
      outcome: "PAYROLL_PAYMENT_EVIDENCE_READY",
      reason: "Evidence is unique and exact, but no journal was posted because --apply was not supplied.",
      audit,
    }, null, 2));
  } else {
    assert(bankMutationId === evidenceResult.rows[0]!.mutation_id, "pass the exact --bank-mutation-id from the approved evidence");
    assert(accountingPaymentId === evidenceResult.rows[0]!.payment_id, "pass the exact --accounting-payment-id from the approved evidence");
    assert(salaryPayableAccountId != null, "--salary-payable-account-id is required with --apply");
    assert(cashBankAccountId != null, "--cash-bank-account-id is required with --apply");

    const result = await PayrollJournalService.postVerifiedPaymentJournal({
      companyId: COMPANY_ID,
      payrollRunId: RUN_ID,
      bankMutationId: bankMutationId!,
      accountingPaymentId: accountingPaymentId!,
      salaryPayableAccountId: salaryPayableAccountId!,
      cashBankAccountId: cashBankAccountId!,
      date: evidenceResult.rows[0]!.transaction_date,
      actor: "payroll-run31-remediation",
    });

    const finalResult = await db.execute<{
      payment_entry_id: number | null;
      run_status: string;
      posting_status: string | null;
      payment_status: string;
      payment_entry_id_source: number | null;
      bank_status: string;
      bank_journal_entry_id: number | null;
    }>(sql`
      SELECT pr.payment_entry_id, pr.status AS run_status, pr.posting_status,
             ap.status AS payment_status, ap.entry_id AS payment_entry_id_source,
             bm.status AS bank_status, bm.journal_entry_id AS bank_journal_entry_id
      FROM payroll_runs pr
      JOIN accounting_payments ap ON ap.id = ${result.paymentId}
      JOIN bank_mutations bm ON bm.id = ${result.bankMutationId}
      WHERE pr.id = ${RUN_ID} AND pr.company_id = ${COMPANY_ID}
    `);
    const final = finalResult.rows[0];
    assert(final, "final payroll payment linkage is missing");
    assert(final.payment_entry_id === result.entryId, "run payment_entry_id does not match posted journal");
    assert(final.payment_entry_id_source === result.entryId, "source payment entry_id does not match posted journal");
    assert(final.bank_journal_entry_id === result.entryId, "bank evidence journal_entry_id does not match posted journal");
    assert(final.run_status === "paid" && final.posting_status === "posted", "run status/posting status are not paid/posted");
    assert(final.payment_status === "posted" && final.bank_status === "posted", "source payment or bank evidence is not posted");
    console.log(JSON.stringify({ mode: "apply", outcome: "PAYROLL_PAYMENT_POSTED", result, final }, null, 2));
  }
} finally {
  await endPool();
}