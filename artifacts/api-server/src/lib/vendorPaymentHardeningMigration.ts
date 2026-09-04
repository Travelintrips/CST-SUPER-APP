import { db } from "@workspace/db";
import { sql } from "drizzle-orm";
import { logger } from "./logger.js";

/**
 * Additive Vendor Payment hardening.
 *
 * This migration only adds line-level resolution and withholding evidence
 * records. It does not rewrite historical invoices or the deprecated
 * vendor_payments executor.
 */
export async function runVendorPaymentHardeningMigration(): Promise<void> {
  await db.execute(sql`
    ALTER TABLE vendor_invoices
      ADD COLUMN IF NOT EXISTS withholding_review_status TEXT NOT NULL DEFAULT 'not_required',
      ADD COLUMN IF NOT EXISTS withholding_review_completed_by TEXT,
      ADD COLUMN IF NOT EXISTS withholding_review_completed_at TIMESTAMPTZ
  `);

  await db.execute(sql`
    ALTER TABLE vendor_invoice_lines
      ADD COLUMN IF NOT EXISTS coa_account_id INTEGER,
      ADD COLUMN IF NOT EXISTS coa_resolution_status TEXT NOT NULL DEFAULT 'unresolved',
      ADD COLUMN IF NOT EXISTS coa_confirmed_by TEXT,
      ADD COLUMN IF NOT EXISTS coa_confirmed_at TIMESTAMPTZ,
      ADD COLUMN IF NOT EXISTS coa_mapping_key TEXT
  `);

  await db.execute(sql`
    CREATE TABLE IF NOT EXISTS vendor_invoice_line_taxes (
      id SERIAL PRIMARY KEY,
      invoice_line_id INTEGER NOT NULL REFERENCES vendor_invoice_lines(id) ON DELETE CASCADE,
      company_id INTEGER NOT NULL REFERENCES companies(id) ON DELETE RESTRICT,
      tax_type TEXT NOT NULL,
      tax_object TEXT NOT NULL,
      base_amount NUMERIC(14,2) NOT NULL DEFAULT 0,
      tax_amount NUMERIC(14,2) NOT NULL DEFAULT 0,
      liability_account_id INTEGER,
      resolution_status TEXT NOT NULL DEFAULT 'tax_review',
      review_reason TEXT,
      reviewed_by TEXT,
      reviewed_at TIMESTAMPTZ,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);

  await db.execute(sql`
    CREATE TABLE IF NOT EXISTS vendor_invoice_coa_mappings (
      id SERIAL PRIMARY KEY,
      company_id INTEGER NOT NULL REFERENCES companies(id) ON DELETE RESTRICT,
      supplier_id INTEGER REFERENCES suppliers(id) ON DELETE SET NULL,
      product_id INTEGER REFERENCES products(id) ON DELETE SET NULL,
      mapping_key TEXT NOT NULL,
      coa_account_id INTEGER NOT NULL REFERENCES chart_of_accounts(id) ON DELETE RESTRICT,
      status TEXT NOT NULL DEFAULT 'approved',
      approved_by TEXT NOT NULL,
      approved_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);

  await db.execute(sql`
    CREATE TABLE IF NOT EXISTS vendor_withholding_records (
      id SERIAL PRIMARY KEY,
      company_id INTEGER NOT NULL REFERENCES companies(id) ON DELETE RESTRICT,
      vendor_invoice_id INTEGER NOT NULL REFERENCES vendor_invoices(id) ON DELETE RESTRICT,
      invoice_line_id INTEGER NOT NULL REFERENCES vendor_invoice_lines(id) ON DELETE RESTRICT,
      line_tax_id INTEGER NOT NULL REFERENCES vendor_invoice_line_taxes(id) ON DELETE RESTRICT,
      tax_type TEXT NOT NULL,
      tax_object TEXT NOT NULL,
      base_amount NUMERIC(14,2) NOT NULL DEFAULT 0,
      tax_amount NUMERIC(14,2) NOT NULL DEFAULT 0,
      liability_account_id INTEGER NOT NULL REFERENCES chart_of_accounts(id) ON DELETE RESTRICT,
      status TEXT NOT NULL DEFAULT 'proof_pending',
      proof_object_path TEXT,
      proof_reference TEXT,
      proof_content_type TEXT,
      proof_issued_at TIMESTAMPTZ,
      reviewed_by TEXT,
      reviewed_at TIMESTAMPTZ,
      posted_at TIMESTAMPTZ,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);

  await db.execute(sql`
    CREATE UNIQUE INDEX IF NOT EXISTS vendor_invoice_line_taxes_line_tax_unique
      ON vendor_invoice_line_taxes (invoice_line_id, tax_type, tax_object)
  `);
  await db.execute(sql`
    CREATE INDEX IF NOT EXISTS vendor_invoice_line_taxes_company_idx
      ON vendor_invoice_line_taxes (company_id)
  `);
  await db.execute(sql`
    CREATE UNIQUE INDEX IF NOT EXISTS vendor_invoice_coa_mapping_scope_unique
      ON vendor_invoice_coa_mappings (company_id, COALESCE(supplier_id, 0), COALESCE(product_id, 0), mapping_key)
  `);
  await db.execute(sql`
    CREATE INDEX IF NOT EXISTS vendor_invoice_coa_mapping_lookup_idx
      ON vendor_invoice_coa_mappings (company_id, supplier_id, product_id, mapping_key)
  `);
  await db.execute(sql`
    CREATE UNIQUE INDEX IF NOT EXISTS vendor_withholding_line_tax_unique
      ON vendor_withholding_records (line_tax_id)
  `);
  await db.execute(sql`
    CREATE INDEX IF NOT EXISTS vendor_withholding_invoice_idx
      ON vendor_withholding_records (vendor_invoice_id)
  `);
  await db.execute(sql`
    CREATE INDEX IF NOT EXISTS vendor_withholding_company_status_idx
      ON vendor_withholding_records (company_id, status)
  `);

  logger.info("[vendorPaymentHardeningMigration] line COA and withholding schema ready");
}