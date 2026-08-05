import pg from "pg";
const { Client } = pg;
const DB_URL = process.env.SUPABASE_DATABASE_URL_DEV;
const client = new Client({ connectionString: DB_URL, ssl: { rejectUnauthorized: false } });
await client.connect();
const COMPANY_ID = 1;
let pass = (l,d="")=>console.log(`  PASS: ${l} ${d}`);
let fail = (l,d="")=>{console.error(`  FAIL: ${l} ${d}`); process.exitCode=1;};

// cleanup previous test runs
await client.query(`DELETE FROM payroll_items WHERE run_id IN (SELECT id FROM payroll_runs WHERE company_id=$1 AND month=99)`, [COMPANY_ID]);
await client.query(`DELETE FROM payroll_runs WHERE company_id=$1 AND month=99`, [COMPANY_ID]);

const run = (await client.query(
  `INSERT INTO payroll_runs (company_id, month, year, status, notes) VALUES ($1,99,2026,'draft','smoke test') RETURNING *`,
  [COMPANY_ID]
)).rows[0];
console.log("Created run", run.id);

// generate items for employee 23 (Angelia Nirawana) only, for speed — direct insert
const emp = (await client.query(`SELECT * FROM employees WHERE id=23`)).rows[0];
const base = Number(emp.salary);
const item = (await client.query(
  `INSERT INTO payroll_items (run_id, employee_id, base_salary, allowance, gross_salary, bpjs_jht_employee, bpjs_kes_employee, pph21, kasbon_deduction, other_deductions, total_deductions, net_salary, kasbon_balance_after)
   VALUES ($1,$2,$3,0,$3,0,0,0,0,0,0,$3,0) RETURNING *`,
  [run.id, emp.id, base]
)).rows[0];
console.log("Created item", item.id, "base", base);

const adv = (await client.query(`SELECT * FROM cash_advances WHERE id=31`)).rows[0];
if (!adv) fail("test advance missing"); else pass("test advance present", adv.remaining_amount);

client.end();
