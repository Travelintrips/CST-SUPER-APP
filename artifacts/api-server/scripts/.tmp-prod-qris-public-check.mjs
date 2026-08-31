import pg from "pg";

if (process.env.APP_ENV !== "production" || process.env.NODE_ENV !== "production") {
  throw new Error("Production check requires APP_ENV=production and NODE_ENV=production");
}

const pool = new pg.Pool({
  connectionString: process.env.SUPABASE_DATABASE_URL,
  ssl: { rejectUnauthorized: false },
  max: 1,
  connectionTimeoutMillis: 15000,
});
const client = await pool.connect();

try {
  const result = await client.query(`
    WITH canonical AS (
      SELECT sp.id
        FROM sport_center.sport_payments sp
       WHERE sp.status::text = 'confirmed'
         AND LOWER(COALESCE(sp.payment_method::text, '')) = 'qris'
         AND (
           sp.id IN (278, 279)
           OR NOT EXISTS (
             SELECT 1
               FROM sport_center.accounting_journals j
              WHERE j.payment_id = sp.id
                AND j.journal_type::text = 'payment_confirmed'
                AND COALESCE(j.is_reversal, false) = false
                AND j.status::text = 'posted'
           )
         )
    )
    SELECT c.id AS canonical_payment_id,
           ae.id AS public_entry_id,
           ae.source::text AS entry_source,
           ae.source_id,
           ae.source_payment_id,
           ae.status::text AS entry_status,
           ae.ref AS entry_ref,
           ae.total_debit,
           ae.total_credit,
           COUNT(DISTINCT l.id)::int AS line_count,
           ap.id AS public_accounting_payment_id,
           ap.source_type,
           ap.source_doc_id,
           ap.status::text AS public_payment_status,
           ap.amount AS public_payment_amount,
           ap.entry_id AS public_payment_entry_id,
           spm.id AS mirror_payment_id,
           spm.payment_number AS mirror_payment_number,
           spm.posting_status AS mirror_posting_status,
           spm.accounting_payment_id AS mirror_accounting_payment_id
      FROM canonical c
      LEFT JOIN public.accounting_entries ae ON ae.source_payment_id = c.id
      LEFT JOIN public.accounting_entry_lines l ON l.entry_id = ae.id
      LEFT JOIN public.accounting_payments ap
        ON ap.entry_id = ae.id
        OR (ap.source_type = 'sport_center' AND ap.source_doc_id = ae.source_id)
      LEFT JOIN public.sport_payments spm
        ON spm.payment_number = 'SCPAY-SC-' || c.id::text
     GROUP BY c.id, ae.id, ap.id, spm.id
     ORDER BY c.id, ae.id, ap.id
  `);
  console.log(JSON.stringify({
    rowCount: result.rowCount,
    rows: result.rows.filter((row) => [278, 279].includes(Number(row.canonical_payment_id))),
  }, null, 2));
} finally {
  client.release();
  await pool.end();
}