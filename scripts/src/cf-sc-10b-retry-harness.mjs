#!/usr/bin/env node

/**
 * CF-SC-10B transient retry/backoff proof.
 *
 * DEV-only. The injected ECONNRESET happens before the canonical accounting
 * owner is called. The fixture and both attempts stay in one transaction and
 * are rolled back at the end.
 */

import pg from "pg";
import {
  DEV_PROJECT_REF,
  PROD_PROJECT_REF,
  extractProjectRef,
  isSafeDevTestMode,
} from "../runtime-db-guard.mjs";

const { Client } = pg;
const PREFIX = `CFSC10B_RETRY_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`;
const AMOUNT = 100_000;
const COMPANY_ID = 1;

function assert(condition, message) {
  if (!condition) throw new Error(`CF_SC_10B_RETRY_ASSERTION_FAILED: ${message}`);
}

function guard() {
  const env = process.env;
  assert(env.APP_ENV === "development", "APP_ENV must be development");
  assert(env.NODE_ENV !== "production", "NODE_ENV must not be production");
  assert(env.SAFE_DEV_TEST_MODE === "true", "SAFE_DEV_TEST_MODE=true is required");
  assert(env.SPORT_CENTER_FINANCE_MODE === "central", "central finance mode is required");
  const url = env.SUPABASE_DATABASE_URL_DEV;
  const ref = extractProjectRef(url);
  assert(url && ref === DEV_PROJECT_REF && ref !== PROD_PROJECT_REF, "DEV Supabase target required");
  assert(extractProjectRef(env.SUPABASE_DATABASE_URL) !== PROD_PROJECT_REF, "PROD target detected");
  assert(isSafeDevTestMode().allowed, "safe DEV guard rejected target");
  return ref;
}

function makeClient() {
  return new Client({
    connectionString: process.env.SUPABASE_DATABASE_URL_DEV,
    ssl: { rejectUnauthorized: false },
  });
}

async function createFixture(db) {
  const facility = await db.query(
    "SELECT id FROM sport_center.sport_facilities ORDER BY id LIMIT 1",
  );
  assert(facility.rows[0], "no DEV Sport Center facility available");

  const booking = await db.query(
    `INSERT INTO sport_center.sport_bookings
      (order_number, customer_name, customer_email, customer_phone,
       facility_id, booking_date, start_time, end_time, duration_hours,
       total_price, status, base_price, grand_total, ppn_rate, ppn_amount,
       dpp, uat_marker)
     VALUES ($1, $2, $3, '0000000000', $4, CURRENT_DATE, '10:00', '11:00', 1,
             $5, 'confirmed', $5, $5, 0, 0, $5, $6)
     RETURNING id`,
    [
      `${PREFIX}_ORDER`,
      `${PREFIX} Customer`,
      `${PREFIX.toLowerCase()}@example.invalid`,
      facility.rows[0].id,
      AMOUNT,
      PREFIX,
    ],
  );
  const bookingId = Number(booking.rows[0].id);

  const payment = await db.query(
    `INSERT INTO sport_center.sport_payments
      (booking_id, amount, status, payment_method, payment_type,
       payment_provider, company_id, bank_account_id, expected_settlement_date,
       settlement_rule_version, provider_name, provider_id, provider_order_id,
       confirmed_at, paid_at, uat_marker)
     VALUES ($1, $2, 'confirmed', 'QRIS', 'full_payment', 'mandiri_direct',
             $3, '1640006707220', (CURRENT_DATE + 1)::text,
             'PROD-MANDIRI-SC-20260810-v1', 'mandiri_direct', $4, $5,
             NOW(), NOW(), $6)
     RETURNING id`,
    [
      bookingId,
      AMOUNT,
      COMPANY_ID,
      `${PREFIX}_PROVIDER`,
      `${PREFIX}_ORDER`,
      PREFIX,
    ],
  );
  const paymentId = Number(payment.rows[0].id);

  const outbox = await db.query(
    `SELECT id FROM sport_center.payment_accounting_outbox
      WHERE payment_id = $1 AND event_type = 'payment_confirmed'
      ORDER BY id DESC LIMIT 1`,
    [paymentId],
  );
  assert(outbox.rows[0], "payment confirmation outbox missing");
  await db.query(
    `INSERT INTO sport_center.central_finance_processing
      (source_project, source_payment_id, event_type, correlation_id)
     SELECT source_project, payment_id, event_type,
            COALESCE(correlation_id, 'sc_payment_' || payment_id::text)
       FROM sport_center.payment_accounting_outbox
      WHERE payment_id = $1 AND event_type = 'payment_confirmed'
     ON CONFLICT (source_project, source_payment_id, event_type) DO NOTHING`,
    [paymentId],
  );
  return { bookingId, paymentId, outboxId: Number(outbox.rows[0].id) };
}

async function state(db, paymentId) {
  const result = await db.query(
    `SELECT
       (SELECT row_to_json(x) FROM (
          SELECT status, attempts, available_at, locked_at, last_error
            FROM sport_center.central_finance_processing
           WHERE source_payment_id = $1 AND event_type = 'payment_confirmed'
           ORDER BY id DESC LIMIT 1
        ) x) AS processing,
       (SELECT COUNT(*)::int FROM sport_center.accounting_journals
         WHERE payment_id = $1 AND journal_type = 'payment_confirmed'
           AND is_reversal = false) AS accounting,
       (SELECT COUNT(*)::int FROM sport_center.accounting_journal_lines l
          JOIN sport_center.accounting_journals j ON j.id = l.journal_id
         WHERE j.payment_id = $1) AS accounting_lines,
       (SELECT COUNT(*)::int FROM sport_center.payment_settlement_items
         WHERE payment_id = $1) AS settlement_items,
       (SELECT COUNT(*)::int FROM sport_center.payment_settlement_batches b
          JOIN sport_center.payment_settlement_items i ON i.settlement_id = b.id
         WHERE i.payment_id = $1) AS settlements,
       (SELECT COUNT(*)::int FROM public.bank_mutations
         WHERE mutation_key = 'SC-PAY-' || $1::text) AS mutations`,
    [paymentId],
  );
  const row = result.rows[0];
  return {
    processing: row.processing,
    accounting: Number(row.accounting),
    accountingLines: Number(row.accounting_lines),
    settlementItems: Number(row.settlement_items),
    settlements: Number(row.settlements),
    mutations: Number(row.mutations),
  };
}

async function main() {
  const projectRef = guard();
  const db = makeClient();
  const verifier = makeClient();
  let fixture;
  try {
    await db.connect();
    await verifier.connect();
    await db.query("BEGIN");
    await db.query("SET LOCAL sport_center.finance_mode = 'central'");
    fixture = await createFixture(db);

    const { processCentralFinance } =
      await import("../../artifacts/api-server/src/lib/centralFinance.ts");
    const baseline = await state(db, fixture.paymentId);
    const baselineJournals = await db.query(
      `SELECT id, status, journal_type, source_table, source_id, payment_id
         FROM sport_center.accounting_journals
        WHERE payment_id = $1
        ORDER BY id`,
      [fixture.paymentId],
    );
    assert(
      baseline.accounting === 0 && baseline.accountingLines === 0,
      `fixture already has accounting effects before processor: ${JSON.stringify({ baseline, journals: baselineJournals.rows })}`,
    );

    const before = await db.query(
      `SELECT attempts, status, available_at
         FROM sport_center.central_finance_processing
        WHERE source_payment_id = $1 AND event_type = 'payment_confirmed'`,
      [fixture.paymentId],
    );
    assert(before.rows[0], "processing identity was not created");
    const attemptBefore = Number(before.rows[0].attempts);
    const statusBefore = before.rows[0].status;

    let injected = true;
    const faultClient = {
      async query(sql, params) {
        if (injected && sql.includes("create_payment_accounting_draft")) {
          injected = false;
          const error = new Error("ECONNRESET: controlled transient owner boundary");
          error.code = "ECONNRESET";
          throw error;
        }
        return db.query(sql, params);
      },
    };

    const first = await processCentralFinance({
      client: faultClient,
      fixturePaymentIds: [fixture.paymentId],
    });
    const failed = await state(db, fixture.paymentId);
    const failedAt = Date.now();
    const retryAt = new Date(failed.processing.available_at).getTime();

    assert(first.claimed === 1, `first claimed=${first.claimed}`);
    assert(first.retried === 1, `first retried=${first.retried}`);
    assert(first.manualReview === 0, "transient error went to manual review");
    assert(failed.processing.status === "failed", `status=${failed.processing.status}`);
    assert(Number(failed.processing.attempts) === attemptBefore + 1, "attempt did not increment exactly once");
    assert(failed.processing.last_error?.includes("ECONNRESET"), "transient error was not persisted");
    assert(retryAt > failedAt, "retry timestamp is not in the future");
    assert(failed.accounting === 0, `partial accounting effect exists: ${JSON.stringify(failed)}`);
    assert(failed.accountingLines === 0, `partial journal lines exist: ${JSON.stringify(failed)}`);
    assert(failed.settlementItems === 0 && failed.settlements === 0, `partial settlement exists: ${JSON.stringify(failed)}`);
    assert(failed.mutations === 0, `partial mutation exists: ${JSON.stringify(failed)}`);

    // Advance only this fixture's eligibility; production retry policy is unchanged.
    await db.query(
      `UPDATE sport_center.central_finance_processing
          SET available_at = NOW() - INTERVAL '1 second'
        WHERE source_payment_id = $1 AND event_type = 'payment_confirmed'`,
      [fixture.paymentId],
    );
    await db.query(
      `UPDATE sport_center.payment_accounting_outbox
          SET available_at = NOW() - INTERVAL '1 second'
        WHERE payment_id = $1 AND event_type = 'payment_confirmed'`,
      [fixture.paymentId],
    );

    const recovery = await processCentralFinance({ client: db, fixturePaymentIds: [fixture.paymentId] });
    const recovered = await state(db, fixture.paymentId);
    assert(recovery.claimed === 1 && recovery.posted === 1, `recovery=${JSON.stringify(recovery)}`);
    assert(recovered.processing.status === "posted", "recovery did not post processing");
    assert(recovered.accounting === 1, `accounting=${recovered.accounting}`);
    assert(recovered.settlements === 1, `settlements=${recovered.settlements}`);
    assert(recovered.mutations === 1, `mutations=${recovered.mutations}`);

    const idempotent = await processCentralFinance({ client: db, fixturePaymentIds: [fixture.paymentId] });
    const finalState = await state(db, fixture.paymentId);
    assert(idempotent.claimed === 0, `idempotent claimed=${idempotent.claimed}`);
    assert(finalState.accounting === 1 && finalState.settlements === 1 && finalState.mutations === 1, "recovery duplicated effects");

    await db.query("ROLLBACK");
    const persisted = await verifier.query(
      `SELECT
         (SELECT COUNT(*)::int FROM sport_center.sport_payments WHERE id = $1) AS payment,
         (SELECT COUNT(*)::int FROM sport_center.payment_accounting_outbox WHERE payment_id = $1) AS outbox,
         (SELECT COUNT(*)::int FROM sport_center.central_finance_processing WHERE source_payment_id = $1) AS processing,
         (SELECT COUNT(*)::int FROM sport_center.accounting_journals WHERE payment_id = $1) AS accounting,
         (SELECT COUNT(*)::int FROM sport_center.payment_settlement_items WHERE payment_id = $1) AS settlements,
         (SELECT COUNT(*)::int FROM public.bank_mutations WHERE mutation_key = 'SC-PAY-' || $1::text) AS mutations`,
      [fixture.paymentId],
    );
    const remaining = persisted.rows[0];
    for (const [field, value] of Object.entries(remaining)) {
      assert(Number(value) === 0, `${field} survived rollback: ${value}`);
    }

    console.log(JSON.stringify({
      cfSc10bRetry: "PASS",
      environment: "development",
      projectRef,
      transientFailure: { type: "ECONNRESET", injected: true, retryable: true, manualReview: false },
      attemptBefore,
      attemptAfter: Number(failed.processing.attempts),
      attemptIncrement: Number(failed.processing.attempts) - attemptBefore,
      statusBefore,
      failedStatus: failed.processing.status,
      retryBackoffField: "available_at",
      retryTimestampPopulated: true,
      backoffMs: retryAt - failedAt,
      partialEffects: {
        accounting: failed.accounting,
        accountingLines: failed.accountingLines,
        settlements: failed.settlements,
        mutations: failed.mutations,
      },
      recovery,
      idempotent,
      finalEffects: {
        accounting: finalState.accounting,
        settlements: finalState.settlements,
        mutations: finalState.mutations,
      },
      rollback: "PASS",
      persistedFixtureRows: remaining,
      productionWrites: 0,
      productionProcessorRuns: 0,
    }, null, 2));
  } catch (error) {
    await db.query("ROLLBACK").catch(() => {});
    throw error;
  } finally {
    await db.end().catch(() => {});
    await verifier.end().catch(() => {});
  }
}

await main().catch((error) => {
  console.error(error instanceof Error ? error.stack : String(error));
  process.exitCode = 1;
});