import { db } from "@workspace/db";
import { sql } from "drizzle-orm";
import type { Request } from "express";
import {
  getPortalCustomerContext,
  PortalCustomerContextError,
} from "./portalCustomerContextService.js";
import type { PortalAuthReq } from "../supabaseAuth.js";

/**
 * Customer service requests have two supported ownership modes:
 *
 * - authenticated customers: derive ownership from the session customer and
 *   canonical active company membership;
 * - genuine guest drafts: only rows created without any portal identity may be
 *   edited anonymously, preserving the existing guest draft contract.
 *
 * The guest branch must never be used when a portal session is present.
 */
export async function hasCustomerServiceRequestAccess(
  req: Request,
  requestId: number,
  options: { allowGuest?: boolean } = {},
): Promise<boolean> {
  if (!Number.isInteger(requestId) || requestId <= 0) return false;

  const portalCustomerId = (req as Partial<PortalAuthReq>).portalCustomerId;
  if (!portalCustomerId) {
    if (!options.allowGuest) return false;
    const guest = await db.execute(sql`
      SELECT id
        FROM customer_service_requests
       WHERE id = ${requestId}
         AND portal_customer_id IS NULL
         AND customer_id IS NULL
         AND company_id IS NULL
       LIMIT 1
    `);
    return guest.rows.length === 1;
  }

  const context = await getPortalCustomerContext(portalCustomerId);
  if (!context.customerType) {
    throw new PortalCustomerContextError(422, "Profil customer belum menyelesaikan tipe akun.");
  }
  if (context.customerType === "company" && !context.companyId) {
    throw new PortalCustomerContextError(422, "Customer Portal belum memiliki membership perusahaan aktif.");
  }

  const ownership = context.customerType === "individual"
    ? sql`(portal_customer_id = ${portalCustomerId} OR customer_id = ${portalCustomerId}) AND company_id IS NULL`
    : sql`company_id = ${context.companyId}`;
  const owned = await db.execute(sql`
    SELECT id
      FROM customer_service_requests
     WHERE id = ${requestId} AND ${ownership}
     LIMIT 1
  `);
  return owned.rows.length === 1;
}

export async function getCustomerServiceRequestOwnership(req: Request) {
  const portalCustomerId = (req as PortalAuthReq).portalCustomerId;
  const context = await getPortalCustomerContext(portalCustomerId);
  if (!context.customerType) {
    throw new PortalCustomerContextError(422, "Profil customer belum menyelesaikan tipe akun.");
  }
  if (context.customerType === "company" && !context.companyId) {
    throw new PortalCustomerContextError(422, "Customer Portal belum memiliki membership perusahaan aktif.");
  }

  return context.customerType === "individual"
    ? sql`(portal_customer_id = ${portalCustomerId} OR customer_id = ${portalCustomerId}) AND company_id IS NULL`
    : sql`company_id = ${context.companyId}`;
}