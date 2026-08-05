/**
 * Financial Event Bus — CST ERP
 *
 * Central event-driven layer di atas Accounting Engine.
 * Setiap transaksi keuangan (normalization, posting, reconciliation)
 * menghasilkan event yang disimpan di `financial_event_bus`.
 *
 * Pattern: fire-and-forget emit → background processor picks up PENDING events.
 * Idempotency: unique_key = entity_type + entity_id + event_type (ON CONFLICT DO NOTHING).
 */

import { db } from "@workspace/db";
import { sql } from "drizzle-orm";
import { logger } from "./logger.js";
import { registerHeartbeat, beat } from "./workerHeartbeat.js";

// ─── Types ────────────────────────────────────────────────────────────────────

export type FinancialEventType =
  | "BANK_MUTATION_POSTED"
  | "ENTRY_POSTED"
  | "ENTRY_SKIPPED"
  | "ENTRY_REVERSED"
  | "RECONCILED"
  | "UNMATCHED"
  | "NEED_REVIEW"
  | "COA_DRIFT_DETECTED"
  | "NORMALIZED_ENTRY_CREATED"
  | "SUPERSEDED"
  | "ORPHAN_MUTATION"
  | "DUPLICATE_JOURNAL";

export type FinancialEntityType =
  | "bank_mutation"
  | "accounting_entry"
  | "normalized_entry";

export type FinancialSourceType =
  | "bank_mutation"
  | "accounting_entry"
  | "normalized_entry";

export interface FinancialEvent {
  event_type: FinancialEventType;
  source_type: FinancialSourceType;
  entity_type: FinancialEntityType;
  entity_id: number | string;
  payload?: Record<string, unknown>;
  company_id?: number | null;
  cost_center_id?: string | null;
  business_unit_id?: string | null;
}

// ─── Migration ────────────────────────────────────────────────────────────────

let busMigrated = false;

export async function runFinancialEventBusMigration(): Promise<void> {
  if (busMigrated) return;
  await db.execute(sql.raw(`
    CREATE TABLE IF NOT EXISTS financial_event_bus (
      id              BIGSERIAL PRIMARY KEY,
      event_type      TEXT NOT NULL,
      source_type     TEXT NOT NULL,
      entity_type     TEXT NOT NULL,
      entity_id       TEXT NOT NULL,
      payload         JSONB,
      company_id      INTEGER,
      cost_center_id  TEXT,
      business_unit_id TEXT,
      status          TEXT NOT NULL DEFAULT 'PENDING',
      retry_count     INTEGER NOT NULL DEFAULT 0,
      error_message   TEXT,
      created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      processed_at    TIMESTAMPTZ
    )
  `));
  await db.execute(sql.raw(`
    CREATE UNIQUE INDEX IF NOT EXISTS feb_idempotency_idx
      ON financial_event_bus(entity_type, entity_id, event_type)
      WHERE status != 'FAILED'
  `));
  await db.execute(sql.raw(`
    CREATE INDEX IF NOT EXISTS feb_status_idx ON financial_event_bus(status) WHERE status = 'PENDING'
  `));
  await db.execute(sql.raw(`
    CREATE INDEX IF NOT EXISTS feb_entity_idx ON financial_event_bus(entity_type, entity_id)
  `));
  busMigrated = true;
}

// ─── Emit (fire-and-forget) ───────────────────────────────────────────────────

export function emitFinancialEvent(event: FinancialEvent): void {
  const {
    event_type, source_type, entity_type,
    entity_id, payload, company_id, cost_center_id, business_unit_id,
  } = event;
  const payloadJson = payload ? JSON.stringify(payload).replace(/'/g, "''") : null;
  const entityIdStr = String(entity_id).replace(/'/g, "''");
  const payloadClause = payloadJson ? `'${payloadJson}'::jsonb` : "NULL";
  const companyClause = company_id != null ? String(company_id) : "NULL";
  const ccClause = cost_center_id ? `'${String(cost_center_id).replace(/'/g, "''")}'` : "NULL";
  const buClause = business_unit_id ? `'${String(business_unit_id).replace(/'/g, "''")}'` : "NULL";

  // Fire-and-forget — does not block caller
  runFinancialEventBusMigration()
    .then(() =>
      db.execute(sql.raw(`
        INSERT INTO financial_event_bus
          (event_type, source_type, entity_type, entity_id,
           payload, company_id, cost_center_id, business_unit_id)
        VALUES
          ('${event_type}', '${source_type}', '${entity_type}', '${entityIdStr}',
           ${payloadClause}, ${companyClause}, ${ccClause}, ${buClause})
        ON CONFLICT (entity_type, entity_id, event_type)
          WHERE status != 'FAILED'
        DO NOTHING
      `))
    )
    .catch((err) =>
      logger.warn({ err, event_type, entity_type, entity_id }, "[FinancialEventBus] emit failed (non-fatal)")
    );
}

// ─── Module Sync Dispatcher ───────────────────────────────────────────────────

async function dispatchEvent(event: Record<string, any>): Promise<void> {
  const t = event.event_type as string;
  const payload = (event.payload as any) ?? {};
  const companyId = event.company_id as number | null;

  switch (t) {
    case "ENTRY_POSTED":
    case "BANK_MUTATION_POSTED": {
      const category = payload.erp_category as string | undefined;
      if (!category || !companyId) break;

      if (category.startsWith("SPORT_CENTER") || category.startsWith("REVENUE_GYM")) {
        await db.execute(sql.raw(`
          UPDATE sport_center_revenue_summary
          SET needs_refresh = TRUE, updated_at = NOW()
          WHERE company_id = ${companyId}
        `)).catch(() => null);
      }
      if (category.startsWith("TENANT") || category.startsWith("REVENUE_TENANT")) {
        await db.execute(sql.raw(`
          UPDATE tenant_revenue_summary
          SET needs_refresh = TRUE, updated_at = NOW()
          WHERE company_id = ${companyId}
        `)).catch(() => null);
      }
      if (category.startsWith("LOGISTICS") || category.startsWith("REVENUE_LOGISTICS")) {
        const shipmentId = payload.shipment_id as number | undefined;
        if (shipmentId) {
          await db.execute(sql.raw(`
            UPDATE freight_shipments
            SET profitability_stale = TRUE, updated_at = NOW()
            WHERE id = ${shipmentId}
          `)).catch(() => null);
        }
      }
      break;
    }

    case "COA_DRIFT_DETECTED": {
      logger.warn(
        { entity_id: event.entity_id, payload },
        "[FinancialEventBus] COA Drift detected — manual review required"
      );
      break;
    }

    case "RECONCILED": {
      logger.info({ entity_id: event.entity_id }, "[FinancialEventBus] Reconciliation matched");
      break;
    }

    default:
      break;
  }
}

// ─── Event Processor Worker ───────────────────────────────────────────────────

const BATCH_SIZE = 50;
const MAX_RETRY = 3;
const POLL_INTERVAL_MS = 15_000;

export async function processFinancialEvents(): Promise<{ processed: number; failed: number }> {
  await runFinancialEventBusMigration();

  const { rows } = await db.execute(sql.raw(`
    SELECT * FROM financial_event_bus
    WHERE status = 'PENDING' AND retry_count < ${MAX_RETRY}
    ORDER BY id ASC
    LIMIT ${BATCH_SIZE}
    FOR UPDATE SKIP LOCKED
  `)).catch(() => ({ rows: [] }));

  let processed = 0;
  let failed = 0;

  for (const ev of rows as any[]) {
    try {
      await dispatchEvent(ev);
      await db.execute(sql.raw(`
        UPDATE financial_event_bus
        SET status = 'PROCESSED', processed_at = NOW()
        WHERE id = ${ev.id}
      `));
      processed++;
    } catch (err: any) {
      const newRetry = (Number(ev.retry_count) || 0) + 1;
      const newStatus = newRetry >= MAX_RETRY ? "FAILED" : "PENDING";
      const errMsg = String(err?.message ?? "unknown").replace(/'/g, "''").slice(0, 500);
      await db.execute(sql.raw(`
        UPDATE financial_event_bus
        SET retry_count = ${newRetry}, status = '${newStatus}',
            error_message = '${errMsg}', processed_at = NOW()
        WHERE id = ${ev.id}
      `)).catch(() => null);
      logger.warn({ err, eventId: ev.id, type: ev.event_type }, "[FinancialEventBus] dispatch error");
      failed++;
    }
  }

  return { processed, failed };
}

export function startFinancialEventBusWorker(): void {
  registerHeartbeat("financial-event-bus", POLL_INTERVAL_MS);
  const tick = () => {
    beat("financial-event-bus");
    processFinancialEvents()
      .then(({ processed, failed }) => {
        if (processed > 0 || failed > 0) {
          logger.info({ processed, failed }, "[FinancialEventBus] tick complete");
        }
      })
      .catch((err) => logger.warn({ err }, "[FinancialEventBus] worker tick error"))
      .finally(() => setTimeout(tick, POLL_INTERVAL_MS).unref());
  };
  setTimeout(tick, POLL_INTERVAL_MS).unref();
  logger.info("[FinancialEventBus] worker started (poll every 15s)");
}

// ─── Backfill Job ─────────────────────────────────────────────────────────────

export async function rebuildFinancialEvents(): Promise<{ inserted: number }> {
  await runFinancialEventBusMigration();
  let inserted = 0;

  // Backfill from accounting_entries (source = bank_mutation_normalized)
  const { rows: entries } = await db.execute(sql.raw(`
    SELECT ae.id, ae.company_id, ae.source_id, ae.date,
           ae.description, ae.cost_center_id
    FROM accounting_entries ae
    WHERE ae.source = 'bank_mutation_normalized'
    LIMIT 5000
  `));

  for (const ae of entries as any[]) {
    const payload = JSON.stringify({
      entry_id: ae.id, date: ae.date, description: ae.description,
    }).replace(/'/g, "''");
    const ccClause = ae.cost_center_id ? `'${String(ae.cost_center_id).replace(/'/g, "''")}'` : "NULL";
    const compClause = ae.company_id != null ? String(ae.company_id) : "NULL";
    const { rowCount } = await db.execute(sql.raw(`
      INSERT INTO financial_event_bus
        (event_type, source_type, entity_type, entity_id, payload, company_id, cost_center_id, status, processed_at)
      VALUES
        ('ENTRY_POSTED', 'accounting_entry', 'accounting_entry', '${ae.id}',
         '${payload}'::jsonb, ${compClause}, ${ccClause}, 'PROCESSED', NOW())
      ON CONFLICT (entity_type, entity_id, event_type)
        WHERE status != 'FAILED'
      DO NOTHING
    `)).catch(() => ({ rowCount: 0 })) as any;
    if ((rowCount ?? 0) > 0) inserted++;
  }

  // Backfill from normalized_entries POSTED
  const { rows: normalized } = await db.execute(sql.raw(`
    SELECT id, batch_id, company_id, cost_center_id, erp_category, journal_entry_id
    FROM bank_mutation_normalized_entries
    WHERE status IN ('POSTED', 'MATCHED')
    LIMIT 5000
  `));

  for (const ne of normalized as any[]) {
    const payload = JSON.stringify({
      batch_id: ne.batch_id, erp_category: ne.erp_category,
      journal_entry_id: ne.journal_entry_id,
    }).replace(/'/g, "''");
    const compClause = ne.company_id != null ? String(ne.company_id) : "NULL";
    const ccClause = ne.cost_center_id ? `'${String(ne.cost_center_id).replace(/'/g, "''")}'` : "NULL";
    const { rowCount } = await db.execute(sql.raw(`
      INSERT INTO financial_event_bus
        (event_type, source_type, entity_type, entity_id, payload, company_id, cost_center_id, status, processed_at)
      VALUES
        ('NORMALIZED_ENTRY_CREATED', 'normalized_entry', 'normalized_entry', '${ne.id}',
         '${payload}'::jsonb, ${compClause}, ${ccClause}, 'PROCESSED', NOW())
      ON CONFLICT (entity_type, entity_id, event_type)
        WHERE status != 'FAILED'
      DO NOTHING
    `)).catch(() => ({ rowCount: 0 })) as any;
    if ((rowCount ?? 0) > 0) inserted++;
  }

  logger.info({ inserted }, "[FinancialEventBus] backfill complete");
  return { inserted };
}
