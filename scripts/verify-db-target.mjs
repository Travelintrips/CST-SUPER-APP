#!/usr/bin/env node
/**
 * verify-db-target.mjs
 * Verifikasi target DB sebelum menjalankan migration.
 *
 * Usage:
 *   node scripts/verify-db-target.mjs --env dev
 *   node scripts/verify-db-target.mjs --env prod
 *   npm run db:verify:dev
 *   npm run db:verify:prod
 *
 * Exit code 0 = OK, 1 = error / mismatch
 */

import pg from "pg";

const { Client } = pg;

const PROD_PROJECT_REF = "nzdweipzckfszczzqtuw";
const ARGS = process.argv.slice(2);
const ENV_FLAG = ARGS[ARGS.indexOf("--env") + 1] ?? "dev";

const targetEnv = ENV_FLAG === "prod" || ENV_FLAG === "production"
  ? "production"
  : "development";

// ── Resolve URL sesuai target ────────────────────────────────────────────────
function resolveUrl(env) {
  if (env === "production") {
    const url = process.env.SUPABASE_DATABASE_URL;
    if (!url) {
      console.error("[verify-db] ERROR: SUPABASE_DATABASE_URL tidak di-set (required untuk production)");
      process.exit(1);
    }
    return { url, key: "SUPABASE_DATABASE_URL" };
  }

  // Development: wajib pakai DEV URL
  const devUrl = process.env.SUPABASE_DATABASE_URL_DEV;
  if (devUrl) return { url: devUrl, key: "SUPABASE_DATABASE_URL_DEV" };

  console.error("[verify-db] ERROR: SUPABASE_DATABASE_URL_DEV wajib di-set untuk development.");
  process.exit(1);
}

// ── Extract project ref ─────────────────────────────────────────────────────
function extractProjectRef(url) {
  const poolerMatch = url.match(/postgres(?:ql)?:\/\/[^.]+\.([a-z0-9]+):/i);
  if (poolerMatch) return poolerMatch[1];
  const directMatch = url.match(/db\.([a-z0-9]+)\.supabase\.co/i);
  if (directMatch) return directMatch[1];
  return null;
}

function extractPort(url) {
  try {
    return new URL(url).port || "5432";
  } catch {
    return null;
  }
}

// ── Main ─────────────────────────────────────────────────────────────────────
const { url, key } = resolveUrl(targetEnv);
const maskedUrl = url.replace(/\/\/[^@]+@/, "//***@").split("?")[0];
const projectRef = extractProjectRef(url);
const isPointingToProd = projectRef === PROD_PROJECT_REF;
const migrationUrl = process.env.SUPABASE_MIGRATION_URL;
const migrationProjectRef = migrationUrl ? extractProjectRef(migrationUrl) : null;
const migrationPort = migrationUrl ? extractPort(migrationUrl) : null;
const migrationIsProd = migrationProjectRef === PROD_PROJECT_REF;

console.log("=".repeat(60));
console.log(`[verify-db] Target env  : ${targetEnv}`);
console.log(`[verify-db] URL source  : ${key}`);
console.log(`[verify-db] URL (masked): ${maskedUrl}`);
console.log(`[verify-db] Project ref : ${projectRef ?? "(tidak dikenali — bukan Supabase pooler?)"}`);
console.log(`[verify-db] Is PROD ref : ${isPointingToProd} (PROD ref: ${PROD_PROJECT_REF})`);
if (migrationUrl) {
  console.log(`[verify-db] Migration URL (masked): ${migrationUrl.replace(/\/\/[^@]+@/, "//***@").split("?")[0]}`);
  console.log(`[verify-db] Migration project ref : ${migrationProjectRef ?? "(tidak dikenali)"}`);
  console.log(`[verify-db] Migration port        : ${migrationPort ?? "(tidak dikenali)"}`);
} else {
  console.log("[verify-db] Migration URL         : not configured");
}
console.log("=".repeat(60));

if (!migrationUrl) {
  console.error("[verify-db] FATAL: SUPABASE_MIGRATION_URL wajib di-set untuk verifikasi migration target.");
  process.exit(1);
}

// ── Guard: dev tidak boleh pakai PROD ref jika DEV URL tersedia ──────────────
if (targetEnv === "development" && isPointingToProd && !!process.env.SUPABASE_DATABASE_URL_DEV) {
  console.error("[verify-db] FATAL: Target=DEV tapi URL mengarah ke PROD project.");
  console.error("[verify-db] SUPABASE_DATABASE_URL_DEV sudah di-set — seharusnya URL tersebut yang dipakai.");
  process.exit(1);
}

// ── Guard: prod tidak boleh pakai DEV ref ───────────────────────────────────
if (targetEnv === "production" && !isPointingToProd && projectRef) {
  console.error(`[verify-db] FATAL: Target=PROD tapi URL mengarah ke project non-PROD (${projectRef}).`);
  console.error(`[verify-db] SUPABASE_DATABASE_URL harus mengarah ke project PROD (${PROD_PROJECT_REF}).`);
  process.exit(1);
}

// ── Guard: migration URL harus cocok dengan target dan memakai port 5432 ──────
if (migrationUrl) {
  if (targetEnv === "development" && migrationIsProd) {
    console.error("[verify-db] FATAL: DEV migration URL mengarah ke PROD project.");
    console.error("[verify-db] SUPABASE_MIGRATION_URL harus mengarah ke project DEV.");
    process.exit(1);
  }
  if (targetEnv === "development" && migrationPort !== "5432") {
    console.error("[verify-db] FATAL: DEV migration URL harus memakai port 5432 (session/direct mode).");
    process.exit(1);
  }
  if (targetEnv === "production" && migrationProjectRef !== PROD_PROJECT_REF) {
    console.error(`[verify-db] FATAL: PROD migration URL harus mengarah ke project PROD (${PROD_PROJECT_REF}).`);
    process.exit(1);
  }
  if (targetEnv === "production" && migrationPort !== "5432") {
    console.error("[verify-db] FATAL: PROD migration URL harus memakai port 5432 (session/direct mode).");
    process.exit(1);
  }
}

// ── Koneksi test ─────────────────────────────────────────────────────────────
console.log("[verify-db] Mencoba koneksi ke DB...");
const client = new Client({
  connectionString: url,
  ssl: { rejectUnauthorized: false },
  connectionTimeoutMillis: 8_000,
});

let connected = false;
try {
  await client.connect();
  const res = await client.query("SELECT current_database() AS db, current_user AS usr, version() AS ver");
  const row = res.rows[0];
  console.log(`[verify-db] Koneksi OK`);
  console.log(`[verify-db]   database : ${row.db}`);
  console.log(`[verify-db]   user     : ${row.usr}`);
  console.log(`[verify-db]   pg ver   : ${row.ver.split(" ").slice(0, 2).join(" ")}`);
  connected = true;
} catch (err) {
  console.error(`[verify-db] Koneksi GAGAL: ${err.message}`);
} finally {
  client.end().catch(() => {});
}

if (!connected) process.exit(1);

// ── Summary ──────────────────────────────────────────────────────────────────
console.log("=".repeat(60));
console.log(`[verify-db] ✓ Target ${targetEnv.toUpperCase()} DB terverifikasi.`);
console.log("[verify-db] Aman untuk melanjutkan migration pada target ini.");
console.log("=".repeat(60));
