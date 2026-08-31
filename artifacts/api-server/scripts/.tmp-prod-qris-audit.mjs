import pg from "pg";

if (process.env.APP_ENV !== "production" || process.env.NODE_ENV !== "production") {
  throw new Error("Production audit requires APP_ENV=production and NODE_ENV=production");
}

const pool = new pg.Pool({
  connectionString: process.env.SUPABASE_DATABASE_URL,
  ssl: { rejectUnauthorized: false },
  max: 1,
  connectionTimeoutMillis: 15000,
});

async function query(text, params = []) {
  const result = await pool.query(text, params);
  return result.rows;
}

try {
  const meta = await query(`
    SELECT current_database() AS database_name,
           current_setting('server_version') AS server_version,
           current_setting('app.environment', true) AS app_environment
  `);

  const columns = await query(`
    SELECT table_schema, table_name, column_name, data_type, udt_name
      FROM information_schema.columns
     WHERE (table_schema, table_name) IN (
       ('sport_center', 'sport_payments'),
       ('sport_center', 'accounting_journals'),
       ('sport_center', 'payment_accounting_outbox'),
       ('sport_center', 'central_finance_processing'),
       ('public', 'sport_payments'),
       ('public', 'accounting_payments'),
       ('public', 'accounting_entries')
     )
     ORDER BY table_schema, table_name, ordinal_position
  `);

  const routines = await query(`
    SELECT n.nspname AS schema_name,
           p.proname AS function_name,
           pg_get_function_identity_arguments(p.oid) AS identity_arguments,
           pg_get_function_result(p.oid) AS result_type
      FROM pg_proc p
      JOIN pg_namespace n ON n.oid = p.pronamespace
     WHERE n.nspname = 'sport_center'
       AND p.proname IN (
         'create_payment_accounting_draft',
         'create_payment_settlement_batch',
         'create_payment_settlement_supplemental_batch',
         'create_settlement_journal_draft',
         'finalize_payment_settlement',
         'ensure_canonical_bank_mutation_for_settlement'
       )
     ORDER BY p.proname, identity_arguments
  `);

  const totals = await query(`
    SELECT
      COUNT(*) FILTER (WHERE sp.status::text = 'confirmed')::int AS confirmed_total,
      COUNT(*) FILTER (
        WHERE sp.status::text = 'confirmed'
          AND LOWER(COALESCE(sp.payment_method::text, '')) = 'qris'
      )::int AS confirmed_qris_total,
      COUNT(*) FILTER (
        WHERE sp.status::text = 'confirmed'
          AND LOWER(COALESCE(sp.payment_method::text, '')) = 'qris'
          AND j.id IS NULL
      )::int AS confirmed_qris_without_any_journal,
      COUNT(*) FILTER (
        WHERE sp.status::text = 'confirmed'
          AND LOWER(COALESCE(sp.payment_method::text, '')) = 'qris'
          AND posted.posted_count <> 1
      )::int AS confirmed_qris_without_unique_posted_journal
    FROM sport_center.sport_payments sp
    LEFT JOIN LATERAL (
      SELECT COUNT(*)::int AS posted_count
        FROM sport_center.accounting_journals j2
       WHERE j2.payment_id = sp.id
         AND j2.journal_type::text = 'payment_confirmed'
         AND COALESCE(j2.is_reversal, false) = false
         AND j2.status::text = 'posted'
    ) posted ON true
    LEFT JOIN sport_center.accounting_journals j
      ON j.payment_id = sp.id
     AND j.journal_type::text = 'payment_confirmed'
     AND COALESCE(j.is_reversal, false) = false
    WHERE sp.status::text = 'confirmed'
      AND LOWER(COALESCE(sp.payment_method::text, '')) = 'qris'
  `);

  const orphanPayments = await query(`
    SELECT
      sp.id,
      sp.id::text AS payment_number,
      sp.amount,
      sp.payment_method::text AS payment_method,
      sp.payment_provider::text AS payment_provider,
      sp.bank_account_id::text AS bank_account_id,
      sp.expected_settlement_date::text AS expected_settlement_date,
      sp.confirmed_at,
      sp.company_id,
      sp.booking_id,
      journals.journal_count,
      journals.posted_journal_count,
      journals.journal_ids,
      o.id AS outbox_id,
      o.status AS outbox_status,
      o.attempts AS outbox_attempts,
      o.last_error AS outbox_last_error,
      o.processed_at AS outbox_processed_at,
      c.status AS processing_status,
      c.attempts AS processing_attempts,
      c.last_error AS processing_last_error,
      c.processed_at AS processing_processed_at
    FROM sport_center.sport_payments sp
    LEFT JOIN LATERAL (
      SELECT COUNT(*)::int AS journal_count,
             COUNT(*) FILTER (WHERE j.status::text = 'posted')::int AS posted_journal_count,
             ARRAY_REMOVE(ARRAY_AGG(j.id ORDER BY j.id), NULL) AS journal_ids
        FROM sport_center.accounting_journals j
       WHERE j.payment_id = sp.id
         AND j.journal_type::text = 'payment_confirmed'
         AND COALESCE(j.is_reversal, false) = false
    ) journals ON true
    LEFT JOIN LATERAL (
      SELECT o1.*
        FROM sport_center.payment_accounting_outbox o1
       WHERE o1.payment_id = sp.id
         AND o1.event_type = 'payment_confirmed'
       ORDER BY o1.id DESC
       LIMIT 1
    ) o ON true
    LEFT JOIN LATERAL (
      SELECT c1.*
        FROM sport_center.central_finance_processing c1
       WHERE c1.source_payment_id = sp.id
         AND c1.event_type = 'payment_confirmed'
       ORDER BY c1.id DESC
       LIMIT 1
    ) c ON true
    WHERE sp.status::text = 'confirmed'
      AND LOWER(COALESCE(sp.payment_method::text, '')) = 'qris'
      AND journals.posted_journal_count <> 1
    ORDER BY sp.id
  `);

  const mirrors = await query(`
    SELECT
      sp.id AS mirror_payment_id,
      sp.payment_number,
      sp.amount,
      sp.status::text AS mirror_status,
      sp.posting_status,
      sp.accounting_payment_id,
      src.id AS source_payment_id,
      src.status::text AS source_status,
      src.id::text AS source_payment_number,
      ae.id AS public_entry_id,
      ae.status::text AS public_entry_status,
      ap.id AS public_accounting_payment_id,
      ap.status::text AS public_payment_status
    FROM public.sport_payments sp
    LEFT JOIN sport_center.sport_payments src
      ON src.id = CASE
        WHEN sp.payment_number ~ '^SCPAY-SC-[0-9]+$'
        THEN SUBSTRING(sp.payment_number FROM 10)::integer
        ELSE NULL
      END
    LEFT JOIN public.accounting_payments ap
      ON ap.source_type = 'sport_center'
     AND ap.source_doc_id = sp.id
    LEFT JOIN public.accounting_entries ae ON ae.id = ap.entry_id
    WHERE src.id IN (
      SELECT id
        FROM sport_center.sport_payments
       WHERE status::text = 'confirmed'
         AND LOWER(COALESCE(payment_method::text, '')) = 'qris'
    )
    ORDER BY src.id
  `);

  console.log(JSON.stringify({
    meta,
    routineCount: routines.length,
    routines,
    totals,
    orphanPayments: orphanPayments.map((row) => ({
      id: row.id,
      amount: row.amount,
      payment_provider: row.payment_provider,
      bank_account_id: row.bank_account_id,
      expected_settlement_date: row.expected_settlement_date,
      journal_count: row.journal_count,
      posted_journal_count: row.posted_journal_count,
      journal_ids: row.journal_ids,
      outbox_id: row.outbox_id,
      outbox_status: row.outbox_status,
      outbox_attempts: row.outbox_attempts,
      outbox_last_error: row.outbox_last_error,
      processing_status: row.processing_status,
      processing_attempts: row.processing_attempts,
      processing_last_error: row.processing_last_error,
    })),
  }, null, 2));
} finally {
  await pool.end();
}