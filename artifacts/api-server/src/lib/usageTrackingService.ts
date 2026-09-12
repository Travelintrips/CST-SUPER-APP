/**
 * Runtime Usage Tracking Service — Bank Reconciliation Configuration
 *
 * Best-effort telemetry: NEVER throws, NEVER blocks the main transaction.
 * All public functions are fire-and-forget safe.
 *
 * Tracked entities:
 *   - recon_classification_configs   (usage_count, last_used_at/by, last_match_*)
 *   - recon_keyword_dictionary       (usage_count, last_used_at)
 *   - recon_ai_classification_rules  (usage_count, accepted_count, rejected_count, last_used_at)
 *
 * Idempotency:
 *   Every tracking call inserts a row into recon_config_usage_events with a
 *   unique (company_id, idempotency_key). The key is:
 *     "{usage_type}:{target_id}:{mutationId}"
 *   INSERT ON CONFLICT DO NOTHING — aggregate counter only increments if the
 *   event insert succeeded. This ensures that retrying the same approve action
 *   10× results in usage_count incrementing exactly once.
 *
 * Transaction boundary:
 *   Model B (post-commit fire-and-forget). Tracking is invoked only after the
 *   core transaction commits. A tracking failure logs a warning but NEVER rolls
 *   back the reconciliation or journal.
 *
 * Keyword tracking policy:
 *   ALL keywords that match the mutation description are recorded in the events
 *   table. Aggregate usage_count is incremented for every matching keyword
 *   (not just the winner). This gives signal on which keywords appear most in
 *   accepted reconciliations. Policy documented here so it is not a surprise.
 *
 * AI rule metrics:
 *   usage_count    — rule matched the description
 *   accepted_count — feedback: user accepted the recommendation
 *   rejected_count — feedback: user rejected/corrected the recommendation
 *   accepted / (accepted + rejected) = acceptance rate (do NOT compute when
 *   denominator is 0)
 *
 * Performance:
 *   - All UPDATEs are by PRIMARY KEY — no table scans, no table locks.
 *   - Keyword batch UPDATE uses IN (id1, id2, …) on matched IDs only.
 *   - Idempotency event INSERTs use ON CONFLICT DO NOTHING — no lock contention.
 *
 * Guardrails (do not violate):
 *   - Does NOT modify accounting engine
 *   - Does NOT modify Universal Journal Reuse Engine
 *   - Does NOT modify COA Governance
 *   - Does NOT roll back journals if tracking fails
 */

import { db } from "@workspace/db";
import { sql } from "drizzle-orm";
import { logger } from "./logger.js";

// ─── Types ────────────────────────────────────────────────────────────────────

export interface TrackMutationOpts {
  mutationId: number;
  actor: string;
  /** Override amount (falls back to bank_mutations.amount). */
  amount?: number;
  /** Override date as YYYY-MM-DD (falls back to bank_mutations.transaction_date). */
  date?: string;
  companyId?: number | null;
}

export interface TrackAiRuleFeedbackOpts {
  ruleId: number;
  accepted: boolean;
  /** Required for idempotency. Use the mutation or transaction ID. */
  mutationId?: number;
  companyId?: number | null;
}

// ─── Internal helpers ─────────────────────────────────────────────────────────

function q(s: string): string {
  return s.replace(/'/g, "''");
}

/** Normalize description for keyword matching. */
function normalize(s: string): string {
  return s.toLowerCase().trim();
}

/**
 * Insert a usage event. Returns true if the row was inserted (new event),
 * false if it was a duplicate (ON CONFLICT DO NOTHING).
 */
async function insertUsageEvent(opts: {
  companyId: number | null;
  usageType: "config" | "keyword" | "ai_rule";
  targetId: number;
  mutationId: number | null;
  eventType: "approved" | "rejected" | "corrected";
  actor: string;
  amount: number | null;
  idempotencyKey: string;
}): Promise<boolean> {
  const { companyId, usageType, targetId, mutationId, eventType, actor, amount } = opts;
  const companyIdSql = companyId != null ? String(companyId) : "NULL";
  const mutIdSql     = mutationId != null ? String(mutationId) : "NULL";
  const amountSql    = amount != null && amount > 0 ? String(amount) : "NULL";
  const actorSql     = actor ? `'${q(actor)}'` : "NULL";
  const iKey         = q(opts.idempotencyKey);

  const r = await db.execute(sql.raw(`
    INSERT INTO recon_config_usage_events
      (company_id, usage_type, target_id, mutation_id, event_type, actor_user_id, amount, idempotency_key)
    VALUES
      (${companyIdSql}, '${usageType}', ${targetId}, ${mutIdSql}, '${eventType}', ${actorSql}, ${amountSql}, '${iKey}')
    ON CONFLICT (COALESCE(company_id, -1), idempotency_key) DO NOTHING
  `));

  // rowCount > 0 means the row was actually inserted (not a conflict)
  return (r.rowCount ?? 0) > 0;
}

// ─── Phase 2: match + update config usage ─────────────────────────────────────

async function findAndTrackConfig(
  desc: string,
  actor: string,
  amount: number,
  txDate: string,
  companyId: number | null,
  matchedKeywordIds: number[],
  mutationId: number,
): Promise<void> {
  // 1. Try to identify best config via keyword dictionary (link already resolved)
  let bestConfigId: number | null = null;

  if (matchedKeywordIds.length > 0) {
    const idList = matchedKeywordIds.join(",");
    const { rows } = await db.execute(sql.raw(`
      SELECT config_id FROM recon_keyword_dictionary
      WHERE id IN (${idList}) AND config_id IS NOT NULL
      ORDER BY weight DESC LIMIT 1
    `));
    if (rows[0]) bestConfigId = Number((rows[0] as any).config_id);
  }

  // 2. Fall back: scan inline keywords on configs (ordered by priority)
  if (bestConfigId == null) {
    const companyFilter = companyId != null
      ? `AND (company_id IS NULL OR company_id = ${companyId})`
      : `AND company_id IS NULL`;
    const { rows: configs } = await db.execute(sql.raw(`
      SELECT id, keywords
      FROM recon_classification_configs
      WHERE is_active = TRUE ${companyFilter}
      ORDER BY priority ASC, id ASC
    `));
    for (const c of configs as any[]) {
      const kwArr: string[] = Array.isArray(c.keywords)
        ? c.keywords
        : JSON.parse(String(c.keywords ?? "[]"));
      if (kwArr.some(t => t.length > 0 && desc.includes(normalize(t)))) {
        bestConfigId = Number(c.id);
        break;
      }
    }
  }

  if (bestConfigId == null) return; // no config matched — nothing to track

  // 3. Idempotency-gated aggregate increment
  const iKey = `config:${bestConfigId}:${mutationId}`;
  const inserted = await insertUsageEvent({
    companyId, usageType: "config", targetId: bestConfigId,
    mutationId, eventType: "approved", actor,
    amount: amount > 0 ? amount : null,
    idempotencyKey: iKey,
  });

  if (!inserted) {
    logger.debug(
      { configId: bestConfigId, mutationId, iKey },
      "[usageTracking] config event already recorded — skip increment",
    );
    return;
  }

  // 4. Atomic UPDATE by PK (no lock escalation)
  const actorSql  = actor ? `'${q(actor)}'` : "NULL";
  const amountSql = amount > 0 ? String(amount) : "NULL";
  const dateSql   = txDate ? `'${q(txDate)}'::DATE` : "NOW()::DATE";

  await db.execute(sql.raw(`
    UPDATE recon_classification_configs
    SET
      usage_count      = usage_count + 1,
      last_used_at     = NOW(),
      last_used_by     = ${actorSql},
      last_match_amount = ${amountSql},
      last_match_date  = ${dateSql},
      updated_at       = NOW()
    WHERE id = ${bestConfigId}
  `));

  logger.info(
    { configId: bestConfigId, mutationId, actor, amount, txDate },
    "[usageTracking] config usage incremented",
  );
}

// ─── Public API ───────────────────────────────────────────────────────────────

/**
 * Track usage after a bank mutation is successfully approved.
 *
 * Fire-and-forget: caller must NOT await this when inside the main TX.
 * Usage: `trackMutationApproval(...).catch(() => {});`
 */
export async function trackMutationApproval(opts: TrackMutationOpts): Promise<void> {
  try {
    const { mutationId, actor, companyId = null } = opts;

    // Fetch mutation row for description + amount + date
    const { rows: muts } = await db.execute(sql.raw(`
      SELECT description, amount, credit_amount, debit_amount, transaction_date, company_id
      FROM bank_mutations WHERE id = ${mutationId} LIMIT 1
    `));
    if (!muts[0]) return;

    const mut       = muts[0] as any;
    const desc      = normalize(String(mut.description ?? ""));
    const txAmount  = opts.amount  ?? Math.max(Number(mut.amount ?? 0), Number(mut.credit_amount ?? 0), Number(mut.debit_amount ?? 0));
    const txDate    = opts.date    ?? String(mut.transaction_date ?? "").split("T")[0];
    const effCompanyId = companyId ?? (mut.company_id != null ? Number(mut.company_id) : null);

    if (!desc) return;

    // ── Keyword dictionary match ──────────────────────────────────────────────
    const companyKwFilter = effCompanyId != null
      ? `AND (company_id IS NULL OR company_id = ${effCompanyId})`
      : `AND company_id IS NULL`;

    const { rows: keywords } = await db.execute(sql.raw(`
      SELECT id, term, config_id, weight
      FROM recon_keyword_dictionary
      WHERE is_active = TRUE ${companyKwFilter}
      ORDER BY weight DESC, id ASC
    `));

    const matchedKeywordIds: number[] = [];
    for (const kw of keywords as any[]) {
      const term = normalize(String(kw.term ?? ""));
      if (term && desc.includes(term)) {
        matchedKeywordIds.push(Number(kw.id));
      }
    }

    // Idempotency-gated keyword usage increments
    const keywordsToIncrement: number[] = [];
    for (const kwId of matchedKeywordIds) {
      const iKey = `keyword:${kwId}:${mutationId}`;
      const inserted = await insertUsageEvent({
        companyId: effCompanyId, usageType: "keyword", targetId: kwId,
        mutationId, eventType: "approved", actor, amount: null,
        idempotencyKey: iKey,
      });
      if (inserted) keywordsToIncrement.push(kwId);
    }

    if (keywordsToIncrement.length > 0) {
      await db.execute(sql.raw(`
        UPDATE recon_keyword_dictionary
        SET usage_count = usage_count + 1, last_used_at = NOW()
        WHERE id IN (${keywordsToIncrement.join(",")})
      `));
    }

    // ── AI rule match ─────────────────────────────────────────────────────────
    const companyRuleFilter = effCompanyId != null
      ? `AND (company_id IS NULL OR company_id = ${effCompanyId})`
      : `AND company_id IS NULL`;

    const { rows: aiRules } = await db.execute(sql.raw(`
      SELECT id, condition_field, condition_operator, condition_value
      FROM recon_ai_classification_rules
      WHERE is_active = TRUE ${companyRuleFilter}
      ORDER BY priority ASC, id ASC
    `));

    const rulesToIncrement: number[] = [];
    for (const rule of aiRules as any[]) {
      const field = String(rule.condition_field ?? "");
      const op    = String(rule.condition_operator ?? "");
      const val   = normalize(String(rule.condition_value ?? ""));
      if (field === "description" || field === "normalized") {
        let hit = false;
        if (op === "contains")     hit = desc.includes(val);
        else if (op === "starts_with") hit = desc.startsWith(val);
        else if (op === "regex") {
          try { hit = new RegExp(val, "i").test(desc); } catch { /* invalid regex */ }
        }
        if (hit) {
          const iKey = `ai_rule:${rule.id}:${mutationId}`;
          const inserted = await insertUsageEvent({
            companyId: effCompanyId, usageType: "ai_rule", targetId: Number(rule.id),
            mutationId, eventType: "approved", actor, amount: null,
            idempotencyKey: iKey,
          });
          if (inserted) rulesToIncrement.push(Number(rule.id));
        }
      }
    }

    if (rulesToIncrement.length > 0) {
      await db.execute(sql.raw(`
        UPDATE recon_ai_classification_rules
        SET usage_count = usage_count + 1, last_used_at = NOW()
        WHERE id IN (${rulesToIncrement.join(",")})
      `));
    }

    // ── Config usage ──────────────────────────────────────────────────────────
    await findAndTrackConfig(desc, actor, txAmount, txDate, effCompanyId, matchedKeywordIds, mutationId);

  } catch (err) {
    logger.warn(
      { err: err instanceof Error ? err.message : String(err), mutationId: opts.mutationId },
      "[usageTracking] trackMutationApproval failed — non-fatal, transaction unaffected",
    );
  }
}

/**
 * Explicitly increment a specific config's usage (e.g. when config_code is
 * known from a prior classification step).
 */
export async function trackConfigUsageByCode(opts: {
  configCode: string;
  actor: string;
  mutationId?: number;
  amount?: number;
  date?: string;
  companyId?: number | null;
}): Promise<void> {
  try {
    const { configCode, actor } = opts;

    // Resolve config ID first (needed for idempotency key)
    const { rows } = await db.execute(sql.raw(`
      SELECT id FROM recon_classification_configs
      WHERE code = '${q(configCode)}' AND is_active = TRUE LIMIT 1
    `));
    if (!rows[0]) return;
    const configId = Number((rows[0] as any).id);

    const mutId = opts.mutationId ?? null;
    const iKey  = mutId != null ? `config:${configId}:${mutId}` : `config:${configId}:code:${q(configCode)}:${Date.now()}`;

    const inserted = await insertUsageEvent({
      companyId: opts.companyId ?? null, usageType: "config", targetId: configId,
      mutationId: mutId, eventType: "approved", actor,
      amount: opts.amount ?? null,
      idempotencyKey: iKey,
    });
    if (!inserted) return;

    const actorSql  = actor ? `'${q(actor)}'` : "NULL";
    const amountSql = opts.amount && opts.amount > 0 ? String(opts.amount) : "NULL";
    const dateSql   = opts.date ? `'${q(opts.date)}'::DATE` : "NOW()::DATE";

    await db.execute(sql.raw(`
      UPDATE recon_classification_configs
      SET
        usage_count      = usage_count + 1,
        last_used_at     = NOW(),
        last_used_by     = ${actorSql},
        last_match_amount = ${amountSql},
        last_match_date  = ${dateSql},
        updated_at       = NOW()
      WHERE id = ${configId}
    `));
  } catch (err) {
    logger.warn(
      { err: err instanceof Error ? err.message : String(err), configCode: opts.configCode },
      "[usageTracking] trackConfigUsageByCode failed — non-fatal",
    );
  }
}

/**
 * Record AI rule feedback (accepted / rejected recommendation).
 * Updates accepted_count or rejected_count on the AI rule.
 * Idempotency key: "ai_rule_feedback:{ruleId}:{mutationId}:{accepted}"
 */
export async function trackAiRuleFeedback(opts: TrackAiRuleFeedbackOpts): Promise<void> {
  try {
    const { ruleId, accepted, mutationId, companyId = null } = opts;
    const eventType = accepted ? "approved" : "rejected";
    const col       = accepted ? "accepted_count" : "rejected_count";

    const iKey = mutationId != null
      ? `ai_rule_feedback:${ruleId}:${mutationId}:${eventType}`
      : `ai_rule_feedback:${ruleId}:${eventType}:${Date.now()}`;

    const inserted = await insertUsageEvent({
      companyId, usageType: "ai_rule", targetId: ruleId,
      mutationId: mutationId ?? null, eventType, actor: "", amount: null,
      idempotencyKey: iKey,
    });
    if (!inserted) return;

    await db.execute(sql.raw(`
      UPDATE recon_ai_classification_rules
      SET ${col} = ${col} + 1, last_used_at = NOW()
      WHERE id = ${ruleId}
    `));
  } catch (err) {
    logger.warn(
      { err: err instanceof Error ? err.message : String(err), ruleId: opts.ruleId },
      "[usageTracking] trackAiRuleFeedback failed — non-fatal",
    );
  }
}

/**
 * Run the additive migration: creates the usage events table and adds
 * tracking columns to the 3 recon tables + bank_mutations.
 * Idempotent — uses ADD COLUMN IF NOT EXISTS / CREATE TABLE IF NOT EXISTS.
 */
export async function runUsageTrackingMigration(): Promise<void> {
  // ── recon_config_usage_events (idempotency table) ─────────────────────────
  await db.execute(sql.raw(`
    CREATE TABLE IF NOT EXISTS recon_config_usage_events (
      id              BIGSERIAL PRIMARY KEY,
      company_id      INTEGER,
      usage_type      TEXT NOT NULL,
      target_id       INTEGER NOT NULL,
      mutation_id     INTEGER,
      reconciliation_id INTEGER,
      event_type      TEXT NOT NULL DEFAULT 'approved',
      actor_user_id   TEXT,
      amount          NUMERIC(15,2),
      used_at         TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      idempotency_key TEXT NOT NULL,
      created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `)).catch(() => {});

  // Unique constraint for idempotency — COALESCE so NULL company_id participates
  await db.execute(sql.raw(`
    CREATE UNIQUE INDEX IF NOT EXISTS idx_recon_usage_events_idempotency
    ON recon_config_usage_events (COALESCE(company_id, -1), idempotency_key)
  `)).catch(() => {});

  await db.execute(sql.raw(`
    CREATE INDEX IF NOT EXISTS idx_recon_usage_events_target
    ON recon_config_usage_events (usage_type, target_id)
  `)).catch(() => {});

  await db.execute(sql.raw(`
    CREATE INDEX IF NOT EXISTS idx_recon_usage_events_mutation
    ON recon_config_usage_events (mutation_id) WHERE mutation_id IS NOT NULL
  `)).catch(() => {});

  // ── recon_classification_configs — tracking columns ────────────────────────
  for (const stmt of [
    `ALTER TABLE recon_classification_configs ADD COLUMN IF NOT EXISTS usage_count      INTEGER NOT NULL DEFAULT 0`,
    `ALTER TABLE recon_classification_configs ADD COLUMN IF NOT EXISTS last_used_at     TIMESTAMPTZ`,
    `ALTER TABLE recon_classification_configs ADD COLUMN IF NOT EXISTS last_used_by     TEXT`,
    `ALTER TABLE recon_classification_configs ADD COLUMN IF NOT EXISTS last_match_amount NUMERIC(15,2)`,
    `ALTER TABLE recon_classification_configs ADD COLUMN IF NOT EXISTS last_match_date  DATE`,
  ]) {
    await db.execute(sql.raw(stmt)).catch(() => {});
  }

  // ── recon_keyword_dictionary — tracking columns ────────────────────────────
  for (const stmt of [
    `ALTER TABLE recon_keyword_dictionary ADD COLUMN IF NOT EXISTS usage_count  INTEGER NOT NULL DEFAULT 0`,
    `ALTER TABLE recon_keyword_dictionary ADD COLUMN IF NOT EXISTS last_used_at TIMESTAMPTZ`,
  ]) {
    await db.execute(sql.raw(stmt)).catch(() => {});
  }

  // ── recon_ai_classification_rules — tracking columns ──────────────────────
  for (const stmt of [
    `ALTER TABLE recon_ai_classification_rules ADD COLUMN IF NOT EXISTS usage_count    INTEGER NOT NULL DEFAULT 0`,
    `ALTER TABLE recon_ai_classification_rules ADD COLUMN IF NOT EXISTS last_used_at   TIMESTAMPTZ`,
    `ALTER TABLE recon_ai_classification_rules ADD COLUMN IF NOT EXISTS accepted_count INTEGER NOT NULL DEFAULT 0`,
    `ALTER TABLE recon_ai_classification_rules ADD COLUMN IF NOT EXISTS rejected_count INTEGER NOT NULL DEFAULT 0`,
  ]) {
    await db.execute(sql.raw(stmt)).catch(() => {});
  }

  // ── bank_mutations — recon_config_code writeback ──────────────────────────
  await db.execute(sql.raw(
    `ALTER TABLE bank_mutations ADD COLUMN IF NOT EXISTS recon_config_code TEXT`,
  )).catch(() => {});

  logger.info("[usageTracking] Migration complete (events table + additive columns)");
}
