import {
  db,
  companiesTable,
  portalCompanyMembersTable,
  portalCustomersTable,
} from "@workspace/db";
import { and, asc, eq } from "drizzle-orm";

const BUYER_ROLES = new Set(["requester", "procurement", "finance", "admin", "viewer"]);

export class PortalCompanyMembershipError extends Error {
  constructor(
    public readonly statusCode: 400 | 404 | 409,
    message: string,
  ) {
    super(message);
    this.name = "PortalCompanyMembershipError";
  }
}

export type PortalCompanyMembershipInput = {
  customerId: number;
  companyId: number;
  buyerRole?: string;
  department?: string | null;
  costCenter?: string | null;
  approvalLevel?: number | null;
  spendingLimit?: string | null;
  invitedBy?: number | null;
};

function optionalText(value: unknown): string | null | undefined {
  if (value === undefined) return undefined;
  if (value === null) return null;
  const trimmed = String(value).trim();
  return trimmed || null;
}

function assertPositiveInteger(value: number, label: string): void {
  if (!Number.isInteger(value) || value <= 0) {
    throw new PortalCompanyMembershipError(400, `${label} tidak valid.`);
  }
}

export async function listPortalCustomerMemberships(customerId: number) {
  assertPositiveInteger(customerId, "Customer ID");

  return db
    .select({
      id: portalCompanyMembersTable.id,
      portalCustomerId: portalCompanyMembersTable.portalCustomerId,
      companyId: portalCompanyMembersTable.companyId,
      companyName: companiesTable.companyName,
      companyCode: companiesTable.companyCode,
      companyActive: companiesTable.isActive,
      buyerRole: portalCompanyMembersTable.buyerRole,
      department: portalCompanyMembersTable.department,
      costCenter: portalCompanyMembersTable.costCenter,
      approvalLevel: portalCompanyMembersTable.approvalLevel,
      spendingLimit: portalCompanyMembersTable.spendingLimit,
      isActive: portalCompanyMembersTable.isActive,
      invitedBy: portalCompanyMembersTable.invitedBy,
      invitedAt: portalCompanyMembersTable.invitedAt,
      joinedAt: portalCompanyMembersTable.joinedAt,
      createdAt: portalCompanyMembersTable.createdAt,
      updatedAt: portalCompanyMembersTable.updatedAt,
    })
    .from(portalCompanyMembersTable)
    .innerJoin(companiesTable, eq(companiesTable.id, portalCompanyMembersTable.companyId))
    .where(eq(portalCompanyMembersTable.portalCustomerId, customerId))
    .orderBy(asc(portalCompanyMembersTable.createdAt));
}

/**
 * Assign or reactivate a customer membership.
 *
 * The company ID is deliberately an explicit admin input. Free-form values on
 * portal_customers.company and customer-submitted profile fields are never used
 * as an authority for this relationship.
 */
export async function assignPortalCustomerMembership(input: PortalCompanyMembershipInput) {
  assertPositiveInteger(input.customerId, "Customer ID");
  assertPositiveInteger(input.companyId, "Company ID");

  const buyerRole = input.buyerRole ?? "requester";
  if (!BUYER_ROLES.has(buyerRole)) {
    throw new PortalCompanyMembershipError(400, "Buyer role tidak valid.");
  }

  if (input.approvalLevel !== undefined && input.approvalLevel !== null
      && (!Number.isInteger(input.approvalLevel) || input.approvalLevel < 1)) {
    throw new PortalCompanyMembershipError(400, "Approval level tidak valid.");
  }

  const now = new Date();
  return db.transaction(async (tx) => {
    const [customer] = await tx
      .select({
        id: portalCustomersTable.id,
        accountStatus: portalCustomersTable.accountStatus,
      })
      .from(portalCustomersTable)
      .where(eq(portalCustomersTable.id, input.customerId))
      .limit(1);
    if (!customer) throw new PortalCompanyMembershipError(404, "Customer tidak ditemukan.");
    if (customer.accountStatus !== "active") {
      throw new PortalCompanyMembershipError(409, "Customer harus berstatus aktif.");
    }

    const [company] = await tx
      .select({
        id: companiesTable.id,
        companyName: companiesTable.companyName,
        companyCode: companiesTable.companyCode,
        isActive: companiesTable.isActive,
      })
      .from(companiesTable)
      .where(eq(companiesTable.id, input.companyId))
      .limit(1);
    if (!company) throw new PortalCompanyMembershipError(404, "Company tidak ditemukan.");
    if (!company.isActive) {
      throw new PortalCompanyMembershipError(409, "Company tidak aktif.");
    }

    const [membership] = await tx
      .insert(portalCompanyMembersTable)
      .values({
        portalCustomerId: input.customerId,
        companyId: input.companyId,
        buyerRole,
        department: optionalText(input.department) ?? null,
        costCenter: optionalText(input.costCenter) ?? null,
        approvalLevel: input.approvalLevel ?? null,
        spendingLimit: optionalText(input.spendingLimit) ?? null,
        isActive: true,
        invitedBy: input.invitedBy && input.invitedBy > 0 ? input.invitedBy : null,
        invitedAt: now,
        joinedAt: now,
        updatedAt: now,
      })
      .onConflictDoUpdate({
        target: [portalCompanyMembersTable.portalCustomerId, portalCompanyMembersTable.companyId],
        set: {
          buyerRole,
          department: optionalText(input.department) ?? null,
          costCenter: optionalText(input.costCenter) ?? null,
          approvalLevel: input.approvalLevel ?? null,
          spendingLimit: optionalText(input.spendingLimit) ?? null,
          isActive: true,
          invitedBy: input.invitedBy && input.invitedBy > 0 ? input.invitedBy : null,
          invitedAt: now,
          joinedAt: now,
          updatedAt: now,
        },
      })
      .returning();

    return {
      ...membership,
      companyName: company.companyName,
      companyCode: company.companyCode,
      companyActive: company.isActive,
    };
  });
}

export async function deactivatePortalCustomerMembership(customerId: number, companyId: number) {
  assertPositiveInteger(customerId, "Customer ID");
  assertPositiveInteger(companyId, "Company ID");

  const [updated] = await db
    .update(portalCompanyMembersTable)
    .set({ isActive: false, updatedAt: new Date() })
    .where(and(
      eq(portalCompanyMembersTable.portalCustomerId, customerId),
      eq(portalCompanyMembersTable.companyId, companyId),
    ))
    .returning({ id: portalCompanyMembersTable.id });

  if (!updated) throw new PortalCompanyMembershipError(404, "Membership tidak ditemukan.");
  return updated;
}