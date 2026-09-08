import pg from 'pg';
const pool = new pg.Pool({ connectionString: process.env.SUPABASE_DATABASE_URL, ssl: { rejectUnauthorized: false }, max: 1, connectionTimeoutMillis: 20000 });
try {
  const c = await pool.connect();
  try {
    const items = await c.query(`
      SELECT bdi.id, bdi.disbursement_id, bdi.invoice_number, bdi.party_name,
             bdi.vendor_invoice_id, bdi.amount, bdi.wht_amount, bdi.wht_account_id,
             bd.disbursement_number, bd.date, bd.status, bd.entry_id
      FROM bank_disbursement_items bdi
      LEFT JOIN bank_disbursements bd ON bd.id = bdi.disbursement_id
      WHERE bdi.vendor_invoice_id = $1 OR bdi.invoice_number = $2
      ORDER BY bdi.id
    `, [12, 'VI/2026/00002']);
    console.log('DISBURSEMENT_ITEMS=' + JSON.stringify(items.rows));

    const accounts = await c.query(`
      SELECT id, code, name, account_type, category
      FROM chart_of_accounts
      WHERE id = ANY($1::int[])
      ORDER BY id
    `, [[49110, 76138]]);
    console.log('LIABILITY_ACCOUNTS=' + JSON.stringify(accounts.rows));

    const invoiceEntry = await c.query(`
      SELECT ae.id, ae.entry_number, ae.date, ae.ref, ae.description,
             ae.status, ae.entry_status, ae.source, ae.source_id,
             ae.total_debit, ae.total_credit, ae.is_voided,
             COALESCE(json_agg(json_build_object(
               'account_id', ael.account_id,
               'account_code', coa.code,
               'account_name', coa.name,
               'debit', ael.debit,
               'credit', ael.credit,
               'description', ael.description
             ) ORDER BY ael.id) FILTER (WHERE ael.id IS NOT NULL), '[]') AS lines
      FROM accounting_entries ae
      LEFT JOIN accounting_entry_lines ael ON ael.entry_id = ae.id
      LEFT JOIN chart_of_accounts coa ON coa.id = ael.account_id
      WHERE ae.source_id = $1
        AND (ae.source ILIKE '%invoice%' OR ae.description ILIKE '%VI/2026/00002%')
      GROUP BY ae.id
      ORDER BY ae.id
    `, [12]);
    console.log('INVOICE_ENTRIES=' + JSON.stringify(invoiceEntry.rows));
  } finally { c.release(); }
} finally { await pool.end(); }
