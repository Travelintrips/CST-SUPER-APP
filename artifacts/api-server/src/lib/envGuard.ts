/**
 * envGuard.ts — DB DEV/PROD safety guard
 *
 * Aturan:
 *   DEV  wajib pakai SUPABASE_DATABASE_URL_DEV (jika di-set)
 *   PROD wajib pakai SUPABASE_DATABASE_URL
 *   Tidak boleh fallback otomatis dari DEV ke PROD
 *   Jika DEV env mengarah ke PROD project ref → throw (jika DEV URL tersedia)
 *   Jika PROD env URL kosong → throw
 */

// Read from env var so the value can be overridden per-deployment without touching code.
// The hardcoded fallback keeps existing behaviour when the env var is not set.
export const PROD_PROJECT_REF =
  process.env.SUPABASE_PROD_PROJECT_REF ?? "nzdweipzckfszczzqtuw";

/**
 * Ekstrak Supabase project ref dari connection URL.
 * Format Supabase pooler: postgres://postgres.<ref>:<pass>@host:6543/postgres
 * Format direct:           postgres://postgres:<pass>@db.<ref>.supabase.co:5432/postgres
 */
export function extractProjectRef(url: string): string | null {
  // Pooler URL: postgres.{ref}:
  const poolerMatch = url.match(/postgres(?:ql)?:\/\/[^.]+\.([a-z0-9]+):/i);
  if (poolerMatch) return poolerMatch[1];
  // Direct URL: db.{ref}.supabase.co
  const directMatch = url.match(/db\.([a-z0-9]+)\.supabase\.co/i);
  if (directMatch) return directMatch[1];
  return null;
}

export function isProdUrl(url: string): boolean {
  const ref = extractProjectRef(url);
  return ref === PROD_PROJECT_REF;
}

export interface EnvGuardResult {
  ok: boolean;
  env: "production" | "development";
  projectRef: string | null;
  isPointingToProd: boolean;
  message: string;
}

/**
 * Validasi environment DB.
 * @param connectionString URL koneksi yang sedang dipakai
 * @param strict Jika true: throw on mismatch. Jika false: warn only.
 */
export function validateDbEnvironment(
  connectionString: string,
  strict = false,
): EnvGuardResult {
  const isDeployment = !!process.env.REPLIT_DEPLOYMENT;
  const isProd =
    process.env.NODE_ENV === "production" || isDeployment;
  const env = isProd ? "production" : "development";

  const projectRef = extractProjectRef(connectionString);
  const isPointingToProd = projectRef === PROD_PROJECT_REF;
  const hasDevUrl = !!process.env.SUPABASE_DATABASE_URL_DEV?.trim();

  // Log project ref saat startup
  console.log(
    `[envGuard] env=${env} | project_ref=${projectRef ?? "unknown"} | prod_ref=${PROD_PROJECT_REF} | pointing_to_prod=${isPointingToProd}`,
  );

  // PROD: URL kosong → error
  if (isProd && !connectionString) {
    const msg =
      "[envGuard] FATAL: NODE_ENV=production tapi SUPABASE_DATABASE_URL kosong.";
    if (strict) throw new Error(msg);
    console.error(msg);
    return { ok: false, env, projectRef, isPointingToProd, message: msg };
  }

  // DEV mengarah ke PROD ref, dan SUPABASE_DATABASE_URL_DEV sudah di-set
  // → ini kecelakaan (harusnya pakai DEV URL)
  if (!isProd && isPointingToProd && hasDevUrl) {
    const msg =
      `[envGuard] FATAL: NODE_ENV=development tapi DB mengarah ke PROD project (${PROD_PROJECT_REF}). ` +
      `SUPABASE_DATABASE_URL_DEV sudah di-set — gunakan URL tersebut untuk dev.`;
    if (strict) throw new Error(msg);
    console.error(msg);
    return { ok: false, env, projectRef, isPointingToProd, message: msg };
  }

  // DEV mengarah ke PROD ref, tapi SUPABASE_DATABASE_URL_DEV belum di-set
  // → shared-DB mode, boleh tapi warn
  if (!isProd && isPointingToProd && !hasDevUrl) {
    console.warn(
      `[envGuard] WARNING: dev env menggunakan shared PROD DB (${PROD_PROJECT_REF}). ` +
      `Set SUPABASE_DATABASE_URL_DEV ke project terpisah untuk isolasi DEV/PROD.`,
    );
  }

  const message = `[envGuard] OK: env=${env}, project_ref=${projectRef ?? "unknown"}`;
  console.log(message);
  return { ok: true, env, projectRef, isPointingToProd, message };
}

/**
 * Strict guard untuk migration scripts.
 * Harus dipanggil sebelum menjalankan migration apa pun.
 * Throw jika target DB tidak sesuai dengan NODE_ENV.
 */
export function assertMigrationTarget(
  connectionString: string,
  expectedEnv: "development" | "production",
): void {
  const actualProd =
    process.env.NODE_ENV === "production" || !!process.env.REPLIT_DEPLOYMENT;
  const actualEnv = actualProd ? "production" : "development";

  if (actualEnv !== expectedEnv) {
    throw new Error(
      `[envGuard] Migration target mismatch: expected=${expectedEnv}, actual=${actualEnv}. ` +
      `Pastikan NODE_ENV dan URL yang dipakai sesuai.`,
    );
  }

  const result = validateDbEnvironment(connectionString, true);
  if (!result.ok) {
    throw new Error(result.message);
  }

  // Tambahan: jika expectedEnv=development tapi URL mengarah ke PROD → selalu throw
  if (expectedEnv === "development" && result.isPointingToProd) {
    throw new Error(
      `[envGuard] FATAL: Migration DEV mencoba menulis ke PROD DB (${PROD_PROJECT_REF}). DIBATALKAN.`,
    );
  }
}
