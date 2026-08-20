#!/usr/bin/env node

/**
 * CF-SC-10B rollback-only development smoke harness.
 *
 * Run only through the development Secret Manager loader:
 *   cd artifacts/api-server
 *   APP_ENV=development NODE_ENV=development \
 *   SAFE_DEV_TEST_MODE=true SPORT_CENTER_FINANCE_MODE=central \
 *   node load-secrets.mjs pnpm --dir ../../scripts cf-sc-10b:dev
 *
 * This script creates one synthetic QRIS full-payment fixture, invokes the
 * actual central-finance processor, verifies the result, and rolls back the
 * entire transaction. It never claims or changes existing events.
 */

import pg from "pg";
import {
  DEV_PROJECT_REF,
  PROD_PROJECT_REF,
  extractProjectRef,
  isSafeDevTestMode,
} from "../runtime-db-guard.mjs";

const { Client } = pg;
const PREFIX = `CFSC10B_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`;
const COMPANY_ID = 1;
const ACTOR = "cf-sc-10b-rollback-harness";
const AMOUNT = 100_000;
const EXPECTED_CONFIG = {
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
  if (!condition) throw new Error(`CF_SC_10B_ASSERTION_FAILED: ${message}`);
}

function devGuard() {
  assert(process.env.APP_ENV === "development", "APP_ENV must be development");
  assert(process.env.NODE_ENV !== "production", "NODE_ENV must not be production");
  assert(process.env.SAFE_DEV_TEST_MODE === "true", "SAFE_DEV_TEST_MODE=true is required");
  assert(process.env.SPORT_CENTER_FINANCE_MODE === "central", "central finance mode is required");

  const url = process.env.SUPABASE_DATABASE_URL_DEV;
  assert(url, "SUPABASE_DATABASE_URL_DEV is required");
  const projectRef = extractProjectRef(url);
  assert(projectRef === DEV_PROJECT_REF, `unexpected DEV project ref: ${projectRef ?? "unknown"}`);
  assert(projectRef !== PROD_PROJECT_REF, "DEV URL matches production project");
  assert(
    extractProjectRef(process.env.SUPABASE_DATABASE_URL) !== PROD_PROJECT_REF,
    "canonical database URL resolves to production project",
  );

  const safeMode = isSafeDevTestMode();
  assert(safeMode.allowed, "runtime DB guard did not approve shared DEV test mode");
  return { projectRef };
}

async function verifyRuntime(client) {
  const requiredTables = [
    ["sport_center", "sport_payments"],
    ["sport_center", "payment_accounting_outbox"],
    ["sport_center", "central_finance_processing"],
    ["sport_center", "payment_settlement_batches"],
    ["sport_center", "payment_settlement_items"],
    ["public", "accounting_entries"],
    ["public", "accounting_entry_lines"],
    ["public", "bank_mutations"],
  ];
  const tables = await client.query(
    `SELECT table_schema, table_name
       FROM information_schema.tables
      WHERE (table_schema, table_name) IN (
        SELECT * FROM unnest($1::text[], $2::text[])
      )`,
    [
      requiredTables.map(([schema]) => schema),
      requiredTables.map(([, table]) => table),
    ],
  );
  const present = new Set(tables.rows.map((row) => `${row.table_schema}.${row.table_name}`));
  for (const [schema, table] of requiredTables) {
    assert(present.has(`${schema}.${table}`), `missing required table ${schema}.${table}`);
  }

  const functions = await client.query(
    `SELECT p.proname AS name, pg_get_function_identity_arguments(p.oid) AS args
       FROM pg_proc p
       JOIN pg_namespace n ON n.oid = p.pronamespace
      WHERE n.nspname = 'sport_center'
        AND p.proname = ANY($1::text[])`,
    [[
      "resolve_shared_finance_config",
      "create_payment_accounting_draft",
      "create_payment_settlement_batch",
      "finalize_payment_settlement",
    ]],
  );
  const names = new Set(functions.rows.map((row) => row.name));
  for (const name of [
    "resolve_shared_finance_config",
    "create_payment_accounting_draft",
    "create_payment_settlement_batch",
    "finalize_payment_settlement",
  ]) {
    assert(names.has(name), `missing required function sport_center.${name}`);
  }

  const config = await client.query(
    `SELECT *
       FROM sport_center.resolve_shared_finance_config(
         'sport_center', $1, 'QRIS', 'mandiri_direct', CURRENT_DATE
       )`,
    [COMPANY_ID],
  );
  const row = config.rows[0];
  assert(row, "shared finance resolver returned no configuration");
  for (const [field, expected] of [
    ["config_id", EXPECTED_CONFIG.configId],
    ["payment_config_id", EXPECTED_CONFIG.paymentConfigId],
    ["tax_rule_id", EXPECTED_CONFIG.taxRuleId],
    ["receiving_bank_coa_id", EXPECTED_CONFIG.receivingBank],
    ["revenue_coa_id", EXPECTED_CONFIG.revenue],
    ["tax_output_coa_id", EXPECTED_CONFIG.taxOutput],
    ["mdr_expense_coa_id", EXPECTED_CONFIG.mdrExpense],
    ["currency_code", EXPECTED_CONFIG.currency],
  ]) {
    assert(String(row[field]) === String(expected), `shared config ${field}=${row[field]} expected ${expected}`);
  }
  assert(Math.abs(Number(row.mdr_rate) - EXPECTED_CONFIG.mdrRate) < 0.000001, "shared MDR rate mismatch");
  return row;
}

async function snapshot(client) {
  const result = await client.query(
    `SELECT
       (SELECT COUNT(*)::int FROM sport_center.payment_accounting_outbox) AS outbox_count,
       (SELECT COUNT(*)::int FROM sport_center.central_finance_processing) AS processing_count,
       (SELECT string_agg(id::text || ':' || status, ',' ORDER BY id)
          FROM sport_center.payment_accounting_outbox) AS outbox_identity,
       (SELECT string_agg(id::text || ':' || status, ',' ORDER BY id)
          FROM sport_center.central_finance_processing) AS processing_identity`,
  );
  return result.rows[0];
}

async function createFixture(client) {
  const facility = await client.query(
    `SELECT id FROM sport_center.sport_facilities
      ORDER BY id
      LIMIT 1`,
  );
  assert(facility.rows[0], "no DEV Sport Center facility available for fixture");

  const orderNumber = `${PREFIX}_ORDER`;
  const booking = await client.query(
    `INSERT INTO sport_center.sport_bookings
      (order_number, customer_name, customer_email, customer_phone,
       facility_id, booking_date, start_time, end_time, duration_hours,
       total_price, status, base_price,
       grand_total, ppn_rate, ppn_amount, dpp,
       uat_marker)
     VALUES
      ($1, $2, $3, $4, $5, CURRENT_DATE, '10:00', '11:00', 1,
       $6, 'confirmed', $6,
       $6, 0, 0, $6, $7)
     RETURNING id`,
    [orderNumber, `${PREFIX} Customer`, `${PREFIX.toLowerCase()}@example.invalid`, "0000000000",
      facility.rows[0].id, AMOUNT, PREFIX],
  );
  const bookingId = Number(booking.rows[0].id);

  const payment = await client.query(
    `INSERT INTO sport_center.sport_payments
      (booking_id, amount, status, payment_method, payment_type,
       payment_provider, company_id, bank_account_id,
       expected_settlement_date, settlement_rule_version,
       provider_name, provider_id, provider_order_id,
       confirmed_at, paid_at, uat_marker)
     VALUES
      ($1, $2, 'confirmed', 'QRIS', 'full_payment',
       'mandiri_direct', $3, '1640006707220',
       (CURRENT_DATE + 1)::text, 'PROD-MANDIRI-SC-20260810-v1',
       'mandiri_direct', $4, $5,
       NOW(), NOW(), $6)
     RETURNING id`,
    [bookingId, AMOUNT, COMPANY_ID, `${PREFIX}_PROVIDER`, `${PREFIX}_ORDER`, PREFIX],
  );
  const paymentId = Number(payment.rows[0].id);

  const outbox = await client.query(
    `SELECT id, payment_id, event_type
       FROM sport_center.payment_accounting_outbox
      WHERE payment_id = $1 AND event_type = 'payment_confirmed'
      ORDER BY id DESC
      LIMIT 1`,
    [paymentId],
  );
  assert(outbox.rows[0], "payment confirmation trigger did not create an outbox event");
  assert(
    Number(outbox.rows[0].payment_id) === paymentId &&
      outbox.rows[0].event_type === "payment_confirmed",
    "outbox event identity is not owned by this fixture",
  );
  return { bookingId, paymentId, orderNumber };
}

async function verifyFixture(client, paymentId) {
  const processing = await client.query(
    `SELECT status, attempts FROM sport_center.central_finance_processing
      WHERE source_payment_id = $1 AND event_type = 'payment_confirmed'`,
    [paymentId],
  );
  const outbox = await client.query(
    `SELECT status, attempts FROM sport_center.payment_accounting_outbox
      WHERE payment_id = $1 AND event_type = 'payment_confirmed'`,
    [paymentId],
  );
  const journals = await client.query(
    `SELECT id, status, debit_amount, credit_revenue_amount, credit_ppn_amount
       FROM sport_center.accounting_journals
      WHERE payment_id = $1 AND journal_type = 'payment_confirmed' AND is_reversal = false`,
    [paymentId],
  );
  const settlement = await client.query(
    `SELECT b.id, b.status, b.canonical_bank_mutation_id, b.bank_mutation_id,
            COUNT(i.id)::int AS item_count
       FROM sport_center.payment_settlement_batches b
       JOIN sport_center.payment_settlement_items i ON i.settlement_id = b.id
      WHERE i.payment_id = $1
      GROUP BY b.id, b.status, b.canonical_bank_mutation_id, b.bank_mutation_id`,
    [paymentId],
  );

  assert(processing.rows.length === 1, "exactly one processing identity");
  assert(outbox.rows.length === 1, "exactly one outbox identity");
  assert(processing.rows[0].status === "posted", `processing status=${processing.rows[0].status}`);
  assert(outbox.rows[0].status === "posted", `outbox status=${outbox.rows[0].status}`);
  assert(journals.rows.length === 1, `accounting journal count=${journals.rows.length}`);
  const journal = journals.rows[0];
  assert(journal.status === "posted", `journal status=${journal.status}`);
  assert(
    Math.abs(Number(journal.debit_amount) -
      (Number(journal.credit_revenue_amount) + Number(journal.credit_ppn_amount))) < 0.01,
    "journal is not balanced",
  );
  assert(settlement.rows.length === 1, `settlement batch count=${settlement.rows.length}`);
  assert(settlement.rows[0].status === "posted", `settlement status=${settlement.rows[0].status}`);
  assert(settlement.rows[0].canonical_bank_mutation_id != null, "canonical bank mutation is missing");
  assert(settlement.rows[0].bank_mutation_id == null, "legacy bank mutation must remain null");
  return {
    processing: processing.rows[0],
    outbox: outbox.rows[0],
    journal,
    settlement: settlement.rows[0],
  };
}

async function proveRollback(separateClient, fixture) {
  for (const [table, column, value] of [
    ["sport_center.sport_payments", "id", fixture.paymentId],
    ["sport_center.sport_bookings", "id", fixture.bookingId],
  ]) {
    const result = await separateClient.query(`SELECT COUNT(*)::int AS count FROM ${table} WHERE ${column} = $1`, [value]);
    assert(Number(result.rows[0].count) === 0, `${table} fixture survived rollback`);
  }
  for (const [table, condition, value] of [
    ["sport_center.payment_accounting_outbox", "payment_id", fixture.paymentId],
    ["sport_center.central_finance_processing", "source_payment_id", fixture.paymentId],
    ["sport_center.payment_settlement_items", "payment_id", fixture.paymentId],
  ]) {
    const result = await separateClient.query(`SELECT COUNT(*)::int AS count FROM ${table} WHERE ${condition} = $1`, [value]);
    assert(Number(result.rows[0].count) === 0, `${table} fixture survived rollback`);
  }
}

async function main() {
  const guard = devGuard();
  const client = new Client({ connectionString: process.env.SUPABASE_DATABASE_URL_DEV, ssl: { rejectUnauthorized: false } });
  const verifier = new Client({ connectionString: process.env.SUPABASE_DATABASE_URL_DEV, ssl: { rejectUnauthorized: false } });
  let fixture;
  try {
    await client.connect();
    await verifier.connect();
    const config = await verifyRuntime(client);
    const before = await snapshot(client);
    assert(Number(before.outbox_count) === 10, `expected 10 existing outbox rows, found ${before.outbox_count}`);
    assert(Number(before.processing_count) === 10, `expected 10 existing processing rows, found ${before.processing_count}`);

    await client.query("BEGIN");
    fixture = await createFixture(client);
    const { processCentralFinance } = await import("../../artifacts/api-server/src/lib/centralFinance.ts");
    const processor = await processCentralFinance({ client });
    assert(processor.claimed === 1, `processor claimed=${processor.claimed}`);
    if (processor.posted !== 1) {
      const failure = await client.query(
        `SELECT status, last_error
           FROM sport_center.payment_accounting_outbox
          WHERE payment_id = $1 AND event_type = 'payment_confirmed'`,
        [fixture.paymentId],
      );
      throw new Error(
        `CF_SC_10B_PROCESSOR_FAILED: posted=${processor.posted}, retried=${processor.retried}, ` +
        `manualReview=${processor.manualReview}, detail=${JSON.stringify(failure.rows[0] ?? null)}`,
      );
    }
    assert(processor.retried === 0, `processor retried=${processor.retried}`);
    assert(processor.manualReview === 0, `processor manualReview=${processor.manualReview}`);
    const evidence = await verifyFixture(client, fixture.paymentId);

    await client.query("ROLLBACK");
    const after = await snapshot(verifier);
    assert(after.outbox_count === before.outbox_count, "existing outbox count changed");
    assert(after.processing_count === before.processing_count, "existing processing count changed");
    assert(after.outbox_identity === before.outbox_identity, "existing outbox rows changed");
    assert(after.processing_identity === before.processing_identity, "existing processing rows changed");
    await proveRollback(verifier, fixture);

    console.log(JSON.stringify({
      cfSc10b: "PASS",
      environment: "development",
      projectRef: guard.projectRef,
      processor,
      config: {
        projectConfigId: Number(config.config_id),
        paymentConfigId: Number(config.payment_config_id),
        taxRuleId: Number(config.tax_rule_id),
        receivingBank: Number(config.receiving_bank_coa_id),
        revenue: Number(config.revenue_coa_id),
        taxOutput: Number(config.tax_output_coa_id),
        mdrExpense: Number(config.mdr_expense_coa_id),
        mdrRate: Number(config.mdr_rate),
        currency: config.currency_code,
      },
      evidence,
      rollback: "PASS",
      existingOutboxChanged: 0,
      existingProcessingChanged: 0,
      productionWrites: 0,
    }, null, 2));
  } catch (error) {
    await client.query("ROLLBACK").catch(() => {});
    console.error(error instanceof Error ? error.stack : String(error));
    process.exitCode = 1;
  } finally {
    await client.end().catch(() => {});
    await verifier.end().catch(() => {});
  }
}

await main();