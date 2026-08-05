import { db } from "@workspace/db";
import { sql } from "drizzle-orm";
import { logger } from "./logger.js";

export async function runCoaGovernanceMigration(): Promise<void> {
  await db.execute(sql`
    ALTER TABLE chart_of_accounts
      ADD COLUMN IF NOT EXISTS normal_balance TEXT NOT NULL DEFAULT 'DEBIT',
      ADD COLUMN IF NOT EXISTS account_category TEXT NOT NULL DEFAULT 'ASSET',
      ADD COLUMN IF NOT EXISTS is_postable BOOLEAN NOT NULL DEFAULT TRUE,
      ADD COLUMN IF NOT EXISTS is_header BOOLEAN NOT NULL DEFAULT FALSE,
      ADD COLUMN IF NOT EXISTS effective_from TIMESTAMPTZ,
      ADD COLUMN IF NOT EXISTS effective_to TIMESTAMPTZ,
      ADD COLUMN IF NOT EXISTS status TEXT NOT NULL DEFAULT 'ACTIVE',
      ADD COLUMN IF NOT EXISTS version INTEGER NOT NULL DEFAULT 1,
      ADD COLUMN IF NOT EXISTS created_by TEXT,
      ADD COLUMN IF NOT EXISTS updated_by TEXT,
      ADD COLUMN IF NOT EXISTS approved_by TEXT,
      ADD COLUMN IF NOT EXISTS approved_at TIMESTAMPTZ,
      ADD COLUMN IF NOT EXISTS rejected_by TEXT,
      ADD COLUMN IF NOT EXISTS rejected_at TIMESTAMPTZ,
      ADD COLUMN IF NOT EXISTS rejection_reason TEXT,
      ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW();

    UPDATE chart_of_accounts
    SET account_category = CASE type
      WHEN 'asset' THEN 'ASSET'
      WHEN 'liability' THEN 'LIABILITY'
      WHEN 'equity' THEN 'EQUITY'
      WHEN 'revenue' THEN 'REVENUE'
      WHEN 'expense' THEN 'EXPENSE'
      ELSE 'ASSET'
    END
    WHERE account_category IS NULL OR account_category = 'ASSET';

    UPDATE chart_of_accounts
    SET normal_balance = CASE account_category
      WHEN 'ASSET' THEN 'DEBIT'
      WHEN 'EXPENSE' THEN 'DEBIT'
      WHEN 'OTHER_EXPENSE' THEN 'DEBIT'
      WHEN 'CONTRA_LIABILITY' THEN 'DEBIT'
      WHEN 'CONTRA_REVENUE' THEN 'DEBIT'
      WHEN 'LIABILITY' THEN 'CREDIT'
      WHEN 'EQUITY' THEN 'CREDIT'
      WHEN 'REVENUE' THEN 'CREDIT'
      WHEN 'OTHER_INCOME' THEN 'CREDIT'
      WHEN 'CONTRA_ASSET' THEN 'CREDIT'
      WHEN 'CONTRA_EXPENSE' THEN 'CREDIT'
      ELSE normal_balance
    END;

    -- Only re-derive is_header/is_postable for legacy rows that were never
    -- explicitly set by the COA governance workflow (approved_by IS NULL).
    -- Governance-approved rows are authoritative for their own is_header /
    -- is_postable values; overwriting them here would corrupt maker-checker state.
    UPDATE chart_of_accounts child
    SET is_header = EXISTS (
      SELECT 1 FROM chart_of_accounts descendant WHERE descendant.parent_id = child.id
    ),
    is_postable = NOT EXISTS (
      SELECT 1 FROM chart_of_accounts descendant WHERE descendant.parent_id = child.id
    ) AND child.is_active = TRUE,
    status = CASE WHEN child.is_active THEN 'ACTIVE' ELSE 'INACTIVE' END
    WHERE child.approved_by IS NULL;
  `);

  await db.execute(sql`
    CREATE TABLE IF NOT EXISTS coa_change_requests (
      id SERIAL PRIMARY KEY,
      company_id INTEGER NOT NULL,
      coa_id INTEGER,
      action TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'DRAFT',
      before_snapshot_json JSONB,
      after_snapshot_json JSONB NOT NULL,
      reason TEXT NOT NULL,
      requested_by TEXT NOT NULL,
      requested_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      reviewed_by TEXT,
      reviewed_at TIMESTAMPTZ,
      review_comments TEXT,
      idempotency_key TEXT NOT NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
    CREATE UNIQUE INDEX IF NOT EXISTS coa_change_requests_company_idempotency_uniq
      ON coa_change_requests(company_id, idempotency_key);
    CREATE INDEX IF NOT EXISTS coa_change_requests_company_status_idx
      ON coa_change_requests(company_id, status);

    CREATE TABLE IF NOT EXISTS coa_versions (
      id SERIAL PRIMARY KEY,
      company_id INTEGER NOT NULL,
      coa_id INTEGER NOT NULL,
      version INTEGER NOT NULL,
      snapshot_json JSONB NOT NULL,
      change_request_id INTEGER,
      effective_from TIMESTAMPTZ,
      effective_to TIMESTAMPTZ,
      created_by TEXT,
      approved_by TEXT,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
    CREATE UNIQUE INDEX IF NOT EXISTS coa_versions_coa_version_uniq
      ON coa_versions(coa_id, version);
    CREATE INDEX IF NOT EXISTS coa_versions_company_coa_idx
      ON coa_versions(company_id, coa_id);
  `);
  logger.info("[coaGovernanceMigration] COA governance schema/backfill ready");
}