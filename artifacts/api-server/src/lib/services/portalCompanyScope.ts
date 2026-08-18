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
    .select({ companyId: portalCompanyMembersTable.companyId })
    .from(portalCompanyMembersTable)
    .where(and(
      eq(portalCompanyMembersTable.portalCustomerId, portalCustomerId),
      eq(portalCompanyMembersTable.isActive, true),
    ))
    .orderBy(portalCompanyMembersTable.companyId);

  const companyIds = [...new Set(
    memberships
      .map((row) => row.companyId)
      .filter((companyId): companyId is number => companyId != null),
  )];

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