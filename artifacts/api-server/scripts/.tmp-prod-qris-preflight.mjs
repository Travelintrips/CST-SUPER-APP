import pg from "pg";

if (process.env.APP_ENV !== "production" || process.env.NODE_ENV !== "production") {
  throw new Error("Production preflight requires APP_ENV=production and NODE_ENV=production");
}

const pool = new pg.Pool({
  connectionString: process.env.SUPABASE_DATABASE_URL,
  ssl: { rejectUnauthorized: false },
  max: 1,
  connectionTimeoutMillis: 15000,
});

const ids = [];
const client = await pool.connect();

try {
  const paymentRows = await client.query(`
    SELECT sp.id, sp.booking_id, sp.amount, sp.payment_method::text AS payment_method,
           sp.payment_provider::text AS payment_provider,
           sp.bank_account_id::text AS bank_account_id,
           sp.expected_settlement_date::text AS expected_settlement_date,
           sp.company_id,
           b.order_number,
           b.ppn_rate,
           EXISTS (
             SELECT 1 FROM sport_center.accounting_journals j
              WHERE j.payment_id = sp.id
                AND j.journal_type::text = 'payment_confirmed'
                AND COALESCE(j.is_reversal, false) = false
           ) AS has_journal
      FROM sport_center.sport_payments sp
      LEFT JOIN sport_center.sport_bookings b ON b.id = sp.booking_id
     WHERE sp.status::text = 'confirmed'
       AND LOWER(COALESCE(sp.payment_method::text, '')) = 'qris'
       AND (
         sp.id = 278
         OR NOT EXISTS (
           SELECT 1 FROM sport_center.accounting_journals j
            WHERE j.payment_id = sp.id
              AND j.journal_type::text = 'payment_confirmed'
              AND COALESCE(j.is_reversal, false) = false
              AND j.status::text = 'posted'
         )
       )
     ORDER BY sp.id
  `);

  const bankAccounts = await client.query(`
    SELECT id, company_id, account_number::text AS account_number,
           is_active
      FROM public.company_bank_accounts
     WHERE company_id = 1
       AND account_number::text IN ('1640006707220', '2')
     ORDER BY account_number::text, id
  `);

  const results = [];
  await client.query("BEGIN");
  await client.query("SET LOCAL sport_center.finance_mode = 'legacy'");
  for (const payment of paymentRows.rows) {
    ids.push(Number(payment.id));
    const savepoint = `payment_${payment.id}`;
    await client.query(`SAVEPOINT ${savepoint}`);
    try {
      const result = await client.query(
        "SELECT sport_center.create_payment_accounting_draft($1) AS journal_id",
        [payment.id],
      );
      const journal = await client.query(
        `SELECT j.id, j.status::text AS status, j.payment_id, j.debit_amount,
                j.credit_revenue_amount, j.credit_ppn_amount,
                COUNT(l.id)::int AS line_count
           FROM sport_center.accounting_journals j
           LEFT JOIN sport_center.accounting_journal_lines l ON l.journal_id = j.id
          WHERE j.id = $1
          GROUP BY j.id`,
        [result.rows[0].journal_id],
      );
      results.push({
        id: Number(payment.id),
        amount: payment.amount,
        bank_account_id: payment.bank_account_id,
        booking_id: payment.booking_id,
        order_number: payment.order_number,
        ppn_rate: payment.ppn_rate,
        owner_result: Number(result.rows[0].journal_id),
        draft: journal.rows[0] ?? null,
      });
    } catch (error) {
      results.push({
        id: Number(payment.id),
        amount: payment.amount,
        bank_account_id: payment.bank_account_id,
        booking_id: payment.booking_id,
        order_number: payment.order_number,
        ppn_rate: payment.ppn_rate,
        error: String(error?.message ?? error),
      });
    } finally {
      await client.query(`ROLLBACK TO SAVEPOINT ${savepoint}`);
    }
  }
  await client.query("ROLLBACK");

  console.log(JSON.stringify({
    candidateCount: paymentRows.rowCount,
    candidateIds: ids,
    bankAccounts: bankAccounts.rows,
    results,
  }, null, 2));
} finally {
  client.release();
  await pool.end();
}