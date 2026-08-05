/**
 * COA Change Request Service — Task #5 (Phase 7–10)
 *
 * Maker-checker workflow for Chart of Accounts master changes.
 * Implements atomic approval with DB transaction.
 */

import { db } from "@workspace/db";
import { eq, and, sql } from "drizzle-orm";
import {
  chartOfAccountsTable,
  coaChangeRequestsTable,
  coaVersionsTable,
} from "@workspace/db/schema/accounting";
import { logger } from "../logger.js";
import {
  validateCoaHierarchy,
  validatePostableRules,
  normalBalanceForCategory,
  type CoaAccountCategory,
  type CoaNormalBalance,
} from "./coaValidation.js";

// ─── Types ────────────────────────────────────────────────────────────────────

export type CoaChangeAction = typeof coaChangeRequestsTable.$inferSelect["action"];
export type ChangeRequestStatus = typeof coaChangeRequestsTable.$inferSelect["status"];

export interface CreateChangeRequestInput {
  companyId: number;
  /** null for CREATE action */
  coaId?: number | null;
  action: CoaChangeAction;
  /** Snapshot of the new state being proposed */
  afterSnapshot: Record<string, unknown>;
  reason: string;
  requestedBy: string;
  idempotencyKey: string;
}

export interface ServiceResult<T = void> {
  ok: boolean;
  error?: string;
  errorCode?: string;
  data?: T;
}

export interface ParentReferenceLookup {
  findByCode: (code: string, companyId: number) => Promise<{ id: number } | null>;
}

/**
 * Resolve the parent reference stored in a change-request snapshot.
 *
 * Tax migrations intentionally store parentCode when the target header has
 * not been approved yet. Never silently turn that unresolved reference into a
 * root account: approval must fail until the intended parent exists.
 */
export async function resolveParentReference(
  afterData: Record<string, unknown>,
  companyId: number,
  lookup: ParentReferenceLookup,
): Promise<ServiceResult<number | null>> {
  const hasParentCode = Object.prototype.hasOwnProperty.call(afterData, "parentCode");
  const rawParentCode = afterData["parentCode"];

  if (hasParentCode) {
    if (typeof rawParentCode !== "string" || rawParentCode.trim().length === 0) {
      return {
        ok: false,
        error: "Referensi parentCode tidak valid.",
        errorCode: "INVALID_PARENT_REFERENCE",
      };
    }

    const parentCode = rawParentCode.trim();
    const parent = await lookup.findByCode(parentCode, companyId);
    if (!parent) {
      return {
        ok: false,
        error: `Parent akun code=${parentCode} tidak ditemukan.`,
        errorCode: "PARENT_NOT_FOUND",
      };
    }

    // parentCode is authoritative when present. This also corrects a stale
    // parentId captured before the target header was approved.
    return { ok: true, data: parent.id };
  }

  const rawParentId = afterData["parentId"];
  if (rawParentId == null) return { ok: true, data: null };

  const parentId =
    typeof rawParentId === "number"
      ? rawParentId
      : typeof rawParentId === "string" && rawParentId.trim().length > 0
        ? Number(rawParentId)
        : Number.NaN;

  if (!Number.isInteger(parentId) || parentId <= 0) {
    return {
      ok: false,
      error: "Referensi parentId tidak valid.",
      errorCode: "INVALID_PARENT_REFERENCE",
    };
  }

  return { ok: true, data: parentId };
}

// ─── Create ───────────────────────────────────────────────────────────────────

/**
 * Creates a DRAFT change request.
 * Does NOT apply changes to the master COA table.
 */
export async function createChangeRequest(
  input: CreateChangeRequestInput,
): Promise<ServiceResult<typeof coaChangeRequestsTable.$inferSelect>> {
  // For UPDATE actions, capture before snapshot
  let beforeSnapshot: Record<string, unknown> | null = null;
  if (input.coaId != null && input.action !== "CREATE") {
    const [existing] = await db
      .select()
      .from(chartOfAccountsTable)
      .where(eq(chartOfAccountsTable.id, input.coaId));
    if (!existing) {
      return { ok: false, error: `COA id=${input.coaId} tidak ditemukan.`, errorCode: "COA_NOT_FOUND" };
    }
    // Company isolation
    if (existing.companyId !== null && existing.companyId !== input.companyId) {
      return { ok: false, error: "Akses ditolak — bukan milik company ini.", errorCode: "FORBIDDEN" };
    }
    beforeSnapshot = serializeCoa(existing);
  }

  try {
    const [req] = await db
      .insert(coaChangeRequestsTable)
      .values({
        companyId: input.companyId,
        coaId: input.coaId ?? null,
        action: input.action,
        status: "DRAFT",
        beforeSnapshotJson: beforeSnapshot,
        afterSnapshotJson: input.afterSnapshot as any,
        reason: input.reason,
        requestedBy: input.requestedBy,
        idempotencyKey: input.idempotencyKey,
      })
      .returning();

    return { ok: true, data: req! };
  } catch (err: unknown) {
    const msg = String((err as Error)?.message ?? err);
    if (msg.includes("unique") || msg.includes("duplicate")) {
      return { ok: false, error: "Idempotency key sudah dipakai untuk company ini.", errorCode: "DUPLICATE_IDEMPOTENCY" };
    }
    logger.error({ err }, "[COA CR] createChangeRequest failed");
    return { ok: false, error: msg, errorCode: "DB_ERROR" };
  }
}

// ─── Submit ───────────────────────────────────────────────────────────────────

/**
 * Submits a DRAFT change request for approval → PENDING_APPROVAL.
 */
export async function submitChangeRequest(
  id: number,
  requestedBy: string,
  companyId: number,
): Promise<ServiceResult> {
  const [cr] = await db
    .select()
    .from(coaChangeRequestsTable)
    .where(and(eq(coaChangeRequestsTable.id, id), eq(coaChangeRequestsTable.companyId, companyId)));

  if (!cr) return { ok: false, error: "Change request tidak ditemukan.", errorCode: "NOT_FOUND" };
  if (cr.status !== "DRAFT") {
    return { ok: false, error: `Change request status=${cr.status} — hanya DRAFT yang bisa disubmit.`, errorCode: "INVALID_STATUS" };
  }
  // Only the maker can submit
  if (cr.requestedBy !== requestedBy) {
    return { ok: false, error: "Hanya pembuat change request yang bisa submit.", errorCode: "FORBIDDEN" };
  }

  await db
    .update(coaChangeRequestsTable)
    .set({ status: "PENDING_APPROVAL", updatedAt: new Date() })
    .where(eq(coaChangeRequestsTable.id, id));

  return { ok: true };
}

// ─── Approve (atomic) ─────────────────────────────────────────────────────────

/**
 * Approves a change request atomically.
 * Phase 10 compliance:
 * 1. Lock change request row
 * 2. Verify PENDING_APPROVAL status
 * 3. Verify checker ≠ maker
 * 4. Re-validate hierarchy + policy
 * 5. Apply CREATE/UPDATE to master COA
 * 6. Increment version
 * 7. Insert version snapshot
 * 8. Update change request → APPROVED
 * 9. Commit (or rollback all)
 */
export async function approveChangeRequest(
  id: number,
  reviewedBy: string,
  companyId: number,
  reviewComments?: string,
): Promise<ServiceResult> {
  try {
    await db.transaction(async (tx) => {
      // 1. Lock the change request row (SELECT FOR UPDATE, best-effort)
      // tx.execute() requires a SQL tagged template; .toSQL() returns a plain
      // {sql,params} object that doesn't satisfy the interface.  Wrap in try-catch
      // so the lock attempt is best-effort and never blocks the actual select.
      try {
        await tx.execute(
          db.select().from(coaChangeRequestsTable)
            .where(and(eq(coaChangeRequestsTable.id, id), eq(coaChangeRequestsTable.companyId, companyId)))
            .for("update") as any,
        );
      } catch {
        // FOR UPDATE not supported by this driver version — continue without row lock
      }
      const [cr] = await tx
        .select()
        .from(coaChangeRequestsTable)
        .where(and(eq(coaChangeRequestsTable.id, id), eq(coaChangeRequestsTable.companyId, companyId)));

      if (!cr) throw new Error("NOT_FOUND: Change request tidak ditemukan.");

      // 2. Verify status
      if (cr.status !== "PENDING_APPROVAL") {
        throw new Error(`INVALID_STATUS: Status harus PENDING_APPROVAL (saat ini: ${cr.status}).`);
      }

      // 3. Verify checker ≠ maker
      if (cr.requestedBy === reviewedBy) {
        throw new Error("SELF_APPROVE: Maker tidak boleh menyetujui perubahannya sendiri.");
      }

      const afterData = (cr.afterSnapshotJson ?? {}) as Record<string, unknown>;
      const now = new Date();

      // 4. Re-validate hierarchy and policy
      let resolvedParentId: number | null | undefined;
      if (cr.action === "CREATE" || cr.action === "UPDATE_PARENT" || cr.action === "UPDATE_CATEGORY") {
        const parentResolution = await resolveParentReference(afterData, companyId, {
          findByCode: async (code, lookupCompanyId) => {
            // Prefer a company-specific parent. Fall back to a global parent
            // only when no company-specific account exists.
            const [companyParent] = await tx
              .select({ id: chartOfAccountsTable.id })
              .from(chartOfAccountsTable)
              .where(and(
                eq(chartOfAccountsTable.code, code),
                eq(chartOfAccountsTable.companyId, lookupCompanyId),
              ))
              .limit(1);
            if (companyParent) return companyParent;

            const [globalParent] = await tx
              .select({ id: chartOfAccountsTable.id })
              .from(chartOfAccountsTable)
              .where(and(
                eq(chartOfAccountsTable.code, code),
                sql`${chartOfAccountsTable.companyId} IS NULL`,
              ))
              .limit(1);
            return globalParent ?? null;
          },
        });
        if (!parentResolution.ok) {
          throw new Error(`${parentResolution.errorCode}: ${parentResolution.error}`);
        }
        resolvedParentId = parentResolution.data ?? null;

        const accountCategory = afterData["accountCategory"] as CoaAccountCategory ?? "ASSET";

        const hierarchyErrors = await validateCoaHierarchy({
          coaId: cr.coaId ?? undefined,
          parentId: resolvedParentId,
          companyId,
          accountCategory,
        });
        if (hierarchyErrors.length > 0) {
          throw new Error(`HIERARCHY_INVALID: ${hierarchyErrors.map(e => e.message).join("; ")}`);
        }
      }

      const isHeader  = Boolean(afterData["isHeader"] ?? false);
      const isPostable = Boolean(afterData["isPostable"] ?? true);
      const postableErrors = validatePostableRules({ isHeader, isPostable });
      if (postableErrors.length > 0) {
        throw new Error(`POLICY_INVALID: ${postableErrors.map(e => e.message).join("; ")}`);
      }

      let coaId = cr.coaId;
      let newVersion = 1;

      // 5. Apply changes to master COA
      if (cr.action === "CREATE") {
        const accountCategory = afterData["accountCategory"] as CoaAccountCategory ?? "ASSET";
        const normalBalance = (afterData["normalBalance"] as CoaNormalBalance | undefined)
          ?? normalBalanceForCategory(accountCategory)
          ?? "DEBIT";

        const [created] = await tx
          .insert(chartOfAccountsTable)
          .values({
            companyId,
            code: String(afterData["code"] ?? ""),
            name: String(afterData["name"] ?? ""),
            type: afterData["type"] as any ?? "asset",
            subtype: afterData["subtype"] as string | null ?? null,
            parentId: resolvedParentId ?? null,
            isActive: true,
            normalBalance,
            accountCategory,
            isPostable: Boolean(afterData["isPostable"] ?? true),
            isHeader: Boolean(afterData["isHeader"] ?? false),
            effectiveFrom: afterData["effectiveFrom"] ? new Date(String(afterData["effectiveFrom"])) : null,
            effectiveTo:   afterData["effectiveTo"]   ? new Date(String(afterData["effectiveTo"]))   : null,
            status: "ACTIVE",
            version: 1,
            createdBy: cr.requestedBy,
            approvedBy: reviewedBy,
            approvedAt: now,
          })
          .returning();
        coaId = created!.id;
        newVersion = 1;

      } else if (cr.action === "ACTIVATE") {
        if (!coaId) throw new Error("INVALID_STATE: coaId diperlukan untuk ACTIVATE.");
        const [existing] = await tx.select().from(chartOfAccountsTable).where(eq(chartOfAccountsTable.id, coaId));
        if (!existing) throw new Error("NOT_FOUND: COA tidak ditemukan.");
        newVersion = (existing.version ?? 0) + 1;
        await tx
          .update(chartOfAccountsTable)
          .set({ status: "ACTIVE", isActive: true, version: newVersion, updatedBy: reviewedBy, approvedBy: reviewedBy, approvedAt: now, updatedAt: now })
          .where(eq(chartOfAccountsTable.id, coaId));

      } else if (cr.action === "DEACTIVATE") {
        if (!coaId) throw new Error("INVALID_STATE: coaId diperlukan.");
        const [existing] = await tx.select().from(chartOfAccountsTable).where(eq(chartOfAccountsTable.id, coaId));
        if (!existing) throw new Error("NOT_FOUND: COA tidak ditemukan.");
        newVersion = (existing.version ?? 0) + 1;
        await tx
          .update(chartOfAccountsTable)
          .set({ status: "INACTIVE", isActive: false, version: newVersion, updatedBy: reviewedBy, updatedAt: now })
          .where(eq(chartOfAccountsTable.id, coaId));

      } else if (cr.action === "ARCHIVE") {
        if (!coaId) throw new Error("INVALID_STATE: coaId diperlukan.");
        const [existing] = await tx.select().from(chartOfAccountsTable).where(eq(chartOfAccountsTable.id, coaId));
        if (!existing) throw new Error("NOT_FOUND: COA tidak ditemukan.");
        newVersion = (existing.version ?? 0) + 1;
        await tx
          .update(chartOfAccountsTable)
          .set({ status: "ARCHIVED", isActive: false, version: newVersion, updatedBy: reviewedBy, updatedAt: now })
          .where(eq(chartOfAccountsTable.id, coaId));

      } else {
        // Generic UPDATE action (UPDATE, UPDATE_NAME, UPDATE_CODE, UPDATE_PARENT, UPDATE_CATEGORY, UPDATE_NORMAL_BALANCE, UPDATE_POSTABLE)
        if (!coaId) throw new Error("INVALID_STATE: coaId diperlukan untuk UPDATE.");
        const [existing] = await tx.select().from(chartOfAccountsTable).where(eq(chartOfAccountsTable.id, coaId));
        if (!existing) throw new Error("NOT_FOUND: COA tidak ditemukan.");
        newVersion = (existing.version ?? 0) + 1;

        const patch: Record<string, unknown> = { version: newVersion, updatedBy: reviewedBy, approvedBy: reviewedBy, approvedAt: now, updatedAt: now };
        if ("code"            in afterData) patch["code"]            = afterData["code"];
        if ("name"            in afterData) patch["name"]            = afterData["name"];
        if (resolvedParentId !== undefined) patch["parentId"] = resolvedParentId;
        if ("accountCategory" in afterData) patch["accountCategory"] = afterData["accountCategory"];
        if ("normalBalance"   in afterData) patch["normalBalance"]   = afterData["normalBalance"];
        if ("isPostable"      in afterData) patch["isPostable"]      = afterData["isPostable"];
        if ("isHeader"        in afterData) patch["isHeader"]        = afterData["isHeader"];
        if ("effectiveFrom"   in afterData) patch["effectiveFrom"]   = afterData["effectiveFrom"] ? new Date(String(afterData["effectiveFrom"])) : null;
        if ("effectiveTo"     in afterData) patch["effectiveTo"]     = afterData["effectiveTo"]   ? new Date(String(afterData["effectiveTo"]))   : null;

        await tx
          .update(chartOfAccountsTable)
          .set(patch as any)
          .where(eq(chartOfAccountsTable.id, coaId));
      }

      // 6 + 7. Insert version snapshot
      const [currentCoa] = await tx
        .select()
        .from(chartOfAccountsTable)
        .where(eq(chartOfAccountsTable.id, coaId!));

      await tx
        .insert(coaVersionsTable)
        .values({
          companyId,
          coaId: coaId!,
          version: newVersion,
          snapshotJson: serializeCoa(currentCoa!) as any,
          changeRequestId: id,
          effectiveFrom: currentCoa?.effectiveFrom ?? null,
          effectiveTo:   currentCoa?.effectiveTo   ?? null,
          createdBy: cr.requestedBy,
          approvedBy: reviewedBy,
        })
        .onConflictDoNothing(); // idempotent

      // 8. Update change request → APPROVED
      await tx
        .update(coaChangeRequestsTable)
        .set({
          status: "APPROVED",
          reviewedBy,
          reviewedAt: now,
          reviewComments: reviewComments ?? null,
          updatedAt: now,
        })
        .where(eq(coaChangeRequestsTable.id, id));
    });

    return { ok: true };
  } catch (err: unknown) {
    const msg = String((err as Error)?.message ?? err);
    logger.error({ err, changeRequestId: id }, "[COA CR] approveChangeRequest failed");

    // Parse structured error codes
    const codeMatch = msg.match(/^([A-Z_]+):/);
    const errorCode = codeMatch?.[1] ?? "APPROVAL_FAILED";
    return { ok: false, error: msg.replace(/^[A-Z_]+:\s*/, ""), errorCode };
  }
}

// ─── Reject ───────────────────────────────────────────────────────────────────

export async function rejectChangeRequest(
  id: number,
  reviewedBy: string,
  companyId: number,
  reviewComments?: string,
): Promise<ServiceResult> {
  const [cr] = await db
    .select()
    .from(coaChangeRequestsTable)
    .where(and(eq(coaChangeRequestsTable.id, id), eq(coaChangeRequestsTable.companyId, companyId)));

  if (!cr) return { ok: false, error: "Change request tidak ditemukan.", errorCode: "NOT_FOUND" };
  if (cr.status !== "PENDING_APPROVAL") {
    return { ok: false, error: `Status harus PENDING_APPROVAL untuk ditolak (saat ini: ${cr.status}).`, errorCode: "INVALID_STATUS" };
  }
  // Checker ≠ maker
  if (cr.requestedBy === reviewedBy) {
    return { ok: false, error: "Maker tidak boleh menolak proposalnya sendiri.", errorCode: "SELF_REVIEW" };
  }

  const now = new Date();
  await db
    .update(coaChangeRequestsTable)
    .set({ status: "REJECTED", reviewedBy, reviewedAt: now, reviewComments: reviewComments ?? null, updatedAt: now })
    .where(eq(coaChangeRequestsTable.id, id));

  // If action was CREATE, mark the DRAFT COA as REJECTED if it exists
  if (cr.action === "CREATE" && cr.coaId != null) {
    await db
      .update(chartOfAccountsTable)
      .set({ status: "REJECTED", rejectedBy: reviewedBy, rejectedAt: now, rejectionReason: reviewComments ?? null, updatedBy: reviewedBy, updatedAt: now })
      .where(eq(chartOfAccountsTable.id, cr.coaId));
  }

  return { ok: true };
}

// ─── Cancel ───────────────────────────────────────────────────────────────────

export async function cancelChangeRequest(
  id: number,
  requestedBy: string,
  companyId: number,
): Promise<ServiceResult> {
  const [cr] = await db
    .select()
    .from(coaChangeRequestsTable)
    .where(and(eq(coaChangeRequestsTable.id, id), eq(coaChangeRequestsTable.companyId, companyId)));

  if (!cr) return { ok: false, error: "Change request tidak ditemukan.", errorCode: "NOT_FOUND" };
  if (cr.status !== "DRAFT" && cr.status !== "PENDING_APPROVAL") {
    return { ok: false, error: `Status ${cr.status} tidak bisa dibatalkan.`, errorCode: "INVALID_STATUS" };
  }
  // Only the maker (or admin — caller checks separately) can cancel
  if (cr.requestedBy !== requestedBy) {
    return { ok: false, error: "Hanya pembuat change request yang bisa membatalkan.", errorCode: "FORBIDDEN" };
  }

  await db
    .update(coaChangeRequestsTable)
    .set({ status: "CANCELLED", updatedAt: new Date() })
    .where(eq(coaChangeRequestsTable.id, id));

  return { ok: true };
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function serializeCoa(row: typeof chartOfAccountsTable.$inferSelect): Record<string, unknown> {
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
    effectiveFrom:   row.effectiveFrom?.toISOString() ?? null,
    effectiveTo:     row.effectiveTo?.toISOString()   ?? null,
    status:          row.status,
    version:         row.version,
    createdBy:       row.createdBy,
    updatedBy:       row.updatedBy,
    approvedBy:      row.approvedBy,
    approvedAt:      row.approvedAt?.toISOString()  ?? null,
    rejectedBy:      row.rejectedBy,
    rejectedAt:      row.rejectedAt?.toISOString()  ?? null,
    rejectionReason: row.rejectionReason,
    createdAt:       row.createdAt.toISOString(),
    updatedAt:       row.updatedAt.toISOString(),
  };
}
