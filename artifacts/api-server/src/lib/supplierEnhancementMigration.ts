import { db } from "@workspace/db";
import { sql } from "drizzle-orm";
import { logger } from "./logger.js";

/**
 * Supplier Enhancement Migration — Fase 1/2/3/6
 * ────────────────────────────────────────────────────────────────────────────
 * Recovery migration: lib/db/src/schema/suppliers.ts already declares the
 * granular-status / marketplace-profile / documents / reviews columns and
 * tables added by a previous (partial) implementation, but no migration was
 * ever written to apply them to the real database — this file closes that
 * gap.
 *
 * Rules:
 *  - 100% additive. Never drops or renames a column.
 *  - Never touches suppliers.id or existing legacy columns
 *    (registration_status, self_submitted, reviewed_at, reviewed_by,
 *    review_notes, onboarding_completed_at, npwp, nib, portal_phone,
 *    coverage_area, service_capacity, vehicle_type, admin_notes, updated_at)
 *    — those predate this feature, are unreferenced by current Drizzle
 *    schema/code, and are left physically intact so no historical data is
 *    lost. They are intentionally NOT re-declared in suppliersTable because
 *    nothing in the app reads them anymore.
 *  - isActive is preserved; status/isActive are kept in sync going forward
 *    exclusively via supplierStatusService.updateSupplierStatus().
 *  - Each ALTER/CREATE is its own db.execute() call (pgBouncer transaction
 *    mode rejects multi-statement scripts).
 */

const SUPPLIER_COLUMNS: Array<[string, string]> = [
  // Fase 1 — granular status
  ["status", "TEXT NOT NULL DEFAULT 'active'"],
  ["vendor_code", "TEXT"],
  ["is_verified", "BOOLEAN NOT NULL DEFAULT FALSE"],
  ["verified_at", "TIMESTAMP"],
  ["verified_by", "TEXT"],
  ["status_reason", "TEXT"],
  ["status_changed_at", "TIMESTAMP"],
  ["status_changed_by", "TEXT"],
  // Fase 2 — marketplace profile
  ["logo_url", "TEXT"],
  ["cover_url", "TEXT"],
  ["description_public", "TEXT"],
  ["service_areas", "JSONB"],
  ["is_premium", "BOOLEAN NOT NULL DEFAULT FALSE"],
  ["is_featured", "BOOLEAN NOT NULL DEFAULT FALSE"],
  ["marketplace_status", "TEXT NOT NULL DEFAULT 'draft'"],
  ["marketplace_published_at", "TIMESTAMP"],
  ["marketplace_published_by", "TEXT"],
  ["public_slug", "TEXT"],
];

async function addSupplierColumnIfMissing(col: string, colDef: string): Promise<void> {
  await db.execute(
    sql.raw(`
      DO $$ BEGIN
        IF NOT EXISTS (
          SELECT 1 FROM information_schema.columns
          WHERE table_schema = 'public' AND table_name = 'suppliers' AND column_name = '${col}'
        ) THEN
          ALTER TABLE suppliers ADD COLUMN ${col} ${colDef};
        END IF;
      END $$;
    `)
  );
}

export async function runSupplierEnhancementMigration(): Promise<void> {
  // ── 1. New columns on suppliers ─────────────────────────────────────────
  for (const [col, colDef] of SUPPLIER_COLUMNS) {
    await addSupplierColumnIfMissing(col, colDef).catch((e: unknown) =>
      logger.warn({ err: e }, `supplierEnhancementMigration: ADD COLUMN ${col} failed (non-fatal)`)
    );
  }

  // Unique indexes must be created after the columns exist, and must
  // tolerate multiple NULLs (Postgres unique indexes already allow that).
  await db.execute(sql`
    DO $$ BEGIN
      IF NOT EXISTS (SELECT 1 FROM pg_indexes WHERE indexname = 'suppliers_public_slug_unique') THEN
        CREATE UNIQUE INDEX suppliers_public_slug_unique ON suppliers (public_slug);
      END IF;
    END $$;
  `).catch((e: unknown) => logger.warn({ err: e }, "supplierEnhancementMigration: public_slug unique index failed (non-fatal)"));

  await db.execute(sql`
    DO $$ BEGIN
      IF NOT EXISTS (SELECT 1 FROM pg_indexes WHERE indexname = 'suppliers_vendor_code_unique') THEN
        CREATE UNIQUE INDEX suppliers_vendor_code_unique ON suppliers (vendor_code);
      END IF;
    END $$;
  `).catch((e: unknown) => logger.warn({ err: e }, "supplierEnhancementMigration: vendor_code unique index failed (non-fatal)"));

  await db.execute(sql`CREATE INDEX IF NOT EXISTS suppliers_status_idx ON suppliers (status)`);
  await db.execute(sql`CREATE INDEX IF NOT EXISTS suppliers_is_verified_idx ON suppliers (is_verified)`);
  await db.execute(sql`CREATE INDEX IF NOT EXISTS suppliers_marketplace_status_idx ON suppliers (marketplace_status)`);

  // ── 2. supplier_status_history (Fase 1 audit trail) ─────────────────────
  await db.execute(sql`
    CREATE TABLE IF NOT EXISTS supplier_status_history (
      id               SERIAL PRIMARY KEY,
      supplier_id      INTEGER NOT NULL REFERENCES suppliers(id) ON DELETE CASCADE,
      previous_status  TEXT,
      new_status       TEXT NOT NULL,
      reason           TEXT,
      actor_user_id    TEXT,
      company_id       INTEGER,
      request_id       TEXT,
      created_at       TIMESTAMP NOT NULL DEFAULT NOW()
    );
  `);
  await db.execute(sql`CREATE INDEX IF NOT EXISTS supplier_status_hist_supplier_idx ON supplier_status_history (supplier_id)`);
  await db.execute(sql`CREATE INDEX IF NOT EXISTS supplier_status_hist_created_idx ON supplier_status_history (created_at)`);

  // ── 3. supplier_documents (Fase 3 legal document store) ─────────────────
  await db.execute(sql`
    CREATE TABLE IF NOT EXISTS supplier_documents (
      id                   SERIAL PRIMARY KEY,
      supplier_id          INTEGER NOT NULL REFERENCES suppliers(id) ON DELETE CASCADE,
      document_type        TEXT NOT NULL,
      document_number      TEXT,
      document_name        TEXT,
      file_url             TEXT,
      issued_at            DATE,
      expires_at           DATE,
      verification_status  TEXT NOT NULL DEFAULT 'pending',
      verified_at          TIMESTAMP,
      verified_by          TEXT,
      rejection_reason     TEXT,
      uploaded_at          TIMESTAMP DEFAULT NOW(),
      uploaded_by          TEXT,
      source               TEXT,
      metadata             JSONB,
      created_at           TIMESTAMP NOT NULL DEFAULT NOW(),
      updated_at           TIMESTAMP NOT NULL DEFAULT NOW()
    );
  `);
  await db.execute(sql`CREATE INDEX IF NOT EXISTS supplier_docs_supplier_idx ON supplier_documents (supplier_id)`);
  await db.execute(sql`CREATE INDEX IF NOT EXISTS supplier_docs_type_idx ON supplier_documents (document_type)`);
  await db.execute(sql`CREATE INDEX IF NOT EXISTS supplier_docs_expires_idx ON supplier_documents (expires_at)`);

  // Idempotency guard for onboarding-document migration (source + natural key)
  await db.execute(sql`
    DO $$ BEGIN
      IF NOT EXISTS (SELECT 1 FROM pg_indexes WHERE indexname = 'supplier_docs_dedup_idx') THEN
        CREATE UNIQUE INDEX supplier_docs_dedup_idx ON supplier_documents (supplier_id, document_type, COALESCE(document_number, ''), COALESCE(file_url, ''));
      END IF;
    END $$;
  `).catch((e: unknown) => logger.warn({ err: e }, "supplierEnhancementMigration: supplier_docs_dedup_idx failed (non-fatal)"));

  // ── 4. supplier_reviews (Fase 6 rating/review) ───────────────────────────
  await db.execute(sql`
    CREATE TABLE IF NOT EXISTS supplier_reviews (
      id                      SERIAL PRIMARY KEY,
      supplier_id             INTEGER NOT NULL REFERENCES suppliers(id) ON DELETE CASCADE,
      customer_id             INTEGER,
      source_transaction_type TEXT,
      source_transaction_id   INTEGER,
      rating_overall          NUMERIC(3,1) NOT NULL,
      rating_delivery         NUMERIC(3,1),
      rating_communication    NUMERIC(3,1),
      rating_quality          NUMERIC(3,1),
      review_text             TEXT,
      is_published            BOOLEAN NOT NULL DEFAULT FALSE,
      moderation_status       TEXT NOT NULL DEFAULT 'pending',
      created_at              TIMESTAMP NOT NULL DEFAULT NOW(),
      updated_at              TIMESTAMP NOT NULL DEFAULT NOW()
    );
  `);
  await db.execute(sql`CREATE INDEX IF NOT EXISTS supplier_reviews_supplier_idx ON supplier_reviews (supplier_id)`);
  await db.execute(sql`CREATE INDEX IF NOT EXISTS supplier_reviews_source_idx ON supplier_reviews (source_transaction_type, source_transaction_id)`);
  await db.execute(sql`CREATE INDEX IF NOT EXISTS supplier_reviews_customer_idx ON supplier_reviews (customer_id)`);

  // One active review per transaction — buyer can only review a given
  // transaction once (matches "satu transaksi maksimal satu review aktif").
  await db.execute(sql`
    DO $$ BEGIN
      IF NOT EXISTS (SELECT 1 FROM pg_indexes WHERE indexname = 'supplier_reviews_one_per_transaction_idx') THEN
        CREATE UNIQUE INDEX supplier_reviews_one_per_transaction_idx
          ON supplier_reviews (source_transaction_type, source_transaction_id)
          WHERE source_transaction_type IS NOT NULL AND source_transaction_id IS NOT NULL;
      END IF;
    END $$;
  `).catch((e: unknown) => logger.warn({ err: e }, "supplierEnhancementMigration: one-review-per-transaction index failed (non-fatal)"));

  // ── 5. Backfill status from isActive ─────────────────────────────────────
  // Only touches rows where status still equals the column default 'active'
  // AND isActive is false — i.e. rows created before this migration ran.
  // Never overwrites a status that has already been explicitly set to
  // something other than the default by updateSupplierStatus().
  const backfillResult = await db.execute(sql`
    UPDATE suppliers
    SET status = 'inactive'
    WHERE is_active = FALSE
      AND status = 'active'
      AND status_changed_at IS NULL
  `);

  logger.info(
    { backfilledInactive: (backfillResult as unknown as { rowCount?: number }).rowCount ?? 0 },
    "supplierEnhancementMigration: done (columns, indexes, supplier_status_history, supplier_documents, supplier_reviews, backfill)"
  );
}
