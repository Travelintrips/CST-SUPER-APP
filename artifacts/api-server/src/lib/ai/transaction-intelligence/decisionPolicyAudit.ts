/**
 * AI Transaction Intelligence — Phase 9
 * Decision Policy Engine — Audit Trail Builder
 *
 * Every decision must be fully explainable: why, which rule fired, which override applied.
 * Pure function, no side effects.
 */

import type {
  DecisionPolicyInput,
  DecisionPolicyResult,
  DecisionPolicyAuditRecord,
} from './decisionPolicyTypes.js';

// ─── Build audit record ───────────────────────────────────────────────────────

export function buildDecisionAuditRecord(
  input: DecisionPolicyInput,
  result: DecisionPolicyResult,
): DecisionPolicyAuditRecord {
  return {
    transactionId: input.transaction.id,
    companyId: input.companyId,
    evaluatedAt: result.evaluatedAt,
    policyVersion: result.policyVersion,

    decision: {
      reviewRequired: result.reviewRequired,
      queue: result.queue,
      priority: result.priority,
      reviewerRole: result.reviewerRole,
      reviewLevel: result.reviewLevel,
      escalationRequired: result.escalation.required,
      escalationLevel: result.escalation.level,
      approvalRequired: result.approvalRequirement.required,
      approvalLevel: result.approvalRequirement.level,
      hold: result.holdRecommendation.hold,
    },

    why: result.policyReason,
    rulesFireds: result.firedRules,
    overridesApplied: result.appliedOverrides,

    inputSummary: {
      intent: input.phase2.primaryIntent,
      intentConfidence: input.phase2.confidence,
      anomalyScore: input.phase7.anomalyScore,
      anomalyRisk: input.phase7.riskLevel,
      amount: input.transaction.amount,
      currency: input.transaction.currency,
      conflictFlags: input.phase7.conflictFlags ?? [],
      requiresManualReviewUpstream:
        input.phase2.requiresManualReview ||
        input.phase7.requiresManualReview ||
        (input.phase4.recommendation as unknown as { requiresReview?: boolean })?.requiresReview === true,
    },
  };
}

// ─── Format audit for human display ──────────────────────────────────────────

export function formatAuditSummary(record: DecisionPolicyAuditRecord): string {
  const lines: string[] = [
    `=== Phase 9 Decision Audit ===`,
    `Transaction: ${record.transactionId ?? 'N/A'} | Company: ${record.companyId}`,
    `Evaluated: ${record.evaluatedAt} | Policy: ${record.policyVersion}`,
    ``,
    `--- Decision ---`,
    `  Review Required : ${record.decision.reviewRequired}`,
    `  Queue           : ${record.decision.queue}`,
    `  Priority        : ${record.decision.priority}`,
    `  Reviewer Role   : ${record.decision.reviewerRole}`,
    `  Review Level    : ${record.decision.reviewLevel}`,
    `  Escalation      : ${record.decision.escalationRequired ? record.decision.escalationLevel : 'none'}`,
    `  Approval        : ${record.decision.approvalRequired ? record.decision.approvalLevel : 'none'}`,
    `  Hold            : ${record.decision.hold}`,
    ``,
    `--- Input Summary ---`,
    `  Intent          : ${record.inputSummary.intent} (confidence: ${(record.inputSummary.intentConfidence * 100).toFixed(1)}%)`,
    `  Anomaly Score   : ${record.inputSummary.anomalyScore.toFixed(3)} (risk: ${record.inputSummary.anomalyRisk})`,
    `  Amount          : ${record.inputSummary.amount.toLocaleString()} ${record.inputSummary.currency ?? ''}`,
    `  Upstream Manual : ${record.inputSummary.requiresManualReviewUpstream}`,
    ``,
    `--- Why This Decision ---`,
    ...record.why.map((r) => `  • ${r}`),
    ``,
    `--- Rules Fired (${record.rulesFireds.length}) ---`,
    ...record.rulesFireds.map((r) => `  [${r.ruleId}] ${r.description} → ${r.effect}`),
  ];

  if (record.overridesApplied.length > 0) {
    lines.push(``, `--- Overrides Applied (${record.overridesApplied.length}) ---`);
    for (const o of record.overridesApplied) {
      lines.push(`  [${o.dimension}/${o.matchKey}] ${o.reason} (fields: ${o.fieldsChanged.join(', ')})`);
    }
  }

  lines.push(``, `=== End Audit ===`);
  return lines.join('\n');
}

// ─── Verify audit completeness ────────────────────────────────────────────────

export interface AuditVerificationResult {
  complete: boolean;
  issues: string[];
}

export function verifyAuditCompleteness(
  record: DecisionPolicyAuditRecord,
): AuditVerificationResult {
  const issues: string[] = [];

  if (!record.evaluatedAt) issues.push('Missing evaluatedAt.');
  if (!record.policyVersion) issues.push('Missing policyVersion.');
  if (record.why.length === 0) issues.push('No policy reasons recorded (why is empty).');
  if (record.rulesFireds.length === 0) issues.push('No rules fired — may indicate a pass-through with no evaluation.');
  if (record.decision.reviewRequired && record.decision.queue === 'AUTO_CLEAR_CANDIDATE') {
    issues.push('reviewRequired=true but queue is AUTO_CLEAR_CANDIDATE — inconsistency.');
  }
  if (record.decision.escalationRequired && record.decision.escalationLevel === 'NONE') {
    issues.push('escalationRequired=true but escalationLevel is NONE — inconsistency.');
  }
  if (record.decision.approvalRequired && record.decision.approvalLevel === 'NONE') {
    issues.push('approvalRequired=true but approvalLevel is NONE — inconsistency.');
  }

  return { complete: issues.length === 0, issues };
}
