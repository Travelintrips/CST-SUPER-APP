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
  suppliersTable,
  vendorCatalogItemsTable,
} from "@workspace/db";
import { requireClerkUser } from "../lib/requireAdmin.js";
import { sendWhatsApp } from "../lib/fonnte.js";
import { getAdminGroupWa } from "../lib/adminWa.js";
import { getPreferredDomain } from "../lib/domain.js";
import { logger } from "../lib/logger.js";
import { ObjectStorageService } from "../lib/objectStorage.js";

export const logisticRfqV2Router = Router();

const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 10 * 1024 * 1024 } });
const objectStorage = new ObjectStorageService();

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

async function sendAdminRecapWa(rfqId: number, rfq: { rfqNumber: string; orderId: number }) {
  const adminGroup = await getAdminGroupWa();
  if (!adminGroup) return;

  const [order] = await db.select({
    shipmentType: logisticOrdersTable.shipmentType,
    origin: logisticOrdersTable.origin,
    destination: logisticOrdersTable.destination,
  }).from(logisticOrdersTable).where(eq(logisticOrdersTable.id, rfq.orderId));

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
  const msg =
    `🔔 *Update Penawaran Vendor*\n\n` +
    `RFQ: ${rfq.rfqNumber}\n` +
    `Layanan: ${order?.shipmentType ?? "—"}\n` +
    `Rute: ${order?.origin ?? "—"} → ${order?.destination ?? "—"}\n\n` +
    (listStr ? `📋 *Daftar penawaran:*\n${listStr}\n` : "") +
    (waitingStr ? `⏳ *Belum jawab:*\n${waitingStr}\n` : "") +
    `🔗 Lihat & pilih vendor:\n${compLink}`;

  sendWhatsApp(adminGroup, msg).catch((e: unknown) =>
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
  const orderId = parseInt(req.params.orderId, 10);
  if (isNaN(orderId)) return res.status(400).json({ message: "orderId tidak valid" });

  const [order] = await db.select().from(logisticOrdersTable).where(eq(logisticOrdersTable.id, orderId));
  if (!order) return res.status(404).json({ message: "Order tidak ditemukan" });

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

  const [rfq] = await db.insert(logisticOrderRfqsTable).values({
    orderId,
    rfqNumber,
    status: "admin_review",
    notes: notes ?? null,
    responseDeadline: responseDeadline ?? undefined,
  }).returning();

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
  const token = req.params.token?.trim();
  if (!token) return res.status(400).json({ message: "Token tidak valid" });

  const [link] = await db.select().from(rfqVendorLinksTable)
    .where(eq(rfqVendorLinksTable.token, token));
  if (!link) return res.status(404).json({ message: "Link tidak valid atau sudah kadaluarsa" });

  if (link.expiredAt && link.expiredAt < new Date() && link.status === "waiting_response") {
    await db.update(rfqVendorLinksTable).set({ status: "expired" })
      .where(eq(rfqVendorLinksTable.id, link.id));
    return res.status(410).json({ message: "Link sudah kadaluarsa" });
  }
  if (link.status === "expired") return res.status(410).json({ message: "Link sudah kadaluarsa" });

  if (!link.openedAt) {
    await db.update(rfqVendorLinksTable).set({ openedAt: new Date() })
      .where(eq(rfqVendorLinksTable.id, link.id)).catch(() => {});
  }

  const [rfq] = await db.select().from(logisticOrderRfqsTable)
    .where(eq(logisticOrderRfqsTable.id, link.rfqId));
  if (!rfq) return res.status(404).json({ message: "RFQ tidak ditemukan" });

  const [order] = await db.select().from(logisticOrdersTable)
    .where(eq(logisticOrdersTable.id, rfq.orderId));
  if (!order) return res.status(404).json({ message: "Order tidak ditemukan" });

  const [vendor] = await db.select({ name: suppliersTable.name })
    .from(suppliersTable).where(eq(suppliersTable.id, link.vendorId));

  let basicPrice = link.basicPrice ? Number(link.basicPrice) : null;
  if (basicPrice == null) {
    const catalog = await db.select().from(vendorCatalogItemsTable)
      .where(and(eq(vendorCatalogItemsTable.vendorId, link.vendorId), eq(vendorCatalogItemsTable.isActive, true)));
    basicPrice = catalog[0] ? Number(catalog[0].priceBase) : null;
  }

  return res.json({
    linkId: link.id,
    rfqNumber: rfq.rfqNumber,
    vendorName: vendor?.name ?? `Vendor #${link.vendorId}`,
    serviceType: order.shipmentType ?? "",
    origin: order.origin,
    destination: order.destination,
    commodity: order.commodity ?? null,
    cargoDescription: order.cargoDescription ?? null,
    grossWeight: order.grossWeight ? parseFloat(order.grossWeight) : null,
    volumeCbm: order.volumeCbm ? parseFloat(order.volumeCbm) : null,
    requiredDate: order.requiredDate ?? null,
    basicPrice,
    responseDeadline: link.expiredAt?.toISOString() ?? null,
    alreadySubmitted: !!link.submittedAt,
    currentStatus: link.status,
    currentOfferedPrice: link.offeredPrice ? Number(link.offeredPrice) : null,
    currentEta: link.eta ?? null,
    currentNotes: link.notes ?? null,
  });
});

// ─── PUBLIC: POST /vendor-form/:token ────────────────────────────────────────
logisticRfqV2Router.post("/vendor-form/:token/upload", upload.single("file") as any, async (req: Request, res: Response) => {
  const token = req.params.token?.trim();
  if (!token) return res.status(400).json({ message: "Token tidak valid" });
  const [link] = await db.select({ id: rfqVendorLinksTable.id, status: rfqVendorLinksTable.status })
    .from(rfqVendorLinksTable).where(eq(rfqVendorLinksTable.token, token));
  if (!link) return res.status(404).json({ message: "Token tidak valid" });
  if (!req.file) return res.status(400).json({ message: "Tidak ada file" });
  try {
    const objectId = randomUUID();
    const storagePath = `public/rfq-attachments/${objectId}`;
    await objectStorage.uploadFile(req.file.buffer, storagePath, req.file.mimetype);
    const url = objectStorage.getPublicUrl(storagePath);
    return res.json({ url });
  } catch (e) {
    logger.error({ e }, "rfq attachment upload failed");
    return res.status(500).json({ message: "Gagal upload" });
  }
});

logisticRfqV2Router.post("/vendor-form/:token", async (req: Request, res: Response) => {
  const token = req.params.token?.trim();
  if (!token) return res.status(400).json({ message: "Token tidak valid" });

  const [link] = await db.select().from(rfqVendorLinksTable)
    .where(eq(rfqVendorLinksTable.token, token));
  if (!link) return res.status(404).json({ message: "Link tidak valid" });

  if (link.expiredAt && link.expiredAt < new Date() && link.status === "waiting_response") {
    await db.update(rfqVendorLinksTable).set({ status: "expired" }).where(eq(rfqVendorLinksTable.id, link.id));
    return res.status(410).json({ message: "Link sudah kadaluarsa" });
  }
  if (link.status === "expired") return res.status(410).json({ message: "Link sudah kadaluarsa" });

  const [rfq] = await db.select().from(logisticOrderRfqsTable)
    .where(eq(logisticOrderRfqsTable.id, link.rfqId));
  if (!rfq) return res.status(404).json({ message: "RFQ tidak ditemukan" });

  const { action, offeredPrice, eta, notes, attachmentUrl } = req.body as {
    action: "accept" | "counter" | "reject";
    offeredPrice?: number;
    eta?: string;
    notes?: string;
    attachmentUrl?: string;
  };

  if (!action || !["accept", "counter", "reject"].includes(action)) {
    return res.status(400).json({ message: "action harus accept, counter, atau reject" });
  }
  if (action === "counter") {
    if (!offeredPrice || Number(offeredPrice) <= 0) return res.status(400).json({ message: "Harga penawaran harus diisi" });
    if (!eta) return res.status(400).json({ message: "ETA harus diisi" });
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
  await db.update(rfqVendorLinksTable).set({
    status: newStatus,
    offeredPrice: action === "accept" ? link.basicPrice : (offeredPrice ? String(offeredPrice) : null),
    eta: eta ?? null,
    notes: notes ?? null,
    attachmentUrl: attachmentUrl ?? link.attachmentUrl,
    isNewUpdate: true,
    submittedAt: link.submittedAt ?? now,
    lastUpdatedAt: now,
  }).where(eq(rfqVendorLinksTable.id, link.id));

  const actionLabel = action === "accept" ? "Terima Harga Basic"
    : action === "counter" ? `Counter Offer ${fmtRp(offeredPrice)}`
    : "Tolak";
  const actDesc = isUpdate
    ? `${vendorName} memperbarui penawaran: ${actionLabel}`
    : `${vendorName} submit penawaran: ${actionLabel}`;
  await logActivity(link.rfqId, "vendor", vendorName, isUpdate ? "vendor_update" : "vendor_submit", actDesc);

  await sendAdminRecapWa(link.rfqId, rfq);

  return res.json({ success: true, message: "Penawaran berhasil dikirim", isUpdate });
});

// ─── ADMIN: POST /rfq/:rfqId/blast ────────────────────────────────────────────
logisticRfqV2Router.post("/rfq/:rfqId/blast", async (req: Request, res: Response) => {
  if (!(await requireClerkUser(req, res))) return;
  const rfqId = parseInt(req.params.rfqId, 10);
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

  const results: { vendorId: number; vendorName: string; token: string; sent: boolean }[] = [];

  for (const vendor of eligible) {
    let linkToken: string;
    let linkId: number;

    const existingLink = existingLinks.find((l) => l.vendorId === vendor.id);
    if (existingLink) {
      linkToken = existingLink.token;
      linkId = existingLink.id;
    } else {
      const catalogItems = await db.select().from(vendorCatalogItemsTable)
        .where(and(eq(vendorCatalogItemsTable.vendorId, vendor.id), eq(vendorCatalogItemsTable.isActive, true)));
      const basicPrice = catalogItems[0] ? String(catalogItems[0].priceBase) : null;
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
    const basicPriceNum = existingLink?.basicPrice ?? null;
    const fmtBasic = basicPriceNum ? ` (Harga Dasar: ${fmtRp(basicPriceNum)})` : "";

    const msg =
      `📋 *REQUEST FOR QUOTATION — CST LOGISTICS*\n` +
      `━━━━━━━━━━━━━━━━━━\n` +
      `Kepada Yth. *${vendor.name}*,\n\n` +
      `Mohon penawaran harga untuk:\n\n` +
      `No. RFQ     : *${rfq.rfqNumber}*\n` +
      `Layanan     : ${order.shipmentType ?? "—"}\n` +
      `Rute        : ${order.origin} → ${order.destination}\n` +
      (order.commodity ? `Komoditi    : ${order.commodity}\n` : "") +
      (order.grossWeight ? `Berat       : ${parseFloat(order.grossWeight)} kg\n` : "") +
      (order.requiredDate ? `Tgl Butuh   : ${order.requiredDate}\n` : "") +
      fmtBasic + `\n` +
      `━━━━━━━━━━━━━━━━━━\n` +
      `📱 *Isi penawaran di sini:*\n${formUrl}\n\n` +
      `⏰ Batas waktu: ${deadlineHours} jam\n\nTerima kasih 🙏`;

    try {
      await sendWhatsApp(vendor.phone!, msg);
      results.push({ vendorId: vendor.id, vendorName: vendor.name, token: linkToken, sent: true });
    } catch (e) {
      logger.error({ e, vendorId: vendor.id }, "blast WA vendor failed");
      results.push({ vendorId: vendor.id, vendorName: vendor.name, token: linkToken, sent: false });
    }
  }

  const newVendorIds = [...new Set([...(Array.isArray(rfq.vendorIds) ? rfq.vendorIds as number[] : []), ...eligible.map((v) => v.id)])];
  await db.update(logisticOrderRfqsTable).set({
    vendorIds: newVendorIds,
    status: "vendor_blasted",
    responseDeadline: expiredAt,
  }).where(eq(logisticOrderRfqsTable.id, rfqId));

  const sentCount = results.filter((r) => r.sent).length;
  await logActivity(rfqId, "admin", "Admin", "admin_blast", `Admin blast ke ${sentCount} vendor: ${eligible.map((v) => v.name).join(", ")}`);

  return res.json({ ok: true, rfqNumber: rfq.rfqNumber, sentCount, results, comparisonUrl: getComparisonUrl(rfqId) });
});

// ─── ADMIN: GET /rfq/:rfqId/comparison ───────────────────────────────────────
logisticRfqV2Router.get("/rfq/:rfqId/comparison", async (req: Request, res: Response) => {
  if (!(await requireClerkUser(req, res))) return;
  const rfqId = parseInt(req.params.rfqId, 10);
  if (isNaN(rfqId)) return res.status(400).json({ message: "rfqId tidak valid" });

  const [rfq] = await db.select().from(logisticOrderRfqsTable)
    .where(eq(logisticOrderRfqsTable.id, rfqId));
  if (!rfq) return res.status(404).json({ message: "RFQ tidak ditemukan" });

  const [order] = await db.select().from(logisticOrdersTable)
    .where(eq(logisticOrdersTable.id, rfq.orderId));

  const links = await db.select().from(rfqVendorLinksTable)
    .where(eq(rfqVendorLinksTable.rfqId, rfqId))
    .orderBy(sql`created_at ASC`);

  const now = new Date();
  for (const link of links) {
    if (link.status === "waiting_response" && link.expiredAt && link.expiredAt < now) {
      await db.update(rfqVendorLinksTable).set({ status: "expired" })
        .where(eq(rfqVendorLinksTable.id, link.id)).catch(() => {});
      link.status = "expired";
    }
  }

  const vendorIds = links.map((l) => l.vendorId);
  const vendors = vendorIds.length
    ? await db.select({ id: suppliersTable.id, name: suppliersTable.name, phone: suppliersTable.phone })
        .from(suppliersTable).where(inArray(suppliersTable.id, vendorIds))
    : [];
  const vendorMap = new Map(vendors.map((v) => [v.id, v]));

  const activities = await db.select().from(rfqActivityLogsTable)
    .where(eq(rfqActivityLogsTable.rfqId, rfqId))
    .orderBy(sql`created_at DESC`).limit(50);

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
    .map((l) => ({
      linkId: l.id,
      vendorId: l.vendorId,
      vendorName: vendorMap.get(l.vendorId)?.name ?? `Vendor #${l.vendorId}`,
      phone: vendorMap.get(l.vendorId)?.phone ?? null,
      status: l.status,
      basicPrice: l.basicPrice ? Number(l.basicPrice) : null,
      offeredPrice: l.offeredPrice ? Number(l.offeredPrice) : null,
      eta: l.eta ?? null,
      notes: l.notes ?? null,
      attachmentUrl: l.attachmentUrl ?? null,
      isNewUpdate: l.isNewUpdate,
      openedAt: l.openedAt?.toISOString() ?? null,
      submittedAt: l.submittedAt?.toISOString() ?? null,
      lastUpdatedAt: l.lastUpdatedAt?.toISOString() ?? null,
      expiredAt: l.expiredAt?.toISOString() ?? null,
      formUrl: getVendorFormUrl(l.token),
    }));

  const stats = {
    total: links.length,
    answered: links.filter((l) => ["accepted_basic_price", "counter_offer", "selected", "not_selected", "late_response"].includes(l.status)).length,
    pending: links.filter((l) => l.status === "waiting_response").length,
    rejected: links.filter((l) => l.status === "rejected").length,
    counterOffer: links.filter((l) => l.status === "counter_offer").length,
    expired: links.filter((l) => l.status === "expired").length,
    selected: links.filter((l) => l.status === "selected").length,
  };

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
    finalSellingPrice: order?.finalSellingPrice ? Number(order.finalSellingPrice) : null,
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
  });
});

// ─── ADMIN: POST /rfq/:rfqId/select-vendor ───────────────────────────────────
logisticRfqV2Router.post("/rfq/:rfqId/select-vendor", async (req: Request, res: Response) => {
  if (!(await requireClerkUser(req, res))) return;
  const rfqId = parseInt(req.params.rfqId, 10);
  if (isNaN(rfqId)) return res.status(400).json({ message: "rfqId tidak valid" });

  const { linkId, sellingPrice } = req.body as { linkId: number; sellingPrice?: number };
  if (!linkId) return res.status(400).json({ message: "linkId wajib diisi" });

  const [link] = await db.select().from(rfqVendorLinksTable)
    .where(and(eq(rfqVendorLinksTable.id, linkId), eq(rfqVendorLinksTable.rfqId, rfqId)));
  if (!link) return res.status(404).json({ message: "Link vendor tidak ditemukan" });

  const [vendor] = await db.select({ name: suppliersTable.name }).from(suppliersTable)
    .where(eq(suppliersTable.id, link.vendorId));

  await db.update(rfqVendorLinksTable).set({ status: "selected" })
    .where(eq(rfqVendorLinksTable.id, linkId));

  const otherLinks = await db.select({ id: rfqVendorLinksTable.id, status: rfqVendorLinksTable.status })
    .from(rfqVendorLinksTable)
    .where(and(eq(rfqVendorLinksTable.rfqId, rfqId), sql`id != ${linkId}`));

  for (const other of otherLinks) {
    if (!["rejected", "expired", "late_response"].includes(other.status)) {
      await db.update(rfqVendorLinksTable).set({ status: "not_selected" })
        .where(eq(rfqVendorLinksTable.id, other.id));
    }
  }

  await db.update(logisticOrderRfqsTable).set({ status: "vendor_selected" })
    .where(eq(logisticOrderRfqsTable.id, rfqId));

  if (sellingPrice) {
    await db.update(logisticOrdersTable)
      .set({ finalSellingPrice: String(sellingPrice), approvedVendorId: link.vendorId })
      .where(eq(logisticOrdersTable.id,
        (await db.select({ orderId: logisticOrderRfqsTable.orderId }).from(logisticOrderRfqsTable).where(eq(logisticOrderRfqsTable.id, rfqId)).then((r) => r[0]?.orderId ?? 0))
      ));
  }

  const vendorName = vendor?.name ?? `Vendor #${link.vendorId}`;
  await logActivity(rfqId, "admin", "Admin", "admin_select_vendor",
    `Admin memilih vendor: ${vendorName} — ${fmtRp(link.offeredPrice ?? link.basicPrice)}`);

  return res.json({ ok: true, selectedVendorName: vendorName });
});

// ─── ADMIN: POST /rfq/:rfqId/vendor-link/:linkId/action ──────────────────────
logisticRfqV2Router.post("/rfq/:rfqId/vendor-link/:linkId/action", async (req: Request, res: Response) => {
  if (!(await requireClerkUser(req, res))) return;
  const rfqId = parseInt(req.params.rfqId, 10);
  const linkId = parseInt(req.params.linkId, 10);
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
    await db.update(rfqVendorLinksTable).set({ status: "not_selected" })
      .where(eq(rfqVendorLinksTable.id, linkId));
    await logActivity(rfqId, "admin", "Admin", "admin_reject_vendor",
      `Admin menolak vendor: ${vendorName}`);
    return res.json({ ok: true });
  }

  if (action === "request_revision") {
    if (vendor?.phone && actionMsg) {
      const [rfq] = await db.select({ rfqNumber: logisticOrderRfqsTable.rfqNumber })
        .from(logisticOrderRfqsTable).where(eq(logisticOrderRfqsTable.id, rfqId));
      const formUrl = getVendorFormUrl(link.token);
      const waMsg =
        `📝 *Permintaan Revisi Penawaran*\n\n` +
        `RFQ: ${rfq?.rfqNumber ?? ""}\n` +
        `Vendor: ${vendorName}\n\n` +
        `Catatan Admin: ${actionMsg}\n\n` +
        `Silakan perbarui penawaran:\n${formUrl}`;
      sendWhatsApp(vendor.phone, waMsg).catch(() => {});
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
  const rfqId = parseInt(req.params.rfqId, 10);
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
  await db.execute(sql`
    UPDATE logistic_order_rfqs
    SET status = 'customer_quoted',
        quoted_price = ${sellingPrice},
        quoted_at = NOW(),
        quote_notes = ${quoteNotes ?? null}
    WHERE id = ${rfqId}
  `);

  // Update order: final selling price
  await db.update(logisticOrdersTable)
    .set({ finalSellingPrice: String(sellingPrice) })
    .where(eq(logisticOrdersTable.id, rfq.orderId));

  // Kirim WA ke customer
  let waSent = false;
  if (doSendWa && order.phone) {
    const eta = selectedLink?.eta ? `\n⏱ *Estimasi:* ${selectedLink.eta}` : "";
    const notes = quoteNotes ? `\n\n📝 *Catatan:* ${quoteNotes}` : "";
    const waMsg =
      `✅ *Penawaran Freight Anda Telah Siap*\n\n` +
      `Halo *${order.customerName}*,\n\n` +
      `Kami telah mendapatkan penawaran terbaik untuk pengiriman Anda:\n\n` +
      `📦 *Layanan:* ${order.shipmentType}\n` +
      `🗺 *Rute:* ${order.origin} → ${order.destination}\n` +
      `💰 *Harga Penawaran:* ${fmtRp(sellingPrice)}${eta}` +
      notes +
      `\n\nSilakan hubungi tim kami untuk konfirmasi.\nNo. Order: *${order.orderNumber}*`;
    await sendWhatsApp(order.phone, waMsg).then(() => { waSent = true; }).catch(() => {});
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

// ─── ADMIN: GET /rfq/by-order/:orderId ────────────────────────────────────────
logisticRfqV2Router.get("/rfq/by-order/:orderId", async (req: Request, res: Response) => {
  if (!(await requireClerkUser(req, res))) return;
  const orderId = parseInt(req.params.orderId, 10);
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
