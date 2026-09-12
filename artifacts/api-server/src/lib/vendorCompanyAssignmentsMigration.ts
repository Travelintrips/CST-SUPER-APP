import { db } from "@workspace/db";
import { sql } from "drizzle-orm";

export async function runVendorCompanyAssignmentsMigration(): Promise<void> {
  await db.execute(sql`
    CREATE TABLE IF NOT EXISTS vendor_company_assignments (
      id SERIAL PRIMARY KEY,
      vendor_id INTEGER NOT NULL REFERENCES suppliers(id) ON DELETE CASCADE,
      company_id INTEGER NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
      created_at TIMESTAMP NOT NULL DEFAULT NOW(),
      UNIQUE(vendor_id, company_id)
    )
  `);

  await db.execute(sql`
    CREATE INDEX IF NOT EXISTS vca_vendor_idx ON vendor_company_assignments(vendor_id)
  `);

  await db.execute(sql`
    CREATE INDEX IF NOT EXISTS vca_company_idx ON vendor_company_assignments(company_id)
  `);
}
