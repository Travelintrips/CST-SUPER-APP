import { Router, Request, Response } from "express";
import { randomBytes } from "crypto";
import { requirePortalAuth, verifyDevPortalEmail, type PortalAuthReq } from "../lib/supabaseAuth.js";
import { createIdempotencyMiddleware } from "../lib/financial/idempotency.js";
import { db } from "@workspace/db";
import {
  portalProductOrdersTable,
  portalProductOrderItemsTable,
  productsTable,
  productTemplatesTable,
  salesDocumentsTable,
  salesDocumentLinesTable,
  customerInvoiceLinksTable,
  driverJobsTable,
  driversTable,
} from "@workspace/db";
import { eq, ilike, and, or, sql } from "drizzle-orm";
import { resolveTemplate, resolveAllTemplates, validateTemplatePayload, CATEGORY_LABELS } from "@workspace/product-templates";
import { requireClerkUser } from "../lib/requireAdmin.js";
import { getPreferredDomain } from "../lib/domain";
import {
  sendProductOrderWaNotification,
  sendProductOrderStatusUpdateWa,
  sendProductVendorResponseAdminWa,
  sendInvoiceIssuedNotification,
  sendProductOrderPickupWaNotification,
  sendShipmentSelectionCustomerWa,
  sendShipmentModeSelectedAdminWa,
  sendReadyForPickupCustomerWa,
  sendShipmentVendorConfirmedWa,
} from "../lib/orderNotification";
import { sendMail, isSmtpConfigured } from "../lib/mailer";
import { logger } from "../lib/logger";
import { saveAndBroadcast } from "../lib/notificationStore";
import { broadcastToAdmins, broadcastToPortal } from "../lib/sseManager";
import { signVendorResponseToken, verifyVendorResponseToken } from "../lib/vendorResponseToken.js";
import { postStockOut, StockShortageError } from "../lib/inventoryStock.js";
import { postSalesInvoice } from "../lib/accounting.js";
import { getAdminGroupWa } from "../lib/adminWa.js";
import {
  PortalCompanyScopeError,
  normalizeCompanyId,
  resolvePortalCustomerCompanyIdByEmail,
} from "../lib/services/portalCompanyScope.js";

export const portalProductOrdersRouter = Router();

// ── Idempotent migrations ────────────────────────────────────────────────────
// Add shipping spec columns to products table
db.execute(sql`
  ALTER TABLE products
    ADD COLUMN IF NOT EXISTS weight_kg NUMERIC(10, 3),
    ADD COLUMN IF NOT EXISTS length_cm NUMERIC(10, 2),
    ADD COLUMN IF NOT EXISTS width_cm NUMERIC(10, 2),
    ADD COLUMN IF NOT EXISTS height_cm NUMERIC(10, 2),
    ADD COLUMN IF NOT EXISTS goods_type TEXT
`).catch(() => {});

db.execute(sql`
  CREATE TABLE IF NOT EXISTS portal_product_vendor_responses (
    id SERIAL PRIMARY KEY,
    order_number TEXT NOT NULL,
    order_id INTEGER,
    vendor_name TEXT,
    status TEXT NOT NULL,
    quoted_price NUMERIC(14, 2),
    notes TEXT,
    submitted_at TIMESTAMP DEFAULT NOW() NOT NULL
  )
`).catch(() => {});

db.execute(sql`
  ALTER TABLE portal_product_orders
    ADD COLUMN IF NOT EXISTS product_category TEXT,
    ADD COLUMN IF NOT EXISTS template_id TEXT,
    ADD COLUMN IF NOT EXISTS template_version TEXT,
    ADD COLUMN IF NOT EXISTS custom_field_values JSONB DEFAULT '{}',
    ADD COLUMN IF NOT EXISTS uploaded_documents JSONB DEFAULT '[]',
    ADD COLUMN IF NOT EXISTS checklist_status JSONB DEFAULT '{}',
    ADD COLUMN IF NOT EXISTS packaging_notes TEXT,
    ADD COLUMN IF NOT EXISTS conditional_flags JSONB DEFAULT '{}',
    ADD COLUMN IF NOT EXISTS template_snapshot JSONB,
    ADD COLUMN IF NOT EXISTS sales_doc_id INTEGER,
    ADD COLUMN IF NOT EXISTS sales_doc_number TEXT,
    ADD COLUMN IF NOT EXISTS invoice_token TEXT,
    ADD COLUMN IF NOT EXISTS tracking_token TEXT,
    ADD COLUMN IF NOT EXISTS payment_status TEXT DEFAULT 'unpaid',
    ADD COLUMN IF NOT EXISTS paid_at TIMESTAMPTZ,
    ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ DEFAULT NOW()
`).catch(() => {});

// Add shipping spec columns to order items
db.execute(sql`
  ALTER TABLE portal_product_order_items
    ADD COLUMN IF NOT EXISTS weight_kg NUMERIC(10, 3),
    ADD COLUMN IF NOT EXISTS length_cm NUMERIC(10, 2),
    ADD COLUMN IF NOT EXISTS width_cm NUMERIC(10, 2),
    ADD COLUMN IF NOT EXISTS height_cm NUMERIC(10, 2),
    ADD COLUMN IF NOT EXISTS goods_type TEXT
`).catch(() => {});

// ── Phase 2B-1: product_first columns ────────────────────────────────────────
db.execute(sql`
  ALTER TABLE portal_product_orders
    ADD COLUMN IF NOT EXISTS order_type TEXT DEFAULT 'standard',
    ADD COLUMN IF NOT EXISTS product_approve_token TEXT,
    ADD COLUMN IF NOT EXISTS shipment_mode TEXT,
    ADD COLUMN IF NOT EXISTS vendor_quoted_price NUMERIC(14,2),
    ADD COLUMN IF NOT EXISTS vendor_name_selected TEXT,
    ADD COLUMN IF NOT EXISTS ready_date TEXT,
    ADD COLUMN IF NOT EXISTS pickup_location TEXT
`).catch(() => {});

// ── Phase 2B-4: invoice cost breakdown columns ─────────────────────────────
db.execute(sql`
  ALTER TABLE portal_product_orders
    ADD COLUMN IF NOT EXISTS shipment_cost NUMERIC(14,2),
    ADD COLUMN IF NOT EXISTS truck_cost NUMERIC(14,2)
`).catch(() => {});

// ── Analytics / profitability fields ─────────────────────────────────────
db.execute(sql`
  ALTER TABLE portal_product_orders
    ADD COLUMN IF NOT EXISTS product_price NUMERIC(14,2),
    ADD COLUMN IF NOT EXISTS company_id INTEGER
`).catch(() => {});

// Add vendor_phone to vendor responses table
db.execute(sql`
  ALTER TABLE portal_product_vendor_responses
    ADD COLUMN IF NOT EXISTS vendor_phone TEXT
`).catch(() => {});

// Add shipping_method column
db.execute(sql`
  ALTER TABLE portal_product_orders
    ADD COLUMN IF NOT EXISTS shipping_method TEXT
`).catch(() => {});

// ── Helpers ──────────────────────────────────────────────────────────────────

function generateOrderNumber(): string {
  const date = new Date();
  const y = date.getFullYear().toString().slice(-2);
  const m = String(date.getMonth() + 1).padStart(2, "0");
  const d = String(date.getDate()).padStart(2, "0");
  const rand = Math.floor(Math.random() * 90000) + 10000;
  return `PRD-${y}${m}${d}-${rand}`;
}

function generateToken(): string {
  return randomBytes(20).toString("hex");
}

async function getDefaultWarehouseId(): Promise<number | null> {
  const res = await db.execute(sql`
    SELECT id FROM warehouses WHERE is_active = true ORDER BY id ASC LIMIT 1
  `);
  const row = res.rows[0] as { id: number } | undefined;
  return row?.id ?? null;
}

async function nextSoNumber(): Promise<string> {
  const year = new Date().getFullYear();
  const pattern = `SO/${year}/%`;
  const [row] = await db
    .select({ maxSeq: sql<number>`COALESCE(MAX(CAST(SPLIT_PART(doc_number, '/', 3) AS int)), 0)` })
    .from(salesDocumentsTable)
    .where(sql`doc_number LIKE ${pattern}`);
  const seq = (Number(row?.maxSeq ?? 0) + 1).toString().padStart(5, "0");
  return `SO/${year}/${seq}`;
}

type OrderRow = typeof portalProductOrdersTable.$inferSelect;

function toOrder(row: OrderRow) {
  return {
    id: row.id,
    orderNumber: row.orderNumber,
    customerName: row.customerName,
    email: row.email,
    phone: row.phone,
    shippingAddress: row.shippingAddress,
    notes: row.notes ?? null,
    subtotal: parseFloat(row.subtotal),
    grandTotal: parseFloat(row.grandTotal),
    status: row.status,
    productCategory: row.productCategory ?? null,
    templateId: row.templateId ?? null,
    templateVersion: row.templateVersion ?? null,
    customFieldValues: (row.customFieldValues ?? {}) as Record<string, string | number | boolean>,
    uploadedDocuments: (row.uploadedDocuments ?? []) as { key: string; label: string; reference: string }[],
    checklistStatus: (row.checklistStatus ?? {}) as Record<string, boolean>,
    packagingNotes: row.packagingNotes ?? null,
    conditionalFlags: (row.conditionalFlags ?? {}) as Record<string, string | number | boolean>,
    templateSnapshot: (row.templateSnapshot ?? null) as Record<string, unknown> | null,
    salesDocId: (row as any).salesDocId ?? null,
    salesDocNumber: (row as any).salesDocNumber ?? null,
    invoiceToken: (row as any).invoiceToken ?? null,
    trackingToken: (row as any).trackingToken ?? null,
    paymentStatus: (row as any).paymentStatus ?? "unpaid",
    paidAt: (row as any).paidAt ? new Date((row as any).paidAt).toISOString() : null,
    createdAt: row.createdAt.toISOString(),
    orderType: row.orderType ?? "standard",
    productApproveToken: row.productApproveToken ?? null,
    shipmentMode: row.shipmentMode ?? null,
    vendorQuotedPrice: row.vendorQuotedPrice ? parseFloat(String(row.vendorQuotedPrice)) : null,
    vendorNameSelected: row.vendorNameSelected ?? null,
    readyDate: row.readyDate ?? null,
    pickupLocation: row.pickupLocation ?? null,
    shipmentCost: row.shipmentCost != null ? parseFloat(String(row.shipmentCost)) : null,
    truckCost: row.truckCost != null ? parseFloat(String(row.truckCost)) : null,
  };
}

function toItem(row: typeof portalProductOrderItemsTable.$inferSelect) {
  return {
    id: row.id,
    orderId: row.orderId,
    productId: row.productId ?? null,
    productName: row.productName,
    productSku: row.productSku ?? null,
    unit: row.unit ?? null,
    unitPrice: parseFloat(row.unitPrice),
    qty: row.qty,
    subtotal: parseFloat(row.subtotal),
    weightKg: row.weightKg != null ? parseFloat(String(row.weightKg)) : null,
    lengthCm: row.lengthCm != null ? parseFloat(String(row.lengthCm)) : null,
    widthCm: row.widthCm != null ? parseFloat(String(row.widthCm)) : null,
    heightCm: row.heightCm != null ? parseFloat(String(row.heightCm)) : null,
    goodsType: row.goodsType ?? null,
    createdAt: row.createdAt.toISOString(),
  };
}

function formatRupiah(amount: number): string {
  return amount.toLocaleString("id-ID");
}

const VALID_STATUSES = [
  "New Order", "Confirmed", "Processing", "Shipped", "Completed", "Cancelled",
  "Admin Review", "Product RFQ Sent", "Product Quote Received", "Product Vendor Selected",
  "Customer Product Approval", "Shipment Selection Pending", "Ready for Pickup", "Shipment RFQ Sent",
] as const;

async function sendProductOrderNotification(order: ReturnType<typeof toOrder>, items: ReturnType<typeof toItem>[]) {
  const domain = getPreferredDomain();
  const orderUrl = domain ? `https://${domain}/bizportal/logistics/portal-orders` : undefined;
  const vendorToken = signVendorResponseToken(order.orderNumber);
  const vendorFormUrl = domain ? `https://${domain}/vendor-product-approval/${order.orderNumber}?t=${vendorToken}` : undefined;

  const itemsSubtotal = items.reduce((s, i) => s + i.subtotal, 0);
  const taxRate = order.grandTotal > itemsSubtotal
    ? Math.round(((order.grandTotal - itemsSubtotal) / itemsSubtotal) * 100)
    : 11;
  const taxAmount = order.grandTotal - itemsSubtotal;

  sendProductOrderWaNotification({
    orderNumber: order.orderNumber,
    customerName: order.customerName,
    email: order.email,
    phone: order.phone,
    shippingAddress: order.shippingAddress,
    notes: order.notes ?? null,
    grandTotal: order.grandTotal,
    subtotal: itemsSubtotal,
    taxAmount,
    taxRate,
    items: items.map((i) => ({
      productName: i.productName,
      qty: i.qty,
      unit: i.unit,
      subtotal: i.subtotal,
      sku: i.productSku ?? null,
      unitPrice: i.unitPrice,
    })),
    orderUrl,
    vendorFormUrl,
  }).catch((err: unknown) => logger.error({ err }, "WA product order notification failed"));

  if (isSmtpConfigured() && order.email) {
    const catLabel = order.productCategory ? (CATEGORY_LABELS[order.productCategory] ?? order.productCategory) : null;
    sendMail({
      to: order.email,
      subject: `Pesanan Anda Diterima — ${order.orderNumber}`,
      text: `Terima kasih atas pesanan Anda! No. Order: ${order.orderNumber}`,
      html: `<h2>Terima kasih atas pesanan Anda!</h2>
<p><strong>No. Order:</strong> ${order.orderNumber}</p>
${catLabel ? `<p><strong>Kategori:</strong> ${catLabel}</p>` : ""}
<table border="1" cellpadding="6" cellspacing="0">
  <tr><th>Produk</th><th>Qty</th><th>Satuan</th><th>Harga</th></tr>
  ${items.map((i) => `<tr><td>${i.productName}</td><td>${i.qty}</td><td>${i.unit ?? "pcs"}</td><td>Rp ${formatRupiah(i.subtotal)}</td></tr>`).join("")}
</table>
<p><strong>Total: Rp ${formatRupiah(order.grandTotal)}</strong></p>
<p>Alamat pengiriman: ${order.shippingAddress}</p>
${order.notes ? `<p>Catatan: ${order.notes}</p>` : ""}
<p>Tim kami akan segera menghubungi Anda.</p>`,
    }).catch(() => undefined);
  }
}

// ── T002: Auto-create SO ketika status → Confirmed ───────────────────────────
async function maybeCreateSalesOrder(orderId: number): Promise<{ docNumber: string; docId: number } | null> {
  const [order] = await db.select().from(portalProductOrdersTable).where(eq(portalProductOrdersTable.id, orderId));
  if (!order) return null;
  if ((order as any).salesDocId) return { docNumber: (order as any).salesDocNumber, docId: (order as any).salesDocId };
  const companyId = normalizeCompanyId(order.companyId);
  if (companyId == null) {
    logger.warn(
      { orderId, orderNumber: order.orderNumber },
      "[portalProductOrders] sales order creation blocked: company scope is missing or invalid",
    );
    return null;
  }

  const items = await db.select().from(portalProductOrderItemsTable).where(eq(portalProductOrderItemsTable.orderId, orderId));
  if (items.length === 0) return null;

  const docNumber = await nextSoNumber();
  const subtotal = parseFloat(order.subtotal);
  const grandTotal = parseFloat(order.grandTotal);
  const taxAmount = Math.max(0, grandTotal - subtotal);

  const [doc] = await db.insert(salesDocumentsTable).values({
    companyId,
    kind: "order",
    docNumber,
    customerName: order.customerName,
    customerEmail: order.email ?? null,
    customerPhone: order.phone ?? null,
    shippingAddress: order.shippingAddress ?? null,
    notes: order.notes ?? null,
    status: "confirmed",
    invoiceStatus: "to_invoice",
    totalAmount: String(subtotal),
    taxAmount: String(taxAmount),
    grandTotal: String(grandTotal),
    source: "portal_product",
    categoryKey: order.productCategory ?? null,
  } as any).returning();

  for (const item of items) {
    await db.insert(salesDocumentLinesTable).values({
      documentId: doc.id,
      productId: item.productId ?? null,
      name: item.productName,
      description: null,
      quantity: item.qty,
      unitPrice: String(item.unitPrice),
      subtotal: item.subtotal,
    } as any).returning();
  }

  await db.execute(sql`
    UPDATE portal_product_orders
    SET sales_doc_id = ${doc.id}, sales_doc_number = ${docNumber}
    WHERE id = ${orderId}
  `);

  postSalesInvoice({
    salesDocId: doc.id,
    docNumber,
    customerName: order.customerName,
    netAmount: subtotal,
    taxAmount,
    taxAccountId: null,
    companyId,
  }).catch((err: unknown) => logger.error({ err }, "postSalesInvoice portal product failed"));

  return { docNumber, docId: doc.id };
}

// ── T004: Buat invoice link untuk customer ────────────────────────────────────
// Untuk product-first orders, breakdown: Harga Produk + Biaya Shipment + Truck Cost + PPN = Grand Total
async function maybeCreateInvoiceLink(orderId: number): Promise<string | null> {
  const [order] = await db.select().from(portalProductOrdersTable).where(eq(portalProductOrdersTable.id, orderId));
  if (!order) return null;
  if ((order as any).invoiceToken) return (order as any).invoiceToken as string;
  const companyId = normalizeCompanyId(order.companyId);
  if (companyId == null) {
    logger.warn(
      { orderId, orderNumber: order.orderNumber },
      "[portalProductOrders] invoice link blocked: order has no company scope",
    );
    return null;
  }

  const items = await db.select().from(portalProductOrderItemsTable)
    .where(eq(portalProductOrderItemsTable.orderId, orderId));
  const token = generateToken();
  const invoiceNumber = `INV-PRD-${order.orderNumber}`;
  const isProductFirst = order.orderType === "product_first";

  type InvLineItem = { description: string; qty: number; unit: string; unitPrice: number; subtotal: number };

  let lineItems: InvLineItem[];
  let subtotal: number;
  let grandTotal: number;
  let taxAmount: number;
  const taxRate = 11;

  if (isProductFirst) {
    // Product line items
    const productLines: InvLineItem[] = items.map((i) => ({
      description: i.productName,
      qty: i.qty,
      unit: i.unit ?? "pcs",
      unitPrice: parseFloat(i.unitPrice),
      subtotal: parseFloat(i.subtotal),
    }));
    const productCost = productLines.reduce((s, l) => s + l.subtotal, 0);

    // Shipment & truck cost
    const shipCost = order.shipmentCost != null ? parseFloat(order.shipmentCost) : 0;
    const truckCostVal = order.truckCost != null ? parseFloat(order.truckCost) : 0;

    lineItems = [...productLines];
    // Always show shipment line (0 for pickup_self)
    const isPickupSelf = order.shipmentMode === "pickup_self";
    const shipLabel = isPickupSelf ? "Biaya Pengiriman (Ambil Sendiri)" : "Biaya Pengiriman";
    lineItems.push({ description: shipLabel, qty: 1, unit: "ls", unitPrice: shipCost, subtotal: shipCost });
    if (truckCostVal > 0) {
      lineItems.push({ description: "Biaya Truk", qty: 1, unit: "ls", unitPrice: truckCostVal, subtotal: truckCostVal });
    }

    const lineTotal = productCost + shipCost + truckCostVal;
    taxAmount = Math.round(lineTotal * taxRate / 100);
    subtotal = lineTotal;
    grandTotal = lineTotal + taxAmount;
  } else {
    // Standard order — use stored totals
    subtotal = parseFloat(order.subtotal);
    grandTotal = parseFloat(order.grandTotal);
    taxAmount = Math.max(0, grandTotal - subtotal);
    lineItems = items.map((i) => ({
      description: i.productName,
      qty: i.qty,
      unit: i.unit ?? "pcs",
      unitPrice: parseFloat(i.unitPrice),
      subtotal: parseFloat(i.subtotal),
    }));
  }

  const dueDate = new Date();
  dueDate.setDate(dueDate.getDate() + 7);

  await db.insert(customerInvoiceLinksTable).values({
    token,
    companyId,
    salesDocId: (order as any).salesDocId ?? null,
    orderId: order.id,
    orderNumber: order.orderNumber,
    invoiceNumber,
    customerName: order.customerName,
    customerPhone: order.phone ?? null,
    subtotal: String(subtotal),
    taxRate: String(taxRate),
    taxAmount: String(taxAmount),
    grandTotal: String(grandTotal),
    paymentStatus: "unpaid",
    status: "sent",
    dueDate,
    lineItems,
  } as any);

  await db.execute(sql`
    UPDATE portal_product_orders SET invoice_token = ${token} WHERE id = ${orderId}
  `);

  return token;
}

// Helper: compute breakdown amounts for product-first invoice WA
function computeProductFirstBreakdown(
  productSubtotal: number,
  shipCost: number,
  truckCostVal: number,
  taxRate = 11,
) {
  const lineTotal = productSubtotal + shipCost + truckCostVal;
  const ppn = Math.round(lineTotal * taxRate / 100);
  return { productCost: productSubtotal, shipCost, truckCostVal, ppn, grandTotal: lineTotal + ppn };
}

function buildProductFirstInvoiceWa(
  orderNumber: string,
  customerName: string,
  productSubtotal: number,
  shipCost: number,
  truckCostVal: number,
  invoiceUrl: string,
): string {
  const fmtRp = (n: number) => `Rp ${Math.round(n).toLocaleString("id-ID")}`;
  const { ppn, grandTotal } = computeProductFirstBreakdown(productSubtotal, shipCost, truckCostVal);
  const truckLine = truckCostVal > 0 ? `\n🚛 Biaya Truk    : ${fmtRp(truckCostVal)}` : "";
  return (
    `📦 *Pesanan Dikirim — ${orderNumber}*\n` +
    `Halo ${customerName}, pesanan Anda sedang dalam pengiriman!\n\n` +
    `🧾 *Rincian Invoice:*\n` +
    `━━━━━━━━━━━━━━━━━━\n` +
    `💰 Harga Produk   : ${fmtRp(productSubtotal)}\n` +
    `🚚 Biaya Shipment : ${fmtRp(shipCost)}` +
    truckLine + "\n" +
    `🧾 PPN 11%        : ${fmtRp(ppn)}\n` +
    `━━━━━━━━━━━━━━━━━━\n` +
    `💵 *Total         : ${fmtRp(grandTotal)}*\n\n` +
    `🔗 Cek & konfirmasi invoice:\n${invoiceUrl}\n\n` +
    `Terima kasih telah berbelanja! 🙏`
  );
}

// ── T001: Kurangi stok saat order dibuat (strict=false → catat tapi tidak blokir) ──
async function deductStock(items: { productId?: number | null; productName: string; qty: number }[], orderNumber: string): Promise<{ warnings: string[] }> {
  const warnings: string[] = [];
  const warehouseId = await getDefaultWarehouseId();
  if (!warehouseId) {
    warnings.push("Tidak ada warehouse aktif — stok tidak dikurangi");
    return { warnings };
  }

  for (const item of items) {
    if (!item.productId) continue;
    try {
      await postStockOut({
        productId: item.productId,
        warehouseId,
        qty: item.qty,
        movementType: "SALES_DELIVERY",
        referenceType: "SALES_ORDER",
        notes: `Portal Product Order ${orderNumber}`,
        strict: false,
      });
    } catch (err) {
      if (err instanceof StockShortageError) {
        warnings.push(`Stok ${item.productName} tidak cukup (tersedia: ${err.available}, diminta: ${err.requested})`);
      } else {
        logger.error({ err }, `deductStock gagal untuk productId=${item.productId}`);
      }
    }
  }
  return { warnings };
}

// ── GET /api/portal-product/templates ───────────────────────────────────────
portalProductOrdersRouter.get("/templates", async (req: Request, res: Response) => {
  try {
    const rows = await db.select().from(productTemplatesTable).where(eq(productTemplatesTable.isActive, true));
    const overrides = rows.map((row) => ({
      categoryKey: row.categoryKey,
      label: row.label,
      version: row.version,
      isActive: row.isActive,
      requiredDocuments: row.requiredDocuments as never,
      checklist: row.checklist as never,
      customFields: row.customFields as never,
      packagingInstructions: row.packagingInstructions ?? null,
      conditionalRules: row.conditionalRules as never,
      validationRules: row.validationRules as never,
    }));
    const resolved = resolveAllTemplates(overrides);
    res.setHeader("Cache-Control", "public, max-age=60, stale-while-revalidate=300");
    return res.json(resolved);
  } catch (err) {
    return res.status(500).json({ message: String(err) });
  }
});

// ── GET /api/portal-product/products ─────────────────────────────────────────
portalProductOrdersRouter.get("/products", async (req: Request, res: Response) => {
  const search = typeof req.query["search"] === "string" ? req.query["search"].trim() : null;
  const subcategory = typeof req.query["subcategory"] === "string" ? req.query["subcategory"].trim() : null;

  const conds = [eq(productsTable.isActive, true), eq(productsTable.itemType, "barang")];
  if (search) conds.push(or(ilike(productsTable.name, `%${search}%`), ilike(productsTable.sku, `%${search}%`))!);
  if (subcategory) conds.push(eq(productsTable.subcategory, subcategory));

  const rows = await db.select().from(productsTable).where(and(...conds)).orderBy(productsTable.name);

  return res.json(rows.map((p) => ({
    id: p.id,
    name: p.name,
    sku: p.sku,
    price: parseFloat(String(p.price ?? "0")),
    unit: p.unit ?? null,
    description: p.description ?? null,
    imageUrl: p.imageUrl ?? null,
    subcategory: p.subcategory ?? null,
    stock: p.stock ?? 0,
    weightKg: p.weightKg != null ? parseFloat(String(p.weightKg)) : null,
    lengthCm: p.lengthCm != null ? parseFloat(String(p.lengthCm)) : null,
    widthCm: p.widthCm != null ? parseFloat(String(p.widthCm)) : null,
    heightCm: p.heightCm != null ? parseFloat(String(p.heightCm)) : null,
    goodsType: p.goodsType ?? null,
  })));
});

// ── POST /api/portal-product/orders — buat order baru (public, optional auth) ──
portalProductOrdersRouter.post("/orders",
  createIdempotencyMiddleware("portal:product-orders", { ttlHours: 48 }),
  async (req: Request, res: Response) => {
  // Optional auth: if Authorization header present, resolve portal customer email
  let portalEmail: string | null = null;
  const authHeader = req.headers.authorization;
  if (authHeader?.startsWith("Bearer ")) {
    try {
      const { verifyPortalJwt } = await import("../lib/portalJwt.js");
      const { verifySupabaseToken } = await import("../lib/supabaseAdmin.js");
      const { portalCustomersTable: pct } = await import("@workspace/db");
      const { eq: eqFn } = await import("drizzle-orm");
      const tok = authHeader.slice(7);

      // 1) Dev token — HMAC-verified, IS_PROD-gated (returns null in production or on bad sig)
      if (tok.startsWith("devportal.")) {
        portalEmail = verifyDevPortalEmail(tok);
      }
      // 2) Portal JWT
      if (!portalEmail) {
        const pp = await verifyPortalJwt(tok);
        if (pp) {
          const [c] = await db.select({ email: pct.email }).from(pct).where(eqFn(pct.id, pp.customerId));
          if (c) portalEmail = c.email;
        }
      }
      // 3) Supabase token fallback
      if (!portalEmail) {
        const su = await verifySupabaseToken(tok);
        if (su?.email) portalEmail = su.email;
      }
    } catch { /* ignore auth errors — treat as anonymous */ }
  }

  const {
    customerName, email, phone, shippingAddress, shippingMethod, notes, items,
    productCategory, templateId: _tid, templateVersion: _tv,
    customFieldValues, uploadedDocuments, checklistStatus,
    packagingNotes, conditionalFlags,
  } = req.body as {
    customerName?: string;
    email?: string;
    phone?: string;
    shippingAddress?: string | null;
    shippingMethod?: string;
    notes?: string;
    items?: { productId?: number; productName: string; productSku?: string; unit?: string; unitPrice: number; qty: number; subtotal: number; weightKg?: number | null; lengthCm?: number | null; widthCm?: number | null; heightCm?: number | null; goodsType?: string | null }[];
    productCategory?: string;
    templateId?: string;
    templateVersion?: string;
    customFieldValues?: Record<string, string | number | boolean>;
    uploadedDocuments?: { key: string; label: string; reference: string }[];
    checklistStatus?: Record<string, boolean>;
    packagingNotes?: string;
    conditionalFlags?: Record<string, string | number | boolean>;
  };

  if (!customerName?.trim() || !email?.trim() || !phone?.trim()) {
    return res.status(400).json({ message: "customerName, email, phone wajib diisi" });
  }
  // Jika customer sedang login (portalEmail ada), gunakan email dari token sebagai canonical email
  // agar order selalu muncul di dashboard customer yang sudah login.
  const resolvedEmail = portalEmail ?? email!.trim();
  let companyId: number | null = null;
  try {
    companyId = await resolvePortalCustomerCompanyIdByEmail(
      resolvedEmail,
      { required: true },
    );
  } catch (error) {
    if (error instanceof PortalCompanyScopeError) {
      return res.status(error.statusCode).json({ message: error.message });
    }
    throw error;
  }
  const isPickup = shippingMethod === "pickup" || !shippingAddress?.trim();
  if (!Array.isArray(items) || items.length === 0) {
    return res.status(400).json({ message: "Minimal satu produk harus dipilih" });
  }

  // T001: validasi stok tersedia sebelum buat order
  const warehouseId = await getDefaultWarehouseId();
  const stockWarnings: string[] = [];
  if (warehouseId) {
    for (const item of items) {
      if (!item.productId) continue;
      const stockRow = await db.execute(sql`
        SELECT COALESCE(stock_available, stock_on_hand, 0)::float AS available
        FROM inventory_stock
        WHERE product_id = ${item.productId} AND warehouse_id = ${warehouseId}
        LIMIT 1
      `);
      const available = Number((stockRow.rows[0] as any)?.available ?? 0);
      if (available < item.qty) {
        stockWarnings.push(`Stok ${item.productName} tersisa ${available} ${item.unit ?? "pcs"} (diminta ${item.qty})`);
      }
    }
  }

  const subtotal = items.reduce((s, i) => s + (i.subtotal ?? 0), 0);
  const grandTotal = subtotal;
  const orderNumber = generateOrderNumber();
  const trackingToken = generateToken();

  const categoryForLookup = (productCategory?.trim() || "general");
  const tplRows = await db.select().from(productTemplatesTable).where(eq(productTemplatesTable.categoryKey, categoryForLookup));
  const tplOverride = tplRows[0]
    ? {
        categoryKey: tplRows[0].categoryKey,
        label: tplRows[0].label,
        version: tplRows[0].version,
        isActive: tplRows[0].isActive,
        requiredDocuments: tplRows[0].requiredDocuments as never,
        checklist: tplRows[0].checklist as never,
        customFields: tplRows[0].customFields as never,
        packagingInstructions: tplRows[0].packagingInstructions ?? null,
        conditionalRules: tplRows[0].conditionalRules as never,
        validationRules: tplRows[0].validationRules as never,
      }
    : null;
  const resolvedTpl = resolveTemplate(categoryForLookup, tplOverride);

  const validationErrors = validateTemplatePayload(resolvedTpl, {
    customFieldValues: customFieldValues ?? {},
    uploadedDocuments: uploadedDocuments ?? [],
    checklistStatus: checklistStatus ?? {},
    packagingNotes: packagingNotes ?? "",
    conditionalFlags: conditionalFlags ?? {},
  });
  if (validationErrors.length > 0) {
    return res.status(400).json({ message: validationErrors[0], errors: validationErrors });
  }

  const orderTypeVal = (req.body as { orderType?: string }).orderType ?? "standard";
  const productApproveToken = orderTypeVal === "product_first" ? generateToken() : null;

  // ── ATOMIC TRANSACTION: order header + field updates + items ─────────────────
  // All DB writes for a new order must succeed together or roll back entirely.
  // If item insert fails after header insert, the orphaned header is automatically
  // rolled back — no partial orders can exist in the database.
  const { order, insertedItems } = await db.transaction(async (tx) => {
    const [order] = await tx
      .insert(portalProductOrdersTable)
      .values({
        orderNumber,
        companyId,
        customerName: customerName.trim(),
        email: resolvedEmail,
        phone: phone.trim(),
        shippingAddress: shippingAddress?.trim() ?? (isPickup ? "AMBIL SENDIRI" : ""),
        notes: notes?.trim() ?? null,
        subtotal: String(subtotal),
        grandTotal: String(grandTotal),
        status: "New Order",
        productCategory: categoryForLookup,
        templateId: resolvedTpl.category,
        templateVersion: resolvedTpl.version,
        customFieldValues: customFieldValues ?? {},
        uploadedDocuments: uploadedDocuments ?? [],
        checklistStatus: checklistStatus ?? {},
        packagingNotes: packagingNotes?.trim() ?? null,
        conditionalFlags: conditionalFlags ?? {},
        templateSnapshot: resolvedTpl as unknown as Record<string, unknown>,
      } as any)
      .returning();

    // Set extra columns not in Drizzle schema via raw SQL — inside the same tx
    await tx.execute(sql`UPDATE portal_product_orders SET shipping_method = ${shippingMethod ?? (isPickup ? "pickup" : "delivery")} WHERE id = ${order.id}`);
    await tx.execute(sql`UPDATE portal_product_orders SET tracking_token = ${trackingToken} WHERE id = ${order.id}`);
    await tx.execute(sql`UPDATE portal_product_orders SET order_type = ${orderTypeVal} WHERE id = ${order.id}`);
    if (productApproveToken) {
      await tx.execute(sql`UPDATE portal_product_orders SET product_approve_token = ${productApproveToken} WHERE id = ${order.id}`);
    }

    const itemRows = items.map((i) => ({
      orderId: order.id,
      productId: i.productId ?? null,
      productName: i.productName,
      productSku: i.productSku ?? null,
      unit: i.unit ?? null,
      unitPrice: String(i.unitPrice),
      qty: i.qty,
      subtotal: String(i.subtotal),
      weightKg: i.weightKg != null ? String(i.weightKg) : null,
      lengthCm: i.lengthCm != null ? String(i.lengthCm) : null,
      widthCm: i.widthCm != null ? String(i.widthCm) : null,
      heightCm: i.heightCm != null ? String(i.heightCm) : null,
      goodsType: i.goodsType ?? null,
    }));
    const insertedItems = await tx.insert(portalProductOrderItemsTable).values(itemRows).returning();

    return { order, insertedItems };
  });

  // T001: kurangi stok (non-blocking)
  deductStock(
    items.map((i) => ({ productId: i.productId, productName: i.productName, qty: i.qty })),
    orderNumber
  ).then(({ warnings }) => {
    if (warnings.length > 0) logger.warn({ warnings }, "Stock deduction warnings for portal product order");
  }).catch((err: unknown) => logger.error({ err }, "deductStock failed"));

  const orderOut = toOrder({ ...order, trackingToken } as any);
  const itemsOut = insertedItems.map(toItem);

  const domain = getPreferredDomain();
  const trackingUrl = domain ? `https://${domain}/track-produk/${trackingToken}` : null;

  saveAndBroadcast("new_order", {
    type: "product",
    orderId: order.id,
    orderNumber,
    customerName: customerName.trim(),
    companyName: null,
    grandTotal,
    itemCount: items.length,
    createdAt: (order.createdAt as Date).toISOString(),
  }).catch(() => {});

  if (isPickup) {
    const domain = getPreferredDomain();
    const orderUrl = domain ? `https://${domain}/bizportal/logistics/portal-orders` : undefined;
    sendProductOrderPickupWaNotification({
      orderNumber,
      customerName: customerName.trim(),
      phone: phone.trim(),
      email: email.trim(),
      grandTotal,
      notes: notes?.trim() ?? null,
      items: itemsOut.map((i) => ({
        productName: i.productName,
        qty: i.qty,
        unit: i.unit ?? null,
        subtotal: i.subtotal,
        sku: i.productSku ?? null,
      })),
      orderUrl,
    }).catch((err: unknown) => req.log?.error({ err }, "WA pickup notification failed"));
  } else {
    sendProductOrderNotification(orderOut, itemsOut).catch((err: unknown) => {
      req.log?.error({ err }, "sendProductOrderNotification failed");
    });
  }

  // Kirim email dengan link tracking
  if (isSmtpConfigured() && email?.trim() && trackingUrl) {
    sendMail({
      to: email.trim(),
      subject: `Lacak Pesanan Anda — ${orderNumber}`,
      text: `Lacak pesanan Anda di: ${trackingUrl}`,
      html: `<p>Lacak status pesanan <strong>${orderNumber}</strong> Anda di sini:</p>
<p><a href="${trackingUrl}" style="background:#2563eb;color:white;padding:10px 20px;border-radius:6px;text-decoration:none;">Lacak Pesanan</a></p>
${stockWarnings.length > 0 ? `<p style="color:orange">⚠️ ${stockWarnings.join("; ")}</p>` : ""}`,
    }).catch(() => undefined);
  }

  return res.status(201).json({
    ...orderOut,
    items: itemsOut,
    trackingToken,
    trackingUrl,
    stockWarnings,
  });
});

// ── GET /api/portal-product/orders — list orders (admin) ────────────────────
portalProductOrdersRouter.get("/orders", async (req: Request, res: Response) => {
  if (!(await requireClerkUser(req, res))) return;
  const status = typeof req.query["status"] === "string" ? req.query["status"] : null;
  const search = typeof req.query["search"] === "string" ? req.query["search"].trim() : null;

  const conds = [];
  if (status) conds.push(eq(portalProductOrdersTable.status, status));
  if (search) {
    conds.push(
      or(
        ilike(portalProductOrdersTable.customerName, `%${search}%`),
        ilike(portalProductOrdersTable.orderNumber, `%${search}%`),
        ilike(portalProductOrdersTable.email, `%${search}%`)
      )!
    );
  }

  const rows = conds.length > 0
    ? await db.select().from(portalProductOrdersTable).where(and(...conds)).orderBy(sql`${portalProductOrdersTable.createdAt} DESC`)
    : await db.select().from(portalProductOrdersTable).orderBy(sql`${portalProductOrdersTable.createdAt} DESC`);

  return res.json(rows.map(toOrder));
});

// ── DELETE /api/portal-product/orders/:id ───────────────────────────────────
portalProductOrdersRouter.delete("/orders/:id", async (req: Request, res: Response) => {
  if (!(await requireClerkUser(req, res))) return;
  const id = parseInt(String(String(req.params.id)), 10);
  if (isNaN(id)) return res.status(400).json({ message: "ID tidak valid" });

  const [deleted] = await db.delete(portalProductOrdersTable).where(eq(portalProductOrdersTable.id, id)).returning();
  if (!deleted) return res.status(404).json({ message: "Order tidak ditemukan" });
  return res.json({ message: "Order berhasil dihapus", id });
});

// ── PATCH /api/portal-product/orders/items/:itemId/link ─────────────────────
portalProductOrdersRouter.patch("/orders/items/:itemId/link", async (req: Request, res: Response) => {
  if (!(await requireClerkUser(req, res))) return;
  const itemId = parseInt(String(String(req.params.itemId)), 10);
  if (isNaN(itemId)) return res.status(400).json({ message: "Item ID tidak valid" });

  const { productId } = req.body as { productId?: number };
  if (!productId) return res.status(400).json({ message: "productId wajib diisi" });

  const [product] = await db.select().from(productsTable).where(eq(productsTable.id, productId));
  if (!product) return res.status(404).json({ message: "Produk tidak ditemukan" });

  const [updated] = await db
    .update(portalProductOrderItemsTable)
    .set({ productId: product.id, productName: product.name, productSku: product.sku ?? null, unit: product.unit ?? null })
    .where(eq(portalProductOrderItemsTable.id, itemId))
    .returning();

  if (!updated) return res.status(404).json({ message: "Item tidak ditemukan" });
  return res.json(toItem(updated));
});

// ── GET /api/portal-product/orders/:id ──────────────────────────────────────
portalProductOrdersRouter.get("/orders/:id", async (req: Request, res: Response) => {
  if (!(await requireClerkUser(req, res))) return;
  const id = parseInt(String(String(req.params.id)), 10);
  if (isNaN(id)) return res.status(400).json({ message: "ID tidak valid" });

  const [order] = await db.select().from(portalProductOrdersTable).where(eq(portalProductOrdersTable.id, id));
  if (!order) return res.status(404).json({ message: "Order tidak ditemukan" });

  const items = await db.select().from(portalProductOrderItemsTable).where(eq(portalProductOrderItemsTable.orderId, id));

  return res.json({ ...toOrder(order), items: items.map(toItem) });
});

// ── PUT /api/portal-product/orders/:id/status — update status (admin) ────────
// T002: auto-create SO saat → Confirmed
// T004: auto-create invoice link saat → Shipped
portalProductOrdersRouter.put("/orders/:id/status", async (req: Request, res: Response) => {
  if (!(await requireClerkUser(req, res))) return;
  const id = parseInt(String(String(req.params.id)), 10);
  if (isNaN(id)) return res.status(400).json({ message: "ID tidak valid" });

  const { status } = req.body as { status?: string };
  if (!status?.trim()) return res.status(400).json({ message: "Status wajib diisi" });
  if (!(VALID_STATUSES as readonly string[]).includes(status.trim())) {
    return res.status(400).json({ message: `Status tidak valid. Pilihan: ${VALID_STATUSES.join(", ")}` });
  }

  const [existing] = await db.select().from(portalProductOrdersTable).where(eq(portalProductOrdersTable.id, id));
  if (!existing) return res.status(404).json({ message: "Order tidak ditemukan" });

  const [updated] = await db
    .update(portalProductOrdersTable)
    .set({ status: status.trim() })
    .where(eq(portalProductOrdersTable.id, id))
    .returning();

  if (!updated) return res.status(404).json({ message: "Order tidak ditemukan" });

  // Stamp updated_at
  await db.execute(sql`UPDATE portal_product_orders SET updated_at = NOW() WHERE id = ${id}`);

  const statusLabels: Record<string, string> = {
    "New Order":  "Order Baru ✅",
    "Confirmed":  "Dikonfirmasi ✅",
    "Processing": "Sedang Diproses 🔄",
    "Shipped":    "Dikirim 🚚",
    "Completed":  "Selesai 🎉",
    "Cancelled":  "Dibatalkan ❌",
  };
  const label = statusLabels[status.trim()] ?? status.trim();

  let invoiceToken: string | null = null;
  let invoiceUrl: string | null = null;
  const domain = getPreferredDomain();

  // T002: Confirmed → buat Sales Order
  if (status.trim() === "Confirmed" && existing.status !== "Confirmed") {
    if (normalizeCompanyId(existing.companyId) == null) {
      return res.status(422).json({
        message: "Order belum memiliki company yang tidak ambigu; tidak dapat dibuat menjadi Sales Order.",
      });
    }
    maybeCreateSalesOrder(id).then((soResult) => {
      if (soResult) logger.info({ orderId: id, soNumber: soResult.docNumber }, "SO auto-created for portal product order");
    }).catch((err: unknown) => logger.error({ err }, "maybeCreateSalesOrder failed"));
  }

  // T004: Shipped → buat invoice link + kirim ke customer via WA + email fallback
  if (status.trim() === "Shipped" && existing.status !== "Shipped") {
    try {
      invoiceToken = await maybeCreateInvoiceLink(id);
      if (invoiceToken && domain) {
        invoiceUrl = `https://${domain}/customer-invoice/${invoiceToken}`;
        const phone = updated.phone ?? null;
        if (phone) {
          const { sendViaService } = await import("../lib/waTransport.js");
          let msg: string;
          if (updated.orderType === "product_first") {
            // Breakdown WA untuk product-first
            const productSubtotal = parseFloat(updated.subtotal ?? "0");
            const shipCost = updated.shipmentCost != null ? parseFloat(updated.shipmentCost) : 0;
            const truckCostVal = updated.truckCost != null ? parseFloat(updated.truckCost) : 0;
            msg = buildProductFirstInvoiceWa(updated.orderNumber, updated.customerName, productSubtotal, shipCost, truckCostVal, invoiceUrl);
          } else {
            msg = `📦 *Pesanan Dikirim — ${updated.orderNumber}*\n` +
              `Halo ${updated.customerName}, pesanan Anda sedang dalam pengiriman!\n\n` +
              `🧾 Cek & konfirmasi invoice:\n${invoiceUrl}\n\n` +
              `Terima kasih telah berbelanja! 🙏`;
          }
          sendViaService(phone, msg).catch(() => undefined);
        }
        // Email fallback untuk Shipped
        if (isSmtpConfigured() && updated.email) {
          sendMail({
            to: updated.email,
            subject: `Pesanan Dikirim — ${updated.orderNumber}`,
            text: "",
            html: `<h2>Pesanan Anda sedang dikirim! 🚚</h2>
<p>Halo ${updated.customerName}, pesanan <strong>${updated.orderNumber}</strong> sudah dalam perjalanan.</p>
<p>Silakan cek dan konfirmasi invoice Anda: <a href="${invoiceUrl}">${invoiceUrl}</a></p>`,
          }).catch(() => undefined);
        }
      }
    } catch (err) {
      logger.error({ err }, "maybeCreateInvoiceLink failed");
    }
  }

  // Completed → email fallback notifikasi selesai
  if (status.trim() === "Completed" && existing.status !== "Completed") {
    if (isSmtpConfigured() && updated.email) {
      sendMail({
        to: updated.email,
        subject: `Pesanan Selesai — ${updated.orderNumber}`,
        text: "",
        html: `<h2>Pesanan Anda telah selesai! 🎉</h2>
<p>Halo ${updated.customerName}, pesanan <strong>${updated.orderNumber}</strong> telah selesai.</p>
<p>Terima kasih telah berbelanja bersama kami. Sampai jumpa kembali! 🙏</p>`,
      }).catch(() => undefined);
    }
  }

  // SSE broadcast ke customer portal agar tracking live update
  broadcastToPortal("order_status_update", {
    orderNumber: updated.orderNumber,
    status: status.trim(),
    label,
    updatedAt: new Date().toISOString(),
  });

  // SSE broadcast ke admin
  broadcastToAdmins("product_order_status_update", {
    orderId: id,
    orderNumber: updated.orderNumber,
    status: status.trim(),
    label,
  });

  sendProductOrderStatusUpdateWa({
    orderNumber: updated.orderNumber,
    customerName: updated.customerName,
    phone: updated.phone ?? null,
    statusLabel: label,
  }).catch((err: unknown) => logger.error({ err }, "WA product status update failed"));

  return res.json({ ...toOrder(updated), invoiceUrl });
});

// ── GET /api/portal-product/track/:token — public tracking (T003) ────────────
portalProductOrdersRouter.get("/track/:token", async (req: Request, res: Response) => {
  const token = req.params["token"] as string;
  if (!token || token.length < 10) return res.status(400).json({ error: "Token tidak valid" });

  const result = await db.execute(sql`
    SELECT
      ppo.id, ppo.order_number, ppo.customer_name, ppo.shipping_address,
      ppo.status, ppo.grand_total, ppo.created_at, ppo.product_category,
      ppo.invoice_token, ppo.payment_status, ppo.paid_at,
      ppo.order_type, ppo.product_approve_token
    FROM portal_product_orders ppo
    WHERE ppo.tracking_token = ${token}
    LIMIT 1
  `);

  const row = result.rows[0] as any;
  if (!row) return res.status(404).json({ error: "Order tidak ditemukan atau link tidak valid" });

  const itemsResult = await db.execute(sql`
    SELECT product_name, qty, unit, unit_price, subtotal
    FROM portal_product_order_items
    WHERE order_id = ${row.id}
    ORDER BY id ASC
  `);

  const orderType: string = row.order_type ?? "standard";
  const domain = getPreferredDomain();
  const invoiceUrl = row.invoice_token && domain
    ? `https://${domain}/customer-invoice/${row.invoice_token}`
    : null;
  const productApproveUrl = (orderType === "product_first") && row.product_approve_token && domain
    ? `https://${domain}/product-approve/${row.product_approve_token}`
    : null;
  const shipmentSelectionUrl = (orderType === "product_first") && row.product_approve_token && domain
    ? `https://${domain}/shipment-selection/${row.product_approve_token}`
    : null;

  const PRODUCT_FIRST_TIMELINE = [
    { status: "Order Received",            label: "Pesanan Diterima",           icon: "📋" },
    { status: "Admin Review",              label: "Ditinjau Admin",              icon: "🔍" },
    { status: "Product RFQ Sent",          label: "RFQ Produk Dikirim",         icon: "📤" },
    { status: "Product Quote Received",    label: "Penawaran Produk Masuk",     icon: "💰" },
    { status: "Product Vendor Selected",   label: "Vendor Produk Dipilih",      icon: "🏭" },
    { status: "Customer Product Approval", label: "Menunggu Persetujuan Produk",icon: "✍️" },
    { status: "Shipment Selection Pending",label: "Pilih Mode Pengiriman",       icon: "🚚" },
    { status: "Ready for Pickup",          label: "Siap Diambil",               icon: "📦" },
    { status: "Shipment RFQ Sent",         label: "RFQ Pengiriman Dikirim",     icon: "📋" },
    { status: "Vendor Confirmed",          label: "Vendor Dikonfirmasi",        icon: "🤝" },
    { status: "In Progress",               label: "Sedang Diproses",            icon: "🔄" },
    { status: "Pickup",                    label: "Penjemputan",                icon: "🚛" },
    { status: "In Transit",               label: "Dalam Perjalanan",            icon: "🛣️" },
    { status: "Arrived",                  label: "Tiba di Tujuan",              icon: "📍" },
    { status: "Delivered",                label: "Terkirim",                    icon: "✅" },
    { status: "POD Uploaded",             label: "Bukti Terkirim",              icon: "📄" },
    { status: "Invoice Issued",           label: "Invoice Diterbitkan",         icon: "🧾" },
    { status: "Payment Received",         label: "Pembayaran Diterima",         icon: "💳" },
    { status: "Completed",               label: "Selesai",                     icon: "🎉" },
  ];

  const STANDARD_TIMELINE = [
    { status: "New Order",  label: "Pesanan Diterima",   icon: "📋" },
    { status: "Confirmed",  label: "Dikonfirmasi",        icon: "✅" },
    { status: "Processing", label: "Sedang Diproses",     icon: "🔄" },
    { status: "Shipped",    label: "Dalam Pengiriman",    icon: "🚚" },
    { status: "Completed",  label: "Pesanan Selesai",     icon: "🎉" },
  ];

  const statusTimeline = orderType === "product_first" ? PRODUCT_FIRST_TIMELINE : STANDARD_TIMELINE;

  // For product_first, collapse "Ready for Pickup" and "Shipment RFQ Sent" into one slot
  // based on actual status
  let effectiveTimeline = statusTimeline;
  if (orderType === "product_first") {
    const actualStatus = row.status as string;
    if (actualStatus === "Ready for Pickup") {
      effectiveTimeline = statusTimeline.filter(s => s.status !== "Shipment RFQ Sent");
    } else {
      effectiveTimeline = statusTimeline.filter(s => s.status !== "Ready for Pickup");
    }
  }

  const currentIdx = effectiveTimeline.findIndex((s) => s.status === row.status);

  return res.json({
    orderNumber: row.order_number,
    customerName: row.customer_name,
    shippingAddress: row.shipping_address,
    status: row.status,
    grandTotal: parseFloat(row.grand_total),
    productCategory: row.product_category ?? null,
    createdAt: new Date(row.created_at).toISOString(),
    paymentStatus: row.payment_status ?? "unpaid",
    paidAt: row.paid_at ? new Date(row.paid_at).toISOString() : null,
    invoiceUrl,
    orderType,
    productApproveUrl,
    shipmentSelectionUrl,
    items: (itemsResult.rows as any[]).map((i) => ({
      productName: i.product_name,
      qty: Number(i.qty),
      unit: i.unit ?? "pcs",
      unitPrice: parseFloat(i.unit_price),
      subtotal: parseFloat(i.subtotal),
    })),
    timeline: effectiveTimeline.map((s, idx) => ({
      ...s,
      done: row.status === "Cancelled" ? false : idx <= currentIdx,
      current: s.status === row.status,
    })),
    isCancelled: row.status === "Cancelled",
  });
});

// ── POST /api/portal-product/orders/:id/confirm-payment — admin konfirmasi bayar (T004) ──
portalProductOrdersRouter.post("/orders/:id/confirm-payment", async (req: Request, res: Response) => {
  if (!(await requireClerkUser(req, res))) return;
  const id = parseInt(String(String(req.params.id)), 10);
  if (isNaN(id)) return res.status(400).json({ message: "ID tidak valid" });

  const [order] = await db.select().from(portalProductOrdersTable).where(eq(portalProductOrdersTable.id, id));
  if (!order) return res.status(404).json({ message: "Order tidak ditemukan" });
  if (normalizeCompanyId(order.companyId) == null) {
    return res.status(422).json({
      message: "Pembayaran ditolak: order belum memiliki company yang tidak ambigu.",
    });
  }

  await db.execute(sql`
    UPDATE portal_product_orders
    SET payment_status = 'paid', paid_at = NOW(), updated_at = NOW()
    WHERE id = ${id}
  `);

  const invToken = (order as any).invoiceToken as string | null;
  if (invToken) {
    await db.execute(sql`
      UPDATE customer_invoice_links
      SET payment_status = 'paid', amount_paid = grand_total, confirmed_at = NOW()
      WHERE token = ${invToken}
    `);
  }

  const phone = order.phone ?? null;

  // WA notifikasi pembayaran diterima
  if (phone) {
    const { sendViaService } = await import("../lib/waTransport.js");
    const msg = `✅ *Pembayaran Dikonfirmasi*\n\n` +
      `Halo ${order.customerName}, pembayaran pesanan *${order.orderNumber}* telah kami terima.\n` +
      `Terima kasih! Pesanan Anda sedang kami proses. 🙏`;
    sendViaService(phone, msg).catch(() => undefined);
  }

  // Email fallback untuk konfirmasi pembayaran
  if (isSmtpConfigured() && order.email) {
    sendMail({
      to: order.email,
      subject: `Pembayaran Dikonfirmasi — ${order.orderNumber}`,
      text: "",
      html: `<h2>Pembayaran Anda telah diterima! ✅</h2>
<p>Halo ${order.customerName}, pembayaran untuk pesanan <strong>${order.orderNumber}</strong> telah kami konfirmasi.</p>
<p>Pesanan Anda akan segera kami proses. Terima kasih! 🙏</p>`,
    }).catch(() => undefined);
  }

  // SSE broadcast ke admin dan customer portal
  broadcastToAdmins("payment_confirmed", { orderId: id, orderNumber: order.orderNumber });
  broadcastToPortal("order_status_update", {
    orderNumber: order.orderNumber,
    paymentStatus: "paid",
    updatedAt: new Date().toISOString(),
  });

  return res.json({ success: true, message: "Pembayaran dikonfirmasi" });
});

// ── POST /api/portal-product/orders/:id/regenerate-vendor-token — admin regenerate vendor link ──
portalProductOrdersRouter.post("/orders/:id/regenerate-vendor-token", async (req: Request, res: Response) => {
  if (!(await requireClerkUser(req, res))) return;
  const id = parseInt(String(String(req.params.id)), 10);
  if (isNaN(id)) return res.status(400).json({ message: "ID tidak valid" });

  const [order] = await db.select({
    id: portalProductOrdersTable.id,
    orderNumber: portalProductOrdersTable.orderNumber,
  }).from(portalProductOrdersTable).where(eq(portalProductOrdersTable.id, id));
  if (!order) return res.status(404).json({ message: "Order tidak ditemukan" });

  const domain = getPreferredDomain();
  const newToken = signVendorResponseToken(order.orderNumber);
  const vendorFormUrl = domain
    ? `https://${domain}/vendor-product-approval/${order.orderNumber}?t=${newToken}`
    : null;

  return res.json({
    success: true,
    orderNumber: order.orderNumber,
    vendorToken: newToken,
    vendorFormUrl,
    expiresIn: "7 hari",
  });
});

// ── POST /api/portal-product/orders/:id/resend-invoice — kirim ulang invoice WA ──
portalProductOrdersRouter.post("/orders/:id/resend-invoice", async (req: Request, res: Response) => {
  if (!(await requireClerkUser(req, res))) return;
  const id = parseInt(String(String(req.params.id)), 10);
  if (isNaN(id)) return res.status(400).json({ message: "ID tidak valid" });

  const [order] = await db.select().from(portalProductOrdersTable).where(eq(portalProductOrdersTable.id, id));
  if (!order) return res.status(404).json({ message: "Order tidak ditemukan" });

  let invoiceToken: string | null = (order as any).invoiceToken ?? null;
  if (!invoiceToken) invoiceToken = await maybeCreateInvoiceLink(id);
  if (!invoiceToken) return res.status(400).json({ message: "Invoice belum dibuat" });

  const domain = getPreferredDomain();
  const invoiceUrl = domain ? `https://${domain}/customer-invoice/${invoiceToken}` : null;
  if (!invoiceUrl) return res.status(400).json({ message: "Domain belum dikonfigurasi" });

  const phone = order.phone ?? null;
  if (phone) {
    const { sendViaService } = await import("../lib/waTransport.js");
    let msg: string;
    if (order.orderType === "product_first") {
      const productSubtotal = parseFloat(order.subtotal ?? "0");
      const shipCost = order.shipmentCost != null ? parseFloat(order.shipmentCost) : 0;
      const truckCostVal = order.truckCost != null ? parseFloat(order.truckCost) : 0;
      msg = buildProductFirstInvoiceWa(order.orderNumber, order.customerName, productSubtotal, shipCost, truckCostVal, invoiceUrl);
    } else {
      msg = `🧾 *Invoice Pesanan ${order.orderNumber}*\n` +
        `Halo ${order.customerName}, berikut link invoice Anda:\n${invoiceUrl}\n\nTerima kasih! 🙏`;
    }
    await sendViaService(phone, msg);
  }

  return res.json({ success: true, invoiceUrl });
});

// ── POST /api/portal-product/admin/orders/:id/set-shipment-cost ──────────────
// Admin menetapkan biaya shipment dan truck setelah pilih vendor pengiriman.
// Otomatis update customer_invoice_links jika invoice sudah dibuat.
portalProductOrdersRouter.post("/admin/orders/:id/set-shipment-cost", async (req: Request, res: Response) => {
  if (!(await requireClerkUser(req, res))) return;
  const id = parseInt(String(String(req.params.id)), 10);
  if (isNaN(id)) return res.status(400).json({ error: "ID tidak valid" });

  const { shipmentCost, truckCost } = req.body as { shipmentCost?: number | null; truckCost?: number | null };
  const shipCostNum = shipmentCost != null ? Number(shipmentCost) : 0;
  const truckCostNum = truckCost != null ? Number(truckCost) : 0;

  const [order] = await db.select().from(portalProductOrdersTable).where(eq(portalProductOrdersTable.id, id));
  if (!order) return res.status(404).json({ error: "Order tidak ditemukan" });

  // Update kolom biaya di order
  await db.update(portalProductOrdersTable)
    .set({
      shipmentCost: String(shipCostNum),
      truckCost: String(truckCostNum),
      updatedAt: new Date(),
    })
    .where(eq(portalProductOrdersTable.id, id));

  // Jika invoice sudah dibuat, update customer_invoice_links dengan breakdown baru
  const invoiceToken = (order as any).invoiceToken as string | null;
  if (invoiceToken) {
    const productSubtotal = parseFloat(order.subtotal ?? "0");
    const lineTotal = productSubtotal + shipCostNum + truckCostNum;
    const ppn = Math.round(lineTotal * 11 / 100);
    const newGrandTotal = lineTotal + ppn;

    // Rebuild line items
    const items = await db.select().from(portalProductOrderItemsTable)
      .where(eq(portalProductOrderItemsTable.orderId, id));
    const productLines = items.map(i => ({
      description: i.productName,
      qty: i.qty,
      unit: i.unit ?? "pcs",
      unitPrice: parseFloat(i.unitPrice),
      subtotal: parseFloat(i.subtotal),
    }));
    const isPickupSelf = order.shipmentMode === "pickup_self";
    const shipLabel = isPickupSelf ? "Biaya Pengiriman (Ambil Sendiri)" : "Biaya Pengiriman";
    const newLineItems = [
      ...productLines,
      { description: shipLabel, qty: 1, unit: "ls", unitPrice: shipCostNum, subtotal: shipCostNum },
      ...(truckCostNum > 0 ? [{ description: "Biaya Truk", qty: 1, unit: "ls", unitPrice: truckCostNum, subtotal: truckCostNum }] : []),
    ];

    await db.execute(sql`
      UPDATE customer_invoice_links
      SET subtotal = ${String(lineTotal)},
          tax_amount = ${String(ppn)},
          grand_total = ${String(newGrandTotal)},
          line_items = ${JSON.stringify(newLineItems)}::jsonb
      WHERE token = ${invoiceToken}
    `);
  }

  return res.json({
    success: true,
    shipmentCost: shipCostNum,
    truckCost: truckCostNum,
    invoiceUpdated: !!invoiceToken,
  });
});

// ── GET /api/portal-product/vendor-access/:orderNumber ──────────────────────
portalProductOrdersRouter.get("/vendor-access/:orderNumber", async (req: Request, res: Response) => {
  const orderNumber = req.params["orderNumber"] as string;
  const token = String(req.query["t"] ?? "").trim();
  if (!verifyVendorResponseToken(orderNumber, token)) {
    return res.status(403).json({ error: "Link tidak valid atau sudah kadaluarsa" });
  }

  const [order] = await db.select().from(portalProductOrdersTable)
    .where(eq(portalProductOrdersTable.orderNumber, orderNumber));
  if (!order) return res.status(404).json({ error: "Order tidak ditemukan" });

  const items = await db.select().from(portalProductOrderItemsTable)
    .where(eq(portalProductOrderItemsTable.orderId, order.id));

  const existing = await db.execute(sql`
    SELECT id FROM portal_product_vendor_responses WHERE order_number = ${orderNumber} LIMIT 1
  `);

  return res.json({
    orderNumber: order.orderNumber,
    customerName: order.customerName,
    shippingAddress: order.shippingAddress,
    notes: order.notes ?? null,
    grandTotal: parseFloat(order.grandTotal),
    productCategory: order.productCategory ?? null,
    customFieldValues: (order.customFieldValues ?? {}) as Record<string, string | number | boolean>,
    items: items.map(i => ({
      productName: i.productName,
      productSku: i.productSku ?? null,
      qty: i.qty,
      unit: i.unit ?? null,
      unitPrice: parseFloat(i.unitPrice),
      subtotal: parseFloat(i.subtotal),
    })),
    alreadySubmitted: (existing as unknown as { rows: unknown[] }).rows?.length > 0,
  });
});

// ── POST /api/portal-product/vendor-response/:orderNumber ───────────────────
portalProductOrdersRouter.post("/vendor-response/:orderNumber", async (req: Request, res: Response) => {
  const orderNumber = req.params["orderNumber"] as string;
  const { vendorName, vendorPhone, status, quotedPrice, notes, token } = req.body as Record<string, string>;

  const tok = String(token ?? String(req.query["t"] ?? "")).trim();
  if (!verifyVendorResponseToken(orderNumber, tok)) {
    return res.status(403).json({ error: "Link tidak valid atau sudah kadaluarsa" });
  }

  if (!status || !["SETUJU", "TOLAK"].includes(status)) {
    return res.status(400).json({ error: "Status harus SETUJU atau TOLAK" });
  }

  const [order] = await db.select({
    id: portalProductOrdersTable.id,
    customerName: portalProductOrdersTable.customerName,
  }).from(portalProductOrdersTable)
    .where(eq(portalProductOrdersTable.orderNumber, orderNumber));
  if (!order) return res.status(404).json({ error: "Order tidak ditemukan" });

  const qp = quotedPrice ? parseFloat(String(quotedPrice)) : null;
  const vPhone = vendorPhone?.trim() || null;

  await db.execute(sql`
    INSERT INTO portal_product_vendor_responses (order_number, order_id, vendor_name, vendor_phone, status, quoted_price, notes)
    VALUES (${orderNumber}, ${order.id}, ${vendorName ?? null}, ${vPhone}, ${status}, ${qp}, ${notes ?? null})
  `);

  const items = await db.select({
    productName: portalProductOrderItemsTable.productName,
    qty: portalProductOrderItemsTable.qty,
    unit: portalProductOrderItemsTable.unit,
    subtotal: portalProductOrderItemsTable.subtotal,
  }).from(portalProductOrderItemsTable)
    .where(eq(portalProductOrderItemsTable.orderId, order.id));

  const domain = getPreferredDomain() || "cstlogistic.co.id";
  const adminUrl = `https://${domain}/bizportal/logistics/portal-orders`;

  // Kirim WA konfirmasi ke vendor
  if (vPhone) {
    const { sendViaService } = await import("../lib/waTransport.js");
    const confirmMsg = status === "SETUJU"
      ? `✅ *Penawaran Diterima*\n\nHalo ${vendorName || "Vendor"}, terima kasih!\n\nPenawaran Anda untuk order *${orderNumber}* telah kami terima.${qp ? `\n💰 Harga: Rp ${formatRupiah(qp)}` : ""}${notes ? `\n📝 Catatan: ${notes}` : ""}\n\nTim kami akan segera menindaklanjuti. 🙏`
      : `❌ *Penolakan Diterima*\n\nHalo ${vendorName || "Vendor"}, kami telah menerima informasi bahwa Anda tidak dapat melayani order *${orderNumber}*.${notes ? `\n📝 Alasan: ${notes}` : ""}\n\nTerima kasih atas informasinya. 🙏`;
    sendViaService(vPhone, confirmMsg).catch((e: unknown) => logger.error({ e }, "WA vendor confirmation failed"));
  }

  // WA notifikasi ke admin
  sendProductVendorResponseAdminWa({
    orderNumber,
    customerName: order.customerName,
    vendorName: vendorName ?? "—",
    status: status as "SETUJU" | "TOLAK",
    quotedPrice: qp,
    notes: notes ?? null,
    items: items.map((i) => ({
      productName: i.productName,
      qty: i.qty,
      unit: i.unit ?? null,
      subtotal: parseFloat(i.subtotal),
    })),
    adminUrl,
  }).catch((err: unknown) => logger.error({ err }, "Failed to send admin WA for product vendor response"));

  // SSE broadcast ke admin
  broadcastToAdmins("vendor_response", {
    orderNumber,
    vendorName: vendorName ?? "—",
    status,
    quotedPrice: qp,
    submittedAt: new Date().toISOString(),
  });

  return res.json({ success: true });
});

// ── T005: Driver Assignment ───────────────────────────────────────────────────

// Idempotent migration: portal_product_order_id column on driver_jobs
db.execute(sql`
  ALTER TABLE driver_jobs ADD COLUMN IF NOT EXISTS portal_product_order_id INTEGER
`).catch(() => {});

// GET /api/portal-product/drivers — list active drivers (admin)
portalProductOrdersRouter.get("/drivers", requireClerkUser, async (_req: Request, res: Response) => {
  const rows = await db.select({
    id: driversTable.id,
    name: driversTable.name,
    phone: driversTable.phone,
    vehiclePlate: driversTable.vehiclePlate,
    vehicleType: driversTable.vehicleType,
  }).from(driversTable)
    .where(eq(driversTable.isActive, true))
    .orderBy(driversTable.name);
  return res.json({ drivers: rows });
});

// GET /api/portal-product/orders/:id/driver — get current driver job for order (admin)
portalProductOrdersRouter.get("/orders/:id/driver", requireClerkUser, async (req: Request, res: Response) => {
  const orderId = parseInt(String(req.params.id), 10);
  if (!orderId) return res.status(400).json({ error: "ID tidak valid" });

  const rows = await db.execute(sql`
    SELECT dj.id, dj.job_number, dj.status, dj.driver_name_override, dj.driver_phone_override,
           dj.vehicle_plate_override, dj.vehicle_type, dj.pickup_date_time, dj.delivery_date_time,
           dj.cargo_description, dj.assigned_at, dj.completed_at,
           d.name as driver_name, d.phone as driver_phone, d.vehicle_plate as driver_vehicle_plate
    FROM driver_jobs dj
    LEFT JOIN drivers d ON d.id = dj.driver_id
    WHERE dj.portal_product_order_id = ${orderId}
    ORDER BY dj.assigned_at DESC
    LIMIT 1
  `);

  const job = rows.rows[0] as Record<string, unknown> | undefined;
  if (!job) return res.json({ job: null });

  return res.json({
    job: {
      id: job.id,
      jobNumber: job.job_number,
      status: job.status,
      driverName: job.driver_name_override ?? job.driver_name ?? null,
      driverPhone: job.driver_phone_override ?? job.driver_phone ?? null,
      vehiclePlate: job.vehicle_plate_override ?? job.driver_vehicle_plate ?? null,
      vehicleType: job.vehicle_type ?? null,
      pickupDateTime: job.pickup_date_time ?? null,
      deliveryDateTime: job.delivery_date_time ?? null,
      cargoDescription: job.cargo_description ?? null,
      assignedAt: job.assigned_at ?? null,
      completedAt: job.completed_at ?? null,
    },
  });
});

// POST /api/portal-product/orders/:id/assign-driver — assign driver (admin)
portalProductOrdersRouter.post("/orders/:id/assign-driver", requireClerkUser, async (req: Request, res: Response) => {
  const orderId = parseInt(String(req.params.id), 10);
  if (!orderId) return res.status(400).json({ error: "ID tidak valid" });

  const {
    driverId,
    driverNameOverride,
    driverPhoneOverride,
    vehiclePlateOverride,
    vehicleType,
    pickupDateTime,
    deliveryDateTime,
    cargoDescription,
    specialInstruction,
  } = req.body as Record<string, string | number | undefined>;

  const [order] = await db.select({
    id: portalProductOrdersTable.id,
    orderNumber: portalProductOrdersTable.orderNumber,
    customerName: portalProductOrdersTable.customerName,
    shippingAddress: portalProductOrdersTable.shippingAddress,
  }).from(portalProductOrdersTable)
    .where(eq(portalProductOrdersTable.id, orderId));
  if (!order) return res.status(404).json({ error: "Order tidak ditemukan" });

  // Generate unique job number
  const jobNum = `PRDJ-${Date.now().toString(36).toUpperCase()}-${randomBytes(3).toString("hex").toUpperCase()}`;

  await db.execute(sql`
    INSERT INTO driver_jobs (
      portal_product_order_id, driver_id, job_number,
      customer_name, delivery_address,
      cargo_description, vehicle_type,
      pickup_date_time, delivery_date_time,
      special_instruction,
      driver_name_override, driver_phone_override, vehicle_plate_override,
      driver_type, execution_mode,
      status, assigned_at, created_at
    ) VALUES (
      ${orderId},
      ${driverId ? Number(driverId) : null},
      ${jobNum},
      ${order.customerName},
      ${order.shippingAddress ?? null},
      ${cargoDescription ?? null},
      ${vehicleType ?? null},
      ${pickupDateTime ? new Date(String(pickupDateTime)) : null},
      ${deliveryDateTime ? new Date(String(deliveryDateTime)) : null},
      ${specialInstruction ?? null},
      ${driverNameOverride ?? null},
      ${driverPhoneOverride ?? null},
      ${vehiclePlateOverride ?? null},
      'EXTERNAL',
      'DRIVER_APP',
      'ASSIGNED',
      NOW(),
      NOW()
    )
  `);

  // Update order status to Processing if still Confirmed
  await db.execute(sql`
    UPDATE portal_product_orders
    SET status = 'Processing'
    WHERE id = ${orderId} AND status = 'Confirmed'
  `);

  logger.info({ orderId, jobNum }, "Portal product order: driver assigned");
  return res.json({ success: true, jobNumber: jobNum });
});

// ── Phase 2B-1: Product-First Flow Endpoints ─────────────────────────────────

// GET /api/portal-product/product-approve/:token — data untuk halaman persetujuan produk
portalProductOrdersRouter.get("/product-approve/:token", async (req: Request, res: Response) => {
  const token = req.params["token"] as string;
  if (!token || token.length < 10) return res.status(400).json({ error: "Token tidak valid" });

  const result = await db.execute(sql`
    SELECT
      id, order_number, customer_name, status, order_type,
      product_approve_token, vendor_name_selected, vendor_quoted_price,
      ready_date, pickup_location, notes, created_at
    FROM portal_product_orders
    WHERE product_approve_token = ${token}
    LIMIT 1
  `);
  const row = result.rows[0] as any;
  if (!row) return res.status(404).json({ error: "Link tidak ditemukan atau sudah kadaluarsa" });

  const items = await db.execute(sql`
    SELECT product_name, qty, unit, unit_price, subtotal
    FROM portal_product_order_items
    WHERE order_id = ${row.id}
    ORDER BY id ASC
  `);

  const canApprove = row.status === "Customer Product Approval";
  const alreadyActed = ["Shipment Selection Pending", "Ready for Pickup", "Shipment RFQ Sent",
    "Vendor Confirmed", "In Progress", "Pickup", "In Transit", "Arrived", "Delivered",
    "POD Uploaded", "Invoice Issued", "Payment Received", "Completed"].includes(row.status);

  let actionLabel: string | null = null;
  if (row.status === "Admin Review") actionLabel = "Produk sudah ditolak dan sedang ditinjau ulang oleh admin.";
  else if (alreadyActed) actionLabel = "Produk sudah disetujui dan sedang diproses lebih lanjut.";

  const vendorQuotedPrice = row.vendor_quoted_price ? parseFloat(row.vendor_quoted_price) : null;

  return res.json({
    orderNumber: row.order_number,
    customerName: row.customer_name,
    status: row.status,
    orderType: row.order_type ?? "product_first",
    items: (items.rows as any[]).map(i => ({
      productName: i.product_name,
      qty: Number(i.qty),
      unit: i.unit ?? "pcs",
      unitPrice: parseFloat(i.unit_price),
      subtotal: parseFloat(i.subtotal),
    })),
    vendorName: row.vendor_name_selected ?? null,
    quotedPrice: vendorQuotedPrice,
    readyDate: row.ready_date ?? null,
    pickupLocation: row.pickup_location ?? null,
    notes: row.notes ?? null,
    createdAt: new Date(row.created_at).toISOString(),
    canApprove,
    alreadyActed,
    actionLabel,
  });
});

// POST /api/portal-product/orders/:token/customer-product-approve
portalProductOrdersRouter.post("/orders/:token/customer-product-approve", async (req: Request, res: Response) => {
  const token = req.params["token"] as string;
  const { action } = req.body as { action?: "approve" | "reject" };

  if (!token || token.length < 10) return res.status(400).json({ error: "Token tidak valid" });
  if (action !== "approve" && action !== "reject") return res.status(400).json({ error: "action harus approve atau reject" });

  const result = await db.execute(sql`
    SELECT id, order_number, status, customer_name, phone, order_type
    FROM portal_product_orders
    WHERE product_approve_token = ${token}
    LIMIT 1
  `);
  const row = result.rows[0] as any;
  if (!row) return res.status(404).json({ error: "Link tidak valid atau sudah kadaluarsa" });

  if (row.status !== "Customer Product Approval") {
    return res.status(409).json({ error: "Order tidak dalam status menunggu persetujuan produk" });
  }

  const newStatus = action === "approve" ? "Shipment Selection Pending" : "Admin Review";
  await db.execute(sql`
    UPDATE portal_product_orders
    SET status = ${newStatus}, updated_at = NOW()
    WHERE id = ${row.id}
  `);

  broadcastToAdmins("order_status_update", {
    orderNumber: row.order_number,
    status: newStatus,
    label: action === "approve" ? "Pilih Mode Pengiriman" : "Ditinjau Admin",
    source: "product_approve",
  });

  if (row.phone) {
    if (action === "approve") {
      // WA ke customer dengan link pilih pengiriman
      const domain = getPreferredDomain();
      const selectionUrl = domain && row.product_approve_token
        ? `https://${domain}/shipment-selection/${row.product_approve_token}`
        : null;
      sendShipmentSelectionCustomerWa({
        customerPhone: String(row.phone),
        customerName: row.customer_name,
        orderId: row.id,
        orderNumber: row.order_number,
        selectionUrl,
      });
    } else {
      const { sendViaService } = await import("../lib/waTransport.js");
      const rejectMsg = `ℹ️ *Produk Ditolak*\n\nHalo ${row.customer_name}, Anda menolak penawaran produk untuk order *${row.order_number}*.\n\nTim kami akan segera meninjau ulang dan menghubungi Anda.`;
      sendViaService(String(row.phone), rejectMsg, {
        context: "product-reject-customer",
        refType: "portal_product_order",
        refId: String(row.id),
      }).catch(() => undefined);
    }
  }

  logger.info({ orderId: row.id, action, newStatus }, "customer-product-approve");
  return res.json({ success: true, status: newStatus });
});

// GET /api/portal-product/shipment-selection/:token — data untuk halaman pilih pengiriman
portalProductOrdersRouter.get("/shipment-selection/:token", async (req: Request, res: Response) => {
  const token = req.params["token"] as string;
  if (!token || token.length < 10) return res.status(400).json({ error: "Token tidak valid" });

  const result = await db.execute(sql`
    SELECT id, order_number, customer_name, status, shipment_mode, grand_total
    FROM portal_product_orders
    WHERE product_approve_token = ${token}
    LIMIT 1
  `);
  const row = result.rows[0] as any;
  if (!row) return res.status(404).json({ error: "Link tidak valid atau sudah kadaluarsa" });

  const items = await db.execute(sql`
    SELECT product_name, qty, unit, subtotal
    FROM portal_product_order_items
    WHERE order_id = ${row.id}
    ORDER BY id ASC
  `);

  const canSelect = row.status === "Shipment Selection Pending";
  const totalProduct = (items.rows as any[]).reduce((s: number, i: any) => s + parseFloat(i.subtotal), 0);

  return res.json({
    orderNumber: row.order_number,
    customerName: row.customer_name,
    status: row.status,
    items: (items.rows as any[]).map(i => ({
      productName: i.product_name,
      qty: Number(i.qty),
      unit: i.unit ?? "pcs",
      subtotal: parseFloat(i.subtotal),
    })),
    totalProduct,
    canSelect,
    selectedMode: row.shipment_mode ?? null,
  });
});

// POST /api/portal-product/orders/:token/select-shipment-mode
portalProductOrdersRouter.post("/orders/:token/select-shipment-mode", async (req: Request, res: Response) => {
  const token = req.params["token"] as string;
  const { shipmentMode } = req.body as { shipmentMode?: string };

  const VALID_MODES = ["pickup_self", "trucking", "air_freight", "sea_freight", "door_to_door"];
  if (!token || token.length < 10) return res.status(400).json({ error: "Token tidak valid" });
  if (!shipmentMode || !VALID_MODES.includes(shipmentMode)) {
    return res.status(400).json({ error: `shipmentMode tidak valid. Pilihan: ${VALID_MODES.join(", ")}` });
  }

  const result = await db.execute(sql`
    SELECT id, order_number, status, customer_name, phone
    FROM portal_product_orders
    WHERE product_approve_token = ${token}
    LIMIT 1
  `);
  const row = result.rows[0] as any;
  if (!row) return res.status(404).json({ error: "Link tidak valid atau sudah kadaluarsa" });

  if (row.status !== "Shipment Selection Pending") {
    return res.status(409).json({ error: "Order tidak dalam status Shipment Selection Pending" });
  }

  const newStatus = shipmentMode === "pickup_self" ? "Ready for Pickup" : "Shipment RFQ Sent";
  await db.execute(sql`
    UPDATE portal_product_orders
    SET status = ${newStatus}, shipment_mode = ${shipmentMode}, shipping_method = ${shipmentMode}, updated_at = NOW()
    WHERE id = ${row.id}
  `);

  broadcastToAdmins("order_status_update", {
    orderNumber: row.order_number,
    status: newStatus,
    label: shipmentMode === "pickup_self" ? "Siap Diambil" : "RFQ Pengiriman Dikirim",
    shipmentMode,
    source: "shipment_selection",
  });

  if (row.phone) {
    if (shipmentMode === "pickup_self") {
      // WA ke customer — produk siap diambil
      sendReadyForPickupCustomerWa({
        customerPhone: String(row.phone),
        customerName: row.customer_name,
        orderId: row.id,
        orderNumber: row.order_number,
      });
    } else {
      // WA ke customer — konfirmasi pilihan pengiriman
      const { sendViaService } = await import("../lib/waTransport.js");
      const shipMsg = `🚚 *Pengiriman dalam Proses*\n\nHalo ${row.customer_name}, pilihan pengiriman Anda untuk order *${row.order_number}* sudah kami terima.\n\nTim kami akan mengirimkan penawaran pengiriman segera via WhatsApp ini.`;
      sendViaService(String(row.phone), shipMsg, {
        context: "shipment-mode-confirm-customer",
        refType: "portal_product_order",
        refId: String(row.id),
      }).catch(() => undefined);

      // WA ke admin group — customer pilih mode pengiriman
      sendShipmentModeSelectedAdminWa({
        orderId: row.id,
        orderNumber: row.order_number,
        customerName: row.customer_name,
        shipmentMode,
      });
    }
  }

  logger.info({ orderId: row.id, shipmentMode, newStatus }, "select-shipment-mode");
  return res.json({ success: true, status: newStatus, shipmentMode });
});

// ── Admin action: Blast Product RFQ ─────────────────────────────────────────
portalProductOrdersRouter.post("/admin/orders/:id/blast-product-rfq", async (req: Request, res: Response) => {
  if (!(await requireClerkUser(req, res))) return;
  const id = parseInt(String(String(req.params.id)), 10);
  if (isNaN(id)) return res.status(400).json({ error: "ID tidak valid" });

  const [order] = await db.select().from(portalProductOrdersTable).where(eq(portalProductOrdersTable.id, id));
  if (!order) return res.status(404).json({ error: "Order tidak ditemukan" });

  await db.execute(sql`
    UPDATE portal_product_orders SET status = 'Product RFQ Sent', updated_at = NOW() WHERE id = ${id}
  `);

  const { sendViaService } = await import("../lib/waTransport.js");
  const adminGroupWa = await getAdminGroupWa();
  const domain = getPreferredDomain();
  const adminUrl = domain ? `https://${domain}/bizportal/logistics/portal-orders` : undefined;
  const msg = `📤 *Product RFQ Dikirim*\n\nOrder: *${order.orderNumber}*\nCustomer: ${order.customerName}\n\nAdmin perlu mencari vendor untuk barang ini dan memasukkan penawaran produk.${adminUrl ? `\n\n🔗 ${adminUrl}` : ""}`;
  if (adminGroupWa) {
    sendViaService(adminGroupWa, msg, {
      context: "product-rfq-blast-admin",
      refType: "portal_product_order",
      refId: String(id),
    }).catch(() => undefined);
  }

  broadcastToAdmins("order_status_update", { orderNumber: order.orderNumber, status: "Product RFQ Sent", source: "admin_blast" });
  return res.json({ success: true, status: "Product RFQ Sent" });
});

// ── Admin action: Update Product Phase (vendor, price, ready date, pickup location) ─
portalProductOrdersRouter.post("/admin/orders/:id/update-product-phase", async (req: Request, res: Response) => {
  if (!(await requireClerkUser(req, res))) return;
  const id = parseInt(String(String(req.params.id)), 10);
  if (isNaN(id)) return res.status(400).json({ error: "ID tidak valid" });

  const { vendorName, quotedPrice, readyDate, pickupLocation, selectVendor } = req.body as {
    vendorName?: string;
    quotedPrice?: number | string;
    readyDate?: string;
    pickupLocation?: string;
    selectVendor?: boolean;
  };

  const [order] = await db.select().from(portalProductOrdersTable).where(eq(portalProductOrdersTable.id, id));
  if (!order) return res.status(404).json({ error: "Order tidak ditemukan" });

  const qp = quotedPrice != null ? parseFloat(String(quotedPrice)) : null;
  await db.execute(sql`
    UPDATE portal_product_orders SET
      vendor_name_selected = ${vendorName?.trim() ?? null},
      vendor_quoted_price = ${qp},
      ready_date = ${readyDate?.trim() ?? null},
      pickup_location = ${pickupLocation?.trim() ?? null},
      updated_at = NOW()
    WHERE id = ${id}
  `);

  let newStatus: string | null = null;
  if (selectVendor && vendorName?.trim()) {
    await db.execute(sql`
      UPDATE portal_product_orders SET status = 'Product Vendor Selected' WHERE id = ${id}
    `);
    newStatus = "Product Vendor Selected";
    broadcastToAdmins("order_status_update", { orderNumber: order.orderNumber, status: "Product Vendor Selected", source: "admin_update" });
  }

  return res.json({ success: true, status: newStatus });
});

// ── Admin action: Send Product Approval to Customer ─────────────────────────
portalProductOrdersRouter.post("/admin/orders/:id/send-product-approval", async (req: Request, res: Response) => {
  if (!(await requireClerkUser(req, res))) return;
  const id = parseInt(String(String(req.params.id)), 10);
  if (isNaN(id)) return res.status(400).json({ error: "ID tidak valid" });

  const result = await db.execute(sql`
    SELECT id, order_number, customer_name, phone, status, product_approve_token,
           vendor_name_selected, vendor_quoted_price, ready_date
    FROM portal_product_orders WHERE id = ${id} LIMIT 1
  `);
  const row = result.rows[0] as any;
  if (!row) return res.status(404).json({ error: "Order tidak ditemukan" });
  if (!row.product_approve_token) return res.status(400).json({ error: "Order ini bukan tipe product_first" });

  await db.execute(sql`
    UPDATE portal_product_orders SET status = 'Customer Product Approval', updated_at = NOW() WHERE id = ${id}
  `);

  const domain = getPreferredDomain();
  const approveUrl = domain ? `https://${domain}/product-approve/${row.product_approve_token}` : null;
  const qp = row.vendor_quoted_price ? `\n💰 Harga Produk: Rp ${formatRupiah(parseFloat(row.vendor_quoted_price))}` : "";
  const rd = row.ready_date ? `\n📅 Estimasi Siap: ${row.ready_date}` : "";
  const msg = `📦 *Persetujuan Produk*\n\nHalo ${row.customer_name}, vendor telah dipilih untuk pesanan Anda *${row.order_number}*.${qp}${rd}\n\nSilakan review dan setujui produk di link berikut:\n${approveUrl ?? "(link tidak tersedia)"}\n\nSetelah disetujui, Anda akan memilih mode pengiriman.`;

  if (row.phone) {
    const { sendViaService } = await import("../lib/waTransport.js");
    sendViaService(String(row.phone), msg, {
      context: "product-approval-send",
      refType: "portal_product_order",
      refId: String(id),
    }).catch(() => undefined);
  }

  broadcastToAdmins("order_status_update", { orderNumber: row.order_number, status: "Customer Product Approval", source: "admin_approval" });
  return res.json({ success: true, status: "Customer Product Approval", approveUrl });
});

// ── Admin action: Blast Shipment RFQ (guarded) ──────────────────────────────
portalProductOrdersRouter.post("/admin/orders/:id/blast-shipment-rfq", async (req: Request, res: Response) => {
  if (!(await requireClerkUser(req, res))) return;
  const id = parseInt(String(String(req.params.id)), 10);
  if (isNaN(id)) return res.status(400).json({ error: "ID tidak valid" });

  const result = await db.execute(sql`
    SELECT id, order_number, customer_name, phone, status,
           vendor_name_selected, ready_date, pickup_location, shipment_mode
    FROM portal_product_orders WHERE id = ${id} LIMIT 1
  `);
  const row = result.rows[0] as any;
  if (!row) return res.status(404).json({ error: "Order tidak ditemukan" });

  const missing: string[] = [];
  if (!row.vendor_name_selected) missing.push("Vendor produk belum dipilih");
  if (!row.ready_date) missing.push("Ready date belum diisi");
  if (!row.pickup_location) missing.push("Lokasi pickup belum diisi");
  if (!row.shipment_mode) missing.push("Mode pengiriman belum dipilih customer");
  if (row.shipment_mode === "pickup_self") missing.push("Shipment RFQ tidak diperlukan untuk Ambil Sendiri");
  if (missing.length > 0) return res.status(400).json({ error: "Data tidak lengkap", missing });

  await db.execute(sql`
    UPDATE portal_product_orders SET status = 'Shipment RFQ Sent', updated_at = NOW() WHERE id = ${id}
  `);

  const { sendViaService } = await import("../lib/waTransport.js");
  const adminGroupWa = await getAdminGroupWa();
  const domain = getPreferredDomain();
  const adminUrl = domain ? `https://${domain}/bizportal/logistics/portal-orders` : undefined;
  const modeLabel: Record<string, string> = {
    trucking: "Trucking (darat)", air_cargo: "Kargo Udara", sea_cargo: "Kargo Laut",
    door_to_door: "Door-to-Door", courier: "Kurir",
  };
  const msg = `🚢 *Shipment RFQ Dikirim*\n\nOrder: *${row.order_number}*\nCustomer: ${row.customer_name}\nVendor Produk: ${row.vendor_name_selected}\nMode: ${modeLabel[row.shipment_mode] ?? row.shipment_mode}\nPickup: ${row.pickup_location}\nSiap: ${row.ready_date}\n\nAdmin perlu mencari vendor pengiriman.${adminUrl ? `\n\n🔗 ${adminUrl}` : ""}`;
  if (adminGroupWa) {
    sendViaService(adminGroupWa, msg, {
      context: "shipment-rfq-blast-admin",
      refType: "portal_product_order",
      refId: String(id),
    }).catch(() => undefined);
  }

  broadcastToAdmins("order_status_update", { orderNumber: row.order_number, status: "Shipment RFQ Sent", source: "admin_shipment_rfq" });
  return res.json({ success: true, status: "Shipment RFQ Sent" });
});

// ── Admin action: Mark Ready for Pickup ─────────────────────────────────────
portalProductOrdersRouter.post("/admin/orders/:id/mark-ready-pickup", async (req: Request, res: Response) => {
  if (!(await requireClerkUser(req, res))) return;
  const id = parseInt(String(String(req.params.id)), 10);
  if (isNaN(id)) return res.status(400).json({ error: "ID tidak valid" });

  const [order] = await db.select().from(portalProductOrdersTable).where(eq(portalProductOrdersTable.id, id));
  if (!order) return res.status(404).json({ error: "Order tidak ditemukan" });

  await db.execute(sql`
    UPDATE portal_product_orders SET status = 'Ready for Pickup', updated_at = NOW() WHERE id = ${id}
  `);

  // WA ke customer — produk siap diambil
  const pickupPhone = (order as any).phone ?? null;
  const pickupLoc = (order as any).pickupLocation ?? null;
  const pickupReady = (order as any).readyDate ?? null;
  if (pickupPhone) {
    sendReadyForPickupCustomerWa({
      customerPhone: String(pickupPhone),
      customerName: order.customerName,
      orderId: id,
      orderNumber: order.orderNumber,
      pickupLocation: pickupLoc,
      readyDate: pickupReady,
    });
  }

  broadcastToAdmins("order_status_update", { orderNumber: order.orderNumber, status: "Ready for Pickup", source: "admin_mark_pickup" });
  return res.json({ success: true, status: "Ready for Pickup" });
});

// ── Admin action: Mark Shipment Vendor Confirmed ─────────────────────────────
portalProductOrdersRouter.post("/admin/orders/:id/mark-shipment-vendor-confirmed", async (req: Request, res: Response) => {
  if (!(await requireClerkUser(req, res))) return;
  const id = parseInt(String(String(req.params.id)), 10);
  if (isNaN(id)) return res.status(400).json({ error: "ID tidak valid" });

  const { vendorName, shipmentMode, eta } = req.body as {
    vendorName?: string;
    shipmentMode?: string;
    eta?: string;
  };

  const result = await db.execute(sql`
    SELECT id, order_number, customer_name, phone, shipment_mode
    FROM portal_product_orders WHERE id = ${id} LIMIT 1
  `);
  const row = result.rows[0] as any;
  if (!row) return res.status(404).json({ error: "Order tidak ditemukan" });

  await db.execute(sql`
    UPDATE portal_product_orders SET status = 'Vendor Confirmed', updated_at = NOW() WHERE id = ${id}
  `);

  // WA ke customer dan admin group
  sendShipmentVendorConfirmedWa({
    orderId: id,
    orderNumber: row.order_number,
    customerName: row.customer_name,
    customerPhone: row.phone ?? null,
    vendorName: vendorName?.trim() || "Vendor Pengiriman",
    shipmentMode: shipmentMode ?? row.shipment_mode ?? null,
    eta: eta?.trim() ?? null,
  });

  broadcastToAdmins("order_status_update", { orderNumber: row.order_number, status: "Vendor Confirmed", source: "admin_vendor_confirmed" });
  return res.json({ success: true, status: "Vendor Confirmed" });
});

// ── Admin action: Send Pickup Instruction WA ────────────────────────────────
portalProductOrdersRouter.post("/admin/orders/:id/send-pickup-instruction", async (req: Request, res: Response) => {
  if (!(await requireClerkUser(req, res))) return;
  const id = parseInt(String(String(req.params.id)), 10);
  if (isNaN(id)) return res.status(400).json({ error: "ID tidak valid" });

  const { customMessage } = req.body as { customMessage?: string };

  const result = await db.execute(sql`
    SELECT id, order_number, customer_name, phone, pickup_location, ready_date
    FROM portal_product_orders WHERE id = ${id} LIMIT 1
  `);
  const row = result.rows[0] as any;
  if (!row) return res.status(404).json({ error: "Order tidak ditemukan" });

  if (!row.phone) return res.status(400).json({ error: "Nomor telepon customer tidak tersedia" });

  const { sendViaService } = await import("../lib/waTransport.js");
  const loc = row.pickup_location ? `\n📍 Lokasi: ${row.pickup_location}` : "";
  const rd = row.ready_date ? `\n📅 Jadwal: ${row.ready_date}` : "";
  const msg = customMessage?.trim() ?? `📦 *Produk Siap Diambil*\n\nHalo ${row.customer_name}, pesanan Anda *${row.order_number}* sudah siap untuk diambil.${loc}${rd}\n\nHarap bawa bukti pemesanan Anda. Terima kasih! 🙏`;
  await sendViaService(String(row.phone), msg);

  return res.json({ success: true });
});

// ── Admin action: Send Shipment Selection Reminder WA ───────────────────────
portalProductOrdersRouter.post("/admin/orders/:id/send-shipment-reminder", async (req: Request, res: Response) => {
  if (!(await requireClerkUser(req, res))) return;
  const id = parseInt(String(String(req.params.id)), 10);
  if (isNaN(id)) return res.status(400).json({ error: "ID tidak valid" });

  const result = await db.execute(sql`
    SELECT id, order_number, customer_name, phone, product_approve_token
    FROM portal_product_orders WHERE id = ${id} LIMIT 1
  `);
  const row = result.rows[0] as any;
  if (!row) return res.status(404).json({ error: "Order tidak ditemukan" });
  if (!row.phone) return res.status(400).json({ error: "Nomor telepon customer tidak tersedia" });

  const domain = getPreferredDomain();
  const selUrl = domain && row.product_approve_token
    ? `https://${domain}/shipment-selection/${row.product_approve_token}`
    : null;

  const { sendViaService } = await import("../lib/waTransport.js");
  const msg = `🚚 *Pilih Mode Pengiriman*\n\nHalo ${row.customer_name}, produk untuk pesanan *${row.order_number}* sudah siap.\n\nSilakan pilih mode pengiriman Anda:${selUrl ? `\n${selUrl}` : "\n(link tidak tersedia)"}`;
  await sendViaService(String(row.phone), msg);

  return res.json({ success: true });
});
