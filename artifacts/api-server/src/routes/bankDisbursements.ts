/**
 * Bank Disbursements — uang keluar dari rekening bank perusahaan.
 *
 * Setiap disbursement terdiri dari:
 *   - Header   : tanggal, jurnal bank, referensi, memo
 *   - Line items: banyak baris, masing-masing punya jenis transaksi + akun + jumlah
 *
 * Jurnal otomatis yang dihasilkan (compound entry):
 *
 * Tanpa WHT:
 *   DR [akun per item]  xxx   (bisa beban, hutang, piutang karyawan, bank tujuan, dll.)
 *   ...
 *   CR [Bank]           total
 *
 * Dengan WHT (supplier_payment saja):
 *   DR [Hutang Supplier]  gross_amount
 *   ...
 *   CR [Hutang Pajak/WHT] wht_amount          ← satu baris per item yang punya WHT
 *   CR [Bank]             total - sum(wht)    ← net bank credit
 *
 * Jenis transaksi yang didukung dan aturan akun yang boleh dipakai:
 *   expense          → akun tipe "expense" saja               → masuk P&L
 *   supplier_payment → akun tipe "liability", "expense", atau "asset"
 *                      (DR Hutang Usaha jika melunasi hutang → tidak masuk P&L;
 *                       DR Beban jika bayar langsung → masuk P&L)
 *   tax_payment      → akun tipe "expense" atau "liability"
 *                      (DR Beban Pajak → masuk P&L;
 *                       DR Hutang PPh/PPN → tidak masuk P&L)
 *   employee_advance → akun tipe "asset" saja (Piutang Karyawan / Kasbon)
 *                      → tidak masuk P&L
 *   fund_transfer    → akun tipe "asset" saja (Bank/Kas Tujuan)
 *                      → tidak masuk P&L
 *   other            → akun tipe apapun (dampak P&L sepenuhnya ikut tipe akun COA)
 *
 * ⚠️  PENTING: P&L TIDAK ditentukan oleh transaction_type, melainkan oleh tipe akun COA.
 *     Laporan Laba Rugi dibuat dari account_entry_lines JOIN chart_of_accounts WHERE type IN ('revenue','expense').
 *
 * Phase 1 additions (2026-06-28):
 *   - purchase_document_id per item → trigger recalculate payment_status PO
 *   - wht_amount + wht_account_id per item → WHT split di jurnal
 */

import { Router } from "express";
import { db } from "@workspace/db";
import { sql, eq, desc, and, inArray } from "drizzle-orm";
import { logger } from "../lib/logger.js";
import { postEntry } from "../lib/accounting.js";
import { ensureAccountingSettings } from "../lib/accountingSeed.js";
import { resolveCompanyId } from "../lib/resolveCompany.js";
import { validateBdSource, updateSourceAfterDisbursement } from "../lib/bdSourceGuard.js";
import {
  accountingJournalsTable,
  accountingEntriesTable,
  accountingEntryLinesTable,
  chartOfAccountsTable,
  suppliersTable,
  vendorInvoicesTable,
} from "@workspace/db";
import {
  recalculateBatchFromBankDisbursements,
} from "../lib/bankDisbursementRecalc.js";
import { getOpenAI } from "../lib/openaiClient.js";
import { imagePdfUpload } from "../lib/uploadMiddleware.js";
import { createRequire as _bdCreateRequire } from "node:module";
import * as _bdFs from "node:fs/promises";
import * as _bdOs from "node:os";
import * as _bdPath from "node:path";
import { execFile as _bdExecFile } from "node:child_process";
import { promisify as _bdPromisify } from "node:util";

const router = Router();

// ── Helpers ───────────────────────────────────────────────────────────────────

const round2 = (n: number) => Math.round(n * 100) / 100;

/**
 * Drizzle v0.45+ node-postgres: db.execute() returns QueryResult { rows: T[] },
 * NOT a plain array. This helper extracts the rows array safely.
 */
function execRows<T>(result: unknown): T[] {
  if (Array.isArray(result)) return result as T[];
  return (((result as Record<string, unknown>)?.rows) ?? []) as T[];
}

type DisbRow = {
  id: number;
  company_id: number | null;
  disbursement_number: string | null;
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
  // Phase 4 additions
  counterparty_name: string | null;
  counterparty_type: string | null;
  counterparty_id: number | null;
  // Phase 5 additions
  attachment_url: string | null;
  // Phase 8 — Expense bridge
  source_module: string | null;
  source_id: number | null;
  source_number: string | null;
  expense_id: number | null;
};

type ItemRow = {
  id: number;
  disbursement_id: number;
  seq: number;
  transaction_type: string;
  account_id: number | null;
  description: string | null;
  amount: string;
  notes: string | null;
  // Phase 1 additions
  purchase_document_id: number | null;
  wht_amount: string | null;
  wht_account_id: number | null;
  // Phase 4 additions
  party_name: string | null;
};

function serializeDisb(d: DisbRow, items?: ItemRow[]) {
  return {
    id: d.id,
    companyId: d.company_id,
    disbursementNumber: d.disbursement_number,
    journalId: d.journal_id,
    date: d.date,
    ref: d.ref,
    memo: d.memo,
    totalAmount: Number(d.total_amount),
    status: d.status,
    entryId: d.entry_id,
    voidEntryId: d.void_entry_id,
    voidReason: d.void_reason,
    createdAt: d.created_at,
    counterpartyName: d.counterparty_name ?? null,
    counterpartyType: d.counterparty_type ?? null,
    counterpartyId: d.counterparty_id ?? null,
    attachmentUrl: d.attachment_url ?? null,
    sourceModule: d.source_module ?? null,
    sourceId: d.source_id ?? null,
    sourceNumber: d.source_number ?? null,
    expenseId: d.expense_id ?? null,
    items: items?.map((it) => ({
      id: it.id,
      seq: it.seq,
      transactionType: it.transaction_type,
      accountId: it.account_id,
      description: it.description,
      amount: Number(it.amount),
      notes: it.notes,
      purchaseDocumentId: it.purchase_document_id ?? null,
      whtAmount: Number(it.wht_amount ?? 0),
      whtAccountId: it.wht_account_id ?? null,
      partyName: it.party_name ?? null,
    })),
  };
}

// ── Cash/Bank account detection helper ────────────────────────────────────────
// Used as fallback when subtype is NULL (accounts created before subtype column).

function isCashBankByNameCode(name: string, code: string): boolean {
  const nameLower = name.toLowerCase();
  const denyWords = ["piutang", "receivable", "persediaan", "inventory"];
  if (denyWords.some((w) => nameLower.includes(w))) return false;
  const cashWords = ["kas", "cash", "giro", "tabungan", "kliring", "petty"];
  if (cashWords.some((w) => nameLower.includes(w))) return true;
  if (/\bbank\b/i.test(name)) return true;
  // Code prefix: 1-1010~1-1019 = Kas, 1-1020~1-1029 = Bank
  if (/^1-101[0-9]/.test(code) || /^1-102[0-9]/.test(code)) return true;
  return false;
}

// ── Tax-related account helper ────────────────────────────────────────────────
//
// Digunakan untuk filter `tax_payment` di /meta/accounts DAN validasi POST.
// Akun dianggap tax-related jika nama, kode, atau subtype mengandung indikator pajak.
//
// Allowed types: liability atau expense
// AND setidaknya satu indikator pajak cocok pada name/code/subtype.
//
// Indikator pajak: tax, pajak, ppn, vat, pph, pbb, bea, fiskal, excise, withholding

const TAX_KEYWORDS = ["tax", "pajak", "ppn", "vat", "pph", "pbb", "bea", "fiskal", "excise", "withholding"];

export function isTaxRelatedAccount(
  type: string,
  subtype: string | null,
  name: string,
  code: string,
): boolean {
  if (type !== "liability" && type !== "expense") return false;
  const haystack = `${name} ${code} ${subtype ?? ""}`.toLowerCase();
  return TAX_KEYWORDS.some((kw) => haystack.includes(kw));
}

/** Human-readable reason why a tax_payment account was rejected. */
function taxPaymentDrRejectMsg(itemLabel: string, acctName: string, acctType: string): string {
  const prefix = `${itemLabel}: akun "${acctName}" tidak diizinkan untuk jenis transaksi tax_payment.`;
  if (acctType !== "liability" && acctType !== "expense") {
    return `${prefix} Hanya akun bertipe Utang (liability) atau Beban (expense) yang diizinkan.`;
  }
  return `${prefix} Akun harus berkaitan dengan pajak (Hutang Pajak, Beban Pajak, PPh, PPN, VAT, WHT, dsb.). Akun umum seperti kewajiban non-pajak atau beban operasional tidak diizinkan di sini.`;
}

// ── Supplier Payment DR account filtering ─────────────────────────────────────
//
// Untuk supplier_payment, akun Debit (DR) harus salah satu dari:
//   • liability               → Hutang Usaha / AP / Trade Payable  (kasus utama)
//   • expense                 → Beban Pembelian langsung
//   • asset / subtype=inventory  → Persediaan (pembelian stok tunai)
//   • asset / subtype=prepaid    → Uang Muka Supplier / Down Payment
//   • asset / subtype=null + nama cocok pola advance supplier
//
// DIBLOK (Bank selalu menjadi CR / sumber dana, bukan DR):
//   • asset / cash_bank   → Bank / Kas
//   • asset / receivable  → Piutang Usaha / Piutang Karyawan
//   • asset / fixed_asset → Aset Tetap
//   • asset / tax_asset   → Pajak Dibayar Dimuka / PPN Masukan
//   • asset / null (tanpa pola advance)  → Other Current Asset
//   • equity, revenue     → tidak relevan untuk pembayaran keluar
//
// Karena kolom account_category / account_group belum ada di skema saat ini,
// filtering menggunakan type + subtype + pattern matching nama/kode sebagai fallback.

/** Detect if a NULL-subtype asset account is a supplier advance / DP to vendor. */
function isSupplierAdvanceByNameCode(name: string, code: string): boolean {
  const n = name.toLowerCase();
  void code; // reserved for future code-range logic
  if (/uang\s*muka/.test(n) && /(supplier|vendor|pemasok|pembelian|purchase)/.test(n)) return true;
  if (/(dp|down\s*payment|advance)\s*(ke\s*)?(supplier|vendor|pemasok|pembelian|purchase)/.test(n)) return true;
  if (/(supplier|vendor|pemasok)\s*(advance|dp|down\s*payment|uang\s*muka)/.test(n)) return true;
  return false;
}

/**
 * Returns true if the given COA account is a valid DR account for supplier_payment.
 *
 * Allowed categories:
 *   accounts_payable | trade_payable | supplier_payable  → type=liability
 *   purchase_expense                                     → type=expense
 *   inventory                                            → type=asset, subtype=inventory
 *   purchase_advance                                     → type=asset, subtype=prepaid | name match
 */
function isAllowedForSupplierPaymentDr(
  type: string,
  subtype: string | null,
  name: string,
  code: string,
): boolean {
  if (type === "liability") return true;
  if (type === "expense")   return true;
  if (type === "asset") {
    if (subtype === "inventory") return true;
    if (subtype === "prepaid")   return true;
    if (subtype === null && isSupplierAdvanceByNameCode(name, code)) return true;
    return false; // cash_bank, receivable, fixed_asset, tax_asset, other asset → blocked
  }
  return false; // equity, revenue → blocked
}

/** Human-readable rejection reason for supplier_payment DR account validation. */
function supplierPaymentDrRejectMsg(
  itemLabel: string,
  acctName: string,
  acctType: string,
  acctSubtype: string | null,
  acctCode: string,
): string {
  const prefix = `${itemLabel}: akun "${acctName}" tidak diizinkan sebagai Debit pada supplier_payment.`;
  if (acctType === "asset") {
    if (acctSubtype === "cash_bank" || isCashBankByNameCode(acctName, acctCode)) {
      return `${prefix} Akun Kas/Bank adalah sumber dana (CR) — tidak boleh menjadi DR. Gunakan akun Hutang Usaha atau Beban.`;
    }
    if (acctSubtype === "receivable") {
      return `${prefix} Akun Piutang tidak relevan untuk pembayaran supplier.`;
    }
    if (acctSubtype === "fixed_asset") {
      return `${prefix} Akun Aset Tetap tidak sesuai di sini. Gunakan modul Aset Tetap.`;
    }
    if (acctSubtype === "tax_asset") {
      return `${prefix} Akun Pajak Dibayar Dimuka tidak sesuai untuk supplier_payment.`;
    }
    return `${prefix} Gunakan: Hutang Usaha (liability), Beban (expense), Persediaan (asset/inventory), atau Uang Muka Supplier (asset/prepaid).`;
  }
  if (acctType === "equity")  return `${prefix} Akun Ekuitas tidak sesuai untuk pembayaran keluar.`;
  if (acctType === "revenue") return `${prefix} Akun Pendapatan tidak sesuai untuk pembayaran keluar.`;
  return `${prefix} Gunakan: Hutang Usaha (liability), Beban (expense), Persediaan, atau Uang Muka Supplier.`;
}

// ── GET /meta/accounts  — list COA (MUST be before /:id to avoid param clash) ─

router.get("/meta/accounts", async (req, res) => {
  try {
    const companyId = resolveCompanyId(req);
    const typeFilter    = req.query["type"]    as string | undefined;
    const subtypeFilter = req.query["subtype"] as string | undefined;
    // `for` applies per-transaction-type DR account filtering (e.g. for=supplier_payment)
    const forTxType     = req.query["for"]     as string | undefined;

    const rawAccts = await db.execute<{
      id: number; code: string; name: string; type: string; subtype: string | null;
    }>(sql`
      SELECT id, code, name, type, subtype
      FROM chart_of_accounts
      WHERE (company_id = ${companyId} OR company_id IS NULL)
        AND is_active = true
        ${typeFilter ? sql`AND type = ${typeFilter}` : sql``}
      ORDER BY code
    `);

    let result = execRows<{ id: number; code: string; name: string; type: string; subtype: string | null }>(rawAccts);

    // subtype filter (existing — used by fund_transfer cash_bank)
    if (subtypeFilter === "cash_bank") {
      result = result.filter(
        (a) => a.subtype === "cash_bank" || (a.subtype === null && isCashBankByNameCode(a.name, a.code)),
      );
    } else if (subtypeFilter) {
      result = result.filter((a) => a.subtype === subtypeFilter);
    }

    // Per-transaction-type DR account whitelist
    if (forTxType === "supplier_payment") {
      result = result.filter((a) =>
        isAllowedForSupplierPaymentDr(a.type, a.subtype, a.name, a.code),
      );
      // Sort: liability (AP) first → expense → asset (inventory/advance)
      const typeOrder: Record<string, number> = { liability: 0, expense: 1, asset: 2 };
      result.sort((a, b) => {
        const ao = typeOrder[a.type] ?? 9;
        const bo = typeOrder[b.type] ?? 9;
        return ao !== bo ? ao - bo : a.code.localeCompare(b.code);
      });
    }

    if (forTxType === "tax_payment") {
      result = result.filter((a) => isTaxRelatedAccount(a.type, a.subtype, a.name, a.code));
      // Sort: liability (Hutang Pajak) first → expense (Beban Pajak)
      result.sort((a, b) => {
        const ao = a.type === "liability" ? 0 : 1;
        const bo = b.type === "liability" ? 0 : 1;
        return ao !== bo ? ao - bo : a.code.localeCompare(b.code);
      });
    }

    if (forTxType === "employee_advance") {
      // Hanya akun aset yang berkaitan dengan Piutang Karyawan / Kasbon / Uang Muka Karyawan
      result = result.filter((a) => {
        if (a.type !== "asset") return false;
        const nameLower = a.name.toLowerCase();
        const codeLower = a.code.toLowerCase();
        return (
          nameLower.includes("kasbon") ||
          nameLower.includes("piutang karyawan") ||
          nameLower.includes("uang muka karyawan") ||
          nameLower.includes("advance karyawan") ||
          nameLower.includes("employee advance") ||
          codeLower.includes("kasbon") ||
          a.subtype === "employee_advance"
        );
      });
    }

    if (forTxType === "loan_payment") {
      // Utang Pinjaman / Utang Bank / Utang Leasing — liability, bukan pajak/hutang usaha
      result = result.filter((a) => {
        if (a.type !== "liability") return false;
        const nameLower = a.name.toLowerCase();
        const isTaxLiab =
          nameLower.includes("pajak") || nameLower.includes("pph") ||
          nameLower.includes("ppn") || nameLower.includes("wht") ||
          nameLower.includes("tax") || a.subtype === "tax_payable";
        const isApLiab =
          nameLower.includes("hutang usaha") || nameLower.includes("account payable") ||
          nameLower.includes("hutang dagang") || a.subtype === "accounts_payable";
        return !isTaxLiab && !isApLiab;
      });
      result.sort((a, b) => a.code.localeCompare(b.code));
    }

    if (forTxType === "equity_withdrawal") {
      result = result.filter((a) => a.type === "equity");
      result.sort((a, b) => a.code.localeCompare(b.code));
    }

    return res.json(result);
  } catch (err) {
    logger.error({ err }, "GET /accounting/bank-disbursements/meta/accounts error");
    return res.status(500).json({ message: "Gagal mengambil daftar akun" });
  }
});

// ── GET /counterparty-search  — search supplier atau karyawan untuk combobox ──

router.get("/counterparty-search", async (req, res) => {
  try {
    const companyId = resolveCompanyId(req);
    const q = String(req.query["q"] ?? "").trim();
    const type = String(req.query["type"] ?? "").toLowerCase();

    if (!q) return res.json([]);

    const pattern = `%${q}%`;

    if (type === "supplier") {
      const rows = await db.execute(sql`
        SELECT id, name FROM suppliers
        WHERE (company_id = ${companyId} OR company_id IS NULL)
          AND is_active = true
          AND name ILIKE ${pattern}
        ORDER BY name LIMIT 20
      `);
      return res.json(rows.rows);
    }

    if (type === "employee") {
      const rows = await db.execute(sql.raw(`
        SELECT id::text AS id, name FROM users
        WHERE name ILIKE '${pattern.replace(/'/g, "''")}'
          AND name IS NOT NULL AND name <> ''
          AND role NOT IN ('tenant_user', 'cashier')
          AND email NOT LIKE '%@wa.local'
          AND name NOT LIKE '[TEST:%'
        UNION
        SELECT id::text AS id, TRIM(first_name || ' ' || last_name) AS name
        FROM employees
        WHERE (TRIM(first_name || ' ' || last_name) ILIKE '${pattern.replace(/'/g, "''")}')
          AND (status != 'inactive' OR status IS NULL)
        ORDER BY name LIMIT 20
      `));
      return res.json(rows.rows);
    }

    // Fallback (no type): search suppliers + users/employees, return combined with source tag
    const safePattern = pattern.replace(/'/g, "''");
    const fallbackRows = await db.execute(sql.raw(`
      SELECT id::text AS id, name, 'supplier' AS source FROM suppliers
      WHERE (company_id = ${companyId} OR company_id IS NULL)
        AND is_active = true
        AND name ILIKE '${safePattern}'
      UNION
      SELECT id::text AS id, name, 'user' AS source FROM users
      WHERE name ILIKE '${safePattern}'
        AND name IS NOT NULL AND name <> ''
        AND role NOT IN ('tenant_user', 'cashier')
        AND email NOT LIKE '%@wa.local'
        AND name NOT LIKE '[TEST:%'
      UNION
      SELECT id::text AS id, TRIM(first_name || ' ' || last_name) AS name, 'employee' AS source
      FROM employees
      WHERE TRIM(first_name || ' ' || last_name) ILIKE '${safePattern}'
        AND (status != 'inactive' OR status IS NULL)
      ORDER BY name LIMIT 20
    `));
    return res.json(fallbackRows.rows);
  } catch (err) {
    logger.error({ err }, "GET /accounting/bank-disbursements/counterparty-search error");
    return res.status(500).json({ message: "Gagal mencari counterparty" });
  }
});

// ── GET /vendors  — daftar vendor/supplier aktif untuk filter ────────────────

router.get("/vendors", async (req, res) => {
  try {
    const companyId = resolveCompanyId(req);
    const rows = await db.execute(sql`
      SELECT id, name FROM suppliers
      WHERE (company_id = ${companyId} OR company_id IS NULL)
        AND is_active = true
      ORDER BY name
    `);
    return res.json(rows.rows);
  } catch (err) {
    logger.error({ err }, "GET /accounting/bank-disbursements/vendors error");
    return res.status(500).json({ message: "Gagal mengambil daftar vendor" });
  }
});

// ── GET /  — list ─────────────────────────────────────────────────────────────

router.get("/", async (req, res) => {
  try {
    const companyId = resolveCompanyId(req);
    const limit = Math.min(Number(req.query["limit"] ?? 50), 200);
    const offset = Number(req.query["offset"] ?? 0);
    const supplierId = req.query["supplierId"] ? Number(req.query["supplierId"]) : null;

    const whereClause = supplierId
      ? sql`WHERE company_id = ${companyId} AND counterparty_id = ${supplierId} AND counterparty_type = 'supplier'`
      : sql`WHERE company_id = ${companyId}`;

    const rawRows = await db.execute<DisbRow>(sql`
      SELECT * FROM bank_disbursements
      ${whereClause}
      ORDER BY date DESC, id DESC
      LIMIT ${limit} OFFSET ${offset}
    `);
    const rows = execRows<DisbRow>(rawRows);

    const countClause = supplierId
      ? sql`WHERE company_id = ${companyId} AND counterparty_id = ${supplierId} AND counterparty_type = 'supplier'`
      : sql`WHERE company_id = ${companyId}`;

    const rawTotal = await db.execute<{ total: number }>(sql`
      SELECT COUNT(*)::int AS total FROM bank_disbursements ${countClause}
    `);
    const total = execRows<{ total: number }>(rawTotal)[0]?.total ?? 0;

    return res.json({ data: rows.map((r) => serializeDisb(r)), total });
  } catch (err) {
    logger.error({ err }, "GET /accounting/bank-disbursements error");
    return res.status(500).json({ message: "Gagal mengambil data bank disbursement" });
  }
});

// ── GET /vendor-invoices/outstanding  — outstanding vendor invoices ───────────
// Returns all billed, unpaid/partial purchase_documents UNION posted vendor_invoices
// for this company, plus the AP account id from accounting_settings.

router.get("/vendor-invoices/outstanding", async (req, res) => {
  try {
    const companyId = resolveCompanyId(req);

    const settingsRows = execRows<{ ap_account_id: number | null }>(
      await db.execute<{ ap_account_id: number | null }>(sql`
        SELECT ap_account_id FROM accounting_settings WHERE company_id = ${companyId} LIMIT 1
      `)
    );
    const apAccountId = settingsRows[0]?.ap_account_id ?? null;

    let apAccountName: string | null = null;
    if (apAccountId) {
      const [acct] = await db
        .select({ name: chartOfAccountsTable.name, code: chartOfAccountsTable.code })
        .from(chartOfAccountsTable)
        .where(eq(chartOfAccountsTable.id, apAccountId));
      if (acct) apAccountName = `${acct.code} — ${acct.name}`;
    }

    const rows = execRows<{
      id: number;
      doc_number: string;
      bill_number: string | null;
      supplier_id: number | null;
      supplier_name: string | null;
      grand_total: string;
      amount_paid: string | null;
      due_date: string | null;
      source: "purchase_document" | "vendor_invoice";
    }>(
      await db.execute(sql`
        SELECT
          pd.id,
          pd.doc_number,
          pd.bill_number,
          pd.supplier_id,
          pd.supplier_name,
          pd.grand_total,
          pd.amount_paid,
          LEFT(pd.due_date, 10) AS due_date,
          'purchase_document' AS source
        FROM purchase_documents pd
        WHERE pd.company_id = ${companyId}
          AND pd.bill_status = 'billed'
          AND pd.cancelled_at IS NULL
          AND pd.grand_total > COALESCE(pd.amount_paid, 0)

        UNION ALL

        SELECT
          vi.id,
          vi.invoice_number AS doc_number,
          vi.invoice_number AS bill_number,
          vi.supplier_id,
          vi.supplier_name,
          vi.grand_total,
          vi.amount_paid,
          to_char(vi.due_date, 'YYYY-MM-DD') AS due_date,
          'vendor_invoice' AS source
        FROM vendor_invoices vi
        WHERE vi.company_id = ${companyId}
          AND vi.status IN ('posted', 'matched')
          AND vi.cancelled_at IS NULL
          AND vi.grand_total > COALESCE(vi.amount_paid, 0)

        ORDER BY due_date ASC NULLS LAST, id ASC
      `)
    );

    const vendorInvoiceIds = rows.filter((r) => r.source === "vendor_invoice").map((r) => r.id);
    const withholdingByInvoice = new Map<number, Array<{
      lineTaxId: number;
      invoiceLineId: number;
      taxType: string;
      taxObject: string;
      taxAmount: number;
      liabilityAccountId: number | null;
      status: string;
    }>>();
    if (vendorInvoiceIds.length > 0) {
      const withholdingRows = execRows<{
        vendor_invoice_id: number;
        line_tax_id: number;
        invoice_line_id: number;
        tax_type: string;
        tax_object: string;
        tax_amount: string;
        liability_account_id: number | null;
        status: string;
      }>(await db.execute(sql`
        SELECT
          vwr.vendor_invoice_id,
          vwr.line_tax_id,
          vwr.invoice_line_id,
          vwr.tax_type,
          vwr.tax_object,
          vwr.tax_amount,
          vwr.liability_account_id,
          vwr.status
        FROM vendor_withholding_records vwr
        WHERE vwr.company_id = ${companyId}
          AND vwr.vendor_invoice_id IN (${sql.join(vendorInvoiceIds.map((invoiceId) => sql`${invoiceId}`), sql`, `)})
        ORDER BY vwr.vendor_invoice_id, vwr.invoice_line_id, vwr.id
      `));
      for (const row of withholdingRows) {
        const list = withholdingByInvoice.get(row.vendor_invoice_id) ?? [];
        list.push({
          lineTaxId: row.line_tax_id,
          invoiceLineId: row.invoice_line_id,
          taxType: row.tax_type,
          taxObject: row.tax_object,
          taxAmount: Number(row.tax_amount),
          liabilityAccountId: row.liability_account_id,
          status: row.status,
        });
        withholdingByInvoice.set(row.vendor_invoice_id, list);
      }
    }

    const invoices = rows.map((r) => ({
      id: r.id,
      docNumber: r.doc_number,
      billNumber: r.bill_number,
      supplierId: r.supplier_id,
      supplierName: r.supplier_name ?? "—",
      grandTotal: Number(r.grand_total),
      amountPaid: Number(r.amount_paid ?? 0),
      outstanding: Number(r.grand_total) - Number(r.amount_paid ?? 0),
      dueDate: r.due_date,
      currency: "IDR",
      source: r.source,
      withholdingLines: r.source === "vendor_invoice" ? (withholdingByInvoice.get(r.id) ?? []) : [],
    }));

    // Fetch all active suppliers for this company (include global suppliers with null company_id)
    const supplierRows = await db.execute(sql`
      SELECT id, name FROM suppliers
      WHERE (company_id = ${companyId} OR company_id IS NULL)
        AND is_active = true
      ORDER BY name
    `);

    return res.json({ apAccountId, apAccountName, invoices, suppliers: supplierRows.rows });
  } catch (err) {
    logger.error({ err }, "GET /accounting/bank-disbursements/vendor-invoices/outstanding error");
    return res.status(500).json({ message: "Gagal mengambil daftar invoice outstanding" });
  }
});

// ── GET /summary  — Treasury Dashboard summary ────────────────────────────────
// Must be BEFORE /:id to avoid param clash.

router.get("/summary", async (req, res) => {
  try {
    const companyId = resolveCompanyId(req);

    const [
      spendingRows,
      invoiceRows,
      kasbonRows,
      approvalRows,
      queueInvoiceRows,
      queueKasbonRows,
      recentRows,
      bankBalanceRows,
    ] = await Promise.all([
      // Spending today / this week / this month
      db.execute<{
        today: string;
        this_week: string;
        this_month: string;
      }>(sql`
        SELECT
          COALESCE(SUM(total_amount) FILTER (WHERE date::date = CURRENT_DATE), 0)::numeric          AS today,
          COALESCE(SUM(total_amount) FILTER (WHERE date::date >= date_trunc('week', CURRENT_DATE)), 0)::numeric  AS this_week,
          COALESCE(SUM(total_amount) FILTER (WHERE date::date >= date_trunc('month', CURRENT_DATE)), 0)::numeric AS this_month
        FROM bank_disbursements
        WHERE company_id = ${companyId} AND status = 'posted'
      `),

      // Outstanding + overdue vendor invoices (purchase_documents billed + vendor_invoices posted)
      db.execute<{
        outstanding_count: number;
        outstanding_total: string;
        overdue_count: number;
        overdue_total: string;
      }>(sql`
        SELECT
          COUNT(*)::int                                                                                     AS outstanding_count,
          COALESCE(SUM(remaining), 0)::numeric                                                             AS outstanding_total,
          (COUNT(*) FILTER (WHERE due_date_parsed < CURRENT_DATE))::int                                    AS overdue_count,
          COALESCE(SUM(remaining) FILTER (WHERE due_date_parsed < CURRENT_DATE), 0)::numeric              AS overdue_total
        FROM (
          SELECT
            (grand_total - COALESCE(amount_paid, 0)) AS remaining,
            due_date::date AS due_date_parsed
          FROM purchase_documents
          WHERE company_id = ${companyId}
            AND bill_status = 'billed'
            AND cancelled_at IS NULL
            AND grand_total > COALESCE(amount_paid, 0)
            AND due_date IS NOT NULL

          UNION ALL

          SELECT
            (grand_total - COALESCE(amount_paid, 0)) AS remaining,
            due_date::date AS due_date_parsed
          FROM vendor_invoices
          WHERE company_id = ${companyId}
            AND status = 'posted'
            AND cancelled_at IS NULL
            AND grand_total > COALESCE(amount_paid, 0)
            AND due_date IS NOT NULL
        ) combined
      `),

      // Kasbon belum dipertanggungjawabkan (status = active, tipe kasbon)
      db.execute<{
        kasbon_count: number;
        kasbon_total: string;
      }>(sql`
        SELECT
          COUNT(*)::int                                             AS kasbon_count,
          COALESCE(SUM(amount - COALESCE(paid_amount, 0)), 0)::numeric AS kasbon_total
        FROM cash_advances
        WHERE company_id = ${companyId}
          AND type = 'kasbon'
          AND status = 'active'
      `),

      // Approval pending (expense_approval_requests for this company's kasbon/talangan)
      db.execute<{ pending_count: number }>(sql`
        SELECT COUNT(*)::int AS pending_count
        FROM expense_approval_requests ear
        WHERE ear.status = 'pending'
          AND ear.ref_type IN ('kasbon','talangan')
          AND ear.ref_id IN (
            SELECT id FROM cash_advances WHERE company_id = ${companyId}
          )
      `),

      // Queue: overdue invoices + due today (max 20 items)
      // NOTE: due_date stored as TEXT → cast before date comparison
      db.execute<{
        id: number;
        doc_number: string;
        bill_number: string | null;
        supplier_name: string | null;
        outstanding: string;
        due_date: string | null;
        priority: number;
      }>(sql`
        SELECT
          id,
          doc_number,
          bill_number,
          supplier_name,
          (grand_total - COALESCE(amount_paid, 0))::numeric AS outstanding,
          due_date,
          CASE
            WHEN due_date IS NOT NULL AND due_date::date < CURRENT_DATE THEN 1
            WHEN due_date IS NOT NULL AND due_date::date = CURRENT_DATE THEN 2
            ELSE 3
          END AS priority
        FROM purchase_documents
        WHERE company_id = ${companyId}
          AND bill_status = 'billed'
          AND cancelled_at IS NULL
          AND grand_total > COALESCE(amount_paid, 0)
          AND (due_date IS NULL OR due_date::date <= CURRENT_DATE)
        ORDER BY priority ASC, due_date ASC
        LIMIT 20
      `),

      // Queue: kasbon aktif belum lunas (tidak ada due_date di tabel, sort by date ASC = paling lama dulu)
      db.execute<{
        id: number;
        advance_number: string | null;
        party_name: string | null;
        amount: string;
        paid_amount: string | null;
        date: string;
      }>(sql`
        SELECT id, advance_number, party_name, amount, paid_amount, date::text AS date
        FROM cash_advances
        WHERE company_id = ${companyId}
          AND type = 'kasbon'
          AND status = 'active'
          AND amount > COALESCE(paid_amount, 0)
        ORDER BY date ASC
        LIMIT 10
      `),

      // Recent activity: last 10 disbursements
      db.execute<DisbRow>(sql`
        SELECT * FROM bank_disbursements
        WHERE company_id = ${companyId}
        ORDER BY date DESC, id DESC
        LIMIT 10
      `),

      // Bank balance from accounting entry lines (cash_bank subtype accounts)
      db.execute<{ balance: string }>(sql`
        SELECT COALESCE(
          SUM(ael.debit) - SUM(ael.credit),
          0
        )::numeric AS balance
        FROM accounting_entry_lines ael
        JOIN chart_of_accounts coa ON ael.account_id = coa.id
        JOIN accounting_entries ae ON ael.entry_id = ae.id
        WHERE (coa.company_id = ${companyId} OR coa.company_id IS NULL)
          AND ae.company_id = ${companyId}
          AND ae.status = 'posted'
          AND coa.type = 'asset'
          AND (
            coa.subtype = 'cash_bank'
            OR (coa.subtype IS NULL AND (
              coa.name ILIKE '%kas%'
              OR coa.name ILIKE '%bank%'
              OR coa.name ILIKE '%giro%'
              OR coa.name ILIKE '%tabungan%'
            ))
          )
      `),
    ]);

    const spending = execRows<{ today: string; this_week: string; this_month: string }>(spendingRows)[0];
    const invoiceStat = execRows<{ outstanding_count: number; outstanding_total: string; overdue_count: number; overdue_total: string }>(invoiceRows)[0];
    const kasbonStat = execRows<{ kasbon_count: number; kasbon_total: string }>(kasbonRows)[0];
    const approvalStat = execRows<{ pending_count: number }>(approvalRows)[0];
    const bankBalance = execRows<{ balance: string }>(bankBalanceRows)[0];

    const invoiceQueue = execRows<{ id: number; doc_number: string; bill_number: string | null; supplier_name: string | null; outstanding: string; due_date: string | null; priority: number }>(queueInvoiceRows);
    const kasbonQueue = execRows<{ id: number; advance_number: string | null; party_name: string | null; amount: string; paid_amount: string | null; date: string }>(queueKasbonRows);
    const recentDisbs = execRows<DisbRow>(recentRows);

    // Build unified priority queue
    const queue: Array<{
      type: "invoice_overdue" | "invoice_today" | "kasbon_overdue";
      id: number;
      label: string;
      sublabel: string;
      amount: number;
      dueDate: string | null;
      priority: number;
      actionMode?: string;
      actionIds?: number[];
      employeeName?: string | null;
    }> = [];

    for (const inv of invoiceQueue) {
      const isOverdue = inv.priority === 1;
      queue.push({
        type: isOverdue ? "invoice_overdue" : "invoice_today",
        id: inv.id,
        label: inv.supplier_name ?? inv.doc_number,
        sublabel: inv.bill_number ?? inv.doc_number,
        amount: Number(inv.outstanding),
        dueDate: inv.due_date,
        priority: inv.priority,
        actionMode: "vendor_invoice",
        actionIds: [inv.id],
      });
    }

    for (const ka of kasbonQueue) {
      queue.push({
        type: "kasbon_overdue",
        id: ka.id,
        label: ka.party_name ?? ka.advance_number ?? `Kasbon #${ka.id}`,
        sublabel: ka.advance_number ?? `KSB-${ka.id}`,
        amount: Number(ka.amount) - Number(ka.paid_amount ?? 0),
        dueDate: ka.date,
        priority: 4,
        actionMode: "employee_advance",
        employeeName: ka.party_name ?? null,
      });
    }

    queue.sort((a, b) => a.priority - b.priority || (a.dueDate ?? "").localeCompare(b.dueDate ?? ""));

    return res.json({
      summary: {
        bankBalance: Number(bankBalance?.balance ?? 0),
        spendingToday: Number(spending?.today ?? 0),
        spendingWeek: Number(spending?.this_week ?? 0),
        spendingMonth: Number(spending?.this_month ?? 0),
      },
      outstanding: {
        vendorInvoiceCount: Number(invoiceStat?.outstanding_count ?? 0),
        vendorInvoiceTotal: Number(invoiceStat?.outstanding_total ?? 0),
        overdueCount: Number(invoiceStat?.overdue_count ?? 0),
        overdueTotal: Number(invoiceStat?.overdue_total ?? 0),
        kasbonCount: Number(kasbonStat?.kasbon_count ?? 0),
        kasbonTotal: Number(kasbonStat?.kasbon_total ?? 0),
        approvalPendingCount: Number(approvalStat?.pending_count ?? 0),
      },
      queue,
      recentActivity: recentDisbs.map((d) => serializeDisb(d)),
    });
  } catch (err) {
    logger.error({ err }, "GET /accounting/bank-disbursements/summary error");
    return res.status(500).json({ message: "Gagal mengambil treasury summary" });
  }
});

// ── GET /:id  — detail ────────────────────────────────────────────────────────

router.get("/:id", async (req, res) => {
  try {
    const companyId = resolveCompanyId(req);
    const id = Number(req.params["id"]);
    if (!id) return res.status(400).json({ message: "Invalid id" });

    const rows = execRows<DisbRow>(await db.execute<DisbRow>(sql`
      SELECT * FROM bank_disbursements WHERE id = ${id} AND company_id = ${companyId}
    `));
    if (!rows[0]) return res.status(404).json({ message: "Tidak ditemukan" });

    const items = execRows<ItemRow>(await db.execute<ItemRow>(sql`
      SELECT * FROM bank_disbursement_items WHERE disbursement_id = ${id} ORDER BY seq
    `));

    let entry = null;
    if (rows[0].entry_id) {
      const [e] = await db
        .select()
        .from(accountingEntriesTable)
        .where(eq(accountingEntriesTable.id, rows[0].entry_id));
      if (e) {
        const lines = await db
          .select()
          .from(accountingEntryLinesTable)
          .where(eq(accountingEntryLinesTable.entryId, e.id));
        entry = { ...e, lines };
      }
    }

    return res.json({ ...serializeDisb(rows[0], items), entry });
  } catch (err) {
    logger.error({ err }, "GET /accounting/bank-disbursements/:id error");
    return res.status(500).json({ message: "Gagal mengambil detail" });
  }
});

// ── POST /  — create ──────────────────────────────────────────────────────────

router.post("/", async (req, res) => {
  try {
    const companyId = resolveCompanyId(req);
    const {
      journalId, date: dateStr, ref, memo, items,
      sourceModule, sourceId, sourceNumber,
      paymentType, invoicePayments,
    } = req.body ?? {};

    // ── Basic validation ──────────────────────────────────────────────────
    if (!journalId || !dateStr) {
      return res.status(400).json({ message: "journalId dan date wajib diisi" });
    }

    const date = new Date(dateStr);
    if (Number.isNaN(date.getTime())) {
      return res.status(400).json({ message: "Tanggal tidak valid" });
    }

    const resolvedPaymentType: string = paymentType === "vendor_invoice" ? "vendor_invoice" : "direct";

    // ── vendor_invoice mode: build processedItems from invoicePayments ────
    if (resolvedPaymentType === "vendor_invoice") {
      if (!Array.isArray(invoicePayments) || invoicePayments.length === 0) {
        return res.status(400).json({ message: "Pilih minimal satu invoice untuk dibayar" });
      }

      const settingsRows = execRows<{ ap_account_id: number | null }>(
        await db.execute<{ ap_account_id: number | null }>(sql`
          SELECT ap_account_id FROM accounting_settings WHERE company_id = ${companyId} LIMIT 1
        `)
      );
      const apAccountId = settingsRows[0]?.ap_account_id ?? null;
      if (!apAccountId) {
        return res.status(400).json({
          message: "Akun AP (Hutang Usaha) belum dikonfigurasi. Set di Accounting > Settings > AP Account.",
        });
      }

      const [apAcct] = await db
        .select({ id: chartOfAccountsTable.id, name: chartOfAccountsTable.name, type: chartOfAccountsTable.type })
        .from(chartOfAccountsTable)
        .where(eq(chartOfAccountsTable.id, apAccountId));
      if (!apAcct) {
        return res.status(400).json({ message: `Akun AP id=${apAccountId} tidak ditemukan di CoA.` });
      }

      // Load journal
      const [journal] = await db
        .select()
        .from(accountingJournalsTable)
        .where(eq(accountingJournalsTable.id, Number(journalId)));
      if (!journal) return res.status(404).json({ message: "Jurnal tidak ditemukan" });
      if (journal.type !== "bank" && journal.type !== "cash") {
        return res.status(400).json({ message: "Jurnal harus bertipe bank atau cash" });
      }
      const settings0 = await ensureAccountingSettings(companyId);
      const bankAccountId = journal.defaultCreditAccountId ?? journal.defaultDebitAccountId
        ?? (journal.type === "cash" ? settings0.defaultCashAccountId : settings0.defaultBankAccountId)
        ?? settings0.defaultBankAccountId;
      if (!bankAccountId) {
        return res.status(400).json({ message: "Jurnal tidak memiliki default akun bank/kas. Konfigurasi di Accounting > Journals atau Accounting > Settings." });
      }

      type ProcessedItem = {
        seq: number;
        transaction_type: string;
        account_id: number;
        description: string | null;
        amount: number;
        notes: string | null;
        purchase_document_id: number | null;
        vendor_invoice_id: number | null;
        wht_amount: number;
        wht_account_id: number | null;
        withholding_allocations: Array<{ lineTaxId: number; invoiceLineId: number; amount: number; accountId: number }>;
        invoice_number: string | null;
      };

      const processedItems: ProcessedItem[] = [];

      for (let i = 0; i < invoicePayments.length; i++) {
        const ip = invoicePayments[i];
        const itemLabel = `Invoice ${i + 1}`;

        const payAmt = round2(Number(ip.paymentAmount));
        if (Number.isNaN(payAmt) || payAmt <= 0) {
          return res.status(400).json({ message: `${itemLabel}: paymentAmount harus > 0` });
        }

        const whtAmt = round2(Number(ip.whtAmount ?? 0));
        if (whtAmt < 0) return res.status(400).json({ message: `${itemLabel}: wht_amount tidak boleh negatif` });

        let whtAccountId: number | null = null;
        if (whtAmt > 0) {
          if (!ip.whtAccountId) {
            return res.status(400).json({ message: `${itemLabel}: wht_account_id wajib jika wht_amount > 0` });
          }
          const [whtAcct] = await db
            .select({ id: chartOfAccountsTable.id, type: chartOfAccountsTable.type, name: chartOfAccountsTable.name })
            .from(chartOfAccountsTable)
            .where(eq(chartOfAccountsTable.id, Number(ip.whtAccountId)));
          if (!whtAcct) return res.status(400).json({ message: `${itemLabel}: akun WHT tidak ditemukan` });
          if (whtAcct.type !== "liability") {
            return res.status(400).json({ message: `${itemLabel}: akun WHT "${whtAcct.name}" harus bertipe Utang/Liability` });
          }
          whtAccountId = whtAcct.id;
        }

        // ── Path A: vendor_invoice (standalone invoice dari AI Import / direct create) ──
        if (ip.vendorInvoiceId) {
           const viRows = execRows<{ id: number; grand_total: string; amount_paid: string; invoice_number: string; supplier_name: string }>(
            await db.execute(sql`
              SELECT id, grand_total, amount_paid, invoice_number, supplier_name
              FROM vendor_invoices
              WHERE id = ${Number(ip.vendorInvoiceId)}
                AND company_id = ${companyId}
                AND status = 'posted'
                AND cancelled_at IS NULL
            `)
          );
          const vi = viRows[0];
          if (!vi) {
            return res.status(400).json({ message: `${itemLabel}: Vendor Invoice #${ip.vendorInvoiceId} tidak ditemukan atau belum posted.` });
          }
          const viOutstanding = round2(Number(vi.grand_total) - Number(vi.amount_paid ?? 0));
          if (viOutstanding <= 0) {
            return res.status(409).json({ message: `${itemLabel}: Vendor Invoice ${vi.invoice_number} sudah lunas.` });
          }
          if (payAmt > viOutstanding + 0.01) {
            return res.status(400).json({
              message: `${itemLabel}: Jumlah bayar (${payAmt}) melebihi sisa hutang invoice (${viOutstanding}).`,
            });
          }
           const taxRows = execRows<{
             id: number;
             invoice_line_id: number;
             tax_amount: string;
             liability_account_id: number | null;
             resolution_status: string;
           }>(await db.execute(sql`
             SELECT id, invoice_line_id, tax_amount, liability_account_id, resolution_status
             FROM vendor_invoice_line_taxes
             WHERE company_id = ${companyId} AND invoice_line_id IN (
               SELECT id FROM vendor_invoice_lines WHERE invoice_id = ${vi.id}
             )
             ORDER BY id
           `));
           const rawAllocations = Array.isArray(ip.withholdingAllocations)
             ? ip.withholdingAllocations as Array<Record<string, unknown>>
             : [];
           let withholdingAllocations: Array<{ lineTaxId: number; invoiceLineId: number; amount: number; accountId: number }> = [];
           if (whtAmt > 0) {
             const candidates = rawAllocations.length > 0
               ? rawAllocations.map((allocation) => {
                   const lineTaxId = Number(allocation.lineTaxId);
                   const matched = taxRows.find((tax) => tax.id === lineTaxId);
                   return {
                     lineTaxId,
                     invoiceLineId: matched?.invoice_line_id ?? Number(allocation.invoiceLineId),
                     amount: round2(Number(allocation.amount)),
                     accountId: Number(allocation.liabilityAccountId ?? allocation.accountId),
                     matched,
                   };
                 })
               : taxRows.length === 1
                 ? [{
                     lineTaxId: taxRows[0]!.id,
                     invoiceLineId: taxRows[0]!.invoice_line_id,
                     amount: whtAmt,
                     accountId: Number(taxRows[0]!.liability_account_id ?? ip.whtAccountId),
                     matched: taxRows[0],
                   }]
                 : [];
             if (candidates.length === 0) {
               return res.status(422).json({
                 message: `${itemLabel}: PPh invoice multi-line wajib dikirim sebagai withholdingAllocations per line.`,
               });
             }
             if (candidates.some((allocation) =>
               !allocation.matched ||
               allocation.matched.resolution_status !== "confirmed" ||
               !Number.isInteger(allocation.accountId) ||
               allocation.accountId !== Number(allocation.matched.liability_account_id) ||
               allocation.amount <= 0 ||
               allocation.amount > Number(allocation.matched.tax_amount) + 0.01
             )) {
               return res.status(422).json({
                 message: `${itemLabel}: allocation PPh per line belum memiliki tax review/liability yang valid.`,
               });
             }
             const allocatedTotal = round2(candidates.reduce((sum, allocation) => sum + allocation.amount, 0));
             if (Math.abs(allocatedTotal - whtAmt) > 0.01) {
               return res.status(422).json({
                 message: `${itemLabel}: total withholding allocation per line tidak sama dengan whtAmount.`,
               });
             }
             withholdingAllocations = candidates.map(({ matched: _matched, ...allocation }) => allocation);
           }
           const grossSettlement = round2(payAmt + whtAmt);
           if (grossSettlement > viOutstanding + 0.01) {
             return res.status(400).json({
               message: `${itemLabel}: pembayaran gross (${grossSettlement}) melebihi sisa hutang invoice (${viOutstanding}).`,
             });
           }
          // Resolve debit account: use user-selected expenseAccountId if provided, else AP account
           const debitAccountIdA = apAccountId;
        processedItems.push({
            seq: i + 1,
            transaction_type: "supplier_payment",
            account_id: debitAccountIdA,
            description: `Bayar invoice ${vi.invoice_number}`,
            amount: payAmt,
            notes: null,
            purchase_document_id: null,
            vendor_invoice_id: Number(ip.vendorInvoiceId),
            wht_amount: whtAmt,
             wht_account_id: withholdingAllocations.length === 1 ? withholdingAllocations[0]!.accountId : whtAccountId,
             withholding_allocations: withholdingAllocations,
            invoice_number: vi.invoice_number,
          });
          continue;
        }

        // ── Path B: purchase_document (PO/bill flow) ──────────────────────────
        if (!ip.purchaseDocumentId) {
          return res.status(400).json({ message: `${itemLabel}: purchaseDocumentId atau vendorInvoiceId wajib diisi` });
        }

        // Verify invoice exists and is outstanding
        const invRows = execRows<{ id: number; grand_total: string; amount_paid: string | null; bill_number: string | null; doc_number: string }>(
          await db.execute(sql`
            SELECT id, grand_total, amount_paid, bill_number, doc_number
            FROM purchase_documents
            WHERE id = ${Number(ip.purchaseDocumentId)}
              AND company_id = ${companyId}
              AND bill_status = 'billed'
              AND cancelled_at IS NULL
          `)
        );
        const inv = invRows[0];
        if (!inv) {
          return res.status(400).json({ message: `${itemLabel}: Invoice #${ip.purchaseDocumentId} tidak ditemukan atau sudah dibatalkan.` });
        }
        const outstanding = round2(Number(inv.grand_total) - Number(inv.amount_paid ?? 0));
        if (outstanding <= 0) {
          return res.status(409).json({ message: `${itemLabel}: Invoice ${inv.doc_number} sudah lunas.` });
        }
        if (payAmt > outstanding + 0.01) {
          return res.status(400).json({
            message: `${itemLabel}: Jumlah bayar (${payAmt}) melebihi sisa hutang invoice (${outstanding}).`,
          });
        }

        // Resolve debit account: use user-selected expenseAccountId if provided, else AP account
        const debitAccountIdB = ip.expenseAccountId ? Number(ip.expenseAccountId) : apAccountId;
        const invoiceLabel = inv.bill_number ?? inv.doc_number;
        processedItems.push({
          seq: i + 1,
          transaction_type: "supplier_payment",
          account_id: debitAccountIdB,
          description: `Bayar invoice ${invoiceLabel}`,
          amount: payAmt,
          notes: null,
          purchase_document_id: Number(ip.purchaseDocumentId),
          vendor_invoice_id: null,
          wht_amount: whtAmt,
          wht_account_id: whtAccountId,
          withholding_allocations: [],
          invoice_number: invoiceLabel,
        });
      }

      // Compute totals
       const totalAmount = round2(processedItems.reduce((s, it) => s + it.amount, 0));
      const totalWht    = round2(processedItems.reduce((s, it) => s + it.wht_amount, 0));
      const bankCredit  = round2(totalAmount - totalWht);

      // Build journal lines
      const journalLines: Array<{ accountId: number; debit: number; credit: number; description: string }> = [];
       for (const it of processedItems) {
         // The invoice/AP balance is gross. The supplier receives net cash,
         // while withholding is credited to its own liability account.
         journalLines.push({
           accountId: it.account_id,
           debit: round2(it.amount + it.wht_amount),
           credit: 0,
           description: it.description ?? "Hutang Supplier gross",
         });
      }
      const whtByAccount = new Map<number, number>();
       for (const it of processedItems) {
         if (it.withholding_allocations.length > 0) {
           for (const allocation of it.withholding_allocations) {
             whtByAccount.set(
               allocation.accountId,
               round2((whtByAccount.get(allocation.accountId) ?? 0) + allocation.amount),
             );
           }
         } else if (it.wht_amount > 0 && it.wht_account_id) {
           whtByAccount.set(it.wht_account_id, round2((whtByAccount.get(it.wht_account_id) ?? 0) + it.wht_amount));
         }
      }
      for (const [whtAccId, whtTotal] of whtByAccount) {
        journalLines.push({ accountId: whtAccId, debit: 0, credit: whtTotal, description: `WHT Payable — Bank Disbursement${ref ? ` ${ref}` : ""}` });
      }
      journalLines.push({ accountId: bankAccountId, debit: 0, credit: bankCredit, description: `Bank Disbursement${ref ? ` - ${ref}` : ""}` });

      const cntResult = execRows<{ cnt: number }>(await db.execute<{ cnt: number }>(sql`
        SELECT COUNT(*)::int AS cnt FROM bank_disbursements WHERE company_id = ${companyId}
      `));
      const cnt = cntResult[0]?.cnt ?? 0;
      const year = new Date().getFullYear();
      const seq = (Number(cnt) + 1).toString().padStart(4, "0");
      const disbNum = `BD/${year}/${seq}`;

      const entry = await postEntry(
        {
          journalId: journal.id,
          date,
          ref: ref ?? null,
          description: memo ?? `Bank Disbursement ${disbNum} — Bayar Invoice Vendor`,
          source: "manual_payment",
          companyId,
          lines: journalLines,
        },
        journal.code,
      );

      const smVal  = sourceModule ? String(sourceModule) : "vendor_invoice";
      const sidVal = sourceId     ? Number(sourceId)     : null;
      const snVal  = sourceNumber ? String(sourceNumber)  : null;

      const { attachmentUrl: attachmentUrlBody } = req.body ?? {};
      const attachmentUrlVal = attachmentUrlBody ? String(attachmentUrlBody) : null;

      const insertedRows = execRows<{ id: number }>(await db.execute<{ id: number }>(sql`
        INSERT INTO bank_disbursements
          (company_id, disbursement_number, journal_id, date, ref, memo, total_amount, status, entry_id,
           created_by_id, source_module, source_id, source_number, payment_type, attachment_url)
        VALUES
          (${companyId}, ${disbNum}, ${journal.id}, ${dateStr}, ${ref ?? null}, ${memo ?? null},
           ${String(totalAmount)}, 'posted', ${entry.id}, ${(req as any).user?.id ?? null},
           ${smVal}, ${sidVal}, ${snVal}, 'vendor_invoice', ${attachmentUrlVal})
        RETURNING id
      `));

      const disbId = insertedRows[0]!.id;

      for (const it of processedItems) {
        await db.execute(sql`
          INSERT INTO bank_disbursement_items
            (disbursement_id, seq, transaction_type, account_id, description, amount, notes,
             purchase_document_id, vendor_invoice_id, wht_amount, wht_account_id, invoice_number)
          VALUES
            (${disbId}, ${it.seq}, ${it.transaction_type}, ${it.account_id},
             ${it.description}, ${String(it.amount)}, ${it.notes},
             ${it.purchase_document_id ?? null}, ${it.vendor_invoice_id ?? null},
             ${String(it.wht_amount)}, ${it.wht_account_id ?? null},
             ${it.invoice_number ?? null})
        `);
      }

      const linkedPOIds = processedItems.map((it) => it.purchase_document_id!).filter(Boolean);
      if (linkedPOIds.length > 0) {
        void recalculateBatchFromBankDisbursements(linkedPOIds).catch((e) =>
          logger.warn({ e, disbId }, "[bankDisbursements] recalculate batch vendor_invoice error (non-fatal)"),
        );
      }

      // ── Update amount_paid on vendor_invoices after disbursement is posted ──
      const linkedVIIds = processedItems.map((it) => it.vendor_invoice_id!).filter(Boolean);
       for (const viId of linkedVIIds) {
         const paid = processedItems
           .filter((it) => it.vendor_invoice_id === viId)
           .reduce((s, it) => s + it.amount + it.wht_amount, 0);
        const [viRow] = await db
          .select({ grandTotal: vendorInvoicesTable.grandTotal, amountPaid: vendorInvoicesTable.amountPaid })
          .from(vendorInvoicesTable)
          .where(eq(vendorInvoicesTable.id, viId));
        if (viRow) {
          const newPaid = round2(Number(viRow.amountPaid) + paid);
          const isPaid = newPaid >= round2(Number(viRow.grandTotal)) - 0.01;
          const proofRows = execRows<{ pending_count: number }>(await db.execute(sql`
            SELECT COUNT(*)::int AS pending_count
            FROM vendor_withholding_records
            WHERE vendor_invoice_id = ${viId}
              AND company_id = ${companyId}
              AND status <> 'proof_received'
          `));
          const withholdingPending = Number(proofRows[0]?.pending_count ?? 0) > 0;
          await db
            .update(vendorInvoicesTable)
            .set({
              amountPaid: String(newPaid),
              status: isPaid && !withholdingPending ? "paid" : "posted",
              updatedAt: new Date(),
            })
            .where(eq(vendorInvoicesTable.id, viId));
        }
      }

      const createdRows  = execRows<DisbRow>(await db.execute<DisbRow>(sql`SELECT * FROM bank_disbursements WHERE id = ${disbId}`));
      const createdItems = execRows<ItemRow>(await db.execute<ItemRow>(sql`SELECT * FROM bank_disbursement_items WHERE disbursement_id = ${disbId} ORDER BY seq`));

      logger.info({ disbId, disbNum, companyId, totalAmount, totalWht, bankCredit, mode: "vendor_invoice" }, "[bankDisbursements] Created vendor_invoice disbursement");

      // ── FASE 4 T006: Auto-capture WHT sebagai transaction tax ────────────────
      if (totalWht > 0) {
        const { recordTransactionTax } = await import("../lib/taxAutoService.js");
        void recordTransactionTax({
          companyId,
          transactionType: "purchase_order",
          transactionId: disbId,
          transactionRef: disbNum,
          baseAmount: totalAmount,
          taxAmount: totalWht,
          subType: "withholding_pph",
        }).catch((e) => logger.warn({ e, disbId }, "[tax] WHT capture error (non-fatal)"));
      }

      return res.status(201).json({
        ...serializeDisb(createdRows[0], createdItems),
        _meta: { totalAmount, totalWht, bankCredit, linkedPOIds, linkedVIIds },
      });
    }

    // ── direct mode (existing logic) ─────────────────────────────────────
    if (!Array.isArray(items) || items.length === 0) {
      return res.status(400).json({ message: "Minimal satu item diperlukan" });
    }

    // ── Load journal ──────────────────────────────────────────────────────
    const [journal] = await db
      .select()
      .from(accountingJournalsTable)
      .where(eq(accountingJournalsTable.id, Number(journalId)));

    if (!journal) return res.status(404).json({ message: "Jurnal tidak ditemukan" });
    if (journal.type !== "bank" && journal.type !== "cash") {
      return res.status(400).json({ message: "Jurnal harus bertipe bank atau cash" });
    }

    // ── Resolve bank/cash account from journal ────────────────────────────
    // Prefer journal's configured default account; fall back to accounting_settings
    // so that journals created before their COA account existed can still be used.
    const settingsFallback = await ensureAccountingSettings(companyId);
    const bankAccountId = journal.defaultCreditAccountId ?? journal.defaultDebitAccountId
      ?? (journal.type === "cash" ? settingsFallback.defaultCashAccountId : settingsFallback.defaultBankAccountId)
      ?? settingsFallback.defaultBankAccountId;
    if (!bankAccountId) {
      return res.status(400).json({
        message: "Jurnal tidak memiliki default akun bank/kas. Konfigurasi di Accounting > Journals atau Accounting > Settings.",
      });
    }

    // ── Validate + build line items ───────────────────────────────────────
    const validTypes = [
      "expense", "supplier_payment", "tax_payment",
      "employee_advance", "fund_transfer",
      "loan_payment", "equity_withdrawal", "other",
    ];

    type ProcessedItem = {
      seq: number;
      transaction_type: string;
      account_id: number;
      description: string | null;
      amount: number;           // DPP — gross amount sebelum PPN dan WHT
      notes: string | null;
      purchase_document_id: number | null;  // Phase 1
      wht_amount: number;                    // Phase 1 (default 0)
      wht_account_id: number | null;         // Phase 1
      party_name: string | null;             // Phase 4
      ppn_amount: number;                    // Phase 7 (default 0)
      ppn_account_id: number | null;         // Phase 7
    };

    const processedItems: ProcessedItem[] = [];

    for (let i = 0; i < items.length; i++) {
      const it = items[i];
      const itemLabel = `Item ${i + 1}`;

      if (!it.accountId) {
        return res.status(400).json({ message: `${itemLabel}: accountId wajib diisi` });
      }
      const amt = round2(Number(it.amount));
      if (Number.isNaN(amt) || amt <= 0) {
        return res.status(400).json({ message: `${itemLabel}: jumlah harus lebih dari 0` });
      }
      if (!validTypes.includes(it.transactionType)) {
        return res.status(400).json({ message: `${itemLabel}: jenis transaksi tidak valid` });
      }

      // ── Phase 2: Anti-double-payment check ──────────────────────────────
      // Jika purchase_document_id sudah punya posted BD yang melunasi penuh → tolak
      if (it.purchaseDocumentId != null && it.transactionType === "supplier_payment") {
        const outstandingRows = execRows<{ total_paid: string; grand_total: string }>(
          await db.execute<{ total_paid: string; grand_total: string }>(sql`
            SELECT
              COALESCE(SUM(bdi.amount), 0)::text AS total_paid,
              COALESCE(pd.grand_total, 0)::text  AS grand_total
            FROM purchase_documents pd
            LEFT JOIN bank_disbursement_items bdi
                   ON bdi.purchase_document_id = pd.id
                  AND EXISTS (
                    SELECT 1 FROM bank_disbursements bd2
                    WHERE bd2.id = bdi.disbursement_id AND bd2.status = 'posted'
                  )
            WHERE pd.id = ${Number(it.purchaseDocumentId)}
            GROUP BY pd.grand_total
          `)
        );
        const row = outstandingRows[0];
        if (row) {
          const grandTotal = parseFloat(row.grand_total);
          const totalPaid  = parseFloat(row.total_paid);
          if (grandTotal > 0 && totalPaid >= grandTotal) {
            return res.status(409).json({
              message: `Item ${i + 1}: Dokumen pembelian #${it.purchaseDocumentId} sudah lunas (total_paid=${totalPaid}, grand_total=${grandTotal}). Tidak dapat membuat disbursement baru.`,
            });
          }
        }
      }

      // ── Phase 1: Validasi purchase_document_id ──────────────────────────
      if (it.purchaseDocumentId != null && it.transactionType !== "supplier_payment") {
        return res.status(400).json({
          message: `${itemLabel}: purchase_document_id hanya boleh diisi untuk jenis transaksi supplier_payment (bukan "${it.transactionType}").`,
        });
      }

      // ── Phase 1: Validasi WHT ────────────────────────────────────────────
      const whtAmt = round2(Number(it.whtAmount ?? 0));
      if (whtAmt < 0) {
        return res.status(400).json({ message: `${itemLabel}: wht_amount tidak boleh negatif` });
      }
      if (whtAmt > 0 && it.transactionType !== "supplier_payment") {
        return res.status(400).json({
          message: `${itemLabel}: WHT hanya didukung untuk jenis transaksi supplier_payment.`,
        });
      }
      if (whtAmt >= amt) {
        return res.status(400).json({
          message: `${itemLabel}: wht_amount (${whtAmt}) tidak boleh lebih besar atau sama dengan jumlah payment (${amt}).`,
        });
      }
      if (whtAmt > 0 && !it.whtAccountId) {
        return res.status(400).json({
          message: `${itemLabel}: wht_account_id wajib diisi jika wht_amount > 0.`,
        });
      }

      // ── Verify debit account exists + validate type per transaction_type ──
      const [acct] = await db
        .select({
          id:      chartOfAccountsTable.id,
          code:    chartOfAccountsTable.code,
          name:    chartOfAccountsTable.name,
          type:    chartOfAccountsTable.type,
          subtype: chartOfAccountsTable.subtype,
        })
        .from(chartOfAccountsTable)
        .where(eq(chartOfAccountsTable.id, Number(it.accountId)));

      if (!acct) {
        return res.status(400).json({ message: `${itemLabel}: akun tidak ditemukan (id=${it.accountId})` });
      }

      // ── Per-transaction-type DR account validation ─────────────────────────
      if (it.transactionType === "supplier_payment") {
        // Granular whitelist — type alone is not sufficient (e.g. asset/cash_bank is blocked)
        if (!isAllowedForSupplierPaymentDr(acct.type as string, acct.subtype, acct.name, acct.code)) {
          return res.status(400).json({
            message: supplierPaymentDrRejectMsg(
              itemLabel, acct.name, acct.type as string, acct.subtype, acct.code,
            ),
          });
        }
      } else if (it.transactionType === "tax_payment") {
        // tax_payment: harus tax-related liability atau expense
        if (!isTaxRelatedAccount(acct.type as string, acct.subtype, acct.name, acct.code)) {
          return res.status(400).json({
            message: taxPaymentDrRejectMsg(itemLabel, acct.name, acct.type as string),
          });
        }
      } else {
        // Generic type-based validation for all other transaction types
        const allowedTypes: Record<string, string[]> = {
          expense:           ["expense"],
          employee_advance:  ["asset"],
          fund_transfer:     ["asset"],
          loan_payment:      ["liability"],
          equity_withdrawal: ["equity"],
          other:             ["asset", "liability", "equity", "revenue", "expense"],
        };
        const allowed = allowedTypes[it.transactionType] ?? [];
        if (allowed.length > 0 && !allowed.includes(acct.type as string)) {
          const typeLabels: Record<string, string> = {
            expense: "Beban", liability: "Utang", asset: "Aset",
            equity: "Ekuitas", revenue: "Pendapatan",
          };
          const allowedLabels = allowed.map((t) => typeLabels[t] ?? t).join(", ");
          const actualLabel = typeLabels[acct.type as string] ?? acct.type;
          return res.status(400).json({
            message: `${itemLabel}: akun "${acct.name}" bertipe ${actualLabel}, sedangkan jenis transaksi "${it.transactionType}" hanya membolehkan akun bertipe ${allowedLabels}.`,
          });
        }
      }

      if (it.transactionType === "fund_transfer") {
        const isCashBank =
          acct.subtype === "cash_bank" ||
          (acct.subtype === null && isCashBankByNameCode(acct.name, acct.code));
        if (!isCashBank) {
          return res.status(400).json({
            message: `${itemLabel}: fund_transfer hanya boleh memilih akun Kas atau Bank sebagai tujuan. Akun "${acct.name}" bukan akun kas/bank (subtype: ${acct.subtype ?? "belum dikategorikan"}). Pilih akun Kas atau Bank, atau gunakan jenis transaksi lain.`,
          });
        }
      }

      // ── Phase 1: Validasi WHT account (WAJIB liability — bukan expense) ──
      let whtAccountId: number | null = null;
      if (whtAmt > 0 && it.whtAccountId) {
        const [whtAcct] = await db
          .select({ id: chartOfAccountsTable.id, name: chartOfAccountsTable.name, type: chartOfAccountsTable.type })
          .from(chartOfAccountsTable)
          .where(eq(chartOfAccountsTable.id, Number(it.whtAccountId)));
        if (!whtAcct) {
          return res.status(400).json({ message: `${itemLabel}: akun WHT tidak ditemukan (id=${it.whtAccountId}).` });
        }
        if (whtAcct.type !== "liability") {
          return res.status(400).json({
            message: `${itemLabel}: akun WHT "${whtAcct.name}" harus bertipe Utang/Liability (WHT Payable), bukan "${whtAcct.type}".`,
          });
        }
        whtAccountId = whtAcct.id;
      }

      // ── Phase 7: Validasi PPN ─────────────────────────────────────────────
      const ppnAmt = round2(Number(it.ppnAmount ?? 0));
      if (ppnAmt < 0) {
        return res.status(400).json({ message: `${itemLabel}: ppn_amount tidak boleh negatif` });
      }
      let ppnAccountId: number | null = null;
      if (ppnAmt > 0) {
        if (!it.ppnAccountId) {
          return res.status(400).json({ message: `${itemLabel}: ppn_account_id wajib diisi jika ppn_amount > 0.` });
        }
        const [ppnAcct] = await db
          .select({ id: chartOfAccountsTable.id, name: chartOfAccountsTable.name })
          .from(chartOfAccountsTable)
          .where(eq(chartOfAccountsTable.id, Number(it.ppnAccountId)));
        if (!ppnAcct) {
          return res.status(400).json({ message: `${itemLabel}: akun PPN tidak ditemukan (id=${it.ppnAccountId}).` });
        }
        ppnAccountId = ppnAcct.id;
      }

      processedItems.push({
        seq: i + 1,
        transaction_type: it.transactionType,
        account_id: Number(it.accountId),
        description: it.description ?? null,
        amount: amt,
        notes: it.notes ?? null,
        purchase_document_id: it.purchaseDocumentId ? Number(it.purchaseDocumentId) : null,
        wht_amount: whtAmt,
        wht_account_id: whtAccountId,
        party_name: it.partyName ? String(it.partyName) : null,
        ppn_amount: ppnAmt,
        ppn_account_id: ppnAccountId,
      });
    }

    // ── P0: Source Guard validation ───────────────────────────────────────
    // Restricted transaction types (employee_advance, expense, loan_payment)
    // MUST come from their source module with a valid source_id.
    {
      const txTypes = processedItems.map((it) => it.transaction_type);
      const sidVal0 = sourceId ? Number(sourceId) : null;
      const smVal0  = sourceModule ? String(sourceModule) : null;
      const totalAmt0 = round2(processedItems.reduce((s, it) => s + it.amount, 0));
      const guardResult = await validateBdSource({
        transactionTypes: txTypes,
        sourceModule: smVal0,
        sourceId: sidVal0,
        amount: totalAmt0,
        companyId,
      });
      if (!guardResult.ok) {
        return res.status(guardResult.statusCode ?? 422).json({ message: guardResult.error });
      }
    }

    // ── Compute totals ────────────────────────────────────────────────────
    // totalAmount (header) = sum DPP semua item (sebelum PPN)
    const totalAmount    = round2(processedItems.reduce((s, it) => s + it.amount, 0));
    // totalWht = sum semua potongan WHT
    const totalWht       = round2(processedItems.reduce((s, it) => s + it.wht_amount, 0));
    // totalPPN = sum semua PPN Masukan per item
    const totalPPN       = round2(processedItems.reduce((s, it) => s + it.ppn_amount, 0));
    // bankCredit = kas yang benar-benar keluar (DPP + PPN - WHT)
    const bankCredit     = round2(totalAmount + totalPPN - totalWht);

    // ── Build compound journal lines ──────────────────────────────────────
    //
    // Untuk setiap item: DR [debit account] dengan gross amount
    // Untuk item yang punya WHT: + CR [WHT Payable] dengan wht_amount
    // Satu baris CR Bank terakhir: net bank credit (totalAmount - totalWht)
    //
    const journalLines: Array<{
      accountId: number;
      debit: number;
      credit: number;
      description: string;
    }> = [];

    // Debit lines (gross per item)
    for (const it of processedItems) {
      journalLines.push({
        accountId: it.account_id,
        debit: it.amount,
        credit: 0,
        description: it.description ?? typeLabel(it.transaction_type),
      });
    }

    // PPN Debit lines (grouped by ppn_account_id — DR PPN Masukan)
    const ppnByAccount = new Map<number, number>();
    for (const it of processedItems) {
      if (it.ppn_amount > 0 && it.ppn_account_id) {
        ppnByAccount.set(
          it.ppn_account_id,
          round2((ppnByAccount.get(it.ppn_account_id) ?? 0) + it.ppn_amount),
        );
      }
    }
    for (const [ppnAccId, ppnTotal] of ppnByAccount) {
      journalLines.push({
        accountId: ppnAccId,
        debit: ppnTotal,
        credit: 0,
        description: `PPN Masukan — Bank Disbursement${ref ? ` ${ref}` : ""}`,
      });
    }

    // WHT Credit lines (grouped by wht_account_id — one CR per unique WHT account)
    const whtByAccount = new Map<number, number>();
    for (const it of processedItems) {
      if (it.wht_amount > 0 && it.wht_account_id) {
        whtByAccount.set(
          it.wht_account_id,
          round2((whtByAccount.get(it.wht_account_id) ?? 0) + it.wht_amount),
        );
      }
    }
    for (const [whtAccId, whtTotal] of whtByAccount) {
      journalLines.push({
        accountId: whtAccId,
        debit: 0,
        credit: whtTotal,
        description: `WHT Payable — Bank Disbursement${ref ? ` ${ref}` : ""}`,
      });
    }

    // Credit Bank (net = DPP + PPN - WHT)
    journalLines.push({
      accountId: bankAccountId,
      debit: 0,
      credit: bankCredit,
      description: `Bank Disbursement${ref ? ` - ${ref}` : ""}`,
    });

    // ── Generate disbursement number ──────────────────────────────────────
    const cntResult = execRows<{ cnt: number }>(await db.execute<{ cnt: number }>(sql`
      SELECT COUNT(*)::int AS cnt FROM bank_disbursements WHERE company_id = ${companyId}
    `));
    const cnt = cntResult[0]?.cnt ?? 0;
    const year   = new Date().getFullYear();
    const seq    = (Number(cnt) + 1).toString().padStart(4, "0");
    const disbNum = `BD/${year}/${seq}`;

    // ── Post journal entry ────────────────────────────────────────────────
    const entry = await postEntry(
      {
        journalId: journal.id,
        date,
        ref: ref ?? null,
        description: memo ?? `Bank Disbursement ${disbNum}`,
        source: "manual_payment",
        companyId,
        lines: journalLines,
      },
      journal.code,
    );

    // ── Insert header ─────────────────────────────────────────────────────
    const smVal  = sourceModule  ? String(sourceModule)  : null;
    const sidVal = sourceId      ? Number(sourceId)       : null;
    const snVal  = sourceNumber  ? String(sourceNumber)   : null;

    // Phase 4: counterparty identity dari body
    const { counterpartyName, counterpartyType, counterpartyId, attachmentUrl: attachmentUrlDirect } = req.body ?? {};
    const cpNameVal       = counterpartyName      ? String(counterpartyName)      : null;
    const cpTypeVal       = counterpartyType      ? String(counterpartyType)      : null;
    const cpIdVal         = counterpartyId        ? Number(counterpartyId)        : null;
    const attachUrlDirect = attachmentUrlDirect   ? String(attachmentUrlDirect)   : null;

    const insertedRows = execRows<{ id: number }>(await db.execute<{ id: number }>(sql`
      INSERT INTO bank_disbursements
        (company_id, disbursement_number, journal_id, date, ref, memo, total_amount, status, entry_id, created_by_id,
         source_module, source_id, source_number, payment_type,
         counterparty_name, counterparty_type, counterparty_id, attachment_url)
      VALUES
        (${companyId}, ${disbNum}, ${journal.id}, ${dateStr}, ${ref ?? null}, ${memo ?? null},
         ${String(totalAmount)}, 'posted', ${entry.id}, ${(req as any).user?.id ?? null},
         ${smVal}, ${sidVal}, ${snVal}, 'direct',
         ${cpNameVal}, ${cpTypeVal}, ${cpIdVal}, ${attachUrlDirect})
      RETURNING id
    `));

    const disbId = insertedRows[0]!.id;

    // ── Insert line items (Phase 1 + Phase 4 + Phase 7 columns) ─────────
    for (const it of processedItems) {
      await db.execute(sql`
        INSERT INTO bank_disbursement_items
          (disbursement_id, seq, transaction_type, account_id, description, amount, notes,
           purchase_document_id, wht_amount, wht_account_id, party_name,
           ppn_amount, ppn_account_id)
        VALUES
          (${disbId}, ${it.seq}, ${it.transaction_type}, ${it.account_id},
           ${it.description}, ${String(it.amount)}, ${it.notes},
           ${it.purchase_document_id ?? null},
           ${String(it.wht_amount)}, ${it.wht_account_id ?? null},
           ${it.party_name ?? null},
           ${String(it.ppn_amount)}, ${it.ppn_account_id ?? null})
      `);
    }

    // ── P0: Update source business object after disbursement ─────────────
    // Best-effort — disbursement is already created; errors are logged but not thrown.
    // P1: wrap this + postEntry + INSERT in a single db.transaction().
    {
      const txTypes = processedItems.map((it) => it.transaction_type);
      const sidValPost = sourceId ? Number(sourceId) : null;
      const smValPost  = sourceModule ? String(sourceModule) : null;
      if (sidValPost && smValPost) {
        await updateSourceAfterDisbursement({
          transactionTypes: txTypes,
          sourceModule: smValPost,
          sourceId: sidValPost,
          disbId,
          disbNumber: disbNum,
          amount: totalAmount,
          date,
          companyId,
        });
      }
    }

    // ── Phase 1: Trigger recalculate payment_status untuk linked POs ──────
    const linkedPOIds = processedItems
      .filter((it) => it.transaction_type === "supplier_payment" && it.purchase_document_id)
      .map((it) => it.purchase_document_id!);

    if (linkedPOIds.length > 0) {
      void recalculateBatchFromBankDisbursements(linkedPOIds).then((results) => {
        for (const r of results) {
          if (!r.ok) {
            logger.warn({ result: r, disbId }, "[bankDisbursements] recalculate PO payment_status gagal (non-fatal)");
          } else if (!r.unchanged) {
            logger.info({ result: r, disbId }, "[bankDisbursements] PO payment_status updated");
          }
        }
      }).catch((e) => logger.warn({ e, disbId }, "[bankDisbursements] recalculate batch error (non-fatal)"));
    }

    // ── Fetch and return created disbursement ─────────────────────────────
    const createdRows  = execRows<DisbRow>(await db.execute<DisbRow>(sql`
      SELECT * FROM bank_disbursements WHERE id = ${disbId}
    `));
    const createdItems = execRows<ItemRow>(await db.execute<ItemRow>(sql`
      SELECT * FROM bank_disbursement_items WHERE disbursement_id = ${disbId} ORDER BY seq
    `));

    logger.info(
      { disbId, disbNum, companyId, totalAmount, totalWht, bankCredit },
      "[bankDisbursements] Created",
    );

    // ── FASE 4 T006: Auto-capture WHT dan PPN Masukan sebagai transaction tax ──
    if (totalWht > 0) {
      const { recordTransactionTax } = await import("../lib/taxAutoService.js");
      void recordTransactionTax({
        companyId,
        transactionType: "purchase_order",
        transactionId: disbId,
        transactionRef: disbNum,
        baseAmount: totalAmount,
        taxAmount: totalWht,
        subType: "withholding_pph",
      }).catch((e) => logger.warn({ e, disbId }, "[tax] WHT capture direct error (non-fatal)"));
    }

    return res.status(201).json({
      ...serializeDisb(createdRows[0], createdItems),
      _meta: {
        totalAmount,
        totalWht,
        bankCredit,
        linkedPOIds,
      },
    });
  } catch (err) {
    const cause = (err as any)?.cause ?? err;
    logger.error({ err, cause }, "POST /accounting/bank-disbursements error");
    const pgMsg = (cause as any)?.message ?? "";
    let msg = "Gagal menyimpan pembayaran. Silakan coba lagi.";
    if (pgMsg.includes("vendor_invoices") || pgMsg.includes("amount_paid")) {
      msg = "Gagal memperbarui status invoice vendor. Periksa apakah invoice sudah lunas atau hubungi admin.";
    } else if (pgMsg.includes("accounting_entries") || pgMsg.includes("journal")) {
      msg = "Gagal membuat jurnal akuntansi. Periksa konfigurasi akun di Accounting > Settings.";
    }
    return res.status(500).json({ message: msg });
  }
});

// ── POST /:id/void  — void ────────────────────────────────────────────────────

router.post("/:id/void", async (req, res) => {
  try {
    const companyId = resolveCompanyId(req);
    const id = Number(req.params["id"]);
    if (!id) return res.status(400).json({ message: "Invalid id" });

    const rows = execRows<DisbRow>(await db.execute<DisbRow>(sql`
      SELECT * FROM bank_disbursements WHERE id = ${id} AND company_id = ${companyId}
    `));
    if (!rows[0]) return res.status(404).json({ message: "Tidak ditemukan" });
    if (rows[0].status === "voided") {
      return res.status(400).json({ message: "Disbursement sudah pernah di-void" });
    }

    const disb = rows[0];
    const voidReason = req.body?.reason ?? "Void oleh user";

    // ── Phase 1: Kumpulkan linked PO ids SEBELUM void ────────────────────
    // Dibutuhkan untuk trigger recalculate setelah void selesai.
    const itemsBeforeVoid = execRows<ItemRow>(await db.execute<ItemRow>(sql`
      SELECT * FROM bank_disbursement_items
      WHERE disbursement_id = ${id}
        AND transaction_type = 'supplier_payment'
        AND purchase_document_id IS NOT NULL
    `));
    const linkedPOIds = [
      ...new Set(
        itemsBeforeVoid
          .filter((it) => it.purchase_document_id != null)
          .map((it) => it.purchase_document_id!),
      ),
    ];

    // ── Create reversal journal entry ─────────────────────────────────────
    if (disb.entry_id) {
      const [origEntry] = await db
        .select()
        .from(accountingEntriesTable)
        .where(eq(accountingEntriesTable.id, disb.entry_id));

      if (origEntry) {
        const origLines = await db
          .select()
          .from(accountingEntryLinesTable)
          .where(eq(accountingEntryLinesTable.entryId, origEntry.id));

        const reversalLines = origLines.map((l) => ({
          accountId: l.accountId,
          debit: Number(l.credit),
          credit: Number(l.debit),
          description: `[VOID] ${l.description ?? ""}`,
        }));

        const [journal] = await db
          .select()
          .from(accountingJournalsTable)
          .where(eq(accountingJournalsTable.id, origEntry.journalId));

        const voidEntry = await postEntry(
          {
            journalId: origEntry.journalId,
            date: new Date(),
            ref: `VOID-${disb.disbursement_number ?? disb.id}`,
            description: `Pembatalan Disbursement ${disb.disbursement_number ?? disb.id}: ${voidReason}`,
            source: "reversal",
            companyId,
            lines: reversalLines,
          },
          journal?.code ?? "BNK",
        );

        await db.execute(sql`
          UPDATE bank_disbursements
          SET status = 'voided', void_entry_id = ${voidEntry.id}, void_reason = ${voidReason}
          WHERE id = ${id}
        `);
      }
    } else {
      await db.execute(sql`
        UPDATE bank_disbursements SET status = 'voided', void_reason = ${voidReason} WHERE id = ${id}
      `);
    }

    // ── Phase 1: Trigger recalculate untuk semua linked POs ──────────────
    // Setelah void, disbursement tidak lagi dihitung → payment_status mungkin turun.
    if (linkedPOIds.length > 0) {
      void recalculateBatchFromBankDisbursements(linkedPOIds).then((results) => {
        for (const r of results) {
          if (!r.ok) {
            logger.warn({ result: r, disbId: id }, "[bankDisbursements] recalculate PO setelah void gagal (non-fatal)");
          } else if (!r.unchanged) {
            logger.info({ result: r, disbId: id }, "[bankDisbursements] PO payment_status updated setelah void");
          }
        }
      }).catch((e) => logger.warn({ e, disbId: id }, "[bankDisbursements] recalculate batch setelah void error (non-fatal)"));
    }

    logger.info({ id, companyId, voidReason, linkedPOIds }, "[bankDisbursements] Voided");
    return res.json({ message: "Disbursement berhasil di-void", linkedPOsRecalculated: linkedPOIds });
  } catch (err) {
    logger.error({ err }, "POST /accounting/bank-disbursements/:id/void error");
    return res.status(500).json({ message: "Gagal void disbursement" });
  }
});

// ── Helpers ───────────────────────────────────────────────────────────────────

function typeLabel(type: string): string {
  const labels: Record<string, string> = {
    expense:          "Beban",
    supplier_payment: "Hutang Supplier",
    tax_payment:      "Pajak",
    employee_advance: "Kasbon Karyawan",
    fund_transfer:    "Transfer Dana",
    other:            "Lain-lain",
  };
  return labels[type] ?? type;
}

// ─────────────────────────────────────────────────────────────────────────────
// OCR Extract — POST /ocr-extract
// ─────────────────────────────────────────────────────────────────────────────
// POST /upload-attachment — upload bukti pembayaran ke Object Storage
// Returns { url } yang kemudian disertakan saat submit disbursement
// ─────────────────────────────────────────────────────────────────────────────

const bdAttachUpload = imagePdfUpload(10);

router.post(
  "/upload-attachment",
  bdAttachUpload.single("file"),
  async (req, res) => {
    try {
      const file = req.file;
      if (!file) return res.status(400).json({ message: "File wajib disertakan" });

      const { uploadToSupabase } = await import("../lib/supabaseStorage.js");
      const { publicUrl } = await uploadToSupabase(
        file.buffer,
        file.mimetype,
        "bank-disbursements",
      );

      return res.json({ url: publicUrl });
    } catch (err) {
      logger.error({ err }, "POST /accounting/bank-disbursements/upload-attachment error");
      return res.status(500).json({ message: "Gagal upload file" });
    }
  },
);

// Upload invoice/document → OpenAI Vision → structured BD data
// ─────────────────────────────────────────────────────────────────────────────

const _bdExecFileAsync = _bdPromisify(_bdExecFile);
const _bdRequire = _bdCreateRequire(import.meta.url);
type _BdPdfParseFn = (buffer: Buffer) => Promise<{ text: string; numpages: number }>;
const _bdPdfParse = _bdRequire("pdf-parse/lib/pdf-parse.js") as _BdPdfParseFn;
const bdOcrUpload = imagePdfUpload(20);

const BD_OCR_PROMPT = `You are an AI assistant extracting payment/disbursement data from an invoice or financial document.
The document may be in Indonesian or English.

RULES:
- Normalize all numbers to plain integers (remove dots/commas used as thousand separators).
  Example: "53.792.335" → 53792335 | "1,500,000" → 1500000
- Dates must be ISO format YYYY-MM-DD. "07 Juli 2025" → "2025-07-01"
  Indonesian months: Januari=01, Februari=02, Maret=03, April=04, Mei=05, Juni=06,
  Juli=07, Agustus=08, September=09, Oktober=10, November=11, Desember=12
- vendor_name = the ISSUING company/person (sender), NOT the recipient ("Kepada").
- total_amount = final grand total to be paid (after tax, after discount).
- If data is missing, use null. Do NOT guess.
- For line_items: extract individual service/product rows if visible. If not, create one row from the total.
- description: short summary of what is being paid (e.g. "Jasa Pengiriman Januari 2025", "Sewa Gudang Q1 2026")

OUTPUT FORMAT — strict JSON only, no markdown:
{
  "vendor_name": string | null,
  "invoice_number": string | null,
  "invoice_date": "YYYY-MM-DD" | null,
  "due_date": "YYYY-MM-DD" | null,
  "currency": "IDR" | "USD" | "OTHER" | null,
  "total_amount": number | null,
  "description": string | null,
  "line_items": [
    {
      "description": string | null,
      "amount": number | null
    }
  ],
  "confidence": number
}`;

const BD_OCR_PDF_MIN_CHARS = 200;
const BD_OCR_PDF_MAX_CHARS = 6000;

function _bdCleanPdfText(raw: string): string {
  const STOP_HEADERS = ["terms and conditions", "syarat dan ketentuan", "terms & conditions", "ketentuan umum", "disclaimer", "governing law"];
  const lines = raw.split("\n");
  const kept: string[] = [];
  for (const line of lines) {
    const lower = line.trim().toLowerCase();
    if (STOP_HEADERS.some(h => lower === h || lower.startsWith(h + ":"))) break;
    if (/^[-_.=*]{4,}\s*$/.test(line.trim())) continue;
    kept.push(line);
  }
  return kept.join("\n").replace(/\n{3,}/g, "\n\n").trim().slice(0, BD_OCR_PDF_MAX_CHARS);
}

router.post("/ocr-extract", bdOcrUpload.single("file"), async (req, res): Promise<void> => {
  const file = req.file;
  if (!file) {
    res.status(400).json({ error: "File tidak dilampirkan" });
    return;
  }

  const isPdf = file.mimetype === "application/pdf" || file.originalname.toLowerCase().endsWith(".pdf");
  const isImage = file.mimetype.startsWith("image/");

  if (!isPdf && !isImage) {
    res.status(400).json({ error: "Hanya menerima file PDF atau gambar (JPG, PNG, WEBP)" });
    return;
  }

  const openai = getOpenAI();

  try {
    let extracted: unknown;

    if (isPdf) {
      let pdfText = "";
      let pdfOk = false;
      try {
        const parsed = await _bdPdfParse(file.buffer);
        pdfText = parsed.text ?? "";
        pdfOk = true;
      } catch { /* fallback to vision */ }

      const cleaned = pdfOk ? _bdCleanPdfText(pdfText) : "";
      const useVision = cleaned.length < BD_OCR_PDF_MIN_CHARS;

      if (!useVision) {
        const completion = await openai.chat.completions.create({
          model: "gpt-4o-mini",
          max_tokens: 1500,
          response_format: { type: "json_object" },
          messages: [
            { role: "system", content: BD_OCR_PROMPT },
            { role: "user", content: `Extract payment data from this document text:\n\n${cleaned}` },
          ],
        });
        extracted = JSON.parse(completion.choices[0]?.message?.content ?? "{}");
      } else {
        const tmpDir = await _bdFs.mkdtemp(_bdPath.join(_bdOs.tmpdir(), "bd-ocr-"));
        const pdfPath = _bdPath.join(tmpDir, "doc.pdf");
        const pngPrefix = _bdPath.join(tmpDir, "page");
        try {
          await _bdFs.writeFile(pdfPath, file.buffer);
          await _bdExecFileAsync("pdftoppm", ["-f", "1", "-l", "1", "-r", "150", "-png", "-singlefile", pdfPath, pngPrefix]);
          const pngBuffer = await _bdFs.readFile(`${pngPrefix}.png`);
          const b64 = pngBuffer.toString("base64");
          const completion = await openai.chat.completions.create({
            model: "gpt-4o",
            max_tokens: 1500,
            response_format: { type: "json_object" },
            messages: [
              { role: "system", content: BD_OCR_PROMPT },
              {
                role: "user",
                content: [
                  { type: "text", text: "Extract payment data from this document image:" },
                  { type: "image_url", image_url: { url: `data:image/png;base64,${b64}`, detail: "high" } },
                ],
              },
            ],
          });
          extracted = JSON.parse(completion.choices[0]?.message?.content ?? "{}");
        } finally {
          await _bdFs.rm(tmpDir, { recursive: true, force: true }).catch(() => {});
        }
      }
    } else {
      const b64 = file.buffer.toString("base64");
      const completion = await openai.chat.completions.create({
        model: "gpt-4o",
        max_tokens: 1500,
        response_format: { type: "json_object" },
        messages: [
          { role: "system", content: BD_OCR_PROMPT },
          {
            role: "user",
            content: [
              { type: "text", text: "Extract payment data from this document image:" },
              { type: "image_url", image_url: { url: `data:${file.mimetype};base64,${b64}`, detail: "high" } },
            ],
          },
        ],
      });
      extracted = JSON.parse(completion.choices[0]?.message?.content ?? "{}");
    }

    logger.info({ extracted }, "[bdOcr] extraction complete");
    res.json({ ok: true, data: extracted });
  } catch (err) {
    logger.error({ err }, "[bdOcr] extraction error");
    res.status(500).json({ error: "Gagal mengekstrak dokumen", detail: String(err) });
  }
});

export default router;
