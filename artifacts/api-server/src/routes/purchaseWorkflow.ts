import { Router } from "express";
import { resolveCompanyId } from "../lib/resolveCompany.js";
import { requireAdmin } from "../lib/requireAdmin.js";
import { ensureAccountingSettings } from "../lib/accountingSeed.js";
import { sendViaService as sendWhatsApp, sendToAdminGroup } from "../lib/waTransport.js";
import { getAdminWa, getAdminGroupWa } from "../lib/adminWa.js";
import { postEntry, postPurchaseReturn, resolveCostCenterId } from "../lib/accounting.js";
import { classifyExpense } from "../lib/expense_classifier.js";
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
import { assertCompanyAccess } from "../lib/assertCompanyAccess.js";
import { getInCodeTemplate, resolveTemplate, type ProductTemplateOverride } from "@workspace/product-templates";
import {
  guardInvoiceUpdate,
  lockInvoiceSnapshot,
  runSapInvoiceLockEngine,
  createSapJournal,
  reverseJournal,
  storeSapJournal,
  getSapJournalByInvoice,
} from "../lib/sapInvoiceLockEngine.js";
import { sapInvoiceLockMiddleware } from "../middlewares/sapInvoiceLockMiddleware.js";
import { sapAuditMiddleware } from "../middlewares/sapAuditMiddleware.js";
import { isInvoiceTaxBalanced } from "../lib/invoiceTaxPostingPolicy.js";
import {
  APPROVAL_STATES,
  loadOrCreateApprovalState,
  approveDocument,
  rejectDocument,
  saveApprovalState,
  buildAuditLog,
  writeSapAuditLog,
} from "../lib/sapApprovalEngine.js";

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

const PR_ACTION_EMOJI: Record<string, string> = {
  submitted: "📋",
  approved:  "✅",
  rejected:  "❌",
  cancelled: "🚫",
};

async function notifyPrAction(
  prId: number,
  pr: { prNumber: string; requestedBy: string | null; department: string | null; createdBy?: string | null },
  action: string,
  notes?: string,
  actorName?: string,
): Promise<void> {
  try {
    const lines = await db.select().from(purchaseRequestLinesTable).where(eq(purchaseRequestLinesTable.prId, prId));
    const totalEst = lines.reduce((s, l) => s + Number(l.estimatedCost ?? 0) * Number(l.quantity ?? 1), 0);
    const fmt = (n: number) => new Intl.NumberFormat("id-ID").format(n);

    const statusLabel: Record<string, string> = {
      submit:   "disubmit untuk approval",
      approve:  "disetujui",
      reject:   "ditolak",
      cancel:   "dibatalkan",
    };
    const emoji = PR_ACTION_EMOJI[action === "submit" ? "submitted" : action === "approve" ? "approved" : action === "reject" ? "rejected" : "cancelled"] ?? "📄";

    const itemLines = lines.slice(0, 5).map((l, i) =>
      `  ${i + 1}. ${l.name} — ${l.quantity} ${l.unit}`
    ).join("\n");
    const moreItems = lines.length > 5 ? `\n  ... dan ${lines.length - 5} item lainnya` : "";

    let msg = `${emoji} *Purchase Request ${statusLabel[action] ?? action}*\n\n` +
      `📄 No PR   : *${pr.prNumber}*\n` +
      `👤 Pemohon : ${pr.requestedBy ?? "-"}\n` +
      `🏢 Divisi  : ${pr.department ?? "-"}\n` +
      `📦 Items   :\n${itemLines}${moreItems}\n` +
      `💰 Est. Total: Rp ${fmt(totalEst)}`;

    if (notes?.trim()) {
      msg += `\n📝 Catatan : ${notes}`;
    }
    if (actorName?.trim() && action !== "submit") {
      msg += `\n👤 Oleh    : ${actorName}`;
    }

    const waOpts = { context: "pr-action", refType: "purchase_request", refId: String(prId) };

    // ── Notifikasi ke admin group / admin WA ──────────────────────────────────
    const [adminGroup, adminWa] = await Promise.all([getAdminGroupWa(), getAdminWa()]);
    if (adminGroup) {
      sendToAdminGroup(adminGroup, msg, waOpts).catch(() => undefined);
    } else if (adminWa) {
      sendWhatsApp(adminWa, msg, waOpts).catch(() => undefined);
    }

    // ── Notifikasi ke requester (approved / rejected saja) ────────────────────
    if ((action === "approve" || action === "reject") && pr.createdBy) {
      try {
        const [requesterRow] = await db.execute(
          sql`SELECT whatsapp FROM users WHERE id = ${pr.createdBy} LIMIT 1`
        ) as any;
        const requesterWa = (requesterRow?.rows?.[0] ?? requesterRow?.[0])?.whatsapp as string | null | undefined;
        if (requesterWa?.trim()) {
          const requesterMsg = action === "approve"
            ? `✅ *PR Anda Disetujui*\n\n📄 No PR : *${pr.prNumber}*\n${notes?.trim() ? `📝 Catatan : ${notes}\n` : ""}👤 Oleh  : ${actorName ?? "Approver"}`
            : `❌ *PR Anda Ditolak*\n\n📄 No PR : *${pr.prNumber}*\n${notes?.trim() ? `📝 Alasan : ${notes}\n` : ""}👤 Oleh  : ${actorName ?? "Approver"}\n\nSilakan buat PR baru jika diperlukan.`;
          sendWhatsApp(requesterWa.trim(), requesterMsg, { ...waOpts, refId: `${prId}-req` }).catch(() => undefined);
        }
      } catch {
        // tidak ada WA requester — skip
      }
    }
  } catch {
    // fire-and-forget — jangan block response
  }
}

// Boot migration: add template columns to purchase_requests
db.execute(sql`
  ALTER TABLE purchase_requests ADD COLUMN IF NOT EXISTS category_key TEXT;
  ALTER TABLE purchase_requests ADD COLUMN IF NOT EXISTS template_id TEXT;
  ALTER TABLE purchase_requests ADD COLUMN IF NOT EXISTS template_version TEXT;
  ALTER TABLE purchase_requests ADD COLUMN IF NOT EXISTS template_snapshot JSONB;
`).catch((e: unknown) => console.warn("[purchase_requests] boot migration warn:", e));

// Boot migration: SAP Invoice Lock — immutable snapshot column
db.execute(sql`
  ALTER TABLE vendor_invoices ADD COLUMN IF NOT EXISTS sap_lock_snapshot JSONB;
  ALTER TABLE vendor_invoices ADD COLUMN IF NOT EXISTS withholding_tax_amount NUMERIC(14,2) NOT NULL DEFAULT 0;
  ALTER TABLE vendor_invoices ADD COLUMN IF NOT EXISTS invoice_breakdown JSONB;
`).catch((e: unknown) => console.warn("[vendor_invoices] sap_lock_snapshot boot migration warn:", e));

// Boot migration: SAP DB-LEVEL LOCK — is_locked column only (trigger removed; lock enforced at app level)
(async () => {
  try {
    await db.execute(sql`
      ALTER TABLE vendor_invoices ADD COLUMN IF NOT EXISTS is_locked BOOLEAN DEFAULT false;
    `);
  } catch (e) { console.warn("[vendor_invoices] is_locked column migration warn:", e); }

  // Drop the DB-level trigger — SAP lock is enforced at application level via sapInvoiceLockEngine.
  // The trigger caused pgBouncer incompatibility and blocked legitimate payment tracking updates.
  try {
    await db.execute(sql`DROP TRIGGER IF EXISTS invoice_lock_trigger ON vendor_invoices;`);
    console.log("[vendor_invoices] invoice_lock_trigger dropped (SAP lock now app-level only)");
  } catch (e) { console.warn("[vendor_invoices] drop lock trigger warn:", e); }
})();

// Boot migration: SAP Approval States table
db.execute(sql`
  CREATE TABLE IF NOT EXISTS sap_approval_states (
    id            SERIAL PRIMARY KEY,
    entity_type   TEXT NOT NULL,
    entity_id     TEXT NOT NULL,
    status        TEXT NOT NULL DEFAULT 'DRAFT',
    current_approver TEXT NULL,
    approval_history JSONB NOT NULL DEFAULT '[]'::jsonb,
    updated_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE (entity_type, entity_id)
  );
`).then(() => db.execute(sql`
  CREATE INDEX IF NOT EXISTS idx_sap_approval_states_entity ON sap_approval_states(entity_type, entity_id);
`)).catch((e: unknown) => console.warn("[sap_approval_states] boot migration warn:", e));

// Boot migration: SAP Audit Ledger (immutable append-only)
db.execute(sql`
  CREATE TABLE IF NOT EXISTS sap_audit_ledger (
    id          TEXT PRIMARY KEY,
    entity_type TEXT NOT NULL,
    entity_id   TEXT NOT NULL,
    action      TEXT NOT NULL,
    actor_id    TEXT NULL,
    role        TEXT NULL,
    before_data JSONB NULL,
    after_data  JSONB NULL,
    timestamp   TIMESTAMPTZ NOT NULL DEFAULT NOW()
  );
`).then(() => db.execute(sql`
  CREATE INDEX IF NOT EXISTS idx_sap_audit_ledger_entity ON sap_audit_ledger(entity_type, entity_id);
`)).then(() => db.execute(sql`
  CREATE INDEX IF NOT EXISTS idx_sap_audit_ledger_ts ON sap_audit_ledger(timestamp DESC);
`)).catch((e: unknown) => console.warn("[sap_audit_ledger] boot migration warn:", e));

// Boot migration: SAP Journal tables (sap_journals + sap_journal_entries)
// Chained with .then() to avoid race condition on pgBouncer — index must come after table
db.execute(sql`
  CREATE TABLE IF NOT EXISTS sap_journals (
    id            TEXT PRIMARY KEY,
    invoice_id    TEXT NOT NULL,
    status        TEXT NOT NULL DEFAULT 'POSTED',
    reversed_from TEXT NULL,
    created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
  );
`).then(() => db.execute(sql`
  CREATE INDEX IF NOT EXISTS idx_sap_journals_invoice_id ON sap_journals(invoice_id);
`)).catch((e: unknown) => console.warn("[sap_journals] boot migration warn:", e));

db.execute(sql`
  CREATE TABLE IF NOT EXISTS sap_journal_entries (
    id         TEXT PRIMARY KEY,
    journal_id TEXT NOT NULL,
    account    TEXT NOT NULL,
    debit      BIGINT NOT NULL DEFAULT 0,
    credit     BIGINT NOT NULL DEFAULT 0
  );
`).then(() => db.execute(sql`
  CREATE INDEX IF NOT EXISTS idx_sap_journal_entries_journal_id ON sap_journal_entries(journal_id);
`)).catch((e: unknown) => console.warn("[sap_journal_entries] boot migration warn:", e));

// Boot migration: source_pr_id — propagate PR origin to purchase_documents for Sport Center accounting
db.execute(sql`
  ALTER TABLE purchase_documents ADD COLUMN IF NOT EXISTS source_pr_id INTEGER;
`).catch((e: unknown) => console.warn("[purchase_documents] source_pr_id boot migration warn:", e));

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
  await db.delete(uomMasterTable).where(eq(uomMasterTable.id, Number(String(req.params.id))));
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
  const id = Number(String(req.params.id));
  const [pr] = await db.select().from(purchaseRequestsTable).where(eq(purchaseRequestsTable.id, id));
  if (!pr) { res.status(404).json({ error: "Not found" }); return; }
  const cid = resolveCompanyId(req as Parameters<typeof resolveCompanyId>[0]);
  if (!await assertCompanyAccess(pr.companyId, cid, req, res, { resourceType: "purchase_request", resourceId: id })) return;
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
  const id = Number(String(req.params.id));
  const body = req.body as Record<string, unknown>;
  const [prOwner] = await db.select({ companyId: purchaseRequestsTable.companyId }).from(purchaseRequestsTable).where(eq(purchaseRequestsTable.id, id));
  if (!prOwner) { res.status(404).json({ error: "Not found" }); return; }
  const cid = resolveCompanyId(req as Parameters<typeof resolveCompanyId>[0]);
  if (!await assertCompanyAccess(prOwner.companyId, cid, req, res, { resourceType: "purchase_request", resourceId: id })) return;
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
  const id = Number(String(req.params.id));
  const { action, notes, approverName, approverId } = req.body as Record<string, string>;
  const [pr] = await db.select().from(purchaseRequestsTable).where(eq(purchaseRequestsTable.id, id));
  if (!pr) { res.status(404).json({ error: "Not found" }); return; }
  const cid = resolveCompanyId(req as Parameters<typeof resolveCompanyId>[0]);
  if (!await assertCompanyAccess(pr.companyId, cid, req, res, { resourceType: "purchase_request", resourceId: id })) return;

  if (action === "submit") {
    await db.update(purchaseRequestsTable).set({ status: "submitted", updatedAt: new Date() }).where(eq(purchaseRequestsTable.id, id));
    await db.insert(purchaseApprovalsTable).values({ docType: "PR", docId: id, step: 1, status: "pending", approverName: approverName ?? null, approverId: approverId ?? null });
    notifyPrAction(id, pr, "submit", notes, undefined).catch(() => undefined);
  } else if (action === "approve") {
    const [pending] = await db.select().from(purchaseApprovalsTable)
      .where(and(eq(purchaseApprovalsTable.docType, "PR"), eq(purchaseApprovalsTable.docId, id), eq(purchaseApprovalsTable.status, "pending")))
      .orderBy(purchaseApprovalsTable.step).limit(1);
    if (pending) {
      await db.update(purchaseApprovalsTable).set({ status: "approved", notes: notes ?? null, approvedAt: new Date() }).where(eq(purchaseApprovalsTable.id, pending.id));
    }
    await db.update(purchaseRequestsTable).set({ status: "approved", updatedAt: new Date() }).where(eq(purchaseRequestsTable.id, id));
    notifyPrAction(id, pr, "approve", notes, approverName).catch(() => undefined);
  } else if (action === "reject") {
    const [pending] = await db.select().from(purchaseApprovalsTable)
      .where(and(eq(purchaseApprovalsTable.docType, "PR"), eq(purchaseApprovalsTable.docId, id), eq(purchaseApprovalsTable.status, "pending")))
      .limit(1);
    if (pending) {
      await db.update(purchaseApprovalsTable).set({ status: "rejected", notes: notes ?? null, rejectedAt: new Date() }).where(eq(purchaseApprovalsTable.id, pending.id));
    }
    await db.update(purchaseRequestsTable).set({ status: "rejected", updatedAt: new Date() }).where(eq(purchaseRequestsTable.id, id));
    notifyPrAction(id, pr, "reject", notes, approverName).catch(() => undefined);
  } else if (action === "cancel") {
    await db.update(purchaseRequestsTable).set({ status: "cancelled", cancelledAt: new Date(), updatedAt: new Date() }).where(eq(purchaseRequestsTable.id, id));
    notifyPrAction(id, pr, "cancel", notes, undefined).catch(() => undefined);
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
      } as unknown as ProductTemplateOverride : null;
      const resolved = resolveTemplate(categoryKey, override ?? null);
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
    // Propagate source_pr_id untuk traceability (Sport Center dan modul lain)
    await db.execute(sql`UPDATE purchase_documents SET source_pr_id = ${id} WHERE id = ${rfq!.id}`);
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
  await db.delete(purchaseRequestsTable).where(eq(purchaseRequestsTable.id, Number(String(req.params.id))));
  const id = Number(req.params.id);
  const [prOwner] = await db.select({ companyId: purchaseRequestsTable.companyId }).from(purchaseRequestsTable).where(eq(purchaseRequestsTable.id, id));
  if (!prOwner) { res.status(404).json({ error: "Not found" }); return; }
  const cid = resolveCompanyId(req as Parameters<typeof resolveCompanyId>[0]);
  if (!await assertCompanyAccess(prOwner.companyId, cid, req, res, { resourceType: "purchase_request", resourceId: id })) return;
  await db.delete(purchaseRequestsTable).where(eq(purchaseRequestsTable.id, id));
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
  const id = Number(String(req.params.id));
  const [vq] = await db.select().from(vendorQuotationsTable).where(eq(vendorQuotationsTable.id, id));
  if (!vq) { res.status(404).json({ error: "Not found" }); return; }
  const [rfqCo] = await db.select({ companyId: purchaseDocumentsTable.companyId }).from(purchaseDocumentsTable).where(eq(purchaseDocumentsTable.id, vq.rfqId));
  const cid = resolveCompanyId(req as Parameters<typeof resolveCompanyId>[0]);
  if (!await assertCompanyAccess(rfqCo?.companyId, cid, req, res, { resourceType: "vendor_quotation", resourceId: id })) return;
  const lines = await db.select().from(vendorQuotationLinesTable).where(eq(vendorQuotationLinesTable.quotationId, id));
  res.json({ ...vq, lines });
});

router.get("/vq/compare/:rfqId", async (req, res) => {
  const rfqId = Number(String(req.params.rfqId));
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
  const id = Number(String(req.params.id));
  const body = req.body as Record<string, unknown>;
  const [vqOwner] = await db.select({ rfqId: vendorQuotationsTable.rfqId }).from(vendorQuotationsTable).where(eq(vendorQuotationsTable.id, id));
  if (!vqOwner) { res.status(404).json({ error: "Not found" }); return; }
  const [rfqCo] = await db.select({ companyId: purchaseDocumentsTable.companyId }).from(purchaseDocumentsTable).where(eq(purchaseDocumentsTable.id, vqOwner.rfqId));
  const cid = resolveCompanyId(req as Parameters<typeof resolveCompanyId>[0]);
  if (!await assertCompanyAccess(rfqCo?.companyId, cid, req, res, { resourceType: "vendor_quotation", resourceId: id })) return;
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
  const id = Number(String(req.params.id));
  const [vq] = await db.select().from(vendorQuotationsTable).where(eq(vendorQuotationsTable.id, id));
  if (!vq) { res.status(404).json({ error: "Not found" }); return; }
  const [rfqCo] = await db.select({ companyId: purchaseDocumentsTable.companyId }).from(purchaseDocumentsTable).where(eq(purchaseDocumentsTable.id, vq.rfqId));
  const cid = resolveCompanyId(req as Parameters<typeof resolveCompanyId>[0]);
  if (!await assertCompanyAccess(rfqCo?.companyId, cid, req, res, { resourceType: "vendor_quotation", resourceId: id })) return;
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
  // Ambil source_pr_id dari RFQ agar bisa dipropagasi ke PO
  const rfqSourcePrRow = await db.execute(sql`SELECT source_pr_id FROM purchase_documents WHERE id = ${vq.rfqId} LIMIT 1`);
  const rfqSourcePrId = (rfqSourcePrRow.rows[0] as any)?.source_pr_id ?? null;

  const [po] = await db.insert(purchaseDocumentsTable).values({
    docNumber: poNumber,
    kind: "order",
    status: "confirmed",
    companyId: rfq?.companyId ?? cid,
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
  // Propagate source_pr_id dari RFQ ke PO
  if (rfqSourcePrId) {
    await db.execute(sql`UPDATE purchase_documents SET source_pr_id = ${rfqSourcePrId} WHERE id = ${po!.id}`);
  }
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
  await db.delete(vendorQuotationsTable).where(eq(vendorQuotationsTable.id, Number(String(req.params.id))));
  const id = Number(req.params.id);
  const [vqOwner] = await db.select({ rfqId: vendorQuotationsTable.rfqId }).from(vendorQuotationsTable).where(eq(vendorQuotationsTable.id, id));
  if (!vqOwner) { res.status(404).json({ error: "Not found" }); return; }
  const [rfqCo] = await db.select({ companyId: purchaseDocumentsTable.companyId }).from(purchaseDocumentsTable).where(eq(purchaseDocumentsTable.id, vqOwner.rfqId));
  const cid = resolveCompanyId(req as Parameters<typeof resolveCompanyId>[0]);
  if (!await assertCompanyAccess(rfqCo?.companyId, cid, req, res, { resourceType: "vendor_quotation", resourceId: id })) return;
  await db.delete(vendorQuotationsTable).where(eq(vendorQuotationsTable.id, id));
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
  const id = Number(String(req.params.id));
  const [gr] = await db.select().from(goodsReceiptsTable).where(eq(goodsReceiptsTable.id, id));
  if (!gr) { res.status(404).json({ error: "Not found" }); return; }
  const cid = resolveCompanyId(req as Parameters<typeof resolveCompanyId>[0]);
  if (!await assertCompanyAccess(gr.companyId, cid, req, res, { resourceType: "goods_receipt", resourceId: id })) return;
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
  const id = Number(String(req.params.id));
  const body = req.body as Record<string, unknown>;
  const [grOwner] = await db.select({ companyId: goodsReceiptsTable.companyId }).from(goodsReceiptsTable).where(eq(goodsReceiptsTable.id, id));
  if (!grOwner) { res.status(404).json({ error: "Not found" }); return; }
  const cid = resolveCompanyId(req as Parameters<typeof resolveCompanyId>[0]);
  if (!await assertCompanyAccess(grOwner.companyId, cid, req, res, { resourceType: "goods_receipt", resourceId: id })) return;
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
  const id = Number(String(req.params.id));
  const { confirmedBy } = req.body as Record<string, string>;
  const [gr] = await db.select().from(goodsReceiptsTable).where(eq(goodsReceiptsTable.id, id));
  if (!gr) { res.status(404).json({ error: "Not found" }); return; }
  const cid = resolveCompanyId(req as Parameters<typeof resolveCompanyId>[0]);
  if (!await assertCompanyAccess(gr.companyId, cid, req, res, { resourceType: "goods_receipt", resourceId: id })) return;
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
    const settings = await ensureAccountingSettings(gr.companyId ?? cid);
    const totalCost = lines.reduce((s, l) => s + num(l.qtyReceived) * num(l.unitCost), 0);

    // Resolve GR/IR account — settings first, fallback: langsung cari akun 2-1045
    let effectiveGrirId: number | null = settings.grirAccountId ?? null;
    if (!effectiveGrirId) {
      const grirRow = (await db.execute(sql`
        SELECT id FROM chart_of_accounts
        WHERE code LIKE '2-1045%'
          AND (company_id = ${gr.companyId ?? null} OR company_id IS NULL)
        ORDER BY id LIMIT 1
      `)).rows[0] as { id: number } | undefined;
      effectiveGrirId = grirRow?.id ?? null;
    }

    if (!effectiveGrirId) {
      console.warn(`[GRN ${gr.grNumber}] grirAccountId & akun 2-1045 tidak ditemukan — lewati GRN accrual.`);
    } else if (totalCost > 0 && settings.inventoryAccountId && settings.purchaseJournalId) {
      const entry = await postEntry({
        journalId: settings.purchaseJournalId,
        date: new Date(),
        ref: gr.grNumber,
        description: `Penerimaan Barang ${gr.grNumber}`,
        source: "grn_receipt",
        sourceId: id,
        companyId: gr.companyId ?? cid,
        lines: [
          { accountId: settings.inventoryAccountId, debit: totalCost, credit: 0, description: `Persediaan masuk: ${gr.grNumber}` },
          { accountId: effectiveGrirId, debit: 0, credit: totalCost, description: `GR/IR accrual: ${gr.grNumber}` },
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
  await db.update(goodsReceiptsTable).set({ status: "cancelled", cancelledAt: new Date(), updatedAt: new Date() }).where(eq(goodsReceiptsTable.id, Number(String(req.params.id))));
  const id = Number(req.params.id);
  const [grOwner] = await db.select({ companyId: goodsReceiptsTable.companyId }).from(goodsReceiptsTable).where(eq(goodsReceiptsTable.id, id));
  if (!grOwner) { res.status(404).json({ error: "Not found" }); return; }
  const cid = resolveCompanyId(req as Parameters<typeof resolveCompanyId>[0]);
  if (!await assertCompanyAccess(grOwner.companyId, cid, req, res, { resourceType: "goods_receipt", resourceId: id })) return;
  await db.update(goodsReceiptsTable).set({ status: "cancelled", cancelledAt: new Date(), updatedAt: new Date() }).where(eq(goodsReceiptsTable.id, id));
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
  const id = Number(String(req.params.id));
  const [qc] = await db.select().from(qcInspectionsTable).where(eq(qcInspectionsTable.id, id));
  if (!qc) { res.status(404).json({ error: "Not found" }); return; }
  const cid = resolveCompanyId(req as Parameters<typeof resolveCompanyId>[0]);
  if (!await assertCompanyAccess(qc.companyId, cid, req, res, { resourceType: "qc_inspection", resourceId: id })) return;
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
  const id = Number(String(req.params.id));
  const body = req.body as Record<string, unknown>;
  const [qcOwner] = await db.select({ companyId: qcInspectionsTable.companyId }).from(qcInspectionsTable).where(eq(qcInspectionsTable.id, id));
  if (!qcOwner) { res.status(404).json({ error: "Not found" }); return; }
  const cid = resolveCompanyId(req as Parameters<typeof resolveCompanyId>[0]);
  if (!await assertCompanyAccess(qcOwner.companyId, cid, req, res, { resourceType: "qc_inspection", resourceId: id })) return;
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
  const id = Number(String(req.params.id));
  const { action, inspectorName, notes } = req.body as Record<string, string>;
  const [qcOwner] = await db.select({ companyId: qcInspectionsTable.companyId }).from(qcInspectionsTable).where(eq(qcInspectionsTable.id, id));
  if (!qcOwner) { res.status(404).json({ error: "Not found" }); return; }
  const cid = resolveCompanyId(req as Parameters<typeof resolveCompanyId>[0]);
  if (!await assertCompanyAccess(qcOwner.companyId, cid, req, res, { resourceType: "qc_inspection", resourceId: id })) return;
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
  const id = Number(String(req.params.id));
  const [ret] = await db.select().from(purchaseReturnsTable).where(eq(purchaseReturnsTable.id, id));
  if (!ret) { res.status(404).json({ error: "Not found" }); return; }
  const cid = resolveCompanyId(req as Parameters<typeof resolveCompanyId>[0]);
  if (!await assertCompanyAccess(ret.companyId, cid, req, res, { resourceType: "purchase_return", resourceId: id })) return;
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
  const id = Number(String(req.params.id));
  const { confirmedBy } = req.body as Record<string, string>;
  const [ret] = await db.select().from(purchaseReturnsTable).where(eq(purchaseReturnsTable.id, id));
  if (!ret) { res.status(404).json({ error: "Not found" }); return; }
  const cid = resolveCompanyId(req as Parameters<typeof resolveCompanyId>[0]);
  if (!await assertCompanyAccess(ret.companyId, cid, req, res, { resourceType: "purchase_return", resourceId: id })) return;
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
  await db.update(purchaseReturnsTable).set({ status: "cancelled", cancelledAt: new Date(), updatedAt: new Date() }).where(eq(purchaseReturnsTable.id, Number(String(req.params.id))));
  const id = Number(req.params.id);
  const [retOwner] = await db.select({ companyId: purchaseReturnsTable.companyId }).from(purchaseReturnsTable).where(eq(purchaseReturnsTable.id, id));
  if (!retOwner) { res.status(404).json({ error: "Not found" }); return; }
  const cid = resolveCompanyId(req as Parameters<typeof resolveCompanyId>[0]);
  if (!await assertCompanyAccess(retOwner.companyId, cid, req, res, { resourceType: "purchase_return", resourceId: id })) return;
  await db.update(purchaseReturnsTable).set({ status: "cancelled", cancelledAt: new Date(), updatedAt: new Date() }).where(eq(purchaseReturnsTable.id, id));
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
  const id = Number(String(req.params.id));
  const [vi] = await db.select().from(vendorInvoicesTable).where(eq(vendorInvoicesTable.id, id));
  if (!vi) { res.status(404).json({ error: "Not found" }); return; }
  const cid = resolveCompanyId(req as Parameters<typeof resolveCompanyId>[0]);
  if (!await assertCompanyAccess(vi.companyId, cid, req, res, { resourceType: "vendor_invoice", resourceId: id })) return;
  const lines = await db.select().from(vendorInvoiceLinesTable).where(eq(vendorInvoiceLinesTable.invoiceId, id));
  const po = vi.poId ? (await db.select().from(purchaseDocumentsTable).where(eq(purchaseDocumentsTable.id, vi.poId)))[0] : null;
  const gr = vi.grId ? (await db.select().from(goodsReceiptsTable).where(eq(goodsReceiptsTable.id, vi.grId)))[0] : null;
  res.json({ ...vi, lines, po, gr });
});

router.get("/vendor-invoices/check-duplicate", async (req, res) => {
  const vendorInvoiceRef = req.query.vendorInvoiceRef ? String(req.query.vendorInvoiceRef).trim() : "";
  const supplierId = req.query.supplierId ? Number(req.query.supplierId) : undefined;
  const supplierName = req.query.supplierName ? String(req.query.supplierName).trim() : "";

  if (!vendorInvoiceRef || (!supplierId && !supplierName)) {
    res.json({ duplicate: false });
    return;
  }

  const dupWhere = supplierId
    ? and(
        sql`lower(${vendorInvoicesTable.vendorInvoiceRef}) = lower(${vendorInvoiceRef})`,
        eq(vendorInvoicesTable.supplierId, supplierId),
        sql`${vendorInvoicesTable.status} != 'cancelled'`,
      )
    : and(
        sql`lower(${vendorInvoicesTable.vendorInvoiceRef}) = lower(${vendorInvoiceRef})`,
        sql`lower(${vendorInvoicesTable.supplierName}) = lower(${supplierName})`,
        sql`${vendorInvoicesTable.status} != 'cancelled'`,
      );

  const [existing] = await db
    .select({ id: vendorInvoicesTable.id, invoiceNumber: vendorInvoicesTable.invoiceNumber })
    .from(vendorInvoicesTable)
    .where(dupWhere)
    .limit(1);

  if (!existing) {
    res.json({ duplicate: false });
    return;
  }
  res.json({
    duplicate: true,
    existingInvoiceId: existing.id,
    existingInvoiceNumber: existing.invoiceNumber,
    message: `Invoice vendor dengan nomor "${vendorInvoiceRef}" untuk supplier ini sudah pernah diinput sebagai ${existing.invoiceNumber}.`,
  });
});

router.post("/vendor-invoices", async (req, res) => {
  const body = req.body as Record<string, unknown>;
  const companyId = resolveCompanyId(req as Parameters<typeof resolveCompanyId>[0]);

  const vendorInvoiceRef = body.vendorInvoiceRef ? String(body.vendorInvoiceRef).trim() : "";
  const supplierId = body.supplierId ? Number(body.supplierId) : undefined;
  const supplierName = String(body.supplierName ?? "").trim();

  if (vendorInvoiceRef) {
    const dupWhere = supplierId
      ? and(
          sql`lower(${vendorInvoicesTable.vendorInvoiceRef}) = lower(${vendorInvoiceRef})`,
          eq(vendorInvoicesTable.supplierId, supplierId),
          sql`${vendorInvoicesTable.status} != 'cancelled'`,
        )
      : and(
          sql`lower(${vendorInvoicesTable.vendorInvoiceRef}) = lower(${vendorInvoiceRef})`,
          sql`lower(${vendorInvoicesTable.supplierName}) = lower(${supplierName})`,
          sql`${vendorInvoicesTable.status} != 'cancelled'`,
        );

    const [existing] = await db
      .select({ id: vendorInvoicesTable.id, invoiceNumber: vendorInvoicesTable.invoiceNumber })
      .from(vendorInvoicesTable)
      .where(dupWhere)
      .limit(1);

    if (existing) {
      res.status(409).json({
        error: "duplicate_vendor_invoice",
        message: `Invoice vendor dengan nomor "${vendorInvoiceRef}" untuk supplier ini sudah pernah diinput sebagai ${existing.invoiceNumber}. Tidak bisa input ulang.`,
        existingInvoiceId: existing.id,
        existingInvoiceNumber: existing.invoiceNumber,
      });
      return;
    }
  }

  const invoiceNumber = await nextSeq("vendor_invoices", "VI", "invoice_number");
  const lines = (body.lines as Record<string, unknown>[]) ?? [];

  // SAP Lock: if SAP header values are provided, they are the canonical source of truth.
  // Otherwise fall back to summing lines (manual invoice creation flow).
  const headerNet   = body.headerNet   != null && Number.isFinite(Number(body.headerNet))   ? Number(body.headerNet)   : null;
  const headerVat   = body.headerVat   != null && Number.isFinite(Number(body.headerVat))   ? Number(body.headerVat)   : null;
  const headerGross = body.headerGross != null && Number.isFinite(Number(body.headerGross)) ? Number(body.headerGross) : null;
  const withholdingTaxAmount =
    body.withholdingTaxAmount != null && Number.isFinite(Number(body.withholdingTaxAmount))
      ? Math.max(0, Number(body.withholdingTaxAmount))
      : 0;
  const hasSapHeader = headerGross != null;

  const totalAmount = hasSapHeader
    ? (headerNet ?? (headerGross - (headerVat ?? 0)))
    : lines.reduce((s, l) => s + num(l.quantity) * num(l.unitCost), 0);
  const taxAmount = hasSapHeader
    ? (headerVat ?? 0)
    : lines.reduce((s, l) => s + num(l.taxAmount), 0);
  const grandTotal = hasSapHeader
    ? headerGross
    : (totalAmount + taxAmount);

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
    vendorInvoiceRef: vendorInvoiceRef || undefined,
    companyId,
    supplierId: supplierId,
    supplierName,
    poId: body.poId ? Number(body.poId) : undefined,
    grId: body.grId ? Number(body.grId) : undefined,
    invoiceDate: body.invoiceDate ? new Date(String(body.invoiceDate)) : new Date(),
    dueDate,
    paymentTermDays: body.paymentTermDays ? Number(body.paymentTermDays) : 30,
    totalAmount: String(totalAmount),
    taxAmount: String(taxAmount),
    withholdingTaxAmount: String(withholdingTaxAmount),
    grandTotal: String(grandTotal),
    notes: body.notes ? String(body.notes) : undefined,
    invoiceBreakdown: body.invoiceBreakdown && typeof body.invoiceBreakdown === "object"
      ? body.invoiceBreakdown as Record<string, unknown>
      : undefined,
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

router.put("/vendor-invoices/:id", sapInvoiceLockMiddleware, async (req, res) => {
  const id = Number(String(req.params.id));
  const body = req.body as Record<string, unknown>;
  const [viOwner] = await db.select({ companyId: vendorInvoicesTable.companyId }).from(vendorInvoicesTable).where(eq(vendorInvoicesTable.id, id));
  if (!viOwner) { res.status(404).json({ error: "Not found" }); return; }
  const cid = resolveCompanyId(req as Parameters<typeof resolveCompanyId>[0]);
  if (!await assertCompanyAccess(viOwner.companyId, cid, req, res, { resourceType: "vendor_invoice", resourceId: id })) return;

  // ── SAP INVOICE LOCK GUARD ─────────────────────────────────────────────────
  // Block all financial field updates on POSTED / MATCHED / PAID invoices.
  // Source: sapInvoiceLockEngine.ts — NO EXCEPTIONS, NO OVERRIDE.
  const actor = (req as any).user?.email ?? (req as any).user?.id ?? "UNKNOWN";
  const guard = await guardInvoiceUpdate(id, Object.keys(body), actor);
  if (guard.blocked) {
    res.status(409).json({
      error: guard.message,
      sap_lock: {
        status: guard.sapResult?.status ?? "LOCKED",
        tax_mode: guard.sapResult?.tax_mode ?? "HEADER_TAX_LOCKED",
        validated: guard.sapResult?.validated ?? false,
        flags: guard.sapResult?.flags ?? [],
        blocked_fields: guard.blockedFields,
      },
    });
    return;
  }
  // ── END SAP LOCK GUARD ─────────────────────────────────────────────────────

  const lines = (body.lines as Record<string, unknown>[]) ?? [];
  const totalAmount = lines.reduce((s, l) => s + num(l.quantity) * num(l.unitCost), 0);
  const taxAmount = lines.reduce((s, l) => s + num(l.taxAmount), 0);
  const withholdingTaxAmount =
    body.withholdingTaxAmount != null && Number.isFinite(Number(body.withholdingTaxAmount))
      ? Math.max(0, Number(body.withholdingTaxAmount))
      : undefined;
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
    ...(withholdingTaxAmount !== undefined ? { withholdingTaxAmount: String(withholdingTaxAmount) } : {}),
    notes: body.notes ? String(body.notes) : undefined,
    ...(body.invoiceBreakdown !== undefined
      ? {
          invoiceBreakdown:
            body.invoiceBreakdown && typeof body.invoiceBreakdown === "object"
              ? body.invoiceBreakdown as Record<string, unknown>
              : null,
        }
      : {}),
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
  const id = Number(String(req.params.id));
  const [vi] = await db.select().from(vendorInvoicesTable).where(eq(vendorInvoicesTable.id, id));
  if (!vi) { res.status(404).json({ error: "Not found" }); return; }
  const cid = resolveCompanyId(req as Parameters<typeof resolveCompanyId>[0]);
  if (!await assertCompanyAccess(vi.companyId, cid, req, res, { resourceType: "vendor_invoice", resourceId: id })) return;
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

  // Deteksi Sport Center: cek apakah VI berasal dari PR dengan department = SPORT_CENTER
  let isSportCenter = false;
  let sportCenterFacility: string | null = null;
  let scFacilityId: number | null = null;
  if (vi.poId) {
    const scCheck = await db.execute(sql`
      SELECT pr.department, pr.notes AS pr_notes, smr.facility_id AS sc_facility_id
      FROM purchase_documents po
      JOIN purchase_requests pr ON pr.id = po.source_pr_id
      LEFT JOIN sport_maintenance_requests smr ON smr.purchase_request_id = pr.id
      WHERE po.id = ${vi.poId} AND pr.department = 'SPORT_CENTER'
      LIMIT 1
    `);
    if (scCheck.rows.length > 0) {
      isSportCenter = true;
      const prNotes = String((scCheck.rows[0] as any).pr_notes ?? "");
      const facilityMatch = prNotes.match(/Fasilitas:\s*([^|]+)/);
      sportCenterFacility = facilityMatch ? facilityMatch[1].trim() : null;
      const rawFacilityId = (scCheck.rows[0] as any).sc_facility_id;
      scFacilityId = rawFacilityId ? Number(rawFacilityId) : null;
    }
  }

  // Post journal
  try {
    const invoiceCompanyId = vi.companyId ?? resolveCompanyId(req);
    const settings = await ensureAccountingSettings(invoiceCompanyId);
    const grandTotal = num(vi.grandTotal);
    const taxAmount = num(vi.taxAmount);
    // total_amount is the persisted OCR/manual DPP. Do not derive it from
    // grand_total here, otherwise a mismatched OCR header would self-heal
    // silently and pass the posting gate.
    const netAmount = num(vi.totalAmount);
    const lines = [];

    // Header values are the financial source of truth. Never create a
    // partial journal for an OCR/malformed invoice.
    if (
      netAmount < 0 ||
      taxAmount < 0 ||
      grandTotal < 0 ||
      !isInvoiceTaxBalanced(netAmount, taxAmount, grandTotal)
    ) {
      return res.status(422).json({
        message: "Invoice tidak dapat diposting: DPP + PPN harus sama dengan total invoice.",
      });
    }
    if (!settings.purchaseJournalId || !settings.apAccountId) {
      return res.status(422).json({
        message: "Invoice tidak dapat diposting: jurnal pembelian atau akun hutang belum dikonfigurasi.",
      });
    }
    if (taxAmount > 0 && !settings.ppnInputAccountId) {
      return res.status(422).json({
        message: "Invoice tidak dapat diposting: akun PPN Masukan belum dikonfigurasi.",
      });
    }

    if (isSportCenter) {
      // Sport Center: Debit Biaya Operasional (purchaseExpenseAccountId), Credit Hutang Vendor (AP)

      // FASE 6C: ambil lines VI untuk klasifikasi expense
      const viLinesForClass = await db.select().from(vendorInvoiceLinesTable).where(eq(vendorInvoiceLinesTable.invoiceId, id));
      const firstItemName = viLinesForClass[0]?.name ?? sportCenterFacility ?? "";
      const expenseCategory = classifyExpense(firstItemName);

      // FASE 6C: resolve SPORT_CENTER cost center ID
      const scCostCenterId = await resolveCostCenterId("SPORT_CENTER", invoiceCompanyId);

      // FASE 6B: validasi wajib — reject jika cost_center tidak ditemukan
      if (!scCostCenterId) {
        res.status(422).json({
          error: "Sport Center expense tidak dapat di-post: cost center 'SPORT_CENTER' tidak ditemukan. Pastikan cost center sudah dibuat di master data.",
        });
        return;
      }
      // FASE 6B: reject jika maintenance expense tanpa facility_id
      if (expenseCategory === "maintenance" && !scFacilityId) {
        res.status(422).json({
          error: `Sport Center expense kategori 'maintenance' wajib memiliki facility_id. Cek apakah purchase request dibuat via route request-maintenance dengan facility yang valid.`,
        });
        return;
      }

      const expAcct = settings.purchaseExpenseAccountId;
      if (!expAcct) {
        return res.status(422).json({
          message: "Invoice tidak dapat diposting: akun beban pembelian belum dikonfigurasi.",
        });
      }
      const facilityDesc = sportCenterFacility ? ` — ${sportCenterFacility}` : "";
      if (expAcct) lines.push({ accountId: expAcct, debit: netAmount, credit: 0, description: `Biaya Operasional Sport Center${facilityDesc}: ${vi.invoiceNumber}` });
      if (taxAmount > 0 && settings.ppnInputAccountId) lines.push({ accountId: settings.ppnInputAccountId!, debit: taxAmount, credit: 0, description: "PPN Masukan" });
      if (settings.apAccountId) lines.push({ accountId: settings.apAccountId!, debit: 0, credit: grandTotal, description: `Hutang Vendor Sport Center: ${vi.supplierName}` });
      if (lines.length >= 2) {
        const entry = await postEntry({
          journalId: settings.purchaseJournalId!,
          date: new Date(),
          ref: vi.invoiceNumber,
          description: `[SPORT_CENTER] Vendor Invoice ${vi.invoiceNumber} — ${vi.supplierName}`,
          source: "sport_center_operational_expense",
          sourceId: id,
          companyId: invoiceCompanyId,
          costCenterId: scCostCenterId,
          facilityId: scFacilityId,
          expenseCategory,
          lines,
        }, "PUR");
        await db.update(vendorInvoicesTable).set({ status: "posted", isLocked: true, threeWayMatchStatus: matchStatus, matchNotes, journalEntryId: entry.id, updatedAt: new Date() }).where(eq(vendorInvoicesTable.id, id));
      } else {
        await db.update(vendorInvoicesTable).set({ status: "posted", isLocked: true, threeWayMatchStatus: matchStatus, matchNotes, updatedAt: new Date() }).where(eq(vendorInvoicesTable.id, id));
      }
    } else {
      // Standard purchase bill posting
      // Jika ada GRN terkait:
      //   - grirAccountId ada → DR GR/IR (clearing accrual dari GRN)
      //   - grirAccountId tidak ada → GRN tidak membuat accrual, jadi DR Persediaan langsung
      // Jika tidak ada GRN: DR Beban Pembelian (service/expense)
      const debitAccId = vi.grId
        ? (settings.grirAccountId ?? settings.inventoryAccountId ?? settings.purchaseExpenseAccountId)
        : settings.purchaseExpenseAccountId;
      if (!debitAccId) {
        return res.status(422).json({
          message: "Invoice tidak dapat diposting: akun beban/persediaan pembelian belum dikonfigurasi.",
        });
      }
      const debitDesc = vi.grId
        ? (settings.grirAccountId
          ? `GR/IR clearing ${vi.invoiceNumber}`
          : `Persediaan barang (tanpa GR/IR): ${vi.invoiceNumber}`)
        : "Purchase expense";
      if (debitAccId) lines.push({ accountId: debitAccId, debit: netAmount, credit: 0, description: debitDesc });
      if (taxAmount > 0 && settings.ppnInputAccountId) lines.push({ accountId: settings.ppnInputAccountId!, debit: taxAmount, credit: 0, description: "VAT in" });
      if (settings.apAccountId) lines.push({ accountId: settings.apAccountId!, debit: 0, credit: grandTotal, description: "AP vendor invoice" });
      if (lines.length >= 2) {
         const entry = await postEntry({ journalId: settings.purchaseJournalId!, date: new Date(), ref: vi.invoiceNumber, description: `Vendor Invoice ${vi.invoiceNumber}`, source: "purchase_bill", sourceId: id, companyId: invoiceCompanyId, lines }, "PUR");
        await db.update(vendorInvoicesTable).set({ status: "posted", isLocked: true, threeWayMatchStatus: matchStatus, matchNotes, journalEntryId: entry.id, updatedAt: new Date() }).where(eq(vendorInvoicesTable.id, id));
      } else {
        await db.update(vendorInvoicesTable).set({ status: "posted", isLocked: true, threeWayMatchStatus: matchStatus, matchNotes, updatedAt: new Date() }).where(eq(vendorInvoicesTable.id, id));
      }
    }
  } catch (e) {
    // A journal error must not be converted into a false posted invoice.
    console.error("[VI post]", e);
    return res.status(422).json({
      message: "Invoice tersimpan sebagai draft karena jurnal gagal dibuat. Periksa konfigurasi akuntansi lalu coba lagi.",
    });
  }

  const [updated] = await db.select().from(vendorInvoicesTable).where(eq(vendorInvoicesTable.id, id));

  // ── SAP INVOICE LOCK: store immutable snapshot after posting ───────────────
  // Runs async — non-blocking, non-fatal.
  if (updated) {
    const postActor = (req as any).user?.email ?? (req as any).user?.id ?? "SYSTEM";
    lockInvoiceSnapshot(id, {
      id: updated.id,
      status: updated.status,
      totalAmount: updated.totalAmount,
      taxAmount: updated.taxAmount,
      grandTotal: updated.grandTotal,
      invoiceNumber: updated.invoiceNumber,
      companyId: updated.companyId,
    }, postActor).catch(() => {});
  }
  // ── END SAP LOCK SNAPSHOT ──────────────────────────────────────────────────

  res.json(updated);
});

router.post("/vendor-invoices/:id/cancel", async (req, res) => {
  await db.update(vendorInvoicesTable).set({ status: "cancelled", cancelledAt: new Date(), updatedAt: new Date() }).where(eq(vendorInvoicesTable.id, Number(String(req.params.id))));
  const id = Number(req.params.id);
  const [viOwner] = await db.select({ companyId: vendorInvoicesTable.companyId }).from(vendorInvoicesTable).where(eq(vendorInvoicesTable.id, id));
  if (!viOwner) { res.status(404).json({ error: "Not found" }); return; }
  const cid = resolveCompanyId(req as Parameters<typeof resolveCompanyId>[0]);
  if (!await assertCompanyAccess(viOwner.companyId, cid, req, res, { resourceType: "vendor_invoice", resourceId: id })) return;
  await db.update(vendorInvoicesTable).set({ status: "cancelled", cancelledAt: new Date(), updatedAt: new Date() }).where(eq(vendorInvoicesTable.id, id));
  res.json({ ok: true });
});

router.delete("/vendor-invoices/:id", async (req, res) => {
  const id = Number(String(req.params.id));
  const [vi] = await db.select().from(vendorInvoicesTable).where(eq(vendorInvoicesTable.id, id));
  if (!vi) { res.status(404).json({ error: "Not found" }); return; }
  const cid = resolveCompanyId(req as Parameters<typeof resolveCompanyId>[0]);
  if (!await assertCompanyAccess(vi.companyId, cid, req, res, { resourceType: "vendor_invoice", resourceId: id })) return;
  if (vi.status === "paid") { res.status(400).json({ error: "Invoice yang sudah dibayar tidak bisa dihapus" }); return; }
  await db.delete(vendorInvoiceLinesTable).where(eq(vendorInvoiceLinesTable.invoiceId, id));
  await db.delete(vendorInvoicesTable).where(eq(vendorInvoicesTable.id, id));
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
  const id = Number(String(req.params.id));
  const [pr] = await db.select().from(paymentRequestsTable).where(eq(paymentRequestsTable.id, id));
  if (!pr) { res.status(404).json({ error: "Not found" }); return; }
  const cid = resolveCompanyId(req as Parameters<typeof resolveCompanyId>[0]);
  if (!await assertCompanyAccess(pr.companyId, cid, req, res, { resourceType: "payment_request", resourceId: id })) return;
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
  const id = Number(String(req.params.id));
  const { action, approvedBy, paymentMethod, bankAccount, paymentDate } = req.body as Record<string, string>;
  const [pr] = await db.select().from(paymentRequestsTable).where(eq(paymentRequestsTable.id, id));
  if (!pr) { res.status(404).json({ error: "Not found" }); return; }
  const cid = resolveCompanyId(req as Parameters<typeof resolveCompanyId>[0]);
  if (!await assertCompanyAccess(pr.companyId, cid, req, res, { resourceType: "payment_request", resourceId: id })) return;

  if (action === "submit") {
    await db.update(paymentRequestsTable).set({ status: "submitted", updatedAt: new Date() }).where(eq(paymentRequestsTable.id, id));
  } else if (action === "approve") {
    await db.update(paymentRequestsTable).set({ status: "approved", approvedBy: approvedBy ?? null, approvedAt: new Date(), updatedAt: new Date() }).where(eq(paymentRequestsTable.id, id));
  } else if (action === "reject") {
    await db.update(paymentRequestsTable).set({ status: "rejected", updatedAt: new Date() }).where(eq(paymentRequestsTable.id, id));
  } else if (action === "pay") {
    // Phase 2: Pembayaran WAJIB melalui Bank Disbursement.
    // Endpoint ini tidak lagi memanggil postEntry() langsung.
    // Frontend harus membuat BD terlebih dahulu, lalu kirim bdId ke sini.
    const { bdId } = req.body as Record<string, unknown>;
    if (!bdId) {
      res.status(422).json({
        error: "payment_requires_bd",
        message: "Pembayaran harus dilakukan melalui Bank Disbursement. Buat BD terlebih dahulu, kemudian kirimkan bdId.",
      });
      return;
    }

    // Verifikasi BD exists dan statusnya posted
    const [bdRow] = await db.execute<{ id: number; status: string; disbursement_number: string; total_amount: string }>(
      sql`SELECT id, status, disbursement_number, total_amount FROM bank_disbursements WHERE id = ${Number(bdId)} AND company_id = ${pr.companyId ?? cid}`
    ).then((r) => (Array.isArray(r) ? r : (r as any).rows ?? []) as Array<{ id: number; status: string; disbursement_number: string; total_amount: string }>);

    if (!bdRow) {
      res.status(404).json({ error: "bd_not_found", message: `Bank Disbursement #${bdId} tidak ditemukan.` });
      return;
    }
    if (bdRow.status !== "posted") {
      res.status(409).json({ error: "bd_not_posted", message: `Bank Disbursement ${bdRow.disbursement_number} belum berstatus posted (status: ${bdRow.status}).` });
      return;
    }

    const paidDate = paymentDate ? new Date(paymentDate) : new Date();
    // Mark PR as paid — journal sudah diposting oleh BD, tidak perlu postEntry ulang
    await db.update(paymentRequestsTable).set({
      status: "paid",
      paidAmount: pr.totalAmount,
      paymentMethod: paymentMethod ?? null,
      bankAccount: bankAccount ?? null,
      paymentDate: paidDate,
      updatedAt: new Date(),
    }).where(eq(paymentRequestsTable.id, id));

    // Update vendor invoices sebagai paid (logic tetap sama seperti sebelumnya)
    const items = await db.select().from(paymentRequestItemsTable).where(eq(paymentRequestItemsTable.paymentRequestId, id));
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
  const id = Number(String(req.params.id));
  const [lc] = await db.select().from(landedCostsTable).where(eq(landedCostsTable.id, id));
  if (!lc) { res.status(404).json({ error: "Not found" }); return; }
  const cid = resolveCompanyId(req as Parameters<typeof resolveCompanyId>[0]);
  if (!await assertCompanyAccess(lc.companyId, cid, req, res, { resourceType: "landed_cost", resourceId: id })) return;
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
  const id = Number(String(req.params.id));
  const [lc] = await db.select().from(landedCostsTable).where(eq(landedCostsTable.id, id));
  if (!lc) { res.status(404).json({ error: "Not found" }); return; }
  const cid = resolveCompanyId(req as Parameters<typeof resolveCompanyId>[0]);
  if (!await assertCompanyAccess(lc.companyId, cid, req, res, { resourceType: "landed_cost", resourceId: id })) return;
  if (!lc.grId) { res.status(400).json({ error: "No GR linked" }); return; }

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
  const poId = Number(String(req.params.poId));
  const [poCo] = await db.select({ companyId: purchaseDocumentsTable.companyId }).from(purchaseDocumentsTable).where(eq(purchaseDocumentsTable.id, poId));
  if (!poCo) { res.status(404).json({ error: "Not found" }); return; }
  const cid = resolveCompanyId(req as Parameters<typeof resolveCompanyId>[0]);
  if (!await assertCompanyAccess(poCo.companyId, cid, req, res, { resourceType: "purchase_document", resourceId: poId })) return;
  const rows = await db.select().from(purchaseApprovalsTable)
    .where(and(eq(purchaseApprovalsTable.docType, "PO"), eq(purchaseApprovalsTable.docId, poId)))
    .orderBy(purchaseApprovalsTable.step);
  res.json(rows);
});

router.post("/po-approvals/:poId/action", async (req, res) => {
  const poId = Number(String(req.params.poId));
  const { action, notes, approverName, approverId } = req.body as Record<string, string>;
  const [poCo] = await db.select({ companyId: purchaseDocumentsTable.companyId }).from(purchaseDocumentsTable).where(eq(purchaseDocumentsTable.id, poId));
  if (!poCo) { res.status(404).json({ error: "Not found" }); return; }
  const cid = resolveCompanyId(req as Parameters<typeof resolveCompanyId>[0]);
  if (!await assertCompanyAccess(poCo.companyId, cid, req, res, { resourceType: "purchase_document", resourceId: poId })) return;
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

// ─────────────────────────────────────────────────────────────────────────────
// SAP APPROVAL WORKFLOW — Endpoints
// POST /vendor-invoices/:id/sap-submit   → DRAFT → PENDING_APPROVAL
// POST /vendor-invoices/:id/sap-approve  → advance to next approval level
// POST /vendor-invoices/:id/sap-reject   → any → DRAFT
// POST /vendor-invoices/:id/sap-lock     → POSTED → LOCKED
// GET  /vendor-invoices/:id/sap-status   → current state + history + audit trail
// ─────────────────────────────────────────────────────────────────────────────

router.post("/vendor-invoices/:id/sap-submit", sapAuditMiddleware, async (req, res) => {
  const id = Number(String(req.params.id));
  const [viOwner] = await db.select({ companyId: vendorInvoicesTable.companyId }).from(vendorInvoicesTable).where(eq(vendorInvoicesTable.id, id));
  if (!viOwner) { res.status(404).json({ error: "Not found" }); return; }
  const cid = resolveCompanyId(req as Parameters<typeof resolveCompanyId>[0]);
  if (!await assertCompanyAccess(viOwner.companyId, cid, req, res, { resourceType: "vendor_invoice", resourceId: id })) return;

  const actor = (req as any).user?.email ?? (req as any).user?.id ?? "SYSTEM";
  const role  = (req as any).user?.role  ?? "user";

  try {
    let doc = await loadOrCreateApprovalState("vendor_invoice", id);
    if (doc.status !== APPROVAL_STATES.DRAFT) {
      res.status(422).json({ error: "ALREADY_SUBMITTED", current_status: doc.status });
      return;
    }
    doc = approveDocument(doc, role, actor, (req.body as any)?.note ?? null);
    await saveApprovalState(doc);
    res.json({ ok: true, document_id: id, status: doc.status, approval_history: doc.approval_history });
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e);
    res.status(400).json({ error: msg });
  }
});

router.post("/vendor-invoices/:id/sap-approve", sapAuditMiddleware, async (req, res) => {
  const id = Number(String(req.params.id));
  const [viOwner] = await db.select({ companyId: vendorInvoicesTable.companyId }).from(vendorInvoicesTable).where(eq(vendorInvoicesTable.id, id));
  if (!viOwner) { res.status(404).json({ error: "Not found" }); return; }
  const cid = resolveCompanyId(req as Parameters<typeof resolveCompanyId>[0]);
  if (!await assertCompanyAccess(viOwner.companyId, cid, req, res, { resourceType: "vendor_invoice", resourceId: id })) return;

  const actor = (req as any).user?.email ?? (req as any).user?.id ?? "SYSTEM";
  const role  = (req as any).user?.role  ?? "user";

  try {
    let doc = await loadOrCreateApprovalState("vendor_invoice", id);
    if (doc.status === APPROVAL_STATES.DRAFT) {
      res.status(422).json({ error: "MUST_SUBMIT_FIRST — call sap-submit before approving" });
      return;
    }
    const before = { ...doc };
    doc = approveDocument(doc, role, actor, (req.body as any)?.note ?? null);
    await saveApprovalState(doc);

    // Write manual audit entry (middleware handles res.json hook, this is belt-and-suspenders)
    await writeSapAuditLog(buildAuditLog({
      entityType: "vendor_invoice",
      entityId:   id,
      action:     `SAP_APPROVE → ${doc.status}`,
      actorId:    actor,
      role,
      before:     before,
      after:      doc,
    })).catch(() => {});

    res.json({ ok: true, document_id: id, status: doc.status, current_approver: doc.current_approver, approval_history: doc.approval_history });
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e);
    const status = msg === "DOCUMENT_LOCKED" ? 403 : msg.startsWith("INVALID_STATE") ? 422 : 400;
    res.status(status).json({ error: msg });
  }
});

router.post("/vendor-invoices/:id/sap-reject", sapAuditMiddleware, async (req, res) => {
  const id = Number(String(req.params.id));
  const [viOwner] = await db.select({ companyId: vendorInvoicesTable.companyId }).from(vendorInvoicesTable).where(eq(vendorInvoicesTable.id, id));
  if (!viOwner) { res.status(404).json({ error: "Not found" }); return; }
  const cid = resolveCompanyId(req as Parameters<typeof resolveCompanyId>[0]);
  if (!await assertCompanyAccess(viOwner.companyId, cid, req, res, { resourceType: "vendor_invoice", resourceId: id })) return;

  const actor = (req as any).user?.email ?? (req as any).user?.id ?? "SYSTEM";
  const role  = (req as any).user?.role  ?? "user";

  try {
    let doc = await loadOrCreateApprovalState("vendor_invoice", id);
    const before = { ...doc };
    doc = rejectDocument(doc, role, actor, (req.body as any)?.note ?? null);
    await saveApprovalState(doc);
    res.json({ ok: true, document_id: id, status: doc.status, approval_history: doc.approval_history });
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e);
    res.status(400).json({ error: msg });
  }
});

router.post("/vendor-invoices/:id/sap-lock", sapAuditMiddleware, async (req, res) => {
  const id = Number(String(req.params.id));
  const [vi] = await db.select({ companyId: vendorInvoicesTable.companyId, status: vendorInvoicesTable.status }).from(vendorInvoicesTable).where(eq(vendorInvoicesTable.id, id));
  if (!vi) { res.status(404).json({ error: "Not found" }); return; }
  const cid = resolveCompanyId(req as Parameters<typeof resolveCompanyId>[0]);
  if (!await assertCompanyAccess(vi.companyId, cid, req, res, { resourceType: "vendor_invoice", resourceId: id })) return;

  const actor = (req as any).user?.email ?? (req as any).user?.id ?? "SYSTEM";
  const role  = (req as any).user?.role  ?? "user";

  try {
    let doc = await loadOrCreateApprovalState("vendor_invoice", id);
    if (doc.status !== APPROVAL_STATES.POSTED) {
      res.status(422).json({ error: `CANNOT_LOCK — document must be POSTED first (current: ${doc.status})` });
      return;
    }
    doc = approveDocument(doc, role, actor, "SYSTEM LOCK");
    await saveApprovalState(doc);
    // Also set DB-level is_locked = true
    await db.execute(sql`UPDATE vendor_invoices SET is_locked = true WHERE id = ${id}`);
    res.json({ ok: true, document_id: id, status: doc.status });
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e);
    res.status(400).json({ error: msg });
  }
});

router.get("/vendor-invoices/:id/sap-status", async (req, res) => {
  const id = Number(String(req.params.id));
  const [viOwner] = await db.select({ companyId: vendorInvoicesTable.companyId }).from(vendorInvoicesTable).where(eq(vendorInvoicesTable.id, id));
  if (!viOwner) { res.status(404).json({ error: "Not found" }); return; }
  const cid = resolveCompanyId(req as Parameters<typeof resolveCompanyId>[0]);
  if (!await assertCompanyAccess(viOwner.companyId, cid, req, res, { resourceType: "vendor_invoice", resourceId: id })) return;

  const [doc, auditRows] = await Promise.all([
    loadOrCreateApprovalState("vendor_invoice", id),
    db.execute<{ id: string; action: string; actor_id: string | null; role: string | null; timestamp: string }>(sql`
      SELECT id, action, actor_id, role, timestamp::text
      FROM   sap_audit_ledger
      WHERE  entity_type = 'vendor_invoice'
        AND  entity_id   = ${String(id)}
      ORDER  BY timestamp DESC
      LIMIT  50
    `),
  ]);

  res.json({
    document_id:      id,
    status:           doc.status,
    current_approver: doc.current_approver,
    approval_history: doc.approval_history,
    audit_trail:      auditRows.rows,
    updated_at:       doc.updated_at,
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// SAP JOURNAL POSTING ENGINE — Endpoints
// POST /vendor-invoices/:id/sap-journal  → create POSTED journal from invoice
// GET  /vendor-invoices/:id/sap-journal  → fetch latest POSTED journal
// POST /vendor-invoices/:id/sap-reverse  → create REVERSED journal from posted journal
// ─────────────────────────────────────────────────────────────────────────────

router.post("/vendor-invoices/:id/sap-journal", sapAuditMiddleware, async (req, res) => {
  const id = Number(String(req.params.id));
  const [vi] = await db.select().from(vendorInvoicesTable).where(eq(vendorInvoicesTable.id, id));
  if (!vi) { res.status(404).json({ error: "Not found" }); return; }
  const cid = resolveCompanyId(req as Parameters<typeof resolveCompanyId>[0]);
  if (!await assertCompanyAccess(vi.companyId, cid, req, res, { resourceType: "vendor_invoice", resourceId: id })) return;

  try {
    const journal = createSapJournal({
      id:          vi.id,
      status:      vi.status,
      totalAmount: vi.totalAmount,
      taxAmount:   vi.taxAmount,
      grandTotal:  vi.grandTotal,
    });
    const stored = await storeSapJournal(journal);
    res.status(201).json(stored);
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e);
    const status = msg === "INVOICE_NOT_POSTED" ? 422
                 : msg.startsWith("JOURNAL_NOT_BALANCED") ? 400 : 500;
    res.status(status).json({ error: msg });
  }
});

router.get("/vendor-invoices/:id/sap-journal", async (req, res) => {
  const id = Number(String(req.params.id));
  const [viOwner] = await db.select({ companyId: vendorInvoicesTable.companyId }).from(vendorInvoicesTable).where(eq(vendorInvoicesTable.id, id));
  if (!viOwner) { res.status(404).json({ error: "Not found" }); return; }
  const cid = resolveCompanyId(req as Parameters<typeof resolveCompanyId>[0]);
  if (!await assertCompanyAccess(viOwner.companyId, cid, req, res, { resourceType: "vendor_invoice", resourceId: id })) return;

  const journal = await getSapJournalByInvoice(id);
  if (!journal) { res.status(404).json({ error: "No POSTED journal found for this invoice" }); return; }
  res.json(journal);
});

router.post("/vendor-invoices/:id/sap-reverse", sapAuditMiddleware, async (req, res) => {
  const id = Number(String(req.params.id));
  const [viOwner] = await db.select({ companyId: vendorInvoicesTable.companyId }).from(vendorInvoicesTable).where(eq(vendorInvoicesTable.id, id));
  if (!viOwner) { res.status(404).json({ error: "Not found" }); return; }
  const cid = resolveCompanyId(req as Parameters<typeof resolveCompanyId>[0]);
  if (!await assertCompanyAccess(viOwner.companyId, cid, req, res, { resourceType: "vendor_invoice", resourceId: id })) return;

  const original = await getSapJournalByInvoice(id);
  if (!original) { res.status(404).json({ error: "No POSTED journal found for this invoice — cannot reverse" }); return; }

  try {
    const reversed = reverseJournal(original);
    const stored   = await storeSapJournal(reversed);

    // Mark the original journal as reversed in DB
    await db.execute(sql`
      UPDATE sap_journals SET status = 'REVERSED' WHERE id = ${original.journal_id}
    `);

    res.status(201).json(stored);
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e);
    res.status(400).json({ error: msg });
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// SAP AUDIT LEDGER — Global Query Endpoint
// GET /sap-audit-ledger
//   ?entity_type=vendor_invoice
//   &entity_id=42
//   &invoice_number=VI-2026-001   ← NEW: filter by human-readable invoice number
//   &action=SAP_APPROVE
//   &actor_id=admin@example.com
//   &from=2026-01-01
//   &to=2026-12-31
//   &limit=50&offset=0
// ─────────────────────────────────────────────────────────────────────────────

router.get("/sap-audit-ledger", async (req, res) => {
  const {
    entity_type, entity_id, action: actionFilter,
    actor_id, from, to, invoice_number,
  } = req.query as Record<string, string | undefined>;

  const limit  = Math.min(Number(req.query.limit  ?? 100), 500);
  const offset = Math.max(Number(req.query.offset ?? 0), 0);

  // When invoice_number is supplied, resolve matching entity_ids via vendor_invoices JOIN.
  // This avoids exposing raw SQL to the client while keeping the filter accurate.
  const invoiceNumFilter = invoice_number?.trim();

  const [rows, countRows] = await Promise.all([
    db.execute<{
      id: string; entity_type: string; entity_id: string;
      action: string; actor_id: string | null; role: string | null;
      before_data: unknown; after_data: unknown; timestamp: string;
      invoice_number: string | null;
    }>(sql`
      SELECT sal.id, sal.entity_type, sal.entity_id, sal.action, sal.actor_id, sal.role,
             sal.before_data, sal.after_data, sal.timestamp::text,
             vi.invoice_number
      FROM   sap_audit_ledger sal
      LEFT   JOIN vendor_invoices vi
             ON  sal.entity_type = 'vendor_invoice'
             AND sal.entity_id   = vi.id::text
      WHERE  TRUE
        ${entity_type      ? sql`AND sal.entity_type = ${entity_type}` : sql``}
        ${entity_id        ? sql`AND sal.entity_id   = ${entity_id}`   : sql``}
        ${invoiceNumFilter ? sql`AND vi.invoice_number ILIKE ${"%" + invoiceNumFilter + "%"}` : sql``}
        ${actionFilter     ? sql`AND sal.action ILIKE ${"%" + actionFilter + "%"}` : sql``}
        ${actor_id         ? sql`AND sal.actor_id ILIKE ${"%" + actor_id + "%"}` : sql``}
        ${from             ? sql`AND sal.timestamp >= ${from}::timestamptz`       : sql``}
        ${to               ? sql`AND sal.timestamp <= ${to}::timestamptz + interval '1 day'` : sql``}
      ORDER  BY sal.timestamp DESC
      LIMIT  ${limit} OFFSET ${offset}
    `),
    db.execute<{ total: number }>(sql`
      SELECT COUNT(*)::int AS total
      FROM   sap_audit_ledger sal
      LEFT   JOIN vendor_invoices vi
             ON  sal.entity_type = 'vendor_invoice'
             AND sal.entity_id   = vi.id::text
      WHERE  TRUE
        ${entity_type      ? sql`AND sal.entity_type = ${entity_type}` : sql``}
        ${entity_id        ? sql`AND sal.entity_id   = ${entity_id}`   : sql``}
        ${invoiceNumFilter ? sql`AND vi.invoice_number ILIKE ${"%" + invoiceNumFilter + "%"}` : sql``}
        ${actionFilter     ? sql`AND sal.action ILIKE ${"%" + actionFilter + "%"}` : sql``}
        ${actor_id         ? sql`AND sal.actor_id ILIKE ${"%" + actor_id + "%"}` : sql``}
        ${from             ? sql`AND sal.timestamp >= ${from}::timestamptz`       : sql``}
        ${to               ? sql`AND sal.timestamp <= ${to}::timestamptz + interval '1 day'` : sql``}
    `),
  ]);

  res.json({
    items:  rows.rows,
    total:  (countRows.rows[0] as any)?.total ?? 0,
    limit,
    offset,
  });
});

// GET /sap-audit-ledger/stats — action counts grouped by entity_type + action
router.get("/sap-audit-ledger/stats", async (_req, res) => {
  const rows = await db.execute<{
    entity_type: string; action: string; count: number; last_seen: string;
  }>(sql`
    SELECT entity_type,
           action,
           COUNT(*)::int  AS count,
           MAX(timestamp)::text AS last_seen
    FROM   sap_audit_ledger
    GROUP  BY entity_type, action
    ORDER  BY count DESC
    LIMIT  100
  `);

  res.json(rows.rows);
});

export default router;
