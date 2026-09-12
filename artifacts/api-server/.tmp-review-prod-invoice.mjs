import pg from 'pg';
const pool = new pg.Pool({
  connectionString: process.env.SUPABASE_DATABASE_URL,
  ssl: { rejectUnauthorized: false },
  max: 1,
  connectionTimeoutMillis: 20000,
});
try {
  const client = await pool.connect();
  try {
    const cols = await client.query(`
      SELECT column_name
      FROM information_schema.columns
      WHERE table_schema = 'public' AND table_name = 'vendor_invoices'
      ORDER BY ordinal_position
    `);
    console.log('COLUMNS=' + JSON.stringify(cols.rows.map(r => r.column_name)));

    const invoice = await client.query(`
      SELECT id, invoice_number, supplier_name, company_id, status,
             invoice_date, due_date, total_amount, tax_amount,
             withholding_tax_amount, grand_total, amount_paid,
             withholding_review_status, tax_review_status,
             invoice_breakdown
      FROM vendor_invoices
      WHERE invoice_number = $1
      LIMIT 2
    `, ['VI/2026/00002']);
    console.log('INVOICE=' + JSON.stringify(invoice.rows));

    const taxTables = await client.query(`
      SELECT table_schema, table_name
      FROM information_schema.tables
      WHERE table_schema NOT IN ('pg_catalog', 'information_schema')
        AND (table_name ILIKE '%tax%' OR table_name ILIKE '%withhold%')
      ORDER BY table_schema, table_name
    `);
    console.log('TAX_TABLES=' + JSON.stringify(taxTables.rows));
  } finally {
    client.release();
  }
} finally {
  await pool.end();
}
