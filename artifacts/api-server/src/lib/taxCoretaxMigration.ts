/**
 * taxCoretaxMigration.ts — Fase 4 Compliance Gap C7
 *
 * Additive only — tidak menghapus kolom/tabel lama.
 *
 * Menambahkan ke transaction_taxes:
 *   invoice_date  — tanggal dokumen sumber (invoice/DO)
 *   faktur_date   — tanggal faktur pajak diterbitkan (Coretax requirement)
 *
 * Menambahkan ke customers:
 *   nik           — NIK pemilik/PIC untuk lawan transaksi individu
 */

import { db } from "@workspace/db";
import { sql } from "drizzle-orm";
import { logger } from "./logger.js";

export async function runTaxCoretaxMigration(): Promise<void> {
  // ── A. transaction_taxes: invoice_date ────────────────────────────────────
  await db.execute(sql`
    ALTER TABLE transaction_taxes
    ADD COLUMN IF NOT EXISTS invoice_date DATE
  `);

  // ── B. transaction_taxes: faktur_date ─────────────────────────────────────
  await db.execute(sql`
    ALTER TABLE transaction_taxes
    ADD COLUMN IF NOT EXISTS faktur_date DATE
  `);

  // ── C. customers: nik ─────────────────────────────────────────────────────
  await db.execute(sql`
    ALTER TABLE customers
    ADD COLUMN IF NOT EXISTS nik TEXT
  `);

  logger.info("[taxCoretaxMigration] Selesai — invoice_date, faktur_date, nik (customers) ditambahkan");
}
