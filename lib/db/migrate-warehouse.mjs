import pg from "pg";

const { Pool } = pg;
const url = (process.env.SUPABASE_PG_URL || process.env.DATABASE_URL || "").replace(/:6543\//, ":5432/");
const pool = new Pool({ connectionString: url, ssl: { rejectUnauthorized: false }, max: 1 });

async function run() {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");

    await client.query(`DO $$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'wh_movement_type') THEN CREATE TYPE wh_movement_type AS ENUM ('po_receipt','so_delivery','pos_sale','transfer_in','transfer_out','opname_adjust','damage','return_in','return_out','manual_in','manual_out'); END IF; END $$;`);
    await client.query(`DO $$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'wh_transfer_status') THEN CREATE TYPE wh_transfer_status AS ENUM ('draft','in_transit','received','cancelled'); END IF; END $$;`);
    await client.query(`DO $$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'wh_damage_status') THEN CREATE TYPE wh_damage_status AS ENUM ('draft','confirmed','cancelled'); END IF; END $$;`);
    await client.query(`DO $$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'wh_return_type') THEN CREATE TYPE wh_return_type AS ENUM ('purchase','sales'); END IF; END $$;`);
    await client.query(`DO $$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'wh_return_status') THEN CREATE TYPE wh_return_status AS ENUM ('draft','confirmed','cancelled'); END IF; END $$;`);
    await client.query(`DO $$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'wh_damage_type') THEN CREATE TYPE wh_damage_type AS ENUM ('rusak','hilang','expired','lainnya'); END IF; END $$;`);

    await client.query(`CREATE TABLE IF NOT EXISTS wh_stock (id SERIAL PRIMARY KEY, product_id INTEGER NOT NULL REFERENCES products(id) ON DELETE CASCADE, warehouse_id INTEGER NOT NULL REFERENCES pos_warehouses(id) ON DELETE CASCADE, rack_id INTEGER REFERENCES pos_racks(id) ON DELETE SET NULL, qty NUMERIC(14,3) NOT NULL DEFAULT 0, cost_price NUMERIC(14,2) NOT NULL DEFAULT 0, updated_at TIMESTAMP NOT NULL DEFAULT NOW(), CONSTRAINT wh_stock_product_warehouse_rack_idx UNIQUE (product_id, warehouse_id, rack_id));`);
    await client.query(`CREATE TABLE IF NOT EXISTS wh_movements (id SERIAL PRIMARY KEY, product_id INTEGER NOT NULL REFERENCES products(id) ON DELETE CASCADE, warehouse_id INTEGER NOT NULL REFERENCES pos_warehouses(id), rack_id INTEGER REFERENCES pos_racks(id), type wh_movement_type NOT NULL, qty NUMERIC(14,3) NOT NULL, qty_before NUMERIC(14,3) NOT NULL DEFAULT 0, qty_after NUMERIC(14,3) NOT NULL DEFAULT 0, cost_price NUMERIC(14,2) NOT NULL DEFAULT 0, ref_type TEXT, ref_id INTEGER, note TEXT, created_by_id TEXT, created_at TIMESTAMP NOT NULL DEFAULT NOW());`);
    await client.query(`CREATE TABLE IF NOT EXISTS wh_transfers (id SERIAL PRIMARY KEY, transfer_number TEXT NOT NULL UNIQUE, from_warehouse_id INTEGER NOT NULL REFERENCES pos_warehouses(id), to_warehouse_id INTEGER NOT NULL REFERENCES pos_warehouses(id), status wh_transfer_status NOT NULL DEFAULT 'draft', note TEXT, created_by_id TEXT, created_at TIMESTAMP NOT NULL DEFAULT NOW(), sent_at TIMESTAMP, received_at TIMESTAMP, cancelled_at TIMESTAMP);`);
    await client.query(`CREATE TABLE IF NOT EXISTS wh_transfer_lines (id SERIAL PRIMARY KEY, transfer_id INTEGER NOT NULL REFERENCES wh_transfers(id) ON DELETE CASCADE, product_id INTEGER NOT NULL REFERENCES products(id) ON DELETE CASCADE, from_rack_id INTEGER REFERENCES pos_racks(id), to_rack_id INTEGER REFERENCES pos_racks(id), qty_requested NUMERIC(14,3) NOT NULL DEFAULT 0, qty_sent NUMERIC(14,3) NOT NULL DEFAULT 0, qty_received NUMERIC(14,3) NOT NULL DEFAULT 0);`);
    await client.query(`CREATE TABLE IF NOT EXISTS wh_damage_reports (id SERIAL PRIMARY KEY, report_number TEXT NOT NULL UNIQUE, warehouse_id INTEGER NOT NULL REFERENCES pos_warehouses(id), status wh_damage_status NOT NULL DEFAULT 'draft', note TEXT, created_by_id TEXT, confirmed_by_id TEXT, created_at TIMESTAMP NOT NULL DEFAULT NOW(), confirmed_at TIMESTAMP, cancelled_at TIMESTAMP);`);
    await client.query(`CREATE TABLE IF NOT EXISTS wh_damage_lines (id SERIAL PRIMARY KEY, report_id INTEGER NOT NULL REFERENCES wh_damage_reports(id) ON DELETE CASCADE, product_id INTEGER NOT NULL REFERENCES products(id) ON DELETE CASCADE, rack_id INTEGER REFERENCES pos_racks(id), qty NUMERIC(14,3) NOT NULL DEFAULT 0, damage_type wh_damage_type NOT NULL DEFAULT 'rusak', note TEXT);`);
    await client.query(`CREATE TABLE IF NOT EXISTS wh_returns (id SERIAL PRIMARY KEY, return_number TEXT NOT NULL UNIQUE, type wh_return_type NOT NULL, ref_doc_id INTEGER, ref_doc_number TEXT, warehouse_id INTEGER NOT NULL REFERENCES pos_warehouses(id), status wh_return_status NOT NULL DEFAULT 'draft', note TEXT, created_by_id TEXT, created_at TIMESTAMP NOT NULL DEFAULT NOW(), confirmed_at TIMESTAMP, cancelled_at TIMESTAMP);`);
    await client.query(`CREATE TABLE IF NOT EXISTS wh_return_lines (id SERIAL PRIMARY KEY, return_id INTEGER NOT NULL REFERENCES wh_returns(id) ON DELETE CASCADE, product_id INTEGER NOT NULL REFERENCES products(id) ON DELETE CASCADE, rack_id INTEGER REFERENCES pos_racks(id), qty NUMERIC(14,3) NOT NULL DEFAULT 0, unit_cost NUMERIC(14,2) NOT NULL DEFAULT 0, note TEXT);`);
    await client.query(`CREATE TABLE IF NOT EXISTS product_recipes (id SERIAL PRIMARY KEY, product_id INTEGER NOT NULL UNIQUE REFERENCES products(id) ON DELETE CASCADE, yield_qty NUMERIC(12,3) NOT NULL DEFAULT 1, yield_unit TEXT NOT NULL DEFAULT 'pcs', note TEXT, is_active BOOLEAN NOT NULL DEFAULT TRUE, created_at TIMESTAMP NOT NULL DEFAULT NOW(), updated_at TIMESTAMP NOT NULL DEFAULT NOW());`);
    await client.query(`CREATE TABLE IF NOT EXISTS product_recipe_items (id SERIAL PRIMARY KEY, recipe_id INTEGER NOT NULL REFERENCES product_recipes(id) ON DELETE CASCADE, ingredient_product_id INTEGER NOT NULL REFERENCES products(id) ON DELETE CASCADE, qty NUMERIC(12,3) NOT NULL DEFAULT 0, unit TEXT NOT NULL DEFAULT 'pcs', note TEXT);`);
    await client.query(`CREATE TABLE IF NOT EXISTS wh_opnames (id SERIAL PRIMARY KEY, opname_number TEXT NOT NULL UNIQUE, warehouse_id INTEGER NOT NULL REFERENCES pos_warehouses(id), status TEXT NOT NULL DEFAULT 'draft', note TEXT, created_by_id TEXT, confirmed_by_id TEXT, created_at TIMESTAMP NOT NULL DEFAULT NOW(), confirmed_at TIMESTAMP);`);
    await client.query(`CREATE TABLE IF NOT EXISTS wh_opname_lines (id SERIAL PRIMARY KEY, opname_id INTEGER NOT NULL REFERENCES wh_opnames(id) ON DELETE CASCADE, product_id INTEGER NOT NULL REFERENCES products(id) ON DELETE CASCADE, rack_id INTEGER REFERENCES pos_racks(id), system_qty NUMERIC(14,3) NOT NULL DEFAULT 0, actual_qty NUMERIC(14,3) NOT NULL DEFAULT 0, diff_qty NUMERIC(14,3) NOT NULL DEFAULT 0, note TEXT);`);

    await client.query("COMMIT");
    console.log("✅ Warehouse tables created.");
  } catch (err) {
    await client.query("ROLLBACK");
    console.error("❌ Migration failed:", err.message);
    process.exit(1);
  } finally {
    client.release();
    await pool.end();
  }
}

run();
