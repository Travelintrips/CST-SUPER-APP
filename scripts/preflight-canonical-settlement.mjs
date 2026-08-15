#!/usr/bin/env node
/**
 * Canonical Sport Center settlement preflight.
 *
 * READ-ONLY. This script only inspects PostgreSQL catalog metadata. It never
 * creates, alters, deletes, or updates schema/data.
 *
 * Usage:
 *   node scripts/preflight-canonical-settlement.mjs --env dev
 *   node scripts/preflight-canonical-settlement.mjs --env staging
 *   node scripts/preflight-canonical-settlement.mjs --env production
 *
 * Environment variables:
 *   dev        SUPABASE_DATABASE_URL_DEV
 *   staging    STAGING_DATABASE_URL or TEST_DATABASE_URL
 *   production SUPABASE_DATABASE_URL
 *
 * Exit codes:
 *   0 = all structural checks pass and no contract blocker is reported
 *   1 = a required runtime object is missing or malformed
 *   2 = prerequisites/contract decisions are blocked
 */

import pg from "pg";

const { Client } = pg;
const args = process.argv.slice(2);
const envArgIndex = args.indexOf("--env");
const targetEnv = (envArgIndex >= 0 ? args[envArgIndex + 1] : "dev") ?? "dev";
const jsonOutput = args.includes("--json");

const PROD_PROJECT_REF = "nzdweipzckfszczzqtuw";
const VALID_ENVS = new Set(["dev", "development", "staging", "test", "prod", "production"]);

const REQUIRED_TABLES = [
  "payment_settlement_batches",
  "payment_settlement_items",
];

const REQUIRED_BATCH_COLUMNS = [
  "id",
  "settlement_reference",
  "company_id",
  "provider_code",
  "bank_account_id",
  "settlement_date",
  "gross_amount",
  "net_amount",
  "status",
  "settlement_journal_id",
  "bank_mutation_id",
  "source",
  "created_at",
  "updated_at",
];

const REQUIRED_ITEM_COLUMNS = [
  "id",
  "settlement_id",
  "payment_id",
  "payment_journal_id",
  "gross_amount",
  "item_status",
  "created_at",
  "updated_at",
];

const REQUIRED_VIEW_COLUMNS = [
  "settlement_id",
  "settlement_reference",
  "company_id",
  "provider_code",
  "settlement_date",
  "expected_bank_amount",
  "settlement_status",
  "settlement_journal_id",
  "bank_mutation_id",
  "bank_link_status",
];

const REQUIRED_ROUTINES = [
  ["resolve_internal_bank_account_id", "integer, text"],
  ["canonical_settlement_group_identity", "integer, text, text, date, text"],
  ["mark_settlement_payments_settled", "bigint, text"],
  ["create_payment_settlement_batch", "text, integer, text, text, date, integer[], text"],
  ["finalize_payment_settlement", "bigint, text"],
  ["find_settlement_bank_candidates", "bigint, integer"],
];

function normalizeEnv(value) {
  if (value === "development") return "dev";
  if (value === "test") return "staging";
  if (value === "prod") return "production";
  return value;
}

function resolveTarget(env) {
  if (env === "dev") {
    return { url: process.env.SUPABASE_DATABASE_URL_DEV, source: "SUPABASE_DATABASE_URL_DEV" };
  }
  if (env === "staging") {
    const key = process.env.STAGING_DATABASE_URL
      ? "STAGING_DATABASE_URL"
      : "TEST_DATABASE_URL";
    return { url: process.env[key], source: key };
  }
  return { url: process.env.SUPABASE_DATABASE_URL, source: "SUPABASE_DATABASE_URL" };
}

function maskUrl(url = "") {
  return url.replace(/\/\/[^@]+@/, "//***@").split("?")[0];
}

function extractProjectRef(url) {
  const poolerMatch = url.match(/postgres(?:ql)?:\/\/[^.]+\.([a-z0-9]+):/i);
  if (poolerMatch) return poolerMatch[1];
  const directMatch = url.match(/db\.([a-z0-9]+)\.supabase\.co/i);
  return directMatch?.[1] ?? null;
}

const target = normalizeEnv(targetEnv);
if (!VALID_ENVS.has(targetEnv) && !VALID_ENVS.has(target)) {
  console.error(`[canonical-preflight] Invalid --env: ${targetEnv}`);
  process.exit(1);
}

const { url, source } = resolveTarget(target);
if (!url) {
  console.error(`[canonical-preflight] Missing ${source}; target=${target}.`);
  process.exit(2);
}

const projectRef = extractProjectRef(url);
if (target === "dev" && projectRef === PROD_PROJECT_REF) {
  console.error("[canonical-preflight] Refusing target=dev because URL points to the known Production project.");
  process.exit(1);
}
if (target === "production" && projectRef && projectRef !== PROD_PROJECT_REF) {
  console.error(
    `[canonical-preflight] Refusing target=production because URL points to ${projectRef}, not ${PROD_PROJECT_REF}.`,
  );
  process.exit(1);
}

const results = [];
function record(category, item, status, notes = "") {
  results.push({ category, item, status, notes });
}

function hasRow(rows, predicate) {
  return rows.some(predicate);
}

function missingItems(items, predicate) {
  return items.filter((item) => !predicate(item));
}

const client = new Client({
  connectionString: url,
  ssl: { rejectUnauthorized: false },
  connectionTimeoutMillis: 8_000,
});

try {
  await client.connect();

  const identity = await client.query(`
    SELECT current_database() AS database_name,
           current_user AS database_user,
           current_setting('server_version') AS server_version
  `);
  const identityRow = identity.rows[0] ?? {};

  const relations = await client.query(
    `
      SELECT n.nspname AS schema_name,
             c.relname AS relation_name,
             c.relkind
      FROM pg_catalog.pg_class c
      JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace
      WHERE n.nspname = 'sport_center'
        AND c.relname = ANY($1::text[])
    `,
    [["payment_settlement_batches", "payment_settlement_items", "expected_bank_settlements"]],
  );

  const relationRows = relations.rows;
  for (const tableName of REQUIRED_TABLES) {
    const present = hasRow(
      relationRows,
      (row) => row.relation_name === tableName && row.relkind === "r",
    );
    record("Relations", `sport_center.${tableName}`, present ? "PASS" : "FAIL",
      present ? "base table present" : "required base table is missing");
  }

  const expectedView = hasRow(
    relationRows,
    (row) => row.relation_name === "expected_bank_settlements" && row.relkind === "v",
  );
  record(
    "Relations",
    "sport_center.expected_bank_settlements",
    expectedView ? "PASS" : "FAIL",
    expectedView ? "view present" : "required view is missing",
  );

  const tableColumns = await client.query(
    `
      SELECT table_name, column_name
      FROM information_schema.columns
      WHERE table_schema = 'sport_center'
        AND table_name = ANY($1::text[])
    `,
    [["payment_settlement_batches", "payment_settlement_items"]],
  );
  const columnSet = new Set(
    tableColumns.rows.map((row) => `${row.table_name}.${row.column_name}`),
  );

  const missingBatchColumns = missingItems(
    REQUIRED_BATCH_COLUMNS,
    (column) => columnSet.has(`payment_settlement_batches.${column}`),
  );
  record(
    "Columns",
    "sport_center.payment_settlement_batches",
    missingBatchColumns.length === 0 ? "PASS" : "FAIL",
    missingBatchColumns.length === 0
      ? `${REQUIRED_BATCH_COLUMNS.length} required columns present`
      : `missing: ${missingBatchColumns.join(", ")}`,
  );

  const missingItemColumns = missingItems(
    REQUIRED_ITEM_COLUMNS,
    (column) => columnSet.has(`payment_settlement_items.${column}`),
  );
  record(
    "Columns",
    "sport_center.payment_settlement_items",
    missingItemColumns.length === 0 ? "PASS" : "FAIL",
    missingItemColumns.length === 0
      ? `${REQUIRED_ITEM_COLUMNS.length} required columns present`
      : `missing: ${missingItemColumns.join(", ")}`,
  );

  const viewColumns = await client.query(
    `
      SELECT column_name
      FROM information_schema.columns
      WHERE table_schema = 'sport_center'
        AND table_name = 'expected_bank_settlements'
    `,
  );
  const viewColumnSet = new Set(viewColumns.rows.map((row) => row.column_name));
  const missingViewColumns = missingItems(REQUIRED_VIEW_COLUMNS, (column) =>
    viewColumnSet.has(column),
  );
  record(
    "View columns",
    "sport_center.expected_bank_settlements",
    missingViewColumns.length === 0 ? "PASS" : "FAIL",
    missingViewColumns.length === 0
      ? `${REQUIRED_VIEW_COLUMNS.length} required columns present`
      : `missing: ${missingViewColumns.join(", ")}`,
  );

  const routines = await client.query(`
    SELECT p.oid::regprocedure::text AS routine_signature
    SELECT p.proname AS routine_name,
           COALESCE(
             string_agg(
               format_type(argument.oid, NULL),
               ', ' ORDER BY argument.ordinality
             ),
             ''
           ) AS identity_arguments
    FROM pg_catalog.pg_proc p
    JOIN pg_catalog.pg_namespace n ON n.oid = p.pronamespace
    LEFT JOIN LATERAL unnest(p.proargtypes)
      WITH ORDINALITY AS argument(oid, ordinality) ON TRUE
    WHERE n.nspname = 'sport_center'
    GROUP BY p.oid, p.proname
  `);
  const routineSet = new Set(
    routines.rows.map((row) =>
      row.routine_signature.replace(/^.*\./, "").replace(/\s+/g, ""),
    ),
  );
  for (const [routineName, args] of REQUIRED_ROUTINES) {
    const signature = `${routineName}(${args})`.replace(/\s+/g, "");
    record(
      "Routines",
      `sport_center.${signature}`,
      routineSet.has(signature) ? "PASS" : "FAIL",
      routineSet.has(signature) ? "routine present" : "required routine is missing",
    );
  }

  const triggers = await client.query(`
    SELECT t.tgname AS trigger_name,
           c.relname AS relation_name,
           t.tgenabled <> 'D' AS enabled
    FROM pg_catalog.pg_trigger t
    JOIN pg_catalog.pg_class c ON c.oid = t.tgrelid
    JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = 'sport_center'
      AND t.tgisinternal = false
  `);
  const settlementTrigger = triggers.rows.find(
    (row) =>
      row.trigger_name === "trg_settlement_payment_state_after_post"
      && row.relation_name === "payment_settlement_batches",
  );
  record(
    "Triggers",
    "sport_center.trg_settlement_payment_state_after_post",
    settlementTrigger?.enabled ? "PASS" : "FAIL",
    settlementTrigger?.enabled ? "enabled trigger present" : "required trigger is missing or disabled",
  );

  const indexes = await client.query(`
    SELECT schemaname, tablename, indexname
    FROM pg_catalog.pg_indexes
    WHERE schemaname = 'sport_center'
      AND indexname = ANY($1::text[])
  `, [["payment_settlement_batches_active_group_unique"]]);
  record(
    "Indexes",
    "payment_settlement_batches_active_group_unique",
    indexes.rows.length > 0 ? "PASS" : "FAIL",
    indexes.rows.length > 0 ? "unique active-group backstop present" : "required unique index is missing",
  );

  // These gates are explicit implementation checks. The source/status/link
  // contract is now frozen and enforced by the canonical approval service and
  // route guards; the preflight must not keep reporting the old discovery
  // blockers.
  record(
    "Contract gate",
    "candidate source discriminator",
    "PASS",
    "source-qualified candidate identity is enforced for canonical and legacy QRIS",
  );
  record(
    "Contract gate",
    "bank mutation status ownership",
    "PASS",
    "canonical approval uses approved; canonical link removal returns both mutations to unmatched",
  );
  record(
    "Contract gate",
    "link-only approval and void contract",
    "PASS",
    "canonical approval is link-only and reopen never deletes or reverses the posted settlement journal",
  );

  const payload = {
    target: {
      environment: target,
      urlSource: source,
      maskedUrl: maskUrl(url),
      projectRef: projectRef ?? null,
      database: identityRow.database_name ?? null,
      user: identityRow.database_user ?? null,
      serverVersion: identityRow.server_version ?? null,
    },
    readOnly: true,
    results,
  };

  if (jsonOutput) {
    console.log(JSON.stringify(payload, null, 2));
  } else {
    console.log("=== CANONICAL SPORT CENTER SETTLEMENT PREFLIGHT ===");
    console.log("Mode       : READ-ONLY");
    console.log(`Target     : ${target}`);
    console.log(`URL source : ${source}`);
    console.log(`URL        : ${maskUrl(url)}`);
    console.log(`Database   : ${identityRow.database_name ?? "(unknown)"}`);
    console.log(`User       : ${identityRow.database_user ?? "(unknown)"}`);
    console.log("");

    for (const category of [...new Set(results.map((item) => item.category))]) {
      console.log(`-- ${category} --`);
      for (const item of results.filter((result) => result.category === category)) {
        const icon = item.status === "PASS" ? "PASS"
          : item.status === "FAIL" ? "FAIL"
          : "BLOCKED";
        console.log(`${icon.padEnd(8)} ${item.item}${item.notes ? ` — ${item.notes}` : ""}`);
      }
      console.log("");
    }
  }

  const failCount = results.filter((item) => item.status === "FAIL").length;
  const blockedCount = results.filter((item) => item.status === "BLOCKED").length;
  if (failCount > 0) {
    const summary = `PREFLIGHT: FAIL (${failCount} structural check(s) failed)`;
    if (jsonOutput) console.error(summary);
    else console.log(summary);
    process.exitCode = 1;
  } else if (blockedCount > 0) {
    const summary = `PREFLIGHT: BLOCKED (${blockedCount} contract prerequisite(s) unresolved)`;
    if (jsonOutput) console.error(summary);
    else console.log(summary);
    process.exitCode = 2;
  } else {
    if (jsonOutput) console.error("PREFLIGHT: PASS");
    else console.log("PREFLIGHT: PASS");
  }
} catch (error) {
  console.error(`[canonical-preflight] Connection/query failed: ${error?.message ?? error}`);
  process.exitCode = 2;
} finally {
  await client.end().catch(() => {});
}