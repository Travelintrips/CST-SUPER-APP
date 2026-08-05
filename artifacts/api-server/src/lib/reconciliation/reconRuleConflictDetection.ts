/**
 * Recon Rule Conflict Detection
 *
 * When creating or updating a rule, check all active rules for the same company.
 * If two rules can match the same mutation, return a warning.
 *
 * Rules:
 *  - Conflict = two rules where condition_field overlaps AND conditions could
 *    both evaluate to true for some common input.
 *  - Jangan menolak save — hanya kembalikan warning.
 *  - Priority winner: rule with higher priority (or lower id on tie).
 *
 * Algorithm:
 *  1. For same condition_field, any two text operators can overlap unless
 *     one is "equals" and the values are provably different.
 *  2. For amount, numeric ranges that share any overlap conflict.
 *  3. Direction mismatch (one IN, one OUT) → never conflict.
 *  4. bank_account_id mismatch (both non-null and different) → never conflict.
 */

import type { ReconRule, ConditionField, ConditionOperator } from "./reconRuleEngine.js";

// ─── Types ─────────────────────────────────────────────────────────────────────

export interface ConflictWarning {
  conflictingRuleId: number;
  conflictingRuleName: string;
  priorityWinnerId: number;
  priorityWinnerName: string;
  overlapDescription: string;
  estimatedOverlapPct: number; // rough heuristic, 0-100
}

export interface ConflictDetectionResult {
  hasConflicts: boolean;
  conflicts: ConflictWarning[];
}

// ─── Main ──────────────────────────────────────────────────────────────────────

/**
 * Detect conflicts between `candidate` and all `existingRules`.
 * The candidate does not need to be persisted yet.
 */
export function detectRuleConflicts(
  candidate: Partial<ReconRule> & {
    conditionField: ConditionField;
    conditionOperator: ConditionOperator;
    conditionValue: string;
    direction?: "IN" | "OUT" | null;
    bankAccountId?: number | null;
    priority?: number;
    id?: number;
    name?: string;
  },
  existingRules: ReconRule[],
): ConflictDetectionResult {
  const conflicts: ConflictWarning[] = [];

  for (const existing of existingRules) {
    // Skip same rule (when updating)
    if (candidate.id !== undefined && existing.id === candidate.id) continue;

    // Skip inactive rules
    if (!existing.isActive) continue;

    // Direction mismatch → no conflict
    const cDir = candidate.direction ?? null;
    const eDir = existing.direction ?? null;
    if (cDir !== null && eDir !== null && cDir !== eDir) continue;

    // Bank account mismatch → no conflict
    const cBank = candidate.bankAccountId ?? null;
    const eBank = existing.bankAccountId ?? null;
    if (cBank !== null && eBank !== null && cBank !== eBank) continue;

    // Field must match for overlap
    if (existing.conditionField !== candidate.conditionField) continue;

    const overlap = checkOperatorOverlap(
      candidate.conditionField,
      candidate.conditionOperator,
      candidate.conditionValue,
      existing.conditionOperator,
      existing.conditionValue,
    );

    if (overlap.overlaps) {
      const cPriority = candidate.priority ?? 100;
      const ePriority = existing.priority ?? 100;
      const cId = candidate.id ?? -1;

      let winnerId: number;
      let winnerName: string;
      if (cPriority > ePriority || (cPriority === ePriority && cId < existing.id)) {
        winnerId = cId >= 0 ? cId : -1;
        winnerName = candidate.name ?? "(new rule)";
      } else {
        winnerId = existing.id;
        winnerName = existing.name;
      }

      conflicts.push({
        conflictingRuleId: existing.id,
        conflictingRuleName: existing.name,
        priorityWinnerId: winnerId,
        priorityWinnerName: winnerName,
        overlapDescription: overlap.description,
        estimatedOverlapPct: overlap.overlapPct,
      });
    }
  }

  return { hasConflicts: conflicts.length > 0, conflicts };
}

// ─── Overlap Heuristics ────────────────────────────────────────────────────────

interface OverlapResult {
  overlaps: boolean;
  description: string;
  overlapPct: number;
}

function checkOperatorOverlap(
  field: ConditionField,
  opA: ConditionOperator,
  valA: string,
  opB: ConditionOperator,
  valB: string,
): OverlapResult {
  if (field === "amount") {
    return checkNumericOverlap(opA, valA, opB, valB);
  }
  return checkTextOverlap(opA, valA, opB, valB);
}

function checkTextOverlap(
  opA: ConditionOperator,
  valA: string,
  opB: ConditionOperator,
  valB: string,
): OverlapResult {
  // Both equals → only overlap if values are the same
  if (opA === "equals" && opB === "equals") {
    const same = valA.toLowerCase() === valB.toLowerCase();
    return {
      overlaps: same,
      description: same ? `Kedua rule mencocokkan nilai "${valA}" secara eksak` : "",
      overlapPct: same ? 100 : 0,
    };
  }

  // One equals, one contains/starts/ends/regex
  if (opA === "equals") {
    const dominated = couldBeSubsumed(valA, opB, valB);
    return { overlaps: dominated, description: dominated ? `"${valA}" bisa cocok dengan kondisi ${opB}:"${valB}"` : "", overlapPct: dominated ? 60 : 0 };
  }
  if (opB === "equals") {
    const dominated = couldBeSubsumed(valB, opA, valA);
    return { overlaps: dominated, description: dominated ? `"${valB}" bisa cocok dengan kondisi ${opA}:"${valA}"` : "", overlapPct: dominated ? 60 : 0 };
  }

  // Two broad operators (contains, starts_with, ends_with, regex) — likely overlap
  // Conservative: assume overlap unless provably impossible
  const broadOps = new Set<ConditionOperator>(["contains", "starts_with", "ends_with", "regex"]);
  if (broadOps.has(opA) && broadOps.has(opB)) {
    // If contains+contains, check if one value contains the other (high overlap)
    if (opA === "contains" && opB === "contains") {
      const aInB = valB.toLowerCase().includes(valA.toLowerCase());
      const bInA = valA.toLowerCase().includes(valB.toLowerCase());
      const pct = aInB || bInA ? 90 : 70;
      return {
        overlaps: true,
        description: `Rule A memeriksa "${valA}" (${opA}), Rule B memeriksa "${valB}" (${opB}) — mutasi dengan kedua kata dapat cocok`,
        overlapPct: pct,
      };
    }
    return {
      overlaps: true,
      description: `Rule A (${opA}:"${valA}") dan Rule B (${opB}:"${valB}") keduanya menggunakan operator teks lebar — kemungkinan overlap`,
      overlapPct: 50,
    };
  }

  return { overlaps: false, description: "", overlapPct: 0 };
}

function couldBeSubsumed(exactVal: string, op: ConditionOperator, opVal: string): boolean {
  const ev = exactVal.toLowerCase();
  const ov = opVal.toLowerCase();
  switch (op) {
    case "contains":    return ev.includes(ov);
    case "starts_with": return ev.startsWith(ov);
    case "ends_with":   return ev.endsWith(ov);
    case "regex": {
      try { return new RegExp(ov, "i").test(ev); } catch { return false; }
    }
    default: return false;
  }
}

function checkNumericOverlap(
  opA: ConditionOperator,
  valA: string,
  opB: ConditionOperator,
  valB: string,
): OverlapResult {
  const rangeA = parseNumericRange(opA, valA);
  const rangeB = parseNumericRange(opB, valB);
  if (!rangeA || !rangeB) {
    return { overlaps: false, description: "", overlapPct: 0 };
  }

  // Ranges overlap if A.min < B.max AND B.min < A.max
  const overlaps = rangeA.min < rangeB.max && rangeB.min < rangeA.max;
  return {
    overlaps,
    description: overlaps
      ? `Rentang jumlah [${rangeA.min}–${rangeA.max}] dan [${rangeB.min}–${rangeB.max}] beririsan`
      : "",
    overlapPct: overlaps ? 40 : 0,
  };
}

function parseNumericRange(
  op: ConditionOperator,
  val: string,
): { min: number; max: number } | null {
  const INF = 1e15;
  switch (op) {
    case "equals": {
      const n = parseFloat(val);
      return isNaN(n) ? null : { min: n, max: n };
    }
    case "greater_than": {
      const n = parseFloat(val);
      return isNaN(n) ? null : { min: n, max: INF };
    }
    case "less_than": {
      const n = parseFloat(val);
      return isNaN(n) ? null : { min: -INF, max: n };
    }
    case "between": {
      const parts = val.split(",");
      if (parts.length !== 2) return null;
      const lo = parseFloat(parts[0]);
      const hi = parseFloat(parts[1]);
      return isNaN(lo) || isNaN(hi) ? null : { min: lo, max: hi };
    }
    default:
      return null;
  }
}
