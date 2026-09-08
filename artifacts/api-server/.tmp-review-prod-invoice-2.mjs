import pg from 'pg';
const pool = new pg.Pool({ connectionString: process.env.SUPABASE_DATABASE_URL, ssl: { rejectUnauthorized: false }, max: 1, connectionTimeoutMillis: 20000 });
try {
  const c = await pool.connect();
  try {
    const tableNames = ['vendor_invoice_lines','vendor_invoice_line_taxes','vendor_withholding_records','bank_disbursements','bank_disbursement_items','accounting_entries','accounting_entry_lines'];
    const cols = await c.query(`
      SELECT table_name, column_name
      FROM information_schema.columns
      WHERE table_schema='public' AND table_name = ANY($1::text[])
      ORDER BY table_name, ordinal_position
    `, [tableNames]);
    const byTable = {};
    for (const r of cols.rows) (byTable[r.table_name] ??= []).push(r.column_name);
    console.log('TABLE_COLUMNS=' + JSON.stringify(byTable));

    const lines = await c.query(`
      SELECT vil.*
      FROM vendor_invoice_lines vil
      WHERE vil.invoice_id = $1
      ORDER BY vil.id
    `, [12]);
    console.log('LINES=' + JSON.stringify(lines.rows));

    const lineTaxes = await c.query(`
      SELECT vit.*, vil.invoice_id
      FROM vendor_invoice_line_taxes vit
      JOIN vendor_invoice_lines vil ON vil.id = vit.invoice_line_id
      WHERE vil.invoice_id = $1
      ORDER BY vit.id
    `, [12]);
    console.log('LINE_TAXES=' + JSON.stringify(lineTaxes.rows));

    const withholding = await c.query(`
      SELECT vwr.*, vit.invoice_line_id, vil.invoice_id
      FROM vendor_withholding_records vwr
      JOIN vendor_invoice_line_taxes vit ON vit.id = vwr.line_tax_id
      JOIN vendor_invoice_lines vil ON vil.id = vit.invoice_line_id
      WHERE vil.invoice_id = $1
      ORDER BY vwr.id
    `, [12]);
    console.log('WITHHOLDING_RECORDS=' + JSON.stringify(withholding.rows));

    const disbCols = byTable.bank_disbursements ?? [];
    const itemCols = byTable.bank_disbursement_items ?? [];
    if (disbCols.length) {
      const disb = await c.query(`
        SELECT * FROM bank_disbursements
        WHERE metadata::text ILIKE '%12%' OR notes::text ILIKE '%VI/2026/00002%'
        ORDER BY id DESC LIMIT 20
      `).catch(e => ({ rows: [], error: e.message }));
      console.log('DISBURSEMENTS=' + JSON.stringify(disb.error ? {error: disb.error} : disb.rows));
    }
  } finally { c.release(); }
} finally { await pool.end(); }
