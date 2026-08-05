-- ============================================================================
-- ROLLBACK: RESOLVE KEEP-ARCHIVED TABLES
-- Tanggal dibuat  : 2026-06-23
-- Pasangan        : migrations/resolve-keep-archived.sql
-- Status          : EMERGENCY ONLY — jangan dijalankan kecuali terjadi masalah
--
-- KAPAN DIGUNAKAN:
--   Jika setelah menjalankan resolve-keep-archived.sql ada data yang hilang
--   atau sistem butuh tabel-tabel ini kembali untuk investigasi.
--
-- CATATAN:
--   - workflow_events: kode sudah dihapus dari Drizzle + phase1Migration.
--     Jika perlu restore, BUAT ULANG juga file schema dan boot migration.
--   - sport_center_memberships & sport_center_bookings: tabel tidak ada
--     di DB sebelum resolve — rollback hanya relevan jika backup data ada.
-- ============================================================================

-- ── ROLLBACK workflow_events ──────────────────────────────────────────────────
--
-- PERINGATAN: Kode Drizzle schema untuk tabel ini sudah DIHAPUS (2026-06-23).
-- Jika restore tabel ini, perlu JUGA:
--   1. Restore lib/db/src/schema/workflowEvents.ts dari git history
--   2. Re-add export ke lib/db/src/schema/index.ts
--   3. Re-add CREATE TABLE block ke phase1Migration.ts
--   git checkout bdfdabd6^1 -- lib/db/src/schema/workflowEvents.ts
--   git checkout bdfdabd6^1 -- artifacts/api-server/src/lib/phase1Migration.ts

CREATE TABLE IF NOT EXISTS workflow_events (
  id            SERIAL PRIMARY KEY,
  event_type    TEXT NOT NULL,
  entity_type   TEXT NOT NULL,
  entity_id     INTEGER NOT NULL,
  company_id    INTEGER,
  payload       JSONB NOT NULL DEFAULT '{}',
  status        TEXT NOT NULL DEFAULT 'pending',
  attempts      INTEGER NOT NULL DEFAULT 0,
  max_attempts  INTEGER NOT NULL DEFAULT 3,
  process_after TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  processed_at  TIMESTAMPTZ,
  error_message TEXT,
  created_at    TIMESTAMP NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS workflow_events_status_idx
  ON workflow_events(status, process_after)
  WHERE status = 'pending';

CREATE INDEX IF NOT EXISTS workflow_events_entity_idx
  ON workflow_events(entity_type, entity_id);

-- ── ROLLBACK sport_center_memberships ────────────────────────────────────────
--
-- Tabel ini tidak ada di DB sebelum resolve — rollback hanya relevan
-- jika ada backup data dari sebelum Phase 2 archive.

CREATE TABLE IF NOT EXISTS sport_center_memberships (
  id          SERIAL PRIMARY KEY,
  name        TEXT,
  email       TEXT,
  phone       TEXT,
  member_type TEXT,
  start_date  DATE,
  status      TEXT DEFAULT 'active',
  notes       TEXT,
  created_at  TIMESTAMP NOT NULL DEFAULT NOW()
);

-- ── ROLLBACK sport_center_bookings ───────────────────────────────────────────
--
-- Tabel ini tidak ada di DB sebelum resolve — rollback hanya relevan
-- jika ada backup data dari sebelum Phase 2 archive.

CREATE TABLE IF NOT EXISTS sport_center_bookings (
  id          SERIAL PRIMARY KEY,
  facility_id INTEGER,
  member_id   INTEGER,
  booking_date DATE,
  start_time  TIME,
  end_time    TIME,
  status      TEXT DEFAULT 'pending',
  notes       TEXT,
  created_at  TIMESTAMP NOT NULL DEFAULT NOW()
);

-- ── VERIFIKASI ROLLBACK ───────────────────────────────────────────────────────

SELECT table_name FROM information_schema.tables
WHERE table_schema = 'public'
  AND table_name IN ('workflow_events', 'sport_center_memberships', 'sport_center_bookings');
-- Expected: 3 rows (jika rollback berhasil)

-- ============================================================================
