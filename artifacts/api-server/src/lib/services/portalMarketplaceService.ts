/**
 * Portal Marketplace Service
 *
 * Business logic for marketplace quote submission and direct order creation.
 * Controllers in portal.ts handle HTTP concerns (rate limiting, honeypot,
 * auth token resolution) — this service owns validation, DB writes, and
 * side-effect coordination (mkt pipeline, counter increments).
 */

import {
  db,
  portalCustomersTable,
  portalCompanyMembersTable,
  portalProductOrdersTable,
  portalProductOrderItemsTable,
} from "@workspace/db";
import { eq, and, asc, sql } from "drizzle-orm";
import { getCatalogItemPublic } from "./portalVendorCatalogService.js";
import {
  isMarketplaceNewPipelineEnabled,
  createMktRfqEntry,
  linkMktRfqToLegacy,
} from "./marketplaceRfqService.js";

// ─── private helpers ──────────────────────────────────────────────────────────

function mkMarketplaceOrderNumber(): string {
  const d = new Date();
  const yy = String(d.getFullYear()).slice(-2);
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const dd = String(d.getDate()).padStart(2, "0");
  const rand = Math.floor(Math.random() * 90000) + 10000;
  return `MCT-${yy}${mm}${dd}-${rand}`;
}

function makeServiceError(statusCode: number, message: string): Error {
  return Object.assign(new Error(message), { statusCode });
}

// ─── submitMarketplaceQuote ───────────────────────────────────────────────────

export interface SubmitQuoteBody {
  customerName?:        string;
  email?:               string;
  phone?:               string;
  qty?:                 number;
  unit?:                string;
  notes?:               string;
  includePpn?:          boolean;
  urgency?:             string;
  shippingAddress?:     string;
  destination?:         string;
  required_date?:       string;
  buyer_name?:          string;
  company_name?:        string;
  guest_contact?:       string;
  marketplace_source?:  string;
  commission_ready?:    boolean;
  estimated_price?:     number;
  marketplace_item_id?: number;
  item_type?:           string;
}

export interface SubmitQuoteResult {
  orderNumber:  string;
  id:           number;
  status:       "Quote Request";
  rfqId?:       number;
  rfqNumber?:   string;
  newPipeline?: boolean;
}

/**
 * Submit a marketplace quote (RFQ). Performs:
 *  1. Catalog item validation (exists, not expired)
 *  2. Buyer field validation
 *  3. Phase 2B: resolve full portal customer from portalEmailFromToken
 *  4. Phase 2B.1: resolve company membership
 *  5. createMktRfqEntry (new pipeline, non-fatal)
 *  6. Insert portal_product_orders + portal_product_order_items (legacy write)
 *  7. linkMktRfqToLegacy (fire-and-forget)
 *  8. Increment quote_count (fire-and-forget)
 *
 * @param portalEmailFromToken  already-verified email from JWT/Supabase/devportal token
 *                              (null = anonymous / no auth header)
 * @param ip                    client IP for rate-limit audit in mkt pipeline
 */
export async function submitMarketplaceQuote(params: {
  catalogItemId:        number;
  portalEmailFromToken: string | null;
  ip:                   string | null;
  body:                 SubmitQuoteBody;
}): Promise<SubmitQuoteResult> {
  const { catalogItemId, portalEmailFromToken, ip, body } = params;

  // ── 1. Item validation ────────────────────────────────────────────────────
  const item = await getCatalogItemPublic(catalogItemId);
  if (!item) throw makeServiceError(404, "Item tidak ditemukan");

  if (item.validityDate && new Date(item.validityDate) < new Date(new Date().toDateString())) {
    throw makeServiceError(400, "Item ini sudah kedaluwarsa dan tidak dapat dipesan");
  }

  // ── 2. Buyer field validation ─────────────────────────────────────────────
  const {
    customerName, email, phone, qty = 1, unit, notes, includePpn = false,
    urgency, shippingAddress,
    destination, required_date, buyer_name, company_name, guest_contact,
    marketplace_source, commission_ready, estimated_price: clientEstimatedPrice,
    item_type,
  } = body;

  const resolvedName  = (buyer_name  ?? customerName ?? "").trim();
  const resolvedPhone = (guest_contact ?? phone       ?? "").trim();
  if (!resolvedName)  throw makeServiceError(400, "Nama buyer wajib diisi");
  if (!resolvedPhone) throw makeServiceError(400, "No. WhatsApp wajib diisi");

  // ── 3. Price / order calculations ────────────────────────────────────────
  const qtyNum     = Math.max(1, Number(qty) || 1);
  const unitStr    = (unit?.trim() || item.unit || "unit");
  const sellPrice  = item.priceSell ?? 0;
  const subtotal   = sellPrice * qtyNum;
  const ppnRate    = includePpn ? 0.11 : 0;
  const grandTotal = subtotal * (1 + ppnRate);

  const orderNumber = mkMarketplaceOrderNumber();

  const catalogSnapshot = {
    catalogSource:        "catalog" as const,
    vendorCatalogItemId:  item.id,
    vendorId:             item.vendorId,
    vendorName:           item.vendorName,
    templateKind:         item.templateKind,
    templateId:           item.templateId,
    templateVersion:      item.templateVersion,
    specValues:           item.specValues,
    priceSell:            item.priceSell,
    currency:             item.currency,
    ...(item.templateSnapshot && typeof item.templateSnapshot === "object"
      ? item.templateSnapshot as object
      : {}),
    // P6 — BizPortal integration metadata
    commission_ready:    commission_ready ?? true,
    marketplace_source:  marketplace_source ?? "marketplace",
    marketplace_item_id: item.id,
    item_type:           item.templateKind ?? item_type ?? "product",
    estimated_price:     clientEstimatedPrice ?? grandTotal,
    destination:         destination ?? null,
    required_date:       required_date ?? null,
    buyer_name:          resolvedName,
    company_name:        company_name ?? null,
    guest_contact:       resolvedPhone,
  };

  const urgencyLabel   = urgency === "order" ? "[ORDER URGENT] " : "";
  const combinedNotes  = [
    urgencyLabel || null,
    notes?.trim() || null,
    shippingAddress?.trim() ? `Alamat: ${shippingAddress.trim()}` : null,
  ].filter(Boolean).join("\n") || null;

  // ── 4. Phase 2A/2B/2B.1: New Marketplace Pipeline (feature-flagged) ──────
  let mktRfqResult: { rfqId: number; rfqNumber: string } | null = null;
  const newPipelineEnabled = await isMarketplaceNewPipelineEnabled();

  if (newPipelineEnabled) {
    // Phase 2B: resolve full portal customer record (non-fatal)
    type ResolvedPortalCustomer = { id: number; email: string; name: string; phone: string | null; company: string | null };
    let portalCustomer: ResolvedPortalCustomer | null = null;
    if (portalEmailFromToken) {
      try {
        const [c] = await db.select({
          id:      portalCustomersTable.id,
          email:   portalCustomersTable.email,
          name:    portalCustomersTable.name,
          phone:   portalCustomersTable.phone,
          company: portalCustomersTable.company,
        }).from(portalCustomersTable)
          .where(eq(portalCustomersTable.email, portalEmailFromToken.trim().toLowerCase()));
        if (c) portalCustomer = c;
      } catch { /* non-fatal — treat as guest */ }
    }

    // Phase 2B.1: resolve company membership (non-fatal)
    type MembershipCtx = {
      companyId:     number;
      buyerRole:     string;
      department:    string | null;
      costCenter:    string | null;
      approvalLevel: number | null;
    };
    let membershipCtx: MembershipCtx | null = null;
    if (portalCustomer) {
      try {
        const [m] = await db.select({
          companyId:     portalCompanyMembersTable.companyId,
          buyerRole:     portalCompanyMembersTable.buyerRole,
          department:    portalCompanyMembersTable.department,
          costCenter:    portalCompanyMembersTable.costCenter,
          approvalLevel: portalCompanyMembersTable.approvalLevel,
        })
        .from(portalCompanyMembersTable)
        .where(and(
          eq(portalCompanyMembersTable.portalCustomerId, portalCustomer.id),
          eq(portalCompanyMembersTable.isActive, true),
        ))
        .orderBy(asc(portalCompanyMembersTable.createdAt))
        .limit(1);
        if (m) membershipCtx = m;
      } catch { /* non-fatal — company_id stays null */ }
    }

    try {
      mktRfqResult = await createMktRfqEntry({
        catalogItem:        item,
        buyerName:          resolvedName,
        buyerEmail:         portalCustomer?.email ?? portalEmailFromToken ?? email?.trim() ?? "",
        buyerPhone:         resolvedPhone,
        buyerCompany:       company_name?.trim() ?? portalCustomer?.company ?? null,
        companyId:          membershipCtx?.companyId ?? null,
        portalCustomerId:   portalCustomer?.id ?? null,
        buyerRole:          membershipCtx?.buyerRole ?? null,
        buyerDepartment:    membershipCtx?.department ?? null,
        buyerCostCenter:    membershipCtx?.costCenter ?? null,
        buyerApprovalLevel: membershipCtx?.approvalLevel ?? null,
        qty:                qtyNum,
        unit:               unitStr,
        notes:              combinedNotes,
        shippingAddress:    shippingAddress?.trim() ?? null,
        requiredDeliveryDate: required_date?.trim() ?? null,
        ipAddress:          ip,
      });
    } catch (err) {
      // Non-fatal: log and fall through. Legacy write below proceeds regardless.
      console.error("[marketplaceRfq] createMktRfqEntry failed — continuing with legacy path", { err, catalogItemId });
      mktRfqResult = null;
    }
  }

  // ── 5. Legacy write: portal_product_orders + order items (atomic) ─────────
  const orderStatus = urgency === "order" ? "New Order" : "Quote Request";
  const order = await db.transaction(async (tx) => {
    const [hdr] = await tx.insert(portalProductOrdersTable).values({
      orderNumber,
      customerName:       resolvedName,
      email:              portalEmailFromToken ?? email?.trim() ?? "",
      phone:              resolvedPhone,
      shippingAddress:    shippingAddress?.trim() || "TBD — Quote Request",
      notes:              combinedNotes,
      subtotal:           String(subtotal),
      grandTotal:         String(grandTotal),
      status:             orderStatus,
      productCategory:    item.categoryKey ?? item.serviceType ?? item.kategori ?? null,
      templateId:         item.templateId ?? null,
      templateVersion:    item.templateVersion ?? null,
      customFieldValues:  (item.specValues && typeof item.specValues === "object" ? item.specValues : {}) as Record<string, string | number | boolean>,
      templateSnapshot:   catalogSnapshot as Record<string, unknown>,
    }).returning();

    await tx.insert(portalProductOrderItemsTable).values({
      orderId:     hdr!.id,
      productName: item.name,
      unit:        unitStr,
      unitPrice:   String(sellPrice),
      qty:         qtyNum,
      subtotal:    String(sellPrice * qtyNum),
    });

    return hdr!;
  });

  // ── 6. Phase 2A: dual-write backlink (fire-and-forget, non-fatal) ─────────
  if (mktRfqResult) {
    linkMktRfqToLegacy(
      mktRfqResult.rfqId,
      mktRfqResult.rfqNumber,
      order.id,
      order.orderNumber,
    ).catch(() => {});
  }

  // ── 7. Increment quote_count (fire-and-forget) ────────────────────────────
  db.execute(sql`UPDATE vendor_catalog_items SET quote_count = quote_count + 1 WHERE id = ${catalogItemId}`).catch(() => {});

  return {
    orderNumber,
    id:     order.id,
    status: "Quote Request",
    ...(mktRfqResult
      ? { rfqId: mktRfqResult.rfqId, rfqNumber: mktRfqResult.rfqNumber, newPipeline: true }
      : {}),
  };
}

// ─── createMarketplaceOrder ───────────────────────────────────────────────────

export interface CreateOrderBody {
  customerName?:    string;
  email?:           string;
  phone?:           string;
  shippingAddress?: string;
  qty?:             number;
  unit?:            string;
  notes?:           string;
  includePpn?:      boolean;
}

export interface CreateOrderResult {
  orderNumber: string;
  id:          number;
  status:      "New Order";
}

/**
 * Create a direct marketplace order (deprecated flow — frontend uses /quote now).
 * Performs:
 *  1. Catalog item validation (exists, not expired)
 *  2. Required field validation (customerName, phone, shippingAddress)
 *  3. Insert portal_product_orders + portal_product_order_items
 *  4. Increment order_count (fire-and-forget)
 */
export async function createMarketplaceOrder(params: {
  catalogItemId: number;
  body:          CreateOrderBody;
}): Promise<CreateOrderResult> {
  const { catalogItemId, body } = params;

  // ── 1. Item validation ────────────────────────────────────────────────────
  const item = await getCatalogItemPublic(catalogItemId);
  if (!item) throw makeServiceError(404, "Item tidak ditemukan");

  if (item.validityDate && new Date(item.validityDate) < new Date(new Date().toDateString())) {
    throw makeServiceError(400, "Item ini sudah kedaluwarsa dan tidak dapat dipesan");
  }

  // ── 2. Required field validation ─────────────────────────────────────────
  const { customerName, email, phone, shippingAddress, qty = 1, unit, notes, includePpn = false } = body;

  if (!customerName?.trim())   throw makeServiceError(400, "Nama customer wajib diisi");
  if (!phone?.trim())           throw makeServiceError(400, "No. WhatsApp wajib diisi");
  if (!shippingAddress?.trim()) throw makeServiceError(400, "Alamat pengiriman wajib diisi");

  // ── 3. Price calculations ─────────────────────────────────────────────────
  const qtyNum     = Math.max(1, Number(qty) || 1);
  const unitStr    = (unit?.trim() || item.unit || "unit");
  const sellPrice  = item.priceSell ?? 0;
  const subtotal   = sellPrice * qtyNum;
  const ppnRate    = includePpn ? 0.11 : 0;
  const grandTotal = subtotal * (1 + ppnRate);

  const orderNumber = mkMarketplaceOrderNumber();

  const catalogSnapshot = {
    catalogSource:       "catalog" as const,
    vendorCatalogItemId: item.id,
    vendorId:            item.vendorId,
    vendorName:          item.vendorName,
    templateKind:        item.templateKind,
    templateId:          item.templateId,
    templateVersion:     item.templateVersion,
    specValues:          item.specValues,
    priceSell:           item.priceSell,
    currency:            item.currency,
    ...(item.templateSnapshot && typeof item.templateSnapshot === "object"
      ? item.templateSnapshot as object
      : {}),
  };

  // ── 4. Idempotency check — same phone + catalogItemId within 5-minute window ─
  const IDEMPOTENCY_WINDOW_MS = 5 * 60 * 1000;
  const windowStart = new Date(Date.now() - IDEMPOTENCY_WINDOW_MS);
  const existing = await db
    .select({ id: portalProductOrdersTable.id, orderNumber: portalProductOrdersTable.orderNumber })
    .from(portalProductOrdersTable)
    .where(and(
      eq(portalProductOrdersTable.phone, phone.trim()),
      eq(portalProductOrdersTable.status, "New Order"),
      sql`${portalProductOrdersTable.createdAt} >= ${windowStart}`,
      sql`${portalProductOrdersTable.templateId} IS NOT DISTINCT FROM ${item.templateId ?? null}`,
    ))
    .limit(1);

  if (existing.length > 0) {
    // Return first order — duplicate click protection
    return { orderNumber: existing[0]!.orderNumber, id: existing[0]!.id, status: "New Order" };
  }

  // ── 5. DB writes inside transaction (atomic) ──────────────────────────────
  const order = await db.transaction(async (tx) => {
    const [hdr] = await tx.insert(portalProductOrdersTable).values({
      orderNumber,
      customerName:      customerName.trim(),
      email:             email?.trim() ?? "",
      phone:             phone.trim(),
      shippingAddress:   shippingAddress.trim(),
      notes:             notes?.trim() ?? null,
      subtotal:          String(subtotal),
      grandTotal:        String(grandTotal),
      status:            "New Order",
      productCategory:   item.categoryKey ?? item.serviceType ?? item.kategori ?? null,
      templateId:        item.templateId ?? null,
      templateVersion:   item.templateVersion ?? null,
      customFieldValues: (item.specValues && typeof item.specValues === "object" ? item.specValues : {}) as Record<string, string | number | boolean>,
      templateSnapshot:  catalogSnapshot as Record<string, unknown>,
    }).returning();

    await tx.insert(portalProductOrderItemsTable).values({
      orderId:     hdr!.id,
      productName: item.name,
      unit:        unitStr,
      unitPrice:   String(sellPrice),
      qty:         qtyNum,
      subtotal:    String(sellPrice * qtyNum),
    });

    return hdr!;
  });

  // ── 6. Increment order_count (fire-and-forget) ────────────────────────────
  db.execute(sql`UPDATE vendor_catalog_items SET order_count = order_count + 1 WHERE id = ${catalogItemId}`).catch(() => {});

  return { orderNumber, id: order.id, status: "New Order" };
}
