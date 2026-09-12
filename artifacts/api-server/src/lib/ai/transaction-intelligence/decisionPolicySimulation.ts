/**
 * AI Transaction Intelligence — Phase 9
 * Decision Policy Engine — Policy Simulation (Dry-Run)
 *
 * Runs the engine twice (before / after policy change) and reports deltas.
 * DOES NOT write to DB, post, approve, or mutate any state.
 *
 * Usage:
 *   const result = simulatePolicyChange({ baseline, modified, scenarios })
 */

import type {
  DecisionPolicyInput,
  DecisionPolicyResult,
  SimulationScenario,
  SimulationDelta,
  SimulationResult,
} from './decisionPolicyTypes.js';
import { evaluateDecisionPolicy } from './decisionPolicyEngine.js';

// ─── Diffing ──────────────────────────────────────────────────────────────────

type ScalarValue = string | number | boolean | null | undefined;

function flattenResult(r: DecisionPolicyResult): Record<string, ScalarValue> {
  return {
    reviewRequired: r.reviewRequired,
    queue: r.queue,
    priority: r.priority,
    'sla.targetMinutes': r.sla.targetMinutes,
    'sla.urgencyLabel': r.sla.urgencyLabel,
    reviewerRole: r.reviewerRole,
    reviewLevel: r.reviewLevel,
    'escalation.required': r.escalation.required,
    'escalation.level': r.escalation.level,
    'approvalRequirement.required': r.approvalRequirement.required,
    'approvalRequirement.level': r.approvalRequirement.level,
    'approvalRequirement.minApprovers': r.approvalRequirement.minApprovers,
    'holdRecommendation.hold': r.holdRecommendation.hold,
  };
}

function diffResults(
  before: DecisionPolicyResult,
  after: DecisionPolicyResult,
): SimulationDelta[] {
  const flatBefore = flattenResult(before);
  const flatAfter = flattenResult(after);
  const deltas: SimulationDelta[] = [];

  const allKeys = new Set([...Object.keys(flatBefore), ...Object.keys(flatAfter)]);
  for (const key of allKeys) {
    const bv = flatBefore[key];
    const av = flatAfter[key];
    if (bv !== av) {
      deltas.push({ field: key, before: bv, after: av });
    }
  }

  return deltas;
}

// ─── Single scenario simulation ───────────────────────────────────────────────

export async function simulateScenario(
  scenario: SimulationScenario,
  modifiedInput: DecisionPolicyInput,
): Promise<SimulationResult> {
  const before = await evaluateDecisionPolicy(scenario.input);
  const after = await evaluateDecisionPolicy(modifiedInput);
  const deltas = diffResults(before, after);

  return {
    label: scenario.label,
    before,
    after,
    deltas,
    changed: deltas.length > 0,
  };
}

// ─── Batch simulation ─────────────────────────────────────────────────────────

export interface PolicySimulationInput {
  /** Scenarios to run. Each scenario has a baseline and a modified version. */
  scenarios: Array<{
    label: string;
    baseline: DecisionPolicyInput;
    modified: DecisionPolicyInput;
  }>;
}

export interface PolicySimulationReport {
  totalScenarios: number;
  changedScenarios: number;
  unchangedScenarios: number;
  results: SimulationResult[];

  /** Summary of which fields changed most often. */
  fieldChangeSummary: Record<string, number>;

  /** Narrative summary for human consumption. */
  narrative: string[];
}

export async function runPolicySimulation(
  input: PolicySimulationInput,
): Promise<PolicySimulationReport> {
  const results: SimulationResult[] = [];

  for (const scenario of input.scenarios) {
    const before = await evaluateDecisionPolicy(scenario.baseline);
    const after = await evaluateDecisionPolicy(scenario.modified);
    const deltas = diffResults(before, after);
    results.push({
      label: scenario.label,
      before,
      after,
      deltas,
      changed: deltas.length > 0,
    });
  }

  const changed = results.filter((r) => r.changed);
  const unchanged = results.filter((r) => !r.changed);

  // Field frequency
  const fieldChangeSummary: Record<string, number> = {};
  for (const r of changed) {
    for (const d of r.deltas) {
      fieldChangeSummary[d.field] = (fieldChangeSummary[d.field] ?? 0) + 1;
    }
  }

  // Narrative
  const narrative: string[] = [];
  narrative.push(
    `Simulation ran ${results.length} scenario(s): ${changed.length} changed, ${unchanged.length} unchanged.`,
  );
  if (changed.length > 0) {
    narrative.push('Changed scenarios:');
    for (const r of changed) {
      const fieldList = r.deltas.map((d) => `${d.field}: ${String(d.before)} → ${String(d.after)}`).join('; ');
      narrative.push(`  • "${r.label}": ${fieldList}`);
    }
  }
  if (Object.keys(fieldChangeSummary).length > 0) {
    const topField = Object.entries(fieldChangeSummary).sort((a, b) => b[1] - a[1])[0];
    if (topField) {
      narrative.push(`Most impacted field: "${topField[0]}" changed in ${topField[1]} scenario(s).`);
    }
  }

  return {
    totalScenarios: results.length,
    changedScenarios: changed.length,
    unchangedScenarios: unchanged.length,
    results,
    fieldChangeSummary,
    narrative,
  };
}
