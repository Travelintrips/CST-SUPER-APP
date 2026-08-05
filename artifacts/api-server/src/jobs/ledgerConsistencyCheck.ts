/**
 * Ledger Consistency Checker — Rule 6
 *
 * Cron job yang berjalan setiap 30 menit untuk memvalidasi:
 * 1. approved mutations tanpa journal → CRITICAL ALERT
 * 2. draft journals dari bank_reconciliation tanpa mutation approved → WARN
 * 3. duplicate journals (same ref + amount, status=posted) → CRITICAL ALERT
 */

import { db } from "@workspace/db";
import { sql } from "drizzle-orm";
import { logger } from "../lib/logger.js";
import { emitFinancialEvent } from "../lib/financialEventBus.js";

// ─── Migration ────────────────────────────────────────────────────────────────

let alertTableMigrated = false;

async function runAlertMigration(): Promise<void> {
  if (alertTableMigrated) return;
  alertTableMigrated = true;

  await db.execute(sql.raw(`
    CREATE TABLE IF NOT EXISTS ledger_consistency_alerts (
      id           BIGSERIAL PRIMARY KEY,
      alert_type   TEXT NOT NULL,
      severity     TEXT NOT NULL DEFAULT 'WARN',
      entity_type  TEXT,
      entity_id    TEXT,
      detail       JSONB,
      resolved_at  TIMESTAMPTZ,
      resolved_by  TEXT,
      created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `)).catch(() => {});

  await db.execute(sql.raw(
    `CREATE INDEX IF NOT EXISTS lca_alert_type_idx ON ledger_consistency_alerts(alert_type)`
  )).catch(() => {});

  await db.execute(sql.raw(
    `CREATE INDEX IF NOT EXISTS lca_unresolved_idx ON ledger_consistency_alerts(created_at) WHERE resolved_at IS NULL`
  )).catch(() => {});
}

// ─── Internal helpers ─────────────────────────────────────────────────────────

async function writeAlert(
  alertType: string,
  severity: "INFO" | "WARN" | "CRITICAL",
  entityType: string,
  entityId: string,
  detail: Record<string, unknown>,
): Promise<void> {
  try {
    const detailJson = JSON.stringify(detail).replace(/'/g, "''");
    await db.execute(sql.raw(`
      INSERT INTO ledger_consistency_alerts
        (alert_type, severity, entity_type, entity_id, detail)
      VALUES
        ('${alertType}', '${severity}', '${entityType}', '${entityId}',
         '${detailJson}'::jsonb)
    `));
  } catch {}
}

// ─── Core checks ─────────────────────────────────────────────────────────────

export async function runLedgerConsistencyCheck(): Promise<{
  orphanApproved: number;
  orphanJournals: number;
  duplicates: number;
  errors: string[];
}> {
  await runAlertMigration();

  const errors: string[] = [];
  let orphanApproved = 0;
  let orphanJournals = 0;
  let duplicates = 0;

  // ── CHECK 1: Approved mutations WITHOUT journal_entry_id ──────────────────
  try {
    const { rows } = await db.execute(sql.raw(`
      SELECT id, amount, transaction_date, mutation_key, company_id
      FROM bank_mutations
      WHERE status = 'approved'
        AND journal_entry_id IS NULL
        AND created_at < NOW() - INTERVAL '10 minutes'
      LIMIT 50
    `)).catch(() => ({ rows: [] })) as any;

    for (const row of rows as any[]) {
      orphanApproved++;
      logger.warn(
        { mutId: row.id, amount: row.amount, date: row.transaction_date },
        "[LedgerConsistency] CHECK1 ORPHAN: mutation approved tanpa journal"
      );
      await writeAlert("ORPHAN_APPROVED_MUTATION", "CRITICAL", "bank_mutation", String(row.id), {
        amount: row.amount,
        transaction_date: row.transaction_date,
        mutation_key: row.mutation_key,
      });
      emitFinancialEvent({
        event_type: "ORPHAN_MUTATION",
        source_type: "bank_mutation",
        entity_type: "bank_mutation",
        entity_id: row.id,
        payload: { check: "approved_without_journal", amount: row.amount },
        company_id: row.company_id ?? null,
      });
    }
  } catch (e: any) {
    errors.push(`CHECK1 error: ${e.message}`);
    logger.warn({ err: e.message }, "[LedgerConsistency] CHECK1 failed");
  }

  // ── CHECK 2: Draft reconciliation journals WITHOUT approved mutation ───────
  try {
    const { rows } = await db.execute(sql.raw(`
      SELECT ae.id, ae.ref, ae.date, ae.total_debit, ae.source_module, ae.ledger_source_type
      FROM accounting_entries ae
      WHERE (
              ae.source_module = 'bank_reconciliation'
              OR ae.ledger_source_type = 'RECONCILIATION'
              OR ae.source = 'bank_mutation_import'
            )
        AND ae.status = 'draft'
        AND ae.voided_at IS NULL
        AND ae.ref IS NOT NULL
        AND NOT EXISTS (
          SELECT 1 FROM bank_mutations bm
          WHERE bm.mutation_key = ae.ref
            AND bm.status = 'approved'
        )
        AND ae.created_at < NOW() - INTERVAL '10 minutes'
      LIMIT 50
    `)).catch(() => ({ rows: [] })) as any;

    for (const row of rows as any[]) {
      orphanJournals++;
      logger.warn(
        { entryId: row.id, ref: row.ref },
        "[LedgerConsistency] CHECK2 ORPHAN: reconciliation journal tanpa mutation approved"
      );
      await writeAlert("ORPHAN_RECONCILIATION_JOURNAL", "WARN", "accounting_entry", String(row.id), {
        ref: row.ref,
        date: row.date,
        total_debit: row.total_debit,
        source_module: row.source_module,
      });
    }
  } catch (e: any) {
    errors.push(`CHECK2 error: ${e.message}`);
    logger.warn({ err: e.message }, "[LedgerConsistency] CHECK2 failed");
  }

  // ── CHECK 3: Duplicate journals (same ref + total_debit, posted, not voided) ─
  try {
    const { rows } = await db.execute(sql.raw(`
      SELECT ae.ref,
             ae.total_debit::TEXT as amount,
             COUNT(*)             AS cnt,
             array_agg(ae.id ORDER BY ae.id)::TEXT AS entry_ids_txt
      FROM accounting_entries ae
      WHERE ae.status = 'posted'
        AND ae.ref IS NOT NULL
        AND ae.voided_at IS NULL
        AND ae.created_at > NOW() - INTERVAL '7 days'
      GROUP BY ae.ref, ae.total_debit
      HAVING COUNT(*) > 1
      LIMIT 20
    `)).catch(() => ({ rows: [] })) as any;

    for (const row of rows as any[]) {
      duplicates++;
      logger.warn(
        { ref: row.ref, count: row.cnt, entry_ids: row.entry_ids_txt },
        "[LedgerConsistency] CHECK3 DUPLICATE: journal ganda ditemukan"
      );
      // Parse first id from the array text like '{1,2,3}'
      const firstId = String(row.entry_ids_txt ?? "").replace(/[{}]/g, "").split(",")[0] ?? "0";
      await writeAlert("DUPLICATE_JOURNAL", "CRITICAL", "accounting_entry", firstId, {
        ref: row.ref,
        amount: row.amount,
        count: row.cnt,
        entry_ids: row.entry_ids_txt,
      });
      emitFinancialEvent({
        event_type: "DUPLICATE_JOURNAL",
        source_type: "accounting_entry",
        entity_type: "accounting_entry",
        entity_id: firstId,
        payload: { ref: row.ref, count: row.cnt, entry_ids: row.entry_ids_txt },
        company_id: null,
      });
    }
  } catch (e: any) {
    errors.push(`CHECK3 error: ${e.message}`);
    logger.warn({ err: e.message }, "[LedgerConsistency] CHECK3 failed");
  }

  const total = orphanApproved + orphanJournals + duplicates;
  if (total > 0) {
    logger.warn(
      { orphanApproved, orphanJournals, duplicates, errors: errors.length },
      "[LedgerConsistency] run selesai — ada alert"
    );
  } else {
    logger.info({ errors: errors.length }, "[LedgerConsistency] run selesai — clean");
  }

  return { orphanApproved, orphanJournals, duplicates, errors };
}

// ─── Worker entry point ───────────────────────────────────────────────────────

export function startLedgerConsistencyChecker(): void {
  const INTERVAL_MS = 30 * 60 * 1000; // 30 menit

  const tick = () => {
    runLedgerConsistencyCheck()
      .catch((err) => logger.warn({ err }, "[LedgerConsistency] tick error (non-fatal)"))
      .finally(() => setTimeout(tick, INTERVAL_MS).unref());
  };

  // Jalankan pertama kali setelah 2 menit (beri waktu server stabilize)
  setTimeout(tick, 2 * 60 * 1000).unref();
  logger.info("[LedgerConsistency] checker started (interval: 30min, first run: +2min)");
}
