/**
 * Automated daily database backup.
 *
 * - Runs pg_dump, gzips the output in-memory, uploads to Replit Object Storage
 *   under the private bucket at prefix `db-backups/`.
 * - Rotates: keeps only the last KEEP_BACKUPS files (default 7).
 * - Scheduled daily at 02:00 WIB (19:00 UTC). Can also be triggered on demand.
 * - Non-fatal: failures are logged but never crash the server.
 */

import { spawn } from "child_process";
import { gzip } from "zlib";
import { promisify } from "util";
import { createClient } from "@supabase/supabase-js";
import WebSocket from "ws";
import { logger } from "./logger.js";

const gzipAsync = promisify(gzip);

const KEEP_BACKUPS = 7;
const PG_DUMP_BIN = process.env["PG_DUMP_BIN"] ?? "pg_dump";
const BACKUP_HOUR_UTC = 19; // 02:00 WIB
const CHECK_INTERVAL_MS = 60 * 60 * 1000; // check every hour
const PRIVATE_BUCKET = "private-uploads";

let lastBackupDate = ""; // "YYYY-MM-DD" of last successful backup

// ── Supabase client ───────────────────────────────────────────────────────────
function getSupabase() {
  const rawKey = process.env.SUPABASE_SERVICE_ROLE_KEY ?? "";
  const devKey = process.env.SUPABASE_SERVICE_ROLE_KEY_DEV ?? "";
  const key = rawKey.length > 100 ? rawKey : devKey;

  const rawUrl = rawKey.length > 100
    ? (process.env.VITE_SUPABASE_URL ?? process.env.SUPABASE_URL ?? "")
    : (process.env.SUPABASE_URL_DEV ?? "").replace(/\/rest\/v1\/?$/, "");

  if (!rawUrl || !key) return null;
  const url = rawUrl.startsWith("https://") ? rawUrl : `https://${rawUrl}.supabase.co`;
  return createClient(url, key, {
    auth: { autoRefreshToken: false, persistSession: false },
    realtime: { transport: WebSocket as unknown as typeof globalThis.WebSocket },
  });
}

/** Run pg_dump and return stdout as a Buffer. */
function runPgDump(databaseUrl: string): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    const errChunks: Buffer[] = [];

    const proc = spawn(PG_DUMP_BIN, [
      "--format=plain",
      "--no-owner",
      "--no-acl",
      "--no-password",
      databaseUrl,
    ], { stdio: ["ignore", "pipe", "pipe"] });

    proc.stdout.on("data", (chunk: Buffer) => chunks.push(chunk));
    proc.stderr.on("data", (chunk: Buffer) => errChunks.push(chunk));

    proc.on("error", (err) => reject(err));
    proc.on("close", (code) => {
      if (code !== 0) {
        const stderr = Buffer.concat(errChunks).toString("utf8").slice(0, 500);
        reject(new Error(`pg_dump exited with code ${code}: ${stderr}`));
      } else {
        resolve(Buffer.concat(chunks));
      }
    });
  });
}

// ── core backup function ──────────────────────────────────────────────────────

export async function runDbBackup(): Promise<{ ok: boolean; key?: string; sizeKb?: number; error?: string }> {
  // Gunakan SUPABASE_DATABASE_URL (prod) atau SUPABASE_DATABASE_URL_DEV (dev)
  // DATABASE_URL lama sudah deprecated — hanya sebagai last-resort fallback.
  const isProd = process.env.NODE_ENV === "production" || !!process.env.REPLIT_DEPLOYMENT;
  const databaseUrl = isProd
    ? (process.env["SUPABASE_DATABASE_URL"] ?? process.env["DATABASE_URL"])
    : (process.env["SUPABASE_DATABASE_URL_DEV"] ?? process.env["SUPABASE_DATABASE_URL"] ?? process.env["DATABASE_URL"]);
  if (!databaseUrl) {
    logger.warn("DB backup: no database URL configured (SUPABASE_DATABASE_URL not set) — skipping");
    return { ok: false, error: "SUPABASE_DATABASE_URL not set" };
  }

  const sb = getSupabase();
  if (!sb) {
    logger.warn("DB backup: Supabase not configured — skipping");
    return { ok: false, error: "Supabase not configured" };
  }

  const now = new Date();
  const ts = now.toISOString().replace(/[:.]/g, "-").slice(0, 19);
  const filename = `backup-${ts}.sql.gz`;
  const objectName = `db-backups/${filename}`;

  logger.info({ filename }, "DB backup: starting pg_dump");

  try {
    const sqlBuffer = await runPgDump(databaseUrl);
    const gzBuffer = await gzipAsync(sqlBuffer);
    const sizeKb = Math.round(gzBuffer.byteLength / 1024);

    const { error: uploadErr } = await sb.storage
      .from(PRIVATE_BUCKET)
      .upload(objectName, gzBuffer, { contentType: "application/gzip", upsert: true });
    if (uploadErr) throw new Error(`Upload failed: ${uploadErr.message}`);

    logger.info({ filename, sizeKb }, "DB backup: uploaded successfully");

    // Rotate — delete old backups beyond KEEP_BACKUPS
    try {
      const { data: files } = await sb.storage.from(PRIVATE_BUCKET).list("db-backups");
      if (files) {
        const backupFiles = files
          .filter((f) => f.name.endsWith(".sql.gz"))
          .sort((a, b) => a.name.localeCompare(b.name));
        const toDelete = backupFiles
          .slice(0, Math.max(0, backupFiles.length - KEEP_BACKUPS))
          .map((f) => `db-backups/${f.name}`);
        if (toDelete.length > 0) {
          await sb.storage.from(PRIVATE_BUCKET).remove(toDelete);
          logger.info({ count: toDelete.length }, "DB backup: rotated old backups");
        }
      }
    } catch (rotateErr) {
      logger.warn({ err: rotateErr }, "DB backup: rotation failed (non-fatal)");
    }

    return { ok: true, key: objectName, sizeKb };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    logger.error({ err }, "DB backup: failed");
    return { ok: false, error: message };
  }
}

// ── scheduler ─────────────────────────────────────────────────────────────────

function todayUtc(): string {
  return new Date().toISOString().slice(0, 10); // "YYYY-MM-DD"
}

function currentHourUtc(): number {
  return new Date().getUTCHours();
}

export function startDbBackupScheduler(): void {
  const check = () => {
    const today = todayUtc();
    const hour = currentHourUtc();

    // Run if: correct hour AND not already run today
    if (hour === BACKUP_HOUR_UTC && lastBackupDate !== today) {
      lastBackupDate = today; // mark immediately to prevent duplicate runs
      logger.info({ date: today }, "DB backup: scheduled run starting");
      runDbBackup().catch((err) => logger.error({ err }, "DB backup: scheduler error"));
    }
  };

  // Check once now (in case server restarts during the backup window)
  check();
  setInterval(check, CHECK_INTERVAL_MS).unref();

  logger.info(
    { backupHourUtc: BACKUP_HOUR_UTC, keepBackups: KEEP_BACKUPS },
    "DB backup scheduler started (daily 02:00 WIB)"
  );
}
