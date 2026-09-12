/**
 * COA Gap Detector — Task #7 Phase 2
 *
 * Pure engine. No DB access. No side effects. Deterministic.
 * Company-isolated via input — never accesses DB directly.
 *
 * Detects whether a specific COA account is missing for a given
 * transaction context, and whether a COA proposal should be created.
 */

// ── Types ─────────────────────────────────────────────────────────────────────

export type GapType =
  | "NO_SPECIFIC_ACCOUNT"
  | "AMBIGUOUS_MAPPING"
  | "INACTIVE_ACCOUNT_ONLY"
  | "NON_POSTABLE_ACCOUNT_ONLY"
  | "INVALID_HIERARCHY"
  | "UNKNOWN";

export interface CandidateAccount {
  id: number;
  code: string;
  name: string;
  isActive: boolean;
  isPostable: boolean;
  isHeader: boolean;
  status: string;
  companyId: number | null;
  accountCategory: string;
}

export interface HistoricalMapping {
  intent: string;
  accountId: number;
  accountCode: string;
  accountName: string;
  occurrences: number;
  lastUsed: string;
}

export interface GapDetectionInput {
  companyId: number;
  transaction?: {
    id?: number;
    amount?: number;
    description?: string;
    date?: string;
    sourceType?: string;
  };
  detectedIntent: string;
  normalizedDescription: string;
  aiConfidence: number;       // 0–100
  missingMappingType?: string;
  /** Mapping error code from Task #6 (e.g. SPECIFIC_COA_REQUIRED) */
  mappingErrorCode?: string;
  candidateAccounts: CandidateAccount[];
  historicalMappings: HistoricalMapping[];
  existingAccounts: CandidateAccount[];
  reviewerContext?: {
    sourceModule?: string;
    moduleRecordId?: string;
    reviewCaseId?: number;
  };
}

export interface GapDetectionResult {
  gapDetected: boolean;
  gapType: GapType;
  shouldCreateProposal: boolean;
  reason: string[];
  evidence: Array<{
    type: string;
    description: string;
    data?: unknown;
  }>;
  confidence: number;
}

// ── Mapping error codes that always indicate a gap ───────────────────────────

const GAP_TRIGGERING_CODES = new Set([
  "SPECIFIC_COA_REQUIRED",
  "JOURNAL_MAPPING_REQUIRED",
  "COA_NOT_FOUND",
  "COA_MAPPING_AMBIGUOUS",
]);

// ── Main engine ───────────────────────────────────────────────────────────────

/**
 * Detect whether a COA gap exists for the given transaction context.
 *
 * Pure function — deterministic, no I/O, no DB access, immutable inputs.
 * Company isolation is caller's responsibility (pass only company-scoped data).
 */
export function detectCoaGap(input: GapDetectionInput): GapDetectionResult {
  const {
    detectedIntent,
    missingMappingType,
    mappingErrorCode,
    candidateAccounts,
    historicalMappings,
    aiConfidence,
  } = input;

  const reasons: string[] = [];
  const evidence: GapDetectionResult["evidence"] = [];

  // ── Step 1: Explicit mapping error from Task #6 ───────────────────────────

  if (mappingErrorCode && GAP_TRIGGERING_CODES.has(mappingErrorCode)) {
    reasons.push(
      `Task #6 returned mapping error: ${mappingErrorCode} — specific COA required.`,
    );
    evidence.push({
      type: "MAPPING_ERROR",
      description: `Backend mapping failure: ${mappingErrorCode}`,
      data: { mappingErrorCode, missingMappingType },
    });
  }

  // ── Step 2: No candidates at all ─────────────────────────────────────────

  if (candidateAccounts.length === 0) {
    reasons.push(
      `No candidate accounts found for intent "${detectedIntent}".`,
    );
    evidence.push({
      type: "NO_CANDIDATES",
      description: "Zero matching accounts returned for this intent.",
    });

    return {
      gapDetected: true,
      gapType: "NO_SPECIFIC_ACCOUNT",
      shouldCreateProposal: true,
      reason: reasons,
      evidence,
      confidence: Math.min(aiConfidence, 85),
    };
  }

  // ── Step 3: All candidates are inactive ──────────────────────────────────

  const activeCandidates = candidateAccounts.filter((a) => a.isActive && a.status === "ACTIVE");
  if (activeCandidates.length === 0) {
    reasons.push(
      "All candidate accounts are inactive or archived. Specific active account needed.",
    );
    evidence.push({
      type: "INACTIVE_ACCOUNTS",
      description: `${candidateAccounts.length} candidate(s) found but none are ACTIVE.`,
      data: { candidates: candidateAccounts.map((a) => ({ code: a.code, status: a.status })) },
    });

    return {
      gapDetected: true,
      gapType: "INACTIVE_ACCOUNT_ONLY",
      shouldCreateProposal: true,
      reason: reasons,
      evidence,
      confidence: Math.min(aiConfidence, 80),
    };
  }

  // ── Step 4: All active candidates are non-postable ───────────────────────

  const postableCandidates = activeCandidates.filter((a) => a.isPostable && !a.isHeader);
  if (postableCandidates.length === 0) {
    reasons.push(
      "All active candidates are header accounts (non-postable). A postable leaf account is required.",
    );
    evidence.push({
      type: "NON_POSTABLE_ACCOUNTS",
      description: `${activeCandidates.length} active candidate(s) but all are header/non-postable.`,
      data: { candidates: activeCandidates.map((a) => ({ code: a.code, isHeader: a.isHeader })) },
    });

    return {
      gapDetected: true,
      gapType: "NON_POSTABLE_ACCOUNT_ONLY",
      shouldCreateProposal: true,
      reason: reasons,
      evidence,
      confidence: Math.min(aiConfidence, 80),
    };
  }

  // ── Step 5: Ambiguous mapping — multiple equally-likely candidates ────────

  if (postableCandidates.length >= 3 && mappingErrorCode === "COA_MAPPING_AMBIGUOUS") {
    reasons.push(
      `${postableCandidates.length} postable candidates found but mapping is ambiguous — specific account required.`,
    );
    evidence.push({
      type: "AMBIGUOUS_CANDIDATES",
      description: "Multiple plausible accounts; manual disambiguation required.",
      data: { candidates: postableCandidates.map((a) => ({ id: a.id, code: a.code, name: a.name })) },
    });

    return {
      gapDetected: true,
      gapType: "AMBIGUOUS_MAPPING",
      shouldCreateProposal: true,
      reason: reasons,
      evidence,
      confidence: Math.min(aiConfidence, 70),
    };
  }

  // ── Step 6: Historical mapping suggests a more specific account is needed ─

  const matchingHistory = historicalMappings.filter(
    (h) => h.intent === detectedIntent && h.occurrences >= 3,
  );
  if (mappingErrorCode && GAP_TRIGGERING_CODES.has(mappingErrorCode) && matchingHistory.length === 0) {
    reasons.push(
      `No historical mapping found for intent "${detectedIntent}" with sufficient occurrences.`,
    );
    evidence.push({
      type: "NO_HISTORY",
      description: "No established mapping pattern — new specific account may be needed.",
    });

    return {
      gapDetected: true,
      gapType: "NO_SPECIFIC_ACCOUNT",
      shouldCreateProposal: true,
      reason: reasons,
      evidence,
      confidence: Math.min(aiConfidence, 75),
    };
  }

  // ── Step 7: No gap detected — suitable postable accounts exist ────────────

  if (reasons.length === 0) {
    return {
      gapDetected: false,
      gapType: "UNKNOWN",
      shouldCreateProposal: false,
      reason: [
        `${postableCandidates.length} postable account(s) available for intent "${detectedIntent}". No gap detected.`,
      ],
      evidence: [
        {
          type: "SUITABLE_ACCOUNTS",
          description: "Postable active accounts found — no COA proposal needed.",
          data: { count: postableCandidates.length },
        },
      ],
      confidence: aiConfidence,
    };
  }

  // Fallback: gap from mapping error even with some candidates
  return {
    gapDetected: true,
    gapType: "UNKNOWN",
    shouldCreateProposal: true,
    reason: reasons,
    evidence,
    confidence: Math.min(aiConfidence, 70),
  };
}
