/**
 * Recon Metrics Service
 *
 * Records and queries matching metrics per company/bank/date.
 * Metrics are upserted (not overwritten) to accumulate totals.
 *
 * Tables used:
 *  - recon_metrics_daily   (per company + bank + date)
 *  - recon_metrics_hourly  (per company + bank + hour)
 *
 * Available metrics:
 *  matching_count, rule_matches, ecf_matches, manual_reviews,
 *  manual_overrides, false_positive, false_negative,
 *  avg_matching_time_ms, avg_rule_time_ms, avg_ecf_time_ms,
 *  avg_confidence, cache_hit_ratio, rule_hit_ratio,
 *  top_rules, top_failed_rules
 *
 * All queries support filters: company_id, bank_account_id, date range.
 */

// Lazy DB loader — avoids top-level DB connection on module import
// eslint-disable-next-line @typescript-eslint/no-explicit-any
let _db: any;
async function getDb() {
  if (!_db) { _db = (await import("@workspace/db")).db; }
  return _db as typeof DrizzleDb;
}
import { sql } from "drizzle-orm";
import { logger } from "../logger.js";
import type { db as DrizzleDb } from "@workspace/db";

// ─── Types ─────────────────────────────────────────────────────────────────────

export type MetricEventType =
  | "rule_match"
  | "ecf_match"
  | "exact_ref_match"
  | "fallback"
  | "manual_review"
  | "manual_override"
  | "false_positive"
  | "false_negative"
  | "cache_hit"
  | "cache_miss"
  | "rule_hit"
  | "rule_miss";

export interface MatchingMetricEvent {
  companyId: number;
  bankAccountId?: number | null;
  eventType: MetricEventType;
  matchingTimeMs?: number;
  ruleTimeMs?: number;
  ecfTimeMs?: number;
  confidence?: number;
  ruleId?: number;
  ruleName?: string;
}

export interface DailyMetricRow {
  id: number;
  companyId: number;
  bankAccountId: number | null;
  metricDate: string;
  matchingCount: number;
  ruleMatches: number;
  ecfMatches: number;
  exactRefMatches: number;
  manualReviews: number;
  manualOverrides: number;
  falsePositive: number;
  falseNegative: number;
  avgMatchingTimeMs: number;
  avgRuleTimeMs: number;
  avgEcfTimeMs: number;
  avgConfidence: number;
  cacheHits: number;
  cacheMisses: number;
  ruleHits: number;
  ruleMisses: number;
  updatedAt: string;
}

export interface MetricFilters {
  companyId: number;
  bankAccountId?: number | null;
  dateFrom?: string;
  dateTo?: string;
  limit?: number;
}

export interface TopRuleEntry {
  ruleId: number;
  ruleName: string;
  matchCount: number;
  lastMatchedAt: string | null;
}

export interface MetricsSummary {
  companyId: number;
  bankAccountId?: number | null;
  dateFrom: string;
  dateTo: string;
  totalMatchingCount: number;
  totalRuleMatches: number;
  totalEcfMatches: number;
  totalExactRefMatches: number;
  totalManualReviews: number;
  totalManualOverrides: number;
  totalFalsePositive: number;
  totalFalseNegative: number;
  avgMatchingTimeMs: number;
  avgConfidence: number;
  cacheHitRatio: number;
  ruleHitRatio: number;
  topRules: TopRuleEntry[];
  topFailedRules: TopRuleEntry[];
  dailyRows: DailyMetricRow[];
}

// ─── Record Event ─────────────────────────────────────────────────────────────

/**
 * Upsert a metric event into recon_metrics_daily + recon_metrics_hourly.
 * Fire-and-forget safe — errors are logged but not thrown.
 */
export async function recordMatchingEvent(event: MatchingMetricEvent): Promise<void> {
  const db = await getDb();
  try {
    const bankVal = event.bankAccountId != null ? String(event.bankAccountId) : "NULL";
    const bankConflict = event.bankAccountId != null
      ? `bank_account_id = ${event.bankAccountId}`
      : "bank_account_id IS NULL";

    // Determine which counter to increment
    const counterMap: Record<MetricEventType, string> = {
      rule_match:       "rule_matches = rule_matches + 1, matching_count = matching_count + 1",
      ecf_match:        "ecf_matches = ecf_matches + 1, matching_count = matching_count + 1",
      exact_ref_match:  "exact_ref_matches = exact_ref_matches + 1, matching_count = matching_count + 1",
      fallback:         "matching_count = matching_count + 1",
      manual_review:    "manual_reviews = manual_reviews + 1",
      manual_override:  "manual_overrides = manual_overrides + 1",
      false_positive:   "false_positive = false_positive + 1",
      false_negative:   "false_negative = false_negative + 1",
      cache_hit:        "cache_hits = cache_hits + 1",
      cache_miss:       "cache_misses = cache_misses + 1",
      rule_hit:         "rule_hits = rule_hits + 1",
      rule_miss:        "rule_misses = rule_misses + 1",
    };
    const counterClause = counterMap[event.eventType] ?? "matching_count = matching_count + 1";

    // Build time/confidence update clauses (running average approximation)
    const extraSets: string[] = [];
    if (event.matchingTimeMs != null) {
      extraSets.push(`avg_matching_time_ms = (avg_matching_time_ms * matching_count + ${event.matchingTimeMs}) / GREATEST(matching_count + 1, 1)`);
    }
    if (event.ruleTimeMs != null) {
      extraSets.push(`avg_rule_time_ms = (avg_rule_time_ms * rule_matches + ${event.ruleTimeMs}) / GREATEST(rule_matches + 1, 1)`);
    }
    if (event.ecfTimeMs != null) {
      extraSets.push(`avg_ecf_time_ms = (avg_ecf_time_ms * ecf_matches + ${event.ecfTimeMs}) / GREATEST(ecf_matches + 1, 1)`);
    }
    if (event.confidence != null) {
      extraSets.push(`avg_confidence = (avg_confidence * matching_count + ${event.confidence}) / GREATEST(matching_count + 1, 1)`);
    }

    const extraClause = extraSets.length > 0 ? ", " + extraSets.join(", ") : "";

    // Daily upsert
    await db.execute(sql.raw(`
      INSERT INTO recon_metrics_daily
        (company_id, bank_account_id, metric_date)
      VALUES
        (${event.companyId}, ${bankVal}, CURRENT_DATE)
      ON CONFLICT (company_id, bank_account_id, metric_date)
        WHERE ${bankConflict}
      DO NOTHING
    `)).catch(() => {});

    await db.execute(sql.raw(`
      UPDATE recon_metrics_daily
      SET ${counterClause}${extraClause}, updated_at = NOW()
      WHERE company_id = ${event.companyId}
        AND ${bankConflict}
        AND metric_date = CURRENT_DATE
    `)).catch(() => {});

    // Hourly upsert (truncate to hour)
    await db.execute(sql.raw(`
      INSERT INTO recon_metrics_hourly
        (company_id, bank_account_id, metric_hour)
      VALUES
        (${event.companyId}, ${bankVal}, date_trunc('hour', NOW()))
      ON CONFLICT (company_id, bank_account_id, metric_hour)
        WHERE ${bankConflict}
      DO NOTHING
    `)).catch(() => {});

    await db.execute(sql.raw(`
      UPDATE recon_metrics_hourly
      SET matching_count = matching_count + 1, updated_at = NOW()
      WHERE company_id = ${event.companyId}
        AND ${bankConflict}
        AND metric_hour = date_trunc('hour', NOW())
    `)).catch(() => {});

  } catch (e: any) {
    logger.warn({ err: e.message, eventType: event.eventType }, "[reconMetrics] failed to record event — non-fatal");
  }
}

// ─── Query Metrics ─────────────────────────────────────────────────────────────

export async function getMetricsSummary(filters: MetricFilters): Promise<MetricsSummary> {
  const db = await getDb();
  const { companyId, bankAccountId, limit = 30 } = filters;
  const dateFrom = filters.dateFrom ?? new Date(Date.now() - 30 * 86400000).toISOString().slice(0, 10);
  const dateTo   = filters.dateTo   ?? new Date().toISOString().slice(0, 10);

  const bankWhere = bankAccountId != null
    ? `AND bank_account_id = ${bankAccountId}`
    : "";

  // Daily rows
  const dailyRes = await db.execute(sql.raw(`
    SELECT *
    FROM recon_metrics_daily
    WHERE company_id = ${companyId}
      AND metric_date BETWEEN '${dateFrom}' AND '${dateTo}'
      ${bankWhere}
    ORDER BY metric_date DESC
    LIMIT ${limit}
  `)).catch(() => ({ rows: [] }));
  const dailyRows = ((dailyRes as any).rows ?? []).map(rowToDailyMetric);

  // Aggregated totals
  const aggRes = await db.execute(sql.raw(`
    SELECT
      SUM(matching_count)       AS total_matching,
      SUM(rule_matches)         AS total_rule,
      SUM(ecf_matches)          AS total_ecf,
      SUM(exact_ref_matches)    AS total_exact,
      SUM(manual_reviews)       AS total_manual_review,
      SUM(manual_overrides)     AS total_manual_override,
      SUM(false_positive)       AS total_fp,
      SUM(false_negative)       AS total_fn,
      AVG(avg_matching_time_ms) AS avg_time,
      AVG(avg_confidence)       AS avg_conf,
      SUM(cache_hits)           AS total_cache_hits,
      SUM(cache_misses)         AS total_cache_misses,
      SUM(rule_hits)            AS total_rule_hits,
      SUM(rule_misses)          AS total_rule_misses
    FROM recon_metrics_daily
    WHERE company_id = ${companyId}
      AND metric_date BETWEEN '${dateFrom}' AND '${dateTo}'
      ${bankWhere}
  `)).catch(() => ({ rows: [{}] }));
  const agg = ((aggRes as any).rows ?? [{}])[0] ?? {};

  const totalCacheHits   = Number(agg.total_cache_hits   ?? 0);
  const totalCacheMisses = Number(agg.total_cache_misses ?? 0);
  const totalRuleHits    = Number(agg.total_rule_hits    ?? 0);
  const totalRuleMisses  = Number(agg.total_rule_misses  ?? 0);

  const cacheTotal = totalCacheHits + totalCacheMisses;
  const ruleTotal  = totalRuleHits  + totalRuleMisses;

  // Top rules (from recon_rules match_count)
  const topRulesRes = await db.execute(sql.raw(`
    SELECT id, name, match_count, last_matched_at
    FROM recon_rules
    WHERE company_id = ${companyId} AND is_active = TRUE
    ORDER BY match_count DESC
    LIMIT 10
  `)).catch(() => ({ rows: [] }));
  const topRules = ((topRulesRes as any).rows ?? []).map((r: any) => ({
    ruleId:       Number(r.id),
    ruleName:     String(r.name),
    matchCount:   Number(r.match_count ?? 0),
    lastMatchedAt: r.last_matched_at ? String(r.last_matched_at) : null,
  }));

  // Top failed rules = active rules that have never matched (match_count = 0)
  const failedRulesRes = await db.execute(sql.raw(`
    SELECT id, name, match_count, last_matched_at
    FROM recon_rules
    WHERE company_id = ${companyId} AND is_active = TRUE AND match_count = 0
    ORDER BY created_at ASC
    LIMIT 10
  `)).catch(() => ({ rows: [] }));
  const topFailedRules = ((failedRulesRes as any).rows ?? []).map((r: any) => ({
    ruleId:       Number(r.id),
    ruleName:     String(r.name),
    matchCount:   0,
    lastMatchedAt: null,
  }));

  return {
    companyId,
    bankAccountId: bankAccountId ?? undefined,
    dateFrom,
    dateTo,
    totalMatchingCount:    Number(agg.total_matching       ?? 0),
    totalRuleMatches:      Number(agg.total_rule           ?? 0),
    totalEcfMatches:       Number(agg.total_ecf            ?? 0),
    totalExactRefMatches:  Number(agg.total_exact          ?? 0),
    totalManualReviews:    Number(agg.total_manual_review  ?? 0),
    totalManualOverrides:  Number(agg.total_manual_override ?? 0),
    totalFalsePositive:    Number(agg.total_fp             ?? 0),
    totalFalseNegative:    Number(agg.total_fn             ?? 0),
    avgMatchingTimeMs:     Math.round(Number(agg.avg_time  ?? 0) * 100) / 100,
    avgConfidence:         Math.round(Number(agg.avg_conf  ?? 0) * 100) / 100,
    cacheHitRatio:  cacheTotal === 0 ? 0 : Math.round((totalCacheHits / cacheTotal) * 10000) / 100,
    ruleHitRatio:   ruleTotal  === 0 ? 0 : Math.round((totalRuleHits  / ruleTotal)  * 10000) / 100,
    topRules,
    topFailedRules,
    dailyRows,
  };
}

export async function getRuleMetrics(companyId: number): Promise<TopRuleEntry[]> {
  const db = await getDb();
  const res = await db.execute(sql.raw(`
    SELECT id, name, match_count, last_matched_at
    FROM recon_rules
    WHERE company_id = ${companyId}
    ORDER BY match_count DESC
    LIMIT 50
  `)).catch(() => ({ rows: [] }));
  return ((res as any).rows ?? []).map((r: any) => ({
    ruleId:       Number(r.id),
    ruleName:     String(r.name),
    matchCount:   Number(r.match_count ?? 0),
    lastMatchedAt: r.last_matched_at ? String(r.last_matched_at) : null,
  }));
}

// ─── Helper ───────────────────────────────────────────────────────────────────

function rowToDailyMetric(r: Record<string, unknown>): DailyMetricRow {
  return {
    id:              Number(r.id),
    companyId:       Number(r.company_id),
    bankAccountId:   r.bank_account_id != null ? Number(r.bank_account_id) : null,
    metricDate:      String(r.metric_date ?? ""),
    matchingCount:   Number(r.matching_count   ?? 0),
    ruleMatches:     Number(r.rule_matches     ?? 0),
    ecfMatches:      Number(r.ecf_matches      ?? 0),
    exactRefMatches: Number(r.exact_ref_matches ?? 0),
    manualReviews:   Number(r.manual_reviews   ?? 0),
    manualOverrides: Number(r.manual_overrides ?? 0),
    falsePositive:   Number(r.false_positive   ?? 0),
    falseNegative:   Number(r.false_negative   ?? 0),
    avgMatchingTimeMs: Number(r.avg_matching_time_ms ?? 0),
    avgRuleTimeMs:   Number(r.avg_rule_time_ms  ?? 0),
    avgEcfTimeMs:    Number(r.avg_ecf_time_ms   ?? 0),
    avgConfidence:   Number(r.avg_confidence    ?? 0),
    cacheHits:       Number(r.cache_hits        ?? 0),
    cacheMisses:     Number(r.cache_misses      ?? 0),
    ruleHits:        Number(r.rule_hits         ?? 0),
    ruleMisses:      Number(r.rule_misses       ?? 0),
    updatedAt:       String(r.updated_at        ?? ""),
  };
}
