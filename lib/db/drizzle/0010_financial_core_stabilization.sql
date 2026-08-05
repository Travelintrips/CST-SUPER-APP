-- ─────────────────────────────────────────────────────────────────────────────
-- FINANCIAL CORE STABILIZATION
-- Ledger Immutable Layer, Period Status, Reconciliation Engine, Audit Snapshot
-- ─────────────────────────────────────────────────────────────────────────────

-- ── 1. fleet_ledger_entries — append-only immutable ledger ──────────────────
CREATE TABLE IF NOT EXISTS fleet_ledger_entries (
  id              bigserial     PRIMARY KEY,
  company_id      integer       NOT NULL,
  ledger_date     date          NOT NULL,
  period          text          NOT NULL,
  -- Source reference
  source_type     text          NOT NULL,
  source_id       integer,
  source_ref      text,
  -- Account (denormalized for immutability)
  account_id      integer       NOT NULL REFERENCES chart_of_accounts(id),
  account_code    text          NOT NULL,
  account_name    text          NOT NULL,
  account_type    text          NOT NULL,
  -- Amount
  debit           numeric(15,2) NOT NULL DEFAULT 0,
  credit          numeric(15,2) NOT NULL DEFAULT 0,
  -- Metadata
  description     text,
  cost_center_id  integer,
  currency        text          NOT NULL DEFAULT 'IDR',
  -- Void support: never DELETE, create counter-entry
  is_voided       boolean       NOT NULL DEFAULT false,
  void_ref_id     bigint,
  -- Audit
  created_by      text,
  created_at      timestamptz   NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS fle_company_period_idx ON fleet_ledger_entries(company_id, period);
CREATE INDEX IF NOT EXISTS fle_account_period_idx ON fleet_ledger_entries(account_id, period);
CREATE INDEX IF NOT EXISTS fle_source_idx          ON fleet_ledger_entries(source_type, source_id);
CREATE INDEX IF NOT EXISTS fle_date_idx            ON fleet_ledger_entries(ledger_date);
CREATE INDEX IF NOT EXISTS fle_voided_idx          ON fleet_ledger_entries(is_voided) WHERE is_voided = false;

-- ── 2. Immutability trigger: core fields CANNOT be updated, rows CANNOT be deleted
CREATE OR REPLACE FUNCTION fn_fleet_ledger_immutable()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'LEDGER_IMMUTABLE: Ledger entries cannot be deleted (id=%).',  OLD.id;
  END IF;
  IF TG_OP = 'UPDATE' THEN
    IF NEW.id           <> OLD.id          OR
       NEW.debit        <> OLD.debit        OR
       NEW.credit       <> OLD.credit       OR
       NEW.account_id   <> OLD.account_id   OR
       (NEW.source_id IS DISTINCT FROM OLD.source_id) OR
       NEW.ledger_date  <> OLD.ledger_date  OR
       NEW.period       <> OLD.period       OR
       NEW.source_type  <> OLD.source_type  THEN
      RAISE EXCEPTION 'LEDGER_IMMUTABLE: Core ledger fields are immutable (id=%).',  OLD.id;
    END IF;
    IF NEW.is_voided = false AND OLD.is_voided = true THEN
      RAISE EXCEPTION 'LEDGER_IMMUTABLE: Cannot un-void a ledger entry (id=%).', OLD.id;
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_fleet_ledger_immutable ON fleet_ledger_entries;
CREATE TRIGGER trg_fleet_ledger_immutable
  BEFORE UPDATE OR DELETE ON fleet_ledger_entries
  FOR EACH ROW EXECUTE FUNCTION fn_fleet_ledger_immutable();

-- ── 3. Auto-sync trigger: accounting_entry_lines → fleet_ledger_entries ──────
CREATE OR REPLACE FUNCTION fn_sync_entry_line_to_ledger()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
DECLARE
  v_entry  accounting_entries%ROWTYPE;
  v_coa    chart_of_accounts%ROWTYPE;
BEGIN
  SELECT * INTO v_entry FROM accounting_entries WHERE id = NEW.entry_id;
  SELECT * INTO v_coa   FROM chart_of_accounts   WHERE id = NEW.account_id;
  IF v_entry.id IS NULL OR v_coa.id IS NULL THEN
    RETURN NEW;
  END IF;
  INSERT INTO fleet_ledger_entries (
    company_id, ledger_date, period,
    source_type, source_id, source_ref,
    account_id, account_code, account_name, account_type,
    debit, credit, description, cost_center_id
  ) VALUES (
    COALESCE(v_entry.company_id, 0),
    v_entry.date::date,
    TO_CHAR(v_entry.date::date, 'YYYY-MM'),
    COALESCE(v_entry.source::text, 'manual'),
    v_entry.id,
    v_entry.entry_number,
    NEW.account_id,
    v_coa.code,
    v_coa.name,
    v_coa.type::text,
    COALESCE(NEW.debit::numeric,  0),
    COALESCE(NEW.credit::numeric, 0),
    COALESCE(NEW.description, v_entry.description),
    v_entry.cost_center_id
  );
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_entry_line_to_ledger ON accounting_entry_lines;
CREATE TRIGGER trg_entry_line_to_ledger
  AFTER INSERT ON accounting_entry_lines
  FOR EACH ROW EXECUTE FUNCTION fn_sync_entry_line_to_ledger();

-- ── 4. VIEW: journal layer derived from ledger (not accounting_entries directly)
CREATE OR REPLACE VIEW v_ledger_journal_view AS
SELECT
  fle.company_id,
  fle.period,
  fle.ledger_date,
  fle.source_type,
  fle.source_id,
  fle.source_ref      AS entry_number,
  fle.account_id,
  fle.account_code,
  fle.account_name,
  fle.account_type,
  SUM(fle.debit)      AS total_debit,
  SUM(fle.credit)     AS total_credit,
  COUNT(fle.id)       AS line_count
FROM fleet_ledger_entries fle
WHERE fle.is_voided = false
GROUP BY
  fle.company_id, fle.period, fle.ledger_date,
  fle.source_type, fle.source_id, fle.source_ref,
  fle.account_id, fle.account_code, fle.account_name, fle.account_type;

-- ── 5. VIEW: account balances from ledger (source of truth for all reports)
CREATE OR REPLACE VIEW v_ledger_balance_view AS
SELECT
  company_id,
  period,
  account_id,
  account_code,
  account_name,
  account_type,
  SUM(debit)              AS total_debit,
  SUM(credit)             AS total_credit,
  SUM(debit) - SUM(credit) AS net_balance
FROM fleet_ledger_entries
WHERE is_voided = false
GROUP BY company_id, period, account_id, account_code, account_name, account_type;

-- ── 6. Period status enhancement (open / closing / closed) ───────────────────
ALTER TABLE financial_periods ADD COLUMN IF NOT EXISTS period_status text NOT NULL DEFAULT 'open';
UPDATE financial_periods SET period_status = 'closed' WHERE is_closed = true;

-- ── 7. Snapshot hash for audit trail ─────────────────────────────────────────
ALTER TABLE ledger_snapshots ADD COLUMN IF NOT EXISTS snapshot_hash text;

-- ── 8. financial_reconciliation_reports ──────────────────────────────────────
CREATE TABLE IF NOT EXISTS financial_reconciliation_reports (
  id              serial        PRIMARY KEY,
  company_id      integer       NOT NULL,
  period          text          NOT NULL,
  run_at          timestamptz   NOT NULL DEFAULT NOW(),
  run_by          text,
  status          text          NOT NULL DEFAULT 'pending',
  -- Totals from each source
  ledger_debit    numeric(15,2),
  ledger_credit   numeric(15,2),
  journal_debit   numeric(15,2),
  journal_credit  numeric(15,2),
  payment_total   numeric(15,2),
  -- Computed diff
  debit_diff      numeric(15,2),
  credit_diff     numeric(15,2),
  mismatch_count  integer       DEFAULT 0,
  -- Detail payload
  discrepancies   jsonb,
  notes           text
);

CREATE INDEX IF NOT EXISTS frr_company_period_idx ON financial_reconciliation_reports(company_id, period);
CREATE INDEX IF NOT EXISTS frr_run_at_idx          ON financial_reconciliation_reports(run_at DESC);
