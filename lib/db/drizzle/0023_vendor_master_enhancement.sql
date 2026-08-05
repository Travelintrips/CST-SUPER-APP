-- Vendor Master Enhancement — Fase 1-6
-- Scope: Additive only — no DROP, no RENAME, no data destruction.
-- Adds granular status, marketplace profile, and three new tables
-- (supplier_documents, supplier_status_history, supplier_reviews).
-- All new columns are nullable or have safe defaults.

-- ── Fase 1: Status Granular ──────────────────────────────────────────────────

ALTER TABLE "suppliers" ADD COLUMN IF NOT EXISTS "status" TEXT NOT NULL DEFAULT 'active';
--> statement-breakpoint
ALTER TABLE "suppliers" ADD COLUMN IF NOT EXISTS "vendor_code" TEXT;
--> statement-breakpoint
ALTER TABLE "suppliers" ADD COLUMN IF NOT EXISTS "is_verified" BOOLEAN NOT NULL DEFAULT false;
--> statement-breakpoint
ALTER TABLE "suppliers" ADD COLUMN IF NOT EXISTS "verified_at" TIMESTAMP;
--> statement-breakpoint
ALTER TABLE "suppliers" ADD COLUMN IF NOT EXISTS "verified_by" TEXT;
--> statement-breakpoint
ALTER TABLE "suppliers" ADD COLUMN IF NOT EXISTS "status_reason" TEXT;
--> statement-breakpoint
ALTER TABLE "suppliers" ADD COLUMN IF NOT EXISTS "status_changed_at" TIMESTAMP;
--> statement-breakpoint
ALTER TABLE "suppliers" ADD COLUMN IF NOT EXISTS "status_changed_by" TEXT;
--> statement-breakpoint

-- ── Fase 2: Profil Marketplace ───────────────────────────────────────────────

ALTER TABLE "suppliers" ADD COLUMN IF NOT EXISTS "logo_url" TEXT;
--> statement-breakpoint
ALTER TABLE "suppliers" ADD COLUMN IF NOT EXISTS "cover_url" TEXT;
--> statement-breakpoint
ALTER TABLE "suppliers" ADD COLUMN IF NOT EXISTS "description_public" TEXT;
--> statement-breakpoint
ALTER TABLE "suppliers" ADD COLUMN IF NOT EXISTS "service_areas" JSONB;
--> statement-breakpoint
ALTER TABLE "suppliers" ADD COLUMN IF NOT EXISTS "is_premium" BOOLEAN NOT NULL DEFAULT false;
--> statement-breakpoint
ALTER TABLE "suppliers" ADD COLUMN IF NOT EXISTS "is_featured" BOOLEAN NOT NULL DEFAULT false;
--> statement-breakpoint
ALTER TABLE "suppliers" ADD COLUMN IF NOT EXISTS "marketplace_status" TEXT NOT NULL DEFAULT 'draft';
--> statement-breakpoint
ALTER TABLE "suppliers" ADD COLUMN IF NOT EXISTS "marketplace_published_at" TIMESTAMP;
--> statement-breakpoint
ALTER TABLE "suppliers" ADD COLUMN IF NOT EXISTS "marketplace_published_by" TEXT;
--> statement-breakpoint
ALTER TABLE "suppliers" ADD COLUMN IF NOT EXISTS "public_slug" TEXT;
--> statement-breakpoint

-- ── Backfill: status dari isActive (existing rows) ───────────────────────────
UPDATE "suppliers"
SET "status" = CASE WHEN "is_active" = true THEN 'active' ELSE 'inactive' END
WHERE "status" = 'active' AND "is_active" = false;
--> statement-breakpoint

-- ── Backfill: vendor_code dari id (idempotent, hanya baris yang kosong) ──────
UPDATE "suppliers"
SET "vendor_code" = 'VND-' || LPAD(id::TEXT, 6, '0')
WHERE "vendor_code" IS NULL;
--> statement-breakpoint

-- ── Backfill: public_slug dari vendor_code ───────────────────────────────────
UPDATE "suppliers"
SET "public_slug" = LOWER(REGEXP_REPLACE(name, '[^a-zA-Z0-9]+', '-', 'g')) || '-' || id::TEXT
WHERE "public_slug" IS NULL;
--> statement-breakpoint

-- ── Indexes ──────────────────────────────────────────────────────────────────
CREATE INDEX IF NOT EXISTS "suppliers_status_idx" ON "suppliers" ("status");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "suppliers_is_verified_idx" ON "suppliers" ("is_verified");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "suppliers_marketplace_status_idx" ON "suppliers" ("marketplace_status");
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "suppliers_public_slug_unique" ON "suppliers" ("public_slug") WHERE "public_slug" IS NOT NULL;
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "suppliers_vendor_code_unique" ON "suppliers" ("vendor_code") WHERE "vendor_code" IS NOT NULL;
--> statement-breakpoint

-- ── Fase 3: supplier_documents ───────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS "supplier_documents" (
  "id"                  SERIAL PRIMARY KEY,
  "supplier_id"         INTEGER NOT NULL REFERENCES "suppliers"("id") ON DELETE CASCADE,
  "document_type"       TEXT NOT NULL,
  "document_number"     TEXT,
  "document_name"       TEXT,
  "file_url"            TEXT,
  "issued_at"           DATE,
  "expires_at"          DATE,
  "verification_status" TEXT NOT NULL DEFAULT 'pending',
  "verified_at"         TIMESTAMP,
  "verified_by"         TEXT,
  "rejection_reason"    TEXT,
  "uploaded_at"         TIMESTAMP DEFAULT now(),
  "uploaded_by"         TEXT,
  "source"              TEXT,
  "metadata"            JSONB,
  "created_at"          TIMESTAMP NOT NULL DEFAULT now(),
  "updated_at"          TIMESTAMP NOT NULL DEFAULT now()
);
--> statement-breakpoint

CREATE INDEX IF NOT EXISTS "supplier_docs_supplier_idx" ON "supplier_documents" ("supplier_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "supplier_docs_type_idx" ON "supplier_documents" ("document_type");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "supplier_docs_expires_idx" ON "supplier_documents" ("expires_at");
--> statement-breakpoint

-- ── Fase 1: supplier_status_history (audit log status) ───────────────────────

CREATE TABLE IF NOT EXISTS "supplier_status_history" (
  "id"               SERIAL PRIMARY KEY,
  "supplier_id"      INTEGER NOT NULL REFERENCES "suppliers"("id") ON DELETE CASCADE,
  "previous_status"  TEXT,
  "new_status"       TEXT NOT NULL,
  "reason"           TEXT,
  "actor_user_id"    TEXT,
  "company_id"       INTEGER,
  "request_id"       TEXT,
  "created_at"       TIMESTAMP NOT NULL DEFAULT now()
);
--> statement-breakpoint

CREATE INDEX IF NOT EXISTS "supplier_status_hist_supplier_idx" ON "supplier_status_history" ("supplier_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "supplier_status_hist_created_idx" ON "supplier_status_history" ("created_at");
--> statement-breakpoint

-- ── Fase 6: supplier_reviews ─────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS "supplier_reviews" (
  "id"                      SERIAL PRIMARY KEY,
  "supplier_id"             INTEGER NOT NULL REFERENCES "suppliers"("id") ON DELETE CASCADE,
  "customer_id"             INTEGER,
  "source_transaction_type" TEXT,
  "source_transaction_id"   INTEGER,
  "rating_overall"          NUMERIC(3,1) NOT NULL,
  "rating_delivery"         NUMERIC(3,1),
  "rating_communication"    NUMERIC(3,1),
  "rating_quality"          NUMERIC(3,1),
  "review_text"             TEXT,
  "is_published"            BOOLEAN NOT NULL DEFAULT false,
  "moderation_status"       TEXT NOT NULL DEFAULT 'pending',
  "created_at"              TIMESTAMP NOT NULL DEFAULT now(),
  "updated_at"              TIMESTAMP NOT NULL DEFAULT now()
);
--> statement-breakpoint

CREATE INDEX IF NOT EXISTS "supplier_reviews_supplier_idx" ON "supplier_reviews" ("supplier_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "supplier_reviews_source_idx" ON "supplier_reviews" ("source_transaction_type", "source_transaction_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "supplier_reviews_customer_idx" ON "supplier_reviews" ("customer_id");
--> statement-breakpoint

-- Unique: satu transaksi maksimal satu review aktif per customer
CREATE UNIQUE INDEX IF NOT EXISTS "supplier_reviews_tx_unique"
  ON "supplier_reviews" ("customer_id", "source_transaction_type", "source_transaction_id")
  WHERE "source_transaction_id" IS NOT NULL AND "customer_id" IS NOT NULL;
