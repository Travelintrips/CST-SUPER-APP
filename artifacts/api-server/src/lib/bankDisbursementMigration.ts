import { db } from "@workspace/db";
import { sql } from "drizzle-orm";
import { logger } from "./logger.js";

/**
 * Idempotent migration untuk Bank Disbursement multi-line.
 * Membuat tabel bank_disbursements (header) dan bank_disbursement_items (line items).
 * Setiap disbursement bisa punya banyak item dengan jenis transaksi berbeda.
 *
 * Phase 1 additions (2026-06-28):
 *   - bank_disbursement_items.purchase_document_id  → link ke PO untuk auto-update payment_status
 *   - bank_disbursement_items.wht_amount            → potongan pajak (WHT) per item
 *   - bank_disbursement_items.wht_account_id        → akun Hutang Pajak/WHT per item
 */
export async function runBankDisbursementMigration(): Promise<void> {
  // ── Header table ─────────────────────────────────────────────────────────
  await db.execute(sql`
    CREATE TABLE IF NOT EXISTS bank_disbursements (
      id                   SERIAL PRIMARY KEY,
      company_id           INTEGER,
      disbursement_number  TEXT,
      journal_id           INTEGER NOT NULL REFERENCES accounting_journals(id) ON DELETE RESTRICT,
      date                 DATE NOT NULL,
      ref                  TEXT,
      memo                 TEXT,
      total_amount         NUMERIC(14,2) NOT NULL DEFAULT 0,
      status               TEXT NOT NULL DEFAULT 'posted',
      entry_id             INTEGER REFERENCES accounting_entries(id) ON DELETE SET NULL,
      void_entry_id        INTEGER REFERENCES accounting_entries(id) ON DELETE SET NULL,
      void_reason          TEXT,
      created_by_id        TEXT,
      created_at           TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `).catch(() => {});

  // ── Line items table ──────────────────────────────────────────────────────
  await db.execute(sql`
    CREATE TABLE IF NOT EXISTS bank_disbursement_items (
      id               SERIAL PRIMARY KEY,
      disbursement_id  INTEGER NOT NULL REFERENCES bank_disbursements(id) ON DELETE CASCADE,
      seq              INTEGER NOT NULL DEFAULT 1,
      transaction_type TEXT NOT NULL DEFAULT 'other',
      account_id       INTEGER REFERENCES chart_of_accounts(id) ON DELETE RESTRICT,
      description      TEXT,
      amount           NUMERIC(14,2) NOT NULL DEFAULT 0,
      notes            TEXT
    )
  `).catch(() => {});

  // ── Phase 1 columns (idempotent ALTER) ────────────────────────────────────
  // purchase_document_id: link ke purchase_documents.id untuk supplier_payment items
  await db.execute(sql`
    ALTER TABLE bank_disbursement_items
      ADD COLUMN IF NOT EXISTS purchase_document_id INTEGER
  `).catch(() => {});

  // wht_amount: jumlah pajak yang dipotong (Withholding Tax), default 0
  await db.execute(sql`
    ALTER TABLE bank_disbursement_items
      ADD COLUMN IF NOT EXISTS wht_amount NUMERIC(14,2) NOT NULL DEFAULT 0
  `).catch(() => {});

  // wht_account_id: akun COA tujuan WHT (Hutang Pajak / WHT Payable)
  await db.execute(sql`
    ALTER TABLE bank_disbursement_items
      ADD COLUMN IF NOT EXISTS wht_account_id INTEGER REFERENCES chart_of_accounts(id) ON DELETE SET NULL
  `).catch(() => {});

  // ── Indexes ───────────────────────────────────────────────────────────────
  await db.execute(sql`
    CREATE INDEX IF NOT EXISTS bank_disbursements_company_idx ON bank_disbursements(company_id)
  `).catch(() => {});
  await db.execute(sql`
    CREATE INDEX IF NOT EXISTS bank_disbursements_date_idx ON bank_disbursements(date)
  `).catch(() => {});
  await db.execute(sql`
    CREATE INDEX IF NOT EXISTS bank_disbursements_status_idx ON bank_disbursements(status)
  `).catch(() => {});
  await db.execute(sql`
    CREATE INDEX IF NOT EXISTS bank_disbursement_items_disb_idx ON bank_disbursement_items(disbursement_id)
  `).catch(() => {});
  // Phase 1: index untuk lookup per PO
  await db.execute(sql`
    CREATE INDEX IF NOT EXISTS bank_disbursement_items_po_idx ON bank_disbursement_items(purchase_document_id)
      WHERE purchase_document_id IS NOT NULL
  `).catch(() => {});

  // ── Phase 2 columns — source tracking (header-level) ─────────────────────
  // source_module: e.g. 'payment_request', 'bills_payment'
  await db.execute(sql`
    ALTER TABLE bank_disbursements
      ADD COLUMN IF NOT EXISTS source_module TEXT
  `).catch(() => {});

  // source_id: PK of the originating record (e.g. payment_request.id)
  await db.execute(sql`
    ALTER TABLE bank_disbursements
      ADD COLUMN IF NOT EXISTS source_id INTEGER
  `).catch(() => {});

  // source_number: human-readable reference (e.g. PAY/2026/0001)
  await db.execute(sql`
    ALTER TABLE bank_disbursements
      ADD COLUMN IF NOT EXISTS source_number TEXT
  `).catch(() => {});

  await db.execute(sql`
    CREATE INDEX IF NOT EXISTS bank_disbursements_source_idx
      ON bank_disbursements(source_module, source_id)
      WHERE source_module IS NOT NULL
  `).catch(() => {});

  // ── Phase 3 columns — payment type + invoice tracking ────────────────────
  // payment_type: 'direct' = pengeluaran langsung (existing); 'vendor_invoice' = bayar AP invoice
  await db.execute(sql`
    ALTER TABLE bank_disbursements
      ADD COLUMN IF NOT EXISTS payment_type TEXT NOT NULL DEFAULT 'direct'
  `).catch(() => {});

  // invoice_number: no. invoice vendor untuk referensi di line item
  await db.execute(sql`
    ALTER TABLE bank_disbursement_items
      ADD COLUMN IF NOT EXISTS invoice_number TEXT
  `).catch(() => {});

  await db.execute(sql`
    CREATE INDEX IF NOT EXISTS bank_disbursement_items_invoice_idx
      ON bank_disbursement_items(invoice_number)
      WHERE invoice_number IS NOT NULL
  `).catch(() => {});

  // ── Phase 4 columns — counterparty identity (header) ─────────────────────
  // counterparty_name: nama vendor / penerima pembayaran (teks bebas, tidak harus FK)
  await db.execute(sql`
    ALTER TABLE bank_disbursements
      ADD COLUMN IF NOT EXISTS counterparty_name TEXT
  `).catch(() => {});

  // counterparty_type: kategori pihak — 'vendor', 'employee', 'bank', 'government', 'other'
  await db.execute(sql`
    ALTER TABLE bank_disbursements
      ADD COLUMN IF NOT EXISTS counterparty_type TEXT
  `).catch(() => {});

  // counterparty_id: opsional FK ke contacts/vendor (untuk lookup otomatis dari dokumen)
  await db.execute(sql`
    ALTER TABLE bank_disbursements
      ADD COLUMN IF NOT EXISTS counterparty_id INTEGER
  `).catch(() => {});

  // ── Phase 4 columns — party name per line item ────────────────────────────
  // party_name: nama pihak spesifik per baris — penting untuk multi-item
  // (misal: employee_advance dengan beberapa karyawan berbeda dalam satu disbursement)
  await db.execute(sql`
    ALTER TABLE bank_disbursement_items
      ADD COLUMN IF NOT EXISTS party_name TEXT
  `).catch(() => {});

  // ── Phase 5 columns — attachment / bukti pembayaran ─────────────────────
  // attachment_url: URL public dari Replit Object Storage (image/PDF bukti transfer)
  await db.execute(sql`
    ALTER TABLE bank_disbursements
      ADD COLUMN IF NOT EXISTS attachment_url TEXT
  `).catch(() => {});

  // ── Phase 6 columns — vendor_invoice_id link ──────────────────────────────
  // vendor_invoice_id: FK ke vendor_invoices.id untuk standalone invoice (bukan PO flow)
  await db.execute(sql`
    ALTER TABLE bank_disbursement_items
      ADD COLUMN IF NOT EXISTS vendor_invoice_id INTEGER
  `).catch(() => {});

  await db.execute(sql`
    CREATE INDEX IF NOT EXISTS bank_disbursement_items_vi_idx
      ON bank_disbursement_items(vendor_invoice_id)
      WHERE vendor_invoice_id IS NOT NULL
  `).catch(() => {});

  // ── Phase 7 columns — PPN (VAT) per line item ────────────────────────────
  // ppn_amount: jumlah PPN Masukan (Input VAT) per item, default 0
  await db.execute(sql`
    ALTER TABLE bank_disbursement_items
      ADD COLUMN IF NOT EXISTS ppn_amount NUMERIC(14,2) NOT NULL DEFAULT 0
  `).catch(() => {});

  // ppn_account_id: akun COA tujuan PPN Masukan (biasanya tipe asset)
  await db.execute(sql`
    ALTER TABLE bank_disbursement_items
      ADD COLUMN IF NOT EXISTS ppn_account_id INTEGER REFERENCES chart_of_accounts(id) ON DELETE SET NULL
  `).catch(() => {});

  // ── Phase 8 — Expense ↔ Bank Disbursement bridge (2026-07-06) ────────────
  // Bridge FKs, nullable, additive-only. Does NOT merge tables — expenses
  // tetap sumber pencatatan beban, bank_disbursements tetap modul pembayaran.
  //
  // expense_id: FK opsional dari header disbursement ke expenses.id.
  // Nullable karena tidak semua disbursement berasal dari expense
  // (vendor_invoice mode, PO flow, dll tetap tidak terpengaruh).
  await db.execute(sql`
    ALTER TABLE bank_disbursements
      ADD COLUMN IF NOT EXISTS expense_id INTEGER REFERENCES expenses(id) ON DELETE SET NULL
  `).catch(() => {});

  await db.execute(sql`
    CREATE INDEX IF NOT EXISTS bank_disbursements_expense_idx
      ON bank_disbursements(expense_id)
      WHERE expense_id IS NOT NULL
  `).catch(() => {});

  // Partial unique index: satu expense hanya boleh punya SATU disbursement
  // aktif (non-voided) yang menunjuknya. Ini adalah guard DB-level terhadap
  // double-pay, terlepas dari validasi di application layer.
  await db.execute(sql`
    CREATE UNIQUE INDEX IF NOT EXISTS bank_disbursements_expense_active_uidx
      ON bank_disbursements(expense_id)
      WHERE expense_id IS NOT NULL AND status <> 'voided'
  `).catch(() => {});

  logger.info("[bankDisbursementMigration] Bank disbursement tables ready (Phase 8 — expense bridge)");
}

/**
 * Idempotent migration untuk kolom bridge di sisi expenses (Phase 8, 2026-07-06).
 * expenses.disbursement_id: FK opsional ke bank_disbursements.id — diisi
 * setelah expense dibayar melalui modul Bank Disbursement. Tidak menghapus
 * atau mengubah kolom lain; tidak ada data yang di-drop.
 */
export async function runExpenseDisbursementBridgeMigration(): Promise<void> {
  await db.execute(sql`
    ALTER TABLE expenses
      ADD COLUMN IF NOT EXISTS disbursement_id INTEGER REFERENCES bank_disbursements(id) ON DELETE SET NULL
  `).catch(() => {});

  await db.execute(sql`
    CREATE INDEX IF NOT EXISTS expenses_disbursement_idx
      ON expenses(disbursement_id)
      WHERE disbursement_id IS NOT NULL
  `).catch(() => {});

  logger.info("[bankDisbursementMigration] Expense bridge column ready (disbursement_id)");
}
