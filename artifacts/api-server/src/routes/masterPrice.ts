/**
 * Master Price Management — Phase 1
 *
 * Prefix: /admin/master-price  (via portal router → /api/portal)
 * Full URL example: GET /api/portal/admin/master-price
 *
 * Tidak mengubah endpoint lama. Backward compatible.
 */

import { Router } from "express";
import { db } from "@workspace/db";
import { sql, type SQL } from "drizzle-orm";
import multer from "multer";
import ExcelJS from "exceljs";
import * as XLSX from "xlsx";
import { requirePortalAdmin } from "../lib/supabaseAuth.js";
import type { PortalAuthReq } from "../lib/supabaseAuth.js";

export const masterPriceRouter = Router();

// ── helpers ──────────────────────────────────────────────────────────────────

function actorOf(req: any): { id: string; email: string } {
  return {
    id: String((req as PortalAuthReq).portalCustomerId
      ?? (req as any).user?.id
      ?? "unknown"),
    email: (req as any).user?.email ?? "portal-admin",
  };
}

function computeSell(base: number, markup: number, isInternal: boolean): number | null {
  const effectiveMarkup = isInternal ? 0 : markup;
  if (base <= 0) return null;
  return Math.ceil(base * (1 + effectiveMarkup / 100));
}

async function isApprovalRequired(): Promise<boolean> {
  const rows = await db.execute(sql`
    SELECT value FROM marketplace_price_config WHERE key = 'require_approval'
  `);
  return (rows.rows?.[0] as any)?.value === "true";
}

async function insertHistory(opts: {
  catalogItemId: number;
  itemName?: string | null;
  vendorId?: number | null;
  vendorName?: string | null;
  vendorType: "internal" | "external";
  currency?: string | null;
  priceBaseOld?: number | null;
  priceBaseNew: number;
  markupOld?: number | null;
  markupNew: number;
  priceSellOld?: number | null;
  priceSellNew: number | null;
  reason?: string | null;
  changedBy: string;
  approvalStatus: "auto_approved" | "pending" | "approved";
  effectiveAt?: Date | null;
}): Promise<number> {
  const rows = await db.execute(sql`
    INSERT INTO marketplace_price_history
      (catalog_item_id, item_name, vendor_id, vendor_name, vendor_type, currency,
       price_base_old, price_base_new, markup_old, markup_new,
       price_sell_old, price_sell_new, reason, changed_by,
       approval_status, effective_at)
    VALUES (
      ${opts.catalogItemId}, ${opts.itemName ?? null}, ${opts.vendorId ?? null},
      ${opts.vendorName ?? null}, ${opts.vendorType}, ${opts.currency ?? "IDR"},
      ${opts.priceBaseOld ?? null}, ${opts.priceBaseNew},
      ${opts.markupOld ?? null}, ${opts.markupNew},
      ${opts.priceSellOld ?? null}, ${opts.priceSellNew ?? null},
      ${opts.reason ?? null}, ${opts.changedBy},
      ${opts.approvalStatus}, ${opts.effectiveAt ?? null}
    )
    RETURNING id
  `);
  return (rows.rows?.[0] as any)?.id as number;
}

async function applyPriceNow(
  catalogItemId: number,
  priceBase: number,
  markupPct: number,
  priceSell: number | null,
): Promise<void> {
  await db.execute(sql`
    UPDATE vendor_catalog_items
    SET price_base = ${priceBase},
        markup_pct = ${markupPct},
        price_sell = ${priceSell},
        updated_at = NOW()
    WHERE id = ${catalogItemId}
  `);
}

async function auditLog(req: any, action: string, resourceId: number | string, before: object, after: object): Promise<void> {
  const actor = actorOf(req);
  void db.execute(sql`
    INSERT INTO erp_audit_logs
      (user_id, user_email, action, module, reference_id, old_data, new_data, ip_address, created_at)
    VALUES (
      ${actor.id}, ${actor.email}, ${action}, 'marketplace_price',
      ${String(resourceId)},
      ${JSON.stringify(before)}::jsonb,
      ${JSON.stringify(after)}::jsonb,
      ${(req as any).ip ?? null}, NOW()
    )
  `).catch(e => console.error("[masterPrice] audit error", e));
}

/** Build WHERE conditions as SQL fragments, joined with AND. Returns empty sql`` if no conditions. */
function buildWhere(parts: SQL[]): SQL {
  if (parts.length === 0) return sql``;
  return sql`AND ${sql.join(parts, sql` AND `)}`;
}

const _upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 10 * 1024 * 1024 } });

// ── GET /admin/master-price/stats ─────────────────────────────────────────────

masterPriceRouter.get("/stats", requirePortalAdmin, async (_req, res) => {
  try {
    const [statsRows, pendingRows, lastImportRows] = await Promise.all([
      db.execute(sql`
        SELECT
          COUNT(*) FILTER (WHERE COALESCE(s.is_internal_vendor, false) = true)  AS total_internal,
          COUNT(*) FILTER (WHERE COALESCE(s.is_internal_vendor, false) = false) AS total_external,
          COUNT(*) FILTER (WHERE vci.price_sell IS NULL OR vci.price_sell = 0)  AS without_price,
          COUNT(*) FILTER (WHERE vci.updated_at::date = CURRENT_DATE)           AS updated_today
        FROM vendor_catalog_items vci
        JOIN suppliers s ON s.id = vci.vendor_id
      `),
      db.execute(sql`
        SELECT COUNT(*) AS cnt FROM marketplace_price_history WHERE approval_status = 'pending'
      `),
      db.execute(sql`
        SELECT MAX(changed_at) AS ts FROM marketplace_price_history WHERE reason = 'import'
      `),
    ]);

    const row = (statsRows.rows?.[0] as any) ?? {};
    return res.json({
      totalInternal:   Number(row.total_internal   ?? 0),
      totalExternal:   Number(row.total_external   ?? 0),
      withoutPrice:    Number(row.without_price    ?? 0),
      pendingApproval: Number((pendingRows.rows?.[0] as any)?.cnt ?? 0),
      updatedToday:    Number(row.updated_today    ?? 0),
      lastImport:      (lastImportRows.rows?.[0] as any)?.ts ?? null,
    });
  } catch (e) {
    console.error("[masterPrice] stats error", e);
    return res.status(500).json({ error: "Gagal memuat statistik" });
  }
});

// ── GET /admin/master-price/config ─────────────────────────────────────────────

masterPriceRouter.get("/config", requirePortalAdmin, async (_req, res) => {
  try {
    const rows = await db.execute(sql`SELECT key, value FROM marketplace_price_config`);
    const config: Record<string, string> = {};
    for (const r of (rows.rows ?? []) as any[]) config[r.key] = r.value;
    return res.json(config);
  } catch (e) {
    return res.status(500).json({ error: "Gagal memuat konfigurasi" });
  }
});

// ── PUT /admin/master-price/config ─────────────────────────────────────────────

masterPriceRouter.put("/config", requirePortalAdmin, async (req, res) => {
  try {
    const { require_approval } = req.body ?? {};
    if (typeof require_approval !== "boolean") {
      return res.status(400).json({ message: "require_approval harus boolean" });
    }
    const actor = actorOf(req);
    await db.execute(sql`
      INSERT INTO marketplace_price_config (key, value, updated_at, updated_by)
      VALUES ('require_approval', ${String(require_approval)}, NOW(), ${actor.email})
      ON CONFLICT (key) DO UPDATE
        SET value = EXCLUDED.value, updated_at = NOW(), updated_by = EXCLUDED.updated_by
    `);
    return res.json({ ok: true, require_approval });
  } catch (e) {
    return res.status(500).json({ error: "Gagal menyimpan konfigurasi" });
  }
});

// ── GET /admin/master-price (list) ────────────────────────────────────────────

masterPriceRouter.get("/", requirePortalAdmin, async (req, res) => {
  try {
    const {
      page = "1", limit = "50",
      vendorType, status, category, supplierId, search,
    } = req.query as Record<string, string>;

    const pageNum = Math.max(1, parseInt(page, 10) || 1);
    const limitNum = Math.min(200, Math.max(1, parseInt(limit, 10) || 50));
    const offset = (pageNum - 1) * limitNum;

    const parts: SQL[] = [];
    if (vendorType === "internal")  parts.push(sql`COALESCE(s.is_internal_vendor, false) = true`);
    else if (vendorType === "external") parts.push(sql`COALESCE(s.is_internal_vendor, false) = false`);
    if (status && status !== "all") parts.push(sql`vci.status = ${status}`);
    if (category && category !== "all") parts.push(sql`(vci.category_key = ${category} OR vci.kategori = ${category})`);
    if (supplierId && !isNaN(Number(supplierId))) parts.push(sql`vci.vendor_id = ${Number(supplierId)}`);
    if (search?.trim()) {
      const q = `%${search.trim()}%`;
      parts.push(sql`(vci.name ILIKE ${q} OR COALESCE(vci.vendor_name, s.name) ILIKE ${q})`);
    }
    const where = buildWhere(parts);

    const [countResult, listResult] = await Promise.all([
      db.execute(sql`
        SELECT COUNT(*) AS total
        FROM vendor_catalog_items vci
        JOIN suppliers s ON s.id = vci.vendor_id
        WHERE 1=1 ${where}
      `),
      db.execute(sql`
        SELECT
          vci.id,
          vci.name,
          COALESCE(vci.vendor_name, s.name)            AS supplier_name,
          s.id                                          AS supplier_id,
          COALESCE(vci.category_key, vci.kategori)     AS category,
          COALESCE(s.is_internal_vendor, false)         AS is_internal,
          vci.status,
          vci.is_published,
          vci.price_base,
          vci.markup_pct,
          vci.price_sell,
          vci.currency,
          vci.updated_at
        FROM vendor_catalog_items vci
        JOIN suppliers s ON s.id = vci.vendor_id
        WHERE 1=1 ${where}
        ORDER BY vci.updated_at DESC NULLS LAST, vci.id DESC
        LIMIT ${limitNum} OFFSET ${offset}
      `),
    ]);

    const total = Number((countResult.rows?.[0] as any)?.total ?? 0);
    return res.json({
      data: (listResult.rows ?? []).map((r: any) => ({
        id:          r.id,
        name:        r.name,
        supplierName:r.supplier_name,
        supplierId:  r.supplier_id,
        category:    r.category,
        isInternal:  r.is_internal === true,
        status:      r.status,
        isPublished: r.is_published,
        priceBase:   r.price_base  != null ? Number(r.price_base)  : null,
        markupPct:   r.markup_pct  != null ? Number(r.markup_pct)  : 0,
        priceSell:   r.price_sell  != null ? Number(r.price_sell)  : null,
        currency:    r.currency    ?? "IDR",
        updatedAt:   r.updated_at,
      })),
      total, page: pageNum, limit: limitNum, pages: Math.ceil(total / limitNum),
    });
  } catch (e) {
    console.error("[masterPrice] list error", e);
    return res.status(500).json({ error: "Gagal memuat daftar produk" });
  }
});

// ── PATCH /admin/master-price/:id ────────────────────────────────────────────

masterPriceRouter.patch("/:id", requirePortalAdmin, async (req, res) => {
  const id = parseInt(String(req.params.id), 10);
  if (isNaN(id)) return res.status(400).json({ message: "ID tidak valid" });

  const { priceBase, markup, reason, effectiveAt } = req.body ?? {};

  const base = priceBase != null ? parseFloat(String(priceBase)) : null;
  const markupVal = markup != null ? parseFloat(String(markup)) : 0;

  if (base !== null && (isNaN(base) || base < 0)) {
    return res.status(400).json({ message: "Price Base tidak boleh negatif" });
  }
  if (isNaN(markupVal) || markupVal < 0) {
    return res.status(400).json({ message: "Markup tidak boleh negatif" });
  }
  if (markupVal > 100) {
    return res.status(400).json({ message: "Markup tidak boleh melebihi 100%" });
  }

  try {
    const itemRows = await db.execute(sql`
      SELECT
        vci.id, vci.name, vci.vendor_id, vci.vendor_name,
        vci.price_base, vci.markup_pct, vci.price_sell, vci.currency,
        COALESCE(s.name, vci.vendor_name) AS supplier_name,
        COALESCE(s.is_internal_vendor, false) AS is_internal
      FROM vendor_catalog_items vci
      JOIN suppliers s ON s.id = vci.vendor_id
      WHERE vci.id = ${id}
    `);
    const item = itemRows.rows?.[0] as any;
    if (!item) return res.status(404).json({ message: "Produk tidak ditemukan" });

    const isInternal: boolean = item.is_internal === true;
    const effectiveMarkup = isInternal ? 0 : markupVal;
    const finalBase = base ?? Number(item.price_base ?? 0);
    const priceSell = computeSell(finalBase, effectiveMarkup, isInternal);

    const needsApproval = await isApprovalRequired();
    const effectiveDate = effectiveAt ? new Date(effectiveAt) : null;
    const isScheduled = effectiveDate instanceof Date && !isNaN(effectiveDate.getTime()) && effectiveDate > new Date();
    const actor = actorOf(req);

    await insertHistory({
      catalogItemId: id,
      itemName:     item.name,
      vendorId:     item.vendor_id,
      vendorName:   item.supplier_name,
      vendorType:   isInternal ? "internal" : "external",
      currency:     item.currency ?? "IDR",
      priceBaseOld: Number(item.price_base ?? 0),
      priceBaseNew: finalBase,
      markupOld:    Number(item.markup_pct ?? 0),
      markupNew:    effectiveMarkup,
      priceSellOld: item.price_sell != null ? Number(item.price_sell) : null,
      priceSellNew: priceSell,
      reason:       reason?.trim() || null,
      changedBy:    actor.email,
      approvalStatus: needsApproval ? "pending" : "auto_approved",
      effectiveAt:  isScheduled ? effectiveDate : null,
    });

    if (!needsApproval && !isScheduled) {
      await applyPriceNow(id, finalBase, effectiveMarkup, priceSell);
    }

    auditLog(req, "UPDATE_PRICE", id,
      { price_base: item.price_base, markup_pct: item.markup_pct, price_sell: item.price_sell },
      { price_base: finalBase, markup_pct: effectiveMarkup, price_sell: priceSell, approval_status: needsApproval ? "pending" : "auto_approved" },
    );

    return res.json({
      ok: true,
      applied: !needsApproval && !isScheduled,
      pendingApproval: needsApproval,
      scheduledAt: isScheduled ? effectiveDate : null,
      priceSell, effectiveMarkup, isInternal,
    });
  } catch (e) {
    console.error("[masterPrice] patch error", e);
    return res.status(500).json({ error: "Gagal memperbarui harga" });
  }
});

// ── POST /admin/master-price/bulk-update ─────────────────────────────────────

masterPriceRouter.post("/bulk-update", requirePortalAdmin, async (req, res) => {
  const { ids, priceBase, markup, reason } = req.body ?? {};
  if (!Array.isArray(ids) || ids.length === 0) {
    return res.status(400).json({ message: "Pilih minimal 1 produk" });
  }

  const base   = priceBase != null ? parseFloat(String(priceBase)) : null;
  const markupV = markup   != null ? parseFloat(String(markup))    : null;

  if (base !== null && (isNaN(base) || base < 0)) {
    return res.status(400).json({ message: "Price Base tidak boleh negatif" });
  }
  if (markupV !== null && (isNaN(markupV) || markupV < 0 || markupV > 100)) {
    return res.status(400).json({ message: "Markup tidak valid (0–100)" });
  }

  const actor = actorOf(req);
  const needsApproval = await isApprovalRequired();
  const results: { id: number; ok: boolean; error?: string }[] = [];

  for (const rawId of ids) {
    const id = parseInt(String(rawId), 10);
    if (isNaN(id)) { results.push({ id: rawId, ok: false, error: "ID tidak valid" }); continue; }
    try {
      const ir = await db.execute(sql`
        SELECT vci.id, vci.name, vci.vendor_id, vci.price_base, vci.markup_pct, vci.price_sell,
               vci.currency, vci.vendor_name,
               COALESCE(s.name, vci.vendor_name) AS supplier_name,
               COALESCE(s.is_internal_vendor, false) AS is_internal
        FROM vendor_catalog_items vci
        JOIN suppliers s ON s.id = vci.vendor_id
        WHERE vci.id = ${id}
      `);
      const item = ir.rows?.[0] as any;
      if (!item) { results.push({ id, ok: false, error: "Tidak ditemukan" }); continue; }

      const isInternal: boolean = item.is_internal === true;
      const finalBase   = base   ?? Number(item.price_base ?? 0);
      const finalMarkup = isInternal ? 0 : (markupV ?? Number(item.markup_pct ?? 0));
      const priceSell   = computeSell(finalBase, finalMarkup, isInternal);

      await insertHistory({
        catalogItemId: id, itemName: item.name, vendorId: item.vendor_id,
        vendorName: item.supplier_name, vendorType: isInternal ? "internal" : "external",
        currency: item.currency ?? "IDR",
        priceBaseOld: Number(item.price_base ?? 0), priceBaseNew: finalBase,
        markupOld: Number(item.markup_pct ?? 0),    markupNew: finalMarkup,
        priceSellOld: item.price_sell != null ? Number(item.price_sell) : null,
        priceSellNew: priceSell, reason: reason?.trim() || "bulk_update",
        changedBy: actor.email, approvalStatus: needsApproval ? "pending" : "auto_approved",
        effectiveAt: null,
      });
      if (!needsApproval) await applyPriceNow(id, finalBase, finalMarkup, priceSell);
      results.push({ id, ok: true });
    } catch (e) {
      results.push({ id, ok: false, error: String(e) });
    }
  }

  auditLog(req, "BULK_UPDATE_PRICE", "bulk",
    { ids, priceBase, markup },
    { ok: results.filter(r => r.ok).length, failed: results.filter(r => !r.ok).length },
  );

  return res.json({ results, pendingApproval: needsApproval });
});

// ── POST /admin/master-price/import ──────────────────────────────────────────

masterPriceRouter.post("/import", requirePortalAdmin, _upload.single("file"), async (req, res) => {
  if (!req.file) return res.status(400).json({ message: "File wajib diunggah" });

  const ext = (req.file.originalname ?? "").toLowerCase().split(".").pop();
  const actor = actorOf(req);
  const needsApproval = await isApprovalRequired();
  type ImportRow = Record<string, unknown>;
  let rows: ImportRow[] = [];

  try {
    if (ext === "csv") {
      const text = req.file.buffer.toString("utf-8");
      const lines = text.split(/\r?\n/).filter(Boolean);
      if (lines.length < 2) return res.status(422).json({ message: "File CSV kosong atau tidak ada data" });
      const headers = lines[0].split(",").map((h) => h.trim().toLowerCase().replace(/\s+/g, "_"));
      for (let i = 1; i < lines.length; i++) {
        const vals = lines[i].split(",");
        const obj: ImportRow = {};
        headers.forEach((h, idx) => { obj[h] = vals[idx]?.trim() ?? ""; });
        rows.push(obj);
      }
    } else {
      const workbook = XLSX.read(req.file.buffer, { type: "buffer" });
      const sheet = workbook.Sheets[workbook.SheetNames[0]];
      const raw = XLSX.utils.sheet_to_json<ImportRow>(sheet, { defval: "" });
      rows = raw.map((r) => {
        const out: ImportRow = {};
        for (const [k, v] of Object.entries(r)) {
          out[k.trim().toLowerCase().replace(/[\s-]+/g, "_")] = v;
        }
        return out;
      });
    }
  } catch {
    return res.status(422).json({ message: "File tidak bisa dibaca. Gunakan format xlsx atau csv." });
  }

  const results: { row: number; ok: boolean; id?: number; name?: string; error?: string }[] = [];

  for (let i = 0; i < rows.length; i++) {
    const row = rows[i];
    const rowNum = i + 2;
    const base     = parseFloat(String(row.price_base ?? row.pricebase ?? row["price_base"] ?? ""));
    const markupRaw = parseFloat(String(row.markup ?? row.markup_pct ?? "0"));

    if (isNaN(base) || base < 0) {
      results.push({ row: rowNum, ok: false, error: "price_base tidak valid atau negatif" }); continue;
    }
    if (isNaN(markupRaw) || markupRaw < 0 || markupRaw > 100) {
      results.push({ row: rowNum, ok: false, error: "markup tidak valid (harus 0–100)" }); continue;
    }

    const skuRaw     = String(row.sku ?? row.id ?? "").trim();
    const productName = String(row.product ?? row.name ?? row.product_name ?? "").trim();

    let item: any = null;
    if (skuRaw && !isNaN(Number(skuRaw))) {
      const r = await db.execute(sql`
        SELECT vci.id, vci.name, vci.vendor_id, vci.price_base, vci.markup_pct, vci.price_sell,
               vci.currency, vci.vendor_name,
               COALESCE(s.name, vci.vendor_name) AS supplier_name,
               COALESCE(s.is_internal_vendor, false) AS is_internal
        FROM vendor_catalog_items vci
        JOIN suppliers s ON s.id = vci.vendor_id
        WHERE vci.id = ${Number(skuRaw)}
      `);
      item = (r.rows?.[0] as any) ?? null;
    }
    if (!item && productName) {
      const r = await db.execute(sql`
        SELECT vci.id, vci.name, vci.vendor_id, vci.price_base, vci.markup_pct, vci.price_sell,
               vci.currency, vci.vendor_name,
               COALESCE(s.name, vci.vendor_name) AS supplier_name,
               COALESCE(s.is_internal_vendor, false) AS is_internal
        FROM vendor_catalog_items vci
        JOIN suppliers s ON s.id = vci.vendor_id
        WHERE vci.name ILIKE ${productName}
        LIMIT 1
      `);
      item = (r.rows?.[0] as any) ?? null;
    }

    if (!item) {
      results.push({ row: rowNum, ok: false, error: `Produk tidak ditemukan (sku=${skuRaw || "-"}, name=${productName || "-"})` }); continue;
    }

    const isInternal: boolean = item.is_internal === true;
    const effectiveMarkup = isInternal ? 0 : markupRaw;
    const priceSell = computeSell(base, effectiveMarkup, isInternal);

    try {
      await insertHistory({
        catalogItemId: item.id, itemName: item.name, vendorId: item.vendor_id,
        vendorName: item.supplier_name, vendorType: isInternal ? "internal" : "external",
        currency: item.currency ?? "IDR",
        priceBaseOld: Number(item.price_base ?? 0), priceBaseNew: base,
        markupOld: Number(item.markup_pct ?? 0),    markupNew: effectiveMarkup,
        priceSellOld: item.price_sell != null ? Number(item.price_sell) : null,
        priceSellNew: priceSell, reason: "import", changedBy: actor.email,
        approvalStatus: needsApproval ? "pending" : "auto_approved", effectiveAt: null,
      });
      if (!needsApproval) await applyPriceNow(item.id, base, effectiveMarkup, priceSell);
      results.push({ row: rowNum, ok: true, id: item.id, name: item.name });
    } catch (e) {
      results.push({ row: rowNum, ok: false, error: String(e) });
    }
  }

  auditLog(req, "IMPORT_PRICE", "bulk", {}, { rows: rows.length, ok: results.filter(r => r.ok).length });

  return res.json({
    total: rows.length, ok: results.filter(r => r.ok).length,
    failed: results.filter(r => !r.ok).length, results, pendingApproval: needsApproval,
  });
});

// ── GET /admin/master-price/export ───────────────────────────────────────────

masterPriceRouter.get("/export", requirePortalAdmin, async (req, res) => {
  try {
    const { format = "xlsx", vendorType, status, category } = req.query as Record<string, string>;

    const parts: SQL[] = [];
    if (vendorType === "internal")  parts.push(sql`COALESCE(s.is_internal_vendor, false) = true`);
    else if (vendorType === "external") parts.push(sql`COALESCE(s.is_internal_vendor, false) = false`);
    if (status && status !== "all") parts.push(sql`vci.status = ${status}`);
    if (category && category !== "all") parts.push(sql`(vci.category_key = ${category} OR vci.kategori = ${category})`);
    const where = buildWhere(parts);

    const rows = await db.execute(sql`
      SELECT
        vci.id                                                                    AS sku,
        vci.name                                                                  AS product,
        COALESCE(vci.vendor_name, s.name)                                        AS supplier,
        CASE WHEN COALESCE(s.is_internal_vendor,false) THEN 'Internal' ELSE 'External' END AS vendor_type,
        vci.price_base,
        vci.markup_pct  AS markup,
        vci.price_sell  AS selling_price,
        vci.currency,
        vci.status,
        vci.updated_at
      FROM vendor_catalog_items vci
      JOIN suppliers s ON s.id = vci.vendor_id
      WHERE 1=1 ${where}
      ORDER BY vci.updated_at DESC NULLS LAST
    `);

    const data = (rows.rows ?? []) as any[];

    if (format === "csv") {
      const headers = ["SKU","Product","Supplier","Vendor Type","Price Base","Markup %","Selling Price","Currency","Status","Updated At"];
      const csv = [
        headers.join(","),
        ...data.map((r) => [
          r.sku,
          `"${(r.product ?? "").replace(/"/g, '""')}"`,
          `"${(r.supplier ?? "").replace(/"/g, '""')}"`,
          r.vendor_type,
          r.price_base ?? "",
          r.markup     ?? "",
          r.selling_price ?? "",
          r.currency  ?? "IDR",
          r.status    ?? "",
          r.updated_at ? new Date(r.updated_at).toISOString() : "",
        ].join(",")),
      ].join("\n");
      res.setHeader("Content-Type", "text/csv");
      res.setHeader("Content-Disposition", `attachment; filename="master-price-${Date.now()}.csv"`);
      return res.send(csv);
    }

    // Default: xlsx
    const wb = new ExcelJS.Workbook();
    const ws = wb.addWorksheet("Master Price");
    ws.columns = [
      { header: "SKU",           key: "sku",           width: 8  },
      { header: "Product",       key: "product",        width: 35 },
      { header: "Supplier",      key: "supplier",       width: 25 },
      { header: "Vendor Type",   key: "vendor_type",    width: 12 },
      { header: "Price Base",    key: "price_base",     width: 16 },
      { header: "Markup %",      key: "markup",         width: 10 },
      { header: "Selling Price", key: "selling_price",  width: 16 },
      { header: "Currency",      key: "currency",       width: 10 },
      { header: "Status",        key: "status",         width: 10 },
      { header: "Updated At",    key: "updated_at",     width: 22 },
    ];
    ws.getRow(1).eachCell((cell) => {
      cell.font = { bold: true, color: { argb: "FFFFFFFF" } };
      cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FF1E3A5F" } };
    });
    for (const r of data) {
      ws.addRow({
        sku: r.sku, product: r.product, supplier: r.supplier, vendor_type: r.vendor_type,
        price_base:    r.price_base    != null ? Number(r.price_base)    : null,
        markup:        r.markup        != null ? Number(r.markup)        : null,
        selling_price: r.selling_price != null ? Number(r.selling_price) : null,
        currency: r.currency ?? "IDR", status: r.status ?? "",
        updated_at: r.updated_at ? new Date(r.updated_at).toISOString() : "",
      });
    }
    res.setHeader("Content-Type", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
    res.setHeader("Content-Disposition", `attachment; filename="master-price-${Date.now()}.xlsx"`);
    await wb.xlsx.write(res);
    return res.end();
  } catch (e) {
    console.error("[masterPrice] export error", e);
    return res.status(500).json({ error: "Gagal export" });
  }
});

// ── GET /admin/master-price/history ──────────────────────────────────────────

masterPriceRouter.get("/history", requirePortalAdmin, async (req, res) => {
  try {
    const {
      page = "1", limit = "50",
      supplierId, vendorType, changedBy, from, to,
    } = req.query as Record<string, string>;

    const pageNum  = Math.max(1, parseInt(page, 10) || 1);
    const limitNum = Math.min(200, Math.max(1, parseInt(limit, 10) || 50));
    const offset   = (pageNum - 1) * limitNum;

    const parts: SQL[] = [];
    if (vendorType === "internal")  parts.push(sql`vendor_type = 'internal'`);
    else if (vendorType === "external") parts.push(sql`vendor_type = 'external'`);
    if (supplierId && !isNaN(Number(supplierId))) parts.push(sql`vendor_id = ${Number(supplierId)}`);
    if (changedBy?.trim()) parts.push(sql`changed_by ILIKE ${"%" + changedBy.trim() + "%"}`);
    if (from) parts.push(sql`changed_at >= ${new Date(from)}`);
    if (to)   parts.push(sql`changed_at <= ${new Date(to)}`);

    const whereBase = parts.length ? sql`WHERE ${sql.join(parts, sql` AND `)}` : sql``;

    const [countResult, listResult] = await Promise.all([
      db.execute(sql`SELECT COUNT(*) AS total FROM marketplace_price_history ${whereBase}`),
      db.execute(sql`
        SELECT * FROM marketplace_price_history
        ${whereBase}
        ORDER BY changed_at DESC
        LIMIT ${limitNum} OFFSET ${offset}
      `),
    ]);

    const total = Number((countResult.rows?.[0] as any)?.total ?? 0);
    return res.json({
      data: (listResult.rows ?? []).map((r: any) => ({
        ...r,
        priceBaseOld:  r.price_base_old  != null ? Number(r.price_base_old)  : null,
        priceBaseNew:  r.price_base_new  != null ? Number(r.price_base_new)  : null,
        markupOld:     r.markup_old      != null ? Number(r.markup_old)      : null,
        markupNew:     r.markup_new      != null ? Number(r.markup_new)      : null,
        priceSellOld:  r.price_sell_old  != null ? Number(r.price_sell_old)  : null,
        priceSellNew:  r.price_sell_new  != null ? Number(r.price_sell_new)  : null,
      })),
      total, page: pageNum, limit: limitNum, pages: Math.ceil(total / limitNum),
    });
  } catch (e) {
    console.error("[masterPrice] history error", e);
    return res.status(500).json({ error: "Gagal memuat riwayat" });
  }
});

// ── GET /admin/master-price/pending-approvals ────────────────────────────────

masterPriceRouter.get("/pending-approvals", requirePortalAdmin, async (_req, res) => {
  try {
    const rows = await db.execute(sql`
      SELECT * FROM marketplace_price_history
      WHERE approval_status = 'pending'
      ORDER BY changed_at DESC
    `);
    return res.json({ data: rows.rows ?? [] });
  } catch (e) {
    return res.status(500).json({ error: "Gagal memuat pending approvals" });
  }
});

// ── POST /admin/master-price/approvals/:histId/approve ───────────────────────

masterPriceRouter.post("/approvals/:histId/approve", requirePortalAdmin, async (req, res) => {
  const histId = parseInt(String(req.params.histId), 10);
  if (isNaN(histId)) return res.status(400).json({ message: "ID tidak valid" });
  const actor = actorOf(req);
  try {
    const rows = await db.execute(sql`
      SELECT * FROM marketplace_price_history WHERE id = ${histId} AND approval_status = 'pending'
    `);
    const hist = rows.rows?.[0] as any;
    if (!hist) return res.status(404).json({ message: "Tidak ditemukan atau sudah diproses" });

    const effectiveAt = hist.effective_at ? new Date(hist.effective_at) : null;
    const isScheduled = effectiveAt instanceof Date && !isNaN(effectiveAt.getTime()) && effectiveAt > new Date();

    if (!isScheduled) {
      await applyPriceNow(
        hist.catalog_item_id,
        Number(hist.price_base_new),
        Number(hist.markup_new),
        hist.price_sell_new != null ? Number(hist.price_sell_new) : null,
      );
      await db.execute(sql`
        UPDATE marketplace_price_history
        SET approval_status = 'approved', approved_by = ${actor.email},
            approved_at = NOW(), applied_at = NOW()
        WHERE id = ${histId}
      `);
    } else {
      await db.execute(sql`
        UPDATE marketplace_price_history
        SET approval_status = 'approved', approved_by = ${actor.email}, approved_at = NOW()
        WHERE id = ${histId}
      `);
    }
    return res.json({ ok: true, applied: !isScheduled });
  } catch (e) {
    return res.status(500).json({ error: "Gagal menyetujui perubahan" });
  }
});

// ── POST /admin/master-price/approvals/:histId/reject ────────────────────────

masterPriceRouter.post("/approvals/:histId/reject", requirePortalAdmin, async (req, res) => {
  const histId = parseInt(String(req.params.histId), 10);
  if (isNaN(histId)) return res.status(400).json({ message: "ID tidak valid" });
  const actor = actorOf(req);
  const { reason } = req.body ?? {};
  try {
    const r = await db.execute(sql`
      UPDATE marketplace_price_history
      SET approval_status = 'rejected', approved_by = ${actor.email}, approved_at = NOW(),
          reason = COALESCE(${reason ?? null}, reason)
      WHERE id = ${histId} AND approval_status = 'pending'
      RETURNING id
    `);
    if (!r.rows?.length) return res.status(404).json({ message: "Tidak ditemukan atau sudah diproses" });
    return res.json({ ok: true });
  } catch (e) {
    return res.status(500).json({ error: "Gagal menolak perubahan" });
  }
});
