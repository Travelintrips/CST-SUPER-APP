import { Router } from "express";
import {
  db,
  customersTable,
  salesDocumentsTable,
  salesDocumentLinesTable,
  accountingTaxesTable,
  freightShipmentsTable,
  suppliersTable,
  emailCorrespondencesTable,
  waAiIntakeLogTable,
  customerInvoiceLinksTable,
} from "@workspace/db";
import { eq, sql, desc, and, count, inArray, or, ilike, isNotNull, asc, type SQL } from "drizzle-orm";
import { requireAdmin } from "../lib/requireAdmin.js";
import { auditFromReq, writeAuditLog, extractRequestMeta } from "../lib/auditLog.js";
import { streamInvoicePdf, buildInvoicePdfBuffer } from "../lib/pdfInvoice.js";
import { loadDocTemplate } from "../lib/docTemplateLoader.js";
import { postSalesInvoice, postSalesCogs, postSalesCogsReturn, postSalesInvoiceReversal, postSalesReturn } from "../lib/accounting.js";
import { sendMail, isSmtpConfigured } from "../lib/mailer.js";
import { ensureAccountingSettings } from "../lib/accountingSeed.js";
import { sendViaService as sendWhatsApp } from "../lib/waTransport.js";
import { markSalesReadyToInvoice } from "../lib/services/invoiceStatusService.js";
import { getAdminWa } from "../lib/adminWa.js";
import {
  sendSalesOrderCreatedNotification,
  sendQuotationSentNotification,
  sendSalesOrderConfirmedNotification,
  sendSalesOrderDeliveredNotification,
  sendInvoiceIssuedNotification,
} from "../lib/orderNotification.js";
import { notifyPaymentReminder } from "../lib/enterpriseWorkflowNotify.js";
import { wasRecentlyNotified } from "../lib/notificationLog.js";
import { saveAndBroadcast } from "../lib/notificationStore.js";
import { getVendorFilterMode } from "../lib/aiOrderIntake.js";
import { StockShortageError, postStockOut, postStockIn } from "../lib/inventoryStock.js";
import { resolveCompanyId } from "../lib/resolveCompany.js";
import { assertCompanyAccess } from "../lib/assertCompanyAccess.js";
import { convertQty } from "../lib/uomEngine.js";
import { markSalesInvoiced } from "../lib/services/index.js";
import { transitionLogisticOrderStatus } from "../lib/services/logisticOrderStatusService.js";

async function computeTax(subtotal: number, taxRateId: number | null | undefined): Promise<{ taxAmount: number; grandTotal: number }> {
  if (!taxRateId) return { taxAmount: 0, grandTotal: subtotal };
  const [tax] = await db.select().from(accountingTaxesTable).where(eq(accountingTaxesTable.id, taxRateId));
  if (!tax) return { taxAmount: 0, grandTotal: subtotal };
  const taxAmount = Math.round(subtotal * Number(tax.rate)) / 100;
  return { taxAmount, grandTotal: subtotal + taxAmount };
}

const router = Router();

router.use(async (req, res, next) => {
  if (!(await requireAdmin(req, res))) return;
  next();
});

type SalesDocKind = "quote" | "order";
type SalesInvoiceStatus = "none" | "to_invoice" | "invoiced";
type SalesDocStatus = "draft" | "sent" | "confirmed" | "done" | "cancelled";

interface LineInput {
  productId?: number | null;
  name: string;
  description?: string | null;
  quantity: number;
  unitPrice: number;
  salesUomId?: number | null;
}

/** Compute base_qty by converting quantity from salesUomId → product's base_uom_id. */
async function resolveBaseQty(line: LineInput): Promise<number | null> {
  if (!line.salesUomId || !line.productId) return null;
  try {
    const prodRow = (await db.execute(sql`
      SELECT base_uom_id FROM products WHERE id = ${line.productId} LIMIT 1
    `)).rows[0] as { base_uom_id: number | null } | undefined;
    const baseUomId = prodRow?.base_uom_id ?? null;
    if (!baseUomId || baseUomId === line.salesUomId) return Number(line.quantity);
    return await convertQty(Number(line.quantity), line.salesUomId, baseUomId);
  } catch (err) {
    console.warn("[resolveBaseQty] Failed to resolve base qty for product=%s uom=%s:", line.productId, line.salesUomId, err);
    return null;
  }
}

function serializeCustomer(c: typeof customersTable.$inferSelect) {
  return { ...c, createdAt: c.createdAt.toISOString() };
}

function serializeDoc(d: typeof salesDocumentsTable.$inferSelect) {
  return {
    ...d,
    totalAmount: Number(d.totalAmount),
    taxAmount: Number(d.taxAmount ?? 0),
    grandTotal: Number(d.grandTotal ?? d.totalAmount),
    amountPaid: Number(d.amountPaid ?? 0),
    validUntil: d.validUntil ? d.validUntil.toISOString() : null,
    expectedDate: d.expectedDate ? d.expectedDate.toISOString() : null,
    confirmedAt: d.confirmedAt ? d.confirmedAt.toISOString() : null,
    createdAt: d.createdAt.toISOString(),
    updatedAt: d.updatedAt.toISOString(),
  };
}

function serializeLine(l: typeof salesDocumentLinesTable.$inferSelect) {
  return {
    ...l,
    quantity: Number(l.quantity),
    baseQty: l.baseQty != null ? Number(l.baseQty) : null,
    unitPrice: Number(l.unitPrice),
    subtotal: Number(l.subtotal),
  };
}

async function nextDocNumber(kind: SalesDocKind, offset = 0): Promise<string> {
  const prefix = kind === "quote" ? "SQ" : "SO";
  const year = new Date().getFullYear();
  const pattern = `${prefix}/${year}/%`;
  const [row] = await db
    .select({
      maxSeq: sql<number>`COALESCE(MAX(CAST(SPLIT_PART(doc_number, '/', 3) AS int)), 0)`,
    })
    .from(salesDocumentsTable)
    .where(sql`doc_number LIKE ${pattern}`);
  const seq = (Number(row?.maxSeq ?? 0) + 1 + offset).toString().padStart(5, "0");
  return `${prefix}/${year}/${seq}`;
}

// GET /api/sales/summary
router.get("/summary", async (req, res) => {
  const companyId = resolveCompanyId(req);
  const docs = await db.select().from(salesDocumentsTable).where(eq(salesDocumentsTable.companyId, companyId));
  const customers = await db.select().from(customersTable).where(eq(customersTable.companyId, companyId));
  const quotationsCount = docs.filter((d) => d.kind === "quote").length;
  const ordersCount = docs.filter((d) => d.kind === "order").length;
  const toInvoiceCount = docs.filter(
    (d) => d.kind === "order" && d.invoiceStatus === "to_invoice",
  ).length;
  const totalRevenue = docs
    .filter((d) => d.kind === "order" && d.status !== "cancelled")
    .reduce((sum, d) => sum + Number(d.totalAmount), 0);

  const customerTotals = new Map<string, number>();
  for (const d of docs) {
    if (d.kind !== "order" || d.status === "cancelled") continue;
    const cur = customerTotals.get(d.customerName) || 0;
    customerTotals.set(d.customerName, cur + Number(d.totalAmount));
  }
  let topCustomer: string | null = null;
  let topAmount = 0;
  for (const [name, amt] of customerTotals) {
    if (amt > topAmount) {
      topAmount = amt;
      topCustomer = name;
    }
  }
  void customers;
  return res.json({ quotationsCount, ordersCount, toInvoiceCount, totalRevenue, topCustomer });
});

// GET /api/sales/dashboard-widget
router.get("/dashboard-widget", async (req, res) => {
  const companyId = resolveCompanyId(req);
  const now = new Date();
  const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);

  const docs = await db
    .select()
    .from(salesDocumentsTable)
    .where(eq(salesDocumentsTable.companyId, companyId));

  // SO aktif: kind=order, belum selesai/batal
  const activeSoCount = docs.filter(
    (d) => d.kind === "order" && d.status !== "done" && d.status !== "cancelled",
  ).length;

  // Invoice outstanding: sudah diinvoice tapi belum lunas
  const outstandingDocs = docs.filter(
    (d) =>
      d.kind === "order" &&
      d.invoiceStatus === "invoiced" &&
      (d.paymentStatus === "unpaid" || d.paymentStatus === "partial" || d.paymentStatus === "overdue"),
  );
  const outstandingInvoicesCount = outstandingDocs.length;
  const outstandingAmount = outstandingDocs.reduce(
    (sum, d) => sum + Math.max(0, Number(d.grandTotal) - Number(d.amountPaid ?? 0)),
    0,
  );

  // Revenue pipeline bulan ini: SO confirmed/done yang dibuat bulan ini
  const pipelineDocs = docs.filter(
    (d) =>
      d.kind === "order" &&
      (d.status === "confirmed" || d.status === "done") &&
      new Date(d.createdAt) >= monthStart,
  );
  const revenuePipelineThisMonth = pipelineDocs.reduce((sum, d) => sum + Number(d.grandTotal), 0);
  const revenuePipelineSoCount = pipelineDocs.length;

  // Top 3 pelanggan bulan ini berdasarkan revenue pipeline
  const customerMap = new Map<string, { revenue: number; orderCount: number }>();
  for (const d of pipelineDocs) {
    const name = d.customerName || "Tanpa Nama";
    const cur = customerMap.get(name) ?? { revenue: 0, orderCount: 0 };
    customerMap.set(name, {
      revenue: cur.revenue + Number(d.grandTotal),
      orderCount: cur.orderCount + 1,
    });
  }
  const top3Customers = [...customerMap.entries()]
    .sort((a, b) => b[1].revenue - a[1].revenue)
    .slice(0, 3)
    .map(([name, stats]) => ({ name, ...stats }));

  return res.json({
    activeSoCount,
    outstandingInvoicesCount,
    outstandingAmount,
    revenuePipelineThisMonth,
    revenuePipelineSoCount,
    top3Customers,
  });
});

// CUSTOMERS
router.get("/customers", async (req, res) => {
  const companyId = resolveCompanyId(req);
  const rows = await db.select().from(customersTable)
    .where(eq(customersTable.companyId, companyId))
    .orderBy(customersTable.name);
  return res.json(rows.map(serializeCustomer));
});

router.post("/customers", async (req, res) => {
  const companyId = resolveCompanyId(req);
  const { name, email, phone, taxId, address, notes, defaultSalesTaxId } = req.body ?? {};
  if (typeof name !== "string" || !name.trim()) {
    return res.status(400).json({ message: "name required" });
  }
  const [created] = await db
    .insert(customersTable)
    .values({ companyId, name, email, phone, taxId, address, notes, defaultSalesTaxId: defaultSalesTaxId ?? null })
    .returning();
  return res.status(201).json(serializeCustomer(created));
});

router.put("/customers/:id", async (req, res) => {
  const id = Number(req.params.id);
  if (Number.isNaN(id)) return res.status(400).json({ message: "Invalid id" });
  const [existing] = await db.select().from(customersTable).where(eq(customersTable.id, id)).limit(1);
  if (!existing) return res.status(404).json({ message: "Customer not found" });
  // IDOR guard: verify company ownership
  const companyId = resolveCompanyId(req);
  if (!await assertCompanyAccess(existing.companyId, companyId, req, res, { resourceType: "sales_customer", resourceId: id })) return;
  const { name, email, phone, taxId, address, notes, defaultSalesTaxId } = req.body ?? {};
  const patch: Record<string, unknown> = {};
  if (typeof name === "string") patch["name"] = name;
  if (email !== undefined) patch["email"] = email;
  if (phone !== undefined) patch["phone"] = phone;
  if (taxId !== undefined) patch["taxId"] = taxId;
  if (address !== undefined) patch["address"] = address;
  if (notes !== undefined) patch["notes"] = notes;
  if (defaultSalesTaxId !== undefined) patch["defaultSalesTaxId"] = defaultSalesTaxId;
  const [updated] = await db
    .update(customersTable)
    .set(patch)
    .where(eq(customersTable.id, id))
    .returning();
  if (!updated) return res.status(404).json({ message: "Customer not found" });
  return res.json(serializeCustomer(updated));
});

router.delete("/customers/:id", async (req, res) => {
  const id = Number(req.params.id);
  if (Number.isNaN(id)) return res.status(400).json({ message: "Invalid id" });
  const [existing] = await db.select().from(customersTable).where(eq(customersTable.id, id)).limit(1);
  if (!existing) return res.status(404).json({ message: "Customer not found" });
  // IDOR guard: verify company ownership
  const companyId = resolveCompanyId(req);
  if (!await assertCompanyAccess(existing.companyId, companyId, req, res, { resourceType: "sales_customer", resourceId: id })) return;
  const [deleted] = await db
    .delete(customersTable)
    .where(eq(customersTable.id, id))
    .returning();
  if (!deleted) return res.status(404).json({ message: "Customer not found" });
  return res.json({ message: "Deleted", id });
});

// POST /api/sales/customers/bulk-assign-company — bulk update company_id on multiple customers
router.post("/customers/bulk-assign-company", async (req, res) => {
  if (!(await requireAdmin(req, res))) return;
  const { customerIds, companyId } = req.body as { customerIds: unknown; companyId: unknown };
  if (!Array.isArray(customerIds)) return res.status(400).json({ message: "customerIds must be an array" });
  const ids = (customerIds as unknown[]).map(Number).filter(n => !Number.isNaN(n) && n > 0);
  if (ids.length === 0) return res.status(400).json({ message: "No valid customerIds" });

  const resolvedCid = resolveCompanyId(req);
  const isSuperAdmin = (req as any).user?.role === "super_admin";
  const meta = extractRequestMeta(req);

  // ── Ownership: verify ALL customerIds belong to resolvedCompanyId ──────────
  const ownedCustomers = await db
    .select({ id: customersTable.id, companyId: customersTable.companyId })
    .from(customersTable)
    .where(inArray(customersTable.id, ids));
  const missingIds = ids.filter(id => !ownedCustomers.find(c => c.id === id));
  if (missingIds.length > 0)
    return res.status(404).json({ message: `Customer tidak ditemukan: ${missingIds.join(", ")}` });
  const unauthorizedCustomers = isSuperAdmin ? [] : ownedCustomers.filter(
    c => c.companyId !== null && c.companyId !== resolvedCid
  );
  if (unauthorizedCustomers.length > 0) {
    writeAuditLog({
      ...meta, companyId: resolvedCid, action: "BULK_OPERATION_DENIED", module: "sales",
      newData: {
        operationType: "bulk-assign-company", resourceType: "customer",
        unauthorizedIds: unauthorizedCustomers.map(c => c.id),
        timestamp: new Date().toISOString(),
      },
    });
    return res.status(403).json({
      message: "Akses ditolak: beberapa customer bukan milik perusahaan ini",
      unauthorizedIds: unauthorizedCustomers.map(c => c.id),
    });
  }

  const cid = companyId != null && companyId !== "" ? Number(companyId) : null;

  writeAuditLog({
    ...meta, companyId: resolvedCid, action: "BULK_OPERATION_VERIFIED", module: "sales",
    newData: {
      operationType: "bulk-assign-company", resourceType: "customer",
      recordCount: ids.length, targetCompanyId: cid, timestamp: new Date().toISOString(),
    },
  });

  await db.update(customersTable).set({ companyId: cid }).where(inArray(customersTable.id, ids));
  return res.json({ updated: ids.length, companyId: cid });
});

// DOCUMENTS
router.get("/documents/template-categories", async (req, res) => {
  const companyId = resolveCompanyId(req);
  const kind = req.query["kind"] as "quote" | "order" | undefined;
  const conds: SQL[] = [
    eq(salesDocumentsTable.companyId, companyId),
    isNotNull(salesDocumentsTable.categoryKey),
  ];
  if (kind === "quote" || kind === "order") conds.push(eq(salesDocumentsTable.kind, kind));
  const rows = await db
    .selectDistinct({ categoryKey: salesDocumentsTable.categoryKey })
    .from(salesDocumentsTable)
    .where(and(...conds))
    .orderBy(asc(salesDocumentsTable.categoryKey));
  return res.json(rows.map((r) => r.categoryKey).filter(Boolean));
});

router.get("/documents", async (req, res) => {
  const companyId = resolveCompanyId(req);
  const kind = req.query["kind"] as SalesDocKind | undefined;
  const invoiceStatus = req.query["invoiceStatus"] as SalesInvoiceStatus | undefined;
  const paymentStatus = req.query["paymentStatus"] as "unpaid" | "partial" | "paid" | undefined;
  const statusFilter = req.query["status"] as string | undefined;
  const categoryKey = typeof req.query["categoryKey"] === "string" ? req.query["categoryKey"].trim() : undefined;
  const search = typeof req.query["search"] === "string" ? req.query["search"].trim() : undefined;
  const conds: SQL[] = [eq(salesDocumentsTable.companyId, companyId)];
  if (kind === "quote" || kind === "order") conds.push(eq(salesDocumentsTable.kind, kind));
  if (["draft", "sent", "confirmed", "done", "cancelled"].includes(statusFilter ?? ""))
    conds.push(eq(salesDocumentsTable.status, statusFilter as "draft" | "sent" | "confirmed" | "done" | "cancelled"));
  if (invoiceStatus === "none" || invoiceStatus === "to_invoice" || invoiceStatus === "invoiced")
    conds.push(eq(salesDocumentsTable.invoiceStatus, invoiceStatus));
  if (paymentStatus === "unpaid" || paymentStatus === "partial" || paymentStatus === "paid" || paymentStatus === "overdue")
    conds.push(eq(salesDocumentsTable.paymentStatus, paymentStatus));
  if (categoryKey) conds.push(eq(salesDocumentsTable.categoryKey, categoryKey));
  if (search) {
    conds.push(or(
      ilike(salesDocumentsTable.docNumber, `%${search}%`),
      ilike(salesDocumentsTable.customerName, `%${search}%`),
    )!);
  }
  const where = conds.length === 1 ? conds[0] : and(...conds);

  const page = Math.max(1, parseInt(String(req.query["page"] ?? "1"), 10) || 1);
  const limit = Math.min(500, Math.max(1, parseInt(String(req.query["limit"] ?? "50"), 10) || 50));
  const offset = (page - 1) * limit;

  const [{ total }] = await db.select({ total: count() }).from(salesDocumentsTable).where(where);
  const rows = await db.select().from(salesDocumentsTable).where(where).orderBy(desc(salesDocumentsTable.createdAt)).limit(limit).offset(offset);

  const customerIds = [...new Set(rows.map((r) => r.customerId).filter((id): id is number => id != null))];
  const customerMap = new Map<number, string | null>();
  if (customerIds.length > 0) {
    const customers = await db.select({ id: customersTable.id, address: customersTable.address }).from(customersTable).where(inArray(customersTable.id, customerIds));
    for (const c of customers) customerMap.set(c.id, c.address ?? null);
  }

  return res.json({
    data: rows.map((r) => ({ ...serializeDoc(r), customerAddress: r.customerId != null ? (customerMap.get(r.customerId) ?? null) : null })),
    pagination: { page, limit, total: Number(total), totalPages: Math.ceil(Number(total) / limit) },
  });
});

async function loadDocWithLines(id: number) {
  const [doc] = await db.select().from(salesDocumentsTable).where(eq(salesDocumentsTable.id, id));
  if (!doc) return null;
  const lines = await db
    .select()
    .from(salesDocumentLinesTable)
    .where(eq(salesDocumentLinesTable.documentId, id))
    .orderBy(salesDocumentLinesTable.id);
  let customerAddress: string | null = null;
  if (doc.customerId != null) {
    const [customer] = await db.select({ address: customersTable.address }).from(customersTable).where(eq(customersTable.id, doc.customerId)).limit(1);
    customerAddress = customer?.address ?? null;
  }
  return { ...serializeDoc(doc), customerAddress, lines: lines.map(serializeLine) };
}

router.get("/documents/:id", async (req, res) => {
  const id = Number(req.params.id);
  if (Number.isNaN(id)) return res.status(400).json({ message: "Invalid id" });
  const doc = await loadDocWithLines(id);
  if (!doc) return res.status(404).json({ message: "Document not found" });
  // IDOR guard: ensure document belongs to the requesting user's company
  const companyId = resolveCompanyId(req);
  if (!await assertCompanyAccess(doc.companyId, companyId, req, res, { resourceType: "sales_document", resourceId: id })) return;
  return res.json(doc);
});

router.post("/documents", async (req, res) => {
  const companyId = resolveCompanyId(req);
  const { kind, customerId, customerName, validUntil, expectedDate, notes, lines, taxRateId,
    origin, destination, transportMode, etd, eta, logisticOrderId,
    categoryKey, templateId, templateVersion, templateSnapshot } = req.body ?? {};
  if (typeof customerName !== "string" || !customerName.trim())
    return res.status(400).json({ message: "customerName required" });
  if (!Array.isArray(lines) || lines.length === 0)
    return res.status(400).json({ message: "At least one line required" });

  // Idempotency: prevent duplicate SO for same logistic order
  if (logisticOrderId != null) {
    const logOrderId = Number(logisticOrderId);
    if (!Number.isNaN(logOrderId)) {
      const [existing] = await db
        .select({ id: salesDocumentsTable.id, docNumber: salesDocumentsTable.docNumber })
        .from(salesDocumentsTable)
        .where(eq(salesDocumentsTable.logisticOrderId, logOrderId))
        .limit(1);
      if (existing) {
        return res.status(409).json({
          message: "Sales Order sudah pernah dibuat untuk logistic order ini",
          existingId: existing.id,
          existingDocNumber: existing.docNumber,
        });
      }
    }
  }

  const docKind: SalesDocKind = kind === "order" ? "order" : "quote";
  const total = (lines as LineInput[]).reduce(
    (s, l) => s + Number(l.quantity) * Number(l.unitPrice),
    0,
  );
  const { taxAmount, grandTotal } = await computeTax(total, taxRateId);

  let doc: typeof salesDocumentsTable.$inferSelect | undefined;
  let docNumber = "";
  for (let attempt = 0; attempt < 5; attempt++) {
    docNumber = await nextDocNumber(docKind, attempt);
    try {
      const [inserted] = await db
        .insert(salesDocumentsTable)
        .values({
          companyId,
          docNumber,
          kind: docKind,
          status: "draft",
          customerId: customerId ?? null,
          customerName,
          totalAmount: String(total),
          taxRateId: taxRateId ?? null,
          taxAmount: String(taxAmount),
          grandTotal: String(grandTotal),
          validUntil: validUntil ? new Date(validUntil) : null,
          expectedDate: expectedDate ? new Date(expectedDate) : null,
          notes: notes ?? null,
          origin: origin ?? null,
          destination: destination ?? null,
          transportMode: transportMode ?? null,
          etd: etd ?? null,
          eta: eta ?? null,
          logisticOrderId: (logisticOrderId != null && !Number.isNaN(Number(logisticOrderId))) ? Number(logisticOrderId) : null,
          categoryKey: categoryKey ? String(categoryKey) : null,
          templateId: templateId ? String(templateId) : null,
          templateVersion: templateVersion ? String(templateVersion) : null,
          templateSnapshot: templateSnapshot ?? null,
        })
        .returning();
      doc = inserted;
      break;
    } catch (err: unknown) {
      const code = (err as { cause?: { code?: string }; code?: string })?.cause?.code ?? (err as { code?: string })?.code;
      if (code === "23505" && attempt < 4) continue;
      throw err;
    }
  }
  if (!doc) throw new Error("Failed to create sales document after retries");

  const lineValues = await Promise.all(
    (lines as LineInput[]).map(async (l) => ({
      documentId: doc!.id,
      productId: l.productId ?? null,
      name: l.name,
      description: l.description ?? null,
      quantity: String(l.quantity),
      unitPrice: String(l.unitPrice),
      subtotal: String(Number(l.quantity) * Number(l.unitPrice)),
      salesUomId: l.salesUomId ?? null,
      baseQty: await resolveBaseQty(l).then((v) => (v != null ? String(v) : null)),
    }))
  );
  await db.insert(salesDocumentLinesTable).values(lineValues);

  auditFromReq(req, {
    action: "create",
    module: "sales",
    referenceId: String(doc.id),
    newData: { docNumber, customerName, kind: docKind, grandTotal: String(grandTotal) },
  });

  const detail = await loadDocWithLines(doc.id);

  // Notify admin via WhatsApp (fire-and-forget)
  getAdminWa().then((adminWa) =>
    sendSalesOrderCreatedNotification(docNumber, customerName, docKind, grandTotal, adminWa)
  ).catch(() => undefined);

  saveAndBroadcast("sales_doc_created", {
    type: "sales_new",
    orderId: doc.id,
    orderNumber: docNumber,
    customerName,
    companyName: null,
    grandTotal,
    docKind,
  } as Parameters<typeof saveAndBroadcast>[1] & { docKind: string }).catch(() => {});

  return res.status(201).json(detail);
});

router.put("/documents/:id", async (req, res) => {
  const id = Number(req.params.id);
  if (Number.isNaN(id)) return res.status(400).json({ message: "Invalid id" });
  const existing = await loadDocWithLines(id);
  if (!existing) return res.status(404).json({ message: "Document not found" });
  // IDOR guard
  const companyId = resolveCompanyId(req);
  if (!await assertCompanyAccess(existing.companyId, companyId, req, res, { resourceType: "sales_document", resourceId: id })) return;

  const { customerId, customerName, validUntil, expectedDate, notes, lines, kind, taxRateId,
    origin, destination, transportMode, etd, eta,
    categoryKey: patchCategoryKey, templateId: patchTemplateId, templateVersion: patchTemplateVersion, templateSnapshot: patchTemplateSnapshot } = req.body ?? {};
  const patch: Record<string, unknown> = { updatedAt: new Date() };
  if (typeof customerName === "string") patch["customerName"] = customerName;
  if (customerId !== undefined) patch["customerId"] = customerId;
  if (validUntil !== undefined) patch["validUntil"] = validUntil ? new Date(validUntil) : null;
  if (expectedDate !== undefined) patch["expectedDate"] = expectedDate ? new Date(expectedDate) : null;
  if (notes !== undefined) patch["notes"] = notes;
  if (kind === "quote" || kind === "order") patch["kind"] = kind;
  if (taxRateId !== undefined) patch["taxRateId"] = taxRateId;
  if (origin !== undefined) patch["origin"] = origin || null;
  if (destination !== undefined) patch["destination"] = destination || null;
  if (transportMode !== undefined) patch["transportMode"] = transportMode || null;
  if (etd !== undefined) patch["etd"] = etd || null;
  if (eta !== undefined) patch["eta"] = eta || null;
  if (patchCategoryKey !== undefined) patch["categoryKey"] = patchCategoryKey ? String(patchCategoryKey) : null;
  if (patchTemplateId !== undefined) patch["templateId"] = patchTemplateId ? String(patchTemplateId) : null;
  if (patchTemplateVersion !== undefined) patch["templateVersion"] = patchTemplateVersion ? String(patchTemplateVersion) : null;
  if (patchTemplateSnapshot !== undefined) patch["templateSnapshot"] = patchTemplateSnapshot ?? null;

  if (Array.isArray(lines)) {
    const total = (lines as LineInput[]).reduce(
      (s, l) => s + Number(l.quantity) * Number(l.unitPrice),
      0,
    );
    const effTaxId = taxRateId !== undefined ? taxRateId : existing.taxRateId;
    const { taxAmount, grandTotal } = await computeTax(total, effTaxId);
    patch["totalAmount"] = String(total);
    patch["taxAmount"] = String(taxAmount);
    patch["grandTotal"] = String(grandTotal);
    await db.delete(salesDocumentLinesTable).where(eq(salesDocumentLinesTable.documentId, id));
    if (lines.length > 0) {
      const putLineValues = await Promise.all(
        (lines as LineInput[]).map(async (l) => ({
          documentId: id,
          productId: l.productId ?? null,
          name: l.name,
          description: l.description ?? null,
          quantity: String(l.quantity),
          unitPrice: String(l.unitPrice),
          subtotal: String(Number(l.quantity) * Number(l.unitPrice)),
          salesUomId: l.salesUomId ?? null,
          baseQty: await resolveBaseQty(l).then((v) => (v != null ? String(v) : null)),
        }))
      );
      await db.insert(salesDocumentLinesTable).values(putLineValues);
    }
  } else if (taxRateId !== undefined) {
    const total = Number(existing.totalAmount);
    const { taxAmount, grandTotal } = await computeTax(total, taxRateId);
    patch["taxAmount"] = String(taxAmount);
    patch["grandTotal"] = String(grandTotal);
  }

  await db.update(salesDocumentsTable).set(patch).where(eq(salesDocumentsTable.id, id));
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
  if (!await assertCompanyAccess(existing.companyId, companyId, req, res, { resourceType: "sales_document", resourceId: id })) return;
  const [deleted] = await db
    .delete(salesDocumentsTable)
    .where(eq(salesDocumentsTable.id, id))
    .returning();
  if (!deleted) return res.status(404).json({ message: "Document not found" });
  auditFromReq(req, {
    action: "delete",
    module: "sales",
    referenceId: String(id),
    oldData: { docNumber: deleted.docNumber, customerName: deleted.customerName, kind: deleted.kind },
  });
  return res.json({ message: "Deleted", id });
});

router.post("/documents/:id/action", async (req, res) => {
  const id = Number(req.params.id);
  if (Number.isNaN(id)) return res.status(400).json({ message: "Invalid id" });
  const { action, cancelReason, editReason, reversalReason } = req.body ?? {};
  const actorId = (req.user as { id: string } | undefined)?.id ?? null;
  const [doc] = await db.select().from(salesDocumentsTable).where(eq(salesDocumentsTable.id, id));
  if (!doc) return res.status(404).json({ message: "Document not found" });
  // IDOR guard
  const companyId = resolveCompanyId(req);
  if (!await assertCompanyAccess(doc.companyId, companyId, req, res, { resourceType: "sales_document", resourceId: id })) return;

  const patch: Record<string, unknown> = { updatedAt: new Date() };
  switch (action) {
    case "send":
      patch["status"] = "sent" satisfies SalesDocStatus;
      break;
    case "confirm":
      patch["status"] = "confirmed" satisfies SalesDocStatus;
      patch["kind"] = "order";
      patch["confirmedAt"] = new Date();
      patch["approvedBy"] = actorId;
      patch["approvedAt"] = new Date();
      patch["deliveryStatus"] = "to_deliver";
      break;
    case "cancel":
      patch["status"] = "cancelled" satisfies SalesDocStatus;
      patch["cancelledAt"] = new Date();
      patch["cancelledBy"] = actorId;
      patch["cancelReason"] = cancelReason ?? null;
      break;
    case "draft":
      patch["status"] = "draft" satisfies SalesDocStatus;
      if (editReason) patch["editReason"] = editReason;
      break;
    case "mark_invoiced": {
      // Do not change invoice status until the revenue/tax journal exists.
      // postEntry is source-idempotent, so this also remains safe when the
      // confirm action already created the same sales_invoice entry.
      if (doc.invoiceStatus === "invoiced") {
        return res.status(409).json({ message: "Invoice sudah diterbitkan untuk dokumen ini" });
      }
      const salesPosted = await postSalesInvoice({
        salesDocId: doc.id,
        docNumber: doc.docNumber,
        customerName: doc.customerName,
        netAmount: Number(doc.totalAmount ?? 0),
        taxAmount: Number(doc.taxAmount ?? 0),
        taxAccountId: null,
        createdById: actorId,
        companyId: doc.companyId ?? null,
      });
      if (!salesPosted) {
        return res.status(422).json({
          message: "Invoice penjualan tetap draft karena jurnal pendapatan/PPN Keluaran gagal dibuat.",
        });
      }
      const invResult = await markSalesInvoiced(id, "manual");
      if (!invResult.ok || invResult.alreadySet) {
        return res.status(invResult.alreadySet ? 409 : 500).json({
          message: invResult.error ?? "Invoice sudah diterbitkan untuk dokumen ini",
        });
      }
      // Auto-numbering: INV/YYYY/NNNN
      const invYear = new Date().getFullYear();
      const [{ invCount }] = await db
        .select({ invCount: sql<number>`cast(count(*) as int)` })
        .from(salesDocumentsTable)
        .where(sql`invoice_number IS NOT NULL`);
      const invSeq = (Number(invCount) + 1).toString().padStart(4, "0");
      const invoiceNumber = `INV/${invYear}/${invSeq}`;
      const invoiceDate = new Date().toISOString().split("T")[0]!;
      // Auto due date: invoiceDate + paymentTermDays (default 30)
      const termDays = Number((doc as Record<string, unknown>)["paymentTermDays"] ?? 30);
      const dueDate = new Date(Date.now() + termDays * 24 * 60 * 60 * 1000).toISOString().split("T")[0]!;
      // invoiceStatus already set by markSalesInvoiced() above
      patch["invoiceNumber"] = invoiceNumber;
      patch["invoiceDate"] = invoiceDate;
      patch["dueDate"] = dueDate;
      if (doc.deliveryStatus === "delivered") patch["status"] = "done" satisfies SalesDocStatus;
      break;
    }
    case "cancel_invoice": {
      if (doc.invoiceStatus !== "invoiced") {
        return res.status(400).json({ message: "Hanya invoice yang sudah diposting yang bisa dibatalkan" });
      }
      patch["cancelledAt"] = new Date();
      patch["cancelledBy"] = actorId;
      patch["cancelReason"] = cancelReason ?? null;
      if (reversalReason) patch["reversalReason"] = reversalReason;
      break;
    }
    case "send_reminder":
      // Fire-and-forget: no status changes, only notifications
      break;
    case "mark_delivered":
      patch["deliveryStatus"] = "delivered";
      if (doc.invoiceStatus === "invoiced") patch["status"] = "done" satisfies SalesDocStatus;
      break;
    default:
      return res.status(400).json({ message: "Invalid action" });
  }

  // T005: Pre-flight stock check BEFORE updating delivery status (pakai wh_stock — single source of truth)
  if (action === "mark_delivered" && doc.deliveryStatus !== "delivered") {
    const lines = await db.select().from(salesDocumentLinesTable).where(eq(salesDocumentLinesTable.documentId, id));
    const productLines = lines.filter((l) => l.productId != null);

    if (productLines.length > 0) {
      // Gunakan gudang ERP pertama yang aktif (sistem gudang tunggal)
      const posWh = (await db.execute(sql`
        SELECT id FROM warehouses WHERE is_active = TRUE ORDER BY id LIMIT 1
      `)).rows[0] as { id: number } | undefined;

      if (posWh) {
        const shortages: Array<{ productId: number; name: string; requested: number; available: number }> = [];
        for (const line of productLines) {
          const qty = line.baseQty != null ? Number(line.baseQty) : Number(line.quantity);
          const stockRow = (await db.execute(sql`
            SELECT COALESCE(qty::float, 0) AS qty
            FROM wh_stock
            WHERE product_id = ${line.productId} AND warehouse_id = ${posWh.id}
            ORDER BY id LIMIT 1
          `)).rows[0] as { qty: number } | undefined;
          const available = Number(stockRow?.qty ?? 0);
          if (available < qty) {
            shortages.push({ productId: line.productId!, name: line.name, requested: qty, available });
          }
        }
        if (shortages.length > 0) {
          const detail = shortages
            .map((s) => `${s.name}: tersedia ${s.available}, diminta ${s.requested}`)
            .join("; ");
          return res.status(422).json({
            message: `Stok tidak cukup untuk pengiriman: ${detail}`,
            shortages,
          });
        }
      }
    }
  }

  // B2 FIX: Jika SO dibatalkan dan membutuhkan reversal jurnal, lakukan keduanya
  // secara atomik. Jika reversal gagal, db.transaction() rollback sehingga
  // status SO TIDAK berubah — tidak ada kondisi "SO cancelled + jurnal masih posted".
  // Untuk semua action lain, update langsung seperti sebelumnya.
  const needsJournalReversal =
    action === "cancel" &&
    (doc.status === "confirmed" ||
      doc.invoiceStatus === "invoiced" ||
      doc.invoiceStatus === "to_invoice");

  if (needsJournalReversal) {
    // B2 FIX (true atomicity): tx diteruskan ke postSalesInvoiceReversal sehingga
    // tx.update(SO) + client.select(lookup) + _postEntryCore(client, insert entry+lines)
    // semua berjalan dalam SATU PostgreSQL transaction.
    // Jika salah satu gagal → ROLLBACK semua — tidak ada SO cancelled tanpa reversal.
    await db.transaction(async (tx) => {
      await tx.update(salesDocumentsTable).set(patch).where(eq(salesDocumentsTable.id, id));
      // PgTransaction dan NodePgDatabase berbagi interface yang sama untuk select/insert/execute.
      // Cast diperlukan karena DbClient = typeof db yang menyertakan $client: Pool,
      // sedangkan PgTransaction adalah sub-type tanpa property tersebut.
      await postSalesInvoiceReversal(tx as unknown as import("../lib/accounting.js").DbClient, {
        salesDocId: doc.id,
        docNumber: doc.docNumber,
        customerName: doc.customerName,
        companyId: doc.companyId ?? null,
      });
    });
  } else {
    await db.update(salesDocumentsTable).set(patch).where(eq(salesDocumentsTable.id, id));
  }

  if (action === "confirm") {
    await markSalesReadyToInvoice(id, "system");
  }

  // ── Sync status ke Logistic Order terkait (jika ada) ─────────────────────
  if (doc.logisticOrderId != null) {
    const logisticSyncMap: Record<string, string> = {
      confirm:        "In Progress",
      mark_delivered: "Delivered",
      mark_invoiced:  "Invoice Issued",
      cancel:         "Cancelled",
    };
    const targetLogisticStatus = logisticSyncMap[action];
    if (targetLogisticStatus) {
      void transitionLogisticOrderStatus(doc.logisticOrderId, targetLogisticStatus, {
        actorType: "system",
        source:    "sales.action",
        notes:     `Auto-sync dari Sales Document #${doc.docNumber} — action: ${action}`,
      }).catch((e: unknown) =>
        console.error(`[sales] gagal sync logistic order #${doc.logisticOrderId} → ${targetLogisticStatus}:`, e),
      );
    }
  }

  // T005: When SO is delivered, deduct stock (awaited — pre-flight already passed)
  if (action === "mark_delivered" && doc.deliveryStatus !== "delivered") {
    try {
      const lines = await db.select().from(salesDocumentLinesTable).where(eq(salesDocumentLinesTable.documentId, id));
      const productLines = lines.filter((l) => l.productId != null);
      if (productLines.length === 0) {
        // nothing to deduct, fall through
      } else {
        // ── wh_stock deduction (gudang ERP — sistem tunggal) ─────────────────
        const defaultWhResult = await db.execute(sql`SELECT id FROM warehouses WHERE is_active = TRUE ORDER BY id LIMIT 1`);
        const wh = defaultWhResult.rows[0] as any;
        const legacyWhId: number | undefined = wh?.id;
        const cogsLines: Array<{ name: string; qty: number; costPrice: number }> = [];
        if (legacyWhId) {
          for (const line of productLines) {
            const qty = Number(line.quantity);
            const cur = await db.execute(sql`
              SELECT qty::float, COALESCE(cost_price::float, 0) AS cost_price
              FROM wh_stock WHERE product_id = ${line.productId} AND warehouse_id = ${legacyWhId} AND rack_id IS NULL
            `);
            const qtyBefore = Number((cur.rows[0] as any)?.qty ?? 0);
            const costPrice = Number((cur.rows[0] as any)?.cost_price ?? 0);
            const qtyAfter = Math.max(0, qtyBefore - qty);
            cogsLines.push({ name: line.name, qty, costPrice });
            await db.execute(sql`
              INSERT INTO wh_stock (product_id, warehouse_id, rack_id, qty, updated_at)
              VALUES (${line.productId}, ${legacyWhId}, NULL, ${qtyAfter}, NOW())
              ON CONFLICT ON CONSTRAINT wh_stock_product_warehouse_rack_idx
              DO UPDATE SET qty = ${qtyAfter}, updated_at = NOW()
            `);
            await db.execute(sql`
              INSERT INTO wh_movements (product_id, warehouse_id, rack_id, type, qty, qty_before, qty_after, ref_type, ref_id, note)
              VALUES (${line.productId}, ${legacyWhId}, NULL, 'so_delivery', ${qty}, ${qtyBefore}, ${qtyAfter},
                      'sales_order', ${id}, ${`SO Terkirim: ${doc.docNumber}`})
            `);
          }
        }

        // ── COGS journal entry (DR HPP / CR Persediaan) ──────────────────────
        if (cogsLines.length > 0) {
          void postSalesCogs({
            salesDocId: id,
            docNumber: doc.docNumber,
            lines: cogsLines,
            companyId: doc.companyId ?? null,
          }).catch((e) => console.error("[accounting] postSalesCogs error:", e));
        }

        // ── Sync ke inventory_stock + stock_movements (ERP) ─────────────────
        // Cari ERP warehouse: SO.warehouseId → company warehouse → fallback global
        let erpWhId: number | null = doc.warehouseId ?? null;
        if (!erpWhId) {
          if (doc.companyId) {
            const r = (await db.execute(sql`
              SELECT id FROM warehouses
              WHERE company_id = ${doc.companyId} AND is_active = TRUE
              ORDER BY id ASC LIMIT 1
            `)).rows[0] as { id: number } | undefined;
            erpWhId = r?.id ?? null;
          }
          if (!erpWhId) {
            const r = (await db.execute(sql`
              SELECT id FROM warehouses WHERE is_active = TRUE ORDER BY id ASC LIMIT 1
            `)).rows[0] as { id: number } | undefined;
            erpWhId = r?.id ?? null;
          }
        }

        if (erpWhId) {
          for (const line of productLines) {
            const qty = line.baseQty != null ? Number(line.baseQty) : Number(line.quantity);
            const costRow = (await db.execute(sql`
              SELECT average_cost::float, cost_price::float
              FROM inventory_stock WHERE product_id = ${line.productId} AND warehouse_id = ${erpWhId} LIMIT 1
            `)).rows[0] as { average_cost: number; cost_price?: number } | undefined;
            // fallback to wh_stock cost_price if no ERP record yet
            const whCostRow = (await db.execute(sql`
              SELECT cost_price::float FROM wh_stock
              WHERE product_id = ${line.productId} LIMIT 1
            `)).rows[0] as { cost_price: number } | undefined;
            const unitCost = Number(costRow?.average_cost ?? whCostRow?.cost_price ?? 0);
            try {
              await postStockOut({
                productId: line.productId!,
                warehouseId: erpWhId,
                qty,
                unitCost,
                movementType: "SALES_DELIVERY",
                referenceType: "SALES_ORDER",
                referenceId: id,
                notes: `SO Terkirim: ${doc.docNumber}`,
                strict: false,
              });
            } catch (e) {
              console.error(`[inventory] postStockOut gagal produk #${line.productId}:`, e);
            }
          }
        }
      }
    } catch (e) {
      if (e instanceof StockShortageError) {
        // Rollback delivery status
        await db.update(salesDocumentsTable)
          .set({ deliveryStatus: doc.deliveryStatus, status: doc.status })
          .where(eq(salesDocumentsTable.id, id));
        return res.status(422).json({ message: e.message });
      }
      console.error("[wh] mark_delivered stock-out error:", e);
    }
  }

  // ── WA Notifications for sales milestones ─────────────────────────────────
  // Fetch customer phone (fire-and-forget block)
  void (async () => {
    try {
      let customerPhone: string | null = null;
      if (doc.customerId != null) {
        const [cust] = await db
          .select({ phone: customersTable.phone, email: customersTable.email })
          .from(customersTable)
          .where(eq(customersTable.id, doc.customerId))
          .limit(1);
        customerPhone = cust?.phone ?? null;
      }

      const grandTotal = Number(doc.totalAmount ?? 0) + Number(doc.taxAmount ?? 0);
      const adminWa = await getAdminWa();

      if (action === "send" && doc.status !== "sent") {
        const validStr = doc.validUntil
          ? new Date(doc.validUntil).toLocaleDateString("id-ID", { day: "2-digit", month: "long", year: "numeric" })
          : "—";
        await sendQuotationSentNotification(doc.docNumber, doc.customerName, grandTotal, validStr, customerPhone, adminWa);
      }

      if (action === "confirm" && doc.status !== "confirmed") {
        const tanggal = doc.createdAt.toLocaleDateString("id-ID", { day: "2-digit", month: "long", year: "numeric" });
        const expStr = doc.expectedDate
          ? new Date(doc.expectedDate).toLocaleDateString("id-ID", { day: "2-digit", month: "long", year: "numeric" })
          : "—";
        await sendSalesOrderConfirmedNotification(doc.docNumber, doc.customerName, grandTotal, expStr, tanggal, customerPhone, adminWa);
      }

      if (action === "mark_delivered" && doc.deliveryStatus !== "delivered") {
        await sendSalesOrderDeliveredNotification(doc.docNumber, doc.customerName, grandTotal, customerPhone, adminWa);
      }

      if (action === "mark_invoiced" && doc.invoiceStatus !== "invoiced") {
        const invNumber = (patch["invoiceNumber"] as string | undefined) ?? doc.docNumber;
        const dueStr = patch["dueDate"]
          ? new Date(patch["dueDate"] as string).toLocaleDateString("id-ID", { day: "2-digit", month: "long", year: "numeric" })
          : "—";
        const subtotal = Number(doc.totalAmount ?? 0);
        const taxAmount = Number((doc as Record<string, unknown>).taxAmount ?? 0);
        const orderId = doc.logisticOrderId ?? undefined;
        let invoiceUrl: string | undefined;
        if (id) {
          try {
            const { getPreferredDomain } = await import("../lib/domain.js");
            const { gt } = await import("drizzle-orm");
            const [invLink] = await db
              .select({ token: customerInvoiceLinksTable.token })
              .from(customerInvoiceLinksTable)
              .where(
                and(
                  eq(customerInvoiceLinksTable.salesDocId, id),
                  gt(customerInvoiceLinksTable.expiresAt, new Date()),
                ),
              )
              .limit(1);
            if (invLink?.token) {
              const domain = getPreferredDomain();
              if (domain) invoiceUrl = `https://${domain}/customer-invoice/${invLink.token}`;
            }
          } catch { /* non-fatal */ }
        }
        const skipCustWa = orderId != null
          ? await wasRecentlyNotified("customer-invoice-wa", `order:${orderId}`, 30 * 60 * 1000)
          : false;
        await sendInvoiceIssuedNotification(
          doc.docNumber, invNumber, doc.customerName, grandTotal, dueStr,
          skipCustWa ? null : customerPhone,
          adminWa,
          { subtotal, taxAmount, invoiceUrl, orderId },
        );
      }

      if (action === "send_reminder") {
        const invoiceRef = doc.invoiceNumber ?? doc.docNumber;
        const dueStr = doc.dueDate
          ? new Date(doc.dueDate).toLocaleDateString("id-ID", { day: "2-digit", month: "long", year: "numeric" })
          : "—";
        const reminderTotal = Number(doc.grandTotal ?? doc.totalAmount ?? 0);
        const today = new Date();
        const dueDate = doc.dueDate ? new Date(doc.dueDate) : null;
        const daysOverdue = dueDate ? Math.floor((today.getTime() - dueDate.getTime()) / 86_400_000) : 0;
        const custEmail = (doc.customerId != null
          ? (await db.select({ email: customersTable.email }).from(customersTable).where(eq(customersTable.id, doc.customerId)).limit(1))[0]?.email
          : null) ?? null;

        await notifyPaymentReminder({
          invoiceNumber: invoiceRef,
          customerName: doc.customerName,
          customerPhone: customerPhone ?? undefined,
          dueDate: dueStr,
          totalAmount: reminderTotal,
          daysUntilDue: -daysOverdue,
        });

        if (custEmail && isSmtpConfigured()) {
          const amountStr = `Rp ${Math.round(reminderTotal).toLocaleString("id-ID")}`;
          sendMail({
            to: custEmail,
            subject: daysOverdue > 0
              ? `Pengingat Pembayaran — Invoice ${invoiceRef} (${daysOverdue} hari jatuh tempo)`
              : `Pengingat Pembayaran — Invoice ${invoiceRef}`,
            text: `Kepada Yth. ${doc.customerName},\n\nIni adalah pengingat untuk pembayaran Invoice ${invoiceRef}.\nJumlah: ${amountStr}\nJatuh Tempo: ${dueStr}\n\nMohon segera melakukan pembayaran. Hubungi kami jika ada pertanyaan.\n\nTerima kasih,\nTim Finance`,
            html: `<p>Kepada Yth. <strong>${doc.customerName}</strong>,</p><p>Ini adalah pengingat untuk pembayaran Invoice <strong>${invoiceRef}</strong>.</p><ul><li>Jumlah: <strong>${amountStr}</strong></li><li>Jatuh Tempo: ${dueStr}</li></ul><p>Mohon segera melakukan pembayaran. Hubungi kami jika ada pertanyaan.</p><p>Terima kasih,<br>Tim Finance</p>`,
            context: `reminder_manual_${invoiceRef}`,
            refType: "invoice",
            refId: invoiceRef,
          }).catch(() => {});
        }
      }
    } catch (_e) {
      // fire-and-forget — jangan sampai gagal notif membatalkan response
    }
  })();

  // Auto-post journal entry when order is newly confirmed (Debit AR / Credit Revenue)
  if (
    action === "confirm" &&
    doc.status !== "confirmed"
  ) {
    const net = Number(doc.totalAmount);
    const taxAmount = Number(doc.taxAmount ?? 0);
    void postSalesInvoice({
      salesDocId: doc.id,
      docNumber: doc.docNumber,
      customerName: doc.customerName,
      netAmount: net,
      taxAmount,
      taxAccountId: null,
      companyId: doc.companyId ?? null,
    });
    if (taxAmount > 0 && doc.companyId != null) {
      const { recordTransactionTax } = await import("../lib/taxAutoService.js");
      void recordTransactionTax({
        companyId: doc.companyId,
        transactionType: "sales_order",
        transactionId: doc.id,
        transactionRef: doc.docNumber,
        baseAmount: net,
        taxAmount,
      });
    } else if (taxAmount > 0) {
      console.warn(`[sales] tax capture skipped for ${doc.docNumber}: company context is missing`);
    }
  }

  const detail = await loadDocWithLines(id);

  // Broadcast real-time notification to admin SSE clients
  const actionLabels: Record<string, string> = {
    send: "Dikirim ke Customer",
    confirm: "Dikonfirmasi sebagai Sales Order",
    cancel: "Dibatalkan",
    draft: "Dikembalikan ke Draft",
    mark_invoiced: "Invoice Dibuat",
    cancel_invoice: "Invoice Dibatalkan",
    mark_delivered: "Tandai Terkirim",
    send_reminder: "Reminder Pembayaran Dikirim",
  };
  saveAndBroadcast("sales_order_update", {
    type: "sales_update",
    orderId: id,
    orderNumber: doc.docNumber,
    customerName: doc.customerName,
    companyName: null,
    action,
    actionLabel: actionLabels[action] ?? action,
    newStatus: (patch["status"] as string | undefined) ?? doc.status,
    grandTotal: Number(doc.totalAmount ?? 0) + Number(doc.taxAmount ?? 0),
    updatedAt: new Date().toISOString(),
  }).catch(() => {});

  auditFromReq(req, {
    action,
    module: "sales",
    referenceId: String(id),
    newData: {
      docNumber: doc.docNumber,
      customerName: doc.customerName,
      fromStatus: doc.status,
      toStatus: (patch["status"] as string | undefined) ?? doc.status,
      ...(patch["invoiceNumber"] ? { invoiceNumber: patch["invoiceNumber"] } : {}),
    },
  });

  return res.json(detail);
});

// ── Sales Return: POST /api/sales/documents/:id/return ───────────────────────
// Body: { reason?: string, warehouseId?: number,
//        lines?: Array<{ productId: number; qty: number }> }
// Kembalikan stok ke wh_stock + inventory_stock, buat RETURN_IN movements,
// posting akuntansi reversal HPP.
router.post("/documents/:id/return", async (req, res) => {
  const id = Number(req.params.id);
  if (Number.isNaN(id)) return res.status(400).json({ message: "Invalid id" });

  const [doc] = await db.select().from(salesDocumentsTable).where(eq(salesDocumentsTable.id, id));
  if (!doc) return res.status(404).json({ message: "Document tidak ditemukan" });
  // IDOR guard
  const companyIdReturn = resolveCompanyId(req);
  if (!await assertCompanyAccess(doc.companyId, companyIdReturn, req, res, { resourceType: "sales_document", resourceId: id })) return;
  if (doc.deliveryStatus !== "delivered") {
    return res.status(400).json({ message: "Hanya SO yang sudah terkirim yang bisa diretur" });
  }

  const { reason, warehouseId: bodyWhId, lines: bodyLines } = req.body as {
    reason?: string;
    warehouseId?: number;
    lines?: Array<{ productId: number; qty: number }>;
  };

  // Ambil semua lines dari SO
  const docLines = await db.select().from(salesDocumentLinesTable)
    .where(eq(salesDocumentLinesTable.documentId, id));
  const productLines = docLines.filter((l) => l.productId != null);

  if (productLines.length === 0) {
    return res.status(400).json({ message: "Tidak ada item produk untuk diretur" });
  }

  // Resolve quantity per productId dari bodyLines (atau full qty)
  const returnQtyMap = new Map<number, number>();
  if (bodyLines && bodyLines.length > 0) {
    for (const bl of bodyLines) {
      returnQtyMap.set(bl.productId, bl.qty);
    }
  } else {
    for (const l of productLines) {
      returnQtyMap.set(l.productId!, Number(l.quantity));
    }
  }

  // ── Resolve ERP warehouse ─────────────────────────────────────────────────
  let erpWhId: number | null = bodyWhId ?? doc.warehouseId ?? null;
  if (!erpWhId && doc.companyId) {
    const r = (await db.execute(sql`
      SELECT id FROM warehouses
      WHERE company_id = ${doc.companyId} AND is_active = TRUE
      ORDER BY id ASC LIMIT 1
    `)).rows[0] as { id: number } | undefined;
    erpWhId = r?.id ?? null;
  }
  if (!erpWhId) {
    const r = (await db.execute(sql`
      SELECT id FROM warehouses WHERE is_active = TRUE ORDER BY id ASC LIMIT 1
    `)).rows[0] as { id: number } | undefined;
    erpWhId = r?.id ?? null;
  }

  // ── Resolve gudang ERP (sistem tunggal) ──────────────────────────────────
  const posWhRow = (await db.execute(sql`
    SELECT id FROM warehouses WHERE is_active = TRUE ORDER BY id ASC LIMIT 1
  `)).rows[0] as { id: number } | undefined;
  const posWhId = posWhRow?.id ?? null;

  const returnedLines: Array<{ name: string; qty: number; costPrice: number }> = [];
  const warnings: string[] = [];
  const returnNo = `RTN-SO/${new Date().getFullYear()}/${String(id).padStart(5, "0")}`;

  for (const line of productLines) {
    const qty = returnQtyMap.get(line.productId!) ?? 0;
    if (qty <= 0) continue;

    const note = `Retur: ${returnNo} — ${doc.docNumber} (${reason ?? "tanpa alasan"})`;

    // ── wh_stock: kembalikan stok ke POS warehouse ────────────────────────
    if (posWhId) {
      await db.execute(sql`
        INSERT INTO wh_stock (product_id, warehouse_id, rack_id, qty, updated_at)
        VALUES (${line.productId}, ${posWhId}, NULL, ${qty}, NOW())
        ON CONFLICT ON CONSTRAINT wh_stock_product_warehouse_rack_idx
        DO UPDATE SET qty = wh_stock.qty + ${qty}, updated_at = NOW()
      `);
      await db.execute(sql`
        INSERT INTO wh_movements (product_id, warehouse_id, rack_id, type, qty, qty_before, qty_after, ref_type, ref_id, note)
        SELECT ${line.productId}, ${posWhId}, NULL, 'return_in',
               ${qty},
               COALESCE((SELECT qty FROM wh_stock WHERE product_id = ${line.productId} AND warehouse_id = ${posWhId}), 0) - ${qty},
               COALESCE((SELECT qty FROM wh_stock WHERE product_id = ${line.productId} AND warehouse_id = ${posWhId}), 0),
               'sales_order', ${id}, ${note}
      `);
    }

    // ── inventory_stock: kembalikan stok ke ERP warehouse ────────────────
    let unitCost = 0;
    if (erpWhId) {
      const costRow = (await db.execute(sql`
        SELECT average_cost::float FROM inventory_stock
        WHERE product_id = ${line.productId} AND warehouse_id = ${erpWhId} LIMIT 1
      `)).rows[0] as { average_cost: number } | undefined;
      unitCost = Number(costRow?.average_cost ?? 0);
      try {
        await postStockIn({
          productId: line.productId!,
          warehouseId: erpWhId,
          qty,
          unitCost,
          movementType: "RETURN_IN",
          referenceType: "RETURN",
          referenceId: id,
          notes: note,
        });
      } catch (e) {
        warnings.push(`ERP sync gagal produk #${line.productId}: ${(e as Error).message}`);
      }
    }

    returnedLines.push({ name: line.name, qty, costPrice: unitCost });
  }

  // ── Accounting reversal: DR Persediaan / CR HPP ───────────────────────────
  if (returnedLines.length > 0) {
    void postSalesCogsReturn({
      salesDocId: id,
      docNumber: doc.docNumber,
      lines: returnedLines,
      companyId: doc.companyId ?? null,
    }).catch((e) => console.error("[accounting] postSalesCogsReturn error:", e));
  }

  // ── Credit Note: DR Pendapatan (+ DR PPN Keluaran) / CR Piutang ───────────
  // Hanya jika SO sudah diinvoice
  if (doc.invoiceStatus === "invoiced" && returnedLines.length > 0) {
    // Hitung nilai retur berdasarkan harga jual dari baris yang diretur
    let returnNetAmount = 0;
    for (const l of productLines) {
      const rQty = returnQtyMap.get(l.productId!) ?? 0;
      if (rQty > 0) {
        // Fallback: jika unitPrice null/0, hitung dari subtotal/qty
        const qty = Math.max(Number(l.quantity ?? 1), 1);
        const unitPriceN =
          Number(l.unitPrice ?? 0) ||
          (Number((l as any).subtotal ?? 0) / qty);
        returnNetAmount += rQty * unitPriceN;
      }
    }
    // Hitung PPN proporsional
    const docNet = Number(doc.totalAmount ?? 0);
    const docTax = Number(doc.taxAmount ?? 0);
    const returnTaxAmount =
      docNet > 0 && docTax > 0 && returnNetAmount > 0
        ? Math.round((returnNetAmount * docTax / docNet) * 100) / 100
        : 0;

    if (returnNetAmount > 0) {
      void postSalesReturn({
        returnId: id,
        returnNumber: returnNo,
        customerName: String(doc.customerName ?? ""),
        netAmount: returnNetAmount,
        taxAmount: returnTaxAmount,
        companyId: doc.companyId ?? null,
      }).catch((e) => console.error("[accounting] postSalesReturn error:", e));

      // ── FASE 4 C3: Auto-reverse transaction tax untuk credit note ────────────
      if (returnTaxAmount > 0 && doc.companyId) {
        const { reverseTransactionTax } = await import("../lib/taxAutoService.js");
        void reverseTransactionTax({
          companyId: doc.companyId,
          transactionType: "sales_order",
          transactionId: id,
        });
      }
    }
  }

  return res.json({
    message: "Retur berhasil diproses",
    returnNumber: returnNo,
    salesDocId: id,
    salesDocNumber: doc.docNumber,
    linesReturned: returnedLines.length,
    warnings,
  });
});

router.get("/documents/:id/pdf", async (req, res): Promise<void> => {
  const id = Number(req.params.id);
  if (Number.isNaN(id)) { res.status(400).json({ message: "Invalid id" }); return; }
  const detail = await loadDocWithLines(id);
  if (!detail) { res.status(404).json({ message: "Document not found" }); return; }
  // IDOR guard
  const companyIdPdf = resolveCompanyId(req);
  if (!await assertCompanyAccess(detail.companyId, companyIdPdf, req, res, { resourceType: "sales_document", resourceId: id })) return;
  let customer: typeof customersTable.$inferSelect | null = null;
  if (detail.customerId) {
    const rows = await db.select().from(customersTable).where(eq(customersTable.id, detail.customerId)).limit(1);
    customer = rows[0] ?? null;
  }
  const titleMap: Record<string, string> = {
    quote: "QUOTATION",
    order: "SALES ORDER",
  };
  const tplType = detail.kind === "quote" ? "quotation" : "invoice";
  const [acctSettings, template] = await Promise.all([
    ensureAccountingSettings(),
    loadDocTemplate(tplType),
  ]);
  streamInvoicePdf(res, {
    title: titleMap[detail.kind] ?? "DOKUMEN PENJUALAN",
    docNumber: detail.docNumber,
    status: detail.status,
    kind: detail.kind,
    companyName: acctSettings.companyName,
    companyAddress: acctSettings.companyAddress,
    companyNpwp: acctSettings.companyNpwp,
    partyLabel: "Pelanggan",
    partyName: detail.customerName,
    partyEmail: customer?.email ?? null,
    partyPhone: customer?.phone ?? null,
    partyAddress: customer?.address ?? null,
    partyTaxId: customer?.taxId ?? null,
    validUntil: detail.validUntil,
    expectedDate: detail.expectedDate,
    confirmedAt: detail.confirmedAt,
    createdAt: detail.createdAt,
    notes: detail.notes,
    lines: detail.lines.map((l: any) => ({
      name: l.name,
      description: l.description,
      quantity: Number(l.quantity),
      unitPrice: Number(l.unitPrice),
      subtotal: Number(l.subtotal),
    })),
    totalAmount: Number(detail.totalAmount),
    taxAmount: detail.taxAmount > 0 ? detail.taxAmount : null,
    grandTotal: detail.taxAmount > 0 ? detail.grandTotal : null,
    taxRate: detail.taxAmount > 0 && detail.totalAmount > 0
      ? Math.round(detail.taxAmount / detail.totalAmount * 100)
      : null,
    invoiceStatus: detail.invoiceStatus,
    deliveryStatus: detail.deliveryStatus,
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
  const companyIdEmail = resolveCompanyId(req);
  if (!await assertCompanyAccess(detail.companyId, companyIdEmail, req, res, { resourceType: "sales_document", resourceId: id })) return;

  let customer: typeof customersTable.$inferSelect | null = null;
  if (detail.customerId) {
    const rows = await db.select().from(customersTable).where(eq(customersTable.id, detail.customerId)).limit(1);
    customer = rows[0] ?? null;
  }

  const tplType2 = detail.kind === "quote" ? "quotation" : "invoice";
  const [acctSettings, template2] = await Promise.all([
    ensureAccountingSettings(),
    loadDocTemplate(tplType2),
  ]);
  const titleMap: Record<string, string> = { quote: "QUOTATION", order: "SALES ORDER" };
  const pdfData = {
    title: titleMap[detail.kind] ?? "DOKUMEN PENJUALAN",
    docNumber: detail.docNumber,
    status: detail.status,
    kind: detail.kind,
    companyName: acctSettings.companyName,
    companyAddress: acctSettings.companyAddress,
    companyNpwp: acctSettings.companyNpwp,
    partyLabel: "Pelanggan",
    partyName: detail.customerName,
    partyEmail: customer?.email ?? null,
    partyPhone: customer?.phone ?? null,
    partyAddress: customer?.address ?? null,
    partyTaxId: customer?.taxId ?? null,
    validUntil: detail.validUntil,
    expectedDate: detail.expectedDate,
    confirmedAt: detail.confirmedAt,
    createdAt: detail.createdAt,
    notes: detail.notes,
    lines: detail.lines.map((l: any) => ({
      name: l.name,
      description: l.description,
      quantity: Number(l.quantity),
      unitPrice: Number(l.unitPrice),
      subtotal: Number(l.subtotal),
    })),
    totalAmount: Number(detail.totalAmount),
    taxAmount: detail.taxAmount > 0 ? detail.taxAmount : null,
    grandTotal: detail.taxAmount > 0 ? detail.grandTotal : null,
    taxRate: detail.taxAmount > 0 && detail.totalAmount > 0
      ? Math.round(detail.taxAmount / detail.totalAmount * 100)
      : null,
    invoiceStatus: detail.invoiceStatus,
    deliveryStatus: detail.deliveryStatus,
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

// GET /api/sales/documents/:id/audit-log — riwayat aktivitas dokumen
router.get("/documents/:id/audit-log", async (req, res) => {
  const id = Number(req.params.id);
  if (Number.isNaN(id)) return res.status(400).json({ message: "Invalid id" });
  // IDOR guard: ensure document belongs to requesting company
  const [docForAudit] = await db.select({ companyId: salesDocumentsTable.companyId }).from(salesDocumentsTable).where(eq(salesDocumentsTable.id, id)).limit(1);
  if (!docForAudit) return res.status(404).json({ message: "Document not found" });
  const companyIdAudit = resolveCompanyId(req);
  if (!await assertCompanyAccess(docForAudit.companyId, companyIdAudit, req, res, { resourceType: "sales_document_audit", resourceId: id })) return;
  const rows = await db.execute(sql`
    SELECT
      id, user_id, user_email,
      action, module, reference_id,
      new_data, old_data,
      created_at
    FROM erp_audit_logs
    WHERE module = 'sales'
      AND reference_id = ${String(id)}
    ORDER BY created_at DESC
    LIMIT 200
  `);
  return res.json(rows.rows);
});

// GET /api/sales/ai-drafts — list AI-generated draft quotations
router.get("/ai-drafts", async (_req, res) => {
  const rows = await db
    .select()
    .from(salesDocumentsTable)
    .where(and(eq(salesDocumentsTable.aiGenerated, true), eq(salesDocumentsTable.status, "draft")))
    .orderBy(desc(salesDocumentsTable.createdAt));
  return res.json(rows.map((r) => serializeDoc(r)));
});

// GET /api/sales/ai-intake-log — audit log of AI-processed messages
router.get("/ai-intake-log", async (_req, res) => {
  const [emailRows, waCreatedRows, waSkipRows] = await Promise.all([
    // Email-sourced entries: correspondences that were AI-processed
    db
      .select({
        corrId: emailCorrespondencesTable.id,
        fromEmail: emailCorrespondencesTable.fromEmail,
        subject: emailCorrespondencesTable.subject,
        receivedAt: emailCorrespondencesTable.receivedAt,
        linkedSalesDocId: emailCorrespondencesTable.linkedSalesDocId,
        aiSkipReason: emailCorrespondencesTable.aiSkipReason,
        docNumber: salesDocumentsTable.docNumber,
        docStatus: salesDocumentsTable.status,
      })
      .from(emailCorrespondencesTable)
      .leftJoin(
        salesDocumentsTable,
        eq(emailCorrespondencesTable.linkedSalesDocId, salesDocumentsTable.id),
      )
      .where(eq(emailCorrespondencesTable.aiProcessed, true))
      .orderBy(desc(emailCorrespondencesTable.receivedAt))
      .limit(100),

    // WA-sourced entries: AI-generated docs with a WA source phone (status = created)
    db
      .select()
      .from(salesDocumentsTable)
      .where(and(eq(salesDocumentsTable.aiGenerated, true), sql`${salesDocumentsTable.aiSourceWaPhone} is not null`))
      .orderBy(desc(salesDocumentsTable.createdAt))
      .limit(100),

    // WA skipped/error entries from the dedicated log table
    db
      .select()
      .from(waAiIntakeLogTable)
      .orderBy(desc(waAiIntakeLogTable.processedAt))
      .limit(100),
  ]);

  const emailEntries = emailRows.map((r) => {
    let status: "created" | "skipped" | "error";
    if (r.linkedSalesDocId != null) status = "created";
    else if (r.aiSkipReason === "ai_error") status = "error";
    else status = "skipped";
    return {
      id: `email-${r.corrId}`,
      source: "email" as const,
      sender: r.fromEmail ?? null,
      subject: r.subject,
      timestamp: r.receivedAt.toISOString(),
      status,
      docId: r.linkedSalesDocId ?? null,
      docNumber: r.docNumber ?? null,
      docStatus: r.docStatus ?? null,
    };
  });

  const waCreatedEntries = waCreatedRows.map((r) => ({
    id: `wa-doc-${r.id}`,
    source: "wa" as const,
    sender: r.aiSourceWaPhone ?? null,
    subject: null,
    timestamp: r.createdAt.toISOString(),
    status: "created" as const,
    docId: r.id,
    docNumber: r.docNumber,
    docStatus: r.status,
  }));

  const waSkipEntries = waSkipRows.map((r) => ({
    id: `wa-skip-${r.id}`,
    source: "wa" as const,
    sender: r.phone,
    subject: r.senderName ?? null,
    timestamp: r.processedAt.toISOString(),
    status: r.status as "skipped" | "error",
    docId: null,
    docNumber: null,
    docStatus: null,
  }));

  const all = [...emailEntries, ...waCreatedEntries, ...waSkipEntries].sort(
    (a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime(),
  );

  return res.json(all.slice(0, 100));
});

// Shared helper: map transportMode → service keywords for filtering
const TM_TO_SERVICE: Record<string, string[]> = {
  sea: ["laut", "sea", "fcl", "lcl"],
  air: ["udara", "air"],
  land: ["darat", "land", "trucking"],
  multimodal: ["freight", "forwarding"],
};

function getServiceKeywords(transportMode: string | null | undefined): string[] {
  return transportMode
    ? (TM_TO_SERVICE[transportMode] ?? [])
    : ["freight", "laut", "udara", "darat", "forwarding"];
}

type ActiveSupplier = typeof suppliersTable.$inferSelect;

async function filterEligibleVendors(
  allActive: ActiveSupplier[],
  transportMode: string | null | undefined,
): Promise<ActiveSupplier[]> {
  const filterMode = await getVendorFilterMode();
  if (filterMode === "all") return allActive;
  const keywords = getServiceKeywords(transportMode);
  return allActive.filter((v) => {
    if (!v.serviceType) return false;
    const st = v.serviceType.toLowerCase();
    return keywords.some((kw) => st.includes(kw));
  });
}

// GET /api/sales/documents/:id/eligible-vendors — list eligible vendors for forwarding
router.get("/documents/:id/eligible-vendors", async (req, res) => {
  const id = Number(req.params.id);
  if (Number.isNaN(id)) return res.status(400).json({ message: "Invalid id" });

  const [doc] = await db.select().from(salesDocumentsTable).where(eq(salesDocumentsTable.id, id));
  if (!doc) return res.status(404).json({ message: "Document not found" });
  // IDOR guard
  const companyIdVendors = resolveCompanyId(req);
  if (!await assertCompanyAccess(doc.companyId, companyIdVendors, req, res, { resourceType: "sales_document", resourceId: id })) return;

  const allActive = await db.select().from(suppliersTable).where(eq(suppliersTable.isActive, true));
  const eligible = await filterEligibleVendors(allActive, doc.transportMode);

  return res.json(
    eligible.map((v) => ({
      id: v.id,
      name: v.name,
      hasPhone: !!v.phone,
      hasEmail: !!v.contactEmail,
      serviceType: v.serviceType,
    })),
  );
});

// POST /api/sales/documents/:id/forward-to-vendors — forward draft to selected vendors via chosen channels
router.post("/documents/:id/forward-to-vendors", async (req, res) => {
  const id = Number(req.params.id);
  if (Number.isNaN(id)) return res.status(400).json({ message: "Invalid id" });

  const detail = await loadDocWithLines(id);
  if (!detail) return res.status(404).json({ message: "Document not found" });
  // IDOR guard
  const companyIdFwd = resolveCompanyId(req);
  if (!await assertCompanyAccess(detail.companyId, companyIdFwd, req, res, { resourceType: "sales_document", resourceId: id })) return;
  const { lines, ...doc } = detail;

  const body = req.body as { vendorIds?: number[]; channels?: string[] };
  const useWa = !body.channels || body.channels.includes("wa");
  const useEmail = !body.channels || body.channels.includes("email");

  // Determine eligible vendors (respects vendorFilterMode setting unless vendorIds override given)
  const allActive = await db.select().from(suppliersTable).where(eq(suppliersTable.isActive, true));

  let eligible: ActiveSupplier[];
  if (body.vendorIds && body.vendorIds.length > 0) {
    // Explicit override — use exactly the requested vendor IDs
    const idSet = new Set(body.vendorIds);
    eligible = allActive.filter((v) => idSet.has(v.id));
  } else {
    // Use configured vendor filter (all / by-service-type)
    eligible = await filterEligibleVendors(allActive, doc.transportMode);
  }

  let waCount = 0;
  let emailCount = 0;

  const routeLabel = [doc.origin, doc.destination].filter(Boolean).join(" → ") || "N/A";
  const transportLabel = doc.transportMode ?? "Freight";

  // Build item/cargo summary lines (columns: name, description, quantity, unitPrice)
  const itemSummaryText = lines.length > 0
    ? lines.map((l, i) => `  ${i + 1}. ${l.name}${l.description ? ` (${l.description})` : ""} — ${l.quantity} pcs @ ${Number(l.unitPrice).toLocaleString("id-ID")}`).join("\n")
    : "  (tidak ada item)";

  const itemSummaryHtml = lines.length > 0
    ? `<ol>${lines.map((l) => `<li><strong>${l.name}</strong>${l.description ? ` — ${l.description}` : ""} — ${l.quantity} pcs @ ${Number(l.unitPrice).toLocaleString("id-ID")}</li>`).join("")}</ol>`
    : "<p><em>Tidak ada item.</em></p>";

  type VendorSendResult = { vendorId: number; vendorName: string; waStatus: "sent" | "failed" | "skipped" | null; emailStatus: "sent" | "failed" | "skipped" | null };
  const results: VendorSendResult[] = [];

  for (const vendor of eligible) {
    const result: VendorSendResult = { vendorId: vendor.id, vendorName: vendor.name, waStatus: null, emailStatus: null };

    if (useWa) {
      if (vendor.phone) {
        const msg =
          `📋 *PERMINTAAN PENAWARAN — CST LOGISTICS*\n` +
          `━━━━━━━━━━━━━━━━━━\n` +
          `Kepada Yth. *${vendor.name}*,\n\n` +
          `No. Draft   : *${doc.docNumber}*\n` +
          `Customer    : ${doc.customerName}\n` +
          `Jenis       : ${transportLabel}\n` +
          `Rute        : ${routeLabel}\n` +
          (doc.notes ? `Catatan     :\n${doc.notes}\n` : "") +
          `\n📦 *DAFTAR BARANG/KARGO:*\n` +
          itemSummaryText + "\n" +
          `━━━━━━━━━━━━━━━━━━\n` +
          `💬 Mohon berikan penawaran harga Anda.\n` +
          `Terima kasih 🙏`;
        try {
          await sendWhatsApp(vendor.phone, msg);
          result.waStatus = "sent";
          waCount++;
        } catch (err) {
          console.warn("[sales] WhatsApp send failed for vendor=%s:", vendor.id, err);
          result.waStatus = "failed";
        }
      } else {
        result.waStatus = "skipped";
      }
    }

    if (useEmail) {
      if (vendor.contactEmail && isSmtpConfigured()) {
        try {
          await sendMail({
            to: vendor.contactEmail,
            subject: `[Permintaan Penawaran] ${doc.docNumber} — ${transportLabel}`,
            text:
              `Kepada ${vendor.name},\n\n` +
              `Mohon berikan penawaran untuk:\n` +
              `No. Draft: ${doc.docNumber}\n` +
              `Customer: ${doc.customerName}\n` +
              `Jenis: ${transportLabel}\n` +
              `Rute: ${routeLabel}\n` +
              (doc.notes ? `\nCatatan:\n${doc.notes}\n` : "") +
              `\nDaftar Barang/Kargo:\n` +
              itemSummaryText +
              `\n\nTerima kasih,\nB2B Marketplace and Logistic`,
            html:
              `<p>Kepada <strong>${vendor.name}</strong>,</p>` +
              `<p>Mohon berikan penawaran untuk:</p>` +
              `<ul>` +
              `<li>No. Draft: <strong>${doc.docNumber}</strong></li>` +
              `<li>Customer: ${doc.customerName}</li>` +
              `<li>Jenis: ${transportLabel}</li>` +
              `<li>Rute: ${routeLabel}</li>` +
              `</ul>` +
              (doc.notes ? `<p>Catatan:<br>${String(doc.notes).replace(/\n/g, "<br>")}</p>` : "") +
              `<p><strong>Daftar Barang/Kargo:</strong></p>` +
              itemSummaryHtml +
              `<p>Terima kasih,<br>B2B Marketplace and Logistic</p>`,
          });
          result.emailStatus = "sent";
          emailCount++;
        } catch (err) {
          console.warn("[sales] Email send failed for vendor=%s:", vendor.id, err);
          result.emailStatus = "failed";
        }
      } else {
        result.emailStatus = "skipped";
      }
    }

    results.push(result);
  }

  return res.json({ message: "Forwarded to vendors", vendorCount: eligible.length, waCount, emailCount, results });
});

export default router;
