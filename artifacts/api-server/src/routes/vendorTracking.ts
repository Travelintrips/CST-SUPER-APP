import { Router, type Request, type Response } from "express";
import { randomBytes } from "crypto";
import { eq, and, sql } from "drizzle-orm";
import {
  db,
  logisticOrdersTable,
  logisticOrderRfqsTable,
  rfqVendorLinksTable,
  suppliersTable,
  customerInvoiceLinksTable,
  freightShipmentsTable,
  vmfActivityLogTable,
} from "@workspace/db";
import { requireClerkUser } from "../lib/requireAdmin.js";
import { sendViaService as sendWhatsApp } from "../lib/waTransport.js";
import { getAdminGroupWa } from "../lib/adminWa.js";
import { getPreferredDomain } from "../lib/domain.js";
import { normalizeCompanyId } from "../lib/services/portalCompanyScopeUtils.js";
import { logger } from "../lib/logger.js";
import { transitionLogisticOrderStatus } from "../lib/services/logisticOrderStatusService.js";
import rateLimit from "express-rate-limit";

export const vendorTrackingAdminRouter = Router();
export const vendorTrackingPublicRouter = Router();

// ─── Vendor Tracking Status Enum ─────────────────────────────────────────────
export const VENDOR_TRACKING_STATUSES = [
  "RECEIVED_DATA",
  "BOOKING_PROCESS",
  "SCHEDULE_CONFIRMED",
  "PICKUP_ARRANGED",
  "DOCUMENT_PROCESS",
  "CUSTOMS_PROCESS",
  "IN_TRANSIT",
  "DELIVERED",
  "COMPLETED",
] as const;

export type VendorTrackingStatus = typeof VENDOR_TRACKING_STATUSES[number];

export const VENDOR_TRACKING_LABELS: Record<VendorTrackingStatus, string> = {
  RECEIVED_DATA:      "Data Diterima",
  BOOKING_PROCESS:    "Proses Booking",
  SCHEDULE_CONFIRMED: "Jadwal Terkonfirmasi",
  PICKUP_ARRANGED:    "Pickup Diatur",
  DOCUMENT_PROCESS:   "Proses Dokumen",
  CUSTOMS_PROCESS:    "Proses Kepabeanan",
  IN_TRANSIT:         "Dalam Perjalanan",
  DELIVERED:          "Terkirim",
  COMPLETED:          "Selesai",
};

const TRACKING_STATUS_ORDER: Record<VendorTrackingStatus, number> = {
  RECEIVED_DATA: 0, BOOKING_PROCESS: 1, SCHEDULE_CONFIRMED: 2,
  PICKUP_ARRANGED: 3, DOCUMENT_PROCESS: 4, CUSTOMS_PROCESS: 5,
  IN_TRANSIT: 6, DELIVERED: 7, COMPLETED: 8,
};

// ─── DB Migrations ────────────────────────────────────────────────────────────
void db.execute(sql.raw(`
  CREATE TABLE IF NOT EXISTS logistic_order_vendor_tracking (
    id SERIAL PRIMARY KEY,
    order_id INTEGER NOT NULL,
    rfq_id INTEGER,
    rfq_vendor_link_id INTEGER,
    token TEXT NOT NULL UNIQUE,
    vendor_id INTEGER,
    vendor_name TEXT,
    current_status TEXT NOT NULL DEFAULT 'RECEIVED_DATA',
    latest_notes TEXT,
    latest_attachment_url TEXT,
    tracking_link_sent_at TIMESTAMPTZ,
    completed_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
  )
`)).catch((e: unknown) => logger.warn({ e }, "logistic_order_vendor_tracking migration warn"));

void db.execute(sql.raw(`
  CREATE TABLE IF NOT EXISTS logistic_order_vendor_tracking_logs (
    id SERIAL PRIMARY KEY,
    tracking_id INTEGER NOT NULL,
    status TEXT NOT NULL,
    notes TEXT,
    attachment_url TEXT,
    submitted_ip TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
  )
`)).catch((e: unknown) => logger.warn({ e }, "logistic_order_vendor_tracking_logs migration warn"));

void db.execute(sql.raw(`
  ALTER TABLE logistic_order_rfqs
    ADD COLUMN IF NOT EXISTS customer_data_sent_at TIMESTAMPTZ,
    ADD COLUMN IF NOT EXISTS customer_data_sent_by TEXT,
    ADD COLUMN IF NOT EXISTS customer_data_request_sent_at TIMESTAMPTZ
`)).catch((e: unknown) => logger.warn({ e }, "rfqs customer_data cols migration warn"));

void db.execute(sql.raw(`
  ALTER TABLE rfq_vendor_links
    ADD COLUMN IF NOT EXISTS vendor_tracking_token TEXT
`)).catch((e: unknown) => logger.warn({ e }, "rfq_vendor_links tracking_token migration warn"));

void db.execute(sql.raw(`
  ALTER TABLE logistic_order_vendor_tracking_logs
    ADD COLUMN IF NOT EXISTS recipient_name TEXT
`)).catch((e: unknown) => logger.warn({ e }, "tracking_logs recipient_name migration warn"));

// ─── Rate Limiters ────────────────────────────────────────────────────────────
const trackingGetLimiter  = rateLimit({ windowMs: 15 * 60 * 1000, max: 60, standardHeaders: true, legacyHeaders: false });
const trackingPostLimiter = rateLimit({ windowMs: 15 * 60 * 1000, max: 10, standardHeaders: true, legacyHeaders: false });

// ─── Helpers ─────────────────────────────────────────────────────────────────
const fmtRp = (n: number | string | null | undefined) =>
  n == null ? "—" : `Rp ${Math.round(Number(n)).toLocaleString("id-ID")}`;

const ts = () => new Date().toLocaleString("id-ID", { timeZone: "Asia/Jakarta" });

function safeStr(s: unknown): string {
  return String(s ?? "").replace(/'/g, "''");
}

function getTrackingFormUrl(token: string): string {
  const domain = getPreferredDomain();
  return domain ? `https://${domain}/vendor-tracking/${encodeURIComponent(token)}` : `/vendor-tracking/${token}`;
}

// ─── PUBLIC: GET /api/vendor-tracking/:token ──────────────────────────────────
vendorTrackingPublicRouter.get("/:token", trackingGetLimiter, async (req: Request, res: Response) => {
  const { token } = req.params;
  try {
    const rows = await db.execute(sql.raw(`
      SELECT t.id, t.vendor_name, t.current_status, t.latest_notes, t.completed_at, t.updated_at,
             o.order_number, o.customer_name, o.shipment_type, o.origin, o.destination, o.commodity
      FROM logistic_order_vendor_tracking t
      JOIN logistic_orders o ON o.id = t.order_id
      WHERE t.token = '${safeStr(token)}'
    `)) as unknown as Record<string, unknown>[];

    if (!rows.length) return res.status(404).json({ error: "Link tracking tidak ditemukan" });
    const tracking = rows[0];

    const logs = await db.execute(sql.raw(`
      SELECT status, notes, created_at
      FROM logistic_order_vendor_tracking_logs
      WHERE tracking_id = ${tracking.id}
      ORDER BY created_at ASC
    `)) as unknown as Record<string, unknown>[];

    return res.json({
      token,
      vendorName: tracking.vendor_name,
      orderNumber: tracking.order_number,
      customerName: tracking.customer_name,
      shipmentType: tracking.shipment_type,
      origin: tracking.origin,
      destination: tracking.destination,
      commodity: tracking.commodity,
      currentStatus: tracking.current_status,
      completedAt: tracking.completed_at,
      logs: (logs as Record<string, unknown>[]).map((l) => ({
        status: l.status,
        label: VENDOR_TRACKING_LABELS[l.status as VendorTrackingStatus] ?? String(l.status),
        notes: l.notes,
        createdAt: l.created_at,
      })),
      availableStatuses: VENDOR_TRACKING_STATUSES.map((s) => ({
        value: s,
        label: VENDOR_TRACKING_LABELS[s],
        order: TRACKING_STATUS_ORDER[s],
      })),
    });
  } catch (e) {
    logger.error({ e }, "vendor-tracking GET error");
    return res.status(500).json({ error: "Terjadi kesalahan server" });
  }
});

// ─── PUBLIC: POST /api/vendor-tracking/:token/update ─────────────────────────
vendorTrackingPublicRouter.post("/:token/update", trackingPostLimiter, async (req: Request, res: Response) => {
  const { token } = req.params;
  const { status, notes, attachmentUrl, recipientName } = req.body as {
    status: string; notes?: string; attachmentUrl?: string; recipientName?: string;
  };

  if (!status || !VENDOR_TRACKING_STATUSES.includes(status as VendorTrackingStatus)) {
    return res.status(400).json({ error: "Status tidak valid" });
  }

  try {
    const rows = await db.execute(sql.raw(`
      SELECT t.id, t.order_id, t.current_status, t.vendor_name,
             o.order_number, o.customer_name, o.origin, o.destination, o.phone as customer_phone, o.shipment_type
      FROM logistic_order_vendor_tracking t
      JOIN logistic_orders o ON o.id = t.order_id
      WHERE t.token = '${safeStr(token)}'
    `)) as unknown as Record<string, unknown>[];

    if (!rows.length) return res.status(404).json({ error: "Link tracking tidak valid" });
    const tracking = rows[0];

    const currentOrder = TRACKING_STATUS_ORDER[tracking.current_status as VendorTrackingStatus] ?? -1;
    const newOrder = TRACKING_STATUS_ORDER[status as VendorTrackingStatus];
    if (newOrder < currentOrder) {
      return res.status(400).json({ error: "Tidak bisa mundur ke status sebelumnya" });
    }

    const completedAt = status === "COMPLETED" ? "NOW()" : "NULL";
    await db.execute(sql.raw(`
      UPDATE logistic_order_vendor_tracking
      SET current_status = '${status}',
          latest_notes = ${notes ? `'${safeStr(notes)}'` : "NULL"},
          latest_attachment_url = ${attachmentUrl ? `'${safeStr(attachmentUrl)}'` : "NULL"},
          completed_at = ${completedAt},
          updated_at = NOW()
      WHERE id = ${tracking.id}
    `));

    await db.execute(sql.raw(`
      INSERT INTO logistic_order_vendor_tracking_logs (tracking_id, status, notes, attachment_url, recipient_name, submitted_ip)
      VALUES (${tracking.id}, '${status}', ${notes ? `'${safeStr(notes)}'` : "NULL"},
              ${attachmentUrl ? `'${safeStr(attachmentUrl)}'` : "NULL"},
              ${recipientName ? `'${safeStr(recipientName)}'` : "NULL"},
              '${safeStr(req.ip ?? "")}')
    `));

    const label = VENDOR_TRACKING_LABELS[status as VendorTrackingStatus];
    const vendorName = String(tracking.vendor_name ?? "Vendor");
    const orderNumber = String(tracking.order_number ?? "");
    const customerName = String(tracking.customer_name ?? "");
    const route = `${tracking.origin ?? ""} → ${tracking.destination ?? ""}`;
    const notesStr = notes ? `\nCatatan: ${notes}` : "";

    const adminGroupWa = await getAdminGroupWa().catch(() => null);
    if (adminGroupWa) {
      const msgAdmin = `📍 *UPDATE PROGRESS VENDOR — ${orderNumber}*\n\nVendor: *${vendorName}*\nOrder: ${orderNumber}\nCustomer: ${customerName}\nRute: ${route}\nStatus: *${label}*${notesStr}\n\n_${ts()}_`;
      sendWhatsApp(adminGroupWa, msgAdmin, { context: "vendor-tracking-update" }).catch(() => {});
    }

    const customerPhone = String(tracking.customer_phone ?? "");
    if (customerPhone) {
      const msgCustomer = `📦 *Update Pengiriman — ${orderNumber}*\n\nNo. Order: ${orderNumber}\nStatus Terkini: *${label}*${notesStr}\n\n_${ts()}_`;
      sendWhatsApp(customerPhone, msgCustomer, { context: "vendor-tracking-customer" }).catch(() => {});
    }

    if (status === "COMPLETED") {
      await transitionLogisticOrderStatus(Number(tracking.order_id), "Completed", {
        actorType: "vendor", actorName: vendorName, source: "vendor-tracking", force: true, skipAudit: false,
      }).catch(() => {});

      if (adminGroupWa) {
        const msgDone = `🏁 *ORDER SELESAI — ${orderNumber}*\n\nCustomer: ${customerName}\nVendor: ${vendorName}\nRute: ${route}\n\nSilakan generate invoice customer di BizPortal.\n\n_${ts()}_`;
        sendWhatsApp(adminGroupWa, msgDone, { context: "vendor-tracking-completed" }).catch(() => {});
      }
    }

    return res.json({ ok: true, status, label, message: `Status berhasil diupdate ke "${label}"` });
  } catch (e) {
    logger.error({ e }, "vendor-tracking update error");
    return res.status(500).json({ error: "Terjadi kesalahan server" });
  }
});

// ─── ADMIN: POST /rfq/:rfqId/send-tracking-link ───────────────────────────────
vendorTrackingAdminRouter.post("/rfq/:rfqId/send-tracking-link", async (req: Request, res: Response) => {
  if (!(await requireClerkUser(req, res))) return;
  const rfqId = parseInt(String(req.params.rfqId), 10);
  if (isNaN(rfqId)) return res.status(400).json({ message: "rfqId tidak valid" });

  try {
    const [rfq] = await db.select().from(logisticOrderRfqsTable)
      .where(eq(logisticOrderRfqsTable.id, rfqId));
    if (!rfq) return res.status(404).json({ message: "RFQ tidak ditemukan" });

    const [order] = await db.select().from(logisticOrdersTable)
      .where(eq(logisticOrdersTable.id, rfq.orderId));
    if (!order) return res.status(404).json({ message: "Order tidak ditemukan" });

    const [selectedLink] = await db.select().from(rfqVendorLinksTable)
      .where(and(eq(rfqVendorLinksTable.rfqId, rfqId), eq(rfqVendorLinksTable.status, "selected")))
      .limit(1);
    if (!selectedLink) return res.status(400).json({ message: "Tidak ada vendor terpilih untuk RFQ ini" });

    const [vendor] = await db.select().from(suppliersTable)
      .where(eq(suppliersTable.id, selectedLink.vendorId));
    if (!vendor) return res.status(404).json({ message: "Data vendor tidak ditemukan" });

    const existing = await db.execute(sql.raw(`
      SELECT id, token FROM logistic_order_vendor_tracking
      WHERE order_id = ${order.id} AND rfq_vendor_link_id = ${selectedLink.id}
    `)) as unknown as Record<string, unknown>[];

    let trackingToken: string;
    let trackingId: number;

    if (existing.length && existing[0]) {
      trackingToken = String(existing[0].token);
      trackingId = Number(existing[0].id);
    } else {
      trackingToken = randomBytes(24).toString("hex");
      const inserted = await db.execute(sql.raw(`
        INSERT INTO logistic_order_vendor_tracking
          (order_id, rfq_id, rfq_vendor_link_id, token, vendor_id, vendor_name, current_status)
        VALUES (${order.id}, ${rfqId}, ${selectedLink.id}, '${trackingToken}',
                ${vendor.id}, '${safeStr(vendor.name ?? "")}', 'RECEIVED_DATA')
        RETURNING id
      `)) as unknown as { id: number }[];
      trackingId = inserted[0]?.id ?? 0;
    }

    await db.execute(sql.raw(`
      UPDATE logistic_order_vendor_tracking SET tracking_link_sent_at = NOW() WHERE id = ${trackingId}
    `));

    const trackingUrl = getTrackingFormUrl(trackingToken);
    const vendorName = vendor.name ?? "Vendor";
    const route = `${order.origin} → ${order.destination}`;

    const msg = [
      `🔗 *LINK UPDATE PROGRESS — ${order.orderNumber}*`,
      ``,
      `Kepada Yth. *${vendorName}*,`,
      ``,
      `Customer telah menyetujui penawaran. Mohon update progress pengiriman secara berkala melalui link berikut:`,
      ``,
      `No. Order : ${order.orderNumber}`,
      `Customer  : ${order.customerName}`,
      `Layanan   : ${order.shipmentType}`,
      `Rute      : ${route}`,
      ``,
      `🔗 Link Update Progress:`,
      trackingUrl,
      ``,
      `Status yang perlu diupdate:`,
      `1. Data Diterima → 2. Proses Booking → 3. Jadwal Terkonfirmasi`,
      `4. Pickup Diatur → 5. Proses Dokumen → 6. Proses Kepabeanan`,
      `7. Dalam Perjalanan → 8. Terkirim → 9. Selesai`,
      ``,
      `Terima kasih atas kerjasamanya 🙏`,
      `_${ts()}_`,
    ].join("\n");

    let waSent = false;
    if (vendor.phone) {
      await sendWhatsApp(vendor.phone, msg, { context: "vendor-tracking-link-send" });
      waSent = true;
    }

    const adminGroupWa = await getAdminGroupWa().catch(() => null);
    if (adminGroupWa) {
      const adminMsg = `⚙️ *TRACKING LINK TERKIRIM — ${order.orderNumber}*\n\nVendor: *${vendorName}*\nOrder: ${order.orderNumber}\nRute: ${route}\n\nLink update progress telah dikirim ke vendor.\n_${ts()}_`;
      sendWhatsApp(adminGroupWa, adminMsg, { context: "vendor-tracking-link-admin" }).catch(() => {});
    }

    return res.json({
      ok: true, trackingId, trackingToken, trackingUrl, vendorName, waSent,
      message: waSent ? `Link tracking berhasil dikirim ke ${vendorName}` : "Tracking dibuat (vendor tidak punya nomor WA)",
    });
  } catch (e) {
    logger.error({ e }, "send-tracking-link error");
    return res.status(500).json({ message: "Terjadi kesalahan server" });
  }
});

// ─── ADMIN: GET /rfq/:rfqId/vendor-tracking ───────────────────────────────────
vendorTrackingAdminRouter.get("/rfq/:rfqId/vendor-tracking", async (req: Request, res: Response) => {
  if (!(await requireClerkUser(req, res))) return;
  const rfqId = parseInt(String(req.params.rfqId), 10);
  if (isNaN(rfqId)) return res.status(400).json({ message: "rfqId tidak valid" });

  try {
    const rows = await db.execute(sql.raw(`
      SELECT * FROM logistic_order_vendor_tracking WHERE rfq_id = ${rfqId} ORDER BY created_at DESC LIMIT 1
    `)) as unknown as Record<string, unknown>[];

    if (!rows.length) return res.json({ tracking: null, logs: [] });
    const tracking = rows[0];

    const logs = await db.execute(sql.raw(`
      SELECT status, notes, attachment_url, created_at
      FROM logistic_order_vendor_tracking_logs
      WHERE tracking_id = ${tracking.id}
      ORDER BY created_at ASC
    `)) as unknown as Record<string, unknown>[];

    return res.json({
      tracking: {
        id: tracking.id,
        token: tracking.token,
        vendorId: tracking.vendor_id,
        vendorName: tracking.vendor_name,
        currentStatus: tracking.current_status,
        currentLabel: VENDOR_TRACKING_LABELS[tracking.current_status as VendorTrackingStatus] ?? String(tracking.current_status),
        latestNotes: tracking.latest_notes,
        trackingLinkSentAt: tracking.tracking_link_sent_at,
        completedAt: tracking.completed_at,
        updatedAt: tracking.updated_at,
        trackingUrl: getTrackingFormUrl(String(tracking.token)),
      },
      logs: (logs as Record<string, unknown>[]).map((l) => ({
        status: l.status,
        label: VENDOR_TRACKING_LABELS[l.status as VendorTrackingStatus] ?? String(l.status),
        notes: l.notes,
        attachmentUrl: l.attachment_url,
        createdAt: l.created_at,
      })),
      allStatuses: VENDOR_TRACKING_STATUSES.map((s) => ({
        value: s,
        label: VENDOR_TRACKING_LABELS[s],
        reached: (logs as Record<string, unknown>[]).some((l) => l.status === s),
      })),
    });
  } catch (e) {
    logger.error({ e }, "vendor-tracking GET admin error");
    return res.status(500).json({ message: "Terjadi kesalahan server" });
  }
});

// ─── ADMIN: POST /rfq/:rfqId/complete-order — selesaikan + generate invoice ────
vendorTrackingAdminRouter.post("/rfq/:rfqId/complete-order", async (req: Request, res: Response) => {
  if (!(await requireClerkUser(req, res))) return;
  const rfqId = parseInt(String(req.params.rfqId), 10);
  if (isNaN(rfqId)) return res.status(400).json({ message: "rfqId tidak valid" });

  const { generateInvoice = true, invoiceNotes, dueInDays = 14 } = req.body as {
    generateInvoice?: boolean; invoiceNotes?: string; dueInDays?: number;
  };

  try {
    const [rfq] = await db.select().from(logisticOrderRfqsTable)
      .where(eq(logisticOrderRfqsTable.id, rfqId));
    if (!rfq) return res.status(404).json({ message: "RFQ tidak ditemukan" });

    const [order] = await db.select().from(logisticOrdersTable)
      .where(eq(logisticOrdersTable.id, rfq.orderId));
    if (!order) return res.status(404).json({ message: "Order tidak ditemukan" });

    await transitionLogisticOrderStatus(order.id, "Completed", {
      actorType: "admin", actorName: "Admin", source: "complete-order", force: true, skipAudit: false,
    });

    const [selectedLink] = await db.select({
      vendorId: rfqVendorLinksTable.vendorId,
      offeredPrice: rfqVendorLinksTable.offeredPrice,
    }).from(rfqVendorLinksTable)
      .where(and(eq(rfqVendorLinksTable.rfqId, rfqId), eq(rfqVendorLinksTable.status, "selected")))
      .limit(1);

    const grandTotal = order.grandTotal ? Number(order.grandTotal) : 0;
    const vendorCost = selectedLink?.offeredPrice ? Number(selectedLink.offeredPrice) : null;

    const [existingShipment] = await db.select({ id: freightShipmentsTable.id })
      .from(freightShipmentsTable)
      .where(and(
        eq(freightShipmentsTable.sourceModule, "logistic_order"),
        eq(freightShipmentsTable.sourceOrderId, order.id),
      ))
      .limit(1);

    let shipmentId = existingShipment?.id;
    if (!existingShipment) {
      const num = `SHP/${new Date().getFullYear()}/${String(Date.now()).slice(-6)}`;
      const [ns] = await db.insert(freightShipmentsTable).values({
        shipmentNumber: num,
        shipperName: order.customerName,
        consigneeName: order.namaPenerima ?? order.customerName,
        commodity: order.commodity ?? "General Cargo",
        origin: order.origin,
        destination: order.destination,
        status: "completed" as never,
        sourceModule: "logistic_order",
        sourceOrderId: order.id,
        companyId: order.companyId ?? undefined,
        estimatedRevenue: String(grandTotal),
        estimatedCost: vendorCost != null ? String(vendorCost) : undefined,
        actualRevenue: String(grandTotal),
        actualCost: vendorCost != null ? String(vendorCost) : undefined,
        invoiceStatus: generateInvoice ? "to_invoice" : "none",
        vendorBillStatus: vendorCost != null ? "to_bill" : "none",
      }).returning({ id: freightShipmentsTable.id });
      shipmentId = ns?.id;
    } else {
      await db.update(freightShipmentsTable).set({
        status: "completed" as never,
        actualRevenue: String(grandTotal),
        actualCost: vendorCost != null ? String(vendorCost) : undefined,
        invoiceStatus: generateInvoice ? "to_invoice" : "none",
        vendorBillStatus: vendorCost != null ? "to_bill" : "none",
      }).where(eq(freightShipmentsTable.id, existingShipment.id));
    }

    let invoiceToken: string | null = null;
    let invoiceNumber: string | null = null;

    if (generateInvoice) {
      const companyId = normalizeCompanyId(order.companyId);
      if (companyId == null) {
        return res.status(422).json({
          message: "Invoice Customer Portal tidak dapat dibuat sebelum order memiliki company yang valid.",
        });
      }
      const subtotal = Math.round(grandTotal / 1.11);
      const taxAmount = grandTotal - subtotal;
      const yearMonth = new Date().toISOString().slice(0, 7).replace("-", "");
      const seq = String(Date.now()).slice(-5);
      invoiceNumber = `INV/${yearMonth}/${seq}`;
      invoiceToken = randomBytes(24).toString("hex");
      const dueDate = new Date();
      dueDate.setDate(dueDate.getDate() + (dueInDays ?? 14));

      await db.insert(customerInvoiceLinksTable).values({
        token: invoiceToken,
        companyId,
        orderId: order.id,
        orderNumber: order.orderNumber,
        invoiceNumber,
        customerName: order.customerName,
        customerPhone: order.phone,
        currency: "IDR",
        subtotal: String(subtotal),
        taxRate: "11",
        taxAmount: String(taxAmount),
        grandTotal: String(grandTotal),
        amountPaid: "0",
        paymentStatus: "unpaid",
        dueDate,
        notes: invoiceNotes ?? null,
        lineItems: JSON.stringify([{
          description: `Jasa Logistik — ${order.shipmentType ?? ""} (${order.origin} → ${order.destination})`,
          quantity: 1,
          unitPrice: subtotal,
          total: subtotal,
        }]) as never,
        status: "sent",
        createdBy: "admin-complete-order",
      });

      const domain = getPreferredDomain();
      const invoiceUrl = domain ? `https://${domain}/customer-invoice/${invoiceToken}` : `/customer-invoice/${invoiceToken}`;
      const msgInvoice = [
        `🧾 *INVOICE DITERBITKAN — ${invoiceNumber}*`,
        ``,
        `Dear ${order.customerName},`,
        ``,
        `Pesanan Anda telah selesai diproses. Invoice pembayaran:`,
        ``,
        `No. Invoice : ${invoiceNumber}`,
        `No. Order   : ${order.orderNumber}`,
        `Layanan     : ${order.shipmentType ?? ""}`,
        `Rute        : ${order.origin} → ${order.destination}`,
        `Total       : ${fmtRp(grandTotal)}`,
        `Jatuh Tempo : ${dueDate.toLocaleDateString("id-ID")}`,
        ``,
        `🔗 Lihat Invoice:`,
        invoiceUrl,
        ``,
        `Terima kasih telah mempercayakan pengiriman kepada kami 🙏`,
        `_${ts()}_`,
      ].join("\n");

      if (order.phone) {
        sendWhatsApp(order.phone, msgInvoice, { context: "order-completed-invoice" }).catch(() => {});
      }
    }

    const adminGroupWa = await getAdminGroupWa().catch(() => null);
    if (adminGroupWa) {
      const msgAdmin = [
        `🏁 *ORDER COMPLETED — ${order.orderNumber}*`,
        `Customer : ${order.customerName}`,
        `Layanan  : ${order.shipmentType ?? ""}`,
        `Rute     : ${order.origin} → ${order.destination}`,
        `Revenue  : ${fmtRp(grandTotal)}`,
        invoiceNumber ? `Invoice  : ${invoiceNumber}` : "",
        `_${ts()}_`,
      ].filter(Boolean).join("\n");
      sendWhatsApp(adminGroupWa, msgAdmin, { context: "order-completed-admin" }).catch(() => {});
    }

    await db.insert(vmfActivityLogTable).values({
      entityType: "order",
      entityId: order.id,
      action: "order_completed",
      actor: "admin",
      note: `Order ${order.orderNumber} diselesaikan.${generateInvoice ? ` Invoice: ${invoiceNumber}` : ""}`,
      data: { rfqId, shipmentId, invoiceNumber, invoiceToken } as Record<string, unknown>,
    }).catch(() => {});

    const domain = getPreferredDomain();
    return res.json({
      ok: true,
      orderNumber: order.orderNumber,
      shipmentId,
      invoiceNumber,
      invoiceToken,
      invoiceUrl: (invoiceToken && domain) ? `https://${domain}/customer-invoice/${invoiceToken}` : null,
      message: `Order berhasil diselesaikan${generateInvoice ? ` dan invoice ${invoiceNumber} telah dibuat` : ""}`,
    });
  } catch (e) {
    logger.error({ e }, "complete-order error");
    return res.status(500).json({ message: "Terjadi kesalahan server" });
  }
});
