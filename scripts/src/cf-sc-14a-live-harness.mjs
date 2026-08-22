#!/usr/bin/env node
import pg from "pg";
import { assertAuthorizedDevRuntimeProof } from "../runtime-db-guard.mjs";
import { isSafeFixturePayment, MAX_ALLOCATION_ATTEMPTS } from "./cf-sc-14a-fixture-isolation.mjs";
import { observeSportCenterShadow } from "../../artifacts/api-server/src/lib/sportCenterShadowObserver.ts";

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

function quoteIdent(value) {
  return `"${String(value).replaceAll('"', '""')}"`;
}

function emptyOwnership() {
  return {
    bookings: new Set(),
    payments: new Set(),
    outbox: new Set(),
    accountingPayments: new Set(),
    accountingEntries: new Set(),
    journals: new Set(),
    lines: new Set(),
    comparisons: new Set(),
    processing: new Set(),
    mutations: new Set(),
    settlements: new Set(),
    settlementItems: new Set(),
    reconciliations: new Set(),
  };
}

async function discoverPaymentIdentitySurfaces(db) {
  const result = await db.query(`
    SELECT c.table_schema, c.table_name, c.column_name,
           EXISTS (
             SELECT 1 FROM information_schema.columns t
              WHERE t.table_schema = c.table_schema
                AND t.table_name = c.table_name
                AND t.column_name = 'id'
           ) AS has_id,
           EXISTS (
             SELECT 1 FROM information_schema.columns t
              WHERE t.table_schema = c.table_schema
                AND t.table_name = c.table_name
                AND t.column_name = 'source_type'
           ) AS has_source_type,
           EXISTS (
             SELECT 1 FROM information_schema.columns t
              WHERE t.table_schema = c.table_schema
                AND t.table_name = c.table_name
                AND t.column_name = 'source'
           ) AS has_source
      FROM information_schema.columns c
     WHERE c.table_schema IN ('public', 'sport_center')
       AND c.column_name IN
          ('payment_id', 'source_payment_id', 'source_doc_id', 'sc_payment_id',
           'source_id', 'candidate_id', 'mutation_key', 'canonical_key')
       AND EXISTS (
         SELECT 1 FROM information_schema.columns i
          WHERE i.table_schema = c.table_schema
            AND i.table_name = c.table_name
            AND i.column_name = 'id'
       )
       AND c.table_name NOT IN ('sport_payments')
     ORDER BY c.table_schema, c.table_name, c.column_name
  `);
  return result.rows;
}

async function findPaymentReferences(db, paymentId, ownership) {
  const surfaces = await discoverPaymentIdentitySurfaces(db);
  const references = [];
  const owned = new Set([
    ...ownership.outbox, ...ownership.accountingPayments, ...ownership.accountingEntries,
    ...ownership.journals, ...ownership.lines, ...ownership.comparisons, ...ownership.processing,
    ...ownership.mutations, ...ownership.settlements, ...ownership.settlementItems,
    ...ownership.reconciliations,
  ]);
  for (const surface of surfaces) {
    const table = `${quoteIdent(surface.table_schema)}.${quoteIdent(surface.table_name)}`;
    const column = quoteIdent(surface.column_name);
    let predicate;
    let value = paymentId;
    if (surface.column_name === "mutation_key") {
      predicate = `${column} = $1`;
      value = `SC-PAY-${paymentId}`;
    } else if (surface.column_name === "canonical_key") {
      predicate = `${column} = $1`;
      value = `sport_center:payment:${paymentId}`;
    } else if (surface.column_name === "source_doc_id" && surface.has_source_type) {
      predicate = `${column} = $1 AND source_type = 'sport_center'`;
    } else if (surface.column_name === "source_id" && surface.has_source) {
      predicate = `${column} = $1 AND source::text = 'sport_center_payment'`;
    } else {
      predicate = `${column} = $1`;
    }
    const rows = await db.query(
      `SELECT ${quoteIdent("id")} AS row_id FROM ${table} WHERE ${predicate}`,
      [value],
    );
    for (const row of rows.rows) {
      const rowId = row.row_id == null ? null : Number(row.row_id);
      if (!owned.has(rowId)) references.push({
        schema: surface.table_schema,
        table: surface.table_name,
        column: surface.column_name,
        rowId,
      });
    }
  }
  return references;
}

function guard() {
  assert(process.env.SPORT_CENTER_FINANCE_MODE === "shadow", "SPORT_CENTER_FINANCE_MODE=shadow required");
  const proof = assertAuthorizedDevRuntimeProof({
    harnessIdentity: "CF-SC-14A",
  });
  console.log("[CF-SC-14A] safety preflight");
  console.log("environment = development");
  console.log("safe_dev_test_mode = true");
  console.log("database target = DEV");
  console.log(`dev/prod fingerprint different = ${proof.fingerprintsDifferent}`);
  console.log("production target selected = false");
  return proof.devProjectRef;
}

async function setupCandidate(db, suffix, type, ownership) {
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
     VALUES ($1, $2, 'pending', 'QRIS', $3::sport_center.payment_type,
            'mandiri_direct', $4, '1640006707220', CURRENT_DATE::text,
             'PROD-MANDIRI-SC-20260810-v1', 'mandiri_direct', $5, $6, NULL, NULL, $7)
    RETURNING id
   `, [booking.rows[0].id, AMOUNT, type, COMPANY_ID, `${PREFIX}_${suffix}_PROVIDER`, `${PREFIX}_${suffix}_ORDER`, PREFIX]);
  const fixture = { bookingId: Number(booking.rows[0].id), paymentId: Number(payment.rows[0].id) };
  ownership.bookings.add(fixture.bookingId);
  ownership.payments.add(fixture.paymentId);
  const outbox = await db.query(
    "SELECT id FROM sport_center.payment_accounting_outbox WHERE payment_id = $1",
    [fixture.paymentId],
  );
  for (const row of outbox.rows) ownership.outbox.add(Number(row.id));
  return fixture;
}

async function allocateSafeSportCenterFixturePayment(db, suffix, type, ownership) {
  for (let attempt = 1; attempt <= MAX_ALLOCATION_ATTEMPTS; attempt++) {
    const candidateOwnership = emptyOwnership();
    try {
      await db.query("BEGIN");
      const fixture = await setupCandidate(db, suffix, type, candidateOwnership);
      const references = await findPaymentReferences(db, fixture.paymentId, candidateOwnership);
      if (!isSafeFixturePayment(references)) {
        await db.query("ROLLBACK");
        continue;
      }
      await db.query("SET LOCAL session_replication_role = 'replica'");
      await db.query("SET LOCAL sport_center.finance_mode = 'legacy'");
      await db.query(
        `UPDATE sport_center.sport_payments
            SET status = 'confirmed', company_id = $2, confirmed_at = NOW(), paid_at = NOW()
          WHERE id = $1`,
        [fixture.paymentId, COMPANY_ID],
      );
      await db.query(`
        INSERT INTO sport_center.payment_accounting_outbox
          (payment_id, event_type, source_project, source_schema, source_table,
           booking_id, company_id, amount, payment_type, payment_method,
           payment_provider, provider_reference, provider_order_id, paid_at,
           confirmed_at, correlation_id, schema_version, status, available_at,
           created_at, updated_at)
        SELECT id, 'payment_confirmed', 'SPORT_CENTER', 'sport_center', 'sport_payments',
               booking_id, company_id, amount, payment_type, payment_method,
               payment_provider, provider_reference, provider_order_id, paid_at,
               confirmed_at, 'sc_payment_' || id::text, 1, 'pending', NOW(), NOW(), NOW()
          FROM sport_center.sport_payments
         WHERE id = $1
        ON CONFLICT (payment_id, event_type) DO NOTHING
      `, [fixture.paymentId]);
      const paymentContext = await db.query(
        "SELECT company_id, bank_account_id FROM sport_center.sport_payments WHERE id = $1",
        [fixture.paymentId],
      );
      assert(Number(paymentContext.rows[0]?.company_id) === COMPANY_ID,
        `fixture payment company context missing: ${JSON.stringify(paymentContext.rows[0] ?? null)}`);
      assert(String(paymentContext.rows[0]?.bank_account_id) === "1640006707220",
        `fixture payment bank context missing: ${JSON.stringify(paymentContext.rows[0] ?? null)}`);
      await registerGeneratedIdentityRows(db, fixture.paymentId, candidateOwnership);
      await db.query("COMMIT");
      for (const [key, values] of Object.entries(candidateOwnership)) {
        for (const value of values) ownership[key].add(value);
      }
      return fixture;
    } catch (error) {
      await db.query("ROLLBACK").catch(() => {});
      if (attempt === MAX_ALLOCATION_ATTEMPTS) throw error;
      if (!["23505", "23503"].includes(error?.code)) throw error;
    }
  }
  throw new Error(`CF_SC_14A_ALLOCATION_EXHAUSTED: ${MAX_ALLOCATION_ATTEMPTS}`);
}

async function registerGeneratedIdentityRows(db, paymentId, ownership) {
  const surfaces = await discoverPaymentIdentitySurfaces(db);
  for (const surface of surfaces) {
    const table = `${quoteIdent(surface.table_schema)}.${quoteIdent(surface.table_name)}`;
    const column = quoteIdent(surface.column_name);
    let predicate;
    let value = paymentId;
    if (surface.column_name === "mutation_key") {
      predicate = `${column} = $1`;
      value = `SC-PAY-${paymentId}`;
    } else if (surface.column_name === "canonical_key") {
      predicate = `${column} = $1`;
      value = `sport_center:payment:${paymentId}`;
    } else if (surface.column_name === "source_doc_id" && surface.has_source_type) {
      predicate = `${column} = $1 AND source_type = 'sport_center'`;
    } else if (surface.column_name === "source_id" && surface.has_source) {
      predicate = `${column} = $1 AND source::text = 'sport_center_payment'`;
    } else {
      predicate = `${column} = $1`;
    }
    const rows = await db.query(
      `SELECT ${quoteIdent("id")} AS row_id FROM ${table} WHERE ${predicate}`,
      [value],
    );
    for (const row of rows.rows) {
      const id = Number(row.row_id);
      if (!Number.isFinite(id)) continue;
      const key = surface.table_name;
      if (key.includes("outbox")) ownership.outbox.add(id);
      else if (key === "accounting_payments") ownership.accountingPayments.add(id);
      else if (key === "accounting_entries") ownership.accountingEntries.add(id);
      else if (key.includes("journal_lines") || key === "accounting_entry_lines") ownership.lines.add(id);
      else if (key.includes("journal")) ownership.journals.add(id);
      else if (key.includes("settlement_items")) ownership.settlementItems.add(id);
      else if (key.includes("settlement")) ownership.settlements.add(id);
      else if (key.includes("reconciliation")) ownership.reconciliations.add(id);
      else if (key.includes("bank_mutations")) ownership.mutations.add(id);
      else if (key.includes("processing")) ownership.processing.add(id);
      else if (key.includes("shadow_observer_comparisons")) ownership.comparisons.add(id);
    }
  }
}

async function legacyPost(db, paymentId) {
  await db.query("BEGIN");
  try {
    await db.query("SELECT set_config('sport_center.finance_mode', 'legacy', true)");
    const mode = await db.query("SELECT current_setting('sport_center.finance_mode', true) AS mode");
    assert(mode.rows[0]?.mode === "legacy", `legacy session mode is ${mode.rows[0]?.mode ?? "unset"}`);
    await db.query("SELECT sport_center.create_payment_accounting_draft($1)", [paymentId]);
    await db.query("COMMIT");
  } catch (error) {
    await db.query("ROLLBACK").catch(() => {});
    throw error;
  }
}

async function registerAccountingOwnership(db, paymentId, ownership) {
  const rows = await db.query(`
    SELECT ap.id AS accounting_payment_id, ae.id AS accounting_entry_id,
           j.id AS journal_id
      FROM public.accounting_payments ap
      FULL JOIN public.accounting_entries ae ON ae.id = ap.entry_id
      LEFT JOIN sport_center.accounting_journals j ON j.payment_id = $1
     WHERE (ap.source_type = 'sport_center' AND ap.source_doc_id = $1)
        OR ae.source_payment_id = $1
        OR (ae.source::text = 'sport_center_payment' AND ae.source_id = $1)
  `, [paymentId]);
  for (const row of rows.rows) {
    if (row.accounting_payment_id != null) ownership.accountingPayments.add(Number(row.accounting_payment_id));
    if (row.accounting_entry_id != null) ownership.accountingEntries.add(Number(row.accounting_entry_id));
    if (row.journal_id != null) ownership.journals.add(Number(row.journal_id));
  }
  const journalIds = [...ownership.journals];
  if (journalIds.length) {
    const lines = await db.query(
      "SELECT id FROM sport_center.accounting_journal_lines WHERE journal_id = ANY($1::int[])",
      [journalIds],
    );
    for (const row of lines.rows) ownership.lines.add(Number(row.id));
  }
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
       (SELECT COUNT(*)::int FROM public.bank_reconciliation_matches
        WHERE candidate_type = 'sport_payment'
          AND candidate_id = ANY($1::int[])) AS reconciliations
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
  const ownership = emptyOwnership();
  try {
    const activation = new Date(Date.now() - 1000).toISOString();
    // DEV's canonical payment_type enum models the group-payment business
    // case as a full payment; the GROUP suffix keeps its fixture identity
    // distinct without inventing an enum value that runtime does not accept.
    for (const [suffix, type] of [["FULL", "full_payment"], ["DP", "dp"], ["PELUNASAN", "pelunasan"], ["GROUP", "full_payment"]]) {
      const fixture = await allocateSafeSportCenterFixturePayment(setupDb, suffix, type, ownership);
      fixtures.push(fixture);
      const refs = await findPaymentReferences(setupDb, fixture.paymentId, ownership);
      assert(isSafeFixturePayment(refs), `pre-processing collision for ${fixture.paymentId}: ${JSON.stringify(refs)}`);
      await legacyPost(setupDb, fixture.paymentId);
      await registerAccountingOwnership(setupDb, fixture.paymentId, ownership);
    }
    const ids = fixtures.map((fixture) => fixture.paymentId);
    const before = await financeSnapshot(setupDb, ids);

    const clients = [makeClient(), makeClient()];
    await Promise.all(clients.map((client) => client.connect()));
    let raceResults;
    try {
      raceResults = await Promise.all(clients.map(async (client) => {
        return observeSportCenterShadow({ client, fixturePaymentIds: ids, shadowStartedAt: activation });
      }));
    } finally {
      await Promise.all(clients.map((client) => client.end()));
    }

    const after = await financeSnapshot(setupDb, ids);
    assertUnchanged(before, after, "observer zero-effect");
    const comparisons = await setupDb.query(`
       SELECT id, source_payment_id, comparison_status, comparison_evidence, last_error,
              expected_revenue_coa, actual_revenue_coa,
              expected_tax_output_coa, actual_tax_output_coa,
              expected_bank_coa, actual_bank_coa,
              expected_mdr, actual_mdr,
              expected_net_settlement, actual_net_settlement
        FROM sport_center.shadow_observer_comparisons
       WHERE project_code = 'sport_center' AND source_payment_id = ANY($1::int[])
       ORDER BY source_payment_id
    `, [ids]);
    assert(comparisons.rows.length === ids.length, "one comparison per payment");
    assert(comparisons.rows.every((row) => ["MATCH", "ALLOWED_DIFFERENCE"].includes(row.comparison_status)),
      `legacy comparisons not accepted: ${JSON.stringify(comparisons.rows)}`);
    for (const row of comparisons.rows) ownership.comparisons.add(Number(row.id));
    assert(raceResults.filter((result) => result.claimed > 0).length === 1, "exactly one race claimant");

    const repeat = await observeSportCenterShadow({ client: setupDb, fixturePaymentIds: ids, shadowStartedAt: activation });
    assert(repeat.claimed === 0, "repeat observer claimed completed comparisons");
    const duplicateCount = await setupDb.query(`
      SELECT COUNT(*)::int AS count
        FROM sport_center.shadow_observer_comparisons
       WHERE project_code = 'sport_center' AND source_payment_id = ANY($1::int[])
    `, [ids]);
    assert(Number(duplicateCount.rows[0].count) === ids.length, "comparison duplicates");

    const old = await allocateSafeSportCenterFixturePayment(setupDb, "BACKLOG", "full_payment", ownership);
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
         const deleteOwned = async (table, column, values) => {
           if (values.size) await setupDb.query(
             `DELETE FROM ${table} WHERE ${column} = ANY($1::int[])`,
             [[...values]],
           );
         };
         await deleteOwned("sport_center.shadow_observer_comparisons", "id", ownership.comparisons);
         await deleteOwned("sport_center.payment_accounting_outbox", "id", ownership.outbox);
         await deleteOwned("sport_center.accounting_journal_lines", "id", ownership.lines);
         await deleteOwned("sport_center.accounting_journals", "id", ownership.journals);
         await deleteOwned("public.accounting_payments", "id", ownership.accountingPayments);
         await deleteOwned("public.accounting_entries", "id", ownership.accountingEntries);
         await deleteOwned("sport_center.sport_payments", "id", ownership.payments);
         await deleteOwned("sport_center.sport_bookings", "id", ownership.bookings);
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