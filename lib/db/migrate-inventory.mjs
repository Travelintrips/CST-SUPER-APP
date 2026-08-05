import pg from "pg";

const { Pool } = pg;
const url = (process.env.SUPABASE_PG_URL || process.env.DATABASE_URL || "").replace(/:6543\//, ":5432/");
const pool = new Pool({ connectionString: url, ssl: { rejectUnauthorized: false }, max: 1 });

async function run() {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");

    // ── Enums ─────────────────────────────────────────────────────────────────
    await client.query(`
      DO $$ BEGIN
        IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'warehouse_type') THEN
          CREATE TYPE warehouse_type AS ENUM ('CENTRAL','BRANCH','OUTLET');
        END IF;
      END $$;
    `);

    await client.query(`
      DO $$ BEGIN
        IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'inv_movement_type') THEN
          CREATE TYPE inv_movement_type AS ENUM (
            'PURCHASE_RECEIPT','SALES_DELIVERY','POS_SALE',
            'TRANSFER_IN','TRANSFER_OUT','RETURN_IN','RETURN_OUT',
            'OPNAME_ADJUST','DAMAGE','MANUAL_IN','MANUAL_OUT'
          );
        END IF;
      END $$;
    `);

    await client.query(`
      DO $$ BEGIN
        IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'inv_reference_type') THEN
          CREATE TYPE inv_reference_type AS ENUM (
            'PURCHASE_ORDER','SALES_ORDER','POS_SESSION',
            'TRANSFER','RETURN','OPNAME','MANUAL'
          );
        END IF;
      END $$;
    `);

    // ── warehouses ────────────────────────────────────────────────────────────
    await client.query(`
      CREATE TABLE IF NOT EXISTS warehouses (
        id              SERIAL PRIMARY KEY,
        warehouse_code  TEXT NOT NULL UNIQUE,
        warehouse_name  TEXT NOT NULL,
        warehouse_type  warehouse_type NOT NULL DEFAULT 'BRANCH',
        branch_id       INTEGER,
        address         TEXT,
        is_active       BOOLEAN NOT NULL DEFAULT TRUE,
        created_at      TIMESTAMP NOT NULL DEFAULT NOW(),
        updated_at      TIMESTAMP NOT NULL DEFAULT NOW()
      );
    `);

    // ── warehouse_racks ───────────────────────────────────────────────────────
    await client.query(`
      CREATE TABLE IF NOT EXISTS warehouse_racks (
        id            SERIAL PRIMARY KEY,
        warehouse_id  INTEGER NOT NULL REFERENCES warehouses(id) ON DELETE CASCADE,
        rack_code     TEXT NOT NULL,
        rack_name     TEXT NOT NULL,
        zone          TEXT,
        qr_code       TEXT,
        is_active     BOOLEAN NOT NULL DEFAULT TRUE,
        UNIQUE (warehouse_id, rack_code)
      );
    `);

    // ── inventory_stock ───────────────────────────────────────────────────────
    await client.query(`
      CREATE TABLE IF NOT EXISTS inventory_stock (
        id               SERIAL PRIMARY KEY,
        product_id       INTEGER NOT NULL REFERENCES products(id) ON DELETE CASCADE,
        warehouse_id     INTEGER NOT NULL REFERENCES warehouses(id) ON DELETE CASCADE,
        rack_id          INTEGER REFERENCES warehouse_racks(id) ON DELETE SET NULL,
        stock_on_hand    NUMERIC(14,3) NOT NULL DEFAULT 0,
        stock_reserved   NUMERIC(14,3) NOT NULL DEFAULT 0,
        stock_available  NUMERIC(14,3) NOT NULL DEFAULT 0,
        minimum_stock    NUMERIC(14,3) NOT NULL DEFAULT 0,
        unit             TEXT NOT NULL DEFAULT 'pcs',
        average_cost     NUMERIC(14,2) NOT NULL DEFAULT 0,
        last_updated     TIMESTAMP NOT NULL DEFAULT NOW(),
        CONSTRAINT inventory_stock_product_warehouse_rack_unique
          UNIQUE (product_id, warehouse_id, rack_id)
      );
    `);

    // ── stock_movements ───────────────────────────────────────────────────────
    await client.query(`
      CREATE TABLE IF NOT EXISTS stock_movements (
        id              SERIAL PRIMARY KEY,
        movement_no     TEXT NOT NULL UNIQUE,
        product_id      INTEGER NOT NULL REFERENCES products(id) ON DELETE CASCADE,
        warehouse_id    INTEGER NOT NULL REFERENCES warehouses(id) ON DELETE CASCADE,
        rack_id         INTEGER REFERENCES warehouse_racks(id) ON DELETE SET NULL,
        movement_type   inv_movement_type NOT NULL,
        reference_type  inv_reference_type,
        reference_id    INTEGER,
        qty_in          NUMERIC(14,3) NOT NULL DEFAULT 0,
        qty_out         NUMERIC(14,3) NOT NULL DEFAULT 0,
        balance_after   NUMERIC(14,3) NOT NULL DEFAULT 0,
        unit_cost       NUMERIC(14,2) NOT NULL DEFAULT 0,
        total_cost      NUMERIC(14,2) NOT NULL DEFAULT 0,
        notes           TEXT,
        created_by      TEXT,
        created_at      TIMESTAMP NOT NULL DEFAULT NOW()
      );
    `);

    // ── Indexes ───────────────────────────────────────────────────────────────
    await client.query(`CREATE INDEX IF NOT EXISTS idx_inventory_stock_product ON inventory_stock(product_id);`);
    await client.query(`CREATE INDEX IF NOT EXISTS idx_inventory_stock_warehouse ON inventory_stock(warehouse_id);`);
    await client.query(`CREATE INDEX IF NOT EXISTS idx_stock_movements_product ON stock_movements(product_id);`);
    await client.query(`CREATE INDEX IF NOT EXISTS idx_stock_movements_warehouse ON stock_movements(warehouse_id);`);
    await client.query(`CREATE INDEX IF NOT EXISTS idx_stock_movements_created_at ON stock_movements(created_at DESC);`);
    await client.query(`CREATE INDEX IF NOT EXISTS idx_stock_movements_ref ON stock_movements(reference_type, reference_id);`);
    await client.query(`CREATE INDEX IF NOT EXISTS idx_warehouse_racks_warehouse ON warehouse_racks(warehouse_id);`);

    await client.query("COMMIT");
    console.log("✅ Inventory tables created.");
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
