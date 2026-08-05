/**
 * configBootstrap — Loader konfigurasi dari file .env dan Supabase app_config.
 *
 * Urutan prioritas (tidak menimpa yang sudah ada):
 *   1. Replit Secrets / sistem (sudah ada di process.env sebelum server start)
 *   2. File .env di root project (plain text, bisa diedit langsung)
 *   3. Tabel app_config di Supabase (fallback untuk project baru dari GitHub)
 *
 * Untuk project baru dari GitHub, minimal hanya perlu:
 *   - SUPABASE_DATABASE_URL  (untuk koneksi ke Supabase)
 *
 * Gunakan raw `pg` (bukan drizzle) karena drizzle sendiri butuh env var
 * yang mungkin belum tersedia sebelum bootstrap selesai.
 */

import { Client } from "pg";
import fs from "fs";
import path from "path";

/**
 * Parse dan load file .env ke process.env.
 * Hanya mengisi key yang belum ada di process.env (tidak menimpa).
 */
function loadDotEnvFile(): { loaded: number; skipped: number } {
  const result = { loaded: 0, skipped: 0 };

  // Cari .env di root project (2 level up dari artifacts/api-server/src/lib/)
  const candidates = [
    path.resolve(process.cwd(), ".env"),
    path.resolve(__dirname, "../../../../.env"),
    path.resolve(__dirname, "../../../../../.env"),
  ];

  let envPath: string | null = null;
  for (const p of candidates) {
    if (fs.existsSync(p)) { envPath = p; break; }
  }

  if (!envPath) {
    // .env tidak ada — skip (normal untuk production / Replit Secrets sudah cukup)
    return result;
  }

  const raw = fs.readFileSync(envPath, "utf8");
  const lines = raw.split(/\r?\n/);

  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;

    const eqIdx = trimmed.indexOf("=");
    if (eqIdx === -1) continue;

    const key = trimmed.slice(0, eqIdx).trim();
    let val  = trimmed.slice(eqIdx + 1).trim();

    if (!key) continue;

    // Hapus quote luar jika ada (single atau double)
    if ((val.startsWith('"') && val.endsWith('"')) ||
        (val.startsWith("'") && val.endsWith("'"))) {
      val = val.slice(1, -1)
        .replace(/\\n/g, "\n")
        .replace(/\\"/g, '"')
        .replace(/\\'/g, "'");
    }

    if (process.env[key] !== undefined && process.env[key] !== "") {
      result.skipped++;
    } else if (val) {
      process.env[key] = val;
      result.loaded++;
    }
  }

  console.log(
    `[configBootstrap] 📄 .env loaded: ${result.loaded} key dari ${envPath}` +
    (result.skipped > 0 ? ` (${result.skipped} sudah ada di env — tidak ditimpa)` : "")
  );
  return result;
}

interface ConfigRow {
  key: string;
  value: string | null;
}

const BOOTSTRAP_SOURCES = [
  process.env.SUPABASE_MIGRATION_URL,
  process.env.SUPABASE_DATABASE_URL,
  process.env.SUPABASE_DATABASE_URL_DEV,
];

function getBootstrapUrl(): string | null {
  for (const url of BOOTSTRAP_SOURCES) {
    if (url && /^postgres(ql)?:\/\//i.test(url)) return url;
  }
  return null;
}

export async function bootstrapConfigFromSupabase(): Promise<{
  loaded: number;
  skipped: number;
  errors: string[];
}> {
  const result = { loaded: 0, skipped: 0, errors: [] as string[] };

  // Langkah 1: Load dari file .env (plain text) — tidak menimpa env yang sudah ada
  loadDotEnvFile();

  // Langkah 2: Load dari Supabase app_config — fallback untuk key yang masih kosong
  const url = getBootstrapUrl();
  if (!url) {
    console.warn("[configBootstrap] Tidak ada Supabase URL — skip bootstrap. " +
      "Set SUPABASE_DATABASE_URL untuk load config otomatis.");
    return result;
  }

  const client = new Client({
    connectionString: url,
    ssl: { rejectUnauthorized: false },
    connectionTimeoutMillis: 8000,
    statement_timeout: 5000,
  });

  try {
    await client.connect();

    // Cek apakah tabel ada
    const tableCheck = await client.query<{ exists: boolean }>(
      `SELECT EXISTS (
         SELECT 1 FROM information_schema.tables
         WHERE table_schema = 'public' AND table_name = 'app_config'
       ) AS exists`
    );
    if (!tableCheck.rows[0]?.exists) {
      console.warn("[configBootstrap] Tabel app_config belum ada di DB — skip bootstrap.");
      return result;
    }

    const rows = await client.query<ConfigRow>(
      `SELECT key, value FROM app_config WHERE value IS NOT NULL AND value <> ''`
    );

    for (const { key, value } of rows.rows) {
      if (!key || !value) continue;

      if (process.env[key] !== undefined && process.env[key] !== "") {
        // Sudah ada di env (Replit Secret / sistem) — tidak ditimpa
        result.skipped++;
      } else {
        process.env[key] = value;
        result.loaded++;
      }
    }

    console.log(
      `[configBootstrap] ✅ Loaded ${result.loaded} config keys from Supabase` +
      (result.skipped > 0 ? ` (${result.skipped} already set in env — kept)` : "")
    );
  } catch (err: any) {
    const msg = err?.message ?? String(err);
    result.errors.push(msg);
    console.warn(`[configBootstrap] ⚠️  Gagal load config dari Supabase: ${msg}`);
    console.warn("[configBootstrap]    Server tetap jalan dengan env var yang tersedia.");
  } finally {
    try { await client.end(); } catch {}
  }

  return result;
}
