/*
  PROD ORPHAN ACCOUNTING REPAIR

  Tujuan:
    1. Melepas tiga approved match yang menunjuk vendor_invoice #2
       yang sudah tidak ada.
    2. Mengembalikan tiga bank mutation orphan dari posted ke unmatched.
    3. Menandai accounting_payment #666 sebagai rejected karena tidak memiliki
       accounting_entries transaksi.
    4. Mengembalikan source tenant_payment #105 ke posting_status=unposted.

  PENTING:
    - Jalankan hanya pada database PROD kanonis yang sudah diverifikasi.
    - Jangan menempelkan credential ke file ini atau chat.
    - Script ini TIDAK membuat reversal journal karena journal_entry_id
      untuk tiga mutation sudah menunjuk entry yang tidak ada.
    - Script ini sengaja tidak mengubah tenant_payments.status dari PAID.
      Status PAID adalah status operasional sumber dan membutuhkan bukti
      pembayaran/reversal terpisah untuk diubah.
    - Jika satu saja precondition berbeda, transaction dibatalkan.
    - Script ini tidak boleh dijalankan bersamaan dengan proses reconciliation.

  Target bank mutation:
    4863  Rp12.327.111  2026-07-20
    4940  Rp 3.984.256  2026-08-11
    4967  Rp15.200.640  2026-08-20

  Target accounting payment:
    accounting_payments.id = 666
    tenant_payments.id = 105
*/

BEGIN;

SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '60s';

-- Serialisasi terhadap repair yang sama dan proses maintenance lain yang
-- menggunakan lock key ini.
SELECT pg_advisory_xact_lock(hashtext('cst-prod-orphan-accounting-repair-v1'));

CREATE TEMP TABLE _orphan_bank_targets (
  mutation_id INTEGER PRIMARY KEY,
  expected_amount NUMERIC(16, 2) NOT NULL,
  expected_date DATE NOT NULL
) ON COMMIT DROP;

INSERT INTO _orphan_bank_targets (mutation_id, expected_amount, expected_date)
VALUES
  (4863, 12327111.00, DATE '2026-07-20'),
  (4940,  3984256.00, DATE '2026-08-11'),
  (4967, 15200640.00, DATE '2026-08-20');

/*
  PRECHECK 1: exact bank targets, amounts, dates, and orphaned journal links.
*/
DO $$
DECLARE
  target_count INTEGER;
  approved_match_count INTEGER;
BEGIN
  SELECT COUNT(*)
    INTO target_count
  FROM bank_mutations bm
  JOIN _orphan_bank_targets t ON t.mutation_id = bm.id
  WHERE bm.amount = t.expected_amount
    AND bm.transaction_date = t.expected_date
    AND bm.status::text = 'posted'
    AND bm.accounting_posted IS FALSE
    AND bm.journal_entry_id IS NOT NULL
    AND NOT EXISTS (
      SELECT 1
      FROM accounting_entries ae
      WHERE ae.id = bm.journal_entry_id
    );

  IF target_count <> 3 THEN
    RAISE EXCEPTION
      'PRECHECK_FAILED bank targets: expected 3 exact orphan rows, got %',
      target_count;
  END IF;

  SELECT COUNT(*)
    INTO approved_match_count
  FROM bank_reconciliation_matches brm
  JOIN _orphan_bank_targets t ON t.mutation_id = brm.mutation_id
  WHERE brm.status::text = 'approved'
    AND brm.candidate_type = 'vendor_invoice'
    AND brm.candidate_id = 2;

  IF approved_match_count <> 3 THEN
    RAISE EXCEPTION
      'PRECHECK_FAILED approved matches: expected 3 vendor_invoice #2 matches, got %',
      approved_match_count;
  END IF;

  IF EXISTS (
    SELECT 1
    FROM bank_reconciliation_matches brm
    JOIN _orphan_bank_targets t ON t.mutation_id = brm.mutation_id
    WHERE brm.status::text = 'approved'
      AND NOT (
        brm.candidate_type = 'vendor_invoice'
        AND brm.candidate_id = 2
      )
  ) THEN
    RAISE EXCEPTION
      'PRECHECK_FAILED: a target mutation has another approved match';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM vendor_invoices
    WHERE id = 2
  ) THEN
    RAISE EXCEPTION
      'PRECHECK_FAILED: vendor_invoice #2 exists; refusing stale-link repair';
  END IF;
END
$$;

/*
  PRECHECK 2: orphan accounting payment and source payment must still match
  the read-only audit. The source remains PAID; only its accounting posting
  state is repaired.
*/
DO $$
DECLARE
  payment_count INTEGER;
  source_count INTEGER;
  rejected_enum_exists BOOLEAN;
BEGIN
  SELECT EXISTS (
    SELECT 1
    FROM pg_enum e
    JOIN pg_type t ON t.oid = e.enumtypid
    WHERE t.typname = 'accounting_payment_status'
      AND e.enumlabel = 'rejected'
  )
  INTO rejected_enum_exists;

  IF NOT rejected_enum_exists THEN
    RAISE EXCEPTION
      'PRECHECK_FAILED: accounting_payment_status.rejected is unavailable';
  END IF;

  SELECT COUNT(*)
    INTO payment_count
  FROM accounting_payments ap
  WHERE ap.id = 666
    AND ap.amount = 3000000.00
    AND ap.status::text = 'posted'
    AND ap.entry_id IS NULL
    AND ap.journal_id = 8194
    AND ap.source_doc_id = 105;

  IF payment_count <> 1 THEN
    RAISE EXCEPTION
      'PRECHECK_FAILED accounting_payment #666 does not match the audited orphan state';
  END IF;

  SELECT COUNT(*)
    INTO source_count
  FROM tenant_payments tp
  WHERE tp.id = 105
    AND tp.status::text = 'PAID'
    AND tp.posting_status::text = 'unposted'
    AND tp.accounting_payment_id IS NULL;

  IF source_count <> 1 THEN
    RAISE EXCEPTION
      'PRECHECK_FAILED tenant_payment #105 does not match the audited source state';
  END IF;
END
$$;

/*
  Lock every row before mutation. The order is deterministic to reduce
  deadlock risk with another maintenance session.
*/
SELECT bm.id
FROM bank_mutations bm
JOIN _orphan_bank_targets t ON t.mutation_id = bm.id
ORDER BY bm.id
FOR UPDATE;

SELECT brm.id
FROM bank_reconciliation_matches brm
JOIN _orphan_bank_targets t ON t.mutation_id = brm.mutation_id
WHERE brm.status::text = 'approved'
ORDER BY brm.id
FOR UPDATE;

SELECT id
FROM accounting_payments
WHERE id = 666
FOR UPDATE;

SELECT id
FROM tenant_payments
WHERE id = 105
FOR UPDATE;

/*
  Append audit records before changing the rows. The audit rows and data
  changes commit or roll back together.
*/
INSERT INTO bank_reconciliation_audit (mutation_id, action, actor, meta)
SELECT
  bm.id,
  'ORPHAN_ACCOUNTING_REPAIR',
  'manual-prod-orphan-repair',
  jsonb_build_object(
    'reason', 'approved vendor_invoice match points to missing vendor_invoice and journal entry is missing',
    'old_status', bm.status,
    'old_journal_entry_id', bm.journal_entry_id,
    'old_accounting_posted', bm.accounting_posted,
    'old_match_status', 'approved',
    'candidate_type', 'vendor_invoice',
    'candidate_id', 2,
    'repair_scope', 'bank_mutation_and_match_only'
  )
FROM bank_mutations bm
JOIN _orphan_bank_targets t ON t.mutation_id = bm.id;

INSERT INTO erp_audit_logs (
  company_id,
  action,
  module,
  reference_id,
  old_data,
  new_data,
  created_at
)
SELECT
  bm.company_id,
  'orphan_accounting_repair',
  'bank-reconciliation',
  'bank-mutation:' || bm.id::text,
  jsonb_build_object(
    'status', bm.status,
    'journal_entry_id', bm.journal_entry_id,
    'accounting_posted', bm.accounting_posted,
    'approved_match', true,
    'candidate_type', 'vendor_invoice',
    'candidate_id', 2
  ),
  jsonb_build_object(
    'status', 'unmatched',
    'journal_entry_id', NULL,
    'accounting_posted', false,
    'approved_match', false,
    'repair_reason', 'orphaned journal link and missing vendor invoice'
  ),
  NOW()
FROM bank_mutations bm
JOIN _orphan_bank_targets t ON t.mutation_id = bm.id;

INSERT INTO erp_audit_logs (
  action,
  module,
  reference_id,
  old_data,
  new_data,
  created_at
)
VALUES (
  'orphan_accounting_repair',
  'accounting',
  'accounting-payment:666',
  jsonb_build_object(
    'accounting_payment_id', 666,
    'status', 'posted',
    'entry_id', NULL,
    'amount', 3000000.00,
    'journal_id', 8194,
    'source_doc_id', 105,
    'source_status', 'PAID',
    'source_posting_status', 'unposted'
  ),
  jsonb_build_object(
    'accounting_payment_id', 666,
    'status', 'rejected',
    'entry_id', NULL,
    'source_status', 'PAID',
    'source_posting_status', 'unposted',
    'repair_reason', 'posted accounting payment has no transaction journal entry'
  ),
  NOW()
);

/*
  Repair stale approved matches. They are rejected rather than deleted so the
  missing source remains visible in reconciliation history.
*/
DO $$
DECLARE
  changed_count INTEGER;
BEGIN
  UPDATE bank_reconciliation_matches brm
  SET status = 'rejected'
  FROM _orphan_bank_targets t
  WHERE brm.mutation_id = t.mutation_id
    AND brm.status::text = 'approved'
    AND brm.candidate_type = 'vendor_invoice'
    AND brm.candidate_id = 2;

  GET DIAGNOSTICS changed_count = ROW_COUNT;
  IF changed_count <> 3 THEN
    RAISE EXCEPTION
      'REPAIR_FAILED match rejection affected %, expected 3',
      changed_count;
  END IF;
END
$$;

/*
  The journal entries are already absent, so no posted ledger row is touched.
  Clear only the broken operational link and return the bank mutations to the
  normal matching queue.
*/
DO $$
DECLARE
  changed_count INTEGER;
BEGIN
  UPDATE bank_mutations bm
  SET status = 'unmatched',
      journal_entry_id = NULL,
      accounting_posted = false,
      approved_by = NULL,
      approved_at = NULL,
      posted_by = NULL,
      posted_at = NULL,
      updated_at = NOW()
  FROM _orphan_bank_targets t
  WHERE bm.id = t.mutation_id
    AND bm.status::text = 'posted'
    AND bm.accounting_posted IS FALSE
    AND bm.journal_entry_id IS NOT NULL;

  GET DIAGNOSTICS changed_count = ROW_COUNT;
  IF changed_count <> 3 THEN
    RAISE EXCEPTION
      'REPAIR_FAILED bank mutation reset affected %, expected 3',
      changed_count;
  END IF;
END
$$;

/*
  Mark the orphan accounting mirror rejected. This is not a void: there is no
  transaction journal and therefore no reversal entry to create.
*/
DO $$
DECLARE
  changed_count INTEGER;
BEGIN
  UPDATE accounting_payments
  SET status = 'rejected',
      void_reason = 'ORPHAN_REPAIR: posted accounting payment had no transaction journal entry; source tenant_payment #105 remains PAID/unposted'
  WHERE id = 666
    AND amount = 3000000.00
    AND status::text = 'posted'
    AND entry_id IS NULL
    AND journal_id = 8194
    AND source_doc_id = 105;

  GET DIAGNOSTICS changed_count = ROW_COUNT;
  IF changed_count <> 1 THEN
    RAISE EXCEPTION
      'REPAIR_FAILED accounting payment reset affected %, expected 1',
      changed_count;
  END IF;
END
$$;

/*
  Keep the operational source PAID, but make the missing accounting posting
  explicit and retryable. Do not invent a reversal or unsettle the payment.
*/
DO $$
DECLARE
  changed_count INTEGER;
BEGIN
  UPDATE tenant_payments
  SET posting_status = 'unposted',
      accounting_payment_id = NULL,
      posting_error = 'ORPHAN_REPAIR: accounting_payment #666 rejected because no transaction journal entry exists; source remains PAID'
  WHERE id = 105
    AND status::text = 'PAID'
    AND posting_status::text = 'unposted'
    AND accounting_payment_id IS NULL;

  GET DIAGNOSTICS changed_count = ROW_COUNT;
  IF changed_count <> 1 THEN
    RAISE EXCEPTION
      'REPAIR_FAILED tenant payment source update affected %, expected 1',
      changed_count;
  END IF;
END
$$;

/*
  FINAL VERIFICATION before COMMIT.
*/
DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM bank_mutations bm
    JOIN _orphan_bank_targets t ON t.mutation_id = bm.id
    WHERE bm.status::text <> 'unmatched'
       OR bm.journal_entry_id IS NOT NULL
       OR bm.accounting_posted IS DISTINCT FROM false
  ) THEN
    RAISE EXCEPTION
      'FINAL_VERIFY_FAILED bank mutation still has posted/link state';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM bank_reconciliation_matches brm
    JOIN _orphan_bank_targets t ON t.mutation_id = brm.mutation_id
    WHERE brm.status::text = 'approved'
  ) THEN
    RAISE EXCEPTION
      'FINAL_VERIFY_FAILED an approved stale match remains';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM accounting_payments ap
    WHERE ap.id = 666
      AND ap.status::text = 'rejected'
      AND ap.entry_id IS NULL
  ) THEN
    RAISE EXCEPTION
      'FINAL_VERIFY_FAILED accounting payment #666 is not rejected orphan state';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM tenant_payments tp
    WHERE tp.id = 105
      AND tp.status::text = 'PAID'
      AND tp.posting_status::text = 'unposted'
      AND tp.accounting_payment_id IS NULL
  ) THEN
    RAISE EXCEPTION
      'FINAL_VERIFY_FAILED tenant payment #105 source state changed unexpectedly';
  END IF;
END
$$;

COMMIT;

-- Post-commit verification output.
SELECT
  id AS mutation_id,
  status,
  journal_entry_id,
  accounting_posted,
  updated_at
FROM bank_mutations
WHERE id IN (4863, 4940, 4967)
ORDER BY id;

SELECT
  id,
  status,
  entry_id,
  void_entry_id,
  void_reason
FROM accounting_payments
WHERE id = 666;

SELECT
  id,
  status,
  posting_status,
  posting_error,
  accounting_payment_id
FROM tenant_payments
WHERE id = 105;