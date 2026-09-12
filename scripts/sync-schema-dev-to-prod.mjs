#!/usr/bin/env node
/**
 * sync-schema-dev-to-prod.mjs
 *
 * Sinkronisasi skema tabel dari Supabase DEV ke Supabase PROD.
 * Membuat tabel yang ada di DEV tapi belum ada di PROD — idempoten (IF NOT EXISTS).
 * Juga menyinkronkan enum types yang dibutuhkan tabel yang akan dibuat.
 *
 * Usage:
 *   node scripts/sync-schema-dev-to-prod.mjs            # dry-run: tampilkan tabel yang missing
 *   node scripts/sync-schema-dev-to-prod.mjs --apply    # apply ke PROD
 *
 * Env vars:
 *   SUPABASE_DATABASE_URL_DEV  — Supabase DEV pooler URL
 *   SUPABASE_DATABASE_URL      — Supabase PROD pooler URL
 */

import pg from "pg";

const { Client } = pg;

const applyMode = process.argv.includes("--apply");

const DEV_URL  = process.env.SUPABASE_DATABASE_URL_DEV;
const PROD_URL = process.env.SUPABASE_DATABASE_URL;

function maskUrl(url = "") {
  return url.replace(/\/\/[^@]+@/, "//***@").split("?")[0];
}

// ── Type mapping ──────────────────────────────────────────────────────────────

function resolveColType(col) {
  const base = col.udt_name;
  // Array types: udt_name starts with _ (e.g. _text = text[])
  if (col.data_type === "ARRAY" || base.startsWith("_")) {
    const elementType = base.startsWith("_") ? base.slice(1) : "text";
    const typeMap = {
      text: "text", int4: "integer", int8: "bigint", int2: "smallint",
      bool: "boolean", float4: "real", float8: "double precision",
      uuid: "uuid", jsonb: "jsonb", json: "json",
      timestamptz: "timestamp with time zone", timestamp: "timestamp without time zone",
      varchar: "character varying", date: "date",
    };
    return (typeMap[elementType] || elementType) + "[]";
  }
  // USER-DEFINED = enum or custom type — use udt_name directly
  if (col.data_type === "USER-DEFINED") {
    return `"${base}"`;
  }
  if (base === "varchar" || base === "bpchar") {
    return col.character_maximum_length
      ? `character varying(${col.character_maximum_length})`
      : "character varying";
  }
  if (base === "numeric") {
    return col.numeric_precision != null && col.numeric_scale != null
      ? `numeric(${col.numeric_precision},${col.numeric_scale})`
      : "numeric";
  }
  const typeMap = {
    int4: "integer", int8: "bigint", int2: "smallint",
    float4: "real", float8: "double precision", bool: "boolean",
    timestamptz: "timestamp with time zone",
    timestamp: "timestamp without time zone",
    text: "text", jsonb: "jsonb", json: "json",
    uuid: "uuid", date: "date",
    time: "time without time zone", timetz: "time with time zone",
  };
  return typeMap[base] || col.data_type || base;
}

// ── Get table list ────────────────────────────────────────────────────────────

async function getTableSet(client) {
  const res = await client.query(`
    SELECT table_name
    FROM information_schema.tables
    WHERE table_schema = 'public' AND table_type = 'BASE TABLE'
    ORDER BY table_name
  `);
  return new Set(res.rows.map((r) => r.table_name));
}

// ── Introspect enum types needed by a list of tables ─────────────────────────

async function getNeededEnums(devClient, tableNames) {
  if (tableNames.length === 0) return {};
  const res = await devClient.query(`
    SELECT DISTINCT c.table_name, c.udt_name
    FROM information_schema.columns c
    JOIN pg_type pt ON pt.typname = c.udt_name
    JOIN pg_enum pe ON pe.enumtypid = pt.oid
    WHERE c.table_schema = 'public'
      AND c.table_name = ANY($1)
  `, [tableNames]);

  const enumNames = [...new Set(res.rows.map((r) => r.udt_name))];
  if (enumNames.length === 0) return {};

  const enumRes = await devClient.query(`
    SELECT t.typname, e.enumlabel
    FROM pg_type t
    JOIN pg_enum e ON t.oid = e.enumtypid
    WHERE t.typname = ANY($1)
    ORDER BY t.typname, e.enumsortorder
  `, [enumNames]);

  const enums = {};
  for (const r of enumRes.rows) {
    if (!enums[r.typname]) enums[r.typname] = [];
    enums[r.typname].push(r.enumlabel);
  }
  return enums;
}

// ── Get existing enum names in PROD ──────────────────────────────────────────

async function getExistingEnums(prodClient) {
  const res = await prodClient.query(`
    SELECT typname FROM pg_type
    WHERE typtype = 'e' AND typnamespace = (SELECT oid FROM pg_namespace WHERE nspname='public')
  `);
  return new Set(res.rows.map((r) => r.typname));
}

// ── Generate DDL for a single table ──────────────────────────────────────────

async function buildTableDDL(devClient, tableName) {
  const colRes = await devClient.query(`
    SELECT c.column_name, c.data_type, c.character_maximum_length,
      c.numeric_precision, c.numeric_scale, c.is_nullable, c.column_default, c.udt_name
    FROM information_schema.columns c
    WHERE c.table_schema = 'public' AND c.table_name = $1
    ORDER BY c.ordinal_position
  `, [tableName]);

  const pkRes = await devClient.query(`
    SELECT kcu.column_name
    FROM information_schema.table_constraints tc
    JOIN information_schema.key_column_usage kcu
      ON tc.constraint_name = kcu.constraint_name AND tc.table_schema = kcu.table_schema
    WHERE tc.constraint_type = 'PRIMARY KEY'
      AND tc.table_schema = 'public' AND tc.table_name = $1
    ORDER BY kcu.ordinal_position
  `, [tableName]);

  const idxRes = await devClient.query(`
    SELECT i.relname AS index_name, ix.indisunique AS is_unique,
      array_agg(a.attname ORDER BY array_position(ix.indkey, a.attnum)) AS columns
    FROM pg_class t
    JOIN pg_index ix ON t.oid = ix.indrelid
    JOIN pg_class i ON i.oid = ix.indexrelid
    JOIN pg_attribute a ON a.attrelid = t.oid AND a.attnum = ANY(ix.indkey)
    JOIN pg_namespace n ON n.oid = t.relnamespace
    WHERE t.relname = $1 AND n.nspname = 'public' AND NOT ix.indisprimary
    GROUP BY i.relname, ix.indisunique
  `, [tableName]);

  const pkCols = pkRes.rows.map((r) => r.column_name);
  const sequences = [];

  const colDefs = colRes.rows.map((col) => {
    const type = resolveColType(col);
    const nullable = col.is_nullable === "YES" ? "" : " NOT NULL";
    const defVal = col.column_default || "";
    const seqMatch = defVal.match(/nextval\('([^']+)'(?:::regclass)?\)/i);
    if (seqMatch) sequences.push(seqMatch[1]);
    const def = defVal ? ` DEFAULT ${defVal}` : "";
    return `  "${col.column_name}" ${type}${nullable}${def}`;
  });

  if (pkCols.length) {
    colDefs.push(`  PRIMARY KEY (${pkCols.map((c) => `"${c}"`).join(", ")})`);
  }

  let sql = sequences.map((s) => `CREATE SEQUENCE IF NOT EXISTS "${s}";\n`).join("");
  sql += `CREATE TABLE IF NOT EXISTS "${tableName}" (\n${colDefs.join(",\n")}\n);\n`;

  for (const idx of idxRes.rows) {
    const unique = idx.is_unique ? "UNIQUE " : "";
    const rawCols = idx.columns;
    const colArr = Array.isArray(rawCols)
      ? rawCols
      : typeof rawCols === "string"
        ? rawCols.replace(/^\{|\}$/g, "").split(",").map((s) => s.trim()).filter(Boolean)
        : [];
    if (!colArr.length) continue;
    const cols = colArr.map((c) => `"${c}"`).join(", ");
    sql += `CREATE ${unique}INDEX IF NOT EXISTS "${idx.index_name}" ON "${tableName}" (${cols});\n`;
  }

  return sql;
}

// ── Apply SQL statements (split by ;) ────────────────────────────────────────

async function applySql(prodClient, sql, context) {
  const stmts = sql
    .split(/;\s*\n|;$/)
    .map((s) => s.trim())
    .filter((s) => s.length > 0 && !s.startsWith("--"));

  for (const stmt of stmts) {
    try {
      await prodClient.query(stmt + ";");
    } catch (e) {
      if (e.message.includes("already exists")) continue;
      throw new Error(`[${context}] ${e.message.slice(0, 200)}`);
    }
  }
}

// ── Main ─────────────────────────────────────────────────────────────────────

async function main() {
  console.log("\n=== sync-schema-dev-to-prod ===");
  console.log(`  DEV : ${maskUrl(DEV_URL)}`);
  console.log(`  PROD: ${maskUrl(PROD_URL)}`);
  console.log(`  Mode: ${applyMode ? "APPLY" : "DRY-RUN"}\n`);

  if (!DEV_URL) {
    console.log("[sync] SUPABASE_DATABASE_URL_DEV tidak di-set — skip.");
    process.exit(0);
  }
  if (!PROD_URL) {
    console.log("[sync] SUPABASE_DATABASE_URL tidak di-set — skip (mungkin sedang di env dev).");
    process.exit(0);
  }
  if (DEV_URL === PROD_URL) {
    console.log("[sync] DEV dan PROD URL sama — skip (tidak perlu sync).");
    process.exit(0);
  }

  const dev  = new Client({ connectionString: DEV_URL,  ssl: { rejectUnauthorized: false } });
  const prod = new Client({ connectionString: PROD_URL, ssl: { rejectUnauthorized: false } });

  await dev.connect();
  await prod.connect();

  console.log("Membaca daftar tabel...");
  const [devTables, prodTables] = await Promise.all([
    getTableSet(dev),
    getTableSet(prod),
  ]);

  const missingInProd = [...devTables]
    .filter((t) => !prodTables.has(t))
    .filter((t) => t !== "__drizzle_migrations");

  console.log(`  DEV  : ${devTables.size} tabel`);
  console.log(`  PROD : ${prodTables.size} tabel`);
  console.log(`  Missing di PROD: ${missingInProd.length} tabel`);

  if (missingInProd.length === 0) {
    console.log("\n✅ PROD sudah sinkron — tidak ada tabel yang kurang.");
    await dev.end();
    await prod.end();
    return;
  }

  console.log("\nTabel yang akan dibuat di PROD:");
  missingInProd.forEach((t) => console.log(`  + ${t}`));

  if (!applyMode) {
    console.log("\n[dry-run] Gunakan --apply untuk menjalankan sync ke PROD.");
    await dev.end();
    await prod.end();
    return;
  }

  // Sync enum types yang dibutuhkan
  console.log("\nMenyinkronkan enum types yang dibutuhkan...");
  const neededEnums   = await getNeededEnums(dev, missingInProd);
  const existingEnums = await getExistingEnums(prod);

  for (const [enumName, values] of Object.entries(neededEnums)) {
    if (existingEnums.has(enumName)) {
      console.log(`  Enum exists: ${enumName}`);
      continue;
    }
    const vals = values.map((v) => `'${v.replace(/'/g, "''")}'`).join(", ");
    try {
      // Use IF NOT EXISTS guard to handle both 42710 (duplicate_object) and
      // 23505 (unique_violation on pg_type_typname_nsp_index) idempotently.
      await prod.query(
        `DO $$ BEGIN
           IF NOT EXISTS (SELECT 1 FROM pg_type t
                          JOIN pg_namespace n ON n.oid = t.typnamespace
                          WHERE t.typname = '${enumName.replace(/'/g, "''")}' AND n.nspname = 'public') THEN
             CREATE TYPE "${enumName}" AS ENUM (${vals});
           END IF;
         END $$`
      );
      console.log(`  Enum created (or already existed): ${enumName}`);
    } catch (e) {
      console.warn(`  Enum WARN: ${enumName} — ${e.message.slice(0, 100)}`);
    }
  }

  // Create missing tables
  console.log("\nMembuat tabel yang missing...");
  let ok = 0;
  let fail = 0;

  for (const tableName of missingInProd) {
    try {
      const ddl = await buildTableDDL(dev, tableName);
      await applySql(prod, ddl, tableName);
      console.log(`  OK: ${tableName}`);
      ok++;
    } catch (e) {
      console.error(`  FAIL: ${tableName} — ${e.message.slice(0, 140)}`);
      fail++;
    }
  }

  // Also ensure __drizzle_migrations exists in PROD
  try {
    await prod.query(`
      CREATE TABLE IF NOT EXISTS "__drizzle_migrations" (
        id SERIAL PRIMARY KEY,
        hash text NOT NULL,
        created_at bigint
      )
    `);
    console.log("  OK: __drizzle_migrations");
    ok++;
  } catch (e) {
    if (!e.message.includes("already exists")) {
      console.warn(`  WARN: __drizzle_migrations — ${e.message.slice(0, 80)}`);
    }
  }

  const { rows } = await prod.query(
    "SELECT count(*) FROM information_schema.tables WHERE table_schema='public' AND table_type='BASE TABLE'"
  );

  console.log(`\n${"─".repeat(50)}`);
  console.log(`Sync selesai: ${ok} OK, ${fail} gagal`);
  console.log(`PROD total tabel sekarang: ${rows[0].count}`);
  if (fail === 0) {
    console.log("✅ Semua tabel berhasil disinkronkan ke PROD.");
  } else {
    console.log("⚠️  Beberapa tabel gagal — periksa output di atas.");
    process.exit(1);
  }

  await dev.end();
  await prod.end();
}

main().catch((e) => {
  console.error("[sync] FATAL:", e.message);
  process.exit(1);
});
