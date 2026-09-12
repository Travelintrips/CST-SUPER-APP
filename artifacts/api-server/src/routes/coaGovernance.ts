/**
 * COA Governance Router — Task #5 (Phase 12)
 *
 * Routes:
 *   GET    /accounting/coa                              → full COA list with governance fields
 *   GET    /accounting/coa/:id                          → single COA
 *   GET    /accounting/coa/:id/history                  → version history
 *   POST   /accounting/coa/change-requests              → create change request
 *   GET    /accounting/coa/change-requests              → list change requests
 *   GET    /accounting/coa/change-requests/:id          → single change request
 *   POST   /accounting/coa/change-requests/:id/submit   → submit for approval
 *   POST   /accounting/coa/change-requests/:id/approve  → approve (checker)
 *   POST   /accounting/coa/change-requests/:id/reject   → reject (checker)
 *   POST   /accounting/coa/change-requests/:id/cancel   → cancel (maker)
 *
 * Mounted BEFORE the main accountingRouter in routes/index.ts at /accounting/coa.
 */

import { Router } from "express";
import { eq, and, or, isNull, desc } from "drizzle-orm";
import { db } from "@workspace/db";
import {
  chartOfAccountsTable,
  coaChangeRequestsTable,
  coaVersionsTable,
} from "@workspace/db/schema/accounting";
import { resolveCompanyId, resolveCompanyScope } from "../lib/resolveCompany.js";
import { requireAdmin } from "../lib/requireAdmin.js";
import {
  createChangeRequest,
  submitChangeRequest,
  approveChangeRequest,
  rejectChangeRequest,
  cancelChangeRequest,
} from "../lib/coa/coaChangeRequestService.js";
import {
  validateCoaHierarchy,
  validatePostableRules,
  normalBalanceForCategory,
  type CoaAccountCategory,
} from "../lib/coa/coaValidation.js";
import { z } from "zod/v4";

const router = Router();

// ─── Helpers ─────────────────────────────────────────────────────────────────

function getActor(req: Express.Request): string {
  return String((req as any).user?.id ?? (req as any).user?.email ?? "system");
}

function httpErrorForCode(code: string | undefined): number {
  if (!code) return 500;
  if (code === "NOT_FOUND") return 404;
  if (code === "FORBIDDEN" || code === "SELF_APPROVE" || code === "SELF_REVIEW") return 403;
  if (code === "DUPLICATE_IDEMPOTENCY") return 409;
  if (code === "INVALID_STATUS" || code === "HIERARCHY_INVALID" || code === "POLICY_INVALID") return 422;
  return 400;
}

// ─── GET /accounting/coa ─────────────────────────────────────────────────────

router.get("/", async (req, res) => {
  try {
    const scope = resolveCompanyScope(req as any);
    const condition = scope === "all"
      ? undefined
      : or(isNull(chartOfAccountsTable.companyId), eq(chartOfAccountsTable.companyId, scope));

    const rows = await db
      .select()
      .from(chartOfAccountsTable)
      .where(condition)
      .orderBy(chartOfAccountsTable.code);

    return res.json(rows.map(serializeCoaRow));
  } catch (err) {
    return res.status(500).json({ message: String((err as Error).message) });
  }
});

// ─── GET /accounting/coa/change-requests ─────────────────────────────────────

router.get("/change-requests", async (req, res) => {
  try {
    const companyId = resolveCompanyId(req as any);
    const status = req.query["status"] as string | undefined;

    const conditions = [eq(coaChangeRequestsTable.companyId, companyId)];
    if (status) {
      const validStatuses = ["DRAFT", "PENDING_APPROVAL", "APPROVED", "REJECTED", "CANCELLED"];
      if (validStatuses.includes(status.toUpperCase())) {
        conditions.push(eq(coaChangeRequestsTable.status, status.toUpperCase() as any));
      }
    }

    const rows = await db
      .select()
      .from(coaChangeRequestsTable)
      .where(and(...conditions))
      .orderBy(desc(coaChangeRequestsTable.createdAt));

    return res.json(rows.map(serializeChangeRequest));
  } catch (err) {
    return res.status(500).json({ message: String((err as Error).message) });
  }
});

// ─── GET /accounting/coa/change-requests/:id ─────────────────────────────────

router.get("/change-requests/:id", async (req, res) => {
  try {
    const id = Number(req.params["id"]);
    const companyId = resolveCompanyId(req as any);

    const [cr] = await db
      .select()
      .from(coaChangeRequestsTable)
      .where(and(eq(coaChangeRequestsTable.id, id), eq(coaChangeRequestsTable.companyId, companyId)));

    if (!cr) return res.status(404).json({ message: "Change request tidak ditemukan." });
    return res.json(serializeChangeRequest(cr));
  } catch (err) {
    return res.status(500).json({ message: String((err as Error).message) });
  }
});

// ─── POST /accounting/coa/change-requests ────────────────────────────────────

const createCrSchema = z.object({
  coaId: z.number().int().positive().nullable().optional(),
  action: z.enum(["CREATE", "UPDATE", "UPDATE_NAME", "UPDATE_CODE", "UPDATE_PARENT",
                   "UPDATE_CATEGORY", "UPDATE_NORMAL_BALANCE", "UPDATE_POSTABLE",
                   "ACTIVATE", "DEACTIVATE", "ARCHIVE"]),
  afterSnapshot: z.record(z.string(), z.unknown()),
  reason: z.string().min(1, "Reason wajib diisi."),
  idempotencyKey: z.string().min(1, "Idempotency key wajib diisi."),
});

router.post("/change-requests", async (req, res) => {
  try {
    const companyId = resolveCompanyId(req as any);
    const actor = getActor(req);

    const parsed = createCrSchema.safeParse(req.body ?? {});
    if (!parsed.success) {
      return res.status(400).json({ message: "Validasi gagal.", errors: parsed.error.issues });
    }

    const { coaId, action, afterSnapshot, reason, idempotencyKey } = parsed.data;

    // Pre-validate hierarchy/policy before creating the change request
    if (action === "CREATE" || action === "UPDATE_PARENT" || action === "UPDATE_CATEGORY") {
      const parentId = afterSnapshot["parentId"] as number | null ?? null;
      const accountCategory = afterSnapshot["accountCategory"] as CoaAccountCategory ?? "ASSET";
      const hierarchyErrors = await validateCoaHierarchy({
        coaId: coaId ?? undefined,
        parentId,
        companyId,
        accountCategory,
      });
      if (hierarchyErrors.length > 0) {
        return res.status(422).json({ message: "Validasi hierarchy gagal.", errors: hierarchyErrors });
      }
    }

    if (action === "CREATE" || action === "UPDATE_POSTABLE") {
      const isHeader   = Boolean(afterSnapshot["isHeader"]   ?? false);
      const isPostable = Boolean(afterSnapshot["isPostable"] ?? true);
      const postableErrors = validatePostableRules({ isHeader, isPostable });
      if (postableErrors.length > 0) {
        return res.status(422).json({ message: "Validasi postable/header gagal.", errors: postableErrors });
      }
    }

    // Auto-assign normal balance if not provided and category is known
    const enrichedSnapshot = { ...afterSnapshot };
    if (!enrichedSnapshot["normalBalance"] && enrichedSnapshot["accountCategory"]) {
      const inferred = normalBalanceForCategory(enrichedSnapshot["accountCategory"] as CoaAccountCategory);
      if (inferred) enrichedSnapshot["normalBalance"] = inferred;
    }

    const result = await createChangeRequest({
      companyId,
      coaId: coaId ?? null,
      action,
      afterSnapshot: enrichedSnapshot,
      reason,
      requestedBy: actor,
      idempotencyKey,
    });

    if (!result.ok) {
      return res.status(httpErrorForCode(result.errorCode)).json({ message: result.error });
    }
    return res.status(201).json(serializeChangeRequest(result.data!));
  } catch (err) {
    return res.status(500).json({ message: String((err as Error).message) });
  }
});

// ─── POST /accounting/coa/change-requests/:id/submit ─────────────────────────

router.post("/change-requests/:id/submit", async (req, res) => {
  try {
    const id = Number(req.params["id"]);
    const companyId = resolveCompanyId(req as any);
    const actor = getActor(req);

    const result = await submitChangeRequest(id, actor, companyId);
    if (!result.ok) {
      return res.status(httpErrorForCode(result.errorCode)).json({ message: result.error });
    }
    return res.json({ message: "Change request berhasil disubmit untuk persetujuan." });
  } catch (err) {
    return res.status(500).json({ message: String((err as Error).message) });
  }
});

// ─── POST /accounting/coa/change-requests/:id/approve ────────────────────────

router.post("/change-requests/:id/approve", async (req, res) => {
  try {
    if (!(await requireAdmin(req as any, res))) return;
    const id = Number(req.params["id"]);
    const companyId = resolveCompanyId(req as any);
    const actor = getActor(req);
    const comments = String(req.body?.["comments"] ?? "").trim() || undefined;

    const result = await approveChangeRequest(id, actor, companyId, comments);
    if (!result.ok) {
      return res.status(httpErrorForCode(result.errorCode)).json({ message: result.error });
    }
    return res.json({ message: "Change request berhasil disetujui dan COA master diperbarui." });
  } catch (err) {
    return res.status(500).json({ message: String((err as Error).message) });
  }
});

// ─── POST /accounting/coa/change-requests/:id/reject ─────────────────────────

router.post("/change-requests/:id/reject", async (req, res) => {
  try {
    if (!(await requireAdmin(req as any, res))) return;
    const id = Number(req.params["id"]);
    const companyId = resolveCompanyId(req as any);
    const actor = getActor(req);
    const comments = String(req.body?.["comments"] ?? "").trim() || undefined;

    const result = await rejectChangeRequest(id, actor, companyId, comments);
    if (!result.ok) {
      return res.status(httpErrorForCode(result.errorCode)).json({ message: result.error });
    }
    return res.json({ message: "Change request ditolak." });
  } catch (err) {
    return res.status(500).json({ message: String((err as Error).message) });
  }
});

// ─── POST /accounting/coa/change-requests/:id/cancel ─────────────────────────

router.post("/change-requests/:id/cancel", async (req, res) => {
  try {
    const id = Number(req.params["id"]);
    const companyId = resolveCompanyId(req as any);
    const actor = getActor(req);

    const result = await cancelChangeRequest(id, actor, companyId);
    if (!result.ok) {
      // Admin can cancel any request — retry without maker check
      if (result.errorCode === "FORBIDDEN") {
        const isAdmin = await requireAdmin(req as any, { ...res, json: () => res, status: () => res } as any);
        if (isAdmin) {
          // Admin override: re-cancel ignoring maker check
          const crRows = await db
            .select()
            .from(coaChangeRequestsTable)
            .where(and(eq(coaChangeRequestsTable.id, id), eq(coaChangeRequestsTable.companyId, companyId)));
          const cr = crRows[0];
          if (!cr) return res.status(404).json({ message: "Change request tidak ditemukan." });
          await db
            .update(coaChangeRequestsTable)
            .set({ status: "CANCELLED", updatedAt: new Date() })
            .where(eq(coaChangeRequestsTable.id, id));
          return res.json({ message: "Change request dibatalkan oleh admin." });
        }
      }
      return res.status(httpErrorForCode(result.errorCode)).json({ message: result.error });
    }
    return res.json({ message: "Change request dibatalkan." });
  } catch (err) {
    return res.status(500).json({ message: String((err as Error).message) });
  }
});

// ─── GET /accounting/coa/:id ─────────────────────────────────────────────────

router.get("/:id", async (req, res) => {
  try {
    const id = Number(req.params["id"]);
    const companyId = resolveCompanyId(req as any);

    const [coa] = await db
      .select()
      .from(chartOfAccountsTable)
      .where(eq(chartOfAccountsTable.id, id));

    if (!coa) return res.status(404).json({ message: "COA tidak ditemukan." });
    if (coa.companyId !== null && coa.companyId !== companyId) {
      return res.status(403).json({ message: "Akses ditolak." });
    }
    return res.json(serializeCoaRow(coa));
  } catch (err) {
    return res.status(500).json({ message: String((err as Error).message) });
  }
});

// ─── GET /accounting/coa/:id/history ─────────────────────────────────────────

router.get("/:id/history", async (req, res) => {
  try {
    const id = Number(req.params["id"]);
    const companyId = resolveCompanyId(req as any);

    // Verify access
    const [coa] = await db
      .select({ id: chartOfAccountsTable.id, companyId: chartOfAccountsTable.companyId })
      .from(chartOfAccountsTable)
      .where(eq(chartOfAccountsTable.id, id));

    if (!coa) return res.status(404).json({ message: "COA tidak ditemukan." });
    if (coa.companyId !== null && coa.companyId !== companyId) {
      return res.status(403).json({ message: "Akses ditolak." });
    }

    const versions = await db
      .select()
      .from(coaVersionsTable)
      .where(and(eq(coaVersionsTable.coaId, id), eq(coaVersionsTable.companyId, companyId)))
      .orderBy(desc(coaVersionsTable.version));

    return res.json(versions.map(v => ({
      id:              v.id,
      version:         v.version,
      snapshotJson:    v.snapshotJson,
      changeRequestId: v.changeRequestId,
      effectiveFrom:   v.effectiveFrom?.toISOString()  ?? null,
      effectiveTo:     v.effectiveTo?.toISOString()    ?? null,
      createdBy:       v.createdBy,
      approvedBy:      v.approvedBy,
      createdAt:       v.createdAt.toISOString(),
    })));
  } catch (err) {
    return res.status(500).json({ message: String((err as Error).message) });
  }
});

// ─── Serializers ─────────────────────────────────────────────────────────────

function serializeCoaRow(row: typeof chartOfAccountsTable.$inferSelect) {
  return {
    id:              row.id,
    companyId:       row.companyId,
    code:            row.code,
    name:            row.name,
    type:            row.type,
    subtype:         row.subtype,
    parentId:        row.parentId,
    isActive:        row.isActive,
    normalBalance:   row.normalBalance,
    accountCategory: row.accountCategory,
    isPostable:      row.isPostable,
    isHeader:        row.isHeader,
    effectiveFrom:   row.effectiveFrom?.toISOString()  ?? null,
    effectiveTo:     row.effectiveTo?.toISOString()    ?? null,
    status:          row.status,
    version:         row.version,
    createdBy:       row.createdBy,
    updatedBy:       row.updatedBy,
    approvedBy:      row.approvedBy,
    approvedAt:      row.approvedAt?.toISOString()   ?? null,
    rejectedBy:      row.rejectedBy,
    rejectedAt:      row.rejectedAt?.toISOString()   ?? null,
    rejectionReason: row.rejectionReason,
    createdAt:       row.createdAt.toISOString(),
    updatedAt:       row.updatedAt.toISOString(),
  };
}

function serializeChangeRequest(row: typeof coaChangeRequestsTable.$inferSelect) {
  return {
    id:                  row.id,
    companyId:           row.companyId,
    coaId:               row.coaId,
    action:              row.action,
    status:              row.status,
    beforeSnapshotJson:  row.beforeSnapshotJson,
    afterSnapshotJson:   row.afterSnapshotJson,
    reason:              row.reason,
    requestedBy:         row.requestedBy,
    requestedAt:         row.requestedAt.toISOString(),
    reviewedBy:          row.reviewedBy,
    reviewedAt:          row.reviewedAt?.toISOString()  ?? null,
    reviewComments:      row.reviewComments,
    idempotencyKey:      row.idempotencyKey,
    createdAt:           row.createdAt.toISOString(),
    updatedAt:           row.updatedAt.toISOString(),
  };
}

export default router;
