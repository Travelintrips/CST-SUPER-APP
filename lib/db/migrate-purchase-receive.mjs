import pg from "pg";

const { Pool } = pg;
const url = (process.env.SUPABASE_PG_URL || process.env.DATABASE_URL || "").replace(/:6543\//, ":5432/");
const pool = new Pool({ connectionString: url, ssl: { rejectUnauthorized: false }, max: 1 });

async function run() {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");

    // purchase_receipts
    await client.query(`
      CREATE TABLE IF NOT EXISTS purchase_receipts (
        id              SERIAL PRIMARY KEY,
        receipt_no      TEXT NOT NULL UNIQUE,
        po_id           INTEGER NOT NULL REFERENCES purchase_documents(id) ON DELETE CASCADE,
        warehouse_id    INTEGER NOT NULL REFERENCES warehouses(id) ON DELETE RESTRICT,
        status          TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','posted','cancelled')),
        notes           TEXT,
        received_by     TEXT,
        received_at     TIMESTAMP,
        created_at      TIMESTAMP NOT NULL DEFAULT NOW(),
        updated_at      TIMESTAMP NOT NULL DEFAULT NOW()
      );
    `);

    // purchase_receipt_lines
    await client.query(`
      CREATE TABLE IF NOT EXISTS purchase_receipt_lines (
        id              SERIAL PRIMARY KEY,
        receipt_id      INTEGER NOT NULL REFERENCES purchase_receipts(id) ON DELETE CASCADE,
        po_line_id      INTEGER REFERENCES purchase_document_lines(id) ON DELETE SET NULL,
        product_id      INTEGER NOT NULL REFERENCES products(id) ON DELETE CASCADE,
        rack_id         INTEGER REFERENCES warehouse_racks(id) ON DELETE SET NULL,
        qty_ordered     NUMERIC(14,3) NOT NULL DEFAULT 0,
        qty_received    NUMERIC(14,3) NOT NULL DEFAULT 0,
        unit_cost       NUMERIC(14,2) NOT NULL DEFAULT 0,
        total_cost      NUMERIC(14,2) GENERATED ALWAYS AS (qty_received * unit_cost) STORED
      );
    `);

    // Indexes
    await client.query(`CREATE INDEX IF NOT EXISTS idx_purchase_receipts_po ON purchase_receipts(po_id);`);
    await client.query(`CREATE INDEX IF NOT EXISTS idx_purchase_receipt_lines_receipt ON purchase_receipt_lines(receipt_id);`);
    await client.query(`CREATE INDEX IF NOT EXISTS idx_purchase_receipt_lines_product ON purchase_receipt_lines(product_id);`);

    await client.query("COMMIT");
    console.log("✅ purchase_receipts tables created.");
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
