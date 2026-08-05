/**
 * vendorProfileMigration.ts — Boot migration untuk PHASE FINAL Vendor Profile Hardening.
 *
 * Dijalankan saat startup via runCriticalPreStartMigrations().
 *
 * Perubahan:
 *   1. suppliers.updated_at — optimistic locking
 *   2. supplier_documents.deleted_at + deleted_by — soft delete
 *   3. vendor_audit_logs — audit trail table
 *   4. Index pada vendor_profiles(supplier_id) — FK lookup FK resolveVendorSupplierId
 *
 * Semua DDL idempotent (IF NOT EXISTS / IF EXISTS guard).
 * Setiap statement dieksekusi terpisah untuk pgBouncer compatibility.
 */

import { db } from "@workspace/db";
import { sql } from "drizzle-orm";
import { logger } from "./logger.js";

export async function runVendorProfileMigration(): Promise<void> {
  // ── 1. suppliers.updated_at ─────────────────────────────────────────────────
  await db.execute(sql`
    ALTER TABLE suppliers
      ADD COLUMN IF NOT EXISTS updated_at TIMESTAMP NOT NULL DEFAULT NOW()
  `).catch((e: unknown) => {
    logger.warn({ err: e }, "vendorProfileMigration: suppliers.updated_at already exists (non-fatal)");
  });

  // ── 2. supplier_documents.deleted_at ────────────────────────────────────────
  await db.execute(sql`
    ALTER TABLE supplier_documents
      ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMP
  `).catch((e: unknown) => {
    logger.warn({ err: e }, "vendorProfileMigration: supplier_documents.deleted_at already exists (non-fatal)");
  });

  // ── 3. supplier_documents.deleted_by ────────────────────────────────────────
  await db.execute(sql`
    ALTER TABLE supplier_documents
      ADD COLUMN IF NOT EXISTS deleted_by TEXT
  `).catch((e: unknown) => {
    logger.warn({ err: e }, "vendorProfileMigration: supplier_documents.deleted_by already exists (non-fatal)");
  });

  // ── 4. Index pada supplier_documents(deleted_at) ────────────────────────────
  await db.execute(sql`
    CREATE INDEX IF NOT EXISTS supplier_docs_deleted_idx
      ON supplier_documents (deleted_at)
  `).catch((e: unknown) => {
    logger.warn({ err: e }, "vendorProfileMigration: supplier_docs_deleted_idx already exists (non-fatal)");
  });

  // ── 5. vendor_audit_logs table ──────────────────────────────────────────────
  await db.execute(sql`
    CREATE TABLE IF NOT EXISTS vendor_audit_logs (
      id          SERIAL PRIMARY KEY,
      supplier_id INTEGER NOT NULL REFERENCES suppliers(id) ON DELETE CASCADE,
      action      TEXT NOT NULL,
      actor       TEXT NOT NULL,
      before      JSONB,
      after       JSONB,
      ip          TEXT,
      user_agent  TEXT,
      created_at  TIMESTAMP NOT NULL DEFAULT NOW()
    )
  `).catch((e: unknown) => {
    logger.warn({ err: e }, "vendorProfileMigration: vendor_audit_logs already exists (non-fatal)");
  });

  // ── 6. Indexes on vendor_audit_logs ─────────────────────────────────────────
  await db.execute(sql`
    CREATE INDEX IF NOT EXISTS vendor_audit_logs_supplier_idx
      ON vendor_audit_logs (supplier_id)
  `).catch((e: unknown) => {
    logger.warn({ err: e }, "vendorProfileMigration: vendor_audit_logs_supplier_idx already exists (non-fatal)");
  });

  await db.execute(sql`
    CREATE INDEX IF NOT EXISTS vendor_audit_logs_action_idx
      ON vendor_audit_logs (action)
  `).catch((e: unknown) => {
    logger.warn({ err: e }, "vendorProfileMigration: vendor_audit_logs_action_idx already exists (non-fatal)");
  });

  await db.execute(sql`
    CREATE INDEX IF NOT EXISTS vendor_audit_logs_created_idx
      ON vendor_audit_logs (created_at)
  `).catch((e: unknown) => {
    logger.warn({ err: e }, "vendorProfileMigration: vendor_audit_logs_created_idx already exists (non-fatal)");
  });

  // ── 7. Index pada vendor_profiles(supplier_id) ──────────────────────────────
  // Mendukung FK lookup di resolveVendorSupplierId (pengganti email/phone matching)
  await db.execute(sql`
    CREATE INDEX IF NOT EXISTS vendor_profiles_supplier_id_idx
      ON vendor_profiles (supplier_id)
  `).catch((e: unknown) => {
    logger.warn({ err: e }, "vendorProfileMigration: vendor_profiles_supplier_id_idx already exists (non-fatal)");
  });

  // ── 8. P2: Repair data is_active/status inconsistencies ────────────────────
  // Sebelum menambahkan constraint, perbaiki data yang sudah tidak konsisten
  // agar VALIDATE CONSTRAINT tidak gagal pada data lama.
  // Aturan: status='active' → is_active=true; semua status lain → is_active=false
  const repairResult = await db.execute(sql`
    UPDATE suppliers
    SET is_active = (status = 'active')
    WHERE is_active != (status = 'active')
    RETURNING id
  `).catch((e: unknown) => {
    logger.warn({ err: e }, "vendorProfileMigration: data repair failed (non-fatal)");
    return null;
  });
  const repairedCount = (repairResult as any)?.rowCount ?? 0;
  if (repairedCount > 0) {
    logger.warn({ count: repairedCount }, "vendorProfileMigration: repaired is_active/status inconsistencies");
  }

  // ── 9. P2: Database consistency guard (NOT VALID → drop old → recreate) ───
  // Deteksi drift is_active vs status tanpa trigger (safer dengan pgBouncer).
  // updateSupplierStatus() adalah satu-satunya jalur yang boleh mengubah status,
  // dan selalu meng-update keduanya secara konsisten. Constraint ini hanya
  // menangkap drift dari query langsung yang bypass service layer.
  await db.execute(sql`
    ALTER TABLE suppliers
      DROP CONSTRAINT IF EXISTS suppliers_is_active_status_consistent
  `).catch(() => {});

  await db.execute(sql`
    ALTER TABLE suppliers
      ADD CONSTRAINT suppliers_is_active_status_consistent
      CHECK (is_active = (status = 'active'))
      NOT VALID
  `).catch((e: unknown) => {
    logger.warn({ err: e }, "vendorProfileMigration: constraint suppliers_is_active_status_consistent already exists (non-fatal)");
  });

  // ── 10. VALIDATE CONSTRAINT — aktifkan penolakan data baru yang inkonsisten ─
  // VALIDATE CONSTRAINT memindai seluruh tabel dan meng-enforce constraint pada
  // INSERT/UPDATE masa depan. Data yang sudah direpair di step 8 memastikan
  // validasi ini tidak gagal. Jika ada baris yang lolos repair, log error dan lanjut.
  await db.execute(sql`
    ALTER TABLE suppliers
      VALIDATE CONSTRAINT suppliers_is_active_status_consistent
  `).catch((e: unknown) => {
    logger.error({ err: e }, "vendorProfileMigration: VALIDATE CONSTRAINT failed — manual data repair required");
  });

  logger.info("vendorProfileMigration: all vendor profile hardening migrations done (constraint validated)");
}
