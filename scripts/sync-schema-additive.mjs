#!/usr/bin/env node
/**
 * Additive Dev -> Prod schema reconciliation for the Supabase runtime DB.
 *
 * This intentionally never drops, replaces, disables, or alters an existing
 * production object. It only creates objects/columns/enums/policies that are
 * present in development and absent from production.
 *
 * Usage:
 *   node scripts/sync-schema-additive.mjs              # report only
 *   node scripts/sync-schema-additive.mjs --apply      # apply additive diff
 *
 * The two connection URLs must be supplied by the official secret loader:
 *   SUPABASE_DATABASE_URL_DEV
 *   SUPABASE_DATABASE_URL
 */

import pg from "pg";
import fs from "node:fs/promises";

const { Client } = pg;
const args = process.argv.slice(2);
const applyMode = args.includes("--apply");

function flagValue(flag) {
  const index = args.indexOf(flag);
  return index >= 0 ? args[index + 1] : undefined;
}

const snapshotWritePath = flagValue("--write-dev-snapshot");
const snapshotReadPath = flagValue("--from-dev-snapshot");
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
  "columns",
  "functions",
  "triggers",
  "views",
  "enums",
  "policies",
]);

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
  columns: `
    SELECT
      c.table_schema AS schema_name,
      c.table_name,
      c.column_name,
      c.column_default,
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

function schemaDiff(snapshot, production) {
  const columns = diffRows(snapshot.columns, production.columns, columnKey);
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

  const promotedColumns = columns.missing.filter((key) => {
    const row = columns.devMap.get(key);
    return isPromotedTable(row.schema_name, row.table_name);
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
  for (const [key, row] of devRls) {
    if (!isPromotedTable(row.schema_name, row.table_name)) continue;
    const target = prodRls.get(key);
    if (row.rls_enabled && !target?.rls_enabled) rlsCandidates.push(key);
  }

  return {
    columns,
    functions,
    triggers,
    views,
    policies,
    devRls,
    prodRls,
    enumChanges,
    promotedColumns,
    promotedFunctions,
    promotedTriggers,
    promotedViews,
    promotedPolicies,
    promotedEnumChanges,
    rlsCandidates,
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
    !snapshot.schema?.columns ||
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
    const {
      columns,
      functions,
      triggers,
      views,
      policies,
      devRls,
      promotedColumns,
      promotedFunctions,
      promotedTriggers,
      promotedViews,
      promotedPolicies,
      promotedEnumChanges,
      rlsCandidates,
    } = diff;

    const report = {
      columns: promotedColumns.length,
      functions: promotedFunctions.length,
      triggers: promotedTriggers.length,
      views: promotedViews.length,
      enumTypesOrValues: promotedEnumChanges.length,
      policies: promotedPolicies.length,
      rlsCandidates: rlsCandidates.length,
      excludedColumns: columns.missing.length - promotedColumns.length,
      excludedFunctions: functions.missing.length - promotedFunctions.length,
      excludedTriggers: triggers.missing.length - promotedTriggers.length,
      excludedViews: views.missing.length - promotedViews.length,
      excludedPolicies: policies.missing.length - promotedPolicies.length,
      excludedEnumChanges: diff.enumChanges.length - promotedEnumChanges.length,
    };

    console.log(`Promoted columns     : ${report.columns}`);
    console.log(`Promoted functions   : ${report.functions}`);
    console.log(`Promoted triggers    : ${report.triggers}`);
    console.log(`Promoted views       : ${report.views}`);
    console.log(`Promoted enum changes: ${report.enumTypesOrValues}`);
    console.log(`Promoted policies    : ${report.policies}`);
    console.log(`RLS candidates (not allowed): ${report.rlsCandidates}`);
    console.log(
      `Scope-excluded objects: ${report.excludedColumns} columns, ` +
        `${report.excludedFunctions} functions, ${report.excludedTriggers} triggers, ` +
        `${report.excludedViews} views, ${report.excludedEnumChanges} enums, ` +
        `${report.excludedPolicies} policies`,
    );
    console.log(
      `Allowed actions: ${[...ALLOWED_ACTIONS].join(", ")}; RLS/other DDL: blocked`,
    );

    if (!applyMode) {
      console.log("\nREPORT ONLY — rerun with --apply to execute additive changes.");
      return;
    }

    await prod.query("BEGIN");
    try {
      // Create missing enum types and append missing labels only.
      for (const change of promotedEnumChanges) {
        const typeName = qualified(change.schema, change.name);
        const typeExists = prodEnums.has(change.key);
        if (!typeExists) {
          const labels = change.values.map(quoteLiteral).join(", ");
          await tryAdditive(prod, `enum ${change.key}`, () =>
            prod.query(`CREATE TYPE ${typeName} AS ENUM (${labels})`),
          );
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

      // Add columns as nullable on purpose. This preserves existing production
      // rows; NOT NULL/backfill is a separate reviewed data migration.
      const prodTables = new Set(
        prodSchema.columns.map(
          (row) => `${row.schema_name}.${row.table_name}`,
        ),
      );
      for (const key of promotedColumns) {
        const row = columns.devMap.get(key);
        const tableKey = `${row.schema_name}.${row.table_name}`;
        if (!prodTables.has(tableKey)) continue;
        await tryAdditive(prod, `column ${key}`, async () => {
          const sequenceName = sequenceNameFromDefault(row.column_default);
          if (sequenceName) {
            const [sequenceSchema, sequence] = parseQualifiedName(sequenceName);
            await prod.query(
              `CREATE SEQUENCE IF NOT EXISTS ${qualified(sequenceSchema, sequence)}`,
            );
          }
          const safeDefault =
            row.column_default &&
            (/^(now\\(\\)|CURRENT_TIMESTAMP|gen_random_uuid\\(\\)|uuid_generate_v4\\(\\)|[-+]?\\d+(?:\\.\\d+)?|'.*')(?:::.*)?$/i.test(
              row.column_default.trim(),
            ) ||
              Boolean(sequenceName));
          const defaultSql = safeDefault
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