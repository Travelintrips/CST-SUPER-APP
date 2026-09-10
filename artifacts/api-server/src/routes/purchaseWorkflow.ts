import { Router } from "express";
import { requireAdmin } from "../lib/requireAdmin.js";
import { ensureAccountingSettings } from "../lib/accountingSeed.js";
import { postEntry, postPurchaseReturn } from "../lib/accounting.js";
import {
  db,
  purchaseRequestsTable,
  purchaseRequestLinesTable,
  purchaseApprovalsTable,
  vendorQuotationsTable,
  vendorQuotationLinesTable,
  goodsReceiptsTable,
  goodsReceiptLinesTable,
  qcInspectionsTable,
  qcLinesTable,
  purchaseReturnsTable,
  purchaseReturnLinesTable,
  vendorInvoicesTable,
  vendorInvoiceLinesTable,
  paymentRequestsTable,
  paymentRequestItemsTable,
  landedCostsTable,
  landedCostLinesTable,
  landedCostAllocationsTable,
  uomMasterTable,
  uomConversionsTable,
  purchaseDocumentsTable,
  purchaseDocumentLinesTable,
  productTemplatesTable,
  suppliersTable,
  productsTable,
  accountingSettingsTable,
  whStockTable,
  whMovementsTable,
} from "@workspace/db";
import { eq, desc, and, sql, inArray } from "drizzle-orm";
import { getInCodeTemplate, resolveTemplate, type ProductTemplateOverride } from "@workspace/product-templates";

const router = Router();

router.use(async (req, res, next) => {
  if (!(await requireAdmin(req, res))) return;
  next();
});

// ── Helpers ────────────────────────────────────────────────────────────────────

function num(v: unknown): number { return Number(v ?? 0); }
function idr(n: number): string { return n.toFixed(2); }

async function nextSeq(table: string, prefix: string, col: string): Promise<string> {
  const year = new Date().getFullYear();
  const pattern = `${prefix}/${year}/%`;
  const result = await db.execute(
    sql`SELECT COALESCE(MAX(CAST(SPLIT_PART(${sql.identifier(col)}, '/', 3) AS int)), 0) AS seq FROM ${sql.identifier(table)} WHERE ${sql.identifier(col)} LIKE ${pattern}`
  );
  const row = (result as any).rows?.[0] ?? (Array.isArray(result) ? result[0] : undefined);
  const seq = (Number(row?.seq ?? 0) + 1).toString().padStart(5, "0");
  return `${prefix}/${year}/${seq}`;
}

function resolveCompanyId(req: { query: Record<string, unknown>; body: Record<string, unknown> }): number {
  const raw = (req.query["company"] ?? req.query["companyId"] ?? req.body["companyId"]) as string | undefined;
  const n = raw ? parseInt(String(raw), 10) : NaN;
  return Number.isNaN(n) ? 1 : n;
}

// Boot migration: add template columns to purchase_requests
db.execute(sql`
  ALTER TABLE purchase_requests ADD COLUMN IF NOT EXISTS category_key TEXT;
  ALTER TABLE purchase_requests ADD COLUMN IF NOT EXISTS template_id TEXT;
  ALTER TABLE purchase_requests ADD COLUMN IF NOT EXISTS template_version TEXT;
  ALTER TABLE purchase_requests ADD COLUMN IF NOT EXISTS template_snapshot JSONB;
`).catch((e: unknown) => console.warn("[purchase_requests] boot migration warn:", e));

// ─────────────────────────────────────────────────────────────────────────────
// UOM
// ─────────────────────────────────────────────────────────────────────────────

router.get("/uom", async (_req, res) => {
  const rows = await db.select().from(uomMasterTable).orderBy(uomMasterTable.name);
  res.json(rows);
});

router.post("/uom", async (req, res) => {
  const { name, symbol, category } = req.body as Record<string, string>;
  const [row] = await db.insert(uomMasterTable).values({ name, symbol, category: category ?? "unit" }).returning();
  res.json(row);
});

router.delete("/uom/:id", async (req, res) => {
  await db.delete(uomMasterTable).where(eq(uomMasterTable.id, Number(req.params.id)));
  res.json({ ok: true });
});

router.get("/uom/conversions", async (_req, res) => {
  const rows = await db.select().from(uomConversionsTable);
  res.json(rows);
});

router.post("/uom/conversions", async (req, res) => {
  const { fromUomId, toUomId, factor } = req.body as Record<string, unknown>;
  const [row] = await db.insert(uomConversionsTable).values({ fromUomId: Number(fromUomId), toUomId: Number(toUomId), factor: String(factor ?? "1") }).onConflictDoNothing().returning();
  res.json(row);
});

// ─────────────────────────────────────────────────────────────────────────────
// PURCHASE REQUESTS
// ─────────────────────────────────────────────────────────────────────────────

router.get("/pr", async (req, res) => {
  const companyId = resolveCompanyId(req as Parameters<typeof resolveCompanyId>[0]);
  const rows = await db.select().from(purchaseRequestsTable)
    .where(eq(purchaseRequestsTable.companyId, companyId))
    .orderBy(desc(purchaseRequestsTable.createdAt));
  res.json(rows);
});

router.get("/pr/:id", async (req, res) => {
  const id = Number(req.params.id);
  const [pr] = await db.select().from(purchaseRequestsTable).where(eq(purchaseRequestsTable.id, id));
  if (!pr) { res.status(404).json({ error: "Not found" }); return; }
  const lines = await db.select().from(purchaseRequestLinesTable).where(eq(purchaseRequestLinesTable.prId, id));
  const approvals = await db.select().from(purchaseApprovalsTable)
    .where(and(eq(purchaseApprovalsTable.docType, "PR"), eq(purchaseApprovalsTable.docId, id)))
    .orderBy(purchaseApprovalsTable.step);
  res.json({ ...pr, lines, approvals });
});

router.post("/pr", async (req, res) => {
  const body = req.body as Record<string, unknown>;
  const companyId = resolveCompanyId(req as Parameters<typeof resolveCompanyId>[0]);
  const prNumber = await nextSeq("purchase_requests", "PR", "pr_number");
  const [pr] = await db.insert(purchaseRequestsTable).values({
    prNumber,
    companyId,
    warehouseId: body.warehouseId ? Number(body.warehouseId) : undefined,
    requestedBy: String(body.requestedBy ?? ""),
    department: body.department ? String(body.department) : undefined,
    requiredDate: body.requiredDate ? new Date(String(body.requiredDate)) : undefined,
    notes: body.notes ? String(body.notes) : undefined,
    createdBy: body.createdBy ? String(body.createdBy) : undefined,
    categoryKey: body.categoryKey ? String(body.categoryKey) : undefined,
    templateId: body.templateId ? String(body.templateId) : undefined,
    templateVersion: body.templateVersion ? String(body.templateVersion) : undefined,
    templateSnapshot: (body.templateSnapshot as Record<string, unknown> | null | undefined) ?? undefined,
  }).returning();
  if (Array.isArray(body.lines) && body.lines.length > 0) {
    await db.insert(purchaseRequestLinesTable).values(
      (body.lines as Record<string, unknown>[]).map((l) => ({
        prId: pr!.id,
        productId: l.productId ? Number(l.productId) : undefined,
        name: String(l.name ?? ""),
        description: l.description ? String(l.description) : undefined,
        quantity: String(l.quantity ?? "1"),
        unit: String(l.unit ?? "pcs"),
        estimatedCost: String(l.estimatedCost ?? "0"),
        notes: l.notes ? String(l.notes) : undefined,
        productCategory: l.productCategory ? String(l.productCategory) : undefined,
        customFieldValues: l.customFieldValues ?? undefined,
      }))
    );
  }
  res.json(pr);
});

router.put("/pr/:id", async (req, res) => {
  const id = Number(req.params.id);
  const body = req.body as Record<string, unknown>;
  const [pr] = await db.update(purchaseRequestsTable).set({
    warehouseId: body.warehouseId ? Number(body.warehouseId) : undefined,
    requestedBy: body.requestedBy ? String(body.requestedBy) : undefined,
    department: body.department ? String(body.department) : undefined,
    requiredDate: body.requiredDate ? new Date(String(body.requiredDate)) : undefined,
    notes: body.notes ? String(body.notes) : undefined,
    ...(body.categoryKey !== undefined ? { categoryKey: body.categoryKey ? String(body.categoryKey) : null } : {}),
    ...(body.templateId !== undefined ? { templateId: body.templateId ? String(body.templateId) : null } : {}),
    ...(body.templateVersion !== undefined ? { templateVersion: body.templateVersion ? String(body.templateVersion) : null } : {}),
    ...(body.templateSnapshot !== undefined ? { templateSnapshot: (body.templateSnapshot as Record<string, unknown> | null) } : {}),
    updatedAt: new Date(),
  }).where(eq(purchaseRequestsTable.id, id)).returning();
  if (Array.isArray(body.lines)) {
    await db.delete(purchaseRequestLinesTable).where(eq(purchaseRequestLinesTable.prId, id));
    if (body.lines.length > 0) {
      await db.insert(purchaseRequestLinesTable).values(
        (body.lines as Record<string, unknown>[]).map((l) => ({
          prId: id,
          productId: l.productId ? Number(l.productId) : undefined,
          name: String(l.name ?? ""),
          description: l.description ? String(l.description) : undefined,
          quantity: String(l.quantity ?? "1"),
          unit: String(l.unit ?? "pcs"),
          estimatedCost: String(l.estimatedCost ?? "0"),
          notes: l.notes ? String(l.notes) : undefined,
          productCategory: l.productCategory ? String(l.productCategory) : undefined,
          customFieldValues: l.customFieldValues ?? undefined,
        }))
      );
    }
  }
  res.json(pr);
});

router.post("/pr/:id/action", async (req, res) => {
  const id = Number(req.params.id);
  const { action, notes, approverName, approverId } = req.body as Record<string, string>;
  const [pr] = await db.select().from(purchaseRequestsTable).where(eq(purchaseRequestsTable.id, id));
  if (!pr) { res.status(404).json({ error: "Not found" }); return; }

  if (action === "submit") {
    await db.update(purchaseRequestsTable).set({ status: "submitted", updatedAt: new Date() }).where(eq(purchaseRequestsTable.id, id));
    await db.insert(purchaseApprovalsTable).values({ docType: "PR", docId: id, step: 1, status: "pending", approverName: approverName ?? null, approverId: approverId ?? null });
  } else if (action === "approve") {
    const [pending] = await db.select().from(purchaseApprovalsTable)
      .where(and(eq(purchaseApprovalsTable.docType, "PR"), eq(purchaseApprovalsTable.docId, id), eq(purchaseApprovalsTable.status, "pending")))
      .orderBy(purchaseApprovalsTable.step).limit(1);
    if (pending) {
      await db.update(purchaseApprovalsTable).set({ status: "approved", notes: notes ?? null, approvedAt: new Date() }).where(eq(purchaseApprovalsTable.id, pending.id));
    }
    await db.update(purchaseRequestsTable).set({ status: "approved", updatedAt: new Date() }).where(eq(purchaseRequestsTable.id, id));
  } else if (action === "reject") {
    const [pending] = await db.select().from(purchaseApprovalsTable)
      .where(and(eq(purchaseApprovalsTable.docType, "PR"), eq(purchaseApprovalsTable.docId, id), eq(purchaseApprovalsTable.status, "pending")))
      .limit(1);
    if (pending) {
      await db.update(purchaseApprovalsTable).set({ status: "rejected", notes: notes ?? null, rejectedAt: new Date() }).where(eq(purchaseApprovalsTable.id, pending.id));
    }
    await db.update(purchaseRequestsTable).set({ status: "rejected", updatedAt: new Date() }).where(eq(purchaseRequestsTable.id, id));
  } else if (action === "cancel") {
    await db.update(purchaseRequestsTable).set({ status: "cancelled", cancelledAt: new Date(), updatedAt: new Date() }).where(eq(purchaseRequestsTable.id, id));
  } else if (action === "convert_rfq") {
    // Create an RFQ (purchase_documents kind=rfq) from this PR
    const lines = await db.select().from(purchaseRequestLinesTable).where(eq(purchaseRequestLinesTable.prId, id));
    const year = new Date().getFullYear();
    const rfqResult = await db.execute(sql`SELECT COALESCE(MAX(CAST(SPLIT_PART(doc_number,'/',3) AS int)),0) AS seq FROM purchase_documents WHERE doc_number LIKE ${'RFQ/' + year + '/%'}`);
    const countRow = ((rfqResult as any).rows?.[0] ?? (Array.isArray(rfqResult) ? rfqResult[0] : { seq: 0 })) as { seq: number };
    const seq = (Number(countRow.seq) + 1).toString().padStart(5, "0");
    const docNumber = `RFQ/${year}/${seq}`;

    // Resolve template from PR lines
    const categoryKey = (lines.find((l) => (l as any).productCategory)?.productCategory as string | null) ?? (pr as any).categoryKey ?? null;
    let templateSnapshot: Record<string, unknown> | null = null;
    let templateId: string | null = null;
    let templateVersion: string | null = null;
    if (categoryKey) {
      const dbOverrides = await db.select().from(productTemplatesTable).where(eq(productTemplatesTable.categoryKey, categoryKey)).limit(1);
      const override = dbOverrides[0] ? {
        categoryKey: dbOverrides[0].categoryKey,
        label: dbOverrides[0].label,
        version: dbOverrides[0].version,
        isActive: dbOverrides[0].isActive,
        requiredDocuments: dbOverrides[0].requiredDocuments as ProductTemplateOverride["requiredDocuments"],
        checklist: dbOverrides[0].checklist as ProductTemplateOverride["checklist"],
        customFields: dbOverrides[0].customFields as ProductTemplateOverride["customFields"],
        packagingInstructions: dbOverrides[0].packagingInstructions ?? null,
        conditionalRules: dbOverrides[0].conditionalRules as ProductTemplateOverride["conditionalRules"],
        validationRules: dbOverrides[0].validationRules as ProductTemplateOverride["validationRules"],
      } satisfies ProductTemplateOverride : null;
      const resolved = resolveTemplate(categoryKey, override ? [override] : []);
      if (resolved) {
        templateSnapshot = resolved as unknown as Record<string, unknown>;
        templateId = resolved.category;
        templateVersion = resolved.version;
      }
    }

    const [rfq] = await db.insert(purchaseDocumentsTable).values({
      docNumber,
      kind: "rfq",
      status: "draft",
      companyId: pr.companyId,
      supplierName: "",
      totalAmount: "0",
      taxAmount: "0",
      grandTotal: "0",
      notes: `Converted from PR ${pr.prNumber}`,
      createdById: pr.createdBy ?? undefined,
      ...(categoryKey ? { categoryKey, templateId, templateVersion, templateSnapshot } : {}),
      categoryKey: (pr as any).categoryKey ?? null,
      templateId: (pr as any).templateId ?? null,
      templateVersion: (pr as any).templateVersion ?? null,
      templateSnapshot: (pr as any).templateSnapshot ?? null,
    }).returning();
    if (lines.length > 0) {
      await db.insert(purchaseDocumentLinesTable).values(
        lines.map((l) => ({
          documentId: rfq!.id,
          productId: l.productId ?? undefined,
          name: l.name,
          description: l.description ?? undefined,
          quantity: l.quantity,
          unitCost: "0",
          subtotal: "0",
        }))
      );
    }
    await db.update(purchaseRequestsTable).set({ status: "converted", rfqId: rfq!.id, updatedAt: new Date() }).where(eq(purchaseRequestsTable.id, id));
    res.json({ rfqId: rfq!.id, rfqNumber: rfq!.docNumber });
    return;
  }
  const [updated] = await db.select().from(purchaseRequestsTable).where(eq(purchaseRequestsTable.id, id));
  res.json(updated);
});

router.delete("/pr/:id", async (req, res) => {
  await db.delete(purchaseRequestsTable).where(eq(purchaseRequestsTable.id, Number(req.params.id)));
  res.json({ ok: true });
});

// ─────────────────────────────────────────────────────────────────────────────
// VENDOR QUOTATIONS
// ─────────────────────────────────────────────────────────────────────────────

router.get("/vq", async (req, res) => {
  const rfqId = req.query.rfqId ? Number(req.query.rfqId) : undefined;
  const query = rfqId
    ? db.select().from(vendorQuotationsTable).where(eq(vendorQuotationsTable.rfqId, rfqId))
    : db.select().from(vendorQuotationsTable).orderBy(desc(vendorQuotationsTable.createdAt));
  res.json(await query);
});

router.get("/vq/:id", async (req, res) => {
  const id = Number(req.params.id);
  const [vq] = await db.select().from(vendorQuotationsTable).where(eq(vendorQuotationsTable.id, id));
  if (!vq) { res.status(404).json({ error: "Not found" }); return; }
  const lines = await db.select().from(vendorQuotationLinesTable).where(eq(vendorQuotationLinesTable.quotationId, id));
  res.json({ ...vq, lines });
});

router.get("/vq/compare/:rfqId", async (req, res) => {
  const rfqId = Number(req.params.rfqId);
  const quotations = await db.select().from(vendorQuotationsTable).where(eq(vendorQuotationsTable.rfqId, rfqId));
  const result = await Promise.all(quotations.map(async (vq) => {
    const lines = await db.select().from(vendorQuotationLinesTable).where(eq(vendorQuotationLinesTable.quotationId, vq.id));
    return { ...vq, lines };
  }));
  res.json(result);
});

router.post("/vq", async (req, res) => {
  const body = req.body as Record<string, unknown>;
  const [vq] = await db.insert(vendorQuotationsTable).values({
    rfqId: Number(body.rfqId),
    supplierId: body.supplierId ? Number(body.supplierId) : undefined,
    supplierName: String(body.supplierName ?? ""),
    validUntil: body.validUntil ? new Date(String(body.validUntil)) : undefined,
    paymentTermDays: body.paymentTermDays ? Number(body.paymentTermDays) : 30,
    deliveryDays: body.deliveryDays ? Number(body.deliveryDays) : undefined,
    notes: body.notes ? String(body.notes) : undefined,
    totalAmount: String(body.totalAmount ?? "0"),
    taxAmount: String(body.taxAmount ?? "0"),
    grandTotal: String(body.grandTotal ?? "0"),
    incoterm: body.incoterm ? String(body.incoterm) : undefined,
    deliveryTerm: body.deliveryTerm ? String(body.deliveryTerm) : undefined,
    availability: body.availability ? String(body.availability) : undefined,
    documentRefs: body.documentRefs ?? undefined,
  }).returning();
  if (Array.isArray(body.lines) && body.lines.length > 0) {
    await db.insert(vendorQuotationLinesTable).values(
      (body.lines as Record<string, unknown>[]).map((l) => ({
        quotationId: vq!.id,
        productId: l.productId ? Number(l.productId) : undefined,
        name: String(l.name ?? ""),
        description: l.description ? String(l.description) : undefined,
        quantity: String(l.quantity ?? "1"),
        unit: String(l.unit ?? "pcs"),
        unitCost: String(l.unitCost ?? "0"),
        subtotal: String(num(l.quantity) * num(l.unitCost)),
        leadTimeDays: l.leadTimeDays ? Number(l.leadTimeDays) : undefined,
        notes: l.notes ? String(l.notes) : undefined,
      }))
    );
  }
  res.json(vq);
});

router.put("/vq/:id", async (req, res) => {
  const id = Number(req.params.id);
  const body = req.body as Record<string, unknown>;
  const [vq] = await db.update(vendorQuotationsTable).set({
    supplierName: body.supplierName ? String(body.supplierName) : undefined,
    validUntil: body.validUntil ? new Date(String(body.validUntil)) : undefined,
    paymentTermDays: body.paymentTermDays ? Number(body.paymentTermDays) : undefined,
    deliveryDays: body.deliveryDays ? Number(body.deliveryDays) : undefined,
    notes: body.notes ? String(body.notes) : undefined,
    totalAmount: body.totalAmount ? String(body.totalAmount) : undefined,
    taxAmount: body.taxAmount ? String(body.taxAmount) : undefined,
    grandTotal: body.grandTotal ? String(body.grandTotal) : undefined,
    incoterm: body.incoterm !== undefined ? (body.incoterm ? String(body.incoterm) : null) : undefined,
    deliveryTerm: body.deliveryTerm !== undefined ? (body.deliveryTerm ? String(body.deliveryTerm) : null) : undefined,
    availability: body.availability !== undefined ? (body.availability ? String(body.availability) : null) : undefined,
    documentRefs: body.documentRefs !== undefined ? (body.documentRefs ?? null) : undefined,
    updatedAt: new Date(),
  }).where(eq(vendorQuotationsTable.id, id)).returning();
  if (Array.isArray(body.lines)) {
    await db.delete(vendorQuotationLinesTable).where(eq(vendorQuotationLinesTable.quotationId, id));
    if (body.lines.length > 0) {
      await db.insert(vendorQuotationLinesTable).values(
        (body.lines as Record<string, unknown>[]).map((l) => ({
          quotationId: id,
          productId: l.productId ? Number(l.productId) : undefined,
          name: String(l.name ?? ""),
          quantity: String(l.quantity ?? "1"),
          unit: String(l.unit ?? "pcs"),
          unitCost: String(l.unitCost ?? "0"),
          subtotal: String(num(l.quantity) * num(l.unitCost)),
          leadTimeDays: l.leadTimeDays ? Number(l.leadTimeDays) : undefined,
        }))
      );
    }
  }
  res.json(vq);
});

router.post("/vq/:id/select", async (req, res) => {
  // Select this quotation → update vendor on parent RFQ → create PO
  const id = Number(req.params.id);
  const [vq] = await db.select().from(vendorQuotationsTable).where(eq(vendorQuotationsTable.id, id));
  if (!vq) { res.status(404).json({ error: "Not found" }); return; }
  await db.update(vendorQuotationsTable).set({ status: "selected", updatedAt: new Date() }).where(eq(vendorQuotationsTable.id, id));
  await db.update(vendorQuotationsTable).set({ status: "rejected", updatedAt: new Date() })
    .where(and(eq(vendorQuotationsTable.rfqId, vq.rfqId), sql`id != ${id}`));
  // Convert RFQ to PO
  const [rfq] = await db.select().from(purchaseDocumentsTable).where(eq(purchaseDocumentsTable.id, vq.rfqId));
  const vqLines = await db.select().from(vendorQuotationLinesTable).where(eq(vendorQuotationLinesTable.quotationId, id));
  const year = new Date().getFullYear();
  const poResult = await db.execute(sql`SELECT COALESCE(MAX(CAST(SPLIT_PART(doc_number,'/',3) AS int)),0) AS seq FROM purchase_documents WHERE doc_number LIKE ${'PO/' + year + '/%'}`);
  const countRow = ((poResult as any).rows?.[0] ?? (Array.isArray(poResult) ? poResult[0] : { seq: 0 })) as { seq: number };
  const seq = (Number(countRow.seq) + 1).toString().padStart(5, "0");
  const poNumber = `PO/${year}/${seq}`;
  const [po] = await db.insert(purchaseDocumentsTable).values({
    docNumber: poNumber,
    kind: "order",
    status: "confirmed",
    companyId: rfq?.companyId ?? 1,
    supplierId: vq.supplierId ?? undefined,
    supplierName: vq.supplierName,
    totalAmount: vq.totalAmount,
    taxAmount: vq.taxAmount,
    grandTotal: vq.grandTotal,
    receiveStatus: "to_receive",
    billStatus: "to_bill",
    notes: `From RFQ ${rfq?.docNumber ?? ""} - Quotation by ${vq.supplierName}`,
    paymentTermDays: vq.paymentTermDays ?? 30,
    confirmedAt: new Date(),
    incoterm: (vq as any).incoterm ?? null,
    deliveryTerm: (vq as any).deliveryTerm ?? null,
    productCategory: (rfq as any)?.productCategory ?? null,
    categoryKey: (rfq as any)?.categoryKey ?? null,
    templateId: (rfq as any)?.templateId ?? null,
    templateVersion: (rfq as any)?.templateVersion ?? null,
    templateSnapshot: (rfq as any)?.templateSnapshot ?? null,
  }).returning();
  if (vqLines.length > 0) {
    await db.insert(purchaseDocumentLinesTable).values(
      vqLines.map((l) => ({
        documentId: po!.id,
        productId: l.productId ?? undefined,
        name: l.name,
        quantity: l.quantity,
        unitCost: l.unitCost,
        subtotal: l.subtotal,
      }))
    );
  }
  res.json({ poId: po!.id, poNumber: po!.docNumber });
});

router.delete("/vq/:id", async (req, res) => {
  await db.delete(vendorQuotationsTable).where(eq(vendorQuotationsTable.id, Number(req.params.id)));
  res.json({ ok: true });
});

// ─────────────────────────────────────────────────────────────────────────────
// GOODS RECEIPTS (GRN)
// ─────────────────────────────────────────────────────────────────────────────

router.get("/gr", async (req, res) => {
  const companyId = resolveCompanyId(req as Parameters<typeof resolveCompanyId>[0]);
  const poId = req.query.poId ? Number(req.query.poId) : undefined;
  let query = db.select().from(goodsReceiptsTable).orderBy(desc(goodsReceiptsTable.createdAt));
  if (poId) {
    const rows = await db.select().from(goodsReceiptsTable).where(eq(goodsReceiptsTable.poId, poId)).orderBy(desc(goodsReceiptsTable.createdAt));
    res.json(rows); return;
  }
  const rows = await db.select().from(goodsReceiptsTable).where(eq(goodsReceiptsTable.companyId, companyId)).orderBy(desc(goodsReceiptsTable.createdAt));
  res.json(rows);
});

router.get("/gr/:id", async (req, res) => {
  const id = Number(req.params.id);
  const [gr] = await db.select().from(goodsReceiptsTable).where(eq(goodsReceiptsTable.id, id));
  if (!gr) { res.status(404).json({ error: "Not found" }); return; }
  const lines = await db.select().from(goodsReceiptLinesTable).where(eq(goodsReceiptLinesTable.grId, id));
  const [po] = await db.select().from(purchaseDocumentsTable).where(eq(purchaseDocumentsTable.id, gr.poId));
  res.json({ ...gr, lines, po });
});

router.post("/gr", async (req, res) => {
  const body = req.body as Record<string, unknown>;
  const companyId = resolveCompanyId(req as Parameters<typeof resolveCompanyId>[0]);
  const grNumber = await nextSeq("goods_receipts", "GRN", "gr_number");
  const [gr] = await db.insert(goodsReceiptsTable).values({
    grNumber,
    companyId,
    poId: Number(body.poId),
    warehouseId: body.warehouseId ? Number(body.warehouseId) : undefined,
    supplierId: body.supplierId ? Number(body.supplierId) : undefined,
    receiveDate: body.receiveDate ? new Date(String(body.receiveDate)) : new Date(),
    deliveryNote: body.deliveryNote ? String(body.deliveryNote) : undefined,
    notes: body.notes ? String(body.notes) : undefined,
    createdBy: body.createdBy ? String(body.createdBy) : undefined,
  }).returning();
  if (Array.isArray(body.lines) && body.lines.length > 0) {
    await db.insert(goodsReceiptLinesTable).values(
      (body.lines as Record<string, unknown>[]).map((l) => {
        const qty = num(l.qtyReceived);
        const cost = num(l.unitCost);
        return {
          grId: gr!.id,
          poLineId: l.poLineId ? Number(l.poLineId) : undefined,
          productId: l.productId ? Number(l.productId) : undefined,
          name: String(l.name ?? ""),
          qtyOrdered: String(l.qtyOrdered ?? "0"),
          qtyReceived: String(qty),
          qtyRejected: String(l.qtyRejected ?? "0"),
          unit: String(l.unit ?? "pcs"),
          unitCost: String(cost),
          subtotal: String(qty * cost),
          rackId: l.rackId ? Number(l.rackId) : undefined,
          notes: l.notes ? String(l.notes) : undefined,
          condition: l.condition ? String(l.condition) : undefined,
          receivingNotes: l.receivingNotes ? String(l.receivingNotes) : undefined,
          attachments: l.attachments ?? undefined,
        };
      })
    );
  }
  res.json(gr);
});

router.put("/gr/:id", async (req, res) => {
  const id = Number(req.params.id);
  const body = req.body as Record<string, unknown>;
  const [gr] = await db.update(goodsReceiptsTable).set({
    warehouseId: body.warehouseId ? Number(body.warehouseId) : undefined,
    receiveDate: body.receiveDate ? new Date(String(body.receiveDate)) : undefined,
    deliveryNote: body.deliveryNote ? String(body.deliveryNote) : undefined,
    notes: body.notes ? String(body.notes) : undefined,
    updatedAt: new Date(),
  }).where(eq(goodsReceiptsTable.id, id)).returning();
  if (Array.isArray(body.lines)) {
    await db.delete(goodsReceiptLinesTable).where(eq(goodsReceiptLinesTable.grId, id));
    if (body.lines.length > 0) {
      await db.insert(goodsReceiptLinesTable).values(
        (body.lines as Record<string, unknown>[]).map((l) => {
          const qty = num(l.qtyReceived);
          const cost = num(l.unitCost);
          return {
            grId: id,
            poLineId: l.poLineId ? Number(l.poLineId) : undefined,
            productId: l.productId ? Number(l.productId) : undefined,
            name: String(l.name ?? ""),
            qtyOrdered: String(l.qtyOrdered ?? "0"),
            qtyReceived: String(qty),
            qtyRejected: String(l.qtyRejected ?? "0"),
            unit: String(l.unit ?? "pcs"),
            unitCost: String(cost),
            subtotal: String(qty * cost),
            rackId: l.rackId ? Number(l.rackId) : undefined,
            notes: l.notes ? String(l.notes) : undefined,
            condition: l.condition ? String(l.condition) : undefined,
            receivingNotes: l.receivingNotes ? String(l.receivingNotes) : undefined,
            attachments: l.attachments ?? undefined,
          };
        })
      );
    }
  }
  res.json(gr);
});

router.post("/gr/:id/confirm", async (req, res) => {
  const id = Number(req.params.id);
  const { confirmedBy } = req.body as Record<string, string>;
  const [gr] = await db.select().from(goodsReceiptsTable).where(eq(goodsReceiptsTable.id, id));
  if (!gr) { res.status(404).json({ error: "Not found" }); return; }
  if (gr.status !== "draft") { res.status(400).json({ error: "Already confirmed" }); return; }

  await db.update(goodsReceiptsTable).set({ status: "confirmed", confirmedBy: confirmedBy ?? null, confirmedAt: new Date(), updatedAt: new Date() }).where(eq(goodsReceiptsTable.id, id));

  const lines = await db.select().from(goodsReceiptLinesTable).where(eq(goodsReceiptLinesTable.grId, id));

  // Update inventory stock if warehouse set
  if (gr.warehouseId) {
    for (const line of lines) {
      if (!line.productId) continue;
      const qty = num(line.qtyReceived);
      if (qty <= 0) continue;
      const warehouseId = gr.warehouseId;
      const [existing] = await db.select().from(whStockTable)
        .where(and(eq(whStockTable.productId, line.productId), eq(whStockTable.warehouseId, warehouseId)));
      if (existing) {
        const oldQty = num(existing.qty);
        const oldCost = Number(existing.costPrice ?? 0);
        const newQty = oldQty + qty;
        const newCostUnit = num(String(line.unitCost ?? 0));
        // Step 3 Fix B: weighted average cost — jangan overwrite harga lama, hitung rata-rata tertimbang
        const newCostPrice = (oldQty > 0 && oldCost > 0)
          ? Math.round(((oldQty * oldCost + qty * newCostUnit) / newQty) * 100) / 100
          : newCostUnit;
        await db.update(whStockTable).set({ qty: String(newQty), costPrice: String(newCostPrice), updatedAt: new Date() })
          .where(eq(whStockTable.id, existing.id));
      } else {
        await db.insert(whStockTable).values({ productId: line.productId, warehouseId, qty: String(qty), costPrice: line.unitCost });
      }
      await db.insert(whMovementsTable).values({
        productId: line.productId,
        warehouseId,
        type: "po_receipt",
        qty: String(qty),
        qtyBefore: String(num(existing?.qty ?? 0)),
        qtyAfter: String(num(existing?.qty ?? 0) + qty),
        costPrice: line.unitCost,
        refType: "goods_receipt",
        refId: id,
        note: `GRN ${gr.grNumber}`,
      });
    }
  }

  // Post accounting journal: Dr Inventory / Cr GR/IR (proper 3-way match accrual)
  // GR/IR (2-1045) acts as clearing account; cleared when vendor invoice (bill) is posted.
  try {
    const settings = await ensureAccountingSettings(gr.companyId ?? 1);
    const totalCost = lines.reduce((s, l) => s + num(l.qtyReceived) * num(l.unitCost), 0);
    const creditAccountId = settings.grirAccountId ?? settings.apAccountId; // fallback to AP if no GR/IR
    if (totalCost > 0 && settings.inventoryAccountId && settings.purchaseJournalId && creditAccountId) {
      const isGrir = !!settings.grirAccountId;
      const entry = await postEntry({
        journalId: settings.purchaseJournalId,
        date: new Date(),
        ref: gr.grNumber,
        description: `Penerimaan Barang ${gr.grNumber}`,
        source: "grn_receipt",
        sourceId: id,
        companyId: gr.companyId ?? 1,
        lines: [
          { accountId: settings.inventoryAccountId, debit: totalCost, credit: 0, description: `Persediaan masuk: ${gr.grNumber}` },
          { accountId: creditAccountId, debit: 0, credit: totalCost, description: isGrir ? `GR/IR accrual: ${gr.grNumber}` : `AP accrual: ${gr.grNumber}` },
        ],
      }, "PUR");
      if (entry?.id) {
        await db.update(goodsReceiptsTable).set({ journalEntryId: entry.id, updatedAt: new Date() }).where(eq(goodsReceiptsTable.id, id));
      }
    }
  } catch (e) { console.error("[GR confirm accounting]", e); }

  // Update PO receive status
  await db.update(purchaseDocumentsTable).set({ receiveStatus: "received", updatedAt: new Date() }).where(eq(purchaseDocumentsTable.id, gr.poId));

  res.json({ ok: true });
});

router.post("/gr/:id/cancel", async (req, res) => {
  await db.update(goodsReceiptsTable).set({ status: "cancelled", cancelledAt: new Date(), updatedAt: new Date() }).where(eq(goodsReceiptsTable.id, Number(req.params.id)));
  res.json({ ok: true });
});

// ─────────────────────────────────────────────────────────────────────────────
// QC INSPECTIONS
// ─────────────────────────────────────────────────────────────────────────────

router.get("/qc", async (req, res) => {
  const companyId = resolveCompanyId(req as Parameters<typeof resolveCompanyId>[0]);
  const rows = await db.select().from(qcInspectionsTable)
    .where(eq(qcInspectionsTable.companyId, companyId))
    .orderBy(desc(qcInspectionsTable.createdAt));
  res.json(rows);
});

router.get("/qc/:id", async (req, res) => {
  const id = Number(req.params.id);
  const [qc] = await db.select().from(qcInspectionsTable).where(eq(qcInspectionsTable.id, id));
  if (!qc) { res.status(404).json({ error: "Not found" }); return; }
  const lines = await db.select().from(qcLinesTable).where(eq(qcLinesTable.qcId, id));
  const [gr] = await db.select().from(goodsReceiptsTable).where(eq(goodsReceiptsTable.id, qc.grId));
  res.json({ ...qc, lines, gr });
});

router.post("/qc", async (req, res) => {
  const body = req.body as Record<string, unknown>;
  const companyId = resolveCompanyId(req as Parameters<typeof resolveCompanyId>[0]);
  const qcNumber = await nextSeq("qc_inspections", "QC", "qc_number");
  const [qc] = await db.insert(qcInspectionsTable).values({
    qcNumber,
    grId: Number(body.grId),
    companyId,
    inspectorName: body.inspectorName ? String(body.inspectorName) : undefined,
    notes: body.notes ? String(body.notes) : undefined,
    createdBy: body.createdBy ? String(body.createdBy) : undefined,
  }).returning();
  if (Array.isArray(body.lines) && body.lines.length > 0) {
    await db.insert(qcLinesTable).values(
      (body.lines as Record<string, unknown>[]).map((l) => ({
        qcId: qc!.id,
        grLineId: l.grLineId ? Number(l.grLineId) : undefined,
        productId: l.productId ? Number(l.productId) : undefined,
        name: String(l.name ?? ""),
        qtyInspected: String(l.qtyInspected ?? "0"),
        qtyPassed: String(l.qtyPassed ?? "0"),
        qtyFailed: String(l.qtyFailed ?? "0"),
        failReason: l.failReason ? String(l.failReason) : undefined,
        notes: l.notes ? String(l.notes) : undefined,
      }))
    );
  }
  res.json(qc);
});

router.put("/qc/:id", async (req, res) => {
  const id = Number(req.params.id);
  const body = req.body as Record<string, unknown>;
  const [qc] = await db.update(qcInspectionsTable).set({
    inspectorName: body.inspectorName ? String(body.inspectorName) : undefined,
    notes: body.notes ? String(body.notes) : undefined,
    updatedAt: new Date(),
  }).where(eq(qcInspectionsTable.id, id)).returning();
  if (Array.isArray(body.lines)) {
    await db.delete(qcLinesTable).where(eq(qcLinesTable.qcId, id));
    if (body.lines.length > 0) {
      await db.insert(qcLinesTable).values(
        (body.lines as Record<string, unknown>[]).map((l) => ({
          qcId: id,
          grLineId: l.grLineId ? Number(l.grLineId) : undefined,
          productId: l.productId ? Number(l.productId) : undefined,
          name: String(l.name ?? ""),
          qtyInspected: String(l.qtyInspected ?? "0"),
          qtyPassed: String(l.qtyPassed ?? "0"),
          qtyFailed: String(l.qtyFailed ?? "0"),
          failReason: l.failReason ? String(l.failReason) : undefined,
          notes: l.notes ? String(l.notes) : undefined,
        }))
      );
    }
  }
  res.json(qc);
});

router.post("/qc/:id/action", async (req, res) => {
  const id = Number(req.params.id);
  const { action, inspectorName, notes } = req.body as Record<string, string>;
  const lines = await db.select().from(qcLinesTable).where(eq(qcLinesTable.qcId, id));
  const totalFailed = lines.reduce((s, l) => s + num(l.qtyFailed), 0);
  const totalPassed = lines.reduce((s, l) => s + num(l.qtyPassed), 0);
  let status: "passed" | "failed" | "partial" = "passed";
  if (totalFailed > 0 && totalPassed === 0) status = "failed";
  else if (totalFailed > 0) status = "partial";
  if (action === "complete") {
    await db.update(qcInspectionsTable).set({ status, inspectorName: inspectorName ?? null, notes: notes ?? null, inspectedAt: new Date(), updatedAt: new Date() }).where(eq(qcInspectionsTable.id, id));
  }
  const [updated] = await db.select().from(qcInspectionsTable).where(eq(qcInspectionsTable.id, id));
  res.json(updated);
});

// ─────────────────────────────────────────────────────────────────────────────
// PURCHASE RETURNS
// ─────────────────────────────────────────────────────────────────────────────

router.get("/returns", async (req, res) => {
  const companyId = resolveCompanyId(req as Parameters<typeof resolveCompanyId>[0]);
  const rows = await db.select().from(purchaseReturnsTable)
    .where(eq(purchaseReturnsTable.companyId, companyId))
    .orderBy(desc(purchaseReturnsTable.createdAt));
  res.json(rows);
});

router.get("/returns/:id", async (req, res) => {
  const id = Number(req.params.id);
  const [ret] = await db.select().from(purchaseReturnsTable).where(eq(purchaseReturnsTable.id, id));
  if (!ret) { res.status(404).json({ error: "Not found" }); return; }
  const lines = await db.select().from(purchaseReturnLinesTable).where(eq(purchaseReturnLinesTable.returnId, id));
  res.json({ ...ret, lines });
});

router.post("/returns", async (req, res) => {
  const body = req.body as Record<string, unknown>;
  const companyId = resolveCompanyId(req as Parameters<typeof resolveCompanyId>[0]);
  const returnNumber = await nextSeq("purchase_returns", "RTN", "return_number");
  const lines = (body.lines as Record<string, unknown>[]) ?? [];
  const totalAmount = lines.reduce((s, l) => s + num(l.quantity) * num(l.unitCost), 0);
  const [ret] = await db.insert(purchaseReturnsTable).values({
    returnNumber,
    companyId,
    poId: body.poId ? Number(body.poId) : undefined,
    grId: body.grId ? Number(body.grId) : undefined,
    supplierId: body.supplierId ? Number(body.supplierId) : undefined,
    supplierName: String(body.supplierName ?? ""),
    warehouseId: body.warehouseId ? Number(body.warehouseId) : undefined,
    reason: body.reason ? String(body.reason) : undefined,
    totalAmount: String(totalAmount),
    notes: body.notes ? String(body.notes) : undefined,
    createdBy: body.createdBy ? String(body.createdBy) : undefined,
  }).returning();
  if (lines.length > 0) {
    await db.insert(purchaseReturnLinesTable).values(
      lines.map((l) => ({
        returnId: ret!.id,
        productId: l.productId ? Number(l.productId) : undefined,
        name: String(l.name ?? ""),
        quantity: String(l.quantity ?? "0"),
        unit: String(l.unit ?? "pcs"),
        unitCost: String(l.unitCost ?? "0"),
        subtotal: String(num(l.quantity) * num(l.unitCost)),
        reason: l.reason ? String(l.reason) : undefined,
      }))
    );
  }
  res.json(ret);
});

router.post("/returns/:id/confirm", async (req, res) => {
  const id = Number(req.params.id);
  const { confirmedBy } = req.body as Record<string, string>;
  const [ret] = await db.select().from(purchaseReturnsTable).where(eq(purchaseReturnsTable.id, id));
  if (!ret) { res.status(404).json({ error: "Not found" }); return; }
  await db.update(purchaseReturnsTable).set({ status: "confirmed", confirmedBy: confirmedBy ?? null, confirmedAt: new Date(), updatedAt: new Date() }).where(eq(purchaseReturnsTable.id, id));

  const lines = await db.select().from(purchaseReturnLinesTable).where(eq(purchaseReturnLinesTable.returnId, id));
  // Deduct stock
  if (ret.warehouseId) {
    for (const line of lines) {
      if (!line.productId) continue;
      const qty = num(line.quantity);
      if (qty <= 0) continue;
      const [existing] = await db.select().from(whStockTable)
        .where(and(eq(whStockTable.productId, line.productId), eq(whStockTable.warehouseId, ret.warehouseId)));
      if (existing) {
        const newQty = Math.max(0, num(existing.qty) - qty);
        await db.update(whStockTable).set({ qty: String(newQty), updatedAt: new Date() }).where(eq(whStockTable.id, existing.id));
        await db.insert(whMovementsTable).values({
          productId: line.productId,
          warehouseId: ret.warehouseId,
          type: "return_out",
          qty: String(-qty),
          qtyBefore: String(num(existing.qty)),
          qtyAfter: String(newQty),
          costPrice: line.unitCost,
          refType: "purchase_return",
          refId: id,
          note: `Return ${ret.returnNumber}`,
        });
      }
    }
  }

  // Auto-post accounting journal for purchase return
  if (ret.supplierId) {
    const [supplier] = await db.select({ name: suppliersTable.name }).from(suppliersTable).where(eq(suppliersTable.id, ret.supplierId));
    postPurchaseReturn({
      returnId: id,
      returnNumber: ret.returnNumber,
      supplierName: supplier?.name ?? "Vendor",
      lines: lines.map((l) => ({
        productId: l.productId ?? null,
        qty: num(l.quantity),
        unitCost: num(l.unitCost),
      })),
      createdById: confirmedBy ?? null,
    }).catch((e) => console.error("[accounting] postPurchaseReturn error:", e));
  }

  res.json({ ok: true });
});

router.post("/returns/:id/cancel", async (req, res) => {
  await db.update(purchaseReturnsTable).set({ status: "cancelled", cancelledAt: new Date(), updatedAt: new Date() }).where(eq(purchaseReturnsTable.id, Number(req.params.id)));
  res.json({ ok: true });
});

// ─────────────────────────────────────────────────────────────────────────────
// VENDOR INVOICES (AP)
// ─────────────────────────────────────────────────────────────────────────────

router.get("/vendor-invoices", async (req, res) => {
  const companyId = resolveCompanyId(req as Parameters<typeof resolveCompanyId>[0]);
  const rows = await db.select().from(vendorInvoicesTable)
    .where(eq(vendorInvoicesTable.companyId, companyId))
    .orderBy(desc(vendorInvoicesTable.createdAt));
  res.json(rows);
});

router.get("/vendor-invoices/:id", async (req, res) => {
  const id = Number(req.params.id);
  const [vi] = await db.select().from(vendorInvoicesTable).where(eq(vendorInvoicesTable.id, id));
  if (!vi) { res.status(404).json({ error: "Not found" }); return; }
  const lines = await db.select().from(vendorInvoiceLinesTable).where(eq(vendorInvoiceLinesTable.invoiceId, id));
  const po = vi.poId ? (await db.select().from(purchaseDocumentsTable).where(eq(purchaseDocumentsTable.id, vi.poId)))[0] : null;
  const gr = vi.grId ? (await db.select().from(goodsReceiptsTable).where(eq(goodsReceiptsTable.id, vi.grId)))[0] : null;
  res.json({ ...vi, lines, po, gr });
});

router.post("/vendor-invoices", async (req, res) => {
  const body = req.body as Record<string, unknown>;
  const companyId = resolveCompanyId(req as Parameters<typeof resolveCompanyId>[0]);
  const invoiceNumber = await nextSeq("vendor_invoices", "VI", "invoice_number");
  const lines = (body.lines as Record<string, unknown>[]) ?? [];
  const totalAmount = lines.reduce((s, l) => s + num(l.quantity) * num(l.unitCost), 0);
  const taxAmount = lines.reduce((s, l) => s + num(l.taxAmount), 0);
  const dueDate = body.dueDate
    ? new Date(String(body.dueDate))
    : new Date(Date.now() + (Number(body.paymentTermDays ?? 30)) * 86400000);

  // Inherit template fields from linked PO
  let poCategoryKey: string | null = null;
  let poTemplateId: string | null = null;
  let poTemplateVersion: string | null = null;
  let poTemplateSnapshot: Record<string, unknown> | null = null;
  if (body.poId) {
    const [po] = await db.select().from(purchaseDocumentsTable).where(eq(purchaseDocumentsTable.id, Number(body.poId))).limit(1);
    if (po) {
      poCategoryKey = po.categoryKey ?? null;
      poTemplateId = po.templateId ?? null;
      poTemplateVersion = po.templateVersion ?? null;
      poTemplateSnapshot = (po.templateSnapshot as Record<string, unknown> | null) ?? null;
    }
  }

  const [vi] = await db.insert(vendorInvoicesTable).values({
    invoiceNumber,
    vendorInvoiceRef: body.vendorInvoiceRef ? String(body.vendorInvoiceRef) : undefined,
    companyId,
    supplierId: body.supplierId ? Number(body.supplierId) : undefined,
    supplierName: String(body.supplierName ?? ""),
    poId: body.poId ? Number(body.poId) : undefined,
    grId: body.grId ? Number(body.grId) : undefined,
    invoiceDate: body.invoiceDate ? new Date(String(body.invoiceDate)) : new Date(),
    dueDate,
    paymentTermDays: body.paymentTermDays ? Number(body.paymentTermDays) : 30,
    totalAmount: String(totalAmount),
    taxAmount: String(taxAmount),
    grandTotal: String(totalAmount + taxAmount),
    notes: body.notes ? String(body.notes) : undefined,
    createdBy: body.createdBy ? String(body.createdBy) : undefined,
    ...(poCategoryKey ? { categoryKey: poCategoryKey, templateId: poTemplateId, templateVersion: poTemplateVersion, templateSnapshot: poTemplateSnapshot } : {}),
  }).returning();
  if (lines.length > 0) {
    await db.insert(vendorInvoiceLinesTable).values(
      lines.map((l) => ({
        invoiceId: vi!.id,
        productId: l.productId ? Number(l.productId) : undefined,
        name: String(l.name ?? ""),
        quantity: String(l.quantity ?? "1"),
        unit: String(l.unit ?? "pcs"),
        unitCost: String(l.unitCost ?? "0"),
        subtotal: String(num(l.quantity) * num(l.unitCost)),
        taxAmount: String(l.taxAmount ?? "0"),
        notes: l.notes ? String(l.notes) : undefined,
      }))
    );
  }
  res.json(vi);
});

router.put("/vendor-invoices/:id", async (req, res) => {
  const id = Number(req.params.id);
  const body = req.body as Record<string, unknown>;
  const lines = (body.lines as Record<string, unknown>[]) ?? [];
  const totalAmount = lines.reduce((s, l) => s + num(l.quantity) * num(l.unitCost), 0);
  const taxAmount = lines.reduce((s, l) => s + num(l.taxAmount), 0);
  const [vi] = await db.update(vendorInvoicesTable).set({
    vendorInvoiceRef: body.vendorInvoiceRef ? String(body.vendorInvoiceRef) : undefined,
    supplierName: body.supplierName ? String(body.supplierName) : undefined,
    poId: body.poId ? Number(body.poId) : undefined,
    grId: body.grId ? Number(body.grId) : undefined,
    invoiceDate: body.invoiceDate ? new Date(String(body.invoiceDate)) : undefined,
    dueDate: body.dueDate ? new Date(String(body.dueDate)) : undefined,
    paymentTermDays: body.paymentTermDays ? Number(body.paymentTermDays) : undefined,
    totalAmount: String(totalAmount),
    taxAmount: String(taxAmount),
    grandTotal: String(totalAmount + taxAmount),
    notes: body.notes ? String(body.notes) : undefined,
    updatedAt: new Date(),
  }).where(eq(vendorInvoicesTable.id, id)).returning();
  await db.delete(vendorInvoiceLinesTable).where(eq(vendorInvoiceLinesTable.invoiceId, id));
  if (lines.length > 0) {
    await db.insert(vendorInvoiceLinesTable).values(
      lines.map((l) => ({
        invoiceId: id,
        productId: l.productId ? Number(l.productId) : undefined,
        name: String(l.name ?? ""),
        quantity: String(l.quantity ?? "1"),
        unit: String(l.unit ?? "pcs"),
        unitCost: String(l.unitCost ?? "0"),
        subtotal: String(num(l.quantity) * num(l.unitCost)),
        taxAmount: String(l.taxAmount ?? "0"),
      }))
    );
  }
  res.json(vi);
});

router.post("/vendor-invoices/:id/post", async (req, res) => {
  const id = Number(req.params.id);
  const [vi] = await db.select().from(vendorInvoicesTable).where(eq(vendorInvoicesTable.id, id));
  if (!vi) { res.status(404).json({ error: "Not found" }); return; }
  if (vi.status !== "draft") { res.status(400).json({ error: "Already posted" }); return; }

  // 3-way match check
  let matchStatus = "unmatched";
  let matchNotes = "";
  if (vi.poId && vi.grId) {
    const [po] = await db.select().from(purchaseDocumentsTable).where(eq(purchaseDocumentsTable.id, vi.poId));
    const [gr] = await db.select().from(goodsReceiptsTable).where(eq(goodsReceiptsTable.id, vi.grId));
    if (po && gr && gr.status === "confirmed") {
      const poTotal = num(po.grandTotal);
      const viTotal = num(vi.grandTotal);
      const diff = Math.abs(poTotal - viTotal);
      if (diff < 1) { matchStatus = "matched"; matchNotes = "PO, GR, VI amounts match"; }
      else { matchStatus = "partial"; matchNotes = `Variance: ${diff.toFixed(2)}`; }
    }
  } else if (vi.poId) {
    matchStatus = "partial"; matchNotes = "No GR linked";
  }

  // Post journal
  try {
    const settings = await ensureAccountingSettings(vi.companyId ?? 1);
    const grandTotal = num(vi.grandTotal);
    const taxAmount = num(vi.taxAmount);
    const netAmount = grandTotal - taxAmount;
    const lines = [];
    // Step 3 Fix A: jika VI linked ke GR, debit GR/IR (clearing 3-way match). Jika tidak, debit akun beban pembelian.
    const debitAccId = (vi.grId && settings.grirAccountId) ? settings.grirAccountId : settings.purchaseExpenseAccountId;
    const debitDesc = (vi.grId && settings.grirAccountId) ? `GR/IR clearing ${vi.invoiceNumber}` : "Purchase expense";
    if (debitAccId) lines.push({ accountId: debitAccId, debit: netAmount, credit: 0, description: debitDesc });
    if (taxAmount > 0 && settings.ppnInputAccountId) lines.push({ accountId: settings.ppnInputAccountId!, debit: taxAmount, credit: 0, description: "VAT in" });
    if (settings.apAccountId) lines.push({ accountId: settings.apAccountId!, debit: 0, credit: grandTotal, description: "AP vendor invoice" });
    if (lines.length >= 2) {
      const entry = await postEntry({ journalId: settings.purchaseJournalId!, date: new Date(), ref: vi.invoiceNumber, description: `Vendor Invoice ${vi.invoiceNumber}`, source: "purchase_bill", sourceId: id, companyId: vi.companyId ?? 1, lines }, "PUR");
      await db.update(vendorInvoicesTable).set({ status: "posted", threeWayMatchStatus: matchStatus, matchNotes, journalEntryId: entry.id, updatedAt: new Date() }).where(eq(vendorInvoicesTable.id, id));
    } else {
      await db.update(vendorInvoicesTable).set({ status: "posted", threeWayMatchStatus: matchStatus, matchNotes, updatedAt: new Date() }).where(eq(vendorInvoicesTable.id, id));
    }
  } catch (e) { console.error("[VI post]", e); await db.update(vendorInvoicesTable).set({ status: "posted", updatedAt: new Date() }).where(eq(vendorInvoicesTable.id, id)); }

  const [updated] = await db.select().from(vendorInvoicesTable).where(eq(vendorInvoicesTable.id, id));
  res.json(updated);
});

router.post("/vendor-invoices/:id/cancel", async (req, res) => {
  await db.update(vendorInvoicesTable).set({ status: "cancelled", cancelledAt: new Date(), updatedAt: new Date() }).where(eq(vendorInvoicesTable.id, Number(req.params.id)));
  res.json({ ok: true });
});

// ─────────────────────────────────────────────────────────────────────────────
// PAYMENT REQUESTS
// ─────────────────────────────────────────────────────────────────────────────

router.get("/payment-requests", async (req, res) => {
  const companyId = resolveCompanyId(req as Parameters<typeof resolveCompanyId>[0]);
  const rows = await db.select().from(paymentRequestsTable)
    .where(eq(paymentRequestsTable.companyId, companyId))
    .orderBy(desc(paymentRequestsTable.createdAt));
  res.json(rows);
});

router.get("/payment-requests/:id", async (req, res) => {
  const id = Number(req.params.id);
  const [pr] = await db.select().from(paymentRequestsTable).where(eq(paymentRequestsTable.id, id));
  if (!pr) { res.status(404).json({ error: "Not found" }); return; }
  const items = await db.select().from(paymentRequestItemsTable).where(eq(paymentRequestItemsTable.paymentRequestId, id));
  res.json({ ...pr, items });
});

router.post("/payment-requests", async (req, res) => {
  const body = req.body as Record<string, unknown>;
  const companyId = resolveCompanyId(req as Parameters<typeof resolveCompanyId>[0]);
  const payReqNumber = await nextSeq("payment_requests", "PAY", "pay_req_number");
  const items = (body.items as Record<string, unknown>[]) ?? [];
  const totalAmount = items.reduce((s, i) => s + num(i.amount), 0);
  const [pr] = await db.insert(paymentRequestsTable).values({
    payReqNumber,
    companyId,
    supplierId: body.supplierId ? Number(body.supplierId) : undefined,
    supplierName: String(body.supplierName ?? ""),
    requestedBy: body.requestedBy ? String(body.requestedBy) : undefined,
    totalAmount: String(totalAmount),
    paymentMethod: body.paymentMethod ? String(body.paymentMethod) : undefined,
    bankAccount: body.bankAccount ? String(body.bankAccount) : undefined,
    notes: body.notes ? String(body.notes) : undefined,
  }).returning();
  if (items.length > 0) {
    await db.insert(paymentRequestItemsTable).values(
      items.map((i) => ({
        paymentRequestId: pr!.id,
        vendorInvoiceId: i.vendorInvoiceId ? Number(i.vendorInvoiceId) : undefined,
        description: String(i.description ?? ""),
        amount: String(i.amount ?? "0"),
      }))
    );
  }
  res.json(pr);
});

router.post("/payment-requests/:id/action", async (req, res) => {
  const id = Number(req.params.id);
  const { action, approvedBy, paymentMethod, bankAccount, paymentDate } = req.body as Record<string, string>;
  const [pr] = await db.select().from(paymentRequestsTable).where(eq(paymentRequestsTable.id, id));
  if (!pr) { res.status(404).json({ error: "Not found" }); return; }

  if (action === "submit") {
    await db.update(paymentRequestsTable).set({ status: "submitted", updatedAt: new Date() }).where(eq(paymentRequestsTable.id, id));
  } else if (action === "approve") {
    await db.update(paymentRequestsTable).set({ status: "approved", approvedBy: approvedBy ?? null, approvedAt: new Date(), updatedAt: new Date() }).where(eq(paymentRequestsTable.id, id));
  } else if (action === "reject") {
    await db.update(paymentRequestsTable).set({ status: "rejected", updatedAt: new Date() }).where(eq(paymentRequestsTable.id, id));
  } else if (action === "pay") {
    const paidDate = paymentDate ? new Date(paymentDate) : new Date();
    const items = await db.select().from(paymentRequestItemsTable).where(eq(paymentRequestItemsTable.paymentRequestId, id));
    // Post payment journal
    try {
      const settings = await ensureAccountingSettings(pr.companyId ?? 1);
      const totalAmount = num(pr.totalAmount);
      if (settings.apAccountId && settings.defaultBankAccountId) {
        const entry = await postEntry({
          journalId: settings.bankJournalId ?? settings.purchaseJournalId!,
          date: paidDate,
          ref: pr.payReqNumber,
          description: `Payment to ${pr.supplierName}`,
          source: "purchase_payment",
          sourceId: id,
          companyId: pr.companyId ?? 1,
          lines: [
            { accountId: settings.apAccountId!, debit: totalAmount, credit: 0, description: "AP settlement" },
            { accountId: settings.defaultBankAccountId!, debit: 0, credit: totalAmount, description: "Bank/Cash out" },
          ],
        }, "BANK");
        await db.update(paymentRequestsTable).set({ status: "paid", paidAmount: pr.totalAmount, paymentMethod: paymentMethod ?? null, bankAccount: bankAccount ?? null, paymentDate: paidDate, journalEntryId: entry.id, updatedAt: new Date() }).where(eq(paymentRequestsTable.id, id));
      } else {
        await db.update(paymentRequestsTable).set({ status: "paid", paidAmount: pr.totalAmount, paymentDate: paidDate, updatedAt: new Date() }).where(eq(paymentRequestsTable.id, id));
      }
    } catch (e) {
      console.error("[payment]", e);
      await db.update(paymentRequestsTable).set({ status: "paid", paidAmount: pr.totalAmount, paymentDate: paidDate, updatedAt: new Date() }).where(eq(paymentRequestsTable.id, id));
    }
    // Update vendor invoices as paid
    for (const item of items) {
      if (item.vendorInvoiceId) {
        const [vi] = await db.select().from(vendorInvoicesTable).where(eq(vendorInvoicesTable.id, item.vendorInvoiceId));
        if (vi) {
          const newPaid = num(vi.amountPaid) + num(item.amount);
          const isPaid = newPaid >= num(vi.grandTotal);
          await db.update(vendorInvoicesTable).set({ amountPaid: String(newPaid), status: isPaid ? "paid" : vi.status, updatedAt: new Date() }).where(eq(vendorInvoicesTable.id, item.vendorInvoiceId));
        }
      }
    }
  } else if (action === "cancel") {
    await db.update(paymentRequestsTable).set({ status: "cancelled", cancelledAt: new Date(), updatedAt: new Date() }).where(eq(paymentRequestsTable.id, id));
  }

  const [updated] = await db.select().from(paymentRequestsTable).where(eq(paymentRequestsTable.id, id));
  res.json(updated);
});

// ─────────────────────────────────────────────────────────────────────────────
// LANDED COSTS
// ─────────────────────────────────────────────────────────────────────────────

router.get("/landed-costs", async (req, res) => {
  const companyId = resolveCompanyId(req as Parameters<typeof resolveCompanyId>[0]);
  const rows = await db.select().from(landedCostsTable)
    .where(eq(landedCostsTable.companyId, companyId))
    .orderBy(desc(landedCostsTable.createdAt));
  res.json(rows);
});

router.get("/landed-costs/:id", async (req, res) => {
  const id = Number(req.params.id);
  const [lc] = await db.select().from(landedCostsTable).where(eq(landedCostsTable.id, id));
  if (!lc) { res.status(404).json({ error: "Not found" }); return; }
  const lines = await db.select().from(landedCostLinesTable).where(eq(landedCostLinesTable.lcId, id));
  const allocations = await db.select().from(landedCostAllocationsTable).where(eq(landedCostAllocationsTable.lcId, id));
  res.json({ ...lc, lines, allocations });
});

router.post("/landed-costs", async (req, res) => {
  const body = req.body as Record<string, unknown>;
  const companyId = resolveCompanyId(req as Parameters<typeof resolveCompanyId>[0]);
  const lcNumber = await nextSeq("landed_costs", "LC", "lc_number");
  const costLines = (body.lines as Record<string, unknown>[]) ?? [];
  const totalCost = costLines.reduce((s, l) => s + num(l.amount), 0);
  const [lc] = await db.insert(landedCostsTable).values({
    lcNumber,
    companyId,
    grId: body.grId ? Number(body.grId) : undefined,
    poId: body.poId ? Number(body.poId) : undefined,
    allocationMethod: (body.allocationMethod as "equal" | "by_quantity" | "by_amount" | "by_weight" | "by_volume") ?? "by_amount",
    totalCost: String(totalCost),
    notes: body.notes ? String(body.notes) : undefined,
    createdBy: body.createdBy ? String(body.createdBy) : undefined,
  }).returning();
  if (costLines.length > 0) {
    await db.insert(landedCostLinesTable).values(
      costLines.map((l) => ({
        lcId: lc!.id,
        description: String(l.description ?? ""),
        amount: String(l.amount ?? "0"),
        supplierId: l.supplierId ? Number(l.supplierId) : undefined,
        accountId: l.accountId ? Number(l.accountId) : undefined,
      }))
    );
  }
  res.json(lc);
});

router.post("/landed-costs/:id/allocate", async (req, res) => {
  const id = Number(req.params.id);
  const [lc] = await db.select().from(landedCostsTable).where(eq(landedCostsTable.id, id));
  if (!lc || !lc.grId) { res.status(400).json({ error: "No GR linked" }); return; }

  const grLines = await db.select().from(goodsReceiptLinesTable).where(eq(goodsReceiptLinesTable.grId, lc.grId));
  const totalCost = num(lc.totalCost);
  let allocations: { productId: number | null; name: string; grLineId: number; amount: number }[] = [];

  if (lc.allocationMethod === "equal") {
    const perLine = totalCost / grLines.length;
    allocations = grLines.map((l) => ({ grLineId: l.id, productId: l.productId ?? null, name: l.name, amount: perLine }));
  } else if (lc.allocationMethod === "by_quantity") {
    const totalQty = grLines.reduce((s, l) => s + num(l.qtyReceived), 0);
    allocations = grLines.map((l) => ({ grLineId: l.id, productId: l.productId ?? null, name: l.name, amount: totalQty > 0 ? totalCost * num(l.qtyReceived) / totalQty : 0 }));
  } else {
    const totalValue = grLines.reduce((s, l) => s + num(l.subtotal), 0);
    allocations = grLines.map((l) => ({ grLineId: l.id, productId: l.productId ?? null, name: l.name, amount: totalValue > 0 ? totalCost * num(l.subtotal) / totalValue : 0 }));
  }

  await db.delete(landedCostAllocationsTable).where(eq(landedCostAllocationsTable.lcId, id));
  if (allocations.length > 0) {
    await db.insert(landedCostAllocationsTable).values(
      allocations.map((a) => ({ lcId: id, grLineId: a.grLineId, productId: a.productId, name: a.name, allocatedAmount: String(a.amount.toFixed(2)) }))
    );
  }
  await db.update(landedCostsTable).set({ status: "posted", updatedAt: new Date() }).where(eq(landedCostsTable.id, id));
  res.json({ allocations });
});

// ─────────────────────────────────────────────────────────────────────────────
// PO APPROVAL (add to existing PO flow)
// ─────────────────────────────────────────────────────────────────────────────

router.get("/po-approvals/:poId", async (req, res) => {
  const poId = Number(req.params.poId);
  const rows = await db.select().from(purchaseApprovalsTable)
    .where(and(eq(purchaseApprovalsTable.docType, "PO"), eq(purchaseApprovalsTable.docId, poId)))
    .orderBy(purchaseApprovalsTable.step);
  res.json(rows);
});

router.post("/po-approvals/:poId/action", async (req, res) => {
  const poId = Number(req.params.poId);
  const { action, notes, approverName, approverId } = req.body as Record<string, string>;
  if (action === "submit") {
    await db.insert(purchaseApprovalsTable).values({ docType: "PO", docId: poId, step: 1, status: "pending", approverName: approverName ?? null, approverId: approverId ?? null });
    await db.update(purchaseDocumentsTable).set({ status: "sent", updatedAt: new Date() }).where(eq(purchaseDocumentsTable.id, poId));
  } else if (action === "approve") {
    const [pending] = await db.select().from(purchaseApprovalsTable)
      .where(and(eq(purchaseApprovalsTable.docType, "PO"), eq(purchaseApprovalsTable.docId, poId), eq(purchaseApprovalsTable.status, "pending")))
      .orderBy(purchaseApprovalsTable.step).limit(1);
    if (pending) await db.update(purchaseApprovalsTable).set({ status: "approved", notes: notes ?? null, approvedAt: new Date() }).where(eq(purchaseApprovalsTable.id, pending.id));
    await db.update(purchaseDocumentsTable).set({ status: "confirmed", confirmedAt: new Date(), receiveStatus: "to_receive", updatedAt: new Date() }).where(eq(purchaseDocumentsTable.id, poId));
  } else if (action === "reject") {
    const [pending] = await db.select().from(purchaseApprovalsTable)
      .where(and(eq(purchaseApprovalsTable.docType, "PO"), eq(purchaseApprovalsTable.docId, poId), eq(purchaseApprovalsTable.status, "pending")))
      .limit(1);
    if (pending) await db.update(purchaseApprovalsTable).set({ status: "rejected", notes: notes ?? null, rejectedAt: new Date() }).where(eq(purchaseApprovalsTable.id, pending.id));
    await db.update(purchaseDocumentsTable).set({ status: "cancelled", cancelledAt: new Date(), updatedAt: new Date() }).where(eq(purchaseDocumentsTable.id, poId));
  }
  const [updated] = await db.select().from(purchaseDocumentsTable).where(eq(purchaseDocumentsTable.id, poId));
  res.json(updated);
});

export default router;
