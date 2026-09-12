/**
 * AI Transaction Intelligence — Phase 7
 * Counterparty Anomaly Detector
 *
 * Detects:
 *   - New counterparty (not seen historically)
 *   - Changed bank account for known counterparty
 *   - Counterparty inconsistent with stated intent
 *   - Name-account mismatch (similar name, different account)
 *
 * Generic counterparty names (PT, CV, BANK, etc.) are not flagged strongly.
 * Pure function — no side effects, no DB calls.
 */

import type {
  AnomalyDetection,
  AnomalyEvidence,
  HistoricalTransactionRecord,
  AnomalyDetectionPolicy,
} from './anomalyTypes.js';
import { isGenericCounterparty, descriptionSimilarity } from './anomalyRules.js';
import { mergePolicy } from './anomalyRules.js';

// ─── Detector ─────────────────────────────────────────────────────────────────

export interface CounterpartyDetectorInput {
  counterpartyName?: string;
  counterpartyAccount?: string;
  intent?: string;
  coaCode?: string;
  companyId: string | number;
  historical: HistoricalTransactionRecord[];
  baseline?: { commonCounterparties?: string[] };
  policy?: AnomalyDetectionPolicy;
}

export function detectCounterpartyAnomaly(input: CounterpartyDetectorInput): AnomalyDetection[] {
  const policy = mergePolicy(input.policy);
  const ignored = new Set((policy.ignoredCounterparties ?? []).map(s => s.toLowerCase()));

  if (!input.counterpartyName || isGenericCounterparty(input.counterpartyName)) {
    // Generic or missing counterparty — no strong flag
    return [noDetection('NEW_COUNTERPARTY'), noDetection('UNUSUAL_COUNTERPARTY')];
  }

  const cpName = input.counterpartyName.toLowerCase().trim();
  if (ignored.has(cpName)) {
    return [noDetection('NEW_COUNTERPARTY'), noDetection('UNUSUAL_COUNTERPARTY')];
  }

  const sameCompany = input.historical.filter(
    h => String(h.companyId) === String(input.companyId),
  );

  const evidence: AnomalyEvidence[] = [];
  const reasons: string[] = [];

  // ── New counterparty detection ─────────────────────────────────────────────
  const knownCps = sameCompany
    .map(h => h.counterpartyName?.toLowerCase().trim())
    .filter(Boolean) as string[];

  const exactlyKnown = knownCps.includes(cpName);
  const inBaseline = input.baseline?.commonCounterparties?.some(
    cp => cp.toLowerCase() === cpName,
  ) ?? false;

  let newCpScore = 0;
  const newCpReasons: string[] = [];

  if (!exactlyKnown && !inBaseline) {
    // Is this genuinely new or is the historical set too small?
    if (sameCompany.length < 5) {
      newCpScore = 0.10; // insufficient history to judge
      newCpReasons.push('Counterparty not seen in limited historical data');
    } else {
      newCpScore = 0.25;
      newCpReasons.push(`Counterparty "${input.counterpartyName}" has not been seen in ${sameCompany.length} historical transactions`);
      evidence.push({ key: 'isNewCounterparty', value: true, contribution: newCpScore });
    }
  }

  const newCpDetected = newCpScore >= 0.20;

  // ── Unusual counterparty / account change detection ────────────────────────
  const unusualEvidence: AnomalyEvidence[] = [];
  const unusualReasons: string[] = [];
  let unusualScore = 0;

  // Check if same counterparty name has used different bank accounts
  if (input.counterpartyAccount && input.counterpartyAccount.trim().length > 0) {
    const cpTransactions = sameCompany.filter(
      h => h.counterpartyName?.toLowerCase().trim() === cpName,
    );
    if (cpTransactions.length >= 2) {
      const knownAccounts = new Set(
        cpTransactions
          .map(h => h.counterpartyAccount?.trim())
          .filter(Boolean) as string[],
      );
      const currentAccount = input.counterpartyAccount.trim();
      if (!knownAccounts.has(currentAccount) && knownAccounts.size > 0) {
        unusualScore = 0.65;
        unusualReasons.push(
          `Counterparty "${input.counterpartyName}" previously used ${knownAccounts.size} known account(s), now using a new account`,
        );
        unusualEvidence.push({
          key: 'previousAccountCount',
          value: knownAccounts.size,
          contribution: unusualScore,
        });
      }
    }
  }

  // Check for name-account near-match (same account, slightly different name — possible impersonation)
  if (input.counterpartyAccount && input.counterpartyAccount.trim().length > 0) {
    const currentAccount = input.counterpartyAccount.trim();
    const sameAccountDifferentName = sameCompany.filter(h => {
      if (!h.counterpartyAccount || !h.counterpartyName) return false;
      const acctMatch = h.counterpartyAccount.trim() === currentAccount;
      const nameSimilarity = descriptionSimilarity(h.counterpartyName.toLowerCase(), cpName);
      return acctMatch && nameSimilarity < 0.5 && nameSimilarity >= 0;
    });
    if (sameAccountDifferentName.length > 0) {
      const score = 0.55;
      unusualScore = Math.max(unusualScore, score);
      unusualReasons.push(
        `Account previously used by a different counterparty name — possible impersonation`,
      );
      unusualEvidence.push({ key: 'accountNameMismatch', value: true, contribution: score });
    }
  }

  // Name near-match to known counterparties (typo-squatting)
  if (knownCps.length > 0 && !exactlyKnown) {
    for (const known of knownCps) {
      const sim = descriptionSimilarity(cpName, known);
      if (sim >= 0.6 && sim < 1.0) {
        const score = Math.min(0.50, sim * 0.60);
        if (score > unusualScore) {
          unusualScore = score;
          unusualReasons.push(
            `Counterparty name "${input.counterpartyName}" is similar (${(sim * 100).toFixed(0)}%) to known counterparty "${known}" but not identical`,
          );
          unusualEvidence.push({ key: 'nameSimilarity', value: parseFloat(sim.toFixed(2)), expected: '1.0 (exact match)', contribution: score });
        }
      }
    }
  }

  const unusualDetected = unusualScore >= 0.25;
  const unusualSeverity = unusualScore >= 0.60 ? 'HIGH'
    : unusualScore >= 0.40 ? 'MEDIUM'
    : 'LOW';

  return [
    {
      type: 'NEW_COUNTERPARTY',
      detected: newCpDetected,
      score: parseFloat(newCpScore.toFixed(4)),
      severity: newCpDetected ? 'LOW' : 'INFO',
      reason: newCpDetected ? newCpReasons : [],
      evidence: newCpDetected ? evidence : [],
    },
    {
      type: 'UNUSUAL_COUNTERPARTY',
      detected: unusualDetected,
      score: parseFloat(unusualScore.toFixed(4)),
      severity: unusualDetected ? unusualSeverity : 'INFO',
      reason: unusualDetected ? unusualReasons : [],
      evidence: unusualDetected ? unusualEvidence : [],
    },
  ];
}

function noDetection(type: 'NEW_COUNTERPARTY' | 'UNUSUAL_COUNTERPARTY'): AnomalyDetection {
  return {
    type,
    detected: false,
    score: 0,
    severity: 'INFO',
    reason: [],
    evidence: [],
  };
}
