import { db } from "@workspace/db";
import { sql } from "drizzle-orm";
import { logger } from "./logger.js";

/**
 * Sprint 09A additive schema. This migration only creates the durable
 * Marketplace -> Payment Module handoff contract. It does not create payment
 * execution, accounting, treasury, settlement, refund, or reconciliation data.
 */
export async function runMktPaymentHandoffMigration(): Promise<void> {
  await db.execute(sql`
    ALTER TABLE IF EXISTS payment_requests
      ADD COLUMN IF NOT EXISTS source_type TEXT,
      ADD COLUMN IF NOT EXISTS source_id INTEGER,
      ADD COLUMN IF NOT EXISTS mkt_ap_preparation_id INTEGER,
      ADD COLUMN IF NOT EXISTS idempotency_key TEXT,
      ADD COLUMN IF NOT EXISTS payload_fingerprint TEXT,
      ADD COLUMN IF NOT EXISTS currency TEXT NOT NULL DEFAULT 'IDR',
      ADD COLUMN IF NOT EXISTS mkt_lifecycle_status TEXT,
      ADD COLUMN IF NOT EXISTS mkt_finance_reviewed_by TEXT,
      ADD COLUMN IF NOT EXISTS mkt_finance_reviewed_at TIMESTAMP,
      ADD COLUMN IF NOT EXISTS mkt_approved_by TEXT,
      ADD COLUMN IF NOT EXISTS mkt_approved_at TIMESTAMP,
      ADD COLUMN IF NOT EXISTS mkt_treasury_ready_by TEXT,
      ADD COLUMN IF NOT EXISTS mkt_treasury_ready_at TIMESTAMP,
      ADD COLUMN IF NOT EXISTS mkt_execution_started_at TIMESTAMP,
      ADD COLUMN IF NOT EXISTS mkt_completed_at TIMESTAMP,
      ADD COLUMN IF NOT EXISTS mkt_failure_code TEXT,
      ADD COLUMN IF NOT EXISTS mkt_failure_reason TEXT,
      ADD COLUMN IF NOT EXISTS mkt_cancellation_idempotency_key TEXT,
      ADD COLUMN IF NOT EXISTS mkt_cancelled_by TEXT,
      ADD COLUMN IF NOT EXISTS mkt_cancellation_reason TEXT
  `);
  await db.execute(sql`
    ALTER TABLE IF EXISTS mkt_ap_preparations
      ADD COLUMN IF NOT EXISTS payment_request_id INTEGER,
      ADD COLUMN IF NOT EXISTS payment_handoff_at TIMESTAMP,
      ADD COLUMN IF NOT EXISTS payment_handoff_by TEXT
  `);
  await db.execute(sql`
    ALTER TABLE IF EXISTS activity_logs
      ADD COLUMN IF NOT EXISTS deduplication_key TEXT
  `);
  await db.execute(sql`
    DO $$
    BEGIN
      IF to_regclass('public.activity_logs') IS NOT NULL THEN
        CREATE UNIQUE INDEX IF NOT EXISTS activity_logs_deduplication_key_unique
          ON activity_logs (deduplication_key)
          WHERE deduplication_key IS NOT NULL;
      END IF;
    END $$
  `);
  // Some older runtime snapshots have payment_requests.id as a plain NOT NULL
  // serial column without its primary-key constraint. PostgreSQL requires the
  // referenced column to be PK/UNIQUE before creating the handoff FK.
  await db.execute(sql`
    DO $$
    BEGIN
      IF EXISTS (
        SELECT 1
        FROM information_schema.tables
        WHERE table_schema = 'public' AND table_name = 'payment_requests'
      ) AND NOT EXISTS (
        SELECT 1
        FROM pg_constraint c
        JOIN pg_attribute a
          ON a.attrelid = c.conrelid
         AND a.attnum = c.conkey[1]
        WHERE c.conrelid = 'public.payment_requests'::regclass
          AND c.contype IN ('p', 'u')
          AND array_length(c.conkey, 1) = 1
          AND a.attname = 'id'
      ) THEN
        ALTER TABLE "public"."payment_requests"
          ADD CONSTRAINT "payment_requests_id_key" UNIQUE ("id");
      END IF;
    END $$
  `);
  await db.execute(sql`
    CREATE UNIQUE INDEX IF NOT EXISTS pay_req_idempotency_unique
      ON payment_requests (idempotency_key)
      WHERE idempotency_key IS NOT NULL
  `);
  await db.execute(sql`
    CREATE UNIQUE INDEX IF NOT EXISTS pay_req_mkt_ap_unique
      ON payment_requests (mkt_ap_preparation_id)
      WHERE mkt_ap_preparation_id IS NOT NULL
  `);
  await db.execute(sql`
    CREATE INDEX IF NOT EXISTS pay_req_source_idx
      ON payment_requests (source_type, source_id)
  `);
  await db.execute(sql`
    CREATE INDEX IF NOT EXISTS pay_req_mkt_ap_idx
      ON payment_requests (mkt_ap_preparation_id)
  `);
  await db.execute(sql`
    CREATE INDEX IF NOT EXISTS pay_req_mkt_lifecycle_idx
      ON payment_requests (mkt_lifecycle_status)
  `);
  await db.execute(sql`
    UPDATE payment_requests
    SET mkt_lifecycle_status = 'payment_request_created',
        updated_at = NOW()
    WHERE source_type = 'marketplace_ap_preparation'
      AND mkt_ap_preparation_id IS NOT NULL
      AND mkt_lifecycle_status IS NULL
  `);
  await db.execute(sql`
    CREATE UNIQUE INDEX IF NOT EXISTS pay_req_mkt_cancel_idempotency_unique
      ON payment_requests (mkt_cancellation_idempotency_key)
      WHERE mkt_cancellation_idempotency_key IS NOT NULL
  `);
  await db.execute(sql`
    CREATE TABLE IF NOT EXISTS mkt_payment_execution_attempts (
      id SERIAL PRIMARY KEY,
      payment_request_id INTEGER NOT NULL
        REFERENCES payment_requests(id) ON DELETE CASCADE,
      attempt_number INTEGER NOT NULL,
      status TEXT NOT NULL,
      idempotency_key TEXT NOT NULL,
      failure_code TEXT,
      failure_reason TEXT,
      provider_reference TEXT,
      started_at TIMESTAMP,
      completed_at TIMESTAMP,
      created_by TEXT,
      created_at TIMESTAMP NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMP NOT NULL DEFAULT NOW(),
      CONSTRAINT mkt_payment_attempt_request_number_unique
        UNIQUE (payment_request_id, attempt_number),
      CONSTRAINT mkt_payment_attempt_idempotency_unique
        UNIQUE (idempotency_key)
    )
  `);
  await db.execute(sql`
    CREATE INDEX IF NOT EXISTS mkt_payment_attempt_request_idx
      ON mkt_payment_execution_attempts (payment_request_id)
  `);
  await db.execute(sql`
    CREATE INDEX IF NOT EXISTS mkt_payment_attempt_status_idx
      ON mkt_payment_execution_attempts (status)
  `);
  await db.execute(sql`
    CREATE UNIQUE INDEX IF NOT EXISTS mkt_ap_preparations_payment_request_unique
      ON mkt_ap_preparations (payment_request_id)
      WHERE payment_request_id IS NOT NULL
  `);
  await db.execute(sql`
    DO $$
    BEGIN
      IF to_regclass('public.payment_requests') IS NOT NULL
        AND to_regclass('public.mkt_ap_preparations') IS NOT NULL
        AND NOT EXISTS (
          SELECT 1 FROM pg_constraint
          WHERE conname = 'payment_requests_mkt_ap_preparation_fk'
        )
      THEN
        ALTER TABLE payment_requests
          ADD CONSTRAINT payment_requests_mkt_ap_preparation_fk
          FOREIGN KEY (mkt_ap_preparation_id)
          REFERENCES mkt_ap_preparations(id)
          ON DELETE SET NULL;
      END IF;
      IF to_regclass('public.payment_requests') IS NOT NULL
        AND to_regclass('public.mkt_ap_preparations') IS NOT NULL
        AND NOT EXISTS (
          SELECT 1 FROM pg_constraint
          WHERE conname = 'mkt_ap_preparations_payment_request_fk'
        )
      THEN
        ALTER TABLE mkt_ap_preparations
          ADD CONSTRAINT mkt_ap_preparations_payment_request_fk
          FOREIGN KEY (payment_request_id)
          REFERENCES payment_requests(id)
          ON DELETE SET NULL;
      END IF;
    END $$
  `);
  logger.info("[mktPaymentHandoffMigration] Sprint 09A handoff schema applied");
}