/**
 * integrationHealthWorker.ts
 *
 * Scheduled background worker — runs the integration health check every 6 hours.
 *
 * On each run:
 *   1. Calls runIntegrationHealthCheck() (shared service)
 *   2. Compares results with the previous snapshot
 *   3. If any integration flips pass → fail, sends a WA alert via Fonnte
 *   4. Persists the snapshot to integration_health_snapshots for dashboard queries
 *
 * Schedule: every 6 hours (CHECK_INTERVAL_MS = 6 * 60 * 60 * 1000).
 * The first run is delayed by INITIAL_DELAY_MS (default 3 min) to let the server
 * fully start before hammering external APIs.
 *
 * Env vars:
 *   INTEGRATION_HEALTH_INTERVAL_H  — override interval in hours (default 6)
 *   INTEGRATION_HEALTH_SKIP        — set to "true" to disable the worker entirely
 */

import { logger } from "./logger.js";
import {
  runIntegrationHealthCheck,
  detectStatusFlips,
  ensureIntegrationHealthTable,
  getLastHealthSnapshot,
  saveHealthSnapshot,
  type SmokeResult,
} from "./integrationHealthService.js";
import { sendWhatsApp } from "./fonnte.js";
import { getAdminWa } from "./adminWa.js";

const PREFIX = "[integrationHealth]";

// ── Config ─────────────────────────────────────────────────────────────────────

const INTERVAL_H = Math.max(
  1,
  parseInt(process.env.INTEGRATION_HEALTH_INTERVAL_H ?? "6", 10),
);
const CHECK_INTERVAL_MS = INTERVAL_H * 60 * 60 * 1000;
const INITIAL_DELAY_MS = 3 * 60 * 1000; // 3 min after startup

let isRunning = false;
let lastRunAt: Date | null = null;
let lastRunStatus: "ok" | "fail" | "error" | null = null;

// ── Alert ──────────────────────────────────────────────────────────────────────

async function sendFlipAlert(
  flips: Array<{ name: string; from: string; to: string; detail?: string }>,
): Promise<boolean> {
  const adminWa = await getAdminWa().catch(() => process.env.FONNTE_ADMIN_WA ?? "");
  if (!adminWa) {
    logger.warn(`${PREFIX} FONNTE_ADMIN_WA tidak dikonfigurasi — tidak bisa kirim alert`);
    return false;
  }

  const flipLines = flips
    .map(
      (f) =>
        `• *${f.name}*: ${f.from.toUpperCase()} → ${f.to.toUpperCase()}` +
        (f.detail ? `\n  _${f.detail.slice(0, 150)}_` : ""),
    )
    .join("\n");

  const now = new Date().toLocaleString("id-ID", { timeZone: "Asia/Jakarta" });
  const text =
    `🚨 *[Integration Health Alert]*\n\n` +
    `Terdeteksi ${flips.length} integrasi bermasalah:\n\n` +
    `${flipLines}\n\n` +
    `Waktu: ${now} WIB\n` +
    `Cek detail di Admin → System → Integration Health.`;

  try {
    await sendWhatsApp(adminWa, text, { context: "integration-health-alert" });
    logger.info({ flips: flips.map((f) => f.name), adminWa }, `${PREFIX} Alert WA terkirim`);
    return true;
  } catch (err) {
    logger.error({ err }, `${PREFIX} Gagal kirim alert WA`);
    return false;
  }
}

// ── Single check run ───────────────────────────────────────────────────────────

async function runCheck(): Promise<void> {
  if (isRunning) {
    logger.debug(`${PREFIX} Check sudah berjalan — skip`);
    return;
  }
  isRunning = true;

  try {
    logger.info(`${PREFIX} Memulai health check...`);

    // Load previous snapshot for diff comparison
    const previous = await getLastHealthSnapshot();
    const prevResults: Record<string, SmokeResult> | null = previous?.results ?? null;

    // Run the check
    const { results, allPassed, testedAt } = await runIntegrationHealthCheck();

    // Detect pass → fail flips
    const flips = detectStatusFlips(prevResults, results);
    let alertSent = false;

    if (flips.length > 0) {
      logger.warn({ flips }, `${PREFIX} ${flips.length} integrasi flip ke fail — kirim alert`);
      alertSent = await sendFlipAlert(flips);
    }

    // Persist to DB
    await saveHealthSnapshot(results, allPassed, alertSent);

    lastRunAt = new Date(testedAt);
    lastRunStatus = allPassed ? "ok" : "fail";

    const verdicts = Object.fromEntries(
      Object.entries(results).map(([k, v]) => [
        k,
        `${v.status === "pass" ? "✅" : v.status === "unconfigured" ? "⚠️" : "❌"} ${v.status.toUpperCase()}` +
          (v.latencyMs != null ? ` (${v.latencyMs}ms)` : ""),
      ]),
    );

    logger.info(
      { allPassed, flips: flips.length, alertSent, verdicts },
      `${PREFIX} Health check selesai`,
    );
  } catch (err) {
    lastRunStatus = "error";
    logger.error({ err }, `${PREFIX} Gagal menjalankan health check`);
  } finally {
    isRunning = false;
  }
}

// ── Worker export ──────────────────────────────────────────────────────────────

export function getIntegrationHealthWorkerStatus(): {
  lastRunAt: string | null;
  lastRunStatus: "ok" | "fail" | "error" | null;
  intervalH: number;
  isRunning: boolean;
} {
  return {
    lastRunAt: lastRunAt?.toISOString() ?? null,
    lastRunStatus,
    intervalH: INTERVAL_H,
    isRunning,
  };
}

export function startIntegrationHealthWorker(): void {
  if (process.env.INTEGRATION_HEALTH_SKIP === "true") {
    logger.info(`${PREFIX} INTEGRATION_HEALTH_SKIP=true — worker dinonaktifkan`);
    return;
  }

  // Ensure DB table exists (non-fatal)
  void ensureIntegrationHealthTable();

  // First run after initial delay
  setTimeout(() => {
    void runCheck();
    // Then repeat every INTERVAL_H hours
    setInterval(() => void runCheck(), CHECK_INTERVAL_MS).unref();
  }, INITIAL_DELAY_MS).unref();

  logger.info(
    { intervalH: INTERVAL_H, initialDelayMin: INITIAL_DELAY_MS / 60_000 },
    `${PREFIX} Worker dijadwalkan (setiap ${INTERVAL_H}j, mulai dalam ${INITIAL_DELAY_MS / 60_000} menit)`,
  );
}
