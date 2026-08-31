import { registerHeartbeat, beat } from "../workerHeartbeat.js";

/**
 * dualWriteReliabilityService.ts — Phase 2A.2: Production-Grade Dual Write Reliability
 *
 * ─── PERUBAHAN DARI 2A.1 ──────────────────────────────────────────────────────
 *
 *  1. HAPUS boot migration (ensureDualWriteLogTable) — diganti validateTableReadiness()
 *     Service hanya validasi keberadaan tabel. Jika tidak ada: log error + disable layer.
 *
 *  2. STATUS menjadi Postgres enum mkt_dual_write_status (via migration 0014)
 *     Semua INSERT/UPDATE tetap pakai raw SQL dengan nilai string yang kompatibel.
 *
 *  3. KOLOM TERSTRUKTUR:
 *     buyer_name, buyer_company, qty, unit, shipping_address (dipisah dari payload)
 *     Fungsi createDualWriteLog() menerima CreateDualWriteLogOpts (bukan 3 param terpisah)
 *
 *  4. METRICS BARU:
 *     retry_success_rate, average_retry_duration, average_recovery_time,
 *     pending_oldest_age, integrity_score, orphan_count, failed_last_24h,
 *     exhausted_last_24h
 *
 *  5. CLEANUP WORKER: marketplaceDualWriteCleanupWorker.ts (file terpisah)
 *
 *  6. RELIABILITY GATE: _reliabilityEnabled flag. Jika tabel tidak ada:
 *     semua fungsi gracefully no-op (tidak crash API).
 *
 * ─── RETENTION POLICY (dokumentasi — belum di-enforce via DB) ─────────────────
 *
 *   success / linked  → archive setelah 90 hari
 *   failed            → simpan minimum 1 tahun
 *   exhausted         → simpan sampai diselesaikan manual (resolution IS NOT NULL)
 *
 * ─── TABLE: mkt_dual_write_log ────────────────────────────────────────────────
 *   DDL resmi: lib/db/drizzle/0014_mkt_dual_write_log.sql
 *   Drizzle schema: lib/db/src/schema/mktDualWriteLog.ts
 */

import { db } from "@workspace/db";
import { sql } from "drizzle-orm";
import { logger } from "../logger.js";

// ── Config ────────────────────────────────────────────────────────────────────

const MAX_RETRY               = 3;
const RETRY_BATCH_SIZE        = 20;
const INTEGRITY_WINDOW_HOURS  = 48;
const ALERT_FAILURE_THRESHOLD = 3;
const RETRY_INTERVAL_MS       = 5  * 60 * 1000;
const RETRY_INITIAL_DELAY_MS  = 4  * 60 * 1000;
const INTEGRITY_INTERVAL_MS   = 30 * 60 * 1000;
const INTEGRITY_INITIAL_DELAY = 10 * 60 * 1000;

// ── Reliability gate ──────────────────────────────────────────────────────────

let _reliabilityEnabled: boolean | null = null;  // null = belum dicek

/**
 * validateTableReadiness — cek apakah mkt_dual_write_log ada di DB.
 * Dipanggil sekali saat pertama kali dibutuhkan.
 * Jika tabel tidak ada: set _reliabilityEnabled = false, log error yang jelas.
 * Tidak pernah throw — non-fatal.
 */
export async function validateTableReadiness(): Promise<boolean> {
  if (_reliabilityEnabled !== null) return _reliabilityEnabled;

  try {
    const { rows } = await db.execute(sql`
      SELECT EXISTS (
        SELECT 1 FROM information_schema.tables
        WHERE  table_schema = 'public'
          AND  table_name   = 'mkt_dual_write_log'
      ) AS "exists"
    `);
    const exists = (rows[0] as Record<string, unknown>)?.["exists"];
    _reliabilityEnabled = exists === true || exists === "true" || exists === "t";

    if (!_reliabilityEnabled) {
      logger.error(
        "[dualWrite:validate] Tabel 'mkt_dual_write_log' TIDAK DITEMUKAN di database. " +
        "Reliability layer DINONAKTIFKAN. " +
        "Jalankan migration 0014_mkt_dual_write_log.sql untuk mengaktifkan: " +
        "pnpm migrate:dev (dev) | pnpm migrate:prod (prod)",
      );
    } else {
      logger.info("[dualWrite:validate] Tabel 'mkt_dual_write_log' OK — reliability layer AKTIF");
    }
  } catch (err: unknown) {
    logger.error(
      { err },
      "[dualWrite:validate] Gagal cek keberadaan tabel — reliability layer DINONAKTIFKAN",
    );
    _reliabilityEnabled = false;
  }

  return _reliabilityEnabled;
}

/** Reset cache — untuk test / manual re-check */
export function resetTableReadinessCache(): void {
  _reliabilityEnabled = null;
}

// ── Write helpers ─────────────────────────────────────────────────────────────

export interface CreateDualWriteLogOpts {
  catalogItemId:   number;
  buyerName:       string;
  buyerEmail:      string;
  buyerCompany?:   string;
  qty?:            number | string;
  unit?:           string;
  shippingAddress?: string;
  idempotencyKey?: string;
  payload:         Record<string, unknown>;
}

/**
 * createDualWriteLog — buat entri 'pending' sebelum tx mkt_ dimulai.
 * Fire-and-forget, non-fatal. Mengembalikan log id (atau 0 jika gagal/disabled).
 */
export async function createDualWriteLog(opts: CreateDualWriteLogOpts): Promise<number> {
  if (!(await validateTableReadiness())) return 0;
  try {
    const qty = opts.qty !== undefined ? String(opts.qty) : "1";
    const unit = opts.unit ?? "unit";
    const { rows } = await db.execute(sql`
      INSERT INTO mkt_dual_write_log
        (catalog_item_id, buyer_name, buyer_email, buyer_company,
         qty, unit, shipping_address, idempotency_key, payload, status, attempt)
      VALUES
        (${opts.catalogItemId},
         ${opts.buyerName ?? ""},
         ${opts.buyerEmail},
         ${opts.buyerCompany ?? null},
         ${qty},
         ${unit},
         ${opts.shippingAddress ?? null},
         ${opts.idempotencyKey ?? null},
         ${JSON.stringify(opts.payload)},
         'pending', 0)
       ON CONFLICT DO NOTHING
       RETURNING id
    `);
    if (rows.length) return Number((rows[0] as Record<string, unknown>)?.["id"] ?? 0);
    if (!opts.idempotencyKey) return 0;
    const existing = await db.execute(sql`
      SELECT id
      FROM mkt_dual_write_log
      WHERE idempotency_key = ${opts.idempotencyKey}
      LIMIT 1
    `);
    return Number((existing.rows[0] as Record<string, unknown>)?.["id"] ?? 0);
  } catch (err: unknown) {
    logger.warn({ err }, "[dualWrite] createDualWriteLog gagal (non-fatal)");
    return 0;
  }
}

/**
 * markDualWriteSuccess — set status='success' setelah tx mkt_ commit.
 * Fire-and-forget.
 */
export async function markDualWriteSuccess(
  logId: number,
  rfqId: number,
  rfqNumber: string,
): Promise<void> {
  if (!logId || !(await validateTableReadiness())) return;
  await db.execute(sql`
    UPDATE mkt_dual_write_log
    SET status         = 'success',
        mkt_rfq_id     = ${rfqId},
        mkt_rfq_number = ${rfqNumber},
        attempt        = attempt + 1,
        updated_at     = NOW(),
        resolved_at    = NOW(),
        resolution     = 'AUTO_SUCCESS'
    WHERE id = ${logId}
      AND mkt_rfq_id IS NULL
      AND status IN ('pending', 'retrying')
  `).catch((err: unknown) => {
    logger.warn({ err, logId }, "[dualWrite] markDualWriteSuccess gagal (non-fatal)");
  });
}

/**
 * markDualWriteFailed — set status='failed' jika tx mkt_ throw.
 * Fire-and-forget. Caller harus tetap rethrow error aslinya.
 */
export async function markDualWriteFailed(
  logId: number,
  error: string,
): Promise<void> {
  if (!logId || !(await validateTableReadiness())) return;
  await db.execute(sql`
    UPDATE mkt_dual_write_log
    SET status     = 'failed',
        last_error = ${error.slice(0, 2000)},
        attempt    = attempt + 1,
        updated_at = NOW()
    WHERE id = ${logId}
      AND status IN ('pending', 'retrying')
  `).catch((err: unknown) => {
    logger.warn({ err, logId }, "[dualWrite] markDualWriteFailed gagal (non-fatal)");
  });
}

/**
 * linkLegacyOrder — tambah portal_order_id + portal_order_number ke log entry.
 * Lookup by mkt_rfq_id. status berpindah ke 'linked' (fully reconciled).
 * Fire-and-forget.
 */
export async function linkLegacyOrder(
  mktRfqId: number,
  portalOrderId: number,
  portalOrderNumber: string,
): Promise<void> {
  if (!(await validateTableReadiness())) return;
  await db.execute(sql`
    UPDATE mkt_dual_write_log
    SET portal_order_id     = ${portalOrderId},
        portal_order_number = ${portalOrderNumber},
        status              = 'linked',
        updated_at          = NOW(),
        resolved_at         = NOW(),
        resolution          = 'AUTO_SUCCESS'
    WHERE mkt_rfq_id = ${mktRfqId}
      AND status IN ('success', 'pending')
  `).catch((err: unknown) => {
    logger.warn({ err, mktRfqId }, "[dualWrite] linkLegacyOrder gagal (non-fatal)");
  });
}

// ── Stats & Query helpers ─────────────────────────────────────────────────────

export interface DualWriteStats {
  last24h: {
    total:       number;
    success:     number;
    linked:      number;
    failed:      number;
    exhausted:   number;
    pending:     number;
    successRate: number;
  };
  allTime: {
    total:     number;
    success:   number;
    linked:    number;
    failed:    number;
    exhausted: number;
  };
  pendingRetry:        number;
  exhaustedUnresolved: number;
  lastCheckedAt:       string;
}

export async function getDualWriteStats(): Promise<DualWriteStats> {
  const empty: DualWriteStats = {
    last24h:  { total: 0, success: 0, linked: 0, failed: 0, exhausted: 0, pending: 0, successRate: 100 },
    allTime:  { total: 0, success: 0, linked: 0, failed: 0, exhausted: 0 },
    pendingRetry: 0, exhaustedUnresolved: 0,
    lastCheckedAt: new Date().toISOString(),
  };
  if (!(await validateTableReadiness())) return empty;

  const [last24hRes, allTimeRes, pendingRetryRes, exhaustedRes] = await Promise.all([
    db.execute(sql`
      SELECT
        COUNT(*)                                         AS total,
        COUNT(*) FILTER (WHERE status = 'success')      AS success,
        COUNT(*) FILTER (WHERE status = 'linked')       AS linked,
        COUNT(*) FILTER (WHERE status = 'failed')       AS failed,
        COUNT(*) FILTER (WHERE status = 'exhausted')    AS exhausted,
        COUNT(*) FILTER (WHERE status = 'pending')      AS pending
      FROM mkt_dual_write_log
      WHERE created_at > NOW() - INTERVAL '24 hours'
    `).catch(() => ({ rows: [] as unknown[] })),

    db.execute(sql`
      SELECT
        COUNT(*)                                         AS total,
        COUNT(*) FILTER (WHERE status = 'success')      AS success,
        COUNT(*) FILTER (WHERE status = 'linked')       AS linked,
        COUNT(*) FILTER (WHERE status = 'failed')       AS failed,
        COUNT(*) FILTER (WHERE status = 'exhausted')    AS exhausted
      FROM mkt_dual_write_log
    `).catch(() => ({ rows: [] as unknown[] })),

    db.execute(sql`
      SELECT COUNT(*) AS cnt FROM mkt_dual_write_log
      WHERE status = 'failed' AND attempt < ${MAX_RETRY}
    `).catch(() => ({ rows: [] as unknown[] })),

    db.execute(sql`
      SELECT COUNT(*) AS cnt FROM mkt_dual_write_log
      WHERE status = 'exhausted' AND portal_order_id IS NOT NULL
    `).catch(() => ({ rows: [] as unknown[] })),
  ]);

  const r24  = (last24hRes.rows[0] as Record<string, unknown>) ?? {};
  const rAll = (allTimeRes.rows[0] as Record<string, unknown>) ?? {};

  const total24    = Number(r24["total"] ?? 0);
  const success24  = Number(r24["success"] ?? 0);
  const linked24   = Number(r24["linked"] ?? 0);
  const failed24   = Number(r24["failed"] ?? 0);
  const exhausted24= Number(r24["exhausted"] ?? 0);
  const pending24  = Number(r24["pending"] ?? 0);
  const goodCount  = success24 + linked24;
  const successRate = total24 > 0 ? Math.round((goodCount / total24) * 1000) / 10 : 100;

  return {
    last24h: { total: total24, success: success24, linked: linked24, failed: failed24, exhausted: exhausted24, pending: pending24, successRate },
    allTime: {
      total:     Number(rAll["total"] ?? 0),
      success:   Number(rAll["success"] ?? 0),
      linked:    Number(rAll["linked"] ?? 0),
      failed:    Number(rAll["failed"] ?? 0),
      exhausted: Number(rAll["exhausted"] ?? 0),
    },
    pendingRetry:        Number((pendingRetryRes.rows[0] as Record<string, unknown>)?.["cnt"] ?? 0),
    exhaustedUnresolved: Number((exhaustedRes.rows[0] as Record<string, unknown>)?.["cnt"] ?? 0),
    lastCheckedAt:       new Date().toISOString(),
  };
}

export async function getFailedDualWriteEntries(limit = 50): Promise<Array<Record<string, unknown>>> {
  if (!(await validateTableReadiness())) return [];
  const { rows } = await db.execute(sql`
    SELECT
      id, catalog_item_id, buyer_name, buyer_email, buyer_company,
      qty, unit, shipping_address,
      status, attempt, last_error,
      mkt_rfq_id, mkt_rfq_number,
      portal_order_id, portal_order_number,
      created_at, updated_at, last_retry_at, resolved_at,
      retry_started_at, retry_completed_at, resolution
    FROM mkt_dual_write_log
    WHERE status IN ('failed', 'exhausted', 'pending')
    ORDER BY created_at DESC
    LIMIT ${limit}
  `).catch(() => ({ rows: [] as unknown[] }));
  return rows as Array<Record<string, unknown>>;
}

// ── Metrics (Phase 2A.2 new) ──────────────────────────────────────────────────

export interface DualWriteMetrics {
  retrySuccessRate:      number;     // % dari retry yang berhasil
  avgRetryDurationSec:   number;     // rata-rata durasi 1 retry cycle (detik)
  avgRecoveryTimeSec:    number;     // rata-rata waktu dari created → resolved (detik)
  pendingOldestAgeSec:   number;     // umur entri 'pending' tertua (detik, 0 = tidak ada)
  integrityScore:        number;     // 0-100, (success+linked)/total
  orphanCount:           number;     // failed/exhausted dengan portal_order_id (legacy ok, mkt_ fail)
  failedLast24h:         number;     // count failed dalam 24 jam terakhir
  exhaustedLast24h:      number;     // count exhausted dalam 24 jam terakhir
  reliabilityEnabled:    boolean;
}

export async function getDualWriteMetrics(): Promise<DualWriteMetrics> {
  const disabled: DualWriteMetrics = {
    retrySuccessRate: 0, avgRetryDurationSec: 0, avgRecoveryTimeSec: 0,
    pendingOldestAgeSec: 0, integrityScore: 100, orphanCount: 0,
    failedLast24h: 0, exhaustedLast24h: 0, reliabilityEnabled: false,
  };
  if (!(await validateTableReadiness())) return disabled;

  const [retryRes, recoveryRes, pendingAgeRes, integrityRes, orphanRes, last24hRes] = await Promise.all([
    // retry_success_rate + avg_retry_duration (dari entri yang sudah retry)
    db.execute(sql`
      SELECT
        COUNT(*) FILTER (WHERE resolution = 'AUTO_RETRIED')   AS recovered,
        COUNT(*) FILTER (WHERE attempt > 1)                    AS retried,
        AVG(
          EXTRACT(EPOCH FROM (retry_completed_at - retry_started_at))
        ) FILTER (WHERE retry_started_at IS NOT NULL AND retry_completed_at IS NOT NULL)
          AS avg_retry_sec
      FROM mkt_dual_write_log
    `).catch(() => ({ rows: [] as unknown[] })),

    // avg_recovery_time (dari entri yang sudah resolved)
    db.execute(sql`
      SELECT AVG(
        EXTRACT(EPOCH FROM (resolved_at - created_at))
      ) AS avg_recovery_sec
      FROM mkt_dual_write_log
      WHERE resolved_at IS NOT NULL
        AND status IN ('success', 'linked')
    `).catch(() => ({ rows: [] as unknown[] })),

    // pending_oldest_age
    db.execute(sql`
      SELECT EXTRACT(EPOCH FROM (NOW() - MIN(created_at))) AS oldest_age_sec
      FROM mkt_dual_write_log
      WHERE status = 'pending'
    `).catch(() => ({ rows: [] as unknown[] })),

    // integrity_score
    db.execute(sql`
      SELECT
        COUNT(*) AS total,
        COUNT(*) FILTER (WHERE status IN ('success', 'linked')) AS good
      FROM mkt_dual_write_log
      WHERE created_at > NOW() - INTERVAL '48 hours'
    `).catch(() => ({ rows: [] as unknown[] })),

    // orphan_count
    db.execute(sql`
      SELECT COUNT(*) AS cnt FROM mkt_dual_write_log
      WHERE status IN ('failed', 'exhausted')
        AND portal_order_id IS NOT NULL
    `).catch(() => ({ rows: [] as unknown[] })),

    // failed + exhausted last 24h
    db.execute(sql`
      SELECT
        COUNT(*) FILTER (WHERE status = 'failed')    AS failed,
        COUNT(*) FILTER (WHERE status = 'exhausted') AS exhausted
      FROM mkt_dual_write_log
      WHERE created_at > NOW() - INTERVAL '24 hours'
    `).catch(() => ({ rows: [] as unknown[] })),
  ]);

  const r1 = (retryRes.rows[0] as Record<string, unknown>) ?? {};
  const r2 = (recoveryRes.rows[0] as Record<string, unknown>) ?? {};
  const r3 = (pendingAgeRes.rows[0] as Record<string, unknown>) ?? {};
  const r4 = (integrityRes.rows[0] as Record<string, unknown>) ?? {};
  const r5 = (orphanRes.rows[0] as Record<string, unknown>) ?? {};
  const r6 = (last24hRes.rows[0] as Record<string, unknown>) ?? {};

  const recovered = Number(r1["recovered"] ?? 0);
  const retried   = Number(r1["retried"] ?? 0);
  const retrySuccessRate = retried > 0 ? Math.round((recovered / retried) * 1000) / 10 : 100;

  const integrityTotal = Number(r4["total"] ?? 0);
  const integrityGood  = Number(r4["good"] ?? 0);
  const integrityScore = integrityTotal > 0 ? Math.round((integrityGood / integrityTotal) * 100) : 100;

  return {
    retrySuccessRate,
    avgRetryDurationSec: Math.round(Number(r1["avg_retry_sec"] ?? 0)),
    avgRecoveryTimeSec:  Math.round(Number(r2["avg_recovery_sec"] ?? 0)),
    pendingOldestAgeSec: Math.round(Number(r3["oldest_age_sec"] ?? 0)),
    integrityScore,
    orphanCount:         Number(r5["cnt"] ?? 0),
    failedLast24h:       Number(r6["failed"] ?? 0),
    exhaustedLast24h:    Number(r6["exhausted"] ?? 0),
    reliabilityEnabled:  true,
  };
}

// ── Admin Dashboard — Reliability Summary ────────────────────────────────────

export interface ReliabilitySummary {
  dualWriteSuccessPct: number;
  retryQueue:          number;  // entri failed yang masih bisa di-retry
  failedQueue:         number;  // total failed+exhausted (butuh perhatian)
  integrityScore:      number;  // 0-100
  orphanCount:         number;
  avgRetryTimeSec:     number;
  avgRecoveryTimeSec:  number;
  retrySuccessRate:    number;
  failedLast24h:       number;
  exhaustedLast24h:    number;
  pendingOldestAgeSec: number;
  reliabilityEnabled:  boolean;
  generatedAt:         string;
}

/**
 * getReliabilitySummary — satu call untuk semua data admin dashboard.
 * Menggabungkan getDualWriteStats() + getDualWriteMetrics().
 */
export async function getReliabilitySummary(): Promise<ReliabilitySummary> {
  const [stats, metrics] = await Promise.all([
    getDualWriteStats(),
    getDualWriteMetrics(),
  ]);

  return {
    dualWriteSuccessPct: stats.last24h.successRate,
    retryQueue:          stats.pendingRetry,
    failedQueue:         stats.allTime.failed + stats.allTime.exhausted,
    integrityScore:      metrics.integrityScore,
    orphanCount:         metrics.orphanCount,
    avgRetryTimeSec:     metrics.avgRetryDurationSec,
    avgRecoveryTimeSec:  metrics.avgRecoveryTimeSec,
    retrySuccessRate:    metrics.retrySuccessRate,
    failedLast24h:       metrics.failedLast24h,
    exhaustedLast24h:    metrics.exhaustedLast24h,
    pendingOldestAgeSec: metrics.pendingOldestAgeSec,
    reliabilityEnabled:  metrics.reliabilityEnabled,
    generatedAt:         new Date().toISOString(),
  };
}

// ── Integrity check ───────────────────────────────────────────────────────────

export interface IntegrityCheckResult {
  windowHours:       number;
  mktRfqsCreated:    number;
  dualWriteSuccess:  number;
  orphanedFailed:    number;
  exhaustedCount:    number;
  discrepancy:       number;
  status:            "ok" | "warn" | "alert";
  message:           string;
  checkedAt:         string;
}

export async function runIntegrityCheck(): Promise<IntegrityCheckResult> {
  const empty: IntegrityCheckResult = {
    windowHours: INTEGRITY_WINDOW_HOURS, mktRfqsCreated: 0, dualWriteSuccess: 0,
    orphanedFailed: 0, exhaustedCount: 0, discrepancy: 0,
    status: "ok", message: "reliability layer disabled",
    checkedAt: new Date().toISOString(),
  };
  if (!(await validateTableReadiness())) return empty;

  const [mktRes, successRes, orphanRes, exhaustedRes] = await Promise.all([
    db.execute(sql`
      SELECT COUNT(*) AS cnt FROM mkt_rfqs
      WHERE created_at > NOW() - ${`${INTEGRITY_WINDOW_HOURS} hours`}::INTERVAL
    `).catch(() => ({ rows: [] as unknown[] })),

    db.execute(sql`
      SELECT COUNT(*) AS cnt FROM mkt_dual_write_log
      WHERE status IN ('success', 'linked')
        AND created_at > NOW() - ${`${INTEGRITY_WINDOW_HOURS} hours`}::INTERVAL
    `).catch(() => ({ rows: [] as unknown[] })),

    db.execute(sql`
      SELECT COUNT(*) AS cnt FROM mkt_dual_write_log
      WHERE status IN ('failed', 'exhausted')
        AND portal_order_id IS NOT NULL
    `).catch(() => ({ rows: [] as unknown[] })),

    db.execute(sql`
      SELECT COUNT(*) AS cnt FROM mkt_dual_write_log
      WHERE status = 'exhausted'
    `).catch(() => ({ rows: [] as unknown[] })),
  ]);

  const mktCount       = Number((mktRes.rows[0] as Record<string, unknown>)?.["cnt"] ?? 0);
  const successCount   = Number((successRes.rows[0] as Record<string, unknown>)?.["cnt"] ?? 0);
  const orphanCount    = Number((orphanRes.rows[0] as Record<string, unknown>)?.["cnt"] ?? 0);
  const exhaustedCount = Number((exhaustedRes.rows[0] as Record<string, unknown>)?.["cnt"] ?? 0);
  const discrepancy    = Math.abs(mktCount - successCount);

  let status: IntegrityCheckResult["status"] = "ok";
  let message = `OK — mkt_rfqs=${mktCount}, dual_write_success=${successCount}, orphaned=${orphanCount}`;

  if (exhaustedCount > 0 || orphanCount > 0) {
    status  = "alert";
    message = `ALERT — ${exhaustedCount} exhausted, ${orphanCount} orphaned (legacy ok, mkt_ fail)`;
  } else if (discrepancy > 2) {
    status  = "warn";
    message = `WARN — discrepancy ${discrepancy} (mkt_rfqs=${mktCount} vs success_log=${successCount})`;
  }

  logger.info({ mktCount, successCount, orphanCount, exhaustedCount, status }, `[dualWrite:integrity] ${message}`);

  return { windowHours: INTEGRITY_WINDOW_HOURS, mktRfqsCreated: mktCount, dualWriteSuccess: successCount, orphanedFailed: orphanCount, exhaustedCount, discrepancy, status, message, checkedAt: new Date().toISOString() };
}

// ── Alerting ──────────────────────────────────────────────────────────────────

let _lastAlertSentAt = 0;
const ALERT_COOLDOWN_MS = 30 * 60 * 1000;

async function sendDualWriteAlert(message: string): Promise<void> {
  const now = Date.now();
  if (now - _lastAlertSentAt < ALERT_COOLDOWN_MS) return;
  _lastAlertSentAt = now;

  logger.error({ message }, "[dualWrite:ALERT] " + message);

  try {
    const { getAdminPhones } = await import("../adminWa.js");
    const { sendViaService } = await import("../waTransport.js");
    const phones = await getAdminPhones();
    if (!phones.length) return;
    const text = `[DUAL WRITE ALERT]\n${message}\n\nCek: GET /api/mkt/admin/reliability/summary`;
    await Promise.allSettled(phones.map(p => sendViaService(p, text)));
  } catch (err: unknown) {
    logger.warn({ err }, "[dualWrite] sendDualWriteAlert via WA gagal (non-fatal)");
  }
}

export async function alertIfFailureThresholdExceeded(): Promise<void> {
  if (!(await validateTableReadiness())) return;
  try {
    const { rows } = await db.execute(sql`
      SELECT COUNT(*) AS cnt FROM mkt_dual_write_log
      WHERE status = 'exhausted'
        AND created_at > NOW() - INTERVAL '1 hour'
    `);
    const cnt = Number((rows[0] as Record<string, unknown>)?.["cnt"] ?? 0);
    if (cnt >= ALERT_FAILURE_THRESHOLD) {
      await sendDualWriteAlert(
        `${cnt} dual-write RFQ exhausted dalam 1 jam terakhir.\n` +
        `mkt_ write gagal total setelah ${MAX_RETRY}x retry.\n` +
        `Data ada di portal_product_orders tapi TIDAK di mkt_rfqs.`,
      );
    }
  } catch (err: unknown) {
    logger.warn({ err }, "[dualWrite] alertIfFailureThresholdExceeded gagal (non-fatal)");
  }
}

// ── Retry worker ──────────────────────────────────────────────────────────────

let _retryRunning = false;

export async function retryFailedDualWrites(): Promise<{
  retried: number; recovered: number; exhausted: number; skipped: number;
}> {
  if (_retryRunning) return { retried: 0, recovered: 0, exhausted: 0, skipped: 0 };
  _retryRunning = true;

  if (!(await validateTableReadiness())) {
    _retryRunning = false;
    return { retried: 0, recovered: 0, exhausted: 0, skipped: 0 };
  }

  const result = { retried: 0, recovered: 0, exhausted: 0, skipped: 0 };

  try {
    const { rows } = await db.execute(sql`
      WITH candidates AS (
        SELECT id
        FROM mkt_dual_write_log
        WHERE status = 'failed'
          AND attempt < ${MAX_RETRY}
          -- Containment: legacy rows have no stable logical identity. They
          -- remain reviewable/manual-only until explicitly reconciled.
          AND idempotency_key IS NOT NULL
        ORDER BY created_at ASC
        LIMIT ${RETRY_BATCH_SIZE}
        FOR UPDATE SKIP LOCKED
      )
      UPDATE mkt_dual_write_log AS log
      SET status           = 'retrying',
          last_retry_at    = NOW(),
          retry_started_at = NOW(),
          updated_at       = NOW()
      FROM candidates
      WHERE log.id = candidates.id
      RETURNING log.id, log.catalog_item_id, log.buyer_email, log.payload, log.attempt
    `).catch(() => ({ rows: [] as unknown[] }));

    if (!rows.length) return result;

    const { createMktRfqEntry } = await import("./marketplaceRfqService.js");

    for (const row of rows as Array<Record<string, unknown>>) {
      const logId   = Number(row["id"]);
      const attempt = Number(row["attempt"] ?? 0);
      const retryStart = new Date().toISOString();

      result.retried++;

      let opts: Record<string, unknown>;
      try {
        opts = (typeof row["payload"] === "string"
          ? JSON.parse(row["payload"])
          : row["payload"]) as Record<string, unknown>;
      } catch {
        logger.warn({ logId }, "[dualWrite:retry] payload parse gagal — skip");
        await db.execute(sql`
          UPDATE mkt_dual_write_log
          SET status = 'failed', last_error = 'payload parse error', updated_at = NOW()
          WHERE id = ${logId}
        `).catch(() => {});
        result.skipped++;
        continue;
      }

      try {
        const rfqResult = await createMktRfqEntry({
          ...opts,
          dualWriteLogId: logId,
        } as never);
        const now = new Date().toISOString();

        await db.execute(sql`
          UPDATE mkt_dual_write_log
           SET status              = CASE WHEN status = 'linked' THEN status ELSE 'success' END,
              mkt_rfq_id          = ${rfqResult.rfqId},
              mkt_rfq_number      = ${rfqResult.rfqNumber},
              attempt             = ${attempt + 1},
              updated_at          = NOW(),
              resolved_at         = NOW(),
              retry_completed_at  = NOW(),
           resolution          = 'AUTO_RETRIED'
           WHERE id = ${logId}
             AND status IN ('success', 'linked')
        `).catch(() => {});

        logger.info({ logId, rfqId: rfqResult.rfqId, rfqNumber: rfqResult.rfqNumber, retryStart, now }, `[dualWrite:retry] Recovered — logId=${logId}`);
        result.recovered++;
      } catch (err: unknown) {
        const errMsg     = err instanceof Error ? err.message : String(err);
        const nextAttempt = attempt + 1;

        if (nextAttempt >= MAX_RETRY) {
          await db.execute(sql`
            UPDATE mkt_dual_write_log
            SET status            = 'exhausted',
                last_error        = ${errMsg.slice(0, 2000)},
                attempt           = ${nextAttempt},
                updated_at        = NOW(),
                retry_completed_at = NOW(),
                resolution        = 'EXHAUSTED'
            WHERE id = ${logId}
              AND status = 'retrying'
          `).catch(() => {});

          logger.error({ logId, nextAttempt, err: errMsg }, `[dualWrite:retry] EXHAUSTED setelah ${nextAttempt} attempts — logId=${logId}`);
          result.exhausted++;
        } else {
          await db.execute(sql`
            UPDATE mkt_dual_write_log
            SET status            = 'failed',
                last_error        = ${errMsg.slice(0, 2000)},
                attempt           = ${nextAttempt},
                updated_at        = NOW(),
                retry_completed_at = NOW()
            WHERE id = ${logId}
              AND status = 'retrying'
          `).catch(() => {});

          logger.warn({ logId, nextAttempt, err: errMsg }, `[dualWrite:retry] Masih gagal, attempt=${nextAttempt}`);
        }
      }
    }

    if (result.retried > 0) logger.info(result, "[dualWrite:retry] Batch selesai");
    if (result.exhausted > 0) await alertIfFailureThresholdExceeded();
  } finally {
    _retryRunning = false;
  }

  return result;
}

// ── Manual single-entry retry ─────────────────────────────────────────────────

export async function retrySingleEntry(logId: number): Promise<{
  ok: boolean; rfqId?: number; rfqNumber?: string; error?: string;
}> {
  if (!(await validateTableReadiness())) return { ok: false, error: "reliability layer disabled" };

  const { rows } = await db.execute(sql`
    SELECT id, payload, attempt, status
    FROM mkt_dual_write_log
    WHERE id = ${logId}
    LIMIT 1
  `).catch(() => ({ rows: [] as unknown[] }));

  if (!rows.length) return { ok: false, error: `logId ${logId} tidak ditemukan` };

  const row     = rows[0] as Record<string, unknown>;
  const currentStatus = String(row["status"] ?? "");
  const attempt = Number(row["attempt"] ?? 0);
  if (currentStatus !== "failed") {
    return { ok: false, error: `logId ${logId} berstatus ${currentStatus}; hanya failed yang boleh di-retry` };
  }
  if (attempt >= MAX_RETRY) {
    return { ok: false, error: `logId ${logId} sudah mencapai batas retry` };
  }

  let opts: Record<string, unknown>;
  try {
    opts = (typeof row["payload"] === "string"
      ? JSON.parse(row["payload"])
      : row["payload"]) as Record<string, unknown>;
  } catch {
    return { ok: false, error: "payload parse error" };
  }

  const claimed = await db.execute(sql`
    UPDATE mkt_dual_write_log
    SET status = 'retrying', last_retry_at = NOW(), retry_started_at = NOW(), updated_at = NOW()
    WHERE id = ${logId} AND status = 'failed' AND attempt < ${MAX_RETRY}
    RETURNING id, payload, attempt
  `).catch(() => ({ rows: [] as unknown[] }));
  if (!claimed.rows.length) {
    return { ok: false, error: `logId ${logId} sedang diproses atau sudah berubah status` };
  }

  try {
    const { createMktRfqEntry } = await import("./marketplaceRfqService.js");
    const rfqResult = await createMktRfqEntry({
      ...opts,
      dualWriteLogId: logId,
    } as never);

    await db.execute(sql`
      UPDATE mkt_dual_write_log
       SET status             = CASE WHEN status = 'linked' THEN status ELSE 'success' END,
          mkt_rfq_id         = ${rfqResult.rfqId},
          mkt_rfq_number     = ${rfqResult.rfqNumber},
          attempt            = ${attempt + 1},
          updated_at         = NOW(),
          resolved_at        = NOW(),
          retry_completed_at = NOW(),
           resolution         = 'MANUAL_RECOVERY'
       WHERE id = ${logId}
         AND status IN ('success', 'linked')
    `).catch(() => {});

    logger.info({ logId, rfqId: rfqResult.rfqId, rfqNumber: rfqResult.rfqNumber }, `[dualWrite:manual] Berhasil — logId=${logId}`);
    return { ok: true, rfqId: rfqResult.rfqId, rfqNumber: rfqResult.rfqNumber };
  } catch (err: unknown) {
    const errMsg = err instanceof Error ? err.message : String(err);
    const nextAttempt = attempt + 1;

    await db.execute(sql`
      UPDATE mkt_dual_write_log
      SET status             = ${nextAttempt >= MAX_RETRY ? 'exhausted' : 'failed'},
          last_error         = ${errMsg.slice(0, 2000)},
          attempt            = ${nextAttempt},
          updated_at         = NOW(),
          retry_completed_at = NOW(),
          resolution         = ${nextAttempt >= MAX_RETRY ? 'EXHAUSTED' : null}
       WHERE id = ${logId}
         AND status = 'retrying'
    `).catch(() => {});

    return { ok: false, error: errMsg };
  }
}

// ── Workers ───────────────────────────────────────────────────────────────────

export function startDualWriteRetryWorker(): void {
  if (process.env["MKT_DUAL_WRITE_RETRY_ENABLED"] === "false") {
    logger.warn("[dualWrite:retry] Auto-retry dinonaktifkan oleh MKT_DUAL_WRITE_RETRY_ENABLED=false");
    return;
  }

  registerHeartbeat("mkt-dual-write-retry", RETRY_INTERVAL_MS);
  setTimeout(() => {
    beat("mkt-dual-write-retry");
    void retryFailedDualWrites().catch((err: unknown) => {
      logger.warn({ err }, "[dualWrite:retry] Worker cycle error");
    });

    setInterval(() => {
      beat("mkt-dual-write-retry");
      void retryFailedDualWrites().catch((err: unknown) => {
        logger.warn({ err }, "[dualWrite:retry] Worker cycle error");
      });
    }, RETRY_INTERVAL_MS);
  }, RETRY_INITIAL_DELAY_MS);

  logger.info({ initialDelayMs: RETRY_INITIAL_DELAY_MS, intervalMs: RETRY_INTERVAL_MS }, "[dualWrite:retry] Worker terdaftar");
}

export function startDualWriteIntegrityWorker(): void {
  setTimeout(() => {
    void runIntegrityCheck().catch((err: unknown) => {
      logger.warn({ err }, "[dualWrite:integrity] Worker cycle error");
    });

    setInterval(() => {
      void runIntegrityCheck().catch((err: unknown) => {
        logger.warn({ err }, "[dualWrite:integrity] Worker cycle error");
      });
    }, INTEGRITY_INTERVAL_MS);
  }, INTEGRITY_INITIAL_DELAY);

  logger.info({ initialDelayMs: INTEGRITY_INITIAL_DELAY, intervalMs: INTEGRITY_INTERVAL_MS }, "[dualWrite:integrity] Worker terdaftar");
}
