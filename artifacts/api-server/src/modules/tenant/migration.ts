import { db } from "@workspace/db";
import { sql } from "drizzle-orm";
import { logger } from "../../lib/logger.js";

export async function runTenantMigration(): Promise<void> {
  try {
    await db.execute(sql`
      CREATE TABLE IF NOT EXISTS tenants (
        id SERIAL PRIMARY KEY,
        company_id INTEGER DEFAULT 1,
        user_id INTEGER,
        business_name TEXT NOT NULL,
        owner_name TEXT NOT NULL,
        phone TEXT,
        email TEXT,
        business_category TEXT,
        logo_url TEXT,
        address TEXT,
        status TEXT NOT NULL DEFAULT 'active',
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )
    `);

    await db.execute(sql`
      CREATE TABLE IF NOT EXISTS tenant_units (
        id SERIAL PRIMARY KEY,
        company_id INTEGER NOT NULL DEFAULT 1,
        unit_code TEXT NOT NULL,
        name TEXT NOT NULL,
        area_name TEXT NOT NULL DEFAULT 'Area Kantin',
        unit_type TEXT NOT NULL DEFAULT 'food_booth',
        area_sqm NUMERIC(10,2),
        monthly_rate NUMERIC(14,2),
        status TEXT NOT NULL DEFAULT 'available',
        notes TEXT,
        position_x INTEGER NOT NULL DEFAULT 0,
        position_y INTEGER NOT NULL DEFAULT 0,
        width INTEGER NOT NULL DEFAULT 100,
        height INTEGER NOT NULL DEFAULT 80,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )
    `);

    await db.execute(sql`CREATE UNIQUE INDEX IF NOT EXISTS uq_tenant_units_code_company ON tenant_units(company_id, unit_code)`);
    await db.execute(sql`CREATE INDEX IF NOT EXISTS idx_tenant_units_company ON tenant_units(company_id)`);
    await db.execute(sql`CREATE INDEX IF NOT EXISTS idx_tenant_units_status ON tenant_units(status)`);

    await db.execute(sql`
      CREATE TABLE IF NOT EXISTS tenant_bookings (
        id SERIAL PRIMARY KEY,
        company_id INTEGER DEFAULT 1,
        order_number TEXT NOT NULL,
        tenant_id INTEGER NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
        unit_id INTEGER REFERENCES tenant_units(id) ON DELETE SET NULL,
        user_id INTEGER,
        booking_type TEXT NOT NULL DEFAULT 'rental',
        start_date DATE,
        end_date DATE,
        duration_months INTEGER,
        requested_area TEXT,
        description TEXT,
        price NUMERIC(14,2) NOT NULL DEFAULT 0,
        payment_status TEXT NOT NULL DEFAULT 'unpaid',
        status TEXT NOT NULL DEFAULT 'pending',
        admin_notes TEXT,
        payment_period_type TEXT NOT NULL DEFAULT 'monthly',
        period_start_month INTEGER,
        period_start_year INTEGER,
        period_end_month INTEGER,
        period_end_year INTEGER,
        total_months INTEGER,
        monthly_price NUMERIC(14,2),
        yearly_price NUMERIC(14,2),
        total_price NUMERIC(14,2),
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )
    `);

    await db.execute(sql`
      CREATE TABLE IF NOT EXISTS tenant_payments (
        id SERIAL PRIMARY KEY,
        company_id INTEGER DEFAULT 1,
        tenant_booking_id INTEGER NOT NULL REFERENCES tenant_bookings(id) ON DELETE CASCADE,
        payment_number TEXT,
        proof_image_url TEXT,
        amount NUMERIC(14,2) NOT NULL DEFAULT 0,
        method TEXT NOT NULL DEFAULT 'transfer',
        notes TEXT,
        status TEXT NOT NULL DEFAULT 'pending',
        paid_at TIMESTAMPTZ,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )
    `);

    await db.execute(sql`CREATE INDEX IF NOT EXISTS idx_tenant_bookings_tenant ON tenant_bookings(tenant_id)`);
    await db.execute(sql`CREATE INDEX IF NOT EXISTS idx_tenant_payments_booking ON tenant_payments(tenant_booking_id)`);
    await db.execute(sql`CREATE UNIQUE INDEX IF NOT EXISTS uq_tenant_bookings_order_number ON tenant_bookings(order_number)`);
    await db.execute(sql`CREATE UNIQUE INDEX IF NOT EXISTS uq_tenant_payments_payment_number ON tenant_payments(payment_number)`);

    // ── ALTER tenant_payments: tambah kolom yang dipakai routes tapi tidak ada di schema awal ──
    await db.execute(sql`ALTER TABLE tenant_payments ADD COLUMN IF NOT EXISTS site_id INTEGER`);
    await db.execute(sql`ALTER TABLE tenant_payments ADD COLUMN IF NOT EXISTS tenant_id INTEGER REFERENCES tenants(id) ON DELETE SET NULL`);
    await db.execute(sql`ALTER TABLE tenant_payments ADD COLUMN IF NOT EXISTS invoice_id INTEGER`);
    await db.execute(sql`CREATE INDEX IF NOT EXISTS idx_tenant_payments_tenant ON tenant_payments(tenant_id)`);
    await db.execute(sql`CREATE INDEX IF NOT EXISTS idx_tenant_payments_invoice ON tenant_payments(invoice_id)`);

    // ASK: Accounting Settlement Kit — kolom posting status
    await db.execute(sql`ALTER TABLE tenant_payments ADD COLUMN IF NOT EXISTS posting_status TEXT NOT NULL DEFAULT 'unposted'`);
    await db.execute(sql`ALTER TABLE tenant_payments ADD COLUMN IF NOT EXISTS accounting_payment_id INTEGER`);
    await db.execute(sql`ALTER TABLE tenant_payments ADD COLUMN IF NOT EXISTS posting_error TEXT`);
    await db.execute(sql`CREATE INDEX IF NOT EXISTS idx_tenant_payments_posting_status ON tenant_payments(posting_status)`);

    await db.execute(sql`ALTER TABLE tenant_bookings ADD COLUMN IF NOT EXISTS unit_id INTEGER REFERENCES tenant_units(id) ON DELETE SET NULL`);
    await db.execute(sql`CREATE INDEX IF NOT EXISTS idx_tenant_bookings_unit ON tenant_bookings(unit_id)`);

    await db.execute(sql`
      CREATE TABLE IF NOT EXISTS tenant_invoices (
        id SERIAL PRIMARY KEY,
        company_id INTEGER DEFAULT 1,
        invoice_number TEXT NOT NULL UNIQUE,
        tenant_id INTEGER NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
        tenant_booking_id INTEGER REFERENCES tenant_bookings(id) ON DELETE SET NULL,
        tenant_payment_id INTEGER REFERENCES tenant_payments(id) ON DELETE SET NULL,
        title TEXT NOT NULL DEFAULT 'Invoice Sewa',
        period_label TEXT,
        amount NUMERIC(14,2) NOT NULL DEFAULT 0,
        tax_amount NUMERIC(14,2) NOT NULL DEFAULT 0,
        total_amount NUMERIC(14,2) NOT NULL DEFAULT 0,
        due_date DATE,
        issued_date DATE NOT NULL DEFAULT CURRENT_DATE,
        status TEXT NOT NULL DEFAULT 'draft',
        notes TEXT,
        created_by INTEGER,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )
    `);
    await db.execute(sql`CREATE INDEX IF NOT EXISTS idx_tenant_invoices_tenant ON tenant_invoices(tenant_id)`);
    await db.execute(sql`CREATE INDEX IF NOT EXISTS idx_tenant_invoices_status ON tenant_invoices(status)`);

    // ── ALTER tenant_invoices: kolom baru yang dipakai routes tapi tidak ada di schema awal ──
    await db.execute(sql`ALTER TABLE tenant_invoices ADD COLUMN IF NOT EXISTS site_id INTEGER`);
    await db.execute(sql`ALTER TABLE tenant_invoices ADD COLUMN IF NOT EXISTS booking_id INTEGER REFERENCES tenant_bookings(id) ON DELETE SET NULL`);
    await db.execute(sql`ALTER TABLE tenant_invoices ADD COLUMN IF NOT EXISTS unit_code TEXT`);
    await db.execute(sql`ALTER TABLE tenant_invoices ADD COLUMN IF NOT EXISTS period_start DATE`);
    await db.execute(sql`ALTER TABLE tenant_invoices ADD COLUMN IF NOT EXISTS period_end DATE`);
    await db.execute(sql`ALTER TABLE tenant_invoices ADD COLUMN IF NOT EXISTS rent_amount NUMERIC(14,2) NOT NULL DEFAULT 0`);
    await db.execute(sql`ALTER TABLE tenant_invoices ADD COLUMN IF NOT EXISTS subtotal NUMERIC(14,2) NOT NULL DEFAULT 0`);
    await db.execute(sql`ALTER TABLE tenant_invoices ADD COLUMN IF NOT EXISTS discount_amount NUMERIC(14,2) NOT NULL DEFAULT 0`);
    await db.execute(sql`ALTER TABLE tenant_invoices ADD COLUMN IF NOT EXISTS penalty_amount NUMERIC(14,2) NOT NULL DEFAULT 0`);
    await db.execute(sql`ALTER TABLE tenant_invoices ADD COLUMN IF NOT EXISTS paid_amount NUMERIC(14,2) NOT NULL DEFAULT 0`);
    await db.execute(sql`ALTER TABLE tenant_invoices ADD COLUMN IF NOT EXISTS outstanding_amount NUMERIC(14,2) NOT NULL DEFAULT 0`);
    await db.execute(sql`ALTER TABLE tenant_invoices ADD COLUMN IF NOT EXISTS sent_at TIMESTAMPTZ`);
    await db.execute(sql`ALTER TABLE tenant_invoices ADD COLUMN IF NOT EXISTS paid_at TIMESTAMPTZ`);
    await db.execute(sql`ALTER TABLE tenant_invoices ADD COLUMN IF NOT EXISTS cancelled_at TIMESTAMPTZ`);
    await db.execute(sql`CREATE INDEX IF NOT EXISTS idx_tenant_invoices_booking ON tenant_invoices(booking_id)`);

    await db.execute(sql`
      CREATE TABLE IF NOT EXISTS tenant_user_access (
        id SERIAL PRIMARY KEY,
        user_id TEXT NOT NULL,
        tenant_id INTEGER NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
        site_id INTEGER,
        access_level TEXT NOT NULL DEFAULT 'viewer',
        status TEXT NOT NULL DEFAULT 'active',
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )
    `);
    await db.execute(sql`CREATE INDEX IF NOT EXISTS idx_tenant_user_access_tenant ON tenant_user_access(tenant_id)`);
    await db.execute(sql`CREATE INDEX IF NOT EXISTS idx_tenant_user_access_user ON tenant_user_access(user_id)`);

    await db.execute(sql`
      CREATE TABLE IF NOT EXISTS mall_sites (
        id SERIAL PRIMARY KEY,
        code TEXT NOT NULL UNIQUE,
        name TEXT NOT NULL,
        type TEXT NOT NULL DEFAULT 'mall_tenant',
        address TEXT,
        status TEXT NOT NULL DEFAULT 'active',
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )
    `);
    await db.execute(sql`
      CREATE TABLE IF NOT EXISTS mall_units (
        id SERIAL PRIMARY KEY,
        site_id INTEGER NOT NULL REFERENCES mall_sites(id) ON DELETE CASCADE,
        unit_code TEXT NOT NULL,
        floor TEXT,
        zone TEXT,
        size_m2 NUMERIC(10,2),
        status TEXT NOT NULL DEFAULT 'available',
        position_x INTEGER NOT NULL DEFAULT 0,
        position_y INTEGER NOT NULL DEFAULT 0,
        width INTEGER NOT NULL DEFAULT 2,
        height INTEGER NOT NULL DEFAULT 2,
        notes TEXT,
        unit_type TEXT NOT NULL DEFAULT 'food_booth',
        area_kantin TEXT,
        default_rent_amount NUMERIC(14,2) NOT NULL DEFAULT 0,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )
    `);
    await db.execute(sql`CREATE INDEX IF NOT EXISTS idx_mall_units_site ON mall_units(site_id)`);
    await db.execute(sql`CREATE INDEX IF NOT EXISTS idx_mall_units_status ON mall_units(status)`);

    // ── KASIR TABLES ──────────────────────────────────────────────────────────
    await db.execute(sql`
      CREATE TABLE IF NOT EXISTS kasir_companies (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        name TEXT NOT NULL,
        address TEXT,
        phone TEXT,
        is_active BOOLEAN NOT NULL DEFAULT TRUE,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )
    `);

    await db.execute(sql`
      CREATE TABLE IF NOT EXISTS kasir_branches (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        company_id UUID REFERENCES kasir_companies(id) ON DELETE CASCADE,
        code TEXT NOT NULL,
        name TEXT NOT NULL,
        address TEXT,
        phone TEXT,
        is_active BOOLEAN NOT NULL DEFAULT TRUE,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )
    `);
    await db.execute(sql`CREATE INDEX IF NOT EXISTS idx_kasir_branches_company ON kasir_branches(company_id)`);

    await db.execute(sql`
      CREATE TABLE IF NOT EXISTS kasir_users (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        username TEXT NOT NULL UNIQUE,
        password_hash TEXT NOT NULL DEFAULT '',
        full_name TEXT,
        role TEXT NOT NULL DEFAULT 'cashier',
        branch_id UUID REFERENCES kasir_branches(id) ON DELETE SET NULL,
        is_active BOOLEAN NOT NULL DEFAULT TRUE,
        status TEXT NOT NULL DEFAULT 'active',
        phone TEXT,
        email TEXT,
        whatsapp_number TEXT,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )
    `);
    await db.execute(sql`CREATE INDEX IF NOT EXISTS idx_kasir_users_branch ON kasir_users(branch_id)`);

    await db.execute(sql`
      CREATE TABLE IF NOT EXISTS kasir_categories (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        name TEXT NOT NULL,
        color TEXT,
        sort_order INTEGER NOT NULL DEFAULT 0,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )
    `);

    await db.execute(sql`
      CREATE TABLE IF NOT EXISTS kasir_products (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        name TEXT NOT NULL,
        sku TEXT,
        description TEXT,
        price NUMERIC(14,2) NOT NULL DEFAULT 0,
        category_id UUID REFERENCES kasir_categories(id) ON DELETE SET NULL,
        image_url TEXT,
        is_active BOOLEAN NOT NULL DEFAULT TRUE,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )
    `);
    await db.execute(sql`CREATE INDEX IF NOT EXISTS idx_kasir_products_category ON kasir_products(category_id)`);

    await db.execute(sql`
      CREATE TABLE IF NOT EXISTS kasir_devices (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        branch_id UUID REFERENCES kasir_branches(id) ON DELETE CASCADE,
        name TEXT NOT NULL,
        device_type TEXT NOT NULL DEFAULT 'tablet',
        is_active BOOLEAN NOT NULL DEFAULT TRUE,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )
    `);
    await db.execute(sql`CREATE INDEX IF NOT EXISTS idx_kasir_devices_branch ON kasir_devices(branch_id)`);

    await db.execute(sql`
      CREATE TABLE IF NOT EXISTS kasir_ingredients (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        branch_id UUID REFERENCES kasir_branches(id) ON DELETE CASCADE,
        name TEXT NOT NULL,
        unit TEXT NOT NULL DEFAULT 'pcs',
        stock_qty NUMERIC(14,3) NOT NULL DEFAULT 0,
        min_stock NUMERIC(14,3) NOT NULL DEFAULT 0,
        cost NUMERIC(14,2) NOT NULL DEFAULT 0,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )
    `);
    await db.execute(sql`CREATE INDEX IF NOT EXISTS idx_kasir_ingredients_branch ON kasir_ingredients(branch_id)`);

    logger.info("Tenant migration OK (incl. kasir tables)");
  } catch (err) {
    logger.error({ err }, "Tenant migration failed");
    throw err;
  }
}
