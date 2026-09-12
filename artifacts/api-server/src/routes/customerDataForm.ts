import { Router, type Request, type Response } from "express";
import { randomBytes } from "crypto";
import { eq, and } from "drizzle-orm";
import { sql } from "drizzle-orm";
import {
  db,
  logisticOrdersTable,
  logisticOrderRfqsTable,
  logisticOrderItemsTable,
  suppliersTable,
  rfqVendorLinksTable,
  vmfActivityLogTable,
} from "@workspace/db";
import { sendViaService as sendWhatsApp } from "../lib/waTransport.js";
import { getAdminGroupWa } from "../lib/adminWa.js";
import { getPreferredDomain } from "../lib/domain.js";
import { logger } from "../lib/logger.js";
import rateLimit from "express-rate-limit";

export const customerDataFormPublicRouter = Router();
export const customerDataFormAdminRouter = Router();

// ─── Migrations ───────────────────────────────────────────────────────────────
void db.execute(sql.raw(`
  CREATE TABLE IF NOT EXISTS logistic_customer_data_tokens (
    id SERIAL PRIMARY KEY,
    token TEXT NOT NULL UNIQUE,
    rfq_id INTEGER NOT NULL,
    order_id INTEGER NOT NULL,
    missing_fields JSONB,
    custom_message TEXT,
    expires_at TIMESTAMPTZ NOT NULL DEFAULT (NOW() + INTERVAL '7 days'),
    submitted_at TIMESTAMPTZ,
    submitted_data JSONB,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
  )
`)).catch((e: unknown) => logger.warn({ e }, "customer_data_tokens migration warn"));

// ─── Rate Limiters ────────────────────────────────────────────────────────────
const cdGetLimiter = rateLimit({ windowMs: 15 * 60 * 1000, max: 60, standardHeaders: true, legacyHeaders: false });
const cdPostLimiter = rateLimit({ windowMs: 15 * 60 * 1000, max: 10, standardHeaders: true, legacyHeaders: false });

// ─── Helpers ──────────────────────────────────────────────────────────────────
const ts = () => new Date().toLocaleString("id-ID", { timeZone: "Asia/Jakarta" });

function safeStr(s: unknown): string {
  return String(s ?? "").replace(/'/g, "''");
}

function getCustomerDataFormUrl(token: string): string {
  const domain = getPreferredDomain();
  return domain ? `https://${domain}/customer-data-form/${encodeURIComponent(token)}` : `/customer-data-form/${token}`;
}

// ─── Field Definitions (per tipe layanan) ────────────────────────────────────
function buildFields(order: Record<string, unknown>, itemData: Record<string, unknown>, missingFields: string[]) {
  const sType = String(order.shipment_type ?? order.shipmentType ?? "").toLowerCase();
  const isAir   = sType.includes("air") || sType.includes("udara");
  const isSea   = sType.includes("sea") || sType.includes("laut") || sType.includes("ocean");
  const isPpjk  = sType.includes("ppjk");
  const isTruck = sType.includes("truck");

  const chk = (key: string, label: string, val: unknown, required = false) => ({
    key, label,
    value: val != null && String(val).trim() !== "" ? String(val) : null,
    required,
    missing: missingFields.includes(label),
  });

  const fields = [
    chk("customerName",  "Nama Customer/Shipper", order.customer_name  ?? order.customerName),
    chk("phone",         "Nomor WA",              order.phone),
    chk("email",         "Email",                 order.email),
    chk("origin",        "Kota Asal",             order.origin),
    chk("destination",   "Kota Tujuan",           order.destination),
    chk("commodity",     "Komoditi",              order.commodity),
    chk("grossWeight",   "Berat (kg)",            order.gross_weight   ?? order.grossWeight),
    chk("volumeCbm",     "Volume (CBM)",          order.volume_cbm     ?? order.volumeCbm),
    chk("jumlahKoli",    "Jumlah Koli",           order.jumlah_koli    ?? order.jumlahKoli),
  ];

  if (isAir || isSea) {
    fields.push(chk("shipperName",   "Nama Shipper",    itemData.shipperName  ?? order.customer_name, false));
    fields.push(chk("consigneeName", "Nama Consignee",  itemData.consigneeName ?? order.nama_penerima ?? order.namaPenerima));
    fields.push(chk("hsCode",        "HS Code",         itemData.hsCode       ?? order.hs_code       ?? order.hsCode));
    if (isAir) fields.push(chk("awbInstruction", "Instruksi AWB", itemData.awbInstruction));
    if (isSea) {
      fields.push(chk("blInstruction",  "Instruksi BL",    itemData.blInstruction));
      fields.push(chk("containerType",  "Tipe Container",  itemData.containerType));
    }
  }

  if (isPpjk) {
    fields.push(chk("npwp",   "NPWP Importir/Eksportir", itemData.npwp,  true));
    fields.push(chk("nib",    "NIB",                      itemData.nib));
    fields.push(chk("hsCode", "HS Code",                  itemData.hsCode ?? order.hs_code ?? order.hsCode, true));
  }

  if (isTruck) {
    fields.push(chk("pickupAddress",   "Alamat Pickup",  itemData.pickupAddress   ?? order.origin));
    fields.push(chk("deliveryAddress", "Alamat Tujuan",  itemData.deliveryAddress ?? order.destination));
    fields.push(chk("picPickup",       "PIC Pickup",     itemData.picPickup));
    fields.push(chk("truckType",       "Tipe Kendaraan", order.truck_type ?? order.truckType));
  }

  return fields;
}

// ─── PUBLIC: Generate Token (called from admin endpoint) ─────────────────────
export async function generateCustomerDataToken(rfqId: number, orderId: number, missingFields: string[], customMessage?: string): Promise<string> {
  const token = randomBytes(32).toString("hex"); // P0.2 — 256-bit
  await db.execute(sql.raw(`
    INSERT INTO logistic_customer_data_tokens
      (token, rfq_id, order_id, missing_fields, custom_message)
    VALUES ('${safeStr(token)}', ${rfqId}, ${orderId},
            '${safeStr(JSON.stringify(missingFields))}'::jsonb,
            ${customMessage ? `'${safeStr(customMessage)}'` : "NULL"})
  `));
  return token;
}

// ─── PUBLIC: GET /api/customer-data/:token ────────────────────────────────────
customerDataFormPublicRouter.get("/:token", cdGetLimiter, async (req: Request, res: Response) => {
  const { token } = req.params;

  try {
    const rows = await db.execute(sql.raw(`
      SELECT t.id, t.rfq_id, t.order_id, t.missing_fields, t.custom_message, t.expires_at, t.submitted_at
      FROM logistic_customer_data_tokens t
      WHERE t.token = '${safeStr(token)}'
    `)) as unknown as Record<string, unknown>[];

    if (!rows.length) return res.status(404).json({ error: "Link tidak ditemukan" });
    const rec = rows[0];

    if (rec.expires_at && new Date(String(rec.expires_at)) < new Date()) {
      return res.status(410).json({ error: "Link ini sudah kadaluarsa (expired)" });
    }

    const [order] = await db.select().from(logisticOrdersTable)
      .where(eq(logisticOrdersTable.id, Number(rec.order_id)));
    if (!order) return res.status(404).json({ error: "Order tidak ditemukan" });

    const orderRecord = order as unknown as Record<string, unknown>;

    const items = await db.select({ inputData: logisticOrderItemsTable.inputData })
      .from(logisticOrderItemsTable)
      .where(eq(logisticOrderItemsTable.orderId, order.id));
    const itemData = items[0]?.inputData as Record<string, unknown> ?? {};

    const missingFields = Array.isArray(rec.missing_fields) ? rec.missing_fields as string[] : [];
    const fields = buildFields(orderRecord, itemData, missingFields);

    return res.json({
      token,
      orderNumber: order.orderNumber,
      customerName: order.customerName,
      shipmentType: order.shipmentType,
      origin: order.origin,
      destination: order.destination,
      alreadySubmitted: !!rec.submitted_at,
      submittedAt: rec.submitted_at ?? null,
      customMessage: rec.custom_message ?? null,
      missingFields,
      fields,
    });
  } catch (e) {
    logger.error({ e }, "customer-data GET error");
    return res.status(500).json({ error: "Terjadi kesalahan server" });
  }
});

// ─── PUBLIC: POST /api/customer-data/:token ───────────────────────────────────
customerDataFormPublicRouter.post("/:token", cdPostLimiter, async (req: Request, res: Response) => {
  const { token } = req.params;
  const { fieldValues } = req.body as { fieldValues?: Record<string, string> };

  if (!fieldValues || typeof fieldValues !== "object") {
    return res.status(400).json({ error: "Data tidak valid" });
  }

  try {
    const rows = await db.execute(sql.raw(`
      SELECT t.id, t.rfq_id, t.order_id, t.expires_at, t.submitted_at
      FROM logistic_customer_data_tokens t
      WHERE t.token = '${safeStr(token)}'
    `)) as unknown as Record<string, unknown>[];

    if (!rows.length) return res.status(404).json({ error: "Link tidak ditemukan" });
    const rec = rows[0];

    if (rec.expires_at && new Date(String(rec.expires_at)) < new Date()) {
      return res.status(410).json({ error: "Link ini sudah kadaluarsa" });
    }

    const [order] = await db.select().from(logisticOrdersTable)
      .where(eq(logisticOrdersTable.id, Number(rec.order_id)));
    if (!order) return res.status(404).json({ error: "Order tidak ditemukan" });

    // Update logistic_orders dengan field yang relevan
    const orderUpdates: Record<string, string> = {};
    const itemUpdates: Record<string, string> = {};

    const orderFields = ["customerName", "phone", "email", "origin", "destination", "commodity", "grossWeight", "volumeCbm", "jumlahKoli", "truckType"];
    const itemFields = ["shipperName", "consigneeName", "hsCode", "awbInstruction", "blInstruction", "containerType", "npwp", "nib", "pickupAddress", "deliveryAddress", "picPickup"];

    for (const [key, val] of Object.entries(fieldValues)) {
      if (!val || String(val).trim() === "") continue;
      if (orderFields.includes(key)) orderUpdates[key] = String(val).trim();
      else if (itemFields.includes(key)) itemUpdates[key] = String(val).trim();
    }

    // Translate camelCase to snake_case for DB update
    const camelToSnake: Record<string, string> = {
      customerName: "customer_name", phone: "phone", email: "email",
      origin: "origin", destination: "destination", commodity: "commodity",
      grossWeight: "gross_weight", volumeCbm: "volume_cbm",
      jumlahKoli: "jumlah_koli", truckType: "truck_type",
    };

    const orderSetParts = Object.entries(orderUpdates)
      .map(([k, v]) => `${camelToSnake[k] ?? k} = '${safeStr(v)}'`)
      .filter(Boolean);

    if (orderSetParts.length > 0) {
      await db.execute(sql.raw(`
        UPDATE logistic_orders SET ${orderSetParts.join(", ")} WHERE id = ${order.id}
      `));
    }

    if (Object.keys(itemUpdates).length > 0) {
      const items = await db.select({ id: logisticOrderItemsTable.id, inputData: logisticOrderItemsTable.inputData })
        .from(logisticOrderItemsTable).where(eq(logisticOrderItemsTable.orderId, order.id));

      for (const item of items) {
        const merged = { ...(item.inputData as Record<string, unknown> ?? {}), ...itemUpdates };
        await db.execute(sql.raw(`
          UPDATE logistic_order_items SET input_data = '${safeStr(JSON.stringify(merged))}'::jsonb WHERE id = ${item.id}
        `));
      }
    }

    // Mark token as submitted
    await db.execute(sql.raw(`
      UPDATE logistic_customer_data_tokens
      SET submitted_at = NOW(), submitted_data = '${safeStr(JSON.stringify(fieldValues))}'::jsonb
      WHERE id = ${rec.id}
    `));

    // Audit log
    await db.insert(vmfActivityLogTable).values({
      entityType: "order",
      entityId: order.id,
      action: "customer_data_submitted",
      actor: "customer",
      note: `Customer ${order.customerName} submitted data via mini form (token)`,
      data: fieldValues as Record<string, unknown>,
    }).catch(() => {});

    // WA ke admin
    const adminGroupWa = await getAdminGroupWa().catch(() => null);
    if (adminGroupWa) {
      const updatedFields = Object.entries(fieldValues).map(([k, v]) => `  • ${k}: ${v}`).join("\n");
      const msg = `📋 *DATA CUSTOMER DIUPDATE — ${order.orderNumber}*\n\nCustomer *${order.customerName}* telah mengisi form data.\n\nField diupdate:\n${updatedFields}\n\n_${ts()}_`;
      sendWhatsApp(adminGroupWa, msg, { context: "customer-data-submitted" }).catch(() => {});
    }

    return res.json({
      ok: true,
      message: "Data berhasil disimpan. Terima kasih!",
    });
  } catch (e) {
    logger.error({ e }, "customer-data POST error");
    return res.status(500).json({ error: "Terjadi kesalahan server" });
  }
});

// ─── ADMIN: POST /logistic/rfq/:rfqId/request-customer-data-form ─────────────
// Generate token & kirim link form ke customer
customerDataFormAdminRouter.post("/rfq/:rfqId/request-customer-data-form", async (req: Request, res: Response) => {
  const { missingFields, customMessage } = req.body as {
    missingFields?: string[]; customMessage?: string;
  };

  const rfqId = parseInt(String(req.params.rfqId), 10);
  if (isNaN(rfqId)) return res.status(400).json({ message: "rfqId tidak valid" });

  const [rfq] = await db.select().from(logisticOrderRfqsTable)
    .where(eq(logisticOrderRfqsTable.id, rfqId));
  if (!rfq) return res.status(404).json({ message: "RFQ tidak ditemukan" });

  const [order] = await db.select().from(logisticOrdersTable)
    .where(eq(logisticOrdersTable.id, rfq.orderId));
  if (!order) return res.status(404).json({ message: "Order tidak ditemukan" });

  if (!order.phone) return res.status(400).json({ message: "Nomor WA customer tidak tersedia" });

  try {
    const missing = missingFields && missingFields.length > 0 ? missingFields : [];
    const token = await generateCustomerDataToken(rfqId, order.id, missing, customMessage);
    const formUrl = getCustomerDataFormUrl(token);

    const msgLines = [
      `📋 *KELENGKAPAN DATA PENGIRIMAN*`,
      ``,
      `Yth. ${order.customerName},`,
      ``,
      `Terima kasih telah mengkonfirmasi pesanan *${order.orderNumber}*.`,
      ``,
      `Untuk memproses pengiriman Anda, kami memerlukan kelengkapan data berikut. Mohon isi melalui link di bawah ini:`,
      ``,
      missing.length > 0 ? `Data yang diperlukan:\n${missing.map((f, i) => `${i + 1}. ${f}`).join("\n")}` : "",
      customMessage ? `\nCatatan: ${customMessage}` : "",
      ``,
      `🔗 Form Isi Data:`,
      formUrl,
      ``,
      `Link berlaku 7 hari. Terima kasih 🙏`,
      `_${ts()}_`,
    ].filter((l, i, arr) => !(l === "" && arr[i - 1] === ""));

    await sendWhatsApp(order.phone, msgLines.join("\n"), { context: "customer-data-form-link" });

    await db.execute(sql.raw(`
      UPDATE logistic_order_rfqs SET customer_data_request_sent_at = NOW() WHERE id = ${rfqId}
    `));

    return res.json({
      ok: true, formUrl,
      message: `Link form data dikirim ke customer (${order.phone})`,
    });
  } catch (e) {
    logger.error({ e }, "request-customer-data-form error");
    return res.status(500).json({ message: "Gagal generate form link" });
  }
});
