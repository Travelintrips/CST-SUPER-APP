/**
 * appConfig — baca config dari env var (prioritas), fallback ke tabel app_config DB.
 * Cache 60 detik agar tidak query DB setiap request.
 * Panggil invalidateAppConfig(key?) setelah update/delete di app_config table.
 */
import { db } from "@workspace/db";
import { sql } from "drizzle-orm";

const CACHE_TTL_MS = 60_000;
const _cache = new Map<string, { value: string; expiresAt: number }>();

export async function getAppConfig(key: string, fallback = ""): Promise<string> {
  const envVal = process.env[key]?.trim();
  if (envVal) return envVal;

  const cached = _cache.get(key);
  if (cached && Date.now() < cached.expiresAt) return cached.value;

  try {
    const res = await db.execute(sql`SELECT value FROM app_config WHERE key = ${key} LIMIT 1`);
    const val = ((res.rows[0] as any)?.value ?? "").trim();
    _cache.set(key, { value: val || fallback, expiresAt: Date.now() + CACHE_TTL_MS });
    return val || fallback;
  } catch {
    return fallback;
  }
}

export function invalidateAppConfig(key?: string) {
  if (key) _cache.delete(key);
  else _cache.clear();
}

/**
 * Sync read: cek env var lalu in-memory cache (tidak query DB).
 * Akurat setelah warm-up async pertama via getAppConfig(key).
 */
export function getCachedOrEnvConfig(key: string): string {
  const envVal = process.env[key]?.trim();
  if (envVal) return envVal;
  const cached = _cache.get(key);
  if (cached && Date.now() < cached.expiresAt) return cached.value;
  return "";
}

/**
 * Pre-populate cache untuk key-key penting agar sync-check bisa dipakai segera.
 * Panggil sekali di startup tanpa await.
 */
export async function warmAppConfig(keys: string[]): Promise<void> {
  await Promise.all(keys.map(k => getAppConfig(k).catch(() => {})));
}
