/**
 * vendorCatalogDraft.ts
 *
 * Setelah vendor submit mini form, buat/update vendor_catalog_items dengan
 * status='pending_review'. Tidak pernah auto-publish. Backward compatible:
 * jika data kurang (vendorId / templateSnapshot / priceBase tidak ada), skip silently.
 *
 * priceBase = vendorPrice dari submission (INTERNAL ONLY — tidak pernah ekspos ke customer).
 * priceSell = priceBase × (1 + markup default): product=15%, service=20%.
 */

import { db } from "@workspace/db";
import { vendorCatalogItemsTable, suppliersTable } from "@workspace/db";
import { eq } from "drizzle-orm";

// Markup default per template kind
const DEFAULT_MARKUP: Record<string, number> = {
  product: 0.15,  // 15%
  service: 0.20,  // 20%
};

export function resolveTemplateKind(serviceType: string | null | undefined): "product" | "service" {
  // A marketplace invitation is a product-catalog invitation. Older links
  // may omit service_type entirely, while newer links use "marketplace".
  const normalized = String(serviceType ?? "").trim().toLowerCase();
  if (normalized === "" || normalized === "product" || normalized === "marketplace") {
    return "product";
  }
  return "service";
}

function computePriceSell(priceBase: number, templateKind: "product" | "service"): number {
  const markup = DEFAULT_MARKUP[templateKind] ?? DEFAULT_MARKUP.service;
  return Math.round(priceBase * (1 + markup));
}

/** Parse string date ke Date | undefined (graceful fallback) */
function parseDate(val: unknown): Date | undefined {
  if (!val) return undefined;
  const d = new Date(String(val));
  return isNaN(d.getTime()) ? undefined : d;
}

/** Ambil nilai string dari formData, fallback ke undefined */
function str(fd: Record<string, unknown>, key: string): string | undefined {
  const v = fd[key];
  return v != null && String(v).trim() !== "" ? String(v).trim() : undefined;
}

/** Ambil nilai number dari formData, fallback ke undefined */
function num(fd: Record<string, unknown>, key: string): number | undefined {
  const v = fd[key];
  if (v == null || String(v).trim() === "") return undefined;
  const n = Number(v);
  return isNaN(n) ? undefined : n;
}

export interface SubmissionForCatalog {
  id: number;
  supplierId: number | null | undefined;
  vendorName: string | null | undefined;
  serviceType: string;
  formData: Record<string, unknown> | null | undefined;
  vendorPrice: string | null | undefined;   // numeric as string (Drizzle)
  currency: string | null | undefined;
  attachmentUrl: string | null | undefined;
  templateId: string | null | undefined;
  templateVersion: string | null | undefined;
  templateSnapshot: Record<string, unknown> | null | undefined;
}

export interface LinkForCatalog {
  supplierId: number | null | undefined;
  vendorName: string | null | undefined;
  serviceType: string;
  categoryKey: string | null | undefined;
  templateId: string | null | undefined;
  templateVersion: string | null | undefined;
  templateSnapshot: Record<string, unknown> | null | undefined;
}

/**
 * Utama: buat atau update vendor_catalog_items draft dari submission.
 * Tidak melempar error — semua kegagalan dicatat sebagai warn dan diabaikan.
 */
export async function upsertCatalogDraftFromSubmission(
  submission: SubmissionForCatalog,
  link: LinkForCatalog,
): Promise<{ catalogItemId: number | null; skipped: boolean; reason?: string }> {
  try {
    // ── Guard: vendorId wajib ada ─────────────────────────────────────────────
    const vendorId = submission.supplierId ?? link.supplierId ?? null;
    if (!vendorId) {
      return { catalogItemId: null, skipped: true, reason: "no_vendor_id" };
    }

    // ── Guard: priceBase wajib ada dan > 0 ───────────────────────────────────
    const priceBaseRaw = submission.vendorPrice ? parseFloat(submission.vendorPrice) : 0;
    if (!priceBaseRaw || priceBaseRaw <= 0) {
      return { catalogItemId: null, skipped: true, reason: "no_price_base" };
    }

    // ── Guard: minimal ada formData ───────────────────────────────────────────
    const fd = submission.formData ?? {};
    if (!fd || typeof fd !== "object") {
      return { catalogItemId: null, skipped: true, reason: "no_form_data" };
    }

    // ── Resolve template fields ───────────────────────────────────────────────
    const templateKind = resolveTemplateKind(link.serviceType ?? submission.serviceType);
    const categoryKey  = link.categoryKey ?? null;
    const serviceType  = submission.serviceType;
    const templateId   = submission.templateId   ?? link.templateId   ?? null;
    const templateVersion = submission.templateVersion ?? link.templateVersion ?? null;
    const templateSnapshot = submission.templateSnapshot ?? link.templateSnapshot ?? null;

    // ── Pricing ───────────────────────────────────────────────────────────────
    const priceBase = priceBaseRaw;
    const markupPct = (DEFAULT_MARKUP[templateKind] ?? DEFAULT_MARKUP.service) * 100;
    const priceSell = computePriceSell(priceBase, templateKind);
    const currency  = submission.currency ?? "IDR";

    // ── Nama item ─────────────────────────────────────────────────────────────
    const name =
      str(fd, "product_name") ??
      str(fd, "service_name") ??
      str(fd, "item_name") ??
      str(fd, "name") ??
      (link.vendorName ?? submission.vendorName ?? "") + " — " + serviceType;

    // ── Ambil vendor name dari DB jika tidak ada di submission ─────────────────
    let vendorName = submission.vendorName ?? link.vendorName ?? null;
    if (!vendorName) {
      try {
        const [sup] = await db.select({ name: suppliersTable.name })
          .from(suppliersTable)
          .where(eq(suppliersTable.id, vendorId))
          .limit(1);
        vendorName = sup?.name ?? null;
      } catch { /* non-critical */ }
    }

    // ── Ekstrak field dari formData ───────────────────────────────────────────
    const stockStatus = str(fd, "stock_status") ?? str(fd, "stock_confirmation") ?? null;
    const stockQty    = num(fd, "qty_available") ?? num(fd, "stock_qty") ?? undefined;
    const moq         = num(fd, "min_order")     ?? num(fd, "moq")       ?? 1;
    const unit        = str(fd, "unit")          ?? null;
    const leadTimeRaw = str(fd, "lead_time")     ?? str(fd, "eta")       ?? null;
    const leadTime    = leadTimeRaw != null ? String(leadTimeRaw) : null;
    const validityDate = parseDate(str(fd, "valid_until") ?? str(fd, "validity") ?? str(fd, "validity_date"));
    const location    = str(fd, "location")  ?? str(fd, "area_pickup")   ?? null;
    const origin      = str(fd, "origin")    ?? str(fd, "pol")           ?? null;
    const description = str(fd, "notes")    ?? str(fd, "description")    ?? null;

    // ── Documents: ambil dari attachmentUrl jika ada ──────────────────────────
    const documents: Array<{ name: string; url: string; type: string }> = [];
    if (submission.attachmentUrl) {
      documents.push({ name: "Lampiran Vendor", url: submission.attachmentUrl, type: "attachment" });
    }

    // ── specValues: simpan seluruh formData kecuali field internal (_xxx) ─────
    const specValues: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(fd)) {
      if (!k.startsWith("_")) specValues[k] = v;
    }

    // ── Cari existing catalog item berdasarkan source_submission_id ──────────
    let existingId: number | null = null;
    try {
      const [existing] = await db
        .select({ id: vendorCatalogItemsTable.id })
        .from(vendorCatalogItemsTable)
        .where(eq(vendorCatalogItemsTable.sourceSubmissionId, submission.id))
        .limit(1);
      existingId = existing?.id ?? null;
    } catch { /* non-critical — fallback to insert */ }

    const now = new Date();
    const catalogPayload = {
      vendorId,
      vendorName,
      templateKind,
      type: templateKind, // legacy compatibility; keep both classifiers aligned
      categoryKey,
      serviceType,
      templateId,
      templateVersion,
      templateSnapshot: templateSnapshot as Record<string, unknown> | undefined,
      specValues,
      name,
      description,
      unit,
      moq,
      priceBase: String(priceBase),
      markupPct: String(markupPct),
      priceSell: String(priceSell),
      currency,
      stockStatus: stockStatus ?? "available",
      stockQty: stockQty ?? null,
      leadTime,
      validityDate: validityDate ?? null,
      location,
      origin,
      documents,
      status: "pending_review" as const,
      isPublished: false,
      sourceSubmissionId: submission.id,
      updatedAt: now,
    };

    if (existingId != null) {
      // UPDATE existing draft
      await db
        .update(vendorCatalogItemsTable)
        .set(catalogPayload as any)
        .where(eq(vendorCatalogItemsTable.id, existingId));
      return { catalogItemId: existingId, skipped: false };
    } else {
      // INSERT baru
      const [inserted] = await db
        .insert(vendorCatalogItemsTable)
        .values({
          ...catalogPayload,
          type: templateKind,        // legacy compat
          kategori: categoryKey,     // legacy compat
        } as any)
        .returning({ id: vendorCatalogItemsTable.id });
      return { catalogItemId: inserted?.id ?? null, skipped: false };
    }
  } catch (err: unknown) {
    console.warn("[vendorCatalogDraft] upsert error (non-fatal):", err);
    return { catalogItemId: null, skipped: true, reason: "error" };
  }
}
