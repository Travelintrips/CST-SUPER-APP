import { db } from "@workspace/db";
import { sql } from "drizzle-orm";
import { getVendorWithholdingAccountRule } from "./vendorWithholdingAccountRules.js";

type AccountRow = {
  id: number;
  code: string;
  name: string;
  company_id: number | null;
};

function rowsOf<T>(result: unknown): T[] {
  if (Array.isArray(result)) return result as T[];
  return (((result as Record<string, unknown>)?.rows) ?? []) as T[];
}

/**
 * Resolve the canonical company-scoped liability account for a withholding type.
 * Tax master rows remain a compatibility fallback; dedicated COA identities win.
 */
export async function resolveDefaultWithholdingAccountId(
  companyId: number,
  taxType: string,
): Promise<number | null> {
  const normalized = taxType.trim().toLowerCase().replace(/\s+/g, " ");
  if (!normalized) return null;

  const accountRows = rowsOf<AccountRow>(await db.execute<AccountRow>(sql`
    SELECT id, code, name, company_id
    FROM chart_of_accounts
    WHERE (company_id = ${companyId} OR company_id IS NULL)
      AND type = 'liability'
      AND is_active = true
      AND is_postable = true
  `));

  const companyRank = (row: AccountRow) => row.company_id === companyId ? 0 : 1;
  const rule = getVendorWithholdingAccountRule(normalized);
  const codePrefixes = rule?.codePrefixes ?? [];
  const namePattern = rule?.namePattern ?? null;

  const dedicated = accountRows
    .filter((row) =>
      codePrefixes.some((prefix) => row.code.startsWith(prefix)) ||
      (namePattern ? namePattern.test(row.name) : false),
    )
    .sort((a, b) => {
      const aCode = codePrefixes.findIndex((prefix) => a.code.startsWith(prefix));
      const bCode = codePrefixes.findIndex((prefix) => b.code.startsWith(prefix));
      return companyRank(a) - companyRank(b) || (aCode < 0 ? 99 : aCode) - (bCode < 0 ? 99 : bCode) || a.id - b.id;
    });
  if (dedicated[0]?.id) return Number(dedicated[0].id);

  const fallback = rowsOf<{ account_id: number }>(await db.execute<{ account_id: number }>(sql`
    SELECT at.account_id
    FROM accounting_taxes at
    INNER JOIN chart_of_accounts coa ON coa.id = at.account_id
    WHERE at.company_id = ${companyId}
      AND at.is_active = true
      AND at.kind = 'withholding'
      AND at.account_id IS NOT NULL
      AND (coa.company_id = ${companyId} OR coa.company_id IS NULL)
      AND coa.type = 'liability'
      AND coa.is_active = true
      AND coa.is_postable = true
      AND LOWER(at.name) LIKE ${`%${normalized}%`}
    ORDER BY at.id
    LIMIT 1
  `));
  return fallback[0]?.account_id ? Number(fallback[0].account_id) : null;
}