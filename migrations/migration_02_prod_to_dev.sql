-- ============================================================
-- MIGRATION 2: Sinkronisasi PROD → DEV
-- Deskripsi : Tabel & kolom yang ada di PROD belum ada di DEV
-- Aturan    : Idempotent, tidak DROP, tidak hapus data
-- Tanggal   : 2026-07-07
-- Jalankan  : psql "$SUPABASE_DATABASE_URL_DEV" -f migration_02_prod_to_dev.sql
-- ============================================================

BEGIN;

-- ────────────────────────────────────────────────────────────
-- BAGIAN 1: Kolom baru di tabel yang sudah ada di DEV
-- ────────────────────────────────────────────────────────────

-- public.pos_orders
ALTER TABLE public.pos_orders ADD COLUMN IF NOT EXISTS customer_note TEXT;
ALTER TABLE public.pos_orders ADD COLUMN IF NOT EXISTS source TEXT;
ALTER TABLE public.pos_orders ADD COLUMN IF NOT EXISTS table_number TEXT;

-- public.pos_products
ALTER TABLE public.pos_products ADD COLUMN IF NOT EXISTS company_id INTEGER;
ALTER TABLE public.pos_products ADD COLUMN IF NOT EXISTS linked_product_id INTEGER;
ALTER TABLE public.pos_products ADD COLUMN IF NOT EXISTS product_type TEXT DEFAULT 'standard';

-- public.purchase_documents
ALTER TABLE public.purchase_documents ADD COLUMN IF NOT EXISTS logistic_order_id INTEGER;
ALTER TABLE public.purchase_documents ADD COLUMN IF NOT EXISTS mkt_purchase_order_id INTEGER;

-- public.drivers
ALTER TABLE public.drivers ADD COLUMN IF NOT EXISTS driver_type TEXT DEFAULT 'internal';

-- public.driver_jobs
ALTER TABLE public.driver_jobs ADD COLUMN IF NOT EXISTS vendor_id INTEGER;

-- public.vendor_responses
ALTER TABLE public.vendor_responses ADD COLUMN IF NOT EXISTS vendor_id INTEGER;

-- public.customers
ALTER TABLE public.customers ADD COLUMN IF NOT EXISTS typical_cargo_types TEXT;
ALTER TABLE public.customers ADD COLUMN IF NOT EXISTS typical_routes TEXT;

-- public.uom
ALTER TABLE public.uom ADD COLUMN IF NOT EXISTS code TEXT;

-- public.payroll_runs
ALTER TABLE public.payroll_runs ADD COLUMN IF NOT EXISTS payment_entry_id INTEGER;

-- public.rfq_vendor_links
ALTER TABLE public.rfq_vendor_links ADD COLUMN IF NOT EXISTS reminded_at TIMESTAMPTZ;

-- public.logistic_order_items
ALTER TABLE public.logistic_order_items ADD COLUMN IF NOT EXISTS template_snapshot JSONB;

-- public.driver_portal_tokens
ALTER TABLE public.driver_portal_tokens ADD COLUMN IF NOT EXISTS used_at TIMESTAMPTZ;

-- sport_center.sport_bookings
ALTER TABLE sport_center.sport_bookings ADD COLUMN IF NOT EXISTS booking_group_id TEXT;
ALTER TABLE sport_center.sport_bookings ADD COLUMN IF NOT EXISTS promo_id INTEGER;
ALTER TABLE sport_center.sport_bookings ADD COLUMN IF NOT EXISTS sub_total NUMERIC(12,2);

-- sport_center.sport_payments
ALTER TABLE sport_center.sport_payments ADD COLUMN IF NOT EXISTS payment_channel TEXT;
ALTER TABLE sport_center.sport_payments ADD COLUMN IF NOT EXISTS reference_number TEXT;
ALTER TABLE sport_center.sport_payments ADD COLUMN IF NOT EXISTS verified_at TIMESTAMPTZ;
ALTER TABLE sport_center.sport_payments ADD COLUMN IF NOT EXISTS verified_by TEXT;

-- sport_center.promos
ALTER TABLE sport_center.promos ADD COLUMN IF NOT EXISTS current_uses INTEGER DEFAULT 0;
ALTER TABLE sport_center.promos ADD COLUMN IF NOT EXISTS minimum_booking_amount NUMERIC(12,2);
ALTER TABLE sport_center.promos ADD COLUMN IF NOT EXISTS promo_type TEXT DEFAULT 'discount';

-- ────────────────────────────────────────────────────────────
-- BAGIAN 2: Tabel baru — HR Kasbon (5 tabel)
-- ────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.hr_kasbon (
    id              SERIAL PRIMARY KEY,
    company_id      INTEGER,
    employee_id     INTEGER NOT NULL,
    amount          NUMERIC(15,2) NOT NULL,
    purpose         TEXT,
    status          TEXT DEFAULT 'pending',
    approved_by     INTEGER,
    approved_at     TIMESTAMPTZ,
    disbursed_at    TIMESTAMPTZ,
    notes           TEXT,
    created_at      TIMESTAMPTZ DEFAULT now(),
    updated_at      TIMESTAMPTZ DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_hr_kasbon_company    ON public.hr_kasbon(company_id);
CREATE INDEX IF NOT EXISTS idx_hr_kasbon_employee   ON public.hr_kasbon(employee_id);
CREATE INDEX IF NOT EXISTS idx_hr_kasbon_status     ON public.hr_kasbon(status);

CREATE TABLE IF NOT EXISTS public.hr_kasbon_installments (
    id              SERIAL PRIMARY KEY,
    kasbon_id       INTEGER NOT NULL,
    due_date        DATE NOT NULL,
    amount          NUMERIC(15,2) NOT NULL,
    paid_amount     NUMERIC(15,2) DEFAULT 0,
    status          TEXT DEFAULT 'unpaid',
    paid_at         TIMESTAMPTZ,
    notes           TEXT,
    created_at      TIMESTAMPTZ DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_hr_kasbon_inst_kasbon ON public.hr_kasbon_installments(kasbon_id);

CREATE TABLE IF NOT EXISTS public.employee_kasbon (
    id              SERIAL PRIMARY KEY,
    employee_id     INTEGER NOT NULL,
    company_id      INTEGER,
    amount          NUMERIC(15,2) NOT NULL,
    purpose         TEXT,
    status          TEXT DEFAULT 'pending',
    request_date    DATE DEFAULT CURRENT_DATE,
    approved_by     INTEGER,
    approved_at     TIMESTAMPTZ,
    notes           TEXT,
    created_at      TIMESTAMPTZ DEFAULT now(),
    updated_at      TIMESTAMPTZ DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_employee_kasbon_emp  ON public.employee_kasbon(employee_id);

CREATE TABLE IF NOT EXISTS public.employee_advances (
    id              SERIAL PRIMARY KEY,
    employee_id     INTEGER NOT NULL,
    company_id      INTEGER,
    advance_number  TEXT,
    amount          NUMERIC(15,2) NOT NULL,
    purpose         TEXT,
    status          TEXT DEFAULT 'draft',
    approved_by     INTEGER,
    approved_at     TIMESTAMPTZ,
    disbursed_at    TIMESTAMPTZ,
    fully_repaid_at TIMESTAMPTZ,
    balance         NUMERIC(15,2) DEFAULT 0,
    notes           TEXT,
    created_at      TIMESTAMPTZ DEFAULT now(),
    updated_at      TIMESTAMPTZ DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_employee_advances_emp ON public.employee_advances(employee_id);

CREATE TABLE IF NOT EXISTS public.cash_advance_installments (
    id              SERIAL PRIMARY KEY,
    advance_id      INTEGER NOT NULL,
    due_date        DATE NOT NULL,
    amount          NUMERIC(15,2) NOT NULL,
    paid_amount     NUMERIC(15,2) DEFAULT 0,
    status          TEXT DEFAULT 'unpaid',
    paid_at         TIMESTAMPTZ,
    payroll_run_id  INTEGER,
    notes           TEXT,
    created_at      TIMESTAMPTZ DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_cash_adv_inst_advance ON public.cash_advance_installments(advance_id);

-- ────────────────────────────────────────────────────────────
-- BAGIAN 3: Tabel baru — Sales Delivery (2 tabel)
-- ────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.sales_deliveries (
    id              SERIAL PRIMARY KEY,
    company_id      INTEGER,
    sales_order_id  INTEGER,
    delivery_number TEXT,
    status          TEXT DEFAULT 'pending',
    scheduled_date  DATE,
    delivered_at    TIMESTAMPTZ,
    driver_id       INTEGER,
    vehicle_plate   TEXT,
    recipient_name  TEXT,
    recipient_phone TEXT,
    delivery_address TEXT,
    notes           TEXT,
    created_at      TIMESTAMPTZ DEFAULT now(),
    updated_at      TIMESTAMPTZ DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_sales_deliveries_company ON public.sales_deliveries(company_id);
CREATE INDEX IF NOT EXISTS idx_sales_deliveries_order   ON public.sales_deliveries(sales_order_id);

CREATE TABLE IF NOT EXISTS public.sales_delivery_lines (
    id              SERIAL PRIMARY KEY,
    delivery_id     INTEGER NOT NULL,
    product_id      INTEGER,
    product_name    TEXT NOT NULL,
    quantity        NUMERIC(12,3) NOT NULL,
    uom             TEXT,
    notes           TEXT,
    created_at      TIMESTAMPTZ DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_sales_del_lines_delivery ON public.sales_delivery_lines(delivery_id);

-- ────────────────────────────────────────────────────────────
-- BAGIAN 4: Schema & tabel baru — TravelInTrips (8 tabel)
-- ────────────────────────────────────────────────────────────

CREATE SCHEMA IF NOT EXISTS travelintrips;

CREATE TABLE IF NOT EXISTS travelintrips.users (
    id              SERIAL PRIMARY KEY,
    email           TEXT NOT NULL,
    name            TEXT,
    phone           TEXT,
    password_hash   TEXT,
    role            TEXT DEFAULT 'customer',
    is_active       BOOLEAN DEFAULT true,
    created_at      TIMESTAMPTZ DEFAULT now(),
    updated_at      TIMESTAMPTZ DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS travelintrips_users_email_key ON travelintrips.users(email);

CREATE TABLE IF NOT EXISTS travelintrips.banners (
    id          SERIAL PRIMARY KEY,
    title       TEXT,
    image_url   TEXT NOT NULL,
    link_url    TEXT,
    sort_order  INTEGER DEFAULT 0,
    is_active   BOOLEAN DEFAULT true,
    created_at  TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE IF NOT EXISTS travelintrips.products (
    id              SERIAL PRIMARY KEY,
    name            TEXT NOT NULL,
    slug            TEXT,
    description     TEXT,
    price           NUMERIC(12,2) NOT NULL,
    image_url       TEXT,
    category        TEXT,
    is_active       BOOLEAN DEFAULT true,
    stock           INTEGER,
    sort_order      INTEGER DEFAULT 0,
    metadata        JSONB,
    created_at      TIMESTAMPTZ DEFAULT now(),
    updated_at      TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE IF NOT EXISTS travelintrips.pages (
    id          SERIAL PRIMARY KEY,
    title       TEXT NOT NULL,
    slug        TEXT NOT NULL,
    content     TEXT,
    is_active   BOOLEAN DEFAULT true,
    created_at  TIMESTAMPTZ DEFAULT now(),
    updated_at  TIMESTAMPTZ DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS travelintrips_pages_slug_key ON travelintrips.pages(slug);

CREATE TABLE IF NOT EXISTS travelintrips.page_products (
    id          SERIAL PRIMARY KEY,
    page_id     INTEGER NOT NULL,
    product_id  INTEGER NOT NULL,
    sort_order  INTEGER DEFAULT 0
);
CREATE INDEX IF NOT EXISTS idx_travelintrips_page_products_page ON travelintrips.page_products(page_id);

CREATE TABLE IF NOT EXISTS travelintrips.orders (
    id                      SERIAL PRIMARY KEY,
    customer_name           TEXT,
    customer_phone          TEXT,
    customer_address        TEXT,
    email                   TEXT,
    status                  TEXT DEFAULT 'pending',
    total                   NUMERIC(12,2) NOT NULL,
    notes                   TEXT,
    product_id              INTEGER,
    ticket_image            TEXT,
    harga                   NUMERIC(12,2),
    kode_penerbangan        TEXT,
    tanggal_penerbangan     TEXT,
    anggota_keluarga        TEXT,
    nomor_anggota_keluarga  TEXT,
    nama_produk             TEXT,
    certificate_number      TEXT,
    rute                    TEXT,
    flight_code             TEXT,
    flight_date             TEXT,
    departure               TEXT,
    arrival                 TEXT,
    gate                    TEXT,
    boarding_time           TEXT,
    seat                    TEXT,
    class_code              TEXT,
    pnr                     TEXT,
    paylabs_order_id        TEXT,
    paylabs_merchant_trade_no TEXT,
    paylabs_payment_url     TEXT,
    paylabs_va_number       TEXT,
    paylabs_qr_code         TEXT,
    paylabs_payment_type    TEXT,
    paylabs_paid_at         TIMESTAMPTZ,
    paylabs_transaction_id  TEXT,
    created_at              TIMESTAMPTZ DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_travelintrips_orders_email ON travelintrips.orders(email);

CREATE TABLE IF NOT EXISTS travelintrips.cart_items (
    id          SERIAL PRIMARY KEY,
    session_id  TEXT NOT NULL,
    product_id  INTEGER NOT NULL,
    quantity    INTEGER DEFAULT 1 NOT NULL,
    created_at  TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE IF NOT EXISTS travelintrips.order_items (
    id              SERIAL PRIMARY KEY,
    order_id        INTEGER NOT NULL,
    product_id      INTEGER NOT NULL,
    product_name    TEXT NOT NULL,
    quantity        INTEGER NOT NULL,
    price           NUMERIC(12,2) NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_travelintrips_order_items_order ON travelintrips.order_items(order_id);

COMMIT;
