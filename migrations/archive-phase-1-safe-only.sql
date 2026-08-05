-- ============================================================================
-- archive-phase-1-safe-only.sql
-- Dibuat  : 2026-06-22
-- Diupdate: 2026-06-23 v2 (validasi: hapus fleet_outstanding_import_log → KEEP, hapus shipments → HIGH risk)
-- Strategi: RENAME ke zz_deleted_* (BUKAN DROP). Rollback: archive-phase-1-safe-only-rollback.sql
--
-- Berisi  : 47 tabel SAFE (rows=0) + 6 tabel LOW (rows=0, fk_in=0)
-- Dikecualikan (berisi data):
--   - employees, employee_kasbon, order_asuransi, payment_receipts,
--     finance_payment_events, wa_send_logs, system_settings
-- Dikecualikan (BLOCKED — referensi aktif):
--   - sc_payments, sport_center_memberships, transaction_datetime_normalized,
--     workflow_events, sport_center_bookings, sport_center_facilities,
--     shipment_stages
-- Dikecualikan (KEEP — FK aktif / inline migration):
--   - fleet_partners, fleet_vehicles, fleet_ledger_entries,
--     fleet_reports, fleet_drivers,
--     fleet_outstanding_import_log  ← inline migration v14 di fleetIntelligence.ts + DML aktif
-- Dikecualikan (HIGH risk — route + Drizzle schema aktif):
--   - shipments  ← shipmentsTable dipakai di logistics.ts:59-60, GET /api/logistics/shipments
--
-- PRASYARAT:
--   1. pg_dump production sudah disimpan
--   2. Jalankan scripts/backup-low-risk-tables.mjs untuk tabel LOW yang berisi data
--   3. Tidak ada traffic aktif ke tabel-tabel ini
--   4. Jalankan di maintenance window
--   5. JANGAN jalankan otomatis — manual review wajib
--
-- PERINTAH EKSEKUSI:
--   psql "$SUPABASE_DATABASE_URL" -f migrations/archive-phase-1-safe-only.sql
-- ============================================================================

-- ── STEP 0: VERIFIKASI ROW COUNT ──────────────────────────────────────────────
SELECT tablename, (SELECT COUNT(*) FROM information_schema.tables WHERE table_name=tablename) AS exists
FROM (VALUES
  ('ai_tasks'), ('attendance_records'), ('bank_account_balances'),
  ('bank_closing_periods'), ('bank_coa_rules'), ('bank_recon_audit_logs'),
  ('banners'), ('blast_session_logs'), ('cashier_shifts'),
  ('cms_blocks'), ('cms_media'), ('cms_pages'), ('cms_settings'),
  ('company_settings'), ('customer_contexts'), ('data_template_fields'),
  ('data_templates'), ('dispatcher_logs'), ('document_audits'),
  ('document_template_fields'), ('document_templates'), ('draft_agreements_wa_log'),
  ('follow_up_logs'), ('gym_memberships'), ('intent_master'),
  ('keyword_rules'), ('leave_requests'), ('operational_checklists'),
  ('operational_expenses'), ('otp_tokens'), ('page_products'),
  ('promo_registrations'), ('public_tokens'), ('registration_link_wa_log'),
  ('sc_admin_notes'), ('sc_blocked_schedules'), ('sc_facility_images'),
  ('sc_promos'), ('sc_settings'), ('service_catalog'),
  ('service_circuit_states'), ('service_registry'), ('shipment_events'),
  ('shipment_trackings'), ('sport_center_expenses'),
  ('task_assignments'), ('task_attachments'), ('task_comments'),
  ('task_timeline'), ('team_members'), ('user_site_access'),
  ('whatsapp_messages'), ('whatsapp_notifications')
) AS t(tablename);

-- ── STEP 1: RENAME DENGAN GUARD ──────────────────────────────────────────────
-- Setiap tabel di-wrap dalam DO block dengan 3 guard:
--   (a) Tabel masih ada
--   (b) Belum pernah direname (zz_deleted_* belum ada)
--   (c) Row count = 0

-- 1. ai_tasks
DO $$ DECLARE v BIGINT; BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_tables WHERE schemaname='public' AND tablename='ai_tasks') THEN RAISE NOTICE 'SKIP ai_tasks: tidak ditemukan'; RETURN; END IF;
  IF EXISTS (SELECT 1 FROM pg_tables WHERE schemaname='public' AND tablename='zz_deleted_ai_tasks') THEN RAISE NOTICE 'SKIP ai_tasks: zz_deleted sudah ada'; RETURN; END IF;
  SELECT COUNT(*) INTO v FROM public.ai_tasks;
  IF v > 0 THEN RAISE NOTICE 'SKIP ai_tasks: % rows — tidak direname', v; RETURN; END IF;
  ALTER TABLE public.ai_tasks RENAME TO zz_deleted_ai_tasks;
  RAISE NOTICE 'OK: ai_tasks → zz_deleted_ai_tasks';
END $$;

-- 2. attendance_records
DO $$ DECLARE v BIGINT; BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_tables WHERE schemaname='public' AND tablename='attendance_records') THEN RAISE NOTICE 'SKIP attendance_records: tidak ditemukan'; RETURN; END IF;
  IF EXISTS (SELECT 1 FROM pg_tables WHERE schemaname='public' AND tablename='zz_deleted_attendance_records') THEN RAISE NOTICE 'SKIP attendance_records: zz_deleted sudah ada'; RETURN; END IF;
  SELECT COUNT(*) INTO v FROM public.attendance_records;
  IF v > 0 THEN RAISE NOTICE 'SKIP attendance_records: % rows — tidak direname', v; RETURN; END IF;
  ALTER TABLE public.attendance_records RENAME TO zz_deleted_attendance_records;
  RAISE NOTICE 'OK: attendance_records → zz_deleted_attendance_records';
END $$;

-- 3. bank_account_balances
DO $$ DECLARE v BIGINT; BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_tables WHERE schemaname='public' AND tablename='bank_account_balances') THEN RAISE NOTICE 'SKIP bank_account_balances: tidak ditemukan'; RETURN; END IF;
  IF EXISTS (SELECT 1 FROM pg_tables WHERE schemaname='public' AND tablename='zz_deleted_bank_account_balances') THEN RAISE NOTICE 'SKIP bank_account_balances: zz_deleted sudah ada'; RETURN; END IF;
  SELECT COUNT(*) INTO v FROM public.bank_account_balances;
  IF v > 0 THEN RAISE NOTICE 'SKIP bank_account_balances: % rows — tidak direname', v; RETURN; END IF;
  ALTER TABLE public.bank_account_balances RENAME TO zz_deleted_bank_account_balances;
  RAISE NOTICE 'OK: bank_account_balances → zz_deleted_bank_account_balances';
END $$;

-- 4. bank_closing_periods
DO $$ DECLARE v BIGINT; BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_tables WHERE schemaname='public' AND tablename='bank_closing_periods') THEN RAISE NOTICE 'SKIP bank_closing_periods: tidak ditemukan'; RETURN; END IF;
  IF EXISTS (SELECT 1 FROM pg_tables WHERE schemaname='public' AND tablename='zz_deleted_bank_closing_periods') THEN RAISE NOTICE 'SKIP bank_closing_periods: zz_deleted sudah ada'; RETURN; END IF;
  SELECT COUNT(*) INTO v FROM public.bank_closing_periods;
  IF v > 0 THEN RAISE NOTICE 'SKIP bank_closing_periods: % rows — tidak direname', v; RETURN; END IF;
  ALTER TABLE public.bank_closing_periods RENAME TO zz_deleted_bank_closing_periods;
  RAISE NOTICE 'OK: bank_closing_periods → zz_deleted_bank_closing_periods';
END $$;

-- 5. bank_coa_rules
DO $$ DECLARE v BIGINT; BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_tables WHERE schemaname='public' AND tablename='bank_coa_rules') THEN RAISE NOTICE 'SKIP bank_coa_rules: tidak ditemukan'; RETURN; END IF;
  IF EXISTS (SELECT 1 FROM pg_tables WHERE schemaname='public' AND tablename='zz_deleted_bank_coa_rules') THEN RAISE NOTICE 'SKIP bank_coa_rules: zz_deleted sudah ada'; RETURN; END IF;
  SELECT COUNT(*) INTO v FROM public.bank_coa_rules;
  IF v > 0 THEN RAISE NOTICE 'SKIP bank_coa_rules: % rows — tidak direname', v; RETURN; END IF;
  ALTER TABLE public.bank_coa_rules RENAME TO zz_deleted_bank_coa_rules;
  RAISE NOTICE 'OK: bank_coa_rules → zz_deleted_bank_coa_rules';
END $$;

-- 6. bank_recon_audit_logs
DO $$ DECLARE v BIGINT; BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_tables WHERE schemaname='public' AND tablename='bank_recon_audit_logs') THEN RAISE NOTICE 'SKIP bank_recon_audit_logs: tidak ditemukan'; RETURN; END IF;
  IF EXISTS (SELECT 1 FROM pg_tables WHERE schemaname='public' AND tablename='zz_deleted_bank_recon_audit_logs') THEN RAISE NOTICE 'SKIP bank_recon_audit_logs: zz_deleted sudah ada'; RETURN; END IF;
  SELECT COUNT(*) INTO v FROM public.bank_recon_audit_logs;
  IF v > 0 THEN RAISE NOTICE 'SKIP bank_recon_audit_logs: % rows — tidak direname', v; RETURN; END IF;
  ALTER TABLE public.bank_recon_audit_logs RENAME TO zz_deleted_bank_recon_audit_logs;
  RAISE NOTICE 'OK: bank_recon_audit_logs → zz_deleted_bank_recon_audit_logs';
END $$;

-- 7. banners
DO $$ DECLARE v BIGINT; BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_tables WHERE schemaname='public' AND tablename='banners') THEN RAISE NOTICE 'SKIP banners: tidak ditemukan'; RETURN; END IF;
  IF EXISTS (SELECT 1 FROM pg_tables WHERE schemaname='public' AND tablename='zz_deleted_banners') THEN RAISE NOTICE 'SKIP banners: zz_deleted sudah ada'; RETURN; END IF;
  SELECT COUNT(*) INTO v FROM public.banners;
  IF v > 0 THEN RAISE NOTICE 'SKIP banners: % rows — tidak direname', v; RETURN; END IF;
  ALTER TABLE public.banners RENAME TO zz_deleted_banners;
  RAISE NOTICE 'OK: banners → zz_deleted_banners';
END $$;

-- 8. blast_session_logs
DO $$ DECLARE v BIGINT; BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_tables WHERE schemaname='public' AND tablename='blast_session_logs') THEN RAISE NOTICE 'SKIP blast_session_logs: tidak ditemukan'; RETURN; END IF;
  IF EXISTS (SELECT 1 FROM pg_tables WHERE schemaname='public' AND tablename='zz_deleted_blast_session_logs') THEN RAISE NOTICE 'SKIP blast_session_logs: zz_deleted sudah ada'; RETURN; END IF;
  SELECT COUNT(*) INTO v FROM public.blast_session_logs;
  IF v > 0 THEN RAISE NOTICE 'SKIP blast_session_logs: % rows — tidak direname', v; RETURN; END IF;
  ALTER TABLE public.blast_session_logs RENAME TO zz_deleted_blast_session_logs;
  RAISE NOTICE 'OK: blast_session_logs → zz_deleted_blast_session_logs';
END $$;

-- 9. cashier_shifts
DO $$ DECLARE v BIGINT; BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_tables WHERE schemaname='public' AND tablename='cashier_shifts') THEN RAISE NOTICE 'SKIP cashier_shifts: tidak ditemukan'; RETURN; END IF;
  IF EXISTS (SELECT 1 FROM pg_tables WHERE schemaname='public' AND tablename='zz_deleted_cashier_shifts') THEN RAISE NOTICE 'SKIP cashier_shifts: zz_deleted sudah ada'; RETURN; END IF;
  SELECT COUNT(*) INTO v FROM public.cashier_shifts;
  IF v > 0 THEN RAISE NOTICE 'SKIP cashier_shifts: % rows — tidak direname', v; RETURN; END IF;
  ALTER TABLE public.cashier_shifts RENAME TO zz_deleted_cashier_shifts;
  RAISE NOTICE 'OK: cashier_shifts → zz_deleted_cashier_shifts';
END $$;

-- 10. cms_blocks
DO $$ DECLARE v BIGINT; BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_tables WHERE schemaname='public' AND tablename='cms_blocks') THEN RAISE NOTICE 'SKIP cms_blocks: tidak ditemukan'; RETURN; END IF;
  IF EXISTS (SELECT 1 FROM pg_tables WHERE schemaname='public' AND tablename='zz_deleted_cms_blocks') THEN RAISE NOTICE 'SKIP cms_blocks: zz_deleted sudah ada'; RETURN; END IF;
  SELECT COUNT(*) INTO v FROM public.cms_blocks;
  IF v > 0 THEN RAISE NOTICE 'SKIP cms_blocks: % rows — tidak direname', v; RETURN; END IF;
  ALTER TABLE public.cms_blocks RENAME TO zz_deleted_cms_blocks;
  RAISE NOTICE 'OK: cms_blocks → zz_deleted_cms_blocks';
END $$;

-- 11. cms_media
DO $$ DECLARE v BIGINT; BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_tables WHERE schemaname='public' AND tablename='cms_media') THEN RAISE NOTICE 'SKIP cms_media: tidak ditemukan'; RETURN; END IF;
  IF EXISTS (SELECT 1 FROM pg_tables WHERE schemaname='public' AND tablename='zz_deleted_cms_media') THEN RAISE NOTICE 'SKIP cms_media: zz_deleted sudah ada'; RETURN; END IF;
  SELECT COUNT(*) INTO v FROM public.cms_media;
  IF v > 0 THEN RAISE NOTICE 'SKIP cms_media: % rows — tidak direname', v; RETURN; END IF;
  ALTER TABLE public.cms_media RENAME TO zz_deleted_cms_media;
  RAISE NOTICE 'OK: cms_media → zz_deleted_cms_media';
END $$;

-- 12. cms_pages
DO $$ DECLARE v BIGINT; BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_tables WHERE schemaname='public' AND tablename='cms_pages') THEN RAISE NOTICE 'SKIP cms_pages: tidak ditemukan'; RETURN; END IF;
  IF EXISTS (SELECT 1 FROM pg_tables WHERE schemaname='public' AND tablename='zz_deleted_cms_pages') THEN RAISE NOTICE 'SKIP cms_pages: zz_deleted sudah ada'; RETURN; END IF;
  SELECT COUNT(*) INTO v FROM public.cms_pages;
  IF v > 0 THEN RAISE NOTICE 'SKIP cms_pages: % rows — tidak direname', v; RETURN; END IF;
  ALTER TABLE public.cms_pages RENAME TO zz_deleted_cms_pages;
  RAISE NOTICE 'OK: cms_pages → zz_deleted_cms_pages';
END $$;

-- 13. cms_settings
DO $$ DECLARE v BIGINT; BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_tables WHERE schemaname='public' AND tablename='cms_settings') THEN RAISE NOTICE 'SKIP cms_settings: tidak ditemukan'; RETURN; END IF;
  IF EXISTS (SELECT 1 FROM pg_tables WHERE schemaname='public' AND tablename='zz_deleted_cms_settings') THEN RAISE NOTICE 'SKIP cms_settings: zz_deleted sudah ada'; RETURN; END IF;
  SELECT COUNT(*) INTO v FROM public.cms_settings;
  IF v > 0 THEN RAISE NOTICE 'SKIP cms_settings: % rows — tidak direname', v; RETURN; END IF;
  ALTER TABLE public.cms_settings RENAME TO zz_deleted_cms_settings;
  RAISE NOTICE 'OK: cms_settings → zz_deleted_cms_settings';
END $$;

-- 14. company_settings
DO $$ DECLARE v BIGINT; BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_tables WHERE schemaname='public' AND tablename='company_settings') THEN RAISE NOTICE 'SKIP company_settings: tidak ditemukan'; RETURN; END IF;
  IF EXISTS (SELECT 1 FROM pg_tables WHERE schemaname='public' AND tablename='zz_deleted_company_settings') THEN RAISE NOTICE 'SKIP company_settings: zz_deleted sudah ada'; RETURN; END IF;
  SELECT COUNT(*) INTO v FROM public.company_settings;
  IF v > 0 THEN RAISE NOTICE 'SKIP company_settings: % rows — tidak direname', v; RETURN; END IF;
  ALTER TABLE public.company_settings RENAME TO zz_deleted_company_settings;
  RAISE NOTICE 'OK: company_settings → zz_deleted_company_settings';
END $$;

-- 15. customer_contexts
DO $$ DECLARE v BIGINT; BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_tables WHERE schemaname='public' AND tablename='customer_contexts') THEN RAISE NOTICE 'SKIP customer_contexts: tidak ditemukan'; RETURN; END IF;
  IF EXISTS (SELECT 1 FROM pg_tables WHERE schemaname='public' AND tablename='zz_deleted_customer_contexts') THEN RAISE NOTICE 'SKIP customer_contexts: zz_deleted sudah ada'; RETURN; END IF;
  SELECT COUNT(*) INTO v FROM public.customer_contexts;
  IF v > 0 THEN RAISE NOTICE 'SKIP customer_contexts: % rows — tidak direname', v; RETURN; END IF;
  ALTER TABLE public.customer_contexts RENAME TO zz_deleted_customer_contexts;
  RAISE NOTICE 'OK: customer_contexts → zz_deleted_customer_contexts';
END $$;

-- 16. data_template_fields
DO $$ DECLARE v BIGINT; BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_tables WHERE schemaname='public' AND tablename='data_template_fields') THEN RAISE NOTICE 'SKIP data_template_fields: tidak ditemukan'; RETURN; END IF;
  IF EXISTS (SELECT 1 FROM pg_tables WHERE schemaname='public' AND tablename='zz_deleted_data_template_fields') THEN RAISE NOTICE 'SKIP data_template_fields: zz_deleted sudah ada'; RETURN; END IF;
  SELECT COUNT(*) INTO v FROM public.data_template_fields;
  IF v > 0 THEN RAISE NOTICE 'SKIP data_template_fields: % rows — tidak direname', v; RETURN; END IF;
  ALTER TABLE public.data_template_fields RENAME TO zz_deleted_data_template_fields;
  RAISE NOTICE 'OK: data_template_fields → zz_deleted_data_template_fields';
END $$;

-- 17. data_templates
DO $$ DECLARE v BIGINT; BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_tables WHERE schemaname='public' AND tablename='data_templates') THEN RAISE NOTICE 'SKIP data_templates: tidak ditemukan'; RETURN; END IF;
  IF EXISTS (SELECT 1 FROM pg_tables WHERE schemaname='public' AND tablename='zz_deleted_data_templates') THEN RAISE NOTICE 'SKIP data_templates: zz_deleted sudah ada'; RETURN; END IF;
  SELECT COUNT(*) INTO v FROM public.data_templates;
  IF v > 0 THEN RAISE NOTICE 'SKIP data_templates: % rows — tidak direname', v; RETURN; END IF;
  ALTER TABLE public.data_templates RENAME TO zz_deleted_data_templates;
  RAISE NOTICE 'OK: data_templates → zz_deleted_data_templates';
END $$;

-- 18. dispatcher_logs
DO $$ DECLARE v BIGINT; BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_tables WHERE schemaname='public' AND tablename='dispatcher_logs') THEN RAISE NOTICE 'SKIP dispatcher_logs: tidak ditemukan'; RETURN; END IF;
  IF EXISTS (SELECT 1 FROM pg_tables WHERE schemaname='public' AND tablename='zz_deleted_dispatcher_logs') THEN RAISE NOTICE 'SKIP dispatcher_logs: zz_deleted sudah ada'; RETURN; END IF;
  SELECT COUNT(*) INTO v FROM public.dispatcher_logs;
  IF v > 0 THEN RAISE NOTICE 'SKIP dispatcher_logs: % rows — tidak direname', v; RETURN; END IF;
  ALTER TABLE public.dispatcher_logs RENAME TO zz_deleted_dispatcher_logs;
  RAISE NOTICE 'OK: dispatcher_logs → zz_deleted_dispatcher_logs';
END $$;

-- 19. document_audits
DO $$ DECLARE v BIGINT; BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_tables WHERE schemaname='public' AND tablename='document_audits') THEN RAISE NOTICE 'SKIP document_audits: tidak ditemukan'; RETURN; END IF;
  IF EXISTS (SELECT 1 FROM pg_tables WHERE schemaname='public' AND tablename='zz_deleted_document_audits') THEN RAISE NOTICE 'SKIP document_audits: zz_deleted sudah ada'; RETURN; END IF;
  SELECT COUNT(*) INTO v FROM public.document_audits;
  IF v > 0 THEN RAISE NOTICE 'SKIP document_audits: % rows — tidak direname', v; RETURN; END IF;
  ALTER TABLE public.document_audits RENAME TO zz_deleted_document_audits;
  RAISE NOTICE 'OK: document_audits → zz_deleted_document_audits';
END $$;

-- 20. document_template_fields
DO $$ DECLARE v BIGINT; BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_tables WHERE schemaname='public' AND tablename='document_template_fields') THEN RAISE NOTICE 'SKIP document_template_fields: tidak ditemukan'; RETURN; END IF;
  IF EXISTS (SELECT 1 FROM pg_tables WHERE schemaname='public' AND tablename='zz_deleted_document_template_fields') THEN RAISE NOTICE 'SKIP document_template_fields: zz_deleted sudah ada'; RETURN; END IF;
  SELECT COUNT(*) INTO v FROM public.document_template_fields;
  IF v > 0 THEN RAISE NOTICE 'SKIP document_template_fields: % rows — tidak direname', v; RETURN; END IF;
  ALTER TABLE public.document_template_fields RENAME TO zz_deleted_document_template_fields;
  RAISE NOTICE 'OK: document_template_fields → zz_deleted_document_template_fields';
END $$;

-- 21. document_templates
DO $$ DECLARE v BIGINT; BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_tables WHERE schemaname='public' AND tablename='document_templates') THEN RAISE NOTICE 'SKIP document_templates: tidak ditemukan'; RETURN; END IF;
  IF EXISTS (SELECT 1 FROM pg_tables WHERE schemaname='public' AND tablename='zz_deleted_document_templates') THEN RAISE NOTICE 'SKIP document_templates: zz_deleted sudah ada'; RETURN; END IF;
  SELECT COUNT(*) INTO v FROM public.document_templates;
  IF v > 0 THEN RAISE NOTICE 'SKIP document_templates: % rows — tidak direname', v; RETURN; END IF;
  ALTER TABLE public.document_templates RENAME TO zz_deleted_document_templates;
  RAISE NOTICE 'OK: document_templates → zz_deleted_document_templates';
END $$;

-- 22. draft_agreements_wa_log
DO $$ DECLARE v BIGINT; BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_tables WHERE schemaname='public' AND tablename='draft_agreements_wa_log') THEN RAISE NOTICE 'SKIP draft_agreements_wa_log: tidak ditemukan'; RETURN; END IF;
  IF EXISTS (SELECT 1 FROM pg_tables WHERE schemaname='public' AND tablename='zz_deleted_draft_agreements_wa_log') THEN RAISE NOTICE 'SKIP draft_agreements_wa_log: zz_deleted sudah ada'; RETURN; END IF;
  SELECT COUNT(*) INTO v FROM public.draft_agreements_wa_log;
  IF v > 0 THEN RAISE NOTICE 'SKIP draft_agreements_wa_log: % rows — tidak direname', v; RETURN; END IF;
  ALTER TABLE public.draft_agreements_wa_log RENAME TO zz_deleted_draft_agreements_wa_log;
  RAISE NOTICE 'OK: draft_agreements_wa_log → zz_deleted_draft_agreements_wa_log';
END $$;

-- 23. follow_up_logs
DO $$ DECLARE v BIGINT; BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_tables WHERE schemaname='public' AND tablename='follow_up_logs') THEN RAISE NOTICE 'SKIP follow_up_logs: tidak ditemukan'; RETURN; END IF;
  IF EXISTS (SELECT 1 FROM pg_tables WHERE schemaname='public' AND tablename='zz_deleted_follow_up_logs') THEN RAISE NOTICE 'SKIP follow_up_logs: zz_deleted sudah ada'; RETURN; END IF;
  SELECT COUNT(*) INTO v FROM public.follow_up_logs;
  IF v > 0 THEN RAISE NOTICE 'SKIP follow_up_logs: % rows — tidak direname', v; RETURN; END IF;
  ALTER TABLE public.follow_up_logs RENAME TO zz_deleted_follow_up_logs;
  RAISE NOTICE 'OK: follow_up_logs → zz_deleted_follow_up_logs';
END $$;

-- 24. gym_memberships
DO $$ DECLARE v BIGINT; BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_tables WHERE schemaname='public' AND tablename='gym_memberships') THEN RAISE NOTICE 'SKIP gym_memberships: tidak ditemukan'; RETURN; END IF;
  IF EXISTS (SELECT 1 FROM pg_tables WHERE schemaname='public' AND tablename='zz_deleted_gym_memberships') THEN RAISE NOTICE 'SKIP gym_memberships: zz_deleted sudah ada'; RETURN; END IF;
  SELECT COUNT(*) INTO v FROM public.gym_memberships;
  IF v > 0 THEN RAISE NOTICE 'SKIP gym_memberships: % rows — tidak direname', v; RETURN; END IF;
  ALTER TABLE public.gym_memberships RENAME TO zz_deleted_gym_memberships;
  RAISE NOTICE 'OK: gym_memberships → zz_deleted_gym_memberships';
END $$;

-- 25. intent_master
DO $$ DECLARE v BIGINT; BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_tables WHERE schemaname='public' AND tablename='intent_master') THEN RAISE NOTICE 'SKIP intent_master: tidak ditemukan'; RETURN; END IF;
  IF EXISTS (SELECT 1 FROM pg_tables WHERE schemaname='public' AND tablename='zz_deleted_intent_master') THEN RAISE NOTICE 'SKIP intent_master: zz_deleted sudah ada'; RETURN; END IF;
  SELECT COUNT(*) INTO v FROM public.intent_master;
  IF v > 0 THEN RAISE NOTICE 'SKIP intent_master: % rows — tidak direname', v; RETURN; END IF;
  ALTER TABLE public.intent_master RENAME TO zz_deleted_intent_master;
  RAISE NOTICE 'OK: intent_master → zz_deleted_intent_master';
END $$;

-- 26. keyword_rules
DO $$ DECLARE v BIGINT; BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_tables WHERE schemaname='public' AND tablename='keyword_rules') THEN RAISE NOTICE 'SKIP keyword_rules: tidak ditemukan'; RETURN; END IF;
  IF EXISTS (SELECT 1 FROM pg_tables WHERE schemaname='public' AND tablename='zz_deleted_keyword_rules') THEN RAISE NOTICE 'SKIP keyword_rules: zz_deleted sudah ada'; RETURN; END IF;
  SELECT COUNT(*) INTO v FROM public.keyword_rules;
  IF v > 0 THEN RAISE NOTICE 'SKIP keyword_rules: % rows — tidak direname', v; RETURN; END IF;
  ALTER TABLE public.keyword_rules RENAME TO zz_deleted_keyword_rules;
  RAISE NOTICE 'OK: keyword_rules → zz_deleted_keyword_rules';
END $$;

-- 27. leave_requests
DO $$ DECLARE v BIGINT; BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_tables WHERE schemaname='public' AND tablename='leave_requests') THEN RAISE NOTICE 'SKIP leave_requests: tidak ditemukan'; RETURN; END IF;
  IF EXISTS (SELECT 1 FROM pg_tables WHERE schemaname='public' AND tablename='zz_deleted_leave_requests') THEN RAISE NOTICE 'SKIP leave_requests: zz_deleted sudah ada'; RETURN; END IF;
  SELECT COUNT(*) INTO v FROM public.leave_requests;
  IF v > 0 THEN RAISE NOTICE 'SKIP leave_requests: % rows — tidak direname', v; RETURN; END IF;
  ALTER TABLE public.leave_requests RENAME TO zz_deleted_leave_requests;
  RAISE NOTICE 'OK: leave_requests → zz_deleted_leave_requests';
END $$;

-- 28. operational_checklists
DO $$ DECLARE v BIGINT; BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_tables WHERE schemaname='public' AND tablename='operational_checklists') THEN RAISE NOTICE 'SKIP operational_checklists: tidak ditemukan'; RETURN; END IF;
  IF EXISTS (SELECT 1 FROM pg_tables WHERE schemaname='public' AND tablename='zz_deleted_operational_checklists') THEN RAISE NOTICE 'SKIP operational_checklists: zz_deleted sudah ada'; RETURN; END IF;
  SELECT COUNT(*) INTO v FROM public.operational_checklists;
  IF v > 0 THEN RAISE NOTICE 'SKIP operational_checklists: % rows — tidak direname', v; RETURN; END IF;
  ALTER TABLE public.operational_checklists RENAME TO zz_deleted_operational_checklists;
  RAISE NOTICE 'OK: operational_checklists → zz_deleted_operational_checklists';
END $$;

-- 29. operational_expenses
DO $$ DECLARE v BIGINT; BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_tables WHERE schemaname='public' AND tablename='operational_expenses') THEN RAISE NOTICE 'SKIP operational_expenses: tidak ditemukan'; RETURN; END IF;
  IF EXISTS (SELECT 1 FROM pg_tables WHERE schemaname='public' AND tablename='zz_deleted_operational_expenses') THEN RAISE NOTICE 'SKIP operational_expenses: zz_deleted sudah ada'; RETURN; END IF;
  SELECT COUNT(*) INTO v FROM public.operational_expenses;
  IF v > 0 THEN RAISE NOTICE 'SKIP operational_expenses: % rows — tidak direname', v; RETURN; END IF;
  ALTER TABLE public.operational_expenses RENAME TO zz_deleted_operational_expenses;
  RAISE NOTICE 'OK: operational_expenses → zz_deleted_operational_expenses';
END $$;

-- 30. otp_tokens
DO $$ DECLARE v BIGINT; BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_tables WHERE schemaname='public' AND tablename='otp_tokens') THEN RAISE NOTICE 'SKIP otp_tokens: tidak ditemukan'; RETURN; END IF;
  IF EXISTS (SELECT 1 FROM pg_tables WHERE schemaname='public' AND tablename='zz_deleted_otp_tokens') THEN RAISE NOTICE 'SKIP otp_tokens: zz_deleted sudah ada'; RETURN; END IF;
  SELECT COUNT(*) INTO v FROM public.otp_tokens;
  IF v > 0 THEN RAISE NOTICE 'SKIP otp_tokens: % rows — tidak direname', v; RETURN; END IF;
  ALTER TABLE public.otp_tokens RENAME TO zz_deleted_otp_tokens;
  RAISE NOTICE 'OK: otp_tokens → zz_deleted_otp_tokens';
END $$;

-- 31. page_products
DO $$ DECLARE v BIGINT; BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_tables WHERE schemaname='public' AND tablename='page_products') THEN RAISE NOTICE 'SKIP page_products: tidak ditemukan'; RETURN; END IF;
  IF EXISTS (SELECT 1 FROM pg_tables WHERE schemaname='public' AND tablename='zz_deleted_page_products') THEN RAISE NOTICE 'SKIP page_products: zz_deleted sudah ada'; RETURN; END IF;
  SELECT COUNT(*) INTO v FROM public.page_products;
  IF v > 0 THEN RAISE NOTICE 'SKIP page_products: % rows — tidak direname', v; RETURN; END IF;
  ALTER TABLE public.page_products RENAME TO zz_deleted_page_products;
  RAISE NOTICE 'OK: page_products → zz_deleted_page_products';
END $$;

-- 32. promo_registrations
DO $$ DECLARE v BIGINT; BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_tables WHERE schemaname='public' AND tablename='promo_registrations') THEN RAISE NOTICE 'SKIP promo_registrations: tidak ditemukan'; RETURN; END IF;
  IF EXISTS (SELECT 1 FROM pg_tables WHERE schemaname='public' AND tablename='zz_deleted_promo_registrations') THEN RAISE NOTICE 'SKIP promo_registrations: zz_deleted sudah ada'; RETURN; END IF;
  SELECT COUNT(*) INTO v FROM public.promo_registrations;
  IF v > 0 THEN RAISE NOTICE 'SKIP promo_registrations: % rows — tidak direname', v; RETURN; END IF;
  ALTER TABLE public.promo_registrations RENAME TO zz_deleted_promo_registrations;
  RAISE NOTICE 'OK: promo_registrations → zz_deleted_promo_registrations';
END $$;

-- 33. public_tokens
DO $$ DECLARE v BIGINT; BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_tables WHERE schemaname='public' AND tablename='public_tokens') THEN RAISE NOTICE 'SKIP public_tokens: tidak ditemukan'; RETURN; END IF;
  IF EXISTS (SELECT 1 FROM pg_tables WHERE schemaname='public' AND tablename='zz_deleted_public_tokens') THEN RAISE NOTICE 'SKIP public_tokens: zz_deleted sudah ada'; RETURN; END IF;
  SELECT COUNT(*) INTO v FROM public.public_tokens;
  IF v > 0 THEN RAISE NOTICE 'SKIP public_tokens: % rows — tidak direname', v; RETURN; END IF;
  ALTER TABLE public.public_tokens RENAME TO zz_deleted_public_tokens;
  RAISE NOTICE 'OK: public_tokens → zz_deleted_public_tokens';
END $$;

-- 34. registration_link_wa_log
DO $$ DECLARE v BIGINT; BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_tables WHERE schemaname='public' AND tablename='registration_link_wa_log') THEN RAISE NOTICE 'SKIP registration_link_wa_log: tidak ditemukan'; RETURN; END IF;
  IF EXISTS (SELECT 1 FROM pg_tables WHERE schemaname='public' AND tablename='zz_deleted_registration_link_wa_log') THEN RAISE NOTICE 'SKIP registration_link_wa_log: zz_deleted sudah ada'; RETURN; END IF;
  SELECT COUNT(*) INTO v FROM public.registration_link_wa_log;
  IF v > 0 THEN RAISE NOTICE 'SKIP registration_link_wa_log: % rows — tidak direname', v; RETURN; END IF;
  ALTER TABLE public.registration_link_wa_log RENAME TO zz_deleted_registration_link_wa_log;
  RAISE NOTICE 'OK: registration_link_wa_log → zz_deleted_registration_link_wa_log';
END $$;

-- 35. sc_admin_notes  [LOW, rows:0]
DO $$ DECLARE v BIGINT; BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_tables WHERE schemaname='public' AND tablename='sc_admin_notes') THEN RAISE NOTICE 'SKIP sc_admin_notes: tidak ditemukan'; RETURN; END IF;
  IF EXISTS (SELECT 1 FROM pg_tables WHERE schemaname='public' AND tablename='zz_deleted_sc_admin_notes') THEN RAISE NOTICE 'SKIP sc_admin_notes: zz_deleted sudah ada'; RETURN; END IF;
  SELECT COUNT(*) INTO v FROM public.sc_admin_notes;
  IF v > 0 THEN RAISE NOTICE 'SKIP sc_admin_notes: % rows — tidak direname', v; RETURN; END IF;
  ALTER TABLE public.sc_admin_notes RENAME TO zz_deleted_sc_admin_notes;
  RAISE NOTICE 'OK: sc_admin_notes → zz_deleted_sc_admin_notes';
END $$;

-- 36. sc_blocked_schedules  [LOW, rows:0]
DO $$ DECLARE v BIGINT; BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_tables WHERE schemaname='public' AND tablename='sc_blocked_schedules') THEN RAISE NOTICE 'SKIP sc_blocked_schedules: tidak ditemukan'; RETURN; END IF;
  IF EXISTS (SELECT 1 FROM pg_tables WHERE schemaname='public' AND tablename='zz_deleted_sc_blocked_schedules') THEN RAISE NOTICE 'SKIP sc_blocked_schedules: zz_deleted sudah ada'; RETURN; END IF;
  SELECT COUNT(*) INTO v FROM public.sc_blocked_schedules;
  IF v > 0 THEN RAISE NOTICE 'SKIP sc_blocked_schedules: % rows — tidak direname', v; RETURN; END IF;
  ALTER TABLE public.sc_blocked_schedules RENAME TO zz_deleted_sc_blocked_schedules;
  RAISE NOTICE 'OK: sc_blocked_schedules → zz_deleted_sc_blocked_schedules';
END $$;

-- 37. sc_facility_images  [LOW, rows:0]
DO $$ DECLARE v BIGINT; BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_tables WHERE schemaname='public' AND tablename='sc_facility_images') THEN RAISE NOTICE 'SKIP sc_facility_images: tidak ditemukan'; RETURN; END IF;
  IF EXISTS (SELECT 1 FROM pg_tables WHERE schemaname='public' AND tablename='zz_deleted_sc_facility_images') THEN RAISE NOTICE 'SKIP sc_facility_images: zz_deleted sudah ada'; RETURN; END IF;
  SELECT COUNT(*) INTO v FROM public.sc_facility_images;
  IF v > 0 THEN RAISE NOTICE 'SKIP sc_facility_images: % rows — tidak direname', v; RETURN; END IF;
  ALTER TABLE public.sc_facility_images RENAME TO zz_deleted_sc_facility_images;
  RAISE NOTICE 'OK: sc_facility_images → zz_deleted_sc_facility_images';
END $$;

-- 38. sc_promos  [LOW, rows:0]
DO $$ DECLARE v BIGINT; BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_tables WHERE schemaname='public' AND tablename='sc_promos') THEN RAISE NOTICE 'SKIP sc_promos: tidak ditemukan'; RETURN; END IF;
  IF EXISTS (SELECT 1 FROM pg_tables WHERE schemaname='public' AND tablename='zz_deleted_sc_promos') THEN RAISE NOTICE 'SKIP sc_promos: zz_deleted sudah ada'; RETURN; END IF;
  SELECT COUNT(*) INTO v FROM public.sc_promos;
  IF v > 0 THEN RAISE NOTICE 'SKIP sc_promos: % rows — tidak direname', v; RETURN; END IF;
  ALTER TABLE public.sc_promos RENAME TO zz_deleted_sc_promos;
  RAISE NOTICE 'OK: sc_promos → zz_deleted_sc_promos';
END $$;

-- 39. sc_settings  [LOW, rows:0]
DO $$ DECLARE v BIGINT; BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_tables WHERE schemaname='public' AND tablename='sc_settings') THEN RAISE NOTICE 'SKIP sc_settings: tidak ditemukan'; RETURN; END IF;
  IF EXISTS (SELECT 1 FROM pg_tables WHERE schemaname='public' AND tablename='zz_deleted_sc_settings') THEN RAISE NOTICE 'SKIP sc_settings: zz_deleted sudah ada'; RETURN; END IF;
  SELECT COUNT(*) INTO v FROM public.sc_settings;
  IF v > 0 THEN RAISE NOTICE 'SKIP sc_settings: % rows — tidak direname', v; RETURN; END IF;
  ALTER TABLE public.sc_settings RENAME TO zz_deleted_sc_settings;
  RAISE NOTICE 'OK: sc_settings → zz_deleted_sc_settings';
END $$;

-- 40. service_catalog
DO $$ DECLARE v BIGINT; BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_tables WHERE schemaname='public' AND tablename='service_catalog') THEN RAISE NOTICE 'SKIP service_catalog: tidak ditemukan'; RETURN; END IF;
  IF EXISTS (SELECT 1 FROM pg_tables WHERE schemaname='public' AND tablename='zz_deleted_service_catalog') THEN RAISE NOTICE 'SKIP service_catalog: zz_deleted sudah ada'; RETURN; END IF;
  SELECT COUNT(*) INTO v FROM public.service_catalog;
  IF v > 0 THEN RAISE NOTICE 'SKIP service_catalog: % rows — tidak direname', v; RETURN; END IF;
  ALTER TABLE public.service_catalog RENAME TO zz_deleted_service_catalog;
  RAISE NOTICE 'OK: service_catalog → zz_deleted_service_catalog';
END $$;

-- 41. service_circuit_states
DO $$ DECLARE v BIGINT; BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_tables WHERE schemaname='public' AND tablename='service_circuit_states') THEN RAISE NOTICE 'SKIP service_circuit_states: tidak ditemukan'; RETURN; END IF;
  IF EXISTS (SELECT 1 FROM pg_tables WHERE schemaname='public' AND tablename='zz_deleted_service_circuit_states') THEN RAISE NOTICE 'SKIP service_circuit_states: zz_deleted sudah ada'; RETURN; END IF;
  SELECT COUNT(*) INTO v FROM public.service_circuit_states;
  IF v > 0 THEN RAISE NOTICE 'SKIP service_circuit_states: % rows — tidak direname', v; RETURN; END IF;
  ALTER TABLE public.service_circuit_states RENAME TO zz_deleted_service_circuit_states;
  RAISE NOTICE 'OK: service_circuit_states → zz_deleted_service_circuit_states';
END $$;

-- 42. service_registry
DO $$ DECLARE v BIGINT; BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_tables WHERE schemaname='public' AND tablename='service_registry') THEN RAISE NOTICE 'SKIP service_registry: tidak ditemukan'; RETURN; END IF;
  IF EXISTS (SELECT 1 FROM pg_tables WHERE schemaname='public' AND tablename='zz_deleted_service_registry') THEN RAISE NOTICE 'SKIP service_registry: zz_deleted sudah ada'; RETURN; END IF;
  SELECT COUNT(*) INTO v FROM public.service_registry;
  IF v > 0 THEN RAISE NOTICE 'SKIP service_registry: % rows — tidak direname', v; RETURN; END IF;
  ALTER TABLE public.service_registry RENAME TO zz_deleted_service_registry;
  RAISE NOTICE 'OK: service_registry → zz_deleted_service_registry';
END $$;

-- 43. shipment_events
DO $$ DECLARE v BIGINT; BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_tables WHERE schemaname='public' AND tablename='shipment_events') THEN RAISE NOTICE 'SKIP shipment_events: tidak ditemukan'; RETURN; END IF;
  IF EXISTS (SELECT 1 FROM pg_tables WHERE schemaname='public' AND tablename='zz_deleted_shipment_events') THEN RAISE NOTICE 'SKIP shipment_events: zz_deleted sudah ada'; RETURN; END IF;
  SELECT COUNT(*) INTO v FROM public.shipment_events;
  IF v > 0 THEN RAISE NOTICE 'SKIP shipment_events: % rows — tidak direname', v; RETURN; END IF;
  ALTER TABLE public.shipment_events RENAME TO zz_deleted_shipment_events;
  RAISE NOTICE 'OK: shipment_events → zz_deleted_shipment_events';
END $$;

-- 44. shipment_trackings
DO $$ DECLARE v BIGINT; BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_tables WHERE schemaname='public' AND tablename='shipment_trackings') THEN RAISE NOTICE 'SKIP shipment_trackings: tidak ditemukan'; RETURN; END IF;
  IF EXISTS (SELECT 1 FROM pg_tables WHERE schemaname='public' AND tablename='zz_deleted_shipment_trackings') THEN RAISE NOTICE 'SKIP shipment_trackings: zz_deleted sudah ada'; RETURN; END IF;
  SELECT COUNT(*) INTO v FROM public.shipment_trackings;
  IF v > 0 THEN RAISE NOTICE 'SKIP shipment_trackings: % rows — tidak direname', v; RETURN; END IF;
  ALTER TABLE public.shipment_trackings RENAME TO zz_deleted_shipment_trackings;
  RAISE NOTICE 'OK: shipment_trackings → zz_deleted_shipment_trackings';
END $$;

-- 45. sport_center_expenses  [LOW, rows:0]
-- NOTE: shipments DIKECUALIKAN — shipmentsTable dipakai aktif di logistics.ts (GET /api/logistics/shipments)
DO $$ DECLARE v BIGINT; BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_tables WHERE schemaname='public' AND tablename='sport_center_expenses') THEN RAISE NOTICE 'SKIP sport_center_expenses: tidak ditemukan'; RETURN; END IF;
  IF EXISTS (SELECT 1 FROM pg_tables WHERE schemaname='public' AND tablename='zz_deleted_sport_center_expenses') THEN RAISE NOTICE 'SKIP sport_center_expenses: zz_deleted sudah ada'; RETURN; END IF;
  SELECT COUNT(*) INTO v FROM public.sport_center_expenses;
  IF v > 0 THEN RAISE NOTICE 'SKIP sport_center_expenses: % rows — tidak direname', v; RETURN; END IF;
  ALTER TABLE public.sport_center_expenses RENAME TO zz_deleted_sport_center_expenses;
  RAISE NOTICE 'OK: sport_center_expenses → zz_deleted_sport_center_expenses';
END $$;

-- 47. task_assignments
DO $$ DECLARE v BIGINT; BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_tables WHERE schemaname='public' AND tablename='task_assignments') THEN RAISE NOTICE 'SKIP task_assignments: tidak ditemukan'; RETURN; END IF;
  IF EXISTS (SELECT 1 FROM pg_tables WHERE schemaname='public' AND tablename='zz_deleted_task_assignments') THEN RAISE NOTICE 'SKIP task_assignments: zz_deleted sudah ada'; RETURN; END IF;
  SELECT COUNT(*) INTO v FROM public.task_assignments;
  IF v > 0 THEN RAISE NOTICE 'SKIP task_assignments: % rows — tidak direname', v; RETURN; END IF;
  ALTER TABLE public.task_assignments RENAME TO zz_deleted_task_assignments;
  RAISE NOTICE 'OK: task_assignments → zz_deleted_task_assignments';
END $$;

-- 48. task_attachments
DO $$ DECLARE v BIGINT; BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_tables WHERE schemaname='public' AND tablename='task_attachments') THEN RAISE NOTICE 'SKIP task_attachments: tidak ditemukan'; RETURN; END IF;
  IF EXISTS (SELECT 1 FROM pg_tables WHERE schemaname='public' AND tablename='zz_deleted_task_attachments') THEN RAISE NOTICE 'SKIP task_attachments: zz_deleted sudah ada'; RETURN; END IF;
  SELECT COUNT(*) INTO v FROM public.task_attachments;
  IF v > 0 THEN RAISE NOTICE 'SKIP task_attachments: % rows — tidak direname', v; RETURN; END IF;
  ALTER TABLE public.task_attachments RENAME TO zz_deleted_task_attachments;
  RAISE NOTICE 'OK: task_attachments → zz_deleted_task_attachments';
END $$;

-- 49. task_comments
DO $$ DECLARE v BIGINT; BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_tables WHERE schemaname='public' AND tablename='task_comments') THEN RAISE NOTICE 'SKIP task_comments: tidak ditemukan'; RETURN; END IF;
  IF EXISTS (SELECT 1 FROM pg_tables WHERE schemaname='public' AND tablename='zz_deleted_task_comments') THEN RAISE NOTICE 'SKIP task_comments: zz_deleted sudah ada'; RETURN; END IF;
  SELECT COUNT(*) INTO v FROM public.task_comments;
  IF v > 0 THEN RAISE NOTICE 'SKIP task_comments: % rows — tidak direname', v; RETURN; END IF;
  ALTER TABLE public.task_comments RENAME TO zz_deleted_task_comments;
  RAISE NOTICE 'OK: task_comments → zz_deleted_task_comments';
END $$;

-- 50. task_timeline
DO $$ DECLARE v BIGINT; BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_tables WHERE schemaname='public' AND tablename='task_timeline') THEN RAISE NOTICE 'SKIP task_timeline: tidak ditemukan'; RETURN; END IF;
  IF EXISTS (SELECT 1 FROM pg_tables WHERE schemaname='public' AND tablename='zz_deleted_task_timeline') THEN RAISE NOTICE 'SKIP task_timeline: zz_deleted sudah ada'; RETURN; END IF;
  SELECT COUNT(*) INTO v FROM public.task_timeline;
  IF v > 0 THEN RAISE NOTICE 'SKIP task_timeline: % rows — tidak direname', v; RETURN; END IF;
  ALTER TABLE public.task_timeline RENAME TO zz_deleted_task_timeline;
  RAISE NOTICE 'OK: task_timeline → zz_deleted_task_timeline';
END $$;

-- 51. team_members
DO $$ DECLARE v BIGINT; BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_tables WHERE schemaname='public' AND tablename='team_members') THEN RAISE NOTICE 'SKIP team_members: tidak ditemukan'; RETURN; END IF;
  IF EXISTS (SELECT 1 FROM pg_tables WHERE schemaname='public' AND tablename='zz_deleted_team_members') THEN RAISE NOTICE 'SKIP team_members: zz_deleted sudah ada'; RETURN; END IF;
  SELECT COUNT(*) INTO v FROM public.team_members;
  IF v > 0 THEN RAISE NOTICE 'SKIP team_members: % rows — tidak direname', v; RETURN; END IF;
  ALTER TABLE public.team_members RENAME TO zz_deleted_team_members;
  RAISE NOTICE 'OK: team_members → zz_deleted_team_members';
END $$;

-- 52. user_site_access
DO $$ DECLARE v BIGINT; BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_tables WHERE schemaname='public' AND tablename='user_site_access') THEN RAISE NOTICE 'SKIP user_site_access: tidak ditemukan'; RETURN; END IF;
  IF EXISTS (SELECT 1 FROM pg_tables WHERE schemaname='public' AND tablename='zz_deleted_user_site_access') THEN RAISE NOTICE 'SKIP user_site_access: zz_deleted sudah ada'; RETURN; END IF;
  SELECT COUNT(*) INTO v FROM public.user_site_access;
  IF v > 0 THEN RAISE NOTICE 'SKIP user_site_access: % rows — tidak direname', v; RETURN; END IF;
  ALTER TABLE public.user_site_access RENAME TO zz_deleted_user_site_access;
  RAISE NOTICE 'OK: user_site_access → zz_deleted_user_site_access';
END $$;

-- 53. whatsapp_messages
DO $$ DECLARE v BIGINT; BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_tables WHERE schemaname='public' AND tablename='whatsapp_messages') THEN RAISE NOTICE 'SKIP whatsapp_messages: tidak ditemukan'; RETURN; END IF;
  IF EXISTS (SELECT 1 FROM pg_tables WHERE schemaname='public' AND tablename='zz_deleted_whatsapp_messages') THEN RAISE NOTICE 'SKIP whatsapp_messages: zz_deleted sudah ada'; RETURN; END IF;
  SELECT COUNT(*) INTO v FROM public.whatsapp_messages;
  IF v > 0 THEN RAISE NOTICE 'SKIP whatsapp_messages: % rows — tidak direname', v; RETURN; END IF;
  ALTER TABLE public.whatsapp_messages RENAME TO zz_deleted_whatsapp_messages;
  RAISE NOTICE 'OK: whatsapp_messages → zz_deleted_whatsapp_messages';
END $$;

-- 54. whatsapp_notifications
DO $$ DECLARE v BIGINT; BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_tables WHERE schemaname='public' AND tablename='whatsapp_notifications') THEN RAISE NOTICE 'SKIP whatsapp_notifications: tidak ditemukan'; RETURN; END IF;
  IF EXISTS (SELECT 1 FROM pg_tables WHERE schemaname='public' AND tablename='zz_deleted_whatsapp_notifications') THEN RAISE NOTICE 'SKIP whatsapp_notifications: zz_deleted sudah ada'; RETURN; END IF;
  SELECT COUNT(*) INTO v FROM public.whatsapp_notifications;
  IF v > 0 THEN RAISE NOTICE 'SKIP whatsapp_notifications: % rows — tidak direname', v; RETURN; END IF;
  ALTER TABLE public.whatsapp_notifications RENAME TO zz_deleted_whatsapp_notifications;
  RAISE NOTICE 'OK: whatsapp_notifications → zz_deleted_whatsapp_notifications';
END $$;

-- NOTE: fleet_outstanding_import_log DIKECUALIKAN (KEEP) — inline migration v14 di fleetIntelligence.ts
--       + active DML (INSERT L3117, SELECT L3144). Direname → inline migration buat tabel baru kosong.

-- ── TABEL DIKECUALIKAN (berisi data — backup dulu via scripts/backup-low-risk-tables.mjs) ─
-- employees              rows:15  EXCLUDED
-- employee_kasbon        rows:1   EXCLUDED
-- order_asuransi         rows:19  EXCLUDED
-- payment_receipts       rows:11  EXCLUDED
-- finance_payment_events rows:11  EXCLUDED
-- wa_send_logs           rows:12  EXCLUDED
-- system_settings        rows:1   EXCLUDED

-- ── TABEL BLOCKED (masih ada referensi aktif) ───────────────────────────────
-- sc_payments                     BLOCKED
-- sport_center_memberships        BLOCKED
-- transaction_datetime_normalized BLOCKED
-- workflow_events                 BLOCKED
-- sport_center_bookings           BLOCKED
-- sport_center_facilities         BLOCKED
-- shipment_stages                 BLOCKED

-- ── TABEL KEEP (FK aktif / inline migration) ─────────────────────────────────
-- fleet_partners                KEEP
-- fleet_vehicles                KEEP
-- fleet_ledger_entries          KEEP
-- fleet_reports                 KEEP
-- fleet_drivers                 KEEP
-- fleet_outstanding_import_log  KEEP — inline migration v14 + DML aktif (fleetIntelligence.ts L388,3117,3144)

-- ── TABEL HIGH RISK (route + Drizzle schema aktif) ───────────────────────────
-- shipments                     HIGH — shipmentsTable di logistics.ts:59-60, GET /api/logistics/shipments
--                                       Hapus route/schema dulu sebelum archive

-- ============================================================================
-- SETELAH RENAME: monitor aplikasi 7 hari
-- Jika normal → lanjut ke archive-phase-2.sql (DROP zz_deleted_*)
-- Jika ada error → jalankan archive-phase-1-safe-only-rollback.sql
-- ============================================================================
