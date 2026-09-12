import {
  db,
  companiesTable,
  portalCompanyMembersTable,
  portalCompanyRequestsTable,
  portalCustomersTable,
  userProfilesTable,
} from "@workspace/db";
import { and, desc, eq } from "drizzle-orm";
import {
  assignPortalCustomerMembership,
} from "./portalCompanyMembershipService.js";

export type PortalCompanyRequestStatus = "pending" | "approved" | "rejected";
export type PortalCustomerCompanySelection = {
  companyId?: number | null;
  requestedCompanyName?: string | null;
  requestedRegistrationNumber?: string | null;
};

export class PortalCompanyRequestError extends Error {
  constructor(
    public readonly statusCode: 400 | 404 | 409,
    message: string,
  ) {
    super(message);
    this.name = "PortalCompanyRequestError";
  }
}

function positiveId(value: unknown, label: string): number {
  const id = Number(value);
  if (!Number.isInteger(id) || id <= 0) {
    throw new PortalCompanyRequestError(400, `${label} tidak valid.`);
  }
  return id;
}

function cleanName(value: unknown): string {
  const name = String(value ?? "").trim();
  if (name.length < 2 || name.length > 200) {
    throw new PortalCompanyRequestError(400, "Nama perusahaan minimal 2 dan maksimal 200 karakter.");
  }
  return name;
}

export async function listPortalCustomerCompanies() {
  return db
    .select({
      id: companiesTable.id,
      name: companiesTable.companyName,
      code: companiesTable.companyCode,
    })
    .from(companiesTable)
    .where(eq(companiesTable.isActive, true))
    .orderBy(companiesTable.companyName);
}

export async function createPortalCompanyRequest(input: {
  customerId: number;
  requestedCompanyName: string;
  requestedRegistrationNumber?: string | null;
}) {
  const customerId = positiveId(input.customerId, "Customer ID");
  const requestedCompanyName = cleanName(input.requestedCompanyName);
  const registration = input.requestedRegistrationNumber?.trim() || null;

  const [customer] = await db
    .select({ id: portalCustomersTable.id, customerType: portalCustomersTable.customerType })
    .from(portalCustomersTable)
    .where(eq(portalCustomersTable.id, customerId))
    .limit(1);
  if (!customer) throw new PortalCompanyRequestError(404, "Customer tidak ditemukan.");
  if (customer.customerType !== "company") {
    throw new PortalCompanyRequestError(409, "Request perusahaan hanya tersedia untuk customer perusahaan.");
  }

  const [existing] = await db
    .select()
    .from(portalCompanyRequestsTable)
    .where(and(
      eq(portalCompanyRequestsTable.portalCustomerId, customerId),
      eq(portalCompanyRequestsTable.status, "pending"),
    ))
    .orderBy(desc(portalCompanyRequestsTable.createdAt))
    .limit(1);

  if (existing) {
    const [updated] = await db
      .update(portalCompanyRequestsTable)
      .set({
        requestedCompanyName,
        requestedRegistrationNumber: registration,
        updatedAt: new Date(),
      })
      .where(eq(portalCompanyRequestsTable.id, existing.id))
      .returning();
    return updated;
  }

  const [created] = await db
    .insert(portalCompanyRequestsTable)
    .values({
      portalCustomerId: customerId,
      requestedCompanyName,
      requestedRegistrationNumber: registration,
      status: "pending",
    })
    .returning();
  return created;
}

/**
 * Apply the explicit organisation choice made by a customer. There is no
 * fallback to portal_customers.company or to a guessed company.
 */
export async function applyPortalCustomerCompanySelection(input: {
  customerId: number;
  customerType: "individual" | "company";
} & PortalCustomerCompanySelection): Promise<"individual" | "mapped" | "pending"> {
  if (input.customerType === "individual") return "individual";
  const companyId = input.companyId == null ? null : positiveId(input.companyId, "Company ID");
  const requestedName = input.requestedCompanyName?.trim() || "";
  if (companyId && requestedName) {
    throw new PortalCompanyRequestError(400, "Pilih company canonical atau request perusahaan baru, bukan keduanya.");
  }
  if (companyId) {
    try {
      await assignPortalCustomerMembership({
        customerId: input.customerId,
        companyId,
        buyerRole: "requester",
      });
    } catch (error) {
      if (error instanceof Error && "statusCode" in error) {
        throw new PortalCompanyRequestError(
          Number((error as { statusCode: number }).statusCode) as 400 | 404 | 409,
          error.message,
        );
      }
      throw error;
    }
    return "mapped";
  }
  if (requestedName) {
    await createPortalCompanyRequest({
      customerId: input.customerId,
      requestedCompanyName: requestedName,
      requestedRegistrationNumber: input.requestedRegistrationNumber,
    });
    return "pending";
  }
  throw new PortalCompanyRequestError(400, "Customer perusahaan wajib memilih company canonical atau mengajukan request baru.");
}

export async function getPortalCustomerCompanyRequest(customerId: number) {
  const id = positiveId(customerId, "Customer ID");
  return db
    .select()
    .from(portalCompanyRequestsTable)
    .where(eq(portalCompanyRequestsTable.portalCustomerId, id))
    .orderBy(desc(portalCompanyRequestsTable.createdAt))
    .limit(1)
    .then(([request]) => request ?? null);
}

export async function listPortalCompanyRequests(status?: PortalCompanyRequestStatus) {
  const rows = await db
    .select({
      id: portalCompanyRequestsTable.id,
      portalCustomerId: portalCompanyRequestsTable.portalCustomerId,
      requestedCompanyName: portalCompanyRequestsTable.requestedCompanyName,
      requestedRegistrationNumber: portalCompanyRequestsTable.requestedRegistrationNumber,
      status: portalCompanyRequestsTable.status,
      matchedCompanyId: portalCompanyRequestsTable.matchedCompanyId,
      reviewNote: portalCompanyRequestsTable.reviewNote,
      reviewedBy: portalCompanyRequestsTable.reviewedBy,
      reviewedAt: portalCompanyRequestsTable.reviewedAt,
      createdAt: portalCompanyRequestsTable.createdAt,
      updatedAt: portalCompanyRequestsTable.updatedAt,
      customerName: portalCustomersTable.name,
      customerEmail: portalCustomersTable.email,
      customerPhone: portalCustomersTable.phone,
      companyName: companiesTable.companyName,
      companyCode: companiesTable.companyCode,
    })
    .from(portalCompanyRequestsTable)
    .innerJoin(portalCustomersTable, eq(portalCustomersTable.id, portalCompanyRequestsTable.portalCustomerId))
    .leftJoin(companiesTable, eq(companiesTable.id, portalCompanyRequestsTable.matchedCompanyId))
    .where(status ? eq(portalCompanyRequestsTable.status, status) : undefined)
    .orderBy(desc(portalCompanyRequestsTable.createdAt));
  return rows;
}

export async function reviewPortalCompanyRequest(input: {
  requestId: number;
  status: "approved" | "rejected";
  companyId?: number | null;
  reviewNote?: string | null;
  reviewedBy: number;
}) {
  const requestId = positiveId(input.requestId, "Request ID");
  const reviewerId = positiveId(input.reviewedBy, "Reviewer ID");
  const companyId = input.status === "approved"
    ? positiveId(input.companyId, "Company ID")
    : null;

  try {
    return await db.transaction(async (tx) => {
      const [request] = await tx
        .select()
        .from(portalCompanyRequestsTable)
        .where(eq(portalCompanyRequestsTable.id, requestId))
        .limit(1);
      if (!request) throw new PortalCompanyRequestError(404, "Request perusahaan tidak ditemukan.");
      if (request.status !== "pending") {
        throw new PortalCompanyRequestError(409, "Request perusahaan sudah direview.");
      }

      if (companyId) {
        const [company] = await tx
          .select({ id: companiesTable.id, isActive: companiesTable.isActive })
          .from(companiesTable)
          .where(eq(companiesTable.id, companyId))
          .limit(1);
        if (!company) throw new PortalCompanyRequestError(404, "Company canonical tidak ditemukan.");
        if (!company.isActive) throw new PortalCompanyRequestError(409, "Company canonical tidak aktif.");

        const [customer] = await tx
          .select({ id: portalCustomersTable.id, customerType: portalCustomersTable.customerType, accountStatus: portalCustomersTable.accountStatus })
          .from(portalCustomersTable)
          .where(eq(portalCustomersTable.id, request.portalCustomerId))
          .limit(1);
        if (!customer) throw new PortalCompanyRequestError(404, "Customer request tidak ditemukan.");
        if (customer.customerType !== "company") {
          throw new PortalCompanyRequestError(409, "Customer bukan bertipe company.");
        }
        if (customer.accountStatus !== "active") {
          throw new PortalCompanyRequestError(409, "Akun customer tidak aktif.");
        }

        // Keep approval and membership creation in the same transaction. This
        // is deliberately explicit rather than deriving a company from text.
        await tx
          .insert(portalCompanyMembersTable)
          .values({
            portalCustomerId: request.portalCustomerId,
            companyId,
            buyerRole: "requester",
            isActive: true,
            invitedBy: reviewerId,
            invitedAt: new Date(),
            joinedAt: new Date(),
            updatedAt: new Date(),
          })
          .onConflictDoUpdate({
            target: [portalCompanyMembersTable.portalCustomerId, portalCompanyMembersTable.companyId],
            set: {
              isActive: true,
              invitedBy: reviewerId,
              invitedAt: new Date(),
              joinedAt: new Date(),
              updatedAt: new Date(),
            },
          });
        await tx
          .update(userProfilesTable)
          .set({ status: "active", updatedAt: new Date() })
          .where(eq(userProfilesTable.customerId, request.portalCustomerId));
      } else {
        await tx
          .update(userProfilesTable)
          .set({ status: "rejected", updatedAt: new Date() })
          .where(eq(userProfilesTable.customerId, request.portalCustomerId));
      }

      const [updated] = await tx
        .update(portalCompanyRequestsTable)
        .set({
          status: input.status,
          matchedCompanyId: companyId,
          reviewNote: input.reviewNote?.trim() || null,
          reviewedBy: reviewerId,
          reviewedAt: new Date(),
          updatedAt: new Date(),
        })
        .where(eq(portalCompanyRequestsTable.id, requestId))
        .returning();
      return updated;
    });
  } catch (error) {
    if (error instanceof PortalCompanyRequestError) throw error;
    throw error;
  }
}