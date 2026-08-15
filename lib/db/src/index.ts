import { drizzle } from "drizzle-orm/node-postgres";
import pg from "pg";
import * as schema from "./schema";

const { Pool } = pg;

// ── Test-environment guard ────────────────────────────────────────────────────
// Must be resolved before any pool/probe code so every branch can use it.
function isTestEnvironment(): boolean {
  return (
    process.env.NODE_ENV === "test" ||
    process.env.VITEST === "true" ||
    process.env.VITEST_WORKER_ID !== undefined ||
    process.env.VITEST_POOL_ID !== undefined
  );
}

const IS_TEST = isTestEnvironment();

function resolveConnectionString(): string {
  const isProd = process.env.NODE_ENV === "production" || !!process.env.REPLIT_DEPLOYMENT;
  // PROD: hanya pakai SUPABASE_DATABASE_URL / DATABASE_URL / SUPABASE_PG_URL
  //       JANGAN fallback ke SUPABASE_DATABASE_URL_DEV di prod
  // DEV : gunakan URL database development/pooler yang di-inject sebagai
  // SUPABASE_DATABASE_URL_DEV atau canonical SUPABASE_DATABASE_URL.
  // Jangan memakai SUPABASE_MIGRATION_URL di sini: pada arsitektur secret
  // bersama, URL tersebut adalah direct connection production untuk tooling
  // migrasi dan dapat mengarahkan preview ke database yang salah/kehabisan
  // kapasitas. Runtime development harus tetap berada di database dev.
  const candidates = isProd
    ? [
        process.env.SUPABASE_DATABASE_URL,
        process.env.DATABASE_URL,
        process.env.SUPABASE_PG_URL,
      ]
    : [
        process.env.SUPABASE_DATABASE_URL_DEV,
        process.env.SUPABASE_DATABASE_URL,
        process.env.DATABASE_URL,
      ];

  for (const url of candidates) {
    if (url && /^postgres(?:ql)?:\/\//i.test(url)) {
      const label = isProd ? "production" : "development";
      const masked = url.replace(/\/\/[^@]+@/, "//***@").split("?")[0];
      console.log(`[db] env=${label} → ${masked}`);
      return url;
    }
  }

  throw new Error(
    isProd
      ? "No valid PostgreSQL connection string found. Set SUPABASE_DATABASE_URL."
      : "No valid PostgreSQL connection string found. Set SUPABASE_MIGRATION_URL or SUPABASE_DATABASE_URL_DEV (or SUPABASE_DATABASE_URL for shared-DB mode).",
  );
}

const connectionString = resolveConnectionString();
const isLocalConn = /localhost|127\.0\.0\.1|helium/.test(connectionString);
const isProdEnv = process.env.NODE_ENV === "production" || !!process.env.REPLIT_DEPLOYMENT;
// In VITEST / NODE_ENV=test: enable allowExitOnIdle so the pool never prevents
// the process from exiting when all tests finish. This only affects idle clients;
// active connections still work normally.
const isTestEnv = process.env.VITEST === "true" || process.env.NODE_ENV === "test";

// Pool config — configurable via env vars.
// Dev default: max=8 (the artifact dev workflow overrides this to 4 so
// interactive requests have capacity while serial startup migrations run)
// Prod default: max=2 (reduced to avoid pgBouncer auth-failure throttle)
// Test: max=2, allowExitOnIdle=true so the pool never keeps the process alive

// Dev default: max=8 (fewer connections to reduce pgBouncer pressure)
// Prod default: max=2 (reduced to avoid pgBouncer auth-failure throttle)
// Test default: max=3, shorter timeouts, allowExitOnIdle=true
const PG_POOL_MAX = process.env.PG_POOL_MAX
  ? Math.max(1, parseInt(process.env.PG_POOL_MAX))
  : isProdEnv ? 2 : (isTestEnv ? 3 : 8);
const PG_IDLE_TIMEOUT_MS = process.env.PG_IDLE_TIMEOUT_MS
  ? parseInt(process.env.PG_IDLE_TIMEOUT_MS)
  : isTestEnv ? 1_000 : 30_000;
const PG_CONNECTION_TIMEOUT_MS = process.env.PG_CONNECTION_TIMEOUT_MS
  ? parseInt(process.env.PG_CONNECTION_TIMEOUT_MS)
  : 8_000;

export function getPoolConfig(): {
  max: number;
  connectionTimeoutMs: number;
  idleTimeoutMs: number;
} {
  return {
    max: PG_POOL_MAX,
    connectionTimeoutMs: PG_CONNECTION_TIMEOUT_MS,
    idleTimeoutMs: PG_IDLE_TIMEOUT_MS,
  };
}

if (!IS_TEST) {
  console.log(
    `[db] pool config — max=${PG_POOL_MAX}, connTimeout=${PG_CONNECTION_TIMEOUT_MS}ms, idleTimeout=${PG_IDLE_TIMEOUT_MS}ms`,
  );
}

export const pool = new Pool({
  connectionString,
  ssl: isLocalConn ? false : { rejectUnauthorized: false },
  max: PG_POOL_MAX,
  min: 0,
  idleTimeoutMillis: PG_IDLE_TIMEOUT_MS,
  connectionTimeoutMillis: PG_CONNECTION_TIMEOUT_MS,
  keepAlive: !isTestEnv,
  keepAliveInitialDelayMillis: 10_000,
  // In test mode: allow the process to exit when all pool clients are idle.
  // In production: keep the pool alive (allowExitOnIdle: false) so the server
  // is not killed between requests during quiet periods.
  allowExitOnIdle: isTestEnv,
  // Ensure search_path is always set — pgBouncer in transaction mode may drop it.
  // lock_timeout prevents startup DDL migrations from hanging forever when a
  // previous killed instance left an open lock on the same table.
  options: '-c search_path=public -c lock_timeout=15000',
});

// ── endPool ───────────────────────────────────────────────────────────────────
// Idempotent: safe to call multiple times or when no connection has been made.
// Must be called in Vitest setupFiles/afterAll for any test that uses the DB.
// The pool reference is NOT replaced after end() — pg-pool is internally safe
// to call end() multiple times (second call resolves immediately).
let _poolEnded = false;
export async function endPool(): Promise<void> {
  if (_poolEnded) return;
  _poolEnded = true;
  try {
    await pool.end();
  } catch {
    // Ignore "pool has already ended" or any other error
  }
}

// Supabase PgBouncer pooler does not preserve search_path across connections.
// Explicitly set search_path=public on every new connection so unqualified
// table names (e.g. "companies") resolve correctly.
if (!isLocalConn) {
  pool.on("connect", (client) => {
    // A duplicate development API can otherwise hold DDL locks indefinitely
    // while the primary instance is running the same startup migration chain.
    // Keep this fail-safe even though start-dev.sh now yields redundant API
    // workflows before they can connect to the database.
    client
      .query("SET search_path = public; SET lock_timeout = '20s'")
      .catch(() => {});
    // Set search_path — PgBouncer transaction mode does not preserve it
    // Set lock_timeout — prevents startup DDL migrations from hanging forever
    // when a previously killed instance left an open lock on the same table.
    client.query("SET search_path = public; SET lock_timeout = '20s'").catch(() => {});
  });
}

// ── Pool-level ECIRCUITBREAKER guard ────────────────────────────────────────
// Ketika pgBouncer memblokir koneksi karena terlalu banyak auth failure,
// setiap retry dari background workers justru memperpanjang block.
// Guard ini: ketika ECIRCUITBREAKER terdeteksi, semua koneksi baru ditolak
// secara lokal selama 5 menit agar pgBouncer punya waktu reset sendiri.

// Dev: 55 detik — backoff attempt ke-4 (60s) melebihi cooldown sehingga loop CB → retry berhenti
// Prod: 5 menit — cukup untuk recovery normal
const ECB_PAUSE_MS = isProdEnv ? 5 * 60 * 1000 : 55 * 1000;
let ecbBlockedUntil = 0;
let ecbLastTrigger: { source: string; message: string; openedAt: string } | null = null;

function isEcbError(err: unknown): boolean {
  const msg = (err as any)?.message ?? "";
  const cause = (err as any)?.cause?.message ?? "";
  return (
    msg.includes("ECIRCUITBREAKER") ||
    cause.includes("ECIRCUITBREAKER")
  );
}

function setEcbBlock(source: string, originalErr?: unknown) {
  const now = Date.now();
  if (now >= ecbBlockedUntil) {
    ecbBlockedUntil = now + ECB_PAUSE_MS;
    const resume = new Date(ecbBlockedUntil).toISOString();
    const openedAt = new Date(now).toISOString();
    // Ambil pesan asli dari pgBouncer/pg, bukan dari error lokal kita
    const rawMsg =
      (originalErr as any)?.cause?.message ||
      (originalErr as any)?.message ||
      "(tidak ada detail)";
    ecbLastTrigger = { source, message: rawMsg, openedAt };
    console.warn(
      `[db pool] ECIRCUITBREAKER dari '${source}' — blokir koneksi baru sampai ${resume}`,
      { rawMsg },
    );
  }
}

function makeEcbError(): Error {
  const remaining = Math.ceil((ecbBlockedUntil - Date.now()) / 1000);
  return Object.assign(
    new Error(
      `(ECIRCUITBREAKER) too many authentication failures, new connections are temporarily blocked (local cooldown ${remaining}s)`,
    ),
    { code: "ECIRCUITBREAKER_LOCAL" },
  );
}

// Patch pool.connect — handle BOTH callback mode (used by pool.query internally)
// AND promise mode (used by external callers).
const _origConnect = pool.connect.bind(pool);
(pool as any).connect = function connect(
  this: typeof pool,
  ...args: unknown[]
): unknown {
  // If locally blocked, reject immediately without touching pgBouncer
  if (Date.now() < ecbBlockedUntil) {
    const ecbErr = makeEcbError();
    // Check for callback (pg-pool callback convention: last arg is function)
    const lastArg = args[args.length - 1];
    if (typeof lastArg === "function") {
      const cb = lastArg as (err: Error, client?: unknown, done?: unknown) => void;
      process.nextTick(() => cb(ecbErr));
      return undefined;
    }
    return Promise.reject(ecbErr);
  }

  // Has callback → wrap the callback to detect ECB errors
  const lastArg = args[args.length - 1];
  if (typeof lastArg === "function") {
    const origCb = lastArg as (err: Error | null, client?: unknown, done?: unknown) => void;
    const newArgs = [...args.slice(0, -1), function wrappedCb(
      err: Error | null,
      client: unknown,
      done: unknown,
    ) {
      if (err && isEcbError(err)) setEcbBlock("pool.connect-cb", err);
      return origCb(err, client, done);
    }];
    return _origConnect.apply(pool, newArgs as any);
  }

  // Promise mode
  const result = _origConnect.apply(pool, args as any) as unknown as Promise<unknown>;
  if (result && typeof result.catch === "function") {
    return result.catch((err: unknown) => {
      if (isEcbError(err)) setEcbBlock("pool.connect-promise", err);
      throw err;
    });
  }
  return result;
};

pool.on("error", (err) => {
  if (isEcbError(err)) {
    setEcbBlock("pool idle error", err);
  } else {
    console.error("[pg pool] Idle client error (non-fatal):", err.message);
  }
});

// ── Startup probe (TOP-LEVEL AWAIT) ──────────────────────────────────────────

// Skipped entirely in test environments — probing a real DB during unit tests
// is slow, opens an extra connection, and can leave open handles if the temp
// pool is not properly drained before the test runner tries to exit.
// Probe pgBouncer dengan raw pool (tanpa CB patch) SEBELUM modul ini resolve export-nya.
// Menggunakan file-based CB (/tmp/db-startup-cb.json) agar antar-process (crash loop)
// tidak terus memukul Supabase pgBouncer dengan auth failures berulang.
// Jika file CB masih segar (< ECB_PAUSE_MS), skip probe dan pakai data dari file.
// In test mode: skip probe entirely — tests manage their own DB lifecycle.
// Skipped entirely in test environments — probing a real DB during unit tests
// is slow, opens an extra connection, and can leave open handles if the temp
// pool is not properly drained before the test runner tries to exit.
const CB_FILE = "/tmp/db-startup-cb.json";

await (async function startupProbe() {
  // Skip probe in test environments to avoid unnecessary connections and delays.
  if (isTestEnv) return;
  try {
    // Cek file-based CB (shared antar process restart)
    let skipProbe = false;
    try {
      const fs = await import("node:fs");
      if (fs.existsSync(CB_FILE)) {
        const raw = fs.readFileSync(CB_FILE, "utf-8");
        const saved = JSON.parse(raw) as { blockedUntil: number; message: string };
        if (Date.now() < saved.blockedUntil) {
          const remaining = Math.ceil((saved.blockedUntil - Date.now()) / 1000);
          console.warn(
            `[db startup probe] Skipping probe — file CB aktif (${remaining}s tersisa). ` +
            `Pesan sebelumnya: ${saved.message.slice(0, 80)}`
          );
          setEcbBlock("startup-probe-file-cb", { message: saved.message });
          skipProbe = true;
        } else {
          fs.unlinkSync(CB_FILE);
        }
      }
    } catch {
      // Abaikan error baca file
    }

    if (skipProbe) return;

    const tempPool = new Pool({
      connectionString,
      ssl: isLocalConn ? false : { rejectUnauthorized: false },
      max: 1,
      connectionTimeoutMillis: 4_000,
    });
    try {
      await tempPool.query("SELECT 1");
      console.log("[db startup probe] pgBouncer OK — DB siap, tidak ada pre-existing throttle");
      // Hapus file CB jika ada (sukses)
      try {
        const fs = await import("node:fs");
        if (fs.existsSync(CB_FILE)) fs.unlinkSync(CB_FILE);
      } catch { /* ignore */ }
    } catch (err: unknown) {
      const msg = String((err as any)?.message ?? "");
      // Hanya set CB untuk error throttling pgBouncer, BUKAN credential biasa.
      // "password authentication failed" adalah salah konfigurasi, bukan throttle —
      // jangan blokir semua query hanya karena probe memakai URL yang salah.
      const isPgBouncerThrottle =
        msg.includes("ECIRCUITBREAKER") ||
        msg.includes("too many authentication failures");
      if (isPgBouncerThrottle) {
        setEcbBlock("startup-probe", err);
        console.warn(
          "[db startup probe] pgBouncer throttle saat startup — CB lokal diset (" +
          msg.slice(0, 80) + "). " +
          "Top-level DB calls ditolak lokal selama " + Math.round(ECB_PAUSE_MS / 1000) + "s."
        );
        // Tulis file CB agar process berikutnya tidak retry selama ECB_PAUSE_MS
        try {
          const fs = await import("node:fs");
          fs.writeFileSync(CB_FILE, JSON.stringify({
            blockedUntil: Date.now() + ECB_PAUSE_MS,
            message: msg,
          }));
        } catch { /* ignore */ }
      } else {
        // Credential error atau DB tidak tersedia — log saja, jangan blokir semua query
        console.warn("[db startup probe] DB tidak tersedia saat startup:", msg.slice(0, 120));
      }
    } finally {
      tempPool.end().catch(() => {});
    }
  } catch {
    // Jangan crash server jika probe gagal
  }
})();

export const db = drizzle(pool, { schema });

export * from "./schema";

/** Baca status circuit breaker saat ini (untuk diagnostik, tidak memerlukan koneksi DB). */
export function getCircuitBreakerStatus(): {
  open: boolean;
  openedAt: string | null;
  remainingCooldownSeconds: number;
  lastTrigger: { source: string; message: string; openedAt: string } | null;
} {
  const now = Date.now();
  const open = now < ecbBlockedUntil;
  return {
    open,
    openedAt: open ? new Date(ecbBlockedUntil - ECB_PAUSE_MS).toISOString() : null,
    remainingCooldownSeconds: open ? Math.ceil((ecbBlockedUntil - now) / 1000) : 0,
    lastTrigger: ecbLastTrigger,
  };
}

/**
 * Reset circuit breaker secara manual (admin only).
 * Hanya berguna setelah root cause sudah diperbaiki (password/credentials fixed).
 * Jangan reset jika credentials masih salah — CB akan terbuka lagi segera.
 */
export function resetCircuitBreaker(): void {
  ecbBlockedUntil = 0;
  ecbLastTrigger = null;
  console.warn("[db pool] Circuit breaker di-RESET secara manual oleh admin.");
}

/** Pool stats snapshot — tidak memerlukan koneksi baru. */
export function getPoolStats(): {
  totalCount: number;
  idleCount: number;
  waitingCount: number;
} {
  return {
    totalCount: pool.totalCount,
    idleCount: pool.idleCount,
    waitingCount: pool.waitingCount,
  };
}

/**
 * Ping DB secara langsung tanpa CB guard — hanya untuk health check startup.
 * Menggunakan koneksi sementara yang TIDAK melewati patch pool.connect,
 * sehingga hasil ping tidak akan membuka atau menutup circuit breaker lokal.
 * Timeout: 5 detik.
 */
export async function pingDbNoCb(): Promise<{ ok: boolean; latencyMs?: number; error?: string }> {
  const { Pool: RawPool } = await import("pg");
  const connectionString = resolveConnectionString();
  const isLocal = /localhost|127\.0\.0\.1|helium/.test(connectionString);
  const tempPool = new RawPool({
    connectionString,
    ssl: isLocal ? false : { rejectUnauthorized: false },
    max: 1,
    connectionTimeoutMillis: 5_000,
  });
  try {
    const t0 = Date.now();
    await tempPool.query("SELECT 1");
    return { ok: true, latencyMs: Date.now() - t0 };
  } catch (err: unknown) {
    return { ok: false, error: String((err as any)?.message ?? err).slice(0, 200) };
  } finally {
    tempPool.end().catch(() => {});
  }
}

/** Masked DB connection info untuk diagnostik. */
export function getActiveDbInfo(): {
  source: string;
  host: string;
  mode: string;
  pooler: boolean;
} {
  const isProd = process.env.NODE_ENV === "production" || !!process.env.REPLIT_DEPLOYMENT;
  const mode = isProd ? "production" : "development";

  // Resolve mana yang aktif (sama dengan resolveConnectionString, tapi read-only)
  const candidates = isProd
    ? [
        { key: "SUPABASE_DATABASE_URL", val: process.env.SUPABASE_DATABASE_URL },
        { key: "DATABASE_URL", val: process.env.DATABASE_URL },
      ]
    : [
        { key: "SUPABASE_DATABASE_URL_DEV", val: process.env.SUPABASE_DATABASE_URL_DEV },
        { key: "SUPABASE_DATABASE_URL", val: process.env.SUPABASE_DATABASE_URL },
        { key: "DATABASE_URL", val: process.env.DATABASE_URL },
      ];

  for (const c of candidates) {
    if (c.val && /^postgres(?:ql)?:\/\//i.test(c.val)) {
      const host = (c.val.match(/@([^:/]+)/) ?? [])[1] ?? "unknown";
      return {
        source: c.key,
        host,
        mode,
        pooler: host.includes("pooler") || host.includes("pgbouncer") || c.val.includes(":6543"),
      };
    }
  }

  return { source: "(none)", host: "unknown", mode, pooler: false };
}
