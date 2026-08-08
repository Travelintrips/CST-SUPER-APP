import { db } from "@workspace/db";
import { sql } from "drizzle-orm";
import { logger } from "../../lib/logger.js";
import { pullLegacyBookingsFromSupabase, pullFacilitiesFromSupabase, pullPaymentsFromSupabase } from "./supabaseSync.js";

export async function runSportCenterMigration(): Promise<void> {
  try {
    await db.execute(sql`
      CREATE TABLE IF NOT EXISTS sport_facilities (
        id SERIAL PRIMARY KEY,
        company_id INTEGER,
        name TEXT NOT NULL,
        type TEXT NOT NULL DEFAULT 'court',
        description TEXT,
        capacity INTEGER DEFAULT 1,
        price_per_hour NUMERIC(14,2) NOT NULL DEFAULT 0,
        is_active BOOLEAN NOT NULL DEFAULT TRUE,
        image_url TEXT,
        sort_order INTEGER NOT NULL DEFAULT 0,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );

      CREATE TABLE IF NOT EXISTS sport_customers (
        id SERIAL PRIMARY KEY,
        company_id INTEGER,
        name TEXT NOT NULL,
        email TEXT,
        phone TEXT,
        address TEXT,
        notes TEXT,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );

      CREATE TABLE IF NOT EXISTS sport_members (
        id SERIAL PRIMARY KEY,
        company_id INTEGER,
        customer_id INTEGER REFERENCES sport_customers(id),
        name TEXT NOT NULL,
        email TEXT,
        phone TEXT,
        member_type TEXT NOT NULL DEFAULT 'gym',
        member_number TEXT,
        start_date DATE NOT NULL,
        end_date DATE,
        status TEXT NOT NULL DEFAULT 'active',
        notes TEXT,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );

      CREATE TABLE IF NOT EXISTS sport_pricing_rules (
        id SERIAL PRIMARY KEY,
        company_id INTEGER,
        facility_id INTEGER REFERENCES sport_facilities(id) ON DELETE CASCADE,
        name TEXT NOT NULL,
        day_type TEXT NOT NULL DEFAULT 'all',
        time_start TIME,
        time_end TIME,
        price_per_hour NUMERIC(14,2) NOT NULL,
        is_active BOOLEAN NOT NULL DEFAULT TRUE,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );

      CREATE TABLE IF NOT EXISTS sport_promos (
        id SERIAL PRIMARY KEY,
        company_id INTEGER,
        code TEXT NOT NULL,
        name TEXT NOT NULL,
        description TEXT,
        discount_type TEXT NOT NULL DEFAULT 'percent',
        discount_value NUMERIC(14,2) NOT NULL DEFAULT 0,
        min_amount NUMERIC(14,2) DEFAULT 0,
        max_uses INTEGER,
        used_count INTEGER NOT NULL DEFAULT 0,
        valid_from TIMESTAMPTZ,
        valid_until TIMESTAMPTZ,
        is_active BOOLEAN NOT NULL DEFAULT TRUE,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );

      CREATE TABLE IF NOT EXISTS sport_bookings (
        id SERIAL PRIMARY KEY,
        company_id INTEGER,
        booking_number TEXT NOT NULL,
        customer_id INTEGER REFERENCES sport_customers(id),
        customer_name TEXT NOT NULL,
        customer_phone TEXT,
        facility_id INTEGER REFERENCES sport_facilities(id),
        facility_name TEXT NOT NULL,
        booking_date DATE NOT NULL,
        start_time TIME NOT NULL,
        end_time TIME NOT NULL,
        duration_hours NUMERIC(5,2) NOT NULL DEFAULT 1,
        status TEXT NOT NULL DEFAULT 'pending',
        payment_status TEXT NOT NULL DEFAULT 'unpaid',
        base_amount NUMERIC(14,2) NOT NULL DEFAULT 0,
        discount_amount NUMERIC(14,2) NOT NULL DEFAULT 0,
        total_amount NUMERIC(14,2) NOT NULL DEFAULT 0,
        promo_id INTEGER REFERENCES sport_promos(id),
        promo_code TEXT,
        notes TEXT,
        checked_in_at TIMESTAMPTZ,
        checked_in_by TEXT,
        cancelled_at TIMESTAMPTZ,
        cancelled_reason TEXT,
        created_by TEXT,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );

      CREATE TABLE IF NOT EXISTS sport_payments (
        id SERIAL PRIMARY KEY,
        company_id INTEGER,
        booking_id INTEGER REFERENCES sport_bookings(id) ON DELETE CASCADE,
        payment_number TEXT NOT NULL,
        amount NUMERIC(14,2) NOT NULL,
        method TEXT NOT NULL DEFAULT 'cash',
        status TEXT NOT NULL DEFAULT 'pending',
        paid_at TIMESTAMPTZ,
        notes TEXT,
        created_by TEXT,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );

      CREATE TABLE IF NOT EXISTS sport_blocked_schedules (
        id SERIAL PRIMARY KEY,
        company_id INTEGER,
        facility_id INTEGER REFERENCES sport_facilities(id) ON DELETE CASCADE,
        block_date DATE NOT NULL,
        start_time TIME NOT NULL,
        end_time TIME NOT NULL,
        reason TEXT,
        created_by TEXT,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );

      CREATE TABLE IF NOT EXISTS sport_notifications (
        id SERIAL PRIMARY KEY,
        company_id INTEGER,
        type TEXT NOT NULL,
        title TEXT NOT NULL,
        message TEXT NOT NULL,
        entity_type TEXT,
        entity_id INTEGER,
        is_read BOOLEAN NOT NULL DEFAULT FALSE,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );

      CREATE TABLE IF NOT EXISTS sport_audit_logs (
        id SERIAL PRIMARY KEY,
        company_id INTEGER,
        entity_type TEXT NOT NULL,
        entity_id INTEGER,
        action TEXT NOT NULL,
        actor TEXT,
        old_data JSONB,
        new_data JSONB,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );

      CREATE TABLE IF NOT EXISTS sport_settings (
        id SERIAL PRIMARY KEY,
        company_id INTEGER UNIQUE,
        center_name TEXT NOT NULL DEFAULT 'Sport Center',
        address TEXT,
        phone TEXT,
        open_time TIME DEFAULT '06:00',
        close_time TIME DEFAULT '22:00',
        booking_advance_days INTEGER DEFAULT 30,
        min_booking_hours NUMERIC(5,2) DEFAULT 1,
        cancellation_hours INTEGER DEFAULT 2,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );
    `);

    await db.execute(sql`
      CREATE TABLE IF NOT EXISTS sport_refunds (
        id SERIAL PRIMARY KEY,
        company_id INTEGER,
        booking_id INTEGER NOT NULL REFERENCES sport_bookings(id) ON DELETE CASCADE,
        payment_id INTEGER REFERENCES sport_payments(id) ON DELETE SET NULL,
        customer_id INTEGER REFERENCES sport_customers(id) ON DELETE SET NULL,
        refund_number TEXT NOT NULL UNIQUE,
        refund_amount NUMERIC(14,2) NOT NULL,
        refund_reason TEXT,
        status TEXT NOT NULL DEFAULT 'pending',
        processed_by TEXT,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );
    `);

    await db.execute(sql`
      CREATE INDEX IF NOT EXISTS idx_sport_bookings_date ON sport_bookings(booking_date);
      CREATE INDEX IF NOT EXISTS idx_sport_bookings_facility ON sport_bookings(facility_id);
      CREATE INDEX IF NOT EXISTS idx_sport_bookings_status ON sport_bookings(status);
      CREATE INDEX IF NOT EXISTS idx_sport_bookings_company ON sport_bookings(company_id);
      CREATE INDEX IF NOT EXISTS idx_sport_members_type ON sport_members(member_type);
      CREATE INDEX IF NOT EXISTS idx_sport_notifications_read ON sport_notifications(is_read);
      CREATE INDEX IF NOT EXISTS idx_sport_refunds_booking ON sport_refunds(booking_id);
      CREATE INDEX IF NOT EXISTS idx_sport_refunds_status ON sport_refunds(status);
    `);

    // UNIQUE constraint on booking_number — required for ON CONFLICT (booking_number) upsert.
    // Step 1: remove duplicate rows first (keep the row with the highest id per booking_number).
    await db.execute(sql`
      DELETE FROM sport_bookings a
      USING sport_bookings b
      WHERE a.id < b.id
        AND a.booking_number = b.booking_number;
    `);
    // Step 2: add constraint idempotently (safe after dedup above).
    await db.execute(sql`
      DO $$
      BEGIN
        IF NOT EXISTS (
          SELECT 1 FROM pg_constraint
          WHERE conrelid = 'sport_bookings'::regclass
            AND contype   = 'u'
            AND conname   = 'sport_bookings_booking_number_key'
        ) THEN
          ALTER TABLE sport_bookings
            ADD CONSTRAINT sport_bookings_booking_number_key UNIQUE (booking_number);
        END IF;
      END $$;
    `);

    // Tambahkan kolom baru ke sport_payments (idempoten)
    await db.execute(sql`
      ALTER TABLE sport_payments
        ADD COLUMN IF NOT EXISTS payment_type TEXT NOT NULL DEFAULT 'booking',
        ADD COLUMN IF NOT EXISTS member_id INTEGER,
        ADD COLUMN IF NOT EXISTS customer_id INTEGER
    `);

    // Fase 3: kolom pajak/PPN pada sport_bookings dan sport_payments (idempoten)
    await db.execute(sql`
      ALTER TABLE sport_bookings
        ADD COLUMN IF NOT EXISTS tax_rate    NUMERIC(5,2)  NOT NULL DEFAULT 0,
        ADD COLUMN IF NOT EXISTS tax_amount  NUMERIC(14,2) NOT NULL DEFAULT 0
    `);
    await db.execute(sql`
      ALTER TABLE sport_payments
        ADD COLUMN IF NOT EXISTS tax_rate    NUMERIC(5,2)  NOT NULL DEFAULT 0,
        ADD COLUMN IF NOT EXISTS tax_amount  NUMERIC(14,2) NOT NULL DEFAULT 0
    `);
    // QRIS settlement detail. `amount` remains the gross customer payment;
    // net_amount is the expected bank settlement after MDR.
    await db.execute(sql`
      ALTER TABLE sport_payments
        ADD COLUMN IF NOT EXISTS mdr_rate             NUMERIC(7,4)  NOT NULL DEFAULT 0,
        ADD COLUMN IF NOT EXISTS mdr_amount           NUMERIC(14,2) NOT NULL DEFAULT 0,
        ADD COLUMN IF NOT EXISTS tax_withheld_amount  NUMERIC(14,2) NOT NULL DEFAULT 0,
        ADD COLUMN IF NOT EXISTS other_fee_amount     NUMERIC(14,2) NOT NULL DEFAULT 0,
        ADD COLUMN IF NOT EXISTS net_amount           NUMERIC(14,2) NOT NULL DEFAULT 0,
        ADD COLUMN IF NOT EXISTS settlement_reference TEXT,
        ADD COLUMN IF NOT EXISTS settlement_date      DATE,
        ADD COLUMN IF NOT EXISTS settlement_status    TEXT NOT NULL DEFAULT 'unsettled',
        ADD COLUMN IF NOT EXISTS mdr_posting_status   TEXT NOT NULL DEFAULT 'unposted',
        ADD COLUMN IF NOT EXISTS mdr_accounting_entry_id INTEGER,
        ADD COLUMN IF NOT EXISTS mdr_posted_at        TIMESTAMPTZ,
        ADD COLUMN IF NOT EXISTS mdr_posting_error     TEXT
    `);
    await db.execute(sql`
      UPDATE sport_payments
      SET net_amount = GREATEST(
        0,
        amount
        - COALESCE(mdr_amount, 0)
        - COALESCE(tax_withheld_amount, 0)
        - COALESCE(other_fee_amount, 0)
      )
      WHERE net_amount IS NULL OR net_amount = 0
    `).catch(() => {});
    await db.execute(sql`
      CREATE INDEX IF NOT EXISTS idx_sport_payments_settlement
      ON sport_payments(settlement_status, settlement_date)
    `).catch(() => {});
    // A provider settlement may contain many Sport Center payments. The
    // settlement row is the bank-facing aggregate; items retain the source
    // payment relationship and deduction breakdown.
    await db.execute(sql`
      CREATE TABLE IF NOT EXISTS qris_settlements (
        id SERIAL PRIMARY KEY,
        company_id INTEGER NOT NULL,
        settlement_reference TEXT NOT NULL,
        provider_name TEXT,
        settlement_date DATE NOT NULL,
        gross_amount NUMERIC(16,2) NOT NULL DEFAULT 0,
        mdr_amount NUMERIC(16,2) NOT NULL DEFAULT 0,
        tax_withheld_amount NUMERIC(16,2) NOT NULL DEFAULT 0,
        other_fee_amount NUMERIC(16,2) NOT NULL DEFAULT 0,
        net_amount NUMERIC(16,2) NOT NULL DEFAULT 0,
        status TEXT NOT NULL DEFAULT 'unsettled',
        bank_mutation_id INTEGER,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        UNIQUE (company_id, settlement_reference)
      )
    `).catch(() => {});
    await db.execute(sql`
      CREATE TABLE IF NOT EXISTS qris_settlement_items (
        id SERIAL PRIMARY KEY,
        settlement_id INTEGER NOT NULL REFERENCES qris_settlements(id) ON DELETE CASCADE,
        sport_payment_id INTEGER NOT NULL REFERENCES sport_payments(id) ON DELETE RESTRICT,
        gross_amount NUMERIC(16,2) NOT NULL DEFAULT 0,
        mdr_amount NUMERIC(16,2) NOT NULL DEFAULT 0,
        tax_withheld_amount NUMERIC(16,2) NOT NULL DEFAULT 0,
        other_fee_amount NUMERIC(16,2) NOT NULL DEFAULT 0,
        net_amount NUMERIC(16,2) NOT NULL DEFAULT 0,
        UNIQUE (settlement_id, sport_payment_id)
      )
    `).catch(() => {});
    await db.execute(sql`
      CREATE INDEX IF NOT EXISTS idx_qris_settlements_company_date
        ON qris_settlements(company_id, settlement_date);
      CREATE INDEX IF NOT EXISTS idx_qris_settlement_items_payment
        ON qris_settlement_items(sport_payment_id);
    `).catch(() => {});
    await db.execute(sql`
      ALTER TABLE sport_payments
        ADD COLUMN IF NOT EXISTS source TEXT NOT NULL DEFAULT 'SPORT_CENTER'
    `);

    // ASK: Accounting Settlement Kit — kolom posting status
    await db.execute(sql`ALTER TABLE sport_payments ADD COLUMN IF NOT EXISTS posting_status TEXT NOT NULL DEFAULT 'unposted'`);
    await db.execute(sql`ALTER TABLE sport_payments ADD COLUMN IF NOT EXISTS accounting_payment_id INTEGER`);
    await db.execute(sql`ALTER TABLE sport_payments ADD COLUMN IF NOT EXISTS posting_error TEXT`);
    await db.execute(sql`CREATE INDEX IF NOT EXISTS idx_sport_payments_posting_status ON sport_payments(posting_status)`);

    // Bank account linkage — agar rekonsiliasi bank dapat filter berdasarkan rekening tujuan
    await db.execute(sql`ALTER TABLE sport_payments ADD COLUMN IF NOT EXISTS bank_account_id INTEGER REFERENCES company_bank_accounts(id) ON DELETE SET NULL`);
    await db.execute(sql`CREATE INDEX IF NOT EXISTS idx_sport_payments_bank_account_id ON sport_payments(bank_account_id)`);

    // Fase 3: tabel maintenance request (integrasi Purchase — Fase 4 upgrade)
    await db.execute(sql`
      CREATE TABLE IF NOT EXISTS sport_maintenance_requests (
        id                      SERIAL PRIMARY KEY,
        company_id              INTEGER,
        facility_id             INTEGER REFERENCES sport_facilities(id) ON DELETE SET NULL,
        facility_name           TEXT,
        item                    TEXT NOT NULL,
        quantity                INTEGER NOT NULL DEFAULT 1,
        vendor                  TEXT,
        notes                   TEXT,
        source                  TEXT NOT NULL DEFAULT 'SPORT_CENTER',
        cost_center             TEXT NOT NULL DEFAULT 'SPORT_CENTER',
        request_type            TEXT NOT NULL DEFAULT 'maintenance',
        status                  TEXT NOT NULL DEFAULT 'pending',
        requested_by            TEXT,
        purchase_request_id     INTEGER,
        purchase_request_number TEXT,
        estimated_cost          NUMERIC(14,2) NOT NULL DEFAULT 0,
        unit                    TEXT NOT NULL DEFAULT 'pcs',
        created_at              TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at              TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )
    `);
    // Fase 4: tambahkan kolom baru jika tabel sudah ada (idempoten)
    await db.execute(sql`ALTER TABLE sport_maintenance_requests ADD COLUMN IF NOT EXISTS cost_center TEXT NOT NULL DEFAULT 'SPORT_CENTER'`);
    await db.execute(sql`ALTER TABLE sport_maintenance_requests ADD COLUMN IF NOT EXISTS request_type TEXT NOT NULL DEFAULT 'maintenance'`);
    await db.execute(sql`ALTER TABLE sport_maintenance_requests ADD COLUMN IF NOT EXISTS purchase_request_id INTEGER`);
    await db.execute(sql`ALTER TABLE sport_maintenance_requests ADD COLUMN IF NOT EXISTS purchase_request_number TEXT`);
    await db.execute(sql`ALTER TABLE sport_maintenance_requests ADD COLUMN IF NOT EXISTS estimated_cost NUMERIC(14,2) NOT NULL DEFAULT 0`);
    await db.execute(sql`ALTER TABLE sport_maintenance_requests ADD COLUMN IF NOT EXISTS unit TEXT NOT NULL DEFAULT 'pcs'`);
    await db.execute(sql`
      CREATE INDEX IF NOT EXISTS idx_sport_maint_facility ON sport_maintenance_requests(facility_id);
      CREATE INDEX IF NOT EXISTS idx_sport_maint_status   ON sport_maintenance_requests(status);
    `);

    // Tambahkan nilai enum baru (idempoten — IF NOT EXISTS, PostgreSQL 9.6+)
    await db.execute(sql`
      ALTER TYPE accounting_entry_source ADD VALUE IF NOT EXISTS 'sport_center_refund'
    `);
    await db.execute(sql`
      ALTER TYPE accounting_entry_source ADD VALUE IF NOT EXISTS 'sport_center_membership'
    `);
    await db.execute(sql`
      ALTER TYPE accounting_entry_source ADD VALUE IF NOT EXISTS 'sport_center_booking_refund'
    `);
    await db.execute(sql`
      ALTER TYPE accounting_entry_source ADD VALUE IF NOT EXISTS 'sport_center_operational_expense'
    `);
    await db.execute(sql`
      ALTER TYPE accounting_entry_source ADD VALUE IF NOT EXISTS 'tenant_rent_payment'
    `);
    await db.execute(sql`
      ALTER TYPE accounting_entry_source ADD VALUE IF NOT EXISTS 'tenant_sc_payment'
    `);
    await db.execute(sql`
      ALTER TYPE accounting_entry_source ADD VALUE IF NOT EXISTS 'sport_center_ppn_correction'
    `).catch(() => {/* already exists */});
    await db.execute(sql`
      ALTER TYPE accounting_entry_source ADD VALUE IF NOT EXISTS 'sport_center_amount_correction'
    `).catch(() => {/* already exists */});

    // ── Auto-sync: sport_center_services → sport_facilities ──────────────────
    // Setiap kali startup, data dari schema lama (sport_center_services) di-sync
    // ke sport_facilities secara idempoten. Company_id default = 1
    // (PT Cahaya Sejati Teknologi).
    const SPORT_CENTER_COMPANY_ID = 1;

    const legacyCheck = await db.execute(sql`
      SELECT EXISTS (
        SELECT 1 FROM information_schema.tables
        WHERE table_schema = 'public' AND table_name = 'sport_center_services'
      ) AS exists
    `);
    const hasLegacy = (legacyCheck.rows[0] as { exists: boolean }).exists;

    if (hasLegacy) {
      // Upsert fasilitas: skip jika nama sudah ada
      await db.execute(sql`
        INSERT INTO sport_facilities
          (company_id, name, type, description, price_per_hour, capacity,
           is_active, image_url, sort_order, created_at, updated_at)
        SELECT
          1,
          s.name,
          COALESCE(s.category, 'court'),
          s.description,
          s.price_per_hour::NUMERIC(14,2),
          COALESCE(s.capacity, 1),
          COALESCE(s.is_active, TRUE),
          s.image_url,
          COALESCE(s.sort_order, 0),
          COALESCE(s.created_at, NOW()),
          COALESCE(s.updated_at, NOW())
        FROM sport_center_services s
        WHERE NOT EXISTS (
          SELECT 1 FROM sport_facilities f WHERE f.name = s.name
        )
        ON CONFLICT DO NOTHING
      `);

      // Upsert customers & bookings dari legacy sport_center_bookings (hanya jika tabel ada)
      const legacyBkCheck = await db.execute(sql`
        SELECT EXISTS (
          SELECT 1 FROM information_schema.tables
          WHERE table_schema = 'public' AND table_name = 'sport_center_bookings'
        ) AS exists
      `);
      const hasLegacyBookings = (legacyBkCheck.rows[0] as { exists: boolean }).exists;

      if (hasLegacyBookings) {
        await db.execute(sql`
          INSERT INTO sport_customers (company_id, name, email, phone, created_at, updated_at)
          SELECT DISTINCT
            1,
            b.customer_name,
            b.customer_email,
            b.customer_phone,
            NOW(), NOW()
          FROM sport_center_bookings b
          WHERE b.customer_phone IS NOT NULL
            AND NOT EXISTS (
              SELECT 1 FROM sport_customers c WHERE c.phone = b.customer_phone
            )
          ON CONFLICT DO NOTHING
        `);

        await db.execute(sql`
          INSERT INTO sport_bookings
            (company_id, booking_number, customer_id, customer_name, customer_phone,
             facility_id, facility_name, booking_date, start_time, end_time,
             duration_hours, base_amount, total_amount, status, payment_status,
             notes, created_at, updated_at)
          SELECT
            1,
            b.booking_code,
            c.id,
            b.customer_name,
            b.customer_phone,
            f.id,
            b.facility_name,
            b.date::DATE,
            b.start_time::TIME,
            b.end_time::TIME,
            COALESCE(b.total_hours, 1)::NUMERIC(5,2),
            COALESCE(b.total_price, 0)::NUMERIC(14,2),
            COALESCE(b.total_price, 0)::NUMERIC(14,2),
            CASE b.status
              WHEN 'confirmed' THEN 'confirmed'
              WHEN 'cancelled' THEN 'cancelled'
              ELSE 'pending'
            END,
            COALESCE(b.payment_status, 'unpaid'),
            b.notes,
            COALESCE(b.created_at, NOW()),
            COALESCE(b.created_at, NOW())
          FROM sport_center_bookings b
          LEFT JOIN sport_customers c ON c.phone = b.customer_phone
          LEFT JOIN sport_facilities f ON (
            f.name = b.facility_name
            OR f.name ILIKE '%' || SPLIT_PART(b.facility_id, '-', 1) || '%'
          )
          WHERE b.booking_code IS NOT NULL
            AND NOT EXISTS (
              SELECT 1 FROM sport_bookings nb WHERE nb.booking_number = b.booking_code
            )
          ON CONFLICT DO NOTHING
        `);
      }

      logger.info("Sport Center migration: legacy sync selesai (sport_center_services → sport_facilities)");
    }

    // Pastikan semua data sport center milik PT Cahaya Sejati Teknologi (company_id = 1)
    await db.execute(sql`
      UPDATE sport_facilities    SET company_id = 1 WHERE company_id IS NULL;
      UPDATE sport_bookings      SET company_id = 1 WHERE company_id IS NULL;
      UPDATE sport_customers     SET company_id = 1 WHERE company_id IS NULL;
      UPDATE sport_members       SET company_id = 1 WHERE company_id IS NULL;
      UPDATE sport_pricing_rules SET company_id = 1 WHERE company_id IS NULL;
      UPDATE sport_promos        SET company_id = 1 WHERE company_id IS NULL;
      UPDATE sport_payments      SET company_id = 1 WHERE company_id IS NULL;
      UPDATE sport_settings      SET company_id = 1 WHERE company_id IS NULL;
    `);

    await db.execute(sql`
      CREATE TABLE IF NOT EXISTS sport_sync_logs (
        id         SERIAL PRIMARY KEY,
        entity     TEXT NOT NULL,
        action     TEXT NOT NULL,
        entity_id  INTEGER,
        status     TEXT NOT NULL DEFAULT 'ok',
        detail     TEXT,
        company_id INTEGER,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );
      CREATE INDEX IF NOT EXISTS idx_sport_sync_logs_entity ON sport_sync_logs(entity, action);
      CREATE INDEX IF NOT EXISTS idx_sport_sync_logs_created ON sport_sync_logs(created_at DESC);
    `);

    // NOTE: sport_center_bookings ALTER TABLE dihapus — tabel diarsip ke zz_deleted_sport_center_bookings

    await db.execute(sql`
      ALTER TABLE sport_bookings ADD COLUMN IF NOT EXISTS customer_email TEXT;
    `);

    // Kolom sc_booking_id untuk idempoten lookup saat pull payments dari Supabase
    await db.execute(sql`
      ALTER TABLE sport_bookings ADD COLUMN IF NOT EXISTS sc_booking_id INTEGER;
      CREATE INDEX IF NOT EXISTS idx_sport_bookings_sc_id ON sport_bookings(sc_booking_id) WHERE sc_booking_id IS NOT NULL;
    `);

    // ── FASE 6C: facility_id + expense_category di accounting_entries ──────────
    await db.execute(sql`
      ALTER TABLE accounting_entries ADD COLUMN IF NOT EXISTS facility_id INTEGER;
      ALTER TABLE accounting_entries ADD COLUMN IF NOT EXISTS expense_category TEXT;
    `);

    // ── FASE 6C: recurring_expenses table ────────────────────────────────────
    await db.execute(sql`
      CREATE TABLE IF NOT EXISTS recurring_expenses (
        id          SERIAL PRIMARY KEY,
        company_id  INTEGER,
        facility_id INTEGER,
        name        TEXT NOT NULL,
        description TEXT,
        amount      NUMERIC(14,2) NOT NULL DEFAULT 0,
        frequency   TEXT NOT NULL DEFAULT 'monthly',
        next_run    DATE,
        is_active   BOOLEAN NOT NULL DEFAULT TRUE,
        category    TEXT,
        created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );
      CREATE INDEX IF NOT EXISTS idx_recurring_expenses_company  ON recurring_expenses(company_id);
      CREATE INDEX IF NOT EXISTS idx_recurring_expenses_facility ON recurring_expenses(facility_id);
      CREATE INDEX IF NOT EXISTS idx_recurring_expenses_next_run ON recurring_expenses(next_run) WHERE is_active = TRUE;
    `);

    // Pull fasilitas dari Supabase sport_center.facilities → sport_facilities (idempoten)
    try {
      const facPullResult = await pullFacilitiesFromSupabase();
      logger.info({ ...facPullResult }, "Sport Center migration: pull facilities dari Supabase selesai");
    } catch (facPullErr) {
      logger.warn({ err: facPullErr }, "Sport Center migration: pull facilities gagal (non-fatal)");
    }

    // Pull semua booking dari Supabase sport_center_bookings → sport_bookings (idempoten via ON CONFLICT)
    try {
      const pullResult = await pullLegacyBookingsFromSupabase();
      logger.info({ ...pullResult }, "Sport Center migration: pull legacy bookings dari Supabase selesai");
    } catch (pullErr) {
      logger.warn({ err: pullErr }, "Sport Center migration: pull legacy bookings gagal (non-fatal)");
    }

    // Pull payments dari Supabase sport_center.payments → sport_payments (idempoten)
    // Harus setelah pullLegacyBookings agar local booking_id sudah ada.
    // Ini juga update payment_status booking → 'paid' jika ada confirmed payment di Supabase,
    // meski billing_status pada booking record-nya masih null.
    try {
      const payResult = await pullPaymentsFromSupabase(1);
      logger.info({ ...payResult }, "Sport Center migration: pull payments dari Supabase selesai");
    } catch (payErr) {
      logger.warn({ err: payErr }, "Sport Center migration: pull payments gagal (non-fatal)");
    }

    // ── Backfill customer_email dari sport_customers → sport_bookings lama ────
    // Idempoten: hanya update baris yang customer_email masih NULL tapi customer_id sudah ada.
    const backfillResult = await db.execute(sql`
      UPDATE sport_bookings sb
      SET    customer_email = sc.email,
             updated_at     = NOW()
      FROM   sport_customers sc
      WHERE  sb.customer_id  = sc.id
        AND  sc.email        IS NOT NULL
        AND  sc.email        <> ''
        AND  (sb.customer_email IS NULL OR sb.customer_email = '')
    `);
    const backfilled = (backfillResult as { rowCount?: number }).rowCount ?? 0;
    if (backfilled > 0) {
      logger.info({ backfilled }, "Sport Center migration: customer_email backfill selesai");
    } else {
      logger.info("Sport Center migration: customer_email backfill — tidak ada baris yang perlu diisi");
    }
    // ── Repair: hapus orphan accounting_payments (dibuat oleh raw SQL lama, tanpa entry_id) ────
    // Path lama (raw SQL INSERT) membuat accounting_payments dengan entry_id = NULL dan tidak
    // mengupdate sport_payments.posting_status. Jalan sebelum backfill sehingga
    // ingestModulePayment salah membaca mereka sebagai "alreadyPosted" padahal tidak ada jurnal.
    // Fix: hapus semua baris orphan (entry_id IS NULL) agar backfillSportCenterAccountingPayments()
    // bisa re-create mereka dengan benar via ingestModulePayment.
    try {
      // Step 1: Reset posting_status pada sport_payments yang punya orphan accounting_payment.
      // Tangani dua kasus:
      //   a) source_doc_id = sp.id   (payment non-SCPAY yang dibuat via BizPortal)
      //   b) trigger mirror juga memakai source_doc_id = public.sport_payments.id
      await db.execute(sql`
        UPDATE sport_payments sp
        SET    posting_status = 'unposted',
               updated_at     = NOW()
        WHERE  (
          EXISTS (
            SELECT 1 FROM accounting_payments ap
            WHERE  ap.source_type   = 'sport_center'
              AND  ap.source_doc_id = sp.id
              AND  ap.entry_id      IS NULL
          )
        )
      `);

      // Step 2: Hapus semua orphan accounting_payments (sport_center + entry_id NULL).
      // Baris dengan entry_id IS NULL tidak punya jurnal sama sekali — tidak ada nilai
      // yang hilang dengan menghapusnya; backfill akan re-create dengan benar.
      const delResult = await db.execute(sql`
        DELETE FROM accounting_payments
        WHERE  source_type = 'sport_center'
          AND  entry_id    IS NULL
      `);
      const deleted = (delResult as { rowCount?: number }).rowCount ?? 0;
      if (deleted > 0) {
        logger.info(
          { deleted },
          "Sport Center migration: removed orphan accounting_payments (raw-SQL path) — akan di-recreate via backfillSportCenterAccountingPayments"
        );
      } else {
        logger.info("Sport Center migration: tidak ada orphan accounting_payments — skip repair");
      }
    } catch (repairErr) {
      logger.warn({ err: repairErr }, "Sport Center migration: repair orphan accounting_payments gagal (non-fatal)");
    }

    // ── Cleanup: hapus duplicate accounting_entries per (company_id, source, source_id) ──
    // Scoped by company_id untuk multi-tenant isolation: setiap company menyimpan MIN(id)-nya
    // sendiri; entry milik company lain tidak pernah disentuh.
    // Urutan operasi:
    //   1. Redirect accounting_payments.entry_id ke keeper
    //   2. Downgrade duplicate posted entries → draft (trigger fn_block_posted_lines_mutation
    //      memblokir DELETE pada lines dari posted entries, tapi mengizinkan transisi
    //      posted→draft jika cancel_reason + cancelled_at disediakan)
    //   3. Hapus accounting_entry_lines dari entry duplikat (sekarang sudah draft)
    //   4. Hapus accounting_entries duplikat
    try {
      // 1. Downgrade duplikat dari 'posted'/'approved' → 'draft' agar trigger mengizinkan DELETE
      //    Duplikat diidentifikasi per (company_id, source, source_id) — bukan global —
      //    karena index uniknya adalah company-scoped (multi-tenant aman).
      await db.execute(sql`
        UPDATE accounting_entries
        SET status        = 'draft',
            cancel_reason = 'MIGRATION_DEDUP: entri duplikat per (company_id, source, source_id) — dihapus oleh runSportCenterMigration',
            cancelled_at  = NOW()
        WHERE source != 'manual'
          AND source_id IS NOT NULL
          AND status IN ('posted', 'approved', 'pending_approval')
          AND id NOT IN (
            SELECT MIN(id)
            FROM accounting_entries
            WHERE source != 'manual' AND source_id IS NOT NULL
            GROUP BY company_id, source, source_id
          )
      `);

      // 2. Pindahkan accounting_payments.entry_id ke entry yang dipertahankan (company-scoped)
      await db.execute(sql`
        UPDATE accounting_payments ap
        SET entry_id = keeper.min_id
        FROM (
          SELECT company_id, source, source_id, MIN(id) AS min_id
          FROM accounting_entries
          WHERE source != 'manual' AND source_id IS NOT NULL
          GROUP BY company_id, source, source_id
          HAVING COUNT(*) > 1
        ) keeper
        JOIN accounting_entries dup ON dup.company_id = keeper.company_id
          AND dup.source = keeper.source
          AND dup.source_id = keeper.source_id
          AND dup.id != keeper.min_id
        WHERE ap.entry_id = dup.id
      `);

      // 2. Downgrade duplicate posted entries → draft sebelum menghapus lines-nya.
      //    Trigger fn_block_posted_lines_mutation memblokir DELETE pada lines posted entries
      //    tetapi mengizinkan transisi posted→draft jika cancel_reason + cancelled_at diisi.
      await db.execute(sql`
        UPDATE accounting_entries
        SET
          status       = 'draft',
          cancel_reason = 'Duplicate entry cleanup — downgraded before deletion',
          cancelled_at  = NOW()
        WHERE source != 'manual'
          AND source_id IS NOT NULL
          AND status = 'posted'
          AND id NOT IN (
            SELECT MIN(id)
            FROM accounting_entries
            WHERE source != 'manual' AND source_id IS NOT NULL
            GROUP BY company_id, source, source_id
          )
      `);

      // 3. Hapus entry lines dari entry duplikat (sudah draft, trigger tidak lagi memblokir)
      // 3. Hapus entry lines dari entry duplikat (aman karena sudah di-downgrade ke 'draft')
      await db.execute(sql`
        DELETE FROM accounting_entry_lines
        WHERE entry_id IN (
          SELECT id FROM accounting_entries
          WHERE source != 'manual'
            AND source_id IS NOT NULL
            AND id NOT IN (
              SELECT MIN(id)
              FROM accounting_entries
              WHERE source != 'manual' AND source_id IS NOT NULL
              GROUP BY company_id, source, source_id
            )
        )
      `);

      // 4. Hapus entry duplikat (company-scoped — tiap company mempertahankan MIN(id) sendiri)
      await db.execute(sql`
        DELETE FROM accounting_entries
        WHERE source != 'manual'
          AND source_id IS NOT NULL
          AND id NOT IN (
            SELECT MIN(id)
            FROM accounting_entries
            WHERE source != 'manual' AND source_id IS NOT NULL
            GROUP BY company_id, source, source_id
          )
      `);
      logger.info("Sport Center migration: cleanup duplikat accounting_entries selesai");
    } catch (cleanErr) {
      logger.warn({ err: cleanErr }, "Sport Center migration: cleanup duplikat accounting_entries gagal (non-fatal)");
    }

    // ── Drop legacy non-company-scoped index (R-1 remediation) ──────────────────────────
    // idx_accounting_entries_source_source_id was a unique index on (source, source_id)
    // WITHOUT company_id. This prevents the same source+source_id from existing in two
    // different companies, which is wrong for a multi-tenant system.
    //
    // R-1 fix replaces it with accounting_entries_company_source_source_id_uniq which
    // includes company_id so cross-company entries are allowed.
    //
    // Drop the old index here so that even if this migration runs before accountingMigration,
    // the non-scoped index is removed.
    try {
      await db.execute(sql`DROP INDEX IF EXISTS idx_accounting_entries_source_source_id`);
      logger.info("Sport Center migration: dropped legacy non-company-scoped index idx_accounting_entries_source_source_id (R-1 fix)");
    } catch (idxErr) {
      logger.warn({ err: idxErr }, "Sport Center migration: drop legacy index failed (non-fatal)");
    }

    logger.info("Sport Center migration: selesai");
  } catch (err) {
    logger.error({ err }, "Sport Center migration: gagal");
    throw err;
  }
}

/**
 * Tabel Tagihan Perusahaan (Company Invoice) untuk Sport Center.
 * Idempoten — hanya dijalankan sekali.
 */
export async function runSportCenterCompanyInvoiceMigration(): Promise<void> {
  try {
    await db.execute(sql`
      CREATE TABLE IF NOT EXISTS sport_company_clients (
        id           SERIAL PRIMARY KEY,
        company_id   INTEGER NOT NULL DEFAULT 1,
        name         TEXT NOT NULL,
        pic_name     TEXT,
        pic_phone    TEXT,
        pic_email    TEXT,
        address      TEXT,
        notes        TEXT,
        is_active    BOOLEAN NOT NULL DEFAULT TRUE,
        created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );
      CREATE INDEX IF NOT EXISTS idx_scc_company ON sport_company_clients(company_id);
    `);

    await db.execute(sql`
      CREATE TABLE IF NOT EXISTS sport_company_invoices (
        id             SERIAL PRIMARY KEY,
        company_id     INTEGER NOT NULL DEFAULT 1,
        client_id      INTEGER NOT NULL REFERENCES sport_company_clients(id) ON DELETE CASCADE,
        invoice_number TEXT NOT NULL UNIQUE,
        period_month   INTEGER NOT NULL,
        period_year    INTEGER NOT NULL,
        subtotal       NUMERIC(14,2) NOT NULL DEFAULT 0,
        tax_rate       NUMERIC(5,2)  NOT NULL DEFAULT 11,
        tax_amount     NUMERIC(14,2) NOT NULL DEFAULT 0,
        grand_total    NUMERIC(14,2) NOT NULL DEFAULT 0,
        status         TEXT NOT NULL DEFAULT 'unpaid',
        notes          TEXT,
        paid_at        TIMESTAMPTZ,
        created_by     TEXT,
        created_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at     TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );
      CREATE INDEX IF NOT EXISTS idx_sci_company  ON sport_company_invoices(company_id);
      CREATE INDEX IF NOT EXISTS idx_sci_client   ON sport_company_invoices(client_id);
      CREATE INDEX IF NOT EXISTS idx_sci_status   ON sport_company_invoices(status);
    `);

    await db.execute(sql`
      CREATE TABLE IF NOT EXISTS sport_company_invoice_items (
        id             SERIAL PRIMARY KEY,
        invoice_id     INTEGER NOT NULL REFERENCES sport_company_invoices(id) ON DELETE CASCADE,
        booking_id     INTEGER REFERENCES sport_bookings(id) ON DELETE SET NULL,
        booking_number TEXT,
        customer_name  TEXT,
        facility_name  TEXT,
        booking_date   DATE,
        duration_hours NUMERIC(5,2),
        subtotal       NUMERIC(14,2) NOT NULL DEFAULT 0,
        tax_amount     NUMERIC(14,2) NOT NULL DEFAULT 0,
        total          NUMERIC(14,2) NOT NULL DEFAULT 0,
        created_at     TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );
      CREATE INDEX IF NOT EXISTS idx_scii_invoice ON sport_company_invoice_items(invoice_id);
      CREATE INDEX IF NOT EXISTS idx_scii_booking ON sport_company_invoice_items(booking_id);
    `);

    logger.info("Sport Center company invoice migration: selesai");
  } catch (err) {
    logger.warn({ err }, "Sport Center company invoice migration: gagal (non-fatal)");
  }
}

/**
 * Koreksi journal entry Sport Center yang salah masuk ke akun 4-1010
 * (Pendapatan Jasa Freight) — pindahkan ke 4-1017 (Pendapatan Booking Sport Center).
 * Idempoten: jika sudah tidak ada baris yang salah, skip.
 */
export async function runSportCenterAccountCorrection(): Promise<void> {
  try {
    const BOOKING_SOURCES = [
      "sport_center_booking",
      "sport_center_booking_reversal",
      "sport_center_booking_refund",
      "sport_center_booking_refund_direct",
      "sport_center_refund",
    ];

    // Jalankan dalam satu transaksi dengan bypass immutability trigger.
    // Trigger trg_block_lines_mutation memblokir UPDATE pada posted entries,
    // sehingga perlu SET LOCAL session_replication_role = 'replica' agar
    // koreksi akun bisa berjalan tanpa melanggar prinsip immutability bisnis.
    await db.transaction(async (tx) => {
      await tx.execute(sql`SET LOCAL session_replication_role = 'replica'`);

      // ── Koreksi 1: Booking/Reversal/Refund → 4-1010 (Freight) ke 4-1017 (SC Booking) ──
      const result1 = await tx.execute(sql`
        WITH
          acct_freight AS (
            SELECT id, company_id FROM chart_of_accounts WHERE code LIKE '4-1010%' AND company_id IS NOT NULL
          ),
          acct_sc AS (
            SELECT id, company_id FROM chart_of_accounts WHERE code LIKE '4-1017%' AND company_id IS NOT NULL
          ),
          bad_lines AS (
            SELECT ael.id AS line_id,
                   asc2.id AS correct_account_id
            FROM accounting_entry_lines ael
            JOIN accounting_entries ae ON ae.id = ael.entry_id
            JOIN acct_freight af
              ON af.id = ael.account_id
                 AND af.company_id = ae.company_id
            JOIN acct_sc asc2
              ON asc2.company_id = ae.company_id
            WHERE ae.source::text = ANY(ARRAY[${sql.raw(BOOKING_SOURCES.map(s => `'${s}'`).join(","))}])
          )
        UPDATE accounting_entry_lines ael
          SET account_id = bad_lines.correct_account_id
        FROM bad_lines
        WHERE ael.id = bad_lines.line_id
      `);
      const affected1 = (result1 as { rowCount?: number }).rowCount ?? 0;
      if (affected1 > 0) {
        logger.info({ affected: affected1 }, "Sport Center account correction: booking/refund dipindahkan dari 4-1010 → 4-1017");
      }

      // ── Koreksi 2: Membership → 4-1010 (Freight) ke 4-1016 (SC Membership) ──
      const result2 = await tx.execute(sql`
        WITH
          acct_freight AS (
            SELECT id, company_id FROM chart_of_accounts WHERE code LIKE '4-1010%' AND company_id IS NOT NULL
          ),
          acct_mbr AS (
            SELECT id, company_id FROM chart_of_accounts WHERE code LIKE '4-1016%' AND company_id IS NOT NULL
          ),
          bad_lines AS (
            SELECT ael.id AS line_id,
                   am.id AS correct_account_id
            FROM accounting_entry_lines ael
            JOIN accounting_entries ae ON ae.id = ael.entry_id
            JOIN acct_freight af
              ON af.id = ael.account_id
                 AND af.company_id = ae.company_id
            JOIN acct_mbr am
              ON am.company_id = ae.company_id
            WHERE ae.source::text = 'sport_center_membership'
          )
        UPDATE accounting_entry_lines ael
          SET account_id = bad_lines.correct_account_id
        FROM bad_lines
        WHERE ael.id = bad_lines.line_id
      `);
      const affected2 = (result2 as { rowCount?: number }).rowCount ?? 0;
      if (affected2 > 0) {
        logger.info({ affected: affected2 }, "Sport Center account correction: membership dipindahkan dari 4-1010 → 4-1016");
      }

      if (affected1 === 0 && affected2 === 0) {
        logger.info("Sport Center account correction: tidak ada baris yang perlu dikoreksi");
      }
    });
  } catch (err) {
    logger.warn({ err }, "Sport Center account correction: gagal (non-fatal)");
  }
}

/**
 * Migration: buat tabel sport_expenses.
 * Idempoten — pakai CREATE TABLE IF NOT EXISTS.
 */
export async function runSportExpensesMigration(): Promise<void> {
  try {
    await db.execute(sql`
      CREATE TABLE IF NOT EXISTS sport_expenses (
        id             SERIAL PRIMARY KEY,
        company_id     INTEGER,
        facility_id    INTEGER REFERENCES sport_facilities(id) ON DELETE SET NULL,
        expense_number TEXT NOT NULL UNIQUE,
        date           DATE NOT NULL,
        category       TEXT NOT NULL DEFAULT 'lain-lain',
        description    TEXT,
        amount         NUMERIC(14,2) NOT NULL DEFAULT 0,
        payment_method TEXT NOT NULL DEFAULT 'cash',
        status         TEXT NOT NULL DEFAULT 'draft',
        entry_id       INTEGER,
        notes          TEXT,
        created_by     TEXT,
        created_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at     TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )
    `);

    await db.execute(sql`
      CREATE INDEX IF NOT EXISTS idx_sport_expenses_company  ON sport_expenses(company_id)
    `);

    await db.execute(sql`
      CREATE INDEX IF NOT EXISTS idx_sport_expenses_facility ON sport_expenses(facility_id)
    `);

    await db.execute(sql`
      CREATE INDEX IF NOT EXISTS idx_sport_expenses_date     ON sport_expenses(date)
    `);

    await db.execute(sql`
      CREATE INDEX IF NOT EXISTS idx_sport_expenses_status   ON sport_expenses(status)
    `);

    logger.info("Sport Expenses migration: selesai");
  } catch (err) {
    logger.warn({ err }, "Sport Expenses migration: gagal (non-fatal)");
  }
}

