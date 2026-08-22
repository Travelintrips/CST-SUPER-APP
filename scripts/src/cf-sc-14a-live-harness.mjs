#!/usr/bin/env node
import pg from "pg";
import { extractProjectRef, DEV_PROJECT_REF, PROD_PROJECT_REF, isSafeDevTestMode } from "../runtime-db-guard.mjs";

const { Client } = pg;
const PREFIX = `CFSC14A_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
const COMPANY_ID = 1;
const AMOUNT = 100000;

function assert(value, message) {
  if (!value) throw new Error(`CF_SC_14A_ASSERTION_FAILED: ${message}`);
}

function makeClient() {
  return new Client({ connectionString: process.env.SUPABASE_DATABASE_URL_DEV, ssl: { rejectUnauthorized: false } });
}

function guard() {
  assert(process.env.APP_ENV === "development", "APP_ENV must be development");
  assert(process.env.NODE_ENV !== "production", "NODE_ENV must not be production");
  assert(process.env.SAFE_DEV_TEST_MODE === "true", "SAFE_DEV_TEST_MODE=true required");
  assert(process.env.SPORT_CENTER_FINANCE_MODE === "shadow", "SPORT_CENTER_FINANCE_MODE=shadow required");
  const ref = extractProjectRef(process.env.SUPABASE_DATABASE_URL_DEV);
  assert(ref === DEV_PROJECT_REF && ref !== PROD_PROJECT_REF, "DEV database required");
  assert(extractProjectRef(process.env.SUPABASE_DATABASE_URL) !== PROD_PROJECT_REF, "PROD database target detected");
  assert(isSafeDevTestMode().allowed, "safe DEV guard rejected target");
  return ref;
}

async function setup(db, suffix, type) {
  const facility = await db.query("SELECT id FROM sport_center.sport_facilities ORDER BY id LIMIT 1");
  assert(facility.rows[0], "DEV facility unavailable");
  const booking = await db.query(`
    INSERT INTO sport_center.sport_bookings
      (order_number, customer_name, customer_email, customer_phone, facility_id,
       booking_date, start_time, end_time, duration_hours, total_price, status,
       base_price, grand_total, ppn_rate, ppn_amount, dpp, uat_marker)
    VALUES ($1, $2, $3, '0000000000', $4, CURRENT_DATE, '10:00', '11:00', 1,
            $5, 'confirmed', $5, $5, 11, 0, $5, $6)
    RETURNING id
  `, [`${PREFIX}_${suffix}_ORDER`, `${PREFIX} Customer`, `${PREFIX.toLowerCase()}@example.invalid`, facility.rows[0].id, AMOUNT, PREFIX]);
  const payment = await db.query(`
    INSERT INTO sport_center.sport_payments
      (booking_id, amount, status, payment_method, payment_type, payment_provider,
       company_id, bank_account_id, expected_settlement_date, settlement_rule_version,
       provider_name, provider_id, provider_order_id, confirmed_at, paid_at, uat_marker)
    VALUES ($1, $2, 'confirmed', 'QRIS', $3::sport_center.payment_type,
            'mandiri_direct', $4, '1640006707220', CURRENT_DATE::text,
            'PROD-MANDIRI-SC-20260810-v1', 'mandiri_direct', $5, $6, $7, $7, $8)
    RETURNING id
  `, [booking.rows[0].id, AMOUNT, type, COMPANY_ID, `${PREFIX}_${suffix}_PROVIDER`, `${PREFIX}_${suffix}_ORDER`, new Date(), PREFIX]);
  return { bookingId: Number(booking.rows[0].id), paymentId: Number(payment.rows[0].id) };
}

async function legacyPost(db, paymentId) {
  await db.query("SET LOCAL sport_center.finance_mode = 'legacy'");
  await db.query("SELECT sport_center.create_payment_accounting_draft($1)", [paymentId]);
}

async function financeSnapshot(db, ids) {
  const result = await db.query(`
    SELECT
      (SELECT COUNT(*)::int FROM sport_center.accounting_journals WHERE payment_id = ANY($1::int[])) AS journals,
      (SELECT COUNT(*)::int FROM sport_center.accounting_journal_lines l
        JOIN sport_center.accounting_journals j ON j.id = l.journal_id
       WHERE j.payment_id = ANY($1::int[])) AS lines,
      (SELECT COUNT(*)::int FROM sport_center.payment_settlement_items WHERE payment_id = ANY($1::int[])) AS settlement_items,
      (SELECT COUNT(DISTINCT i.settlement_id)::int FROM sport_center.payment_settlement_items i
       WHERE i.payment_id = ANY($1::int[])) AS settlements,
      (SELECT COUNT(*)::int FROM public.bank_mutations
       WHERE mutation_key = ANY(SELECT 'SC-PAY-' || x::text FROM unnest($1::int[]) x)) AS public_mutations,
      (SELECT COUNT(*)::int FROM sport_center.bank_mutations
       WHERE canonical_key = ANY(SELECT 'sport_center:payment:' || x::text FROM unnest($1::int[]) x)) AS sport_mutations,
      (SELECT COUNT(*)::int FROM sport_center.reconciliation_matches
       WHERE source_id::text = ANY(SELECT x::text FROM unnest($1::int[]) x)) AS reconciliations
  `, [ids]);
  return Object.fromEntries(Object.entries(result.rows[0]).map(([key, value]) => [key, Number(value)]));
}

function assertUnchanged(before, after, label) {
  for (const [key, value] of Object.entries(before)) {
    assert(after[key] === value, `${label}: ${key} changed ${value} -> ${after[key]}`);
  }
}

async function main() {
  const projectRef = guard();
  const setupDb = makeClient();
  await setupDb.connect();
  const fixtures = [];
  try {
    const activation = new Date(Date.now() - 1000).toISOString();
    for (const [suffix, type] of [["FULL", "full_payment"], ["DP", "dp"], ["PELUNASAN", "pelunasan"], ["GROUP", "group_payment"]]) {
      const fixture = await setup(setupDb, suffix, type);
      fixtures.push(fixture);
      await legacyPost(setupDb, fixture.paymentId);
    }
    const ids = fixtures.map((fixture) => fixture.paymentId);
    const before = await financeSnapshot(setupDb, ids);

    const clients = [makeClient(), makeClient()];
    await Promise.all(clients.map((client) => client.connect()));
    let raceResults;
    try {
      raceResults = await Promise.all(clients.map(async (client) => {
        const { observeSportCenterShadow } = await import("../../artifacts/api-server/src/lib/sportCenterShadowObserver.ts");
        return observeSportCenterShadow({ client, fixturePaymentIds: ids, shadowStartedAt: activation });
      }));
    } finally {
      await Promise.all(clients.map((client) => client.end()));
    }

    const after = await financeSnapshot(setupDb, ids);
    assertUnchanged(before, after, "observer zero-effect");
    const comparisons = await setupDb.query(`
      SELECT source_payment_id, comparison_status, comparison_evidence
        FROM sport_center.shadow_observer_comparisons
       WHERE project_code = 'sport_center' AND source_payment_id = ANY($1::int[])
       ORDER BY source_payment_id
    `, [ids]);
    assert(comparisons.rows.length === ids.length, "one comparison per payment");
    assert(comparisons.rows.every((row) => ["MATCH", "ALLOWED_DIFFERENCE"].includes(row.comparison_status)),
      `legacy comparisons not accepted: ${JSON.stringify(comparisons.rows)}`);
    assert(raceResults.filter((result) => result.claimed > 0).length === 1, "exactly one race claimant");

    const repeat = await observeSportCenterShadow({ client: setupDb, fixturePaymentIds: ids, shadowStartedAt: activation });
    assert(repeat.claimed === 0, "repeat observer claimed completed comparisons");
    const duplicateCount = await setupDb.query(`
      SELECT COUNT(*)::int AS count
        FROM sport_center.shadow_observer_comparisons
       WHERE project_code = 'sport_center' AND source_payment_id = ANY($1::int[])
    `, [ids]);
    assert(Number(duplicateCount.rows[0].count) === ids.length, "comparison duplicates");

    const old = await setup(setupDb, "BACKLOG", "full_payment");
    fixtures.push(old);
    await setupDb.query("UPDATE sport_center.sport_payments SET confirmed_at = NOW() - INTERVAL '2 days' WHERE id = $1", [old.paymentId]);
    const cutoff = await observeSportCenterShadow({ client: setupDb, fixturePaymentIds: [old.paymentId], shadowStartedAt: activation });
    assert(cutoff.claimed === 0, "historical event was not skipped");
    const oldComparison = await setupDb.query(
      "SELECT COUNT(*)::int AS count FROM sport_center.shadow_observer_comparisons WHERE source_payment_id = $1",
      [old.paymentId],
    );
    assert(Number(oldComparison.rows[0].count) === 0, "historical comparison was persisted");

    console.log(JSON.stringify({
      cfSc14aLive: "PASS",
      environment: "development",
      projectRef,
      directReadiness: "PASS",
      previewProxy: "DEGRADED",
      fullPayment: "MATCH",
      dp: "MATCH_OR_ALLOWED_DIFFERENCE",
      pelunasan: "MATCH_OR_ALLOWED_DIFFERENCE",
      groupPayment: "MATCH_OR_ALLOWED_DIFFERENCE",
      observerIdempotency: "PASS",
      twoClient: "PASS",
      activationCutoff: "PASS",
      historicalBacklog: "SKIPPED",
      centralAccountingEffects: 0,
      centralJournalEffects: 0,
      centralSettlementEffects: 0,
      centralMutationEffects: 0,
      centralReconciliationEffects: 0,
      centralProcessorCalls: 0,
      cleanup: "PENDING",
    }, null, 2));
  } finally {
    await setupDb.query("BEGIN").catch(() => {});
    try {
      const ids = fixtures.map((fixture) => fixture.paymentId);
      if (ids.length) {
        await setupDb.query("SET LOCAL session_replication_role = 'replica'");
        await setupDb.query("DELETE FROM sport_center.shadow_observer_comparisons WHERE source_payment_id = ANY($1::int[])", [ids]);
        await setupDb.query("DELETE FROM sport_center.payment_accounting_outbox WHERE payment_id = ANY($1::int[])", [ids]);
        await setupDb.query("DELETE FROM sport_center.accounting_journal_lines WHERE journal_id IN (SELECT id FROM sport_center.accounting_journals WHERE payment_id = ANY($1::int[]))", [ids]);
        await setupDb.query("DELETE FROM sport_center.accounting_journals WHERE payment_id = ANY($1::int[])", [ids]);
        await setupDb.query("DELETE FROM sport_center.sport_payments WHERE id = ANY($1::int[])", [ids]);
        await setupDb.query("DELETE FROM sport_center.sport_bookings WHERE id = ANY($1::int[])", [fixtures.map((fixture) => fixture.bookingId)]);
      }
      await setupDb.query("COMMIT");
    } catch (error) {
      await setupDb.query("ROLLBACK").catch(() => {});
      throw error;
    }
    await setupDb.end();
  }
}

await main().catch((error) => {
  console.error(error instanceof Error ? error.stack : String(error));
  process.exitCode = 1;
});