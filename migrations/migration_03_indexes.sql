-- ============================================================
-- REKOMENDASI INDEX — Berdasarkan pola foreign key & query umum
-- Jalankan di KEDUA DB setelah migration utama selesai
-- Tanggal: 2026-07-07
-- ============================================================

-- ── AI Intelligence ──────────────────────────────────────────
-- company_id adalah kolom filter utama di semua tabel AI
CREATE INDEX IF NOT EXISTS idx_accuracy_snapshots_company    ON public.accuracy_snapshots(company_id);
CREATE INDEX IF NOT EXISTS idx_accuracy_snapshots_period     ON public.accuracy_snapshots(period_start, period_end);
CREATE INDEX IF NOT EXISTS idx_ai_experiments_company        ON public.ai_experiments(company_id);
CREATE INDEX IF NOT EXISTS idx_ai_experiments_status         ON public.ai_experiments(status);
CREATE INDEX IF NOT EXISTS idx_correction_queue_company      ON public.correction_queue(company_id);
CREATE INDEX IF NOT EXISTS idx_correction_queue_task         ON public.correction_queue(task_id);
CREATE INDEX IF NOT EXISTS idx_correction_queue_status       ON public.correction_queue(status);
CREATE INDEX IF NOT EXISTS idx_correction_sessions_company   ON public.correction_sessions(company_id);
CREATE INDEX IF NOT EXISTS idx_correction_sessions_task      ON public.correction_sessions(task_id);
CREATE INDEX IF NOT EXISTS idx_dataset_exports_company       ON public.dataset_exports(company_id);
CREATE INDEX IF NOT EXISTS idx_escalation_logs_company       ON public.escalation_logs(company_id);
CREATE INDEX IF NOT EXISTS idx_escalation_logs_task          ON public.escalation_logs(task_id);
CREATE INDEX IF NOT EXISTS idx_experiment_observations_exp   ON public.experiment_observations(experiment_id);
CREATE INDEX IF NOT EXISTS idx_experiment_observations_task  ON public.experiment_observations(task_id);
CREATE INDEX IF NOT EXISTS idx_experiment_results_exp        ON public.experiment_results(experiment_id);
CREATE INDEX IF NOT EXISTS idx_performance_daily_company     ON public.performance_daily(company_id, date);
CREATE INDEX IF NOT EXISTS idx_performance_daily_date        ON public.performance_daily(date);
CREATE INDEX IF NOT EXISTS idx_performance_by_intent_company ON public.performance_by_intent(company_id, intent);
CREATE INDEX IF NOT EXISTS idx_prompt_test_results_version   ON public.prompt_test_results(prompt_version_id);
CREATE INDEX IF NOT EXISTS idx_routing_rules_company         ON public.routing_rules(company_id);
CREATE INDEX IF NOT EXISTS idx_routing_rules_intent          ON public.routing_rules(intent) WHERE is_active = true;
CREATE INDEX IF NOT EXISTS idx_sla_matrix_company            ON public.sla_matrix(company_id);
CREATE INDEX IF NOT EXISTS idx_sla_matrix_intent             ON public.sla_matrix(intent, priority) WHERE is_active = true;
CREATE INDEX IF NOT EXISTS idx_training_dataset_company      ON public.training_dataset(company_id);
CREATE INDEX IF NOT EXISTS idx_training_dataset_split        ON public.training_dataset(split_tag) WHERE is_active = true;

-- ── HR Kasbon ─────────────────────────────────────────────────
CREATE INDEX IF NOT EXISTS idx_hr_kasbon_employee_status     ON public.hr_kasbon(employee_id, status);
CREATE INDEX IF NOT EXISTS idx_hr_kasbon_inst_status         ON public.hr_kasbon_installments(status, due_date);
CREATE INDEX IF NOT EXISTS idx_employee_kasbon_emp_status    ON public.employee_kasbon(employee_id, status);
CREATE INDEX IF NOT EXISTS idx_employee_advances_emp_status  ON public.employee_advances(employee_id, status);
CREATE INDEX IF NOT EXISTS idx_cash_adv_inst_status          ON public.cash_advance_installments(status, due_date);

-- ── Sales Delivery ────────────────────────────────────────────
CREATE INDEX IF NOT EXISTS idx_sales_deliveries_status       ON public.sales_deliveries(status);
CREATE INDEX IF NOT EXISTS idx_sales_deliveries_driver       ON public.sales_deliveries(driver_id) WHERE driver_id IS NOT NULL;

-- ── TravelInTrips ─────────────────────────────────────────────
CREATE INDEX IF NOT EXISTS idx_travelintrips_orders_status   ON travelintrips.orders(status);
CREATE INDEX IF NOT EXISTS idx_travelintrips_cart_session    ON travelintrips.cart_items(session_id);
CREATE INDEX IF NOT EXISTS idx_travelintrips_products_active ON travelintrips.products(is_active, category);

-- ── Kolom baru di tabel existing ─────────────────────────────
CREATE INDEX IF NOT EXISTS idx_expenses_cost_center          ON public.expenses(cost_center_id) WHERE cost_center_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_departments_deleted_at        ON public.departments(deleted_at) WHERE deleted_at IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_sport_payments_journal        ON public.sport_payments(journal_id) WHERE journal_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_tenant_payments_journal       ON public.tenant_payments(journal_id) WHERE journal_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_driver_jobs_vendor            ON public.driver_jobs(vendor_id) WHERE vendor_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_driver_portal_tokens_used     ON public.driver_portal_tokens(used_at) WHERE used_at IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_pos_orders_source             ON public.pos_orders(source) WHERE source IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_purchase_docs_logistic_order  ON public.purchase_documents(logistic_order_id) WHERE logistic_order_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_purchase_docs_mkt_po          ON public.purchase_documents(mkt_purchase_order_id) WHERE mkt_purchase_order_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_vendor_responses_vendor       ON public.vendor_responses(vendor_id) WHERE vendor_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_rfq_vendor_links_reminded     ON public.rfq_vendor_links(reminded_at) WHERE reminded_at IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_sport_bookings_group          ON sport_center.sport_bookings(booking_group_id) WHERE booking_group_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_sport_bookings_promo          ON sport_center.sport_bookings(promo_id) WHERE promo_id IS NOT NULL;
