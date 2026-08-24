import { Router, type Request, type Response } from "express";
import { db, quotationReplyLogsTable, waIncomingMessagesTable } from "@workspace/db";
import { notificationLogsTable } from "@workspace/db/schema";
import { desc, eq, and, gte, lte, sql } from "drizzle-orm";
import { sendViaService as sendWhatsApp } from "../lib/waTransport.js";
import { getAdminWa } from "../lib/adminWa.js";
import { logger } from "../lib/logger.js";
import { normalizePhone } from "../lib/phoneUtils.js";
import { getWaTemplateConfig, renderTemplate } from "../lib/orderNotification.js";
import { requireAdmin } from "../lib/requireAdmin.js";

export const whatsappRouter = Router();

const _webhookRateMap = new Map<string, { count: number; resetAt: number }>();
const WEBHOOK_WINDOW_MS = 60_000;
const WEBHOOK_MAX = 60;

function checkWebhookRate(ip: string): boolean {
  const now = Date.now();
  const entry = _webhookRateMap.get(ip);
  if (!entry || now > entry.resetAt) {
    _webhookRateMap.set(ip, { count: 1, resetAt: now + WEBHOOK_WINDOW_MS });
    return true;
  }
  entry.count += 1;
  return entry.count <= WEBHOOK_MAX;
}

const FONNTE_TOKEN = process.env.FONNTE_TOKEN ?? "";
const FONNTE_URL   = "https://api.fonnte.com/send";

// RC2.1 — Webhook shared secret (Blocker 2).
// Set FONNTE_WEBHOOK_SECRET to the same value configured in Fonnte's webhook
// URL (e.g. https://your-domain/api/whatsapp/webhook?token=<SECRET>).
// If not set → allow (backward-compatible dev mode), but log a warning on first
// call so ops knows the endpoint is running without verification.
const FONNTE_WEBHOOK_SECRET = process.env.FONNTE_WEBHOOK_SECRET ?? "";
let _webhookSecretWarningLogged = false;

/**
 * Verify Fonnte webhook shared secret.
 * Accepts the token via:
 *   1. Authorization header: "Bearer <secret>"
 *   2. X-Webhook-Token header
 *   3. ?token= query parameter (Fonnte native)
 * Returns true if verification passes (or if no secret is configured).
 */
function verifyFonnteWebhookSecret(req: Request): boolean {
  if (!FONNTE_WEBHOOK_SECRET) {
    if (!_webhookSecretWarningLogged) {
      _webhookSecretWarningLogged = true;
      // Use process.stderr so it shows in logs without needing logger import at module scope
      logger.warn("FONNTE_WEBHOOK_SECRET not set — Fonnte webhook running without signature verification");
    }
    return true; // backward-compatible: allow if unconfigured
  }
  const authHeader = req.headers["authorization"];
  if (authHeader && authHeader === `Bearer ${FONNTE_WEBHOOK_SECRET}`) return true;
  const tokenHeader = req.headers["x-webhook-token"];
  if (tokenHeader && tokenHeader === FONNTE_WEBHOOK_SECRET) return true;
  const tokenQuery = req.query["token"];
  if (tokenQuery && tokenQuery === FONNTE_WEBHOOK_SECRET) return true;
  return false;
}

function extractMessageId(body: Record<string, unknown>): string | undefined {
  const raw = body.id ?? body.message_id ?? body.messageId;
  if (!raw) return undefined;
  if (Array.isArray(raw)) return raw[0] ? String(raw[0]) : undefined;
  return String(raw);
}

const DEFAULT_MANUAL_QUOTE_TPL =
  `Halo {{customerName}},\n\n` +
  `Berikut quotation layanan B2B Marketplace and Logistic:\n\n` +
  `No. RFQ       : {{rfqId}}\n` +
  `Layanan       : {{serviceType}}\n` +
  `Rute          : {{route}}\n` +
  `Estimasi Pickup   : {{pickupDate}}\n` +
  `Estimasi Delivery : {{deliveryDate}}\n` +
  `Harga Final   : {{finalPrice}}\n` +
  `Status        : {{status}}\n` +
  `\nCatatan:\n{{notes}}\n` +
  `\nSilakan konfirmasi apabila quotation ini disetujui.\n\n` +
  `Terima kasih,\nB2B Marketplace and Logistic`;

const fmt = (n: number) => `Rp ${Math.round(n).toLocaleString("id-ID")}`;

const DEFAULT_QUOTATION_CUSTOMER_TPL = [
  "Halo {{customerName}},",
  "",
  "Berikut quotation layanan B2B Marketplace and Logistic:",
  "",
  "No. RFQ       : {{rfqId}}",
  "Layanan       : {{serviceType}}",
  "Rute          : {{route}}",
  "Estimasi Pickup   : {{pickupDate}}",
  "Estimasi Delivery : {{deliveryDate}}",
  "Harga Final   : {{finalPrice}}",
  "Status        : {{status}}",
  "Catatan       : {{notes}}",
  "",
  "Silakan konfirmasi apabila quotation ini disetujui.",
  "",
  "Terima kasih,",
  "B2B Marketplace and Logistic",
].join("\n");

const DEFAULT_QUOTATION_ADMIN_TPL = [
  "📋 *QUOTATION DIKIRIM KE CUSTOMER*",
  "━━━━━━━━━━━━━━━━━━",
  "Customer   : {{customerName}}",
  "No. HP     : {{customerPhone}}",
  "No. RFQ    : {{rfqId}}",
  "Layanan    : {{serviceType}}",
  "Rute       : {{route}}",
  "Vendor     : {{vendorName}}",
  "Harga Final: {{finalPrice}}",
  "Status     : {{status}}",
  "━━━━━━━━━━━━━━━━━━",
  "_Dikirim via Mini Form BizPortal_",
].join("\n");

const WA_DELIVERY_RANK: Record<string, number> = { sent: 1, delivered: 2, read: 3 };

// POST /api/whatsapp/send-quotation
whatsappRouter.post("/send-quotation", async (req: Request, res: Response) => {
  if (!(await requireAdmin(req, res))) return;
  const {
    rfqId, orderId, customerName, customerPhone, vendorName, vendorPhone,
    serviceType, route, vendorPrice, finalPrice, markupType, markupValue,
    pickupDate, deliveryDate, notes, status, sendToAdminGroup, isDraft,
  } = req.body as Record<string, unknown>;

  if (!customerName || !customerPhone) {
    return res.status(400).json({ message: "customerName dan customerPhone wajib diisi" });
  }

  const fp = finalPrice != null ? Number(finalPrice) : (vendorPrice != null ? Number(vendorPrice) : 0);
  if (isNaN(fp) || fp < 0) {
    return res.status(400).json({ message: "finalPrice tidak valid" });
  }

  const vars: Record<string, string | null> = {
    customerName: String(customerName),
    rfqId: rfqId ? String(rfqId) : "-",
    serviceType: serviceType ? String(serviceType) : "-",
    route: route ? String(route) : "-",
    pickupDate: pickupDate ? String(pickupDate) : "-",
    deliveryDate: deliveryDate ? String(deliveryDate) : "-",
    finalPrice: fmt(fp),
    status: status ? String(status) : "Ready",
    notes: notes ? String(notes) : "-",
    customerPhone: normalizePhone(String(customerPhone)),
    vendorName: vendorName ? String(vendorName) : "-",
  };

  const [customerTplBody, adminTplBody] = await Promise.all([
    getWaTemplateConfig("customer", "quotation_send", DEFAULT_QUOTATION_CUSTOMER_TPL),
    getWaTemplateConfig("admin_group", "quotation_send", DEFAULT_QUOTATION_ADMIN_TPL),
  ]);

  const messageBody = renderTemplate(customerTplBody, vars);

  const normalizedPhone = normalizePhone(String(customerPhone));
  let sentStatus = "draft";
  let sentAt: Date | null = null;
  let sentToAdmin = false;

  if (!isDraft) {
    try {
      await sendWhatsApp(normalizedPhone, messageBody, {
        context: "quotation-send",
        refType: "quotation",
        refId: rfqId ? String(rfqId) : String(orderId ?? ""),
      });
      sentStatus = "sent";
      sentAt = new Date();
      logger.info({ phone: normalizedPhone, status: sentStatus }, "Quotation WA sent to customer");
    } catch (err) {
      logger.error({ err, phone: normalizedPhone }, "Failed to send quotation WA");
      sentStatus = "failed";
    }

    if (sendToAdminGroup) {
      try {
        const adminWa = await getAdminWa();
        if (adminWa) {
          const adminMsg = renderTemplate(adminTplBody, vars);
          await sendWhatsApp(adminWa, adminMsg);
          sentToAdmin = true;
        }
      } catch (err) {
        logger.error({ err }, "Failed to send quotation notif to admin group");
      }
    }
  }

  const [log] = await db.insert(quotationReplyLogsTable).values({
    rfqId: rfqId ? String(rfqId) : null,
    orderId: orderId ? Number(orderId) : null,
    customerName: String(customerName),
    customerPhone: normalizedPhone,
    vendorName: vendorName ? String(vendorName) : null,
    vendorPhone: vendorPhone ? String(vendorPhone) : null,
    serviceType: serviceType ? String(serviceType) : null,
    route: route ? String(route) : null,
    vendorPrice: vendorPrice != null ? String(Number(vendorPrice)) : null,
    markupType: String(markupType ?? "percentage"),
    markupValue: String(Number(markupValue ?? 0)),
    finalPrice: String(fp),
    pickupDate: pickupDate ? String(pickupDate) : null,
    deliveryDate: deliveryDate ? String(deliveryDate) : null,
    notes: notes ? String(notes) : null,
    status: String(status ?? "Ready"),
    messageBody,
    fonnteResponse: null,
    sentStatus,
    sentToAdmin,
    sentAt: sentAt ?? undefined,
  }).returning();

  return res.status(201).json({
    id: log.id,
    sentStatus,
    sentToAdmin,
    messageBody,
    sentAt: sentAt?.toISOString() ?? null,
  });
});

// GET /api/whatsapp/quotation-logs
whatsappRouter.get("/quotation-logs", async (req: Request, res: Response) => {
  if (!(await requireAdmin(req, res))) return;
  const logs = await db
    .select()
    .from(quotationReplyLogsTable)
    .orderBy(desc(quotationReplyLogsTable.createdAt))
    .limit(100);

  return res.json(
    logs.map((l) => ({
      id: l.id,
      rfqId: l.rfqId,
      orderId: l.orderId,
      customerName: l.customerName,
      customerPhone: l.customerPhone,
      vendorName: l.vendorName,
      serviceType: l.serviceType,
      route: l.route,
      vendorPrice: l.vendorPrice ? Number(l.vendorPrice) : null,
      finalPrice: l.finalPrice ? Number(l.finalPrice) : null,
      status: l.status,
      sentStatus: l.sentStatus,
      sentToAdmin: l.sentToAdmin,
      sentAt: l.sentAt?.toISOString() ?? null,
      createdAt: l.createdAt.toISOString(),
    })),
  );
});

// POST /api/whatsapp/webhook — pesan masuk DAN delivery report dari Fonnte
whatsappRouter.post("/webhook", async (req: Request, res: Response) => {
  const clientIp = String(req.headers["x-forwarded-for"] ?? req.socket.remoteAddress ?? "unknown").split(",")[0].trim();
  if (!checkWebhookRate(clientIp)) {
    return res.status(429).json({ ok: false, error: "Too many requests" });
  }
  // RC2.1 Blocker 2 — shared secret verification
  if (!verifyFonnteWebhookSecret(req)) {
    logger.warn({ clientIp }, "Fonnte webhook rejected — invalid secret");
    return res.status(401).json({ ok: false, error: "Unauthorized" });
  }
  try {
    const body = req.body as Record<string, unknown>;

    // ── Delivery report dari Fonnte ─────────────────────────────────────
    // Fonnte mengirim callback delivery jika ada field `id` + `status`
    // dan tidak ada field `sender`/`message` (atau message kosong).
    const deliveryId = body.id ? String(body.id) : null;
    const deliveryStatus = body.status ? String(body.status) : null;
    const hasSender = !!(body.sender ?? body.from);
    const hasMessage = !!(body.message ?? body.text ?? body.body);

    if (deliveryId && deliveryStatus && !hasSender && !hasMessage) {
      // Ini adalah delivery report — update notification_logs
      const normalizedStatus = deliveryStatus.toLowerCase();
      if (["sent", "delivered", "read"].includes(normalizedStatus)) {
        const now = new Date();
        const updated = await db
          .update(notificationLogsTable)
          .set({
            waDeliveryStatus: normalizedStatus,
            ...(normalizedStatus === "delivered" ? { deliveredAt: now } : {}),
            ...(normalizedStatus === "read"      ? { readAt: now }      : {}),
          })
          .where(and(
            eq(notificationLogsTable.waMessageId, deliveryId),
            sql`COALESCE(
              CASE ${notificationLogsTable.waDeliveryStatus}
                WHEN 'sent' THEN 1
                WHEN 'delivered' THEN 2
                WHEN 'read' THEN 3
                ELSE 0
              END,
              0
            ) <= ${WA_DELIVERY_RANK[normalizedStatus]}`,
          ))
          .returning({ id: notificationLogsTable.id });

        logger.info({ deliveryId, normalizedStatus, updated: updated.length }, "WA delivery status updated");
      }
      return res.status(200).json({ ok: true });
    }

    // ── Pesan masuk biasa ────────────────────────────────────────────────
    const sender = String(body.sender ?? body.from ?? "");
    const message = String(body.message ?? body.text ?? body.body ?? "");
    const senderName = body.name ? String(body.name) : null;
    const deviceId = body.device ? String(body.device) : null;
    const messageType = body.type ? String(body.type) : "text";

    if (!sender || !message) {
      return res.status(200).json({ ok: true, skipped: true });
    }

    await db.insert(waIncomingMessagesTable).values({
      sender: normalizePhone(sender),
      senderName,
      message,
      deviceId,
      messageType,
      rawPayload: body,
    });

    logger.info({ sender, senderName }, "WA incoming message saved from webhook");
    return res.status(200).json({ ok: true });
  } catch (err) {
    logger.error({ err }, "Error processing WA webhook");
    return res.status(200).json({ ok: true });
  }
});

// POST /api/whatsapp/notification-logs/:id/retry — kirim ulang manual segera
whatsappRouter.post("/notification-logs/:id/retry", async (req: Request, res: Response) => {
  if (!(await requireAdmin(req, res))) return;
  const id = parseInt(String(req.params.id ?? ""), 10);
  if (isNaN(id)) return res.status(400).json({ message: "ID tidak valid" });

  const [row] = await db
    .select()
    .from(notificationLogsTable)
    .where(and(eq(notificationLogsTable.id, id), eq(notificationLogsTable.channel, "wa")))
    .limit(1);

  if (!row) return res.status(404).json({ message: "Log tidak ditemukan" });
  if (row.status !== "failed") return res.status(400).json({ message: "Hanya log berstatus 'failed' yang bisa di-retry" });
  if ((row.retryCount ?? 0) >= 3) return res.status(400).json({ message: "Sudah mencapai batas maksimum retry (3x)" });

  if (!FONNTE_TOKEN) return res.status(500).json({ message: "FONNTE_TOKEN tidak dikonfigurasi" });

  try {
    const params: Record<string, string> = { target: row.recipient, message: row.message };
    if (row.mediaUrl?.trim()) params.url = row.mediaUrl.trim();

    const fRes = await fetch(FONNTE_URL, {
      method: "POST",
      headers: { Authorization: FONNTE_TOKEN, "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams(params).toString(),
    });
    const fBody = await fRes.json() as Record<string, unknown>;
    const ok = fRes.ok && fBody.status !== false && fBody.status !== "false";
    const waMessageId = ok ? extractMessageId(fBody) : undefined;
    const newRetryCount = (row.retryCount ?? 0) + 1;

    if (ok) {
      await db.update(notificationLogsTable).set({
        status: "sent",
        retryCount: newRetryCount,
        nextRetryAt: null,
        errorMsg: null,
        waMessageId: waMessageId ?? null,
        waDeliveryStatus: waMessageId ? "sent" : null,
      }).where(eq(notificationLogsTable.id, id));

      logger.info({ id, waMessageId }, "WA manual retry sukses");
      return res.json({ ok: true, waMessageId });
    } else {
      const errMsg = String(fBody.reason ?? fBody.message ?? `HTTP ${fRes.status}`);
      const backoffMs = 5 * 60 * 1000 * Math.pow(2, newRetryCount - 1);
      const nextRetry = newRetryCount < 3 ? new Date(Date.now() + backoffMs) : null;

      await db.update(notificationLogsTable).set({
        retryCount: newRetryCount,
        nextRetryAt: nextRetry,
        errorMsg: `[retry ${newRetryCount}] ${errMsg}`,
      }).where(eq(notificationLogsTable.id, id));

      logger.warn({ id, errMsg }, "WA manual retry gagal");
      return res.status(502).json({ ok: false, message: errMsg });
    }
  } catch (err) {
    logger.error({ err, id }, "WA manual retry exception");
    return res.status(500).json({ message: String(err) });
  }
});

// GET /api/whatsapp/inbox
whatsappRouter.get("/inbox", async (req: Request, res: Response) => {
  if (!(await requireAdmin(req, res))) return;
  const unreadOnly = req.query.unread === "true";

  if (unreadOnly) {
    const rows = await db
      .select()
      .from(waIncomingMessagesTable)
      .where(eq(waIncomingMessagesTable.isRead, false))
      .orderBy(desc(waIncomingMessagesTable.receivedAt))
      .limit(100);
    return res.json(rows.map(mapIncoming));
  }

  const rows = await db
    .select()
    .from(waIncomingMessagesTable)
    .orderBy(desc(waIncomingMessagesTable.receivedAt))
    .limit(100);
  return res.json(rows.map(mapIncoming));
});

function mapIncoming(r: typeof waIncomingMessagesTable.$inferSelect) {
  return {
    id: r.id,
    sender: r.sender,
    senderName: r.senderName,
    message: r.message,
    messageType: r.messageType,
    isRead: r.isRead,
    repliedAt: r.repliedAt?.toISOString() ?? null,
    replyMessage: r.replyMessage,
    receivedAt: r.receivedAt.toISOString(),
    createdAt: r.createdAt.toISOString(),
  };
}

// PATCH /api/whatsapp/inbox/:id/read
whatsappRouter.patch("/inbox/:id/read", async (req: Request, res: Response) => {
  if (!(await requireAdmin(req, res))) return;
  const id = parseInt(req.params["id"] as string);
  if (isNaN(id)) return res.status(400).json({ message: "ID tidak valid" });

  await db
    .update(waIncomingMessagesTable)
    .set({ isRead: true })
    .where(eq(waIncomingMessagesTable.id, id));

  return res.json({ ok: true });
});

// POST /api/whatsapp/inbox/:id/reply
whatsappRouter.post("/inbox/:id/reply", async (req: Request, res: Response) => {
  if (!(await requireAdmin(req, res))) return;
  const id = parseInt(req.params["id"] as string);
  if (isNaN(id)) return res.status(400).json({ message: "ID tidak valid" });

  const { message } = req.body as { message?: string };
  if (!message?.trim()) return res.status(400).json({ message: "Pesan balasan wajib diisi" });

  const [row] = await db
    .select()
    .from(waIncomingMessagesTable)
    .where(eq(waIncomingMessagesTable.id, id))
    .limit(1);

  if (!row) return res.status(404).json({ message: "Pesan tidak ditemukan" });

  let sentStatus = "failed";
  try {
    await sendWhatsApp(row.sender, message.trim(), {
      context: "inbox-reply",
      refType: "wa_inbox",
      refId: String(id),
    });
    sentStatus = "sent";
    logger.info({ sender: row.sender, sentStatus }, "WA inbox reply sent");
  } catch (err) {
    logger.error({ err }, "Failed to send WA inbox reply");
  }

  await db
    .update(waIncomingMessagesTable)
    .set({ isRead: true, repliedAt: new Date(), replyMessage: message.trim() })
    .where(eq(waIncomingMessagesTable.id, id));

  return res.json({ ok: true, sentStatus });
});

// GET /api/whatsapp/notification-logs/stats
whatsappRouter.get("/notification-logs/stats", async (req: Request, res: Response) => {
  if (!(await requireAdmin(req, res))) return;
  try {
    const todayStart = new Date();
    todayStart.setHours(0, 0, 0, 0);

    const [allTime, today, deliveryStats] = await Promise.all([
      db.select({
        channel: notificationLogsTable.channel,
        status:  notificationLogsTable.status,
        count:   sql<number>`COUNT(*)::int`,
      })
      .from(notificationLogsTable)
      .groupBy(notificationLogsTable.channel, notificationLogsTable.status),

      db.select({
        channel: notificationLogsTable.channel,
        status:  notificationLogsTable.status,
        count:   sql<number>`COUNT(*)::int`,
      })
      .from(notificationLogsTable)
      .where(gte(notificationLogsTable.createdAt, todayStart))
      .groupBy(notificationLogsTable.channel, notificationLogsTable.status),

      db.select({
        waDeliveryStatus: notificationLogsTable.waDeliveryStatus,
        count: sql<number>`COUNT(*)::int`,
      })
      .from(notificationLogsTable)
      .where(eq(notificationLogsTable.channel, "wa"))
      .groupBy(notificationLogsTable.waDeliveryStatus),
    ]);

    function agg(rows: { channel: string; status: string; count: number }[]) {
      const r = { waSent: 0, waFailed: 0, waDeduped: 0, emailSent: 0, emailFailed: 0 };
      for (const row of rows) {
        if (row.channel === "wa"    && row.status === "sent")    r.waSent    += row.count;
        if (row.channel === "wa"    && row.status === "failed")  r.waFailed  += row.count;
        if (row.channel === "wa"    && row.status === "deduped") r.waDeduped += row.count;
        if (row.channel === "email" && row.status === "sent")    r.emailSent    += row.count;
        if (row.channel === "email" && row.status === "failed")  r.emailFailed  += row.count;
      }
      return r;
    }

    const delivery = { delivered: 0, read: 0, pending: 0 };
    for (const row of deliveryStats) {
      if (row.waDeliveryStatus === "delivered") delivery.delivered += row.count;
      else if (row.waDeliveryStatus === "read") delivery.read      += row.count;
      else if (row.waDeliveryStatus === "sent") delivery.pending   += row.count;
    }

    return res.json({ allTime: agg(allTime), today: agg(today), delivery });
  } catch {
    return res.status(500).json({ error: "Gagal memuat stats" });
  }
});

// GET /api/whatsapp/notification-logs
whatsappRouter.get("/notification-logs", async (req: Request, res: Response) => {
  if (!(await requireAdmin(req, res))) return;
  const channel  = String(req.query.channel ?? "").trim() || null;
  const status   = String(req.query.status  ?? "").trim() || null;
  const context  = String(req.query.context ?? "").trim() || null;
  const refId    = String(req.query.refId   ?? "").trim() || null;
  const delivSt  = String(req.query.deliveryStatus ?? "").trim() || null;
  const from     = req.query.from ? new Date(String(req.query.from)) : null;
  const to       = req.query.to   ? new Date(String(req.query.to))   : null;
  const limit    = Math.min(parseInt(String(req.query.limit  ?? "50"),  10), 200);
  const offset   = Math.max(parseInt(String(req.query.offset ?? "0"),   10), 0);

  const conditions: ReturnType<typeof eq>[] = [];
  if (channel && (channel === "wa" || channel === "email"))
    conditions.push(eq(notificationLogsTable.channel, channel));
  if (status)
    conditions.push(eq(notificationLogsTable.status, status));
  if (context)
    conditions.push(eq(notificationLogsTable.context, context));
  if (refId)
    conditions.push(eq(notificationLogsTable.refId, refId));
  if (delivSt)
    conditions.push(eq(notificationLogsTable.waDeliveryStatus, delivSt));
  if (from && !isNaN(from.getTime()))
    conditions.push(gte(notificationLogsTable.createdAt, from));
  if (to && !isNaN(to.getTime()))
    conditions.push(lte(notificationLogsTable.createdAt, to));

  const [rows, [{ total }]] = await Promise.all([
    db
      .select({
        id:               notificationLogsTable.id,
        channel:          notificationLogsTable.channel,
        recipient:        notificationLogsTable.recipient,
        subject:          notificationLogsTable.subject,
        status:           notificationLogsTable.status,
        context:          notificationLogsTable.context,
        refType:          notificationLogsTable.refType,
        refId:            notificationLogsTable.refId,
        errorMsg:         notificationLogsTable.errorMsg,
        retryCount:       notificationLogsTable.retryCount,
        nextRetryAt:      notificationLogsTable.nextRetryAt,
        waMessageId:      notificationLogsTable.waMessageId,
        waDeliveryStatus: notificationLogsTable.waDeliveryStatus,
        deliveredAt:      notificationLogsTable.deliveredAt,
        readAt:           notificationLogsTable.readAt,
        createdAt:        notificationLogsTable.createdAt,
      })
      .from(notificationLogsTable)
      .where(conditions.length ? and(...(conditions as [ReturnType<typeof eq>, ...ReturnType<typeof eq>[]])) : undefined)
      .orderBy(desc(notificationLogsTable.createdAt))
      .limit(limit)
      .offset(offset),
    db
      .select({ total: sql<number>`COUNT(*)::int` })
      .from(notificationLogsTable)
      .where(conditions.length ? and(...(conditions as [ReturnType<typeof eq>, ...ReturnType<typeof eq>[]])) : undefined),
  ]);

  return res.json({
    total, limit, offset,
    rows: rows.map((r) => ({
      ...r,
      nextRetryAt:  r.nextRetryAt?.toISOString()  ?? null,
      deliveredAt:  r.deliveredAt?.toISOString()  ?? null,
      readAt:       r.readAt?.toISOString()        ?? null,
      createdAt:    r.createdAt.toISOString(),
    })),
  });
});

// GET /api/whatsapp/notification-logs/:id
whatsappRouter.get("/notification-logs/:id", async (req: Request, res: Response) => {
  if (!(await requireAdmin(req, res))) return;
  const id = parseInt(String(req.params.id ?? ""), 10);
  if (isNaN(id)) return res.status(400).json({ message: "ID tidak valid" });

  const [row] = await db
    .select()
    .from(notificationLogsTable)
    .where(eq(notificationLogsTable.id, id))
    .limit(1);

  if (!row) return res.status(404).json({ message: "Log tidak ditemukan" });
  return res.json({
    ...row,
    nextRetryAt:  row.nextRetryAt?.toISOString()  ?? null,
    deliveredAt:  row.deliveredAt?.toISOString()  ?? null,
    readAt:       row.readAt?.toISOString()        ?? null,
    createdAt:    row.createdAt.toISOString(),
  });
});
