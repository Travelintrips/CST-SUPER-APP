/**
 * Bank Receipts — uang masuk ke rekening bank/kas perusahaan.
 *
 * Kebalikan Bank Disbursement:
 *   DR [Bank/Kas]         total   ← rekening bank yang dipilih
 *   CR [akun per item]    xxx     ← piutang, pendapatan, ekuitas, hutang, dll.
 *
 * Jenis penerimaan:
 *   customer_payment  → Pelunasan piutang pelanggan  (CR Piutang Usaha)
 *   kasbon_return     → Pengembalian kasbon karyawan  (CR Piutang Karyawan)
 *   other_income      → Pendapatan lain-lain          (CR Akun Pendapatan)
 *   equity_injection  → Setoran modal pemilik          (CR Ekuitas)
 *   loan_receipt      → Penerimaan pinjaman            (CR Hutang)
 *   other             → Lainnya                        (CR akun bebas)
 */

import { Router } from "express";
import { db } from "@workspace/db";
import { sql, eq, desc } from "drizzle-orm";
import { logger } from "../lib/logger.js";
import { postEntry } from "../lib/accounting.js";
import { resolveCompanyId } from "../lib/resolveCompany.js";
import { assertCompanyAccess } from "../lib/assertCompanyAccess.js";
import {
  accountingJournalsTable,
  chartOfAccountsTable,
} from "@workspace/db";
import { applyArPayment } from "../lib/arApEngine.js";

const router = Router();

// Migration dijalankan di index.ts main migration chain (runBankReceiptMigration).

// ── Helpers ───────────────────────────────────────────────────────────────────

const round2 = (n: number) => Math.round(n * 100) / 100;

function execRows<T>(result: unknown): T[] {
  if (Array.isArray(result)) return result as T[];
  return (((result as Record<string, unknown>)?.rows) ?? []) as T[];
}

type ReceiptRow = {
  id: number;
  company_id: number | null;
  receipt_number: string | null;
  journal_id: number;
  date: string;
  ref: string | null;
  memo: string | null;
  total_amount: string;
  status: string;
  entry_id: number | null;
  void_entry_id: number | null;
  void_reason: string | null;
  created_by_id: string | null;
  created_at: Date;
  // Phase 3 additions
  counterparty_name: string | null;
  counterparty_type: string | null;
  counterparty_id: number | null;
};

type ItemRow = {
  id: number;
  receipt_id: number;
  seq: number;
  receipt_type: string;
  account_id: number | null;
  description: string | null;
  amount: string;
  notes: string | null;
  // Phase 3 additions
  party_name: string | null;
};

function serializeReceipt(r: ReceiptRow, items?: ItemRow[]) {
  return {
    id: r.id,
    companyId: r.company_id,
    receiptNumber: r.receipt_number,
    journalId: r.journal_id,
    date: r.date,
    ref: r.ref,
    memo: r.memo,
    totalAmount: Number(r.total_amount),
    status: r.status,
    entryId: r.entry_id,
    voidEntryId: r.void_entry_id,
    voidReason: r.void_reason,
    createdAt: r.created_at,
    counterpartyName: r.counterparty_name ?? null,
    counterpartyType: r.counterparty_type ?? null,
    counterpartyId: r.counterparty_id ?? null,
    items: items?.map((it) => ({
      id: it.id,
      seq: it.seq,
      receiptType: it.receipt_type,
      accountId: it.account_id,
      description: it.description,
      amount: Number(it.amount),
      notes: it.notes,
      partyName: it.party_name ?? null,
    })),
  };
}

// ── GET / — list receipts ─────────────────────────────────────────────────────
router.get("/", async (req, res) => {
  const companyId = resolveCompanyId(req);
  const limit = Math.min(Number(req.query.limit ?? 100), 500);

  try {
    const rows = execRows<ReceiptRow>(
      await db.execute<ReceiptRow>(sql`
        SELECT * FROM bank_receipts
        WHERE company_id = ${companyId}
        ORDER BY date DESC, id DESC
        LIMIT ${limit}
      `),
    );
    return res.json(rows.map((r) => serializeReceipt(r)));
  } catch (err) {
    logger.error({ err }, "[bankReceipts] GET / error");
    return res.status(500).json({ message: "Gagal memuat data" });
  }
});

// ── GET /summary — stats ──────────────────────────────────────────────────────
router.get("/summary", async (req, res) => {
  const companyId = resolveCompanyId(req);
  try {
    const [today] = execRows<{ total: string }>(
      await db.execute(sql`
        SELECT COALESCE(SUM(total_amount),0)::text AS total
        FROM bank_receipts
        WHERE company_id = ${companyId} AND status='posted'
          AND date = CURRENT_DATE
      `),
    ) as [{ total: string }];
    const [week] = execRows<{ total: string }>(
      await db.execute(sql`
        SELECT COALESCE(SUM(total_amount),0)::text AS total
        FROM bank_receipts
        WHERE company_id = ${companyId} AND status='posted'
          AND date >= date_trunc('week', CURRENT_DATE)
      `),
    ) as [{ total: string }];
    const [month] = execRows<{ total: string }>(
      await db.execute(sql`
        SELECT COALESCE(SUM(total_amount),0)::text AS total
        FROM bank_receipts
        WHERE company_id = ${companyId} AND status='posted'
          AND date >= date_trunc('month', CURRENT_DATE)
      `),
    ) as [{ total: string }];
    return res.json({
      receiptToday: Number(today?.total ?? 0),
      receiptWeek:  Number(week?.total  ?? 0),
      receiptMonth: Number(month?.total  ?? 0),
    });
  } catch (err) {
    logger.error({ err }, "[bankReceipts] GET /summary error");
    return res.json({ receiptToday: 0, receiptWeek: 0, receiptMonth: 0 });
  }
});

// ── GET /meta/accounts — eligible CR accounts ─────────────────────────────────
router.get("/meta/accounts", async (req, res) => {
  const companyId = resolveCompanyId(req);
  const forType  = req.query.for  as string | undefined;
  const typeQ    = req.query.type as string | undefined;

  try {
    const all = await db
      .select({
        id:      chartOfAccountsTable.id,
        code:    chartOfAccountsTable.code,
        name:    chartOfAccountsTable.name,
        type:    chartOfAccountsTable.type,
        subtype: chartOfAccountsTable.subtype,
      })
      .from(chartOfAccountsTable)
      .where(
        sql`(company_id = ${companyId} OR company_id IS NULL)
            AND is_active = true`,
      )
      .orderBy(chartOfAccountsTable.code);

    let filtered = all;

    if (forType === "customer_payment") {
      // Piutang usaha (asset) atau revenue
      filtered = all.filter(
        (a) => a.type === "asset" || a.type === "revenue",
      );
    } else if (forType === "kasbon_return") {
      // Piutang karyawan (asset receivable)
      filtered = all.filter((a) => a.type === "asset");
    } else if (forType === "other_income") {
      filtered = all.filter((a) => a.type === "revenue");
    } else if (forType === "equity_injection") {
      filtered = all.filter((a) => a.type === "equity");
    } else if (forType === "loan_receipt") {
      filtered = all.filter((a) => a.type === "liability");
    } else if (typeQ) {
      filtered = all.filter((a) => a.type === typeQ);
    }

    return res.json(
      filtered.map((a) => ({
        id:      a.id,
        code:    a.code,
        name:    a.name,
        type:    a.type,
        subtype: a.subtype,
      })),
    );
  } catch (err) {
    logger.error({ err }, "[bankReceipts] GET /meta/accounts error");
    return res.status(500).json({ message: "Gagal memuat akun" });
  }
});

// ── GET /meta/ar-outstanding — piutang belum lunas ────────────────────────────
router.get("/meta/ar-outstanding", async (req, res) => {
  const companyId = resolveCompanyId(req);
  try {
    type ArRow = {
      id: number; invoice_id: number | null; gross_amount: string;
      outstanding_amount: string; paid_amount: string; status: string;
      due_date: string | null; notes: string | null;
      invoice_number: string | null; customer_name: string | null;
    };
    const rows = execRows<ArRow>(await db.execute<ArRow>(sql`
      SELECT
        ar.id,
        ar.invoice_id,
        ar.gross_amount::text,
        ar.outstanding_amount::text,
        ar.paid_amount::text,
        ar.status,
        ar.due_date::text,
        ar.notes,
        COALESCE(sd.invoice_number, ar.notes) AS invoice_number,
        COALESCE(sd.customer_name, '') AS customer_name
      FROM ar_subledger ar
      LEFT JOIN sales_documents sd ON sd.id = ar.invoice_id
      WHERE ar.company_id = ${companyId}
        AND ar.status IN ('OPEN', 'PARTIAL', 'OVERDUE')
        AND ar.outstanding_amount > 0
      ORDER BY ar.due_date ASC NULLS LAST, ar.id DESC
      LIMIT 200
    `));
    return res.json(rows.map((r) => ({
      id:              r.id,
      invoiceId:       r.invoice_id,
      invoiceNumber:   r.invoice_number ?? `AR-${r.id}`,
      customerName:    r.customer_name ?? "",
      grossAmount:     Number(r.gross_amount),
      outstandingAmount: Number(r.outstanding_amount),
      paidAmount:      Number(r.paid_amount),
      status:          r.status,
      dueDate:         r.due_date,
    })));
  } catch (err) {
    logger.error({ err }, "[bankReceipts] GET /meta/ar-outstanding error");
    return res.status(500).json({ message: "Gagal memuat piutang outstanding" });
  }
});

// ── GET /meta/kasbon-employees — karyawan dengan kasbon outstanding ────────────
router.get("/meta/kasbon-employees", async (req, res) => {
  const companyId = resolveCompanyId(req);
  try {
    type Row = {
      party_name: string;
      receivable_account_id: number | null;
      outstanding: string;
      account_name: string | null;
      account_code: string | null;
    };
    const rows = execRows<Row>(await db.execute<Row>(sql`
      WITH emp_totals AS (
        SELECT party_name, SUM(remaining_amount)::text AS outstanding
        FROM cash_advances
        WHERE company_id = ${companyId} AND remaining_amount > 0
        GROUP BY party_name
      ),
      emp_accounts AS (
        SELECT DISTINCT ON (party_name) party_name, receivable_account_id
        FROM cash_advances
        WHERE company_id = ${companyId} AND remaining_amount > 0
        ORDER BY party_name, remaining_amount DESC
      )
      SELECT et.party_name, ea.receivable_account_id, et.outstanding,
             coa.name AS account_name, coa.code AS account_code
      FROM emp_totals et
      JOIN emp_accounts ea ON ea.party_name = et.party_name
      LEFT JOIN chart_of_accounts coa ON coa.id = ea.receivable_account_id
      ORDER BY et.party_name
    `));
    return res.json(rows.map((r) => ({
      name:             r.party_name,
      accountId:        r.receivable_account_id,
      accountName:      r.account_name,
      accountCode:      r.account_code,
      outstandingBalance: Number(r.outstanding),
    })));
  } catch (err) {
    logger.error({ err }, "[bankReceipts] GET /meta/kasbon-employees error");
    return res.status(500).json({ message: "Gagal memuat data karyawan kasbon" });
  }
});

// ── GET /meta/ar-customers — pelanggan dengan AR outstanding (grouped) ─────────
router.get("/meta/ar-customers", async (req, res) => {
  const companyId = resolveCompanyId(req);
  try {
    type ArRow = {
      id: number; invoice_id: number | null;
      gross_amount: string; outstanding_amount: string; paid_amount: string;
      status: string; due_date: string | null;
      invoice_number: string | null; customer_name: string | null;
    };
    const rows = execRows<ArRow>(await db.execute<ArRow>(sql`
      SELECT ar.id, ar.invoice_id,
             ar.gross_amount::text, ar.outstanding_amount::text, ar.paid_amount::text,
             ar.status, ar.due_date::text,
             COALESCE(sd.invoice_number, ar.notes) AS invoice_number,
             COALESCE(sd.customer_name, ar.notes, 'Tanpa Nama') AS customer_name
      FROM ar_subledger ar
      LEFT JOIN sales_documents sd ON sd.id = ar.invoice_id
      WHERE ar.company_id = ${companyId}
        AND ar.status IN ('OPEN', 'PARTIAL', 'OVERDUE')
        AND ar.outstanding_amount > 0
      ORDER BY customer_name, ar.due_date ASC NULLS LAST, ar.id DESC
    `));

    const grouped = new Map<string, { customerName: string; totalOutstanding: number; invoices: object[] }>();
    for (const r of rows) {
      const name = r.customer_name ?? "Tanpa Nama";
      if (!grouped.has(name)) grouped.set(name, { customerName: name, totalOutstanding: 0, invoices: [] });
      const g = grouped.get(name)!;
      g.totalOutstanding += Number(r.outstanding_amount);
      g.invoices.push({
        id:                r.id,
        invoiceId:         r.invoice_id,
        invoiceNumber:     r.invoice_number ?? `AR-${r.id}`,
        grossAmount:       Number(r.gross_amount),
        outstandingAmount: Number(r.outstanding_amount),
        paidAmount:        Number(r.paid_amount),
        status:            r.status,
        dueDate:           r.due_date,
      });
    }
    return res.json(Array.from(grouped.values()));
  } catch (err) {
    logger.error({ err }, "[bankReceipts] GET /meta/ar-customers error");
    return res.status(500).json({ message: "Gagal memuat data pelanggan AR" });
  }
});

// ── GET /:id — detail ─────────────────────────────────────────────────────────
router.get("/:id", async (req, res) => {
  const id = Number(req.params.id);
  if (!id) return res.status(400).json({ message: "ID tidak valid" });

  try {
    const rows  = execRows<ReceiptRow>(await db.execute<ReceiptRow>(sql`SELECT * FROM bank_receipts WHERE id = ${id}`));

    if (!rows[0]) return res.status(404).json({ message: "Receipt tidak ditemukan" });

    // ── IDOR guard: pastikan receipt milik perusahaan yang sama ──────────────
    const cid = resolveCompanyId(req);
    if (!await assertCompanyAccess(rows[0].company_id ?? null, cid, req, res, { resourceType: "bank_receipt", resourceId: id })) return;

    const items = execRows<ItemRow>(await db.execute<ItemRow>(sql`SELECT * FROM bank_receipt_items WHERE receipt_id = ${id} ORDER BY seq`));
    const entryRows = execRows<{ id: number; description: string | null; date: string }>(
      await db.execute(sql`SELECT id, description, date FROM accounting_entries WHERE id = (SELECT entry_id FROM bank_receipts WHERE id = ${id})`),
    );

    return res.json({
      ...serializeReceipt(rows[0], items),
      entry: entryRows[0] ?? null,
    });
  } catch (err) {
    logger.error({ err }, "[bankReceipts] GET /:id error");
    return res.status(500).json({ message: "Gagal memuat detail" });
  }
});

// ── POST / — create receipt ───────────────────────────────────────────────────
router.post("/", async (req, res) => {
  const companyId = resolveCompanyId(req);
  const { journalId, date, ref, memo, items, counterpartyName, counterpartyType, counterpartyId } = req.body ?? {};

  if (!journalId || !date) {
    return res.status(400).json({ message: "journalId dan date wajib diisi" });
  }
  if (!Array.isArray(items) || items.length === 0) {
    return res.status(400).json({ message: "Minimal satu item diperlukan" });
  }

  try {
    // ── Load journal ───────────────────────────────────────────────────────
    const [journal] = await db
      .select()
      .from(accountingJournalsTable)
      .where(eq(accountingJournalsTable.id, Number(journalId)));

    if (!journal) return res.status(404).json({ message: "Jurnal tidak ditemukan" });
    if (journal.type !== "bank" && journal.type !== "cash") {
      return res.status(400).json({ message: "Jurnal harus bertipe bank atau cash" });
    }

    // ── Resolve bank/cash account (DR side for receipt) ────────────────────
    const bankAccountId = journal.defaultDebitAccountId ?? journal.defaultCreditAccountId;
    if (!bankAccountId) {
      return res.status(400).json({
        message: "Jurnal tidak memiliki default akun bank/kas. Set di Accounting > Journals.",
      });
    }

    // ── Validate items ─────────────────────────────────────────────────────
    const validTypes = ["customer_payment", "kasbon_return", "other_income", "equity_injection", "loan_receipt", "other"];
    const processedItems: Array<{
      seq: number; receipt_type: string; account_id: number;
      description: string | null; amount: number; notes: string | null;
      ar_invoice_id: number | null;
      party_name: string | null;
    }> = [];

    for (let i = 0; i < items.length; i++) {
      const it = items[i] as Record<string, unknown>;
      const receiptType = String(it.receiptType ?? it.receipt_type ?? "other");
      if (!validTypes.includes(receiptType)) {
        return res.status(400).json({ message: `Item ${i + 1}: jenis penerimaan tidak valid` });
      }
      const acctId = Number(it.accountId ?? it.account_id);
      if (!acctId) return res.status(400).json({ message: `Item ${i + 1}: akun wajib dipilih` });
      const amount = round2(Number(it.amount));
      if (!amount || amount <= 0) return res.status(400).json({ message: `Item ${i + 1}: jumlah harus lebih dari 0` });

      const [acct] = await db.select().from(chartOfAccountsTable).where(eq(chartOfAccountsTable.id, acctId));
      if (!acct) return res.status(400).json({ message: `Item ${i + 1}: akun tidak ditemukan` });
      if ((acct.type as string) === "bank" || (acct.type === "asset" && acct.subtype === "cash_bank")) {
        return res.status(400).json({ message: `Item ${i + 1}: akun Bank/Kas tidak boleh dipakai sebagai kredit penerimaan` });
      }

      const arInvoiceId = it.arInvoiceId != null ? Number(it.arInvoiceId) : null;

      processedItems.push({
        seq:           i + 1,
        receipt_type:  receiptType,
        account_id:    acctId,
        description:   it.description ? String(it.description) : null,
        amount,
        notes:         it.notes ? String(it.notes) : null,
        ar_invoice_id: arInvoiceId || null,
        party_name:    it.partyName ? String(it.partyName) : null,
      });
    }

    const totalAmount = round2(processedItems.reduce((s, it) => s + it.amount, 0));

    // ── Build journal lines (DR Bank, CR items) ────────────────────────────
    const dateStr = typeof date === "string" ? date : new Date(date as string | number).toISOString().slice(0, 10);

    // ── Receipt number ─────────────────────────────────────────────────────
    const cntRows = execRows<{ cnt: number }>(await db.execute<{ cnt: number }>(sql`
      SELECT COUNT(*)::int AS cnt FROM bank_receipts WHERE company_id = ${companyId}
    `));
    const cnt      = Number(cntRows[0]?.cnt ?? 0);
    const year     = new Date().getFullYear();
    const seq      = (cnt + 1).toString().padStart(4, "0");
    const rcptNum  = `BR/${year}/${seq}`;

    const journalLines: Array<{ accountId: number; debit: number; credit: number; description: string }> = [];
    journalLines.push({ accountId: bankAccountId, debit: totalAmount, credit: 0, description: `Bank Receipt${ref ? ` - ${ref}` : ""} ${rcptNum}` });
    for (const it of processedItems) {
      journalLines.push({ accountId: it.account_id, debit: 0, credit: it.amount, description: it.description ?? "Penerimaan" });
    }

    const entry = await postEntry(
      {
        journalId:   journal.id,
        date:        dateStr as any,
        ref:         ref ?? null,
        description: memo ?? `Bank Receipt ${rcptNum}`,
        source:      "manual_receipt" as any,
        companyId,
        lines:       journalLines,
      },
      journal.code,
    );

    // Phase 3: counterparty identity dari body
    const cpNameVal = counterpartyName ? String(counterpartyName) : null;
    const cpTypeVal = counterpartyType ? String(counterpartyType) : null;
    const cpIdVal   = counterpartyId   ? Number(counterpartyId)   : null;

    const insertedRows = execRows<{ id: number }>(await db.execute<{ id: number }>(sql`
      INSERT INTO bank_receipts
        (company_id, receipt_number, journal_id, date, ref, memo, total_amount, status, entry_id, created_by_id,
         counterparty_name, counterparty_type, counterparty_id)
      VALUES
        (${companyId}, ${rcptNum}, ${journal.id}, ${dateStr}, ${ref ?? null}, ${memo ?? null},
         ${String(totalAmount)}, 'posted', ${entry.id}, ${(req as any).user?.id ?? null},
         ${cpNameVal}, ${cpTypeVal}, ${cpIdVal})
      RETURNING id
    `));

    const receiptId = insertedRows[0]!.id;

    for (const it of processedItems) {
      await db.execute(sql`
        INSERT INTO bank_receipt_items (receipt_id, seq, receipt_type, account_id, description, amount, notes, ar_invoice_id, party_name)
        VALUES (${receiptId}, ${it.seq}, ${it.receipt_type}, ${it.account_id},
                ${it.description}, ${String(it.amount)}, ${it.notes}, ${it.ar_invoice_id ?? null},
                ${it.party_name ?? null})
      `);
    }

    // ── Apply AR payments (pelunasan piutang otomatis) ─────────────────────
    const arResults: Array<{ arId: number; newOutstanding: number; newStatus: string }> = [];
    for (const it of processedItems) {
      if (it.ar_invoice_id && it.receipt_type === "customer_payment") {
        try {
          const result = await applyArPayment({
            companyId,
            arId:       it.ar_invoice_id,
            paidAmount: it.amount,
            actor:      (req as any).user?.id ?? "bank_receipt",
          });
          arResults.push({ arId: it.ar_invoice_id, ...result });
          logger.info({ arId: it.ar_invoice_id, paidAmount: it.amount, ...result }, "[bankReceipts] AR payment applied");
        } catch (arErr) {
          logger.warn({ arErr, arId: it.ar_invoice_id }, "[bankReceipts] applyArPayment failed (non-fatal)");
        }
      }
    }

    const createdRows  = execRows<ReceiptRow>(await db.execute<ReceiptRow>(sql`SELECT * FROM bank_receipts WHERE id = ${receiptId}`));
    const createdItems = execRows<ItemRow>(await db.execute<ItemRow>(sql`SELECT * FROM bank_receipt_items WHERE receipt_id = ${receiptId} ORDER BY seq`));

    logger.info({ receiptId, rcptNum, companyId, totalAmount }, "[bankReceipts] Created");
    return res.status(201).json({
      ...serializeReceipt(createdRows[0]!, createdItems),
      _ar: arResults,
    });
  } catch (err) {
    logger.error({ err }, "[bankReceipts] POST / error");
    return res.status(500).json({ message: err instanceof Error ? err.message : "Gagal membuat bank receipt" });
  }
});

// ── POST /:id/void — void receipt ──────────────────────────────────────────────
router.post("/:id/void", async (req, res) => {
  const id         = Number(req.params.id);
  const voidReason = String(req.body?.reason ?? "Dibatalkan");
  if (!id) return res.status(400).json({ message: "ID tidak valid" });

  try {
    const rows = execRows<ReceiptRow>(await db.execute<ReceiptRow>(sql`SELECT * FROM bank_receipts WHERE id = ${id}`));
    const receipt = rows[0];
    if (!receipt) return res.status(404).json({ message: "Receipt tidak ditemukan" });
    if (receipt.status === "void") return res.status(400).json({ message: "Receipt sudah di-void" });

    // ── IDOR guard ────────────────────────────────────────────────────────────
    const cid = resolveCompanyId(req);
    if (!await assertCompanyAccess(receipt.company_id ?? null, cid, req, res, { resourceType: "bank_receipt", resourceId: id })) return;

    const companyId = receipt.company_id ?? cid;
    const [journal]  = await db.select().from(accountingJournalsTable).where(eq(accountingJournalsTable.id, receipt.journal_id));
    if (!journal) return res.status(404).json({ message: "Jurnal tidak ditemukan" });

    const items = execRows<ItemRow>(await db.execute<ItemRow>(sql`SELECT * FROM bank_receipt_items WHERE receipt_id = ${id} ORDER BY seq`));
    const bankAccountId = journal.defaultDebitAccountId ?? journal.defaultCreditAccountId;

    const voidLines: Array<{ accountId: number; debit: number; credit: number; description: string }> = [];
    const totalAmount = Number(receipt.total_amount);
    voidLines.push({ accountId: bankAccountId!, debit: 0, credit: totalAmount, description: `VOID ${receipt.receipt_number}` });
    for (const it of items) {
      voidLines.push({ accountId: it.account_id!, debit: Number(it.amount), credit: 0, description: `VOID — ${it.description ?? "Penerimaan"}` });
    }

    const voidEntry = await postEntry(
      {
        journalId:   journal.id,
        date:        new Date().toISOString().slice(0, 10) as any,
        ref:         `VOID-${receipt.receipt_number ?? receipt.id}`,
        description: `Pembatalan Receipt ${receipt.receipt_number ?? receipt.id}: ${voidReason}`,
        source:      "manual_receipt" as any,
        companyId,
        lines:       voidLines,
      },
      journal.code,
    );

    await db.execute(sql`
      UPDATE bank_receipts
      SET status = 'void', void_entry_id = ${voidEntry.id}, void_reason = ${voidReason}
      WHERE id = ${id}
    `);

    logger.info({ id, voidReason, voidEntryId: voidEntry.id }, "[bankReceipts] Voided");
    return res.json({ ok: true, voidEntryId: voidEntry.id });
  } catch (err) {
    logger.error({ err }, "[bankReceipts] POST /:id/void error");
    return res.status(500).json({ message: "Gagal void receipt" });
  }
});

export default router;
