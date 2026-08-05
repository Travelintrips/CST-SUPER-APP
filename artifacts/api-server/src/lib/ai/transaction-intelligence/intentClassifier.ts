/**
 * AI Transaction Intelligence — Phase 2
 * Intent Classification Engine
 *
 * Public API:
 *   classifyTransactionIntent(input, deps?): Promise<IntentClassificationResult>
 *   classifyTransactionIntentBatch(inputs, deps?): Promise<IntentClassificationResult[]>
 *
 * Contract:
 *  - Additive: Phase 1 API unchanged.
 *  - Pure when no async deps are provided (synchronous path).
 *  - No DB calls inside the classifier — use IntentClassifierDependencies for lookups.
 *  - No Math.random(). Deterministic.
 *  - Batch preserves input order, no side effects, no mutation of inputs.
 */

import type { TransactionIntent } from './transactionTypes.js';
import { ALL_INTENTS } from './transactionTypes.js';
import { isLegacyTaxDescription, isTaxIntent } from './transactionTypes.js';
import { analyzeTransactionDescription } from './transactionUnderstanding.js';
import type {
  TransactionClassificationInput,
  IntentClassificationResult,
  IntentClassificationEvidence,
  IntentClassificationAlternative,
  IntentClassifierDependencies,
  CounterpartyRole,
} from './intentClassificationTypes.js';
import { normalizeText } from './transactionUnderstanding.js';
import {
  directionConflicts,
  directionDelta,
  counterpartyBoost,
  transactionCodeBoost,
  internalAccountBoost,
  findCollisionPartner,
  shouldRequireManualReviewP2,
  DIRECTION_BOOST,
  COUNTERPARTY_BOOST,
  TRANSACTION_CODE_BOOST,
  INTERNAL_ACCOUNT_BOOST,
} from './intentClassificationRules.js';
import { computeCompositeScore } from './intentClassificationConfidence.js';

// ─── Direction normalizer ─────────────────────────────────────────────────────

function normalizeDirection(
  raw: TransactionClassificationInput['direction'],
): 'DEBIT' | 'CREDIT' | 'UNKNOWN' {
  if (raw === 'DEBIT' || raw === 'CREDIT') return raw;
  return 'UNKNOWN';
}

// ─── Reason builder ───────────────────────────────────────────────────────────

function buildReasons(opts: {
  primaryIntent: TransactionIntent;
  direction: 'DEBIT' | 'CREDIT' | 'UNKNOWN';
  counterpartyRole?: CounterpartyRole;
  transactionCode?: string;
  phase1Intent: TransactionIntent;
  phase1Confidence: number;
  directionConflict: boolean;
  isInternalVerified: boolean;
  requiresManualReview: boolean;
}): string[] {
  const reasons: string[] = [];

  if (opts.phase1Confidence >= 0.70) {
    reasons.push(
      `Phase 1 analysis matched intent "${opts.phase1Intent}" with ${(opts.phase1Confidence * 100).toFixed(0)}% confidence.`,
    );
  } else {
    reasons.push(
      `Phase 1 analysis produced a low-confidence match (${(opts.phase1Confidence * 100).toFixed(0)}%).`,
    );
  }

  if (opts.direction !== 'UNKNOWN') {
    if (!opts.directionConflict) {
      reasons.push(
        `Transaction direction (${opts.direction}) is consistent with intent "${opts.primaryIntent}".`,
      );
    } else {
      reasons.push(
        `⚠ Transaction direction (${opts.direction}) conflicts with expected direction for "${opts.primaryIntent}". Manual review recommended.`,
      );
    }
  }

  if (opts.counterpartyRole && opts.counterpartyRole !== 'UNKNOWN') {
    reasons.push(`Counterparty classified as "${opts.counterpartyRole}".`);
  }

  if (opts.transactionCode) {
    reasons.push(`Bank transaction code "${opts.transactionCode}" provided as additional context.`);
  }

  if (opts.primaryIntent === 'INTERNAL_TRANSFER') {
    if (opts.isInternalVerified) {
      reasons.push('Counterparty account confirmed as internal company account.');
    } else {
      reasons.push('INTERNAL_TRANSFER intent requires manual verification — counterparty account not confirmed.');
    }
  }

  return reasons;
}

// ─── Evidence builder ─────────────────────────────────────────────────────────

function buildEvidence(opts: {
  primaryIntent: TransactionIntent;
  input: TransactionClassificationInput;
  direction: 'DEBIT' | 'CREDIT' | 'UNKNOWN';
  counterpartyRole?: CounterpartyRole;
  isInternalAccount?: boolean;
  phase1Confidence: number;
}): IntentClassificationEvidence[] {
  const evidence: IntentClassificationEvidence[] = [];

  // Phase 1 match
  evidence.push({
    type: 'PHASE1_MATCH',
    value: `Phase 1 confidence: ${(opts.phase1Confidence * 100).toFixed(0)}%`,
    weight: 0.35,
  });

  // Direction
  if (opts.direction !== 'UNKNOWN') {
    const dd = directionDelta(opts.primaryIntent, opts.direction);
    evidence.push({
      type: 'DIRECTION',
      value: opts.direction,
      weight: Math.abs(dd),
    });
  }

  // Counterparty
  if (opts.input.counterpartyName) {
    const cpWeight = counterpartyBoost(opts.primaryIntent, opts.counterpartyRole, opts.direction);
    evidence.push({
      type: 'COUNTERPARTY',
      value: opts.input.counterpartyName,
      weight: cpWeight,
    });
  }

  // Transaction code
  if (opts.input.transactionCode) {
    const tcWeight = transactionCodeBoost(opts.primaryIntent, opts.input.transactionCode);
    evidence.push({
      type: 'TRANSACTION_CODE',
      value: opts.input.transactionCode,
      weight: tcWeight,
    });
  }

  // Reference number
  if (opts.input.referenceNumber) {
    evidence.push({
      type: 'REFERENCE_NUMBER',
      value: opts.input.referenceNumber,
      weight: 0.05,
    });
  }

  // Internal account
  if (opts.isInternalAccount) {
    evidence.push({
      type: 'INTERNAL_ACCOUNT',
      value: opts.input.counterpartyAccount ?? 'confirmed',
      weight: INTERNAL_ACCOUNT_BOOST,
    });
  }

  // Bank name
  if (opts.input.bankName) {
    evidence.push({
      type: 'BANK_NAME',
      value: opts.input.bankName,
      weight: 0.02,
    });
  }

  // Description snippet
  const normalizedDesc = normalizeText(opts.input.description);
  if (normalizedDesc) {
    evidence.push({
      type: 'DESCRIPTION',
      value: normalizedDesc.slice(0, 60),
      weight: 0.05,
    });
  }

  // Sort by weight descending
  return evidence.sort((a, b) => b.weight - a.weight);
}

// ─── Core classifier (sync path) ─────────────────────────────────────────────

async function classifyCore(
  input: TransactionClassificationInput,
  deps: IntentClassifierDependencies,
): Promise<IntentClassificationResult> {
  // 1. Validate & normalize description
  const description = (input.description ?? '').trim();
  const direction = normalizeDirection(input.direction);

  // 2. Run Phase 1
  const phase1Analysis = analyzeTransactionDescription(description);
  const normalizedDescription = phase1Analysis.normalizedDescription;

  // 3. Resolve async dependencies (non-blocking if no deps provided)
  let counterpartyRole: CounterpartyRole | undefined;
  let isInternalAccount = false;

  if (deps.classifyCounterparty && input.counterpartyName) {
    try {
      counterpartyRole = await deps.classifyCounterparty(input.counterpartyName);
    } catch {
      counterpartyRole = 'UNKNOWN';
    }
  }

  if (deps.isInternalAccount && input.counterpartyAccount) {
    try {
      isInternalAccount = await deps.isInternalAccount(input.counterpartyAccount);
    } catch {
      isInternalAccount = false;
    }
  }

  // 4. Score every classifiable intent with composite model
  const intentScores = ALL_INTENTS
    .filter((i) => i !== 'UNKNOWN')
    .map((intent) => {
      // Find Phase 1 confidence for this specific intent
      const p1Candidate = phase1Analysis.candidates.find((c) => c.intent === intent);
      const p1Conf = p1Candidate?.score ?? 0;

      const composite = computeCompositeScore({
        intent,
        phase1Confidence: p1Conf,
        direction,
        counterpartyRole,
        transactionCode: input.transactionCode,
        isInternalAccount,
        hasSupportingKeywords: (p1Candidate?.matchedKeywords.length ?? 0) > 1,
      });

      return { intent, composite };
    });

  // Also consider Phase 1's primary intent directly
  const phase1IntentScore = intentScores.find(
    (s) => s.intent === phase1Analysis.intent,
  );
  if (phase1IntentScore && phase1Analysis.confidence > 0) {
    // Boost Phase 1 winner to ensure it's considered even if no contextual signals
    phase1IntentScore.composite = Math.max(
      phase1IntentScore.composite,
      phase1Analysis.confidence * 0.35,
    );
  }

  // Sort descending
  const sorted = intentScores.sort(
    (a, b) => b.composite - a.composite || a.intent.localeCompare(b.intent),
  );

  // Determine primary intent
  let primaryIntent: TransactionIntent = 'UNKNOWN';
  let primaryConfidence = 0;

  if (sorted.length > 0 && sorted[0].composite > 0) {
    primaryIntent = sorted[0].intent;
    primaryConfidence = sorted[0].composite;
  } else if (phase1Analysis.intent !== 'UNKNOWN') {
    primaryIntent = phase1Analysis.intent;
    primaryConfidence = phase1Analysis.confidence * 0.35;
  }

  // Deduplicate alternatives (exclude primary)
  const seenIntents = new Set<TransactionIntent>([primaryIntent]);
  const alternatives: IntentClassificationAlternative[] = [];
  for (const s of sorted) {
    if (seenIntents.has(s.intent)) continue;
    if (s.composite <= 0) break;
    alternatives.push({ intent: s.intent, confidence: s.composite });
    seenIntents.add(s.intent);
    if (alternatives.length >= 4) break;
  }

  const secondaryConfidence = alternatives[0]?.confidence ?? 0;

  // Keep legacy public intent values stable for existing integrations. New
  // article-specific descriptions still use the specific tax intents.
  if (isLegacyTaxDescription(normalizedDescription)) {
    primaryIntent = 'TAX_PAYMENT';
    primaryConfidence = Math.max(
      primaryConfidence,
      phase1Analysis.confidence * 0.35,
    );
  }

  // Direction conflict
  const hasDirectionConflict = directionConflicts(primaryIntent, direction);

  // Internal transfer verification
  const isInternalVerified = primaryIntent === 'INTERNAL_TRANSFER' && isInternalAccount;

  // Manual review
  const requiresManualReview = shouldRequireManualReviewP2({
    primaryIntent,
    primaryConfidence,
    secondaryConfidence,
    directionConflict: hasDirectionConflict,
    phase1IsUnknown: phase1Analysis.intent === 'UNKNOWN',
    internalTransferVerified: isInternalVerified,
    counterpartyRole,
    direction,
  }) || isTaxIntent(primaryIntent);

  // Check for known collision
  const hasCollision =
    alternatives.length > 0 &&
    findCollisionPartner(primaryIntent, alternatives[0].intent);

  const evidence = buildEvidence({
    primaryIntent,
    input,
    direction,
    counterpartyRole,
    isInternalAccount,
    phase1Confidence: phase1Analysis.confidence,
  });

  const reason = buildReasons({
    primaryIntent,
    direction,
    counterpartyRole,
    transactionCode: input.transactionCode,
    phase1Intent: phase1Analysis.intent,
    phase1Confidence: phase1Analysis.confidence,
    directionConflict: hasDirectionConflict,
    isInternalVerified,
    requiresManualReview,
  });

  if (hasCollision && alternatives.length > 0) {
    reason.push(
      `Known collision between "${primaryIntent}" and "${alternatives[0].intent}" — direction and counterparty used for resolution.`,
    );
  }

  if (isTaxIntent(primaryIntent)) {
    reason.push(
      `Tax classification "${phase1Analysis.taxSubtype ?? 'UNKNOWN_TAX'}" always requires human approval before posting.`,
    );
  }

  return {
    primaryIntent,
    confidence: primaryConfidence,
    normalizedDescription,
    alternatives,
    evidence,
    reason,
    phase1Analysis,
    requiresManualReview,
  };
}

// ─── Public API ───────────────────────────────────────────────────────────────

/**
 * Classify a single transaction's intent using Phase 1 analysis + contextual signals.
 *
 * @param input  - Structured transaction data. Only `description` is required.
 * @param deps   - Optional dependency injections for isInternalAccount / classifyCounterparty.
 * @returns      IntentClassificationResult with primaryIntent, confidence, evidence, and reasons.
 */
export async function classifyTransactionIntent(
  input: TransactionClassificationInput,
  deps: IntentClassifierDependencies = {},
): Promise<IntentClassificationResult> {
  // Defensive copy so we never mutate the caller's object
  const safeInput = { ...input };
  return classifyCore(safeInput, deps);
}

/**
 * Classify a batch of transactions.
 *
 * Contract:
 *  - Preserves input order.
 *  - Does not mutate any input object.
 *  - No network calls.
 *  - Deterministic.
 *
 * @param inputs - Array of TransactionClassificationInput (at least description required).
 * @param deps   - Optional shared dependency injections applied to all items.
 * @returns      Array of IntentClassificationResult in the same order as inputs.
 */
export async function classifyTransactionIntentBatch(
  inputs: TransactionClassificationInput[],
  deps: IntentClassifierDependencies = {},
): Promise<IntentClassificationResult[]> {
  // Process in parallel — each item is independent
  return Promise.all(
    inputs.map((input) => classifyTransactionIntent({ ...input }, deps)),
  );
}
