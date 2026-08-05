-- ============================================================
-- ROLLBACK SCRIPT (Hanya untuk TABEL BARU)
-- ⚠️  PERINGATAN PENTING:
--     - Kolom yang sudah ditambahkan (ALTER TABLE ADD COLUMN)
--       TIDAK bisa di-rollback di sini karena DROP COLUMN
--       berisiko merusak data & tidak diizinkan oleh aturan migrasi.
--     - Script ini HANYA me-drop tabel baru yang BELUM ADA datanya.
--     - JANGAN jalankan tanpa verifikasi data terlebih dahulu!
-- Tanggal: 2026-07-07
-- ============================================================

BEGIN;

-- ── Rollback tabel AI Intelligence (cek kosong dahulu) ───────
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema='public' AND table_name='accuracy_snapshots')
     AND (SELECT count(*) FROM public.accuracy_snapshots) = 0
  THEN DROP TABLE public.accuracy_snapshots; RAISE NOTICE 'Dropped: accuracy_snapshots'; END IF;

  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema='public' AND table_name='ai_experiments')
     AND (SELECT count(*) FROM public.ai_experiments) = 0
  THEN DROP TABLE public.ai_experiments; RAISE NOTICE 'Dropped: ai_experiments'; END IF;

  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema='public' AND table_name='experiment_observations')
     AND (SELECT count(*) FROM public.experiment_observations) = 0
  THEN DROP TABLE public.experiment_observations; END IF;

  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema='public' AND table_name='experiment_results')
     AND (SELECT count(*) FROM public.experiment_results) = 0
  THEN DROP TABLE public.experiment_results; END IF;

  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema='public' AND table_name='correction_queue')
     AND (SELECT count(*) FROM public.correction_queue) = 0
  THEN DROP TABLE public.correction_queue; END IF;

  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema='public' AND table_name='correction_sessions')
     AND (SELECT count(*) FROM public.correction_sessions) = 0
  THEN DROP TABLE public.correction_sessions; END IF;

  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema='public' AND table_name='dataset_exports')
     AND (SELECT count(*) FROM public.dataset_exports) = 0
  THEN DROP TABLE public.dataset_exports; END IF;

  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema='public' AND table_name='escalation_logs')
     AND (SELECT count(*) FROM public.escalation_logs) = 0
  THEN DROP TABLE public.escalation_logs; END IF;

  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema='public' AND table_name='performance_by_intent')
     AND (SELECT count(*) FROM public.performance_by_intent) = 0
  THEN DROP TABLE public.performance_by_intent; END IF;

  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema='public' AND table_name='performance_daily')
     AND (SELECT count(*) FROM public.performance_daily) = 0
  THEN DROP TABLE public.performance_daily; END IF;

  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema='public' AND table_name='prompt_test_results')
     AND (SELECT count(*) FROM public.prompt_test_results) = 0
  THEN DROP TABLE public.prompt_test_results; END IF;

  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema='public' AND table_name='routing_rules')
     AND (SELECT count(*) FROM public.routing_rules) = 0
  THEN DROP TABLE public.routing_rules; END IF;

  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema='public' AND table_name='sla_matrix')
     AND (SELECT count(*) FROM public.sla_matrix) = 0
  THEN DROP TABLE public.sla_matrix; END IF;

  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema='public' AND table_name='training_dataset')
     AND (SELECT count(*) FROM public.training_dataset) = 0
  THEN DROP TABLE public.training_dataset; END IF;
END $$;

-- ── Rollback tabel Sport Center baru ─────────────────────────
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema='sport_center' AND table_name='company_invoice_settings')
     AND (SELECT count(*) FROM sport_center.company_invoice_settings) = 0
  THEN DROP TABLE sport_center.company_invoice_settings; END IF;

  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema='sport_center' AND table_name='document_file_templates')
     AND (SELECT count(*) FROM sport_center.document_file_templates) = 0
  THEN DROP TABLE sport_center.document_file_templates; END IF;

  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema='sport_center' AND table_name='gym_memberships')
     AND (SELECT count(*) FROM sport_center.gym_memberships) = 0
  THEN DROP TABLE sport_center.gym_memberships; END IF;

  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema='sport_center' AND table_name='payments')
     AND (SELECT count(*) FROM sport_center.payments) = 0
  THEN DROP TABLE sport_center.payments; END IF;

  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema='sport_center' AND table_name='settings')
     AND (SELECT count(*) FROM sport_center.settings) = 0
  THEN DROP TABLE sport_center.settings; END IF;

  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema='sport_center' AND table_name='system_connection_baselines')
     AND (SELECT count(*) FROM sport_center.system_connection_baselines) = 0
  THEN DROP TABLE sport_center.system_connection_baselines; END IF;
END $$;

-- ── Rollback TravelInTrips (hapus schema jika semua tabel kosong) ──
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.schemata WHERE schema_name = 'travelintrips') THEN
    DECLARE total_rows BIGINT := 0; BEGIN
      SELECT count(*) INTO total_rows FROM travelintrips.orders;
      IF total_rows = 0 THEN
        DROP SCHEMA travelintrips CASCADE;
        RAISE NOTICE 'Dropped schema: travelintrips';
      ELSE
        RAISE NOTICE 'travelintrips schema NOT dropped — contains % rows in orders', total_rows;
      END IF;
    END;
  END IF;
END $$;

COMMIT;
