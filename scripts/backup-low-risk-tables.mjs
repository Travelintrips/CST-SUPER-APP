#!/usr/bin/env node
/**
 * backup-low-risk-tables.mjs
 * Backup tabel LOW-risk yang masih berisi data sebelum cleanup.
 * Export ke: backups/supabase-cleanup/YYYY-MM-DD/<table>.json
 *
 * Usage:
 *   node scripts/backup-low-risk-tables.mjs
 *
 * Requires: SUPABASE_DATABASE_URL env var
 */

import pg from "pg";
import fs from "fs";
import path from "path";

const { Client } = pg;

const TABLES = [
  "employees",
  "employee_kasbon",
  "order_asuransi",
  "payment_receipts",
  "finance_payment_events",
  "wa_send_logs",
  "system_settings",
];

const today = new Date().toISOString().slice(0, 10);
const outDir = path.join("backups", "supabase-cleanup", today);
fs.mkdirSync(outDir, { recursive: true });

const connString = process.env.SUPABASE_DATABASE_URL;
if (!connString) {
  console.error("ERROR: SUPABASE_DATABASE_URL tidak di-set");
  process.exit(1);
}

const client = new Client({ connectionString: connString });
await client.connect();

let totalExported = 0;
let totalSkipped = 0;

for (const table of TABLES) {
  try {
    // Cek tabel ada
    const existsRes = await client.query(
      `SELECT EXISTS (
         SELECT 1 FROM pg_tables
         WHERE schemaname = 'public' AND tablename = $1
       ) AS exists`,
      [table]
    );
    if (!existsRes.rows[0].exists) {
      console.log(`SKIP ${table}: tabel tidak ditemukan (mungkin sudah direname)`);
      totalSkipped++;
      continue;
    }

    const res = await client.query(`SELECT * FROM public.${table}`);
    const rows = res.rows;
    const outFile = path.join(outDir, `${table}.json`);
    fs.writeFileSync(
      outFile,
      JSON.stringify({ table, exported_at: new Date().toISOString(), row_count: rows.length, rows }, null, 2)
    );
    console.log(`OK ${table}: ${rows.length} rows → ${outFile}`);
    totalExported++;
  } catch (err) {
    console.error(`ERROR ${table}:`, err.message);
  }
}

await client.end();

// Tulis manifest
const manifest = {
  created_at: new Date().toISOString(),
  output_dir: outDir,
  tables_exported: totalExported,
  tables_skipped: totalSkipped,
  files: TABLES.map((t) => path.join(outDir, `${t}.json`)),
};
const manifestFile = path.join(outDir, "_manifest.json");
fs.writeFileSync(manifestFile, JSON.stringify(manifest, null, 2));
console.log(`\nManifest: ${manifestFile}`);
console.log(`Total exported: ${totalExported}, skipped: ${totalSkipped}`);
