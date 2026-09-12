/**
 * AI Transaction Intelligence — Phase 8
 * AI Snapshot Builder
 *
 * Builds immutable snapshots of Phase 1–7 AI decisions.
 * Uses deep copy to prevent mutation. Deterministic checksum.
 *
 * Pure function — no side effects, no DB calls, no Date.now().
 */

import type {
  AISnapshot,
  TransactionSnapshot,
  ReviewOrchestrationInput,
} from './reviewOrchestrationTypes.js';
import { maskAccountNumber, redactSensitiveMetadata } from './reviewPrivacy.js';

// ─── Snapshot version ────────────────────────────────────────────────────────

export const SNAPSHOT_VERSION = '1.0';
export const ORCHESTRATION_VERSION = '1.0';

// ─── Deterministic checksum ──────────────────────────────────────────────────

/**
 * FNV-1a 32-bit checksum — deterministic, no randomness, no Date.now().
 */
function fnv1a(s: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h.toString(16).padStart(8, '0');
}

function checksumPayload(data: object): string {
  // Sort keys for stability
  const stable = JSON.stringify(data, Object.keys(data).sort());
  return fnv1a(stable);
}

// ─── Transaction snapshot ────────────────────────────────────────────────────

export function buildTransactionSnapshot(input: ReviewOrchestrationInput): TransactionSnapshot {
  const tx = input.transaction;
  const date = tx.transactionDate instanceof Date
    ? tx.transactionDate.toISOString()
    : tx.transactionDate;

  return {
    transactionId: tx.id,
    description: tx.description,
    amount: tx.amount,
    currency: tx.currency,
    direction: tx.direction,
    transactionDate: date,
    maskedCounterpartyAccount: maskAccountNumber(tx.counterpartyAccount),
    referenceNumber: tx.referenceNumber,
  };
}

// ─── AI snapshot ─────────────────────────────────────────────────────────────

export function buildAISnapshot(input: ReviewOrchestrationInput): AISnapshot {
  const { phase1, phase2, phase3, phase4, phase7 } = input;

  // Deep-copy alternatives (immutable)
  const alternatives = (phase3.alternatives ?? []).slice(0, 5).map(alt => ({
    coaId: alt.coaId,
    coaCode: alt.coaCode,
    coaName: alt.coaName,
    confidence: alt.confidence,
  }));

  // Deep-copy primary recommendation
  const recommendedCoa = phase3.primaryRecommendation
    ? {
        coaId: phase3.primaryRecommendation.coaId,
        coaCode: phase3.primaryRecommendation.coaCode,
        coaName: phase3.primaryRecommendation.coaName,
        confidence: phase3.primaryRecommendation.confidence,
      }
    : null;

  // Collect conflict flags from all phases
  const conflictFlags: string[] = [
    ...(phase3.conflictFlags ?? []),
    ...(phase4.ambiguity?.map(a => a.type) ?? []),
    ...(phase7.conflictFlags ?? []),
  ];

  // Evidence summary from phase 4
  const evidenceSummary: string[] = [
    ...(phase4.accountingWarnings ?? []),
    ...(phase4.reviewerNotes?.slice(0, 3) ?? []),
  ];

  const explanationSummary =
    phase4.auditSummary ||
    phase2.reason?.[0] ||
    `Intent: ${phase2.primaryIntent} (${(phase2.confidence * 100).toFixed(0)}% confidence)`;

  // Engine version tags
  const engineVersions = {
    phase1: '1.0',
    phase2: '1.0',
    phase3: '1.0',
    phase4: phase4.explainabilityVersion ?? '1.0',
    phase7: phase7.anomalyVersion ?? '1.0',
    phase8: ORCHESTRATION_VERSION,
  };

  const evaluatedAt = phase7.evaluatedAt;

  // Checksum of the deterministic payload (no timestamps other than evaluatedAt)
  const checksumData = {
    intent: phase2.primaryIntent,
    intentConfidence: phase2.confidence,
    recommendedCoa,
    anomalyScore: phase7.anomalyScore,
    anomalyRisk: phase7.riskLevel,
    conflictFlags,
    snapshotVersion: SNAPSHOT_VERSION,
  };
  const snapshotChecksum = checksumPayload(checksumData);

  const snapshot: AISnapshot = {
    intent: phase2.primaryIntent,
    taxSubtype: phase1.taxSubtype,
    taxUncertaintyWarning:
      phase1.taxSubtype === 'UNKNOWN_TAX' || (phase2.primaryIntent.startsWith('TAX') && !phase1.taxSubtype)
        ? 'Jenis pajak belum dapat diidentifikasi secara pasti. Mapping dan approval manual wajib dilakukan.'
        : undefined,
    intentConfidence: phase2.confidence,
    recommendedCoa,
    alternatives,
    explanationSummary,
    evidenceSummary,
    conflictFlags,
    anomalyScore: phase7.anomalyScore,
    anomalyRisk: phase7.riskLevel,
    anomalyTypes: [...(phase7.anomalyTypes ?? [])],
    requiresManualReview: phase7.requiresManualReview || phase3.requiresManualReview || phase2.requiresManualReview,
    snapshotVersion: SNAPSHOT_VERSION,
    snapshotChecksum,
    evaluatedAt,
    engineVersions,
  };

  // Freeze for immutability (shallow — deep objects are copied)
  return Object.freeze(snapshot) as AISnapshot;
}

// ─── Re-export for snapshot build API ────────────────────────────────────────

export function buildReviewSnapshot(input: ReviewOrchestrationInput): {
  transactionSnapshot: TransactionSnapshot;
  aiSnapshot: AISnapshot;
} {
  return {
    transactionSnapshot: buildTransactionSnapshot(input),
    aiSnapshot: buildAISnapshot(input),
  };
}
