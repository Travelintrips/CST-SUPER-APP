-- ============================================================
-- VALIDATION SCRIPT — Jalankan setelah migration selesai
-- Cocokkan ekspektasi di komentar dengan hasil query
-- Tanggal: 2026-07-07
-- ============================================================

-- ── 1. Verifikasi kolom yang ditambahkan ke PROD (dari DEV) ──
SELECT table_schema, table_name, column_name, data_type
FROM information_schema.columns
WHERE
   (table_schema = 'public' AND table_name = 'companies'          AND column_name IN ('industry','legal_name','updated_at'))
OR (table_schema = 'public' AND table_name = 'expenses'           AND column_name = 'cost_center_id')
OR (table_schema = 'public' AND table_name = 'chart_of_accounts'  AND column_name = 'subtype')
OR (table_schema = 'public' AND table_name = 'financial_periods'  AND column_name = 'period_status')
OR (table_schema = 'public' AND table_name = 'sport_payments'     AND column_name IN ('journal_id','posted_to_accounting_at','posting_error'))
OR (table_schema = 'public' AND table_name = 'tenant_payments'    AND column_name IN ('journal_id','posted_to_accounting_at','posting_error'))
OR (table_schema = 'public' AND table_name = 'task_attachments'   AND column_name IN ('customer_id','is_reusable','reuse_notes'))
OR (table_schema = 'public' AND table_name = 'cash_advance_installment_schedules' AND column_name IN ('accounting_entry_id','payroll_item_id'))
OR (table_schema = 'public' AND table_name = 'salary_payments'    AND column_name IN ('bank_account_code','bank_account_name'))
OR (table_schema = 'public' AND table_name = 'fleet_ledger_entries' AND column_name = 'currency')
OR (table_schema = 'public' AND table_name = 'fixed_assets'       AND column_name = 'payment_account_id')
OR (table_schema = 'public' AND table_name = 'departments'        AND column_name = 'deleted_at')
OR (table_schema = 'public' AND table_name = 'bank_reconciliation_matches' AND column_name IN ('customer_name','order_ref'))
OR (table_schema = 'sport_center' AND table_name = 'sport_bookings' AND column_name = 'wa_customer_notif_sent_at')
ORDER BY table_schema, table_name, column_name;
-- ✅ Ekspektasi: 22 baris

-- ── 2. Verifikasi tabel AI Intelligence ──────────────────────
SELECT table_name FROM information_schema.tables
WHERE table_schema = 'public'
  AND table_name IN (
    'accuracy_snapshots','ai_experiments','correction_queue','correction_sessions',
    'dataset_exports','escalation_logs','experiment_observations','experiment_results',
    'performance_by_intent','performance_daily','prompt_test_results',
    'routing_rules','sla_matrix','training_dataset'
  )
ORDER BY table_name;
-- ✅ Ekspektasi: 14 baris

-- ── 3. Verifikasi tabel Sport Center baru ────────────────────
SELECT table_name FROM information_schema.tables
WHERE table_schema = 'sport_center'
  AND table_name IN (
    'company_invoice_settings','document_file_templates',
    'gym_memberships','payments','settings','system_connection_baselines'
  )
ORDER BY table_name;
-- ✅ Ekspektasi: 6 baris

-- ── 4. Verifikasi kolom yang ditambahkan ke DEV (dari PROD) ──
SELECT table_schema, table_name, column_name, data_type
FROM information_schema.columns
WHERE
   (table_schema = 'public' AND table_name = 'pos_orders'         AND column_name IN ('customer_note','source','table_number'))
OR (table_schema = 'public' AND table_name = 'pos_products'       AND column_name IN ('company_id','linked_product_id','product_type'))
OR (table_schema = 'public' AND table_name = 'purchase_documents' AND column_name IN ('logistic_order_id','mkt_purchase_order_id'))
OR (table_schema = 'public' AND table_name = 'drivers'            AND column_name = 'driver_type')
OR (table_schema = 'public' AND table_name = 'driver_jobs'        AND column_name = 'vendor_id')
OR (table_schema = 'public' AND table_name = 'vendor_responses'   AND column_name = 'vendor_id')
OR (table_schema = 'public' AND table_name = 'customers'          AND column_name IN ('typical_cargo_types','typical_routes'))
OR (table_schema = 'public' AND table_name = 'uom'                AND column_name = 'code')
OR (table_schema = 'public' AND table_name = 'payroll_runs'       AND column_name = 'payment_entry_id')
OR (table_schema = 'public' AND table_name = 'rfq_vendor_links'   AND column_name = 'reminded_at')
OR (table_schema = 'public' AND table_name = 'logistic_order_items' AND column_name = 'template_snapshot')
OR (table_schema = 'public' AND table_name = 'driver_portal_tokens' AND column_name = 'used_at')
OR (table_schema = 'sport_center' AND table_name = 'sport_bookings' AND column_name IN ('booking_group_id','promo_id','sub_total'))
OR (table_schema = 'sport_center' AND table_name = 'sport_payments' AND column_name IN ('payment_channel','reference_number','verified_at','verified_by'))
OR (table_schema = 'sport_center' AND table_name = 'promos'        AND column_name IN ('current_uses','minimum_booking_amount','promo_type'))
ORDER BY table_schema, table_name, column_name;
-- ✅ Ekspektasi: 26 baris

-- ── 5. Verifikasi tabel HR Kasbon & Sales Delivery ───────────
SELECT table_name FROM information_schema.tables
WHERE table_schema = 'public'
  AND table_name IN (
    'hr_kasbon','hr_kasbon_installments','employee_kasbon',
    'employee_advances','cash_advance_installments',
    'sales_deliveries','sales_delivery_lines'
  )
ORDER BY table_name;
-- ✅ Ekspektasi: 7 baris

-- ── 6. Verifikasi schema & tabel TravelInTrips ───────────────
SELECT table_schema, table_name FROM information_schema.tables
WHERE table_schema = 'travelintrips'
ORDER BY table_name;
-- ✅ Ekspektasi: 8 baris

-- ── 7. Verifikasi indexes AI Intelligence ────────────────────
SELECT indexname FROM pg_indexes
WHERE schemaname = 'public'
  AND indexname LIKE 'idx_accuracy_%'
   OR indexname LIKE 'idx_ai_%'
   OR indexname LIKE 'idx_correction_%'
   OR indexname LIKE 'idx_performance_%'
   OR indexname LIKE 'idx_training_%'
ORDER BY indexname;

-- ── 8. Ringkasan: hitung total kolom yang berhasil ───────────
SELECT
  'PROD kolom dari DEV'    AS migration,  22 AS ekspektasi,
  (SELECT count(*) FROM information_schema.columns WHERE
     (table_schema = 'public' AND table_name = 'companies' AND column_name IN ('industry','legal_name','updated_at'))
     OR (table_schema = 'public' AND table_name = 'departments' AND column_name = 'deleted_at')
  ) AS sample_check
UNION ALL
SELECT 'AI tabel baru', 14,
  (SELECT count(*) FROM information_schema.tables WHERE table_schema='public'
   AND table_name IN ('accuracy_snapshots','ai_experiments','correction_queue','correction_sessions',
   'dataset_exports','escalation_logs','experiment_observations','experiment_results',
   'performance_by_intent','performance_daily','prompt_test_results','routing_rules','sla_matrix','training_dataset')
  )
UNION ALL
SELECT 'TravelInTrips tabel', 8,
  (SELECT count(*) FROM information_schema.tables WHERE table_schema='travelintrips');
