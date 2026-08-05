/**
 * Bank Allocation & Auto-Matching Foundation — Sprint 4 Phase 2
 *
 * NEW tables only. Does NOT touch bank_mutations, bank_reconciliation_matches,
 * allocation_headers, allocation_lines — those belong to Phase 1 / unified
 * reconciliation and are read-only from this module's perspective.
 *
 * RULE: this migration/module never posts a journal. Journal posting stays
 * inside AdvanceJournalService, called only from routes/allocation.ts.
 */
import { db } from "@workspace/db";
import { sql } from "drizzle-orm";
import { logger } from "./logger.js";

export async function runBankAllocationMigration(): Promise<void> {
  try {
    // ── bank_allocation_matches ────────────────────────────────────────────────
    // One row per (bank_mutation, candidate) scored pair. The "chosen" row for a
    // mutation is the one whose status progresses UNMATCHED->CANDIDATE->MATCHED->
    // CONFIRMED. POSTED is derived at query time by joining allocation_headers.
    await db.execute(sql`
      CREATE TABLE IF NOT EXISTS bank_allocation_matches (
        id                    SERIAL PRIMARY KEY,
        bank_mutation_id      INTEGER NOT NULL,
        company_id            INTEGER,
        candidate_type        TEXT NOT NULL,
        candidate_id          INTEGER NOT NULL,
        candidate_ref         TEXT,
        candidate_name        TEXT,
        candidate_amount      NUMERIC(16,2),
        allocation_header_id  INTEGER,
        match_score           NUMERIC(5,2) NOT NULL DEFAULT 0,
        score_breakdown       JSONB,
        status                TEXT NOT NULL DEFAULT 'CANDIDATE',
        is_auto_suggested     BOOLEAN NOT NULL DEFAULT FALSE,
        matched_amount        NUMERIC(16,2),
        reject_reason         TEXT,
        selected_by           TEXT,
        selected_at           TIMESTAMPTZ,
        confirmed_by          TEXT,
        confirmed_at          TIMESTAMPTZ,
        created_at            TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at            TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )
    `).catch(() => {});

    await db.execute(sql`CREATE INDEX IF NOT EXISTS idx_bam_mutation ON bank_allocation_matches(bank_mutation_id)`).catch(() => {});
    await db.execute(sql`CREATE INDEX IF NOT EXISTS idx_bam_status ON bank_allocation_matches(status)`).catch(() => {});
    await db.execute(sql`CREATE INDEX IF NOT EXISTS idx_bam_company ON bank_allocation_matches(company_id)`).catch(() => {});
    await db.execute(sql`CREATE INDEX IF NOT EXISTS idx_bam_alloc_header ON bank_allocation_matches(allocation_header_id)`).catch(() => {});

    // Only one active (non-rejected) match per mutation may reach MATCHED/CONFIRMED —
    // enforced at the application layer (see bankAllocationMatching.ts), this index
    // just prevents duplicate scoring rows for the identical (mutation, candidate) pair.
    await db.execute(sql`
      CREATE UNIQUE INDEX IF NOT EXISTS idx_bam_mutation_candidate_unique
      ON bank_allocation_matches (bank_mutation_id, candidate_type, candidate_id)
    `).catch(() => {});

    // P0 guard: exactly ONE confirmed match is allowed per bank_mutation_id.
    // This is the DB-level backstop for the concurrent-confirm race — even if two
    // requests both pass the application-layer status check before either commits,
    // the second INSERT / UPDATE that tries to add a second CONFIRMED row for the
    // same mutation will fail with a unique constraint violation.
    await db.execute(sql`
      CREATE UNIQUE INDEX IF NOT EXISTS idx_bam_one_confirmed_per_mutation
      ON bank_allocation_matches (bank_mutation_id)
      WHERE status = 'CONFIRMED'
    `).catch(() => {});

    // ── bank_allocation_match_logs ─────────────────────────────────────────────
    await db.execute(sql`
      CREATE TABLE IF NOT EXISTS bank_allocation_match_logs (
        id                SERIAL PRIMARY KEY,
        bank_mutation_id  INTEGER NOT NULL,
        match_id          INTEGER,
        action            TEXT NOT NULL,
        actor             TEXT,
        actor_id          INTEGER,
        from_status       TEXT,
        to_status         TEXT,
        notes             TEXT,
        snapshot          JSONB,
        created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )
    `).catch(() => {});

    await db.execute(sql`CREATE INDEX IF NOT EXISTS idx_baml_mutation ON bank_allocation_match_logs(bank_mutation_id)`).catch(() => {});
    await db.execute(sql`CREATE INDEX IF NOT EXISTS idx_baml_action ON bank_allocation_match_logs(action)`).catch(() => {});

    // ── bank_allocation_rules ───────────────────────────────────────────────────
    // Configurable scoring weights per company (company_id NULL = global default).
    await db.execute(sql`
      CREATE TABLE IF NOT EXISTS bank_allocation_rules (
        id                      SERIAL PRIMARY KEY,
        company_id              INTEGER,
        rule_name               TEXT NOT NULL DEFAULT 'default',
        weight_amount           NUMERIC(5,2) NOT NULL DEFAULT 40,
        weight_reference        NUMERIC(5,2) NOT NULL DEFAULT 25,
        weight_invoice          NUMERIC(5,2) NOT NULL DEFAULT 15,
        weight_customer         NUMERIC(5,2) NOT NULL DEFAULT 10,
        weight_date             NUMERIC(5,2) NOT NULL DEFAULT 5,
        weight_company          NUMERIC(5,2) NOT NULL DEFAULT 5,
        auto_suggest_threshold  NUMERIC(5,2) NOT NULL DEFAULT 95,
        manual_review_floor     NUMERIC(5,2) NOT NULL DEFAULT 50,
        is_active               BOOLEAN NOT NULL DEFAULT TRUE,
        created_at              TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at              TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )
    `).catch(() => {});

    await db.execute(sql`CREATE INDEX IF NOT EXISTS idx_bar_company ON bank_allocation_rules(company_id)`).catch(() => {});

    // Seed one global default rule row if none exists
    await db.execute(sql`
      INSERT INTO bank_allocation_rules (company_id, rule_name)
      SELECT NULL, 'default'
      WHERE NOT EXISTS (SELECT 1 FROM bank_allocation_rules WHERE company_id IS NULL)
    `).catch(() => {});

    // ── bank_allocation_exceptions ──────────────────────────────────────────────
    await db.execute(sql`
      CREATE TABLE IF NOT EXISTS bank_allocation_exceptions (
        id                SERIAL PRIMARY KEY,
        bank_mutation_id  INTEGER NOT NULL,
        company_id        INTEGER,
        exception_type    TEXT NOT NULL,
        details           JSONB,
        status            TEXT NOT NULL DEFAULT 'open',
        resolved_by       TEXT,
        resolved_at       TIMESTAMPTZ,
        created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )
    `).catch(() => {});

    await db.execute(sql`CREATE INDEX IF NOT EXISTS idx_bae_mutation ON bank_allocation_exceptions(bank_mutation_id)`).catch(() => {});
    await db.execute(sql`CREATE INDEX IF NOT EXISTS idx_bae_status ON bank_allocation_exceptions(status)`).catch(() => {});
    await db.execute(sql`CREATE INDEX IF NOT EXISTS idx_bae_type ON bank_allocation_exceptions(exception_type)`).catch(() => {});

    logger.info("[bankAllocationMigration] Tables bank_allocation_matches, bank_allocation_match_logs, bank_allocation_rules, bank_allocation_exceptions ready");
  } catch (err) {
    logger.warn({ err }, "[bankAllocationMigration] Non-fatal migration warning");
  }
}
