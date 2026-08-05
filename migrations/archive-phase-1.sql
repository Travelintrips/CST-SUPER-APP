-- ============================================================================
-- archive-phase-1.sql  —  RENAME tabel ke zz_deleted_*
-- Dibuat : 2026-06-23 oleh scripts/pre-delete-impact-analysis.mjs
--
-- Strategi: RENAME (bukan DROP) sehingga rollback mudah.
-- Jalankan archive-phase-1-rollback.sql untuk membalikkan.
--
-- PRASYARAT:
--   1. pg_dump production sudah disimpan
--   2. Verifikasi row count di STEP 0
--   3. Tidak ada traffic aktif ke tabel-tabel ini
--   4. Jalankan di maintenance window
-- ============================================================================

-- ── STEP 0: VERIFIKASI ROW COUNT ──────────────────────────────────────────────
SELECT 'ai_tasks' AS tabel, COUNT(*) AS rows FROM "ai_tasks";
SELECT 'attendance_records' AS tabel, COUNT(*) AS rows FROM "attendance_records";
SELECT 'bank_account_balances' AS tabel, COUNT(*) AS rows FROM "bank_account_balances";
SELECT 'bank_closing_periods' AS tabel, COUNT(*) AS rows FROM "bank_closing_periods";
SELECT 'bank_coa_rules' AS tabel, COUNT(*) AS rows FROM "bank_coa_rules";
SELECT 'bank_recon_audit_logs' AS tabel, COUNT(*) AS rows FROM "bank_recon_audit_logs";
SELECT 'banners' AS tabel, COUNT(*) AS rows FROM "banners";
SELECT 'blast_session_logs' AS tabel, COUNT(*) AS rows FROM "blast_session_logs";
SELECT 'cashier_shifts' AS tabel, COUNT(*) AS rows FROM "cashier_shifts";
SELECT 'cms_blocks' AS tabel, COUNT(*) AS rows FROM "cms_blocks";
SELECT 'cms_media' AS tabel, COUNT(*) AS rows FROM "cms_media";
SELECT 'cms_pages' AS tabel, COUNT(*) AS rows FROM "cms_pages";
SELECT 'cms_settings' AS tabel, COUNT(*) AS rows FROM "cms_settings";
SELECT 'company_settings' AS tabel, COUNT(*) AS rows FROM "company_settings";
SELECT 'customer_contexts' AS tabel, COUNT(*) AS rows FROM "customer_contexts";
SELECT 'data_template_fields' AS tabel, COUNT(*) AS rows FROM "data_template_fields";
SELECT 'data_templates' AS tabel, COUNT(*) AS rows FROM "data_templates";
SELECT 'dispatcher_logs' AS tabel, COUNT(*) AS rows FROM "dispatcher_logs";
SELECT 'document_audits' AS tabel, COUNT(*) AS rows FROM "document_audits";
SELECT 'document_template_fields' AS tabel, COUNT(*) AS rows FROM "document_template_fields";
SELECT 'document_templates' AS tabel, COUNT(*) AS rows FROM "document_templates";
SELECT 'draft_agreements_wa_log' AS tabel, COUNT(*) AS rows FROM "draft_agreements_wa_log";
SELECT 'employee_kasbon' AS tabel, COUNT(*) AS rows FROM "employee_kasbon";
SELECT 'employees' AS tabel, COUNT(*) AS rows FROM "employees";
SELECT 'finance_payment_events' AS tabel, COUNT(*) AS rows FROM "finance_payment_events";
SELECT 'follow_up_logs' AS tabel, COUNT(*) AS rows FROM "follow_up_logs";
SELECT 'gym_memberships' AS tabel, COUNT(*) AS rows FROM "gym_memberships";
SELECT 'intent_master' AS tabel, COUNT(*) AS rows FROM "intent_master";
SELECT 'keyword_rules' AS tabel, COUNT(*) AS rows FROM "keyword_rules";
SELECT 'leave_requests' AS tabel, COUNT(*) AS rows FROM "leave_requests";
SELECT 'operational_checklists' AS tabel, COUNT(*) AS rows FROM "operational_checklists";
SELECT 'operational_expenses' AS tabel, COUNT(*) AS rows FROM "operational_expenses";
SELECT 'order_asuransi' AS tabel, COUNT(*) AS rows FROM "order_asuransi";
SELECT 'otp_tokens' AS tabel, COUNT(*) AS rows FROM "otp_tokens";
SELECT 'page_products' AS tabel, COUNT(*) AS rows FROM "page_products";
SELECT 'payment_receipts' AS tabel, COUNT(*) AS rows FROM "payment_receipts";
SELECT 'promo_registrations' AS tabel, COUNT(*) AS rows FROM "promo_registrations";
SELECT 'public_tokens' AS tabel, COUNT(*) AS rows FROM "public_tokens";
SELECT 'registration_link_wa_log' AS tabel, COUNT(*) AS rows FROM "registration_link_wa_log";
SELECT 'sc_admin_notes' AS tabel, COUNT(*) AS rows FROM "sc_admin_notes";
SELECT 'sc_blocked_schedules' AS tabel, COUNT(*) AS rows FROM "sc_blocked_schedules";
SELECT 'sc_facility_images' AS tabel, COUNT(*) AS rows FROM "sc_facility_images";
SELECT 'sc_promos' AS tabel, COUNT(*) AS rows FROM "sc_promos";
SELECT 'sc_settings' AS tabel, COUNT(*) AS rows FROM "sc_settings";
SELECT 'service_catalog' AS tabel, COUNT(*) AS rows FROM "service_catalog";
SELECT 'service_circuit_states' AS tabel, COUNT(*) AS rows FROM "service_circuit_states";
SELECT 'service_registry' AS tabel, COUNT(*) AS rows FROM "service_registry";
SELECT 'shipment_events' AS tabel, COUNT(*) AS rows FROM "shipment_events";
SELECT 'shipment_trackings' AS tabel, COUNT(*) AS rows FROM "shipment_trackings";
SELECT 'shipments' AS tabel, COUNT(*) AS rows FROM "shipments";
SELECT 'sport_center_expenses' AS tabel, COUNT(*) AS rows FROM "sport_center_expenses";
SELECT 'system_settings' AS tabel, COUNT(*) AS rows FROM "system_settings";
SELECT 'task_assignments' AS tabel, COUNT(*) AS rows FROM "task_assignments";
SELECT 'task_attachments' AS tabel, COUNT(*) AS rows FROM "task_attachments";
SELECT 'task_comments' AS tabel, COUNT(*) AS rows FROM "task_comments";
SELECT 'task_timeline' AS tabel, COUNT(*) AS rows FROM "task_timeline";
SELECT 'team_members' AS tabel, COUNT(*) AS rows FROM "team_members";
SELECT 'user_site_access' AS tabel, COUNT(*) AS rows FROM "user_site_access";
SELECT 'wa_send_logs' AS tabel, COUNT(*) AS rows FROM "wa_send_logs";
SELECT 'whatsapp_messages' AS tabel, COUNT(*) AS rows FROM "whatsapp_messages";
SELECT 'whatsapp_notifications' AS tabel, COUNT(*) AS rows FROM "whatsapp_notifications";

-- ── STEP 1: RENAME TABEL AMAN (61 tabel) ───────────────────────────────

-- ai_tasks | rows:0 | risk:SAFE
ALTER TABLE "ai_tasks" RENAME TO "zz_deleted_ai_tasks";


-- attendance_records | rows:0 | risk:SAFE
ALTER TABLE "attendance_records" RENAME TO "zz_deleted_attendance_records";


-- bank_account_balances | rows:0 | risk:SAFE
ALTER TABLE "bank_account_balances" RENAME TO "zz_deleted_bank_account_balances";


-- bank_closing_periods | rows:0 | risk:SAFE
ALTER TABLE "bank_closing_periods" RENAME TO "zz_deleted_bank_closing_periods";


-- bank_coa_rules | rows:0 | risk:SAFE
ALTER TABLE "bank_coa_rules" RENAME TO "zz_deleted_bank_coa_rules";


-- bank_recon_audit_logs | rows:0 | risk:SAFE
ALTER TABLE "bank_recon_audit_logs" RENAME TO "zz_deleted_bank_recon_audit_logs";


-- banners | rows:0 | risk:SAFE
ALTER TABLE "banners" RENAME TO "zz_deleted_banners";


-- blast_session_logs | rows:0 | risk:SAFE
ALTER TABLE "blast_session_logs" RENAME TO "zz_deleted_blast_session_logs";


-- cashier_shifts | rows:0 | risk:SAFE
ALTER TABLE "cashier_shifts" RENAME TO "zz_deleted_cashier_shifts";


-- cms_blocks | rows:0 | risk:SAFE
ALTER TABLE "cms_blocks" RENAME TO "zz_deleted_cms_blocks";


-- cms_media | rows:0 | risk:SAFE
ALTER TABLE "cms_media" RENAME TO "zz_deleted_cms_media";


-- cms_pages | rows:0 | risk:SAFE
ALTER TABLE "cms_pages" RENAME TO "zz_deleted_cms_pages";


-- cms_settings | rows:0 | risk:SAFE
ALTER TABLE "cms_settings" RENAME TO "zz_deleted_cms_settings";


-- company_settings | rows:0 | risk:SAFE
ALTER TABLE "company_settings" RENAME TO "zz_deleted_company_settings";


-- customer_contexts | rows:0 | risk:SAFE
ALTER TABLE "customer_contexts" RENAME TO "zz_deleted_customer_contexts";


-- data_template_fields | rows:0 | risk:SAFE
ALTER TABLE "data_template_fields" RENAME TO "zz_deleted_data_template_fields";


-- data_templates | rows:0 | risk:SAFE
ALTER TABLE "data_templates" RENAME TO "zz_deleted_data_templates";


-- dispatcher_logs | rows:0 | risk:SAFE
ALTER TABLE "dispatcher_logs" RENAME TO "zz_deleted_dispatcher_logs";


-- document_audits | rows:0 | risk:SAFE
ALTER TABLE "document_audits" RENAME TO "zz_deleted_document_audits";


-- document_template_fields | rows:0 | risk:SAFE
ALTER TABLE "document_template_fields" RENAME TO "zz_deleted_document_template_fields";


-- document_templates | rows:0 | risk:SAFE
ALTER TABLE "document_templates" RENAME TO "zz_deleted_document_templates";


-- draft_agreements_wa_log | rows:0 | risk:SAFE
ALTER TABLE "draft_agreements_wa_log" RENAME TO "zz_deleted_draft_agreements_wa_log";


-- employee_kasbon | rows:1 | risk:LOW
ALTER TABLE "employee_kasbon" RENAME TO "zz_deleted_employee_kasbon";


-- employees | rows:15 | risk:LOW
ALTER TABLE "employees" RENAME TO "zz_deleted_employees";


-- finance_payment_events | rows:11 | risk:LOW
ALTER TABLE "finance_payment_events" RENAME TO "zz_deleted_finance_payment_events";


-- follow_up_logs | rows:0 | risk:SAFE
ALTER TABLE "follow_up_logs" RENAME TO "zz_deleted_follow_up_logs";


-- gym_memberships | rows:0 | risk:SAFE
ALTER TABLE "gym_memberships" RENAME TO "zz_deleted_gym_memberships";


-- intent_master | rows:0 | risk:SAFE
ALTER TABLE "intent_master" RENAME TO "zz_deleted_intent_master";


-- keyword_rules | rows:0 | risk:SAFE
ALTER TABLE "keyword_rules" RENAME TO "zz_deleted_keyword_rules";


-- leave_requests | rows:0 | risk:SAFE
ALTER TABLE "leave_requests" RENAME TO "zz_deleted_leave_requests";


-- operational_checklists | rows:0 | risk:SAFE
ALTER TABLE "operational_checklists" RENAME TO "zz_deleted_operational_checklists";


-- operational_expenses | rows:0 | risk:SAFE
ALTER TABLE "operational_expenses" RENAME TO "zz_deleted_operational_expenses";


-- order_asuransi | rows:19 | risk:LOW
ALTER TABLE "order_asuransi" RENAME TO "zz_deleted_order_asuransi";


-- otp_tokens | rows:0 | risk:SAFE
ALTER TABLE "otp_tokens" RENAME TO "zz_deleted_otp_tokens";


-- page_products | rows:0 | risk:SAFE
ALTER TABLE "page_products" RENAME TO "zz_deleted_page_products";


-- payment_receipts | rows:11 | risk:LOW
ALTER TABLE "payment_receipts" RENAME TO "zz_deleted_payment_receipts";


-- promo_registrations | rows:0 | risk:SAFE
ALTER TABLE "promo_registrations" RENAME TO "zz_deleted_promo_registrations";


-- public_tokens | rows:0 | risk:SAFE
ALTER TABLE "public_tokens" RENAME TO "zz_deleted_public_tokens";


-- registration_link_wa_log | rows:0 | risk:SAFE
ALTER TABLE "registration_link_wa_log" RENAME TO "zz_deleted_registration_link_wa_log";


-- sc_admin_notes | rows:0 | risk:LOW
ALTER TABLE "sc_admin_notes" RENAME TO "zz_deleted_sc_admin_notes";


-- sc_blocked_schedules | rows:0 | risk:LOW
ALTER TABLE "sc_blocked_schedules" RENAME TO "zz_deleted_sc_blocked_schedules";


-- sc_facility_images | rows:0 | risk:LOW
ALTER TABLE "sc_facility_images" RENAME TO "zz_deleted_sc_facility_images";


-- sc_promos | rows:0 | risk:LOW
ALTER TABLE "sc_promos" RENAME TO "zz_deleted_sc_promos";


-- sc_settings | rows:0 | risk:LOW
ALTER TABLE "sc_settings" RENAME TO "zz_deleted_sc_settings";


-- service_catalog | rows:0 | risk:SAFE
ALTER TABLE "service_catalog" RENAME TO "zz_deleted_service_catalog";


-- service_circuit_states | rows:0 | risk:SAFE
ALTER TABLE "service_circuit_states" RENAME TO "zz_deleted_service_circuit_states";


-- service_registry | rows:0 | risk:SAFE
ALTER TABLE "service_registry" RENAME TO "zz_deleted_service_registry";


-- shipment_events | rows:0 | risk:SAFE
ALTER TABLE "shipment_events" RENAME TO "zz_deleted_shipment_events";


-- shipment_trackings | rows:0 | risk:SAFE
ALTER TABLE "shipment_trackings" RENAME TO "zz_deleted_shipment_trackings";


-- shipments | rows:0 | risk:LOW
ALTER TABLE "shipments" RENAME TO "zz_deleted_shipments";


-- sport_center_expenses | rows:0 | risk:LOW
ALTER TABLE "sport_center_expenses" RENAME TO "zz_deleted_sport_center_expenses";


-- system_settings | rows:1 | risk:SAFE
ALTER TABLE "system_settings" RENAME TO "zz_deleted_system_settings";


-- task_assignments | rows:0 | risk:SAFE
ALTER TABLE "task_assignments" RENAME TO "zz_deleted_task_assignments";


-- task_attachments | rows:0 | risk:SAFE
ALTER TABLE "task_attachments" RENAME TO "zz_deleted_task_attachments";


-- task_comments | rows:0 | risk:SAFE
ALTER TABLE "task_comments" RENAME TO "zz_deleted_task_comments";


-- task_timeline | rows:0 | risk:SAFE
ALTER TABLE "task_timeline" RENAME TO "zz_deleted_task_timeline";


-- team_members | rows:0 | risk:SAFE
ALTER TABLE "team_members" RENAME TO "zz_deleted_team_members";


-- user_site_access | rows:0 | risk:SAFE
ALTER TABLE "user_site_access" RENAME TO "zz_deleted_user_site_access";


-- wa_send_logs | rows:12 | risk:LOW
ALTER TABLE "wa_send_logs" RENAME TO "zz_deleted_wa_send_logs";


-- whatsapp_messages | rows:0 | risk:SAFE
ALTER TABLE "whatsapp_messages" RENAME TO "zz_deleted_whatsapp_messages";


-- whatsapp_notifications | rows:0 | risk:SAFE
ALTER TABLE "whatsapp_notifications" RENAME TO "zz_deleted_whatsapp_notifications";


-- ── TABEL DIBLOKIR — Jangan di-rename sebelum kode diperbaiki ────────────────

-- 🚫 DIBLOKIR: fleet_accounting_journals
--    Risk  : HIGH
--    Alasan: Risk HIGH — masih ada referensi di API layer
-- ALTER TABLE "fleet_accounting_journals" RENAME TO "zz_deleted_fleet_accounting_journals"; -- JANGAN uncomment sebelum issue di atas selesai


-- 🚫 DIBLOKIR: fleet_expenses
--    Risk  : HIGH
--    Alasan: Risk HIGH — masih ada referensi di API layer
-- ALTER TABLE "fleet_expenses" RENAME TO "zz_deleted_fleet_expenses"; -- JANGAN uncomment sebelum issue di atas selesai


-- 🚫 DIBLOKIR: fleet_ledger_entries
--    Risk  : HIGH
--    Alasan: Risk HIGH — masih ada referensi di API layer; DB View aktif: v_ledger_balance_view, v_ledger_journal_view; DB Trigger aktif: trg_fleet_ledger_immutable, trg_fleet_ledger_immutable, trg_ledger_period_lock; Deep trace: financialClosingMigration.ts: CREATE TABLE fleet_ledger_entries + ALTER TABLE
-- ALTER TABLE "fleet_ledger_entries" RENAME TO "zz_deleted_fleet_ledger_entries"; -- JANGAN uncomment sebelum issue di atas selesai


-- 🚫 DIBLOKIR: fleet_outstanding_import_log
--    Risk  : HIGH
--    Alasan: Risk HIGH — masih ada referensi di API layer
-- ALTER TABLE "fleet_outstanding_import_log" RENAME TO "zz_deleted_fleet_outstanding_import_log"; -- JANGAN uncomment sebelum issue di atas selesai


-- 🚫 DIBLOKIR: fleet_partners
--    Risk  : CRITICAL
--    Alasan: Risk CRITICAL — tabel masih aktif digunakan; Deep trace: fleetIntelligence.ts L118: CREATE TABLE IF NOT EXISTS fleet_partners — inline migration masih aktif
-- ALTER TABLE "fleet_partners" RENAME TO "zz_deleted_fleet_partners"; -- JANGAN uncomment sebelum issue di atas selesai


-- 🚫 DIBLOKIR: fleet_pipeline_health
--    Risk  : HIGH
--    Alasan: Risk HIGH — masih ada referensi di API layer
-- ALTER TABLE "fleet_pipeline_health" RENAME TO "zz_deleted_fleet_pipeline_health"; -- JANGAN uncomment sebelum issue di atas selesai


-- 🚫 DIBLOKIR: fleet_reconciliation_reports
--    Risk  : HIGH
--    Alasan: Risk HIGH — masih ada referensi di API layer
-- ALTER TABLE "fleet_reconciliation_reports" RENAME TO "zz_deleted_fleet_reconciliation_reports"; -- JANGAN uncomment sebelum issue di atas selesai


-- 🚫 DIBLOKIR: fleet_vehicles
--    Risk  : CRITICAL
--    Alasan: Risk CRITICAL — tabel masih aktif digunakan; Deep trace: fleetIntelligence.ts L133: CREATE TABLE IF NOT EXISTS fleet_vehicles — inline migration aktif
-- ALTER TABLE "fleet_vehicles" RENAME TO "zz_deleted_fleet_vehicles"; -- JANGAN uncomment sebelum issue di atas selesai


-- 🚫 DIBLOKIR: fleet_wa_logs
--    Risk  : HIGH
--    Alasan: Risk HIGH — masih ada referensi di API layer
-- ALTER TABLE "fleet_wa_logs" RENAME TO "zz_deleted_fleet_wa_logs"; -- JANGAN uncomment sebelum issue di atas selesai


-- 🚫 DIBLOKIR: sc_payments
--    Risk  : HIGH
--    Alasan: Risk HIGH — masih ada referensi di API layer
-- ALTER TABLE "sc_payments" RENAME TO "zz_deleted_sc_payments"; -- JANGAN uncomment sebelum issue di atas selesai


-- 🚫 DIBLOKIR: shipment_stages
--    Risk  : MEDIUM
--    Alasan: Risk MEDIUM — masih ada referensi di schema/migration/AI; Deep trace: lib/db/src/schema/shipmentStages.ts: pgTable('shipment_stages') — masih dalam schema
-- ALTER TABLE "shipment_stages" RENAME TO "zz_deleted_shipment_stages"; -- JANGAN uncomment sebelum issue di atas selesai


-- 🚫 DIBLOKIR: sport_center_bookings
--    Risk  : MEDIUM
--    Alasan: Risk MEDIUM — masih ada referensi di schema/migration/AI; Deep trace: modules/sport-center/migration.ts L323: READ dari sport_center_bookings sebagai sumber migrasi
-- ALTER TABLE "sport_center_bookings" RENAME TO "zz_deleted_sport_center_bookings"; -- JANGAN uncomment sebelum issue di atas selesai


-- 🚫 DIBLOKIR: sport_center_facilities
--    Risk  : MEDIUM
--    Alasan: Risk MEDIUM — masih ada referensi di schema/migration/AI; Deep trace: modules/sport-center/routes.ts L4716: SELECT FROM sport_center_facilities — query aktif ke Supabase
-- ALTER TABLE "sport_center_facilities" RENAME TO "zz_deleted_sport_center_facilities"; -- JANGAN uncomment sebelum issue di atas selesai


-- 🚫 DIBLOKIR: sport_center_memberships
--    Risk  : HIGH
--    Alasan: Risk HIGH — masih ada referensi di API layer
-- ALTER TABLE "sport_center_memberships" RENAME TO "zz_deleted_sport_center_memberships"; -- JANGAN uncomment sebelum issue di atas selesai


-- 🚫 DIBLOKIR: transaction_datetime_normalized
--    Risk  : HIGH
--    Alasan: Risk HIGH — masih ada referensi di API layer
-- ALTER TABLE "transaction_datetime_normalized" RENAME TO "zz_deleted_transaction_datetime_normalized"; -- JANGAN uncomment sebelum issue di atas selesai


-- 🚫 DIBLOKIR: workflow_events
--    Risk  : HIGH
--    Alasan: Risk HIGH — masih ada referensi di API layer
-- ALTER TABLE "workflow_events" RENAME TO "zz_deleted_workflow_events"; -- JANGAN uncomment sebelum issue di atas selesai

-- ============================================================================
-- SETELAH RENAME: verifikasi aplikasi berjalan normal selama 7 hari
-- Jika normal: lanjut ke archive-phase-2.sql (DROP zz_deleted_* tables)
-- Jika ada error: jalankan archive-phase-1-rollback.sql
-- ============================================================================
