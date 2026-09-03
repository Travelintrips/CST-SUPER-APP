import { Router, type Request, type Response } from "express";
import { randomBytes } from "crypto";
import { db } from "@workspace/db";
import { suppliersTable } from "@workspace/db";
import { eq, sql, inArray, desc } from "drizzle-orm";
import { requireAdmin, requireAdminMiddleware } from "../lib/requireAdmin.js";
import { sendViaService as sendWhatsApp } from "../lib/waTransport.js";
import { getAdminGroupWa } from "../lib/adminWa.js";
import { getPreferredDomain } from "../lib/domain.js";
import { sendMail, isSmtpConfigured } from "../lib/mailer.js";
import { logger } from "../lib/logger.js";
import { resolveCompanyId } from "../lib/resolveCompany.js";
import { assertCompanyAccess } from "../lib/assertCompanyAccess.js";
import { notifyCustomerPortal } from "../lib/customerPortalNotificationService.js";
import { filterSuppliersByCapability, VENDOR_CAPABILITY_KEYS } from "../lib/vendorCapabilityService.js";

export const oceanFreightRouter = Router();

// ─── Tables dikelola oleh Drizzle schema (lib/db/src/schema/oceanFreight.ts) ──
// CREATE TABLE dihapus — gunakan drizzle-kit push untuk migrasi.
// Seed data default rates jika tabel kosong.
(async () => {
  try {
    const { rows: cnt } = await db.execute(sql`SELECT COUNT(*) AS c FROM ocean_freight_rates`);
    if (Number((cnt[0] as any)?.c ?? 0) === 0) {
      const today = new Date().toISOString().slice(0, 10);
      const validUntil = new Date(Date.now() + 30 * 86400000).toISOString().slice(0, 10);
      await db.execute(sql.raw(`
        INSERT INTO ocean_freight_rates
          (rate_source_type,rate_source_name,carrier_name,origin_city,origin_port,destination_city,destination_port,trade_type,shipment_type,service_mode,container_type,currency,exchange_rate_to_idr,ocean_freight_amount,thc_origin,thc_destination,doc_fee,bl_fee,do_fee,handling_fee,customs_clearance_fee,valid_from,valid_until,transit_days,direct_or_transshipment,price_status,is_active)
        VALUES
          ('shipping_line','Samudera','Samudera','Surabaya','Tanjung Perak','Singapore','PSA Singapore','export','FCL','port_to_port','20ft','USD',16500,350,150,180,50,35,45,75,100,'${today}','${validUntil}',5,'direct','estimate',true),
          ('shipping_line','Samudera','Samudera','Surabaya','Tanjung Perak','Singapore','PSA Singapore','export','FCL','port_to_port','40ft','USD',16500,600,150,180,50,35,45,75,100,'${today}','${validUntil}',5,'direct','estimate',true),
          ('shipping_line','Samudera','Samudera','Surabaya','Tanjung Perak','Singapore','PSA Singapore','export','LCL','port_to_port',NULL,'USD',16500,0,100,120,50,35,45,75,100,'${today}','${validUntil}',6,'direct','estimate',true),
          ('shipping_line','Meratus','Meratus','Jakarta','Tanjung Priok','Singapore','PSA Singapore','export','FCL','port_to_port','20ft','USD',16500,380,130,160,50,35,45,70,100,'${today}','${validUntil}',4,'direct','estimate',true),
          ('shipping_line','Meratus','Meratus','Jakarta','Tanjung Priok','Singapore','PSA Singapore','export','FCL','port_to_port','40ft','USD',16500,650,130,160,50,35,45,70,100,'${today}','${validUntil}',4,'direct','estimate',true),
          ('shipping_line','Meratus','Meratus','Jakarta','Tanjung Priok','Singapore','PSA Singapore','export','LCL','port_to_port',NULL,'USD',16500,0,90,120,50,35,45,70,100,'${today}','${validUntil}',5,'direct','estimate',true),
          ('nvocc','Temas Line','Temas','Surabaya','Tanjung Perak','Singapore','PSA Singapore','export','FCL','port_to_port','20ft','USD',16500,320,150,180,50,35,45,75,100,'${today}','${validUntil}',7,'transshipment','estimate',true)
        ON CONFLICT DO NOTHING
      `)).catch(() => {});
    }
    logger.info("[oceanFreight] seed check done");
  } catch (e) {
    logger.warn({ err: e }, "[oceanFreight] seed check skipped");
  }
})();

// ─── Helpers ──────────────────────────────────────────────────────────────────
function generateOrderNumber(): string {
  const now = new Date();
  const yy = String(now.getFullYear()).slice(2);
  const mm = String(now.getMonth() + 1).padStart(2, "0");
  const rand = Math.floor(Math.random() * 9000 + 1000);
  return `OCF/${yy}${mm}/${rand}`;
}

function generateRfqNumber(): string {
  const now = new Date();
  const yy = String(now.getFullYear()).slice(2);
  const mm = String(now.getMonth() + 1).padStart(2, "0");
  const rand = Math.floor(Math.random() * 9000 + 1000);
  return `RFQ-OCF/${yy}${mm}/${rand}`;
}

function getVendorFormUrl(token: string): string {
  const domain = getPreferredDomain();
  if (!domain) return "";
  return `https://${domain}/ocean-freight/vendor-form/${token}`;
}

function getQuoteApprovalUrl(token: string): string {
  const domain = getPreferredDomain();
  if (!domain) return "";
  return `https://${domain}/ocean-freight/approval/${token}`;
}

// ─── Admin: list orders ───────────────────────────────────────────────────────
oceanFreightRouter.get("/orders", async (req: Request, res: Response) => {
  if (!(await requireAdmin(req, res))) return;
  try {
    const cId    = req.query.companyId ? Number(req.query.companyId) : null;
    const status = (req.query.status as string) || null;
    const search = (req.query.search as string) || null;
    const page   = Math.max(1, Number(req.query.page ?? 1));
    const limit  = Math.min(100, Math.max(1, Number(req.query.limit ?? 50)));
    const offset = (page - 1) * limit;
    const searchPattern = search ? `%${search}%` : null;

    // Build WHERE fragments conditionally to avoid null::type cast issues
    const whereParts: ReturnType<typeof sql>[] = [];
    if (cId != null)          whereParts.push(sql`o.company_id = ${cId}`);
    if (status != null)       whereParts.push(sql`o.status = ${status}`);
    if (searchPattern != null) whereParts.push(sql`(
      o.order_number ILIKE ${searchPattern} OR
      o.customer_name ILIKE ${searchPattern} OR
      o.origin_port ILIKE ${searchPattern} OR
      o.destination_port ILIKE ${searchPattern}
    )`);
    const whereClause = whereParts.length > 0
      ? sql`WHERE ${sql.join(whereParts, sql` AND `)}`
      : sql``;

    const [rows, cnt] = await Promise.all([
      db.execute(sql`
        SELECT o.*,
          (SELECT COUNT(*) FROM ocean_freight_rfqs r WHERE r.order_id = o.id) AS rfq_count,
          (SELECT COUNT(*) FROM ocean_freight_rate_submissions s WHERE s.order_id = o.id AND s.status = 'submitted') AS submission_count
        FROM ocean_freight_orders o
        ${whereClause}
        ORDER BY o.created_at DESC
        LIMIT ${limit} OFFSET ${offset}
      `),
      db.execute(sql`
        SELECT COUNT(*) AS cnt FROM ocean_freight_orders o
        ${whereClause}
      `),
    ]);

    res.json({ data: rows.rows, total: Number((cnt.rows[0] as any)?.cnt ?? 0), page, limit });
  } catch (err) {
    logger.error({ err }, "[ocean-freight] GET /orders error");
    res.status(500).json({ error: "Gagal memuat orders" });
  }
});

// ─── Admin: get order detail ──────────────────────────────────────────────────
oceanFreightRouter.get("/orders/:id", async (req: Request, res: Response) => {
  if (!(await requireAdmin(req, res))) return;
  try {
    const id = Number(String(req.params.id));
    const [orderRes, rfqsRes, submissionsRes] = await Promise.all([
      db.execute(sql.raw(`SELECT * FROM ocean_freight_orders WHERE id = ${id}`)),
      db.execute(sql.raw(`SELECT r.*, v.name AS vendor_name_db FROM ocean_freight_rfqs r LEFT JOIN suppliers v ON v.id = r.vendor_id WHERE r.order_id = ${id} ORDER BY r.created_at DESC`)),
      db.execute(sql.raw(`SELECT s.*, r.rfq_number FROM ocean_freight_rate_submissions s LEFT JOIN ocean_freight_rfqs r ON r.id = s.rfq_id WHERE s.order_id = ${id} AND s.status = 'submitted' ORDER BY s.total_amount_idr ASC`)),
    ]);
    const order = orderRes.rows[0];
    if (!order) return res.status(404).json({ error: "Order tidak ditemukan" });
    res.json({ order, rfqs: rfqsRes.rows, submissions: submissionsRes.rows });
  } catch (err) {
    logger.error({ err }, "[ocean-freight] GET /orders/:id error");
    res.status(500).json({ error: "Gagal memuat order" });
  }
});

// ─── Admin: update order status ───────────────────────────────────────────────
oceanFreightRouter.put("/orders/:id/status", async (req: Request, res: Response) => {
  if (!(await requireAdmin(req, res))) return;
  try {
    const id = Number(String(req.params.id));
    const { status, admin_notes } = req.body;
    const validStatuses = ["draft","estimated","waiting_rate","rate_requested","rate_received","quoted","approved","booked","sailed","arrived","completed","cancelled","quote_declined"];
    if (!validStatuses.includes(status)) return res.status(400).json({ error: "Status tidak valid" });

    await db.execute(sql.raw(`UPDATE ocean_freight_orders SET status = '${status}', ${admin_notes ? `admin_notes = '${admin_notes.replace(/'/g, "''")}',` : ""} updated_at = NOW() WHERE id = ${id}`));
    res.json({ ok: true });
  } catch (err) {
    logger.error({ err }, "[ocean-freight] PUT /orders/:id/status error");
    res.status(500).json({ error: "Gagal update status" });
  }
});

// ─── Admin: blast RFQ ─────────────────────────────────────────────────────────
oceanFreightRouter.post("/orders/:id/rfq-blast", async (req: Request, res: Response) => {
  if (!(await requireAdmin(req, res))) return;
  try {
    const id = Number(String(req.params.id));
    const { vendor_ids = [], blast_notes = "", expires_hours = 48 } = req.body;

    const orderRes = await db.execute(sql.raw(`SELECT * FROM ocean_freight_orders WHERE id = ${id}`));
    const order = orderRes.rows[0] as any;
    if (!order) return res.status(404).json({ error: "Order tidak ditemukan" });

    const rfqs: any[] = [];
    const domain = getPreferredDomain();

    // If vendor_ids provided, blast to those vendors; else create a single generic RFQ
    const targets: Array<{ vendor_id: number | null; name: string; phone: string | null; email: string | null }> = [];

    if (vendor_ids.length > 0) {
      const vendorRows = await db.execute(sql.raw(
        `SELECT id, name, contact_phone, contact_email FROM suppliers WHERE id IN (${vendor_ids.join(",")}) AND is_active = true`
      ));
      for (const v of vendorRows.rows as any[]) {
        targets.push({ vendor_id: v.id, name: v.name, phone: v.contact_phone, email: v.contact_email });
      }
    } else {
      // Generic manual RFQ
      targets.push({ vendor_id: null, name: "Manual", phone: null, email: null });
    }

    for (const t of targets) {
      const rfqNumber = generateRfqNumber();
      const rfqToken  = randomBytes(24).toString("hex");
      const expiresAt = new Date(Date.now() + expires_hours * 3600 * 1000).toISOString();

      await db.execute(sql.raw(`
        INSERT INTO ocean_freight_rfqs (order_id, rfq_number, vendor_id, contact_name, contact_phone, contact_email, sent_channel, rfq_token, status, expires_at)
        VALUES (${id}, '${rfqNumber}', ${t.vendor_id ?? "NULL"}, '${t.name.replace(/'/g, "''")}', ${t.phone ? `'${t.phone}'` : "NULL"}, ${t.email ? `'${t.email}'` : "NULL"}, 'whatsapp', '${rfqToken}', 'sent', '${expiresAt}')
      `));

      const formUrl = domain ? `https://${domain}/ocean-freight/vendor-form/${rfqToken}` : rfqToken;
      const msg = `*Ocean Freight RFQ*\n\nHalo ${t.name},\n\nKami membutuhkan penawaran freight ocean untuk:\n• Rute: ${order.origin_port} → ${order.destination_port}\n• Jenis: ${order.shipment_type}${order.container_type ? ` / ${order.container_type}` : ""}\n• Trade: ${order.trade_type}\n• Komoditas: ${order.commodity || "-"}\n\nSilakan isi rate melalui link berikut:\n${formUrl}\n\nLink berlaku ${expires_hours} jam.\n\nTerima kasih.`;

      if (t.phone) {
        try { await sendWhatsApp(t.phone, msg); } catch {}
      }
      if (t.email && isSmtpConfigured()) {
        try { await sendMail({ to: t.email, subject: `Ocean Freight RFQ - ${rfqNumber}`, text: msg, html: `<pre>${msg}</pre>` }); } catch {}
      }

      rfqs.push({ rfq_number: rfqNumber, rfq_token: rfqToken, vendor_id: t.vendor_id, form_url: formUrl });
    }

    await db.execute(sql.raw(`UPDATE ocean_freight_orders SET status = 'rate_requested', updated_at = NOW() WHERE id = ${id}`));

    // Notify admin group
    try {
      const adminWa = await getAdminGroupWa();
      if (adminWa) await sendWhatsApp(adminWa, `*Ocean Freight RFQ Blast*\nOrder: ${order.order_number}\nRute: ${order.origin_port} → ${order.destination_port}\nDikirim ke ${rfqs.length} vendor/partner.`);
    } catch {}

    res.json({ ok: true, rfqs });
  } catch (err) {
    logger.error({ err }, "[ocean-freight] POST /orders/:id/rfq-blast error");
    res.status(500).json({ error: "Gagal blast RFQ" });
  }
});

// ─── Admin: set final quote ───────────────────────────────────────────────────
oceanFreightRouter.post("/orders/:id/final-quote", async (req: Request, res: Response) => {
  if (!(await requireAdmin(req, res))) return;
  try {
    const id = Number(String(req.params.id));
    const {
      submission_id, final_price, currency = "IDR", exchange_rate = 1,
      markup_amount = 0, ppn_pct = 0, admin_notes = "",
      final_breakdown = {},
      // Manual input (when no submission)
      carrier, vessel_name, voyage, etd, eta, transit_days,
    } = req.body;

    const finalPriceNum  = Number(final_price || 0);
    const markupNum      = Number(markup_amount || 0);
    const subtotal       = finalPriceNum + markupNum;
    const ppnAmount      = subtotal * (Number(ppn_pct) / 100);
    const grandTotal     = subtotal + ppnAmount;
    const finalPriceIdr  = currency === "IDR" ? grandTotal : grandTotal * Number(exchange_rate);

    await db.execute(sql.raw(`
      UPDATE ocean_freight_orders SET
        final_rate_id     = ${submission_id ?? "NULL"},
        final_price       = ${finalPriceNum},
        final_price_idr   = ${finalPriceIdr},
        markup_amount     = ${markupNum},
        ppn_pct           = ${Number(ppn_pct)},
        ppn_amount        = ${ppnAmount},
        grand_total       = ${grandTotal},
        final_breakdown   = '${JSON.stringify(final_breakdown).replace(/'/g, "''")}',
        admin_notes       = '${(admin_notes || "").replace(/'/g, "''")}',
        currency          = '${currency}',
        ${carrier ? `carrier = '${carrier.replace(/'/g, "''")}',` : ""}
        ${vessel_name ? `vessel_name = '${vessel_name.replace(/'/g, "''")}',` : ""}
        ${voyage ? `voyage = '${voyage.replace(/'/g, "''")}',` : ""}
        ${etd ? `etd = '${etd}',` : ""}
        ${eta ? `eta = '${eta}',` : ""}
        price_status      = 'confirmed',
        updated_at        = NOW()
      WHERE id = ${id}
    `));
    res.json({ ok: true, grand_total: grandTotal, final_price_idr: finalPriceIdr });
  } catch (err) {
    logger.error({ err }, "[ocean-freight] POST /orders/:id/final-quote error");
    res.status(500).json({ error: "Gagal set final quote" });
  }
});

// ─── Admin: send quote to customer ───────────────────────────────────────────
oceanFreightRouter.post("/orders/:id/send-quote", async (req: Request, res: Response) => {
  if (!(await requireAdmin(req, res))) return;
  try {
    const id = Number(String(req.params.id));
    const orderRes = await db.execute(sql.raw(`SELECT * FROM ocean_freight_orders WHERE id = ${id}`));
    const order = orderRes.rows[0] as any;
    if (!order) return res.status(404).json({ error: "Order tidak ditemukan" });
    if (!order.grand_total) return res.status(400).json({ error: "Set final quote terlebih dahulu" });

    const token = order.quote_token ?? randomBytes(24).toString("hex");
    if (!order.quote_token) {
      await db.execute(sql.raw(`UPDATE ocean_freight_orders SET quote_token = '${token}', updated_at = NOW() WHERE id = ${id}`));
    }

    await db.execute(sql.raw(`UPDATE ocean_freight_orders SET status = 'quoted', quote_sent_at = NOW(), updated_at = NOW() WHERE id = ${id}`));

    const approvalUrl = getQuoteApprovalUrl(token);
    const idr = (n: number) => new Intl.NumberFormat("id-ID", { style: "currency", currency: "IDR", maximumFractionDigits: 0 }).format(n);
    const msg = `*Penawaran Ocean Freight Siap*\n\nYth. ${order.customer_name},\n\nHarga final Ocean Freight Anda sudah tersedia:\n• Rute: ${order.origin_port} → ${order.destination_port}\n• Jenis: ${order.shipment_type}${order.container_type ? ` / ${order.container_type}` : ""}\n• Total: ${idr(Number(order.grand_total ?? 0))}\n\nSilakan review dan approve:\n${approvalUrl}\n\nTerima kasih.`;

    if (order.customer_phone) {
      try { await sendWhatsApp(order.customer_phone, msg); } catch {}
    }
    if (order.customer_email && isSmtpConfigured()) {
      try { await sendMail({ to: order.customer_email, subject: `Penawaran Ocean Freight - ${order.order_number}`, text: msg, html: `<pre>${msg}</pre>` }); } catch {}
    }

    res.json({ ok: true, quote_token: token, approval_url: approvalUrl });
  } catch (err) {
    logger.error({ err }, "[ocean-freight] POST /orders/:id/send-quote error");
    res.status(500).json({ error: "Gagal kirim quote" });
  }
});

// ─── Admin: confirm booking ───────────────────────────────────────────────────
oceanFreightRouter.post("/orders/:id/confirm-booking", async (req: Request, res: Response) => {
  if (!(await requireAdmin(req, res))) return;
  try {
    const id = Number(String(req.params.id));
    const {
      booking_number, carrier, vessel_name, voyage, etd, eta,
      container_number, seal_number, bl_number, booking_attachment_url,
    } = req.body;

    if (!booking_number) return res.status(400).json({ error: "Nomor booking wajib diisi" });

    await db.execute(sql.raw(`
      UPDATE ocean_freight_orders SET
        status                  = 'booked',
        tracking_status         = 'booked',
        booking_number          = '${booking_number.replace(/'/g, "''")}',
        ${carrier ? `carrier = '${carrier.replace(/'/g, "''")}',` : ""}
        ${vessel_name ? `vessel_name = '${vessel_name.replace(/'/g, "''")}',` : ""}
        ${voyage ? `voyage = '${voyage.replace(/'/g, "''")}',` : ""}
        ${etd ? `etd = '${etd}',` : ""}
        ${eta ? `eta = '${eta}',` : ""}
        ${container_number ? `container_number = '${container_number.replace(/'/g, "''")}',` : ""}
        ${seal_number ? `seal_number = '${seal_number.replace(/'/g, "''")}',` : ""}
        ${bl_number ? `bl_number = '${bl_number.replace(/'/g, "''")}',` : ""}
        ${booking_attachment_url ? `booking_attachment_url = '${booking_attachment_url.replace(/'/g, "''")}',` : ""}
        booking_confirmed_at    = NOW(),
        tracking_updated_at     = NOW(),
        updated_at              = NOW()
      WHERE id = ${id}
    `));

    const orderRes = await db.execute(sql.raw(`SELECT * FROM ocean_freight_orders WHERE id = ${id}`));
    const order = orderRes.rows[0] as any;
    if (order?.customer_phone) {
      const msg = `*Booking Ocean Freight Dikonfirmasi*\n\nYth. ${order.customer_name},\n\nBooking Anda telah dikonfirmasi:\n• Booking No: ${booking_number}\n• Rute: ${order.origin_port} → ${order.destination_port}\n• Carrier: ${carrier || "-"}\n• Vessel: ${vessel_name || "-"} / ${voyage || "-"}\n• ETD: ${etd || "-"} | ETA: ${eta || "-"}\n\nTerima kasih telah mempercayakan pengiriman Anda kepada kami.`;
      try { await sendWhatsApp(order.customer_phone, msg); } catch {}
    }

    res.json({ ok: true });
  } catch (err) {
    logger.error({ err }, "[ocean-freight] POST /orders/:id/confirm-booking error");
    res.status(500).json({ error: "Gagal konfirmasi booking" });
  }
});

// ─── Admin: update tracking status ───────────────────────────────────────────
oceanFreightRouter.put("/orders/:id/tracking", async (req: Request, res: Response) => {
  if (!(await requireAdmin(req, res))) return;
  try {
    const id = Number(String(req.params.id));
    const { tracking_status, tracking_notes } = req.body;
    const validTracking = ["booked","container_empty_released","stuffed","gate_in","sailed","transshipment","arrived","customs_clearance","delivered","completed"];
    if (!validTracking.includes(tracking_status)) return res.status(400).json({ error: "Tracking status tidak valid" });

    // Also update main status for certain tracking stages
    const statusMap: Record<string, string> = { sailed: "sailed", arrived: "arrived", delivered: "completed", completed: "completed" };
    const mainStatus = statusMap[tracking_status];

    await db.execute(sql.raw(`
      UPDATE ocean_freight_orders SET
        tracking_status     = '${tracking_status}',
        tracking_notes      = '${(tracking_notes || "").replace(/'/g, "''")}',
        tracking_updated_at = NOW(),
        ${mainStatus ? `status = '${mainStatus}',` : ""}
        updated_at          = NOW()
      WHERE id = ${id}
    `));
    res.json({ ok: true });
  } catch (err) {
    logger.error({ err }, "[ocean-freight] PUT /orders/:id/tracking error");
    res.status(500).json({ error: "Gagal update tracking" });
  }
});

// ─── Admin: get suitable vendors ─────────────────────────────────────────────
oceanFreightRouter.get("/orders/:id/vendors", async (req: Request, res: Response) => {
  if (!(await requireAdmin(req, res))) return;
  try {
    const orderId = Number(String(req.params.id));
    if (!Number.isSafeInteger(orderId) || orderId <= 0) {
      return res.status(400).json({ error: "Invalid id" });
    }
    const orderRows = await db.execute(sql`
      SELECT company_id
      FROM ocean_freight_orders
      WHERE id = ${orderId}
      LIMIT 1
    `);
    const companyId = orderRows.rows[0]?.company_id == null
      ? null
      : Number(orderRows.rows[0].company_id);
    if (!orderRows.rows.length) return res.status(404).json({ error: "Order tidak ditemukan" });

    const allVendors = await db.select({
      id: suppliersTable.id,
      name: suppliersTable.name,
      serviceType: suppliersTable.serviceType,
      phone: suppliersTable.phone,
      email: suppliersTable.contactEmail,
      isActive: suppliersTable.isActive,
    }).from(suppliersTable).where(eq(suppliersTable.isActive, true));
    const eligible = await filterSuppliersByCapability(
      allVendors,
      VENDOR_CAPABILITY_KEYS.SEA_FREIGHT,
      (st) => /sea|ocean|laut|freight|forwarder|shipping/.test(st),
      companyId,
    );
    res.json({ data: eligible });
  } catch (err) {
    logger.error({ err }, "[ocean-freight] GET /orders/:id/vendors error");
    res.status(500).json({ error: "Gagal memuat vendor" });
  }
});

const router = Router();

// ── Tables dikelola Drizzle schema (lib/db/src/schema/oceanFreight.ts) ────────

// ── GET /api/ocean-freight — list orders ──────────────────────────────────────
router.get("/", requireAdminMiddleware, async (req: Request, res: Response) => {
  try {
    const { status, search } = req.query as Record<string, string>;
    const { rows } = await db.execute(sql`
      SELECT o.*,
        (SELECT COUNT(*) FROM ocean_freight_rfqs r WHERE r.order_id = o.id) AS rfq_count,
        (SELECT COUNT(*) FROM ocean_freight_rate_submissions s WHERE s.order_id = o.id AND s.status = 'submitted') AS submission_count
      FROM ocean_freight_orders o
      WHERE (${status ?? null}::text IS NULL OR o.status = ${status ?? null})
        AND (${search ?? null}::text IS NULL OR o.order_number ILIKE ${'%' + (search ?? '') + '%'} OR o.customer_name ILIKE ${'%' + (search ?? '') + '%'})
      ORDER BY o.created_at DESC
      LIMIT 200
    `);
    return res.json(rows);
  } catch (e) {
    console.error("[ocean-freight/list]", e);
    return res.status(500).json({ error: "Gagal ambil data orders" });
  }
});

// ── GET /api/ocean-freight/:id ────────────────────────────────────────────────
router.get("/:id", requireAdminMiddleware, async (req: Request, res: Response) => {
  try {
    const id = Number(String(req.params.id));
    const [{ rows: orders }, { rows: rfqs }, { rows: submissions }] = await Promise.all([
      db.execute(sql`SELECT * FROM ocean_freight_orders WHERE id = ${id}`),
      db.execute(sql`SELECT * FROM ocean_freight_rfqs WHERE order_id = ${id} ORDER BY created_at DESC`),
      db.execute(sql`
        SELECT s.*, v.name AS vendor_name_db
        FROM ocean_freight_rate_submissions s
        LEFT JOIN suppliers v ON v.id = s.vendor_id
        WHERE s.order_id = ${id}
        ORDER BY s.created_at DESC
      `),
    ]);
    if (!orders.length) return res.status(404).json({ error: "Order tidak ditemukan" });
    const cid = resolveCompanyId(req);
    if (!await assertCompanyAccess((orders[0] as any).company_id, cid, req, res, { resourceType: "ocean_freight_order", resourceId: id })) return;
    return res.json({ order: orders[0], rfqs, submissions });
  } catch (e) {
    console.error("[ocean-freight/get]", e);
    return res.status(500).json({ error: "Gagal ambil detail order" });
  }
});

// ── PATCH /api/ocean-freight/:id/status ──────────────────────────────────────
router.patch("/:id/status", requireAdmin, async (req: Request, res: Response) => {
  try {
    const id     = Number(String(req.params.id));
    const status = String(req.body?.status ?? "");
    const validStatuses = ["draft","estimated","waiting_rate","rate_requested","rate_received","quoted","approved","booked","sailed","arrived","completed","cancelled","quote_declined"];
    if (!validStatuses.includes(status)) return res.status(400).json({ error: "Status tidak valid" });

    const existingOcn = await db.execute(sql`
      SELECT company_id, portal_customer_id, order_number
      FROM ocean_freight_orders WHERE id = ${id} LIMIT 1
    `);
    if (!existingOcn.rows.length) return res.status(404).json({ error: "Order tidak ditemukan" });
    const cid = resolveCompanyId(req);
    if (!await assertCompanyAccess((existingOcn.rows[0] as any).company_id, cid, req, res, { resourceType: "ocean_freight_order", resourceId: id })) return;
    const updated = await db.execute(sql`
      UPDATE ocean_freight_orders SET status = ${status}, updated_at = NOW() WHERE id = ${id}
      RETURNING status
    `);
    await notifyCustomerPortal({
      portalCustomerId: (existingOcn.rows[0] as any).portal_customer_id,
      eventKey: `ocean-freight:${id}:status:${status}`,
      type: "ocean_freight_status_changed",
      title: "Status Ocean Freight diperbarui",
      message: `Order ${(existingOcn.rows[0] as any).order_number} sekarang berstatus ${status}.`,
      payload: {
        service: "ocean-freight",
        orderId: id,
        orderNumber: (existingOcn.rows[0] as any).order_number,
        status: (updated.rows[0] as any)?.status ?? status,
      },
    });
    return res.json({ ok: true });
  } catch (e) {
    return res.status(500).json({ error: "Gagal update status" });
  }
});

// ── POST /api/ocean-freight/:id/blast-rfq ────────────────────────────────────
router.post("/:id/blast-rfq", requireAdminMiddleware, async (req: Request, res: Response) => {
  try {
    const orderId = Number(String(req.params.id));
    const { vendor_ids, blast_notes, response_hours } = req.body ?? {};

    const { rows: orders } = await db.execute(sql`SELECT * FROM ocean_freight_orders WHERE id = ${orderId}`);
    if (!orders.length) return res.status(404).json({ error: "Order tidak ditemukan" });
    const order = orders[0] as any;

    const cid = resolveCompanyId(req);
    if (!await assertCompanyAccess(order.company_id, cid, req, res, { resourceType: "ocean_freight_order", resourceId: orderId })) return;

    // Create RFQ
    const rfqNumber = `OFR-RFQ/${new Date().getFullYear()}/${String(Math.floor(Math.random() * 99999)).padStart(5, "0")}`;
    const deadline  = response_hours ? new Date(Date.now() + Number(response_hours) * 3600_000) : null;

    const { rows: rfqRows } = await db.execute(sql`
      INSERT INTO ocean_freight_rfqs (order_id, rfq_number, blast_vendor_ids, blast_count, blast_notes, blast_at, response_deadline, status)
      VALUES (${orderId}, ${rfqNumber}, ${Array.isArray(vendor_ids) ? vendor_ids : []}::integer[], ${Array.isArray(vendor_ids) ? vendor_ids.length : 0},
              ${blast_notes ?? null}, NOW(), ${deadline ? deadline.toISOString() : null}, 'open')
      RETURNING *
    `);
    const rfq = rfqRows[0] as any;

    // If vendor_ids provided, get vendor contacts and create submissions
    const vendorLinks: { vendorId: number | null; vendorName: string; token: string; phone: string | null }[] = [];

    if (Array.isArray(vendor_ids) && vendor_ids.length > 0) {
      const { rows: vendors } = await db.execute(sql`
        SELECT id, name, phone, email FROM suppliers WHERE id = ANY(${vendor_ids}::integer[])
      `);

      for (const v of vendors as any[]) {
        const token = randomBytes(24).toString("hex");
        await db.execute(sql`
          INSERT INTO ocean_freight_rate_submissions
            (rfq_id, order_id, vendor_id, vendor_name, token, status, created_at, updated_at)
          VALUES
            (${rfq.id}, ${orderId}, ${v.id}, ${v.name}, ${token}, 'pending', NOW(), NOW())
        `);
        vendorLinks.push({ vendorId: v.id, vendorName: v.name, token, phone: v.phone ?? null });
      }
    } else {
      // No specific vendors — create a generic link
      const token = randomBytes(24).toString("hex");
      await db.execute(sql`
        INSERT INTO ocean_freight_rate_submissions
          (rfq_id, order_id, vendor_id, vendor_name, token, status, created_at, updated_at)
        VALUES
          (${rfq.id}, ${orderId}, NULL, 'Open RFQ', ${token}, 'pending', NOW(), NOW())
      `);
      vendorLinks.push({ vendorId: null, vendorName: "Open RFQ", token, phone: null });
    }

    // Update order status
    await db.execute(sql`
      UPDATE ocean_freight_orders SET status = 'rate_requested', updated_at = NOW() WHERE id = ${orderId}
    `);

    // Send WA to vendors
    const baseUrl = process.env.REPLIT_DEV_DOMAIN ? `https://${process.env.REPLIT_DEV_DOMAIN}` : "";
    for (const v of vendorLinks) {
      if (v.phone) {
        try {
          const formUrl = `${baseUrl}/ocean-freight-vendor-form/${v.token}`;
          const msg = [
            `🚢 *RFQ Ocean Freight - ${rfqNumber}*`,
            `Rute: ${order.origin_port} → ${order.destination_port}`,
            `Jenis: ${order.shipment_type}${order.container_type ? " - " + order.container_type : ""}`,
            `Komoditi: ${order.commodity}`,
            blast_notes ? `Notes: ${blast_notes}` : "",
            ``,
            `Silakan submit rate melalui link berikut:`,
            formUrl,
          ].filter(Boolean).join("\n");
          await sendWhatsApp(v.phone, msg);
        } catch (_) {}
      }
    }

    return res.json({
      ok: true,
      rfq: rfq,
      vendor_links: vendorLinks.map(v => ({
        vendor_name: v.vendorName,
        token: v.token,
        form_url: `${baseUrl}/ocean-freight-vendor-form/${v.token}`,
      })),
    });
  } catch (e) {
    console.error("[ocean-freight/blast-rfq]", e);
    return res.status(500).json({ error: "Gagal blast RFQ" });
  }
});

// ── POST /api/ocean-freight/:id/final-quote ───────────────────────────────────
router.post("/:id/final-quote", requireAdminMiddleware, async (req: Request, res: Response) => {
  try {
    const orderId = Number(String(req.params.id));
    const b = req.body ?? {};

    if (!b.grand_total || Number(b.grand_total) <= 0) return res.status(400).json({ error: "grand_total wajib > 0" });

    const { rows: orders } = await db.execute(sql`SELECT * FROM ocean_freight_orders WHERE id = ${orderId}`);
    if (!orders.length) return res.status(404).json({ error: "Order tidak ditemukan" });
    const order = orders[0] as any;

    const cidFq = resolveCompanyId(req);
    if (!await assertCompanyAccess(order.company_id, cidFq, req, res, { resourceType: "ocean_freight_order", resourceId: orderId })) return;

    await db.execute(sql`
      UPDATE ocean_freight_orders SET
        final_rate_id = ${b.final_rate_id ? Number(b.final_rate_id) : null},
        final_price = ${Number(b.final_price ?? 0)},
        final_price_idr = ${Number(b.final_price_idr ?? b.final_price ?? 0)},
        markup_amount = ${Number(b.markup_amount ?? 0)},
        ppn_amount = ${Number(b.ppn_amount ?? 0)},
        grand_total = ${Number(b.grand_total)},
        final_breakdown = ${JSON.stringify(b.final_breakdown ?? {})}::jsonb,
        admin_notes = ${b.admin_notes ?? null},
        price_status = 'confirmed',
        status = 'quoted',
        quote_sent_at = NOW(),
        updated_at = NOW()
      WHERE id = ${orderId}
    `);

    // Notify customer via WA if phone available
    if (order.customer_phone) {
      try {
        const baseUrl = process.env.REPLIT_DEV_DOMAIN ? `https://${process.env.REPLIT_DEV_DOMAIN}` : "";
        const approvalUrl = `${baseUrl}/ocean-freight-quote/${order.quote_token}`;
        const msg = [
          `✅ *Harga Final Ocean Freight Tersedia*`,
          `No: ${order.order_number}`,
          `Grand Total: IDR ${Number(b.grand_total).toLocaleString("id-ID")}`,
          `Rute: ${order.origin_port} → ${order.destination_port}`,
          ``,
          `Silakan review dan approve:`,
          approvalUrl,
        ].join("\n");
        await sendWhatsApp(order.customer_phone, msg);
      } catch (_) {}
    }

    return res.json({ ok: true });
  } catch (e) {
    console.error("[ocean-freight/final-quote]", e);
    return res.status(500).json({ error: "Gagal kirim final quote" });
  }
});

// ── POST /api/ocean-freight/:id/confirm-booking ──────────────────────────────
router.post("/:id/confirm-booking", requireAdminMiddleware, async (req: Request, res: Response) => {
  try {
    const orderId = Number(String(req.params.id));
    const b = req.body ?? {};

    const existingCb = await db.execute(sql`SELECT company_id FROM ocean_freight_orders WHERE id = ${orderId} LIMIT 1`);
    if (!existingCb.rows.length) return res.status(404).json({ error: "Order tidak ditemukan" });
    const cidCb = resolveCompanyId(req);
    if (!await assertCompanyAccess((existingCb.rows[0] as any).company_id, cidCb, req, res, { resourceType: "ocean_freight_order", resourceId: orderId })) return;

    const bookingNumber = `OFR-BK/${new Date().getFullYear()}/${String(Math.floor(Math.random() * 99999)).padStart(5, "0")}`;

    await db.execute(sql`
      UPDATE ocean_freight_orders SET
        booking_number = ${b.booking_number ?? bookingNumber},
        carrier = ${b.carrier ?? null},
        vessel_name = ${b.vessel_name ?? null},
        voyage = ${b.voyage ?? null},
        etd = ${b.etd ?? null},
        eta = ${b.eta ?? null},
        pol = ${b.pol ?? null},
        pod = ${b.pod ?? null},
        container_number = ${b.container_number ?? null},
        seal_number = ${b.seal_number ?? null},
        bl_number = ${b.bl_number ?? null},
        booking_confirmation_url = ${b.booking_confirmation_url ?? null},
        tracking_status = 'booked',
        status = 'booked',
        booking_confirmed_at = NOW(),
        updated_at = NOW()
      WHERE id = ${orderId}
    `);

    return res.json({ ok: true, booking_number: b.booking_number ?? bookingNumber });
  } catch (e) {
    console.error("[ocean-freight/confirm-booking]", e);
    return res.status(500).json({ error: "Gagal konfirmasi booking" });
  }
});

// ── PATCH /api/ocean-freight/:id/tracking ─────────────────────────────────────
router.patch("/:id/tracking", requireAdminMiddleware, async (req: Request, res: Response) => {
  try {
    const orderId = Number(String(req.params.id));
    const trackingStatus = String(req.body?.tracking_status ?? "");
    const orderStatus    = String(req.body?.status ?? "");
    const validTracking  = ["booked","container_empty_released","stuffed","gate_in","sailed","transshipment","arrived","customs_clearance","delivered","completed"];
    if (!validTracking.includes(trackingStatus)) return res.status(400).json({ error: "tracking_status tidak valid" });

    const existingTr = await db.execute(sql`SELECT company_id FROM ocean_freight_orders WHERE id = ${orderId} LIMIT 1`);
    if (!existingTr.rows.length) return res.status(404).json({ error: "Order tidak ditemukan" });
    const cidTr = resolveCompanyId(req);
    if (!await assertCompanyAccess((existingTr.rows[0] as any).company_id, cidTr, req, res, { resourceType: "ocean_freight_order", resourceId: orderId })) return;

    await db.execute(sql`
      UPDATE ocean_freight_orders SET
        tracking_status = ${trackingStatus},
        status = ${orderStatus || trackingStatus},
        updated_at = NOW()
      WHERE id = ${orderId}
    `);
    return res.json({ ok: true });
  } catch (e) {
    return res.status(500).json({ error: "Gagal update tracking" });
  }
});

// ── POST /api/ocean-freight — admin create order ──────────────────────────────
router.post("/", async (req: Request, res: Response) => {
  if (!(await requireAdmin(req, res))) return;
  try {
    const b = req.body ?? {};
    if (!b.customer_name) return res.status(400).json({ error: "customer_name wajib" });
    const orderNumber = `OFR/${new Date().getFullYear()}/${String(Math.floor(Math.random() * 999999)).padStart(6, "0")}`;
    const quoteToken  = randomBytes(24).toString("hex");

    const { rows } = await db.execute(sql`
      INSERT INTO ocean_freight_orders (
        order_number, customer_name, customer_phone, customer_email, customer_company,
        origin_city, origin_port, destination_city, destination_port,
        trade_type, service_mode, shipment_type, container_type, container_qty,
        total_cbm, gross_weight, koli, commodity, hs_code, cargo_condition,
        incoterm, etd_preferred, eta_target, selected_additional_services,
        admin_notes, status, source, price_status, quote_token, created_at, updated_at
      ) VALUES (
        ${orderNumber}, ${b.customer_name}, ${b.customer_phone ?? null}, ${b.customer_email ?? null}, ${b.customer_company ?? null},
        ${b.origin_city ?? ""}, ${b.origin_port ?? ""}, ${b.destination_city ?? ""}, ${b.destination_port ?? ""},
        ${b.trade_type ?? "export"}, ${b.service_mode ?? "port_to_port"}, ${b.shipment_type ?? "FCL"},
        ${b.container_type ?? null}, ${b.container_qty ? Number(b.container_qty) : null},
        ${b.total_cbm ? Number(b.total_cbm) : null}, ${b.gross_weight ? Number(b.gross_weight) : null},
        ${b.koli ? Number(b.koli) : null},
        ${b.commodity ?? "General Cargo"}, ${b.hs_code ?? null}, ${b.cargo_condition ?? "general"},
        ${b.incoterm ?? null}, ${b.etd_preferred ?? null}, ${b.eta_target ?? null},
        ${JSON.stringify(b.selected_additional_services ?? [])}::jsonb,
        ${b.admin_notes ?? null},
        ${b.status ?? "waiting_rate"}, 'admin_portal', 'estimate', ${quoteToken}, NOW(), NOW()
      ) RETURNING *
    `);
    return res.status(201).json(rows[0]);
  } catch (e) {
    console.error("[ocean-freight/admin-create]", e);
    return res.status(500).json({ error: "Gagal buat order" });
  }
});

// ── PATCH /api/ocean-freight/:id ─────────────────────────────────────────────
router.patch("/:id", requireAdminMiddleware, async (req: Request, res: Response) => {
  try {
    const id = Number(String(req.params.id));
    const b  = req.body ?? {};
    const existingOcnPatch = await db.execute(sql`SELECT company_id FROM ocean_freight_orders WHERE id = ${id} LIMIT 1`);
    if (!existingOcnPatch.rows.length) return res.status(404).json({ error: "Order tidak ditemukan" });
    const cid = resolveCompanyId(req);
    if (!await assertCompanyAccess((existingOcnPatch.rows[0] as any).company_id, cid, req, res, { resourceType: "ocean_freight_order", resourceId: id })) return;
    await db.execute(sql`
      UPDATE ocean_freight_orders SET
        customer_name = COALESCE(${b.customer_name ?? null}, customer_name),
        customer_phone = COALESCE(${b.customer_phone ?? null}, customer_phone),
        customer_email = COALESCE(${b.customer_email ?? null}, customer_email),
        admin_notes = ${b.admin_notes ?? null},
        updated_at = NOW()
      WHERE id = ${id}
    `);
    return res.json({ ok: true });
  } catch (e) {
    return res.status(500).json({ error: "Gagal update order" });
  }
});

// Gabungkan legacy oceanFreightRouter ke router utama
router.use(oceanFreightRouter);

export default router;
