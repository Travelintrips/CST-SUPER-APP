import { db } from "@workspace/db";
import { sql } from "drizzle-orm";
import { logger } from "./logger";

export async function runFreightAuditMigration(): Promise<void> {
  await db.execute(sql`
    CREATE TABLE IF NOT EXISTS freight_shipment_audit_logs (
      id          SERIAL PRIMARY KEY,
      shipment_id INTEGER NOT NULL REFERENCES freight_shipments(id) ON DELETE CASCADE,
      shipment_number TEXT NOT NULL,
      from_status TEXT,
      to_status   TEXT NOT NULL,
      changed_by  TEXT NOT NULL,
      changed_by_id TEXT,
      notes       TEXT,
      created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);
  await db.execute(sql`
    CREATE INDEX IF NOT EXISTS freight_audit_logs_shipment_id_idx
      ON freight_shipment_audit_logs(shipment_id)
  `);
  logger.info("Freight audit log migration: ok");

  // ── ocean_freight_route_matrix ──────────────────────────────────────────
  await db.execute(sql`
    CREATE TABLE IF NOT EXISTS ocean_freight_route_matrix (
      id                    SERIAL PRIMARY KEY,
      origin_port_code      TEXT NOT NULL,
      destination_port_code TEXT NOT NULL,
      carrier_code          TEXT NOT NULL,
      service_name          TEXT NOT NULL DEFAULT '',
      transit_days_min      INTEGER,
      transit_days_max      INTEGER,
      frequency             TEXT NOT NULL DEFAULT 'weekly',
      direct_or_transshipment TEXT NOT NULL DEFAULT 'direct',
      pol                   TEXT,
      pod                   TEXT,
      transshipment_port    TEXT,
      is_active             BOOLEAN NOT NULL DEFAULT TRUE,
      notes                 TEXT,
      created_at            TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at            TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);
  await db.execute(sql`
    CREATE UNIQUE INDEX IF NOT EXISTS ofr_route_matrix_uq
      ON ocean_freight_route_matrix(origin_port_code, destination_port_code, carrier_code)
  `);
  logger.info("Ocean freight route matrix migration: ok");
}
