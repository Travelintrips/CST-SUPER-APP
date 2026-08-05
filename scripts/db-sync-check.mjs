#!/usr/bin/env node
/**
 * DB Sync Check — bandingkan tabel di Replit (DATABASE_URL) vs Supabase (SUPABASE_DATABASE_URL).
 * Untuk tabel yang ada di Replit tapi belum di Supabase, generate SQL CREATE TABLE.
 *
 * Usage:
 *   node scripts/db-sync-check.mjs
 *   node scripts/db-sync-check.mjs --output missing-tables.sql   # simpan SQL ke file
 *   node scripts/db-sync-check.mjs --apply                        # langsung apply ke Supabase
 */

import pg from "pg";
import fs from "fs";
import path from "path";

const { Client } = pg;

const args = process.argv.slice(2);
const outputFile = (() => {
  const i = args.indexOf("--output");
  return i >= 0 ? args[i + 1] : null;
})();
const applyMode = args.includes("--apply");

const LOCAL_URL = process.env.DATABASE_URL;
const SUPABASE_URL = process.env.SUPABASE_DATABASE_URL;

if (!LOCAL_URL) {
  console.error("ERROR: DATABASE_URL tidak di-set (Replit helium)");
  process.exit(1);
}
if (!SUPABASE_URL) {
  console.error("ERROR: SUPABASE_DATABASE_URL tidak di-set");
  process.exit(1);
}

function maskUrl(url) {
  return url.replace(/\/\/[^@]+@/, "//***@").split("?")[0];
}

async function getTables(client, label) {
  const res = await client.query(`
    SELECT table_name
    FROM information_schema.tables
    WHERE table_schema = 'public'
      AND table_type = 'BASE TABLE'
    ORDER BY table_name
  `);
  const tables = res.rows.map((r) => r.table_name);
  console.log(`  [${label}] ${tables.length} tabel ditemukan`);
  return new Set(tables);
}

async function getTableDDL(client, tableName) {
  const colRes = await client.query(
    `
    SELECT
      c.column_name,
      c.data_type,
      c.character_maximum_length,
      c.numeric_precision,
      c.numeric_scale,
      c.is_nullable,
      c.column_default,
      c.udt_name
    FROM information_schema.columns c
    WHERE c.table_schema = 'public' AND c.table_name = $1
    ORDER BY c.ordinal_position
  `,
    [tableName]
  );

  const pkRes = await client.query(
    `
    SELECT kcu.column_name
    FROM information_schema.table_constraints tc
    JOIN information_schema.key_column_usage kcu
      ON tc.constraint_name = kcu.constraint_name
      AND tc.table_schema = kcu.table_schema
    WHERE tc.constraint_type = 'PRIMARY KEY'
      AND tc.table_schema = 'public'
      AND tc.table_name = $1
    ORDER BY kcu.ordinal_position
  `,
    [tableName]
  );

  const idxRes = await client.query(
    `
    SELECT
      i.relname AS index_name,
      ix.indisunique AS is_unique,
      array_agg(a.attname ORDER BY array_position(ix.indkey, a.attnum)) AS columns
    FROM pg_class t
    JOIN pg_index ix ON t.oid = ix.indrelid
    JOIN pg_class i ON i.oid = ix.indexrelid
    JOIN pg_attribute a ON a.attrelid = t.oid AND a.attnum = ANY(ix.indkey)
    JOIN pg_namespace n ON n.oid = t.relnamespace
    WHERE t.relname = $1
      AND n.nspname = 'public'
      AND NOT ix.indisprimary
    GROUP BY i.relname, ix.indisunique
  `,
    [tableName]
  );

  const pkCols = pkRes.rows.map((r) => r.column_name);

  function colTypeStr(col) {
    const base = col.udt_name;
    if (base === "varchar" || base === "bpchar") {
      return col.character_maximum_length
        ? `character varying(${col.character_maximum_length})`
        : "character varying";
    }
    if (base === "numeric") {
      if (col.numeric_precision && col.numeric_scale != null) {
        return `numeric(${col.numeric_precision},${col.numeric_scale})`;
      }
      return "numeric";
    }
    const typeMap = {
      int4: "integer",
      int8: "bigint",
      int2: "smallint",
      float4: "real",
      float8: "double precision",
      bool: "boolean",
      timestamptz: "timestamp with time zone",
      timestamp: "timestamp without time zone",
      text: "text",
      jsonb: "jsonb",
      json: "json",
      uuid: "uuid",
      date: "date",
      time: "time without time zone",
      timetz: "time with time zone",
    };
    return typeMap[base] || col.data_type || base;
  }

  const sequences = [];
  const colDefs = colRes.rows.map((col) => {
    const type = colTypeStr(col);
    const nullable = col.is_nullable === "YES" ? "" : " NOT NULL";
    let defVal = col.column_default || "";
    const seqMatch = defVal.match(/nextval\('([^']+)'(?:::regclass)?\)/i);
    if (seqMatch) {
      sequences.push(seqMatch[1]);
    }
    const def = defVal ? ` DEFAULT ${defVal}` : "";
    return `  "${col.column_name}" ${type}${nullable}${def}`;
  });

  if (pkCols.length > 0) {
    colDefs.push(`  PRIMARY KEY (${pkCols.map((c) => `"${c}"`).join(", ")})`);
  }

  let sql = "";
  for (const seq of sequences) {
    sql += `CREATE SEQUENCE IF NOT EXISTS "${seq}";\n`;
  }
  sql += `CREATE TABLE IF NOT EXISTS "${tableName}" (\n${colDefs.join(",\n")}\n);\n`;

  for (const idx of idxRes.rows) {
    const unique = idx.is_unique ? "UNIQUE " : "";
    const rawCols = idx.columns;
    const colArr = Array.isArray(rawCols)
      ? rawCols
      : typeof rawCols === "string"
        ? rawCols.replace(/^\{|\}$/g, "").split(",").map((s) => s.trim()).filter(Boolean)
        : [];
    if (colArr.length === 0) continue;
    const cols = colArr.map((c) => `"${c}"`).join(", ");
    sql += `CREATE ${unique}INDEX IF NOT EXISTS "${idx.index_name}" ON "${tableName}" (${cols});\n`;
  }

  return sql;
}

async function main() {
  console.log("\n=== DB Sync Check ===");
  console.log(`  Replit  : ${maskUrl(LOCAL_URL)}`);
  console.log(`  Supabase: ${maskUrl(SUPABASE_URL)}\n`);

  const local = new Client({ connectionString: LOCAL_URL });
  const supa = new Client({
    connectionString: SUPABASE_URL,
    ssl: { rejectUnauthorized: false },
  });

  await local.connect();
  await supa.connect();

  console.log("Mengambil daftar tabel...");
  const [localTables, supaTables] = await Promise.all([
    getTables(local, "Replit"),
    getTables(supa, "Supabase"),
  ]);

  const missingInSupa = [...localTables].filter((t) => !supaTables.has(t));
  const missingInLocal = [...supaTables].filter((t) => !localTables.has(t));

  console.log(`\n--- Hasil ---`);
  console.log(`  Replit total  : ${localTables.size} tabel`);
  console.log(`  Supabase total: ${supaTables.size} tabel`);
  console.log(`  Missing di Supabase : ${missingInSupa.length} tabel`);
  console.log(`  Missing di Replit   : ${missingInLocal.length} tabel`);

  if (missingInLocal.length > 0) {
    console.log(`\nTabel ada di Supabase, belum di Replit:`);
    missingInLocal.forEach((t) => console.log(`  - ${t}`));
  }

  if (missingInSupa.length === 0) {
    console.log("\n✅ Supabase sudah sinkron — tidak ada tabel yang kurang.");
    await local.end();
    await supa.end();
    return;
  }

  console.log(`\nTabel ada di Replit, BELUM di Supabase:`);
  missingInSupa.forEach((t) => console.log(`  - ${t}`));

  console.log("\nMeng-generate SQL untuk tabel yang missing...");
  const sqlParts = [];
  for (const table of missingInSupa) {
    process.stdout.write(`  Introspect: ${table}... `);
    try {
      const ddl = await getTableDDL(local, table);
      sqlParts.push(`-- TABLE: ${table}\n${ddl}`);
      process.stdout.write("OK\n");
    } catch (e) {
      process.stdout.write(`ERROR: ${e.message}\n`);
    }
  }

  const fullSql =
    `-- Generated by db-sync-check.mjs\n-- ${new Date().toISOString()}\n-- Tabel missing di Supabase: ${missingInSupa.length}\n\n` +
    sqlParts.join("\n");

  if (outputFile) {
    fs.writeFileSync(outputFile, fullSql, "utf8");
    console.log(`\n✅ SQL disimpan ke: ${outputFile}`);
  } else {
    console.log("\n--- SQL untuk dijalankan di Supabase ---\n");
    console.log(fullSql);
  }

  if (applyMode) {
    console.log("\n⚡ Mode --apply: menjalankan SQL ke Supabase...");
    const statements = fullSql
      .split(/;\s*\n/)
      .map((s) => {
        const lines = s.split("\n").filter((l) => !l.trimStart().startsWith("--"));
        return lines.join("\n").trim();
      })
      .filter((s) => s.length > 0);
    let ok = 0;
    let fail = 0;
    for (const stmt of statements) {
      try {
        await supa.query(stmt + ";");
        ok++;
      } catch (e) {
        if (e.message.includes("already exists")) {
          ok++;
        } else {
          console.error(`  FAIL [${stmt.slice(0, 60).replace(/\n/g, " ")}]: ${e.message.slice(0, 100)}`);
          fail++;
        }
      }
    }
    console.log(`\n  Applied: ${ok} OK, ${fail} gagal`);
    if (fail === 0) {
      console.log("✅ Semua tabel berhasil dibuat di Supabase.");
    } else {
      console.log("⚠️  Ada beberapa statement yang gagal. Periksa output di atas.");
    }
  }

  await local.end();
  await supa.end();
}

main().catch((e) => {
  console.error("Fatal:", e.message);
  process.exit(1);
});
