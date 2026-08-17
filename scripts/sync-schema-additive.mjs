#!/usr/bin/env node
/**
 * Additive Dev -> Prod schema reconciliation for the Supabase runtime DB.
 *
 * This intentionally never drops, replaces, disables, or alters an existing
 * production object. It creates missing tables, columns, enums, constraints,
 * indexes, functions, triggers, views, policies, and additive RLS settings.
 *
 * Usage:
 *   node scripts/sync-schema-additive.mjs              # report only
 *   node scripts/sync-schema-additive.mjs --apply      # apply additive diff
 *   node scripts/sync-schema-additive.mjs --apply-safe # apply safe additive diff; skip PROMOTE_REQUIRED
 *   node scripts/sync-schema-additive.mjs --write-review /tmp/review.json
 *
 * The two connection URLs must be supplied by the official secret loader:
 *   SUPABASE_DATABASE_URL_DEV
 *   SUPABASE_DATABASE_URL
 */

import pg from "pg";
import fs from "node:fs/promises";

const { Client } = pg;
const args = process.argv.slice(2);
const safeApplyMode = args.includes("--apply-safe");
const applyMode = args.includes("--apply") || safeApplyMode;

function flagValue(flag) {
  const index = args.indexOf(flag);
  return index >= 0 ? args[index + 1] : undefined;
}

const snapshotWritePath = flagValue("--write-dev-snapshot");
const snapshotReadPath = flagValue("--from-dev-snapshot");
const reviewWritePath = flagValue("--write-review");
const directMode = !snapshotWritePath && !snapshotReadPath;
const DEV_URL = directMode ? process.env.SUPABASE_DATABASE_URL_DEV : null;
const PROD_URL = directMode
  ? process.env.SUPABASE_DATABASE_URL
  : process.env.SUPABASE_DATABASE_URL;

if (snapshotWritePath && snapshotReadPath) {
  throw new Error("Snapshot write and snapshot read modes cannot be combined.");
}
if (directMode && (!DEV_URL || !PROD_URL)) {
  throw new Error(
    "Direct mode requires both SUPABASE_DATABASE_URL_DEV and SUPABASE_DATABASE_URL. " +
      "Use scripts/run-sync-schema-additive.mjs with the official loader for separate environment bundles.",
  );
}
if (snapshotWritePath && (!PROD_URL || process.env.APP_ENV !== "development")) {
  throw new Error(
    "--write-dev-snapshot requires APP_ENV=development and the canonical development database URL.",
  );
}
if (snapshotReadPath && (!PROD_URL || process.env.APP_ENV !== "production")) {
  throw new Error(
    "--from-dev-snapshot requires APP_ENV=production and the canonical production database URL.",
  );
}
if (applyMode && process.env.APP_ENV !== "production") {
  throw new Error("Schema apply is only allowed with APP_ENV=production.");
}
if (directMode && DEV_URL === PROD_URL) {
  throw new Error("Development and production URLs are identical; aborting.");
}

const IDENTIFIER = /^[a-zA-Z_][a-zA-Z0-9_$]*$/;
const PROMOTED_SCHEMAS = new Set(["public", "sport_center"]);
const EXCLUDED_TABLE_NAME = /(^|_)(ai|menu|uat)(_|$)/i;
const ALLOWED_ACTIONS = new Set([
  "tables",
  "columns",
  "enums",
  "constraints",
  "indexes",
  "functions",
  "triggers",
  "views",
  "policies",
  "rls",
]);
const REVIEW_DECISIONS = Object.freeze({
  DEV_ONLY: "DEV_ONLY",
  PROMOTE_REQUIRED: "PROMOTE_REQUIRED",
  PROMOTE_ADDITIVE: "PROMOTE_ADDITIVE",
  PRESERVE_PROD: "PRESERVE_PROD_UNCHANGED",
});

function quoteIdent(value) {
  if (!IDENTIFIER.test(value)) {
    return `"${String(value).replaceAll('"', '""')}"`;
  }
  return `"${value}"`;
}

function qualified(schema, name) {
  return `${quoteIdent(schema)}.${quoteIdent(name)}`;
}

function quoteLiteral(value) {
  return `'${String(value).replaceAll("'", "''")}'`;
}

function maskUrl(url = "") {
  return url.replace(/\/\/[^@]+@/, "//***@").split("?")[0];
}

const QUERY = {
  relations: `
    SELECT
      n.nspname AS schema_name,
      c.relname AS name,
      c.relkind
    FROM pg_class c
    JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname NOT LIKE 'pg_%'
      AND n.nspname <> 'information_schema'
    ORDER BY 1, 2
  `,
  tables: `
    SELECT
      n.nspname AS schema_name,
      c.relname AS table_name,
      c.relkind
    FROM pg_class c
    JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE c.relkind IN ('r', 'p')
      AND n.nspname NOT LIKE 'pg_%'
      AND n.nspname <> 'information_schema'
    ORDER BY 1, 2
  `,
  columns: `
    SELECT
      c.table_schema AS schema_name,
      c.table_name,
      c.column_name,
      c.column_default,
      c.is_nullable,
      c.is_generated,
      c.is_identity,
      c.identity_generation,
      format_type(a.atttypid, a.atttypmod) AS formatted_type,
      COALESCE(element_type.typname, column_type.typname) AS udt_name,
      COALESCE(element_schema.nspname, type_schema.nspname) AS udt_schema
    FROM information_schema.columns c
    JOIN pg_namespace n ON n.nspname = c.table_schema
    JOIN pg_class t ON t.relnamespace = n.oid AND t.relname = c.table_name
    JOIN pg_attribute a ON a.attrelid = t.oid AND a.attname = c.column_name
    JOIN pg_type column_type ON column_type.oid = a.atttypid
    JOIN pg_namespace type_schema ON type_schema.oid = column_type.typnamespace
    LEFT JOIN pg_type element_type ON element_type.oid = column_type.typelem
    LEFT JOIN pg_namespace element_schema ON element_schema.oid = element_type.typnamespace
    WHERE c.table_schema NOT IN ('pg_catalog', 'information_schema')
    ORDER BY 1, 2, a.attnum
  `,
  constraints: `
    SELECT
      n.nspname AS schema_name,
      c.relname AS table_name,
      con.conname AS name,
      con.contype,
      con.convalidated,
      pg_get_constraintdef(con.oid, true) AS definition
    FROM pg_constraint con
    JOIN pg_class c ON c.oid = con.conrelid
    JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE c.relkind IN ('r', 'p')
      AND n.nspname NOT LIKE 'pg_%'
      AND n.nspname <> 'information_schema'
    ORDER BY 1, 2, 3
  `,
  indexes: `
    SELECT
      n.nspname AS schema_name,
      t.relname AS table_name,
      i.relname AS name,
      ix.indisunique AS is_unique,
      ix.indisprimary AS is_primary,
      ix.indisvalid AS is_valid,
      pg_get_indexdef(ix.indexrelid) AS definition
    FROM pg_class t
    JOIN pg_namespace n ON n.oid = t.relnamespace
    JOIN pg_index ix ON ix.indrelid = t.oid
    JOIN pg_class i ON i.oid = ix.indexrelid
    WHERE n.nspname NOT LIKE 'pg_%'
      AND n.nspname <> 'information_schema'
    ORDER BY 1, 2, 3
  `,
  functions: `
    SELECT
      n.nspname AS schema_name,
      p.proname AS name,
      pg_get_function_identity_arguments(p.oid) AS args,
      pg_get_functiondef(p.oid) AS definition
    FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname NOT LIKE 'pg_%'
      AND n.nspname <> 'information_schema'
    ORDER BY 1, 2, 3
  `,
  triggers: `
    SELECT
      n.nspname AS schema_name,
      c.relname AS table_name,
      t.tgname AS name,
      pg_get_triggerdef(t.oid) AS definition
    FROM pg_trigger t
    JOIN pg_class c ON c.oid = t.tgrelid
    JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE NOT t.tgisinternal
      AND n.nspname NOT LIKE 'pg_%'
      AND n.nspname <> 'information_schema'
    ORDER BY 1, 2, 3
  `,
  views: `
    SELECT
      n.nspname AS schema_name,
      c.relname AS name,
      c.relkind,
      pg_get_viewdef(c.oid, true) AS definition
    FROM pg_class c
    JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE c.relkind = 'v'
      AND n.nspname NOT LIKE 'pg_%'
      AND n.nspname <> 'information_schema'
    ORDER BY 1, 2
  `,
  enums: `
    SELECT
      n.nspname AS schema_name,
      t.typname AS name,
      e.enumlabel,
      e.enumsortorder
    FROM pg_type t
    JOIN pg_namespace n ON n.oid = t.typnamespace
    JOIN pg_enum e ON e.enumtypid = t.oid
    WHERE n.nspname NOT LIKE 'pg_%'
      AND n.nspname <> 'information_schema'
    ORDER BY 1, 2, 4
  `,
  policies: `
    SELECT
      schemaname AS schema_name,
      tablename AS table_name,
      policyname AS name,
      permissive,
      roles,
      cmd,
      qual,
      with_check
    FROM pg_policies
    WHERE schemaname NOT LIKE 'pg_%'
    ORDER BY 1, 2, 3
  `,
  rls: `
    SELECT
      n.nspname AS schema_name,
      c.relname AS table_name,
      c.relrowsecurity AS rls_enabled,
      c.relforcerowsecurity AS rls_forced
    FROM pg_class c
    JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE c.relkind IN ('r', 'p')
      AND n.nspname NOT LIKE 'pg_%'
      AND n.nspname <> 'information_schema'
    ORDER BY 1, 2
  `,
};

async function connect(url) {
  const client = new Client({
    connectionString: url,
    ssl: { rejectUnauthorized: false },
    options: "-c lock_timeout=5000 -c statement_timeout=120000",
  });
  await client.connect();
  return client;
}

async function collect(client) {
  const result = {};
  for (const [name, sql] of Object.entries(QUERY)) {
    result[name] = (await client.query(sql)).rows;
  }
  return result;
}

function columnKey(row) {
  return `${row.schema_name}.${row.table_name}.${row.column_name}`;
}

function tableKey(row) {
  return `${row.schema_name}.${row.table_name}`;
}

function functionKey(row) {
  return `${row.schema_name}.${row.name}(${row.args})`;
}

function triggerKey(row) {
  return `${row.schema_name}.${row.table_name}.${row.name}`;
}

function viewKey(row) {
  return `${row.schema_name}.${row.name}`;
}

function enumKey(row) {
  return `${row.schema_name}.${row.name}`;
}

function policyKey(row) {
  return `${row.schema_name}.${row.table_name}.${row.name}`;
}

function constraintKey(row) {
  return `${row.schema_name}.${row.table_name}.${row.name}`;
}

function indexKey(row) {
  return `${row.schema_name}.${row.table_name}.${row.name}`;
}

function diffRows(devRows, prodRows, keyFn) {
  const devMap = new Map(devRows.map((row) => [keyFn(row), row]));
  const prodMap = new Map(prodRows.map((row) => [keyFn(row), row]));
  return {
    devMap,
    prodMap,
    missing: [...devMap.keys()].filter((key) => !prodMap.has(key)),
  };
}

function sequenceNameFromDefault(columnDefault) {
  const match = String(columnDefault ?? "").match(
    /nextval\('((?:[^']|'')+)'(?:::regclass)?\)/i,
  );
  return match?.[1]?.replaceAll("''", "'") ?? null;
}

function parseQualifiedName(value) {
  const parts = String(value).split(".");
  if (parts.length === 2) return parts;
  return ["public", parts.at(-1)];
}

function policySql(row) {
  const roles = Array.isArray(row.roles)
    ? row.roles
        .map((role) => (role === "public" ? "PUBLIC" : quoteIdent(role)))
        .join(", ")
    : "public";
  const parts = [
    `CREATE POLICY ${quoteIdent(row.name)} ON ${qualified(row.schema_name, row.table_name)}`,
    `AS ${row.permissive === "PERMISSIVE" ? "PERMISSIVE" : "RESTRICTIVE"}`,
    `FOR ${row.cmd}`,
    `TO ${roles}`,
  ];
  if (row.qual) parts.push(`USING (${row.qual})`);
  if (row.with_check) parts.push(`WITH CHECK (${row.with_check})`);
  return `${parts.join(" ")};`;
}

function constraintSql(row, existingIndex, productionRelationKeys) {
  const notValid =
    row.convalidated === false && ["c", "f"].includes(row.contype)
      ? " NOT VALID"
      : "";
  if (
    existingIndex?.is_unique &&
    ["p", "u"].includes(row.contype) &&
    ["PRIMARY KEY", "UNIQUE"].some((kind) =>
      row.definition.startsWith(kind),
    )
  ) {
    const kind = row.contype === "p" ? "PRIMARY KEY" : "UNIQUE";
    return (
      `ALTER TABLE ${qualified(row.schema_name, row.table_name)} ` +
      `ADD CONSTRAINT ${quoteIdent(row.name)} ${kind} USING INDEX ` +
      `${quoteIdent(existingIndex.name)};`
    );
  }
  if (
    ["p", "u"].includes(row.contype) &&
    row.definition.match(/^(PRIMARY KEY|UNIQUE)\s+(.+)$/i)
  ) {
    const [, kind, indexBody] = row.definition.match(
      /^(PRIMARY KEY|UNIQUE)\s+(.+)$/i,
    );
    const auxiliaryIndex = `schema_sync_${stableHash(
      `${row.schema_name}.${row.table_name}.${row.name}`,
    )}`;
    const relationCollision =
      productionRelationKeys.has(`${row.schema_name}.${row.name}`) &&
      !existingIndex;
    const constraintName = relationCollision
      ? `schema_sync_constraint_${stableHash(
          `${row.schema_name}.${row.table_name}.${row.name}`,
        )}`
      : row.name;
    return (
      `CREATE UNIQUE INDEX IF NOT EXISTS ${quoteIdent(auxiliaryIndex)} ` +
      `ON ${qualified(row.schema_name, row.table_name)} ${indexBody}; ` +
      `ALTER TABLE ${qualified(row.schema_name, row.table_name)} ` +
      `ADD CONSTRAINT ${quoteIdent(constraintName)} ${kind.toUpperCase()} USING INDEX ` +
      `${quoteIdent(auxiliaryIndex)};`
    );
  }
  return (
    `ALTER TABLE ${qualified(row.schema_name, row.table_name)} ` +
    `ADD CONSTRAINT ${quoteIdent(row.name)} ${row.definition}${notValid};`
  );
}

function stableHash(value) {
  let hash = 2166136261;
  for (const char of String(value)) {
    hash ^= char.codePointAt(0);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(36);
}

function normalizeSql(value) {
  return String(value ?? "")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();
}

function equivalentConstraint(row, productionConstraints) {
  return productionConstraints.find((candidate) => {
    if (
      candidate.schema_name !== row.schema_name ||
      candidate.table_name !== row.table_name ||
      candidate.contype !== row.contype
    ) {
      return false;
    }
    // A table can only have one primary key. For additive reconciliation,
    // an existing primary key is already the required invariant even if its
    // generated/name differs between environments.
    if (row.contype === "p") return true;
    return normalizeSql(candidate.definition) === normalizeSql(row.definition);
  });
}

function normalizeIndexDefinition(value) {
  return normalizeSql(value).replace(
    /^create (unique )?index [^ ]+ on /,
    "create $1index on ",
  );
}

function equivalentIndex(row, productionIndexes) {
  return productionIndexes.find(
    (candidate) =>
      candidate.schema_name === row.schema_name &&
      candidate.table_name === row.table_name &&
      normalizeIndexDefinition(candidate.definition) ===
        normalizeIndexDefinition(row.definition),
  );
}

function indexSql(row, alternateName) {
  const match = String(row.definition).match(
    /^(CREATE (?:UNIQUE )?INDEX )(.+?)( ON .+)$/i,
  );
  if (!match) return `${row.definition};`;
  const indexName = alternateName ? quoteIdent(alternateName) : match[2];
  return `${match[1]}IF NOT EXISTS ${indexName}${match[3]};`;
}

function isSafeDefault(columnDefault) {
  const value = String(columnDefault ?? "").trim();
  return (
    /^(now\(\)|CURRENT_TIMESTAMP|CURRENT_DATE|gen_random_uuid\(\)|uuid_generate_v4\(\)|[-+]?\d+(?:\.\d+)?|'.*')(?:::[a-zA-Z0-9_." ]+)?$/i.test(
      value,
    ) || Boolean(sequenceNameFromDefault(value))
  );
}

function columnDefinition(row, { preserveNotNull = true } = {}) {
  const identity =
    row.is_identity === "YES"
      ? ` GENERATED ${row.identity_generation === "ALWAYS" ? "ALWAYS" : "BY DEFAULT"} AS IDENTITY`
      : "";
  const nullable =
    preserveNotNull && row.is_nullable === "NO" && !identity ? " NOT NULL" : "";
  const defaultSql =
    !identity && isSafeDefault(row.column_default)
      ? ` DEFAULT ${row.column_default}`
      : "";
  return `${quoteIdent(row.column_name)} ${row.formatted_type}${identity}${defaultSql}${nullable}`;
}

function tableSql(row, columns) {
  const defs = columns
    .filter(
      (column) =>
        column.schema_name === row.schema_name &&
        column.table_name === row.table_name,
    )
    .map((column) => `  ${columnDefinition(column)}`);
  return (
    `CREATE TABLE IF NOT EXISTS ${qualified(row.schema_name, row.table_name)} (\n` +
    `${defs.join(",\n")}\n);`
  );
}

function isPromotedTable(schema, table) {
  return PROMOTED_SCHEMAS.has(schema) && !EXCLUDED_TABLE_NAME.test(table);
}

function isExcludedObjectName(name) {
  return EXCLUDED_TABLE_NAME.test(name);
}

function definitionReferencesExcludedTable(definition, schemaRows) {
  const text = String(definition ?? "").toLowerCase();
  return schemaRows.some((row) => {
    if (!EXCLUDED_TABLE_NAME.test(row.table_name)) return false;
    const escaped = row.table_name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    return new RegExp(`(^|[^a-z0-9_$])${escaped}([^a-z0-9_$]|$)`, "i").test(
      text,
    );
  });
}

function objectReviewKey(kind, row, keyFn) {
  return keyFn(row);
}

function objectIsExcluded(kind, row, snapshot) {
  if (kind === "tables") {
    return !isPromotedTable(row.schema_name, row.table_name);
  }
  if (kind === "columns" || kind === "constraints" || kind === "indexes" ||
      kind === "triggers" || kind === "policies" || kind === "rls") {
    return !isPromotedTable(row.schema_name, row.table_name);
  }
  if (kind === "functions" || kind === "views") {
    return (
      !PROMOTED_SCHEMAS.has(row.schema_name) ||
      isExcludedObjectName(row.name) ||
      definitionReferencesExcludedTable(row.definition, snapshot.columns)
    );
  }
  if (kind === "enums") {
    return (
      !PROMOTED_SCHEMAS.has(row.schema_name) ||
      isExcludedObjectName(row.name) ||
      !snapshot.columns.some(
        (column) =>
          column.schema_name === row.schema_name &&
          column.udt_schema === row.schema_name &&
          column.udt_name === row.name &&
          isPromotedTable(column.schema_name, column.table_name),
      )
    );
  }
  return true;
}

function excludedReason(kind, row, snapshot) {
  if (!PROMOTED_SCHEMAS.has(row.schema_name)) {
    return `schema ${row.schema_name} is outside the promoted scope`;
  }
  if (
    [
      "tables",
      "columns",
      "constraints",
      "indexes",
      "triggers",
      "policies",
      "rls",
    ].includes(
      kind,
    ) &&
    isExcludedObjectName(row.table_name)
  ) {
    return `table ${row.schema_name}.${row.table_name} matches the ai/menu/uat excluded scope`;
  }
  if (
    ["functions", "views", "enums"].includes(kind) &&
    isExcludedObjectName(row.name)
  ) {
    return `${kind.slice(0, -1)} name matches the ai/menu/uat excluded scope`;
  }
  if (
    ["functions", "views", "constraints"].includes(kind) &&
    definitionReferencesExcludedTable(row.definition, snapshot.columns)
  ) {
    return "definition references a table in the ai/menu/uat excluded scope";
  }
  if (
    kind === "enums" &&
    !snapshot.columns.some(
      (column) =>
        column.schema_name === row.schema_name &&
        column.udt_schema === row.schema_name &&
        column.udt_name === row.name &&
        isPromotedTable(column.schema_name, column.table_name),
    )
  ) {
    return "enum is not used by a promoted table";
  }
  return "schema is outside the additive promotion policy";
}

function definitionMentionsObject(definition, objectName) {
  const text = String(definition ?? "").toLowerCase();
  const escaped = String(objectName).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return new RegExp(`(^|[^a-z0-9_$])${escaped.toLowerCase()}([^a-z0-9_$]|$)`).test(
    text,
  );
}

function hasPromotedDependency(kind, row, snapshot) {
  if (kind === "rls") return false;
  const objectName =
    kind === "tables"
      ? row.table_name
      : row.name;
  const definitions = [
    ...snapshot.constraints,
    ...snapshot.functions,
    ...snapshot.triggers,
    ...snapshot.views,
    ...snapshot.policies,
  ];
  return definitions.some((candidate) => {
    if (candidate === row) return false;
    if (!PROMOTED_SCHEMAS.has(candidate.schema_name)) return false;
    if (
      ["constraints", "triggers", "policies"].some(
        (candidateKind) => candidateKind === kind,
      ) &&
      candidate.table_name === row.table_name
    ) {
      return false;
    }
    if (candidate.table_name && isExcludedObjectName(candidate.table_name)) {
      return false;
    }
    if (kind === "columns") {
      return (
        definitionReferencesExcludedTable(candidate.definition, [
          { table_name: row.table_name },
        ]) &&
        definitionMentionsObject(candidate.definition, row.table_name)
      );
    }
    if (
      ["constraints", "indexes", "triggers", "policies"].includes(kind)
    ) {
      return false;
    }
    return definitionMentionsObject(candidate.definition, objectName);
  });
}

function normalizedColumn(row) {
  return [
    row.formatted_type,
    row.udt_schema,
    row.udt_name,
    row.is_nullable,
    row.column_default,
    row.is_generated,
    row.is_identity,
    row.identity_generation,
  ]
    .map(normalizeSql)
    .join("|");
}

function normalizedPolicy(row) {
  return [
    row.permissive,
    Array.isArray(row.roles) ? row.roles.join(",") : row.roles,
    row.cmd,
    row.qual,
    row.with_check,
  ]
    .map(normalizeSql)
    .join("|");
}

function definitionConflicts(devRows, prodRows, keyFn, equalFn) {
  const prodMap = new Map(prodRows.map((row) => [keyFn(row), row]));
  return devRows
    .filter((row) => {
      const productionRow = prodMap.get(keyFn(row));
      return productionRow && !equalFn(row, productionRow);
    })
    .map((row) => ({
      key: keyFn(row),
      development: row,
      production: prodMap.get(keyFn(row)),
    }));
}

function conflictDecision(kind, row, snapshot) {
  if (objectIsExcluded(kind, row, snapshot)) {
    const dependency = hasPromotedDependency(kind, row, snapshot);
    return {
      decision: dependency
        ? REVIEW_DECISIONS.PROMOTE_REQUIRED
        : REVIEW_DECISIONS.DEV_ONLY,
      reason: dependency
        ? "excluded object is referenced by a promoted-scope object; domain owner must approve promotion"
        : excludedReason(kind, row, snapshot),
    };
  }
  return {
    decision: REVIEW_DECISIONS.PRESERVE_PROD,
    reason:
      "production definition is preserved; domain owner approval is required before any replacement",
  };
}

function buildReview(snapshot, production, diff) {
  const missingGroups = [
    ["tables", diff.tables.missing, tableKey],
    ["columns", diff.columns.missing, columnKey],
    ["constraints", diff.constraints.missing, constraintKey],
    ["indexes", diff.indexes.missing, indexKey],
    ["functions", diff.functions.missing, functionKey],
    ["triggers", diff.triggers.missing, triggerKey],
    ["views", diff.views.missing, viewKey],
    ["policies", diff.policies.missing, policyKey],
  ];
  const excluded = [];
  const promoted = [];
  const equivalentPreserved = [];
  const promotedKeys = {
    tables: new Set(diff.promotedTables),
    columns: new Set(diff.promotedColumns),
    constraints: new Set(diff.promotedConstraints),
    indexes: new Set(diff.promotedIndexes),
    functions: new Set(diff.promotedFunctions),
    triggers: new Set(diff.promotedTriggers),
    views: new Set(diff.promotedViews),
    policies: new Set(diff.promotedPolicies),
  };
  for (const [kind, keys, keyFn] of missingGroups) {
    const group = diff[kind];
    for (const key of keys) {
      const row = group.devMap.get(key);
      if (!objectIsExcluded(kind, row, snapshot)) {
        if (promotedKeys[kind].has(key)) {
          promoted.push({
            kind,
            key: objectReviewKey(kind, row, keyFn),
            decision: REVIEW_DECISIONS.PROMOTE_ADDITIVE,
            reason: "missing in production and within the promoted additive scope",
          });
        } else if (kind === "constraints") {
          const equivalent = equivalentConstraint(
            row,
            [...diff.constraints.prodMap.values()],
          );
          if (equivalent) {
            equivalentPreserved.push({
              kind,
              key,
              decision: REVIEW_DECISIONS.PRESERVE_PROD,
              reason: `production constraint ${equivalent.name} already satisfies the same invariant`,
            });
          }
        } else if (kind === "indexes") {
          const equivalent = equivalentIndex(
            row,
            [...diff.indexes.prodMap.values()],
          );
          if (row.is_primary || equivalent) {
            equivalentPreserved.push({
              kind,
              key,
              decision: REVIEW_DECISIONS.PRESERVE_PROD,
              reason: row.is_primary
                ? "primary index is managed by the primary-key constraint; it is not created as a separate additive action"
                : `production index ${equivalent.name} already has the same definition`,
            });
          }
        }
        continue;
      }
      const dependency = hasPromotedDependency(kind, row, snapshot);
      excluded.push({
        kind,
        key: objectReviewKey(kind, row, keyFn),
        decision: dependency
          ? REVIEW_DECISIONS.PROMOTE_REQUIRED
          : REVIEW_DECISIONS.DEV_ONLY,
        reason: dependency
          ? "referenced by a promoted-scope object; domain owner must approve promotion"
          : excludedReason(kind, row, snapshot),
      });
    }
  }
  const rawConflicts = [
    ...definitionConflicts(
      snapshot.columns,
      production.columns,
      columnKey,
      (dev, prod) => normalizedColumn(dev) === normalizedColumn(prod),
    ).map((item) => ({ kind: "columns", ...item })),
    ...definitionConflicts(
      snapshot.constraints,
      production.constraints,
      constraintKey,
      (dev, prod) =>
        dev.contype === prod.contype &&
        normalizeSql(dev.definition) === normalizeSql(prod.definition),
    ).map((item) => ({ kind: "constraints", ...item })),
    ...definitionConflicts(
      snapshot.indexes,
      production.indexes,
      indexKey,
      (dev, prod) =>
        normalizeIndexDefinition(dev.definition) ===
        normalizeIndexDefinition(prod.definition),
    ).map((item) => ({ kind: "indexes", ...item })),
    ...definitionConflicts(
      snapshot.functions,
      production.functions,
      functionKey,
      (dev, prod) => normalizeSql(dev.definition) === normalizeSql(prod.definition),
    ).map((item) => ({ kind: "functions", ...item })),
    ...definitionConflicts(
      snapshot.triggers,
      production.triggers,
      triggerKey,
      (dev, prod) => normalizeSql(dev.definition) === normalizeSql(prod.definition),
    ).map((item) => ({ kind: "triggers", ...item })),
    ...definitionConflicts(
      snapshot.views,
      production.views,
      viewKey,
      (dev, prod) => normalizeSql(dev.definition) === normalizeSql(prod.definition),
    ).map((item) => ({ kind: "views", ...item })),
    ...definitionConflicts(
      snapshot.policies,
      production.policies,
      policyKey,
      (dev, prod) => normalizedPolicy(dev) === normalizedPolicy(prod),
    ).map((item) => ({ kind: "policies", ...item })),
  ];
  const conflicts = rawConflicts.map((item) => ({
    kind: item.kind,
    key: item.key,
    ...conflictDecision(item.kind, item.development, snapshot),
  }));

  const devEnumMap = new Map();
  for (const row of snapshot.enums) {
    const key = enumKey(row);
    if (!devEnumMap.has(key)) devEnumMap.set(key, []);
    devEnumMap.get(key).push(row.enumlabel);
  }
  const prodEnumMap = new Map();
  for (const row of production.enums) {
    const key = enumKey(row);
    if (!prodEnumMap.has(key)) prodEnumMap.set(key, []);
    prodEnumMap.get(key).push(row.enumlabel);
  }
  for (const [key, devValues] of devEnumMap) {
    const [schema, name] = key.split(".");
    const prodValues = prodEnumMap.get(key) ?? [];
    const missingValues = devValues.filter((value) => !prodValues.includes(value));
    const productionOnlyValues = prodValues.filter(
      (value) => !devValues.includes(value),
    );
    const orderDiffers =
      prodEnumMap.has(key) &&
      JSON.stringify(devValues) !== JSON.stringify(prodValues) &&
      !missingValues.length &&
      !productionOnlyValues.length;
    if (
      prodEnumMap.has(key) &&
      !missingValues.length &&
      !productionOnlyValues.length &&
      !orderDiffers
    ) {
      continue;
    }
    const row = { schema_name: schema, name };
    const excludedEnum = objectIsExcluded("enums", row, snapshot);
    const dependency = hasPromotedDependency("enums", row, snapshot);
    if (excludedEnum) {
      excluded.push({
        kind: "enums",
        key,
        decision: dependency
          ? REVIEW_DECISIONS.PROMOTE_REQUIRED
          : REVIEW_DECISIONS.DEV_ONLY,
        reason: dependency
          ? "referenced by a promoted-scope object; domain owner must approve promotion"
          : excludedReason("enums", row, snapshot),
        missingValues,
        productionOnlyValues,
      });
    } else if (missingValues.length) {
      promoted.push({
        kind: "enums",
        key,
        decision: REVIEW_DECISIONS.PROMOTE_ADDITIVE,
        reason:
          "append development labels only; production-only labels and ordering are preserved",
        missingValues,
        productionOnlyValues,
      });
    } else {
      conflicts.push({
        kind: "enums",
        key,
        development: row,
        ...conflictDecision("enums", row, snapshot),
      });
    }
  }
  const rlsConflicts = [];
  for (const [key, devRls] of diff.devRls) {
    const prodRls = diff.prodRls.get(key);
    if (
      prodRls &&
      (devRls.rls_enabled !== prodRls.rls_enabled ||
        devRls.rls_forced !== prodRls.rls_forced)
    ) {
      rlsConflicts.push({
        kind: "rls",
        key,
        ...conflictDecision("rls", devRls, snapshot),
      });
    }
  }
  for (const key of diff.rlsCandidates) {
    promoted.push({
      kind: "rls",
      key,
      decision: REVIEW_DECISIONS.PROMOTE_ADDITIVE,
      reason: "development enables RLS for a promoted table",
    });
  }
  for (const key of diff.rlsForceCandidates) {
    promoted.push({
      kind: "rls",
      key,
      decision: REVIEW_DECISIONS.PROMOTE_ADDITIVE,
      reason: "development forces RLS for a promoted table",
    });
  }

  return {
    excluded,
    promoted,
    conflicts: [...conflicts, ...equivalentPreserved, ...rlsConflicts],
    productionOnly: {
      tables: production.tables
        .filter((row) => !diff.tables.devMap.has(tableKey(row)))
        .map((row) => tableKey(row)),
      columns: production.columns
        .filter((row) => !diff.columns.devMap.has(columnKey(row)))
        .map((row) => columnKey(row)),
      constraints: production.constraints
        .filter((row) => !diff.constraints.devMap.has(constraintKey(row)))
        .map((row) => constraintKey(row)),
      indexes: production.indexes
        .filter((row) => !diff.indexes.devMap.has(indexKey(row)))
        .map((row) => indexKey(row)),
      functions: production.functions
        .filter((row) => !diff.functions.devMap.has(functionKey(row)))
        .map((row) => functionKey(row)),
      triggers: production.triggers
        .filter((row) => !diff.triggers.devMap.has(triggerKey(row)))
        .map((row) => triggerKey(row)),
      views: production.views
        .filter((row) => !diff.views.devMap.has(viewKey(row)))
        .map((row) => viewKey(row)),
      policies: production.policies
        .filter((row) => !diff.policies.devMap.has(policyKey(row)))
        .map((row) => policyKey(row)),
      enums: [...prodEnumMap.keys()].filter((key) => !devEnumMap.has(key)),
      rls: production.rls
        .filter(
          (row) =>
            !diff.devRls.has(`${row.schema_name}.${row.table_name}`),
        )
        .map((row) => `${row.schema_name}.${row.table_name}`),
    },
  };
}

function schemaDiff(snapshot, production) {
  const tables = diffRows(snapshot.tables, production.tables, tableKey);
  const columns = diffRows(snapshot.columns, production.columns, columnKey);
  const constraints = diffRows(
    snapshot.constraints,
    production.constraints,
    constraintKey,
  );
  const indexes = diffRows(snapshot.indexes, production.indexes, indexKey);
  const functions = diffRows(
    snapshot.functions,
    production.functions,
    functionKey,
  );
  const triggers = diffRows(
    snapshot.triggers,
    production.triggers,
    triggerKey,
  );
  const views = diffRows(snapshot.views, production.views, viewKey);
  const policies = diffRows(
    snapshot.policies,
    production.policies,
    policyKey,
  );

  const devRls = new Map(
    snapshot.rls.map((row) => [`${row.schema_name}.${row.table_name}`, row]),
  );
  const prodRls = new Map(
    production.rls.map((row) => [`${row.schema_name}.${row.table_name}`, row]),
  );
  const devEnums = new Map();
  for (const row of snapshot.enums) {
    const key = enumKey(row);
    if (!devEnums.has(key)) devEnums.set(key, []);
    devEnums.get(key).push(row.enumlabel);
  }
  const prodEnums = new Map();
  for (const row of production.enums) {
    const key = enumKey(row);
    if (!prodEnums.has(key)) prodEnums.set(key, []);
    prodEnums.get(key).push(row.enumlabel);
  }
  const enumChanges = [];
  for (const [key, values] of devEnums) {
    const current = new Set(prodEnums.get(key) ?? []);
    const [schema, name] = key.split(".");
    const missingValues = values.filter((value) => !current.has(value));
    if (missingValues.length || !prodEnums.has(key)) {
      enumChanges.push({ key, schema, name, values, missingValues });
    }
  }

  const promotedTables = tables.missing.filter((key) => {
    const row = tables.devMap.get(key);
    return isPromotedTable(row.schema_name, row.table_name);
  });
  const promotedColumns = columns.missing.filter((key) => {
    const row = columns.devMap.get(key);
    return isPromotedTable(row.schema_name, row.table_name);
  });
  const promotedConstraints = constraints.missing.filter((key) => {
    const row = constraints.devMap.get(key);
    return (
      isPromotedTable(row.schema_name, row.table_name) &&
      !equivalentConstraint(row, [...constraints.prodMap.values()]) &&
      !definitionReferencesExcludedTable(row.definition, snapshot.columns)
    );
  });
  const promotedIndexes = indexes.missing.filter((key) => {
    const row = indexes.devMap.get(key);
    return (
      isPromotedTable(row.schema_name, row.table_name) &&
      !row.is_primary &&
      !equivalentIndex(row, [...indexes.prodMap.values()])
    );
  });
  const promotedFunctions = functions.missing.filter((key) => {
    const row = functions.devMap.get(key);
    return (
      PROMOTED_SCHEMAS.has(row.schema_name) &&
      !isExcludedObjectName(row.name) &&
      !definitionReferencesExcludedTable(row.definition, snapshot.columns)
    );
  });
  const promotedTriggers = triggers.missing.filter((key) => {
    const row = triggers.devMap.get(key);
    return isPromotedTable(row.schema_name, row.table_name);
  });
  const promotedViews = views.missing.filter((key) => {
    const row = views.devMap.get(key);
    return (
      PROMOTED_SCHEMAS.has(row.schema_name) &&
      !isExcludedObjectName(row.name) &&
      !definitionReferencesExcludedTable(row.definition, snapshot.columns)
    );
  });
  const promotedPolicies = policies.missing.filter((key) => {
    const row = policies.devMap.get(key);
    return isPromotedTable(row.schema_name, row.table_name);
  });
  const promotedEnumChanges = enumChanges.filter((change) => {
    if (!PROMOTED_SCHEMAS.has(change.schema) || isExcludedObjectName(change.name)) {
      return false;
    }
    return snapshot.columns.some(
      (row) =>
        row.schema_name === change.schema &&
        row.udt_schema === change.schema &&
        row.udt_name === change.name &&
        isPromotedTable(row.schema_name, row.table_name),
    );
  });

  const rlsCandidates = [];
  const rlsForceCandidates = [];
  for (const [key, row] of devRls) {
    if (!isPromotedTable(row.schema_name, row.table_name)) continue;
    const target = prodRls.get(key);
    if (row.rls_enabled && !target?.rls_enabled) rlsCandidates.push(key);
    if (row.rls_forced && !target?.rls_forced) rlsForceCandidates.push(key);
  }

  return {
    tables,
    columns,
    constraints,
    indexes,
    functions,
    triggers,
    views,
    policies,
    devRls,
    prodRls,
    enumChanges,
    promotedTables,
    promotedColumns,
    promotedConstraints,
    promotedIndexes,
    promotedFunctions,
    promotedTriggers,
    promotedViews,
    promotedPolicies,
    promotedEnumChanges,
    rlsCandidates,
    rlsForceCandidates,
    productionEnumKeys: [...prodEnums.keys()],
  };
}

let savepointCounter = 0;
async function tryAdditive(client, label, operation) {
  const savepoint = `schema_sync_sp_${++savepointCounter}`;
  await client.query(`SAVEPOINT ${savepoint}`);
  try {
    await operation();
    await client.query(`RELEASE SAVEPOINT ${savepoint}`);
    console.log(`  + ${label}`);
    return true;
  } catch (error) {
    try {
      await client.query(`ROLLBACK TO SAVEPOINT ${savepoint}`);
      await client.query(`RELEASE SAVEPOINT ${savepoint}`);
    } catch (rollbackError) {
      throw new Error(
        `${label} failed and savepoint rollback also failed: ${error.message}; ` +
          `rollback: ${rollbackError.message}`,
      );
    }
    throw new Error(`${label} failed: ${error.message}`);
  }
}

async function writeDevelopmentSnapshot(path) {
  const client = await connect(PROD_URL);
  try {
    const schema = await collect(client);
    const identity = await connectionIdentity(client);
    await fs.writeFile(
      path,
      JSON.stringify({ formatVersion: 1, identity, schema }),
      { encoding: "utf8", mode: 0o600 },
    );
    console.log(`Development schema snapshot written: ${path}`);
  } finally {
    await client.end();
  }
}

async function readDevelopmentSnapshot(path) {
  const raw = await fs.readFile(path, "utf8");
  const snapshot = JSON.parse(raw);
  if (
    snapshot?.formatVersion !== 1 ||
    !snapshot.identity ||
    !snapshot.schema?.relations ||
    !snapshot.schema?.tables ||
    !snapshot.schema?.columns ||
    !snapshot.schema?.constraints ||
    !snapshot.schema?.indexes ||
    !snapshot.schema?.functions ||
    !snapshot.schema?.triggers ||
    !snapshot.schema?.views ||
    !snapshot.schema?.enums ||
    !snapshot.schema?.policies ||
    !snapshot.schema?.rls
  ) {
    throw new Error("Invalid or incomplete development schema snapshot.");
  }
  return snapshot;
}

async function connectionIdentity(client) {
  const { rows } = await client.query(
    "SELECT current_database() AS database_name, current_user AS user_name, " +
      "inet_server_addr()::text AS server_address, inet_server_port() AS server_port",
  );
  const row = rows[0];
  return [
    row.database_name,
    row.user_name,
    row.server_address,
    row.server_port,
  ].join("|");
}

async function run() {
  console.log("=== additive schema reconciliation ===");
  if (snapshotWritePath) {
    await writeDevelopmentSnapshot(snapshotWritePath);
    return;
  }

  console.log(`  DEV : ${snapshotReadPath ? "temporary schema snapshot" : maskUrl(DEV_URL)}`);
  console.log(`  PROD: ${maskUrl(PROD_URL)}`);
  console.log(`  Mode: ${applyMode ? "APPLY" : "REPORT"}\n`);

  let dev = null;
  let prod = null;
  try {
    let devSchema;
    let prodSchema;
    if (snapshotReadPath) {
      const snapshot = await readDevelopmentSnapshot(snapshotReadPath);
      devSchema = snapshot.schema;
      prod = await connect(PROD_URL);
      const prodIdentity = await connectionIdentity(prod);
      if (prodIdentity === snapshot.identity) {
        throw new Error(
          "Development snapshot and production target have the same database identity; aborting.",
        );
      }
      prodSchema = await collect(prod);
    } else {
      [dev, prod] = await Promise.all([connect(DEV_URL), connect(PROD_URL)]);
      const [devIdentity, prodIdentity] = await Promise.all([
        connectionIdentity(dev),
        connectionIdentity(prod),
      ]);
      if (devIdentity === prodIdentity) {
        throw new Error(
          "Development and production connections resolve to the same database identity; aborting.",
        );
      }
      [devSchema, prodSchema] = await Promise.all([
        collect(dev),
        collect(prod),
      ]);
    }

    const diff = schemaDiff(devSchema, prodSchema);
    const review = buildReview(devSchema, prodSchema, diff);
    const {
      tables,
      columns,
      constraints,
      indexes,
      functions,
      triggers,
      views,
      policies,
      devRls,
      promotedTables,
      promotedColumns,
      promotedConstraints,
      promotedIndexes,
      promotedFunctions,
      promotedTriggers,
      promotedViews,
      promotedPolicies,
      promotedEnumChanges,
      rlsCandidates,
      rlsForceCandidates,
      productionEnumKeys,
    } = diff;

    const report = {
      tables: promotedTables.length,
      columns: promotedColumns.length,
      constraints: promotedConstraints.length,
      indexes: promotedIndexes.length,
      functions: promotedFunctions.length,
      triggers: promotedTriggers.length,
      views: promotedViews.length,
      enumTypesOrValues: promotedEnumChanges.length,
      policies: promotedPolicies.length,
      rlsCandidates: rlsCandidates.length,
      rlsForceCandidates: rlsForceCandidates.length,
      excludedTables: review.excluded.filter((item) => item.kind === "tables").length,
      excludedColumns: review.excluded.filter((item) => item.kind === "columns").length,
      excludedConstraints: review.excluded.filter(
        (item) => item.kind === "constraints",
      ).length,
      excludedIndexes: review.excluded.filter((item) => item.kind === "indexes").length,
      excludedFunctions: review.excluded.filter(
        (item) => item.kind === "functions",
      ).length,
      excludedTriggers: review.excluded.filter((item) => item.kind === "triggers").length,
      excludedViews: review.excluded.filter((item) => item.kind === "views").length,
      excludedPolicies: review.excluded.filter(
        (item) => item.kind === "policies",
      ).length,
      excludedEnumChanges: review.excluded.filter(
        (item) => item.kind === "enums",
      ).length,
      excludedReviewItems: review.excluded.length,
      promotedReviewItems: review.promoted.length,
      promoteRequiredReviewItems: [
        ...review.excluded,
        ...review.conflicts,
      ].filter(
        (item) => item.decision === REVIEW_DECISIONS.PROMOTE_REQUIRED,
      ).length,
      excludedDefinitionReviews: review.conflicts.filter((item) =>
        [REVIEW_DECISIONS.DEV_ONLY, REVIEW_DECISIONS.PROMOTE_REQUIRED].includes(
          item.decision,
        ),
      ).length,
      domainReviewRequired: review.conflicts.filter(
        (item) => item.decision === REVIEW_DECISIONS.PRESERVE_PROD,
      ).length,
      definitionConflicts: review.conflicts.length,
      productionOnlyObjects: Object.values(review.productionOnly).reduce(
        (total, objects) => total + objects.length,
        0,
      ),
    };

    const reviewDocument = {
      formatVersion: 1,
      policy: {
        promotedSchemas: [...PROMOTED_SCHEMAS],
        excludedTablePattern: EXCLUDED_TABLE_NAME.source,
        excludedObjectsDefault: REVIEW_DECISIONS.DEV_ONLY,
        conflictingDefinitions: REVIEW_DECISIONS.PRESERVE_PROD,
        productionOnlyAction: "PRESERVE_PROD_UNCHANGED",
        destructiveActions: "BLOCKED",
        rollbackPlan:
          "All additive apply actions run in one transaction; failures roll back before commit. " +
          "Post-commit reversal requires a reviewed compensating migration and backup, never an automatic DROP.",
      },
      summary: report,
      excludedObjects: review.excluded,
      promotedObjects: review.promoted,
      definitionConflicts: review.conflicts,
      productionOnlyObjects: review.productionOnly,
    };
    if (reviewWritePath) {
      await fs.writeFile(reviewWritePath, JSON.stringify(reviewDocument, null, 2), {
        encoding: "utf8",
        mode: 0o600,
      });
      console.log(`Schema review written: ${reviewWritePath}`);
    }

    console.log(`Promoted tables      : ${report.tables}`);
    console.log(`Promoted columns     : ${report.columns}`);
    console.log(`Promoted constraints : ${report.constraints}`);
    console.log(`Promoted indexes     : ${report.indexes}`);
    console.log(`Promoted functions   : ${report.functions}`);
    console.log(`Promoted triggers    : ${report.triggers}`);
    console.log(`Promoted views       : ${report.views}`);
    console.log(`Promoted enum changes: ${report.enumTypesOrValues}`);
    console.log(`Promoted policies    : ${report.policies}`);
    console.log(`RLS enable candidates: ${report.rlsCandidates}`);
    console.log(`RLS force candidates : ${report.rlsForceCandidates}`);
    console.log(
      `Scope-excluded objects: ${report.excludedTables} tables, ` +
        `${report.excludedColumns} columns, ${report.excludedConstraints} constraints, ` +
        `${report.excludedIndexes} indexes, ` +
        `${report.excludedFunctions} functions, ${report.excludedTriggers} triggers, ` +
        `${report.excludedViews} views, ${report.excludedEnumChanges} enums, ` +
        `${report.excludedPolicies} policies`,
    );
    console.log(
      `Review classifications  : ${report.excludedReviewItems} excluded objects; ` +
        `${report.promotedReviewItems} PROMOTE_ADDITIVE; ` +
        `${report.promoteRequiredReviewItems} PROMOTE_REQUIRED; ` +
        `${report.definitionConflicts} definition differences ` +
        `(${report.domainReviewRequired} preserved in PROD, ` +
        `${report.excludedDefinitionReviews} excluded-scope)`,
    );
    if (review.excluded.length) {
      console.log("\nExcluded object decisions:");
      for (const item of review.excluded) {
        console.log(
          `  - ${item.kind} ${item.key}: ${item.decision} (${item.reason})`,
        );
      }
    }
    if (review.conflicts.length) {
      console.log("\nDefinition conflict decisions:");
      for (const item of review.conflicts) {
        console.log(`  - ${item.kind} ${item.key}: ${item.decision} (${item.reason})`);
      }
    }
    if (report.productionOnlyObjects) {
      console.log(
        `Production-only objects preserved: ${report.productionOnlyObjects} ` +
          "(no DROP/REPLACE/disable action is generated)",
      );
    }
    console.log(
      `Allowed additive actions: ${[...ALLOWED_ACTIONS].join(", ")}; ` +
        "DROP/REPLACE/disable operations are blocked",
    );

    if (!applyMode) {
      console.log("\nREPORT ONLY — rerun with --apply to execute additive changes.");
      return;
    }
    if (report.promoteRequiredReviewItems > 0) {
      if (!safeApplyMode) {
        throw new Error(
          `${report.promoteRequiredReviewItems} excluded object(s) are PROMOTE_REQUIRED. ` +
            "Obtain domain-owner approval and update the promotion scope before --apply.",
        );
      }
      console.log(
        `\nSAFE APPLY — skipping ${report.promoteRequiredReviewItems} PROMOTE_REQUIRED ` +
          "object(s); only PROMOTE_ADDITIVE actions will run.",
      );
    }

    await prod.query("BEGIN");
    try {
      // Create missing enum types and append missing labels only.
      const prodEnumKeys = new Set(productionEnumKeys);
      for (const change of promotedEnumChanges) {
        const typeName = qualified(change.schema, change.name);
        const typeExists = prodEnumKeys.has(change.key);
        if (!typeExists) {
          const labels = change.values.map(quoteLiteral).join(", ");
          await tryAdditive(prod, `enum ${change.key}`, () =>
            prod.query(`CREATE TYPE ${typeName} AS ENUM (${labels})`),
          );
          prodEnumKeys.add(change.key);
        } else {
          for (const value of change.missingValues) {
            await tryAdditive(prod, `enum value ${change.key}.${value}`, () =>
              prod.query(
                `ALTER TYPE ${typeName} ADD VALUE IF NOT EXISTS ${quoteLiteral(value)}`,
              ),
            );
          }
        }
      }

      const prodTableKeys = new Set(
        prodSchema.tables.map((row) => tableKey(row)),
      );
      for (const key of promotedTables) {
        const row = tables.devMap.get(key);
        await tryAdditive(prod, `table ${key}`, async () => {
          for (const column of devSchema.columns.filter(
            (candidate) => tableKey(candidate) === key,
          )) {
            const sequenceName = sequenceNameFromDefault(
              column.column_default,
            );
            if (sequenceName) {
              const [sequenceSchema, sequence] = parseQualifiedName(sequenceName);
              await prod.query(
                `CREATE SEQUENCE IF NOT EXISTS ${qualified(sequenceSchema, sequence)}`,
              );
            }
          }
          await prod.query(tableSql(row, devSchema.columns));
        });
        prodTableKeys.add(key);
      }
      const productionRelationKeys = new Set(
        prodSchema.relations.map((row) => `${row.schema_name}.${row.name}`),
      );

      // Add columns as nullable on purpose. This preserves existing production
      // rows; NOT NULL/backfill is a separate reviewed data migration.
      for (const key of promotedColumns) {
        const row = columns.devMap.get(key);
        const targetTableKey = tableKey(row);
        if (!prodTableKeys.has(targetTableKey)) continue;
        if (promotedTables.includes(targetTableKey)) continue;
        await tryAdditive(prod, `column ${key}`, async () => {
          const sequenceName = sequenceNameFromDefault(row.column_default);
          if (sequenceName) {
            const [sequenceSchema, sequence] = parseQualifiedName(sequenceName);
            await prod.query(
              `CREATE SEQUENCE IF NOT EXISTS ${qualified(sequenceSchema, sequence)}`,
            );
          }
          const defaultSql = isSafeDefault(row.column_default)
            ? ` DEFAULT ${row.column_default}`
            : "";
          const generatedSql =
            row.is_generated && row.is_generated !== "NEVER"
              ? ""
              : defaultSql;
          await prod.query(
            `ALTER TABLE ${qualified(row.schema_name, row.table_name)} ` +
              `ADD COLUMN IF NOT EXISTS ${quoteIdent(row.column_name)} ` +
              `${row.formatted_type}${generatedSql}`,
          );
        });
      }

      const constraintOrder = { p: 0, u: 1, x: 2, c: 3, f: 4 };
      const orderedConstraints = [...promotedConstraints].sort((left, right) => {
        const leftType = constraints.devMap.get(left).contype;
        const rightType = constraints.devMap.get(right).contype;
        return (constraintOrder[leftType] ?? 9) - (constraintOrder[rightType] ?? 9);
      });
      for (const key of orderedConstraints) {
        const row = constraints.devMap.get(key);
        const equivalent = equivalentConstraint(
          row,
          [...constraints.prodMap.values()],
        );
        if (equivalent) {
          console.log(
            `  = constraint ${key} already satisfied by ${equivalent.name}`,
          );
          continue;
        }
        const existingIndex = indexes.prodMap.get(key);
        await tryAdditive(prod, `constraint ${key}`, () =>
          prod.query(
            constraintSql(row, existingIndex, productionRelationKeys),
          ),
        );
      }

      for (const key of promotedIndexes) {
        const row = indexes.devMap.get(key);
        const relationCollision =
          productionRelationKeys.has(`${row.schema_name}.${row.name}`) &&
          !indexes.prodMap.has(key);
        if (relationCollision && row.is_unique && promotedConstraints.includes(key)) {
          console.log(
            `  = index ${key} represented by the additive constraint`,
          );
          continue;
        }
        const alternateName = relationCollision
          ? `schema_sync_index_${stableHash(key)}`
          : undefined;
        await tryAdditive(prod, `index ${key}`, () =>
          prod.query(indexSql(row, alternateName)),
        );
      }

      // Create only functions absent from production. Existing definitions are
      // deliberately not replaced because that can change live accounting logic.
      for (const key of promotedFunctions) {
        const row = functions.devMap.get(key);
        await tryAdditive(prod, `function ${key}`, () =>
          prod.query(row.definition),
        );
      }

      for (const key of promotedTriggers) {
        const row = triggers.devMap.get(key);
        await tryAdditive(prod, `trigger ${key}`, () =>
          prod.query(`${row.definition};`),
        );
      }

      for (const key of promotedViews) {
        const row = views.devMap.get(key);
        await tryAdditive(prod, `view ${key}`, () =>
          prod.query(
            `CREATE VIEW ${qualified(row.schema_name, row.name)} AS ${row.definition};`,
          ),
        );
      }

      for (const key of promotedPolicies) {
        const row = policies.devMap.get(key);
        await tryAdditive(prod, `policy ${key}`, () =>
          prod.query(policySql(row)),
        );
      }

      for (const key of rlsCandidates) {
        const [schema, table] = key.split(".");
        await tryAdditive(prod, `enable RLS ${key}`, () =>
          prod.query(
            `ALTER TABLE ${qualified(schema, table)} ENABLE ROW LEVEL SECURITY`,
          ),
        );
      }

      for (const key of rlsForceCandidates) {
        const [schema, table] = key.split(".");
        await tryAdditive(prod, `force RLS ${key}`, () =>
          prod.query(
            `ALTER TABLE ${qualified(schema, table)} FORCE ROW LEVEL SECURITY`,
          ),
        );
      }

      await prod.query("COMMIT");
      console.log("\n✅ Additive schema reconciliation committed.");
      console.log(
        "Existing production-only objects and differing function definitions were preserved.",
      );
    } catch (error) {
      await prod.query("ROLLBACK");
      throw error;
    }
  } finally {
    await Promise.allSettled([
      dev?.end(),
      prod?.end(),
    ]);
  }
}

run().catch((error) => {
  console.error(`\n❌ additive reconciliation failed: ${error.message}`);
  process.exitCode = 1;
});