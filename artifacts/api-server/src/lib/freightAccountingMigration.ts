import { db } from "@workspace/db";
import { sql } from "drizzle-orm";
import { logger } from "./logger.js";

export async function runFreightAccountingMigration(): Promise<void> {
  await db.execute(sql`
    ALTER TABLE freight_shipments
      ADD COLUMN IF NOT EXISTS estimated_revenue NUMERIC(14,2),
      ADD COLUMN IF NOT EXISTS estimated_cost    NUMERIC(14,2),
      ADD COLUMN IF NOT EXISTS actual_revenue    NUMERIC(14,2),
      ADD COLUMN IF NOT EXISTS invoice_status    TEXT NOT NULL DEFAULT 'none',
      ADD COLUMN IF NOT EXISTS vendor_bill_status TEXT NOT NULL DEFAULT 'none';
  `);
  logger.info("freightAccountingMigration: kolom keuangan freight ditambahkan");
}
