/**
 * orderCosts.ts
 * Gap #6 — Operational Expense ↔ Logistic Order linkage
 * Gap #7 — Purchase Document ↔ Logistic Order linkage
 *
 * Routes:
 *  GET  /api/order-costs/:orderId/expenses           list linked OPEX
 *  POST /api/order-costs/:orderId/expenses/:id/link  link expense
 *  DEL  /api/order-costs/:orderId/expenses/:id/link  unlink expense
 *  GET  /api/order-costs/expenses/search             search unlinked expenses
 *
 *  GET  /api/order-costs/:orderId/purchases           list linked POs
 *  POST /api/order-costs/:orderId/purchases/:id/link  link PO
 *  DEL  /api/order-costs/:orderId/purchases/:id/link  unlink PO
 *  GET  /api/order-costs/purchases/search             search POs
 *
 *  GET  /api/order-costs/:orderId/summary  combined cost summary
 */

import { Router } from "express";
import { sql } from "drizzle-orm";
import { db } from "@workspace/db";
import { requireAdmin, requireClerkUser } from "../lib/requireAdmin.js";

const router = Router();

// ── Boot migration ──────────────────────────────────────────────────────────
let _migrated = false;
async function ensureOrderCostColumns() {
  if (_migrated) return;
  _migrated = true;
  try {
    await db.execute(sql.raw(`
      ALTER TABLE expenses ADD COLUMN IF NOT EXISTS logistic_order_id INT;
      CREATE INDEX IF NOT EXISTS expenses_logistic_order_idx ON expenses(logistic_order_id);
      ALTER TABLE purchase_documents ADD COLUMN IF NOT EXISTS logistic_order_id INT;
      CREATE INDEX IF NOT EXISTS purchase_docs_logistic_order_idx ON purchase_documents(logistic_order_id);
    `));
    console.log("[orderCosts migration] columns ready");
  } catch (e) {
    console.error("[orderCosts migration]", e);
  }
}

router.use(async (req, res, next) => {
  if (!(await requireClerkUser(req, res))) return;
  await ensureOrderCostColumns();
  next();
});

// ── Helpers ─────────────────────────────────────────────────────────────────

function orderId(req: any) { return Number(req.params.orderId); }
function itemId(req: any)  { return Number(req.params.itemId);  }

// ── STATIC search routes (must be before /:orderId) ─────────────────────────

// GET /api/order-costs/expenses/search?q=&companyId=&limit=20
router.get("/expenses/search", async (req, res) => {
  const q = String(req.query.q ?? "").trim();
  const companyId = req.query.companyId && req.query.companyId !== "all"
    ? Number(req.query.companyId) : null;
  const limit = Math.min(Number(req.query.limit ?? 20), 100);

  const companyFilter = companyId ? `AND e.company_id = ${companyId}` : "";
  const qFilter = q
    ? `AND (e.expense_number ILIKE '%${q.replace(/'/g, "''")}%' OR e.description ILIKE '%${q.replace(/'/g, "''")}%')`
    : "";

  try {
    const rows = await db.execute(sql.raw(`
      SELECT e.id, e.expense_number, e.date, e.description, e.status,
        e.total::numeric AS total, ec.name AS category_name, e.logistic_order_id
      FROM expenses e
      LEFT JOIN expense_categories ec ON ec.id = e.category_id
      WHERE 1=1
        ${companyFilter}
        ${qFilter}
      ORDER BY e.date DESC, e.id DESC
      LIMIT ${limit}
    `));

    return res.json(rows.rows.map((r: any) => ({
      id: Number(r.id),
      expenseNumber: r.expense_number,
      date: r.date,
      description: r.description ?? null,
      status: r.status,
      total: Number(r.total),
      categoryName: r.category_name ?? null,
      linkedOrderId: r.logistic_order_id ? Number(r.logistic_order_id) : null,
    })));
  } catch (e) {
    console.error("[orderCosts/expenses/search]", e);
    return res.status(500).json({ error: "Gagal mencari expense" });
  }
});

// GET /api/order-costs/purchases/search?q=&companyId=&kind=order&limit=20
router.get("/purchases/search", async (req, res) => {
  const q = String(req.query.q ?? "").trim();
  const companyId = req.query.companyId && req.query.companyId !== "all"
    ? Number(req.query.companyId) : null;
  const kind = req.query.kind ? String(req.query.kind) : null;
  const limit = Math.min(Number(req.query.limit ?? 20), 100);

  const companyFilter = companyId ? `AND pd.company_id = ${companyId}` : "";
  const kindFilter = kind ? `AND pd.kind = '${kind.replace(/'/g, "''")}'` : "";
  const qFilter = q
    ? `AND (pd.doc_number ILIKE '%${q.replace(/'/g, "''")}%' OR pd.supplier_name ILIKE '%${q.replace(/'/g, "''")}%')`
    : "";

  try {
    const rows = await db.execute(sql.raw(`
      SELECT pd.id, pd.doc_number, pd.kind, pd.status, pd.supplier_name,
        pd.grand_total::numeric AS grand_total,
        pd.created_at, pd.logistic_order_id
      FROM purchase_documents pd
      WHERE pd.status != 'cancelled'
        ${companyFilter}
        ${kindFilter}
        ${qFilter}
      ORDER BY pd.created_at DESC
      LIMIT ${limit}
    `));

    return res.json(rows.rows.map((r: any) => ({
      id: Number(r.id),
      docNumber: r.doc_number,
      kind: r.kind,
      status: r.status,
      supplierName: r.supplier_name,
      grandTotal: Number(r.grand_total),
      createdAt: r.created_at,
      linkedOrderId: r.logistic_order_id ? Number(r.logistic_order_id) : null,
    })));
  } catch (e) {
    console.error("[orderCosts/purchases/search]", e);
    return res.status(500).json({ error: "Gagal mencari PO" });
  }
});

// ── GAP #6: OPEX ─────────────────────────────────────────────────────────────

// GET /api/order-costs/:orderId/expenses
router.get("/:orderId/expenses", async (req, res) => {
  const oid = orderId(req);
  if (!oid) return res.status(400).json({ error: "Invalid orderId" });
  try {
    const rows = await db.execute(sql.raw(`
      SELECT e.id, e.expense_number, e.date, e.description, e.status,
        e.total::numeric AS total, e.subtotal::numeric AS subtotal,
        e.tax_amount::numeric AS tax_amount,
        e.vendor_employee, e.notes,
        ec.name AS category_name, ec.code AS category_code
      FROM expenses e
      LEFT JOIN expense_categories ec ON ec.id = e.category_id
      WHERE e.logistic_order_id = ${oid}
      ORDER BY e.date DESC, e.id DESC
    `));

    const items = rows.rows.map((r: any) => ({
      id:            Number(r.id),
      expenseNumber: r.expense_number,
      date:          r.date,
      description:   r.description ?? null,
      status:        r.status,
      total:         Number(r.total),
      subtotal:      Number(r.subtotal),
      taxAmount:     Number(r.tax_amount),
      vendorEmployee: r.vendor_employee ?? null,
      notes:         r.notes ?? null,
      categoryName:  r.category_name ?? null,
      categoryCode:  r.category_code ?? null,
    }));

    const totalOpex = items
      .filter(i => i.status === "active")
      .reduce((s, i) => s + i.total, 0);

    return res.json({ items, totalOpex });
  } catch (e) {
    console.error("[orderCosts/expenses GET]", e);
    return res.status(500).json({ error: "Gagal memuat OPEX order" });
  }
});

// POST /api/order-costs/:orderId/expenses/:itemId/link
router.post("/:orderId/expenses/:itemId/link", async (req, res) => {
  if (!(await requireAdmin(req, res))) return;
  const oid = orderId(req); const eid = itemId(req);
  const orderCheck = await db.execute(sql.raw(`SELECT id FROM logistic_orders WHERE id=${oid} LIMIT 1`));
  if (!orderCheck.rows.length) return res.status(404).json({ error: "Order tidak ditemukan" });
  const expCheck = await db.execute(sql.raw(`SELECT id FROM expenses WHERE id=${eid} LIMIT 1`));
  if (!expCheck.rows.length) return res.status(404).json({ error: "Expense tidak ditemukan" });
  await db.execute(sql.raw(`UPDATE expenses SET logistic_order_id=${oid} WHERE id=${eid}`));
  return res.json({ ok: true });
});

// DELETE /api/order-costs/:orderId/expenses/:itemId/link
router.delete("/:orderId/expenses/:itemId/link", async (req, res) => {
  if (!(await requireAdmin(req, res))) return;
  const eid = itemId(req);
  await db.execute(sql.raw(`UPDATE expenses SET logistic_order_id=NULL WHERE id=${eid}`));
  return res.json({ ok: true });
});

// ── GAP #7: Purchase Linkage ──────────────────────────────────────────────

// GET /api/order-costs/:orderId/purchases
router.get("/:orderId/purchases", async (req, res) => {
  const oid = orderId(req);
  if (!oid) return res.status(400).json({ error: "Invalid orderId" });
  try {
    const rows = await db.execute(sql.raw(`
      SELECT pd.id, pd.doc_number, pd.kind, pd.status,
        pd.bill_status, pd.payment_status,
        pd.supplier_name,
        pd.total_amount::numeric AS total_amount,
        pd.tax_amount::numeric AS tax_amount,
        pd.grand_total::numeric AS grand_total,
        pd.confirmed_at, pd.created_at,
        s.name AS supplier_actual_name
      FROM purchase_documents pd
      LEFT JOIN suppliers s ON s.id = pd.supplier_id
      WHERE pd.logistic_order_id = ${oid}
      ORDER BY pd.created_at DESC
    `));

    const items = rows.rows.map((r: any) => ({
      id:            Number(r.id),
      docNumber:     r.doc_number,
      kind:          r.kind,
      status:        r.status,
      billStatus:    r.bill_status,
      paymentStatus: r.payment_status,
      supplierName:  r.supplier_actual_name ?? r.supplier_name,
      totalAmount:   Number(r.total_amount),
      taxAmount:     Number(r.tax_amount),
      grandTotal:    Number(r.grand_total),
      confirmedAt:   r.confirmed_at ?? null,
      createdAt:     r.created_at,
    }));

    const totalPurchaseCost = items
      .filter(i => i.kind === "order")
      .reduce((s, i) => s + i.grandTotal, 0);

    return res.json({ items, totalPurchaseCost });
  } catch (e) {
    console.error("[orderCosts/purchases GET]", e);
    return res.status(500).json({ error: "Gagal memuat PO terkait" });
  }
});

// POST /api/order-costs/:orderId/purchases/:itemId/link
router.post("/:orderId/purchases/:itemId/link", async (req, res) => {
  if (!(await requireAdmin(req, res))) return;
  const oid = orderId(req); const pid = itemId(req);
  const orderCheck = await db.execute(sql.raw(`SELECT id FROM logistic_orders WHERE id=${oid} LIMIT 1`));
  if (!orderCheck.rows.length) return res.status(404).json({ error: "Order tidak ditemukan" });
  const poCheck = await db.execute(sql.raw(`SELECT id FROM purchase_documents WHERE id=${pid} LIMIT 1`));
  if (!poCheck.rows.length) return res.status(404).json({ error: "PO tidak ditemukan" });
  await db.execute(sql.raw(`UPDATE purchase_documents SET logistic_order_id=${oid} WHERE id=${pid}`));
  return res.json({ ok: true });
});

// DELETE /api/order-costs/:orderId/purchases/:itemId/link
router.delete("/:orderId/purchases/:itemId/link", async (req, res) => {
  if (!(await requireAdmin(req, res))) return;
  const pid = itemId(req);
  await db.execute(sql.raw(`UPDATE purchase_documents SET logistic_order_id=NULL WHERE id=${pid}`));
  return res.json({ ok: true });
});

// ── Summary ──────────────────────────────────────────────────────────────────

// GET /api/order-costs/:orderId/summary
router.get("/:orderId/summary", async (req, res) => {
  const oid = orderId(req);
  if (!oid) return res.status(400).json({ error: "Invalid orderId" });

  try {
    const [opexRes, purchaseRes, orderRes] = await Promise.all([
      db.execute(sql.raw(`
        SELECT
          COALESCE(SUM(total::numeric), 0)                         AS total_opex,
          COALESCE(SUM(CASE WHEN status='active' THEN total::numeric ELSE 0 END), 0) AS active_opex,
          COUNT(*)                                                  AS opex_count
        FROM expenses WHERE logistic_order_id = ${oid}
      `)),
      db.execute(sql.raw(`
        SELECT
          COALESCE(SUM(grand_total::numeric), 0)                    AS total_purchase,
          COALESCE(SUM(CASE WHEN kind='order' THEN grand_total::numeric ELSE 0 END), 0) AS po_total,
          COUNT(*) FILTER (WHERE kind='order')                      AS po_count,
          COUNT(*)                                                   AS total_count
        FROM purchase_documents WHERE logistic_order_id = ${oid}
      `)),
      db.execute(sql.raw(`
        SELECT
          lo.grand_total::numeric AS revenue,
          COALESCE(loq_agg.vendor_cost, 0) AS vendor_cost,
          COALESCE(lo.truck_price::numeric, 0) AS truck_cost,
          COALESCE(lo.tax::numeric, 0) AS tax
        FROM logistic_orders lo
        LEFT JOIN (
          SELECT order_id, MAX(vendor_price::numeric) AS vendor_cost
          FROM logistic_order_quotes GROUP BY order_id
        ) loq_agg ON loq_agg.order_id = lo.id
        WHERE lo.id = ${oid} LIMIT 1
      `)),
    ]);

    const opex    = opexRes.rows[0]    as any;
    const purchase = purchaseRes.rows[0] as any;
    const order   = orderRes.rows[0]   as any;
    if (!order) return res.status(404).json({ error: "Order tidak ditemukan" });

    const revenue      = Number(order.revenue);
    const vendorCost   = Number(order.vendor_cost);
    const truckCost    = Number(order.truck_cost);
    const tax          = Number(order.tax);
    const totalOpex    = Number(opex?.active_opex   ?? 0);
    const totalPurchase= Number(purchase?.po_total  ?? 0);
    const grossMargin  = revenue - vendorCost - truckCost;
    const netMargin    = grossMargin - totalOpex;
    const netMarginPct = revenue > 0
      ? Math.round(netMargin / revenue * 1000) / 10 : 0;

    return res.json({
      revenue, vendorCost, truckCost, tax,
      grossMargin,
      totalOpex,
      opexCount:    Number(opex?.opex_count ?? 0),
      netMargin,
      netMarginPct,
      totalPurchase,
      poCount:      Number(purchase?.po_count ?? 0),
      purchaseCount: Number(purchase?.total_count ?? 0),
      purchaseVariance: totalPurchase > 0 ? vendorCost - totalPurchase : null,
    });
  } catch (e) {
    console.error("[orderCosts/summary]", e);
    return res.status(500).json({ error: "Gagal memuat ringkasan biaya" });
  }
});

export default router;
