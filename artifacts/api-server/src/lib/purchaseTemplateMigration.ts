import { db } from "@workspace/db";
import { sql } from "drizzle-orm";

export async function runPurchaseTemplateMigration(): Promise<void> {
  await db.execute(sql`
    ALTER TABLE purchase_documents
      ADD COLUMN IF NOT EXISTS product_category   text,
      ADD COLUMN IF NOT EXISTS incoterm           text,
      ADD COLUMN IF NOT EXISTS delivery_term      text,
      ADD COLUMN IF NOT EXISTS target_price       numeric(14,2),
      ADD COLUMN IF NOT EXISTS commodity_specs    jsonb,
      ADD COLUMN IF NOT EXISTS required_documents jsonb,
      ADD COLUMN IF NOT EXISTS category_key       text,
      ADD COLUMN IF NOT EXISTS template_id        text,
      ADD COLUMN IF NOT EXISTS template_version   text,
      ADD COLUMN IF NOT EXISTS template_snapshot  jsonb
  `);

  await db.execute(sql`
    ALTER TABLE purchase_request_lines
      ADD COLUMN IF NOT EXISTS product_category    text,
      ADD COLUMN IF NOT EXISTS custom_field_values jsonb
  `);

  await db.execute(sql`
    ALTER TABLE vendor_quotations
      ADD COLUMN IF NOT EXISTS incoterm       text,
      ADD COLUMN IF NOT EXISTS delivery_term  text,
      ADD COLUMN IF NOT EXISTS availability   text,
      ADD COLUMN IF NOT EXISTS document_refs  jsonb
  `);

  await db.execute(sql`
    ALTER TABLE goods_receipt_lines
      ADD COLUMN IF NOT EXISTS condition       text,
      ADD COLUMN IF NOT EXISTS receiving_notes text,
      ADD COLUMN IF NOT EXISTS attachments     jsonb
  `);

  // P1-B: template snapshot propagation through vendor_invoices
  await db.execute(sql`
    ALTER TABLE vendor_invoices
      ADD COLUMN IF NOT EXISTS category_key      text,
      ADD COLUMN IF NOT EXISTS template_id       text,
      ADD COLUMN IF NOT EXISTS template_version  text,
      ADD COLUMN IF NOT EXISTS template_snapshot jsonb
  `);
}
