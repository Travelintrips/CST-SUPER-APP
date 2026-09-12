/**
 * dataDriftDetector.ts
 *
 * READ-ONLY drift detection untuk Bank Reconciliation.
 * Menulis ke reconciliation_alerts jika ada inkonsistensi.
 * Tidak mengubah data core (mutations, matches, journal, ledger).
 */

import { db } from "@workspace/db";
import { sql } from "drizzle-orm";
import { logger } from "../logger.js";

export type DriftSeverity = "LOW" | "MEDIUM" | "HIGH";
export type DriftType = "SYNC_DRIFT" | "MATCH_DRIFT" | "MISSING_DATA" | "SYNC_LAG";

export interface DriftReport {
  type: DriftType;
  severity: DriftSeverity;
  mutation_key: string | null;
  description: string;
  detected_at: string;
}

// ── Write alert ───────────────────────────────────────────────────────────────

async function writeAlert(opts: {
  type: DriftType;
  severity: DriftSeverity;
  mutation_key: string | null;
  description: string;
}): Promise<void> {
  const keyStr = opts.mutation_key
    ? `'${opts.mutation_key.replace(/'/g, "''")}'`
    : "NULL";
  const desc = opts.description.replace(/'/g, "''").slice(0, 1000);
  await db.execute(sql.raw(`
    INSERT INTO reconciliation_alerts
      (type, severity, mutation_key, description, created_at)
    VALUES
      ('${opts.type}', '${opts.severity}', ${keyStr}, '${desc}', NOW())
  `)).catch((err: any) => {
    logger.warn({ err: err.message }, "[dataDriftDetector] writeAlert gagal (non-fatal)");
  });
}

// ── Drift checks ──────────────────────────────────────────────────────────────

/**
 * Check 1: Approved di DB tapi tidak ada approved match record
 * → Inkonsistensi internal (MATCH_DRIFT)
 */
async function checkApprovedWithoutMatch(): Promise<DriftReport[]> {
  const { rows } = await db.execute(sql.raw(`
    SELECT bm.mutation_key, bm.id
    FROM bank_mutations bm
    WHERE bm.status = 'approved'
      AND NOT EXISTS (
        SELECT 1 FROM bank_reconciliation_matches brm
        WHERE brm.mutation_id = bm.id AND brm.status = 'approved'
      )
    LIMIT 20
  `));

  const reports: DriftReport[] = [];
  for (const r of rows as any[]) {
    const desc = `Mutasi ${r.mutation_key ?? r.id} berstatus 'approved' di bank_mutations tapi tidak ada approved match di bank_reconciliation_matches`;
    reports.push({
      type: "MATCH_DRIFT",
      severity: "HIGH",
      mutation_key: r.mutation_key ?? null,
      description: desc,
      detected_at: new Date().toISOString(),
    });
    await writeAlert({ type: "MATCH_DRIFT", severity: "HIGH", mutation_key: r.mutation_key ?? null, description: desc });
  }
  return reports;
}

/**
 * Check 2: Mutasi unmatched > 24 jam (berpotensi missing data)
 * Cooldown: satu mutation_key hanya trigger alert 1x per 6 jam untuk mencegah alert storm.
 */
async function checkLongRunningUnmatched(): Promise<DriftReport[]> {
  const { rows } = await db.execute(sql.raw(`
    SELECT mutation_key, id, created_at, amount, direction
    FROM bank_mutations
    WHERE status = 'unmatched'
      AND created_at < NOW() - INTERVAL '24 hours'
    ORDER BY created_at ASC
    LIMIT 10
  `));

  // Fetch recently-alerted mutation_keys (last 6 hours) for dedup
  let recentKeys = new Set<string>();
  try {
    const { rows: recent } = await db.execute(sql.raw(`
      SELECT DISTINCT mutation_key FROM reconciliation_alerts
      WHERE type = 'MISSING_DATA'
        AND created_at > NOW() - INTERVAL '6 hours'
        AND mutation_key IS NOT NULL
    `));
    for (const r of recent as any[]) recentKeys.add(r.mutation_key);
  } catch { /* non-fatal */ }

  const reports: DriftReport[] = [];
  for (const r of rows as any[]) {
    const key = r.mutation_key ?? null;
    // Skip if we already alerted for this mutation within the last 6 hours
    if (key && recentKeys.has(key)) continue;

    const ageH = Math.round((Date.now() - new Date(r.created_at).getTime()) / 3_600_000);
    const desc = `Mutasi ${key ?? r.id} masih UNMATCHED setelah ${ageH} jam (amount=${r.amount} ${r.direction})`;
    const severity: DriftSeverity = ageH > 72 ? "HIGH" : ageH > 48 ? "MEDIUM" : "LOW";
    reports.push({
      type: "MISSING_DATA",
      severity,
      mutation_key: key,
      description: desc,
      detected_at: new Date().toISOString(),
    });
    await writeAlert({ type: "MISSING_DATA", severity, mutation_key: key, description: desc });
    if (key) recentKeys.add(key); // prevent double-fire within same run
  }
  return reports;
}

/**
 * Check 3: Sync lag — gunakan reconciliation_sync_logs (bukan bank_mutations.created_at)
 * supaya tidak false-positive ketika semua mutasi sudah ada di DB (ON CONFLICT DO NOTHING).
 * Juga hanya fire alert 1x per jam (cooldown) untuk mencegah alert storm.
 */
async function checkSyncLag(): Promise<DriftReport[]> {
  // Cek apakah ada sheet config aktif atau GOOGLE_SHEET_ID_BANK_MUTATIONS
  let hasSheetConfig = false;
  try {
    const { rows: cfgRows } = await db.execute(sql.raw(`
      SELECT COUNT(*) AS n FROM bank_sheet_configs WHERE is_active = TRUE
    `)).catch(() => ({ rows: [{ n: "0" }] }));
    hasSheetConfig = Number((cfgRows as any[])[0]?.n ?? 0) > 0;
  } catch { /* non-fatal */ }

  const legacySheetId = process.env.GOOGLE_SHEET_ID_BANK_MUTATIONS;
  if (!hasSheetConfig && !legacySheetId) return []; // sheet sync tidak aktif — skip

  // Ambil last successful sync dari reconciliation_sync_logs (bukan bank_mutations)
  let lastSyncAt: Date | null = null;
  try {
    const { rows } = await db.execute(sql.raw(`
      SELECT MAX(created_at) AS last_ok
      FROM reconciliation_sync_logs
      WHERE status = 'SUCCESS' AND sync_type = 'SHEET_TO_DB'
    `));
    const ts = (rows as any[])[0]?.last_ok;
    if (ts) lastSyncAt = new Date(ts);
  } catch { /* table may not exist */ }

  if (!lastSyncAt) {
    const desc = "Sheet sync dikonfigurasi tapi belum ada log SUCCESS di reconciliation_sync_logs";
    // Cooldown: jangan re-alert jika sudah ada SYNC_LAG alert dalam 1 jam
    const { rows: recentAlert } = await db.execute(sql.raw(`
      SELECT id FROM reconciliation_alerts
      WHERE type = 'SYNC_LAG' AND created_at > NOW() - INTERVAL '1 hour'
      LIMIT 1
    `)).catch(() => ({ rows: [] }));
    if ((recentAlert as any[]).length === 0) {
      await writeAlert({ type: "SYNC_LAG", severity: "MEDIUM", mutation_key: null, description: desc });
    }
    return [{ type: "SYNC_LAG", severity: "MEDIUM", mutation_key: null, description: desc, detected_at: new Date().toISOString() }];
  }

  const lagS = (Date.now() - lastSyncAt.getTime()) / 1000;
  if (lagS > 300) {
    // Cooldown: jangan re-alert jika sudah ada SYNC_LAG dalam 1 jam terakhir
    const { rows: recentAlert } = await db.execute(sql.raw(`
      SELECT id FROM reconciliation_alerts
      WHERE type = 'SYNC_LAG' AND created_at > NOW() - INTERVAL '1 hour'
      LIMIT 1
    `)).catch(() => ({ rows: [] }));
    if ((recentAlert as any[]).length > 0) return []; // cooldown aktif

    const lagMin = Math.round(lagS / 60);
    const severity: DriftSeverity = lagS > 600 ? "HIGH" : "MEDIUM";
    const desc = `Sheet sync lag: sync terakhir ${lagMin} menit yang lalu (threshold: 5 menit)`;
    await writeAlert({ type: "SYNC_LAG", severity, mutation_key: null, description: desc });
    return [{ type: "SYNC_LAG", severity, mutation_key: null, description: desc, detected_at: new Date().toISOString() }];
  }

  return [];
}

/**
 * Check 4: Mutasi dengan status 'matched' tapi tidak ada matched record
 */
async function checkMatchedWithoutRecord(): Promise<DriftReport[]> {
  const { rows } = await db.execute(sql.raw(`
    SELECT bm.mutation_key, bm.id
    FROM bank_mutations bm
    WHERE bm.status = 'matched'
      AND NOT EXISTS (
        SELECT 1 FROM bank_reconciliation_matches brm
        WHERE brm.mutation_id = bm.id
      )
    LIMIT 10
  `));

  const reports: DriftReport[] = [];
  for (const r of rows as any[]) {
    const desc = `Mutasi ${r.mutation_key ?? r.id} berstatus 'matched' tapi tidak ada record di bank_reconciliation_matches`;
    reports.push({
      type: "SYNC_DRIFT",
      severity: "MEDIUM",
      mutation_key: r.mutation_key ?? null,
      description: desc,
      detected_at: new Date().toISOString(),
    });
    await writeAlert({ type: "SYNC_DRIFT", severity: "MEDIUM", mutation_key: r.mutation_key ?? null, description: desc });
  }
  return reports;
}

// ── Main detector ─────────────────────────────────────────────────────────────

export interface DriftResult {
  drift_report: DriftReport[];
  drift_severity: DriftSeverity | "NONE";
  checked_at: string;
  total_issues: number;
}

export async function detectDrift(): Promise<DriftResult> {
  const checkedAt = new Date().toISOString();

  try {
    const [approvedDrift, longUnmatched, syncLag, matchedDrift] = await Promise.all([
      checkApprovedWithoutMatch().catch(() => [] as DriftReport[]),
      checkLongRunningUnmatched().catch(() => [] as DriftReport[]),
      checkSyncLag().catch(() => [] as DriftReport[]),
      checkMatchedWithoutRecord().catch(() => [] as DriftReport[]),
    ]);

    const allReports = [...approvedDrift, ...longUnmatched, ...syncLag, ...matchedDrift];
    const totalIssues = allReports.length;

    let overallSeverity: DriftSeverity | "NONE" = "NONE";
    if (allReports.some((r) => r.severity === "HIGH"))   overallSeverity = "HIGH";
    else if (allReports.some((r) => r.severity === "MEDIUM")) overallSeverity = "MEDIUM";
    else if (allReports.length > 0)                       overallSeverity = "LOW";

    if (totalIssues > 0) {
      logger.warn(
        { total: totalIssues, severity: overallSeverity, checkedAt },
        "[dataDriftDetector] Drift terdeteksi",
      );
    }

    return {
      drift_report: allReports,
      drift_severity: overallSeverity,
      checked_at: checkedAt,
      total_issues: totalIssues,
    };
  } catch (err: any) {
    logger.error({ err: err.message }, "[dataDriftDetector] detectDrift gagal");
    return {
      drift_report: [],
      drift_severity: "NONE",
      checked_at: checkedAt,
      total_issues: 0,
    };
  }
}

// ── Periodic drift check worker ───────────────────────────────────────────────

export function startDriftMonitorWorker(): void {
  const INTERVAL_MS = 5 * 60 * 1000; // setiap 5 menit

  logger.info("[dataDriftDetector] Drift monitor dimulai (interval: 5 menit)");

  setTimeout(() => {
    const tick = () =>
      detectDrift().catch((err: any) =>
        logger.warn({ err: err?.message }, "[dataDriftDetector] Periodic check gagal (non-fatal)"),
      );

    tick();
    setInterval(tick, INTERVAL_MS).unref();
  }, 30_000).unref(); // delay 30s setelah startup
}
