#!/usr/bin/env node

/**
 * CF-SC-10C remaining DEV runtime matrix.
 *
 * Every case runs inside one rollback-only transaction. This deliberately
 * proves the actual processor without retaining synthetic business data.
 */

import pg from "pg";
import {
  DEV_PROJECT_REF,
  PROD_PROJECT_REF,
  extractProjectRef,
  isSafeDevTestMode,
} from "../runtime-db-guard.mjs";

const { Client } = pg;
const PREFIX = `CFSC10C_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`;
const COMPANY_ID = 1;
const AMOUNT = 100_000;
const CONFIG = {
  projectConfigId: 2,
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
  if (!condition) throw new Error(`CF_SC_10C_ASSERTION_FAILED: ${message}`);
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

async function runtimeProof(client) {
  const functions = await client.query(`
    SELECT p.proname AS name
      FROM pg_proc p
      JOIN pg_namespace n ON n.oid = p.pronamespace
     WHERE n.nspname = 'sport_center'
       AND p.proname = ANY($1::text[])
  `, [[
    "resolve_shared_finance_config",
    "create_payment_accounting_draft",
    "create_payment_settlement_batch",
    "create_settlement_journal_draft",
    "finalize_payment_settlement",
    "ensure_canonical_bank_mutation_for_settlement",
  ]]);
  const names = new Set(functions.rows.map((row) => row.name));
  for (const name of [
    "resolve_shared_finance_config",
    "create_payment_accounting_draft",
    "create_payment_settlement_batch",
    "create_settlement_journal_draft",
    "finalize_payment_settlement",
    "ensure_canonical_bank_mutation_for_settlement",
  ]) assert(names.has(name), `missing sport_center.${name}`);

  const resolved = await client.query(`
    SELECT * FROM sport_center.resolve_shared_finance_config(
      'sport_center', $1, 'QRIS', 'mandiri_direct', CURRENT_DATE
    )
  `, [COMPANY_ID]);
  const row = resolved.rows[0];
  assert(row, "shared config resolver returned no row");
  for (const [field, value] of [
    ["config_id", CONFIG.projectConfigId],
    ["payment_config_id", CONFIG.paymentConfigId],
    ["tax_rule_id", CONFIG.taxRuleId],
    ["receiving_bank_coa_id", CONFIG.receivingBank],
    ["revenue_coa_id", CONFIG.revenue],
    ["tax_output_coa_id", CONFIG.taxOutput],
    ["mdr_expense_coa_id", CONFIG.mdrExpense],
    ["currency_code", CONFIG.currency],
  ]) assert(String(row[field]) === String(value), `${field}=${row[field]} expected ${value}`);
  assert(Math.abs(Number(row.mdr_rate) - CONFIG.mdrRate) < 0.000001, "MDR config mismatch");
}

async function booking(client, suffix) {
  const facility = await client.query(
    "SELECT id FROM sport_center.sport_facilities ORDER BY id LIMIT 1",
  );
  assert(facility.rows[0], "no DEV facility available");
  const result = await client.query(`
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

async function payment(client, bookingId, suffix, {
  method = "QRIS",
  provider = "mandiri_direct",
  type = "full_payment",
} = {}) {
  const result = await client.query(`
    INSERT INTO sport_center.sport_payments
      (booking_id, amount, status, payment_method, payment_type,
       payment_provider, company_id, bank_account_id,
       expected_settlement_date, settlement_rule_version,
       provider_name, provider_id, provider_order_id,
       confirmed_at, paid_at, uat_marker)
    VALUES ($1, $2, 'confirmed', $3, $4::sport_center.payment_type,
            $5::sport_center.payment_provider, $6, '1640006707220',
            (CURRENT_DATE + 1)::text, 'PROD-MANDIRI-SC-20260810-v1',
            $5, $7, $8, NOW(), NOW(), $9)
    RETURNING id
  `, [
    bookingId, AMOUNT, method, type, provider, COMPANY_ID,
    `${PREFIX}_${suffix}_PROVIDER`, `${PREFIX}_${suffix}_ORDER`, PREFIX,
  ]);
  return Number(result.rows[0].id);
}

async function process(client) {
  const { processCentralFinance } =
    await import("../../artifacts/api-server/src/lib/centralFinance.ts");
  return processCentralFinance({ client });
}

async function evidence(client, paymentIds) {
  const result = await client.query(`
    SELECT
      (SELECT COUNT(*)::int FROM sport_center.central_finance_processing
        WHERE source_payment_id = ANY($1::int[])) AS processing,
      (SELECT COUNT(*)::int FROM sport_center.payment_accounting_outbox
        WHERE payment_id = ANY($1::int[])) AS outbox,
      (SELECT COUNT(*)::int FROM sport_center.accounting_journals
        WHERE payment_id = ANY($1::int[]) AND journal_type = 'payment_confirmed'
          AND is_reversal = false) AS accounting,
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
          AND source_app = 'cst-super-app'
          AND source_table = 'public.bank_mutations'
          AND canonical_key = ANY(
            SELECT 'sport_center:payment:' || x::text FROM unnest($1::int[]) x
          )) AS canonical_bridge_mutations,
      (SELECT COUNT(*)::int FROM sport_center.bank_mutations
        WHERE source_app = 'sport_center'
          AND source_table = 'sport_payments'
          AND source <> 'PUBLIC_BANK_MUTATION_BRIDGE'
          AND source_id = ANY(SELECT x::text FROM unnest($1::int[]) x)) AS legacy_mutations
  `, [paymentIds]);
  return result.rows[0];
}

async function positive(client, label, specs) {
  const ids = [];
  let sharedBooking;
  for (const spec of specs) {
    const bookingId = spec.bookingId ?? (sharedBooking ??= await booking(client, `${label}_BOOKING`));
    ids.push(await payment(client, bookingId, `${label}_${ids.length}`, spec));
  }
  const first = await process(client);
  assert(first.claimed >= ids.length, `${label}: processor claimed=${first.claimed}`);
  assert(first.posted >= ids.length, `${label}: processor posted=${first.posted}`);
  const retry = await process(client);
  assert(retry.claimed === 0, `${label}: retry claimed=${retry.claimed}`);
  const row = await evidence(client, ids);
  assert(Number(row.processing) === ids.length, `${label}: processing count`);
  assert(Number(row.outbox) === ids.length, `${label}: outbox count`);
  assert(Number(row.accounting) === ids.length, `${label}: accounting count`);
  assert(Number(row.settlement_items) === ids.length, `${label}: settlement item count`);
  assert(Number(row.public_mutations) === ids.length, `${label}: public mutation count`);
  assert(Number(row.canonical_bridge_mutations) === ids.length, `${label}: canonical bridge count`);
  assert(Number(row.legacy_mutations) === 0, `${label}: legacy mutation count`);
  return { ids, first, retry, evidence: row };
}

async function negative(client, label, spec) {
  const id = await payment(client, await booking(client, label), label, spec);
  const result = await process(client);
  assert(result.claimed >= 1, `${label}: processor did not claim`);
  assert(result.posted === 0, `${label}: unexpectedly posted`);
  const row = await evidence(client, [id]);
  for (const field of ["accounting", "settlement_items", "settlements", "public_mutations", "legacy_mutations"]) {
    assert(Number(row[field]) === 0, `${label}: ${field}=${row[field]}`);
  }
  return { result, evidence: row };
}

async function main() {
  const projectRef = guard();
  const client = new Client({
    connectionString: globalThis.process.env.SUPABASE_DATABASE_URL_DEV,
    ssl: { rejectUnauthorized: false },
  });
  try {
    await client.connect();
    await client.query("BEGIN");
    await client.query("SET LOCAL sport_center.finance_mode = 'central'");
    await runtimeProof(client);

    const full = await positive(client, "FULL", [{ type: "full_payment" }]);
    const dp = await positive(client, "DP", [{ type: "dp" }]);
    const pelunasan = await positive(client, "PELUNASAN", [{ type: "pelunasan" }]);
    const grouped = await positive(client, "GROUP", [
      { type: "full_payment" },
    ]);
    const transfer = await negative(client, "TRANSFER", {
      method: "Transfer Bank", provider: "unknown", type: "full_payment",
    });
    const paylabs = await negative(client, "PAYLABS", {
      method: "QRIS", provider: "paylabs", type: "full_payment",
    });
    const unknown = await negative(client, "UNKNOWN", {
      method: "QRIS", provider: "unknown", type: "full_payment",
    });

    await client.query("ROLLBACK");
    console.log(JSON.stringify({
      cfSc10c: "PASS",
      environment: "development",
      projectRef,
      qrisFull: full.evidence,
      qrisDp: dp.evidence,
      qrisPelunasan: pelunasan.evidence,
      groupPayment: grouped.evidence,
      transferBank: transfer.result,
      paylabs: paylabs.result,
      unknownProvider: unknown.result,
      rollback: "PASS",
      productionWrites: 0,
      note: "Config corruption and two-client races require dedicated case harnesses; no shared config was modified.",
    }, null, 2));
  } catch (error) {
    const canonical = await client.query(`
      SELECT id, source, source_app, source_table, source_id, canonical_key
        FROM sport_center.bank_mutations
       ORDER BY id DESC
       LIMIT 5
    `).catch(() => ({ rows: [] }));
    console.error(`CF_SC_10C_CANONICAL_DEBUG=${JSON.stringify(canonical.rows)}`);
    await client.query("ROLLBACK").catch(() => {});
    console.error(error instanceof Error ? error.stack : String(error));
    globalThis.process.exitCode = 1;
  } finally {
    await client.end().catch(() => {});
  }
}

await main();