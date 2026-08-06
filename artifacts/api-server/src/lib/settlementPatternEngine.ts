/**
 * Settlement Pattern Engine
 *
 * Pure function module: loads patterns from DB and matches bank mutation
 * descriptions against configurable settlement patterns.
 *
 * GUARDRAILS (strictly enforced):
 *   - Does NOT modify journals, accounting entries, or COA.
 *   - Does NOT auto-post or auto-approve anything.
 *   - Does NOT modify Accounting Engine, Universal Journal Reuse Engine,
 *     COA Governance, AI Governance, Posting Journal, or General Ledger.
 *   - This engine is ADVISOR ONLY — results are recommendations, not actions.
 *
 * Match strategies:
 *   ONE_TO_ONE       — one bank mutation ↔ one booking/invoice
 *   ONE_TO_MANY      — one settlement covers multiple transactions
 *   MANY_TO_ONE      — multiple bank mutations settle one transaction
 *   BATCH_SETTLEMENT — batch of bookings netted to one settlement (QRIS default)
 *
 * Confidence scoring:
 *   keyword match strength  0–50 pts
 *   provider detection      +20 pts
 *   merchant detection      +20 pts
 *   multi-keyword bonus     up to +10 pts
 *   ─────────────────────────────────
 *   max                     100 pts → expressed as 0.00–1.00
 */

import { db } from "@workspace/db";
import { sql } from "drizzle-orm";
import { logger } from "./logger.js";

// ─── Types ────────────────────────────────────────────────────────────────────

export type MatchMode = "contains" | "starts_with" | "ends_with" | "equals" | "regex";
export type MatchStrategy = "ONE_TO_ONE" | "ONE_TO_MANY" | "MANY_TO_ONE" | "BATCH_SETTLEMENT";
export type PatternStatus = "active" | "inactive";

export interface SettlementPattern {
  id: number;
  companyId: number | null;
  code: string;
  name: string;
  provider: string;
  patternType: string;
  matchStrategy: MatchStrategy;
  priority: number;
  status: PatternStatus;
  merchantName: string | null;
  merchantId: string | null;
  terminalId: string | null;
  bankName: string | null;
  accountNumber: string | null;
  currency: string;
  settlementDelayDays: number;
  grossMatching: boolean;
  feeMatching: boolean;
  feeAccountId: number | null;
  confidenceThreshold: number;
  keywords: PatternKeyword[];
}

export interface PatternKeyword {
  id: number;
  patternId: number;
  keyword: string;
  matchMode: MatchMode;
  priority: number;
}

export interface SettlementMatchResult {
  matched: boolean;
  pattern: SettlementPattern | null;
  confidence: number;           // 0.00 – 1.00
  matchedKeywords: string[];
  provider: string | null;
  matchStrategy: MatchStrategy | null;
  settlementDelayDays: number | null;
  grossMatching: boolean | null;
  feeMatching: boolean | null;
  feeAccountId: number | null;
  debugInfo: Record<string, unknown>;
}

// ─── In-memory cache (TTL 60 s) ──────────────────────────────────────────────

interface CacheEntry {
  patterns: SettlementPattern[];
  expiresAt: number;
}

const cache = new Map<string, CacheEntry>();
const CACHE_TTL_MS = 60_000;

function getCacheKey(companyId?: number | null): string {
  return companyId != null ? `company:${companyId}` : "global";
}

export function invalidatePatternCache(companyId?: number | null): void {
  cache.delete(getCacheKey(companyId));
  cache.delete("global");
}

// ─── Load patterns from DB ───────────────────────────────────────────────────

export async function loadPatterns(companyId?: number | null): Promise<SettlementPattern[]> {
  const key = getCacheKey(companyId);
  const cached = cache.get(key);
  if (cached && cached.expiresAt > Date.now()) return cached.patterns;

  try {
    // Load patterns — company-specific + global seed patterns
    const patternRows = await db.execute<{
      id: number; company_id: number | null; code: string; name: string;
      provider: string; pattern_type: string; match_strategy: string;
      priority: number; status: string; merchant_name: string | null;
      merchant_id: string | null; terminal_id: string | null;
      bank_name: string | null; account_number: string | null;
      currency: string; settlement_delay_days: number;
      gross_matching: boolean; fee_matching: boolean;
      fee_account_id: number | null; confidence_threshold: string;
    }>(sql`
      SELECT * FROM recon_settlement_patterns
      WHERE status = 'active'
        AND (
          company_id IS NULL
          OR ${companyId != null ? sql`company_id = ${companyId}` : sql`FALSE`}
        )
      ORDER BY priority ASC, id ASC
    `);

    const patternIds = patternRows.rows.map(r => r.id);

    let keywordRows: Array<{
      id: number; pattern_id: number; keyword: string;
      match_mode: string; priority: number;
    }> = [];

    if (patternIds.length > 0) {
      const kwResult = await db.execute<{
        id: number; pattern_id: number; keyword: string;
        match_mode: string; priority: number;
      }>(sql`
        SELECT * FROM recon_settlement_pattern_keywords
        WHERE pattern_id = ANY(${`{${patternIds.join(",")}}`}::int[])
        ORDER BY pattern_id, priority ASC, id ASC
      `);
      keywordRows = kwResult.rows;
    }

    // Group keywords by pattern_id
    const kwByPattern = new Map<number, PatternKeyword[]>();
    for (const kw of keywordRows) {
      const arr = kwByPattern.get(kw.pattern_id) ?? [];
      arr.push({
        id: kw.id,
        patternId: kw.pattern_id,
        keyword: kw.keyword,
        matchMode: kw.match_mode as MatchMode,
        priority: kw.priority,
      });
      kwByPattern.set(kw.pattern_id, arr);
    }

    const patterns: SettlementPattern[] = patternRows.rows.map(r => ({
      id: r.id,
      companyId: r.company_id,
      code: r.code,
      name: r.name,
      provider: r.provider,
      patternType: r.pattern_type,
      matchStrategy: r.match_strategy as MatchStrategy,
      priority: r.priority,
      status: r.status as PatternStatus,
      merchantName: r.merchant_name,
      merchantId: r.merchant_id,
      terminalId: r.terminal_id,
      bankName: r.bank_name,
      accountNumber: r.account_number,
      currency: r.currency,
      settlementDelayDays: r.settlement_delay_days,
      grossMatching: r.gross_matching,
      feeMatching: r.fee_matching,
      feeAccountId: r.fee_account_id,
      confidenceThreshold: parseFloat(r.confidence_threshold as unknown as string) || 0.80,
      keywords: kwByPattern.get(r.id) ?? [],
    }));

    cache.set(key, { patterns, expiresAt: Date.now() + CACHE_TTL_MS });
    return patterns;
  } catch (err) {
    logger.error({ err }, "[settlementPatternEngine] Failed to load patterns");
    return [];
  }
}

// ─── Keyword matching ─────────────────────────────────────────────────────────

function testKeyword(description: string, kw: PatternKeyword): boolean {
  const desc = description.toLowerCase();
  const kwLower = kw.keyword.toLowerCase();

  switch (kw.matchMode) {
    case "contains":    return desc.includes(kwLower);
    case "starts_with": return desc.startsWith(kwLower);
    case "ends_with":   return desc.endsWith(kwLower);
    case "equals":      return desc === kwLower;
    case "regex": {
      try {
        return new RegExp(kw.keyword, "i").test(description);
      } catch {
        return false;
      }
    }
    default:            return desc.includes(kwLower);
  }
}

function keywordScore(kw: PatternKeyword): number {
  switch (kw.matchMode) {
    case "equals":      return 85;
    case "regex":       return 90;
    case "starts_with": return 75;
    case "ends_with":   return 70;
    case "contains":    return 60;
    default:            return 40;
  }
}

// ─── Match one pattern ────────────────────────────────────────────────────────

interface PatternScore {
  pattern: SettlementPattern;
  confidence: number;
  matchedKeywords: string[];
}

function scorePattern(
  description: string,
  pattern: SettlementPattern,
): PatternScore | null {
  if (!pattern.keywords.length) return null;

  const matched: PatternKeyword[] = [];
  for (const kw of pattern.keywords) {
    if (testKeyword(description, kw)) {
      matched.push(kw);
    }
  }

  if (matched.length === 0) return null;

  // Base score: highest keyword score
  const sortedByScore = [...matched].sort((a, b) => keywordScore(b) - keywordScore(a));
  let score = keywordScore(sortedByScore[0]);

  // Provider bonus: +15 if provider name appears in description
  const descLower = description.toLowerCase();
  if (pattern.provider && descLower.includes(pattern.provider.toLowerCase())) {
    score += 15;
  }

  // Merchant bonus: +15 if merchant name or ID matches
  if (pattern.merchantName && descLower.includes(pattern.merchantName.toLowerCase())) {
    score += 15;
  } else if (pattern.merchantId && descLower.includes(pattern.merchantId.toLowerCase())) {
    score += 15;
  }

  // Multi-keyword bonus: +10 per extra keyword match (max +20)
  const extraKeywords = matched.length - 1;
  score += Math.min(extraKeywords * 10, 20);

  // Clamp to 100
  score = Math.min(score, 100);

  return {
    pattern,
    confidence: score / 100,
    matchedKeywords: matched.map(k => k.keyword),
  };
}

// ─── Main match function ──────────────────────────────────────────────────────

export async function matchSettlementPattern(
  description: string,
  companyId?: number | null,
): Promise<SettlementMatchResult> {
  const patterns = await loadPatterns(companyId);

  const scored: PatternScore[] = [];

  for (const pattern of patterns) {
    const result = scorePattern(description, pattern);
    if (result) scored.push(result);
  }

  if (scored.length === 0) {
    return {
      matched: false,
      pattern: null,
      confidence: 0,
      matchedKeywords: [],
      provider: null,
      matchStrategy: null,
      settlementDelayDays: null,
      grossMatching: null,
      feeMatching: null,
      feeAccountId: null,
      debugInfo: { candidatesChecked: patterns.length, reason: "no_keyword_match" },
    };
  }

  // Sort by confidence DESC, then priority ASC
  scored.sort((a, b) => {
    if (b.confidence !== a.confidence) return b.confidence - a.confidence;
    return a.pattern.priority - b.pattern.priority;
  });

  const best = scored[0];

  // Check confidence threshold
  if (best.confidence < best.pattern.confidenceThreshold) {
    return {
      matched: false,
      pattern: best.pattern,
      confidence: best.confidence,
      matchedKeywords: best.matchedKeywords,
      provider: best.pattern.provider,
      matchStrategy: best.pattern.matchStrategy,
      settlementDelayDays: best.pattern.settlementDelayDays,
      grossMatching: best.pattern.grossMatching,
      feeMatching: best.pattern.feeMatching,
      feeAccountId: best.pattern.feeAccountId,
      debugInfo: {
        candidatesChecked: patterns.length,
        reason: "below_threshold",
        threshold: best.pattern.confidenceThreshold,
        score: best.confidence,
      },
    };
  }

  // Increment usage counter (fire-and-forget)
  db.execute(sql`
    UPDATE recon_settlement_patterns
    SET usage_count = usage_count + 1, updated_at = NOW()
    WHERE id = ${best.pattern.id}
  `).catch(() => {});

  return {
    matched: true,
    pattern: best.pattern,
    confidence: best.confidence,
    matchedKeywords: best.matchedKeywords,
    provider: best.pattern.provider,
    matchStrategy: best.pattern.matchStrategy,
    settlementDelayDays: best.pattern.settlementDelayDays,
    grossMatching: best.pattern.grossMatching,
    feeMatching: best.pattern.feeMatching,
    feeAccountId: best.pattern.feeAccountId,
    debugInfo: {
      candidatesChecked: patterns.length,
      allScored: scored.map(s => ({ name: s.pattern.name, confidence: s.confidence })),
    },
  };
}

/**
 * Batch match: run matchSettlementPattern for multiple descriptions.
 * Does not modify any accounting data — read-only advisory function.
 */
export async function batchMatchSettlementPatterns(
  items: Array<{ description: string; amount?: number; ref?: string }>,
  companyId?: number | null,
): Promise<Array<SettlementMatchResult & { input: (typeof items)[0] }>> {
  const patterns = await loadPatterns(companyId);

  return items.map(item => {
    const scored: PatternScore[] = [];
    for (const pattern of patterns) {
      const result = scorePattern(item.description, pattern);
      if (result) scored.push(result);
    }

    if (!scored.length) {
      return {
        input: item,
        matched: false,
        pattern: null,
        confidence: 0,
        matchedKeywords: [],
        provider: null,
        matchStrategy: null,
        settlementDelayDays: null,
        grossMatching: null,
        feeMatching: null,
        feeAccountId: null,
        debugInfo: { reason: "no_keyword_match" },
      };
    }

    scored.sort((a, b) => {
      if (b.confidence !== a.confidence) return b.confidence - a.confidence;
      return a.pattern.priority - b.pattern.priority;
    });

    const best = scored[0];
    const isAboveThreshold = best.confidence >= best.pattern.confidenceThreshold;

    return {
      input: item,
      matched: isAboveThreshold,
      pattern: best.pattern,
      confidence: best.confidence,
      matchedKeywords: best.matchedKeywords,
      provider: best.pattern.provider,
      matchStrategy: best.pattern.matchStrategy,
      settlementDelayDays: best.pattern.settlementDelayDays,
      grossMatching: best.pattern.grossMatching,
      feeMatching: best.pattern.feeMatching,
      feeAccountId: best.pattern.feeAccountId,
      debugInfo: {
        reason: isAboveThreshold ? "matched" : "below_threshold",
        threshold: best.pattern.confidenceThreshold,
      },
    };
  });
}

/**
 * Batch fee calculation helper.
 * Gross = Net + Fee (economic event matching — not revenue/PPN/journal-line based).
 * Returns null if inputs are incomplete.
 */
export function calculateSettlementAmounts(params: {
  grossAmount?: number;
  netAmount?: number;
  feeAmount?: number;
}): { gross: number; net: number; fee: number } | null {
  const { grossAmount, netAmount, feeAmount } = params;

  if (grossAmount != null && feeAmount != null) {
    return { gross: grossAmount, fee: feeAmount, net: grossAmount - feeAmount };
  }
  if (netAmount != null && feeAmount != null) {
    return { gross: netAmount + feeAmount, fee: feeAmount, net: netAmount };
  }
  if (grossAmount != null && netAmount != null) {
    return { gross: grossAmount, net: netAmount, fee: grossAmount - netAmount };
  }
  return null;
}
