/**
 * COA Validation Service — Task #5
 *
 * Reusable validators for:
 * - Normal balance inference from account category
 * - Parent-child category compatibility
 * - Postable / header rules
 * - Hierarchy validation (existence, company scope, self-reference, cycle detection)
 * - Account validity for posting (ACTIVE + is_postable + effective date)
 */

import { db } from "@workspace/db";
import { eq, and, sql } from "drizzle-orm";
import { chartOfAccountsTable } from "@workspace/db/schema/accounting";

// ─── Types ────────────────────────────────────────────────────────────────────

export type CoaAccountCategory = typeof chartOfAccountsTable.$inferSelect["accountCategory"];
export type CoaNormalBalance   = typeof chartOfAccountsTable.$inferSelect["normalBalance"];
export type CoaStatus          = typeof chartOfAccountsTable.$inferSelect["status"];

export interface CoaValidationError {
  code: string;
  message: string;
}

export interface HierarchyValidationInput {
  /** ID of the COA being created/updated (null for new) */
  coaId?: number | null;
  /** Proposed parent ID (null = root) */
  parentId?: number | null;
  /** Company of the COA being created/updated */
  companyId: number;
  /** Category of the COA being created/updated */
  accountCategory: CoaAccountCategory;
}

export interface PostingValidationResult {
  valid: boolean;
  errors: CoaValidationError[];
}

// ─── Phase 3: Normal balance defaults ────────────────────────────────────────

/**
 * Returns the canonical normal balance for a given account category.
 * Returns null for CLEARING — must be explicitly set, never inferred.
 */
export function normalBalanceForCategory(
  category: CoaAccountCategory,
): CoaNormalBalance | null {
  const map: Record<CoaAccountCategory, CoaNormalBalance | null> = {
    ASSET:            "DEBIT",
    EXPENSE:          "DEBIT",
    OTHER_EXPENSE:    "DEBIT",
    CONTRA_LIABILITY: "DEBIT",
    CONTRA_REVENUE:   "DEBIT",
    LIABILITY:        "CREDIT",
    EQUITY:           "CREDIT",
    REVENUE:          "CREDIT",
    OTHER_INCOME:     "CREDIT",
    CONTRA_ASSET:     "CREDIT",
    CONTRA_EXPENSE:   "CREDIT",
    CLEARING:         null, // must be explicit
  };
  return map[category] ?? null;
}

// ─── Phase 6: Parent-child category compatibility ────────────────────────────

/**
 * ALLOWED_PARENT_CATEGORIES[childCategory] = set of valid parent categories.
 * An account may be a root (no parent) regardless of this table.
 */
const ALLOWED_PARENT_CATEGORIES: Record<CoaAccountCategory, Set<CoaAccountCategory>> = {
  ASSET:            new Set(["ASSET"]),
  CONTRA_ASSET:     new Set(["ASSET"]),
  LIABILITY:        new Set(["LIABILITY"]),
  CONTRA_LIABILITY: new Set(["LIABILITY"]),
  EQUITY:           new Set(["EQUITY"]),
  REVENUE:          new Set(["REVENUE"]),
  OTHER_INCOME:     new Set(["REVENUE", "OTHER_INCOME"]),
  CONTRA_REVENUE:   new Set(["REVENUE"]),
  EXPENSE:          new Set(["EXPENSE"]),
  OTHER_EXPENSE:    new Set(["EXPENSE", "OTHER_EXPENSE"]),
  CONTRA_EXPENSE:   new Set(["EXPENSE"]),
  // CLEARING may sit under any category when explicitly configured
  CLEARING:         new Set([
    "ASSET", "LIABILITY", "EQUITY", "REVENUE", "EXPENSE",
    "OTHER_INCOME", "OTHER_EXPENSE", "CLEARING",
  ]),
};

export function isParentCategoryCompatible(
  parentCategory: CoaAccountCategory,
  childCategory: CoaAccountCategory,
): boolean {
  return ALLOWED_PARENT_CATEGORIES[childCategory]?.has(parentCategory) ?? false;
}

// ─── Phase 4: Postable / Header rules ────────────────────────────────────────

export function validatePostableRules(input: {
  isHeader: boolean;
  isPostable: boolean;
}): CoaValidationError[] {
  const errors: CoaValidationError[] = [];
  if (input.isHeader && input.isPostable) {
    errors.push({
      code: "HEADER_CANNOT_BE_POSTABLE",
      message: "Akun header (is_header=true) tidak boleh is_postable=true.",
    });
  }
  return errors;
}

// ─── Phase 5: Hierarchy validation ───────────────────────────────────────────

/**
 * Validates parent hierarchy for a COA create/update.
 * Checks:
 * 1. Parent exists (if parentId given)
 * 2. Parent same company (or global)
 * 3. Not self-parent
 * 4. No direct cycle (parent is not a descendant of coaId)
 * 5. Parent-child category compatible
 * 6. Parent is ACTIVE or DRAFT (allowed statuses for hierarchy)
 */
export async function validateCoaHierarchy(
  input: HierarchyValidationInput,
): Promise<CoaValidationError[]> {
  const errors: CoaValidationError[] = [];
  const { coaId, parentId, companyId, accountCategory } = input;

  if (parentId == null) return errors; // root account — always valid hierarchy

  // 1. Self-reference
  if (coaId != null && parentId === coaId) {
    errors.push({
      code: "SELF_PARENT",
      message: "Akun tidak bisa menjadi parent dirinya sendiri.",
    });
    return errors; // stop here — further checks need a valid parent
  }

  // 2. Parent must exist
  const [parent] = await db
    .select({
      id: chartOfAccountsTable.id,
      companyId: chartOfAccountsTable.companyId,
      accountCategory: chartOfAccountsTable.accountCategory,
      status: chartOfAccountsTable.status,
    })
    .from(chartOfAccountsTable)
    .where(eq(chartOfAccountsTable.id, parentId));

  if (!parent) {
    errors.push({
      code: "PARENT_NOT_FOUND",
      message: `Parent akun id=${parentId} tidak ditemukan.`,
    });
    return errors;
  }

  // 3. Company scope — parent must belong to same company (or be global null)
  if (parent.companyId !== null && parent.companyId !== companyId) {
    errors.push({
      code: "PARENT_CROSS_COMPANY",
      message: "Parent akun harus dari perusahaan yang sama.",
    });
  }

  // 4. Parent status — must be ACTIVE or DRAFT (not INACTIVE/ARCHIVED/REJECTED)
  const ALLOWED_PARENT_STATUSES: CoaStatus[] = ["ACTIVE", "DRAFT", "PENDING_APPROVAL"];
  if (!ALLOWED_PARENT_STATUSES.includes(parent.status as CoaStatus)) {
    errors.push({
      code: "PARENT_NOT_ACTIVE",
      message: `Parent akun status=${parent.status} — harus ACTIVE, DRAFT, atau PENDING_APPROVAL.`,
    });
  }

  // 5. Category compatibility
  if (!isParentCategoryCompatible(parent.accountCategory, accountCategory)) {
    errors.push({
      code: "INCOMPATIBLE_CATEGORY",
      message: `Kategori ${accountCategory} tidak bisa di bawah parent kategori ${parent.accountCategory}. Gunakan parent yang kompatibel atau tentukan kebijakan eksplisit untuk CLEARING.`,
    });
  }

  // 6. Cycle detection — parent must not be a descendant of coaId
  if (coaId != null) {
    const hasCycle = await isDescendant(parentId, coaId);
    if (hasCycle) {
      errors.push({
        code: "CYCLE_DETECTED",
        message: "Perubahan parent ini akan membentuk cycle pada hierarki akun.",
      });
    }
  }

  return errors;
}

/**
 * Returns true if `candidateAncestorId` is an ancestor of `nodeId`
 * (i.e., nodeId is a descendant of candidateAncestorId).
 * Used to detect cycles before reparenting.
 */
async function isDescendant(
  nodeId: number,
  candidateAncestorId: number,
  maxDepth = 50,
): Promise<boolean> {
  // Walk UP the tree from nodeId — if we reach candidateAncestorId, there's a cycle
  let current: number | null = nodeId;
  let depth = 0;

  while (current != null && depth < maxDepth) {
    if (current === candidateAncestorId) return true;

    const rowsResult = await db
      .select({ parentId: chartOfAccountsTable.parentId })
      .from(chartOfAccountsTable)
      .where(eq(chartOfAccountsTable.id, current));
    const row: { parentId: number | null } | undefined = rowsResult[0];

    current = row?.parentId ?? null;
    depth++;
  }
  return false;
}

// ─── Phase 14: Account posting validity ──────────────────────────────────────

/**
 * Validates that an account is valid for use in a journal posting.
 * Fail-closed: any DB error returns invalid.
 */
export async function validateAccountForPosting(
  accountId: number,
  companyId: number,
  now: Date = new Date(),
): Promise<PostingValidationResult> {
  const errors: CoaValidationError[] = [];

  let account: typeof chartOfAccountsTable.$inferSelect | undefined;
  try {
    const [row] = await db
      .select()
      .from(chartOfAccountsTable)
      .where(eq(chartOfAccountsTable.id, accountId));
    account = row;
  } catch {
    return {
      valid: false,
      errors: [{ code: "DB_ERROR", message: `Gagal memvalidasi akun id=${accountId}.` }],
    };
  }

  if (!account) {
    return {
      valid: false,
      errors: [{ code: "ACCOUNT_NOT_FOUND", message: `Akun id=${accountId} tidak ditemukan.` }],
    };
  }

  // Company isolation
  if (account.companyId !== null && account.companyId !== companyId) {
    errors.push({
      code: "ACCOUNT_CROSS_COMPANY",
      message: `Akun id=${accountId} bukan milik company ${companyId}.`,
    });
  }

  // Status must be ACTIVE
  if (account.status !== "ACTIVE") {
    errors.push({
      code: "ACCOUNT_NOT_ACTIVE",
      message: `Akun "${account.code} — ${account.name}" status=${account.status} tidak bisa dipakai posting (harus ACTIVE).`,
    });
  }

  // Must be postable
  if (!account.isPostable) {
    errors.push({
      code: "ACCOUNT_NOT_POSTABLE",
      message: `Akun "${account.code} — ${account.name}" adalah akun header/non-postable (is_postable=false) — tidak bisa dipakai untuk posting jurnal.`,
    });
  }

  // Effective date range
  if (account.effectiveFrom && now < account.effectiveFrom) {
    errors.push({
      code: "ACCOUNT_NOT_YET_EFFECTIVE",
      message: `Akun "${account.code}" belum efektif (effective_from=${account.effectiveFrom.toISOString()}).`,
    });
  }
  if (account.effectiveTo && now > account.effectiveTo) {
    errors.push({
      code: "ACCOUNT_EXPIRED",
      message: `Akun "${account.code}" sudah kadaluwarsa (effective_to=${account.effectiveTo.toISOString()}).`,
    });
  }

  return { valid: errors.length === 0, errors };
}

/**
 * Convenience: validate multiple account IDs at once.
 * Returns combined error list.
 */
export async function validateAccountsForPosting(
  accountIds: number[],
  companyId: number,
  now: Date = new Date(),
): Promise<PostingValidationResult> {
  const allErrors: CoaValidationError[] = [];
  for (const id of accountIds) {
    const result = await validateAccountForPosting(id, companyId, now);
    allErrors.push(...result.errors);
  }
  return { valid: allErrors.length === 0, errors: allErrors };
}
