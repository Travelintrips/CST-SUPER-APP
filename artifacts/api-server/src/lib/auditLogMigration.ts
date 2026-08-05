import { db } from "@workspace/db";
import { sql } from "drizzle-orm";

export async function runAuditLogMigration(): Promise<void> {
  // Buat tabel erp_audit_logs
  await db.execute(sql`
    CREATE TABLE IF NOT EXISTS erp_audit_logs (
      id           SERIAL PRIMARY KEY,
      company_id   INTEGER,
      branch_id    INTEGER,
      user_id      TEXT,
      user_email   TEXT,
      action       TEXT NOT NULL,
      module       TEXT NOT NULL,
      reference_id TEXT,
      old_data     JSONB,
      new_data     JSONB,
      ip_address   TEXT,
      user_agent   TEXT,
      created_at   TIMESTAMP NOT NULL DEFAULT NOW()
    )
  `);

  // Index untuk query efisien
  await db.execute(sql`
    CREATE INDEX IF NOT EXISTS erp_audit_logs_company_idx   ON erp_audit_logs (company_id);
    CREATE INDEX IF NOT EXISTS erp_audit_logs_user_idx      ON erp_audit_logs (user_id);
    CREATE INDEX IF NOT EXISTS erp_audit_logs_module_idx    ON erp_audit_logs (module);
    CREATE INDEX IF NOT EXISTS erp_audit_logs_action_idx    ON erp_audit_logs (action);
    CREATE INDEX IF NOT EXISTS erp_audit_logs_created_idx   ON erp_audit_logs (created_at DESC);
    CREATE INDEX IF NOT EXISTS erp_audit_logs_branch_idx    ON erp_audit_logs (branch_id);
    CREATE INDEX IF NOT EXISTS erp_audit_logs_ref_idx       ON erp_audit_logs (reference_id);
  `);

  // ── Append-only trigger: block UPDATE dan DELETE ──────────────────────────
  // CREATE OR REPLACE tidak tersedia untuk trigger, jadi gunakan DROP IF EXISTS lalu CREATE.
  // Idempoten: aman dipanggil berulang kali.
  await db.execute(sql`
    CREATE OR REPLACE FUNCTION erp_audit_log_immutability()
    RETURNS TRIGGER LANGUAGE plpgsql AS $$
    BEGIN
      RAISE EXCEPTION
        'erp_audit_logs: UPDATE dan DELETE tidak diizinkan. '
        'Audit trail bersifat append-only. '
        '(action=%, module=%, id=%)',
        OLD.action, OLD.module, OLD.id;
    END;
    $$
  `);

  await db.execute(sql`
    DROP TRIGGER IF EXISTS erp_audit_log_guard ON erp_audit_logs
  `);

  await db.execute(sql`
    CREATE TRIGGER erp_audit_log_guard
      BEFORE UPDATE OR DELETE ON erp_audit_logs
      FOR EACH ROW EXECUTE FUNCTION erp_audit_log_immutability()
  `);

  console.log("[auditLogMigration] erp_audit_logs table ready (append-only trigger installed)");
}
