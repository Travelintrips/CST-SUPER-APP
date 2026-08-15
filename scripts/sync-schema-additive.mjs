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

const { Client } = pg;
const applyMode = process.argv.includes("--apply");

const DEV_URL = process.env.SUPABASE_DATABASE_URL_DEV;
const PROD_URL = process.env.SUPABASE_DATABASE_URL;

if (!DEV_URL || !PROD_URL) {
  throw new Error(
    "Both SUPABASE_DATABASE_URL_DEV and SUPABASE_DATABASE_URL are required.",
  );
}
if (DEV_URL === PROD_URL) {
  throw new Error("Development and production URLs are identical; aborting.");
}

const IDENTIFIER = /^[a-zA-Z_][a-zA-Z0-9_$]*$/;
const PROMOTED_SCHEMAS = new Set(["public", "sport_center"]);

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
      format_type(a.atttypid, a.atttypmod) AS formatted_type
    FROM information_schema.columns c
    JOIN pg_namespace n ON n.nspname = c.table_schema
    JOIN pg_class t ON t.relnamespace = n.oid AND t.relname = c.table_name
    JOIN pg_attribute a ON a.attrelid = t.oid AND a.attname = c.column_name
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

async function tryAdditive(client, label, operation) {
  const savepoint = `sp_${Math.random().toString(36).slice(2, 10)}`;
  await client.query(`SAVEPOINT ${savepoint}`);
  try {
    await operation();
    await client.query(`RELEASE SAVEPOINT ${savepoint}`);
    console.log(`  + ${label}`);
    return true;
  } catch (error) {
    await client.query(`ROLLBACK TO SAVEPOINT ${savepoint}`);
    await client.query(`RELEASE SAVEPOINT ${savepoint}`);
    console.log(`  ! skipped ${label}: ${error.message.slice(0, 180)}`);
    return false;
  }
}

async function run() {
  console.log("=== additive schema reconciliation ===");
  console.log(`  DEV : ${maskUrl(DEV_URL)}`);
  console.log(`  PROD: ${maskUrl(PROD_URL)}`);
  console.log(`  Mode: ${applyMode ? "APPLY" : "REPORT"}\n`);

  const [dev, prod] = await Promise.all([connect(DEV_URL), connect(PROD_URL)]);
  try {
    const [devSchema, prodSchema] = await Promise.all([
      collect(dev),
      collect(prod),
    ]);

    const columns = diffRows(
      devSchema.columns,
      prodSchema.columns,
      columnKey,
    );
    const functions = diffRows(
      devSchema.functions,
      prodSchema.functions,
      functionKey,
    );
    const triggers = diffRows(
      devSchema.triggers,
      prodSchema.triggers,
      triggerKey,
    );
    const views = diffRows(devSchema.views, prodSchema.views, viewKey);
    const policies = diffRows(
      devSchema.policies,
      prodSchema.policies,
      policyKey,
    );
    const devRls = new Map(
      devSchema.rls.map((row) => [
        `${row.schema_name}.${row.table_name}`,
        row,
      ]),
    );
    const prodRls = new Map(
      prodSchema.rls.map((row) => [
        `${row.schema_name}.${row.table_name}`,
        row,
      ]),
    );
    const devEnums = new Map();
    for (const row of devSchema.enums) {
      const key = enumKey(row);
      if (!devEnums.has(key)) devEnums.set(key, []);
      devEnums.get(key).push(row.enumlabel);
    }
    const prodEnums = new Map();
    for (const row of prodSchema.enums) {
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

    const promotedColumns = columns.missing.filter((key) =>
      PROMOTED_SCHEMAS.has(columns.devMap.get(key).schema_name),
    );
    const promotedFunctions = functions.missing.filter((key) =>
      PROMOTED_SCHEMAS.has(functions.devMap.get(key).schema_name),
    );
    const promotedTriggers = triggers.missing.filter((key) =>
      PROMOTED_SCHEMAS.has(triggers.devMap.get(key).schema_name),
    );
    const promotedViews = views.missing.filter((key) =>
      PROMOTED_SCHEMAS.has(views.devMap.get(key).schema_name),
    );
    const promotedPolicies = policies.missing.filter((key) =>
      PROMOTED_SCHEMAS.has(policies.devMap.get(key).schema_name),
    );
    const promotedEnumChanges = enumChanges.filter((change) =>
      PROMOTED_SCHEMAS.has(change.schema),
    );

    const report = {
      columns: promotedColumns.length,
      functions: promotedFunctions.length,
      triggers: promotedTriggers.length,
      views: promotedViews.length,
      enumTypesOrValues: promotedEnumChanges.length,
      policies: promotedPolicies.length,
      rlsTablesWithPolicyPlan: 0,
      skippedRlsTables: [],
    };

    // Only enable RLS where the target will have at least one policy. Enabling
    // RLS without policies is fail-closed and can lock the API out entirely.
    const policyTables = new Set([
      ...prodSchema.policies.map(
        (row) => `${row.schema_name}.${row.table_name}`,
      ),
      ...promotedPolicies.map((key) => key.split(".").slice(0, 2).join(".")),
    ]);
    for (const [key, row] of devRls) {
      if (!PROMOTED_SCHEMAS.has(row.schema_name)) continue;
      const target = prodRls.get(key);
      if (row.rls_enabled && !target?.rls_enabled) {
        if (policyTables.has(key)) report.rlsTablesWithPolicyPlan++;
        else report.skippedRlsTables.push(key);
      }
    }

    console.log(`Promoted columns     : ${report.columns}`);
    console.log(`Promoted functions   : ${report.functions}`);
    console.log(`Promoted triggers    : ${report.triggers}`);
    console.log(`Promoted views       : ${report.views}`);
    console.log(`Promoted enum changes: ${report.enumTypesOrValues}`);
    console.log(`Promoted policies    : ${report.policies}`);
    console.log(`RLS enable candidates: ${report.rlsTablesWithPolicyPlan}`);
    console.log(`RLS skipped (no policy): ${report.skippedRlsTables.length}`);

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

      for (const [key, row] of devRls) {
        if (!PROMOTED_SCHEMAS.has(row.schema_name)) continue;
        const target = prodRls.get(key);
        if (!row.rls_enabled || target?.rls_enabled || !policyTables.has(key)) {
          continue;
        }
        const [schema, table] = key.split(".");
        await tryAdditive(prod, `enable RLS ${key}`, () =>
          prod.query(
            `ALTER TABLE ${qualified(schema, table)} ENABLE ROW LEVEL SECURITY`,
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
    await Promise.allSettled([dev.end(), prod.end()]);
  }
}

run().catch((error) => {
  console.error(`\n❌ additive reconciliation failed: ${error.message}`);
  process.exitCode = 1;
});