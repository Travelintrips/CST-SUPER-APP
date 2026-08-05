import { Router, type Request, type Response } from "express";
import { db } from "@workspace/db";
import { sql } from "drizzle-orm";
import { requireAdmin } from "../lib/requireAdmin.js";
import { postStockIn } from "../lib/inventoryStock.js";
import { sendViaService as sendWhatsApp } from "../lib/waTransport.js";
import { sendMail, isSmtpConfigured } from "../lib/mailer.js";

const router = Router();
router.use(async (req, res, next) => {
  if (!(await requireAdmin(req, res))) return;
  next();
});

// ── helpers ───────────────────────────────────────────────────────────────────

function receiptNo(): string {
  const now = new Date();
  const y = now.getFullYear();
  const m = String(now.getMonth() + 1).padStart(2, "0");
  const d = String(now.getDate()).padStart(2, "0");
  const ms = now.getTime().toString().slice(-5);
  return `GRN/${y}${m}${d}/${ms}`;
}

async function loadReceipt(id: number) {
  const r = await db.execute(sql`
    SELECT
      pr.*,
      pd.doc_number AS po_number, pd.supplier_name,
      w.warehouse_name, w.warehouse_code
    FROM purchase_receipts pr
    JOIN purchase_documents pd ON pd.id = pr.po_id
    JOIN warehouses w ON w.id = pr.warehouse_id
    WHERE pr.id = ${id}
  `);
  if (!r.rows.length) return null;
  const receipt = r.rows[0] as any;

  const lines = await db.execute(sql`
    SELECT
      prl.*,
      prl.qty_ordered::float, prl.qty_received::float,
      prl.unit_cost::float, prl.total_cost::float,
      p.name AS product_name, p.sku, p.unit,
      wr.rack_code, wr.rack_name
    FROM purchase_receipt_lines prl
    JOIN products p ON p.id = prl.product_id
    LEFT JOIN warehouse_racks wr ON wr.id = prl.rack_id
    WHERE prl.receipt_id = ${id}
    ORDER BY prl.id
  `);

  return { ...receipt, lines: lines.rows };
}

// ── LIST ──────────────────────────────────────────────────────────────────────

router.get("/", async (_req: Request, res: Response) => {
  const rows = await db.execute(sql`
    SELECT
      pr.id, pr.receipt_no, pr.status, pr.notes,
      pr.received_at, pr.created_at,
      pd.doc_number AS po_number, pd.supplier_name,
      w.warehouse_name, w.warehouse_code,
      (SELECT COUNT(*)::int FROM purchase_receipt_lines WHERE receipt_id = pr.id) AS line_count,
      (SELECT COALESCE(SUM(total_cost),0)::float FROM purchase_receipt_lines WHERE receipt_id = pr.id) AS total_value
    FROM purchase_receipts pr
    JOIN purchase_documents pd ON pd.id = pr.po_id
    JOIN warehouses w ON w.id = pr.warehouse_id
    ORDER BY pr.created_at DESC
    LIMIT 200
  `);
  res.json(rows.rows);
});

// ── PENDING POs (confirmed orders that can still be received) ─────────────────

router.get("/pending-pos", async (_req: Request, res: Response) => {
  const rows = await db.execute(sql`
    SELECT
      pd.id, pd.doc_number, pd.supplier_name, pd.created_at,
      pd.total_amount::float, pd.grand_total::float,
      pd.receive_status,
      (
        SELECT json_agg(l ORDER BY l.id) FROM (
          SELECT
            pdl.id, pdl.product_id,
            p.name AS product_name, p.sku, p.unit,
            pdl.quantity::float AS qty_ordered,
            pdl.unit_cost::float,
            COALESCE((
              SELECT SUM(prl.qty_received)::float
              FROM purchase_receipt_lines prl
              JOIN purchase_receipts pr ON pr.id = prl.receipt_id
              WHERE pr.po_id = pd.id
                AND prl.po_line_id = pdl.id
                AND pr.status = 'posted'
            ), 0) AS qty_already_received
          FROM purchase_document_lines pdl
          JOIN products p ON p.id = pdl.product_id
          WHERE pdl.document_id = pd.id
            AND pdl.product_id IS NOT NULL
        ) l
      ) AS lines
    FROM purchase_documents pd
    WHERE pd.kind = 'order'
      AND pd.status = 'confirmed'
      AND pd.receive_status IN ('to_receive', 'received')
    ORDER BY pd.created_at DESC
  `);
  res.json(rows.rows);
});

// ── GET ONE ───────────────────────────────────────────────────────────────────

router.get("/:id", async (req: Request, res: Response) => {
  const id = Number(req.params.id);
  if (Number.isNaN(id)) { res.status(400).json({ message: "Invalid id" }); return; }
  const r = await loadReceipt(id);
  if (!r) { res.status(404).json({ message: "Receipt not found" }); return; }
  res.json(r);
});

// ── CREATE (draft → post in one step) ────────────────────────────────────────

router.post("/", async (req: Request, res: Response) => {
  const { poId, warehouseId, notes, lines, receivedBy } = req.body as {
    poId: number;
    warehouseId: number;
    notes?: string;
    receivedBy?: string;
    lines: {
      poLineId?: number | null;
      productId: number;
      rackId?: number | null;
      qtyOrdered: number;
      qtyReceived: number;
      unitCost: number;
    }[];
  };

  if (!poId || !warehouseId || !lines?.length) {
    res.status(400).json({ message: "poId, warehouseId, lines wajib diisi" }); return;
  }

  const validLines = lines.filter((l) => l.qtyReceived > 0 && l.productId);
  if (!validLines.length) {
    res.status(400).json({ message: "Minimal satu item harus diisi qty diterima > 0" }); return;
  }

  // Verify PO exists
  const po = await db.execute(sql`SELECT * FROM purchase_documents WHERE id = ${poId}`);
  if (!po.rows.length) { res.status(404).json({ message: "Purchase Order tidak ditemukan" }); return; }

  const rNo = receiptNo();
  const now = new Date();

  // Create receipt header
  const rr = await db.execute(sql`
    INSERT INTO purchase_receipts (receipt_no, po_id, warehouse_id, status, notes, received_by, received_at)
    VALUES (${rNo}, ${poId}, ${warehouseId}, 'posted', ${notes ?? null}, ${receivedBy ?? null}, ${now})
    RETURNING *
  `);
  const receiptId = (rr.rows[0] as any).id;

  // Insert lines + post stock movements
  for (const line of validLines) {
    await db.execute(sql`
      INSERT INTO purchase_receipt_lines
        (receipt_id, po_line_id, product_id, rack_id, qty_ordered, qty_received, unit_cost)
      VALUES
        (${receiptId}, ${line.poLineId ?? null}, ${line.productId},
         ${line.rackId ?? null}, ${line.qtyOrdered}, ${line.qtyReceived}, ${line.unitCost})
    `);

    await postStockIn({
      productId: line.productId,
      warehouseId,
      rackId: line.rackId ?? null,
      qty: line.qtyReceived,
      unitCost: line.unitCost,
      movementType: "PURCHASE_RECEIPT",
      referenceType: "PURCHASE_ORDER",
      referenceId: poId,
      notes: `GRN ${rNo} — PO ${(po.rows[0] as any).doc_number}`,
      createdBy: receivedBy ?? null,
    });
  }

  // Update PO receive_status
  const totalReceived = await db.execute(sql`
    SELECT
      pdl.id,
      pdl.quantity::float AS qty_ordered,
      COALESCE(SUM(prl.qty_received)::float, 0) AS qty_received_total
    FROM purchase_document_lines pdl
    LEFT JOIN purchase_receipt_lines prl ON prl.po_line_id = pdl.id
      AND prl.receipt_id IN (
        SELECT id FROM purchase_receipts WHERE po_id = ${poId} AND status = 'posted'
      )
    WHERE pdl.document_id = ${poId} AND pdl.product_id IS NOT NULL
    GROUP BY pdl.id, pdl.quantity
  `);

  const allReceived = (totalReceived.rows as any[]).every(
    (r) => Number(r.qty_received_total) >= Number(r.qty_ordered)
  );

  await db.execute(sql`
    UPDATE purchase_documents
    SET receive_status = ${allReceived ? "received" : "to_receive"},
        updated_at = NOW()
    WHERE id = ${poId}
  `);

  const result = await loadReceipt(receiptId);
  res.status(201).json(result);

  // Notifikasi WA + email setelah GRN dibuat (fire-and-forget, setelah response terkirim)
  void (async () => {
    try {
      const poRow = po.rows[0] as any;
      const totalValue = validLines.reduce((s, l) => s + l.qtyReceived * l.unitCost, 0);
      const waMsg =
        `📦 *GRN Dibuat*\nNo: ${rNo}\nPO: ${poRow.doc_number ?? poId}\nSupplier: ${poRow.supplier_name ?? "-"}\nTotal: Rp ${totalValue.toLocaleString("id-ID")}`;
      const phones = [
        ...(process.env.ADMIN_WA_PHONES ?? "").split(",").map((p) => p.trim()).filter(Boolean),
        ...(process.env.FONNTE_ADMIN_WA?.trim() ? [process.env.FONNTE_ADMIN_WA.trim()] : []),
      ];
      const unique = [...new Set(phones)];
      for (const phone of unique) {
        await sendWhatsApp(phone, waMsg, {
          context: "grn_created",
          refType: "purchase_receipt",
          refId: String(receiptId),
        });
      }

      // Email ke supplier (jika punya email dan SMTP dikonfigurasi)
      if (isSmtpConfigured() && poRow.supplier_id) {
        const supRows = await db.execute(sql`SELECT contact_email, name FROM suppliers WHERE id = ${poRow.supplier_id} LIMIT 1`);
        const sup = supRows.rows[0] as any;
        const supplierEmail: string | undefined = sup?.contact_email;
        if (supplierEmail) {
          const lineRows = await db.execute(sql`
            SELECT p.name AS product_name, prl.qty_received::float, prl.unit_cost::float
            FROM purchase_receipt_lines prl
            JOIN products p ON p.id = prl.product_id
            WHERE prl.receipt_id = ${receiptId}
            ORDER BY prl.id
          `);
          const lineItems = (lineRows.rows as any[])
            .map((l) =>
              `<tr><td style="padding:4px 8px;border:1px solid #ddd;">${l.product_name}</td>` +
              `<td style="padding:4px 8px;border:1px solid #ddd;text-align:right;">${Number(l.qty_received).toLocaleString("id-ID")}</td>` +
              `<td style="padding:4px 8px;border:1px solid #ddd;text-align:right;">Rp ${(Number(l.unit_cost)).toLocaleString("id-ID")}</td></tr>`
            )
            .join("");
          const html = `
<p>Kepada Yth. ${poRow.supplier_name ?? sup?.name ?? "Supplier"},</p>
<p>Kami mengonfirmasi bahwa barang dari <strong>Purchase Order ${poRow.doc_number ?? poId}</strong> telah kami terima dengan detail sebagai berikut:</p>
<table style="border-collapse:collapse;width:100%;font-family:sans-serif;font-size:14px;">
  <thead>
    <tr style="background:#f5f5f5;">
      <th style="padding:6px 8px;border:1px solid #ddd;text-align:left;">Produk</th>
      <th style="padding:6px 8px;border:1px solid #ddd;text-align:right;">Qty Diterima</th>
      <th style="padding:6px 8px;border:1px solid #ddd;text-align:right;">Harga Satuan</th>
    </tr>
  </thead>
  <tbody>${lineItems}</tbody>
  <tfoot>
    <tr>
      <td colspan="2" style="padding:6px 8px;border:1px solid #ddd;text-align:right;font-weight:bold;">Total</td>
      <td style="padding:6px 8px;border:1px solid #ddd;text-align:right;font-weight:bold;">Rp ${totalValue.toLocaleString("id-ID")}</td>
    </tr>
  </tfoot>
</table>
<p><strong>No. GRN:</strong> ${rNo}</p>
<p>Terima kasih atas kerjasamanya.</p>`;
          const text =
            `Konfirmasi GRN ${rNo}\nPO: ${poRow.doc_number ?? poId}\nSupplier: ${poRow.supplier_name ?? "-"}\nTotal Diterima: Rp ${totalValue.toLocaleString("id-ID")}`;
          await sendMail({
            to: supplierEmail,
            subject: `Konfirmasi Penerimaan Barang (GRN) - ${rNo}`,
            html,
            text,
            context: "grn_created",
            refType: "purchase_receipt",
            refId: String(receiptId),
          });
        }
      }
    } catch (e) {
      console.error("[grn notify]", e);
    }
  })();
});

// ── CANCEL ────────────────────────────────────────────────────────────────────

router.delete("/:id", async (req: Request, res: Response) => {
  const id = Number(req.params.id);
  const r = await db.execute(sql`SELECT * FROM purchase_receipts WHERE id = ${id}`);
  if (!r.rows.length) { res.status(404).json({ message: "Not found" }); return; }
  const receipt = r.rows[0] as any;
  if (receipt.status === "cancelled") { res.status(400).json({ message: "Already cancelled" }); return; }

  await db.execute(sql`UPDATE purchase_receipts SET status = 'cancelled', updated_at = NOW() WHERE id = ${id}`);
  res.json({ ok: true });
});

// ── WAREHOUSES LIST (for dropdown) ───────────────────────────────────────────

router.get("/meta/warehouses", async (_req: Request, res: Response) => {
  const rows = await db.execute(sql`
    SELECT pw.id, pw.name AS warehouse_name, pw.type AS warehouse_type,
           b.name AS branch_name
    FROM pos_warehouses pw
    JOIN pos_branches b ON b.id = pw.branch_id
    WHERE pw.is_active = TRUE
    ORDER BY pw.name
  `);
  res.json(rows.rows);
});

export default router;
