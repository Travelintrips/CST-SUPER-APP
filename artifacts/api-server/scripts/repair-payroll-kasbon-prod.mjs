/**
 * Reconcile a legacy payroll run whose kasbon amounts were already reflected
 * in cash_advances and whose accrual journal may predate payroll_run links.
 *
 * This does not change paid_amount or remaining_amount and never creates a
 * payment journal. It only:
 *   - links each deduction item to one exact employee advance;
 *   - records the already-applied payroll repayment once;
 *   - links one exact, balanced legacy accrual journal to the run;
 *   - normalizes the run to approved/posted when no payment evidence exists.
 *
 * Dry-run is the default. Production mutation requires --apply.
 */
import pg from "pg";

const runIdArg = process.argv.find((arg) => arg.startsWith("--run-id="));
const runId = Number(runIdArg?.split("=")[1] ?? "31");
const companyId = 1;
const apply = process.argv.includes("--apply");

if (!Number.isInteger(runId) || runId <= 0) {
  throw new Error("--run-id must be a positive integer");
}
if (!process.env.SUPABASE_DATABASE_URL) {
  throw new Error("SUPABASE_DATABASE_URL is required; run through load-secrets.mjs");
}

const client = new pg.Client({
  connectionString: process.env.SUPABASE_DATABASE_URL,
  ssl: { rejectUnauthorized: false },
});

const money = (value) => Number(value ?? 0);
const sameMoney = (a, b) => Math.abs(money(a) - money(b)) <= 0.005;
const sqlDate = (value) => value instanceof Date
  ? value.toISOString().slice(0, 10)
  : String(value ?? "").slice(0, 10);

await client.connect();
try {
  await client.query("BEGIN");

  const runResult = await client.query(
    `SELECT id, company_id, month, year, status, posting_status,
            accounting_entry_id, payment_entry_id, posted_at
       FROM payroll_runs
      WHERE id = $1 AND company_id = $2
      FOR UPDATE`,
    [runId, companyId],
  );
  const run = runResult.rows[0];
  if (!run) throw new Error(`Payroll run ${runId} tidak ditemukan untuk company ${companyId}`);
  if (run.payment_entry_id) {
    throw new Error("Run sudah memiliki journal pembayaran; repair legacy ini diblokir.");
  }

  const payrollTotalsResult = await client.query(
    `SELECT count(*)::int AS item_count,
            count(*) FILTER (WHERE is_paid)::int AS paid_item_count,
            coalesce(sum(base_salary + allowance), 0)::numeric AS gross_total,
            coalesce(sum(net_salary), 0)::numeric AS net_total,
            coalesce(sum(kasbon_deduction), 0)::numeric AS kasbon_total
       FROM payroll_items
      WHERE run_id = $1`,
    [runId],
  );
  const payrollTotals = payrollTotalsResult.rows[0];
  if (!payrollTotals || Number(payrollTotals.item_count) === 0) {
    throw new Error(`Payroll run ${runId} tidak memiliki item.`);
  }

  const period = `${run.year}-${String(run.month).padStart(2, "0")}`;
  const legacyAccrualRef = `PAYROLL/${period}/R${runId}`;
  const accrualResult = await client.query(
    `SELECT id, status, source, source_id, ref, entry_number,
            total_debit, total_credit, date
       FROM accounting_entries
      WHERE company_id = $1
        AND source = 'payroll'
        AND status = 'posted'
        AND (ref = $2 OR entry_number = $2)
      ORDER BY id
      FOR UPDATE`,
    [companyId, legacyAccrualRef],
  );
  const accrualCandidates = accrualResult.rows;
  if (accrualCandidates.length > 1) {
    throw new Error(`Ditemukan lebih dari satu jurnal accrual legacy untuk ${legacyAccrualRef}.`);
  }
  const accrual = accrualCandidates[0] ?? null;
  if (!accrual && !run.accounting_entry_id) {
    throw new Error(`Jurnal accrual legacy ${legacyAccrualRef} tidak ditemukan; repair berhenti fail-closed.`);
  }
  if (run.accounting_entry_id && accrual && Number(run.accounting_entry_id) !== Number(accrual.id)) {
    throw new Error(`Run menunjuk entry ${run.accounting_entry_id}, tetapi kandidat legacy adalah ${accrual.id}.`);
  }
  if (accrual) {
    const lineResult = await client.query(
      `SELECT count(*)::int AS line_count,
              coalesce(sum(debit), 0)::numeric AS debit_total,
              coalesce(sum(credit), 0)::numeric AS credit_total
         FROM accounting_entry_lines
        WHERE entry_id = $1`,
      [accrual.id],
    );
    const lines = lineResult.rows[0];
    if (
      Number(lines.line_count) < 2 ||
      !sameMoney(lines.debit_total, payrollTotals.gross_total) ||
      !sameMoney(lines.credit_total, payrollTotals.gross_total) ||
      !sameMoney(accrual.total_debit, payrollTotals.gross_total) ||
      !sameMoney(accrual.total_credit, payrollTotals.gross_total)
    ) {
      throw new Error(`Jurnal accrual ${accrual.id} tidak balanced atau nominalnya tidak sama dengan payroll gross.`);
    }
  }

  const paymentResult = await client.query(
    `SELECT id, status, source, source_id, ref, total_debit, total_credit
       FROM accounting_entries
      WHERE company_id = $1
        AND (
          (source = 'hrd_salary_payment' AND source_id = $2)
          OR ref = $3
          OR entry_number = $3
        )
      ORDER BY id
      FOR UPDATE`,
    [companyId, runId, `PAYROLL-PAY-${runId}`],
  );
  if (paymentResult.rows.length > 1) {
    throw new Error(`Ditemukan lebih dari satu jurnal pembayaran untuk payroll run ${runId}.`);
  }
  const payment = paymentResult.rows[0] ?? null;
  if (payment && Number(payrollTotals.paid_item_count) === 0) {
    throw new Error(`Jurnal pembayaran ${payment.id} ada, tetapi seluruh item payroll belum ditandai dibayar.`);
  }

  const itemResult = await client.query(
    `SELECT pi.id AS item_id, pi.employee_id, pi.kasbon_deduction,
            pi.kasbon_balance_after, pi.cash_advance_id,
            trim(concat_ws(' ', e.first_name, e.last_name)) AS employee_name
       FROM payroll_items pi
       JOIN employees e ON e.id = pi.employee_id
      WHERE pi.run_id = $1
        AND pi.kasbon_deduction::numeric > 0
      ORDER BY pi.employee_id, pi.id
      FOR UPDATE OF pi`,
    [runId],
  );

  const usedAdvanceIds = new Set();
  const repairs = [];

  for (const item of itemResult.rows) {
    if (item.cash_advance_id != null) {
      usedAdvanceIds.add(Number(item.cash_advance_id));
      continue;
    }

    const advanceResult = await client.query(
      `SELECT id, employee_id, advance_number, amount, paid_amount,
              remaining_amount, status, lifecycle_status, date
         FROM cash_advances
        WHERE company_id = $1
          AND employee_id::text = $2
          AND paid_amount::numeric > 0
        ORDER BY date ASC, id ASC
        FOR UPDATE`,
      [companyId, String(item.employee_id)],
    );

    const candidates = advanceResult.rows.filter((advance) =>
      !usedAdvanceIds.has(Number(advance.id)) &&
      sameMoney(advance.paid_amount, item.kasbon_deduction) &&
      sameMoney(advance.remaining_amount, item.kasbon_balance_after),
    );
    if (candidates.length !== 1) {
      throw new Error(
        `Tidak bisa menentukan kasbon unik untuk item ${item.item_id} ` +
        `(${item.employee_name}, deduction=${item.kasbon_deduction}, ` +
        `balance_after=${item.kasbon_balance_after}, candidates=${candidates.length}).`,
      );
    }

    const advance = candidates[0];
    usedAdvanceIds.add(Number(advance.id));
    repairs.push({ item, advance });
  }

  const postedDate = sqlDate(run.posted_at) || new Date().toISOString().slice(0, 10);
  const notes = `Pemulihan Potongan Payroll ${period} (run ${runId})`;
  const legacyNote = accrual
    ? `LEGACY/MANUAL RECONCILIATION: accrual entry ${accrual.id} (${legacyAccrualRef}) linked; payment journal intentionally not created or linked because no payment evidence exists. Payroll kasbon repayment rows are retained as source evidence and are not re-posted.`
    : null;

  console.log(JSON.stringify({
    mode: apply ? "apply" : "dry-run",
    run: { id: run.id, companyId: run.company_id, period: `${run.year}-${String(run.month).padStart(2, "0")}`, status: run.status, postingStatus: run.posting_status },
    payrollTotals: {
      itemCount: Number(payrollTotals.item_count),
      paidItemCount: Number(payrollTotals.paid_item_count),
      gross: payrollTotals.gross_total,
      net: payrollTotals.net_total,
      kasbon: payrollTotals.kasbon_total,
    },
    accrual: accrual
      ? { id: accrual.id, ref: accrual.ref, status: accrual.status, totalDebit: accrual.total_debit, totalCredit: accrual.total_credit }
      : null,
    payment: payment ? { id: payment.id, status: payment.status, source: payment.source } : null,
    legacyNote,
    repairCount: repairs.length,
    repairs: repairs.map(({ item, advance }) => ({
      itemId: item.item_id,
      employeeId: item.employee_id,
      employeeName: item.employee_name,
      advanceId: advance.id,
      advanceNumber: advance.advance_number,
      amount: item.kasbon_deduction,
      remainingAfter: item.kasbon_balance_after,
    })),
  }, null, 2));

  if (apply) {
    for (const { item, advance } of repairs) {
      await client.query(
        `UPDATE payroll_items
            SET cash_advance_id = $1
          WHERE id = $2 AND run_id = $3 AND cash_advance_id IS NULL`,
        [advance.id, item.item_id, runId],
      );

      const existingRepayment = await client.query(
        `SELECT id
           FROM cash_advance_repayments
          WHERE advance_id = $1
            AND payment_method = 'payroll'
            AND amount::numeric = $2
            AND date = $3
            AND notes = $4
          LIMIT 1`,
        [advance.id, item.kasbon_deduction, postedDate, notes],
      );
      if (!existingRepayment.rows.length) {
        await client.query(
          `INSERT INTO cash_advance_repayments
             (advance_id, amount, payment_method, date, notes, entry_id)
           VALUES ($1, $2, 'payroll', $3, $4, NULL)`,
          [advance.id, item.kasbon_deduction, postedDate, notes],
        );
      }

      const remaining = money(advance.remaining_amount);
      const settled = remaining <= 0.005;
      await client.query(
        `UPDATE cash_advances
            SET status = $1,
                lifecycle_status = $2,
                repaid_at = CASE WHEN $3 THEN COALESCE(repaid_at, $4::timestamp) ELSE repaid_at END,
                updated_at = NOW()
          WHERE id = $5 AND company_id = $6`,
        [
          settled ? "repaid" : "partial",
          settled ? "settled" : "partially_settled",
          settled,
          run.posted_at ?? new Date().toISOString(),
          advance.id,
          companyId,
        ],
      );
    }

    if (accrual && !run.accounting_entry_id) {
      await client.query(
        `UPDATE payroll_runs
            SET accounting_entry_id = $1,
                status = CASE WHEN $2 THEN 'approved' ELSE status END,
                approved_at = COALESCE(approved_at, posted_at, NOW()),
                posting_status = 'posted',
                posting_error = NULL,
                notes = CASE
                  WHEN notes IS NULL OR btrim(notes) = '' THEN $3
                  ELSE notes || E'\n' || $3
                END
          WHERE id = $4 AND company_id = $5
            AND accounting_entry_id IS NULL
            AND payment_entry_id IS NULL`,
        [
          accrual.id,
          !payment && Number(payrollTotals.paid_item_count) === 0,
          legacyNote,
          runId,
          companyId,
        ],
      );
    }
  }

  if (apply) await client.query("COMMIT");
  else await client.query("ROLLBACK");
} catch (error) {
  await client.query("ROLLBACK");
  throw error;
} finally {
  await client.end();
}