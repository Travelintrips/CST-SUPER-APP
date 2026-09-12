import { Router, type Request, type Response } from "express";
import { randomUUID } from "crypto";
import { eq, and, inArray, sql } from "drizzle-orm";
import multer from "multer";
import {
  db,
  rfqVendorLinksTable,
  rfqActivityLogsTable,
  logisticOrderRfqsTable,
  logisticOrdersTable,
  logisticOrderItemsTable,
  suppliersTable,
  vendorCatalogItemsTable,
  freightShipmentsTable,
  vendorPerformanceTable,
  productTemplatesTable,
  portalCustomerProfilesTable,
  portalCustomersTable,
} from "@workspace/db";
import { resolveTemplate } from "@workspace/product-templates";
import { requireClerkUser } from "../lib/requireAdmin.js";
import { TAX_RATE_DECIMAL as PPN_RATE } from "../lib/taxHelper.js";
import { sendViaService as sendWhatsApp } from "../lib/waTransport.js";
import { getAdminGroupWa } from "../lib/adminWa.js";
import { getPreferredDomain } from "../lib/domain.js";
import { logger } from "../lib/logger.js";
import { ObjectStorageService } from "../lib/objectStorage.js";
import { createRateLimiter } from "../lib/userRateLimiter.js";
import { validateUploadFile } from "../lib/uploadValidation.js";
import {
  sendVendorRequestNotification,
  sendVendorRevisionNotification,
  sendVendorRevisionFallbackNotification,
  sendCustomerRfqResponseAdminNotification,
  sendCustomerApprovalNotification,
  getRfqVendorRecapTemplate,
  renderTemplate,
  sendVendorSelectedAdminWa,
  sendVendorAwardedWa,
  sendVendorNotSelectedWa,
  sendTruckAssignedCustomerWa,
  sendOpRequestNotification,
  type LogisticOrderData,
} from "../lib/orderNotification.js";

import {
  transitionLogisticOrderStatus,
} from "../lib/services/logisticOrderStatusService.js";
import {
  transitionRfqStatus,
  transitionVendorLinkStatus,
} from "../lib/services/rfqStatusService.js";

export const logisticRfqV2Router = Router();

function buildOrderData(order: typeof logisticOrdersTable.$inferSelect): LogisticOrderData {
  return {
    id: order.id,
    orderNumber: order.orderNumber,
    customerName: order.customerName,
    companyName: order.companyName ?? "",
    email: order.email,
    phone: order.phone,
    orderType: order.orderType ?? undefined,
    shipmentType: order.shipmentType,
    origin: order.origin,
    destination: order.destination,
    commodity: order.commodity ?? null,
    cargoDescription: order.cargoDescription ?? null,
    grossWeight: order.grossWeight ? Number(order.grossWeight) : null,
    volumeCbm: order.volumeCbm ? Number(order.volumeCbm) : null,
    jumlahKoli: order.jumlahKoli ?? null,
    grandTotal: order.grandTotal ? Number(order.grandTotal) : 0,
    serviceList: order.shipmentType,
    requiredDate: order.requiredDate ?? null,
    notes: order.notes ?? null,
    jamOrder: order.jamOrder ?? null,
    vehicleType: order.truckType ?? null,
    createdAt: order.createdAt ?? null,
    publicRfqToken: order.publicRfqToken ?? null,
  };
}

async function buildOrderDataWithItems(order: typeof logisticOrdersTable.$inferSelect): Promise<LogisticOrderData> {
  const base = buildOrderData(order);
  try {
    const items = await db.select({
      name: logisticOrderItemsTable.serviceName,
      inputData: logisticOrderItemsTable.inputData,
      subtotal: logisticOrderItemsTable.subtotal,
    }).from(logisticOrderItemsTable).where(eq(logisticOrderItemsTable.orderId, order.id));
    base.orderItems = items.map(i => {
      const input = (i.inputData as Record<string, unknown> | null) ?? {};
      const qtyRaw = input.qty ?? input.quantity ?? input.jumlah;
      return {
        name: i.name,
        qty: qtyRaw != null ? Number(qtyRaw) || null : null,
        unit: input.unit ? String(input.unit) : null,
        subtotal: i.subtotal ? parseFloat(i.subtotal) : null,
      };
    });
  } catch { /* non-critical, skip */ }
  return base;
}

const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 10 * 1024 * 1024 } });
const objectStorage = new ObjectStorageService();

// ── RFQ attachment upload — MIME whitelist & rate limiters ────────────────────
const RFQ_UPLOAD_ALLOWED_MIME = new Set([
  "image/jpeg", "image/jpg", "image/png", "image/webp",
  "application/pdf",
  "application/msword",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  "application/vnd.ms-excel",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
]);
const RFQ_UPLOAD_ALLOWED_EXT = new Set([
  "jpg", "jpeg", "png", "webp",
  "pdf", "doc", "docx", "xls", "xlsx",
]);
// Per-IP: max 10 uploads/hour to prevent mass abuse from a single address
const _rfqUploadIpLimiter = createRateLimiter({ windowMs: 60 * 60_000, limit: 10 });
// Per-token: max 10 uploads/hour to prevent a single vendor link being used as relay
const _rfqUploadTokenLimiter = createRateLimiter({ windowMs: 60 * 60_000, limit: 10 });

// ─── Migrations ────────────────────────────────────────────────────────────────
db.execute(sql`
  CREATE TABLE IF NOT EXISTS rfq_vendor_links (
    id SERIAL PRIMARY KEY,
    rfq_id INTEGER NOT NULL REFERENCES logistic_order_rfqs(id) ON DELETE CASCADE,
    vendor_id INTEGER NOT NULL REFERENCES suppliers(id) ON DELETE CASCADE,
    token TEXT NOT NULL UNIQUE,
    status TEXT NOT NULL DEFAULT 'waiting_response',
    basic_price NUMERIC(14,2),
    offered_price NUMERIC(14,2),
    eta TEXT,
    notes TEXT,
    attachment_url TEXT,
    is_new_update BOOLEAN NOT NULL DEFAULT FALSE,
    opened_at TIMESTAMPTZ,
    submitted_at TIMESTAMPTZ,
    last_updated_at TIMESTAMPTZ,
    expired_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
  )
`).catch((e: unknown) => logger.warn({ e }, "rfq_vendor_links migration warn"));

db.execute(sql`
  CREATE INDEX IF NOT EXISTS rfq_vendor_links_token_idx ON rfq_vendor_links (token)
`).catch((e: unknown) => logger.warn({ e }, "rfq_vendor_links token index warn"));

db.execute(sql`
  CREATE INDEX IF NOT EXISTS rfq_vendor_links_rfq_id_idx ON rfq_vendor_links (rfq_id)
`).catch((e: unknown) => logger.warn({ e }, "rfq_vendor_links rfq_id index warn"));

db.execute(sql`
  CREATE TABLE IF NOT EXISTS rfq_activity_logs (
    id SERIAL PRIMARY KEY,
    rfq_id INTEGER NOT NULL,
    actor_type TEXT NOT NULL,
    actor_id TEXT,
    actor_name TEXT,
    action TEXT NOT NULL,
    description TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
  )
`).catch((e: unknown) => logger.warn({ e }, "rfq_activity_logs migration warn"));

// Migrate RFQ status: rename 'open' default → support new status values
// Valid status: admin_review | vendor_blasted | vendor_selected | customer_quoted
//               customer_approved | customer_revision_requested | customer_rejected | closed
db.execute(sql`
  DO $$
  BEGIN
    -- Add customer_response_notes
    IF NOT EXISTS (
      SELECT 1 FROM information_schema.columns
      WHERE table_name='logistic_order_rfqs' AND column_name='customer_response_notes'
    ) THEN
      ALTER TABLE logistic_order_rfqs ADD COLUMN customer_response_notes TEXT;
    END IF;

    -- Add customer_responded_at
    IF NOT EXISTS (
      SELECT 1 FROM information_schema.columns
      WHERE table_name='logistic_order_rfqs' AND column_name='customer_responded_at'
    ) THEN
      ALTER TABLE logistic_order_rfqs ADD COLUMN customer_responded_at TIMESTAMPTZ;
    END IF;
  END $$;
`).catch((e: unknown) => logger.warn({ e }, "rfq customer response migration warn"));

db.execute(sql`
  DO $$
  BEGIN
    -- Add response_deadline if missing (older schema)
    IF NOT EXISTS (
      SELECT 1 FROM information_schema.columns
      WHERE table_name='logistic_order_rfqs' AND column_name='response_deadline'
    ) THEN
      ALTER TABLE logistic_order_rfqs ADD COLUMN response_deadline TIMESTAMPTZ;
    END IF;

    -- Add basic_price to rfq for initial admin estimate
    IF NOT EXISTS (
      SELECT 1 FROM information_schema.columns
      WHERE table_name='logistic_order_rfqs' AND column_name='basic_price'
    ) THEN
      ALTER TABLE logistic_order_rfqs ADD COLUMN basic_price NUMERIC(14,2);
    END IF;

    -- Rename any 'open' status rows to 'admin_review' (migration)
    UPDATE logistic_order_rfqs SET status = 'admin_review'
      WHERE status = 'open';

    -- Change default for new rows
    ALTER TABLE logistic_order_rfqs ALTER COLUMN status SET DEFAULT 'admin_review';

    -- Add customer quote fields
    IF NOT EXISTS (
      SELECT 1 FROM information_schema.columns
      WHERE table_name='logistic_order_rfqs' AND column_name='quoted_price'
    ) THEN
      ALTER TABLE logistic_order_rfqs ADD COLUMN quoted_price NUMERIC(14,2);
    END IF;

    IF NOT EXISTS (
      SELECT 1 FROM information_schema.columns
      WHERE table_name='logistic_order_rfqs' AND column_name='quoted_at'
    ) THEN
      ALTER TABLE logistic_order_rfqs ADD COLUMN quoted_at TIMESTAMPTZ;
    END IF;

    IF NOT EXISTS (
      SELECT 1 FROM information_schema.columns
      WHERE table_name='logistic_order_rfqs' AND column_name='quote_notes'
    ) THEN
      ALTER TABLE logistic_order_rfqs ADD COLUMN quote_notes TEXT;
    END IF;
  END $$;
`).catch((e: unknown) => logger.warn({ e }, "rfq status migration warn"));

// Migration: add freight_shipment_id to logistic_order_rfqs
db.execute(sql`
  ALTER TABLE logistic_order_rfqs
    ADD COLUMN IF NOT EXISTS freight_shipment_id INTEGER;
`).catch((e: unknown) => logger.warn({ e }, "rfq freight_shipment_id migration warn"));

// Migration: per-item vendor offers table (Step 11)
db.execute(sql`
  CREATE TABLE IF NOT EXISTS rfq_vendor_item_offers (
    id SERIAL PRIMARY KEY,
    rfq_vendor_link_id INTEGER NOT NULL REFERENCES rfq_vendor_links(id) ON DELETE CASCADE,
    order_item_id INTEGER,
    service_name TEXT NOT NULL,
    offered_price NUMERIC(14,2),
    currency TEXT DEFAULT 'IDR',
    schedule_etd TEXT,
    schedule_eta TEXT,
    lead_time_days INTEGER,
    validity_date TEXT,
    terms TEXT,
    notes TEXT,
    attachment_url TEXT,
    created_at TIMESTAMPTZ DEFAULT NOW()
  )
`).catch((e: unknown) => logger.warn({ e }, "rfq_vendor_item_offers migration warn"));

// Migration: add currency, validity_date, terms to rfq_vendor_links (Step 11)
db.execute(sql.raw(`
  ALTER TABLE rfq_vendor_links
    ADD COLUMN IF NOT EXISTS currency TEXT DEFAULT 'IDR',
    ADD COLUMN IF NOT EXISTS validity_date TEXT,
    ADD COLUMN IF NOT EXISTS terms TEXT
`)).catch((e: unknown) => logger.warn({ e }, "rfq_vendor_links extra cols migration warn"));

// ─── Helpers ──────────────────────────────────────────────────────────────────
function getVendorFormUrl(token: string): string {
  const domain = getPreferredDomain();
  if (!domain) return "";
  return `https://${domain}/vendor-form/${encodeURIComponent(token)}`;
}

function getComparisonUrl(rfqId: number): string {
  const domain = getPreferredDomain();
  if (!domain) return "";
  return `https://${domain}/bizportal/logistics/rfq/${rfqId}/comparison`;
}

const fmtRp = (n: number | string | null | undefined) =>
  n == null ? "—" : `Rp ${Math.round(Number(n)).toLocaleString("id-ID")}`;

const STATUS_LABEL: Record<string, string> = {
  waiting_response: "Menunggu",
  accepted_basic_price: "Terima Harga",
  counter_offer: "Counter Offer",
  rejected: "Tolak",
  expired: "Kadaluarsa",
  selected: "Dipilih",
  not_selected: "Tidak Dipilih",
  late_response: "Terlambat",
};

async function logActivity(
  rfqId: number,
  actorType: string,
  actorName: string,
  action: string,
  description: string,
) {
  await db.insert(rfqActivityLogsTable).values({ rfqId, actorType, actorName, action, description }).catch(() => {});
}

async function sendAdminRecapWa(
  rfqId: number,
  rfq: { rfqNumber: string; orderId: number },
  submitter?: {
    vendorName: string;
    action: "accept" | "counter" | "reject";
    priceStr: string;
    eta?: string | null;
    notes?: string | null;
    isUpdate: boolean;
  },
) {
  const adminTarget = await getAdminGroupWa();
  if (!adminTarget) return;

  const [[order], rawItems] = await Promise.all([
    db.select({
      orderNumber: logisticOrdersTable.orderNumber,
      customerName: logisticOrdersTable.customerName,
      companyName: logisticOrdersTable.companyName,
      shipmentType: logisticOrdersTable.shipmentType,
      origin: logisticOrdersTable.origin,
      destination: logisticOrdersTable.destination,
    }).from(logisticOrdersTable).where(eq(logisticOrdersTable.id, rfq.orderId)),
    db.select({
      serviceName: logisticOrderItemsTable.serviceName,
      inputData: logisticOrderItemsTable.inputData,
      subtotal: logisticOrderItemsTable.subtotal,
    }).from(logisticOrderItemsTable).where(eq(logisticOrderItemsTable.orderId, rfq.orderId)),
  ]);

  // Build items block: nama, qty, unit, harga jual, subtotal
  const fmtRpLocal = (n: number) => `Rp ${Math.round(n).toLocaleString("id-ID")}`;
  let itemsBlock: string | null = null;
  if (rawItems.length > 0) {
    const lines = rawItems.map((i, idx) => {
      const input = (i.inputData as Record<string, unknown> | null) ?? {};
      const qty = input.qty != null ? Number(input.qty) : null;
      const unit = input.unit ? String(input.unit) : null;
      const subtotal = i.subtotal ? parseFloat(i.subtotal) : null;
      const qtyStr = qty != null ? `${qty}${unit ? ` ${unit}` : ""}` : null;
      const parts = [`${idx + 1}. ${i.serviceName}`];
      if (qtyStr) parts.push(`   Qty: ${qtyStr}`);
      if (subtotal != null && subtotal > 0) {
        if (qty != null && qty > 1) {
          const unitPrice = subtotal / qty;
          parts.push(`   Harga: ${fmtRpLocal(unitPrice)}/${unit ?? "unit"}`);
          parts.push(`   Total: ${fmtRpLocal(subtotal)}`);
        } else {
          parts.push(`   Total: ${fmtRpLocal(subtotal)}`);
        }
      }
      return parts.join("\n");
    });
    itemsBlock = `🛒 *Item Order:*\n${lines.join("\n\n")}`;
  }

  const links = await db.select().from(rfqVendorLinksTable)
    .where(eq(rfqVendorLinksTable.rfqId, rfqId))
    .orderBy(sql`COALESCE(offered_price, basic_price) ASC NULLS LAST, created_at ASC`);

  const vendorIds = links.map((l) => l.vendorId);
  const vendors = vendorIds.length
    ? await db.select({ id: suppliersTable.id, name: suppliersTable.name })
        .from(suppliersTable).where(inArray(suppliersTable.id, vendorIds))
    : [];
  const vendorMap = new Map(vendors.map((v) => [v.id, v.name]));

  const answered = links.filter((l) => l.submittedAt && l.status !== "waiting_response" && l.status !== "expired");
  const waiting = links.filter((l) => !l.submittedAt && l.status === "waiting_response");
  const rejected = links.filter((l) => l.status === "rejected");
  const sorted = [
    ...answered.filter((l) => l.status !== "rejected").sort((a, b) =>
      Number(a.offeredPrice ?? a.basicPrice ?? 9e9) - Number(b.offeredPrice ?? b.basicPrice ?? 9e9)
    ),
    ...rejected,
  ];

  let listStr = "";
  sorted.forEach((l, i) => {
    const name = vendorMap.get(l.vendorId) ?? `Vendor #${l.vendorId}`;
    const price = l.offeredPrice ?? l.basicPrice;
    const eta = l.eta ? ` — ETA ${l.eta}` : "";
    const stLabel = STATUS_LABEL[l.status] ?? l.status;
    listStr += `${i + 1}. ${name} — ${fmtRp(price)}${eta} — ${stLabel}\n`;
  });

  let waitingStr = "";
  waiting.forEach((l) => {
    waitingStr += `- ${vendorMap.get(l.vendorId) ?? `Vendor #${l.vendorId}`}\n`;
  });

  const compLink = getComparisonUrl(rfqId);

  // Generate compare_vendors mini-form link (no-login) when there is at least one vendor response
  let compareAdminLink = compLink;
  if (answered.length > 0) {
    try {
      const { createAdminActionLink, getAdminActionUrl } = await import("./adminAction.js");
      const { generateShortLink } = await import("../lib/shortLink.js");
      const cmpToken = await createAdminActionLink(rfq.orderId, "compare_vendors", rfqId, 72);
      const cmpUrl = getAdminActionUrl(cmpToken);
      compareAdminLink = await generateShortLink(cmpUrl, { context: "admin_action", refType: "rfq", refId: String(rfqId) });
    } catch (e) {
      logger.warn({ e }, "sendAdminRecapWa: gagal generate compare_vendors link");
    }
  }

  // Build submitter info block jika ada
  let newSubmitterInfo: string | null = null;
  if (submitter) {
    const emoji = submitter.isUpdate ? "📝" : "📩";
    const tag = submitter.isUpdate ? "UPDATE" : "BARU";
    const actionLabel = submitter.action === "accept" ? "Terima Harga Dasar"
      : submitter.action === "counter" ? "Counter Offer"
      : "Tolak";
    const lines = [
      `${emoji} *[${tag}]* Vendor *${submitter.vendorName}*`,
      `Aksi: ${actionLabel} — 💰 ${submitter.priceStr}`,
    ];
    if (submitter.eta) lines.push(`ETA: ${submitter.eta}`);
    if (submitter.notes) lines.push(`Catatan: ${submitter.notes}`);
    newSubmitterInfo = lines.join("\n");
  }

  const customerDisplay = order
    ? (order.companyName ? `${order.customerName ?? ""} (${order.companyName})` : (order.customerName ?? "—"))
    : "—";

  const tplRfqRecap = await getRfqVendorRecapTemplate();
  const vendorListWithHeader = listStr ? `📋 *Daftar penawaran:*\n${listStr.trimEnd()}` : null;
  const waitingListWithHeader = waitingStr ? `⏳ *Belum jawab:*\n${waitingStr.trimEnd()}` : null;
  const msg = renderTemplate(tplRfqRecap, {
    orderNumber: order?.orderNumber ?? null,
    customerName: customerDisplay,
    rfqNumber: rfq.rfqNumber,
    shipmentType: order?.shipmentType ?? "—",
    route: order ? `${order.origin ?? ""} → ${order.destination ?? ""}` : "—",
    itemsBlock,
    newSubmitterInfo,
    vendorListWithHeader,
    waitingListWithHeader,
    compareLink: compareAdminLink,
    timestamp: new Date().toLocaleString("id-ID", { timeZone: "Asia/Jakarta" }),
  });

  sendWhatsApp(adminTarget, msg).catch((e: unknown) =>
    logger.error({ e }, "sendAdminRecapWa failed")
  );
}

// ─── ADMIN: GET /rfq/list ─────────────────────────────────────────────────────
// Daftar semua RFQ untuk admin dashboard, diurutkan terbaru dulu
logisticRfqV2Router.get("/rfq/list", async (req: Request, res: Response) => {
  if (!(await requireClerkUser(req, res))) return;

  const { status, limit = "50", offset = "0" } = req.query as Record<string, string>;

  let query = db
    .select({
      rfqId: logisticOrderRfqsTable.id,
      rfqNumber: logisticOrderRfqsTable.rfqNumber,
      rfqStatus: logisticOrderRfqsTable.status,
      responseDeadline: logisticOrderRfqsTable.responseDeadline,
      createdAt: logisticOrderRfqsTable.createdAt,
      orderId: logisticOrdersTable.id,
      orderNumber: logisticOrdersTable.orderNumber,
      customerName: logisticOrdersTable.customerName,
      serviceType: logisticOrdersTable.shipmentType,
      origin: logisticOrdersTable.origin,
      destination: logisticOrdersTable.destination,
    })
    .from(logisticOrderRfqsTable)
    .innerJoin(logisticOrdersTable, eq(logisticOrderRfqsTable.orderId, logisticOrdersTable.id))
    .orderBy(sql`${logisticOrderRfqsTable.createdAt} DESC`)
    .limit(Math.min(Number(limit) || 50, 200))
    .offset(Number(offset) || 0);

  if (status) {
    (query as any).where(eq(logisticOrderRfqsTable.status, status));
  }

  const rows = await query;

  // Attach vendor link stats per RFQ
  const rfqIds = rows.map((r) => r.rfqId);
  const allLinks = rfqIds.length
    ? await db.select({ rfqId: rfqVendorLinksTable.rfqId, status: rfqVendorLinksTable.status })
        .from(rfqVendorLinksTable).where(inArray(rfqVendorLinksTable.rfqId, rfqIds))
    : [];

  const linksByRfq = new Map<number, typeof allLinks>();
  for (const l of allLinks) {
    if (!linksByRfq.has(l.rfqId)) linksByRfq.set(l.rfqId, []);
    linksByRfq.get(l.rfqId)!.push(l);
  }

  const result = rows.map((r) => {
    const links = linksByRfq.get(r.rfqId) ?? [];
    return {
      ...r,
      responseDeadline: r.responseDeadline?.toISOString() ?? null,
      createdAt: r.createdAt.toISOString(),
      comparisonUrl: `/logistics/rfq/${r.rfqId}/comparison`,
      vendorStats: {
        total: links.length,
        waiting: links.filter((l) => l.status === "waiting_response").length,
        answered: links.filter((l) => ["accepted_basic_price", "counter_offer", "selected", "not_selected", "late_response"].includes(l.status)).length,
        rejected: links.filter((l) => l.status === "rejected").length,
        expired: links.filter((l) => l.status === "expired").length,
      },
    };
  });

  return res.json(result);
});

// ─── ADMIN: POST /rfq/create-from-order/:orderId ──────────────────────────────
// Buat RFQ baru dari order yang sudah ada, status awal = admin_review
logisticRfqV2Router.post("/rfq/create-from-order/:orderId", async (req: Request, res: Response) => {
  if (!(await requireClerkUser(req, res))) return;
  const orderId = parseInt(String(req.params.orderId), 10);
  if (isNaN(orderId)) return res.status(400).json({ message: "orderId tidak valid" });

  const [order] = await db.select().from(logisticOrdersTable).where(eq(logisticOrdersTable.id, orderId));
  if (!order) return res.status(404).json({ message: "Order tidak ditemukan" });

  // ── C2 Guard: product_first wajib selesai product phase sebelum shipment RFQ ─
  if ((order as any).orderType === "product_first") {
    const o = order as any;
    const missing: string[] = [];
    if (!o.productVendorId)           missing.push("product_vendor_id (vendor produk belum dipilih)");
    if (!o.customerProductApprovedAt) missing.push("customer_product_approved_at (customer belum approve produk)");
    if (!o.productReadyDate)          missing.push("product_ready_date (tanggal siap produk belum diisi)");
    if (!o.productPickupLocation)     missing.push("product_pickup_location (lokasi pickup belum diisi)");
    if (!o.shipmentMode)              missing.push("shipment_mode (mode pengiriman belum dipilih)");
    if (missing.length > 0) {
      return res.status(422).json({
        message: "Product phase belum selesai. Shipment RFQ hanya bisa dibuat setelah vendor produk confirmed, customer approve produk, ready date, pickup location, dan shipment mode tersedia.",
        missingFields: missing,
      });
    }
  }
  // ────────────────────────────────────────────────────────────────────────────

  const { notes, responseDeadlineHours, basicPrice } = req.body as {
    notes?: string;
    responseDeadlineHours?: number;
    basicPrice?: number;
  };

  // Generate RFQ number
  const now = new Date();
  const y = now.getFullYear();
  const m = String(now.getMonth() + 1).padStart(2, "0");
  const d = String(now.getDate()).padStart(2, "0");
  const rand = Math.floor(Math.random() * 9000) + 1000;
  const rfqNumber = `RFQ/${y}${m}${d}/${rand}`;

  const responseDeadline = responseDeadlineHours
    ? new Date(Date.now() + responseDeadlineHours * 60 * 60 * 1000)
    : null;

  // Step 2: Resolve template snapshot dari order.categoryKey untuk disimpan di RFQ
  const orderCategoryKey = (order as any).categoryKey as string | null | undefined;
  let rfqTemplateId: number | null = null;
  let rfqTemplateVersion: string | null = null;
  let rfqTemplateSnapshot: Record<string, unknown> | null = null;
  if (orderCategoryKey) {
    try {
      const [tRow] = await db.select().from(productTemplatesTable)
        .where(eq(productTemplatesTable.categoryKey, orderCategoryKey));
      const override = tRow ? {
        categoryKey: tRow.categoryKey, label: tRow.label, version: tRow.version,
        isActive: tRow.isActive,
        requiredDocuments: tRow.requiredDocuments as any,
        checklist: tRow.checklist as any,
        customFields: tRow.customFields as any,
        packagingInstructions: tRow.packagingInstructions ?? undefined,
        conditionalRules: tRow.conditionalRules as any,
        validationRules: tRow.validationRules as any,
      } : null;
      const tpl = resolveTemplate(orderCategoryKey, override);
      rfqTemplateId = tRow?.id ?? null;
      rfqTemplateVersion = tpl.version;
      rfqTemplateSnapshot = tpl as unknown as Record<string, unknown>;
    } catch (e) {
      console.warn("[create-from-order] template resolve warn:", e);
    }
  }

  const [rfq] = await db.insert(logisticOrderRfqsTable).values({
    orderId,
    rfqNumber,
    status: "admin_review",
    notes: notes ?? null,
    responseDeadline: responseDeadline ?? undefined,
    ...(rfqTemplateId ? {
      templateId: rfqTemplateId,
      templateVersion: rfqTemplateVersion,
      templateSnapshot: rfqTemplateSnapshot,
    } : {}),
  } as any).returning();

  const user = (req as any).user;
  await logActivity(rfq.id, "admin", user?.name ?? "Admin", "rfq_created",
    `RFQ ${rfqNumber} dibuat oleh admin untuk order ${order.orderNumber}`);

  return res.status(201).json({
    rfqId: rfq.id,
    rfqNumber: rfq.rfqNumber,
    status: rfq.status,
    orderId,
    orderNumber: order.orderNumber,
    customerName: order.customerName,
    comparisonUrl: getComparisonUrl(rfq.id),
  });
});

// ─── PUBLIC: GET /vendor-form/:token ─────────────────────────────────────────
logisticRfqV2Router.get("/vendor-form/:token", async (req: Request, res: Response) => {
  const token = String(req.params.token ?? "").trim() || undefined;
  if (!token) return res.status(400).json({ message: "Token tidak valid" });

  const [link] = await db.select().from(rfqVendorLinksTable)
    .where(eq(rfqVendorLinksTable.token, token));
  if (!link) return res.status(404).json({ message: "Link tidak valid atau sudah kadaluarsa" });

  if (link.expiredAt && link.expiredAt < new Date() && link.status === "waiting_response") {
    await transitionVendorLinkStatus(link.id, "expired", { actorType: "system", actorName: "system", source: "vendor-form/lazy-expire", force: true });
    return res.status(410).json({ message: "Link sudah kadaluarsa" });
  }
  if (link.status === "expired") return res.status(410).json({ message: "Link sudah kadaluarsa" });

  if (!link.openedAt) {
    await db.update(rfqVendorLinksTable).set({ openedAt: new Date() })
      .where(eq(rfqVendorLinksTable.id, link.id)).catch(() => {});
  }

  // Use raw SQL to include freight_shipment_id (added via migration, not in Drizzle schema)
  const rfqRows = await db.execute(sql`
    SELECT *, freight_shipment_id FROM logistic_order_rfqs WHERE id = ${link.rfqId}
  `);
  const rfqRaw = rfqRows.rows?.[0] as Record<string, unknown> | undefined;
  if (!rfqRaw) return res.status(404).json({ message: "RFQ tidak ditemukan" });

  const rfqId = Number(rfqRaw.id);
  const rfqNumber = String(rfqRaw.rfq_number ?? "");
  const orderId = Number(rfqRaw.order_id);
  const freightShipmentId: number | null = rfqRaw.freight_shipment_id
    ? Number(rfqRaw.freight_shipment_id) : null;
  const rfqResponseDeadline = rfqRaw.response_deadline
    ? new Date(rfqRaw.response_deadline as string) : null;

  const [order] = await db.select().from(logisticOrdersTable)
    .where(eq(logisticOrdersTable.id, orderId));
  if (!order) return res.status(404).json({ message: "Order tidak ditemukan" });

  const [vendor] = await db.select({ name: suppliersTable.name })
    .from(suppliersTable).where(eq(suppliersTable.id, link.vendorId));

  // Fetch order items + vendor's own catalog items (for price reference per etalase)
  const [orderItems, vendorCatalog] = await Promise.all([
    db.select({
      id: logisticOrderItemsTable.id,
      serviceName: logisticOrderItemsTable.serviceName,
      category: logisticOrderItemsTable.category,
      calculatorType: logisticOrderItemsTable.calculatorType,
      inputData: logisticOrderItemsTable.inputData,
      subtotal: logisticOrderItemsTable.subtotal,
    }).from(logisticOrderItemsTable).where(eq(logisticOrderItemsTable.orderId, orderId)),
    db.select().from(vendorCatalogItemsTable)
      .where(and(eq(vendorCatalogItemsTable.vendorId, link.vendorId), eq(vendorCatalogItemsTable.isActive, true))),
  ]);

  // Fallback to freight shipment data when order fields are empty
  let serviceType = order.shipmentType ?? "";
  let origin = order.origin ?? "";
  let destination = order.destination ?? "";
  let commodity = order.commodity ?? null;
  let cargoDescription = order.cargoDescription ?? null;
  let grossWeight = order.grossWeight ? parseFloat(order.grossWeight) : null;
  let volumeCbm = order.volumeCbm ? parseFloat(order.volumeCbm) : null;

  if (freightShipmentId && (!origin || !destination || !serviceType)) {
    const [shipment] = await db.select().from(freightShipmentsTable)
      .where(eq(freightShipmentsTable.id, freightShipmentId));
    if (shipment) {
      if (!origin) origin = shipment.origin ?? "";
      if (!destination) destination = shipment.destination ?? "";
      if (!serviceType) serviceType = shipment.transportMode ?? shipment.cargoType ?? "Freight";
      if (!commodity) commodity = shipment.commodity ?? null;
      if (!cargoDescription) cargoDescription = shipment.packingType ?? null;
      if (grossWeight == null && shipment.grossWeight) grossWeight = parseFloat(shipment.grossWeight);
    }
  }

  // Derive serviceType from order items if still empty
  if (!serviceType && orderItems.length > 0) {
    const uniqueCategories = [...new Set(orderItems.map((i) => i.category).filter(Boolean))];
    serviceType = uniqueCategories.join(", ");
  }

  // Extract origin/destination from item inputData for trucking items
  if ((!origin || !destination) && orderItems.length > 0) {
    for (const item of orderItems) {
      const input = item.inputData as Record<string, unknown> | null;
      if (!origin && input?.origin) origin = String(input.origin);
      if (!destination && input?.destination) destination = String(input.destination);
      if (origin && destination) break;
    }
  }

  // Fetch extra fields + existing item offers for this link (Step 11)
  const [linkExtrasRes, existingItemOffersRes] = await Promise.all([
    db.execute(sql`SELECT currency, validity_date, terms FROM rfq_vendor_links WHERE id = ${link.id}`)
      .catch(() => ({ rows: [] as unknown[] })),
    db.execute(sql`SELECT * FROM rfq_vendor_item_offers WHERE rfq_vendor_link_id = ${link.id} ORDER BY created_at ASC`)
      .catch(() => ({ rows: [] as unknown[] })),
  ]);
  const linkExtras = (linkExtrasRes.rows[0] ?? {}) as Record<string, unknown>;
  const existingItemOffers = existingItemOffersRes.rows as Record<string, unknown>[];

  // Hitung basicPrice dari katalog vendor (harga etalase vendor itu sendiri)
  const basicPrice: number | null = (() => {
    if (vendorCatalog.length === 0) return null;

    // Prioritas 1: cocokkan berdasarkan nama order item (paling spesifik, untuk product orders)
    if (orderItems.length > 0) {
      for (const item of orderItems) {
        const itemName = (item.serviceName || item.category || "").trim();
        if (!itemName) continue;
        const n = itemName.toLowerCase();
        const matched = vendorCatalog.find((c) => {
          const cn = c.name.toLowerCase();
          return cn === n || cn.includes(n) || n.includes(cn);
        });
        if (matched) return Number(matched.priceBase);
      }
    }

    // Prioritas 2: cocokkan berdasarkan serviceType (untuk freight/trucking orders)
    const svcMatch = serviceType
      ? vendorCatalog.find((c) => {
          const cn = c.name.toLowerCase();
          const st = serviceType.toLowerCase();
          return cn.includes(st) || st.includes(cn);
        })
      : null;

    // Jangan fallback ke item pertama jika tidak ada match — return null (lebih aman)
    return svcMatch ? Number(svcMatch.priceBase) : null;
  })();

  // Helper: cocokkan item order dengan katalog vendor berdasarkan nama
  function matchCatalogItem(name: string) {
    if (!name || vendorCatalog.length === 0) return null;
    const n = name.toLowerCase().trim();
    return (
      vendorCatalog.find((c) => {
        const cn = c.name.toLowerCase();
        return cn === n || cn.includes(n) || n.includes(cn);
      }) ?? null
    );
  }

  return res.json({
    linkId: link.id,
    rfqNumber,
    vendorName: vendor?.name ?? `Vendor #${link.vendorId}`,
    orderType: (() => {
      if (order.orderType) return order.orderType;
      // Derive dari orderItems jika order.orderType null (order lama)
      const hasProduct = orderItems.some(
        (i) => i.calculatorType === "product" ||
               i.category?.toLowerCase().includes("produk") ||
               i.category?.toLowerCase().includes("product")
      );
      if (hasProduct) return "product";
      const hasService = orderItems.some(
        (i) => i.calculatorType === "service" ||
               i.category?.toLowerCase().includes("servis") ||
               i.category?.toLowerCase().includes("service") ||
               i.category?.toLowerCase().includes("jasa")
      );
      if (hasService) return "service";
      return "shipment";
    })(),
    serviceType,
    origin,
    destination,
    commodity,
    cargoDescription,
    grossWeight,
    volumeCbm,
    requiredDate: order.requiredDate ?? null,
    basicPrice,
    responseDeadline: link.expiredAt?.toISOString() ?? rfqResponseDeadline?.toISOString() ?? null,
    alreadySubmitted: !!link.submittedAt,
    currentStatus: link.status,
    currentOfferedPrice: link.offeredPrice ? Number(link.offeredPrice) : null,
    currentEta: link.eta ?? null,
    currentNotes: link.notes ?? null,
    currentLeadTimeDays: link.leadTimeDays ?? null,
    currentStockAvailability: link.stockAvailability ?? "unknown",
    templateSnapshot: (rfqRaw.template_snapshot as Record<string, unknown> | null) ?? null,
    orderItems: orderItems.map((i) => {
      const itemName = (i.serviceName || i.category || "").trim();
      const catalogMatch = matchCatalogItem(itemName);
      const input = (i.inputData as Record<string, unknown> | null) ?? {};

      const qtyRaw = input.qty ?? input.quantity ?? input.jumlah;
      const qty = qtyRaw != null ? Number(qtyRaw) || 1 : 1;
      const unit = input.unit ? String(input.unit) : "Unit";
      const sellingUnitPrice = input.price != null ? Number(input.price)
        : input.productPrice != null ? Number(input.productPrice)
        : input.unitPrice != null ? Number(input.unitPrice) : null;
      const sellingSubtotal = sellingUnitPrice != null ? sellingUnitPrice * qty
        : (i.subtotal ? Number(i.subtotal) : null);

      const vendorUnitPrice = catalogMatch ? Number(catalogMatch.priceBase) : null;
      const vendorSubtotal = vendorUnitPrice != null ? vendorUnitPrice * qty : null;
      const ppnAmount = vendorSubtotal != null ? Math.round(vendorSubtotal * PPN_RATE) : null;
      const vendorGrandTotal = vendorSubtotal != null && ppnAmount != null
        ? vendorSubtotal + ppnAmount : null;

      return {
        id: i.id,
        serviceName: i.serviceName,
        category: i.category,
        calculatorType: i.calculatorType,
        qty,
        unit,
        sellingUnitPrice,
        sellingSubtotal,
        vendorUnitPrice,
        vendorSubtotal,
        ppnAmount,
        vendorGrandTotal,
      };
    }),
    currentCurrency: String(linkExtras.currency || "IDR"),
    currentValidityDate: linkExtras.validity_date ? String(linkExtras.validity_date) : null,
    currentTerms: linkExtras.terms ? String(linkExtras.terms) : null,
    currentItemOffers: existingItemOffers.map(r => ({
      id: Number(r.id),
      orderItemId: r.order_item_id != null ? Number(r.order_item_id) : null,
      serviceName: String(r.service_name ?? ""),
      offeredPrice: r.offered_price != null ? Number(r.offered_price) : null,
      currency: String(r.currency || "IDR"),
      scheduleEtd: r.schedule_etd ? String(r.schedule_etd) : null,
      scheduleEta: r.schedule_eta ? String(r.schedule_eta) : null,
      leadTimeDays: r.lead_time_days != null ? Number(r.lead_time_days) : null,
      validityDate: r.validity_date ? String(r.validity_date) : null,
      terms: r.terms ? String(r.terms) : null,
      notes: r.notes ? String(r.notes) : null,
      attachmentUrl: r.attachment_url ? String(r.attachment_url) : null,
    })),
  });
});

// ─── PUBLIC: POST /vendor-form/:token/upload ─────────────────────────────────
const _rfqUploadMiddleware = (req: Request, res: Response, next: import("express").NextFunction) =>
  (upload.single("file") as any)(req, res, (err: any) => {
    if (err?.code === "LIMIT_FILE_SIZE") {
      return res.status(413).json({ message: "Ukuran file melebihi batas 10MB." });
    }
    next(err);
  });

logisticRfqV2Router.post("/vendor-form/:token/upload", _rfqUploadMiddleware, async (req: Request, res: Response) => {
  const token = String(req.params.token ?? "").trim() || undefined;
  if (!token) return res.status(400).json({ message: "Token tidak valid" });

  // Rate limit: per-IP + per-token (10 uploads/jam masing-masing)
  const ip = (req.headers["x-forwarded-for"] as string | undefined)?.split(",")[0]?.trim()
    ?? req.socket.remoteAddress
    ?? "unknown";
  if (!_rfqUploadIpLimiter.check(ip)) {
    return res.status(429).json({ message: "Terlalu banyak upload dari jaringan ini. Coba lagi dalam 1 jam." });
  }
  if (!_rfqUploadTokenLimiter.check(token)) {
    return res.status(429).json({ message: "Batas upload untuk link ini telah tercapai. Coba lagi dalam 1 jam." });
  }

  if (!req.file) return res.status(400).json({ message: "Tidak ada file" });

  // MIME + extension + size whitelist — dilakukan sebelum DB query agar
  // file berbahaya ditolak sesegera mungkin tanpa menyentuh database.
  const validation = validateUploadFile(req.file, {
    allowedMime: RFQ_UPLOAD_ALLOWED_MIME,
    allowedExt: RFQ_UPLOAD_ALLOWED_EXT,
    maxSizeBytes: 10 * 1024 * 1024,
  });
  if (!validation.ok) {
    return res.status(415).json({ message: validation.errorMessage });
  }

  const [link] = await db.select({ id: rfqVendorLinksTable.id, status: rfqVendorLinksTable.status })
    .from(rfqVendorLinksTable).where(eq(rfqVendorLinksTable.token, token));
  if (!link) return res.status(404).json({ message: "Token tidak valid" });

  try {
    const objectId = randomUUID();
    const ext = req.file.originalname?.split(".").pop()?.toLowerCase() ?? "bin";
    const subPath = `rfq-attachments/${objectId}.${ext}`;
    const url = await objectStorage.uploadPublicRaw(subPath, req.file.buffer, req.file.mimetype);
    return res.json({ url });
  } catch (e) {
    logger.error({ e }, "rfq attachment upload failed");
    return res.status(500).json({ message: "Gagal upload" });
  }
});

logisticRfqV2Router.post("/vendor-form/:token", async (req: Request, res: Response) => {
  const token = String(req.params.token ?? "").trim() || undefined;
  if (!token) return res.status(400).json({ message: "Token tidak valid" });

  const [link] = await db.select().from(rfqVendorLinksTable)
    .where(eq(rfqVendorLinksTable.token, token));
  if (!link) return res.status(404).json({ message: "Link tidak valid" });

  if (link.expiredAt && link.expiredAt < new Date() && link.status === "waiting_response") {
    await transitionVendorLinkStatus(link.id, "expired", { actorType: "system", actorName: "system", source: "vendor-submit/lazy-expire", force: true });
    return res.status(410).json({ message: "Link sudah kadaluarsa" });
  }
  if (link.status === "expired") return res.status(410).json({ message: "Link sudah kadaluarsa" });

  // H4 guard: block vendor from changing a quote that has already been selected by admin
  if (link.status === "selected") {
    return res.status(409).json({ message: "Penawaran Anda sudah dipilih oleh admin. Tidak dapat mengubah penawaran." });
  }

  const [rfq] = await db.select().from(logisticOrderRfqsTable)
    .where(eq(logisticOrderRfqsTable.id, link.rfqId));
  if (!rfq) return res.status(404).json({ message: "RFQ tidak ditemukan" });

  const {
    action, offeredPrice, eta, notes, attachmentUrl, leadTimeDays, stockAvailability,
    itemOffers, currency, validityDate, terms,
  } = req.body as {
    action: "accept" | "counter" | "reject";
    offeredPrice?: number;
    eta?: string;
    notes?: string;
    attachmentUrl?: string;
    leadTimeDays?: number;
    stockAvailability?: string;
    itemOffers?: Array<{
      orderItemId?: number | null;
      serviceName: string;
      offeredPrice?: number | null;
      currency?: string;
      scheduleEtd?: string;
      scheduleEta?: string;
      leadTimeDays?: number;
      validityDate?: string;
      terms?: string;
      notes?: string;
      attachmentUrl?: string;
    }>;
    currency?: string;
    validityDate?: string;
    terms?: string;
  };

  if (!action || !["accept", "counter", "reject"].includes(action)) {
    return res.status(400).json({ message: "action harus accept, counter, atau reject" });
  }
  if (action === "counter") {
    if (!offeredPrice || isNaN(Number(offeredPrice)) || Number(offeredPrice) <= 0) {
      return res.status(400).json({ message: "Harga penawaran harus diisi dan harus lebih dari Rp 0" });
    }
    if (!eta) return res.status(400).json({ message: "ETA harus diisi" });
  }
  if (offeredPrice !== undefined && Number(offeredPrice) < 0) {
    return res.status(400).json({ message: "Harga penawaran tidak boleh negatif" });
  }

  const isLate = !!(rfq.status && ["vendor_selected", "closed"].includes(rfq.status));
  let newStatus: string;
  if (isLate) {
    newStatus = "late_response";
  } else if (action === "accept") {
    newStatus = "accepted_basic_price";
  } else if (action === "counter") {
    newStatus = "counter_offer";
  } else {
    newStatus = "rejected";
  }

  const [vendor] = await db.select({ name: suppliersTable.name }).from(suppliersTable)
    .where(eq(suppliersTable.id, link.vendorId));
  const vendorName = vendor?.name ?? `Vendor #${link.vendorId}`;

  const now = new Date();
  const isUpdate = !!link.submittedAt;
  // Hitung offeredPrice: untuk product orders, unit_price × total_qty; untuk freight/trucking, gunakan unit price
  const computedOfferedPrice: string | null = await (async () => {
    if (action !== "accept") return offeredPrice ? String(offeredPrice) : null;

    // Ambil order items dengan qty untuk product orders
    const oItems = await db.select({
      serviceName: logisticOrderItemsTable.serviceName,
      inputData: logisticOrderItemsTable.inputData,
    }).from(logisticOrderItemsTable).where(eq(logisticOrderItemsTable.orderId, rfq.orderId));

    const catItems = await db.select({
      name: vendorCatalogItemsTable.name,
      kategori: vendorCatalogItemsTable.kategori,
      priceBase: vendorCatalogItemsTable.priceBase,
    }).from(vendorCatalogItemsTable)
      .where(and(eq(vendorCatalogItemsTable.vendorId, link.vendorId), eq(vendorCatalogItemsTable.isActive, true)));

    // Jika ada basicPrice (unit price dari catalog), kalikan dengan total qty per item
    if (link.basicPrice) {
      if (oItems.length === 0) return String(link.basicPrice);
      let total = 0;
      for (const it of oItems) {
        const inp = (it.inputData as Record<string, unknown>) ?? {};
        const qty = Number(inp.qty ?? inp.quantity ?? inp.jumlah ?? 1) || 1;
        const nm = (it.serviceName ?? "").toLowerCase().trim();
        const matched = catItems.find(c => {
          const cn = c.name.toLowerCase().trim();
          return cn === nm || cn.includes(nm) || nm.includes(cn);
        });
        total += (matched ? Number(matched.priceBase) : Number(link.basicPrice)) * qty;
      }
      return String(total > 0 ? total : link.basicPrice);
    }

    // Fallback: tidak ada basicPrice — gunakan katalog langsung
    if (catItems.length === 1) return String(catItems[0].priceBase);
    if (catItems.length > 1 && oItems.length > 0) {
      const prices = oItems.map(i => {
        const svc = (i.serviceName ?? "").toLowerCase().trim();
        const m = catItems.find(c => c.name.toLowerCase().trim() === svc || (c.kategori ?? "").toLowerCase().trim() === svc);
        return m ? Number(m.priceBase) : null;
      });
      if (prices.length > 0 && prices.every(p => p != null)) {
        return String(prices.reduce((s, p) => s + (p ?? 0), 0));
      }
    }
    return null;
  })();

  await db.update(rfqVendorLinksTable).set({
    offeredPrice: computedOfferedPrice,
    eta: eta ?? null,
    notes: notes ?? null,
    attachmentUrl: attachmentUrl ?? link.attachmentUrl,
    leadTimeDays: leadTimeDays != null ? Number(leadTimeDays) : (link.leadTimeDays ?? null),
    stockAvailability: stockAvailability?.trim() || (link.stockAvailability ?? null),
    isNewUpdate: true,
    submittedAt: link.submittedAt ?? now,
    lastUpdatedAt: now,
  }).where(eq(rfqVendorLinksTable.id, link.id));

  // Save extra fields (currency, validity_date, terms) added via migration
  await db.execute(sql`
    UPDATE rfq_vendor_links SET
      currency      = ${(currency ?? "IDR")},
      validity_date = ${(validityDate ?? null)},
      terms         = ${(terms ?? null)}
    WHERE id = ${link.id}
  `).catch(() => {});

  // Save per-item offers if vendor provided per-item pricing (Step 11)
  if (Array.isArray(itemOffers) && itemOffers.length > 0) {
    await db.execute(sql`DELETE FROM rfq_vendor_item_offers WHERE rfq_vendor_link_id = ${link.id}`).catch(() => {});
    for (const offer of itemOffers) {
      if (!offer.serviceName) continue;
      await db.execute(sql`
        INSERT INTO rfq_vendor_item_offers
          (rfq_vendor_link_id, order_item_id, service_name, offered_price, currency,
           schedule_etd, schedule_eta, lead_time_days, validity_date, terms, notes, attachment_url)
        VALUES
          (${link.id}, ${offer.orderItemId ?? null}, ${String(offer.serviceName)},
           ${offer.offeredPrice != null ? Number(offer.offeredPrice) : null},
           ${String(offer.currency || currency || "IDR")},
           ${offer.scheduleEtd ?? null}, ${offer.scheduleEta ?? eta ?? null},
           ${offer.leadTimeDays != null ? Number(offer.leadTimeDays) : (leadTimeDays != null ? Number(leadTimeDays) : null)},
           ${offer.validityDate ?? validityDate ?? null},
           ${offer.terms ?? terms ?? null}, ${offer.notes ?? notes ?? null},
           ${offer.attachmentUrl ?? attachmentUrl ?? null})
      `).catch(() => {});
    }
  }

  // C3-REMEDIATION: removed force:true — vendor actors must go through the state machine.
  // VENDOR_LINK_VALID_TRANSITIONS already allows waiting_response→accepted_basic_price|counter_offer|rejected.
  await transitionVendorLinkStatus(link.id, newStatus, { source: "logisticRfqV2:vendor_response", actorType: "vendor" });

  const actionLabel = action === "accept" ? "Terima Harga Basic"
    : action === "counter" ? `Counter Offer ${fmtRp(offeredPrice)}`
    : "Tolak";
  const actDesc = isUpdate
    ? `${vendorName} memperbarui penawaran: ${actionLabel}`
    : `${vendorName} submit penawaran: ${actionLabel}`;
  await logActivity(link.rfqId, "vendor", vendorName, isUpdate ? "vendor_update" : "vendor_submit", actDesc);


  // Auto-advance order status to "Quote Received" when vendor submits (not reject, not late)
  if (!isUpdate && action !== "reject" && !isLate) {
    // C3-REMEDIATION: removed force:true — auto-advance uses system actor for state-machine legitimacy.
    void transitionLogisticOrderStatus(rfq.orderId, "Quote Received", {
      actorType: "system",
      actorName: "system/vendor-rfq-submit",
      source: "vendor-rfq-submit/auto-advance",
      skipAudit: false,
    }).catch(() => {});
  }

  // Hitung harga yang ditampilkan di notif (gunakan computedOfferedPrice yang sudah × qty)
  const finalPriceNum = computedOfferedPrice ? Number(computedOfferedPrice) : (offeredPrice ? Number(offeredPrice) : null);
  const submitterPriceStr = finalPriceNum != null ? fmtRp(finalPriceNum) : "Harga Dasar";

  await sendAdminRecapWa(link.rfqId, rfq, {
    vendorName,
    action,
    priceStr: submitterPriceStr,
    eta: eta ?? null,
    notes: notes ?? null,
    isUpdate,
  });

  return res.json({ success: true, message: "Penawaran berhasil dikirim", isUpdate });
});

// ─── ADMIN: POST /orders/:orderId/rfq-blast ─ create-or-reuse RFQ + blast ────
logisticRfqV2Router.post("/orders/:orderId/rfq-blast", async (req: Request, res: Response) => {
  if (!(await requireClerkUser(req, res))) return;
  const orderId = parseInt(String(req.params.orderId), 10);
  if (isNaN(orderId)) return res.status(400).json({ message: "orderId tidak valid" });

  const { vendorIds, deadlineHours = 48, notes } = req.body as {
    vendorIds: number[];
    deadlineHours?: number;
    notes?: string;
  };
  if (!vendorIds?.length) return res.status(400).json({ message: "vendorIds wajib diisi" });

  const [order] = await db.select().from(logisticOrdersTable).where(eq(logisticOrdersTable.id, orderId));
  if (!order) return res.status(404).json({ message: "Order tidak ditemukan" });

  // ── C2 Guard: product_first wajib selesai product phase sebelum shipment RFQ ─
  if ((order as any).orderType === "product_first") {
    const o = order as any;
    const missing: string[] = [];
    if (!o.productVendorId)           missing.push("product_vendor_id (vendor produk belum dipilih)");
    if (!o.customerProductApprovedAt) missing.push("customer_product_approved_at (customer belum approve produk)");
    if (!o.productReadyDate)          missing.push("product_ready_date (tanggal siap produk belum diisi)");
    if (!o.productPickupLocation)     missing.push("product_pickup_location (lokasi pickup belum diisi)");
    if (!o.shipmentMode)              missing.push("shipment_mode (mode pengiriman belum dipilih)");
    if (missing.length > 0) {
      return res.status(422).json({
        message: "Product phase belum selesai. Shipment RFQ hanya bisa dibuat setelah vendor produk confirmed, customer approve produk, ready date, pickup location, dan shipment mode tersedia.",
        missingFields: missing,
      });
    }
  }
  // ────────────────────────────────────────────────────────────────────────────

  // ── Verification Guard: customer portal harus VERIFIED sebelum blast RFQ ──
  {
    const { forceBlast } = req.body as { forceBlast?: boolean };
    if (!forceBlast) {
      const orderEmail = (order as unknown as Record<string, unknown>).email as string | null | undefined;
      const orderGuestEmail = (order as unknown as Record<string, unknown>).guestEmail as string | null | undefined;
      const lookupEmail = orderEmail ?? orderGuestEmail;
      if (lookupEmail) {
        const [portalCustomer] = await db
          .select({ id: portalCustomersTable.id })
          .from(portalCustomersTable)
          .where(eq(portalCustomersTable.email, lookupEmail))
          .limit(1);
        if (portalCustomer) {
          const [profile] = await db
            .select({ verificationStatus: portalCustomerProfilesTable.verificationStatus })
            .from(portalCustomerProfilesTable)
            .where(eq(portalCustomerProfilesTable.customerId, portalCustomer.id))
            .limit(1);
          const vStatus = profile?.verificationStatus ?? "DRAFT";
          if (vStatus !== "VERIFIED") {
            await transitionLogisticOrderStatus(orderId, "Waiting Verification", {
              actorType: "admin",
              actorName: "System",
              source: "rfq-blast-verification-guard",
              skipAudit: false,
            }).catch(() => {}); // jika status tidak bisa transisi, abaikan
            return res.status(422).json({
              message: `Customer belum terverifikasi (status: ${vStatus}). Blast RFQ ditangguhkan sampai verifikasi dokumen selesai.`,
              verificationStatus: vStatus,
              customerEmail: lookupEmail,
              waitingVerification: true,
            });
          }
        }
      }
    }
  }
  // ─────────────────────────────────────────────────────────────────────────

  // Reuse existing RFQ or create new one
  const existingRfqs = await db.select().from(logisticOrderRfqsTable)
    .where(eq(logisticOrderRfqsTable.orderId, orderId))
    .orderBy(sql`created_at DESC`)
    .limit(1);
  let rfq = existingRfqs[0];
  if (!rfq) {
    const now = new Date();
    const seq = String(Date.now()).slice(-6);
    const rfqNumber = `RFQ/${now.getFullYear()}/${seq}`;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const [inserted] = await (db.insert(logisticOrderRfqsTable) as any).values({
      orderId,
      rfqNumber,
      vendorIds: [],
      notes: notes ?? null,
      status: "admin_review",
    }).returning();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    rfq = inserted as any;
  }

  const rfqId = rfq.id;
  const expiredAt = new Date(Date.now() + deadlineHours * 60 * 60 * 1000);

  const vendors = await db.select().from(suppliersTable).where(inArray(suppliersTable.id, vendorIds));
  const eligible = vendors.filter((v) => v.phone);
  if (!eligible.length) return res.status(400).json({ message: "Tidak ada vendor dengan nomor WA" });

  const existingLinks = await db.select().from(rfqVendorLinksTable).where(eq(rfqVendorLinksTable.rfqId, rfqId));
  const results: { vendorId: number; vendorName: string; sent: boolean }[] = [];

  // Fetch order items for name-matching against vendor catalog
  const orderItemsForRfqV1 = await db.select({
    serviceName: logisticOrderItemsTable.serviceName,
    category: logisticOrderItemsTable.category,
  }).from(logisticOrderItemsTable).where(eq(logisticOrderItemsTable.orderId, orderId));

  const baseOrderDataV1 = await buildOrderDataWithItems(order);

  for (const vendor of eligible) {
    let linkToken: string;

    // Compute basic_price dari catalog vendor — JANGAN gunakan subtotal order (harga jual customer)
    const catalogItemsV1 = await db.select().from(vendorCatalogItemsTable)
      .where(and(eq(vendorCatalogItemsTable.vendorId, vendor.id), eq(vendorCatalogItemsTable.isActive, true)));

    let basicPrice: string | null = null;
    // Name-match per order item (mirrors WA blast logic)
    const matchedItem = orderItemsForRfqV1.find((it) => {
      const name = (it.serviceName || it.category || "").toLowerCase().trim();
      if (!name) return false;
      return catalogItemsV1.some((c) => {
        const cName = c.name.toLowerCase().trim();
        return cName.includes(name) || name.includes(cName);
      });
    });
    if (matchedItem) {
      const name = (matchedItem.serviceName || matchedItem.category || "").toLowerCase().trim();
      const cat = catalogItemsV1.find((c) => {
        const cName = c.name.toLowerCase().trim();
        return cName.includes(name) || name.includes(cName);
      });
      basicPrice = cat ? String(cat.priceBase) : (catalogItemsV1[0] ? String(catalogItemsV1[0].priceBase) : null);
    } else {
      basicPrice = catalogItemsV1[0] ? String(catalogItemsV1[0].priceBase) : null;
    }

    const existingLink = existingLinks.find((l) => l.vendorId === vendor.id);
    if (existingLink) {
      linkToken = existingLink.token;
      // Update basic_price if previously unset
      if (existingLink.basicPrice == null && basicPrice != null) {
        await db.update(rfqVendorLinksTable)
          .set({ basicPrice })
          .where(eq(rfqVendorLinksTable.id, existingLink.id));
      }
    } else {
      linkToken = randomUUID();
      await db.insert(rfqVendorLinksTable).values({
        rfqId,
        vendorId: vendor.id,
        token: linkToken,
        status: "waiting_response",
        basicPrice: basicPrice ?? undefined,
        expiredAt,
      });
    }

    const formUrl = getVendorFormUrl(linkToken);

    // Build vendor-specific orderData: override subtotal dengan basicPrice × qty (bukan harga jual customer)
    const vendorOrderDataV1 = { ...baseOrderDataV1 };
    if (basicPrice && baseOrderDataV1.orderItems?.length) {
      const bpNum = parseFloat(basicPrice);
      vendorOrderDataV1.orderItems = baseOrderDataV1.orderItems.map((it) => ({
        ...it,
        subtotal: it.qty && it.qty > 0 ? Math.round(bpNum * it.qty) : it.subtotal,
      }));
    }

    try {
      await sendVendorRequestNotification(vendorOrderDataV1, vendor.name, vendor.phone!, formUrl);
      results.push({ vendorId: vendor.id, vendorName: vendor.name, sent: true });
    } catch (e) {
      logger.error({ e, vendorId: vendor.id }, "rfq-blast WA failed");
      results.push({ vendorId: vendor.id, vendorName: vendor.name, sent: false });
    }
  }

  // Update RFQ vendorIds + status
  const allVendorIds = [
    ...new Set([
      ...(Array.isArray(rfq.vendorIds) ? (rfq.vendorIds as number[]) : []),
      ...eligible.map((v) => v.id),
    ]),
  ];
  await transitionRfqStatus(rfqId, "vendor_blasted", { actorType: "admin", actorName: "Admin", force: true, source: "rfq-blast" });
  await db.update(logisticOrderRfqsTable).set({
    vendorIds: allVendorIds,
    responseDeadline: expiredAt,
  }).where(eq(logisticOrderRfqsTable.id, rfqId));

  // Bump order status to RFQ Sent when admin blasts vendors
  if (["Order Received", "Admin Review", "New Order", "Under Review"].includes(order.status)) {
    await transitionLogisticOrderStatus(orderId, "RFQ Sent", {
      actorType: "admin",
      actorName: "Admin",
      source: "rfq-blast",
      skipAudit: false,
    });
  }

  const sentCount = results.filter((r) => r.sent).length;
  await logActivity(rfqId, "admin", "Admin", "admin_blast",
    `Admin blast ke ${sentCount} vendor: ${eligible.map((v) => v.name).join(", ")}`);

  return res.json({ ok: true, rfqId, rfqNumber: rfq.rfqNumber, sentCount, comparisonUrl: getComparisonUrl(rfqId) });
});

// ─── ADMIN: POST /rfq/:rfqId/blast ────────────────────────────────────────────
logisticRfqV2Router.post("/rfq/:rfqId/blast", async (req: Request, res: Response) => {
  if (!(await requireClerkUser(req, res))) return;
  const rfqId = parseInt(String(req.params.rfqId), 10);
  if (isNaN(rfqId)) return res.status(400).json({ message: "rfqId tidak valid" });

  const { vendorIds, deadlineHours = 48 } = req.body as { vendorIds: number[]; deadlineHours?: number };
  if (!vendorIds?.length) return res.status(400).json({ message: "vendorIds wajib diisi" });

  const [rfq] = await db.select().from(logisticOrderRfqsTable)
    .where(eq(logisticOrderRfqsTable.id, rfqId));
  if (!rfq) return res.status(404).json({ message: "RFQ tidak ditemukan" });

  const [order] = await db.select().from(logisticOrdersTable)
    .where(eq(logisticOrdersTable.id, rfq.orderId));
  if (!order) return res.status(404).json({ message: "Order tidak ditemukan" });

  const vendors = await db.select().from(suppliersTable)
    .where(inArray(suppliersTable.id, vendorIds));
  const eligible = vendors.filter((v) => v.phone);
  if (!eligible.length) return res.status(400).json({ message: "Tidak ada vendor dengan nomor WA" });

  const expiredAt = new Date(Date.now() + deadlineHours * 60 * 60 * 1000);
  const existingLinks = await db.select().from(rfqVendorLinksTable)
    .where(eq(rfqVendorLinksTable.rfqId, rfqId));
  const existingVendorIds = new Set(existingLinks.map((l) => l.vendorId));

  // Fetch order items for name-matching against vendor catalog
  const orderItemsForRfqV2 = await db.select({
    serviceName: logisticOrderItemsTable.serviceName,
    category: logisticOrderItemsTable.category,
  }).from(logisticOrderItemsTable).where(eq(logisticOrderItemsTable.orderId, rfq.orderId));

  const baseOrderDataV2 = await buildOrderDataWithItems(order);

  const results: { vendorId: number; vendorName: string; token: string; sent: boolean }[] = [];

  for (const vendor of eligible) {
    let linkToken: string;
    let linkId: number;

    // Compute basic_price dari catalog vendor — JANGAN gunakan subtotal order (harga jual customer)
    const catalogItemsV2 = await db.select().from(vendorCatalogItemsTable)
      .where(and(eq(vendorCatalogItemsTable.vendorId, vendor.id), eq(vendorCatalogItemsTable.isActive, true)));

    let basicPrice: string | null = null;
    const matchedItem = orderItemsForRfqV2.find((it) => {
      const name = (it.serviceName || it.category || "").toLowerCase().trim();
      if (!name) return false;
      return catalogItemsV2.some((c) => {
        const cName = c.name.toLowerCase().trim();
        return cName.includes(name) || name.includes(cName);
      });
    });
    if (matchedItem) {
      const name = (matchedItem.serviceName || matchedItem.category || "").toLowerCase().trim();
      const cat = catalogItemsV2.find((c) => {
        const cName = c.name.toLowerCase().trim();
        return cName.includes(name) || name.includes(cName);
      });
      basicPrice = cat ? String(cat.priceBase) : (catalogItemsV2[0] ? String(catalogItemsV2[0].priceBase) : null);
    } else {
      basicPrice = catalogItemsV2[0] ? String(catalogItemsV2[0].priceBase) : null;
    }

    const existingLink = existingLinks.find((l) => l.vendorId === vendor.id);
    if (existingLink) {
      linkToken = existingLink.token;
      linkId = existingLink.id;
      // Update basic_price if previously unset
      if (existingLink.basicPrice == null && basicPrice != null) {
        await db.update(rfqVendorLinksTable)
          .set({ basicPrice })
          .where(eq(rfqVendorLinksTable.id, existingLink.id));
      }
    } else {
      linkToken = randomUUID();
      const [inserted] = await db.insert(rfqVendorLinksTable).values({
        rfqId,
        vendorId: vendor.id,
        token: linkToken,
        status: "waiting_response",
        basicPrice: basicPrice ?? undefined,
        expiredAt,
      }).returning({ id: rfqVendorLinksTable.id });
      linkId = inserted.id;
    }

    const formUrl = getVendorFormUrl(linkToken);

    // Build vendor-specific orderData: override subtotal dengan basicPrice × qty (bukan harga jual customer)
    const vendorOrderDataV2 = { ...baseOrderDataV2 };
    if (basicPrice && baseOrderDataV2.orderItems?.length) {
      const bpNum = parseFloat(basicPrice);
      vendorOrderDataV2.orderItems = baseOrderDataV2.orderItems.map((it) => ({
        ...it,
        subtotal: it.qty && it.qty > 0 ? Math.round(bpNum * it.qty) : it.subtotal,
      }));
    }

    try {
      await sendVendorRequestNotification(vendorOrderDataV2, vendor.name, vendor.phone!, formUrl);
      results.push({ vendorId: vendor.id, vendorName: vendor.name, token: linkToken, sent: true });
    } catch (e) {
      logger.error({ e, vendorId: vendor.id }, "blast WA vendor failed");
      results.push({ vendorId: vendor.id, vendorName: vendor.name, token: linkToken, sent: false });
    }
  }

  const newVendorIds = [...new Set([...(Array.isArray(rfq.vendorIds) ? rfq.vendorIds as number[] : []), ...eligible.map((v) => v.id)])];
  await transitionRfqStatus(rfqId, "vendor_blasted", { actorType: "admin", actorName: "Admin", force: true, source: "rfq/:rfqId/blast" });
  await db.update(logisticOrderRfqsTable).set({
    vendorIds: newVendorIds,
    responseDeadline: expiredAt,
  }).where(eq(logisticOrderRfqsTable.id, rfqId));

  // Bump order status to RFQ Sent when admin blasts vendors
  if (["Order Received", "Admin Review", "New Order", "Under Review"].includes(order.status)) {
    await transitionLogisticOrderStatus(order.id, "RFQ Sent", {
      actorType: "admin",
      actorName: "Admin",
      source: "rfq/:rfqId/blast",
      skipAudit: false,
    });
  }

  const sentCount = results.filter((r) => r.sent).length;
  await logActivity(rfqId, "admin", "Admin", "admin_blast", `Admin blast ke ${sentCount} vendor: ${eligible.map((v) => v.name).join(", ")}`);

  return res.json({ ok: true, rfqNumber: rfq.rfqNumber, sentCount, results, comparisonUrl: getComparisonUrl(rfqId) });
});

// ─── ADMIN: POST /rfq/:rfqId/reblast-all ─────────────────────────────────────
// Re-blast ke SEMUA vendor yang sudah ada di rfq_vendor_links:
//   • Recalculate & update basic_price untuk setiap link (selalu, bukan hanya yang null)
//   • Reset expired_at berdasarkan deadlineHours baru
//   • Kirim ulang WA notifikasi ke semua vendor
logisticRfqV2Router.post("/rfq/:rfqId/reblast-all", async (req: Request, res: Response) => {
  if (!(await requireClerkUser(req, res))) return;
  const rfqId = parseInt(String(req.params.rfqId), 10);
  if (isNaN(rfqId)) return res.status(400).json({ message: "rfqId tidak valid" });

  const { deadlineHours = 48 } = req.body as { deadlineHours?: number };

  const [rfq] = await db.select().from(logisticOrderRfqsTable)
    .where(eq(logisticOrderRfqsTable.id, rfqId));
  if (!rfq) return res.status(404).json({ message: "RFQ tidak ditemukan" });

  const [order] = await db.select().from(logisticOrdersTable)
    .where(eq(logisticOrdersTable.id, rfq.orderId));
  if (!order) return res.status(404).json({ message: "Order tidak ditemukan" });

  const existingLinks = await db.select().from(rfqVendorLinksTable)
    .where(eq(rfqVendorLinksTable.rfqId, rfqId));
  if (!existingLinks.length) return res.status(400).json({ message: "Tidak ada vendor yang sudah di-blast sebelumnya" });

  const vendorIds = existingLinks.map((l) => l.vendorId);
  const vendors = await db.select().from(suppliersTable).where(inArray(suppliersTable.id, vendorIds));
  const eligible = vendors.filter((v) => v.phone);
  if (!eligible.length) return res.status(400).json({ message: "Tidak ada vendor dengan nomor WA" });

  const expiredAt = new Date(Date.now() + deadlineHours * 60 * 60 * 1000);

  // Fetch order items untuk name-matching terhadap catalog vendor
  const orderItemsForReblast = await db.select({
    serviceName: logisticOrderItemsTable.serviceName,
    category: logisticOrderItemsTable.category,
  }).from(logisticOrderItemsTable).where(eq(logisticOrderItemsTable.orderId, rfq.orderId));

  const results: { vendorId: number; vendorName: string; token: string; sent: boolean }[] = [];

  for (const vendor of eligible) {
    const link = existingLinks.find((l) => l.vendorId === vendor.id);
    if (!link) continue;

    // Recalculate basic_price dari catalog vendor — JANGAN gunakan subtotal order (harga jual customer)
    const catalogItems = await db.select().from(vendorCatalogItemsTable)
      .where(and(eq(vendorCatalogItemsTable.vendorId, vendor.id), eq(vendorCatalogItemsTable.isActive, true)));

    let basicPrice: string | null = null;
    const matchedItem = orderItemsForReblast.find((it) => {
      const name = (it.serviceName || it.category || "").toLowerCase().trim();
      if (!name) return false;
      return catalogItems.some((c) => {
        const cName = c.name.toLowerCase().trim();
        return cName.includes(name) || name.includes(cName);
      });
    });
    if (matchedItem) {
      const name = (matchedItem.serviceName || matchedItem.category || "").toLowerCase().trim();
      const cat = catalogItems.find((c) => {
        const cName = c.name.toLowerCase().trim();
        return cName.includes(name) || name.includes(cName);
      });
      basicPrice = cat ? String(cat.priceBase) : (catalogItems[0] ? String(catalogItems[0].priceBase) : null);
    } else {
      basicPrice = catalogItems[0] ? String(catalogItems[0].priceBase) : null;
    }

    // Update basic_price & reset expired_at (selalu update, bukan hanya kalau null)
    await db.update(rfqVendorLinksTable)
      .set({
        basicPrice: basicPrice ?? undefined,
        expiredAt,
      })
      .where(eq(rfqVendorLinksTable.id, link.id));
    if (link.status === "expired") {
      await transitionVendorLinkStatus(link.id, "waiting_response", {
        actorType: "admin",
        actorName: "Admin",
        source: "reblast-all",
        force: true,
      });
    }

    try {
      await sendVendorRequestNotification(await buildOrderDataWithItems(order), vendor.name, vendor.phone!, getVendorFormUrl(link.token));
      results.push({ vendorId: vendor.id, vendorName: vendor.name, token: link.token, sent: true });
    } catch (e) {
      logger.error({ e, vendorId: vendor.id }, "reblast-all WA vendor failed");
      results.push({ vendorId: vendor.id, vendorName: vendor.name, token: link.token, sent: false });
    }
  }

  // Pastikan status RFQ tetap vendor_blasted & perbarui deadline
  await transitionRfqStatus(rfqId, "vendor_blasted", { actorType: "admin", actorName: "Admin", force: true, source: "reblast-all" });
  await db.update(logisticOrderRfqsTable).set({
    responseDeadline: expiredAt,
  }).where(eq(logisticOrderRfqsTable.id, rfqId));

  const sentCount = results.filter((r) => r.sent).length;
  await logActivity(rfqId, "admin", "Admin", "admin_blast",
    `Admin re-blast semua vendor (${sentCount}/${results.length}): ${eligible.map((v) => v.name).join(", ")}`);

  return res.json({ ok: true, rfqNumber: rfq.rfqNumber, sentCount, totalVendors: results.length, results });
});

// ─── ADMIN: GET /rfq/:rfqId/detail ───────────────────────────────────────────
// Mengembalikan detail RFQ + order items + vendors dengan catalog items yang cocok
logisticRfqV2Router.get("/rfq/:rfqId/detail", async (req: Request, res: Response) => {
  if (!(await requireClerkUser(req, res))) return;
  const rfqId = parseInt(String(req.params.rfqId), 10);
  if (isNaN(rfqId)) return res.status(400).json({ message: "rfqId tidak valid" });

  const [rfq] = await db.select().from(logisticOrderRfqsTable).where(eq(logisticOrderRfqsTable.id, rfqId));
  if (!rfq) return res.status(404).json({ message: "RFQ tidak ditemukan" });

  const [order] = await db.select().from(logisticOrdersTable).where(eq(logisticOrdersTable.id, rfq.orderId));
  if (!order) return res.status(404).json({ message: "Order tidak ditemukan" });

  const [orderItems, allVendors, allCatalogItems, vendorLinks] = await Promise.all([
    db.select().from(logisticOrderItemsTable).where(eq(logisticOrderItemsTable.orderId, order.id)),
    db.select({
      id: suppliersTable.id,
      name: suppliersTable.name,
      phone: suppliersTable.phone,
      serviceType: suppliersTable.serviceType,
      isActive: suppliersTable.isActive,
    }).from(suppliersTable).where(eq(suppliersTable.isActive, true)),
    db.select({
      id: vendorCatalogItemsTable.id,
      vendorId: vendorCatalogItemsTable.vendorId,
      type: vendorCatalogItemsTable.type,
      name: vendorCatalogItemsTable.name,
      unit: vendorCatalogItemsTable.unit,
      priceBase: vendorCatalogItemsTable.priceBase,
      isCommodityTag: vendorCatalogItemsTable.isCommodityTag,
      isActive: vendorCatalogItemsTable.isActive,
    }).from(vendorCatalogItemsTable).where(eq(vendorCatalogItemsTable.isActive, true)),
    db.select({ vendorId: rfqVendorLinksTable.vendorId, status: rfqVendorLinksTable.status })
      .from(rfqVendorLinksTable).where(eq(rfqVendorLinksTable.rfqId, rfqId)),
  ]);

  // Kumpulkan nama produk dari order items untuk filter catalog
  const productNames = orderItems.map((i) => i.serviceName.toLowerCase());

  // Kelompokkan catalog items per vendor + cek kecocokan nama produk
  const catalogByVendor = new Map<number, typeof allCatalogItems>();
  for (const c of allCatalogItems) {
    if (!catalogByVendor.has(c.vendorId)) catalogByVendor.set(c.vendorId, []);
    catalogByVendor.get(c.vendorId)!.push(c);
  }

  const alreadyBlastedIds = new Set(vendorLinks.map((l) => l.vendorId));

  const vendors = allVendors.map((v) => {
    const catalog = catalogByVendor.get(v.id) ?? [];
    // Cari catalog item yang namanya cocok dengan salah satu produk dalam order
    const matchedItems = catalog.filter((c) =>
      productNames.some((pn) => c.name.toLowerCase().includes(pn) || pn.includes(c.name.toLowerCase()))
    );
    return {
      id: v.id,
      name: v.name,
      phone: v.phone,
      serviceType: v.serviceType,
      hasMatchingCatalog: matchedItems.length > 0,
      matchedCatalogItems: matchedItems.map((c) => ({
        id: c.id,
        type: c.type,
        name: c.name,
        unit: c.unit,
        priceBase: c.priceBase ? parseFloat(c.priceBase) : 0,
        isCommodityTag: c.isCommodityTag,
      })),
      alreadyBlasted: alreadyBlastedIds.has(v.id),
    };
  });

  return res.json({
    rfqId: rfq.id,
    rfqNumber: rfq.rfqNumber,
    rfqStatus: rfq.status,
    responseDeadline: rfq.responseDeadline?.toISOString() ?? null,
    order: {
      id: order.id,
      orderNumber: order.orderNumber,
      customerName: order.customerName,
      status: order.status,
      orderType: (order as any).orderType ?? "shipment",
      subtotal: parseFloat(order.subtotal),
      tax: parseFloat(order.tax),
      grandTotal: parseFloat(order.grandTotal),
    },
    orderItems: orderItems.map((i) => ({
      id: i.id,
      serviceName: i.serviceName,
      subtotal: parseFloat(i.subtotal),
      inputData: i.inputData as Record<string, unknown>,
      calculatorType: i.calculatorType,
    })),
    vendors,
    vendorStats: {
      total: vendorLinks.length,
      waiting: vendorLinks.filter((l) => l.status === "waiting_response").length,
      answered: vendorLinks.filter((l) => ["accepted_basic_price", "counter_offer", "selected", "not_selected", "late_response"].includes(l.status)).length,
      rejected: vendorLinks.filter((l) => l.status === "rejected").length,
    },
  });
});

// ─── ADMIN: GET /rfq/:rfqId/comparison ───────────────────────────────────────
logisticRfqV2Router.get("/rfq/:rfqId/comparison", async (req: Request, res: Response) => {
  if (!(await requireClerkUser(req, res))) return;
  const rfqId = parseInt(String(req.params.rfqId), 10);
  if (isNaN(rfqId)) return res.status(400).json({ message: "rfqId tidak valid" });

  // Ensure vendor_performance table exists (may not have been migrated yet)
  await db.execute(sql.raw(`
    CREATE TABLE IF NOT EXISTS vendor_performance (
      id SERIAL PRIMARY KEY,
      vendor_id INTEGER NOT NULL REFERENCES suppliers(id) ON DELETE CASCADE,
      total_orders INTEGER NOT NULL DEFAULT 0,
      completed_orders INTEGER NOT NULL DEFAULT 0,
      cancelled_orders INTEGER NOT NULL DEFAULT 0,
      ontime_percentage NUMERIC(5,2) DEFAULT 0,
      average_response_minutes NUMERIC(10,2) DEFAULT 0,
      pod_completeness_score NUMERIC(5,2) DEFAULT 0,
      eta_accuracy_score NUMERIC(5,2) DEFAULT 0,
      customer_rating NUMERIC(3,2) DEFAULT 0,
      order_success_rate NUMERIC(5,2) DEFAULT 0,
      cancel_rate NUMERIC(5,2) DEFAULT 0,
      total_complaints INTEGER NOT NULL DEFAULT 0,
      recommendation_score NUMERIC(5,2) DEFAULT 0,
      updated_at TIMESTAMP DEFAULT NOW() NOT NULL
    )
  `)).catch(() => {});

  // Use raw SQL to include freight_shipment_id added via migration
  const rfqRows = await db.execute(sql`
    SELECT *, freight_shipment_id FROM logistic_order_rfqs WHERE id = ${rfqId}
  `);
  const rfqRaw = rfqRows.rows[0] as any;
  if (!rfqRaw) return res.status(404).json({ message: "RFQ tidak ditemukan" });

  const [rfq] = await db.select().from(logisticOrderRfqsTable)
    .where(eq(logisticOrderRfqsTable.id, rfqId));
  if (!rfq) return res.status(404).json({ message: "RFQ tidak ditemukan" });

  const freightShipmentId: number | null = rfqRaw.freight_shipment_id
    ? Number(rfqRaw.freight_shipment_id) : null;

  const [order] = await db.select().from(logisticOrdersTable)
    .where(eq(logisticOrdersTable.id, rfq.orderId));

  const links = await db.select().from(rfqVendorLinksTable)
    .where(eq(rfqVendorLinksTable.rfqId, rfqId))
    .orderBy(sql`created_at ASC`);

  const now = new Date();
  for (const link of links) {
    if (link.status === "waiting_response" && link.expiredAt && link.expiredAt < now) {
      await transitionVendorLinkStatus(link.id, "expired", { actorType: "system", actorName: "system", source: "rfq-links/lazy-expire", force: true }).catch(() => {});
      link.status = "expired";
    }
  }

  const vendorIds = links.map((l) => l.vendorId);
  const vendors = vendorIds.length
    ? await db.select({ id: suppliersTable.id, name: suppliersTable.name, phone: suppliersTable.phone })
        .from(suppliersTable).where(inArray(suppliersTable.id, vendorIds))
    : [];
  const vendorMap = new Map(vendors.map((v) => [v.id, v]));

  const perfRows = vendorIds.length
    ? await db.select({
        vendorId: vendorPerformanceTable.vendorId,
        customerRating: vendorPerformanceTable.customerRating,
        recommendationScore: vendorPerformanceTable.recommendationScore,
        ontimePercentage: vendorPerformanceTable.ontimePercentage,
        totalOrders: vendorPerformanceTable.totalOrders,
      }).from(vendorPerformanceTable).where(inArray(vendorPerformanceTable.vendorId, vendorIds))
    : [];
  const perfMap = new Map(perfRows.map((p) => [p.vendorId, p]));

  const activities = await db.select().from(rfqActivityLogsTable)
    .where(eq(rfqActivityLogsTable.rfqId, rfqId))
    .orderBy(sql`created_at DESC`).limit(50);

  // Compute order items subtotal — fallback basicPrice ketika link.basic_price null
  const orderItemsForComp = await db.select({
    id: logisticOrderItemsTable.id,
    serviceName: logisticOrderItemsTable.serviceName,
    category: logisticOrderItemsTable.category,
    inputData: logisticOrderItemsTable.inputData,
    subtotal: logisticOrderItemsTable.subtotal,
  }).from(logisticOrderItemsTable).where(eq(logisticOrderItemsTable.orderId, rfq.orderId));
  const orderItemsSubtotal = orderItemsForComp.reduce(
    (s, i) => s + (i.subtotal ? parseFloat(i.subtotal) : 0), 0
  );
  const fallbackBasicPrice = orderItemsSubtotal > 0 ? orderItemsSubtotal : null;

  // Fetch per-item vendor offers (Step 12)
  const vendorItemOffersRes = await db.execute(sql`
    SELECT vio.id, vio.rfq_vendor_link_id, rvl.vendor_id, vio.order_item_id,
           vio.service_name, vio.offered_price, vio.currency, vio.schedule_etd,
           vio.schedule_eta, vio.lead_time_days, vio.validity_date, vio.terms, vio.notes
    FROM rfq_vendor_item_offers vio
    JOIN rfq_vendor_links rvl ON rvl.id = vio.rfq_vendor_link_id
    WHERE rvl.rfq_id = ${rfqId}
    ORDER BY vio.created_at ASC
  `).catch(() => ({ rows: [] as unknown[] }));

  const vendorRows = links
    .sort((a, b) => {
      if (a.status === "rejected" && b.status !== "rejected") return 1;
      if (b.status === "rejected" && a.status !== "rejected") return -1;
      if (a.status === "expired" && b.status !== "expired") return 1;
      if (b.status === "expired" && a.status !== "expired") return -1;
      const pa = Number(a.offeredPrice ?? a.basicPrice ?? 9e9);
      const pb = Number(b.offeredPrice ?? b.basicPrice ?? 9e9);
      return pa - pb;
    })
    .map((l) => {
      const dbBasic = l.basicPrice ? Number(l.basicPrice) : null;
      const effectiveBasic = dbBasic ?? fallbackBasicPrice;
      const dbOffered = l.offeredPrice ? Number(l.offeredPrice) : null;
      // Jika vendor "terima harga" tapi offeredPrice null (basicPrice null saat blast), pakai effectiveBasic
      const effectiveOffered = dbOffered ?? (l.status === "accepted_basic_price" ? effectiveBasic : null);
      return ({
      linkId: l.id,
      vendorId: l.vendorId,
      vendorName: vendorMap.get(l.vendorId)?.name ?? `Vendor #${l.vendorId}`,
      phone: vendorMap.get(l.vendorId)?.phone ?? null,
      status: l.status,
      basicPrice: effectiveBasic,
      offeredPrice: effectiveOffered,
      eta: l.eta ?? null,
      notes: l.notes ?? null,
      attachmentUrl: l.attachmentUrl ?? null,
      leadTimeDays: l.leadTimeDays ?? null,
      stockAvailability: l.stockAvailability ?? "unknown",
      vendorRating: perfMap.get(l.vendorId)?.customerRating != null ? Number(perfMap.get(l.vendorId)!.customerRating) : null,
      recommendationScore: perfMap.get(l.vendorId)?.recommendationScore != null ? Number(perfMap.get(l.vendorId)!.recommendationScore) : null,
      ontimePercentage: perfMap.get(l.vendorId)?.ontimePercentage != null ? Number(perfMap.get(l.vendorId)!.ontimePercentage) : null,
      totalOrders: perfMap.get(l.vendorId)?.totalOrders ?? null,
      isNewUpdate: l.isNewUpdate,
      openedAt: l.openedAt?.toISOString() ?? null,
      submittedAt: l.submittedAt?.toISOString() ?? null,
      lastUpdatedAt: l.lastUpdatedAt?.toISOString() ?? null,
      expiredAt: l.expiredAt?.toISOString() ?? null,
      formUrl: getVendorFormUrl(l.token),
    });
  });

  const stats = {
    total: links.length,
    answered: links.filter((l) => ["accepted_basic_price", "counter_offer", "selected", "not_selected", "late_response"].includes(l.status)).length,
    pending: links.filter((l) => l.status === "waiting_response").length,
    rejected: links.filter((l) => l.status === "rejected").length,
    counterOffer: links.filter((l) => l.status === "counter_offer").length,
    expired: links.filter((l) => l.status === "expired").length,
    selected: links.filter((l) => l.status === "selected").length,
  };

  // ── Truck assignment data ──────────────────────────────────────────────────
  // Fetch available trucking vendors (for external truck option)
  const truckVendors = await db.execute(sql`
    SELECT id, name, phone, has_internal_truck, internal_truck_price
    FROM suppliers
    WHERE is_active = true
      AND (service_type ILIKE '%trucking%' OR service_type ILIKE '%truck%')
    ORDER BY sort_order ASC, name ASC
    LIMIT 100
  `);

  // Fetch selected product vendor details (for internal truck check)
  const selectedLink = links.find(l => l.status === "selected");
  let selectedVendorTruckInfo: { hasInternalTruck: boolean; internalTruckPrice: number | null } | null = null;
  if (selectedLink) {
    const svResult = await db.execute(sql`
      SELECT has_internal_truck, internal_truck_price FROM suppliers WHERE id = ${selectedLink.vendorId}
    `);
    const sv = svResult.rows[0];
    if (sv) {
      const svRow = sv as any;
      selectedVendorTruckInfo = {
        hasInternalTruck: Boolean(svRow.has_internal_truck),
        internalTruckPrice: svRow.internal_truck_price ? Number(svRow.internal_truck_price) : null,
      };
    }
  }

  // Fetch truck vendor name if assigned
  let truckVendorName: string | null = null;
  const orderTruckVendorId: number | null = (order as any)?.truckVendorId ?? null;
  if (orderTruckVendorId) {
    const tvResult = await db.execute(sql`SELECT name FROM suppliers WHERE id = ${orderTruckVendorId}`);
    const tv = tvResult.rows[0];
    if (tv) truckVendorName = (tv as any).name ?? null;
  }

  const orderProductPrice: number | null = (order as any)?.productPrice ? Number((order as any).productPrice) : null;
  const orderTruckPrice: number | null = (order as any)?.truckPrice ? Number((order as any).truckPrice) : null;
  const orderTruckSource: string | null = (order as any)?.truckSource ?? null;

  return res.json({
    rfqId,
    rfqNumber: rfq.rfqNumber,
    orderId: rfq.orderId,
    orderNumber: order?.orderNumber ?? "",
    customerName: order?.customerName ?? "",
    customerPhone: order?.phone ?? null,
    customerEmail: order?.email ?? null,
    serviceType: order?.shipmentType ?? "",
    origin: order?.origin ?? "",
    destination: order?.destination ?? "",
    commodity: order?.commodity ?? null,
    rfqStatus: rfq.status,
    quotedPrice: rfq.quotedPrice ? Number(rfq.quotedPrice) : null,
    quotedAt: rfq.quotedAt?.toISOString() ?? null,
    quoteNotes: rfq.quoteNotes ?? null,
    customerResponseNotes: (rfq as any).customerResponseNotes ?? null,
    customerRespondedAt: (rfq as any).customerRespondedAt
      ? new Date((rfq as any).customerRespondedAt).toISOString() : null,
    finalSellingPrice: order?.finalSellingPrice ? Number(order.finalSellingPrice) : null,
    freightShipmentId,
    stats,
    vendors: vendorRows,
    activities: activities.map((a) => ({
      id: a.id,
      actorType: a.actorType,
      actorName: a.actorName,
      action: a.action,
      description: a.description,
      createdAt: a.createdAt.toISOString(),
    })),
    // Truck assignment data
    productApproved: selectedLink != null,
    truckVendorId: orderTruckVendorId,
    truckVendorName,
    truckPrice: orderTruckPrice,
    truckSource: orderTruckSource,
    productPrice: orderProductPrice,
    totalPrice: (orderProductPrice != null && orderTruckPrice != null)
      ? orderProductPrice + orderTruckPrice
      : orderProductPrice ?? orderTruckPrice ?? null,
    selectedVendorTruckInfo,
    truckVendors: (truckVendors.rows as any[]).map(r => ({
      id: Number(r.id),
      name: r.name,
      phone: r.phone ?? null,
      hasInternalTruck: Boolean(r.has_internal_truck),
      internalTruckPrice: r.internal_truck_price ? Number(r.internal_truck_price) : null,
    })),
    // Step 12: per-item comparison data
    orderItems: orderItemsForComp.map(i => {
      const inp = (i.inputData as Record<string, unknown>) ?? {};
      const qty = Number(inp.qty ?? inp.quantity ?? inp.jumlah ?? 1) || 1;
      const unit = inp.unit ? String(inp.unit) : "unit";
      return { id: i.id, serviceName: i.serviceName, category: i.category, qty, unit };
    }),
    vendorItemOffers: (vendorItemOffersRes.rows as any[]).map(r => ({
      id: Number(r.id),
      rfqVendorLinkId: Number(r.rfq_vendor_link_id),
      vendorId: Number(r.vendor_id),
      orderItemId: r.order_item_id != null ? Number(r.order_item_id) : null,
      serviceName: String(r.service_name ?? ""),
      offeredPrice: r.offered_price != null ? Number(r.offered_price) : null,
      currency: String(r.currency || "IDR"),
      scheduleEtd: r.schedule_etd ?? null,
      scheduleEta: r.schedule_eta ?? null,
      leadTimeDays: r.lead_time_days != null ? Number(r.lead_time_days) : null,
      validityDate: r.validity_date ?? null,
      terms: r.terms ?? null,
      notes: r.notes ?? null,
    })),
  });
});

// ─── ADMIN: POST /rfq/:rfqId/assign-truck ────────────────────────────────────
logisticRfqV2Router.post("/rfq/:rfqId/assign-truck", async (req: Request, res: Response) => {
  if (!(await requireClerkUser(req, res))) return;
  const rfqId = parseInt(String(req.params.rfqId), 10);
  if (isNaN(rfqId)) return res.status(400).json({ message: "rfqId tidak valid" });

  const { source, vendorId, truckPrice: bodyTruckPrice } = req.body as {
    source: "internal" | "external";
    vendorId?: number;
    truckPrice?: number;
  };

  if (!["internal", "external"].includes(source)) {
    return res.status(400).json({ message: "source harus 'internal' atau 'external'" });
  }

  // Load RFQ
  const [rfq] = await db.select({ id: logisticOrderRfqsTable.id, orderId: logisticOrderRfqsTable.orderId })
    .from(logisticOrderRfqsTable).where(eq(logisticOrderRfqsTable.id, rfqId));
  if (!rfq) return res.status(404).json({ message: "RFQ tidak ditemukan" });

  // Load order
  const [order] = await db.select().from(logisticOrdersTable).where(eq(logisticOrdersTable.id, rfq.orderId));
  if (!order) return res.status(404).json({ message: "Order tidak ditemukan" });

  // Get selected product vendor link
  const [selectedLink] = await db.select().from(rfqVendorLinksTable)
    .where(and(eq(rfqVendorLinksTable.rfqId, rfqId), eq(rfqVendorLinksTable.status, "selected")))
    .limit(1);
  if (!selectedLink) {
    return res.status(400).json({ message: "Vendor produk belum dipilih. Pilih vendor produk terlebih dahulu." });
  }

  let resolvedTruckVendorId: number | null = null;
  let resolvedTruckPrice: number | null = null;

  if (source === "internal") {
    // Use internal truck price from the selected product vendor
    const svResult = await db.execute(sql`
      SELECT has_internal_truck, internal_truck_price FROM suppliers WHERE id = ${selectedLink.vendorId}
    `);
    const sv = svResult.rows[0] as any | undefined;
    if (!sv || !sv.has_internal_truck) {
      return res.status(400).json({ message: "Vendor produk tidak memiliki truk internal." });
    }
    resolvedTruckVendorId = selectedLink.vendorId;
    resolvedTruckPrice = sv.internal_truck_price ? Number(sv.internal_truck_price) : 0;
  } else {
    // External: use provided vendorId and truckPrice
    if (!vendorId) return res.status(400).json({ message: "vendorId diperlukan untuk truk eksternal." });
    if (bodyTruckPrice == null || isNaN(Number(bodyTruckPrice))) {
      return res.status(400).json({ message: "truckPrice diperlukan untuk truk eksternal." });
    }
    resolvedTruckVendorId = Number(vendorId);
    resolvedTruckPrice = Number(bodyTruckPrice);
  }

  // Determine product price from selected vendor
  const productPrice = (order as any).productPrice
    ? Number((order as any).productPrice)
    : (selectedLink.offeredPrice ? Number(selectedLink.offeredPrice) : (selectedLink.basicPrice ? Number(selectedLink.basicPrice) : null));

  const totalPrice = (productPrice ?? 0) + (resolvedTruckPrice ?? 0);

  // Update order
  await db.execute(sql`
    UPDATE logistic_orders SET
      truck_vendor_id = ${resolvedTruckVendorId},
      truck_price = ${String(resolvedTruckPrice)},
      truck_source = ${source},
      product_price = ${productPrice != null ? String(productPrice) : null},
      final_selling_price = ${String(totalPrice)},
      updated_at = NOW()
    WHERE id = ${order.id}
  `);

  // Get truck vendor name
  let truckVendorName: string | null = null;
  if (resolvedTruckVendorId) {
    const tvResult = await db.execute(sql`SELECT name FROM suppliers WHERE id = ${resolvedTruckVendorId}`);
    const tv = tvResult.rows[0];
    if (tv) truckVendorName = (tv as any).name ?? null;
  }

  // Kirim WA ke customer
  if (order.phone) {
    sendTruckAssignedCustomerWa(buildOrderData(order), {
      truckVendorName: truckVendorName ?? (source === "internal" ? "Vendor Internal" : "Vendor Eksternal"),
      truckSource: source,
      truckPrice: resolvedTruckPrice,
      productPrice,
      totalPrice,
    }).catch((e: unknown) => logger.error({ e }, "sendTruckAssignedCustomerWa failed"));
  }

  await logActivity(rfqId, "admin", "Admin", "truck_assigned",
    `Vendor truk (${source}) di-assign: ${truckVendorName ?? "—"} | Truk: ${fmtRp(resolvedTruckPrice)} | Total: ${fmtRp(totalPrice)}`);

  return res.json({
    ok: true,
    orderId: order.id,
    truckVendorId: resolvedTruckVendorId,
    truckVendorName,
    truckPrice: resolvedTruckPrice,
    truckSource: source,
    productPrice,
    totalPrice,
  });
});

// ─── ADMIN: POST /rfq/:rfqId/create-freight-shipment ─────────────────────────
logisticRfqV2Router.post("/rfq/:rfqId/create-freight-shipment", async (req: Request, res: Response) => {
  if (!(await requireClerkUser(req, res))) return;
  const rfqId = parseInt(String(req.params.rfqId), 10);
  if (isNaN(rfqId)) return res.status(400).json({ message: "rfqId tidak valid" });

  // Load RFQ
  const rfqRowResult = await db.execute(sql`
    SELECT *, freight_shipment_id FROM logistic_order_rfqs WHERE id = ${rfqId}
  `);
  const rfqRow = rfqRowResult.rows[0];
  const rfq = rfqRow as any;
  if (!rfq) return res.status(404).json({ message: "RFQ tidak ditemukan" });

  // Block if status not customer_approved or closed
  if (!["customer_approved", "closed"].includes(rfq.status)) {
    return res.status(400).json({
      message: `Freight hanya bisa dibuat setelah customer menyetujui penawaran. Status saat ini: ${rfq.status}`,
    });
  }

  // If already created, return existing shipment ID
  if (rfq.freight_shipment_id) {
    return res.json({ ok: true, shipmentId: rfq.freight_shipment_id, alreadyExists: true });
  }

  // Load order
  const [order] = await db.select().from(logisticOrdersTable)
    .where(eq(logisticOrdersTable.id, rfq.order_id));
  if (!order) return res.status(404).json({ message: "Order tidak ditemukan" });

  // Load selected vendor link
  const [selectedLink] = await db.select().from(rfqVendorLinksTable)
    .where(and(eq(rfqVendorLinksTable.rfqId, rfqId), eq(rfqVendorLinksTable.status, "selected")))
    .limit(1);

  let vendorName: string | null = null;
  if (selectedLink) {
    const [vendor] = await db.select({ name: suppliersTable.name })
      .from(suppliersTable).where(eq(suppliersTable.id, selectedLink.vendorId));
    vendorName = vendor?.name ?? null;
  }

  // Compose notes from RFQ data
  const vendorPrice = selectedLink
    ? Number(selectedLink.offeredPrice ?? selectedLink.basicPrice ?? 0) || null
    : null;
  const quotedPrice = rfq.quoted_price ? Number(rfq.quoted_price) : null;
  const noteLines = [
    `Dibuat otomatis dari RFQ ${rfq.rfq_number}`,
    `No. Order: ${order.orderNumber}`,
    `Customer: ${order.customerName}`,
    vendorName ? `Vendor terpilih: ${vendorName}` : null,
    vendorPrice ? `Harga vendor: ${fmtRp(vendorPrice)}` : null,
    quotedPrice ? `Harga jual ke customer: ${fmtRp(quotedPrice)}` : null,
    selectedLink?.eta ? `ETA vendor: ${selectedLink.eta}` : null,
    rfq.quote_notes ? `Catatan: ${rfq.quote_notes}` : null,
  ].filter(Boolean).join("\n");

  // Generate shipment number
  const now = new Date();
  const yr = now.getFullYear();
  const seq = Date.now().toString().slice(-6);
  const shipmentNumber = `FS/${yr}/${seq}`;

  // Create freight shipment
  const [shipment] = await db.insert(freightShipmentsTable).values({
    shipmentNumber,
    shipperName: order.customerName,
    consigneeName: order.namaPenerima || order.customerName,
    commodity: order.commodity || order.shipmentType || "General Cargo",
    origin: order.origin,
    destination: order.destination,
    grossWeight: order.grossWeight ?? order.weightKg ?? null,
    quantity: order.jumlahKoli ?? null,
    transportMode: order.transportMode || order.shipmentType || null,
    portOfLoading: order.originPort ?? null,
    portOfDischarge: order.destPort ?? null,
    approvedVendorName: vendorName,
    actualCost: vendorPrice ? String(vendorPrice) : null,
    notes: noteLines,
    status: "confirmed",
  }).returning();

  // Link freight shipment back to RFQ
  await db.execute(sql`
    UPDATE logistic_order_rfqs SET freight_shipment_id = ${shipment!.id} WHERE id = ${rfqId}
  `);

  // Log activity
  await logActivity(rfqId, "admin", "Admin", "admin_create_freight",
    `Freight Shipment ${shipmentNumber} dibuat otomatis dari RFQ ini`);

  logger.info({ rfqId, shipmentId: shipment!.id, shipmentNumber }, "Freight shipment created from RFQ");

  return res.status(201).json({
    ok: true,
    shipmentId: shipment!.id,
    shipmentNumber: shipment!.shipmentNumber,
    alreadyExists: false,
  });
});

// ─── ADMIN: POST /rfq/:rfqId/select-vendor ───────────────────────────────────
logisticRfqV2Router.post("/rfq/:rfqId/select-vendor", async (req: Request, res: Response) => {
  if (!(await requireClerkUser(req, res))) return;
  const rfqId = parseInt(String(req.params.rfqId), 10);
  if (isNaN(rfqId)) return res.status(400).json({ message: "rfqId tidak valid" });

  const { linkId, sellingPrice } = req.body as { linkId: number; sellingPrice?: number };
  if (!linkId) return res.status(400).json({ message: "linkId wajib diisi" });

  const [link] = await db.select().from(rfqVendorLinksTable)
    .where(and(eq(rfqVendorLinksTable.id, linkId), eq(rfqVendorLinksTable.rfqId, rfqId)));
  if (!link) return res.status(404).json({ message: "Link vendor tidak ditemukan" });

  const [[vendor], [rfqRow]] = await Promise.all([
    db.select({ name: suppliersTable.name, phone: suppliersTable.phone }).from(suppliersTable).where(eq(suppliersTable.id, link.vendorId)),
    db.select({
      rfqNumber: logisticOrderRfqsTable.rfqNumber,
      orderId: logisticOrderRfqsTable.orderId,
    }).from(logisticOrderRfqsTable).where(eq(logisticOrderRfqsTable.id, rfqId)),
  ]);

  await transitionVendorLinkStatus(linkId, "selected", {
    actorType: "admin",
    actorName: "Admin",
    source: "select-vendor",
    force: true,
  });

  const otherLinks = await db.select({
    id: rfqVendorLinksTable.id,
    status: rfqVendorLinksTable.status,
    vendorId: rfqVendorLinksTable.vendorId,
  }).from(rfqVendorLinksTable)
    .where(and(eq(rfqVendorLinksTable.rfqId, rfqId), sql`id != ${linkId}`));

  // Status yang menandakan vendor sudah berikan penawaran (layak dapat notifikasi)
  const RESPONDED_STATUSES = ["accepted_basic_price", "counter_offer", "late_response"];

  for (const other of otherLinks) {
    if (!["rejected", "expired", "late_response"].includes(other.status)) {
      await transitionVendorLinkStatus(other.id, "not_selected", {
        actorType: "admin",
        actorName: "Admin",
        source: "select-vendor/deselect-others",
        force: true,
      });
      // Kirim WA notif hanya ke vendor yang sudah merespons dengan penawaran
      if (RESPONDED_STATUSES.includes(other.status) && other.vendorId) {
        db.select({ name: suppliersTable.name, phone: suppliersTable.phone })
          .from(suppliersTable)
          .where(eq(suppliersTable.id, other.vendorId))
          .then(([vRow]) => {
            if (vRow?.phone) {
              sendVendorNotSelectedWa({
                vendorName: vRow.name ?? `Vendor #${other.vendorId}`,
                vendorPhone: vRow.phone,
                rfqNumber: rfqRow?.rfqNumber ?? `RFQ#${rfqId}`,
                orderNumber: orderRow?.orderNumber ?? "",
                route: `${orderRow?.origin ?? "—"} → ${orderRow?.destination ?? "—"}`,
              }).catch(() => {});
            }
          })
          .catch(() => {});
      }
    }
  }

  await transitionRfqStatus(rfqId, "vendor_selected", {
    actorType: "admin",
    actorName: "Admin",
    source: "select-vendor",
  });

  const orderId = rfqRow?.orderId ?? 0;

  let orderRow: typeof logisticOrdersTable.$inferSelect | undefined;
  if (orderId) {
    const rows = await db.select().from(logisticOrdersTable).where(eq(logisticOrdersTable.id, orderId));
    orderRow = rows[0];
  }

  if (sellingPrice && orderId) {
    await db.update(logisticOrdersTable)
      .set({ finalSellingPrice: String(sellingPrice), approvedVendorId: link.vendorId })
      .where(eq(logisticOrdersTable.id, orderId));
  }

  const vendorName = vendor?.name ?? `Vendor #${link.vendorId}`;
  await logActivity(rfqId, "admin", "Admin", "admin_select_vendor",
    `Admin memilih vendor: ${vendorName} — ${fmtRp(link.offeredPrice ?? link.basicPrice)}`);

  // Kirim WA "Penawaran Anda Dipilih" ke vendor
  const domain = getPreferredDomain() || "cstlogistic.co.id";
  if (vendor?.phone) {
    const vendorFormUrl = `https://${domain}/vendor-form/${link.token}`;
    sendVendorAwardedWa({
      vendorName,
      vendorPhone: vendor.phone,
      rfqNumber: rfqRow?.rfqNumber ?? `RFQ#${rfqId}`,
      orderNumber: orderRow?.orderNumber ?? "",
      shipmentType: orderRow?.shipmentType ?? "—",
      origin: orderRow?.origin ?? "—",
      destination: orderRow?.destination ?? "—",
      vendorCost: link.offeredPrice ?? link.basicPrice,
      eta: link.eta ?? null,
      notes: link.notes ?? null,
      fulfillUrl: vendorFormUrl,
    }).catch(() => {});
  }

  // Kirim WA notif ke admin grup bahwa vendor sudah dipilih
  sendVendorSelectedAdminWa({
    rfqNumber: rfqRow?.rfqNumber ?? `RFQ#${rfqId}`,
    orderNumber: orderRow?.orderNumber ?? "",
    customerName: orderRow?.customerName ?? "—",
    shipmentType: orderRow?.shipmentType ?? "—",
    origin: orderRow?.origin ?? "—",
    destination: orderRow?.destination ?? "—",
    vendorName,
    vendorCost: link.offeredPrice ?? link.basicPrice,
    sellingPrice: sellingPrice ?? null,
    eta: link.eta ?? null,
    quoteSentToCustomer: false,
    forwardVendorUrl: vendor?.phone ? `https://${domain}/vendor-form/${link.token}` : null,
  }).catch(() => {});

  return res.json({ ok: true, selectedVendorName: vendorName });
});

// ─── ADMIN: POST /rfq/:rfqId/vendor-link/:linkId/action ──────────────────────
logisticRfqV2Router.post("/rfq/:rfqId/vendor-link/:linkId/action", async (req: Request, res: Response) => {
  if (!(await requireClerkUser(req, res))) return;
  const rfqId = parseInt(String(req.params.rfqId), 10);
  const linkId = parseInt(String(req.params.linkId), 10);
  if (isNaN(rfqId) || isNaN(linkId)) return res.status(400).json({ message: "ID tidak valid" });

  const { action, message: actionMsg } = req.body as { action: "request_revision" | "reject" | "mark_read"; message?: string };
  if (!action) return res.status(400).json({ message: "action wajib diisi" });

  const [link] = await db.select().from(rfqVendorLinksTable)
    .where(and(eq(rfqVendorLinksTable.id, linkId), eq(rfqVendorLinksTable.rfqId, rfqId)));
  if (!link) return res.status(404).json({ message: "Link tidak ditemukan" });

  const [vendor] = await db.select({ name: suppliersTable.name, phone: suppliersTable.phone })
    .from(suppliersTable).where(eq(suppliersTable.id, link.vendorId));
  const vendorName = vendor?.name ?? `Vendor #${link.vendorId}`;

  if (action === "mark_read") {
    await db.update(rfqVendorLinksTable).set({ isNewUpdate: false })
      .where(eq(rfqVendorLinksTable.id, linkId));
    return res.json({ ok: true });
  }

  if (action === "reject") {
    await transitionVendorLinkStatus(linkId, "not_selected", {
      actorType: "admin",
      actorName: "Admin",
      source: "vendor-link-action/reject",
      force: true,
    });
    await logActivity(rfqId, "admin", "Admin", "admin_reject_vendor",
      `Admin menolak vendor: ${vendorName}`);
    // Kirim WA notifikasi ke vendor bahwa penawarannya tidak dipilih
    if (vendor?.phone) {
      const [rfqInfo] = await db.select({ rfqNumber: logisticOrderRfqsTable.rfqNumber, orderId: logisticOrderRfqsTable.orderId })
        .from(logisticOrderRfqsTable).where(eq(logisticOrderRfqsTable.id, rfqId));
      const orderRow = rfqInfo?.orderId
        ? (await db.select({ orderNumber: logisticOrdersTable.orderNumber, origin: logisticOrdersTable.origin, destination: logisticOrdersTable.destination })
            .from(logisticOrdersTable).where(eq(logisticOrdersTable.id, rfqInfo.orderId)))[0] ?? null
        : null;
      sendVendorNotSelectedWa({
        vendorName,
        vendorPhone: vendor.phone,
        rfqNumber: rfqInfo?.rfqNumber ?? `RFQ#${rfqId}`,
        orderNumber: orderRow?.orderNumber ?? "",
        route: `${orderRow?.origin ?? "—"} → ${orderRow?.destination ?? "—"}`,
      }).catch(() => {});
    }
    return res.json({ ok: true });
  }

  if (action === "request_revision") {
    if (vendor?.phone) {
      const [rfq] = await db.select({ rfqNumber: logisticOrderRfqsTable.rfqNumber, orderId: logisticOrderRfqsTable.orderId })
        .from(logisticOrderRfqsTable).where(eq(logisticOrderRfqsTable.id, rfqId));
      const formUrl = getVendorFormUrl(link.token);
      const currentPrice = link.offeredPrice ?? link.basicPrice;
      const [order] = rfq?.orderId
        ? await db.select().from(logisticOrdersTable).where(eq(logisticOrdersTable.id, rfq.orderId))
        : [];
      if (order) {
        sendVendorRevisionNotification(
          buildOrderData(order),
          vendorName,
          vendor.phone,
          currentPrice ? fmtRp(currentPrice) : "-",
          formUrl,
        ).catch(() => {});
      } else if (actionMsg) {
        sendVendorRevisionFallbackNotification(
          vendor.phone,
          vendorName,
          rfq?.rfqNumber ?? null,
          actionMsg,
          formUrl,
          String(rfqId),
        ).catch(() => {});
      }
    }
    await logActivity(rfqId, "admin", "Admin", "admin_request_revision",
      `Admin minta revisi dari ${vendorName}: ${actionMsg ?? ""}`);
    return res.json({ ok: true });
  }

  return res.status(400).json({ message: "action tidak dikenal" });
});

// ─── ADMIN: POST /rfq/:rfqId/send-customer-quote ─────────────────────────────
// Admin kirim penawaran harga ke customer setelah memilih vendor
logisticRfqV2Router.post("/rfq/:rfqId/send-customer-quote", async (req: Request, res: Response) => {
  if (!(await requireClerkUser(req, res))) return;
  const rfqId = parseInt(String(req.params.rfqId), 10);
  if (isNaN(rfqId)) return res.status(400).json({ message: "rfqId tidak valid" });

  const [rfq] = await db.select().from(logisticOrderRfqsTable)
    .where(eq(logisticOrderRfqsTable.id, rfqId));
  if (!rfq) return res.status(404).json({ message: "RFQ tidak ditemukan" });

  if (!["vendor_selected", "customer_revision_requested"].includes(rfq.status)) {
    return res.status(400).json({
      message: `Status RFQ saat ini '${rfq.status}'. Harus vendor_selected atau customer_revision_requested untuk kirim penawaran.`,
    });
  }

  const { sellingPrice, quoteNotes, sendWhatsApp: doSendWa = true } = req.body as {
    sellingPrice: number;
    quoteNotes?: string;
    sendWhatsApp?: boolean;
  };

  if (!sellingPrice || sellingPrice <= 0) {
    return res.status(400).json({ message: "sellingPrice wajib diisi" });
  }

  const [order] = await db.select().from(logisticOrdersTable)
    .where(eq(logisticOrdersTable.id, rfq.orderId));
  if (!order) return res.status(404).json({ message: "Order tidak ditemukan" });

  // Cari vendor yang dipilih untuk info WA message
  const selectedLink = await db.select().from(rfqVendorLinksTable)
    .where(and(eq(rfqVendorLinksTable.rfqId, rfqId), eq(rfqVendorLinksTable.status, "selected")))
    .limit(1)
    .then((r) => r[0]);

  const [selectedVendor] = selectedLink
    ? await db.select({ name: suppliersTable.name }).from(suppliersTable)
        .where(eq(suppliersTable.id, selectedLink.vendorId))
    : [];

  // Simpan quote ke RFQ
  await transitionRfqStatus(rfqId, "customer_quoted", {
    actorType: "admin",
    actorName: "Admin",
    source: "send-customer-quote",
  });
  await db.execute(sql`
    UPDATE logistic_order_rfqs
    SET quoted_price = ${sellingPrice},
        quoted_at = NOW(),
        quote_notes = ${quoteNotes ?? null}
    WHERE id = ${rfqId}
  `);

  // Update order: final selling price
  await db.update(logisticOrdersTable)
    .set({ finalSellingPrice: String(sellingPrice) })
    .where(eq(logisticOrdersTable.id, rfq.orderId));

  // Kirim WA ke customer via template
  let waSent = false;
  if (doSendWa && order.phone) {
    const domain = getPreferredDomain();
    const customerApprovalLink = domain
      ? `https://${domain}/approve/${order.orderNumber}`
      : `/approve/${order.orderNumber}`;
    const waTotal = order.grandTotal ? Number(order.grandTotal) : sellingPrice;
    const waPpnPct = 11;
    const waPpnNominal = Math.round(waTotal * waPpnPct / (100 + waPpnPct));
    sendCustomerApprovalNotification(
      buildOrderData(order),
      fmtRp(waTotal),
      customerApprovalLink,
      {
        sellingPriceNum: waTotal,
        ppnNominalNum: waPpnNominal,
        ppnPct: waPpnPct,
      },
    ).then(() => { waSent = true; }).catch(() => {});
  }

  await logActivity(rfqId, "admin", "Admin", "admin_send_customer_quote",
    `Admin kirim penawaran ke customer ${order.customerName}: ${fmtRp(sellingPrice)}${waSent ? " — WA terkirim" : ""}`);

  return res.json({
    ok: true,
    rfqId,
    rfqNumber: rfq.rfqNumber,
    customerName: order.customerName,
    sellingPrice,
    waSent,
  });
});

// ─── PUBLIC: POST /rfq/quote-respond — customer merespons penawaran ──────────
// Body: { orderNumber, response: "approved"|"revision_requested"|"rejected", notes? }
logisticRfqV2Router.post("/rfq/quote-respond", async (req: Request, res: Response) => {
  const { orderNumber, response, notes } = req.body as {
    orderNumber: string;
    response: "approved" | "revision_requested" | "rejected";
    notes?: string;
  };

  if (!orderNumber || !response) {
    return res.status(400).json({ message: "orderNumber dan response wajib diisi" });
  }
  if (!["approved", "revision_requested", "rejected"].includes(response)) {
    return res.status(400).json({ message: "response tidak valid" });
  }

  const [order] = await db.select().from(logisticOrdersTable)
    .where(eq(logisticOrdersTable.orderNumber, orderNumber.toUpperCase().trim()));
  if (!order) return res.status(404).json({ message: "Order tidak ditemukan" });

  // Cari RFQ aktif dengan status customer_quoted
  const [rfq] = await db.select().from(logisticOrderRfqsTable)
    .where(and(
      eq(logisticOrderRfqsTable.orderId, order.id),
      eq(logisticOrderRfqsTable.status, "customer_quoted")
    ))
    .orderBy(sql`created_at DESC`)
    .limit(1);

  if (!rfq) {
    return res.status(400).json({
      message: "Tidak ada penawaran aktif untuk order ini. Status mungkin sudah berubah.",
    });
  }

  const newStatus =
    response === "approved" ? "customer_approved" :
    response === "revision_requested" ? "customer_revision_requested" :
    "customer_rejected";

  await transitionRfqStatus(rfq.id, newStatus, {
    actorType: "customer",
    actorName: order?.customerName ?? "Customer",
    source: "quote-respond",
  });
  await db.execute(sql`
    UPDATE logistic_order_rfqs
    SET customer_response_notes = ${notes ?? null},
        customer_responded_at = NOW()
    WHERE id = ${rfq.id}
  `);

  // Notif WA ke admin group
  const adminWa = await getAdminGroupWa().catch(() => null);
  if (adminWa) {
    sendCustomerRfqResponseAdminNotification(adminWa, {
      response,
      customerName: order.customerName,
      orderNumber: order.orderNumber,
      shipmentType: order.shipmentType,
      origin: order.origin,
      destination: order.destination,
      quotedPrice: rfq.quotedPrice ? fmtRp(rfq.quotedPrice) : null,
      notes: notes ?? null,
    }).catch(() => {});
  }

  // Jika customer approve → kirim otomatis WA OP Request ke vendor
  if (response === "approved") {
    const selectedLink = await db.select({
      id: rfqVendorLinksTable.id,
      token: rfqVendorLinksTable.token,
      vendorId: rfqVendorLinksTable.vendorId,
    }).from(rfqVendorLinksTable)
      .where(and(eq(rfqVendorLinksTable.rfqId, rfq.id), eq(rfqVendorLinksTable.status, "selected")))
      .limit(1)
      .then((r) => r[0]);

    if (selectedLink) {
      const [selectedVendor] = await db.select({ name: suppliersTable.name, phone: suppliersTable.phone })
        .from(suppliersTable).where(eq(suppliersTable.id, selectedLink.vendorId));

      if (selectedVendor?.phone) {
        const opDomain = getPreferredDomain() || "cstlogistic.co.id";
        const operationalFormLink = `https://${opDomain}/vendor-form/${selectedLink.token}`;
        sendOpRequestNotification(
          buildOrderData(order),
          selectedVendor.name ?? `Vendor #${selectedLink.vendorId}`,
          selectedVendor.phone,
          operationalFormLink,
          null,
        ).catch(() => {});
      }
    }
  }

  await logActivity(rfq.id, "customer", order.customerName, `customer_${response}`,
    `Customer ${order.customerName} ${
      response === "approved" ? "menyetujui" :
      response === "revision_requested" ? "minta revisi" : "menolak"
    } penawaran${notes ? `: ${notes}` : ""}`);

  return res.json({ ok: true, rfqId: rfq.id, newStatus });
});

// ─── ADMIN: POST /rfq/:rfqId/close — tutup RFQ ───────────────────────────────
logisticRfqV2Router.post("/rfq/:rfqId/close", async (req: Request, res: Response) => {
  if (!(await requireClerkUser(req, res))) return;
  const rfqId = parseInt(String(req.params.rfqId), 10);
  if (isNaN(rfqId)) return res.status(400).json({ message: "rfqId tidak valid" });

  const [rfq] = await db.select().from(logisticOrderRfqsTable)
    .where(eq(logisticOrderRfqsTable.id, rfqId));
  if (!rfq) return res.status(404).json({ message: "RFQ tidak ditemukan" });

  const { notes, updateOrderStatus } = req.body as { notes?: string; updateOrderStatus?: boolean };

  await transitionRfqStatus(rfqId, "closed", { actorType: "admin", actorName: "Admin", source: "close-rfq", force: true });

  if (updateOrderStatus !== false && rfq.status === "customer_approved") {
    await transitionLogisticOrderStatus(rfq.orderId, "In Progress", {
      actorType: "admin",
      actorName: "Admin",
      source: "close-rfq",
      force: true,
      skipAudit: false,
    });
  }

  const [order] = await db.select({ customerName: logisticOrdersTable.customerName, orderNumber: logisticOrdersTable.orderNumber })
    .from(logisticOrdersTable).where(eq(logisticOrdersTable.id, rfq.orderId));

  await logActivity(rfqId, "admin", "Admin", "rfq_closed",
    `RFQ ditutup${notes ? `: ${notes}` : ""}`);

  return res.json({ ok: true, rfqId, rfqNumber: rfq.rfqNumber, orderNumber: order?.orderNumber });
});

// ─── ADMIN: PATCH /rfq/vendor-link/:linkId/refresh-price ─────────────────────
// Refresh basicPrice dari katalog vendor terkini (tanpa mengubah status/offer vendor)
logisticRfqV2Router.patch("/rfq/vendor-link/:linkId/refresh-price", async (req: Request, res: Response) => {
  if (!(await requireClerkUser(req, res))) return;
  const linkId = parseInt(String(req.params.linkId), 10);
  if (isNaN(linkId)) return res.status(400).json({ message: "linkId tidak valid" });

  const [link] = await db.select().from(rfqVendorLinksTable).where(eq(rfqVendorLinksTable.id, linkId));
  if (!link) return res.status(404).json({ message: "Vendor link tidak ditemukan" });

  const catalogItems = await db.select().from(vendorCatalogItemsTable)
    .where(and(eq(vendorCatalogItemsTable.vendorId, link.vendorId), eq(vendorCatalogItemsTable.isActive, true)));
  if (catalogItems.length === 0) return res.status(404).json({ message: "Tidak ada item etalase aktif untuk vendor ini" });

  const newPrice = Number(catalogItems[0].priceBase);
  const oldPrice = link.basicPrice ? Number(link.basicPrice) : null;

  await db.update(rfqVendorLinksTable)
    .set({ basicPrice: String(newPrice) })
    .where(eq(rfqVendorLinksTable.id, linkId));

  await logActivity(
    link.rfqId,
    "admin",
    "Admin",
    "refresh_price",
    `Harga referensi vendor link #${linkId} diperbarui dari etalase: ${fmtRp(oldPrice)} → ${fmtRp(newPrice)}`,
  );

  return res.json({ ok: true, oldPrice, newPrice });
});

// ─── ADMIN: GET /rfq/by-order/:orderId ────────────────────────────────────────
logisticRfqV2Router.get("/rfq/by-order/:orderId", async (req: Request, res: Response) => {
  if (!(await requireClerkUser(req, res))) return;
  const orderId = parseInt(String(req.params.orderId), 10);
  if (isNaN(orderId)) return res.status(400).json({ message: "orderId tidak valid" });

  const rfqs = await db.select().from(logisticOrderRfqsTable)
    .where(eq(logisticOrderRfqsTable.orderId, orderId))
    .orderBy(sql`created_at DESC`);

  const result = await Promise.all(rfqs.map(async (rfq) => {
    const links = await db.select({ status: rfqVendorLinksTable.status })
      .from(rfqVendorLinksTable).where(eq(rfqVendorLinksTable.rfqId, rfq.id));
    return {
      rfqId: rfq.id,
      rfqNumber: rfq.rfqNumber,
      status: rfq.status,
      vendorCount: links.length,
      answeredCount: links.filter((l) => l.status !== "waiting_response" && l.status !== "expired").length,
      comparisonUrl: `/logistics/rfq/${rfq.id}/comparison`,
    };
  }));

  return res.json(result);
});

// ─── STEP 14: GET /rfq/:rfqId/customer-data-check ────────────────────────────
// Cek kelengkapan data customer berdasarkan service type
logisticRfqV2Router.get("/rfq/:rfqId/customer-data-check", async (req: Request, res: Response) => {
  if (!(await requireClerkUser(req, res))) return;
  const rfqId = parseInt(String(req.params.rfqId), 10);
  if (isNaN(rfqId)) return res.status(400).json({ message: "rfqId tidak valid" });

  const [rfq] = await db.select().from(logisticOrderRfqsTable)
    .where(eq(logisticOrderRfqsTable.id, rfqId));
  if (!rfq) return res.status(404).json({ message: "RFQ tidak ditemukan" });

  const [order] = await db.select().from(logisticOrdersTable)
    .where(eq(logisticOrdersTable.id, rfq.orderId));
  if (!order) return res.status(404).json({ message: "Order tidak ditemukan" });

  const items = await db.select({
    id: logisticOrderItemsTable.id,
    serviceName: logisticOrderItemsTable.serviceName,
    inputData: logisticOrderItemsTable.inputData,
  }).from(logisticOrderItemsTable).where(eq(logisticOrderItemsTable.orderId, order.id));

  const itemData = items[0]?.inputData as Record<string, unknown> | null ?? {};

  const sType = (order.shipmentType ?? "").toLowerCase();
  const isAir     = sType.includes("air") || sType.includes("udara") || sType.includes("ff_udara");
  const isSea     = sType.includes("sea") || sType.includes("laut") || sType.includes("ocean") || sType.includes("ff_laut");
  const isPpjk    = sType.includes("ppjk") || sType.includes("pabean");
  const isTruck   = sType.includes("truck") || sType.includes("trucking");
  const isWH      = sType.includes("warehouse") || sType.includes("gudang");

  interface DataField {
    key: string;
    label: string;
    value: string | null;
    required: boolean;
    complete: boolean;
  }

  const fields: DataField[] = [];

  const chk = (key: string, label: string, val: unknown, required = true): DataField => ({
    key, label,
    value: val != null && String(val).trim() !== "" ? String(val) : null,
    required,
    complete: val != null && String(val).trim() !== "",
  });

  // Data umum (semua tipe)
  fields.push(chk("customerName", "Nama Customer/Shipper", order.customerName));
  fields.push(chk("phone", "Nomor WA Customer", order.phone));
  fields.push(chk("origin", "Origin/Kota Asal", order.origin));
  fields.push(chk("destination", "Destination/Kota Tujuan", order.destination));
  fields.push(chk("commodity", "Komoditi", order.commodity, false));
  fields.push(chk("grossWeight", "Berat (kg)", order.grossWeight, false));

  // Data per tipe layanan
  if (isAir || isSea) {
    fields.push(chk("shipperName", "Nama Shipper", itemData.shipperName ?? itemData.shipper_name ?? order.customerName, false));
    fields.push(chk("consigneeName", "Nama Consignee", itemData.consigneeName ?? itemData.consignee_name ?? order.namaPenerima, false));
    fields.push(chk("hsCode", "HS Code", itemData.hsCode ?? itemData.hs_code ?? (order as any).hsCode, false));
    if (isAir) {
      fields.push(chk("awbInstruction", "Instruksi AWB", itemData.awbInstruction ?? itemData.awb_instruction, false));
    }
    if (isSea) {
      fields.push(chk("blInstruction", "Instruksi BL", itemData.blInstruction ?? itemData.bl_instruction, false));
      fields.push(chk("containerType", "Tipe Container", itemData.containerType ?? itemData.container_type, false));
    }
  }

  if (isPpjk) {
    fields.push(chk("npwp", "NPWP Importir/Eksportir", itemData.npwp, true));
    fields.push(chk("nib", "NIB", itemData.nib, false));
    fields.push(chk("hsCode", "HS Code", itemData.hsCode ?? itemData.hs_code ?? (order as any).hsCode, true));
  }

  if (isTruck) {
    fields.push(chk("pickupAddress", "Alamat Pickup", itemData.pickupAddress ?? itemData.pickup_address ?? order.origin, false));
    fields.push(chk("deliveryAddress", "Alamat Tujuan", itemData.deliveryAddress ?? itemData.delivery_address ?? order.destination, false));
    fields.push(chk("picPickup", "PIC Pickup", itemData.picPickup ?? itemData.pic_pickup, false));
    fields.push(chk("truckType", "Tipe Kendaraan", order.truckType, false));
  }

  if (isWH) {
    fields.push(chk("skuList", "Daftar SKU", itemData.skuList ?? itemData.sku_list, false));
    fields.push(chk("inboundQty", "Qty Inbound", itemData.inboundQty ?? itemData.inbound_qty, false));
  }

  // Notes umum
  fields.push(chk("notes", "Catatan Tambahan", order.notes, false));

  const requiredFields = fields.filter((f) => f.required);
  const allComplete = requiredFields.every((f) => f.complete);
  const missingRequired = requiredFields.filter((f) => !f.complete);

  // Status pengiriman data dari DB
  const rfqExtra = rfq as Record<string, unknown>;

  return res.json({
    rfqId,
    orderId: order.id,
    orderNumber: order.orderNumber,
    customerName: order.customerName,
    shipmentType: order.shipmentType,
    fields,
    allComplete,
    missingRequired: missingRequired.map((f) => f.label),
    customerDataSentAt: rfqExtra.customer_data_sent_at ?? null,
    customerDataSentBy: rfqExtra.customer_data_sent_by ?? null,
    customerDataRequestSentAt: rfqExtra.customer_data_request_sent_at ?? null,
  });
});

// ─── STEP 14: POST /rfq/:rfqId/send-customer-data ────────────────────────────
// Kirim data master customer ke vendor via WA
logisticRfqV2Router.post("/rfq/:rfqId/send-customer-data", async (req: Request, res: Response) => {
  if (!(await requireClerkUser(req, res))) return;
  const rfqId = parseInt(String(req.params.rfqId), 10);
  if (isNaN(rfqId)) return res.status(400).json({ message: "rfqId tidak valid" });

  const [rfq] = await db.select().from(logisticOrderRfqsTable)
    .where(eq(logisticOrderRfqsTable.id, rfqId));
  if (!rfq) return res.status(404).json({ message: "RFQ tidak ditemukan" });

  const [order] = await db.select().from(logisticOrdersTable)
    .where(eq(logisticOrdersTable.id, rfq.orderId));
  if (!order) return res.status(404).json({ message: "Order tidak ditemukan" });

  const [selectedLink] = await db.select().from(rfqVendorLinksTable)
    .where(and(eq(rfqVendorLinksTable.rfqId, rfqId), eq(rfqVendorLinksTable.status, "selected")))
    .limit(1);
  if (!selectedLink) return res.status(400).json({ message: "Tidak ada vendor terpilih" });

  const [vendor] = await db.select().from(suppliersTable)
    .where(eq(suppliersTable.id, selectedLink.vendorId));
  if (!vendor) return res.status(404).json({ message: "Vendor tidak ditemukan" });

  const items = await db.select({
    serviceName: logisticOrderItemsTable.serviceName,
    inputData: logisticOrderItemsTable.inputData,
    subtotal: logisticOrderItemsTable.subtotal,
  }).from(logisticOrderItemsTable).where(eq(logisticOrderItemsTable.orderId, order.id));

  const itemData = items[0]?.inputData as Record<string, unknown> | null ?? {};
  const sType = (order.shipmentType ?? "").toLowerCase();
  const isAir  = sType.includes("air") || sType.includes("udara");
  const isSea  = sType.includes("sea") || sType.includes("laut") || sType.includes("ocean");
  const isPpjk = sType.includes("ppjk");
  const isTruck = sType.includes("truck");

  const val = (v: unknown) => (v != null && String(v).trim() !== "" ? String(v) : "—");

  const dataLines: string[] = [
    `📋 *DATA MASTER CUSTOMER — ${order.orderNumber}*`,
    `━━━━━━━━━━━━━━━━━━`,
    `No. Order   : ${order.orderNumber}`,
    `Customer    : ${order.customerName}`,
    `No. WA      : ${val(order.phone)}`,
    `Email       : ${val(order.email)}`,
    `Layanan     : ${order.shipmentType}`,
    `Origin      : ${val(order.origin)}`,
    `Destination : ${val(order.destination)}`,
    `Komoditi    : ${val(order.commodity)}`,
    `Berat       : ${val(order.grossWeight)} kg`,
    `Volume      : ${val(order.volumeCbm)} CBM`,
    `Koli        : ${val(order.jumlahKoli)}`,
    `━━━━━━━━━━━━━━━━━━`,
  ];

  if (isAir || isSea) {
    dataLines.push(`Shipper     : ${val(itemData.shipperName ?? order.customerName)}`);
    dataLines.push(`Consignee   : ${val(itemData.consigneeName ?? order.namaPenerima)}`);
    dataLines.push(`HS Code     : ${val(itemData.hsCode ?? (order as any).hsCode)}`);
    if (isAir) dataLines.push(`AWB Instr.  : ${val(itemData.awbInstruction)}`);
    if (isSea) {
      dataLines.push(`BL Instr.   : ${val(itemData.blInstruction)}`);
      dataLines.push(`Container   : ${val(itemData.containerType)}`);
    }
  }

  if (isPpjk) {
    dataLines.push(`NPWP        : ${val(itemData.npwp)}`);
    dataLines.push(`NIB         : ${val(itemData.nib)}`);
    dataLines.push(`HS Code     : ${val(itemData.hsCode ?? (order as any).hsCode)}`);
  }

  if (isTruck) {
    dataLines.push(`Pickup      : ${val(itemData.pickupAddress ?? order.origin)}`);
    dataLines.push(`Tujuan      : ${val(itemData.deliveryAddress ?? order.destination)}`);
    dataLines.push(`PIC Pickup  : ${val(itemData.picPickup)}`);
    dataLines.push(`Kendaraan   : ${val(order.truckType)}`);
  }

  if (order.notes) dataLines.push(`Catatan     : ${order.notes}`);
  dataLines.push(`━━━━━━━━━━━━━━━━━━`);
  dataLines.push(`_Data ini dikirim dari sistem B2B Marketplace and Logistic — ${new Date().toLocaleString("id-ID", { timeZone: "Asia/Jakarta" })}_`);

  const msg = dataLines.join("\n");

  let waSent = false;
  if (vendor.phone) {
    await sendWhatsApp(vendor.phone, msg, { context: "customer-data-to-vendor" });
    waSent = true;
  }

  await db.execute(sql`
    UPDATE logistic_order_rfqs
    SET customer_data_sent_at = NOW(), customer_data_sent_by = 'admin'
    WHERE id = ${rfqId}
  `);

  await logActivity(rfqId, "admin", "Admin", "customer_data_sent",
    `Data customer ${order.customerName} dikirim ke vendor ${vendor.name}`);

  const adminGroupWa = await getAdminGroupWa().catch(() => null);
  if (adminGroupWa) {
    const adminMsg = `📋 *DATA CUSTOMER DIKIRIM — ${order.orderNumber}*\n\nData master customer telah dikirim ke vendor *${vendor.name ?? ""}*.\nOrder: ${order.orderNumber}\nCustomer: ${order.customerName}\n\n_${new Date().toLocaleString("id-ID", { timeZone: "Asia/Jakarta" })}_`;
    sendWhatsApp(adminGroupWa, adminMsg, { context: "customer-data-sent-admin" }).catch(() => {});
  }

  return res.json({
    ok: true, waSent, vendorName: vendor.name,
    message: waSent ? `Data customer berhasil dikirim ke ${vendor.name}` : "Data customer disimpan (vendor tidak punya nomor WA)",
  });
});

// ─── STEP 14: POST /rfq/:rfqId/request-customer-data ─────────────────────────
// Kirim WA ke customer untuk minta data yang belum lengkap
logisticRfqV2Router.post("/rfq/:rfqId/request-customer-data", async (req: Request, res: Response) => {
  if (!(await requireClerkUser(req, res))) return;
  const rfqId = parseInt(String(req.params.rfqId), 10);
  if (isNaN(rfqId)) return res.status(400).json({ message: "rfqId tidak valid" });

  const { missingFields, customMessage } = req.body as {
    missingFields?: string[];
    customMessage?: string;
  };

  const [rfq] = await db.select().from(logisticOrderRfqsTable)
    .where(eq(logisticOrderRfqsTable.id, rfqId));
  if (!rfq) return res.status(404).json({ message: "RFQ tidak ditemukan" });

  const [order] = await db.select().from(logisticOrdersTable)
    .where(eq(logisticOrdersTable.id, rfq.orderId));
  if (!order) return res.status(404).json({ message: "Order tidak ditemukan" });

  if (!order.phone) return res.status(400).json({ message: "Nomor WA customer tidak tersedia" });

  const missing = missingFields && missingFields.length > 0
    ? missingFields
    : ["Data lengkap diperlukan untuk memproses pengiriman Anda"];

  const msgLines = [
    `📋 *KELENGKAPAN DATA PENGIRIMAN*`,
    ``,
    `Yth. ${order.customerName},`,
    ``,
    `Terima kasih telah mengkonfirmasi pesanan *${order.orderNumber}*.`,
    ``,
    `Untuk memproses pengiriman Anda, kami memerlukan kelengkapan data berikut:`,
    ``,
    ...missing.map((f, i) => `${i + 1}. ${f}`),
    ``,
    customMessage ? customMessage : "",
    `Mohon segera membalas WhatsApp ini atau menghubungi tim B2B Marketplace and Logistic.`,
    ``,
    `Terima kasih 🙏`,
    `_${new Date().toLocaleString("id-ID", { timeZone: "Asia/Jakarta" })}_`,
  ].filter((l, i) => l !== "" || i !== 10);

  const msg = msgLines.join("\n");

  await sendWhatsApp(order.phone, msg, { context: "customer-data-request" });

  await db.execute(sql`
    UPDATE logistic_order_rfqs
    SET customer_data_request_sent_at = NOW()
    WHERE id = ${rfqId}
  `);

  await logActivity(rfqId, "admin", "Admin", "customer_data_requested",
    `Permintaan data ke customer ${order.customerName}: ${missing.join(", ")}`);

  return res.json({
    ok: true,
    message: `Permintaan data berhasil dikirim ke customer (${order.phone})`,
  });
});
