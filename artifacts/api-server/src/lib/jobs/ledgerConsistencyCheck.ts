/**
 * ledgerConsistencyCheck.ts — RULE 6: Failsafe Consistency Checker
 *
 * Cron job yang berjalan periodik untuk mendeteksi inkonsistensi:
 *  1. accounting_payments approved tapi tidak punya accounting_entry  → ORPHAN_PAYMENT
 *  2. accounting_entries tapi tidak punya accounting_entry_lines       → ORPHAN_ENTRY
 *  3. Jurnal duplikat (source_type + source_id ter-post lebih dari sekali) → DUPLICATE_JOURNAL
 *  4. bank_mutations "approved" tapi tidak ada journal terkait          → ORPHAN_MUTATION
 *
 * Setiap temuan ditulis ke ledger_consistency_alerts dan di-log ke logger.
 * Default interval: setiap 4 jam.
 */

import { db } from "@workspace/db";
import { sql } from "drizzle-orm";
import { logger } from "../logger.js";

// ─── DB migration ─────────────────────────────────────────────────────────────

let _migrated = false;

async function ensureAlertsTable(): Promise<void> {
  if (_migrated) return;
  _migrated = true;
  await db.execute(sql`
    CREATE TABLE IF NOT EXISTS ledger_consistency_alerts (
      id           BIGSERIAL PRIMARY KEY,
      alert_type   TEXT NOT NULL,
      severity     TEXT NOT NULL DEFAULT 'HIGH',
      description  TEXT NOT NULL,
      entity_type  TEXT,
      entity_id    TEXT,
      company_id   INTEGER,
      resolved     BOOLEAN NOT NULL DEFAULT FALSE,
      resolved_at  TIMESTAMPTZ,
      resolved_by  TEXT,
      created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `).catch(() => {});
  await db.execute(sql`
    CREATE INDEX IF NOT EXISTS lca_alert_type_idx ON ledger_consistency_alerts(alert_type)
  `).catch(() => {});
  await db.execute(sql`
    CREATE INDEX IF NOT EXISTS lca_resolved_idx ON ledger_consistency_alerts(resolved) WHERE resolved = FALSE
  `).catch(() => {});
  await db.execute(sql`
    CREATE INDEX IF NOT EXISTS lca_created_idx ON ledger_consistency_alerts(created_at)
  `).catch(() => {});
}

// ─── Alert writer ─────────────────────────────────────────────────────────────

async function writeAlert(opts: {
  alertType:   string;
  severity:    "LOW" | "MEDIUM" | "HIGH" | "CRITICAL";
  description: string;
  entityType?: string | null;
  entityId?:   string | number | null;
  companyId?:  number | null;
}): Promise<void> {
  await db.execute(sql`
    INSERT INTO ledger_consistency_alerts
      (alert_type, severity, description, entity_type, entity_id, company_id)
    VALUES (
      ${opts.alertType},
      ${opts.severity},
      ${opts.description},
      ${opts.entityType ?? null},
      ${opts.entityId != null ? String(opts.entityId) : null},
      ${opts.companyId ?? null}
    )
    ON CONFLICT DO NOTHING
  `).catch((e: unknown) => {
    logger.warn({ e }, "[ledgerConsistencyCheck] writeAlert failed (non-fatal)");
  });
}

// ─── Check 1: Orphan payments ─────────────────────────────────────────────────

async function checkOrphanPayments(): Promise<number> {
  const { rows } = await db.execute(sql`
    SELECT ap.id, ap.company_id, ap.source_type, ap.source_doc_id, ap.amount
    FROM accounting_payments ap
    WHERE ap.entry_id IS NULL
      AND ap.created_at < NOW() - INTERVAL '10 minutes'
    ORDER BY ap.created_at DESC
    LIMIT 50
  `);

  let found = 0;
  for (const row of rows as Array<Record<string, unknown>>) {
    found++;
    const desc = `accounting_payment #${row["id"]} (${row["source_type"]}/${row["source_doc_id"]}) tidak memiliki accounting_entry`;
    logger.warn({ paymentId: row["id"], sourceType: row["source_type"] }, `[LedgerConsistency] ORPHAN_PAYMENT — ${desc}`);
    await writeAlert({
      alertType:   "ORPHAN_PAYMENT",
      severity:    "HIGH",
      description: desc,
      entityType:  "accounting_payment",
      entityId:    String(row["id"]),
      companyId:   row["company_id"] ? Number(row["company_id"]) : null,
    });
  }
  return found;
}

// ─── Check 2: Orphan entries (no lines) ──────────────────────────────────────

async function checkOrphanEntries(): Promise<number> {
  const { rows } = await db.execute(sql`
    SELECT ae.id, ae.company_id, ae.source, ae.source_id, ae.entry_number
    FROM accounting_entries ae
    WHERE ae.status = 'posted'
      AND ae.created_at < NOW() - INTERVAL '10 minutes'
      AND NOT EXISTS (
        SELECT 1 FROM accounting_entry_lines ael WHERE ael.entry_id = ae.id
      )
    ORDER BY ae.created_at DESC
    LIMIT 50
  `);

  let found = 0;
  for (const row of rows as Array<Record<string, unknown>>) {
    found++;
    const desc = `accounting_entry #${row["id"]} (${row["entry_number"]}) status=posted tapi tidak memiliki entry_lines`;
    logger.warn({ entryId: row["id"], entryNumber: row["entry_number"] }, `[LedgerConsistency] ORPHAN_ENTRY — ${desc}`);
    await writeAlert({
      alertType:   "ORPHAN_ENTRY",
      severity:    "HIGH",
      description: desc,
      entityType:  "accounting_entry",
      entityId:    String(row["id"]),
      companyId:   row["company_id"] ? Number(row["company_id"]) : null,
    });
  }
  return found;
}

// ─── Check 3: Duplicate journals ─────────────────────────────────────────────

async function checkDuplicateJournals(): Promise<number> {
  const { rows } = await db.execute(sql`
    SELECT source, source_id, company_id, COUNT(*) AS cnt, SUM(total_debit::numeric) AS total
    FROM accounting_entries
    WHERE status = 'posted'
      AND source IS NOT NULL
      AND source_id IS NOT NULL
      AND source NOT IN ('manual', 'reversal', 'manual_payment', 'manual_journal')
    GROUP BY source, source_id, company_id
    HAVING COUNT(*) > 1
    ORDER BY COUNT(*) DESC
    LIMIT 30
  `);

  let found = 0;
  for (const row of rows as Array<Record<string, unknown>>) {
    found++;
    const desc = `Jurnal duplikat terdeteksi: source=${row["source"]} source_id=${row["source_id"]} company_id=${row["company_id"]} — ditemukan ${row["cnt"]} entri (total debit: ${row["total"]})`;
    logger.warn({ source: row["source"], sourceId: row["source_id"], cnt: row["cnt"] }, `[LedgerConsistency] DUPLICATE_JOURNAL — ${desc}`);
    await writeAlert({
      alertType:   "DUPLICATE_JOURNAL",
      severity:    "CRITICAL",
      description: desc,
      entityType:  "accounting_entry",
      entityId:    `${row["source"]}/${row["source_id"]}`,
      companyId:   row["company_id"] ? Number(row["company_id"]) : null,
    });
  }
  return found;
}

// ─── Check 4: Orphan approved mutations ──────────────────────────────────────

async function checkOrphanMutations(): Promise<number> {
  const { rows } = await db.execute(sql`
    SELECT bm.id, bm.company_id, bm.amount, bm.description, bm.approved_at
    FROM bank_mutations bm
    WHERE bm.status = 'approved'
      AND bm.journal_id IS NULL
      AND bm.approved_at < NOW() - INTERVAL '30 minutes'
    ORDER BY bm.approved_at DESC
    LIMIT 30
  `).catch(() => ({ rows: [] }));

  let found = 0;
  for (const row of rows as Array<Record<string, unknown>>) {
    found++;
    const desc = `bank_mutation #${row["id"]} status=approved tapi tidak punya journal_id`;
    logger.warn({ mutationId: row["id"] }, `[LedgerConsistency] ORPHAN_MUTATION — ${desc}`);
    await writeAlert({
      alertType:   "ORPHAN_MUTATION",
      severity:    "HIGH",
      description: desc,
      entityType:  "bank_mutation",
      entityId:    String(row["id"]),
      companyId:   row["company_id"] ? Number(row["company_id"]) : null,
    });
  }
  return found;
}

// ─── Rule 4: Event-driven spot check ─────────────────────────────────────────

/**
 * scheduleSpotCheck — Dipanggil segera setelah journal dibuat (dari _postEntryCore).
 * Memeriksa satu entry spesifik untuk inkonsistensi: tidak ada lines, atau status mismatch.
 * Non-blocking, non-fatal. Berjalan async dengan jeda minimal (50ms).
 */
export function scheduleSpotCheck(entryId: number): void {
  setTimeout(() => {
    runSpotCheck(entryId).catch((e: unknown) => {
      logger.warn({ e, entryId }, "[LedgerConsistency] spotCheck failed (non-fatal)");
    });
  }, 50);
}

async function runSpotCheck(entryId: number): Promise<void> {
  await ensureAlertsTable();

  // Check: entry ada tapi tidak punya lines
  const { rows: lineRows } = await db.execute(sql`
    SELECT COUNT(*)::int AS cnt FROM accounting_entry_lines WHERE entry_id = ${entryId}
  `).catch(() => ({ rows: [] }));
  const lineCount = Number((lineRows[0] as Record<string, unknown>)?.["cnt"] ?? 0);

  if (lineCount === 0) {
    const desc = `[SPOT] accounting_entry #${entryId} baru dibuat tapi tidak memiliki entry_lines`;
    logger.warn({ entryId }, `[LedgerConsistency] ORPHAN_ENTRY (spot) — ${desc}`);
    await writeAlert({ alertType: "ORPHAN_ENTRY", severity: "HIGH", description: desc, entityType: "accounting_entry", entityId: String(entryId) });
    return;
  }

  // Check: debit ≠ credit pada lines
  const { rows: balRows } = await db.execute(sql`
    SELECT
      SUM(debit::numeric) AS total_debit,
      SUM(credit::numeric) AS total_credit
    FROM accounting_entry_lines
    WHERE entry_id = ${entryId}
  `).catch(() => ({ rows: [] }));
  if (balRows.length > 0) {
    const td = Number((balRows[0] as Record<string, unknown>)?.["total_debit"] ?? 0);
    const tc = Number((balRows[0] as Record<string, unknown>)?.["total_credit"] ?? 0);
    const diff = Math.abs(td - tc);
    if (diff > 0.01) {
      const desc = `[SPOT] accounting_entry #${entryId}: lines tidak balance — debit ${td.toFixed(2)} ≠ credit ${tc.toFixed(2)} (selisih: ${diff.toFixed(2)})`;
      logger.warn({ entryId, td, tc, diff }, `[LedgerConsistency] UNBALANCED_ENTRY (spot) — ${desc}`);
      await writeAlert({ alertType: "UNBALANCED_ENTRY", severity: "CRITICAL", description: desc, entityType: "accounting_entry", entityId: String(entryId) });
    }
  }
}

// ─── Main runner ──────────────────────────────────────────────────────────────

export async function runLedgerConsistencyCheck(): Promise<{
  orphanPayments: number;
  orphanEntries:  number;
  duplicates:     number;
  orphanMutations: number;
}> {
  await ensureAlertsTable();

  const [orphanPayments, orphanEntries, duplicates, orphanMutations] = await Promise.all([
    checkOrphanPayments().catch(() => 0),
    checkOrphanEntries().catch(() => 0),
    checkDuplicateJournals().catch(() => 0),
    checkOrphanMutations().catch(() => 0),
  ]);

  const total = orphanPayments + orphanEntries + duplicates + orphanMutations;

  if (total > 0) {
    logger.warn(
      { orphanPayments, orphanEntries, duplicates, orphanMutations, total },
      "[LedgerConsistencyCheck] ⚠ Inkonsistensi terdeteksi — lihat ledger_consistency_alerts",
    );
  } else {
    logger.info("[LedgerConsistencyCheck] ✓ Semua pemeriksaan lulus — tidak ada inkonsistensi");
  }

  return { orphanPayments, orphanEntries, duplicates, orphanMutations };
}

// ─── Worker entry point ───────────────────────────────────────────────────────

const CHECK_INTERVAL_MS = 4 * 60 * 60 * 1000; // every 4 hours
const INITIAL_DELAY_MS  = 5 * 60 * 1000;       // 5 min after startup

export function startLedgerConsistencyWorker(): void {
  // Initial run after 5 minutes
  setTimeout(() => {
    runLedgerConsistencyCheck().catch((e: unknown) => {
      logger.warn({ e }, "[LedgerConsistencyCheck] Initial run failed (non-fatal)");
    });
  }, INITIAL_DELAY_MS);

  // Recurring run every 4 hours
  setInterval(() => {
    runLedgerConsistencyCheck().catch((e: unknown) => {
      logger.warn({ e }, "[LedgerConsistencyCheck] Scheduled run failed (non-fatal)");
    });
  }, CHECK_INTERVAL_MS);

  logger.info(
    { intervalHours: CHECK_INTERVAL_MS / 3_600_000, initialDelayMin: INITIAL_DELAY_MS / 60_000 },
    "[LedgerConsistencyCheck] Worker started",
  );
}
