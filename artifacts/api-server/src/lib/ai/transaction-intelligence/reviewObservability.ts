/**
 * AI Transaction Intelligence — Phase 8
 * Review Observability Metrics
 *
 * Pure aggregation of review case metrics.
 * No database, no network calls.
 */

import type {
  AIReviewCase,
  ReviewObservabilityReport,
  TopCoaCorrection,
  TopConflictFlag,
} from './reviewOrchestrationTypes.js';

// ─── Helpers ──────────────────────────────────────────────────────────────────

function avg(values: number[]): number {
  if (values.length === 0) return 0;
  return values.reduce((s, v) => s + v, 0) / values.length;
}

function median(sorted: number[]): number {
  if (sorted.length === 0) return 0;
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 1
    ? sorted[mid]!
    : (sorted[mid - 1]! + sorted[mid]!) / 2;
}

function percentile(sorted: number[], p: number): number {
  if (sorted.length === 0) return 0;
  const idx = Math.ceil(sorted.length * p) - 1;
  return sorted[Math.max(0, Math.min(sorted.length - 1, idx))]!;
}

function countBy<T>(items: T[], key: (item: T) => string): Record<string, number> {
  const result: Record<string, number> = {};
  for (const item of items) {
    const k = key(item);
    result[k] = (result[k] ?? 0) + 1;
  }
  return result;
}

// ─── Review minutes ───────────────────────────────────────────────────────────

function extractReviewMinutes(reviewCase: AIReviewCase): number | null {
  if (!reviewCase.decision?.createdAt) return null;
  const created = new Date(reviewCase.createdAt).getTime();
  const decided = new Date(reviewCase.decision.createdAt).getTime();
  const minutes = (decided - created) / 60_000;
  return minutes > 0 ? minutes : null;
}

// ─── Main aggregator ──────────────────────────────────────────────────────────

/**
 * Compute observability metrics from an array of review cases.
 *
 * @param cases  Array of AIReviewCase (may be cross-company; caller responsible for filtering)
 * @returns      ReviewObservabilityReport — pure derived metrics
 */
export function calculateReviewObservability(cases: AIReviewCase[]): ReviewObservabilityReport {
  const total = cases.length;
  if (total === 0) {
    return emptyReport();
  }

  const decidedCases = cases.filter(c => c.decision != null);
  const decidedCount = decidedCases.length;

  // ── Distribution counts ────────────────────────────────────────────────────
  const byStatus = countBy(cases, c => c.status);
  const byQueue = countBy(cases, c => c.queue);
  const byPriority = countBy(cases, c => c.priority);
  const byIntent = countBy(cases, c => c.aiSnapshot.intent);
  const byRiskLevel = countBy(cases, c => c.aiSnapshot.anomalyRisk);

  // ── Decision rates ─────────────────────────────────────────────────────────
  const manualReviewCount = cases.filter(c => c.aiSnapshot.requiresManualReview).length;
  const approvedCount = decidedCases.filter(c => c.decision!.decision === 'APPROVE_RECOMMENDATION').length;
  const coaChangedCount = decidedCases.filter(c => c.decision!.decision === 'CHANGE_COA').length;
  const rejectedCount = decidedCases.filter(c => c.decision!.decision === 'REJECT_RECOMMENDATION').length;
  const escalatedCount = decidedCases.filter(c => c.decision!.decision === 'ESCALATE').length;

  const manualReviewRate = total > 0 ? manualReviewCount / total : 0;
  const aiApprovalRate = decidedCount > 0 ? approvedCount / decidedCount : 0;
  const coaChangeRate = decidedCount > 0 ? coaChangedCount / decidedCount : 0;
  const rejectionRate = decidedCount > 0 ? rejectedCount / decidedCount : 0;
  const escalationRate = decidedCount > 0 ? escalatedCount / decidedCount : 0;

  // ── Confidence averages ────────────────────────────────────────────────────
  const intentConfidences = cases.map(c => c.aiSnapshot.intentConfidence);
  const coaConfidences = cases
    .map(c => c.aiSnapshot.recommendedCoa?.confidence)
    .filter((v): v is number => v != null);
  const anomalyScores = cases.map(c => c.aiSnapshot.anomalyScore);

  const averageIntentConfidence = avg(intentConfidences);
  const averageCoaConfidence = avg(coaConfidences);
  const averageAnomalyScore = avg(anomalyScores);

  // ── Review time metrics ────────────────────────────────────────────────────
  const reviewMinutesList = cases
    .map(extractReviewMinutes)
    .filter((v): v is number => v != null)
    .sort((a, b) => a - b);

  const averageReviewMinutes = reviewMinutesList.length > 0 ? avg(reviewMinutesList) : undefined;
  const medianReviewMinutes = reviewMinutesList.length > 0 ? median(reviewMinutesList) : undefined;
  const p90ReviewMinutes = reviewMinutesList.length > 0 ? percentile(reviewMinutesList, 0.9) : undefined;

  // ── SLA metrics ────────────────────────────────────────────────────────────
  const openCaseCount = cases.filter(c => ['OPEN', 'QUEUED', 'ASSIGNED', 'IN_REVIEW', 'NEEDS_INFORMATION'].includes(c.status)).length;
  const overdueCaseCount = cases.filter(c => c.sla.isOverdue).length;
  const slaComplianceRate = total > 0 ? 1 - overdueCaseCount / total : 1;

  // ── Reviewer agreement ────────────────────────────────────────────────────
  const agreedDecisions = decidedCases.filter(c =>
    c.decision?.feedbackPayload?.agreement === true,
  ).length;
  const reviewerAgreementRate = decidedCount > 0 ? agreedDecisions / decidedCount : 0;

  // ── Top COA corrections ────────────────────────────────────────────────────
  const coaCorrectionMap = new Map<string, number>();
  for (const c of decidedCases) {
    if (c.decision?.decision === 'CHANGE_COA' && c.decision.selectedCoa) {
      const key = `${c.aiSnapshot.recommendedCoa?.coaCode ?? '?'}→${c.decision.selectedCoa.coaCode}`;
      coaCorrectionMap.set(key, (coaCorrectionMap.get(key) ?? 0) + 1);
    }
  }
  const topChangedCoa: TopCoaCorrection[] = [...coaCorrectionMap.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 10)
    .map(([key, count]) => {
      const [ai, reviewer] = key.split('→');
      return { aiCoaCode: ai, reviewerCoaCode: reviewer, count };
    });

  // ── Top conflict flags ─────────────────────────────────────────────────────
  const flagMap = new Map<string, number>();
  for (const c of cases) {
    for (const flag of c.flags) {
      flagMap.set(flag, (flagMap.get(flag) ?? 0) + 1);
    }
  }
  const topConflictFlags: TopConflictFlag[] = [...flagMap.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 10)
    .map(([flag, count]) => ({ flag, count }));

  return {
    totalCases: total,
    byStatus,
    byQueue,
    byPriority,
    byIntent,
    byRiskLevel,
    manualReviewRate,
    aiApprovalRate,
    coaChangeRate,
    rejectionRate,
    escalationRate,
    averageIntentConfidence,
    averageCoaConfidence,
    averageAnomalyScore,
    averageReviewMinutes,
    medianReviewMinutes,
    p90ReviewMinutes,
    openCaseCount,
    overdueCaseCount,
    slaComplianceRate,
    reviewerAgreementRate,
    topChangedCoa,
    topConflictFlags,
  };
}

function emptyReport(): ReviewObservabilityReport {
  return {
    totalCases: 0,
    byStatus: {},
    byQueue: {},
    byPriority: {},
    byIntent: {},
    byRiskLevel: {},
    manualReviewRate: 0,
    aiApprovalRate: 0,
    coaChangeRate: 0,
    rejectionRate: 0,
    escalationRate: 0,
    averageIntentConfidence: 0,
    averageCoaConfidence: 0,
    averageAnomalyScore: 0,
    openCaseCount: 0,
    overdueCaseCount: 0,
    slaComplianceRate: 1,
    reviewerAgreementRate: 0,
    topChangedCoa: [],
    topConflictFlags: [],
  };
}
