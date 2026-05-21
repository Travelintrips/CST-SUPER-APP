import { Router, type Request, type Response } from "express";
import { randomBytes } from "crypto";
import { eq, and, desc, sql } from "drizzle-orm";
import {
  db, logisticOrdersTable, logisticOrderRfqsTable, rfqVendorLinksTable,
  suppliersTable,
  customerQuoteLinksTable, customerQuoteResponsesTable,
  orderTaskLinksTable, orderUpdatesTable, customerOrderLinksTable,
  driverLocationsTable,
} from "@workspace/db";
import { requireClerkUser } from "../lib/requireAdmin.js";
import { sendWhatsApp } from "../lib/fonnte.js";
import { getAdminWa } from "../lib/adminWa.js";
import { getPreferredDomain } from "../lib/domain.js";
import { logger } from "../lib/logger.js";
import { checkOrderGeofence } from "../lib/orderGeofenceChecker.js";

const tok = () => randomBytes(24).toString("hex");
const fmtRp = (n: number | null | undefined) =>
  n == null ? "—" : `Rp ${Math.round(n).toLocaleString("id-ID")}`;

function getBaseUrl(): string {
  const d = getPreferredDomain();
  return d ? `https://${d}` : "";
}

// ─────────────────────────────────────────────────────────────────────────────
// ADMIN ROUTER  →  registered under /api/logistic
// ─────────────────────────────────────────────────────────────────────────────

export const customerQuoteAdminRouter = Router();

// POST /api/logistic/rfq/:rfqId/send-customer-quote
customerQuoteAdminRouter.post("/rfq/:rfqId/send-customer-quote", async (req: Request, res: Response) => {
  if (!(await requireClerkUser(req, res))) return;
  const rfqId = Number(req.params["rfqId"]);
  if (isNaN(rfqId)) return res.status(400).json({ message: "rfqId tidak valid" });

  const {
    etaFinal, termsConditions, quoteNotes, finalCustomerPrice,
    validInDays,
  } = req.body as {
    etaFinal?: string; termsConditions?: string; quoteNotes?: string;
    finalCustomerPrice?: number; validInDays?: number;
  };

  try {
    const [rfq] = await db.select().from(logisticOrderRfqsTable).where(eq(logisticOrderRfqsTable.id, rfqId));
    if (!rfq) return res.status(404).json({ message: "RFQ tidak ditemukan" });

    const [order] = await db.select().from(logisticOrdersTable).where(eq(logisticOrdersTable.id, rfq.orderId));
    if (!order) return res.status(404).json({ message: "Order tidak ditemukan" });

    // Get selected vendor link for vendor cost
    const [selectedLink] = await db.select().from(rfqVendorLinksTable)
      .where(and(eq(rfqVendorLinksTable.rfqId, rfqId), eq(rfqVendorLinksTable.status, "selected")));

    const vendorCost = selectedLink?.offeredPrice
      ? Number(selectedLink.offeredPrice)
      : selectedLink?.basicPrice ? Number(selectedLink.basicPrice) : null;

    const customerPrice = finalCustomerPrice ?? (order.finalSellingPrice ? Number(order.finalSellingPrice) : null);
    const margin = customerPrice && vendorCost ? customerPrice - vendorCost : null;

    const validUntil = validInDays
      ? new Date(Date.now() + validInDays * 86_400_000)
      : new Date(Date.now() + 3 * 86_400_000);

    const token = tok();

    // Create customer_quote_links record
    const [link] = await db.insert(customerQuoteLinksTable).values({
      rfqId,
      orderId: order.id,
      token,
      status: "pending",
      etaFinal: etaFinal ?? order.etaFinal ?? null,
      termsConditions: termsConditions ?? null,
      quoteNotes: quoteNotes ?? null,
      finalCustomerPrice: customerPrice ? String(customerPrice) : null,
      vendorCost: vendorCost ? String(vendorCost) : null,
      margin: margin ? String(margin) : null,
      validUntil,
    } as any).returning();

    // Update logistic_order with new status + columns (raw SQL for added columns not in Drizzle schema)
    await db.execute(sql`
      UPDATE logistic_orders SET
        customer_quote_status = 'customer_quoted',
        eta_final             = ${etaFinal ?? null},
        terms_conditions      = ${termsConditions ?? null},
        quote_notes           = ${quoteNotes ?? null},
        vendor_cost           = ${vendorCost ? String(vendorCost) : null},
        order_margin          = ${margin ? String(margin) : null}
      WHERE id = ${order.id}
    `);

    // Add order update (activity log)
    await db.insert(orderUpdatesTable).values({
      orderId: order.id,
      actorType: "admin",
      actorName: "Admin",
      status: "customer_quoted",
      notes: `Penawaran dikirim ke customer. Harga: ${fmtRp(customerPrice)}. ETA: ${etaFinal ?? "—"}.`,
      isPublic: false,
    });

    const quoteUrl = `${getBaseUrl()}/customer-quote/${token}`;

    // Send WhatsApp to customer
    if (order.phone) {
      const waMsg =
        `Halo ${order.customerName ?? "Customer"},\n\n` +
        `Berikut penawaran untuk permintaan Anda:\n\n` +
        `RFQ: ${rfq.rfqNumber}\n` +
        `Layanan: ${order.shipmentType}\n` +
        `Rute: ${order.origin} → ${order.destination}\n` +
        `Harga: ${fmtRp(customerPrice)}\n` +
        `ETA: ${etaFinal ?? "—"}\n` +
        `Valid sampai: ${validUntil.toLocaleDateString("id-ID")}\n\n` +
        `Silakan review dan konfirmasi melalui link berikut:\n${quoteUrl}`;

      sendWhatsApp(order.phone, waMsg).catch((e) =>
        logger.warn({ e }, "customerQuote WA to customer failed")
      );
    }

    logger.info({ rfqId, orderId: order.id, token }, "Customer quote sent");
    return res.status(201).json({ ok: true, token, quoteUrl, link });
  } catch (err) {
    logger.error({ err }, "send-customer-quote error");
    return res.status(500).json({ message: "Gagal mengirim penawaran" });
  }
});

// POST /api/logistic/orders/:orderId/create-task-link  (admin creates vendor/driver task link)
customerQuoteAdminRouter.post("/orders/:orderId/create-task-link", async (req: Request, res: Response) => {
  if (!(await requireClerkUser(req, res))) return;
  const orderId = Number(req.params["orderId"]);
  if (isNaN(orderId)) return res.status(400).json({ message: "orderId tidak valid" });

  const { vendorId, roleType, label, expiredInDays } = req.body as {
    vendorId?: number; roleType?: string; label?: string; expiredInDays?: number;
  };

  try {
    const token = tok();
    const expiredAt = expiredInDays ? new Date(Date.now() + expiredInDays * 86_400_000) : null;
    const [link] = await db.insert(orderTaskLinksTable).values({
      orderId, vendorId: vendorId ?? null, token,
      roleType: roleType ?? "vendor", label: label ?? null,
      expiredAt: expiredAt ?? undefined,
    }).returning();

    // Update order status + log
    await db.insert(orderUpdatesTable).values({
      orderId, actorType: "admin", actorName: "Admin",
      status: "assigned_to_vendor",
      notes: `Task link dibuat untuk ${roleType ?? "vendor"}${label ? `: ${label}` : ""}.`,
      isPublic: false,
    });

    const taskUrl = `${getBaseUrl()}/order-task/${token}`;

    // Send WA to vendor if vendorId given
    if (vendorId) {
      const [vendor] = await db.select().from(suppliersTable).where(eq(suppliersTable.id, vendorId));
      if (vendor?.phone) {
        const [order] = await db.select().from(logisticOrdersTable).where(eq(logisticOrdersTable.id, orderId));
        const waMsg =
          `🚚 *Tugas Order Baru — CST Logistics*\n\n` +
          `Order: ${order?.orderNumber ?? orderId}\n` +
          `Rute: ${order?.origin ?? ""} → ${order?.destination ?? ""}\n` +
          (label ? `Keterangan: ${label}\n` : "") +
          `\nSilakan buka link berikut untuk konfirmasi dan update status:\n${taskUrl}`;
        sendWhatsApp(vendor.phone, waMsg).catch((e) =>
          logger.warn({ e }, "createTaskLink WA failed")
        );
      }
    }

    return res.status(201).json({ ok: true, token, taskUrl, link });
  } catch (err) {
    logger.error({ err }, "create-task-link error");
    return res.status(500).json({ message: "Gagal membuat task link" });
  }
});

// POST /api/logistic/orders/:orderId/create-customer-link
customerQuoteAdminRouter.post("/orders/:orderId/create-customer-link", async (req: Request, res: Response) => {
  if (!(await requireClerkUser(req, res))) return;
  const orderId = Number(req.params["orderId"]);
  if (isNaN(orderId)) return res.status(400).json({ message: "orderId tidak valid" });
  try {
    const token = tok();
    const [link] = await db.insert(customerOrderLinksTable).values({ orderId, token }).returning();
    const trackUrl = `${getBaseUrl()}/customer-order/${token}`;
    return res.status(201).json({ ok: true, token, trackUrl, link });
  } catch (err) {
    logger.error({ err }, "create-customer-link error");
    return res.status(500).json({ message: "Gagal membuat tracking link" });
  }
});

// GET /api/logistic/orders/:orderId/detail  (admin full detail)
customerQuoteAdminRouter.get("/orders/:orderId/detail", async (req: Request, res: Response) => {
  if (!(await requireClerkUser(req, res))) return;
  const orderId = Number(req.params["orderId"]);
  if (isNaN(orderId)) return res.status(400).json({ message: "orderId tidak valid" });
  try {
    const [order] = await db.select().from(logisticOrdersTable).where(eq(logisticOrdersTable.id, orderId));
    if (!order) return res.status(404).json({ message: "Order tidak ditemukan" });

    // Fetch extra columns added via migration (not in Drizzle schema)
    const extraRows = await db.execute(sql`
      SELECT customer_quote_status, eta_final, terms_conditions, quote_notes, vendor_cost, order_margin,
        geofence_enabled, geofence_radius_km
      FROM logistic_orders WHERE id = ${orderId}
    `);
    const extra = (extraRows as any).rows?.[0] ?? (extraRows as any)[0] ?? {};
    const orderFull = {
      ...order,
      customerQuoteStatus: extra.customer_quote_status ?? null,
      etaFinal: extra.eta_final ?? null,
      termsConditions: extra.terms_conditions ?? null,
      quoteNotes: extra.quote_notes ?? null,
      vendorCost: extra.vendor_cost ?? null,
      orderMargin: extra.order_margin ?? null,
      geofenceEnabled: extra.geofence_enabled ?? true,
      geofenceRadiusKm: extra.geofence_radius_km ?? 75,
    };

    const [vendor] = order.approvedVendorId
      ? await db.select({ id: suppliersTable.id, name: suppliersTable.name, phone: suppliersTable.phone })
          .from(suppliersTable).where(eq(suppliersTable.id, order.approvedVendorId))
      : [null];

    const updates = await db.select().from(orderUpdatesTable)
      .where(eq(orderUpdatesTable.orderId, orderId))
      .orderBy(desc(orderUpdatesTable.createdAt));

    const taskLinks = await db.select().from(orderTaskLinksTable)
      .where(eq(orderTaskLinksTable.orderId, orderId))
      .orderBy(desc(orderTaskLinksTable.createdAt));

    const customerLinks = await db.select().from(customerOrderLinksTable)
      .where(eq(customerOrderLinksTable.orderId, orderId))
      .orderBy(desc(customerOrderLinksTable.createdAt));

    const quoteLinks = await db.select().from(customerQuoteLinksTable)
      .where(eq(customerQuoteLinksTable.orderId, orderId))
      .orderBy(desc(customerQuoteLinksTable.createdAt));

    const rfqs = await db.select().from(logisticOrderRfqsTable)
      .where(eq(logisticOrderRfqsTable.orderId, orderId));

    // Fetch freight shipments linked to any RFQ belonging to this order.
    // freight_shipment_id was added via a manual migration, so we use raw SQL.
    const freightRows = await db.execute(sql`
      SELECT fs.id, fs.shipment_number AS "shipmentNumber", fs.status,
             fs.origin, fs.destination, fs.shipper_name AS "shipperName",
             fs.approved_vendor_name AS "approvedVendorName",
             fs.created_at AS "createdAt",
             r.id AS "rfqId", r.rfq_number AS "rfqNumber"
      FROM logistic_order_rfqs r
      JOIN freight_shipments fs ON fs.id = r.freight_shipment_id
      WHERE r.order_id = ${orderId}
      ORDER BY fs.created_at DESC
    `);
    const freightShipments = (freightRows as any[]).map((row: any) => ({
      id: row.id as number,
      shipmentNumber: row.shipmentNumber as string,
      status: row.status as string,
      origin: row.origin as string,
      destination: row.destination as string,
      shipperName: row.shipperName as string,
      approvedVendorName: (row.approvedVendorName as string) ?? null,
      createdAt: row.createdAt instanceof Date ? row.createdAt.toISOString() : (row.createdAt as string),
      rfqId: row.rfqId as number,
      rfqNumber: row.rfqNumber as string,
    }));

    return res.json({
      order: orderFull,
      vendor,
      updates,
      taskLinks: taskLinks.map(l => ({ ...l, taskUrl: `${getBaseUrl()}/order-task/${l.token}` })),
      customerLinks: customerLinks.map(l => ({ ...l, trackUrl: `${getBaseUrl()}/customer-order/${l.token}` })),
      quoteLinks: quoteLinks.map(l => ({ ...l, quoteUrl: `${getBaseUrl()}/customer-quote/${l.token}` })),
      rfqs,
      freightShipments,
    });
  } catch (err) {
    logger.error({ err }, "order-detail error");
    return res.status(500).json({ message: "Gagal memuat detail order" });
  }
});

// PATCH /api/logistic/orders/:orderId/geofence  (admin update geofence config)
customerQuoteAdminRouter.patch("/orders/:orderId/geofence", async (req: Request, res: Response) => {
  if (!(await requireClerkUser(req, res))) return;
  const orderId = Number(req.params["orderId"]);
  if (isNaN(orderId)) return res.status(400).json({ message: "orderId tidak valid" });

  const { geofenceEnabled, geofenceRadiusKm } = req.body as { geofenceEnabled?: boolean; geofenceRadiusKm?: number };

  try {
    await db.execute(sql`
      UPDATE logistic_orders
      SET
        geofence_enabled = COALESCE(${geofenceEnabled ?? null}::boolean, geofence_enabled),
        geofence_radius_km = COALESCE(${geofenceRadiusKm != null ? Math.max(1, Math.round(geofenceRadiusKm)) : null}::integer, geofence_radius_km)
      WHERE id = ${orderId}
    `);
    return res.json({ ok: true });
  } catch (err) {
    logger.error({ err }, "update-geofence-config error");
    return res.status(500).json({ message: "Gagal update geofence config" });
  }
});

// GET /api/logistic/orders/:orderId/geofence-alerts  (admin — recent geofence alerts)
customerQuoteAdminRouter.get("/orders/:orderId/geofence-alerts", async (req: Request, res: Response) => {
  if (!(await requireClerkUser(req, res))) return;
  const orderId = Number(req.params["orderId"]);
  if (isNaN(orderId)) return res.status(400).json({ message: "orderId tidak valid" });

  try {
    const rows = await db.execute(sql`
      SELECT id, order_id, actor_name, notes, created_at
      FROM order_updates
      WHERE order_id = ${orderId} AND actor_type = 'geofence_alert'
      ORDER BY created_at DESC
      LIMIT 20
    `);
    const alerts = ((rows as any).rows ?? rows) as Array<{
      id: number; order_id: number; actor_name: string | null; notes: string | null; created_at: string;
    }>;
    return res.json({ alerts });
  } catch (err) {
    logger.error({ err }, "geofence-alerts fetch error");
    return res.status(500).json({ message: "Gagal memuat geofence alerts" });
  }
});

// PATCH /api/logistic/orders/:orderId/status  (admin update status)
customerQuoteAdminRouter.patch("/orders/:orderId/status", async (req: Request, res: Response) => {
  if (!(await requireClerkUser(req, res))) return;
  const orderId = Number(req.params["orderId"]);
  if (isNaN(orderId)) return res.status(400).json({ message: "orderId tidak valid" });

  const { status, notes, actorName } = req.body as { status: string; notes?: string; actorName?: string };
  if (!status) return res.status(400).json({ message: "status wajib" });

  try {
    await db.update(logisticOrdersTable).set({ status }).where(eq(logisticOrdersTable.id, orderId));
    await db.insert(orderUpdatesTable).values({
      orderId, actorType: "admin", actorName: actorName ?? "Admin",
      status, notes: notes ?? `Status diubah ke: ${status}`, isPublic: true,
    });
    return res.json({ ok: true });
  } catch (err) {
    logger.error({ err }, "update-order-status error");
    return res.status(500).json({ message: "Gagal update status" });
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// PUBLIC ROUTERS
// ─────────────────────────────────────────────────────────────────────────────

export const customerQuotePublicRouter = Router();

// GET /api/customer-quote/:token
customerQuotePublicRouter.get("/:token", async (req: Request, res: Response) => {
  const { token } = req.params as { token: string };
  try {
    const [link] = await db.select().from(customerQuoteLinksTable)
      .where(eq(customerQuoteLinksTable.token, token));
    if (!link) return res.status(404).json({ error: "Link tidak ditemukan" });

    // Mark opened
    if (!link.openedAt) {
      await db.update(customerQuoteLinksTable)
        .set({ openedAt: new Date() }).where(eq(customerQuoteLinksTable.token, token));
    }

    const [order] = await db.select().from(logisticOrdersTable)
      .where(eq(logisticOrdersTable.id, link.orderId));
    if (!order) return res.status(404).json({ error: "Order tidak ditemukan" });

    const isExpired = link.validUntil && link.validUntil < new Date();
    const isResponded = ["approved", "revision_requested", "rejected"].includes(link.status);

    return res.json({
      token,
      status: link.status,
      isExpired,
      isResponded,
      rfqNumber: order.orderNumber,
      serviceType: order.shipmentType,
      origin: order.origin,
      destination: order.destination,
      cargoDetail: [
        order.commodity, order.cargoDescription,
        order.grossWeight ? `${order.grossWeight} kg` : null,
        order.volumeCbm ? `${order.volumeCbm} cbm` : null,
      ].filter(Boolean).join(" · ") || "—",
      finalCustomerPrice: link.finalCustomerPrice ? Number(link.finalCustomerPrice) : null,
      etaFinal: link.etaFinal,
      termsConditions: link.termsConditions,
      quoteNotes: link.quoteNotes,
      validUntil: link.validUntil?.toISOString() ?? null,
    });
  } catch (err) {
    logger.error({ err }, "get customer-quote error");
    return res.status(500).json({ error: "Gagal memuat penawaran" });
  }
});

// POST /api/customer-quote/:token/respond
customerQuotePublicRouter.post("/:token/respond", async (req: Request, res: Response) => {
  const { token } = req.params as { token: string };
  const { response, revisionNotes, rejectionReason } = req.body as {
    response: "approve" | "revise" | "reject";
    revisionNotes?: string; rejectionReason?: string;
  };

  if (!["approve", "revise", "reject"].includes(response)) {
    return res.status(400).json({ error: "response tidak valid" });
  }

  try {
    const [link] = await db.select().from(customerQuoteLinksTable)
      .where(eq(customerQuoteLinksTable.token, token));
    if (!link) return res.status(404).json({ error: "Link tidak ditemukan" });

    const isExpired = link.validUntil && link.validUntil < new Date();
    if (isExpired) return res.status(410).json({ error: "Link sudah kadaluarsa" });

    const isResponded = ["approved", "revision_requested", "rejected"].includes(link.status);
    if (isResponded) return res.status(409).json({ error: "Penawaran ini sudah dijawab sebelumnya" });

    const [order] = await db.select().from(logisticOrdersTable)
      .where(eq(logisticOrdersTable.id, link.orderId));
    if (!order) return res.status(404).json({ error: "Order tidak ditemukan" });

    const linkStatus = response === "approve" ? "approved"
      : response === "revise" ? "revision_requested"
      : "rejected";

    const now = new Date();
    await db.update(customerQuoteLinksTable)
      .set({ status: linkStatus, respondedAt: now })
      .where(eq(customerQuoteLinksTable.token, token));

    // Save response record
    await db.insert(customerQuoteResponsesTable).values({
      rfqId: link.rfqId ?? undefined,
      orderId: order.id,
      token,
      response,
      revisionNotes: revisionNotes ?? null,
      rejectionReason: rejectionReason ?? null,
    });

    // Log order update
    const notes = response === "approve"
      ? `Customer menyetujui penawaran. Harga: ${fmtRp(link.finalCustomerPrice ? Number(link.finalCustomerPrice) : null)}`
      : response === "revise"
      ? `Customer meminta revisi. Catatan: ${revisionNotes ?? "—"}`
      : `Customer menolak penawaran. Alasan: ${rejectionReason ?? "—"}`;

    await db.insert(orderUpdatesTable).values({
      orderId: order.id, actorType: "customer",
      actorName: order.customerName, status: linkStatus,
      notes, isPublic: false,
    });

    const rfqNum = order.orderNumber;
    const adminLink = `${getBaseUrl()}/bizportal/logistics/orders/${order.id}`;
    const rfqLink = `${getBaseUrl()}/bizportal/logistics/portal-orders/${order.id}`;
    const adminWa = await getAdminWa();

    if (adminWa && response === "approve") {
      // Create customer tracking link automatically
      const trackToken = tok();
      await db.insert(customerOrderLinksTable).values({ orderId: order.id, token: trackToken });

      // Send WA to admin
      const waAdmin =
        `✅ Customer Approve Penawaran\n\n` +
        `RFQ: ${rfqNum}\n` +
        `Customer: ${order.customerName}\n` +
        `Harga Final: ${fmtRp(link.finalCustomerPrice ? Number(link.finalCustomerPrice) : null)}\n\n` +
        `Lihat order:\n${adminLink}`;
      sendWhatsApp(adminWa, waAdmin).catch(() => {});

      // Notify selected vendor
      if (order.approvedVendorId) {
        const [vendor] = await db.select().from(suppliersTable)
          .where(eq(suppliersTable.id, order.approvedVendorId));
        if (vendor?.phone) {
          const waVendor =
            `📦 *Order Dikonfirmasi — CST Logistics*\n\n` +
            `Order: ${order.orderNumber}\n` +
            `Rute: ${order.origin} → ${order.destination}\n\n` +
            `Customer telah menyetujui penawaran. Tim CST akan segera menghubungi Anda.`;
          sendWhatsApp(vendor.phone, waVendor).catch(() => {});
        }
      }
    } else if (adminWa && response === "revise") {
      const waAdmin =
        `🟡 Customer Minta Revisi\n\n` +
        `RFQ: ${rfqNum}\n` +
        `Customer: ${order.customerName}\n` +
        `Catatan:\n${revisionNotes ?? "—"}\n\n` +
        `Buka RFQ:\n${rfqLink}`;
      sendWhatsApp(adminWa, waAdmin).catch(() => {});
    } else if (adminWa && response === "reject") {
      const waAdmin =
        `🔴 Customer Menolak Penawaran\n\n` +
        `RFQ: ${rfqNum}\n` +
        `Customer: ${order.customerName}\n` +
        `Alasan:\n${rejectionReason ?? "—"}\n\n` +
        `Buka RFQ:\n${rfqLink}`;
      sendWhatsApp(adminWa, waAdmin).catch(() => {});
    }

    const msg = response === "approve"
      ? "Terima kasih! Penawaran Anda telah dikonfirmasi. Tim kami akan segera menghubungi Anda."
      : response === "revise"
      ? "Catatan revisi Anda telah dikirim. Tim kami akan segera menindaklanjuti."
      : "Penolakan Anda telah kami catat. Terima kasih.";

    return res.json({ ok: true, message: msg, status: linkStatus });
  } catch (err) {
    logger.error({ err }, "customer-quote respond error");
    return res.status(500).json({ error: "Gagal menyimpan respons" });
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// ORDER TASK ROUTER (vendor/driver)
// ─────────────────────────────────────────────────────────────────────────────

export const orderTaskPublicRouter = Router();

const ORDER_STATUSES = [
  "order_confirmed", "assigned_to_vendor", "waiting_pickup", "picked_up",
  "in_progress", "delivered", "pod_uploaded", "invoice_created",
  "payment_pending", "paid", "completed", "cancelled",
];

// GET /api/order-task/:token
orderTaskPublicRouter.get("/:token", async (req: Request, res: Response) => {
  const { token } = req.params as { token: string };
  try {
    const [link] = await db.select().from(orderTaskLinksTable)
      .where(eq(orderTaskLinksTable.token, token));
    if (!link) return res.status(404).json({ error: "Link tidak ditemukan" });

    if (!link.openedAt) {
      await db.update(orderTaskLinksTable)
        .set({ openedAt: new Date() }).where(eq(orderTaskLinksTable.token, token));
    }

    if (link.expiredAt && link.expiredAt < new Date()) {
      return res.status(410).json({ error: "Link sudah kadaluarsa" });
    }

    const [order] = await db.select().from(logisticOrdersTable)
      .where(eq(logisticOrdersTable.id, link.orderId));
    if (!order) return res.status(404).json({ error: "Order tidak ditemukan" });

    const updates = await db.select().from(orderUpdatesTable)
      .where(eq(orderUpdatesTable.orderId, link.orderId))
      .orderBy(desc(orderUpdatesTable.createdAt));

    return res.json({
      token,
      roleType: link.roleType,
      label: link.label,
      order: {
        id: order.id,
        orderNumber: order.orderNumber,
        serviceType: order.shipmentType,
        origin: order.origin,
        destination: order.destination,
        cargoDetail: [order.commodity, order.cargoDescription].filter(Boolean).join(" — ") || "—",
        status: order.status,
        etaFinal: (order as any).etaFinal ?? null,
      },
      updates: updates.filter(u => u.actorType !== "system" || u.notes),
      availableStatuses: ORDER_STATUSES,
    });
  } catch (err) {
    logger.error({ err }, "get order-task error");
    return res.status(500).json({ error: "Gagal memuat task" });
  }
});

// POST /api/order-task/:token/location
orderTaskPublicRouter.post("/:token/location", async (req: Request, res: Response) => {
  const { token } = req.params as { token: string };
  const { lat, lng, accuracy } = req.body as { lat: number; lng: number; accuracy?: number };

  if (!lat || !lng || typeof lat !== "number" || typeof lng !== "number") {
    return res.status(400).json({ error: "lat dan lng wajib diisi" });
  }
  if (lat < -90 || lat > 90 || lng < -180 || lng > 180) {
    return res.status(400).json({ error: "Koordinat tidak valid" });
  }

  try {
    const [link] = await db.select().from(orderTaskLinksTable)
      .where(eq(orderTaskLinksTable.token, token));
    if (!link) return res.status(404).json({ error: "Link tidak ditemukan" });
    if (link.expiredAt && link.expiredAt < new Date()) {
      return res.status(410).json({ error: "Link sudah kadaluarsa" });
    }

    const driverId = (link as any).driverId ?? null;

    await db.insert(driverLocationsTable).values({
      driverId,
      orderId: link.orderId,
      latitude: String(lat),
      longitude: String(lng),
      accuracy: accuracy != null ? String(accuracy) : null,
      checkpointType: "order_task",
    });

    void checkOrderGeofence(link.orderId, lat, lng, link.label ?? "Vendor/Driver");

    return res.json({ ok: true });
  } catch (err) {
    logger.error({ err }, "order-task location error");
    return res.status(500).json({ error: "Gagal menyimpan lokasi" });
  }
});

// POST /api/order-task/:token/update
orderTaskPublicRouter.post("/:token/update", async (req: Request, res: Response) => {
  const { token } = req.params as { token: string };
  const { status, notes, attachmentUrl } = req.body as {
    status?: string; notes?: string; attachmentUrl?: string;
  };

  try {
    const [link] = await db.select().from(orderTaskLinksTable)
      .where(eq(orderTaskLinksTable.token, token));
    if (!link) return res.status(404).json({ error: "Link tidak ditemukan" });
    if (link.expiredAt && link.expiredAt < new Date()) {
      return res.status(410).json({ error: "Link sudah kadaluarsa" });
    }

    const [order] = await db.select().from(logisticOrdersTable)
      .where(eq(logisticOrdersTable.id, link.orderId));
    if (!order) return res.status(404).json({ error: "Order tidak ditemukan" });

    let vendorName: string | null = null;
    if (link.vendorId) {
      const [vendor] = await db.select({ name: suppliersTable.name }).from(suppliersTable)
        .where(eq(suppliersTable.id, link.vendorId));
      vendorName = vendor?.name ?? null;
    }

    // Update order status if given
    if (status && ORDER_STATUSES.includes(status)) {
      await db.update(logisticOrdersTable).set({ status }).where(eq(logisticOrdersTable.id, link.orderId));
    }

    // Log update
    await db.insert(orderUpdatesTable).values({
      orderId: link.orderId,
      actorType: link.roleType,
      actorName: vendorName,
      status: status ?? null,
      notes: notes ?? null,
      attachmentUrl: attachmentUrl ?? null,
      isPublic: true,
    });

    // Notify admin
    const adminWa = await getAdminWa();
    if (adminWa && (status || notes)) {
      const waMsg =
        `📦 Update Order — ${order.orderNumber}\n` +
        `Dari: ${vendorName ?? link.roleType}\n` +
        (status ? `Status: ${status}\n` : "") +
        (notes ? `Catatan: ${notes}\n` : "");
      sendWhatsApp(adminWa, waMsg).catch(() => {});
    }

    return res.json({ ok: true, message: "Update berhasil" });
  } catch (err) {
    logger.error({ err }, "order-task update error");
    return res.status(500).json({ error: "Gagal menyimpan update" });
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// CUSTOMER ORDER TRACKING ROUTER
// ─────────────────────────────────────────────────────────────────────────────

export const customerOrderPublicRouter = Router();

// GET /api/customer-order/:token
customerOrderPublicRouter.get("/:token", async (req: Request, res: Response) => {
  const { token } = req.params as { token: string };
  try {
    const [link] = await db.select().from(customerOrderLinksTable)
      .where(eq(customerOrderLinksTable.token, token));
    if (!link) return res.status(404).json({ error: "Link tidak ditemukan" });

    const [order] = await db.select().from(logisticOrdersTable)
      .where(eq(logisticOrdersTable.id, link.orderId));
    if (!order) return res.status(404).json({ error: "Order tidak ditemukan" });

    const updates = await db.select().from(orderUpdatesTable)
      .where(and(eq(orderUpdatesTable.orderId, link.orderId), eq(orderUpdatesTable.isPublic, true)))
      .orderBy(desc(orderUpdatesTable.createdAt));

    return res.json({
      orderNumber: order.orderNumber,
      serviceType: order.shipmentType,
      origin: order.origin,
      destination: order.destination,
      status: order.status,
      etaFinal: (order as any).etaFinal ?? null,
      createdAt: order.createdAt,
      timeline: updates.map(u => ({
        id: u.id,
        status: u.status,
        notes: u.notes,
        attachmentUrl: u.attachmentUrl,
        createdAt: u.createdAt,
      })),
    });
  } catch (err) {
    logger.error({ err }, "customer-order tracking error");
    return res.status(500).json({ error: "Gagal memuat status order" });
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// PDF GENERATION
// ─────────────────────────────────────────────────────────────────────────────

// POST /api/logistic/rfq/:rfqId/generate-quotation-pdf  (admin)
customerQuoteAdminRouter.post("/rfq/:rfqId/generate-quotation-pdf", async (req: Request, res: Response) => {
  if (!(await requireClerkUser(req, res))) return;
  const rfqId = Number(req.params["rfqId"]);
  if (isNaN(rfqId)) return res.status(400).json({ message: "rfqId tidak valid" });

  try {
    const { buildQuotationPdf } = await import("../lib/quotationPdf.js");

    const [rfq] = await db.select().from(logisticOrderRfqsTable).where(eq(logisticOrderRfqsTable.id, rfqId));
    if (!rfq) return res.status(404).json({ message: "RFQ tidak ditemukan" });

    const [order] = await db.select().from(logisticOrdersTable).where(eq(logisticOrdersTable.id, rfq.orderId));
    if (!order) return res.status(404).json({ message: "Order tidak ditemukan" });

    const [link] = await db.select().from(customerQuoteLinksTable)
      .where(eq(customerQuoteLinksTable.rfqId, rfqId))
      .orderBy(desc(customerQuoteLinksTable.createdAt)).limit(1);

    const quotationNumber = link?.quotationNumber
      ?? `QUO/${new Date().getFullYear()}/${String(rfqId).padStart(5, "0")}`;

    const orderAny = order as any;

    const pdfData = {
      quotationNumber,
      customerName: order.customerName ?? "Customer",
      customerPhone: order.phone ?? null,
      companyName: orderAny.companyName ?? null,
      serviceType: order.shipmentType ?? "Logistik",
      origin: order.origin ?? "—",
      destination: order.destination ?? "—",
      commodity: order.commodity ?? null,
      cargoDescription: order.cargoDescription ?? null,
      grossWeight: order.grossWeight ? parseFloat(order.grossWeight) : null,
      volumeCbm: order.volumeCbm ? parseFloat(order.volumeCbm) : null,
      etaFinal: link?.etaFinal ?? orderAny.etaFinal ?? null,
      finalCustomerPrice: link?.finalCustomerPrice
        ? Number(link.finalCustomerPrice)
        : order.finalSellingPrice ? Number(order.finalSellingPrice) : 0,
      termsConditions: link?.termsConditions ?? null,
      quoteNotes: link?.quoteNotes ?? null,
      validUntil: link?.validUntil ?? null,
      rfqNumber: rfq.rfqNumber,
      orderNumber: order.orderNumber,
    };

    const pdfBuffer = buildQuotationPdf(pdfData);

    // Update link with quotation number
    if (link?.id) {
      await db.execute(sql`
        UPDATE customer_quote_links
        SET quotation_number = ${quotationNumber}
        WHERE id = ${link.id}
      `);
    }

    res.set({
      "Content-Type": "application/pdf",
      "Content-Disposition": `attachment; filename="Quotation-${quotationNumber.replace(/\//g, "-")}.pdf"`,
      "Content-Length": String(pdfBuffer.length),
    });
    return res.send(pdfBuffer);
  } catch (err) {
    logger.error({ err }, "generate-quotation-pdf error");
    return res.status(500).json({ message: "Gagal generate PDF" });
  }
});

// GET /api/logistic/orders/:orderId/audit-trail  (admin)
customerQuoteAdminRouter.get("/orders/:orderId/audit-trail", async (req: Request, res: Response) => {
  if (!(await requireClerkUser(req, res))) return;
  const orderId = Number(req.params["orderId"]);
  if (isNaN(orderId)) return res.status(400).json({ message: "orderId tidak valid" });

  try {
    const logs = await db.execute(sql`
      SELECT * FROM activity_logs WHERE order_id = ${orderId}
      ORDER BY created_at DESC LIMIT 100
    `);
    const updates = await db.select().from(orderUpdatesTable)
      .where(eq(orderUpdatesTable.orderId, orderId))
      .orderBy(desc(orderUpdatesTable.createdAt));

    return res.json({ activityLogs: logs.rows, orderUpdates: updates });
  } catch (err) {
    logger.error({ err }, "audit-trail error");
    return res.status(500).json({ message: "Gagal memuat audit trail" });
  }
});
