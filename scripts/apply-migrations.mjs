/**
 * Apply DB migrations from lib/db/drizzle/*.sql directly to the database.
 * This bypasses drizzle-kit's interactive rename prompts.
 *
 * Usage: node scripts/apply-migrations.mjs
 */

import { Pool } from "pg";
import { readFileSync, readdirSync } from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { spawnSync } from "child_process";
import { resolveDedicatedTestConfig } from "./runtime-db-guard.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const migrationsDir = path.resolve(__dirname, "../lib/db/drizzle");

function resolveDbUrl() {
  const runtimeEnv = process.env.RUNTIME_ENV?.toLowerCase();
  if (runtimeEnv === "test" || runtimeEnv === "staging") {
    return resolveDedicatedTestConfig().url;
  }

  const isProduction =
    process.env.NODE_ENV === "production" || !!process.env.REPLIT_DEPLOYMENT;
  const candidates = isProduction
    ? [
        process.env.SUPABASE_MIGRATION_URL,
        process.env.SUPABASE_DATABASE_URL,
        process.env.SUPABASE_SESSION_URL,
        process.env.SUPABASE_DIRECT_URL,
        process.env.SUPABASE_PG_URL,
      ]
    : [
        process.env.SUPABASE_DATABASE_URL_DEV,
        process.env.SUPABASE_DATABASE_URL,
        process.env.SUPABASE_SESSION_URL,
        process.env.SUPABASE_DIRECT_URL,
        process.env.SUPABASE_PG_URL,
      ];
  for (const url of candidates) {
    if (url && /^postgres(?:ql)?:\/\//i.test(url)) return url;
  }
  throw new Error(
    isProduction
      ? "No Supabase production PostgreSQL URL found. Set SUPABASE_DATABASE_URL."
      : "No Supabase development PostgreSQL URL found. Set SUPABASE_DATABASE_URL_DEV.",
  );
}

const pool = new Pool({
  connectionString: resolveDbUrl(),
  ssl: { rejectUnauthorized: false },
  options: "-c search_path=public",
});

const isRuntimeTest = ["test", "staging"].includes(
  process.env.RUNTIME_ENV?.toLowerCase(),
);

async function run() {
  const client = await pool.connect();
  try {
    // Ensure drizzle migrations tracking table exists
    await client.query(`
      CREATE TABLE IF NOT EXISTS "__drizzle_migrations" (
        id SERIAL PRIMARY KEY,
        hash text NOT NULL,
        created_at bigint
      )
    `);

    // Get list of already applied migrations
    const { rows: applied } = await client.query(
      `SELECT hash FROM "__drizzle_migrations"`
    );
    const appliedSet = new Set(applied.map((r) => r.hash));

    // Read all .sql files sorted
    const files = readdirSync(migrationsDir)
      .filter((f) => f.endsWith(".sql"))
      .sort();

    for (const file of files) {
      const tag = file.replace(".sql", "");
      if (appliedSet.has(tag)) {
        console.log(`[migrations] ${file} — already applied, skipping`);
        continue;
      }

      const sql = readFileSync(path.join(migrationsDir, file), "utf8");
      const statements = sql
        .split("--> statement-breakpoint")
        .map((s) => s.trim())
        .filter((s) => s.length > 0);

      console.log(`[migrations] Applying ${file} (${statements.length} statements)…`);
      let ok = 0;
      let skipped = 0;
      for (const stmt of statements) {
        try {
          await client.query(stmt);
          ok++;
        } catch (e) {
          const msg = e.message || "";
          const pgCode = e?.code ?? e?.cause?.code ?? "";
          const isExpectedIdempotentError =
            // PostgreSQL error codes: 42710 = duplicate_object, 42P07 = duplicate_table
            // 23505 = unique_violation (pg_type_typname_nsp_index for duplicate enum)
            pgCode === "42710" || pgCode === "42P07" || pgCode === "23505" ||
            msg.includes("already exists") ||
            msg.includes("duplicate key") ||
            msg.includes("duplicate_object") ||
              (msg.includes("does not exist") &&
                (msg.includes("column") || msg.includes("constraint")));
          if (isExpectedIdempotentError) {
            skipped++;
          } else {
            console.error(`  [failed] ${msg.slice(0, 240)}`);
            if (isRuntimeTest) {
              throw new Error(`Migration ${file} failed: ${msg}`);
            }
            skipped++;
          }
        }
      }

      await client.query(
        `INSERT INTO "__drizzle_migrations" (hash, created_at) VALUES ($1, $2)`,
        [tag, Date.now()]
      );
      console.log(`[migrations] ${file} — ${ok} ok, ${skipped} skipped`);
    }

    const { rows } = await client.query(
      "SELECT count(*) FROM information_schema.tables WHERE table_schema='public'"
    );
    console.log(`[migrations] Done. Total tables: ${rows[0].count}`);
  } finally {
    client.release();
    await pool.end();
  }
}

async function syncToSupabase() {
  if (isRuntimeTest) {
    console.log("[sync] Runtime test target — skip sync to production Supabase");
    return;
  }
  if (!process.env.SUPABASE_DATABASE_URL) {
    console.log("[sync] SUPABASE_DATABASE_URL tidak di-set — skip sync ke Supabase");
    return;
  }
  console.log("[sync] Memeriksa sinkronisasi tabel ke Supabase...");
  const syncScript = path.resolve(__dirname, "db-sync-check.mjs");
  const result = spawnSync(process.execPath, [syncScript, "--apply"], {
    stdio: "inherit",
    env: process.env,
  });
  if (result.status !== 0) {
    console.warn("[sync] db-sync-check selesai dengan exit code:", result.status);
  }
}

run()
  .then(() => syncToSupabase())
  .catch((e) => {
    console.error("[migrations] FATAL:", e.message);
    process.exit(1);
  });
