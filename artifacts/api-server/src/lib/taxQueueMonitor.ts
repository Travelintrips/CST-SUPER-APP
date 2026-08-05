import { registerHeartbeat, beat } from "./workerHeartbeat.js";

/**
 * taxQueueMonitor — background worker yang memeriksa tabel fallback setiap 15 menit.
 *
 * Memeriksa:
 *   1. tax_capture_queue     — entries PENDING lebih dari STALE_THRESHOLD_MINUTES menit
 *   2. tax_audit_log_failures — entries baru dalam 1 jam terakhir
 *
 * Jika ada, kirim criticalAlert ke grup admin via WhatsApp.
 *
 * Didaftarkan di index.ts menggunakan registerWorker() dengan delay 75 detik
 * (setelah DB pool stabil).
 */

import { db } from "@workspace/db";
import { sql } from "drizzle-orm";
import { logger } from "./logger.js";
import { criticalAlert } from "./criticalAlert.js";

const CHECK_INTERVAL_MS     = 15 * 60 * 1000; // 15 menit
const INITIAL_DELAY_MS      =  5 * 60 * 1000; //  5 menit — beri waktu DB stabilize
const STALE_THRESHOLD_MIN   = 30;             // menit

async function checkTaxCaptureQueue(): Promise<void> {
  const result = await db.execute(sql`
    SELECT COUNT(*) AS cnt
    FROM tax_capture_queue
    WHERE status = 'pending'
      AND created_at < NOW() - (${STALE_THRESHOLD_MIN} || ' minutes')::INTERVAL
  `).catch(() => null);

  if (!result) return;

  const cnt = Number((result.rows[0] as any)?.cnt ?? 0);
  if (cnt > 0) {
    await criticalAlert(
      `${cnt} tax capture entry masih PENDING di antrian setelah >${STALE_THRESHOLD_MIN} menit — retry manual diperlukan`,
      {
        table:            "tax_capture_queue",
        pendingCount:     cnt,
        thresholdMinutes: STALE_THRESHOLD_MIN,
        action:           "Periksa tabel tax_capture_queue dan jalankan retry atau eskalasi ke tim finance.",
      },
    );
  }
}

async function checkAuditLogFailures(): Promise<void> {
  const result = await db.execute(sql`
    SELECT COUNT(*) AS cnt
    FROM tax_audit_log_failures
    WHERE created_at > NOW() - INTERVAL '1 hour'
  `).catch(() => null);

  if (!result) return;

  const cnt = Number((result.rows[0] as any)?.cnt ?? 0);
  if (cnt > 0) {
    await criticalAlert(
      `${cnt} tax audit log GAGAL tersimpan dalam 1 jam terakhir — data audit mungkin tidak lengkap`,
      {
        table:  "tax_audit_log_failures",
        count:  cnt,
        period: "1 hour",
        action: "Periksa tabel tax_audit_log_failures dan migrasikan data ke tax_audit_logs secara manual.",
      },
    );
  }
}

async function runChecks(): Promise<void> {
  await checkTaxCaptureQueue().catch((e) =>
    logger.warn({ err: e }, "[taxQueueMonitor] checkTaxCaptureQueue gagal"),
  );
  await checkAuditLogFailures().catch((e) =>
    logger.warn({ err: e }, "[taxQueueMonitor] checkAuditLogFailures gagal"),
  );
}

export function startTaxQueueMonitor(): void {
  registerHeartbeat("tax-queue-monitor", CHECK_INTERVAL_MS);
  // Delay awal agar DB pool stabil sebelum mulai query
  setTimeout(() => {
    beat("tax-queue-monitor");
    runChecks().catch((e) =>
      logger.warn({ err: e }, "[taxQueueMonitor] Initial check gagal (non-fatal)"),
    );
    setInterval(() => {
      beat("tax-queue-monitor");
      runChecks().catch((e) =>
        logger.warn({ err: e }, "[taxQueueMonitor] Periodic check gagal (non-fatal)"),
      );
    }, CHECK_INTERVAL_MS).unref();
  }, INITIAL_DELAY_MS).unref();

  logger.info("[taxQueueMonitor] Started — akan memeriksa queue setiap 15 menit");
}
