# Supabase Table Cleanup Audit
> Dibuat oleh `scripts/audit-unused-supabase-tables.mjs` — 2026-06-23

## Ringkasan Eksekutif

| Kategori | Jumlah |
|----------|-------:|
| ✅ KEEP | **380** |
| 🔀 MERGE | **0** |
| 📦 ARCHIVE | **25** |
| 🗑️ DELETE_CANDIDATE | **52** |
| **Total** | **457** |

> **FK↓** = FK masuk (tabel lain mengacu ke tabel ini)
> **FK↑** = FK keluar (tabel ini mengacu ke tabel lain)
> ⚠️ DELETE_CANDIDATE dengan FK masuk: **0** — jangan drop sebelum investigasi FK
> ⚠️ DELETE_CANDIDATE dengan data: **7** — backup dulu

## Rekomendasi Langkah Selanjutnya

1. **Review ARCHIVE**: Konfirmasi apakah data perlu dipindahkan sebelum drop. Buat archive schema jika perlu.
2. **Review MERGE**: Evaluasi apakah tabel tambahan bisa konsolidasi ke tabel accounting pusat.
3. **Uncomment DELETE_CANDIDATE**: Buka `migrations/cleanup-unused-tables.review.sql`, uncomment dan jalankan hanya setelah konfirmasi penuh.
4. **Selalu pg_dump production** sebelum menjalankan DROP apapun.
5. **Maintenance window**: Jalankan cleanup di luar jam operasional.

---

## ✅ KEEP — Pertahankan (380)

| Tabel | Rows | FK↓ | FK↑ | Idx | Status | Risiko | Alasan |
|-------|-----:|----:|----:|----:|--------|--------|--------|
| `__drizzle_migrations` | 5 | 0 | 0 | 1 | ✅ KEEP | 🔴 CRITICAL | Tabel system/migration internal |
| `accounting_entries` | 9 | 5 | 2 | 9 | ✅ KEEP | 🔴 CRITICAL | Tabel accounting pusat — wajib dipertahankan |
| `accounting_entry_lines` | 17 | 0 | 2 | 3 | ✅ KEEP | 🔴 CRITICAL | Tabel accounting pusat — wajib dipertahankan |
| `accounting_journals` | 28 | 6 | 2 | 2 | ✅ KEEP | 🔴 CRITICAL | Tabel accounting pusat — wajib dipertahankan |
| `accounting_payments` | 6 | 0 | 3 | 4 | ✅ KEEP | 🔴 CRITICAL | Tabel accounting pusat — wajib dipertahankan |
| `accounting_settings` | 4 | 0 | 16 | 1 | ✅ KEEP | 🔴 CRITICAL | Tabel accounting pusat — wajib dipertahankan |
| `accounting_taxes` | 48 | 5 | 2 | 1 | ✅ KEEP | 🔴 CRITICAL | Tabel accounting pusat — wajib dipertahankan |
| `activity` | 0 | 0 | 0 | 1 | ✅ KEEP | 🟡 MEDIUM | Dipakai di kode |
| `activity_logs` | 0 | 0 | 0 | 3 | ✅ KEEP | 🟡 MEDIUM | Dipakai di kode |
| `admin_action_links` | 0 | 0 | 0 | 0 | ✅ KEEP | 🟡 MEDIUM | Dipakai di kode |
| `admin_notes` | 0 | 0 | 0 | 0 | ✅ KEEP | 🟡 MEDIUM | Dipakai di kode |
| `admin_notifications` | 17 | 0 | 0 | 4 | ✅ KEEP | 🟡 MEDIUM | Dipakai di kode |
| `ai_agent_executions` | 0 | 0 | 1 | 8 | ✅ KEEP | 🟡 MEDIUM | Dipakai di kode |
| `ai_agent_settings` | 0 | 0 | 0 | 2 | ✅ KEEP | 🟡 MEDIUM | Dipakai di kode |
| `ai_approval_queue` | 0 | 1 | 0 | 8 | ✅ KEEP | 🟡 MEDIUM | Dipakai di kode |
| `ai_chat_messages` | 0 | 0 | 1 | 1 | ✅ KEEP | 🟡 MEDIUM | Dipakai di kode |
| `ai_chat_sessions` | 0 | 1 | 1 | 2 | ✅ KEEP | 🟡 MEDIUM | Dipakai di kode |
| `ai_decision_memory` | 0 | 0 | 0 | 5 | ✅ KEEP | 🟡 MEDIUM | Dipakai di kode |
| `air_freight_rates` | 3 | 0 | 0 | 3 | ✅ KEEP | 🟡 MEDIUM | Dipakai di kode |
| `air_freight_tracking_events` | 0 | 0 | 0 | 1 | ✅ KEEP | 🟡 MEDIUM | Dipakai di kode |
| `ap_subledger` | 0 | 0 | 0 | 3 | ✅ KEEP | 🔴 CRITICAL | Tabel accounting pusat — wajib dipertahankan |
| `api_response_times` | 0 | 0 | 0 | 1 | ✅ KEEP | 🟡 MEDIUM | Dipakai di kode |
| `app_config` | 2 | 0 | 0 | 1 | ✅ KEEP | 🟡 MEDIUM | Dipakai di kode |
| `approval_requests` | 0 | 0 | 0 | 4 | ✅ KEEP | 🟡 MEDIUM | Dipakai di kode |
| `approval_rules` | 0 | 0 | 3 | 3 | ✅ KEEP | 🟡 MEDIUM | Dipakai di kode |
| `ar_subledger` | 0 | 0 | 0 | 3 | ✅ KEEP | 🔴 CRITICAL | Tabel accounting pusat — wajib dipertahankan |
| `asset_depreciation` | 0 | 0 | 0 | 0 | ✅ KEEP | 🟡 MEDIUM | Dipakai di kode |
| `asset_depreciation_records` | 0 | 0 | 0 | 0 | ✅ KEEP | 🟡 MEDIUM | Dipakai di kode |
| `audit_accounting_events` | 50 | 0 | 0 | 6 | ✅ KEEP | 🔴 CRITICAL | Tabel accounting pusat — wajib dipertahankan |
| `audit_logs` | 235 | 0 | 0 | 6 | ✅ KEEP | 🔴 CRITICAL | Tabel accounting pusat — wajib dipertahankan |
| `bank_journal_entries` | 11 | 0 | 0 | 2 | ✅ KEEP | 🟡 MEDIUM | Dipakai di kode |
| `bank_loan_payments` | 0 | 0 | 0 | 0 | ✅ KEEP | 🟡 MEDIUM | Dipakai di kode |
| `bank_loans` | 0 | 0 | 0 | 0 | ✅ KEEP | 🟡 MEDIUM | Dipakai di kode |
| `bank_mutation_import_audit` | 0 | 0 | 1 | 4 | ✅ KEEP | 🟠 HIGH | Tabel modul aktif sebagai source data |
| `bank_mutation_import_batches` | 0 | 4 | 0 | 2 | ✅ KEEP | 🟠 HIGH | Tabel modul aktif sebagai source data |
| `bank_mutation_import_rows` | 0 | 0 | 1 | 2 | ✅ KEEP | 🟠 HIGH | Tabel modul aktif sebagai source data |
| `bank_mutation_imports` | 0 | 0 | 1 | 5 | ✅ KEEP | 🟠 HIGH | Tabel modul aktif sebagai source data |
| `bank_mutation_normalized_entries` | 0 | 0 | 1 | 9 | ✅ KEEP | 🟠 HIGH | Tabel modul aktif sebagai source data |
| `bank_mutations` | 0 | 1 | 1 | 4 | ✅ KEEP | 🟠 HIGH | Tabel modul aktif sebagai source data |
| `bank_reconciliation_audit` | 0 | 0 | 0 | 1 | ✅ KEEP | 🟡 MEDIUM | Dipakai di kode |
| `bank_reconciliation_matches` | 0 | 0 | 1 | 3 | ✅ KEEP | 🟡 MEDIUM | Dipakai di kode |
| `blocked_schedules` | 0 | 0 | 0 | 0 | ✅ KEEP | 🟡 MEDIUM | Dipakai di kode |
| `bookings` | 0 | 0 | 0 | 0 | ✅ KEEP | 🟡 MEDIUM | Dipakai di kode |
| `branches` | 8 | 5 | 1 | 3 | ✅ KEEP | 🔴 CRITICAL | Tabel accounting pusat — wajib dipertahankan |
| `cart_items` | 0 | 0 | 0 | 1 | ✅ KEEP | 🟡 MEDIUM | Dipakai di kode |
| `cash_advance_repayments` | 0 | 0 | 0 | 2 | ✅ KEEP | 🟠 HIGH | Tabel modul aktif sebagai source data |
| `cash_advances` | 0 | 0 | 0 | 6 | ✅ KEEP | 🟠 HIGH | Tabel modul aktif sebagai source data |
| `chart_of_accounts` | 285 | 24 | 0 | 3 | ✅ KEEP | 🔴 CRITICAL | Tabel accounting pusat — wajib dipertahankan |
| `chatbot_knowledge_base` | 0 | 0 | 0 | 1 | ✅ KEEP | 🟡 MEDIUM | Dipakai di kode |
| `commodity_checklists` | 25 | 0 | 1 | 2 | ✅ KEEP | 🟡 MEDIUM | Dipakai di kode |
| `commodity_required_docs` | 24 | 0 | 1 | 2 | ✅ KEEP | 🟡 MEDIUM | Dipakai di kode |
| `commodity_template_fields` | 29 | 0 | 1 | 2 | ✅ KEEP | 🟡 MEDIUM | Dipakai di kode |
| `commodity_templates` | 5 | 4 | 0 | 2 | ✅ KEEP | 🟡 MEDIUM | Dipakai di kode |
| `companies` | 4 | 42 | 0 | 2 | ✅ KEEP | 🔴 CRITICAL | Tabel accounting pusat — wajib dipertahankan |
| `company_holding_members` | 4 | 0 | 1 | 2 | ✅ KEEP | 🟡 MEDIUM | Dipakai di kode |
| `conversations` | 0 | 1 | 0 | 1 | ✅ KEEP | 🟡 MEDIUM | Dipakai di kode |
| `correspondence_attachments` | 0 | 0 | 0 | 1 | ✅ KEEP | 🟡 MEDIUM | Dipakai di kode |
| `correspondences` | 0 | 0 | 1 | 2 | ✅ KEEP | 🟡 MEDIUM | Dipakai di kode |
| `cost_centers` | 5 | 1 | 0 | 2 | ✅ KEEP | 🔴 CRITICAL | Tabel accounting pusat — wajib dipertahankan |
| `currency_rates` | 10 | 0 | 0 | 2 | ✅ KEEP | 🟡 MEDIUM | Dipakai di kode |
| `custom_roles` | 2 | 3 | 2 | 1 | ✅ KEEP | 🟡 MEDIUM | Dipakai di kode |
| `customer_approvals` | 0 | 0 | 0 | 4 | ✅ KEEP | 🟡 MEDIUM | Dipakai di kode |
| `customer_invoice_links` | 0 | 0 | 0 | 5 | ✅ KEEP | 🟡 MEDIUM | Dipakai di kode |
| `customer_order_links` | 0 | 0 | 1 | 2 | ✅ KEEP | 🟡 MEDIUM | Dipakai di kode |
| `customer_quote_links` | 0 | 0 | 2 | 2 | ✅ KEEP | 🟡 MEDIUM | Dipakai di kode |
| `customer_quote_responses` | 0 | 0 | 1 | 1 | ✅ KEEP | 🟡 MEDIUM | Dipakai di kode |
| `customer_service_request_documents` | 0 | 0 | 0 | 1 | ✅ KEEP | 🟡 MEDIUM | Dipakai di kode |
| `customer_service_request_items` | 0 | 0 | 0 | 1 | ✅ KEEP | 🟡 MEDIUM | Dipakai di kode |
| `customer_service_requests` | 0 | 0 | 0 | 2 | ✅ KEEP | 🟡 MEDIUM | Dipakai di kode |
| `customer_verification_documents` | 0 | 0 | 1 | 1 | ✅ KEEP | 🟡 MEDIUM | Dipakai di kode |
| `customers` | 1 | 1 | 1 | 2 | ✅ KEEP | 🟡 MEDIUM | Dipakai di kode |
| `departments` | 33 | 0 | 3 | 5 | ✅ KEEP | 🟡 MEDIUM | Dipakai di kode |
| `divisions` | 13 | 4 | 3 | 4 | ✅ KEEP | 🟡 MEDIUM | Dipakai di kode |
| `documents` | 0 | 0 | 0 | 1 | ✅ KEEP | 🟡 MEDIUM | Dipakai di kode |
| `driver_job_logs` | 0 | 0 | 1 | 1 | ✅ KEEP | 🟡 MEDIUM | Dipakai di kode |
| `driver_jobs` | 0 | 2 | 3 | 3 | ✅ KEEP | 🟡 MEDIUM | Dipakai di kode |
| `driver_photos` | 0 | 0 | 1 | 1 | ✅ KEEP | 🟡 MEDIUM | Dipakai di kode |
| `driver_profiles` | 0 | 0 | 0 | 0 | ✅ KEEP | 🟡 MEDIUM | Dipakai di kode |
| `driver_progress_tokens` | 0 | 0 | 0 | 2 | ✅ KEEP | 🟡 MEDIUM | Dipakai di kode |
| `drivers` | 2 | 1 | 1 | 3 | ✅ KEEP | 🟡 MEDIUM | Dipakai di kode |
| `elimination_runs` | 0 | 1 | 0 | 2 | ✅ KEEP | 🔴 CRITICAL | Tabel accounting pusat — wajib dipertahankan |
| `email_attachments` | 0 | 0 | 0 | 1 | ✅ KEEP | 🟡 MEDIUM | Dipakai di kode |
| `email_correspondences` | 0 | 0 | 0 | 2 | ✅ KEEP | 🟡 MEDIUM | Dipakai di kode |
| `email_links` | 0 | 0 | 0 | 1 | ✅ KEEP | 🟡 MEDIUM | Dipakai di kode |
| `employee_profiles` | 0 | 0 | 0 | 0 | ✅ KEEP | 🟡 MEDIUM | Dipakai di kode |
| `erp_audit_logs` | 173 | 0 | 0 | 8 | ✅ KEEP | 🟡 MEDIUM | Dipakai di kode |
| `erp_audit_reports` | 0 | 1 | 0 | 2 | ✅ KEEP | 🟡 MEDIUM | Dipakai di kode |
| `erp_audit_responses` | 0 | 0 | 1 | 2 | ✅ KEEP | 🟡 MEDIUM | Dipakai di kode |
| `exceptions` | 0 | 0 | 0 | 0 | ✅ KEEP | 🟡 MEDIUM | Dipakai di kode |
| `expense_approval_limits` | 0 | 0 | 0 | 1 | ✅ KEEP | 🟡 MEDIUM | Dipakai di kode |
| `expense_approval_requests` | 0 | 0 | 0 | 1 | ✅ KEEP | 🟡 MEDIUM | Dipakai di kode |
| `expense_attachments` | 0 | 0 | 0 | 1 | ✅ KEEP | 🟡 MEDIUM | Dipakai di kode |
| `expense_audit_log` | 0 | 0 | 0 | 3 | ✅ KEEP | 🟡 MEDIUM | Dipakai di kode |
| `expense_budgets` | 0 | 0 | 0 | 4 | ✅ KEEP | 🟡 MEDIUM | Dipakai di kode |
| `expense_categories` | 24 | 1 | 5 | 2 | ✅ KEEP | 🟡 MEDIUM | Dipakai di kode |
| `expense_reminders` | 0 | 0 | 0 | 3 | ✅ KEEP | 🟡 MEDIUM | Dipakai di kode |
| `expense_templates` | 0 | 0 | 0 | 1 | ✅ KEEP | 🟡 MEDIUM | Dipakai di kode |
| `expenses` | 0 | 0 | 6 | 6 | ✅ KEEP | 🟡 MEDIUM | Dipakai di kode |
| `facilities` | 0 | 0 | 0 | 0 | ✅ KEEP | 🟡 MEDIUM | Dipakai di kode |
| `facility_images` | 0 | 0 | 0 | 0 | ✅ KEEP | 🟡 MEDIUM | Dipakai di kode |
| `finance_anomaly_log` | 0 | 0 | 0 | 4 | ✅ KEEP | 🔴 CRITICAL | Tabel accounting pusat — wajib dipertahankan |
| `finance_audit_trail` | 0 | 0 | 0 | 5 | ✅ KEEP | 🔴 CRITICAL | Tabel accounting pusat — wajib dipertahankan |
| `financial_closings` | 0 | 0 | 0 | 3 | ✅ KEEP | 🔴 CRITICAL | Tabel accounting pusat — wajib dipertahankan |
| `financial_event_bus` | 25 | 0 | 0 | 4 | ✅ KEEP | 🟡 MEDIUM | Dipakai di kode |
| `financial_periods` | 0 | 0 | 0 | 4 | ✅ KEEP | 🔴 CRITICAL | Tabel accounting pusat — wajib dipertahankan |
| `financial_reconciliation_reports` | 0 | 0 | 0 | 3 | ✅ KEEP | 🟡 MEDIUM | Dipakai di kode |
| `fixed_assets` | 0 | 0 | 0 | 0 | ✅ KEEP | 🟡 MEDIUM | Dipakai di kode |
| `fleet_alert_suppression` | 7 | 0 | 0 | 2 | ✅ KEEP | 🟠 HIGH | Tabel modul aktif sebagai source data |
| `fleet_alerts` | 7 | 0 | 1 | 4 | ✅ KEEP | 🟠 HIGH | Tabel modul aktif sebagai source data |
| `fleet_daily_summary` | 22 | 0 | 1 | 3 | ✅ KEEP | 🟠 HIGH | Tabel modul aktif sebagai source data |
| `fleet_drivers` | 31 | 6 | 1 | 6 | ✅ KEEP | 🟠 HIGH | Tabel modul aktif sebagai source data |
| `fleet_outstanding` | 31 | 1 | 1 | 5 | ✅ KEEP | 🟠 HIGH | Tabel modul aktif sebagai source data |
| `fleet_reports` | 1 | 13 | 1 | 4 | ✅ KEEP | 🟠 HIGH | Tabel modul aktif sebagai source data |
| `fleet_transactions` | 1,310 | 0 | 3 | 7 | ✅ KEEP | 🟠 HIGH | Tabel modul aktif sebagai source data |
| `freight_attachments` | 0 | 0 | 1 | 1 | ✅ KEEP | 🟡 MEDIUM | Dipakai di kode |
| `freight_carriers` | 15 | 0 | 0 | 2 | ✅ KEEP | 🟡 MEDIUM | Dipakai di kode |
| `freight_container_types` | 9 | 0 | 0 | 2 | ✅ KEEP | 🟡 MEDIUM | Dipakai di kode |
| `freight_customs_docs` | 0 | 0 | 1 | 1 | ✅ KEEP | 🟡 MEDIUM | Dipakai di kode |
| `freight_ports` | 22 | 0 | 0 | 2 | ✅ KEEP | 🟡 MEDIUM | Dipakai di kode |
| `freight_quotes` | 0 | 0 | 1 | 1 | ✅ KEEP | 🟡 MEDIUM | Dipakai di kode |
| `freight_rfqs` | 0 | 1 | 1 | 2 | ✅ KEEP | 🟡 MEDIUM | Dipakai di kode |
| `freight_shipment_audit_logs` | 0 | 0 | 2 | 2 | ✅ KEEP | 🟡 MEDIUM | Dipakai di kode |
| `freight_shipments` | 0 | 6 | 3 | 2 | ✅ KEEP | 🟡 MEDIUM | Dipakai di kode |
| `gl_elimination_entries` | 0 | 0 | 1 | 2 | ✅ KEEP | 🔴 CRITICAL | Tabel accounting pusat — wajib dipertahankan |
| `gl_journal_bridge` | 0 | 0 | 1 | 3 | ✅ KEEP | 🔴 CRITICAL | Tabel accounting pusat — wajib dipertahankan |
| `gl_tax_lines` | 0 | 0 | 0 | 2 | ✅ KEEP | 🔴 CRITICAL | Tabel accounting pusat — wajib dipertahankan |
| `gojek_failed_rows` | 0 | 0 | 3 | 4 | ✅ KEEP | 🟠 HIGH | Tabel modul aktif sebagai source data |
| `gojek_ingestion_queue` | 1 | 0 | 2 | 6 | ✅ KEEP | 🟠 HIGH | Tabel modul aktif sebagai source data |
| `gojek_ingestion_reports` | 0 | 0 | 2 | 3 | ✅ KEEP | 🟠 HIGH | Tabel modul aktif sebagai source data |
| `gojek_pipeline_audit_logs` | 1,310 | 0 | 3 | 4 | ✅ KEEP | 🟠 HIGH | Tabel modul aktif sebagai source data |
| `gojek_raw_transactions` | 1,310 | 4 | 1 | 7 | ✅ KEEP | 🟠 HIGH | Tabel modul aktif sebagai source data |
| `gojek_uploaded_files` | 1 | 0 | 2 | 3 | ✅ KEEP | 🟠 HIGH | Tabel modul aktif sebagai source data |
| `goods_receipt_lines` | 0 | 0 | 2 | 1 | ✅ KEEP | 🟡 MEDIUM | Dipakai di kode |
| `goods_receipts` | 0 | 0 | 4 | 3 | ✅ KEEP | 🟡 MEDIUM | Dipakai di kode |
| `holding_groups` | 1 | 1 | 0 | 2 | ✅ KEEP | 🟡 MEDIUM | Dipakai di kode |
| `identity_documents` | 0 | 0 | 0 | 0 | ✅ KEEP | 🟡 MEDIUM | Dipakai di kode |
| `integrity_audit_queue` | 0 | 0 | 0 | 3 | ✅ KEEP | 🟡 MEDIUM | Dipakai di kode |
| `intelligence_alert_settings` | 0 | 0 | 0 | 2 | ✅ KEEP | 🟡 MEDIUM | Dipakai di kode |
| `intelligence_alerts` | 0 | 0 | 0 | 2 | ✅ KEEP | 🟡 MEDIUM | Dipakai di kode |
| `intercompany_mirrors` | 0 | 0 | 0 | 3 | ✅ KEEP | 🔴 CRITICAL | Tabel accounting pusat — wajib dipertahankan |
| `intercompany_transactions` | 0 | 0 | 0 | 3 | ✅ KEEP | 🔴 CRITICAL | Tabel accounting pusat — wajib dipertahankan |
| `internal_tasks` | 0 | 0 | 1 | 1 | ✅ KEEP | 🟡 MEDIUM | Dipakai di kode |
| `inventory_stock` | 0 | 0 | 1 | 0 | ✅ KEEP | 🟡 MEDIUM | Dipakai di kode |
| `invoice_reminder_logs` | 0 | 0 | 0 | 2 | ✅ KEEP | 🟡 MEDIUM | Dipakai di kode |
| `journal_approval_logs` | 0 | 0 | 0 | 4 | ✅ KEEP | 🔴 CRITICAL | Tabel accounting pusat — wajib dipertahankan |
| `journal_approval_workflow` | 0 | 0 | 0 | 3 | ✅ KEEP | 🔴 CRITICAL | Tabel accounting pusat — wajib dipertahankan |
| `journal_sequences` | 3 | 0 | 0 | 1 | ✅ KEEP | 🔴 CRITICAL | Tabel accounting pusat — wajib dipertahankan |
| `kasir_bom_ingredients` | 318 | 0 | 2 | 1 | ✅ KEEP | 🟠 HIGH | Tabel kasir/POS lama — ada data operasional |
| `kasir_bom_recipes` | 84 | 1 | 1 | 1 | ✅ KEEP | 🟠 HIGH | Tabel kasir/POS lama — ada data operasional |
| `kasir_branches` | 6 | 6 | 1 | 3 | ✅ KEEP | 🟠 HIGH | Tabel kasir/POS lama — ada data operasional |
| `kasir_categories` | 40 | 1 | 0 | 1 | ✅ KEEP | 🟠 HIGH | Tabel kasir/POS lama — ada data operasional |
| `kasir_companies` | 14 | 1 | 0 | 1 | ✅ KEEP | 🟠 HIGH | Tabel kasir/POS lama — ada data operasional |
| `kasir_devices` | 4 | 0 | 1 | 4 | ✅ KEEP | 🟠 HIGH | Tabel kasir/POS lama — ada data operasional |
| `kasir_ingredients` | 353 | 2 | 1 | 2 | ✅ KEEP | 🟠 HIGH | Tabel kasir/POS lama — ada data operasional |
| `kasir_products` | 174 | 1 | 1 | 2 | ✅ KEEP | 🟠 HIGH | Tabel kasir/POS lama — ada data operasional |
| `kasir_shifts` | 10 | 1 | 2 | 1 | ✅ KEEP | 🟠 HIGH | Tabel kasir/POS lama — ada data operasional |
| `kasir_stock_movements` | 0 | 0 | 2 | 1 | ✅ KEEP | 🟠 HIGH | Tabel kasir/POS lama — ada data operasional |
| `kasir_stock_transfers` | 0 | 0 | 0 | 0 | ✅ KEEP | 🟠 HIGH | Tabel kasir/POS lama — ada data operasional |
| `kasir_sync_queue` | 0 | 0 | 0 | 1 | ✅ KEEP | 🟠 HIGH | Tabel kasir/POS lama — ada data operasional |
| `kasir_transactions` | 15 | 0 | 3 | 3 | ✅ KEEP | 🟠 HIGH | Tabel kasir/POS lama — ada data operasional |
| `kasir_users` | 12 | 2 | 1 | 3 | ✅ KEEP | 🟠 HIGH | Tabel kasir/POS lama — ada data operasional |
| `landed_cost_allocations` | 0 | 0 | 1 | 1 | ✅ KEEP | 🟡 MEDIUM | Dipakai di kode |
| `landed_cost_lines` | 0 | 0 | 1 | 1 | ✅ KEEP | 🟡 MEDIUM | Dipakai di kode |
| `landed_costs` | 0 | 0 | 2 | 2 | ✅ KEEP | 🟡 MEDIUM | Dipakai di kode |
| `ledger_entries` | 0 | 0 | 4 | 5 | ✅ KEEP | 🔴 CRITICAL | Tabel accounting pusat — wajib dipertahankan |
| `ledger_events` | 0 | 0 | 2 | 7 | ✅ KEEP | 🔴 CRITICAL | Tabel accounting pusat — wajib dipertahankan |
| `ledger_snapshots` | 0 | 0 | 1 | 5 | ✅ KEEP | 🔴 CRITICAL | Tabel accounting pusat — wajib dipertahankan |
| `ledger_transaction_rules` | 0 | 0 | 0 | 2 | ✅ KEEP | 🔴 CRITICAL | Tabel accounting pusat — wajib dipertahankan |
| `logistic_customer_data_tokens` | 0 | 0 | 0 | 2 | ✅ KEEP | 🟡 MEDIUM | Dipakai di kode |
| `logistic_order_items` | 0 | 1 | 2 | 1 | ✅ KEEP | 🟠 HIGH | Tabel modul aktif sebagai source data |
| `logistic_order_quotes` | 0 | 0 | 3 | 3 | ✅ KEEP | 🟠 HIGH | Tabel modul aktif sebagai source data |
| `logistic_order_rfqs` | 0 | 3 | 1 | 3 | ✅ KEEP | 🟠 HIGH | Tabel modul aktif sebagai source data |
| `logistic_order_vendor_tracking` | 0 | 0 | 0 | 2 | ✅ KEEP | 🟠 HIGH | Tabel modul aktif sebagai source data |
| `logistic_order_vendor_tracking_logs` | 0 | 0 | 0 | 1 | ✅ KEEP | 🟠 HIGH | Tabel modul aktif sebagai source data |
| `logistic_orders` | 0 | 20 | 4 | 14 | ✅ KEEP | 🟠 HIGH | Tabel modul aktif sebagai source data |
| `logistic_vendor_fulfillments` | 0 | 0 | 3 | 4 | ✅ KEEP | 🟠 HIGH | Tabel modul aktif sebagai source data |
| `logistics_rate_cards` | 0 | 1 | 0 | 1 | ✅ KEEP | 🟡 MEDIUM | Dipakai di kode |
| `logistics_service_rates` | 0 | 0 | 1 | 1 | ✅ KEEP | 🟡 MEDIUM | Dipakai di kode |
| `logistics_surcharges` | 0 | 0 | 0 | 1 | ✅ KEEP | 🟡 MEDIUM | Dipakai di kode |
| `logistics_units` | 10 | 0 | 0 | 2 | ✅ KEEP | 🟡 MEDIUM | Dipakai di kode |
| `mall_sites` | 2 | 5 | 0 | 3 | ✅ KEEP | 🟡 MEDIUM | Dipakai di kode |
| `mall_units` | 27 | 0 | 1 | 4 | ✅ KEEP | 🟡 MEDIUM | Dipakai di kode |
| `margin_rules` | 0 | 0 | 0 | 1 | ✅ KEEP | 🟡 MEDIUM | Dipakai di kode |
| `master_bank_accounts` | 1,819 | 0 | 0 | 2 | ✅ KEEP | 🔴 CRITICAL | Tabel accounting pusat — wajib dipertahankan |
| `master_coa_mapping` | 30 | 0 | 0 | 3 | ✅ KEEP | 🟡 MEDIUM | Dipakai di kode |
| `master_coa_mapping_versioned` | 30 | 0 | 0 | 2 | ✅ KEEP | 🟡 MEDIUM | Dipakai di kode |
| `master_entities` | 0 | 0 | 0 | 2 | ✅ KEEP | 🟡 MEDIUM | Dipakai di kode |
| `master_entity_review` | 0 | 0 | 0 | 2 | ✅ KEEP | 🟡 MEDIUM | Dipakai di kode |
| `master_tax_mapping` | 5 | 0 | 0 | 2 | ✅ KEEP | 🟡 MEDIUM | Dipakai di kode |
| `media_assets` | 0 | 0 | 0 | 1 | ✅ KEEP | 🟡 MEDIUM | Dipakai di kode |
| `messages` | 0 | 0 | 1 | 1 | ✅ KEEP | 🟡 MEDIUM | Dipakai di kode |
| `notification_logs` | 10 | 0 | 0 | 9 | ✅ KEEP | 🟡 MEDIUM | Dipakai di kode |
| `oauth_states` | 2 | 0 | 0 | 2 | ✅ KEEP | 🔴 CRITICAL | Tabel system/migration internal |
| `ocean_freight_rates` | 49 | 0 | 0 | 2 | ✅ KEEP | 🟡 MEDIUM | Dipakai di kode |
| `ocean_freight_route_matrix` | 26 | 0 | 0 | 2 | ✅ KEEP | 🟡 MEDIUM | Dipakai di kode |
| `ocr_results` | 0 | 0 | 0 | 0 | ✅ KEEP | 🟡 MEDIUM | Dipakai di kode |
| `onboarding_approvals` | 0 | 0 | 0 | 0 | ✅ KEEP | 🟡 MEDIUM | Dipakai di kode |
| `order_fulfillment_links` | 0 | 1 | 2 | 4 | ✅ KEEP | 🟡 MEDIUM | Dipakai di kode |
| `order_fulfillment_submissions` | 0 | 0 | 2 | 3 | ✅ KEEP | 🟡 MEDIUM | Dipakai di kode |
| `order_items` | 49 | 0 | 0 | 1 | ✅ KEEP | 🟡 MEDIUM | Dipakai di kode |
| `order_pod_submissions` | 0 | 0 | 1 | 2 | ✅ KEEP | 🟡 MEDIUM | Dipakai di kode |
| `order_progress_events` | 0 | 0 | 1 | 4 | ✅ KEEP | 🟡 MEDIUM | Dipakai di kode |
| `order_stage_logs` | 0 | 0 | 1 | 2 | ✅ KEEP | 🟡 MEDIUM | Dipakai di kode |
| `order_status_history` | 0 | 0 | 0 | 0 | ✅ KEEP | 🟡 MEDIUM | Dipakai di kode |
| `order_task_links` | 0 | 0 | 2 | 2 | ✅ KEEP | 🟡 MEDIUM | Dipakai di kode |
| `order_tracking_progress` | 0 | 0 | 0 | 0 | ✅ KEEP | 🟡 MEDIUM | Dipakai di kode |
| `order_updates` | 0 | 0 | 1 | 1 | ✅ KEEP | 🟡 MEDIUM | Dipakai di kode |
| `orders` | 19 | 0 | 0 | 2 | ✅ KEEP | 🟡 MEDIUM | Dipakai di kode |
| `pages` | 0 | 1 | 0 | 2 | ✅ KEEP | 🟡 MEDIUM | Dipakai di kode |
| `payment_request_items` | 0 | 0 | 0 | 1 | ✅ KEEP | 🟡 MEDIUM | Dipakai di kode |
| `payment_requests` | 0 | 0 | 2 | 2 | ✅ KEEP | 🟡 MEDIUM | Dipakai di kode |
| `payments` | 0 | 0 | 0 | 2 | ✅ KEEP | 🟡 MEDIUM | Dipakai di kode |
| `payroll` | 1 | 0 | 0 | 1 | ✅ KEEP | 🟠 HIGH | Tabel modul aktif sebagai source data |
| `payroll_items` | 14 | 0 | 0 | 1 | ✅ KEEP | 🟠 HIGH | Tabel modul aktif sebagai source data |
| `payroll_runs` | 3 | 0 | 1 | 3 | ✅ KEEP | 🟠 HIGH | Tabel modul aktif sebagai source data |
| `portal_content` | 2 | 0 | 0 | 2 | ✅ KEEP | 🟡 MEDIUM | Dipakai di kode |
| `portal_customer_profiles` | 0 | 1 | 0 | 1 | ✅ KEEP | 🟡 MEDIUM | Dipakai di kode |
| `portal_customer_services` | 0 | 0 | 0 | 1 | ✅ KEEP | 🟡 MEDIUM | Dipakai di kode |
| `portal_customers` | 8 | 0 | 0 | 2 | ✅ KEEP | 🟡 MEDIUM | Dipakai di kode |
| `portal_product_order_items` | 0 | 0 | 2 | 1 | ✅ KEEP | 🟡 MEDIUM | Dipakai di kode |
| `portal_product_orders` | 0 | 1 | 0 | 2 | ✅ KEEP | 🟡 MEDIUM | Dipakai di kode |
| `portal_product_vendor_responses` | 0 | 0 | 0 | 1 | ✅ KEEP | 🟡 MEDIUM | Dipakai di kode |
| `pos_audit_logs` | 0 | 0 | 0 | 0 | ✅ KEEP | 🟠 HIGH | Tabel POS sistem baru — aktif |
| `pos_branches` | 3 | 20 | 1 | 2 | ✅ KEEP | 🟠 HIGH | Tabel POS sistem baru — aktif |
| `pos_cashiers` | 1 | 4 | 1 | 3 | ✅ KEEP | 🟠 HIGH | Tabel POS sistem baru — aktif |
| `pos_inventory_items` | 10 | 13 | 0 | 2 | ✅ KEEP | 🟠 HIGH | Tabel POS sistem baru — aktif |
| `pos_inventory_stocks` | 10 | 0 | 8 | 1 | ✅ KEEP | 🟠 HIGH | Tabel POS sistem baru — aktif |
| `pos_order_items` | 0 | 0 | 2 | 3 | ✅ KEEP | 🟠 HIGH | Tabel POS sistem baru — aktif |
| `pos_orders` | 0 | 1 | 2 | 6 | ✅ KEEP | 🟠 HIGH | Tabel POS sistem baru — aktif |
| `pos_products` | 10 | 3 | 1 | 1 | ✅ KEEP | 🟠 HIGH | Tabel POS sistem baru — aktif |
| `pos_qr_orders` | 0 | 0 | 0 | 0 | ✅ KEEP | 🟠 HIGH | Tabel POS sistem baru — aktif |
| `pos_racks` | 2 | 13 | 2 | 1 | ✅ KEEP | 🟠 HIGH | Tabel POS sistem baru — aktif |
| `pos_recipe_items` | 1 | 0 | 4 | 1 | ✅ KEEP | 🟠 HIGH | Tabel POS sistem baru — aktif |
| `pos_recipes` | 1 | 2 | 2 | 2 | ✅ KEEP | 🟠 HIGH | Tabel POS sistem baru — aktif |
| `pos_role_permissions` | 0 | 0 | 0 | 0 | ✅ KEEP | 🟠 HIGH | Tabel POS sistem baru — aktif |
| `pos_roles` | 0 | 0 | 0 | 0 | ✅ KEEP | 🟠 HIGH | Tabel POS sistem baru — aktif |
| `pos_settings` | 0 | 0 | 0 | 1 | ✅ KEEP | 🟠 HIGH | Tabel POS sistem baru — aktif |
| `pos_shifts` | 1 | 0 | 4 | 1 | ✅ KEEP | 🟠 HIGH | Tabel POS sistem baru — aktif |
| `pos_stock_adjustments` | 0 | 0 | 2 | 1 | ✅ KEEP | 🟠 HIGH | Tabel POS sistem baru — aktif |
| `pos_stock_items` | 0 | 2 | 1 | 1 | ✅ KEEP | 🟠 HIGH | Tabel POS sistem baru — aktif |
| `pos_stock_losses` | 0 | 0 | 3 | 2 | ✅ KEEP | 🟠 HIGH | Tabel POS sistem baru — aktif |
| `pos_stock_mutations` | 13 | 0 | 8 | 1 | ✅ KEEP | 🟠 HIGH | Tabel POS sistem baru — aktif |
| `pos_stock_opname_items` | 0 | 0 | 4 | 1 | ✅ KEEP | 🟠 HIGH | Tabel POS sistem baru — aktif |
| `pos_stock_opnames` | 0 | 2 | 4 | 2 | ✅ KEEP | 🟠 HIGH | Tabel POS sistem baru — aktif |
| `pos_stock_quarantine` | 0 | 0 | 4 | 1 | ✅ KEEP | 🟠 HIGH | Tabel POS sistem baru — aktif |
| `pos_stock_return_items` | 0 | 0 | 2 | 1 | ✅ KEEP | 🟠 HIGH | Tabel POS sistem baru — aktif |
| `pos_stock_returns` | 0 | 2 | 2 | 2 | ✅ KEEP | 🟠 HIGH | Tabel POS sistem baru — aktif |
| `pos_stock_transfer_items` | 1 | 0 | 8 | 1 | ✅ KEEP | 🟠 HIGH | Tabel POS sistem baru — aktif |
| `pos_stock_transfers` | 1 | 2 | 4 | 2 | ✅ KEEP | 🟠 HIGH | Tabel POS sistem baru — aktif |
| `pos_warehouses` | 4 | 29 | 2 | 1 | ✅ KEEP | 🟠 HIGH | Tabel POS sistem baru — aktif |
| `product_categories` | 8 | 1 | 0 | 2 | ✅ KEEP | 🟡 MEDIUM | Dipakai di kode |
| `product_category_map` | 12 | 0 | 2 | 1 | ✅ KEEP | 🟡 MEDIUM | Dipakai di kode |
| `product_first_reminder_logs` | 0 | 0 | 0 | 2 | ✅ KEEP | 🟡 MEDIUM | Dipakai di kode |
| `product_media` | 0 | 0 | 1 | 4 | ✅ KEEP | 🟡 MEDIUM | Dipakai di kode |
| `product_recipe_items` | 0 | 0 | 1 | 0 | ✅ KEEP | 🟡 MEDIUM | Dipakai di kode |
| `product_recipes` | 0 | 0 | 1 | 0 | ✅ KEEP | 🟡 MEDIUM | Dipakai di kode |
| `product_templates` | 19 | 0 | 0 | 2 | ✅ KEEP | 🟡 MEDIUM | Dipakai di kode |
| `products` | 12 | 24 | 3 | 3 | ✅ KEEP | 🟡 MEDIUM | Dipakai di kode |
| `promos` | 0 | 0 | 0 | 0 | ✅ KEEP | 🟡 MEDIUM | Dipakai di kode |
| `purchase_approvals` | 0 | 0 | 0 | 1 | ✅ KEEP | 🟡 MEDIUM | Dipakai di kode |
| `purchase_document_lines` | 3 | 1 | 2 | 3 | ✅ KEEP | 🟡 MEDIUM | Dipakai di kode |
| `purchase_documents` | 3 | 8 | 3 | 6 | ✅ KEEP | 🟡 MEDIUM | Dipakai di kode |
| `purchase_receipt_lines` | 0 | 0 | 3 | 1 | ✅ KEEP | 🟡 MEDIUM | Dipakai di kode |
| `purchase_receipts` | 0 | 0 | 2 | 2 | ✅ KEEP | 🟡 MEDIUM | Dipakai di kode |
| `purchase_request_lines` | 0 | 0 | 1 | 1 | ✅ KEEP | 🟡 MEDIUM | Dipakai di kode |
| `purchase_requests` | 0 | 0 | 2 | 2 | ✅ KEEP | 🟡 MEDIUM | Dipakai di kode |
| `purchase_return_lines` | 0 | 0 | 1 | 1 | ✅ KEEP | 🟡 MEDIUM | Dipakai di kode |
| `purchase_returns` | 0 | 0 | 4 | 2 | ✅ KEEP | 🟡 MEDIUM | Dipakai di kode |
| `push_subscriptions` | 0 | 0 | 0 | 3 | ✅ KEEP | 🟡 MEDIUM | Dipakai di kode |
| `qc_inspections` | 0 | 0 | 1 | 1 | ✅ KEEP | 🟡 MEDIUM | Dipakai di kode |
| `qc_lines` | 0 | 0 | 1 | 1 | ✅ KEEP | 🟡 MEDIUM | Dipakai di kode |
| `quotation_reply_logs` | 0 | 0 | 0 | 1 | ✅ KEEP | 🟡 MEDIUM | Dipakai di kode |
| `quotations` | 0 | 0 | 0 | 5 | ✅ KEEP | 🟡 MEDIUM | Dipakai di kode |
| `quote_requests` | 0 | 0 | 0 | 1 | ✅ KEEP | 🟡 MEDIUM | Dipakai di kode |
| `raw_materials` | 0 | 0 | 0 | 0 | ✅ KEEP | 🟡 MEDIUM | Dipakai di kode |
| `rbac_role_permissions` | 7,697 | 0 | 0 | 0 | ✅ KEEP | 🟡 MEDIUM | Dipakai di kode |
| `recipe_items` | 0 | 0 | 0 | 0 | ✅ KEEP | 🟡 MEDIUM | Dipakai di kode |
| `recipes` | 0 | 0 | 0 | 0 | ✅ KEEP | 🟡 MEDIUM | Dipakai di kode |
| `recurring_expenses` | 0 | 0 | 0 | 4 | ✅ KEEP | 🟡 MEDIUM | Dipakai di kode |
| `rfq_activity_logs` | 0 | 0 | 0 | 1 | ✅ KEEP | 🟡 MEDIUM | Dipakai di kode |
| `rfq_vendor_item_offers` | 0 | 0 | 1 | 1 | ✅ KEEP | 🟡 MEDIUM | Dipakai di kode |
| `rfq_vendor_links` | 0 | 1 | 2 | 4 | ✅ KEEP | 🟡 MEDIUM | Dipakai di kode |
| `sales_document_lines` | 6 | 0 | 4 | 1 | ✅ KEEP | 🟡 MEDIUM | Dipakai di kode |
| `sales_documents` | 4 | 2 | 3 | 5 | ✅ KEEP | 🟡 MEDIUM | Dipakai di kode |
| `schema_migrations` | 77 | 0 | 0 | 1 | ✅ KEEP | 🔴 CRITICAL | Tabel system/migration internal |
| `sections` | 7 | 1 | 0 | 4 | ✅ KEEP | 🟡 MEDIUM | Dipakai di kode |
| `service_package_items` | 24 | 0 | 0 | 1 | ✅ KEEP | 🟡 MEDIUM | Dipakai di kode |
| `service_packages` | 5 | 0 | 0 | 2 | ✅ KEEP | 🟡 MEDIUM | Dipakai di kode |
| `service_template_version_history` | 0 | 0 | 0 | 1 | ✅ KEEP | 🟡 MEDIUM | Dipakai di kode |
| `service_templates` | 17 | 0 | 0 | 4 | ✅ KEEP | 🟡 MEDIUM | Dipakai di kode |
| `sessions` | 167 | 0 | 0 | 2 | ✅ KEEP | 🔴 CRITICAL | Tabel system/migration internal |
| `settings` | 0 | 0 | 0 | 0 | ✅ KEEP | 🟡 MEDIUM | Dipakai di kode |
| `short_links` | 0 | 0 | 0 | 4 | ✅ KEEP | 🟡 MEDIUM | Dipakai di kode |
| `sport_audit_logs` | 0 | 0 | 0 | 1 | ✅ KEEP | 🟠 HIGH | Tabel modul aktif sebagai source data |
| `sport_blocked_schedules` | 0 | 0 | 1 | 1 | ✅ KEEP | 🟠 HIGH | Tabel modul aktif sebagai source data |
| `sport_bookings` | 4 | 3 | 3 | 6 | ✅ KEEP | 🟠 HIGH | Tabel modul aktif sebagai source data |
| `sport_company_clients` | 0 | 1 | 0 | 2 | ✅ KEEP | 🟠 HIGH | Tabel modul aktif sebagai source data |
| `sport_company_invoice_items` | 0 | 0 | 2 | 3 | ✅ KEEP | 🟠 HIGH | Tabel modul aktif sebagai source data |
| `sport_company_invoices` | 0 | 1 | 1 | 5 | ✅ KEEP | 🟠 HIGH | Tabel modul aktif sebagai source data |
| `sport_customers` | 0 | 3 | 0 | 1 | ✅ KEEP | 🟠 HIGH | Tabel modul aktif sebagai source data |
| `sport_expenses` | 0 | 0 | 1 | 6 | ✅ KEEP | 🟠 HIGH | Tabel modul aktif sebagai source data |
| `sport_facilities` | 5 | 5 | 0 | 1 | ✅ KEEP | 🟠 HIGH | Tabel modul aktif sebagai source data |
| `sport_maintenance_requests` | 0 | 0 | 1 | 3 | ✅ KEEP | 🟠 HIGH | Tabel modul aktif sebagai source data |
| `sport_member_reminder_logs` | 0 | 0 | 0 | 2 | ✅ KEEP | 🟠 HIGH | Tabel modul aktif sebagai source data |
| `sport_members` | 0 | 0 | 1 | 2 | ✅ KEEP | 🟠 HIGH | Tabel modul aktif sebagai source data |
| `sport_notifications` | 0 | 0 | 0 | 2 | ✅ KEEP | 🟠 HIGH | Tabel modul aktif sebagai source data |
| `sport_payments` | 3 | 1 | 1 | 1 | ✅ KEEP | 🟠 HIGH | Tabel modul aktif sebagai source data |
| `sport_pricing_rules` | 0 | 0 | 1 | 1 | ✅ KEEP | 🟠 HIGH | Tabel modul aktif sebagai source data |
| `sport_promos` | 0 | 1 | 0 | 1 | ✅ KEEP | 🟠 HIGH | Tabel modul aktif sebagai source data |
| `sport_refunds` | 0 | 0 | 3 | 4 | ✅ KEEP | 🟠 HIGH | Tabel modul aktif sebagai source data |
| `sport_settings` | 0 | 0 | 0 | 2 | ✅ KEEP | 🟠 HIGH | Tabel modul aktif sebagai source data |
| `sport_sync_logs` | 581 | 0 | 0 | 3 | ✅ KEEP | 🟡 MEDIUM | Dipakai di kode |
| `stock_movements` | 0 | 0 | 1 | 4 | ✅ KEEP | 🟡 MEDIUM | Dipakai di kode |
| `stocks` | 0 | 0 | 0 | 1 | ✅ KEEP | 🟡 MEDIUM | Dipakai di kode |
| `suppliers` | 14 | 27 | 1 | 2 | ✅ KEEP | 🟡 MEDIUM | Dipakai di kode |
| `system_error_logs` | 12 | 0 | 0 | 5 | ✅ KEEP | 🟡 MEDIUM | Dipakai di kode |
| `tasks` | 0 | 0 | 0 | 5 | ✅ KEEP | 🟡 MEDIUM | Dipakai di kode |
| `tax_rules` | 8 | 1 | 0 | 3 | ✅ KEEP | 🟡 MEDIUM | Dipakai di kode |
| `tenant_bookings` | 11 | 4 | 3 | 4 | ✅ KEEP | 🟠 HIGH | Tabel modul aktif sebagai source data |
| `tenant_draft_agreements` | 16 | 1 | 0 | 5 | ✅ KEEP | 🟠 HIGH | Tabel modul aktif sebagai source data |
| `tenant_invoices` | 1 | 0 | 5 | 6 | ✅ KEEP | 🟠 HIGH | Tabel modul aktif sebagai source data |
| `tenant_payments` | 14 | 1 | 2 | 6 | ✅ KEEP | 🟠 HIGH | Tabel modul aktif sebagai source data |
| `tenant_units` | 0 | 1 | 0 | 4 | ✅ KEEP | 🟠 HIGH | Tabel modul aktif sebagai source data |
| `tenant_user_access` | 1 | 0 | 1 | 4 | ✅ KEEP | 🟠 HIGH | Tabel modul aktif sebagai source data |
| `tenants` | 12 | 6 | 0 | 1 | ✅ KEEP | 🟠 HIGH | Tabel modul aktif sebagai source data |
| `thai_tea_warehouse_links` | 0 | 0 | 2 | 1 | ✅ KEEP | 🟡 MEDIUM | Dipakai di kode |
| `transaction_taxes` | 0 | 0 | 3 | 4 | ✅ KEEP | 🔴 CRITICAL | Tabel accounting pusat — wajib dipertahankan |
| `transaction_type_mapping` | 8 | 0 | 0 | 2 | ✅ KEEP | 🟡 MEDIUM | Dipakai di kode |
| `transactions` | 0 | 0 | 0 | 1 | ✅ KEEP | 🟡 MEDIUM | Dipakai di kode |
| `trucking_booking_requests` | 0 | 0 | 0 | 2 | ✅ KEEP | 🟡 MEDIUM | Dipakai di kode |
| `trucking_vehicle_rates` | 0 | 0 | 0 | 0 | ✅ KEEP | 🟡 MEDIUM | Dipakai di kode |
| `trusted_devices` | 0 | 0 | 0 | 4 | ✅ KEEP | 🟡 MEDIUM | Dipakai di kode |
| `uom` | 27 | 8 | 0 | 2 | ✅ KEEP | 🟡 MEDIUM | Dipakai di kode |
| `uom_conversions` | 22 | 0 | 4 | 2 | ✅ KEEP | 🟡 MEDIUM | Dipakai di kode |
| `uom_master` | 0 | 0 | 0 | 0 | ✅ KEEP | 🟡 MEDIUM | Dipakai di kode |
| `user_branch_access` | 0 | 0 | 0 | 0 | ✅ KEEP | 🟡 MEDIUM | Dipakai di kode |
| `user_nav_preferences` | 0 | 0 | 0 | 1 | ✅ KEEP | 🟡 MEDIUM | Dipakai di kode |
| `user_profiles` | 3 | 0 | 0 | 1 | ✅ KEEP | 🟡 MEDIUM | Dipakai di kode |
| `users` | 43 | 1 | 6 | 6 | ✅ KEEP | 🟡 MEDIUM | Dipakai di kode |
| `vendor_catalog_items` | 5 | 1 | 2 | 11 | ✅ KEEP | 🟡 MEDIUM | Dipakai di kode |
| `vendor_catalog_submission_links` | 0 | 1 | 1 | 3 | ✅ KEEP | 🟡 MEDIUM | Dipakai di kode |
| `vendor_catalog_submissions` | 0 | 0 | 2 | 5 | ✅ KEEP | 🟡 MEDIUM | Dipakai di kode |
| `vendor_company_assignments` | 0 | 0 | 1 | 4 | ✅ KEEP | 🟡 MEDIUM | Dipakai di kode |
| `vendor_drivers` | 0 | 0 | 0 | 0 | ✅ KEEP | 🟡 MEDIUM | Dipakai di kode |
| `vendor_fulfillment_links` | 0 | 0 | 0 | 0 | ✅ KEEP | 🟡 MEDIUM | Dipakai di kode |
| `vendor_installment_payments` | 0 | 0 | 0 | 2 | ✅ KEEP | 🟡 MEDIUM | Dipakai di kode |
| `vendor_installments` | 0 | 0 | 0 | 4 | ✅ KEEP | 🟡 MEDIUM | Dipakai di kode |
| `vendor_invoice_lines` | 0 | 0 | 1 | 1 | ✅ KEEP | 🟡 MEDIUM | Dipakai di kode |
| `vendor_invoices` | 0 | 0 | 3 | 3 | ✅ KEEP | 🟡 MEDIUM | Dipakai di kode |
| `vendor_job_orders` | 0 | 0 | 0 | 0 | ✅ KEEP | 🟡 MEDIUM | Dipakai di kode |
| `vendor_mini_form_links` | 0 | 1 | 2 | 3 | ✅ KEEP | 🟡 MEDIUM | Dipakai di kode |
| `vendor_mini_form_submissions` | 0 | 1 | 2 | 4 | ✅ KEEP | 🟡 MEDIUM | Dipakai di kode |
| `vendor_offers` | 0 | 0 | 2 | 1 | ✅ KEEP | 🟡 MEDIUM | Dipakai di kode |
| `vendor_operational_confirmations` | 0 | 0 | 1 | 4 | ✅ KEEP | 🟡 MEDIUM | Dipakai di kode |
| `vendor_payments` | 0 | 0 | 0 | 2 | ✅ KEEP | 🟡 MEDIUM | Dipakai di kode |
| `vendor_performance` | 13 | 0 | 1 | 2 | ✅ KEEP | 🟡 MEDIUM | Dipakai di kode |
| `vendor_price_history` | 0 | 0 | 1 | 2 | ✅ KEEP | 🟡 MEDIUM | Dipakai di kode |
| `vendor_profiles` | 0 | 0 | 0 | 0 | ✅ KEEP | 🟡 MEDIUM | Dipakai di kode |
| `vendor_quotation_lines` | 0 | 0 | 1 | 1 | ✅ KEEP | 🟡 MEDIUM | Dipakai di kode |
| `vendor_quotations` | 0 | 0 | 2 | 2 | ✅ KEEP | 🟡 MEDIUM | Dipakai di kode |
| `vendor_rates` | 0 | 0 | 1 | 1 | ✅ KEEP | 🟡 MEDIUM | Dipakai di kode |
| `vendor_responses` | 0 | 0 | 1 | 2 | ✅ KEEP | 🟡 MEDIUM | Dipakai di kode |
| `vendor_trucking_pricing` | 0 | 0 | 1 | 1 | ✅ KEEP | 🟡 MEDIUM | Dipakai di kode |
| `vmf_activity_log` | 0 | 0 | 0 | 3 | ✅ KEEP | 🟡 MEDIUM | Dipakai di kode |
| `wa_ai_intake_log` | 0 | 0 | 0 | 1 | ✅ KEEP | 🟡 MEDIUM | Dipakai di kode |
| `wa_incoming_messages` | 0 | 0 | 0 | 1 | ✅ KEEP | 🟡 MEDIUM | Dipakai di kode |
| `wa_otp_codes` | 0 | 0 | 0 | 2 | ✅ KEEP | 🟡 MEDIUM | Dipakai di kode |
| `warehouse_racks` | 0 | 0 | 0 | 0 | ✅ KEEP | 🟡 MEDIUM | Dipakai di kode |
| `warehouses` | 0 | 0 | 1 | 1 | ✅ KEEP | 🟡 MEDIUM | Dipakai di kode |
| `wh_damage_lines` | 0 | 0 | 2 | 0 | ✅ KEEP | 🟡 MEDIUM | Dipakai di kode |
| `wh_damage_reports` | 0 | 0 | 2 | 0 | ✅ KEEP | 🟡 MEDIUM | Dipakai di kode |
| `wh_movements` | 0 | 0 | 4 | 5 | ✅ KEEP | 🟡 MEDIUM | Dipakai di kode |
| `wh_opname_lines` | 0 | 0 | 2 | 0 | ✅ KEEP | 🟡 MEDIUM | Dipakai di kode |
| `wh_opnames` | 0 | 0 | 2 | 0 | ✅ KEEP | 🟡 MEDIUM | Dipakai di kode |
| `wh_return_lines` | 0 | 0 | 2 | 0 | ✅ KEEP | 🟡 MEDIUM | Dipakai di kode |
| `wh_returns` | 0 | 0 | 2 | 0 | ✅ KEEP | 🟡 MEDIUM | Dipakai di kode |
| `wh_stock` | 0 | 0 | 4 | 2 | ✅ KEEP | 🟡 MEDIUM | Dipakai di kode |
| `wh_transfer_lines` | 0 | 0 | 3 | 0 | ✅ KEEP | 🟡 MEDIUM | Dipakai di kode |
| `wh_transfers` | 0 | 0 | 3 | 3 | ✅ KEEP | 🟡 MEDIUM | Dipakai di kode |
| `whatsapp_template_configs` | 71 | 0 | 0 | 3 | ✅ KEEP | 🟡 MEDIUM | Dipakai di kode |



## 📦 ARCHIVE — Arsip Dulu (25)

| Tabel | Rows | FK↓ | FK↑ | Idx | Status | Risiko | Alasan |
|-------|-----:|----:|----:|----:|--------|--------|--------|
| `fleet_accounting_journals` | 0 | 0 | 1 | 4 | 📦 ARCHIVE | 🟡 MEDIUM | Legacy — perlu konfirmasi tim sebelum drop |
| `fleet_expenses` | 0 | 0 | 2 | 5 | 📦 ARCHIVE | 🟡 MEDIUM | Legacy — perlu konfirmasi tim sebelum drop |
| `fleet_ledger_entries` | 17 | 0 | 1 | 6 | 📦 ARCHIVE | 🟡 MEDIUM | Legacy — perlu konfirmasi tim sebelum drop |
| `fleet_outstanding_import_log` | 0 | 0 | 0 | 2 | 📦 ARCHIVE | 🟡 MEDIUM | Legacy — perlu konfirmasi tim sebelum drop |
| `fleet_partners` | 0 | 3 | 0 | 2 | 📦 ARCHIVE | 🟡 MEDIUM | Legacy — masih ada FK masuk, investigasi dulu sebelum drop |
| `fleet_pipeline_health` | 0 | 0 | 2 | 4 | 📦 ARCHIVE | 🟡 MEDIUM | Legacy — perlu konfirmasi tim sebelum drop |
| `fleet_reconciliation_reports` | 0 | 0 | 2 | 4 | 📦 ARCHIVE | 🟡 MEDIUM | Legacy — perlu konfirmasi tim sebelum drop |
| `fleet_vehicles` | 0 | 2 | 2 | 3 | 📦 ARCHIVE | 🟡 MEDIUM | Legacy — masih ada FK masuk, investigasi dulu sebelum drop |
| `fleet_wa_logs` | 0 | 0 | 2 | 3 | 📦 ARCHIVE | 🟡 MEDIUM | Legacy — perlu konfirmasi tim sebelum drop |
| `sc_admin_notes` | 0 | 0 | 0 | 0 | 📦 ARCHIVE | 🟡 MEDIUM | Legacy — perlu konfirmasi tim sebelum drop |
| `sc_blocked_schedules` | 0 | 0 | 0 | 0 | 📦 ARCHIVE | 🟡 MEDIUM | Legacy — perlu konfirmasi tim sebelum drop |
| `sc_facility_images` | 0 | 0 | 0 | 0 | 📦 ARCHIVE | 🟡 MEDIUM | Legacy — perlu konfirmasi tim sebelum drop |
| `sc_payments` | 0 | 0 | 0 | 0 | 📦 ARCHIVE | 🟡 MEDIUM | Legacy — perlu konfirmasi tim sebelum drop |
| `sc_promos` | 0 | 0 | 0 | 0 | 📦 ARCHIVE | 🟡 MEDIUM | Legacy — perlu konfirmasi tim sebelum drop |
| `sc_settings` | 0 | 0 | 0 | 0 | 📦 ARCHIVE | 🟡 MEDIUM | Legacy — perlu konfirmasi tim sebelum drop |
| `shipment_events` | 0 | 0 | 0 | 3 | 📦 ARCHIVE | 🟡 MEDIUM | Legacy — perlu konfirmasi tim sebelum drop |
| `shipment_stages` | 0 | 0 | 0 | 1 | 📦 ARCHIVE | 🟡 MEDIUM | Legacy — perlu konfirmasi tim sebelum drop |
| `shipment_trackings` | 0 | 0 | 0 | 3 | 📦 ARCHIVE | 🟡 MEDIUM | Legacy — perlu konfirmasi tim sebelum drop |
| `shipments` | 0 | 0 | 0 | 2 | 📦 ARCHIVE | 🟡 MEDIUM | Legacy — perlu konfirmasi tim sebelum drop |
| `sport_center_bookings` | 2 | 0 | 1 | 2 | 📦 ARCHIVE | 🟡 MEDIUM | Legacy — perlu konfirmasi tim sebelum drop |
| `sport_center_expenses` | 0 | 0 | 0 | 6 | 📦 ARCHIVE | 🟡 MEDIUM | Legacy — perlu konfirmasi tim sebelum drop |
| `sport_center_facilities` | 2 | 1 | 0 | 1 | 📦 ARCHIVE | 🟡 MEDIUM | Legacy — masih ada FK masuk, investigasi dulu sebelum drop |
| `sport_center_memberships` | 0 | 0 | 0 | 1 | 📦 ARCHIVE | 🟡 MEDIUM | Legacy — perlu konfirmasi tim sebelum drop |
| `transaction_datetime_normalized` | 0 | 0 | 3 | 4 | 📦 ARCHIVE | 🟡 MEDIUM | Legacy — perlu konfirmasi tim sebelum drop |
| `workflow_events` | 0 | 0 | 0 | 2 | 📦 ARCHIVE | 🟡 MEDIUM | Legacy — perlu konfirmasi tim sebelum drop |


## 🗑️ DELETE_CANDIDATE — Kandidat Hapus (52)

| Tabel | Rows | FK↓ | FK↑ | Idx | Status | Risiko | Alasan |
|-------|-----:|----:|----:|----:|--------|--------|--------|
| `ai_tasks` | 0 | 0 | 0 | 9 | 🗑️ DELETE_CANDIDATE | 🟢 LOW | Kosong, tidak ada FK masuk, tidak ditemukan di kode |
| `attendance_records` | 0 | 0 | 0 | 1 | 🗑️ DELETE_CANDIDATE | 🟢 LOW | Kosong, tidak ada FK masuk, tidak ditemukan di kode |
| `bank_account_balances` | 0 | 0 | 0 | 1 | 🗑️ DELETE_CANDIDATE | 🟢 LOW | Kosong, tidak ada FK masuk, tidak ditemukan di kode |
| `bank_closing_periods` | 0 | 0 | 1 | 2 | 🗑️ DELETE_CANDIDATE | 🟢 LOW | Kosong, tidak ada FK masuk, tidak ditemukan di kode |
| `bank_coa_rules` | 0 | 0 | 0 | 2 | 🗑️ DELETE_CANDIDATE | 🟢 LOW | Kosong, tidak ada FK masuk, tidak ditemukan di kode |
| `bank_recon_audit_logs` | 0 | 0 | 0 | 1 | 🗑️ DELETE_CANDIDATE | 🟢 LOW | Kosong, tidak ada FK masuk, tidak ditemukan di kode |
| `banners` | 0 | 0 | 0 | 1 | 🗑️ DELETE_CANDIDATE | 🟢 LOW | Kosong, tidak ada FK masuk, tidak ditemukan di kode |
| `blast_session_logs` | 0 | 0 | 0 | 4 | 🗑️ DELETE_CANDIDATE | 🟢 LOW | Kosong, tidak ada FK masuk, tidak ditemukan di kode |
| `cashier_shifts` | 0 | 0 | 0 | 1 | 🗑️ DELETE_CANDIDATE | 🟢 LOW | Kosong, tidak ada FK masuk, tidak ditemukan di kode |
| `cms_blocks` | 0 | 0 | 0 | 0 | 🗑️ DELETE_CANDIDATE | 🟢 LOW | Kosong, tidak ada FK masuk, tidak ditemukan di kode |
| `cms_media` | 0 | 0 | 0 | 0 | 🗑️ DELETE_CANDIDATE | 🟢 LOW | Kosong, tidak ada FK masuk, tidak ditemukan di kode |
| `cms_pages` | 0 | 0 | 0 | 0 | 🗑️ DELETE_CANDIDATE | 🟢 LOW | Kosong, tidak ada FK masuk, tidak ditemukan di kode |
| `cms_settings` | 0 | 0 | 0 | 0 | 🗑️ DELETE_CANDIDATE | 🟢 LOW | Kosong, tidak ada FK masuk, tidak ditemukan di kode |
| `company_settings` | 0 | 0 | 0 | 2 | 🗑️ DELETE_CANDIDATE | 🟢 LOW | Kosong, tidak ada FK masuk, tidak ditemukan di kode |
| `customer_contexts` | 0 | 0 | 0 | 3 | 🗑️ DELETE_CANDIDATE | 🟢 LOW | Kosong, tidak ada FK masuk, tidak ditemukan di kode |
| `data_template_fields` | 0 | 0 | 0 | 2 | 🗑️ DELETE_CANDIDATE | 🟢 LOW | Kosong, tidak ada FK masuk, tidak ditemukan di kode |
| `data_templates` | 0 | 0 | 0 | 2 | 🗑️ DELETE_CANDIDATE | 🟢 LOW | Kosong, tidak ada FK masuk, tidak ditemukan di kode |
| `dispatcher_logs` | 0 | 0 | 0 | 1 | 🗑️ DELETE_CANDIDATE | 🟢 LOW | Kosong, tidak ada FK masuk, tidak ditemukan di kode |
| `document_audits` | 0 | 0 | 0 | 3 | 🗑️ DELETE_CANDIDATE | 🟢 LOW | Kosong, tidak ada FK masuk, tidak ditemukan di kode |
| `document_template_fields` | 0 | 0 | 0 | 2 | 🗑️ DELETE_CANDIDATE | 🟢 LOW | Kosong, tidak ada FK masuk, tidak ditemukan di kode |
| `document_templates` | 0 | 0 | 0 | 2 | 🗑️ DELETE_CANDIDATE | 🟢 LOW | Kosong, tidak ada FK masuk, tidak ditemukan di kode |
| `draft_agreements_wa_log` | 0 | 0 | 1 | 1 | 🗑️ DELETE_CANDIDATE | 🟢 LOW | Kosong, tidak ada FK masuk, tidak ditemukan di kode |
| `employee_kasbon` | 1 | 0 | 0 | 2 | 🗑️ DELETE_CANDIDATE | 🟢 LOW | 1 row(s) kecil, tidak ditemukan di kode, tidak ada FK masuk |
| `employees` | 15 | 0 | 0 | 1 | 🗑️ DELETE_CANDIDATE | 🟢 LOW | 15 row(s) kecil, tidak ditemukan di kode, tidak ada FK masuk |
| `finance_payment_events` | 11 | 0 | 0 | 1 | 🗑️ DELETE_CANDIDATE | 🟢 LOW | 11 row(s) kecil, tidak ditemukan di kode, tidak ada FK masuk |
| `follow_up_logs` | 0 | 0 | 0 | 3 | 🗑️ DELETE_CANDIDATE | 🟢 LOW | Kosong, tidak ada FK masuk, tidak ditemukan di kode |
| `gym_memberships` | 0 | 0 | 0 | 0 | 🗑️ DELETE_CANDIDATE | 🟢 LOW | Kosong, tidak ada FK masuk, tidak ditemukan di kode |
| `intent_master` | 0 | 0 | 0 | 3 | 🗑️ DELETE_CANDIDATE | 🟢 LOW | Kosong, tidak ada FK masuk, tidak ditemukan di kode |
| `keyword_rules` | 0 | 0 | 0 | 3 | 🗑️ DELETE_CANDIDATE | 🟢 LOW | Kosong, tidak ada FK masuk, tidak ditemukan di kode |
| `leave_requests` | 0 | 0 | 0 | 1 | 🗑️ DELETE_CANDIDATE | 🟢 LOW | Kosong, tidak ada FK masuk, tidak ditemukan di kode |
| `operational_checklists` | 0 | 0 | 0 | 3 | 🗑️ DELETE_CANDIDATE | 🟢 LOW | Kosong, tidak ada FK masuk, tidak ditemukan di kode |
| `operational_expenses` | 0 | 0 | 2 | 5 | 🗑️ DELETE_CANDIDATE | 🟢 LOW | Kosong, tidak ada FK masuk, tidak ditemukan di kode |
| `order_asuransi` | 19 | 0 | 0 | 1 | 🗑️ DELETE_CANDIDATE | 🟢 LOW | 19 row(s) kecil, tidak ditemukan di kode, tidak ada FK masuk |
| `otp_tokens` | 0 | 0 | 0 | 2 | 🗑️ DELETE_CANDIDATE | 🟢 LOW | Kosong, tidak ada FK masuk, tidak ditemukan di kode |
| `page_products` | 0 | 0 | 2 | 1 | 🗑️ DELETE_CANDIDATE | 🟢 LOW | Kosong, tidak ada FK masuk, tidak ditemukan di kode |
| `payment_receipts` | 11 | 0 | 1 | 2 | 🗑️ DELETE_CANDIDATE | 🟢 LOW | 11 row(s) kecil, tidak ditemukan di kode, tidak ada FK masuk |
| `promo_registrations` | 0 | 0 | 0 | 0 | 🗑️ DELETE_CANDIDATE | 🟢 LOW | Kosong, tidak ada FK masuk, tidak ditemukan di kode |
| `public_tokens` | 0 | 0 | 0 | 2 | 🗑️ DELETE_CANDIDATE | 🟢 LOW | Kosong, tidak ada FK masuk, tidak ditemukan di kode |
| `registration_link_wa_log` | 0 | 0 | 0 | 1 | 🗑️ DELETE_CANDIDATE | 🟢 LOW | Kosong, tidak ada FK masuk, tidak ditemukan di kode |
| `service_catalog` | 0 | 0 | 0 | 3 | 🗑️ DELETE_CANDIDATE | 🟢 LOW | Kosong, tidak ada FK masuk, tidak ditemukan di kode |
| `service_circuit_states` | 0 | 0 | 0 | 1 | 🗑️ DELETE_CANDIDATE | 🟢 LOW | Kosong, tidak ada FK masuk, tidak ditemukan di kode |
| `service_registry` | 0 | 0 | 0 | 1 | 🗑️ DELETE_CANDIDATE | 🟢 LOW | Kosong, tidak ada FK masuk, tidak ditemukan di kode |
| `system_settings` | 1 | 0 | 0 | 1 | 🗑️ DELETE_CANDIDATE | 🟢 LOW | 1 row(s) kecil, tidak ditemukan di kode, tidak ada FK masuk |
| `task_assignments` | 0 | 0 | 0 | 1 | 🗑️ DELETE_CANDIDATE | 🟢 LOW | Kosong, tidak ada FK masuk, tidak ditemukan di kode |
| `task_attachments` | 0 | 0 | 0 | 3 | 🗑️ DELETE_CANDIDATE | 🟢 LOW | Kosong, tidak ada FK masuk, tidak ditemukan di kode |
| `task_comments` | 0 | 0 | 0 | 1 | 🗑️ DELETE_CANDIDATE | 🟢 LOW | Kosong, tidak ada FK masuk, tidak ditemukan di kode |
| `task_timeline` | 0 | 0 | 0 | 1 | 🗑️ DELETE_CANDIDATE | 🟢 LOW | Kosong, tidak ada FK masuk, tidak ditemukan di kode |
| `team_members` | 0 | 0 | 0 | 3 | 🗑️ DELETE_CANDIDATE | 🟢 LOW | Kosong, tidak ada FK masuk, tidak ditemukan di kode |
| `user_site_access` | 0 | 0 | 0 | 2 | 🗑️ DELETE_CANDIDATE | 🟢 LOW | Kosong, tidak ada FK masuk, tidak ditemukan di kode |
| `wa_send_logs` | 12 | 0 | 0 | 3 | 🗑️ DELETE_CANDIDATE | 🟢 LOW | 12 row(s) kecil, tidak ditemukan di kode, tidak ada FK masuk |
| `whatsapp_messages` | 0 | 0 | 0 | 8 | 🗑️ DELETE_CANDIDATE | 🟢 LOW | Kosong, tidak ada FK masuk, tidak ditemukan di kode |
| `whatsapp_notifications` | 0 | 0 | 0 | 1 | 🗑️ DELETE_CANDIDATE | 🟢 LOW | Kosong, tidak ada FK masuk, tidak ditemukan di kode |



---

## Tabel Accounting Pusat (Tidak Boleh Dihapus)

`companies`, `branches`, `cost_centers`, `chart_of_accounts`, `accounting_journals`,
`accounting_journal_lines`, `accounting_ar`, `accounting_ap`, `cash_transactions`,
`bank_transactions`, `financial_periods`, `intercompany_transactions`,
`accounting_payments`, `accounting_attachments`, `audit_logs`

---
*Auto-generated — jangan edit manual. Jalankan ulang script untuk refresh.*
