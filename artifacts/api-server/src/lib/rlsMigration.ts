import { db } from "@workspace/db";
import { sql } from "drizzle-orm";
import { logger } from "./logger.js";

/**
 * RLS Migration — defense-in-depth layer on Supabase PostgreSQL.
 *
 * The API server connects as the service_role (bypasses RLS by default).
 * These policies block the `anon` and `authenticated` Supabase roles from
 * directly accessing business data tables, providing protection if the
 * DB connection string or anon/user JWT is leaked.
 *
 * All policies are idempotent — safe to run multiple times.
 */

const CRITICAL_TABLES = [
  "users",
  "logistic_orders",
  "logistic_order_items",
  "logistic_order_rfqs",
  "logistic_order_quotes",
  "vendor_responses",
  "vendor_catalog_items",
  "freight_shipments",
  "accounting_entries",
  "accounting_entry_lines",
  "accounting_journals",
  "chart_of_accounts",
  "accounting_payments",
  "sales_documents",
  "sales_document_lines",
  "purchase_documents",
  "purchase_document_lines",
  "expenses",
  "suppliers",
  "email_correspondences",
  "wa_incoming_messages",
  "sessions",
  "drivers",
  "driver_jobs",
  "short_links",
  "custom_roles",
  // --- Added in security audit batch 2 ---
  // PII: customer data, contact info, order details
  "orders",
  // Vendor form data: active tokens + vendor pricing
  "vendor_mini_form_links",
  "vendor_mini_form_submissions",
  // Customer approval tokens
  "customer_approvals",
  // KYC / identity data
  "user_profiles",
  "identity_documents",
  "ocr_results",
  // Product cost prices (harga modal)
  "products",
];

export async function runRlsMigration(): Promise<void> {
  let enabled = 0;
  let skipped = 0;

  for (const table of CRITICAL_TABLES) {
    try {
      // Check if table exists before enabling RLS
      const exists = await db.execute(sql`
        SELECT 1 FROM information_schema.tables
        WHERE table_schema = 'public' AND table_name = ${table}
        LIMIT 1
      `);

      if ((exists as unknown as { rows: unknown[] }).rows.length === 0) {
        skipped++;
        continue;
      }

      // Enable RLS (idempotent)
      await db.execute(sql.raw(`ALTER TABLE "${table}" ENABLE ROW LEVEL SECURITY`));

      // Drop old deny policy if exists (recreate to ensure it's correct)
      await db.execute(
        sql.raw(`DROP POLICY IF EXISTS "deny_direct_anon_access" ON "${table}"`)
      );

      // Deny all access from anon and authenticated Supabase roles
      // The service_role used by the API server bypasses RLS entirely
      await db.execute(sql.raw(`
        CREATE POLICY "deny_direct_anon_access"
          ON "${table}"
          FOR ALL
          TO anon, authenticated
          USING (false)
          WITH CHECK (false)
      `));

      enabled++;
    } catch (err) {
      // Non-fatal: some tables may use different schemas or have constraints
      const msg = err instanceof Error ? err.message : String(err);
      logger.warn({ table, err: msg }, "RLS migration: could not enable RLS on table (non-fatal)");
      skipped++;
    }
  }

  logger.info(
    { enabled, skipped, total: CRITICAL_TABLES.length },
    "RLS migration: deny policies applied to critical tables"
  );
}
