/**
 * COA Proposal Duplicate Detector — Task #7 Phase 11
 *
 * Pure engine. Deterministic. No DB access.
 * Detects duplicate/similar proposals before a new one is created.
 *
 * Duplicate classification:
 *   EXACT_DUPLICATE       — same company, same fingerprint or idempotency key
 *   POSSIBLE_DUPLICATE    — very similar name/intent/parent/category
 *   SIMILAR_EXISTING_COA  — an existing active COA already covers this intent
 *   NO_DUPLICATE          — safe to proceed
 */

import { type CoaAccountCategory } from "../../coa/coaValidation.js";

// ── Types ─────────────────────────────────────────────────────────────────────

export type DuplicateCheckResult =
  | "EXACT_DUPLICATE"
  | "POSSIBLE_DUPLICATE"
  | "SIMILAR_EXISTING_COA"
  | "NO_DUPLICATE";

export interface ExistingProposalForDuplicate {
  id: number;
  proposalNumber: string;
  proposedName: string;
  proposedCode: string;
  proposedCategory: CoaAccountCategory;
  proposedParentId: number | null;
  detectedIntent: string | null;
  status: string;
  idempotencyKey: string;
  requestFingerprint: string | null;
  companyId: number;
}

export interface ExistingAccountForDuplicate {
  id: number;
  code: string;
  name: string;
  accountCategory: CoaAccountCategory;
  isActive: boolean;
  isPostable: boolean;
  status: string;
  companyId: number | null;
}

export interface DuplicateCheckInput {
  companyId: number;
  proposedName: string;
  normalizedName: string;
  detectedIntent: string;
  proposedParentId: number | null;
  proposedCategory: CoaAccountCategory;
  idempotencyKey: string;
  requestFingerprint?: string;
  existingProposals: ExistingProposalForDuplicate[];
  existingAccounts: ExistingAccountForDuplicate[];
}

export interface DuplicateCheckOutput {
  result: DuplicateCheckResult;
  reason: string;
  existingProposalId?: number;
  existingProposalNumber?: string;
  existingAccountId?: number;
  existingAccountCode?: string;
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function normalize(s: string): string {
  return s
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/** Returns true if tokens are considered matching (exact or prefix overlap ≥ 4 chars). */
function tokensMatch(t1: string, t2: string): boolean {
  if (t1 === t2) return true;
  const [shorter, longer] = t1.length <= t2.length ? [t1, t2] : [t2, t1];
  // prefix match: e.g. "admin" matches "administrasi"
  return shorter.length >= 4 && longer.startsWith(shorter);
}

/** Token overlap similarity (0–1) with prefix matching for abbreviations. */
function tokenSimilarity(a: string, b: string): number {
  const tokensA = normalize(a).split(" ").filter((t) => t.length > 2);
  const tokensB = normalize(b).split(" ").filter((t) => t.length > 2);
  if (tokensA.length === 0 && tokensB.length === 0) return 1;
  if (tokensA.length === 0 || tokensB.length === 0) return 0;
  // Count how many tokens in A have at least one match in B
  let matched = 0;
  for (const ta of tokensA) {
    if (tokensB.some((tb) => tokensMatch(ta, tb))) matched++;
  }
  return matched / Math.max(tokensA.length, tokensB.length);
}

const ACTIVE_PROPOSAL_STATUSES = new Set(["DRAFT", "PENDING_REVIEW", "APPROVED"]);

// ── Main engine ───────────────────────────────────────────────────────────────

/**
 * Check for duplicate proposals or similar existing COA accounts.
 *
 * Pure function — deterministic, no I/O.
 * If EXACT_DUPLICATE or POSSIBLE_DUPLICATE: do not create a second proposal.
 * If SIMILAR_EXISTING_COA: alert user; they may still proceed.
 */
export function detectDuplicateProposal(input: DuplicateCheckInput): DuplicateCheckOutput {
  const {
    companyId,
    proposedName,
    normalizedName,
    detectedIntent,
    proposedParentId,
    proposedCategory,
    idempotencyKey,
    requestFingerprint,
    existingProposals,
    existingAccounts,
  } = input;

  // ── 1. Exact idempotency key match ────────────────────────────────────────
  const exactByKey = existingProposals.find(
    (p) => p.companyId === companyId && p.idempotencyKey === idempotencyKey,
  );
  if (exactByKey) {
    return {
      result: "EXACT_DUPLICATE",
      reason: `Proposal with idempotency key "${idempotencyKey}" already exists for this company.`,
      existingProposalId: exactByKey.id,
      existingProposalNumber: exactByKey.proposalNumber,
    };
  }

  // ── 2. Exact fingerprint match ────────────────────────────────────────────
  if (requestFingerprint) {
    const exactByFp = existingProposals.find(
      (p) =>
        p.companyId === companyId &&
        p.requestFingerprint === requestFingerprint &&
        ACTIVE_PROPOSAL_STATUSES.has(p.status),
    );
    if (exactByFp) {
      return {
        result: "EXACT_DUPLICATE",
        reason: `Proposal with identical request fingerprint already exists (${exactByFp.proposalNumber}).`,
        existingProposalId: exactByFp.id,
        existingProposalNumber: exactByFp.proposalNumber,
      };
    }
  }

  // ── 3. Pending/active proposal with similar name + category + parent ──────
  const similarProposals = existingProposals.filter(
    (p) =>
      p.companyId === companyId &&
      ACTIVE_PROPOSAL_STATUSES.has(p.status) &&
      p.proposedCategory === proposedCategory &&
      p.proposedParentId === proposedParentId,
  );

  for (const sp of similarProposals) {
    const nameSim = tokenSimilarity(proposedName, sp.proposedName);
    const intentMatch = normalize(detectedIntent) === normalize(sp.detectedIntent ?? "");

    if (nameSim >= 0.85 || (nameSim >= 0.7 && intentMatch)) {
      return {
        result: "POSSIBLE_DUPLICATE",
        reason:
          `Existing proposal "${sp.proposalNumber}" (${sp.status}) has very similar name ` +
          `(similarity: ${Math.round(nameSim * 100)}%) and same category/parent.`,
        existingProposalId: sp.id,
        existingProposalNumber: sp.proposalNumber,
      };
    }
  }

  // ── 4. Similar existing ACTIVE COA ───────────────────────────────────────
  const similarAccounts = existingAccounts.filter(
    (a) =>
      (a.companyId === companyId || a.companyId === null) &&
      a.isActive &&
      a.status === "ACTIVE" &&
      a.accountCategory === proposedCategory,
  );

  for (const sa of similarAccounts) {
    const nameSim = tokenSimilarity(proposedName, sa.name);
    if (nameSim >= 0.75) {
      return {
        result: "SIMILAR_EXISTING_COA",
        reason:
          `Existing active account "${sa.code} ${sa.name}" is similar ` +
          `(similarity: ${Math.round(nameSim * 100)}%). Consider using it before creating a new one.`,
        existingAccountId: sa.id,
        existingAccountCode: sa.code,
      };
    }
  }

  // ── 5. Same normalized name ───────────────────────────────────────────────
  const sameNorm = existingAccounts.find(
    (a) =>
      (a.companyId === companyId || a.companyId === null) &&
      normalize(a.name) === normalize(normalizedName) &&
      a.accountCategory === proposedCategory,
  );
  if (sameNorm) {
    return {
      result: "SIMILAR_EXISTING_COA",
      reason:
        `Account "${sameNorm.code} ${sameNorm.name}" has the same normalized name. ` +
        "Verify this is truly a different account.",
      existingAccountId: sameNorm.id,
      existingAccountCode: sameNorm.code,
    };
  }

  return {
    result: "NO_DUPLICATE",
    reason: "No duplicate proposal or similar existing account found.",
  };
}
