import pg from "pg";

const pool = new pg.Pool({
  connectionString: process.env.SUPABASE_DATABASE_URL,
  ssl: { rejectUnauthorized: false },
  max: 1,
});

const queries = [
  ["candidate table", `
    SELECT *
    FROM public.qris_mutation_batch_candidates
    WHERE id = $1
  `, [3505]],
  ["candidate items", `
    SELECT c.id AS candidate_id, item
    FROM public.qris_mutation_batch_candidates c
    CROSS JOIN LATERAL jsonb_array_elements(COALESCE(c.payment_items, '[]'::jsonb)) item
    WHERE c.id = $1
  `, [3505]],
  ["live payments", `
    SELECT p.id, p.amount, p.status::text AS status, p.settlement_status,
           p.payment_method::text AS payment_method,
           p.payment_provider::text AS payment_provider, p.company_id,
           p.bank_account_id, p.expected_settlement_date::text AS expected_settlement_date
    FROM sport_center.sport_payments p
    WHERE p.id = ANY($1::integer[])
    ORDER BY p.id
  `, [[436, 502, 503]]],
  ["payment batches", `
    SELECT DISTINCT b.id, b.status, b.bank_mutation_id,
           b.canonical_bank_mutation_id, b.settlement_journal_id,
           b.gross_amount, b.net_amount, b.company_id, b.provider_code,
           b.settlement_date, b.settlement_rule_version, b.source,
           i.payment_id
    FROM sport_center.payment_settlement_batches b
    JOIN sport_center.payment_settlement_items i ON i.settlement_id = b.id
    WHERE i.payment_id = ANY($1::integer[])
      AND i.item_status = 'active'
    ORDER BY b.id, i.payment_id
  `, [[436, 502, 503]]],
  ["candidate related batches", `
    SELECT b.id, b.status, b.bank_mutation_id, b.canonical_bank_mutation_id,
           b.settlement_journal_id, b.gross_amount, b.net_amount,
           b.company_id, b.bank_account_id, b.provider_code,
           b.settlement_date, b.settlement_rule_version, b.source,
           b.correlation_id
    FROM sport_center.payment_settlement_batches b
    WHERE b.id = $1
       OR b.correlation_id = (
         SELECT settlement_reference
         FROM public.qris_mutation_batch_candidates
         WHERE id = $1
       )
  `, [3505]],
  ["function defs", `
    SELECT p.proname, pg_get_function_identity_arguments(p.oid) AS args,
           pg_get_functiondef(p.oid) AS definition
    FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'sport_center'
      AND p.proname IN ('create_settlement_journal_draft', 'finalize_payment_settlement')
  `, []],
  ["related matches", `
    SELECT id, mutation_id, candidate_type, candidate_id, candidate_source,
           status, match_score, match_reason
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