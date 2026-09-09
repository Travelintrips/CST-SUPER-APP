import pg from "pg";
const { Pool } = pg;
const pool = new Pool({ connectionString: process.env.SUPABASE_DATABASE_URL, max: 1 });
const query = `
SELECT bm.id, bm.company_id, bm.status, bm.amount, bm.direction,
       bm.transaction_date, bm.description, bm.mutation_key, bm.journal_entry_id,
       ae.status AS journal_status, ae.entry_number,
       brm.id AS match_id, brm.candidate_type, brm.candidate_id, brm.status AS match_status
FROM bank_mutations bm
LEFT JOIN accounting_entries ae ON ae.id = bm.journal_entry_id
LEFT JOIN bank_reconciliation_matches brm
  ON brm.mutation_id = bm.id AND brm.status IN ('approved', 'candidate')
WHERE bm.transaction_date::date = $1::date
  AND ABS(bm.amount::numeric - $2::numeric) <= 0.01
  AND bm.direction = 'OUT'
ORDER BY bm.id DESC`;
const { rows } = await pool.query(query, ["2026-08-20", 15200640]);
console.log(JSON.stringify(rows, null, 2));
await pool.end();
