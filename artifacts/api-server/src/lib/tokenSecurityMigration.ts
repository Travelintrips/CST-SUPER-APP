/**
 * Token Security Migration — Security Patch P1
 *
 * Menambahkan kolom-kolom keamanan yang hilang dari tabel token yang ada,
 * dan membuat tabel audit log token_access_log.
 *
 * Semua operasi idempotent (ADD COLUMN IF NOT EXISTS / CREATE TABLE IF NOT EXISTS).
 */

import { db } from "@workspace/db";
import { sql } from "drizzle-orm";
import { logger } from "./logger.js";

let migrationDone = false;

export async function runTokenSecurityMigration(): Promise<void> {
  if (migrationDone) return;
  try {
    // ── 1. Audit log table ───────────────────────────────────────────────────
    await db.execute(sql`
      CREATE TABLE IF NOT EXISTS token_access_log (
        id           SERIAL PRIMARY KEY,
        token_type   TEXT NOT NULL,
        token_ref    TEXT NOT NULL,
        entity_id    TEXT,
        action       TEXT NOT NULL,
        outcome      TEXT NOT NULL DEFAULT 'ok',
        ip_address   TEXT,
        user_agent   TEXT,
        created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )
    `);
    await db.execute(sql`
      CREATE INDEX IF NOT EXISTS tal_token_ref_idx ON token_access_log(token_ref)
    `);
    await db.execute(sql`
      CREATE INDEX IF NOT EXISTS tal_created_at_idx ON token_access_log(created_at)
    `);

    // ── 2. admin_action_links → tambah revoked_at ────────────────────────────
    await db.execute(sql`
      ALTER TABLE admin_action_links
        ADD COLUMN IF NOT EXISTS revoked_at TIMESTAMPTZ
    `);

    // ── 3. customer_approvals → tambah used_at, revoked_at ──────────────────
    await db.execute(sql`
      ALTER TABLE customer_approvals
        ADD COLUMN IF NOT EXISTS used_at TIMESTAMPTZ
    `);
    await db.execute(sql`
      ALTER TABLE customer_approvals
        ADD COLUMN IF NOT EXISTS revoked_at TIMESTAMPTZ
    `);

    // ── 4. customer_invoice_links → tambah revoked_at, last_accessed_at, access_count
    await db.execute(sql`
      ALTER TABLE customer_invoice_links
        ADD COLUMN IF NOT EXISTS revoked_at TIMESTAMPTZ
    `);
    await db.execute(sql`
      ALTER TABLE customer_invoice_links
        ADD COLUMN IF NOT EXISTS last_accessed_at TIMESTAMPTZ
    `);
    await db.execute(sql`
      ALTER TABLE customer_invoice_links
        ADD COLUMN IF NOT EXISTS access_count INTEGER NOT NULL DEFAULT 0
    `);

    // ── 5. vendor_fulfillment_links → tambah revoked_at ─────────────────────
    await db.execute(sql`
      ALTER TABLE vendor_fulfillment_links
        ADD COLUMN IF NOT EXISTS revoked_at TIMESTAMPTZ
    `);

    // ── 6. order_task_links → tambah revoked_at ─────────────────────────────
    await db.execute(sql`
      ALTER TABLE order_task_links
        ADD COLUMN IF NOT EXISTS revoked_at TIMESTAMPTZ
    `);

    // ── 7. customer_order_links → tambah expires_at, revoked_at ─────────────
    await db.execute(sql`
      ALTER TABLE customer_order_links
        ADD COLUMN IF NOT EXISTS expires_at TIMESTAMPTZ
    `);
    await db.execute(sql`
      ALTER TABLE customer_order_links
        ADD COLUMN IF NOT EXISTS revoked_at TIMESTAMPTZ
    `);

    // ── 8. customer_quote_links → tambah revoked_at ──────────────────────────
    await db.execute(sql`
      ALTER TABLE customer_quote_links
        ADD COLUMN IF NOT EXISTS revoked_at TIMESTAMPTZ
    `);

    // ── 9. air_freight_orders → tambah approval_token_expires_at ────────────
    await db.execute(sql`
      ALTER TABLE air_freight_orders
        ADD COLUMN IF NOT EXISTS approval_token_expires_at TIMESTAMPTZ
    `);
    // Backfill: order yang sudah ada diberi expiry 90 hari dari sekarang
    await db.execute(sql`
      UPDATE air_freight_orders
      SET approval_token_expires_at = NOW() + INTERVAL '90 days'
      WHERE approval_token IS NOT NULL
        AND approval_token_expires_at IS NULL
        AND status NOT IN ('completed','cancelled','approved','quote_declined')
    `);

    // ── 10. sales_documents (payment proof token) → tambah proof_token_expires_at
    await db.execute(sql`
      ALTER TABLE sales_documents
        ADD COLUMN IF NOT EXISTS proof_upload_token_expires_at TIMESTAMPTZ
    `);
    // Backfill: token yang ada diberi expiry 30 hari dari sekarang
    await db.execute(sql`
      UPDATE sales_documents
      SET proof_upload_token_expires_at = NOW() + INTERVAL '30 days'
      WHERE proof_upload_token IS NOT NULL
        AND proof_upload_token_expires_at IS NULL
        AND payment_status <> 'paid'
    `);

    // ── 11. vendor_mini_form_links → tambah revoked_at ──────────────────────
    // (isActive sudah ada sebagai mekanisme revoke, tapi tambahkan revoked_at untuk audit trail)
    await db.execute(sql`
      ALTER TABLE vendor_mini_form_links
        ADD COLUMN IF NOT EXISTS revoked_at TIMESTAMPTZ
    `);

    migrationDone = true;
    logger.info("[tokenSecurity] Migration complete");
  } catch (err) {
    logger.error({ err }, "[tokenSecurity] Migration failed (non-fatal)");
  }
}
