import { db } from "@workspace/db";
import { sql } from "drizzle-orm";
import { logger } from "./logger.js";

export async function runStep4TemplateMigration(): Promise<void> {
  try {
    await db.execute(sql`
      DO $$ BEGIN
        -- purchase_documents: templateSnapshot columns
        IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'purchase_documents') THEN
          IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'purchase_documents' AND column_name = 'category_key') THEN
            ALTER TABLE purchase_documents ADD COLUMN category_key TEXT;
          END IF;
          IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'purchase_documents' AND column_name = 'template_id') THEN
            ALTER TABLE purchase_documents ADD COLUMN template_id TEXT;
          END IF;
          IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'purchase_documents' AND column_name = 'template_version') THEN
            ALTER TABLE purchase_documents ADD COLUMN template_version TEXT;
          END IF;
          IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'purchase_documents' AND column_name = 'template_snapshot') THEN
            ALTER TABLE purchase_documents ADD COLUMN template_snapshot JSONB;
          END IF;
        END IF;

        -- sales_documents: templateSnapshot columns
        IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'sales_documents') THEN
          IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'sales_documents' AND column_name = 'category_key') THEN
            ALTER TABLE sales_documents ADD COLUMN category_key TEXT;
          END IF;
          IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'sales_documents' AND column_name = 'template_id') THEN
            ALTER TABLE sales_documents ADD COLUMN template_id TEXT;
          END IF;
          IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'sales_documents' AND column_name = 'template_version') THEN
            ALTER TABLE sales_documents ADD COLUMN template_version TEXT;
          END IF;
          IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'sales_documents' AND column_name = 'template_snapshot') THEN
            ALTER TABLE sales_documents ADD COLUMN template_snapshot JSONB;
          END IF;
        END IF;
      END $$;
    `);
    logger.info("Step 4 template migration applied (purchase_documents + sales_documents)");
  } catch (err) {
    logger.error({ err }, "Step 4 template migration failed");
    throw err;
  }
}
