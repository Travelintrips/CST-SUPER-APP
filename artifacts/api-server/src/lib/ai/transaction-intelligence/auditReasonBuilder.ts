/**
 * AI Transaction Intelligence — Phase 4
 * Audit Reason Builder
 *
 * Produces a human-readable audit summary and structured reviewer notes
 * from Phase 1–3 outputs.
 * Pure function — no side effects, no DB calls.
 */

import type {
  ExplainabilityInput,
  ExplainabilityConfidence,
  AmbiguityFlag,
  AmbiguityType,
  RecommendationStatus,
} from './explainabilityTypes.js';

// ─── Ambiguity detection ──────────────────────────────────────────────────────

const AMBIGUITY_META: Record<AmbiguityType, { description: string; reviewAction: string }> = {
  AR_VS_REVENUE:             {
    description:    'Transaction looks like a CUSTOMER_PAYMENT but the recommended account is a revenue/income account. This may indicate the receivable (AR) account should be used instead.',
    reviewAction:   'Verify whether to post to AR (1-1xxx) or directly to revenue. Usually AR is correct for customer payments.',
  },
  AP_VS_EXPENSE:             {
    description:    'Transaction looks like a VENDOR_PAYMENT but the recommended account is an expense account. The Accounts Payable (AP/hutang) account may be more appropriate.',
    reviewAction:   'Check whether to post to AP (2-1xxx) or directly to expense. AP is usually correct for vendor payments.',
  },
  INTERNAL_TRANSFER:         {
    description:    'Intent classified as INTERNAL_TRANSFER but no confirmed internal account evidence is available.',
    reviewAction:   'Confirm both sender and receiver accounts belong to the same company before posting.',
  },
  UNKNOWN_INTENT:            {
    description:    'The AI could not classify the transaction intent. The description may be too generic, abbreviated, or in an unexpected format.',
    reviewAction:   'Manually classify the intent and select the appropriate COA account before posting.',
  },
  MULTIPLE_CLOSE_CANDIDATES: {
    description:    'Two or more account candidates have very similar confidence scores, making the top choice uncertain.',
    reviewAction:   'Review all candidate accounts and select the most appropriate one based on business context.',
  },
  WEAK_EVIDENCE:             {
    description:    'The AI recommendation is based on weak evidence only (no historical mappings, no strong keyword matches, no counterparty signal).',
    reviewAction:   'Treat this recommendation with caution. Verify against accounting policy before posting.',
  },
  CROSS_COMPANY:             {
    description:    'One or more input accounts belong to a different company and were excluded from the recommendation.',
    reviewAction:   'Ensure the correct company\'s chart of accounts is being used for this transaction.',
  },
  INACTIVE_ACCOUNT:          {
    description:    'One or more candidate accounts are inactive and cannot receive journal entries.',
    reviewAction:   'Select an active account from the chart of accounts.',
  },
  NON_POSTABLE_ACCOUNT:      {
    description:    'One or more candidate accounts are header/summary accounts that do not allow manual postings.',
    reviewAction:   'Select a leaf/detail account that allows manual journal entries.',
  },
};

/**
 * Detect ambiguity flags from Phase 1–3 outputs.
 */
export function detectAmbiguity(input: ExplainabilityInput): AmbiguityFlag[] {
  const flags: AmbiguityFlag[] = [];
  const conflictFlags = input.phase3.conflictFlags ?? [];

  const add = (type: AmbiguityType) => {
    const meta = AMBIGUITY_META[type];
    flags.push({ type, description: meta.description, reviewAction: meta.reviewAction });
  };

  if (conflictFlags.includes('AR_REVENUE_AMBIGUITY'))          add('AR_VS_REVENUE');
  if (conflictFlags.includes('AP_EXPENSE_AMBIGUITY'))          add('AP_VS_EXPENSE');
  if (conflictFlags.includes('INTERNAL_TRANSFER_UNVERIFIED'))  add('INTERNAL_TRANSFER');
  if (conflictFlags.includes('UNKNOWN_INTENT') ||
      input.phase3.intent === 'UNKNOWN')                       add('UNKNOWN_INTENT');
  if (conflictFlags.includes('MULTIPLE_CLOSE_CANDIDATES'))     add('MULTIPLE_CLOSE_CANDIDATES');

  // Weak evidence: no historical, no keyword, no counterparty
  const evidence = input.phase3.evidence ?? [];
  const hasStrong =
    evidence.some((e) => e.type === 'HISTORICAL_APPROVED') ||
    evidence.some((e) => e.type === 'INTENT_KEYWORD') ||
    evidence.some((e) => e.type === 'KEYWORD_ALIAS') ||
    evidence.some((e) => e.type === 'COUNTERPARTY');
  if (!hasStrong) add('WEAK_EVIDENCE');

  if (conflictFlags.includes('CROSS_COMPANY_ACCOUNT'))  add('CROSS_COMPANY');
  if (conflictFlags.includes('INACTIVE_ACCOUNT'))       add('INACTIVE_ACCOUNT');
  if (conflictFlags.includes('NON_POSTABLE_ACCOUNT'))   add('NON_POSTABLE_ACCOUNT');

  return flags;
}

// ─── Accounting warnings ──────────────────────────────────────────────────────

/**
 * Build accounting-specific warnings from Phase 3 output.
 */
export function buildAccountingWarnings(input: ExplainabilityInput): string[] {
  const warnings: string[] = [];
  const { phase3 } = input;
  const conflictFlags = phase3.conflictFlags ?? [];

  if (!phase3.primaryRecommendation) {
    warnings.push('No COA account could be recommended — manual account selection required.');
  }

  if (conflictFlags.includes('AR_REVENUE_AMBIGUITY')) {
    warnings.push(
      'AR/Revenue conflict: CUSTOMER_PAYMENT is mapped to a revenue account. ' +
      'Consider using a receivable (AR) account instead to maintain proper double-entry integrity.',
    );
  }

  if (conflictFlags.includes('AP_EXPENSE_AMBIGUITY')) {
    warnings.push(
      'AP/Expense conflict: VENDOR_PAYMENT is mapped to an expense account. ' +
      'Consider using a payable (AP) account to properly record the liability.',
    );
  }

  if (conflictFlags.includes('MULTIPLE_CLOSE_CANDIDATES')) {
    const top2 = phase3.primaryRecommendation?.confidence ?? 0;
    warnings.push(
      `Multiple accounts have similar confidence (top: ${top2.toFixed(3)}). ` +
      'Review alternatives before posting.',
    );
  }

  if (phase3.intent === 'UNKNOWN') {
    warnings.push(
      'Intent is UNKNOWN — the COA prediction reliability is significantly reduced. ' +
      'Manual classification required.',
    );
  }

  if (conflictFlags.includes('INTERNAL_TRANSFER_UNVERIFIED')) {
    warnings.push(
      'Internal Transfer detected but counterparty account ownership is unverified. ' +
      'Confirm both accounts belong to the same company.',
    );
  }

  return warnings;
}

// ─── Audit summary ────────────────────────────────────────────────────────────

/**
 * Build a single human-readable audit summary sentence.
 *
 * Example:
 * "AI merekomendasikan akun 1-1100 Piutang Usaha dengan confidence HIGH (0.91).
 *  Evidence utama berasal dari historical mapping, intent CUSTOMER_PAYMENT,
 *  dan counterparty PT ABC."
 */
export function buildAuditSummary(
  input: ExplainabilityInput,
  confidence: ExplainabilityConfidence,
  status: RecommendationStatus,
): string {
  const { phase3 } = input;
  const primary = phase3.primaryRecommendation;
  const intent  = phase3.intent ?? input.phase2.primaryIntent;

  // Evidence sources
  const evidence = phase3.evidence ?? [];
  const evidenceSources: string[] = [];
  if (evidence.some((e) => e.type === 'HISTORICAL_APPROVED' || e.type === 'HISTORICAL_USAGE')) {
    evidenceSources.push('historical mapping');
  }
  if (evidence.some((e) => e.type === 'INTENT_KEYWORD')) {
    evidenceSources.push(`intent ${intent}`);
  }
  if (evidence.some((e) => e.type === 'KEYWORD_ALIAS')) {
    evidenceSources.push('keyword/alias match');
  }
  const cpEvidence = input.phase2.evidence?.find((e) => e.type === 'COUNTERPARTY');
  if (cpEvidence?.value) {
    evidenceSources.push(`counterparty ${cpEvidence.value}`);
  }
  if (evidenceSources.length === 0) {
    evidenceSources.push('weak/indirect signals only');
  }

  const desc = input.rawDescription ?? input.phase1.normalizedDescription ?? 'transaksi';

  if (!primary) {
    return (
      `AI tidak dapat merekomendasikan akun COA untuk transaksi "${desc}" ` +
      `(intent: ${intent}, status: ${status}). ` +
      `Confidence: ${confidence.level} (${confidence.normalized.toFixed(3)}). ` +
      `Diperlukan seleksi akun manual.`
    );
  }

  const evidenceStr = evidenceSources.length > 0
    ? evidenceSources.join(', ')
    : 'analisis AI';

  return (
    `AI merekomendasikan akun ${primary.coaCode} ${primary.coaName} ` +
    `dengan confidence ${confidence.level} (${confidence.normalized.toFixed(3)}). ` +
    `Status: ${status}. ` +
    `Evidence utama berasal dari ${evidenceStr}. ` +
    `Intent terdeteksi: ${intent}.`
  );
}

// ─── Reviewer notes ───────────────────────────────────────────────────────────

/**
 * Build structured reviewer notes for finance reviewers and auditors.
 */
export function buildReviewerNotes(
  input: ExplainabilityInput,
  confidence: ExplainabilityConfidence,
  status: RecommendationStatus,
  ambiguity: AmbiguityFlag[],
): string[] {
  const notes: string[] = [];
  const { phase3 } = input;

  // Confidence note
  notes.push(
    `Confidence: ${confidence.level} (${confidence.normalized.toFixed(3)}) — ` +
    (confidence.normalized >= 0.85
      ? 'AI prediction is reliable. Standard review applies.'
      : confidence.normalized >= 0.70
        ? 'Moderate confidence. Verify account selection before posting.'
        : 'Low confidence. Manual verification strongly recommended.'),
  );

  // Status note
  if (status === 'REJECT') {
    notes.push(
      'REJECT: The AI recommendation should NOT be used. No eligible account found or hard safety rules violated.',
    );
  } else if (status === 'MANUAL_REVIEW') {
    notes.push(
      'MANUAL REVIEW required: ambiguity, low confidence, or conflict flags present. Do not auto-post.',
    );
  } else {
    notes.push('SAFE: AI recommendation may be used with standard approval workflow.');
  }

  // Alternatives note
  if (phase3.alternatives && phase3.alternatives.length > 0) {
    const altList = phase3.alternatives
      .slice(0, 3)
      .map((a) => `${a.coaCode} (${a.confidence.toFixed(3)})`)
      .join(', ');
    notes.push(`Alternative accounts considered: ${altList}.`);
  }

  // Ambiguity notes
  for (const flag of ambiguity) {
    notes.push(`[${flag.type}] ${flag.reviewAction}`);
  }

  // Phase 1/2 disagreement
  if (input.phase1.intent !== input.phase2.primaryIntent && input.phase1.intent !== 'UNKNOWN') {
    notes.push(
      `Phase 1 intent (${input.phase1.intent}) disagrees with Phase 2 (${input.phase2.primaryIntent}). ` +
      'Phase 2 takes precedence. Verify description context.',
    );
  }

  return notes;
}
