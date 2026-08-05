/**
 * portalLogisticOrderService.ts
 * Business logic for logistic order management routes in portal.ts:
 *   POST /vendor/quotes
 *   GET  /orders, /logistic-orders, /product-orders
 *   POST /orders
 *   PATCH /orders/:id/cancel, /logistic-orders/:id/cancel
 *   POST /order-upload, /payment-proof-upload
 *   POST /request-quote
 *   GET  /quote-requests
 *   PATCH /quote-requests/:id
 */

import {
  db,
  portalCustomersTable,
  suppliersTable,
  logisticOrderRfqsTable,
  logisticOrderQuotesTable,
  salesDocumentsTable,
  salesDocumentLinesTable,
  customersTable,
  logisticOrdersTable,
  quoteRequestsTable,
} from "@workspace/db";
import { eq, and, desc, sql } from "drizzle-orm";
import { ObjectStorageService } from "../objectStorage.js";
import { sendViaService as sendWhatsApp } from "../waTransport.js";
import { getAdminWa } from "../adminWa.js";
import { getWaTemplateConfig, renderTemplate } from "../orderNotification.js";
import { sendMail, isSmtpConfigured } from "../mailer.js";
import { saveAndBroadcast } from "../notificationStore.js";
import { transitionLogisticOrderStatus } from "./logisticOrderStatusService.js";

// ─── Typed Error ───────────────────────────────────────────────────────────────

export class LogisticOrderServiceError extends Error {
  payload?: Record<string, unknown>;
  constructor(
    public statusCode: number,
    message: string,
    payload?: Record<string, unknown>
  ) {
    super(message);
    this.name = "LogisticOrderServiceError";
    this.payload = payload;
  }
}

// ─── Object Storage ────────────────────────────────────────────────────────────

const _objectStorage = new ObjectStorageService();

// ─── Upload Rate Limiting ─────────────────────────────────────────────────────

interface _RateEntry { count: number; resetAt: number }
const _PORTAL_UPLOAD_WINDOW_MS = 60 * 60 * 1000; // 1 hour
const _PORTAL_UPLOAD_LIMIT = 20;
const _portalUploadCustomerMap = new Map<number, _RateEntry>();

function _checkPortalUploadLimit(customerId: number): boolean {
  const now = Date.now();
  let entry = _portalUploadCustomerMap.get(customerId);
  if (!entry || now > entry.resetAt) {
    entry = { count: 0, resetAt: now + _PORTAL_UPLOAD_WINDOW_MS };
  }
  if (entry.count >= _PORTAL_UPLOAD_LIMIT) return false;
  entry.count += 1;
  _portalUploadCustomerMap.set(customerId, entry);
  return true;
}

const _proofUploadMap = new Map<string, { count: number; resetAt: number }>();
function _checkProofUploadLimit(ip: string): boolean {
  const now = Date.now();
  let e = _proofUploadMap.get(ip);
  if (!e || now > e.resetAt) e = { count: 0, resetAt: now + 3_600_000 };
  if (e.count >= 5) return false;
  e.count++;
  _proofUploadMap.set(ip, e);
  return true;
}

// ─── MIME Allowlists ──────────────────────────────────────────────────────────

const _PORTAL_ALLOWED_MIME = new Set([
  "application/pdf",
  "image/jpeg", "image/jpg", "image/png", "image/webp",
  "image/heic", "image/heif",
  "application/msword",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
]);
const _PORTAL_BLOCKED_MIME = new Set([
  "image/svg+xml", "text/html", "application/javascript",
  "application/x-javascript", "text/javascript",
]);
const _PROOF_ALLOWED_MIME = new Set([
  "image/jpeg", "image/jpg", "image/png", "image/webp",
  "image/heic", "image/heif",
  "application/pdf",
]);

// ─── Internal Helpers ─────────────────────────────────────────────────────────

async function findOrCreateCrmCustomer(portalCustomer: {
  name: string; email: string; phone: string | null; company: string | null;
}) {
  const [existing] = await db
    .select()
    .from(customersTable)
    .where(eq(customersTable.email, portalCustomer.email));
  if (existing) return existing;
  const [created] = await db
    .insert(customersTable)
    .values({
      name: portalCustomer.company
        ? `${portalCustomer.name} (${portalCustomer.company})`
        : portalCustomer.name,
      email: portalCustomer.email,
      phone: portalCustomer.phone,
    })
    .returning();
  return created!;
}

async function nextPortalOrderNumber(): Promise<string> {
  const year = new Date().getFullYear();
  const pattern = `PO/${year}/%`;
  const [row] = await db
    .select({ maxSeq: sql<number>`COALESCE(MAX(CAST(SPLIT_PART(doc_number, '/', 3) AS int)), 0)` })
    .from(salesDocumentsTable)
    .where(sql`doc_number LIKE ${pattern}`);
  const seq = (Number(row?.maxSeq ?? 0) + 1).toString().padStart(5, "0");
  return `PO/${year}/${seq}`;
}

// ─── Services ─────────────────────────────────────────────────────────────────

/**
 * POST /vendor/quotes — submit or update a quote for an open RFQ
 */
export async function submitVendorQuote(
  customerId: number,
  params: {
    rfqId: number;
    vendorPrice: number;
    estimatedPickup?: string;
    estimatedDelivery?: string;
    estimatedDays?: number;
    vendorNotes?: string;
  }
) {
  const { rfqId, vendorPrice, estimatedPickup, estimatedDelivery, estimatedDays, vendorNotes } = params;

  if (!rfqId || !vendorPrice || Number(vendorPrice) <= 0) {
    throw new LogisticOrderServiceError(400, "rfqId dan vendorPrice wajib diisi");
  }

  const [customer] = await db
    .select()
    .from(portalCustomersTable)
    .where(eq(portalCustomersTable.id, customerId));
  if (!customer) throw new LogisticOrderServiceError(401, "Tidak ditemukan");

  // Resolve linked supplier
  const allSuppliers = await db.select().from(suppliersTable);
  const normalizePhone = (p: string | null) =>
    p ? p.replace(/[^\d]/g, "").replace(/^0/, "62") : null;
  const customerPhone = normalizePhone(customer.phone);
  const linkedSupplier =
    allSuppliers.find(
      (s) =>
        (s.contactEmail && s.contactEmail.toLowerCase() === customer.email.toLowerCase()) ||
        (customerPhone && normalizePhone(s.phone) === customerPhone)
    ) ?? null;
  if (!linkedSupplier) {
    throw new LogisticOrderServiceError(403, "Akun belum terhubung ke data vendor");
  }

  // Validate RFQ
  const [rfq] = await db
    .select()
    .from(logisticOrderRfqsTable)
    .where(eq(logisticOrderRfqsTable.id, rfqId));
  if (!rfq) throw new LogisticOrderServiceError(404, "RFQ tidak ditemukan");
  if (!(rfq.vendorIds as number[]).includes(linkedSupplier.id)) {
    throw new LogisticOrderServiceError(403, "RFQ ini bukan untuk vendor Anda");
  }
  if (rfq.status !== "open") {
    throw new LogisticOrderServiceError(400, "RFQ sudah tidak open");
  }

  // Upsert
  const [existing] = await db
    .select()
    .from(logisticOrderQuotesTable)
    .where(
      and(
        eq(logisticOrderQuotesTable.rfqId, rfqId),
        eq(logisticOrderQuotesTable.vendorId, linkedSupplier.id)
      )
    );

  const now = new Date();
  if (existing) {
    await db
      .update(logisticOrderQuotesTable)
      .set({
        vendorPrice: String(vendorPrice),
        estimatedPickup: estimatedPickup ?? null,
        estimatedDelivery: estimatedDelivery ?? null,
        estimatedDays: estimatedDays ?? null,
        vendorNotes: vendorNotes ?? null,
        replySource: "portal",
        replyTimestamp: now,
      })
      .where(eq(logisticOrderQuotesTable.id, existing.id));
    return { success: true, quoteId: existing.id, action: "updated" as const };
  } else {
    const [inserted] = await db
      .insert(logisticOrderQuotesTable)
      .values({
        rfqId,
        orderId: rfq.orderId,
        vendorId: linkedSupplier.id,
        vendorPrice: String(vendorPrice),
        estimatedPickup: estimatedPickup ?? null,
        estimatedDelivery: estimatedDelivery ?? null,
        estimatedDays: estimatedDays ?? null,
        vendorNotes: vendorNotes ?? null,
        markupType: "percentage",
        markupPercentage: "0",
        quoteStatus: "pending",
        replySource: "portal",
        replyTimestamp: now,
      })
      .returning();
    return { success: true, quoteId: inserted.id, action: "created" as const };
  }
}

/**
 * GET /orders — portal sales orders for authenticated customer
 */
export async function listSalesOrders(portalCustomerId: number) {
  const [customer] = await db
    .select()
    .from(portalCustomersTable)
    .where(eq(portalCustomersTable.id, portalCustomerId));
  if (!customer) throw new LogisticOrderServiceError(401, "Customer not found");

  if (customer.role === "admin") {
    const orders = await db
      .select()
      .from(salesDocumentsTable)
      .orderBy(sql`${salesDocumentsTable.createdAt} DESC`);
    return orders.map((o) => ({
      id: o.id,
      docNumber: o.docNumber,
      status: o.status,
      grandTotal: Number(o.grandTotal ?? 0),
      createdAt: o.createdAt.toISOString(),
    }));
  }

  const [crmCustomer] = await db
    .select()
    .from(customersTable)
    .where(eq(customersTable.email, customer.email));
  if (!crmCustomer) return [];

  const orders = await db
    .select()
    .from(salesDocumentsTable)
    .where(eq(salesDocumentsTable.customerId, crmCustomer.id));
  return orders.map((o) => ({
    id: o.id,
    docNumber: o.docNumber,
    status: o.status,
    grandTotal: Number(o.grandTotal ?? 0),
    createdAt: o.createdAt.toISOString(),
  }));
}

/**
 * GET /logistic-orders — logistic orders for authenticated customer
 */
export async function listLogisticOrders(portalCustomerId: number) {
  const [customer] = await db
    .select()
    .from(portalCustomersTable)
    .where(eq(portalCustomersTable.id, portalCustomerId));
  if (!customer) throw new LogisticOrderServiceError(401, "Customer not found");

  const baseQuery = db.select().from(logisticOrdersTable);
  const orders =
    customer.role === "admin"
      ? await baseQuery.orderBy(sql`${logisticOrdersTable.createdAt} DESC`)
      : await baseQuery
          .where(eq(logisticOrdersTable.email, customer.email))
          .orderBy(sql`${logisticOrdersTable.createdAt} DESC`);

  return orders.map((o) => ({
    id: o.id,
    orderNumber: o.orderNumber,
    status: o.status,
    grandTotal: parseFloat(o.grandTotal),
    createdAt: o.createdAt.toISOString(),
    shipmentType: o.shipmentType,
    origin: o.origin,
    destination: o.destination,
    customerName: o.customerName,
    email: o.email,
  }));
}

/**
 * GET /product-orders — portal product orders for authenticated customer
 */
export async function listProductOrders(portalCustomerId: number) {
  const [customer] = await db
    .select()
    .from(portalCustomersTable)
    .where(eq(portalCustomersTable.id, portalCustomerId));
  if (!customer) throw new LogisticOrderServiceError(401, "Customer not found");

  const rows = await db.execute(sql`
    SELECT id, order_number, status, grand_total, created_at, tracking_token, customer_name
    FROM portal_product_orders
    WHERE email = ${customer.email}
    ORDER BY created_at DESC
  `);
  return (rows.rows as Array<Record<string, unknown>>).map((r) => ({
    id: r.id,
    orderNumber: r.order_number,
    status: r.status,
    grandTotal: parseFloat(String(r.grand_total ?? "0")),
    createdAt:
      r.created_at instanceof Date
        ? r.created_at.toISOString()
        : String(r.created_at),
    trackingToken: r.tracking_token ?? null,
  }));
}

type OrderItem = { productId?: number; name: string; quantity: number; unitPrice: number };

/**
 * POST /orders — create a new portal sales order
 */
export async function createSalesOrder(
  portalCustomerId: number,
  params: {
    items: OrderItem[];
    notes?: string;
    expectedDate?: string;
    paymentType?: string;
  }
) {
  const [portalCustomer] = await db
    .select()
    .from(portalCustomersTable)
    .where(eq(portalCustomersTable.id, portalCustomerId));
  if (!portalCustomer) throw new LogisticOrderServiceError(401, "Customer not found");

  const { items, notes, expectedDate, paymentType } = params;

  if (!Array.isArray(items) || items.length === 0) {
    throw new LogisticOrderServiceError(400, "Pesanan harus memiliki minimal satu item");
  }

  for (const item of items) {
    if (!item.name || typeof item.quantity !== "number" || item.quantity <= 0) {
      throw new LogisticOrderServiceError(
        400,
        "Setiap item harus memiliki nama dan jumlah yang valid"
      );
    }
  }

  const crmCustomer = await findOrCreateCrmCustomer(portalCustomer);
  const docNumber = await nextPortalOrderNumber();
  const totalAmount = items.reduce(
    (sum, item) => sum + item.quantity * (item.unitPrice ?? 0),
    0
  );

  const [doc] = await db
    .insert(salesDocumentsTable)
    .values({
      docNumber,
      kind: "order",
      status: "draft",
      customerId: crmCustomer.id,
      customerName: crmCustomer.name,
      totalAmount: totalAmount.toFixed(2),
      grandTotal: totalAmount.toFixed(2),
      taxAmount: "0",
      notes: notes ? String(notes) : null,
      expectedDate: expectedDate ? new Date(String(expectedDate)) : null,
      paymentType: paymentType ? String(paymentType) : null,
      createdById: `portal:${portalCustomer.id}`,
    })
    .returning();

  if (doc) {
    await db.insert(salesDocumentLinesTable).values(
      items.map((item) => ({
        documentId: doc.id,
        productId: item.productId ?? null,
        name: item.name,
        quantity: item.quantity.toFixed(2),
        unitPrice: (item.unitPrice ?? 0).toFixed(2),
        subtotal: (item.quantity * (item.unitPrice ?? 0)).toFixed(2),
      }))
    );
  }

  const totalFmt = Number(doc!.grandTotal ?? 0).toLocaleString("id-ID");
  const itemList = items.map((i) => `• ${i.name} (${i.quantity}x)`).join("\n");

  // [HIGH-C] Notify customer via WhatsApp — uses DB template, fallback to default
  if (portalCustomer.phone) {
    void getWaTemplateConfig("customer", "portal_order_customer", [
      `🎉 *Pesanan Diterima!*`,
      `No. Pesanan: *{{orderNumber}}*`,
      ``,
      `Halo {{customerName}},`,
      `Pesanan Anda telah kami terima dan sedang diproses.`,
      ``,
      `🛒 *Detail Pesanan:*`,
      `{{itemList}}`,
      `Total: Rp {{totalFmt}}`,
      ``,
      `Tim kami akan segera menghubungi Anda untuk konfirmasi lebih lanjut.`,
      `Terima kasih telah menggunakan layanan B2B Marketplace and Logistic. 🚢`,
    ])
      .then((tplBody) => {
        const msg = renderTemplate(tplBody, {
          orderNumber: doc!.docNumber,
          customerName: portalCustomer.name,
          itemList,
          totalFmt,
        });
        return sendWhatsApp(portalCustomer.phone!, msg);
      })
      .catch((err: unknown) => {
        console.error("[portalLogisticOrderService] sendWhatsApp to customer failed", err);
      });
  }

  // Real-time SSE: notify BizPortal admins (persisted to DB)
  saveAndBroadcast("new_order", {
    type: "portal_sales",
    orderId: doc!.id,
    orderNumber: doc!.docNumber,
    customerName: portalCustomer.name,
    companyName: portalCustomer.company ?? null,
    grandTotal: Number(doc!.grandTotal),
    itemCount: items.length,
    createdAt: (doc!.createdAt as Date).toISOString(),
  }).catch(() => {});

  // [HIGH-C] Notify admin via WhatsApp — uses DB template, fallback to default
  void getWaTemplateConfig("admin_group", "portal_order_admin", [
    `🛒 *Order Portal Baru*`,
    `No: {{orderNumber}}`,
    `Customer: {{customerLine}}`,
    `Email: {{customerEmail}}`,
    `Total: Rp {{totalFmt}}`,
    `Item: {{itemCount}} produk/jasa`,
  ])
    .then(async (tplBody) => {
      const adminWa = await getAdminWa();
      if (!adminWa) return;
      const customerLine = portalCustomer.company
        ? `${portalCustomer.name} (${portalCustomer.company})`
        : portalCustomer.name;
      const msg = renderTemplate(tplBody, {
        orderNumber: doc!.docNumber,
        customerLine,
        customerEmail: portalCustomer.email ?? "-",
        totalFmt,
        itemCount: String(items.length),
      });
      return sendWhatsApp(adminWa, msg);
    })
    .catch(() => undefined);

  return {
    id: doc!.id,
    docNumber: doc!.docNumber,
    status: doc!.status,
    grandTotal: Number(doc!.grandTotal),
    createdAt: doc!.createdAt.toISOString(),
  };
}

/**
 * PATCH /orders/:id/cancel — cancel a portal sales order (owning customer only)
 */
export async function cancelSalesOrder(portalCustomerId: number, orderId: number) {
  const [customer] = await db
    .select()
    .from(portalCustomersTable)
    .where(eq(portalCustomersTable.id, portalCustomerId));
  if (!customer) throw new LogisticOrderServiceError(401, "Customer not found");

  const [crmCustomer] = await db
    .select()
    .from(customersTable)
    .where(eq(customersTable.email, customer.email));
  if (!crmCustomer) throw new LogisticOrderServiceError(403, "Forbidden");

  const [doc] = await db
    .select()
    .from(salesDocumentsTable)
    .where(
      and(
        eq(salesDocumentsTable.id, orderId),
        eq(salesDocumentsTable.customerId, crmCustomer.id)
      )
    );
  if (!doc) throw new LogisticOrderServiceError(404, "Order not found");
  if (doc.status === "cancelled" || doc.status === "done") {
    throw new LogisticOrderServiceError(400, "Order cannot be cancelled");
  }

  const [updated] = await db
    .update(salesDocumentsTable)
    .set({ status: "cancelled", updatedAt: new Date() })
    .where(eq(salesDocumentsTable.id, orderId))
    .returning();

  return {
    id: updated.id,
    docNumber: updated.docNumber,
    status: updated.status,
    grandTotal: Number(updated.grandTotal ?? 0),
    createdAt: updated.createdAt.toISOString(),
  };
}

/**
 * PATCH /logistic-orders/:id/cancel — cancel a portal logistic order (owning customer only)
 */
export async function cancelLogisticOrder(portalCustomerId: number, orderId: number) {
  const [customer] = await db
    .select()
    .from(portalCustomersTable)
    .where(eq(portalCustomersTable.id, portalCustomerId));
  if (!customer) throw new LogisticOrderServiceError(401, "Customer not found");

  const [order] = await db
    .select()
    .from(logisticOrdersTable)
    .where(
      and(
        eq(logisticOrdersTable.id, orderId),
        eq(logisticOrdersTable.email, customer.email)
      )
    );
  if (!order) throw new LogisticOrderServiceError(404, "Order not found");
  if (order.status === "Cancelled" || order.status === "Completed") {
    throw new LogisticOrderServiceError(400, "Order cannot be cancelled");
  }

  const cancelResult = await transitionLogisticOrderStatus(orderId, "Cancelled", {
    source: "portal:customer_cancel",
    actorType: "customer",
  });
  if (!cancelResult.ok) {
    throw new LogisticOrderServiceError(
      400,
      cancelResult.error ?? "Gagal membatalkan order"
    );
  }

  return {
    id: order.id,
    orderNumber: order.orderNumber,
    status: "Cancelled",
    grandTotal: parseFloat(order.grandTotal),
    createdAt: order.createdAt.toISOString(),
    shipmentType: order.shipmentType,
    origin: order.origin,
    destination: order.destination,
  };
}

/**
 * POST /order-upload — authenticated private file upload for order documents
 * Controller must parse the file with multer before calling this.
 */
export async function uploadOrderFile(
  customerId: number,
  file: { buffer: Buffer; mimetype: string }
) {
  if (!_checkPortalUploadLimit(customerId)) {
    throw new LogisticOrderServiceError(429, "Terlalu banyak upload. Coba lagi dalam 1 jam.");
  }

  const { mimetype } = file;
  if (_PORTAL_BLOCKED_MIME.has(mimetype) || !_PORTAL_ALLOWED_MIME.has(mimetype)) {
    throw new LogisticOrderServiceError(
      415,
      "Tipe file tidak diizinkan. Gunakan JPG, PNG, WebP, HEIC, PDF, atau dokumen Office."
    );
  }

  const objectPath = await _objectStorage.uploadPrivateEntity(file.buffer, mimetype);
  // Set ACL ownership — non-fatal
  _objectStorage
    .trySetObjectEntityAclPolicy(objectPath, {
      owner: String(customerId),
      visibility: "private",
    })
    .catch(() => {});

  return { objectPath };
}

/**
 * POST /payment-proof-upload — public, rate-limited 5/IP/hour
 * Controller must parse the file with multer before calling this.
 */
export async function uploadPaymentProof(
  ip: string,
  file: { buffer: Buffer; mimetype: string }
) {
  if (!_checkProofUploadLimit(ip)) {
    throw new LogisticOrderServiceError(429, "Terlalu banyak upload. Coba lagi dalam 1 jam.");
  }

  const { mimetype } = file;
  if (!_PROOF_ALLOWED_MIME.has(mimetype)) {
    throw new LogisticOrderServiceError(
      415,
      "Hanya file gambar (JPG/PNG/WebP/HEIC) atau PDF yang diizinkan. SVG, HTML, dan file eksekutabel tidak diterima."
    );
  }

  const objectPath = await _objectStorage.uploadPrivateEntity(file.buffer, mimetype);
  return { objectPath };
}

// ─── Request Quote ─────────────────────────────────────────────────────────────

type QuoteResult = {
  baseCost?: number; weightCost?: number; handlingFee?: number;
  customsFee?: number; insuranceFee?: number; expressFee?: number;
  total?: number; chargeableWeight?: number; cbm?: number;
};

/**
 * POST /request-quote — public, no auth required
 */
export async function submitRequestQuote(params: {
  name: string;
  email?: string;
  whatsapp: string;
  service: string;
  origin: string;
  destination: string;
  weight?: string;
  length?: string;
  width?: string;
  height?: string;
  incoterms?: string;
  insurance?: boolean;
  express?: boolean;
  result?: QuoteResult;
}) {
  const {
    name, email, whatsapp, service, origin, destination,
    weight, length, width, height, incoterms, insurance, express, result,
  } = params;

  if (!name?.trim() || !whatsapp?.trim()) {
    throw new LogisticOrderServiceError(400, "Nama dan WhatsApp wajib diisi", { error: "Nama dan WhatsApp wajib diisi" });
  }

  const fmt = (n?: number) =>
    n
      ? new Intl.NumberFormat("id-ID", {
          style: "currency",
          currency: "IDR",
          maximumFractionDigits: 0,
        }).format(n)
      : "-";

  const serviceLabels: Record<string, string> = {
    seaFreight: "Sea Freight 🚢", airFreight: "Air Freight ✈️",
    customs: "Bea Cukai 📦", domestic: "Domestik/Trucking 🚚",
    warehousing: "Gudang/Warehousing 🏠", projectCargo: "Project Cargo 🌐",
  };
  const svcLabel = serviceLabels[service] ?? service;
  const ts = new Date().toLocaleString("id-ID", { timeZone: "Asia/Jakarta" });

  const waLines = [
    `🚢 *REQUEST QUOTE BARU — B2B Marketplace and Logistic*`,
    `───────────────────────────`,
    `👤 *Nama:* ${name}`,
    `📧 *Email:* ${email || "-"}`,
    `📱 *WhatsApp:* ${whatsapp}`,
    `───────────────────────────`,
    `📦 *Layanan:* ${svcLabel}`,
    `🌍 *Rute:* ${origin} → ${destination}`,
    weight ? `⚖️ *Berat:* ${weight} kg` : null,
    length && width && height ? `📐 *Dimensi:* ${length}×${width}×${height} cm` : null,
    incoterms ? `📋 *Incoterms:* ${incoterms}` : null,
    insurance ? `🛡️ *Asuransi:* Ya` : null,
    express ? `⚡ *Express:* Ya` : null,
    `───────────────────────────`,
    result?.total ? `💰 *Estimasi Total:* ${fmt(result.total)}` : null,
    result?.chargeableWeight != null ? `  • Chargeable: ${result.chargeableWeight} kg` : null,
    result?.cbm != null ? `  • Volume: ${result.cbm} CBM` : null,
    result?.baseCost ? `  • Biaya Dasar: ${fmt(result.baseCost)}` : null,
    result?.weightCost ? `  • Biaya Berat/CBM: ${fmt(result.weightCost)}` : null,
    result?.handlingFee ? `  • Handling: ${fmt(result.handlingFee)}` : null,
    result?.customsFee ? `  • Bea Cukai: ${fmt(result.customsFee)}` : null,
    result?.insuranceFee ? `  • Asuransi: ${fmt(result.insuranceFee)}` : null,
    result?.expressFee ? `  • Express: ${fmt(result.expressFee)}` : null,
    `───────────────────────────`,
    `🕐 ${ts}`,
    ``,
    `_Segera tindaklanjuti permintaan ini._`,
  ]
    .filter(Boolean)
    .join("\n");

  const errors: string[] = [];

  // WhatsApp ke admin
  try {
    const adminTarget = await getAdminWa();
    if (adminTarget) await sendWhatsApp(adminTarget, waLines);
  } catch (err) {
    errors.push("WA-admin: " + String(err));
  }

  // [HIGH-C] WhatsApp konfirmasi ke customer — uses DB template, fallback to default
  try {
    if (whatsapp?.trim()) {
      const tplBody = await getWaTemplateConfig("customer", "portal_inquiry_customer", [
        `✅ *Halo {{customerName}}!*`,
        ``,
        `Terima kasih telah menghubungi *B2B Marketplace and Logistic*.`,
        `Tim kami telah menerima permintaan penawaran Anda:`,
        ``,
        `📦 *Layanan:* {{serviceLabel}}`,
        `🌍 *Rute:* {{route}}`,
        `💰 *Estimasi:* {{estimatedTotal}}`,
        ``,
        `Kami akan menghubungi Anda dalam *1×24 jam kerja* untuk konfirmasi dan penawaran resmi.`,
        ``,
        `_Salam,_`,
        `_Tim B2B Marketplace and Logistic 🚢_`,
      ]);
      const msg = renderTemplate(tplBody, {
        customerName: name,
        serviceLabel: svcLabel,
        route: `${origin} → ${destination}`,
        estimatedTotal: result?.total ? fmt(result.total) : null,
      });
      await sendWhatsApp(whatsapp, msg);
    }
  } catch (err) {
    errors.push("WA-customer: " + String(err));
  }

  // Email ke admin
  try {
    const adminEmail = process.env.ADMIN_EMAIL?.split(",")[0]?.trim();
    if (adminEmail && isSmtpConfigured()) {
      const row = (c: string, v: string) =>
        `<tr><td style="color:#64748B;padding:4px 0;width:140px;font-size:12px;">${c}</td><td style="font-weight:600;color:#1E293B;font-size:12px;">${v}</td></tr>`;

      const emailHtml = `
        <div style="font-family:system-ui,sans-serif;max-width:560px;margin:0 auto;background:#F8FAFC;padding:20px;border-radius:12px;">
          <div style="background:linear-gradient(135deg,#0B3D6B,#1A73D4);padding:18px 22px;border-radius:10px 10px 0 0;">
            <h2 style="color:white;margin:0;font-size:17px;">🚢 Request Quote Baru</h2>
            <p style="color:rgba(255,255,255,0.70);margin:3px 0 0;font-size:11px;">${ts}</p>
          </div>
          <div style="background:white;padding:18px 22px;border-radius:0 0 10px 10px;border:1px solid #E2E8F0;border-top:none;">
            <h4 style="color:#0B3D6B;font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:0.06em;margin:0 0 10px;">Kontak</h4>
            <table style="width:100%;border-collapse:collapse;">
              ${row("Nama", name)}
              ${row("Email", email || "-")}
              ${row("WhatsApp", whatsapp)}
            </table>
            <hr style="border:none;border-top:1px solid #E2E8F0;margin:14px 0;">
            <h4 style="color:#0B3D6B;font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:0.06em;margin:0 0 10px;">Detail Pengiriman</h4>
            <table style="width:100%;border-collapse:collapse;">
              ${row("Layanan", svcLabel)}
              ${row("Rute", `${origin} → ${destination}`)}
              ${weight ? row("Berat", `${weight} kg`) : ""}
              ${length && width && height ? row("Dimensi", `${length} × ${width} × ${height} cm`) : ""}
              ${incoterms ? row("Incoterms", incoterms) : ""}
              ${insurance ? row("Asuransi", "✅ Ya") : ""}
              ${express ? row("Express", "✅ Ya") : ""}
            </table>
            ${result?.total ? `
            <hr style="border:none;border-top:1px solid #E2E8F0;margin:14px 0;">
            <h4 style="color:#1D4ED8;font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:0.06em;margin:0 0 10px;">Estimasi Biaya</h4>
            <table style="width:100%;border-collapse:collapse;">
              ${result.chargeableWeight != null ? row("Chargeable", `${result.chargeableWeight} kg`) : ""}
              ${result.cbm != null ? row("Volume", `${result.cbm} CBM`) : ""}
              ${result.baseCost ? row("Biaya Dasar", fmt(result.baseCost)) : ""}
              ${result.weightCost ? row("Berat/CBM", fmt(result.weightCost)) : ""}
              ${result.handlingFee ? row("Handling", fmt(result.handlingFee)) : ""}
              ${result.customsFee ? row("Bea Cukai", fmt(result.customsFee)) : ""}
              ${result.insuranceFee ? row("Asuransi", fmt(result.insuranceFee)) : ""}
              ${result.expressFee ? row("Express", fmt(result.expressFee)) : ""}
            </table>
            <div style="margin-top:12px;padding:12px 14px;background:#EFF6FF;border-radius:8px;border:1px solid #BFDBFE;display:flex;justify-content:space-between;align-items:center;">
              <span style="font-weight:700;color:#1D4ED8;font-size:12px;">TOTAL ESTIMASI</span>
              <span style="font-weight:800;color:#0B3D6B;font-size:20px;">${fmt(result.total)}</span>
            </div>` : ""}
            <div style="margin-top:18px;padding:10px 14px;background:#F1F5F9;border-radius:8px;text-align:center;font-size:10px;color:#94A3B8;">
              B2B Marketplace and Logistic — Sistem Manajemen Logistik Terintegrasi
            </div>
          </div>
        </div>`;

      await sendMail({
        to: adminEmail,
        subject: `[Request Quote] ${svcLabel.replace(/[^\w\s→/-]/g, "").trim()} — ${name} — ${origin} → ${destination}`,
        html: emailHtml,
        text: waLines,
      });
    }
  } catch (err) {
    errors.push("Email: " + String(err));
  }

  // Simpan ke database
  try {
    await db.insert(quoteRequestsTable).values({
      name: name.trim(),
      email: email?.trim() || null,
      whatsapp: whatsapp.trim(),
      service,
      origin: origin.trim(),
      destination: destination.trim(),
      weight: weight ?? null,
      length: length ?? null,
      width: width ?? null,
      height: height ?? null,
      incoterms: incoterms ?? null,
      insurance: insurance ?? false,
      express: express ?? false,
      estimatedTotal: result?.total != null ? String(result.total) : null,
      estimatedCbm: result?.cbm != null ? String(result.cbm) : null,
      estimatedChargeableWeight:
        result?.chargeableWeight != null ? String(result.chargeableWeight) : null,
      status: "new",
    });
  } catch (err) {
    errors.push("DB-save: " + String(err));
  }

  return { ok: true, warnings: errors.length ? errors : undefined };
}

/**
 * GET /quote-requests — list all quote requests (BizPortal admin)
 */
export async function listQuoteRequests(status?: string) {
  const conditions = status ? [eq(quoteRequestsTable.status, status)] : [];
  const items = await db
    .select()
    .from(quoteRequestsTable)
    .where(conditions.length ? and(...conditions) : undefined)
    .orderBy(desc(quoteRequestsTable.createdAt));
  return { items, total: items.length };
}

/**
 * PATCH /quote-requests/:id — update status/notes/handledBy (BizPortal admin)
 */
export async function updateQuoteRequest(
  id: number,
  patch: { status?: string; notes?: string; handledBy?: string }
) {
  const { status, notes, handledBy } = patch;
  await db
    .update(quoteRequestsTable)
    .set({
      ...(status != null ? { status } : {}),
      ...(notes != null ? { notes } : {}),
      ...(handledBy != null ? { handledBy } : {}),
      updatedAt: new Date(),
    })
    .where(eq(quoteRequestsTable.id, id));
  return { ok: true };
}
