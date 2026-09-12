import { db } from "@workspace/db";
import { sql } from "drizzle-orm";
import { logger } from "./logger.js";

export async function runGeofenceMigration(): Promise<void> {
  await db.execute(sql`
    DO $$ BEGIN
      IF EXISTS (
        SELECT 1 FROM information_schema.tables WHERE table_name = 'logistic_orders'
      ) THEN
        IF NOT EXISTS (
          SELECT 1 FROM information_schema.columns
          WHERE table_name = 'logistic_orders' AND column_name = 'geofence_enabled'
        ) THEN
          ALTER TABLE logistic_orders ADD COLUMN geofence_enabled BOOLEAN NOT NULL DEFAULT TRUE;
        END IF;
        IF NOT EXISTS (
          SELECT 1 FROM information_schema.columns
          WHERE table_name = 'logistic_orders' AND column_name = 'geofence_radius_km'
        ) THEN
          ALTER TABLE logistic_orders ADD COLUMN geofence_radius_km INTEGER NOT NULL DEFAULT 75;
        END IF;
      END IF;
    END $$;
  `);
  logger.info("Geofence migration: selesai (geofence_enabled + geofence_radius_km)");
}
