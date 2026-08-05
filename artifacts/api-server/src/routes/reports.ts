/**
 * /api/reports — Laporan ERP
 *
 * Route lama (admin-only): /sales, /purchase, /ar-aging, /ap-aging,
 *   /inventory-valuation, /stock-movements
 *
 * Route baru (role-based): /meta/*, /pos/*, /inv/*
 */

import { Router, type Request, type Response } from "express";
import {
  db,
  salesDocumentsTable,
  salesDocumentLinesTable,
  purchaseDocumentsTable,
  purchaseDocumentLinesTable,
} from "@workspace/db";
import { eq, gte, lte, and, sql, type SQL } from "drizzle-orm";
import { requireAdmin, requireClerkUser } from "../lib/requireAdmin.js";
import { resolveCompanyId } from "../lib/resolveCompany.js";

const router = Router();

// ─────────────────────────────────────────────────────────────────────────────
// HELPER UTILITIES
// ─────────────────────────────────────────────────────────────────────────────

type UserInfo = { id?: string; role?: string | null; companyId?: number | null; branchId?: number | null };
const getUser = (req: Request): UserInfo => (req.user as UserInfo) ?? {};
const getRole = (req: Request): string => getUser(req).role ?? "";
const isOwner = (r: Request) => getRole(r) === "owner";
const isAdminOrOwner = (r: Request) => ["owner", "admin"].includes(getRole(r));
const isGudang = (r: Request) => getRole(r) === "gudang";
const isKasir = (r: Request) => getRole(r) === "kasir";

function parseDateRange(req: Request): { from?: Date; to?: Date; error?: string } {
  const fromStr = typeof req.query["from"] === "string" ? req.query["from"] : undefined;
  const toStr = typeof req.query["to"] === "string" ? req.query["to"] : undefined;
  let from: Date | undefined;
  let to: Date | undefined;
  if (fromStr) {
    const d = new Date(fromStr);
    if (Number.isNaN(d.getTime())) return { error: `Invalid 'from' date: ${fromStr}` };
    from = d;
  }
  if (toStr) {
    const d = new Date(toStr);
    if (Number.isNaN(d.getTime())) return { error: `Invalid 'to' date: ${toStr}` };
    to = d;
  }
  return { from, to };
}

/** Resolve branch scope berdasarkan role */
function resolveBranchScope(req: Request): number | null {
  const role = getRole(req);
  const user = getUser(req);
  if (isAdminOrOwner(req)) return req.query.branchId ? Number(req.query.branchId) : null;
  if (role === "manager") return req.query.branchId ? Number(req.query.branchId) : (user.branchId ?? null);
  // Kasir & gudang: ALWAYS use branch from DB session, never from query params.
  // This prevents cross-branch data access via query string tampering.
  return user.branchId ?? null;
}

/** Resolve warehouse scope */
function resolveWarehouseScope(req: Request): number | null {
  return req.query.warehouseId ? Number(req.query.warehouseId) : null;
}

/** Resolve effective company untuk owner (bisa semua atau filter) */
function resolveEffectiveCompany(req: Request): number | null {
  if (isOwner(req) && !req.query.companyId) return null;
  return resolveCompanyId(req);
}

// ─────────────────────────────────────────────────────────────────────────────
// ROUTE LAMA (admin-only) — preserved as-is
// ─────────────────────────────────────────────────────────────────────────────

router.get("/sales", async (req, res) => {
  if (!(await requireAdmin(req, res))) return;
  const { from, to, error } = parseDateRange(req);
  if (error) { res.status(400).json({ message: error }); return; }
  const groupBy = (req.query["groupBy"] as string) || "month";
  const effectiveCompanyId = resolveEffectiveCompany(req);

  const conds: SQL[] = [eq(salesDocumentsTable.kind, "order")];
  if (effectiveCompanyId !== null) conds.push(eq(salesDocumentsTable.companyId, effectiveCompanyId));
  if (from) conds.push(gte(salesDocumentsTable.createdAt, from));
  if (to) conds.push(lte(salesDocumentsTable.createdAt, to));

  const docs = await db.select().from(salesDocumentsTable).where(and(...conds));
  const active = docs.filter((d) => d.status !== "cancelled");
  const totalRevenue = active.reduce((s, d) => s + Number(d.totalAmount), 0);
  const totalOrders = active.length;

  const byMonth = new Map<string, { revenue: number; count: number }>();
  const byCustomer = new Map<string, { revenue: number; count: number }>();
  for (const d of active) {
    const ym = d.createdAt.toISOString().slice(0, 7);
    const m = byMonth.get(ym) ?? { revenue: 0, count: 0 };
    m.revenue += Number(d.totalAmount); m.count += 1; byMonth.set(ym, m);
    const c = byCustomer.get(d.customerName) ?? { revenue: 0, count: 0 };
    c.revenue += Number(d.totalAmount); c.count += 1; byCustomer.set(d.customerName, c);
  }

  const lineRows = await db.select().from(salesDocumentLinesTable);
  const docIds = new Set(active.map((d) => d.id));
  const byProduct = new Map<string, { revenue: number; qty: number }>();
  for (const l of lineRows) {
    if (!docIds.has(l.documentId)) continue;
    const p = byProduct.get(l.name) ?? { revenue: 0, qty: 0 };
    p.revenue += Number(l.subtotal); p.qty += Number(l.quantity); byProduct.set(l.name, p);
  }

  res.json({
    totalRevenue, totalOrders, avgOrderValue: totalOrders > 0 ? totalRevenue / totalOrders : 0,
    byMonth: Array.from(byMonth.entries()).map(([period, v]) => ({ period, ...v })).sort((a, b) => a.period.localeCompare(b.period)),
    byCustomer: Array.from(byCustomer.entries()).map(([name, v]) => ({ name, ...v })).sort((a, b) => b.revenue - a.revenue).slice(0, 10),
    byProduct: Array.from(byProduct.entries()).map(([name, v]) => ({ name, ...v })).sort((a, b) => b.revenue - a.revenue).slice(0, 10),
    groupBy,
  });
});

router.get("/purchase", async (req, res) => {
  if (!(await requireAdmin(req, res))) return;
  const { from, to, error } = parseDateRange(req);
  if (error) { res.status(400).json({ message: error }); return; }
  const effectiveCompanyId = resolveEffectiveCompany(req);
  const conds: SQL[] = [eq(purchaseDocumentsTable.kind, "order")];
  if (effectiveCompanyId !== null) conds.push(eq(purchaseDocumentsTable.companyId, effectiveCompanyId));
  if (from) conds.push(gte(purchaseDocumentsTable.createdAt, from));
  if (to) conds.push(lte(purchaseDocumentsTable.createdAt, to));
  const docs = await db.select().from(purchaseDocumentsTable).where(and(...conds));
  const active = docs.filter((d) => d.status !== "cancelled");
  const totalSpend = active.reduce((s, d) => s + Number(d.totalAmount), 0);
  const totalOrders = active.length;
  const byMonth = new Map<string, { spend: number; count: number }>();
  const byVendor = new Map<string, { spend: number; count: number }>();
  for (const d of active) {
    const ym = d.createdAt.toISOString().slice(0, 7);
    const m = byMonth.get(ym) ?? { spend: 0, count: 0 };
    m.spend += Number(d.totalAmount); m.count += 1; byMonth.set(ym, m);
    const v = byVendor.get(d.supplierName) ?? { spend: 0, count: 0 };
    v.spend += Number(d.totalAmount); v.count += 1; byVendor.set(d.supplierName, v);
  }
  const lineRows = await db.select().from(purchaseDocumentLinesTable);
  const docIds = new Set(active.map((d) => d.id));
  const byProduct = new Map<string, { spend: number; qty: number }>();
  for (const l of lineRows) {
    if (!docIds.has(l.documentId)) continue;
    const p = byProduct.get(l.name) ?? { spend: 0, qty: 0 };
    p.spend += Number(l.subtotal); p.qty += Number(l.quantity); byProduct.set(l.name, p);
  }
  res.json({
    totalSpend, totalOrders, avgOrderValue: totalOrders > 0 ? totalSpend / totalOrders : 0,
    byMonth: Array.from(byMonth.entries()).map(([period, v]) => ({ period, ...v })).sort((a, b) => a.period.localeCompare(b.period)),
    byVendor: Array.from(byVendor.entries()).map(([name, v]) => ({ name, ...v })).sort((a, b) => b.spend - a.spend).slice(0, 10),
    byProduct: Array.from(byProduct.entries()).map(([name, v]) => ({ name, ...v })).sort((a, b) => b.spend - a.spend).slice(0, 10),
  });
});

const OUTSTANDING_THRESHOLD = 0.005;
function bucketDays(d: number): "0-30" | "31-60" | "61-90" | "90+" {
  if (d <= 30) return "0-30"; if (d <= 60) return "31-60"; if (d <= 90) return "61-90"; return "90+";
}

router.get("/ar-aging", async (req, res) => {
  if (!(await requireAdmin(req, res))) return;
  const effectiveCompanyId = resolveEffectiveCompany(req);
  const arConds: SQL[] = [eq(salesDocumentsTable.kind, "order"), eq(salesDocumentsTable.invoiceStatus, "to_invoice")];
  if (effectiveCompanyId !== null) arConds.push(eq(salesDocumentsTable.companyId, effectiveCompanyId));
  const docs = await db.select().from(salesDocumentsTable).where(and(...arConds));
  const now = Date.now();
  const buckets = { "0-30": 0, "31-60": 0, "61-90": 0, "90+": 0 } as Record<string, number>;
  const items = docs.map((d) => {
    const outstanding = Math.max(0, Number(d.grandTotal) - Number(d.amountPaid));
    const baseDate = d.confirmedAt ?? d.createdAt;
    const daysOld = Math.floor((now - baseDate.getTime()) / 86400000);
    const bucket = bucketDays(daysOld);
    return { id: d.id, docNumber: d.docNumber, customerName: d.customerName, grandTotal: Number(d.grandTotal), amountPaid: Number(d.amountPaid), amount: outstanding, daysOld, bucket, confirmedAt: d.confirmedAt?.toISOString() ?? d.createdAt.toISOString() };
  }).filter((i) => i.amount > OUTSTANDING_THRESHOLD);
  items.forEach((i) => { buckets[i.bucket] += i.amount; });
  res.json({ total: items.reduce((s, i) => s + i.amount, 0), buckets, items: items.sort((a, b) => b.daysOld - a.daysOld) });
});

router.get("/ap-aging", async (req, res) => {
  if (!(await requireAdmin(req, res))) return;
  const effectiveCompanyId = resolveEffectiveCompany(req);
  const apConds: SQL[] = [eq(purchaseDocumentsTable.kind, "order"), eq(purchaseDocumentsTable.billStatus, "to_bill")];
  if (effectiveCompanyId !== null) apConds.push(eq(purchaseDocumentsTable.companyId, effectiveCompanyId));
  const docs = await db.select().from(purchaseDocumentsTable).where(and(...apConds));
  const now = Date.now();
  const buckets = { "0-30": 0, "31-60": 0, "61-90": 0, "90+": 0 } as Record<string, number>;
  const items = docs.map((d) => {
    const outstanding = Math.max(0, Number(d.grandTotal) - Number(d.amountPaid));
    const baseDate = d.confirmedAt ?? d.createdAt;
    const daysOld = Math.floor((now - baseDate.getTime()) / 86400000);
    const bucket = bucketDays(daysOld);
    return { id: d.id, docNumber: d.docNumber, supplierName: d.supplierName, grandTotal: Number(d.grandTotal), amountPaid: Number(d.amountPaid), amount: outstanding, daysOld, bucket, confirmedAt: d.confirmedAt?.toISOString() ?? d.createdAt.toISOString() };
  }).filter((i) => i.amount > OUTSTANDING_THRESHOLD);
  items.forEach((i) => { buckets[i.bucket] += i.amount; });
  res.json({ total: items.reduce((s, i) => s + i.amount, 0), buckets, items: items.sort((a, b) => b.daysOld - a.daysOld) });
});

router.get("/inventory-valuation", async (req, res) => {
  if (!(await requireAdmin(req, res))) return;
  const companyId = typeof req.query["companyId"] === "string" && req.query["companyId"] !== "all" ? Number(req.query["companyId"]) : null;
  const warehouseId = typeof req.query["warehouseId"] === "string" ? Number(req.query["warehouseId"]) : null;
  const rows = await db.execute<{ product_id: string; product_name: string; sku: string | null; warehouse_id: string; warehouse_name: string; company_id: string; company_name: string; qty: string; cost_price: string; total_value: string; category: string | null }>(sql`
    SELECT p.id::text AS product_id, p.name AS product_name, p.sku,
           w.id::text AS warehouse_id, w.warehouse_name,
           c.id::text AS company_id, c.company_name,
           COALESCE(ws.qty, '0') AS qty, COALESCE(ws.cost_price, '0') AS cost_price,
           COALESCE((ws.qty::numeric * ws.cost_price::numeric), 0)::text AS total_value,
           pc.name AS category
    FROM wh_stock ws
    JOIN products p ON p.id = ws.product_id
    JOIN warehouses w ON w.id = ws.warehouse_id
    LEFT JOIN companies c ON c.id = w.company_id
    LEFT JOIN LATERAL (
      SELECT pc2.name FROM product_category_map pcm2
      JOIN product_categories pc2 ON pc2.id = pcm2.category_id
      WHERE pcm2.product_id = p.id
      LIMIT 1
    ) pc ON true
    WHERE ws.qty::numeric > 0
      ${companyId ? sql`AND w.company_id = ${companyId}` : sql``}
      ${warehouseId ? sql`AND ws.warehouse_id = ${warehouseId}` : sql``}
    ORDER BY c.company_name, w.warehouse_name, p.name
  `);
  const items = rows.rows.map((r) => ({ productId: Number(r.product_id), productName: r.product_name, sku: r.sku ?? null, warehouseId: Number(r.warehouse_id), warehouseName: r.warehouse_name, companyId: Number(r.company_id), companyName: r.company_name, qty: Number(r.qty), costPrice: Number(r.cost_price), totalValue: Number(r.total_value), category: r.category ?? null }));
  const totalValue = items.reduce((s, i) => s + i.totalValue, 0);
  const byCompany: Record<string, { companyName: string; totalValue: number; itemCount: number }> = {};
  const byWarehouse: Record<string, { warehouseName: string; totalValue: number; itemCount: number }> = {};
  for (const item of items) {
    const ck = String(item.companyId);
    if (!byCompany[ck]) byCompany[ck] = { companyName: item.companyName, totalValue: 0, itemCount: 0 };
    byCompany[ck].totalValue += item.totalValue; byCompany[ck].itemCount += 1;
    const wk = String(item.warehouseId);
    if (!byWarehouse[wk]) byWarehouse[wk] = { warehouseName: item.warehouseName, totalValue: 0, itemCount: 0 };
    byWarehouse[wk].totalValue += item.totalValue; byWarehouse[wk].itemCount += 1;
  }
  res.json({ items, summary: { totalValue, totalQty: items.reduce((s, i) => s + i.qty, 0), totalItems: items.length }, byCompany: Object.entries(byCompany).map(([id, v]) => ({ companyId: Number(id), ...v })), byWarehouse: Object.entries(byWarehouse).map(([id, v]) => ({ warehouseId: Number(id), ...v })) });
});

router.get("/stock-movements", async (req, res) => {
  if (!(await requireAdmin(req, res))) return;
  const { from, to, error } = parseDateRange(req);
  if (error) { res.status(400).json({ message: error }); return; }
  const companyId = typeof req.query["companyId"] === "string" && req.query["companyId"] !== "all" ? Number(req.query["companyId"]) : null;
  const rows = await db.execute<{ id: string; product_name: string; warehouse_name: string; type: string; qty: string; qty_before: string; qty_after: string; cost_price: string; ref_type: string | null; ref_id: string | null; note: string | null; created_at: string }>(sql`
    SELECT m.id::text, p.name AS product_name, w.warehouse_name, m.type,
           m.qty, m.qty_before, m.qty_after, COALESCE(m.cost_price, '0') AS cost_price,
           m.ref_type, m.ref_id::text, m.note, m.created_at::text
    FROM wh_movements m
    JOIN products p ON p.id = m.product_id
    JOIN warehouses w ON w.id = m.warehouse_id
    WHERE 1=1
      ${from ? sql`AND m.created_at >= ${from}` : sql``}
      ${to ? sql`AND m.created_at <= ${to}` : sql``}
      ${companyId ? sql`AND w.company_id = ${companyId}` : sql``}
    ORDER BY m.created_at DESC LIMIT 1000
  `);
  res.json({ movements: rows.rows, count: rows.rows.length });
});

// ─────────────────────────────────────────────────────────────────────────────
// MIDDLEWARE: semua route baru di bawah membutuhkan setidaknya login
// ─────────────────────────────────────────────────────────────────────────────

router.use(async (req: Request, res: Response, next) => {
  if (!(await requireClerkUser(req, res))) return;
  next();
});

// ─────────────────────────────────────────────────────────────────────────────
// META: filter data untuk dropdown
// ─────────────────────────────────────────────────────────────────────────────

router.get("/meta/companies", async (req: Request, res: Response) => {
  if (!isAdminOrOwner(req)) { res.json([]); return; }
  const rows = await db.execute(sql`SELECT id, company_name AS name, company_code AS code FROM companies WHERE is_active = TRUE ORDER BY company_name`);
  res.json(rows.rows);
});

router.get("/meta/branches", async (req: Request, res: Response) => {
  const companyId = resolveCompanyId(req);
  const rows = await db.execute(sql`
    SELECT id, name, address, business_unit FROM pos_branches
    WHERE company_id = ${companyId} AND is_active = TRUE ORDER BY name
  `);
  res.json(rows.rows);
});

router.get("/meta/warehouses", async (req: Request, res: Response) => {
  const companyId = resolveCompanyId(req);
  const branchId = resolveBranchScope(req);
  const rows = await db.execute(sql`
    SELECT w.id, w.warehouse_name AS name, w.warehouse_code AS code, w.branch_id, b.name AS branch_name
    FROM warehouses w
    LEFT JOIN pos_branches b ON b.id = w.branch_id
    WHERE w.company_id = ${companyId}
      ${branchId ? sql`AND w.branch_id = ${branchId}` : sql``}
    ORDER BY b.name, w.warehouse_name
  `);
  res.json(rows.rows);
});

router.get("/meta/cashiers", async (req: Request, res: Response) => {
  const companyId = resolveCompanyId(req);
  const branchId = resolveBranchScope(req);
  const rows = await db.execute(sql`
    SELECT DISTINCT c.id, c.name, c.email, o.branch_id, b.name AS branch_name
    FROM pos_cashiers c
    JOIN pos_orders o ON o.cashier_id = c.id AND o.company_id = ${companyId}
    LEFT JOIN pos_branches b ON b.id = o.branch_id
    ${branchId ? sql`WHERE o.branch_id = ${branchId}` : sql``}
    ORDER BY c.name
  `);
  res.json(rows.rows);
});

router.get("/meta/products", async (req: Request, res: Response) => {
  const companyId = resolveCompanyId(req);
  const rows = await db.execute(sql`
    SELECT id, name, sku, unit FROM products WHERE company_id = ${companyId} ORDER BY name LIMIT 500
  `);
  res.json(rows.rows);
});

// ─────────────────────────────────────────────────────────────────────────────
// POS REPORTS
// ─────────────────────────────────────────────────────────────────────────────

// 1. Penjualan Harian
router.get("/pos/daily", async (req: Request, res: Response) => {
  if (isGudang(req)) { res.status(403).json({ message: "Akses ditolak" }); return; }
  const companyId = resolveEffectiveCompany(req);
  const branchId = resolveBranchScope(req);
  const { from, to } = parseDateRange(req);
  const cashierIdParam = req.query.cashierId ? Number(req.query.cashierId) : null;

  let cashierId: number | null = cashierIdParam;
  if (isKasir(req)) {
    const user = getUser(req);
    const r = await db.execute(sql`SELECT id FROM pos_cashiers WHERE email = ${user.id ?? ""} LIMIT 1`);
    cashierId = (r.rows[0] as any)?.id ?? null;
  }

  const rows = await db.execute(sql`
    SELECT
      DATE(COALESCE(o.paid_at, o.created_at)) AS tanggal,
      COUNT(DISTINCT o.id)::int AS jumlah_transaksi,
      SUM(o.total)::float AS total_penjualan,
      SUM(o.discount)::float AS total_diskon,
      SUM(o.subtotal)::float AS subtotal,
      COUNT(DISTINCT o.cashier_id)::int AS jumlah_kasir,
      COALESCE(string_agg(DISTINCT pm.payment_method, ', '), '') AS metode_pembayaran
    FROM pos_orders o
    LEFT JOIN (SELECT DISTINCT order_id, payment_method FROM pos_orders) pm ON pm.order_id = o.id
    WHERE o.status = 'paid'
      ${companyId ? sql`AND o.company_id = ${companyId}` : sql``}
      ${branchId ? sql`AND o.branch_id = ${branchId}` : sql``}
      ${cashierId ? sql`AND o.cashier_id = ${cashierId}` : sql``}
      ${from ? sql`AND COALESCE(o.paid_at, o.created_at) >= ${from}` : sql``}
      ${to ? sql`AND COALESCE(o.paid_at, o.created_at) <= ${to}` : sql``}
    GROUP BY DATE(COALESCE(o.paid_at, o.created_at))
    ORDER BY tanggal DESC
    LIMIT 366
  `);
  res.json(rows.rows);
});

// 2. Penjualan Per Cabang
router.get("/pos/by-branch", async (req: Request, res: Response) => {
  if (isGudang(req) || isKasir(req)) { res.status(403).json({ message: "Akses ditolak" }); return; }
  const companyId = resolveEffectiveCompany(req);
  const branchId = resolveBranchScope(req);
  const { from, to } = parseDateRange(req);

  const rows = await db.execute(sql`
    SELECT
      COALESCE(b.id::text, 'null') AS branch_id,
      COALESCE(b.name, 'Tanpa Cabang') AS branch_name,
      COALESCE(b.business_unit, '') AS business_unit,
      COUNT(DISTINCT o.id)::int AS jumlah_transaksi,
      SUM(o.total)::float AS total_penjualan,
      SUM(o.discount)::float AS total_diskon,
      AVG(o.total)::float AS rata_rata_transaksi,
      COUNT(DISTINCT o.cashier_id)::int AS jumlah_kasir
    FROM pos_orders o
    LEFT JOIN pos_branches b ON b.id = o.branch_id
    WHERE o.status = 'paid'
      ${companyId ? sql`AND o.company_id = ${companyId}` : sql``}
      ${branchId ? sql`AND o.branch_id = ${branchId}` : sql``}
      ${from ? sql`AND COALESCE(o.paid_at, o.created_at) >= ${from}` : sql``}
      ${to ? sql`AND COALESCE(o.paid_at, o.created_at) <= ${to}` : sql``}
    GROUP BY b.id, b.name, b.business_unit
    ORDER BY total_penjualan DESC
  `);
  res.json(rows.rows);
});

// 3. Penjualan Per Kasir
router.get("/pos/by-cashier", async (req: Request, res: Response) => {
  if (isGudang(req)) { res.status(403).json({ message: "Akses ditolak" }); return; }
  const companyId = resolveEffectiveCompany(req);
  const branchId = resolveBranchScope(req);
  const { from, to } = parseDateRange(req);
  const cashierIdParam = req.query.cashierId ? Number(req.query.cashierId) : null;

  let cashierId: number | null = cashierIdParam;
  if (isKasir(req)) {
    const user = getUser(req);
    const r = await db.execute(sql`SELECT id FROM pos_cashiers WHERE email = ${user.id ?? ""} LIMIT 1`);
    cashierId = (r.rows[0] as any)?.id ?? null;
  }

  const rows = await db.execute(sql`
    SELECT
      c.id AS cashier_id,
      c.name AS kasir_name,
      c.email AS kasir_email,
      COALESCE(b.name, 'Tanpa Cabang') AS branch_name,
      COUNT(DISTINCT o.id)::int AS jumlah_transaksi,
      SUM(o.total)::float AS total_penjualan,
      SUM(o.discount)::float AS total_diskon,
      AVG(o.total)::float AS rata_rata_per_transaksi,
      MIN(COALESCE(o.paid_at, o.created_at)) AS transaksi_pertama,
      MAX(COALESCE(o.paid_at, o.created_at)) AS transaksi_terakhir
    FROM pos_orders o
    JOIN pos_cashiers c ON c.id = o.cashier_id
    LEFT JOIN pos_branches b ON b.id = o.branch_id
    WHERE o.status = 'paid'
      ${companyId ? sql`AND o.company_id = ${companyId}` : sql``}
      ${branchId ? sql`AND o.branch_id = ${branchId}` : sql``}
      ${cashierId ? sql`AND o.cashier_id = ${cashierId}` : sql``}
      ${from ? sql`AND COALESCE(o.paid_at, o.created_at) >= ${from}` : sql``}
      ${to ? sql`AND COALESCE(o.paid_at, o.created_at) <= ${to}` : sql``}
    GROUP BY c.id, c.name, c.email, b.name
    ORDER BY total_penjualan DESC
  `);
  res.json(rows.rows);
});

// 4. Produk Terlaris
router.get("/pos/top-products", async (req: Request, res: Response) => {
  if (isGudang(req)) { res.status(403).json({ message: "Akses ditolak" }); return; }
  const companyId = resolveEffectiveCompany(req);
  const branchId = resolveBranchScope(req);
  const { from, to } = parseDateRange(req);
  const productId = req.query.productId ? Number(req.query.productId) : null;
  const limit = Math.min(Number(req.query.limit ?? 50), 200);

  const rows = await db.execute(sql`
    SELECT
      i.product_name,
      i.product_id,
      p.sku, p.unit,
      SUM(i.qty)::float AS total_qty_terjual,
      SUM(i.subtotal)::float AS total_pendapatan,
      COUNT(DISTINCT o.id)::int AS jumlah_transaksi,
      AVG(i.price)::float AS harga_rata_rata
    FROM pos_order_items i
    JOIN pos_orders o ON o.id = i.order_id
    LEFT JOIN products p ON p.id = i.product_id
    WHERE o.status = 'paid'
      ${companyId ? sql`AND o.company_id = ${companyId}` : sql``}
      ${branchId ? sql`AND o.branch_id = ${branchId}` : sql``}
      ${productId ? sql`AND i.product_id = ${productId}` : sql``}
      ${from ? sql`AND COALESCE(o.paid_at, o.created_at) >= ${from}` : sql``}
      ${to ? sql`AND COALESCE(o.paid_at, o.created_at) <= ${to}` : sql``}
    GROUP BY i.product_id, i.product_name, p.sku, p.unit
    ORDER BY total_qty_terjual DESC
    LIMIT ${limit}
  `);
  res.json(rows.rows);
});

// Dashboard summary POS
router.get("/pos/summary", async (req: Request, res: Response) => {
  if (isGudang(req)) { res.status(403).json({ message: "Akses ditolak" }); return; }
  const companyId = resolveEffectiveCompany(req);
  const branchId = resolveBranchScope(req);
  const { from, to } = parseDateRange(req);

  const rows = await db.execute(sql`
    SELECT
      COUNT(DISTINCT o.id)::int AS jumlah_transaksi,
      COALESCE(SUM(o.total), 0)::float AS total_penjualan,
      COALESCE(SUM(o.discount), 0)::float AS total_diskon,
      COALESCE(AVG(o.total), 0)::float AS rata_rata_transaksi,
      COUNT(DISTINCT o.cashier_id)::int AS jumlah_kasir_aktif,
      COUNT(DISTINCT o.branch_id)::int AS jumlah_cabang_aktif
    FROM pos_orders o
    WHERE o.status = 'paid'
      ${companyId ? sql`AND o.company_id = ${companyId}` : sql``}
      ${branchId ? sql`AND o.branch_id = ${branchId}` : sql``}
      ${from ? sql`AND COALESCE(o.paid_at, o.created_at) >= ${from}` : sql``}
      ${to ? sql`AND COALESCE(o.paid_at, o.created_at) <= ${to}` : sql``}
  `);
  res.json(rows.rows[0] ?? {});
});

// ─────────────────────────────────────────────────────────────────────────────
// INVENTORY REPORTS
// ─────────────────────────────────────────────────────────────────────────────

// 5. Stok Bahan Baku / Produk saat ini
router.get("/inv/stock", async (req: Request, res: Response) => {
  const companyId = resolveCompanyId(req);
  const branchId = resolveBranchScope(req);
  const warehouseId = resolveWarehouseScope(req);
  const productId = req.query.productId ? Number(req.query.productId) : null;

  const rows = await db.execute(sql`
    SELECT
      ws.product_id, p.name AS product_name, p.sku, p.unit,
      ws.warehouse_id, w.warehouse_name, w.warehouse_code,
      b.id AS branch_id, b.name AS branch_name,
      ws.rack_id, wr.rack_code, wr.rack_name,
      ws.qty::float, ws.cost_price::float,
      (ws.qty * ws.cost_price)::float AS nilai_stok,
      ws.updated_at
    FROM wh_stock ws
    JOIN products p ON p.id = ws.product_id
    JOIN warehouses w ON w.id = ws.warehouse_id
    LEFT JOIN pos_branches b ON b.id = w.branch_id
    LEFT JOIN warehouse_racks wr ON wr.id = ws.rack_id
    WHERE ws.company_id = ${companyId}
      ${warehouseId ? sql`AND ws.warehouse_id = ${warehouseId}` : sql``}
      ${branchId ? sql`AND w.branch_id = ${branchId}` : sql``}
      ${productId ? sql`AND ws.product_id = ${productId}` : sql``}
    ORDER BY b.name, w.warehouse_name, p.name
  `);
  res.json(rows.rows);
});

// 6. Stok Minimum (hampir habis / habis)
router.get("/inv/stock-low", async (req: Request, res: Response) => {
  const companyId = resolveCompanyId(req);
  const branchId = resolveBranchScope(req);
  const warehouseId = resolveWarehouseScope(req);
  const threshold = Number(req.query.threshold ?? 5);

  const rows = await db.execute(sql`
    SELECT
      ws.product_id, p.name AS product_name, p.sku, p.unit,
      ws.warehouse_id, w.warehouse_name, b.name AS branch_name,
      ws.qty::float, ws.cost_price::float,
      (ws.qty * ws.cost_price)::float AS nilai_stok,
      CASE WHEN ws.qty <= 0 THEN 'Habis' ELSE 'Hampir Habis' END AS status
    FROM wh_stock ws
    JOIN products p ON p.id = ws.product_id
    JOIN warehouses w ON w.id = ws.warehouse_id
    LEFT JOIN pos_branches b ON b.id = w.branch_id
    WHERE ws.company_id = ${companyId} AND ws.qty <= ${threshold}
      ${warehouseId ? sql`AND ws.warehouse_id = ${warehouseId}` : sql``}
      ${branchId ? sql`AND w.branch_id = ${branchId}` : sql``}
    ORDER BY ws.qty ASC, p.name
  `);
  res.json(rows.rows);
});

// 7. Mutasi Stok (detail)
router.get("/inv/movements", async (req: Request, res: Response) => {
  const companyId = resolveCompanyId(req);
  const branchId = resolveBranchScope(req);
  const warehouseId = resolveWarehouseScope(req);
  const productId = req.query.productId ? Number(req.query.productId) : null;
  const typeFilter = req.query.type as string | undefined;
  const { from, to } = parseDateRange(req);
  const limit = Math.min(Number(req.query.limit ?? 500), 2000);

  const rows = await db.execute(sql`
    SELECT
      wm.id, wm.type, wm.qty::float, wm.qty_before::float, wm.qty_after::float,
      wm.cost_price::float, (wm.qty * wm.cost_price)::float AS nilai,
      wm.ref_type, wm.ref_id, wm.note, wm.created_at,
      p.name AS product_name, p.sku, p.unit,
      w.warehouse_name, w.warehouse_code,
      b.id AS branch_id, b.name AS branch_name,
      wr.rack_code
    FROM wh_movements wm
    JOIN products p ON p.id = wm.product_id
    JOIN warehouses w ON w.id = wm.warehouse_id
    LEFT JOIN pos_branches b ON b.id = w.branch_id
    LEFT JOIN warehouse_racks wr ON wr.id = wm.rack_id
    WHERE wm.company_id = ${companyId}
      ${warehouseId ? sql`AND wm.warehouse_id = ${warehouseId}` : sql``}
      ${branchId ? sql`AND w.branch_id = ${branchId}` : sql``}
      ${productId ? sql`AND wm.product_id = ${productId}` : sql``}
      ${typeFilter ? sql`AND wm.type = ${typeFilter}` : sql``}
      ${from ? sql`AND wm.created_at >= ${from}` : sql``}
      ${to ? sql`AND wm.created_at <= ${to}` : sql``}
    ORDER BY wm.created_at DESC
    LIMIT ${limit}
  `);
  res.json(rows.rows);
});

// Mutasi Stok Summary per produk
router.get("/inv/movements/summary", async (req: Request, res: Response) => {
  const companyId = resolveCompanyId(req);
  const branchId = resolveBranchScope(req);
  const warehouseId = resolveWarehouseScope(req);
  const { from, to } = parseDateRange(req);

  const rows = await db.execute(sql`
    SELECT
      wm.product_id, p.name AS product_name, p.sku, p.unit,
      SUM(CASE WHEN wm.type IN ('po_receipt','transfer_in','return_in','manual_in','opname_in') THEN wm.qty ELSE 0 END)::float AS total_masuk,
      SUM(CASE WHEN wm.type IN ('so_delivery','transfer_out','return_out','damage','manual_out','opname_out') THEN wm.qty ELSE 0 END)::float AS total_keluar,
      COUNT(*)::int AS jumlah_mutasi
    FROM wh_movements wm
    JOIN products p ON p.id = wm.product_id
    JOIN warehouses w ON w.id = wm.warehouse_id
    WHERE wm.company_id = ${companyId}
      ${warehouseId ? sql`AND wm.warehouse_id = ${warehouseId}` : sql``}
      ${branchId ? sql`AND w.branch_id = ${branchId}` : sql``}
      ${from ? sql`AND wm.created_at >= ${from}` : sql``}
      ${to ? sql`AND wm.created_at <= ${to}` : sql``}
    GROUP BY wm.product_id, p.name, p.sku, p.unit
    ORDER BY (total_masuk + total_keluar) DESC
  `);
  res.json(rows.rows);
});

// 8. Transfer Stok
router.get("/inv/transfers", async (req: Request, res: Response) => {
  const companyId = resolveCompanyId(req);
  const branchId = resolveBranchScope(req);
  const { from, to } = parseDateRange(req);

  const rows = await db.execute(sql`
    SELECT
      wt.id, wt.transfer_number, wt.status, wt.note,
      wt.created_at, wt.sent_at, wt.received_at,
      fw.warehouse_name AS from_warehouse, fw.warehouse_code AS from_code,
      tw.warehouse_name AS to_warehouse, tw.warehouse_code AS to_code,
      fb.name AS from_branch, tb.name AS to_branch,
      COUNT(tl.id)::int AS jumlah_item,
      SUM(tl.qty_requested)::float AS total_qty_diminta,
      SUM(COALESCE(tl.qty_sent, 0))::float AS total_qty_dikirim,
      SUM(COALESCE(tl.qty_received, 0))::float AS total_qty_diterima
    FROM wh_transfers wt
    JOIN warehouses fw ON fw.id = wt.from_warehouse_id
    JOIN warehouses tw ON tw.id = wt.to_warehouse_id
    LEFT JOIN pos_branches fb ON fb.id = fw.branch_id
    LEFT JOIN pos_branches tb ON tb.id = tw.branch_id
    LEFT JOIN wh_transfer_lines tl ON tl.transfer_id = wt.id
    WHERE wt.company_id = ${companyId}
      ${branchId ? sql`AND (fw.branch_id = ${branchId} OR tw.branch_id = ${branchId})` : sql``}
      ${from ? sql`AND wt.created_at >= ${from}` : sql``}
      ${to ? sql`AND wt.created_at <= ${to}` : sql``}
    GROUP BY wt.id, wt.transfer_number, wt.status, wt.note,
             wt.created_at, wt.sent_at, wt.received_at,
             fw.warehouse_name, fw.warehouse_code, tw.warehouse_name, tw.warehouse_code,
             fb.name, tb.name
    ORDER BY wt.created_at DESC LIMIT 500
  `);
  res.json(rows.rows);
});

// 9a. Retur Barang
router.get("/inv/returns", async (req: Request, res: Response) => {
  const companyId = resolveCompanyId(req);
  const branchId = resolveBranchScope(req);
  const warehouseId = resolveWarehouseScope(req);
  const { from, to } = parseDateRange(req);

  const rows = await db.execute(sql`
    SELECT
      wr.id, wr.return_number, wr.type, wr.status,
      wr.ref_doc_number, wr.note, wr.created_at, wr.confirmed_at,
      w.warehouse_name, b.name AS branch_name,
      COUNT(rl.id)::int AS jumlah_item,
      SUM(rl.qty)::float AS total_qty,
      SUM(rl.qty * COALESCE(rl.unit_cost, 0))::float AS total_nilai,
      SUM(CASE WHEN rl.condition = 'layak' THEN rl.qty ELSE 0 END)::float AS qty_layak,
      SUM(CASE WHEN rl.condition != 'layak' THEN rl.qty ELSE 0 END)::float AS qty_tidak_layak
    FROM wh_returns wr
    JOIN warehouses w ON w.id = wr.warehouse_id
    LEFT JOIN pos_branches b ON b.id = w.branch_id
    LEFT JOIN wh_return_lines rl ON rl.return_id = wr.id
    WHERE wr.company_id = ${companyId}
      ${warehouseId ? sql`AND wr.warehouse_id = ${warehouseId}` : sql``}
      ${branchId ? sql`AND w.branch_id = ${branchId}` : sql``}
      ${from ? sql`AND wr.created_at >= ${from}` : sql``}
      ${to ? sql`AND wr.created_at <= ${to}` : sql``}
    GROUP BY wr.id, wr.return_number, wr.type, wr.status, wr.ref_doc_number,
             wr.note, wr.created_at, wr.confirmed_at, w.warehouse_name, b.name
    ORDER BY wr.created_at DESC LIMIT 500
  `);
  res.json(rows.rows);
});

// 9b. Barang Rusak / Hilang
router.get("/inv/damage", async (req: Request, res: Response) => {
  const companyId = resolveCompanyId(req);
  const branchId = resolveBranchScope(req);
  const warehouseId = resolveWarehouseScope(req);
  const { from, to } = parseDateRange(req);

  const rows = await db.execute(sql`
    SELECT
      dr.id, dr.report_number, dr.status, dr.note,
      dr.created_at, dr.confirmed_at,
      w.warehouse_name, b.name AS branch_name,
      COUNT(dl.id)::int AS jumlah_item,
      SUM(dl.qty)::float AS total_qty,
      SUM(CASE WHEN dl.damage_type = 'rusak' THEN dl.qty ELSE 0 END)::float AS qty_rusak,
      SUM(CASE WHEN dl.damage_type = 'hilang' THEN dl.qty ELSE 0 END)::float AS qty_hilang,
      SUM(CASE WHEN dl.damage_type = 'expired' THEN dl.qty ELSE 0 END)::float AS qty_expired
    FROM wh_damage_reports dr
    JOIN warehouses w ON w.id = dr.warehouse_id
    LEFT JOIN pos_branches b ON b.id = w.branch_id
    LEFT JOIN wh_damage_lines dl ON dl.report_id = dr.id
    WHERE dr.company_id = ${companyId}
      ${warehouseId ? sql`AND dr.warehouse_id = ${warehouseId}` : sql``}
      ${branchId ? sql`AND w.branch_id = ${branchId}` : sql``}
      ${from ? sql`AND dr.created_at >= ${from}` : sql``}
      ${to ? sql`AND dr.created_at <= ${to}` : sql``}
    GROUP BY dr.id, dr.report_number, dr.status, dr.note,
             dr.created_at, dr.confirmed_at, w.warehouse_name, b.name
    ORDER BY dr.created_at DESC LIMIT 500
  `);
  res.json(rows.rows);
});

export default router;
