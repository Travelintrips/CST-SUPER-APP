/**
 * Migration: create vendor_rates table
 * Run: node scripts/migrate-vendor-rates.mjs
 */
import pg from "pg";

const { Pool } = pg;

const connectionString = (
  process.env.SUPABASE_PG_URL ||
  process.env.SUPABASE_DATABASE_URL ||
  process.env.DATABASE_URL ||
  ""
).replace(/:6543\//, ":5432/");

if (!connectionString) {
  console.error("ERROR: No DB connection string found (SUPABASE_PG_URL / DATABASE_URL)");
  process.exit(1);
}

const pool = new Pool({ connectionString, ssl: { rejectUnauthorized: false } });

const MIGRATIONS = [
  {
    name: "create vendor_rates table",
    sql: `
      CREATE TABLE IF NOT EXISTS vendor_rates (
        id               SERIAL PRIMARY KEY,
        vendor_id        INTEGER REFERENCES suppliers(id) ON DELETE CASCADE,
        transport_mode   TEXT NOT NULL,
        truck_type       TEXT,
        origin_keyword   TEXT,
        dest_keyword     TEXT,
        base_rate        NUMERIC(15,2) NOT NULL DEFAULT 0,
        unit             TEXT NOT NULL DEFAULT 'per_trip',
        is_active        BOOLEAN NOT NULL DEFAULT TRUE,
        created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );
    `,
  },
  {
    name: "idx_vendor_rates_mode",
    sql: `CREATE INDEX IF NOT EXISTS idx_vendor_rates_mode ON vendor_rates(transport_mode);`,
  },
  {
    name: "idx_vendor_rates_vendor",
    sql: `CREATE INDEX IF NOT EXISTS idx_vendor_rates_vendor ON vendor_rates(vendor_id);`,
  },
];

async function run() {
  const client = await pool.connect();
  try {
    for (const m of MIGRATIONS) {
      process.stdout.write(`  ▸ ${m.name}... `);
      await client.query(m.sql);
      console.log("OK");
    }
    console.log(`\n✅ vendor_rates migration complete (${MIGRATIONS.length} steps)`);
  } finally {
    client.release();
    await pool.end();
  }
}

run().catch((err) => {
  console.error("Migration failed:", err.message);
  process.exit(1);
});
