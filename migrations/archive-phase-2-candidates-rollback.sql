-- ============================================================================
-- archive-phase-2-candidates-rollback.sql
-- Dibuat  : 2026-06-23
-- Tujuan  : Rollback dari archive-phase-2-candidates.sql
--           RENAME zz_deleted_* → nama asli
-- Total   : 5 tabel
--
-- PERINTAH EKSEKUSI:
--   psql "$SUPABASE_DATABASE_URL" -f migrations/archive-phase-2-candidates-rollback.sql
--
-- CATATAN: Rollback ini me-restore tabel. Code changes di supabaseSync.ts,
--   routes.ts, migration.ts harus di-revert secara manual via git jika diperlukan.
-- ============================================================================

BEGIN;

DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_tables WHERE schemaname='public' AND tablename='zz_deleted_sc_payments')
     AND NOT EXISTS (SELECT 1 FROM pg_tables WHERE schemaname='public' AND tablename='sc_payments')
  THEN
    ALTER TABLE public.zz_deleted_sc_payments RENAME TO sc_payments;
    RAISE NOTICE 'ROLLBACK: sc_payments restored';
  ELSE
    RAISE NOTICE 'SKIP rollback sc_payments: zz_deleted tidak ada atau target sudah ada';
  END IF;
END $$;

DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_tables WHERE schemaname='public' AND tablename='zz_deleted_workflow_events')
     AND NOT EXISTS (SELECT 1 FROM pg_tables WHERE schemaname='public' AND tablename='workflow_events')
  THEN
    ALTER TABLE public.zz_deleted_workflow_events RENAME TO workflow_events;
    RAISE NOTICE 'ROLLBACK: workflow_events restored';
  ELSE
    RAISE NOTICE 'SKIP rollback workflow_events: zz_deleted tidak ada atau target sudah ada';
    -- NOTE: jika boot migration sudah CREATE TABLE workflow_events baru,
    --       harus DROP TABLE workflow_events dulu sebelum rollback.
  END IF;
END $$;

DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_tables WHERE schemaname='public' AND tablename='zz_deleted_sport_center_facilities')
     AND NOT EXISTS (SELECT 1 FROM pg_tables WHERE schemaname='public' AND tablename='sport_center_facilities')
  THEN
    ALTER TABLE public.zz_deleted_sport_center_facilities RENAME TO sport_center_facilities;
    RAISE NOTICE 'ROLLBACK: sport_center_facilities restored';
  ELSE
    RAISE NOTICE 'SKIP rollback sport_center_facilities: zz_deleted tidak ada atau target sudah ada';
  END IF;
END $$;

DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_tables WHERE schemaname='public' AND tablename='zz_deleted_sport_center_bookings')
     AND NOT EXISTS (SELECT 1 FROM pg_tables WHERE schemaname='public' AND tablename='sport_center_bookings')
  THEN
    ALTER TABLE public.zz_deleted_sport_center_bookings RENAME TO sport_center_bookings;
    RAISE NOTICE 'ROLLBACK: sport_center_bookings restored';
  ELSE
    RAISE NOTICE 'SKIP rollback sport_center_bookings: zz_deleted tidak ada atau target sudah ada';
  END IF;
END $$;

DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_tables WHERE schemaname='public' AND tablename='zz_deleted_sport_center_memberships')
     AND NOT EXISTS (SELECT 1 FROM pg_tables WHERE schemaname='public' AND tablename='sport_center_memberships')
  THEN
    ALTER TABLE public.zz_deleted_sport_center_memberships RENAME TO sport_center_memberships;
    RAISE NOTICE 'ROLLBACK: sport_center_memberships restored';
  ELSE
    RAISE NOTICE 'SKIP rollback sport_center_memberships: zz_deleted tidak ada atau target sudah ada';
  END IF;
END $$;

COMMIT;

-- Verifikasi rollback berhasil:
SELECT tablename, 'RESTORED' AS status
FROM pg_tables
WHERE schemaname='public'
  AND tablename IN (
    'sc_payments',
    'workflow_events',
    'sport_center_facilities',
    'sport_center_bookings',
    'sport_center_memberships'
  )
ORDER BY tablename;
