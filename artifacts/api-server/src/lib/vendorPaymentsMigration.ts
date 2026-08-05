import { db } from "@workspace/db";
import { sql } from "drizzle-orm";
import { logger } from "./logger.js";

/**
 * Idempotent migration untuk tabel vendor_payments.
 *
 * Modul ini sudah deprecated sebagai executor (Phase 3) —
 * POST /api/vendor-payments mengembalikan HTTP 410.
 * Tabel dipertahankan untuk data historis (GET read-only tetap aktif).
 *
 * Migration ini dipanggil saat startup agar tabel selalu ada
 * sebelum request masuk, bukan menunggu endpoint pertama dipanggil.
 */
export async function runVendorPaymentsMigration(): Promise<void> {
  // ── Tabel utama — let errors propagate so runWithRetry() can retry ────────
  await db.execute(sql`
    CREATE TABLE IF NOT EXISTS vendor_payments (
      id                   SERIAL PRIMARY KEY,
      company_id           INTEGER,
      payment_number       TEXT NOT NULL UNIQUE,
      supplier_id          INTEGER,
      vendor_name          TEXT NOT NULL,
      payment_date         DATE NOT NULL,
      amount               NUMERIC(14,2) NOT NULL,
      payment_method       TEXT NOT NULL DEFAULT 'bank',
      reference            TEXT,
      purchase_document_id INTEGER,
      bank_account_id      INTEGER,
      status               TEXT NOT NULL DEFAULT 'paid',
      journal_entry_id     INTEGER,
      notes                TEXT,
      created_by_id        TEXT,
      created_at           TIMESTAMPTZ DEFAULT NOW(),
      updated_at           TIMESTAMPTZ DEFAULT NOW()
    )
  `);

  // ── Phase 1 columns (idempotent ALTER) ────────────────────────────────────
  await db.execute(sql`
    ALTER TABLE vendor_payments ADD COLUMN IF NOT EXISTS wht_amount NUMERIC(14,2) NOT NULL DEFAULT 0
  `).catch(() => {});

  await db.execute(sql`
    ALTER TABLE vendor_payments ADD COLUMN IF NOT EXISTS wht_account_id INTEGER
  `).catch(() => {});

  // ── Indexes ───────────────────────────────────────────────────────────────
  await db.execute(sql`
    CREATE INDEX IF NOT EXISTS vendor_payments_company_idx ON vendor_payments(company_id)
  `).catch(() => {});

  await db.execute(sql`
    CREATE INDEX IF NOT EXISTS vendor_payments_supplier_idx ON vendor_payments(supplier_id)
  `).catch(() => {});

  await db.execute(sql`
    CREATE INDEX IF NOT EXISTS vendor_payments_date_idx ON vendor_payments(payment_date)
  `).catch(() => {});

  logger.info("[vendorPaymentsMigration] vendor_payments table ready (historical read-only, Phase 3)");
}
