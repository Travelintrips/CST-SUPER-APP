import type { DbClient } from "./accounting.js";
import { sql } from "drizzle-orm";

type AccountRow = {
  id: number;
  code: string;
  name: string;
  type: string;
  is_active: boolean;
  is_postable: boolean;
  status: string | null;
};

type VendorPayableQueryClient = Pick<DbClient, "execute">;

const DIRECT_VENDOR_PAYABLE_NAME = [
  /hutang\s+(pemasok|vendor|supplier)/i,
  /(vendor|supplier)\s+payable/i,
  /accounts?\s+payable/i,
  /trade\s+payable/i,
  /hutang\s+dagang/i,
];

function isDirectVendorPayableAccount(account: AccountRow): boolean {
  return (
    account.type === "liability" &&
    account.is_active === true &&
    account.is_postable === true &&
    String(account.status ?? "").toUpperCase() === "ACTIVE" &&
    DIRECT_VENDOR_PAYABLE_NAME.some((pattern) => pattern.test(account.name))
  );
}

function rowsOf<T>(result: unknown): T[] {
  if (Array.isArray(result)) return result as T[];
  return (((result as Record<string, unknown>)?.rows) ?? []) as T[];
}

/**
 * Resolve the company-scoped posting account for vendor payable activity.
 *
 * accounting_settings.ap_account_id is historically allowed to point at the
 * Hutang Usaha hierarchy parent. Vendor invoices and their settlements must
 * post to one explicit, postable Hutang Pemasok/Vendor account instead.
 */
export async function resolveVendorPayableAccountId(
  client: VendorPayableQueryClient,
  companyId: number,
  configuredApAccountId: number,
): Promise<number> {
  const configuredRows = rowsOf<AccountRow>(await client.execute(sql`
    SELECT id, code, name, type, is_active, is_postable, status::text AS status
    FROM chart_of_accounts
    WHERE id = ${configuredApAccountId}
      AND company_id = ${companyId}
    LIMIT 1
  `));
  const configured = configuredRows[0];

  if (!configured) {
    throw new Error("Akun hutang pada Accounting Settings tidak ditemukan untuk perusahaan aktif.");
  }

  if (isDirectVendorPayableAccount(configured)) {
    return Number(configured.id);
  }

  const childRows = rowsOf<AccountRow>(await client.execute(sql`
    WITH RECURSIVE descendants AS (
      SELECT id, parent_id, code, name, type, is_active, is_postable,
             status::text AS status
      FROM chart_of_accounts
      WHERE company_id = ${companyId}
        AND parent_id = ${configuredApAccountId}
      UNION ALL
      SELECT child.id, child.parent_id, child.code, child.name, child.type,
             child.is_active, child.is_postable, child.status::text AS status
      FROM chart_of_accounts child
      INNER JOIN descendants parent ON parent.id = child.parent_id
      WHERE child.company_id = ${companyId}
    )
    SELECT id, code, name, type, is_active, is_postable, status
    FROM descendants
    WHERE type = 'liability'
      AND is_active = TRUE
      AND is_postable = TRUE
      AND status = 'ACTIVE'
      AND (
        name ILIKE '%Hutang Pemasok%'
        OR name ILIKE '%Hutang Vendor%'
        OR name ILIKE '%Hutang Supplier%'
        OR name ILIKE '%Vendor Payable%'
        OR name ILIKE '%Supplier Payable%'
        OR name ILIKE '%Accounts Payable%'
        OR name ILIKE '%Trade Payable%'
        OR name ILIKE '%Hutang Dagang%'
      )
    ORDER BY code, id
    LIMIT 2
  `));

  if (childRows.length !== 1) {
    throw new Error(
      childRows.length === 0
        ? "Child COA Hutang Pemasok/Vendor belum tersedia di bawah akun hutang pada Accounting Settings."
        : "Terdapat lebih dari satu child COA Hutang Pemasok/Vendor; Finance harus menetapkan satu akun posting.",
    );
  }

  return Number(childRows[0]!.id);
}