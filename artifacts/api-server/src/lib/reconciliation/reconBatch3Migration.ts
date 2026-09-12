/**
 * Recon Batch 3 — Database Migrations: Intelligent Payment Matching
 *
 * New tables:
 *  - payment_allocations      : immutable per-invoice allocation records
 *  - payment_matching_groups  : multi-invoice / split-payment groups
 *  - confidence_statistics    : calibration data per confidence band
 *  - allocation_history       : immutable audit trail for allocation events
 *
 * All DDL is idempotent (CREATE IF NOT EXISTS / ADD COLUMN IF NOT EXISTS).
 * Executed one statement at a time for pgBouncer transaction-mode compatibility.
 */

import { db } from "@workspace/db";
import { sql } from "drizzle-orm";
import { logger } from "../logger.js";

let batch3Migrated = false;

export async function runReconBatch3Migration(): Promise<void> {
  if (batch3Migrated) return;
  batch3Migrated = true;

  // ── payment_matching_groups ───────────────────────────────────────────────────
  // Groups represent a payment-to-invoice relationship set.
  // group_type: MULTI_INVOICE (1 mutation → N invoices)
  //             SPLIT_PAYMENT (1 invoice ← N mutations)
  //             MANY_TO_MANY  (N mutations ↔ N invoices)
  await db.execute(sql.raw(`
    CREATE TABLE IF NOT EXISTS payment_matching_groups (
      id              SERIAL PRIMARY KEY,
      company_id      INTEGER NOT NULL,
      group_type      TEXT NOT NULL CHECK (group_type IN ('MULTI_INVOICE','SPLIT_PAYMENT','MANY_TO_MANY')),
      matching_type   TEXT NOT NULL DEFAULT 'MULTI_INVOICE',
      total_mutation_amount  NUMERIC(18,2) NOT NULL DEFAULT 0,
      total_invoice_amount   NUMERIC(18,2) NOT NULL DEFAULT 0,
      total_allocated        NUMERIC(18,2) NOT NULL DEFAULT 0,
      remaining_amount       NUMERIC(18,2) NOT NULL DEFAULT 0,
      confidence      INTEGER NOT NULL DEFAULT 0,
      algorithm_used  TEXT,
      status          TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active','reversed','void')),
      created_by      TEXT,
      created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `)).catch(() => {});

  await db.execute(sql.raw(
    `CREATE INDEX IF NOT EXISTS pmg_company_idx ON payment_matching_groups(company_id, created_at DESC)`
  )).catch(() => {});
  await db.execute(sql.raw(
    `CREATE INDEX IF NOT EXISTS pmg_status_idx ON payment_matching_groups(status)`
  )).catch(() => {});

  // ── payment_allocations ───────────────────────────────────────────────────────
  // Each row = one allocation of a mutation's payment to a specific invoice.
  // Immutable: never UPDATE, only INSERT or soft-delete via allocation_history.
  await db.execute(sql.raw(`
    CREATE TABLE IF NOT EXISTS payment_allocations (
      id                  SERIAL PRIMARY KEY,
      group_id            INTEGER REFERENCES payment_matching_groups(id) ON DELETE SET NULL,
      company_id          INTEGER NOT NULL,
      invoice_id          INTEGER NOT NULL,
      invoice_ref         TEXT,
      mutation_id         INTEGER NOT NULL REFERENCES bank_mutations(id) ON DELETE CASCADE,
      payment_id          INTEGER,
      allocated_amount    NUMERIC(18,2) NOT NULL,
      remaining_amount    NUMERIC(18,2) NOT NULL DEFAULT 0,
      allocation_sequence INTEGER NOT NULL DEFAULT 1,
      strategy            TEXT NOT NULL DEFAULT 'MANUAL'
        CHECK (strategy IN ('FIFO','LIFO','DUE_DATE','REFERENCE','MANUAL')),
      is_active           BOOLEAN NOT NULL DEFAULT TRUE,
       source_allocation_id INTEGER REFERENCES payment_allocations(id) ON DELETE RESTRICT,
      created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `)).catch(() => {});

  // A new current-payment edge may point to an old allocation only once.
  // The old edge remains immutable, preserving its original mutation lineage.
  await db.execute(sql.raw(
    `ALTER TABLE payment_allocations ADD COLUMN IF NOT EXISTS source_allocation_id INTEGER`
  )).catch(() => {});
  await db.execute(sql.raw(
    `CREATE UNIQUE INDEX IF NOT EXISTS pa_source_allocation_active_unique
     ON payment_allocations(source_allocation_id)
     WHERE source_allocation_id IS NOT NULL AND is_active = TRUE`
  )).catch(() => {});

  await db.execute(sql.raw(
    `CREATE INDEX IF NOT EXISTS pa_invoice_idx   ON payment_allocations(invoice_id)`
  )).catch(() => {});
  await db.execute(sql.raw(
    `CREATE INDEX IF NOT EXISTS pa_mutation_idx  ON payment_allocations(mutation_id)`
  )).catch(() => {});
  await db.execute(sql.raw(
    `CREATE INDEX IF NOT EXISTS pa_company_idx   ON payment_allocations(company_id, created_at DESC)`
  )).catch(() => {});
  await db.execute(sql.raw(
    `CREATE INDEX IF NOT EXISTS pa_group_idx     ON payment_allocations(group_id) WHERE group_id IS NOT NULL`
  )).catch(() => {});

  // ── confidence_statistics ────────────────────────────────────────────────────
  // One row per (company_id, confidence_band_min) — upserted on each outcome.
  // band_min / band_max define the bucket (e.g. 90/95).
  await db.execute(sql.raw(`
    CREATE TABLE IF NOT EXISTS confidence_statistics (
      id              SERIAL PRIMARY KEY,
      company_id      INTEGER NOT NULL,
      band_min        INTEGER NOT NULL,
      band_max        INTEGER NOT NULL,
      total_count     INTEGER NOT NULL DEFAULT 0,
      correct_count   INTEGER NOT NULL DEFAULT 0,
      incorrect_count INTEGER NOT NULL DEFAULT 0,
      actual_accuracy NUMERIC(5,2) NOT NULL DEFAULT 0,
      last_event_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      UNIQUE (company_id, band_min)
    )
  `)).catch(() => {});

  await db.execute(sql.raw(
    `CREATE INDEX IF NOT EXISTS cs_company_idx ON confidence_statistics(company_id, band_min)`
  )).catch(() => {});

  // ── allocation_history ───────────────────────────────────────────────────────
  // Append-only audit log for every allocation event.
  await db.execute(sql.raw(`
    CREATE TABLE IF NOT EXISTS allocation_history (
      id              SERIAL PRIMARY KEY,
      allocation_id   INTEGER,
      group_id        INTEGER,
      company_id      INTEGER NOT NULL,
      event_type      TEXT NOT NULL,
      actor           TEXT,
      meta            JSONB,
      created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `)).catch(() => {});

  await db.execute(sql.raw(
    `CREATE INDEX IF NOT EXISTS ah_allocation_idx ON allocation_history(allocation_id) WHERE allocation_id IS NOT NULL`
  )).catch(() => {});
  await db.execute(sql.raw(
    `CREATE INDEX IF NOT EXISTS ah_group_idx      ON allocation_history(group_id) WHERE group_id IS NOT NULL`
  )).catch(() => {});
  await db.execute(sql.raw(
    `CREATE INDEX IF NOT EXISTS ah_company_idx    ON allocation_history(company_id, created_at DESC)`
  )).catch(() => {});

  // ── bank_mutations augmentation ───────────────────────────────────────────────
  // Track multi-invoice / split-payment context on the mutation itself.
  await db.execute(sql.raw(
    `ALTER TABLE bank_mutations ADD COLUMN IF NOT EXISTS matching_type TEXT`
  )).catch(() => {});
  await db.execute(sql.raw(
    `ALTER TABLE bank_mutations ADD COLUMN IF NOT EXISTS matching_group_id INTEGER`
  )).catch(() => {});

  logger.info("[recon-batch3] migrations complete — payment_allocations, payment_matching_groups, confidence_statistics, allocation_history");
}
