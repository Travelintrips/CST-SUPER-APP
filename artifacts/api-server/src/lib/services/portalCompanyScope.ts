import {
  db,
  portalCompanyMembersTable,
  portalCustomersTable,
} from "@workspace/db";
import { and, eq, sql } from "drizzle-orm";
export {
  companyScopesMatch,
  normalizeCompanyId,
} from "./portalCompanyScopeUtils.js";
import { normalizeCompanyId } from "./portalCompanyScopeUtils.js";

export class PortalCompanyScopeError extends Error {
  constructor(
    public readonly statusCode: 409 | 422,
    message: string,
  ) {
    super(message);
    this.name = "PortalCompanyScopeError";
  }
}

type ResolveOptions = {
  required?: boolean;
};

export type PortalCompanyMembershipResolutionRow = {
  portalCustomerId: number;
  companyId: number;
  isActive: boolean;
};

/**
 * Resolve a company from already-fetched membership rows.
 *
 * Keeping the ownership and active-state checks in a small pure function makes
 * the fail-closed contract testable without weakening the DB query below.
 */
export function resolveOwnedActiveCompanyId(
  rows: readonly PortalCompanyMembershipResolutionRow[],
  portalCustomerId: number,
  { required = false }: ResolveOptions = {},
): number | null {
  const companyIds = [...new Set(
    rows
      .filter((row) => row.portalCustomerId === portalCustomerId && row.isActive)
      .map((row) => row.companyId)
      .filter((companyId): companyId is number => Number.isInteger(companyId) && companyId > 0),
  )].sort((a, b) => a - b);

  if (companyIds.length === 1) return companyIds[0];
  if (companyIds.length === 0) {
    if (required) {
      throw new PortalCompanyScopeError(
        422,
        "Customer Portal belum memiliki membership perusahaan aktif.",
      );
    }
    return null;
  }

  if (required) {
    throw new PortalCompanyScopeError(
      409,
      "Customer Portal memiliki lebih dari satu membership perusahaan aktif; pembayaran harus memilih satu perusahaan.",
    );
  }
  return null;
}

/**
 * Resolve the only company an authenticated portal customer may act for.
 *
 * A portal customer can have more than one active membership. We intentionally
 * do not choose one arbitrarily: payment and accounting records must have an
 * unambiguous company owner.
 */
export async function resolvePortalCustomerCompanyId(
  portalCustomerId: number,
  { required = false }: ResolveOptions = {},
): Promise<number | null> {
  const memberships = await db
    .select({
      portalCustomerId: portalCompanyMembersTable.portalCustomerId,
      companyId: portalCompanyMembersTable.companyId,
      isActive: portalCompanyMembersTable.isActive,
    })
    .from(portalCompanyMembersTable)
    .where(and(
      eq(portalCompanyMembersTable.portalCustomerId, portalCustomerId),
    ))
    .orderBy(portalCompanyMembersTable.companyId);

  return resolveOwnedActiveCompanyId(memberships, portalCustomerId, { required });
}

export async function resolvePortalCustomerCompanyIdByEmail(
  email: string,
  options: ResolveOptions = {},
): Promise<number | null> {
  const [customer] = await db
    .select({ id: portalCustomersTable.id })
    .from(portalCustomersTable)
    .where(sql`LOWER(${portalCustomersTable.email}) = LOWER(${email.trim()})`)
    .limit(1);

  if (!customer) {
    if (options.required) {
      throw new PortalCompanyScopeError(
        422,
        "Customer Portal tidak ditemukan atau belum memiliki membership perusahaan aktif.",
      );
    }
    return null;
  }

  return resolvePortalCustomerCompanyId(customer.id, options);
}