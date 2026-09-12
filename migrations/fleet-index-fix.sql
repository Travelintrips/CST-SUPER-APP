-- ============================================================
-- Fleet Table Index Fix + New Tables
-- Version: v15
-- Date: 2026-06-20
-- Scope: DEV only. PROD requires backup + confirmation.
-- ============================================================

-- 1. Composite dedup index untuk gojek_raw_transactions rows TANPA gopay_ref
--    (Rental fee due, dsb) — mencegah duplikasi saat CSV sama di-upload ulang.
--    Baris dengan gopay_ref sudah ditangani oleh gojek_raw_gopay_ref_company_uq.
CREATE UNIQUE INDEX IF NOT EXISTS gojek_raw_no_ref_dedup
  ON gojek_raw_transactions(company_id, driver_external_id, date_iso, amount, transaction_type)
  WHERE (gopay_transaction_reference_id IS NULL OR gopay_transaction_reference_id = '');

-- 2. Index komposit untuk recalculateOutstanding agar DISTINCT ON cepat
CREATE INDEX IF NOT EXISTS gojek_raw_driver_date_id_idx
  ON gojek_raw_transactions(company_id, driver_external_id, date_iso DESC NULLS LAST, id DESC);

-- 3. fleet_cash_payments — tabel pencatatan pembayaran tunai driver terhadap outstanding
CREATE TABLE IF NOT EXISTS fleet_cash_payments (
  id                 SERIAL PRIMARY KEY,
  company_id         INTEGER NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  outstanding_id     INTEGER REFERENCES fleet_outstanding(id) ON DELETE SET NULL,
  driver_id          INTEGER REFERENCES fleet_drivers(id) ON DELETE SET NULL,
  driver_name        TEXT NOT NULL,
  driver_external_id TEXT,
  driver_phone       TEXT,
  vehicle_plate      TEXT,
  payment_date       DATE NOT NULL DEFAULT CURRENT_DATE,
  amount             NUMERIC(18,4) NOT NULL,
  payment_method     TEXT NOT NULL DEFAULT 'cash',
  reference_no       TEXT,
  notes              TEXT,
  recorded_by        TEXT,
  status             TEXT NOT NULL DEFAULT 'confirmed',
  created_at         TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at         TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS fcp_company_idx     ON fleet_cash_payments(company_id);
CREATE INDEX IF NOT EXISTS fcp_driver_idx      ON fleet_cash_payments(driver_id);
CREATE INDEX IF NOT EXISTS fcp_outstanding_idx ON fleet_cash_payments(outstanding_id);
CREATE INDEX IF NOT EXISTS fcp_date_idx        ON fleet_cash_payments(payment_date DESC);
CREATE INDEX IF NOT EXISTS fcp_ext_id_idx      ON fleet_cash_payments(driver_external_id);

-- 4. Pastikan kolom vehicle_plate dan driver_phone ada di gojek_raw_transactions
ALTER TABLE gojek_raw_transactions ADD COLUMN IF NOT EXISTS vehicle_plate TEXT;
ALTER TABLE gojek_raw_transactions ADD COLUMN IF NOT EXISTS driver_phone  TEXT;

-- 5. Backfill vehicle_plate dari vehicle (kolom lama) bila vehicle_plate masih kosong
UPDATE gojek_raw_transactions
SET vehicle_plate = vehicle
WHERE vehicle_plate IS NULL AND vehicle IS NOT NULL AND vehicle != '';

-- 6. Backfill driver_phone dari phone_number bila driver_phone masih kosong
UPDATE gojek_raw_transactions
SET driver_phone = phone_number
WHERE driver_phone IS NULL AND phone_number IS NOT NULL AND phone_number != '';

-- 7. fleet_reconciliation_batches — alias/view untuk fleet_reconciliation_reports
--    (User menyebut reconciliation_batches; tabel aktual = fleet_reconciliation_reports)
--    Buat VIEW agar kode lama yang masih pakai nama lama tetap bekerja.
CREATE OR REPLACE VIEW fleet_reconciliation_batches AS
  SELECT * FROM fleet_reconciliation_reports;

-- 8. fleet_outstanding_balances — alias/view untuk fleet_outstanding
CREATE OR REPLACE VIEW fleet_outstanding_balances AS
  SELECT * FROM fleet_outstanding;
