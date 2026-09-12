/**
 * financialEventBus.ts — RULE 5: Event Consistency Engine
 *
 * Setiap operasi finansial WAJIB emit event melalui bus ini.
 * Events dilogging ke DB (financial_events) untuk audit trail penuh.
 *
 * Events:
 *  - MUTATION_IMPORTED    : bank mutation baru masuk ke sistem
 *  - MATCH_CREATED        : mutation di-match dengan transaksi ERP
 *  - MATCH_APPROVED       : match di-approve oleh user
 *  - JOURNAL_CREATED      : accounting_entry baru dibuat
 *  - JOURNAL_VOIDED       : accounting_entry di-void
 */

import { EventEmitter } from "node:events";
import { db } from "@workspace/db";
import { sql } from "drizzle-orm";
import { logger } from "../logger.js";

// ─── Event Types ──────────────────────────────────────────────────────────────

export const FINANCIAL_EVENTS = {
  MUTATION_IMPORTED: "MUTATION_IMPORTED",
  MATCH_CREATED:     "MATCH_CREATED",
  MATCH_APPROVED:    "MATCH_APPROVED",
  JOURNAL_CREATED:   "JOURNAL_CREATED",
  JOURNAL_VOIDED:    "JOURNAL_VOIDED",
} as const;

export type FinancialEventType = keyof typeof FINANCIAL_EVENTS;

export interface FinancialEventPayload {
  eventType:    FinancialEventType;
  companyId?:   number | null;
  sourceType?:  string | null;
  sourceId?:    string | number | null;
  entryId?:     number | null;
  mutationId?:  number | null;
  amount?:      number | null;
  actor?:       string | null;
  ref?:         string | null;
  meta?:        Record<string, unknown> | null;
}

// ─── DB persistence ───────────────────────────────────────────────────────────

let _tableMigrated = false;

async function ensureTable(): Promise<void> {
  if (_tableMigrated) return;
  _tableMigrated = true;
  await db.execute(sql`
    CREATE TABLE IF NOT EXISTS financial_events (
      id          BIGSERIAL PRIMARY KEY,
      event_type  TEXT NOT NULL,
      company_id  INTEGER,
      source_type TEXT,
      source_id   TEXT,
      entry_id    INTEGER,
      mutation_id INTEGER,
      amount      NUMERIC(14,2),
      actor       TEXT,
      ref         TEXT,
      meta        JSONB,
      created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `).catch(() => {});
  await db.execute(sql`
    CREATE INDEX IF NOT EXISTS fe_event_type_idx ON financial_events(event_type)
  `).catch(() => {});
  await db.execute(sql`
    CREATE INDEX IF NOT EXISTS fe_created_idx ON financial_events(created_at)
  `).catch(() => {});
  await db.execute(sql`
    CREATE INDEX IF NOT EXISTS fe_entry_idx ON financial_events(entry_id) WHERE entry_id IS NOT NULL
  `).catch(() => {});
}

async function persistEvent(payload: FinancialEventPayload): Promise<void> {
  await ensureTable();
  await db.execute(sql`
    INSERT INTO financial_events
      (event_type, company_id, source_type, source_id, entry_id, mutation_id, amount, actor, ref, meta)
    VALUES (
      ${payload.eventType},
      ${payload.companyId ?? null},
      ${payload.sourceType ?? null},
      ${payload.sourceId != null ? String(payload.sourceId) : null},
      ${payload.entryId ?? null},
      ${payload.mutationId ?? null},
      ${payload.amount ?? null},
      ${payload.actor ?? null},
      ${payload.ref ?? null},
      ${payload.meta ? JSON.stringify(payload.meta) : null}
    )
  `).catch((e: unknown) => {
    logger.warn({ e, eventType: payload.eventType }, "[financialEventBus] persistEvent failed (non-fatal)");
  });
}

// ─── Internal EventEmitter ────────────────────────────────────────────────────

class FinancialEventBus extends EventEmitter {
  emit(event: FinancialEventType, payload: FinancialEventPayload): boolean {
    // Persist to DB asynchronously — non-blocking, non-fatal
    void persistEvent(payload).catch(() => {});
    logger.info(
      { eventType: event, sourceType: payload.sourceType, sourceId: payload.sourceId, entryId: payload.entryId },
      `[FinancialEventBus] ${event}`,
    );
    return super.emit(event, payload);
  }
}

export const financialEventBus = new FinancialEventBus();
financialEventBus.setMaxListeners(50);

// ─── Convenience emitters ─────────────────────────────────────────────────────

export function emitMutationImported(opts: {
  mutationId: number; companyId?: number | null; amount?: number | null; ref?: string | null; actor?: string | null;
}): void {
  financialEventBus.emit("MUTATION_IMPORTED", {
    eventType: "MUTATION_IMPORTED",
    mutationId: opts.mutationId,
    companyId: opts.companyId,
    amount: opts.amount,
    ref: opts.ref,
    actor: opts.actor,
  });
}

export function emitMatchCreated(opts: {
  mutationId: number; sourceType?: string | null; sourceId?: string | number | null; actor?: string | null; companyId?: number | null;
}): void {
  financialEventBus.emit("MATCH_CREATED", {
    eventType: "MATCH_CREATED",
    mutationId: opts.mutationId,
    sourceType: opts.sourceType,
    sourceId: opts.sourceId,
    actor: opts.actor,
    companyId: opts.companyId,
  });
}

export function emitMatchApproved(opts: {
  mutationId: number; sourceType?: string | null; sourceId?: string | number | null; actor?: string | null; companyId?: number | null;
}): void {
  financialEventBus.emit("MATCH_APPROVED", {
    eventType: "MATCH_APPROVED",
    mutationId: opts.mutationId,
    sourceType: opts.sourceType,
    sourceId: opts.sourceId,
    actor: opts.actor,
    companyId: opts.companyId,
  });
}

export function emitJournalCreated(opts: {
  entryId: number; sourceType?: string | null; sourceId?: string | number | null;
  amount?: number | null; actor?: string | null; ref?: string | null; companyId?: number | null;
  mutationId?: number | null;
}): void {
  financialEventBus.emit("JOURNAL_CREATED", {
    eventType: "JOURNAL_CREATED",
    entryId: opts.entryId,
    sourceType: opts.sourceType,
    sourceId: opts.sourceId,
    amount: opts.amount,
    actor: opts.actor,
    ref: opts.ref,
    companyId: opts.companyId,
    mutationId: opts.mutationId,
  });
}

export function emitJournalVoided(opts: {
  entryId: number; voidEntryId: number; reason?: string | null; actor?: string | null; companyId?: number | null;
}): void {
  financialEventBus.emit("JOURNAL_VOIDED", {
    eventType: "JOURNAL_VOIDED",
    entryId: opts.entryId,
    sourceId: opts.voidEntryId,
    actor: opts.actor,
    companyId: opts.companyId,
    meta: { voidEntryId: opts.voidEntryId, reason: opts.reason },
  });
}
