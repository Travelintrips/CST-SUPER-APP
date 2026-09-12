import { Router, type Request, type Response } from "express";
import { db, suppliersTable, logisticOrderRfqsTable, logisticOrderQuotesTable, logisticOrdersTable } from "@workspace/db";
import { eq, sql, and, desc } from "drizzle-orm";
import { sendViaService as sendWhatsApp } from "../lib/waTransport.js";
import { getAdminWa, getAdminPhones } from "../lib/adminWa.js";
import { logger } from "../lib/logger.js";
import { processWaForAiIntake, processWaMediaForAiIntake, buildAiReplyWa, getAiIntakeSettings } from "../lib/aiOrderIntake.js";
import { getPreferredDomain } from "../lib/domain.js";
import { normalizePhone } from "../lib/phoneUtils.js";
import { transitionLogisticOrderStatus } from "../lib/services/logisticOrderStatusService.js";

const router = Router();

// [H3-FIX] SSRF guard: only allow media URLs from Fonnte/WhatsApp CDN domains.
// Rejects private IP ranges, localhost, and any non-allowlisted hostname.
const ALLOWED_MEDIA_DOMAINS = [
  "fonnte.com",
  "whatsapp.net",
  "cdn-whatsapp.net",
  "mmg.whatsapp.net",
  "whatsapp.com",
  "wa.me",
];
const PRIVATE_HOST_RE = [
  /^localhost$/i,
  /^127\./,
  /^10\./,
  /^172\.(1[6-9]|2\d|3[01])\./,
  /^192\.168\./,
  /^169\.254\./,
  /^0\./,
  /^::1$/,
  /^fc00:/i,
  /^fe80:/i,
  /metadata\.google\.internal/i,
];
function isAllowedMediaUrl(rawUrl: string): boolean {
  let u: URL;
  try { u = new URL(rawUrl); } catch { return false; }
  if (u.protocol !== "https:" && u.protocol !== "http:") return false;
  const host = u.hostname.toLowerCase();
  if (PRIVATE_HOST_RE.some((re) => re.test(host))) return false;
  return ALLOWED_MEDIA_DOMAINS.some((d) => host === d || host.endsWith(`.${d}`));
}

// ── In-memory dedup cache: prevent processing the same Fonnte webhook twice ──
// Key = sender + "|" + message (first 100 chars) + "|" + mediaUrl
// Entries expire after DEDUP_TTL_MS (2 minutes)
const DEDUP_TTL_MS = 2 * 60 * 1000;
const dedupCache = new Map<string, number>();
function isDuplicate(key: string): boolean {
  const now = Date.now();
  // Evict expired entries
  for (const [k, ts] of dedupCache) {
    if (now - ts > DEDUP_TTL_MS) dedupCache.delete(k);
  }
  if (dedupCache.has(key)) return true;
  dedupCache.set(key, now);
  return false;
}

function calcSellingPrice(vendorPrice: number, markupType: string, markupPct: number, fixedPrice: number | null): number {
  if (markupType === "fixed_price" && fixedPrice != null) return fixedPrice;
  return vendorPrice + (vendorPrice * markupPct / 100);
}

function fmt(n: number): string {
  return `Rp ${Math.round(n).toLocaleString("id-ID")}`;
}

function getOrderUrl(orderId: number): string {
  const domain = getPreferredDomain();
  if (!domain) return "";
  return `https://${domain}/bizportal/logistics/portal-orders/${orderId}`;
}

function parsePrice(raw: string): number {
  const s = raw.replace(/[\[\]]/g, "").trim();
  const dotParts = s.split(".");
  const commaParts = s.split(",");
  let normalized = s;
  if (dotParts.length > 2) {
    normalized = s.replace(/\./g, "");
  } else if (commaParts.length > 2) {
    normalized = s.replace(/,/g, "");
  } else if (dotParts.length === 2 && dotParts[1].length === 3) {
    normalized = s.replace(".", "");
  } else if (commaParts.length === 2 && commaParts[1].length === 3) {
    normalized = s.replace(",", "");
  } else {
    normalized = s.replace(",", ".");
  }
  return parseFloat(normalized);
}

function parseVendorReply(message: string): {
  rfqNumber: string | null; orderNumber: string | null; vendorPrice: number;
  estimatedPickup: string | null; estimatedDelivery: string | null; vendorNotes: string | null;
} | null {
  const cleaned = message.trim().replace(/\[|\]/g, " ").replace(/\s+/g, " ").trim();

  // Try to match RFQ number first (RFQ-YYMMDD-XXXXX)
  const rfqMatch = cleaned.match(/(?:#)?(RFQ-\d{6}-\d{5})/i);
  const rfqNumber = rfqMatch ? rfqMatch[1].toUpperCase() : null;

  // Try to match order number (LOG-YYMMDD-XXXXX) if no RFQ number
  const orderMatch = !rfqNumber ? cleaned.match(/(?:#)?(LOG-\d{6}-\d+)/i) : null;
  const orderNumber = orderMatch ? orderMatch[1].toUpperCase() : null;

  const prefix = rfqNumber ?? orderNumber;
  const afterPrefix = prefix
    ? cleaned.slice(cleaned.toUpperCase().indexOf(prefix) + prefix.length).trim()
    : cleaned;

  const priceMatch = afterPrefix.match(/^[\s,]*(\d[\d.,]*)/);
  if (!priceMatch) return null;

  const vendorPrice = parsePrice(priceMatch[1]);
  if (isNaN(vendorPrice) || vendorPrice <= 0) return null;

  const rest = afterPrefix.slice(priceMatch[0].length).trim();
  const parts = rest ? rest.split(/\s+/) : [];

  const estimatedPickup = parts.length > 0 ? parts[0] : null;
  const estimatedDelivery = parts.length > 1 ? parts[1] : null;
  const vendorNotes = parts.length > 2 ? parts.slice(2).join(" ") : null;

  return { rfqNumber, orderNumber, vendorPrice, estimatedPickup, estimatedDelivery, vendorNotes };
}

/**
 * Parse admin approve command.
 * Formats:
 *   APPROVE LOG-xxx                    ← list vendors who quoted (no action)
 *   APPROVE LOG-xxx 5500000            ← auto-pick best vendor, price override
 *   APPROVE LOG-xxx 2                  ← pick vendor #2, auto-calculate price
 *   APPROVE LOG-xxx 2 5500000          ← pick vendor #2, price override
 */
function parseAdminApprove(message: string): {
  orderNumber: string; quotePosition: number | null; sellingPrice: number | null;
} | null {
  const cleaned = message.trim();
  const match = cleaned.match(/^APPROVE\s+(LOG-\d{6}-\d+)(?:\s+([\d.,]+))?(?:\s+([\d.,]+))?/i);
  if (!match) return null;
  const orderNumber = match[1].toUpperCase();

  const arg1 = match[2] ? parsePrice(match[2]) : null;
  const arg2 = match[3] ? parsePrice(match[3]) : null;

  let quotePosition: number | null = null;
  let sellingPrice: number | null = null;

  if (arg1 !== null && !isNaN(arg1)) {
    if (Number.isInteger(arg1) && arg1 >= 1 && arg1 <= 50 && arg2 !== null) {
      // arg1 is a vendor position (1–50), arg2 is the price
      quotePosition = arg1;
      sellingPrice = !isNaN(arg2) && arg2 > 0 ? arg2 : null;
    } else if (Number.isInteger(arg1) && arg1 >= 1 && arg1 <= 50 && arg2 === null) {
      // arg1 is a vendor position, no price override
      quotePosition = arg1;
      sellingPrice = null;
    } else {
      // arg1 is the price directly
      sellingPrice = arg1 > 0 ? arg1 : null;
    }
  }

  return { orderNumber, quotePosition, sellingPrice };
}

/** Parse QUOTES command: QUOTES LOG-xxx */
function parseQuotesList(message: string): string | null {
  const match = message.trim().match(/^QUOTES\s+(LOG-\d{6}-\d+)/i);
  return match ? match[1].toUpperCase() : null;
}

/**
 * Parse vendor TERIMA / TOLAK response.
 * Accepts: "TERIMA", "TERIMA LOG-xxx", "1", "1 LOG-xxx"
 *          "TOLAK",  "TOLAK LOG-xxx",  "2", "2 LOG-xxx"
 */
function parseVendorTerimaTolaк(message: string): {
  action: "terima" | "tolak";
  orderNumber: string | null;
} | null {
  const cleaned = message.trim().toUpperCase();
  const terimaMatch = cleaned.match(/^(TERIMA|1)\s*(LOG-\d{6}-\d+)?$/);
  if (terimaMatch) {
    return { action: "terima", orderNumber: terimaMatch[2] ?? null };
  }
  const tolakMatch = cleaned.match(/^(TOLAK|2)\s*(LOG-\d{6}-\d+)?$/);
  if (tolakMatch) {
    return { action: "tolak", orderNumber: tolakMatch[2] ?? null };
  }
  return null;
}

/** Build a numbered vendor quote list string for admin messages */
function buildVendorQuoteList(
  quotes: { vendorName: string; vendorPrice: number; estimatedPickup?: string | null; estimatedDelivery?: string | null; quoteStatus: string }[],
  orderNumber: string,
): string {
  if (quotes.length === 0) return `_Belum ada vendor yang membalas._`;
  return quotes
    .map((q, i) => {
      const n = i + 1;
      const eta = [q.estimatedPickup, q.estimatedDelivery].filter(Boolean).join(" / ");
      return (
        `*${n}.* ${q.vendorName}\n` +
        `    Harga: ${fmt(q.vendorPrice)}${eta ? `  ETA: ${eta}` : ""}\n` +
        `    → \`APPROVE ${orderNumber} ${n} [harga_jual]\``
      );
    })
    .join("\n\n");
}

/**
 * Shared approve logic: find quote (by position or best), approve it, send WA to customer.
 */
async function doApproveOrder(
  orderId: number,
  overrideSellingPrice: number | null,
  quotePosition?: number | null,
): Promise<{
  orderNumber: string; vendorName: string; sellingPrice: number; customerPhone: string | null;
} | { error: string }> {
  const [order] = await db.select().from(logisticOrdersTable).where(eq(logisticOrdersTable.id, orderId));
  if (!order) return { error: "Order tidak ditemukan" };
  if (order.adminApprovalStatus === "approved") return { error: "Order sudah pernah di-approve" };

  // Guard: APPROVE via WA hanya diizinkan dari status pra-quotation.
  // Endpoint ini sudah diverifikasi: FONNTE_WEBHOOK_SECRET + isAdmin phone check.
  const VALID_PRE_APPROVE = ["Order Received", "Admin Review", "RFQ Sent", "Quote Received"];
  if (!VALID_PRE_APPROVE.includes(order.status ?? "")) {
    return { error: `Order ${order.orderNumber} tidak dapat di-approve dari status "${order.status}". Status harus salah satu dari: ${VALID_PRE_APPROVE.join(", ")}.` };
  }

  // Only use pending quotes from vendors who have actually replied
  const quotes = await db.select().from(logisticOrderQuotesTable)
    .where(and(eq(logisticOrderQuotesTable.orderId, orderId), eq(logisticOrderQuotesTable.quoteStatus, "pending")))
    .orderBy(logisticOrderQuotesTable.createdAt);
  if (quotes.length === 0) return { error: "Tidak ada quote dari vendor untuk order ini" };

  let best = quotes[0];
  if (quotePosition != null && quotePosition >= 1 && quotePosition <= quotes.length) {
    best = quotes[quotePosition - 1];
  } else if (!quotePosition) {
    // Auto-pick: lowest vendor price
    best = quotes.reduce((a, b) => Number(a.vendorPrice) <= Number(b.vendorPrice) ? a : b);
  }

  const sellingPrice = overrideSellingPrice != null
    ? overrideSellingPrice
    : best.sellingPrice != null
    ? Number(best.sellingPrice)
    : calcSellingPrice(Number(best.vendorPrice), best.markupType, Number(best.markupPercentage),
        best.fixedSellingPrice != null ? Number(best.fixedSellingPrice) : null);

  const now = new Date();
  await db.update(logisticOrderQuotesTable)
    .set({ quoteStatus: "approved" })
    .where(eq(logisticOrderQuotesTable.id, best.id));

  await db.update(logisticOrdersTable).set({
    approvedQuoteId: best.id,
    approvedVendorId: best.vendorId,
    adminApprovalStatus: "approved",
    approvedAt: now,
    finalSellingPrice: String(sellingPrice),
    quotationSentAt: now,
  }).where(eq(logisticOrdersTable.id, orderId));
  // force: true diperlukan karena admin WA bisa mengirim APPROVE dari berbagai status
  // pra-quotation (Order Received, Admin Review, RFQ Sent, Quote Received). State machine
  // mengizinkan transisi ke "Customer Approval" dari semua status tsb. Pre-state guard
  // di atas memastikan kita tidak menerobos status yang tidak valid.
  await transitionLogisticOrderStatus(orderId, "Customer Approval", { source: "webhooks:auto_approve", actorType: "system", force: true });

  const [vendor] = await db.select().from(suppliersTable).where(eq(suppliersTable.id, best.vendorId));
  const vendorName = vendor?.name ?? `Vendor #${best.vendorId}`;

  const customerMsg =
    `✅ *PENAWARAN HARGA ANDA TELAH SIAP*\n` +
    `━━━━━━━━━━━━━━━━━━\n` +
    `Halo *${order.customerName}*,\n\n` +
    `Kami telah memproses permintaan Anda dan menyiapkan penawaran terbaik.\n\n` +
    `No. Order   : \`${order.orderNumber}\`\n` +
    `Jenis       : ${order.shipmentType}\n` +
    `Rute        : ${order.origin} → ${order.destination}\n` +
    (order.commodity ? `Komoditi    : ${order.commodity}\n` : "") +
    (best.estimatedPickup ? `ETA Pickup  : ${best.estimatedPickup}\n` : "") +
    (best.estimatedDelivery ? `ETA Kirim   : ${best.estimatedDelivery}\n` : "") +
    `━━━━━━━━━━━━━━━━━━\n` +
    `💰 *Total Harga  : ${fmt(sellingPrice)}*\n` +
    `━━━━━━━━━━━━━━━━━━\n` +
    `Balas pesan ini atau hubungi kami untuk konfirmasi:\n` +
    `📞 Jakarta: (021) 6241234`;

  if (order.phone) {
    sendWhatsApp(order.phone, customerMsg).catch((e: unknown) =>
      logger.error({ e }, "WA customer quotation failed")
    );
  }

  logger.info({ orderId, quoteId: best.id, sellingPrice, vendorId: best.vendorId, quotePosition }, "Quote approved via WA command");

  return {
    orderNumber: order.orderNumber,
    vendorName,
    sellingPrice,
    customerPhone: order.phone ?? null,
  };
}

router.get("/webhook/fonnte", (_req: Request, res: Response) => {
  res.status(200).send("OK");
});

router.post("/webhook/fonnte", async (req: Request, res: Response) => {
  // ── Webhook origin verification ────────────────────────────────────────────
  // Set FONNTE_WEBHOOK_SECRET and configure Fonnte to append ?token=SECRET
  // (or send X-Fonnte-Token header) so only Fonnte can trigger this endpoint.
  const webhookSecret = process.env.FONNTE_WEBHOOK_SECRET;
  if (!webhookSecret) {
    // Fail closed: without a configured secret we cannot verify webhook origin.
    // Set FONNTE_WEBHOOK_SECRET and configure Fonnte to append ?token=SECRET.
    logger.error({ ip: req.ip }, "Fonnte webhook: FONNTE_WEBHOOK_SECRET not set — rejecting request. Configure this env var to enable webhook processing.");
    res.status(503).json({ status: false, error: "Webhook not configured" });
    return;
  }
  const provided =
    String(req.query["token"] ?? req.headers["x-fonnte-token"] ?? "").trim();
  if (provided !== webhookSecret) {
    logger.warn({ ip: req.ip }, "Fonnte webhook: invalid or missing token — rejected");
    res.status(401).json({ status: false, error: "Unauthorized" });
    return;
  }

  res.status(200).json({ status: true });

  try {
    const body = req.body as Record<string, unknown>;
    const sender = typeof body.sender === "string" ? body.sender : null;
    const message = typeof body.message === "string" ? body.message : "";
    const senderName = typeof body.sender_name === "string" ? body.sender_name : null;
    const member = typeof body.member === "string" ? body.member : null;
    // Fonnte sends media URL in 'url' field; 'type' can be 'image','document','video','audio'
    const mediaUrl = typeof body.url === "string" ? body.url.trim() : null;
    const mediaType = typeof body.type === "string" ? body.type.trim().toLowerCase() : null;

    if (!sender) {
      logger.warn({ body }, "Fonnte webhook: missing sender");
      return;
    }

    // ── Dedup: reject if exact same message from same sender already seen within 2 min ──
    const dedupKey = `${sender}|${message.slice(0, 120)}|${typeof body.url === "string" ? body.url.slice(0, 80) : ""}`;
    if (isDuplicate(dedupKey)) {
      logger.info({ sender }, "Fonnte webhook: duplicate message ignored");
      return;
    }

    // Must have either a text message OR a media file to process
    const hasText = message.trim().length > 0;
    // [H3-FIX] Only treat as media if URL passes SSRF allowlist check
    const mediaUrlSafe = mediaUrl && isAllowedMediaUrl(mediaUrl) ? mediaUrl : null;
    if (mediaUrl && !mediaUrlSafe) {
      logger.warn({ sender, mediaUrl }, "Fonnte webhook: media URL rejected by SSRF allowlist — ignoring");
    }
    const hasMedia = !!mediaUrlSafe && (mediaType === "image" || mediaType === "document" || mediaType === "pdf"
      || (mediaUrlSafe.match(/\.(pdf|jpg|jpeg|png|webp)(\?|$)/i) !== null));

    if (!hasText && !hasMedia) {
      logger.info({ sender, mediaType }, "Fonnte webhook: no text or processable media, skipping");
      return;
    }

    const isGroup = sender.includes("@g.us") || sender.includes("@lid");
    const actualSender = (isGroup && member) ? member : sender;
    const normalizedSender = normalizePhone(actualSender);
    const adminWa = await getAdminWa();

    // ─── 0. Media file processing (PDF / image) ───────────────────────────────
    if (hasMedia && mediaUrlSafe) {
      const displayName = senderName ?? actualSender;
      logger.info({ sender, mediaUrl: mediaUrlSafe, mediaType }, "Fonnte webhook: processing media file");

      let mediaResult = null;
      try {
        mediaResult = await processWaMediaForAiIntake(mediaUrlSafe, normalizedSender, senderName, message || null);
      } catch (mediaErr) {
        logger.warn({ mediaErr, sender }, "AI media intake: processing failed");
      }

      if (mediaResult) {
        const domain = getPreferredDomain();
        const draftUrl = domain ? `https://${domain}/bizportal/sales/ai-drafts` : "";
        const fileLabel = mediaResult.mimeType === "application/pdf" ? "📄 PDF" : "🖼️ Gambar";

        if (adminWa) {
          const adminMsg =
            `🤖 *DRAFT DARI FILE ${fileLabel} (AI)*\n` +
            `━━━━━━━━━━━━━━━━━━\n` +
            `Dari      : ${displayName}\n` +
            `No. HP    : ${actualSender}\n` +
            `Dokumen   : ${mediaResult.docSummary}\n` +
            `Draft     : *${mediaResult.docNumber}*\n` +
            `Customer  : ${mediaResult.customerName}\n` +
            `Konfiden  : ${mediaResult.confidence}\n` +
            (message ? `Caption   : ${message}\n` : "") +
            `━━━━━━━━━━━━━━━━━━\n` +
            (draftUrl ? `🔗 Review di BizPortal:\n${draftUrl}` : "");
          sendWhatsApp(adminWa, adminMsg).catch(() => undefined);
        }

        // Reply to sender (direct) or to group
        try {
          const settings = await getAiIntakeSettings();
          if (isGroup) {
            // Reply ke group — sebut nama pengirim agar kontekstual
            const groupReply =
              `✅ *File dari ${displayName} berhasil diproses!*\n` +
              `━━━━━━━━━━━━━━━━━━\n` +
              `📋 Draft   : *${mediaResult.docNumber}*\n` +
              `👤 Customer: ${mediaResult.customerName}\n` +
              `📄 Dokumen : ${mediaResult.docSummary}\n` +
              `🎯 Konfiden: ${mediaResult.confidence}\n` +
              `━━━━━━━━━━━━━━━━━━\n` +
              `_Tim kami akan segera menindaklanjuti._`;
            sendWhatsApp(sender, groupReply).catch(() => undefined);
          } else if (settings.replyWaTemplate) {
            const replyMsg = buildAiReplyWa(settings.replyWaTemplate, mediaResult.docNumber);
            sendWhatsApp(sender, replyMsg).catch(() => undefined);
          }
        } catch { /* non-critical */ }

        logger.info({ sender, docNumber: mediaResult.docNumber, docSummary: mediaResult.docSummary }, "AI media intake: draft created from WA file");
      } else {
        // Could not extract — forward the file info to admin
        if (adminWa) {
          const fileLabel = mediaType === "image" ? "🖼️ Gambar" : "📄 File";
          const forwardMsg =
            `📎 *File Masuk — Tidak Bisa Diproses Otomatis*\n` +
            `━━━━━━━━━━━━━━━━━━\n` +
            `Dari   : ${displayName}\n` +
            `No. HP : ${actualSender}\n` +
            `Tipe   : ${fileLabel}\n` +
            (message ? `Caption: ${message}\n` : "") +
            `━━━━━━━━━━━━━━━━━━\n` +
            `🔗 File: ${mediaUrlSafe}\n\n` +
            `_Periksa file secara manual di BizPortal._`;
          sendWhatsApp(adminWa, forwardMsg).catch(() => undefined);
        }

        // Jika dari group — balas ke group bahwa file diterima tapi perlu dicek manual
        if (isGroup) {
          const fileLabel = mediaType === "image" ? "gambar" : "file";
          const failReply =
            `📎 *File dari ${displayName} diterima*\n` +
            `━━━━━━━━━━━━━━━━━━\n` +
            `File ${fileLabel} Anda sudah kami terima dan akan diperiksa oleh tim kami.\n\n` +
            `_Mohon tunggu, kami akan segera menindaklanjuti._`;
          sendWhatsApp(sender, failReply).catch(() => undefined);
        }
      }

      // If no text to process further, stop here
      if (!hasText) return;
    }

    // ─── 1. Admin commands ───────────────────────────────────────────────────
    const adminPhones = await getAdminPhones();
    const isAdmin = adminPhones.length > 0 && adminPhones.includes(normalizedSender);

    if (isAdmin) {
      // QUOTES command: list all pending quotes for an order
      const quotesCmd = parseQuotesList(message);
      if (quotesCmd) {
        const [order] = await db.select().from(logisticOrdersTable)
          .where(sql`${logisticOrdersTable.orderNumber} = ${quotesCmd}`);
        if (!order) {
          sendWhatsApp(sender, `❌ Order *${quotesCmd}* tidak ditemukan.`).catch(() => undefined);
          return;
        }
        const quotes = await db.select().from(logisticOrderQuotesTable)
          .where(and(eq(logisticOrderQuotesTable.orderId, order.id), eq(logisticOrderQuotesTable.quoteStatus, "pending")))
          .orderBy(logisticOrderQuotesTable.createdAt);
        const vendors = await db.select().from(suppliersTable);
        const vendorMap = Object.fromEntries(vendors.map((v) => [v.id, v.name]));
        const quotesWithNames = quotes.map((q) => ({
          vendorName: vendorMap[q.vendorId] ?? `Vendor #${q.vendorId}`,
          vendorPrice: Number(q.vendorPrice),
          estimatedPickup: q.estimatedPickup,
          estimatedDelivery: q.estimatedDelivery,
          quoteStatus: q.quoteStatus,
        }));

        const listMsg =
          `📋 *DAFTAR PENAWARAN — ${order.orderNumber}*\n` +
          `━━━━━━━━━━━━━━━━━━\n` +
          `Jenis  : ${order.shipmentType}\n` +
          `Rute   : ${order.origin} → ${order.destination}\n` +
          `━━━━━━━━━━━━━━━━━━\n` +
          buildVendorQuoteList(quotesWithNames, order.orderNumber) + `\n` +
          `━━━━━━━━━━━━━━━━━━\n` +
          `Pilih vendor terbaik atau auto-pick:\n` +
          `\`APPROVE ${order.orderNumber}\` ← auto (harga terendah)\n` +
          `\`APPROVE ${order.orderNumber} [N]\` ← pilih vendor ke-N\n` +
          `\`APPROVE ${order.orderNumber} [N] [harga]\` ← pilih vendor + atur harga jual`;
        sendWhatsApp(sender, listMsg).catch(() => undefined);
        return;
      }

      // APPROVE command
      const adminCmd = parseAdminApprove(message);
      if (adminCmd) {
        const [order] = await db.select().from(logisticOrdersTable)
          .where(sql`${logisticOrdersTable.orderNumber} = ${adminCmd.orderNumber}`);

        if (!order) {
          sendWhatsApp(sender, `❌ Order *${adminCmd.orderNumber}* tidak ditemukan.`).catch(() => undefined);
          return;
        }

        // APPROVE without position or price → show vendor list first
        if (adminCmd.quotePosition === null && adminCmd.sellingPrice === null) {
          const quotes = await db.select().from(logisticOrderQuotesTable)
            .where(and(eq(logisticOrderQuotesTable.orderId, order.id), eq(logisticOrderQuotesTable.quoteStatus, "pending")))
            .orderBy(logisticOrderQuotesTable.createdAt);
          if (quotes.length === 0) {
            sendWhatsApp(sender, `⚠️ Belum ada vendor yang membalas untuk order *${adminCmd.orderNumber}*.`).catch(() => undefined);
            return;
          }
          const vendors = await db.select().from(suppliersTable);
          const vendorMap = Object.fromEntries(vendors.map((v) => [v.id, v.name]));
          const quotesWithNames = quotes.map((q) => ({
            vendorName: vendorMap[q.vendorId] ?? `Vendor #${q.vendorId}`,
            vendorPrice: Number(q.vendorPrice),
            estimatedPickup: q.estimatedPickup,
            estimatedDelivery: q.estimatedDelivery,
            quoteStatus: q.quoteStatus,
          }));
          const listMsg =
            `📋 *Pilih vendor untuk ${adminCmd.orderNumber}:*\n` +
            `━━━━━━━━━━━━━━━━━━\n` +
            buildVendorQuoteList(quotesWithNames, adminCmd.orderNumber) + `\n` +
            `━━━━━━━━━━━━━━━━━━\n` +
            `\`APPROVE ${adminCmd.orderNumber}\` ← auto-pick harga terendah`;
          sendWhatsApp(sender, listMsg).catch(() => undefined);
          return;
        }

        const result = await doApproveOrder(order.id, adminCmd.sellingPrice, adminCmd.quotePosition);

        if ("error" in result) {
          sendWhatsApp(sender, `❌ Gagal approve *${adminCmd.orderNumber}*:\n${result.error}`).catch(() => undefined);
          return;
        }

        const confirmMsg =
          `✅ *APPROVE BERHASIL*\n` +
          `━━━━━━━━━━━━━━━━━━\n` +
          `No. Order   : \`${result.orderNumber}\`\n` +
          `Vendor      : ${result.vendorName}\n` +
          `Harga Jual  : *${fmt(result.sellingPrice)}*\n` +
          `━━━━━━━━━━━━━━━━━━\n` +
          (result.customerPhone
            ? `📤 Penawaran sudah dikirim ke customer`
            : `⚠️ No. HP customer tidak tersedia, WA tidak dikirim`);
        sendWhatsApp(sender, confirmMsg).catch(() => undefined);

        if (adminWa && adminWa !== sender) {
          sendWhatsApp(adminWa,
            `✅ Order \`${result.orderNumber}\` di-approve via WA oleh ${senderName ?? sender}.\n` +
            `Vendor: ${result.vendorName}  Harga: ${fmt(result.sellingPrice)}`
          ).catch(() => undefined);
        }
        return;
      }

      // Partial 'approve' keyword → show help
      if (/approve/i.test(message)) {
        sendWhatsApp(sender,
          `ℹ️ *Perintah APPROVE:*\n\n` +
          `\`APPROVE LOG-xxx\`\n_→ tampilkan daftar vendor yang sudah quote_\n\n` +
          `\`APPROVE LOG-xxx 5500000\`\n_→ auto-pick vendor terbaik, harga jual 5.5jt_\n\n` +
          `\`APPROVE LOG-xxx 2\`\n_→ pilih vendor ke-2, harga otomatis_\n\n` +
          `\`APPROVE LOG-xxx 2 5500000\`\n_→ pilih vendor ke-2, harga jual 5.5jt_\n\n` +
          `\`QUOTES LOG-xxx\`\n_→ tampilkan semua penawaran untuk order_`
        ).catch(() => undefined);
        return;
      }
      // Fall through for other admin messages
    }

    // ─── 2. Vendor reply ──────────────────────────────────────────────────────
    const vendors = await db.select().from(suppliersTable).where(eq(suppliersTable.isActive, true));
    // Primary match: exact normalized phone; fallback: last 9 digits (handles different country-code prefixes)
    const last9 = normalizedSender.slice(-9);
    const matchedVendor =
      vendors.find((v) => v.phone && normalizePhone(v.phone) === normalizedSender) ??
      vendors.find((v) => v.phone && normalizePhone(v.phone).slice(-9) === last9);

    if (matchedVendor) {
      // ─── TERIMA / TOLAK response ─────────────────────────────────────────────
      const vendorTT = parseVendorTerimaTolaк(message);
      if (vendorTT) {
        let ttOrder: typeof logisticOrdersTable.$inferSelect | undefined;
        let ttFallback = false;

        if (vendorTT.orderNumber) {
          const [found] = await db.select().from(logisticOrdersTable)
            .where(sql`${logisticOrdersTable.orderNumber} = ${vendorTT.orderNumber}`);
          ttOrder = found;
        } else {
          // Fallback: most recent "Pending" order matching vendor's service type
          const recentOrders = await db.select().from(logisticOrdersTable)
            .where(eq(logisticOrdersTable.status, "Pending"))
            .orderBy(desc(logisticOrdersTable.createdAt))
            .limit(5);
          const vsType = (matchedVendor.serviceType ?? "").toLowerCase();
          ttOrder = recentOrders.find((o) =>
            vsType && (o.shipmentType ?? "").toLowerCase().includes(vsType)
          ) ?? recentOrders[0];
          if (ttOrder) ttFallback = true;
        }

        const ttOrderNum = ttOrder?.orderNumber ?? vendorTT.orderNumber ?? "tidak diketahui";
        const ttOrderUrl = ttOrder ? getOrderUrl(ttOrder.id) : "";

        if (vendorTT.action === "terima") {
          sendWhatsApp(sender,
            `✅ *Terima kasih, ${matchedVendor.name}!*\n\n` +
            `Pesanan *${ttOrderNum}* telah Anda terima.\n\n` +
            `Tim kami akan segera menghubungi Anda terkait detail pengiriman. 🙏`
          ).catch(() => undefined);

          if (adminWa) {
            await sendWhatsApp(adminWa,
              `✅ *VENDOR MENERIMA ORDER*\n` +
              `━━━━━━━━━━━━━━━━━━\n` +
              (ttFallback ? `⚠️ _No. Order tidak disertakan — pakai fallback otomatis_\n` : ``) +
              `No. Order : \`${ttOrderNum}\`\n` +
              `Vendor    : *${matchedVendor.name}*\n` +
              `No. HP    : ${sender}\n` +
              `━━━━━━━━━━━━━━━━━━\n` +
              (ttOrderUrl ? `🔗 *Buka di BizPortal:*\n${ttOrderUrl}\n\n` : ``) +
              `💡 Buat RFQ untuk vendor ini agar mereka dapat mengirim penawaran harga.`
            );
          }
          logger.info({ vendorId: matchedVendor.id, orderNum: ttOrderNum, ttFallback }, "Vendor accepted order (TERIMA)");
        } else {
          sendWhatsApp(sender,
            `Baik, terima kasih atas informasinya, *${matchedVendor.name}*.\n\n` +
            `Semoga dapat bekerja sama di lain kesempatan. 🙏`
          ).catch(() => undefined);

          if (adminWa) {
            await sendWhatsApp(adminWa,
              `❌ *VENDOR MENOLAK ORDER*\n` +
              `━━━━━━━━━━━━━━━━━━\n` +
              (ttFallback ? `⚠️ _No. Order tidak disertakan — pakai fallback otomatis_\n` : ``) +
              `No. Order : \`${ttOrderNum}\`\n` +
              `Vendor    : *${matchedVendor.name}*\n` +
              `No. HP    : ${sender}\n` +
              (ttOrderUrl ? `━━━━━━━━━━━━━━━━━━\n🔗 *Buka di BizPortal:*\n${ttOrderUrl}` : ``)
            );
          }
          logger.info({ vendorId: matchedVendor.id, orderNum: ttOrderNum, ttFallback }, "Vendor rejected order (TOLAK)");
        }
        return;
      }

      const parsed = parseVendorReply(message);

      if (parsed) {
        // Resolve which RFQ to use:
        // 1. If vendor included RFQ number → find it directly
        // 2. If vendor included order number → find the open RFQ for that order
        // 3. If neither → smart fallback: most recent open RFQ for this vendor
        let rfq: typeof logisticOrderRfqsTable.$inferSelect | undefined;
        let usedFallback = false;

        if (parsed.rfqNumber) {
          const [found] = await db.select().from(logisticOrderRfqsTable)
            .where(eq(logisticOrderRfqsTable.rfqNumber, parsed.rfqNumber));
          rfq = found;
        } else if (parsed.orderNumber) {
          const [order] = await db.select().from(logisticOrdersTable)
            .where(sql`${logisticOrdersTable.orderNumber} = ${parsed.orderNumber}`);
          if (order) {
            const openRfqs = await db.select().from(logisticOrderRfqsTable)
              .where(and(eq(logisticOrderRfqsTable.orderId, order.id), eq(logisticOrderRfqsTable.status, "open")))
              .orderBy(desc(logisticOrderRfqsTable.createdAt));
            rfq = openRfqs.find((r) => (r.vendorIds as number[]).includes(matchedVendor.id));
          }
        } else {
          // Smart fallback: most recent open RFQ including this vendor
          const openRfqs = await db.select().from(logisticOrderRfqsTable)
            .where(eq(logisticOrderRfqsTable.status, "open"))
            .orderBy(desc(logisticOrderRfqsTable.createdAt));
          rfq = openRfqs.find((r) => (r.vendorIds as number[]).includes(matchedVendor.id));
          if (rfq) usedFallback = true;
        }

        if (rfq) {
          const isInRfq = (rfq.vendorIds as number[]).includes(matchedVendor.id);
          if (isInRfq) {
            const [existingQuote] = await db.select().from(logisticOrderQuotesTable)
              .where(sql`${logisticOrderQuotesTable.rfqId} = ${rfq.id} AND ${logisticOrderQuotesTable.vendorId} = ${matchedVendor.id}`);

            const markupPct = Number(matchedVendor.markup ?? 0);
            const sellingPrice = calcSellingPrice(parsed.vendorPrice, "percentage", markupPct, null);
            const now = new Date();
            const resolvedRfqNumber = rfq.rfqNumber;

            if (existingQuote) {
              await db.update(logisticOrderQuotesTable).set({
                vendorPrice: String(parsed.vendorPrice),
                estimatedPickup: parsed.estimatedPickup,
                estimatedDelivery: parsed.estimatedDelivery,
                vendorNotes: parsed.vendorNotes,
                markupPercentage: String(markupPct),
                sellingPrice: String(sellingPrice),
                replySource: "whatsapp",
                replyTimestamp: now,
              }).where(eq(logisticOrderQuotesTable.id, existingQuote.id));
              logger.info({ rfqNumber: resolvedRfqNumber, vendorId: matchedVendor.id, usedFallback }, "Updated WA quote from vendor");
            } else {
              await db.insert(logisticOrderQuotesTable).values({
                rfqId: rfq.id,
                orderId: rfq.orderId,
                vendorId: matchedVendor.id,
                vendorPrice: String(parsed.vendorPrice),
                estimatedPickup: parsed.estimatedPickup,
                estimatedDelivery: parsed.estimatedDelivery,
                vendorNotes: parsed.vendorNotes,
                markupType: "percentage",
                markupPercentage: String(markupPct),
                sellingPrice: String(sellingPrice),
                quoteStatus: "pending",
                replySource: "whatsapp",
                replyTimestamp: now,
              });
              logger.info({ rfqNumber: resolvedRfqNumber, vendorId: matchedVendor.id, usedFallback }, "New WA quote from vendor saved");
            }

            const [order] = await db.select().from(logisticOrdersTable)
              .where(eq(logisticOrdersTable.id, rfq.orderId));

            // Fetch ALL current quotes to build the vendor list for admin
            const allQuotes = await db.select().from(logisticOrderQuotesTable)
              .where(and(eq(logisticOrderQuotesTable.orderId, rfq.orderId), eq(logisticOrderQuotesTable.quoteStatus, "pending")))
              .orderBy(logisticOrderQuotesTable.createdAt);
            const allVendors = await db.select().from(suppliersTable);
            const vendorMap = Object.fromEntries(allVendors.map((v) => [v.id, v.name]));
            const quotesWithNames = allQuotes.map((q) => ({
              vendorName: vendorMap[q.vendorId] ?? `Vendor #${q.vendorId}`,
              vendorPrice: Number(q.vendorPrice),
              estimatedPickup: q.estimatedPickup,
              estimatedDelivery: q.estimatedDelivery,
              quoteStatus: q.quoteStatus,
            }));

            const rfqVendorCount = (rfq.vendorIds as number[]).length;
            const orderNum = order?.orderNumber ?? String(rfq.orderId);
            const orderUrl = getOrderUrl(rfq.orderId);

            const adminMsg =
              `💰 *PENAWARAN VENDOR DITERIMA*\n` +
              `━━━━━━━━━━━━━━━━━━\n` +
              (usedFallback ? `⚠️ _No. RFQ/Order tidak disertakan — pakai fallback otomatis_\n` : "") +
              `No. RFQ     : \`${resolvedRfqNumber}\`\n` +
              `No. Order   : \`${orderNum}\`\n` +
              `Vendor      : *${matchedVendor.name}*\n` +
              `Harga Vendor: *${fmt(parsed.vendorPrice)}*\n` +
              (parsed.estimatedPickup ? `ETA Pickup  : ${parsed.estimatedPickup}\n` : "") +
              (parsed.estimatedDelivery ? `ETA Delivery: ${parsed.estimatedDelivery}\n` : "") +
              (parsed.vendorNotes ? `Catatan     : ${parsed.vendorNotes}\n` : "") +
              `Progress    : ${allQuotes.length}/${rfqVendorCount} vendor sudah quote\n` +
              `━━━━━━━━━━━━━━━━━━\n` +
              `📋 *Semua penawaran masuk:*\n` +
              buildVendorQuoteList(quotesWithNames, orderNum) + `\n` +
              `━━━━━━━━━━━━━━━━━━\n` +
              (orderUrl ? `🔗 *Buka di BizPortal:*\n${orderUrl}` : `Login ke sistem untuk approve.`);

            if (adminWa) {
              await sendWhatsApp(adminWa, adminMsg);
              logger.info({ vendorId: matchedVendor.id, usedFallback }, "Forwarded vendor RFQ reply to admin group");
            }

            const confirmMsg =
              `✅ Penawaran Anda untuk *${resolvedRfqNumber}* telah kami terima.\n` +
              `Harga: ${fmt(parsed.vendorPrice)}\n\n` +
              `Tim kami akan menghubungi Anda jika penawaran Anda dipilih. Terima kasih 🙏`;
            sendWhatsApp(sender, confirmMsg).catch(() => undefined);
            return;
          }
        }

        // Has price but no matching RFQ
        if (adminWa) {
          const forwardMsg =
            `📩 *Balasan Vendor (Harga Terdeteksi, RFQ Tidak Cocok)*\n` +
            `━━━━━━━━━━━━━━━━━━\n` +
            `Vendor      : *${matchedVendor.name}*\n` +
            `No. HP      : ${sender}\n` +
            `Harga Det.  : ${fmt(parsed.vendorPrice)}\n` +
            `━━━━━━━━━━━━━━━━━━\n` +
            `Pesan asli:\n${message}\n\n` +
            `_Input harga manual di BizPortal._`;
          await sendWhatsApp(adminWa, forwardMsg);
          logger.info({ vendorId: matchedVendor.id, sender }, "Vendor reply with price but no matching open RFQ — forwarded to admin");
        }
        return;
      }

      // Generic vendor message (no price detected) — forward to admin
      if (adminWa) {
        const forwardMsg =
          `📩 *Balasan dari Vendor*\n` +
          `━━━━━━━━━━━━━━━━━━\n` +
          `Vendor  : *${matchedVendor.name}*\n` +
          `No. HP  : ${sender}\n` +
          `━━━━━━━━━━━━━━━━━━\n` +
          `${message}`;
        await sendWhatsApp(adminWa, forwardMsg);
        logger.info({ vendorId: matchedVendor.id, sender }, "Forwarded generic vendor reply to admin group");
      }
    } else {
      // Unknown sender — check if message looks like a vendor price reply
      const parsedUnknown = parseVendorReply(message);
      const displayName = senderName ?? sender;

      if (adminWa && parsedUnknown && (parsedUnknown.rfqNumber || parsedUnknown.orderNumber)) {
        // Looks like a vendor quote reply — highlight it for admin
        const refNum = parsedUnknown.rfqNumber ?? parsedUnknown.orderNumber ?? "";
        const forwardMsg =
          `⚠️ *BALASAN HARGA DARI NOMOR TIDAK DIKENAL*\n` +
          `━━━━━━━━━━━━━━━━━━\n` +
          `Dari    : ${displayName}\n` +
          `No. HP  : ${sender}\n` +
          `Ref.    : \`${refNum}\`\n` +
          `Harga   : *${fmt(parsedUnknown.vendorPrice)}*\n` +
          (parsedUnknown.estimatedPickup ? `ETA     : ${parsedUnknown.estimatedPickup}` +
            (parsedUnknown.estimatedDelivery ? ` / ${parsedUnknown.estimatedDelivery}` : "") + `\n` : "") +
          (parsedUnknown.vendorNotes ? `Catatan : ${parsedUnknown.vendorNotes}\n` : "") +
          `━━━━━━━━━━━━━━━━━━\n` +
          `⚠️ _Nomor HP tidak terdaftar sebagai vendor. Periksa data vendor dan input manual di BizPortal._\n\n` +
          `Pesan asli:\n${message}`;
        await sendWhatsApp(adminWa, forwardMsg);
        logger.warn({ sender, refNum, price: parsedUnknown.vendorPrice }, "Unknown sender sent price reply — forwarded to admin");
      } else {
        // Try AI order intake — maybe this is a customer inquiry
        let aiResult = null;
        try {
          aiResult = await processWaForAiIntake(sender, message, senderName);
        } catch (aiErr) {
          logger.warn({ aiErr, sender }, "AI intake: WA processing failed");
        }

        if (aiResult) {
          // AI created a draft — notify admin and optionally reply to sender
          logger.info({ sender, docId: aiResult.docId, docNumber: aiResult.docNumber }, "AI intake: WA draft created");

          const domain = getPreferredDomain();
          const draftUrl = domain ? `https://${domain}/bizportal/sales/ai-drafts` : "";

          if (adminWa) {
            const adminMsg =
              `🤖 *DRAFT QUOTATION OTOMATIS (AI)*\n` +
              `━━━━━━━━━━━━━━━━━━\n` +
              `Dari    : ${displayName}\n` +
              `No. HP  : ${sender}\n` +
              `Draft   : *${aiResult.docNumber}*\n` +
              `Customer: ${aiResult.customerName}\n` +
              `Konfiden: ${aiResult.confidence}\n` +
              `━━━━━━━━━━━━━━━━━━\n` +
              (draftUrl ? `🔗 Review di BizPortal:\n${draftUrl}\n\n` : "") +
              `Pesan asli:\n${message}`;
            sendWhatsApp(adminWa, adminMsg).catch(() => undefined);
          }

          // Reply to customer with the draft number
          try {
            const settings = await getAiIntakeSettings();
            if (settings.replyWaTemplate) {
              const replyMsg = buildAiReplyWa(settings.replyWaTemplate, aiResult.docNumber);
              sendWhatsApp(sender, replyMsg).catch(() => undefined);
            }
          } catch (replyErr) {
            logger.warn({ replyErr }, "AI intake: WA reply failed");
          }
        } else if (adminWa) {
          // Not an order inquiry — forward as generic message
          const forwardMsg =
            `💬 *Pesan Masuk (WA)*\n` +
            `━━━━━━━━━━━━━━━━━━\n` +
            `Dari    : ${displayName}\n` +
            `No. HP  : ${sender}\n` +
            `━━━━━━━━━━━━━━━━━━\n` +
            `${message}`;
          await sendWhatsApp(adminWa, forwardMsg);
          logger.info({ sender }, "Forwarded unknown sender message to admin group");
        }
      }
    }
  } catch (err: unknown) {
    logger.error({ err }, "Fonnte webhook processing error");
  }
});


export { doApproveOrder };
export default router;
