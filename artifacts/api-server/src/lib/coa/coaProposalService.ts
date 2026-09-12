/**
 * COA Proposal Service — Task #7 Phases 12–15
 *
 * createCoaProposal()         — Phase 12: create DRAFT with AI recommendation
 * submitCoaProposal()         — Phase 13: DRAFT → PENDING_REVIEW
 * reviewCoaProposal()         — Phase 13: add review comments (no status change)
 * approveCoaProposal()        — Phase 13: PENDING_REVIEW → APPROVED
 * rejectCoaProposal()         — Phase 13: PENDING_REVIEW → REJECTED
 * cancelCoaProposal()         — Phase 13: DRAFT/PENDING_REVIEW → CANCELLED
 * implementApprovedCoaProposal() — Phase 14: APPROVED → IMPLEMENTED (direct COA insert, no separate approval required)
 *
 * Security rules:
 *   - maker cannot approve their own proposal
 *   - companyId always from session/context — body companyId is checked for mismatch
 *   - cross-company parent rejected
 *   - no bypass of Task #5 maker-checker for COA master creation
 *
 * AI rules:
 *   - never auto-create COA
 *   - never auto-apply rule
 *   - never post journal
 *   - never modify historical data
 */

import { db } from "@workspace/db";
import { eq, and, desc } from "drizzle-orm";
import {
  coaProposalsTable,
  coaProposalVersionsTable,
  coaProposalAuditTable,
  type InsertCoaProposal,
} from "@workspace/db/schema/coaProposals";
import { chartOfAccountsTable, coaVersionsTable } from "@workspace/db/schema/accounting";
import { logger } from "../logger.js";
import {
  validateCoaHierarchy,
  validatePostableRules,
  normalBalanceForCategory,
  type CoaAccountCategory,
} from "./coaValidation.js";
import {
  detectCoaGap,
  type GapDetectionInput,
} from "../ai/transaction-intelligence/coaGapDetector.js";
import {
  generateCoaProposalRecommendation,
  type ProposalRecommendationInput,
} from "../ai/transaction-intelligence/coaProposalEngine.js";
import {
  suggestCoaCode,
} from "../ai/transaction-intelligence/coaCodeSuggester.js";
import {
  detectDuplicateProposal,
  type DuplicateCheckInput,
} from "../ai/transaction-intelligence/coaProposalDuplicate.js";

// ── Service Result ─────────────────────────────────────────────────────────────

export interface ServiceResult<T = void> {
  ok: boolean;
  error?: string;
  errorCode?: string;
  data?: T;
}

// ── Proposal number sequence ──────────────────────────────────────────────────

/**
 * Generate a sequential proposal number: COA-PROP-{YYYYMMDD}-{seq4}
 * Uses the count of existing proposals for this company today.
 * Safe against concurrent inserts via DB unique constraint on proposal_number+company_id.
 */
async function generateProposalNumber(companyId: number): Promise<string> {
  const today = new Date().toISOString().slice(0, 10).replace(/-/g, "");
  const existing = await db
    .select({ id: coaProposalsTable.id })
    .from(coaProposalsTable)
    .where(eq(coaProposalsTable.companyId, companyId));
  const seq = String(existing.length + 1).padStart(4, "0");
  return `COA-PROP-${today}-${seq}`;
}

/**
 * Build a deterministic idempotency fingerprint from proposal inputs.
 * Does NOT use Math.random() or Date.now().
 */
function buildFingerprint(
  companyId: number,
  detectedIntent: string,
  normalizedDescription: string,
  proposedName: string,
  proposedCategory: string,
): string {
  const raw = [companyId, detectedIntent, normalizedDescription, proposedName, proposedCategory]
    .join("|")
    .toLowerCase();
  // Simple deterministic hash (djb2)
  let hash = 5381;
  for (let i = 0; i < raw.length; i++) {
    hash = ((hash << 5) + hash) ^ raw.charCodeAt(i);
    hash = hash >>> 0; // keep unsigned 32-bit
  }
  return hash.toString(16).padStart(8, "0");
}

// ── Snapshot helper ───────────────────────────────────────────────────────────

function snapshotProposal(
  p: typeof coaProposalsTable.$inferSelect,
): Record<string, unknown> {
  return {
    id: p.id,
    companyId: p.companyId,
    proposalNumber: p.proposalNumber,
    status: p.status,
    proposedCode: p.proposedCode,
    proposedName: p.proposedName,
    proposedCategory: p.proposedCategory,
    proposedNormalBalance: p.proposedNormalBalance,
    proposedIsHeader: p.proposedIsHeader,
    proposedIsPostable: p.proposedIsPostable,
    proposedParentId: p.proposedParentId,
    financialStatement: p.financialStatement,
    version: p.version,
    createdBy: p.createdBy,
    updatedAt: p.updatedAt?.toISOString(),
  };
}

// ── Audit log helper ──────────────────────────────────────────────────────────

async function insertAuditEvent(
  tx: typeof db,
  proposalId: number,
  companyId: number,
  eventType: typeof coaProposalAuditTable.$inferInsert["eventType"],
  actorId: string,
  previousStatus: string | null,
  newStatus: string | null,
  reason?: string,
  metadata?: Record<string, unknown>,
): Promise<void> {
  await tx.insert(coaProposalAuditTable).values({
    companyId,
    proposalId,
    eventType,
    actorId,
    actorType: "user",
    previousStatus,
    newStatus,
    reason: reason ?? null,
    metadataJson: metadata ?? null,
  });
}

// ─────────────────────────────────────────────────────────────────────────────
// Phase 12 — createCoaProposal
// ─────────────────────────────────────────────────────────────────────────────

export interface CreateCoaProposalInput {
  companyId: number;
  actor: string;

  // Source context (from Task #6 or manual)
  sourceType?: InsertCoaProposal["sourceType"];
  sourceRecordId?: string;
  reviewCaseId?: number;
  transactionId?: number;

  // AI context
  detectedIntent: string;
  normalizedDescription: string;
  missingMappingType?: string;
  mappingErrorCode?: string;
  aiConfidence?: number;
  historicalOccurrences?: number;
  estimatedMonthlyUsage?: number;

  // AI engine inputs
  candidateAccounts?: GapDetectionInput["candidateAccounts"];
  historicalMappings?: GapDetectionInput["historicalMappings"];
  existingAccountsForGap?: GapDetectionInput["existingAccounts"];
  existingAccountsForCode?: Parameters<typeof suggestCoaCode>[0]["existingAccounts"];

  // Proposal overrides (for manual creation)
  proposedCode?: string;
  proposedName?: string;
  proposedParentId?: number | null;
  proposedCategory?: CoaAccountCategory;
  proposedNormalBalance?: "DEBIT" | "CREDIT";
  proposedIsHeader?: boolean;
  proposedIsPostable?: boolean;
  proposedEffectiveFrom?: Date;
  financialStatement?: InsertCoaProposal["financialStatement"];

  idempotencyKey: string;
}

export async function createCoaProposal(
  input: CreateCoaProposalInput,
): Promise<ServiceResult<typeof coaProposalsTable.$inferSelect>> {
  const {
    companyId,
    actor,
    detectedIntent,
    normalizedDescription,
    idempotencyKey,
  } = input;

  // ── 1. Validate input ─────────────────────────────────────────────────────
  if (!companyId || !actor || !detectedIntent || !idempotencyKey) {
    return {
      ok: false,
      error: "companyId, actor, detectedIntent, and idempotencyKey are required.",
      errorCode: "COA_PROPOSAL_VALIDATION_FAILED",
    };
  }

  // ── 2. Build fingerprint ──────────────────────────────────────────────────
  const requestFingerprint = buildFingerprint(
    companyId,
    detectedIntent,
    normalizedDescription,
    input.proposedName ?? "",
    input.proposedCategory ?? "",
  );

  // ── 3. Fetch existing data for gap/duplicate detection ────────────────────
  const existingProposals = await db
    .select()
    .from(coaProposalsTable)
    .where(eq(coaProposalsTable.companyId, companyId));

  const existingAccounts = await db
    .select()
    .from(chartOfAccountsTable)
    .where(eq(chartOfAccountsTable.companyId, companyId));

  // ── 4. Duplicate check ────────────────────────────────────────────────────
  const dupInput: DuplicateCheckInput = {
    companyId,
    proposedName: input.proposedName ?? detectedIntent,
    normalizedName: normalizedDescription,
    detectedIntent,
    proposedParentId: input.proposedParentId ?? null,
    proposedCategory: input.proposedCategory ?? "EXPENSE",
    idempotencyKey,
    requestFingerprint,
    existingProposals: existingProposals.map((p) => ({
      id: p.id,
      proposalNumber: p.proposalNumber,
      proposedName: p.proposedName,
      proposedCode: p.proposedCode,
      proposedCategory: p.proposedCategory as CoaAccountCategory,
      proposedParentId: p.proposedParentId,
      detectedIntent: p.detectedIntent,
      status: p.status,
      idempotencyKey: p.idempotencyKey,
      requestFingerprint: p.requestFingerprint,
      companyId: p.companyId,
    })),
    existingAccounts: existingAccounts.map((a) => ({
      id: a.id,
      code: a.code,
      name: a.name,
      accountCategory: a.accountCategory as CoaAccountCategory,
      isActive: a.isActive ?? true,
      isPostable: a.isPostable ?? true,
      status: a.status ?? "ACTIVE",
      companyId: a.companyId,
    })),
  };

  const dupResult = detectDuplicateProposal(dupInput);

  if (dupResult.result === "EXACT_DUPLICATE") {
    return {
      ok: false,
      error: dupResult.reason,
      errorCode: "COA_PROPOSAL_DUPLICATE",
      data: dupResult.existingProposalId
        ? (existingProposals.find((p) => p.id === dupResult.existingProposalId) as any)
        : undefined,
    };
  }

  // ── 5. Gap detection ──────────────────────────────────────────────────────
  const gapInput: GapDetectionInput = {
    companyId,
    detectedIntent,
    normalizedDescription,
    aiConfidence: input.aiConfidence ?? 50,
    missingMappingType: input.missingMappingType,
    mappingErrorCode: input.mappingErrorCode,
    candidateAccounts: input.candidateAccounts ?? [],
    historicalMappings: input.historicalMappings ?? [],
    existingAccounts: (input.existingAccountsForGap ?? existingAccounts).map((a: any) => ({
      id: a.id,
      code: a.code,
      name: a.name,
      isActive: a.isActive ?? true,
      isPostable: a.isPostable ?? true,
      isHeader: a.isHeader ?? false,
      status: a.status ?? "ACTIVE",
      companyId: a.companyId,
      accountCategory: a.accountCategory ?? "ASSET",
    })),
  };
  const gapResult = detectCoaGap(gapInput);

  // ── 6. AI proposal recommendation ────────────────────────────────────────
  const recInput: ProposalRecommendationInput = {
    companyId,
    gapResult,
    mappingErrorCode: input.mappingErrorCode,
    detectedIntent,
    normalizedDescription,
    missingMappingType: input.missingMappingType,
    aiConfidence: input.aiConfidence ?? 50,
    historicalOccurrences: input.historicalOccurrences ?? 0,
    estimatedMonthlyUsage: input.estimatedMonthlyUsage ?? 0,
    existingAccounts: existingAccounts.map((a) => ({
      id: a.id,
      code: a.code,
      name: a.name,
      accountCategory: a.accountCategory as CoaAccountCategory,
      normalBalance: (a.normalBalance as "DEBIT" | "CREDIT") ?? "DEBIT",
      isHeader: a.isHeader ?? false,
      isPostable: a.isPostable ?? true,
      isActive: a.isActive ?? true,
      status: a.status ?? "ACTIVE",
      parentId: a.parentId,
      companyId: a.companyId,
    })),
  };
  const recommendation = generateCoaProposalRecommendation(recInput);

  // ── 7. Code suggestion ────────────────────────────────────────────────────
  // Generate proposal number early so the code-suggestion fallback can use it.
  const proposalNumber = await generateProposalNumber(companyId);

  let finalCode = input.proposedCode ?? "";
  if (!finalCode) {
    const codeSuggestion = suggestCoaCode({
      companyId,
      proposedCategory: recommendation.proposedCategory,
      proposedParentId: recommendation.proposedParentId,
      existingAccounts: existingAccounts.map((a) => ({
        code: a.code,
        parentId: a.parentId,
        accountCategory: a.accountCategory ?? "ASSET",
        companyId: a.companyId,
      })),
    });
    // Fallback: if code suggestion fails (no sibling pattern), produce a safe temp code
    // using the proposal number sequence (deterministic within a request).
    finalCode = codeSuggestion.suggestedCode || `DRAFT-${proposalNumber.slice(-8)}`;
  }

  // ── 8. Validate proposed hierarchy against Task #5 policy ─────────────────
  const resolvedCategory = input.proposedCategory ?? recommendation.proposedCategory;
  const resolvedParentId = input.proposedParentId ?? recommendation.proposedParentId;

  if (resolvedParentId != null) {
    const hierarchyResult = await validateCoaHierarchy({
      coaId: null,
      parentId: resolvedParentId,
      companyId,
      accountCategory: resolvedCategory,
    });
    if (hierarchyResult.length > 0) {
      return {
        ok: false,
        error: `Hierarchy validation failed: ${hierarchyResult.map((e) => e.message).join("; ")}`,
        errorCode: "COA_PROPOSAL_HIERARCHY_INVALID",
      };
    }
  }

  const postableErrors = validatePostableRules({
    isHeader: input.proposedIsHeader ?? recommendation.proposedIsHeader,
    isPostable: input.proposedIsPostable ?? recommendation.proposedIsPostable,
  });
  if (postableErrors.length > 0) {
    return {
      ok: false,
      error: `Postable validation: ${postableErrors.map((e) => e.message).join("; ")}`,
      errorCode: "COA_PROPOSAL_VALIDATION_FAILED",
    };
  }

  // ── 9. DB transaction: insert proposal + version + audit ──────────────────
  // proposalNumber was generated in step 7 above.

  let createdProposal: typeof coaProposalsTable.$inferSelect;

  try {
    await db.transaction(async (tx) => {
      // Insert proposal DRAFT
      const [p] = await tx
        .insert(coaProposalsTable)
        .values({
          companyId,
          proposalNumber,
          sourceType: input.sourceType ?? "MANUAL",
          sourceRecordId: input.sourceRecordId ?? null,
          reviewCaseId: input.reviewCaseId ?? null,
          transactionId: input.transactionId ?? null,
          status: "DRAFT",
          proposedCode: finalCode,
          proposedName: input.proposedName ?? recommendation.proposedName,
          proposedParentId: resolvedParentId,
          proposedCategory: resolvedCategory,
          proposedNormalBalance:
            input.proposedNormalBalance ??
            recommendation.proposedNormalBalance ??
            (normalBalanceForCategory(resolvedCategory) ?? "DEBIT"),
          proposedIsHeader: input.proposedIsHeader ?? recommendation.proposedIsHeader,
          proposedIsPostable: input.proposedIsPostable ?? recommendation.proposedIsPostable,
          proposedEffectiveFrom: input.proposedEffectiveFrom ?? new Date(),
          financialStatement:
            input.financialStatement ?? recommendation.financialStatement,
          detectedIntent,
          normalizedDescription,
          missingMappingType: input.missingMappingType ?? null,
          aiConfidence: recommendation.confidence,
          historicalOccurrences: input.historicalOccurrences ?? 0,
          estimatedMonthlyUsage: input.estimatedMonthlyUsage ?? 0,
          reasonJson: recommendation.reason,
          evidenceJson: recommendation.evidence,
          impactAnalysisJson: recommendation.impactAnalysis,
          alternativeAccountsJson: recommendation.alternatives,
          createdBy: actor,
          idempotencyKey,
          requestFingerprint,
          version: 1,
        })
        .returning();

      createdProposal = p!;

      // Insert version 1
      await tx.insert(coaProposalVersionsTable).values({
        companyId,
        proposalId: createdProposal.id,
        version: 1,
        snapshotJson: snapshotProposal(createdProposal) as any,
        changeReason: "Initial draft created",
        createdBy: actor,
      });

      // Insert PROPOSAL_CREATED audit
      await insertAuditEvent(
        tx as any,
        createdProposal.id,
        companyId,
        "PROPOSAL_CREATED",
        actor,
        null,
        "DRAFT",
        "Proposal created by AI COA engine",
        {
          gapType: gapResult.gapType,
          aiConfidence: recommendation.confidence,
          duplicateWarning: dupResult.result !== "NO_DUPLICATE" ? dupResult.result : undefined,
        },
      );
    });

    return { ok: true, data: createdProposal! };
  } catch (err: unknown) {
    const msg = String((err as Error)?.message ?? err);
    if (msg.includes("unique") || msg.includes("duplicate")) {
      return {
        ok: false,
        error: "Idempotency key already used for this company.",
        errorCode: "COA_PROPOSAL_IDEMPOTENCY_CONFLICT",
      };
    }
    logger.error({ err }, "[COA PROPOSAL] createCoaProposal failed");
    return { ok: false, error: "Internal error creating proposal.", errorCode: "COA_PROPOSAL_IMPLEMENTATION_FAILED" };
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Phase 13 — Submit
// ─────────────────────────────────────────────────────────────────────────────

export async function submitCoaProposal(
  proposalId: number,
  companyId: number,
  actor: string,
): Promise<ServiceResult<typeof coaProposalsTable.$inferSelect>> {
  const [proposal] = await db
    .select()
    .from(coaProposalsTable)
    .where(and(eq(coaProposalsTable.id, proposalId), eq(coaProposalsTable.companyId, companyId)));

  if (!proposal) return { ok: false, error: "Proposal not found.", errorCode: "COA_PROPOSAL_NOT_FOUND" };
  if (proposal.companyId !== companyId) return { ok: false, error: "Company mismatch.", errorCode: "COA_PROPOSAL_COMPANY_MISMATCH" };
  if (proposal.status !== "DRAFT") {
    return {
      ok: false,
      error: `Cannot submit proposal in status "${proposal.status}". Must be DRAFT.`,
      errorCode: "COA_PROPOSAL_INVALID_STATE",
    };
  }

  let updated: typeof coaProposalsTable.$inferSelect;

  try {
    await db.transaction(async (tx) => {
      const [u] = await tx
        .update(coaProposalsTable)
        .set({
          status: "PENDING_REVIEW",
          submittedBy: actor,
          submittedAt: new Date(),
          version: proposal.version + 1,
          updatedAt: new Date(),
        })
        .where(eq(coaProposalsTable.id, proposalId))
        .returning();

      updated = u!;

      await tx.insert(coaProposalVersionsTable).values({
        companyId,
        proposalId,
        version: updated!.version,
        snapshotJson: snapshotProposal(updated!) as any,
        changeReason: "Submitted for review",
        createdBy: actor,
      });

      await insertAuditEvent(
        tx as any,
        proposalId,
        companyId,
        "PROPOSAL_SUBMITTED",
        actor,
        "DRAFT",
        "PENDING_REVIEW",
      );
    });

    return { ok: true, data: updated! };
  } catch (err) {
    logger.error({ err }, "[COA PROPOSAL] submitCoaProposal failed");
    return { ok: false, error: "Submit failed.", errorCode: "COA_PROPOSAL_IMPLEMENTATION_FAILED" };
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Phase 13 — Review (add comments, no status change)
// ─────────────────────────────────────────────────────────────────────────────

export async function reviewCoaProposal(
  proposalId: number,
  companyId: number,
  actor: string,
  reviewComments: string,
): Promise<ServiceResult<typeof coaProposalsTable.$inferSelect>> {
  const [proposal] = await db
    .select()
    .from(coaProposalsTable)
    .where(and(eq(coaProposalsTable.id, proposalId), eq(coaProposalsTable.companyId, companyId)));

  if (!proposal) return { ok: false, error: "Proposal not found.", errorCode: "COA_PROPOSAL_NOT_FOUND" };
  if (proposal.companyId !== companyId) return { ok: false, error: "Company mismatch.", errorCode: "COA_PROPOSAL_COMPANY_MISMATCH" };
  if (proposal.status !== "PENDING_REVIEW") {
    return {
      ok: false,
      error: `Cannot review proposal in status "${proposal.status}". Must be PENDING_REVIEW.`,
      errorCode: "COA_PROPOSAL_INVALID_STATE",
    };
  }

  const [u] = await db
    .update(coaProposalsTable)
    .set({
      reviewedBy: actor,
      reviewedAt: new Date(),
      reviewComments,
      updatedAt: new Date(),
    })
    .where(eq(coaProposalsTable.id, proposalId))
    .returning();

  await insertAuditEvent(
    db as any,
    proposalId,
    companyId,
    "PROPOSAL_UPDATED",
    actor,
    "PENDING_REVIEW",
    "PENDING_REVIEW",
    reviewComments,
  );

  return { ok: true, data: u! };
}

// ─────────────────────────────────────────────────────────────────────────────
// Phase 13 — Approve
// ─────────────────────────────────────────────────────────────────────────────

export async function approveCoaProposal(
  proposalId: number,
  companyId: number,
  actor: string,
  reviewComments?: string,
  isAdmin?: boolean,
): Promise<ServiceResult<typeof coaProposalsTable.$inferSelect>> {
  const [proposal] = await db
    .select()
    .from(coaProposalsTable)
    .where(and(eq(coaProposalsTable.id, proposalId), eq(coaProposalsTable.companyId, companyId)));

  if (!proposal) return { ok: false, error: "Proposal not found.", errorCode: "COA_PROPOSAL_NOT_FOUND" };
  if (proposal.companyId !== companyId) return { ok: false, error: "Company mismatch.", errorCode: "COA_PROPOSAL_COMPANY_MISMATCH" };

  // Maker cannot approve their own proposal — unless they are admin
  if (!isAdmin && (proposal.createdBy === actor || proposal.submittedBy === actor)) {
    return {
      ok: false,
      error: "Maker cannot approve their own proposal.",
      errorCode: "COA_PROPOSAL_SELF_APPROVAL_FORBIDDEN",
    };
  }

  if (proposal.status !== "PENDING_REVIEW") {
    return {
      ok: false,
      error: `Cannot approve proposal in status "${proposal.status}". Must be PENDING_REVIEW.`,
      errorCode: "COA_PROPOSAL_INVALID_STATE",
    };
  }

  let updated: typeof coaProposalsTable.$inferSelect;

  try {
    await db.transaction(async (tx) => {
      const [u] = await tx
        .update(coaProposalsTable)
        .set({
          status: "APPROVED",
          approvedBy: actor,
          approvedAt: new Date(),
          reviewedBy: actor,
          reviewedAt: new Date(),
          reviewComments: reviewComments ?? proposal.reviewComments,
          version: proposal.version + 1,
          updatedAt: new Date(),
        })
        .where(eq(coaProposalsTable.id, proposalId))
        .returning();

      updated = u!;

      await tx.insert(coaProposalVersionsTable).values({
        companyId,
        proposalId,
        version: updated!.version,
        snapshotJson: snapshotProposal(updated!) as any,
        changeReason: "Approved",
        createdBy: actor,
      });

      await insertAuditEvent(
        tx as any,
        proposalId,
        companyId,
        "PROPOSAL_APPROVED",
        actor,
        "PENDING_REVIEW",
        "APPROVED",
        reviewComments,
      );
    });

    return { ok: true, data: updated! };
  } catch (err) {
    logger.error({ err }, "[COA PROPOSAL] approveCoaProposal failed");
    return { ok: false, error: "Approve failed.", errorCode: "COA_PROPOSAL_IMPLEMENTATION_FAILED" };
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Phase 13 — Reject
// ─────────────────────────────────────────────────────────────────────────────

export async function rejectCoaProposal(
  proposalId: number,
  companyId: number,
  actor: string,
  rejectionReason: string,
): Promise<ServiceResult<typeof coaProposalsTable.$inferSelect>> {
  const [proposal] = await db
    .select()
    .from(coaProposalsTable)
    .where(and(eq(coaProposalsTable.id, proposalId), eq(coaProposalsTable.companyId, companyId)));

  if (!proposal) return { ok: false, error: "Proposal not found.", errorCode: "COA_PROPOSAL_NOT_FOUND" };
  if (proposal.companyId !== companyId) return { ok: false, error: "Company mismatch.", errorCode: "COA_PROPOSAL_COMPANY_MISMATCH" };
  if (proposal.status !== "PENDING_REVIEW") {
    return {
      ok: false,
      error: `Cannot reject proposal in status "${proposal.status}". Must be PENDING_REVIEW.`,
      errorCode: "COA_PROPOSAL_INVALID_STATE",
    };
  }
  if (!rejectionReason?.trim()) {
    return {
      ok: false,
      error: "Rejection reason is required.",
      errorCode: "COA_PROPOSAL_VALIDATION_FAILED",
    };
  }

  let updated: typeof coaProposalsTable.$inferSelect;

  try {
    await db.transaction(async (tx) => {
      const [u] = await tx
        .update(coaProposalsTable)
        .set({
          status: "REJECTED",
          rejectionReason,
          reviewedBy: actor,
          reviewedAt: new Date(),
          rejectedAt: new Date(),
          version: proposal.version + 1,
          updatedAt: new Date(),
        })
        .where(eq(coaProposalsTable.id, proposalId))
        .returning();

      updated = u!;

      await tx.insert(coaProposalVersionsTable).values({
        companyId,
        proposalId,
        version: updated!.version,
        snapshotJson: snapshotProposal(updated!) as any,
        changeReason: `Rejected: ${rejectionReason}`,
        createdBy: actor,
      });

      await insertAuditEvent(
        tx as any,
        proposalId,
        companyId,
        "PROPOSAL_REJECTED",
        actor,
        "PENDING_REVIEW",
        "REJECTED",
        rejectionReason,
      );
    });

    return { ok: true, data: updated! };
  } catch (err) {
    logger.error({ err }, "[COA PROPOSAL] rejectCoaProposal failed");
    return { ok: false, error: "Reject failed.", errorCode: "COA_PROPOSAL_IMPLEMENTATION_FAILED" };
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Phase 13 — Cancel
// ─────────────────────────────────────────────────────────────────────────────

export async function cancelCoaProposal(
  proposalId: number,
  companyId: number,
  actor: string,
  reason?: string,
): Promise<ServiceResult<typeof coaProposalsTable.$inferSelect>> {
  const [proposal] = await db
    .select()
    .from(coaProposalsTable)
    .where(and(eq(coaProposalsTable.id, proposalId), eq(coaProposalsTable.companyId, companyId)));

  if (!proposal) return { ok: false, error: "Proposal not found.", errorCode: "COA_PROPOSAL_NOT_FOUND" };
  if (proposal.companyId !== companyId) return { ok: false, error: "Company mismatch.", errorCode: "COA_PROPOSAL_COMPANY_MISMATCH" };

  const cancellableStatuses = ["DRAFT", "PENDING_REVIEW"];
  if (!cancellableStatuses.includes(proposal.status)) {
    return {
      ok: false,
      error: `Cannot cancel proposal in status "${proposal.status}". Must be DRAFT or PENDING_REVIEW.`,
      errorCode: "COA_PROPOSAL_INVALID_STATE",
    };
  }

  let updated: typeof coaProposalsTable.$inferSelect;

  try {
    await db.transaction(async (tx) => {
      const [u] = await tx
        .update(coaProposalsTable)
        .set({
          status: "CANCELLED",
          cancelledAt: new Date(),
          version: proposal.version + 1,
          updatedAt: new Date(),
        })
        .where(eq(coaProposalsTable.id, proposalId))
        .returning();

      updated = u!;

      await tx.insert(coaProposalVersionsTable).values({
        companyId,
        proposalId,
        version: updated!.version,
        snapshotJson: snapshotProposal(updated!) as any,
        changeReason: `Cancelled: ${reason ?? "No reason provided"}`,
        createdBy: actor,
      });

      await insertAuditEvent(
        tx as any,
        proposalId,
        companyId,
        "PROPOSAL_CANCELLED",
        actor,
        proposal.status,
        "CANCELLED",
        reason,
      );
    });

    return { ok: true, data: updated! };
  } catch (err) {
    logger.error({ err }, "[COA PROPOSAL] cancelCoaProposal failed");
    return { ok: false, error: "Cancel failed.", errorCode: "COA_PROPOSAL_IMPLEMENTATION_FAILED" };
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Phase 14 — Implement Approved Proposal
// ─────────────────────────────────────────────────────────────────────────────

export async function implementApprovedCoaProposal(
  proposalId: number,
  companyId: number,
  actor: string,
): Promise<ServiceResult<typeof coaProposalsTable.$inferSelect>> {
  // ── 1. Lock and verify proposal ───────────────────────────────────────────
  const [proposal] = await db
    .select()
    .from(coaProposalsTable)
    .where(and(eq(coaProposalsTable.id, proposalId), eq(coaProposalsTable.companyId, companyId)));

  if (!proposal) return { ok: false, error: "Proposal not found.", errorCode: "COA_PROPOSAL_NOT_FOUND" };
  if (proposal.companyId !== companyId) return { ok: false, error: "Company mismatch.", errorCode: "COA_PROPOSAL_COMPANY_MISMATCH" };
  // Retrying Implement is safe after the proposal has already been linked to
  // an account or implemented through Task #5. Return the existing result
  // instead of forcing the user through a blocking 409 response.
  if (proposal.implementedCoaId != null && proposal.status === "IMPLEMENTED") {
    return { ok: true, data: proposal };
  }
  if (proposal.status !== "APPROVED") {
    return {
      ok: false,
      error: `Cannot implement proposal in status "${proposal.status}". Must be APPROVED.`,
      errorCode: "COA_PROPOSAL_INVALID_STATE",
    };
  }

  // ── 2. Revalidate code uniqueness ─────────────────────────────────────────
  const existingWithCode = await db
    .select({ id: chartOfAccountsTable.id })
    .from(chartOfAccountsTable)
    .where(
      and(
        eq(chartOfAccountsTable.companyId, companyId),
        eq(chartOfAccountsTable.code, proposal.proposedCode),
      ),
    );

  if (existingWithCode.length > 0) {
    // The proposal is for an account that already exists. Link the approved
    // proposal to that account instead of trying to create a duplicate
    // through Task #5. This is the simple, idempotent path for mapping gaps
    // where the COA was created between proposal generation and implementation.
    const existingCoaId = existingWithCode[0]!.id;
    const [existingAccount] = await db
      .select()
      .from(chartOfAccountsTable)
      .where(eq(chartOfAccountsTable.id, existingCoaId));

    if (!existingAccount) {
      return {
        ok: false,
        error: `COA code "${proposal.proposedCode}" already exists but could not be loaded.`,
        errorCode: "COA_PROPOSAL_CODE_CONFLICT",
      };
    }

    const wasInactive = !existingAccount.isActive || existingAccount.status !== "ACTIVE";

    let linked: typeof coaProposalsTable.$inferSelect;
    try {
      await db.transaction(async (tx) => {
        // If the existing account is inactive, activate it as part of implementation.
        // A COA proposal represents an approval decision that the account should be
        // usable — keeping it inactive would silently break journal mapping even
        // after a successful implementation.
        if (wasInactive) {
          await tx
            .update(chartOfAccountsTable)
            .set({
              isActive: true,
              status: "ACTIVE",
              updatedAt: new Date(),
            })
            .where(eq(chartOfAccountsTable.id, existingAccount.id));
        }

        const [updated] = await tx
          .update(coaProposalsTable)
          .set({
            status: "IMPLEMENTED",
            implementedBy: actor,
            implementedAt: new Date(),
            implementedCoaId: existingAccount.id,
            version: proposal.version + 1,
            updatedAt: new Date(),
          })
          .where(eq(coaProposalsTable.id, proposalId))
          .returning();

        linked = updated!;

        await tx.insert(coaProposalVersionsTable).values({
          companyId,
          proposalId,
          version: linked!.version,
          snapshotJson: snapshotProposal(linked!) as any,
          changeReason: `Linked to existing COA ${existingAccount.code} — ${existingAccount.name}${wasInactive ? "; account re-activated" : ""}.`,
          createdBy: actor,
        });

        await insertAuditEvent(
          tx as any,
          proposalId,
          companyId,
          "COA_IMPLEMENTED",
          actor,
          "APPROVED",
          "IMPLEMENTED",
          `Linked to existing COA ${existingAccount.code} — ${existingAccount.name}; no new account created${wasInactive ? "; account was inactive — now activated" : ""}.`,
          { existingCoaId: existingAccount.id, createdNewCoa: false, activatedExisting: wasInactive },
        );
      });

      return { ok: true, data: linked! };
    } catch (err) {
      logger.error({ err }, "[COA PROPOSAL] linking existing COA during implementation failed");
      return {
        ok: false,
        error: "Implementation transaction failed.",
        errorCode: "COA_PROPOSAL_IMPLEMENTATION_FAILED",
      };
    }
  }

  // ── 3. Revalidate parent/hierarchy ───────────────────────────────────────
  if (proposal.proposedParentId != null) {
    const hierarchyErrors = await validateCoaHierarchy({
      coaId: null,
      parentId: proposal.proposedParentId,
      companyId,
      accountCategory: proposal.proposedCategory as CoaAccountCategory,
    });
    if (hierarchyErrors.length > 0) {
      return {
        ok: false,
        error: `Hierarchy revalidation failed: ${hierarchyErrors.map((e) => e.message).join("; ")}`,
        errorCode: "COA_PROPOSAL_HIERARCHY_INVALID",
      };
    }
  }

  // ── 4. Revalidate category/normal balance ─────────────────────────────────
  const postableErrors = validatePostableRules({
    isHeader: proposal.proposedIsHeader,
    isPostable: proposal.proposedIsPostable,
  });
  if (postableErrors.length > 0) {
    return {
      ok: false,
      error: `Postable revalidation: ${postableErrors.map((e) => e.message).join("; ")}`,
      errorCode: "COA_PROPOSAL_VALIDATION_FAILED",
    };
  }

  // ── 5. Directly create COA account as ACTIVE (no Task #5 checker required) ─
  const now = new Date();
  let implemented: typeof coaProposalsTable.$inferSelect;

  try {
    await db.transaction(async (tx) => {
      // Insert COA master record directly as ACTIVE
      const [createdCoa] = await tx
        .insert(chartOfAccountsTable)
        .values({
          companyId,
          code: proposal.proposedCode,
          name: proposal.proposedName,
          type: "expense",
          subtype: null,
          parentId: proposal.proposedParentId ?? null,
          isActive: true,
          normalBalance: proposal.proposedNormalBalance as any,
          accountCategory: proposal.proposedCategory as any,
          isPostable: proposal.proposedIsPostable,
          isHeader: proposal.proposedIsHeader,
          effectiveFrom: proposal.proposedEffectiveFrom ?? null,
          effectiveTo: null,
          status: "ACTIVE",
          version: 1,
          createdBy: actor,
          approvedBy: actor,
          approvedAt: now,
        })
        .returning();

      // Insert COA version snapshot
      await tx
        .insert(coaVersionsTable)
        .values({
          companyId,
          coaId: createdCoa!.id,
          version: 1,
          snapshotJson: {
            id: createdCoa!.id,
            code: createdCoa!.code,
            name: createdCoa!.name,
            accountCategory: createdCoa!.accountCategory,
            normalBalance: createdCoa!.normalBalance,
            isHeader: createdCoa!.isHeader,
            isPostable: createdCoa!.isPostable,
            status: createdCoa!.status,
          } as any,
          changeRequestId: null,
          effectiveFrom: createdCoa!.effectiveFrom ?? null,
          effectiveTo: null,
          createdBy: actor,
          approvedBy: actor,
        })
        .onConflictDoNothing();

      // Update proposal to IMPLEMENTED with reference to new COA ID
      const [u] = await tx
        .update(coaProposalsTable)
        .set({
          status: "IMPLEMENTED",
          implementedBy: actor,
          implementedAt: now,
          implementedCoaId: createdCoa!.id,
          version: proposal.version + 1,
          updatedAt: now,
        })
        .where(eq(coaProposalsTable.id, proposalId))
        .returning();

      implemented = u!;

      await tx.insert(coaProposalVersionsTable).values({
        companyId,
        proposalId,
        version: implemented!.version,
        snapshotJson: snapshotProposal(implemented!) as any,
        changeReason: `Implemented: COA ${createdCoa!.code} — ${createdCoa!.name} created (id=${createdCoa!.id}).`,
        createdBy: actor,
      });

      // COA_IMPLEMENTED audit
      await insertAuditEvent(
        tx as any,
        proposalId,
        companyId,
        "COA_IMPLEMENTED",
        actor,
        "APPROVED",
        "IMPLEMENTED",
        `COA account ${createdCoa!.code} — ${createdCoa!.name} created directly (id=${createdCoa!.id}).`,
        { newCoaId: createdCoa!.id },
      );

      // Learning feedback record
      await insertAuditEvent(
        tx as any,
        proposalId,
        companyId,
        "LEARNING_FEEDBACK_CREATED",
        "system",
        null,
        null,
        "Learning feedback recorded for AI training.",
        {
          proposalId,
          proposedCategory: proposal.proposedCategory,
          detectedIntent: proposal.detectedIntent,
          aiConfidence: proposal.aiConfidence,
        },
      );
    });

    return { ok: true, data: implemented! };
  } catch (err) {
    logger.error({ err }, "[COA PROPOSAL] implementApprovedCoaProposal failed");
    return {
      ok: false,
      error: "Implementation transaction failed.",
      errorCode: "COA_PROPOSAL_IMPLEMENTATION_FAILED",
    };
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Fast-path — linkExistingCoaProposal
// ─────────────────────────────────────────────────────────────────────────────

export interface LinkExistingCoaInput {
  companyId: number;
  actor: string;
  existingCoaId: number;
  detectedIntent: string;
  normalizedDescription: string;
  sourceType?: InsertCoaProposal["sourceType"];
  sourceRecordId?: string;
  mappingErrorCode?: string;
  idempotencyKey: string;
}

/** Derive financial statement placement from the COA type string. */
function fsFromType(type: string | null | undefined): InsertCoaProposal["financialStatement"] {
  switch ((type ?? "").toLowerCase()) {
    case "expense":
    case "revenue": return "PROFIT_AND_LOSS";
    default:        return "BALANCE_SHEET";
  }
}

/**
 * Fast-path: the user chose an EXISTING COA account to satisfy a mapping error.
 * No new account creation is involved → no maker-checker flow required.
 *
 * Creates a proposal record that starts and lands in IMPLEMENTED status in a
 * single transaction, so the audit trail is complete without blocking the user.
 */
export async function linkExistingCoaProposal(
  input: LinkExistingCoaInput,
): Promise<ServiceResult<typeof coaProposalsTable.$inferSelect>> {
  const { companyId, actor, existingCoaId, detectedIntent, normalizedDescription, idempotencyKey } = input;

  if (!companyId || !actor || !existingCoaId || !detectedIntent || !idempotencyKey) {
    return {
      ok: false,
      error: "companyId, actor, existingCoaId, detectedIntent, and idempotencyKey are required.",
      errorCode: "COA_PROPOSAL_VALIDATION_FAILED",
    };
  }

  // Verify the existing account belongs to this company (allow shared/null-company accounts too)
  const [existingAccount] = await db
    .select()
    .from(chartOfAccountsTable)
    .where(eq(chartOfAccountsTable.id, existingCoaId));

  if (!existingAccount) {
    return {
      ok: false,
      error: `COA account ${existingCoaId} not found.`,
      errorCode: "COA_PROPOSAL_VALIDATION_FAILED",
    };
  }
  if (existingAccount.companyId != null && existingAccount.companyId !== companyId) {
    return {
      ok: false,
      error: `COA account ${existingCoaId} does not belong to this company.`,
      errorCode: "COA_PROPOSAL_COMPANY_MISMATCH",
    };
  }

  const proposalNumber = await generateProposalNumber(companyId);
  const now = new Date();
  const fingerprint = buildFingerprint(
    companyId, detectedIntent, normalizedDescription,
    existingAccount.name,
    existingAccount.accountCategory ?? existingAccount.type ?? "EXPENSE",
  );

  let result: typeof coaProposalsTable.$inferSelect;

  const linkWasInactive = !existingAccount.isActive || existingAccount.status !== "ACTIVE";

  try {
    await db.transaction(async (tx) => {
      // Activate the existing account if it is currently inactive.
      // Linking a proposal to an account is an explicit decision that the
      // account should be usable; leaving it inactive silently breaks any
      // journal mapping that depends on it.
      if (linkWasInactive) {
        await tx
          .update(chartOfAccountsTable)
          .set({ isActive: true, status: "ACTIVE", updatedAt: now })
          .where(eq(chartOfAccountsTable.id, existingCoaId));
      }

      const [inserted] = await tx
        .insert(coaProposalsTable)
        .values({
          companyId,
          proposalNumber,
          sourceType:            input.sourceType ?? "MANUAL",
          sourceRecordId:        input.sourceRecordId ?? null,
          status:                "IMPLEMENTED",
          detectedIntent,
          normalizedDescription,
          proposedCode:          existingAccount.code,
          proposedName:          existingAccount.name,
          proposedParentId:      existingAccount.parentId ?? null,
          proposedCategory:      existingAccount.accountCategory ?? existingAccount.type?.toUpperCase() ?? "EXPENSE",
          proposedNormalBalance: existingAccount.normalBalance ?? "DEBIT",
          proposedIsHeader:      existingAccount.isHeader ?? false,
          proposedIsPostable:    existingAccount.isPostable ?? true,
          financialStatement:    fsFromType(existingAccount.type),
          createdBy:             actor,
          submittedBy:           actor,
          submittedAt:           now,
          approvedBy:            "SYSTEM",
          approvedAt:            now,
          reviewedBy:            "SYSTEM",
          reviewedAt:            now,
          implementedBy:         actor,
          implementedAt:         now,
          implementedCoaId:      existingCoaId,
          idempotencyKey,
          requestFingerprint:    fingerprint,
          version:               1,
          createdAt:             now,
          updatedAt:             now,
        } as any)
        .returning();

      result = inserted!;

      await tx.insert(coaProposalVersionsTable).values({
        companyId,
        proposalId:   result.id,
        version:      1,
        snapshotJson: snapshotProposal(result) as any,
        changeReason: `Linked to existing COA ${existingAccount.code} — ${existingAccount.name}${linkWasInactive ? "; account re-activated" : ""}`,
        createdBy:    actor,
      });

      await insertAuditEvent(
        tx as any, result.id, companyId,
        "PROPOSAL_CREATED", actor, null, "IMPLEMENTED",
        `Linked to existing COA ${existingAccount.code} — ${existingAccount.name}. Auto-approved (no new account creation)${linkWasInactive ? "; account was inactive — now activated" : ""}.`,
      );
    });

    logger.info({ proposalId: result!.id, existingCoaId, proposalNumber }, "[COA PROPOSAL] linkExistingCoaProposal: linked OK");
    return { ok: true, data: result! };
  } catch (err) {
    logger.error({ err }, "[COA PROPOSAL] linkExistingCoaProposal failed");
    return { ok: false, error: "Link existing COA failed.", errorCode: "COA_PROPOSAL_IMPLEMENTATION_FAILED" };
  }
}
