#!/usr/bin/env node
/**
 * CF-SC-13B structured parity audit.
 *
 * This command is intentionally READ ONLY. It inspects one already-authenticated
 * target selected by the official secret loader and emits a sanitized JSON
 * report. It never creates schema, changes data, runs processors, or calls APIs.
 *
 * The wrapper scripts/cf-sc-13b-parity.sh loads the canonical DEV and PROD
 * bundles separately and compares the resulting reports.
 */
import fs from "node:fs/promises";
import { createHash } from "node:crypto";
import pg from "pg";
import { DEV_PROJECT_REF, PROD_PROJECT_REF, extractProjectRef } from "./runtime-db-guard.mjs";

const { Client } = pg;
const args = process.argv.slice(2);
const target = args.includes("--prod") ? "production" : "development";
const outputIndex = args.indexOf("--output");
const outputPath = outputIndex >= 0 ? args[outputIndex + 1] : null;
const url = process.env.SUPABASE_DATABASE_URL;
const projectRef = extractProjectRef(url);

if (!url) throw new Error("CF_SC_13B requires the official loader to provide SUPABASE_DATABASE_URL.");
if (target === "production" && projectRef !== PROD_PROJECT_REF) {
  throw new Error(`CF_SC_13B_PROD_TARGET_UNVERIFIED: ${projectRef ?? "unknown"}`);
}
if (target === "development" && projectRef === PROD_PROJECT_REF) {
  throw new Error("CF_SC_13B_DEV_TARGET_UNVERIFIED: development audit points at PROD.");
}

const TARGET_TABLES = [
  ["public", "finance_project_configs"],
  ["public", "finance_project_payment_configs"],
  ["public", "finance_project_tax_mappings"],
  ["public", "finance_project_coa_mappings"],
  ["sport_center", "central_finance_processing"],
];
const REQUIRED_PROVENANCE = ["canonical_key", "source_app", "source_module", "source_table", "source_id"];
const REQUIRED_ROUTINES = [
  "resolve_shared_finance_config",
  "create_payment_accounting_draft",
  "create_payment_settlement_batch",
  "create_settlement_journal_draft",
  "ensure_canonical_bank_mutation_for_settlement",
  "finalize_payment_settlement",
  "project_public_bank_mutation_to_canonical",
];

function classifyColumn(column) {
  if (column === "product_scope" || column === "service_scope") return "CUSTOMER_PORTAL_ONLY";
  if (column === "config_version") return "PROD_ALLOWED_EXTENSION";
  if (column === "comparison_class" || column === "comparison_evidence") return "DEV_FIXTURE_ONLY";
  return "SHARED_FINANCE_REQUIRED";
}

function normalizedDefault(value) {
  return value == null ? null : String(value).replace(/\s+/g, " ").trim();
}

async function query(client, text, values = []) {
  return (await client.query(text, values)).rows;
}

async function audit(client) {
  const identity = (await query(client, `
    SELECT current_database() AS database_name, current_user AS database_user,
           current_setting('server_version') AS server_version
  `))[0] ?? {};

  const columns = await query(client, `
    SELECT table_schema, table_name, column_name, data_type, udt_name,
           is_nullable, column_default, ordinal_position
      FROM information_schema.columns
     WHERE (table_schema, table_name) IN (
       ('public', 'finance_project_configs'),
       ('public', 'finance_project_payment_configs'),
       ('public', 'finance_project_tax_mappings'),
       ('public', 'finance_project_coa_mappings'),
       ('sport_center', 'central_finance_processing')
     )
     ORDER BY table_schema, table_name, ordinal_position
  `);
  const columnRows = columns.map((row) => ({
    table: `${row.table_schema}.${row.table_name}`,
    column: row.column_name,
    type: row.udt_name === "int8" ? "bigint" : row.udt_name === "int4" ? "integer" : row.data_type,
    nullable: row.is_nullable === "YES",
    default: normalizedDefault(row.column_default),
    classification: classifyColumn(row.column_name),
  }));

  const constraints = await query(client, `
    SELECT n.nspname AS schema_name, c.relname AS table_name,
           con.conname AS constraint_name, con.contype AS constraint_type,
           pg_get_constraintdef(con.oid, true) AS definition
      FROM pg_constraint con
      JOIN pg_class c ON c.oid = con.conrelid
      JOIN pg_namespace n ON n.oid = c.relnamespace
     WHERE (n.nspname, c.relname) IN (
       ('public', 'finance_project_configs'),
       ('public', 'finance_project_payment_configs'),
       ('public', 'finance_project_tax_mappings'),
       ('public', 'finance_project_coa_mappings'),
       ('sport_center', 'central_finance_processing'),
       ('sport_center', 'payment_settlement_batches'),
       ('sport_center', 'bank_mutations')
     )
     ORDER BY n.nspname, c.relname, con.conname
  `);
  const indexes = await query(client, `
    SELECT schemaname, tablename, indexname, indexdef
      FROM pg_catalog.pg_indexes
     WHERE (schemaname, tablename) IN (
       ('public', 'finance_project_configs'),
       ('public', 'finance_project_payment_configs'),
       ('public', 'finance_project_tax_mappings'),
       ('public', 'finance_project_coa_mappings'),
       ('sport_center', 'central_finance_processing'),
       ('sport_center', 'payment_settlement_batches'),
       ('sport_center', 'bank_mutations')
     )
     ORDER BY schemaname, tablename, indexname
  `);
  const routines = await query(client, `
    SELECT n.nspname AS schema_name, p.proname AS routine_name,
           p.oid::regprocedure::text AS signature,
           pg_get_functiondef(p.oid) AS definition
      FROM pg_proc p
      JOIN pg_namespace n ON n.oid = p.pronamespace
     WHERE n.nspname = 'sport_center'
       AND p.proname = ANY($1::text[])
     ORDER BY p.proname, p.oid::regprocedure::text
  `, [REQUIRED_ROUTINES]);

  const targetColumns = new Set(columnRows.map((row) => `${row.table}.${row.column}`));
  const requiredColumns = [
    ["public.finance_project_configs", ["project_code", "company_id", "effective_from"]],
    ["public.finance_project_payment_configs", ["finance_project_config_id", "payment_method", "provider_code"]],
    ["public.finance_project_tax_mappings", ["finance_project_config_id", "transaction_type", "tax_rule_id"]],
    ["public.finance_project_coa_mappings", ["finance_project_config_id", "account_role", "coa_id"]],
    ["sport_center.central_finance_processing", ["source_project", "source_payment_id", "event_type", "correlation_id", "status"]],
  ];
  const requiredColumnDrift = requiredColumns.flatMap(([table, names]) =>
    names.filter((name) => !targetColumns.has(`${table}.${name}`)).map((name) => ({ table, column: name })),
  );

  const settlementColumns = new Set((await query(client, `
    SELECT column_name FROM information_schema.columns
     WHERE table_schema='sport_center' AND table_name='payment_settlement_batches'
  `)).map((row) => row.column_name));
  const mutationColumns = new Set((await query(client, `
    SELECT column_name FROM information_schema.columns
     WHERE table_schema='sport_center' AND table_name='bank_mutations'
  `)).map((row) => row.column_name));
  const provenance = Object.fromEntries(REQUIRED_PROVENANCE.map((name) => [name, mutationColumns.has(name)]));

  const canonicalFk = constraints.find((row) =>
    row.table_name === "payment_settlement_batches" &&
    row.constraint_name === "payment_settlement_batches_canonical_bank_mutation_fk");
  const canonicalType = (await query(client, `
    SELECT data_type, udt_name, is_nullable
      FROM information_schema.columns
     WHERE table_schema='sport_center'
       AND table_name='payment_settlement_batches'
       AND column_name='canonical_bank_mutation_id'
  `))[0] ?? null;
  const invalidFkRows = settlementColumns.has("canonical_bank_mutation_id")
    ? await query(client, `
        SELECT b.id, b.canonical_bank_mutation_id
          FROM sport_center.payment_settlement_batches b
          LEFT JOIN sport_center.bank_mutations m ON m.id=b.canonical_bank_mutation_id
         WHERE b.canonical_bank_mutation_id IS NOT NULL AND m.id IS NULL
         ORDER BY b.id
         LIMIT 50
      `)
    : [];

  const dataChecks = {
    processing_rows: Number((await query(client, "SELECT COUNT(*)::int AS count FROM sport_center.central_finance_processing"))[0]?.count ?? 0),
    invalid_processing_states: Number((await query(client, `
      SELECT COUNT(*)::int AS count FROM sport_center.central_finance_processing
       WHERE status NOT IN ('pending','processing','posted','failed','manual_review')
    `))[0]?.count ?? 0),
    duplicate_processing_business_keys: Number((await query(client, `
      SELECT COUNT(*)::int AS count FROM (
        SELECT source_project, source_payment_id, event_type
          FROM sport_center.central_finance_processing
         GROUP BY 1,2,3 HAVING COUNT(*) > 1
      ) x
    `))[0]?.count ?? 0),
    duplicate_processing_correlations: Number((await query(client, `
      SELECT COUNT(*)::int AS count FROM (
        SELECT correlation_id FROM sport_center.central_finance_processing
         GROUP BY 1 HAVING COUNT(*) > 1
      ) x
    `))[0]?.count ?? 0),
  };

  const marker = (await query(client, `
    SELECT stage_name, stage_version, status, last_error
      FROM startup_migration_state
     WHERE stage_name IN ('sport_center', 'sport_center_canonical_finance_config')
     ORDER BY stage_name
  `)).map((row) => ({ ...row, last_error: row.last_error ? String(row.last_error).slice(0, 300) : null }));
  const mode = (await query(client, `
    SELECT COALESCE(current_setting('sport_center.finance_mode', true), 'legacy') AS finance_mode
  `))[0]?.finance_mode ?? "legacy";

  return {
    target,
    project_ref: projectRef,
    database: identity,
    read_only: (await query(client, "SHOW transaction_read_only"))[0]?.transaction_read_only === "on",
    columns: columnRows,
    required_column_drift: requiredColumnDrift,
    constraints,
    indexes,
    routines: routines.map((row) => ({
      signature: row.signature,
      body_sha256: row.definition ? sha256(row.definition) : null,
    })),
    required_routines_present: REQUIRED_ROUTINES.every((name) => routines.some((row) => row.routine_name === name)),
    canonical_settlement_fk: {
      column_exists: Boolean(canonicalType),
      type: canonicalType?.udt_name ?? null,
      nullable: canonicalType?.is_nullable ?? null,
      fk_exists: Boolean(canonicalFk),
      fk_definition: canonicalFk?.definition ?? null,
      invalid_references: invalidFkRows.length,
      invalid_reference_rows: invalidFkRows,
    },
    mutation_provenance: provenance,
    data_checks: dataChecks,
    startup_markers: marker,
    finance_mode: mode,
    classification_rules: {
      product_scope: "CUSTOMER_PORTAL_ONLY unless certified shared consumer exists",
      service_scope: "CUSTOMER_PORTAL_ONLY unless certified shared consumer exists",
      config_version: "PROD_ALLOWED_EXTENSION; never remove without contract proof",
    },
  };
}

function sha256(value) {
  return createHash("sha256").update(value).digest("hex");
}

const client = new Client({ connectionString: url, ssl: { rejectUnauthorized: false }, connectionTimeoutMillis: 8_000 });
try {
  await client.connect();
  await client.query("BEGIN");
  await client.query("SET TRANSACTION READ ONLY");
  const report = await audit(client);
  await client.query("ROLLBACK");
  if (outputPath) await fs.writeFile(outputPath, `${JSON.stringify(report, null, 2)}\n`, "utf8");
  console.log(JSON.stringify(report, null, 2));
} finally {
  await client.end().catch(() => {});
}