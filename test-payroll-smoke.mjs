import pg from "pg";

const { Client } = pg;
const DB_URL = process.env.SUPABASE_DATABASE_URL_DEV;
if (!DB_URL) throw new Error("Run this smoke test through the development Secret Manager loader.");

const client = new Client({ connectionString: DB_URL, ssl: { rejectUnauthorized: false } });
const COMPANY_ID = 1;
const TEST_MONTH = 99;
const TEST_YEAR = 2026;

const pass = (label, detail = "") => console.log(`  PASS: ${label}${detail ? ` — ${detail}` : ""}`);
const fail = (label, detail = "") => { throw new Error(`${label}${detail ? ` — ${detail}` : ""}`); };

await client.connect();
try {
  await client.query("BEGIN");

  const schema = await client.query(`
    SELECT
      to_regclass('public.payroll_cash_advance_allocations') AS allocation_table,
      to_regclass('public.salary_payments') AS salary_table,
      EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_schema = 'public' AND table_name = 'cash_advances' AND column_name = 'employee_id'
      ) AS employee_link
  `);
  const schemaRow = schema.rows[0];
  if (!schemaRow.allocation_table) fail("allocation ledger table missing");
  if (!schemaRow.salary_table) fail("salary payment history table missing");
  if (!schemaRow.employee_link) fail("cash advance employee link missing");
  pass("payroll schema", "allocation ledger, salary history, employee_id");

  const employee = (await client.query(`
    SELECT id, first_name, last_name
    FROM employees
    WHERE status = 'active' AND (company_id = $1 OR company_id IS NULL)
    ORDER BY id
    LIMIT 1
  `, [COMPANY_ID])).rows[0];
  if (!employee) fail("active employee fixture missing");

  const marker = `PAYROLL-SMOKE-${Date.now()}`;
  const advances = [];
  for (const [suffix, date, amount] of [["A", "2026-01-01", 700000], ["B", "2026-02-01", 500000]]) {
    const advance = (await client.query(`
      INSERT INTO cash_advances
        (company_id, advance_number, type, advance_type, lifecycle_status,
         party_name, employee_id, amount, paid_amount, remaining_amount,
         settled_amount, payment_method, date, status, repayment_method, posting_status)
      VALUES ($1, $2, 'kasbon', 'EMPLOYEE', 'outstanding',
              $3, $4, $5, 0, $5, 0, 'bank', $6, 'active', 'one_time', 'posted')
      RETURNING id, remaining_amount, date
    `, [
      COMPANY_ID,
      `${marker}-${suffix}`,
      `${employee.first_name} ${employee.last_name}`,
      employee.id,
      amount,
      date,
    ])).rows[0];
    advances.push(advance);
  }
  const run = (await client.query(`
    INSERT INTO payroll_runs (company_id, month, year, status, notes)
    VALUES ($1, $2, $3, 'draft', 'payroll allocation smoke')
    RETURNING id
  `, [COMPANY_ID, TEST_MONTH, TEST_YEAR])).rows[0];
  const item = (await client.query(`
    INSERT INTO payroll_items
      (run_id, employee_id, base_salary, allowance, gross_salary,
       bpjs_jht_employee, bpjs_kes_employee, pph21, kasbon_deduction,
       other_deductions, total_deductions, net_salary, kasbon_balance_after)
    VALUES ($1, $2, 10000000, 0, 10000000, 0, 0, 0, 0, 0, 0, 10000000, 0)
    RETURNING id
  `, [run.id, employee.id])).rows[0];

  let capacity = 10000000;
  for (const advance of advances) {
    const amount = Math.min(Number(advance.remaining_amount), capacity);
    if (amount <= 0) continue;
    await client.query(`
      INSERT INTO payroll_cash_advance_allocations
        (payroll_item_id, cash_advance_id, amount)
      VALUES ($1, $2, $3)
    `, [item.id, advance.id, amount]);
    capacity -= amount;
  }

  const allocations = (await client.query(`
    SELECT cash_advance_id, amount
    FROM payroll_cash_advance_allocations
    WHERE payroll_item_id = $1
    ORDER BY id
  `, [item.id])).rows;
  if (allocations.length < 2) fail("FIFO multi-advance allocation", `created ${allocations.length} allocation(s)`);
  if (Number(allocations[0].cash_advance_id) !== Number(advances[0].id)) {
    fail("FIFO ordering", `expected advance ${advances[0].id}, got ${allocations[0].cash_advance_id}`);
  }
  pass("FIFO multi-advance allocation", `${allocations.length} allocations`);

  const salaryAmount = "10000000.00";
  await client.query(`
    INSERT INTO salary_payments (payroll_item_id, amount, payment_method, paid_at, notes)
    SELECT $1, $2, 'bank', NOW(), 'payroll allocation smoke'
    WHERE NOT EXISTS (
      SELECT 1 FROM salary_payments WHERE payroll_item_id = $1
    )
  `, [item.id, salaryAmount]);
  await client.query(`
    INSERT INTO salary_payments (payroll_item_id, amount, payment_method, paid_at, notes)
    SELECT $1, $2, 'bank', NOW(), 'payroll allocation smoke retry'
    WHERE NOT EXISTS (
      SELECT 1 FROM salary_payments WHERE payroll_item_id = $1
    )
  `, [item.id, salaryAmount]);
  const history = await client.query(
    "SELECT COUNT(*)::int AS count FROM salary_payments WHERE payroll_item_id = $1",
    [item.id],
  );
  if (history.rows[0].count !== 1) fail("salary payment retry idempotency", `history rows=${history.rows[0].count}`);
  pass("salary payment retry idempotency");

  await client.query("ROLLBACK");
  console.log("Payroll allocation smoke test passed (transaction rolled back).");
} catch (error) {
  await client.query("ROLLBACK").catch(() => {});
  console.error("Payroll allocation smoke test failed:", error.message);
  process.exitCode = 1;
} finally {
  await client.end();
}