import { build } from "esbuild";
import pg from "pg";
import { fileURLToPath, pathToFileURL } from "node:url";
import { dirname, resolve } from "node:path";
import { rmSync } from "node:fs";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const source = resolve(root, "src/lib/centralFinance.ts");
const bundled = resolve(root, "scripts/.cf-sc-10b-central-finance.mjs");

if (process.env.APP_ENV !== "development") throw new Error("CF-SC-10B requires APP_ENV=development");
if (!process.env.SUPABASE_DATABASE_URL_DEV) throw new Error("SUPABASE_DATABASE_URL_DEV is required");
if (process.env.SUPABASE_DATABASE_URL_PROD && process.env.SUPABASE_DATABASE_URL_DEV === process.env.SUPABASE_DATABASE_URL_PROD) {
  throw new Error("DEV and PROD database URLs must not be identical");
}
if ((process.env.SPORT_CENTER_FINANCE_MODE ?? "legacy") !== "legacy") {
  throw new Error("Normal development runtime must remain legacy");
}

await build({
  entryPoints: [source],
  bundle: true,
  format: "esm",
  platform: "node",
  outfile: bundled,
  external: ["pg"],
  sourcemap: false,
});
process.env.SPORT_CENTER_FINANCE_MODE = "central";
process.env.NODE_ENV = "development";
const { processCentralFinance } = await import(`${pathToFileURL(bundled).href}?cfsc10b=${Date.now()}`);
rmSync(bundled, { force: true });
const pool = new pg.Pool({
  connectionString: process.env.SUPABASE_DATABASE_URL_DEV,
  ssl: { rejectUnauthorized: false },
  max: 6,
});

const prefix = `CFSC10B_${process.pid}_${Date.now()}`;
const client = await pool.connect();
let paymentId;
let bookingId;

const query = (sql, params) => client.query(sql, params);
const countFixture = async (db = pool) => {
  const result = await db.query(
    `WITH fixture_payments AS (
       SELECT id FROM sport_center.sport_payments
        WHERE provider_name = $1 OR provider_id = $1
     )
     SELECT
       (SELECT COUNT(*) FROM fixture_payments) AS payments,
       (SELECT COUNT(*) FROM sport_center.payment_accounting_outbox WHERE payment_id IN (SELECT id FROM fixture_payments)) AS outbox,
       (SELECT COUNT(*) FROM sport_center.central_finance_processing WHERE source_payment_id IN (SELECT id FROM fixture_payments)) AS processing,
       (SELECT COUNT(*) FROM sport_center.accounting_journals WHERE payment_id IN (SELECT id FROM fixture_payments)) AS journals`,
    [prefix],
  );
  return result.rows[0];
};

const accountingState = async () => {
  const result = await query(
    `SELECT j.id, j.payment_id, j.company_id, j.status,
            j.debit_amount, j.credit_revenue_amount, j.credit_ppn_amount,
            COALESCE(SUM(CASE WHEN l.line_type = 'debit' THEN l.amount ELSE 0 END), 0) AS line_debit,
            COALESCE(SUM(CASE WHEN l.line_type = 'credit' THEN l.amount ELSE 0 END), 0) AS line_credit
       FROM sport_center.accounting_journals j
       LEFT JOIN sport_center.accounting_journal_lines l ON l.journal_id = j.id
      WHERE j.payment_id = $1
      GROUP BY j.id`,
    [paymentId],
  );
  return result.rows;
};

try {
  await query("BEGIN");
  await query("SELECT set_config('sport_center.finance_mode', 'central', true)");
  const refs = await query(
    `SELECT
       (SELECT id FROM sport_center.users ORDER BY id LIMIT 1) AS customer_id,
       (SELECT id FROM sport_center.facilities ORDER BY id LIMIT 1) AS facility_id`,
  );
  const ref = refs.rows[0];
  if (!ref?.facility_id) throw new Error("No valid DEV facility fixture reference");

  const booking = await query(
    `INSERT INTO sport_center.sport_bookings
      (order_number, customer_id, customer_name, customer_email, customer_phone,
       facility_id, booking_date, start_time, end_time, duration_hours,
       total_price, status, source, payer_type, payment_required_now)
     VALUES ($1, $2, $3, $4, $5, $6, CURRENT_DATE::text, '10:00', '11:00', 1,
             100000, 'confirmed', 'CF-SC-10B', 'personal', true)
     RETURNING id`,
    [prefix + "_BOOKING", ref.customer_id ?? null, prefix, "cfsc10b@example.invalid", "0000000000", ref.facility_id],
  );
  bookingId = Number(booking.rows[0].id);

  const payment = await query(
    `INSERT INTO sport_center.sport_payments
      (booking_id, amount, status, payment_method, payment_type, payment_provider,
       provider_reference, company_id, bank_account_id, confirmed_at, paid_at,
       expected_settlement_date, settlement_rule_version,
       provider_name, provider_id, provider_order_id)
     VALUES ($1, 100000, 'confirmed', 'QRIS', 'full_payment', 'mandiri_direct',
             $2, 1, '1640006707220', NOW(), NOW(), CURRENT_DATE + 3,
             'PROD-MANDIRI-SC-20260810-v1', $3, $3, $4)
     RETURNING id`,
    [bookingId, prefix + "_REFERENCE", prefix, prefix + "_ORDER"],
  );
  paymentId = Number(payment.rows[0].id);

  const outbox = await query(
    `SELECT id, correlation_id, status FROM sport_center.payment_accounting_outbox
      WHERE payment_id = $1 AND event_type = 'payment_confirmed'`,
    [paymentId],
  );
  if (outbox.rows.length !== 1) throw new Error(`Expected one outbox row, got ${outbox.rows.length}`);

  const before = await accountingState();
  const first = await processCentralFinance({ client, fixturePaymentIds: [paymentId] });
  const after = await accountingState();
  if (first.claimed !== 1) throw new Error(`Expected claimed=1, got ${JSON.stringify(first)}`);
  if (after.length !== 1) throw new Error(`Expected one accounting journal, got ${after.length}`);
  if (Number(after[0].company_id) !== 1) throw new Error("Journal company_id is not 1");
  if (Number(after[0].line_debit) !== Number(after[0].line_credit)) throw new Error("Journal lines are unbalanced");

  const second = await processCentralFinance({ client, fixturePaymentIds: [paymentId] });
  const afterSecond = await accountingState();
  if (second.claimed !== 0 || afterSecond.length !== 1) throw new Error(`Idempotency failed: ${JSON.stringify(second)}`);

  console.log(JSON.stringify({
    environment: "development",
    normalMode: "legacy",
    processorMode: "central-explicit-fixture-only",
    paymentId,
    bookingId,
    outboxId: outbox.rows[0].id,
    correlationId: outbox.rows[0].correlation_id,
    first,
    second,
    journal: afterSecond[0],
    rollbackOnly: true,
    skipLockedTwoClient: "NOT_RUN: strict rollback-only visibility prevents a second independent transaction from seeing uncommitted fixtures",
  }, null, 2));
  await query("ROLLBACK");
} catch (error) {
  await query("ROLLBACK").catch(() => {});
  throw error;
} finally {
  client.release();
}

const remaining = await countFixture();
if (Object.values(remaining).some((value) => Number(value) !== 0)) {
  throw new Error(`CF-SC-10B cleanup failed: ${JSON.stringify(remaining)}`);
}
console.log(JSON.stringify({ rollbackProof: "PASS", fixtureRowsRemaining: remaining }));
await pool.end();