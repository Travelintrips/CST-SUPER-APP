/**
 * startupOrchestrator.ts
 *
 * Mencegah ECIRCUITBREAKER saat startup dengan menstagger semua background worker.
 *
 * Tanpa orchestrator: semua worker langsung query DB secara bersamaan → burst koneksi
 * ke pgBouncer pooler → "too many authentication failures" → ECIRCUITBREAKER.
 *
 * Dengan orchestrator: setiap worker dijalankan dengan delay yang berbeda, sehingga
 * beban ke pgBouncer tersebar sepanjang waktu startup.
 *
 * Env vars:
 *   DISABLE_BACKGROUND_WORKERS=true   — nonaktifkan semua worker
 *   STARTUP_WORKER_STAGGER_MS=1000    — skala semua delay (default 1000 = 1×)
 *   MAX_STARTUP_DB_TASKS=1            — (reserved, not yet enforced via semaphore)
 */

import { getCircuitBreakerStatus } from "@workspace/db";
import { logger } from "./logger.js";

// ── Types ─────────────────────────────────────────────────────────────────────

export type WorkerStatus =
  | "pending"
  | "scheduled"
  | "starting"
  | "running"
  | "skipped_cb"
  | "error"
  | "disabled";

export interface WorkerEntry {
  name: string;
  delayMs: number;
  scheduledAt: string | null;
  startedAt: string | null;
  lastRunAt: string | null;
  lastError: string | null;
  nextRetryAt: string | null;
  status: WorkerStatus;
  enabled: boolean;
}

type InternalEntry = WorkerEntry & { startFn: () => void };

// ── Config ────────────────────────────────────────────────────────────────────

const DISABLE_ALL =
  process.env.DISABLE_BACKGROUND_WORKERS === "true" ||
  process.env.SAFE_DEV_TEST_MODE === "true";

/**
 * STARTUP_WORKER_STAGGER_MS = scale factor (int, ms units).
 * Default 1000 → scale = 1.0 (delays as specified).
 * Set to 2000 → scale = 2.0 (all delays doubled, for very congested environments).
 * Set to 500  → scale = 0.5 (all delays halved, for fast local dev).
 */
const STAGGER_SCALE = Math.max(0.1, parseInt(process.env.STARTUP_WORKER_STAGGER_MS ?? "1000") / 1000);

// ── Internal state ────────────────────────────────────────────────────────────

const _registry = new Map<string, InternalEntry>();
let _allStarted = false;

// ── Helpers ───────────────────────────────────────────────────────────────────

function sleep(ms: number) {
  return new Promise<void>((r) => setTimeout(r, ms));
}

async function launchWorker(entry: InternalEntry): Promise<void> {
  if (!entry.enabled) return;

  // Wait until scheduled time
  const nowMs = Date.now();
  const scheduledMs = entry.scheduledAt ? new Date(entry.scheduledAt).getTime() : nowMs;
  const waitMs = Math.max(0, scheduledMs - nowMs);
  if (waitMs > 0) await sleep(waitMs);

  // ── CB guard ─────────────────────────────────────────────────────────────
  const cb = getCircuitBreakerStatus();
  if (cb.open) {
    const extraDelay = (cb.remainingCooldownSeconds + 5) * 1000;
    entry.status = "skipped_cb";
    entry.nextRetryAt = new Date(Date.now() + extraDelay).toISOString();
    logger.warn(
      { worker: entry.name, cbRemainingS: cb.remainingCooldownSeconds, retryInMs: extraDelay },
      "[startupOrchestrator] CB terbuka — menunda start worker"
    );
    await sleep(extraDelay);

    // Cek sekali lagi setelah cooldown
    const cb2 = getCircuitBreakerStatus();
    if (cb2.open) {
      entry.status = "error";
      entry.lastError =
        "Circuit breaker masih terbuka setelah cooldown — worker tidak dijalankan. Periksa credentials DB.";
      entry.nextRetryAt = null;
      logger.error({ worker: entry.name }, "[startupOrchestrator] " + entry.lastError);
      return;
    }
  }

  // ── Start ─────────────────────────────────────────────────────────────────
  logger.info({ worker: entry.name, scheduledDelay: entry.delayMs }, "[startupOrchestrator] Memulai worker");
  entry.status = "starting";
  entry.startedAt = new Date().toISOString();
  entry.nextRetryAt = null;

  try {
    entry.startFn();
    entry.status = "running";
    entry.lastRunAt = new Date().toISOString();
    entry.lastError = null;
    logger.info({ worker: entry.name }, "[startupOrchestrator] Worker berjalan");
  } catch (err) {
    entry.status = "error";
    entry.lastError = err instanceof Error ? err.message : String(err);
    logger.error({ worker: entry.name, err }, "[startupOrchestrator] Worker gagal start");
  }
}

// ── Public API ────────────────────────────────────────────────────────────────

/**
 * Daftarkan satu background worker.
 * Panggil ini SEBELUM startAll().
 *
 * @param name     Nama worker untuk logging & admin endpoint
 * @param startFn  Fungsi yang dipanggil untuk memulai worker (sync, langsung return)
 * @param delayMs  Delay dari server start sebelum worker dijalankan (basis, sebelum STAGGER_SCALE)
 */
export function registerWorker(name: string, startFn: () => void, delayMs: number): void {
  if (_allStarted) {
    logger.warn({ worker: name }, "[startupOrchestrator] registerWorker dipanggil setelah startAll — diabaikan");
    return;
  }
  _registry.set(name, {
    name,
    startFn,
    delayMs,
    scheduledAt: null,
    startedAt: null,
    lastRunAt: null,
    lastError: null,
    nextRetryAt: null,
    status: DISABLE_ALL ? "disabled" : "pending",
    enabled: !DISABLE_ALL,
  });
}

/**
 * Mulai semua worker yang sudah didaftarkan dengan stagger delay.
 * Panggil sekali dari startServer() setelah server.listen().
 */
export function startAll(): void {
  _allStarted = true;

  if (DISABLE_ALL) {
    logger.warn(
      { workerCount: _registry.size },
      "[startupOrchestrator] DISABLE_BACKGROUND_WORKERS=true — semua worker dinonaktifkan"
    );
    return;
  }

  const baseTime = Date.now();

  logger.info(
    { workerCount: _registry.size, staggerScale: STAGGER_SCALE },
    "[startupOrchestrator] Menjadwalkan worker dengan stagger delay"
  );

  for (const [, entry] of _registry) {
    if (!entry.enabled) continue;

    const effectiveDelay = Math.round(entry.delayMs * STAGGER_SCALE);
    entry.scheduledAt = new Date(baseTime + effectiveDelay).toISOString();
    entry.status = "scheduled";

    logger.info(
      {
        worker: entry.name,
        baseDelayMs: entry.delayMs,
        effectiveDelayMs: effectiveDelay,
        scheduledAt: entry.scheduledAt,
      },
      "[startupOrchestrator] Worker dijadwalkan"
    );

    // Async — non-blocking
    launchWorker(entry).catch((err) => {
      logger.error({ worker: entry.name, err }, "[startupOrchestrator] launchWorker error");
    });
  }
}

/**
 * Kembalikan snapshot state semua worker (untuk admin endpoint).
 */
export function getWorkerStates(): WorkerEntry[] {
  return Array.from(_registry.values()).map(({ startFn: _fn, ...rest }) => ({ ...rest }));
}
