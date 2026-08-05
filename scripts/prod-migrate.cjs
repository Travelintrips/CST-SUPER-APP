#!/usr/bin/env node
"use strict";
const { Pool } = require('pg');

const PROD_URL = process.env.PROD_DB_URL;
if (!PROD_URL) { console.error('Set PROD_DB_URL'); process.exit(1); }

const pool = new Pool({ connectionString: PROD_URL, ssl: false, max: 3, connectionTimeoutMillis: 15000 });

const migrations = [
  ['companies', `CREATE TABLE IF NOT EXISTS companies (
    id SERIAL PRIMARY KEY, name TEXT NOT NULL, code TEXT UNIQUE,
    address TEXT, phone TEXT, email TEXT, tax_id TEXT, logo_url TEXT,
    is_active BOOLEAN DEFAULT true, parent_company_id INT,
    industry TEXT, created_at TIMESTAMPTZ DEFAULT NOW(), updated_at TIMESTAMPTZ DEFAULT NOW())`],
  ['users', `CREATE TABLE IF NOT EXISTS users (
    id TEXT PRIMARY KEY, email TEXT UNIQUE NOT NULL, first_name TEXT, last_name TEXT,
    profile_image_url TEXT, role TEXT DEFAULT 'user', company_id INT REFERENCES companies(id),
    is_active BOOLEAN DEFAULT true, created_at TIMESTAMPTZ DEFAULT NOW(), updated_at TIMESTAMPTZ DEFAULT NOW())`],
  ['sessions', `CREATE TABLE IF NOT EXISTS sessions (
    sid TEXT PRIMARY KEY, sess JSONB NOT NULL, expire TIMESTAMPTZ NOT NULL);
    CREATE INDEX IF NOT EXISTS sessions_expire_idx ON sessions(expire)`],
  ['erp_audit_logs', `CREATE TABLE IF NOT EXISTS erp_audit_logs (
    id SERIAL PRIMARY KEY, action TEXT NOT NULL, module TEXT, reference_id INT,
    old_data JSONB, new_data JSONB, user_id TEXT, company_id INT, created_at TIMESTAMPTZ DEFAULT NOW())`],
  ['mall_sites', `CREATE TABLE IF NOT EXISTS mall_sites (
    id SERIAL PRIMARY KEY, company_id INT, name TEXT NOT NULL,
    address TEXT, city TEXT, notes TEXT, created_at TIMESTAMPTZ DEFAULT NOW())`],
  ['mall_units', `CREATE TABLE IF NOT EXISTS mall_units (
    id SERIAL PRIMARY KEY, site_id INT REFERENCES mall_sites(id), unit_code TEXT NOT NULL,
    floor TEXT, zone TEXT, size_m2 NUMERIC(10,2), status TEXT DEFAULT 'available',
    position_x INT DEFAULT 0, position_y INT DEFAULT 0, width INT DEFAULT 1, height INT DEFAULT 1,
    notes TEXT, unit_type TEXT DEFAULT 'other', tenant_name TEXT,
    created_at TIMESTAMPTZ DEFAULT NOW(), updated_at TIMESTAMPTZ DEFAULT NOW())`],
  ['tenants', `CREATE TABLE IF NOT EXISTS tenants (
    id SERIAL PRIMARY KEY, company_id INT, user_id TEXT, business_name TEXT NOT NULL,
    owner_name TEXT, phone TEXT, email TEXT, business_category TEXT, logo_url TEXT, address TEXT,
    status TEXT DEFAULT 'active', created_at TIMESTAMPTZ DEFAULT NOW(), updated_at TIMESTAMPTZ DEFAULT NOW())`],
  ['tenant_units', `CREATE TABLE IF NOT EXISTS tenant_units (
    id SERIAL PRIMARY KEY, company_id INT, unit_code TEXT NOT NULL, name TEXT,
    area_name TEXT, unit_type TEXT, area_sqm NUMERIC(10,2), monthly_rate NUMERIC(15,2),
    status TEXT DEFAULT 'available', notes TEXT, position_x INT DEFAULT 0, position_y INT DEFAULT 0,
    width INT DEFAULT 1, height INT DEFAULT 1, created_at TIMESTAMPTZ DEFAULT NOW(), updated_at TIMESTAMPTZ DEFAULT NOW())`],
  ['tenant_bookings', `CREATE TABLE IF NOT EXISTS tenant_bookings (
    id SERIAL PRIMARY KEY, company_id INT, order_number TEXT UNIQUE, tenant_id INT REFERENCES tenants(id),
    unit_id INT REFERENCES tenant_units(id), site_id INT REFERENCES mall_sites(id), user_id TEXT,
    booking_type TEXT DEFAULT 'sewa', start_date DATE, end_date DATE, duration_months INT,
    requested_area TEXT, description TEXT, price NUMERIC(15,2), payment_status TEXT DEFAULT 'unpaid',
    status TEXT DEFAULT 'active', admin_notes TEXT, payment_period_type TEXT,
    period_start_month INT, period_start_year INT, period_end_month INT, period_end_year INT,
    total_months INT, monthly_price NUMERIC(15,2), yearly_price NUMERIC(15,2), total_price NUMERIC(15,2),
    created_at TIMESTAMPTZ DEFAULT NOW(), updated_at TIMESTAMPTZ DEFAULT NOW())`],
  ['tenant_invoices', `CREATE TABLE IF NOT EXISTS tenant_invoices (
    id SERIAL PRIMARY KEY, company_id INT, invoice_number TEXT UNIQUE, tenant_id INT,
    tenant_booking_id INT, tenant_payment_id INT, site_id INT REFERENCES mall_sites(id),
    title TEXT, period_label TEXT, amount NUMERIC(15,2), tax_amount NUMERIC(15,2) DEFAULT 0,
    total_amount NUMERIC(15,2), due_date DATE, issued_date DATE DEFAULT CURRENT_DATE,
    status TEXT DEFAULT 'unpaid', notes TEXT, created_by TEXT, booking_id INT, unit_code TEXT,
    period_start DATE, period_end DATE, rent_amount NUMERIC(15,2), subtotal NUMERIC(15,2),
    discount_amount NUMERIC(15,2) DEFAULT 0, penalty_amount NUMERIC(15,2) DEFAULT 0,
    paid_amount NUMERIC(15,2) DEFAULT 0, outstanding_amount NUMERIC(15,2),
    sent_at TIMESTAMPTZ, paid_at TIMESTAMPTZ, cancelled_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ DEFAULT NOW(), updated_at TIMESTAMPTZ DEFAULT NOW())`],
  ['tenant_payments', `CREATE TABLE IF NOT EXISTS tenant_payments (
    id SERIAL PRIMARY KEY, company_id INT, tenant_booking_id INT, site_id INT REFERENCES mall_sites(id),
    payment_number TEXT UNIQUE, proof_image_url TEXT, amount NUMERIC(15,2), method TEXT,
    notes TEXT, status TEXT DEFAULT 'pending', paid_at TIMESTAMPTZ, tenant_id INT, invoice_id INT,
    posting_status TEXT DEFAULT 'unposted', accounting_payment_id INT,
    created_at TIMESTAMPTZ DEFAULT NOW(), updated_at TIMESTAMPTZ DEFAULT NOW())`],
  ['sport_customers', `CREATE TABLE IF NOT EXISTS sport_customers (
    id SERIAL PRIMARY KEY, company_id INT, name TEXT NOT NULL, email TEXT, phone TEXT,
    address TEXT, notes TEXT, created_at TIMESTAMPTZ DEFAULT NOW(), updated_at TIMESTAMPTZ DEFAULT NOW())`],
  ['sport_facilities', `CREATE TABLE IF NOT EXISTS sport_facilities (
    id SERIAL PRIMARY KEY, company_id INT, name TEXT NOT NULL, type TEXT, description TEXT,
    capacity INT, price_per_hour NUMERIC(15,2), is_active BOOLEAN DEFAULT true,
    image_url TEXT, sort_order INT DEFAULT 0, created_at TIMESTAMPTZ DEFAULT NOW(), updated_at TIMESTAMPTZ DEFAULT NOW())`],
  ['sport_bookings', `CREATE TABLE IF NOT EXISTS sport_bookings (
    id SERIAL PRIMARY KEY, company_id INT DEFAULT 1, booking_number TEXT UNIQUE,
    customer_id INT REFERENCES sport_customers(id), customer_name TEXT, customer_phone TEXT,
    customer_email TEXT, facility_id INT REFERENCES sport_facilities(id),
    booking_date DATE NOT NULL, start_time TIME NOT NULL, end_time TIME NOT NULL,
    duration_hours NUMERIC(4,1), price NUMERIC(15,2), total_price NUMERIC(15,2),
    down_payment NUMERIC(15,2) DEFAULT 0, payment_method TEXT,
    status TEXT DEFAULT 'pending', payment_status TEXT DEFAULT 'unpaid',
    notes TEXT, checked_in_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ DEFAULT NOW(), updated_at TIMESTAMPTZ DEFAULT NOW())`],
  ['sport_payments', `CREATE TABLE IF NOT EXISTS sport_payments (
    id SERIAL PRIMARY KEY, company_id INT DEFAULT 1, payment_number TEXT UNIQUE,
    booking_id INT REFERENCES sport_bookings(id), customer_name TEXT,
    amount NUMERIC(15,2), payment_method TEXT, payment_type TEXT DEFAULT 'booking',
    status TEXT DEFAULT 'paid', notes TEXT, paid_at TIMESTAMPTZ DEFAULT NOW(),
    created_at TIMESTAMPTZ DEFAULT NOW(), updated_at TIMESTAMPTZ DEFAULT NOW())`],
  ['sport_members', `CREATE TABLE IF NOT EXISTS sport_members (
    id SERIAL PRIMARY KEY, company_id INT, customer_id INT REFERENCES sport_customers(id),
    name TEXT NOT NULL, email TEXT, phone TEXT, member_type TEXT DEFAULT 'regular',
    member_number TEXT UNIQUE, start_date DATE, end_date DATE,
    status TEXT DEFAULT 'active', notes TEXT,
    created_at TIMESTAMPTZ DEFAULT NOW(), updated_at TIMESTAMPTZ DEFAULT NOW())`],
  ['sport_expenses', `CREATE TABLE IF NOT EXISTS sport_expenses (
    id SERIAL PRIMARY KEY, company_id INT, description TEXT, amount NUMERIC(15,2),
    category TEXT, expense_date DATE, notes TEXT,
    created_at TIMESTAMPTZ DEFAULT NOW(), updated_at TIMESTAMPTZ DEFAULT NOW())`],
  ['kasir_branches', `CREATE TABLE IF NOT EXISTS kasir_branches (
    id SERIAL PRIMARY KEY, company_id INT, name TEXT NOT NULL, code TEXT,
    address TEXT, is_active BOOLEAN DEFAULT true,
    created_at TIMESTAMPTZ DEFAULT NOW(), updated_at TIMESTAMPTZ DEFAULT NOW())`],
  ['kasir_products', `CREATE TABLE IF NOT EXISTS kasir_products (
    id SERIAL PRIMARY KEY, company_id INT, branch_id INT REFERENCES kasir_branches(id),
    name TEXT NOT NULL, sku TEXT, price NUMERIC(15,2), cost NUMERIC(15,2),
    category TEXT, stock INT DEFAULT 0, unit TEXT DEFAULT 'pcs', image_url TEXT,
    is_active BOOLEAN DEFAULT true, created_at TIMESTAMPTZ DEFAULT NOW(), updated_at TIMESTAMPTZ DEFAULT NOW())`],
];

async function run() {
  try {
    const ping = await pool.query("SELECT COUNT(*) FROM information_schema.tables WHERE table_schema='public'");
    console.log('[prod-migrate] Koneksi OK. Tabel saat ini:', ping.rows[0].count);
  } catch(e) {
    console.error('[prod-migrate] Koneksi GAGAL:', e.message);
    process.exit(1);
  }

  let ok = 0, fail = 0;
  for (const [name, sql] of migrations) {
    try {
      await pool.query(sql);
      console.log('  ✅', name);
      ok++;
    } catch(e) {
      console.error('  ❌', name + ':', e.message.split('\n')[0]);
      fail++;
    }
  }
  console.log(`\n[prod-migrate] DDL: ${ok} OK, ${fail} gagal`);

  // Seed minimal
  const seeds = [
    ["companies", `INSERT INTO companies (id,name,code) VALUES (1,'PT Cahaya Sejati Teknologi','CST'),(2,'PT Wangsamas','WMS'),(3,'PT Diva Servis','DVS'),(4,'PT Elmira Ratu Abadi','ERA') ON CONFLICT DO NOTHING`],
    ["mall_sites", `INSERT INTO mall_sites (id,company_id,name) VALUES (1,1,'TOD M1 Bandara'),(2,1,'Sport Center Bandara') ON CONFLICT (id) DO NOTHING`],
  ];
  for (const [name, sql] of seeds) {
    try { await pool.query(sql); console.log('  ✅ seed', name); }
    catch(e) { console.error('  ❌ seed', name+':', e.message.split('\n')[0]); }
  }

  // Final verify
  const tables = ['companies','tenants','tenant_units','tenant_bookings','tenant_invoices',
    'tenant_payments','mall_units','sport_facilities','sport_bookings','sport_members'];
  console.log('\n[prod-migrate] Verifikasi tabel PROD:');
  for (const t of tables) {
    try {
      const r = await pool.query(`SELECT COUNT(*) FROM ${t}`);
      console.log(`  ✅ ${t}: ${r.rows[0].count} rows`);
    } catch(e) { console.error(`  ❌ ${t}: MISSING`); }
  }

  await pool.end();
}

run().catch(e => { console.error(e); process.exit(1); });
