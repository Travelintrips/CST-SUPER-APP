import { z } from "zod";
import { Router, Request, Response } from "express";
import { randomBytes, createSign, createHash, randomUUID } from "crypto";
import { db } from "@workspace/db";
import {
  logisticOrdersTable,
  logisticOrderItemsTable,
  portalContentTable,
  suppliersTable,
  driverJobsTable,
  driverJobLogsTable,
  driverPhotosTable,
  logisticOrderRfqsTable,
  driverLocationsTable,
  orderUpdatesTable,
  vendorResponsesTable,
  podOcrResultsTable,
  rfqVendorLinksTable,
  freightShipmentsTable,
  productTemplatesTable,
  vendorFulfillmentLinksTable,
  logisticVendorFulfillmentsTable,
  orderAuditLogsTable,
  portalCustomersTable,
} from "@workspace/db";
import { resolveTemplate } from "@workspace/product-templates";
import { deleteFromSupabase } from "../lib/supabaseStorage.js";
import { eq, ilike, and, gte, lte, or, sql, desc, inArray, isNotNull } from "drizzle-orm";
import { salesDocumentsTable, customerInvoiceLinksTable, paymentsTable } from "@workspace/db";
import { requireClerkUser, requireRole } from "../lib/requireAdmin.js";
import { isPpjkOrder, autoCreatePpjkOrderInTx } from "../lib/ppjkAutoCreate.js";
import { calcTax, calcGrandTotal } from "../lib/taxHelper.js";
import { resolveCompanyId } from "../lib/resolveCompany.js";
import { assertCompanyAccess } from "../lib/assertCompanyAccess.js";
import { optionalCustomerPortalAuth, requirePortalAdmin, type PortalAuthReq } from "../lib/supabaseAuth.js";
import { verifyPortalJwt } from "../lib/portalJwt.js";
import { verifySupabaseToken } from "../lib/supabaseAdmin.js";
import { externalIntegrationsDisabled } from "../lib/safeDev.js";
import { normalizeCompanyId } from "../lib/services/portalCompanyScopeUtils.js";
import {
  getPortalCustomerContext,
  PortalCustomerContextError,
} from "../lib/services/portalCustomerContextService.js";

// Best-effort: resolve the authenticated portal customer's email from an
// Authorization bearer token, if present and valid. Returns null on any
// missing/invalid/expired token instead of throwing, since this is used to
// grant an ownership bypass on top of an otherwise-public endpoint, never to
// gate access on its own.
async function getAuthenticatedPortalEmail(req: Request): Promise<string | null> {
  const auth = req.headers.authorization;
  if (!auth?.startsWith("Bearer ")) return null;
  const token = auth.slice(7);
  try {
    const portalPayload = await verifyPortalJwt(token);
    if (portalPayload) {
      const [customer] = await db
        .select()
        .from(portalCustomersTable)
        .where(eq(portalCustomersTable.id, portalPayload.customerId));
      return customer?.email ?? null;
    }
    const supabaseUser = await verifySupabaseToken(token);
    return supabaseUser?.email ?? null;
  } catch {
    return null;
  }
}
import {
  sendLogisticOrderNotification,
  sendVendorOrderStatusChangeNotification,
  sendLogisticOrderStatusCustomerNotification,
  sendLogisticOperationalStatusNotification,
  sendInvoiceIssuedNotification,
} from "../lib/orderNotification";
import { generateShortLink } from "../lib/shortLink.js";
import { getPreferredDomain } from "../lib/domain.js";
import { logActivity } from "../lib/activityLog.js";
import { logOrderStatusChange, logOrderAudit } from "../lib/auditTrail.js";
import { writeAuditLog, extractRequestMeta } from "../lib/auditLog.js";
// [FLOW BARU] autoCreateRfqAndNotifyVendors dinonaktifkan — vendor tidak boleh dihubungi langsung saat order dibuat.
// Admin harus review dulu via /bizportal/logistics/rfq sebelum blast ke vendor.
// import { autoCreateRfqAndNotifyVendors } from "./logisticRfq";
import { sendViaService as sendWhatsApp } from "../lib/waTransport.js";
import { saveAndBroadcast } from "../lib/notificationStore";
import { broadcastToPortal } from "../lib/sseManager.js";
import { broadcastInvalidation } from "../lib/alertsBroadcast.js";
import { sendPushToOrder } from "../lib/webPush.js";
import { updateOrderProgress, getOrderProgressEvents, deleteOrderProgress, PROGRESS_STEPS, type StepKey } from "../lib/orderProgress.js";
import {
  CreateLogisticOrderBody,
  ListLogisticOrdersQueryParams,
  GetLogisticOrderByNumberParams,
  GetLogisticOrderParams,
  UpdateLogisticOrderStatusParams,
  UpdateLogisticOrderStatusBody,
} from "@workspace/api-zod";
import {
  STATUS_LABEL_ID,
  CUSTOMER_WA_MESSAGES,
  VENDOR_WA_NOTES,
  VENDOR_NOTIFY_STATUS_SET,
  STATUS_NORMALIZATION_SQL,
} from "../lib/logisticStatusConstants.js";
import {
  transitionLogisticOrderStatus,
  getAllowedTransitions,
} from "../lib/services/logisticOrderStatusService.js";
import { wasRecentlyNotified } from "../lib/notificationLog.js";
import { getAdminWa } from "../lib/adminWa.js";

export const logisticOrdersPublicRouter = Router();
export const logisticOrdersRouter = Router();

// Inline migration: payment_proof_url column
db.execute(sql`ALTER TABLE logistic_orders ADD COLUMN IF NOT EXISTS payment_proof_url TEXT`)
  .catch(() => {});

// Inline migration: vendor catalog reference columns on logistic_order_items
db.execute(sql`
  ALTER TABLE logistic_order_items
    ADD COLUMN IF NOT EXISTS item_source TEXT DEFAULT 'manual',
    ADD COLUMN IF NOT EXISTS vendor_catalog_item_id INTEGER,
    ADD COLUMN IF NOT EXISTS vendor_id INTEGER REFERENCES suppliers(id) ON DELETE SET NULL,
    ADD COLUMN IF NOT EXISTS service_type TEXT,
    ADD COLUMN IF NOT EXISTS price_snapshot JSONB,
    ADD COLUMN IF NOT EXISTS calculation_input JSONB,
    ADD COLUMN IF NOT EXISTS vendor_fulfillment_id INTEGER
`).catch(() => {});

// [C4-FIX] IP-based rate limit for public order creation: max 10 orders per IP per hour
const _publicOrderRateMap = new Map<string, { count: number; resetAt: number }>();
function _checkPublicOrderRate(ip: string): boolean {
  const now = Date.now();
  let entry = _publicOrderRateMap.get(ip);
  if (!entry || now > entry.resetAt) {
    entry = { count: 0, resetAt: now + 60 * 60 * 1000 }; // 1-hour window
  }
  // BLK-02 fix: use REPLIT_DEPLOYMENT as canonical production signal (per ADR-0001 / envGuard)
  const cap = process.env.REPLIT_DEPLOYMENT ? 10 : 1000;
  if (entry.count >= cap) return false;
  entry.count++;
  _publicOrderRateMap.set(ip, entry);
  return true;
}

function generateOrderNumber(): string {
  const date = new Date();
  const y = date.getFullYear().toString().slice(-2);
  const m = String(date.getMonth() + 1).padStart(2, "0");
  const d = String(date.getDate()).padStart(2, "0");
  // Cryptographically secure 7-digit suffix (10,000,000 combos/day) instead of
  // Math.random() 5-digit (90,000 combos/day) — reduces enumeration/guessing
  // risk on public lookup endpoints (/by-number, /track) that key off this value.
  const rand = randomBytes(4).readUInt32BE(0) % 9000000 + 1000000;
  return `LOG-${y}${m}${d}-${rand}`;
}

function toOrder(row: typeof logisticOrdersTable.$inferSelect, approvedVendorName?: string | null) {
  return {
    id: row.id,
    orderNumber: row.orderNumber,
    companyId: row.companyId ?? null,
    companyName: row.companyName,
    customerName: row.customerName,
    email: row.email,
    phone: row.phone,
    orderType: (row as any).orderType ?? "shipment",
    shipmentType: row.shipmentType,
    origin: row.origin,
    destination: row.destination,
    commodity: row.commodity ?? null,
    cargoDescription: row.cargoDescription ?? null,
    grossWeight: row.grossWeight ? parseFloat(row.grossWeight) : null,
    volumeCbm: row.volumeCbm ? parseFloat(row.volumeCbm) : null,
    jumlahKoli: row.jumlahKoli ?? null,
    requiredDate: row.requiredDate ?? null,
    notes: row.notes ?? null,
    paymentType: row.paymentType ?? null,
    paymentMethod: row.paymentMethod ?? null,
    senderName: row.senderName ?? null,
    namaPenerima: row.namaPenerima ?? null,
    nomorPenerima: row.nomorPenerima ?? null,
    jamOrder: row.jamOrder ?? null,
    source: row.source ?? "manual",
    subtotal: parseFloat(row.subtotal),
    tax: parseFloat(row.tax),
    grandTotal: parseFloat(row.grandTotal),
    status: row.status,
    approvedQuoteId: row.approvedQuoteId ?? null,
    adminApprovalStatus: row.adminApprovalStatus ?? null,
    approvedAt: row.approvedAt?.toISOString() ?? null,
    approvedVendorId: row.approvedVendorId ?? null,
    approvedVendorName: approvedVendorName ?? null,
    finalSellingPrice: row.finalSellingPrice ? parseFloat(row.finalSellingPrice) : null,
    quotationSentAt: row.quotationSentAt?.toISOString() ?? null,
    version: (row as any).version ?? 1,
    // Step 2: Product Template Engine fields
    categoryKey: (row as any).categoryKey ?? null,
    templateId: (row as any).templateId ?? null,
    templateVersion: (row as any).templateVersion ?? null,
    templateSnapshot: (row as any).templateSnapshot ?? null,
    requiredDocs: (row as any).requiredDocs ?? null,
    createdAt: row.createdAt.toISOString(),
    updatedAt: ((row as any).updatedAt ?? row.createdAt).toISOString(),
  };
}

function toItem(row: typeof logisticOrderItemsTable.$inferSelect) {
  return {
    id: row.id,
    orderId: row.orderId,
    category: row.category,
    serviceName: row.serviceName,
    calculatorType: row.calculatorType,
    inputData: row.inputData,
    calculationResult: row.calculationResult,
    subtotal: parseFloat(row.subtotal),
    itemSource: row.itemSource ?? "manual",
    vendorCatalogItemId: row.vendorCatalogItemId ?? null,
    vendorId: row.vendorId ?? null,
    serviceType: row.serviceType ?? null,
    priceSnapshot: row.priceSnapshot ?? null,
    calculationInput: row.calculationInput ?? null,
    templateSnapshot: row.templateSnapshot ?? null,
    vendorFulfillmentId: (row as any).vendorFulfillmentId ?? null,
    vendorFulfillmentStatus: (row as any).vendorFulfillmentStatus ?? null,
    vendorFulfillmentCreatedAt: (row as any).vendorFulfillmentCreatedAt ? new Date((row as any).vendorFulfillmentCreatedAt).toISOString() : null,
    createdAt: row.createdAt.toISOString(),
  };
}

/** Public-safe item projection — strips financial and raw-input data */
function toPublicItem(row: typeof logisticOrderItemsTable.$inferSelect) {
  return {
    id: row.id,
    category: row.category,
    serviceName: row.serviceName,
    calculatorType: row.calculatorType,
    createdAt: row.createdAt.toISOString(),
  };
}

const TRUCKING_RATES_KEY = "logistic_trucking_rates";

const DEFAULT_TRUCKING_RATES: Record<string, { ratePerKm: number; loadingFee: number }> = {
  CDE:      { ratePerKm: 5000,  loadingFee: 500000 },
  CDD:      { ratePerKm: 7000,  loadingFee: 700000 },
  Fuso:     { ratePerKm: 10000, loadingFee: 1000000 },
  Wingbox:  { ratePerKm: 12000, loadingFee: 1200000 },
  Trailer:  { ratePerKm: 15000, loadingFee: 1500000 },
};

async function getTruckingRates() {
  const [row] = await db
    .select()
    .from(portalContentTable)
    .where(eq(portalContentTable.key, TRUCKING_RATES_KEY));
  if (!row) return DEFAULT_TRUCKING_RATES;
  try {
    return JSON.parse(row.value) as typeof DEFAULT_TRUCKING_RATES;
  } catch {
    return DEFAULT_TRUCKING_RATES;
  }
}

// ─── Boot migration: ensure updated_at column exists + normalize legacy statuses + Step 2 template columns
db.execute(sql.raw(`
  ALTER TABLE logistic_orders ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ DEFAULT NOW();
  UPDATE logistic_orders SET updated_at = created_at WHERE updated_at IS NULL;
  ALTER TABLE logistic_orders ADD COLUMN IF NOT EXISTS category_key TEXT;
  ALTER TABLE logistic_orders ADD COLUMN IF NOT EXISTS template_id INTEGER;
  ALTER TABLE logistic_orders ADD COLUMN IF NOT EXISTS template_version TEXT;
  ALTER TABLE logistic_orders ADD COLUMN IF NOT EXISTS template_snapshot JSONB;
  ALTER TABLE logistic_orders ADD COLUMN IF NOT EXISTS tracking_token TEXT;
  ALTER TABLE logistic_orders ADD COLUMN IF NOT EXISTS track_token_expires_at TIMESTAMPTZ;
  ALTER TABLE logistic_order_rfqs ADD COLUMN IF NOT EXISTS template_id INTEGER;
  ALTER TABLE logistic_order_rfqs ADD COLUMN IF NOT EXISTS template_version TEXT;
  ALTER TABLE logistic_order_rfqs ADD COLUMN IF NOT EXISTS template_snapshot JSONB;
  ${STATUS_NORMALIZATION_SQL}
`))
  .then(() => _backfillTemplateSnapshots())
  .catch((e: unknown) => console.warn("[logistic_orders] boot migration warn:", e));

// ─── Backfill: isi template_snapshot untuk semua order lama yang belum punya snapshot ──────────
async function _backfillTemplateSnapshots(): Promise<void> {
  try {
    const rows = await db.execute<{ id: number; category_key: string }>(sql`
      SELECT id, category_key
      FROM logistic_orders
      WHERE category_key IS NOT NULL
        AND template_snapshot IS NULL
    `);
    if (rows.rows.length === 0) return;
    console.log(`[backfill] templateSnapshot: backfilling ${rows.rows.length} order(s)...`);
    for (const row of rows.rows) {
      const info = await resolveTemplateForCategory(row.category_key);
      if (!info.templateSnapshot) continue;
      await db.execute(sql`
        UPDATE logistic_orders
        SET template_snapshot = ${JSON.stringify(info.templateSnapshot)}::jsonb
        WHERE id = ${row.id}
          AND template_snapshot IS NULL
      `);
    }
    console.log(`[backfill] templateSnapshot: selesai.`);
  } catch (e) {
    console.warn("[backfill] templateSnapshot error:", e);
  }
}

// ─── Step 2: Helper — resolve ProductTemplate for a given categoryKey ─────────
async function resolveTemplateForCategory(categoryKey: string | null | undefined): Promise<{
  resolvedCategoryKey: string | null;
  templateId: number | null;
  templateVersion: string | null;
  templateSnapshot: Record<string, unknown> | null;
  requiredDocs: string[] | null;
}> {
  const empty = { resolvedCategoryKey: null, templateId: null, templateVersion: null, templateSnapshot: null, requiredDocs: null };
  if (!categoryKey?.trim()) return empty;
  try {
    const [row] = await db.select().from(productTemplatesTable)
      .where(eq(productTemplatesTable.categoryKey, categoryKey));
    const override = row ? {
      categoryKey: row.categoryKey,
      label: row.label,
      version: row.version,
      isActive: row.isActive,
      requiredDocuments: row.requiredDocuments as import("@workspace/product-templates").RequiredDocument[],
      checklist: row.checklist as import("@workspace/product-templates").ChecklistItem[],
      customFields: row.customFields as import("@workspace/product-templates").CustomField[],
      packagingInstructions: row.packagingInstructions ?? undefined,
      conditionalRules: row.conditionalRules as import("@workspace/product-templates").ConditionalRule[],
      validationRules: row.validationRules as import("@workspace/product-templates").ValidationRule[],
    } : null;
    const template = resolveTemplate(categoryKey, override);
    const requiredDocs = template.requiredDocuments.filter(d => d.required).map(d => d.label);
    return {
      resolvedCategoryKey: categoryKey,
      templateId: row?.id ?? null,
      templateVersion: template.version,
      templateSnapshot: template as unknown as Record<string, unknown>,
      requiredDocs: requiredDocs.length > 0 ? requiredDocs : null,
    };
  } catch (e) {
    console.warn("[resolveTemplateForCategory] error:", e);
    return empty;
  }
}

// ─── PUBLIC ROUTES (no auth required) ────────────────────────────────────────

// POST /api/logistic/orders — create order (public customer portal endpoint)
logisticOrdersPublicRouter.post("/", optionalCustomerPortalAuth, async (req: Request, res: Response) => {
  // [C4-FIX] IP-based rate limit: prevent bot flooding
  const clientIp = ((req.ip ?? req.socket?.remoteAddress) || "unknown").replace(/^::ffff:/, "");
  if (!_checkPublicOrderRate(clientIp)) {
    return res.status(429).json({ message: "Terlalu banyak permintaan. Coba lagi dalam 1 jam." });
  }

  const parsed = CreateLogisticOrderBody.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ message: "Data tidak valid", errors: parsed.error.errors });
  }
  const body = parsed.data as any;

  // An authenticated request is always owned by the session customer.  The
  // contact/company fields in the browser payload are display-only and cannot
  // select another customer or tenant.
  const authenticatedCustomerId = (req as Partial<PortalAuthReq>).portalCustomerId;
  let ownerContext: Awaited<ReturnType<typeof getPortalCustomerContext>> | null = null;
  if (authenticatedCustomerId) {
    try {
      ownerContext = await getPortalCustomerContext(authenticatedCustomerId);
    } catch (error) {
      if (error instanceof PortalCustomerContextError) {
        return res.status(error.statusCode).json({ message: error.message });
      }
      throw error;
    }
    if (!ownerContext.customerType) {
      return res.status(422).json({ message: "Profil customer belum menyelesaikan tipe akun." });
    }
    if (ownerContext.customerType === "company" && !ownerContext.companyId) {
      return res.status(422).json({ message: "Customer Portal belum memiliki membership perusahaan aktif." });
    }
  }

  const orderCustomerName = ownerContext?.customer.name ?? body.customerName;
  const orderEmail = ownerContext?.customer.email ?? body.email;
  const orderPhone = ownerContext?.customer.phone ?? body.phone;
  const orderCompanyName = ownerContext
    ? ownerContext.company?.name ?? "Individual"
    : body.companyName;
  const orderCompanyId = ownerContext?.companyId ?? null;
  const orderPortalCustomerId = ownerContext?.customer.id ?? null;

  // ── Extra validation (beyond generated Zod schema) ───────────────────────
  const extraErrors: string[] = [];
  if (!String(orderCustomerName ?? "").trim()) extraErrors.push("customerName tidak boleh kosong");
  if (!String(orderEmail ?? "").trim() || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(orderEmail ?? "").trim()))
    extraErrors.push("Format email tidak valid");
  if (!String(orderPhone ?? "").trim()) extraErrors.push("phone tidak boleh kosong");
  if (body.subtotal < 0) extraErrors.push("subtotal tidak boleh negatif");
  if (body.tax < 0) extraErrors.push("tax tidak boleh negatif");
  if (body.grandTotal < 0) extraErrors.push("grandTotal tidak boleh negatif");
  if (body.items.length === 0) extraErrors.push("items tidak boleh kosong");
  if (extraErrors.length > 0)
    return res.status(400).json({ message: "Data tidak valid", errors: extraErrors });

  // Server-side subtotal validation: jumlahkan subtotal per item, jangan percaya nilai agregat dari client
  const computedSubtotal = body.items.reduce((sum: number, item: any) => sum + Number(item.subtotal ?? 0), 0);
  const clientSubtotal = Number(body.subtotal);
  if (Math.abs(computedSubtotal - clientSubtotal) > 1) {
    req.log.warn(
      { clientSubtotal, computedSubtotal, diff: clientSubtotal - computedSubtotal, email: body.email },
      "AUDIT: frontend subtotal mismatch — menggunakan nilai server-computed",
    );
  }
  const verifiedSubtotal = computedSubtotal;

  // Anti-duplicate: tolak jika email yang sama sudah membuat order dalam 60 detik terakhir
  const oneMinuteAgo = new Date(Date.now() - 60 * 1000);
  const [recentDuplicate] = await db
    .select({ id: logisticOrdersTable.id, orderNumber: logisticOrdersTable.orderNumber })
    .from(logisticOrdersTable)
    .where(and(
      eq(logisticOrdersTable.email, orderEmail),
      gte(logisticOrdersTable.createdAt, oneMinuteAgo),
    ))
    .limit(1);
  if (recentDuplicate) {
    return res.status(429).json({
      message: "Pesanan sudah dikirim baru-baru ini. Mohon tunggu sebentar atau cek email konfirmasi Anda.",
      orderNumber: recentDuplicate.orderNumber,
    });
  }

  const orderNumber = generateOrderNumber();

  // Step 2: resolve Product Template jika categoryKey dikirim
  const templateInfo = await resolveTemplateForCategory(body.categoryKey ?? null);

  // P0 — Transactional auto-create: logistic_orders + ppjk_orders in ONE transaction.
  // If PPJK insert fails, the logistic order is rolled back too. No fire-and-forget.
  const orderValues = {
    orderNumber,
    companyId: orderCompanyId,
    portalCustomerId: orderPortalCustomerId,
    companyName: orderCompanyName,
    customerName: orderCustomerName,
    email: orderEmail,
    phone: orderPhone,
    orderType: body.orderType ?? "shipment",
    shipmentType: body.shipmentType ?? "",
    origin: body.origin ?? "",
    destination: body.destination ?? "",
    commodity: body.commodity ?? null,
    cargoDescription: body.cargoDescription ?? null,
    grossWeight: body.grossWeight != null ? String(body.grossWeight) : null,
    volumeCbm: body.volumeCbm != null ? String(body.volumeCbm) : null,
    jumlahKoli: body.jumlahKoli ?? null,
    requiredDate: body.requiredDate ?? null,
    notes: body.notes ?? null,
    paymentType: body.paymentType ?? null,
    paymentMethod: body.paymentMethod ?? null,
    senderName: body.senderName ?? null,
    namaPenerima: body.namaPenerima ?? null,
    nomorPenerima: body.nomorPenerima ?? null,
    jamOrder: body.jamOrder ?? null,
    // [MULTI-MODE] transport mode fields
    transportMode: body.transportMode ?? null,
    originDistrict: body.originDistrict ?? null,
    destDistrict: body.destDistrict ?? null,
    pickupDate: body.pickupDate ?? null,
    pickupTime: body.pickupTime ?? null,
    truckType: body.truckType ?? null,
    originPort: body.originPort ?? null,
    destPort: body.destPort ?? null,
    weightKg: body.weightKg != null ? String(body.weightKg) : null,
    incoterm: body.incoterm ?? null,
    etd: body.etd ? new Date(body.etd) : null,
    eta: body.eta ? new Date(body.eta) : null,
    source: "portal",
    // Exclusive PPN: subtotal = DPP (server-verified), tax = DPP × 11%, grandTotal = DPP + tax
    subtotal: String(verifiedSubtotal),
    tax: String(calcTax(verifiedSubtotal)),
    grandTotal: String(calcGrandTotal(verifiedSubtotal)),
    status: "New Order",
    publicRfqToken: randomBytes(32).toString("hex"), // P0.2 — 256-bit
    // Step 2: Product Template Engine
    ...(templateInfo.resolvedCategoryKey ? {
      categoryKey: templateInfo.resolvedCategoryKey,
      templateId: templateInfo.templateId,
      templateVersion: templateInfo.templateVersion,
      templateSnapshot: templateInfo.templateSnapshot,
      requiredDocs: templateInfo.requiredDocs,
    } : {}),
  };

  const order = await db.transaction(async (tx) => {
    const [o] = await (tx as any).insert(logisticOrdersTable).values(orderValues).returning();
    if (isPpjkOrder(body.shipmentType ?? "")) {
      // Transactional: PPJK insert failure rolls back the logistic order too.
      await autoCreatePpjkOrderInTx(tx as any, {
        portalOrderId: o.id,
        companyId: (o as any).companyId ?? null,
         customerName: orderCustomerName,
         customerEmail: orderEmail,
         customerPhone: orderPhone,
         customerCompany: orderCompanyName || null,
        shipmentType: body.shipmentType ?? "",
        commodity: body.commodity ?? null,
        grossWeight: body.grossWeight != null ? String(body.grossWeight) : null,
        volumeCbm: body.volumeCbm != null ? String(body.volumeCbm) : null,
        origin: body.origin ?? null,
        destination: body.destination ?? null,
        notes: body.notes ?? null,
        ipAddress: req.ip ?? null,
        userAgent: req.headers["user-agent"] ?? null,
      });
    }
    return o;
  });

  // Auto-generate tracking token saat order dibuat agar customer langsung bisa akses tracking
  const trackingToken = randomBytes(32).toString("hex"); // P0.2 — 256-bit
  await db.execute(sql`UPDATE logistic_orders SET tracking_token = ${trackingToken}, track_token_expires_at = NOW() + INTERVAL '90 days' WHERE id = ${order.id}`);
  const domain = getPreferredDomain();
  const trackUrl = domain
    ? `https://${domain}/order-track/${trackingToken}`
    : `/order-track/${trackingToken}`;
  generateShortLink(trackUrl, {
    context: "order_tracking",
    refType: "order",
    refId: orderNumber,
  }).catch((err: unknown) => req.log.warn({ err }, "shortLink: tracking link generation failed"));

  const itemValues = body.items.map((item: any) => ({
    orderId: order.id,
    category: item.category,
    serviceName: item.serviceName,
    calculatorType: item.calculatorType,
    inputData: item.inputData as Record<string, unknown>,
    calculationResult: item.calculationResult as Record<string, unknown>,
    subtotal: String(item.subtotal),
    itemSource: item.itemSource ?? "manual",
    vendorCatalogItemId: item.vendorCatalogItemId ?? null,
    vendorId: item.vendorId ?? null,
    serviceType: item.serviceType ?? null,
    priceSnapshot: (item.priceSnapshot as Record<string, unknown> | null) ?? null,
    calculationInput: (item.calculationInput as Record<string, unknown> | null) ?? null,
    templateSnapshot: (item.templateSnapshot as Record<string, unknown> | null)
      ?? ((item.inputData as Record<string, unknown> | null)?.templateSnapshot as Record<string, unknown> | null)
      ?? null,
  }));

  const items =
    itemValues.length > 0
      ? await db.insert(logisticOrderItemsTable).values(itemValues).returning()
      : [];

  const isProductOrder = (body.orderType ?? "shipment") === "product";
  const serviceList = !isProductOrder
    ? body.items.map((i: any) => `• ${i.serviceName}`).join("\n")
    : "";
  const orderItems = body.items.map((i: any) => ({
    name: i.serviceName,
    qty: null as number | null,
    subtotal: i.subtotal != null ? Number(i.subtotal) : null,
  }));

  const vehicleType =
    (body.items.find((i: any) => i.calculatorType === "trucking")
      ?.inputData as Record<string, unknown> | undefined)
      ?.vehicleType as string ?? null;
sendLogisticOrderNotification({
    id: order.id,
    orderNumber,
    customerName: orderCustomerName,
    companyName: orderCompanyName,
    email: orderEmail,
    phone: orderPhone,
    orderType: body.orderType ?? "shipment",
    shipmentType: body.shipmentType ?? "",
    origin: body.origin ?? "",
    destination: body.destination ?? "",
    commodity: body.commodity ?? null,
    cargoDescription: body.cargoDescription ?? null,
    grossWeight: !isProductOrder && body.grossWeight != null ? Number(body.grossWeight) : null,
    volumeCbm: !isProductOrder && body.volumeCbm != null ? Number(body.volumeCbm) : null,
    jumlahKoli: !isProductOrder && body.jumlahKoli != null ? Number(body.jumlahKoli) : null,
    subtotal: body.subtotal != null ? Number(body.subtotal) : null,
    tax: body.tax != null ? Number(body.tax) : null,
    grandTotal: Number(body.grandTotal),
    serviceList,
    orderItems,
    requiredDate: body.requiredDate ?? null,
    notes: body.notes ?? null,
    jamOrder: body.jamOrder ?? null,
    vehicleType,
    createdAt: order.createdAt,
    publicRfqToken: order.publicRfqToken ?? null,
    trackingToken,
  }).catch((err: unknown) => {
    req.log.error({ err }, "sendLogisticOrderNotification failed");
  });

  // Progress bar: ORDER_RECEIVED — set immediately when order is created
  updateOrderProgress(order.id, "ORDER_RECEIVED", "system", body.customerName, "Order baru dibuat oleh customer").catch(() => {});

  // PPJK auto-create is now handled INSIDE the db.transaction() above.
  // Fire-and-forget removed — failure rolls back the logistic order too.

  // [FLOW BARU] Auto-blast ke vendor DINONAKTIFKAN.
  // Order masuk → status admin_review → Admin review → Admin blast ke vendor.
  // RFQ dibuat manual oleh admin via POST /api/logistic/rfq/create-from-order/:orderId

  saveAndBroadcast("new_logistic_order", {
    type: "logistic",
    orderId: order.id,
    orderNumber,
    customerName: body.customerName,
    companyName: body.companyName ?? null,
    orderType: body.orderType ?? "shipment",
    shipmentType: body.shipmentType ?? "",
    origin: body.origin ?? "",
    destination: body.destination ?? "",
    grandTotal: Number(body.grandTotal),
    createdAt: order.createdAt.toISOString(),
  }).catch(() => {});

  // Broadcast ke BizPortal SSE agar dashboard & order list auto-refresh
  broadcastInvalidation("logistic_orders", order.id);

  // Broadcast ke Customer Portal agar logistic-admin page auto-refresh
  broadcastToPortal("new_logistic_order", {
    orderId: order.id,
    orderNumber,
    customerName: body.customerName,
    companyName: body.companyName ?? null,
    shipmentType: body.shipmentType ?? "",
    origin: body.origin ?? "",
    destination: body.destination ?? "",
    createdAt: order.createdAt.toISOString(),
  });

  logActivity({
    orderId: order.id,
    actorType: "customer",
    actorName: body.customerName,
    action: "order_created",
    description: `Order ${orderNumber} dibuat oleh ${body.customerName} (${body.companyName ?? "-"}) — ${body.shipmentType} ${body.origin}→${body.destination}`,
    newValue: { orderNumber, grandTotal: body.grandTotal, shipmentType: body.shipmentType },
    ipAddress: req.ip ?? null,
  }).catch(() => {});

  // Audit trail: order_status_history + order_audit_logs
  logOrderStatusChange({
    orderId: order.id,
    orderNumber,
    oldStatus: null,
    newStatus: "New Order",
    changedByType: "customer",
    changedByName: body.customerName,
    changedByIp: req.ip ?? null,
    notes: "Order dibuat",
    source: "POST /logistic/orders",
  }).catch(() => {});
  logOrderAudit({
    orderId: order.id,
    orderNumber,
    actorType: "customer",
    actorName: body.customerName,
    action: "order_created",
    description: `Order ${orderNumber} dibuat oleh ${body.customerName} (${body.companyName ?? "-"}) — ${body.shipmentType} ${body.origin ?? ""}→${body.destination ?? ""}`,
    newValue: { status: "New Order", grandTotal: body.grandTotal, shipmentType: body.shipmentType },
    ipAddress: req.ip ?? null,
  }).catch(() => {});

  return res.status(201).json({
    ...toOrder(order),
    items: items.map(toItem),
  });
});

/** Public-safe order projection — strips PII, payment, financial, and internal approval fields */
function toPublicOrder(row: typeof logisticOrdersTable.$inferSelect) {
  return {
    id: row.id,
    orderNumber: row.orderNumber,
    orderType: (row as any).orderType ?? "shipment",
    shipmentType: row.shipmentType,
    origin: row.origin,
    destination: row.destination,
    grossWeight: row.grossWeight ? parseFloat(row.grossWeight) : null,
    volumeCbm: row.volumeCbm ? parseFloat(row.volumeCbm) : null,
    jumlahKoli: row.jumlahKoli ?? null,
    requiredDate: row.requiredDate ?? null,
    status: row.status,
    createdAt: row.createdAt.toISOString(),
  };
}

/** In-memory rate limiter for public order-number lookup endpoints.
 *  Limit: 5 requests / minute / IP (tightened from 20 to reduce enumeration risk). */
const publicLookupHits = new Map<string, { count: number; resetAt: number }>();
function publicLookupRateLimit(req: Request, res: Response, next: () => void) {
  const ip = (req.headers["x-forwarded-for"] as string | undefined)?.split(",")[0]?.trim() ?? req.socket.remoteAddress ?? "unknown";
  const now = Date.now();
  const window = 60_000;
  const limit = 5;
  const entry = publicLookupHits.get(ip);
  if (!entry || now > entry.resetAt) {
    publicLookupHits.set(ip, { count: 1, resetAt: now + window });
    return next();
  }
  if (entry.count >= limit) {
    res.status(429).json({ error: "Terlalu banyak permintaan. Coba lagi sebentar." });
    return;
  }
  entry.count += 1;
  next();
}

// GET /api/logistic/orders/by-number/:orderNumber — minimal public lookup (no PII fields)
logisticOrdersPublicRouter.get(
  "/by-number/:orderNumber",
  publicLookupRateLimit,
  async (req: Request, res: Response) => {
    const parsed = GetLogisticOrderByNumberParams.safeParse(req.params);
    if (!parsed.success) return res.status(400).json({ message: "Parameter tidak valid" });
    const { orderNumber } = parsed.data;

    const [order] = await db
      .select()
      .from(logisticOrdersTable)
      .where(eq(logisticOrdersTable.orderNumber, orderNumber));

    if (!order) return res.status(404).json({ message: "Order tidak ditemukan" });

    const items = await db
      .select()
      .from(logisticOrderItemsTable)
      .where(eq(logisticOrderItemsTable.orderId, order.id));

    // Strip origin/destination to prevent PII enumeration via guessable order numbers.
    // Full tracking detail (incl. route) is available on /track/:orderNumber for the owner.
    const { origin: _o, destination: _d, ...safeOrder } = toPublicOrder(order);
    return res.json({ ...safeOrder, items: items.map(toPublicItem) });
  }
);

// GET /api/logistic/orders/track/:orderNumber — tracking data with driver job (public)
// NOTE: this is mounted on `logisticOrderTrackPublicRouter` (see bottom of file),
// NOT on the RBAC-guarded `logisticOrdersRouter`, because it must be reachable by
// anonymous customer-portal visitors. Its own auth is: owner bearer token OR
// last-4-digits phone match (see checks below) — never rely on router mounting
// alone to gate this route.
export const logisticOrderTrackPublicRouter = Router();
logisticOrderTrackPublicRouter.get(
  "/track/:orderNumber",
  publicLookupRateLimit,
  async (req: Request, res: Response) => {
    const orderNumber = String(String(req.params.orderNumber) ?? "").toUpperCase().trim();
    if (!orderNumber) return res.status(400).json({ message: "Nomor order tidak valid" });

    const [order] = await db
      .select()
      .from(logisticOrdersTable)
      .where(eq(logisticOrdersTable.orderNumber, orderNumber));

    if (!order) return res.status(404).json({ message: "Order tidak ditemukan" });

    // Second-factor check: caller must either (a) be the authenticated portal
    // customer who owns this order (matched by email), or (b) know the last 4
    // digits of the phone number on file. This prevents full order detail
    // (route, invoice, driver job, POD photos, WhatsApp-derived contact info)
    // from being harvested by anyone who can guess/enumerate an order number,
    // since knowing the order number alone is no longer sufficient credential.
    const ownerEmail = await getAuthenticatedPortalEmail(req);
    const isOwner = !!ownerEmail && !!order.email && ownerEmail.toLowerCase() === order.email.toLowerCase();

    if (!isOwner) {
      const phoneDigitsOnFile = (order.phone ?? "").replace(/\D/g, "");
      const last4OnFile = phoneDigitsOnFile.slice(-4);
      const providedPhone = String(req.query.phone ?? "").replace(/\D/g, "");
      if (!last4OnFile || providedPhone !== last4OnFile) {
        return res.status(403).json({
          message: "Verifikasi diperlukan: masukkan 4 digit terakhir nomor HP yang terdaftar pada order ini.",
          requiresPhoneVerification: true,
        });
      }
    }

    // Run all independent queries in parallel — eliminates N+1 sequential awaits
    const [items, [driverJob], [latestRfq], orderUpdates, progressEvents, podSubmissionsRaw, invoiceLinksRaw, autoInvoiceRaw] = await Promise.all([
      db.select({
        id: logisticOrderItemsTable.id,
        orderId: logisticOrderItemsTable.orderId,
        category: logisticOrderItemsTable.category,
        serviceName: logisticOrderItemsTable.serviceName,
        calculatorType: logisticOrderItemsTable.calculatorType,
        inputData: logisticOrderItemsTable.inputData,
        calculationResult: logisticOrderItemsTable.calculationResult,
        subtotal: logisticOrderItemsTable.subtotal,
        itemSource: logisticOrderItemsTable.itemSource,
        vendorCatalogItemId: logisticOrderItemsTable.vendorCatalogItemId,
        vendorId: logisticOrderItemsTable.vendorId,
        serviceType: logisticOrderItemsTable.serviceType,
        priceSnapshot: logisticOrderItemsTable.priceSnapshot,
        calculationInput: logisticOrderItemsTable.calculationInput,
        templateSnapshot: logisticOrderItemsTable.templateSnapshot,
        createdAt: logisticOrderItemsTable.createdAt,
        vendorFulfillmentId: logisticVendorFulfillmentsTable.id,
        vendorFulfillmentStatus: logisticVendorFulfillmentsTable.status,
        vendorFulfillmentCreatedAt: logisticVendorFulfillmentsTable.createdAt,
      })
        .from(logisticOrderItemsTable)
        .leftJoin(logisticVendorFulfillmentsTable, eq(logisticVendorFulfillmentsTable.orderItemId, logisticOrderItemsTable.id))
        .where(eq(logisticOrderItemsTable.orderId, order.id)),
      db.select().from(driverJobsTable)
        .where(eq(driverJobsTable.logisticOrderId, order.id))
        .orderBy(desc(driverJobsTable.assignedAt))
        .limit(1),
      db.select().from(logisticOrderRfqsTable)
        .where(eq(logisticOrderRfqsTable.orderId, order.id))
        .orderBy(desc(logisticOrderRfqsTable.createdAt))
        .limit(1),
      db.select().from(orderUpdatesTable)
        .where(and(eq(orderUpdatesTable.orderId, order.id), eq(orderUpdatesTable.isPublic, true)))
        .orderBy(desc(orderUpdatesTable.createdAt))
        .limit(50),
      getOrderProgressEvents(order.id),
      db.execute(sql`SELECT id, receiver_name, photo_url, note, submitted_by, created_at FROM order_pod_submissions WHERE order_id = ${order.id} ORDER BY created_at DESC LIMIT 5`),
      db.select({
        token: customerInvoiceLinksTable.token,
        invoiceNumber: customerInvoiceLinksTable.invoiceNumber,
        grandTotal: customerInvoiceLinksTable.grandTotal,
        dueDate: customerInvoiceLinksTable.dueDate,
        paymentStatus: customerInvoiceLinksTable.paymentStatus,
        status: customerInvoiceLinksTable.status,
        confirmedAt: customerInvoiceLinksTable.confirmedAt,
        createdAt: customerInvoiceLinksTable.createdAt,
      }).from(customerInvoiceLinksTable)
        .where(eq(customerInvoiceLinksTable.orderId, order.id))
        .orderBy(desc(customerInvoiceLinksTable.createdAt))
        .limit(3),
      db.execute(sql`
        SELECT id, doc_number, invoice_status, grand_total, invoice_pdf_url, confirmed_at
        FROM sales_documents
        WHERE logistic_order_id = ${order.id}
        LIMIT 1
      `),
    ]);

    let driverJobData = null;
    if (driverJob) {
      // Run driver logs + photos in parallel once we know the job ID
      const [logs, photos] = await Promise.all([
        db.select().from(driverJobLogsTable)
          .where(eq(driverJobLogsTable.driverJobId, driverJob.id))
          .orderBy(desc(driverJobLogsTable.timestamp)),
        db.select().from(driverPhotosTable)
          .where(eq(driverPhotosTable.driverJobId, driverJob.id))
          .orderBy(desc(driverPhotosTable.takenAt)),
      ]);

      driverJobData = {
        id: driverJob.id,
        jobNumber: driverJob.jobNumber,
        status: driverJob.status,
        vehicleType: driverJob.vehicleType ?? null,
        pickupDateTime: driverJob.pickupDateTime?.toISOString() ?? null,
        deliveryDateTime: driverJob.deliveryDateTime?.toISOString() ?? null,
        cargoDescription: driverJob.cargoDescription ?? null,
        weight: driverJob.weight ?? null,
        distance: driverJob.distance ?? null,
        assignedAt: driverJob.assignedAt.toISOString(),
        completedAt: driverJob.completedAt?.toISOString() ?? null,
        logs: logs.map((l) => ({
          id: l.id,
          status: l.status,
          timestamp: l.timestamp.toISOString(),
        })),
        photos: photos.map((p) => ({
          id: p.id,
          url: p.url,
          photoType: p.photoType,
          takenAt: p.takenAt.toISOString(),
        })),
        truckPlate: driverJob.truckPlate ?? null,
        driverNameOverride: driverJob.driverNameOverride ?? null,
        podReceiverName: driverJob.podReceiverName ?? null,
        podGeoLat: driverJob.podGeoLat ?? null,
        podGeoLng: driverJob.podGeoLng ?? null,
        podMapUrl: (driverJob as any).podMapUrl ?? null,
        podStreetViewUrl: (driverJob as any).podStreetViewUrl ?? null,
        podDeviceTimestamp: (driverJob as any).podDeviceTimestamp ? new Date((driverJob as any).podDeviceTimestamp).toISOString() : null,
        podSubmittedAt: driverJob.podSubmittedAt?.toISOString() ?? null,
      };
    }

    // quotedPrice = customer-facing sell price (NOT vendor cost/margin) — safe to show order owner
    const rfqQuote = latestRfq ? {
      rfqId: latestRfq.id,
      rfqStatus: latestRfq.status,
      quotedPrice: latestRfq.quotedPrice ? parseFloat(latestRfq.quotedPrice) : null,
      quotedAt: latestRfq.quotedAt?.toISOString() ?? null,
      quoteNotes: (latestRfq as any).quoteNotes ?? null,
      customerResponseNotes: (latestRfq as any).customerResponseNotes ?? null,
      customerRespondedAt: (latestRfq as any).customerRespondedAt
        ? new Date((latestRfq as any).customerRespondedAt).toISOString() : null,
    } : null;

    const updatesData = orderUpdates.map((u) => ({
      id: u.id,
      status: u.status ?? null,
      notes: u.notes ?? null,
      actorType: u.actorType,
      actorName: u.actorName ?? null,
      createdAt: u.createdAt.toISOString(),
    }));

    const STEP_LABEL_MAP: Record<string, string> = {
      ORDER_RECEIVED:    "Order Diterima",
      ADMIN_REVIEW:      "Ditinjau Admin",
      // ── Phase 2A: product-first status labels ─────────────────────────────
      PRODUCT_RFQ_SENT:           "RFQ Produk Terkirim",
      PRODUCT_QUOTE_RECEIVED:     "Penawaran Produk Masuk",
      PRODUCT_VENDOR_SELECTED:    "Vendor Produk Dipilih",
      CUSTOMER_PRODUCT_APPROVAL:  "Menunggu Persetujuan Produk",
      SHIPMENT_SELECTION_PENDING: "Menunggu Pilihan Pengiriman",
      READY_FOR_PICKUP:           "Siap Dijemput",
      // ─────────────────────────────────────────────────────────────────────
      RFQ_SENT:          "RFQ ke Vendor",
      QUOTE_RECEIVED:    "Penawaran Masuk",
      CUSTOMER_APPROVAL: "Menunggu Persetujuan",
      VENDOR_CONFIRMED:  "Vendor Dikonfirmasi",
      IN_PROGRESS:       "Sedang Diproses",
      PICKUP:            "Penjemputan",
      IN_TRANSIT:        "Dalam Perjalanan",
      ARRIVED:           "Tiba di Tujuan",
      DELIVERED:         "Terkirim",
      POD_UPLOADED:      "Bukti Pengiriman",
      INVOICE_ISSUED:    "Invoice Diterbitkan",
      PAYMENT_RECEIVED:  "Pembayaran Diterima",
      COMPLETED:         "Selesai",
    };

    const progressEventsMapped = (progressEvents as any[]).map((ev) => {
      const lat = ev.gps_latitude != null ? Number(ev.gps_latitude) : null;
      const lng = ev.gps_longitude != null ? Number(ev.gps_longitude) : null;
      const hasGps = lat != null && Number.isFinite(lat) && lng != null && Number.isFinite(lng);
      return {
        id:              ev.id,
        stepKey:         ev.step_key,
        stepLabel:       STEP_LABEL_MAP[String(ev.step_key)] ?? String(ev.step_key),
        source:          ev.source,
        actorName:       ev.actor_name ?? null,
        notes:           ev.notes ?? null,
        gpsLatitude:     hasGps ? lat : null,
        gpsLongitude:    hasGps ? lng : null,
        deviceTimestamp: ev.device_timestamp ? new Date(ev.device_timestamp).toISOString() : null,
        mapUrl:          ev.map_url ?? (hasGps ? `https://www.google.com/maps?q=${lat},${lng}` : null),
        streetViewUrl:   ev.street_view_url ?? null,
        photoUrl:        ev.photo_url ?? (ev.metadata as any)?.photoUrl ?? null,
        createdAt:       ev.created_at ? new Date(ev.created_at).toISOString() : new Date().toISOString(),
      };
    });

    req.log?.info({
      orderId: order.id,
      orderNumber: order.orderNumber,
      progressEventsCount: progressEventsMapped.length,
    }, "tracking: progressEvents debug");

    const podSubmissions = (podSubmissionsRaw.rows as any[]).map((r) => ({
      id: r.id as number,
      receiverName: r.receiver_name as string | null,
      photoUrl: r.photo_url as string | null,
      note: r.note as string | null,
      submittedBy: r.submitted_by as string | null,
      createdAt: r.created_at ? new Date(r.created_at as string).toISOString() : new Date().toISOString(),
    }));

    const invoiceLinks = invoiceLinksRaw.map((r) => ({
      token: r.token,
      invoiceNumber: r.invoiceNumber,
      grandTotal: r.grandTotal ? parseFloat(r.grandTotal) : null,
      dueDate: r.dueDate ? r.dueDate.toISOString() : null,
      paymentStatus: r.paymentStatus,
      status: r.status,
      confirmedAt: r.confirmedAt ? r.confirmedAt.toISOString() : null,
      createdAt: r.createdAt.toISOString(),
    }));

    const autoInvoiceRow = (autoInvoiceRaw.rows as any[])[0] ?? null;
    const autoInvoice = autoInvoiceRow ? {
      docNumber: autoInvoiceRow.doc_number as string,
      invoiceStatus: autoInvoiceRow.invoice_status as string,
      grandTotal: autoInvoiceRow.grand_total ? parseFloat(autoInvoiceRow.grand_total as string) : null,
      pdfUrl: (autoInvoiceRow.invoice_pdf_url as string | null) ?? null,
      confirmedAt: autoInvoiceRow.confirmed_at ? new Date(autoInvoiceRow.confirmed_at as string).toISOString() : null,
    } : null;

    return res.json({
      ...toPublicOrder(order),
      customerName: order.customerName,
      grandTotal: order.grandTotal ? parseFloat(order.grandTotal) : null,
      subtotal: order.subtotal ? parseFloat(order.subtotal) : null,
      tax: order.tax ? parseFloat(order.tax) : null,
      items: items.map(toPublicItem),
      driverJob: driverJobData,
      rfqQuote,
      orderUpdates: updatesData,
      progressEvents: progressEventsMapped,
      podSubmissions,
      invoiceLinks,
      autoInvoice,
    });
  }
);

// GET /api/logistic/orders/trucking-rates — [H2-FIX] internal pricing, requires staff session
// Note: customer portal uses /api/portal/trucking-rates (separate public endpoint)
logisticOrdersRouter.get("/trucking-rates", async (req: Request, res: Response) => {
  if (!(await requireClerkUser(req, res))) return;
  const rates = await getTruckingRates();
  return res.json(rates);
});

// GET /api/logistic/orders/vendors — [H2-FIX] admin, owner & logistics staff only
logisticOrdersRouter.get("/vendors", async (req: Request, res: Response) => {
  if (!(await requireClerkUser(req, res))) return;
  if (!(await requireRole(req, res, ["admin", "owner", "logistics"]))) return;
  const limit = Math.min(Number(req.query["limit"] ?? 500), 1000);
  const offset = Math.max(Number(req.query["offset"] ?? 0), 0);
  const rows = await db.select().from(suppliersTable).orderBy(suppliersTable.sortOrder).limit(limit).offset(offset);
  return res.json(rows.map((v) => ({ ...v, fee: Number(v.fee ?? 0), email: v.contactEmail })));
});

// ── Paylabs helpers (PUBLIC) ──────────────────────────────────────────────────
const _PAYLABS_MERCHANT_ID_2 = process.env["PAYLABS_MERCHANT_ID"] ?? "";
const _PAYLABS_API_URL_2 =
  process.env["PAYLABS_API_URL"] ?? "https://sit-pay.paylabs.co.id/payment/v2.1/h5/createLink";

function _normalizePemKey2(raw: string): string {
  if (!raw) return raw;
  if (raw.includes("\n")) return raw;
  const isRsa = raw.includes("RSA PRIVATE KEY");
  const header = isRsa ? "RSA PRIVATE KEY" : "PRIVATE KEY";
  const body = raw
    .replace(/-----BEGIN [^-]+-----/g, "")
    .replace(/-----END [^-]+-----/g, "")
    .replace(/\s+/g, "");
  const chunks = body.match(/.{1,64}/g) ?? [];
  return `-----BEGIN ${header}-----\n${chunks.join("\n")}\n-----END ${header}-----`;
}

const _PAYLABS_PRIVATE_KEY_2 = _normalizePemKey2(process.env["PAYLABS_PRIVATE_KEY"] ?? "");

function _paylabsSign2(payload: string): string {
  const s = createSign("RSA-SHA256");
  s.update(payload);
  return s.sign(_PAYLABS_PRIVATE_KEY_2, "base64");
}

function _paylabsBuildSigPayload2(method: string, endpoint: string, bodyJson: string, ts: string): string {
  const bodyHash = createHash("sha256").update(bodyJson).digest("hex").toLowerCase();
  return `${method}:${endpoint}:${bodyHash}:${ts}`;
}

// POST /api/logistic/orders/:orderNumber/create-paylabs-link — PUBLIC
logisticOrdersRouter.post("/:orderNumber/create-paylabs-link", async (req: Request, res: Response) => {
  const orderNumber = String(req.params.orderNumber ?? "");
  const [order] = await db
    .select({
      id: logisticOrdersTable.id,
      orderNumber: logisticOrdersTable.orderNumber,
      companyId: logisticOrdersTable.companyId,
      customerName: logisticOrdersTable.customerName,
      phone: logisticOrdersTable.phone,
      grandTotal: logisticOrdersTable.grandTotal,
      status: logisticOrdersTable.status,
    })
    .from(logisticOrdersTable)
    .where(eq(logisticOrdersTable.orderNumber, orderNumber))
    .limit(1);
  if (!order) return res.status(404).json({ message: "Pesanan tidak ditemukan" });
  if (order.status === "Cancelled") {
    return res.status(400).json({ message: "Order sudah dibatalkan" });
  }
  if (order.companyId == null) {
    return res.status(422).json({
      message: "Order belum memiliki company yang tidak ambigu; payment link tidak dapat dibuat.",
    });
  }

  const existing = await db
    .select()
    .from(paymentsTable)
    .where(and(
      eq(paymentsTable.refId, order.id),
      eq(paymentsTable.refKind, "logistic"),
      eq(paymentsTable.status, "pending"),
      eq(paymentsTable.provider, "paylabs"),
    ))
    .orderBy(desc(paymentsTable.createdAt))
    .limit(1);

  if (existing.length > 0 && existing[0].paymentUrl) {
    const notExpired = !existing[0].expiredAt || existing[0].expiredAt > new Date();
    if (notExpired) {
      return res.json({
        reused: true,
        paymentUrl: existing[0].paymentUrl,
        amount: Number(existing[0].amount),
        expiredAt: existing[0].expiredAt?.toISOString() ?? null,
      });
    }
  }

  const amount = Number(order.grandTotal ?? 0);
  const merchantTradeNo = `LOG-${order.id}-${Date.now()}`;

  if (externalIntegrationsDisabled() || !_PAYLABS_MERCHANT_ID_2 || !_PAYLABS_PRIVATE_KEY_2) {
    // TODO Phase 3E: add createOrderLink(logistic_orders → payments) here after simulation insert
    // Blocked: no .returning() in this path and simulation is dev-only; safe to defer.
    // File: artifacts/api-server/src/routes/logisticOrders.ts, simulation payment creation.
    await db.insert(paymentsTable).values({
      companyId: order.companyId,
      refKind: "logistic",
      refId: order.id,
      refDocNumber: orderNumber,
      amount: String(amount),
      status: "pending",
      provider: "paylabs",
      providerMerchantTradeNo: merchantTradeNo,
      paymentUrl: null,
      raw: {
        simulation: true,
        reason: externalIntegrationsDisabled()
          ? "TEST_MODE — external payment gateway disabled"
          : "PAYLABS credentials not configured",
      },
      expiredAt: new Date(Date.now() + 24 * 60 * 60 * 1000),
    });
    return res.status(202).json({
      configured: false,
      message: externalIntegrationsDisabled()
        ? "TEST MODE aktif. Simulasi payment dibuat tanpa gateway eksternal."
        : "Paylabs belum terkonfigurasi. Simulasi payment dibuat.",
      paymentUrl: null,
      amount,
    });
  }

  const requestId = `${Date.now()}${Math.floor(Math.random() * 100000).toString().padStart(5, "0")}`;
  const timestamp = new Date(Date.now() + 7 * 60 * 60 * 1000).toISOString().replace(/\.\d+Z$/, "+07:00");
  const host = (req.headers["x-forwarded-proto"] ?? "https") + "://" + (req.headers.host ?? "");
  const notifyUrl = `${host}/api/payments/paylabs/webhook`;
  const redirectUrl = `${host}/track?order=${orderNumber}`;

  const rawPhone = (order.phone ?? "").replace(/\D/g, "");
  const phoneNumber = rawPhone.startsWith("62")
    ? rawPhone
    : rawPhone.startsWith("0")
      ? "62" + rawPhone.slice(1)
      : rawPhone ? "62" + rawPhone : "628000000000";

  const body = {
    merchantId: _PAYLABS_MERCHANT_ID_2,
    merchantTradeNo,
    requestId,
    amount: amount.toFixed(2),
    productName: `Pembayaran ${orderNumber}`,
    payer: order.customerName,
    phoneNumber,
    notifyUrl,
    redirectUrl,
  };
  const bodyJson = JSON.stringify(body);
  const sigPayload = _paylabsBuildSigPayload2("POST", new URL(_PAYLABS_API_URL_2).pathname, bodyJson, timestamp);
  let signature: string;
  try {
    signature = _paylabsSign2(sigPayload);
  } catch (err: unknown) {
    return res.status(500).json({ message: "Paylabs signing gagal", error: (err as Error)?.message });
  }

  let paylabsResp: Record<string, unknown> = {};
  try {
    const r = await fetch(_PAYLABS_API_URL_2, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-TIMESTAMP": timestamp,
        "X-SIGNATURE": signature,
        "X-PARTNER-ID": _PAYLABS_MERCHANT_ID_2,
        "X-REQUEST-ID": requestId,
      },
      body: bodyJson,
    });
    paylabsResp = (await r.json().catch(() => ({}))) as Record<string, unknown>;
    if (!r.ok || paylabsResp?.["errCode"] !== "0") {
      return res.status(502).json({ message: "Paylabs error", response: paylabsResp });
    }
  } catch (err: unknown) {
    return res.status(502).json({ message: "Paylabs request gagal", error: (err as Error)?.message });
  }

  const paymentUrl = (paylabsResp?.["url"] ?? paylabsResp?.["h5Url"] ?? null) as string | null;
  const [created] = await db.insert(paymentsTable).values({
    companyId: order.companyId,
    refKind: "logistic",
    refId: order.id,
    refDocNumber: orderNumber,
    amount: String(amount),
    status: "pending",
    provider: "paylabs",
    providerOrderId: (paylabsResp?.["platformTradeNo"] as string | undefined) ?? null,
    providerMerchantTradeNo: merchantTradeNo,
    paymentUrl,
    raw: paylabsResp,
    expiredAt: new Date(Date.now() + 24 * 60 * 60 * 1000),
  }).returning();

  // Phase 3D: order_links — logistic_order → payment (fire-and-forget, non-fatal)
  if (created?.id) {
    void import("../lib/services/orderLinkService.js").then(({ createOrderLink }) =>
      createOrderLink({
        sourceTable: "logistic_orders",
        sourceId: order.id,
        targetTable: "payments",
        targetId: created.id,
        linkType: "logistic_order_to_payment",
        createdBy: "logisticOrders:paylabs_create",
      })
    ).catch(() => {});
  }

  return res.status(201).json({
    configured: true,
    paymentUrl,
    amount,
    expiredAt: created.expiredAt?.toISOString() ?? null,
  });
});

// PATCH /api/logistic/orders/:orderNumber/payment-proof — PUBLIC
logisticOrdersRouter.patch("/:orderNumber/payment-proof", async (req: Request, res: Response) => {
  const orderNumber = String(req.params.orderNumber ?? "");
  const { proofUrl } = req.body as { proofUrl?: unknown };
  if (!proofUrl || typeof proofUrl !== "string" || !proofUrl.trim()) {
    return res.status(400).json({ message: "proofUrl wajib diisi" });
  }
  const dayAgo = new Date(Date.now() - 24 * 60 * 60 * 1000);
  const [order] = await db
    .select({ id: logisticOrdersTable.id, createdAt: logisticOrdersTable.createdAt })
    .from(logisticOrdersTable)
    .where(eq(logisticOrdersTable.orderNumber, orderNumber))
    .limit(1);
  if (!order) return res.status(404).json({ message: "Pesanan tidak ditemukan" });
  if (order.createdAt < dayAgo) return res.status(403).json({ message: "Batas waktu upload bukti telah lewat (24 jam)" });
  await db.execute(sql`UPDATE logistic_orders SET payment_proof_url = ${proofUrl.trim()} WHERE id = ${order.id}`);
  return res.json({ ok: true });
});

// ─── AUTH WALL: all routes below require a valid session ─────────────────────

logisticOrdersRouter.use(async (req, res, next) => {
  if (!(await requireClerkUser(req, res))) return;
  next();
});

// ─── STAFF-ONLY ROUTES ────────────────────────────────────────────────────────

// GET /api/logistic/orders — list orders (admin)
logisticOrdersRouter.get("/", async (req: Request, res: Response) => {
  const parsed = ListLogisticOrdersQueryParams.safeParse(req.query);
  const q = parsed.success ? parsed.data : {};

  // Pagination — default 100 per page, max 500
  const limit = Math.min(Number(req.query["limit"] ?? 100), 500);
  const offset = Math.max(Number(req.query["offset"] ?? 0), 0);

  const rawCompany = req.query["company"] ?? req.query["companyId"];
  const isConsolidated = rawCompany === "0" || rawCompany === "all" || rawCompany === undefined;
  const companyId = isConsolidated ? null : resolveCompanyId(req);

  // companyId=0 or "all" = consolidated view (all companies), otherwise filter by specific company
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const conditions: any[] = [];
  if (companyId !== null && companyId > 0) conditions.push(eq(logisticOrdersTable.companyId, companyId));
  if (q.status) conditions.push(eq(logisticOrdersTable.status, q.status));
  if (q.shipmentType) conditions.push(eq(logisticOrdersTable.shipmentType, q.shipmentType));
  if (q.search) {
    conditions.push(
      or(
        ilike(logisticOrdersTable.customerName, `%${q.search}%`),
        ilike(logisticOrdersTable.companyName, `%${q.search}%`),
        ilike(logisticOrdersTable.orderNumber, `%${q.search}%`)
      )!
    );
  }
  if (q.dateFrom) conditions.push(gte(logisticOrdersTable.createdAt, new Date(q.dateFrom)));
  if (q.dateTo) conditions.push(lte(logisticOrdersTable.createdAt, new Date(q.dateTo)));

  const rows =
    conditions.length > 0
      ? await db
          .select()
          .from(logisticOrdersTable)
          .where(and(...conditions))
          .orderBy(sql`${logisticOrdersTable.createdAt} DESC`)
          .limit(limit)
          .offset(offset)
      : await db
          .select()
          .from(logisticOrdersTable)
          .orderBy(sql`${logisticOrdersTable.createdAt} DESC`)
          .limit(limit)
          .offset(offset);

  // Attach linked sales doc info for each order
  const orderIds = rows.map((r) => r.id);
  const linkedDocMap = new Map<number, { id: number; docNumber: string }>();
  if (orderIds.length > 0) {
    const linkedDocs = await db
      .select({ logisticOrderId: salesDocumentsTable.logisticOrderId, id: salesDocumentsTable.id, docNumber: salesDocumentsTable.docNumber })
      .from(salesDocumentsTable)
      .where(and(isNotNull(salesDocumentsTable.logisticOrderId), inArray(salesDocumentsTable.logisticOrderId, orderIds)));
    for (const d of linkedDocs) {
      if (d.logisticOrderId != null) linkedDocMap.set(d.logisticOrderId, { id: d.id, docNumber: d.docNumber });
    }
  }

  // Attach latest RFQ info (including freight_shipment_id via raw SQL)
  const rfqMap = new Map<number, {
    rfqId: number; rfqNumber: string; rfqStatus: string;
    freightShipmentId: number | null; freightShipmentNumber: string | null;
  }>();
  if (orderIds.length > 0) {
    const rfqRows = await db.execute(sql`
      SELECT DISTINCT ON (r.order_id)
        r.order_id AS "orderId",
        r.id AS "rfqId",
        r.rfq_number AS "rfqNumber",
        r.status AS "rfqStatus",
        r.freight_shipment_id AS "freightShipmentId",
        fs.shipment_number AS "freightShipmentNumber"
      FROM logistic_order_rfqs r
      LEFT JOIN freight_shipments fs ON fs.id = r.freight_shipment_id
      WHERE r.order_id = ANY(${sql.raw(`ARRAY[${orderIds.join(",")}]::int[]`)})
      ORDER BY r.order_id, r.created_at DESC
    `);
    for (const row of (rfqRows.rows ?? rfqRows) as any[]) {
      rfqMap.set(Number(row.orderId), {
        rfqId: Number(row.rfqId),
        rfqNumber: row.rfqNumber as string,
        rfqStatus: row.rfqStatus as string,
        freightShipmentId: row.freightShipmentId ? Number(row.freightShipmentId) : null,
        freightShipmentNumber: (row.freightShipmentNumber as string) ?? null,
      });
    }
  }

  // Attach fulfillment status per order
  const fulfillmentStatusMap = new Map<number, string>();
  if (orderIds.length > 0) {
    const fRows = await db.execute(sql`
      SELECT DISTINCT ON (order_id)
        order_id AS "orderId", status
      FROM order_fulfillment_links
      WHERE order_id = ANY(${sql.raw(`ARRAY[${orderIds.join(",")}]::int[]`)})
      ORDER BY order_id, created_at DESC
    `);
    for (const row of (fRows.rows as { orderId: unknown; status: unknown }[])) {
      fulfillmentStatusMap.set(Number(row.orderId), row.status as string);
    }
  }

  // Attach direct freight shipment (via salesDoc path — created by "Konversi ke Shipment")
  const directShipmentMap = new Map<number, { id: number; shipmentNumber: string }>();
  const salesDocIds = [...linkedDocMap.values()].map((d) => d.id);
  if (salesDocIds.length > 0) {
    const fsRows = await db
      .select({ salesDocId: freightShipmentsTable.salesDocId, id: freightShipmentsTable.id, shipmentNumber: freightShipmentsTable.shipmentNumber })
      .from(freightShipmentsTable)
      .where(inArray(freightShipmentsTable.salesDocId, salesDocIds));
    // Build reverse map: salesDocId → shipment, then resolve logisticOrderId
    const salesDocToShipment = new Map(fsRows.map((r) => [r.salesDocId!, { id: r.id, shipmentNumber: r.shipmentNumber }]));
    for (const [orderId, doc] of linkedDocMap.entries()) {
      const shipment = salesDocToShipment.get(doc.id);
      if (shipment) directShipmentMap.set(orderId, shipment);
    }
  }

  return res.json(rows.map((row) => ({
    ...toOrder(row),
    linkedSalesDocId: linkedDocMap.get(row.id)?.id ?? null,
    linkedSalesDocNumber: linkedDocMap.get(row.id)?.docNumber ?? null,
    latestRfq: rfqMap.get(row.id) ?? null,
    fulfillmentStatus: fulfillmentStatusMap.get(row.id) ?? null,
    directFreightShipmentId: directShipmentMap.get(row.id)?.id ?? null,
    directFreightShipmentNumber: directShipmentMap.get(row.id)?.shipmentNumber ?? null,
  })));
});

// GET /api/logistic/orders/summary — dashboard stats (admin)
logisticOrdersRouter.get("/summary", async (_req: Request, res: Response) => {
  const rows = await db.select().from(logisticOrdersTable);
  const count = (status: string) => rows.filter((r) => r.status === status).length;
  return res.json({
    totalOrders: rows.length,
    newOrders: count("New Order"),
    underReviewOrders: count("Under Review"),
    quotationSentOrders: count("Quotation Sent"),
    confirmedOrders: count("Confirmed"),
    inProgressOrders: count("In Progress"),
    completedOrders: count("Completed"),
    cancelledOrders: count("Cancelled"),
    totalEstimatedRevenue: rows.reduce((acc, r) => acc + parseFloat(r.grandTotal), 0),
  });
});

// GET /api/logistic/orders/dashboard-kpi — widget stats (session auth)
logisticOrdersRouter.get("/dashboard-kpi", async (req: Request, res: Response) => {
  if (!await requireClerkUser(req, res)) return;

  const [phases, today, revenue] = await Promise.all([
    // Count active orders by pipeline phase
    db.execute(sql`
      SELECT
        SUM(CASE WHEN status IN ('Order Received','Admin Review')
          THEN 1 ELSE 0 END)::int AS pre_ops,
        SUM(CASE WHEN status IN ('RFQ Sent','Quote Received','Customer Approval','Vendor Confirmed')
          THEN 1 ELSE 0 END)::int AS quotation,
        SUM(CASE WHEN status IN ('In Progress','Pickup','In Transit','Arrived','Delivered')
          THEN 1 ELSE 0 END)::int AS in_transit,
        SUM(CASE WHEN status IN ('POD Uploaded','Invoice Issued','Payment Received')
          THEN 1 ELSE 0 END)::int AS billing,
        SUM(CASE WHEN status = 'Completed' THEN 1 ELSE 0 END)::int AS completed_all,
        SUM(CASE WHEN status = 'Cancelled' THEN 1 ELSE 0 END)::int AS cancelled_all,
        COUNT(*)::int AS total_all
      FROM logistic_orders
    `),

    // Today activity
    db.execute(sql`
      SELECT
        SUM(CASE WHEN created_at >= CURRENT_DATE THEN 1 ELSE 0 END)::int AS new_today,
        SUM(CASE WHEN status = 'Completed' AND updated_at >= CURRENT_DATE THEN 1 ELSE 0 END)::int AS completed_today,
        SUM(CASE WHEN status NOT IN ('Completed','Cancelled')
          AND updated_at < NOW() - INTERVAL '7 days' THEN 1 ELSE 0 END)::int AS stalled
      FROM logistic_orders
    `),

    // Revenue pipeline (active non-cancelled, non-completed)
    db.execute(sql`
      SELECT
        COALESCE(SUM(grand_total::numeric),0)::float AS active_revenue,
        COALESCE(SUM(CASE WHEN status='Completed' AND updated_at >= DATE_TRUNC('month',NOW())
          THEN grand_total::numeric ELSE 0 END),0)::float AS month_completed_revenue
      FROM logistic_orders
      WHERE status NOT IN ('Cancelled')
    `),
  ]);

  const p = (phases.rows[0] ?? {}) as Record<string,unknown>;
  const t = (today.rows[0] ?? {}) as Record<string,unknown>;
  const r = (revenue.rows[0] ?? {}) as Record<string,unknown>;

  return res.json({
    phases: {
      preOps:    Number(p["pre_ops"]    ?? 0),
      quotation: Number(p["quotation"]  ?? 0),
      inTransit: Number(p["in_transit"] ?? 0),
      billing:   Number(p["billing"]    ?? 0),
    },
    completedAll:         Number(p["completed_all"] ?? 0),
    cancelledAll:         Number(p["cancelled_all"] ?? 0),
    totalAll:             Number(p["total_all"]     ?? 0),
    newToday:             Number(t["new_today"]       ?? 0),
    completedToday:       Number(t["completed_today"] ?? 0),
    stalled:              Number(t["stalled"]          ?? 0),
    activeRevenue:        Number(r["active_revenue"]          ?? 0),
    monthCompletedRevenue:Number(r["month_completed_revenue"] ?? 0),
  });
});

// PUT /api/logistic/orders/trucking-rates — admin only
// Protected by requirePortalAdmin: caller must present a valid Supabase Bearer token
// belonging to an email on the server-side PORTAL_ADMIN_EMAILS allowlist.
// The shared x-admin-password mechanism has been removed entirely.
logisticOrdersRouter.put("/trucking-rates", requirePortalAdmin, async (req: Request, res: Response) => {
  const rates = req.body as Record<string, { ratePerKm: number; loadingFee: number }>;
  if (!rates || typeof rates !== "object") {
    return res.status(400).json({ message: "Format tarif tidak valid" });
  }
  const json = JSON.stringify(rates);
  const existing = await db
    .select()
    .from(portalContentTable)
    .where(eq(portalContentTable.key, TRUCKING_RATES_KEY));
  if (existing.length > 0) {
    await db
      .update(portalContentTable)
      .set({ value: json })
      .where(eq(portalContentTable.key, TRUCKING_RATES_KEY));
  } else {
    await db
      .insert(portalContentTable)
      .values({ key: TRUCKING_RATES_KEY, value: json });
  }
  return res.json({ message: "Tarif berhasil disimpan" });
});

// ─── Delivery Vendors CRUD (for BizPortal) ───────────────────────────────────

// POST /api/logistic/orders/vendors — [C9-FIX] requires admin or owner role
logisticOrdersRouter.post("/vendors", async (req: Request, res: Response) => {
  if (!(await requireRole(req, res, ["admin", "owner"]))) return;
  const { name, logo, eta, fee, note, phone, email, serviceType } = req.body as Record<string, unknown>;
  if (!name || typeof name !== "string" || !name.trim())
    return res.status(400).json({ message: "Nama vendor harus diisi" });
  const [maxRow] = await db.select({ max: sql<number>`COALESCE(MAX(sort_order), 0)` }).from(suppliersTable);
  const nextSort = Number(maxRow?.max ?? 0) + 1;
  const [created] = await db.insert(suppliersTable).values({
    name: String(name).trim(),
    logo: typeof logo === "string" && logo.trim() ? logo.trim() : "📦",
    eta: typeof eta === "string" && eta.trim() ? eta.trim() : "2-3 hari",
    fee: typeof fee === "number" ? String(fee) : "0",
    note: typeof note === "string" && note.trim() ? note.trim() : null,
    phone: typeof phone === "string" && phone.trim() ? phone.trim() : null,
    contactEmail: typeof email === "string" && email.trim() ? email.trim() : null,
    serviceType: typeof serviceType === "string" && serviceType.trim() ? serviceType.trim() : null,
    isActive: true,
    sortOrder: nextSort,
  }).returning();
  return res.status(201).json({ ...created, fee: Number(created.fee ?? 0), email: created.contactEmail });
});

// PUT /api/logistic/orders/vendors/:id — [C9-FIX] requires admin or owner role
logisticOrdersRouter.put("/vendors/:id", async (req: Request, res: Response) => {
  if (!(await requireRole(req, res, ["admin", "owner"]))) return;
  const id = parseInt(String(String(req.params.id)), 10);
  if (isNaN(id)) return res.status(400).json({ message: "ID tidak valid" });
  const { name, logo, eta, fee, note, phone, email, serviceType, isActive, sortOrder } = req.body as Record<string, unknown>;
  const patch: Record<string, unknown> = {};
  if (typeof name === "string" && name.trim()) patch.name = name.trim();
  if (typeof logo === "string") patch.logo = logo.trim() || "📦";
  if (typeof eta === "string" && eta.trim()) patch.eta = eta.trim();
  if (typeof fee === "number") patch.fee = String(fee);
  if (note !== undefined) patch.note = typeof note === "string" && note.trim() ? note.trim() : null;
  if (phone !== undefined) patch.phone = typeof phone === "string" && phone.trim() ? phone.trim() : null;
  if (email !== undefined) patch.contactEmail = typeof email === "string" && email.trim() ? email.trim() : null;
  if (serviceType !== undefined) patch.serviceType = typeof serviceType === "string" && serviceType.trim() ? serviceType.trim() : null;
  if (typeof isActive === "boolean") patch.isActive = isActive;
  if (typeof sortOrder === "number") patch.sortOrder = sortOrder;
  if (Object.keys(patch).length === 0) return res.status(400).json({ message: "Tidak ada data yang diperbarui" });
  const [updated] = await db.update(suppliersTable).set(patch).where(eq(suppliersTable.id, id)).returning();
  if (!updated) return res.status(404).json({ message: "Vendor tidak ditemukan" });
  return res.json({ ...updated, fee: Number(updated.fee ?? 0), email: updated.contactEmail });
});

// DELETE /api/logistic/orders/vendors/:id — [C9-FIX] requires admin or owner role
logisticOrdersRouter.delete("/vendors/:id", async (req: Request, res: Response) => {
  if (!(await requireRole(req, res, ["admin", "owner"]))) return;
  const id = parseInt(String(String(req.params.id)), 10);
  if (isNaN(id)) return res.status(400).json({ message: "ID tidak valid" });
  const [deleted] = await db.delete(suppliersTable).where(eq(suppliersTable.id, id)).returning();
  if (!deleted) return res.status(404).json({ message: "Vendor tidak ditemukan" });
  // Cascade storage cleanup — logo (hanya jika berupa URL, bukan emoji)
  if (deleted.logo && (deleted.logo.startsWith("http") || deleted.logo.startsWith("/api/storage"))) {
    deleteFromSupabase(deleted.logo).catch(() => {});
  }
  return res.json({ success: true });
});

// GET /vendor-fulfillments — daftar semua vendor fulfillment
logisticOrdersRouter.get("/vendor-fulfillments", requireClerkUser, async (req: Request, res: Response) => {
  const { status, vendorId, serviceType, dateFrom, dateTo, search } = req.query as Record<string, string>;

  const conditions: ReturnType<typeof eq>[] = [];
  if (status && status !== "all") conditions.push(eq(logisticVendorFulfillmentsTable.status, status));
  if (vendorId) conditions.push(eq(logisticVendorFulfillmentsTable.vendorId, parseInt(vendorId, 10)));
  if (serviceType && serviceType !== "all") conditions.push(eq(logisticVendorFulfillmentsTable.serviceType, serviceType));
  if (dateFrom) conditions.push(gte(logisticVendorFulfillmentsTable.createdAt, new Date(dateFrom)));
  if (dateTo) {
    const dt = new Date(dateTo);
    dt.setDate(dt.getDate() + 1);
    conditions.push(lte(logisticVendorFulfillmentsTable.createdAt, dt));
  }
  if (search && search.trim()) {
    const pat = `%${search.trim()}%`;
    conditions.push(
      or(
        ilike(logisticOrdersTable.customerName, pat),
        ilike(logisticOrdersTable.companyName, pat),
        ilike(logisticOrdersTable.orderNumber, pat),
        ilike(suppliersTable.name, pat),
      ) as any,
    );
  }

  const rows = await db
    .select({
      id: logisticVendorFulfillmentsTable.id,
      orderId: logisticVendorFulfillmentsTable.orderId,
      orderItemId: logisticVendorFulfillmentsTable.orderItemId,
      vendorId: logisticVendorFulfillmentsTable.vendorId,
      vendorName: suppliersTable.name,
      serviceType: logisticVendorFulfillmentsTable.serviceType,
      status: logisticVendorFulfillmentsTable.status,
      adminNotes: logisticVendorFulfillmentsTable.adminNotes,
      createdAt: logisticVendorFulfillmentsTable.createdAt,
      orderNumber: logisticOrdersTable.orderNumber,
      customerName: logisticOrdersTable.customerName,
      companyName: logisticOrdersTable.companyName,
      subtotal: logisticOrderItemsTable.subtotal,
      itemServiceName: logisticOrderItemsTable.serviceName,
    })
    .from(logisticVendorFulfillmentsTable)
    .leftJoin(logisticOrdersTable, eq(logisticOrdersTable.id, logisticVendorFulfillmentsTable.orderId))
    .leftJoin(suppliersTable, eq(suppliersTable.id, logisticVendorFulfillmentsTable.vendorId))
    .leftJoin(logisticOrderItemsTable, eq(logisticOrderItemsTable.id, logisticVendorFulfillmentsTable.orderItemId))
    .where(conditions.length > 0 ? and(...(conditions as any[])) : undefined)
    .orderBy(desc(logisticVendorFulfillmentsTable.createdAt))
    .limit(300);

  const allStats = await db
    .select({
      status: logisticVendorFulfillmentsTable.status,
      count: sql<number>`count(*)::int`,
    })
    .from(logisticVendorFulfillmentsTable)
    .groupBy(logisticVendorFulfillmentsTable.status);

  const stats: Record<string, number> = { pending: 0, in_progress: 0, completed: 0, cancelled: 0 };
  for (const s of allStats) {
    if (s.status && s.status in stats) stats[s.status] = s.count;
  }

  return res.json({
    data: rows.map((r) => ({
      id: r.id,
      orderId: r.orderId,
      orderItemId: r.orderItemId,
      orderNumber: r.orderNumber ?? "",
      vendorId: r.vendorId,
      vendorName: r.vendorName ?? "—",
      serviceType: r.serviceType ?? "—",
      itemServiceName: r.itemServiceName ?? "—",
      status: r.status,
      adminNotes: r.adminNotes ?? null,
      customerName: r.customerName ?? "",
      companyName: r.companyName ?? "",
      subtotal: r.subtotal ? parseFloat(r.subtotal) : 0,
      createdAt: r.createdAt?.toISOString() ?? "",
    })),
    stats,
  });
});

// GET /api/logistic/orders/:id/progress — timeline events untuk order
logisticOrdersRouter.get("/:id/progress", async (req: Request, res: Response) => {
  const id = parseInt(String(String(req.params.id)), 10);
  if (isNaN(id)) return res.status(400).json({ message: "ID tidak valid" });
  const events = await getOrderProgressEvents(id);
  return res.json({ events });
});

// POST /api/logistic/orders/:id/progress/set — admin set step manual
logisticOrdersRouter.post("/:id/progress/set", requireClerkUser, async (req: Request, res: Response) => {
  const id = parseInt(String(String(req.params.id)), 10);
  if (isNaN(id)) return res.status(400).json({ message: "ID tidak valid" });
  // IDOR guard
  { const [_o] = await db.select({ companyId: logisticOrdersTable.companyId }).from(logisticOrdersTable).where(eq(logisticOrdersTable.id, id)); if (!_o) return res.status(404).json({ message: "Order tidak ditemukan" }); const _cid = resolveCompanyId(req); if (!await assertCompanyAccess(_o.companyId, _cid, req, res, { resourceType: "logistic_order", resourceId: id })) return; }
  const { stepKey, notes } = req.body as { stepKey: string; notes?: string };
  const validKeys = PROGRESS_STEPS.map((s) => s.key);
  if (!validKeys.includes(stepKey as any))
    return res.status(400).json({ message: "Step tidak valid" });
  const user = (req as any).user;
  const actor = user?.name || user?.email || "Admin";
  await updateOrderProgress(id, stepKey as any, "admin", actor, notes ?? `Manual set oleh ${actor}`);
  // Broadcast ke portal — non-blocking lookup orderNumber
  db.select({ orderNumber: logisticOrdersTable.orderNumber })
    .from(logisticOrdersTable).where(eq(logisticOrdersTable.id, id))
    .then(([row]) => {
      if (row?.orderNumber) {
        broadcastToPortal("progress_event_added", {
          orderNumber: row.orderNumber,
          orderId: id,
          stepKey,
          updatedAt: new Date().toISOString(),
        });
      }
    }).catch(() => {});
  return res.json({ ok: true });
});

// PUT /api/logistic/orders/:id/progress/:stepKey/photo — admin set/replace foto untuk step tertentu
logisticOrdersRouter.put("/:id/progress/:stepKey/photo", requireClerkUser, async (req: Request, res: Response) => {
  const id = parseInt(String(String(req.params.id)), 10);
  if (isNaN(id)) return res.status(400).json({ message: "ID tidak valid" });
  // IDOR guard
  { const [_o] = await db.select({ companyId: logisticOrdersTable.companyId }).from(logisticOrdersTable).where(eq(logisticOrdersTable.id, id)); if (!_o) return res.status(404).json({ message: "Order tidak ditemukan" }); const _cid = resolveCompanyId(req); if (!await assertCompanyAccess(_o.companyId, _cid, req, res, { resourceType: "logistic_order", resourceId: id })) return; }
  const { stepKey } = req.params;
  const validKeys = PROGRESS_STEPS.map((s) => s.key);
  if (!validKeys.includes(stepKey as any))
    return res.status(400).json({ message: "Step tidak valid" });
  const { photoUrl } = req.body as { photoUrl?: string };
  if (!photoUrl || typeof photoUrl !== "string" || !photoUrl.startsWith("http"))
    return res.status(400).json({ message: "photoUrl tidak valid (harus URL http/https)" });

  try {
    const result = await db.execute(sql`
      UPDATE order_progress_events
        SET photo_url = ${photoUrl}
      WHERE order_id = ${id} AND step_key = ${stepKey}
      RETURNING id, step_key, photo_url
    `);
    if ((result.rows ?? []).length === 0)
      return res.status(404).json({ message: "Progress event tidak ditemukan untuk order + step ini" });
    return res.json({ ok: true, updated: (result.rows as any[])[0] });
  } catch (err) {
    console.error("admin set progress photo failed", { err, id, stepKey });
    return res.status(500).json({ message: "Gagal update foto" });
  }
});

// DELETE /api/logistic/orders/:id/progress/:stepKey — admin undo step
logisticOrdersRouter.delete("/:id/progress/:stepKey", requireClerkUser, async (req: Request, res: Response) => {
  const id = parseInt(String(String(req.params.id)), 10);
  if (isNaN(id)) return res.status(400).json({ message: "ID tidak valid" });
  // IDOR guard
  { const [_o] = await db.select({ companyId: logisticOrdersTable.companyId }).from(logisticOrdersTable).where(eq(logisticOrdersTable.id, id)); if (!_o) return res.status(404).json({ message: "Order tidak ditemukan" }); const _cid = resolveCompanyId(req); if (!await assertCompanyAccess(_o.companyId, _cid, req, res, { resourceType: "logistic_order", resourceId: id })) return; }
  const { stepKey } = req.params;
  const validKeys = PROGRESS_STEPS.map((s) => s.key);
  if (!validKeys.includes(stepKey as any))
    return res.status(400).json({ message: "Step tidak valid" });
  await deleteOrderProgress(id, stepKey as any);
  return res.json({ ok: true });
});

// GET /api/logistic/orders/:id — get order detail (admin)
logisticOrdersRouter.get("/:id", async (req: Request, res: Response) => {
  const parsed = GetLogisticOrderParams.safeParse({
    id: parseInt(String(String(req.params.id)), 10),
  });
  if (!parsed.success || isNaN(parsed.data.id))
    return res.status(400).json({ message: "ID tidak valid" });
  const { id } = parsed.data;

  const [order] = await db
    .select()
    .from(logisticOrdersTable)
    .where(eq(logisticOrdersTable.id, id));

  if (!order) return res.status(404).json({ message: "Order tidak ditemukan" });

  // IDOR guard
  { const _cid = resolveCompanyId(req); if (!await assertCompanyAccess(order.companyId, _cid, req, res, { resourceType: "logistic_order", resourceId: id })) return; }

  const [items, linkedDocRows] = await Promise.all([
    db.select({
      id: logisticOrderItemsTable.id,
      orderId: logisticOrderItemsTable.orderId,
      category: logisticOrderItemsTable.category,
      serviceName: logisticOrderItemsTable.serviceName,
      calculatorType: logisticOrderItemsTable.calculatorType,
      inputData: logisticOrderItemsTable.inputData,
      calculationResult: logisticOrderItemsTable.calculationResult,
      subtotal: logisticOrderItemsTable.subtotal,
      itemSource: logisticOrderItemsTable.itemSource,
      vendorCatalogItemId: logisticOrderItemsTable.vendorCatalogItemId,
      vendorId: logisticOrderItemsTable.vendorId,
      serviceType: logisticOrderItemsTable.serviceType,
      priceSnapshot: logisticOrderItemsTable.priceSnapshot,
      calculationInput: logisticOrderItemsTable.calculationInput,
      templateSnapshot: logisticOrderItemsTable.templateSnapshot,
      createdAt: logisticOrderItemsTable.createdAt,
      vendorFulfillmentId: logisticVendorFulfillmentsTable.id,
      vendorFulfillmentStatus: logisticVendorFulfillmentsTable.status,
      vendorFulfillmentCreatedAt: logisticVendorFulfillmentsTable.createdAt,
    })
      .from(logisticOrderItemsTable)
      .leftJoin(logisticVendorFulfillmentsTable, eq(logisticVendorFulfillmentsTable.orderItemId, logisticOrderItemsTable.id))
      .where(eq(logisticOrderItemsTable.orderId, id)),
    db.select({ id: salesDocumentsTable.id, docNumber: salesDocumentsTable.docNumber })
      .from(salesDocumentsTable)
      .where(eq(salesDocumentsTable.logisticOrderId, id))
      .limit(1),
  ]);

  let approvedVendorName: string | null = null;
  if (order.approvedVendorId) {
    const [v] = await db.select().from(suppliersTable).where(eq(suppliersTable.id, order.approvedVendorId));
    approvedVendorName = v?.name ?? null;
  }

  const linkedDoc = linkedDocRows[0] ?? null;
  return res.json({
    ...toOrder(order, approvedVendorName),
    items: items.map(toItem),
    linkedSalesDocId: linkedDoc?.id ?? null,
    linkedSalesDocNumber: linkedDoc?.docNumber ?? null,
  });
});

// POST /api/logistic/orders/:id/resend-wa-group — resend order_new notif ke Admin Group
logisticOrdersRouter.post("/:id/resend-wa-group", async (req: Request, res: Response) => {
  if (!(await requireClerkUser(req, res))) return;
  const id = parseInt(String(req.params["id"] ?? ""));
  if (isNaN(id)) return res.status(400).json({ message: "ID tidak valid" });

  const [order] = await db.select().from(logisticOrdersTable).where(eq(logisticOrdersTable.id, id));
  if (!order) return res.status(404).json({ message: "Order tidak ditemukan" });
  // IDOR guard
  { const _cid = resolveCompanyId(req); if (!await assertCompanyAccess(order.companyId, _cid, req, res, { resourceType: "logistic_order", resourceId: id })) return; }

  const items = await db.select().from(logisticOrderItemsTable).where(eq(logisticOrderItemsTable.orderId, id));

  const orderType = (order as any).orderType ?? "shipment";
  const isProduct = orderType === "product";

  const serviceList = !isProduct
    ? items.map(i => `• ${i.serviceName}`).join("\n")
    : "";

  const orderItems = items.map(i => ({
    name: i.serviceName,
    qty: null as number | null,
    subtotal: i.subtotal != null ? parseFloat(String(i.subtotal)) : null,
  }));

  const vehicleType =
    (items.find(i => i.calculatorType === "trucking")?.inputData as Record<string, unknown> | undefined)
      ?.vehicleType as string ?? null;

  sendLogisticOrderNotification({
    id: order.id,
    orderNumber: order.orderNumber,
    customerName: order.customerName,
    companyName: order.companyName,
    email: order.email,
    phone: order.phone,
    orderType,
    shipmentType: order.shipmentType ?? "",
    origin: order.origin ?? "",
    destination: order.destination ?? "",
    commodity: order.commodity ?? null,
    cargoDescription: order.cargoDescription ?? null,
    grossWeight: !isProduct && order.grossWeight ? parseFloat(String(order.grossWeight)) : null,
    volumeCbm: !isProduct && order.volumeCbm ? parseFloat(String(order.volumeCbm)) : null,
    jumlahKoli: !isProduct && order.jumlahKoli ? order.jumlahKoli : null,
    subtotal: order.subtotal != null ? parseFloat(String(order.subtotal)) : null,
    tax: order.tax != null ? parseFloat(String(order.tax)) : null,
    grandTotal: parseFloat(String(order.grandTotal)),
    serviceList,
    orderItems,
    requiredDate: order.requiredDate ?? null,
    notes: order.notes ?? null,
    jamOrder: order.jamOrder ?? null,
    vehicleType,
    createdAt: order.createdAt,
    publicRfqToken: order.publicRfqToken ?? null,
  }).catch((err: unknown) => req.log.error({ err }, "resend-wa-group failed"));

  return res.json({ ok: true, message: "Notifikasi WA dikirim ke Admin Group" });
});

// ─── Vendor WA notification on status change ──────────────────────────────────
// Use canonical status set from constants
const VENDOR_STATUS_LABELS: Record<string, string> = {
  "Vendor Confirmed": "Vendor Dikonfirmasi ✅",
  "In Progress":      "Sedang Diproses 🔄",
  "Pickup":           "Proses Penjemputan 🚚",
  "In Transit":       "Dalam Perjalanan 🛣️",
  "Arrived":          "Tiba di Tujuan 📍",
  "Delivered":        "Terkirim ✅",
  "Completed":        "Selesai 🎉",
  "Cancelled":        "Dibatalkan ❌",
  // backward compat
  "Confirmed":        "Dikonfirmasi ✅",
};

async function notifyVendorStatusChange(
  order: { orderNumber: string; customerName: string | null; origin: string | null; destination: string | null; approvedVendorId: number | null },
  status: string,
) {
  if (!VENDOR_NOTIFY_STATUS_SET.has(status)) return;
  if (!order.approvedVendorId) return;

  try {
    const [vendor] = await db
      .select({ name: suppliersTable.name, phone: suppliersTable.phone })
      .from(suppliersTable)
      .where(eq(suppliersTable.id, order.approvedVendorId));

    if (!vendor?.phone) return;

    const { normalizePhone } = await import("../lib/phoneUtils.js");
    const phone = normalizePhone(vendor.phone);
    if (!phone) return;


    const label = VENDOR_STATUS_LABELS[status] ?? STATUS_LABEL_ID[status] ?? status;
    const note  = VENDOR_WA_NOTES[status] ?? "";
    const route = order.origin && order.destination
      ? `${order.origin} → ${order.destination}`
      : "—";

    const msg =
      `🔔 *Update Status Order — B2B Marketplace and Logistic*\n` +
      `━━━━━━━━━━━━━━━━━━\n` +
      `No. Order  : \`${order.orderNumber}\`\n` +
      `Customer   : ${order.customerName ?? "—"}\n` +
      `Rute       : ${route}\n` +
      `Vendor     : *${vendor.name ?? "—"}*\n` +
      `Status     : *${label}*\n` +
      `━━━━━━━━━━━━━━━━━━\n` +
      `${note}\n\n` +
      `_B2B Marketplace and Logistic — Notifikasi Otomatis_`;

    sendWhatsApp(phone, msg, {
      context: "vendor_status_change",
      refType: "order",
      refId: order.orderNumber,
    }).catch(() => undefined);

    sendVendorOrderStatusChangeNotification(order, label, note, vendor.name ?? "—", phone);
    const notifLabel = VENDOR_STATUS_LABELS[status] ?? status;
    const notifNote  = VENDOR_WA_NOTES[status as keyof typeof VENDOR_WA_NOTES] ?? "";
    sendVendorOrderStatusChangeNotification(order, notifLabel, notifNote, vendor.name ?? "—", phone);

  } catch {
    // fire-and-forget, never block the response
  }
}

// PUT /api/logistic/orders/:id/status — update status (admin)
logisticOrdersRouter.put("/:id/status", async (req: Request, res: Response) => {
  if (!(await requireClerkUser(req, res))) return;
  const paramsParsed = UpdateLogisticOrderStatusParams.safeParse({
    id: parseInt(String(String(req.params.id)), 10),
  });
  const bodyParsed = UpdateLogisticOrderStatusBody.safeParse(req.body);

  if (!paramsParsed.success || isNaN(paramsParsed.data.id))
    return res.status(400).json({ message: "ID tidak valid" });
  if (!bodyParsed.success)
    return res.status(400).json({ message: "Status tidak valid" });

  const { id } = paramsParsed.data;
  const { status } = bodyParsed.data;
  // IDOR guard — verify order ownership before optimistic lock checks
  { const [_o] = await db.select({ companyId: logisticOrdersTable.companyId }).from(logisticOrdersTable).where(eq(logisticOrdersTable.id, id)); if (!_o) return res.status(404).json({ message: "Order tidak ditemukan" }); const _cid = resolveCompanyId(req); if (!await assertCompanyAccess(_o.companyId, _cid, req, res, { resourceType: "logistic_order", resourceId: id })) return; }
  const clientVersion: number | undefined =
    typeof req.body.version === "number" ? req.body.version : undefined;
  const clientUpdatedAt = typeof (req.body as Record<string, unknown>).clientUpdatedAt === "string"
    ? new Date((req.body as Record<string, unknown>).clientUpdatedAt as string)
    : null;

  // Optimistic locking enforcement: setidaknya salah satu harus dikirim agar
  // concurrent-edit conflict dapat terdeteksi. Tolak jika tidak ada keduanya.
  if (clientVersion === undefined && clientUpdatedAt === null) {
    return res.status(400).json({
      message: "Permintaan tidak valid: sertakan 'version' atau 'clientUpdatedAt' untuk mencegah konflik perubahan bersamaan.",
      code: "OPTIMISTIC_LOCK_REQUIRED",
    });
  }

  if (clientUpdatedAt) {
    const [current] = await db
      .select({ updatedAt: logisticOrdersTable.updatedAt })
      .from(logisticOrdersTable)
      .where(eq(logisticOrdersTable.id, id));
    if (!current) return res.status(404).json({ message: "Order tidak ditemukan" });
    const dbMs = new Date(current.updatedAt).getTime();
    const clientMs = clientUpdatedAt.getTime();
    if (Math.abs(dbMs - clientMs) > 1000) {
      return res.status(409).json({
        message: "Order telah diubah oleh pengguna lain. Muat ulang halaman untuk mendapatkan data terbaru.",
        conflict: true,
        serverUpdatedAt: current.updatedAt,
      });
    }
  }

  const adminName = (req.user as { name?: string } | undefined)?.name ?? "Admin";
  const adminId   = (req.user as { id?: string } | undefined)?.id ?? null;

  if (clientVersion !== undefined) {
    const [currentRow] = await db
      .select({ version: logisticOrdersTable.version })
      .from(logisticOrdersTable)
      .where(eq(logisticOrdersTable.id, id));
    if (!currentRow) return res.status(404).json({ message: "Order tidak ditemukan" });
    if (currentRow.version !== clientVersion) {
      return res.status(409).json({ message: "Data sudah diubah oleh pengguna lain. Refresh halaman dan coba lagi." });
    }
  }

  const svcResult = await transitionLogisticOrderStatus(id, status, {
    actorType: "admin",
    actorId: adminId,
    actorName: adminName,
    notes: (req.body as Record<string, unknown>).notes as string ?? undefined,
    source: "PUT /logistic/orders/:id/status",
    skipAudit: true,
  });

  if (!svcResult.ok) {
    if (svcResult.allowedTransitions !== undefined) {
      return res.status(422).json({
        message: svcResult.error,
        allowedTransitions: svcResult.allowedTransitions,
        code: "INVALID_TRANSITION",
      });
    }
    if (svcResult.error?.includes("tidak ditemukan")) return res.status(404).json({ message: svcResult.error });
    return res.status(409).json({ message: svcResult.error ?? "Update status gagal" });
  }

  const [updated] = await db.select().from(logisticOrdersTable).where(eq(logisticOrdersTable.id, id));
  if (!updated) return res.status(404).json({ message: "Order tidak ditemukan" });

  logActivity({
    orderId: updated.id,
    actorType: "admin",
    actorName: adminName,
    actorId: adminId,
    action: "status_changed",
    description: `Status order ${updated.orderNumber} diubah menjadi "${status}"`,
    newValue: { status },
    ipAddress: req.ip ?? null,
  }).catch(() => {});

  if (status === "Completed" || status === "Delivered") {
    const logTax = Number(updated.tax ?? 0);
    const logBase = Number(updated.grandTotal ?? 0) - logTax;
    const companyId = normalizeCompanyId(updated.companyId);
    if (logBase > 0 && companyId != null) {
      import("../lib/taxAutoService.js").then(({ recordTransactionTax }) => {
        void recordTransactionTax({
          companyId,
          transactionType: "logistic_order",
          transactionId: updated.id,
          transactionRef: updated.orderNumber,
          baseAmount: logBase,
          taxAmount: logTax > 0 ? logTax : undefined,
        });
      }).catch(() => {});
    }
  }

  // Audit trail: catat di order_status_history + order_audit_logs
  logOrderStatusChange({
    orderId: updated.id,
    orderNumber: updated.orderNumber,
    oldStatus: (req.body as Record<string, unknown>).oldStatus as string | null ?? null,
    newStatus: status,
    changedByType: "admin",
    changedById: adminId,
    changedByName: adminName,
    changedByIp: req.ip ?? null,
    notes: (req.body as Record<string, unknown>).notes as string | null ?? null,
    source: "PUT /logistic/orders/:id/status",
  }).catch(() => {});
  logOrderAudit({
    orderId: updated.id,
    orderNumber: updated.orderNumber,
    actorType: "admin",
    actorId: adminId,
    actorName: adminName,
    action: "status_changed",
    description: `Status order ${updated.orderNumber} diubah menjadi "${status}"`,
    newValue: { status },
    ipAddress: req.ip ?? null,
  }).catch(() => {});

  // Persistent timeline entry — visible to customer tracking
  db.insert(orderUpdatesTable).values({
    orderId: updated.id,
    actorType: "admin",
    actorId: adminId,
    actorName: adminName,
    status,
    notes: `Status diubah menjadi "${status}"`,
    isPublic: true,
  }).catch(() => {});


  // Notify customer via WhatsApp (fire-and-forget) — use canonical messages with tracking link
  if (updated.phone) {
    // Fetch tracking token untuk link direct tracking di WA
    const trackingResult = await db.execute(sql`SELECT tracking_token FROM logistic_orders WHERE id = ${updated.id} LIMIT 1`).catch(() => null);
    const trackingToken = (trackingResult?.rows?.[0] as any)?.tracking_token ?? null;
    const domain = getPreferredDomain();
    const trackUrl = (domain && trackingToken)
      ? `https://${domain}/order-track/${trackingToken}`
      : domain ? `https://${domain}/track/${updated.orderNumber}` : null;

    const waBuilder = CUSTOMER_WA_MESSAGES[status];
    const msg = waBuilder
      ? waBuilder(updated.orderNumber, trackUrl ?? undefined)
      : `📦 *Update Status Order Anda*\nNo Order: ${updated.orderNumber}\nStatus: *${STATUS_LABEL_ID[status] ?? status}*\n\nTerima kasih telah menggunakan layanan kami.` +
        (trackUrl ? `\n\n🔗 Pantau status:\n${trackUrl}` : "");
    sendWhatsApp(updated.phone, msg, {
      context: "order_status_change",
      refType: "order",
      refId: updated.orderNumber,
    }).catch(() => undefined);
  }

  // Progress bar event — record for all canonical statuses (generic, covers all status keys)
  updateOrderProgress(
    updated.id,
    status.toUpperCase().replace(/ /g, "_"),
    "admin",
    adminName,
    `Status diubah ke ${STATUS_LABEL_ID[status] ?? status}`,
  ).catch(() => {});

  // Notify vendor via WhatsApp (fire-and-forget)
  notifyVendorStatusChange(updated, status).catch(() => undefined);

  // Web Push ke subscriber halaman tracking (fire-and-forget)
  sendPushToOrder(updated.orderNumber, {
    title: "Update Status Order",
    body: `Order ${updated.orderNumber}: ${STATUS_LABEL_ID[status] ?? status}`,
    url: `/track/${updated.orderNumber}`,
    tag: `order-${updated.orderNumber}`,
  } as { title: string; body: string; url?: string }).catch(() => undefined);

  saveAndBroadcast("logistic_order_status_changed", {
    type: "logistic_status",
    orderId: updated.id,
    orderNumber: updated.orderNumber,
    customerName: updated.customerName,
    companyName: updated.companyName ?? null,
    status: updated.status,
    updatedAt: new Date().toISOString(),
  }).catch(() => {});

  // Broadcast ke Customer Portal agar orders page auto-refresh
  broadcastToPortal("logistic_order_status_changed", {
    orderId: updated.id,
    orderNumber: updated.orderNumber,
    status: updated.status,
    updatedAt: new Date().toISOString(),
  });

  return res.json(toOrder(updated));
});

// GET /api/logistic/orders/:id/valid-transitions — daftar transisi status yang diizinkan
logisticOrdersRouter.get("/:id/valid-transitions", async (req: Request, res: Response) => {
  if (!(await requireClerkUser(req, res))) return;
  const id = parseInt(String(req.params["id"] ?? ""), 10);
  if (isNaN(id)) return res.status(400).json({ message: "ID tidak valid" });
  const [order] = await db.select({ id: logisticOrdersTable.id, status: logisticOrdersTable.status, companyId: logisticOrdersTable.companyId })
    .from(logisticOrdersTable)
    .where(eq(logisticOrdersTable.id, id));
  if (!order) return res.status(404).json({ message: "Order tidak ditemukan" });
  // IDOR guard
  { const _cid = resolveCompanyId(req); if (!await assertCompanyAccess(order.companyId, _cid, req, res, { resourceType: "logistic_order", resourceId: id })) return; }
  const allowedTransitions = getAllowedTransitions(order.status);
  return res.json({ status: order.status, allowedTransitions });
});

// PATCH /api/logistic/orders/:id/details — update detail order (admin)
logisticOrdersRouter.patch("/:id/details", async (req: Request, res: Response) => {
  if (!(await requireClerkUser(req, res))) return;
  const id = parseInt(String(req.params["id"] ?? ""), 10);
  if (isNaN(id)) return res.status(400).json({ message: "ID tidak valid" });
  // IDOR guard
  { const [_o] = await db.select({ companyId: logisticOrdersTable.companyId }).from(logisticOrdersTable).where(eq(logisticOrdersTable.id, id)); if (!_o) return res.status(404).json({ message: "Order tidak ditemukan" }); const _cid = resolveCompanyId(req); if (!await assertCompanyAccess(_o.companyId, _cid, req, res, { resourceType: "logistic_order", resourceId: id })) return; }

  const parsed = z.object({
    shipmentType:    z.string().optional(),
    origin:          z.string().optional(),
    destination:     z.string().optional(),
    commodity:       z.string().optional(),
    cargoDescription: z.string().optional(),
    grossWeight:     z.string().optional(),
    volumeCbm:       z.string().optional(),
    jumlahKoli:      z.number().int().nonnegative().optional(),
    requiredDate:    z.string().optional(),
    notes:           z.string().optional(),
  }).safeParse(req.body);

  if (!parsed.success) return res.status(400).json({ message: "Data tidak valid" });

  const patch: Record<string, unknown> = {};
  const d = parsed.data;
  if (d.shipmentType    !== undefined) patch["shipmentType"]    = d.shipmentType.trim() || null;
  if (d.origin          !== undefined) patch["origin"]          = d.origin.trim() || null;
  if (d.destination     !== undefined) patch["destination"]     = d.destination.trim() || null;
  if (d.commodity       !== undefined) patch["commodity"]       = d.commodity.trim() || null;
  if (d.cargoDescription !== undefined) patch["cargoDescription"] = d.cargoDescription.trim() || null;
  if (d.grossWeight     !== undefined) patch["grossWeight"]     = d.grossWeight.trim() || null;
  if (d.volumeCbm       !== undefined) patch["volumeCbm"]       = d.volumeCbm.trim() || null;
  if (d.jumlahKoli      !== undefined) patch["jumlahKoli"]      = d.jumlahKoli;
  if (d.requiredDate    !== undefined) patch["requiredDate"]    = d.requiredDate.trim() || null;
  if (d.notes           !== undefined) patch["notes"]           = d.notes.trim() || null;

  if (Object.keys(patch).length === 0)
    return res.status(400).json({ message: "Tidak ada field yang diupdate" });

  const detailsClientVersion: number | undefined =
    typeof req.body.version === "number" ? req.body.version : undefined;
  const detailsWhereClause =
    detailsClientVersion !== undefined
      ? and(eq(logisticOrdersTable.id, id), eq(logisticOrdersTable.version, detailsClientVersion))
      : eq(logisticOrdersTable.id, id);

  const [updated] = await db
    .update(logisticOrdersTable)
    .set({ ...patch, version: sql`${logisticOrdersTable.version} + 1` } as any)
    .where(detailsWhereClause)
    .returning();

  if (!updated) {
    const [exists] = await db.select({ id: logisticOrdersTable.id }).from(logisticOrdersTable).where(eq(logisticOrdersTable.id, id));
    if (!exists) return res.status(404).json({ message: "Order tidak ditemukan" });
    return res.status(409).json({ message: "Data sudah diubah oleh pengguna lain. Refresh halaman dan coba lagi." });
  }

  logActivity({
    orderId: updated.id,
    actorType: "admin",
    actorName: (req.user as { name?: string } | undefined)?.name ?? "Admin",
    actorId: (req.user as { id?: string } | undefined)?.id ?? null,
    action: "details_updated",
    description: `Detail order ${updated.orderNumber} diperbarui`,
    newValue: patch,
    ipAddress: req.ip ?? null,
  }).catch(() => {});

  return res.json(toOrder(updated));
});

// PATCH /api/logistic/orders/:id/type — update shipment type (admin)
logisticOrdersRouter.patch("/:id/type", async (req: Request, res: Response) => {
  if (!(await requireClerkUser(req, res))) return;
  const id = parseInt(String(req.params["id"] ?? ""), 10);
  if (isNaN(id)) return res.status(400).json({ message: "ID tidak valid" });
  // IDOR guard
  { const [_o] = await db.select({ companyId: logisticOrdersTable.companyId }).from(logisticOrdersTable).where(eq(logisticOrdersTable.id, id)); if (!_o) return res.status(404).json({ message: "Order tidak ditemukan" }); const _cid = resolveCompanyId(req); if (!await assertCompanyAccess(_o.companyId, _cid, req, res, { resourceType: "logistic_order", resourceId: id })) return; }
  const { shipmentType, version: typeVersion } = req.body as { shipmentType?: unknown; version?: unknown };
  if (!shipmentType || typeof shipmentType !== "string" || shipmentType.trim() === "")
    return res.status(400).json({ message: "shipmentType wajib diisi" });

  const typeClientVersion: number | undefined = typeof typeVersion === "number" ? typeVersion : undefined;
  const typeWhereClause =
    typeClientVersion !== undefined
      ? and(eq(logisticOrdersTable.id, id), eq(logisticOrdersTable.version, typeClientVersion))
      : eq(logisticOrdersTable.id, id);

  const [updated] = await db
    .update(logisticOrdersTable)
    .set({ shipmentType: shipmentType.trim(), version: sql`${logisticOrdersTable.version} + 1` } as any)
    .where(typeWhereClause)
    .returning();

  if (!updated) {
    const [exists] = await db.select({ id: logisticOrdersTable.id }).from(logisticOrdersTable).where(eq(logisticOrdersTable.id, id));
    if (!exists) return res.status(404).json({ message: "Order tidak ditemukan" });
    return res.status(409).json({ message: "Data sudah diubah oleh pengguna lain. Refresh halaman dan coba lagi." });
  }

  logActivity({
    orderId: updated.id,
    actorType: "admin",
    actorName: (req.user as { name?: string } | undefined)?.name ?? "Admin",
    actorId: (req.user as { id?: string } | undefined)?.id ?? null,
    action: "shipment_type_changed",
    description: `Jenis pengiriman order ${updated.orderNumber} diubah menjadi "${shipmentType.trim()}"`,
    newValue: { shipmentType: shipmentType.trim() },
    ipAddress: req.ip ?? null,
  }).catch(() => {});

  return res.json(toOrder(updated));
});

// PUT /api/logistic/orders/bulk-status — ubah status banyak order sekaligus
logisticOrdersRouter.put("/bulk-status", async (req: Request, res: Response) => {
  if (!(await requireClerkUser(req, res))) return;
  const parsed = z.object({
    ids: z.array(z.number().int().positive()).min(1),
    status: z.enum([
      "Order Received", "Admin Review", "RFQ Sent", "Quote Received",
      "Customer Approval", "Vendor Confirmed", "In Progress", "Pickup",
      "In Transit", "Arrived", "Delivered", "POD Uploaded",
      "Invoice Issued", "Payment Received", "Completed", "Cancelled",
      // backward compat
      "New Order", "Confirmed",
    ]),
  }).safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ message: "ids dan status harus valid" });
  const { ids, status } = parsed.data;
  const adminName = (req.user as { name?: string } | undefined)?.name ?? "Admin";
  const adminId   = (req.user as { id?: string } | undefined)?.id ?? null;

  // ── Ownership: verify ALL order IDs belong to resolvedCompanyId ──────────
  const resolvedCid = resolveCompanyId(req);
  const ownedOrders = await db
    .select({ id: logisticOrdersTable.id, companyId: logisticOrdersTable.companyId })
    .from(logisticOrdersTable)
    .where(inArray(logisticOrdersTable.id, ids));
  const missingIds = ids.filter(id => !ownedOrders.find(o => o.id === id));
  if (missingIds.length > 0)
    return res.status(404).json({ message: `Order tidak ditemukan: ${missingIds.join(", ")}` });
  const isSuperAdmin = (req.user as any)?.role === "super_admin";
  const unauthorizedOrders = isSuperAdmin ? [] : ownedOrders.filter(
    o => o.companyId !== null && o.companyId !== resolvedCid
  );
  if (unauthorizedOrders.length > 0) {
    const meta = extractRequestMeta(req);
    writeAuditLog({
      ...meta, companyId: resolvedCid, action: "BULK_STATUS_CHANGE_DENIED", module: "logistics",
      newData: { unauthorizedIds: unauthorizedOrders.map(o => o.id), targetStatus: status },
    });
    return res.status(403).json({
      message: "Akses ditolak: beberapa order bukan milik perusahaan ini",
      unauthorizedIds: unauthorizedOrders.map(o => o.id),
    });
  }

  // Write verified audit before mutation
  const meta = extractRequestMeta(req);
  writeAuditLog({
    ...meta, companyId: resolvedCid, action: "BULK_OPERATION_VERIFIED", module: "logistics",
    newData: {
      operationType: "bulk-status", recordCount: ids.length,
      targetStatus: status, timestamp: new Date().toISOString(),
    },
  });

  const updatedIds: number[] = [];
  const failedIds: number[] = [];

  for (const oid of ids) {
    const result = await transitionLogisticOrderStatus(oid, status, {
      actorType: "admin",
      actorId: adminId,
      actorName: adminName,
      source: "PUT /logistic/orders/bulk-status",
      force: true,
      skipAudit: false,
    });
    if (result.ok) updatedIds.push(oid);
    else failedIds.push(oid);
  }

  // Log activity + timeline for each succeeded order (fire-and-forget)
  for (const oid of updatedIds) {
    logActivity({
      orderId: oid,
      actorType: "admin",
      actorName: adminName,
      actorId: adminId,
      action: "bulk_status_changed",
      description: `Bulk status change → "${status}"`,
      newValue: { status },
      ipAddress: req.ip ?? null,
    }).catch(() => {});
    db.insert(orderUpdatesTable).values({
      orderId: oid,
      actorType: "admin",
      actorId: adminId,
      actorName: adminName,
      status,
      notes: `Status diubah (bulk) menjadi "${status}"`,
      isPublic: false,
    }).catch(() => {});
  }

  return res.json({ message: "Updated", updatedIds, failedIds, count: updatedIds.length });
});

// Helper: hapus file storage terkait logistic order (driver photos + vendor unit photos)
async function cleanupLogisticOrderStorage(orderIds: number[]): Promise<void> {
  if (orderIds.length === 0) return;
  try {
    // 1. Cari driver jobs terkait order, lalu hapus foto-foto driver
    const jobs = await db
      .select({ id: driverJobsTable.id })
      .from(driverJobsTable)
      .where(inArray(driverJobsTable.logisticOrderId, orderIds));
    if (jobs.length > 0) {
      const jobIds = jobs.map((j) => j.id);
      const photos = await db
        .select({ url: driverPhotosTable.url })
        .from(driverPhotosTable)
        .where(inArray(driverPhotosTable.driverJobId, jobIds));
      for (const p of photos) deleteFromSupabase(p.url).catch(() => {});
    }
    // 2. Hapus unit photo dari vendor response
    const responses = await db
      .select({ unitPhotoUrl: vendorResponsesTable.unitPhotoUrl })
      .from(vendorResponsesTable)
      .where(inArray(vendorResponsesTable.orderId, orderIds));
    for (const r of responses) {
      if (r.unitPhotoUrl) deleteFromSupabase(r.unitPhotoUrl).catch(() => {});
    }
    // 3. Hapus POD OCR images (orderId jadi null setelah delete, jadi fetch sekarang)
    const podOcrRows = await db
      .select({ imageUrl: podOcrResultsTable.imageUrl })
      .from(podOcrResultsTable)
      .where(inArray(podOcrResultsTable.orderId, orderIds));
    for (const p of podOcrRows) {
      if (p.imageUrl) deleteFromSupabase(p.imageUrl).catch(() => {});
    }
    // 4. Hapus RFQ vendor link attachments (cascade delete: order → rfqs → rfq_vendor_links)
    const rfqs = await db
      .select({ id: logisticOrderRfqsTable.id })
      .from(logisticOrderRfqsTable)
      .where(inArray(logisticOrderRfqsTable.orderId, orderIds));
    if (rfqs.length > 0) {
      const rfqIds = rfqs.map((r) => r.id);
      const vendorLinks = await db
        .select({ attachmentUrl: rfqVendorLinksTable.attachmentUrl })
        .from(rfqVendorLinksTable)
        .where(inArray(rfqVendorLinksTable.rfqId, rfqIds));
      for (const vl of vendorLinks) {
        if (vl.attachmentUrl) deleteFromSupabase(vl.attachmentUrl).catch(() => {});
      }
    }
  } catch { /* non-fatal */ }
}

// DELETE /api/logistic/orders/bulk — hapus banyak order sekaligus
logisticOrdersRouter.delete("/bulk", async (req: Request, res: Response) => {
  if (!(await requireClerkUser(req, res))) return;
  const parsed = z.object({ ids: z.array(z.number().int().positive()).min(1) }).safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ message: "ids harus array angka yang valid" });
  const { ids } = parsed.data;

  // ── Ownership: verify ALL order IDs belong to resolvedCompanyId ──────────
  const resolvedCid = resolveCompanyId(req);
  const ownedOrders = await db
    .select({ id: logisticOrdersTable.id, companyId: logisticOrdersTable.companyId })
    .from(logisticOrdersTable)
    .where(inArray(logisticOrdersTable.id, ids));
  const missingIds = ids.filter(id => !ownedOrders.find(o => o.id === id));
  if (missingIds.length > 0)
    return res.status(404).json({ message: `Order tidak ditemukan: ${missingIds.join(", ")}` });
  const isSuperAdmin = (req.user as any)?.role === "super_admin";
  const unauthorizedOrders = isSuperAdmin ? [] : ownedOrders.filter(
    o => o.companyId !== null && o.companyId !== resolvedCid
  );
  if (unauthorizedOrders.length > 0) {
    const meta = extractRequestMeta(req);
    writeAuditLog({
      ...meta, companyId: resolvedCid, action: "BULK_DELETE_DENIED", module: "logistics",
      newData: { unauthorizedIds: unauthorizedOrders.map(o => o.id) },
    });
    return res.status(403).json({
      message: "Akses ditolak: beberapa order bukan milik perusahaan ini",
      unauthorizedIds: unauthorizedOrders.map(o => o.id),
    });
  }

  // Write verified audit before mutation
  const delMeta = extractRequestMeta(req);
  writeAuditLog({
    ...delMeta, companyId: resolvedCid, action: "BULK_OPERATION_VERIFIED", module: "logistics",
    newData: { operationType: "bulk-delete", recordCount: ids.length, timestamp: new Date().toISOString() },
  });

  // Cleanup storage dulu sebelum delete DB
  await cleanupLogisticOrderStorage(ids);
  const deleted = await db
    .delete(logisticOrdersTable)
    .where(inArray(logisticOrdersTable.id, ids))
    .returning({ id: logisticOrdersTable.id });
  return res.json({ message: "Deleted", deletedIds: deleted.map((r) => r.id), count: deleted.length });
});

// DELETE /api/logistic/orders/:id
logisticOrdersRouter.delete("/:id", async (req: Request, res: Response) => {
  if (!(await requireClerkUser(req, res))) return;
  const id = parseInt(String(req.params["id"] ?? ""));
  if (isNaN(id)) return res.status(400).json({ message: "Invalid ID" });
  // IDOR guard (must fetch before cleanup to prevent unauthorized storage access)
  { const [_o] = await db.select({ companyId: logisticOrdersTable.companyId }).from(logisticOrdersTable).where(eq(logisticOrdersTable.id, id)); if (!_o) return res.status(404).json({ message: "Order tidak ditemukan" }); const _cid = resolveCompanyId(req); if (!await assertCompanyAccess(_o.companyId, _cid, req, res, { resourceType: "logistic_order", resourceId: id })) return; }
  // Cleanup storage dulu sebelum delete DB
  await cleanupLogisticOrderStorage([id]);
  const [deleted] = await db
    .delete(logisticOrdersTable)
    .where(eq(logisticOrdersTable.id, id))
    .returning();
  if (!deleted) return res.status(404).json({ message: "Order tidak ditemukan" });
  return res.json({ message: "Deleted", id });
});

// POST /api/logistic/orders/:id/updates — tambah catatan manual ke timeline
logisticOrdersRouter.post("/:id/updates", requireClerkUser, async (req: Request, res: Response) => {
  const id = parseInt(String(req.params["id"] ?? ""));
  if (isNaN(id)) return res.status(400).json({ message: "ID tidak valid" });

  const [order] = await db.select({ id: logisticOrdersTable.id, companyId: logisticOrdersTable.companyId }).from(logisticOrdersTable).where(eq(logisticOrdersTable.id, id));
  if (!order) return res.status(404).json({ message: "Order tidak ditemukan" });
  // IDOR guard
  { const _cid = resolveCompanyId(req); if (!await assertCompanyAccess(order.companyId, _cid, req, res, { resourceType: "logistic_order", resourceId: id })) return; }

  const notes = String(req.body?.notes ?? "").trim();
  const status = req.body?.status ? String(req.body.status).trim() : null;
  const isPublic = req.body?.isPublic === true || req.body?.isPublic === "true";

  if (!notes && !status) return res.status(400).json({ message: "notes atau status wajib diisi" });

  const actorName = (req as any).user?.fullName ?? (req as any).user?.name ?? "Admin";
  const actorId = (req as any).user?.id ?? null;

  const [inserted] = await db.insert(orderUpdatesTable).values({
    orderId: id,
    actorType: "admin",
    actorId: actorId ? String(actorId) : null,
    actorName,
    status: status || null,
    notes: notes || null,
    isPublic,
    createdAt: new Date(),
  }).returning();

  return res.status(201).json({ ok: true, update: inserted });
});

// GET /api/logistic/orders/:id/locations — GPS history for an order [H2-FIX: admin/owner/logistics only]
logisticOrdersRouter.get("/:id/locations", async (req: Request, res: Response) => {
  if (!(await requireRole(req, res, ["admin", "owner", "logistics"]))) return;
  const id = parseInt(String(req.params["id"] ?? ""));
  if (isNaN(id)) return res.status(400).json({ message: "ID tidak valid" });
  // IDOR guard
  { const [_o] = await db.select({ companyId: logisticOrdersTable.companyId }).from(logisticOrdersTable).where(eq(logisticOrdersTable.id, id)); if (!_o) return res.status(404).json({ message: "Order tidak ditemukan" }); const _cid = resolveCompanyId(req); if (!await assertCompanyAccess(_o.companyId, _cid, req, res, { resourceType: "logistic_order", resourceId: id })) return; }
  const limit = Math.min(parseInt(String(req.query["limit"] ?? "200"), 10), 500);

  const rows = await db
    .select({
      id: driverLocationsTable.id,
      latitude: driverLocationsTable.latitude,
      longitude: driverLocationsTable.longitude,
      accuracy: driverLocationsTable.accuracy,
      speed: driverLocationsTable.speed,
      checkpointType: driverLocationsTable.checkpointType,
      updatedAt: driverLocationsTable.updatedAt,
    })
    .from(driverLocationsTable)
    .where(eq(driverLocationsTable.orderId, id))
    .orderBy(driverLocationsTable.updatedAt)
    .limit(limit);

  return res.json({
    locations: rows.map(r => ({
      id: r.id,
      lat: parseFloat(String(r.latitude)),
      lng: parseFloat(String(r.longitude)),
      accuracy: r.accuracy != null ? parseFloat(String(r.accuracy)) : null,
      speed: r.speed != null ? parseFloat(String(r.speed)) : null,
      checkpointType: r.checkpointType,
      updatedAt: r.updatedAt,
    })),
    total: rows.length,
  });
});

// ── Delivery Phase Transition Endpoints ──────────────────────────────────────
// POST /api/logistic/orders/:id/delivery/:phase
// Manual delivery phase transitions untuk admin/logistics.
// Dedup: invoice-issued skip customer WA jika sudah dikirim via customer-invoice link.

const DELIVERY_PHASE_CONFIG: Record<string, { status: string; emoji: string; label: string }> = {
  "in-progress":      { status: "In Progress",     emoji: "🚀", label: "Dalam Proses" },
  "pickup":           { status: "Pickup",           emoji: "🚚", label: "Barang Diambil" },
  "in-transit":       { status: "In Transit",       emoji: "🛣️",  label: "Dalam Perjalanan" },
  "arrived":          { status: "Arrived",          emoji: "📍", label: "Tiba di Tujuan" },
  "delivered":        { status: "Delivered",        emoji: "✅", label: "Diserahkan ke Customer" },
  "pod-uploaded":     { status: "POD Uploaded",     emoji: "📷", label: "POD Diunggah" },
  "invoice-issued":   { status: "Invoice Issued",   emoji: "🧾", label: "Invoice Diterbitkan" },
  "payment-received": { status: "Payment Received", emoji: "💰", label: "Pembayaran Diterima" },
  "completed":        { status: "Completed",        emoji: "🎉", label: "Order Selesai" },
};

logisticOrdersRouter.post("/:id/delivery/:phase", async (req: Request, res: Response) => {
  if (!(await requireRole(req, res, ["admin", "owner", "logistics"]))) return;
  const id = parseInt(String(req.params["id"] ?? ""));
  if (isNaN(id)) return res.status(400).json({ message: "ID tidak valid" });
  const phase = String(req.params["phase"] ?? "");
  const cfg = DELIVERY_PHASE_CONFIG[phase];
  if (!cfg) return res.status(400).json({ message: `Phase '${phase}' tidak dikenal. Gunakan: ${Object.keys(DELIVERY_PHASE_CONFIG).join(", ")}` });

  const [order] = await db
    .select({
      id: logisticOrdersTable.id,
      orderNumber: logisticOrdersTable.orderNumber,
      status: logisticOrdersTable.status,
      customerName: logisticOrdersTable.customerName,
      phone: logisticOrdersTable.phone,
      companyName: logisticOrdersTable.companyName,
      companyId: logisticOrdersTable.companyId,
    })
    .from(logisticOrdersTable)
    .where(eq(logisticOrdersTable.id, id))
    .limit(1);
  if (!order) return res.status(404).json({ message: "Order tidak ditemukan" });
  // IDOR guard
  { const _cid = resolveCompanyId(req); if (!await assertCompanyAccess(order.companyId, _cid, req, res, { resourceType: "logistic_order", resourceId: id })) return; }

  const actorName = (req as any).user?.fullName ?? (req as any).user?.name ?? "Admin";

  try {
    await transitionLogisticOrderStatus(id, cfg.status as Parameters<typeof transitionLogisticOrderStatus>[1], {
      source: `logisticOrders:delivery/${phase}`,
      actorType: "admin",
      actorName,
      notes: `${cfg.emoji} ${cfg.label} — diubah manual oleh admin`,
    });
  } catch (e: unknown) {
    const errMsg = e instanceof Error ? e.message : "Transisi status gagal";
    return res.status(422).json({ message: errMsg });
  }

  // WA notifications — fire-and-forget
  void (async () => {
    try {
      const adminWa = await getAdminWa();
      // invoice-issued: skip customer WA jika sudah dikirim via customer-invoice link (dedup 30 menit)
      const customerPhone = phase === "invoice-issued"
        ? (await wasRecentlyNotified("customer-invoice-wa", `order:${id}`, 30 * 60 * 1000)
            ? null
            : order.phone)
        : order.phone;
      await sendLogisticOperationalStatusNotification(
        {
          order_number: order.orderNumber,
          customer_name: order.customerName ?? "",
          company_name: order.companyName ?? null,
          phone: customerPhone ?? null,
        },
        cfg.label,
        cfg.emoji,
        adminWa,
      );

      if (phase === "invoice-issued") {
        const [salesDoc] = await db
          .select({
            docNumber: salesDocumentsTable.docNumber,
            invoiceNumber: salesDocumentsTable.invoiceNumber,
            customerName: salesDocumentsTable.customerName,
            grandTotal: salesDocumentsTable.grandTotal,
            totalAmount: salesDocumentsTable.totalAmount,
            dueDate: salesDocumentsTable.dueDate,
          })
          .from(salesDocumentsTable)
          .where(eq(salesDocumentsTable.logisticOrderId, id))
          .limit(1);

        if (salesDoc) {
          let invoiceUrl: string | undefined;
          const domain = getPreferredDomain();
          const [invLink] = await db
            .select({ token: customerInvoiceLinksTable.token })
            .from(customerInvoiceLinksTable)
            .where(eq(customerInvoiceLinksTable.orderId, id))
            .limit(1);
          if (invLink?.token && domain) {
            invoiceUrl = `https://${domain}/customer-invoice/${invLink.token}`;
          }
          const invNumber = salesDoc.invoiceNumber ?? salesDoc.docNumber;
          const grandTotal = Number(salesDoc.grandTotal ?? salesDoc.totalAmount ?? 0);
          const dueStr = salesDoc.dueDate
            ? new Date(salesDoc.dueDate).toLocaleDateString("id-ID", { day: "2-digit", month: "long", year: "numeric" })
            : "—";
          await sendInvoiceIssuedNotification(
            order.orderNumber,
            invNumber,
            salesDoc.customerName,
            grandTotal,
            dueStr,
            customerPhone ?? null,
            adminWa ?? null,
            { invoiceUrl, orderId: id },
          );
        }
      }
    } catch { /* non-fatal */ }
  })();

  return res.json({ ok: true, status: cfg.status, orderId: id, phase });
});

// POST /api/logistic/orders/export-gsheet — export semua order ke Google Sheets baru (admin only)
logisticOrdersRouter.post("/export-gsheet", async (req: Request, res: Response) => {
  if (!(await requireClerkUser(req, res))) return;
  if (!(await requireRole(req, res, ["admin", "owner"]))) return;
  const companyId = resolveCompanyId(req);
  const { dateFrom, dateTo, status } = req.body as { dateFrom?: string; dateTo?: string; status?: string };

  const { exportToNewSpreadsheet } = await import("../lib/googleSheets.js");

  const conditions = [];
  if (companyId) conditions.push(eq(logisticOrdersTable.companyId, companyId));
  if (dateFrom) conditions.push(gte(logisticOrdersTable.createdAt, new Date(dateFrom)));
  if (dateTo) {
    const end = new Date(dateTo);
    end.setHours(23, 59, 59, 999);
    conditions.push(lte(logisticOrdersTable.createdAt, end));
  }
  if (status) conditions.push(eq(logisticOrdersTable.status, status as typeof logisticOrdersTable.$inferSelect["status"]));

  const orders = await db
    .select()
    .from(logisticOrdersTable)
    .where(conditions.length ? and(...conditions) : undefined)
    .orderBy(desc(logisticOrdersTable.createdAt))
    .limit(5000);

  const orderRows: unknown[][] = [
    ["No. Order", "Tanggal", "Perusahaan", "Nama Customer", "Email", "No. HP",
     "Tipe Shipment", "Asal", "Tujuan", "Komoditi", "Berat (kg)", "Volume (CBM)",
     "Jml Koli", "Pembayaran", "Subtotal", "Pajak", "Grand Total", "Status", "Sumber", "Catatan"],
    ...orders.map((o) => [
      o.orderNumber,
      o.createdAt.toISOString().slice(0, 10),
      o.companyName ?? "",
      o.customerName,
      o.email ?? "",
      o.phone ?? "",
      o.shipmentType ?? "",
      o.origin ?? "",
      o.destination ?? "",
      o.commodity ?? "",
      o.grossWeight ? parseFloat(o.grossWeight) : "",
      o.volumeCbm ? parseFloat(o.volumeCbm) : "",
      o.jumlahKoli ?? "",
      o.paymentType ?? "",
      parseFloat(o.subtotal),
      parseFloat(o.tax),
      parseFloat(o.grandTotal),
      o.status,
      (o as unknown as { source?: string }).source ?? "manual",
      o.notes ?? "",
    ]),
  ];

  const now = new Date();
  const titleDate = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;
  const filterLabel = status ? ` [${status}]` : "";
  const title = `Logistic Orders${filterLabel} — ${titleDate}`;

  const result = await exportToNewSpreadsheet(title, [
    { name: "Orders", rows: orderRows },
  ]);

  const exportMeta = extractRequestMeta(req);
  writeAuditLog({
    ...exportMeta, companyId, action: "BULK_OPERATION_VERIFIED", module: "logistics",
    newData: {
      operationType: "export-gsheet", recordCount: orders.length,
      timestamp: new Date().toISOString(),
    },
  });

  return res.json({ ok: true, total: orders.length, ...result });
});

// ─── POST /:orderId/items/:itemId/vendor-fulfillment ────────────────────────
// Buat logistic vendor fulfillment untuk item Vendor Marketplace
logisticOrdersRouter.post(
  "/:orderId/items/:itemId/vendor-fulfillment",
  requireClerkUser,
  async (req: Request, res: Response) => {
    const orderId = parseInt(String(req.params.orderId) ?? "", 10);
    const itemId  = parseInt(String(req.params.itemId)  ?? "", 10);
    if (isNaN(orderId) || isNaN(itemId)) {
      return res.status(400).json({ success: false, message: "Parameter tidak valid" });
    }

    const body = req.body as { notes?: string } | undefined;
    const adminNotes = body?.notes?.trim() || null;

    // ── 1. Validasi order ──────────────────────────────────────────────────
    const [order] = await db.select().from(logisticOrdersTable).where(eq(logisticOrdersTable.id, orderId));
    if (!order) return res.status(404).json({ success: false, message: "Order tidak ditemukan" });

    // ── 2. Validasi item ───────────────────────────────────────────────────
    const [item] = await db.select().from(logisticOrderItemsTable)
      .where(and(eq(logisticOrderItemsTable.id, itemId), eq(logisticOrderItemsTable.orderId, orderId)));
    if (!item) return res.status(404).json({ success: false, message: "Item tidak ditemukan" });

    if (item.itemSource !== "vendor_catalog_item") {
      return res.status(400).json({ success: false, message: "Item bukan Vendor Marketplace" });
    }
    if (!item.vendorCatalogItemId) {
      return res.status(400).json({ success: false, message: "vendorCatalogItemId tidak ada pada item ini" });
    }

    // ── 3. Resolve vendorId (item atau vendor catalog) ────────────────────
    let vendorId = item.vendorId ?? null;
    if (!vendorId && item.vendorCatalogItemId) {
      const row = await db.execute(sql`
        SELECT vendor_id FROM vendor_catalog_items WHERE id = ${item.vendorCatalogItemId} LIMIT 1
      `);
      const r = (row as { rows?: Array<{ vendor_id?: number | null }> }).rows?.[0];
      vendorId = r?.vendor_id ?? null;
    }
    if (!vendorId) {
      return res.status(422).json({ success: false, message: "Vendor tidak ditemukan untuk item ini" });
    }

    // ── 4. Cek duplikat via unique constraint ─────────────────────────────
    const [existing] = await db.select()
      .from(logisticVendorFulfillmentsTable)
      .where(eq(logisticVendorFulfillmentsTable.orderItemId, itemId));
    if (existing) {
      return res.status(200).json({
        success: true,
        message: "already_exists",
        fulfillment: existing,
      });
    }

    // ── 5. Siapkan snapshot payload ───────────────────────────────────────
    const serviceType = item.serviceType
      ?? ((item.templateSnapshot as Record<string,unknown> | null)?.serviceType as string | undefined)
      ?? null;

    const fulfillmentPayload: Record<string, unknown> = {
      orderId,
      orderNumber: order.orderNumber,
      itemId,
      serviceName: item.serviceName,
      category: item.category,
      calculatorType: item.calculatorType,
      serviceType,
      subtotal: item.subtotal,
    };

    // ── 6. Insert ──────────────────────────────────────────────────────────
    const [fulfillment] = await db.insert(logisticVendorFulfillmentsTable).values({
      orderId,
      orderItemId: itemId,
      vendorCatalogItemId: item.vendorCatalogItemId,
      vendorId,
      serviceType,
      status: "pending",
      fulfillmentPayload,
      calculationInput: item.calculationInput as Record<string,unknown> | null,
      templateSnapshot: item.templateSnapshot as Record<string,unknown> | null,
      priceSnapshot: item.priceSnapshot as Record<string,unknown> | null,
      adminNotes,
    }).returning();

    // ── 7. Audit log ───────────────────────────────────────────────────────
    const actor = req.user as { id?: string; name?: string; username?: string } | undefined;
    logOrderAudit({
      orderId,
      orderNumber: order.orderNumber,
      actorType: "admin",
      actorId: actor?.id ?? null,
      actorName: actor?.name ?? actor?.username ?? null,
      action: "vendor_fulfillment_created",
      description: `Vendor fulfillment created from marketplace service item: ${item.serviceName} (item #${itemId})`,
      newValue: { fulfillmentId: fulfillment.id, vendorId, serviceType, status: "pending" },
      ipAddress: req.ip ?? null,
    }).catch(() => {});

    return res.status(201).json({
      success: true,
      message: "created",
      fulfillment,
    });
  }
);

// NOTE: create-paylabs-link & payment-proof endpoints are registered ABOVE the auth wall (public).
