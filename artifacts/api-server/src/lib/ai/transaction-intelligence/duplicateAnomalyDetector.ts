/**
 * AI Transaction Intelligence — Phase 7
 * Duplicate Anomaly Detector
 *
 * Detects:
 *   - Exact duplicates (amount + direction + time window + reference + counterparty + desc)
 *   - Near-duplicates (similar amount, similar desc, same counterparty, within window)
 *   - Reference number reuse across different contexts
 *
 * Pure function — no side effects, no DB calls.
 */

import type {
  AnomalyDetection,
  AnomalyEvidence,
  HistoricalTransactionRecord,
  AnomalyDetectionPolicy,
} from './anomalyTypes.js';
import { parseDate, minutesBetween, descriptionSimilarity } from './anomalyRules.js';
import { mergePolicy } from './anomalyRules.js';

// ─── Helpers ──────────────────────────────────────────────────────────────────

function normalizeDesc(d?: string): string {
  return (d ?? '').toLowerCase().replace(/\s+/g, ' ').trim();
}

function amountWithinTolerance(a: number, b: number, tol: number): boolean {
  if (a === b) return true;
  const max = Math.max(Math.abs(a), Math.abs(b));
  if (max === 0) return true;
  return Math.abs(a - b) / max <= tol;
}

// ─── Exact duplicate ──────────────────────────────────────────────────────────

export interface DuplicateDetectorInput {
  transactionId?: string | number;
  amount: number;
  direction?: string;
  transactionDate: string | Date;
  referenceNumber?: string;
  counterpartyName?: string;
  counterpartyAccount?: string;
  bankAccountId?: string | number;
  description?: string;
  normalizedDescription?: string;
  companyId: string | number;
  historical: HistoricalTransactionRecord[];
  policy?: AnomalyDetectionPolicy;
}

export function detectDuplicateAnomaly(input: DuplicateDetectorInput): {
  exactDuplicate: AnomalyDetection;
  nearDuplicate: AnomalyDetection;
  referenceReuse: AnomalyDetection;
} {
  const policy = mergePolicy(input.policy);
  const txDate = parseDate(input.transactionDate);

  // Only check same-company records
  const sameCompany = input.historical.filter(
    h => String(h.companyId) === String(input.companyId),
  );

  // ── Exact duplicate ───────────────────────────────────────────────────────
  const exactEvidence: AnomalyEvidence[] = [];
  const exactReasons: string[] = [];
  let exactScore = 0;
  let bestExactMatch: HistoricalTransactionRecord | null = null;

  for (const h of sameCompany) {
    const hDate = parseDate(h.transactionDate);
    if (!hDate || !txDate) continue;
    const mins = minutesBetween(hDate, txDate);
    if (mins > policy.duplicateWindowMinutes) continue;

    // Skip if same ID
    if (input.transactionId != null && h.id != null && String(input.transactionId) === String(h.id)) continue;

    const sameAmount = h.amount === input.amount;
    const sameDirection = !input.direction || !h.direction || h.direction === input.direction;
    const sameRef = input.referenceNumber && h.referenceNumber &&
      input.referenceNumber.trim().toLowerCase() === h.referenceNumber.trim().toLowerCase();
    const sameCp = input.counterpartyName && h.counterpartyName &&
      input.counterpartyName.toLowerCase() === h.counterpartyName.toLowerCase();
    const sameBankAcc = input.bankAccountId != null && h.bankAccountId != null &&
      String(input.bankAccountId) === String(h.bankAccountId);
    const descSim = descriptionSimilarity(
      normalizeDesc(input.normalizedDescription || input.description),
      normalizeDesc(h.normalizedDescription || h.description),
    );

    // Score the match quality
    const matchFactors = [
      sameAmount ? 0.30 : 0,
      sameDirection ? 0.10 : 0,
      sameRef ? 0.25 : 0,
      sameCp ? 0.15 : 0,
      sameBankAcc ? 0.10 : 0,
      descSim >= 0.8 ? 0.10 : 0,
    ].reduce((a, b) => a + b, 0);

    if (matchFactors >= 0.55 && sameAmount) {
      const score = Math.min(0.95, matchFactors * 1.2);
      if (score > exactScore) {
        exactScore = score;
        bestExactMatch = h;
      }
    }
  }

  if (bestExactMatch && exactScore > 0) {
    exactReasons.push(
      `Possible exact duplicate detected within ${policy.duplicateWindowMinutes} min window`,
    );
    if (bestExactMatch.referenceNumber && input.referenceNumber &&
      bestExactMatch.referenceNumber.toLowerCase() === input.referenceNumber.toLowerCase()) {
      exactReasons.push(`Same reference number: ${input.referenceNumber}`);
      exactEvidence.push({ key: 'referenceMatch', value: true, contribution: 0.25 });
    }
    exactEvidence.push({ key: 'duplicateScore', value: parseFloat(exactScore.toFixed(2)), contribution: exactScore });
    exactEvidence.push({ key: 'amount', value: input.amount, contribution: 0.30 });
  }

  const exactDetected = exactScore >= 0.55;
  const exactSeverity = exactScore >= 0.85 ? 'CRITICAL'
    : exactScore >= 0.70 ? 'HIGH'
    : exactScore >= 0.55 ? 'MEDIUM'
    : 'INFO';

  // ── Near duplicate ────────────────────────────────────────────────────────
  const nearEvidence: AnomalyEvidence[] = [];
  const nearReasons: string[] = [];
  let nearScore = 0;

  if (!exactDetected) {
    for (const h of sameCompany) {
      const hDate = parseDate(h.transactionDate);
      if (!hDate || !txDate) continue;
      const mins = minutesBetween(hDate, txDate);
      if (mins > policy.duplicateWindowMinutes * 2) continue;

      if (input.transactionId != null && h.id != null && String(input.transactionId) === String(h.id)) continue;

      const amountClose = amountWithinTolerance(input.amount, h.amount, policy.nearDuplicateAmountTolerance);
      if (!amountClose) continue;

      const descSim = descriptionSimilarity(
        normalizeDesc(input.normalizedDescription || input.description),
        normalizeDesc(h.normalizedDescription || h.description),
      );
      const sameCp = input.counterpartyName && h.counterpartyName &&
        input.counterpartyName.toLowerCase() === h.counterpartyName.toLowerCase();

      let score = 0;
      if (amountClose) score += 0.30;
      if (descSim >= 0.6) score += descSim * 0.30;
      if (sameCp) score += 0.20;
      if (mins <= 30) score += 0.10;

      if (score >= 0.50 && score > nearScore) {
        nearScore = score;
        const amountDiff = Math.abs(input.amount - h.amount);
        nearReasons.push(
          `Near-duplicate detected: amount differs by ${amountDiff.toLocaleString()} (tolerance: ${(policy.nearDuplicateAmountTolerance * 100).toFixed(0)}%)`,
        );
        nearEvidence.push({ key: 'descriptionSimilarity', value: parseFloat(descSim.toFixed(2)), expected: '< 0.6', contribution: descSim * 0.30 });
        nearEvidence.push({ key: 'amountDifference', value: amountDiff, contribution: 0.30 });
        if (sameCp) nearEvidence.push({ key: 'sameCounterparty', value: true, contribution: 0.20 });
      }
    }
  }

  const nearDetected = nearScore >= 0.50 && !exactDetected;
  const nearSeverity = nearScore >= 0.75 ? 'HIGH'
    : nearScore >= 0.55 ? 'MEDIUM'
    : 'LOW';

  // ── Reference reuse ────────────────────────────────────────────────────────
  const refEvidence: AnomalyEvidence[] = [];
  const refReasons: string[] = [];
  let refScore = 0;

  if (input.referenceNumber && input.referenceNumber.trim().length > 3) {
    const refNorm = input.referenceNumber.trim().toLowerCase();
    const refMatches = sameCompany.filter(h =>
      h.referenceNumber?.trim().toLowerCase() === refNorm &&
      (input.transactionId == null || h.id == null || String(h.id) !== String(input.transactionId)),
    );
    if (refMatches.length > 0) {
      // Check if the reference is used in a different context (different amount/counterparty)
      const differentContext = refMatches.filter(
        h => h.amount !== input.amount ||
          (h.counterpartyName?.toLowerCase() !== input.counterpartyName?.toLowerCase()),
      );
      if (differentContext.length > 0) {
        refScore = 0.65;
        refReasons.push(`Reference number "${input.referenceNumber}" reused in ${differentContext.length} transaction(s) with different amount or counterparty`);
        refEvidence.push({ key: 'referenceReuseCount', value: differentContext.length, expected: '0', contribution: refScore });
      } else {
        // Same reference, same context → may be exact duplicate (handled above)
        refScore = 0.25;
        refReasons.push(`Reference number "${input.referenceNumber}" appears in ${refMatches.length} prior transaction(s)`);
        refEvidence.push({ key: 'referenceExistsCount', value: refMatches.length, expected: '0', contribution: refScore });
      }
    }
  }

  const refDetected = refScore >= 0.25;
  const refSeverity = refScore >= 0.60 ? 'HIGH' : refScore >= 0.30 ? 'MEDIUM' : 'LOW';

  return {
    exactDuplicate: {
      type: 'EXACT_DUPLICATE',
      detected: exactDetected,
      score: parseFloat(exactScore.toFixed(4)),
      severity: exactDetected ? exactSeverity : 'INFO',
      reason: exactDetected ? exactReasons : [],
      evidence: exactEvidence,
    },
    nearDuplicate: {
      type: 'NEAR_DUPLICATE',
      detected: nearDetected,
      score: parseFloat(nearScore.toFixed(4)),
      severity: nearDetected ? nearSeverity : 'INFO',
      reason: nearDetected ? nearReasons : [],
      evidence: nearEvidence,
    },
    referenceReuse: {
      type: 'REFERENCE_REUSE',
      detected: refDetected,
      score: parseFloat(refScore.toFixed(4)),
      severity: refDetected ? refSeverity : 'INFO',
      reason: refDetected ? refReasons : [],
      evidence: refEvidence,
    },
  };
}
