import { db } from "@workspace/db";
import { sql } from "drizzle-orm";
import { logger } from "./logger.js";

export async function runCostCenterMigration(): Promise<void> {
  try {
    await db.execute(sql`
      CREATE TABLE IF NOT EXISTS cost_centers (
        id          SERIAL PRIMARY KEY,
        company_id  INTEGER,
        code        TEXT NOT NULL,
        name        TEXT NOT NULL,
        description TEXT,
        is_active   BOOLEAN NOT NULL DEFAULT TRUE,
        created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );

      CREATE UNIQUE INDEX IF NOT EXISTS cost_centers_company_code_uniq
        ON cost_centers (COALESCE(company_id, 0), code);

      ALTER TABLE accounting_entries
        ADD COLUMN IF NOT EXISTS cost_center_id INTEGER REFERENCES cost_centers(id) ON DELETE SET NULL;

      CREATE INDEX IF NOT EXISTS accounting_entries_cost_center_idx
        ON accounting_entries (cost_center_id);
    `);

    const defaults = [
      { code: "SPORT_CENTER", name: "Sport Center",   description: "Unit bisnis sport center (futsal, gym, dll)" },
      { code: "LOGISTICS",    name: "Logistics",      description: "Unit bisnis logistik & freight" },
      { code: "TRADING",      name: "Trading",        description: "Unit bisnis perdagangan" },
      { code: "SOFTWARE",     name: "Software",       description: "Unit bisnis pengembangan perangkat lunak" },
      { code: "GENERAL",      name: "General",        description: "Umum / tidak terkait unit bisnis tertentu" },
    ];

    for (const d of defaults) {
      await db.execute(sql`
        INSERT INTO cost_centers (code, name, description, is_active)
        VALUES (${d.code}, ${d.name}, ${d.description}, TRUE)
        ON CONFLICT DO NOTHING
      `);
    }

    logger.info("[costCenterMigration] Cost center table & seed OK");
  } catch (err) {
    logger.error({ err }, "[costCenterMigration] Failed");
    throw err;
  }
}
