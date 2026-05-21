import { db, suppliersTable, vendorCatalogItemsTable } from "@workspace/db";
import { eq, and, ilike } from "drizzle-orm";
import { sendWhatsApp } from "./fonnte";
import { getAdminWa, getAdminGroupWa } from "./adminWa";
import { getPreferredDomain } from "./domain";
import { sendMail, isSmtpConfigured } from "./mailer";
import { logger } from "./logger";
import { generateShortLink } from "./shortLink";

const ADMIN_EMAIL = process.env.ADMIN_EMAIL ?? "admcst001@gmail.com";

export interface LogisticOrderData {
  id: number;
  orderNumber: string;
  customerName: string;
  companyName: string;
  email: string;
  phone: string;
  shipmentType: string;
  origin: string;
  destination: string;
  commodity?: string | null;
  cargoDescription?: string | null;
  grossWeight?: number | null;
  volumeCbm?: number | null;
  grandTotal: number;
  serviceList: string;
  requiredDate?: string | null;
  notes?: string | null;
  jamOrder?: string | null;
  vehicleType?: string | null;
  createdAt?: Date | string | null;
}

const BULAN_ID = ["Jan","Feb","Mar","Apr","Mei","Jun","Jul","Agt","Sep","Okt","Nov","Des"];
const TZ = "Asia/Jakarta";

function nowWIB(): string {
  const now = new Date();
  const parts = new Intl.DateTimeFormat("id-ID", {
    timeZone: TZ, day: "2-digit", month: "long", year: "numeric",
    hour: "2-digit", minute: "2-digit", hour12: false,
  }).formatToParts(now);
  const day  = parts.find(p => p.type === "day")?.value ?? "";
  const mon  = parts.find(p => p.type === "month")?.value ?? "";
  const year = parts.find(p => p.type === "year")?.value ?? "";
  const hour = parts.find(p => p.type === "hour")?.value ?? "";
  const min  = parts.find(p => p.type === "minute")?.value ?? "";
  return `${day} ${mon} ${year}, ${hour}:${min} WIB`;
}

function formatTanggal(dt: Date | string): string {
  const d = new Date(dt);
  const parts = new Intl.DateTimeFormat("id-ID", { timeZone: TZ, day: "2-digit", month: "long", year: "numeric" }).formatToParts(d);
  const day  = parts.find(p => p.type === "day")?.value ?? "";
  const mon  = parts.find(p => p.type === "month")?.value ?? "";
  const year = parts.find(p => p.type === "year")?.value ?? "";
  return `${day} ${mon} ${year}`;
}

function formatJam(dt: Date | string): string {
  return new Intl.DateTimeFormat("id-ID", { timeZone: TZ, hour: "2-digit", minute: "2-digit", hour12: false }).format(new Date(dt));
}

/** Format ISO date string "2026-05-14" → "14 Mei 2026" */
function formatISODate(dateStr: string): string {
  const d = new Date(dateStr + "T00:00:00+07:00");
  if (isNaN(d.getTime())) return dateStr;
  const parts = new Intl.DateTimeFormat("id-ID", { timeZone: TZ, day: "2-digit", month: "long", year: "numeric" }).formatToParts(d);
  const day  = parts.find(p => p.type === "day")?.value ?? "";
  const mon  = parts.find(p => p.type === "month")?.value ?? "";
  const year = parts.find(p => p.type === "year")?.value ?? "";
  return `${day} ${mon} ${year}`;
}

/** Format jam_order "16.13" or "16:13" → "16:13" */
function formatJamOrder(jam: string): string {
  return jam.replace(".", ":");
}

function getApproveFormUrl(orderNumber: string): string {
  const domain = getPreferredDomain();
  if (!domain) return "";
  return `https://${domain}/approve/${orderNumber}`;
}

function formatRupiah(amount: number): string {
  return amount.toLocaleString("id-ID");
}

/** Returns true for air/sea freight types that need per-unit pricing hints */
function isFreightWithDimensions(shipmentType: string): boolean {
  const t = shipmentType.toLowerCase();
  return t.includes("air") || t.includes("sea") || t.includes("laut") || t.includes("udara");
}

function buildAdminWaMessage(order: LogisticOrderData): string {
  const approveUrl = getApproveFormUrl(order.orderNumber);
  const domain = getPreferredDomain() || "cstlogistic.co.id";
  const bizportalUrl = `https://${domain}/bizportal/logistics/orders/${order.id}`;
  const tgl = order.createdAt ? formatTanggal(order.createdAt) : "";
  const jam = order.jamOrder ?? (order.createdAt ? formatJam(order.createdAt) : "");
  return (
    `🚢 *ORDER LOGISTIK BARU*\n` +
    `━━━━━━━━━━━━━━━━━━\n` +
    `No. Order       : \`${order.orderNumber}\`\n` +
    (tgl ? `Tanggal         : ${tgl}\n` : ``) +
    (jam ? `Jam             : ${jam}\n` : ``) +
    `Status          : Menunggu Konfirmasi\n` +
    `Customer        : ${order.customerName}${order.companyName ? ` (${order.companyName})` : ""}\n` +
    `Email           : ${order.email}\n` +
    `HP              : ${order.phone}\n` +
    `Jenis           : ${order.shipmentType}\n` +
    `Rute            : ${order.origin} → ${order.destination}\n` +
    (order.commodity ? `Kategori Barang : ${order.commodity}\n` : ``) +
    (order.cargoDescription ? `Deskripsi       : ${order.cargoDescription}\n` : ``) +
    (order.grossWeight ? `Berat           : ${order.grossWeight} kg\n` : ``) +
    (order.volumeCbm ? `Volume          : ${order.volumeCbm} CBM\n` : ``) +
    `Layanan         :\n${order.serviceList}\n` +
    `Total Est.      : Rp ${formatRupiah(order.grandTotal)}\n` +
    (order.requiredDate ? `Tgl Kirim       : ${order.requiredDate}\n` : ``) +
    (order.notes ? `Catatan         : ${order.notes}\n` : ``) +
    `━━━━━━━━━━━━━━━━━━\n` +
    `⚡ *Aksi Cepat Admin:*\n` +
    (approveUrl ? `📋 Penawaran vendor → ${approveUrl}\n` : ``) +
    `🖥️ Buka BizPortal → ${bizportalUrl}\n\n` +
    `_Dikirim: ${nowWIB()}_`
  );
}

function buildVendorWaMessage(order: LogisticOrderData, vendorName: string): string {
  const tgl = order.createdAt ? formatTanggal(order.createdAt) : "";
  const jam = order.jamOrder ?? (order.createdAt ? formatJam(order.createdAt) : "");
  const responseUrl = getVendorResponseUrl(order.orderNumber);
  return (
    `📦 *PERMINTAAN ORDER BARU — CST LOGISTICS*\n` +
    `━━━━━━━━━━━━━━━━━━━━\n` +
    `Kepada Yth. *${vendorName}*,\n\n` +
    `No. Order       : *${order.orderNumber}*\n` +
    (tgl ? `Tanggal         : ${tgl}\n` : ``) +
    (jam ? `Jam             : ${jam}\n` : ``) +
    `Status          : Menunggu Konfirmasi\n` +
    `Jenis           : ${order.shipmentType}\n` +
    `Rute            : ${order.origin} → ${order.destination}\n` +
    (order.commodity ? `Kategori Barang : ${order.commodity}\n` : ``) +
    (order.cargoDescription ? `Deskripsi       : ${order.cargoDescription}\n` : ``) +
    (order.grossWeight ? `Berat           : ${order.grossWeight} kg\n` : ``) +
    (order.volumeCbm ? `Volume          : ${order.volumeCbm} CBM\n` : ``) +
    (order.requiredDate ? `Tgl Butuh       : ${order.requiredDate}\n` : ``) +
    `Layanan         :\n${order.serviceList}\n` +
    (order.notes ? `Catatan         : ${order.notes}\n` : ``) +
    `━━━━━━━━━━━━━━━━━━━━\n` +
    `🔗 *Aksi Cepat (klik link):*\n` +
    `✅ Terima  → ${responseUrl}?action=accept\n` +
    `❌ Tolak   → ${responseUrl}?action=reject\n` +
    `💬 Form    → ${responseUrl}\n\n` +
    `✏️ *Atau balas WA dengan format:*\n` +
    `📌 Harga: \`${order.orderNumber} [HARGA] [TGL_PICKUP]\`\n` +
    `📌 Terima: \`TERIMA ${order.orderNumber}\`\n` +
    `📌 Tolak:  \`TOLAK ${order.orderNumber}\`\n\n` +
    `Terima kasih 🙏\n` +
    `_Dikirim: ${nowWIB()}_`
  );
}

function getVendorResponseUrl(orderNumber: string): string {
  const domain = getPreferredDomain() || "cstlogistic.co.id";
  const { signVendorResponseToken } = require("./vendorResponseToken") as typeof import("./vendorResponseToken");
  const token = signVendorResponseToken(orderNumber);
  return `https://${domain}/vendor-response/${orderNumber}?t=${token}`;
}

function buildTruckingVendorWaMessage(
  order: LogisticOrderData,
  vendorName: string,
  responseUrl: string,
  contractRate?: number | null,
): string {
  const pickupDate = order.requiredDate ? formatISODate(order.requiredDate) : "";
  const pickupTime = order.jamOrder ? formatJamOrder(order.jamOrder) : "";
  const pickupSchedule = pickupDate
    ? `${pickupDate}${pickupTime ? ` | ${pickupTime} WIB` : ""}`
    : pickupTime ? `${pickupTime} WIB` : "-";

  const grossWeightStr = order.grossWeight
    ? `${order.grossWeight.toLocaleString("id-ID")} KG`
    : "-";

  const contractRateStr = contractRate
    ? `Rp ${Math.round(contractRate).toLocaleString("id-ID")}`
    : null;

  return (
    `🚛 *TRUCKING REQUEST — CST LOGISTICS*\n` +
    `━━━━━━━━━━━━━━━━━━\n` +
    `No. Order: *${order.orderNumber}*\n` +
    `Customer: ${order.companyName || order.customerName}\n` +
    `Route: ${order.origin} → ${order.destination}\n` +
    `Kategori Barang: ${order.commodity || order.cargoDescription || "Umum"}\n` +
    `Gross Weight: ${grossWeightStr}\n` +
    (order.vehicleType ? `Vehicle Type: ${order.vehicleType}\n` : ``) +
    `Pickup Schedule: ${pickupSchedule}\n` +
    (contractRateStr ? `Vendor Contract Rate: ${contractRateStr}\n` : ``) +
    `━━━━━━━━━━━━━━━━━━\n` +
    `📋 *Isi form response vendor di sini:*\n` +
    `${responseUrl}\n\n` +
    `_Klik link di atas, isi status & info armada, lalu submit._\n` +
    `Terima kasih 🙏\n\n` +
    `_Dikirim: ${nowWIB()}_`
  );
}

function getOrderUrl(orderId: number): string {
  const domain = getPreferredDomain() || "cstlogistic.co.id";
  return `https://${domain}/logistic/orders/${orderId}`;
}

function buildAdminGroupWaMessage(order: LogisticOrderData): string {
  const orderUrl = getOrderUrl(order.id);
  const tgl = order.createdAt ? formatTanggal(order.createdAt) : nowWIB();
  const jam = order.jamOrder
    ? formatJamOrder(order.jamOrder)
    : order.createdAt
      ? formatJam(order.createdAt)
      : "";

  const weightLine = order.grossWeight ? `⚖️ Berat    : ${order.grossWeight.toLocaleString("id-ID")} kg\n` : "";
  const volumeLine = order.volumeCbm  ? `📐 Volume   : ${order.volumeCbm} CBM\n` : "";
  const reqDate    = order.requiredDate ? `📅 Tgl Kirim: ${formatISODate(order.requiredDate)}\n` : "";
  const notesLine  = order.notes ? `📝 Catatan  : ${order.notes}\n` : "";

  return (
    `🔔 *[ORDER MASUK] ${order.orderNumber}*\n` +
    `━━━━━━━━━━━━━━━━━━\n` +
    `🏷️ No. Tracking  : \`${order.orderNumber}\`\n` +
    `📆 Tanggal       : ${tgl}${jam ? ` | ${jam} WIB` : ""}\n` +
    `👤 Customer      : *${order.customerName}*${order.companyName ? ` (${order.companyName})` : ""}\n` +
    `📞 HP            : ${order.phone}\n` +
    `📧 Email         : ${order.email}\n` +
    `━━━━━━━━━━━━━━━━━━\n` +
    `🚢 Jenis         : ${order.shipmentType}\n` +
    `📍 Rute          : ${order.origin} → ${order.destination}\n` +
    (order.commodity ? `📦 Komoditi      : ${order.commodity}\n` : "") +
    (order.cargoDescription ? `📋 Deskripsi     : ${order.cargoDescription}\n` : "") +
    weightLine +
    volumeLine +
    reqDate +
    notesLine +
    `━━━━━━━━━━━━━━━━━━\n` +
    `💰 Total Est.    : *Rp ${formatRupiah(order.grandTotal)}*\n` +
    `🔵 Status        : Menunggu Konfirmasi\n` +
    `━━━━━━━━━━━━━━━━━━\n` +
    (orderUrl ? `🔗 *Buka di BizPortal:*\n${orderUrl}\n\n` : "") +
    `_Harap segera diproses. Dikirim: ${nowWIB()}_`
  );
}

function buildCustomerWaMessage(order: LogisticOrderData): string {
  const tgl = order.createdAt ? formatTanggal(order.createdAt) : "";
  const jam = order.jamOrder ?? (order.createdAt ? formatJam(order.createdAt) : "");
  return (
    `✅ *PESANAN ANDA DITERIMA*\n` +
    `━━━━━━━━━━━━━━━━━━\n` +
    `Halo *${order.customerName}*,\n\n` +
    `Terima kasih telah mempercayakan pengiriman Anda kepada CST Logistics.\n\n` +
    `No. Order       : *${order.orderNumber}*\n` +
    (tgl ? `Tanggal         : ${tgl}\n` : ``) +
    (jam ? `Jam             : ${jam}\n` : ``) +
    `Status          : Menunggu Penawaran Harga\n` +
    `Rute            : ${order.origin} → ${order.destination}\n` +
    (order.commodity ? `Kategori Barang : ${order.commodity}\n` : ``) +
    (order.grossWeight ? `Berat           : ${order.grossWeight} kg\n` : ``) +
    (order.volumeCbm ? `Volume          : ${order.volumeCbm} CBM\n` : ``) +
    `Layanan         :\n${order.serviceList}\n` +
    (order.requiredDate ? `Tgl Butuh       : ${order.requiredDate}\n` : ``) +
    `━━━━━━━━━━━━━━━━━━\n` +
    `Tim kami sedang memproses permintaan Anda dan akan segera mengirimkan *penawaran harga terbaik* untuk Anda.\n\n` +
    `📞 Jakarta: (021) 6241234 | Tangerang: (021) 5591234\n\n` +
    `_Dikirim: ${nowWIB()}_`
  );
}

function buildEmailHtml(title: string, intro: string, rows: [string, string][], footer: string): string {
  const rowsHtml = rows
    .map(
      ([label, value]) =>
        `<tr><td style="padding:6px 12px;color:#555;font-weight:600;white-space:nowrap;vertical-align:top">${label}</td>` +
        `<td style="padding:6px 12px;color:#222">${value}</td></tr>`
    )
    .join("");

  return `<!DOCTYPE html>
<html>
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>
<body style="margin:0;padding:0;background:#f4f6f8;font-family:Arial,sans-serif">
<table width="100%" cellpadding="0" cellspacing="0" style="padding:32px 16px">
  <tr><td align="center">
    <table width="600" cellpadding="0" cellspacing="0" style="background:#fff;border-radius:8px;overflow:hidden;box-shadow:0 2px 8px rgba(0,0,0,.08)">
      <tr><td style="background:#1e40af;padding:24px 32px">
        <h1 style="margin:0;color:#fff;font-size:20px">🚢 CST Logistics</h1>
        <p style="margin:4px 0 0;color:#bfdbfe;font-size:14px">${title}</p>
      </td></tr>
      <tr><td style="padding:24px 32px">
        <p style="margin:0 0 20px;color:#374151;font-size:15px">${intro}</p>
        <table width="100%" cellpadding="0" cellspacing="0" style="border:1px solid #e5e7eb;border-radius:6px;overflow:hidden">
          ${rowsHtml}
        </table>
        <p style="margin:24px 0 0;color:#6b7280;font-size:13px">${footer}</p>
      </td></tr>
      <tr><td style="background:#f9fafb;padding:16px 32px;border-top:1px solid #e5e7eb">
        <p style="margin:0;color:#9ca3af;font-size:12px">CST Logistics — Jln. Ternate No. 10B/C, Jakarta 10150</p>
      </td></tr>
    </table>
  </td></tr>
</table>
</body>
</html>`;
}

async function notifyAdmin(order: LogisticOrderData): Promise<void> {
  const rows: [string, string][] = [
    ["No. Order", `<strong>${order.orderNumber}</strong>`],
    ["Customer", `${order.customerName}${order.companyName ? ` (${order.companyName})` : ""}`],
    ["Email", order.email],
    ["HP", order.phone],
    ["Jenis", order.shipmentType],
    ["Rute", `${order.origin} → ${order.destination}`],
    ...(order.commodity ? [["Komoditi", order.commodity] as [string, string]] : []),
    ...(order.cargoDescription ? [["Deskripsi", order.cargoDescription] as [string, string]] : []),
    ...(order.grossWeight ? [["Berat", `${order.grossWeight} kg`] as [string, string]] : []),
    ...(order.volumeCbm ? [["Volume", `${order.volumeCbm} CBM`] as [string, string]] : []),
    ["Layanan", order.serviceList.replace(/\n/g, "<br>")],
    ["Total Est.", `Rp ${formatRupiah(order.grandTotal)}`],
    ...(order.requiredDate ? [["Tgl Butuh", order.requiredDate] as [string, string]] : []),
    ...(order.notes ? [["Catatan", order.notes] as [string, string]] : []),
  ];

  const adminWa = await getAdminWa();
  if (adminWa) {
    logger.info({ phone: adminWa, orderNumber: order.orderNumber }, "Sending admin WA notification");
    sendWhatsApp(adminWa, buildAdminWaMessage(order)).catch((err: unknown) =>
      logger.error({ err }, "WA admin notification failed")
    );
  } else {
    logger.warn("Admin WA target not configured — skipping (set FONNTE_ADMIN_WA or configure via admin panel)");
  }

  // Send to admin WhatsApp group if configured
  const adminGroupWa = await getAdminGroupWa();
  if (adminGroupWa) {
    logger.info({ groupId: adminGroupWa, orderNumber: order.orderNumber }, "Sending group WA notification");
    sendWhatsApp(adminGroupWa, buildAdminGroupWaMessage(order)).catch((err: unknown) =>
      logger.error({ err }, "WA group notification failed")
    );
  } else {
    logger.info("Admin WA group not configured — skipping (set FONNTE_ADMIN_GROUP_ID or configure via admin panel)");
  }

  if (isSmtpConfigured()) {
    logger.info({ to: ADMIN_EMAIL, orderNumber: order.orderNumber }, "Sending admin email notification");
    sendMail({
      to: ADMIN_EMAIL,
      subject: `[ORDER BARU] ${order.orderNumber} — ${order.customerName}`,
      html: buildEmailHtml(
        "Order Logistik Baru Masuk",
        `Order baru telah diterima dari <strong>${order.customerName}</strong>. Silakan login ke sistem untuk memproses.`,
        rows,
        (() => { const d = getPreferredDomain() || "cstlogistic.co.id"; return `Login ke sistem: <a href="https://${d}/logistic-order">https://${d}/logistic-order</a>`; })()
      ),
      text:
        `ORDER BARU: ${order.orderNumber}\n` +
        `Customer: ${order.customerName} (${order.companyName})\n` +
        `Rute: ${order.origin} → ${order.destination}\n` +
        `Jenis: ${order.shipmentType}\n` +
        `Total: Rp ${formatRupiah(order.grandTotal)}`,
    })
      .then(() => logger.info({ to: ADMIN_EMAIL, orderNumber: order.orderNumber }, "Admin email sent successfully"))
      .catch((err: unknown) => logger.error({ err, to: ADMIN_EMAIL }, "Email admin notification failed"));
  } else {
    logger.warn("SMTP not configured — skipping admin email");
  }
}

async function notifyVendors(order: LogisticOrderData): Promise<void> {
  // Guard: skip if shipmentType is empty — ilike('%%') would match ALL vendors
  if (!order.shipmentType || !order.shipmentType.trim()) {
    logger.warn({ orderNumber: order.orderNumber }, "notifyVendors: shipmentType is empty — skipping vendor notification to prevent all-vendor spam");
    return;
  }

  const isTrucking = order.shipmentType?.toLowerCase().includes("trucking");

  // Only notify vendors who explicitly have a matching serviceType.
  // Vendors with serviceType = null are purchase-only suppliers and must NOT receive logistics notifications.
  const vendors = await db
    .select()
    .from(suppliersTable)
    .where(
      and(
        eq(suppliersTable.isActive, true),
        ilike(suppliersTable.serviceType, `%${order.shipmentType}%`)
      )
    );

  logger.info(
    { shipmentType: order.shipmentType, candidateCount: vendors.length, vendors: vendors.map((v) => ({ id: v.id, name: v.name, serviceType: v.serviceType, hasPhone: !!v.phone })) },
    "Vendor candidates for order notification"
  );

  const eligible = vendors.filter((v) => v.contactEmail || v.phone);
  if (eligible.length === 0) {
    logger.info({ shipmentType: order.shipmentType }, "No vendors with contact info found for order type");
    return;
  }

  const rows: [string, string][] = [
    ["No. Order", `<strong>${order.orderNumber}</strong>`],
    ["Jenis", order.shipmentType],
    ["Rute", `${order.origin} → ${order.destination}`],
    ...(order.commodity ? [["Komoditi", order.commodity] as [string, string]] : []),
    ...(order.cargoDescription ? [["Deskripsi", order.cargoDescription] as [string, string]] : []),
    ...(order.grossWeight ? [["Berat", `${order.grossWeight} kg`] as [string, string]] : []),
    ...(order.volumeCbm ? [["Volume", `${order.volumeCbm} CBM`] as [string, string]] : []),
    ...(order.vehicleType ? [["Vehicle Type", order.vehicleType] as [string, string]] : []),
    ["Layanan", order.serviceList.replace(/\n/g, "<br>")],
    ...(order.requiredDate ? [["Tgl Pickup", formatISODate(order.requiredDate)] as [string, string]] : []),
    ...(order.notes ? [["Catatan", order.notes] as [string, string]] : []),
  ];

  for (const vendor of eligible) {
    // Fetch vendor catalog price (for trucking: match by vehicle type name)
    let contractRate: number | null = null;
    if (isTrucking) {
      const catalogItems = await db
        .select()
        .from(vendorCatalogItemsTable)
        .where(and(eq(vendorCatalogItemsTable.vendorId, vendor.id), eq(vendorCatalogItemsTable.isActive, true)));
      const match = order.vehicleType
        ? catalogItems.find((c) => c.name.toLowerCase().includes(order.vehicleType!.toLowerCase()))
        : null;
      contractRate = match
        ? Number(match.priceBase)
        : catalogItems[0] ? Number(catalogItems[0].priceBase) : null;
    }

    if (vendor.phone) {
      const longResponseUrl = getVendorResponseUrl(order.orderNumber);
      const responseUrl = isTrucking
        ? await generateShortLink(longResponseUrl, { context: "vendor_response", refType: "order", refId: order.orderNumber })
        : longResponseUrl;
      const msg = isTrucking
        ? buildTruckingVendorWaMessage(order, vendor.name, responseUrl, contractRate)
        : buildVendorWaMessage(order, vendor.name);
      sendWhatsApp(vendor.phone, msg).catch((err: unknown) =>
        logger.error({ err, vendorId: vendor.id }, "WA vendor notification failed")
      );
    }

    if (vendor.contactEmail && isSmtpConfigured()) {
      const draftReplyHtml = isTrucking
        ? `<div style="margin-top:24px;background:#f0f9ff;border:1px solid #bae6fd;border-radius:6px;padding:16px 20px">` +
          `<p style="margin:0 0 12px;font-weight:700;color:#0369a1;font-size:14px">📋 Response Form — Isi dan Balas Email Ini</p>` +
          `<pre style="background:#1e293b;color:#e2e8f0;padding:10px 14px;border-radius:4px;font-size:13px;margin:0">` +
          `Status: READY\nEstimated Pickup Time: \nDriver Name: \nDriver Phone: \nPlate Number: \nUnit Type: \nNotes: ` +
          `</pre></div>`
        : `<div style="margin-top:24px;background:#f0f9ff;border:1px solid #bae6fd;border-radius:6px;padding:16px 20px">` +
          `<p style="margin:0 0 12px;font-weight:700;color:#0369a1;font-size:14px">✏️ Draft Balasan — Tinggal Copy, Isi Harga, Lalu Balas Email Ini</p>` +
          `<p style="margin:0 0 8px;color:#374151;font-size:13px"><strong>Opsi 1 — Kirim Penawaran Harga:</strong></p>` +
          `<pre style="background:#1e293b;color:#e2e8f0;padding:10px 14px;border-radius:4px;font-size:13px;margin:0 0 12px">${order.orderNumber} [HARGA] [TGL_PICKUP] [TGL_KIRIM]\n\nContoh:\n${order.orderNumber} 5500000 15-Mei 20-Mei</pre>` +
          `<p style="margin:0 0 8px;color:#374151;font-size:13px"><strong>Opsi 2 — Terima Pesanan:</strong></p>` +
          `<pre style="background:#1e293b;color:#e2e8f0;padding:10px 14px;border-radius:4px;font-size:13px;margin:0 0 12px">TERIMA ${order.orderNumber}</pre>` +
          `<p style="margin:0 0 8px;color:#374151;font-size:13px"><strong>Opsi 3 — Tolak Pesanan:</strong></p>` +
          `<pre style="background:#1e293b;color:#e2e8f0;padding:10px 14px;border-radius:4px;font-size:13px;margin:0">TOLAK ${order.orderNumber}</pre>` +
          `</div>`;

      sendMail({
        to: vendor.contactEmail,
        subject: isTrucking
          ? `[TRUCKING REQUEST] ${order.orderNumber} — ${order.origin} → ${order.destination}`
          : `[PERMINTAAN ORDER] ${order.orderNumber} — ${order.shipmentType}`,
        html: buildEmailHtml(
          isTrucking ? "Trucking Request Form" : "Permintaan Order Baru dari CST Logistics",
          `Kepada Yth. <strong>${vendor.name}</strong>,<br><br>${isTrucking ? "Ada permintaan trucking baru. Mohon lengkapi form di bawah dan balas email ini." : "Anda mendapat permintaan pengiriman baru dari CST Logistics. Silakan balas email ini dengan salah satu format di bawah."}`,
          rows,
          isTrucking ? "Balas email ini dengan form response yang sudah diisi." : "Balas email ini langsung dengan format penawaran di bawah ini."
        ).replace(
          `</td></tr>\n    </table>\n  </td></tr>`,
          `${draftReplyHtml}</td></tr>\n    </table>\n  </td></tr>`
        ),
        text: isTrucking
          ? `TRUCKING REQUEST: ${order.orderNumber}\nRute: ${order.origin} → ${order.destination}\n` +
            (order.vehicleType ? `Vehicle: ${order.vehicleType}\n` : ``) +
            (contractRate ? `Contract Rate: Rp ${Math.round(contractRate).toLocaleString("id-ID")}\n` : ``) +
            `\n=== RESPONSE FORM ===\nStatus: READY\nEstimated Pickup Time:\nDriver Name:\nDriver Phone:\nPlate Number:\nUnit Type:\nNotes:`
          : `PERMINTAAN ORDER: ${order.orderNumber}\nJenis: ${order.shipmentType}\nRute: ${order.origin} → ${order.destination}\n\n` +
            `Opsi 1 - Kirim Penawaran Harga:\n${order.orderNumber} [HARGA] [TGL_PICKUP] [TGL_KIRIM]\n` +
            `Opsi 2 - Terima Pesanan:\nTERIMA ${order.orderNumber}\n` +
            `Opsi 3 - Tolak Pesanan:\nTOLAK ${order.orderNumber}`,
      }).catch((err: unknown) => logger.error({ err, vendorId: vendor.id }, "Email vendor notification failed"));
    } else if (vendor.contactEmail) {
      logger.warn({ vendorId: vendor.id }, "SMTP not configured — skipping vendor email");
    }
  }
}

async function notifyCustomer(order: LogisticOrderData): Promise<void> {
  if (order.phone) {
    sendWhatsApp(order.phone, buildCustomerWaMessage(order)).catch((err: unknown) =>
      logger.error({ err, phone: order.phone }, "WA customer notification failed")
    );
  }

  const rows: [string, string][] = [
    ["No. Order", `<strong>${order.orderNumber}</strong>`],
    ["Status", "<span style='color:#d97706;font-weight:600'>Menunggu Penawaran Harga</span>"],
    ["Jenis", order.shipmentType],
    ["Rute", `${order.origin} → ${order.destination}`],
    ...(order.commodity ? [["Komoditi", order.commodity] as [string, string]] : []),
    ...(order.grossWeight ? [["Berat", `${order.grossWeight} kg`] as [string, string]] : []),
    ...(order.volumeCbm ? [["Volume", `${order.volumeCbm} CBM`] as [string, string]] : []),
    ["Layanan", order.serviceList.replace(/\n/g, "<br>")],
    ...(order.requiredDate ? [["Tgl Butuh", order.requiredDate] as [string, string]] : []),
  ];

  if (isSmtpConfigured()) {
    sendMail({
      to: order.email,
      subject: `Permintaan Diterima — ${order.orderNumber}`,
      html: buildEmailHtml(
        "Permintaan Pengiriman Diterima",
        `Halo <strong>${order.customerName}</strong>,<br><br>Terima kasih telah mempercayakan pengiriman Anda kepada CST Logistics. Tim kami sedang memproses permintaan Anda dan akan segera mengirimkan penawaran harga terbaik untuk Anda.`,
        rows,
        "Gunakan nomor order di atas untuk tracking. Hubungi kami di: <strong>(021) 6241234</strong>"
      ),
      text:
        `Permintaan Diterima!\n` +
        `No. Order: ${order.orderNumber}\n` +
        `Status: Menunggu Penawaran Harga\n` +
        `Rute: ${order.origin} → ${order.destination}\n\n` +
        `Tim kami sedang memproses permintaan Anda dan akan segera mengirimkan penawaran harga.`,
    }).then(() => logger.info({ email: order.email, orderNumber: order.orderNumber }, "Customer email sent successfully"))
      .catch((err: unknown) => logger.error({ err, email: order.email }, "Email customer notification failed"));
  } else {
    logger.warn("SMTP not configured — skipping customer email");
  }
}

export async function sendLogisticOrderNotification(order: LogisticOrderData): Promise<void> {
  await Promise.allSettled([
    notifyAdmin(order),
    notifyCustomer(order),
  ]);
}
