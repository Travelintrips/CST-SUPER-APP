/**
 * COA Parent Account Suggester — Task #7 Phase 9
 *
 * Pure engine. No DB access. Deterministic.
 *
 * Rules:
 * - Parent must be in the same company (or global)
 * - Parent category must be compatible with child category
 * - Parent must be ACTIVE
 * - Parent must be header (non-postable)
 * - Must not form a cycle (caller must ensure acyclic tree)
 * - Follows Task #5 hierarchy validation
 *
 * If no suitable parent:
 * - Proposal can still be created as DRAFT root account
 * - parentRequired = true signals checker to provide parent manually
 */

import { isParentCategoryCompatible, type CoaAccountCategory } from "../../coa/coaValidation.js";

// ── Types ─────────────────────────────────────────────────────────────────────

export interface AccountForParent {
  id: number;
  code: string;
  name: string;
  accountCategory: CoaAccountCategory;
  isActive: boolean;
  isHeader: boolean;
  isPostable: boolean;
  status: string;
  parentId: number | null;
  companyId: number | null;
}

export interface ParentSuggestionInput {
  companyId: number;
  proposedCategory: CoaAccountCategory;
  /** All existing accounts scoped to company (include global/null companyId) */
  existingAccounts: AccountForParent[];
  /** Code hint (e.g. detected prefix) to narrow candidates */
  codeHint?: string;
}

export interface ParentSuggestionResult {
  suggestedParentId: number | null;
  suggestedParentCode: string | null;
  suggestedParentName: string | null;
  confidence: number;    // 0–100
  basis: string;
  parentRequired: boolean;   // true if no valid parent found (proposal must be root or checker provides parent)
  alternatives: Array<{ id: number; code: string; name: string; category: CoaAccountCategory }>;
}

// ── Main engine ───────────────────────────────────────────────────────────────

/**
 * Suggest the best parent account for a proposed new COA entry.
 *
 * Pure function — deterministic, no I/O.
 */
export function suggestParentAccount(input: ParentSuggestionInput): ParentSuggestionResult {
  const { companyId, proposedCategory, existingAccounts, codeHint } = input;

  // ── Find candidate parents ─────────────────────────────────────────────
  const candidateParents = existingAccounts.filter((a) => {
    // Must be same company or global
    if (a.companyId !== null && a.companyId !== companyId) return false;
    // Must be ACTIVE
    if (!a.isActive || a.status !== "ACTIVE") return false;
    // Must be header (non-postable)
    if (!a.isHeader || a.isPostable) return false;
    // Category must be compatible
    if (!isParentCategoryCompatible(a.accountCategory, proposedCategory)) return false;
    return true;
  });

  if (candidateParents.length === 0) {
    return {
      suggestedParentId: null,
      suggestedParentCode: null,
      suggestedParentName: null,
      confidence: 0,
      basis: `No active header account with compatible category found for ${proposedCategory}.`,
      parentRequired: true,
      alternatives: [],
    };
  }

  // ── Sort: prefer company-specific over global, then by code proximity ─────
  const scored = candidateParents.map((a) => {
    let score = 0;
    // Prefer company-specific accounts
    if (a.companyId === companyId) score += 30;
    // Code prefix match bonus
    if (codeHint && a.code.startsWith(codeHint.substring(0, Math.min(codeHint.length - 2, 4)))) {
      score += 20;
    }
    // Prefer shorter codes (closer to root → better parent)
    score -= a.code.length;
    return { account: a, score };
  });

  scored.sort((a, b) => b.score - a.score);

  const best = scored[0]!.account;
  const alternatives = scored
    .slice(1, 4)
    .map((s) => ({
      id: s.account.id,
      code: s.account.code,
      name: s.account.name,
      category: s.account.accountCategory,
    }));

  const confidence = scored[0]!.score >= 40 ? 80 : scored[0]!.score >= 20 ? 65 : 50;

  return {
    suggestedParentId: best.id,
    suggestedParentCode: best.code,
    suggestedParentName: best.name,
    confidence,
    basis: `Best compatible header account: "${best.code} ${best.name}" (category: ${best.accountCategory}).`,
    parentRequired: false,
    alternatives,
  };
}
