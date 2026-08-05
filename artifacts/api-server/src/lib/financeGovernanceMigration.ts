/**
 * Finance Governance & Audit Control Layer — DB Migration
 * Phases 1-6, 8-9
 */

import { db } from "@workspace/db";
import { sql } from "drizzle-orm";
import { logger } from "./logger.js";

export async function runFinanceGovernanceMigration(): Promise<void> {
  logger.info("[finance-governance] Running migration...");

  // ── FASE 1: Extend accounting_entry_status enum ──────────────────────────
  // PostgreSQL enums: ADD VALUE is idempotent via pg_enum check
  await db.execute(sql`
    DO $$ BEGIN
      IF NOT EXISTS (
        SELECT 1 FROM pg_enum
        WHERE enumlabel = 'pending_approval'
          AND enumtypid = (SELECT oid FROM pg_type WHERE typname = 'accounting_entry_status')
      ) THEN
        ALTER TYPE accounting_entry_status ADD VALUE 'pending_approval';
      END IF;
    END $$;
  `);
  await db.execute(sql`
    DO $$ BEGIN
      IF NOT EXISTS (
        SELECT 1 FROM pg_enum
        WHERE enumlabel = 'approved'
          AND enumtypid = (SELECT oid FROM pg_type WHERE typname = 'accounting_entry_status')
      ) THEN
        ALTER TYPE accounting_entry_status ADD VALUE 'approved';
      END IF;
    END $$;
  `);
  await db.execute(sql`
    DO $$ BEGIN
      IF NOT EXISTS (
        SELECT 1 FROM pg_enum
        WHERE enumlabel = 'rejected'
          AND enumtypid = (SELECT oid FROM pg_type WHERE typname = 'accounting_entry_status')
      ) THEN
        ALTER TYPE accounting_entry_status ADD VALUE 'rejected';
      END IF;
    END $$;
  `);

  // ── FASE 1: journal_approval_workflow ────────────────────────────────────
  await db.execute(sql`
    CREATE TABLE IF NOT EXISTS journal_approval_workflow (
      id                   SERIAL PRIMARY KEY,
      entry_id             INTEGER NOT NULL,
      company_id           INTEGER,
      status               TEXT NOT NULL DEFAULT 'pending',
      submitted_by         TEXT,
      submitted_at         TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      current_approver_role TEXT,
      approved_by          TEXT,
      approved_at          TIMESTAMPTZ,
      rejected_by          TEXT,
      rejected_at          TIMESTAMPTZ,
      notes                TEXT,
      metadata             JSONB DEFAULT '{}'::jsonb,
      created_at           TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at           TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);
  await db.execute(sql`CREATE INDEX IF NOT EXISTS idx_jaw_entry_id ON journal_approval_workflow(entry_id)`);
  await db.execute(sql`CREATE INDEX IF NOT EXISTS idx_jaw_company_status ON journal_approval_workflow(company_id, status)`);

  // ── FASE 1: journal_approval_logs ────────────────────────────────────────
  await db.execute(sql`
    CREATE TABLE IF NOT EXISTS journal_approval_logs (
      id          SERIAL PRIMARY KEY,
      workflow_id INTEGER,
      entry_id    INTEGER NOT NULL,
      action      TEXT NOT NULL,
      actor_id    TEXT,
      actor_role  TEXT,
      reason      TEXT,
      ip_address  TEXT,
      metadata    JSONB DEFAULT '{}'::jsonb,
      created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);
  await db.execute(sql`CREATE INDEX IF NOT EXISTS idx_jal_workflow_id ON journal_approval_logs(workflow_id)`);
  await db.execute(sql`CREATE INDEX IF NOT EXISTS idx_jal_entry_id ON journal_approval_logs(entry_id)`);
  await db.execute(sql`CREATE INDEX IF NOT EXISTS idx_jal_action ON journal_approval_logs(action)`);

  // ── FASE 5: finance_audit_trail ──────────────────────────────────────────
  await db.execute(sql`
    CREATE TABLE IF NOT EXISTS finance_audit_trail (
      id               SERIAL PRIMARY KEY,
      company_id       INTEGER,
      correlation_id   TEXT NOT NULL,
      entry_id         INTEGER,
      action           TEXT NOT NULL,
      request_source   TEXT,
      user_id          TEXT,
      user_role        TEXT,
      ip_address       TEXT,
      before_state     JSONB,
      after_state      JSONB,
      approval_chain   JSONB DEFAULT '[]'::jsonb,
      created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);
  // Idempotent: add company_id if table already existed without it
  await db.execute(sql`
    DO $$ BEGIN
      IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'finance_audit_trail') THEN
        IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='finance_audit_trail' AND column_name='company_id') THEN
          ALTER TABLE finance_audit_trail ADD COLUMN company_id INTEGER;
        END IF;
      END IF;
    END $$;
  `);
  await db.execute(sql`CREATE INDEX IF NOT EXISTS idx_fat_correlation_id ON finance_audit_trail(correlation_id)`);
  await db.execute(sql`CREATE INDEX IF NOT EXISTS idx_fat_entry_id ON finance_audit_trail(entry_id)`);
  await db.execute(sql`CREATE INDEX IF NOT EXISTS idx_fat_company_created ON finance_audit_trail(company_id, created_at DESC)`);
  await db.execute(sql`CREATE INDEX IF NOT EXISTS idx_fat_created_at ON finance_audit_trail(created_at DESC)`);

  // ── FASE 6: finance_anomaly_log ──────────────────────────────────────────
  await db.execute(sql`
    CREATE TABLE IF NOT EXISTS finance_anomaly_log (
      id              SERIAL PRIMARY KEY,
      company_id      INTEGER,
      detected_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      rule_triggered  TEXT NOT NULL,
      anomaly_score   INTEGER NOT NULL DEFAULT 0,
      severity        TEXT NOT NULL DEFAULT 'LOW',
      entry_id        INTEGER,
      details         JSONB DEFAULT '{}'::jsonb,
      reviewed        BOOLEAN NOT NULL DEFAULT FALSE,
      reviewed_by     TEXT,
      reviewed_at     TIMESTAMPTZ,
      created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);
  await db.execute(sql`CREATE INDEX IF NOT EXISTS idx_fal_company_severity ON finance_anomaly_log(company_id, severity)`);
  await db.execute(sql`CREATE INDEX IF NOT EXISTS idx_fal_entry_id ON finance_anomaly_log(entry_id)`);
  await db.execute(sql`CREATE INDEX IF NOT EXISTS idx_fal_reviewed ON finance_anomaly_log(reviewed)`);

  // ── FASE 4 & 8: Add columns to accounting_entries ───────────────────────
  await db.execute(sql`
    DO $$ BEGIN
      IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'accounting_entries') THEN
        IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='accounting_entries' AND column_name='system_override') THEN
          ALTER TABLE accounting_entries ADD COLUMN system_override BOOLEAN NOT NULL DEFAULT FALSE;
        END IF;
        IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='accounting_entries' AND column_name='override_reason') THEN
          ALTER TABLE accounting_entries ADD COLUMN override_reason TEXT;
        END IF;
        IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='accounting_entries' AND column_name='override_by') THEN
          ALTER TABLE accounting_entries ADD COLUMN override_by TEXT;
        END IF;
        IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='accounting_entries' AND column_name='override_at') THEN
          ALTER TABLE accounting_entries ADD COLUMN override_at TIMESTAMPTZ;
        END IF;
        IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='accounting_entries' AND column_name='governance_flags') THEN
          ALTER TABLE accounting_entries ADD COLUMN governance_flags JSONB DEFAULT '{}'::jsonb;
        END IF;
      END IF;
    END $$;
  `);

  // ── FASE 4: Add columns to financial_periods ─────────────────────────────
  await db.execute(sql`
    DO $$ BEGIN
      IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'financial_periods') THEN
        IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='financial_periods' AND column_name='period_close_signature') THEN
          ALTER TABLE financial_periods ADD COLUMN period_close_signature TEXT;
        END IF;
        IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='financial_periods' AND column_name='close_reason') THEN
          ALTER TABLE financial_periods ADD COLUMN close_reason TEXT;
        END IF;
      END IF;
    END $$;
  `);

  // ── FASE 5: Extend ledger_events with audit columns ──────────────────────
  await db.execute(sql`
    DO $$ BEGIN
      IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'ledger_events') THEN
        IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='ledger_events' AND column_name='governance_correlation_id') THEN
          ALTER TABLE ledger_events ADD COLUMN governance_correlation_id TEXT;
        END IF;
        IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='ledger_events' AND column_name='ip_address') THEN
          ALTER TABLE ledger_events ADD COLUMN ip_address TEXT;
        END IF;
        IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='ledger_events' AND column_name='user_role') THEN
          ALTER TABLE ledger_events ADD COLUMN user_role TEXT;
        END IF;
      END IF;
    END $$;
  `);

  // ── FASE 3: PostgreSQL immutability triggers ─────────────────────────────
  // SAP immutability — block ALL UPDATE on posted entries without exception.
  // Posted entries are write-once: any modification (financial OR metadata) is forbidden.
  // The only safe path after posting is reversal (a new counter-entry in an open period).
  // Note: lockAccountingEntry uses WHERE is_locked = FALSE, so it safely no-ops on already-
  // locked entries and never triggers this function for posted rows.
  await db.execute(sql`
    CREATE OR REPLACE FUNCTION fn_block_posted_entry_update()
    RETURNS TRIGGER LANGUAGE plpgsql AS $$
    BEGIN
      IF OLD.status = 'posted' THEN
        -- Izinkan cancellation: status posted → draft dengan cancel_reason terisi
        IF NEW.status = 'draft' AND NEW.cancel_reason IS NOT NULL AND NEW.cancelled_at IS NOT NULL THEN
          RETURN NEW;
        END IF;
        RAISE EXCEPTION 'IMMUTABILITY_VIOLATION: Cannot modify a posted journal entry (id=%). Posted entries are immutable. Use a reversal entry.', OLD.id;
      END IF;
      RETURN NEW;
    END;
    $$;
  `);
  await db.execute(sql`
    DO $$ BEGIN
      IF NOT EXISTS (
        SELECT 1 FROM pg_trigger WHERE tgname = 'trg_block_posted_update'
        AND tgrelid = 'accounting_entries'::regclass
      ) THEN
        CREATE TRIGGER trg_block_posted_update
          BEFORE UPDATE ON accounting_entries
          FOR EACH ROW EXECUTE FUNCTION fn_block_posted_entry_update();
      END IF;
    EXCEPTION WHEN undefined_table THEN NULL;
    END $$;
  `);

  // Block DELETE on posted entries
  await db.execute(sql`
    CREATE OR REPLACE FUNCTION fn_block_posted_entry_delete()
    RETURNS TRIGGER LANGUAGE plpgsql AS $$
    BEGIN
      IF OLD.status = 'posted' THEN
        RAISE EXCEPTION 'IMMUTABILITY_VIOLATION: Cannot delete a posted journal entry (id=%). Use reversal.', OLD.id;
      END IF;
      RETURN OLD;
    END;
    $$;
  `);
  await db.execute(sql`
    DO $$ BEGIN
      IF NOT EXISTS (
        SELECT 1 FROM pg_trigger WHERE tgname = 'trg_block_posted_delete'
        AND tgrelid = 'accounting_entries'::regclass
      ) THEN
        CREATE TRIGGER trg_block_posted_delete
          BEFORE DELETE ON accounting_entries
          FOR EACH ROW EXECUTE FUNCTION fn_block_posted_entry_delete();
      END IF;
    EXCEPTION WHEN undefined_table THEN NULL;
    END $$;
  `);

  // Block mutation of lines for posted entries
  await db.execute(sql`
    CREATE OR REPLACE FUNCTION fn_block_posted_lines_mutation()
    RETURNS TRIGGER LANGUAGE plpgsql AS $$
    DECLARE
      entry_status TEXT;
    BEGIN
      SELECT status INTO entry_status
      FROM accounting_entries
      WHERE id = COALESCE(NEW.entry_id, OLD.entry_id);

      IF entry_status = 'posted' THEN
        RAISE EXCEPTION 'IMMUTABILITY_VIOLATION: Cannot mutate lines of a posted journal entry. Use reversal.';
      END IF;
      RETURN COALESCE(NEW, OLD);
    END;
    $$;
  `);
  await db.execute(sql`
    DO $$ BEGIN
      IF NOT EXISTS (
        SELECT 1 FROM pg_trigger WHERE tgname = 'trg_block_lines_mutation'
        AND tgrelid = 'accounting_entry_lines'::regclass
      ) THEN
        CREATE TRIGGER trg_block_lines_mutation
          BEFORE INSERT OR UPDATE OR DELETE ON accounting_entry_lines
          FOR EACH ROW EXECUTE FUNCTION fn_block_posted_lines_mutation();
      END IF;
    EXCEPTION WHEN undefined_table THEN NULL;
    END $$;
  `);

  // ── FASE 2: Seed finance RBAC roles ──────────────────────────────────────
  // Permission matrix:
  //   accountant      → journal:draft, journal:view                           (maker only)
  //   finance_approver → journal:view, journal:approve, journal:reject        (checker only)
  //   cfo             → journal:*, accounting:*, accounting:override           (full control)
  //   auditor         → journal:view, accounting:view                          (read-only)
  await db.execute(sql`
    DO $$ BEGIN
      IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'rbac_role_permissions') THEN
        INSERT INTO rbac_role_permissions (role_name, module, action) VALUES
          -- accountant: draft/create only (cannot approve own submissions)
          ('accountant',       'journal',    'view'),
          ('accountant',       'journal',    'draft'),
          ('accountant',       'accounting', 'view'),
          -- finance_approver: view + approve/reject (cannot create)
          ('finance_approver', 'journal',    'view'),
          ('finance_approver', 'journal',    'approve'),
          ('finance_approver', 'journal',    'reject'),
          ('finance_approver', 'accounting', 'view'),
          -- cfo: full control including override
          ('cfo',              'journal',    'view'),
          ('cfo',              'journal',    'draft'),
          ('cfo',              'journal',    'approve'),
          ('cfo',              'journal',    'reject'),
          ('cfo',              'journal',    'override'),
          ('cfo',              'accounting', 'view'),
          ('cfo',              'accounting', 'create'),
          ('cfo',              'accounting', 'approve'),
          ('cfo',              'accounting', 'edit'),
          ('cfo',              'accounting', 'override'),
          ('cfo',              'period',     'close'),
          -- auditor: read-only across all finance modules
          ('auditor',          'journal',    'view'),
          ('auditor',          'accounting', 'view'),
          ('auditor',          'period',     'view'),
          ('auditor',          'audit_trail','view')
        ON CONFLICT DO NOTHING;
      END IF;
    END $$;
  `);

  // ── correlation_id on accounting_entries ─────────────────────────────────
  // Required for full audit traceability: every entry links back to the
  // safeAccountingPost correlationId so the full trail can be reconstructed.
  await db.execute(sql`
    DO $$ BEGIN
      IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'accounting_entries') THEN
        IF NOT EXISTS (SELECT 1 FROM information_schema.columns
                       WHERE table_name='accounting_entries' AND column_name='correlation_id') THEN
          ALTER TABLE accounting_entries ADD COLUMN correlation_id TEXT;
        END IF;
        IF NOT EXISTS (SELECT 1 FROM information_schema.columns
                       WHERE table_name='accounting_entries' AND column_name='system_override') THEN
          ALTER TABLE accounting_entries ADD COLUMN system_override BOOLEAN NOT NULL DEFAULT FALSE;
        END IF;
      END IF;
    END $$;
  `);
  await db.execute(sql`
    CREATE INDEX IF NOT EXISTS idx_ae_correlation_id
    ON accounting_entries(correlation_id)
    WHERE correlation_id IS NOT NULL
  `);

  logger.info("[finance-governance] Migration complete");
}
