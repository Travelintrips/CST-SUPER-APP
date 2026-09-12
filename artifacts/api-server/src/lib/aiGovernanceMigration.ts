import { db } from "@workspace/db";
import { sql } from "drizzle-orm";
import { logger } from "./logger.js";

export async function runAiGovernanceMigration(): Promise<void> {
  // ── ai_agent_executions ──────────────────────────────────────────────────
  await db.execute(sql`
    CREATE TABLE IF NOT EXISTS ai_agent_executions (
      id                      SERIAL PRIMARY KEY,
      agent_type              TEXT        NOT NULL,
      action                  TEXT        NOT NULL,
      status                  TEXT        NOT NULL DEFAULT 'running',
      confidence              NUMERIC(5,4),
      reasoning               TEXT,
      model_used              TEXT,
      input_tokens            INTEGER,
      output_tokens           INTEGER,
      input_summary           TEXT,
      output_summary          TEXT,
      input_data              JSONB,
      output_data             JSONB,
      order_id                INTEGER,
      rfq_id                  INTEGER,
      company_id              INTEGER,
      triggered_by            TEXT        NOT NULL DEFAULT 'system',
      triggered_by_id         TEXT,
      req_id                  TEXT,
      safety_checks           JSONB,
      human_approval_required BOOLEAN     NOT NULL DEFAULT FALSE,
      approval_id             INTEGER,
      was_overridden          BOOLEAN     NOT NULL DEFAULT FALSE,
      override_by             TEXT,
      override_reason         TEXT,
      duration_ms             INTEGER,
      error_message           TEXT,
      created_at              TIMESTAMP   NOT NULL DEFAULT NOW(),
      completed_at            TIMESTAMP
    )
  `);

  await db.execute(sql`CREATE INDEX IF NOT EXISTS ai_exec_agent_type_idx  ON ai_agent_executions (agent_type)`);
  await db.execute(sql`CREATE INDEX IF NOT EXISTS ai_exec_action_idx       ON ai_agent_executions (action)`);
  await db.execute(sql`CREATE INDEX IF NOT EXISTS ai_exec_status_idx       ON ai_agent_executions (status)`);
  await db.execute(sql`CREATE INDEX IF NOT EXISTS ai_exec_order_id_idx     ON ai_agent_executions (order_id) WHERE order_id IS NOT NULL`);
  await db.execute(sql`CREATE INDEX IF NOT EXISTS ai_exec_company_id_idx   ON ai_agent_executions (company_id) WHERE company_id IS NOT NULL`);
  await db.execute(sql`CREATE INDEX IF NOT EXISTS ai_exec_created_at_idx   ON ai_agent_executions (created_at)`);
  await db.execute(sql`CREATE INDEX IF NOT EXISTS ai_exec_req_id_idx       ON ai_agent_executions (req_id) WHERE req_id IS NOT NULL`);

  // ── ai_approval_queue ────────────────────────────────────────────────────
  await db.execute(sql`
    CREATE TABLE IF NOT EXISTS ai_approval_queue (
      id                  SERIAL PRIMARY KEY,
      execution_id        INTEGER,
      agent_type          TEXT        NOT NULL,
      action              TEXT        NOT NULL,
      action_description  TEXT        NOT NULL,
      context_data        JSONB,
      priority            TEXT        NOT NULL DEFAULT 'medium',
      amount              NUMERIC(18,2),
      order_id            INTEGER,
      rfq_id              INTEGER,
      company_id          INTEGER,
      requested_by_id     TEXT,
      status              TEXT        NOT NULL DEFAULT 'pending',
      expires_at          TIMESTAMP   NOT NULL,
      auto_approve_at     TIMESTAMP,
      decided_by          TEXT,
      decided_at          TIMESTAMP,
      decision_reason     TEXT,
      undo_deadline       TIMESTAMP,
      was_undone          BOOLEAN     NOT NULL DEFAULT FALSE,
      undone_by           TEXT,
      undone_at           TIMESTAMP,
      requested_at        TIMESTAMP   NOT NULL DEFAULT NOW()
    )
  `);

  await db.execute(sql`CREATE INDEX IF NOT EXISTS ai_appr_status_idx      ON ai_approval_queue (status)`);
  await db.execute(sql`CREATE INDEX IF NOT EXISTS ai_appr_priority_idx    ON ai_approval_queue (priority)`);
  await db.execute(sql`CREATE INDEX IF NOT EXISTS ai_appr_order_id_idx    ON ai_approval_queue (order_id) WHERE order_id IS NOT NULL`);
  await db.execute(sql`CREATE INDEX IF NOT EXISTS ai_appr_company_id_idx  ON ai_approval_queue (company_id) WHERE company_id IS NOT NULL`);
  await db.execute(sql`CREATE INDEX IF NOT EXISTS ai_appr_expires_at_idx  ON ai_approval_queue (expires_at)`);
  await db.execute(sql`CREATE INDEX IF NOT EXISTS ai_appr_requested_at_idx ON ai_approval_queue (requested_at)`);

  // Composite: cari semua pending yang belum expired per company
  await db.execute(sql`
    CREATE INDEX IF NOT EXISTS ai_appr_pending_company_idx
    ON ai_approval_queue (company_id, status, expires_at)
    WHERE status = 'pending'
  `);

  // Back-link: approval_id di executions → approval queue
  await db.execute(sql`
    DO $$ BEGIN
      IF NOT EXISTS (
        SELECT 1 FROM pg_constraint
        WHERE conname = 'ai_exec_approval_id_fk'
      ) THEN
        ALTER TABLE ai_agent_executions
          ADD CONSTRAINT ai_exec_approval_id_fk
          FOREIGN KEY (approval_id) REFERENCES ai_approval_queue(id)
          ON DELETE SET NULL;
      END IF;
    END $$
  `);

  logger.info("AI governance migration: selesai (ai_agent_executions + ai_approval_queue ready)");
}
