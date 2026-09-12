/**
 * COA Code Suggester — Task #7 Phase 8
 *
 * Pure engine. Deterministic. No Math.random(). No DB access.
 * Does NOT reserve codes — suggestion only; checker may edit.
 *
 * Algorithm:
 * 1. Detect company code pattern from siblings (prefix + numeric suffix).
 * 2. Find max sibling code number under the same parent.
 * 3. Return next available code (max+1 or max+10 depending on gap style).
 * 4. If pattern unclear → low confidence, mark manual edit required.
 */

// ── Types ─────────────────────────────────────────────────────────────────────

export interface ExistingAccountForCode {
  code: string;
  parentId: number | null;
  accountCategory: string;
  companyId: number | null;
}

export interface CodeSuggestionInput {
  companyId: number;
  proposedCategory: string;
  proposedParentId: number | null;
  existingAccounts: ExistingAccountForCode[];
}

export interface CodeSuggestionResult {
  suggestedCode: string;
  confidence: number;           // 0–100
  basis: string;
  alternatives: string[];
  manualEditRequired: boolean;
}

// ── Helpers ───────────────────────────────────────────────────────────────────

/** Extract numeric suffix from a code string. Returns null if none. */
function extractSuffix(code: string): number | null {
  const m = code.match(/(\d+)$/);
  if (!m) return null;
  return parseInt(m[1]!, 10);
}

/** Extract prefix (everything before the last numeric block). */
function extractPrefix(code: string): string {
  return code.replace(/\d+$/, "");
}

/** Pad a number to match the original width of the sibling suffix. */
function padTo(n: number, width: number): string {
  return String(n).padStart(width, "0");
}

// ── Main engine ───────────────────────────────────────────────────────────────

/**
 * Suggest a COA code for a new account based on siblings under the same parent.
 *
 * Rules:
 * - Follow company naming pattern detected from siblings
 * - No collision with existing codes
 * - Deterministic: same inputs → same output
 * - No Math.random()
 * - Does NOT directly reserve / insert the code
 * - Checker may edit the result
 */
export function suggestCoaCode(input: CodeSuggestionInput): CodeSuggestionResult {
  const { companyId, proposedParentId, existingAccounts } = input;

  // ── Find siblings (same parent, same company) ─────────────────────────────
  const siblings = existingAccounts.filter(
    (a) =>
      (a.companyId === companyId || a.companyId === null) &&
      a.parentId === proposedParentId,
  );

  const existingCodes = new Set(
    existingAccounts
      .filter((a) => a.companyId === companyId || a.companyId === null)
      .map((a) => a.code),
  );

  if (siblings.length === 0) {
    // No siblings — cannot determine pattern; mark manual
    return {
      suggestedCode: "",
      confidence: 0,
      basis: "No sibling accounts found under the proposed parent. Cannot determine code pattern.",
      alternatives: [],
      manualEditRequired: true,
    };
  }

  // ── Detect pattern from siblings ─────────────────────────────────────────
  const siblingsWithSuffix = siblings
    .map((s) => ({
      code: s.code,
      prefix: extractPrefix(s.code),
      suffix: extractSuffix(s.code),
    }))
    .filter((s) => s.suffix !== null) as Array<{ code: string; prefix: string; suffix: number }>;

  if (siblingsWithSuffix.length === 0) {
    // Siblings have no numeric suffix pattern
    return {
      suggestedCode: "",
      confidence: 20,
      basis:
        "Sibling codes have no numeric suffix. Cannot auto-suggest a code. Manual entry required.",
      alternatives: [],
      manualEditRequired: true,
    };
  }

  // ── Detect dominant prefix ────────────────────────────────────────────────
  const prefixCounts = new Map<string, number>();
  for (const s of siblingsWithSuffix) {
    prefixCounts.set(s.prefix, (prefixCounts.get(s.prefix) ?? 0) + 1);
  }
  const dominantPrefix = [...prefixCounts.entries()].sort((a, b) => b[1] - a[1])[0]?.[0];

  if (!dominantPrefix) {
    return {
      suggestedCode: "",
      confidence: 20,
      basis: "Inconsistent prefix pattern among siblings. Manual entry required.",
      alternatives: [],
      manualEditRequired: true,
    };
  }

  // Confidence in pattern drops if prefixes are mixed
  const prefixConsistency =
    (prefixCounts.get(dominantPrefix) ?? 0) / siblingsWithSuffix.length;

  // ── Find max suffix and detect width ─────────────────────────────────────
  const samePrefixSiblings = siblingsWithSuffix.filter((s) => s.prefix === dominantPrefix);
  const maxSuffix = Math.max(...samePrefixSiblings.map((s) => s.suffix));
  const sampleCode = samePrefixSiblings[0]!.code;
  const suffixWidth = (sampleCode.match(/(\d+)$/) ?? [""])[0].length;

  // ── Detect gap style (sequential +1 vs spaced +10) ───────────────────────
  const sortedSuffixes = [...new Set(samePrefixSiblings.map((s) => s.suffix))].sort((a, b) => a - b);
  let gapSize = 1;
  if (sortedSuffixes.length >= 2) {
    const gaps: number[] = [];
    for (let i = 1; i < sortedSuffixes.length; i++) {
      gaps.push(sortedSuffixes[i]! - sortedSuffixes[i - 1]!);
    }
    const medianGap = gaps.sort((a, b) => a - b)[Math.floor(gaps.length / 2)];
    gapSize = medianGap ?? 1;
  }

  // ── Suggest next code ─────────────────────────────────────────────────────
  const nextSuffix = maxSuffix + (gapSize > 1 ? gapSize : 1);
  const candidate = `${dominantPrefix}${padTo(nextSuffix, suffixWidth)}`;

  // Avoid collision
  let finalSuffix = nextSuffix;
  let finalCode = candidate;
  let maxAttempts = 20;
  while (existingCodes.has(finalCode) && maxAttempts-- > 0) {
    finalSuffix += (gapSize > 1 ? gapSize : 1);
    finalCode = `${dominantPrefix}${padTo(finalSuffix, suffixWidth)}`;
  }

  if (existingCodes.has(finalCode)) {
    return {
      suggestedCode: "",
      confidence: 0,
      basis: "Could not find an available code after collision check. Manual entry required.",
      alternatives: [],
      manualEditRequired: true,
    };
  }

  // ── Generate alternatives (±1 step from suggestion) ──────────────────────
  const alternatives: string[] = [];
  for (let delta = 1; delta <= 3; delta++) {
    const alt = `${dominantPrefix}${padTo(finalSuffix + delta * (gapSize > 1 ? gapSize : 1), suffixWidth)}`;
    if (!existingCodes.has(alt)) {
      alternatives.push(alt);
    }
  }

  const confidence = Math.round(prefixConsistency * 85);

  return {
    suggestedCode: finalCode,
    confidence,
    basis: `Pattern: prefix="${dominantPrefix}", gap=${gapSize}, max sibling suffix=${maxSuffix}. Next available: ${finalCode}.`,
    alternatives: alternatives.slice(0, 3),
    manualEditRequired: confidence < 50,
  };
}
