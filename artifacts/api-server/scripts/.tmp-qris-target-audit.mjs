import pg from "pg";

const pool = new pg.Pool({
  connectionString: process.env.SUPABASE_DATABASE_URL,
  ssl: { rejectUnauthorized: false },
  max: 1,
});

const queries = [
  ["tables", `
    SELECT table_schema, table_name, column_name, data_type
    FROM information_schema.columns
    WHERE (table_schema, table_name) IN (
      ('sport_center', 'payment_settlement_batches'),
      ('sport_center', 'sport_payments'),
      ('public', 'qris_settlements'),
      ('public', 'qris_settlement_items')
    )
    ORDER BY table_schema, table_name, ordinal_position
  `, []],
  ["batch", `
    SELECT id, status, bank_mutation_id, canonical_bank_mutation_id,
           settlement_journal_id, gross_amount, net_amount, company_id,
           bank_account_id, provider_code, settlement_date,
           settlement_rule_version, source, correlation_id
    FROM sport_center.payment_settlement_batches
    WHERE id = $1
  `, [3505]],
  ["payment", `
    SELECT id, amount, status::text AS status, settlement_status,
           payment_method::text AS payment_method,
           payment_provider::text AS payment_provider, company_id,
           bank_account_id, expected_settlement_date::text AS expected_settlement_date
    FROM sport_center.sport_payments
    WHERE id = $1
  `, [3505]],
  ["legacy", `
    SELECT id, status, bank_mutation_id, gross_amount, net_amount,
           company_id, settlement_date
    FROM public.qris_settlements
    WHERE id = $1
  `, [3505]],
  ["items", `
    SELECT *
    FROM public.qris_settlement_items
    WHERE settlement_id = $1
  `, [3505]],
  ["matches", `
    SELECT id, mutation_id, candidate_type, candidate_id, candidate_source,
           status, match_score, match_reason, snapshot
    FROM public.bank_reconciliation_matches
    WHERE mutation_id = $1
    ORDER BY id
  `, [630]],
];

try {
  for (const [label, text, params] of queries) {
    try {
      const result = await pool.query(text, params);
      console.log(`---${label}---`);
      console.log(JSON.stringify(result.rows, null, 2));
    } catch (error) {
      console.log(`---${label} ERROR---`);
      console.log(error instanceof Error ? error.message : String(error));
    }
  }
} finally {
  await pool.end();
}