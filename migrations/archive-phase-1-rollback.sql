-- ============================================================================
-- archive-phase-1-rollback.sql  —  ROLLBACK RENAME
-- Dibuat : 2026-06-23 oleh scripts/pre-delete-impact-analysis.mjs
--
-- Jalankan file ini untuk membalikkan semua rename di archive-phase-1.sql
-- ============================================================================

-- ── ROLLBACK: rename zz_deleted_* kembali ke nama asli ───────────────────────
-- ai_tasks
ALTER TABLE "zz_deleted_ai_tasks" RENAME TO "ai_tasks";

-- attendance_records
ALTER TABLE "zz_deleted_attendance_records" RENAME TO "attendance_records";

-- bank_account_balances
ALTER TABLE "zz_deleted_bank_account_balances" RENAME TO "bank_account_balances";

-- bank_closing_periods
ALTER TABLE "zz_deleted_bank_closing_periods" RENAME TO "bank_closing_periods";

-- bank_coa_rules
ALTER TABLE "zz_deleted_bank_coa_rules" RENAME TO "bank_coa_rules";

-- bank_recon_audit_logs
ALTER TABLE "zz_deleted_bank_recon_audit_logs" RENAME TO "bank_recon_audit_logs";

-- banners
ALTER TABLE "zz_deleted_banners" RENAME TO "banners";

-- blast_session_logs
ALTER TABLE "zz_deleted_blast_session_logs" RENAME TO "blast_session_logs";

-- cashier_shifts
ALTER TABLE "zz_deleted_cashier_shifts" RENAME TO "cashier_shifts";

-- cms_blocks
ALTER TABLE "zz_deleted_cms_blocks" RENAME TO "cms_blocks";

-- cms_media
ALTER TABLE "zz_deleted_cms_media" RENAME TO "cms_media";

-- cms_pages
ALTER TABLE "zz_deleted_cms_pages" RENAME TO "cms_pages";

-- cms_settings
ALTER TABLE "zz_deleted_cms_settings" RENAME TO "cms_settings";

-- company_settings
ALTER TABLE "zz_deleted_company_settings" RENAME TO "company_settings";

-- customer_contexts
ALTER TABLE "zz_deleted_customer_contexts" RENAME TO "customer_contexts";

-- data_template_fields
ALTER TABLE "zz_deleted_data_template_fields" RENAME TO "data_template_fields";

-- data_templates
ALTER TABLE "zz_deleted_data_templates" RENAME TO "data_templates";

-- dispatcher_logs
ALTER TABLE "zz_deleted_dispatcher_logs" RENAME TO "dispatcher_logs";

-- document_audits
ALTER TABLE "zz_deleted_document_audits" RENAME TO "document_audits";

-- document_template_fields
ALTER TABLE "zz_deleted_document_template_fields" RENAME TO "document_template_fields";

-- document_templates
ALTER TABLE "zz_deleted_document_templates" RENAME TO "document_templates";

-- draft_agreements_wa_log
ALTER TABLE "zz_deleted_draft_agreements_wa_log" RENAME TO "draft_agreements_wa_log";

-- employee_kasbon
ALTER TABLE "zz_deleted_employee_kasbon" RENAME TO "employee_kasbon";

-- employees
ALTER TABLE "zz_deleted_employees" RENAME TO "employees";

-- finance_payment_events
ALTER TABLE "zz_deleted_finance_payment_events" RENAME TO "finance_payment_events";

-- follow_up_logs
ALTER TABLE "zz_deleted_follow_up_logs" RENAME TO "follow_up_logs";

-- gym_memberships
ALTER TABLE "zz_deleted_gym_memberships" RENAME TO "gym_memberships";

-- intent_master
ALTER TABLE "zz_deleted_intent_master" RENAME TO "intent_master";

-- keyword_rules
ALTER TABLE "zz_deleted_keyword_rules" RENAME TO "keyword_rules";

-- leave_requests
ALTER TABLE "zz_deleted_leave_requests" RENAME TO "leave_requests";

-- operational_checklists
ALTER TABLE "zz_deleted_operational_checklists" RENAME TO "operational_checklists";

-- operational_expenses
ALTER TABLE "zz_deleted_operational_expenses" RENAME TO "operational_expenses";

-- order_asuransi
ALTER TABLE "zz_deleted_order_asuransi" RENAME TO "order_asuransi";

-- otp_tokens
ALTER TABLE "zz_deleted_otp_tokens" RENAME TO "otp_tokens";

-- page_products
ALTER TABLE "zz_deleted_page_products" RENAME TO "page_products";

-- payment_receipts
ALTER TABLE "zz_deleted_payment_receipts" RENAME TO "payment_receipts";

-- promo_registrations
ALTER TABLE "zz_deleted_promo_registrations" RENAME TO "promo_registrations";

-- public_tokens
ALTER TABLE "zz_deleted_public_tokens" RENAME TO "public_tokens";

-- registration_link_wa_log
ALTER TABLE "zz_deleted_registration_link_wa_log" RENAME TO "registration_link_wa_log";

-- sc_admin_notes
ALTER TABLE "zz_deleted_sc_admin_notes" RENAME TO "sc_admin_notes";

-- sc_blocked_schedules
ALTER TABLE "zz_deleted_sc_blocked_schedules" RENAME TO "sc_blocked_schedules";

-- sc_facility_images
ALTER TABLE "zz_deleted_sc_facility_images" RENAME TO "sc_facility_images";

-- sc_promos
ALTER TABLE "zz_deleted_sc_promos" RENAME TO "sc_promos";

-- sc_settings
ALTER TABLE "zz_deleted_sc_settings" RENAME TO "sc_settings";

-- service_catalog
ALTER TABLE "zz_deleted_service_catalog" RENAME TO "service_catalog";

-- service_circuit_states
ALTER TABLE "zz_deleted_service_circuit_states" RENAME TO "service_circuit_states";

-- service_registry
ALTER TABLE "zz_deleted_service_registry" RENAME TO "service_registry";

-- shipment_events
ALTER TABLE "zz_deleted_shipment_events" RENAME TO "shipment_events";

-- shipment_trackings
ALTER TABLE "zz_deleted_shipment_trackings" RENAME TO "shipment_trackings";

-- shipments
ALTER TABLE "zz_deleted_shipments" RENAME TO "shipments";

-- sport_center_expenses
ALTER TABLE "zz_deleted_sport_center_expenses" RENAME TO "sport_center_expenses";

-- system_settings
ALTER TABLE "zz_deleted_system_settings" RENAME TO "system_settings";

-- task_assignments
ALTER TABLE "zz_deleted_task_assignments" RENAME TO "task_assignments";

-- task_attachments
ALTER TABLE "zz_deleted_task_attachments" RENAME TO "task_attachments";

-- task_comments
ALTER TABLE "zz_deleted_task_comments" RENAME TO "task_comments";

-- task_timeline
ALTER TABLE "zz_deleted_task_timeline" RENAME TO "task_timeline";

-- team_members
ALTER TABLE "zz_deleted_team_members" RENAME TO "team_members";

-- user_site_access
ALTER TABLE "zz_deleted_user_site_access" RENAME TO "user_site_access";

-- wa_send_logs
ALTER TABLE "zz_deleted_wa_send_logs" RENAME TO "wa_send_logs";

-- whatsapp_messages
ALTER TABLE "zz_deleted_whatsapp_messages" RENAME TO "whatsapp_messages";

-- whatsapp_notifications
ALTER TABLE "zz_deleted_whatsapp_notifications" RENAME TO "whatsapp_notifications";

-- ============================================================================
-- Setelah rollback: jalankan audit ulang untuk re-evaluasi
-- node scripts/audit-unused-supabase-tables.mjs
-- node scripts/pre-delete-impact-analysis.mjs
-- ============================================================================
