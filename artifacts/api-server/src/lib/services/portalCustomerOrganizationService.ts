import {
  db,
  companiesTable,
  portalCompanyMembersTable,
  portalCompanyRequestsTable,
  portalCustomersTable,
} from "@workspace/db";
import { and, asc, desc, eq, ilike, isNull, or } from "drizzle-orm";
import {
  assignPortalCustomerMembership,
  PortalCompanyMembershipError,
} from "./portalCompanyMembershipService.js";

export type CustomerType = "individual" | "company";

export class PortalCustomerOrganizationError extends Error {
  constructor(
    public readonly statusCode: 400 | 404 | 409 | 422,
    message: string,
  ) {
    super(message);
    this.name = "PortalCustomerOrganizationError";
  }
}

function positiveId(value: unknown, label: string): number {
  const id = Number(value);
  if (!Number.isInteger(id) || id <= 0) {
    throw new PortalCustomerOrganizationError(400, `${label} tidak valid.`);
  }
  return id;
}

function cleanName(value: unknown): string {
  const name = String(value ?? "").trim().replace(/\s+/g, " ");
  if (name.length < 2) {
    throw new PortalCustomerOrganizationError(400, "Nama perusahaan wajib diisi.");
  }
  return name;
}

/** Only active, non-holding ERP entities are exposed to public portal buyers. */
export async function listCustomerPortalCompanies(search?: string) {
  const q = String(search ?? "").trim();
  const conditions = [
    eq(companiesTable.isActive, true),
    eq(companiesTable.isHolding, false),
  ];
  if (q) {
    conditions.push(or(
      ilike(companiesTable.companyName, `%${q}%`),
      ilike(companiesTable.companyCode, `%${q}%`),
    )!);
  }

  return db
    .select({
      id: companiesTable.id,
      name: companiesTable.companyName,
      code: companiesTable.companyCode,
      city: companiesTable.city,
      province: companiesTable.province,
    })
    .from(companiesTable)
    .where(and(...conditions))
    .orderBy(asc(companiesTable.companyName))
    .limit(100);
}

export async function resolveSelectableCustomerPortalCompany(companyId: unknown) {
  const id = positiveId(companyId, "Company ID");
  const [company] = await db
    .select({
      id: companiesTable.id,
      name: companiesTable.companyName,
      code: companiesTable.companyCode,
    })
    .from(companiesTable)
    .where(and(
      eq(companiesTable.id, id),
      eq(companiesTable.isActive, true),
      eq(companiesTable.isHolding, false),
    ))
    .limit(1);
  if (!company) {
    throw new PortalCustomerOrganizationError(422, "Company tidak tersedia untuk Customer Portal.");
  }
  return company;
}

export async function getPortalCustomerOrganizationState(customerId: number) {
  const id = positiveId(customerId, "Customer ID");
  const [customer] = await db
    .select({
      id: portalCustomersTable.id,
      customerType: portalCustomersTable.customerType,
      company: portalCustomersTable.company,
    })
    .from(portalCustomersTable)
    .where(eq(portalCustomersTable.id, id))
    .limit(1);
  if (!customer) throw new PortalCustomerOrganizationError(404, "Customer tidak ditemukan.");

  const memberships = await db
    .select({
      id: portalCompanyMembersTable.id,
      companyId: portalCompanyMembersTable.companyId,
      companyName: companiesTable.companyName,
      companyCode: companiesTable.companyCode,
      isActive: portalCompanyMembersTable.isActive,
      buyerRole: portalCompanyMembersTable.buyerRole,
      department: portalCompanyMembersTable.department,
      costCenter: portalCompanyMembersTable.costCenter,
    })
    .from(portalCompanyMembersTable)
    .innerJoin(companiesTable, eq(companiesTable.id, portalCompanyMembersTable.companyId))
    .where(eq(portalCompanyMembersTable.portalCustomerId, id))
    .orderBy(asc(portalCompanyMembersTable.createdAt));

  const requests = await db
    .select({
      id: portalCompanyRequestsTable.id,
      requestedCompanyName: portalCompanyRequestsTable.requestedCompanyName,
      requestedRegistrationNumber: portalCompanyRequestsTable.requestedRegistrationNumber,
      status: portalCompanyRequestsTable.status,
      matchedCompanyId: portalCompanyRequestsTable.matchedCompanyId,
      reviewNote: portalCompanyRequestsTable.reviewNote,
      createdAt: portalCompanyRequestsTable.createdAt,
      updatedAt: portalCompanyRequestsTable.updatedAt,
    })
    .from(portalCompanyRequestsTable)
    .where(eq(portalCompanyRequestsTable.portalCustomerId, id))
    .orderBy(desc(portalCompanyRequestsTable.createdAt));

  return { customer, memberships, requests };
}

/**
 * Complete the company part of registration/onboarding. A selected company is
 * always revalidated against the canonical directory; an unknown company only
 * creates a reviewable request and never a company or membership.
 */
export async function configureCustomerOrganization(input: {
  customerId: number;
  customerType: CustomerType;
  companyId?: unknown;
  requestedCompanyName?: unknown;
  requestedRegistrationNumber?: unknown;
}) {
  const customerId = positiveId(input.customerId, "Customer ID");
  if (input.customerType === "individual") {
    await db.transaction(async (tx) => {
      await tx.update(portalCompanyMembersTable)
        .set({ isActive: false, updatedAt: new Date() })
        .where(eq(portalCompanyMembersTable.portalCustomerId, customerId));
      await tx.update(portalCustomersTable)
        .set({ company: null, customerType: "individual" })
        .where(eq(portalCustomersTable.id, customerId));
    });
    return { customerType: "individual" as const, companyId: null, membership: null, pendingRequest: null };
  }

  if (input.customerType !== "company") {
    throw new PortalCustomerOrganizationError(400, "Tipe customer tidak valid.");
  }

  await db.update(portalCustomersTable)
    .set({ customerType: "company" })
    .where(eq(portalCustomersTable.id, customerId));

  if (input.companyId !== undefined && input.companyId !== null && String(input.companyId).trim() !== "") {
    const company = await resolveSelectableCustomerPortalCompany(input.companyId);
    try {
      const membership = await assignPortalCustomerMembership({
        customerId,
        companyId: company.id,
        buyerRole: "requester",
      });
      await db.update(portalCustomersTable)
        .set({ company: company.name })
        .where(eq(portalCustomersTable.id, customerId));
      return { customerType: "company" as const, companyId: company.id, membership, pendingRequest: null };
    } catch (error) {
      if (error instanceof PortalCompanyMembershipError) {
        throw new PortalCustomerOrganizationError(error.statusCode, error.message);
      }
      throw error;
    }
  }

  const requestedCompanyName = cleanName(input.requestedCompanyName);
  const requestedRegistrationNumber = input.requestedRegistrationNumber
    ? String(input.requestedRegistrationNumber).trim().slice(0, 100)
    : null;
  const [existing] = await db
    .select()
    .from(portalCompanyRequestsTable)
    .where(and(
      eq(portalCompanyRequestsTable.portalCustomerId, customerId),
      eq(portalCompanyRequestsTable.status, "pending"),
      eq(portalCompanyRequestsTable.requestedCompanyName, requestedCompanyName),
    ))
    .orderBy(desc(portalCompanyRequestsTable.createdAt))
    .limit(1);
  if (existing) {
    return { customerType: "company" as const, companyId: null, membership: null, pendingRequest: existing };
  }

  const [request] = await db.insert(portalCompanyRequestsTable).values({
    portalCustomerId: customerId,
    requestedCompanyName,
    requestedRegistrationNumber,
    status: "pending",
  }).returning();
  return { customerType: "company" as const, companyId: null, membership: null, pendingRequest: request };
}

export async function listPendingPortalCompanyRequests() {
  return db
    .select({
      id: portalCompanyRequestsTable.id,
      portalCustomerId: portalCompanyRequestsTable.portalCustomerId,
      customerName: portalCustomersTable.name,
      customerEmail: portalCustomersTable.email,
      customerPhone: portalCustomersTable.phone,
      requestedCompanyName: portalCompanyRequestsTable.requestedCompanyName,
      requestedRegistrationNumber: portalCompanyRequestsTable.requestedRegistrationNumber,
      status: portalCompanyRequestsTable.status,
      matchedCompanyId: portalCompanyRequestsTable.matchedCompanyId,
      matchedCompanyName: companiesTable.companyName,
      reviewNote: portalCompanyRequestsTable.reviewNote,
      createdAt: portalCompanyRequestsTable.createdAt,
      reviewedAt: portalCompanyRequestsTable.reviewedAt,
    })
    .from(portalCompanyRequestsTable)
    .innerJoin(portalCustomersTable, eq(portalCustomersTable.id, portalCompanyRequestsTable.portalCustomerId))
    .leftJoin(companiesTable, eq(companiesTable.id, portalCompanyRequestsTable.matchedCompanyId))
    .where(eq(portalCompanyRequestsTable.status, "pending"))
    .orderBy(asc(portalCompanyRequestsTable.createdAt));
}

export async function reviewPortalCompanyRequest(input: {
  requestId: number;
  adminCustomerId: number;
  action: "approve" | "reject";
  companyId?: unknown;
  reviewNote?: unknown;
}) {
  const requestId = positiveId(input.requestId, "Request ID");
  const adminCustomerId = positiveId(input.adminCustomerId, "Admin ID");
  const note = input.reviewNote ? String(input.reviewNote).trim().slice(0, 1000) : null;

  if (input.action === "reject") {
    const [updated] = await db.update(portalCompanyRequestsTable)
      .set({ status: "rejected", reviewNote: note, reviewedBy: adminCustomerId, reviewedAt: new Date(), updatedAt: new Date() })
      .where(and(eq(portalCompanyRequestsTable.id, requestId), eq(portalCompanyRequestsTable.status, "pending")))
      .returning();
    if (!updated) throw new PortalCustomerOrganizationError(409, "Request sudah direview atau tidak ditemukan.");
    return updated;
  }

  if (input.action !== "approve") {
    throw new PortalCustomerOrganizationError(400, "Aksi review tidak valid.");
  }
  const company = await resolveSelectableCustomerPortalCompany(input.companyId);
  return db.transaction(async (tx) => {
    const [request] = await tx.select()
      .from(portalCompanyRequestsTable)
      .where(and(eq(portalCompanyRequestsTable.id, requestId), eq(portalCompanyRequestsTable.status, "pending")))
      .limit(1);
    if (!request) throw new PortalCustomerOrganizationError(409, "Request sudah direview atau tidak ditemukan.");

    const now = new Date();
    const [membership] = await tx.insert(portalCompanyMembersTable).values({
      portalCustomerId: request.portalCustomerId,
      companyId: company.id,
      buyerRole: "requester",
      isActive: true,
      invitedBy: adminCustomerId,
      invitedAt: now,
      joinedAt: now,
      updatedAt: now,
    }).onConflictDoUpdate({
      target: [portalCompanyMembersTable.portalCustomerId, portalCompanyMembersTable.companyId],
      set: { isActive: true, buyerRole: "requester", invitedBy: adminCustomerId, invitedAt: now, joinedAt: now, updatedAt: now },
    }).returning();

    const [updated] = await tx.update(portalCompanyRequestsTable)
      .set({ status: "approved", matchedCompanyId: company.id, reviewNote: note, reviewedBy: adminCustomerId, reviewedAt: now, updatedAt: now })
      .where(eq(portalCompanyRequestsTable.id, requestId))
      .returning();
    await tx.update(portalCustomersTable)
      .set({ customerType: "company", company: company.name })
      .where(eq(portalCustomersTable.id, request.portalCustomerId));
    return { request: updated, membership };
  });
}