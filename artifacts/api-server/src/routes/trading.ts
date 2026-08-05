import { Router } from "express";
import { db, stocksTable, suppliersTable, vendorCatalogItemsTable, productsTable, productCategoryMapTable, productCategoriesTable } from "@workspace/db";
import { eq, and, or, isNull, sql, inArray } from "drizzle-orm";
import { writeAuditLog, extractRequestMeta } from "../lib/auditLog.js";
import { resolveCompanyId, resolveCompanyScope } from "../lib/resolveCompany.js";
import { assertCompanyAccess } from "../lib/assertCompanyAccess.js";
import { postStockReceived } from "../lib/accounting.js";
import { deleteFromSupabase, uploadToSupabase } from "../lib/supabaseStorage.js";
import { validateMediaAssetsPayload } from "../lib/mediaAssetsValidation.js";
import multer from "multer";
import { validateUploadFile } from "../lib/uploadValidation.js";

const _tradingUpload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 50 * 1024 * 1024 } });

const CATALOG_MEDIA_ALLOWED_MIME = [
  "image/jpeg", "image/jpg", "image/png", "image/webp",
  "video/mp4", "video/webm", "video/quicktime",
  "application/pdf",
] as const;
import { requireClerkUser, requireAdmin } from "../lib/requireAdmin.js";
import { autoGenerateIfNeeded } from "../lib/aiImageGenerator.js";
import {
  resolveTemplate,
  resolveTemplateStrict,
  validateTemplatePayload,
  getUnknownFields,
  specValuesToFormValues,
} from "@workspace/product-templates";

const router = Router();

// ── Idempotent migrations: vendor_catalog_items new columns (FASE 2) ─────────
db.execute(sql`
  ALTER TABLE vendor_catalog_items
    ADD COLUMN IF NOT EXISTS vendor_name        TEXT,
    ADD COLUMN IF NOT EXISTS template_kind      TEXT,
    ADD COLUMN IF NOT EXISTS category_key       TEXT,
    ADD COLUMN IF NOT EXISTS service_type       TEXT,
    ADD COLUMN IF NOT EXISTS template_id        TEXT,
    ADD COLUMN IF NOT EXISTS template_version   TEXT,
    ADD COLUMN IF NOT EXISTS template_snapshot  JSONB,
    ADD COLUMN IF NOT EXISTS spec_values        JSONB,
    ADD COLUMN IF NOT EXISTS price_sell         NUMERIC(15, 2),
    ADD COLUMN IF NOT EXISTS currency           TEXT NOT NULL DEFAULT 'IDR',
    ADD COLUMN IF NOT EXISTS stock_status       TEXT,
    ADD COLUMN IF NOT EXISTS stock_qty          NUMERIC(15, 3),
    ADD COLUMN IF NOT EXISTS moq                NUMERIC(15, 3),
    ADD COLUMN IF NOT EXISTS lead_time          TEXT,
    ADD COLUMN IF NOT EXISTS validity_date      DATE,
    ADD COLUMN IF NOT EXISTS location           TEXT,
    ADD COLUMN IF NOT EXISTS origin             TEXT,
    ADD COLUMN IF NOT EXISTS documents          JSONB,
    ADD COLUMN IF NOT EXISTS status             TEXT NOT NULL DEFAULT 'draft',
    ADD COLUMN IF NOT EXISTS is_published       BOOLEAN NOT NULL DEFAULT FALSE,
    ADD COLUMN IF NOT EXISTS source_submission_id INTEGER,
    ADD COLUMN IF NOT EXISTS published_at       TIMESTAMPTZ,
    ADD COLUMN IF NOT EXISTS updated_at         TIMESTAMPTZ DEFAULT NOW()
`).catch(() => {});

// ── Vendor data audit: hs_code + supplier company profile columns ─────────────
db.execute(sql`ALTER TABLE vendor_catalog_items ADD COLUMN IF NOT EXISTS hs_code TEXT`).catch(() => {});
db.execute(sql`ALTER TABLE suppliers ADD COLUMN IF NOT EXISTS npwp TEXT`).catch(() => {});
db.execute(sql`ALTER TABLE suppliers ADD COLUMN IF NOT EXISTS nib TEXT`).catch(() => {});
db.execute(sql`ALTER TABLE suppliers ADD COLUMN IF NOT EXISTS company_banner TEXT`).catch(() => {});
db.execute(sql`ALTER TABLE suppliers ADD COLUMN IF NOT EXISTS vision TEXT`).catch(() => {});
db.execute(sql`ALTER TABLE suppliers ADD COLUMN IF NOT EXISTS mission TEXT`).catch(() => {});
db.execute(sql`ALTER TABLE suppliers ADD COLUMN IF NOT EXISTS established_year INTEGER`).catch(() => {});
db.execute(sql`ALTER TABLE suppliers ADD COLUMN IF NOT EXISTS main_market TEXT`).catch(() => {});
db.execute(sql`ALTER TABLE suppliers ADD COLUMN IF NOT EXISTS factory_address TEXT`).catch(() => {});
db.execute(sql`ALTER TABLE suppliers ADD COLUMN IF NOT EXISTS office_address TEXT`).catch(() => {});
db.execute(sql`ALTER TABLE suppliers ADD COLUMN IF NOT EXISTS warehouse_address TEXT`).catch(() => {});
db.execute(sql`ALTER TABLE suppliers ADD COLUMN IF NOT EXISTS website TEXT`).catch(() => {});
db.execute(sql`ALTER TABLE suppliers ADD COLUMN IF NOT EXISTS social_media JSONB`).catch(() => {});
db.execute(sql`ALTER TABLE suppliers ADD COLUMN IF NOT EXISTS latitude NUMERIC(10,7)`).catch(() => {});
db.execute(sql`ALTER TABLE suppliers ADD COLUMN IF NOT EXISTS longitude NUMERIC(10,7)`).catch(() => {});
// product_document_types table
db.execute(sql`
  CREATE TABLE IF NOT EXISTS product_document_types (
    id SERIAL PRIMARY KEY,
    key TEXT NOT NULL UNIQUE,
    label TEXT NOT NULL,
    is_custom BOOLEAN NOT NULL DEFAULT false,
    company_id INTEGER,
    created_at TIMESTAMPTZ DEFAULT NOW()
  )
`).catch(() => {});
db.execute(sql`
  INSERT INTO product_document_types (key, label) VALUES
    ('coa','Certificate of Analysis (COA)'),
    ('coo','Certificate of Origin (COO)'),
    ('phyto','Phytosanitary Certificate'),
    ('health_cert','Health Certificate'),
    ('halal','Halal Certificate'),
    ('invoice','Commercial Invoice'),
    ('packing_list','Packing List'),
    ('certificate','Certificate'),
    ('msds','MSDS'),
    ('tds','Technical Data Sheet'),
    ('catalogue','Product Catalogue'),
    ('brochure','Brochure'),
    ('test_report','Test Report'),
    ('other','Other')
  ON CONFLICT (key) DO NOTHING
`).catch(() => {});

// Index untuk query publik (published catalog)
db.execute(sql`
  CREATE INDEX IF NOT EXISTS vendor_catalog_vendor_idx       ON vendor_catalog_items (vendor_id);
  CREATE INDEX IF NOT EXISTS vendor_catalog_status_idx       ON vendor_catalog_items (status, is_published);
  CREATE INDEX IF NOT EXISTS vendor_catalog_category_idx     ON vendor_catalog_items (category_key);
  CREATE INDEX IF NOT EXISTS vendor_catalog_service_type_idx ON vendor_catalog_items (service_type);
`).catch(() => {});

// Data-integrity fix: logistic_order_quotes.vendor_id used to be ON DELETE
// CASCADE, so deleting a vendor from the Vendors page silently wiped its
// historical quotes for real orders. Switch to RESTRICT so a vendor with
// quote history cannot be hard-deleted (mirrors mktPurchaseOrders /
// mktVendorQuotes / logisticVendorFulfillments, which already use RESTRICT).
db.execute(sql`
  ALTER TABLE logistic_order_quotes
    DROP CONSTRAINT IF EXISTS logistic_order_quotes_vendor_id_suppliers_id_fk
`).then(() => db.execute(sql`
  ALTER TABLE logistic_order_quotes
    ADD CONSTRAINT logistic_order_quotes_vendor_id_suppliers_id_fk
    FOREIGN KEY (vendor_id) REFERENCES suppliers(id) ON DELETE RESTRICT
`)).catch(() => {});

// [C1-FIX] All trading routes require authenticated internal BizPortal staff.
// Portal/mobile bearer-token users (isInternalSession=false) are rejected.
router.use(async (req, res, next) => {
  if (!(await requireClerkUser(req, res))) return;
  next();
});

// toItem — admin view (priceBase BOLEH tampil, hanya untuk internal admin)
// Untuk public catalog endpoint, filter priceBase/markupPct di layer tersebut.
const toItem = (i: typeof vendorCatalogItemsTable.$inferSelect) => ({
  id: i.id,
  vendorId: i.vendorId,
  vendorName: i.vendorName ?? null,
  masterItemId: i.masterItemId ?? null,
  // legacy
  type: i.type,
  name: i.name,
  description: i.description ?? null,
  unit: i.unit ?? null,
  kategori: i.kategori ?? null,
  subcategory: i.subcategory ?? null,
  isCommodityTag: i.isCommodityTag,
  sortOrder: i.sortOrder,
  // template engine
  templateKind: i.templateKind ?? null,
  categoryKey: i.categoryKey ?? null,
  serviceType: (i as any).serviceType ?? null,
  templateId: i.templateId ?? null,
  templateVersion: i.templateVersion ?? null,
  templateSnapshot: i.templateSnapshot ?? null,
  specValues: i.specValues ?? null,
  // pricing (priceBase = internal cost, markupPct = internal margin)
  priceBase: Number(i.priceBase ?? 0),
  markupPct: Number(i.markupPct ?? 0),
  priceSell: i.priceSell != null ? Number(i.priceSell) : null,
  currency: i.currency ?? "IDR",
  // availability
  stockStatus: i.stockStatus ?? null,
  stockQty: i.stockQty != null ? Number(i.stockQty) : null,
  moq: i.moq != null ? Number(i.moq) : null,
  leadTime: i.leadTime ?? null,
  validityDate: i.validityDate ?? null,
  // origin
  location: i.location ?? null,
  origin: i.origin ?? null,
  // attachments
  documents: i.documents ?? null,
  // HS Code
  hsCode: (i as any).hsCode ?? null,
  // publication
  status: i.status ?? "draft",
  isPublished: i.isPublished ?? false,
  isActive: i.isActive,
  isFeatured: i.isFeatured ?? false,
  featuredUntil: i.featuredUntil ? i.featuredUntil.toISOString() : null,
  viewCount: i.viewCount ?? 0,
  quoteCount: i.quoteCount ?? 0,
  orderCount: i.orderCount ?? 0,
  sourceSubmissionId: i.sourceSubmissionId ?? null,
  publishedAt: i.publishedAt ? i.publishedAt.toISOString() : null,
  // timestamps
  createdAt: i.createdAt.toISOString(),
  updatedAt: i.updatedAt ? i.updatedAt.toISOString() : null,
});

// GET /api/trading/stocks
router.get("/stocks", async (req, res) => {
  const limit = Math.min(Number(req.query["limit"] ?? 100), 500);
  const offset = Math.max(Number(req.query["offset"] ?? 0), 0);

  const [stocks, suppliers] = await Promise.all([
    db.select().from(stocksTable).orderBy(stocksTable.createdAt).limit(limit).offset(offset),
    db.select({ id: suppliersTable.id, name: suppliersTable.name }).from(suppliersTable),
  ]);
  const supplierMap = Object.fromEntries(suppliers.map(s => [s.id, s.name]));

  return res.json(stocks.map(s => ({
    ...s,
    costPrice: Number(s.costPrice),
    supplierName: s.supplierId ? supplierMap[s.supplierId] || null : null,
    createdAt: s.createdAt.toISOString(),
  })));
});

// POST /api/trading/stocks
router.post("/stocks", async (req, res) => {
  if (!(await requireAdmin(req, res))) return;
  const { productName, sku, quantity, unit, costPrice, supplierId, hsCode } = req.body;
  const [stock] = await db.insert(stocksTable).values({
    productName, sku, quantity, unit, costPrice: String(costPrice), supplierId, hsCode
  }).returning();
  void postStockReceived({
    stockId: stock.id,
    productName: stock.productName,
    quantity: stock.quantity,
    costPrice: Number(stock.costPrice),
  });
  return res.status(201).json({ ...stock, costPrice: Number(stock.costPrice), createdAt: stock.createdAt.toISOString() });
});

// PUT /api/trading/stocks/:id
router.put("/stocks/:id", async (req, res) => {
  if (!(await requireAdmin(req, res))) return;
  const id = Number(String(req.params.id));
  if (Number.isNaN(id)) return res.status(400).json({ message: "Invalid id" });
  const { productName, sku, quantity, unit, costPrice, supplierId, hsCode } = req.body;
  const patch: Record<string, unknown> = {};
  if (typeof productName === "string") patch["productName"] = productName;
  if (typeof sku === "string") patch["sku"] = sku;
  if (typeof quantity === "number") patch["quantity"] = quantity;
  if (typeof unit === "string") patch["unit"] = unit;
  if (typeof costPrice === "number") patch["costPrice"] = String(costPrice);
  if (supplierId !== undefined) patch["supplierId"] = supplierId;
  if (hsCode !== undefined) patch["hsCode"] = hsCode;

  const [updated] = await db.update(stocksTable).set(patch).where(eq(stocksTable.id, id)).returning();
  if (!updated) return res.status(404).json({ message: "Stock item not found" });
  return res.json({ ...updated, costPrice: Number(updated.costPrice), createdAt: updated.createdAt.toISOString() });
});

// DELETE /api/trading/stocks/:id
router.delete("/stocks/:id", async (req, res) => {
  if (!(await requireAdmin(req, res))) return;
  const id = Number(String(req.params.id));
  if (Number.isNaN(id)) return res.status(400).json({ message: "Invalid id" });
  const [deleted] = await db.delete(stocksTable).where(eq(stocksTable.id, id)).returning();
  if (!deleted) return res.status(404).json({ message: "Stock item not found" });
  return res.json({ message: "Deleted", id });
});

// GET /api/trading/suppliers
// FASE 4 (vendor audit): server-side pagination + search + status filter.
// Backward compatibility: when neither `page` nor `search` nor `status` is
// supplied, the endpoint behaves like before (limit/offset, plain filtering)
// EXCEPT the response envelope is now always { success, data, pagination } —
// bumped as a breaking change alongside the generated api-client (orval) and
// purchase/vendors.tsx, which were updated in the same change.
router.get("/suppliers", async (req, res) => {
  const page = Math.max(Number(req.query["page"] ?? 1) || 1, 1);
  const requestedLimit = Number(req.query["limit"] ?? 25) || 25;
  // Capped at 1000 (not 100) so internal dropdown/combobox consumers
  // (RFQ editor, expense routine, invoice OCR, vendor detail, katalog
  // terpadu) can still request the full vendor list in one call by passing
  // limit=1000, same as before this endpoint gained pagination.
  const limit = Math.min(Math.max(requestedLimit, 1), 1000);
  const offset = req.query["offset"] != null
    ? Math.max(Number(req.query["offset"]) || 0, 0)
    : (page - 1) * limit;

  // `companyId` is the FASE 4-spec query param name; `filterCompanyId` is
  // kept as an alias for backward compatibility with existing callers.
  const filterCompanyId = (req.query["companyId"] ?? req.query["filterCompanyId"]) as string | undefined;
  const search = (req.query["search"] as string | undefined)?.trim();
  const status = (req.query["status"] as string | undefined) ?? "all"; // all | active | inactive
  const sortBy = (req.query["sortBy"] as string | undefined) === "name" ? "name" : "createdAt";
  const sortOrder = (req.query["sortOrder"] as string | undefined) === "asc" ? "asc" : "desc";

  if (!["all", "active", "inactive"].includes(status)) {
    return res.status(400).json({ success: false, message: "status must be 'all', 'active', or 'inactive'" });
  }

  const scope = resolveCompanyScope(req);

  // Build base where condition from scope
  const scopeCondition = scope === "all"
    ? undefined
    : sql`(
        NOT EXISTS (
          SELECT 1 FROM vendor_company_assignments
          WHERE vendor_id = ${suppliersTable.id}
        )
        OR EXISTS (
          SELECT 1 FROM vendor_company_assignments
          WHERE vendor_id = ${suppliersTable.id}
            AND company_id = ${scope}
        )
      )`;

  // Build filterCompanyId condition for admin server-side filtering.
  // Only accept: undefined/"all" (no filter), "__unassigned__", or a valid positive integer.
  let companyFilterCondition: ReturnType<typeof eq> | ReturnType<typeof isNull> | undefined;
  if (filterCompanyId == null || filterCompanyId === "all" || filterCompanyId === "") {
    companyFilterCondition = undefined;
  } else if (filterCompanyId === "__unassigned__") {
    companyFilterCondition = isNull(suppliersTable.companyId);
  } else {
    const parsedId = Number(filterCompanyId);
    if (!Number.isFinite(parsedId) || parsedId <= 0 || !Number.isInteger(parsedId)) {
      return res.status(400).json({ success: false, message: "filterCompanyId must be a positive integer, 'all', or '__unassigned__'" });
    }
    companyFilterCondition = eq(suppliersTable.companyId, parsedId);
  }

  const statusCondition = status === "active"
    ? eq(suppliersTable.isActive, true)
    : status === "inactive"
      ? eq(suppliersTable.isActive, false)
      : undefined;

  // Search across name, tax id (NPWP), contact person, email, phone.
  const searchCondition = search
    ? sql`(
        ${suppliersTable.name} ILIKE ${`%${search}%`}
        OR ${suppliersTable.contactPerson} ILIKE ${`%${search}%`}
        OR ${suppliersTable.contactEmail} ILIKE ${`%${search}%`}
        OR ${suppliersTable.phone} ILIKE ${`%${search}%`}
        OR ${suppliersTable.taxId} ILIKE ${`%${search}%`}
      )`
    : undefined;

  const conditions = [scopeCondition, companyFilterCondition, statusCondition, searchCondition].filter(
    (c): c is NonNullable<typeof c> => c !== undefined,
  );
  const whereCondition = conditions.length > 0 ? and(...conditions) : undefined;

  const orderCol = sortBy === "name" ? suppliersTable.name : suppliersTable.createdAt;
  const orderExpr = sortOrder === "asc" ? sql`${orderCol} ASC` : sql`${orderCol} DESC`;

  const baseQuery = db.select().from(suppliersTable);
  const [suppliers, totalRows] = await Promise.all([
    (whereCondition ? baseQuery.where(whereCondition) : baseQuery)
      .orderBy(orderExpr)
      .limit(limit)
      .offset(offset),
    whereCondition
      ? db.select({ count: sql<number>`count(*)::int` }).from(suppliersTable).where(whereCondition)
      : db.select({ count: sql<number>`count(*)::int` }).from(suppliersTable),
  ]);
  const total = totalRows[0]?.count ?? 0;
  const totalPages = total > 0 ? Math.ceil(total / limit) : 0;

  const pagination = { page, limit, total, totalPages };

  if (suppliers.length === 0) {
    return res.json({ success: true, data: [], pagination });
  }

  // Fetch all company assignments for the returned vendors
  const vendorIds = suppliers.map(s => s.id);
  const assignments = await db.execute(
    sql.raw(`SELECT vendor_id, company_id FROM vendor_company_assignments WHERE vendor_id = ANY(ARRAY[${vendorIds.join(",")}]::int[])`)
  );
  const assignmentMap: Record<number, number[]> = {};
  for (const row of assignments.rows as { vendor_id: number; company_id: number }[]) {
    if (!assignmentMap[row.vendor_id]) assignmentMap[row.vendor_id] = [];
    assignmentMap[row.vendor_id].push(row.company_id);
  }

  return res.json({
    success: true,
    data: suppliers.map(s => ({
      ...s,
      fee: Number(s.fee ?? 0),
      createdAt: s.createdAt.toISOString(),
      assignedCompanyIds: assignmentMap[s.id] ?? [],
    })),
    pagination,
  });
});

// GET /api/trading/suppliers/:id/delete-impact — dependency check used by the
// frontend to decide whether to show a plain "hapus permanen?" confirm or a
// "vendor akan diarsipkan" warning (FASE 3, point 8).
router.get("/suppliers/:id/delete-impact", async (req, res) => {
  if (!(await requireAdmin(req, res))) return;
  const id = Number(String(req.params.id));
  if (Number.isNaN(id)) return res.status(400).json({ success: false, message: "Invalid id" });

  const [vendor] = await db.select({ id: suppliersTable.id, companyId: suppliersTable.companyId })
    .from(suppliersTable).where(eq(suppliersTable.id, id));
  if (!vendor) return res.status(404).json({ success: false, code: "SUPPLIER_NOT_FOUND", message: "Vendor tidak ditemukan" });
  const resolvedCid = resolveCompanyId(req);
  if (!(await assertCompanyAccess(vendor.companyId, resolvedCid, req, res, { resourceType: "supplier", resourceId: id }))) return;

  const [logisticQuotes, purchaseOrders, fulfillments] = await Promise.all([
    db.execute(sql`SELECT count(*)::int AS c FROM logistic_order_quotes WHERE vendor_id = ${id}`),
    db.execute(sql`SELECT count(*)::int AS c FROM mkt_purchase_orders WHERE vendor_id = ${id}`),
    db.execute(sql`SELECT count(*)::int AS c FROM logistic_vendor_fulfillments WHERE vendor_id = ${id}`),
  ]);
  const dependencies = {
    logisticQuotes: Number((logisticQuotes.rows[0] as { c: number } | undefined)?.c ?? 0),
    purchaseOrders: Number((purchaseOrders.rows[0] as { c: number } | undefined)?.c ?? 0),
    fulfillments: Number((fulfillments.rows[0] as { c: number } | undefined)?.c ?? 0),
  };
  const hasTransactionHistory = Object.values(dependencies).some((n) => n > 0);

  return res.json({
    success: true,
    data: {
      canHardDelete: !hasTransactionHistory,
      hasTransactionHistory,
      dependencies,
      recommendedAction: hasTransactionHistory ? "archive" : "delete",
    },
  });
});

// GET /api/trading/suppliers/:id/transactions — Vendor Master Enhancement P3.
// Unified transaction history for a vendor across RFQ invites, marketplace
// purchase orders, logistic quotes, and logistic vendor fulfillments. Read-only,
// company-scoped via assertCompanyAccess (same IDOR guard as other supplier
// sub-routes). suppliers.id remains the single vendor master key — this route
// does not introduce a second vendor identity.
router.get("/suppliers/:id/transactions", async (req, res) => {
  if (!(await requireClerkUser(req, res))) return;
  const id = Number(String(req.params.id));
  if (Number.isNaN(id)) return res.status(400).json({ success: false, message: "Invalid id" });

  const [vendor] = await db.select({ id: suppliersTable.id, companyId: suppliersTable.companyId })
    .from(suppliersTable).where(eq(suppliersTable.id, id));
  if (!vendor) return res.status(404).json({ success: false, code: "SUPPLIER_NOT_FOUND", message: "Vendor tidak ditemukan" });
  const resolvedCid = resolveCompanyId(req);
  if (!(await assertCompanyAccess(vendor.companyId, resolvedCid, req, res, { resourceType: "supplier", resourceId: id }))) return;

  const limit = Math.min(Number(req.query.limit ?? 50), 200);
  const offset = Math.max(Number(req.query.offset ?? 0), 0);
  const typeFilter = typeof req.query.type === "string" ? req.query.type : null;

  // Build individual subqueries with per-leg isolation so a missing
  // column/table on dev does not fail the entire response. Each leg is tried
  // independently; failures are collected into `warnings` and surfaced to the
  // frontend — not silently swallowed.
  const subqueries: { type: string; rows: unknown[] }[] = [];
  const failedLegs: string[] = [];

  const actor = req.user as { id?: string | number; email?: string; role?: string } | undefined;
  const userId   = actor?.id   ?? actor?.email ?? "unknown";
  const companyId = resolvedCid ?? vendor.companyId;

  /**
   * Sanitise a caught error to a log-safe string.
   * Never expose: SQL text, table names, constraint names, stack traces,
   * raw PG messages, or credential fragments.
   */
  const sanitiseErr = (e: unknown): { code: string; logDetail: string } => {
    if (!(e instanceof Error)) {
      return { code: "UNKNOWN_ERROR", logDetail: "non-Error thrown" };
    }
    const cause = (e as { cause?: { message?: string; code?: string } })?.cause;
    const pgCode: string = (cause as { code?: string })?.code ?? "";
    // Map well-known PG error codes to stable internal codes
    const codeMap: Record<string, string> = {
      "42P01": "TABLE_NOT_FOUND",      // undefined_table
      "42703": "COLUMN_NOT_FOUND",     // undefined_column
      "3F000": "SCHEMA_NOT_SET",       // invalid_schema_name
      "08006": "DB_CONNECTION_FAILED",
      "08001": "DB_CONNECTION_FAILED",
      "57014": "QUERY_CANCELLED",
    };
    const internalCode = pgCode && codeMap[pgCode]
      ? codeMap[pgCode]
      : pgCode
        ? `PG_${pgCode}`
        : "QUERY_ERROR";
    // Log detail stays server-side only — include PG code but not the SQL
    const logDetail = cause?.message
      ? `pg=${pgCode} cause=${cause.message.slice(0, 120)}`
      : e.message.slice(0, 120);
    return { code: internalCode, logDetail };
  };

  const tryLeg = async (label: string, q: ReturnType<typeof sql>) => {
    try {
      const r = await db.execute(q);
      subqueries.push({ type: label, rows: r.rows });
    } catch (legErr: unknown) {
      const { code, logDetail } = sanitiseErr(legErr);
      // Structured server log — never reaches the client response
      console.warn(JSON.stringify({
        level: "warn",
        event: "transaction_leg_failed",
        source: label,
        supplierId: id,
        companyId,
        userId,
        errorCode: code,
        detail: logDetail,
        ts: new Date().toISOString(),
      }));
      failedLegs.push(label);
      subqueries.push({ type: label, rows: [] });
    }
  };

  await Promise.all([
    tryLeg("rfq_invite", sql`SELECT 'rfq_invite'::text AS type, rvl.id AS id, rvl.status AS status, rvl.created_at AS occurred_at, NULL::numeric AS amount, rvl.rfq_id AS reference_id FROM rfq_vendor_links rvl WHERE rvl.vendor_id = ${id}`),
    tryLeg("purchase_order", sql`SELECT 'purchase_order'::text AS type, po.id AS id, po.status AS status, po.created_at AS occurred_at, po.total_amount::numeric AS amount, po.rfq_id AS reference_id FROM mkt_purchase_orders po WHERE po.vendor_id = ${id}`),
    tryLeg("logistic_quote", sql`SELECT 'logistic_quote'::text AS type, loq.id AS id, loq.quote_status AS status, loq.created_at AS occurred_at, loq.vendor_price::numeric AS amount, loq.order_id AS reference_id FROM logistic_order_quotes loq WHERE loq.vendor_id = ${id}`),
    tryLeg("logistic_fulfillment", sql`SELECT 'logistic_fulfillment'::text AS type, lvf.id AS id, lvf.status AS status, lvf.created_at AS occurred_at, NULL::numeric AS amount, lvf.order_id AS reference_id FROM logistic_vendor_fulfillments lvf WHERE lvf.vendor_id = ${id}`),
    tryLeg("logistic_order", sql`SELECT 'logistic_order'::text AS type, lo.id AS id, lo.status AS status, lo.created_at AS occurred_at, lo.final_price::numeric AS amount, lo.id AS reference_id FROM logistic_orders lo WHERE lo.approved_vendor_id = ${id}`),
  ]);

  // All legs failed → data is completely unavailable; return explicit error
  const TOTAL_LEGS = 5;
  if (failedLegs.length === TOTAL_LEGS) {
    return res.status(503).json({
      success: false,
      code: "VENDOR_TRANSACTION_DATA_UNAVAILABLE",
      message: "Data transaksi vendor belum dapat dimuat.",
    });
  }

  let allRows = subqueries.flatMap((s) => s.rows);
  if (typeFilter) allRows = allRows.filter((r: unknown) => (r as { type?: string }).type === typeFilter);
  allRows.sort((a: unknown, b: unknown) => {
    const da = (a as { occurred_at?: string | null }).occurred_at;
    const db2 = (b as { occurred_at?: string | null }).occurred_at;
    if (!da && !db2) return 0;
    if (!da) return 1;
    if (!db2) return -1;
    return new Date(db2).getTime() - new Date(da).getTime();
  });
  const paged = allRows.slice(offset, offset + limit);

  // Build warnings for any partial failures — no SQL/table details exposed
  const warnings = failedLegs.map((src) => ({
    source: src,
    code: "TRANSACTION_SOURCE_UNAVAILABLE",
    message: "Sebagian sumber transaksi sedang tidak tersedia.",
  }));

  return res.json({
    success: true,
    data: paged,
    pagination: { page: Math.floor(offset / limit) + 1, limit, offset, total: allRows.length, totalPages: Math.ceil(allRows.length / limit) },
    summary: { totalTransactions: allRows.length },
    warnings,
  });
});

// GET /api/trading/suppliers/:id/financial-summary — Vendor Master Enhancement P3.
// Aggregates vendor_invoices (billed/outstanding/overdue) and vendor_payments
// (total paid) for a single vendor. Read-only; does not recompute figures that
// vendor-performance already owns (revenue/margin) — those are exposed
// separately via GET /api/vendor-performance/:vendorId to avoid duplicated logic.
router.get("/suppliers/:id/financial-summary", async (req, res) => {
  if (!(await requireClerkUser(req, res))) return;
  const id = Number(String(req.params.id));
  if (Number.isNaN(id)) return res.status(400).json({ success: false, message: "Invalid id" });

  const [vendor] = await db.select({ id: suppliersTable.id, companyId: suppliersTable.companyId })
    .from(suppliersTable).where(eq(suppliersTable.id, id));
  if (!vendor) return res.status(404).json({ success: false, code: "SUPPLIER_NOT_FOUND", message: "Vendor tidak ditemukan" });
  const resolvedCid = resolveCompanyId(req);
  if (!(await assertCompanyAccess(vendor.companyId, resolvedCid, req, res, { resourceType: "supplier", resourceId: id }))) return;

  const [invoiceStats, paymentStats] = await Promise.all([
    db.execute(sql`
      SELECT
        COUNT(*)::int                                                            AS invoice_count,
        COALESCE(SUM(grand_total), 0)::numeric(18,2)                             AS total_billed,
        COALESCE(SUM(amount_paid), 0)::numeric(18,2)                             AS total_paid_on_invoices,
        COALESCE(SUM(grand_total - amount_paid) FILTER (WHERE status != 'paid' AND status != 'cancelled'), 0)::numeric(18,2) AS outstanding,
        COUNT(*) FILTER (WHERE due_date < NOW() AND status NOT IN ('paid', 'cancelled'))::int AS overdue_count,
        COALESCE(SUM(grand_total - amount_paid) FILTER (WHERE due_date < NOW() AND status NOT IN ('paid', 'cancelled')), 0)::numeric(18,2) AS overdue_amount
      FROM vendor_invoices WHERE supplier_id = ${id}
    `),
    db.execute(sql`
      SELECT
        COUNT(*)::int                                   AS payment_count,
        COALESCE(SUM(amount), 0)::numeric(18,2)         AS total_paid,
        COALESCE(SUM(amount) FILTER (WHERE payment_date >= DATE_TRUNC('month', NOW())), 0)::numeric(18,2) AS paid_this_month
      FROM vendor_payments WHERE supplier_id = ${id}
    `),
  ]);

  const inv = (invoiceStats.rows[0] ?? {}) as Record<string, unknown>;
  const pay = (paymentStats.rows[0] ?? {}) as Record<string, unknown>;

  return res.json({
    success: true,
    data: {
      invoiceCount: Number(inv["invoice_count"] ?? 0),
      totalBilled: Number(inv["total_billed"] ?? 0),
      outstanding: Number(inv["outstanding"] ?? 0),
      overdueCount: Number(inv["overdue_count"] ?? 0),
      overdueAmount: Number(inv["overdue_amount"] ?? 0),
      paymentCount: Number(pay["payment_count"] ?? 0),
      totalPaid: Number(pay["total_paid"] ?? 0),
      paidThisMonth: Number(pay["paid_this_month"] ?? 0),
    },
  });
});

// GET /api/trading/suppliers/:id/audit-log — Vendor Master Enhancement P3.
// Admin-only (mirrors GET /api/audit-logs role gate). Filters erp_audit_logs
// to entries whose reference_id matches this supplier across the modules that
// actually write supplier-scoped entries today (trading, vendor, vendor_job).
// Sensitive fields (bank account numbers, NPWP) inside old_data/new_data are
// masked before returning — this endpoint is consumed by a UI tab, not an
// internal debugging tool.
const AUDIT_SENSITIVE_KEYS = ["bankAccountNumber", "bank_account_number", "npwp", "accountNumber", "account_number"];
function maskSensitive(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(maskSensitive);
  if (value && typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      if (AUDIT_SENSITIVE_KEYS.includes(k) && typeof v === "string" && v.length > 4) {
        out[k] = `${"*".repeat(Math.max(v.length - 4, 0))}${v.slice(-4)}`;
      } else {
        out[k] = maskSensitive(v);
      }
    }
    return out;
  }
  return value;
}

router.get("/suppliers/:id/audit-log", async (req, res) => {
  if (!(await requireClerkUser(req, res))) return;
  const user = req.user as { role?: string | null } | undefined;
  const isAdmin = ["admin", "owner", "super_admin"].includes(user?.role ?? "");
  if (!isAdmin) return res.status(403).json({ success: false, message: "Hanya admin/owner yang bisa mengakses audit log vendor" });

  const id = Number(String(req.params.id));
  if (Number.isNaN(id)) return res.status(400).json({ success: false, message: "Invalid id" });

  const [vendor] = await db.select({ id: suppliersTable.id, companyId: suppliersTable.companyId })
    .from(suppliersTable).where(eq(suppliersTable.id, id));
  if (!vendor) return res.status(404).json({ success: false, code: "SUPPLIER_NOT_FOUND", message: "Vendor tidak ditemukan" });
  const resolvedCid = resolveCompanyId(req);
  if (!(await assertCompanyAccess(vendor.companyId, resolvedCid, req, res, { resourceType: "supplier", resourceId: id }))) return;

  const limit = Math.min(Number(req.query.limit ?? 100), 500);
  const offset = Math.max(Number(req.query.offset ?? 0), 0);

  const rows = await db.execute(sql`
    SELECT id, action, module, reference_id, old_data, new_data, user_email, created_at
    FROM erp_audit_logs
    WHERE reference_id = ${String(id)}
      AND module IN ('trading', 'vendor', 'vendor_job')
    ORDER BY created_at DESC
    LIMIT ${limit} OFFSET ${offset}
  `);

  const data = (rows.rows as Record<string, unknown>[]).map((r) => ({
    ...r,
    old_data: maskSensitive(r["old_data"]),
    new_data: maskSensitive(r["new_data"]),
  }));

  return res.json({ success: true, data, pagination: { limit, offset } });
});

// GET /api/trading/suppliers/:id/companies — list assigned company IDs
// Requires an authenticated internal session (was previously open to anyone
// who knew a vendor ID, leaking which companies a vendor is scoped to).
router.get("/suppliers/:id/companies", async (req, res) => {
  if (!(await requireClerkUser(req, res))) return;
  const id = Number(String(req.params.id));
  if (Number.isNaN(id)) return res.status(400).json({ message: "Invalid id" });

  const [vendor] = await db.select({ id: suppliersTable.id, companyId: suppliersTable.companyId })
    .from(suppliersTable).where(eq(suppliersTable.id, id));
  if (!vendor) return res.status(404).json({ message: "Vendor not found" });
  const resolvedCid = resolveCompanyId(req);
  if (!(await assertCompanyAccess(vendor.companyId, resolvedCid, req, res, { resourceType: "supplier", resourceId: id }))) return;

  const rows = await db.execute(sql`
    SELECT company_id FROM vendor_company_assignments WHERE vendor_id = ${id}
  `);
  return res.json({ vendorId: id, companyIds: (rows.rows as { company_id: number }[]).map(r => r.company_id) });
});

// PUT /api/trading/suppliers/:id/companies — replace all company assignments (admin only)
router.put("/suppliers/:id/companies", async (req, res) => {
  if (!(await requireAdmin(req, res))) return;
  const id = Number(String(req.params.id));
  if (Number.isNaN(id)) return res.status(400).json({ success: false, message: "Invalid id" });

  const [vendor] = await db.select({ id: suppliersTable.id, companyId: suppliersTable.companyId })
    .from(suppliersTable).where(eq(suppliersTable.id, id));
  if (!vendor) return res.status(404).json({ success: false, code: "SUPPLIER_NOT_FOUND", message: "Vendor tidak ditemukan" });
  // IDOR guard: a company-scoped admin must not be able to reassign another
  // company's vendor. Mirrors the ownership check already done in
  // PUT /suppliers/:id and POST /suppliers/bulk-assign-company.
  const resolvedCid = resolveCompanyId(req);
  if (!(await assertCompanyAccess(vendor.companyId, resolvedCid, req, res, { resourceType: "supplier", resourceId: id }))) return;

  const { companyIds } = req.body as { companyIds: number[] };
  if (!Array.isArray(companyIds)) return res.status(400).json({ success: false, message: "companyIds must be an array" });

  const ids = companyIds.map(Number).filter(n => !Number.isNaN(n) && n > 0);

  // FASE 1 point 5: a non-super-admin may only grant access to companies
  // within their own scope — they cannot hand a vendor's access to some
  // other company they don't manage.
  const isSuperAdmin = (req as any).user?.role === "super_admin";
  if (!isSuperAdmin && ids.some((cid) => cid !== resolvedCid)) {
    return res.status(403).json({
      success: false,
      code: "SUPPLIER_ACCESS_DENIED",
      message: "Anda tidak memiliki akses untuk menambahkan company di luar scope Anda.",
    });
  }

  const meta = extractRequestMeta(req);
  const beforeRows = await db.execute(sql`SELECT company_id FROM vendor_company_assignments WHERE vendor_id = ${id}`);
  const beforeCompanyIds = (beforeRows.rows as { company_id: number }[]).map((r) => r.company_id);

  // Replace all assignments atomically (FASE 1 point 9).
  await db.transaction(async (tx) => {
    await tx.execute(sql`DELETE FROM vendor_company_assignments WHERE vendor_id = ${id}`);
    for (const cid of ids) {
      await tx.execute(sql`
        INSERT INTO vendor_company_assignments (vendor_id, company_id)
        VALUES (${id}, ${cid})
        ON CONFLICT (vendor_id, company_id) DO NOTHING
      `);
    }
  });

  // FASE 1 point 10: audit trail of the before/after company relation.
  writeAuditLog({
    ...meta,
    companyId: resolvedCid,
    action: "SUPPLIER_COMPANIES_UPDATED",
    module: "trading",
    referenceId: String(id),
    oldData: { companyIds: beforeCompanyIds },
    newData: { companyIds: ids, requestId: (req.headers["x-request-id"] as string) ?? null, timestamp: new Date().toISOString() },
  });

  return res.json({ success: true, vendorId: id, companyIds: ids });
});

// POST /api/trading/suppliers/bulk-assign-company — bulk update company_id on multiple vendors
router.post("/suppliers/bulk-assign-company", async (req, res) => {
  if (!(await requireAdmin(req, res))) return;
  const { vendorIds, companyId } = req.body as { vendorIds: unknown; companyId: unknown };
  if (!Array.isArray(vendorIds)) return res.status(400).json({ message: "vendorIds must be an array" });
  const ids = (vendorIds as unknown[]).map(Number).filter(n => !Number.isNaN(n) && n > 0);
  if (ids.length === 0) return res.status(400).json({ message: "No valid vendorIds provided" });

  const resolvedCid = resolveCompanyId(req);
  const isSuperAdmin = (req as any).user?.role === "super_admin";
  const meta = extractRequestMeta(req);

  // ── Ownership: verify ALL vendorIds belong to resolvedCompanyId ───────────
  const ownedVendors = await db
    .select({ id: suppliersTable.id, companyId: suppliersTable.companyId })
    .from(suppliersTable)
    .where(inArray(suppliersTable.id, ids));
  const missingIds = ids.filter(id => !ownedVendors.find(v => v.id === id));
  if (missingIds.length > 0)
    return res.status(404).json({ message: `Vendor tidak ditemukan: ${missingIds.join(", ")}` });
  const unauthorizedVendors = isSuperAdmin ? [] : ownedVendors.filter(
    v => v.companyId !== null && v.companyId !== resolvedCid
  );
  if (unauthorizedVendors.length > 0) {
    writeAuditLog({
      ...meta, companyId: resolvedCid, action: "BULK_OPERATION_DENIED", module: "trading",
      newData: {
        operationType: "bulk-assign-company", resourceType: "supplier",
        unauthorizedIds: unauthorizedVendors.map(v => v.id),
        timestamp: new Date().toISOString(),
      },
    });
    return res.status(403).json({
      message: "Akses ditolak: beberapa vendor bukan milik perusahaan ini",
      unauthorizedIds: unauthorizedVendors.map(v => v.id),
    });
  }

  const cid = companyId != null && companyId !== "" ? Number(companyId) : null;

  writeAuditLog({
    ...meta, companyId: resolvedCid, action: "BULK_OPERATION_VERIFIED", module: "trading",
    newData: {
      operationType: "bulk-assign-company", resourceType: "supplier",
      recordCount: ids.length, targetCompanyId: cid, timestamp: new Date().toISOString(),
    },
  });

  await db.execute(sql`UPDATE suppliers SET company_id = ${cid} WHERE id = ANY(${ids})`);
  return res.json({ updated: ids.length, companyId: cid });
});

// POST /api/trading/suppliers
router.post("/suppliers", async (req, res) => {
  if (!(await requireAdmin(req, res))) return;
  const { name, country, contactEmail, contactPerson, phone, address, taxId, defaultPurchaseTaxId,
    serviceType, isActive, logo, eta, fee, note, sortOrder, hasInternalTruck, internalTruckPrice } = req.body;
  const companyId = resolveCompanyId(req);
  const [supplier] = await db.insert(suppliersTable).values({
    companyId,
    name, country: country ?? null, contactEmail: contactEmail ?? null,
    contactPerson: contactPerson ?? null,
    phone: phone ?? null, address: address ?? null,
    taxId: taxId ?? null, defaultPurchaseTaxId: defaultPurchaseTaxId ?? null,
    serviceType: serviceType ?? null,
    isActive: isActive !== undefined ? Boolean(isActive) : true,
    logo: logo ?? "📦",
    eta: eta ?? null,
    fee: fee !== undefined ? String(parseFloat(String(fee)) || 0) : "0",
    note: note ?? null,
    sortOrder: sortOrder !== undefined ? Number(sortOrder) : 0,
    hasInternalTruck: hasInternalTruck ? Boolean(hasInternalTruck) : false,
    internalTruckPrice: internalTruckPrice != null ? String(parseFloat(String(internalTruckPrice)) || 0) : null,
  } as any).returning();
  return res.status(201).json({ ...supplier, fee: Number(supplier.fee ?? 0), createdAt: supplier.createdAt.toISOString() });
});

// PUT /api/trading/suppliers/:id
router.put("/suppliers/:id", async (req, res) => {
  if (!(await requireAdmin(req, res))) return;
  const id = Number(String(req.params.id));
  if (Number.isNaN(id)) return res.status(400).json({ message: "Invalid id" });
  const companyId = resolveCompanyId(req);
  const [target] = await db.select({ id: suppliersTable.id, companyId: suppliersTable.companyId })
    .from(suppliersTable).where(eq(suppliersTable.id, id));
  if (!target) return res.status(404).json({ message: "Supplier not found" });
  if (!(await assertCompanyAccess(target.companyId, companyId, req, res, { resourceType: "supplier", resourceId: id }))) return;
  const { name, country, contactEmail, contactPerson, phone, address, taxId, defaultPurchaseTaxId,
    serviceType, isActive, logo, eta, fee, note, sortOrder, hasInternalTruck, internalTruckPrice } = req.body;
  const patch: Record<string, unknown> = {};
  if (typeof name === "string") patch["name"] = name;
  if (country !== undefined) patch["country"] = country || null;
  if (contactEmail !== undefined) patch["contactEmail"] = contactEmail || null;
  if (contactPerson !== undefined) patch["contactPerson"] = contactPerson || null;
  if (phone !== undefined) patch["phone"] = phone || null;
  if (address !== undefined) patch["address"] = address || null;
  if (taxId !== undefined) patch["taxId"] = taxId || null;
  if (defaultPurchaseTaxId !== undefined) patch["defaultPurchaseTaxId"] = defaultPurchaseTaxId;
  if (serviceType !== undefined) patch["serviceType"] = serviceType || null;
  if (isActive !== undefined) patch["isActive"] = Boolean(isActive);
  if (logo !== undefined) patch["logo"] = logo || "📦";
  if (eta !== undefined) patch["eta"] = eta || null;
  if (fee !== undefined) patch["fee"] = String(parseFloat(String(fee)) || 0);
  if (note !== undefined) patch["note"] = note || null;
  if (sortOrder !== undefined) patch["sortOrder"] = Number(sortOrder);
  if (hasInternalTruck !== undefined) patch["hasInternalTruck"] = Boolean(hasInternalTruck);
  if (internalTruckPrice !== undefined) patch["internalTruckPrice"] = internalTruckPrice != null && internalTruckPrice !== "" ? String(parseFloat(String(internalTruckPrice)) || 0) : null;

  const [updated] = await db.update(suppliersTable).set(patch).where(eq(suppliersTable.id, id)).returning();
  if (!updated) return res.status(404).json({ message: "Supplier not found" });
  return res.json({ ...updated, fee: Number(updated.fee ?? 0), createdAt: updated.createdAt.toISOString() });
});

// DELETE /api/trading/suppliers/:id
// FASE 3 (vendor audit): a vendor that has transaction history (logistic
// quotes, purchase orders, fulfillments — RESTRICT FKs) can no longer be
// hard-deleted. Instead of surfacing the raw FK-violation 409, it is
// automatically archived (isActive=false) so it disappears from new-transaction
// pickers but stays visible on historical records.
router.delete("/suppliers/:id", async (req, res) => {
  if (!(await requireAdmin(req, res))) return;
  const id = Number(String(req.params.id));
  if (Number.isNaN(id)) return res.status(400).json({ success: false, message: "Invalid id" });
  const companyId = resolveCompanyId(req);
  const meta = extractRequestMeta(req);

  const [target] = await db.select({ id: suppliersTable.id, companyId: suppliersTable.companyId })
    .from(suppliersTable).where(eq(suppliersTable.id, id));
  if (!target) return res.status(404).json({ success: false, code: "SUPPLIER_NOT_FOUND", message: "Vendor tidak ditemukan" });
  if (!(await assertCompanyAccess(target.companyId, companyId, req, res, { resourceType: "supplier", resourceId: id }))) return;

  let deleted: typeof suppliersTable.$inferSelect | undefined;
  try {
    [deleted] = await db.delete(suppliersTable).where(eq(suppliersTable.id, id)).returning();
  } catch (err) {
    // Postgres 23503 = foreign_key_violation. Several tables (purchase orders,
    // vendor quotes, fulfillments) RESTRICT deletion when a vendor still has
    // transaction history — archive instead of a raw 500/409.
    if ((err as { code?: string } | null)?.code === "23503") {
      const [archived] = await db.update(suppliersTable)
        .set({ isActive: false })
        .where(eq(suppliersTable.id, id))
        .returning();
      writeAuditLog({
        ...meta, companyId, action: "SUPPLIER_ARCHIVED", module: "trading",
        referenceId: String(id),
        newData: { reason: "has_transaction_history", timestamp: new Date().toISOString() },
      });
      return res.json({
        success: true,
        code: "SUPPLIER_ARCHIVED",
        message: "Vendor memiliki riwayat transaksi sehingga dinonaktifkan, bukan dihapus permanen.",
        data: archived,
      });
    }
    throw err;
  }

  if (!deleted) return res.status(404).json({ success: false, code: "SUPPLIER_NOT_FOUND", message: "Vendor tidak ditemukan" });
  writeAuditLog({
    ...meta, companyId, action: "SUPPLIER_DELETED", module: "trading",
    referenceId: String(id),
    oldData: { name: deleted.name },
  });
  // Cascade storage cleanup — logo (hanya jika berupa URL, bukan emoji)
  if (deleted.logo && (deleted.logo.startsWith("http") || deleted.logo.startsWith("/api/storage"))) {
    deleteFromSupabase(deleted.logo).catch(() => {});
  }
  return res.json({ success: true, code: "SUPPLIER_DELETED", message: "Deleted", id });
});

// ─── Vendor Catalog (Etalase) ────────────────────────────────────────────────

// GET /api/trading/suppliers/:id/catalog
router.get("/suppliers/:id/catalog", async (req, res) => {
  const vendorId = Number(String(req.params.id));
  if (Number.isNaN(vendorId)) return res.status(400).json({ message: "Invalid id" });
  const rows = await db
    .select({
      catalog: vendorCatalogItemsTable,
      masterPrice: productsTable.price,
    })
    .from(vendorCatalogItemsTable)
    .leftJoin(productsTable, eq(vendorCatalogItemsTable.masterItemId, productsTable.id))
    .where(eq(vendorCatalogItemsTable.vendorId, vendorId))
    .orderBy(vendorCatalogItemsTable.sortOrder, vendorCatalogItemsTable.createdAt);
  return res.json(rows.map(({ catalog: row, masterPrice }) => {
    const priceBase = Number(row.priceBase ?? 0);
    const priceSellOverride = row.priceSell != null ? Number(row.priceSell) : null;
    const masterPriceNum = masterPrice != null ? Number(masterPrice) : null;
    // priceSell eksplisit menang atas harga master item
    const priceSell = priceSellOverride ?? masterPriceNum;
    const profit = priceSell != null ? priceSell - priceBase : null;
    return {
      ...toItem(row),
      priceSell,
      priceSellOverride,
      profit,
    };
  }));
});

// POST /api/trading/suppliers/:id/catalog
// Wajib menyertakan masterItemId — nama, tipe, satuan, deskripsi diambil otomatis dari Master Item
router.post("/suppliers/:id/catalog", async (req, res) => {
  if (!(await requireAdmin(req, res))) return;
  const vendorId = Number(String(req.params.id));
  if (Number.isNaN(vendorId)) return res.status(400).json({ message: "Invalid id" });

  const masterItemId = req.body.masterItemId != null ? Number(req.body.masterItemId) : null;
  if (!masterItemId || Number.isNaN(masterItemId))
    return res.status(400).json({ message: "masterItemId wajib diisi — pilih item dari Master Item" });

  // Cek master item ada
  const [masterItem] = await db
    .select()
    .from(productsTable)
    .where(eq(productsTable.id, masterItemId));
  if (!masterItem)
    return res.status(404).json({ message: "Master Item tidak ditemukan" });

  // Cegah duplikat: satu vendor tidak boleh punya master item yang sama dua kali
  const [existing] = await db
    .select({ id: vendorCatalogItemsTable.id })
    .from(vendorCatalogItemsTable)
    .where(and(
      eq(vendorCatalogItemsTable.vendorId, vendorId),
      eq(vendorCatalogItemsTable.masterItemId, masterItemId),
    ));
  if (existing)
    return res.status(409).json({ message: "Item ini sudah ada di etalase vendor ini" });

  const {
    isActive, isCommodityTag, sortOrder,
    templateKind, categoryKey, serviceType: svcType,
    templateId, templateVersion, templateSnapshot, specValues,
    priceSell, currency, stockStatus, stockQty, moq, leadTime,
    validityDate, location, origin, documents,
    status: itemStatus, isPublished, sourceSubmissionId,
    vendorName: bodyVendorName,
  } = req.body;

  // priceBase = Harga Dasar = harga yang vendor charge ke kita (manual input, default 0)
  const priceBase = req.body.priceBase != null ? String(parseFloat(String(req.body.priceBase)) || 0) : "0";

  // Ambil vendor name dari suppliers jika tidak disuplai
  const [supplierRow] = await db
    .select({ name: suppliersTable.name })
    .from(suppliersTable)
    .where(eq(suppliersTable.id, vendorId));

  // Ambil kategori pertama dari master item
  const categoryMap = await db
    .select({ name: productCategoriesTable.name })
    .from(productCategoryMapTable)
    .innerJoin(productCategoriesTable, eq(productCategoryMapTable.categoryId, productCategoriesTable.id))
    .where(eq(productCategoryMapTable.productId, masterItemId));
  const kategori = categoryMap[0]?.name ?? null;

  const [item] = await db.insert(vendorCatalogItemsTable).values({
    vendorId,
    vendorName: bodyVendorName ?? supplierRow?.name ?? null,
    masterItemId,
    type: masterItem.itemType === "jasa" ? "service" : "product",
    name: masterItem.name,
    description: masterItem.description ?? null,
    unit: masterItem.unit ?? null,
    kategori,
    subcategory: masterItem.subcategory ?? null,
    priceBase,
    markupPct: "0",
    priceSell: priceSell != null ? String(parseFloat(String(priceSell)) || 0) : null,
    currency: currency ?? "IDR",
    templateKind: templateKind ?? (masterItem.itemType === "jasa" ? "service" : "product"),
    categoryKey: categoryKey ?? masterItem.subcategory ?? null,
    serviceType: svcType ?? null,
    templateId: templateId ?? null,
    templateVersion: templateVersion ?? null,
    templateSnapshot: templateSnapshot ?? null,
    specValues: specValues ?? null,
    stockStatus: stockStatus ?? null,
    stockQty: stockQty != null ? String(parseFloat(String(stockQty))) : null,
    moq: moq != null ? String(parseFloat(String(moq))) : null,
    leadTime: leadTime ?? null,
    validityDate: validityDate ?? null,
    location: location ?? null,
    origin: origin ?? null,
    documents: documents ?? null,
    ...(req.body.hsCode !== undefined ? { hsCode: req.body.hsCode?.trim() || null } : {}),
    status: itemStatus ?? "draft",
    isPublished: isPublished !== undefined ? Boolean(isPublished) : false,
    isActive: isActive !== undefined ? Boolean(isActive) : true,
    isCommodityTag: isCommodityTag !== undefined ? Boolean(isCommodityTag) : false,
    sortOrder: sortOrder !== undefined ? Number(sortOrder) : 0,
    sourceSubmissionId: sourceSubmissionId ? Number(sourceSubmissionId) : null,
  }).returning();
  return res.status(201).json(toItem(item));
});

// PUT /api/trading/suppliers/catalog/:itemId
// Master-linked items: boleh edit priceBase (Harga Dasar) + isActive/isCommodityTag/sortOrder
// Legacy items (tanpa masterItemId): boleh edit semua field termasuk deskriptif
router.put("/suppliers/catalog/:itemId", async (req, res) => {
  if (!(await requireAdmin(req, res))) return;
  const itemId = Number(String(req.params.itemId));
  if (Number.isNaN(itemId)) return res.status(400).json({ message: "Invalid id" });

  const [current] = await db
    .select()
    .from(vendorCatalogItemsTable)
    .where(eq(vendorCatalogItemsTable.id, itemId));
  if (!current) return res.status(404).json({ message: "Item not found" });
  // Ownership: catalog item → parent vendor → companyId
  const [catalogVendorPut] = await db
    .select({ companyId: suppliersTable.companyId })
    .from(suppliersTable)
    .where(eq(suppliersTable.id, current.vendorId));
  const cidCatalogPut = resolveCompanyId(req);
  if (!await assertCompanyAccess(catalogVendorPut?.companyId ?? null, cidCatalogPut, req, res, { resourceType: "vendor_catalog_item", resourceId: itemId })) return;

  // ── Khusus: Link legacy item ke master item ───────────────────────────────
  if (req.body.linkMasterItemId != null && !current.masterItemId) {
    const newMasterId = Number(req.body.linkMasterItemId);
    if (Number.isNaN(newMasterId)) return res.status(400).json({ message: "linkMasterItemId tidak valid" });

    const [masterItem] = await db.select().from(productsTable).where(eq(productsTable.id, newMasterId));
    if (!masterItem) return res.status(404).json({ message: "Master Item tidak ditemukan" });

    const [dup] = await db
      .select({ id: vendorCatalogItemsTable.id })
      .from(vendorCatalogItemsTable)
      .where(and(
        eq(vendorCatalogItemsTable.vendorId, current.vendorId),
        eq(vendorCatalogItemsTable.masterItemId, newMasterId),
      ));
    if (dup) return res.status(409).json({ message: "Item ini sudah ada di etalase vendor ini" });

    const categoryMap = await db
      .select({ name: productCategoriesTable.name })
      .from(productCategoryMapTable)
      .innerJoin(productCategoriesTable, eq(productCategoryMapTable.categoryId, productCategoriesTable.id))
      .where(eq(productCategoryMapTable.productId, newMasterId));
    const kategori = categoryMap[0]?.name ?? null;

    const [linked] = await db.update(vendorCatalogItemsTable).set({
      masterItemId: newMasterId,
      name: masterItem.name,
      type: masterItem.itemType === "jasa" ? "service" : "product",
      unit: masterItem.unit ?? null,
      description: masterItem.description ?? null,
      kategori,
      subcategory: masterItem.subcategory ?? null,
    }).where(eq(vendorCatalogItemsTable.id, itemId)).returning();

    return res.json(toItem(linked));
  }

  const {
    isActive, isCommodityTag, sortOrder,
    templateKind, categoryKey, serviceType: svcType,
    templateId, templateVersion, templateSnapshot, specValues,
    priceSell: bodySell, currency, stockStatus, stockQty, moq, leadTime,
    validityDate, location, origin, documents,
    status: itemStatus, isPublished, sourceSubmissionId,
    vendorName: bodyVendorName,
  } = req.body;

  // ── Phase 2: Server-side template validation ──────────────────────────────
  // If specValues is being updated, validate against the server-resolved template.
  // Never trust templateSnapshot from the client.
  let _resolvedTpl: ReturnType<typeof resolveTemplate> | null = null;
  if (specValues != null) {
    const effectiveCategoryKey =
      (typeof categoryKey === "string" ? categoryKey : null) ??
      current.categoryKey ??
      null;
    if (effectiveCategoryKey) {
      // Fail-closed: unknown categoryKey with specValues must be rejected, not
      // silently resolved to the "general" fallback.
      _resolvedTpl = resolveTemplateStrict(effectiveCategoryKey);
      if (!_resolvedTpl) {
        return res.status(400).json({
          message: "Template produk tidak ditemukan",
          code: "TEMPLATE_NOT_FOUND",
        });
      }
      const formValues = specValuesToFormValues(
        specValues as Record<string, unknown>,
        documents,
      );
      const unknown = getUnknownFields(_resolvedTpl, formValues);
      if (unknown.length > 0) {
        console.warn(
          `[catalog-put] item=${itemId} unknown spec fields (ignored):`,
          unknown,
        );
      }
      const tplErrors = validateTemplatePayload(_resolvedTpl, formValues);
      if (tplErrors.length > 0) {
        return res.status(400).json({
          message: "Spec values tidak valid menurut template produk",
          errors: tplErrors,
        });
      }
    }
  }

  const patch: Record<string, unknown> = {};

  // Item lama (legacy) tanpa masterItemId — boleh edit field deskriptif
  if (!current.masterItemId) {
    const { type, name, description, unit, kategori, subcategory } = req.body;
    if (type !== undefined) patch["type"] = type;
    if (typeof name === "string") patch["name"] = name;
    if (description !== undefined) patch["description"] = description || null;
    if (unit !== undefined) patch["unit"] = unit || null;
    if (kategori !== undefined) patch["kategori"] = kategori || null;
    if (subcategory !== undefined) patch["subcategory"] = subcategory || null;
  }

  // Harga Dasar — selalu boleh diedit
  if (req.body.priceBase !== undefined)
    patch["priceBase"] = String(parseFloat(String(req.body.priceBase)) || 0);

  // Override Harga Jual — null = hapus override
  if (req.body.priceSellOverride !== undefined) {
    const raw = req.body.priceSellOverride;
    patch["priceSell"] = raw != null && raw !== "" ? String(parseFloat(String(raw)) || 0) : null;
  } else if (bodySell !== undefined) {
    patch["priceSell"] = bodySell != null && bodySell !== "" ? String(parseFloat(String(bodySell)) || 0) : null;
  }

  // Semua field baru — selalu boleh diedit
  if (currency !== undefined) patch["currency"] = currency ?? "IDR";
  if (bodyVendorName !== undefined) patch["vendorName"] = bodyVendorName || null;
  if (templateKind !== undefined) patch["templateKind"] = templateKind || null;
  if (categoryKey !== undefined) patch["categoryKey"] = categoryKey || null;
  if (svcType !== undefined) patch["serviceType"] = svcType || null;
  // Snapshot HARUS dari server-side resolver — tidak boleh dari client secara langsung.
  if (_resolvedTpl != null) {
    // specValues validated: freeze server-resolved snapshot
    patch["templateId"]       = _resolvedTpl.category;
    patch["templateVersion"]  = _resolvedTpl.version;
    patch["templateSnapshot"] = { ..._resolvedTpl };
    patch["specValues"]       = specValues ?? null;
  } else {
    if (templateId !== undefined)       patch["templateId"]       = templateId || null;
    if (templateVersion !== undefined)  patch["templateVersion"]  = templateVersion || null;
    // Client templateSnapshot only accepted when there is no specValues update
    // (e.g. admin explicitly linking a legacy item to a known template).
    if (templateSnapshot !== undefined) patch["templateSnapshot"] = templateSnapshot ?? null;
    if (specValues !== undefined)       patch["specValues"]       = specValues ?? null;
  }
  if (stockStatus !== undefined) patch["stockStatus"] = stockStatus || null;
  if (stockQty !== undefined) patch["stockQty"] = stockQty != null ? String(parseFloat(String(stockQty))) : null;
  if (moq !== undefined) patch["moq"] = moq != null ? String(parseFloat(String(moq))) : null;
  if (leadTime !== undefined) patch["leadTime"] = leadTime || null;
  if (validityDate !== undefined) patch["validityDate"] = validityDate || null;
  if (location !== undefined) patch["location"] = location || null;
  if (origin !== undefined) patch["origin"] = origin || null;
  if (documents !== undefined) patch["documents"] = documents ?? null;
  if (req.body.hsCode !== undefined) (patch as any)["hsCode"] = req.body.hsCode?.trim() || null;
  if (itemStatus !== undefined) patch["status"] = itemStatus;
  if (isPublished !== undefined) patch["isPublished"] = Boolean(isPublished);
  if (sourceSubmissionId !== undefined) patch["sourceSubmissionId"] = sourceSubmissionId ? Number(sourceSubmissionId) : null;

  // Featured + Status & urutan
  if (req.body.isFeatured !== undefined) patch["isFeatured"] = Boolean(req.body.isFeatured);
  if (req.body.featuredUntil !== undefined) patch["featuredUntil"] = req.body.featuredUntil ? new Date(req.body.featuredUntil as string) : null;
  if (isActive !== undefined) patch["isActive"] = Boolean(isActive);
  if (isCommodityTag !== undefined) patch["isCommodityTag"] = Boolean(isCommodityTag);
  if (sortOrder !== undefined) patch["sortOrder"] = Number(sortOrder);

  // Selalu set updatedAt
  patch["updatedAt"] = new Date();

  if (Object.keys(patch).length <= 1) {
    return res.json(toItem(current));
  }
  const [updated] = await db
    .update(vendorCatalogItemsTable)
    .set(patch)
    .where(eq(vendorCatalogItemsTable.id, itemId))
    .returning();
  if (!updated) return res.status(404).json({ message: "Item not found" });
  return res.json({ ...toItem(updated), priceSellOverride: updated.priceSell != null ? Number(updated.priceSell) : null });
});

// DELETE /api/trading/suppliers/catalog/:itemId
router.delete("/suppliers/catalog/:itemId", async (req, res) => {
  if (!(await requireAdmin(req, res))) return;
  const itemId = Number(String(req.params.itemId));
  if (Number.isNaN(itemId)) return res.status(400).json({ message: "Invalid id" });
  const [catalogOwnerDel] = await db
    .select({ companyId: suppliersTable.companyId })
    .from(vendorCatalogItemsTable)
    .innerJoin(suppliersTable, eq(vendorCatalogItemsTable.vendorId, suppliersTable.id))
    .where(eq(vendorCatalogItemsTable.id, itemId));
  if (!catalogOwnerDel) return res.status(404).json({ message: "Item not found" });
  const cidCatalogDel = resolveCompanyId(req);
  if (!await assertCompanyAccess(catalogOwnerDel.companyId, cidCatalogDel, req, res, { resourceType: "vendor_catalog_item", resourceId: itemId })) return;
  const [deleted] = await db
    .delete(vendorCatalogItemsTable)
    .where(eq(vendorCatalogItemsTable.id, itemId))
    .returning();
  if (!deleted) return res.status(404).json({ message: "Item not found" });
  return res.json({ message: "Deleted", id: itemId });
});

// ─── Vendor Catalog Admin (cross-vendor) ─────────────────────────────────────

// GET /api/trading/suppliers/catalog/all
// List semua catalog item lintas vendor — admin only
router.get("/suppliers/catalog/all", async (req, res) => {
  if (!(await requireAdmin(req, res))) return;

  const { vendor, status, templateKind, category, search } = req.query as Record<string, string>;

  const rows = await db
    .select({
      id: vendorCatalogItemsTable.id,
      vendorId: vendorCatalogItemsTable.vendorId,
      vendorName: suppliersTable.name,
      templateKind: vendorCatalogItemsTable.templateKind,
      categoryKey: vendorCatalogItemsTable.categoryKey,
      serviceType: vendorCatalogItemsTable.serviceType,
      name: vendorCatalogItemsTable.name,
      description: vendorCatalogItemsTable.description,
      kategori: vendorCatalogItemsTable.kategori,
      subcategory: vendorCatalogItemsTable.subcategory,
      specValues: vendorCatalogItemsTable.specValues,
      priceBase: vendorCatalogItemsTable.priceBase,
      markupPct: vendorCatalogItemsTable.markupPct,
      priceSell: vendorCatalogItemsTable.priceSell,
      currency: vendorCatalogItemsTable.currency,
      unit: vendorCatalogItemsTable.unit,
      moq: vendorCatalogItemsTable.moq,
      stockStatus: vendorCatalogItemsTable.stockStatus,
      stockQty: vendorCatalogItemsTable.stockQty,
      leadTime: vendorCatalogItemsTable.leadTime,
      location: vendorCatalogItemsTable.location,
      origin: vendorCatalogItemsTable.origin,
      status: vendorCatalogItemsTable.status,
      isPublished: vendorCatalogItemsTable.isPublished,
      isActive: vendorCatalogItemsTable.isActive,
      isFeatured: vendorCatalogItemsTable.isFeatured,
      publishedAt: vendorCatalogItemsTable.publishedAt,
      validityDate: vendorCatalogItemsTable.validityDate,
      viewCount: vendorCatalogItemsTable.viewCount,
      quoteCount: vendorCatalogItemsTable.quoteCount,
      orderCount: vendorCatalogItemsTable.orderCount,
      sourceSubmissionId: vendorCatalogItemsTable.sourceSubmissionId,
      mediaAssets: vendorCatalogItemsTable.mediaAssets,
      documents: vendorCatalogItemsTable.documents,
      createdAt: vendorCatalogItemsTable.createdAt,
      updatedAt: vendorCatalogItemsTable.updatedAt,
    })
    .from(vendorCatalogItemsTable)
    .innerJoin(suppliersTable, eq(vendorCatalogItemsTable.vendorId, suppliersTable.id))
    .orderBy(vendorCatalogItemsTable.updatedAt);

  let filtered = rows;

  if (vendor) {
    const vid = Number(vendor);
    if (!Number.isNaN(vid)) filtered = filtered.filter(r => r.vendorId === vid);
  }
  if (status) filtered = filtered.filter(r => r.status === status);
  if (templateKind) filtered = filtered.filter(r => r.templateKind === templateKind);
  if (category) {
    filtered = filtered.filter(r =>
      r.categoryKey === category || r.serviceType === category || r.kategori === category
    );
  }
  if (search) {
    const q = search.toLowerCase();
    filtered = filtered.filter(r =>
      r.name.toLowerCase().includes(q) ||
      (r.vendorName ?? "").toLowerCase().includes(q) ||
      (r.kategori ?? "").toLowerCase().includes(q) ||
      (r.categoryKey ?? "").toLowerCase().includes(q)
    );
  }

  return res.json(filtered.map(r => ({
    ...r,
    priceBase: Number(r.priceBase ?? 0),
    markupPct: Number(r.markupPct ?? 0),
    priceSell: r.priceSell != null ? Number(r.priceSell) : null,
    specSummary: r.specValues != null
      ? Object.entries(r.specValues as Record<string, unknown>)
          .slice(0, 3)
          .map(([k, v]) => `${k}: ${v}`)
          .join(", ")
      : null,
    createdAt: r.createdAt.toISOString(),
    updatedAt: r.updatedAt?.toISOString() ?? "",
    publishedAt: r.publishedAt?.toISOString() ?? null,
  })));
});

// GET /api/trading/suppliers/catalog/:itemId/detail
// Full detail: templateSnapshot, specValues, documents, checklist — admin only
router.get("/suppliers/catalog/:itemId/detail", async (req, res) => {
  if (!(await requireAdmin(req, res))) return;
  const itemId = Number(String(req.params.itemId));
  if (Number.isNaN(itemId)) return res.status(400).json({ message: "Invalid id" });

  const [row] = await db
    .select({
      item: vendorCatalogItemsTable,
      vendorName: suppliersTable.name,
      vendorServiceType: suppliersTable.serviceType,
    })
    .from(vendorCatalogItemsTable)
    .innerJoin(suppliersTable, eq(vendorCatalogItemsTable.vendorId, suppliersTable.id))
    .where(eq(vendorCatalogItemsTable.id, itemId));

  if (!row) return res.status(404).json({ message: "Item not found" });

  const i = row.item;
  return res.json({
    id: i.id,
    vendorId: i.vendorId,
    vendorName: row.vendorName,
    vendorServiceType: row.vendorServiceType,
    templateKind: i.templateKind,
    categoryKey: i.categoryKey,
    serviceType: i.serviceType,
    templateId: i.templateId,
    templateVersion: i.templateVersion,
    templateSnapshot: i.templateSnapshot,
    specValues: i.specValues,
    documents: i.documents,
    name: i.name,
    description: i.description,
    kategori: i.kategori,
    subcategory: i.subcategory,
    priceBase: Number(i.priceBase ?? 0),
    markupPct: Number(i.markupPct ?? 0),
    priceSell: i.priceSell != null ? Number(i.priceSell) : null,
    currency: i.currency,
    unit: i.unit,
    moq: i.moq,
    stockStatus: i.stockStatus,
    stockQty: i.stockQty,
    leadTime: i.leadTime,
    validityDate: i.validityDate ? String(i.validityDate) : null,
    location: i.location,
    origin: i.origin,
    status: i.status,
    isPublished: i.isPublished,
    isActive: i.isActive,
    isCommodityTag: i.isCommodityTag,
    sourceSubmissionId: i.sourceSubmissionId,
    mediaAssets: i.mediaAssets ?? [],
    publishedAt: i.publishedAt?.toISOString() ?? null,
    createdAt: i.createdAt.toISOString(),
    updatedAt: i.updatedAt?.toISOString() ?? "",
  });
});

// PATCH /api/trading/suppliers/catalog/:itemId/status
// publish / unpublish / archive — admin only
router.patch("/suppliers/catalog/:itemId/status", async (req, res) => {
  if (!(await requireAdmin(req, res))) return;
  const itemId = Number(String(req.params.itemId));
  if (Number.isNaN(itemId)) return res.status(400).json({ message: "Invalid id" });
  const [catalogOwnerStatus] = await db
    .select({ companyId: suppliersTable.companyId })
    .from(vendorCatalogItemsTable)
    .innerJoin(suppliersTable, eq(vendorCatalogItemsTable.vendorId, suppliersTable.id))
    .where(eq(vendorCatalogItemsTable.id, itemId));
  if (!catalogOwnerStatus) return res.status(404).json({ message: "Item not found" });
  const cidStatus = resolveCompanyId(req);
  if (!await assertCompanyAccess(catalogOwnerStatus.companyId, cidStatus, req, res, { resourceType: "vendor_catalog_item", resourceId: itemId })) return;

  const { status } = req.body as { status: string };
  const allowed = ["draft", "pending_review", "approved", "rejected", "published", "archived"];
  if (!allowed.includes(status)) {
    return res.status(400).json({ message: `status harus salah satu dari: ${allowed.join(", ")}` });
  }

  // Publish validation: check all required fields before publishing
  if (status === "published") {
    const [itemToValidate] = await db.select().from(vendorCatalogItemsTable).where(eq(vendorCatalogItemsTable.id, itemId));
    if (itemToValidate) {
      const assets = ((itemToValidate.mediaAssets ?? []) as any[]);
      const docs = ((itemToValidate.documents ?? []) as any[]);
      const specVals = itemToValidate.specValues as Record<string, unknown> | null;
      const missingFields: string[] = [];

      const hasGallery = assets.filter((a: any) => a.mediaType === "image" || a.type === "image").length >= 1;
      const hasSpec = specVals != null && Object.keys(specVals).length > 0;
      const hasDesc = !!(itemToValidate.description?.trim());
      const hasHsCode = !!((itemToValidate as any).hsCode?.trim());
      const hasDoc = docs.some((d: any) => d.reference?.trim() || d.fileUrl?.trim());

      if (!hasGallery) missingFields.push("Minimal 1 foto produk (Gallery)");
      if (!hasSpec) missingFields.push("Specification (minimal 1 field)");
      if (!hasDesc) missingFields.push("Deskripsi produk");
      if (!hasHsCode) missingFields.push("HS Code");
      if (!hasDoc) missingFields.push("Minimal 1 dokumen dengan file");

      if (missingFields.length > 0) {
        return res.status(422).json({
          message: "Produk belum memenuhi syarat untuk dipublikasikan. Lengkapi field berikut:",
          missingFields,
          code: "PUBLISH_VALIDATION_FAILED",
        });
      }
    }
  }

  const patch: Record<string, unknown> = { status, updatedAt: new Date() };
  if (status === "published") {
    patch["isPublished"] = true;
    patch["publishedAt"] = new Date();
  } else {
    patch["isPublished"] = false;
  }

  const [updated] = await db
    .update(vendorCatalogItemsTable)
    .set(patch)
    .where(eq(vendorCatalogItemsTable.id, itemId))
    .returning();

  if (!updated) return res.status(404).json({ message: "Item not found" });

  if (status === "published") {
    autoGenerateIfNeeded(itemId).catch(() => {});
  }

  return res.json({ ...toItem(updated), priceSell: updated.priceSell != null ? Number(updated.priceSell) : null });
});

// PATCH /api/trading/suppliers/catalog/:itemId/fields
// Edit priceSell, stockStatus, stockQty, leadTime — admin only
router.patch("/suppliers/catalog/:itemId/fields", async (req, res) => {
  if (!(await requireAdmin(req, res))) return;
  const itemId = Number(String(req.params.itemId));
  if (Number.isNaN(itemId)) return res.status(400).json({ message: "Invalid id" });
  const [catalogOwnerFields] = await db
    .select({ companyId: suppliersTable.companyId })
    .from(vendorCatalogItemsTable)
    .innerJoin(suppliersTable, eq(vendorCatalogItemsTable.vendorId, suppliersTable.id))
    .where(eq(vendorCatalogItemsTable.id, itemId));
  if (!catalogOwnerFields) return res.status(404).json({ message: "Item not found" });
  const cidFields = resolveCompanyId(req);
  if (!await assertCompanyAccess(catalogOwnerFields.companyId, cidFields, req, res, { resourceType: "vendor_catalog_item", resourceId: itemId })) return;

  const { priceSell, stockStatus, stockQty, leadTime, priceBase } = req.body as {
    priceSell?: number | null;
    stockStatus?: string;
    stockQty?: number | null;
    leadTime?: string;
    priceBase?: number;
  };

  const patch: Record<string, unknown> = { updatedAt: new Date() };
  if (priceSell !== undefined) patch["priceSell"] = priceSell != null ? String(priceSell) : null;
  if (priceBase !== undefined) patch["priceBase"] = String(parseFloat(String(priceBase)) || 0);
  if (stockStatus !== undefined) patch["stockStatus"] = stockStatus;
  if (stockQty !== undefined) patch["stockQty"] = stockQty;
  if (leadTime !== undefined) patch["leadTime"] = leadTime || null;

  if (Object.keys(patch).length === 1) {
    return res.status(400).json({ message: "Tidak ada field yang diupdate" });
  }

  const [updated] = await db
    .update(vendorCatalogItemsTable)
    .set(patch)
    .where(eq(vendorCatalogItemsTable.id, itemId))
    .returning();

  if (!updated) return res.status(404).json({ message: "Item not found" });
  return res.json({ ...toItem(updated), priceSell: updated.priceSell != null ? Number(updated.priceSell) : null });
});

// PATCH /api/trading/suppliers/catalog/:itemId/media
// Reorder mediaAssets, set cover — admin only
router.patch("/suppliers/catalog/:itemId/media", async (req, res) => {
  if (!(await requireAdmin(req, res))) return;
  const itemId = Number(String(req.params.itemId));
  if (Number.isNaN(itemId)) return res.status(400).json({ message: "Invalid id" });
  const [catalogOwnerMedia] = await db
    .select({ companyId: suppliersTable.companyId })
    .from(vendorCatalogItemsTable)
    .innerJoin(suppliersTable, eq(vendorCatalogItemsTable.vendorId, suppliersTable.id))
    .where(eq(vendorCatalogItemsTable.id, itemId));
  if (!catalogOwnerMedia) return res.status(404).json({ message: "Item not found" });
  const cidMedia = resolveCompanyId(req);
  if (!await assertCompanyAccess(catalogOwnerMedia.companyId, cidMedia, req, res, { resourceType: "vendor_catalog_item", resourceId: itemId })) return;

  const { mediaAssets } = req.body as {
    mediaAssets: Array<{
      url: string;
      name?: string;
      type?: string;
      isCover?: boolean;
      sortOrder?: number;
      mimeType?: string;
      documentKey?: string;
      visibility?: string;
    }>;
  };

  if (!Array.isArray(mediaAssets)) {
    return res.status(400).json({ message: "mediaAssets harus berupa array" });
  }

  const [ownerDocs] = await db
    .select({ documents: vendorCatalogItemsTable.documents })
    .from(vendorCatalogItemsTable)
    .where(eq(vendorCatalogItemsTable.id, itemId));
  const validation = validateMediaAssetsPayload(mediaAssets, ownerDocs?.documents);
  if (!validation.ok) return res.status(400).json({ message: validation.message });

  // Ensure sortOrder is sequential and isCover is consistent (only one cover)
  let coverSet = false;
  const normalized = validation.clean.map((a: any, i) => {
    const isCover = !coverSet && (a.isCover === true);
    if (isCover) coverSet = true;
    return { ...a, sortOrder: i, isCover };
  });
  // If no cover set, make first one cover
  if (!coverSet && normalized.length > 0) normalized[0].isCover = true;

  const [updated] = await db
    .update(vendorCatalogItemsTable)
    .set({ mediaAssets: normalized, updatedAt: new Date() })
    .where(eq(vendorCatalogItemsTable.id, itemId))
    .returning();

  if (!updated) return res.status(404).json({ message: "Item not found" });
  return res.json({
    id: updated.id,
    mediaAssets: updated.mediaAssets ?? [],
    message: "Media assets diperbarui",
  });
});

// POST /api/trading/suppliers/catalog/:itemId/media/upload
// Upload file → Replit Object Storage → return URL. BizPortal adds to local array, saves via PATCH /media.
router.post(
  "/suppliers/catalog/:itemId/media/upload",
  (req: any, res: any, next: any) =>
    (_tradingUpload.single("file") as any)(req, res, (err: any) => {
      if (err?.code === "LIMIT_FILE_SIZE") return res.status(413).json({ message: "Ukuran file terlalu besar (maks 50 MB)" });
      next(err);
    }),
  async (req: any, res: any) => {
    if (!(await requireAdmin(req, res))) return;
    const itemId = Number(String(req.params.itemId));
    if (Number.isNaN(itemId)) return res.status(400).json({ message: "ID tidak valid" });
    if (!req.file) return res.status(400).json({ message: "File wajib disertakan" });

    const validation = validateUploadFile(req.file, {
      allowedMime: CATALOG_MEDIA_ALLOWED_MIME,
      maxSizeBytes: 50 * 1024 * 1024,
    });
    if (!validation.ok) return res.status(415).json({ message: validation.errorMessage });

    try {
      const folder = req.file.mimetype.startsWith("video/") ? "catalog-videos" : "catalog-media";
      const { publicUrl, storagePath } = await uploadToSupabase(req.file.buffer, req.file.mimetype, folder);
      return res.status(201).json({
        url:        publicUrl,
        objectPath: storagePath,
        mimeType:   req.file.mimetype,
        sizeBytes:  req.file.size,
      });
    } catch (e: any) {
      return res.status(500).json({ message: e?.message ?? "Upload gagal" });
    }
  },
);

// PATCH /api/trading/suppliers/catalog/:itemId/pricing
// Admin-only: update priceSell. priceBase & margin TIDAK pernah dikirim ke customer API.
router.patch("/suppliers/catalog/:itemId/pricing", async (req, res) => {
  if (!(await requireAdmin(req, res))) return;
  const itemId = Number(String(req.params.itemId));
  if (Number.isNaN(itemId)) return res.status(400).json({ message: "Invalid id" });
  const [catalogOwnerPricing] = await db
    .select({ companyId: suppliersTable.companyId })
    .from(vendorCatalogItemsTable)
    .innerJoin(suppliersTable, eq(vendorCatalogItemsTable.vendorId, suppliersTable.id))
    .where(eq(vendorCatalogItemsTable.id, itemId));
  if (!catalogOwnerPricing) return res.status(404).json({ message: "Item not found" });
  const cidPricing = resolveCompanyId(req);
  if (!await assertCompanyAccess(catalogOwnerPricing.companyId, cidPricing, req, res, { resourceType: "vendor_catalog_item", resourceId: itemId })) return;

  const { priceSell } = req.body as { priceSell?: number | null };

  const [updated] = await db
    .update(vendorCatalogItemsTable)
    .set({
      priceSell: priceSell != null ? String(parseFloat(String(priceSell)) || 0) : null,
      updatedAt: new Date(),
    })
    .where(eq(vendorCatalogItemsTable.id, itemId))
    .returning();

  if (!updated) return res.status(404).json({ message: "Item not found" });

  const priceSellNum  = updated.priceSell != null ? Number(updated.priceSell) : null;
  const priceBaseNum  = Number(updated.priceBase ?? 0);
  const marginAmount  = priceSellNum != null ? priceSellNum - priceBaseNum : null;
  const marginPct     = priceSellNum != null && priceSellNum > 0
    ? ((priceSellNum - priceBaseNum) / priceSellNum) * 100 : null;

  return res.json({
    id: updated.id,
    priceSell: priceSellNum,
    // priceBase & margin hanya dikembalikan ke admin caller — tidak pernah masuk ke public/customer API
    _adminOnly: {
      priceBase:   priceBaseNum,
      marginAmount,
      marginPct:   marginPct != null ? Math.round(marginPct * 100) / 100 : null,
    },
    message: "Harga jual diperbarui",
  });
});

// ─── Vendor Drivers ─────────────────────────────────────────────────────────

// GET /api/trading/suppliers/:id/drivers
router.get("/suppliers/:id/drivers", async (req, res) => {
  if (!(await requireAdmin(req, res))) return;
  const supplierId = Number(String(req.params.id));
  if (Number.isNaN(supplierId)) return res.status(400).json({ message: "Invalid id" });
  const rows = await db.execute(sql`
    SELECT id, supplier_id AS "supplierId", name, phone,
           vehicle_plate AS "vehiclePlate", vehicle_type AS "vehicleType",
           is_active AS "isActive", created_at AS "createdAt"
    FROM vendor_drivers
    WHERE supplier_id = ${supplierId}
    ORDER BY name ASC
  `);
  return res.json({ drivers: rows.rows });
});

// POST /api/trading/suppliers/:id/drivers
router.post("/suppliers/:id/drivers", async (req, res) => {
  if (!(await requireAdmin(req, res))) return;
  const supplierId = Number(String(req.params.id));
  if (Number.isNaN(supplierId)) return res.status(400).json({ message: "Invalid id" });
  const { name, phone, vehiclePlate, vehicleType } = req.body as {
    name?: string; phone?: string; vehiclePlate?: string; vehicleType?: string;
  };
  if (!name?.trim()) return res.status(400).json({ message: "Nama driver wajib diisi" });
  const result = await db.execute(sql`
    INSERT INTO vendor_drivers (supplier_id, name, phone, vehicle_plate, vehicle_type)
    VALUES (${supplierId}, ${name.trim()}, ${phone?.trim() || null}, ${vehiclePlate?.trim() || null}, ${vehicleType?.trim() || null})
    RETURNING id, supplier_id AS "supplierId", name, phone,
              vehicle_plate AS "vehiclePlate", vehicle_type AS "vehicleType",
              is_active AS "isActive", created_at AS "createdAt"
  `);
  return res.status(201).json({ driver: result.rows[0] });
});

// PUT /api/trading/suppliers/drivers/:driverId
router.put("/suppliers/drivers/:driverId", async (req, res) => {
  if (!(await requireAdmin(req, res))) return;
  const driverId = Number(String(req.params.driverId));
  if (Number.isNaN(driverId)) return res.status(400).json({ message: "Invalid id" });
  // Ownership: driver → supplier → companyId
  const driverOwnerPut = await db.execute(sql`
    SELECT s.company_id AS "companyId"
    FROM vendor_drivers vd
    JOIN suppliers s ON s.id = vd.supplier_id
    WHERE vd.id = ${driverId}
    LIMIT 1
  `);
  if (!driverOwnerPut.rows[0]) return res.status(404).json({ message: "Driver tidak ditemukan" });
  const driverCompanyPut = (driverOwnerPut.rows[0] as any).companyId ?? null;
  const cidDriverPut = resolveCompanyId(req);
  if (!await assertCompanyAccess(driverCompanyPut, cidDriverPut, req, res, { resourceType: "vendor_driver", resourceId: driverId })) return;
  const { name, phone, vehiclePlate, vehicleType, isActive } = req.body as {
    name?: string; phone?: string; vehiclePlate?: string; vehicleType?: string; isActive?: boolean;
  };
  if (name !== undefined && !name.trim()) return res.status(400).json({ message: "Nama driver wajib diisi" });
  const result = await db.execute(sql`
    UPDATE vendor_drivers SET
      name          = COALESCE(${name?.trim() ?? null}, name),
      phone         = CASE WHEN ${phone !== undefined} THEN ${phone?.trim() || null} ELSE phone END,
      vehicle_plate = CASE WHEN ${vehiclePlate !== undefined} THEN ${vehiclePlate?.trim() || null} ELSE vehicle_plate END,
      vehicle_type  = CASE WHEN ${vehicleType !== undefined} THEN ${vehicleType?.trim() || null} ELSE vehicle_type END,
      is_active     = CASE WHEN ${isActive !== undefined} THEN ${isActive ?? true} ELSE is_active END
    WHERE id = ${driverId}
    RETURNING id, supplier_id AS "supplierId", name, phone,
              vehicle_plate AS "vehiclePlate", vehicle_type AS "vehicleType",
              is_active AS "isActive", created_at AS "createdAt"
  `);
  if (!result.rows[0]) return res.status(404).json({ message: "Driver tidak ditemukan" });
  return res.json({ driver: result.rows[0] });
});

// PATCH /api/trading/suppliers/drivers/:driverId/toggle
router.patch("/suppliers/drivers/:driverId/toggle", async (req, res) => {
  if (!(await requireAdmin(req, res))) return;
  const driverId = Number(String(req.params.driverId));
  if (Number.isNaN(driverId)) return res.status(400).json({ message: "Invalid id" });
  const driverOwnerToggle = await db.execute(sql`
    SELECT s.company_id AS "companyId"
    FROM vendor_drivers vd
    JOIN suppliers s ON s.id = vd.supplier_id
    WHERE vd.id = ${driverId}
    LIMIT 1
  `);
  if (!driverOwnerToggle.rows[0]) return res.status(404).json({ message: "Driver tidak ditemukan" });
  const driverCompanyToggle = (driverOwnerToggle.rows[0] as any).companyId ?? null;
  const cidDriverToggle = resolveCompanyId(req);
  if (!await assertCompanyAccess(driverCompanyToggle, cidDriverToggle, req, res, { resourceType: "vendor_driver", resourceId: driverId })) return;
  const result = await db.execute(sql`
    UPDATE vendor_drivers SET is_active = NOT is_active
    WHERE id = ${driverId}
    RETURNING id, supplier_id AS "supplierId", name, phone,
              vehicle_plate AS "vehiclePlate", vehicle_type AS "vehicleType",
              is_active AS "isActive", created_at AS "createdAt"
  `);
  if (!result.rows[0]) return res.status(404).json({ message: "Driver tidak ditemukan" });
  return res.json({ driver: result.rows[0] });
});

// DELETE /api/trading/suppliers/drivers/:driverId
router.delete("/suppliers/drivers/:driverId", async (req, res) => {
  if (!(await requireAdmin(req, res))) return;
  const driverId = Number(String(req.params.driverId));
  if (Number.isNaN(driverId)) return res.status(400).json({ message: "Invalid id" });
  const driverOwnerDel = await db.execute(sql`
    SELECT s.company_id AS "companyId"
    FROM vendor_drivers vd
    JOIN suppliers s ON s.id = vd.supplier_id
    WHERE vd.id = ${driverId}
    LIMIT 1
  `);
  if (!driverOwnerDel.rows[0]) return res.status(404).json({ message: "Driver tidak ditemukan" });
  const driverCompanyDel = (driverOwnerDel.rows[0] as any).companyId ?? null;
  const cidDriverDel = resolveCompanyId(req);
  if (!await assertCompanyAccess(driverCompanyDel, cidDriverDel, req, res, { resourceType: "vendor_driver", resourceId: driverId })) return;
  const result = await db.execute(sql`
    DELETE FROM vendor_drivers WHERE id = ${driverId} RETURNING id
  `);
  if (!result.rows[0]) return res.status(404).json({ message: "Driver tidak ditemukan" });
  return res.json({ message: "Deleted", id: driverId });
});

export default router;
