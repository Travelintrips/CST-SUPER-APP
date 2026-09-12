-- ============================================================================
-- archive-phase-1-safe-only-rollback.sql
-- Dibuat  : 2026-06-22
-- Diupdate: 2026-06-23 v2 (hapus fleet_outstanding_import_log → KEEP, hapus shipments → HIGH risk)
-- Tujuan  : Rollback dari archive-phase-1-safe-only.sql
--           RENAME zz_deleted_* → nama asli
-- Total   : 53 tabel (47 SAFE + 6 LOW)
--
-- PERINTAH EKSEKUSI:
--   psql "$SUPABASE_DATABASE_URL" -f migrations/archive-phase-1-safe-only-rollback.sql
-- ============================================================================

-- Setiap rollback hanya dieksekusi jika zz_deleted_* ADA dan versi asli BELUM ada

DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_tables WHERE schemaname='public' AND tablename='zz_deleted_ai_tasks')
     AND NOT EXISTS (SELECT 1 FROM pg_tables WHERE schemaname='public' AND tablename='ai_tasks')
  THEN ALTER TABLE public.zz_deleted_ai_tasks RENAME TO ai_tasks; RAISE NOTICE 'ROLLBACK: ai_tasks restored'; END IF;
END $$;

DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_tables WHERE schemaname='public' AND tablename='zz_deleted_attendance_records')
     AND NOT EXISTS (SELECT 1 FROM pg_tables WHERE schemaname='public' AND tablename='attendance_records')
  THEN ALTER TABLE public.zz_deleted_attendance_records RENAME TO attendance_records; RAISE NOTICE 'ROLLBACK: attendance_records restored'; END IF;
END $$;

DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_tables WHERE schemaname='public' AND tablename='zz_deleted_bank_account_balances')
     AND NOT EXISTS (SELECT 1 FROM pg_tables WHERE schemaname='public' AND tablename='bank_account_balances')
  THEN ALTER TABLE public.zz_deleted_bank_account_balances RENAME TO bank_account_balances; RAISE NOTICE 'ROLLBACK: bank_account_balances restored'; END IF;
END $$;

DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_tables WHERE schemaname='public' AND tablename='zz_deleted_bank_closing_periods')
     AND NOT EXISTS (SELECT 1 FROM pg_tables WHERE schemaname='public' AND tablename='bank_closing_periods')
  THEN ALTER TABLE public.zz_deleted_bank_closing_periods RENAME TO bank_closing_periods; RAISE NOTICE 'ROLLBACK: bank_closing_periods restored'; END IF;
END $$;

DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_tables WHERE schemaname='public' AND tablename='zz_deleted_bank_coa_rules')
     AND NOT EXISTS (SELECT 1 FROM pg_tables WHERE schemaname='public' AND tablename='bank_coa_rules')
  THEN ALTER TABLE public.zz_deleted_bank_coa_rules RENAME TO bank_coa_rules; RAISE NOTICE 'ROLLBACK: bank_coa_rules restored'; END IF;
END $$;

DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_tables WHERE schemaname='public' AND tablename='zz_deleted_bank_recon_audit_logs')
     AND NOT EXISTS (SELECT 1 FROM pg_tables WHERE schemaname='public' AND tablename='bank_recon_audit_logs')
  THEN ALTER TABLE public.zz_deleted_bank_recon_audit_logs RENAME TO bank_recon_audit_logs; RAISE NOTICE 'ROLLBACK: bank_recon_audit_logs restored'; END IF;
END $$;

DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_tables WHERE schemaname='public' AND tablename='zz_deleted_banners')
     AND NOT EXISTS (SELECT 1 FROM pg_tables WHERE schemaname='public' AND tablename='banners')
  THEN ALTER TABLE public.zz_deleted_banners RENAME TO banners; RAISE NOTICE 'ROLLBACK: banners restored'; END IF;
END $$;

DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_tables WHERE schemaname='public' AND tablename='zz_deleted_blast_session_logs')
     AND NOT EXISTS (SELECT 1 FROM pg_tables WHERE schemaname='public' AND tablename='blast_session_logs')
  THEN ALTER TABLE public.zz_deleted_blast_session_logs RENAME TO blast_session_logs; RAISE NOTICE 'ROLLBACK: blast_session_logs restored'; END IF;
END $$;

DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_tables WHERE schemaname='public' AND tablename='zz_deleted_cashier_shifts')
     AND NOT EXISTS (SELECT 1 FROM pg_tables WHERE schemaname='public' AND tablename='cashier_shifts')
  THEN ALTER TABLE public.zz_deleted_cashier_shifts RENAME TO cashier_shifts; RAISE NOTICE 'ROLLBACK: cashier_shifts restored'; END IF;
END $$;

DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_tables WHERE schemaname='public' AND tablename='zz_deleted_cms_blocks')
     AND NOT EXISTS (SELECT 1 FROM pg_tables WHERE schemaname='public' AND tablename='cms_blocks')
  THEN ALTER TABLE public.zz_deleted_cms_blocks RENAME TO cms_blocks; RAISE NOTICE 'ROLLBACK: cms_blocks restored'; END IF;
END $$;

DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_tables WHERE schemaname='public' AND tablename='zz_deleted_cms_media')
     AND NOT EXISTS (SELECT 1 FROM pg_tables WHERE schemaname='public' AND tablename='cms_media')
  THEN ALTER TABLE public.zz_deleted_cms_media RENAME TO cms_media; RAISE NOTICE 'ROLLBACK: cms_media restored'; END IF;
END $$;

DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_tables WHERE schemaname='public' AND tablename='zz_deleted_cms_pages')
     AND NOT EXISTS (SELECT 1 FROM pg_tables WHERE schemaname='public' AND tablename='cms_pages')
  THEN ALTER TABLE public.zz_deleted_cms_pages RENAME TO cms_pages; RAISE NOTICE 'ROLLBACK: cms_pages restored'; END IF;
END $$;

DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_tables WHERE schemaname='public' AND tablename='zz_deleted_cms_settings')
     AND NOT EXISTS (SELECT 1 FROM pg_tables WHERE schemaname='public' AND tablename='cms_settings')
  THEN ALTER TABLE public.zz_deleted_cms_settings RENAME TO cms_settings; RAISE NOTICE 'ROLLBACK: cms_settings restored'; END IF;
END $$;

DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_tables WHERE schemaname='public' AND tablename='zz_deleted_company_settings')
     AND NOT EXISTS (SELECT 1 FROM pg_tables WHERE schemaname='public' AND tablename='company_settings')
  THEN ALTER TABLE public.zz_deleted_company_settings RENAME TO company_settings; RAISE NOTICE 'ROLLBACK: company_settings restored'; END IF;
END $$;

DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_tables WHERE schemaname='public' AND tablename='zz_deleted_customer_contexts')
     AND NOT EXISTS (SELECT 1 FROM pg_tables WHERE schemaname='public' AND tablename='customer_contexts')
  THEN ALTER TABLE public.zz_deleted_customer_contexts RENAME TO customer_contexts; RAISE NOTICE 'ROLLBACK: customer_contexts restored'; END IF;
END $$;

DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_tables WHERE schemaname='public' AND tablename='zz_deleted_data_template_fields')
     AND NOT EXISTS (SELECT 1 FROM pg_tables WHERE schemaname='public' AND tablename='data_template_fields')
  THEN ALTER TABLE public.zz_deleted_data_template_fields RENAME TO data_template_fields; RAISE NOTICE 'ROLLBACK: data_template_fields restored'; END IF;
END $$;

DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_tables WHERE schemaname='public' AND tablename='zz_deleted_data_templates')
     AND NOT EXISTS (SELECT 1 FROM pg_tables WHERE schemaname='public' AND tablename='data_templates')
  THEN ALTER TABLE public.zz_deleted_data_templates RENAME TO data_templates; RAISE NOTICE 'ROLLBACK: data_templates restored'; END IF;
END $$;

DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_tables WHERE schemaname='public' AND tablename='zz_deleted_dispatcher_logs')
     AND NOT EXISTS (SELECT 1 FROM pg_tables WHERE schemaname='public' AND tablename='dispatcher_logs')
  THEN ALTER TABLE public.zz_deleted_dispatcher_logs RENAME TO dispatcher_logs; RAISE NOTICE 'ROLLBACK: dispatcher_logs restored'; END IF;
END $$;

DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_tables WHERE schemaname='public' AND tablename='zz_deleted_document_audits')
     AND NOT EXISTS (SELECT 1 FROM pg_tables WHERE schemaname='public' AND tablename='document_audits')
  THEN ALTER TABLE public.zz_deleted_document_audits RENAME TO document_audits; RAISE NOTICE 'ROLLBACK: document_audits restored'; END IF;
END $$;

DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_tables WHERE schemaname='public' AND tablename='zz_deleted_document_template_fields')
     AND NOT EXISTS (SELECT 1 FROM pg_tables WHERE schemaname='public' AND tablename='document_template_fields')
  THEN ALTER TABLE public.zz_deleted_document_template_fields RENAME TO document_template_fields; RAISE NOTICE 'ROLLBACK: document_template_fields restored'; END IF;
END $$;

DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_tables WHERE schemaname='public' AND tablename='zz_deleted_document_templates')
     AND NOT EXISTS (SELECT 1 FROM pg_tables WHERE schemaname='public' AND tablename='document_templates')
  THEN ALTER TABLE public.zz_deleted_document_templates RENAME TO document_templates; RAISE NOTICE 'ROLLBACK: document_templates restored'; END IF;
END $$;

DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_tables WHERE schemaname='public' AND tablename='zz_deleted_draft_agreements_wa_log')
     AND NOT EXISTS (SELECT 1 FROM pg_tables WHERE schemaname='public' AND tablename='draft_agreements_wa_log')
  THEN ALTER TABLE public.zz_deleted_draft_agreements_wa_log RENAME TO draft_agreements_wa_log; RAISE NOTICE 'ROLLBACK: draft_agreements_wa_log restored'; END IF;
END $$;

DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_tables WHERE schemaname='public' AND tablename='zz_deleted_follow_up_logs')
     AND NOT EXISTS (SELECT 1 FROM pg_tables WHERE schemaname='public' AND tablename='follow_up_logs')
  THEN ALTER TABLE public.zz_deleted_follow_up_logs RENAME TO follow_up_logs; RAISE NOTICE 'ROLLBACK: follow_up_logs restored'; END IF;
END $$;

DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_tables WHERE schemaname='public' AND tablename='zz_deleted_gym_memberships')
     AND NOT EXISTS (SELECT 1 FROM pg_tables WHERE schemaname='public' AND tablename='gym_memberships')
  THEN ALTER TABLE public.zz_deleted_gym_memberships RENAME TO gym_memberships; RAISE NOTICE 'ROLLBACK: gym_memberships restored'; END IF;
END $$;

DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_tables WHERE schemaname='public' AND tablename='zz_deleted_intent_master')
     AND NOT EXISTS (SELECT 1 FROM pg_tables WHERE schemaname='public' AND tablename='intent_master')
  THEN ALTER TABLE public.zz_deleted_intent_master RENAME TO intent_master; RAISE NOTICE 'ROLLBACK: intent_master restored'; END IF;
END $$;

DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_tables WHERE schemaname='public' AND tablename='zz_deleted_keyword_rules')
     AND NOT EXISTS (SELECT 1 FROM pg_tables WHERE schemaname='public' AND tablename='keyword_rules')
  THEN ALTER TABLE public.zz_deleted_keyword_rules RENAME TO keyword_rules; RAISE NOTICE 'ROLLBACK: keyword_rules restored'; END IF;
END $$;

DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_tables WHERE schemaname='public' AND tablename='zz_deleted_leave_requests')
     AND NOT EXISTS (SELECT 1 FROM pg_tables WHERE schemaname='public' AND tablename='leave_requests')
  THEN ALTER TABLE public.zz_deleted_leave_requests RENAME TO leave_requests; RAISE NOTICE 'ROLLBACK: leave_requests restored'; END IF;
END $$;

DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_tables WHERE schemaname='public' AND tablename='zz_deleted_operational_checklists')
     AND NOT EXISTS (SELECT 1 FROM pg_tables WHERE schemaname='public' AND tablename='operational_checklists')
  THEN ALTER TABLE public.zz_deleted_operational_checklists RENAME TO operational_checklists; RAISE NOTICE 'ROLLBACK: operational_checklists restored'; END IF;
END $$;

DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_tables WHERE schemaname='public' AND tablename='zz_deleted_operational_expenses')
     AND NOT EXISTS (SELECT 1 FROM pg_tables WHERE schemaname='public' AND tablename='operational_expenses')
  THEN ALTER TABLE public.zz_deleted_operational_expenses RENAME TO operational_expenses; RAISE NOTICE 'ROLLBACK: operational_expenses restored'; END IF;
END $$;

DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_tables WHERE schemaname='public' AND tablename='zz_deleted_otp_tokens')
     AND NOT EXISTS (SELECT 1 FROM pg_tables WHERE schemaname='public' AND tablename='otp_tokens')
  THEN ALTER TABLE public.zz_deleted_otp_tokens RENAME TO otp_tokens; RAISE NOTICE 'ROLLBACK: otp_tokens restored'; END IF;
END $$;

DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_tables WHERE schemaname='public' AND tablename='zz_deleted_page_products')
     AND NOT EXISTS (SELECT 1 FROM pg_tables WHERE schemaname='public' AND tablename='page_products')
  THEN ALTER TABLE public.zz_deleted_page_products RENAME TO page_products; RAISE NOTICE 'ROLLBACK: page_products restored'; END IF;
END $$;

DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_tables WHERE schemaname='public' AND tablename='zz_deleted_promo_registrations')
     AND NOT EXISTS (SELECT 1 FROM pg_tables WHERE schemaname='public' AND tablename='promo_registrations')
  THEN ALTER TABLE public.zz_deleted_promo_registrations RENAME TO promo_registrations; RAISE NOTICE 'ROLLBACK: promo_registrations restored'; END IF;
END $$;

DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_tables WHERE schemaname='public' AND tablename='zz_deleted_public_tokens')
     AND NOT EXISTS (SELECT 1 FROM pg_tables WHERE schemaname='public' AND tablename='public_tokens')
  THEN ALTER TABLE public.zz_deleted_public_tokens RENAME TO public_tokens; RAISE NOTICE 'ROLLBACK: public_tokens restored'; END IF;
END $$;

DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_tables WHERE schemaname='public' AND tablename='zz_deleted_registration_link_wa_log')
     AND NOT EXISTS (SELECT 1 FROM pg_tables WHERE schemaname='public' AND tablename='registration_link_wa_log')
  THEN ALTER TABLE public.zz_deleted_registration_link_wa_log RENAME TO registration_link_wa_log; RAISE NOTICE 'ROLLBACK: registration_link_wa_log restored'; END IF;
END $$;

DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_tables WHERE schemaname='public' AND tablename='zz_deleted_sc_admin_notes')
     AND NOT EXISTS (SELECT 1 FROM pg_tables WHERE schemaname='public' AND tablename='sc_admin_notes')
  THEN ALTER TABLE public.zz_deleted_sc_admin_notes RENAME TO sc_admin_notes; RAISE NOTICE 'ROLLBACK: sc_admin_notes restored'; END IF;
END $$;

DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_tables WHERE schemaname='public' AND tablename='zz_deleted_sc_blocked_schedules')
     AND NOT EXISTS (SELECT 1 FROM pg_tables WHERE schemaname='public' AND tablename='sc_blocked_schedules')
  THEN ALTER TABLE public.zz_deleted_sc_blocked_schedules RENAME TO sc_blocked_schedules; RAISE NOTICE 'ROLLBACK: sc_blocked_schedules restored'; END IF;
END $$;

DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_tables WHERE schemaname='public' AND tablename='zz_deleted_sc_facility_images')
     AND NOT EXISTS (SELECT 1 FROM pg_tables WHERE schemaname='public' AND tablename='sc_facility_images')
  THEN ALTER TABLE public.zz_deleted_sc_facility_images RENAME TO sc_facility_images; RAISE NOTICE 'ROLLBACK: sc_facility_images restored'; END IF;
END $$;

DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_tables WHERE schemaname='public' AND tablename='zz_deleted_sc_promos')
     AND NOT EXISTS (SELECT 1 FROM pg_tables WHERE schemaname='public' AND tablename='sc_promos')
  THEN ALTER TABLE public.zz_deleted_sc_promos RENAME TO sc_promos; RAISE NOTICE 'ROLLBACK: sc_promos restored'; END IF;
END $$;

DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_tables WHERE schemaname='public' AND tablename='zz_deleted_sc_settings')
     AND NOT EXISTS (SELECT 1 FROM pg_tables WHERE schemaname='public' AND tablename='sc_settings')
  THEN ALTER TABLE public.zz_deleted_sc_settings RENAME TO sc_settings; RAISE NOTICE 'ROLLBACK: sc_settings restored'; END IF;
END $$;

DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_tables WHERE schemaname='public' AND tablename='zz_deleted_service_catalog')
     AND NOT EXISTS (SELECT 1 FROM pg_tables WHERE schemaname='public' AND tablename='service_catalog')
  THEN ALTER TABLE public.zz_deleted_service_catalog RENAME TO service_catalog; RAISE NOTICE 'ROLLBACK: service_catalog restored'; END IF;
END $$;

DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_tables WHERE schemaname='public' AND tablename='zz_deleted_service_circuit_states')
     AND NOT EXISTS (SELECT 1 FROM pg_tables WHERE schemaname='public' AND tablename='service_circuit_states')
  THEN ALTER TABLE public.zz_deleted_service_circuit_states RENAME TO service_circuit_states; RAISE NOTICE 'ROLLBACK: service_circuit_states restored'; END IF;
END $$;

DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_tables WHERE schemaname='public' AND tablename='zz_deleted_service_registry')
     AND NOT EXISTS (SELECT 1 FROM pg_tables WHERE schemaname='public' AND tablename='service_registry')
  THEN ALTER TABLE public.zz_deleted_service_registry RENAME TO service_registry; RAISE NOTICE 'ROLLBACK: service_registry restored'; END IF;
END $$;

DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_tables WHERE schemaname='public' AND tablename='zz_deleted_shipment_events')
     AND NOT EXISTS (SELECT 1 FROM pg_tables WHERE schemaname='public' AND tablename='shipment_events')
  THEN ALTER TABLE public.zz_deleted_shipment_events RENAME TO shipment_events; RAISE NOTICE 'ROLLBACK: shipment_events restored'; END IF;
END $$;

DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_tables WHERE schemaname='public' AND tablename='zz_deleted_shipment_trackings')
     AND NOT EXISTS (SELECT 1 FROM pg_tables WHERE schemaname='public' AND tablename='shipment_trackings')
  THEN ALTER TABLE public.zz_deleted_shipment_trackings RENAME TO shipment_trackings; RAISE NOTICE 'ROLLBACK: shipment_trackings restored'; END IF;
END $$;

-- NOTE: shipments dikecualikan dari migration (HIGH risk) — tidak perlu rollback entry

DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_tables WHERE schemaname='public' AND tablename='zz_deleted_sport_center_expenses')
     AND NOT EXISTS (SELECT 1 FROM pg_tables WHERE schemaname='public' AND tablename='sport_center_expenses')
  THEN ALTER TABLE public.zz_deleted_sport_center_expenses RENAME TO sport_center_expenses; RAISE NOTICE 'ROLLBACK: sport_center_expenses restored'; END IF;
END $$;

DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_tables WHERE schemaname='public' AND tablename='zz_deleted_task_assignments')
     AND NOT EXISTS (SELECT 1 FROM pg_tables WHERE schemaname='public' AND tablename='task_assignments')
  THEN ALTER TABLE public.zz_deleted_task_assignments RENAME TO task_assignments; RAISE NOTICE 'ROLLBACK: task_assignments restored'; END IF;
END $$;

DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_tables WHERE schemaname='public' AND tablename='zz_deleted_task_attachments')
     AND NOT EXISTS (SELECT 1 FROM pg_tables WHERE schemaname='public' AND tablename='task_attachments')
  THEN ALTER TABLE public.zz_deleted_task_attachments RENAME TO task_attachments; RAISE NOTICE 'ROLLBACK: task_attachments restored'; END IF;
END $$;

DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_tables WHERE schemaname='public' AND tablename='zz_deleted_task_comments')
     AND NOT EXISTS (SELECT 1 FROM pg_tables WHERE schemaname='public' AND tablename='task_comments')
  THEN ALTER TABLE public.zz_deleted_task_comments RENAME TO task_comments; RAISE NOTICE 'ROLLBACK: task_comments restored'; END IF;
END $$;

DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_tables WHERE schemaname='public' AND tablename='zz_deleted_task_timeline')
     AND NOT EXISTS (SELECT 1 FROM pg_tables WHERE schemaname='public' AND tablename='task_timeline')
  THEN ALTER TABLE public.zz_deleted_task_timeline RENAME TO task_timeline; RAISE NOTICE 'ROLLBACK: task_timeline restored'; END IF;
END $$;

DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_tables WHERE schemaname='public' AND tablename='zz_deleted_team_members')
     AND NOT EXISTS (SELECT 1 FROM pg_tables WHERE schemaname='public' AND tablename='team_members')
  THEN ALTER TABLE public.zz_deleted_team_members RENAME TO team_members; RAISE NOTICE 'ROLLBACK: team_members restored'; END IF;
END $$;

DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_tables WHERE schemaname='public' AND tablename='zz_deleted_user_site_access')
     AND NOT EXISTS (SELECT 1 FROM pg_tables WHERE schemaname='public' AND tablename='user_site_access')
  THEN ALTER TABLE public.zz_deleted_user_site_access RENAME TO user_site_access; RAISE NOTICE 'ROLLBACK: user_site_access restored'; END IF;
END $$;

DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_tables WHERE schemaname='public' AND tablename='zz_deleted_whatsapp_messages')
     AND NOT EXISTS (SELECT 1 FROM pg_tables WHERE schemaname='public' AND tablename='whatsapp_messages')
  THEN ALTER TABLE public.zz_deleted_whatsapp_messages RENAME TO whatsapp_messages; RAISE NOTICE 'ROLLBACK: whatsapp_messages restored'; END IF;
END $$;

DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_tables WHERE schemaname='public' AND tablename='zz_deleted_whatsapp_notifications')
     AND NOT EXISTS (SELECT 1 FROM pg_tables WHERE schemaname='public' AND tablename='whatsapp_notifications')
  THEN ALTER TABLE public.zz_deleted_whatsapp_notifications RENAME TO whatsapp_notifications; RAISE NOTICE 'ROLLBACK: whatsapp_notifications restored'; END IF;
END $$;

-- NOTE: fleet_outstanding_import_log dikecualikan dari migration (KEEP) — tidak perlu rollback entry
