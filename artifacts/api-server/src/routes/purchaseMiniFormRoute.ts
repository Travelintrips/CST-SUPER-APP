import { Router, type Request, type Response } from "express";
import { randomBytes } from "crypto";
import { and, desc, eq, sql } from "drizzle-orm";

import {
  db,
  purchaseMiniFormsTable,
  vendorInvoicesTable,
  goodsReceiptsTable,
  purchaseDocumentsTable,
  vendorInvoiceLinesTable,
} from "@workspace/db";
import { requireClerkUser } from "../lib/requireAdmin.js";
import { logger } from "../lib/logger.js";
import { ensureAccountingSettings } from "../lib/accountingSeed.js";
import { postEntry } from "../lib/accounting.js";

export const purchaseMiniPublicRouter = Router();
export const purchaseMiniAdminRouter = Router();

// ─── Helper: Post Vendor Invoice Accounting ───────────────────────────────────
// Logic identik dengan POST /purchase-workflow/vendor-invoices/:id/post
// Idempotent: tidak double-post jika VI sudah berstatus posted/paid.
async function postVendorInvoiceAccounting(
  vendorInvoiceId: number,
  submissionData: Record<string, unknown>,
): Promise<void> {
  const [vi] = await db
    .select()
    .from(vendorInvoicesTable)
    .where(eq(vendorInvoicesTable.id, vendorInvoiceId))
    .limit(1);

  if (!vi) {
    logger.warn({ vendorInvoiceId }, "postVendorInvoiceAccounting: vendor invoice tidak ditemukan");
    return;
  }

  // Idempotency guard: hanya post jika masih draft
  if (vi.status !== "draft") {
    logger.info({ vendorInvoiceId, status: vi.status }, "postVendorInvoiceAccounting: sudah diposting, skip");
    return;
  }
  if (!Number.isInteger(vi.companyId) || vi.companyId == null || vi.companyId <= 0) {
    logger.error({ vendorInvoiceId, companyId: vi.companyId }, "postVendorInvoiceAccounting: company context missing — refusing to post");
    return;
  }

  // Update nomor invoice vendor dari data submission jika ada
  const vendorRef = submissionData.vendorInvoiceRef as string | undefined;
  if (vendorRef && vendorRef.trim()) {
    await db
      .update(vendorInvoicesTable)
      .set({ vendorInvoiceRef: vendorRef.trim(), updatedAt: new Date() })
      .where(eq(vendorInvoicesTable.id, vendorInvoiceId));
  }

  // 3-way match check
  let matchStatus = "unmatched";
  let matchNotes = "";
  if (vi.poId && vi.grId) {
    const [po] = await db
      .select()
      .from(purchaseDocumentsTable)
      .where(eq(purchaseDocumentsTable.id, vi.poId))
      .limit(1);
    const [gr] = await db
      .select()
      .from(goodsReceiptsTable)
      .where(eq(goodsReceiptsTable.id, vi.grId))
      .limit(1);
    if (po && gr && gr.status === "confirmed") {
      const poTotal = Number(po.grandTotal ?? 0);
      const viTotal = Number(vi.grandTotal ?? 0);
      const diff = Math.abs(poTotal - viTotal);
      if (diff < 1) {
        matchStatus = "matched";
        matchNotes = "PO, GR, VI amounts match";
      } else {
        matchStatus = "partial";
        matchNotes = `Variance: ${diff.toFixed(2)}`;
      }
    }
  } else if (vi.poId) {
    matchStatus = "partial";
    matchNotes = "No GR linked";
  }

  // Post jurnal akuntansi: Dr GR/IR (clearing) → Cr AP
  try {
    const settings = await ensureAccountingSettings(vi.companyId);
    const grandTotal = Number(vi.grandTotal ?? 0);
    const taxAmount = Number(vi.taxAmount ?? 0);
    const netAmount = grandTotal - taxAmount;

    const lines: { accountId: number; debit: number; credit: number; description: string }[] = [];

    // Debit: GR/IR clearing (jika linked GR) atau purchase expense
    const debitAccId = (vi.grId && settings.grirAccountId)
      ? settings.grirAccountId
      : settings.purchaseExpenseAccountId;
    const debitDesc = (vi.grId && settings.grirAccountId)
      ? `GR/IR clearing ${vi.invoiceNumber}`
      : "Purchase expense";

    if (debitAccId) lines.push({ accountId: debitAccId, debit: netAmount, credit: 0, description: debitDesc });
    if (taxAmount > 0 && settings.ppnInputAccountId) {
      lines.push({ accountId: settings.ppnInputAccountId, debit: taxAmount, credit: 0, description: "VAT in" });
    }
    if (settings.apAccountId) {
      lines.push({ accountId: settings.apAccountId, debit: 0, credit: grandTotal, description: "AP vendor invoice" });
    }

    if (lines.length >= 2 && settings.purchaseJournalId) {
      const entry = await postEntry(
        {
          journalId: settings.purchaseJournalId,
          date: new Date(),
          ref: vi.invoiceNumber,
          description: `Vendor Invoice ${vi.invoiceNumber} (via Mini Form)`,
          source: "purchase_bill",
          sourceId: vendorInvoiceId,
          companyId: vi.companyId,
          lines,
        },
        "PUR",
      );
      await db
        .update(vendorInvoicesTable)
        .set({
          status: "posted",
          threeWayMatchStatus: matchStatus,
          matchNotes,
          journalEntryId: entry.id,
          updatedAt: new Date(),
        })
        .where(eq(vendorInvoicesTable.id, vendorInvoiceId));
    } else {
      await db
        .update(vendorInvoicesTable)
        .set({ status: "posted", threeWayMatchStatus: matchStatus, matchNotes, updatedAt: new Date() })
        .where(eq(vendorInvoicesTable.id, vendorInvoiceId));
    }

    // Update billStatus PO jika linked dan belum billed
    if (vi.poId) {
      const [po] = await db
        .select({ billStatus: purchaseDocumentsTable.billStatus })
        .from(purchaseDocumentsTable)
        .where(eq(purchaseDocumentsTable.id, vi.poId))
        .limit(1);
      if (po && po.billStatus !== "billed") {
        await db
          .update(purchaseDocumentsTable)
          .set({ billStatus: "billed", updatedAt: new Date() })
          .where(eq(purchaseDocumentsTable.id, vi.poId));
      }
    }

    logger.info(
      { vendorInvoiceId, matchStatus, grandTotal },
      "postVendorInvoiceAccounting: berhasil diposting",
    );
  } catch (err) {
    logger.error({ err, vendorInvoiceId }, "postVendorInvoiceAccounting: error saat posting jurnal");
    // Tetap tandai sebagai posted meski jurnal gagal, agar tidak double-post
    await db
      .update(vendorInvoicesTable)
      .set({ status: "posted", threeWayMatchStatus: matchStatus, matchNotes, updatedAt: new Date() })
      .where(eq(vendorInvoicesTable.id, vendorInvoiceId));
    throw err;
  }
}

// ─── Boot migration ───────────────────────────────────────────────────────────
let migrationDone = false;
async function ensureTable() {
  if (migrationDone) return;
  try {
    await db.execute(sql`
      CREATE TABLE IF NOT EXISTS purchase_mini_forms (
        id SERIAL PRIMARY KEY,
        token TEXT NOT NULL UNIQUE,
        form_type TEXT NOT NULL,
        ref_number TEXT,
        title TEXT,
        notes TEXT,
        target_name TEXT,
        currency TEXT NOT NULL DEFAULT 'IDR',
        payload JSONB NOT NULL DEFAULT '{}',
        status TEXT NOT NULL DEFAULT 'pending',
        submission_data JSONB DEFAULT '{}',
        submitted_at TIMESTAMPTZ,
        order_id INTEGER,
        purchase_doc_id INTEGER,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        created_by TEXT,
        expires_at TIMESTAMPTZ
      )
    `);
    migrationDone = true;
  } catch (err) {
    logger.error({ err }, "purchaseMiniForm ensureTable error");
  }
}

// ─── Helper: auto-post vendor invoice ke accounting ──────────────────────────
/**
 * Setelah vendor submit mini form vendor_invoice, cari VI terkait dan post ke
 * accounting jika belum di-post. Idempotent: skip jika status !== draft.
 */
async function autoPostVendorInvoice(
  refNumber: string | null,
  purchaseDocId: number | null,
  body: Record<string, unknown>,
): Promise<void> {
  // 1. Cari vendor invoice: prioritas by invoiceNumber, fallback by poId
  let vi: typeof vendorInvoicesTable.$inferSelect | null = null;
  if (refNumber) {
    const rows = await db
      .select()
      .from(vendorInvoicesTable)
      .where(eq(vendorInvoicesTable.invoiceNumber, refNumber))
      .limit(1);
    vi = rows[0] ?? null;
  }
  if (!vi && purchaseDocId) {
    const rows = await db
      .select()
      .from(vendorInvoicesTable)
      .where(
        and(
          eq(vendorInvoicesTable.poId, purchaseDocId),
          eq(vendorInvoicesTable.status, "draft"),
        ),
      )
      .orderBy(desc(vendorInvoicesTable.createdAt))
      .limit(1);
    vi = rows[0] ?? null;
  }
  if (!vi) {
    logger.warn({ refNumber, purchaseDocId }, "autoPostVendorInvoice: tidak ada VI ditemukan — skip");
    return;
  }

  // 2. Idempotent guard
  if (vi.status !== "draft") {
    logger.info({ viId: vi.id, status: vi.status }, "autoPostVendorInvoice: VI sudah diposting — skip");
    return;
  }
  if (!Number.isInteger(vi.companyId) || vi.companyId == null || vi.companyId <= 0) {
    logger.error({ viId: vi.id, companyId: vi.companyId }, "autoPostVendorInvoice: company context missing — refusing to post");
    return;
  }

  // 3. Update VI dengan referensi invoice dari vendor (opsional)
  const vendorInvoiceRef = body.vendorInvoiceRef as string | undefined;
  if (vendorInvoiceRef?.trim()) {
    await db
      .update(vendorInvoicesTable)
      .set({ vendorInvoiceRef: vendorInvoiceRef.trim(), updatedAt: new Date() })
      .where(eq(vendorInvoicesTable.id, vi.id));
    vi = { ...vi, vendorInvoiceRef: vendorInvoiceRef.trim() };
  }

  // 4. 3-way match check (informational, tidak blocking)
  let matchStatus = "unmatched";
  let matchNotes = "";
  if (vi.poId && vi.grId) {
    const [po] = await db
      .select()
      .from(purchaseDocumentsTable)
      .where(eq(purchaseDocumentsTable.id, vi.poId))
      .limit(1);
    const [gr] = await db
      .select()
      .from(goodsReceiptsTable)
      .where(eq(goodsReceiptsTable.id, vi.grId))
      .limit(1);
    if (po && gr && gr.status === "confirmed") {
      const diff = Math.abs(Number(po.grandTotal) - Number(vi.grandTotal));
      if (diff < 1) {
        matchStatus = "matched";
        matchNotes = "PO, GR, VI amounts match (via mini form)";
      } else {
        matchStatus = "partial";
        matchNotes = `Variance: ${diff.toFixed(2)} (via mini form)`;
      }
    }
  } else if (vi.poId) {
    matchStatus = "partial";
    matchNotes = "No GR linked (via mini form)";
  }

  const companyId = vi.companyId;
  if (!Number.isInteger(companyId) || companyId <= 0) {
    logger.error(
      { viId: vi.id, companyId },
      "postVendorInvoiceAccounting: company context missing — refusing to post",
    );
    return;
  }

  // 5. Post journal: Dr GR/IR (atau Beban Pembelian) / Cr AP
  try {
    const settings = await ensureAccountingSettings(companyId);
    const grandTotal = Number(vi.grandTotal ?? 0);
    const taxAmount = Number(vi.taxAmount ?? 0);
    const netAmount = grandTotal - taxAmount;
    const lines: Array<{ accountId: number; debit: number; credit: number; description: string }> = [];

    const debitAccId = (vi.grId && settings.grirAccountId)
      ? settings.grirAccountId
      : settings.purchaseExpenseAccountId;
    const debitDesc = (vi.grId && settings.grirAccountId)
      ? `GR/IR clearing ${vi.invoiceNumber}`
      : "Beban pembelian (mini form)";

    if (debitAccId) lines.push({ accountId: debitAccId, debit: netAmount, credit: 0, description: debitDesc });
    if (taxAmount > 0 && settings.ppnInputAccountId) {
      lines.push({ accountId: settings.ppnInputAccountId!, debit: taxAmount, credit: 0, description: "PPN Masukan" });
    }
    if (settings.apAccountId) {
      lines.push({ accountId: settings.apAccountId!, debit: 0, credit: grandTotal, description: `AP vendor invoice ${vi.invoiceNumber}` });
    }

    let journalEntryId: number | null = null;
    if (lines.length >= 2) {
      const entry = await postEntry(
        {
          journalId: settings.purchaseJournalId!,
          date: new Date(),
          ref: vi.invoiceNumber,
          description: `Vendor Invoice ${vi.invoiceNumber} (mini form)`,
          source: "purchase_bill",
          sourceId: vi.id,
          companyId,
          lines,
        },
        "PUR",
      );
      journalEntryId = entry.id;
    }

    await db
      .update(vendorInvoicesTable)
      .set({
        status: "posted",
        threeWayMatchStatus: matchStatus,
        matchNotes,
        ...(journalEntryId ? { journalEntryId } : {}),
        updatedAt: new Date(),
      })
      .where(eq(vendorInvoicesTable.id, vi.id));

    logger.info(
      { viId: vi.id, matchStatus, journalEntryId, grandTotal },
      "autoPostVendorInvoice: berhasil diposting ke accounting",
    );
  } catch (e) {
    // Tetap mark posted meski journal gagal — tidak blokir vendor
    logger.error({ e, viId: vi.id }, "autoPostVendorInvoice: journal entry gagal — mark posted tanpa entry");
    await db
      .update(vendorInvoicesTable)
      .set({ status: "posted", threeWayMatchStatus: matchStatus, matchNotes, updatedAt: new Date() })
      .where(eq(vendorInvoicesTable.id, vi.id));
  }
}

// ─── Admin: POST /api/purchase-mini/create ───────────────────────────────────
// Buat link form baru (purchase_request | vendor_invoice | goods_receipt)
purchaseMiniAdminRouter.post("/create", async (req: Request, res: Response) => {
  if (!(await requireClerkUser(req, res))) return;
  await ensureTable();

  const {
    formType,
    refNumber,
    title,
    notes,
    targetName,
    currency = "IDR",
    payload = {},
    orderId,
    purchaseDocId,
    expiresInDays = 30,
  } = req.body as {
    formType: string;
    refNumber?: string;
    title?: string;
    notes?: string;
    targetName?: string;
    currency?: string;
    payload?: Record<string, unknown>;
    orderId?: number;
    purchaseDocId?: number;
    expiresInDays?: number;
  };

  const validTypes = ["purchase_request", "vendor_invoice", "goods_receipt"];
  if (!formType || !validTypes.includes(formType)) {
    return res.status(400).json({ error: `formType harus salah satu dari: ${validTypes.join(", ")}` });
  }

  try {
    const token = randomBytes(24).toString("hex");
    const expiresAt = new Date(Date.now() + expiresInDays * 86_400_000);

    const [inserted] = await db
      .insert(purchaseMiniFormsTable)
      .values({
        token,
        formType,
        refNumber: refNumber ?? null,
        title: title ?? null,
        notes: notes ?? null,
        targetName: targetName ?? null,
        currency,
        payload,
        status: "pending",
        orderId: orderId ?? null,
        purchaseDocId: purchaseDocId ?? null,
        expiresAt,
        createdBy: (req as any).user?.email ?? null,
      })
      .returning();

    const pathMap: Record<string, string> = {
      purchase_request: "purchase-request",
      vendor_invoice: "vendor-invoice",
      goods_receipt: "goods-receipt",
    };
    const formUrl = `/${pathMap[formType]}/${token}`;

    return res.json({ ok: true, token, formUrl, link: inserted });
  } catch (err) {
    logger.error({ err }, "purchaseMiniForm create error");
    return res.status(500).json({ error: "Gagal membuat link form" });
  }
});

// ─── Admin: GET /api/purchase-mini/list ──────────────────────────────────────
purchaseMiniAdminRouter.get("/list", async (req: Request, res: Response) => {
  if (!(await requireClerkUser(req, res))) return;
  await ensureTable();
  try {
    const { formType, status } = req.query as { formType?: string; status?: string };
    let query = db.select().from(purchaseMiniFormsTable).$dynamic();
    if (formType) query = query.where(eq(purchaseMiniFormsTable.formType, formType));
    if (status)   query = query.where(eq(purchaseMiniFormsTable.status, status));
    const rows = await query.orderBy(sql`${purchaseMiniFormsTable.createdAt} DESC`).limit(200);
    return res.json(rows);
  } catch (err) {
    logger.error({ err }, "purchaseMiniForm list error");
    return res.status(500).json({ error: "Gagal memuat data" });
  }
});

// ─── Admin: GET /api/purchase-mini/submissions/:id ───────────────────────────
purchaseMiniAdminRouter.get("/submissions/:id", async (req: Request, res: Response) => {
  if (!(await requireClerkUser(req, res))) return;
  await ensureTable();
  try {
    const id = Number(String(req.params.id));
    if (isNaN(id)) return res.status(400).json({ error: "ID tidak valid" });
    const [row] = await db
      .select()
      .from(purchaseMiniFormsTable)
      .where(eq(purchaseMiniFormsTable.id, id))
      .limit(1);
    if (!row) return res.status(404).json({ error: "Form tidak ditemukan" });
    return res.json(row);
  } catch (err) {
    logger.error({ err }, "purchaseMiniForm get submission error");
    return res.status(500).json({ error: "Gagal memuat data" });
  }
});

// ─── Public: GET /api/purchase-mini/:token ───────────────────────────────────
purchaseMiniPublicRouter.get("/:token", async (req: Request, res: Response) => {
  const { token } = req.params as { token: string };
  await ensureTable();

  try {
    const [row] = await db
      .select()
      .from(purchaseMiniFormsTable)
      .where(eq(purchaseMiniFormsTable.token, token))
      .limit(1);

    if (!row) return res.status(404).json({ error: "Link tidak ditemukan atau sudah tidak berlaku" });
    if (row.expiresAt && row.expiresAt < new Date()) {
      return res.status(410).json({ error: "Link ini sudah kedaluwarsa" });
    }

    return res.json({
      token: row.token,
      formType: row.formType,
      refNumber: row.refNumber,
      title: row.title,
      notes: row.notes,
      targetName: row.targetName,
      status: row.status,
      currency: row.currency,
      payload: row.payload ?? {},
    });
  } catch (err) {
    logger.error({ err }, "purchaseMiniForm GET error");
    return res.status(500).json({ error: "Gagal memuat data" });
  }
});

// ─── Public: POST /api/purchase-mini/:token ──────────────────────────────────
purchaseMiniPublicRouter.post("/:token", async (req: Request, res: Response) => {
  const { token } = req.params as { token: string };
  await ensureTable();

  try {
    const [row] = await db
      .select()
      .from(purchaseMiniFormsTable)
      .where(eq(purchaseMiniFormsTable.token, token))
      .limit(1);

    if (!row) return res.status(404).json({ error: "Link tidak ditemukan" });
    if (row.expiresAt && row.expiresAt < new Date()) {
      return res.status(410).json({ error: "Link ini sudah kedaluwarsa" });
    }
    if (row.status === "submitted") {
      return res.status(409).json({ error: "Form ini sudah pernah disubmit", alreadySubmitted: true });
    }

    const body = req.body as Record<string, unknown>;

    // Validasi per formType
    if (row.formType === "purchase_request") {
      if (!body.requesterName || typeof body.requesterName !== "string" || !body.requesterName.trim()) {
        return res.status(400).json({ error: "Nama pengaju wajib diisi" });
      }
      const items = body.items as unknown[];
      if (!Array.isArray(items) || items.length === 0) {
        return res.status(400).json({ error: "Minimal 1 item wajib diisi" });
      }
    }

    if (row.formType === "vendor_invoice") {
      if (!body.vendorInvoiceRef || typeof body.vendorInvoiceRef !== "string" || !body.vendorInvoiceRef.trim()) {
        return res.status(400).json({ error: "Nomor invoice wajib diisi" });
      }
      if (!body.invoiceAmount || Number(body.invoiceAmount) <= 0) {
        return res.status(400).json({ error: "Jumlah invoice wajib diisi" });
      }
      if (!body.bankAccount || typeof body.bankAccount !== "string" || !body.bankAccount.trim()) {
        return res.status(400).json({ error: "Nomor rekening wajib diisi" });
      }
    }

    if (row.formType === "goods_receipt") {
      if (!body.receiverName || typeof body.receiverName !== "string" || !body.receiverName.trim()) {
        return res.status(400).json({ error: "Nama penerima wajib diisi" });
      }
    }

    // Simpan submission
    await db
      .update(purchaseMiniFormsTable)
      .set({
        submissionData: body,
        status: "submitted",
        submittedAt: new Date(),
      })
      .where(eq(purchaseMiniFormsTable.token, token));


    // ── Vendor Invoice → Auto-Post ke Accounting ────────────────────────────
    // Dr GR/IR → Cr AP — idempotent: hanya jika VI masih berstatus draft.
    if (row.formType === "vendor_invoice" && row.purchaseDocId) {
      try {
        await postVendorInvoiceAccounting(row.purchaseDocId, body);
      } catch (err) {
        logger.error({ err, purchaseDocId: row.purchaseDocId }, "purchaseMiniForm: vendor_invoice auto-post error");
        // Jangan gagalkan response — form tetap dianggap berhasil submit
      }
    }

    return res.json({ success: true, formType: row.formType, refNumber: row.refNumber });
  } catch (err) {
    logger.error({ err }, "purchaseMiniForm POST error");
    return res.status(500).json({ error: "Gagal menyimpan data" });
  }
});
