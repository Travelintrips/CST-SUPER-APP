/**
 * Phase 4 — Historical Matching Engine
 *
 * Uses previously approved admin classifications as the source of truth.
 * Excluded from history: mutations with status 'rejected', 'cancelled', or 'corrected'.
 *
 * Signals (max 100 pts total):
 *   exact_normalized   40 — normalized description matches exactly
 *   vendor_match       25 — vendor/counterparty token overlap ≥ 0.4
 *   similarity         15 — Jaccard token similarity ≥ 0.25 (scaled)
 *   recurring_monthly  12 — same amount on similar day-of-month, ≥ 2 distinct months
 *   amount_consistency  8 — same amount seen ≥ 2 times for same candidate
 *
 * Guarantees:
 *   - Company isolation is MANDATORY: no cross-company history leak.
 *   - No AI fallback, no journal posting, no expense creation, no tax automation.
 *   - All scoring functions are pure (no DB calls).
 */

import { db } from "@workspace/db";
import type { ReconciliationCandidateSource } from "@workspace/db";
import { sql } from "drizzle-orm";
import { logger } from "../logger.js";

// ─── Constants ────────────────────────────────────────────────────────────────

/** Minimum per-record score to be included in a suggestion group. */
export const PER_RECORD_MATCH_THRESHOLD = 15;

/** Signal weights (must sum to 100). */
export const SIGNAL_WEIGHTS = {
  exact_normalized:   40,
  vendor_match:       25,
  similarity:         15,
  recurring_monthly:  12,
  amount_consistency:  8,
} as const satisfies Record<string, number>;

/** History is classified into confidence bands. */
export const CONFIDENCE_BANDS = {
  HIGH:   80,   // ≥ 80 → high confidence historical match
  MEDIUM: 55,   // ≥ 55 → medium — present to reviewer
  LOW:    30,   // ≥ 30 → low — informational only
} as const;

/** Maximum approved history rows fetched per query (performance cap). */
const HISTORY_FETCH_LIMIT = 500;

/** Mutation statuses that MUST NOT contribute to history. */
const EXCLUDED_MUTATION_STATUSES = ['rejected', 'cancelled', 'corrected'] as const;

// ─── Types ────────────────────────────────────────────────────────────────────

export type SignalType = keyof typeof SIGNAL_WEIGHTS;

export interface HistoricalRecord {
  mutationId: number;
  /** Normalized description from bank_mutations.normalized_description (may be empty). */
  normalizedDescription: string;
  /** Raw description — used as fallback for vendor name extraction. */
  rawDescription: string;
  amount: number;
  direction: "IN" | "OUT";
  /** ISO date string YYYY-MM-DD */
  transactionDate: string;
  companyId: number | null;
  candidateType: string;
  candidateId: number;
  candidateSource: ReconciliationCandidateSource | null;
  /** Score recorded when the admin approved the match. */
  originalMatchScore: number;
  /** Counterparty/vendor name extracted at import time (may be null). */
  vendorName: string | null;
}

export interface HistoricalSignal {
  type: SignalType;
  matched: boolean;
  points: number;
  maxPoints: number;
  reason: string;
  /** How many historical records contributed to this signal. */
  sourceCount: number;
  /** Raw similarity ratio (0–1) for 'similarity' signal only. */
  similarityRatio?: number;
}

export interface HistoricalMatchSuggestion {
  candidateType: string;
  candidateId: number;
  candidateSource?: ReconciliationCandidateSource | null;
  /** Final confidence score 0–100. */
  confidence: number;
  confidenceBand: "high" | "medium" | "low" | "none";
  signals: HistoricalSignal[];
  reasons: string[];
  /** Number of approved history records that contributed to this suggestion. */
  sourceCount: number;
  /** ISO date of the most recent approved match for this candidate. */
  lastApprovedDate: string;
}

export interface HistoricalMatchResult {
  suggestions: HistoricalMatchSuggestion[];
  /** Total history records fetched and evaluated for this mutation. */
  historyCount: number;
  computedAt: string;
}

export interface HistoricalMutationInput {
  amount: number;
  direction: "IN" | "OUT";
  /** ISO date string YYYY-MM-DD */
  transactionDate: string;
  normalizedDescription?: string | null;
  rawDescription?: string | null;
  companyId: number | null;
}

// ─── Text normalization ───────────────────────────────────────────────────────

/**
 * Normalize a string for comparison: lowercase, strip non-alphanumeric, collapse spaces.
 * This is intentionally identical to normalizeForMatching in bankFormatParsers.ts but
 * kept local so the historical engine has zero external dependencies for pure functions.
 */
export function normalizeText(s: string): string {
  return s
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * Extract meaningful tokens (length ≥ 3) from a normalized string.
 */
export function tokenize(normalized: string): string[] {
  return normalized.split(/\s+/).filter(t => t.length >= 3);
}

/**
 * Jaccard similarity between two token sets: |A ∩ B| / |A ∪ B|.
 * Returns 0 if either set is empty.
 */
export function jaccardSimilarity(a: string[], b: string[]): number {
  if (!a.length || !b.length) return 0;
  const setA = new Set(a);
  const setB = new Set(b);
  let intersection = 0;
  for (const t of setB) {
    if (setA.has(t)) intersection++;
  }
  const union = setA.size + setB.size - intersection;
  return union === 0 ? 0 : intersection / union;
}

/**
 * Token overlap ratio: |A ∩ B| / max(|A|, |B|).
 * Used for vendor match (slightly looser than Jaccard).
 */
export function tokenOverlapRatio(a: string[], b: string[]): number {
  if (!a.length || !b.length) return 0;
  const setA = new Set(a);
  let overlap = 0;
  for (const t of b) {
    if (setA.has(t)) overlap++;
  }
  return overlap / Math.max(setA.size, b.length);
}

// ─── Per-record signal scorers (pure functions, no DB) ────────────────────────

/**
 * Signal 1: Exact normalized match.
 * Full 40 pts when the normalized descriptions are identical.
 */
export function scoreExactNormalized(
  mutationNorm: string,
  historyNorm: string,
): HistoricalSignal {
  const matched = mutationNorm.length > 0 && mutationNorm === historyNorm;
  return {
    type: "exact_normalized",
    matched,
    points: matched ? SIGNAL_WEIGHTS.exact_normalized : 0,
    maxPoints: SIGNAL_WEIGHTS.exact_normalized,
    reason: matched
      ? `deskripsi identik (${mutationNorm.slice(0, 40)})`
      : "deskripsi tidak identik",
    sourceCount: matched ? 1 : 0,
  };
}

/**
 * Signal 2: Vendor / counterparty match.
 * 25 pts when token overlap ≥ 0.4 between mutation description and vendor name.
 * Falls back to description-vs-description if vendorName is absent.
 */
export function scoreVendorMatch(
  mutationNorm: string,
  historyVendorName: string | null,
  historyNorm: string | null,
): HistoricalSignal {
  const mutTokens = tokenize(mutationNorm);
  const targetStr = historyVendorName
    ? normalizeText(historyVendorName)
    : historyNorm;
  const targetTokens = tokenize(targetStr ?? "");

  const ratio = tokenOverlapRatio(mutTokens, targetTokens);
  const matched = ratio >= 0.4;

  return {
    type: "vendor_match",
    matched,
    points: matched ? SIGNAL_WEIGHTS.vendor_match : 0,
    maxPoints: SIGNAL_WEIGHTS.vendor_match,
    reason: matched
      ? `nama vendor cocok (overlap ${Math.round(ratio * 100)}%)`
      : "nama vendor tidak cocok",
    sourceCount: matched ? 1 : 0,
    similarityRatio: ratio,
  };
}

/**
 * Signal 3: Jaccard similarity (scaled to 0–15 pts).
 * Activates when Jaccard ≥ 0.25; score is scaled linearly to max 15.
 */
export function scoreSimilarity(
  mutationNorm: string,
  historyNorm: string,
): HistoricalSignal {
  const mutTokens  = tokenize(mutationNorm);
  const histTokens = tokenize(historyNorm);
  const ratio = jaccardSimilarity(mutTokens, histTokens);

  const MIN_RATIO = 0.25;
  const matched = ratio >= MIN_RATIO;
  // Scale linearly: MIN_RATIO → 0 pts, 1.0 → 15 pts
  const scaled = matched
    ? Math.round(((ratio - MIN_RATIO) / (1 - MIN_RATIO)) * SIGNAL_WEIGHTS.similarity)
    : 0;

  return {
    type: "similarity",
    matched,
    points: Math.min(scaled, SIGNAL_WEIGHTS.similarity),
    maxPoints: SIGNAL_WEIGHTS.similarity,
    reason: matched
      ? `kemiripan deskripsi ${Math.round(ratio * 100)}%`
      : `kemiripan terlalu rendah (${Math.round(ratio * 100)}%)`,
    sourceCount: matched ? 1 : 0,
    similarityRatio: ratio,
  };
}

// ─── Group-level signal scorers ───────────────────────────────────────────────

/**
 * Signal 4: Recurring monthly pattern.
 * 12 pts when the same amount appears on a similar day-of-month (±5 days)
 * across ≥ 2 distinct calendar months.
 *
 * @param mutationDate - the new mutation's date (YYYY-MM-DD)
 * @param mutationAmount - the new mutation's amount
 * @param groupRecords - approved history records for one (candidateType, candidateId)
 */
export function scoreRecurringMonthly(
  mutationDate: string,
  mutationAmount: number,
  groupRecords: HistoricalRecord[],
): HistoricalSignal {
  const mutDay = new Date(mutationDate).getDate();
  if (isNaN(mutDay)) {
    return {
      type: "recurring_monthly",
      matched: false,
      points: 0,
      maxPoints: SIGNAL_WEIGHTS.recurring_monthly,
      reason: "tanggal mutasi tidak valid",
      sourceCount: 0,
    };
  }

  // Find records with same amount and day-of-month within ±5 days
  const matchingMonths = new Set<string>();
  for (const r of groupRecords) {
    const rDate = new Date(r.transactionDate);
    if (isNaN(rDate.getTime())) continue;
    const amountMatch = Math.abs(r.amount - mutationAmount) < 0.01;
    const dayDiff = Math.abs(rDate.getDate() - mutDay);
    // Wrap-around: e.g. day 1 vs day 28 in February → min diff = 3
    const dayDiffWrapped = Math.min(dayDiff, 30 - dayDiff);
    if (amountMatch && dayDiffWrapped <= 5) {
      matchingMonths.add(`${rDate.getFullYear()}-${String(rDate.getMonth() + 1).padStart(2, "0")}`);
    }
  }

  const count = matchingMonths.size;
  const matched = count >= 2;

  return {
    type: "recurring_monthly",
    matched,
    points: matched ? SIGNAL_WEIGHTS.recurring_monthly : 0,
    maxPoints: SIGNAL_WEIGHTS.recurring_monthly,
    reason: matched
      ? `pola bulanan terdeteksi (${count} bulan berulang, hari ~${mutDay})`
      : count === 1
        ? "baru 1 bulan — belum cukup untuk pola berulang"
        : "tidak ada pola berulang bulanan",
    sourceCount: count,
  };
}

/**
 * Signal 5: Amount consistency.
 * 8 pts when the same amount has been approved ≥ 2 times for this candidate.
 * Signals that this specific amount is a known, recurring value for this record.
 */
export function scoreAmountConsistency(
  mutationAmount: number,
  groupRecords: HistoricalRecord[],
): HistoricalSignal {
  const count = groupRecords.filter(
    r => Math.abs(r.amount - mutationAmount) < 0.01,
  ).length;

  const matched = count >= 2;

  return {
    type: "amount_consistency",
    matched,
    points: matched ? SIGNAL_WEIGHTS.amount_consistency : 0,
    maxPoints: SIGNAL_WEIGHTS.amount_consistency,
    reason: matched
      ? `nominal yang sama disetujui ${count}× untuk kandidat ini`
      : count === 1
        ? "nominal cocok 1× — belum konsisten"
        : "nominal tidak pernah disetujui untuk kandidat ini",
    sourceCount: count,
  };
}

// ─── Confidence band classifier ───────────────────────────────────────────────

export function classifyConfidenceBand(score: number): "high" | "medium" | "low" | "none" {
  if (score >= CONFIDENCE_BANDS.HIGH)   return "high";
  if (score >= CONFIDENCE_BANDS.MEDIUM) return "medium";
  if (score >= CONFIDENCE_BANDS.LOW)    return "low";
  return "none";
}

// ─── Suggestion builder ───────────────────────────────────────────────────────

/**
 * Build a HistoricalMatchSuggestion for one (candidateType, candidateId) group.
 * Combines per-record signals (best across group) with group-level signals.
 */
export function buildSuggestion(
  candidateType: string,
  candidateId: number,
  mutationNorm: string,
  mutationDate: string,
  mutationAmount: number,
  groupRecords: HistoricalRecord[],
  candidateSource: ReconciliationCandidateSource | null = null,
): HistoricalMatchSuggestion {
  if (!groupRecords.length) {
    throw new Error("buildSuggestion called with empty group");
  }

  // ── Per-record: pick the best score across all group records ──
  let bestExact   = { matched: false, points: 0, maxPoints: SIGNAL_WEIGHTS.exact_normalized, reason: "deskripsi tidak identik", sourceCount: 0 } as HistoricalSignal;
  let bestVendor  = { matched: false, points: 0, maxPoints: SIGNAL_WEIGHTS.vendor_match,     reason: "nama vendor tidak cocok",  sourceCount: 0 } as HistoricalSignal;
  let bestSimilar = { matched: false, points: 0, maxPoints: SIGNAL_WEIGHTS.similarity,       reason: "kemiripan terlalu rendah (0%)", sourceCount: 0 } as HistoricalSignal;

  let exactSources = 0;
  let vendorSources = 0;
  let similarSources = 0;

  for (const r of groupRecords) {
    const exact  = scoreExactNormalized(mutationNorm, r.normalizedDescription);
    const vendor = scoreVendorMatch(mutationNorm, r.vendorName, r.normalizedDescription);
    const sim    = scoreSimilarity(mutationNorm, r.normalizedDescription);

    if (exact.points  > bestExact.points)   { bestExact   = exact;  }
    if (vendor.points > bestVendor.points)  { bestVendor  = vendor; }
    if (sim.points    > bestSimilar.points) { bestSimilar = sim;    }

    if (exact.matched)  exactSources++;
    if (vendor.matched) vendorSources++;
    if (sim.matched)    similarSources++;
  }

  bestExact   = { ...bestExact,   sourceCount: exactSources };
  bestVendor  = { ...bestVendor,  sourceCount: vendorSources };
  bestSimilar = { ...bestSimilar, sourceCount: similarSources };

  // ── Group-level signals ──────────────────────────────────────
  const recurring = scoreRecurringMonthly(mutationDate, mutationAmount, groupRecords);
  const amtConsist = scoreAmountConsistency(mutationAmount, groupRecords);

  const signals: HistoricalSignal[] = [
    bestExact,
    bestVendor,
    bestSimilar,
    recurring,
    amtConsist,
  ];

  const totalPoints = signals.reduce((acc, s) => acc + s.points, 0);
  const confidence = Math.min(100, Math.round(totalPoints));
  const confidenceBand = classifyConfidenceBand(confidence);

  const reasons = signals.filter(s => s.matched).map(s => s.reason);
  if (!reasons.length) reasons.push("pola historis lemah — tidak ada sinyal kuat");

  const latestDate = groupRecords
    .map(r => r.transactionDate)
    .filter(d => d && d.length > 0)
    .sort()
    .reverse()[0] ?? "";

  return {
    candidateType,
    candidateId,
    candidateSource,
    confidence,
    confidenceBand,
    signals,
    reasons,
    sourceCount: groupRecords.length,
    lastApprovedDate: latestDate,
  };
}

// ─── DB fetch ─────────────────────────────────────────────────────────────────

/**
 * Fetch approved history for a given company and direction.
 * Excludes mutations with status 'rejected', 'cancelled', or 'corrected'.
 * Returns empty array if companyId is null (no history without company context).
 */
export async function fetchApprovedHistory(
  companyId: number | null,
  direction: "IN" | "OUT",
): Promise<HistoricalRecord[]> {
  // Company isolation: refuse to query cross-company history
  if (companyId === null) {
    logger.warn("[historicalMatchingEngine] fetchApprovedHistory: companyId is null — returning empty history");
    return [];
  }

  const excludedStatuses = EXCLUDED_MUTATION_STATUSES.map(s => `'${s}'`).join(", ");

  try {
    const { rows } = await db.execute(sql.raw(`
      SELECT
        brm.mutation_id,
        COALESCE(bm.normalized_description, '') AS normalized_description,
        COALESCE(bm.description, '')             AS raw_description,
        bm.amount::numeric                       AS amount,
        bm.direction,
        bm.transaction_date::date::text          AS transaction_date,
        bm.company_id,
        brm.candidate_type,
        brm.candidate_id::int                    AS candidate_id,
        brm.candidate_source,
        brm.match_score::numeric                 AS original_match_score,
        bm.provider_name                         AS vendor_name
      FROM bank_reconciliation_matches brm
      JOIN bank_mutations bm ON bm.id = brm.mutation_id
      WHERE brm.status = 'approved'
        AND bm.status NOT IN (${excludedStatuses})
        AND bm.company_id = ${Number(companyId)}
        AND bm.direction = '${direction === "IN" ? "IN" : "OUT"}'
      ORDER BY bm.transaction_date DESC
      LIMIT ${HISTORY_FETCH_LIMIT}
    `));

    return (rows as any[]).map(r => ({
      mutationId:          Number(r.mutation_id),
      normalizedDescription: String(r.normalized_description ?? ""),
      rawDescription:      String(r.raw_description ?? ""),
      amount:              Number(r.amount),
      direction:           (r.direction === "IN" ? "IN" : "OUT") as "IN" | "OUT",
      transactionDate:     String(r.transaction_date ?? ""),
      companyId:           r.company_id != null ? Number(r.company_id) : null,
      candidateType:       String(r.candidate_type ?? ""),
      candidateId:         Number(r.candidate_id),
      candidateSource:     r.candidate_source != null ? String(r.candidate_source) as ReconciliationCandidateSource : null,
      originalMatchScore:  Number(r.original_match_score ?? 0),
      vendorName:          r.vendor_name != null ? String(r.vendor_name) : null,
    }));
  } catch (e: any) {
    logger.warn({ err: e.message, companyId, direction }, "[historicalMatchingEngine] fetchApprovedHistory failed — returning empty history");
    return [];
  }
}

// ─── Main orchestrator ────────────────────────────────────────────────────────

/**
 * runHistoricalMatching — primary entry point for Phase 4.
 *
 * 1. Fetches approved history for the same company + direction.
 * 2. Scores each history record against the new mutation.
 * 3. Groups by (candidateType, candidateId).
 * 4. Builds a confidence score per group using all 5 signals.
 * 5. Returns suggestions sorted by confidence, descending.
 *
 * Does NOT create journals, expenses, or call any AI service.
 */
export async function runHistoricalMatching(
  mutation: HistoricalMutationInput,
): Promise<HistoricalMatchResult> {
  const computedAt = new Date().toISOString();
  const { amount, direction, transactionDate, companyId } = mutation;

  const mutationNorm = normalizeText(
    mutation.normalizedDescription ?? mutation.rawDescription ?? "",
  );

  // ── 1. Fetch approved history ─────────────────────────────────────────────
  const history = await fetchApprovedHistory(companyId, direction);

  if (!history.length) {
    logger.debug({ companyId, direction }, "[historicalMatchingEngine] no approved history found");
    return { suggestions: [], historyCount: 0, computedAt };
  }

  // ── 2. Per-record pre-filter: compute individual record score ─────────────
  //    Only records that score ≥ PER_RECORD_MATCH_THRESHOLD proceed to grouping.
  //    This avoids polluting groups with completely unrelated records.
  const qualifying: HistoricalRecord[] = [];
  for (const r of history) {
    const histNorm = r.normalizedDescription;
    const exact  = scoreExactNormalized(mutationNorm, histNorm);
    const vendor = scoreVendorMatch(mutationNorm, r.vendorName, histNorm);
    const sim    = scoreSimilarity(mutationNorm, histNorm);
    const perRecordScore = exact.points + vendor.points + sim.points;
    if (perRecordScore >= PER_RECORD_MATCH_THRESHOLD) {
      qualifying.push(r);
    }
  }

  // ── 3. Group by (candidateType, candidateId) ──────────────────────────────
  const groups = new Map<string, HistoricalRecord[]>();
  for (const r of qualifying) {
    const key = `${r.candidateType}:${r.candidateId}:${r.candidateSource ?? "<historical-null>"}`;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key)!.push(r);
  }

  // ── 4. Build suggestions ──────────────────────────────────────────────────
  const suggestions: HistoricalMatchSuggestion[] = [];

  for (const [, groupRecords] of groups) {
    const { candidateType, candidateId, candidateSource } = groupRecords[0];
    try {
      const suggestion = buildSuggestion(
        candidateType,
        candidateId,
        mutationNorm,
        transactionDate,
        amount,
        groupRecords,
        candidateSource,
      );
      // Only surface suggestions with at least some confidence
      if (suggestion.confidence >= CONFIDENCE_BANDS.LOW) {
        suggestions.push(suggestion);
      }
    } catch (e: any) {
      logger.warn(
        { err: e.message, candidateType, candidateId },
        "[historicalMatchingEngine] buildSuggestion error — skipping group",
      );
    }
  }

  // ── 5. Sort by confidence descending, limit to top 10 ────────────────────
  suggestions.sort((a, b) => b.confidence - a.confidence);
  const top = suggestions.slice(0, 10);

  logger.info(
    {
      companyId,
      direction,
      historyCount: history.length,
      qualifyingCount: qualifying.length,
      groupCount: groups.size,
      suggestionCount: top.length,
      topConfidence: top[0]?.confidence ?? null,
    },
    "[historicalMatchingEngine] matching complete",
  );

  return { suggestions: top, historyCount: history.length, computedAt };
}
