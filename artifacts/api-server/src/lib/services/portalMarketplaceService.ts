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
  portalProductOrdersTable,
  portalProductOrderItemsTable,
} from "@workspace/db";
import { createHash } from "crypto";
import { eq, and, asc, sql } from "drizzle-orm";
import { getCatalogItemPublic } from "./portalVendorCatalogService.js";
import { getPortalCustomerContext } from "./portalCustomerContextService.js";
import {
  isMarketplaceNewPipelineEnabled,
  createMktRfqEntry,
  linkMktRfqToLegacy,
  validateMarketplaceDestinationMetadata,
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

function normalizeIdempotencyKey(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const key = value.trim();
  return key.length >= 1 && key.length <= 200 ? key : null;
}

function buildLogicalRequestKey(input: {
  catalogItemId: number;
  portalCustomerId: number | null;
  buyerEmail: string;
  buyerPhone: string;
}): string {
  // Preserve the legacy five-minute duplicate window while making the
  // canonical identity survive a retry much later.
  const bucket = Math.floor(Date.now() / (5 * 60 * 1000));
  return `mkt-rfq:${createHash("sha256")
    .update(JSON.stringify({ ...input, bucket }))
    .digest("hex")}`;
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
  destination_place_id?: string;
  destination_lat?:      number | string;
  destination_lng?:      number | string;
  marketplace_source?:  string;
  commission_ready?:    boolean;
  estimated_price?:     number;
  marketplace_item_id?: number;
  item_type?:           string;
  idempotency_key?:     string;
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
 *  3. Resolve the canonical customer context from the authenticated session id
 *  4. Resolve company membership from that context
 *  5. createMktRfqEntry (new pipeline; authenticated failures are fail-closed)
 *  6. Insert portal_product_orders + portal_product_order_items (legacy write)
 *  7. linkMktRfqToLegacy (fire-and-forget)
 *  8. Increment quote_count (fire-and-forget)
 *
 * @param portalCustomerId      customer id established by portal auth middleware
 *                              (null = explicit guest flow)
 * @param ip                    client IP for rate-limit audit in mkt pipeline
 */
export async function submitMarketplaceQuote(params: {
  catalogItemId:        number;
  portalCustomerId:     number | null;
  ip:                   string | null;
  body:                 SubmitQuoteBody;
  idempotencyKey?:      string | null;
}): Promise<SubmitQuoteResult> {
  const { catalogItemId, portalCustomerId, ip, body } = params;

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
    destination_place_id, destination_lat, destination_lng,
    marketplace_source, commission_ready, estimated_price: clientEstimatedPrice,
    item_type,
  } = body;

  // Authenticated ownership is resolved only from the session customer id.
  // Individual customers intentionally resolve to NULL. Company customers
  // need an active canonical membership; pending/unresolved contexts fail
  // closed instead of falling back to browser-supplied company data.
  const customerContext = portalCustomerId
    ? await getPortalCustomerContext(portalCustomerId)
    : null;
  if (customerContext && customerContext.status === "company_pending") {
    throw makeServiceError(422, "Permintaan perusahaan Anda masih menunggu persetujuan admin.");
  }
  if (customerContext?.status === "legacy_unresolved") {
    throw makeServiceError(422, "Pilih jenis akun Perorangan atau Perusahaan terlebih dahulu sebelum membuat permintaan penawaran.");
  }
  if (customerContext?.status === "company_unresolved") {
    throw makeServiceError(422, "Lengkapi informasi perusahaan terlebih dahulu sebelum membuat permintaan penawaran.");
  }
  if (customerContext && customerContext.status !== "individual" && customerContext.status !== "company_mapped") {
    throw makeServiceError(422, "Lengkapi informasi organisasi Customer Portal sebelum membuat permintaan penawaran.");
  }
  const portalCompanyId = customerContext?.companyId ?? null;

  const resolvedName  = (buyer_name  ?? customerName ?? "").trim();
  const resolvedPhone = (guest_contact ?? phone       ?? "").trim();
  const resolvedEmail = (customerContext?.customer.email ?? email ?? "").trim().toLowerCase();
  if (!resolvedName)  throw makeServiceError(400, "Nama buyer wajib diisi");
  if (!resolvedPhone) throw makeServiceError(400, "No. WhatsApp wajib diisi");
  // Marketplace RFQ's current frontend field is `destination`; keep the
  // service contract canonical by accepting both legacy names.
  const effectiveShippingAddress = (shippingAddress ?? destination)?.trim() || null;

  const destinationMetadata = await validateMarketplaceDestinationMetadata({
    destinationPlaceId: destination_place_id,
    destinationLat: destination_lat,
    destinationLng: destination_lng,
    destinationAddress: effectiveShippingAddress,
  });
  const logicalRequestKey =
    normalizeIdempotencyKey(params.idempotencyKey) ??
    normalizeIdempotencyKey(body.idempotency_key) ??
    buildLogicalRequestKey({
      catalogItemId,
      portalCustomerId,
      buyerEmail: resolvedEmail,
      buyerPhone: resolvedPhone,
    });

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
    destination_place_id: destinationMetadata.placeId,
    destination_lat:      destinationMetadata.lat,
    destination_lng:      destinationMetadata.lng,
    required_date:       required_date ?? null,
    buyer_name:          resolvedName,
    company_name:        company_name ?? null,
    guest_contact:       resolvedPhone,
  };

  const urgencyLabel   = urgency === "order" ? "[ORDER URGENT] " : "";
  const combinedNotes  = [
    urgencyLabel || null,
    notes?.trim() || null,
    effectiveShippingAddress ? `Alamat: ${effectiveShippingAddress}` : null,
  ].filter(Boolean).join("\n") || null;

  // ── 4. RFQ idempotency — same buyer + phone + catalog item within 5 minutes
  // Keep catalog items distinct even when they share a template (or have none).
  const quoteWindowStart = new Date(Date.now() - 5 * 60 * 1000);
  const existingQuote = await db.execute(sql`
    SELECT
      ppo.id,
      ppo.order_number,
      dwl.mkt_rfq_id,
      dwl.mkt_rfq_number
    FROM portal_product_orders ppo
    LEFT JOIN mkt_dual_write_log dwl
      ON dwl.portal_order_id = ppo.id
     AND dwl.mkt_rfq_id IS NOT NULL
    WHERE ppo.phone = ${resolvedPhone}
      AND ppo.email = ${resolvedEmail}
      AND ppo.status = 'Quote Request'
      AND ppo.created_at >= ${quoteWindowStart}
      AND (
        ppo.template_snapshot->>'vendorCatalogItemId' = ${String(item.id)}
        OR (
          ppo.template_snapshot->>'vendorCatalogItemId' IS NULL
          AND ppo.template_id IS NOT DISTINCT FROM ${item.templateId ?? null}
        )
      )
    ORDER BY ppo.id ASC
    LIMIT 1
  `);
  const duplicate = (existingQuote.rows as Array<{
    id: number | string;
    order_number: string;
    mkt_rfq_id?: number | string | null;
    mkt_rfq_number?: string | null;
  }>)[0];
  if (duplicate) {
    return {
      orderNumber: duplicate.order_number,
      id: Number(duplicate.id),
      status: "Quote Request",
      ...(duplicate.mkt_rfq_id
        ? {
            rfqId: Number(duplicate.mkt_rfq_id),
            rfqNumber: duplicate.mkt_rfq_number ?? undefined,
            newPipeline: true,
          }
        : {}),
    };
  }

  // ── 4. Phase 2A/2B/2B.1: New Marketplace Pipeline (feature-flagged) ──────
  let mktRfqResult: { rfqId: number; rfqNumber: string } | null = null;
  const newPipelineEnabled = await isMarketplaceNewPipelineEnabled();

  if (newPipelineEnabled) {
    /*
     * The canonical context was resolved above from the authenticated session.
     * Do not resolve a customer again from the email submitted by the browser.
     */
    try {
      mktRfqResult = await createMktRfqEntry({
        catalogItem:        item,
        buyerName:          resolvedName,
         buyerEmail:         resolvedEmail,
        buyerPhone:         resolvedPhone,
        buyerCompany:       customerContext?.company?.name ?? (portalCustomerId ? null : company_name?.trim() ?? null),
        companyId:          portalCompanyId,
        portalCustomerId,
        buyerRole:          customerContext?.company?.buyerRole ?? null,
        buyerDepartment:    customerContext?.company?.department ?? null,
        buyerCostCenter:    customerContext?.company?.costCenter ?? null,
        buyerApprovalLevel: customerContext?.company?.approvalLevel ?? null,
        qty:                qtyNum,
        unit:               unitStr,
        notes:              combinedNotes,
        shippingAddress:    effectiveShippingAddress,
        destinationPlaceId: destinationMetadata.placeId,
        destinationLat: destinationMetadata.lat,
        destinationLng: destinationMetadata.lng,
        requiredDeliveryDate: required_date?.trim() ?? null,
        ipAddress:          ip,
         idempotencyKey:     logicalRequestKey,
      });
    } catch (err) {
      // A guest has no canonical owner, so retain the explicit legacy fallback
      // for backward-compatible guest RFQs. An authenticated request must never
      // silently become a legacy/guest-shaped submission when the canonical
      // ownership write fails.
      if (portalCustomerId !== null) throw err;
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
       email:              resolvedEmail,
      companyId:          portalCompanyId,
      phone:              resolvedPhone,
      shippingAddress:    effectiveShippingAddress || "TBD — Quote Request",
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
  portalCustomerId?: number | null;
  body:          CreateOrderBody;
}): Promise<CreateOrderResult> {
  const { catalogItemId, portalCustomerId = null, body } = params;

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

  const customerContext = portalCustomerId
    ? await getPortalCustomerContext(portalCustomerId)
    : null;
  if (customerContext && customerContext.status === "company_pending") {
    throw makeServiceError(422, "Permintaan perusahaan Anda masih menunggu persetujuan admin.");
  }
  if (customerContext && customerContext.status !== "individual" && customerContext.status !== "company_mapped") {
    throw makeServiceError(422, "Lengkapi atau tunggu verifikasi organisasi Customer Portal sebelum membuat order.");
  }
  const portalCompanyId = customerContext?.companyId ?? null;

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
      companyId:        portalCompanyId,
      customerName:      customerName.trim(),
      email:             customerContext?.customer.email ?? email?.trim() ?? "",
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
