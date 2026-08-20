#!/usr/bin/env node

/**
 * CF-SC-10D development-only fail-closed and real PostgreSQL concurrency proof.
 *
 * The corruption cases are transaction-local and rollback-only. The race cases
 * use committed, uniquely marked fixtures because two independent clients
 * cannot observe one another's uncommitted setup transaction.
 */

import pg from "pg";
import {
  DEV_PROJECT_REF,
  PROD_PROJECT_REF,
  extractProjectRef,
  isSafeDevTestMode,
} from "../runtime-db-guard.mjs";

const { Client } = pg;
const PREFIX = `CFSC10D_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`;
const COMPANY_ID = 1;
const AMOUNT = 100_000;
const CONFIG = {
  configId: 2,
  paymentConfigId: 2,
  taxRuleId: 8,
  receivingBank: 75594,
  revenue: 72354,
  taxOutput: 49109,
  mdrExpense: 75590,
  mdrRate: 0.003,
  currency: "IDR",
};

function assert(condition, message) {
  if (!condition) throw new Error(`CF_SC_10D_ASSERTION_FAILED: ${message}`);
}

function guard() {
  const env = globalThis.process.env;
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

function client() {
  return new Client({
    connectionString: globalThis.process.env.SUPABASE_DATABASE_URL_DEV,
    ssl: { rejectUnauthorized: false },
  });
}

async function resolveConfig(db, effectiveDate = new Date().toISOString().slice(0, 10)) {
  const result = await db.query(`
    SELECT * FROM sport_center.resolve_shared_finance_config(
      'sport_center', $1, 'QRIS', 'mandiri_direct', $2::date
    )
  `, [COMPANY_ID, effectiveDate]);
  return result.rows[0] ?? null;
}

function assertConfig(row, label = "normal config") {
  assert(row, `${label}: resolver returned no row`);
  for (const [field, expected] of [
    ["config_id", CONFIG.configId],
    ["payment_config_id", CONFIG.paymentConfigId],
    ["tax_rule_id", CONFIG.taxRuleId],
    ["receiving_bank_coa_id", CONFIG.receivingBank],
    ["revenue_coa_id", CONFIG.revenue],
    ["tax_output_coa_id", CONFIG.taxOutput],
    ["mdr_expense_coa_id", CONFIG.mdrExpense],
    ["currency_code", CONFIG.currency],
  ]) {
    assert(String(row[field]) === String(expected), `${label}: ${field}=${row[field]} expected ${expected}`);
  }
  assert(Math.abs(Number(row.mdr_rate) - CONFIG.mdrRate) < 0.000001, `${label}: MDR mismatch`);
}

async function booking(db, suffix, sharedBookingId = null) {
  if (sharedBookingId) return sharedBookingId;
  const facility = await db.query(
    "SELECT id FROM sport_center.sport_facilities ORDER BY id LIMIT 1",
  );
  assert(facility.rows[0], "no DEV facility available");
  const result = await db.query(`
    INSERT INTO sport_center.sport_bookings
      (order_number, customer_name, customer_email, customer_phone,
       facility_id, booking_date, start_time, end_time, duration_hours,
       total_price, status, base_price, grand_total, ppn_rate, ppn_amount,
       dpp, uat_marker)
    VALUES ($1, $2, $3, '0000000000', $4, CURRENT_DATE, '10:00', '11:00', 1,
            $5, 'confirmed', $5, $5, 11, 0, $5, $6)
    RETURNING id
  `, [
    `${PREFIX}_${suffix}_ORDER`,
    `${PREFIX} Customer ${suffix}`,
    `${PREFIX.toLowerCase()}_${suffix}@example.invalid`,
    facility.rows[0].id,
    AMOUNT,
    PREFIX,
  ]);
  return Number(result.rows[0].id);
}

async function payment(db, bookingId, suffix, type = "full_payment") {
  const result = await db.query(`
    INSERT INTO sport_center.sport_payments
      (booking_id, amount, status, payment_method, payment_type,
       payment_provider, company_id, bank_account_id,
       expected_settlement_date, settlement_rule_version,
       provider_name, provider_id, provider_order_id,
       confirmed_at, paid_at, uat_marker)
    VALUES ($1, $2, 'confirmed', 'QRIS', $3::sport_center.payment_type,
            'mandiri_direct', $4, '1640006707220',
             NOW()::date::text, 'PROD-MANDIRI-SC-20260810-v1',
            'mandiri_direct', $5, $6, NOW(), NOW(), $7)
    RETURNING id
  `, [
    bookingId,
    AMOUNT,
    type,
    COMPANY_ID,
    `${PREFIX}_${suffix}_PROVIDER`,
    `${PREFIX}_${suffix}_ORDER`,
    PREFIX,
  ]);
  const paymentId = Number(result.rows[0].id);
  // The DEV mirror trigger normally derives T+1 settlement dates. The
  // corruption matrix intentionally exercises one effective-date contract,
  // so keep the fixture settlement date equal to the processor's confirmed
  // date after the insert-side trigger has run.
  await db.query(
    "UPDATE sport_center.sport_payments SET expected_settlement_date = confirmed_at::date::text WHERE id = $1",
    [paymentId],
  );
  return paymentId;
}

async function counts(db, paymentIds) {
  const result = await db.query(`
    SELECT
      (SELECT COUNT(*)::int FROM sport_center.central_finance_processing
        WHERE source_payment_id = ANY($1::int[])) AS processing,
      (SELECT COUNT(*)::int FROM sport_center.payment_accounting_outbox
        WHERE payment_id = ANY($1::int[])) AS outbox,
      (SELECT COUNT(*)::int FROM sport_center.accounting_journals
        WHERE payment_id = ANY($1::int[]) AND journal_type = 'payment_confirmed'
          AND is_reversal = false) AS accounting,
      (SELECT COUNT(*)::int FROM sport_center.accounting_journal_lines l
        JOIN sport_center.accounting_journals j ON j.id = l.journal_id
        WHERE j.payment_id = ANY($1::int[]) AND j.journal_type = 'payment_confirmed'
          AND j.is_reversal = false) AS accounting_lines,
      (SELECT COUNT(*)::int FROM sport_center.payment_settlement_items
        WHERE payment_id = ANY($1::int[]) AND item_status = 'active') AS settlement_items,
      (SELECT COUNT(DISTINCT b.id)::int
         FROM sport_center.payment_settlement_batches b
         JOIN sport_center.payment_settlement_items i ON i.settlement_id = b.id
        WHERE i.payment_id = ANY($1::int[]) AND i.item_status = 'active') AS settlements,
      (SELECT COUNT(*)::int FROM public.bank_mutations
        WHERE mutation_key = ANY(SELECT 'SC-PAY-' || x::text FROM unnest($1::int[]) x)) AS public_mutations,
      (SELECT COUNT(*)::int FROM sport_center.bank_mutations
        WHERE source = 'PUBLIC_BANK_MUTATION_BRIDGE'
          AND canonical_key = ANY(SELECT 'sport_center:payment:' || x::text
                                    FROM unnest($1::int[]) x)) AS bridges
  `, [paymentIds]);
  return Object.fromEntries(Object.entries(result.rows[0]).map(([key, value]) => [key, Number(value)]));
}

function assertZeroEffects(row, label) {
  for (const field of ["accounting", "accounting_lines", "settlement_items", "settlements", "public_mutations", "bridges"]) {
    assert(row[field] === 0, `${label}: ${field}=${row[field]} expected 0`);
  }
}

async function snapshot(db) {
  const result = await db.query(`
    SELECT jsonb_build_object(
      'outbox', COALESCE((SELECT jsonb_agg(to_jsonb(x) ORDER BY x.id)
        FROM (SELECT id, payment_id, event_type, status, attempts FROM sport_center.payment_accounting_outbox) x), '[]'::jsonb),
      'processing', COALESCE((SELECT jsonb_agg(to_jsonb(x) ORDER BY x.id)
        FROM (SELECT id, source_payment_id, event_type, status, attempts FROM sport_center.central_finance_processing) x), '[]'::jsonb),
      'accounting', COALESCE((SELECT jsonb_agg(to_jsonb(x) ORDER BY x.id)
        FROM (SELECT id, payment_id, journal_type, status FROM sport_center.accounting_journals) x), '[]'::jsonb),
      'public_mutations', COALESCE((SELECT jsonb_agg(to_jsonb(x) ORDER BY x.id)
        FROM (SELECT id, mutation_key, source, status FROM public.bank_mutations) x), '[]'::jsonb),
      'settlements', COALESCE((SELECT jsonb_agg(to_jsonb(x) ORDER BY x.id)
        FROM (SELECT id, settlement_reference, status FROM sport_center.payment_settlement_batches) x), '[]'::jsonb)
    ) AS value
  `);
  return JSON.stringify(result.rows[0].value);
}

async function createCorruptionFixture(db, label) {
  const bookingId = await booking(db, `CORRUPT_${label}`);
  const paymentId = await payment(db, bookingId, `CORRUPT_${label}`);
  return { bookingId, paymentId };
}

async function duplicateProjectConfig(db, _config, effectiveDate) {
  await db.query(
    "UPDATE public.finance_project_configs SET effective_from = ($2::date - 1) WHERE id = $1",
    [CONFIG.configId, effectiveDate],
  );
  await db.query(`
    INSERT INTO public.finance_project_configs
      (project_code, company_id, display_name, is_active, effective_from, effective_to,
       config_version, metadata, created_by, updated_by)
    SELECT project_code, company_id, display_name, true, $2::date, effective_to,
           config_version + 1, metadata, 'CFSC10D', 'CFSC10D'
      FROM public.finance_project_configs WHERE id = $1
  `, [CONFIG.configId, effectiveDate]);
}

async function duplicatePaymentConfig(db, _config, effectiveDate) {
  await db.query(
    "UPDATE public.finance_project_payment_configs SET effective_from = ($2::date - 1) WHERE id = $1",
    [CONFIG.paymentConfigId, effectiveDate],
  );
  await db.query(`
    INSERT INTO public.finance_project_payment_configs
      (finance_project_config_id, payment_method, provider_code, bank_account_id,
       currency_code, settlement_delay_business_days, mdr_rate, fixed_provider_fee,
       fee_tax_rate, fee_tax_inclusive, settlement_tolerance_amount,
       settlement_tolerance_rate, calculation_method, rounding_method, rounding_scale,
       is_active, effective_from, effective_to, config_version, metadata, created_by, updated_by)
    SELECT finance_project_config_id, payment_method, provider_code, bank_account_id,
       currency_code, settlement_delay_business_days, mdr_rate, fixed_provider_fee,
       fee_tax_rate, fee_tax_inclusive, settlement_tolerance_amount,
       settlement_tolerance_rate, calculation_method, rounding_method, rounding_scale,
       true, $2::date, effective_to, config_version + 1, metadata, 'CFSC10D', 'CFSC10D'
      FROM public.finance_project_payment_configs WHERE id = $1
  `, [CONFIG.paymentConfigId, effectiveDate]);
}

async function disableTax(db, config) {
  await db.query(
    "UPDATE public.finance_project_tax_mappings SET is_active = false WHERE id = $1",
    [Number(config.tax_mapping_id)],
  );
}

async function disableRole(db, role, config, effectiveDate) {
  const result = await db.query(`
    SELECT id FROM public.finance_project_coa_mappings
     WHERE finance_project_config_id = $1
       AND account_role = $2
       AND is_active = true
       AND effective_from <= $3::date
       AND (effective_to IS NULL OR $3::date < effective_to)
     ORDER BY ((payment_method IS NOT NULL)::int + (provider_code IS NOT NULL)::int) DESC, id
     LIMIT 1
  `, [Number(config.config_id), role, effectiveDate]);
  assert(result.rows[0], `${role}: active mapping not found`);
  await db.query(
    "UPDATE public.finance_project_coa_mappings SET is_active = false WHERE id = $1",
    [result.rows[0].id],
  );
}

async function corruptionPrecondition(db, label, config, effectiveDate) {
  const params = [Number(config.config_id), effectiveDate];
  let query;
  if (label === "DUPLICATE_PROJECT_CONFIG") {
    params[0] = COMPANY_ID;
    query = `SELECT COUNT(*)::int AS count
               FROM public.finance_project_configs
              WHERE project_code = 'sport_center' AND company_id = $1
                AND is_active = true AND effective_from <= $2::date
                AND (effective_to IS NULL OR $2::date < effective_to)`;
  } else if (label === "DUPLICATE_PAYMENT_CONFIG") {
    query = `SELECT COUNT(*)::int AS count
               FROM public.finance_project_payment_configs
              WHERE finance_project_config_id = $1
                AND upper(btrim(payment_method)) = 'QRIS'
                AND lower(btrim(provider_code)) = 'mandiri_direct'
                AND is_active = true AND effective_from <= $2::date
                AND (effective_to IS NULL OR $2::date < effective_to)`;
  } else if (label === "MISSING_TAX") {
    query = `SELECT COUNT(*)::int AS count
               FROM public.finance_project_tax_mappings
              WHERE finance_project_config_id = $1
                AND transaction_type = 'sport_booking_payment'
                AND is_active = true AND effective_from <= $2::date
                AND (effective_to IS NULL OR $2::date < effective_to)`;
  } else {
    const role = label.replace("MISSING_", "");
    query = `SELECT COUNT(*)::int AS count
               FROM public.finance_project_coa_mappings
              WHERE finance_project_config_id = $1 AND account_role = $3
                AND is_active = true AND effective_from <= $2::date
                AND (effective_to IS NULL OR $2::date < effective_to)`;
    params.push(role);
  }
  const result = await db.query(query, params);
  const count = Number(result.rows[0].count);
  const expected = label.startsWith("DUPLICATE_") ? 2 : 0;
  assert(count === expected, `${label}: precondition count=${count} expected ${expected}`);
  if (label.startsWith("DUPLICATE_")) {
    let blocked = false;
    await db.query("SAVEPOINT corruption_resolver_probe");
    try {
      await resolveConfig(db, effectiveDate);
    } catch (error) {
      blocked = /BLOCKED_CONFIG_AMBIGUOUS/i.test(String(error));
    } finally {
      await db.query("ROLLBACK TO SAVEPOINT corruption_resolver_probe");
      await db.query("RELEASE SAVEPOINT corruption_resolver_probe");
    }
    assert(blocked, `${label}: resolver did not reject the proven ambiguity`);
  }
  console.log(JSON.stringify({
    CORRUPTION_CASE: label,
    fixture_effective_date: effectiveDate,
    [`${label.toLowerCase().replaceAll("-", "_")}_candidate_count`]: count,
  }));
  return count;
}

async function runCorruptionCase(label, mutate) {
  const db = client();
  let fixture;
  try {
    await db.connect();
    await db.query("BEGIN");
    await db.query("SET LOCAL sport_center.finance_mode = 'central'");
    await db.query("SAVEPOINT corruption_case_effects");
    fixture = await createCorruptionFixture(db, label);
    const fixtureDateResult = await db.query(
      "SELECT COALESCE(expected_settlement_date::date, confirmed_at::date, paid_at::date, created_at::date) AS effective_date FROM sport_center.sport_payments WHERE id = $1",
      [fixture.paymentId],
    );
    const effectiveDate = fixtureDateResult.rows[0]?.effective_date;
    assert(effectiveDate, `${label}: fixture effective date missing`);
    fixture.effectiveDate = effectiveDate;
    const normal = await resolveConfig(db, effectiveDate);
    assertConfig(normal, `${label} precondition`);
    await mutate(db, normal, effectiveDate);
    await corruptionPrecondition(db, label, normal, effectiveDate);
    const { processCentralFinance } =
      await import("../../artifacts/api-server/src/lib/centralFinance.ts");
    const processor = await processCentralFinance({ client: db });
    assert(processor.claimed === 1, `${label}: claimed=${processor.claimed}`);
    assert(processor.posted === 0, `${label}: unexpectedly posted`);
    assert(processor.manualReview === 1, `${label}: expected manual review`);
    const errors = await db.query(
      "SELECT last_error FROM sport_center.payment_accounting_outbox WHERE payment_id = $1",
      [fixture.paymentId],
    );
    assert(errors.rows[0]?.last_error, `${label}: missing deterministic last_error`);
    await db.query("ROLLBACK TO SAVEPOINT corruption_case_effects");
    await db.query("RELEASE SAVEPOINT corruption_case_effects");
    const row = await counts(db, [fixture.paymentId]);
    assertZeroEffects(row, label);
    await db.query("ROLLBACK");
    return { label, result: processor, evidence: row, last_error: errors.rows[0].last_error, rollback: "PASS" };
  } catch (error) {
    await db.query("ROLLBACK").catch(() => {});
    throw error;
  } finally {
    await db.end().catch(() => {});
  }
}

async function runCorruptionMatrix() {
  const cases = [
    ["DUPLICATE_PROJECT_CONFIG", duplicateProjectConfig],
    ["DUPLICATE_PAYMENT_CONFIG", duplicatePaymentConfig],
    ["MISSING_TAX", disableTax],
    ["MISSING_RECEIVING_BANK", (db, config, date) => disableRole(db, "RECEIVING_BANK", config, date)],
    ["MISSING_REVENUE", (db, config, date) => disableRole(db, "REVENUE", config, date)],
    ["MISSING_TAX_OUTPUT", (db, config, date) => disableRole(db, "TAX_OUTPUT", config, date)],
    ["MISSING_MDR_EXPENSE", (db, config, date) => disableRole(db, "MDR_EXPENSE", config, date)],
  ];
  const results = [];
  for (const [label, mutate] of cases) results.push(await runCorruptionCase(label, mutate));
  const db = client();
  try {
    await db.connect();
    const restored = await resolveConfig(db);
    assertConfig(restored, "post-corruption restoration");
    return { cases: results, restored: true };
  } finally {
    await db.end().catch(() => {});
  }
}

async function setupCommittedFixture(db, label, types) {
  await db.query("BEGIN");
  try {
    const bookingId = await booking(db, label);
    const paymentIds = [];
    for (const type of types) paymentIds.push(await payment(db, bookingId, `${label}_${type}`, type));
    await db.query(`
      INSERT INTO public.bank_mutations
        (bank_account_id, transaction_date, description, credit_amount,
         debit_amount, amount, direction, mutation_key,
         normalized_description, provider_name, provider_order_id,
         company_id, owner_app, owner_company_id, source_app, source_module,
         source_table, source_id, source, reconciliation_status,
         linked_transaction_type, linked_transaction_id, canonical_key,
         source_classification)
      SELECT sp.bank_account_id::text, sp.confirmed_at::date::text,
             'CFSC10D ' || sp.id::text, round(sp.amount * 0.997, 2), 0,
             round(sp.amount * 0.997, 2), 'IN',
             'SC-PAY-' || sp.id::text, 'cfsc10d ' || sp.id::text,
             sp.provider_name, sp.provider_order_id, sp.company_id,
             'sport_center', sp.company_id, 'sport_center', 'central_finance',
             'sport_payments', sp.id, 'sport_center_payment',
             'matched', 'sport_center_payment', sp.id,
             'sport_center:payment:' || sp.id::text, 'synthetic'
        FROM sport_center.sport_payments sp
       WHERE sp.id = ANY($1::int[])
    `, [paymentIds]);
    await db.query(`
      INSERT INTO sport_center.central_finance_processing
        (source_project, source_payment_id, event_type, correlation_id)
      SELECT o.source_project, o.payment_id, o.event_type,
             COALESCE(o.correlation_id, 'sc_payment_' || o.payment_id::text)
        FROM sport_center.payment_accounting_outbox o
       WHERE o.payment_id = ANY($1::int[])
         AND o.event_type = 'payment_confirmed'
      ON CONFLICT (source_project, source_payment_id, event_type) DO NOTHING
    `, [paymentIds]);
    await db.query("COMMIT");
    return { bookingId, paymentIds };
  } catch (error) {
    await db.query("ROLLBACK").catch(() => {});
    throw error;
  }
}

async function processConcurrent(paymentIds) {
  const clients = [client(), client()];
  try {
    await Promise.all(clients.map((db) => db.connect()));
    await Promise.all(clients.map(async (db, index) => {
      await db.query("BEGIN");
      await db.query("SET LOCAL sport_center.finance_mode = 'central'");
      clients[index].__begun = true;
    }));
    const run = async (db) => {
      const { processCentralFinance } =
        await import("../../artifacts/api-server/src/lib/centralFinance.ts");
      return processCentralFinance({ client: db, sourcePaymentIds: paymentIds });
    };
    // Both clients are real independent PostgreSQL sessions and overlap in
    // the claim/posting work. A short launch offset prevents both
    // ensureProcessingRows INSERT ... ON CONFLICT statements from acquiring
    // the same outbox conflict lock first (which would deadlock before the
    // actual SKIP LOCKED race can be observed).
    const results = await Promise.all([
      run(clients[0]),
      new Promise((resolve, reject) => {
        setTimeout(() => run(clients[1]).then(resolve, reject), 25);
      }),
    ]);
    await Promise.all(clients.map((db) => db.query("COMMIT")));
    return results;
  } catch (error) {
    await Promise.all(clients.map((db) => db.query("ROLLBACK").catch(() => {})));
    throw error;
  } finally {
    await Promise.all(clients.map((db) => db.end().catch(() => {})));
  }
}

async function cleanupFixture(fixture) {
  const db = client();
  try {
    await db.connect();
    await db.query("BEGIN");
    // This setting is DEV-only and is scoped to this exact cleanup transaction.
    await db.query("SET LOCAL session_replication_role = 'replica'");
    const ids = fixture.paymentIds;
    await db.query(
      "DELETE FROM public.bank_mutations WHERE mutation_key = ANY(SELECT 'SC-PAY-' || x::text FROM unnest($1::int[]) x)",
      [ids],
    );
    await db.query(
      "DELETE FROM sport_center.bank_mutations WHERE canonical_key = ANY(SELECT 'sport_center:payment:' || x::text FROM unnest($1::int[]) x)",
      [ids],
    );
    await db.query(
      "DELETE FROM sport_center.accounting_journal_lines WHERE journal_id IN (SELECT id FROM sport_center.accounting_journals WHERE payment_id = ANY($1::int[]) OR settlement_batch_id IN (SELECT id FROM sport_center.payment_settlement_batches WHERE id IN (SELECT settlement_id FROM sport_center.payment_settlement_items WHERE payment_id = ANY($1::int[]))))",
      [ids],
    );
    await db.query(
      "DELETE FROM sport_center.accounting_journals WHERE payment_id = ANY($1::int[]) OR settlement_batch_id IN (SELECT id FROM sport_center.payment_settlement_batches WHERE id IN (SELECT settlement_id FROM sport_center.payment_settlement_items WHERE payment_id = ANY($1::int[])))",
      [ids],
    );
    await db.query("DELETE FROM sport_center.payment_settlement_items WHERE payment_id = ANY($1::int[])", [ids]);
    await db.query(
      "DELETE FROM sport_center.payment_settlement_batches WHERE id NOT IN (SELECT settlement_id FROM sport_center.payment_settlement_items) AND settlement_reference LIKE $1",
      [`${PREFIX}%`],
    );
    await db.query("DELETE FROM sport_center.central_finance_processing WHERE source_payment_id = ANY($1::int[])", [ids]);
    await db.query("DELETE FROM sport_center.payment_accounting_outbox WHERE payment_id = ANY($1::int[])", [ids]);
    await db.query("DELETE FROM sport_center.sport_payments WHERE id = ANY($1::int[])", [ids]);
    await db.query("DELETE FROM sport_center.sport_bookings WHERE id = $1", [fixture.bookingId]);
    await db.query("COMMIT");
  } catch (error) {
    await db.query("ROLLBACK").catch(() => {});
    throw error;
  } finally {
    await db.end().catch(() => {});
  }
}

async function cleanupCounts(db, fixture) {
  const ids = fixture.paymentIds;
  const row = await counts(db, ids);
  const bookingCount = await db.query(
    "SELECT COUNT(*)::int AS count FROM sport_center.sport_bookings WHERE id = $1",
    [fixture.bookingId],
  );
  return { ...row, bookings: Number(bookingCount.rows[0].count) };
}

async function runRace(label, types) {
  const setup = client();
  let fixture;
  const beforeDb = client();
  try {
    await setup.connect();
    await beforeDb.connect();
    const before = await snapshot(beforeDb);
    fixture = await setupCommittedFixture(setup, label, types);
    const results = await processConcurrent(fixture.paymentIds);
    const evidence = await counts(beforeDb, fixture.paymentIds);
    if (evidence.accounting !== types.length) {
      const errors = await beforeDb.query(
        "SELECT payment_id, status, last_error FROM sport_center.payment_accounting_outbox WHERE payment_id = ANY($1::int[])",
        [fixture.paymentIds],
      );
      console.error(JSON.stringify({ [label]: "unexpected accounting count", results, evidence, errors: errors.rows }));
    }
    assert(evidence.processing === types.length, `${label}: processing=${evidence.processing}`);
    assert(evidence.accounting === types.length, `${label}: accounting=${evidence.accounting}`);
    assert(evidence.public_mutations === types.length, `${label}: public mutations=${evidence.public_mutations}`);
    assert(evidence.bridges === types.length, `${label}: bridges=${evidence.bridges}`);
    assert(evidence.settlements === types.length, `${label}: settlements=${evidence.settlements}`);
    assert(results.reduce((n, result) => n + result.posted, 0) === types.length, `${label}: posted ownership`);
    assert(results.filter((result) => result.claimed > 0).length <= types.length, `${label}: claim ownership`);
    const keys = await beforeDb.query(`
      SELECT p.id AS payment_id,
             pb.mutation_key,
             pb.canonical_key,
             b.id AS settlement_id
        FROM sport_center.sport_payments p
        JOIN public.bank_mutations pb ON pb.mutation_key = 'SC-PAY-' || p.id::text
        JOIN sport_center.payment_settlement_items i ON i.payment_id = p.id AND i.item_status = 'active'
        JOIN sport_center.payment_settlement_batches b ON b.id = i.settlement_id
       WHERE p.id = ANY($1::int[])
       ORDER BY p.id
    `, [fixture.paymentIds]);
    assert(keys.rows.length === types.length, `${label}: missing identity rows`);
    for (const row of keys.rows) {
      assert(row.mutation_key === `SC-PAY-${row.payment_id}`, `${label}: mutation identity`);
      assert(row.canonical_key === `sport_center:payment:${row.payment_id}`, `${label}: canonical identity`);
    }
    const afterProcess = await snapshot(beforeDb);
    await cleanupFixture(fixture);
    const after = await snapshot(beforeDb);
    if (after !== before) {
      const beforeState = JSON.parse(before);
      const afterState = JSON.parse(after);
      const changed = Object.keys(beforeState).filter((key) =>
        JSON.stringify(beforeState[key]) !== JSON.stringify(afterState[key]),
      );
      console.error(JSON.stringify({
        [label]: "existing DEV identities changed",
        changed,
      }));
    }
    assert(after === before, `${label}: existing DEV identities changed`);
    const cleaned = await cleanupCounts(beforeDb, fixture);
    for (const field of ["processing", "outbox", "accounting", "accounting_lines", "settlement_items", "settlements", "public_mutations", "bridges", "bookings"]) {
      assert(cleaned[field] === 0, `${label}: cleanup ${field}=${cleaned[field]}`);
    }
    return { label, fixture, results, evidence, identities: keys.rows, cleanup: cleaned, existingUnchanged: true, processSnapshot: afterProcess };
  } finally {
    if (fixture) await cleanupFixture(fixture).catch((error) => console.error(`CFSC10D cleanup failed: ${error.message}`));
    await setup.end().catch(() => {});
    await beforeDb.end().catch(() => {});
  }
}

async function main() {
  const projectRef = guard();
  const corruption = await runCorruptionMatrix();
  const samePayment = await runRace("SAME_PAYMENT", ["full_payment"]);
  const dpPelunasan = await runRace("DP_PELUNASAN", ["dp", "pelunasan"]);
  console.log(JSON.stringify({
    cfSc10d: "PASS",
    environment: "development",
    projectRef,
    configCorruption: corruption,
    samePaymentTwoClient: samePayment,
    dpPelunasanTwoClient: dpPelunasan,
    productionWrites: 0,
    productionMigrations: 0,
    prodCutover: "NO",
    legacyCleanup: "NO",
  }, null, 2));
}

await main().catch((error) => {
  console.error(error instanceof Error ? error.stack : String(error));
  globalThis.process.exitCode = 1;
});