#!/usr/bin/env node
/**
 * Run all Drizzle SQL migrations against the dev database (SUPABASE_DATABASE_URL_DEV).
 * Uses pg directly to avoid drizzle-kit interactive prompts and psql timeouts.
 */
import pg from "pg";
import fs from "fs";
import path from "path";
import crypto from "crypto";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const MIGRATION_DIR = path.join(__dirname, "../lib/db/drizzle");

const DB_URL = process.env.SUPABASE_DATABASE_URL_DEV;
if (!DB_URL) {
  console.error("ERROR: SUPABASE_DATABASE_URL_DEV is not set");
  process.exit(1);
}

const pool = new pg.Pool({
  connectionString: DB_URL,
  ssl: { rejectUnauthorized: false },
  max: 1,
  connectionTimeoutMillis: 30000,
  idleTimeoutMillis: 60000,
});

async function ensureTrackingTable(client) {
  await client.query(`
    CREATE TABLE IF NOT EXISTS __drizzle_migrations (
      id SERIAL PRIMARY KEY,
      hash TEXT NOT NULL,
      created_at BIGINT NOT NULL
    )
  `);
  // Add unique constraint if missing (handles tables created by older script runs)
  try {
    await client.query(`
      ALTER TABLE __drizzle_migrations ADD CONSTRAINT __drizzle_migrations_hash_unique UNIQUE (hash)
    `);
  } catch (e) {
    // already exists — ignore
  }
}

async function isApplied(client, hash) {
  const res = await client.query(
    "SELECT 1 FROM __drizzle_migrations WHERE hash = $1",
    [hash]
  );
  return res.rowCount > 0;
}

async function markApplied(client, hash) {
  await client.query(
    "INSERT INTO __drizzle_migrations (hash, created_at) VALUES ($1, $2) ON CONFLICT (hash) DO NOTHING",
    [hash, Date.now()]
  );
}

async function runMigration(client, sqlContent) {
  // Split on --> statement-breakpoint marker
  const statements = sqlContent
    .split(/^--> statement-breakpoint\s*$/m)
    .map((s) => s.trim())
    .filter((s) => s.length > 0);

  let ok = 0;
  let skipped = 0;
  for (const stmt of statements) {
    try {
      await client.query(stmt);
      ok++;
    } catch (err) {
      const msg = err.message || "";
      // These are safe to ignore in idempotent migrations
      if (
        msg.includes("already exists") ||
        msg.includes("does not exist") ||
        msg.includes("duplicate key") ||
        msg.includes("already has a column named")
      ) {
        skipped++;
      } else {
        console.warn(`    [WARN] ${msg.substring(0, 120)}`);
        skipped++;
      }
    }
  }
  return { ok, skipped, total: statements.length };
}

async function main() {
  console.log("=== DEV Database Migration Runner ===\n");

  const client = await pool.connect();
  try {
    await ensureTrackingTable(client);

    const files = fs
      .readdirSync(MIGRATION_DIR)
      .filter((f) => f.endsWith(".sql"))
      .sort();

    let applied = 0;
    let skippedFiles = 0;

    for (const file of files) {
      const hash = crypto.createHash("sha256").update(file).digest("hex");
      if (await isApplied(client, hash)) {
        console.log(`  [SKIP] ${file}`);
        skippedFiles++;
        continue;
      }

      process.stdout.write(`  [RUN]  ${file} ... `);
      const sqlContent = fs.readFileSync(
        path.join(MIGRATION_DIR, file),
        "utf8"
      );
      const { ok, skipped, total } = await runMigration(client, sqlContent);
      await markApplied(client, hash);
      console.log(`done (${ok}/${total} ok, ${skipped} skipped)`);
      applied++;
    }

    console.log(
      `\n=== Done: ${applied} files applied, ${skippedFiles} already applied ===`
    );
  } finally {
    client.release();
    await pool.end();
  }
}

main().catch((err) => {
  console.error("FATAL:", err);
  process.exit(1);
});
