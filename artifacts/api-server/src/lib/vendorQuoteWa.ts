import { sendViaService as sendWhatsApp } from "./waTransport.js";
import { generateShortLink } from "./shortLink.js";
import { logger } from "./logger.js";
import { getWaTemplateConfig, renderTemplate, deriveServiceType, buildCommodityContext, buildServiceContext } from "./orderNotification.js";

const TZ = "Asia/Jakarta";

function formatTanggal(d: Date | string): string {
  const date = typeof d === "string" ? new Date(d) : d;
  if (isNaN(date.getTime())) return "";
  return new Intl.DateTimeFormat("id-ID", {
    timeZone: TZ, day: "2-digit", month: "long", year: "numeric",
  }).format(date);
}

function formatJam(d: Date | string): string {
  const date = typeof d === "string" ? new Date(d) : d;
  if (isNaN(date.getTime())) return "";
  return new Intl.DateTimeFormat("id-ID", {
    timeZone: TZ, hour: "2-digit", minute: "2-digit", hour12: false,
  }).format(date).replace(":", ".");
}

const fmtRp = (n: number) => `Rp ${Math.round(n).toLocaleString("id-ID")}`;

export interface VendorQuoteOrderItem {
  serviceName: string;
  category: string;
  subtotal?: number | null;
  quantity?: number | null;
  unit?: string | null;
  sellingUnitPrice?: number | null;
}

export interface VendorQuoteMessageInput {
  rfqNumber: string;
  orderNumber: string;
  vendorName: string;
  origin?: string;
  destination?: string;
  vehicleType?: string | null;
  commodity?: string | null;
  grossWeight?: number | null;
  volumeCbm?: number | null;
  requiredDate?: string | null;
  notes?: string | null;
  vendorBasePrice?: number | null;
  createdAt?: Date | string | null;
  jamOrder?: string | null;
  shortLinkUrl: string;
  orderItems?: VendorQuoteOrderItem[] | null;
  isTrucking?: boolean;
  orderType?: string | null;
  templateSnapshot?: Record<string, unknown> | null;
}

/**
 * Extract key spec lines from a stored templateSnapshot for WA messages.
 * Handles both product templates (customFields) and service templates (fields/checklist).
 */
function buildTemplateSpecBlock(snapshot: Record<string, unknown> | null | undefined): string {
  if (!snapshot) return "";
  try {
    const isService = snapshot["templateKind"] === "service";
    const label = typeof snapshot["label"] === "string" ? snapshot["label"] : "";
    const category = typeof snapshot["category"] === "string" ? snapshot["category"] : "";
    const sourceFields = isService
      ? (Array.isArray(snapshot["fields"]) ? snapshot["fields"] as Array<Record<string, unknown>> : [])
      : (Array.isArray(snapshot["customFields"]) ? snapshot["customFields"] as Array<Record<string, unknown>> : []);
    const requiredDocs = Array.isArray(snapshot["requiredDocuments"]) ? snapshot["requiredDocuments"] as Array<Record<string, unknown>> : [];
    const checklist = isService
      ? (Array.isArray(snapshot["checklist"]) ? snapshot["checklist"] as Array<Record<string, unknown>> : [])
      : [];

    const requiredFields = isService
      ? sourceFields.filter(f => f["required"] === true && !f["isUpload"])
      : sourceFields.filter(f => f["required"] === true);
    const topFields = requiredFields.slice(0, 5);

    if (!topFields.length && !requiredDocs.length && !checklist.length) return "";

    const title = isService ? `Layanan: *${label}*` : (label || category);
    const header = `\n📋 *Spesifikasi ${title}:*\n`;
    const fieldLines = topFields.map(f => {
      const unit = f["unit"] ? ` (${f["unit"]})` : "";
      return `   • ${f["label"]}${unit}: _[wajib diisi]_`;
    }).join("\n");

    const reqDocs = requiredDocs.filter(d => d["required"] === true);
    const docLines = reqDocs.length
      ? `\n📄 *Dokumen Wajib:*\n` + reqDocs.map(d => `   • ${d["label"]}`).join("\n")
      : "";

    const checklistLines = checklist.length
      ? `\n✅ *Checklist:*\n` + checklist.map(c => `   ☐ ${c["label"]}`).join("\n")
      : "";

    return header + fieldLines + (fieldLines && (docLines || checklistLines) ? "\n" : "") + docLines + checklistLines + "\n";
  } catch { return ""; }
}

/**
 * Build a clean, modern mini-card WhatsApp message for vendor quote requests.
 */
export function generateVendorQuoteMessage(input: VendorQuoteMessageInput): string {
  const tgl = input.createdAt ? formatTanggal(input.createdAt) : "";
  const jam = input.jamOrder ?? (input.createdAt ? formatJam(input.createdAt) : "");

  const routeLine = input.origin && input.destination
    ? `📍 Rute       : ${input.origin} → ${input.destination}\n`
    : "";
  const vehicleLine = input.vehicleType ? `🚚 Unit       : ${input.vehicleType}\n` : "";
  const cargoLines = [
    input.commodity ? `📦 Komoditi   : ${input.commodity}\n` : "",
    input.grossWeight ? `⚖️  Berat      : ${input.grossWeight} kg\n` : "",
    input.volumeCbm ? `📐 Volume     : ${input.volumeCbm} CBM\n` : "",
    input.requiredDate ? `📅 Tgl Butuh  : ${input.requiredDate}\n` : "",
    input.notes ? `📝 Catatan    : ${input.notes}\n` : "",
  ].join("");

  // Produk/layanan yang dipesan customer — tampilkan qty, harga jual/unit, total
  const itemsBlock = input.orderItems && input.orderItems.length > 0
    ? `\n🛒 *Produk Dipesan:*\n` +
      input.orderItems.map((it) => {
        const qty = it.quantity ?? 1;
        const unit = it.unit ?? "Unit";
        const lines: string[] = [`   • ${it.serviceName}`];
        lines.push(`     Qty: ${qty} ${unit}`);
        if (it.sellingUnitPrice != null && it.sellingUnitPrice > 0) {
          lines.push(`     Harga Jual/Unit: ${fmtRp(it.sellingUnitPrice)}`);
          lines.push(`     Total: ${fmtRp(it.sellingUnitPrice * qty)}`);
        } else if (it.subtotal != null && it.subtotal > 0) {
          lines.push(`     Total: ${fmtRp(it.subtotal)}`);
        }
        return lines.join("\n");
      }).join("\n\n") + "\n"
    : "";

  const truckingDateBlock = input.isTrucking && (tgl || jam)
    ? `📅 Tgl Order  : ${tgl}\n` +
      (jam ? `🕐 Jam Order  : ${jam}\n` : "")
    : "";

  const priceBlock = input.vendorBasePrice != null
    ? `\n💰 *Harga Vendor:*\n${fmtRp(input.vendorBasePrice)}\n`
    : "";

  const templateSpecBlock = buildTemplateSpecBlock(input.templateSnapshot);

  return (
    `📦 *PERMINTAAN PENAWARAN VENDOR*\n` +
    `━━━━━━━━━━━━━━━━━━\n` +
    `Kepada Yth. *${input.vendorName}*,\n\n` +
    `No. RFQ    : *${input.rfqNumber}*\n` +
    `No. Order  : ${input.orderNumber}\n` +
    (!input.isTrucking && tgl ? `Tanggal    : ${tgl}\n` : "") +
    (!input.isTrucking && jam ? `Jam        : ${jam}\n` : "") +
    truckingDateBlock +
    routeLine +
    vehicleLine +
    cargoLines +
    itemsBlock +
    templateSpecBlock +
    priceBlock +
    `\n📝 Silakan isi harga & estimasi melalui tombol berikut.\n\n` +
    `🔗 *[ ISI PENAWARAN VENDOR ]*\n` +
    `👉 ${input.shortLinkUrl}\n\n` +
    `━━━━━━━━━━━━━━━━━━\n` +
    `Terima kasih atas kerja sama Anda 🙏\n` +
    `_B2B Marketplace and Logistic_`
  );
}

export interface SendVendorWhatsAppInput {
  vendorPhone: string;
  vendorName: string;
  vendorId: number;
  rfqNumber: string;
  orderId: number;
  orderNumber: string;
  longUrl: string;
  origin?: string;
  destination?: string;
  vehicleType?: string | null;
  commodity?: string | null;
  grossWeight?: number | null;
  volumeCbm?: number | null;
  requiredDate?: string | null;
  notes?: string | null;
  vendorBasePrice?: number | null;
  createdAt?: Date | string | null;
  jamOrder?: string | null;
  orderItems?: VendorQuoteOrderItem[] | null;
  isTrucking?: boolean;
  orderType?: string | null;
  templateSnapshot?: Record<string, unknown> | null;
}

/**
 * Reusable end-to-end helper:
 *   1. shortens the long vendor-quote URL into /q/<code>
 *   2. renders vendor_request template from Settings (DB) or default
 *   3. sends via Fonnte (with notification log)
 */
export async function sendVendorWhatsApp(input: SendVendorWhatsAppInput): Promise<void> {
  if (!input.vendorPhone?.trim()) {
    logger.warn({ vendorId: input.vendorId }, "sendVendorWhatsApp: empty phone, skip");
    return;
  }
  const shortLinkUrl = await generateShortLink(input.longUrl, {
    context: "vendor_quote",
    refType: "rfq",
    refId: input.rfqNumber,
  });

  const defaultTpl = generateVendorQuoteMessage({ ...input, shortLinkUrl, templateSnapshot: input.templateSnapshot });

  const tplBody = await getWaTemplateConfig("vendor", "vendor_request", defaultTpl);

  const svcType = deriveServiceType(
    input.vehicleType ?? input.orderItems?.[0]?.category ?? "",
    input.orderType ?? undefined,
  );
  const tgl = input.createdAt ? formatTanggal(input.createdAt) : null;
  const jam = input.jamOrder ?? (input.createdAt ? formatJam(input.createdAt) : null);

  const productList: string | null = (() => {
    if (!input.orderItems?.length) return null;
    const items = svcType === "product"
      ? input.orderItems
      : input.orderItems.filter((it) => {
          const cat = (it.category ?? "").toLowerCase();
          return cat.includes("product") || cat.includes("produk");
        });
    if (!items.length) return null;
    return items
      .map((it) => {
        const qty = it.quantity ?? 1;
        const unit = it.unit ?? "Unit";
        const lines: string[] = [`• ${it.serviceName}`];
        lines.push(`  Qty: ${qty} ${unit}`);
        if (it.sellingUnitPrice != null && it.sellingUnitPrice > 0) {
          lines.push(`  Harga Jual/Unit: ${fmtRp(it.sellingUnitPrice)}`);
          lines.push(`  Total: ${fmtRp(it.sellingUnitPrice * qty)}`);
        } else if (it.subtotal != null && it.subtotal > 0) {
          lines.push(`  Total: ${fmtRp(it.subtotal)}`);
        }
        return lines.join("\n");
      })
      .join("\n\n");
  })();

  const conditions: string[] = svcType ? [svcType] : [];
  if (productList && !conditions.includes("product")) conditions.push("product");

  // Build commodity + service context from templateSnapshot — never exposes base price/margin
  const firstItem = input.orderItems?.[0];
  const commodityCtx = buildCommodityContext(input.templateSnapshot ?? null, {
    quantity: firstItem?.quantity ?? null,
    unit: firstItem?.unit ?? null,
  });
  const serviceCtx = buildServiceContext(input.templateSnapshot ?? null);

  const vars: Record<string, string | null | undefined> = {
    rfqNumber: input.rfqNumber,
    orderNumber: input.orderNumber,
    vendorName: input.vendorName,
    route: input.origin && input.destination ? `${input.origin} → ${input.destination}` : null,
    origin: input.origin ?? null,
    destination: input.destination ?? null,
    shipmentType: input.vehicleType ?? null,
    vehicleType: input.vehicleType ?? null,
    commodity: input.commodity ?? null,
    cargoDescription: null,
    grossWeightDisplay: input.grossWeight ? `${input.grossWeight} kg` : null,
    volumeDisplay: input.volumeCbm ? `${input.volumeCbm} CBM` : null,
    requiredDate: input.requiredDate ?? null,
    notes: input.notes ?? null,
    vendorMiniFormLink: shortLinkUrl,
    vendorBasePrice: input.vendorBasePrice != null ? fmtRp(input.vendorBasePrice) : null,
    productList,
    tanggal: tgl,
    jam,
    timestamp: new Date().toLocaleString("id-ID", { timeZone: "Asia/Jakarta" }),
    ...commodityCtx,
    ...serviceCtx,
  };

  const message = renderTemplate(tplBody, vars, conditions);
  await sendWhatsApp(input.vendorPhone, message, {
    context: "vendor_quote",
    refType: "rfq",
    refId: input.rfqNumber,
  });
}
