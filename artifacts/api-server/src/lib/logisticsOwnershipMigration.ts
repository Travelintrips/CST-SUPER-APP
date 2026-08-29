import { db } from "@workspace/db";
import { sql } from "drizzle-orm";

/**
 * Ownership columns for the customer-facing freight/trucking flows.
 *
 * These columns deliberately keep portal customer identity separate from the
 * display name/email fields.  Company-owned records use company_id while
 * individual records use portal_customer_id.
 */
export async function runLogisticsOwnershipMigration(): Promise<void> {
  await db.execute(sql`
    DO $$ BEGIN
      IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'logistic_orders') THEN
        ALTER TABLE logistic_orders
          ADD COLUMN IF NOT EXISTS portal_customer_id INTEGER REFERENCES portal_customers(id) ON DELETE SET NULL;
        CREATE INDEX IF NOT EXISTS logistic_orders_portal_customer_idx
          ON logistic_orders (portal_customer_id);
      END IF;

      IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'air_freight_orders') THEN
        ALTER TABLE air_freight_orders
          ADD COLUMN IF NOT EXISTS portal_customer_id INTEGER REFERENCES portal_customers(id) ON DELETE SET NULL;
        CREATE INDEX IF NOT EXISTS air_freight_orders_portal_customer_idx
          ON air_freight_orders (portal_customer_id);
      END IF;

      IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'ocean_freight_orders') THEN
        ALTER TABLE ocean_freight_orders
          ADD COLUMN IF NOT EXISTS portal_customer_id INTEGER REFERENCES portal_customers(id) ON DELETE SET NULL;
        CREATE INDEX IF NOT EXISTS ocean_freight_orders_portal_customer_idx
          ON ocean_freight_orders (portal_customer_id);
      END IF;

      IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'trucking_booking_requests') THEN
        ALTER TABLE trucking_booking_requests
          ADD COLUMN IF NOT EXISTS portal_customer_id INTEGER REFERENCES portal_customers(id) ON DELETE SET NULL,
          ADD COLUMN IF NOT EXISTS company_id INTEGER REFERENCES companies(id) ON DELETE SET NULL;
        CREATE INDEX IF NOT EXISTS trucking_booking_requests_portal_customer_idx
          ON trucking_booking_requests (portal_customer_id);
        CREATE INDEX IF NOT EXISTS trucking_booking_requests_company_idx
          ON trucking_booking_requests (company_id);
      END IF;
    END $$;
  `);
}