import { Router, type Request, type Response } from "express";
import { randomBytes } from "crypto";
import { broadcastInvalidation } from "../lib/alertsBroadcast.js";
import { eq, and, desc, sql } from "drizzle-orm";
import {
  db, logisticOrdersTable, logisticOrderRfqsTable, rfqVendorLinksTable,
  suppliersTable,
  customerQuoteLinksTable, customerQuoteResponsesTable,
  orderTaskLinksTable, orderUpdatesTable, customerOrderLinksTable,
  driverLocationsTable,
  logisticOrderItemsTable,
} from "@workspace/db";
import { resolveTemplate } from "@workspace/product-templates";
import { requireClerkUser } from "../lib/requireAdmin.js";
import { sendViaService as sendWhatsApp } from "../lib/waTransport.js";
import { getAdminGroupWa } from "../lib/adminWa.js";
import { getPreferredDomain } from "../lib/domain.js";
import { calcTax } from "../lib/taxHelper.js";
import { logger } from "../lib/logger.js";
import { logTokenAccess } from "../lib/tokenGuard.js";
import { checkOrderGeofence } from "../lib/orderGeofenceChecker.js";
import { updateOrderProgress } from "../lib/orderProgress.js";
import { getWaTemplateConfig, renderTemplate, deriveServiceType } from "../lib/orderNotification.js";
import { logOrderAudit, logCustomerApprovalEvent, logOrderStatusChange } from "../lib/auditTrail.js";
import { transitionLogisticOrderStatus } from "../lib/services/logisticOrderStatusService.js";

// P0.2 — 256-bit secure token generator
const tok = () => randomBytes(32).toString("hex");
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

// Boot migration: add template columns to customer_quote_links
db.execute(sql.raw(`
  ALTER TABLE customer_quote_links ADD COLUMN IF NOT EXISTS category_key TEXT;
  ALTER TABLE customer_quote_links ADD COLUMN IF NOT EXISTS template_id TEXT;
  ALTER TABLE customer_quote_links ADD COLUMN IF NOT EXISTS template_version TEXT;
  ALTER TABLE customer_quote_links ADD COLUMN IF NOT EXISTS template_snapshot JSONB;
  ALTER TABLE customer_quote_links ADD COLUMN IF NOT EXISTS price_items JSONB;
`)).catch((e: unknown) => logger.warn({ e }, "customer_quote_links migration warn"));

// POST /api/logistic/rfq/:rfqId/send-customer-quote
customerQuoteAdminRouter.post("/rfq/:rfqId/send-customer-quote", async (req: Request, res: Response) => {
  if (!(await requireClerkUser(req, res))) return;
  const rfqId = Number(req.params["rfqId"]);
  if (isNaN(rfqId)) return res.status(400).json({ message: "rfqId tidak valid" });

  const {
    etaFinal, termsConditions, quoteNotes, finalCustomerPrice,
    validInDays, priceItems,
  } = req.body as {
    etaFinal?: string; termsConditions?: string; quoteNotes?: string;
    finalCustomerPrice?: number; validInDays?: number;
    priceItems?: Array<{ name: string; qty?: number | null; unit?: string | null; unitPrice?: number | null; subtotal: number }>;
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

    const orderSubtotalNum = order.subtotal ? Number(order.subtotal) : 0;
    const orderTaxNum = order.tax ? Number(order.tax) : 0;
    const orderGrandTotalNum = order.grandTotal ? Number(order.grandTotal) : (orderSubtotalNum + orderTaxNum);

    // Harga jual ke customer: pakai finalCustomerPrice dari request jika ada,
    // fallback ke order.finalSellingPrice, fallback ke order grandTotal (subtotal+tax)
    const customerPrice = finalCustomerPrice
      ?? (order.finalSellingPrice ? Number(order.finalSellingPrice) : null)
      ?? (orderGrandTotalNum > 0 ? orderGrandTotalNum : null);

    // Fetch order items untuk breakdown WA
    const rawOrderItems = await db.select({
      serviceName: logisticOrderItemsTable.serviceName,
      inputData: logisticOrderItemsTable.inputData,
      subtotal: logisticOrderItemsTable.subtotal,
    }).from(logisticOrderItemsTable).where(eq(logisticOrderItemsTable.orderId, order.id));

    let itemsBlock: string | null = null;
    if (rawOrderItems.length > 0) {
      const lines = rawOrderItems.map((it, idx) => {
        const inp = (it.inputData as Record<string, unknown> | null) ?? {};
        const qtyRaw = inp.qty ?? inp.quantity ?? inp.jumlah;
        const qty = qtyRaw != null ? Number(qtyRaw) : null;
        const unit = inp.unit ? String(inp.unit) : null;
        const sub = it.subtotal ? parseFloat(it.subtotal) : null;
        const parts = [`${idx + 1}. ${it.serviceName}`];
        if (qty != null) parts.push(`   Qty: ${qty}${unit ? ` ${unit}` : ""}`);
        if (sub != null && sub > 0) {
          if (qty != null && qty > 1) {
            parts.push(`   Harga/Unit: ${fmtRp(sub / qty)}`);
          }
          parts.push(`   Subtotal: ${fmtRp(sub)}`);
        }
        return parts.join("\n");
      });
      itemsBlock = lines.join("\n\n");
    }

    // Hitung breakdown subtotal/tax/total untuk WA
    const displaySubtotal = orderSubtotalNum > 0 ? orderSubtotalNum
      : customerPrice ? Math.round(customerPrice / 1.11) : null;
    const displayTax = orderTaxNum > 0 ? orderTaxNum
      : displaySubtotal ? (customerPrice! - displaySubtotal) : null;
    const displayTotal = customerPrice ?? (displaySubtotal != null && displayTax != null ? displaySubtotal + displayTax : null);

    const margin = customerPrice && vendorCost ? customerPrice - vendorCost : null;

    const validUntil = validInDays
      ? new Date(Date.now() + validInDays * 86_400_000)
      : new Date(Date.now() + 3 * 86_400_000);

    const token = tok();

    // Resolve templateSnapshot from RFQ (saved in STEP 2) or from order's categoryKey
    let templateSnapshot: Record<string, unknown> | null = (rfq as any).templateSnapshot ?? null;
    const orderCategoryKey: string | null = (order as any).categoryKey ?? null;
    const rfqTemplateId: string | null = (rfq as any).templateId ? String((rfq as any).templateId) : null;
    const rfqTemplateVersion: string | null = (rfq as any).templateVersion ?? null;
    if (!templateSnapshot && orderCategoryKey) {
      try {
        const resolved = await resolveTemplate(orderCategoryKey);
        if (resolved) templateSnapshot = resolved as unknown as Record<string, unknown>;
      } catch { /* non-critical */ }
    }

    // Create customer_quote_links record
    const [link] = await db.insert(customerQuoteLinksTable).values({
      rfqId,
      orderId: order.id,
      token,
      status: "pending",
      etaFinal: etaFinal ?? (order as any).etaFinal ?? null,
      termsConditions: termsConditions ?? null,
      quoteNotes: quoteNotes ?? null,
      finalCustomerPrice: customerPrice ? String(customerPrice) : null,
      vendorCost: vendorCost ? String(vendorCost) : null,
      margin: margin ? String(margin) : null,
      validUntil,
      categoryKey: orderCategoryKey,
      templateId: rfqTemplateId,
      templateVersion: rfqTemplateVersion,
      templateSnapshot: templateSnapshot ?? undefined,
    } as any).returning();

    // Save per-item price breakdown if provided (Step 12/13)
    if (Array.isArray(priceItems) && priceItems.length > 0 && link?.id) {
      await db.execute(sql`
        UPDATE customer_quote_links SET price_items = ${JSON.stringify(priceItems)}::jsonb
        WHERE id = ${link.id}
      `).catch(() => {});
    }

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

    updateOrderProgress(order.id, "SENT_TO_CUSTOMER", "admin", "Admin", `Penawaran dikirim ke customer. Harga: ${fmtRp(customerPrice)}`).catch(() => {});

    // Audit trail: customer_approval_history + order_audit_logs
    logCustomerApprovalEvent({
      orderId: order.id,
      orderNumber: order.orderNumber,
      rfqId: rfq.id,
      eventType: "quotation_sent",
      oldStatus: (order as any).customer_quote_status ?? null,
      newStatus: "customer_quoted",
      customerName: order.customerName ?? null,
      customerEmail: order.email ?? null,
      customerPhone: order.phone ?? null,
      tokenUsed: token,
      actorType: "admin",
      actorName: "Admin",
    }).catch(() => {});
    logOrderAudit({
      orderId: order.id,
      orderNumber: order.orderNumber,
      rfqId: rfq.id,
      actorType: "admin",
      actorName: "Admin",
      action: "customer_quoted",
      description: `Penawaran dikirim ke customer ${order.customerName ?? "-"}. Harga: ${fmtRp(customerPrice)}. ETA: ${etaFinal ?? "—"}.`,
      newValue: { customerPrice, etaFinal, token },
    }).catch(() => {});

    const quoteUrl = `${getBaseUrl()}/customer-quote/${token}`;

    // Send WhatsApp to customer
    if (order.phone) {
      const tplBody = await getWaTemplateConfig("customer", "customer_approval",
        `✅ *PENAWARAN SIAP — CST LOGISTICS*\n` +
        `━━━━━━━━━━━━━━━━━━\n` +
        `Halo *{{customerName}}*,\n\n` +
        `Penawaran untuk order *{{orderNumber}}* telah siap.\n` +
        `No. RFQ    : {{rfqNumber}}\n` +
        `Layanan    : {{shipmentType}}\n` +
        `Rute       : {{route}}\n` +
        `━━━━━━━━━━━━━━━━━━\n` +
        `{{itemsBlock}}\n` +
        `━━━━━━━━━━━━━━━━━━\n` +
        `💵 Subtotal : {{subtotalDisplay}}\n` +
        `🧾 PPN 11%  : {{taxDisplay}}\n` +
        `💰 Total    : *{{totalDisplay}}*\n` +
        `ETA         : {{etaFinal}}\n` +
        `Valid s/d   : {{validUntil}}\n` +
        `━━━━━━━━━━━━━━━━━━\n` +
        `Silakan review dan konfirmasi melalui link berikut:\n` +
        `🔗 {{customerApprovalLink}}\n\n` +
        `Penawaran berlaku {{validUntil}}.\n` +
        `Terima kasih 🙏\n_B2B Marketplace and Logistic_`
      );
      const svcType = deriveServiceType(order.shipmentType ?? "", (order as any).orderType ?? undefined);
      const origin = order.origin || null;
      const destination = order.destination || null;
      // Build commodity context from resolved templateSnapshot — never exposes base price/margin
      const { buildCommodityContext } = await import("../lib/orderNotification.js");
      const firstItemForCtx = itemsBlock
        ? (() => {
            const raw = (order as any).items ?? (order as any).orderItems ?? [];
            return Array.isArray(raw) ? raw[0] : null;
          })()
        : null;
      const commodityCtxCQ = buildCommodityContext(templateSnapshot ?? null, {
        quantity: firstItemForCtx?.qty ?? firstItemForCtx?.quantity ?? null,
        unit: firstItemForCtx?.unit ?? null,
      });
      const waMsg = renderTemplate(tplBody, {
        customerName: order.customerName ?? "Customer",
        rfqNumber: rfq.rfqNumber,
        orderNumber: order.orderNumber,
        shipmentType: order.shipmentType || null,
        serviceType: svcType || null,
        origin,
        destination,
        commodity: order.commodity ?? null,
        cargoDescription: order.cargoDescription ?? null,
        route: (origin && destination) ? `${origin} → ${destination}` : (origin || destination || null),
        itemsBlock,
        subtotalDisplay: displaySubtotal != null ? fmtRp(displaySubtotal) : null,
        taxDisplay: displayTax != null ? fmtRp(displayTax) : null,
        totalDisplay: fmtRp(displayTotal),
        sellingPrice: fmtRp(customerPrice),
        etaFinal: etaFinal ?? null,
        validUntil: validUntil.toLocaleDateString("id-ID"),
        customerApprovalLink: quoteUrl,
        timestamp: new Date().toLocaleString("id-ID", { timeZone: "Asia/Jakarta" }),
        ...commodityCtxCQ,
      }, svcType);
      sendWhatsApp(order.phone, waMsg).catch((e) =>
        logger.warn({ e }, "customerQuote WA to customer failed")
      );
    }

    logger.info({ rfqId, orderId: order.id, token }, "Customer quote sent");
    broadcastInvalidation("rfq", order.id);
    broadcastInvalidation("logistic_orders", order.id);
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
        const [orderRow] = await db.select().from(logisticOrdersTable).where(eq(logisticOrdersTable.id, orderId));
        const defaultTpl = ["🚚 *Tugas Order Baru — B2B Marketplace and Logistic*","","Order: {{orderNumber}}","Rute: {{route}}","Keterangan: {{label}}","","Silakan buka link berikut untuk konfirmasi dan update status:","{{taskUrl}}","_{{timestamp}}_"].join("\n");
        const tplBody = await getWaTemplateConfig("vendor", "task_link", defaultTpl);
        const waMsg = renderTemplate(tplBody, {
          orderNumber: orderRow?.orderNumber ?? String(orderId),
          route: orderRow ? `${orderRow.origin ?? ""} → ${orderRow.destination ?? ""}` : "",
          label: label ?? null,
          taskUrl,
          timestamp: new Date().toLocaleString("id-ID", { timeZone: "Asia/Jakarta" }),
        });
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
    const freightShipments = (freightRows.rows as any[]).map((row: any) => ({
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
    const svcResult = await transitionLogisticOrderStatus(orderId, status, {
      actorType: "admin",
      actorId: (req.user as { id?: string } | undefined)?.id ?? undefined,
      actorName: actorName ?? "Admin",
      notes: notes ?? undefined,
      source: "PATCH /logistic/orders/:orderId/status",
      skipAudit: false,
    });
    if (!svcResult.ok) {
      if (svcResult.allowedTransitions !== undefined) {
        return res.status(422).json({
          message: svcResult.error,
          allowedTransitions: svcResult.allowedTransitions,
          code: "INVALID_TRANSITION",
        });
      }
      return res.status(400).json({ message: svcResult.error ?? "Gagal update status" });
    }
    await db.insert(orderUpdatesTable).values({
      orderId, actorType: "admin", actorName: actorName ?? "Admin",
      status, notes: notes ?? `Status diubah ke: ${status}`, isPublic: true,
    });
    broadcastInvalidation("logistic_orders", orderId);
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
    if (!link) {
      logTokenAccess({ tokenType: "customer_quote", tokenRef: token, action: "view", outcome: "denied_not_found", req });
      return res.status(404).json({ error: "Link tidak ditemukan" });
    }
    if ((link as any).revokedAt) {
      logTokenAccess({ tokenType: "customer_quote", tokenRef: token, entityId: link.id, action: "view", outcome: "denied_revoked", req });
      return res.status(403).json({ error: "Link ini telah dicabut", isRevoked: true });
    }
    const isExpiredNow = link.validUntil && link.validUntil < new Date();
    if (isExpiredNow) {
      logTokenAccess({ tokenType: "customer_quote", tokenRef: token, entityId: link.id, action: "view", outcome: "denied_expired", req });
      return res.status(410).json({ error: "Link sudah kadaluarsa", isExpired: true });
    }
    logTokenAccess({ tokenType: "customer_quote", tokenRef: token, entityId: link.id, action: "view", outcome: "ok", req });

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

    const [rfqRow] = link.rfqId
      ? await db.select().from(logisticOrderRfqsTable).where(eq(logisticOrderRfqsTable.id, link.rfqId))
      : [null];

    const orderItems = await db.select().from(logisticOrderItemsTable)
      .where(eq(logisticOrderItemsTable.orderId, link.orderId));

    function extractQty(inp: unknown): number | null {
      if (!inp || typeof inp !== "object") return null;
      const d = inp as Record<string, unknown>;
      const q = d.quantity ?? d.qty ?? d.jumlah;
      if (typeof q === "number") return q;
      if (typeof q === "string") { const n = parseFloat(q); return isNaN(n) ? null : n; }
      return null;
    }
    function extractUnit(inp: unknown): string | null {
      if (!inp || typeof inp !== "object") return null;
      const d = inp as Record<string, unknown>;
      const u = d.unit ?? d.satuan ?? d.uom;
      return typeof u === "string" ? u : null;
    }

    function extractUnitPrice(inp: unknown): number | null {
      if (!inp || typeof inp !== "object") return null;
      const d = inp as Record<string, unknown>;
      const raw = d.price ?? d.productPrice ?? d.unitPrice ?? d.sellingPrice ?? null;
      if (typeof raw === "number") return raw;
      if (typeof raw === "string") { const n = parseFloat(raw); return isNaN(n) ? null : n; }
      return null;
    }

    const finalCustomerPrice = link.finalCustomerPrice ? Number(link.finalCustomerPrice) : null;
    const orderSubtotal = order.subtotal ? Number(order.subtotal) : 0;
    const orderTax = order.tax ? Number(order.tax) : 0;
    const orderGrandTotal = order.grandTotal ? Number(order.grandTotal) : 0;

    // Prioritas: gunakan harga dari catalog (order.subtotal + order.tax = grand_total).
    // finalCustomerPrice (override admin) hanya sebagai fallback jika data catalog belum ada.
    let displaySubtotal: number | null = null;
    let displayTax: number | null = null;
    let displayTotal: number | null = null;

    if (orderSubtotal > 0 && orderTax > 0) {
      displaySubtotal = orderSubtotal;
      displayTax = orderTax;
      displayTotal = orderGrandTotal > 0 ? orderGrandTotal : orderSubtotal + orderTax;
    } else if (orderGrandTotal > 0) {
      displaySubtotal = Math.round(orderGrandTotal / 1.11);
      displayTax = orderGrandTotal - displaySubtotal;
      displayTotal = orderGrandTotal;
    } else if (finalCustomerPrice && finalCustomerPrice > 0) {
      // Fallback: belum ada data catalog — pakai harga admin (belum PPN) + PPN
      displaySubtotal = finalCustomerPrice;
      displayTax = calcTax(finalCustomerPrice);
      displayTotal = finalCustomerPrice + displayTax;
    }

    // Bangun priceItems: gunakan stored price_items jika ada (dari Step 12), otherwise computed
    const storedPriceItems = (link as any).price_items ?? null;
    const priceItems: Array<{ name: string; category?: string; subtotal: number; unitPrice: number | null; qty: number | null; unit: string | null }> =
      Array.isArray(storedPriceItems) && storedPriceItems.length > 0
        ? storedPriceItems
        : orderItems.map((i) => {
            const qty = extractQty(i.inputData);
            const unitPrice = extractUnitPrice(i.inputData); // harga catalog (sebelum PPN)
            const dbSubtotal = i.subtotal ? Number(i.subtotal) : 0;
            const subtotal = unitPrice != null && qty != null
              ? unitPrice * qty
              : dbSubtotal;
            return {
              name: i.serviceName,
              category: i.category,
              subtotal,
              unitPrice,
              qty,
              unit: extractUnit(i.inputData),
            };
          });

    return res.json({
      token,
      status: link.status,
      isExpired,
      isResponded,
      rfqNumber: rfqRow?.rfqNumber ?? order.orderNumber,
      quotationNumber: (order as any).quotationNumber ?? null,
      serviceType: order.shipmentType || null,
      origin: order.origin || null,
      destination: order.destination || null,
      cargoDetail: [
        order.commodity, order.cargoDescription,
        order.grossWeight ? `${order.grossWeight} kg` : null,
        order.volumeCbm ? `${order.volumeCbm} cbm` : null,
      ].filter(Boolean).join(" · ") || null,
      finalCustomerPrice,
      displaySubtotal,
      displayTax,
      displayTotal,
      priceItems,
      etaFinal: link.etaFinal,
      termsConditions: link.termsConditions,
      quoteNotes: link.quoteNotes,
      validUntil: link.validUntil?.toISOString() ?? null,
      categoryKey: (link as any).categoryKey ?? null,
      templateId: (link as any).templateId ?? null,
      templateVersion: (link as any).templateVersion ?? null,
      templateSnapshot: (link as any).templateSnapshot ?? null,
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
    if (!link) {
      logTokenAccess({ tokenType: "customer_quote", tokenRef: token, action: "respond", outcome: "denied_not_found", req });
      return res.status(404).json({ error: "Link tidak ditemukan" });
    }
    if ((link as any).revokedAt) {
      logTokenAccess({ tokenType: "customer_quote", tokenRef: token, entityId: link.id, action: "respond", outcome: "denied_revoked", req });
      return res.status(403).json({ error: "Link ini telah dicabut", isRevoked: true });
    }
    const isExpired = link.validUntil && link.validUntil < new Date();
    if (isExpired) {
      logTokenAccess({ tokenType: "customer_quote", tokenRef: token, entityId: link.id, action: "respond", outcome: "denied_expired", req });
      return res.status(410).json({ error: "Link sudah kadaluarsa" });
    }
    const isResponded = ["approved", "revision_requested", "rejected"].includes(link.status);
    if (isResponded) {
      logTokenAccess({ tokenType: "customer_quote", tokenRef: token, entityId: link.id, action: "respond", outcome: "denied_used", req });
      return res.status(409).json({ error: "Penawaran ini sudah dijawab sebelumnya" });
    }
    logTokenAccess({ tokenType: "customer_quote", tokenRef: token, entityId: link.id, action: "respond", outcome: "ok", req });

    const [order] = await db.select().from(logisticOrdersTable)
      .where(eq(logisticOrdersTable.id, link.orderId));
    if (!order) return res.status(404).json({ error: "Order tidak ditemukan" });

    const linkStatus = response === "approve" ? "approved"
      : response === "revise" ? "revision_requested"
      : "rejected";

    const now = new Date();
    // Atomic guard: only update if status is still pending — prevents race between concurrent requests
    const updated = await db.update(customerQuoteLinksTable)
      .set({ status: linkStatus, respondedAt: now })
      .where(and(
        eq(customerQuoteLinksTable.token, token),
        eq(customerQuoteLinksTable.status, "pending"),
      ))
      .returning({ id: customerQuoteLinksTable.id });
    if (!updated.length) {
      return res.status(409).json({ error: "Penawaran ini sudah dijawab oleh request lain" });
    }

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
    const rfqLink = `${getBaseUrl()}/bizportal/logistics/orders/${order.id}`;
    const adminGroupWa = await getAdminGroupWa();

    if (response === "approve") {
      // Create customer tracking link automatically
      const trackToken = tok();
      await db.insert(customerOrderLinksTable).values({ orderId: order.id, token: trackToken });

      // Generate forward_vendor mini-form link (no-login) for admin
      let fwdShort: string | null = null;
      try {
        const { createAdminActionLink, getAdminActionUrl } = await import("./adminAction.js");
        const { generateShortLink } = await import("../lib/shortLink.js");
        const fwdToken = await createAdminActionLink(order.id, "forward_vendor", link.rfqId ?? undefined, 72);
        const fwdUrl = getAdminActionUrl(fwdToken);
        fwdShort = await generateShortLink(fwdUrl, { context: "admin_action", refType: "order", refId: String(order.id) });
      } catch (e) {
        logger.warn({ e }, "customerQuote approve: gagal generate forward_vendor link");
      }

      // Send WA to admin group only
      const ts = new Date().toLocaleString("id-ID", { timeZone: "Asia/Jakarta" });
      if (adminGroupWa) {
        const tplApproveGroup = await getWaTemplateConfig("admin_group", "customer_approved",
          "🎉 *CUSTOMER APPROVED*\n" +
          "━━━━━━━━━━━━━━━━\n" +
          "Order      : *{{orderNumber}}*\n" +
          "Customer   : *{{customerName}}*\n" +
          "━━━━━━━━━━━━━━━━\n" +
          "💰 Harga Jual  : *{{sellingPrice}}*\n" +
          "📦 Harga Basic : {{vendorCost}}\n" +
          "📈 Margin      : {{margin}}\n" +
          "━━━━━━━━━━━━━━━━\n" +
          "{{fwdUrl}}\n" +
          "_{{timestamp}}_"
        );
        const _selling = link.finalCustomerPrice ? Number(link.finalCustomerPrice) : null;
        const _cost = link.vendorCost ? Number(link.vendorCost) : null;
        const _margin = (_selling != null && _cost != null) ? _selling - _cost : null;
        const approvedVars = {
          rfqNumber: rfqNum, orderNumber: order.orderNumber, customerName: order.customerName,
          sellingPrice: fmtRp(_selling),
          vendorCost: fmtRp(_cost),
          margin: _margin != null
            ? `${fmtRp(_margin)}${_selling ? ` (${Math.round((_margin / _selling) * 100)}%)` : ""}`
            : "—",
          fwdUrl: fwdShort ? `📦 Forward ke vendor (tanpa login):\n${fwdShort}` : `Lihat order:\n${adminLink}`,
          timestamp: ts,
        };
        sendWhatsApp(adminGroupWa, renderTemplate(tplApproveGroup, approvedVars)).catch(() => {});
      }

      // Notify selected vendor
      if (order.approvedVendorId) {
        const [vendor] = await db.select().from(suppliersTable)
          .where(eq(suppliersTable.id, order.approvedVendorId));
        if (vendor?.phone) {
          const defaultVendorTpl = "📦 *Order Dikonfirmasi — B2B Marketplace and Logistic*\n\nOrder: {{orderNumber}}\nRute: {{route}}\n\nCustomer telah menyetujui penawaran. Tim CST akan segera menghubungi Anda.";
          const tplVendor = await getWaTemplateConfig("vendor", "customer_approved", defaultVendorTpl);
          const waVendor = renderTemplate(tplVendor, {
            orderNumber: order.orderNumber,
            route: `${order.origin} → ${order.destination}`,
            timestamp: ts,
          });
          sendWhatsApp(vendor.phone, waVendor).catch(() => {});
        }
      }
    } else if (response === "revise") {
      const ts = new Date().toLocaleString("id-ID", { timeZone: "Asia/Jakarta" });
      if (adminGroupWa) {
        const tpl = await getWaTemplateConfig("admin_group", "customer_revised", "🟡 *CUSTOMER REVISI — {{rfqNumber}}*\nCustomer: {{customerName}}\nCatatan: {{revisionNotes}}\n{{rfqLink}}\n_{{timestamp}}_");
        const waAdmin = renderTemplate(tpl, {
          rfqNumber: rfqNum, customerName: order.customerName,
          revisionNotes: revisionNotes ?? "—", rfqLink, timestamp: ts,
        });
        sendWhatsApp(adminGroupWa, waAdmin).catch(() => {});
      }
      if (order.phone) {
        const custTpl = await getWaTemplateConfig("customer", "quote_revision_sent",
          "🔄 *Revisi Penawaran Dikirim*\n\nHalo *{{customerName}}*,\n\nCatatan revisi Anda untuk order *{{orderNumber}}* telah kami terima.\n\nCatatan: {{revisionNotes}}\n\nTim kami akan segera menindaklanjuti dan mengirimkan penawaran baru.\n\nTerima kasih 🙏\n_B2B Marketplace and Logistic_"
        );
        sendWhatsApp(order.phone, renderTemplate(custTpl, {
          customerName: order.customerName ?? "Customer",
          orderNumber: order.orderNumber,
          revisionNotes: revisionNotes ?? "—",
          timestamp: ts,
        })).catch(() => {});
      }
    } else if (response === "reject") {
      const ts = new Date().toLocaleString("id-ID", { timeZone: "Asia/Jakarta" });
      if (adminGroupWa) {
        const tpl = await getWaTemplateConfig("admin_group", "customer_rejected", "🔴 *CUSTOMER TOLAK — {{rfqNumber}}*\nCustomer: {{customerName}}\nAlasan: {{rejectionReason}}\n{{rfqLink}}\n_{{timestamp}}_");
        const waAdmin = renderTemplate(tpl, {
          rfqNumber: rfqNum, customerName: order.customerName,
          rejectionReason: rejectionReason ?? "—", rfqLink, timestamp: ts,
        });
        sendWhatsApp(adminGroupWa, waAdmin).catch(() => {});
      }
      if (order.phone) {
        const custTpl = await getWaTemplateConfig("customer", "quote_rejected_confirmation",
          "❌ *Penolakan Penawaran Tercatat*\n\nHalo *{{customerName}}*,\n\nPenolakan penawaran untuk order *{{orderNumber}}* telah kami catat.\n\nAlasan: {{rejectionReason}}\n\nJika ada pertanyaan atau ingin melanjutkan proses dengan syarat lain, silakan hubungi kami.\n\nTerima kasih 🙏\n_B2B Marketplace and Logistic_"
        );
        sendWhatsApp(order.phone, renderTemplate(custTpl, {
          customerName: order.customerName ?? "Customer",
          orderNumber: order.orderNumber,
          rejectionReason: rejectionReason ?? "—",
          timestamp: ts,
        })).catch(() => {});
      }
    }

    // Audit trail: customer_approval_history + order_audit_logs
    logCustomerApprovalEvent({
      orderId: order.id,
      orderNumber: order.orderNumber,
      rfqId: link.rfqId ?? null,
      eventType: response === "approve" ? "quotation_approved"
        : response === "revise" ? "quotation_revision_requested"
        : "quotation_rejected",
      oldStatus: "customer_quoted",
      newStatus: linkStatus,
      customerName: order.customerName ?? null,
      customerEmail: order.email ?? null,
      customerPhone: order.phone ?? null,
      tokenUsed: token,
      response,
      revisionNotes: revisionNotes ?? null,
      rejectionReason: rejectionReason ?? null,
      actorType: "customer",
      actorName: order.customerName ?? null,
      ipAddress: req.ip ?? null,
    }).catch(() => {});
    logOrderAudit({
      orderId: order.id,
      orderNumber: order.orderNumber,
      rfqId: link.rfqId ?? null,
      actorType: "customer",
      actorName: order.customerName ?? null,
      action: response === "approve" ? "customer_approved"
        : response === "revise" ? "customer_revision_requested"
        : "customer_rejected",
      description: notes,
      newValue: { response, linkStatus, revisionNotes, rejectionReason },
      ipAddress: req.ip ?? null,
    }).catch(() => {});

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
      const svcRes = await transitionLogisticOrderStatus(link.orderId, status, {
        actorType: "vendor",
        actorName: vendorName ?? "Vendor",
        source: "POST /task-link/:token/update",
        force: true,
        skipAudit: false,
      });
      if (!svcRes.ok) logger.warn({ svcRes, status, orderId: link.orderId }, "task-link status update rejected");
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

    // Notify admin group
    const adminGroupWaTask = await getAdminGroupWa();
    if (adminGroupWaTask && (status || notes)) {
      const waMsg =
        `📦 Update Order — ${order.orderNumber}\n` +
        `Dari: ${vendorName ?? link.roleType}\n` +
        (status ? `Status: ${status}\n` : "") +
        (notes ? `Catatan: ${notes}\n` : "");
      sendWhatsApp(adminGroupWaTask, waMsg).catch(() => {});
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

    const productPrice = (order as any).productPrice ? Number((order as any).productPrice) : null;
    const truckPrice = (order as any).truckPrice ? Number((order as any).truckPrice) : null;
    const truckSource: string | null = (order as any).truckSource ?? null;
    const totalPrice = (productPrice != null && truckPrice != null)
      ? productPrice + truckPrice
      : productPrice ?? truckPrice ?? null;

    return res.json({
      orderNumber: order.orderNumber,
      serviceType: order.shipmentType,
      origin: order.origin,
      destination: order.destination,
      status: order.status,
      etaFinal: (order as any).etaFinal ?? null,
      createdAt: order.createdAt,
      productPrice,
      truckPrice,
      truckSource,
      totalPrice,
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
