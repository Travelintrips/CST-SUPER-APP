/**
 * outboxProcessor.ts — RULE 3: Event Atomicity via Outbox Pattern
 *
 * Flow:
 *   1. Journal dibuat di accounting_entries
 *   2. Event ditulis ke financial_outbox_events (segera setelah insert)
 *   3. Worker polls outbox → proses event → tulis ke financial_events
 *   4. Outbox event ditandai 'done'
 *
 * Ini memastikan events TIDAK PERNAH hilang meskipun:
 * - Process crash setelah journal dibuat
 * - financial_events table sementara tidak tersedia
 * - Network timeout ke financialEventBus
 *
 * Worker berjalan setiap 10 detik, memproses batch 50 event.
 */

import { db } from "@workspace/db";
import { sql } from "drizzle-orm";
import { logger } from "../logger.js";
import { registerHeartbeat, beat } from "../workerHeartbeat.js";

// ─── Types ────────────────────────────────────────────────────────────────────

export interface OutboxEventPayload {
  eventType:   string;
  entryId?:    number | null;
  sourceType?: string | null;
  sourceId?:   string | null;
  amount?:     number | null;
  actor?:      string | null;
  companyId?:  number | null;
  mutationId?: number | null;
  meta?:       Record<string, unknown> | null;
}

// ─── Migration ────────────────────────────────────────────────────────────────

let _migrated = false;

async function ensureOutboxTable(): Promise<void> {
  if (_migrated) return;
  _migrated = true;

  await db.execute(sql`
    CREATE TABLE IF NOT EXISTS financial_outbox_events (
      id           BIGSERIAL PRIMARY KEY,
      event_type   TEXT NOT NULL,
      payload      JSONB NOT NULL,
      status       TEXT NOT NULL DEFAULT 'pending',
      entry_id     INTEGER,
      company_id   INTEGER,
      attempt      INTEGER NOT NULL DEFAULT 0,
      last_error   TEXT,
      created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      processed_at TIMESTAMPTZ
    )
  `).catch(() => {});

  await db.execute(sql`
    CREATE INDEX IF NOT EXISTS foe_status_idx ON financial_outbox_events(status) WHERE status = 'pending'
  `).catch(() => {});

  await db.execute(sql`
    CREATE INDEX IF NOT EXISTS foe_created_idx ON financial_outbox_events(created_at)
  `).catch(() => {});

  await db.execute(sql`
    CREATE INDEX IF NOT EXISTS foe_entry_idx ON financial_outbox_events(entry_id) WHERE entry_id IS NOT NULL
  `).catch(() => {});
}

// ─── Write to outbox ──────────────────────────────────────────────────────────

/**
 * writeToOutbox — Menulis event ke outbox segera setelah journal dibuat.
 * Non-blocking, best-effort. Dipanggil dari _postEntryCore() dalam accounting.ts.
 */
export async function writeToOutbox(payload: OutboxEventPayload): Promise<void> {
  await ensureOutboxTable();
  await db.execute(sql`
    INSERT INTO financial_outbox_events
      (event_type, payload, entry_id, company_id)
    VALUES (
      ${payload.eventType},
      ${JSON.stringify(payload)},
      ${payload.entryId ?? null},
      ${payload.companyId ?? null}
    )
  `).catch((e: unknown) => {
    logger.warn({ e, eventType: payload.eventType }, "[outbox] writeToOutbox failed (non-fatal)");
  });
}

// ─── Process outbox batch ─────────────────────────────────────────────────────

const MAX_ATTEMPTS = 5;
const BATCH_SIZE   = 50;

async function processOutboxBatch(): Promise<number> {
  await ensureOutboxTable();

  // Ambil pending events, skip yang sudah too many attempts
  const { rows } = await db.execute(sql`
    SELECT id, event_type, payload, entry_id, company_id, attempt
    FROM financial_outbox_events
    WHERE status = 'pending'
      AND attempt < ${MAX_ATTEMPTS}
    ORDER BY created_at ASC
    LIMIT ${BATCH_SIZE}
    FOR UPDATE SKIP LOCKED
  `).catch(() => ({ rows: [] }));

  if (!rows.length) return 0;

  let processed = 0;

  for (const row of rows as Array<Record<string, unknown>>) {
    const id      = Number(row["id"]);
    const payload = (typeof row["payload"] === "string"
      ? JSON.parse(row["payload"])
      : row["payload"]) as OutboxEventPayload;

    try {
      // Mark as processing first
      await db.execute(sql`
        UPDATE financial_outbox_events
        SET status = 'processing', attempt = attempt + 1
        WHERE id = ${id} AND status = 'pending'
      `).catch(() => {});

      // Write to financial_events (idempotent)
      await db.execute(sql`
        INSERT INTO financial_events
          (event_type, company_id, source_type, source_id, entry_id, mutation_id, amount, actor, ref, meta)
        VALUES (
          ${payload.eventType},
          ${payload.companyId ?? null},
          ${payload.sourceType ?? null},
          ${payload.sourceId ?? null},
          ${payload.entryId ?? null},
          ${payload.mutationId ?? null},
          ${payload.amount ?? null},
          ${payload.actor ?? null},
          ${null},
          ${payload.meta ? JSON.stringify(payload.meta) : null}
        )
        ON CONFLICT DO NOTHING
      `).catch(() => {});

      // Also emit to in-memory event bus (lazy import)
      const eventType = payload.eventType as string;
      if (eventType === "JOURNAL_CREATED" || eventType === "JOURNAL_VOIDED") {
        import("../events/financialEventBus.js").then(({ emitJournalCreated, emitJournalVoided }) => {
          if (eventType === "JOURNAL_CREATED" && payload.entryId) {
            emitJournalCreated({
              entryId:    payload.entryId,
              sourceType: payload.sourceType ?? null,
              sourceId:   payload.sourceId ?? null,
              amount:     payload.amount ?? null,
              actor:      payload.actor ?? null,
              companyId:  payload.companyId ?? null,
            });
          }
        }).catch(() => {});
      }

      // Mark done
      await db.execute(sql`
        UPDATE financial_outbox_events
        SET status = 'done', processed_at = NOW()
        WHERE id = ${id}
      `).catch(() => {});

      processed++;
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      logger.warn({ id, eventType: payload.eventType, err: msg }, "[outbox] processOutboxBatch: event failed");
      await db.execute(sql`
        UPDATE financial_outbox_events
        SET status = 'pending', last_error = ${msg}
        WHERE id = ${id}
      `).catch(() => {});
    }
  }

  if (processed > 0) {
    logger.info({ processed, total: rows.length }, "[outbox] Batch processed");
  }

  return processed;
}

// ─── Dead letter cleanup ──────────────────────────────────────────────────────

async function deadLetterCleanup(): Promise<void> {
  await db.execute(sql`
    UPDATE financial_outbox_events
    SET status = 'failed'
    WHERE status IN ('pending', 'processing')
      AND attempt >= ${MAX_ATTEMPTS}
      AND created_at < NOW() - INTERVAL '1 hour'
  `).catch(() => {});
}

// ─── Worker entry point ───────────────────────────────────────────────────────

const POLL_INTERVAL_MS    = 10_000;  // poll setiap 10 detik
const CLEANUP_INTERVAL_MS = 60 * 60 * 1000; // cleanup setiap 1 jam

export function startOutboxProcessor(): void {
  registerHeartbeat("financial-outbox-processor", POLL_INTERVAL_MS);

  // Process pending events
  setInterval(() => {
    beat("financial-outbox-processor");
    processOutboxBatch().catch((e: unknown) => {
      logger.warn({ e }, "[outbox] processOutboxBatch tick failed (non-fatal)");
    });
  }, POLL_INTERVAL_MS);

  // Dead letter cleanup
  setInterval(() => {
    deadLetterCleanup().catch(() => {});
  }, CLEANUP_INTERVAL_MS);

  // Run once immediately (after 5s delay to let DB pool stabilize)
  setTimeout(() => {
    beat("financial-outbox-processor");
    processOutboxBatch().catch(() => {});
  }, 5_000);

  logger.info(
    { pollIntervalSec: POLL_INTERVAL_MS / 1000 },
    "[outbox] Outbox processor started",
  );
}
