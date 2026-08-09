import { Router, type Request } from "express";
import { randomBytes } from "crypto";
import { requireAdmin } from "../lib/requireAdmin.js";
import { resolveCompanyId } from "../lib/resolveCompany.js";
import { assertCompanyAccess } from "../lib/assertCompanyAccess.js";
import { streamInvoicePdf, buildInvoicePdfBuffer } from "../lib/pdfInvoice.js";
import { loadDocTemplate } from "../lib/docTemplateLoader.js";
import { postPurchaseBill, postPurchaseBillReversal, postLogisticVendorCostJournal } from "../lib/accounting.js";
import { sendMail, isSmtpConfigured } from "../lib/mailer.js";
import { sendViaService as sendWhatsApp } from "../lib/waTransport.js";
import { getAdminGroupWa } from "../lib/adminWa.js";
import { saveAndBroadcast } from "../lib/notificationStore.js";
import { ensureAccountingSettings } from "../lib/accountingSeed.js";
import { postStockIn } from "../lib/inventoryStock.js";
import {
  db,
  suppliersTable,
  purchaseDocumentsTable,
  purchaseDocumentLinesTable,
  accountingTaxesTable,
  goodsReceiptsTable,
  vendorInvoicesTable,
  accountingEntriesTable,
  accountingEntryLinesTable,
  chartOfAccountsTable,
} from "@workspace/db";
import { eq, sql, desc, and, or, inArray, type SQL } from "drizzle-orm";
import { getRequiredPublicDomain } from "../lib/domain.js";

/** Kirim WA ke semua admin (ADMIN_WA_PHONES + FONNTE_ADMIN_WA), fire-and-forget. */
function notifyAdminWa(message: string, context?: string, refType?: string, refId?: string): void {
  const phones = [
    ...(process.env.ADMIN_WA_PHONES ?? "").split(",").map((p) => p.trim()).filter(Boolean),
    ...(process.env.FONNTE_ADMIN_WA?.trim() ? [process.env.FONNTE_ADMIN_WA.trim()] : []),
  ];
  const unique = [...new Set(phones)];
  for (const phone of unique) {
    sendWhatsApp(phone, message, { context, refType, refId }).catch((e: unknown) =>
      console.error("[purchase WA]", e),
    );
  }
}

async function computeTax(subtotal: number, taxRateId: number | null | undefined): Promise<{ taxAmount: number; grandTotal: number }> {
  if (!taxRateId) return { taxAmount: 0, grandTotal: subtotal };
  const [tax] = await db.select().from(accountingTaxesTable).where(eq(accountingTaxesTable.id, taxRateId));
  if (!tax) return { taxAmount: 0, grandTotal: subtotal };
  const taxAmount = Math.round(subtotal * Number(tax.rate)) / 100;
  return { taxAmount, grandTotal: subtotal + taxAmount };
}

// ── Public router: vendor PO accept (no auth required) ────────────────────
export const purchasePublicRouter = Router();

purchasePublicRouter.get("/vendor-accept/:token", async (req, res) => {
  const token = req.params.token;
  const result = await db.execute(sql`
    SELECT pd.id, pd.doc_number, pd.supplier_name, pd.grand_total, pd.total_amount, pd.tax_amount,
           pd.status, pd.kind, pd.vendor_accepted_at, pd.vendor_accept_notes, pd.expected_date,
           pd.notes, pd.created_at
    FROM purchase_documents pd
    WHERE pd.vendor_accept_token = ${token} AND pd.kind = 'order'
    LIMIT 1
  `);
  const doc = (result as any).rows?.[0] ?? (Array.isArray(result) ? result[0] : null);
  if (!doc) return res.status(404).json({ message: "Link tidak valid atau sudah kadaluarsa" });

  const lines = await db.execute(sql`
    SELECT name, description, quantity, unit_cost, subtotal
    FROM purchase_document_lines WHERE document_id = ${doc.id} ORDER BY id
  `);

  return res.json({ ...doc, lines: (lines as any).rows ?? lines });
});

purchasePublicRouter.post("/vendor-accept/:token", async (req, res) => {
  const token = req.params.token;
  const { notes } = req.body ?? {};

  const result = await db.execute(sql`
    SELECT id, doc_number, supplier_name, grand_total, total_amount, vendor_accepted_at
    FROM purchase_documents
    WHERE vendor_accept_token = ${token} AND kind = 'order' LIMIT 1
  `);
  const doc = (result as any).rows?.[0] ?? (Array.isArray(result) ? result[0] : null);
  if (!doc) return res.status(404).json({ message: "Link tidak valid atau sudah kadaluarsa" });
  if (doc.vendor_accepted_at) return res.status(409).json({ message: "PO ini sudah dikonfirmasi sebelumnya", alreadyAccepted: true });

  await db.execute(sql`
    UPDATE purchase_documents
    SET vendor_accepted_at = NOW(), vendor_accept_notes = ${notes ?? null}
    WHERE id = ${doc.id}
  `);

  // In-app notification to admin
  const acceptedAt = new Date().toISOString();
  const totalNum = Number(doc.grand_total ?? doc.total_amount ?? 0);
  saveAndBroadcast("vendor_po_accepted", {
    type: "vendor_po_accepted",
    orderId: doc.id,
    orderNumber: doc.doc_number ?? "-",
    customerName: doc.supplier_name ?? "-",
    companyName: null,
    grandTotal: totalNum,
    vendorNotes: notes?.trim() ?? null,
    acceptedAt,
  }).catch(() => undefined);

  // Notify admin group via WhatsApp
  const total = Number(doc.grand_total ?? doc.total_amount ?? 0);
  const msgLines = [
    `✅ *Vendor Konfirmasi Purchase Order*`,
    ``,
    `• *No PO*: ${doc.doc_number ?? "-"}`,
    `• *Vendor*: ${doc.supplier_name ?? "-"}`,
    `• *Total*: Rp ${total.toLocaleString("id-ID")}`,
    `• *Waktu*: ${new Date(acceptedAt).toLocaleString("id-ID", { timeZone: "Asia/Jakarta" })}`,
    notes?.trim() ? `• *Catatan vendor*: ${notes.trim()}` : null,
    ``,
    `Silakan proses GR (Goods Receipt) untuk PO ini.`,
  ].filter(Boolean).join("\n");

  getAdminGroupWa().then((adminGroup) => {
    if (!adminGroup) return;
    sendWhatsApp(adminGroup, msgLines, {
      context: "purchase_vendor_accept_admin",
      refType: "purchase_document",
      refId: String(doc.id),
    }).catch(() => undefined);
  }).catch(() => undefined);

  return res.json({ ok: true, acceptedAt });
});

// ── Authenticated router ─────────────────────────────────────────────────────
const router = Router();

router.use(async (req, res, next) => {
  if (!(await requireAdmin(req, res))) return;
  next();
});

type PurchaseKind = "rfq" | "order";
type PurchaseStatus = "draft" | "sent" | "confirmed" | "done" | "cancelled";
type PurchaseBillStatus = "none" | "to_bill" | "billed";
type PurchaseReceiveStatus = "none" | "to_receive" | "received";

interface LineInput {
  productId?: number | null;
  name: string;
  description?: string | null;
  quantity: number;
  unitCost: number;
}

function serializeDoc(d: typeof purchaseDocumentsTable.$inferSelect) {
  return {
    ...d,
    totalAmount: Number(d.totalAmount),
    taxAmount: Number(d.taxAmount ?? 0),
    grandTotal: Number(d.grandTotal ?? d.totalAmount),
    amountPaid: Number(d.amountPaid ?? 0),
    expectedDate: d.expectedDate ? d.expectedDate.toISOString() : null,
    confirmedAt: d.confirmedAt ? d.confirmedAt.toISOString() : null,
    createdAt: d.createdAt.toISOString(),
    updatedAt: d.updatedAt.toISOString(),
  };
}

function serializeLine(l: typeof purchaseDocumentLinesTable.$inferSelect) {
  return {
    ...l,
    quantity: Number(l.quantity),
    unitCost: Number(l.unitCost),
    subtotal: Number(l.subtotal),
  };
}

async function nextDocNumber(kind: PurchaseKind, offset = 0): Promise<string> {
  const prefix = kind === "rfq" ? "RFQ" : "PO";
  const year = new Date().getFullYear();
  const pattern = `${prefix}/${year}/%`;
  const [row] = await db
    .select({
      maxSeq: sql<number>`COALESCE(MAX(CAST(SPLIT_PART(doc_number, '/', 3) AS int)), 0)`,
    })
    .from(purchaseDocumentsTable)
    .where(sql`doc_number LIKE ${pattern}`);
  const seq = (Number(row?.maxSeq ?? 0) + 1 + offset).toString().padStart(5, "0");
  return `${prefix}/${year}/${seq}`;
}



router.get("/summary", async (req, res) => {
  const companyId = resolveCompanyId(req);
  const docs = await db.select().from(purchaseDocumentsTable)
    .where(eq(purchaseDocumentsTable.companyId, companyId));
  const rfqCount = docs.filter((d) => d.kind === "rfq").length;
  const ordersCount = docs.filter((d) => d.kind === "order").length;
  const toBillCount = docs.filter((d) => d.kind === "order" && d.billStatus === "to_bill").length;
  const totalSpend = docs
    .filter((d) => d.kind === "order" && d.status !== "cancelled")
    .reduce((sum, d) => sum + Number(d.totalAmount), 0);

  const vendorTotals = new Map<string, number>();
  for (const d of docs) {
    if (d.kind !== "order" || d.status === "cancelled") continue;
    const cur = vendorTotals.get(d.supplierName) || 0;
    vendorTotals.set(d.supplierName, cur + Number(d.totalAmount));
  }
  let topVendor: string | null = null;
  let topAmount = 0;
  for (const [name, amt] of vendorTotals) {
    if (amt > topAmount) {
      topAmount = amt;
      topVendor = name;
    }
  }
  return res.json({ rfqCount, ordersCount, toBillCount, totalSpend, topVendor });
});

// GET /purchase/dashboard-kpi — widget stats for main dashboard
router.get("/dashboard-kpi", async (req, res) => {
  const companyId = resolveCompanyId(req);
  const cid = companyId;

  const now = new Date();
  const monthStart = new Date(now.getFullYear(), now.getMonth(), 1)
    .toISOString()
    .slice(0, 10);
  const monthEnd = new Date(now.getFullYear(), now.getMonth() + 1, 0)
    .toISOString()
    .slice(0, 10);

  const companyFilter = sql`AND company_id = ${cid}`;

  const [counts, monthData, topSuppliers] = await Promise.all([
    db.execute(sql`
      SELECT
        SUM(CASE WHEN kind='rfq' AND status NOT IN ('cancelled','done') THEN 1 ELSE 0 END)::int AS active_rfqs,
        SUM(CASE WHEN kind='order' AND status NOT IN ('cancelled') THEN 1 ELSE 0 END)::int AS active_pos,
        SUM(CASE WHEN kind='order' AND bill_status='to_bill' AND status!='cancelled' THEN 1 ELSE 0 END)::int AS to_bill,
        SUM(CASE WHEN kind='order' AND bill_status='billed'
          AND payment_status IN ('unpaid','partial') THEN 1 ELSE 0 END)::int AS billed_unpaid,
        SUM(CASE WHEN kind='order' AND bill_status='billed'
          AND payment_status IN ('unpaid','partial')
          AND due_date IS NOT NULL AND due_date < TO_CHAR(CURRENT_DATE,'YYYY-MM-DD')
          THEN 1 ELSE 0 END)::int AS overdue_count,
        COALESCE(SUM(CASE WHEN kind='order' AND bill_status='billed'
          AND payment_status IN ('unpaid','partial')
          AND due_date IS NOT NULL AND due_date < TO_CHAR(CURRENT_DATE,'YYYY-MM-DD')
          THEN grand_total::numeric - amount_paid::numeric ELSE 0 END),0)::float AS overdue_amount
      FROM purchase_documents
      WHERE 1=1 ${companyFilter}
    `),

    db.execute(sql`
      SELECT
        COALESCE(SUM(CASE WHEN kind='order' AND status NOT IN ('cancelled','draft')
          AND confirmed_at >= ${monthStart}::date AND confirmed_at <= ${monthEnd}::date
          THEN grand_total::numeric ELSE 0 END),0)::float AS month_spend,
        SUM(CASE WHEN kind='order' AND status NOT IN ('cancelled') AND created_at >= CURRENT_DATE
          THEN 1 ELSE 0 END)::int AS new_today
      FROM purchase_documents
      WHERE 1=1 ${companyFilter}
    `),

    db.execute(sql`
      SELECT supplier_name,
        COALESCE(SUM(grand_total::numeric),0)::float AS total
      FROM purchase_documents
      WHERE kind='order' AND status NOT IN ('cancelled','draft')
        AND confirmed_at >= ${monthStart}::date AND confirmed_at <= ${monthEnd}::date
        ${companyFilter}
      GROUP BY supplier_name
      ORDER BY total DESC
      LIMIT 3
    `),
  ]);

  const c = (counts.rows[0] ?? {}) as Record<string, unknown>;
  const m = (monthData.rows[0] ?? {}) as Record<string, unknown>;

  return res.json({
    activeRfqs:    Number(c["active_rfqs"]   ?? 0),
    activePOs:     Number(c["active_pos"]    ?? 0),
    toBill:        Number(c["to_bill"]       ?? 0),
    billedUnpaid:  Number(c["billed_unpaid"] ?? 0),
    overdueCount:  Number(c["overdue_count"] ?? 0),
    overdueAmount: Number(c["overdue_amount"] ?? 0),
    monthSpend:    Number(m["month_spend"]   ?? 0),
    newToday:      Number(m["new_today"]     ?? 0),
    topSuppliers:  (topSuppliers.rows as { supplier_name: string; total: number }[])
      .map((r) => ({ name: r.supplier_name, total: Number(r.total) })),
  });
});

router.get("/documents", async (req, res) => {
  const companyId = resolveCompanyId(req);
  const kind = req.query["kind"] as PurchaseKind | undefined;
  const billStatus = req.query["billStatus"] as PurchaseBillStatus | undefined;
  const paymentStatus = req.query["paymentStatus"] as "unpaid" | "partial" | "paid" | undefined;
  const conds: SQL[] = [eq(purchaseDocumentsTable.companyId, companyId)];
  if (kind === "rfq" || kind === "order") conds.push(eq(purchaseDocumentsTable.kind, kind));
  if (billStatus === "none" || billStatus === "to_bill" || billStatus === "billed")
    conds.push(eq(purchaseDocumentsTable.billStatus, billStatus));
  if (paymentStatus === "unpaid" || paymentStatus === "partial" || paymentStatus === "paid" || paymentStatus === "overdue")
    conds.push(eq(purchaseDocumentsTable.paymentStatus, paymentStatus));
  const rows = await db
    .select()
    .from(purchaseDocumentsTable)
    .where(and(...conds))
    .orderBy(desc(purchaseDocumentsTable.createdAt));
  return res.json(rows.map(serializeDoc));
});

async function loadDocWithLines(id: number) {
  const [doc] = await db
    .select()
    .from(purchaseDocumentsTable)
    .where(eq(purchaseDocumentsTable.id, id));
  if (!doc) return null;
  const lines = await db
    .select()
    .from(purchaseDocumentLinesTable)
    .where(eq(purchaseDocumentLinesTable.documentId, id))
    .orderBy(purchaseDocumentLinesTable.id);
  return { ...serializeDoc(doc), lines: lines.map(serializeLine) };
}

router.get("/documents/:id", async (req, res) => {
  const id = Number(req.params.id);
  if (Number.isNaN(id)) return res.status(400).json({ message: "Invalid id" });
  const doc = await loadDocWithLines(id);
  if (!doc) return res.status(404).json({ message: "Document not found" });
  // IDOR guard: ensure document belongs to the requesting user's company
  const companyId = resolveCompanyId(req);
  if (!await assertCompanyAccess(doc.companyId, companyId, req, res, { resourceType: "purchase_document", resourceId: id })) return;
  return res.json(doc);
});

router.post("/documents", async (req, res) => {
  const companyId = resolveCompanyId(req);
  const { kind, supplierId, supplierName, supplierAddress, expectedDate, notes, lines, taxRateId, warehouseId, productCategory, incoterm, deliveryTerm, targetPrice, commoditySpecs, requiredDocuments, categoryKey, templateId, templateVersion, templateSnapshot } = req.body ?? {};
  if (typeof supplierName !== "string" || !supplierName.trim())
    return res.status(400).json({ message: "supplierName required" });
  if (!Array.isArray(lines) || lines.length === 0)
    return res.status(400).json({ message: "At least one line required" });

  const docKind: PurchaseKind = kind === "order" ? "order" : "rfq";

  if (supplierId !== undefined && supplierId !== null) {
    const [s] = await db.select().from(suppliersTable).where(eq(suppliersTable.id, supplierId));
    if (!s) return res.status(400).json({ message: "Supplier not found" });
  }

  const total = (lines as LineInput[]).reduce(
    (s, l) => s + Number(l.quantity) * Number(l.unitCost),
    0,
  );
  const { taxAmount, grandTotal } = await computeTax(total, taxRateId);

  // Retry loop — prevents duplicate doc numbers under concurrent inserts
  let doc: typeof purchaseDocumentsTable.$inferSelect | undefined;
  let docNumber = "";
  for (let attempt = 0; attempt < 5; attempt++) {
    docNumber = await nextDocNumber(docKind, attempt);
    try {
      [doc] = await db
        .insert(purchaseDocumentsTable)
        .values({
          companyId,
          docNumber,
          kind: docKind,
          status: "draft",
          warehouseId: warehouseId ? Number(warehouseId) : null,
          supplierId: supplierId ?? null,
          supplierName,
          supplierAddress: supplierAddress ?? null,
          totalAmount: String(total),
          taxRateId: taxRateId ?? null,
          taxAmount: String(taxAmount),
          grandTotal: String(grandTotal),
          expectedDate: expectedDate ? new Date(expectedDate) : null,
          notes: notes ?? null,
          productCategory: productCategory ? String(productCategory) : null,
          incoterm: incoterm ? String(incoterm) : null,
          deliveryTerm: deliveryTerm ? String(deliveryTerm) : null,
          targetPrice: targetPrice ? String(targetPrice) : null,
          commoditySpecs: commoditySpecs ?? null,
          requiredDocuments: requiredDocuments ?? null,
          categoryKey: categoryKey ? String(categoryKey) : null,
          templateId: templateId ? String(templateId) : null,
          templateVersion: templateVersion ? String(templateVersion) : null,
          templateSnapshot: templateSnapshot ?? null,
        })
        .returning();
      break;
    } catch (e: any) {
      const isUnique = e?.code === "23505" || String(e?.message ?? e).includes("unique");
      if (isUnique && attempt < 4) continue;
      throw e;
    }
  }
  if (!doc) throw new Error("Gagal membuat dokumen pembelian setelah 5 percobaan");

  await db.insert(purchaseDocumentLinesTable).values(
    (lines as LineInput[]).map((l) => ({
      documentId: doc.id,
      productId: l.productId ?? null,
      name: l.name,
      description: l.description ?? null,
      quantity: String(l.quantity),
      unitCost: String(l.unitCost),
      subtotal: String(Number(l.quantity) * Number(l.unitCost)),
    })),
  );

  const detail = await loadDocWithLines(doc.id);

  saveAndBroadcast("purchase_doc_created", {
    type: docKind === "rfq" ? "purchase_rfq" : "purchase_po",
    orderId: doc.id,
    orderNumber: docNumber,
    customerName: supplierName,
    companyName: null,
    grandTotal,
  }).catch(() => {});

  return res.status(201).json(detail);
});

router.put("/documents/:id", async (req, res) => {
  const id = Number(req.params.id);
  if (Number.isNaN(id)) return res.status(400).json({ message: "Invalid id" });
  const existing = await loadDocWithLines(id);
  if (!existing) return res.status(404).json({ message: "Document not found" });
  // IDOR guard
  const companyId = resolveCompanyId(req);
  if (!await assertCompanyAccess(existing.companyId, companyId, req, res, { resourceType: "purchase_document", resourceId: id })) return;

  const { supplierId, supplierName, supplierAddress, expectedDate, notes, lines, kind, taxRateId, warehouseId, productCategory, incoterm, deliveryTerm, targetPrice, commoditySpecs, requiredDocuments, categoryKey, templateId, templateVersion, templateSnapshot } = req.body ?? {};
  const patch: Record<string, unknown> = { updatedAt: new Date() };
  if (typeof supplierName === "string") patch["supplierName"] = supplierName;
  if (supplierAddress !== undefined) patch["supplierAddress"] = supplierAddress ?? null;
  if (supplierId !== undefined) patch["supplierId"] = supplierId;
  if (warehouseId !== undefined) patch["warehouseId"] = warehouseId ? Number(warehouseId) : null;
  if (expectedDate !== undefined) patch["expectedDate"] = expectedDate ? new Date(expectedDate) : null;
  if (notes !== undefined) patch["notes"] = notes;
  if (kind === "rfq" || kind === "order") patch["kind"] = kind;
  if (taxRateId !== undefined) patch["taxRateId"] = taxRateId;
  if (productCategory !== undefined) patch["productCategory"] = productCategory ?? null;
  if (incoterm !== undefined) patch["incoterm"] = incoterm ?? null;
  if (deliveryTerm !== undefined) patch["deliveryTerm"] = deliveryTerm ?? null;
  if (targetPrice !== undefined) patch["targetPrice"] = targetPrice ? String(targetPrice) : null;
  if (commoditySpecs !== undefined) patch["commoditySpecs"] = commoditySpecs ?? null;
  if (requiredDocuments !== undefined) patch["requiredDocuments"] = requiredDocuments ?? null;
  if (categoryKey !== undefined) patch["categoryKey"] = categoryKey ? String(categoryKey) : null;
  if (templateId !== undefined) patch["templateId"] = templateId ? String(templateId) : null;
  if (templateVersion !== undefined) patch["templateVersion"] = templateVersion ? String(templateVersion) : null;
  if (templateSnapshot !== undefined) patch["templateSnapshot"] = templateSnapshot ?? null;

  if (Array.isArray(lines)) {
    const total = (lines as LineInput[]).reduce(
      (s, l) => s + Number(l.quantity) * Number(l.unitCost),
      0,
    );
    const effTaxId = taxRateId !== undefined ? taxRateId : existing.taxRateId;
    const { taxAmount, grandTotal } = await computeTax(total, effTaxId);
    patch["totalAmount"] = String(total);
    patch["taxAmount"] = String(taxAmount);
    patch["grandTotal"] = String(grandTotal);
    await db
      .delete(purchaseDocumentLinesTable)
      .where(eq(purchaseDocumentLinesTable.documentId, id));
    if (lines.length > 0) {
      await db.insert(purchaseDocumentLinesTable).values(
        (lines as LineInput[]).map((l) => ({
          documentId: id,
          productId: l.productId ?? null,
          name: l.name,
          description: l.description ?? null,
          quantity: String(l.quantity),
          unitCost: String(l.unitCost),
          subtotal: String(Number(l.quantity) * Number(l.unitCost)),
        })),
      );
    }
  } else if (taxRateId !== undefined) {
    const total = Number(existing.totalAmount);
    const { taxAmount, grandTotal } = await computeTax(total, taxRateId);
    patch["taxAmount"] = String(taxAmount);
    patch["grandTotal"] = String(grandTotal);
  }

  await db.update(purchaseDocumentsTable).set(patch).where(eq(purchaseDocumentsTable.id, id));
  const detail = await loadDocWithLines(id);
  return res.json(detail);
});

router.delete("/documents/:id", async (req, res) => {
  const id = Number(req.params.id);
  if (Number.isNaN(id)) return res.status(400).json({ message: "Invalid id" });
  // IDOR guard: fetch first, verify ownership before deleting
  const existing = await loadDocWithLines(id);
  if (!existing) return res.status(404).json({ message: "Document not found" });
  const companyId = resolveCompanyId(req);
  if (!await assertCompanyAccess(existing.companyId, companyId, req, res, { resourceType: "purchase_document", resourceId: id })) return;
  const [deleted] = await db
    .delete(purchaseDocumentsTable)
    .where(eq(purchaseDocumentsTable.id, id))
    .returning();
  if (!deleted) return res.status(404).json({ message: "Document not found" });
  return res.json({ message: "Deleted", id });
});

router.post("/documents/:id/action", async (req, res) => {
  const id = Number(req.params.id);
  if (Number.isNaN(id)) return res.status(400).json({ message: "Invalid id" });
  const { action, cancelReason, editReason } = req.body ?? {};
  const actorId = (req.user as { id: string } | undefined)?.id ?? null;
  const [doc] = await db
    .select()
    .from(purchaseDocumentsTable)
    .where(eq(purchaseDocumentsTable.id, id));
  if (!doc) return res.status(404).json({ message: "Document not found" });
  // IDOR guard
  { const _cid = resolveCompanyId(req); if (!await assertCompanyAccess(doc.companyId, _cid, req, res, { resourceType: "purchase_document", resourceId: id })) return; }

  const patch: Record<string, unknown> = { updatedAt: new Date() };
  switch (action) {
    case "send":
      patch["status"] = "sent" satisfies PurchaseStatus;
      break;
    case "confirm":
      patch["status"] = "confirmed" satisfies PurchaseStatus;
      patch["kind"] = "order";
      patch["confirmedAt"] = new Date();
      patch["approvedBy"] = actorId;
      patch["approvedAt"] = new Date();
      patch["receiveStatus"] = "to_receive" satisfies PurchaseReceiveStatus;
      patch["billStatus"] = "to_bill" satisfies PurchaseBillStatus;
      break;
    case "cancel":
      patch["status"] = "cancelled" satisfies PurchaseStatus;
      patch["cancelledAt"] = new Date();
      patch["cancelledBy"] = actorId;
      patch["cancelReason"] = cancelReason ?? null;
      break;
    case "draft":
      patch["status"] = "draft" satisfies PurchaseStatus;
      if (editReason) patch["editReason"] = editReason;
      break;
    case "mark_received":
      patch["receiveStatus"] = "received" satisfies PurchaseReceiveStatus;
      // Payment guard: PO hanya done jika sudah diterima + dibill + dibayar
      // PAYMENT GUARD: PO hanya boleh done jika sudah billed DAN sudah paid
      if (doc.billStatus === "billed" && doc.paymentStatus === "paid") patch["status"] = "done" satisfies PurchaseStatus;
      break;
    case "receive_to_warehouse": {
      // Mark received + post stock movements to wh_stock
      patch["receiveStatus"] = "received" satisfies PurchaseReceiveStatus;
      // Payment guard: PO hanya done jika sudah diterima + dibill + dibayar
      // PAYMENT GUARD: PO hanya boleh done jika sudah billed DAN sudah paid
      if (doc.billStatus === "billed" && doc.paymentStatus === "paid") patch["status"] = "done" satisfies PurchaseStatus;
      break;
    }
    case "mark_billed": {
      // Auto-numbering: BILL/YYYY/NNNN
      const billYear = new Date().getFullYear();
      const [{ billCount }] = await db
        .select({ billCount: sql<number>`cast(count(*) as int)` })
        .from(purchaseDocumentsTable)
        .where(sql`bill_number IS NOT NULL`);
      const billSeq = (Number(billCount) + 1).toString().padStart(4, "0");
      const billNumber = `BILL/${billYear}/${billSeq}`;
      const billDate = new Date().toISOString().split("T")[0]!;
      // Auto due date: billDate + paymentTermDays (default 30)
      const termDays = Number((doc as Record<string, unknown>)["paymentTermDays"] ?? 30);
      const dueDate = new Date(Date.now() + termDays * 24 * 60 * 60 * 1000).toISOString().split("T")[0]!;
      patch["billStatus"] = "billed" satisfies PurchaseBillStatus;
      patch["billNumber"] = billNumber;
      patch["billDate"] = billDate;
      patch["dueDate"] = dueDate;
      // PAYMENT GUARD: PO hanya boleh done jika sudah received DAN sudah paid
      if (doc.receiveStatus === "received" && doc.paymentStatus === "paid") patch["status"] = "done" satisfies PurchaseStatus;
      break;
    }
    case "cancel_bill": {
      if (doc.billStatus !== "billed") {
        return res.status(400).json({ message: "Hanya bill yang sudah diposting yang bisa dibatalkan" });
      }
      patch["billStatus"] = "to_bill" satisfies PurchaseBillStatus;
      patch["billNumber"] = null;
      patch["billDate"] = null;
      patch["dueDate"] = null;
      patch["cancelledBy"] = actorId;
      patch["cancelReason"] = cancelReason ?? null;
      // Kembalikan status ke confirmed jika sebelumnya done
      if (doc.status === "done") patch["status"] = "confirmed" satisfies PurchaseStatus;
      break;
    }
    case "send_reminder":
      // Fire-and-forget: no status changes, only notifications
      break;
    default:
      return res.status(400).json({ message: "Invalid action" });
  }

  await db.update(purchaseDocumentsTable).set(patch).where(eq(purchaseDocumentsTable.id, id));

  // T004: When PO is received, post stock-in movements to wh_stock AND inventory_stock (fire-and-forget)
  if ((action === "mark_received" || action === "receive_to_warehouse") && doc.receiveStatus !== "received") {
    void (async () => {
      try {
        const lines = await db.select().from(purchaseDocumentLinesTable).where(eq(purchaseDocumentLinesTable.documentId, id));
        const productLines = lines.filter((l) => l.productId != null);
        if (productLines.length === 0) return;
        // POS warehouse (wh_stock)
        const docWarehouseId = (doc as any).warehouseId ?? null;
        let posWhId: number | undefined = docWarehouseId ? Number(docWarehouseId) : undefined;
        if (!posWhId) {
          const defaultWhResult = await db.execute(sql`SELECT id FROM warehouses WHERE is_active = TRUE ORDER BY id LIMIT 1`);
          const wh = defaultWhResult.rows[0] as any;
          posWhId = wh?.id;
        }
        // ERP warehouse (inventory_stock)
        const erpWhRow = (await db.execute(sql`SELECT id FROM warehouses WHERE is_active = TRUE ORDER BY id LIMIT 1`)).rows[0] as { id: number } | undefined;
        const erpWhId: number | undefined = erpWhRow?.id;

        for (const line of productLines) {
          const qty = Number(line.quantity);
          const costPrice = Number(line.unitCost);

          // ── wh_stock (POS/legacy) ──────────────────────────────────────────
          if (posWhId) {
            const docCompanyId = (doc as any).companyId ?? null;
            const cur = await db.execute(sql`
              SELECT qty::float FROM wh_stock WHERE product_id = ${line.productId} AND warehouse_id = ${posWhId} AND rack_id IS NULL
            `);
            const qtyBefore = Number((cur.rows[0] as any)?.qty ?? 0);
            const qtyAfter = qtyBefore + qty;
            await db.execute(sql`
              INSERT INTO wh_stock (company_id, product_id, warehouse_id, rack_id, qty, cost_price, updated_at)
              VALUES (${docCompanyId}, ${line.productId}, ${posWhId}, NULL, ${qtyAfter}, ${costPrice}, NOW())
              ON CONFLICT ON CONSTRAINT wh_stock_product_warehouse_rack_idx
              DO UPDATE SET company_id = COALESCE(wh_stock.company_id, ${docCompanyId}), qty = ${qtyAfter}, cost_price = ${costPrice}, updated_at = NOW()
            `);
            await db.execute(sql`
              INSERT INTO wh_movements (company_id, product_id, warehouse_id, rack_id, type, qty, qty_before, qty_after, cost_price, ref_type, ref_id, note)
              VALUES (${docCompanyId}, ${line.productId}, ${posWhId}, NULL, 'po_receipt', ${qty}, ${qtyBefore}, ${qtyAfter}, ${costPrice},
                      'purchase_order', ${id}, ${`PO Diterima: ${doc.docNumber}`})
            `);
          }

          // ── inventory_stock (ERP — enables SO pre-flight check) ───────────
          if (erpWhId) {
            await postStockIn({
              productId: line.productId!,
              warehouseId: erpWhId,
              qty,
              unitCost: costPrice,
              movementType: "PO_RECEIPT",
              referenceType: "PURCHASE_ORDER",
              referenceId: id,
              notes: `PO Diterima: ${doc.docNumber}`,
            }).catch((e) => console.error("[inventory] postStockIn PO error:", e));
          }
        }
      } catch (e) {
        console.error("[wh] mark_received stock-in error:", e);
      }
    })();
  }

  if (action === "mark_billed" && doc.billStatus !== "billed") {
    const taxAmount = Number(doc.taxAmount ?? 0);
    void (async () => {
      try {
        // Cek apakah Vendor PO dari logistic marketplace service
        const poSnap = doc.templateSnapshot as Record<string, unknown> | null;
        const vendorCostSnap = poSnap?.vendorCostSnapshot as Record<string, unknown> | null;
        const isLogisticMarketplacePO = !!vendorCostSnap && poSnap?.createdFrom === "vendor_fulfillment";

        if (isLogisticMarketplacePO) {
          // Logistic marketplace PO: post COGS per serviceType (dari vendorCostSnapshot, BUKAN priceSell)
          // Idempotent: jika sudah diposting saat confirm, source+sourceId dedup akan skip
          await postLogisticVendorCostJournal({
            vendorPoId:   doc.id,
            docNumber:    doc.docNumber,
            supplierName: doc.supplierName,
            vendorId:     doc.supplierId ?? null,
            serviceType:  (poSnap?.serviceType as string | null) ?? null,
            vendorCostSnapshot: {
              vendorCost: Number(vendorCostSnap.vendorCost ?? 0),
              currency:   vendorCostSnap.currency as string | undefined,
              unit:       vendorCostSnap.unit as string | undefined,
              source:     vendorCostSnap.source as string | undefined,
            },
            refs: {
              vendorFulfillmentId: (poSnap?.fulfillmentId as number | null) ?? null,
              orderId:             (poSnap?.orderId as number | null) ?? null,
              orderItemId:         (poSnap?.orderItemId as number | null) ?? null,
              vendorCatalogItemId: (poSnap?.vendorCatalogItemId as number | null) ?? null,
            },
            companyId: doc.companyId ?? null,
          });
        } else {
          // Regular PO: generic purchase bill journal (DR expense / CR AP)
          const billLines = await db
            .select({
              productId: purchaseDocumentLinesTable.productId,
              unitCost: purchaseDocumentLinesTable.unitCost,
              quantity: purchaseDocumentLinesTable.quantity,
            })
            .from(purchaseDocumentLinesTable)
            .where(eq(purchaseDocumentLinesTable.documentId, id));
          await postPurchaseBill({
            purchaseDocId: doc.id,
            docNumber: doc.docNumber,
            supplierName: doc.supplierName,
            docLines: billLines.map((l) => ({
              productId: l.productId,
              unitCost: Number(l.unitCost),
              quantity: Number(l.quantity),
            })),
            taxAmount,
            taxAccountId: null,
            companyId: doc.companyId ?? null,
          });
        }
        if (taxAmount > 0 && doc.companyId != null) {
          const { recordTransactionTax } = await import("../lib/taxAutoService.js");
          const grandTotalPO = Number(doc.grandTotal ?? doc.totalAmount ?? 0);
          const baseAmountPO = grandTotalPO > taxAmount ? grandTotalPO - taxAmount : Number(doc.totalAmount ?? 0);
          void recordTransactionTax({
            companyId: doc.companyId,
            transactionType: "purchase_order",
            transactionId: doc.id,
            transactionRef: doc.docNumber,
            baseAmount: baseAmountPO,
            taxAmount,
          });
        } else if (taxAmount > 0) {
          console.warn(`[purchase] tax capture skipped for ${doc.docNumber}: company context is missing`);
        }
        // Notifikasi WA admin setelah bill diposting
        const grandTotal = Number(doc.grandTotal ?? doc.totalAmount ?? 0);
        const billYear = new Date().getFullYear();
        const [{ billCount }] = await db
          .select({ billCount: sql<number>`cast(count(*) as int)` })
          .from(purchaseDocumentsTable)
          .where(sql`bill_number IS NOT NULL`);
        const billNum = patch["billNumber"] as string ?? `BILL/${billYear}/${String(Number(billCount)).padStart(4, "0")}`;
        const waMsg = `🧾 *Bill Pembelian Diposting*\nNo: ${billNum}\nPO: ${doc.docNumber}\nSupplier: ${doc.supplierName}\nTotal: Rp ${grandTotal.toLocaleString("id-ID")}`;
        notifyAdminWa(waMsg, "bill_posted", "purchase_document", String(doc.id));

        // Email ke supplier
        if (isSmtpConfigured() && doc.supplierId) {
          const supRows = await db.select().from(suppliersTable).where(eq(suppliersTable.id, doc.supplierId)).limit(1);
          const sup = supRows[0] ?? null;
          const supplierEmail = sup?.contactEmail;
          if (supplierEmail) {
            const billLines = await db
              .select({
                productId: purchaseDocumentLinesTable.productId,
                description: purchaseDocumentLinesTable.description,
                quantity: purchaseDocumentLinesTable.quantity,
                unitCost: purchaseDocumentLinesTable.unitCost,
                subtotal: purchaseDocumentLinesTable.subtotal,
              })
              .from(purchaseDocumentLinesTable)
              .where(eq(purchaseDocumentLinesTable.documentId, doc.id));
            const lineItems = billLines
              .map((l) => {
                const label = l.description ?? `Produk #${l.productId}`;
                return (
                  `<tr><td style="padding:4px 8px;border:1px solid #ddd;">${label}</td>` +
                  `<td style="padding:4px 8px;border:1px solid #ddd;text-align:right;">${Number(l.quantity).toLocaleString("id-ID")}</td>` +
                  `<td style="padding:4px 8px;border:1px solid #ddd;text-align:right;">Rp ${Number(l.unitCost).toLocaleString("id-ID")}</td>` +
                  `<td style="padding:4px 8px;border:1px solid #ddd;text-align:right;">Rp ${Number(l.subtotal ?? 0).toLocaleString("id-ID")}</td></tr>`
                );
              })
              .join("");
            const taxAmount = Number(doc.taxAmount ?? 0);
            const html = `
<p>Kepada Yth. ${doc.supplierName ?? sup?.name ?? "Supplier"},</p>
<p>Berikut konfirmasi <strong>Bill Pembelian ${billNum}</strong> atas Purchase Order <strong>${doc.docNumber}</strong>:</p>
<table style="border-collapse:collapse;width:100%;font-family:sans-serif;font-size:14px;">
  <thead>
    <tr style="background:#f5f5f5;">
      <th style="padding:6px 8px;border:1px solid #ddd;text-align:left;">Deskripsi</th>
      <th style="padding:6px 8px;border:1px solid #ddd;text-align:right;">Qty</th>
      <th style="padding:6px 8px;border:1px solid #ddd;text-align:right;">Harga Satuan</th>
      <th style="padding:6px 8px;border:1px solid #ddd;text-align:right;">Total</th>
    </tr>
  </thead>
  <tbody>${lineItems}</tbody>
  <tfoot>
    ${taxAmount ? `<tr><td colspan="3" style="padding:4px 8px;border:1px solid #ddd;text-align:right;">PPN</td><td style="padding:4px 8px;border:1px solid #ddd;text-align:right;">Rp ${taxAmount.toLocaleString("id-ID")}</td></tr>` : ""}
    <tr>
      <td colspan="3" style="padding:6px 8px;border:1px solid #ddd;text-align:right;font-weight:bold;">Grand Total</td>
      <td style="padding:6px 8px;border:1px solid #ddd;text-align:right;font-weight:bold;">Rp ${grandTotal.toLocaleString("id-ID")}</td>
    </tr>
  </tfoot>
</table>
<p>Mohon konfirmasi penerimaan bill ini. Terima kasih.</p>`;
            const text = `Bill Pembelian ${billNum}\nPO: ${doc.docNumber}\nSupplier: ${doc.supplierName}\nTotal: Rp ${grandTotal.toLocaleString("id-ID")}`;
            await sendMail({
              to: supplierEmail,
              subject: `Konfirmasi Bill Pembelian - ${billNum}`,
              html,
              text,
              context: "bill_posted",
              refType: "purchase_document",
              refId: String(doc.id),
            }).catch((e: unknown) => console.error("[bill email]", e));
          }
        }
      } catch (e) {
        console.error("[accounting] postPurchaseBill error:", e);
      }
    })();
  }

  if (action === "send_reminder") {
    void (async () => {
      try {
        const billRef = (doc as any).billNumber ?? doc.docNumber;
        const dueDate = (doc as any).dueDate ? new Date((doc as any).dueDate) : null;
        const today = new Date();
        const daysOverdue = dueDate ? Math.floor((today.getTime() - dueDate.getTime()) / 86_400_000) : 0;
        const dueDateStr = dueDate
          ? dueDate.toLocaleDateString("id-ID", { day: "2-digit", month: "long", year: "numeric" })
          : "—";
        const totalAmount = Number(doc.grandTotal ?? doc.totalAmount ?? 0);
        const amountStr = `Rp ${Math.round(totalAmount).toLocaleString("id-ID")}`;

        let supplierEmail: string | null = null;
        let supplierPhone: string | null = null;
        if (doc.supplierId) {
          const [sup] = await db.select({ contactEmail: suppliersTable.contactEmail, phone: suppliersTable.phone })
            .from(suppliersTable).where(eq(suppliersTable.id, doc.supplierId)).limit(1);
          supplierEmail = sup?.contactEmail ?? null;
          supplierPhone = sup?.phone ?? null;
        }

        const adminGroupWa = await getAdminGroupWa();
        if (adminGroupWa) {
          const msg = `🔔 *Reminder Pembayaran Vendor*\n\nBill: *${billRef}*\nSupplier: ${doc.supplierName}\nJumlah: ${amountStr}\nJatuh Tempo: ${dueDateStr}${daysOverdue > 0 ? ` (${daysOverdue} hari)` : ""}\n\nReminder dikirim secara manual.`;
          await sendWhatsApp(adminGroupWa, msg, { context: `bill_reminder_manual_${billRef}`, refType: "purchase_bill", refId: billRef });
        }
        if (supplierPhone) {
          const msg = `Kepada Yth. *${doc.supplierName}*,\n\nPengingat: *${billRef}* telah jatuh tempo.\nJumlah: ${amountStr}\nJatuh Tempo: ${dueDateStr}\n\nPembayaran sedang kami proses. Terima kasih 🙏`;
          await sendWhatsApp(supplierPhone, msg, { context: `bill_reminder_supplier_${billRef}`, refType: "purchase_bill", refId: billRef });
        }
        if (supplierEmail && isSmtpConfigured()) {
          sendMail({
            to: supplierEmail,
            subject: `Informasi Pembayaran — Bill ${billRef}`,
            text: `Kepada Yth. ${doc.supplierName},\n\nBill ${billRef} telah jatuh tempo.\nJumlah: ${amountStr}\nJatuh Tempo: ${dueDateStr}\n\nPembayaran sedang kami proses.\n\nTerima kasih,\nTim Finance`,
            html: `<p>Kepada Yth. <strong>${doc.supplierName}</strong>,</p><p>Bill <strong>${billRef}</strong> telah jatuh tempo.</p><ul><li>Jumlah: <strong>${amountStr}</strong></li><li>Jatuh Tempo: ${dueDateStr}</li></ul><p>Pembayaran sedang kami proses.</p><p>Terima kasih,<br>Tim Finance</p>`,
            context: `bill_reminder_email_${billRef}`,
            refType: "purchase_bill",
            refId: billRef,
          }).catch(() => {});
        }
      } catch (e) { console.error("[send_reminder purchase]", e); }
    })();
  }

  if (action === "cancel_bill" && doc.billStatus === "billed") {
    void (async () => {
      try {
        await postPurchaseBillReversal({
          purchaseDocId: doc.id,
          docNumber: doc.docNumber,
          supplierName: doc.supplierName,
          companyId: doc.companyId ?? null,
        });
        const waMsg = `❌ *Bill Pembelian Dibatalkan*\nPO: ${doc.docNumber}\nSupplier: ${doc.supplierName}\nJurnal reversal telah diposting.`;
        notifyAdminWa(waMsg, "bill_cancelled", "purchase_document", String(doc.id));
      } catch (e) {
        console.error("[accounting] postPurchaseBillReversal error:", e);
      }
    })();
  }

  // ── Trigger COGS journal saat Vendor PO di-confirm (approved) ────────────────
  // Hanya untuk logistic marketplace PO yang punya vendorCostSnapshot.
  // Idempotent: source="logistic_vendor_cost" + sourceId=poId — jika sudah dipost saat
  // mark_billed, postEntry akan skip duplikat.
  if (action === "confirm" && doc.status !== "confirmed") {
    const poSnap = doc.templateSnapshot as Record<string, unknown> | null;
    const vendorCostSnap = poSnap?.vendorCostSnapshot as Record<string, unknown> | null;
    if (vendorCostSnap && poSnap?.createdFrom === "vendor_fulfillment") {
      void postLogisticVendorCostJournal({
        vendorPoId:   doc.id,
        docNumber:    doc.docNumber,
        supplierName: doc.supplierName,
        vendorId:     doc.supplierId ?? null,
        serviceType:  (poSnap?.serviceType as string | null) ?? null,
        vendorCostSnapshot: {
          vendorCost: Number(vendorCostSnap.vendorCost ?? 0),
          currency:   vendorCostSnap.currency as string | undefined,
          unit:       vendorCostSnap.unit as string | undefined,
          source:     vendorCostSnap.source as string | undefined,
        },
        refs: {
          vendorFulfillmentId: (poSnap?.fulfillmentId as number | null) ?? null,
          orderId:             (poSnap?.orderId as number | null) ?? null,
          orderItemId:         (poSnap?.orderItemId as number | null) ?? null,
          vendorCatalogItemId: (poSnap?.vendorCatalogItemId as number | null) ?? null,
        },
        companyId: doc.companyId ?? null,
      }).catch((e) => console.error("[accounting] postLogisticVendorCostJournal confirm error:", e));
    }
  }

  const detail = await loadDocWithLines(id);

  if (action === "confirm") {
    saveAndBroadcast("purchase_doc_confirmed", {
      type: "purchase_po",
      orderId: id,
      orderNumber: detail?.docNumber ?? doc.docNumber,
      customerName: doc.supplierName,
      companyName: null,
      grandTotal: Number(doc.grandTotal ?? doc.totalAmount ?? 0),
    }).catch(() => {});
  }

  return res.json(detail);
});

router.get("/documents/:id/pdf", async (req, res): Promise<void> => {
  const id = Number(req.params.id);
  if (Number.isNaN(id)) { res.status(400).json({ message: "Invalid id" }); return; }
  const detail = await loadDocWithLines(id);
  if (!detail) { res.status(404).json({ message: "Document not found" }); return; }
  // IDOR guard
  { const _cid = resolveCompanyId(req); if (!await assertCompanyAccess(detail.companyId, _cid, req, res, { resourceType: "purchase_document", resourceId: id })) return; }
  let supplier: typeof suppliersTable.$inferSelect | null = null;
  if (detail.supplierId) {
    const rows = await db.select().from(suppliersTable).where(eq(suppliersTable.id, detail.supplierId)).limit(1);
    supplier = rows[0] ?? null;
  }
  const tplType = detail.kind === "rfq" ? "quotation" : "po";
  const [acctSettings, template] = await Promise.all([
    ensureAccountingSettings(),
    loadDocTemplate(tplType),
  ]);
  const titleMap: Record<string, string> = {
    rfq: "REQUEST FOR QUOTATION",
    order: "PURCHASE ORDER",
  };
  streamInvoicePdf(res, {
    title: titleMap[detail.kind] ?? "DOKUMEN PEMBELIAN",
    docNumber: detail.docNumber,
    status: detail.status,
    kind: detail.kind,
    companyName: acctSettings.companyName,
    companyAddress: acctSettings.companyAddress,
    companyNpwp: acctSettings.companyNpwp,
    partyLabel: "Vendor",
    partyName: detail.supplierName,
    partyEmail: supplier?.contactEmail ?? null,
    partyAddress: detail.supplierAddress ?? null,
    partyTaxId: supplier?.taxId ?? null,
    validUntil: null,
    expectedDate: detail.expectedDate,
    confirmedAt: detail.confirmedAt,
    createdAt: detail.createdAt,
    notes: detail.notes,
    lines: detail.lines.map((l: any) => ({
      name: l.name,
      description: l.description,
      quantity: Number(l.quantity),
      unitPrice: Number(l.unitCost ?? l.unitPrice ?? 0),
      subtotal: Number(l.subtotal),
    })),
    totalAmount: Number(detail.totalAmount),
    receiveStatus: detail.receiveStatus,
    billStatus: detail.billStatus,
    template,
  });
});

router.post("/documents/:id/email", async (req, res): Promise<void> => {
  const id = Number(req.params.id);
  if (Number.isNaN(id)) { res.status(400).json({ message: "Invalid id" }); return; }

  if (!isSmtpConfigured()) {
    res.status(503).json({ message: "Email belum dikonfigurasi. Hubungi administrator untuk mengatur SMTP." });
    return;
  }

  const { to, subject, body } = req.body as { to?: string; subject?: string; body?: string };
  if (!to || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(to)) {
    res.status(400).json({ message: "Alamat email tujuan tidak valid" });
    return;
  }

  const detail = await loadDocWithLines(id);
  if (!detail) { res.status(404).json({ message: "Document not found" }); return; }
  // IDOR guard
  { const _cid = resolveCompanyId(req); if (!await assertCompanyAccess(detail.companyId, _cid, req, res, { resourceType: "purchase_document", resourceId: id })) return; }

  let supplier: typeof suppliersTable.$inferSelect | null = null;
  if (detail.supplierId) {
    const rows = await db.select().from(suppliersTable).where(eq(suppliersTable.id, detail.supplierId)).limit(1);
    supplier = rows[0] ?? null;
  }

  const tplType2 = detail.kind === "rfq" ? "quotation" : "po";
  const [acctSettings, template2] = await Promise.all([
    ensureAccountingSettings(),
    loadDocTemplate(tplType2),
  ]);
  const titleMap: Record<string, string> = { rfq: "REQUEST FOR QUOTATION", order: "PURCHASE ORDER" };
  const pdfData = {
    title: titleMap[detail.kind] ?? "DOKUMEN PEMBELIAN",
    docNumber: detail.docNumber,
    status: detail.status,
    kind: detail.kind,
    companyName: acctSettings.companyName,
    companyAddress: acctSettings.companyAddress,
    companyNpwp: acctSettings.companyNpwp,
    partyLabel: "Vendor",
    partyName: detail.supplierName,
    partyEmail: supplier?.contactEmail ?? null,
    partyAddress: detail.supplierAddress ?? null,
    partyTaxId: supplier?.taxId ?? null,
    validUntil: null,
    expectedDate: detail.expectedDate,
    confirmedAt: detail.confirmedAt,
    createdAt: detail.createdAt,
    notes: detail.notes,
    lines: detail.lines.map((l: any) => ({
      name: l.name,
      description: l.description,
      quantity: Number(l.quantity),
      unitPrice: Number(l.unitCost ?? l.unitPrice ?? 0),
      subtotal: Number(l.subtotal),
    })),
    totalAmount: Number(detail.totalAmount),
    receiveStatus: detail.receiveStatus,
    billStatus: detail.billStatus,
    template: template2,
  };

  const pdfBuffer = await buildInvoicePdfBuffer(pdfData);
  const filename = `${detail.docNumber.replace(/[\\/]/g, "-")}.pdf`;
  const emailSubject = subject?.trim() || `${pdfData.title} ${detail.docNumber}`;
  const emailBody = body?.trim() || `Terlampir ${pdfData.title} ${detail.docNumber} dari BizPortal.`;

  await sendMail({
    to,
    subject: emailSubject,
    text: emailBody,
    html: `<p>${emailBody.replace(/\n/g, "<br>")}</p>`,
    attachments: [{ filename, content: pdfBuffer, contentType: "application/pdf" }],
  });

  res.json({ message: "Email berhasil dikirim", to, filename });
});

router.post("/documents/:id/generate-vendor-token", async (req, res) => {
  const id = Number(req.params.id);
  if (Number.isNaN(id)) return res.status(400).json({ message: "Invalid id" });

  const sendWa = req.body?.sendWa === true;

  const [doc] = await db.select().from(purchaseDocumentsTable).where(eq(purchaseDocumentsTable.id, id));
  if (!doc) return res.status(404).json({ message: "Document not found" });
  // IDOR guard
  { const _cid = resolveCompanyId(req); if (!await assertCompanyAccess(doc.companyId, _cid, req, res, { resourceType: "purchase_document", resourceId: id })) return; }
  if (doc.kind !== "order") return res.status(400).json({ message: "Hanya PO yang bisa dibuat link vendor accept" });

  const baseUrl = `https://${getRequiredPublicDomain()}`;

  const existingToken = (doc as any).vendor_accept_token as string | null | undefined;
  const token = existingToken ?? randomBytes(24).toString("hex");

  if (!existingToken) {
    await db.execute(sql`UPDATE purchase_documents SET vendor_accept_token = ${token} WHERE id = ${id}`);
  }

  const url = `${baseUrl}/vendor-po-accept/${token}`;

  // Lookup supplier phone
  let waTarget: string | null = null;
  let waSent = false;
  if (doc.supplierId) {
    const [sup] = await db.select({ phone: suppliersTable.phone, name: suppliersTable.name })
      .from(suppliersTable).where(eq(suppliersTable.id, doc.supplierId)).limit(1);
    waTarget = sup?.phone ?? null;
  }

  if (sendWa && waTarget) {
    const msgLines = [
      `📋 *Konfirmasi Purchase Order*`,
      ``,
      `Kepada Yth. *${doc.supplierName ?? "Vendor"}*,`,
      ``,
      `Kami mengirimkan Purchase Order berikut untuk dikonfirmasi:`,
      `• *No PO*: ${doc.docNumber ?? "-"}`,
      `• *Total*: Rp ${Number(doc.grandTotal ?? doc.totalAmount ?? 0).toLocaleString("id-ID")}`,
      ``,
      `Silakan buka link berikut untuk melihat detail PO dan mengkonfirmasi penerimaan:`,
      url,
      ``,
      `Terima kasih.`,
    ];
    sendWhatsApp(waTarget, msgLines.join("\n"), {
      context: "purchase_vendor_accept",
      refType: "purchase_document",
      refId: String(id),
    }).catch(() => undefined);
    waSent = true;
  }

  return res.json({ token, url, waSent, waTarget, waAvailable: !!waTarget });
});

router.get("/po-detail/:id", async (req, res) => {
  const id = Number(req.params.id);
  if (Number.isNaN(id)) return res.status(400).json({ message: "Invalid id" });

  const doc = await loadDocWithLines(id);
  if (!doc) return res.status(404).json({ message: "Not found" });
  // IDOR guard
  { const _cid = resolveCompanyId(req); if (!await assertCompanyAccess(doc.companyId, _cid, req, res, { resourceType: "purchase_document", resourceId: id })) return; }

  const grs = await db.select().from(goodsReceiptsTable)
    .where(eq(goodsReceiptsTable.poId, id))
    .orderBy(desc(goodsReceiptsTable.createdAt));

  const vis = await db.select().from(vendorInvoicesTable)
    .where(eq(vendorInvoicesTable.poId, id))
    .orderBy(desc(vendorInvoicesTable.createdAt));

  const grIds = grs.map((g) => g.id);
  const viIds = vis.map((v) => v.id);

  let journalEntries: object[] = [];
  const entryConds: ReturnType<typeof and>[] = [];
  if (viIds.length > 0) {
    entryConds.push(and(
      sql`${accountingEntriesTable.source} = 'purchase_bill'`,
      inArray(accountingEntriesTable.sourceId, viIds),
    )!);
  }
  entryConds.push(and(
    sql`${accountingEntriesTable.source} = 'purchase_bill'`,
    eq(accountingEntriesTable.sourceId, id),
  )!);
  if (grIds.length > 0) {
    entryConds.push(and(
      sql`${accountingEntriesTable.source} = 'grn_receipt'`,
      inArray(accountingEntriesTable.sourceId, grIds),
    )!);
  }

  const entries = await db.select().from(accountingEntriesTable)
    .where(or(...entryConds))
    .orderBy(desc(accountingEntriesTable.createdAt));

  if (entries.length > 0) {
    const entryIds = entries.map((e) => e.id);
    const lines = await db.select({
      id: accountingEntryLinesTable.id,
      entryId: accountingEntryLinesTable.entryId,
      description: accountingEntryLinesTable.description,
      debit: accountingEntryLinesTable.debit,
      credit: accountingEntryLinesTable.credit,
      accountId: accountingEntryLinesTable.accountId,
      accountCode: chartOfAccountsTable.code,
      accountName: chartOfAccountsTable.name,
    }).from(accountingEntryLinesTable)
      .leftJoin(chartOfAccountsTable, eq(accountingEntryLinesTable.accountId, chartOfAccountsTable.id))
      .where(inArray(accountingEntryLinesTable.entryId, entryIds));

    journalEntries = entries.map((e) => ({
      id: e.id,
      entryNumber: e.entryNumber,
      date: e.date ? String(e.date) : null,
      description: e.description,
      status: e.status,
      source: e.source,
      sourceId: e.sourceId,
      totalDebit: Number(e.totalDebit ?? 0),
      totalCredit: Number(e.totalCredit ?? 0),
      createdAt: e.createdAt?.toISOString(),
      lines: lines
        .filter((l) => l.entryId === e.id)
        .map((l) => ({
          id: l.id,
          entryId: l.entryId,
          description: l.description,
          debit: Number(l.debit ?? 0),
          credit: Number(l.credit ?? 0),
          accountId: l.accountId,
          accountCode: l.accountCode,
          accountName: l.accountName,
        })),
    }));
  }

  return res.json({
    ...doc,
    goodsReceipts: grs.map((g) => ({
      ...g,
      receivedAt: (g as any).receiveDate instanceof Date ? (g as any).receiveDate.toISOString() : ((g as any).receiveDate ?? null),
      createdAt: g.createdAt.toISOString(),
      updatedAt: g.updatedAt.toISOString(),
    })),
    vendorInvoices: vis.map((v) => ({
      ...v,
      grandTotal: Number(v.grandTotal),
      totalAmount: Number(v.totalAmount),
      taxAmount: Number(v.taxAmount ?? 0),
      amountPaid: Number(v.amountPaid ?? 0),
      invoiceDate: v.invoiceDate instanceof Date ? v.invoiceDate.toISOString() : (v.invoiceDate ?? null),
      dueDate: v.dueDate instanceof Date ? v.dueDate.toISOString() : (v.dueDate ?? null),
      cancelledAt: v.cancelledAt instanceof Date ? v.cancelledAt.toISOString() : (v.cancelledAt ?? null),
      createdAt: v.createdAt.toISOString(),
      updatedAt: v.updatedAt.toISOString(),
    })),
    journalEntries,
  });
});

export default router;
