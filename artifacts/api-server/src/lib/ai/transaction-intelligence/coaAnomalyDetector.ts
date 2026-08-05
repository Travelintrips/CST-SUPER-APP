/**
 * AI Transaction Intelligence — Phase 7
 * COA Anomaly Detector
 *
 * Detects:
 *   - COA never used for this intent in history → UNUSUAL_COA
 *   - COA contradicts Phase 2 intent (e.g. payroll to non-payroll) → COA_INTENT_MISMATCH
 *   - COA changed from historical pattern for this counterparty → UNUSUAL_COA
 *
 * Does NOT change Phase 3 COA recommendation. Detection only (warning flag).
 * Pure function — no side effects.
 */

import type {
  AnomalyDetection,
  AnomalyEvidence,
  HistoricalTransactionRecord,
  AnomalyDetectionPolicy,
} from './anomalyTypes.js';
import {
  isArCoaCode,
  isApCoaCode,
  isRevenueCoaCode,
  isExpenseCoaCode,
  isPayrollCoaCode,
  isTaxCoaCode,
  mergePolicy,
} from './anomalyRules.js';

// ─── Intent–COA business rules ─────────────────────────────────────────────────

interface CoaRule {
  intentPattern: string[];
  isNormal: (coaCode: string) => boolean;
  mismatchDescription: string;
}

const COA_RULES: CoaRule[] = [
  {
    intentPattern: ['CUSTOMER_PAYMENT'],
    isNormal: code => isArCoaCode(code) || isRevenueCoaCode(code),
    mismatchDescription: 'Customer payment mapped to non-AR/revenue account',
  },
  {
    intentPattern: ['VENDOR_PAYMENT'],
    isNormal: code => isApCoaCode(code) || isExpenseCoaCode(code),
    mismatchDescription: 'Vendor payment mapped to non-AP/expense account',
  },
  {
    intentPattern: ['PAYROLL'],
    isNormal: code => isPayrollCoaCode(code) || isExpenseCoaCode(code),
    mismatchDescription: 'Payroll transaction mapped to non-payroll/expense account',
  },
  {
    intentPattern: ['TAX_PAYMENT'],
    isNormal: code => isTaxCoaCode(code) || isApCoaCode(code),
    mismatchDescription: 'Tax payment mapped to non-tax account',
  },
  {
    intentPattern: ['INTEREST_INCOME', 'INTEREST_EXPENSE'],
    isNormal: code => isRevenueCoaCode(code) || isExpenseCoaCode(code),
    mismatchDescription: 'Interest transaction mapped to non-revenue/expense account',
  },
  {
    intentPattern: ['INTERNAL_TRANSFER'],
    isNormal: code => /^1-1[0-1]|clearing|transfer/i.test(code),
    mismatchDescription: 'Internal transfer mapped to non-clearing account',
  },
];

// ─── Detector ─────────────────────────────────────────────────────────────────

export interface CoaDetectorInput {
  coaCode?: string;
  coaId?: string | number;
  intent?: string;
  counterpartyName?: string;
  companyId: string | number;
  historical: HistoricalTransactionRecord[];
  phase2Intent?: string;
  phase3CoaCode?: string;
  policy?: AnomalyDetectionPolicy;
}

export function detectCoaAnomaly(input: CoaDetectorInput): {
  unusualCoa: AnomalyDetection;
  coaIntentMismatch: AnomalyDetection;
} {
  const policy = mergePolicy(input.policy);
  const { coaCode, intent, historical } = input;
  const ignoredCoa = new Set((policy.ignoredCoaCodes ?? []).map(s => s.toLowerCase()));

  if (!coaCode) {
    return { unusualCoa: noDetect('UNUSUAL_COA'), coaIntentMismatch: noDetect('COA_INTENT_MISMATCH') };
  }

  if (ignoredCoa.has(coaCode.toLowerCase())) {
    return { unusualCoa: noDetect('UNUSUAL_COA'), coaIntentMismatch: noDetect('COA_INTENT_MISMATCH') };
  }

  const sameCompany = historical.filter(h => String(h.companyId) === String(input.companyId));

  // ── Unusual COA (historical pattern check) ────────────────────────────────
  const unusualEvidence: AnomalyEvidence[] = [];
  const unusualReasons: string[] = [];
  let unusualScore = 0;

  if (intent && sameCompany.length >= 5) {
    const intentHistory = sameCompany.filter(h => h.intent === intent && h.coaCode);
    if (intentHistory.length >= 3) {
      const coasForIntent = new Set(intentHistory.map(h => h.coaCode!));
      if (!coasForIntent.has(coaCode)) {
        unusualScore = 0.40;
        unusualReasons.push(
          `COA "${coaCode}" has not been used for intent "${intent}" in ${intentHistory.length} historical transactions (used: ${[...coasForIntent].slice(0, 3).join(', ')})`,
        );
        unusualEvidence.push({ key: 'coaNotUsedForIntent', value: coaCode, contribution: unusualScore });
      }
    }
  }

  // Check if counterparty historically uses a different COA
  if (input.counterpartyName && sameCompany.length >= 5) {
    const cpHistory = sameCompany.filter(
      h => h.counterpartyName?.toLowerCase() === input.counterpartyName!.toLowerCase() && h.coaCode,
    );
    if (cpHistory.length >= 3) {
      const coasForCp = new Set(cpHistory.map(h => h.coaCode!));
      if (!coasForCp.has(coaCode)) {
        const score = 0.35;
        unusualScore = Math.max(unusualScore, score);
        unusualReasons.push(
          `Counterparty "${input.counterpartyName}" historically uses COA(s): ${[...coasForCp].slice(0, 3).join(', ')}, not "${coaCode}"`,
        );
        unusualEvidence.push({ key: 'coaChangedForCounterparty', value: coaCode, contribution: score });
      }
    }
  }

  // Phase 3 recommendation mismatch
  if (input.phase3CoaCode && input.phase3CoaCode !== coaCode) {
    const score = 0.30;
    unusualScore = Math.max(unusualScore, score);
    unusualReasons.push(
      `Assigned COA "${coaCode}" differs from Phase 3 prediction "${input.phase3CoaCode}"`,
    );
    unusualEvidence.push({ key: 'phase3Mismatch', value: coaCode, expected: input.phase3CoaCode, contribution: score });
  }

  const unusualDetected = unusualScore >= 0.25;
  const unusualSeverity = unusualScore >= 0.55 ? 'MEDIUM'
    : unusualScore >= 0.35 ? 'LOW'
    : 'INFO';

  // ── COA–Intent mismatch (business rule check) ─────────────────────────────
  const mismatchEvidence: AnomalyEvidence[] = [];
  const mismatchReasons: string[] = [];
  let mismatchScore = 0;

  const effectiveIntent = input.phase2Intent ?? intent;
  if (effectiveIntent) {
    for (const rule of COA_RULES) {
      if (rule.intentPattern.includes(effectiveIntent)) {
        if (!rule.isNormal(coaCode)) {
          mismatchScore = 0.65;
          mismatchReasons.push(rule.mismatchDescription + ` (intent: ${effectiveIntent}, COA: ${coaCode})`);
          mismatchEvidence.push({
            key: 'intentCoaRuleViolation',
            value: coaCode,
            expected: `COA consistent with ${effectiveIntent}`,
            contribution: mismatchScore,
          });
        }
        break;
      }
    }
  }

  const mismatchDetected = mismatchScore >= 0.25;
  const mismatchSeverity = mismatchScore >= 0.60 ? 'HIGH'
    : mismatchScore >= 0.40 ? 'MEDIUM'
    : 'LOW';

  return {
    unusualCoa: {
      type: 'UNUSUAL_COA',
      detected: unusualDetected,
      score: parseFloat(unusualScore.toFixed(4)),
      severity: unusualDetected ? unusualSeverity : 'INFO',
      reason: unusualDetected ? unusualReasons : [],
      evidence: unusualEvidence,
    },
    coaIntentMismatch: {
      type: 'COA_INTENT_MISMATCH',
      detected: mismatchDetected,
      score: parseFloat(mismatchScore.toFixed(4)),
      severity: mismatchDetected ? mismatchSeverity : 'INFO',
      reason: mismatchDetected ? mismatchReasons : [],
      evidence: mismatchEvidence,
    },
  };
}

function noDetect(type: 'UNUSUAL_COA' | 'COA_INTENT_MISMATCH'): AnomalyDetection {
  return { type, detected: false, score: 0, severity: 'INFO', reason: [], evidence: [] };
}
