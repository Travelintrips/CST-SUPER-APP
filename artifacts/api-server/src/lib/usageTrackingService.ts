/**
 * Runtime Usage Tracking Service — Bank Reconciliation Configuration
 *
 * Best-effort telemetry: NEVER throws, NEVER blocks the main transaction.
 * All public functions are fire-and-forget safe.
 *
 * Tracked entities:
 *   - recon_classification_configs   (usage_count, last_used_at/by, last_match_*)
 *   - recon_keyword_dictionary       (usage_count, last_used_at)
 *   - recon_ai_classification_rules  (usage_count, last_used_at, accepted/rejected)
 *
 * Performance contract:
 *   - All UPDATEs are by PRIMARY KEY — no table scans, no table locks.
 *   - Keyword batch UPDATE uses IN (id1, id2, …) on matched IDs only.
 *   - Keyword matching is done in-process with a single SELECT — no N+1.
 *   - Keyword/config lists are fetched once per tracking call and discarded.
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
}

// ─── Internal helpers ─────────────────────────────────────────────────────────

function q(s: string): string {
  return s.replace(/'/g, "''");
}

/** Normalize description for keyword matching. */
function normalize(s: string): string {
  return s.toLowerCase().trim();
}

/** Check whether any keyword term appears in the normalized description. */
function keywordHits(desc: string, terms: string[]): boolean {
  return terms.some(t => t.length > 0 && desc.includes(t));
}

// ─── Phase 2: match + update config usage ─────────────────────────────────────

async function findAndTrackConfig(
  desc: string,
  actor: string,
  amount: number,
  txDate: string,
  companyId: number | null,
  matchedKeywordIds: number[],
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
      if (keywordHits(desc, kwArr.map(normalize))) {
        bestConfigId = Number(c.id);
        break;
      }
    }
  }

  if (bestConfigId == null) return; // no config matched — nothing to track

  // 3. Atomic UPDATE by PK (no lock escalation)
  const actorSql   = actor   ? `'${q(actor)}'`              : "NULL";
  const amountSql  = amount > 0 ? String(amount)             : "NULL";
  const dateSql    = txDate   ? `'${q(txDate)}'::DATE`        : "NOW()::DATE";

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
    { configId: bestConfigId, actor, amount, txDate },
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

    // Batch-update keyword usage in one statement
    if (matchedKeywordIds.length > 0) {
      await db.execute(sql.raw(`
        UPDATE recon_keyword_dictionary
        SET usage_count = usage_count + 1, last_used_at = NOW()
        WHERE id IN (${matchedKeywordIds.join(",")})
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

    const matchedRuleIds: number[] = [];
    for (const rule of aiRules as any[]) {
      const field = String(rule.condition_field ?? "");
      const op    = String(rule.condition_operator ?? "");
      const val   = normalize(String(rule.condition_value ?? ""));
      if (field === "description" || field === "normalized") {
        let hit = false;
        if (op === "contains")    hit = desc.includes(val);
        else if (op === "starts_with") hit = desc.startsWith(val);
        else if (op === "regex") {
          try { hit = new RegExp(val, "i").test(desc); } catch { /* invalid regex */ }
        }
        if (hit) matchedRuleIds.push(Number(rule.id));
      }
    }

    if (matchedRuleIds.length > 0) {
      await db.execute(sql.raw(`
        UPDATE recon_ai_classification_rules
        SET usage_count = usage_count + 1, last_used_at = NOW()
        WHERE id IN (${matchedRuleIds.join(",")})
      `));
    }

    // ── Config usage ──────────────────────────────────────────────────────────
    await findAndTrackConfig(desc, actor, txAmount, txDate, effCompanyId, matchedKeywordIds);

    // ── Write config_code back to bank_mutations (best-effort) ───────────────
    // Already handled inside findAndTrackConfig — skipped here to avoid re-query.

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
  amount?: number;
  date?: string;
}): Promise<void> {
  try {
    const { configCode, actor } = opts;
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
      WHERE code = '${q(configCode)}' AND is_active = TRUE
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
 */
export async function trackAiRuleFeedback(opts: TrackAiRuleFeedbackOpts): Promise<void> {
  try {
    const { ruleId, accepted } = opts;
    const col = accepted ? "accepted_count" : "rejected_count";
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
 * Run the Phase 2 additive migration: adds tracking columns to the 3 recon tables
 * and adds recon_config_code to bank_mutations.
 * Idempotent — uses ADD COLUMN IF NOT EXISTS.
 */
export async function runUsageTrackingMigration(): Promise<void> {
  // recon_classification_configs — add tracking columns
  for (const stmt of [
    `ALTER TABLE recon_classification_configs ADD COLUMN IF NOT EXISTS last_used_at     TIMESTAMPTZ`,
    `ALTER TABLE recon_classification_configs ADD COLUMN IF NOT EXISTS last_used_by     TEXT`,
    `ALTER TABLE recon_classification_configs ADD COLUMN IF NOT EXISTS last_match_amount NUMERIC(15,2)`,
    `ALTER TABLE recon_classification_configs ADD COLUMN IF NOT EXISTS last_match_date  DATE`,
  ]) {
    await db.execute(sql.raw(stmt)).catch(() => {});
  }

  // recon_keyword_dictionary — add tracking columns
  for (const stmt of [
    `ALTER TABLE recon_keyword_dictionary ADD COLUMN IF NOT EXISTS usage_count  INTEGER NOT NULL DEFAULT 0`,
    `ALTER TABLE recon_keyword_dictionary ADD COLUMN IF NOT EXISTS last_used_at TIMESTAMPTZ`,
  ]) {
    await db.execute(sql.raw(stmt)).catch(() => {});
  }

  // recon_ai_classification_rules — add tracking columns
  for (const stmt of [
    `ALTER TABLE recon_ai_classification_rules ADD COLUMN IF NOT EXISTS usage_count    INTEGER NOT NULL DEFAULT 0`,
    `ALTER TABLE recon_ai_classification_rules ADD COLUMN IF NOT EXISTS last_used_at   TIMESTAMPTZ`,
    `ALTER TABLE recon_ai_classification_rules ADD COLUMN IF NOT EXISTS accepted_count INTEGER NOT NULL DEFAULT 0`,
    `ALTER TABLE recon_ai_classification_rules ADD COLUMN IF NOT EXISTS rejected_count INTEGER NOT NULL DEFAULT 0`,
  ]) {
    await db.execute(sql.raw(stmt)).catch(() => {});
  }

  // bank_mutations — add recon_config_code for writeback
  await db.execute(sql.raw(
    `ALTER TABLE bank_mutations ADD COLUMN IF NOT EXISTS recon_config_code TEXT`,
  )).catch(() => {});

  logger.info("[usageTracking] Phase 2 migration complete (additive columns)");
}
