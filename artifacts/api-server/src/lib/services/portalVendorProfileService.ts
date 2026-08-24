import {
  db,
  portalCustomersTable,
  suppliersTable,
  logisticOrderRfqsTable,
  logisticOrdersTable,
  logisticOrderQuotesTable,
  vendorProfilesTable,
  vendorCatalogSubmissionLinksTable,
} from "@workspace/db";
import { eq, desc, inArray, and } from "drizzle-orm";
import { toVendorProfileViewModel } from "./vendorProfileViewModel.js";

// ── resolveVendorSupplierId ─────────────────────────────────────────────────
// P0-FIX: menggunakan FK lookup via vendor_profiles.supplier_id
// Tidak lagi menggunakan email/phone heuristic matching yang rentan salah arah.
export async function resolveVendorSupplierId(customerId: number): Promise<number | null> {
  // FK lookup — vendor_profiles.supplier_id diisi oleh runVendorApprovedInTx
  const [vp] = await db
    .select({ supplierId: vendorProfilesTable.supplierId })
    .from(vendorProfilesTable)
    .where(eq(vendorProfilesTable.customerId, customerId))
    .limit(1);

  return vp?.supplierId ?? null;
}

// ── getVendorDashboard ────────────────────────────────────────────────────────

export async function getVendorDashboard(customerId: number) {
  const [customer] = await db
    .select()
    .from(portalCustomersTable)
    .where(eq(portalCustomersTable.id, customerId));
  if (!customer) return null;

  // P0-FIX: FK lookup — tidak lagi scan seluruh suppliers table
  const supplierId = await resolveVendorSupplierId(customerId);
  const linkedSupplier = supplierId
    ? (await db
        .select()
        .from(suppliersTable)
        .where(eq(suppliersTable.id, supplierId))
        .limit(1))[0] ?? null
    : null;

  let rfqs: {
    id: number; rfqNumber: string; orderId: number; status: string;
    orderNumber: string; origin: string; destination: string; shipmentType: string;
    commodity: string | null; createdAt: string;
  }[] = [];
  let quotes: {
    id: number; rfqId: number; orderId: number; orderNumber: string;
    rfqNumber: string; vendorPrice: number; sellingPrice: number | null;
    estimatedPickup: string | null; estimatedDelivery: string | null;
    vendorNotes: string | null; quoteStatus: string; replySource: string | null;
    createdAt: string;
  }[] = [];

  if (linkedSupplier) {
    const allRfqs = await db
      .select()
      .from(logisticOrderRfqsTable)
      .orderBy(desc(logisticOrderRfqsTable.createdAt));
    const relevantRfqs = allRfqs
      .filter((r) => (r.vendorIds as number[]).includes(linkedSupplier.id))
      .slice(0, 20);

    if (relevantRfqs.length > 0) {
      const orderIds = [...new Set(relevantRfqs.map((r) => r.orderId))];
      const orders = await db
        .select()
        .from(logisticOrdersTable)
        .where(inArray(logisticOrdersTable.id, orderIds));
      const orderMap = Object.fromEntries(orders.map((o) => [o.id, o]));

      rfqs = relevantRfqs.map((r) => {
        const o = orderMap[r.orderId];
        return {
          id: r.id,
          rfqNumber: r.rfqNumber,
          orderId: r.orderId,
          status: r.status,
          orderNumber: o?.orderNumber ?? String(r.orderId),
          origin: o?.origin ?? "",
          destination: o?.destination ?? "",
          shipmentType: o?.shipmentType ?? "",
          commodity: o?.commodity ?? null,
          createdAt: r.createdAt.toISOString(),
        };
      });

      const allQuotes = await db
        .select()
        .from(logisticOrderQuotesTable)
        .where(eq(logisticOrderQuotesTable.vendorId, linkedSupplier.id))
        .orderBy(desc(logisticOrderQuotesTable.createdAt));

      const rfqMap = Object.fromEntries(relevantRfqs.map((r) => [r.id, r]));
      quotes = allQuotes.map((q) => {
        const rfq = rfqMap[q.rfqId];
        const order = orderMap[q.orderId];
        return {
          id: q.id,
          rfqId: q.rfqId,
          orderId: q.orderId,
          orderNumber: order?.orderNumber ?? String(q.orderId),
          rfqNumber: rfq?.rfqNumber ?? String(q.rfqId),
          vendorPrice: Number(q.vendorPrice),
          sellingPrice: q.sellingPrice != null ? Number(q.sellingPrice) : null,
          estimatedPickup: q.estimatedPickup,
          estimatedDelivery: q.estimatedDelivery,
          vendorNotes: q.vendorNotes,
          quoteStatus: q.quoteStatus,
          replySource: q.replySource,
          createdAt: q.createdAt.toISOString(),
        };
      });
    }
  }

  return {
    portalCustomer: {
      id: customer.id,
      name: customer.name,
      email: customer.email,
      phone: customer.phone,
      company: customer.company,
      role: customer.role,
    },
    supplier: linkedSupplier
      ? {
          id: linkedSupplier.id,
          name: linkedSupplier.name,
          phone: linkedSupplier.phone,
          contactEmail: linkedSupplier.contactEmail,
          serviceType: linkedSupplier.serviceType,
          isActive: linkedSupplier.isActive,
        }
      : null,
    rfqs,
    quotes,
  };
}

// ── getVendorFullProfile ──────────────────────────────────────────────────────

export async function getVendorFullProfile(customerId: number) {
  const [vp] = await db
    .select()
    .from(vendorProfilesTable)
    .where(eq(vendorProfilesTable.customerId, customerId));

  let submissionLink: {
    token: string;
    url: string;
    expiresAt: Date | null;
    isActive: boolean;
  } | null = null;

  if (vp?.supplierId) {
    const [link] = await db
      .select({
        token:     vendorCatalogSubmissionLinksTable.token,
        isActive:  vendorCatalogSubmissionLinksTable.isActive,
        expiresAt: vendorCatalogSubmissionLinksTable.expiresAt,
      })
      .from(vendorCatalogSubmissionLinksTable)
      .where(and(
        eq(vendorCatalogSubmissionLinksTable.supplierId, vp.supplierId),
        eq(vendorCatalogSubmissionLinksTable.isActive, true),
      ))
      .orderBy(desc(vendorCatalogSubmissionLinksTable.id))
      .limit(1);

    if (link) {
      const devDomain = process.env["REPLIT_DEV_DOMAIN"];
      const base = devDomain ? `https://${devDomain}` : (process.env["APP_BASE_URL"] ?? "");
      submissionLink = {
        token:     link.token,
        url:       `${base}/api/vendor-catalog-engine/form/${link.token}`,
        expiresAt: link.expiresAt,
        isActive:  link.isActive,
      };
    }
  }

  if (!vp) return { vendorProfile: null, submissionLink };

  return {
    vendorProfile: toVendorProfileViewModel(vp),
    submissionLink,
  };
}
