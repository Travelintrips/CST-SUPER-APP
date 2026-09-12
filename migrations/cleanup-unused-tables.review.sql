-- ============================================================================
-- cleanup-unused-tables.review.sql
-- Dibuat : 2026-06-23 oleh scripts/audit-unused-supabase-tables.mjs
-- Status : DRAFT — JANGAN JALANKAN TANPA REVIEW PENUH
--
-- SEMUA DROP DIKOMENTARI. Uncomment dan jalankan HANYA setelah:
--   1. Konfirmasi audit report dengan seluruh tim engineering
--   2. pg_dump production disimpan dan diverifikasi
--   3. Validasi row count = 0 atau data sudah dimigrasikan
--   4. Semua FK aktif sudah diputus / dipindahkan
--   5. Dijalankan di maintenance window dengan rollback siap
-- ============================================================================

-- ── STEP 0: VERIFIKASI ROW COUNT (jalankan dulu, pastikan sesuai ekspektasi) ─

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
SELECT 'service_catalog' AS tabel, COUNT(*) AS rows FROM "service_catalog";
SELECT 'service_circuit_states' AS tabel, COUNT(*) AS rows FROM "service_circuit_states";
SELECT 'service_registry' AS tabel, COUNT(*) AS rows FROM "service_registry";
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

-- ── STEP 1: DELETE_CANDIDATE — Tidak ada FK masuk ─────────────────────────────


-- Tabel : ai_tasks
-- Rows  : 0
-- Alasan: Kosong, tidak ada FK masuk, tidak ditemukan di kode
-- Risiko: LOW
-- DROP TABLE IF EXISTS "ai_tasks" CASCADE;


-- Tabel : attendance_records
-- Rows  : 0
-- Alasan: Kosong, tidak ada FK masuk, tidak ditemukan di kode
-- Risiko: LOW
-- DROP TABLE IF EXISTS "attendance_records" CASCADE;


-- Tabel : bank_account_balances
-- Rows  : 0
-- Alasan: Kosong, tidak ada FK masuk, tidak ditemukan di kode
-- Risiko: LOW
-- DROP TABLE IF EXISTS "bank_account_balances" CASCADE;


-- Tabel : bank_closing_periods
-- Rows  : 0
-- Alasan: Kosong, tidak ada FK masuk, tidak ditemukan di kode
-- Risiko: LOW
-- DROP TABLE IF EXISTS "bank_closing_periods" CASCADE;


-- Tabel : bank_coa_rules
-- Rows  : 0
-- Alasan: Kosong, tidak ada FK masuk, tidak ditemukan di kode
-- Risiko: LOW
-- DROP TABLE IF EXISTS "bank_coa_rules" CASCADE;


-- Tabel : bank_recon_audit_logs
-- Rows  : 0
-- Alasan: Kosong, tidak ada FK masuk, tidak ditemukan di kode
-- Risiko: LOW
-- DROP TABLE IF EXISTS "bank_recon_audit_logs" CASCADE;


-- Tabel : banners
-- Rows  : 0
-- Alasan: Kosong, tidak ada FK masuk, tidak ditemukan di kode
-- Risiko: LOW
-- DROP TABLE IF EXISTS "banners" CASCADE;


-- Tabel : blast_session_logs
-- Rows  : 0
-- Alasan: Kosong, tidak ada FK masuk, tidak ditemukan di kode
-- Risiko: LOW
-- DROP TABLE IF EXISTS "blast_session_logs" CASCADE;


-- Tabel : cashier_shifts
-- Rows  : 0
-- Alasan: Kosong, tidak ada FK masuk, tidak ditemukan di kode
-- Risiko: LOW
-- DROP TABLE IF EXISTS "cashier_shifts" CASCADE;


-- Tabel : cms_blocks
-- Rows  : 0
-- Alasan: Kosong, tidak ada FK masuk, tidak ditemukan di kode
-- Risiko: LOW
-- DROP TABLE IF EXISTS "cms_blocks" CASCADE;


-- Tabel : cms_media
-- Rows  : 0
-- Alasan: Kosong, tidak ada FK masuk, tidak ditemukan di kode
-- Risiko: LOW
-- DROP TABLE IF EXISTS "cms_media" CASCADE;


-- Tabel : cms_pages
-- Rows  : 0
-- Alasan: Kosong, tidak ada FK masuk, tidak ditemukan di kode
-- Risiko: LOW
-- DROP TABLE IF EXISTS "cms_pages" CASCADE;


-- Tabel : cms_settings
-- Rows  : 0
-- Alasan: Kosong, tidak ada FK masuk, tidak ditemukan di kode
-- Risiko: LOW
-- DROP TABLE IF EXISTS "cms_settings" CASCADE;


-- Tabel : company_settings
-- Rows  : 0
-- Alasan: Kosong, tidak ada FK masuk, tidak ditemukan di kode
-- Risiko: LOW
-- DROP TABLE IF EXISTS "company_settings" CASCADE;


-- Tabel : customer_contexts
-- Rows  : 0
-- Alasan: Kosong, tidak ada FK masuk, tidak ditemukan di kode
-- Risiko: LOW
-- DROP TABLE IF EXISTS "customer_contexts" CASCADE;


-- Tabel : data_template_fields
-- Rows  : 0
-- Alasan: Kosong, tidak ada FK masuk, tidak ditemukan di kode
-- Risiko: LOW
-- DROP TABLE IF EXISTS "data_template_fields" CASCADE;


-- Tabel : data_templates
-- Rows  : 0
-- Alasan: Kosong, tidak ada FK masuk, tidak ditemukan di kode
-- Risiko: LOW
-- DROP TABLE IF EXISTS "data_templates" CASCADE;


-- Tabel : dispatcher_logs
-- Rows  : 0
-- Alasan: Kosong, tidak ada FK masuk, tidak ditemukan di kode
-- Risiko: LOW
-- DROP TABLE IF EXISTS "dispatcher_logs" CASCADE;


-- Tabel : document_audits
-- Rows  : 0
-- Alasan: Kosong, tidak ada FK masuk, tidak ditemukan di kode
-- Risiko: LOW
-- DROP TABLE IF EXISTS "document_audits" CASCADE;


-- Tabel : document_template_fields
-- Rows  : 0
-- Alasan: Kosong, tidak ada FK masuk, tidak ditemukan di kode
-- Risiko: LOW
-- DROP TABLE IF EXISTS "document_template_fields" CASCADE;


-- Tabel : document_templates
-- Rows  : 0
-- Alasan: Kosong, tidak ada FK masuk, tidak ditemukan di kode
-- Risiko: LOW
-- DROP TABLE IF EXISTS "document_templates" CASCADE;


-- Tabel : draft_agreements_wa_log
-- Rows  : 0
-- Alasan: Kosong, tidak ada FK masuk, tidak ditemukan di kode
-- Risiko: LOW
-- DROP TABLE IF EXISTS "draft_agreements_wa_log" CASCADE;


-- Tabel : employee_kasbon
-- Rows  : 1
-- Alasan: 1 row(s) kecil, tidak ditemukan di kode, tidak ada FK masuk
-- Risiko: LOW
-- DROP TABLE IF EXISTS "employee_kasbon" CASCADE;


-- Tabel : employees
-- Rows  : 15
-- Alasan: 15 row(s) kecil, tidak ditemukan di kode, tidak ada FK masuk
-- Risiko: LOW
-- DROP TABLE IF EXISTS "employees" CASCADE;


-- Tabel : finance_payment_events
-- Rows  : 11
-- Alasan: 11 row(s) kecil, tidak ditemukan di kode, tidak ada FK masuk
-- Risiko: LOW
-- DROP TABLE IF EXISTS "finance_payment_events" CASCADE;


-- Tabel : follow_up_logs
-- Rows  : 0
-- Alasan: Kosong, tidak ada FK masuk, tidak ditemukan di kode
-- Risiko: LOW
-- DROP TABLE IF EXISTS "follow_up_logs" CASCADE;


-- Tabel : gym_memberships
-- Rows  : 0
-- Alasan: Kosong, tidak ada FK masuk, tidak ditemukan di kode
-- Risiko: LOW
-- DROP TABLE IF EXISTS "gym_memberships" CASCADE;


-- Tabel : intent_master
-- Rows  : 0
-- Alasan: Kosong, tidak ada FK masuk, tidak ditemukan di kode
-- Risiko: LOW
-- DROP TABLE IF EXISTS "intent_master" CASCADE;


-- Tabel : keyword_rules
-- Rows  : 0
-- Alasan: Kosong, tidak ada FK masuk, tidak ditemukan di kode
-- Risiko: LOW
-- DROP TABLE IF EXISTS "keyword_rules" CASCADE;


-- Tabel : leave_requests
-- Rows  : 0
-- Alasan: Kosong, tidak ada FK masuk, tidak ditemukan di kode
-- Risiko: LOW
-- DROP TABLE IF EXISTS "leave_requests" CASCADE;


-- Tabel : operational_checklists
-- Rows  : 0
-- Alasan: Kosong, tidak ada FK masuk, tidak ditemukan di kode
-- Risiko: LOW
-- DROP TABLE IF EXISTS "operational_checklists" CASCADE;


-- Tabel : operational_expenses
-- Rows  : 0
-- Alasan: Kosong, tidak ada FK masuk, tidak ditemukan di kode
-- Risiko: LOW
-- DROP TABLE IF EXISTS "operational_expenses" CASCADE;


-- Tabel : order_asuransi
-- Rows  : 19
-- Alasan: 19 row(s) kecil, tidak ditemukan di kode, tidak ada FK masuk
-- Risiko: LOW
-- DROP TABLE IF EXISTS "order_asuransi" CASCADE;


-- Tabel : otp_tokens
-- Rows  : 0
-- Alasan: Kosong, tidak ada FK masuk, tidak ditemukan di kode
-- Risiko: LOW
-- DROP TABLE IF EXISTS "otp_tokens" CASCADE;


-- Tabel : page_products
-- Rows  : 0
-- Alasan: Kosong, tidak ada FK masuk, tidak ditemukan di kode
-- Risiko: LOW
-- DROP TABLE IF EXISTS "page_products" CASCADE;


-- Tabel : payment_receipts
-- Rows  : 11
-- Alasan: 11 row(s) kecil, tidak ditemukan di kode, tidak ada FK masuk
-- Risiko: LOW
-- DROP TABLE IF EXISTS "payment_receipts" CASCADE;


-- Tabel : promo_registrations
-- Rows  : 0
-- Alasan: Kosong, tidak ada FK masuk, tidak ditemukan di kode
-- Risiko: LOW
-- DROP TABLE IF EXISTS "promo_registrations" CASCADE;


-- Tabel : public_tokens
-- Rows  : 0
-- Alasan: Kosong, tidak ada FK masuk, tidak ditemukan di kode
-- Risiko: LOW
-- DROP TABLE IF EXISTS "public_tokens" CASCADE;


-- Tabel : registration_link_wa_log
-- Rows  : 0
-- Alasan: Kosong, tidak ada FK masuk, tidak ditemukan di kode
-- Risiko: LOW
-- DROP TABLE IF EXISTS "registration_link_wa_log" CASCADE;


-- Tabel : service_catalog
-- Rows  : 0
-- Alasan: Kosong, tidak ada FK masuk, tidak ditemukan di kode
-- Risiko: LOW
-- DROP TABLE IF EXISTS "service_catalog" CASCADE;


-- Tabel : service_circuit_states
-- Rows  : 0
-- Alasan: Kosong, tidak ada FK masuk, tidak ditemukan di kode
-- Risiko: LOW
-- DROP TABLE IF EXISTS "service_circuit_states" CASCADE;


-- Tabel : service_registry
-- Rows  : 0
-- Alasan: Kosong, tidak ada FK masuk, tidak ditemukan di kode
-- Risiko: LOW
-- DROP TABLE IF EXISTS "service_registry" CASCADE;


-- Tabel : system_settings
-- Rows  : 1
-- Alasan: 1 row(s) kecil, tidak ditemukan di kode, tidak ada FK masuk
-- Risiko: LOW
-- DROP TABLE IF EXISTS "system_settings" CASCADE;


-- Tabel : task_assignments
-- Rows  : 0
-- Alasan: Kosong, tidak ada FK masuk, tidak ditemukan di kode
-- Risiko: LOW
-- DROP TABLE IF EXISTS "task_assignments" CASCADE;


-- Tabel : task_attachments
-- Rows  : 0
-- Alasan: Kosong, tidak ada FK masuk, tidak ditemukan di kode
-- Risiko: LOW
-- DROP TABLE IF EXISTS "task_attachments" CASCADE;


-- Tabel : task_comments
-- Rows  : 0
-- Alasan: Kosong, tidak ada FK masuk, tidak ditemukan di kode
-- Risiko: LOW
-- DROP TABLE IF EXISTS "task_comments" CASCADE;


-- Tabel : task_timeline
-- Rows  : 0
-- Alasan: Kosong, tidak ada FK masuk, tidak ditemukan di kode
-- Risiko: LOW
-- DROP TABLE IF EXISTS "task_timeline" CASCADE;


-- Tabel : team_members
-- Rows  : 0
-- Alasan: Kosong, tidak ada FK masuk, tidak ditemukan di kode
-- Risiko: LOW
-- DROP TABLE IF EXISTS "team_members" CASCADE;


-- Tabel : user_site_access
-- Rows  : 0
-- Alasan: Kosong, tidak ada FK masuk, tidak ditemukan di kode
-- Risiko: LOW
-- DROP TABLE IF EXISTS "user_site_access" CASCADE;


-- Tabel : wa_send_logs
-- Rows  : 12
-- Alasan: 12 row(s) kecil, tidak ditemukan di kode, tidak ada FK masuk
-- Risiko: LOW
-- DROP TABLE IF EXISTS "wa_send_logs" CASCADE;


-- Tabel : whatsapp_messages
-- Rows  : 0
-- Alasan: Kosong, tidak ada FK masuk, tidak ditemukan di kode
-- Risiko: LOW
-- DROP TABLE IF EXISTS "whatsapp_messages" CASCADE;


-- Tabel : whatsapp_notifications
-- Rows  : 0
-- Alasan: Kosong, tidak ada FK masuk, tidak ditemukan di kode
-- Risiko: LOW
-- DROP TABLE IF EXISTS "whatsapp_notifications" CASCADE;


-- (Tidak ada DELETE_CANDIDATE dengan FK masuk)



-- ── ARCHIVE — Pindah ke schema archive dulu ────────────────────────────────
-- Jalankan CREATE TABLE archive."..." AS TABLE terlebih dahulu,
-- baru DROP TABLE public."..." setelah data terkonfirmasi aman.

-- Tabel  : fleet_accounting_journals
-- Rows   : 0
-- FK↓    : 0
-- Alasan : Legacy — perlu konfirmasi tim sebelum drop
-- CREATE SCHEMA IF NOT EXISTS archive;
-- CREATE TABLE IF NOT EXISTS archive."fleet_accounting_journals" AS TABLE public."fleet_accounting_journals";
-- DROP TABLE IF EXISTS public."fleet_accounting_journals" CASCADE;


-- Tabel  : fleet_expenses
-- Rows   : 0
-- FK↓    : 0
-- Alasan : Legacy — perlu konfirmasi tim sebelum drop
-- CREATE SCHEMA IF NOT EXISTS archive;
-- CREATE TABLE IF NOT EXISTS archive."fleet_expenses" AS TABLE public."fleet_expenses";
-- DROP TABLE IF EXISTS public."fleet_expenses" CASCADE;


-- Tabel  : fleet_ledger_entries
-- Rows   : 17
-- FK↓    : 0
-- Alasan : Legacy — perlu konfirmasi tim sebelum drop
-- CREATE SCHEMA IF NOT EXISTS archive;
-- CREATE TABLE IF NOT EXISTS archive."fleet_ledger_entries" AS TABLE public."fleet_ledger_entries";
-- DROP TABLE IF EXISTS public."fleet_ledger_entries" CASCADE;


-- Tabel  : fleet_outstanding_import_log
-- Rows   : 0
-- FK↓    : 0
-- Alasan : Legacy — perlu konfirmasi tim sebelum drop
-- CREATE SCHEMA IF NOT EXISTS archive;
-- CREATE TABLE IF NOT EXISTS archive."fleet_outstanding_import_log" AS TABLE public."fleet_outstanding_import_log";
-- DROP TABLE IF EXISTS public."fleet_outstanding_import_log" CASCADE;


-- Tabel  : fleet_partners
-- Rows   : 0
-- FK↓    : 3
-- Alasan : Legacy — masih ada FK masuk, investigasi dulu sebelum drop
-- CREATE SCHEMA IF NOT EXISTS archive;
-- CREATE TABLE IF NOT EXISTS archive."fleet_partners" AS TABLE public."fleet_partners";
-- DROP TABLE IF EXISTS public."fleet_partners" CASCADE;


-- Tabel  : fleet_pipeline_health
-- Rows   : 0
-- FK↓    : 0
-- Alasan : Legacy — perlu konfirmasi tim sebelum drop
-- CREATE SCHEMA IF NOT EXISTS archive;
-- CREATE TABLE IF NOT EXISTS archive."fleet_pipeline_health" AS TABLE public."fleet_pipeline_health";
-- DROP TABLE IF EXISTS public."fleet_pipeline_health" CASCADE;


-- Tabel  : fleet_reconciliation_reports
-- Rows   : 0
-- FK↓    : 0
-- Alasan : Legacy — perlu konfirmasi tim sebelum drop
-- CREATE SCHEMA IF NOT EXISTS archive;
-- CREATE TABLE IF NOT EXISTS archive."fleet_reconciliation_reports" AS TABLE public."fleet_reconciliation_reports";
-- DROP TABLE IF EXISTS public."fleet_reconciliation_reports" CASCADE;


-- Tabel  : fleet_vehicles
-- Rows   : 0
-- FK↓    : 2
-- Alasan : Legacy — masih ada FK masuk, investigasi dulu sebelum drop
-- CREATE SCHEMA IF NOT EXISTS archive;
-- CREATE TABLE IF NOT EXISTS archive."fleet_vehicles" AS TABLE public."fleet_vehicles";
-- DROP TABLE IF EXISTS public."fleet_vehicles" CASCADE;


-- Tabel  : fleet_wa_logs
-- Rows   : 0
-- FK↓    : 0
-- Alasan : Legacy — perlu konfirmasi tim sebelum drop
-- CREATE SCHEMA IF NOT EXISTS archive;
-- CREATE TABLE IF NOT EXISTS archive."fleet_wa_logs" AS TABLE public."fleet_wa_logs";
-- DROP TABLE IF EXISTS public."fleet_wa_logs" CASCADE;


-- Tabel  : sc_admin_notes
-- Rows   : 0
-- FK↓    : 0
-- Alasan : Legacy — perlu konfirmasi tim sebelum drop
-- CREATE SCHEMA IF NOT EXISTS archive;
-- CREATE TABLE IF NOT EXISTS archive."sc_admin_notes" AS TABLE public."sc_admin_notes";
-- DROP TABLE IF EXISTS public."sc_admin_notes" CASCADE;


-- Tabel  : sc_blocked_schedules
-- Rows   : 0
-- FK↓    : 0
-- Alasan : Legacy — perlu konfirmasi tim sebelum drop
-- CREATE SCHEMA IF NOT EXISTS archive;
-- CREATE TABLE IF NOT EXISTS archive."sc_blocked_schedules" AS TABLE public."sc_blocked_schedules";
-- DROP TABLE IF EXISTS public."sc_blocked_schedules" CASCADE;


-- Tabel  : sc_facility_images
-- Rows   : 0
-- FK↓    : 0
-- Alasan : Legacy — perlu konfirmasi tim sebelum drop
-- CREATE SCHEMA IF NOT EXISTS archive;
-- CREATE TABLE IF NOT EXISTS archive."sc_facility_images" AS TABLE public."sc_facility_images";
-- DROP TABLE IF EXISTS public."sc_facility_images" CASCADE;


-- Tabel  : sc_payments
-- Rows   : 0
-- FK↓    : 0
-- Alasan : Legacy — perlu konfirmasi tim sebelum drop
-- CREATE SCHEMA IF NOT EXISTS archive;
-- CREATE TABLE IF NOT EXISTS archive."sc_payments" AS TABLE public."sc_payments";
-- DROP TABLE IF EXISTS public."sc_payments" CASCADE;


-- Tabel  : sc_promos
-- Rows   : 0
-- FK↓    : 0
-- Alasan : Legacy — perlu konfirmasi tim sebelum drop
-- CREATE SCHEMA IF NOT EXISTS archive;
-- CREATE TABLE IF NOT EXISTS archive."sc_promos" AS TABLE public."sc_promos";
-- DROP TABLE IF EXISTS public."sc_promos" CASCADE;


-- Tabel  : sc_settings
-- Rows   : 0
-- FK↓    : 0
-- Alasan : Legacy — perlu konfirmasi tim sebelum drop
-- CREATE SCHEMA IF NOT EXISTS archive;
-- CREATE TABLE IF NOT EXISTS archive."sc_settings" AS TABLE public."sc_settings";
-- DROP TABLE IF EXISTS public."sc_settings" CASCADE;


-- Tabel  : shipment_events
-- Rows   : 0
-- FK↓    : 0
-- Alasan : Legacy — perlu konfirmasi tim sebelum drop
-- CREATE SCHEMA IF NOT EXISTS archive;
-- CREATE TABLE IF NOT EXISTS archive."shipment_events" AS TABLE public."shipment_events";
-- DROP TABLE IF EXISTS public."shipment_events" CASCADE;


-- Tabel  : shipment_stages
-- Rows   : 0
-- FK↓    : 0
-- Alasan : Legacy — perlu konfirmasi tim sebelum drop
-- CREATE SCHEMA IF NOT EXISTS archive;
-- CREATE TABLE IF NOT EXISTS archive."shipment_stages" AS TABLE public."shipment_stages";
-- DROP TABLE IF EXISTS public."shipment_stages" CASCADE;


-- Tabel  : shipment_trackings
-- Rows   : 0
-- FK↓    : 0
-- Alasan : Legacy — perlu konfirmasi tim sebelum drop
-- CREATE SCHEMA IF NOT EXISTS archive;
-- CREATE TABLE IF NOT EXISTS archive."shipment_trackings" AS TABLE public."shipment_trackings";
-- DROP TABLE IF EXISTS public."shipment_trackings" CASCADE;


-- Tabel  : shipments
-- Rows   : 0
-- FK↓    : 0
-- Alasan : Legacy — perlu konfirmasi tim sebelum drop
-- CREATE SCHEMA IF NOT EXISTS archive;
-- CREATE TABLE IF NOT EXISTS archive."shipments" AS TABLE public."shipments";
-- DROP TABLE IF EXISTS public."shipments" CASCADE;


-- Tabel  : sport_center_bookings
-- Rows   : 2
-- FK↓    : 0
-- Alasan : Legacy — perlu konfirmasi tim sebelum drop
-- CREATE SCHEMA IF NOT EXISTS archive;
-- CREATE TABLE IF NOT EXISTS archive."sport_center_bookings" AS TABLE public."sport_center_bookings";
-- DROP TABLE IF EXISTS public."sport_center_bookings" CASCADE;


-- Tabel  : sport_center_expenses
-- Rows   : 0
-- FK↓    : 0
-- Alasan : Legacy — perlu konfirmasi tim sebelum drop
-- CREATE SCHEMA IF NOT EXISTS archive;
-- CREATE TABLE IF NOT EXISTS archive."sport_center_expenses" AS TABLE public."sport_center_expenses";
-- DROP TABLE IF EXISTS public."sport_center_expenses" CASCADE;


-- Tabel  : sport_center_facilities
-- Rows   : 2
-- FK↓    : 1
-- Alasan : Legacy — masih ada FK masuk, investigasi dulu sebelum drop
-- CREATE SCHEMA IF NOT EXISTS archive;
-- CREATE TABLE IF NOT EXISTS archive."sport_center_facilities" AS TABLE public."sport_center_facilities";
-- DROP TABLE IF EXISTS public."sport_center_facilities" CASCADE;


-- Tabel  : sport_center_memberships
-- Rows   : 0
-- FK↓    : 0
-- Alasan : Legacy — perlu konfirmasi tim sebelum drop
-- CREATE SCHEMA IF NOT EXISTS archive;
-- CREATE TABLE IF NOT EXISTS archive."sport_center_memberships" AS TABLE public."sport_center_memberships";
-- DROP TABLE IF EXISTS public."sport_center_memberships" CASCADE;


-- Tabel  : transaction_datetime_normalized
-- Rows   : 0
-- FK↓    : 0
-- Alasan : Legacy — perlu konfirmasi tim sebelum drop
-- CREATE SCHEMA IF NOT EXISTS archive;
-- CREATE TABLE IF NOT EXISTS archive."transaction_datetime_normalized" AS TABLE public."transaction_datetime_normalized";
-- DROP TABLE IF EXISTS public."transaction_datetime_normalized" CASCADE;


-- Tabel  : workflow_events
-- Rows   : 0
-- FK↓    : 0
-- Alasan : Legacy — perlu konfirmasi tim sebelum drop
-- CREATE SCHEMA IF NOT EXISTS archive;
-- CREATE TABLE IF NOT EXISTS archive."workflow_events" AS TABLE public."workflow_events";
-- DROP TABLE IF EXISTS public."workflow_events" CASCADE;


