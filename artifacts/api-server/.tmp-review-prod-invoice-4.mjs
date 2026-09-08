import pg from 'pg';
const pool = new pg.Pool({ connectionString: process.env.SUPABASE_DATABASE_URL, ssl: { rejectUnauthorized: false }, max: 1, connectionTimeoutMillis: 20000 });
try {
  const c = await pool.connect();
  try {
    const accounts = await c.query(`
      SELECT id, code, name, account_type
      FROM chart_of_accounts
      WHERE id = ANY($1::int[])
      ORDER BY id
    `, [[49110, 76138]]);
    console.log('LIABILITY_ACCOUNTS=' + JSON.stringify(accounts.rows));

    const invoiceEntry = await c.query(`
      SELECT ae.id, ae.entry_number, ae.date, ae.ref, ae.description,
             ae.status, ae.entry_status, ae.source, ae.source_id,
             ae.total_debit, ae.total_credit, ae.is_voided
      FROM accounting_entries ae
      WHERE ae.source_id = $1
         OR ae.ref = $2
         OR ae.description ILIKE $3
      ORDER BY ae.id
    `, [12, 'VI/2026/00002', '%VI/2026/00002%']);
    console.log('INVOICE_ENTRIES=' + JSON.stringify(invoiceEntry.rows));
  } finally { c.release(); }
} finally { await pool.end(); }
