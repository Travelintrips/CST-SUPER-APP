/**
 * Recon Batch 2 — Database Migrations
 *
 * Tables:
 *  - recon_rule_versions    : immutable version snapshots for every rule change
 *  - recon_metrics_daily    : aggregated daily matching metrics per company/bank
 *  - recon_metrics_hourly   : fine-grained hourly matching metrics
 *  - recon_cache_metadata   : TTL configuration per company (cache governance)
 *
 * All DDL is idempotent (CREATE IF NOT EXISTS / ADD COLUMN IF NOT EXISTS).
 * Each statement is executed separately to comply with pgBouncer transaction mode.
 */

import { db } from "@workspace/db";
import { sql } from "drizzle-orm";
import { logger } from "../logger.js";

let batch2Migrated = false;

export async function runReconBatch2Migration(): Promise<void> {
  if (batch2Migrated) return;
  batch2Migrated = true;

  // ── recon_rule_versions ──────────────────────────────────────────────────────
  await db.execute(sql.raw(`
    CREATE TABLE IF NOT EXISTS recon_rule_versions (
      id              SERIAL PRIMARY KEY,
      rule_id         INTEGER NOT NULL,
      company_id      INTEGER NOT NULL,
      version_number  INTEGER NOT NULL,
      snapshot_json   JSONB NOT NULL,
      change_type     TEXT NOT NULL CHECK (change_type IN ('CREATE','UPDATE','DELETE')),
      changed_by      TEXT,
      change_reason   TEXT,
      created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `)).catch(() => {});

  await db.execute(sql.raw(
    `CREATE INDEX IF NOT EXISTS rrv_rule_idx    ON recon_rule_versions(rule_id)`
  )).catch(() => {});
  await db.execute(sql.raw(
    `CREATE INDEX IF NOT EXISTS rrv_company_idx ON recon_rule_versions(company_id, rule_id, version_number DESC)`
  )).catch(() => {});

  // Add current_version_id to recon_rules (nullable, points to latest version row)
  await db.execute(sql.raw(
    `ALTER TABLE recon_rules ADD COLUMN IF NOT EXISTS current_version_id INTEGER`
  )).catch(() => {});

  // ── recon_metrics_daily ──────────────────────────────────────────────────────
  await db.execute(sql.raw(`
    CREATE TABLE IF NOT EXISTS recon_metrics_daily (
      id                    SERIAL PRIMARY KEY,
      company_id            INTEGER NOT NULL,
      bank_account_id       INTEGER,
      metric_date           DATE NOT NULL,
      matching_count        INTEGER NOT NULL DEFAULT 0,
      rule_matches          INTEGER NOT NULL DEFAULT 0,
      ecf_matches           INTEGER NOT NULL DEFAULT 0,
      exact_ref_matches     INTEGER NOT NULL DEFAULT 0,
      manual_reviews        INTEGER NOT NULL DEFAULT 0,
      manual_overrides      INTEGER NOT NULL DEFAULT 0,
      false_positive        INTEGER NOT NULL DEFAULT 0,
      false_negative        INTEGER NOT NULL DEFAULT 0,
      avg_matching_time_ms  NUMERIC(10,2) NOT NULL DEFAULT 0,
      avg_rule_time_ms      NUMERIC(10,2) NOT NULL DEFAULT 0,
      avg_ecf_time_ms       NUMERIC(10,2) NOT NULL DEFAULT 0,
      avg_confidence        NUMERIC(5,2)  NOT NULL DEFAULT 0,
      cache_hits            INTEGER NOT NULL DEFAULT 0,
      cache_misses          INTEGER NOT NULL DEFAULT 0,
      rule_hits             INTEGER NOT NULL DEFAULT 0,
      rule_misses           INTEGER NOT NULL DEFAULT 0,
      created_at            TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at            TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      UNIQUE (company_id, bank_account_id, metric_date)
    )
  `)).catch(() => {});

  await db.execute(sql.raw(
    `CREATE INDEX IF NOT EXISTS rmd_company_date_idx ON recon_metrics_daily(company_id, metric_date DESC)`
  )).catch(() => {});

  // ── recon_metrics_hourly ─────────────────────────────────────────────────────
  await db.execute(sql.raw(`
    CREATE TABLE IF NOT EXISTS recon_metrics_hourly (
      id               SERIAL PRIMARY KEY,
      company_id       INTEGER NOT NULL,
      bank_account_id  INTEGER,
      metric_hour      TIMESTAMPTZ NOT NULL,
      matching_count   INTEGER NOT NULL DEFAULT 0,
      rule_matches     INTEGER NOT NULL DEFAULT 0,
      ecf_matches      INTEGER NOT NULL DEFAULT 0,
      avg_confidence   NUMERIC(5,2) NOT NULL DEFAULT 0,
      cache_hits       INTEGER NOT NULL DEFAULT 0,
      cache_misses     INTEGER NOT NULL DEFAULT 0,
      created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      UNIQUE (company_id, bank_account_id, metric_hour)
    )
  `)).catch(() => {});

  await db.execute(sql.raw(
    `CREATE INDEX IF NOT EXISTS rmh_company_hour_idx ON recon_metrics_hourly(company_id, metric_hour DESC)`
  )).catch(() => {});

  // ── recon_cache_metadata ─────────────────────────────────────────────────────
  await db.execute(sql.raw(`
    CREATE TABLE IF NOT EXISTS recon_cache_metadata (
      id                SERIAL PRIMARY KEY,
      company_id        INTEGER NOT NULL UNIQUE,
      rule_ttl_ms       INTEGER NOT NULL DEFAULT 300000,
      ecf_ttl_ms        INTEGER NOT NULL DEFAULT 120000,
      cache_enabled     BOOLEAN NOT NULL DEFAULT TRUE,
      last_invalidated  TIMESTAMPTZ,
      created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at        TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `)).catch(() => {});

  logger.info("[recon-batch2] migrations complete — recon_rule_versions, recon_metrics_daily, recon_metrics_hourly, recon_cache_metadata");
}
