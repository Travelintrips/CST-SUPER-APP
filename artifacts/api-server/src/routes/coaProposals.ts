/**
 * COA Proposals Router — Task #7 Phase 16
 *
 * Routes:
 *   GET    /accounting/coa-proposals                    → list proposals
 *   GET    /accounting/coa-proposals/by-source          → find by source
 *   GET    /accounting/coa-proposals/:id                → single proposal
 *   GET    /accounting/coa-proposals/:id/history        → version history
 *   GET    /accounting/coa-proposals/:id/audit          → audit events
 *   POST   /accounting/coa-proposals                    → create proposal
 *   POST   /accounting/coa-proposals/:id/submit         → submit for review
 *   POST   /accounting/coa-proposals/:id/approve        → approve
 *   POST   /accounting/coa-proposals/:id/reject         → reject
 *   POST   /accounting/coa-proposals/:id/cancel         → cancel
 *   POST   /accounting/coa-proposals/:id/implement      → implement (triggers Task #5)
 *
 * Security:
 *   - All routes: authenticated + company-scoped
 *   - Write routes: idempotent
 *   - companyId from session (body companyId mismatch rejected)
 *   - maker self-approve blocked in service layer
 *   - no cross-company access
 *   - no SQL/stack in error responses
 *
 * Mounted at /accounting/coa-proposals in routes/index.ts
 * BEFORE the main accountingRouter to avoid generic RBAC interference.
 */

import { Router } from "express";
import { eq, and, desc } from "drizzle-orm";
import { z } from "zod/v4";
import { db } from "@workspace/db";
import {
  coaProposalsTable,
  coaProposalVersionsTable,
  coaProposalAuditTable,
} from "@workspace/db/schema/coaProposals";
import { chartOfAccountsTable } from "@workspace/db/schema/accounting";
import { resolveCompanyId } from "../lib/resolveCompany.js";
import {
  createCoaProposal,
  linkExistingCoaProposal,
  submitCoaProposal,
  reviewCoaProposal,
  approveCoaProposal,
  rejectCoaProposal,
  cancelCoaProposal,
  implementApprovedCoaProposal,
} from "../lib/coa/coaProposalService.js";
import { detectCoaGap } from "../lib/ai/transaction-intelligence/coaGapDetector.js";
import {
  generateCoaProposalRecommendation,
} from "../lib/ai/transaction-intelligence/coaProposalEngine.js";
import { suggestCoaCode } from "../lib/ai/transaction-intelligence/coaCodeSuggester.js";
import { httpStatusForProposalCode } from "../lib/coaProposalErrors.js";
import { logger } from "../lib/logger.js";

const router = Router();

// ─── Helpers ──────────────────────────────────────────────────────────────────

function getActor(req: Express.Request): string {
  return String((req as any).user?.id ?? (req as any).user?.email ?? "system");
}

function safeError(res: any, code: string | undefined, message: string): any {
  const status = httpStatusForProposalCode(code);
  return res.status(status).json({ error: message, code });
}

// ─── GET /accounting/coa-proposals ───────────────────────────────────────────

router.get("/", async (req, res) => {
  try {
    const companyId = resolveCompanyId(req as any);
    const { status } = req.query as { status?: string };

    const VALID_STATUSES = ["DRAFT", "PENDING_REVIEW", "APPROVED", "REJECTED", "IMPLEMENTED", "CANCELLED"];

    let rows;
    if (status && VALID_STATUSES.includes(status.toUpperCase())) {
      rows = await db
        .select()
        .from(coaProposalsTable)
        .where(
          and(
            eq(coaProposalsTable.companyId, companyId),
            eq(coaProposalsTable.status, status.toUpperCase() as any),
          ),
        )
        .orderBy(desc(coaProposalsTable.createdAt));
    } else {
      rows = await db
        .select()
        .from(coaProposalsTable)
        .where(eq(coaProposalsTable.companyId, companyId))
        .orderBy(desc(coaProposalsTable.createdAt));
    }

    return res.json(rows);
  } catch (err) {
    return res.status(500).json({ error: "Failed to fetch proposals." });
  }
});

// ─── GET /accounting/coa-proposals/by-source ─────────────────────────────────

// Valid source type enum values (from coa_proposal_source_type DB enum).
// BANK_MUTATION is accepted as a frontend alias for BANK_RECONCILIATION.
const VALID_SOURCE_TYPES = [
  "BANK_RECONCILIATION",
  "EXPENSE",
  "TREASURY",
  "VENDOR_PAYMENT",
  "CUSTOMER_PAYMENT",
  "MANUAL",
  "BANK_MUTATION", // alias: frontend bank reconciliation page uses this; normalised below
] as const;
type KnownSourceType = typeof VALID_SOURCE_TYPES[number];

/** Normalize frontend aliases to their canonical DB enum value. */
function normalizeSourceType(raw: string): string {
  if (raw === "BANK_MUTATION") return "BANK_RECONCILIATION";
  return raw;
}

router.get("/by-source", async (req, res) => {
  try {
    const companyId = resolveCompanyId(req as any);
    const { sourceType, sourceRecordId } = req.query as {
      sourceType?: string;
      sourceRecordId?: string;
    };

    if (!sourceType || !sourceRecordId) {
      return res.status(400).json({
        error: "sourceType and sourceRecordId are required.",
        code: "COA_PROPOSAL_VALIDATION_FAILED",
      });
    }

    if (!(VALID_SOURCE_TYPES as readonly string[]).includes(sourceType)) {
      return res.status(400).json({
        error: `Invalid sourceType. Allowed: ${VALID_SOURCE_TYPES.join(", ")}.`,
        code: "COA_PROPOSAL_VALIDATION_FAILED",
      });
    }

    const normalizedSourceType = normalizeSourceType(sourceType);

    const rows = await db
      .select()
      .from(coaProposalsTable)
      .where(
        and(
          eq(coaProposalsTable.companyId, companyId),
          eq(coaProposalsTable.sourceType, normalizedSourceType as any),
          eq(coaProposalsTable.sourceRecordId, sourceRecordId),
        ),
      )
      .orderBy(desc(coaProposalsTable.createdAt));

    return res.json(rows);
  } catch (err) {
    return res.status(500).json({ error: "Failed to fetch proposals by source." });
  }
});

// ─── GET /accounting/coa-proposals/:id ───────────────────────────────────────

router.get("/:id", async (req, res) => {
  try {
    const companyId = resolveCompanyId(req as any);
    const id = Number(req.params["id"]);
    if (!id || isNaN(id)) {
      return res.status(400).json({ error: "Invalid proposal id.", code: "COA_PROPOSAL_VALIDATION_FAILED" });
    }

    const [proposal] = await db
      .select()
      .from(coaProposalsTable)
      .where(and(eq(coaProposalsTable.id, id), eq(coaProposalsTable.companyId, companyId)));

    if (!proposal) {
      return res.status(404).json({ error: "Proposal not found.", code: "COA_PROPOSAL_NOT_FOUND" });
    }

    return res.json(proposal);
  } catch (err) {
    return res.status(500).json({ error: "Failed to fetch proposal." });
  }
});

// ─── GET /accounting/coa-proposals/:id/history ───────────────────────────────

router.get("/:id/history", async (req, res) => {
  try {
    const companyId = resolveCompanyId(req as any);
    const id = Number(req.params["id"]);
    if (!id || isNaN(id)) {
      return res.status(400).json({ error: "Invalid proposal id.", code: "COA_PROPOSAL_VALIDATION_FAILED" });
    }

    // Verify company scope
    const [proposal] = await db
      .select({ id: coaProposalsTable.id })
      .from(coaProposalsTable)
      .where(and(eq(coaProposalsTable.id, id), eq(coaProposalsTable.companyId, companyId)));

    if (!proposal) {
      return res.status(404).json({ error: "Proposal not found.", code: "COA_PROPOSAL_NOT_FOUND" });
    }

    const versions = await db
      .select()
      .from(coaProposalVersionsTable)
      .where(eq(coaProposalVersionsTable.proposalId, id))
      .orderBy(desc(coaProposalVersionsTable.version));

    return res.json(versions);
  } catch (err) {
    return res.status(500).json({ error: "Failed to fetch proposal history." });
  }
});

// ─── GET /accounting/coa-proposals/:id/audit ─────────────────────────────────

router.get("/:id/audit", async (req, res) => {
  try {
    const companyId = resolveCompanyId(req as any);
    const id = Number(req.params["id"]);
    if (!id || isNaN(id)) {
      return res.status(400).json({ error: "Invalid proposal id.", code: "COA_PROPOSAL_VALIDATION_FAILED" });
    }

    const [proposal] = await db
      .select({ id: coaProposalsTable.id })
      .from(coaProposalsTable)
      .where(and(eq(coaProposalsTable.id, id), eq(coaProposalsTable.companyId, companyId)));

    if (!proposal) {
      return res.status(404).json({ error: "Proposal not found.", code: "COA_PROPOSAL_NOT_FOUND" });
    }

    const auditRows = await db
      .select()
      .from(coaProposalAuditTable)
      .where(eq(coaProposalAuditTable.proposalId, id))
      .orderBy(desc(coaProposalAuditTable.occurredAt));

    return res.json(auditRows);
  } catch (err) {
    return res.status(500).json({ error: "Failed to fetch proposal audit." });
  }
});

// ─── POST /accounting/coa-proposals/suggest (dry-run AI, no DB write) ────────

const suggestSchema = z.object({
  detectedIntent:       z.string().min(1),
  normalizedDescription: z.string().default(""),
  mappingErrorCode:     z.string().optional(),
  aiConfidence:         z.number().int().min(0).max(100).optional(),
  historicalOccurrences: z.number().int().min(0).optional(),
});

router.post("/suggest", async (req, res) => {
  try {
    const companyId = resolveCompanyId(req as any);

    const parsed = suggestSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({
        error: "Validation failed.",
        details: parsed.error.flatten(),
      });
    }

    const {
      detectedIntent,
      normalizedDescription,
      mappingErrorCode,
      aiConfidence = 50,
      historicalOccurrences = 0,
    } = parsed.data;

    // Fetch existing accounts for context
    const existingAccounts = await db
      .select()
      .from(chartOfAccountsTable)
      .where(eq(chartOfAccountsTable.companyId, companyId));

    const mappedAccounts = existingAccounts.map((a) => ({
      id: a.id,
      code: a.code,
      name: a.name,
      accountCategory: (a.accountCategory ?? "ASSET") as any,
      normalBalance: ((a.normalBalance ?? "DEBIT") as "DEBIT" | "CREDIT"),
      isHeader: a.isHeader ?? false,
      isPostable: a.isPostable ?? true,
      isActive: a.isActive ?? true,
      status: a.status ?? "ACTIVE",
      parentId: a.parentId,
      companyId: a.companyId,
    }));

    // Gap detection (needed as input for recommendation engine)
    const gapResult = detectCoaGap({
      companyId,
      detectedIntent,
      normalizedDescription,
      aiConfidence,
      mappingErrorCode,
      candidateAccounts: [],
      historicalMappings: [],
      existingAccounts: mappedAccounts.map((a) => ({
        id: a.id,
        code: a.code,
        name: a.name,
        isActive: a.isActive,
        isPostable: a.isPostable,
        isHeader: a.isHeader,
        status: a.status,
        companyId: a.companyId,
        accountCategory: a.accountCategory,
      })),
    });

    // AI recommendation (pure function — no DB write)
    const recommendation = generateCoaProposalRecommendation({
      companyId,
      gapResult,
      mappingErrorCode,
      detectedIntent,
      normalizedDescription,
      aiConfidence,
      historicalOccurrences,
      estimatedMonthlyUsage: 0,
      existingAccounts: mappedAccounts,
    });

    // Code suggestion
    const codeSuggestion = suggestCoaCode({
      companyId,
      proposedCategory: recommendation.proposedCategory,
      proposedParentId: recommendation.proposedParentId,
      existingAccounts: existingAccounts.map((a) => ({
        code: a.code,
        parentId: a.parentId,
        accountCategory: (a.accountCategory ?? "ASSET") as any,
        companyId: a.companyId,
      })),
    });

    return res.json({
      proposedName:          recommendation.proposedName,
      proposedCode:          codeSuggestion.suggestedCode ?? "",
      proposedCategory:      recommendation.proposedCategory,
      proposedNormalBalance: recommendation.proposedNormalBalance,
      financialStatement:    recommendation.financialStatement,
      confidence:            recommendation.confidence,
      reason:                recommendation.reason,
      alternatives:          recommendation.alternatives,
    });
  } catch (err) {
    return res.status(500).json({ error: "Failed to generate AI suggestion." });
  }
});

// ─── POST /accounting/coa-proposals ──────────────────────────────────────────

const createSchema = z.object({
  detectedIntent: z.string().min(1),
  normalizedDescription: z.string().default(""),
  idempotencyKey: z.string().min(1),
  sourceType: z
    .enum(["BANK_RECONCILIATION", "EXPENSE", "TREASURY", "VENDOR_PAYMENT", "CUSTOMER_PAYMENT", "MANUAL"])
    .optional(),
  sourceRecordId: z.string().optional(),
  reviewCaseId: z.number().int().optional(),
  transactionId: z.number().int().optional(),
  missingMappingType: z.string().optional(),
  mappingErrorCode: z.string().optional(),
  aiConfidence: z.number().int().min(0).max(100).optional(),
  historicalOccurrences: z.number().int().min(0).optional(),
  estimatedMonthlyUsage: z.number().int().min(0).optional(),
  proposedCode: z.string().optional(),
  proposedName: z.string().optional(),
  proposedParentId: z.number().int().nullable().optional(),
  proposedCategory: z.string().optional(),
  proposedNormalBalance: z.enum(["DEBIT", "CREDIT"]).optional(),
  proposedIsHeader: z.boolean().optional(),
  proposedIsPostable: z.boolean().optional(),
  financialStatement: z
    .enum(["BALANCE_SHEET", "PROFIT_AND_LOSS", "CASH_FLOW_SUPPORT", "OFF_STATEMENT"])
    .optional(),
  // Security: body companyId is checked against session companyId
  companyId: z.number().int().optional(),
});

router.post("/", async (req, res) => {
  try {
    const companyId = resolveCompanyId(req as any);
    const actor = getActor(req as any);

    const parsed = createSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({
        error: "Validation failed.",
        code: "COA_PROPOSAL_VALIDATION_FAILED",
        details: parsed.error.flatten(),
      });
    }

    // Security: reject body companyId mismatch
    if (parsed.data.companyId != null && parsed.data.companyId !== companyId) {
      return res.status(403).json({
        error: "Company ID mismatch between session and request body.",
        code: "COA_PROPOSAL_COMPANY_MISMATCH",
      });
    }

    const result = await createCoaProposal({
      ...parsed.data,
      companyId,
      actor,
    } as any);

    if (!result.ok) {
      return safeError(res, result.errorCode, result.error ?? "Create failed.");
    }

    return res.status(201).json(result.data);
  } catch (err) {
    logger.error({ err }, "[COA PROPOSAL] create route failed");
    return res.status(500).json({ error: "Internal error creating proposal." });
  }
});

// ─── POST /accounting/coa-proposals/:id/submit ───────────────────────────────

router.post("/:id/submit", async (req, res) => {
  try {
    const companyId = resolveCompanyId(req as any);
    const actor = getActor(req as any);
    const id = Number(req.params["id"]);

    const result = await submitCoaProposal(id, companyId, actor);
    if (!result.ok) return safeError(res, result.errorCode, result.error ?? "Submit failed.");
    return res.json(result.data);
  } catch (err) {
    return res.status(500).json({ error: "Internal error submitting proposal." });
  }
});

// ─── POST /accounting/coa-proposals/:id/approve ──────────────────────────────

router.post("/:id/approve", async (req, res) => {
  try {
    const companyId = resolveCompanyId(req as any);
    const actor = getActor(req as any);
    const id = Number(req.params["id"]);
    const { reviewComments } = req.body as { reviewComments?: string };
    const isAdmin = (req as any).user?.role === "admin";

    // Only admins can approve COA proposals
    if (!isAdmin) {
      return res.status(403).json({
        error: "Hanya admin yang dapat menyetujui proposal COA.",
        code: "COA_PROPOSAL_FORBIDDEN",
      });
    }

    const result = await approveCoaProposal(id, companyId, actor, reviewComments, isAdmin);
    if (!result.ok) return safeError(res, result.errorCode, result.error ?? "Approve failed.");
    return res.json(result.data);
  } catch (err) {
    return res.status(500).json({ error: "Internal error approving proposal." });
  }
});

// ─── POST /accounting/coa-proposals/:id/reject ───────────────────────────────

router.post("/:id/reject", async (req, res) => {
  try {
    const companyId = resolveCompanyId(req as any);
    const actor = getActor(req as any);
    const id = Number(req.params["id"]);
    const { rejectionReason } = req.body as { rejectionReason?: string };
    const isAdmin = (req as any).user?.role === "admin";

    // Only admins can reject COA proposals
    if (!isAdmin) {
      return res.status(403).json({
        error: "Hanya admin yang dapat menolak proposal COA.",
        code: "COA_PROPOSAL_FORBIDDEN",
      });
    }

    if (!rejectionReason?.trim()) {
      return res.status(400).json({
        error: "rejectionReason is required.",
        code: "COA_PROPOSAL_VALIDATION_FAILED",
      });
    }

    const result = await rejectCoaProposal(id, companyId, actor, rejectionReason);
    if (!result.ok) return safeError(res, result.errorCode, result.error ?? "Reject failed.");
    return res.json(result.data);
  } catch (err) {
    return res.status(500).json({ error: "Internal error rejecting proposal." });
  }
});

// ─── POST /accounting/coa-proposals/:id/cancel ───────────────────────────────

router.post("/:id/cancel", async (req, res) => {
  try {
    const companyId = resolveCompanyId(req as any);
    const actor = getActor(req as any);
    const id = Number(req.params["id"]);
    const { reason } = req.body as { reason?: string };

    const result = await cancelCoaProposal(id, companyId, actor, reason);
    if (!result.ok) return safeError(res, result.errorCode, result.error ?? "Cancel failed.");
    return res.json(result.data);
  } catch (err) {
    return res.status(500).json({ error: "Internal error cancelling proposal." });
  }
});

// ─── POST /accounting/coa-proposals/:id/implement ────────────────────────────

router.post("/:id/implement", async (req, res) => {
  try {
    const companyId = resolveCompanyId(req as any);
    const actor = getActor(req as any);
    const id = Number(req.params["id"]);

    const result = await implementApprovedCoaProposal(id, companyId, actor);
    if (!result.ok) return safeError(res, result.errorCode, result.error ?? "Implement failed.");
    return res.json(result.data);
  } catch (err) {
    return res.status(500).json({ error: "Internal error implementing proposal." });
  }
});

export default router;
