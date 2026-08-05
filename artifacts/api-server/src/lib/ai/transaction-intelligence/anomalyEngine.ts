/**
 * AI Transaction Intelligence — Phase 7
 * Anomaly Detection Engine — Main Orchestrator
 *
 * Coordinates all Phase 7 detectors:
 *   1. Amount Anomaly (AMOUNT_OUTLIER, ROUND_AMOUNT_PATTERN)
 *   2. Frequency Anomaly (FREQUENCY_SPIKE)
 *   3. Duplicate Detection (EXACT_DUPLICATE, NEAR_DUPLICATE, REFERENCE_REUSE)
 *   4. Counterparty Anomaly (NEW_COUNTERPARTY, UNUSUAL_COUNTERPARTY)
 *   5. Timing Anomaly (UNUSUAL_TRANSACTION_TIME, UNUSUAL_TRANSACTION_DAY)
 *   6. COA Anomaly (UNUSUAL_COA, COA_INTENT_MISMATCH)
 *   7. Split Transaction Detection (SPLIT_TRANSACTION)
 *   8. Cross-Company Detection (CROSS_COMPANY_PATTERN)
 *   9. Rapid Reversal Detection (RAPID_REVERSAL)
 *
 * INVARIANTS:
 *   - Engine NEVER modifies transactions, journals, or database.
 *   - All outputs are recommendations only.
 *   - Deterministic — time injected via input.evaluationTime or deps.now().
 *   - Company isolated — historical records filtered per companyId.
 *   - No mutation of input.
 *
 * Pure orchestration — no side effects except calling injected deps.
 */

import type {
  AnomalyDetectionInput,
  AnomalyDetectionResult,
  AnomalyDetectionDependencies,
  AnomalyDetection,
  CompanyAnomalyBaseline,
  HistoricalTransactionRecord,
} from './anomalyTypes.js';
import { mergePolicy } from './anomalyRules.js';
import { buildAnomalyBaseline, computeBaselineQuality } from './anomalyBaseline.js';
import {
  combineScores,
  scoreToRiskLevel,
  computeDetectionConfidence,
  aggregateAnomalyTypes,
} from './anomalyScoring.js';
import { buildRecommendation, computeRequiresManualReview } from './anomalyRecommendation.js';
import { buildExplanations, buildConflictFlags, buildRapidReversalDetection } from './anomalyExplanation.js';
import { detectAmountAnomaly, detectRoundAmountPattern } from './amountAnomalyDetector.js';
import { detectFrequencyAnomaly } from './frequencyAnomalyDetector.js';
import { detectDuplicateAnomaly } from './duplicateAnomalyDetector.js';
import { detectCounterpartyAnomaly } from './counterpartyAnomalyDetector.js';
import { detectTimingAnomaly } from './timingAnomalyDetector.js';
import { detectCoaAnomaly } from './coaAnomalyDetector.js';
import { detectSplitTransaction } from './splitTransactionDetector.js';
import { detectCrossCompanyAnomaly } from './crossCompanyAnomalyDetector.js';

// ─── Public re-exports ────────────────────────────────────────────────────────

export { buildAnomalyBaseline } from './anomalyBaseline.js';
export { computeBaselineQuality } from './anomalyBaseline.js';

// ─── Internal evaluation ──────────────────────────────────────────────────────

async function resolveContext(
  input: AnomalyDetectionInput,
  deps: AnomalyDetectionDependencies,
): Promise<{
  historical: HistoricalTransactionRecord[];
  baseline: CompanyAnomalyBaseline | null;
  now: Date;
  approvalThresholds: number[];
}> {
  const policy = mergePolicy(input.policy);

  // Time — always injected, never Date.now()
  const now = input.evaluationTime
    ? (input.evaluationTime instanceof Date ? input.evaluationTime : new Date(input.evaluationTime))
    : (deps.now ? deps.now() : new Date(0));

  // Historical transactions
  let historical: HistoricalTransactionRecord[] = input.historicalTransactions ?? [];
  if (historical.length === 0 && deps.getHistoricalTransactions) {
    historical = await deps.getHistoricalTransactions(input);
  }

  // Company baseline
  let baseline: CompanyAnomalyBaseline | null = input.companyBaseline ?? null;
  if (!baseline && deps.getCompanyBaseline) {
    baseline = await deps.getCompanyBaseline(input.companyId);
  }
  if (!baseline && historical.length >= policy.minimumHistoricalSample) {
    baseline = buildAnomalyBaseline(
      historical,
      input.companyId,
      now.toISOString(),
    );
  }

  // Approval thresholds
  let approvalThresholds: number[] = policy.approvalThresholds ?? [];
  if (approvalThresholds.length === 0 && deps.getApprovalThresholds) {
    approvalThresholds = await deps.getApprovalThresholds(input.companyId);
  }

  return { historical, baseline, now, approvalThresholds };
}

// ─── Detector runner ──────────────────────────────────────────────────────────

function runDetectors(
  input: AnomalyDetectionInput,
  historical: HistoricalTransactionRecord[],
  baseline: CompanyAnomalyBaseline | null,
  now: Date,
  approvalThresholds: number[],
): AnomalyDetection[] {
  const policy = mergePolicy(input.policy);
  const enabledDetectors = policy.enabledDetectors;
  const tx = input.transaction;

  // Same-company historical only
  const sameCompanyHistorical = historical.filter(
    h => String(h.companyId) === String(input.companyId),
  );

  const detections: AnomalyDetection[] = [];

  // 1. Amount anomaly
  if (enabledDetectors.amount !== false) {
    const intent = input.phase2Classification?.primaryIntent ?? input.phase1Analysis?.intent;
    detections.push(
      detectAmountAnomaly({
        amount: tx.amount,
        currency: tx.currency,
        counterpartyName: tx.counterpartyName,
        intent: intent as string | undefined,
        coaCode: tx.coaCode,
        historical: sameCompanyHistorical,
        baseline: baseline ?? undefined,
        policy: input.policy,
      }),
    );
    // Round amount pattern (standalone, low score)
    detections.push(detectRoundAmountPattern({ amount: tx.amount }));
  }

  // 2. Frequency anomaly
  if (enabledDetectors.frequency !== false) {
    detections.push(
      detectFrequencyAnomaly({
        transactionDate: tx.transactionDate,
        counterpartyName: tx.counterpartyName,
        amount: tx.amount,
        historical: sameCompanyHistorical,
        baseline: baseline ?? undefined,
        policy: input.policy,
        now,
      }),
    );
  }

  // 3. Duplicate detection
  if (enabledDetectors.duplicate !== false) {
    const dupResult = detectDuplicateAnomaly({
      transactionId: tx.id,
      amount: tx.amount,
      direction: tx.direction,
      transactionDate: tx.transactionDate,
      referenceNumber: tx.referenceNumber,
      counterpartyName: tx.counterpartyName,
      counterpartyAccount: tx.counterpartyAccount,
      bankAccountId: tx.bankAccountId,
      description: tx.description,
      normalizedDescription: tx.normalizedDescription,
      companyId: input.companyId,
      historical: sameCompanyHistorical,
      policy: input.policy,
    });
    detections.push(dupResult.exactDuplicate, dupResult.nearDuplicate, dupResult.referenceReuse);
  }

  // 4. Counterparty anomaly
  if (enabledDetectors.counterparty !== false) {
    const intent = input.phase2Classification?.primaryIntent ?? input.phase1Analysis?.intent;
    const cpDetections = detectCounterpartyAnomaly({
      counterpartyName: tx.counterpartyName,
      counterpartyAccount: tx.counterpartyAccount,
      intent: intent as string | undefined,
      coaCode: tx.coaCode,
      companyId: input.companyId,
      historical: sameCompanyHistorical,
      baseline: baseline ?? undefined,
      policy: input.policy,
    });
    detections.push(...cpDetections);
  }

  // 5. Timing anomaly
  if (enabledDetectors.timing !== false) {
    const timingResult = detectTimingAnomaly({
      transactionDate: tx.transactionDate,
      baseline: baseline ?? undefined,
      policy: input.policy,
    });
    detections.push(timingResult.unusualTime, timingResult.unusualDay);
  }

  // 6. COA anomaly
  if (enabledDetectors.coa !== false) {
    const phase2Intent = input.phase2Classification?.primaryIntent as string | undefined;
    const phase3Coa = input.phase3Prediction?.primaryRecommendation?.coaCode;
    const coaResult = detectCoaAnomaly({
      coaCode: tx.coaCode,
      coaId: tx.coaId,
      intent: input.phase1Analysis?.intent as string | undefined,
      counterpartyName: tx.counterpartyName,
      companyId: input.companyId,
      historical: sameCompanyHistorical,
      phase2Intent,
      phase3CoaCode: phase3Coa,
      policy: input.policy,
    });
    detections.push(coaResult.unusualCoa, coaResult.coaIntentMismatch);
  }

  // 7. Split transaction
  if (enabledDetectors.splitTransaction !== false) {
    const splitPolicy = approvalThresholds.length > 0
      ? { ...input.policy, approvalThresholds }
      : input.policy;
    detections.push(
      detectSplitTransaction({
        amount: tx.amount,
        transactionDate: tx.transactionDate,
        counterpartyName: tx.counterpartyName,
        companyId: input.companyId,
        historical: sameCompanyHistorical,
        policy: splitPolicy,
      }),
    );
  }

  // 8. Cross-company
  if (enabledDetectors.crossCompany !== false) {
    detections.push(
      detectCrossCompanyAnomaly({
        companyId: input.companyId,
        transactionId: tx.id,
        referenceNumber: tx.referenceNumber,
        coaCode: tx.coaCode,
        counterpartyName: tx.counterpartyName,
        allCompanyHistorical: historical, // full historical including other companies
        policy: input.policy,
      }),
    );
  }

  // 9. Rapid reversal (always run, uses same-company historical)
  {
    const phase2Intent = input.phase2Classification?.primaryIntent as string | undefined;
    detections.push(
      buildRapidReversalDetection({
        amount: tx.amount,
        direction: tx.direction,
        transactionDate: tx.transactionDate,
        description: tx.description,
        referenceNumber: tx.referenceNumber,
        companyId: input.companyId,
        historical: sameCompanyHistorical,
        windowHours: 24,
        phase2Intent,
      }),
    );
  }

  // 10. Unusual direction
  {
    const phase2Intent = input.phase2Classification?.primaryIntent as string | undefined;
    const unusualDirection = detectUnusualDirection(tx.direction, tx.amount, phase2Intent, sameCompanyHistorical);
    detections.push(unusualDirection);
  }

  return detections;
}

// ─── Unusual direction ────────────────────────────────────────────────────────

function detectUnusualDirection(
  direction: string | undefined,
  amount: number,
  intent: string | undefined,
  historical: HistoricalTransactionRecord[],
): AnomalyDetection {
  if (!direction || direction === 'UNKNOWN') {
    return { type: 'UNUSUAL_DIRECTION', detected: false, score: 0, severity: 'INFO', reason: [], evidence: [] };
  }
  // Check if historical transactions for this intent have opposite direction
  if (intent && historical.length >= 5) {
    const intentHistory = historical.filter(h => h.intent === intent && h.direction);
    if (intentHistory.length >= 3) {
      const directions = intentHistory.map(h => h.direction);
      const expectedDirection = directions.filter(d => d === direction).length >= directions.filter(d => d !== direction).length
        ? direction : (direction === 'DEBIT' ? 'CREDIT' : 'DEBIT');
      if (expectedDirection !== direction) {
        return {
          type: 'UNUSUAL_DIRECTION',
          detected: true,
          score: 0.35,
          severity: 'LOW',
          reason: [`Transaction direction "${direction}" is opposite to historical pattern for intent "${intent}"`],
          evidence: [{ key: 'expectedDirection', value: expectedDirection, contribution: 0.35 }],
        };
      }
    }
  }
  return { type: 'UNUSUAL_DIRECTION', detected: false, score: 0, severity: 'INFO', reason: [], evidence: [] };
}

// ─── INSUFFICIENT_BASELINE sentinel ──────────────────────────────────────────

function buildInsufficientBaselineDetection(sampleSize: number, minimumSample: number): AnomalyDetection {
  const score = sampleSize === 0 ? 0.15 : 0.08;
  return {
    type: 'INSUFFICIENT_BASELINE',
    detected: true,
    score,
    severity: 'INFO',
    reason: [
      `Historical baseline has ${sampleSize} samples (minimum: ${minimumSample}) — detection confidence is reduced`,
    ],
    evidence: [
      { key: 'sampleSize', value: sampleSize, expected: minimumSample, contribution: score },
    ],
  };
}

// ─── Main public API ──────────────────────────────────────────────────────────

/**
 * Detect anomalies in a single transaction.
 *
 * @param input  Transaction + context + optional historical data
 * @param deps   Async dependency injection (DB, baseline provider, time)
 */
export async function detectTransactionAnomalies(
  input: AnomalyDetectionInput,
  deps: AnomalyDetectionDependencies = {},
): Promise<AnomalyDetectionResult> {
  const policy = mergePolicy(input.policy);
  const { historical, baseline, now, approvalThresholds } = await resolveContext(input, deps);

  const sampleSize = baseline?.sampleSize ?? 0;
  const baselineQuality = computeBaselineQuality(sampleSize);

  let detections = runDetectors(input, historical, baseline, now, approvalThresholds);

  // Add INSUFFICIENT_BASELINE if sample is too small
  if (sampleSize < policy.minimumHistoricalSample) {
    detections.push(buildInsufficientBaselineDetection(sampleSize, policy.minimumHistoricalSample));
  }

  // Aggregate scores from detected anomalies only
  const detectedScores = detections.filter(d => d.detected).map(d => d.score);
  const anomalyScore = parseFloat(combineScores(detectedScores).toFixed(4));
  const riskLevel = scoreToRiskLevel(anomalyScore, policy);
  const isAnomaly = riskLevel !== 'NONE';
  const anomalyTypes = aggregateAnomalyTypes(detections);

  const phase2Intent = input.phase2Classification?.primaryIntent as string | undefined;
  const explanation = buildExplanations(detections, riskLevel, baselineQuality);
  const conflictFlags = buildConflictFlags(detections, phase2Intent);

  const recommendation = buildRecommendation({ score: anomalyScore, riskLevel, detections });
  const requiresManualReview = computeRequiresManualReview(riskLevel, recommendation);

  const activeDetectorCount = Object.values(policy.enabledDetectors).filter(Boolean).length;
  const confidence = parseFloat(
    computeDetectionConfidence(baselineQuality, activeDetectorCount, anomalyTypes.length).toFixed(4),
  );

  return {
    companyId: input.companyId,
    transactionId: input.transaction.id,
    isAnomaly,
    anomalyScore,
    riskLevel,
    anomalyTypes,
    detections,
    explanation,
    recommendation,
    requiresManualReview,
    baselineQuality,
    confidence,
    conflictFlags,
    evaluatedAt: now.toISOString(),
    anomalyVersion: '1.0',
  };
}

/**
 * Detect anomalies in a batch of transactions.
 *
 * Preserves input order. Each transaction is analyzed independently.
 * Company isolation is maintained per transaction.
 *
 * @param inputs Array of detection inputs (order preserved in output)
 * @param deps   Shared dependency injection
 */
export async function detectTransactionAnomaliesBatch(
  inputs: AnomalyDetectionInput[],
  deps: AnomalyDetectionDependencies = {},
): Promise<AnomalyDetectionResult[]> {
  // Process sequentially to preserve order; inputs are independent
  const results: AnomalyDetectionResult[] = [];
  for (const input of inputs) {
    results.push(await detectTransactionAnomalies(input, deps));
  }
  return results;
}

/**
 * Evaluate which detectors would fire for a given input without
 * building the full result. Useful for testing and debugging.
 */
export async function evaluateAnomalyDetectors(
  input: AnomalyDetectionInput,
  deps: AnomalyDetectionDependencies = {},
): Promise<{ type: string; detected: boolean; score: number }[]> {
  const { historical, baseline, now, approvalThresholds } = await resolveContext(input, deps);
  const detections = runDetectors(input, historical, baseline, now, approvalThresholds);
  return detections.map(d => ({ type: d.type, detected: d.detected, score: d.score }));
}
