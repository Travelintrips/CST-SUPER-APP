export type CoaNormalBalance = "DEBIT" | "CREDIT";
export type CoaCategory =
  | "ASSET" | "LIABILITY" | "EQUITY" | "REVENUE" | "EXPENSE"
  | "OTHER_INCOME" | "OTHER_EXPENSE" | "CONTRA_ASSET" | "CONTRA_LIABILITY"
  | "CONTRA_REVENUE" | "CONTRA_EXPENSE" | "CLEARING";

export const COA_CATEGORIES: readonly CoaCategory[] = [
  "ASSET", "LIABILITY", "EQUITY", "REVENUE", "EXPENSE", "OTHER_INCOME",
  "OTHER_EXPENSE", "CONTRA_ASSET", "CONTRA_LIABILITY", "CONTRA_REVENUE",
  "CONTRA_EXPENSE", "CLEARING",
];

export const DEFAULT_NORMAL_BALANCE: Record<Exclude<CoaCategory, "CLEARING">, CoaNormalBalance> = {
  ASSET: "DEBIT",
  EXPENSE: "DEBIT",
  OTHER_EXPENSE: "DEBIT",
  CONTRA_LIABILITY: "DEBIT",
  CONTRA_REVENUE: "DEBIT",
  LIABILITY: "CREDIT",
  EQUITY: "CREDIT",
  REVENUE: "CREDIT",
  OTHER_INCOME: "CREDIT",
  CONTRA_ASSET: "CREDIT",
  CONTRA_EXPENSE: "CREDIT",
};

export type CoaHierarchyAccount = {
  id: number;
  companyId: number | null;
  parentId: number | null;
  accountCategory: CoaCategory;
  status: string;
  isHeader: boolean;
  isPostable: boolean;
};

export type CoaHierarchyCandidate = Omit<CoaHierarchyAccount, "id"> & { id?: number };

export type CoaValidationIssue = {
  code:
    | "PARENT_NOT_FOUND"
    | "CROSS_COMPANY_PARENT"
    | "SELF_PARENT"
    | "CYCLE"
    | "INACTIVE_PARENT"
    | "INCOMPATIBLE_CATEGORY"
    | "HEADER_POSTABLE_CONFLICT"
    | "INVALID_EFFECTIVE_RANGE";
  message: string;
};

const CHILD_CATEGORIES: Record<string, readonly string[]> = {
  ASSET: ["ASSET", "CONTRA_ASSET", "CLEARING"],
  LIABILITY: ["LIABILITY", "CONTRA_LIABILITY", "CLEARING"],
  EQUITY: ["EQUITY", "CLEARING"],
  REVENUE: ["REVENUE", "CONTRA_REVENUE"],
  EXPENSE: ["EXPENSE", "CONTRA_EXPENSE", "OTHER_EXPENSE"],
  OTHER_INCOME: ["OTHER_INCOME", "CONTRA_REVENUE"],
  OTHER_EXPENSE: ["EXPENSE", "OTHER_EXPENSE", "CONTRA_EXPENSE"],
  CLEARING: ["CLEARING"],
};

export function validateCoaHierarchy(
  accounts: readonly CoaHierarchyAccount[],
  candidate: CoaHierarchyCandidate,
  opts: { allowDraftParent?: boolean } = {},
): CoaValidationIssue[] {
  const issues: CoaValidationIssue[] = [];
  if (candidate.isHeader && candidate.isPostable) {
    issues.push({ code: "HEADER_POSTABLE_CONFLICT", message: "Akun header tidak boleh postable." });
  }
  if (candidate.parentId == null) return issues;

  const parent = accounts.find((account) => account.id === candidate.parentId);
  if (!parent) {
    issues.push({ code: "PARENT_NOT_FOUND", message: "Parent akun tidak ditemukan." });
    return issues;
  }
  if (candidate.id != null && parent.id === candidate.id) {
    issues.push({ code: "SELF_PARENT", message: "Akun tidak bisa menjadi parent-nya sendiri." });
  }
  if (parent.companyId !== null && parent.companyId !== candidate.companyId) {
    issues.push({ code: "CROSS_COMPANY_PARENT", message: "Parent akun harus dari perusahaan yang sama." });
  }
  if (!opts.allowDraftParent && !["ACTIVE"].includes(parent.status)) {
    issues.push({ code: "INACTIVE_PARENT", message: "Parent akun harus ACTIVE." });
  }
  const allowed = CHILD_CATEGORIES[parent.accountCategory] ?? [];
  if (!allowed.includes(candidate.accountCategory)) {
    issues.push({
      code: "INCOMPATIBLE_CATEGORY",
      message: `${candidate.accountCategory} tidak kompatibel di bawah ${parent.accountCategory}.`,
    });
  }

  const byId = new Map(accounts.map((account) => [account.id, account]));
  if (candidate.id != null) {
    const replacement = candidate as CoaHierarchyAccount;
    byId.set(candidate.id, replacement);
  }
  const visited = new Set<number>();
  let currentId: number | null = candidate.parentId;
  while (currentId != null) {
    if (candidate.id != null && currentId === candidate.id) {
      issues.push({ code: "CYCLE", message: "Perubahan parent membentuk cycle." });
      break;
    }
    if (visited.has(currentId)) {
      issues.push({ code: "CYCLE", message: "Struktur parent membentuk cycle." });
      break;
    }
    visited.add(currentId);
    currentId = byId.get(currentId)?.parentId ?? null;
  }
  return issues;
}

export function inferNormalBalance(category: CoaCategory): CoaNormalBalance | null {
  return category === "CLEARING" ? null : DEFAULT_NORMAL_BALANCE[category];
}

export function isEffectiveOn(
  effectiveFrom: Date | string | null | undefined,
  effectiveTo: Date | string | null | undefined,
  date: Date,
): boolean {
  const from = effectiveFrom ? new Date(effectiveFrom).getTime() : Number.NEGATIVE_INFINITY;
  const to = effectiveTo ? new Date(effectiveTo).getTime() : Number.POSITIVE_INFINITY;
  return from <= date.getTime() && date.getTime() <= to;
}