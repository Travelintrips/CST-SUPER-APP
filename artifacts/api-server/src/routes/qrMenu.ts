import { Router, type IRouter } from "express";
import { db } from "@workspace/db";
import { sql } from "drizzle-orm";
import { logger } from "../lib/logger.js";

const router: IRouter = Router();

/* ── GET /api/qr-menu/:branchId/info ─────────────────────────────────────── */
router.get("/:branchId/info", async (req, res) => {
  const branchId = Number(req.params.branchId);
  if (!Number.isFinite(branchId) || branchId <= 0)
    return void res.status(400).json({ error: "branchId tidak valid" });
  try {
    const { rows } = (await db.execute(sql`
      SELECT b.id, b.name, b.address,
             c.name AS company_name,
             c.logo_url AS company_logo
      FROM pos_branches b
      LEFT JOIN companies c ON c.id = b.company_id
      WHERE b.id = ${branchId} AND b.is_active = TRUE
    `)) as unknown as { rows: any[] };
    if (!rows[0]) return void res.status(404).json({ error: "Cabang tidak ditemukan atau tidak aktif" });
    res.json(rows[0]);
  } catch (err) {
    logger.error({ err }, "qr-menu branch info");
    res.status(500).json({ error: "Gagal memuat info cabang" });
  }
});

/* ── GET /api/qr-menu/:branchId/products ─────────────────────────────────── */
router.get("/:branchId/products", async (req, res) => {
  const branchId = Number(req.params.branchId);
  if (!Number.isFinite(branchId) || branchId <= 0)
    return void res.status(400).json({ error: "branchId tidak valid" });
  try {
    const { rows: branch } = (await db.execute(sql`
      SELECT company_id FROM pos_branches WHERE id = ${branchId} AND is_active = TRUE
    `)) as unknown as { rows: { company_id: number | null }[] };
    if (!branch[0]) return void res.status(404).json({ error: "Cabang tidak ditemukan" });

    const companyId = branch[0].company_id;
    const cFilter = companyId ? sql`AND company_id = ${companyId}` : sql``;

    const { rows } = (await db.execute(sql`
      SELECT id, name, description, price::text AS price, category, image_url
      FROM pos_products
      WHERE is_active = TRUE ${cFilter}
      ORDER BY sort_order ASC, category ASC, name ASC
    `)) as unknown as { rows: any[] };
    res.json(rows);
  } catch (err) {
    logger.error({ err }, "qr-menu products");
    res.status(500).json({ error: "Gagal memuat produk" });
  }
});

/* ── POST /api/qr-menu/:branchId/orders ──────────────────────────────────── */
router.post("/:branchId/orders", async (req, res) => {
  const branchId = Number(req.params.branchId);
  if (!Number.isFinite(branchId) || branchId <= 0)
    return void res.status(400).json({ error: "branchId tidak valid" });

  const { items, tableNumber, customerName, customerNote } = req.body ?? {};
  if (!Array.isArray(items) || items.length === 0)
    return void res.status(400).json({ error: "Items pesanan tidak boleh kosong" });

  try {
    const { rows: branch } = (await db.execute(sql`
      SELECT id, company_id FROM pos_branches WHERE id = ${branchId} AND is_active = TRUE
    `)) as unknown as { rows: { id: number; company_id: number | null }[] };
    if (!branch[0]) return void res.status(404).json({ error: "Cabang tidak ditemukan" });
    const companyId = branch[0].company_id;

    const productIds: number[] = items.map((i: any) => Number(i.productId)).filter((n) => Number.isFinite(n) && n > 0);
    if (productIds.length !== items.length)
      return void res.status(400).json({ error: "productId tidak valid" });

    const cFilter = companyId ? sql`AND company_id = ${companyId}` : sql``;
    const { rows: products } = (await db.execute(sql`
      SELECT id, name, price FROM pos_products
      WHERE id = ANY(${productIds}) AND is_active = TRUE ${cFilter}
    `)) as unknown as { rows: { id: number; name: string; price: string }[] };

    const productMap = new Map(products.map((p) => [p.id, p]));
    let total = 0;
    const orderItems: { productId: number; name: string; price: number; qty: number; subtotal: number }[] = [];
    for (const item of items) {
      const pid = Number(item.productId);
      const qty = Math.max(1, Number(item.qty ?? 1));
      const prod = productMap.get(pid);
      if (!prod) return void res.status(400).json({ error: `Produk id=${pid} tidak ditemukan` });
      const price = Number(prod.price);
      const subtotal = price * qty;
      total += subtotal;
      orderItems.push({ productId: pid, name: prod.name, price, qty, subtotal });
    }

    const { rows: cashierRows } = (await db.execute(sql`
      SELECT c.id FROM pos_cashiers c
      JOIN pos_branches b ON b.id = ${branchId}
      WHERE (c.branch_id = ${branchId} OR c.allow_all_branches = TRUE)
        AND c.status = 'active'
      LIMIT 1
    `)) as unknown as { rows: { id: number }[] };

    let cashierId: number | null = cashierRows[0]?.id ?? null;
    if (!cashierId) {
      const { rows: anyCashier } = (await db.execute(sql`
        SELECT id FROM pos_cashiers WHERE status = 'active' LIMIT 1
      `)) as unknown as { rows: { id: number }[] };
      cashierId = anyCashier[0]?.id ?? null;
    }
    if (!cashierId)
      return void res.status(400).json({ error: "Tidak ada kasir aktif. Hubungi petugas." });

    const year = new Date().getFullYear();
    const { rows: seqRows } = (await db.execute(sql`
      SELECT COALESCE(MAX(CAST(SPLIT_PART(order_number, '/', 3) AS INTEGER)), 0) AS max_seq
      FROM pos_orders WHERE order_number LIKE ${"QRM/" + year + "/%"}
    `)) as unknown as { rows: { max_seq: number }[] };
    const seq = (Number(seqRows[0]?.max_seq ?? 0) + 1).toString().padStart(4, "0");
    const orderNumber = `QRM/${year}/${seq}`;

    const noteText = [
      customerName ? `Nama: ${customerName}` : null,
      tableNumber ? `Meja: ${tableNumber}` : null,
      customerNote ? `Catatan: ${customerNote}` : null,
    ].filter(Boolean).join(" | ") || null;

    const { rows: orderRows } = (await db.execute(sql`
      INSERT INTO pos_orders
        (company_id, order_number, cashier_id, branch_id, status, subtotal, discount, total, note)
      VALUES
        (${companyId ?? null}, ${orderNumber}, ${cashierId}, ${branchId},
         'open', ${total}, 0, ${total}, ${noteText})
      RETURNING id
    `)) as unknown as { rows: { id: number }[] };
    const orderId = orderRows[0].id;

    for (const oi of orderItems) {
      await db.execute(sql`
        INSERT INTO pos_order_items (order_id, product_id, product_name, price, qty, subtotal)
        VALUES (${orderId}, ${oi.productId}, ${oi.name}, ${oi.price}, ${oi.qty}, ${oi.subtotal})
      `);
    }

    res.status(201).json({ orderNumber, total: String(total) });
  } catch (err) {
    logger.error({ err }, "qr-menu create order");
    res.status(500).json({ error: "Gagal membuat pesanan" });
  }
});

export default router;
