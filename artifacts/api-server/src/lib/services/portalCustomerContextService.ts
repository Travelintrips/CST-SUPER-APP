import {
  db,
  companiesTable,
  portalCompanyMembersTable,
  portalCompanyRequestsTable,
  portalCustomersTable,
} from "@workspace/db";
import { and, asc, desc, eq } from "drizzle-orm";

export type PortalCustomerType = "individual" | "company";
export type PortalCustomerContextStatus =
  | "individual"
  | "company_mapped"
  | "company_pending"
  | "company_unresolved"
  | "legacy_unresolved";

/**
 * Canonical customer context.
 *
 * The session customer id is the only input that identifies the customer.
 * Company access is then derived from an active portal_company_members row;
 * portal_customers.company and browser payloads are display-only legacy data.
 */
export type PortalCustomerContext = {
  customer: {
    id: number;
    name: string;
    email: string;
    phone: string | null;
    customerType: PortalCustomerType | null;
    legacyCompany: string | null;
  };
  customerType: PortalCustomerType | null;
  status: PortalCustomerContextStatus;
  companyId: number | null;
  company: {
    id: number;
    name: string;
    code: string | null;
    buyerRole: string;
    department: string | null;
    costCenter: string | null;
    approvalLevel: number | null;
  } | null;
  activeMemberships: Array<{
    id: number;
    companyId: number;
    companyName: string;
    companyCode: string | null;
    buyerRole: string;
    department: string | null;
    costCenter: string | null;
    approvalLevel: number | null;
  }>;
  pendingRequest: {
    id: number;
    requestedCompanyName: string;
    requestedRegistrationNumber: string | null;
    status: string;
    matchedCompanyId: number | null;
    reviewNote: string | null;
    createdAt: Date;
    updatedAt: Date;
  } | null;
};

export class PortalCustomerContextError extends Error {
  constructor(public readonly statusCode: 404 | 422, message: string) {
    super(message);
    this.name = "PortalCustomerContextError";
  }
}

export async function getPortalCustomerContext(customerId: number): Promise<PortalCustomerContext> {
  if (!Number.isInteger(customerId) || customerId <= 0) {
    throw new PortalCustomerContextError(404, "Customer tidak ditemukan.");
  }

  const [customer] = await db
    .select({
      id: portalCustomersTable.id,
      name: portalCustomersTable.name,
      email: portalCustomersTable.email,
      phone: portalCustomersTable.phone,
      customerType: portalCustomersTable.customerType,
      legacyCompany: portalCustomersTable.company,
    })
    .from(portalCustomersTable)
    .where(eq(portalCustomersTable.id, customerId))
    .limit(1);

  if (!customer) {
    throw new PortalCustomerContextError(404, "Customer tidak ditemukan.");
  }

  const memberships = await db
    .select({
      id: portalCompanyMembersTable.id,
      companyId: portalCompanyMembersTable.companyId,
      companyName: companiesTable.companyName,
      companyCode: companiesTable.companyCode,
      buyerRole: portalCompanyMembersTable.buyerRole,
      department: portalCompanyMembersTable.department,
      costCenter: portalCompanyMembersTable.costCenter,
      approvalLevel: portalCompanyMembersTable.approvalLevel,
    })
    .from(portalCompanyMembersTable)
    .innerJoin(companiesTable, eq(companiesTable.id, portalCompanyMembersTable.companyId))
    .where(and(
      eq(portalCompanyMembersTable.portalCustomerId, customerId),
      eq(portalCompanyMembersTable.isActive, true),
    ))
    .orderBy(asc(portalCompanyMembersTable.createdAt));

  const [pendingRequest] = await db
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
    .where(and(
      eq(portalCompanyRequestsTable.portalCustomerId, customerId),
      eq(portalCompanyRequestsTable.status, "pending"),
    ))
    .orderBy(desc(portalCompanyRequestsTable.createdAt))
    .limit(1);

  const customerType = customer.customerType as PortalCustomerType | null;
  const effectiveType = customerType
    ?? (memberships.length > 0 || pendingRequest ? "company" : null);
  const company = memberships.length === 1 ? memberships[0]! : null;

  let status: PortalCustomerContextStatus;
  if (effectiveType === "individual") status = "individual";
  else if (company) status = "company_mapped";
  else if (pendingRequest) status = "company_pending";
  else if (effectiveType === "company") status = "company_unresolved";
  else status = "legacy_unresolved";

  return {
    customer: {
      ...customer,
      customerType,
    },
    customerType: effectiveType,
    status,
    companyId: company?.companyId ?? null,
    company: company
      ? {
          id: company.companyId,
          name: company.companyName,
          code: company.companyCode,
          buyerRole: company.buyerRole,
          department: company.department,
          costCenter: company.costCenter,
          approvalLevel: company.approvalLevel,
        }
      : null,
    activeMemberships: memberships,
    pendingRequest: pendingRequest ?? null,
  };
}