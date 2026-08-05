/**
 * Step 3 migration:
 * - Add linked_product_id to pos_products (FK → products.id)
 * - Add POS_SALE to inv_reference_type enum
 * - Add warehouse_id column to pos_branches (optional forward-compat)
 */
import pg from "pg";
const { Pool } = pg;
const url = (process.env.SUPABASE_PG_URL || process.env.DATABASE_URL || "")
  .replace(/:6543\//, ":5432/");
const pool = new Pool({ connectionString: url, ssl: { rejectUnauthorized: false }, max: 1 });

async function run() {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");

    // Add linked_product_id to pos_products
    await client.query(`
      ALTER TABLE pos_products
        ADD COLUMN IF NOT EXISTS linked_product_id INTEGER REFERENCES products(id) ON DELETE SET NULL;
    `);

    // Add POS_SALE to inv_reference_type enum (idempotent)
    await client.query(`
      DO $$
      BEGIN
        IF NOT EXISTS (
          SELECT 1 FROM pg_enum
          WHERE enumlabel = 'POS_SALE'
            AND enumtypid = (SELECT oid FROM pg_type WHERE typname = 'inv_reference_type')
        ) THEN
          ALTER TYPE inv_reference_type ADD VALUE 'POS_SALE';
        END IF;
      END$$;
    `);

    await client.query("COMMIT");
    console.log("✅ Step 3 migration done.");
  } catch (err) {
    await client.query("ROLLBACK");
    console.error("❌ Migration failed:", err);
    process.exit(1);
  } finally {
    client.release();
    await pool.end();
  }
}

run();
