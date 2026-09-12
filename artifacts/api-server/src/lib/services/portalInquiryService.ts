/**
 * Portal Inquiry Service
 *
 * Business logic for catalog inquiry / lead-generation submissions.
 * Sends WhatsApp notifications to admin and the enquiring customer.
 *
 * Controller (portal.ts) handles HTTP, rate-limiting, and request parsing.
 */

import { sendViaService as sendWhatsApp } from "../waTransport.js";
import { getAdminWa } from "../adminWa.js";
import { getAppConfig } from "../appConfig.js";

// ─── Types ───────────────────────────────────────────────────────────────────

export interface CatalogInquiryPayload {
  name: string;
  email?: string;
  whatsapp: string;
  itemName: string;
  itemType?: string;
  vendorName?: string;
  kategori?: string;
  quantity?: string | number;
  unit?: string;
  notes?: string;
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function normalizeWaNumber(raw: string): string {
  const cleaned = String(raw).replace(/\D/g, "");
  return cleaned.startsWith("0") ? "62" + cleaned.slice(1) : cleaned;
}

// ─── Public API ──────────────────────────────────────────────────────────────

/**
 * Validates, builds WA messages, and dispatches notifications for a catalog inquiry.
 * Throws with a `status` property on validation failure.
 */
export async function submitCatalogInquiry(
  body: Partial<CatalogInquiryPayload>,
  log?: { warn: (obj: unknown, msg: string) => void },
): Promise<void> {
  const { name, email, whatsapp, itemName, itemType, vendorName, kategori, quantity, unit, notes } = body;

  if (!name || !whatsapp || !itemName) {
    const err = new Error("Nama, WhatsApp, dan item wajib diisi") as Error & { status: number };
    err.status = 400;
    throw err;
  }

  const appName = await getAppConfig("APP_NAME", "B2B Marketplace and Logistic");
  const adminWa  = await getAdminWa();

  const adminMsg = [
    `📋 *PERMINTAAN PENAWARAN KATALOG*`,
    ``,
    `👤 *Nama:* ${name}`,
    email      ? `📧 *Email:* ${email}`                                           : null,
    `📱 *WhatsApp:* ${whatsapp}`,
    ``,
    `📦 *Item:* ${itemName}`,
    itemType   ? `🏷️ *Tipe:* ${itemType === "service" ? "Layanan" : "Produk"}`    : null,
    vendorName ? `🏢 *Vendor:* ${vendorName}`                                     : null,
    kategori   ? `📁 *Kategori:* ${kategori}`                                     : null,
    quantity   ? `🔢 *Qty:* ${quantity}${unit ? " " + unit : ""}`                 : null,
    notes      ? `📝 *Catatan:* ${notes}`                                         : null,
  ].filter(Boolean).join("\n");

  const customerMsg = [
    `Halo ${name}! 👋`,
    ``,
    `Terima kasih atas permintaan penawaran Anda untuk *${itemName}*.`,
    ``,
    `Tim kami akan segera menghubungi Anda melalui WhatsApp ini untuk mendiskusikan kebutuhan Anda lebih lanjut.`,
    ``,
    `_${appName}_`,
  ].join("\n");

  try {
    if (adminWa) await sendWhatsApp(adminWa, adminMsg);
    const waNum = normalizeWaNumber(whatsapp);
    if (waNum.length >= 10) await sendWhatsApp(waNum + "@s.whatsapp.net", customerMsg);
  } catch (waErr) {
    log?.warn({ waErr }, "WA notification failed for catalog-inquiry");
  }
}
