import { db } from "@workspace/db";
import { sql } from "drizzle-orm";
import { logger } from "../../lib/logger.js";
import { pullLegacyBookingsFromSupabase, pullFacilitiesFromSupabase, pullPaymentsFromSupabase } from "./supabaseSync.js";
import {
  isStartupMigrationComplete,
  markStartupMigrationComplete,
} from "../../lib/startupMigrationState.js";

/**
 * Upgrade the shared ledger audit table used by accounting posting.
 *
 * Older runtime databases may have `ledger_events` from the fleet schema,
 * which predates the accounting audit contract and has no `entry_id`. Keep
 * this additive and safe to run before/after the table is provisioned.
 */
export async function runLedgerEventsEntryIdMigration(): Promise<void> {
  await db.execute(sql`
    DO $$
    BEGIN
      IF to_regclass('public.ledger_events') IS NOT NULL THEN
        ALTER TABLE public.ledger_events
          ADD COLUMN IF NOT EXISTS entry_id INTEGER;
        CREATE INDEX IF NOT EXISTS ledger_events_entry_id_idx
          ON public.ledger_events (entry_id);
      END IF;
    END $$;
  `);
  logger.info("Ledger events migration: entry_id siap");
}

/**
 * The canonical Sport Center payment table lives in the Supabase
 * `sport_center` schema.  The local/public payment row is deliberately owned
 * by PostgreSQL so that a retried confirmation cannot create two accounting
 * candidates.
 *
 * This is kept in the runtime migration (rather than only in a one-off SQL
 * script) because the incremental worker refuses to INSERT a missing mirror.
 * The guard below makes fresh/reset environments explicit: if the source
 * schema is not present, we skip provisioning with a warning instead of
 * creating a trigger that can never work.
 */
let sportPaymentMirrorTriggerEnsurePromise: Promise<void> | null = null;

export function ensureSportPaymentMirrorTrigger(): Promise<void> {
  if (sportPaymentMirrorTriggerEnsurePromise) {
    return sportPaymentMirrorTriggerEnsurePromise;
  }

  const provisioning = (async () => {
  // The mirror trigger is also refreshed by the standalone development
  // migration runner, where Sport Center runs before Accounting Hub. Keep the
  // metadata column available before PostgreSQL parses the trigger function.
  await db.execute(sql`
    ALTER TABLE accounting_entries
      ADD COLUMN IF NOT EXISTS bank_account_id TEXT
  `).catch((err) => {
    logger.warn({ err }, "Sport Center payment mirror trigger: accounting bank metadata column unavailable");
  });
  await db.execute(sql.raw(`
    DO $repair$
    DECLARE
      v_data_type text;
    BEGIN
      SELECT data_type
        INTO v_data_type
        FROM information_schema.columns
       WHERE table_schema = 'public'
         AND table_name = 'accounting_entries'
         AND column_name = 'bank_account_id';
      IF v_data_type IS NOT NULL AND v_data_type <> 'text' THEN
        ALTER TABLE accounting_entries
          ALTER COLUMN bank_account_id TYPE TEXT
          USING bank_account_id::text;
      END IF;
    END
    $repair$;
  `)).catch((err) => {
    logger.warn({ err }, "Sport Center payment mirror trigger: accounting bank metadata type repair unavailable");
  });

  const requiredObjects = await db.execute(sql`
    SELECT
      EXISTS (
        SELECT 1
        FROM information_schema.tables
        WHERE table_schema = 'sport_center'
          AND table_name = 'sport_payments'
      ) AS source_payments_exists,
      EXISTS (
        SELECT 1
        FROM information_schema.tables
        WHERE table_schema = 'sport_center'
          AND table_name = 'sport_bookings'
      ) AS source_bookings_exists,
      EXISTS (
        SELECT 1
        FROM information_schema.tables
        WHERE table_schema = 'public'
          AND table_name = 'sport_payments'
      ) AS public_payments_exists,
      EXISTS (
        SELECT 1
        FROM information_schema.tables
        WHERE table_schema = 'public'
          AND table_name = 'sport_bookings'
      ) AS public_bookings_exists,
      (
        SELECT COUNT(*) = 9
        FROM information_schema.columns
        WHERE table_schema = 'sport_center'
          AND table_name = 'sport_payments'
          AND column_name IN (
            'id', 'booking_id', 'amount', 'status',
            'payment_method', 'payment_type', 'paid_at', 'confirmed_at', 'created_at'
          )
      ) AS source_payment_columns_complete,
      (
        SELECT COUNT(*) = 2
        FROM information_schema.columns
        WHERE table_schema = 'sport_center'
          AND table_name = 'sport_bookings'
          AND column_name IN ('id', 'ppn_rate')
      ) AS source_booking_columns_complete,
      (
        SELECT COUNT(*) = 1
        FROM information_schema.columns
        WHERE table_schema = 'public'
          AND table_name = 'sport_bookings'
          AND column_name = 'sc_booking_id'
      ) AS public_booking_columns_complete,
      (
        SELECT COUNT(*) = 12
        FROM information_schema.columns
        WHERE table_schema = 'public'
          AND table_name = 'sport_payments'
          AND column_name IN (
            'booking_id', 'payment_number', 'amount', 'method', 'status',
            'paid_at', 'payment_type', 'tax_rate', 'tax_amount', 'source',
            'posting_status', 'updated_at'
          )
      ) AS public_payment_columns_complete
      ,
      (
        SELECT COUNT(*) = 12
        FROM information_schema.columns
        WHERE table_schema = 'public'
          AND table_name = 'sport_payments'
          AND column_name IN (
            'company_id', 'provider_id', 'payment_provider', 'provider_code',
            'bank_account_id', 'external_bank_account_id',
            'expected_settlement_date', 'settlement_rule_version',
            'settlement_status', 'source_payment_id', 'source_schema',
            'source_table'
          )
      ) AS public_mirror_metadata_complete,
      EXISTS (
        SELECT 1
        FROM information_schema.tables
        WHERE table_schema = 'sport_center'
          AND table_name = 'payment_business_calendar'
      ) AS payment_calendar_exists
  `);

  const objects = requiredObjects.rows[0] as Record<string, boolean> | undefined;
  const ready =
    objects?.source_payments_exists === true &&
    objects.source_bookings_exists === true &&
    objects.public_payments_exists === true &&
    objects.public_bookings_exists === true &&
    objects.source_payment_columns_complete === true &&
    objects.source_booking_columns_complete === true &&
    objects.public_booking_columns_complete === true &&
    objects.public_payment_columns_complete === true &&
    objects.public_mirror_metadata_complete === true &&
    objects.payment_calendar_exists === true;

  if (!ready) {
    logger.warn(
      { objects },
      "Sport Center payment mirror trigger: schema/kolom wajib belum tersedia — provisioning dilewati",
    );
    // A later startup stage may add the missing columns. Do not memoize this
    // guarded no-op, otherwise runSportCenterMigration would never retry.
    sportPaymentMirrorTriggerEnsurePromise = null;
    return;
  }

  // Existing Supabase environments may already own this canonical contract
  // through a runtime migration. Do not DROP or replace those objects: the API
  // role may be allowed to inspect them but not own them. Only the fully
  // absent contract takes the creation path below; a partial contract remains
  // fail-closed instead of silently weakening the mirror boundary.
  const existingContract = await db.execute(sql`
    SELECT
      EXISTS (
        SELECT 1
        FROM pg_trigger t
        JOIN pg_class c ON c.oid = t.tgrelid
        JOIN pg_namespace n ON n.oid = c.relnamespace
        WHERE n.nspname = 'sport_center'
          AND c.relname = 'sport_payments'
          AND t.tgname = 'trg_mirror_confirmed_payment_to_public'
          AND NOT t.tgisinternal
      ) AS mirror_trigger_exists,
      to_regprocedure(
        'sport_center.resolve_and_persist_payment_metadata(integer)'
      ) IS NOT NULL AS resolver_exists,
      to_regprocedure(
        'sport_center.mirror_confirmed_payment_to_public()'
      ) IS NOT NULL AS mirror_function_exists,
      to_regprocedure(
        'public.sync_sport_payment_to_accounting()'
      ) IS NOT NULL AS accounting_function_exists,
      to_regprocedure(
        'sport_center.get_unmirrored_confirmed_payments()'
      ) IS NOT NULL AS unmirrored_function_exists,
      to_regprocedure(
        'sport_center.replay_confirmed_payment_mirror(integer)'
      ) IS NOT NULL AS replay_function_exists,
      EXISTS (
        SELECT 1
        FROM pg_class i
        JOIN pg_namespace n ON n.oid = i.relnamespace
        WHERE n.nspname = 'public'
          AND i.relname = 'uq_sport_payments_payment_number'
          AND i.relkind = 'i'
      ) AS payment_number_index_exists
  `);
  const contract = existingContract.rows[0] as Record<string, boolean> | undefined;
  const contractComplete =
    contract?.mirror_trigger_exists === true &&
    contract.resolver_exists === true &&
    contract.mirror_function_exists === true &&
    contract.accounting_function_exists === true &&
    contract.unmirrored_function_exists === true &&
    contract.replay_function_exists === true &&
    contract.payment_number_index_exists === true;

  if (contractComplete) {
    logger.info(
      "Sport Center payment mirror trigger: existing canonical contract verified; refreshing non-destructive function definitions",
    );
  }

  // The trigger uses this key as its idempotency boundary.  Let a duplicate
  // existing value fail loudly instead of silently weakening the guarantee.
  await db.execute(sql`
    CREATE UNIQUE INDEX IF NOT EXISTS uq_sport_payments_payment_number
      ON public.sport_payments(payment_number)
  `);

  // Canonical metadata is resolved and persisted before the public mirror is
  // projected.  The function is deliberately source-aware and fail-closed:
  // it will not write partial metadata or use a non-owner-approved rule.
  await db.execute(sql`
    CREATE OR REPLACE FUNCTION sport_center.resolve_and_persist_payment_metadata(
      p_payment_id integer
    )
    RETURNS TABLE (
      resolved_company_id integer,
      resolved_expected_settlement_date date,
      resolved_rule_version text
    )
    LANGUAGE plpgsql
    SECURITY DEFINER
    SET search_path TO 'pg_catalog', 'sport_center', 'public'
    AS $function$
    DECLARE
      v_payment sport_center.sport_payments%ROWTYPE;
      v_facility_id integer;
      v_company_id integer;
      v_company_count integer;
      v_external_bank_account_id text;
      v_bank_account_id integer;
      v_bank_account_count integer;
      v_provider_id text;
      v_provider_name text;
      v_provider_code text;
      v_rule_version text;
      v_settlement_delay integer;
      v_payment_date date;
      v_expected_settlement_date date;
      v_business_day boolean;
      v_remaining integer;
    BEGIN
      PERFORM pg_advisory_xact_lock(731026, p_payment_id);

      SELECT *
        INTO v_payment
        FROM sport_center.sport_payments
       WHERE id = p_payment_id
       FOR UPDATE;

      IF NOT FOUND THEN
        RAISE EXCEPTION 'CANONICAL_PAYMENT_NOT_FOUND: %', p_payment_id;
      END IF;

      IF v_payment.status::text <> 'confirmed' THEN
        RAISE EXCEPTION 'CANONICAL_PAYMENT_NOT_CONFIRMED: payment=% status=%',
          p_payment_id, v_payment.status;
      END IF;

      SELECT sb.facility_id
        INTO v_facility_id
        FROM sport_center.sport_bookings sb
       WHERE sb.id = v_payment.booking_id;

      IF NOT FOUND OR v_facility_id IS NULL THEN
        RAISE EXCEPTION 'CANONICAL_COMPANY_UNRESOLVED: payment=% booking=%',
          p_payment_id, v_payment.booking_id;
      END IF;

      SELECT COUNT(*)::integer, MIN(fcm.company_id)
        INTO v_company_count, v_company_id
        FROM sport_center.facility_company_mappings fcm
        WHERE fcm.facility_id = v_facility_id
          AND fcm.is_active = TRUE
          AND fcm.approval_status = 'OWNER_APPROVED';

      IF v_company_count <> 1 OR v_company_id IS NULL THEN
        RAISE EXCEPTION 'CANONICAL_COMPANY_UNRESOLVED: facility=% active_mappings=%',
          v_facility_id, v_company_count;
      END IF;

      v_external_bank_account_id := NULLIF(BTRIM(v_payment.bank_account_id::text), '');
      IF v_external_bank_account_id IS NULL THEN
        RAISE EXCEPTION 'CANONICAL_BANK_ACCOUNT_UNRESOLVED: payment=%', p_payment_id;
      END IF;

      SELECT COUNT(*)::integer, MIN(cba.id)
        INTO v_bank_account_count, v_bank_account_id
        FROM public.company_bank_accounts cba
       WHERE cba.company_id = v_company_id
         AND cba.account_number::text = v_external_bank_account_id
         AND cba.is_active = TRUE;

      IF v_bank_account_count <> 1 OR v_bank_account_id IS NULL THEN
        RAISE EXCEPTION 'CANONICAL_BANK_ACCOUNT_UNRESOLVED: company=% account=% matches=%',
          v_company_id, v_external_bank_account_id, v_bank_account_count;
      END IF;

      v_provider_id := NULLIF(BTRIM(v_payment.provider_id::text), '');
      v_provider_name := NULLIF(BTRIM(v_payment.provider_name::text), '');
      v_provider_code := NULLIF(LOWER(BTRIM(v_payment.payment_provider::text)), '');
      IF v_provider_id IS NULL OR v_provider_name IS NULL OR v_provider_code IS NULL THEN
        RAISE EXCEPTION 'CANONICAL_PROVIDER_UNRESOLVED: payment=%', p_payment_id;
      END IF;

      v_payment_date := (COALESCE(
        v_payment.paid_at,
        v_payment.confirmed_at,
        v_payment.created_at
      ) AT TIME ZONE 'Asia/Jakarta')::date;

      SELECT COUNT(*)::integer, MIN(psc.rule_version), MIN(psc.settlement_delay_business_days)
        INTO v_company_count, v_rule_version, v_settlement_delay
        FROM sport_center.payment_settlement_configs psc
       WHERE psc.company_id = v_company_id
         AND LOWER(BTRIM(psc.provider_code)) = v_provider_code
         AND psc.bank_account_id = v_external_bank_account_id
         AND psc.is_active = TRUE
         AND psc.source = 'OWNER_APPROVED'
         AND psc.effective_from <= v_payment_date
         AND (psc.effective_until IS NULL OR v_payment_date < psc.effective_until);

      IF v_company_count <> 1
         OR v_rule_version IS NULL
         OR v_settlement_delay IS NULL THEN
        RAISE EXCEPTION 'CANONICAL_PROVIDER_RULE_UNRESOLVED: company=% provider=% bank=% matches=%',
          v_company_id, v_provider_code, v_external_bank_account_id, v_company_count;
      END IF;

      IF LOWER(COALESCE(v_payment.payment_method::text, '')) LIKE '%qris%' THEN
        -- QRIS settles on H+1 calendar day, including weekends and holidays.
        v_expected_settlement_date := v_payment_date + 1;
      ELSE
        -- Bank transfers settle on the next business day (H+1). This is
        -- intentionally fixed at one day for all transfer payments.
        v_expected_settlement_date := v_payment_date;
        v_remaining := 1;
        WHILE v_remaining > 0 LOOP
          v_expected_settlement_date := v_expected_settlement_date + 1;
          SELECT COALESCE(pbc.is_business_day, TRUE)
            INTO v_business_day
            FROM sport_center.payment_business_calendar pbc
           WHERE pbc.calendar_date = v_expected_settlement_date;
          IF EXTRACT(ISODOW FROM v_expected_settlement_date) < 6
             AND COALESCE(v_business_day, TRUE) THEN
            v_remaining := v_remaining - 1;
          END IF;
        END LOOP;
      END IF;

      UPDATE sport_center.sport_payments
         SET company_id = v_company_id,
             -- paid_at is the canonical payment timestamp.  Older source rows
             -- may only have confirmation/creation metadata; persist that
             -- legacy fallback so later readers do not re-infer a date from a
             -- booking row.
             paid_at = COALESCE(v_payment.paid_at, v_payment.confirmed_at, v_payment.created_at),
             expected_settlement_date = v_expected_settlement_date,
             settlement_rule_version = v_rule_version
       WHERE id = p_payment_id
         AND status::text = 'confirmed';

      resolved_company_id := v_company_id;
      resolved_expected_settlement_date := v_expected_settlement_date;
      resolved_rule_version := v_rule_version;
      RETURN NEXT;
    END;
    $function$
  `);

  await db.execute(sql`
    CREATE OR REPLACE FUNCTION sport_center.mirror_confirmed_payment_to_public()
    RETURNS trigger
    LANGUAGE plpgsql
    SECURITY DEFINER
    SET search_path TO 'pg_catalog', 'sport_center', 'public'
    AS $function$
    DECLARE
      v_canonical_metadata RECORD;
      v_public_booking_id integer;
      v_public_booking_count integer;
      v_booking_tax_rate numeric;
      v_facility_id integer;
      v_company_id integer;
      v_company_count integer;
      v_external_bank_account_id text;
      v_internal_bank_account_id integer;
      v_bank_account_count integer;
      v_provider_id text;
      v_provider_name text;
      v_provider_code text;
      v_provider_rule_version text;
      v_settlement_delay integer;
      v_payment_date date;
      v_expected_settlement_date date;
      v_business_day boolean;
      v_remaining integer;
      v_payment_number text;
      v_source jsonb;
      v_source_status text;
    BEGIN
      -- resolve_and_persist_payment_metadata() updates canonical metadata
      -- inside this trigger. Do not re-enter the mirror projection for that
      -- internal update or the all-column trigger would recurse forever.
      IF pg_trigger_depth() > 1 THEN
        RETURN NEW;
      END IF;

      -- Keep the projection broad: a change to any column on the canonical
      -- payment must reach the public mirror. JSONB is intentional here so a
      -- legacy source column can be optional without making the trigger
      -- impossible to install on an older runtime snapshot.
      v_source := to_jsonb(NEW);
      v_source_status := COALESCE(v_source->>'status', '');

      IF NEW.status::text <> 'confirmed' THEN
        -- A payment can be cancelled/refunded after it was confirmed. The
        -- public mirror must show that source state even though a posted
        -- accounting journal is never rewritten by this projection.
        UPDATE public.sport_payments
           SET amount = COALESCE(NULLIF(v_source->>'amount', '')::numeric, amount),
               method = COALESCE(NULLIF(v_source->>'payment_method', ''), method),
               status = CASE
                 WHEN v_source_status IN ('cancelled', 'canceled') THEN 'cancelled'
                 WHEN v_source_status = 'refunded' THEN 'refunded'
                 WHEN v_source_status <> '' THEN v_source_status
                 ELSE status
               END,
               paid_at = COALESCE(
                 NULLIF(v_source->>'paid_at', '')::timestamptz,
                 NULLIF(v_source->>'confirmed_at', '')::timestamptz,
                  NULLIF(v_source->>'created_at', '')::timestamptz,
                 paid_at
               ),
               payment_type = COALESCE(NULLIF(v_source->>'payment_type', ''), payment_type),
               updated_at = now()
         WHERE payment_number = 'SCPAY-SC-' || NEW.id::text;
        RETURN NEW;
      END IF;

      v_payment_number := 'SCPAY-SC-' || NEW.id::text;

      -- Persist canonical metadata first.  The following projection uses the
      -- same owner-approved resolution contract and remains idempotent.
      SELECT *
        INTO v_canonical_metadata
        FROM sport_center.resolve_and_persist_payment_metadata(NEW.id);

      SELECT COUNT(*)::integer, MIN(pb.id)
        INTO v_public_booking_count, v_public_booking_id
        FROM public.sport_bookings pb
       WHERE pb.sc_booking_id = NEW.booking_id;

      IF v_public_booking_count = 0 THEN
        RAISE EXCEPTION 'MIRROR_BOOKING_BRIDGE_MISSING: canonical booking % has no public bridge', NEW.booking_id
          USING ERRCODE = 'P0001';
      ELSIF v_public_booking_count > 1 THEN
        RAISE EXCEPTION 'MIRROR_BOOKING_BRIDGE_AMBIGUOUS: canonical booking % has % public bridges',
          NEW.booking_id, v_public_booking_count
          USING ERRCODE = 'P0001';
      END IF;

      SELECT sb.facility_id, sb.ppn_rate
        INTO v_facility_id, v_booking_tax_rate
        FROM sport_center.sport_bookings sb
       WHERE sb.id = NEW.booking_id;

      IF NOT FOUND OR v_facility_id IS NULL THEN
        RAISE EXCEPTION 'MIRROR_COMPANY_UNRESOLVED: canonical booking % has no facility',
          NEW.booking_id
          USING ERRCODE = 'P0001';
      END IF;

      SELECT COUNT(*)::integer, MIN(fcm.company_id)
        INTO v_company_count, v_company_id
        FROM sport_center.facility_company_mappings fcm
        WHERE fcm.facility_id = v_facility_id
          AND fcm.is_active = TRUE
          AND fcm.approval_status = 'OWNER_APPROVED';

      IF v_company_count = 0 OR v_company_id IS NULL THEN
        RAISE EXCEPTION 'MIRROR_COMPANY_UNRESOLVED: facility % has no active company mapping',
          v_facility_id
          USING ERRCODE = 'P0001';
      ELSIF v_company_count > 1 THEN
        RAISE EXCEPTION 'MIRROR_COMPANY_UNRESOLVED: facility % has % active company mappings',
          v_facility_id, v_company_count
          USING ERRCODE = 'P0001';
      END IF;

      v_external_bank_account_id := NULLIF(BTRIM(NEW.bank_account_id::text), '');
      IF v_external_bank_account_id IS NULL THEN
        RAISE EXCEPTION 'MIRROR_BANK_ACCOUNT_UNRESOLVED: canonical payment % has no external bank account',
          NEW.id
          USING ERRCODE = 'P0001';
      END IF;

      SELECT COUNT(*)::integer, MIN(cba.id)
        INTO v_bank_account_count, v_internal_bank_account_id
        FROM public.company_bank_accounts cba
       WHERE cba.company_id = v_company_id
         AND cba.account_number::text = v_external_bank_account_id
         AND cba.is_active = TRUE;

      IF v_bank_account_count = 0 OR v_internal_bank_account_id IS NULL THEN
        RAISE EXCEPTION 'MIRROR_BANK_ACCOUNT_UNRESOLVED: company % has no active bank account %',
          v_company_id, v_external_bank_account_id
          USING ERRCODE = 'P0001';
      ELSIF v_bank_account_count > 1 THEN
        RAISE EXCEPTION 'MIRROR_BANK_ACCOUNT_UNRESOLVED: company % has % active matches for bank account %',
          v_company_id, v_bank_account_count, v_external_bank_account_id
          USING ERRCODE = 'P0001';
      END IF;

      v_provider_id := NULLIF(BTRIM(NEW.provider_id::text), '');
      v_provider_name := NULLIF(BTRIM(NEW.provider_name::text), '');
      v_provider_code := NULLIF(LOWER(BTRIM(NEW.payment_provider::text)), '');
      IF v_provider_id IS NULL OR v_provider_name IS NULL OR v_provider_code IS NULL THEN
        RAISE EXCEPTION 'MIRROR_PROVIDER_RULE_UNRESOLVED: canonical payment % has incomplete provider identity',
          NEW.id
          USING ERRCODE = 'P0001';
      END IF;

      v_payment_date := (COALESCE(NEW.paid_at, NEW.confirmed_at, NEW.created_at)
        AT TIME ZONE 'Asia/Jakarta')::date;

      SELECT COUNT(*)::integer, MIN(psc.rule_version), MIN(psc.settlement_delay_business_days)
        INTO v_company_count, v_provider_rule_version, v_settlement_delay
        FROM sport_center.payment_settlement_configs psc
       WHERE psc.company_id = v_company_id
         AND LOWER(BTRIM(psc.provider_code)) = v_provider_code
         AND psc.bank_account_id = v_external_bank_account_id
         AND psc.is_active = TRUE
         AND psc.source = 'OWNER_APPROVED'
         AND psc.effective_from <= v_payment_date
         AND (psc.effective_until IS NULL OR v_payment_date < psc.effective_until);

      IF v_company_count = 0 OR v_provider_rule_version IS NULL OR v_settlement_delay IS NULL THEN
        RAISE EXCEPTION 'MIRROR_PROVIDER_RULE_UNRESOLVED: no owner-approved rule for company %, provider %, bank %',
          v_company_id, v_provider_code, v_external_bank_account_id
          USING ERRCODE = 'P0001';
      ELSIF v_company_count > 1 THEN
        RAISE EXCEPTION 'MIRROR_PROVIDER_RULE_UNRESOLVED: multiple owner-approved rules for company %, provider %, bank %',
          v_company_id, v_provider_code, v_external_bank_account_id
          USING ERRCODE = 'P0001';
      END IF;

      IF LOWER(COALESCE(NEW.payment_method::text, '')) LIKE '%qris%' THEN
        -- QRIS settles on H+1 calendar day, including weekends and holidays.
        v_expected_settlement_date := v_payment_date + 1;
      ELSE
        -- Bank transfers settle on the next business day.
        v_expected_settlement_date := v_payment_date;
        v_remaining := GREATEST(v_settlement_delay, 0);
        WHILE v_remaining > 0 LOOP
          v_expected_settlement_date := v_expected_settlement_date + 1;
          SELECT COALESCE(pbc.is_business_day, TRUE)
            INTO v_business_day
            FROM sport_center.payment_business_calendar pbc
           WHERE pbc.calendar_date = v_expected_settlement_date;
          IF EXTRACT(ISODOW FROM v_expected_settlement_date) < 6
             AND COALESCE(v_business_day, TRUE) THEN
            v_remaining := v_remaining - 1;
          END IF;
        END LOOP;
      END IF;

      INSERT INTO public.sport_payments
        (booking_id, payment_number, amount, method, status, paid_at,
         payment_type, tax_rate, tax_amount, source, posting_status,
         company_id, provider_id, payment_provider, provider_code,
         bank_account_id, external_bank_account_id,
         expected_settlement_date, settlement_rule_version, settlement_status,
         source_schema, source_table, source_payment_id,
         created_at, updated_at)
      VALUES
        (v_public_booking_id,
         v_payment_number,
         NEW.amount,
         COALESCE(NEW.payment_method, 'Transfer Bank'),
         'paid',
         COALESCE(NEW.paid_at, NEW.confirmed_at, NEW.created_at),
         COALESCE(NEW.payment_type::text, 'full_payment'),
         COALESCE(v_booking_tax_rate, 0),
         0,
         'SPORT_CENTER_SUPABASE',
         'unposted',
         v_company_id,
         v_provider_id,
         v_provider_name,
         v_provider_code,
         v_internal_bank_account_id,
         v_external_bank_account_id,
         v_expected_settlement_date::text,
         v_provider_rule_version,
         COALESCE(NULLIF(BTRIM(NEW.settlement_status::text), ''), 'unsettled'),
         'sport_center',
         'sport_payments',
         NEW.id,
         NEW.created_at,
         now())
      ON CONFLICT (payment_number) DO UPDATE
        SET booking_id = COALESCE(public.sport_payments.booking_id, EXCLUDED.booking_id),
            company_id = EXCLUDED.company_id,
            provider_id = EXCLUDED.provider_id,
            payment_provider = EXCLUDED.payment_provider,
            provider_code = EXCLUDED.provider_code,
            bank_account_id = EXCLUDED.bank_account_id,
            external_bank_account_id = EXCLUDED.external_bank_account_id,
            expected_settlement_date = EXCLUDED.expected_settlement_date,
            settlement_rule_version = EXCLUDED.settlement_rule_version,
            settlement_status = EXCLUDED.settlement_status,
            source_schema = EXCLUDED.source_schema,
            source_table = EXCLUDED.source_table,
            source_payment_id = EXCLUDED.source_payment_id,
             -- The public table is a source projection, not a second ledger.
             -- Always reflect source changes here. The accounting trigger
             -- below decides which fields are safe to copy into the ledger.
             amount = EXCLUDED.amount,
             method = EXCLUDED.method,
             paid_at = EXCLUDED.paid_at,
             payment_type = EXCLUDED.payment_type,
             tax_rate = EXCLUDED.tax_rate,
             tax_amount = EXCLUDED.tax_amount,
            updated_at = now();

      RETURN NEW;
    END;
    $function$
  `);

  // Keep public accounting rows in sync whenever the public projection
  // changes. This also covers legacy/BizPortal updates that write directly to
  // public.sport_payments rather than through the canonical schema trigger.
  //
  // Financial fields are copied only while the accounting row/journal is not
  // posted. A posted journal remains immutable; if its source amount/status
  // changes, the source row is explicitly marked manual_review so the owner
  // can use the reversal/correction workflow.
  await db.execute(sql`
    CREATE OR REPLACE FUNCTION public.sync_sport_payment_to_accounting()
    RETURNS trigger
    LANGUAGE plpgsql
    SECURITY DEFINER
    SET search_path TO 'pg_catalog', 'public'
    AS $function$
    DECLARE
      v_financial_conflict boolean := FALSE;
    BEGIN
      -- Prevent the review marker update below from recursively syncing.
      IF pg_trigger_depth() > 1 THEN
        RETURN NEW;
      END IF;

      IF TG_OP = 'UPDATE'
         AND (
           OLD.amount IS DISTINCT FROM NEW.amount
           OR OLD.status IS DISTINCT FROM NEW.status
           OR OLD.paid_at IS DISTINCT FROM NEW.paid_at
         )
         AND EXISTS (
           SELECT 1
           FROM accounting_payments ap
           LEFT JOIN accounting_entries ae ON ae.id = ap.entry_id
           WHERE ap.source_type = 'sport_center'
             AND ap.source_doc_id = NEW.id
             AND (ap.status::text = 'posted' OR ae.status::text = 'posted')
         )
      THEN
        v_financial_conflict := TRUE;
      END IF;

      -- payment_method is observational metadata and may be corrected even
      -- when the linked journal is posted. Amount/date stay write-once after
      -- posting to preserve the audit trail.
      UPDATE accounting_payments ap
         SET company_id = COALESCE(NEW.company_id, ap.company_id),
             payment_method = COALESCE(NULLIF(BTRIM(NEW.method::text), ''), ap.payment_method),
             payment_provider = COALESCE(NULLIF(BTRIM(NEW.payment_provider::text), ''), ap.payment_provider),
             amount = CASE
               WHEN ap.status::text NOT IN ('posted', 'voided')
                AND NOT EXISTS (
                  SELECT 1 FROM accounting_entries ae
                  WHERE ae.id = ap.entry_id AND ae.status::text = 'posted'
                )
               THEN NEW.amount
               ELSE ap.amount
             END,
             date = CASE
               WHEN ap.status::text NOT IN ('posted', 'voided')
                AND NOT EXISTS (
                  SELECT 1 FROM accounting_entries ae
                  WHERE ae.id = ap.entry_id AND ae.status::text = 'posted'
                )
               THEN COALESCE(NEW.paid_at::date, ap.date)
               ELSE ap.date
             END,
             updated_at = now()
       WHERE ap.source_type = 'sport_center'
         AND ap.source_doc_id = NEW.id;

      -- Keep journal metadata aligned without ever touching posted financial
      -- fields.  The WHERE predicate is important: an MDR/settlement-only
      -- source update must not issue a no-op UPDATE against a posted entry,
      -- because legacy immutability triggers may still reject UPDATEs before
      -- the additive metadata policy has been installed.
      UPDATE accounting_entries ae
         SET company_id = CASE
               WHEN ae.status::text <> 'posted'
               THEN COALESCE(NEW.company_id, ae.company_id)
               ELSE ae.company_id
             END,
             payment_method = COALESCE(NULLIF(BTRIM(NEW.method::text), ''), ae.payment_method),
             payment_provider = COALESCE(NULLIF(BTRIM(NEW.payment_provider::text), ''), ae.payment_provider),
             bank_account_id = COALESCE(
               CASE
                 WHEN ae.status::text <> 'posted'
                 THEN NULLIF(BTRIM(NEW.external_bank_account_id::text), '')
                 ELSE NULL
               END,
               ae.bank_account_id
             ),
             date = CASE
               WHEN ae.status::text <> 'posted'
               THEN COALESCE(NEW.paid_at::date, ae.date)
               ELSE ae.date
             END
       WHERE ae.id IN (
         SELECT ap.entry_id
         FROM accounting_payments ap
         WHERE ap.source_type = 'sport_center'
           AND ap.source_doc_id = NEW.id
           AND ap.entry_id IS NOT NULL
       )
       AND (
         ae.company_id IS DISTINCT FROM CASE
           WHEN ae.status::text <> 'posted'
           THEN COALESCE(NEW.company_id, ae.company_id)
           ELSE ae.company_id
         END
         OR ae.payment_method IS DISTINCT FROM
           COALESCE(NULLIF(BTRIM(NEW.method::text), ''), ae.payment_method)
         OR ae.payment_provider IS DISTINCT FROM
           COALESCE(NULLIF(BTRIM(NEW.payment_provider::text), ''), ae.payment_provider)
         OR ae.bank_account_id IS DISTINCT FROM COALESCE(
           CASE
             WHEN ae.status::text <> 'posted'
             THEN NULLIF(BTRIM(NEW.external_bank_account_id::text), '')
             ELSE NULL
           END,
           ae.bank_account_id
         )
         OR ae.date IS DISTINCT FROM CASE
           WHEN ae.status::text <> 'posted'
           THEN COALESCE(NEW.paid_at::date, ae.date)
           ELSE ae.date
         END
       );

      IF v_financial_conflict THEN
        UPDATE public.sport_payments
           SET posting_status = 'manual_review',
               posting_error = LEFT(
                 'Sumber Sport Center berubah setelah accounting posted; gunakan reversal/correction workflow',
                 1000
               ),
               updated_at = now()
         WHERE id = NEW.id
           AND (
             posting_status IS DISTINCT FROM 'manual_review'
             OR posting_error IS DISTINCT FROM
               'Sumber Sport Center berubah setelah accounting posted; gunakan reversal/correction workflow'
           );
      END IF;

      RETURN NEW;
    EXCEPTION WHEN OTHERS THEN
      -- Do not roll back a valid source/mirror update because an optional
      -- legacy accounting column or trigger is unavailable. The next worker
      -- run can retry and the source remains visible for repair.
      RAISE WARNING 'Sport Center accounting projection failed for payment %: %', NEW.id, SQLERRM;
      RETURN NEW;
    END;
    $function$
  `);

  // CREATE TRIGGER has no IF NOT EXISTS. The catalog guard preserves a valid
  // runtime-owned trigger; this creation path is only reached when the
  // contract preflight found it absent.
  await db.execute(sql`
    DO $migration$
    BEGIN
      IF NOT EXISTS (
        SELECT 1
        FROM pg_trigger t
        JOIN pg_class c ON c.oid = t.tgrelid
        JOIN pg_namespace n ON n.oid = c.relnamespace
        WHERE n.nspname = 'sport_center'
          AND c.relname = 'sport_payments'
          AND t.tgname = 'trg_mirror_confirmed_payment_to_public'
          AND NOT t.tgisinternal
      ) THEN
        EXECUTE 'CREATE TRIGGER trg_mirror_confirmed_payment_to_public
                 AFTER INSERT OR UPDATE
                 ON sport_center.sport_payments
                 FOR EACH ROW
                 EXECUTE FUNCTION sport_center.mirror_confirmed_payment_to_public()';
      END IF;
    END;
    $migration$
  `);
  await db.execute(sql`
    DO $migration$
    BEGIN
      IF NOT EXISTS (
        SELECT 1
        FROM pg_trigger t
        JOIN pg_class c ON c.oid = t.tgrelid
        JOIN pg_namespace n ON n.oid = c.relnamespace
        WHERE n.nspname = 'public'
          AND c.relname = 'sport_payments'
          AND t.tgname = 'trg_sync_sport_payment_to_accounting'
          AND NOT t.tgisinternal
      ) THEN
        EXECUTE 'CREATE TRIGGER trg_sync_sport_payment_to_accounting
                 AFTER INSERT OR UPDATE
                 ON public.sport_payments
                 FOR EACH ROW
                 EXECUTE FUNCTION public.sync_sport_payment_to_accounting()';
      END IF;
    END;
    $migration$
  `);

  // Fungsi cross-schema untuk worker: temukan confirmed payments yang belum punya mirror.
  // SECURITY DEFINER agar bisa membaca sport_center.sport_payments tanpa service role key.
  // PostgreSQL tidak mengizinkan CREATE OR REPLACE mengubah RETURNS TABLE.
  // Helper ini bukan trigger owner dan tidak menyimpan state, jadi drop/recreate
  // eksplisit adalah satu-satunya cara aman untuk menambahkan paid_at.
  await db.execute(sql`
    DROP FUNCTION IF EXISTS sport_center.get_unmirrored_confirmed_payments()
  `);
  await db.execute(sql`
    CREATE OR REPLACE FUNCTION sport_center.get_unmirrored_confirmed_payments()
    RETURNS TABLE (
      sc_payment_id  INTEGER,
      sc_booking_id  INTEGER,
      amount         NUMERIC,
      payment_method TEXT,
      paid_at        TIMESTAMPTZ,
      confirmed_at   TIMESTAMPTZ,
      created_at     TIMESTAMPTZ
    )
    LANGUAGE plpgsql
    SECURITY DEFINER
    SET search_path TO 'pg_catalog', 'sport_center', 'public'
    AS $fn$
    BEGIN
      RETURN QUERY
      SELECT
        sp.id              AS sc_payment_id,
        sp.booking_id      AS sc_booking_id,
        sp.amount          AS amount,
        sp.payment_method  AS payment_method,
        sp.paid_at         AS paid_at,
        sp.confirmed_at    AS confirmed_at,
        sp.created_at      AS created_at
      FROM sport_center.sport_payments sp
      WHERE sp.status::text = 'confirmed'
        AND NOT EXISTS (
          SELECT 1
          FROM public.sport_payments pub
          WHERE pub.payment_number = 'SCPAY-SC-' || sp.id::text
        );
    END;
    $fn$
  `);

  await db.execute(sql`
    CREATE OR REPLACE FUNCTION sport_center.replay_confirmed_payment_mirror(p_payment_id integer)
    RETURNS boolean
    LANGUAGE plpgsql
    SECURITY DEFINER
    SET search_path TO 'pg_catalog', 'sport_center', 'public'
    AS $fn$
    DECLARE
      v_found boolean;
    BEGIN
      UPDATE sport_center.sport_payments
         SET status = status,
             updated_at = updated_at
       WHERE id = p_payment_id
         AND status::text = 'confirmed'
      RETURNING TRUE INTO v_found;
      RETURN COALESCE(v_found, FALSE);
    END;
    $fn$
  `);

  logger.info(
    "Sport Center payment mirror trigger: resolver, function, unique idempotency index, trigger, replay, dan get_unmirrored_confirmed_payments aktif",
  );
  })();

  // Keep concurrent callers on the same DDL lane. Clear the cache on failure so
  // a later retry can repair a transient DB/lock problem.
  sportPaymentMirrorTriggerEnsurePromise = provisioning.catch((err) => {
    sportPaymentMirrorTriggerEnsurePromise = null;
    throw err;
  });
  return sportPaymentMirrorTriggerEnsurePromise;
}

/**
 * Restore only the QRIS metadata that can be proven from explicit masters.
 *
 * The public facility master is the owner-approved source for the
 * facility→company mapping in the development contract.  Bank accounts and
 * settlement rules are intentionally not invented here: the canonical
 * resolver is called per payment and fails closed when either dimension is
 * missing, ambiguous, or not OWNER_APPROVED.
 */
export async function backfillCanonicalQrisPaymentMetadata(): Promise<void> {
  try {
    await db.execute(sql`
      CREATE TABLE IF NOT EXISTS sport_center.facility_company_mappings (
        id               SERIAL PRIMARY KEY,
        facility_id      INTEGER NOT NULL,
        company_id       INTEGER NOT NULL,
        approval_status  TEXT NOT NULL DEFAULT 'PENDING',
        source           TEXT,
        is_active        BOOLEAN NOT NULL DEFAULT TRUE,
        effective_from   DATE NOT NULL DEFAULT DATE '1970-01-01',
        created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at       TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )
    `);
    await db.execute(sql`
      ALTER TABLE sport_center.facility_company_mappings
        ADD COLUMN IF NOT EXISTS approval_status TEXT,
        ADD COLUMN IF NOT EXISTS source TEXT,
        ADD COLUMN IF NOT EXISTS is_active BOOLEAN NOT NULL DEFAULT TRUE,
        ADD COLUMN IF NOT EXISTS effective_from DATE NOT NULL DEFAULT DATE '1970-01-01',
        ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    `);
    await db.execute(sql`
      CREATE UNIQUE INDEX IF NOT EXISTS uq_facility_company_mapping_pair
        ON sport_center.facility_company_mappings(facility_id, company_id)
    `);

    // Do not overwrite an existing mapping.  An existing conflicting mapping
    // remains visible to the resolver as ambiguous and therefore blocks
    // metadata recovery until an owner corrects it.
    await db.execute(sql`
      INSERT INTO sport_center.facility_company_mappings
        (facility_id, company_id, approval_status, source, is_active, effective_from)
      SELECT
        source_facility.id,
        public_facility.company_id,
        'OWNER_APPROVED',
        'public.sport_facilities.company_id',
        TRUE,
        DATE '1970-01-01'
      FROM sport_center.sport_facilities source_facility
      JOIN public.sport_facilities public_facility
        ON public_facility.id = source_facility.id
      WHERE source_facility.is_active = TRUE
        AND public_facility.is_active = TRUE
        AND public_facility.company_id IS NOT NULL
      ON CONFLICT (facility_id, company_id) DO NOTHING
    `);

    const before = await db.execute(sql`
      SELECT COUNT(*)::integer AS unresolved
      FROM sport_center.sport_payments
      WHERE status::text = 'confirmed'
        AND LOWER(COALESCE(payment_method::text, '')) LIKE '%qris%'
        AND (
          company_id IS NULL
          OR expected_settlement_date IS NULL
          OR settlement_rule_version IS NULL
        )
    `);

    // Each payment gets its own exception boundary.  One missing external
    // account or provider rule must not roll back metadata recovered for a
    // different payment.
    await db.execute(sql`
      DO $migration$
      DECLARE
        v_payment_id INTEGER;
      BEGIN
        FOR v_payment_id IN
          SELECT id
          FROM sport_center.sport_payments
          WHERE status::text = 'confirmed'
            AND LOWER(COALESCE(payment_method::text, '')) LIKE '%qris%'
            AND (
              company_id IS NULL
              OR expected_settlement_date IS NULL
              OR settlement_rule_version IS NULL
            )
          ORDER BY id
        LOOP
          BEGIN
            PERFORM sport_center.resolve_and_persist_payment_metadata(v_payment_id);
          EXCEPTION WHEN OTHERS THEN
            -- Fail closed for this row; the next migration run can retry after
            -- the owner adds the missing bank account/provider configuration.
            NULL;
          END;
        END LOOP;
      END;
      $migration$
    `);

    const after = await db.execute(sql`
      SELECT COUNT(*)::integer AS unresolved
      FROM sport_center.sport_payments
      WHERE status::text = 'confirmed'
        AND LOWER(COALESCE(payment_method::text, '')) LIKE '%qris%'
        AND (
          company_id IS NULL
          OR expected_settlement_date IS NULL
          OR settlement_rule_version IS NULL
        )
    `);
    logger.info(
      {
        recovered: Number((before.rows[0] as Record<string, unknown> | undefined)?.unresolved ?? 0)
          - Number((after.rows[0] as Record<string, unknown> | undefined)?.unresolved ?? 0),
        unresolved: Number((after.rows[0] as Record<string, unknown> | undefined)?.unresolved ?? 0),
      },
      "QRIS canonical metadata backfill selesai; unresolved rows tetap fail-closed",
    );
  } catch (err) {
    logger.warn(
      { err },
      "QRIS canonical metadata backfill dilewati karena runtime schema belum lengkap",
    );
  }
}

/**
 * Canonical settlement ownership and grouping backstops.
 *
 * The settlement tables/functions are owned by the Supabase `sport_center`
 * schema.  Keep this additive and guarded so the normal local/public Sport
 * Center migration does not attempt to provision a partial canonical schema.
 */
async function repairCanonicalBankCoaIdentity(): Promise<void> {
  const tableExists = await db.execute(sql`
    SELECT EXISTS (
      SELECT 1
      FROM information_schema.tables
      WHERE table_schema = 'sport_center'
        AND table_name = 'coa_accounts'
    ) AS exists
  `);
  if (!(tableExists.rows[0] as Record<string, unknown> | undefined)?.exists) {
    return;
  }

  /*
   * Resolve the existing canonical row by its stable code/type identity.
   * Do not insert or deactivate anything here: an absent or ambiguous
   * canonical account must remain a visible fail-closed configuration error.
   */
  const canonicalBankRows = await db.execute(sql`
    SELECT id, name, is_active
    FROM sport_center.coa_accounts
    WHERE code = '1-1023-CST'
      AND account_type::text = 'asset'
      AND is_active = TRUE
    ORDER BY id
    FOR UPDATE
  `);
  if (canonicalBankRows.rows.length !== 1) {
    /*
     * PROD Central Finance owns COA identity in public.chart_of_accounts.
     * Some production snapshots retain the legacy sport_center.coa_accounts
     * relation without its historical row.  The targeted CF-SC-12B migration
     * has already verified the public canonical identity, so do not recreate or
     * rewrite a legacy row merely to satisfy this optional repair helper.
     */
    const publicCanonicalBank = await db.execute(sql`
      SELECT id, code, name
      FROM public.chart_of_accounts
      WHERE id = 75590
        AND company_id = 1
        AND code = '1-1023-CST'
        AND name = 'Bank Mandiri Ciputat'
        AND is_active = TRUE
        AND is_postable = TRUE
        AND is_header = FALSE
    `);
    if (canonicalBankRows.rows.length === 0 && publicCanonicalBank.rows.length === 1) {
      logger.info(
        { canonicalCoaId: 75590 },
        "Canonical Sport Center bank COA resolved from public.chart_of_accounts",
      );
      return;
    }
    throw new Error(
      `Canonical bank COA identity unresolved: expected exactly one active ` +
      `sport_center.coa_accounts row for 1-1023-CST/asset, found ${canonicalBankRows.rows.length}.`,
    );
  }
  const canonicalBank = canonicalBankRows.rows[0] as Record<string, unknown>;
  if (String(canonicalBank.name ?? "").trim() !== "Bank Mandiri Ciputat") {
    await db.execute(sql`
      UPDATE sport_center.coa_accounts
      SET name = 'Bank Mandiri Ciputat',
          updated_at = NOW()
      WHERE id = ${Number(canonicalBank.id)}
    `);
    logger.info(
      { canonicalCoaId: Number(canonicalBank.id) },
      "Canonical Sport Center bank COA name repaired to Bank Mandiri Ciputat",
    );
  }
}

export async function ensureCanonicalSettlementContracts(): Promise<void> {
  await repairCanonicalBankCoaIdentity();

  const exists = await db.execute(sql`
    SELECT
      EXISTS (
        SELECT 1
        FROM information_schema.tables
        WHERE table_schema = 'sport_center'
          AND table_name = 'sport_payments'
      ) AS sport_payments_exists,
      EXISTS (
        SELECT 1
        FROM information_schema.tables
        WHERE table_schema = 'sport_center'
          AND table_name = 'payment_settlement_batches'
      ) AS settlement_batches_exists,
      EXISTS (
        SELECT 1
        FROM information_schema.tables
        WHERE table_schema = 'sport_center'
          AND table_name = 'payment_settlement_items'
      ) AS settlement_items_exists,
      EXISTS (
        SELECT 1
        FROM information_schema.tables
        WHERE table_schema = 'sport_center'
          AND table_name = 'accounting_journals'
      ) AS accounting_journals_exists
       ,
       EXISTS (
         SELECT 1
         FROM information_schema.tables
         WHERE table_schema = 'sport_center'
           AND table_name = 'bank_mutations'
       ) AS canonical_bank_mutations_exists,
       EXISTS (
         SELECT 1
         FROM information_schema.tables
         WHERE table_schema = 'public'
           AND table_name = 'bank_mutations'
       ) AS public_bank_mutations_exists,
       EXISTS (
         SELECT 1
         FROM information_schema.tables
         WHERE table_schema = 'sport_center'
           AND table_name = 'payment_settlement_configs'
       ) AS settlement_configs_exists
  `);
  const objects = exists.rows[0] as Record<string, boolean> | undefined;
  if (
    !objects?.sport_payments_exists ||
    !objects.settlement_batches_exists ||
    !objects.settlement_items_exists ||
     !objects.accounting_journals_exists ||
     !objects.canonical_bank_mutations_exists ||
     !objects.public_bank_mutations_exists ||
     !objects.settlement_configs_exists
  ) {
    logger.info("Canonical Sport Center settlement schema belum lengkap; contract migration dilewati");
    return;
  }

  // The canonical payment owner stores the provider's bank identifier as
  // TEXT metadata on sport_center.sport_payments.  The accounting journal
  // uses the internal company_bank_accounts.id INTEGER.  Older runtime
  // definitions passed v_payment.bank_account_id straight into that integer
  // column, which overflows for valid external account numbers such as
  // 1640006707220.  Keep the external value untouched and resolve it only at
  // the owner boundary.
  await db.execute(sql.raw(`
    CREATE OR REPLACE FUNCTION sport_center.resolve_shared_finance_config(
      p_project_code text,
      p_company_id integer,
      p_payment_method text,
      p_provider_code text,
      p_effective_date date
    )
    RETURNS TABLE (
      config_id integer,
      config_version integer,
      payment_config_id integer,
      tax_mapping_id integer,
      effective_configuration_identity text,
      tax_rule_id integer,
      tax_rate numeric,
      tax_direction text,
      bank_account_id integer,
      bank_account_number text,
      bank_name text,
      currency_code text,
      settlement_delay_business_days integer,
      mdr_rate numeric,
      fixed_provider_fee numeric,
      fee_tax_rate numeric,
      fee_tax_inclusive boolean,
      receiving_bank_coa_id integer,
      receiving_bank_coa_code text,
      receiving_bank_coa_name text,
      revenue_coa_id integer,
      revenue_coa_code text,
      revenue_coa_name text,
      tax_output_coa_id integer,
      tax_output_coa_code text,
      tax_output_coa_name text,
      mdr_expense_coa_id integer,
      mdr_expense_coa_code text,
      mdr_expense_coa_name text,
      clearing_coa_id integer,
      clearing_coa_code text,
      clearing_coa_name text
    )
    LANGUAGE plpgsql
    SECURITY DEFINER
    SET search_path TO 'pg_catalog', 'public'
    AS $function$
    DECLARE
      v_config record;
      v_payment record;
      v_tax record;
      v_bank record;
      v_role text;
      v_count integer;
      v_map record;
      v_payment_config_id integer;
      v_tax_mapping_id integer;
      v_bank_id integer;
      v_ids integer[] := ARRAY[]::integer[];
    BEGIN
      SELECT COUNT(*)::integer
        INTO v_count
        FROM public.finance_project_configs c
       WHERE c.project_code = p_project_code
         AND c.company_id = p_company_id
         AND c.is_active = TRUE
         AND c.effective_from <= p_effective_date
         AND (c.effective_to IS NULL OR p_effective_date < c.effective_to);
      IF v_count <> 1 THEN
        RAISE EXCEPTION 'BLOCKED_CONFIG_%: project=% company=% matches=%',
          CASE WHEN v_count = 0 THEN 'MISSING' ELSE 'AMBIGUOUS' END,
          p_project_code, p_company_id, v_count;
      END IF;
      SELECT c.* INTO v_config
        FROM public.finance_project_configs c
       WHERE c.project_code = p_project_code
         AND c.company_id = p_company_id
         AND c.is_active = TRUE
         AND c.effective_from <= p_effective_date
         AND (c.effective_to IS NULL OR p_effective_date < c.effective_to);

      SELECT COUNT(*)::integer
        INTO v_count
        FROM public.finance_project_payment_configs pc
       WHERE pc.finance_project_config_id = v_config.id
         AND upper(btrim(pc.payment_method)) = upper(btrim(p_payment_method))
         AND lower(btrim(pc.provider_code)) = lower(btrim(p_provider_code))
         AND pc.is_active = TRUE
         AND pc.effective_from <= p_effective_date
         AND (pc.effective_to IS NULL OR p_effective_date < pc.effective_to);
      IF v_count <> 1 THEN
        RAISE EXCEPTION 'BLOCKED_CONFIG_%: payment=% provider=% matches=%',
          CASE WHEN v_count = 0 THEN 'MISSING' ELSE 'AMBIGUOUS' END,
          p_payment_method, p_provider_code, v_count;
      END IF;
      SELECT pc.id INTO v_payment_config_id
        FROM public.finance_project_payment_configs pc
       WHERE pc.finance_project_config_id = v_config.id
         AND upper(btrim(pc.payment_method)) = upper(btrim(p_payment_method))
         AND lower(btrim(pc.provider_code)) = lower(btrim(p_provider_code))
         AND pc.is_active = TRUE
         AND pc.effective_from <= p_effective_date
         AND (pc.effective_to IS NULL OR p_effective_date < pc.effective_to);
      SELECT pc.* INTO v_payment
        FROM public.finance_project_payment_configs pc
       WHERE pc.id = v_payment_config_id;

      SELECT COUNT(*)::integer AS count, MIN(tm.id) AS id
        INTO v_count, v_tax_mapping_id
        FROM public.finance_project_tax_mappings tm
       WHERE tm.finance_project_config_id = v_config.id
         AND tm.transaction_type = 'sport_booking_payment'
         AND (tm.payment_method IS NULL OR upper(btrim(tm.payment_method)) = upper(btrim(p_payment_method)))
         AND (tm.provider_code IS NULL OR lower(btrim(tm.provider_code)) = lower(btrim(p_provider_code)))
         AND tm.is_active = TRUE
         AND tm.effective_from <= p_effective_date
         AND (tm.effective_to IS NULL OR p_effective_date < tm.effective_to)
         AND NOT EXISTS (
           SELECT 1
             FROM public.finance_project_tax_mappings more_specific
            WHERE more_specific.finance_project_config_id = tm.finance_project_config_id
              AND more_specific.transaction_type = tm.transaction_type
              AND more_specific.is_active = TRUE
              AND more_specific.effective_from <= p_effective_date
              AND (more_specific.effective_to IS NULL OR p_effective_date < more_specific.effective_to)
              AND (more_specific.payment_method IS NULL OR upper(btrim(more_specific.payment_method)) = upper(btrim(p_payment_method)))
              AND (more_specific.provider_code IS NULL OR lower(btrim(more_specific.provider_code)) = lower(btrim(p_provider_code)))
              AND (
                (more_specific.payment_method IS NOT NULL)::integer
                + (more_specific.provider_code IS NOT NULL)::integer
              ) > (tm.payment_method IS NOT NULL)::integer + (tm.provider_code IS NOT NULL)::integer
         );
      IF v_count <> 1 THEN
        RAISE EXCEPTION 'BLOCKED_CONFIG_%: tax mapping matches=%',
          CASE WHEN v_count = 0 THEN 'MISSING' ELSE 'AMBIGUOUS' END, v_count;
      END IF;
      SELECT tm.* INTO v_tax FROM public.finance_project_tax_mappings tm WHERE tm.id = v_tax_mapping_id;

      SELECT COUNT(*)::integer
        INTO v_count
        FROM public.company_bank_accounts cba
       WHERE cba.id = v_payment.bank_account_id
         AND cba.company_id = p_company_id
         AND cba.is_active = TRUE;
      IF v_count <> 1 THEN
        RAISE EXCEPTION 'BLOCKED_CONFIG_%: bank account=% company=% matches=%',
          CASE WHEN v_count = 0 THEN 'MISSING' ELSE 'AMBIGUOUS' END,
          v_payment.bank_account_id, p_company_id, v_count;
      END IF;
      SELECT cba.id INTO v_bank_id
        FROM public.company_bank_accounts cba
       WHERE cba.id = v_payment.bank_account_id
         AND cba.company_id = p_company_id
         AND cba.is_active = TRUE;
      SELECT cba.* INTO v_bank FROM public.company_bank_accounts cba WHERE cba.id = v_bank_id;

      IF NOT EXISTS (
        SELECT 1 FROM public.tax_rules tr
         WHERE tr.id = v_tax.tax_rule_id
           AND tr.company_id = p_company_id
           AND tr.is_active = TRUE
           AND (tr.effective_from IS NULL OR tr.effective_from <= p_effective_date)
           AND (tr.effective_to IS NULL OR p_effective_date < tr.effective_to)
      ) THEN
        RAISE EXCEPTION 'BLOCKED_CONFIG_TAX_INVALID: tax_rule=%', v_tax.tax_rule_id;
      END IF;

      config_id := v_config.id;
      config_version := v_config.config_version;
      payment_config_id := v_payment.id;
      tax_mapping_id := v_tax.id;
      effective_configuration_identity :=
        p_project_code || ':' || v_config.id::text || ':' ||
        v_payment.id::text || ':' || v_tax.id::text || ':' ||
        v_config.config_version::text || ':' || v_payment.config_version::text;
      SELECT tr.id, tr.tax_rate, tr.direction INTO tax_rule_id, tax_rate, tax_direction
        FROM public.tax_rules tr WHERE tr.id = v_tax.tax_rule_id;
      bank_account_id := v_bank.id;
      bank_account_number := v_bank.account_number;
      bank_name := v_bank.bank_name;
      currency_code := v_payment.currency_code;
      settlement_delay_business_days := v_payment.settlement_delay_business_days;
      mdr_rate := v_payment.mdr_rate;
      fixed_provider_fee := v_payment.fixed_provider_fee;
      fee_tax_rate := v_payment.fee_tax_rate;
      fee_tax_inclusive := v_payment.fee_tax_inclusive;

      FOREACH v_role IN ARRAY ARRAY['RECEIVING_BANK','REVENUE','TAX_OUTPUT','MDR_EXPENSE','CLEARING']
      LOOP
        SELECT COUNT(*)::integer AS count
          INTO v_count
          FROM public.finance_project_coa_mappings cm
         WHERE cm.finance_project_config_id = v_config.id
           AND cm.account_role = v_role
           AND (cm.payment_method IS NULL OR upper(btrim(cm.payment_method)) = upper(btrim(p_payment_method)))
           AND (cm.provider_code IS NULL OR lower(btrim(cm.provider_code)) = lower(btrim(p_provider_code)))
           AND cm.is_active = TRUE
           AND cm.effective_from <= p_effective_date
           AND (cm.effective_to IS NULL OR p_effective_date < cm.effective_to)
           AND NOT EXISTS (
             SELECT 1 FROM public.finance_project_coa_mappings specific
              WHERE specific.finance_project_config_id = cm.finance_project_config_id
                AND specific.account_role = cm.account_role
                AND specific.is_active = TRUE
                AND specific.effective_from <= p_effective_date
                AND (specific.effective_to IS NULL OR p_effective_date < specific.effective_to)
                AND (specific.payment_method IS NULL OR upper(btrim(specific.payment_method)) = upper(btrim(p_payment_method)))
                AND (specific.provider_code IS NULL OR lower(btrim(specific.provider_code)) = lower(btrim(p_provider_code)))
                AND (
                  (specific.payment_method IS NOT NULL)::integer
                  + (specific.provider_code IS NOT NULL)::integer
                ) > (cm.payment_method IS NOT NULL)::integer + (cm.provider_code IS NOT NULL)::integer
           );
        IF v_role = 'CLEARING' AND v_count = 0 THEN CONTINUE; END IF;
        IF v_count <> 1 THEN
          RAISE EXCEPTION 'BLOCKED_CONFIG_%: COA role=% matches=%',
            CASE WHEN v_count = 0 THEN 'MISSING' ELSE 'AMBIGUOUS' END, v_role, v_count;
        END IF;
        SELECT ca.id, ca.code, ca.name
          INTO v_map
          FROM public.finance_project_coa_mappings cm
          JOIN public.chart_of_accounts ca ON ca.id = cm.coa_id
         WHERE cm.finance_project_config_id = v_config.id
           AND cm.account_role = v_role
           AND (cm.payment_method IS NULL OR upper(btrim(cm.payment_method)) = upper(btrim(p_payment_method)))
           AND (cm.provider_code IS NULL OR lower(btrim(cm.provider_code)) = lower(btrim(p_provider_code)))
           AND cm.is_active = TRUE
           AND ca.company_id = p_company_id
           AND ca.is_active = TRUE
           AND cm.effective_from <= p_effective_date
           AND (cm.effective_to IS NULL OR p_effective_date < cm.effective_to)
         ORDER BY ((cm.payment_method IS NOT NULL)::integer + (cm.provider_code IS NOT NULL)::integer) DESC
         LIMIT 1;
        IF v_role = 'RECEIVING_BANK' THEN receiving_bank_coa_id := v_map.id; receiving_bank_coa_code := v_map.code; receiving_bank_coa_name := v_map.name;
        ELSIF v_role = 'REVENUE' THEN revenue_coa_id := v_map.id; revenue_coa_code := v_map.code; revenue_coa_name := v_map.name;
        ELSIF v_role = 'TAX_OUTPUT' THEN tax_output_coa_id := v_map.id; tax_output_coa_code := v_map.code; tax_output_coa_name := v_map.name;
        ELSIF v_role = 'MDR_EXPENSE' THEN mdr_expense_coa_id := v_map.id; mdr_expense_coa_code := v_map.code; mdr_expense_coa_name := v_map.name;
        ELSE clearing_coa_id := v_map.id; clearing_coa_code := v_map.code; clearing_coa_name := v_map.name;
        END IF;
      END LOOP;
      RETURN NEXT;
    END;
    $function$;
  `));

  await db.execute(sql.raw(`
    CREATE OR REPLACE FUNCTION sport_center.resolve_internal_bank_account_id(
      p_company_id integer,
      p_external_bank_account_id text
    )
    RETURNS integer
    LANGUAGE plpgsql
    SECURITY DEFINER
    SET search_path TO 'pg_catalog', 'sport_center', 'public'
    AS $function$
    DECLARE
      v_external_bank_account_id text;
      v_bank_account_count integer;
      v_internal_bank_account_id integer;
    BEGIN
      v_external_bank_account_id :=
        NULLIF(BTRIM(p_external_bank_account_id::text), '');

      IF v_external_bank_account_id IS NULL THEN
        RAISE EXCEPTION
          'CANONICAL_BANK_ACCOUNT_UNRESOLVED: company=% has no external bank account',
          p_company_id
          USING ERRCODE = 'P0001';
      END IF;

      SELECT COUNT(*)::integer, MIN(cba.id)
        INTO v_bank_account_count, v_internal_bank_account_id
        FROM public.company_bank_accounts cba
       WHERE cba.company_id = p_company_id
         AND cba.account_number::text = v_external_bank_account_id
         AND cba.is_active = TRUE;

      IF v_bank_account_count <> 1 OR v_internal_bank_account_id IS NULL THEN
        RAISE EXCEPTION
          'CANONICAL_BANK_ACCOUNT_UNRESOLVED: company=% account=% matches=%',
          p_company_id, v_external_bank_account_id, v_bank_account_count
          USING ERRCODE = 'P0001';
      END IF;

      RETURN v_internal_bank_account_id;
    END;
    $function$;
  `));

  await db.execute(sql.raw(`
    CREATE OR REPLACE FUNCTION sport_center.create_payment_accounting_draft(p_payment_id integer)
    RETURNS integer
    LANGUAGE plpgsql
    SECURITY DEFINER
    SET search_path TO 'pg_catalog', 'sport_center', 'public'
    AS $function$
    DECLARE
        v_payment sport_center.sport_payments%ROWTYPE;

        v_booking_id integer;
        v_order_number text;
        v_booking_ppn_rate numeric;
        v_booking_company_id integer;

        v_company_id integer;
        v_shared record;
        v_finance_mode text;

        v_gross numeric(18,2);
        v_dpp numeric(18,2);
        v_tax numeric(18,2);

        v_existing_journal_id integer;
        v_journal_id integer;

        v_existing_accounting_payment_id integer;
        v_existing_accounting_entry_id integer;
        v_existing_payment_status text;
        v_existing_entry_status text;
        v_existing_payment_amount numeric;
        v_existing_entry_total_debit numeric;
        v_existing_entry_total_credit numeric;
        v_existing_entry_source_payment_id integer;
        v_existing_entry_source text;
        v_existing_entry_source_id integer;

        v_debit_account_code text;
        v_debit_account_name text;
        v_revenue_account_code text := 'REVENUE';
        v_revenue_account_name text := 'Pendapatan Sport Center';
        v_tax_account_code text := 'PPN_OUTPUT';
        v_tax_account_name text := 'PPN Keluaran';

        v_payment_method text;
        v_payment_provider text;
        v_payment_type text;
        v_selected_bank_account_id integer;

        v_journal_date text;
        v_legacy_public_entry_id integer;
    BEGIN
        v_legacy_public_entry_id :=
            NULLIF(
                current_setting('sport_center.legacy_recovery_entry_id', true),
                ''
            )::integer;

        -- --------------------------------------------------------
        -- Serialize per payment to avoid concurrent duplicates.
        -- --------------------------------------------------------

        PERFORM pg_advisory_xact_lock(
            731025,
            p_payment_id
        );


        -- --------------------------------------------------------
        -- Load payment.
        -- --------------------------------------------------------

        SELECT *
          INTO v_payment
          FROM sport_center.sport_payments
         WHERE id = p_payment_id
         FOR UPDATE;


        IF NOT FOUND THEN
            RAISE EXCEPTION
                'SPORT_PAYMENT_NOT_FOUND: %',
                p_payment_id;
        END IF;


        -- --------------------------------------------------------
        -- Only confirmed payment may create accounting draft.
        -- --------------------------------------------------------

        IF v_payment.status::text <> 'confirmed' THEN
            RAISE EXCEPTION
                'SPORT_PAYMENT_NOT_CONFIRMED: payment=% status=%',
                p_payment_id,
                v_payment.status;
        END IF;

        -- --------------------------------------------------------
        -- Canonical journal idempotency.
        -- Existing canonical journal wins before inspecting the
        -- public projection, including recovery retries.
        -- --------------------------------------------------------

        SELECT id
          INTO v_existing_journal_id
          FROM sport_center.accounting_journals
         WHERE payment_id::text = p_payment_id::text
           AND journal_type = 'payment_confirmed'
           AND is_reversal = false
         ORDER BY id
         LIMIT 1;

        IF v_existing_journal_id IS NOT NULL THEN
            RETURN v_existing_journal_id;
        END IF;

        -- --------------------------------------------------------
        -- Canonical accounting idempotency.
        --
        -- A public accounting payment may already own this source
        -- payment even when the Sport Center journal was never created
        -- (or was created by an older retry). Resolve that posting
        -- before any Sport Center journal/header/line INSERT.
        --
        -- FULL JOIN is intentional: legacy/adopted entries can carry
        -- source_payment_id without an accounting_payments row, while
        -- normal postings are reached through accounting_payments.entry_id.
        -- --------------------------------------------------------

        SELECT
            ap.id,
            ae.id,
            ap.status::text,
            ae.status::text,
            ap.amount,
            ae.total_debit,
            ae.total_credit,
            ae.source_payment_id,
            ae.source::text,
            ae.source_id
          INTO
            v_existing_accounting_payment_id,
            v_existing_accounting_entry_id,
            v_existing_payment_status,
            v_existing_entry_status,
            v_existing_payment_amount,
            v_existing_entry_total_debit,
            v_existing_entry_total_credit,
            v_existing_entry_source_payment_id,
            v_existing_entry_source,
            v_existing_entry_source_id
          FROM public.accounting_payments ap
          FULL JOIN public.accounting_entries ae
            ON ae.id = ap.entry_id
         WHERE (
             ap.source_type = 'sport_center'
             AND ap.source_doc_id = p_payment_id
           )
           OR ae.source_payment_id = p_payment_id
           OR (
             ae.source::text = 'sport_center_payment'
             AND ae.source_id = p_payment_id
           )
         ORDER BY COALESCE(ap.id, ae.id)
         LIMIT 1;

        IF v_existing_accounting_payment_id IS NOT NULL
           OR v_existing_accounting_entry_id IS NOT NULL
        THEN
            IF v_legacy_public_entry_id IS NOT NULL
               AND v_existing_accounting_payment_id IS NULL
               AND v_existing_accounting_entry_id = v_legacy_public_entry_id
            THEN
                -- A separately validated recovery call may complete the
                -- canonical owner from an exact, posted legacy public entry.
                -- Keep all ordinary callers fail-closed.
                IF v_existing_entry_status <> 'posted'
                   OR ABS(COALESCE(v_existing_entry_total_debit, -1) - ROUND(v_payment.amount::numeric, 2)) > 0.01
                   OR ABS(COALESCE(v_existing_entry_total_credit, -1) - ROUND(v_payment.amount::numeric, 2)) > 0.01
                   OR (
                     COALESCE(v_existing_entry_source_payment_id, -1) <> p_payment_id
                     AND NOT (
                       v_existing_entry_source = 'sport_center_payment'
                       AND v_existing_entry_source_id = p_payment_id
                     )
                   )
                THEN
                    RAISE EXCEPTION
                        'ACCOUNTING_IDEMPOTENCY_MISMATCH: payment=% accounting_payment=% accounting_entry=%',
                        p_payment_id,
                        COALESCE(v_existing_accounting_payment_id, 0),
                        COALESCE(v_existing_accounting_entry_id, 0);
                END IF;
            ELSE
                IF v_existing_accounting_payment_id IS NULL
                   OR v_existing_accounting_entry_id IS NULL
                   OR v_existing_payment_status <> 'posted'
                   OR v_existing_entry_status <> 'posted'
                   OR ABS(COALESCE(v_existing_payment_amount, -1) - ROUND(v_payment.amount::numeric, 2)) > 0.01
                   OR ABS(COALESCE(v_existing_entry_total_debit, -1) - ROUND(v_payment.amount::numeric, 2)) > 0.01
                   OR ABS(COALESCE(v_existing_entry_total_credit, -1) - ROUND(v_payment.amount::numeric, 2)) > 0.01
                   OR (
                     COALESCE(v_existing_entry_source_payment_id, -1) <> p_payment_id
                     AND NOT (
                       v_existing_entry_source = 'sport_center_payment'
                       AND v_existing_entry_source_id = p_payment_id
                     )
                   )
                THEN
                    RAISE EXCEPTION
                        'ACCOUNTING_IDEMPOTENCY_MISMATCH: payment=% accounting_payment=% accounting_entry=%',
                        p_payment_id,
                        COALESCE(v_existing_accounting_payment_id, 0),
                        COALESCE(v_existing_accounting_entry_id, 0);
                END IF;

                -- The public posting is authoritative. Returning NULL tells
                -- callers there is no Sport Center journal to create; most
                -- importantly, this branch performs zero Sport Center writes.
                RETURN NULL;
            END IF;
        END IF;

        -- --------------------------------------------------------
        -- Booking snapshot.
        -- --------------------------------------------------------

        SELECT
            b.id,
            b.order_number,
            COALESCE(b.ppn_rate, 0),
            v_payment.company_id
          INTO
            v_booking_id,
            v_order_number,
            v_booking_ppn_rate,
            v_booking_company_id
          FROM sport_center.sport_bookings b
         WHERE b.id = v_payment.booking_id;


        IF v_booking_id IS NULL THEN
            RAISE EXCEPTION
                'SPORT_BOOKING_NOT_FOUND_FOR_PAYMENT: payment=% booking=%',
                p_payment_id,
                v_payment.booking_id;
        END IF;


        -- --------------------------------------------------------
        -- Required payment amount.
        -- --------------------------------------------------------

        v_gross := ROUND(v_payment.amount::numeric, 2);


        IF v_gross IS NULL OR v_gross <= 0 THEN
            RAISE EXCEPTION
                'INVALID_PAYMENT_AMOUNT: payment=% amount=%',
                p_payment_id,
                v_payment.amount;
        END IF;

        -- The payment is the authoritative owner context for the legacy
        -- accounting path. Resolve it before either finance-mode branch so
        -- canonical bank lookup can never receive an unassigned company.
        v_company_id :=
            COALESCE(
                v_payment.company_id,
                v_booking_company_id
            );

        IF v_company_id IS NULL THEN
            RAISE EXCEPTION
                'SPORT_PAYMENT_COMPANY_NOT_FOUND: payment=%',
                p_payment_id;
        END IF;

        v_finance_mode := lower(COALESCE(current_setting('sport_center.finance_mode', true), 'legacy'));
        IF v_finance_mode = 'central' THEN
            SELECT *
              INTO v_shared
              FROM sport_center.resolve_shared_finance_config(
                'sport_center',
                COALESCE(v_payment.company_id, v_booking_company_id),
                v_payment.payment_method::text,
                v_payment.payment_provider::text,
                COALESCE(v_payment.paid_at, v_payment.confirmed_at, v_payment.created_at, now())::date
              );
            v_booking_ppn_rate := v_shared.tax_rate;
            v_revenue_account_code := v_shared.revenue_coa_code;
            v_revenue_account_name := v_shared.revenue_coa_name;
            v_tax_account_code := v_shared.tax_output_coa_code;
            v_tax_account_name := v_shared.tax_output_coa_name;
            v_selected_bank_account_id := v_shared.bank_account_id;
        ELSE
            v_selected_bank_account_id :=
                sport_center.resolve_internal_bank_account_id(
                    v_company_id,
                    v_payment.bank_account_id::text
                );
        END IF;


        -- --------------------------------------------------------
        -- Tax inclusive calculation.
        -- --------------------------------------------------------

        IF COALESCE(v_booking_ppn_rate, 0) > 0 THEN

            v_dpp := ROUND(
                v_gross /
                (1 + (v_booking_ppn_rate / 100)),
                2
            );

            v_tax := v_gross - v_dpp;

        ELSE

            v_dpp := v_gross;
            v_tax := 0;

        END IF;

        IF v_finance_mode = 'central' THEN
            v_debit_account_code := v_shared.receiving_bank_coa_code;
            v_debit_account_name := v_shared.receiving_bank_coa_name;
        END IF;


        -- --------------------------------------------------------
        -- Snapshot payment metadata.
        -- --------------------------------------------------------

        v_payment_method :=
            COALESCE(
                NULLIF(v_payment.payment_method, ''),
                'Unknown'
            );

        v_payment_provider :=
            NULLIF(v_payment.payment_provider::text, '');

        v_payment_type :=
            COALESCE(
                NULLIF(v_payment.payment_type::text, ''),
                'full_payment'
            );


        -- --------------------------------------------------------
        -- IMPORTANT ACCOUNTING RULE
        --
        -- Payment provider / QRIS is NOT bank settlement yet.
        -- Use Payment Clearing first.
        --
        -- Direct cash / bank-transfer can use cash/bank account.
        -- --------------------------------------------------------

        IF lower(v_payment_method) LIKE '%qris%'
           OR v_payment_provider IS NOT NULL
        THEN

            v_debit_account_code :=
                'PAYMENT_CLEARING';

            v_debit_account_name :=
                'Payment Clearing';

        ELSIF lower(v_payment_method) LIKE '%cash%'
           OR lower(v_payment_method) LIKE '%tunai%'
        THEN

            v_debit_account_code :=
                'CASH';

            v_debit_account_name :=
                'Kas';

        ELSE

            v_debit_account_code :=
                'BANK_RECEIPT';

            v_debit_account_name :=
                'Bank / Kas Masuk';

        END IF;


        -- --------------------------------------------------------
        -- Journal date.
        -- Prefer the payment date; confirmation/creation are legacy fallbacks.
        -- --------------------------------------------------------

        v_journal_date :=
            COALESCE(
                v_payment.paid_at,
                v_payment.confirmed_at,
                v_payment.created_at,
                now()
            )::date::text;


        -- --------------------------------------------------------
        -- Create accounting journal header.
        -- --------------------------------------------------------

        INSERT INTO sport_center.accounting_journals
        (
            booking_id,
            payment_id,
            company_id,

            order_number,

            journal_type,
            status,

            debit_account,
            debit_amount,

            credit_revenue_account,
            credit_revenue_amount,

            credit_ppn_account,
            credit_ppn_amount,

            journal_date,

            payment_method,
            payment_provider,
            payment_type,
            bank_account_id,

            gross_amount,
            dpp_amount,
            tax_amount,

            provider_reference,
            provider_order_id,
            merchant_trade_no,
            provider_trade_no,

            source_schema,
            source_table,
            source_id,
            correlation_id,

            is_reversal,
            notes,

            created_by
        )
        VALUES
        (
            v_booking_id,
            p_payment_id,
            v_company_id,

            COALESCE(
                v_order_number,
                'SC-PAY-' || p_payment_id::text
            ),

            'payment_confirmed',
            'draft',

            v_debit_account_name,
            v_gross,

            v_revenue_account_name,
            v_dpp,

            v_tax_account_name,
            v_tax,

            v_journal_date,

            v_payment_method,
            v_payment_provider,
            v_payment_type,
            v_selected_bank_account_id,

            v_gross,
            v_dpp,
            v_tax,

            v_payment.provider_reference,
            v_payment.provider_order_id,
            v_payment.merchant_trade_no,
            v_payment.provider_trade_no,

            'sport_center',
            'sport_payments',
            p_payment_id::text,
            gen_random_uuid()::text,

            false,
            'Auto-draft dari konfirmasi pembayaran '
                || COALESCE(
                    v_order_number,
                    p_payment_id::text
                ),

            'system'
        )
        RETURNING id INTO v_journal_id;


        -- --------------------------------------------------------
        -- Debit line.
        -- --------------------------------------------------------

        INSERT INTO sport_center.accounting_journal_lines
        (
            journal_id,
            line_type,
            account_code,
            account_name,
            amount,
            description
        )
        VALUES
        (
            v_journal_id,
            'debit',
            v_debit_account_code,
            v_debit_account_name,
            v_gross,
            v_debit_account_name || ' - '
                || COALESCE(
                    v_order_number,
                    p_payment_id::text
                )
        );


        -- --------------------------------------------------------
        -- Revenue credit line.
        -- --------------------------------------------------------

        INSERT INTO sport_center.accounting_journal_lines
        (
            journal_id,
            line_type,
            account_code,
            account_name,
            amount,
            description
        )
        VALUES
        (
            v_journal_id,
            'credit',
            v_revenue_account_code,
            v_revenue_account_name,
            v_dpp,
            'Pendapatan - '
                || COALESCE(
                    v_order_number,
                    p_payment_id::text
                )
        );


        -- --------------------------------------------------------
        -- PPN credit line.
        --
        -- Only create when tax > 0.
        -- --------------------------------------------------------

        IF v_tax > 0 THEN

            INSERT INTO sport_center.accounting_journal_lines
            (
                journal_id,
                line_type,
                account_code,
                account_name,
                amount,
                description
            )
            VALUES
            (
                v_journal_id,
                'credit',
            v_tax_account_code,
            v_tax_account_name,
                v_tax,
                v_tax_account_name || ' - '
                    || COALESCE(
                        v_order_number,
                        p_payment_id::text
                    )
            );

        END IF;


        -- --------------------------------------------------------
        -- Validate immediately.
        --
        -- Journal remains DRAFT after successful validation.
        -- --------------------------------------------------------

        PERFORM
            sport_center.validate_accounting_journal(
                v_journal_id
            );


        RETURN v_journal_id;

    END;
    $function$
  `));

  await db.execute(sql.raw(`
    CREATE OR REPLACE FUNCTION sport_center.recover_payment_accounting_draft(
      p_payment_id integer,
      p_public_entry_id integer
    )
    RETURNS integer
    LANGUAGE plpgsql
    SECURITY DEFINER
    SET search_path TO 'pg_catalog', 'sport_center', 'public'
    AS $function$
    DECLARE
      v_payment sport_center.sport_payments%ROWTYPE;
      v_entry record;
      v_mirror record;
      v_match_count integer;
      v_payment_amount numeric;
      v_ppn_rate numeric;
      v_expected_dpp numeric;
      v_expected_tax numeric;
      v_line_count integer;
      v_debit_count integer;
      v_credit_count integer;
      v_debit_total numeric;
      v_credit_total numeric;
    BEGIN
      IF p_payment_id IS NULL OR p_payment_id <= 0
         OR p_public_entry_id IS NULL OR p_public_entry_id <= 0
      THEN
        RAISE EXCEPTION 'LEGACY_PUBLIC_RECOVERY_INVALID_INPUT';
      END IF;

      SELECT *
        INTO v_payment
        FROM sport_center.sport_payments
       WHERE id = p_payment_id
       FOR UPDATE;

      IF NOT FOUND OR v_payment.status::text <> 'confirmed' THEN
        RAISE EXCEPTION
          'LEGACY_PUBLIC_RECOVERY_PAYMENT_NOT_CONFIRMED: payment=%',
          p_payment_id;
      END IF;

      SELECT
        ae.id,
        ae.company_id,
        ae.status::text AS status,
        ae.source::text AS source,
        ae.source_id,
        ae.source_payment_id,
        ae.total_debit,
        ae.total_credit
        INTO v_entry
        FROM public.accounting_entries ae
       WHERE ae.id = p_public_entry_id
       FOR UPDATE;

      IF NOT FOUND THEN
        RAISE EXCEPTION
          'LEGACY_PUBLIC_RECOVERY_ENTRY_NOT_FOUND: payment=% entry=%',
          p_payment_id, p_public_entry_id;
      END IF;

      SELECT COUNT(DISTINCT ae.id)::integer
        INTO v_match_count
        FROM public.accounting_entries ae
       WHERE ae.source_payment_id = p_payment_id
          OR (
            ae.source::text = 'sport_center_payment'
            AND ae.source_id = p_payment_id
          );

      IF v_match_count <> 1 THEN
        RAISE EXCEPTION
          'LEGACY_PUBLIC_RECOVERY_ENTRY_AMBIGUOUS: payment=% matches=%',
          p_payment_id, v_match_count;
      END IF;

      IF v_entry.status <> 'posted'
         OR (
           COALESCE(v_entry.source_payment_id, -1) <> p_payment_id
           AND NOT (
             v_entry.source = 'sport_center_payment'
             AND v_entry.source_id = p_payment_id
           )
         )
         OR ABS(COALESCE(v_entry.total_debit, -1) - ROUND(v_payment.amount::numeric, 2)) > 0.01
         OR ABS(COALESCE(v_entry.total_credit, -1) - ROUND(v_payment.amount::numeric, 2)) > 0.01
      THEN
        RAISE EXCEPTION
          'LEGACY_PUBLIC_RECOVERY_ENTRY_MISMATCH: payment=% entry=%',
          p_payment_id, p_public_entry_id;
      END IF;

      IF EXISTS (
        SELECT 1
          FROM public.accounting_payments ap
         WHERE ap.entry_id = p_public_entry_id
            OR (
              ap.source_type = 'sport_center'
              AND ap.source_doc_id = p_public_entry_id
            )
      ) THEN
        RAISE EXCEPTION
          'LEGACY_PUBLIC_RECOVERY_ENTRY_ALREADY_LINKED: payment=% entry=%',
          p_payment_id, p_public_entry_id;
      END IF;

      SELECT
        COUNT(*)::integer,
        COUNT(*) FILTER (WHERE ael.debit > 0)::integer,
        COUNT(*) FILTER (WHERE ael.credit > 0)::integer,
        ROUND(COALESCE(SUM(ael.debit), 0), 2),
        ROUND(COALESCE(SUM(ael.credit), 0), 2)
        INTO
          v_line_count,
          v_debit_count,
          v_credit_count,
          v_debit_total,
          v_credit_total
        FROM public.accounting_entry_lines ael
       WHERE ael.entry_id = p_public_entry_id;

      SELECT COALESCE(b.ppn_rate, 0)
        INTO v_ppn_rate
        FROM sport_center.sport_bookings b
       WHERE b.id = v_payment.booking_id;

      v_payment_amount := ROUND(v_payment.amount::numeric, 2);
      v_expected_dpp := CASE
        WHEN v_ppn_rate > 0
        THEN ROUND(v_payment_amount / (1 + (v_ppn_rate / 100)), 2)
        ELSE v_payment_amount
      END;
      v_expected_tax := v_payment_amount - v_expected_dpp;

      IF v_line_count <> (CASE WHEN v_expected_tax > 0 THEN 3 ELSE 2 END)
         OR v_debit_count <> 1
         OR v_credit_count <> (CASE WHEN v_expected_tax > 0 THEN 2 ELSE 1 END)
         OR ABS(v_debit_total - v_payment_amount) > 0.01
         OR ABS(v_credit_total - v_payment_amount) > 0.01
      THEN
        RAISE EXCEPTION
          'LEGACY_PUBLIC_RECOVERY_LINES_MISMATCH: payment=% entry=%',
          p_payment_id, p_public_entry_id;
      END IF;

      SELECT
        sp.id,
        sp.company_id,
        sp.amount,
        sp.posting_status,
        sp.source_payment_id
        INTO v_mirror
        FROM public.sport_payments sp
       WHERE sp.source_payment_id = p_payment_id
       FOR UPDATE;

      IF NOT FOUND
         OR v_mirror.posting_status <> 'posted'
         OR v_mirror.company_id IS DISTINCT FROM v_payment.company_id
         OR ABS(COALESCE(v_mirror.amount, -1) - v_payment_amount) > 0.01
      THEN
        RAISE EXCEPTION
          'LEGACY_PUBLIC_RECOVERY_MIRROR_MISMATCH: payment=%',
          p_payment_id;
      END IF;

      PERFORM set_config(
        'sport_center.legacy_recovery_entry_id',
        p_public_entry_id::text,
        true
      );
      RETURN sport_center.create_payment_accounting_draft(p_payment_id);
    END;
    $function$
  `));

  const duplicateGroups = await db.execute(sql`
    SELECT
      company_id,
      lower(provider_code) AS provider_code,
      bank_account_id,
      settlement_date,
      settlement_rule_version,
      COUNT(*)::int AS duplicate_count
    FROM sport_center.payment_settlement_batches
    WHERE status IN ('draft', 'calculated', 'posted', 'reconciled')
      AND settlement_rule_version IS NOT NULL
    GROUP BY
      company_id,
      lower(provider_code),
      bank_account_id,
      settlement_date,
      settlement_rule_version
    HAVING COUNT(*) > 1
  `);
  if (duplicateGroups.rows.length > 0) {
    throw new Error(
      "CANONICAL_SETTLEMENT_GROUP_DUPLICATES_EXIST: resolve duplicate active grouping keys before installing the unique backstop",
    );
  }

  await db.execute(sql`
    CREATE UNIQUE INDEX IF NOT EXISTS payment_settlement_batches_active_group_unique
      ON sport_center.payment_settlement_batches (
        company_id,
        lower(provider_code),
        bank_account_id,
        settlement_date,
        settlement_rule_version
      )
      WHERE status IN ('draft', 'calculated', 'posted', 'reconciled')
        AND settlement_rule_version IS NOT NULL
  `);

  await db.execute(sql.raw(`
    CREATE OR REPLACE FUNCTION sport_center.canonical_settlement_group_identity(
      p_company_id integer,
      p_provider_code text,
      p_bank_account_id text,
      p_settlement_date date,
      p_settlement_rule_version text
    )
    RETURNS TABLE (
      settlement_reference text,
      correlation_id text
    )
    LANGUAGE plpgsql
    IMMUTABLE
    SET search_path TO 'pg_catalog', 'sport_center'
    AS $function$
    DECLARE
      v_provider text;
      v_bank text;
      v_rule text;
      v_serialized text;
      v_digest text;
    BEGIN
      IF p_company_id IS NULL
         OR p_provider_code IS NULL
         OR btrim(p_provider_code) = ''
         OR p_bank_account_id IS NULL
         OR btrim(p_bank_account_id) = ''
         OR p_settlement_date IS NULL
         OR p_settlement_rule_version IS NULL
         OR btrim(p_settlement_rule_version) = ''
      THEN
        RAISE EXCEPTION 'CANONICAL_SETTLEMENT_GROUP_INVALID';
      END IF;

      v_provider := lower(btrim(p_provider_code));
      v_bank := btrim(p_bank_account_id);
      v_rule := btrim(p_settlement_rule_version);

      v_serialized :=
          'scb-v1|'
          || p_company_id::text
          || '|'
          || octet_length(v_provider)::text || ':' || v_provider
          || '|'
          || octet_length(v_bank)::text || ':' || v_bank
          || '|'
          || to_char(p_settlement_date, 'YYYY-MM-DD')
          || '|'
          || octet_length(v_rule)::text || ':' || v_rule;

      v_digest := encode(
        extensions.digest(convert_to(v_serialized, 'UTF8'), 'sha256'),
        'hex'
      );

      settlement_reference := 'SCB1-' || v_digest;
      correlation_id := 'scb:v1:' || v_digest;
      RETURN NEXT;
    END;
    $function$;
  `));

  await db.execute(sql.raw(`
    CREATE OR REPLACE FUNCTION sport_center.mark_settlement_payments_settled(
      p_settlement_id bigint,
      p_actor text DEFAULT 'canonical-settlement-owner'
    )
    RETURNS integer
    LANGUAGE plpgsql
    SECURITY DEFINER
    SET search_path TO 'pg_catalog', 'sport_center'
    AS $function$
    DECLARE
      v_batch sport_center.payment_settlement_batches%ROWTYPE;
      v_journal sport_center.accounting_journals%ROWTYPE;
      v_payment record;
      v_item_count integer;
      v_processed integer := 0;
      v_updated integer;
    BEGIN
      SELECT *
        INTO v_batch
        FROM sport_center.payment_settlement_batches
       WHERE id = p_settlement_id
       FOR UPDATE;

      IF NOT FOUND THEN
        RAISE EXCEPTION 'SETTLEMENT_NOT_FOUND: %', p_settlement_id;
      END IF;

      IF v_batch.status NOT IN ('posted', 'reconciled') THEN
        RAISE EXCEPTION
          'SETTLEMENT_NOT_POSTED_FOR_PAYMENT_STATE: settlement=% status=%',
          p_settlement_id,
          v_batch.status;
      END IF;

      IF v_batch.settlement_journal_id IS NULL THEN
        RAISE EXCEPTION 'SETTLEMENT_JOURNAL_REQUIRED: %', p_settlement_id;
      END IF;

      SELECT *
        INTO v_journal
        FROM sport_center.accounting_journals
       WHERE id = v_batch.settlement_journal_id
       FOR UPDATE;

      IF NOT FOUND OR v_journal.status <> 'posted' THEN
        RAISE EXCEPTION
          'SETTLEMENT_JOURNAL_NOT_POSTED: settlement=% journal=%',
          p_settlement_id,
          v_batch.settlement_journal_id;
      END IF;

      SELECT COUNT(*)::int
        INTO v_item_count
        FROM sport_center.payment_settlement_items
       WHERE settlement_id = p_settlement_id
         AND item_status = 'active';

      IF v_item_count = 0 THEN
        RAISE EXCEPTION 'SETTLEMENT_ACTIVE_ITEMS_REQUIRED: %', p_settlement_id;
      END IF;

      /*
       * This ordered FOR UPDATE is the sole canonical payment-state owner.
       * A retry is idempotent only when the payment is already settled through
       * an active item belonging to this same batch.
       */
      FOR v_payment IN
        SELECT
          p.id,
          p.status::text AS payment_status,
          p.settlement_status
        FROM sport_center.payment_settlement_items i
        JOIN sport_center.sport_payments p
          ON p.id = i.payment_id
        WHERE i.settlement_id = p_settlement_id
          AND i.item_status = 'active'
        ORDER BY p.id
        FOR UPDATE OF p
      LOOP
        IF v_payment.payment_status <> 'confirmed' THEN
          RAISE EXCEPTION
            'CANONICAL_PAYMENT_NOT_CONFIRMED: payment=% status=%',
            v_payment.id,
            v_payment.payment_status;
        END IF;

        IF v_payment.settlement_status = 'settled' THEN
          v_processed := v_processed + 1;
          CONTINUE;
        END IF;

        IF v_payment.settlement_status <> 'unsettled' THEN
          RAISE EXCEPTION
            'CANONICAL_PAYMENT_SETTLEMENT_STATE_CONFLICT: payment=% state=%',
            v_payment.id,
            v_payment.settlement_status;
        END IF;

        UPDATE sport_center.sport_payments
           SET settlement_status = 'settled',
               updated_at = now()
         WHERE id = v_payment.id
           AND settlement_status = 'unsettled';

        GET DIAGNOSTICS v_updated = ROW_COUNT;
        IF v_updated <> 1 THEN
          RAISE EXCEPTION
            'CANONICAL_PAYMENT_SETTLEMENT_STATE_RACE: payment=%',
            v_payment.id;
        END IF;

        v_processed := v_processed + 1;
      END LOOP;

      RETURN v_processed;
    END;
    $function$;
  `));

  /*
   * Any direct canonical batch transition to posted must use the same owner.
   * The finalizer wrapper below also invokes it for already-posted idempotent
   * retries, which repairs a valid historical batch whose payment state lagged.
   */
  await db.execute(sql.raw(`
    CREATE OR REPLACE FUNCTION sport_center.enforce_settlement_payment_state_after_post()
    RETURNS trigger
    LANGUAGE plpgsql
    SECURITY DEFINER
    SET search_path TO 'pg_catalog', 'sport_center'
    AS $function$
    BEGIN
      IF NEW.status = 'posted'
         AND OLD.status IS DISTINCT FROM NEW.status
      THEN
        PERFORM sport_center.mark_settlement_payments_settled(
          NEW.id,
          COALESCE(NEW.posted_by, 'canonical-settlement-owner')
        );
      END IF;
      RETURN NEW;
    END;
    $function$;
  `));

  await db.execute(sql.raw(`
    DROP TRIGGER IF EXISTS trg_settlement_payment_state_after_post
      ON sport_center.payment_settlement_batches;
    CREATE TRIGGER trg_settlement_payment_state_after_post
      AFTER UPDATE OF status ON sport_center.payment_settlement_batches
      FOR EACH ROW
      EXECUTE FUNCTION sport_center.enforce_settlement_payment_state_after_post();
  `));

  /*
   * Preserve the existing accounting implementation as the legacy owner and
   * expose a deterministic/idempotent boundary for new callers. The wrapper
   * locks the complete group before delegating to the proven calculation and
   * journal/item creation function.
   */
  await db.execute(sql.raw(`
    DO $migration$
    BEGIN
      IF to_regprocedure(
           'sport_center.create_payment_settlement_batch(text,integer,text,text,date,integer[],text)'
         ) IS NOT NULL
         AND to_regprocedure(
           'sport_center.create_payment_settlement_batch_legacy(text,integer,text,text,date,integer[],text)'
         ) IS NULL
      THEN
        ALTER FUNCTION sport_center.create_payment_settlement_batch(
          text, integer, text, text, date, integer[], text
        ) RENAME TO create_payment_settlement_batch_legacy;
      END IF;
    END;
    $migration$;
  `));

  await db.execute(sql.raw(`
    CREATE OR REPLACE FUNCTION sport_center.create_payment_settlement_batch(
      p_settlement_reference text,
      p_company_id integer,
      p_provider_code text,
      p_bank_account_id text,
      p_settlement_date date,
      p_payment_ids integer[],
      p_actor text DEFAULT 'manual-supabase'
    )
    RETURNS bigint
    LANGUAGE plpgsql
    SECURITY DEFINER
    SET search_path TO 'pg_catalog', 'sport_center'
    AS $function$
    DECLARE
      v_input_count integer;
      v_unique_count integer;
      v_confirmed_count integer;
      v_invalid_date_count integer;
      v_rule_min text;
      v_rule_max text;
      v_existing_batch_id bigint;
      v_reference text;
      v_correlation text;
      v_serialized text;
      v_identity record;
      v_result bigint;
      v_item_count integer;
    BEGIN
      IF p_payment_ids IS NULL OR cardinality(p_payment_ids) = 0 THEN
        RAISE EXCEPTION 'PAYMENT_IDS_REQUIRED';
      END IF;

      v_input_count := cardinality(p_payment_ids);
      SELECT COUNT(DISTINCT x.payment_id)
        INTO v_unique_count
        FROM unnest(p_payment_ids) x(payment_id);
      IF v_input_count <> v_unique_count THEN
        RAISE EXCEPTION 'DUPLICATE_PAYMENT_ID_IN_REQUEST';
      END IF;

      SELECT
        COUNT(*)::int,
        COUNT(*) FILTER (
          WHERE p.expected_settlement_date IS DISTINCT FROM p_settlement_date::text
        )::int,
        MIN(NULLIF(btrim(p.settlement_rule_version), '')),
        MAX(NULLIF(btrim(p.settlement_rule_version), ''))
        INTO
          v_confirmed_count,
          v_invalid_date_count,
          v_rule_min,
          v_rule_max
        FROM unnest(p_payment_ids) x(payment_id)
        JOIN sport_center.sport_payments p
          ON p.id = x.payment_id
       WHERE p.status::text = 'confirmed'
         AND p.company_id = p_company_id
         AND lower(p.payment_provider::text) = lower(btrim(p_provider_code))
         AND p.bank_account_id = btrim(p_bank_account_id);

      IF v_confirmed_count <> v_input_count
         OR v_invalid_date_count <> 0
         OR v_rule_min IS NULL
         OR v_rule_min IS DISTINCT FROM v_rule_max
      THEN
        RAISE EXCEPTION
          'CANONICAL_SETTLEMENT_GROUP_INVALID: expected_date/provider/bank/rule mismatch';
      END IF;

      SELECT settlement_reference, correlation_id
        INTO v_identity
        FROM sport_center.canonical_settlement_group_identity(
          p_company_id,
          p_provider_code,
          p_bank_account_id,
          p_settlement_date,
          v_rule_min
        );
      v_reference := v_identity.settlement_reference;
      v_correlation := v_identity.correlation_id;

      v_serialized :=
          p_company_id::text || '|'
          || lower(btrim(p_provider_code)) || '|'
          || btrim(p_bank_account_id) || '|'
          || p_settlement_date::text || '|'
          || v_rule_min;
      PERFORM pg_advisory_xact_lock(hashtext(v_serialized));

      SELECT id
        INTO v_existing_batch_id
        FROM sport_center.payment_settlement_batches
       WHERE company_id = p_company_id
         AND lower(provider_code) = lower(btrim(p_provider_code))
         AND bank_account_id = btrim(p_bank_account_id)
         AND settlement_date = p_settlement_date
         AND settlement_rule_version = v_rule_min
         AND status IN ('draft', 'calculated', 'posted', 'reconciled')
       FOR UPDATE;

      IF v_existing_batch_id IS NOT NULL THEN
        SELECT COUNT(*)::int
          INTO v_item_count
          FROM sport_center.payment_settlement_items
         WHERE settlement_id = v_existing_batch_id
           AND item_status = 'active';

        IF v_item_count <> v_input_count
           OR EXISTS (
             SELECT 1
             FROM unnest(p_payment_ids) x(payment_id)
             WHERE NOT EXISTS (
               SELECT 1
               FROM sport_center.payment_settlement_items i
               WHERE i.settlement_id = v_existing_batch_id
                 AND i.payment_id = x.payment_id
                 AND i.item_status = 'active'
             )
           )
        THEN
          RAISE EXCEPTION
            'CANONICAL_SETTLEMENT_IDEMPOTENCY_CONFLICT: batch=%',
            v_existing_batch_id;
        END IF;

        RETURN v_existing_batch_id;
      END IF;

      SELECT sport_center.create_payment_settlement_batch_legacy(
        v_reference,
        p_company_id,
        lower(btrim(p_provider_code)),
        btrim(p_bank_account_id),
        p_settlement_date,
        p_payment_ids,
        p_actor
      )
        INTO v_result;

      UPDATE sport_center.payment_settlement_batches
         SET settlement_reference = v_reference,
             correlation_id = v_correlation,
             settlement_rule_version = v_rule_min,
             updated_at = now()
       WHERE id = v_result
         AND status = 'calculated';

      RETURN v_result;
    END;
    $function$;
  `));

  /*
   * Late-arriving payments never extend a posted/reconciled batch.  This owner
   * creates a deterministic sibling identity for only the newly eligible
   * payment set.  The base group remains the same in business terms, while the
   * supplemental rule/correlation suffix gives the database's active-group
   * uniqueness backstop a distinct, auditable identity.
   */
  await db.execute(sql.raw(`
    CREATE OR REPLACE FUNCTION sport_center.create_payment_settlement_supplemental_batch(
      p_company_id integer,
      p_provider_code text,
      p_bank_account_id text,
      p_settlement_date date,
      p_base_rule_version text,
      p_payment_ids integer[],
      p_actor text DEFAULT 'manual-supabase'
    )
    RETURNS bigint
    LANGUAGE plpgsql
    SECURITY DEFINER
    SET search_path TO 'pg_catalog', 'sport_center'
    AS $function$
    DECLARE
      v_input_count integer;
      v_unique_count integer;
      v_confirmed_count integer;
      v_invalid_date_count integer;
      v_valid_count integer;
      v_rule_min text;
      v_config sport_center.payment_settlement_configs%ROWTYPE;
      v_gross numeric(18,2);
      v_effective_mdr_rate numeric;
      v_effective_fixed_fee numeric;
      v_mdr numeric(18,2);
      v_provider_fee numeric(18,2);
      v_fee_tax numeric(18,2);
      v_total_deduction numeric(18,2);
      v_net numeric(18,2);
      v_identity record;
      v_existing_batch_id bigint;
      v_sequence integer;
      v_reference text;
      v_correlation text;
      v_supplemental_rule text;
      v_result bigint;
    BEGIN
      IF p_payment_ids IS NULL OR cardinality(p_payment_ids) = 0 THEN
        RAISE EXCEPTION 'PAYMENT_IDS_REQUIRED';
      END IF;

      v_input_count := cardinality(p_payment_ids);
      SELECT COUNT(DISTINCT x.payment_id)
        INTO v_unique_count
        FROM unnest(p_payment_ids) x(payment_id);
      IF v_input_count <> v_unique_count THEN
        RAISE EXCEPTION 'DUPLICATE_PAYMENT_ID_IN_REQUEST';
      END IF;

      SELECT
        COUNT(*)::int,
        COUNT(*) FILTER (
          WHERE p.expected_settlement_date IS DISTINCT FROM p_settlement_date::text
        )::int,
        MIN(NULLIF(btrim(p.settlement_rule_version), ''))
        INTO v_confirmed_count, v_invalid_date_count, v_rule_min
        FROM unnest(p_payment_ids) x(payment_id)
        JOIN sport_center.sport_payments p
          ON p.id = x.payment_id
       WHERE p.status::text = 'confirmed'
         AND p.company_id = p_company_id
         AND lower(p.payment_provider::text) = lower(btrim(p_provider_code))
         AND p.bank_account_id = btrim(p_bank_account_id)
         AND p.settlement_rule_version = p_base_rule_version;

      IF v_confirmed_count <> v_input_count
         OR v_invalid_date_count <> 0
         OR v_rule_min IS DISTINCT FROM btrim(p_base_rule_version)
      THEN
        RAISE EXCEPTION
          'CANONICAL_SETTLEMENT_GROUP_INVALID: supplemental payment group mismatch';
      END IF;

      SELECT settlement_reference, correlation_id
        INTO v_identity
        FROM sport_center.canonical_settlement_group_identity(
          p_company_id,
          p_provider_code,
          p_bank_account_id,
          p_settlement_date,
          p_base_rule_version
        );

      PERFORM pg_advisory_xact_lock(hashtext(
        p_company_id::text || '|'
        || lower(btrim(p_provider_code)) || '|'
        || btrim(p_bank_account_id) || '|'
        || p_settlement_date::text || '|'
        || btrim(p_base_rule_version)
      ));

      /*
       * Exact active-item-set lookup is the idempotency boundary.  It runs
       * before sequence allocation so a retry never consumes a new sequence.
       */
      SELECT b.id
        INTO v_existing_batch_id
        FROM sport_center.payment_settlement_batches b
       WHERE b.company_id = p_company_id
         AND lower(b.provider_code) = lower(btrim(p_provider_code))
         AND b.bank_account_id = btrim(p_bank_account_id)
         AND b.settlement_date = p_settlement_date
         AND b.status IN ('draft', 'calculated', 'posted', 'reconciled')
         AND b.correlation_id LIKE v_identity.correlation_id || ':supp:%'
         AND (
           SELECT COUNT(*)::int
             FROM sport_center.payment_settlement_items i
            WHERE i.settlement_id = b.id
              AND i.item_status = 'active'
         ) = v_input_count
         AND NOT EXISTS (
           SELECT 1
             FROM sport_center.payment_settlement_items i
            WHERE i.settlement_id = b.id
              AND i.item_status = 'active'
              AND NOT (i.payment_id = ANY(p_payment_ids))
         )
         AND NOT EXISTS (
           SELECT 1
             FROM unnest(p_payment_ids) x(payment_id)
            WHERE NOT EXISTS (
              SELECT 1
                FROM sport_center.payment_settlement_items i
               WHERE i.settlement_id = b.id
                 AND i.payment_id = x.payment_id
                 AND i.item_status = 'active'
            )
         )
       ORDER BY b.id
       LIMIT 1
       FOR UPDATE;

      IF v_existing_batch_id IS NOT NULL THEN
        RETURN v_existing_batch_id;
      END IF;

      IF EXISTS (
        SELECT 1
          FROM sport_center.payment_settlement_items i
          JOIN sport_center.payment_settlement_batches b
            ON b.id = i.settlement_id
         WHERE i.payment_id = ANY(p_payment_ids)
           AND i.item_status = 'active'
      ) THEN
        RAISE EXCEPTION
          'CANONICAL_SETTLEMENT_ITEM_ALREADY_ACTIVE: supplemental payment is already active';
      END IF;

      SELECT COUNT(*)
        INTO v_valid_count
        FROM unnest(p_payment_ids) x(payment_id)
        JOIN sport_center.sport_payments p
          ON p.id = x.payment_id
        JOIN sport_center.accounting_journals j
          ON j.payment_id::text = p.id::text
         AND j.journal_type = 'payment_confirmed'
         AND j.is_reversal = false
         AND j.status = 'posted'
       WHERE p.status::text = 'confirmed'
         AND p.company_id = p_company_id
         AND lower(COALESCE(p.payment_provider::text, '')) =
             lower(p_provider_code)
         AND p.bank_account_id = p_bank_account_id
         AND NOT EXISTS (
           SELECT 1
             FROM sport_center.payment_settlement_items si
            WHERE si.payment_id = p.id
              AND si.item_status = 'active'
         );

      IF v_valid_count <> v_input_count THEN
        RAISE EXCEPTION
          'ONE_OR_MORE_PAYMENTS_NOT_ELIGIBLE: requested=% eligible=%',
          v_input_count,
          v_valid_count;
      END IF;

      SELECT ROUND(SUM(
        j.gross_amount + COALESCE((
          SELECT SUM(
            CASE WHEN c.is_reversal THEN -c.gross_amount ELSE c.gross_amount END
          )
          FROM sport_center.accounting_journals c
          WHERE c.payment_id = j.payment_id
            AND c.journal_type = 'payment_amount_correction'
            AND c.is_reversal = false
            AND c.status = 'posted'
            AND c.reversal_of_id = j.id
        ), 0)
      )::numeric, 2)
        INTO v_gross
        FROM unnest(p_payment_ids) x(payment_id)
        JOIN sport_center.accounting_journals j
          ON j.payment_id::text = x.payment_id::text
         AND j.journal_type = 'payment_confirmed'
         AND j.is_reversal = false
         AND j.status = 'posted';

      IF v_gross IS NULL OR v_gross <= 0 THEN
        RAISE EXCEPTION 'INVALID_SETTLEMENT_GROSS';
      END IF;

      SELECT *
        INTO v_config
        FROM sport_center.resolve_payment_settlement_config(
          p_company_id,
          p_provider_code,
          p_bank_account_id,
          p_settlement_date
        );

      CASE v_config.calculation_method
        WHEN 'percentage_of_gross' THEN
          v_effective_mdr_rate := v_config.mdr_rate;
          v_effective_fixed_fee := 0;
        WHEN 'fixed_fee' THEN
          v_effective_mdr_rate := 0;
          v_effective_fixed_fee := v_config.fixed_provider_fee;
        WHEN 'percentage_plus_fixed' THEN
          v_effective_mdr_rate := v_config.mdr_rate;
          v_effective_fixed_fee := v_config.fixed_provider_fee;
        ELSE
          RAISE EXCEPTION
            'UNSUPPORTED_SETTLEMENT_CALCULATION_METHOD: %',
            v_config.calculation_method;
      END CASE;

      SELECT
        c.base_mdr_amount,
        c.provider_fee_amount,
        c.fee_tax_amount,
        c.total_deduction,
        c.net_amount
        INTO
          v_mdr,
          v_provider_fee,
          v_fee_tax,
          v_total_deduction,
          v_net
        FROM sport_center.calculate_settlement_mdr(
          v_gross,
          v_effective_mdr_rate,
          v_effective_fixed_fee,
          v_config.fee_tax_rate,
          v_config.fee_tax_inclusive,
          v_config.rounding_scale,
          v_config.rounding_method
        ) c;

      SELECT COALESCE(MAX(
        CASE
          WHEN (regexp_match(
            b.correlation_id,
            v_identity.correlation_id || ':supp:([0-9]+)$'
          ))[1] IS NULL THEN 0
          ELSE ((regexp_match(
            b.correlation_id,
            v_identity.correlation_id || ':supp:([0-9]+)$'
          ))[1])::integer
        END
      ), 0) + 1
        INTO v_sequence
        FROM sport_center.payment_settlement_batches b
       WHERE b.company_id = p_company_id
         AND lower(b.provider_code) = lower(btrim(p_provider_code))
         AND b.bank_account_id = btrim(p_bank_account_id)
         AND b.settlement_date = p_settlement_date
         AND b.status IN ('draft', 'calculated', 'posted', 'reconciled')
         AND b.correlation_id LIKE v_identity.correlation_id || ':supp:%';

      v_reference := v_identity.settlement_reference
        || ':SUPPLEMENTAL-' || lpad(v_sequence::text, 2, '0');
      v_correlation := v_identity.correlation_id
        || ':supp:' || lpad(v_sequence::text, 2, '0');
      v_supplemental_rule := btrim(p_base_rule_version)
        || ':SUPPLEMENTAL-' || lpad(v_sequence::text, 2, '0');

      INSERT INTO sport_center.payment_settlement_batches
      (
        settlement_reference,
        company_id,
        provider_code,
        provider_name,
        bank_account_id,
        settlement_date,
        gross_amount,
        mdr_amount,
        provider_fee_amount,
        fee_tax_amount,
        tax_withheld_amount,
        adjustment_amount,
        net_amount,
        status,
        calculated_at,
        calculated_by,
        settlement_rule_version,
        source,
        correlation_id,
        created_by,
        notes
      )
      VALUES
      (
        v_reference,
        p_company_id,
        lower(p_provider_code),
        lower(p_provider_code),
        p_bank_account_id,
        p_settlement_date,
        v_gross,
        v_mdr,
        v_provider_fee,
        v_fee_tax,
        0,
        0,
        v_net,
        'calculated',
        now(),
        p_actor,
        v_supplemental_rule,
        'SPORT_CENTER',
        v_correlation,
        p_actor,
        'LATE_ARRIVAL_SUPPLEMENTAL base=' || v_identity.correlation_id
          || ' sequence=' || lpad(v_sequence::text, 2, '0')
      )
      RETURNING id INTO v_result;

      INSERT INTO sport_center.payment_settlement_items
      (
        settlement_id,
        payment_id,
        payment_journal_id,
        gross_amount,
        item_status,
        source_event_id,
        correlation_id,
        created_by
      )
      SELECT
        v_result,
        p.id,
        j.id,
        j.gross_amount + COALESCE((
          SELECT SUM(
            CASE WHEN c.is_reversal THEN -c.gross_amount ELSE c.gross_amount END
          )
          FROM sport_center.accounting_journals c
          WHERE c.payment_id = j.payment_id
            AND c.journal_type = 'payment_amount_correction'
            AND c.is_reversal = false
            AND c.status = 'posted'
            AND c.reversal_of_id = j.id
        ), 0),
        'active',
        j.source_event_id,
        'sc_settlement_item_' || v_result::text || '_payment_' || p.id::text,
        p_actor
      FROM unnest(p_payment_ids) x(payment_id)
      JOIN sport_center.sport_payments p
        ON p.id = x.payment_id
      JOIN sport_center.accounting_journals j
        ON j.payment_id::text = p.id::text
       AND j.journal_type = 'payment_confirmed'
       AND j.is_reversal = false
       AND j.status = 'posted';

      IF (
        SELECT COUNT(*)
          FROM sport_center.payment_settlement_items i
         WHERE i.settlement_id = v_result
           AND i.item_status = 'active'
      ) <> v_input_count
      THEN
        RAISE EXCEPTION 'SETTLEMENT_ITEM_COUNT_MISMATCH';
      END IF;

      IF (
        SELECT ROUND(SUM(i.gross_amount)::numeric, 2)
          FROM sport_center.payment_settlement_items i
         WHERE i.settlement_id = v_result
           AND i.item_status = 'active'
      ) <> v_gross
      THEN
        RAISE EXCEPTION 'SETTLEMENT_ITEM_GROSS_MISMATCH';
      END IF;

      RETURN v_result;
    END;
    $function$;
  `));

  await db.execute(sql.raw(`
    DO $migration$
    BEGIN
      IF to_regprocedure(
           'sport_center.finalize_payment_settlement(bigint,text)'
         ) IS NOT NULL
         AND to_regprocedure(
           'sport_center.finalize_payment_settlement_legacy(bigint,text)'
         ) IS NULL
      THEN
        ALTER FUNCTION sport_center.finalize_payment_settlement(
          bigint, text
        ) RENAME TO finalize_payment_settlement_legacy;
      END IF;
    END;
    $migration$;
  `));

  await db.execute(sql.raw(`
    CREATE OR REPLACE FUNCTION sport_center.finalize_payment_settlement(
      p_settlement_id bigint,
      p_actor text DEFAULT 'manual-supabase'
    )
    RETURNS bigint
    LANGUAGE plpgsql
    SECURITY DEFINER
    SET search_path TO 'pg_catalog', 'sport_center'
    AS $function$
    DECLARE
      v_result bigint;
    BEGIN
      v_result := sport_center.finalize_payment_settlement_legacy(
        p_settlement_id,
        p_actor
      );
      PERFORM sport_center.mark_settlement_payments_settled(
        p_settlement_id,
        p_actor
      );
      RETURN v_result;
    END;
    $function$;
  `));

  /*
   * The posted-settlement guard remains fail-closed for every ordinary UPDATE.
   * The owner recovery routine below needs one narrow, transaction-local
   * exception: posted -> reconciled, with only the bank-derived net,
   * adjustment, and bank link changing.  A custom transaction-local setting
   * is used as an explicit capability marker; the recovery routine sets it
   * immediately before its guarded UPDATE.
   */
  await db.execute(sql.raw(`
    CREATE OR REPLACE FUNCTION sport_center.guard_posted_settlement_batch()
    RETURNS trigger
    LANGUAGE plpgsql
    SET search_path TO 'pg_catalog', 'sport_center'
    AS $function$
    DECLARE
      v_owner_recovery boolean :=
        current_setting('sport_center.canonical_settlement_recovery', true)
          = 'owner-net-correction-v1';
    BEGIN
      IF TG_OP = 'DELETE' THEN
        IF OLD.status IN ('posted', 'reconciled', 'reversed') THEN
          RAISE EXCEPTION
            'POSTED_SETTLEMENT_CANNOT_BE_DELETED: %',
            OLD.id;
        END IF;
        RETURN OLD;
      END IF;

      IF OLD.status IN ('posted', 'reconciled', 'reversed') THEN
        IF v_owner_recovery THEN
          IF OLD.status <> 'posted'
             OR NEW.status <> 'reconciled'
             OR OLD.bank_mutation_id IS NOT NULL
             OR NEW.bank_mutation_id IS NULL
             OR NEW.net_amount IS NULL
             OR NEW.adjustment_amount IS NULL
             OR NEW.company_id IS DISTINCT FROM OLD.company_id
             OR NEW.provider_code IS DISTINCT FROM OLD.provider_code
             OR NEW.provider_name IS DISTINCT FROM OLD.provider_name
             OR NEW.bank_account_id IS DISTINCT FROM OLD.bank_account_id
             OR NEW.settlement_date IS DISTINCT FROM OLD.settlement_date
             OR NEW.settlement_reference IS DISTINCT FROM OLD.settlement_reference
             OR NEW.gross_amount IS DISTINCT FROM OLD.gross_amount
             OR NEW.mdr_amount IS DISTINCT FROM OLD.mdr_amount
             OR NEW.provider_fee_amount IS DISTINCT FROM OLD.provider_fee_amount
             OR NEW.fee_tax_amount IS DISTINCT FROM OLD.fee_tax_amount
             OR NEW.tax_withheld_amount IS DISTINCT FROM OLD.tax_withheld_amount
             OR NEW.settlement_journal_id IS DISTINCT FROM OLD.settlement_journal_id
             OR NEW.settlement_rule_version IS DISTINCT FROM OLD.settlement_rule_version
             OR NEW.provider_settlement_reference IS DISTINCT FROM OLD.provider_settlement_reference
             OR NEW.provider_batch_id IS DISTINCT FROM OLD.provider_batch_id
          THEN
            RAISE EXCEPTION
              'POSTED_SETTLEMENT_RECOVERY_UPDATE_NOT_ALLOWED: %',
              OLD.id;
          END IF;
        ELSIF NEW.company_id IS DISTINCT FROM OLD.company_id
           OR NEW.provider_code IS DISTINCT FROM OLD.provider_code
           OR NEW.provider_name IS DISTINCT FROM OLD.provider_name
           OR NEW.bank_account_id IS DISTINCT FROM OLD.bank_account_id
           OR NEW.settlement_date IS DISTINCT FROM OLD.settlement_date
           OR NEW.settlement_reference IS DISTINCT FROM OLD.settlement_reference
           OR NEW.gross_amount IS DISTINCT FROM OLD.gross_amount
           OR NEW.mdr_amount IS DISTINCT FROM OLD.mdr_amount
           OR NEW.provider_fee_amount IS DISTINCT FROM OLD.provider_fee_amount
           OR NEW.fee_tax_amount IS DISTINCT FROM OLD.fee_tax_amount
           OR NEW.tax_withheld_amount IS DISTINCT FROM OLD.tax_withheld_amount
           OR NEW.adjustment_amount IS DISTINCT FROM OLD.adjustment_amount
           OR NEW.net_amount IS DISTINCT FROM OLD.net_amount
           OR NEW.settlement_journal_id IS DISTINCT FROM OLD.settlement_journal_id
           OR NEW.settlement_rule_version IS DISTINCT FROM OLD.settlement_rule_version
           OR NEW.provider_settlement_reference IS DISTINCT FROM OLD.provider_settlement_reference
           OR NEW.provider_batch_id IS DISTINCT FROM OLD.provider_batch_id
        THEN
          RAISE EXCEPTION
            'POSTED_SETTLEMENT_FINANCIAL_DATA_IS_IMMUTABLE: %',
            OLD.id;
        END IF;
      END IF;

      IF OLD.status = 'posted'
         AND NEW.status NOT IN ('posted', 'reconciled', 'reversed')
      THEN
        RAISE EXCEPTION
          'INVALID_POSTED_SETTLEMENT_STATUS_TRANSITION: % -> %',
          OLD.status,
          NEW.status;
      END IF;

      IF OLD.status = 'reconciled'
         AND NEW.status NOT IN ('reconciled', 'reversed')
      THEN
        RAISE EXCEPTION
          'INVALID_RECONCILED_SETTLEMENT_STATUS_TRANSITION: % -> %',
          OLD.status,
          NEW.status;
      END IF;

      IF OLD.status = 'reversed' AND NEW.status <> 'reversed' THEN
        RAISE EXCEPTION 'REVERSED_SETTLEMENT_IS_FINAL: %', OLD.id;
      END IF;

      RETURN NEW;
    END;
    $function$;
  `));

  /*
   * Owner recovery for a posted settlement whose bank evidence has a
   * different net amount than the original calculation.
   *
   * This is intentionally one database-owned transaction.  It does not
   * create, reverse, or replace an accounting journal; it corrects only the
   * settlement metadata and reconciliation link after re-checking the
   * already-settled payment set and the actual bank evidence.
   */
  await db.execute(sql.raw(`
    CREATE OR REPLACE FUNCTION sport_center.recover_posted_settlement_from_bank_mutation(
      p_settlement_id bigint,
      p_public_mutation_id integer,
      p_actor text DEFAULT 'canonical-settlement-recovery'
    )
    RETURNS TABLE (
      settlement_id bigint,
      public_mutation_id integer,
      canonical_mutation_id integer,
      match_id integer,
      old_net_amount numeric,
      recovered_net_amount numeric,
      adjustment_amount numeric,
      settlement_status text,
      public_mutation_status text,
      canonical_mutation_status text,
      idempotent boolean
    )
    LANGUAGE plpgsql
    SECURITY DEFINER
    SET search_path TO 'pg_catalog', 'sport_center', 'public'
    AS $function$
    DECLARE
      v_public public.bank_mutations%ROWTYPE;
      v_batch sport_center.payment_settlement_batches%ROWTYPE;
      v_journal sport_center.accounting_journals%ROWTYPE;
      v_canonical sport_center.bank_mutations%ROWTYPE;
      v_config_count integer;
      v_internal_bank_account_id integer;
      v_active_item_count integer;
      v_other_settlement_count integer;
      v_active_match_count integer;
      v_match_id integer;
      v_existing_match record;
      v_old_net numeric;
      v_base_net numeric;
      v_recovered_net numeric;
      v_adjustment numeric;
      v_date_difference integer;
      v_idempotent boolean := false;
      v_mutation_key text;
      v_actor text;
    BEGIN
      IF p_settlement_id IS NULL OR p_settlement_id <= 0
         OR p_public_mutation_id IS NULL OR p_public_mutation_id <= 0
      THEN
        RAISE EXCEPTION 'CANONICAL_SETTLEMENT_RECOVERY_INVALID_ID';
      END IF;

      v_actor := NULLIF(BTRIM(p_actor), '');
      IF v_actor IS NULL THEN
        RAISE EXCEPTION 'CANONICAL_SETTLEMENT_RECOVERY_ACTOR_REQUIRED';
      END IF;

      PERFORM pg_advisory_xact_lock(
        hashtext(
          'canonical-settlement-recovery:'
          || p_settlement_id::text
          || ':'
          || p_public_mutation_id::text
        )
      );

      SELECT *
        INTO v_public
        FROM public.bank_mutations
       WHERE id = p_public_mutation_id
       FOR UPDATE;

      IF NOT FOUND THEN
        RAISE EXCEPTION 'CANONICAL_SETTLEMENT_RECOVERY_PUBLIC_MUTATION_NOT_FOUND: %',
          p_public_mutation_id;
      END IF;

      SELECT *
        INTO v_batch
        FROM sport_center.payment_settlement_batches
       WHERE id = p_settlement_id
       FOR UPDATE;

      IF NOT FOUND THEN
        RAISE EXCEPTION 'CANONICAL_SETTLEMENT_RECOVERY_SETTLEMENT_NOT_FOUND: %',
          p_settlement_id;
      END IF;

      IF v_batch.settlement_journal_id IS NULL THEN
        RAISE EXCEPTION 'CANONICAL_SETTLEMENT_RECOVERY_JOURNAL_REQUIRED: %',
          p_settlement_id;
      END IF;

      SELECT *
        INTO v_journal
        FROM sport_center.accounting_journals
       WHERE id = v_batch.settlement_journal_id
       FOR UPDATE;

      IF NOT FOUND
         OR v_journal.status <> 'posted'
         OR v_journal.journal_type <> 'settlement'
         OR v_journal.is_reversal IS DISTINCT FROM FALSE
         OR v_journal.settlement_batch_id::text IS DISTINCT FROM p_settlement_id::text
      THEN
        RAISE EXCEPTION
          'CANONICAL_SETTLEMENT_RECOVERY_JOURNAL_NOT_ELIGIBLE: settlement=% journal=%',
          p_settlement_id,
          v_batch.settlement_journal_id;
      END IF;

      v_mutation_key := NULLIF(BTRIM(v_public.mutation_key), '');
      IF v_mutation_key IS NULL
         OR v_public.company_id IS NULL
         OR v_public.transaction_date IS NULL
         OR v_public.amount IS NULL
         OR v_public.amount <= 0
         OR LOWER(COALESCE(v_public.direction, '')) NOT IN
             ('in', 'credit', 'incoming', 'cr')
      THEN
        RAISE EXCEPTION
          'CANONICAL_SETTLEMENT_RECOVERY_BANK_EVIDENCE_INVALID: mutation=%',
          p_public_mutation_id;
      END IF;

      IF v_public.journal_entry_id IS NOT NULL THEN
        RAISE EXCEPTION
          'CANONICAL_SETTLEMENT_RECOVERY_GENERIC_JOURNAL_EXISTS: mutation=%',
          p_public_mutation_id;
      END IF;

      IF v_batch.company_id IS DISTINCT FROM v_public.company_id THEN
        RAISE EXCEPTION
          'CANONICAL_SETTLEMENT_RECOVERY_COMPANY_MISMATCH: settlement=% mutation=%',
          p_settlement_id,
          p_public_mutation_id;
      END IF;

      v_date_difference :=
        ABS(v_public.transaction_date::date - v_batch.settlement_date)::integer;
      IF v_date_difference > 1 THEN
        RAISE EXCEPTION
          'CANONICAL_SETTLEMENT_RECOVERY_DATE_OUTSIDE_TOLERANCE: settlement=% mutation=% days=%',
          p_settlement_id,
          p_public_mutation_id,
          v_date_difference;
      END IF;

      IF v_public.amount > v_batch.gross_amount THEN
        RAISE EXCEPTION
          'CANONICAL_SETTLEMENT_RECOVERY_NET_EXCEEDS_GROSS: settlement=% mutation=%',
          p_settlement_id,
          p_public_mutation_id;
      END IF;

      SELECT COUNT(*)::integer
        INTO v_config_count
        FROM sport_center.payment_settlement_configs psc
       WHERE psc.company_id = v_batch.company_id
         AND LOWER(BTRIM(psc.provider_code)) =
             LOWER(BTRIM(v_batch.provider_code))
         AND BTRIM(psc.bank_account_id) = BTRIM(v_batch.bank_account_id)
         AND psc.is_active = TRUE
         AND psc.source = 'OWNER_APPROVED'
         AND psc.effective_from <= v_batch.settlement_date
         AND (
           psc.effective_until IS NULL
           OR v_batch.settlement_date < psc.effective_until
         );

      IF v_config_count <> 1 THEN
        RAISE EXCEPTION
          'CANONICAL_SETTLEMENT_RECOVERY_CONFIG_INVALID: settlement=% configs=%',
          p_settlement_id,
          v_config_count;
      END IF;

      v_internal_bank_account_id :=
        sport_center.resolve_internal_bank_account_id(
          v_batch.company_id,
          v_batch.bank_account_id
        );
      IF v_public.bank_account_id IS NOT NULL
         AND v_public.bank_account_id::text <>
             v_internal_bank_account_id::text
      THEN
        RAISE EXCEPTION
          'CANONICAL_SETTLEMENT_RECOVERY_BANK_ACCOUNT_MISMATCH: settlement=% mutation=%',
          p_settlement_id,
          p_public_mutation_id;
      END IF;

      PERFORM i.id
        FROM sport_center.payment_settlement_items i
       WHERE i.settlement_id = p_settlement_id
         AND i.item_status = 'active'
       FOR UPDATE;

      SELECT COUNT(*)::integer
        INTO v_active_item_count
        FROM sport_center.payment_settlement_items active_items
       WHERE active_items.settlement_id = p_settlement_id
         AND active_items.item_status = 'active';

      IF v_active_item_count = 0 THEN
        RAISE EXCEPTION
          'CANONICAL_SETTLEMENT_RECOVERY_ACTIVE_ITEMS_REQUIRED: settlement=%',
          p_settlement_id;
      END IF;

      SELECT COUNT(DISTINCT other_items.settlement_id)::integer
        INTO v_other_settlement_count
        FROM sport_center.payment_settlement_items target_items
        JOIN sport_center.payment_settlement_items other_items
          ON other_items.payment_id = target_items.payment_id
         AND other_items.item_status = 'active'
         AND other_items.settlement_id <> p_settlement_id
       WHERE target_items.settlement_id = p_settlement_id
         AND target_items.item_status = 'active';

      IF v_other_settlement_count <> 0 THEN
        RAISE EXCEPTION
          'CANONICAL_SETTLEMENT_RECOVERY_PAYMENT_ALREADY_SETTLED: settlement=% conflicts=%',
          p_settlement_id,
          v_other_settlement_count;
      END IF;

      SELECT COUNT(*)::integer
        INTO v_active_match_count
        FROM public.bank_reconciliation_matches
       WHERE mutation_id = p_public_mutation_id
         AND status IN ('candidate', 'approved');

      IF v_active_match_count > 1 THEN
        RAISE EXCEPTION
          'CANONICAL_SETTLEMENT_RECOVERY_MULTIPLE_ACTIVE_MATCHES: mutation=%',
          p_public_mutation_id;
      END IF;

      SELECT *
        INTO v_existing_match
        FROM public.bank_reconciliation_matches
       WHERE mutation_id = p_public_mutation_id
         AND status IN ('candidate', 'approved')
       ORDER BY id
       LIMIT 1
       FOR UPDATE;

      v_old_net := v_batch.net_amount;
      v_base_net := ROUND(
        (
          v_batch.gross_amount
          - v_batch.mdr_amount
          - v_batch.provider_fee_amount
          - v_batch.fee_tax_amount
          - v_batch.tax_withheld_amount
        )::numeric,
        2
      );
      v_recovered_net := ROUND(v_public.amount::numeric, 2);
      v_adjustment := ROUND(v_recovered_net - v_base_net, 2);

      SELECT *
        INTO v_canonical
        FROM sport_center.bank_mutations
       WHERE mutation_key = v_mutation_key
       FOR UPDATE;

      IF FOUND
         AND (
           v_canonical.source_table IS DISTINCT FROM 'public.bank_mutations'
           OR v_canonical.source_id IS DISTINCT FROM p_public_mutation_id::text
         )
      THEN
        RAISE EXCEPTION
          'CANONICAL_SETTLEMENT_RECOVERY_IDENTITY_CONFLICT: mutation=%',
          p_public_mutation_id;
      END IF;

      IF FOUND THEN
        SELECT COUNT(*)::integer
          INTO v_other_settlement_count
          FROM sport_center.payment_settlement_batches
         WHERE bank_mutation_id = v_canonical.id
           AND id <> p_settlement_id;

        IF v_other_settlement_count <> 0 THEN
          RAISE EXCEPTION
            'CANONICAL_SETTLEMENT_RECOVERY_MUTATION_ALREADY_LINKED: mutation=%',
            p_public_mutation_id;
        END IF;
      ELSE
        INSERT INTO sport_center.bank_mutations (
          bank_account_id,
          transaction_date,
          description,
          credit_amount,
          debit_amount,
          amount,
          direction,
          mutation_key,
          normalized_description,
          provider_name,
          provider_order_id,
          status,
          company_id,
          source,
          source_classification,
          source_app,
          source_module,
          source_table,
          source_id,
          provenance
        )
        VALUES (
          v_batch.bank_account_id,
          v_public.transaction_date,
          v_public.description,
          v_public.amount,
          0,
          v_public.amount,
          'IN',
          v_mutation_key,
          v_public.normalized_description,
          v_batch.provider_code,
          v_public.provider_order_id,
          'unmatched'::sport_center.bank_mutation_status,
          v_batch.company_id,
          'PUBLIC_BANK_MUTATION_BRIDGE',
          'actual_bank_mutation',
          'cst-super-app',
          'canonical_settlement_recovery',
          'public.bank_mutations',
          p_public_mutation_id::text,
          jsonb_build_object(
            'bridge', 'public_to_sport_center',
            'recovery', 'posted_settlement_net_correction',
            'public_mutation_id', p_public_mutation_id,
            'settlement_id', p_settlement_id
          )
        )
        RETURNING * INTO v_canonical;
      END IF;

      IF v_canonical.status IN ('rejected'::sport_center.bank_mutation_status)
         AND NOT (
           v_batch.status = 'reconciled'
           AND v_batch.bank_mutation_id = v_canonical.id
           AND v_public.status = 'approved'
         )
      THEN
        RAISE EXCEPTION
          'CANONICAL_SETTLEMENT_RECOVERY_CANONICAL_MUTATION_REJECTED: mutation=%',
          p_public_mutation_id;
      END IF;

      IF v_batch.status = 'reconciled'
         AND v_batch.bank_mutation_id = v_canonical.id
         AND v_public.status = 'approved'
         AND v_existing_match.id IS NOT NULL
         AND v_existing_match.candidate_id::text = p_settlement_id::text
         AND v_existing_match.candidate_source =
             'sport_center.payment_settlement_batches'
         AND v_existing_match.status = 'approved'
      THEN
        v_idempotent := true;
        v_recovered_net := v_batch.net_amount;
        v_adjustment := v_batch.adjustment_amount;
        v_match_id := v_existing_match.id;
      ELSE
        IF v_batch.status <> 'posted' OR v_batch.bank_mutation_id IS NOT NULL THEN
          RAISE EXCEPTION
            'CANONICAL_SETTLEMENT_RECOVERY_SETTLEMENT_NOT_POSTED_UNLINKED: settlement=% status=% bank_mutation=%',
            p_settlement_id,
            v_batch.status,
            v_batch.bank_mutation_id;
        END IF;

        -- Matching may already have created a provisional candidate before
        -- the original approval was interrupted. Recovery is still safe for
        -- non-final reconciliation states because the function locks the
        -- mutation and rejects generic journals/final links above.
        IF LOWER(COALESCE(v_public.status, '')) NOT IN
           ('unmatched', 'matched', 'manual_review', 'duplicate_need_review')
        THEN
          RAISE EXCEPTION
            'CANONICAL_SETTLEMENT_RECOVERY_PUBLIC_MUTATION_NOT_RECOVERABLE: mutation=% status=%',
            p_public_mutation_id,
            v_public.status;
        END IF;

        IF v_existing_match.id IS NOT NULL
           AND (
             v_existing_match.candidate_type <> 'qris_settlement'
             OR v_existing_match.candidate_id::text <> p_settlement_id::text
             OR v_existing_match.candidate_source <>
                'sport_center.payment_settlement_batches'
           )
        THEN
          RAISE EXCEPTION
            'CANONICAL_SETTLEMENT_RECOVERY_MATCH_CONFLICT: mutation=%',
            p_public_mutation_id;
        END IF;

        UPDATE sport_center.bank_mutations
           SET status = 'approved'::sport_center.bank_mutation_status,
               approved_by = v_actor,
               approved_at = NOW(),
               updated_at = NOW()
         WHERE id = v_canonical.id
           AND status IN (
             'unmatched'::sport_center.bank_mutation_status,
             'matched'::sport_center.bank_mutation_status,
             'auto_matched'::sport_center.bank_mutation_status
           );

        IF NOT FOUND THEN
          RAISE EXCEPTION
            'CANONICAL_SETTLEMENT_RECOVERY_CANONICAL_STATE_CHANGED: mutation=%',
            p_public_mutation_id;
        END IF;

        PERFORM set_config(
          'sport_center.canonical_settlement_recovery',
          'owner-net-correction-v1',
          true
        );

        UPDATE sport_center.payment_settlement_batches
           SET net_amount = v_recovered_net,
               adjustment_amount = v_adjustment,
               bank_mutation_id = v_canonical.id,
               status = 'reconciled',
               reconciled_at = NOW(),
               reconciled_by = v_actor,
               notes = CONCAT(
                 COALESCE(notes || E'\\n', ''),
                 'OWNER_RECOVERY: net ',
                 v_old_net::text,
                 ' -> ',
                 v_recovered_net::text,
                 ' from public.bank_mutations ',
                 p_public_mutation_id::text
               ),
               updated_at = NOW()
         WHERE id = p_settlement_id
           AND status = 'posted'
           AND bank_mutation_id IS NULL;

        IF NOT FOUND THEN
          RAISE EXCEPTION
            'CANONICAL_SETTLEMENT_RECOVERY_SETTLEMENT_STATE_CHANGED: settlement=%',
            p_settlement_id;
        END IF;

        UPDATE public.bank_mutations
           SET status = 'approved',
               approved_by = v_actor,
               approved_at = NOW(),
               updated_at = NOW()
         WHERE id = p_public_mutation_id
           AND status = 'unmatched';

        IF NOT FOUND THEN
          RAISE EXCEPTION
            'CANONICAL_SETTLEMENT_RECOVERY_PUBLIC_STATE_CHANGED: mutation=%',
            p_public_mutation_id;
        END IF;

        IF v_existing_match.id IS NULL THEN
          INSERT INTO public.bank_reconciliation_matches (
            mutation_id,
            candidate_type,
            candidate_id,
            match_score,
            match_reason,
            amount_match,
            date_match,
            name_match,
            order_id_match,
            proof_match,
            status,
            candidate_source
          )
          VALUES (
            p_public_mutation_id,
            'qris_settlement',
            p_settlement_id::integer,
            100,
            'OWNER_RECOVERY_NET_CORRECTION',
            TRUE,
            TRUE,
            FALSE,
            FALSE,
            FALSE,
            'approved',
            'sport_center.payment_settlement_batches'
          )
          RETURNING id INTO v_match_id;
        ELSE
          UPDATE public.bank_reconciliation_matches
             SET candidate_type = 'qris_settlement',
             candidate_id = p_settlement_id::text,
                 match_score = 100,
                 match_reason = 'OWNER_RECOVERY_NET_CORRECTION',
                 amount_match = TRUE,
                 date_match = TRUE,
                 status = 'approved',
                 candidate_source =
                   'sport_center.payment_settlement_batches'
           WHERE id = v_existing_match.id;
          v_match_id := v_existing_match.id;
        END IF;
      END IF;

      IF v_canonical.status <> 'approved'::sport_center.bank_mutation_status THEN
        UPDATE sport_center.bank_mutations
           SET status = 'approved'::sport_center.bank_mutation_status,
               approved_by = v_actor,
               approved_at = COALESCE(approved_at, NOW()),
               updated_at = NOW()
         WHERE id = v_canonical.id;
      END IF;

      INSERT INTO public.bank_reconciliation_audit (
        mutation_id,
        action,
        actor,
        meta
      )
      VALUES (
        p_public_mutation_id,
        'CANONICAL_SETTLEMENT_OWNER_RECOVERY',
        v_actor,
        jsonb_build_object(
          'settlement_id', p_settlement_id,
          'public_mutation_id', p_public_mutation_id,
          'canonical_mutation_id', v_canonical.id,
          'match_id', v_match_id,
          'old_net_amount', v_old_net,
          'recovered_net_amount', v_recovered_net,
          'adjustment_amount', v_adjustment,
          'settlement_journal_id', v_batch.settlement_journal_id,
          'journal_created', FALSE,
          'journal_reversed', FALSE,
          'idempotent', v_idempotent
        )
      );

      settlement_id := p_settlement_id;
      public_mutation_id := p_public_mutation_id;
      canonical_mutation_id := v_canonical.id;
      match_id := v_match_id;
      old_net_amount := v_old_net;
      recovered_net_amount := v_recovered_net;
      adjustment_amount := v_adjustment;
      settlement_status := 'reconciled';
      public_mutation_status := 'approved';
      canonical_mutation_status := 'approved';
      idempotent := v_idempotent;
      RETURN NEXT;
    END;
    $function$;
  `));

  /*
   * Read-only candidate evidence owner.  Keep this function independent from
   * the public QRIS matcher: canonical settlement evidence comes only from
   * sport_center.bank_mutations and is eligible only when the settlement
   * journal and all evidence dimensions agree.
   */
  await db.execute(sql.raw(`
    CREATE OR REPLACE FUNCTION sport_center.find_settlement_bank_candidates(
      p_settlement_id bigint,
      p_date_tolerance_days integer DEFAULT 1
    )
    RETURNS TABLE (
      settlement_id bigint,
      mutation_id integer,
      settlement_reference text,
      settlement_date date,
      mutation_date date,
      expected_amount numeric,
      mutation_amount numeric,
      amount_difference numeric,
      allowed_amount_difference numeric,
      date_difference_days integer,
      amount_match boolean,
      date_match boolean,
      company_match boolean,
      bank_account_match boolean,
      provider_match boolean,
      candidate_eligible boolean
    )
    LANGUAGE plpgsql
    STABLE
    SECURITY DEFINER
    SET search_path TO 'pg_catalog', 'sport_center'
    AS $function$
    BEGIN
      IF p_date_tolerance_days IS NULL OR p_date_tolerance_days < 0 THEN
        RAISE EXCEPTION 'DATE_TOLERANCE_MUST_BE_NON_NEGATIVE';
      END IF;

      RETURN QUERY
      WITH settlement AS (
        SELECT
          b.id,
          b.settlement_reference,
          b.company_id,
          b.provider_code,
          b.bank_account_id,
          b.settlement_date,
          b.net_amount,
          b.status,
          b.settlement_journal_id,
          b.bank_mutation_id
        FROM sport_center.payment_settlement_batches b
        JOIN sport_center.accounting_journals sj
          ON sj.id = b.settlement_journal_id
         AND sj.status = 'posted'
         AND sj.journal_type = 'settlement'
         AND sj.is_reversal = FALSE
        WHERE b.id = p_settlement_id
          AND b.status IN ('posted', 'reconciled')
          AND b.bank_mutation_id IS NULL
      ),
      evidence AS (
        SELECT
          s.id AS settlement_id,
          bm.id AS mutation_id,
          s.settlement_reference,
          s.settlement_date,
          bm.transaction_date::date AS mutation_date,
          s.net_amount AS expected_amount,
          bm.amount AS mutation_amount,
          ABS(s.net_amount - bm.amount) AS amount_difference,
          GREATEST(1::numeric, ABS(s.net_amount) * 0.001) AS allowed_amount_difference,
          ABS(bm.transaction_date::date - s.settlement_date)::integer
            AS date_difference_days,
          ABS(s.net_amount - bm.amount)
            <= GREATEST(1::numeric, ABS(s.net_amount) * 0.001)
            AS amount_match,
          ABS(bm.transaction_date::date - s.settlement_date)
            <= p_date_tolerance_days
            AS date_match,
          (
            bm.company_id IS NULL
            OR bm.company_id = s.company_id
          ) AS company_match,
          (
            bm.bank_account_id IS NULL
            OR btrim(bm.bank_account_id::text) = btrim(s.bank_account_id::text)
          ) AS bank_account_match,
          (
            bm.provider_name IS NULL
            OR lower(btrim(bm.provider_name::text))
              = lower(btrim(s.provider_code::text))
          ) AS provider_match,
          NOT EXISTS (
            SELECT 1
            FROM sport_center.payment_settlement_batches linked
            WHERE linked.bank_mutation_id = bm.id
          ) AS mutation_unlinked
        FROM settlement s
        JOIN sport_center.bank_mutations bm
          ON bm.transaction_date::date
             BETWEEN s.settlement_date - p_date_tolerance_days
                 AND s.settlement_date + p_date_tolerance_days
         AND lower(COALESCE(bm.direction::text, ''))
             IN ('credit', 'in', 'incoming', 'cr')
      )
      SELECT
        e.settlement_id,
        e.mutation_id,
        e.settlement_reference,
        e.settlement_date,
        e.mutation_date,
        e.expected_amount,
        e.mutation_amount,
        e.amount_difference,
        e.allowed_amount_difference,
        e.date_difference_days,
        e.amount_match,
        e.date_match,
        e.company_match,
        e.bank_account_match,
        e.provider_match,
        (
          e.amount_match
          AND e.date_match
          AND e.company_match
          AND e.bank_account_match
          AND e.provider_match
          AND e.mutation_unlinked
        ) AS candidate_eligible
      FROM evidence e
      ORDER BY e.mutation_date, e.mutation_id;
    END;
    $function$;
  `));

  /*
   * Phase 4C-7N: public bank-mutation -> canonical Sport Center bridge.
   *
   * This is deliberately owned by PostgreSQL.  The public row is the UI/API
   * identity, while the canonical row gets its provider and bank-account
   * metadata only from one unambiguous OWNER_APPROVED Sport Center config.
   * No public provider/account fields are trusted, and no settlement,
   * reconciliation, or accounting state is changed here.
   */
  // Retained as historical source context only. Executing this block would
  // recreate the projection trigger/FKs before the public-only cutover below.
  if (false) {
  await db.execute(sql.raw(`
    CREATE UNIQUE INDEX IF NOT EXISTS sport_center_bank_mutations_mutation_key_unique
      ON sport_center.bank_mutations (mutation_key)
  `));

  await db.execute(sql.raw(`
    CREATE OR REPLACE FUNCTION sport_center.project_public_bank_mutation_to_canonical(
      p_public_mutation_id integer
    )
    RETURNS integer
    LANGUAGE plpgsql
    SECURITY DEFINER
    SET search_path TO 'pg_catalog', 'sport_center', 'public'
    AS $function$
    DECLARE
      v_public public.bank_mutations%ROWTYPE;
      v_candidate_count integer;
      v_config_count integer;
      v_public_key_count integer;
      v_canonical_id integer;
      v_settlement_id bigint;
      v_config_id integer;
      v_company_id integer;
      v_provider_code text;
      v_bank_account_id text;
      v_existing_source_table text;
      v_existing_source_id text;
      v_requested_settlement_id bigint;
    BEGIN
      SELECT *
        INTO v_public
        FROM public.bank_mutations
       WHERE id = p_public_mutation_id
       FOR UPDATE;

      IF NOT FOUND THEN
        RAISE EXCEPTION 'PUBLIC_BANK_MUTATION_NOT_FOUND: %', p_public_mutation_id;
      END IF;

      /*
       * Scope gate: this bridge is not a general public-mutation mirror.
       * Canonical reconciliation starts from an incoming matched mutation.
       */
      IF LOWER(COALESCE(v_public.status, '')) NOT IN ('matched', 'auto_matched')
         OR LOWER(COALESCE(v_public.direction, '')) NOT IN ('in', 'credit', 'incoming', 'cr')
      THEN
        RETURN NULL;
      END IF;

      IF v_public.mutation_key IS NULL
         OR btrim(v_public.mutation_key) = ''
         OR v_public.company_id IS NULL
         OR v_public.transaction_date IS NULL
         OR btrim(v_public.transaction_date) = ''
         OR v_public.amount IS NULL
         OR v_public.amount <= 0
      THEN
        RAISE EXCEPTION
          'CANONICAL_BANK_MUTATION_BRIDGE_UNRESOLVED: public mutation=% lacks company/date/amount/key',
          p_public_mutation_id;
      END IF;

      /*
       * Canonical Finance handoff supplies the owning settlement batch in
       * source_account.  Use it as an exact scope when present; amount/date
       * alone is ambiguous for same-day DP and pelunasan batches.
       */
      IF v_public.source_account LIKE 'sport_center.payment_settlement_batches:%'
      THEN
        v_requested_settlement_id :=
          substring(
            v_public.source_account
            FROM 'sport_center\.payment_settlement_batches:([0-9]+)$'
          )::bigint;
      END IF;

      SELECT COUNT(*)::integer
        INTO v_public_key_count
        FROM public.bank_mutations
       WHERE mutation_key = v_public.mutation_key;

      IF v_public_key_count <> 1 THEN
        RAISE EXCEPTION
          'CANONICAL_BANK_MUTATION_IDENTITY_CONFLICT: mutation_key=% public_rows=%',
          v_public.mutation_key,
          v_public_key_count;
      END IF;

      /*
       * First establish that the public evidence belongs to exactly one
       * posted, not-yet-linked canonical settlement with a posted settlement
       * journal.  Amount/date/company/direction are the evidence boundary.
       */
      SELECT COUNT(*)::integer
        INTO v_candidate_count
        FROM sport_center.payment_settlement_batches b
        JOIN sport_center.accounting_journals aj
          ON aj.id = b.settlement_journal_id
         AND aj.status = 'posted'
         AND aj.journal_type = 'settlement'
         AND aj.is_reversal = FALSE
       WHERE b.status = 'posted'
         AND b.bank_mutation_id IS NULL
          AND (
            v_requested_settlement_id IS NULL
            OR b.id = v_requested_settlement_id
          )
         AND b.company_id = v_public.company_id
         AND b.settlement_date = v_public.transaction_date::date
         AND b.net_amount = v_public.amount
         AND LOWER(COALESCE(v_public.direction, '')) IN ('in', 'credit', 'incoming', 'cr');

      IF v_candidate_count = 0 THEN
        RETURN NULL;
      ELSIF v_candidate_count > 1 THEN
        RAISE EXCEPTION
          'CANONICAL_BANK_MUTATION_BRIDGE_AMBIGUOUS_SETTLEMENT: public_mutation=% candidates=%',
          p_public_mutation_id,
          v_candidate_count;
      END IF;

      /*
       * Resolve provider/account/company only through the owner-approved
       * Sport Center configuration.  The batch must agree with that config;
       * the public QRIS/provider/account fields are intentionally ignored.
       */
      SELECT
        COUNT(*)::integer,
        MIN(b.id),
        MIN(psc.id),
        MIN(psc.company_id),
        MIN(LOWER(BTRIM(psc.provider_code))),
        MIN(BTRIM(psc.bank_account_id))
        INTO
          v_config_count,
          v_settlement_id,
          v_config_id,
          v_company_id,
          v_provider_code,
          v_bank_account_id
        FROM sport_center.payment_settlement_batches b
        JOIN sport_center.accounting_journals aj
          ON aj.id = b.settlement_journal_id
         AND aj.status = 'posted'
         AND aj.journal_type = 'settlement'
         AND aj.is_reversal = FALSE
        JOIN sport_center.payment_settlement_configs psc
          ON psc.company_id = b.company_id
         AND LOWER(BTRIM(psc.provider_code)) = LOWER(BTRIM(b.provider_code))
         AND BTRIM(psc.bank_account_id) = BTRIM(b.bank_account_id)
         AND psc.is_active = TRUE
         AND psc.source = 'OWNER_APPROVED'
         AND psc.effective_from <= b.settlement_date
         AND (psc.effective_until IS NULL OR b.settlement_date < psc.effective_until)
       WHERE b.status = 'posted'
         AND b.bank_mutation_id IS NULL
          AND (
            v_requested_settlement_id IS NULL
            OR b.id = v_requested_settlement_id
          )
         AND b.company_id = v_public.company_id
         AND b.settlement_date = v_public.transaction_date::date
         AND b.net_amount = v_public.amount
         AND LOWER(COALESCE(v_public.direction, '')) IN ('in', 'credit', 'incoming', 'cr');

      IF v_config_count = 0
         OR v_company_id IS NULL
         OR v_provider_code IS NULL
         OR v_bank_account_id IS NULL
      THEN
        RAISE EXCEPTION
          'CANONICAL_BANK_MUTATION_BRIDGE_CONFIG_UNRESOLVED: public_mutation=%',
          p_public_mutation_id;
      ELSIF v_config_count > 1 THEN
        RAISE EXCEPTION
          'CANONICAL_BANK_MUTATION_BRIDGE_CONFIG_AMBIGUOUS: public_mutation=% configs=%',
          p_public_mutation_id,
          v_config_count;
      END IF;

      SELECT id, source_table, source_id
        INTO v_canonical_id, v_existing_source_table, v_existing_source_id
        FROM sport_center.bank_mutations
       WHERE mutation_key = v_public.mutation_key
       FOR UPDATE;

      IF v_canonical_id IS NOT NULL
         AND (
           v_existing_source_table IS DISTINCT FROM 'public.bank_mutations'
           OR v_existing_source_id IS DISTINCT FROM v_public.id::text
         )
      THEN
        RAISE EXCEPTION
          'CANONICAL_BANK_MUTATION_IDENTITY_CONFLICT: mutation_key=% canonical_id=%',
          v_public.mutation_key,
          v_canonical_id;
      END IF;

      INSERT INTO sport_center.bank_mutations (
        bank_account_id,
        transaction_date,
        description,
        credit_amount,
        debit_amount,
        amount,
        direction,
        mutation_key,
        normalized_description,
        provider_name,
        provider_order_id,
         status,
        company_id,
        source,
        source_classification,
        source_app,
        source_module,
        source_table,
        source_id,
        provenance
      )
      VALUES (
        v_bank_account_id,
        v_public.transaction_date,
        v_public.description,
        v_public.amount,
        0,
        v_public.amount,
        'IN',
        v_public.mutation_key,
        v_public.normalized_description,
        v_provider_code,
        NULL,
         v_public.status::sport_center.bank_mutation_status,
        v_company_id,
        'PUBLIC_BANK_MUTATION_BRIDGE',
        'actual_bank_mutation',
        'cst-super-app',
        'canonical_bank_mutation_bridge',
        'public.bank_mutations',
        v_public.id::text,
        jsonb_build_object(
          'bridge', 'public_to_sport_center',
          'public_mutation_id', v_public.id,
          'settlement_id', v_settlement_id,
          'approved_config_id', v_config_id
        )
      )
      ON CONFLICT (mutation_key) DO UPDATE
      SET bank_account_id = EXCLUDED.bank_account_id,
          transaction_date = EXCLUDED.transaction_date,
          description = EXCLUDED.description,
          credit_amount = EXCLUDED.credit_amount,
          debit_amount = EXCLUDED.debit_amount,
          amount = EXCLUDED.amount,
          direction = EXCLUDED.direction,
          normalized_description = EXCLUDED.normalized_description,
          provider_name = EXCLUDED.provider_name,
          provider_order_id = EXCLUDED.provider_order_id,
           status = CASE
             WHEN sport_center.bank_mutations.status IN ('approved', 'rejected')
               THEN sport_center.bank_mutations.status
             ELSE EXCLUDED.status
           END,
          company_id = EXCLUDED.company_id,
          source = EXCLUDED.source,
          source_classification = EXCLUDED.source_classification,
          source_app = EXCLUDED.source_app,
          source_module = EXCLUDED.source_module,
          source_table = EXCLUDED.source_table,
          source_id = EXCLUDED.source_id,
          provenance = EXCLUDED.provenance,
          updated_at = now()
      RETURNING id INTO v_canonical_id;

      RETURN v_canonical_id;
    END;
    $function$;
  `));

  await db.execute(sql.raw(`
    CREATE OR REPLACE FUNCTION sport_center.replay_public_bank_mutation_bridge(
      p_public_mutation_id integer
    )
    RETURNS integer
    LANGUAGE plpgsql
    SECURITY DEFINER
    SET search_path TO 'pg_catalog', 'sport_center', 'public'
    AS $function$
    BEGIN
      RETURN sport_center.project_public_bank_mutation_to_canonical(
        p_public_mutation_id
      );
    END;
    $function$;
  `));

  await db.execute(sql.raw(`
    CREATE OR REPLACE FUNCTION sport_center.project_public_bank_mutation_to_canonical_trigger()
    RETURNS trigger
    LANGUAGE plpgsql
    SECURITY DEFINER
    SET search_path TO 'pg_catalog', 'sport_center', 'public'
    AS $function$
    BEGIN
      PERFORM sport_center.project_public_bank_mutation_to_canonical(NEW.id);
      RETURN NEW;
    END;
    $function$;
  `));

  await db.execute(sql.raw(`
    DO $migration$
    BEGIN
      EXECUTE 'DROP TRIGGER IF EXISTS trg_project_public_bank_mutation_to_canonical
               ON public.bank_mutations';
      EXECUTE 'CREATE TRIGGER trg_project_public_bank_mutation_to_canonical
               AFTER INSERT OR UPDATE OF mutation_key, company_id, transaction_date,
                 amount, direction, status
               ON public.bank_mutations
               FOR EACH ROW
               EXECUTE FUNCTION sport_center.project_public_bank_mutation_to_canonical_trigger()';
    END;
    $migration$;
  `));

  /*
   * CF-SC-10B: canonical settlement -> public mutation handoff.
   *
   * The public row remains the UI/import identity and the existing
   * project_public_bank_mutation_to_canonical() function remains the only
   * producer of sport_center.bank_mutations.  This owner only creates the
   * deterministic public evidence row, invokes that bridge, and records the
   * resulting canonical id on the settlement batch.
   */
  await db.execute(sql.raw(`
    ALTER TABLE sport_center.payment_settlement_batches
      ADD COLUMN IF NOT EXISTS canonical_bank_mutation_id INTEGER
  `));

  /*
   * The canonical settlement link must point at the Sport Center canonical
   * mutation table. An older runtime could retain a link to a mutation that
   * no longer exists in either identity surface. Clear only those invalid
   * legacy links before adding the FK; eligible posted settlements are
   * rebuilt through the canonical owner below after its definition is live.
   */
  await db.execute(sql.raw(`
    DO $migration$
    BEGIN
      IF EXISTS (
        SELECT 1
        FROM pg_constraint
        WHERE conname = 'payment_settlement_batches_canonical_bank_mutation_fk'
          AND conrelid = 'sport_center.payment_settlement_batches'::regclass
      ) THEN
        ALTER TABLE sport_center.payment_settlement_batches
          DROP CONSTRAINT payment_settlement_batches_canonical_bank_mutation_fk;
      END IF;

      UPDATE sport_center.payment_settlement_batches AS batch
         SET canonical_bank_mutation_id = NULL,
             updated_at = NOW()
       WHERE batch.canonical_bank_mutation_id IS NOT NULL
         AND NOT EXISTS (
           SELECT 1
             FROM sport_center.bank_mutations AS mutation
            WHERE mutation.id = batch.canonical_bank_mutation_id
         );

      ALTER TABLE sport_center.payment_settlement_batches
        ADD CONSTRAINT payment_settlement_batches_canonical_bank_mutation_fk
        FOREIGN KEY (canonical_bank_mutation_id)
        REFERENCES sport_center.bank_mutations(id);
    END;
    $migration$;
  `));

  await db.execute(sql.raw(`
    ALTER TABLE sport_center.bank_mutations
      ADD COLUMN IF NOT EXISTS canonical_key TEXT
  `));

  await db.execute(sql.raw(`
    CREATE UNIQUE INDEX IF NOT EXISTS sport_center_bank_mutations_canonical_key_uidx
      ON sport_center.bank_mutations (canonical_key)
      WHERE canonical_key IS NOT NULL
  `));

  await db.execute(sql.raw(`
    CREATE UNIQUE INDEX IF NOT EXISTS payment_settlement_batches_canonical_mutation_uidx
      ON sport_center.payment_settlement_batches (canonical_bank_mutation_id)
      WHERE canonical_bank_mutation_id IS NOT NULL
  `));

  await db.execute(sql.raw(`
    CREATE OR REPLACE FUNCTION sport_center.ensure_canonical_bank_mutation_for_settlement(
      p_settlement_id bigint,
      p_actor text DEFAULT 'central-finance-processor'
    )
    RETURNS integer
    LANGUAGE plpgsql
    SECURITY DEFINER
    SET search_path TO 'pg_catalog', 'sport_center', 'public'
    AS $function$
    DECLARE
      v_batch sport_center.payment_settlement_batches%ROWTYPE;
      v_payment_id integer;
      v_public_id integer;
      v_canonical_id integer;
      v_mutation_key text;
      v_canonical_key text;
      v_description text;
      v_existing_count integer;
      v_existing_company integer;
    BEGIN
      IF p_settlement_id IS NULL OR p_settlement_id <= 0 THEN
        RAISE EXCEPTION 'CANONICAL_MUTATION_SETTLEMENT_ID_INVALID: %', p_settlement_id;
      END IF;

      PERFORM pg_advisory_xact_lock(
        hashtext('canonical-mutation-handoff:' || p_settlement_id::text)
      );

      SELECT *
        INTO v_batch
        FROM sport_center.payment_settlement_batches
       WHERE id = p_settlement_id
       FOR UPDATE;

      IF NOT FOUND THEN
        RAISE EXCEPTION 'CANONICAL_MUTATION_SETTLEMENT_NOT_FOUND: %', p_settlement_id;
      END IF;

      IF v_batch.canonical_bank_mutation_id IS NOT NULL THEN
        RETURN v_batch.canonical_bank_mutation_id;
      END IF;

      IF v_batch.status <> 'posted'
         OR v_batch.bank_mutation_id IS NOT NULL
         OR v_batch.net_amount IS NULL
         OR v_batch.net_amount <= 0
      THEN
        RAISE EXCEPTION
          'CANONICAL_MUTATION_SETTLEMENT_NOT_READY: settlement=% status=% legacy_mutation=%',
          p_settlement_id, v_batch.status, v_batch.bank_mutation_id;
      END IF;

      SELECT COUNT(*)::integer, MIN(i.payment_id)
        INTO v_existing_count, v_payment_id
        FROM sport_center.payment_settlement_items i
       WHERE i.settlement_id = p_settlement_id
         AND i.item_status = 'active';

      IF v_existing_count <> 1 OR v_payment_id IS NULL THEN
        RAISE EXCEPTION
          'CANONICAL_MUTATION_PAYMENT_IDENTITY_UNRESOLVED: settlement=% items=%',
          p_settlement_id, v_existing_count;
      END IF;

      v_mutation_key := 'SC-PAY-' || v_payment_id::text;
      v_canonical_key := 'sport_center:payment:' || v_payment_id::text;
      v_description := 'Sport Center payment settlement ' || v_payment_id::text;

      PERFORM pg_advisory_xact_lock(hashtext('canonical-mutation-key:' || v_mutation_key));

      SELECT COUNT(*)::integer, MIN(company_id)
        INTO v_existing_count, v_existing_company
        FROM public.bank_mutations
       WHERE mutation_key = v_mutation_key;

      IF v_existing_count > 1
         OR (v_existing_count = 1 AND v_existing_company IS DISTINCT FROM v_batch.company_id)
      THEN
        RAISE EXCEPTION
          'CANONICAL_MUTATION_IDENTITY_CONFLICT: key=% rows=% company=% expected_company=%',
          v_mutation_key, v_existing_count, v_existing_company, v_batch.company_id;
      END IF;

      IF v_existing_count = 0 THEN
        INSERT INTO public.bank_mutations (
          bank_account_id,
          transaction_date,
          description,
          credit_amount,
          debit_amount,
          amount,
          direction,
          mutation_key,
          normalized_description,
          provider_name,
          provider_order_id,
          status,
          company_id,
          canonical_key,
          source,
          source_account
        )
        VALUES (
          NULL,
          v_batch.settlement_date,
          v_description,
          v_batch.net_amount,
          0,
          v_batch.net_amount,
          'IN',
          v_mutation_key,
          upper(regexp_replace(v_description, '[^A-Za-z0-9 ]', '', 'g')),
          v_batch.provider_code,
          v_batch.settlement_reference,
          'matched',
          v_batch.company_id,
          v_canonical_key,
          'CENTRAL_FINANCE_CANONICAL_HANDOFF',
          'sport_center.payment_settlement_batches:' || p_settlement_id::text
        )
        RETURNING id INTO v_public_id;
      ELSE
        SELECT id
          INTO v_public_id
          FROM public.bank_mutations
         WHERE mutation_key = v_mutation_key
           AND company_id = v_batch.company_id
         FOR UPDATE;
        UPDATE public.bank_mutations
           SET canonical_key = COALESCE(canonical_key, v_canonical_key),
               status = CASE WHEN status = 'unmatched' THEN 'matched' ELSE status END,
               updated_at = NOW()
         WHERE id = v_public_id;
      END IF;

      /*
       * This is the existing canonical owner.  It validates the public
       * evidence against exactly one posted settlement and upserts the
       * canonical Sport Center mutation idempotently.
       */
      v_canonical_id :=
        sport_center.project_public_bank_mutation_to_canonical(v_public_id);

      IF v_canonical_id IS NULL THEN
        RAISE EXCEPTION
          'CANONICAL_MUTATION_BRIDGE_UNRESOLVED: settlement=% public_mutation=%',
          p_settlement_id, v_public_id;
      END IF;

      /*
       * The bridge routine is also invoked by the public-bank-mutation
       * trigger.  Do not trust only its scalar return value when this
       * handoff is the caller that owns the settlement FK: resolve the
       * canonical identity again by mutation_key in the current transaction.
       * This prevents a stale/legacy bridge return value from linking a
       * settlement to an ID that is not the canonical row for this payment.
       */
      SELECT id
        INTO v_canonical_id
        FROM sport_center.bank_mutations
       WHERE mutation_key = v_mutation_key
         AND company_id = v_batch.company_id
       FOR UPDATE;

      IF v_canonical_id IS NULL THEN
        RAISE EXCEPTION
          'CANONICAL_MUTATION_IDENTITY_UNRESOLVED: settlement=% key=%',
          p_settlement_id, v_mutation_key;
      END IF;

      UPDATE sport_center.bank_mutations
         SET canonical_key = v_canonical_key,
             source_app = 'sport_center',
             source_module = 'central_finance',
             source_table = 'sport_payments',
             source_id = v_payment_id::text,
             provenance = jsonb_build_object(
               'owner', 'sport_center.ensure_canonical_bank_mutation_for_settlement',
               'public_mutation_id', v_public_id,
               'payment_id', v_payment_id,
               'settlement_id', p_settlement_id,
               'actor', p_actor
             ),
             updated_at = NOW()
       WHERE id = v_canonical_id
         AND company_id = v_batch.company_id;

      UPDATE sport_center.payment_settlement_batches
         SET canonical_bank_mutation_id = v_canonical_id,
             updated_at = NOW()
       WHERE id = p_settlement_id
         AND canonical_bank_mutation_id IS NULL
         AND bank_mutation_id IS NULL;

      IF NOT FOUND THEN
        RAISE EXCEPTION
          'CANONICAL_MUTATION_SETTLEMENT_LINK_CONFLICT: settlement=% canonical=%',
          p_settlement_id, v_canonical_id;
      END IF;

      RETURN v_canonical_id;
    END;
    $function$;
  `));
  }

  /*
   * public.bank_mutations is the only bank-evidence identity.
   *
   * Earlier versions used the same integer columns to point at legacy Sport
   * Center mutation records. Translate a legacy link only when its provenance
   * identifies exactly one public row.  In particular, do not "repair" an
   * ambiguous integer by assuming equal ids: retaining an unresolved legacy
   * value is safer than linking a settlement to somebody else's evidence.
   */
  await db.execute(sql.raw(`
    DO $migration$
    DECLARE
      v_constraint record;
      v_translate_legacy_bank_link boolean;
      v_translate_legacy_canonical_link boolean;
    BEGIN
      ALTER TABLE sport_center.payment_settlement_batches
        ADD COLUMN IF NOT EXISTS canonical_bank_mutation_id INTEGER;

      SELECT EXISTS (
        SELECT 1
          FROM pg_constraint con
         WHERE con.conrelid =
                 'sport_center.payment_settlement_batches'::regclass
           AND con.confrelid = 'sport_center.bank_mutations'::regclass
           AND con.contype = 'f'
           AND con.conkey = ARRAY[(
             SELECT attnum FROM pg_attribute
              WHERE attrelid = con.conrelid
                AND attname = 'bank_mutation_id'
                AND NOT attisdropped
           )]::smallint[]
      ) INTO v_translate_legacy_bank_link;

      SELECT EXISTS (
        SELECT 1
          FROM pg_constraint con
         WHERE con.conrelid =
                 'sport_center.payment_settlement_batches'::regclass
           AND con.confrelid = 'sport_center.bank_mutations'::regclass
           AND con.contype = 'f'
           AND con.conkey = ARRAY[(
             SELECT attnum FROM pg_attribute
              WHERE attrelid = con.conrelid
                AND attname = 'canonical_bank_mutation_id'
                AND NOT attisdropped
           )]::smallint[]
      ) INTO v_translate_legacy_canonical_link;

      -- Release the legacy projection FKs before translating stored values.
      -- The entire DO block is transactional, so the public FKs are installed
      -- before this change can commit.
      FOR v_constraint IN
        SELECT con.conname
          FROM pg_constraint con
         WHERE con.conrelid =
                 'sport_center.payment_settlement_batches'::regclass
           AND con.contype = 'f'
           AND con.conkey && ARRAY[
             (
               SELECT attnum FROM pg_attribute
                WHERE attrelid = con.conrelid
                  AND attname = 'bank_mutation_id'
                  AND NOT attisdropped
             ),
             (
               SELECT attnum FROM pg_attribute
                WHERE attrelid = con.conrelid
                  AND attname = 'canonical_bank_mutation_id'
                  AND NOT attisdropped
             )
           ]::smallint[]
      LOOP
        EXECUTE format(
          'ALTER TABLE sport_center.payment_settlement_batches DROP CONSTRAINT %I',
          v_constraint.conname
        );
      END LOOP;

      IF v_translate_legacy_bank_link THEN
      WITH resolved_legacy AS (
        SELECT legacy.id AS legacy_id, MIN(pm.id)::integer AS public_id
          FROM sport_center.bank_mutations legacy
          JOIN public.bank_mutations pm
            ON (
              legacy.source_table = 'public.bank_mutations'
              AND legacy.source_id = pm.id::text
            )
            OR (
              NULLIF(BTRIM(legacy.mutation_key), '') IS NOT NULL
              AND pm.mutation_key = legacy.mutation_key
            )
         GROUP BY legacy.id
        HAVING COUNT(DISTINCT pm.id) = 1
      )
      UPDATE sport_center.payment_settlement_batches batch
         SET bank_mutation_id = candidate.public_id,
             updated_at = NOW()
        FROM resolved_legacy candidate
       WHERE batch.bank_mutation_id = candidate.legacy_id
         AND batch.bank_mutation_id IS DISTINCT FROM candidate.public_id;
      END IF;

      IF v_translate_legacy_canonical_link THEN
      WITH resolved_legacy AS (
        SELECT legacy.id AS legacy_id, MIN(pm.id)::integer AS public_id
          FROM sport_center.bank_mutations legacy
          JOIN public.bank_mutations pm
            ON (
              legacy.source_table = 'public.bank_mutations'
              AND legacy.source_id = pm.id::text
            )
            OR (
              NULLIF(BTRIM(legacy.mutation_key), '') IS NOT NULL
              AND pm.mutation_key = legacy.mutation_key
            )
         GROUP BY legacy.id
        HAVING COUNT(DISTINCT pm.id) = 1
      )
      UPDATE sport_center.payment_settlement_batches batch
         SET canonical_bank_mutation_id = candidate.public_id,
             updated_at = NOW()
        FROM resolved_legacy candidate
       WHERE batch.canonical_bank_mutation_id = candidate.legacy_id
         AND batch.canonical_bank_mutation_id IS DISTINCT FROM candidate.public_id
         -- The legacy unique index is retained.  Do not turn two historic
         -- links into one public link; leave that conflict for a governed
         -- operator repair instead.
         AND NOT EXISTS (
           SELECT 1
             FROM sport_center.payment_settlement_batches other_batch
            WHERE other_batch.id <> batch.id
              AND other_batch.canonical_bank_mutation_id = candidate.public_id
         );
      END IF;

      ALTER TABLE sport_center.payment_settlement_batches
        ADD CONSTRAINT payment_settlement_batches_bank_mutation_public_fk
        FOREIGN KEY (bank_mutation_id)
        REFERENCES public.bank_mutations(id)
        NOT VALID;
      ALTER TABLE sport_center.payment_settlement_batches
        ADD CONSTRAINT payment_settlement_batches_canonical_bank_mutation_public_fk
        FOREIGN KEY (canonical_bank_mutation_id)
        REFERENCES public.bank_mutations(id)
        NOT VALID;
    END;
    $migration$;
  `));

  // A public insert must never create/update a sport_center projection.
  await db.execute(sql.raw(`
    DROP TRIGGER IF EXISTS trg_project_public_bank_mutation_to_canonical
      ON public.bank_mutations;

    CREATE OR REPLACE FUNCTION sport_center.project_public_bank_mutation_to_canonical(
      p_public_mutation_id integer
    )
    RETURNS integer
    LANGUAGE plpgsql
    SECURITY DEFINER
    SET search_path TO 'pg_catalog', 'sport_center', 'public'
    AS $function$
    BEGIN
      IF NOT EXISTS (
        SELECT 1 FROM public.bank_mutations WHERE id = p_public_mutation_id
      ) THEN
        RAISE EXCEPTION 'PUBLIC_BANK_MUTATION_NOT_FOUND: %', p_public_mutation_id;
      END IF;
      RETURN p_public_mutation_id;
    END;
    $function$;

    CREATE OR REPLACE FUNCTION sport_center.replay_public_bank_mutation_bridge(
      p_public_mutation_id integer
    )
    RETURNS integer
    LANGUAGE plpgsql
    SECURITY DEFINER
    SET search_path TO 'pg_catalog', 'sport_center', 'public'
    AS $function$
    BEGIN
      RETURN sport_center.project_public_bank_mutation_to_canonical(
        p_public_mutation_id
      );
    END;
    $function$;

    CREATE OR REPLACE FUNCTION sport_center.project_public_bank_mutation_to_canonical_trigger()
    RETURNS trigger
    LANGUAGE plpgsql
    SECURITY DEFINER
    SET search_path TO 'pg_catalog', 'sport_center', 'public'
    AS $function$
    BEGIN
      -- Compatibility only. The projection trigger is intentionally absent.
      RETURN NEW;
    END;
    $function$;
  `));

  await db.execute(sql.raw(`
    CREATE OR REPLACE FUNCTION sport_center.ensure_canonical_bank_mutation_for_settlement(
      p_settlement_id bigint,
      p_actor text DEFAULT 'central-finance-processor'
    )
    RETURNS integer
    LANGUAGE plpgsql
    SECURITY DEFINER
    SET search_path TO 'pg_catalog', 'sport_center', 'public'
    AS $function$
    DECLARE
      v_batch sport_center.payment_settlement_batches%ROWTYPE;
      v_payment_id integer;
      v_public_id integer;
      v_mutation_key text;
      v_description text;
      v_existing_count integer;
      v_existing_company integer;
      v_internal_bank_account_id integer;
    BEGIN
      IF p_settlement_id IS NULL OR p_settlement_id <= 0 THEN
        RAISE EXCEPTION 'CANONICAL_MUTATION_SETTLEMENT_ID_INVALID: %', p_settlement_id;
      END IF;
      PERFORM pg_advisory_xact_lock(
        hashtext('public-mutation-handoff:' || p_settlement_id::text)
      );
      SELECT * INTO v_batch
        FROM sport_center.payment_settlement_batches
       WHERE id = p_settlement_id FOR UPDATE;
      IF NOT FOUND THEN
        RAISE EXCEPTION 'CANONICAL_MUTATION_SETTLEMENT_NOT_FOUND: %', p_settlement_id;
      END IF;

      -- Both fields now carry public ids.  A disagreement is never guessed.
      IF v_batch.bank_mutation_id IS NOT NULL
         OR v_batch.canonical_bank_mutation_id IS NOT NULL THEN
        IF v_batch.bank_mutation_id IS NOT NULL
           AND v_batch.canonical_bank_mutation_id IS NOT NULL
           AND v_batch.bank_mutation_id <> v_batch.canonical_bank_mutation_id
        THEN
          RAISE EXCEPTION 'PUBLIC_MUTATION_SETTLEMENT_LINK_AMBIGUOUS: %',
            p_settlement_id;
        END IF;
        v_public_id := COALESCE(
          v_batch.bank_mutation_id, v_batch.canonical_bank_mutation_id
        );
        IF EXISTS (SELECT 1 FROM public.bank_mutations WHERE id = v_public_id) THEN
          UPDATE sport_center.payment_settlement_batches
             SET bank_mutation_id = v_public_id,
                 canonical_bank_mutation_id = v_public_id,
                 updated_at = NOW()
           WHERE id = p_settlement_id;
          RETURN v_public_id;
        END IF;
        RAISE EXCEPTION 'PUBLIC_MUTATION_SETTLEMENT_LINK_UNRESOLVED: %',
          p_settlement_id;
      END IF;
      IF v_batch.status <> 'posted'
         OR v_batch.net_amount IS NULL OR v_batch.net_amount <= 0 THEN
        RAISE EXCEPTION 'CANONICAL_MUTATION_SETTLEMENT_NOT_READY: %', p_settlement_id;
      END IF;
      SELECT COUNT(*)::integer, MIN(payment_id)
        INTO v_existing_count, v_payment_id
        FROM sport_center.payment_settlement_items
       WHERE settlement_id = p_settlement_id AND item_status = 'active';
      IF v_existing_count <> 1 OR v_payment_id IS NULL THEN
        RAISE EXCEPTION 'CANONICAL_MUTATION_PAYMENT_IDENTITY_UNRESOLVED: settlement=% items=%',
          p_settlement_id, v_existing_count;
      END IF;
      v_mutation_key := 'SC-PAY-' || v_payment_id::text;
      v_description := 'Sport Center payment settlement ' || v_payment_id::text;
      SELECT COUNT(*)::integer, MIN(cba.id)
        INTO v_existing_count, v_internal_bank_account_id
        FROM public.company_bank_accounts cba
       WHERE cba.company_id = v_batch.company_id
         AND cba.is_active = TRUE
         AND (
           cba.id::text = NULLIF(BTRIM(v_batch.bank_account_id::text), '')
           OR cba.account_number::text =
              NULLIF(BTRIM(v_batch.bank_account_id::text), '')
         );
      IF v_existing_count <> 1 OR v_internal_bank_account_id IS NULL THEN
        RAISE EXCEPTION
          'CANONICAL_MUTATION_BANK_ACCOUNT_UNRESOLVED: settlement=% matches=%',
          p_settlement_id, v_existing_count;
      END IF;
      SELECT COUNT(*)::integer, MIN(company_id)
        INTO v_existing_count, v_existing_company
        FROM public.bank_mutations WHERE mutation_key = v_mutation_key;
      IF v_existing_count > 1
         OR (v_existing_count = 1 AND v_existing_company IS DISTINCT FROM v_batch.company_id)
      THEN
        RAISE EXCEPTION 'CANONICAL_MUTATION_IDENTITY_CONFLICT: key=%',
          v_mutation_key;
      END IF;
      IF v_existing_count = 0 THEN
        INSERT INTO public.bank_mutations (
          bank_account_id, transaction_date, description, credit_amount,
          debit_amount, amount, direction, mutation_key, normalized_description,
          provider_name, company_id, status, source_account
        ) VALUES (
          v_internal_bank_account_id, v_batch.settlement_date, v_description,
          v_batch.net_amount, 0, v_batch.net_amount, 'in', v_mutation_key,
          lower(v_description), v_batch.provider_code, v_batch.company_id,
          'unmatched', 'sport_center.payment_settlement_batches:' || p_settlement_id::text
        ) RETURNING id INTO v_public_id;
      ELSE
        SELECT id INTO v_public_id FROM public.bank_mutations
         WHERE mutation_key = v_mutation_key FOR UPDATE;
      END IF;
      UPDATE sport_center.payment_settlement_batches
         SET bank_mutation_id = v_public_id,
             canonical_bank_mutation_id = v_public_id,
             updated_at = NOW()
       WHERE id = p_settlement_id
         AND bank_mutation_id IS NULL
         AND canonical_bank_mutation_id IS NULL;
      IF NOT FOUND THEN
        RAISE EXCEPTION 'PUBLIC_MUTATION_SETTLEMENT_LINK_CONFLICT: %', p_settlement_id;
      END IF;
      RETURN v_public_id;
    END;
    $function$;
  `));

  await db.execute(sql.raw(`
    CREATE OR REPLACE FUNCTION sport_center.find_settlement_bank_candidates(
      p_settlement_id bigint,
      p_date_tolerance_days integer DEFAULT 1
    )
    RETURNS TABLE (
      settlement_id bigint, mutation_id integer, settlement_reference text,
      settlement_date date, mutation_date date, expected_amount numeric,
      mutation_amount numeric, amount_difference numeric,
      allowed_amount_difference numeric, date_difference_days integer,
      amount_match boolean, date_match boolean, company_match boolean,
      bank_account_match boolean, provider_match boolean, candidate_eligible boolean
    )
    LANGUAGE plpgsql STABLE SECURITY DEFINER
    SET search_path TO 'pg_catalog', 'sport_center', 'public'
    AS $function$
    BEGIN
      IF p_date_tolerance_days IS NULL OR p_date_tolerance_days < 0 THEN
        RAISE EXCEPTION 'DATE_TOLERANCE_MUST_BE_NON_NEGATIVE';
      END IF;
      RETURN QUERY
      WITH base AS (
        SELECT b.*
          FROM sport_center.payment_settlement_batches b
          JOIN sport_center.accounting_journals sj ON sj.id = b.settlement_journal_id
           AND sj.status = 'posted' AND sj.journal_type = 'settlement'
           AND sj.is_reversal = FALSE
         WHERE b.id = p_settlement_id AND b.status IN ('posted', 'reconciled')
           AND b.bank_mutation_id IS NULL AND b.canonical_bank_mutation_id IS NULL
      ), settlement AS (
        SELECT b.*, MIN(cba.id)::integer AS resolved_bank_account_id
          FROM base b
          JOIN public.company_bank_accounts cba ON cba.company_id = b.company_id
           AND cba.is_active = TRUE
           AND (
             cba.id::text = NULLIF(BTRIM(b.bank_account_id::text), '')
             OR cba.account_number::text = NULLIF(BTRIM(b.bank_account_id::text), '')
           )
         GROUP BY b.id
        HAVING COUNT(DISTINCT cba.id) = 1
      ), evidence AS (
        SELECT s.id settlement_id, bm.id mutation_id, s.settlement_reference,
          s.settlement_date, bm.transaction_date::date mutation_date,
          s.net_amount expected_amount, bm.amount mutation_amount,
          ABS(s.net_amount - bm.amount) amount_difference,
          GREATEST(1::numeric, ABS(s.net_amount) * .001) allowed_amount_difference,
          ABS(bm.transaction_date::date - s.settlement_date)::integer date_difference_days,
          ABS(s.net_amount - bm.amount) <= GREATEST(1::numeric, ABS(s.net_amount) * .001) amount_match,
          ABS(bm.transaction_date::date - s.settlement_date) <= p_date_tolerance_days date_match,
          (bm.company_id = s.company_id) company_match,
          (bm.bank_account_id = s.resolved_bank_account_id) bank_account_match,
          (bm.provider_name IS NULL OR lower(BTRIM(bm.provider_name)) = lower(BTRIM(s.provider_code))) provider_match,
          NOT EXISTS (
            SELECT 1 FROM sport_center.payment_settlement_batches linked
             WHERE linked.bank_mutation_id = bm.id
                OR linked.canonical_bank_mutation_id = bm.id
          ) mutation_unlinked
        FROM settlement s JOIN public.bank_mutations bm
          ON bm.transaction_date::date BETWEEN s.settlement_date - p_date_tolerance_days
             AND s.settlement_date + p_date_tolerance_days
         AND lower(COALESCE(bm.direction, '')) IN ('in', 'credit', 'incoming', 'cr')
      )
      SELECT settlement_id, mutation_id, settlement_reference, settlement_date,
        mutation_date, expected_amount, mutation_amount, amount_difference,
        allowed_amount_difference, date_difference_days, amount_match, date_match,
        company_match, bank_account_match, provider_match,
        amount_match AND date_match AND company_match AND bank_account_match
          AND mutation_unlinked
      FROM evidence ORDER BY mutation_date, mutation_id;
    END;
    $function$;
  `));

  /*
   * Public-only replacement for the historical recovery owner.  Its retained
   * signature is deliberate, but a "canonical" id in its result is now the
   * same public evidence id.  Any case that cannot be proven from public
   * evidence and settlement-owned records fails closed.
   */
  await db.execute(sql.raw(`
    CREATE OR REPLACE FUNCTION sport_center.recover_posted_settlement_from_bank_mutation(
      p_settlement_id bigint,
      p_public_mutation_id integer,
      p_actor text DEFAULT 'canonical-settlement-recovery'
    )
    RETURNS TABLE (
      settlement_id bigint, public_mutation_id integer,
      canonical_mutation_id integer, match_id integer,
      old_net_amount numeric, recovered_net_amount numeric,
      adjustment_amount numeric, settlement_status text,
      public_mutation_status text, canonical_mutation_status text,
      idempotent boolean
    )
    LANGUAGE plpgsql
    SECURITY DEFINER
    SET search_path TO 'pg_catalog', 'sport_center', 'public'
    AS $function$
    DECLARE
      v_public public.bank_mutations%ROWTYPE;
      v_batch sport_center.payment_settlement_batches%ROWTYPE;
      v_journal sport_center.accounting_journals%ROWTYPE;
      v_match record;
      v_match_count integer;
      v_payment_count integer;
      v_conflict_count integer;
      v_config_count integer;
      v_account_count integer;
      v_account_id integer;
      v_match_id integer;
      v_old_net numeric;
      v_recovered_net numeric;
      v_adjustment numeric;
      v_idempotent boolean := false;
      v_actor text;
    BEGIN
      IF p_settlement_id IS NULL OR p_settlement_id <= 0
         OR p_public_mutation_id IS NULL OR p_public_mutation_id <= 0 THEN
        RAISE EXCEPTION 'CANONICAL_SETTLEMENT_RECOVERY_INVALID_ID';
      END IF;
      v_actor := NULLIF(BTRIM(p_actor), '');
      IF v_actor IS NULL THEN
        RAISE EXCEPTION 'CANONICAL_SETTLEMENT_RECOVERY_ACTOR_REQUIRED';
      END IF;
      PERFORM pg_advisory_xact_lock(hashtext(
        'public-settlement-recovery:' || p_settlement_id::text || ':' ||
        p_public_mutation_id::text
      ));
      SELECT * INTO v_public FROM public.bank_mutations
       WHERE id = p_public_mutation_id FOR UPDATE;
      IF NOT FOUND THEN
        RAISE EXCEPTION 'CANONICAL_SETTLEMENT_RECOVERY_PUBLIC_MUTATION_NOT_FOUND: %',
          p_public_mutation_id;
      END IF;
      SELECT * INTO v_batch FROM sport_center.payment_settlement_batches
       WHERE id = p_settlement_id FOR UPDATE;
      IF NOT FOUND THEN
        RAISE EXCEPTION 'CANONICAL_SETTLEMENT_RECOVERY_SETTLEMENT_NOT_FOUND: %',
          p_settlement_id;
      END IF;
      SELECT * INTO v_journal FROM sport_center.accounting_journals
       WHERE id = v_batch.settlement_journal_id FOR UPDATE;
      IF NOT FOUND OR v_journal.status <> 'posted'
         OR v_journal.journal_type <> 'settlement'
         OR v_journal.is_reversal IS DISTINCT FROM FALSE
         OR v_journal.settlement_batch_id::text IS DISTINCT FROM p_settlement_id::text THEN
        RAISE EXCEPTION 'CANONICAL_SETTLEMENT_RECOVERY_JOURNAL_NOT_ELIGIBLE: settlement=%',
          p_settlement_id;
      END IF;
      IF v_batch.company_id IS DISTINCT FROM v_public.company_id
         OR v_public.transaction_date IS NULL OR v_public.amount IS NULL
         OR v_public.amount <= 0
         OR lower(COALESCE(v_public.direction, '')) NOT IN ('in','credit','incoming','cr')
         OR ABS(v_public.transaction_date::date - v_batch.settlement_date) > 1
         OR v_public.amount > v_batch.gross_amount
         OR v_public.journal_entry_id IS NOT NULL THEN
        RAISE EXCEPTION 'CANONICAL_SETTLEMENT_RECOVERY_BANK_EVIDENCE_INVALID: mutation=%',
          p_public_mutation_id;
      END IF;

      -- Resolve the external settlement account before comparing it with the
      -- public mutation's internal company_bank_accounts id.
      SELECT COUNT(*)::integer, MIN(cba.id) INTO v_account_count, v_account_id
        FROM public.company_bank_accounts cba
       WHERE cba.company_id = v_batch.company_id AND cba.is_active = TRUE
         AND (cba.id::text = NULLIF(BTRIM(v_batch.bank_account_id::text), '')
           OR cba.account_number::text =
              NULLIF(BTRIM(v_batch.bank_account_id::text), ''));
      IF v_account_count <> 1 OR v_account_id IS NULL
         OR (v_public.bank_account_id IS NOT NULL
             AND v_public.bank_account_id <> v_account_id) THEN
        RAISE EXCEPTION 'CANONICAL_SETTLEMENT_RECOVERY_BANK_ACCOUNT_MISMATCH: settlement=% mutation=%',
          p_settlement_id, p_public_mutation_id;
      END IF;
       SELECT COUNT(*)::integer INTO v_config_count
         FROM sport_center.payment_settlement_configs psc
         JOIN public.company_bank_accounts config_account
           ON config_account.company_id = psc.company_id
          AND config_account.is_active = TRUE
          AND config_account.account_number::text = BTRIM(psc.bank_account_id)
       WHERE psc.company_id = v_batch.company_id
         AND lower(BTRIM(psc.provider_code)) = lower(BTRIM(v_batch.provider_code))
          AND config_account.id = v_account_id
         AND psc.is_active AND psc.source = 'OWNER_APPROVED'
         AND psc.effective_from <= v_batch.settlement_date
         AND (psc.effective_until IS NULL
              OR v_batch.settlement_date < psc.effective_until);
      IF v_config_count <> 1 THEN
        RAISE EXCEPTION 'CANONICAL_SETTLEMENT_RECOVERY_CONFIG_INVALID: settlement=%',
          p_settlement_id;
      END IF;
      PERFORM 1 FROM sport_center.payment_settlement_items
       WHERE settlement_id = p_settlement_id AND item_status = 'active' FOR UPDATE;
      SELECT COUNT(*)::integer INTO v_payment_count
        FROM sport_center.payment_settlement_items
       WHERE settlement_id = p_settlement_id AND item_status = 'active';
      IF v_payment_count = 0 THEN
        RAISE EXCEPTION 'CANONICAL_SETTLEMENT_RECOVERY_ACTIVE_ITEMS_REQUIRED: settlement=%',
          p_settlement_id;
      END IF;
      SELECT COUNT(DISTINCT other_item.settlement_id)::integer INTO v_conflict_count
        FROM sport_center.payment_settlement_items item
        JOIN sport_center.payment_settlement_items other_item
          ON other_item.payment_id = item.payment_id
         AND other_item.item_status = 'active'
         AND other_item.settlement_id <> p_settlement_id
       WHERE item.settlement_id = p_settlement_id AND item.item_status = 'active';
      IF v_conflict_count <> 0 THEN
        RAISE EXCEPTION 'CANONICAL_SETTLEMENT_RECOVERY_PAYMENT_ALREADY_SETTLED: settlement=%',
          p_settlement_id;
      END IF;
      SELECT COUNT(*)::integer INTO v_conflict_count
        FROM sport_center.payment_settlement_batches
       WHERE id <> p_settlement_id
         AND (bank_mutation_id = p_public_mutation_id
              OR canonical_bank_mutation_id = p_public_mutation_id);
      IF v_conflict_count <> 0 THEN
        RAISE EXCEPTION 'CANONICAL_SETTLEMENT_RECOVERY_MUTATION_ALREADY_LINKED: mutation=%',
          p_public_mutation_id;
      END IF;
      SELECT COUNT(*)::integer INTO v_match_count
        FROM public.bank_reconciliation_matches
       WHERE mutation_id = p_public_mutation_id AND status IN ('candidate','approved');
      IF v_match_count > 1 THEN
        RAISE EXCEPTION 'CANONICAL_SETTLEMENT_RECOVERY_MULTIPLE_ACTIVE_MATCHES: mutation=%',
          p_public_mutation_id;
      END IF;
      SELECT * INTO v_match FROM public.bank_reconciliation_matches
       WHERE mutation_id = p_public_mutation_id AND status IN ('candidate','approved')
       ORDER BY id LIMIT 1 FOR UPDATE;
      IF FOUND AND (v_match.candidate_type <> 'qris_settlement'
         OR v_match.candidate_id::text <> p_settlement_id::text
         OR v_match.candidate_source <> 'sport_center.payment_settlement_batches') THEN
        RAISE EXCEPTION 'CANONICAL_SETTLEMENT_RECOVERY_MATCH_CONFLICT: mutation=%',
          p_public_mutation_id;
      END IF;
      v_old_net := v_batch.net_amount;
      v_recovered_net := ROUND(v_public.amount::numeric, 2);
      v_adjustment := ROUND(v_recovered_net - ROUND((
        v_batch.gross_amount - v_batch.mdr_amount - v_batch.provider_fee_amount
        - v_batch.fee_tax_amount - v_batch.tax_withheld_amount
      )::numeric, 2), 2);
      IF v_batch.status = 'reconciled'
         AND v_batch.bank_mutation_id = p_public_mutation_id
         AND v_batch.canonical_bank_mutation_id = p_public_mutation_id
         AND v_public.status = 'approved' AND v_match.id IS NOT NULL
         AND v_match.status = 'approved' THEN
        v_idempotent := true;
        v_match_id := v_match.id;
        v_recovered_net := v_batch.net_amount;
        v_adjustment := v_batch.adjustment_amount;
      ELSE
        IF v_batch.status <> 'posted' OR v_batch.bank_mutation_id IS NOT NULL
           OR v_batch.canonical_bank_mutation_id IS NOT NULL
           OR v_public.status <> 'unmatched' THEN
          RAISE EXCEPTION 'CANONICAL_SETTLEMENT_RECOVERY_STATE_NOT_RECOVERABLE: settlement=%',
            p_settlement_id;
        END IF;
        UPDATE sport_center.payment_settlement_batches
           SET net_amount = v_recovered_net, adjustment_amount = v_adjustment,
               bank_mutation_id = p_public_mutation_id,
               canonical_bank_mutation_id = p_public_mutation_id,
               status = 'reconciled', reconciled_at = NOW(), reconciled_by = v_actor,
               updated_at = NOW()
         WHERE id = p_settlement_id AND status = 'posted'
           AND bank_mutation_id IS NULL AND canonical_bank_mutation_id IS NULL;
        IF NOT FOUND THEN RAISE EXCEPTION 'CANONICAL_SETTLEMENT_RECOVERY_STATE_CHANGED'; END IF;
        UPDATE public.bank_mutations SET status = 'approved', approved_by = v_actor,
          approved_at = NOW(), updated_at = NOW()
         WHERE id = p_public_mutation_id AND status = 'unmatched';
        IF NOT FOUND THEN RAISE EXCEPTION 'CANONICAL_SETTLEMENT_RECOVERY_PUBLIC_STATE_CHANGED'; END IF;
        IF v_match.id IS NULL THEN
          INSERT INTO public.bank_reconciliation_matches (
            mutation_id, candidate_type, candidate_id, match_score, match_reason,
            amount_match, date_match, name_match, order_id_match, proof_match,
            status, candidate_source
          ) VALUES (p_public_mutation_id, 'qris_settlement', p_settlement_id::integer,
            100, 'OWNER_RECOVERY_NET_CORRECTION', TRUE, TRUE, FALSE, FALSE, FALSE,
            'approved', 'sport_center.payment_settlement_batches')
          RETURNING id INTO v_match_id;
        ELSE
          UPDATE public.bank_reconciliation_matches SET status = 'approved',
            match_score = 100, match_reason = 'OWNER_RECOVERY_NET_CORRECTION',
            amount_match = TRUE, date_match = TRUE WHERE id = v_match.id;
          v_match_id := v_match.id;
        END IF;
      END IF;
      INSERT INTO public.bank_reconciliation_audit (mutation_id, action, actor, meta)
      VALUES (p_public_mutation_id, 'CANONICAL_SETTLEMENT_OWNER_RECOVERY', v_actor,
        jsonb_build_object('settlement_id', p_settlement_id,
          'public_mutation_id', p_public_mutation_id, 'match_id', v_match_id,
          'old_net_amount', v_old_net, 'recovered_net_amount', v_recovered_net,
          'adjustment_amount', v_adjustment, 'idempotent', v_idempotent));
      settlement_id := p_settlement_id; public_mutation_id := p_public_mutation_id;
      canonical_mutation_id := p_public_mutation_id; match_id := v_match_id;
      old_net_amount := v_old_net; recovered_net_amount := v_recovered_net;
      adjustment_amount := v_adjustment; settlement_status := 'reconciled';
      public_mutation_status := 'approved'; canonical_mutation_status := 'approved';
      idempotent := v_idempotent; RETURN NEXT;
    END;
    $function$;
  `));

  /*
   * Recover only posted settlements whose payment identity is unambiguous.
   * Batches without exactly one active payment stay unlinked rather than
   * inventing a bank mutation or altering their posted journal.
   */
  const canonicalRepairCandidates = await db.execute(sql`
    SELECT batch.id
      FROM sport_center.payment_settlement_batches AS batch
      JOIN sport_center.payment_settlement_items AS item
        ON item.settlement_id = batch.id
       AND item.item_status = 'active'
     WHERE batch.status = 'posted'
       AND batch.bank_mutation_id IS NULL
       AND batch.canonical_bank_mutation_id IS NULL
     GROUP BY batch.id
    HAVING COUNT(*) = 1
  `);
  for (const row of canonicalRepairCandidates.rows) {
    const settlementId = Number(row.id);
    if (!Number.isSafeInteger(settlementId) || settlementId <= 0) continue;
    try {
      await db.execute(sql`
        SELECT sport_center.ensure_canonical_bank_mutation_for_settlement(
          ${settlementId}::bigint,
          'startup-canonical-link-repair'
        )
      `);
    } catch (error) {
      // A legacy posted journal with incomplete historical evidence must not
      // block all portal traffic. Its invalid link was already removed before
      // the FK was installed, and a later governed repair can supply evidence.
      logger.warn(
        { settlementId, error },
        "Skipped canonical mutation recovery for legacy settlement without resolvable evidence",
      );
    }
  }

  logger.info(
    "Canonical Sport Center contracts: settlement owner, deterministic grouping, 4C-7N bridge, and CF-SC-10B mutation handoff aktif",
  );
}

const REQUIRED_CANONICAL_SETTLEMENT_ROUTINES = [
  ["resolve_internal_bank_account_id", "integer, text"],
  ["canonical_settlement_group_identity", "integer, text, text, date, text"],
  ["mark_settlement_payments_settled", "bigint, text"],
  ["create_payment_settlement_batch", "text, integer, text, text, date, integer[], text"],
  ["finalize_payment_settlement", "bigint, text"],
  ["recover_posted_settlement_from_bank_mutation", "bigint, integer, text"],
  ["find_settlement_bank_candidates", "bigint, integer"],
] as const;

/**
 * Verify the exact owner-routine signatures after the additive migration.
 *
 * This is intentionally separate from provisioning so a migration caller must
 * prove the live catalog before reporting success.  It only reads pg_catalog.
 */
export async function verifyCanonicalSettlementOwnerRoutines(): Promise<void> {
  const result = await db.execute(sql`
    SELECT p.proname AS routine_name,
           COALESCE(
             string_agg(
               format_type(argument.oid, NULL),
               ', ' ORDER BY argument.ordinality
             ),
             ''
           ) AS identity_arguments
    FROM pg_catalog.pg_proc p
    JOIN pg_catalog.pg_namespace n ON n.oid = p.pronamespace
    LEFT JOIN LATERAL unnest(p.proargtypes)
      WITH ORDINALITY AS argument(oid, ordinality) ON TRUE
    WHERE n.nspname = 'sport_center'
      AND p.proname IN (
        ${sql.join(
          REQUIRED_CANONICAL_SETTLEMENT_ROUTINES.map(([name]) => sql`${name}`),
          sql`, `,
        )}
      )
    GROUP BY p.oid, p.proname
  `);
  const present = new Set(
    result.rows.map((row) => {
      const item = row as { routine_name: string; identity_arguments: string };
      return `${item.routine_name}(${item.identity_arguments})`;
    }),
  );
  const missing = REQUIRED_CANONICAL_SETTLEMENT_ROUTINES
    .map(([name, args]) => `${name}(${args})`)
    .filter((signature) => !present.has(signature));
  if (missing.length > 0) {
    throw new Error(
      `CANONICAL_SETTLEMENT_OWNER_ROUTINES_INCOMPLETE: missing ${missing.join(", ")}`,
    );
  }

  /*
   * The legacy batch owner was intentionally retained for compatibility, but
   * it originally summed only the payment_confirmed header.  Amount repair is
   * additive and therefore needs the legacy owner to consume its posted
   * payment_amount_correction row as well.  Patch the live legacy definition
   * once, without mutating any posted journal.
   */
  const legacyBatchDefinition = await db.execute(sql`
    SELECT pg_get_functiondef(
      'sport_center.create_payment_settlement_batch_legacy(
        text,integer,text,text,date,integer[],text
      )'::regprocedure
    ) AS definition
  `);
  const legacyDefinition = String(
    (legacyBatchDefinition.rows[0] as { definition?: unknown } | undefined)
      ?.definition ?? "",
  );
  if (legacyDefinition && !legacyDefinition.includes("payment_amount_correction")) {
    const correctionGrossExpression = `j.gross_amount + COALESCE((
          SELECT SUM(
            CASE WHEN c.is_reversal THEN -c.gross_amount ELSE c.gross_amount END
          )
          FROM sport_center.accounting_journals c
          WHERE c.payment_id = j.payment_id
            AND c.journal_type = 'payment_amount_correction'
            AND c.is_reversal = false
            AND c.status = 'posted'
            AND c.reversal_of_id = j.id
        ), 0)`;
    const patchedLegacyDefinition = legacyDefinition
      .replace(
        "SUM(j.gross_amount)::numeric",
        `SUM(${correctionGrossExpression})::numeric`,
      )
      .replace(
        /^\s*j\.gross_amount,\s*$/m,
        `        ${correctionGrossExpression},`,
      );
    if (patchedLegacyDefinition === legacyDefinition) {
      throw new Error(
        "CANONICAL_SETTLEMENT_LEGACY_OWNER_PATCH_TARGET_NOT_FOUND",
      );
    }
    await db.execute(sql.raw(patchedLegacyDefinition));
  }
}

/**
 * Additive repair owner for production databases that already completed the
 * Sport Center bootstrap before the canonical payment handoff was installed.
 *
 * This stage is deliberately independent from the large bootstrap marker:
 * existing environments must receive the owner without replaying legacy data
 * cleanup or synchronization.
 */
export async function ensureSportCenterLegacyPaymentRecoveryOwner(): Promise<void> {
  await db.execute(sql.raw(`
    CREATE OR REPLACE FUNCTION sport_center.recover_payment_accounting_draft(
      p_payment_id integer,
      p_public_entry_id integer
    )
    RETURNS integer
    LANGUAGE plpgsql
    SECURITY DEFINER
    SET search_path TO 'pg_catalog', 'sport_center', 'public'
    AS $function$
    DECLARE
      v_payment sport_center.sport_payments%ROWTYPE;
      v_booking sport_center.sport_bookings%ROWTYPE;
      v_entry record;
      v_mirror record;
      v_match_count integer;
      v_mirror_count integer;
      v_line_count integer;
      v_debit_count integer;
      v_credit_count integer;
      v_debit_total numeric;
      v_credit_total numeric;
      v_payment_amount numeric(18,2);
      v_dpp numeric(18,2);
      v_tax numeric(18,2);
      v_bank_count integer;
      v_bank_id integer;
      v_journal_id integer;
      v_public_payment_id integer;
      v_journal_date text;
      v_payment_method text;
      v_payment_provider text;
      v_debit_account_code text;
      v_debit_account_name text;
      v_source_event_id uuid;
      v_external_bank_account_id text;
    BEGIN
      IF p_payment_id IS NULL OR p_payment_id <= 0
         OR p_public_entry_id IS NULL OR p_public_entry_id <= 0
      THEN
        RAISE EXCEPTION 'LEGACY_PUBLIC_RECOVERY_INVALID_INPUT';
      END IF;

      SELECT *
        INTO v_payment
        FROM sport_center.sport_payments
       WHERE id = p_payment_id
       FOR UPDATE;

      IF NOT FOUND OR v_payment.status::text <> 'confirmed' THEN
        RAISE EXCEPTION
          'LEGACY_PUBLIC_RECOVERY_PAYMENT_NOT_CONFIRMED: payment=%',
          p_payment_id;
      END IF;

      SELECT *
        INTO v_booking
        FROM sport_center.sport_bookings
       WHERE id = v_payment.booking_id
       FOR UPDATE;

      IF NOT FOUND THEN
        RAISE EXCEPTION
          'LEGACY_PUBLIC_RECOVERY_BOOKING_NOT_FOUND: payment=% booking=%',
          p_payment_id, v_payment.booking_id;
      END IF;

      SELECT
        ae.id,
        ae.journal_id,
        ae.company_id,
        ae.date,
        ae.ref,
        ae.description,
        ae.payment_method,
        ae.payment_provider,
        ae.bank_account_id,
        ae.status::text AS status,
        ae.source::text AS source,
        ae.source_id,
        ae.source_payment_id,
        ae.total_debit,
        ae.total_credit
        INTO v_entry
        FROM public.accounting_entries ae
       WHERE ae.id = p_public_entry_id
       FOR UPDATE;

      IF NOT FOUND THEN
        RAISE EXCEPTION
          'LEGACY_PUBLIC_RECOVERY_ENTRY_NOT_FOUND: payment=% entry=%',
          p_payment_id, p_public_entry_id;
      END IF;

      SELECT COUNT(DISTINCT ae.id)::integer
        INTO v_match_count
        FROM public.accounting_entries ae
       WHERE ae.source_payment_id = p_payment_id
          OR (
            ae.source::text = 'sport_center_payment'
            AND ae.source_id = p_payment_id
          );

      IF v_match_count <> 1
         OR v_entry.status <> 'posted'
         OR (
           COALESCE(v_entry.source_payment_id, -1) <> p_payment_id
           AND NOT (
             v_entry.source = 'sport_center_payment'
             AND v_entry.source_id = p_payment_id
           )
         )
         OR ABS(COALESCE(v_entry.total_debit, -1) - ROUND(v_payment.amount::numeric, 2)) > 0.01
         OR ABS(COALESCE(v_entry.total_credit, -1) - ROUND(v_payment.amount::numeric, 2)) > 0.01
      THEN
        RAISE EXCEPTION
          'LEGACY_PUBLIC_RECOVERY_ENTRY_MISMATCH: payment=% entry=% matches=%',
          p_payment_id, p_public_entry_id, v_match_count;
      END IF;

      IF EXISTS (
        SELECT 1
          FROM public.accounting_payments ap
         WHERE ap.entry_id = p_public_entry_id
            OR (
              ap.source_type = 'sport_center'
              AND ap.source_doc_id = p_public_entry_id
            )
      ) THEN
        RAISE EXCEPTION
          'LEGACY_PUBLIC_RECOVERY_ENTRY_ALREADY_LINKED: payment=% entry=%',
          p_payment_id, p_public_entry_id;
      END IF;

      v_payment_amount := ROUND(v_payment.amount::numeric, 2);
      v_dpp := CASE
        WHEN COALESCE(v_booking.ppn_rate, 0) > 0
        THEN ROUND(v_payment_amount / (1 + (v_booking.ppn_rate / 100)), 2)
        ELSE v_payment_amount
      END;
      v_tax := v_payment_amount - v_dpp;

      SELECT
        COUNT(*)::integer,
        COUNT(*) FILTER (WHERE ael.debit > 0)::integer,
        COUNT(*) FILTER (WHERE ael.credit > 0)::integer,
        ROUND(COALESCE(SUM(ael.debit), 0), 2),
        ROUND(COALESCE(SUM(ael.credit), 0), 2)
        INTO
          v_line_count,
          v_debit_count,
          v_credit_count,
          v_debit_total,
          v_credit_total
        FROM public.accounting_entry_lines ael
       WHERE ael.entry_id = p_public_entry_id;

      IF v_line_count <> (CASE WHEN v_tax > 0 THEN 3 ELSE 2 END)
         OR v_debit_count <> 1
         OR v_credit_count <> (CASE WHEN v_tax > 0 THEN 2 ELSE 1 END)
         OR ABS(v_debit_total - v_payment_amount) > 0.01
         OR ABS(v_credit_total - v_payment_amount) > 0.01
      THEN
        RAISE EXCEPTION
          'LEGACY_PUBLIC_RECOVERY_LINES_MISMATCH: payment=% entry=%',
          p_payment_id, p_public_entry_id;
      END IF;

      SELECT COUNT(*)::integer
        INTO v_mirror_count
        FROM public.sport_payments sp
       WHERE sp.source_payment_id = p_payment_id;

      IF v_mirror_count <> 1 THEN
        RAISE EXCEPTION
          'LEGACY_PUBLIC_RECOVERY_MIRROR_AMBIGUOUS: payment=% matches=%',
          p_payment_id, v_mirror_count;
      END IF;

      SELECT sp.*
        INTO v_mirror
        FROM public.sport_payments sp
       WHERE sp.source_payment_id = p_payment_id
       FOR UPDATE;

      IF v_mirror.posting_status <> 'posted'
         OR v_mirror.company_id IS DISTINCT FROM v_payment.company_id
         OR ABS(COALESCE(v_mirror.amount, -1) - v_payment_amount) > 0.01
      THEN
        RAISE EXCEPTION
          'LEGACY_PUBLIC_RECOVERY_MIRROR_MISMATCH: payment=%',
          p_payment_id;
      END IF;

      v_external_bank_account_id := COALESCE(
        NULLIF(BTRIM(v_mirror.external_bank_account_id::text), ''),
        NULLIF(BTRIM(v_payment.bank_account_id::text), '')
      );

      IF v_external_bank_account_id IS NULL THEN
        RAISE EXCEPTION
          'LEGACY_PUBLIC_RECOVERY_BANK_UNRESOLVED: payment=% has no bank identity',
          p_payment_id;
      END IF;

      SELECT COUNT(*)::integer, MIN(cba.id)
        INTO v_bank_count, v_bank_id
        FROM public.company_bank_accounts cba
       WHERE cba.company_id = v_payment.company_id
         AND cba.is_active = TRUE
         AND (
           cba.account_number::text = v_external_bank_account_id
           OR cba.id::text = v_external_bank_account_id
         );

      IF v_bank_count <> 1 OR v_bank_id IS NULL THEN
        RAISE EXCEPTION
          'LEGACY_PUBLIC_RECOVERY_BANK_UNRESOLVED: payment=% account=% matches=%',
          p_payment_id, v_external_bank_account_id, v_bank_count;
      END IF;

      v_payment_method := COALESCE(NULLIF(BTRIM(v_payment.payment_method::text), ''), 'Unknown');
      v_payment_provider := NULLIF(BTRIM(v_payment.payment_provider::text), '');
      v_debit_account_code := CASE
        WHEN LOWER(v_payment_method) LIKE '%qris%' OR v_payment_provider IS NOT NULL
        THEN 'PAYMENT_CLEARING'
        WHEN LOWER(v_payment_method) LIKE '%cash%' OR LOWER(v_payment_method) LIKE '%tunai%'
        THEN 'CASH'
        ELSE 'BANK_RECEIPT'
      END;
      v_debit_account_name := CASE v_debit_account_code
        WHEN 'PAYMENT_CLEARING' THEN 'Payment Clearing'
        WHEN 'CASH' THEN 'Kas'
        ELSE 'Bank / Kas Masuk'
      END;
      v_journal_date := COALESCE(
        v_payment.paid_at,
        v_payment.confirmed_at,
        v_payment.created_at,
        now()
      )::date::text;
      v_source_event_id := gen_random_uuid();

      INSERT INTO sport_center.accounting_journals
      (
        booking_id, payment_id, company_id, order_number,
        journal_type, status,
        debit_account, debit_amount,
        credit_revenue_account, credit_revenue_amount,
        credit_ppn_account, credit_ppn_amount,
        journal_date, payment_method, payment_provider,
        payment_type, bank_account_id,
        gross_amount, dpp_amount, tax_amount,
        provider_reference, provider_order_id, merchant_trade_no,
        provider_trade_no, source_schema, source_table, source_id,
        source_event_id, correlation_id, is_reversal, notes, created_by
      )
      VALUES
      (
        v_payment.booking_id, p_payment_id, v_payment.company_id,
        v_booking.order_number, 'payment_confirmed', 'draft',
        v_debit_account_name, v_payment_amount,
        'Pendapatan Sport Center', v_dpp,
        'PPN Keluaran', v_tax,
        v_journal_date, v_payment_method, v_payment_provider,
        COALESCE(v_payment.payment_type::text, 'full_payment'), v_bank_id,
        v_payment_amount, v_dpp, v_tax,
        v_payment.provider_reference, v_payment.provider_order_id,
        v_payment.merchant_trade_no, v_payment.provider_trade_no,
        'sport_center', 'sport_payments', p_payment_id::text,
        v_source_event_id, v_source_event_id, false,
        'Recovered from exact posted legacy public entry ' || p_public_entry_id::text,
        'canonical-recovery'
      )
      RETURNING id INTO v_journal_id;

      INSERT INTO sport_center.accounting_journal_lines
        (journal_id, line_type, account_code, account_name, amount, description)
      VALUES
        (v_journal_id, 'debit', v_debit_account_code, v_debit_account_name,
         v_payment_amount, v_debit_account_name || ' - ' || v_booking.order_number),
        (v_journal_id, 'credit', 'REVENUE', 'Pendapatan Sport Center',
         v_dpp, 'Pendapatan - ' || v_booking.order_number);

      IF v_tax > 0 THEN
        INSERT INTO sport_center.accounting_journal_lines
          (journal_id, line_type, account_code, account_name, amount, description)
        VALUES
          (v_journal_id, 'credit', 'PPN_OUTPUT', 'PPN Keluaran',
           v_tax, 'PPN Keluaran - ' || v_booking.order_number);
      END IF;

      PERFORM sport_center.validate_accounting_journal(v_journal_id);

      INSERT INTO public.accounting_payments
      (
        company_id, payment_number, payment_type, status, amount,
        journal_id, date, ref, memo, payment_method, payment_provider,
        entry_id, source_type, source_doc_id, created_by_id,
        source_schema, source_module, posted_at
      )
      VALUES
      (
        v_payment.company_id, v_mirror.payment_number, 'inbound', 'posted',
        v_payment_amount, v_entry.journal_id, v_entry.date, v_entry.ref,
        v_entry.description, v_payment_method, v_payment_provider,
        p_public_entry_id, 'sport_center', v_mirror.id, 'canonical-recovery',
        'sport_center', 'sport_center_payment', now()
      )
      RETURNING id INTO v_public_payment_id;

      UPDATE public.sport_payments
         SET accounting_payment_id = v_public_payment_id,
             posting_status = 'posted',
             posting_error = NULL,
             updated_at = now()
       WHERE id = v_mirror.id;

      RETURN v_journal_id;
    END;
    $function$
  `));
}

const SPORT_CENTER_BOOTSTRAP_VERSION = "schema-bootstrap-v3";

export async function runSportCenterMigration(): Promise<void> {
  if (await isStartupMigrationComplete("sport_center_bootstrap", SPORT_CENTER_BOOTSTRAP_VERSION)) {
    logger.info("Sport Center bootstrap already provisioned; startup schema/data sync skipped");
    return;
  }

  try {
    await db.execute(sql`
      CREATE TABLE IF NOT EXISTS sport_facilities (
        id SERIAL PRIMARY KEY,
        company_id INTEGER,
        name TEXT NOT NULL,
        type TEXT NOT NULL DEFAULT 'court',
        description TEXT,
        capacity INTEGER DEFAULT 1,
        price_per_hour NUMERIC(14,2) NOT NULL DEFAULT 0,
        is_active BOOLEAN NOT NULL DEFAULT TRUE,
        image_url TEXT,
        sort_order INTEGER NOT NULL DEFAULT 0,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );

      CREATE TABLE IF NOT EXISTS sport_customers (
        id SERIAL PRIMARY KEY,
        company_id INTEGER,
        name TEXT NOT NULL,
        email TEXT,
        phone TEXT,
        address TEXT,
        notes TEXT,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );

      CREATE TABLE IF NOT EXISTS sport_members (
        id SERIAL PRIMARY KEY,
        company_id INTEGER,
        customer_id INTEGER REFERENCES sport_customers(id),
        name TEXT NOT NULL,
        email TEXT,
        phone TEXT,
        member_type TEXT NOT NULL DEFAULT 'gym',
        member_number TEXT,
        start_date DATE NOT NULL,
        end_date DATE,
        status TEXT NOT NULL DEFAULT 'active',
        notes TEXT,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );

      CREATE TABLE IF NOT EXISTS sport_pricing_rules (
        id SERIAL PRIMARY KEY,
        company_id INTEGER,
        facility_id INTEGER REFERENCES sport_facilities(id) ON DELETE CASCADE,
        name TEXT NOT NULL,
        day_type TEXT NOT NULL DEFAULT 'all',
        time_start TIME,
        time_end TIME,
        price_per_hour NUMERIC(14,2) NOT NULL,
        is_active BOOLEAN NOT NULL DEFAULT TRUE,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );

      CREATE TABLE IF NOT EXISTS sport_promos (
        id SERIAL PRIMARY KEY,
        company_id INTEGER,
        code TEXT NOT NULL,
        name TEXT NOT NULL,
        description TEXT,
        discount_type TEXT NOT NULL DEFAULT 'percent',
        discount_value NUMERIC(14,2) NOT NULL DEFAULT 0,
        min_amount NUMERIC(14,2) DEFAULT 0,
        max_uses INTEGER,
        used_count INTEGER NOT NULL DEFAULT 0,
        valid_from TIMESTAMPTZ,
        valid_until TIMESTAMPTZ,
        is_active BOOLEAN NOT NULL DEFAULT TRUE,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );

      CREATE TABLE IF NOT EXISTS sport_bookings (
        id SERIAL PRIMARY KEY,
        company_id INTEGER,
        booking_number TEXT NOT NULL,
        customer_id INTEGER REFERENCES sport_customers(id),
        customer_name TEXT NOT NULL,
        customer_phone TEXT,
        facility_id INTEGER REFERENCES sport_facilities(id),
        facility_name TEXT NOT NULL,
        booking_date DATE NOT NULL,
        start_time TIME NOT NULL,
        end_time TIME NOT NULL,
        duration_hours NUMERIC(5,2) NOT NULL DEFAULT 1,
        status TEXT NOT NULL DEFAULT 'pending',
        payment_status TEXT NOT NULL DEFAULT 'unpaid',
        base_amount NUMERIC(14,2) NOT NULL DEFAULT 0,
        discount_amount NUMERIC(14,2) NOT NULL DEFAULT 0,
        total_amount NUMERIC(14,2) NOT NULL DEFAULT 0,
        promo_id INTEGER REFERENCES sport_promos(id),
        promo_code TEXT,
        notes TEXT,
        checked_in_at TIMESTAMPTZ,
        checked_in_by TEXT,
        cancelled_at TIMESTAMPTZ,
        cancelled_reason TEXT,
        created_by TEXT,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );

      CREATE TABLE IF NOT EXISTS sport_payments (
        id SERIAL PRIMARY KEY,
        company_id INTEGER,
        booking_id INTEGER REFERENCES sport_bookings(id) ON DELETE CASCADE,
        payment_number TEXT NOT NULL,
        amount NUMERIC(14,2) NOT NULL,
        method TEXT NOT NULL DEFAULT 'cash',
        status TEXT NOT NULL DEFAULT 'pending',
        paid_at TIMESTAMPTZ,
        notes TEXT,
        created_by TEXT,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );

      CREATE TABLE IF NOT EXISTS sport_blocked_schedules (
        id SERIAL PRIMARY KEY,
        company_id INTEGER,
        facility_id INTEGER REFERENCES sport_facilities(id) ON DELETE CASCADE,
        block_date DATE NOT NULL,
        start_time TIME NOT NULL,
        end_time TIME NOT NULL,
        reason TEXT,
        created_by TEXT,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );

      CREATE TABLE IF NOT EXISTS sport_notifications (
        id SERIAL PRIMARY KEY,
        company_id INTEGER,
        type TEXT NOT NULL,
        title TEXT NOT NULL,
        message TEXT NOT NULL,
        entity_type TEXT,
        entity_id INTEGER,
        is_read BOOLEAN NOT NULL DEFAULT FALSE,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );

      CREATE TABLE IF NOT EXISTS sport_audit_logs (
        id SERIAL PRIMARY KEY,
        company_id INTEGER,
        entity_type TEXT NOT NULL,
        entity_id INTEGER,
        action TEXT NOT NULL,
        actor TEXT,
        old_data JSONB,
        new_data JSONB,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );

      CREATE TABLE IF NOT EXISTS sport_settings (
        id SERIAL PRIMARY KEY,
        company_id INTEGER UNIQUE,
        center_name TEXT NOT NULL DEFAULT 'Sport Center',
        address TEXT,
        phone TEXT,
        open_time TIME DEFAULT '06:00',
        close_time TIME DEFAULT '22:00',
        booking_advance_days INTEGER DEFAULT 30,
        min_booking_hours NUMERIC(5,2) DEFAULT 1,
        cancellation_hours INTEGER DEFAULT 2,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );
    `);

    await db.execute(sql`
      CREATE TABLE IF NOT EXISTS sport_refunds (
        id SERIAL PRIMARY KEY,
        company_id INTEGER,
        booking_id INTEGER NOT NULL REFERENCES sport_bookings(id) ON DELETE CASCADE,
        payment_id INTEGER REFERENCES sport_payments(id) ON DELETE SET NULL,
        customer_id INTEGER REFERENCES sport_customers(id) ON DELETE SET NULL,
        refund_number TEXT NOT NULL UNIQUE,
        refund_amount NUMERIC(14,2) NOT NULL,
        refund_reason TEXT,
        status TEXT NOT NULL DEFAULT 'pending',
        processed_by TEXT,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );
    `);

    await db.execute(sql`
      CREATE INDEX IF NOT EXISTS idx_sport_bookings_date ON sport_bookings(booking_date);
      CREATE INDEX IF NOT EXISTS idx_sport_bookings_facility ON sport_bookings(facility_id);
      CREATE INDEX IF NOT EXISTS idx_sport_bookings_status ON sport_bookings(status);
      CREATE INDEX IF NOT EXISTS idx_sport_bookings_company ON sport_bookings(company_id);
      CREATE INDEX IF NOT EXISTS idx_sport_members_type ON sport_members(member_type);
      CREATE INDEX IF NOT EXISTS idx_sport_notifications_read ON sport_notifications(is_read);
      CREATE INDEX IF NOT EXISTS idx_sport_refunds_booking ON sport_refunds(booking_id);
      CREATE INDEX IF NOT EXISTS idx_sport_refunds_status ON sport_refunds(status);
    `);

    // UNIQUE constraint on booking_number — required for ON CONFLICT (booking_number) upsert.
    // Step 1: remove duplicate rows first (keep the row with the highest id per booking_number).
    await db.execute(sql`
      DELETE FROM sport_bookings a
      USING sport_bookings b
      WHERE a.id < b.id
        AND a.booking_number = b.booking_number;
    `);
    // Step 2: add constraint idempotently (safe after dedup above).
    await db.execute(sql`
      DO $$
      BEGIN
        IF NOT EXISTS (
          SELECT 1 FROM pg_constraint
          WHERE conrelid = 'sport_bookings'::regclass
            AND contype   = 'u'
            AND conname   = 'sport_bookings_booking_number_key'
        ) THEN
          ALTER TABLE sport_bookings
            ADD CONSTRAINT sport_bookings_booking_number_key UNIQUE (booking_number);
        END IF;
      END $$;
    `);

    // Tambahkan kolom baru ke sport_payments (idempoten)
    await db.execute(sql`
      ALTER TABLE sport_payments
        ADD COLUMN IF NOT EXISTS payment_type TEXT NOT NULL DEFAULT 'booking',
        ADD COLUMN IF NOT EXISTS member_id INTEGER,
        ADD COLUMN IF NOT EXISTS customer_id INTEGER
    `);

    // Fase 3: kolom pajak/PPN pada sport_bookings dan sport_payments (idempoten)
    await db.execute(sql`
      ALTER TABLE sport_bookings
        ADD COLUMN IF NOT EXISTS tax_rate    NUMERIC(5,2)  NOT NULL DEFAULT 0,
        ADD COLUMN IF NOT EXISTS tax_amount  NUMERIC(14,2) NOT NULL DEFAULT 0
    `);
    await db.execute(sql`
      ALTER TABLE sport_payments
        ADD COLUMN IF NOT EXISTS tax_rate    NUMERIC(5,2)  NOT NULL DEFAULT 0,
        ADD COLUMN IF NOT EXISTS tax_amount  NUMERIC(14,2) NOT NULL DEFAULT 0
    `);
    // QRIS settlement detail. `amount` remains the gross customer payment;
    // net_amount is the expected bank settlement after MDR.
    await db.execute(sql`
      ALTER TABLE sport_payments
        ADD COLUMN IF NOT EXISTS mdr_rate             NUMERIC(7,4)  NOT NULL DEFAULT 0,
        ADD COLUMN IF NOT EXISTS mdr_amount           NUMERIC(14,2) NOT NULL DEFAULT 0,
        ADD COLUMN IF NOT EXISTS tax_withheld_amount  NUMERIC(14,2) NOT NULL DEFAULT 0,
        ADD COLUMN IF NOT EXISTS other_fee_amount     NUMERIC(14,2) NOT NULL DEFAULT 0,
        ADD COLUMN IF NOT EXISTS net_amount           NUMERIC(14,2) NOT NULL DEFAULT 0,
        ADD COLUMN IF NOT EXISTS settlement_reference TEXT,
        ADD COLUMN IF NOT EXISTS settlement_date      DATE,
        ADD COLUMN IF NOT EXISTS settlement_rule_version TEXT,
        ADD COLUMN IF NOT EXISTS settlement_status    TEXT NOT NULL DEFAULT 'unsettled',
        ADD COLUMN IF NOT EXISTS mdr_posting_status   TEXT NOT NULL DEFAULT 'unposted',
        ADD COLUMN IF NOT EXISTS mdr_accounting_entry_id INTEGER,
        ADD COLUMN IF NOT EXISTS mdr_posted_at        TIMESTAMPTZ,
        ADD COLUMN IF NOT EXISTS mdr_posting_error     TEXT
    `);
    await db.execute(sql`
      UPDATE sport_payments
      SET net_amount = GREATEST(
        0,
        amount
        - COALESCE(mdr_amount, 0)
        - COALESCE(tax_withheld_amount, 0)
        - COALESCE(other_fee_amount, 0)
      )
      WHERE net_amount IS NULL OR net_amount = 0
    `).catch(() => {});
    await db.execute(sql`
      CREATE INDEX IF NOT EXISTS idx_sport_payments_settlement
      ON sport_payments(settlement_status, settlement_date)
    `).catch(() => {});
    // A provider settlement may contain many Sport Center payments. The
    // settlement row is the bank-facing aggregate; items retain the source
    // payment relationship and deduction breakdown.
    await db.execute(sql`
      CREATE TABLE IF NOT EXISTS qris_settlements (
        id SERIAL PRIMARY KEY,
        company_id INTEGER NOT NULL,
        settlement_reference TEXT NOT NULL,
        provider_name TEXT,
        settlement_date DATE NOT NULL,
        gross_amount NUMERIC(16,2) NOT NULL DEFAULT 0,
        mdr_amount NUMERIC(16,2) NOT NULL DEFAULT 0,
        tax_withheld_amount NUMERIC(16,2) NOT NULL DEFAULT 0,
        other_fee_amount NUMERIC(16,2) NOT NULL DEFAULT 0,
        net_amount NUMERIC(16,2) NOT NULL DEFAULT 0,
        status TEXT NOT NULL DEFAULT 'unsettled',
        bank_mutation_id INTEGER,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        UNIQUE (company_id, settlement_reference)
      )
    `).catch(() => {});
    await db.execute(sql`
      CREATE TABLE IF NOT EXISTS qris_settlement_items (
        id SERIAL PRIMARY KEY,
        settlement_id INTEGER NOT NULL REFERENCES qris_settlements(id) ON DELETE CASCADE,
        sport_payment_id INTEGER NOT NULL REFERENCES sport_payments(id) ON DELETE RESTRICT,
        gross_amount NUMERIC(16,2) NOT NULL DEFAULT 0,
        mdr_amount NUMERIC(16,2) NOT NULL DEFAULT 0,
        tax_withheld_amount NUMERIC(16,2) NOT NULL DEFAULT 0,
        other_fee_amount NUMERIC(16,2) NOT NULL DEFAULT 0,
        net_amount NUMERIC(16,2) NOT NULL DEFAULT 0,
        UNIQUE (settlement_id, sport_payment_id)
      )
    `).catch(() => {});
    await db.execute(sql`
      CREATE INDEX IF NOT EXISTS idx_qris_settlements_company_date
        ON qris_settlements(company_id, settlement_date);
      CREATE INDEX IF NOT EXISTS idx_qris_settlement_items_payment
        ON qris_settlement_items(sport_payment_id);
    `).catch(() => {});
    await db.execute(sql`
      ALTER TABLE sport_payments
        ADD COLUMN IF NOT EXISTS source TEXT NOT NULL DEFAULT 'SPORT_CENTER'
    `);

    // ASK: Accounting Settlement Kit — kolom posting status
    await db.execute(sql`ALTER TABLE sport_payments ADD COLUMN IF NOT EXISTS posting_status TEXT NOT NULL DEFAULT 'unposted'`);
    await db.execute(sql`ALTER TABLE sport_payments ADD COLUMN IF NOT EXISTS accounting_payment_id INTEGER`);
    await db.execute(sql`ALTER TABLE sport_payments ADD COLUMN IF NOT EXISTS posting_error TEXT`);
    await db.execute(sql`CREATE INDEX IF NOT EXISTS idx_sport_payments_posting_status ON sport_payments(posting_status)`);

    // Bank account linkage — agar rekonsiliasi bank dapat filter berdasarkan rekening tujuan
    await db.execute(sql`ALTER TABLE sport_payments ADD COLUMN IF NOT EXISTS bank_account_id INTEGER REFERENCES company_bank_accounts(id) ON DELETE SET NULL`);
    await db.execute(sql`CREATE INDEX IF NOT EXISTS idx_sport_payments_bank_account_id ON sport_payments(bank_account_id)`);

    // Fase 3: tabel maintenance request (integrasi Purchase — Fase 4 upgrade)
    await db.execute(sql`
      CREATE TABLE IF NOT EXISTS sport_maintenance_requests (
        id                      SERIAL PRIMARY KEY,
        company_id              INTEGER,
        facility_id             INTEGER REFERENCES sport_facilities(id) ON DELETE SET NULL,
        facility_name           TEXT,
        item                    TEXT NOT NULL,
        quantity                INTEGER NOT NULL DEFAULT 1,
        vendor                  TEXT,
        notes                   TEXT,
        source                  TEXT NOT NULL DEFAULT 'SPORT_CENTER',
        cost_center             TEXT NOT NULL DEFAULT 'SPORT_CENTER',
        request_type            TEXT NOT NULL DEFAULT 'maintenance',
        status                  TEXT NOT NULL DEFAULT 'pending',
        requested_by            TEXT,
        purchase_request_id     INTEGER,
        purchase_request_number TEXT,
        estimated_cost          NUMERIC(14,2) NOT NULL DEFAULT 0,
        unit                    TEXT NOT NULL DEFAULT 'pcs',
        created_at              TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at              TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )
    `);
    // Fase 4: tambahkan kolom baru jika tabel sudah ada (idempoten)
    await db.execute(sql`ALTER TABLE sport_maintenance_requests ADD COLUMN IF NOT EXISTS cost_center TEXT NOT NULL DEFAULT 'SPORT_CENTER'`);
    await db.execute(sql`ALTER TABLE sport_maintenance_requests ADD COLUMN IF NOT EXISTS request_type TEXT NOT NULL DEFAULT 'maintenance'`);
    await db.execute(sql`ALTER TABLE sport_maintenance_requests ADD COLUMN IF NOT EXISTS purchase_request_id INTEGER`);
    await db.execute(sql`ALTER TABLE sport_maintenance_requests ADD COLUMN IF NOT EXISTS purchase_request_number TEXT`);
    await db.execute(sql`ALTER TABLE sport_maintenance_requests ADD COLUMN IF NOT EXISTS estimated_cost NUMERIC(14,2) NOT NULL DEFAULT 0`);
    await db.execute(sql`ALTER TABLE sport_maintenance_requests ADD COLUMN IF NOT EXISTS unit TEXT NOT NULL DEFAULT 'pcs'`);
    await db.execute(sql`
      CREATE INDEX IF NOT EXISTS idx_sport_maint_facility ON sport_maintenance_requests(facility_id);
      CREATE INDEX IF NOT EXISTS idx_sport_maint_status   ON sport_maintenance_requests(status);
    `);

    // Tambahkan nilai enum baru (idempoten — IF NOT EXISTS, PostgreSQL 9.6+)
    await db.execute(sql`
      ALTER TYPE accounting_entry_source ADD VALUE IF NOT EXISTS 'sport_center_refund'
    `);
    await db.execute(sql`
      ALTER TYPE accounting_entry_source ADD VALUE IF NOT EXISTS 'sport_center_membership'
    `);
    await db.execute(sql`
      ALTER TYPE accounting_entry_source ADD VALUE IF NOT EXISTS 'sport_center_booking_refund'
    `);
    await db.execute(sql`
      ALTER TYPE accounting_entry_source ADD VALUE IF NOT EXISTS 'sport_center_operational_expense'
    `);
    await db.execute(sql`
      ALTER TYPE accounting_entry_source ADD VALUE IF NOT EXISTS 'tenant_rent_payment'
    `);
    await db.execute(sql`
      ALTER TYPE accounting_entry_source ADD VALUE IF NOT EXISTS 'tenant_sc_payment'
    `);
    await db.execute(sql`
      ALTER TYPE accounting_entry_source ADD VALUE IF NOT EXISTS 'sport_center_ppn_correction'
    `).catch(() => {/* already exists */});
    await db.execute(sql`
      ALTER TYPE accounting_entry_source ADD VALUE IF NOT EXISTS 'sport_center_amount_correction'
    `).catch(() => {/* already exists */});
    await db.execute(sql`
      ALTER TYPE accounting_entry_source ADD VALUE IF NOT EXISTS 'sport_center_payment'
    `).catch(() => {/* already exists */});

    // ── Auto-sync: sport_center_services → sport_facilities ──────────────────
    // Setiap kali startup, data dari schema lama (sport_center_services) di-sync
    // ke sport_facilities secara idempoten. Company_id default = 1
    // (PT Cahaya Sejati Teknologi).
    const SPORT_CENTER_COMPANY_ID = 1;

    const legacyCheck = await db.execute(sql`
      SELECT EXISTS (
        SELECT 1 FROM information_schema.tables
        WHERE table_schema = 'public' AND table_name = 'sport_center_services'
      ) AS exists
    `);
    const hasLegacy = (legacyCheck.rows[0] as { exists: boolean }).exists;

    if (hasLegacy) {
      // Upsert fasilitas: skip jika nama sudah ada
      await db.execute(sql`
        INSERT INTO sport_facilities
          (company_id, name, type, description, price_per_hour, capacity,
           is_active, image_url, sort_order, created_at, updated_at)
        SELECT
          1,
          s.name,
          COALESCE(s.category, 'court'),
          s.description,
          s.price_per_hour::NUMERIC(14,2),
          COALESCE(s.capacity, 1),
          COALESCE(s.is_active, TRUE),
          s.image_url,
          COALESCE(s.sort_order, 0),
          COALESCE(s.created_at, NOW()),
          COALESCE(s.updated_at, NOW())
        FROM sport_center_services s
        WHERE NOT EXISTS (
          SELECT 1 FROM sport_facilities f WHERE f.name = s.name
        )
        ON CONFLICT DO NOTHING
      `);

      // Upsert customers & bookings dari legacy sport_center_bookings (hanya jika tabel ada)
      const legacyBkCheck = await db.execute(sql`
        SELECT EXISTS (
          SELECT 1 FROM information_schema.tables
          WHERE table_schema = 'public' AND table_name = 'sport_center_bookings'
        ) AS exists
      `);
      const hasLegacyBookings = (legacyBkCheck.rows[0] as { exists: boolean }).exists;

      if (hasLegacyBookings) {
        await db.execute(sql`
          INSERT INTO sport_customers (company_id, name, email, phone, created_at, updated_at)
          SELECT DISTINCT
            1,
            b.customer_name,
            b.customer_email,
            b.customer_phone,
            NOW(), NOW()
          FROM sport_center_bookings b
          WHERE b.customer_phone IS NOT NULL
            AND NOT EXISTS (
              SELECT 1 FROM sport_customers c WHERE c.phone = b.customer_phone
            )
          ON CONFLICT DO NOTHING
        `);

        await db.execute(sql`
          INSERT INTO sport_bookings
            (company_id, booking_number, customer_id, customer_name, customer_phone,
             facility_id, facility_name, booking_date, start_time, end_time,
             duration_hours, base_amount, total_amount, status, payment_status,
             notes, created_at, updated_at)
          SELECT
            1,
            b.booking_code,
            c.id,
            b.customer_name,
            b.customer_phone,
            f.id,
            b.facility_name,
            b.date::DATE,
            b.start_time::TIME,
            b.end_time::TIME,
            COALESCE(b.total_hours, 1)::NUMERIC(5,2),
            COALESCE(b.total_price, 0)::NUMERIC(14,2),
            COALESCE(b.total_price, 0)::NUMERIC(14,2),
            CASE b.status
              WHEN 'confirmed' THEN 'confirmed'
              WHEN 'cancelled' THEN 'cancelled'
              ELSE 'pending'
            END,
            COALESCE(b.payment_status, 'unpaid'),
            b.notes,
            COALESCE(b.created_at, NOW()),
            COALESCE(b.created_at, NOW())
          FROM sport_center_bookings b
          LEFT JOIN sport_customers c ON c.phone = b.customer_phone
          LEFT JOIN sport_facilities f ON (
            f.name = b.facility_name
            OR f.name ILIKE '%' || SPLIT_PART(b.facility_id, '-', 1) || '%'
          )
          WHERE b.booking_code IS NOT NULL
            AND NOT EXISTS (
              SELECT 1 FROM sport_bookings nb WHERE nb.booking_number = b.booking_code
            )
          ON CONFLICT DO NOTHING
        `);
      }

      logger.info("Sport Center migration: legacy sync selesai (sport_center_services → sport_facilities)");
    }

    // Pastikan semua data sport center milik PT Cahaya Sejati Teknologi (company_id = 1)
    await db.execute(sql`
      UPDATE sport_facilities    SET company_id = 1 WHERE company_id IS NULL;
      UPDATE sport_bookings      SET company_id = 1 WHERE company_id IS NULL;
      UPDATE sport_customers     SET company_id = 1 WHERE company_id IS NULL;
      UPDATE sport_members       SET company_id = 1 WHERE company_id IS NULL;
      UPDATE sport_pricing_rules SET company_id = 1 WHERE company_id IS NULL;
      UPDATE sport_promos        SET company_id = 1 WHERE company_id IS NULL;
      UPDATE sport_payments      SET company_id = 1 WHERE company_id IS NULL;
      UPDATE sport_settings      SET company_id = 1 WHERE company_id IS NULL;
    `);

    await db.execute(sql`
      CREATE TABLE IF NOT EXISTS sport_sync_logs (
        id         SERIAL PRIMARY KEY,
        entity     TEXT NOT NULL,
        action     TEXT NOT NULL,
        entity_id  INTEGER,
        status     TEXT NOT NULL DEFAULT 'ok',
        detail     TEXT,
        company_id INTEGER,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );
      CREATE INDEX IF NOT EXISTS idx_sport_sync_logs_entity ON sport_sync_logs(entity, action);
      CREATE INDEX IF NOT EXISTS idx_sport_sync_logs_created ON sport_sync_logs(created_at DESC);
    `);

    // NOTE: sport_center_bookings ALTER TABLE dihapus — tabel diarsip ke zz_deleted_sport_center_bookings

    await db.execute(sql`
      ALTER TABLE sport_bookings ADD COLUMN IF NOT EXISTS customer_email TEXT;
    `);

    // Kolom sc_booking_id untuk idempoten lookup saat pull payments dari Supabase
    await db.execute(sql`
      ALTER TABLE sport_bookings ADD COLUMN IF NOT EXISTS sc_booking_id INTEGER;
      CREATE INDEX IF NOT EXISTS idx_sport_bookings_sc_id ON sport_bookings(sc_booking_id) WHERE sc_booking_id IS NOT NULL;
    `);

    // PostgreSQL owns mirrors from sport_center.sport_payments.  This must run
    // after both local payment/booking schemas are ready.
    await ensureSportPaymentMirrorTrigger();
    await backfillCanonicalQrisPaymentMetadata();

    // ── FASE 6C: facility_id + expense_category di accounting_entries ──────────
    await db.execute(sql`
      ALTER TABLE accounting_entries ADD COLUMN IF NOT EXISTS facility_id INTEGER;
      ALTER TABLE accounting_entries ADD COLUMN IF NOT EXISTS expense_category TEXT;
      ALTER TABLE accounting_entries ADD COLUMN IF NOT EXISTS source_event_id TEXT;
      CREATE UNIQUE INDEX IF NOT EXISTS accounting_entries_canonical_event_uniq
        ON accounting_entries(company_id, source, source_event_id)
        WHERE source = 'sport_center_payment' AND source_event_id IS NOT NULL;
      CREATE UNIQUE INDEX IF NOT EXISTS accounting_entries_sport_amount_correction_event_uniq
        ON accounting_entries(company_id, source, source_event_id)
        WHERE source = 'sport_center_amount_correction' AND source_event_id IS NOT NULL;
    `);

    // ── FASE 6C: recurring_expenses table ────────────────────────────────────
    await db.execute(sql`
      CREATE TABLE IF NOT EXISTS recurring_expenses (
        id          SERIAL PRIMARY KEY,
        company_id  INTEGER,
        facility_id INTEGER,
        name        TEXT NOT NULL,
        description TEXT,
        amount      NUMERIC(14,2) NOT NULL DEFAULT 0,
        frequency   TEXT NOT NULL DEFAULT 'monthly',
        next_run    DATE,
        is_active   BOOLEAN NOT NULL DEFAULT TRUE,
        category    TEXT,
        created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );
      CREATE INDEX IF NOT EXISTS idx_recurring_expenses_company  ON recurring_expenses(company_id);
      CREATE INDEX IF NOT EXISTS idx_recurring_expenses_facility ON recurring_expenses(facility_id);
      CREATE INDEX IF NOT EXISTS idx_recurring_expenses_next_run ON recurring_expenses(next_run) WHERE is_active = TRUE;
    `);

    // Pull fasilitas dari Supabase sport_center.facilities → sport_facilities (idempoten)
    try {
      const facPullResult = await pullFacilitiesFromSupabase();
      logger.info({ ...facPullResult }, "Sport Center migration: pull facilities dari Supabase selesai");
    } catch (facPullErr) {
      logger.warn({ err: facPullErr }, "Sport Center migration: pull facilities gagal (non-fatal)");
    }

    // Pull semua booking dari Supabase sport_center_bookings → sport_bookings (idempoten via ON CONFLICT)
    try {
      const pullResult = await pullLegacyBookingsFromSupabase();
      logger.info({ ...pullResult }, "Sport Center migration: pull legacy bookings dari Supabase selesai");
    } catch (pullErr) {
      logger.warn({ err: pullErr }, "Sport Center migration: pull legacy bookings gagal (non-fatal)");
    }

    // Pull payments dari Supabase sport_center.payments → sport_payments (idempoten)
    // Harus setelah pullLegacyBookings agar local booking_id sudah ada.
    // Ini juga update payment_status booking → 'paid' jika ada confirmed payment di Supabase,
    // meski billing_status pada booking record-nya masih null.
    try {
      const payResult = await pullPaymentsFromSupabase(1);
      logger.info({ ...payResult }, "Sport Center migration: pull payments dari Supabase selesai");
    } catch (payErr) {
      logger.warn({ err: payErr }, "Sport Center migration: pull payments gagal (non-fatal)");
    }

    // ── Backfill customer_email dari sport_customers → sport_bookings lama ────
    // Idempoten: hanya update baris yang customer_email masih NULL tapi customer_id sudah ada.
    const backfillResult = await db.execute(sql`
      UPDATE sport_bookings sb
      SET    customer_email = sc.email,
             updated_at     = NOW()
      FROM   sport_customers sc
      WHERE  sb.customer_id  = sc.id
        AND  sc.email        IS NOT NULL
        AND  sc.email        <> ''
        AND  (sb.customer_email IS NULL OR sb.customer_email = '')
    `);
    const backfilled = (backfillResult as { rowCount?: number }).rowCount ?? 0;
    if (backfilled > 0) {
      logger.info({ backfilled }, "Sport Center migration: customer_email backfill selesai");
    } else {
      logger.info("Sport Center migration: customer_email backfill — tidak ada baris yang perlu diisi");
    }
    // ── Repair: hapus orphan accounting_payments (dibuat oleh raw SQL lama, tanpa entry_id) ────
    // Path lama (raw SQL INSERT) membuat accounting_payments dengan entry_id = NULL dan tidak
    // mengupdate sport_payments.posting_status. Jalan sebelum backfill sehingga
    // ingestModulePayment salah membaca mereka sebagai "alreadyPosted" padahal tidak ada jurnal.
    // Fix: hapus semua baris orphan (entry_id IS NULL) agar backfillSportCenterAccountingPayments()
    // bisa re-create mereka dengan benar via ingestModulePayment.
    try {
      // Step 1: Reset posting_status pada sport_payments yang punya orphan accounting_payment.
      // Tangani dua kasus:
      //   a) source_doc_id = sp.id   (payment non-SCPAY yang dibuat via BizPortal)
      //   b) trigger mirror juga memakai source_doc_id = public.sport_payments.id
      await db.execute(sql`
        UPDATE sport_payments sp
        SET    posting_status = 'unposted',
               updated_at     = NOW()
        WHERE  (
          EXISTS (
            SELECT 1 FROM accounting_payments ap
            WHERE  ap.source_type   = 'sport_center'
              AND  ap.source_doc_id = sp.id
              AND  ap.entry_id      IS NULL
          )
        )
      `);

      // Step 2: Hapus semua orphan accounting_payments (sport_center + entry_id NULL).
      // Baris dengan entry_id IS NULL tidak punya jurnal sama sekali — tidak ada nilai
      // yang hilang dengan menghapusnya; backfill akan re-create dengan benar.
      const delResult = await db.execute(sql`
        DELETE FROM accounting_payments
        WHERE  source_type = 'sport_center'
          AND  entry_id    IS NULL
      `);
      const deleted = (delResult as { rowCount?: number }).rowCount ?? 0;
      if (deleted > 0) {
        logger.info(
          { deleted },
          "Sport Center migration: removed orphan accounting_payments (raw-SQL path) — akan di-recreate via backfillSportCenterAccountingPayments"
        );
      } else {
        logger.info("Sport Center migration: tidak ada orphan accounting_payments — skip repair");
      }
    } catch (repairErr) {
      logger.warn({ err: repairErr }, "Sport Center migration: repair orphan accounting_payments gagal (non-fatal)");
    }

    // ── Cleanup: hapus duplicate accounting_entries per (company_id, source, source_id) ──
    // Scoped by company_id untuk multi-tenant isolation: setiap company menyimpan MIN(id)-nya
    // sendiri; entry milik company lain tidak pernah disentuh.
    // Urutan operasi:
    //   1. Redirect accounting_payments.entry_id ke keeper
    //   2. Downgrade duplicate posted entries → draft (trigger fn_block_posted_lines_mutation
    //      memblokir DELETE pada lines dari posted entries, tapi mengizinkan transisi
    //      posted→draft jika cancel_reason + cancelled_at disediakan)
    //   3. Hapus accounting_entry_lines dari entry duplikat (sekarang sudah draft)
    //   4. Hapus accounting_entries duplikat
    try {
      // 1. Downgrade duplikat dari 'posted'/'approved' → 'draft' agar trigger mengizinkan DELETE
      //    Duplikat diidentifikasi per (company_id, source, source_id) — bukan global —
      //    karena index uniknya adalah company-scoped (multi-tenant aman).
      await db.execute(sql`
        UPDATE accounting_entries
        SET status        = 'draft',
            cancel_reason = 'MIGRATION_DEDUP: entri duplikat per (company_id, source, source_id) — dihapus oleh runSportCenterMigration',
            cancelled_at  = NOW()
        WHERE source != 'manual'
          AND source_id IS NOT NULL
          AND status IN ('posted', 'approved', 'pending_approval')
          AND id NOT IN (
            SELECT MIN(id)
            FROM accounting_entries
            WHERE source != 'manual' AND source_id IS NOT NULL
            GROUP BY company_id, source, source_id
          )
      `);

      // 2. Pindahkan accounting_payments.entry_id ke entry yang dipertahankan (company-scoped)
      await db.execute(sql`
        UPDATE accounting_payments ap
        SET entry_id = keeper.min_id
        FROM (
          SELECT company_id, source, source_id, MIN(id) AS min_id
          FROM accounting_entries
          WHERE source != 'manual' AND source_id IS NOT NULL
          GROUP BY company_id, source, source_id
          HAVING COUNT(*) > 1
        ) keeper
        JOIN accounting_entries dup ON dup.company_id = keeper.company_id
          AND dup.source = keeper.source
          AND dup.source_id = keeper.source_id
          AND dup.id != keeper.min_id
        WHERE ap.entry_id = dup.id
      `);

      // 2. Downgrade duplicate posted entries → draft sebelum menghapus lines-nya.
      //    Trigger fn_block_posted_lines_mutation memblokir DELETE pada lines posted entries
      //    tetapi mengizinkan transisi posted→draft jika cancel_reason + cancelled_at diisi.
      await db.execute(sql`
        UPDATE accounting_entries
        SET
          status       = 'draft',
          cancel_reason = 'Duplicate entry cleanup — downgraded before deletion',
          cancelled_at  = NOW()
        WHERE source != 'manual'
          AND source_id IS NOT NULL
          AND status = 'posted'
          AND id NOT IN (
            SELECT MIN(id)
            FROM accounting_entries
            WHERE source != 'manual' AND source_id IS NOT NULL
            GROUP BY company_id, source, source_id
          )
      `);

      // 3. Hapus entry lines dari entry duplikat (sudah draft, trigger tidak lagi memblokir)
      // 3. Hapus entry lines dari entry duplikat (aman karena sudah di-downgrade ke 'draft')
      await db.execute(sql`
        DELETE FROM accounting_entry_lines
        WHERE entry_id IN (
          SELECT id FROM accounting_entries
          WHERE source != 'manual'
            AND source_id IS NOT NULL
            AND id NOT IN (
              SELECT MIN(id)
              FROM accounting_entries
              WHERE source != 'manual' AND source_id IS NOT NULL
              GROUP BY company_id, source, source_id
            )
        )
      `);

      // 4. Hapus entry duplikat (company-scoped — tiap company mempertahankan MIN(id) sendiri)
      await db.execute(sql`
        DELETE FROM accounting_entries
        WHERE source != 'manual'
          AND source_id IS NOT NULL
          AND id NOT IN (
            SELECT MIN(id)
            FROM accounting_entries
            WHERE source != 'manual' AND source_id IS NOT NULL
            GROUP BY company_id, source, source_id
          )
      `);
      logger.info("Sport Center migration: cleanup duplikat accounting_entries selesai");
    } catch (cleanErr) {
      logger.warn({ err: cleanErr }, "Sport Center migration: cleanup duplikat accounting_entries gagal (non-fatal)");
    }

    // ── Drop legacy non-company-scoped index (R-1 remediation) ──────────────────────────
    // idx_accounting_entries_source_source_id was a unique index on (source, source_id)
    // WITHOUT company_id. This prevents the same source+source_id from existing in two
    // different companies, which is wrong for a multi-tenant system.
    //
    // R-1 fix replaces it with accounting_entries_company_source_source_id_uniq which
    // includes company_id so cross-company entries are allowed.
    //
    // Drop the old index here so that even if this migration runs before accountingMigration,
    // the non-scoped index is removed.
    try {
      await db.execute(sql`DROP INDEX IF EXISTS idx_accounting_entries_source_source_id`);
      logger.info("Sport Center migration: dropped legacy non-company-scoped index idx_accounting_entries_source_source_id (R-1 fix)");
    } catch (idxErr) {
      logger.warn({ err: idxErr }, "Sport Center migration: drop legacy index failed (non-fatal)");
    }

    // ── Phase 4C: tambahkan kolom QRIS reconciliation ke sport_center.sport_payments ──
    // Kolom ini mungkin ada di public.sport_payments (via ALTER TABLE di atas)
    // tapi belum tentu ada di sport_center.sport_payments pada DB lama.
    // Semua ADD COLUMN IF NOT EXISTS — aman dijalankan berulang kali.
    try {
      await db.execute(sql`
        ALTER TABLE sport_center.sport_payments
          ADD COLUMN IF NOT EXISTS payment_provider           TEXT,
          ADD COLUMN IF NOT EXISTS expected_settlement_date   DATE,
          ADD COLUMN IF NOT EXISTS settlement_rule_version    TEXT,
          ADD COLUMN IF NOT EXISTS bank_account_id            TEXT
      `);
      // The canonical Sport Center source may contain a provider account
      // number (including values larger than a PostgreSQL INTEGER).  Older
      // runtime snapshots created this column as INTEGER, which either
      // rejected a valid account number or made the value look like an
      // internal account ID.  Keep the source identity losslessly as TEXT;
      // internal IDs are resolved at accounting/reconciliation boundaries.
      await db.execute(sql.raw(`
        DO $repair$
        DECLARE
          v_data_type text;
        BEGIN
          SELECT data_type
            INTO v_data_type
            FROM information_schema.columns
           WHERE table_schema = 'sport_center'
             AND table_name = 'sport_payments'
             AND column_name = 'bank_account_id';

          IF v_data_type IS NOT NULL AND v_data_type <> 'text' THEN
            ALTER TABLE sport_center.sport_payments
              ALTER COLUMN bank_account_id TYPE TEXT
              USING bank_account_id::text;
          END IF;
        END
        $repair$;
      `));
      logger.info("Sport Center migration: Phase 4C QRIS columns ensured on sport_center.sport_payments");
    } catch (p4cErr) {
      logger.warn({ err: p4cErr }, "Sport Center migration: Phase 4C QRIS column migration non-fatal failure");
    }

    // ── Phase 4C metadata backfill ───────────────────────────────────────────
    // Mengisi field QRIS reconciliation untuk sport_center.sport_payments yang
    // masih NULL. Dijalankan idempoten (IF NOT EXISTS / IS NULL guards).
    try {
      // sport_center.sport_payments.status adalah ENUM dengan nilai valid:
      // 'confirmed', 'pending', 'cancelled'. Bukan 'paid' (itu di public schema).
      // Supabase status='paid' di-map ke local 'pending' via sync CASE ELSE branch,
      // sehingga semua pembayaran aktif perlu include kedua nilai.
      const PAID_STATUS = `status::text IN ('confirmed', 'pending')`;

      // 1. Set payment_method='QRIS' untuk paid payments yang payment_method masih NULL.
      //    Sport center menerima pembayaran via QRIS; data historis dari Supabase
      //    sering tidak mengisi kolom ini sehingga filter engine LIKE '%qris%' gagal.
      await db.execute(sql.raw(`
        UPDATE sport_center.sport_payments
        SET payment_method = 'QRIS'
        WHERE ${PAID_STATUS}
          AND (payment_method IS NULL OR TRIM(payment_method) = '')
      `));

      // 2. Recover the canonical external account identity from an existing
      // public mirror when available.  Never choose the first active account:
      // that silently assigns the wrong bank dimension in a multi-account
      // company.  The canonical source keeps the external value; the
      // reconciliation boundary resolves it to company_bank_accounts.id.
      await db.execute(sql.raw(`
        UPDATE sport_center.sport_payments sp
        SET bank_account_id = NULLIF(BTRIM(m.external_bank_account_id::text), '')
        FROM public.sport_payments m
        WHERE sp.bank_account_id IS NULL
          AND m.source_schema = 'sport_center'
          AND m.source_table = 'sport_payments'
          AND m.source_payment_id = sp.id
          AND NULLIF(BTRIM(m.external_bank_account_id::text), '') IS NOT NULL
          AND sp.status::text IN ('confirmed', 'pending')
      `));

      // 3. Repair the public mirror's internal account ID from the canonical
      // external identity.  The update is deliberately unique-match-only:
      // zero or ambiguous account matches remain unresolved and visible for
      // owner configuration instead of being guessed.
      await db.execute(sql.raw(`
        UPDATE public.sport_payments m
        SET bank_account_id = resolved.bank_account_id
        FROM (
          SELECT
            sp.id AS source_payment_id,
            cba.id AS bank_account_id
          FROM sport_center.sport_payments sp
          JOIN public.company_bank_accounts cba
            ON cba.company_id = sp.company_id
           AND cba.is_active = TRUE
           AND (
             cba.account_number::text = NULLIF(BTRIM(sp.bank_account_id::text), '')
             OR cba.id::text = NULLIF(BTRIM(sp.bank_account_id::text), '')
           )
          WHERE sp.status::text IN ('confirmed', 'pending')
            AND NULLIF(BTRIM(sp.bank_account_id::text), '') IS NOT NULL
          GROUP BY sp.id, cba.id
          HAVING COUNT(*) = 1
             AND (
               SELECT COUNT(*)
               FROM public.company_bank_accounts cba2
               WHERE cba2.company_id = sp.company_id
                 AND cba2.is_active = TRUE
                 AND (
                   cba2.account_number::text = NULLIF(BTRIM(sp.bank_account_id::text), '')
                   OR cba2.id::text = NULLIF(BTRIM(sp.bank_account_id::text), '')
                 )
             ) = 1
        ) resolved
        WHERE m.source_schema = 'sport_center'
          AND m.source_table = 'sport_payments'
          AND m.source_payment_id = resolved.source_payment_id
          AND m.posting_status IN ('unposted', 'failed')
      `));

      // 4. Set expected_settlement_date from the canonical payment date.
      // QRIS is H+1 calendar day; paid_at is preferred and confirmed_at/
      // created_at are only legacy fallbacks.
      await db.execute(sql.raw(`
        UPDATE sport_center.sport_payments
        SET expected_settlement_date = (
          COALESCE(paid_at, confirmed_at, created_at) AT TIME ZONE 'Asia/Jakarta'
        )::date + 1
        WHERE expected_settlement_date IS NULL
          AND COALESCE(paid_at, confirmed_at, created_at) IS NOT NULL
          AND ${PAID_STATUS}
      `));

      // 5. Set settlement_rule_version ke default jika masih NULL.
      await db.execute(sql.raw(`
        UPDATE sport_center.sport_payments
        SET settlement_rule_version = 'default-v1'
        WHERE settlement_rule_version IS NULL
          AND ${PAID_STATUS}
      `));

      const countRes = await db.execute(sql.raw(`
        SELECT COUNT(*) AS cnt
        FROM sport_center.sport_payments
        WHERE ${PAID_STATUS}
          AND LOWER(COALESCE(payment_method::text,'')) LIKE '%qris%'
          AND bank_account_id IS NOT NULL
          AND expected_settlement_date IS NOT NULL
      `));
      const cnt = Number((countRes.rows[0] as any)?.cnt ?? 0);
      logger.info({ cnt }, "Sport Center migration: Phase 4C QRIS column backfill selesai");
    } catch (backfillErr) {
      logger.warn({ err: backfillErr }, "Sport Center migration: Phase 4C backfill non-fatal failure");
    }

    try {
      await ensureCanonicalSettlementContracts();
    } catch (canonicalErr) {
      logger.error({ err: canonicalErr }, "Canonical Sport Center settlement contract migration gagal");
      throw canonicalErr;
    }

    // ── expected_bank_settlements view ─────────────────────────────────────
    // Required by canonicalSettlementDetailsSql() embedded in the bank-recon
    // GET /mutations UNION ALL query.  Maps payment_settlement_batches columns
    // to the names expected by canonicalSettlementAdapter.ts.
    // Must run AFTER payment_settlement_batches is created above.
    try {
      await db.execute(sql`
        CREATE OR REPLACE VIEW sport_center.expected_bank_settlements AS
        SELECT
          b.id                                      AS settlement_id,
          b.settlement_reference,
          b.company_id,
          b.provider_code,
          COALESCE(b.provider_code, 'unknown')      AS provider_name,
          b.bank_account_id,
          b.settlement_date,
          COALESCE(b.gross_amount,        0)        AS gross_amount,
          COALESCE(b.mdr_amount,          0)        AS mdr_amount,
          COALESCE(b.provider_fee_amount, 0)        AS provider_fee_amount,
          COALESCE(b.fee_tax_amount,      0)        AS fee_tax_amount,
          COALESCE(b.tax_withheld_amount, 0)        AS tax_withheld_amount,
          COALESCE(b.adjustment_amount,   0)        AS adjustment_amount,
          COALESCE(b.net_amount,          0)        AS expected_bank_amount,
          b.status                                  AS settlement_status,
          b.settlement_journal_id,
          b.bank_mutation_id,
          b.canonical_bank_mutation_id,
          b.settlement_rule_version,
          b.posted_at,
          b.posted_by,
          b.reconciled_at,
          b.reconciled_by,
          CASE
            WHEN b.bank_mutation_id IS NOT NULL THEN 'linked'
            WHEN b.status = 'reconciled'        THEN 'reconciled'
            ELSE 'unlinked'
          END                                       AS bank_link_status
        FROM sport_center.payment_settlement_batches b
      `);
      logger.info("Sport Center migration: expected_bank_settlements view created/updated");
    } catch (viewErr) {
      logger.warn({ err: viewErr }, "Sport Center migration: expected_bank_settlements view creation failed (non-fatal)");
    }

    await markStartupMigrationComplete(
      "sport_center_bootstrap",
      SPORT_CENTER_BOOTSTRAP_VERSION,
      "Sport Center schema, canonical settlement contracts, and initial legacy synchronization",
    );
    logger.info("Sport Center migration: selesai");
  } catch (err) {
    logger.error({ err }, "Sport Center migration: gagal");
    throw err;
  }
}

/**
 * Tabel Tagihan Perusahaan (Company Invoice) untuk Sport Center.
 * Idempoten — hanya dijalankan sekali.
 */
export async function runSportCenterCompanyInvoiceMigration(): Promise<void> {
  if (await isStartupMigrationComplete("sport_center_company_invoice", SPORT_CENTER_BOOTSTRAP_VERSION)) {
    logger.info("Sport Center company invoice bootstrap already provisioned; startup DDL skipped");
    return;
  }

  try {
    await db.execute(sql`
      CREATE TABLE IF NOT EXISTS sport_company_clients (
        id           SERIAL PRIMARY KEY,
        company_id   INTEGER NOT NULL DEFAULT 1,
        name         TEXT NOT NULL,
        pic_name     TEXT,
        pic_phone    TEXT,
        pic_email    TEXT,
        address      TEXT,
        notes        TEXT,
        is_active    BOOLEAN NOT NULL DEFAULT TRUE,
        created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );
      CREATE INDEX IF NOT EXISTS idx_scc_company ON sport_company_clients(company_id);
    `);

    await db.execute(sql`
      CREATE TABLE IF NOT EXISTS sport_company_invoices (
        id             SERIAL PRIMARY KEY,
        company_id     INTEGER NOT NULL DEFAULT 1,
        client_id      INTEGER NOT NULL REFERENCES sport_company_clients(id) ON DELETE CASCADE,
        invoice_number TEXT NOT NULL UNIQUE,
        period_month   INTEGER NOT NULL,
        period_year    INTEGER NOT NULL,
        subtotal       NUMERIC(14,2) NOT NULL DEFAULT 0,
        tax_rate       NUMERIC(5,2)  NOT NULL DEFAULT 11,
        tax_amount     NUMERIC(14,2) NOT NULL DEFAULT 0,
        grand_total    NUMERIC(14,2) NOT NULL DEFAULT 0,
        status         TEXT NOT NULL DEFAULT 'unpaid',
        notes          TEXT,
        paid_at        TIMESTAMPTZ,
        created_by     TEXT,
        created_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at     TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );
      CREATE INDEX IF NOT EXISTS idx_sci_company  ON sport_company_invoices(company_id);
      CREATE INDEX IF NOT EXISTS idx_sci_client   ON sport_company_invoices(client_id);
      CREATE INDEX IF NOT EXISTS idx_sci_status   ON sport_company_invoices(status);
    `);

    await db.execute(sql`
      CREATE TABLE IF NOT EXISTS sport_company_invoice_items (
        id             SERIAL PRIMARY KEY,
        invoice_id     INTEGER NOT NULL REFERENCES sport_company_invoices(id) ON DELETE CASCADE,
        booking_id     INTEGER REFERENCES sport_bookings(id) ON DELETE SET NULL,
        booking_number TEXT,
        customer_name  TEXT,
        facility_name  TEXT,
        booking_date   DATE,
        duration_hours NUMERIC(5,2),
        subtotal       NUMERIC(14,2) NOT NULL DEFAULT 0,
        tax_amount     NUMERIC(14,2) NOT NULL DEFAULT 0,
        total          NUMERIC(14,2) NOT NULL DEFAULT 0,
        created_at     TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );
      CREATE INDEX IF NOT EXISTS idx_scii_invoice ON sport_company_invoice_items(invoice_id);
      CREATE INDEX IF NOT EXISTS idx_scii_booking ON sport_company_invoice_items(booking_id);
    `);

    await markStartupMigrationComplete(
      "sport_center_company_invoice",
      SPORT_CENTER_BOOTSTRAP_VERSION,
      "Sport Center company client and invoice tables",
    );
    logger.info("Sport Center company invoice migration: selesai");
  } catch (err) {
    logger.error({ err }, "Sport Center company invoice migration: gagal");
    throw err;
  }
}

/**
 * Koreksi journal entry Sport Center yang salah masuk ke akun 4-1010
 * (Pendapatan Jasa Freight) — pindahkan ke 4-1017 (Pendapatan Booking Sport Center).
 * Idempoten: jika sudah tidak ada baris yang salah, skip.
 */
export async function runSportCenterAccountCorrection(): Promise<void> {
  if (await isStartupMigrationComplete("sport_center_account_correction", SPORT_CENTER_BOOTSTRAP_VERSION)) {
    logger.info("Sport Center account correction already applied; startup data correction skipped");
    return;
  }

  try {
    const BOOKING_SOURCES = [
      "sport_center_booking",
      "sport_center_booking_reversal",
      "sport_center_booking_refund",
      "sport_center_booking_refund_direct",
      "sport_center_refund",
    ];

    // Jalankan dalam satu transaksi dengan bypass immutability trigger.
    // Trigger trg_block_lines_mutation memblokir UPDATE pada posted entries,
    // sehingga perlu SET LOCAL session_replication_role = 'replica' agar
    // koreksi akun bisa berjalan tanpa melanggar prinsip immutability bisnis.
    await db.transaction(async (tx) => {
      await tx.execute(sql`SET LOCAL session_replication_role = 'replica'`);

      // ── Koreksi 1: Booking/Reversal/Refund → 4-1010 (Freight) ke 4-1017 (SC Booking) ──
      const result1 = await tx.execute(sql`
        WITH
          acct_freight AS (
            SELECT id, company_id FROM chart_of_accounts WHERE code LIKE '4-1010%' AND company_id IS NOT NULL
          ),
          acct_sc AS (
            SELECT id, company_id FROM chart_of_accounts WHERE code LIKE '4-1017%' AND company_id IS NOT NULL
          ),
          bad_lines AS (
            SELECT ael.id AS line_id,
                   asc2.id AS correct_account_id
            FROM accounting_entry_lines ael
            JOIN accounting_entries ae ON ae.id = ael.entry_id
            JOIN acct_freight af
              ON af.id = ael.account_id
                 AND af.company_id = ae.company_id
            JOIN acct_sc asc2
              ON asc2.company_id = ae.company_id
            WHERE ae.source::text = ANY(ARRAY[${sql.raw(BOOKING_SOURCES.map(s => `'${s}'`).join(","))}])
          )
        UPDATE accounting_entry_lines ael
          SET account_id = bad_lines.correct_account_id
        FROM bad_lines
        WHERE ael.id = bad_lines.line_id
      `);
      const affected1 = (result1 as { rowCount?: number }).rowCount ?? 0;
      if (affected1 > 0) {
        logger.info({ affected: affected1 }, "Sport Center account correction: booking/refund dipindahkan dari 4-1010 → 4-1017");
      }

      // ── Koreksi 2: Membership → 4-1010 (Freight) ke 4-1016 (SC Membership) ──
      const result2 = await tx.execute(sql`
        WITH
          acct_freight AS (
            SELECT id, company_id FROM chart_of_accounts WHERE code LIKE '4-1010%' AND company_id IS NOT NULL
          ),
          acct_mbr AS (
            SELECT id, company_id FROM chart_of_accounts WHERE code LIKE '4-1016%' AND company_id IS NOT NULL
          ),
          bad_lines AS (
            SELECT ael.id AS line_id,
                   am.id AS correct_account_id
            FROM accounting_entry_lines ael
            JOIN accounting_entries ae ON ae.id = ael.entry_id
            JOIN acct_freight af
              ON af.id = ael.account_id
                 AND af.company_id = ae.company_id
            JOIN acct_mbr am
              ON am.company_id = ae.company_id
            WHERE ae.source::text = 'sport_center_membership'
          )
        UPDATE accounting_entry_lines ael
          SET account_id = bad_lines.correct_account_id
        FROM bad_lines
        WHERE ael.id = bad_lines.line_id
      `);
      const affected2 = (result2 as { rowCount?: number }).rowCount ?? 0;
      if (affected2 > 0) {
        logger.info({ affected: affected2 }, "Sport Center account correction: membership dipindahkan dari 4-1010 → 4-1016");
      }

      if (affected1 === 0 && affected2 === 0) {
        logger.info("Sport Center account correction: tidak ada baris yang perlu dikoreksi");
      }
    });
    await markStartupMigrationComplete(
      "sport_center_account_correction",
      SPORT_CENTER_BOOTSTRAP_VERSION,
      "One-time correction of legacy Sport Center revenue account mappings",
    );
  } catch (err) {
    logger.error({ err }, "Sport Center account correction: gagal");
    throw err;
  }
}

/**
 * Migration: buat tabel sport_expenses.
 * Idempoten — pakai CREATE TABLE IF NOT EXISTS.
 */
export async function runSportExpensesMigration(): Promise<void> {
  if (await isStartupMigrationComplete("sport_expenses", SPORT_CENTER_BOOTSTRAP_VERSION)) {
    logger.info("Sport Expenses bootstrap already provisioned; startup DDL skipped");
    return;
  }

  try {
    await db.execute(sql`
      CREATE TABLE IF NOT EXISTS sport_expenses (
        id             SERIAL PRIMARY KEY,
        company_id     INTEGER,
        facility_id    INTEGER REFERENCES sport_facilities(id) ON DELETE SET NULL,
        expense_number TEXT NOT NULL UNIQUE,
        date           DATE NOT NULL,
        category       TEXT NOT NULL DEFAULT 'lain-lain',
        description    TEXT,
        amount         NUMERIC(14,2) NOT NULL DEFAULT 0,
        payment_method TEXT NOT NULL DEFAULT 'cash',
        status         TEXT NOT NULL DEFAULT 'draft',
        entry_id       INTEGER,
        notes          TEXT,
        created_by     TEXT,
        created_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at     TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )
    `);

    await db.execute(sql`
      CREATE INDEX IF NOT EXISTS idx_sport_expenses_company  ON sport_expenses(company_id)
    `);

    await db.execute(sql`
      CREATE INDEX IF NOT EXISTS idx_sport_expenses_facility ON sport_expenses(facility_id)
    `);

    await db.execute(sql`
      CREATE INDEX IF NOT EXISTS idx_sport_expenses_date     ON sport_expenses(date)
    `);

    await db.execute(sql`
      CREATE INDEX IF NOT EXISTS idx_sport_expenses_status   ON sport_expenses(status)
    `);

    await markStartupMigrationComplete(
      "sport_expenses",
      SPORT_CENTER_BOOTSTRAP_VERSION,
      "Sport Center expense table and indexes",
    );
    logger.info("Sport Expenses migration: selesai");
  } catch (err) {
    logger.error({ err }, "Sport Expenses migration: gagal");
    throw err;
  }
}

