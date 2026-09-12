/**
 * AI Transaction Intelligence — Phase 7
 * Cross-Company Anomaly Detector
 *
 * Detects:
 *   - Transactions using COA/account from a different company's context
 *   - Reference numbers reused across companies
 *   - Intercompany payments without expected intercompany context
 *
 * Historical records from other companies are ONLY used for cross-company
 * conflict detection — never as baseline for the current company.
 * Pure function — no side effects.
 */

import type {
  AnomalyDetection,
  AnomalyEvidence,
  HistoricalTransactionRecord,
  AnomalyDetectionPolicy,
} from './anomalyTypes.js';
import { mergePolicy } from './anomalyRules.js';

// ─── Detector ─────────────────────────────────────────────────────────────────

export interface CrossCompanyDetectorInput {
  companyId: string | number;
  transactionId?: string | number;
  referenceNumber?: string;
  coaCode?: string;
  counterpartyName?: string;
  /** Historical records — may include other companies for cross-company detection. */
  allCompanyHistorical?: HistoricalTransactionRecord[];
  policy?: AnomalyDetectionPolicy;
}

export function detectCrossCompanyAnomaly(input: CrossCompanyDetectorInput): AnomalyDetection {
  const policy = mergePolicy(input.policy);
  const companyIdStr = String(input.companyId);

  if (!input.allCompanyHistorical || input.allCompanyHistorical.length === 0) {
    return noDetect();
  }

  const otherCompanyRecords = input.allCompanyHistorical.filter(
    h => String(h.companyId) !== companyIdStr,
  );

  if (otherCompanyRecords.length === 0) {
    return noDetect();
  }

  const evidence: AnomalyEvidence[] = [];
  const reasons: string[] = [];
  let score = 0;

  // ── Reference number reused across companies ───────────────────────────────
  if (input.referenceNumber && input.referenceNumber.trim().length > 3) {
    const refNorm = input.referenceNumber.trim().toLowerCase();
    const crossRef = otherCompanyRecords.filter(
      h => h.referenceNumber?.trim().toLowerCase() === refNorm,
    );
    if (crossRef.length > 0) {
      const companyIds = [...new Set(crossRef.map(h => String(h.companyId)))];
      score = Math.max(score, 0.75);
      reasons.push(
        `Reference "${input.referenceNumber}" appears in ${crossRef.length} transaction(s) for other company(ies): ${companyIds.join(', ')}`,
      );
      evidence.push({ key: 'crossCompanyReference', value: crossRef.length, expected: '0', contribution: 0.75 });
    }
  }

  // ── COA used by another company but not current company ───────────────────
  if (input.coaCode) {
    const otherCompanyCoaUsers = otherCompanyRecords.filter(h => h.coaCode === input.coaCode);
    const currentCompanyCoaUsers = input.allCompanyHistorical.filter(
      h => String(h.companyId) === companyIdStr && h.coaCode === input.coaCode,
    );
    if (otherCompanyCoaUsers.length > 0 && currentCompanyCoaUsers.length === 0) {
      score = Math.max(score, 0.55);
      const otherIds = [...new Set(otherCompanyCoaUsers.map(h => String(h.companyId)))];
      reasons.push(
        `COA "${input.coaCode}" is used by other company(ies) (${otherIds.join(', ')}) but never by this company`,
      );
      evidence.push({ key: 'coaUsedByOtherCompany', value: input.coaCode, contribution: 0.55 });
    }
  }

  // ── Counterparty appears in both companies with different context ──────────
  if (input.counterpartyName) {
    const cpNorm = input.counterpartyName.toLowerCase();
    const otherCpTx = otherCompanyRecords.filter(
      h => h.counterpartyName?.toLowerCase() === cpNorm,
    );
    if (otherCpTx.length > 0) {
      const otherIntents = [...new Set(otherCpTx.map(h => h.intent).filter(Boolean))];
      if (otherIntents.length > 0) {
        const score2 = 0.30;
        score = Math.max(score, score2);
        reasons.push(
          `Counterparty "${input.counterpartyName}" appears in other company's transactions with intent(s): ${otherIntents.join(', ')}`,
        );
        evidence.push({ key: 'crossCompanyCounterparty', value: otherIntents.join(', '), contribution: score2 });
      }
    }
  }

  const detected = score >= 0.25;
  const severity = score >= 0.70 ? 'CRITICAL'
    : score >= 0.50 ? 'HIGH'
    : score >= 0.30 ? 'MEDIUM'
    : 'LOW';

  return {
    type: 'CROSS_COMPANY_PATTERN',
    detected,
    score: parseFloat(score.toFixed(4)),
    severity: detected ? severity : 'INFO',
    reason: detected ? reasons : [],
    evidence: detected ? evidence : [],
  };
}

function noDetect(): AnomalyDetection {
  return { type: 'CROSS_COMPANY_PATTERN', detected: false, score: 0, severity: 'INFO', reason: [], evidence: [] };
}
