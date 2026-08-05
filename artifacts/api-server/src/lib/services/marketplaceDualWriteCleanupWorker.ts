/**
 * marketplaceDualWriteCleanupWorker.ts — Phase 2A.2: Cleanup & Retention Report Worker
 *
 * ─── RETENTION POLICY ─────────────────────────────────────────────────────────
 *
 *   success / linked  → archive setelah 90 hari
 *   failed            → simpan minimum 1 tahun (365 hari)
 *   exhausted         → simpan sampai diselesaikan manual
 *                        (resolution IS NOT NULL = sudah di-resolve)
 *
 * ─── TUGAS WORKER ─────────────────────────────────────────────────────────────
 *
 *   1. Baca retention policy.
 *   2. Hitung jumlah entri di setiap bucket retention.
 *   3. LOG laporan — TIDAK DELETE DATA.
 *   4. Jika ada entri yang "pending delete" (melewati retention): log WARNING.
 *
 * ─── KAPAN DELETE BOLEH DILAKUKAN ─────────────────────────────────────────────
 *
 *   Archive/delete BELUM diimplementasi di sini.
 *   Aktifkan hanya setelah:
 *     - Konfirmasi manual dari tim ops
 *     - Review laporan cleanup worker selama ≥ 2 minggu
 *     - Eksport ke cold storage (opsional tapi dianjurkan)
 *
 *   Cara aktivasi delete di masa depan: uncomment bagian "DELETE IMPLEMENTATION"
 *   di bawah, jalankan terlebih dahulu di staging.
 *
 * ─── JADWAL ───────────────────────────────────────────────────────────────────
 *
 *   Initial delay : 25 menit setelah server start
 *   Interval      : setiap 6 jam
 */

import { db } from "@workspace/db";
import { sql } from "drizzle-orm";
import { logger } from "../logger.js";
import { validateTableReadiness } from "./dualWriteReliabilityService.js";

// ── Config ────────────────────────────────────────────────────────────────────

const CLEANUP_INITIAL_DELAY_MS = 25 * 60 * 1000;  // 25 menit
const CLEANUP_INTERVAL_MS      =  6 * 60 * 60 * 1000;  // 6 jam

// Retention thresholds
const RETENTION_SUCCESS_LINKED_DAYS = 90;    // archive setelah 90 hari
const RETENTION_FAILED_DAYS         = 365;   // simpan minimum 1 tahun
// exhausted: simpan sampai resolve (tidak ada threshold waktu)

// ── Types ─────────────────────────────────────────────────────────────────────

export interface CleanupReport {
  checkedAt:       string;
  totalRows:       number;
  // Current counts per status
  pending:         number;
  success:         number;
  linked:          number;
  failed:          number;
  retrying:        number;
  exhausted:       number;
  // Retention buckets — "eligible for archive" (melewati threshold)
  successLinkedEligible:  number;  // success/linked > 90 hari
  failedEligible:         number;  // failed > 365 hari
  exhaustedResolved:      number;  // exhausted dengan resolution IS NOT NULL (siap archive)
  exhaustedUnresolved:    number;  // exhausted tanpa resolution (JANGAN sentuh)
  // Oldest records per status
  oldestPendingSec:       number;
  oldestFailedSec:        number;
  oldestExhaustedSec:     number;
}

// ── Core function ─────────────────────────────────────────────────────────────

export async function runCleanupReport(): Promise<CleanupReport | null> {
  if (!(await validateTableReadiness())) {
    logger.info("[dualWrite:cleanup] Reliability layer tidak aktif — cleanup report diskip");
    return null;
  }

  try {
    const [totalRes, countRes, retentionRes, ageRes] = await Promise.all([
      // Total rows
      db.execute(sql`
        SELECT COUNT(*) AS cnt FROM mkt_dual_write_log
      `).catch(() => ({ rows: [] as unknown[] })),

      // Per-status count
      db.execute(sql`
        SELECT
          COUNT(*) FILTER (WHERE status = 'pending')   AS pending,
          COUNT(*) FILTER (WHERE status = 'success')   AS success,
          COUNT(*) FILTER (WHERE status = 'linked')    AS linked,
          COUNT(*) FILTER (WHERE status = 'failed')    AS failed,
          COUNT(*) FILTER (WHERE status = 'retrying')  AS retrying,
          COUNT(*) FILTER (WHERE status = 'exhausted') AS exhausted
        FROM mkt_dual_write_log
      `).catch(() => ({ rows: [] as unknown[] })),

      // Retention buckets
      db.execute(sql`
        SELECT
          -- success/linked melewati 90 hari
          COUNT(*) FILTER (
            WHERE status IN ('success', 'linked')
              AND created_at < NOW() - INTERVAL '90 days'
          ) AS success_linked_eligible,

          -- failed melewati 365 hari
          COUNT(*) FILTER (
            WHERE status = 'failed'
              AND created_at < NOW() - INTERVAL '365 days'
          ) AS failed_eligible,

          -- exhausted dengan resolution (sudah di-resolve, siap archive)
          COUNT(*) FILTER (
            WHERE status = 'exhausted'
              AND resolution IS NOT NULL
          ) AS exhausted_resolved,

          -- exhausted TANPA resolution (JANGAN SENTUH)
          COUNT(*) FILTER (
            WHERE status = 'exhausted'
              AND resolution IS NULL
          ) AS exhausted_unresolved

        FROM mkt_dual_write_log
      `).catch(() => ({ rows: [] as unknown[] })),

      // Age of oldest records per status
      db.execute(sql`
        SELECT
          COALESCE(MAX(EXTRACT(EPOCH FROM (NOW() - created_at)))
            FILTER (WHERE status = 'pending'), 0)   AS oldest_pending_sec,
          COALESCE(MAX(EXTRACT(EPOCH FROM (NOW() - created_at)))
            FILTER (WHERE status = 'failed'), 0)    AS oldest_failed_sec,
          COALESCE(MAX(EXTRACT(EPOCH FROM (NOW() - created_at)))
            FILTER (WHERE status = 'exhausted'), 0) AS oldest_exhausted_sec
        FROM mkt_dual_write_log
      `).catch(() => ({ rows: [] as unknown[] })),
    ]);

    const total = Number((totalRes.rows[0] as Record<string, unknown>)?.["cnt"] ?? 0);
    const c     = (countRes.rows[0]     as Record<string, unknown>) ?? {};
    const ret   = (retentionRes.rows[0] as Record<string, unknown>) ?? {};
    const age   = (ageRes.rows[0]       as Record<string, unknown>) ?? {};

    const successLinkedEligible = Number(ret["success_linked_eligible"] ?? 0);
    const failedEligible        = Number(ret["failed_eligible"]         ?? 0);
    const exhaustedResolved     = Number(ret["exhausted_resolved"]      ?? 0);
    const exhaustedUnresolved   = Number(ret["exhausted_unresolved"]    ?? 0);

    const report: CleanupReport = {
      checkedAt:              new Date().toISOString(),
      totalRows:              total,
      pending:                Number(c["pending"]   ?? 0),
      success:                Number(c["success"]   ?? 0),
      linked:                 Number(c["linked"]    ?? 0),
      failed:                 Number(c["failed"]    ?? 0),
      retrying:               Number(c["retrying"]  ?? 0),
      exhausted:              Number(c["exhausted"] ?? 0),
      successLinkedEligible,
      failedEligible,
      exhaustedResolved,
      exhaustedUnresolved,
      oldestPendingSec:       Math.round(Number(age["oldest_pending_sec"]    ?? 0)),
      oldestFailedSec:        Math.round(Number(age["oldest_failed_sec"]     ?? 0)),
      oldestExhaustedSec:     Math.round(Number(age["oldest_exhausted_sec"]  ?? 0)),
    };

    // Log summary
    logger.info(
      {
        totalRows:             report.totalRows,
        eligibleForArchive:    successLinkedEligible + failedEligible + exhaustedResolved,
        exhaustedUnresolved:   report.exhaustedUnresolved,
      },
      "[dualWrite:cleanup] Retention report selesai",
    );

    // Warning jika ada entri eligible
    if (successLinkedEligible > 0) {
      logger.warn(
        { count: successLinkedEligible, thresholdDays: RETENTION_SUCCESS_LINKED_DAYS },
        `[dualWrite:cleanup] ${successLinkedEligible} entri success/linked melewati ${RETENTION_SUCCESS_LINKED_DAYS} hari — eligible untuk archive`,
      );
    }

    if (failedEligible > 0) {
      logger.warn(
        { count: failedEligible, thresholdDays: RETENTION_FAILED_DAYS },
        `[dualWrite:cleanup] ${failedEligible} entri failed melewati ${RETENTION_FAILED_DAYS} hari — eligible untuk archive`,
      );
    }

    if (exhaustedResolved > 0) {
      logger.info(
        { count: exhaustedResolved },
        `[dualWrite:cleanup] ${exhaustedResolved} entri exhausted sudah di-resolve — eligible untuk archive`,
      );
    }

    if (exhaustedUnresolved > 0) {
      logger.warn(
        { count: exhaustedUnresolved },
        `[dualWrite:cleanup] ${exhaustedUnresolved} entri exhausted BELUM di-resolve — JANGAN archive`,
      );
    }

    return report;
  } catch (err: unknown) {
    logger.warn({ err }, "[dualWrite:cleanup] runCleanupReport gagal (non-fatal)");
    return null;
  }

  // ── DELETE IMPLEMENTATION (BELUM AKTIF) ───────────────────────────────────
  //
  // Uncomment HANYA setelah konfirmasi manual dari tim ops.
  // Jalankan di staging minimal 1 minggu sebelum prod.
  //
  // // Archive success/linked > 90 hari
  // await db.execute(sql`
  //   DELETE FROM mkt_dual_write_log
  //   WHERE status IN ('success', 'linked')
  //     AND created_at < NOW() - INTERVAL '90 days'
  // `);
  //
  // // Archive failed > 365 hari
  // await db.execute(sql`
  //   DELETE FROM mkt_dual_write_log
  //   WHERE status = 'failed'
  //     AND created_at < NOW() - INTERVAL '365 days'
  // `);
  //
  // // Archive exhausted yang sudah di-resolve
  // await db.execute(sql`
  //   DELETE FROM mkt_dual_write_log
  //   WHERE status = 'exhausted'
  //     AND resolution IS NOT NULL
  // `);
}

// ── Worker entry point ────────────────────────────────────────────────────────

export function startDualWriteCleanupWorker(): void {
  setTimeout(() => {
    void runCleanupReport().catch((err: unknown) => {
      logger.warn({ err }, "[dualWrite:cleanup] Worker cycle error");
    });

    setInterval(() => {
      void runCleanupReport().catch((err: unknown) => {
        logger.warn({ err }, "[dualWrite:cleanup] Worker cycle error");
      });
    }, CLEANUP_INTERVAL_MS);
  }, CLEANUP_INITIAL_DELAY_MS);

  logger.info(
    { initialDelayMs: CLEANUP_INITIAL_DELAY_MS, intervalMs: CLEANUP_INTERVAL_MS },
    "[dualWrite:cleanup] Worker terdaftar",
  );
}
