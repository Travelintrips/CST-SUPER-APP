/**
 * Centralized WhatsApp Template Service
 *
 * Single entry-point untuk semua operasi render + send WA message di seluruh codebase.
 * Wrap ulang primitives dari orderNotification.ts agar seragam dan testable.
 *
 * Cara pakai:
 *   import { openWhatsAppFlow } from "../services/whatsappTemplateService.js";
 *   await openWhatsAppFlow("order_new", "admin_group", { orderNumber: "ORD/2026/001", ... });
 *
 * Tidak menggantikan alur yang sudah ada — cukup sebagai abstraksi baru yang
 * bisa diadopsi bertahap per workflow.
 */

import {
  getWaTemplateConfig,
  renderTemplate as coreRenderTemplate,
  resolveCondBlocks,
  deriveServiceType,
} from "../lib/orderNotification.js";
import { sendViaService } from "../lib/waTransport.js";
import { logger } from "../lib/logger.js";

// ── Types ──────────────────────────────────────────────────────────────────────

/** Semua recipient types yang dikenal sistem. */
export type RecipientType =
  | "admin_personal"
  | "admin_group"
  | "customer"
  | "vendor"
  | "finance"
  | "warehouse"
  | "driver";

/**
 * Generic context object yang bisa diterima buildVariables().
 * Semua field opsional; service akan map yang ada dan skip yang null/undefined.
 */
export interface WaMessageContext {
  // Identitas order / dokumen
  orderNumber?: string | null;
  rfqNumber?: string | null;
  prNumber?: string | null;
  docNumber?: string | null;
  shipmentNumber?: string | null;

  // Pelanggan / kontak
  customerName?: string | null;
  companyName?: string | null;
  customerPhone?: string | null;
  email?: string | null;

  // Vendor
  vendorName?: string | null;
  vendorPhone?: string | null;

  // Logistik
  origin?: string | null;
  destination?: string | null;
  route?: string | null;
  shipmentType?: string | null;
  orderType?: string | null;
  transportMode?: string | null;
  vehicleType?: string | null;
  commodity?: string | null;
  cargoDescription?: string | null;
  grossWeight?: number | null;
  volumeCbm?: number | null;
  jumlahKoli?: number | null;

  // Finance
  grandTotal?: number | null;
  subtotal?: number | null;
  tax?: number | null;
  amountPaid?: number | null;
  marginPct?: number | null;
  currency?: string;

  // Status / tanggal
  status?: string | null;
  eta?: string | null;
  etd?: string | null;
  requiredDate?: string | null;
  createdAt?: string | Date | null;
  updatedAt?: string | Date | null;

  // Konten / link
  notes?: string | null;
  items?: string | null;         // pre-formatted list
  priceBreakdown?: string | null;
  approvalLink?: string | null;
  rejectLink?: string | null;
  uploadLink?: string | null;
  paymentLink?: string | null;
  trackingLink?: string | null;
  adminActionUrl?: string | null;
  responseUrl?: string | null;

  // Free-form extras (merge ke variables)
  extras?: Record<string, string | null | undefined>;
}

export interface SendResult {
  success: boolean;
  phone: string;
  workflow: string;
  recipient: RecipientType;
  /** Rendered message (useful for logging/debugging) */
  message: string;
  error?: string;
}

// ── Date helpers ───────────────────────────────────────────────────────────────

const TZ = "Asia/Jakarta";

function nowWIB(): string {
  return new Intl.DateTimeFormat("id-ID", {
    timeZone: TZ,
    day: "2-digit", month: "long", year: "numeric",
    hour: "2-digit", minute: "2-digit", hour12: false,
  }).format(new Date()).replace(/\./g, ":");
}

function formatDate(dt: string | Date | null | undefined): string | null {
  if (!dt) return null;
  try {
    const d = typeof dt === "string" ? new Date(dt) : dt;
    if (isNaN(d.getTime())) return null;
    return new Intl.DateTimeFormat("id-ID", {
      timeZone: TZ, day: "2-digit", month: "long", year: "numeric",
    }).format(d);
  } catch { return null; }
}

function fmtRp(n: number | null | undefined): string | null {
  if (n == null) return null;
  return n.toLocaleString("id-ID");
}

// ── Core functions ─────────────────────────────────────────────────────────────

/**
 * Ambil body template dari DB (dengan fallback ke defaultBody jika belum ada).
 * Cache 5 menit — sesuai WA_TEMPLATE_TTL di orderNotification.ts.
 */
export async function getTemplate(
  workflow: string,
  recipient: RecipientType,
  defaultBody = "",
): Promise<string> {
  return getWaTemplateConfig(recipient, workflow, defaultBody);
}

/**
 * Bangun map variables dari WaMessageContext.
 * Semua nilai null/undefined akan di-omit dari baris template secara otomatis
 * oleh renderTemplate().
 */
export function buildVariables(
  ctx: WaMessageContext,
): Record<string, string | null | undefined> {
  const svcType = ctx.shipmentType
    ? deriveServiceType(ctx.shipmentType, ctx.orderType ?? undefined)
    : ctx.orderType ?? "";

  const route = ctx.route
    ?? ((ctx.origin && ctx.destination) ? `${ctx.origin} → ${ctx.destination}` : null)
    ?? ctx.origin
    ?? ctx.destination
    ?? null;

  const vars: Record<string, string | null | undefined> = {
    // Identitas
    orderNumber: ctx.orderNumber ?? null,
    rfqNumber: ctx.rfqNumber ?? null,
    prNumber: ctx.prNumber ?? null,
    docNumber: ctx.docNumber ?? null,
    shipmentNumber: ctx.shipmentNumber ?? null,

    // Pelanggan
    customerName: ctx.customerName ?? null,
    customerDisplay: ctx.customerName
      ? ctx.customerName + (ctx.companyName ? ` (${ctx.companyName})` : "")
      : null,
    companyName: ctx.companyName ?? null,
    customerPhone: ctx.customerPhone ?? null,
    email: ctx.email ?? null,
    phone: ctx.customerPhone ?? ctx.vendorPhone ?? null,

    // Vendor
    vendorName: ctx.vendorName ?? null,
    vendorPhone: ctx.vendorPhone ?? null,

    // Logistik
    route,
    origin: ctx.origin ?? null,
    destination: ctx.destination ?? null,
    serviceType: svcType || null,
    shipmentType: ctx.shipmentType ?? null,
    transportMode: ctx.transportMode ?? ctx.shipmentType ?? null,
    vehicleType: ctx.vehicleType ?? null,
    commodity: ctx.commodity ?? null,
    cargoDescription: ctx.cargoDescription ?? null,
    grossWeightDisplay: ctx.grossWeight != null ? `${ctx.grossWeight} kg` : null,
    volumeDisplay: ctx.volumeCbm != null ? `${ctx.volumeCbm} CBM` : null,
    jumlahKoliDisplay: ctx.jumlahKoli != null ? `${ctx.jumlahKoli} koli` : null,

    // Finance
    grandTotal: fmtRp(ctx.grandTotal),
    totalEst: fmtRp(ctx.grandTotal),
    subtotal: fmtRp(ctx.subtotal),
    subtotalEst: fmtRp(ctx.subtotal),
    tax: fmtRp(ctx.tax),
    taxEst: fmtRp(ctx.tax),
    amountPaid: fmtRp(ctx.amountPaid),
    currency: ctx.currency ?? "IDR",

    // Status / tanggal
    status: ctx.status ?? null,
    tanggal: formatDate(ctx.createdAt),
    tanggalUpdate: formatDate(ctx.updatedAt),
    eta: ctx.eta ?? null,
    etd: ctx.etd ?? null,
    requiredDate: ctx.requiredDate ?? null,
    timestamp: nowWIB(),

    // Konten / link
    notes: ctx.notes ?? null,
    items: ctx.items ?? null,
    priceBreakdown: ctx.priceBreakdown ?? null,
    approvalLink: ctx.approvalLink ?? null,
    rejectLink: ctx.rejectLink ?? null,
    uploadLink: ctx.uploadLink ?? null,
    paymentLink: ctx.paymentLink ?? null,
    trackingLink: ctx.trackingLink ?? null,
    adminActionUrl: ctx.adminActionUrl ?? null,
    responseUrl: ctx.responseUrl ?? null,

    // Extras
    ...(ctx.extras ?? {}),
  };

  return vars;
}

/**
 * Render {{#if serviceType}}...{{/if}} conditional blocks.
 * serviceType bisa string atau array string (multi-match).
 */
export function renderConditionalBlocks(
  template: string,
  variables: Record<string, string | null | undefined>,
): string {
  const svcType = variables["serviceType"] ?? "";
  return resolveCondBlocks(template, svcType);
}

/**
 * Hapus baris kosong berlebih (lebih dari 1 baris kosong berurutan → 1 baris kosong).
 */
export function removeEmptyLines(text: string): string {
  return text.replace(/\n{3,}/g, "\n\n").trim();
}

/**
 * Full render pipeline: conditional blocks → variable substitution → collapse empty lines.
 *
 * Baris yang mengandung variable kosong/null akan di-omit otomatis.
 */
export function renderTemplate(
  template: string,
  variables: Record<string, string | null | undefined>,
): string {
  const svcType = variables["serviceType"] ?? "";
  const rendered = coreRenderTemplate(template, variables, svcType);
  return removeEmptyLines(rendered);
}

/**
 * Build wa.me deeplink untuk dibuka di browser/mobile.
 * phone: nomor dengan kode negara tanpa + (contoh: "628123456789")
 */
export function buildWhatsAppUrl(phone: string, message: string): string {
  const cleanPhone = phone.replace(/\D/g, "");
  const encoded = encodeURIComponent(message);
  return `https://wa.me/${cleanPhone}?text=${encoded}`;
}

/**
 * Orchestrate full WA send flow:
 *  1. getTemplate(workflow, recipient)
 *  2. buildVariables(context)
 *  3. renderTemplate(template, variables)
 *  4. sendWhatsApp(phone, message)
 *
 * phone harus ada di context (customerPhone atau vendorPhone tergantung recipient).
 * Jika phone tidak ada → log warning dan return { success: false }.
 */
export async function openWhatsAppFlow(
  workflow: string,
  recipient: RecipientType,
  context: WaMessageContext,
  phone?: string,
  defaultBody?: string,
): Promise<SendResult> {
  const resolvedPhone = phone
    ?? (recipient === "vendor" ? context.vendorPhone : context.customerPhone)
    ?? null;

  const ref = context.orderNumber ?? context.rfqNumber ?? context.prNumber ?? workflow;

  if (!resolvedPhone) {
    logger.warn({ workflow, recipient, ref }, "[whatsappTemplateService] phone tidak tersedia, WA tidak dikirim");
    return {
      success: false,
      phone: "",
      workflow,
      recipient,
      message: "",
      error: "phone tidak tersedia",
    };
  }

  try {
    const templateBody = await getTemplate(workflow, recipient, defaultBody ?? "");

    if (!templateBody) {
      logger.warn({ workflow, recipient, ref }, "[whatsappTemplateService] template kosong, WA tidak dikirim");
      return {
        success: false,
        phone: resolvedPhone,
        workflow,
        recipient,
        message: "",
        error: "template kosong",
      };
    }

    const variables = buildVariables(context);
    const message = renderTemplate(templateBody, variables);

    await sendViaService(resolvedPhone, message);

    logger.info({ workflow, recipient, phone: resolvedPhone, ref }, "[whatsappTemplateService] WA terkirim");
    return { success: true, phone: resolvedPhone, workflow, recipient, message };

  } catch (err) {
    const error = err instanceof Error ? err.message : String(err);
    logger.error({ err, workflow, recipient, ref }, "[whatsappTemplateService] gagal kirim WA");
    return { success: false, phone: resolvedPhone, workflow, recipient, message: "", error };
  }
}

/**
 * Kirim ke beberapa recipient sekaligus (batch).
 * Semua dikirim paralel via Promise.allSettled.
 */
export async function openWhatsAppFlowBatch(
  workflow: string,
  targets: Array<{ recipient: RecipientType; phone: string; context: WaMessageContext; defaultBody?: string }>,
): Promise<SendResult[]> {
  const results = await Promise.allSettled(
    targets.map(t => openWhatsAppFlow(workflow, t.recipient, t.context, t.phone, t.defaultBody)),
  );
  return results.map(r =>
    r.status === "fulfilled"
      ? r.value
      : { success: false, phone: "", workflow, recipient: "admin_personal" as RecipientType, message: "", error: String((r as PromiseRejectedResult).reason) },
  );
}
