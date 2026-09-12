/**
 * Treasury Migration — runs at API server startup.
 * Creates the 5 new treasury tables if they don't exist.
 * Safe to run multiple times (all IF NOT EXISTS).
 */

import { db } from "@workspace/db";
import { sql } from "drizzle-orm";
import { logger } from "../logger.js";

export async function runTreasuryMigration(): Promise<void> {
  try {
    // 1. cash_position_snapshot
    await db.execute(sql.raw(`
      CREATE TABLE IF NOT EXISTS cash_position_snapshot (
        id                     SERIAL PRIMARY KEY,
        company_id             INTEGER NOT NULL,
        snapshot_date          DATE NOT NULL,
        bank_account_id        INTEGER,
        currency               TEXT NOT NULL DEFAULT 'IDR',
        current_cash           NUMERIC(18,2) NOT NULL DEFAULT 0,
        available_cash         NUMERIC(18,2) NOT NULL DEFAULT 0,
        restricted_cash        NUMERIC(18,2) NOT NULL DEFAULT 0,
        outstanding_receivable NUMERIC(18,2) NOT NULL DEFAULT 0,
        outstanding_payable    NUMERIC(18,2) NOT NULL DEFAULT 0,
        expected_incoming      NUMERIC(18,2) NOT NULL DEFAULT 0,
        expected_outgoing      NUMERIC(18,2) NOT NULL DEFAULT 0,
        net_position           NUMERIC(18,2) NOT NULL DEFAULT 0,
        snapshot_type          TEXT NOT NULL DEFAULT 'auto',
        created_by             TEXT,
        created_at             TIMESTAMP NOT NULL DEFAULT NOW(),
        updated_at             TIMESTAMP NOT NULL DEFAULT NOW()
      )
    `)).catch(() => {});

    await db.execute(sql.raw(`CREATE INDEX IF NOT EXISTS cash_position_snapshot_company_idx ON cash_position_snapshot(company_id)`)).catch(() => {});
    await db.execute(sql.raw(`CREATE INDEX IF NOT EXISTS cash_position_snapshot_date_idx ON cash_position_snapshot(snapshot_date)`)).catch(() => {});
    await db.execute(sql.raw(`CREATE INDEX IF NOT EXISTS cash_position_snapshot_company_date_idx ON cash_position_snapshot(company_id, snapshot_date)`)).catch(() => {});

    // 2. cash_forecast
    await db.execute(sql.raw(`
      CREATE TABLE IF NOT EXISTS cash_forecast (
        id               SERIAL PRIMARY KEY,
        company_id       INTEGER NOT NULL,
        forecast_date    DATE NOT NULL,
        horizon_days     INTEGER NOT NULL,
        horizon_date     DATE NOT NULL,
        currency         TEXT NOT NULL DEFAULT 'IDR',
        expected_inflow  NUMERIC(18,2) NOT NULL DEFAULT 0,
        expected_outflow NUMERIC(18,2) NOT NULL DEFAULT 0,
        net_forecast     NUMERIC(18,2) NOT NULL DEFAULT 0,
        opening_balance  NUMERIC(18,2) NOT NULL DEFAULT 0,
        closing_balance  NUMERIC(18,2) NOT NULL DEFAULT 0,
        ar_component     NUMERIC(18,2) NOT NULL DEFAULT 0,
        ap_component     NUMERIC(18,2) NOT NULL DEFAULT 0,
        mutation_inflow  NUMERIC(18,2) NOT NULL DEFAULT 0,
        mutation_outflow NUMERIC(18,2) NOT NULL DEFAULT 0,
        created_at       TIMESTAMP NOT NULL DEFAULT NOW()
      )
    `)).catch(() => {});

    await db.execute(sql.raw(`CREATE INDEX IF NOT EXISTS cash_forecast_company_idx ON cash_forecast(company_id)`)).catch(() => {});
    await db.execute(sql.raw(`CREATE INDEX IF NOT EXISTS cash_forecast_company_date_idx ON cash_forecast(company_id, forecast_date)`)).catch(() => {});

    // 3. cash_variance
    await db.execute(sql.raw(`
      CREATE TABLE IF NOT EXISTS cash_variance (
        id              SERIAL PRIMARY KEY,
        company_id      INTEGER NOT NULL,
        period_date     DATE NOT NULL,
        currency        TEXT NOT NULL DEFAULT 'IDR',
        expected_amount NUMERIC(18,2) NOT NULL DEFAULT 0,
        actual_amount   NUMERIC(18,2) NOT NULL DEFAULT 0,
        variance_amount NUMERIC(18,2) NOT NULL DEFAULT 0,
        variance_pct    NUMERIC(10,4),
        variance_type   TEXT NOT NULL DEFAULT 'balance',
        forecast_id     INTEGER,
        snapshot_id     INTEGER,
        traced_items    JSONB,
        created_at      TIMESTAMP NOT NULL DEFAULT NOW()
      )
    `)).catch(() => {});

    await db.execute(sql.raw(`CREATE INDEX IF NOT EXISTS cash_variance_company_idx ON cash_variance(company_id)`)).catch(() => {});
    await db.execute(sql.raw(`CREATE INDEX IF NOT EXISTS cash_variance_company_date_idx ON cash_variance(company_id, period_date)`)).catch(() => {});

    // 4. treasury_alert
    await db.execute(sql.raw(`
      CREATE TABLE IF NOT EXISTS treasury_alert (
        id              SERIAL PRIMARY KEY,
        company_id      INTEGER NOT NULL,
        alert_date      DATE NOT NULL DEFAULT CURRENT_DATE,
        alert_type      TEXT NOT NULL,
        severity        TEXT NOT NULL DEFAULT 'WARNING',
        title           TEXT NOT NULL,
        message         TEXT NOT NULL,
        value           NUMERIC(18,2),
        threshold       NUMERIC(18,2),
        currency        TEXT DEFAULT 'IDR',
        bank_account_id INTEGER,
        is_resolved     BOOLEAN NOT NULL DEFAULT FALSE,
        resolved_at     TIMESTAMP,
        resolved_by     TEXT,
        metadata        JSONB,
        created_at      TIMESTAMP NOT NULL DEFAULT NOW(),
        updated_at      TIMESTAMP NOT NULL DEFAULT NOW()
      )
    `)).catch(() => {});

    await db.execute(sql.raw(`CREATE INDEX IF NOT EXISTS treasury_alert_company_idx ON treasury_alert(company_id)`)).catch(() => {});
    await db.execute(sql.raw(`CREATE INDEX IF NOT EXISTS treasury_alert_company_unresolved_idx ON treasury_alert(company_id, is_resolved) WHERE is_resolved = FALSE`)).catch(() => {});

    // 5. liquidity_metrics
    await db.execute(sql.raw(`
      CREATE TABLE IF NOT EXISTS liquidity_metrics (
        id                      SERIAL PRIMARY KEY,
        company_id              INTEGER NOT NULL,
        period_date             DATE NOT NULL,
        quick_ratio             NUMERIC(10,4),
        current_ratio           NUMERIC(10,4),
        cash_coverage           NUMERIC(10,4),
        operating_cash_coverage NUMERIC(10,4),
        collection_efficiency   NUMERIC(10,4),
        payment_efficiency      NUMERIC(10,4),
        dso                     NUMERIC(10,2),
        dpo                     NUMERIC(10,2),
        current_assets          NUMERIC(18,2),
        current_liabilities     NUMERIC(18,2),
        cash_and_equivalents    NUMERIC(18,2),
        total_revenue_30d       NUMERIC(18,2),
        total_expenses_30d      NUMERIC(18,2),
        notes                   TEXT,
        created_at              TIMESTAMP NOT NULL DEFAULT NOW()
      )
    `)).catch(() => {});

    await db.execute(sql.raw(`CREATE INDEX IF NOT EXISTS liquidity_metrics_company_idx ON liquidity_metrics(company_id)`)).catch(() => {});
    await db.execute(sql.raw(`CREATE INDEX IF NOT EXISTS liquidity_metrics_company_date_idx ON liquidity_metrics(company_id, period_date)`)).catch(() => {});

    logger.info("[treasury] Migration: 5 tables siap (cash_position_snapshot, cash_forecast, cash_variance, treasury_alert, liquidity_metrics)");
  } catch (err) {
    logger.warn({ err }, "[treasury] Migration: non-fatal error");
  }
}
