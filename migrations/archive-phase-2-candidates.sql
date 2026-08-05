-- ============================================================================
-- archive-phase-2-candidates.sql
-- Dibuat  : 2026-06-23
-- Strategi: RENAME ke zz_deleted_* (BUKAN DROP). Rollback: archive-phase-2-candidates-rollback.sql
--
-- Berisi  : 5 tabel ARCHIVE CANDIDATE dari Phase 2
--   1. sc_payments             — tidak ada SQL dependency di kode
--   2. workflow_events         — hanya CREATE TABLE di boot migration, tidak pernah dipakai
--   3. sport_center_facilities — fallback code fix sudah diterapkan (supabaseSync.ts L251)
--   4. sport_center_bookings   — fallback + ALTER TABLE code fix sudah diterapkan
--   5. sport_center_memberships — UNION ALL code fix sudah diterapkan; verifikasi data dulu
--
-- EXCLUDED (KEEP):
--   shipment_stages              — active Drizzle schema + freight.ts stages routes
--   transaction_datetime_normalized — fleetIntelligence.ts inline migration v7 + active DML
--   fleet_partners, fleet_vehicles, fleet_ledger_entries, fleet_outstanding_import_log — KEEP
--
-- PRASYARAT:
--   1. Terapkan code changes (supabaseSync.ts, routes.ts, migration.ts) dan restart API Server
--   2. Verifikasi GET /api/sport-center/members berfungsi
--   3. pg_dump production sudah disimpan
--   4. Jalankan pre-execution checklist di docs/supabase-cleanup-phase-2-impact.md
--   5. Untuk sport_center_memberships: verifikasi data sudah di-migrate ke sport_members dulu
--
-- PERINTAH EKSEKUSI:
--   psql "$SUPABASE_DATABASE_URL" -f migrations/archive-phase-2-candidates.sql
-- ============================================================================

BEGIN;

-- ─── 1. sc_payments [SAFE — zero code references] ─────────────────────────
DO $$ DECLARE v BIGINT; BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_tables WHERE schemaname='public' AND tablename='sc_payments') THEN
    RAISE NOTICE 'SKIP sc_payments: tabel tidak ditemukan';
    RETURN;
  END IF;
  IF EXISTS (SELECT 1 FROM pg_tables WHERE schemaname='public' AND tablename='zz_deleted_sc_payments') THEN
    RAISE NOTICE 'SKIP sc_payments: zz_deleted sudah ada';
    RETURN;
  END IF;
  SELECT COUNT(*) INTO v FROM public.sc_payments;
  IF v > 0 THEN
    RAISE NOTICE 'WARN sc_payments: % rows — tetap direname (data dipertahankan di zz_deleted)', v;
  END IF;
  ALTER TABLE public.sc_payments RENAME TO zz_deleted_sc_payments;
  RAISE NOTICE 'OK: sc_payments → zz_deleted_sc_payments (% rows archived)', v;
END $$;

-- ─── 2. workflow_events [SAFE — hanya dibuat di boot migration, tidak pernah dipakai] ───
-- NOTE: boot migration (phase1Migration.ts) akan CREATE TABLE baru yang kosong di restart berikutnya.
--       Ini aman (self-healing) karena tidak ada kode yang INSERT/SELECT ke tabel ini.
DO $$ DECLARE v BIGINT; BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_tables WHERE schemaname='public' AND tablename='workflow_events') THEN
    RAISE NOTICE 'SKIP workflow_events: tabel tidak ditemukan';
    RETURN;
  END IF;
  IF EXISTS (SELECT 1 FROM pg_tables WHERE schemaname='public' AND tablename='zz_deleted_workflow_events') THEN
    RAISE NOTICE 'SKIP workflow_events: zz_deleted sudah ada';
    RETURN;
  END IF;
  SELECT COUNT(*) INTO v FROM public.workflow_events;
  RAISE NOTICE 'INFO workflow_events: % rows saat diarsip', v;
  ALTER TABLE public.workflow_events RENAME TO zz_deleted_workflow_events;
  RAISE NOTICE 'OK: workflow_events → zz_deleted_workflow_events';
END $$;

-- ─── 3. sport_center_facilities [SAFE — fallback code diubah ke sport_facilities] ───
-- PRASYARAT: supabaseSync.ts L251 sudah diubah → UPDATE sport_facilities
DO $$ DECLARE v BIGINT; BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_tables WHERE schemaname='public' AND tablename='sport_center_facilities') THEN
    RAISE NOTICE 'SKIP sport_center_facilities: tabel tidak ditemukan';
    RETURN;
  END IF;
  IF EXISTS (SELECT 1 FROM pg_tables WHERE schemaname='public' AND tablename='zz_deleted_sport_center_facilities') THEN
    RAISE NOTICE 'SKIP sport_center_facilities: zz_deleted sudah ada';
    RETURN;
  END IF;
  SELECT COUNT(*) INTO v FROM public.sport_center_facilities;
  IF v > 0 THEN
    RAISE NOTICE 'WARN sport_center_facilities: % rows — direname (data dipertahankan)', v;
  END IF;
  ALTER TABLE public.sport_center_facilities RENAME TO zz_deleted_sport_center_facilities;
  RAISE NOTICE 'OK: sport_center_facilities → zz_deleted_sport_center_facilities (% rows archived)', v;
END $$;

-- ─── 4. sport_center_bookings [SAFE — fallback + ALTER TABLE code fix diterapkan] ───
-- PRASYARAT:
--   - supabaseSync.ts L382-401 + L528-540 sudah diubah (skip fallback INSERT)
--   - routes.ts L4753 sudah diubah (skip fallback INSERT)
--   - migration.ts L433-464 ALTER TABLE blocks sudah dihapus
-- NOTE: migration.ts L334 (one-time data migration) sudah diproteksi IF EXISTS → aman
DO $$ DECLARE v BIGINT; BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_tables WHERE schemaname='public' AND tablename='sport_center_bookings') THEN
    RAISE NOTICE 'SKIP sport_center_bookings: tabel tidak ditemukan';
    RETURN;
  END IF;
  IF EXISTS (SELECT 1 FROM pg_tables WHERE schemaname='public' AND tablename='zz_deleted_sport_center_bookings') THEN
    RAISE NOTICE 'SKIP sport_center_bookings: zz_deleted sudah ada';
    RETURN;
  END IF;
  SELECT COUNT(*) INTO v FROM public.sport_center_bookings;
  IF v > 0 THEN
    RAISE NOTICE 'WARN sport_center_bookings: % rows — direname (data dipertahankan di zz_deleted)', v;
  END IF;
  ALTER TABLE public.sport_center_bookings RENAME TO zz_deleted_sport_center_bookings;
  RAISE NOTICE 'OK: sport_center_bookings → zz_deleted_sport_center_bookings (% rows archived)', v;
END $$;

-- ─── 5. sport_center_memberships [CONDITIONAL — verifikasi data migration dulu] ──────
-- PRASYARAT: Pastikan semua data sudah di-migrate ke sport_members sebelum archive.
--   Cek: SELECT COUNT(*) FROM sport_center_memberships;
--   Jika > 0: jalankan INSERT INTO sport_members ... SELECT FROM sport_center_memberships dulu.
-- NOTE: UNION ALL dari routes.ts L1349-1370 sudah dihapus (GET /members hanya dari sport_members).
DO $$ DECLARE v BIGINT; sm_count BIGINT; BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_tables WHERE schemaname='public' AND tablename='sport_center_memberships') THEN
    RAISE NOTICE 'SKIP sport_center_memberships: tabel tidak ditemukan';
    RETURN;
  END IF;
  IF EXISTS (SELECT 1 FROM pg_tables WHERE schemaname='public' AND tablename='zz_deleted_sport_center_memberships') THEN
    RAISE NOTICE 'SKIP sport_center_memberships: zz_deleted sudah ada';
    RETURN;
  END IF;
  SELECT COUNT(*) INTO v FROM public.sport_center_memberships;
  IF v > 0 THEN
    SELECT COUNT(*) INTO sm_count FROM public.sport_members;
    RAISE WARNING 'sport_center_memberships: % rows akan diarsip. sport_members saat ini punya % records. Verifikasi data migration sudah selesai sebelum archive.', v, sm_count;
  END IF;
  ALTER TABLE public.sport_center_memberships RENAME TO zz_deleted_sport_center_memberships;
  RAISE NOTICE 'OK: sport_center_memberships → zz_deleted_sport_center_memberships (% rows archived)', v;
END $$;

COMMIT;

-- ── MONITOR SETELAH EKSEKUSI ─────────────────────────────────────────────────
-- Verifikasi tabel berhasil diarsip:
SELECT tablename, 'ARCHIVED' AS status
FROM pg_tables
WHERE schemaname='public'
  AND tablename IN (
    'zz_deleted_sc_payments',
    'zz_deleted_workflow_events',
    'zz_deleted_sport_center_facilities',
    'zz_deleted_sport_center_bookings',
    'zz_deleted_sport_center_memberships'
  )
ORDER BY tablename;

-- Verifikasi tabel KEEP masih ada:
SELECT tablename, 'KEEP OK' AS status
FROM pg_tables
WHERE schemaname='public'
  AND tablename IN (
    'shipment_stages',
    'transaction_datetime_normalized',
    'fleet_partners',
    'fleet_vehicles',
    'fleet_ledger_entries',
    'fleet_outstanding_import_log',
    'sport_bookings',
    'sport_facilities',
    'sport_members'
  )
ORDER BY tablename;
