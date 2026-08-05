import pg from "pg";

const { Pool } = pg;

function resolveConnectionString() {
  const candidates = [
    process.env.SUPABASE_PG_URL,
    process.env.SUPABASE_DATABASE_URL,
    process.env.DATABASE_URL,
  ];
  for (const url of candidates) {
    if (url && /^postgres(?:ql)?:\/\//i.test(url)) {
      return url.replace(/:6543\//, ":5432/");
    }
  }
  throw new Error("No valid PostgreSQL connection string found.");
}

const pool = new Pool({ connectionString: resolveConnectionString() });

const migrations = [
  // logistic_orders new columns
  `ALTER TABLE logistic_orders ADD COLUMN IF NOT EXISTS transport_mode TEXT CHECK (transport_mode IN ('TRUCKING','AIR_FREIGHT','SEA_FREIGHT'))`,
  `ALTER TABLE logistic_orders ADD COLUMN IF NOT EXISTS origin_district TEXT`,
  `ALTER TABLE logistic_orders ADD COLUMN IF NOT EXISTS dest_district TEXT`,
  `ALTER TABLE logistic_orders ADD COLUMN IF NOT EXISTS etd TIMESTAMPTZ`,
  `ALTER TABLE logistic_orders ADD COLUMN IF NOT EXISTS eta TIMESTAMPTZ`,
  `ALTER TABLE logistic_orders ADD COLUMN IF NOT EXISTS origin_port TEXT`,
  `ALTER TABLE logistic_orders ADD COLUMN IF NOT EXISTS dest_port TEXT`,
  `ALTER TABLE logistic_orders ADD COLUMN IF NOT EXISTS weight_kg NUMERIC(12,3)`,
  `ALTER TABLE logistic_orders ADD COLUMN IF NOT EXISTS incoterm TEXT`,
  // customer options token
  `ALTER TABLE logistic_orders ADD COLUMN IF NOT EXISTS options_token TEXT UNIQUE`,
  `ALTER TABLE logistic_orders ADD COLUMN IF NOT EXISTS options_sent_at TIMESTAMPTZ`,
  // suppliers new columns
  `ALTER TABLE suppliers ADD COLUMN IF NOT EXISTS year_vehicle INTEGER`,
  `ALTER TABLE suppliers ADD COLUMN IF NOT EXISTS supported_modes TEXT[]`,
  // vendor_offers table
  `CREATE TABLE IF NOT EXISTS vendor_offers (
    id SERIAL PRIMARY KEY,
    order_id INTEGER REFERENCES logistic_orders(id) ON DELETE CASCADE,
    vendor_id INTEGER REFERENCES suppliers(id) ON DELETE SET NULL,
    transport_mode TEXT,
    offer_price NUMERIC(15,2) NOT NULL DEFAULT 0,
    vehicle_year INTEGER,
    carrier_name TEXT,
    transit_days INTEGER,
    notes TEXT,
    is_selected_by_admin BOOLEAN DEFAULT FALSE,
    final_customer_price NUMERIC(15,2),
    option_label TEXT,
    status TEXT DEFAULT 'PENDING',
    chosen_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ DEFAULT NOW()
  )`,
  `CREATE INDEX IF NOT EXISTS idx_vendor_offers_order ON vendor_offers(order_id)`,
  `CREATE INDEX IF NOT EXISTS idx_vendor_offers_order_admin ON vendor_offers(order_id, is_selected_by_admin)`,
];

let ok = 0;
let fail = 0;
for (const sql of migrations) {
  try {
    await pool.query(sql);
    console.log(`✅ ${sql.slice(0, 70)}...`);
    ok++;
  } catch (e) {
    console.error(`❌ ${sql.slice(0, 70)}\n   Error: ${e.message}`);
    fail++;
  }
}
await pool.end();
console.log(`\nDone: ${ok} ok, ${fail} failed`);
process.exit(fail > 0 ? 1 : 0);
