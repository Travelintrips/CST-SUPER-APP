import { db, suppliersTable, vendorCatalogItemsTable, waTemplateConfigsTable, logisticOrderRfqsTable, vendorMiniFormLinksTable } from "@workspace/db";
import { eq, and, ilike, sql, desc } from "drizzle-orm";
import { sendViaService as sendWhatsApp, sendMediaViaService } from "./waTransport.js";
import { getAdminGroupWa, getAdminWa, getAdminPhones } from "./adminWa";
import { getPreferredDomain } from "./domain";
import { sendMail, isSmtpConfigured } from "./mailer";
import { logger } from "./logger";
import { generateShortLink } from "./shortLink";
import { TAX_RATE_DECIMAL as PPN_RATE, TAX_RATE_PCT } from "./taxHelper.js";

const ADMIN_EMAIL = process.env.ADMIN_EMAIL ?? "admcst001@gmail.com";

export interface LogisticOrderData {
  id: number;
  orderNumber: string;
  customerName: string;
  companyName: string;
  email: string;
  phone: string;
  orderType?: string;
  shipmentType: string;
  origin: string;
  destination: string;
  commodity?: string | null;
  cargoDescription?: string | null;
  grossWeight?: number | null;
  volumeCbm?: number | null;
  jumlahKoli?: number | null;
  subtotal?: number | null;
  tax?: number | null;
  grandTotal: number;
  serviceList: string;
  orderItems?: Array<{ name: string; qty?: number | null; unit?: string | null; subtotal?: number | null }> | null;
  requiredDate?: string | null;
  notes?: string | null;
  jamOrder?: string | null;
  vehicleType?: string | null;
  createdAt?: Date | string | null;
  publicRfqToken?: string | null;
  trackingToken?: string | null;
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

// ─── WA Template Engine ────────────────────────────────────────────────────────

// ── WA Template Rendering ──────────────────────────────────────────────────────
//
// Template bodies are stored in wa_template_configs (recipient × workflow key).
// Falls back to DEFAULT_TPL if no DB record exists.
//
// Rendering pipeline:
//   1. resolveCondBlocks()  — removes {{#if X}}...{{/if}} blocks that don't match serviceType
//   2. renderTemplate()     — substitutes {{variable}} values; omits lines with null/empty vars
//   3. Collapse triple-newlines created by removed conditional blocks
//
// serviceType keys (from deriveServiceType):
//   "trucking" | "freight_sea" | "freight_air" | "ppjk" | "product" | "handling" | ""

/** Map shipmentType text → service type key used in {{#if X}} blocks */
export function deriveServiceType(shipmentType: string, orderType?: string): string {
  if (orderType === "product") return "product";
  const t = (shipmentType ?? "").toLowerCase();
  if (t.includes("trucking") || t.includes("truk")) return "trucking";
  if (t.includes("sea") || t.includes("laut") || t.includes("fcl") || t.includes("lcl")) return "freight_sea";
  if (t.includes("air") || t.includes("udara")) return "freight_air";
  if (t.includes("ppjk") || t.includes("customs") || t.includes("kepabeanan") || t.includes("bea cukai")) return "ppjk";
  if (t.includes("product") || t.includes("produk")) return "product";
  if (t.includes("handling")) return "handling";
  return "";
}

/** Resolve {{#if serviceTypeKey}}...{{/if}} conditional blocks.
 *  Blocks whose key matches serviceType are kept (content only); others are removed entirely. */
export function resolveCondBlocks(body: string, serviceType: string | string[]): string {
  const types = Array.isArray(serviceType) ? serviceType : [serviceType];
  return body.replace(/\{\{#if\s+(\w+)\}\}([\s\S]*?)\{\{\/if\}\}/g, (_m, cond, content: string) =>
    types.some(t => t && cond === t) ? content : ""
  );
}

/**
 * Render a {{variable}} template. Lines containing a variable whose value is
 * empty/null are omitted from the output (optional-field pattern).
 * Empty lines (no variables) are always kept.
 * Supports {{#if serviceType}}...{{/if}} conditional blocks (resolved before var substitution).
 *
 * Example:
 *   template:  "Harga: {{price}}\nRute: {{route}}"
 *   vars:      { price: null, route: "JKT → SBY" }
 *   result:    "Rute: JKT → SBY"   ← "Harga" line omitted because price is null
 */
export function renderTemplate(
  template: string,
  vars: Record<string, string | null | undefined>,
  serviceType: string | string[] = "",
): string {
  // Step 1: Remove {{#if X}}...{{/if}} blocks that don't match serviceType
  const resolved = resolveCondBlocks(template, serviceType);
  const lines = resolved.split("\n");
  const result: string[] = [];
  for (const line of lines) {
    const matches = [...line.matchAll(/\{\{(\w+)\}\}/g)];
    // Lines with no variables are always kept (static text / section headers)
    if (matches.length === 0) { result.push(line); continue; }
    let skip = false;
    let rendered = line;
    for (const m of matches) {
      const val = vars[m[1]];
      // If any variable in the line is null/empty → omit the entire line
      if (val == null || val === "") { skip = true; break; }
      rendered = rendered.replaceAll(`{{${m[1]}}}`, val);
    }
    if (!skip) result.push(rendered);
  }
  // Step 2: Collapse triple-newlines left by removed conditional blocks
  return result.join("\n").replace(/\n{3,}/g, "\n\n").trim();
}

function buildOrderVars(
  order: LogisticOrderData,
  extras: Record<string, string | null | undefined> = {},
): Record<string, string | null | undefined> {
  const tgl = order.createdAt ? formatTanggal(order.createdAt) : null;
  const jam = order.jamOrder
    ? formatJamOrder(order.jamOrder)
    : order.createdAt ? formatJam(order.createdAt) : null;

  const isProduct = order.orderType === "product";

  const route = (order.origin && order.destination)
    ? `${order.origin} → ${order.destination}`
    : order.origin || order.destination || null;

  const productList: string | null = (() => {
    if (order.orderItems?.length) {
      return order.orderItems.map(i => {
        const qtyStr = (i.qty != null && i.qty > 1)
          ? ` (${i.qty} ${i.unit ?? "Unit"})`
          : (i.qty === 1 ? ` (1 ${i.unit ?? "Unit"})` : "");
        const price = (i.subtotal != null && i.subtotal > 0)
          ? ` — Rp ${i.subtotal.toLocaleString("id-ID")}`
          : "";
        return `• ${i.name}${qtyStr}${price}`;
      }).join("\n");
    }
    if (isProduct && order.serviceList) {
      return order.serviceList;
    }
    return null;
  })();

  const productListNoPrice: string | null = (() => {
    if (order.orderItems?.length) {
      return order.orderItems.map(i => {
        const qtyStr = (i.qty != null && i.qty > 0)
          ? ` (${i.qty} ${i.unit ?? "Unit"})`
          : "";
        return `• ${i.name}${qtyStr}`;
      }).join("\n");
    }
    if (isProduct && order.serviceList) {
      return order.serviceList;
    }
    return null;
  })();

  const productListDetail: string | null = (() => {
    if (!order.orderItems?.length) {
      if (isProduct && order.serviceList) return order.serviceList;
      // Fallback untuk semua tipe order: tampilkan info kargo/komoditi
      const parts: string[] = [];
      if (order.commodity)       parts.push(`• Komoditi      : ${order.commodity}`);
      if (order.cargoDescription) parts.push(`• Kargo         : ${order.cargoDescription}`);
      if (order.grossWeight)     parts.push(`• Berat         : ${order.grossWeight} kg`);
      if (order.volumeCbm)       parts.push(`• Volume        : ${order.volumeCbm} CBM`);
      if (order.jumlahKoli)      parts.push(`• Jumlah Koli   : ${order.jumlahKoli}`);
      if (order.serviceList && !isProduct) parts.push(`• Layanan       : ${order.serviceList}`);
      return parts.length > 0 ? parts.join("\n") : null;
    }
    return order.orderItems.map(i => {
      const qty = i.qty ?? 1;
      const unit = i.unit ?? "Unit";
      const lines: string[] = [`• ${i.name} (${qty} ${unit})`];
      if (i.subtotal != null && i.subtotal > 0) {
        const ppn = Math.round(i.subtotal * PPN_RATE);
        const total = i.subtotal + ppn;
        lines.push(`  Subtotal : Rp ${i.subtotal.toLocaleString("id-ID")}`);
        lines.push(`  PPN 11%  : Rp ${ppn.toLocaleString("id-ID")}`);
        lines.push(`  Total    : Rp ${total.toLocaleString("id-ID")}`);
      }
      return lines.join("\n");
    }).join("\n");
  })();

  return {
    orderNumber: order.orderNumber,
    tanggal: tgl,
    jam,
    customerName: order.customerName,
    customerDisplay: order.customerName + (order.companyName ? ` (${order.companyName})` : ""),
    customerPhone: order.phone,
    companyName: order.companyName ?? null,
    email: order.email,
    phone: order.phone,
    serviceType: deriveServiceType(order.shipmentType, order.orderType),
    shipmentType: isProduct ? null : (order.shipmentType || null),
    route,
    origin: order.origin || null,
    destination: order.destination || null,
    commodity: order.commodity ?? null,
    cargoDescription: order.cargoDescription ?? null,
    grossWeightDisplay: (!isProduct && order.grossWeight) ? `${order.grossWeight} kg` : null,
    volumeDisplay: (!isProduct && order.volumeCbm) ? `${order.volumeCbm} CBM` : null,
    jumlahKoliDisplay: (!isProduct && order.jumlahKoli) ? `${order.jumlahKoli} koli` : null,
    serviceList: isProduct ? null : order.serviceList,
    productList,
    productListNoPrice,
    productListDetail,
    subtotalEst: order.subtotal != null ? formatRupiah(order.subtotal) : null,
    taxEst: order.tax != null ? formatRupiah(order.tax) : null,
    taxLabel: (() => {
      if (order.subtotal == null || order.tax == null || order.subtotal === 0) return "PPN";
      const rate = Math.round((order.tax / order.subtotal) * 1000);
      return rate === 11 ? "PPN 1,1%" : "PPN 11%";
    })(),
    totalEst: formatRupiah(order.grandTotal),
    requiredDate: order.requiredDate ?? null,
    notes: order.notes ?? null,
    timestamp: nowWIB(),
    trackUrl: (() => {
      const domain = getPreferredDomain();
      if (!domain) return null;
      if (order.trackingToken) return `https://${domain}/order-track/${order.trackingToken}`;
      return `https://${domain}/track/${order.orderNumber}`;
    })(),
    ...extras,
  };
}

// ── Template DB Cache (wa_template_configs) ────────────────────────────────────
// All templates are cached in-process for WA_TEMPLATE_TTL (5 min) to avoid
// DB round-trips on every WA send. Cache key: "<recipient>__<workflow>".
// Invalidated by invalidateWaTemplateCache() after any admin template update.
const WA_TEMPLATE_TTL = 5 * 60 * 1000;
let _wfTemplateCache: Map<string, string> | null = null;
let _wfTemplateCacheAt = 0;

export function invalidateWaTemplateCache() {
  _wfTemplateCache = null;
}

/** Fetch template body for a (recipient × workflow) pair from wa_template_configs;
 *  falls back to hardcoded defaultBody if no DB record exists.
 *  Cache TTL: 5 minutes (WA_TEMPLATE_TTL). */
export async function getWaTemplateConfig(
  recipient: string,
  workflow: string,
  defaultBody: string | string[],
): Promise<string> {
  const _defaultBody = Array.isArray(defaultBody) ? defaultBody.join("\n") : defaultBody;
  if (!_wfTemplateCache || Date.now() - _wfTemplateCacheAt > WA_TEMPLATE_TTL) {
    _wfTemplateCache = new Map();
    _wfTemplateCacheAt = Date.now();
    try {
      const rows = await db.select().from(waTemplateConfigsTable);
      for (const row of rows) _wfTemplateCache.set(`${row.recipient}__${row.workflow}`, row.body);
    } catch { /* use hardcoded defaults if DB unavailable */ }
  }
  return _wfTemplateCache.get(`${recipient}__${workflow}`) ?? _defaultBody;
}

function getApproveFormUrl(orderNumber: string): string {
  const domain = getPreferredDomain();
  if (!domain) return "";
  return `https://${domain}/approve/${orderNumber}`;
}

async function createAdminReviewLink(orderId: number): Promise<string> {
  try {
    const { createAdminActionLink, getAdminActionUrl } = await import("../routes/adminAction.js");
    const token = await createAdminActionLink(orderId, "review_order", null, 72);
    const url = getAdminActionUrl(token);
    return await generateShortLink(url, { context: "admin_action", refType: "order", refId: String(orderId) });
  } catch {
    return "";
  }
}

function formatRupiah(amount: number): string {
  return amount.toLocaleString("id-ID");
}

/**
 * Extract commodity context from a stored templateSnapshot for WA messages.
 * Returns vars-map fields ready to merge into renderTemplate().
 *
 * Safe-by-design: NEVER exposes harga dasar vendor, margin internal.
 * Backward-compatible: returns all-null when snapshot is null/undefined.
 */
export function buildCommodityContext(
  snapshot: Record<string, unknown> | null | undefined,
  opts?: { quantity?: number | null; unit?: string | null },
): Record<string, string | null> {
  const empty: Record<string, string | null> = {
    templateLabel: null, templateVersion: null, categoryKey: null,
    specSummary: null, requiredDocsSummary: null, quantityDisplay: null,
  };
  if (!snapshot) return empty;
  try {
    const label = typeof snapshot["label"] === "string" ? snapshot["label"] : null;
    const category = typeof snapshot["category"] === "string" ? snapshot["category"] : null;
    const version = typeof snapshot["version"] === "string" ? snapshot["version"] : null;
    const customFields = Array.isArray(snapshot["customFields"])
      ? (snapshot["customFields"] as Array<Record<string, unknown>>)
      : [];
    const requiredDocs = Array.isArray(snapshot["requiredDocuments"])
      ? (snapshot["requiredDocuments"] as Array<Record<string, unknown>>)
      : [];

    const topFields = customFields.filter(f => f["required"] === true).slice(0, 5);
    const specSummary = topFields.length > 0
      ? topFields.map(f => {
          const u = f["unit"] ? ` (${String(f["unit"])})` : "";
          return `• ${String(f["label"] ?? "")}${u}`;
        }).join("\n")
      : null;

    const reqDocs = requiredDocs.filter(d => d["required"] === true);
    const requiredDocsSummary = reqDocs.length > 0
      ? reqDocs.map(d => `• ${String(d["label"] ?? "")}`).join("\n")
      : null;

    const qty = opts?.quantity;
    const unit = opts?.unit;
    const quantityDisplay = (qty != null && qty > 0) ? `${qty} ${unit ?? "Unit"}` : null;

    return {
      templateLabel: label ?? category,
      templateVersion: version,
      categoryKey: category,
      specSummary,
      requiredDocsSummary,
      quantityDisplay,
    };
  } catch { return empty; }
}

/**
 * Extract service context from a SERVICE template snapshot (templateKind="service").
 * Supplements buildCommodityContext(): fills specSummary from service `fields[]`,
 * adds serviceLabel and serviceChecklistSummary.
 * For non-service snapshots returns only the new-var nulls — safe to spread without
 * overriding commodity-template's specSummary.
 *
 * Safe-by-design: NEVER exposes internal pricing or margin.
 */
export function buildServiceContext(
  snapshot: Record<string, unknown> | null | undefined,
): Record<string, string | null> {
  // Non-service: return new-var nulls ONLY (no specSummary key) so commodity specSummary
  // is preserved when spreading for product templates.
  const empty: Record<string, string | null> = {
    serviceLabel: null, serviceVersion: null, serviceChecklistSummary: null,
  };
  if (!snapshot || snapshot["templateKind"] !== "service") return empty;
  try {
    const label   = typeof snapshot["label"]   === "string" ? snapshot["label"]   : null;
    const version = typeof snapshot["version"] === "string" ? snapshot["version"] : null;
    const fields  = Array.isArray(snapshot["fields"])
      ? (snapshot["fields"] as Array<Record<string, unknown>>) : [];
    const checklist = Array.isArray(snapshot["checklist"])
      ? (snapshot["checklist"] as Array<Record<string, unknown>>) : [];

    const reqFields = fields.filter(f => f["required"] === true && !f["isUpload"]).slice(0, 5);
    const specSummary = reqFields.length > 0
      ? reqFields.map(f => {
          const u = f["unit"] ? ` (${String(f["unit"])})` : "";
          return `• ${String(f["label"] ?? "")}${u}`;
        }).join("\n")
      : null;

    const serviceChecklistSummary = checklist.length > 0
      ? `✅ *Checklist Layanan:*\n` + checklist.map(c => `☐ ${String(c["label"] ?? "")}`).join("\n")
      : null;

    return { serviceLabel: label, serviceVersion: version, specSummary, serviceChecklistSummary };
  } catch { return empty; }
}

/**
 * Resolve templateSnapshot untuk order dengan priority lookup:
 * A. order.templateSnapshot (paling reliable, sudah di-denormalisasi)
 * B. RFQ.templateSnapshot terbaru untuk orderId
 * C. vendorMiniFormLink.templateSnapshot terbaru untuk orderId
 * D. null → caller fallback ke shipmentType
 */
export async function resolveTemplateSnapshot(
  orderId: number,
  orderSnapshot: Record<string, unknown> | null | undefined,
): Promise<Record<string, unknown> | null> {
  if (orderSnapshot) return orderSnapshot;
  try {
    const [rfq] = await db
      .select({ templateSnapshot: logisticOrderRfqsTable.templateSnapshot })
      .from(logisticOrderRfqsTable)
      .where(eq(logisticOrderRfqsTable.orderId, orderId))
      .orderBy(desc(logisticOrderRfqsTable.id))
      .limit(1);
    if ((rfq as any)?.templateSnapshot) return (rfq as any).templateSnapshot as Record<string, unknown>;

    const [vmf] = await db
      .select({ templateSnapshot: vendorMiniFormLinksTable.templateSnapshot })
      .from(vendorMiniFormLinksTable)
      .where(eq(vendorMiniFormLinksTable.orderId, orderId))
      .orderBy(desc(vendorMiniFormLinksTable.id))
      .limit(1);
    if (vmf?.templateSnapshot) return vmf.templateSnapshot as Record<string, unknown>;
  } catch (e) {
    logger.warn({ e, orderId }, "resolveTemplateSnapshot: DB lookup failed, falling back to null");
  }
  return null;
}

/** Returns true for air/sea freight types that need per-unit pricing hints */
function isFreightWithDimensions(shipmentType: string): boolean {
  const t = shipmentType.toLowerCase();
  return t.includes("air") || t.includes("sea") || t.includes("laut") || t.includes("udara");
}

function buildAdminWaMessage(
  order: LogisticOrderData,
  tplBody: string,
  adminActionShortUrl?: string,
): string {
  const svcType = deriveServiceType(order.shipmentType, order.orderType);
  return renderTemplate(tplBody, buildOrderVars(order, { adminActionUrl: adminActionShortUrl ?? null }), svcType);
}

function buildVendorWaMessage(
  order: LogisticOrderData,
  vendorName: string,
  tplBody: string,
  extras: Record<string, string | null | undefined> = {},
): string {
  const responseUrl = getVendorResponseUrl(order.orderNumber);
  const svcType = deriveServiceType(order.shipmentType, order.orderType);
  return renderTemplate(tplBody, buildOrderVars(order, { vendorName, responseUrl, ...extras }), svcType);
}

function getVendorResponseUrl(orderNumber: string): string {
  const domain = getPreferredDomain() || "cstlogistic.co.id";
  const { signVendorResponseToken } = require("./vendorResponseToken") as typeof import("./vendorResponseToken");
  const token = signVendorResponseToken(orderNumber);
  return `https://${domain}/vendor-response/${orderNumber}?t=${token}`;
}

function buildPickupSchedule(order: LogisticOrderData): string | null {
  const pickupDate = order.requiredDate ? formatISODate(order.requiredDate) : "";
  const pickupTime = order.jamOrder ? formatJamOrder(order.jamOrder) : "";
  if (pickupDate) return `${pickupDate}${pickupTime ? ` | ${pickupTime} WIB` : ""}`;
  if (pickupTime) return `${pickupTime} WIB`;
  return null;
}

function getOrderUrl(orderId: number): string {
  const domain = getPreferredDomain() || "cstlogistic.co.id";
  return `https://${domain}/logistic/orders/${orderId}`;
}

function buildAdminGroupWaMessage(
  order: LogisticOrderData,
  tplBody: string,
  adminActionShortUrl?: string,
): string {
  const domain = getPreferredDomain() || "cstlogistic.co.id";
  const fallbackUrl = `https://${domain}/bizportal/logistics/orders/${order.id}`;
  const actionUrl = adminActionShortUrl || fallbackUrl;
  const svcType = deriveServiceType(order.shipmentType, order.orderType);
  return renderTemplate(tplBody, buildOrderVars(order, { adminActionUrl: actionUrl }), svcType);
}

function buildCustomerWaMessage(order: LogisticOrderData, tplBody: string): string {
  const svcType = deriveServiceType(order.shipmentType, order.orderType);
  return renderTemplate(tplBody, buildOrderVars(order), svcType);
}

/** Escape user-controlled strings before inserting into HTML email bodies. */
function escHtml(s: string | null | undefined): string {
  if (!s) return "";
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#x27;");
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
        <h1 style="margin:0;color:#fff;font-size:20px">🚢 B2B Marketplace and Logistic</h1>
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
        <p style="margin:0;color:#9ca3af;font-size:12px">B2B Marketplace and Logistic — Jln. Ternate No. 10B/C, Jakarta 10150</p>
      </td></tr>
    </table>
  </td></tr>
</table>
</body>
</html>`;
}

// ─── Default template bodies (fallback jika belum dikustomisasi di DB) ────────
const DEFAULT_TPL = {
  admin_personal: {
    order_new: ["🚢 *ORDER LOGISTIK BARU*","━━━━━━━━━━━━━━━━━━","No. Order       : `{{orderNumber}}`","Tanggal         : {{tanggal}}","Jam             : {{jam}}","Customer        : {{customerDisplay}}","Email           : {{email}}","HP              : {{phone}}","Jenis           : {{shipmentType}}","Rute            : {{route}}","Kategori Barang : {{commodity}}","Deskripsi       : {{cargoDescription}}","Berat           : {{grossWeightDisplay}}","Volume          : {{volumeDisplay}}","Jumlah Koli     : {{jumlahKoliDisplay}}","{{#if product}}","📦 Produk       :","{{productList}}","{{/if}}","Layanan         : {{serviceList}}","Subtotal        : Rp {{subtotalEst}}","{{taxLabel}}    : Rp {{taxEst}}","Total Est.      : Rp {{totalEst}}","Tgl Kirim       : {{requiredDate}}","Catatan         : {{notes}}","━━━━━━━━━━━━━━━━━━","⚡ *Aksi Cepat Admin (tanpa login):*","🔭 Review & Blast Vendor → {{adminActionUrl}}","_Dikirim: {{timestamp}}_"].join("\n"),
    vendor_submission: ["📩 *PENAWARAN VENDOR DITERIMA — {{orderNumber}}*","━━━━━━━━━━━━━━━━━━","No. RFQ     : {{rfqNumber}}","No. Order   : {{orderNumber}}","Vendor      : *{{vendorName}}*{{quotePosition}}","Harga       : *{{vendorPrice}}*","ETA Pickup  : {{estimatedPickup}}","ETA Delivery: {{estimatedDelivery}}","Est. Hari   : {{estimatedDays}} hari","Catatan     : {{vendorNotes}}","━━━━━━━━━━━━━━━━━━","✅ Approve & Kirim ke Customer:","{{approveUrl}}","","Segera review dan kirim ke customer.","_{{timestamp}}_"].join("\n"),
    vendor_confirmed: ["🔔 *VENDOR CONFIRMED — {{orderNumber}}*","━━━━━━━━━━━━━━━━━━","Vendor      : *{{vendorName}}*","No. Order   : {{orderNumber}}","Harga Dasar : {{vendorPrice}}","Harga Final : {{finalCustomerPrice}}","━━━━━━━━━━━━━━━━━━","✅ Review & Approve:","{{approveUrl}}","_{{timestamp}}_"].join("\n"),
    vendor_rejected: ["🔴 *VENDOR REJECTED — {{orderNumber}}*","━━━━━━━━━━━━━━━━━━","Vendor *{{vendorName}}* menolak order ini.","","📋 Cek & pilih vendor lain:","{{approveUrl}}","_{{timestamp}}_"].join("\n"),
    customer_approved: ["✅ *CUSTOMER APPROVED — {{orderNumber}}*","━━━━━━━━━━━━━━━━━━","Customer: *{{customerName}}*","Order: {{orderNumber}}","Status: DISETUJUI ✅","No. RFQ: {{rfqNumber}}","Harga Final: {{sellingPrice}}","","Forward ke vendor (tanpa login):","{{fwdUrl}}","","Segera proses konfirmasi operasional ke vendor.","_{{timestamp}}_"].join("\n"),
    customer_revised: ["🟡 *CUSTOMER MINTA REVISI — {{rfqNumber}}*","━━━━━━━━━━━━━━━━━━","Customer: {{customerName}}","Catatan Revisi:","{{revisionNotes}}","━━━━━━━━━━━━━━━━━━","Buka RFQ:","{{rfqLink}}","_{{timestamp}}_"].join("\n"),
    customer_rejected: ["🔴 *CUSTOMER MENOLAK PENAWARAN — {{rfqNumber}}*","━━━━━━━━━━━━━━━━━━","Customer: {{customerName}}","Alasan:","{{rejectionReason}}","━━━━━━━━━━━━━━━━━━","Buka RFQ:","{{rfqLink}}","_{{timestamp}}_"].join("\n"),
    task_update: ["📦 *Update Order — {{orderNumber}}*","Dari: {{vendorName}}","Status: {{status}}","Catatan: {{notes}}","_{{timestamp}}_"].join("\n"),
    op_request: ["⚙️ *OP. REQUEST DIKIRIM — {{orderNumber}}*","","Form konfirmasi operasional telah dikirim ke vendor *{{vendorName}}*.","","No. Order : {{orderNumber}}","Customer  : {{customerName}}","Layanan   : {{serviceType}}","Route     : {{route}}","","{{#if trucking}}","Data yang diminta: Driver, No. Plat, Kendaraan.","{{/if}}","{{#if freight_sea}}","Data yang diminta: Vessel, Voyage, Container, BL.","{{/if}}","{{#if freight_air}}","Data yang diminta: Airline, AWB, Flight Number.","{{/if}}","{{#if ppjk}}","Data yang diminta: Nomor Aju, BC Type, SPPB.","{{/if}}","","🔗 Link Operasional: {{operationalFormLink}}","","_{{timestamp}}_"].join("\n"),
    driver_assigned: ["🚚 *DRIVER DITUGASKAN — {{orderNumber}}*","","Driver untuk order *{{orderNumber}}* telah ditugaskan.","Customer : {{customerName}}","Layanan  : {{serviceType}}","","{{#if trucking}}","👤 Driver    : {{driverName}}","📞 HP        : {{driverPhone}}","🚛 Kendaraan : {{vehicleType}}","🔢 Plat      : {{plateNumber}}","{{/if}}","","Notifikasi sudah dikirim ke customer.","_{{timestamp}}_"].join("\n"),
    shipment_update: ["🚢 *SHIPMENT UPDATE DIKIRIM — {{orderNumber}}*","","Update pengiriman sudah dikirim ke customer *{{customerName}}*.","Layanan : {{serviceType}}","Rute    : {{route}}","","{{#if freight_sea}}","🚢 Kapal     : {{vessel}} / {{voyage}}","📦 Container : {{containerNumber}}","📃 BL No     : {{blNumber}}","{{/if}}","","{{#if freight_air}}","✈️ Airline   : {{airline}}","📋 AWB       : {{awbNumber}}","🛫 Flight    : {{flightNumber}}","{{/if}}","","_{{timestamp}}_"].join("\n"),
    customs_update: ["🏛️ *KEPABEANAN UPDATE DIKIRIM — {{orderNumber}}*","","Update kepabeanan sudah dikirim ke customer *{{customerName}}*.","Layanan : {{serviceType}}","","{{#if ppjk}}","📋 No. Aju : {{ajuNumber}}","📄 BC Type : {{bcType}}","✅ SPPB    : {{sppbNumber}}","{{/if}}","","_{{timestamp}}_"].join("\n"),
    delivery_completed: ["🏁 *PENGIRIMAN SELESAI — {{orderNumber}}*","Customer: {{customerName}}","Rute: {{route}}","_{{timestamp}}_"].join("\n"),
    vendor_job_accepted: [
      "✅ *Vendor Menerima Job Order*",
      "",
      "Order   : {{orderNumber}}",
      "Vendor  : {{vendorName}}",
      "Rute    : {{origin}} → {{destination}}",
      "Driver  : {{driverName}} | Plat: {{vehiclePlate}}",
      "Pickup  : {{pickupTime}}",
      "Carrier : {{carrier}}",
      "Catatan : {{notes}}",
      "",
      "_{{timestamp}}_",
    ].join("\n"),
    vendor_job_rejected: [
      "❌ *Vendor Menolak Job Order*",
      "━━━━━━━━━━━━━━━━━━",
      "Order  : *{{orderNumber}}*",
      "Vendor : {{vendorName}}",
      "Rute   : {{route}}",
      "Alasan : {{reason}}",
      "━━━━━━━━━━━━━━━━━━",
      "⚠️ Silakan re-assign vendor segera:",
      "{{adminOrderUrl}}",
      "",
      "_{{timestamp}}_",
    ].join("\n"),
    vendor_progress_update: [
      "📍 *Update Progress Order*",
      "",
      "Order  : {{orderNumber}}",
      "Vendor : {{vendorName}}",
      "Status : {{status}}",
      "Catatan: {{notes}}",
      "",
      "_{{timestamp}}_",
    ].join("\n"),
    vendor_pod_uploaded: [
      "📎 *Vendor Upload POD*",
      "",
      "Order         : {{orderNumber}}",
      "Vendor        : {{vendorName}}",
      "Komoditi      : {{commodity}}",
      "Produk        : {{templateLabel}}",
      "Jenis Layanan : {{serviceLabel}}",
      "Qty           : {{quantityDisplay}}",
      "File diunggah : {{fileCount}}",
      "Catatan       : {{completionNotes}}",
      "{{serviceChecklistSummary}}",
      "",
      "_{{timestamp}}_",
    ].join("\n"),
    sales_order_created: [
      "📋 *{{docLabel}} Baru*",
      "No: {{orderNumber}}",
      "Customer: {{customerName}}",
      "Total: {{grandTotal}}",
      "Tanggal: {{tanggal}}",
      "_{{timestamp}}_",
    ].join("\n"),
    quotation_sent: [
      "📤 *Quotation Dikirim ke Customer*",
      "No: {{orderNumber}}",
      "Customer: {{customerName}}",
      "Total: {{grandTotal}}",
      "_{{timestamp}}_",
    ].join("\n"),
    sales_order_confirmed: [
      "📋 *Sales Order Baru (Dikonfirmasi)*",
      "No: {{orderNumber}}",
      "Customer: {{customerName}}",
      "Total: {{grandTotal}}",
      "Tanggal: {{tanggal}}",
      "_{{timestamp}}_",
    ].join("\n"),
    sales_order_delivered: [
      "🚚 *SO Terkirim*",
      "No: {{orderNumber}}",
      "Customer: {{customerName}}",
      "Total: {{grandTotal}}",
      "_{{timestamp}}_",
    ].join("\n"),
    invoice_issued: [
      "🧾 *Invoice Diterbitkan — {{invNumber}}*",
      "Order: {{orderNumber}} | Customer: *{{customerName}}*",
      "Produk: {{templateLabel}}",
      "Qty: {{quantityDisplay}}",
      "Subtotal: {{subtotalDisplay}} | PPN: {{taxAmountDisplay}}",
      "Total: *{{grandTotal}}* | Jatuh Tempo: {{dueStr}}",
      "_{{timestamp}}_",
    ].join("\n"),
    vendor_quote_received: [
      "💰 *PENAWARAN VENDOR DITERIMA*",
      "━━━━━━━━━━━━━━━━━━",
      "No. RFQ     : `{{rfqNumber}}`",
      "No. Order   : `{{orderNumber}}`",
      "Vendor      : *{{vendorName}}*{{quotePosition}}",
      "Harga       : *{{vendorPrice}}*",
      "ETA Pickup  : {{estimatedPickup}}",
      "ETA Kirim   : {{estimatedDelivery}}",
      "Est. Hari   : {{estimatedDays}} hari",
      "Catatan     : {{vendorNotes}}",
      "━━━━━━━━━━━━━━━━━━",
      "✅ Approve & Kirim ke Customer:",
      "{{approveUrl}}",
      "_{{timestamp}}_",
    ].join("\n"),
    rfq_customer_confirmed: [
      "✅ *CUSTOMER SETUJU — {{orderNumber}}*",
      "",
      "Customer *{{customerName}}* menyetujui penawaran:",
      "💰 *{{sellingPrice}}*",
      "",
      "📍 Rute: {{route}}",
      "{{pickupInfo}}",
      "{{truckUnit}}",
      "{{soInfo}}",
      "",
      "🔗 Detail order:",
      "{{orderUrl}}",
      "_{{timestamp}}_",
    ].join("\n"),
    rfq_customer_rejected: [
      "❌ *CUSTOMER TOLAK — {{orderNumber}}*",
      "",
      "Customer *{{customerName}}* menolak penawaran:",
      "💰 *{{sellingPrice}}*",
      "",
      "📍 Rute: {{route}}",
      "Silakan hubungi customer untuk negosiasi lebih lanjut.",
      "",
      "🔗 Detail order:",
      "{{orderUrl}}",
      "_{{timestamp}}_",
    ].join("\n"),
    customer_chose_option: [
      "✅ *CUSTOMER MEMILIH OPSI — {{orderNumber}}*",
      "",
      "Customer *{{customerName}}* memilih: *{{chosenLabel}}*",
      "💰 *{{sellingPrice}}*",
      "",
      "📍 Rute: {{route}}",
      "{{pickupInfo}}",
      "{{truckUnit}}",
      "{{vehicleYear}}",
      "",
      "🔗 *Buat Sales Order:*",
      "{{orderUrl}}",
      "_{{timestamp}}_",
    ].join("\n"),
    logistic_operational_status_admin: [
      "{{emoji}} *Status Update* — {{orderNumber}}",
      "Customer: {{customerName}}",
      "Status: *{{statusLabel}}*",
      "_{{timestamp}}_",
    ].join("\n"),
  },
  admin_group: {
    order_new: ["🔔 *[ORDER MASUK] {{orderNumber}}*","━━━━━━━━━━━━━━━━━━","🏷️ No. Order     : `{{orderNumber}}`","📆 Tanggal       : {{tanggal}}","🕐 Jam           : {{jam}}","👤 Customer      : *{{customerDisplay}}*","📞 HP            : {{phone}}","━━━━━━━━━━━━━━━━━━","🚢 Jenis         : {{shipmentType}}","📍 Rute          : {{route}}","📦 Komoditi      : {{commodity}}","📋 Deskripsi     : {{cargoDescription}}","⚖️ Berat         : {{grossWeightDisplay}}","📐 Volume        : {{volumeDisplay}}","{{#if product}}","🛍️ Nama Produk   :","{{productList}}","{{/if}}","📅 Tgl Kirim     : {{requiredDate}}","📝 Catatan       : {{notes}}","━━━━━━━━━━━━━━━━━━","💵 Subtotal      : Rp {{subtotalEst}}","🧾 {{taxLabel}}  : Rp {{taxEst}}","💰 Total Est.    : *Rp {{totalEst}}*","🔵 Status        : Menunggu Konfirmasi","━━━━━━━━━━━━━━━━━━","⚡ *Review & Proses Order (tanpa login):*","👉 {{adminActionUrl}}","","_Dikirim: {{timestamp}}_"].join("\n"),
    vendor_submission: ["📩 *VENDOR SUBMIT — {{orderNumber}}*","RFQ: {{rfqNumber}} | Vendor *{{vendorName}}*{{quotePosition}}","💰 Harga: {{vendorPrice}}","ETA: {{estimatedPickup}} → {{estimatedDelivery}}","Segera review!","_{{timestamp}}_"].join("\n"),
    vendor_confirmed: ["🔔 *VENDOR CONFIRMED — {{orderNumber}}*","Vendor: *{{vendorName}}* | Harga Final: {{finalCustomerPrice}}","{{approveUrl}}","_{{timestamp}}_"].join("\n"),
    vendor_rejected: ["🔴 *VENDOR REJECTED — {{orderNumber}}*","Vendor *{{vendorName}}* menolak. Pilih vendor lain:","{{approveUrl}}","_{{timestamp}}_"].join("\n"),
    customer_approved: [
      "🎉 *CUSTOMER APPROVED — {{orderNumber}}*",
      "━━━━━━━━━━━━━━━━",
      "Customer   : *{{customerName}}*",
      "Order      : {{orderNumber}}",
      "━━━━━━━━━━━━━━━━",
      "💰 Harga Jual  : *{{sellingPrice}}*",
      "📦 Harga Basic : {{vendorCost}}",
      "📈 Margin      : {{margin}}",
      "━━━━━━━━━━━━━━━━",
      "{{fwdUrl}}",
      "_{{timestamp}}_",
    ].join("\n"),
    customer_revised: ["🟡 *CUSTOMER REVISI — {{rfqNumber}}*","Customer: {{customerName}}","Catatan: {{revisionNotes}}","{{rfqLink}}","_{{timestamp}}_"].join("\n"),
    customer_rejected: ["🔴 *CUSTOMER TOLAK — {{rfqNumber}}*","Customer: {{customerName}}","Alasan: {{rejectionReason}}","{{rfqLink}}","_{{timestamp}}_"].join("\n"),
    task_update: ["📦 *Update Order — {{orderNumber}}*","Dari: {{vendorName}} | Status: {{status}}","_{{timestamp}}_"].join("\n"),
    op_request: ["⚙️ *[OP. REQUEST] {{orderNumber}}*","Form operasional dikirim ke vendor *{{vendorName}}*.","Customer: {{customerName}} | Layanan: {{serviceType}}","Rute: {{route}}","_{{timestamp}}_"].join("\n"),
    driver_assigned: ["🚚 *[DRIVER DITUGASKAN] {{orderNumber}}*","Customer: {{customerName}}","{{#if trucking}}","Driver: {{driverName}} | Plat: {{plateNumber}}","{{/if}}","_{{timestamp}}_"].join("\n"),
    shipment_update: ["🚢 *SHIPMENT UPDATE — {{orderNumber}}*","Customer: {{customerName}} | Rute: {{route}}","{{#if freight_sea}}","Vessel: {{vessel}} / BL: {{blNumber}}","{{/if}}","{{#if freight_air}}","AWB: {{awbNumber}} / Flight: {{flightNumber}}","{{/if}}","_{{timestamp}}_"].join("\n"),
    customs_update: ["🏛️ *KEPABEANAN UPDATE — {{orderNumber}}*","Customer: {{customerName}}","{{#if ppjk}}","Aju: {{ajuNumber}} | SPPB: {{sppbNumber}}","{{/if}}","_{{timestamp}}_"].join("\n"),
    vendor_submission_summary: [
      "📩 *PENAWARAN VENDOR — {{orderNumber}}*",
      "━━━━━━━━━━━━━━━━━━",
      "Vendor    : *{{vendorName}}*",
      "Harga     : *{{vendorPrice}}*",
      "Layanan   : {{serviceType}}",
      "Rute      : {{route}}",
      "Komoditi  : {{commodity}}",
      "Komoditas : {{templateLabel}}",
      "PIC       : {{picLabel}}",
      "{{specSummary}}",
      "━━━━━━━━━━━━━━━━━━",
      "📊 {{submittedVendorCount}} / {{totalVendorInvited}} vendor sudah submit",
      "{{compareMessage}}",
      "🔗 Bandingkan penawaran:",
      "{{vendorComparisonLink}}",
      "_{{timestamp}}_",
    ].join("\n"),
    invoice_issued: [
      "🧾 *Invoice Diterbitkan — {{invNumber}}*",
      "Order: {{orderNumber}} | Customer: *{{customerName}}*",
      "Produk: {{templateLabel}}",
      "Qty: {{quantityDisplay}}",
      "Subtotal: {{subtotalDisplay}} | PPN: {{taxAmountDisplay}}",
      "Total: *{{grandTotal}}* | Jatuh Tempo: {{dueStr}}",
      "{{#if invoiceUrl}}",
      "🔗 Link Invoice: {{invoiceUrl}}",
      "{{/if}}",
      "_{{timestamp}}_",
    ].join("\n"),
    delivery_completed: [
      "🏁 *Pengiriman Selesai — {{orderNumber}}*",
      "Customer: {{customerName}} | Rute: {{route}}",
      "_{{timestamp}}_",
    ].join("\n"),
    truck_assigned: [
      "🚚 *[TRUK DI-ASSIGN] {{orderNumber}}*",
      "━━━━━━━━━━━━━━━━━━",
      "Customer  : *{{customerName}}*",
      "Rute      : {{route}}",
      "━━━━━━━━━━━━━━━━━━",
      "🚛 Vendor Truk : *{{truckVendorName}}* ({{truckSourceLabel}})",
      "💰 Harga Produk: {{productPrice}}",
      "🚚 Harga Truk  : {{truckPrice}}",
      "💵 *Total       : {{totalPrice}}*",
      "_{{timestamp}}_",
    ].join("\n"),
  },
  customer: {
    order_new: ["✅ *PESANAN ANDA DITERIMA*","━━━━━━━━━━━━━━━━━━","Halo *{{customerName}}*,","","Terima kasih telah mempercayakan kepercayaan Anda kepada B2B Marketplace and Logistic.","","No. Order       : *{{orderNumber}}*","Tanggal         : {{tanggal}}","Jam             : {{jam}}","Status          : Menunggu Konfirmasi","Rute            : {{route}}","Kategori Barang : {{commodity}}","Berat           : {{grossWeightDisplay}}","Volume          : {{volumeDisplay}}","{{#if product}}","🛍️ Produk       :","{{productList}}","{{/if}}","Layanan         : {{serviceList}}","Tgl Butuh       : {{requiredDate}}","━━━━━━━━━━━━━━━━━━","💵 Subtotal      : Rp {{subtotalEst}}","🧾 {{taxLabel}}  : Rp {{taxEst}}","💰 Total Est.    : Rp {{totalEst}}","━━━━━━━━━━━━━━━━━━","Tim kami sedang memproses permintaan Anda dan akan segera menghubungi Anda.","","📞 Jakarta: (021) 6241234 | Tangerang: (021) 5591234","","🔗 Pantau status order Anda:","{{trackUrl}}","","_Dikirim: {{timestamp}}_"].join("\n"),
    customer_approval: [
      "✅ *PENAWARAN SIAP — CST LOGISTICS*",
      "━━━━━━━━━━━━━━━━━━",
      "Halo *{{customerName}}*,",
      "",
      "Penawaran untuk order *{{orderNumber}}* telah siap.",
      "No. RFQ    : {{rfqNumber}}",
      "Layanan    : {{shipmentType}}",
      "Rute       : {{route}}",
      "Produk     : {{templateLabel}}",
      "Jenis      : {{serviceLabel}}",
      "━━━━━━━━━━━━━━━━━━",
      "📋 *Spesifikasi:*",
      "{{specSummary}}",
      "━━━━━━━━━━━━━━━━━━",
      "{{itemsBlock}}",
      "━━━━━━━━━━━━━━━━━━",
      "💵 Subtotal : {{subtotalDisplay}}",
      "🧾 PPN 11%  : {{taxDisplay}}",
      "💰 Total    : *{{totalDisplay}}*",
      "ETA         : {{etaFinal}}",
      "Valid s/d   : {{validUntil}}",
      "━━━━━━━━━━━━━━━━━━",
      "Silakan review dan konfirmasi melalui link berikut:",
      "🔗 {{customerApprovalLink}}",
      "",
      "Terima kasih 🙏",
      "_B2B Marketplace and Logistic_",
    ].join("\n"),
    customer_options: ["✅ *PENAWARAN {{shipmentType}} — B2B Marketplace and Logistic*","📦 Order: {{orderNumber}}","📍 {{route}}","{{pickupInfo}}","━━━━━━━━━━━━━━","{{optionSummary}}","━━━━━━━━━━━━━━","👉 Pilih opsi Anda:","{{optionUrl}}","_{{timestamp}}_"].join("\n"),
    operational_update: ["{{statusEmoji}} *Update Status Pengiriman*","","No. Order: *{{orderNumber}}*","Customer: {{customerDisplay}}","Status: *{{statusLabel}}*","","B2B Marketplace and Logistic — Terima kasih telah menggunakan layanan kami."].join("\n"),
    customer_approved: ["🎉 *TERIMA KASIH TELAH MENGKONFIRMASI!*","━━━━━━━━━━━━━━━━━━","Halo *{{customerName}}*,","","Penawaran order *{{orderNumber}}* telah diterima.","Tim operasional kami sedang memprosesnya.","","📞 Pertanyaan: (021) 6241234","_Dikirim: {{timestamp}}_"].join("\n"),
    so_created: ["📑 *SALES ORDER TERKONFIRMASI — {{orderNumber}}*","━━━━━━━━━━━━━━━━━━","Halo *{{customerName}}*,","","Pesanan Anda telah resmi dikonfirmasi!","","💰 Harga: {{sellingPrice}}","Rute: {{route}}","","Tim kami akan segera memproses pengiriman.","Terima kasih 🙏","_Dikirim: {{timestamp}}_"].join("\n"),
    driver_assigned: ["🚚 *DRIVER DITUGASKAN — {{orderNumber}}*","━━━━━━━━━━━━━━━━━━","Halo *{{customerName}}*,","","Driver untuk order *{{orderNumber}}* telah ditugaskan:","","{{#if trucking}}","👤 Driver: {{driverName}}","📞 HP: {{driverPhone}}","🚛 Kendaraan: {{vehicleType}}","🔢 No. Plat: {{plateNumber}}","{{/if}}","","Driver akan segera menghubungi Anda.","Terima kasih 🙏","_Dikirim: {{timestamp}}_"].join("\n"),
    shipment_update: ["📦 *UPDATE PENGIRIMAN — {{orderNumber}}*","━━━━━━━━━━━━━━━━━━","Halo *{{customerName}}*,","","Update status pengiriman order *{{orderNumber}}*:","Rute: {{route}}","","{{#if freight_sea}}","🚢 Kapal: {{vessel}} / Voyage: {{voyage}}","📦 Container: {{containerNumber}}","📃 BL No: {{blNumber}}","{{/if}}","","{{#if freight_air}}","✈️ Airline: {{airline}}","📋 AWB: {{awbNumber}}","🛫 Flight: {{flightNumber}}","{{/if}}","","Terima kasih 🙏","_Dikirim: {{timestamp}}_"].join("\n"),
    customs_update: ["🏛️ *UPDATE KEPABEANAN — {{orderNumber}}*","━━━━━━━━━━━━━━━━━━","Halo *{{customerName}}*,","","Update status kepabeanan order *{{orderNumber}}*:","","{{#if ppjk}}","📋 No. Aju: {{ajuNumber}}","📄 BC Type: {{bcType}}","✅ SPPB: {{sppbNumber}}","{{/if}}","","Terima kasih 🙏"].join("\n"),
    delivery_completed: ["🏁 *PENGIRIMAN SELESAI — {{orderNumber}}*","━━━━━━━━━━━━━━━━━━","Halo *{{customerName}}*,","","Pengiriman order *{{orderNumber}}* telah selesai! ✅","Rute: {{route}}","","Terima kasih telah menggunakan B2B Marketplace and Logistic!","","📞 Feedback: (021) 6241234","_Dikirim: {{timestamp}}_"].join("\n"),
    customer_progress_update: [
      "📦 *Update Status Pengiriman Anda*",
      "",
      "Order : *{{orderNumber}}*",
      "Status: *{{statusLabel}}*",
      "Keterangan: {{notes}}",
      "",
      "🔗 Pantau progress real-time:",
      "{{trackingUrl}}",
      "",
      "_B2B Marketplace and Logistic — kami informasikan setiap perubahan status._",
    ].join("\n"),
    customer_pod_uploaded: [
      "✅ *Pengiriman Selesai!*",
      "",
      "Order: *{{orderNumber}}*",
      "Produk: {{templateLabel}}",
      "Jenis Layanan: {{serviceLabel}}",
      "Vendor *{{vendorName}}* telah mengunggah dokumen bukti pengiriman (POD).",
      "Catatan: {{completionNotes}}",
      "",
      "Mohon konfirmasi penerimaan barang kepada tim B2B Marketplace and Logistic jika diperlukan.",
      "",
      "🔗 Detail tracking:",
      "{{trackingUrl}}",
      "",
      "_B2B Marketplace and Logistic_",
    ].join("\n"),
    order_completed: [
      "✅ *Order Anda Telah Selesai — B2B Marketplace and Logistic*",
      "",
      "Order: *{{orderNumber}}*",
      "Rute : {{origin}} → {{destination}}",
      "",
      "Order Anda telah berhasil diselesaikan.",
      "Catatan: {{adminNotes}}",
      "",
      "Lihat detail & dokumen di:",
      "{{trackingUrl}}",
      "",
      "Terima kasih telah mempercayakan pengiriman Anda kepada B2B Marketplace and Logistic! 🙏",
    ].join("\n"),
    quotation_sent: [
      "📄 *Sales Quotation — {{orderNumber}}*",
      "",
      "Halo {{customerName}},",
      "",
      "Penawaran kami untuk Anda:",
      "Total: {{grandTotal}}",
      "Berlaku hingga: {{validStr}}",
      "",
      "Silakan hubungi kami untuk konfirmasi. Terima kasih!",
      "_{{timestamp}}_",
    ].join("\n"),
    sales_order_confirmed: [
      "✅ *Sales Order Dikonfirmasi — {{orderNumber}}*",
      "",
      "Halo {{customerName}},",
      "",
      "Order Anda telah dikonfirmasi:",
      "Total: {{grandTotal}}",
      "Estimasi pengiriman: {{expStr}}",
      "",
      "Kami akan segera memproses pesanan Anda. Terima kasih!",
      "_{{timestamp}}_",
    ].join("\n"),
    sales_order_delivered: [
      "🚚 *Pesanan Terkirim — {{orderNumber}}*",
      "",
      "Halo {{customerName}},",
      "",
      "Pesanan Anda telah dikirim/diserahkan.",
      "Total: {{grandTotal}}",
      "",
      "Terima kasih telah berbelanja bersama kami!",
      "_{{timestamp}}_",
    ].join("\n"),
    invoice_issued: [
      "🧾 *Invoice Diterbitkan — {{invNumber}}*",
      "━━━━━━━━━━━━━━━━━━",
      "Halo {{customerName}},",
      "",
      "Invoice untuk order Anda telah diterbitkan.",
      "",
      "No. Order   : {{orderNumber}}",
      "No. Invoice : *{{invNumber}}*",
      "Produk      : {{templateLabel}}",
      "Qty         : {{quantityDisplay}}",
      "Jatuh Tempo : *{{dueStr}}*",
      "━━━━━━━━━━━━━━━━━━",
      "💰 Subtotal : {{subtotalDisplay}}",
      "🧾 PPN      : {{taxAmountDisplay}}",
      "💵 *Total   : {{grandTotal}}*",
      "━━━━━━━━━━━━━━━━━━",
      "🔗 Lihat & Bayar:",
      "{{invoiceUrl}}",
      "",
      "Terima kasih atas kepercayaan Anda 🙏",
      "_B2B Marketplace and Logistic_",
    ].join("\n"),
    logistic_order_status: [
      "📦 *Update Status Order Anda*",
      "No Order: {{orderNumber}}",
      "Status: *{{statusLabel}}*",
      "",
      "Terima kasih telah menggunakan layanan kami. Hubungi kami jika ada pertanyaan.",
      "_{{timestamp}}_",
    ].join("\n"),
    quotation_sent_customer: [
      "✅ *PENAWARAN {{serviceType}} — B2B Marketplace and Logistic*",
      "━━━━━━━━━━━━━━━━━━",
      "Halo *{{customerName}}*,",
      "",
      "No. Order   : `{{orderNumber}}`",
      "Rute        : {{route}}",
      "{{pickupInfo}}",
      "{{truckUnit}}",
      "Komoditi    : {{commodity}}",
      "ETA Pickup  : {{estimatedPickup}}",
      "ETA Kirim   : {{estimatedDelivery}}",
      "━━━━━━━━━━━━━━━━━━",
      "💰 *Total Biaya: {{sellingPrice}}*",
      "━━━━━━━━━━━━━━━━━━",
      "{{confirmLine}}",
      "{{footerLine}}",
      "_{{timestamp}}_",
    ].join("\n"),
    logistic_operational_status: [
      "{{emoji}} *Update Status Pengiriman*",
      "",
      "No. Order: *{{orderNumber}}*",
      "Customer: {{customerName}}",
      "Status Operasional: *{{statusLabel}}*",
      "",
      "B2B Marketplace and Logistic — Terima kasih telah menggunakan layanan kami.",
      "_{{timestamp}}_",
    ].join("\n"),
    truck_assigned: [
      "🚚 *INFO PENGIRIMAN — {{orderNumber}}*",
      "━━━━━━━━━━━━━━━━━━",
      "Halo *{{customerName}}*,",
      "",
      "Vendor pengiriman untuk order Anda telah dikonfirmasi:",
      "",
      "🚛 Truk   : *{{truckVendorName}}* ({{truckSourceLabel}})",
      "💰 Harga Produk : {{productPrice}}",
      "🚚 Harga Truk   : {{truckPrice}}",
      "💵 *Total        : {{totalPrice}}*",
      "",
      "Terima kasih telah mempercayakan pengiriman Anda kepada kami.",
      "_{{timestamp}}_",
    ].join("\n"),
  },
  product_order_status: {
    admin_personal: [
      "🔔 *[UPDATE STATUS PRODUK]*",
      "No. Order : {{orderNumber}}",
      "Customer  : {{customerName}}",
      "HP        : {{phone}}",
      "Status    : *{{statusLabel}}*",
      "_{{timestamp}}_",
    ].join("\n"),
    admin_group: [
      "🔔 *[STATUS ORDER PRODUK DIPERBARUI]*",
      "No. Order : {{orderNumber}} | Customer: {{customerName}}",
      "Status    : *{{statusLabel}}*",
      "_{{timestamp}}_",
    ].join("\n"),
    customer: [
      "📦 *Update Status Pesanan Anda*",
      "No. Order: {{orderNumber}}",
      "Customer: {{customerName}}",
      "Status: *{{statusLabel}}*",
      "",
      "Terima kasih telah berbelanja di B2B Marketplace and Logistic. Hubungi kami jika ada pertanyaan. 🙏",
    ].join("\n"),
  },
  product_order: {
    admin_personal: [
      "🛒 *PESANAN PRODUK BARU*",
      "━━━━━━━━━━━━━━━━━━",
      "No. Order   : `{{orderNumber}}`",
      "Customer    : {{customerName}}",
      "Email       : {{email}}",
      "HP          : {{phone}}",
      "Alamat      : {{shippingAddress}}",
      "━━━━━━━━━━━━━━━━━━",
      "📦 Detail Produk:",
      "{{itemList}}",
      "────────────────",
      "💵 Subtotal   : Rp {{subtotalDisplay}}",
      "🧾 PPN {{taxRate}}%  : Rp {{taxAmountDisplay}}",
      "💰 Grand Total: *Rp {{grandTotal}}*",
      "━━━━━━━━━━━━━━━━━━",
      "Catatan     : {{notes}}",
      "🔗 Lihat di BizPortal:",
      "{{orderUrl}}",
      "",
      "📋 *Form vendor (forward ke vendor):*",
      "{{vendorFormUrl}}",
      "",
      "_Dikirim: {{timestamp}}_",
    ].join("\n"),
    admin_group: [
      "🛒 *[PESANAN PRODUK] {{orderNumber}}*",
      "━━━━━━━━━━━━━━━━━━",
      "👤 Customer : *{{customerName}}*",
      "📞 HP       : {{phone}}",
      "📧 Email    : {{email}}",
      "━━━━━━━━━━━━━━━━━━",
      "📦 Detail Produk:",
      "{{itemList}}",
      "────────────────",
      "💵 Subtotal   : Rp {{subtotalDisplay}}",
      "🧾 PPN {{taxRate}}%  : Rp {{taxAmountDisplay}}",
      "💰 Grand Total: *Rp {{grandTotal}}*",
      "━━━━━━━━━━━━━━━━━━",
      "Catatan     : {{notes}}",
      "_Dikirim: {{timestamp}}_",
    ].join("\n"),
    customer: [
      "✅ *Pesanan Anda Berhasil Diterima!*",
      "No. Order: *{{orderNumber}}*",
      "",
      "📦 Detail Pesanan:",
      "{{itemList}}",
      "────────────────",
      "💵 Subtotal : Rp {{subtotalDisplay}}",
      "🧾 PPN {{taxRate}}% : Rp {{taxAmountDisplay}}",
      "💰 Total    : *Rp {{grandTotal}}*",
      "",
      "Tim kami akan segera menghubungi Anda untuk konfirmasi. Terima kasih! 🙏",
    ].join("\n"),
  },
  vendor: {
    order_new: ["📦 *PERMINTAAN ORDER BARU — CST LOGISTICS*","━━━━━━━━━━━━━━━━━━━━","Kepada Yth. *{{vendorName}}*,","","No. Order       : *{{orderNumber}}*","Tanggal         : {{tanggal}}","Jenis           : {{shipmentType}}","Rute            : {{route}}","Kategori Barang : {{commodity}}","Deskripsi       : {{cargoDescription}}","Berat           : {{grossWeightDisplay}}","Volume          : {{volumeDisplay}}","Jumlah Koli     : {{jumlahKoliDisplay}}","{{#if product}}","🛍️ Produk       :","{{productList}}","{{/if}}","Tgl Butuh       : {{requiredDate}}","{{#if trucking}}","🚛 Jenis Kendaraan: {{vehicleType}}","📅 Jadwal Pickup  : {{pickupSchedule}}","💰 Contract Rate  : {{contractRate}}","{{/if}}","Layanan         : {{serviceList}}","Catatan         : {{notes}}","━━━━━━━━━━━━━━━━━━━━","🔗 *Aksi Cepat (klik link):*","✅ Terima  → {{responseUrl}}?action=accept","❌ Tolak   → {{responseUrl}}?action=reject","💬 Form    → {{responseUrl}}","","✏️ *Atau balas WA dengan format:*","📌 Harga: `{{orderNumber}} [HARGA] [TGL_PICKUP]`","📌 Terima: `TERIMA {{orderNumber}}`","📌 Tolak:  `TOLAK {{orderNumber}}`","","Terima kasih 🙏","_Dikirim: {{timestamp}}_"].join("\n"),
    vendor_request: ["📦 *PERMINTAAN PENAWARAN VENDOR*","━━━━━━━━━━━━━━━━━━","Kepada Yth. *{{vendorName}}*,","","No. RFQ       : *{{rfqNumber}}*","No. Order     : {{orderNumber}}","Customer      : {{customerDisplay}}","Tanggal       : {{tanggal}}","Jenis         : {{shipmentType}}","Jenis Layanan : {{serviceLabel}}","Rute          : {{route}}","Komoditi      : {{commodity}}","Komoditas     : {{templateLabel}}","Deskripsi     : {{cargoDescription}}","Berat         : {{grossWeightDisplay}}","Volume        : {{volumeDisplay}}","Qty           : {{quantityDisplay}}","━━━━━━━━━━━━━━━━━━","📋 Detail Item / Layanan:","{{productListDetail}}","","📋 *Spesifikasi:*","{{specSummary}}","","📄 *Dokumen Wajib:*","{{requiredDocsSummary}}","","{{serviceChecklistSummary}}","","Tgl Butuh     : {{requiredDate}}","Catatan Admin : {{notes}}","","📝 Silakan isi penawaran melalui link berikut:","","🔗 *[ ISI PENAWARAN VENDOR ]*","👉 {{vendorMiniFormLink}}","","━━━━━━━━━━━━━━━━━━","Terima kasih atas kerja sama Anda 🙏","_B2B Marketplace and Logistic_"].join("\n"),
    task_link: ["🚚 *Tugas Order Baru — B2B Marketplace and Logistic*","","Order: {{orderNumber}}","Rute: {{route}}","Keterangan: {{label}}","","Silakan buka link berikut untuk konfirmasi dan update status:","{{taskUrl}}","_{{timestamp}}_"].join("\n"),
    vendor_revision: ["↩️ *REVISI PENAWARAN — {{orderNumber}}*","━━━━━━━━━━━━━━━━━━","Kepada Yth. *{{vendorName}}*,","","Kami memerlukan revisi harga untuk order *{{orderNumber}}*.","Komoditas     : {{templateLabel}}","Harga saat ini: {{vendorPrice}}","","📋 *Spesifikasi:*","{{specSummary}}","","Mohon kirim penawaran terbaik Anda kembali:","🔗 {{vendorMiniFormLink}}","","Terima kasih 🙏"].join("\n"),
    op_request: ["⚙️ *KONFIRMASI OPERASIONAL — CST LOGISTICS*","━━━━━━━━━━━━━━━━━━","Kepada Yth. *{{vendorName}}*,","","Customer telah menyetujui penawaran untuk order *{{orderNumber}}*.","Jenis Layanan : {{serviceLabel}}","","Mohon lengkapi data operasional:","","🔗 {{operationalFormLink}}","","{{#if trucking}}","Data dibutuhkan: Driver, No. Plat, jadwal pickup.","{{/if}}","","{{#if freight_sea}}","Data dibutuhkan: Vessel, Voyage, ETA/ETD, BL.","{{/if}}","","{{#if freight_air}}","Data dibutuhkan: Airline, AWB, jadwal penerbangan.","{{/if}}","","{{#if ppjk}}","Data dibutuhkan: No. Aju, BC type, SPPB.","{{/if}}","","{{serviceChecklistSummary}}","","Terima kasih atas kerjasamanya 🙏"].join("\n"),
    vendor_submit_confirm: [
      "Halo *{{picLabel}}* dari *{{vendorLabel}}*,",
      "",
      "Terima kasih! Penawaran Anda telah kami terima dan akan segera diproses oleh tim B2B Marketplace and Logistic.",
      "",
      "Order Ref: *{{orderNumber}}*",
      "",
      "_Pesan ini dikirim otomatis, mohon tidak dibalas._",
    ].join("\n"),
    vendor_rfq_forward: [
      "Halo *{{vendorLabel}}*,",
      "",
      "Anda menerima permintaan penawaran (RFQ) dari *B2B Marketplace and Logistic*.",
      "",
      "📌 *Ref: {{rfqRef}}*",
      "👤 Customer: {{customerName}}",
      "🚚 Layanan: {{serviceNeeded}}",
      "📍 Rute: {{route}}",
      "⚖️ Berat/Volume: {{weightVolume}}",
      "📦 Barang: {{cargoDesc}}",
      "📅 Target Pengiriman: {{targetDeliveryDate}}",
      "⏰ *Batas Penawaran: {{quoteDeadline}}*",
      "",
      "📝 Pesan dari CST: {{notesToVendor}}",
      "",
      "Mohon submit penawaran Anda melalui link berikut:",
      "{{vendorFormUrl}}",
      "",
      "_Pesan ini dikirim otomatis oleh sistem B2B Marketplace and Logistic._",
    ].join("\n"),
    revision_fallback: [
      "Halo *{{vendorName}}*,",
      "",
      "Kami mohon revisi harga penawaran Anda{{orderRef}}.",
      "",
      "Alasan: {{reason}}",
      "",
      "Silakan update penawaran melalui:",
      "{{vendorFormUrl}}",
    ].join("\n"),
    vendor_assignment: [
      "🚚 *Job Order — B2B Marketplace and Logistic*",
      "",
      "Order  : *{{orderNumber}}*",
      "Layanan: {{shipmentType}}",
      "Jenis Layanan: {{serviceLabel}}",
      "{{serviceVersionLine}}",
      "Rute   : {{origin}} → {{destination}}",
      "{{estimatedPickupLine}}",
      "{{estimatedDeliveryLine}}",
      "{{estimatedDaysLine}}",
      "Catatan Admin: {{adminNote}}",
      "",
      "✅ Anda telah dipilih sebagai vendor untuk order ini.",
      "",
      "{{specSummaryBlock}}",
      "{{serviceChecklistSummary}}",
      "{{itemsBlock}}",
      "Silakan buka link berikut untuk menerima atau menolak job, dan mengisi detail operasional:",
      "{{jobUrl}}",
      "",
      "_Link berlaku 7 hari. Hubungi admin jika ada kendala._",
    ].join("\n"),
    vendor_order_status_change: [
      "🔔 *Update Status Order — B2B Marketplace and Logistic*",
      "━━━━━━━━━━━━━━━━━━",
      "No. Order  : `{{orderNumber}}`",
      "Customer   : {{customerName}}",
      "Rute       : {{route}}",
      "Vendor     : *{{vendorName}}*",
      "Status     : *{{statusLabel}}*",
      "━━━━━━━━━━━━━━━━━━",
      "{{statusNote}}",
      "{{#if miniFormUrl}}",
      "",
      "📱 Buka mini form: {{miniFormUrl}}",
      "{{/if}}",
      "",
      "_B2B Marketplace and Logistic — Notifikasi Otomatis_",
    ].join("\n"),
  },
  admin_personal_extra: {
    vendor_submission_summary: [
      "📋 *Submission Form Vendor*",
      "Vendor: *{{vendorLabel}}*",
      "PIC: {{picLabel}} · {{contactPhone}}",
      "Order: {{orderNumber}}",
      "Service: {{serviceLabel}}",
      "Harga: {{priceStr}}",
      "Status: {{statusStr}}",
      "_{{timestamp}}_",
    ].join("\n"),
    rfq_vendor_recap: [
      "🔔 *Update Penawaran Vendor*",
      "━━━━━━━━━━━━━━━━━━",
      "📄 Order   : {{orderNumber}}",
      "📋 RFQ     : {{rfqNumber}}",
      "👤 Customer: {{customerName}}",
      "🚚 Jenis   : {{shipmentType}}",
      "📍 Rute    : {{route}}",
      "━━━━━━━━━━━━━━━━━━",
      "{{itemsBlock}}",
      "━━━━━━━━━━━━━━━━━━",
      "{{newSubmitterInfo}}",
      "",
      "{{vendorListWithHeader}}",
      "{{waitingListWithHeader}}",
      "━━━━━━━━━━━━━━━━━━",
      "📊 Bandingkan: {{compareLink}}",
      "_{{timestamp}}_",
    ].join("\n"),
    customer_rejection: [
      "❌ *Customer Tolak Penawaran*",
      "Order: {{orderNumber}}",
      "Customer: {{customerName}}",
      "Catatan: {{notes}}",
    ].join("\n"),
    op_confirm_submitted: [
      "🚚 *Data Operasional Vendor*",
      "Order: {{orderNumber}}",
      "Vendor: *{{vendorName}}*",
      "Service: {{serviceLabel}}",
      "Status: Data operasional sudah diisi.",
    ].join("\n"),
    customer_rfq_response: [
      "{{responseEmoji}} *Customer {{responseLabel}} Penawaran*",
      "",
      "👤 Customer: *{{customerName}}*",
      "📄 Order: *{{orderNumber}}*",
      "🚚 {{shipmentType}}: {{route}}",
      "💰 Penawaran: {{quotedPrice}}",
      "📝 Catatan: {{notes}}",
      "",
      "Silakan cek BizPortal › RFQ untuk tindak lanjut.",
    ].join("\n"),
    product_vendor_response: [
      "{{statusEmoji}} *VENDOR RESPONSE — ORDER PRODUK*",
      "━━━━━━━━━━━━━━━━━━",
      "📄 No. Order : {{orderNumber}}",
      "👤 Customer  : {{customerName}}",
      "🏢 Vendor    : {{vendorName}}",
      "✅ Status    : {{statusLabel}}",
      "💰 Harga     : {{quotedPrice}}",
      "📝 Catatan   : {{notes}}",
      "━━━━━━━━━━━━━━━━━━",
      "📦 Item:",
      "{{itemList}}",
      "━━━━━━━━━━━━━━━━━━",
      "🔗 BizPortal: {{adminUrl}}",
      "_{{timestamp}}_",
    ].join("\n"),
    vendor_awarded: [
      "🏆 *Selamat! Penawaran Anda Dipilih — B2B Marketplace and Logistic*",
      "━━━━━━━━━━━━━━━━━━",
      "Kepada Yth. *{{vendorName}}*,",
      "",
      "Kami dengan senang memberitahukan bahwa penawaran Anda telah *dipilih* untuk order berikut:",
      "",
      "📋 No. RFQ  : {{rfqNumber}}",
      "📄 No. Order: {{orderNumber}}",
      "🚚 Jenis    : {{shipmentType}}",
      "📍 Rute     : {{route}}",
      "📦 Komoditas: {{templateLabel}}",
      "💰 Harga    : {{vendorCost}}",
      "⏱ ETA      : {{eta}}",
      "📝 Catatan  : {{notes}}",
      "📋 *Spesifikasi:*",
      "{{specSummary}}",
      "━━━━━━━━━━━━━━━━━━",
      "{{#if fulfillUrl}}",
      "📱 Buka mini form Anda di sini:",
      "{{fulfillUrl}}",
      "",
      "{{/if}}",
      "Terima kasih atas kepercayaan dan kerja sama Anda 🙏",
      "_B2B Marketplace and Logistic_",
    ].join("\n"),
    vendor_not_selected: [
      "📋 *Informasi Status Penawaran — B2B Marketplace and Logistic*",
      "━━━━━━━━━━━━━━━━━━",
      "Kepada Yth. *{{vendorName}}*,",
      "",
      "Terima kasih telah berpartisipasi dalam proses penawaran untuk:",
      "",
      "📋 No. RFQ  : {{rfqNumber}}",
      "📄 No. Order: {{orderNumber}}",
      "📍 Rute     : {{route}}",
      "━━━━━━━━━━━━━━━━━━",
      "Kami mohon maaf, penawaran Anda *tidak dapat dipilih* untuk pengiriman ini.",
      "",
      "Kami berharap dapat bekerja sama kembali di kesempatan mendatang 🙏",
      "_B2B Marketplace and Logistic_",
    ].join("\n"),
    vendor_selected_admin: [
      "✅ *Vendor Dipilih — RFQ {{rfqNumber}}*",
      "━━━━━━━━━━━━━━━━━━",
      "📄 Order   : {{orderNumber}}",
      "👤 Customer: {{customerName}}",
      "🚚 Jenis   : {{shipmentType}}",
      "📍 Rute    : {{route}}",
      "📦 Komoditas: {{templateLabel}}",
      "━━━━━━━━━━━━━━━━━━",
      "🏢 Vendor  : *{{vendorName}}*",
      "💰 Harga Vendor: {{vendorCost}}",
      "💵 Harga Jual  : {{sellingPrice}}",
      "⏱ ETA     : {{eta}}",
      "━━━━━━━━━━━━━━━━━━",
      "{{quoteSentInfo}}",
      "📦 Forward ke vendor: {{forwardVendorUrl}}",
      "_{{timestamp}}_",
    ].join("\n"),
  },
  invoice_reminder: {
    h7: [
      "📅 *Pengingat Pembayaran — H-7*",
      "━━━━━━━━━━━━━━━━━━",
      "Kepada Yth. *{{customerName}}*,",
      "",
      "Invoice Anda akan jatuh tempo dalam *7 hari lagi*.",
      "",
      "📄 Invoice    : *{{invoiceNumber}}*",
      "📋 No. Order  : {{orderNumber}}",
      "💰 Total      : {{totalAmount}}",
      "💳 Sisa Bayar : {{outstandingAmount}}",
      "📅 Jatuh Tempo: *{{dueDate}}*",
      "━━━━━━━━━━━━━━━━━━",
      "{{#if invoiceUrl}}",
      "Lihat & bayar invoice:",
      "{{invoiceUrl}}",
      "",
      "{{/if}}",
      "Mohon lakukan pembayaran sebelum tanggal jatuh tempo.",
      "Terima kasih 🙏",
      "_B2B Marketplace and Logistic_",
    ].join("\n"),
    h3: [
      "⚠️ *Pengingat Pembayaran — H-3*",
      "━━━━━━━━━━━━━━━━━━",
      "Kepada Yth. *{{customerName}}*,",
      "",
      "Invoice Anda akan jatuh tempo dalam *3 hari lagi*.",
      "",
      "📄 Invoice    : *{{invoiceNumber}}*",
      "📋 No. Order  : {{orderNumber}}",
      "💰 Total      : {{totalAmount}}",
      "💳 Sisa Bayar : {{outstandingAmount}}",
      "📅 Jatuh Tempo: *{{dueDate}}*",
      "━━━━━━━━━━━━━━━━━━",
      "{{#if invoiceUrl}}",
      "Segera bayar invoice Anda:",
      "{{invoiceUrl}}",
      "",
      "{{/if}}",
      "Mohon segera lakukan pembayaran untuk menghindari keterlambatan.",
      "Terima kasih 🙏",
      "_B2B Marketplace and Logistic_",
    ].join("\n"),
    h1: [
      "🔔 *Pengingat PENTING — H-1 Jatuh Tempo*",
      "━━━━━━━━━━━━━━━━━━",
      "Kepada Yth. *{{customerName}}*,",
      "",
      "Invoice Anda akan jatuh tempo *BESOK*.",
      "",
      "📄 Invoice    : *{{invoiceNumber}}*",
      "📋 No. Order  : {{orderNumber}}",
      "💰 Total      : {{totalAmount}}",
      "💳 Sisa Bayar : {{outstandingAmount}}",
      "📅 Jatuh Tempo: *{{dueDate}}*",
      "━━━━━━━━━━━━━━━━━━",
      "{{#if invoiceUrl}}",
      "Bayar sekarang:",
      "{{invoiceUrl}}",
      "",
      "{{/if}}",
      "Harap segera selesaikan pembayaran sebelum besok untuk menghindari denda keterlambatan.",
      "Terima kasih 🙏",
      "_B2B Marketplace and Logistic_",
    ].join("\n"),
    due_today: [
      "🚨 *HARI INI Tanggal Jatuh Tempo Invoice*",
      "━━━━━━━━━━━━━━━━━━",
      "Kepada Yth. *{{customerName}}*,",
      "",
      "Hari ini adalah tanggal jatuh tempo invoice Anda.",
      "",
      "📄 Invoice    : *{{invoiceNumber}}*",
      "📋 No. Order  : {{orderNumber}}",
      "💰 Total      : {{totalAmount}}",
      "💳 Sisa Bayar : {{outstandingAmount}}",
      "📅 Jatuh Tempo: *{{dueDate}}*",
      "━━━━━━━━━━━━━━━━━━",
      "{{#if invoiceUrl}}",
      "Bayar sekarang sebelum terlambat:",
      "{{invoiceUrl}}",
      "",
      "{{/if}}",
      "Mohon lakukan pembayaran hari ini. Hubungi kami jika ada pertanyaan.",
      "Terima kasih 🙏",
      "_B2B Marketplace and Logistic_",
    ].join("\n"),
    overdue: [
      "🔴 *Invoice JATUH TEMPO — Segera Bayar*",
      "━━━━━━━━━━━━━━━━━━",
      "Kepada Yth. *{{customerName}}*,",
      "",
      "Invoice Anda telah melewati tanggal jatuh tempo selama *{{daysOverdue}} hari*.",
      "",
      "📄 Invoice    : *{{invoiceNumber}}*",
      "📋 No. Order  : {{orderNumber}}",
      "💰 Total      : {{totalAmount}}",
      "💳 Sisa Bayar : {{outstandingAmount}}",
      "📅 Jatuh Tempo: *{{dueDate}}* (lewat {{daysOverdue}} hari)",
      "━━━━━━━━━━━━━━━━━━",
      "{{#if invoiceUrl}}",
      "Bayar sekarang:",
      "{{invoiceUrl}}",
      "",
      "{{/if}}",
      "Mohon segera selesaikan pembayaran. Hubungi tim kami jika memerlukan bantuan.",
      "Terima kasih 🙏",
      "_B2B Marketplace and Logistic_",
    ].join("\n"),
  },
} as const;

/**
 * Returns a flat map of all default WA templates.
 * Key format: `${recipient}__${workflowKey}`
 * Used by settings route to pre-populate the editor with defaults.
 */
export function getWaDefaultTemplatesFlatMap(): Record<string, string> {
  const m: Record<string, string> = {};
  const add = (r: string, w: string, body: string) => { m[`${r}__${w}`] = body; };

  // admin_personal
  const ap = DEFAULT_TPL.admin_personal;
  add("admin_personal", "order_new", ap.order_new);
  add("admin_personal", "vendor_submission", ap.vendor_submission);
  add("admin_personal", "vendor_confirmed", ap.vendor_confirmed);
  add("admin_personal", "vendor_rejected", ap.vendor_rejected);
  add("admin_personal", "customer_approved", ap.customer_approved);
  add("admin_personal", "customer_revised", ap.customer_revised);
  add("admin_personal", "customer_rejected", ap.customer_rejected);
  add("admin_personal", "task_update", ap.task_update);
  add("admin_personal", "op_request", ap.op_request);
  add("admin_personal", "driver_assigned", ap.driver_assigned);
  add("admin_personal", "shipment_update", ap.shipment_update);
  add("admin_personal", "customs_update", ap.customs_update);
  add("admin_personal", "delivery_completed", ap.delivery_completed);
  add("admin_personal", "vendor_job_accepted", ap.vendor_job_accepted);
  add("admin_personal", "vendor_job_rejected", ap.vendor_job_rejected);
  add("admin_personal", "vendor_progress_update", ap.vendor_progress_update);
  add("admin_personal", "vendor_pod_uploaded", ap.vendor_pod_uploaded);
  add("admin_personal", "sales_order_created", ap.sales_order_created);
  add("admin_personal", "quotation_sent", ap.quotation_sent);
  add("admin_personal", "sales_order_confirmed", ap.sales_order_confirmed);
  add("admin_personal", "sales_order_delivered", ap.sales_order_delivered);
  add("admin_personal", "invoice_issued", ap.invoice_issued);
  add("admin_personal", "vendor_quote_received", ap.vendor_quote_received);
  add("admin_personal", "rfq_customer_confirmed", ap.rfq_customer_confirmed);
  add("admin_personal", "rfq_customer_rejected", ap.rfq_customer_rejected);
  add("admin_personal", "customer_chose_option", ap.customer_chose_option);
  add("admin_personal", "logistic_operational_status_admin", ap.logistic_operational_status_admin);

  // admin_personal_extra (same recipient)
  const ape = DEFAULT_TPL.admin_personal_extra;
  add("admin_personal", "vendor_submission_summary", ape.vendor_submission_summary);
  add("admin_personal", "rfq_vendor_recap", ape.rfq_vendor_recap);
  add("admin_personal", "customer_rejection", ape.customer_rejection);
  add("admin_personal", "op_confirm_submitted", ape.op_confirm_submitted);
  add("admin_personal", "customer_rfq_response", ape.customer_rfq_response);

  // admin_group
  const ag = DEFAULT_TPL.admin_group;
  add("admin_group", "order_new", ag.order_new);
  add("admin_group", "vendor_submission", ag.vendor_submission);
  add("admin_group", "vendor_confirmed", ag.vendor_confirmed);
  add("admin_group", "vendor_rejected", ag.vendor_rejected);
  add("admin_group", "customer_approved", ag.customer_approved);
  add("admin_group", "customer_revised", ag.customer_revised);
  add("admin_group", "customer_rejected", ag.customer_rejected);
  add("admin_group", "task_update", ag.task_update);
  add("admin_group", "op_request", ag.op_request);
  add("admin_group", "driver_assigned", ag.driver_assigned);
  add("admin_group", "shipment_update", ag.shipment_update);
  add("admin_group", "customs_update", ag.customs_update);
  add("admin_group", "vendor_submission_summary", ag.vendor_submission_summary);
  add("admin_group", "invoice_issued", ag.invoice_issued);
  add("admin_group", "delivery_completed", ag.delivery_completed);
  add("admin_group", "truck_assigned", ag.truck_assigned);

  // customer
  const cu = DEFAULT_TPL.customer;
  add("customer", "order_new", cu.order_new);
  add("customer", "customer_approval", cu.customer_approval);
  add("customer", "customer_options", cu.customer_options);
  add("customer", "operational_update", cu.operational_update);
  add("customer", "customer_approved", cu.customer_approved);
  add("customer", "so_created", cu.so_created);
  add("customer", "driver_assigned", cu.driver_assigned);
  add("customer", "shipment_update", cu.shipment_update);
  add("customer", "customs_update", cu.customs_update);
  add("customer", "delivery_completed", cu.delivery_completed);
  add("customer", "customer_progress_update", cu.customer_progress_update);
  add("customer", "customer_pod_uploaded", cu.customer_pod_uploaded);
  add("customer", "order_completed", cu.order_completed);
  add("customer", "quotation_sent", cu.quotation_sent);
  add("customer", "sales_order_confirmed", cu.sales_order_confirmed);
  add("customer", "sales_order_delivered", cu.sales_order_delivered);
  add("customer", "invoice_issued", cu.invoice_issued);
  add("customer", "logistic_order_status", cu.logistic_order_status);
  add("customer", "quotation_sent_customer", cu.quotation_sent_customer);
  add("customer", "logistic_operational_status", cu.logistic_operational_status);
  add("customer", "truck_assigned", cu.truck_assigned);

  // vendor
  const v = DEFAULT_TPL.vendor;
  add("vendor", "order_new", v.order_new);
  add("vendor", "vendor_request", v.vendor_request);
  add("vendor", "task_link", v.task_link);
  add("vendor", "vendor_revision", v.vendor_revision);
  add("vendor", "op_request", v.op_request);
  add("vendor", "vendor_submit_confirm", v.vendor_submit_confirm);
  add("vendor", "vendor_rfq_forward", v.vendor_rfq_forward);
  add("vendor", "revision_fallback", v.revision_fallback);
  add("vendor", "vendor_assignment", v.vendor_assignment);
  add("vendor", "vendor_order_status_change", v.vendor_order_status_change);
  add("vendor", "vendor_not_selected", ape.vendor_not_selected);

  // product_order → workflow key: product_order_new
  const po = DEFAULT_TPL.product_order;
  add("admin_personal", "product_order_new", po.admin_personal);
  add("admin_group",    "product_order_new", po.admin_group);
  add("customer",       "product_order_new", po.customer);

  // product_order_status → workflow key: product_order_status_update
  const pos = DEFAULT_TPL.product_order_status;
  add("admin_personal", "product_order_status_update", pos.admin_personal);
  add("admin_group",    "product_order_status_update", pos.admin_group);
  add("customer",       "product_order_status_update", pos.customer);

  // invoice_reminder
  const ir = DEFAULT_TPL.invoice_reminder;
  add("customer", "invoice_reminder_h7",  ir.h7);
  add("customer", "invoice_reminder_h3",  ir.h3);
  add("customer", "invoice_reminder_h1",  ir.h1);
  add("customer", "invoice_due_today",    ir.due_today);
  add("customer", "invoice_overdue",      ir.overdue);

  return m;
}

async function notifyAdmin(order: LogisticOrderData): Promise<void> {
  const rows: [string, string][] = [
    ["No. Order", `<strong>${escHtml(order.orderNumber)}</strong>`],
    ["Customer", `${escHtml(order.customerName)}${order.companyName ? ` (${escHtml(order.companyName)})` : ""}`],
    ["Email", escHtml(order.email)],
    ["HP", escHtml(order.phone)],
    ["Jenis", escHtml(order.shipmentType)],
    ["Rute", `${escHtml(order.origin)} → ${escHtml(order.destination)}`],
    ...(order.commodity ? [["Komoditi", escHtml(order.commodity)] as [string, string]] : []),
    ...(order.cargoDescription ? [["Deskripsi", escHtml(order.cargoDescription)] as [string, string]] : []),
    ...(order.grossWeight ? [["Berat", `${escHtml(String(order.grossWeight))} kg`] as [string, string]] : []),
    ...(order.volumeCbm ? [["Volume", `${escHtml(String(order.volumeCbm))} CBM`] as [string, string]] : []),
    ["Layanan", escHtml(order.serviceList).replace(/\n/g, "<br>")],
    ["Total Est.", `Rp ${formatRupiah(order.grandTotal)}`],
    ...(order.requiredDate ? [["Tgl Butuh", escHtml(order.requiredDate)] as [string, string]] : []),
    ...(order.notes ? [["Catatan", escHtml(order.notes)] as [string, string]] : []),
  ];

  // Generate admin review link upfront — used in both WA and email
  const adminReviewUrl = await createAdminReviewLink(order.id).catch(() => "");

  // order_new → kirim ke Admin Personal DAN Admin Group secara terpisah (bukan OR)
  const [tplAdminPersonal, tplAdminGroup, adminGroupWa, personalAdminWa] = await Promise.all([
    getWaTemplateConfig("admin_personal", "order_new", DEFAULT_TPL.admin_personal.order_new),
    getWaTemplateConfig("admin_group", "order_new", DEFAULT_TPL.admin_group.order_new),
    getAdminGroupWa(),
    getAdminWa(),
  ]);

  if (!adminGroupWa && !personalAdminWa) {
    logger.warn("Admin WA not configured — skipping (set FONNTE_ADMIN_WA atau FONNTE_ADMIN_GROUP_ID, atau konfigurasikan via admin panel)");
  }

  // Buat short link sekali — dipakai bersama oleh personal & group
  let adminActionUrl: string | undefined;
  if (order.publicRfqToken) {
    const domain = getPreferredDomain() || "cstlogistic.co.id";
    const longUrl = `https://${domain}/admin-action/${order.publicRfqToken}`;
    adminActionUrl = await generateShortLink(longUrl, {
      context: "admin_action",
      refType: "order",
      refId: order.orderNumber,
    }).catch((err: unknown) => {
      logger.warn({ err }, "admin WA: failed to generate short link, using long URL");
      return longUrl;
    });
  }

  // Kirim ke Admin Personal (template detail dengan semua info)
  if (personalAdminWa) {
    logger.info({ target: personalAdminWa, orderNumber: order.orderNumber }, "Sending admin personal WA notification");
    const personalActionUrl = adminActionUrl;
    sendWhatsApp(personalAdminWa, buildAdminWaMessage(order, tplAdminPersonal, personalActionUrl)).catch((err: unknown) =>
      logger.error({ err }, "WA admin personal notification failed")
    );
  }

  // Kirim ke Admin Group (template ringkas untuk grup)
  if (adminGroupWa) {
    logger.info({ target: adminGroupWa, orderNumber: order.orderNumber }, "Sending admin group WA notification");
    const wrappedActionUrl = adminActionUrl ? `_${adminActionUrl}_` : adminActionUrl;
    sendWhatsApp(adminGroupWa, buildAdminGroupWaMessage(order, tplAdminGroup, wrappedActionUrl)).catch((err: unknown) =>
      logger.error({ err }, "WA admin group notification failed")
    );
  }

  if (isSmtpConfigured()) {
    logger.info({ to: ADMIN_EMAIL, orderNumber: order.orderNumber }, "Sending admin email notification");
    const emailDomain = getPreferredDomain() || "cstlogistic.co.id";
    const reviewCta = adminReviewUrl
      ? `Tinjau dan proses order tanpa login: <a href="${adminReviewUrl}" style="display:inline-block;margin-top:8px;padding:10px 20px;background:#1e40af;color:#fff;border-radius:6px;text-decoration:none;font-weight:600">🚀 Review &amp; Blast Vendor</a>`
      : `Login ke sistem: <a href="https://${emailDomain}/logistic-order">https://${emailDomain}/logistic-order</a>`;
    sendMail({
      to: ADMIN_EMAIL,
      subject: `[ORDER BARU] ${order.orderNumber} — ${order.customerName}`,
      html: buildEmailHtml(
        "Order Logistik Baru Masuk",
        `Order baru telah diterima dari <strong>${escHtml(order.customerName)}</strong>. Silakan tinjau dan proses.`,
        rows,
        reviewCta
      ),
      text:
        `ORDER BARU: ${order.orderNumber}\n` +
        `Customer: ${order.customerName} (${order.companyName})\n` +
        `Rute: ${order.origin} → ${order.destination}\n` +
        `Jenis: ${order.shipmentType}\n` +
        `Total: Rp ${formatRupiah(order.grandTotal)}` +
        (adminReviewUrl ? `\nReview & Blast Vendor: ${adminReviewUrl}` : ""),
    })
      .then(() => logger.info({ to: ADMIN_EMAIL, orderNumber: order.orderNumber }, "Admin email sent successfully"))
      .catch((err: unknown) => logger.error({ err, to: ADMIN_EMAIL }, "Email admin notification failed"));
  } else {
    logger.warn("SMTP not configured — skipping admin email");
  }
}

async function notifyVendors(order: LogisticOrderData): Promise<void> {
  // Skip vendor blast for product and service orders — tidak butuh vendor logistik
  if (order.orderType === "product" || order.orderType === "service") {
    logger.info({ orderNumber: order.orderNumber, orderType: order.orderType }, "notifyVendors: skipping vendor notification for non-shipment order type");
    return;
  }
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
    ["No. Order", `<strong>${escHtml(order.orderNumber)}</strong>`],
    ["Jenis", escHtml(order.shipmentType)],
    ["Rute", `${escHtml(order.origin)} → ${escHtml(order.destination)}`],
    ...(order.commodity ? [["Komoditi", escHtml(order.commodity)] as [string, string]] : []),
    ...(order.cargoDescription ? [["Deskripsi", escHtml(order.cargoDescription)] as [string, string]] : []),
    ...(order.grossWeight ? [["Berat", `${escHtml(String(order.grossWeight))} kg`] as [string, string]] : []),
    ...(order.volumeCbm ? [["Volume", `${escHtml(String(order.volumeCbm))} CBM`] as [string, string]] : []),
    ...(order.vehicleType ? [["Vehicle Type", escHtml(order.vehicleType)] as [string, string]] : []),
    ["Layanan", escHtml(order.serviceList).replace(/\n/g, "<br>")],
    ...(order.requiredDate ? [["Tgl Pickup", escHtml(formatISODate(order.requiredDate))] as [string, string]] : []),
    ...(order.notes ? [["Catatan", escHtml(order.notes)] as [string, string]] : []),
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
      const vendorTpl = await getWaTemplateConfig("vendor", "order_new", DEFAULT_TPL.vendor.order_new);
      const pickupSchedule = buildPickupSchedule(order);
      const contractRateStr = contractRate ? `Rp ${Math.round(contractRate).toLocaleString("id-ID")}` : null;
      const msg = buildVendorWaMessage(order, vendor.name, vendorTpl, {
        pickupSchedule: isTrucking ? pickupSchedule : null,
        contractRate: isTrucking ? contractRateStr : null,
      });
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
          isTrucking ? "Trucking Request Form" : "Permintaan Order Baru dari B2B Marketplace and Logistic",
          `Kepada Yth. <strong>${escHtml(vendor.name)}</strong>,<br><br>${isTrucking ? "Ada permintaan trucking baru. Mohon lengkapi form di bawah dan balas email ini." : "Anda mendapat permintaan pengiriman baru dari B2B Marketplace and Logistic. Silakan balas email ini dengan salah satu format di bawah."}`,
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
    const customerTpl = await getWaTemplateConfig("customer", "order_new", DEFAULT_TPL.customer.order_new);
    sendWhatsApp(order.phone, buildCustomerWaMessage(order, customerTpl)).catch((err: unknown) =>
      logger.error({ err, phone: order.phone }, "WA customer notification failed")
    );
  }

  const rows: [string, string][] = [
    ["No. Order", `<strong>${escHtml(order.orderNumber)}</strong>`],
    ["Status", "<span style='color:#d97706;font-weight:600'>Menunggu Penawaran Harga</span>"],
    ["Jenis", escHtml(order.shipmentType)],
    ["Rute", `${escHtml(order.origin)} → ${escHtml(order.destination)}`],
    ...(order.commodity ? [["Komoditi", escHtml(order.commodity)] as [string, string]] : []),
    ...(order.grossWeight ? [["Berat", `${escHtml(String(order.grossWeight))} kg`] as [string, string]] : []),
    ...(order.volumeCbm ? [["Volume", `${escHtml(String(order.volumeCbm))} CBM`] as [string, string]] : []),
    ["Layanan", escHtml(order.serviceList).replace(/\n/g, "<br>")],
    ...(order.requiredDate ? [["Tgl Butuh", escHtml(order.requiredDate)] as [string, string]] : []),
  ];

  if (isSmtpConfigured()) {
    sendMail({
      to: order.email,
      subject: `Permintaan Diterima — ${order.orderNumber}`,
      html: buildEmailHtml(
        "Permintaan Pengiriman Diterima",
        `Halo <strong>${escHtml(order.customerName)}</strong>,<br><br>Terima kasih telah mempercayakan pengiriman Anda kepada B2B Marketplace and Logistic. Tim kami sedang memproses permintaan Anda dan akan segera mengirimkan penawaran harga terbaik untuk Anda.`,
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

function buildExpiredLinkRefreshMessage(refId: string, newShortUrl: string): string {
  return (
    `🔄 *LINK ADMIN DIPERBARUI OTOMATIS*\n` +
    `━━━━━━━━━━━━━━━━━━\n` +
    `Link *Review & Blast Vendor* untuk order \`${refId}\` sudah kadaluarsa.\n\n` +
    `Link baru telah dibuat secara otomatis (berlaku 72 jam):\n` +
    `🚀 Review & Blast Vendor → ${newShortUrl}\n\n` +
    `_Dikirim: ${nowWIB()}_`
  );
}

/**
 * Kirim notifikasi WhatsApp ke admin group bahwa link admin
 * yang expired sudah diperbarui otomatis dengan link baru.
 */
export async function sendAdminLinkRefreshedNotification(
  refId: string,
  newShortUrl: string,
): Promise<void> {
  const msg = buildExpiredLinkRefreshMessage(refId, newShortUrl);
  const adminGroupWa = await getAdminGroupWa();
  if (adminGroupWa) {
    sendWhatsApp(adminGroupWa, msg).catch((err: unknown) =>
      logger.error({ err }, "WA expired link refresh (group) failed")
    );
  }
}

// ─── Workflow Notification Helpers ────────────────────────────────────────────

function renderWf(
  tplBody: string,
  order: LogisticOrderData,
  extras: Record<string, string | null | undefined> = {},
): string {
  const svcType = deriveServiceType(order.shipmentType, order.orderType);
  const conditions: string[] = svcType ? [svcType] : [];
  if (order.orderItems?.length && !conditions.includes("product")) {
    conditions.push("product");
  }
  return renderTemplate(tplBody, buildOrderVars(order, extras), conditions);
}

// ── Vendor Request (kirim mini form link ke vendor untuk pengisian penawaran) ──
export async function sendVendorRequestNotification(
  order: LogisticOrderData,
  vendorName: string,
  vendorPhone: string,
  vendorMiniFormLink: string,
  templateSnapshot?: Record<string, unknown> | null,
): Promise<void> {
  const tpl = await getWaTemplateConfig("vendor", "vendor_request", DEFAULT_TPL.vendor.vendor_request);
  // Derive qty/unit from first order item for context
  const firstItem = order.orderItems?.[0];
  const quantityOpts = { quantity: firstItem?.qty ?? null, unit: firstItem?.unit ?? null };
  const commodityCtx = buildCommodityContext(templateSnapshot ?? null, quantityOpts);
  const serviceCtx   = buildServiceContext(templateSnapshot ?? null);
  const msg = renderWf(tpl, order, { vendorName, vendorPhone, vendorMiniFormLink, ...commodityCtx, ...serviceCtx });
  sendWhatsApp(vendorPhone, msg).catch((e: unknown) => logger.error({ e, vendorName }, "WA vendor_request failed"));
}

// ── Vendor Submission (admin notif saat vendor submit penawaran) ───────────────
export async function sendVendorSubmissionNotification(
  order: LogisticOrderData,
  vendorName: string,
  vendorPrice: string,
  templateSnapshot?: Record<string, unknown> | null,
): Promise<void> {
  const [tplG, group] = await Promise.all([
    getWaTemplateConfig("admin_group", "vendor_submission", DEFAULT_TPL.admin_group.vendor_submission),
    getAdminGroupWa(),
  ]);
  const commodityCtx = buildCommodityContext(templateSnapshot ?? null);
  const serviceCtx   = buildServiceContext(templateSnapshot ?? null);
  const extras = { vendorName, vendorPrice, ...commodityCtx, ...serviceCtx };
  if (group) sendWhatsApp(group, renderWf(tplG, order, extras)).catch((e: unknown) => logger.error({ e }, "WA vendor_submission (group) failed"));
}

// ── Vendor Submission Group (admin_group notif saat vendor submit — dengan count & compare link) ─
export async function sendVendorSubmissionGroupNotification(
  adminGroupWa: string,
  vars: {
    orderNumber: string;
    vendorName: string;
    vendorPrice: string;
    serviceType?: string | null;
    route?: string | null;
    commodity?: string | null;
    picLabel?: string | null;
    submittedVendorCount: number;
    totalVendorInvited: number;
    vendorComparisonLink?: string | null;
    templateSnapshot?: Record<string, unknown> | null;
  },
  refToken: string,
): Promise<void> {
  const tpl = await getWaTemplateConfig(
    "admin_group",
    "vendor_submission_summary",
    DEFAULT_TPL.admin_group.vendor_submission_summary,
  );
  const compareMessage =
    vars.submittedVendorCount >= 2
      ? `✅ *${vars.submittedVendorCount} vendor* sudah submit — segera *bandingkan penawaran*!`
      : `📥 Penawaran pertama masuk. Menunggu vendor lain.`;
  const commodityCtx = buildCommodityContext(vars.templateSnapshot ?? null);
  const serviceCtx   = buildServiceContext(vars.templateSnapshot ?? null);
  const msg = renderTemplate(tpl, {
    orderNumber: vars.orderNumber,
    vendorName: vars.vendorName,
    vendorPrice: vars.vendorPrice,
    serviceType: vars.serviceType ?? null,
    route: vars.route ?? null,
    commodity: vars.commodity ?? null,
    picLabel: vars.picLabel ?? null,
    submittedVendorCount: String(vars.submittedVendorCount),
    totalVendorInvited: String(vars.totalVendorInvited),
    compareMessage,
    vendorComparisonLink: vars.vendorComparisonLink ?? null,
    timestamp: nowWIB(),
    ...commodityCtx,
    ...serviceCtx,
  });
  sendWhatsApp(adminGroupWa, msg, {
    context: "vendor-submission-group",
    refType: "vendor_mini_form",
    refId: refToken,
  }).catch((e: unknown) => logger.error({ e }, "WA vendor_submission_summary (group) failed"));
}

// ── Vendor Revision (minta revisi harga ke vendor) ────────────────────────────
export async function sendVendorRevisionNotification(
  order: LogisticOrderData,
  vendorName: string,
  vendorPhone: string,
  vendorPrice: string,
  vendorMiniFormLink: string,
  templateSnapshot?: Record<string, unknown> | null,
): Promise<void> {
  const tpl = await getWaTemplateConfig("vendor", "vendor_revision", DEFAULT_TPL.vendor.vendor_revision);
  const commodityCtx = buildCommodityContext(templateSnapshot ?? null);
  const serviceCtx   = buildServiceContext(templateSnapshot ?? null);
  const msg = renderWf(tpl, order, { vendorName, vendorPhone, vendorPrice, vendorMiniFormLink, ...commodityCtx, ...serviceCtx });
  sendWhatsApp(vendorPhone, msg).catch((e: unknown) => logger.error({ e, vendorName }, "WA vendor_revision failed"));
}

// ── Customer Approval (kirim link approval ke customer) ───────────────────────
export async function sendCustomerApprovalNotification(
  order: LogisticOrderData,
  sellingPrice: string,
  customerApprovalLink: string,
  opts?: {
    rfqNumber?: string | null;
    sellingPriceNum?: number | null;
    ppnNominalNum?: number | null;
    ppnPct?: number;
    etaFinal?: string | null;
    validUntil?: string | null;
    templateSnapshot?: Record<string, unknown> | null;
  },
): Promise<void> {
  if (!order.phone) return;
  const tpl = await getWaTemplateConfig("customer", "customer_approval", DEFAULT_TPL.customer.customer_approval);

  // Build financial breakdown
  const sellingNum = opts?.sellingPriceNum ?? null;
  const ppnPct = opts?.ppnPct ?? TAX_RATE_PCT;
  const ppnNominal = opts?.ppnNominalNum != null
    ? opts.ppnNominalNum
    : sellingNum != null
      ? Math.round(sellingNum * ppnPct / (100 + ppnPct))
      : null;
  const subtotalBeforePpn = sellingNum != null && ppnNominal != null
    ? sellingNum - ppnNominal
    : null;

  // Build per-item block (each item: name + qty + subtotal)
  const firstItem = order.orderItems?.[0];
  const itemsBlock: string | null = (() => {
    if (!order.orderItems?.length) return null;
    return order.orderItems.map(i => {
      const qty = i.qty ?? 1;
      const unit = i.unit ?? "unit";
      const lines: string[] = [`• ${i.name} (${qty} ${unit})`];
      if (i.subtotal != null && i.subtotal > 0) {
        lines.push(`  Subtotal : Rp ${Math.round(i.subtotal).toLocaleString("id-ID")}`);
      }
      return lines.join("\n");
    }).join("\n");
  })();

  const commodityCtx = buildCommodityContext(opts?.templateSnapshot ?? null, {
    quantity: firstItem?.qty ?? null,
    unit: firstItem?.unit ?? null,
  });
  const serviceCtx = buildServiceContext(opts?.templateSnapshot ?? null);

  const extras: Record<string, string | null | undefined> = {
    sellingPrice,
    customerApprovalLink,
    rfqNumber: opts?.rfqNumber ?? null,
    itemsBlock,
    subtotalDisplay: subtotalBeforePpn != null
      ? `Rp ${Math.round(subtotalBeforePpn).toLocaleString("id-ID")}`
      : null,
    taxDisplay: ppnNominal != null
      ? `Rp ${Math.round(ppnNominal).toLocaleString("id-ID")}`
      : null,
    totalDisplay: sellingNum != null
      ? `Rp ${Math.round(sellingNum).toLocaleString("id-ID")}`
      : sellingPrice,
    etaFinal: opts?.etaFinal ?? null,
    validUntil: opts?.validUntil != null ? formatISODate(opts.validUntil) : null,
    ...commodityCtx,
    ...serviceCtx,
  };

  const msg = renderWf(tpl, order, extras);
  sendWhatsApp(order.phone, msg).catch((e: unknown) => logger.error({ e }, "WA customer_approval failed"));
}

// ── Customer Approved (notif admin + customer saat customer menyetujui) ──────
export async function sendCustomerApprovedNotification(
  order: LogisticOrderData,
  extras: {
    sellingPrice?: string | null;
    vendorCost?: string | null;
    margin?: string | null;
    fwdUrl?: string | null;
  } = {},
): Promise<void> {
  const [tplG, custTpl, group] = await Promise.all([
    getWaTemplateConfig("admin_group", "customer_approved", DEFAULT_TPL.admin_group.customer_approved),
    getWaTemplateConfig("customer", "customer_approved", DEFAULT_TPL.customer.customer_approved),
    getAdminGroupWa(),
  ]);
  const groupExtras: Record<string, string | null | undefined> = {
    sellingPrice: extras.sellingPrice ?? "—",
    vendorCost: extras.vendorCost ?? "—",
    margin: extras.margin ?? "—",
    fwdUrl: extras.fwdUrl ?? "",
  };
  if (group) sendWhatsApp(group, renderWf(tplG, order, groupExtras)).catch((e: unknown) => logger.error({ e }, "WA customer_approved (group) failed"));
  if (order.phone) sendWhatsApp(order.phone, renderWf(custTpl, order)).catch((e: unknown) => logger.error({ e }, "WA customer_approved (customer) failed"));
}

// ── SO Created (konfirmasi SO ke customer) ────────────────────────────────────
export async function sendSoCreatedNotification(
  order: LogisticOrderData,
  sellingPrice: string,
): Promise<void> {
  if (!order.phone) return;
  const tpl = await getWaTemplateConfig("customer", "so_created", DEFAULT_TPL.customer.so_created);
  const msg = renderWf(tpl, order, { sellingPrice });
  sendWhatsApp(order.phone, msg).catch((e: unknown) => logger.error({ e }, "WA so_created failed"));
}

// ── Op Request (kirim form konfirmasi operasional ke vendor) ──────────────────
export async function sendOpRequestNotification(
  order: LogisticOrderData,
  vendorName: string,
  vendorPhone: string,
  operationalFormLink: string,
  templateSnapshot?: Record<string, unknown> | null,
): Promise<void> {
  const [vendorTpl, groupTpl, adminGroupWa] = await Promise.all([
    getWaTemplateConfig("vendor", "op_request", DEFAULT_TPL.vendor.op_request),
    getWaTemplateConfig("admin_group", "op_request", DEFAULT_TPL.admin_group.op_request),
    getAdminGroupWa(),
  ]);
  const serviceCtx = buildServiceContext(templateSnapshot ?? null);
  const extras = { vendorName, vendorPhone, operationalFormLink, ...serviceCtx };
  sendWhatsApp(vendorPhone, renderWf(vendorTpl, order, extras)).catch((e: unknown) =>
    logger.error({ e, vendorName }, "WA op_request (vendor) failed"),
  );
  if (adminGroupWa) {
    sendWhatsApp(adminGroupWa, renderWf(groupTpl, order, extras)).catch((e: unknown) =>
      logger.error({ e }, "WA op_request (group) failed"),
    );
  }
}

// ── Driver Assigned (notif customer + admin saat driver ditugaskan) ───────────
export async function sendDriverAssignedNotification(
  order: LogisticOrderData,
  driverName: string,
  driverPhone: string,
  plateNumber: string,
  vehicleType: string,
): Promise<void> {
  const [custTpl, groupTpl, adminGroupWa] = await Promise.all([
    getWaTemplateConfig("customer", "driver_assigned", DEFAULT_TPL.customer.driver_assigned),
    getWaTemplateConfig("admin_group", "driver_assigned", DEFAULT_TPL.admin_group.driver_assigned),
    getAdminGroupWa(),
  ]);
  const extras = { driverName, driverPhone, plateNumber, vehicleType };
  if (order.phone) {
    sendWhatsApp(order.phone, renderWf(custTpl, order, extras)).catch((e: unknown) =>
      logger.error({ e }, "WA driver_assigned (customer) failed"),
    );
  }
  if (adminGroupWa) {
    sendWhatsApp(adminGroupWa, renderWf(groupTpl, order, extras)).catch((e: unknown) =>
      logger.error({ e }, "WA driver_assigned (group) failed"),
    );
  }
}

// ── Truck Assigned (info vendor truk ke customer + admin group) ───────────────
export async function sendTruckAssignedCustomerWa(
  order: LogisticOrderData,
  extras: {
    truckVendorName: string;
    truckSource: "internal" | "external";
    truckPrice: number | null;
    productPrice: number | null;
    totalPrice: number | null;
  },
): Promise<void> {
  const fmt = (n: number | null) => n != null ? `Rp ${Math.round(n).toLocaleString("id-ID")}` : "—";
  const vars = {
    truckVendorName: extras.truckVendorName,
    truckSourceLabel: extras.truckSource === "internal" ? "Internal" : "Eksternal",
    truckPrice: fmt(extras.truckPrice),
    productPrice: fmt(extras.productPrice),
    totalPrice: fmt(extras.totalPrice),
  };

  const [custTpl, groupTpl, adminGroupWa] = await Promise.all([
    getWaTemplateConfig("customer", "truck_assigned", DEFAULT_TPL.customer.truck_assigned),
    getWaTemplateConfig("admin_group", "truck_assigned", DEFAULT_TPL.admin_group.truck_assigned),
    getAdminGroupWa(),
  ]);

  if (order.phone) {
    sendWhatsApp(order.phone, renderWf(custTpl, order, vars)).catch((e: unknown) =>
      logger.error({ e }, "WA truck_assigned (customer) failed"),
    );
  }
  if (adminGroupWa) {
    sendWhatsApp(adminGroupWa, renderWf(groupTpl, order, vars)).catch((e: unknown) =>
      logger.error({ e }, "WA truck_assigned (admin_group) failed"),
    );
  }
}

// ── Shipment Update (update status pengiriman ke customer + admin) ────────────
export async function sendShipmentUpdateNotification(
  order: LogisticOrderData,
  extras: {
    vessel?: string; voyage?: string; containerNumber?: string; blNumber?: string;
    airline?: string; awbNumber?: string; flightNumber?: string;
  } = {},
): Promise<void> {
  const [custTpl, groupTpl, adminGroupWa] = await Promise.all([
    getWaTemplateConfig("customer", "shipment_update", DEFAULT_TPL.customer.shipment_update),
    getWaTemplateConfig("admin_group", "shipment_update", DEFAULT_TPL.admin_group.shipment_update),
    getAdminGroupWa(),
  ]);
  if (order.phone) {
    sendWhatsApp(order.phone, renderWf(custTpl, order, extras)).catch((e: unknown) =>
      logger.error({ e }, "WA shipment_update (customer) failed"),
    );
  }
  if (adminGroupWa) {
    sendWhatsApp(adminGroupWa, renderWf(groupTpl, order, extras)).catch((e: unknown) =>
      logger.error({ e }, "WA shipment_update (group) failed"),
    );
  }
}

// ── Customs Update (update status kepabeanan ke customer + admin) ─────────────
export async function sendCustomsUpdateNotification(
  order: LogisticOrderData,
  extras: { ajuNumber?: string; bcType?: string; sppbNumber?: string } = {},
): Promise<void> {
  const [custTpl, groupTpl, adminGroupWa] = await Promise.all([
    getWaTemplateConfig("customer", "customs_update", DEFAULT_TPL.customer.customs_update),
    getWaTemplateConfig("admin_group", "customs_update", DEFAULT_TPL.admin_group.customs_update),
    getAdminGroupWa(),
  ]);
  if (order.phone) {
    sendWhatsApp(order.phone, renderWf(custTpl, order, extras)).catch((e: unknown) =>
      logger.error({ e }, "WA customs_update (customer) failed"),
    );
  }
  if (adminGroupWa) {
    sendWhatsApp(adminGroupWa, renderWf(groupTpl, order, extras)).catch((e: unknown) =>
      logger.error({ e }, "WA customs_update (group) failed"),
    );
  }
}

// ── Delivery Completed (notifikasi pengiriman selesai) ────────────────────────
export async function sendDeliveryCompletedNotification(
  order: LogisticOrderData,
): Promise<void> {
  const [custTpl, groupTpl, adminGroupWa] = await Promise.all([
    getWaTemplateConfig("customer", "delivery_completed", DEFAULT_TPL.customer.delivery_completed),
    getWaTemplateConfig("admin_group", "delivery_completed", DEFAULT_TPL.admin_group.delivery_completed),
    getAdminGroupWa(),
  ]);
  if (order.phone) {
    sendWhatsApp(order.phone, renderWf(custTpl, order)).catch((e: unknown) =>
      logger.error({ e }, "WA delivery_completed (customer) failed"),
    );
  }
  if (adminGroupWa) {
    sendWhatsApp(adminGroupWa, renderWf(groupTpl, order)).catch((e: unknown) =>
      logger.error({ e }, "WA delivery_completed (group) failed"),
    );
  }
}

// ─── Product Order WA Notification ───────────────────────────────────────────

export interface ProductOrderItem {
  productName: string;
  qty: number;
  unit?: string | null;
  subtotal: number;
  sku?: string | null;
  unitPrice?: number | null;
}

export interface ProductOrderData {
  orderNumber: string;
  customerName: string;
  email: string;
  phone: string;
  shippingAddress: string;
  shippingMethod?: string | null;
  notes?: string | null;
  grandTotal: number;
  subtotal?: number | null;
  taxAmount?: number | null;
  taxRate?: number | null;
  items: ProductOrderItem[];
  orderUrl?: string;
  vendorFormUrl?: string;
}

export interface ProductOrderStatusData {
  orderNumber: string;
  customerName: string;
  phone?: string | null;
  statusLabel: string;
}

export async function sendProductOrderStatusUpdateWa(order: ProductOrderStatusData): Promise<void> {
  const vars: Record<string, string | null | undefined> = {
    orderNumber: order.orderNumber,
    customerName: order.customerName,
    phone: order.phone ?? null,
    statusLabel: order.statusLabel,
    timestamp: nowWIB(),
  };

  const [tplAdminGroup, tplCustomer, adminGroupWa] = await Promise.all([
    getWaTemplateConfig("admin_group", "product_order_status_update", DEFAULT_TPL.product_order_status.admin_group),
    getWaTemplateConfig("customer", "product_order_status_update", DEFAULT_TPL.product_order_status.customer),
    getAdminGroupWa(),
  ]);

  if (adminGroupWa) {
    sendWhatsApp(adminGroupWa, renderTemplate(tplAdminGroup, vars)).catch((err: unknown) =>
      logger.error({ err }, "WA product_order_status_update (admin_group) failed"),
    );
  }
  if (order.phone) {
    sendWhatsApp(order.phone, renderTemplate(tplCustomer, vars)).catch((err: unknown) =>
      logger.error({ err }, "WA product_order_status_update (customer) failed"),
    );
  }
}

export async function sendProductOrderWaNotification(order: ProductOrderData): Promise<void> {
  const itemList = order.items
    .map((i) => {
      const skuPart = i.sku ? ` [${i.sku}]` : "";
      const pricePart = i.unitPrice != null && i.unitPrice > 0
        ? ` | Harga: Rp ${formatRupiah(i.unitPrice)}/unit`
        : "";
      return `• ${i.productName}${skuPart}\n  Qty: ${i.qty} ${i.unit ?? "pcs"}${pricePart}\n  Subtotal: Rp ${formatRupiah(i.subtotal)}`;
    })
    .join("\n");

  const effectiveSubtotal = order.subtotal ?? order.items.reduce((s, i) => s + i.subtotal, 0);
  const effectiveTaxRate = order.taxRate ?? 11;
  const effectiveTaxAmount = order.taxAmount ?? Math.round(effectiveSubtotal * effectiveTaxRate / 100);

  const vars: Record<string, string | null | undefined> = {
    orderNumber: order.orderNumber,
    customerName: order.customerName,
    email: order.email,
    phone: order.phone,
    shippingAddress: order.shippingAddress,
    itemList,
    subtotalDisplay: formatRupiah(effectiveSubtotal),
    taxRate: String(effectiveTaxRate),
    taxAmountDisplay: formatRupiah(effectiveTaxAmount),
    grandTotal: formatRupiah(order.grandTotal),
    notes: order.notes ?? null,
    orderUrl: order.orderUrl ?? null,
    vendorFormUrl: order.vendorFormUrl ?? null,
    timestamp: nowWIB(),
  };

  // product_order_new → kirim ke Admin Group dan nomor admin pribadi
  const [tplAdminGroup, tplCustomer, adminGroupWa, adminPhones] = await Promise.all([
    getWaTemplateConfig("admin_group", "product_order_new", DEFAULT_TPL.product_order.admin_group),
    getWaTemplateConfig("customer", "product_order_new", DEFAULT_TPL.product_order.customer),
    getAdminGroupWa(),
    getAdminPhones(),
  ]);

  if (adminGroupWa) {
    sendWhatsApp(adminGroupWa, renderTemplate(tplAdminGroup, vars), { forceFonnte: true, context: "product_order_new", refType: "portal_product_order", refId: order.orderNumber }).catch((err: unknown) =>
      logger.error({ err }, "WA product_order_new (admin_group) failed"),
    );
  }

  for (const phone of adminPhones) {
    sendWhatsApp(phone, renderTemplate(tplAdminGroup, vars), { forceFonnte: true, context: "product_order_new_admin", refType: "portal_product_order", refId: `${order.orderNumber}:${phone}` }).catch((err: unknown) =>
      logger.error({ err, phone }, "WA product_order_new (admin pribadi) failed"),
    );
  }

  if (order.phone) {
    sendWhatsApp(order.phone, renderTemplate(tplCustomer, vars), { forceFonnte: true, context: "product_order_new", refType: "portal_product_order", refId: order.orderNumber }).catch((err: unknown) =>
      logger.error({ err }, "WA product_order_new (customer) failed"),
    );
  }
}

// ── sendProductOrderPickupWaNotification ─────────────────────────────────────
export async function sendProductOrderPickupWaNotification(order: {
  orderNumber: string;
  customerName: string;
  phone: string;
  email: string;
  grandTotal: number;
  notes?: string | null;
  items: { productName: string; qty: number; unit?: string | null; subtotal: number; sku?: string | null }[];
  orderUrl?: string;
}): Promise<void> {
  const itemList = order.items
    .map((i) => {
      const skuPart = i.sku ? ` [${i.sku}]` : "";
      return `• ${i.productName}${skuPart} — ${i.qty} ${i.unit ?? "pcs"} (Rp ${formatRupiah(i.subtotal)})`;
    })
    .join("\n");

  const [adminGroupWa, adminPhones] = await Promise.all([getAdminGroupWa(), getAdminPhones()]);
  const msg = [
    "🏭 *[AMBIL SENDIRI] PESANAN PRODUK BARU*",
    "━━━━━━━━━━━━━━━━━━",
    `No. Order   : \`${order.orderNumber}\``,
    `👤 Customer  : *${order.customerName}*`,
    `📞 HP        : ${order.phone}`,
    `📧 Email     : ${order.email}`,
    "━━━━━━━━━━━━━━━━━━",
    "⚠️ *Customer akan AMBIL SENDIRI di gudang*",
    "Mohon tim gudang menyiapkan barang sebelum customer tiba.",
    "━━━━━━━━━━━━━━━━━━",
    "📦 Detail Produk:",
    itemList,
    "────────────────",
    `💰 Grand Total: *Rp ${formatRupiah(order.grandTotal)}*`,
    order.notes ? `📝 Catatan     : ${order.notes}` : null,
    "━━━━━━━━━━━━━━━━━━",
    order.orderUrl ? `🔗 Lihat di BizPortal:\n${order.orderUrl}` : null,
    "",
    `_Dikirim: ${nowWIB()}_`,
  ].filter((l) => l !== null).join("\n");

  if (adminGroupWa) {
    sendWhatsApp(adminGroupWa, msg, { forceFonnte: true, context: "product_order_pickup", refType: "portal_product_order", refId: order.orderNumber }).catch((err: unknown) =>
      logger.error({ err }, "WA product_order_pickup (admin_group) failed"),
    );
  }

  for (const phone of adminPhones) {
    sendWhatsApp(phone, msg, { forceFonnte: true, context: "product_order_pickup_admin", refType: "portal_product_order", refId: `${order.orderNumber}:${phone}` }).catch((err: unknown) =>
      logger.error({ err, phone }, "WA product_order_pickup (admin pribadi) failed"),
    );
  }
}

// ── sendVendorSubmitConfirmNotification ────────────────────────────────────────
export async function sendVendorSubmitConfirmNotification(
  contactPhone: string,
  picLabel: string,
  vendorLabel: string,
  orderNumber: string | null,
  refToken: string,
): Promise<void> {
  const tpl = await getWaTemplateConfig("vendor", "vendor_submit_confirm", DEFAULT_TPL.vendor.vendor_submit_confirm);
  const msg = renderTemplate(tpl, {
    picLabel,
    vendorLabel,
    orderNumber: orderNumber ?? null,
    timestamp: nowWIB(),
  });
  sendWhatsApp(contactPhone, msg, {
    context: "vendor-mini-form-confirm",
    refType: "vendor_mini_form",
    refId: refToken,
  }).catch(() => {});
}

// ── sendVendorRfqForwardNotification ───────────────────────────────────────────
export async function sendVendorRfqForwardNotification(
  vendorPhone: string,
  vendorLabel: string,
  vars: {
    rfqRef?: string | null;
    customerName?: string | null;
    serviceNeeded?: string | null;
    origin?: string | null;
    destination?: string | null;
    weightVolume?: string | null;
    cargoDesc?: string | null;
    targetDeliveryDate?: string | null;
    quoteDeadline?: string | null;
    notesToVendor?: string | null;
    vendorFormUrl: string;
    templateSnapshot?: Record<string, unknown> | null;
  },
  refToken: string,
): Promise<void> {
  const serviceCtx = buildServiceContext(vars.templateSnapshot ?? null);
  // serviceLabel: snapshot takes priority, fallback to manual serviceNeeded
  const serviceLabel = serviceCtx.serviceLabel ?? vars.serviceNeeded ?? null;
  const tpl = await getWaTemplateConfig("vendor", "vendor_rfq_forward", DEFAULT_TPL.vendor.vendor_rfq_forward);
  const route = (vars.origin && vars.destination) ? `${vars.origin} → ${vars.destination}` : null;
  const msg = renderTemplate(tpl, {
    vendorLabel,
    rfqRef: vars.rfqRef ?? null,
    customerName: vars.customerName ?? null,
    // serviceNeeded populated from snapshot-first for backward-compat with existing templates
    serviceNeeded: serviceLabel,
    // serviceLabel also available for new/custom templates using {{serviceLabel}}
    serviceLabel,
    route,
    weightVolume: vars.weightVolume ?? null,
    cargoDesc: vars.cargoDesc ?? null,
    targetDeliveryDate: vars.targetDeliveryDate ?? null,
    quoteDeadline: vars.quoteDeadline ?? null,
    notesToVendor: vars.notesToVendor ?? null,
    vendorFormUrl: vars.vendorFormUrl,
    timestamp: nowWIB(),
    ...serviceCtx,
  });
  sendWhatsApp(vendorPhone, msg, {
    context: "admin-rfq-forward-vendor-notif",
    refType: "vendor_mini_form",
    refId: refToken,
  }).catch(() => {});
}

// ── sendVendorRevisionFallbackNotification ─────────────────────────────────────
export async function sendVendorRevisionFallbackNotification(
  vendorPhone: string,
  vendorName: string,
  orderNumber: string | null,
  reason: string | null,
  vendorFormUrl: string,
  refId: string,
): Promise<void> {
  const tpl = await getWaTemplateConfig("vendor", "revision_fallback", DEFAULT_TPL.vendor.revision_fallback);
  const orderRef = orderNumber ? ` untuk Order *${orderNumber}*` : "";
  const msg = renderTemplate(tpl, {
    vendorName,
    orderRef,
    reason: reason ?? null,
    vendorFormUrl,
    timestamp: nowWIB(),
  });
  sendWhatsApp(vendorPhone, msg, {
    context: "revision-request",
    refType: "vendor_mini_form",
    refId,
  }).catch(() => {});
}

// ── sendCustomerRejectionAdminNotification ─────────────────────────────────────
export async function sendCustomerRejectionAdminNotification(
  adminWa: string,
  vars: { orderNumber: string | null; customerName: string | null; notes: string | null },
  refToken: string,
): Promise<void> {
  const tpl = await getWaTemplateConfig("admin_personal", "customer_rejection", DEFAULT_TPL.admin_personal_extra.customer_rejection);
  const msg = renderTemplate(tpl, {
    orderNumber: vars.orderNumber ?? null,
    customerName: vars.customerName ?? null,
    notes: vars.notes ?? null,
  });
  sendWhatsApp(adminWa, msg, {
    context: "customer-approval",
    refType: "customer_approval",
    refId: refToken,
  }).catch(() => {});
}

// ── sendOpConfirmSubmittedNotification ─────────────────────────────────────────
export async function sendOpConfirmSubmittedNotification(
  adminWa: string,
  vars: { orderNumber: string | null; vendorName: string | null; serviceLabel: string },
  refToken: string,
): Promise<void> {
  const tpl = await getWaTemplateConfig("admin_personal", "op_confirm_submitted", DEFAULT_TPL.admin_personal_extra.op_confirm_submitted);
  const msg = renderTemplate(tpl, {
    orderNumber: vars.orderNumber ?? null,
    vendorName: vars.vendorName ?? null,
    serviceLabel: vars.serviceLabel,
  });
  sendWhatsApp(adminWa, msg, {
    context: "op-confirm",
    refType: "vendor_op_confirm",
    refId: refToken,
  }).catch(() => {});
}

// ── sendCustomerRfqResponseAdminNotification ───────────────────────────────────
export async function sendCustomerRfqResponseAdminNotification(
  adminWa: string,
  vars: {
    response: "approved" | "revision_requested" | "rejected";
    customerName: string;
    orderNumber: string;
    shipmentType: string;
    origin: string;
    destination: string;
    quotedPrice: string | null;
    notes: string | null;
  },
): Promise<void> {
  const tpl = await getWaTemplateConfig("admin_personal", "customer_rfq_response", DEFAULT_TPL.admin_personal_extra.customer_rfq_response);
  const emoji = vars.response === "approved" ? "✅" : vars.response === "revision_requested" ? "🔄" : "❌";
  const label = vars.response === "approved" ? "MENYETUJUI" :
    vars.response === "revision_requested" ? "MINTA REVISI" : "MENOLAK";
  const msg = renderTemplate(tpl, {
    responseEmoji: emoji,
    responseLabel: label,
    customerName: vars.customerName,
    orderNumber: vars.orderNumber,
    shipmentType: vars.shipmentType,
    route: `${vars.origin} → ${vars.destination}`,
    quotedPrice: vars.quotedPrice ?? null,
    notes: vars.notes ?? null,
    timestamp: nowWIB(),
  });
  sendWhatsApp(adminWa, msg).catch(() => {});
}

// ── sendVendorSubmissionSummaryNotification ────────────────────────────────────
export async function sendVendorSubmissionSummaryNotification(
  adminWa: string,
  vars: {
    vendorLabel: string;
    picLabel: string;
    contactPhone?: string | null;
    orderNumber?: string | null;
    serviceLabel: string;
    priceStr: string;
    statusStr: string;
  },
  refToken: string,
): Promise<void> {
  const tpl = await getWaTemplateConfig("admin_personal", "vendor_submission_summary", DEFAULT_TPL.admin_personal_extra.vendor_submission_summary);
  const msg = renderTemplate(tpl, {
    vendorLabel: vars.vendorLabel,
    picLabel: vars.picLabel,
    contactPhone: vars.contactPhone ?? null,
    orderNumber: vars.orderNumber ?? null,
    serviceLabel: vars.serviceLabel,
    priceStr: vars.priceStr,
    statusStr: vars.statusStr,
    timestamp: nowWIB(),
  });
  sendWhatsApp(adminWa, msg, {
    context: "vendor-mini-form-admin-notif",
    refType: "vendor_mini_form",
    refId: refToken,
  }).catch(() => {});
}

// ── getRfqVendorRecapTemplate ──────────────────────────────────────────────────
export async function getRfqVendorRecapTemplate(): Promise<string> {
  return getWaTemplateConfig("admin_personal", "rfq_vendor_recap", DEFAULT_TPL.admin_personal_extra.rfq_vendor_recap);
}

// ── sendProductVendorResponseAdminWa ──────────────────────────────────────────
export interface ProductVendorResponseData {
  orderNumber: string;
  customerName: string;
  vendorName: string;
  status: "SETUJU" | "TOLAK";
  quotedPrice?: number | null;
  notes?: string | null;
  items?: Array<{ productName: string; qty: number; unit?: string | null; subtotal: number }>;
  adminUrl?: string | null;
}

export async function sendProductVendorResponseAdminWa(data: ProductVendorResponseData): Promise<void> {
  const adminTarget = await getAdminGroupWa();
  if (!adminTarget) return;

  const tpl = await getWaTemplateConfig(
    "admin_personal",
    "product_vendor_response",
    DEFAULT_TPL.admin_personal_extra.product_vendor_response,
  );

  const statusEmoji = data.status === "SETUJU" ? "✅" : "❌";
  const statusLabel = data.status === "SETUJU" ? "✅ SETUJU" : "❌ TOLAK";
  const itemList = data.items?.length
    ? data.items.map((i) => `• ${i.productName} × ${i.qty}${i.unit ? ` ${i.unit}` : ""} — Rp ${i.subtotal.toLocaleString("id-ID")}`).join("\n")
    : null;
  const quotedPrice = data.quotedPrice != null
    ? `Rp ${data.quotedPrice.toLocaleString("id-ID")}`
    : null;

  const msg = renderTemplate(tpl, {
    statusEmoji,
    orderNumber: data.orderNumber,
    customerName: data.customerName,
    vendorName: data.vendorName || "—",
    statusLabel,
    quotedPrice,
    notes: data.notes ?? null,
    itemList,
    adminUrl: data.adminUrl ?? null,
    timestamp: new Date().toLocaleString("id-ID", { timeZone: "Asia/Jakarta" }),
  });

  sendWhatsApp(adminTarget, msg).catch((e: unknown) =>
    logger.error({ e, orderNumber: data.orderNumber }, "sendProductVendorResponseAdminWa failed"),
  );
}

// ── sendVendorAwardedWa ────────────────────────────────────────────────────────
export interface VendorAwardedData {
  vendorName: string;
  vendorPhone: string;
  rfqNumber: string;
  orderNumber: string;
  shipmentType: string;
  origin: string;
  destination: string;
  vendorCost: number | string | null;
  eta?: string | null;
  notes?: string | null;
  fulfillUrl?: string | null;
}

export async function sendVendorAwardedWa(data: VendorAwardedData): Promise<void> {
  const tpl = await getWaTemplateConfig(
    "vendor",
    "vendor_awarded",
    DEFAULT_TPL.admin_personal_extra.vendor_awarded,
  );

  const fmtCost = (v: number | string | null): string | null => {
    if (v == null) return null;
    const n = typeof v === "number" ? v : parseFloat(String(v));
    return isNaN(n) ? null : new Intl.NumberFormat("id-ID", { style: "currency", currency: "IDR", maximumFractionDigits: 0 }).format(n);
  };

  const msg = renderTemplate(tpl, {
    vendorName: data.vendorName,
    rfqNumber: data.rfqNumber,
    orderNumber: data.orderNumber,
    shipmentType: data.shipmentType,
    route: `${data.origin} → ${data.destination}`,
    vendorCost: fmtCost(data.vendorCost),
    eta: data.eta ?? null,
    notes: data.notes ?? null,
    fulfillUrl: data.fulfillUrl ?? null,
  });

  sendWhatsApp(data.vendorPhone, msg, {
    context: "vendor-awarded",
    refType: "rfq",
    refId: data.rfqNumber,
  }).catch((e: unknown) => logger.error({ e, vendorName: data.vendorName }, "sendVendorAwardedWa failed"));
}

// ── sendVendorNotSelectedWa ────────────────────────────────────────────────────
export interface VendorNotSelectedData {
  vendorName: string;
  vendorPhone: string;
  rfqNumber: string;
  orderNumber: string;
  route: string;
}

export async function sendVendorNotSelectedWa(data: VendorNotSelectedData): Promise<void> {
  const tpl = await getWaTemplateConfig(
    "vendor",
    "vendor_not_selected",
    DEFAULT_TPL.admin_personal_extra.vendor_not_selected,
  );
  const msg = renderTemplate(tpl, {
    vendorName: data.vendorName,
    rfqNumber: data.rfqNumber,
    orderNumber: data.orderNumber,
    route: data.route,
  });
  sendWhatsApp(data.vendorPhone, msg, {
    context: "vendor-not-selected",
    refType: "rfq",
    refId: data.rfqNumber,
  }).catch((e: unknown) => logger.error({ e, vendorName: data.vendorName }, "sendVendorNotSelectedWa failed"));
}

// ── sendVendorSelectedAdminWa ──────────────────────────────────────────────────
export interface VendorSelectedAdminData {
  rfqNumber: string;
  orderNumber: string;
  customerName: string;
  companyName?: string | null;
  shipmentType: string;
  origin: string;
  destination: string;
  vendorName: string;
  vendorCost: number | string | null;
  sellingPrice?: number | null;
  eta?: string | null;
  quoteSentToCustomer?: boolean;
  forwardVendorUrl?: string | null;
}

export async function sendVendorSelectedAdminWa(data: VendorSelectedAdminData): Promise<void> {
  const adminTarget = await getAdminGroupWa();
  if (!adminTarget) return;

  const tpl = await getWaTemplateConfig(
    "admin_personal",
    "vendor_selected_admin",
    DEFAULT_TPL.admin_personal_extra.vendor_selected_admin,
  );

  const customerDisplay = data.companyName
    ? `${data.customerName} (${data.companyName})`
    : data.customerName;

  const fmtCost = (v: number | string | null): string | null => {
    if (v == null) return null;
    const n = typeof v === "number" ? v : parseFloat(String(v));
    return isNaN(n) ? null : new Intl.NumberFormat("id-ID", { style: "currency", currency: "IDR", maximumFractionDigits: 0 }).format(n);
  };

  const msg = renderTemplate(tpl, {
    rfqNumber: data.rfqNumber,
    orderNumber: data.orderNumber,
    customerName: customerDisplay,
    shipmentType: data.shipmentType,
    route: `${data.origin} → ${data.destination}`,
    vendorName: data.vendorName,
    vendorCost: fmtCost(data.vendorCost),
    sellingPrice: data.sellingPrice != null ? fmtCost(data.sellingPrice) : null,
    eta: data.eta ?? null,
    quoteSentInfo: data.quoteSentToCustomer ? "📤 Penawaran telah terkirim ke customer" : null,
    forwardVendorUrl: data.forwardVendorUrl ?? null,
    timestamp: new Date().toLocaleString("id-ID", { timeZone: "Asia/Jakarta" }),
  });

  sendWhatsApp(adminTarget, msg).catch((e: unknown) =>
    logger.error({ e }, "sendVendorSelectedAdminWa failed"),
  );
}

// ── Vendor Assignment (kirim job order ke vendor, kembalikan pesan untuk preview API) ──
export interface VendorAssignmentItem {
  name: string;
  qty: number;
  unit: string;
  basicPrice: number;
  taxRate: number; // 0.11 = 11%
}

export async function sendVendorAssignmentNotification(
  orderNumber: string,
  origin: string,
  destination: string,
  shipmentType: string,
  jobUrl: string,
  vendorPhone: string | null | undefined,
  adminNote?: string,
  items?: VendorAssignmentItem[],
  estimatedPickup?: string | null,
  estimatedDelivery?: string | null,
  estimatedDays?: number | null,
  templateSnapshot?: Record<string, unknown> | null,
): Promise<string> {
  const fmtRp = (n: number) => `Rp ${Math.round(n).toLocaleString("id-ID")}`;
  let itemsBlock = "";
  if (items && items.length > 0) {
    const lines = items.map((it) => {
      const ppnPerUnit = it.basicPrice * it.taxRate;
      const total = (it.basicPrice + ppnPerUnit) * it.qty;
      const ppnPct = Math.round(it.taxRate * 100);
      return `• ${it.name}: ${it.qty} ${it.unit} × ${fmtRp(it.basicPrice)} + PPN ${ppnPct}% = *${fmtRp(total)}*`;
    });
    itemsBlock = `📋 *Detail Produk:*\n${lines.join("\n")}\n\n`;
  }
  const serviceCtx = buildServiceContext(templateSnapshot ?? null);
  const serviceVersionLine = serviceCtx.serviceVersion ? `Versi  : ${serviceCtx.serviceVersion}` : null;
  const specSummaryBlock = serviceCtx.specSummary ? `📋 *Ringkasan:*\n${serviceCtx.specSummary}` : null;
  const tpl = await getWaTemplateConfig("vendor", "vendor_assignment", DEFAULT_TPL.vendor.vendor_assignment);
  const vars: Record<string, string | null | undefined> = {
    orderNumber, origin, destination, shipmentType, jobUrl,
    adminNote: adminNote || null,
    itemsBlock: itemsBlock || null,
    estimatedPickupLine: estimatedPickup ? `📅 Est. Pickup  : ${estimatedPickup}` : null,
    estimatedDeliveryLine: estimatedDelivery ? `🏁 Est. Delivery: ${estimatedDelivery}` : null,
    estimatedDaysLine: estimatedDays != null ? `⏱️ Transit      : ${estimatedDays} hari` : null,
    timestamp: nowWIB(),
    ...serviceCtx,
    serviceVersionLine,
    specSummaryBlock,
  };
  const msg = renderTemplate(tpl, vars);
  if (vendorPhone) {
    sendWhatsApp(vendorPhone, msg).catch((e: unknown) => logger.error({ e }, "WA vendor_assignment failed"));
  }
  return msg;
}

// ── Vendor Job Accepted (notif admin saat vendor terima job) ──────────────────
export async function sendVendorJobAcceptedNotification(
  orderNumber: string,
  vendorName: string,
  origin: string,
  destination: string,
  adminWaPhone: string,
  extras?: {
    driverName?: string;
    vehiclePlate?: string;
    pickupTime?: string;
    carrier?: string;
    notes?: string;
  },
): Promise<void> {
  const tpl = await getWaTemplateConfig("admin_personal", "vendor_job_accepted", DEFAULT_TPL.admin_personal.vendor_job_accepted);
  const msg = renderTemplate(tpl, {
    orderNumber, vendorName, origin, destination,
    driverName: extras?.driverName || null,
    vehiclePlate: extras?.vehiclePlate || null,
    pickupTime: extras?.pickupTime || null,
    carrier: extras?.carrier || null,
    notes: extras?.notes || null,
    timestamp: nowWIB(),
  });
  sendWhatsApp(adminWaPhone, msg).catch((e: unknown) => logger.error({ e }, "WA vendor_job_accepted failed"));
}

// ── Vendor Job Rejected (notif admin saat vendor tolak job) ──────────────────
export async function sendVendorJobRejectedNotification(
  orderNumber: string,
  vendorName: string,
  adminWaPhone: string,
  reason?: string,
  route?: string,
  adminOrderUrl?: string,
): Promise<void> {
  const tpl = await getWaTemplateConfig("admin_personal", "vendor_job_rejected", DEFAULT_TPL.admin_personal.vendor_job_rejected);
  const msg = renderTemplate(tpl, {
    orderNumber, vendorName,
    reason: reason || "—",
    route: route || null,
    adminOrderUrl: adminOrderUrl || null,
    timestamp: nowWIB(),
  });
  sendWhatsApp(adminWaPhone, msg).catch((e: unknown) => logger.error({ e }, "WA vendor_job_rejected failed"));
}

// ── Vendor Progress Update (notif admin saat vendor update progress) ──────────
export async function sendVendorProgressUpdateNotification(
  orderNumber: string,
  vendorName: string,
  status: string,
  adminWaPhone: string,
  notes?: string,
  photoUrl?: string,
): Promise<void> {
  const tpl = await getWaTemplateConfig("admin_personal", "vendor_progress_update", DEFAULT_TPL.admin_personal.vendor_progress_update);
  const msg = renderTemplate(tpl, {
    orderNumber, vendorName, status,
    notes: notes || null,
    timestamp: nowWIB(),
  });
  if (photoUrl) {
    sendMediaViaService(adminWaPhone, msg, photoUrl).catch((e: unknown) => logger.error({ e }, "WA vendor_progress_update (media) failed"));
  } else {
    sendWhatsApp(adminWaPhone, msg).catch((e: unknown) => logger.error({ e }, "WA vendor_progress_update failed"));
  }
}

// ── Vendor POD Uploaded (notif admin saat vendor upload POD) ─────────────────
export async function sendVendorPodUploadedNotification(
  orderNumber: string,
  vendorName: string,
  fileCount: number,
  adminWaPhone: string,
  completionNotes?: string,
  photoUrl?: string,
  commodity?: string | null,
  templateSnapshot?: Record<string, unknown> | null,
  quantityOpts?: { quantity?: number | null; unit?: string | null },
): Promise<void> {
  const tpl = await getWaTemplateConfig("admin_personal", "vendor_pod_uploaded", DEFAULT_TPL.admin_personal.vendor_pod_uploaded);
  const commodityCtx = buildCommodityContext(templateSnapshot ?? null, quantityOpts);
  const serviceCtx   = buildServiceContext(templateSnapshot ?? null);
  const msg = renderTemplate(tpl, {
    orderNumber, vendorName,
    commodity: commodity || null,
    fileCount: String(fileCount),
    completionNotes: completionNotes || null,
    timestamp: nowWIB(),
    ...commodityCtx,
    ...serviceCtx,
  });
  if (photoUrl) {
    sendMediaViaService(adminWaPhone, msg, photoUrl).catch((e: unknown) => logger.error({ e }, "WA vendor_pod_uploaded (media) failed"));
  } else {
    sendWhatsApp(adminWaPhone, msg).catch((e: unknown) => logger.error({ e }, "WA vendor_pod_uploaded failed"));
  }
}

// ── Customer Progress Update (notif customer saat ada update progress) ────────
export async function sendCustomerProgressUpdateNotification(
  orderNumber: string,
  customerPhone: string,
  statusLabel: string,
  trackingUrl: string,
  notes?: string,
): Promise<void> {
  const tpl = await getWaTemplateConfig("customer", "customer_progress_update", DEFAULT_TPL.customer.customer_progress_update);
  const msg = renderTemplate(tpl, {
    orderNumber, statusLabel,
    notes: notes || null,
    trackingUrl: trackingUrl || null,
    timestamp: nowWIB(),
  });
  sendWhatsApp(customerPhone, msg).catch((e: unknown) => logger.error({ e }, "WA customer_progress_update failed"));
}

// ── Customer POD Uploaded (notif customer saat vendor upload POD) ─────────────
export async function sendCustomerPodUploadedNotification(
  orderNumber: string,
  vendorName: string,
  customerPhone: string,
  trackingUrl: string,
  completionNotes?: string,
  templateSnapshot?: Record<string, unknown> | null,
): Promise<void> {
  const tpl = await getWaTemplateConfig("customer", "customer_pod_uploaded", DEFAULT_TPL.customer.customer_pod_uploaded);
  const commodityCtx = buildCommodityContext(templateSnapshot ?? null);
  const serviceCtx   = buildServiceContext(templateSnapshot ?? null);
  const msg = renderTemplate(tpl, {
    orderNumber, vendorName,
    completionNotes: completionNotes || null,
    trackingUrl: trackingUrl || null,
    timestamp: nowWIB(),
    ...commodityCtx,
    ...serviceCtx,
  });
  sendWhatsApp(customerPhone, msg).catch((e: unknown) => logger.error({ e }, "WA customer_pod_uploaded failed"));
}

// ── Order Completed (notif customer saat admin konfirmasi order selesai) ──────
export async function sendOrderCompletedNotification(
  orderNumber: string,
  origin: string,
  destination: string,
  customerPhone: string,
  trackingUrl: string,
  adminNotes?: string,
): Promise<void> {
  const tpl = await getWaTemplateConfig("customer", "order_completed", DEFAULT_TPL.customer.order_completed);
  const msg = renderTemplate(tpl, {
    orderNumber, origin, destination,
    adminNotes: adminNotes || null,
    trackingUrl: trackingUrl || null,
    timestamp: nowWIB(),
  });
  sendWhatsApp(customerPhone, msg).catch((e: unknown) => logger.error({ e }, "WA order_completed failed"));
}

// ── Logistic: Vendor Status Change ────────────────────────────────────────────
export async function sendVendorOrderStatusChangeNotification(
  order: { orderNumber: string; customerName: string | null; origin: string | null; destination: string | null },
  statusLabel: string,
  statusNote: string,
  vendorName: string,
  vendorPhone: string,
  miniFormUrl?: string | null,
): Promise<void> {
  const tpl = await getWaTemplateConfig("vendor", "vendor_order_status_change", DEFAULT_TPL.vendor.vendor_order_status_change);
  const route = order.origin && order.destination ? `${order.origin} → ${order.destination}` : "—";
  const vars: Record<string, string | null | undefined> = {
    orderNumber: order.orderNumber,
    customerName: order.customerName || "—",
    route,
    vendorName,
    statusLabel,
    statusNote: statusNote || null,
    miniFormUrl: miniFormUrl ?? null,
    timestamp: nowWIB(),
  };
  const msg = renderTemplate(tpl, vars);
  sendWhatsApp(vendorPhone, msg).catch((e: unknown) => logger.error({ e }, "WA vendor_order_status_change failed"));
}

// ── Logistic: Customer Order Status Change ────────────────────────────────────
export async function sendLogisticOrderStatusCustomerNotification(
  orderNumber: string,
  statusLabel: string,
  customerPhone: string,
): Promise<void> {
  const tpl = await getWaTemplateConfig("customer", "logistic_order_status", DEFAULT_TPL.customer.logistic_order_status);
  const vars: Record<string, string | null | undefined> = {
    orderNumber,
    statusLabel,
    timestamp: nowWIB(),
  };
  const msg = renderTemplate(tpl, vars);
  sendWhatsApp(customerPhone, msg).catch((e: unknown) => logger.error({ e }, "WA logistic_order_status customer failed"));
}

// ── Logistic RFQ: Admin Quote Notification (replaces buildAdminQuoteNotif) ────
export async function sendAdminQuoteNotification(
  rfqNumber: string,
  orderNumber: string,
  vendorName: string,
  approveUrl: string | null,
  quote: {
    vendorPrice: number;
    estimatedPickup?: string | null;
    estimatedDelivery?: string | null;
    estimatedDays?: number | null;
    vendorNotes?: string | null;
  },
  quotePosition: number | undefined,
  adminWaPhone: string | null | undefined,
): Promise<void> {
  if (!adminWaPhone) return;
  const tpl = await getWaTemplateConfig("admin_personal", "vendor_quote_received", DEFAULT_TPL.admin_personal.vendor_quote_received);
  const fmtRp = (n: number) => `Rp ${Math.round(n).toLocaleString("id-ID")}`;
  const vars: Record<string, string | null | undefined> = {
    rfqNumber,
    orderNumber,
    vendorName,
    quotePosition: quotePosition != null ? ` (vendor ke-${quotePosition})` : null,
    vendorPrice: fmtRp(quote.vendorPrice),
    estimatedPickup: quote.estimatedPickup || null,
    estimatedDelivery: quote.estimatedDelivery || null,
    estimatedDays: quote.estimatedDays != null ? String(quote.estimatedDays) : null,
    vendorNotes: quote.vendorNotes || null,
    approveUrl: approveUrl || null,
    timestamp: nowWIB(),
  };
  const msg = renderTemplate(tpl, vars);
  sendWhatsApp(adminWaPhone, msg).catch((e: unknown) => logger.error({ e }, "WA vendor_quote_received failed"));
}

// ── Logistic RFQ: Admin Group Quote Notification (uses admin_group template) ──
export async function sendAdminGroupQuoteNotification(
  rfqNumber: string,
  orderNumber: string,
  vendorName: string,
  quote: {
    vendorPrice: number;
    estimatedPickup?: string | null;
    estimatedDelivery?: string | null;
    estimatedDays?: number | null;
    vendorNotes?: string | null;
  },
  quotePosition: number | undefined,
  adminGroupWaPhone: string,
): Promise<void> {
  const tpl = await getWaTemplateConfig("admin_group", "vendor_submission", DEFAULT_TPL.admin_group.vendor_submission);
  const fmtRp = (n: number) => `Rp ${Math.round(n).toLocaleString("id-ID")}`;
  const vars: Record<string, string | null | undefined> = {
    rfqNumber,
    orderNumber,
    vendorName,
    quotePosition: quotePosition != null ? ` (vendor ke-${quotePosition})` : null,
    vendorPrice: fmtRp(quote.vendorPrice),
    estimatedPickup: quote.estimatedPickup || null,
    estimatedDelivery: quote.estimatedDelivery || null,
    estimatedDays: quote.estimatedDays != null ? String(quote.estimatedDays) : null,
    vendorNotes: quote.vendorNotes || null,
    timestamp: nowWIB(),
  };
  const msg = renderTemplate(tpl, vars);
  sendWhatsApp(adminGroupWaPhone, msg).catch((e: unknown) => logger.error({ e }, "WA vendor_submission (admin group RFQ) failed"));
}

// ── Logistic RFQ: Trucking Vendor Confirmed → Admin ──────────────────────────
export async function sendTruckingVendorConfirmedAdminNotification(
  orderNumber: string,
  vendorName: string,
  basePrice: number,
  finalPrice: number,
  approveUrl: string | null,
  adminWaPhone: string | null | undefined,
): Promise<void> {
  if (!adminWaPhone) return;
  const tpl = await getWaTemplateConfig("admin_personal", "vendor_confirmed", DEFAULT_TPL.admin_personal.vendor_confirmed);
  const fmtRp = (n: number) => `Rp ${Math.round(n).toLocaleString("id-ID")}`;
  const vars: Record<string, string | null | undefined> = {
    orderNumber,
    vendorName,
    vendorPrice: fmtRp(basePrice),
    finalCustomerPrice: fmtRp(finalPrice),
    approveUrl: approveUrl || null,
    timestamp: nowWIB(),
  };
  const msg = renderTemplate(tpl, vars);
  sendWhatsApp(adminWaPhone, msg).catch((e: unknown) => logger.error({ e }, "WA trucking vendor_confirmed admin failed"));
}

// ── Logistic RFQ: Trucking Vendor Rejected → Admin ───────────────────────────
export async function sendTruckingVendorRejectedAdminNotification(
  orderNumber: string,
  vendorName: string,
  approveUrl: string | null,
  adminWaPhone: string | null | undefined,
): Promise<void> {
  if (!adminWaPhone) return;
  const tpl = await getWaTemplateConfig("admin_personal", "vendor_rejected", DEFAULT_TPL.admin_personal.vendor_rejected);
  const vars: Record<string, string | null | undefined> = {
    orderNumber,
    vendorName,
    approveUrl: approveUrl || null,
    timestamp: nowWIB(),
  };
  const msg = renderTemplate(tpl, vars);
  sendWhatsApp(adminWaPhone, msg).catch((e: unknown) => logger.error({ e }, "WA trucking vendor_rejected admin failed"));
}

// ── Logistic RFQ: Quotation Sent to Customer ──────────────────────────────────
export async function sendQuotationSentCustomerNotification(params: {
  orderNumber: string;
  customerName: string;
  serviceType: string;
  route: string;
  sellingPrice: number;
  isTrucking: boolean;
  pickupDate?: string | null;
  pickupTime?: string | null;
  truckType?: string | null;
  commodity?: string | null;
  estimatedPickup?: string | null;
  estimatedDelivery?: string | null;
  confirmUrl: string;
}, customerPhone: string | null | undefined): Promise<void> {
  if (!customerPhone) return;
  const tpl = await getWaTemplateConfig("customer", "quotation_sent_customer", DEFAULT_TPL.customer.quotation_sent_customer);
  const fmtRp = (n: number) => `Rp ${Math.round(n).toLocaleString("id-ID")}`;
  const pickupInfo = params.isTrucking && params.pickupDate
    ? `📅 Pickup: ${params.pickupDate}${params.pickupTime ? ` ${params.pickupTime} WIB` : ""}`
    : null;
  const truckUnit = params.isTrucking && params.truckType
    ? `🚚 Unit: ${params.truckType} | ${params.commodity ?? "Umum"}`
    : null;
  const confirmLine = params.isTrucking
    ? `✅ Setuju & lanjutkan: ${params.confirmUrl}\n❌ Batalkan: ${params.confirmUrl}?cancel=1`
    : (params.confirmUrl ? `📋 *Konfirmasi persetujuan Anda di sini:*\n${params.confirmUrl}` : null);
  const footerLine = params.isTrucking
    ? "⏳ Berlaku: 3 hari"
    : "Atau balas pesan ini / hubungi kami:\n📞 Jakarta: (021) 6241234";
  const vars: Record<string, string | null | undefined> = {
    orderNumber: params.orderNumber,
    customerName: params.customerName,
    serviceType: params.serviceType,
    route: params.route,
    pickupInfo,
    truckUnit,
    commodity: !params.isTrucking ? (params.commodity || null) : null,
    estimatedPickup: !params.isTrucking ? (params.estimatedPickup || null) : null,
    estimatedDelivery: !params.isTrucking ? (params.estimatedDelivery || null) : null,
    sellingPrice: fmtRp(params.sellingPrice),
    confirmLine,
    footerLine,
    timestamp: nowWIB(),
  };
  const msg = renderTemplate(tpl, vars);
  sendWhatsApp(customerPhone, msg).catch((e: unknown) => logger.error({ e }, "WA quotation_sent_customer failed"));
}

// ── Logistic RFQ: Customer Confirmed/Rejected → Admin ────────────────────────
export async function sendRfqCustomerConfirmedAdminNotification(params: {
  orderNumber: string;
  customerName: string;
  sellingPrice: number;
  route: string;
  pickupDate?: string | null;
  pickupTime?: string | null;
  truckType?: string | null;
  soInfo?: string | null;
  orderUrl: string;
}, adminWaPhone: string | null | undefined): Promise<void> {
  if (!adminWaPhone) return;
  const tpl = await getWaTemplateConfig("admin_personal", "rfq_customer_confirmed", DEFAULT_TPL.admin_personal.rfq_customer_confirmed);
  const fmtRp = (n: number) => `Rp ${Math.round(n).toLocaleString("id-ID")}`;
  const pickupInfo = params.pickupDate
    ? `📅 Pickup: ${params.pickupDate}${params.pickupTime ? ` ${params.pickupTime} WIB` : ""}`
    : null;
  const truckUnit = params.truckType ? `🚚 Unit: ${params.truckType}` : null;
  const vars: Record<string, string | null | undefined> = {
    orderNumber: params.orderNumber,
    customerName: params.customerName,
    sellingPrice: fmtRp(params.sellingPrice),
    route: params.route,
    pickupInfo,
    truckUnit,
    soInfo: params.soInfo || null,
    orderUrl: params.orderUrl || null,
    timestamp: nowWIB(),
  };
  const msg = renderTemplate(tpl, vars);
  sendWhatsApp(adminWaPhone, msg).catch((e: unknown) => logger.error({ e }, "WA rfq_customer_confirmed admin failed"));
}

export async function sendRfqCustomerRejectedAdminNotification(params: {
  orderNumber: string;
  customerName: string;
  sellingPrice: number;
  route: string;
  orderUrl: string;
}, adminWaPhone: string | null | undefined): Promise<void> {
  if (!adminWaPhone) return;
  const tpl = await getWaTemplateConfig("admin_personal", "rfq_customer_rejected", DEFAULT_TPL.admin_personal.rfq_customer_rejected);
  const fmtRp = (n: number) => `Rp ${Math.round(n).toLocaleString("id-ID")}`;
  const vars: Record<string, string | null | undefined> = {
    orderNumber: params.orderNumber,
    customerName: params.customerName,
    sellingPrice: fmtRp(params.sellingPrice),
    route: params.route,
    orderUrl: params.orderUrl || null,
    timestamp: nowWIB(),
  };
  const msg = renderTemplate(tpl, vars);
  sendWhatsApp(adminWaPhone, msg).catch((e: unknown) => logger.error({ e }, "WA rfq_customer_rejected admin failed"));
}

// ── Logistic RFQ: Multi-Mode Options Sent to Customer ────────────────────────
export async function sendMultiModeOptionsSentNotification(
  order: { orderNumber: string; origin: string | null; destination: string | null; phone?: string | null },
  shipmentType: string,
  optionSummary: string,
  pickupInfo: string,
  optionUrl: string,
): Promise<void> {
  if (!order.phone) return;
  const tpl = await getWaTemplateConfig("customer", "customer_options", DEFAULT_TPL.customer.customer_options);
  const vars: Record<string, string | null | undefined> = {
    shipmentType,
    orderNumber: order.orderNumber,
    route: order.origin && order.destination ? `${order.origin} → ${order.destination}` : "—",
    pickupInfo: pickupInfo.trim() || null,
    optionSummary: optionSummary.trim() || null,
    optionUrl,
    timestamp: nowWIB(),
  };
  const msg = renderTemplate(tpl, vars);
  sendWhatsApp(order.phone, msg).catch((e: unknown) => logger.error({ e }, "WA multi_mode options_sent customer failed"));
}

// ── Logistic RFQ: Customer Chose Option → Admin ───────────────────────────────
export async function sendCustomerChoseOptionAdminNotification(params: {
  orderNumber: string;
  customerName: string;
  chosenLabel: string;
  sellingPrice: number;
  route: string;
  pickupDate?: string | null;
  pickupTime?: string | null;
  truckType?: string | null;
  vehicleYear?: string | null;
  orderUrl: string;
}, adminWaPhone: string | null | undefined): Promise<void> {
  if (!adminWaPhone) return;
  const tpl = await getWaTemplateConfig("admin_personal", "customer_chose_option", DEFAULT_TPL.admin_personal.customer_chose_option);
  const fmtRp = (n: number) => `Rp ${Math.round(n).toLocaleString("id-ID")}`;
  const pickupInfo = params.pickupDate
    ? `📅 Pickup: ${params.pickupDate}${params.pickupTime ? ` ${params.pickupTime} WIB` : ""}`
    : null;
  const truckUnit = params.truckType ? `🚚 Unit: ${params.truckType}` : null;
  const vars: Record<string, string | null | undefined> = {
    orderNumber: params.orderNumber,
    customerName: params.customerName,
    chosenLabel: params.chosenLabel,
    sellingPrice: fmtRp(params.sellingPrice),
    route: params.route,
    pickupInfo,
    truckUnit,
    vehicleYear: params.vehicleYear ? `📅 Tahun Unit: ${params.vehicleYear}` : null,
    orderUrl: params.orderUrl || null,
    timestamp: nowWIB(),
  };
  const msg = renderTemplate(tpl, vars);
  sendWhatsApp(adminWaPhone, msg).catch((e: unknown) => logger.error({ e }, "WA customer_chose_option admin failed"));
}

// ── Logistic RFQ: Operational Status → Customer + Admin ──────────────────────
export async function sendLogisticOperationalStatusNotification(
  order: { order_number: string; customer_name: string; company_name?: string | null; phone?: string | null },
  statusLabel: string,
  emoji: string,
  adminWaPhone: string | null | undefined,
): Promise<void> {
  const customerName = order.customer_name
    + (order.company_name ? ` (${order.company_name})` : "");
  if (order.phone) {
    const tpl = await getWaTemplateConfig("customer", "logistic_operational_status", DEFAULT_TPL.customer.logistic_operational_status);
    const vars: Record<string, string | null | undefined> = {
      emoji,
      orderNumber: order.order_number,
      customerName,
      statusLabel,
      timestamp: nowWIB(),
    };
    const msg = renderTemplate(tpl, vars);
    sendWhatsApp(order.phone, msg).catch((e: unknown) => logger.error({ e }, "WA logistic_operational_status customer failed"));
  }
  if (adminWaPhone) {
    const tpl = await getWaTemplateConfig("admin_personal", "logistic_operational_status_admin", DEFAULT_TPL.admin_personal.logistic_operational_status_admin);
    const vars: Record<string, string | null | undefined> = {
      emoji,
      orderNumber: order.order_number,
      customerName,
      statusLabel,
      timestamp: nowWIB(),
    };
    const msg = renderTemplate(tpl, vars);
    sendWhatsApp(adminWaPhone, msg).catch((e: unknown) => logger.error({ e }, "WA logistic_operational_status admin failed"));
  }
}

// ── Sales: SO/Quotation Dibuat → Admin ────────────────────────────────────────
export async function sendSalesOrderCreatedNotification(
  orderNumber: string,
  customerName: string,
  docKind: "quote" | "order",
  grandTotal: number,
  adminWaPhone: string | null | undefined,
): Promise<void> {
  if (!adminWaPhone) return;
  const tpl = await getWaTemplateConfig("admin_personal", "sales_order_created", DEFAULT_TPL.admin_personal.sales_order_created);
  const fmtRp = (n: number) => `Rp ${Math.round(n).toLocaleString("id-ID")}`;
  const vars: Record<string, string | null | undefined> = {
    orderNumber,
    customerName,
    docLabel: docKind === "quote" ? "Sales Quotation" : "Sales Order",
    grandTotal: fmtRp(grandTotal),
    tanggal: new Date().toLocaleDateString("id-ID", { day: "2-digit", month: "long", year: "numeric" }),
    timestamp: nowWIB(),
  };
  const msg = renderTemplate(tpl, vars);
  sendWhatsApp(adminWaPhone, msg).catch((e: unknown) => logger.error({ e }, "WA sales_order_created failed"));
}

// ── Sales: Quotation Dikirim ke Customer ──────────────────────────────────────
export async function sendQuotationSentNotification(
  orderNumber: string,
  customerName: string,
  grandTotal: number,
  validStr: string,
  customerPhone: string | null | undefined,
  adminWaPhone: string | null | undefined,
): Promise<void> {
  const fmtRp = (n: number) => `Rp ${Math.round(n).toLocaleString("id-ID")}`;
  const vars: Record<string, string | null | undefined> = {
    orderNumber,
    customerName,
    grandTotal: fmtRp(grandTotal),
    validStr,
    timestamp: nowWIB(),
  };
  if (customerPhone) {
    const tpl = await getWaTemplateConfig("customer", "quotation_sent", DEFAULT_TPL.customer.quotation_sent);
    const msg = renderTemplate(tpl, vars);
    sendWhatsApp(customerPhone, msg).catch((e: unknown) => logger.error({ e }, "WA quotation_sent customer failed"));
  }
  if (adminWaPhone) {
    const tpl = await getWaTemplateConfig("admin_personal", "quotation_sent", DEFAULT_TPL.admin_personal.quotation_sent);
    const msg = renderTemplate(tpl, vars);
    sendWhatsApp(adminWaPhone, msg).catch((e: unknown) => logger.error({ e }, "WA quotation_sent admin failed"));
  }
}

// ── Sales: SO Confirmed ───────────────────────────────────────────────────────
export async function sendSalesOrderConfirmedNotification(
  orderNumber: string,
  customerName: string,
  grandTotal: number,
  expStr: string,
  tanggal: string,
  customerPhone: string | null | undefined,
  adminWaPhone: string | null | undefined,
): Promise<void> {
  const fmtRp = (n: number) => `Rp ${Math.round(n).toLocaleString("id-ID")}`;
  const vars: Record<string, string | null | undefined> = {
    orderNumber,
    customerName,
    grandTotal: fmtRp(grandTotal),
    expStr,
    tanggal,
    timestamp: nowWIB(),
  };
  if (customerPhone) {
    const tpl = await getWaTemplateConfig("customer", "sales_order_confirmed", DEFAULT_TPL.customer.sales_order_confirmed);
    const msg = renderTemplate(tpl, vars);
    sendWhatsApp(customerPhone, msg).catch((e: unknown) => logger.error({ e }, "WA sales_order_confirmed customer failed"));
  }
  if (adminWaPhone) {
    const tpl = await getWaTemplateConfig("admin_personal", "sales_order_confirmed", DEFAULT_TPL.admin_personal.sales_order_confirmed);
    const msg = renderTemplate(tpl, vars);
    sendWhatsApp(adminWaPhone, msg).catch((e: unknown) => logger.error({ e }, "WA sales_order_confirmed admin failed"));
  }
}

// ── Sales: SO Mark Delivered ──────────────────────────────────────────────────
export async function sendSalesOrderDeliveredNotification(
  orderNumber: string,
  customerName: string,
  grandTotal: number,
  customerPhone: string | null | undefined,
  adminWaPhone: string | null | undefined,
): Promise<void> {
  const fmtRp = (n: number) => `Rp ${Math.round(n).toLocaleString("id-ID")}`;
  const vars: Record<string, string | null | undefined> = {
    orderNumber,
    customerName,
    grandTotal: fmtRp(grandTotal),
    timestamp: nowWIB(),
  };
  if (customerPhone) {
    const tpl = await getWaTemplateConfig("customer", "sales_order_delivered", DEFAULT_TPL.customer.sales_order_delivered);
    const msg = renderTemplate(tpl, vars);
    sendWhatsApp(customerPhone, msg).catch((e: unknown) => logger.error({ e }, "WA sales_order_delivered customer failed"));
  }
  if (adminWaPhone) {
    const tpl = await getWaTemplateConfig("admin_personal", "sales_order_delivered", DEFAULT_TPL.admin_personal.sales_order_delivered);
    const msg = renderTemplate(tpl, vars);
    sendWhatsApp(adminWaPhone, msg).catch((e: unknown) => logger.error({ e }, "WA sales_order_delivered admin failed"));
  }
}

// ── Sales: Invoice Diterbitkan ────────────────────────────────────────────────
export async function sendInvoiceIssuedNotification(
  orderNumber: string,
  invNumber: string,
  customerName: string,
  grandTotal: number,
  dueStr: string,
  customerPhone: string | null | undefined,
  adminWaPhone: string | null | undefined,
  opts?: {
    subtotal?: number;
    taxAmount?: number;
    taxRate?: number;
    invoiceUrl?: string;
    orderId?: number;
    templateSnapshot?: Record<string, unknown> | null;
    quantity?: number | null;
    unit?: string | null;
  },
): Promise<void> {
  const fmtRp = (n: number) => `Rp ${Math.round(n).toLocaleString("id-ID")}`;
  const subtotalDisplay = opts?.subtotal != null ? fmtRp(opts.subtotal) : null;
  const taxAmountDisplay = opts?.taxAmount != null ? fmtRp(opts.taxAmount) : null;
  const taxRateStr = opts?.taxRate != null ? String(opts.taxRate) : null;
  const dedupCtx = "customer-invoice-wa";
  const dedupRef = opts?.orderId != null ? `order:${opts.orderId}` : `inv:${invNumber}`;
  const commodityCtx = buildCommodityContext(opts?.templateSnapshot ?? null, {
    quantity: opts?.quantity ?? null,
    unit: opts?.unit ?? null,
  });
  const vars: Record<string, string | null | undefined> = {
    orderNumber,
    invNumber,
    customerName,
    grandTotal: fmtRp(grandTotal),
    dueStr,
    subtotalDisplay,
    taxAmountDisplay,
    taxRate: taxRateStr,
    invoiceUrl: opts?.invoiceUrl ?? null,
    timestamp: nowWIB(),
    ...commodityCtx,
  };
  if (customerPhone) {
    const tpl = await getWaTemplateConfig("customer", "invoice_issued", DEFAULT_TPL.customer.invoice_issued);
    const msg = renderTemplate(tpl, vars);
    sendWhatsApp(customerPhone, msg, { context: dedupCtx, refType: "invoice", refId: dedupRef })
      .catch((e: unknown) => logger.error({ e }, "WA invoice_issued customer failed"));
  }
  if (adminWaPhone) {
    const tpl = await getWaTemplateConfig("admin_personal", "invoice_issued", DEFAULT_TPL.admin_personal.invoice_issued);
    const msg = renderTemplate(tpl, vars);
    sendWhatsApp(adminWaPhone, msg, { context: `invoice_issued_admin`, refType: "invoice", refId: dedupRef })
      .catch((e: unknown) => logger.error({ e }, "WA invoice_issued admin failed"));
  }
  const adminGroupWa = await getAdminGroupWa();
  if (adminGroupWa) {
    const tpl = await getWaTemplateConfig("admin_group", "invoice_issued", DEFAULT_TPL.admin_group.invoice_issued);
    const msg = renderTemplate(tpl, vars);
    sendWhatsApp(adminGroupWa, msg, { context: `invoice_issued_group`, refType: "invoice", refId: dedupRef })
      .catch((e: unknown) => logger.error({ e }, "WA invoice_issued group failed"));
  }
}

// ── sendInvoiceReminderWa ──────────────────────────────────────────────────────
// Kirim WA reminder invoice ke customer sesuai tipe reminder.
// Dipanggil oleh invoiceReminderWorker.
export async function sendInvoiceReminderWa(
  phone: string,
  reminderType: string,
  vars: {
    customerName: string;
    invoiceNumber: string;
    orderNumber?: string | null;
    totalAmount: string;
    outstandingAmount: string;
    dueDate: string;
    invoiceUrl?: string | null;
    daysOverdue?: number;
  },
): Promise<void> {
  const workflowKeyMap: Record<string, string> = {
    h7:        "invoice_reminder_h7",
    h3:        "invoice_reminder_h3",
    h1:        "invoice_reminder_h1",
    due_today: "invoice_due_today",
    overdue_1: "invoice_overdue",
    overdue_7: "invoice_overdue",
  };
  const workflowKey = workflowKeyMap[reminderType];
  if (!workflowKey) return;

  const defaultBodyMap: Record<string, string> = {
    invoice_reminder_h7: DEFAULT_TPL.invoice_reminder.h7,
    invoice_reminder_h3: DEFAULT_TPL.invoice_reminder.h3,
    invoice_reminder_h1: DEFAULT_TPL.invoice_reminder.h1,
    invoice_due_today:   DEFAULT_TPL.invoice_reminder.due_today,
    invoice_overdue:     DEFAULT_TPL.invoice_reminder.overdue,
  };

  const tplBody = await getWaTemplateConfig("customer", workflowKey, defaultBodyMap[workflowKey] ?? "");
  const tvars: Record<string, string | null | undefined> = {
    customerName:      vars.customerName,
    invoiceNumber:     vars.invoiceNumber,
    orderNumber:       vars.orderNumber ?? null,
    totalAmount:       vars.totalAmount,
    outstandingAmount: vars.outstandingAmount,
    dueDate:           vars.dueDate,
    invoiceUrl:        vars.invoiceUrl ?? null,
    daysOverdue:       vars.daysOverdue != null ? String(vars.daysOverdue) : null,
    timestamp:         nowWIB(),
  };
  const msg = renderTemplate(tplBody, tvars);
  await sendWhatsApp(phone, msg, {
    context: `invoice_reminder_${reminderType}`,
    refType: "invoice",
    refId:   vars.invoiceNumber,
  });
}

// ── Product-First Flow WA Helpers ─────────────────────────────────────────────
// Semua fungsi di bawah menggunakan context+refId yang unik per vendor/event
// agar notification_logs dapat melakukan dedup dengan benar.

/**
 * WA ke vendor produk saat Product RFQ dikirim.
 * refId: "{orderId}-{vendorId}" — unik per vendor agar dedup tidak antar-vendor.
 */
export async function sendProductRfqVendorWa(params: {
  vendorPhone: string;
  vendorId: number | string;
  orderId: number | string;
  orderNumber: string;
  rfqNumber: string;
  commodity: string | null;
  origin?: string | null;
  destination?: string | null;
  formUrl: string;
  notes?: string | null;
}): Promise<void> {
  const msg = [
    `📦 *Permintaan Penawaran Produk*`,
    `━━━━━━━━━━━━━━━━`,
    `No RFQ   : *${params.rfqNumber}*`,
    `No Order : *${params.orderNumber}*`,
    `Produk   : ${params.commodity ?? "-"}`,
    `Rute     : ${params.origin ?? "-"} → ${params.destination ?? "-"}`,
    ``,
    `Silakan berikan penawaran harga produk, ketersediaan stok, dan tanggal siap melalui link berikut:`,
    `🔗 ${params.formUrl}`,
    params.notes ? `\n*Catatan:* ${params.notes}` : null,
    ``,
    `Terima kasih atas kerja sama Anda.`,
    `_${nowWIB()}_`,
  ].filter((l) => l !== null).join("\n");

  sendWhatsApp(params.vendorPhone.trim(), msg, {
    context: "product-rfq-blast",
    refType: "logistic_order",
    refId: `${params.orderId}-${params.vendorId}`,
  }).catch(() => {});
}

/**
 * WA ke customer setelah menyetujui harga produk (transisi → Shipment Selection Pending).
 * context="product-approved-customer-wa", refId=orderId
 */
export async function sendShipmentSelectionCustomerWa(params: {
  customerPhone: string;
  customerName: string;
  orderId: number | string;
  orderNumber: string;
  selectionUrl?: string | null;
}): Promise<void> {
  const urlPart = params.selectionUrl
    ? `\n\nSilakan pilih mode pengiriman:\n🔗 ${params.selectionUrl}`
    : "\n\nTim kami akan segera menghubungi Anda untuk memilih layanan pengiriman. 🚚";
  const msg = `✅ *Produk Disetujui*\n\nHalo ${params.customerName}, Anda telah menyetujui penawaran produk untuk order *${params.orderNumber}*.${urlPart}`;

  sendWhatsApp(params.customerPhone.trim(), msg, {
    context: "product-approved-customer-wa",
    refType: "portal_product_order",
    refId: String(params.orderId),
  }).catch(() => {});
}

/**
 * WA ke admin group saat customer memilih mode pengiriman (non-pickup_self).
 * context="shipment-mode-selected-admin", refId=orderId
 */
export async function sendShipmentModeSelectedAdminWa(params: {
  orderId: number | string;
  orderNumber: string;
  customerName: string;
  shipmentMode: string;
  adminGroupWa?: string | null;
}): Promise<void> {
  const target = params.adminGroupWa ?? (await getAdminGroupWa());
  if (!target) return;

  const modeLabel: Record<string, string> = {
    trucking: "Trucking (darat)",
    air_freight: "Kargo Udara",
    sea_freight: "Kargo Laut",
    door_to_door: "Door-to-Door",
    courier: "Kurir",
    air_cargo: "Kargo Udara",
  };

  const msg = [
    `🚚 *Customer Pilih Mode Pengiriman*`,
    `━━━━━━━━━━━━━━━━`,
    `No Order : *${params.orderNumber}*`,
    `Customer : ${params.customerName}`,
    `Mode     : *${modeLabel[params.shipmentMode] ?? params.shipmentMode}*`,
    ``,
    `Silakan proses RFQ pengiriman ke vendor yang sesuai.`,
    `_${nowWIB()}_`,
  ].join("\n");

  sendWhatsApp(target, msg, {
    context: "shipment-mode-selected-admin",
    refType: "portal_product_order",
    refId: String(params.orderId),
  }).catch(() => {});
}

/**
 * WA ke vendor shipper saat Shipment RFQ dikirim.
 * refId: "{orderId}-{vendorId}" — unik per vendor.
 */
export async function sendShipmentRfqVendorWa(params: {
  vendorPhone: string;
  vendorId: number | string;
  orderId: number | string;
  orderNumber: string;
  rfqNumber: string;
  commodity: string | null;
  pickupLocation?: string | null;
  destination?: string | null;
  readyDate?: string | null;
  formUrl: string;
  notes?: string | null;
}): Promise<void> {
  const msg = [
    `🚚 *Permintaan Penawaran Pengiriman*`,
    `━━━━━━━━━━━━━━━━`,
    `No RFQ   : *${params.rfqNumber}*`,
    `No Order : *${params.orderNumber}*`,
    `Muatan   : ${params.commodity ?? "-"}`,
    `Pickup   : ${params.pickupLocation ?? "-"}`,
    `Tujuan   : ${params.destination ?? "-"}`,
    `Tgl Siap : ${params.readyDate ?? "-"}`,
    ``,
    `Silakan berikan penawaran biaya pengiriman melalui link berikut:`,
    `🔗 ${params.formUrl}`,
    params.notes ? `\n*Catatan:* ${params.notes}` : null,
    ``,
    `Terima kasih.`,
    `_${nowWIB()}_`,
  ].filter((l) => l !== null).join("\n");

  sendWhatsApp(params.vendorPhone.trim(), msg, {
    context: "shipment-rfq-blast",
    refType: "logistic_order",
    refId: `${params.orderId}-${params.vendorId}`,
  }).catch(() => {});
}

/**
 * WA ke customer saat produk/order siap diambil (Ready for Pickup).
 * context="ready-for-pickup-customer", refId=orderId
 */
export async function sendReadyForPickupCustomerWa(params: {
  customerPhone: string;
  customerName: string;
  orderId: number | string;
  orderNumber: string;
  pickupLocation?: string | null;
  readyDate?: string | null;
}): Promise<void> {
  const loc = params.pickupLocation ? `\n📍 Lokasi: ${params.pickupLocation}` : "";
  const rd = params.readyDate ? `\n📅 Jadwal: ${params.readyDate}` : "";
  const msg = `📦 *Produk Siap Diambil*\n\nHalo ${params.customerName}, pesanan Anda *${params.orderNumber}* sudah siap untuk diambil.${loc}${rd}\n\nHarap bawa bukti pemesanan. Terima kasih! 🙏`;

  sendWhatsApp(params.customerPhone.trim(), msg, {
    context: "ready-for-pickup-customer",
    refType: "portal_product_order",
    refId: String(params.orderId),
  }).catch(() => {});
}

/**
 * WA ke customer dan admin group saat shipment vendor dikonfirmasi.
 * context: "shipment-vendor-confirmed-admin" / "shipment-vendor-confirmed-customer"
 */
export async function sendShipmentVendorConfirmedWa(params: {
  orderId: number | string;
  orderNumber: string;
  customerName: string;
  customerPhone?: string | null;
  vendorName: string;
  shipmentMode?: string | null;
  eta?: string | null;
  adminGroupWa?: string | null;
}): Promise<void> {
  const target = params.adminGroupWa ?? (await getAdminGroupWa());

  const modeLabel: Record<string, string> = {
    trucking: "Trucking (darat)",
    air_freight: "Kargo Udara",
    sea_freight: "Kargo Laut",
    door_to_door: "Door-to-Door",
    courier: "Kurir",
    air_cargo: "Kargo Udara",
  };
  const modeStr = params.shipmentMode
    ? ` (${modeLabel[params.shipmentMode] ?? params.shipmentMode})`
    : "";
  const etaStr = params.eta ? `\nETA      : ${params.eta}` : "";

  if (target) {
    const adminMsg = [
      `🤝 *Vendor Pengiriman Dikonfirmasi*`,
      `━━━━━━━━━━━━━━━━`,
      `No Order : *${params.orderNumber}*`,
      `Customer : ${params.customerName}`,
      `Vendor   : *${params.vendorName}*`,
      `Mode     : ${modeStr || "-"}`,
      params.eta ? `ETA      : ${params.eta}` : null,
      ``,
      `_${nowWIB()}_`,
    ].filter((l) => l !== null).join("\n");

    sendWhatsApp(target, adminMsg, {
      context: "shipment-vendor-confirmed-admin",
      refType: "portal_product_order",
      refId: String(params.orderId),
    }).catch(() => {});
  }

  if (params.customerPhone) {
    const customerMsg = `🚚 *Vendor Pengiriman Dikonfirmasi*\n\nHalo ${params.customerName}, vendor pengiriman untuk order *${params.orderNumber}* telah dikonfirmasi: *${params.vendorName}*${modeStr}.${etaStr}\n\nBarang Anda akan segera diproses. Terima kasih! 🙏`;

    sendWhatsApp(params.customerPhone.trim(), customerMsg, {
      context: "shipment-vendor-confirmed-customer",
      refType: "portal_product_order",
      refId: String(params.orderId),
    }).catch(() => {});
  }
}

// ── runWaTemplateMigration ─────────────────────────────────────────────────────
// Creates the whatsapp_template_configs table if missing, seeds default templates,
// and upgrades stale rows that are missing required markers.
export async function runWaTemplateMigration(): Promise<void> {
  try {
    // 1. Ensure table exists
    await db.execute(sql`
      CREATE TABLE IF NOT EXISTS whatsapp_template_configs (
        id SERIAL PRIMARY KEY,
        recipient TEXT NOT NULL,
        workflow  TEXT NOT NULL,
        body      TEXT NOT NULL DEFAULT '',
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        CONSTRAINT uq_wa_tpl_cfg UNIQUE (recipient, workflow)
      )
    `);

    // 2. All (recipient, workflow) pairs we manage
    const allPairs: Array<[string, string]> = [
      ["admin_personal", "order_new"],
      ["admin_group",    "order_new"],
      ["customer",       "order_new"],
      ["vendor",         "vendor_request"],
      ["vendor",         "order_new"],
      ["vendor",         "vendor_not_selected"],
      ["customer",       "invoice_reminder_h7"],
      ["customer",       "invoice_reminder_h3"],
      ["customer",       "invoice_reminder_h1"],
      ["customer",       "invoice_due_today"],
      ["customer",       "invoice_overdue"],
    ];

    const tplMap: Record<string, string> = {
      "admin_personal__order_new":      DEFAULT_TPL.admin_personal.order_new,
      "admin_group__order_new":         DEFAULT_TPL.admin_group.order_new,
      "customer__order_new":            DEFAULT_TPL.customer.order_new,
      "vendor__vendor_request":         DEFAULT_TPL.vendor.vendor_request,
      "vendor__order_new":              DEFAULT_TPL.vendor.order_new,
      "vendor__vendor_not_selected":    DEFAULT_TPL.admin_personal_extra.vendor_not_selected,
      "customer__invoice_reminder_h7":  DEFAULT_TPL.invoice_reminder.h7,
      "customer__invoice_reminder_h3":  DEFAULT_TPL.invoice_reminder.h3,
      "customer__invoice_reminder_h1":  DEFAULT_TPL.invoice_reminder.h1,
      "customer__invoice_due_today":    DEFAULT_TPL.invoice_reminder.due_today,
      "customer__invoice_overdue":      DEFAULT_TPL.invoice_reminder.overdue,
    };

    // Required marker per pair — if missing from the DB row, force-upgrade it
    const markerMap: Record<string, string> = {
      "vendor__vendor_request": "{{productListDetail}}",
      "vendor__order_new":      "{{productList}}",
      "admin_personal__order_new": "{{productList}}",
      "admin_group__order_new":    "{{productList}}",
      "customer__order_new":       "{{productList}}",
    };

    const rows = await db.select().from(waTemplateConfigsTable);

    for (const [recipient, workflow] of allPairs) {
      const key = `${recipient}__${workflow}`;
      const newBody = tplMap[key];
      if (!newBody) continue;

      const existing = rows.find((r) => r.recipient === recipient && r.workflow === workflow);
      const requiredMarker = markerMap[key];

      if (!existing) {
        // 3a. Seed missing row
        await db.insert(waTemplateConfigsTable).values({ recipient, workflow, body: newBody });
        logger.info({ recipient, workflow }, "WA template migration: seeded new template");
      } else if (requiredMarker && !existing.body.includes(requiredMarker)) {
        // 3b. Upgrade stale row
        await db.update(waTemplateConfigsTable)
          .set({ body: newBody, updatedAt: new Date() })
          .where(and(
            eq(waTemplateConfigsTable.recipient, recipient),
            eq(waTemplateConfigsTable.workflow, workflow),
          ));
        logger.info({ recipient, workflow }, "WA template migration: upgraded stale template");
      }
    }

    invalidateWaTemplateCache();
    logger.info("WA template migration: done");
  } catch (err) {
    logger.warn({ err }, "WA template migration failed (non-fatal)");
  }
}

