/**
 * reconciliationMonitor.ts
 *
 * READ-ONLY production metrics collector untuk Bank Reconciliation.
 * Tidak mengubah engine, ledger, atau matching logic.
 */

import { db } from "@workspace/db";
import { sql } from "drizzle-orm";
import { logger } from "../logger.js";

export interface ReconciliationMetrics {
  total_mutations: number;
  matched_count: number;
  unmatched_count: number;
  approved_count: number;
  rejected_count: number;
  manual_review_count: number;
  approval_rate: number;
  sync_lag_seconds: number | null;
  last_sync_time: string | null;
  last_sheet_sync_time: string | null;
}

export interface HealthStatus {
  status: "healthy" | "degraded" | "critical";
  metrics: ReconciliationMetrics;
  last_sync_time: string | null;
  drift_detected: boolean;
  alerts_last_hour: number;
  checked_at: string;
}

export interface ThroughputStats {
  per_minute: number;
  per_hour: number;
  last_24h: number;
}

export interface DashboardMetrics {
  throughput: ThroughputStats;
  sync_health: "good" | "slow" | "broken";
  drift_status: "clean" | "warning" | "critical";
  last_24h_stats: {
    mutations: number;
    matched: number;
    unmatched: number;
    approved: number;
  };
  last_sync: {
    time: string | null;
    status: string | null;
    records_processed: number;
    records_failed: number;
    execution_time_ms: number | null;
  };
}

// ── Core metrics query ────────────────────────────────────────────────────────

export async function getReconciliationMetrics(): Promise<ReconciliationMetrics> {
  const { rows } = await db.execute(sql.raw(`
    SELECT
      COUNT(*)::int                                          AS total_mutations,
      COUNT(*) FILTER (WHERE status = 'matched')::int        AS matched_count,
      COUNT(*) FILTER (WHERE status = 'unmatched')::int      AS unmatched_count,
      COUNT(*) FILTER (WHERE status = 'approved')::int       AS approved_count,
      COUNT(*) FILTER (WHERE status = 'rejected')::int       AS rejected_count,
      COUNT(*) FILTER (WHERE status = 'manual_review')::int  AS manual_review_count,
      NULL AS last_sheet_sync_time
    FROM bank_mutations
  `));

  const r = (rows as any[])[0] ?? {};
  const total = Number(r.total_mutations ?? 0);
  const approved = Number(r.approved_count ?? 0);

  // Last sync from reconciliation_sync_logs (source of truth — not bank_mutations.created_at
  // which never updates for existing rows due to ON CONFLICT DO NOTHING).
  let lastSyncTime: string | null = null;
  let lastSheetSync: string | null = null;
  let syncLagSeconds: number | null = null;
  try {
    const { rows: sl } = await db.execute(sql.raw(`
      SELECT created_at FROM reconciliation_sync_logs
      WHERE status = 'SUCCESS'
      ORDER BY created_at DESC LIMIT 1
    `));
    if ((sl as any[])[0]) {
      lastSyncTime = new Date((sl as any[])[0].created_at).toISOString();
    }
    // For sheet-specific lag, also check SHEET_TO_DB sync type
    const { rows: sheetSl } = await db.execute(sql.raw(`
      SELECT created_at FROM reconciliation_sync_logs
      WHERE status = 'SUCCESS' AND sync_type = 'SHEET_TO_DB'
      ORDER BY created_at DESC LIMIT 1
    `));
    if ((sheetSl as any[])[0]) {
      lastSheetSync = new Date((sheetSl as any[])[0].created_at).toISOString();
      syncLagSeconds = Math.round((Date.now() - new Date(lastSheetSync).getTime()) / 1000);
    }
  } catch { /* table may not exist yet */ }

  return {
    total_mutations: total,
    matched_count: Number(r.matched_count ?? 0),
    unmatched_count: Number(r.unmatched_count ?? 0),
    approved_count: approved,
    rejected_count: Number(r.rejected_count ?? 0),
    manual_review_count: Number(r.manual_review_count ?? 0),
    approval_rate: total > 0 ? Math.round((approved / total) * 100) : 0,
    sync_lag_seconds: syncLagSeconds,
    last_sync_time: lastSyncTime,
    last_sheet_sync_time: lastSheetSync,
  };
}

// ── Health status ─────────────────────────────────────────────────────────────

export async function getHealthStatus(): Promise<HealthStatus> {
  const metrics = await getReconciliationMetrics();

  // Count alerts in last hour
  let alertsLastHour = 0;
  try {
    const { rows: ar } = await db.execute(sql.raw(`
      SELECT COUNT(*)::int AS cnt FROM reconciliation_alerts
      WHERE created_at > NOW() - INTERVAL '1 hour'
    `));
    alertsLastHour = Number((ar as any[])[0]?.cnt ?? 0);
  } catch { /* table may not exist yet */ }

  const driftDetected = alertsLastHour > 0;

  // Status logic
  const SYNC_LAG_CRITICAL = 600;  // 10 min
  const SYNC_LAG_DEGRADED = 300;  // 5 min

  let status: "healthy" | "degraded" | "critical" = "healthy";

  if (
    (metrics.sync_lag_seconds !== null && metrics.sync_lag_seconds > SYNC_LAG_CRITICAL) ||
    alertsLastHour >= 5
  ) {
    status = "critical";
  } else if (
    (metrics.sync_lag_seconds !== null && metrics.sync_lag_seconds > SYNC_LAG_DEGRADED) ||
    alertsLastHour >= 2
  ) {
    status = "degraded";
  }

  return {
    status,
    metrics,
    last_sync_time: metrics.last_sync_time,
    drift_detected: driftDetected,
    alerts_last_hour: alertsLastHour,
    checked_at: new Date().toISOString(),
  };
}

// ── Dashboard metrics ─────────────────────────────────────────────────────────

export async function getDashboardMetrics(): Promise<DashboardMetrics> {
  // Throughput
  const { rows: tp } = await db.execute(sql.raw(`
    SELECT
      COUNT(*) FILTER (WHERE created_at > NOW() - INTERVAL '1 minute')::int  AS per_minute,
      COUNT(*) FILTER (WHERE created_at > NOW() - INTERVAL '1 hour')::int    AS per_hour,
      COUNT(*) FILTER (WHERE created_at > NOW() - INTERVAL '24 hours')::int  AS last_24h
    FROM bank_mutations
  `));
  const tpr = (tp as any[])[0] ?? {};

  // Last 24h stats
  const { rows: daily } = await db.execute(sql.raw(`
    SELECT
      COUNT(*)::int                                         AS mutations,
      COUNT(*) FILTER (WHERE status IN ('matched','approved'))::int AS matched,
      COUNT(*) FILTER (WHERE status = 'unmatched')::int     AS unmatched,
      COUNT(*) FILTER (WHERE status = 'approved')::int      AS approved
    FROM bank_mutations
    WHERE created_at > NOW() - INTERVAL '24 hours'
  `));
  const dr = (daily as any[])[0] ?? {};

  // Last sync log
  let lastSync = {
    time: null as string | null,
    status: null as string | null,
    records_processed: 0,
    records_failed: 0,
    execution_time_ms: null as number | null,
  };
  try {
    const { rows: sl } = await db.execute(sql.raw(`
      SELECT created_at, status, records_processed, records_failed, execution_time_ms
      FROM reconciliation_sync_logs
      ORDER BY created_at DESC LIMIT 1
    `));
    if ((sl as any[])[0]) {
      const s = (sl as any[])[0];
      lastSync = {
        time: new Date(s.created_at).toISOString(),
        status: s.status,
        records_processed: Number(s.records_processed ?? 0),
        records_failed: Number(s.records_failed ?? 0),
        execution_time_ms: s.execution_time_ms ? Number(s.execution_time_ms) : null,
      };
    }
  } catch { /* table may not exist yet */ }

  // Sync health
  let syncHealth: "good" | "slow" | "broken" = "good";
  if (!lastSync.time) {
    syncHealth = "broken";
  } else {
    const lagS = (Date.now() - new Date(lastSync.time).getTime()) / 1000;
    if (lagS > 600) syncHealth = "broken";
    else if (lagS > 180) syncHealth = "slow";
  }

  // Drift status
  let driftStatus: "clean" | "warning" | "critical" = "clean";
  try {
    const { rows: da } = await db.execute(sql.raw(`
      SELECT
        COUNT(*) FILTER (WHERE severity = 'HIGH')::int    AS high_count,
        COUNT(*) FILTER (WHERE severity = 'MEDIUM')::int  AS med_count
      FROM reconciliation_alerts
      WHERE created_at > NOW() - INTERVAL '1 hour'
    `));
    const hr = (da as any[])[0] ?? {};
    if (Number(hr.high_count ?? 0) > 0) driftStatus = "critical";
    else if (Number(hr.med_count ?? 0) > 0) driftStatus = "warning";
  } catch { /* table may not exist yet */ }

  return {
    throughput: {
      per_minute: Number(tpr.per_minute ?? 0),
      per_hour: Number(tpr.per_hour ?? 0),
      last_24h: Number(tpr.last_24h ?? 0),
    },
    sync_health: syncHealth,
    drift_status: driftStatus,
    last_24h_stats: {
      mutations: Number(dr.mutations ?? 0),
      matched: Number(dr.matched ?? 0),
      unmatched: Number(dr.unmatched ?? 0),
      approved: Number(dr.approved ?? 0),
    },
    last_sync: lastSync,
  };
}

// ── Sync log writer (called from sheetSyncService) ───────────────────────────

export async function logSyncResult(opts: {
  sync_type: "SHEET_TO_DB" | "DB_TO_SHEET";
  status: "SUCCESS" | "FAILED";
  records_processed: number;
  records_failed: number;
  execution_time_ms: number;
  error_message?: string | null;
}): Promise<void> {
  try {
    const errSql = opts.error_message
      ? `'${opts.error_message.replace(/'/g, "''").slice(0, 500)}'`
      : "NULL";
    await db.execute(sql.raw(`
      INSERT INTO reconciliation_sync_logs
        (sync_type, status, records_processed, records_failed, execution_time_ms, error_message, created_at)
      VALUES
        ('${opts.sync_type}', '${opts.status}', ${opts.records_processed},
         ${opts.records_failed}, ${opts.execution_time_ms}, ${errSql}, NOW())
    `));
  } catch (err: any) {
    logger.warn({ err: err.message }, "[reconciliationMonitor] logSyncResult gagal (non-fatal)");
  }
}
