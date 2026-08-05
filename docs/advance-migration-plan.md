# Advance Management — Migration Plan

## Overview

Migrasi berjalan **otomatis** saat API server boot melalui fungsi `runAdvanceMigration()` yang dipanggil di `src/index.ts`. Tidak ada script manual yang perlu dijalankan. Migrasi sepenuhnya **idempotent** — aman dijalankan berulang kali.

---

## Tahapan Migrasi

### Step 1 — Extend cash_advances

Menambahkan kolom baru ke tabel `cash_advances` yang sudah ada:

```sql
-- Setiap kolom ditambahkan via DO block yang cek IF NOT EXISTS
ALTER TABLE cash_advances ADD COLUMN IF NOT EXISTS advance_type      TEXT;
ALTER TABLE cash_advances ADD COLUMN IF NOT EXISTS lifecycle_status  TEXT;
ALTER TABLE cash_advances ADD COLUMN IF NOT EXISTS counterparty_type TEXT;
ALTER TABLE cash_advances ADD COLUMN IF NOT EXISTS project_id        INTEGER;
ALTER TABLE cash_advances ADD COLUMN IF NOT EXISTS purpose           TEXT;
ALTER TABLE cash_advances ADD COLUMN IF NOT EXISTS approved_by       TEXT;
ALTER TABLE cash_advances ADD COLUMN IF NOT EXISTS approved_at       TIMESTAMP;
ALTER TABLE cash_advances ADD COLUMN IF NOT EXISTS disbursed_by      TEXT;
ALTER TABLE cash_advances ADD COLUMN IF NOT EXISTS currency          TEXT DEFAULT 'IDR';
ALTER TABLE cash_advances ADD COLUMN IF NOT EXISTS exchange_rate     NUMERIC(12,6) DEFAULT 1;
ALTER TABLE cash_advances ADD COLUMN IF NOT EXISTS source_system     TEXT DEFAULT 'advance_management';
ALTER TABLE cash_advances ADD COLUMN IF NOT EXISTS department_id     INTEGER;
ALTER TABLE cash_advances ADD COLUMN IF NOT EXISTS division_id       INTEGER;
ALTER TABLE cash_advances ADD COLUMN IF NOT EXISTS settled_at        TIMESTAMP;
ALTER TABLE cash_advances ADD COLUMN IF NOT EXISTS closed_at         TIMESTAMP;
```

**Idempotency**: Implementasi menggunakan `DO $$ BEGIN IF NOT EXISTS ... END $$` sehingga tidak error jika kolom sudah ada.

### Step 2 — Buat advance_settlements

```sql
CREATE TABLE IF NOT EXISTS advance_settlements (
  id                SERIAL PRIMARY KEY,
  company_id        INTEGER NOT NULL,
  advance_id        INTEGER NOT NULL REFERENCES cash_advances(id) ON DELETE RESTRICT,
  settlement_number TEXT NOT NULL,
  date              DATE NOT NULL,
  bank_account_id   INTEGER,
  amount_received   NUMERIC(14,2) NOT NULL,
  currency          TEXT NOT NULL DEFAULT 'IDR',
  exchange_rate     NUMERIC(12,6) NOT NULL DEFAULT 1,
  reference         TEXT,
  counterparty_name TEXT,
  status            TEXT NOT NULL DEFAULT 'posted',
  journal_id        INTEGER,
  notes             TEXT,
  created_by        TEXT,
  created_at        TIMESTAMP NOT NULL DEFAULT NOW(),
  updated_at        TIMESTAMP NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS adv_stl_company_idx ON advance_settlements(company_id);
CREATE INDEX IF NOT EXISTS adv_stl_advance_idx ON advance_settlements(advance_id);
```

### Step 3 — Buat advance_allocation_lines

```sql
CREATE TABLE IF NOT EXISTS advance_allocation_lines (
  id                 SERIAL PRIMARY KEY,
  settlement_id      INTEGER NOT NULL REFERENCES advance_settlements(id) ON DELETE CASCADE,
  advance_id         INTEGER NOT NULL,
  allocation_type    TEXT NOT NULL,
  reference_doc_id   INTEGER,
  reference_doc_type TEXT,
  coa_id             INTEGER,
  amount             NUMERIC(14,2) NOT NULL,
  remarks            TEXT,
  journal_id         INTEGER,
  created_at         TIMESTAMP NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS adv_alloc_stl_idx ON advance_allocation_lines(settlement_id);
CREATE INDEX IF NOT EXISTS adv_alloc_adv_idx ON advance_allocation_lines(advance_id);
```

### Step 4 — Migrate advance_type dari tipe lama

```sql
UPDATE cash_advances
SET advance_type = CASE
      WHEN type = 'kasbon'   THEN 'EMPLOYEE'
      WHEN type = 'talangan' AND vendor_id IS NOT NULL THEN 'VENDOR'
      WHEN type = 'talangan' THEN 'OPERATIONAL'
      ELSE 'OTHER'
    END
WHERE advance_type IS NULL;
```

**Idempotency**: `WHERE advance_type IS NULL` memastikan record yang sudah dimapping tidak diubah lagi.

### Step 5 — Migrate lifecycle_status dari status lama

```sql
UPDATE cash_advances
SET lifecycle_status = CASE
      WHEN status = 'active'           THEN 'outstanding'
      WHEN status = 'partial'          THEN 'partially_settled'
      WHEN status = 'repaid'           THEN 'settled'
      WHEN status = 'accounted'        THEN 'settled'
      WHEN status IN ('void','rejected') THEN 'void'
      WHEN status = 'pending_approval' THEN 'pending_approval'
      ELSE 'outstanding'
    END
WHERE lifecycle_status IS NULL;
```

**Idempotency**: `WHERE lifecycle_status IS NULL` memastikan tidak ada override data yang sudah dimapping.

---

## Rollback Plan

**Tidak ada DROP** — migrasi hanya menambahkan kolom dan tabel baru. Rollback manual jika diperlukan:

```sql
-- Hapus tabel baru (hanya jika belum ada data)
DROP TABLE IF EXISTS advance_allocation_lines;
DROP TABLE IF EXISTS advance_settlements;

-- Reset kolom baru ke NULL (kolom lama tidak terpengaruh)
UPDATE cash_advances SET advance_type = NULL, lifecycle_status = NULL WHERE source_system = 'advance_management';

-- Hapus kolom baru (HATI-HATI - irreversible untuk kolom)
-- ALTER TABLE cash_advances DROP COLUMN IF EXISTS advance_type;
-- (dst)
```

**PENTING**: Jangan rollback jika sudah ada record baru dengan `source_system='advance_management'` karena data advance baru bergantung pada kolom baru.

---

## Pre-Production Checklist

- [ ] Backup database sebelum migrasi ke PROD
- [ ] Jalankan `SELECT COUNT(*) FROM cash_advances WHERE advance_type IS NULL` — harus 0 setelah migrasi
- [ ] Jalankan `SELECT COUNT(*) FROM cash_advances WHERE lifecycle_status IS NULL` — harus 0 setelah migrasi
- [ ] Verifikasi advance_settlements dan advance_allocation_lines terbuat dengan benar
- [ ] Test create advance → disburse → settle di staging environment dulu
- [ ] Pastikan COA akun advance receivable tersedia untuk setiap company

---

## Compatibility

- **Sistem lama tetap berjalan**: Kasbon di `/expense/kasbon` masih ada sebagai legacy UI. Data lama dengan `source_system='legacy'` tidak terpengaruh workflow baru.
- **Dana Talangan di Bank Disbursement**: Tab `fund_advance` sudah dihapus dari `PaymentMode` type dan `PAYMENT_MODES` array. `FundAdvancePanel` component masih ada sebagai dead code (tidak di-render) dan dapat dihapus di cleanup task berikutnya.
- **Drizzle ORM**: Schema baru tidak menggunakan Drizzle schema definition — tabel dibuat via raw SQL di boot migration untuk menghindari merge konflik dengan `lib/db/src/schema/` yang dikelola Drizzle.

---

## Timeline Migrasi DEV → PROD

1. **DEV**: Migration sudah berjalan otomatis ✅
2. **STAGING**: Deploy ke staging, jalankan smoke test lengkap
3. **PROD**: Jadwalkan maintenance window, jalankan `pnpm migrate:prod` untuk schema changes lain terlebih dahulu, lalu deploy
4. **Monitoring**: Pantau `advance_type IS NULL` count di dashboard selama 24 jam pertama
