/*
 * CST Vendor Payable correction
 *
 * Purpose:
 * 1. Point accounting_settings.ap_account_id to the postable child
 *    2-1012-CST — Hutang Pemasok/Vendor.
 * 2. Reclassify the two verified historical vendor-payment journals that
 *    debited the parent 2-1010-CST.
 *
 * Safety:
 * - Intended for production company_id = 1 only.
 * - Does not UPDATE or DELETE posted journal lines.
 * - Creates balanced additive correction journals.
 * - Idempotent by deterministic entry_number and ref.
 * - Fails closed if the verified COA hierarchy or source journals changed.
 *
 * Run the whole script as one transaction in the Supabase SQL editor.
 */

BEGIN;

DO $$
DECLARE
  v_company_id       integer := 1;
  v_parent_account   integer;
  v_child_account    integer;
  v_current_ap       integer;
  v_source           record;
  v_reclass_entry_id integer;
  v_amount           numeric(14,2);
  v_entry_number     text;
  v_ref              text;
  v_source_count     integer := 0;
BEGIN
  -- Serialize this repair for CST.
  PERFORM pg_advisory_xact_lock(hashtext('cst-vendor-payable-matching-reclass-v1'));

  SELECT id
  INTO STRICT v_parent_account
  FROM chart_of_accounts
  WHERE company_id = v_company_id
    AND code = '2-1010-CST'
    AND name = 'Hutang Usaha CST';

  SELECT id
  INTO STRICT v_child_account
  FROM chart_of_accounts
  WHERE company_id = v_company_id
    AND code = '2-1012-CST'
    AND name = 'Hutang Pemasok/Vendor'
    AND parent_id = v_parent_account
    AND is_postable = TRUE;

  SELECT ap_account_id
  INTO STRICT v_current_ap
  FROM accounting_settings
  WHERE company_id = v_company_id
  FOR UPDATE;

  IF v_current_ap NOT IN (v_parent_account, v_child_account) THEN
    RAISE EXCEPTION
      'Accounting Settings AP account changed unexpectedly: current=%, expected parent=% or child=%',
      v_current_ap, v_parent_account, v_child_account;
  END IF;

  -- Future invoice and bank-mutation vendor matching use the posting child.
  UPDATE accounting_settings
  SET ap_account_id = v_child_account,
      updated_at = NOW()
  WHERE company_id = v_company_id
    AND ap_account_id = v_parent_account;

  /*
   * Verified historical payment journals:
   *   33485 — BNK-CST/2026/000140 — Rp12,480,000
   *   33486 — BNK-CST/2026/000141 — Rp11,303,171
   *
   * Existing wrong payment:
   *   DR parent Hutang Usaha / CR Bank
   *
   * Additive correction:
   *   DR child Hutang Pemasok / CR parent Hutang Usaha
   */
  FOR v_source IN
    SELECT ae.id, ae.entry_number, ae.journal_id
    FROM accounting_entries ae
    WHERE ae.id = ANY (ARRAY[33485, 33486])
      AND ae.company_id = v_company_id
      AND ae.status = 'posted'
      AND ae.source = 'bank_reconciliation'
      AND ae.source_module = 'vendor_invoice_payment'
    ORDER BY ae.id
    FOR UPDATE
  LOOP
    v_source_count := v_source_count + 1;

    SELECT COALESCE(SUM(el.debit - el.credit), 0)
    INTO v_amount
    FROM accounting_entry_lines el
    WHERE el.entry_id = v_source.id
      AND el.account_id = v_parent_account;

    IF v_amount <= 0 THEN
      RAISE EXCEPTION
        'Source journal % no longer has a positive debit on parent AP account',
        v_source.entry_number;
    END IF;

    IF EXISTS (
      SELECT 1
      FROM accounting_entry_lines el
      WHERE el.entry_id = v_source.id
        AND el.account_id = v_child_account
        AND (el.debit <> 0 OR el.credit <> 0)
    ) THEN
      RAISE EXCEPTION
        'Source journal % already contains the child vendor-payable account',
        v_source.entry_number;
    END IF;

    v_entry_number := 'ADJ-CST/APR-' || v_source.id::text;
    v_ref := 'AP-RECLASS:' || v_source.entry_number;

    -- Deterministic entry identity makes a rerun a no-op.
    IF EXISTS (
      SELECT 1
      FROM accounting_entries
      WHERE company_id = v_company_id
        AND entry_number = v_entry_number
        AND ref = v_ref
        AND source_module = 'vendor_invoice_payment_reclass'
        AND status = 'posted'
    ) THEN
      CONTINUE;
    END IF;

    IF EXISTS (
      SELECT 1
      FROM accounting_entries
      WHERE entry_number = v_entry_number
         OR (
           company_id = v_company_id
           AND ref = v_ref
           AND status IN ('draft', 'pending', 'approved', 'posted')
         )
    ) THEN
      RAISE EXCEPTION
        'Conflicting correction journal already exists for %',
        v_source.entry_number;
    END IF;

    -- Draft first: production guards reject line insertion into posted entries.
    INSERT INTO accounting_entries (
      company_id,
      entry_number,
      journal_id,
      date,
      ref,
      description,
      status,
      source,
      source_module,
      total_debit,
      total_credit,
      created_by_id,
      created_at
    )
    VALUES (
      v_company_id,
      v_entry_number,
      v_source.journal_id,
      CURRENT_DATE,
      v_ref,
      'Reklasifikasi pembayaran vendor dari parent Hutang Usaha ke child Hutang Pemasok; sumber '
        || v_source.entry_number,
      'draft',
      'manual',
      'vendor_invoice_payment_reclass',
      v_amount,
      v_amount,
      'finance-controlled-sql',
      NOW()
    )
    RETURNING id INTO v_reclass_entry_id;

    INSERT INTO accounting_entry_lines (
      entry_id, account_id, description, debit, credit
    )
    VALUES
      (
        v_reclass_entry_id,
        v_child_account,
        'Reklasifikasi ke Hutang Pemasok/Vendor — ' || v_source.entry_number,
        v_amount,
        0
      ),
      (
        v_reclass_entry_id,
        v_parent_account,
        'Membalik debit salah pada parent Hutang Usaha — ' || v_source.entry_number,
        0,
        v_amount
      );

    UPDATE accounting_entries
    SET status = 'posted',
        approved_by = 'finance-controlled-sql',
        approved_at = NOW(),
        posted_at = NOW()
    WHERE id = v_reclass_entry_id
      AND status = 'draft';

    IF NOT FOUND THEN
      RAISE EXCEPTION
        'Correction journal % could not be promoted from draft to posted',
        v_entry_number;
    END IF;
  END LOOP;

  IF v_source_count <> 2 THEN
    RAISE EXCEPTION
      'Expected exactly 2 verified source journals, found %; no changes committed',
      v_source_count;
  END IF;
END
$$;

COMMIT;

/*
 * Read-only verification. Expected:
 * - accounting_settings.ap_account_id = 76228 / 2-1012-CST
 * - two posted correction journals
 * - each correction has equal debit and credit
 */
SELECT
  s.company_id,
  s.ap_account_id,
  coa.code AS ap_code,
  coa.name AS ap_name
FROM accounting_settings s
JOIN chart_of_accounts coa ON coa.id = s.ap_account_id
WHERE s.company_id = 1;

SELECT
  ae.id,
  ae.entry_number,
  ae.date,
  ae.ref,
  ae.status,
  ae.total_debit,
  ae.total_credit,
  coa.code,
  coa.name,
  el.debit,
  el.credit
FROM accounting_entries ae
JOIN accounting_entry_lines el ON el.entry_id = ae.id
JOIN chart_of_accounts coa ON coa.id = el.account_id
WHERE ae.company_id = 1
  AND ae.source_module = 'vendor_invoice_payment_reclass'
  AND ae.ref IN (
    'AP-RECLASS:BNK-CST/2026/000140',
    'AP-RECLASS:BNK-CST/2026/000141'
  )
ORDER BY ae.id, el.id;/*
 * CST Vendor Payable correction
 *
 * Purpose:
 * 1. Point accounting_settings.ap_account_id to the postable child
 *    2-1012-CST — Hutang Pemasok/Vendor.
 * 2. Reclassify the two verified historical vendor-payment journals that
 *    debited the parent 2-1010-CST.
 *
 * Safety:
 * - Intended for production company_id = 1 only.
 * - Does not UPDATE or DELETE posted journal lines.
 * - Creates balanced additive correction journals.
 * - Idempotent by deterministic entry_number and ref.
 * - Fails closed if the verified COA hierarchy or source journals changed.
 *
 * Run the whole script as one transaction in the Supabase SQL editor.
 */

BEGIN;

DO $$
DECLARE
  v_company_id       integer := 1;
  v_parent_account   integer;
  v_child_account    integer;
  v_current_ap       integer;
  v_source           record;
  v_reclass_entry_id integer;
  v_amount           numeric(14,2);
  v_entry_number     text;
  v_ref              text;
  v_source_count     integer := 0;
BEGIN
  -- Serialize this repair for CST.
  PERFORM pg_advisory_xact_lock(hashtext('cst-vendor-payable-matching-reclass-v1'));

  SELECT id
  INTO STRICT v_parent_account
  FROM chart_of_accounts
  WHERE company_id = v_company_id
    AND code = '2-1010-CST'
    AND name = 'Hutang Usaha CST';

  SELECT id
  INTO STRICT v_child_account
  FROM chart_of_accounts
  WHERE company_id = v_company_id
    AND code = '2-1012-CST'
    AND name = 'Hutang Pemasok/Vendor'
    AND parent_id = v_parent_account
    AND is_postable = TRUE;

  SELECT ap_account_id
  INTO STRICT v_current_ap
  FROM accounting_settings
  WHERE company_id = v_company_id
  FOR UPDATE;

  IF v_current_ap NOT IN (v_parent_account, v_child_account) THEN
    RAISE EXCEPTION
      'Accounting Settings AP account changed unexpectedly: current=%, expected parent=% or child=%',
      v_current_ap, v_parent_account, v_child_account;
  END IF;

  -- Future invoice and bank-mutation vendor matching use the posting child.
  UPDATE accounting_settings
  SET ap_account_id = v_child_account,
      updated_at = NOW()
  WHERE company_id = v_company_id
    AND ap_account_id = v_parent_account;

  /*
   * Verified historical payment journals:
   *   33485 — BNK-CST/2026/000140 — Rp12,480,000
   *   33486 — BNK-CST/2026/000141 — Rp11,303,171
   *
   * Existing wrong payment:
   *   DR parent Hutang Usaha / CR Bank
   *
   * Additive correction:
   *   DR child Hutang Pemasok / CR parent Hutang Usaha
   */
  FOR v_source IN
    SELECT ae.id, ae.entry_number, ae.journal_id
    FROM accounting_entries ae
    WHERE ae.id = ANY (ARRAY[33485, 33486])
      AND ae.company_id = v_company_id
      AND ae.status = 'posted'
      AND ae.source = 'bank_reconciliation'
      AND ae.source_module = 'vendor_invoice_payment'
    ORDER BY ae.id
    FOR UPDATE
  LOOP
    v_source_count := v_source_count + 1;

    SELECT COALESCE(SUM(el.debit - el.credit), 0)
    INTO v_amount
    FROM accounting_entry_lines el
    WHERE el.entry_id = v_source.id
      AND el.account_id = v_parent_account;

    IF v_amount <= 0 THEN
      RAISE EXCEPTION
        'Source journal % no longer has a positive debit on parent AP account',
        v_source.entry_number;
    END IF;

    IF EXISTS (
      SELECT 1
      FROM accounting_entry_lines el
      WHERE el.entry_id = v_source.id
        AND el.account_id = v_child_account
        AND (el.debit <> 0 OR el.credit <> 0)
    ) THEN
      RAISE EXCEPTION
        'Source journal % already contains the child vendor-payable account',
        v_source.entry_number;
    END IF;

    v_entry_number := 'ADJ-CST/APR-' || v_source.id::text;
    v_ref := 'AP-RECLASS:' || v_source.entry_number;

    -- Deterministic entry identity makes a rerun a no-op.
    IF EXISTS (
      SELECT 1
      FROM accounting_entries
      WHERE company_id = v_company_id
        AND entry_number = v_entry_number
        AND ref = v_ref
        AND source_module = 'vendor_invoice_payment_reclass'
        AND status = 'posted'
    ) THEN
      CONTINUE;
    END IF;

    IF EXISTS (
      SELECT 1
      FROM accounting_entries
      WHERE entry_number = v_entry_number
         OR (
           company_id = v_company_id
           AND ref = v_ref
           AND status IN ('draft', 'pending', 'approved', 'posted')
         )
    ) THEN
      RAISE EXCEPTION
        'Conflicting correction journal already exists for %',
        v_source.entry_number;
    END IF;

    -- Draft first: production guards reject line insertion into posted entries.
    INSERT INTO accounting_entries (
      company_id,
      entry_number,
      journal_id,
      date,
      ref,
      description,
      status,
      source,
      source_module,
      total_debit,
      total_credit,
      created_by_id,
      created_at
    )
    VALUES (
      v_company_id,
      v_entry_number,
      v_source.journal_id,
      CURRENT_DATE,
      v_ref,
      'Reklasifikasi pembayaran vendor dari parent Hutang Usaha ke child Hutang Pemasok; sumber '
        || v_source.entry_number,
      'draft',
      'manual',
      'vendor_invoice_payment_reclass',
      v_amount,
      v_amount,
      'finance-controlled-sql',
      NOW()
    )
    RETURNING id INTO v_reclass_entry_id;

    INSERT INTO accounting_entry_lines (
      entry_id, account_id, description, debit, credit
    )
    VALUES
      (
        v_reclass_entry_id,
        v_child_account,
        'Reklasifikasi ke Hutang Pemasok/Vendor — ' || v_source.entry_number,
        v_amount,
        0
      ),
      (
        v_reclass_entry_id,
        v_parent_account,
        'Membalik debit salah pada parent Hutang Usaha — ' || v_source.entry_number,
        0,
        v_amount
      );

    UPDATE accounting_entries
    SET status = 'posted',
        approved_by = 'finance-controlled-sql',
        approved_at = NOW(),
        posted_at = NOW()
    WHERE id = v_reclass_entry_id
      AND status = 'draft';

    IF NOT FOUND THEN
      RAISE EXCEPTION
        'Correction journal % could not be promoted from draft to posted',
        v_entry_number;
    END IF;
  END LOOP;

  IF v_source_count <> 2 THEN
    RAISE EXCEPTION
      'Expected exactly 2 verified source journals, found %; no changes committed',
      v_source_count;
  END IF;
END
$$;

COMMIT;

/*
 * Read-only verification. Expected:
 * - accounting_settings.ap_account_id = 76228 / 2-1012-CST
 * - two posted correction journals
 * - each correction has equal debit and credit
 */
SELECT
  s.company_id,
  s.ap_account_id,
  coa.code AS ap_code,
  coa.name AS ap_name
FROM accounting_settings s
JOIN chart_of_accounts coa ON coa.id = s.ap_account_id
WHERE s.company_id = 1;

SELECT
  ae.id,
  ae.entry_number,
  ae.date,
  ae.ref,
  ae.status,
  ae.total_debit,
  ae.total_credit,
  coa.code,
  coa.name,
  el.debit,
  el.credit
FROM accounting_entries ae
JOIN accounting_entry_lines el ON el.entry_id = ae.id
JOIN chart_of_accounts coa ON coa.id = el.account_id
WHERE ae.company_id = 1
  AND ae.source_module = 'vendor_invoice_payment_reclass'
  AND ae.ref IN (
    'AP-RECLASS:BNK-CST/2026/000140',
    'AP-RECLASS:BNK-CST/2026/000141'
  )
ORDER BY ae.id, el.id;/*
 * CST Vendor Payable correction
 *
 * Purpose:
 * 1. Point accounting_settings.ap_account_id to the postable child
 *    2-1012-CST — Hutang Pemasok/Vendor.
 * 2. Reclassify the two verified historical vendor-payment journals that
 *    debited the parent 2-1010-CST.
 *
 * Safety:
 * - Intended for production company_id = 1 only.
 * - Does not UPDATE or DELETE posted journal lines.
 * - Creates balanced additive correction journals.
 * - Idempotent by deterministic entry_number and ref.
 * - Fails closed if the verified COA hierarchy or source journals changed.
 *
 * Run the whole script as one transaction in the Supabase SQL editor.
 */

BEGIN;

DO $$
DECLARE
  v_company_id       integer := 1;
  v_parent_account   integer;
  v_child_account    integer;
  v_current_ap       integer;
  v_source           record;
  v_reclass_entry_id integer;
  v_amount           numeric(14,2);
  v_entry_number     text;
  v_ref              text;
  v_source_count     integer := 0;
BEGIN
  -- Serialize this repair for CST.
  PERFORM pg_advisory_xact_lock(hashtext('cst-vendor-payable-matching-reclass-v1'));

  SELECT id
  INTO STRICT v_parent_account
  FROM chart_of_accounts
  WHERE company_id = v_company_id
    AND code = '2-1010-CST'
    AND name = 'Hutang Usaha CST';

  SELECT id
  INTO STRICT v_child_account
  FROM chart_of_accounts
  WHERE company_id = v_company_id
    AND code = '2-1012-CST'
    AND name = 'Hutang Pemasok/Vendor'
    AND parent_id = v_parent_account
    AND is_postable = TRUE;

  SELECT ap_account_id
  INTO STRICT v_current_ap
  FROM accounting_settings
  WHERE company_id = v_company_id
  FOR UPDATE;

  IF v_current_ap NOT IN (v_parent_account, v_child_account) THEN
    RAISE EXCEPTION
      'Accounting Settings AP account changed unexpectedly: current=%, expected parent=% or child=%',
      v_current_ap, v_parent_account, v_child_account;
  END IF;

  -- Future invoice and bank-mutation vendor matching use the posting child.
  UPDATE accounting_settings
  SET ap_account_id = v_child_account,
      updated_at = NOW()
  WHERE company_id = v_company_id
    AND ap_account_id = v_parent_account;

  /*
   * Verified historical payment journals:
   *   33485 — BNK-CST/2026/000140 — Rp12,480,000
   *   33486 — BNK-CST/2026/000141 — Rp11,303,171
   *
   * Existing wrong payment:
   *   DR parent Hutang Usaha / CR Bank
   *
   * Additive correction:
   *   DR child Hutang Pemasok / CR parent Hutang Usaha
   */
  FOR v_source IN
    SELECT ae.id, ae.entry_number, ae.journal_id
    FROM accounting_entries ae
    WHERE ae.id = ANY (ARRAY[33485, 33486])
      AND ae.company_id = v_company_id
      AND ae.status = 'posted'
      AND ae.source = 'bank_reconciliation'
      AND ae.source_module = 'vendor_invoice_payment'
    ORDER BY ae.id
    FOR UPDATE
  LOOP
    v_source_count := v_source_count + 1;

    SELECT COALESCE(SUM(el.debit - el.credit), 0)
    INTO v_amount
    FROM accounting_entry_lines el
    WHERE el.entry_id = v_source.id
      AND el.account_id = v_parent_account;

    IF v_amount <= 0 THEN
      RAISE EXCEPTION
        'Source journal % no longer has a positive debit on parent AP account',
        v_source.entry_number;
    END IF;

    IF EXISTS (
      SELECT 1
      FROM accounting_entry_lines el
      WHERE el.entry_id = v_source.id
        AND el.account_id = v_child_account
        AND (el.debit <> 0 OR el.credit <> 0)
    ) THEN
      RAISE EXCEPTION
        'Source journal % already contains the child vendor-payable account',
        v_source.entry_number;
    END IF;

    v_entry_number := 'ADJ-CST/APR-' || v_source.id::text;
    v_ref := 'AP-RECLASS:' || v_source.entry_number;

    -- Deterministic entry identity makes a rerun a no-op.
    IF EXISTS (
      SELECT 1
      FROM accounting_entries
      WHERE company_id = v_company_id
        AND entry_number = v_entry_number
        AND ref = v_ref
        AND source_module = 'vendor_invoice_payment_reclass'
        AND status = 'posted'
    ) THEN
      CONTINUE;
    END IF;

    IF EXISTS (
      SELECT 1
      FROM accounting_entries
      WHERE entry_number = v_entry_number
         OR (
           company_id = v_company_id
           AND ref = v_ref
           AND status IN ('draft', 'pending', 'approved', 'posted')
         )
    ) THEN
      RAISE EXCEPTION
        'Conflicting correction journal already exists for %',
        v_source.entry_number;
    END IF;

    -- Draft first: production guards reject line insertion into posted entries.
    INSERT INTO accounting_entries (
      company_id,
      entry_number,
      journal_id,
      date,
      ref,
      description,
      status,
      source,
      source_module,
      total_debit,
      total_credit,
      created_by_id,
      created_at
    )
    VALUES (
      v_company_id,
      v_entry_number,
      v_source.journal_id,
      CURRENT_DATE,
      v_ref,
      'Reklasifikasi pembayaran vendor dari parent Hutang Usaha ke child Hutang Pemasok; sumber '
        || v_source.entry_number,
      'draft',
      'manual',
      'vendor_invoice_payment_reclass',
      v_amount,
      v_amount,
      'finance-controlled-sql',
      NOW()
    )
    RETURNING id INTO v_reclass_entry_id;

    INSERT INTO accounting_entry_lines (
      entry_id, account_id, description, debit, credit
    )
    VALUES
      (
        v_reclass_entry_id,
        v_child_account,
        'Reklasifikasi ke Hutang Pemasok/Vendor — ' || v_source.entry_number,
        v_amount,
        0
      ),
      (
        v_reclass_entry_id,
        v_parent_account,
        'Membalik debit salah pada parent Hutang Usaha — ' || v_source.entry_number,
        0,
        v_amount
      );

    UPDATE accounting_entries
    SET status = 'posted',
        approved_by = 'finance-controlled-sql',
        approved_at = NOW(),
        posted_at = NOW()
    WHERE id = v_reclass_entry_id
      AND status = 'draft';

    IF NOT FOUND THEN
      RAISE EXCEPTION
        'Correction journal % could not be promoted from draft to posted',
        v_entry_number;
    END IF;
  END LOOP;

  IF v_source_count <> 2 THEN
    RAISE EXCEPTION
      'Expected exactly 2 verified source journals, found %; no changes committed',
      v_source_count;
  END IF;
END
$$;

COMMIT;

/*
 * Read-only verification. Expected:
 * - accounting_settings.ap_account_id = 76228 / 2-1012-CST
 * - two posted correction journals
 * - each correction has equal debit and credit
 */
SELECT
  s.company_id,
  s.ap_account_id,
  coa.code AS ap_code,
  coa.name AS ap_name
FROM accounting_settings s
JOIN chart_of_accounts coa ON coa.id = s.ap_account_id
WHERE s.company_id = 1;

SELECT
  ae.id,
  ae.entry_number,
  ae.date,
  ae.ref,
  ae.status,
  ae.total_debit,
  ae.total_credit,
  coa.code,
  coa.name,
  el.debit,
  el.credit
FROM accounting_entries ae
JOIN accounting_entry_lines el ON el.entry_id = ae.id
JOIN chart_of_accounts coa ON coa.id = el.account_id
WHERE ae.company_id = 1
  AND ae.source_module = 'vendor_invoice_payment_reclass'
  AND ae.ref IN (
    'AP-RECLASS:BNK-CST/2026/000140',
    'AP-RECLASS:BNK-CST/2026/000141'
  )
ORDER BY ae.id, el.id;/*
 * CST Vendor Payable correction
 *
 * Purpose:
 * 1. Point accounting_settings.ap_account_id to the postable child
 *    2-1012-CST — Hutang Pemasok/Vendor.
 * 2. Reclassify the two verified historical vendor-payment journals that
 *    debited the parent 2-1010-CST.
 *
 * Safety:
 * - Intended for production company_id = 1 only.
 * - Does not UPDATE or DELETE posted journal lines.
 * - Creates balanced additive correction journals.
 * - Idempotent by deterministic entry_number and ref.
 * - Fails closed if the verified COA hierarchy or source journals changed.
 *
 * Run the whole script as one transaction in the Supabase SQL editor.
 */

BEGIN;

DO $$
DECLARE
  v_company_id       integer := 1;
  v_parent_account   integer;
  v_child_account    integer;
  v_current_ap       integer;
  v_source           record;
  v_reclass_entry_id integer;
  v_amount           numeric(14,2);
  v_entry_number     text;
  v_ref              text;
  v_source_count     integer := 0;
BEGIN
  -- Serialize this repair for CST.
  PERFORM pg_advisory_xact_lock(hashtext('cst-vendor-payable-matching-reclass-v1'));

  SELECT id
  INTO STRICT v_parent_account
  FROM chart_of_accounts
  WHERE company_id = v_company_id
    AND code = '2-1010-CST'
    AND name = 'Hutang Usaha CST';

  SELECT id
  INTO STRICT v_child_account
  FROM chart_of_accounts
  WHERE company_id = v_company_id
    AND code = '2-1012-CST'
    AND name = 'Hutang Pemasok/Vendor'
    AND parent_id = v_parent_account
    AND is_postable = TRUE;

  SELECT ap_account_id
  INTO STRICT v_current_ap
  FROM accounting_settings
  WHERE company_id = v_company_id
  FOR UPDATE;

  IF v_current_ap NOT IN (v_parent_account, v_child_account) THEN
    RAISE EXCEPTION
      'Accounting Settings AP account changed unexpectedly: current=%, expected parent=% or child=%',
      v_current_ap, v_parent_account, v_child_account;
  END IF;

  -- Future invoice and bank-mutation vendor matching use the posting child.
  UPDATE accounting_settings
  SET ap_account_id = v_child_account,
      updated_at = NOW()
  WHERE company_id = v_company_id
    AND ap_account_id = v_parent_account;

  /*
   * Verified historical payment journals:
   *   33485 — BNK-CST/2026/000140 — Rp12,480,000
   *   33486 — BNK-CST/2026/000141 — Rp11,303,171
   *
   * Existing wrong payment:
   *   DR parent Hutang Usaha / CR Bank
   *
   * Additive correction:
   *   DR child Hutang Pemasok / CR parent Hutang Usaha
   */
  FOR v_source IN
    SELECT ae.id, ae.entry_number, ae.journal_id
    FROM accounting_entries ae
    WHERE ae.id = ANY (ARRAY[33485, 33486])
      AND ae.company_id = v_company_id
      AND ae.status = 'posted'
      AND ae.source = 'bank_reconciliation'
      AND ae.source_module = 'vendor_invoice_payment'
    ORDER BY ae.id
    FOR UPDATE
  LOOP
    v_source_count := v_source_count + 1;

    SELECT COALESCE(SUM(el.debit - el.credit), 0)
    INTO v_amount
    FROM accounting_entry_lines el
    WHERE el.entry_id = v_source.id
      AND el.account_id = v_parent_account;

    IF v_amount <= 0 THEN
      RAISE EXCEPTION
        'Source journal % no longer has a positive debit on parent AP account',
        v_source.entry_number;
    END IF;

    IF EXISTS (
      SELECT 1
      FROM accounting_entry_lines el
      WHERE el.entry_id = v_source.id
        AND el.account_id = v_child_account
        AND (el.debit <> 0 OR el.credit <> 0)
    ) THEN
      RAISE EXCEPTION
        'Source journal % already contains the child vendor-payable account',
        v_source.entry_number;
    END IF;

    v_entry_number := 'ADJ-CST/APR-' || v_source.id::text;
    v_ref := 'AP-RECLASS:' || v_source.entry_number;

    -- Deterministic entry identity makes a rerun a no-op.
    IF EXISTS (
      SELECT 1
      FROM accounting_entries
      WHERE company_id = v_company_id
        AND entry_number = v_entry_number
        AND ref = v_ref
        AND source_module = 'vendor_invoice_payment_reclass'
        AND status = 'posted'
    ) THEN
      CONTINUE;
    END IF;

    IF EXISTS (
      SELECT 1
      FROM accounting_entries
      WHERE entry_number = v_entry_number
         OR (
           company_id = v_company_id
           AND ref = v_ref
           AND status IN ('draft', 'pending', 'approved', 'posted')
         )
    ) THEN
      RAISE EXCEPTION
        'Conflicting correction journal already exists for %',
        v_source.entry_number;
    END IF;

    -- Draft first: production guards reject line insertion into posted entries.
    INSERT INTO accounting_entries (
      company_id,
      entry_number,
      journal_id,
      date,
      ref,
      description,
      status,
      source,
      source_module,
      total_debit,
      total_credit,
      created_by_id,
      created_at
    )
    VALUES (
      v_company_id,
      v_entry_number,
      v_source.journal_id,
      CURRENT_DATE,
      v_ref,
      'Reklasifikasi pembayaran vendor dari parent Hutang Usaha ke child Hutang Pemasok; sumber '
        || v_source.entry_number,
      'draft',
      'manual',
      'vendor_invoice_payment_reclass',
      v_amount,
      v_amount,
      'finance-controlled-sql',
      NOW()
    )
    RETURNING id INTO v_reclass_entry_id;

    INSERT INTO accounting_entry_lines (
      entry_id, account_id, description, debit, credit
    )
    VALUES
      (
        v_reclass_entry_id,
        v_child_account,
        'Reklasifikasi ke Hutang Pemasok/Vendor — ' || v_source.entry_number,
        v_amount,
        0
      ),
      (
        v_reclass_entry_id,
        v_parent_account,
        'Membalik debit salah pada parent Hutang Usaha — ' || v_source.entry_number,
        0,
        v_amount
      );

    UPDATE accounting_entries
    SET status = 'posted',
        approved_by = 'finance-controlled-sql',
        approved_at = NOW(),
        posted_at = NOW()
    WHERE id = v_reclass_entry_id
      AND status = 'draft';

    IF NOT FOUND THEN
      RAISE EXCEPTION
        'Correction journal % could not be promoted from draft to posted',
        v_entry_number;
    END IF;
  END LOOP;

  IF v_source_count <> 2 THEN
    RAISE EXCEPTION
      'Expected exactly 2 verified source journals, found %; no changes committed',
      v_source_count;
  END IF;
END
$$;

COMMIT;

/*
 * Read-only verification. Expected:
 * - accounting_settings.ap_account_id = 76228 / 2-1012-CST
 * - two posted correction journals
 * - each correction has equal debit and credit
 */
SELECT
  s.company_id,
  s.ap_account_id,
  coa.code AS ap_code,
  coa.name AS ap_name
FROM accounting_settings s
JOIN chart_of_accounts coa ON coa.id = s.ap_account_id
WHERE s.company_id = 1;

SELECT
  ae.id,
  ae.entry_number,
  ae.date,
  ae.ref,
  ae.status,
  ae.total_debit,
  ae.total_credit,
  coa.code,
  coa.name,
  el.debit,
  el.credit
FROM accounting_entries ae
JOIN accounting_entry_lines el ON el.entry_id = ae.id
JOIN chart_of_accounts coa ON coa.id = el.account_id
WHERE ae.company_id = 1
  AND ae.source_module = 'vendor_invoice_payment_reclass'
  AND ae.ref IN (
    'AP-RECLASS:BNK-CST/2026/000140',
    'AP-RECLASS:BNK-CST/2026/000141'
  )
ORDER BY ae.id, el.id;/*
 * CST Vendor Payable correction
 *
 * Purpose:
 * 1. Point accounting_settings.ap_account_id to the postable child
 *    2-1012-CST — Hutang Pemasok/Vendor.
 * 2. Reclassify the two verified historical vendor-payment journals that
 *    debited the parent 2-1010-CST.
 *
 * Safety:
 * - Intended for production company_id = 1 only.
 * - Does not UPDATE or DELETE posted journal lines.
 * - Creates balanced additive correction journals.
 * - Idempotent by deterministic entry_number and ref.
 * - Fails closed if the verified COA hierarchy or source journals changed.
 *
 * Run the whole script as one transaction in the Supabase SQL editor.
 */

BEGIN;

DO $$
DECLARE
  v_company_id       integer := 1;
  v_parent_account   integer;
  v_child_account    integer;
  v_current_ap       integer;
  v_source           record;
  v_reclass_entry_id integer;
  v_amount           numeric(14,2);
  v_entry_number     text;
  v_ref              text;
  v_source_count     integer := 0;
BEGIN
  -- Serialize this repair for CST.
  PERFORM pg_advisory_xact_lock(hashtext('cst-vendor-payable-matching-reclass-v1'));

  SELECT id
  INTO STRICT v_parent_account
  FROM chart_of_accounts
  WHERE company_id = v_company_id
    AND code = '2-1010-CST'
    AND name = 'Hutang Usaha CST';

  SELECT id
  INTO STRICT v_child_account
  FROM chart_of_accounts
  WHERE company_id = v_company_id
    AND code = '2-1012-CST'
    AND name = 'Hutang Pemasok/Vendor'
    AND parent_id = v_parent_account
    AND is_postable = TRUE;

  SELECT ap_account_id
  INTO STRICT v_current_ap
  FROM accounting_settings
  WHERE company_id = v_company_id
  FOR UPDATE;

  IF v_current_ap NOT IN (v_parent_account, v_child_account) THEN
    RAISE EXCEPTION
      'Accounting Settings AP account changed unexpectedly: current=%, expected parent=% or child=%',
      v_current_ap, v_parent_account, v_child_account;
  END IF;

  -- Future invoice and bank-mutation vendor matching use the posting child.
  UPDATE accounting_settings
  SET ap_account_id = v_child_account,
      updated_at = NOW()
  WHERE company_id = v_company_id
    AND ap_account_id = v_parent_account;

  /*
   * Verified historical payment journals:
   *   33485 — BNK-CST/2026/000140 — Rp12,480,000
   *   33486 — BNK-CST/2026/000141 — Rp11,303,171
   *
   * Existing wrong payment:
   *   DR parent Hutang Usaha / CR Bank
   *
   * Additive correction:
   *   DR child Hutang Pemasok / CR parent Hutang Usaha
   */
  FOR v_source IN
    SELECT ae.id, ae.entry_number, ae.journal_id
    FROM accounting_entries ae
    WHERE ae.id = ANY (ARRAY[33485, 33486])
      AND ae.company_id = v_company_id
      AND ae.status = 'posted'
      AND ae.source = 'bank_reconciliation'
      AND ae.source_module = 'vendor_invoice_payment'
    ORDER BY ae.id
    FOR UPDATE
  LOOP
    v_source_count := v_source_count + 1;

    SELECT COALESCE(SUM(el.debit - el.credit), 0)
    INTO v_amount
    FROM accounting_entry_lines el
    WHERE el.entry_id = v_source.id
      AND el.account_id = v_parent_account;

    IF v_amount <= 0 THEN
      RAISE EXCEPTION
        'Source journal % no longer has a positive debit on parent AP account',
        v_source.entry_number;
    END IF;

    IF EXISTS (
      SELECT 1
      FROM accounting_entry_lines el
      WHERE el.entry_id = v_source.id
        AND el.account_id = v_child_account
        AND (el.debit <> 0 OR el.credit <> 0)
    ) THEN
      RAISE EXCEPTION
        'Source journal % already contains the child vendor-payable account',
        v_source.entry_number;
    END IF;

    v_entry_number := 'ADJ-CST/APR-' || v_source.id::text;
    v_ref := 'AP-RECLASS:' || v_source.entry_number;

    -- Deterministic entry identity makes a rerun a no-op.
    IF EXISTS (
      SELECT 1
      FROM accounting_entries
      WHERE company_id = v_company_id
        AND entry_number = v_entry_number
        AND ref = v_ref
        AND source_module = 'vendor_invoice_payment_reclass'
        AND status = 'posted'
    ) THEN
      CONTINUE;
    END IF;

    IF EXISTS (
      SELECT 1
      FROM accounting_entries
      WHERE entry_number = v_entry_number
         OR (
           company_id = v_company_id
           AND ref = v_ref
           AND status IN ('draft', 'pending', 'approved', 'posted')
         )
    ) THEN
      RAISE EXCEPTION
        'Conflicting correction journal already exists for %',
        v_source.entry_number;
    END IF;

    -- Draft first: production guards reject line insertion into posted entries.
    INSERT INTO accounting_entries (
      company_id,
      entry_number,
      journal_id,
      date,
      ref,
      description,
      status,
      source,
      source_module,
      total_debit,
      total_credit,
      created_by_id,
      created_at
    )
    VALUES (
      v_company_id,
      v_entry_number,
      v_source.journal_id,
      CURRENT_DATE,
      v_ref,
      'Reklasifikasi pembayaran vendor dari parent Hutang Usaha ke child Hutang Pemasok; sumber '
        || v_source.entry_number,
      'draft',
      'manual',
      'vendor_invoice_payment_reclass',
      v_amount,
      v_amount,
      'finance-controlled-sql',
      NOW()
    )
    RETURNING id INTO v_reclass_entry_id;

    INSERT INTO accounting_entry_lines (
      entry_id, account_id, description, debit, credit
    )
    VALUES
      (
        v_reclass_entry_id,
        v_child_account,
        'Reklasifikasi ke Hutang Pemasok/Vendor — ' || v_source.entry_number,
        v_amount,
        0
      ),
      (
        v_reclass_entry_id,
        v_parent_account,
        'Membalik debit salah pada parent Hutang Usaha — ' || v_source.entry_number,
        0,
        v_amount
      );

    UPDATE accounting_entries
    SET status = 'posted',
        approved_by = 'finance-controlled-sql',
        approved_at = NOW(),
        posted_at = NOW()
    WHERE id = v_reclass_entry_id
      AND status = 'draft';

    IF NOT FOUND THEN
      RAISE EXCEPTION
        'Correction journal % could not be promoted from draft to posted',
        v_entry_number;
    END IF;
  END LOOP;

  IF v_source_count <> 2 THEN
    RAISE EXCEPTION
      'Expected exactly 2 verified source journals, found %; no changes committed',
      v_source_count;
  END IF;
END
$$;

COMMIT;

/*
 * Read-only verification. Expected:
 * - accounting_settings.ap_account_id = 76228 / 2-1012-CST
 * - two posted correction journals
 * - each correction has equal debit and credit
 */
SELECT
  s.company_id,
  s.ap_account_id,
  coa.code AS ap_code,
  coa.name AS ap_name
FROM accounting_settings s
JOIN chart_of_accounts coa ON coa.id = s.ap_account_id
WHERE s.company_id = 1;

SELECT
  ae.id,
  ae.entry_number,
  ae.date,
  ae.ref,
  ae.status,
  ae.total_debit,
  ae.total_credit,
  coa.code,
  coa.name,
  el.debit,
  el.credit
FROM accounting_entries ae
JOIN accounting_entry_lines el ON el.entry_id = ae.id
JOIN chart_of_accounts coa ON coa.id = el.account_id
WHERE ae.company_id = 1
  AND ae.source_module = 'vendor_invoice_payment_reclass'
  AND ae.ref IN (
    'AP-RECLASS:BNK-CST/2026/000140',
    'AP-RECLASS:BNK-CST/2026/000141'
  )
ORDER BY ae.id, el.id;/*
 * CST Vendor Payable correction
 *
 * Purpose:
 * 1. Point accounting_settings.ap_account_id to the postable child
 *    2-1012-CST — Hutang Pemasok/Vendor.
 * 2. Reclassify the two verified historical vendor-payment journals that
 *    debited the parent 2-1010-CST.
 *
 * Safety:
 * - Intended for production company_id = 1 only.
 * - Does not UPDATE or DELETE posted journal lines.
 * - Creates balanced additive correction journals.
 * - Idempotent by deterministic entry_number and ref.
 * - Fails closed if the verified COA hierarchy or source journals changed.
 *
 * Run the whole script as one transaction in the Supabase SQL editor.
 */

BEGIN;

DO $$
DECLARE
  v_company_id       integer := 1;
  v_parent_account   integer;
  v_child_account    integer;
  v_current_ap       integer;
  v_source           record;
  v_reclass_entry_id integer;
  v_amount           numeric(14,2);
  v_entry_number     text;
  v_ref              text;
  v_source_count     integer := 0;
BEGIN
  -- Serialize this repair for CST.
  PERFORM pg_advisory_xact_lock(hashtext('cst-vendor-payable-matching-reclass-v1'));

  SELECT id
  INTO STRICT v_parent_account
  FROM chart_of_accounts
  WHERE company_id = v_company_id
    AND code = '2-1010-CST'
    AND name = 'Hutang Usaha CST';

  SELECT id
  INTO STRICT v_child_account
  FROM chart_of_accounts
  WHERE company_id = v_company_id
    AND code = '2-1012-CST'
    AND name = 'Hutang Pemasok/Vendor'
    AND parent_id = v_parent_account
    AND is_postable = TRUE;

  SELECT ap_account_id
  INTO STRICT v_current_ap
  FROM accounting_settings
  WHERE company_id = v_company_id
  FOR UPDATE;

  IF v_current_ap NOT IN (v_parent_account, v_child_account) THEN
    RAISE EXCEPTION
      'Accounting Settings AP account changed unexpectedly: current=%, expected parent=% or child=%',
      v_current_ap, v_parent_account, v_child_account;
  END IF;

  -- Future invoice and bank-mutation vendor matching use the posting child.
  UPDATE accounting_settings
  SET ap_account_id = v_child_account,
      updated_at = NOW()
  WHERE company_id = v_company_id
    AND ap_account_id = v_parent_account;

  /*
   * Verified historical payment journals:
   *   33485 — BNK-CST/2026/000140 — Rp12,480,000
   *   33486 — BNK-CST/2026/000141 — Rp11,303,171
   *
   * Existing wrong payment:
   *   DR parent Hutang Usaha / CR Bank
   *
   * Additive correction:
   *   DR child Hutang Pemasok / CR parent Hutang Usaha
   */
  FOR v_source IN
    SELECT ae.id, ae.entry_number, ae.journal_id
    FROM accounting_entries ae
    WHERE ae.id = ANY (ARRAY[33485, 33486])
      AND ae.company_id = v_company_id
      AND ae.status = 'posted'
      AND ae.source = 'bank_reconciliation'
      AND ae.source_module = 'vendor_invoice_payment'
    ORDER BY ae.id
    FOR UPDATE
  LOOP
    v_source_count := v_source_count + 1;

    SELECT COALESCE(SUM(el.debit - el.credit), 0)
    INTO v_amount
    FROM accounting_entry_lines el
    WHERE el.entry_id = v_source.id
      AND el.account_id = v_parent_account;

    IF v_amount <= 0 THEN
      RAISE EXCEPTION
        'Source journal % no longer has a positive debit on parent AP account',
        v_source.entry_number;
    END IF;

    IF EXISTS (
      SELECT 1
      FROM accounting_entry_lines el
      WHERE el.entry_id = v_source.id
        AND el.account_id = v_child_account
        AND (el.debit <> 0 OR el.credit <> 0)
    ) THEN
      RAISE EXCEPTION
        'Source journal % already contains the child vendor-payable account',
        v_source.entry_number;
    END IF;

    v_entry_number := 'ADJ-CST/APR-' || v_source.id::text;
    v_ref := 'AP-RECLASS:' || v_source.entry_number;

    -- Deterministic entry identity makes a rerun a no-op.
    IF EXISTS (
      SELECT 1
      FROM accounting_entries
      WHERE company_id = v_company_id
        AND entry_number = v_entry_number
        AND ref = v_ref
        AND source_module = 'vendor_invoice_payment_reclass'
        AND status = 'posted'
    ) THEN
      CONTINUE;
    END IF;

    IF EXISTS (
      SELECT 1
      FROM accounting_entries
      WHERE entry_number = v_entry_number
         OR (
           company_id = v_company_id
           AND ref = v_ref
           AND status IN ('draft', 'pending', 'approved', 'posted')
         )
    ) THEN
      RAISE EXCEPTION
        'Conflicting correction journal already exists for %',
        v_source.entry_number;
    END IF;

    -- Draft first: production guards reject line insertion into posted entries.
    INSERT INTO accounting_entries (
      company_id,
      entry_number,
      journal_id,
      date,
      ref,
      description,
      status,
      source,
      source_module,
      total_debit,
      total_credit,
      created_by_id,
      created_at
    )
    VALUES (
      v_company_id,
      v_entry_number,
      v_source.journal_id,
      CURRENT_DATE,
      v_ref,
      'Reklasifikasi pembayaran vendor dari parent Hutang Usaha ke child Hutang Pemasok; sumber '
        || v_source.entry_number,
      'draft',
      'manual',
      'vendor_invoice_payment_reclass',
      v_amount,
      v_amount,
      'finance-controlled-sql',
      NOW()
    )
    RETURNING id INTO v_reclass_entry_id;

    INSERT INTO accounting_entry_lines (
      entry_id, account_id, description, debit, credit
    )
    VALUES
      (
        v_reclass_entry_id,
        v_child_account,
        'Reklasifikasi ke Hutang Pemasok/Vendor — ' || v_source.entry_number,
        v_amount,
        0
      ),
      (
        v_reclass_entry_id,
        v_parent_account,
        'Membalik debit salah pada parent Hutang Usaha — ' || v_source.entry_number,
        0,
        v_amount
      );

    UPDATE accounting_entries
    SET status = 'posted',
        approved_by = 'finance-controlled-sql',
        approved_at = NOW(),
        posted_at = NOW()
    WHERE id = v_reclass_entry_id
      AND status = 'draft';

    IF NOT FOUND THEN
      RAISE EXCEPTION
        'Correction journal % could not be promoted from draft to posted',
        v_entry_number;
    END IF;
  END LOOP;

  IF v_source_count <> 2 THEN
    RAISE EXCEPTION
      'Expected exactly 2 verified source journals, found %; no changes committed',
      v_source_count;
  END IF;
END
$$;

COMMIT;

/*
 * Read-only verification. Expected:
 * - accounting_settings.ap_account_id = 76228 / 2-1012-CST
 * - two posted correction journals
 * - each correction has equal debit and credit
 */
SELECT
  s.company_id,
  s.ap_account_id,
  coa.code AS ap_code,
  coa.name AS ap_name
FROM accounting_settings s
JOIN chart_of_accounts coa ON coa.id = s.ap_account_id
WHERE s.company_id = 1;

SELECT
  ae.id,
  ae.entry_number,
  ae.date,
  ae.ref,
  ae.status,
  ae.total_debit,
  ae.total_credit,
  coa.code,
  coa.name,
  el.debit,
  el.credit
FROM accounting_entries ae
JOIN accounting_entry_lines el ON el.entry_id = ae.id
JOIN chart_of_accounts coa ON coa.id = el.account_id
WHERE ae.company_id = 1
  AND ae.source_module = 'vendor_invoice_payment_reclass'
  AND ae.ref IN (
    'AP-RECLASS:BNK-CST/2026/000140',
    'AP-RECLASS:BNK-CST/2026/000141'
  )
ORDER BY ae.id, el.id;/*
 * CST Vendor Payable correction
 *
 * Purpose:
 * 1. Point accounting_settings.ap_account_id to the postable child
 *    2-1012-CST — Hutang Pemasok/Vendor.
 * 2. Reclassify the two verified historical vendor-payment journals that
 *    debited the parent 2-1010-CST.
 *
 * Safety:
 * - Intended for production company_id = 1 only.
 * - Does not UPDATE or DELETE posted journal lines.
 * - Creates balanced additive correction journals.
 * - Idempotent by deterministic entry_number and ref.
 * - Fails closed if the verified COA hierarchy or source journals changed.
 *
 * Run the whole script as one transaction in the Supabase SQL editor.
 */

BEGIN;

DO $$
DECLARE
  v_company_id       integer := 1;
  v_parent_account   integer;
  v_child_account    integer;
  v_current_ap       integer;
  v_source           record;
  v_reclass_entry_id integer;
  v_amount           numeric(14,2);
  v_entry_number     text;
  v_ref              text;
  v_source_count     integer := 0;
BEGIN
  -- Serialize this repair for CST.
  PERFORM pg_advisory_xact_lock(hashtext('cst-vendor-payable-matching-reclass-v1'));

  SELECT id
  INTO STRICT v_parent_account
  FROM chart_of_accounts
  WHERE company_id = v_company_id
    AND code = '2-1010-CST'
    AND name = 'Hutang Usaha CST';

  SELECT id
  INTO STRICT v_child_account
  FROM chart_of_accounts
  WHERE company_id = v_company_id
    AND code = '2-1012-CST'
    AND name = 'Hutang Pemasok/Vendor'
    AND parent_id = v_parent_account
    AND is_postable = TRUE;

  SELECT ap_account_id
  INTO STRICT v_current_ap
  FROM accounting_settings
  WHERE company_id = v_company_id
  FOR UPDATE;

  IF v_current_ap NOT IN (v_parent_account, v_child_account) THEN
    RAISE EXCEPTION
      'Accounting Settings AP account changed unexpectedly: current=%, expected parent=% or child=%',
      v_current_ap, v_parent_account, v_child_account;
  END IF;

  -- Future invoice and bank-mutation vendor matching use the posting child.
  UPDATE accounting_settings
  SET ap_account_id = v_child_account,
      updated_at = NOW()
  WHERE company_id = v_company_id
    AND ap_account_id = v_parent_account;

  /*
   * Verified historical payment journals:
   *   33485 — BNK-CST/2026/000140 — Rp12,480,000
   *   33486 — BNK-CST/2026/000141 — Rp11,303,171
   *
   * Existing wrong payment:
   *   DR parent Hutang Usaha / CR Bank
   *
   * Additive correction:
   *   DR child Hutang Pemasok / CR parent Hutang Usaha
   */
  FOR v_source IN
    SELECT ae.id, ae.entry_number, ae.journal_id
    FROM accounting_entries ae
    WHERE ae.id = ANY (ARRAY[33485, 33486])
      AND ae.company_id = v_company_id
      AND ae.status = 'posted'
      AND ae.source = 'bank_reconciliation'
      AND ae.source_module = 'vendor_invoice_payment'
    ORDER BY ae.id
    FOR UPDATE
  LOOP
    v_source_count := v_source_count + 1;

    SELECT COALESCE(SUM(el.debit - el.credit), 0)
    INTO v_amount
    FROM accounting_entry_lines el
    WHERE el.entry_id = v_source.id
      AND el.account_id = v_parent_account;

    IF v_amount <= 0 THEN
      RAISE EXCEPTION
        'Source journal % no longer has a positive debit on parent AP account',
        v_source.entry_number;
    END IF;

    IF EXISTS (
      SELECT 1
      FROM accounting_entry_lines el
      WHERE el.entry_id = v_source.id
        AND el.account_id = v_child_account
        AND (el.debit <> 0 OR el.credit <> 0)
    ) THEN
      RAISE EXCEPTION
        'Source journal % already contains the child vendor-payable account',
        v_source.entry_number;
    END IF;

    v_entry_number := 'ADJ-CST/APR-' || v_source.id::text;
    v_ref := 'AP-RECLASS:' || v_source.entry_number;

    -- Deterministic entry identity makes a rerun a no-op.
    IF EXISTS (
      SELECT 1
      FROM accounting_entries
      WHERE company_id = v_company_id
        AND entry_number = v_entry_number
        AND ref = v_ref
        AND source_module = 'vendor_invoice_payment_reclass'
        AND status = 'posted'
    ) THEN
      CONTINUE;
    END IF;

    IF EXISTS (
      SELECT 1
      FROM accounting_entries
      WHERE entry_number = v_entry_number
         OR (
           company_id = v_company_id
           AND ref = v_ref
           AND status IN ('draft', 'pending', 'approved', 'posted')
         )
    ) THEN
      RAISE EXCEPTION
        'Conflicting correction journal already exists for %',
        v_source.entry_number;
    END IF;

    -- Draft first: production guards reject line insertion into posted entries.
    INSERT INTO accounting_entries (
      company_id,
      entry_number,
      journal_id,
      date,
      ref,
      description,
      status,
      source,
      source_module,
      total_debit,
      total_credit,
      created_by_id,
      created_at
    )
    VALUES (
      v_company_id,
      v_entry_number,
      v_source.journal_id,
      CURRENT_DATE,
      v_ref,
      'Reklasifikasi pembayaran vendor dari parent Hutang Usaha ke child Hutang Pemasok; sumber '
        || v_source.entry_number,
      'draft',
      'manual',
      'vendor_invoice_payment_reclass',
      v_amount,
      v_amount,
      'finance-controlled-sql',
      NOW()
    )
    RETURNING id INTO v_reclass_entry_id;

    INSERT INTO accounting_entry_lines (
      entry_id, account_id, description, debit, credit
    )
    VALUES
      (
        v_reclass_entry_id,
        v_child_account,
        'Reklasifikasi ke Hutang Pemasok/Vendor — ' || v_source.entry_number,
        v_amount,
        0
      ),
      (
        v_reclass_entry_id,
        v_parent_account,
        'Membalik debit salah pada parent Hutang Usaha — ' || v_source.entry_number,
        0,
        v_amount
      );

    UPDATE accounting_entries
    SET status = 'posted',
        approved_by = 'finance-controlled-sql',
        approved_at = NOW(),
        posted_at = NOW()
    WHERE id = v_reclass_entry_id
      AND status = 'draft';

    IF NOT FOUND THEN
      RAISE EXCEPTION
        'Correction journal % could not be promoted from draft to posted',
        v_entry_number;
    END IF;
  END LOOP;

  IF v_source_count <> 2 THEN
    RAISE EXCEPTION
      'Expected exactly 2 verified source journals, found %; no changes committed',
      v_source_count;
  END IF;
END
$$;

COMMIT;

/*
 * Read-only verification. Expected:
 * - accounting_settings.ap_account_id = 76228 / 2-1012-CST
 * - two posted correction journals
 * - each correction has equal debit and credit
 */
SELECT
  s.company_id,
  s.ap_account_id,
  coa.code AS ap_code,
  coa.name AS ap_name
FROM accounting_settings s
JOIN chart_of_accounts coa ON coa.id = s.ap_account_id
WHERE s.company_id = 1;

SELECT
  ae.id,
  ae.entry_number,
  ae.date,
  ae.ref,
  ae.status,
  ae.total_debit,
  ae.total_credit,
  coa.code,
  coa.name,
  el.debit,
  el.credit
FROM accounting_entries ae
JOIN accounting_entry_lines el ON el.entry_id = ae.id
JOIN chart_of_accounts coa ON coa.id = el.account_id
WHERE ae.company_id = 1
  AND ae.source_module = 'vendor_invoice_payment_reclass'
  AND ae.ref IN (
    'AP-RECLASS:BNK-CST/2026/000140',
    'AP-RECLASS:BNK-CST/2026/000141'
  )
ORDER BY ae.id, el.id;/*
 * CST Vendor Payable correction
 *
 * Purpose:
 * 1. Point accounting_settings.ap_account_id to the postable child
 *    2-1012-CST — Hutang Pemasok/Vendor.
 * 2. Reclassify the two verified historical vendor-payment journals that
 *    debited the parent 2-1010-CST.
 *
 * Safety:
 * - Intended for production company_id = 1 only.
 * - Does not UPDATE or DELETE posted journal lines.
 * - Creates balanced additive correction journals.
 * - Idempotent by deterministic entry_number and ref.
 * - Fails closed if the verified COA hierarchy or source journals changed.
 *
 * Run the whole script as one transaction in the Supabase SQL editor.
 */

BEGIN;

DO $$
DECLARE
  v_company_id       integer := 1;
  v_parent_account   integer;
  v_child_account    integer;
  v_current_ap       integer;
  v_source           record;
  v_reclass_entry_id integer;
  v_amount           numeric(14,2);
  v_entry_number     text;
  v_ref              text;
  v_source_count     integer := 0;
BEGIN
  -- Serialize this repair for CST.
  PERFORM pg_advisory_xact_lock(hashtext('cst-vendor-payable-matching-reclass-v1'));

  SELECT id
  INTO STRICT v_parent_account
  FROM chart_of_accounts
  WHERE company_id = v_company_id
    AND code = '2-1010-CST'
    AND name = 'Hutang Usaha CST';

  SELECT id
  INTO STRICT v_child_account
  FROM chart_of_accounts
  WHERE company_id = v_company_id
    AND code = '2-1012-CST'
    AND name = 'Hutang Pemasok/Vendor'
    AND parent_id = v_parent_account
    AND is_postable = TRUE;

  SELECT ap_account_id
  INTO STRICT v_current_ap
  FROM accounting_settings
  WHERE company_id = v_company_id
  FOR UPDATE;

  IF v_current_ap NOT IN (v_parent_account, v_child_account) THEN
    RAISE EXCEPTION
      'Accounting Settings AP account changed unexpectedly: current=%, expected parent=% or child=%',
      v_current_ap, v_parent_account, v_child_account;
  END IF;

  -- Future invoice and bank-mutation vendor matching use the posting child.
  UPDATE accounting_settings
  SET ap_account_id = v_child_account,
      updated_at = NOW()
  WHERE company_id = v_company_id
    AND ap_account_id = v_parent_account;

  /*
   * Verified historical payment journals:
   *   33485 — BNK-CST/2026/000140 — Rp12,480,000
   *   33486 — BNK-CST/2026/000141 — Rp11,303,171
   *
   * Existing wrong payment:
   *   DR parent Hutang Usaha / CR Bank
   *
   * Additive correction:
   *   DR child Hutang Pemasok / CR parent Hutang Usaha
   */
  FOR v_source IN
    SELECT ae.id, ae.entry_number, ae.journal_id
    FROM accounting_entries ae
    WHERE ae.id = ANY (ARRAY[33485, 33486])
      AND ae.company_id = v_company_id
      AND ae.status = 'posted'
      AND ae.source = 'bank_reconciliation'
      AND ae.source_module = 'vendor_invoice_payment'
    ORDER BY ae.id
    FOR UPDATE
  LOOP
    v_source_count := v_source_count + 1;

    SELECT COALESCE(SUM(el.debit - el.credit), 0)
    INTO v_amount
    FROM accounting_entry_lines el
    WHERE el.entry_id = v_source.id
      AND el.account_id = v_parent_account;

    IF v_amount <= 0 THEN
      RAISE EXCEPTION
        'Source journal % no longer has a positive debit on parent AP account',
        v_source.entry_number;
    END IF;

    IF EXISTS (
      SELECT 1
      FROM accounting_entry_lines el
      WHERE el.entry_id = v_source.id
        AND el.account_id = v_child_account
        AND (el.debit <> 0 OR el.credit <> 0)
    ) THEN
      RAISE EXCEPTION
        'Source journal % already contains the child vendor-payable account',
        v_source.entry_number;
    END IF;

    v_entry_number := 'ADJ-CST/APR-' || v_source.id::text;
    v_ref := 'AP-RECLASS:' || v_source.entry_number;

    -- Deterministic entry identity makes a rerun a no-op.
    IF EXISTS (
      SELECT 1
      FROM accounting_entries
      WHERE company_id = v_company_id
        AND entry_number = v_entry_number
        AND ref = v_ref
        AND source_module = 'vendor_invoice_payment_reclass'
        AND status = 'posted'
    ) THEN
      CONTINUE;
    END IF;

    IF EXISTS (
      SELECT 1
      FROM accounting_entries
      WHERE entry_number = v_entry_number
         OR (
           company_id = v_company_id
           AND ref = v_ref
           AND status IN ('draft', 'pending', 'approved', 'posted')
         )
    ) THEN
      RAISE EXCEPTION
        'Conflicting correction journal already exists for %',
        v_source.entry_number;
    END IF;

    -- Draft first: production guards reject line insertion into posted entries.
    INSERT INTO accounting_entries (
      company_id,
      entry_number,
      journal_id,
      date,
      ref,
      description,
      status,
      source,
      source_module,
      total_debit,
      total_credit,
      created_by_id,
      created_at
    )
    VALUES (
      v_company_id,
      v_entry_number,
      v_source.journal_id,
      CURRENT_DATE,
      v_ref,
      'Reklasifikasi pembayaran vendor dari parent Hutang Usaha ke child Hutang Pemasok; sumber '
        || v_source.entry_number,
      'draft',
      'manual',
      'vendor_invoice_payment_reclass',
      v_amount,
      v_amount,
      'finance-controlled-sql',
      NOW()
    )
    RETURNING id INTO v_reclass_entry_id;

    INSERT INTO accounting_entry_lines (
      entry_id, account_id, description, debit, credit
    )
    VALUES
      (
        v_reclass_entry_id,
        v_child_account,
        'Reklasifikasi ke Hutang Pemasok/Vendor — ' || v_source.entry_number,
        v_amount,
        0
      ),
      (
        v_reclass_entry_id,
        v_parent_account,
        'Membalik debit salah pada parent Hutang Usaha — ' || v_source.entry_number,
        0,
        v_amount
      );

    UPDATE accounting_entries
    SET status = 'posted',
        approved_by = 'finance-controlled-sql',
        approved_at = NOW(),
        posted_at = NOW()
    WHERE id = v_reclass_entry_id
      AND status = 'draft';

    IF NOT FOUND THEN
      RAISE EXCEPTION
        'Correction journal % could not be promoted from draft to posted',
        v_entry_number;
    END IF;
  END LOOP;

  IF v_source_count <> 2 THEN
    RAISE EXCEPTION
      'Expected exactly 2 verified source journals, found %; no changes committed',
      v_source_count;
  END IF;
END
$$;

COMMIT;

/*
 * Read-only verification. Expected:
 * - accounting_settings.ap_account_id = 76228 / 2-1012-CST
 * - two posted correction journals
 * - each correction has equal debit and credit
 */
SELECT
  s.company_id,
  s.ap_account_id,
  coa.code AS ap_code,
  coa.name AS ap_name
FROM accounting_settings s
JOIN chart_of_accounts coa ON coa.id = s.ap_account_id
WHERE s.company_id = 1;

SELECT
  ae.id,
  ae.entry_number,
  ae.date,
  ae.ref,
  ae.status,
  ae.total_debit,
  ae.total_credit,
  coa.code,
  coa.name,
  el.debit,
  el.credit
FROM accounting_entries ae
JOIN accounting_entry_lines el ON el.entry_id = ae.id
JOIN chart_of_accounts coa ON coa.id = el.account_id
WHERE ae.company_id = 1
  AND ae.source_module = 'vendor_invoice_payment_reclass'
  AND ae.ref IN (
    'AP-RECLASS:BNK-CST/2026/000140',
    'AP-RECLASS:BNK-CST/2026/000141'
  )
ORDER BY ae.id, el.id;