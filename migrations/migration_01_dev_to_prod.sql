-- ============================================================
-- MIGRATION 1: Sinkronisasi DEV → PROD
-- Deskripsi : Tabel & kolom yang ada di DEV belum ada di PROD
-- Aturan    : Idempotent, tidak DROP, tidak hapus data
-- Tanggal   : 2026-07-07
-- Jalankan  : psql "$SUPABASE_MIGRATION_URL" -f migration_01_dev_to_prod.sql
-- ============================================================

BEGIN;

-- ────────────────────────────────────────────────────────────
-- BAGIAN 1: Kolom baru di tabel yang sudah ada di PROD
-- ────────────────────────────────────────────────────────────

-- public.companies
ALTER TABLE public.companies ADD COLUMN IF NOT EXISTS industry TEXT;
ALTER TABLE public.companies ADD COLUMN IF NOT EXISTS legal_name TEXT;
ALTER TABLE public.companies ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ DEFAULT now();

-- public.expenses
ALTER TABLE public.expenses ADD COLUMN IF NOT EXISTS cost_center_id INTEGER;

-- public.chart_of_accounts
ALTER TABLE public.chart_of_accounts ADD COLUMN IF NOT EXISTS subtype TEXT;

-- public.financial_periods
ALTER TABLE public.financial_periods ADD COLUMN IF NOT EXISTS period_status TEXT DEFAULT 'open';

-- public.sport_payments
ALTER TABLE public.sport_payments ADD COLUMN IF NOT EXISTS journal_id INTEGER;
ALTER TABLE public.sport_payments ADD COLUMN IF NOT EXISTS posted_to_accounting_at TIMESTAMPTZ;
ALTER TABLE public.sport_payments ADD COLUMN IF NOT EXISTS posting_error TEXT;

-- public.tenant_payments
ALTER TABLE public.tenant_payments ADD COLUMN IF NOT EXISTS journal_id INTEGER;
ALTER TABLE public.tenant_payments ADD COLUMN IF NOT EXISTS posted_to_accounting_at TIMESTAMPTZ;
ALTER TABLE public.tenant_payments ADD COLUMN IF NOT EXISTS posting_error TEXT;

-- public.task_attachments
ALTER TABLE public.task_attachments ADD COLUMN IF NOT EXISTS customer_id INTEGER;
ALTER TABLE public.task_attachments ADD COLUMN IF NOT EXISTS is_reusable BOOLEAN DEFAULT false;
ALTER TABLE public.task_attachments ADD COLUMN IF NOT EXISTS reuse_notes TEXT;

-- public.cash_advance_installment_schedules
ALTER TABLE public.cash_advance_installment_schedules ADD COLUMN IF NOT EXISTS accounting_entry_id INTEGER;
ALTER TABLE public.cash_advance_installment_schedules ADD COLUMN IF NOT EXISTS payroll_item_id INTEGER;

-- public.salary_payments
ALTER TABLE public.salary_payments ADD COLUMN IF NOT EXISTS bank_account_code TEXT;
ALTER TABLE public.salary_payments ADD COLUMN IF NOT EXISTS bank_account_name TEXT;

-- public.fleet_ledger_entries
ALTER TABLE public.fleet_ledger_entries ADD COLUMN IF NOT EXISTS currency TEXT DEFAULT 'IDR';

-- public.fixed_assets
ALTER TABLE public.fixed_assets ADD COLUMN IF NOT EXISTS payment_account_id INTEGER;

-- public.departments
ALTER TABLE public.departments ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMPTZ;

-- public.bank_reconciliation_matches
ALTER TABLE public.bank_reconciliation_matches ADD COLUMN IF NOT EXISTS customer_name TEXT;
ALTER TABLE public.bank_reconciliation_matches ADD COLUMN IF NOT EXISTS order_ref TEXT;

-- sport_center.sport_bookings
ALTER TABLE sport_center.sport_bookings ADD COLUMN IF NOT EXISTS wa_customer_notif_sent_at TIMESTAMPTZ;

-- ────────────────────────────────────────────────────────────
-- BAGIAN 2: Tabel baru — AI Intelligence (14 tabel)
-- ────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.accuracy_snapshots (
    id               SERIAL PRIMARY KEY,
    company_id       TEXT NOT NULL DEFAULT 'default',
    snapshot_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    period_start     TIMESTAMPTZ NOT NULL,
    period_end       TIMESTAMPTZ NOT NULL,
    prompt_version_id INTEGER,
    intent_accuracy  NUMERIC(5,2),
    routing_accuracy NUMERIC(5,2),
    priority_accuracy NUMERIC(5,2),
    sla_accuracy     NUMERIC(5,2),
    approval_accuracy NUMERIC(5,2),
    fallback_rate    NUMERIC(5,2),
    low_confidence_rate NUMERIC(5,2),
    correction_rate  NUMERIC(5,2),
    total_tasks_processed INTEGER DEFAULT 0,
    total_corrections INTEGER DEFAULT 0,
    intent_breakdown JSONB,
    created_at       TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.ai_experiments (
    id                       SERIAL PRIMARY KEY,
    company_id               TEXT NOT NULL DEFAULT 'default',
    name                     TEXT NOT NULL,
    description              TEXT,
    control_version_id       INTEGER NOT NULL,
    challenger_version_id    INTEGER NOT NULL,
    challenger_traffic_pct   INTEGER DEFAULT 20,
    primary_metric           TEXT DEFAULT 'intent_accuracy',
    min_sample_size          INTEGER DEFAULT 100,
    status                   TEXT DEFAULT 'draft',
    conclusion               TEXT,
    conclusion_notes         TEXT,
    created_by               TEXT NOT NULL,
    concluded_by             TEXT,
    started_at               TIMESTAMPTZ,
    ended_at                 TIMESTAMPTZ,
    created_at               TIMESTAMPTZ DEFAULT now(),
    updated_at               TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.correction_queue (
    id                   SERIAL PRIMARY KEY,
    company_id           TEXT NOT NULL DEFAULT 'default',
    task_id              INTEGER NOT NULL,
    corrected_by         TEXT NOT NULL,
    session_id           INTEGER,
    field_corrected      TEXT NOT NULL,
    original_value       TEXT NOT NULL,
    original_confidence  NUMERIC,
    corrected_value      TEXT NOT NULL,
    correction_reason    TEXT,
    task_snapshot        JSONB,
    status               TEXT DEFAULT 'pending',
    created_at           TIMESTAMPTZ DEFAULT now(),
    exported_at          TIMESTAMPTZ
);

CREATE TABLE IF NOT EXISTS public.correction_sessions (
    id              SERIAL PRIMARY KEY,
    company_id      TEXT NOT NULL DEFAULT 'default',
    task_id         INTEGER NOT NULL,
    reviewed_by     TEXT NOT NULL,
    started_at      TIMESTAMPTZ DEFAULT now(),
    completed_at    TIMESTAMPTZ,
    corrections_made INTEGER DEFAULT 0,
    notes           TEXT
);

CREATE TABLE IF NOT EXISTS public.dataset_exports (
    id             SERIAL PRIMARY KEY,
    company_id     TEXT NOT NULL DEFAULT 'default',
    exported_by    TEXT NOT NULL,
    format         TEXT DEFAULT 'jsonl',
    row_count      INTEGER DEFAULT 0,
    file_path      TEXT,
    status         TEXT DEFAULT 'pending',
    created_at     TIMESTAMPTZ DEFAULT now(),
    completed_at   TIMESTAMPTZ,
    error_message  TEXT,
    filters        JSONB
);

CREATE TABLE IF NOT EXISTS public.escalation_logs (
    id              SERIAL PRIMARY KEY,
    company_id      TEXT NOT NULL DEFAULT 'default',
    task_id         INTEGER NOT NULL,
    escalated_by    TEXT,
    reason          TEXT,
    from_agent      TEXT,
    to_agent        TEXT,
    resolved_at     TIMESTAMPTZ,
    created_at      TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.experiment_observations (
    id                    SERIAL PRIMARY KEY,
    experiment_id         INTEGER NOT NULL,
    task_id               INTEGER NOT NULL,
    group_tag             TEXT NOT NULL,
    prompt_version_id     INTEGER NOT NULL,
    predicted_intent      TEXT,
    predicted_routing     TEXT,
    predicted_confidence  NUMERIC,
    predicted_approval    TEXT,
    intent_correct        BOOLEAN,
    routing_correct       BOOLEAN,
    approval_correct      BOOLEAN,
    was_corrected         BOOLEAN DEFAULT false,
    correction_id         INTEGER,
    observed_at           TIMESTAMPTZ DEFAULT now(),
    outcome_determined_at TIMESTAMPTZ
);

CREATE TABLE IF NOT EXISTS public.experiment_results (
    id                     SERIAL PRIMARY KEY,
    experiment_id          INTEGER NOT NULL,
    group_tag              TEXT NOT NULL,
    sample_size            INTEGER DEFAULT 0,
    intent_accuracy        NUMERIC(5,2),
    routing_accuracy       NUMERIC(5,2),
    approval_accuracy      NUMERIC(5,2),
    correction_rate        NUMERIC(5,2),
    fallback_rate          NUMERIC(5,2),
    avg_confidence         NUMERIC(5,2),
    computed_at            TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.performance_by_intent (
    id                   SERIAL PRIMARY KEY,
    company_id           TEXT NOT NULL DEFAULT 'default',
    intent               TEXT NOT NULL,
    prompt_version_id    INTEGER,
    period_start         TIMESTAMPTZ NOT NULL,
    period_end           TIMESTAMPTZ NOT NULL,
    total_predictions    INTEGER DEFAULT 0,
    correct_predictions  INTEGER DEFAULT 0,
    accuracy_rate        NUMERIC(5,2),
    avg_confidence       NUMERIC(5,2),
    created_at           TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.performance_daily (
    id                    SERIAL PRIMARY KEY,
    company_id            TEXT NOT NULL DEFAULT 'default',
    date                  DATE NOT NULL,
    prompt_version_id     INTEGER,
    total_predictions     INTEGER DEFAULT 0,
    intent_accuracy       NUMERIC(5,2),
    routing_accuracy      NUMERIC(5,2),
    approval_accuracy     NUMERIC(5,2),
    correction_rate       NUMERIC(5,2),
    fallback_rate         NUMERIC(5,2),
    low_confidence_rate   NUMERIC(5,2),
    total_corrections     INTEGER DEFAULT 0,
    total_fallbacks       INTEGER DEFAULT 0,
    total_low_confidence  INTEGER DEFAULT 0,
    avg_confidence        NUMERIC(5,2),
    avg_llm_latency_ms    NUMERIC,
    p95_llm_latency_ms    NUMERIC,
    created_at            TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.prompt_test_results (
    id                SERIAL PRIMARY KEY,
    prompt_version_id INTEGER NOT NULL,
    test_case_id      INTEGER,
    company_id        TEXT DEFAULT 'default',
    input_text        TEXT NOT NULL,
    expected_intent   TEXT,
    predicted_intent  TEXT,
    expected_routing  TEXT,
    predicted_routing TEXT,
    confidence        NUMERIC,
    passed            BOOLEAN,
    error_message     TEXT,
    latency_ms        INTEGER,
    created_at        TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.routing_rules (
    id            SERIAL PRIMARY KEY,
    company_id    TEXT NOT NULL DEFAULT 'default',
    intent        TEXT NOT NULL,
    conditions    JSONB,
    target_team   TEXT NOT NULL,
    priority      INTEGER DEFAULT 0,
    is_active     BOOLEAN DEFAULT true,
    created_by    TEXT,
    created_at    TIMESTAMPTZ DEFAULT now(),
    updated_at    TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.sla_matrix (
    id          SERIAL PRIMARY KEY,
    company_id  TEXT NOT NULL DEFAULT 'default',
    intent      TEXT NOT NULL,
    priority    TEXT NOT NULL,
    sla_hours   NUMERIC NOT NULL,
    is_active   BOOLEAN DEFAULT true,
    created_at  TIMESTAMPTZ DEFAULT now(),
    updated_at  TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.training_dataset (
    id                   SERIAL PRIMARY KEY,
    company_id           TEXT NOT NULL DEFAULT 'default',
    source_task_id       INTEGER,
    correction_id        INTEGER,
    original_message     TEXT NOT NULL,
    field_corrected      TEXT NOT NULL,
    predicted_intent     TEXT,
    predicted_routing    TEXT,
    predicted_priority   TEXT,
    predicted_sla_hours  NUMERIC,
    predicted_approval   TEXT,
    predicted_confidence NUMERIC,
    correct_value        TEXT NOT NULL,
    prompt_version_id    INTEGER,
    split_tag            TEXT DEFAULT 'train',
    is_active            BOOLEAN DEFAULT true,
    corrected_by         TEXT,
    corrected_at         TIMESTAMPTZ DEFAULT now(),
    created_at           TIMESTAMPTZ DEFAULT now()
);

-- ────────────────────────────────────────────────────────────
-- BAGIAN 3: Tabel baru — Sport Center (6 tabel)
-- ────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS sport_center.company_invoice_settings (
    id              SERIAL PRIMARY KEY,
    company_name    TEXT,
    address         TEXT,
    phone           TEXT,
    email           TEXT,
    logo_url        TEXT,
    invoice_prefix  TEXT DEFAULT 'INV',
    tax_rate        NUMERIC(5,2) DEFAULT 11,
    bank_name       TEXT,
    bank_account    TEXT,
    bank_account_name TEXT,
    finance_name    TEXT,
    finance_title   TEXT,
    signature_url   TEXT,
    footer_text     TEXT,
    kop_surat_html  TEXT,
    is_active       BOOLEAN DEFAULT true,
    created_at      TIMESTAMPTZ DEFAULT now(),
    updated_at      TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE IF NOT EXISTS sport_center.document_file_templates (
    id           SERIAL PRIMARY KEY,
    name         TEXT NOT NULL,
    type         TEXT NOT NULL,
    file_url     TEXT,
    description  TEXT,
    is_active    BOOLEAN DEFAULT true,
    created_at   TIMESTAMPTZ DEFAULT now(),
    updated_at   TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE IF NOT EXISTS sport_center.gym_memberships (
    id              SERIAL PRIMARY KEY,
    customer_id     INTEGER NOT NULL,
    plan_name       TEXT NOT NULL,
    start_date      DATE NOT NULL,
    end_date        DATE NOT NULL,
    status          TEXT DEFAULT 'active',
    price           NUMERIC(12,2),
    notes           TEXT,
    created_at      TIMESTAMPTZ DEFAULT now(),
    updated_at      TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE IF NOT EXISTS sport_center.payments (
    id              SERIAL PRIMARY KEY,
    booking_id      INTEGER,
    amount          NUMERIC(12,2) NOT NULL,
    method          TEXT,
    status          TEXT DEFAULT 'pending',
    reference_number TEXT,
    paid_at         TIMESTAMPTZ,
    notes           TEXT,
    created_at      TIMESTAMPTZ DEFAULT now(),
    updated_at      TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE IF NOT EXISTS sport_center.settings (
    id              SERIAL PRIMARY KEY,
    center_name     TEXT,
    address         TEXT,
    phone           TEXT,
    email           TEXT,
    whatsapp        TEXT,
    open_hour       TEXT DEFAULT '06:00',
    close_hour      TEXT DEFAULT '22:00',
    bank_name       TEXT,
    bank_account    TEXT,
    bank_account_name TEXT,
    logo_url        TEXT,
    qris_image_url  TEXT,
    app_url         TEXT,
    payment_domain  TEXT,
    fonnte_token    TEXT,
    fonnte_admin_wa TEXT,
    admin_wa_phones TEXT,
    created_at      TIMESTAMPTZ DEFAULT now(),
    updated_at      TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE IF NOT EXISTS sport_center.system_connection_baselines (
    id              SERIAL PRIMARY KEY,
    service_name    TEXT NOT NULL,
    endpoint        TEXT,
    last_checked_at TIMESTAMPTZ DEFAULT now(),
    status          TEXT DEFAULT 'unknown',
    latency_ms      INTEGER,
    error_message   TEXT,
    created_at      TIMESTAMPTZ DEFAULT now()
);

COMMIT;
