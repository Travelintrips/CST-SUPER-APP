/**
 * AI Transaction Intelligence — Phase 5
 * Learning Statistics
 *
 * Computes aggregated statistics across all feedback records.
 * Pure function — no DB, no side effects.
 */

import type {
  FeedbackRecord,
  LearningStatistics,
  ReviewerDecision,
} from './learningTypes.js';

import type { TransactionIntent } from './transactionTypes.js';

// ─── Helpers ───────────────────────────────────────────────────────────────────

function toMinutes(from: Date, to: Date): number {
  return (to.getTime() - from.getTime()) / 60_000;
}

function safeDate(v: string | Date | undefined): Date | null {
  if (!v) return null;
  const d = v instanceof Date ? v : new Date(v);
  return isNaN(d.getTime()) ? null : d;
}

// ─── Main export ───────────────────────────────────────────────────────────────

/**
 * Compute learning statistics from a collection of feedback records.
 *
 * @param allRecords - All feedback records (current + historical).
 */
export function computeLearningStatistics(allRecords: FeedbackRecord[]): LearningStatistics {
  if (allRecords.length === 0) {
    return {
      totalFeedback: 0,
      approvalRate: 0,
      manualReviewRate: 0,
      changeRate: 0,
      topCorrectedIntents: [],
      topCorrectedCoa: [],
      topAmbiguousPatterns: [],
      avgReviewTurnaroundMinutes: null,
      feedbackDistribution: {
        APPROVED: 0, CHANGED_COA: 0, REJECTED: 0, SKIPPED: 0, UNKNOWN: 0,
      },
      distinctReviewers: 0,
      distinctCompanies: 0,
    };
  }

  const totalFeedback = allRecords.length;

  // Decision distribution
  const feedbackDistribution: Record<ReviewerDecision, number> = {
    APPROVED: 0, CHANGED_COA: 0, REJECTED: 0, SKIPPED: 0, UNKNOWN: 0,
  };
  for (const r of allRecords) {
    feedbackDistribution[r.decision] = (feedbackDistribution[r.decision] ?? 0) + 1;
  }

  const actionable = allRecords.filter(
    r => r.decision !== 'SKIPPED' && r.decision !== 'UNKNOWN',
  );
  const approvalRate = actionable.length > 0
    ? feedbackDistribution.APPROVED / actionable.length
    : 0;
  const changeRate = actionable.length > 0
    ? feedbackDistribution.CHANGED_COA / actionable.length
    : 0;
  const manualReviewRate = actionable.length > 0
    ? (feedbackDistribution.CHANGED_COA + feedbackDistribution.REJECTED) / actionable.length
    : 0;

  // Top corrected intents
  type IntentStat = { correctionCount: number; totalCount: number };
  const intentStats = new Map<TransactionIntent, IntentStat>();

  for (const r of actionable) {
    const intent = r.aiRecommendedIntent as TransactionIntent | undefined;
    if (!intent) continue;

    const stat = intentStats.get(intent) ?? { correctionCount: 0, totalCount: 0 };
    stat.totalCount++;
    if (r.decision === 'CHANGED_COA' || r.decision === 'REJECTED') {
      stat.correctionCount++;
    }
    intentStats.set(intent, stat);
  }

  const topCorrectedIntents = [...intentStats.entries()]
    .filter(([, s]) => s.correctionCount > 0)
    .map(([intent, s]) => ({
      intent,
      correctionCount: s.correctionCount,
      totalCount: s.totalCount,
      correctionRate: s.correctionCount / s.totalCount,
    }))
    .sort((a, b) => b.correctionCount - a.correctionCount)
    .slice(0, 5);

  // Top corrected COA
  type CoaKey = string; // `${aiCoaCode}→${reviewerCoaCode}`
  const coaCorrectionCounts = new Map<CoaKey, number>();
  const coaCorrectionPairs = new Map<CoaKey, { aiCoaCode: string; reviewerCoaCode: string }>();

  for (const r of allRecords) {
    if (r.decision !== 'CHANGED_COA') continue;
    if (!r.aiRecommendedCoaCode || !r.selectedCoaCode) continue;
    const key: CoaKey = `${r.aiRecommendedCoaCode}→${r.selectedCoaCode}`;
    coaCorrectionCounts.set(key, (coaCorrectionCounts.get(key) ?? 0) + 1);
    coaCorrectionPairs.set(key, {
      aiCoaCode: r.aiRecommendedCoaCode,
      reviewerCoaCode: r.selectedCoaCode,
    });
  }

  const topCorrectedCoa = [...coaCorrectionCounts.entries()]
    .sort(([, a], [, b]) => b - a)
    .slice(0, 5)
    .map(([key, count]) => ({
      ...(coaCorrectionPairs.get(key)!),
      count,
    }));

  // Top ambiguous patterns
  type PatternStat = { manualReviewCount: number };
  const patternStats = new Map<string, PatternStat>();

  for (const r of allRecords) {
    const desc = r.normalizedDescription;
    if (!desc) continue;
    const stat = patternStats.get(desc) ?? { manualReviewCount: 0 };
    if (r.decision === 'CHANGED_COA' || r.decision === 'REJECTED') {
      stat.manualReviewCount++;
    }
    patternStats.set(desc, stat);
  }

  const topAmbiguousPatterns = [...patternStats.entries()]
    .filter(([, s]) => s.manualReviewCount > 0)
    .map(([normalizedDescription, s]) => ({
      normalizedDescription,
      manualReviewCount: s.manualReviewCount,
    }))
    .sort((a, b) => b.manualReviewCount - a.manualReviewCount)
    .slice(0, 5);

  // Average turnaround
  const turnarounds: number[] = [];
  for (const r of allRecords) {
    const reviewed = safeDate(r.reviewedAt);
    const presented = safeDate(r.presentedAt ?? undefined);
    if (reviewed && presented && reviewed > presented) {
      turnarounds.push(toMinutes(presented, reviewed));
    }
  }
  const avgReviewTurnaroundMinutes =
    turnarounds.length > 0
      ? turnarounds.reduce((a, b) => a + b, 0) / turnarounds.length
      : null;

  // Distinct reviewers & companies
  const distinctReviewers = new Set(allRecords.map(r => r.reviewerId)).size;
  const distinctCompanies = new Set(allRecords.map(r => String(r.companyId))).size;

  return {
    totalFeedback,
    approvalRate,
    manualReviewRate,
    changeRate,
    topCorrectedIntents,
    topCorrectedCoa,
    topAmbiguousPatterns,
    avgReviewTurnaroundMinutes,
    feedbackDistribution,
    distinctReviewers,
    distinctCompanies,
  };
}
