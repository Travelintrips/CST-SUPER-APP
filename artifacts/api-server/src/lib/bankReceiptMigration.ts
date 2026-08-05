import { db } from "@workspace/db";
import { sql } from "drizzle-orm";
import { logger } from "./logger.js";

/**
 * Idempotent migration untuk Bank Receipt multi-line.
 * Bank Receipt = kebalikan Bank Disbursement: uang masuk ke rekening bank/kas.
 *
 * Jurnal otomatis:
 *   DR [Bank/Kas]        total   ← jurnal bank yang dipilih
 *   CR [akun per item]   xxx     ← piutang, pendapatan, setoran modal, dll.
 */
export async function runBankReceiptMigration(): Promise<void> {
  await db.execute(sql`
    CREATE TABLE IF NOT EXISTS bank_receipts (
      id              SERIAL PRIMARY KEY,
      company_id      INTEGER,
      receipt_number  TEXT,
      journal_id      INTEGER NOT NULL REFERENCES accounting_journals(id) ON DELETE RESTRICT,
      date            DATE NOT NULL,
      ref             TEXT,
      memo            TEXT,
      total_amount    NUMERIC(14,2) NOT NULL DEFAULT 0,
      status          TEXT NOT NULL DEFAULT 'posted',
      entry_id        INTEGER REFERENCES accounting_entries(id) ON DELETE SET NULL,
      void_entry_id   INTEGER REFERENCES accounting_entries(id) ON DELETE SET NULL,
      void_reason     TEXT,
      created_by_id   TEXT,
      created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `).catch(() => {});

  await db.execute(sql`
    CREATE TABLE IF NOT EXISTS bank_receipt_items (
      id              SERIAL PRIMARY KEY,
      receipt_id      INTEGER NOT NULL REFERENCES bank_receipts(id) ON DELETE CASCADE,
      seq             INTEGER NOT NULL DEFAULT 1,
      receipt_type    TEXT NOT NULL DEFAULT 'other',
      account_id      INTEGER REFERENCES chart_of_accounts(id) ON DELETE RESTRICT,
      description     TEXT,
      amount          NUMERIC(14,2) NOT NULL DEFAULT 0,
      notes           TEXT
    )
  `).catch(() => {});

  await db.execute(sql`
    CREATE INDEX IF NOT EXISTS bank_receipts_company_idx ON bank_receipts(company_id)
  `).catch(() => {});
  await db.execute(sql`
    CREATE INDEX IF NOT EXISTS bank_receipts_date_idx ON bank_receipts(date)
  `).catch(() => {});
  await db.execute(sql`
    CREATE INDEX IF NOT EXISTS bank_receipts_status_idx ON bank_receipts(status)
  `).catch(() => {});
  await db.execute(sql`
    CREATE INDEX IF NOT EXISTS bank_receipt_items_receipt_idx ON bank_receipt_items(receipt_id)
  `).catch(() => {});

  // Phase 2 — link ke AR subledger untuk pelunasan piutang
  await db.execute(sql`
    ALTER TABLE bank_receipt_items
      ADD COLUMN IF NOT EXISTS ar_invoice_id INTEGER
  `).catch(() => {});

  await db.execute(sql`
    CREATE INDEX IF NOT EXISTS bank_receipt_items_ar_idx ON bank_receipt_items(ar_invoice_id)
      WHERE ar_invoice_id IS NOT NULL
  `).catch(() => {});

  // ── Phase 3 columns — counterparty identity (header) ─────────────────────
  // counterparty_name: nama pelanggan / pengirim uang (teks bebas, tidak harus FK)
  await db.execute(sql`
    ALTER TABLE bank_receipts
      ADD COLUMN IF NOT EXISTS counterparty_name TEXT
  `).catch(() => {});

  // counterparty_type: kategori pihak — 'customer', 'shareholder', 'bank', 'government', 'other'
  await db.execute(sql`
    ALTER TABLE bank_receipts
      ADD COLUMN IF NOT EXISTS counterparty_type TEXT
  `).catch(() => {});

  // counterparty_id: opsional FK ke contacts/customer (untuk lookup otomatis dari dokumen AR)
  await db.execute(sql`
    ALTER TABLE bank_receipts
      ADD COLUMN IF NOT EXISTS counterparty_id INTEGER
  `).catch(() => {});

  // ── Phase 3 columns — party name per line item ────────────────────────────
  // party_name: nama pihak spesifik per baris — penting untuk multi-item
  // (misal: equity_injection dari beberapa pemegang saham dalam satu receipt,
  //  atau loan_receipt dari beberapa kreditur sekaligus)
  await db.execute(sql`
    ALTER TABLE bank_receipt_items
      ADD COLUMN IF NOT EXISTS party_name TEXT
  `).catch(() => {});

  logger.info("[bankReceiptMigration] Bank receipt tables ready (Phase 3)");
}
