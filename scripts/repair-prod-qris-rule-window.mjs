#!/usr/bin/env node
/**
 * Repair the owner-approved historical Mandiri QRIS rule window, reconcile its
 * public audit-rule mirror, and refresh the two live owner routines that
 * previously pinned one rule version.
 *
 * This is deliberately a narrow, guarded data migration. It only changes the
 * end of the exact historical row after proving the adjacent current row and
 * the target project. The application uses half-open windows:
 *   effective_from <= payment_date < effective_until
 *
 * Usage:
 *   APP_ENV=production CF_SC_QRIS_WINDOW_REPAIR_APPLY=true \
 *     node artifacts/api-server/load-secrets.mjs \
 *     node scripts/repair-prod-qris-rule-window.mjs
 */

import pg from "pg";
import { PROD_PROJECT_REF, extractProjectRef } from "./runtime-db-guard.mjs";

const { Client } = pg;
const APPLY_FLAG = "true";
const TARGET_COMPANY_ID = 1;
const TARGET_PROVIDER = "mandiri_direct";
const TARGET_BANK_ACCOUNT = "1640006707220";
const LEGACY_RULE_VERSION = "LEGACY-MANDIRI-2";
const CURRENT_RULE_VERSION = "PROD-MANDIRI-SC-20260810-v1";
const LEGACY_EFFECTIVE_FROM = "2026-01-01";
const OLD_EFFECTIVE_UNTIL = "2026-07-13";
const SHARED_EFFECTIVE_FROM = "2026-07-14";
const ACTOR = "production-qris-config-window-repair";
const MIRROR_SOURCE = "sport_center.payment_settlement_configs";
const HARD_CODED_RULE_LINE =
  "AND psc.rule_version = 'PROD-MANDIRI-SC-20260810-v1'";

if (process.env.APP_ENV !== "production") {
  throw new Error("QRIS_WINDOW_REPAIR_PROD_ONLY: APP_ENV=production is required.");
}
if (process.env.CF_SC_QRIS_WINDOW_REPAIR_APPLY !== APPLY_FLAG) {
  throw new Error(
    "QRIS_WINDOW_REPAIR_NOT_ARMED: set CF_SC_QRIS_WINDOW_REPAIR_APPLY=true for the guarded write.",
  );
}

const url = process.env.SUPABASE_DATABASE_URL;
if (!url) throw new Error("QRIS_WINDOW_REPAIR_MISSING_DATABASE_URL");
const projectRef = extractProjectRef(url);
if (projectRef !== PROD_PROJECT_REF) {
  throw new Error(`QRIS_WINDOW_REPAIR_TARGET_UNVERIFIED: ${projectRef ?? "unknown"}`);
}

const client = new Client({
  connectionString: url,
  ssl: { rejectUnauthorized: false },
  connectionTimeoutMillis: 10_000,
});

const configPredicate = `
  company_id = $1
  AND lower(btrim(provider_code)) = $2
  AND bank_account_id = $3
  AND is_active = TRUE
  AND source = 'OWNER_APPROVED'
`;

try {
  await client.connect();
  await client.query("BEGIN");
  await client.query("SELECT pg_advisory_xact_lock(hashtext($1))", [
    "sport-center:qris:mandiri:1640006707220:rule-window",
  ]);

  const legacy = await client.query(
    `SELECT id, rule_version, effective_from::text, effective_until::text
       FROM sport_center.payment_settlement_configs
      WHERE ${configPredicate}
        AND rule_version = $4
        AND effective_from = $5::date
        AND effective_until IN ($6::date, $7::date)
      FOR UPDATE`,
    [
      TARGET_COMPANY_ID,
      TARGET_PROVIDER,
      TARGET_BANK_ACCOUNT,
      LEGACY_RULE_VERSION,
      LEGACY_EFFECTIVE_FROM,
      OLD_EFFECTIVE_UNTIL,
      SHARED_EFFECTIVE_FROM,
    ],
  );
  if (legacy.rowCount !== 1) {
    throw new Error(
      `QRIS_WINDOW_REPAIR_LEGACY_PRECONDITION_FAILED: expected 1 historical row at the old or repaired boundary, found ${legacy.rowCount}`,
    );
  }

  const current = await client.query(
    `SELECT id, rule_version, effective_from::text, effective_until::text
       FROM sport_center.payment_settlement_configs
      WHERE ${configPredicate}
        AND rule_version = $4
        AND effective_from = $5::date
        AND effective_until IS NULL
      FOR UPDATE`,
    [
      TARGET_COMPANY_ID,
      TARGET_PROVIDER,
      TARGET_BANK_ACCOUNT,
      CURRENT_RULE_VERSION,
      SHARED_EFFECTIVE_FROM,
    ],
  );
  if (current.rowCount !== 1) {
    throw new Error(
      `QRIS_WINDOW_REPAIR_CURRENT_PRECONDITION_FAILED: expected 1 exact current row, found ${current.rowCount}`,
    );
  }

  const bankAccount = await client.query(
    `SELECT id
       FROM public.company_bank_accounts
      WHERE company_id = $1
        AND account_number::text = $2
        AND is_active = TRUE
      FOR UPDATE`,
    [TARGET_COMPANY_ID, TARGET_BANK_ACCOUNT],
  );
  if (bankAccount.rowCount !== 1) {
    throw new Error(
      `QRIS_WINDOW_REPAIR_BANK_ACCOUNT_PRECONDITION_FAILED: expected 1 active account, found ${bankAccount.rowCount}`,
    );
  }
  const internalBankAccountId = bankAccount.rows[0].id;

  const mirrorTable = await client.query(
    `SELECT COUNT(*)::int AS required_columns
       FROM information_schema.columns
      WHERE table_schema = 'public'
        AND table_name = 'qris_provider_settlement_rules'
        AND column_name IN (
          'company_id', 'bank_account_id', 'provider_code', 'rule_version',
          'effective_from', 'effective_until', 'source', 'is_active',
          'settlement_delay_business_days', 'match_window_business_days',
          'max_effective_deduction_rate', 'absolute_variance_tolerance',
          'percentage_variance_tolerance'
        )`,
  );
  if (Number(mirrorTable.rows[0]?.required_columns) !== 13) {
    throw new Error(
      `QRIS_WINDOW_REPAIR_MIRROR_SCHEMA_PRECONDITION_FAILED: expected 13 columns, found ${mirrorTable.rows[0]?.required_columns ?? "null"}`,
    );
  }

  const mirrorBefore = await client.query(
    `SELECT id, company_id, bank_account_id, provider_code, rule_version,
            effective_from::text, effective_until::text, source, is_active
       FROM public.qris_provider_settlement_rules
      WHERE company_id = $1
        AND bank_account_id = $2
        AND lower(btrim(provider_code)) = $3
        AND source = $4
      FOR UPDATE`,
    [
      TARGET_COMPANY_ID,
      internalBankAccountId,
      TARGET_PROVIDER,
      MIRROR_SOURCE,
    ],
  );

  const mirrorWindowRepair = await client.query(
    `UPDATE public.qris_provider_settlement_rules mirror
        SET effective_until = config.effective_until,
            is_active = config.is_active,
            updated_at = NOW()
       FROM sport_center.payment_settlement_configs config
      WHERE mirror.company_id = config.company_id
        AND mirror.bank_account_id = $2
        AND mirror.provider_code = lower(btrim(config.provider_code))
        AND mirror.rule_version = config.rule_version
        AND mirror.effective_from = config.effective_from
        AND mirror.effective_until IS DISTINCT FROM config.effective_until
        AND mirror.source = $3
        AND config.company_id = $1
        AND lower(btrim(config.provider_code)) = $4
        AND config.bank_account_id = $5
        AND config.source = 'OWNER_APPROVED'
        AND config.rule_version IS NOT NULL
        AND btrim(config.rule_version) <> ''
        AND (
          SELECT COUNT(*)
            FROM sport_center.payment_settlement_configs same_config
           WHERE same_config.company_id = config.company_id
             AND lower(btrim(same_config.provider_code)) =
                 lower(btrim(config.provider_code))
             AND same_config.bank_account_id = config.bank_account_id
             AND same_config.rule_version = config.rule_version
             AND same_config.effective_from = config.effective_from
             AND same_config.source = 'OWNER_APPROVED'
        ) = 1
     RETURNING mirror.id, mirror.effective_until::text, mirror.is_active`,
    [
      TARGET_COMPANY_ID,
      internalBankAccountId,
      MIRROR_SOURCE,
      TARGET_PROVIDER,
      TARGET_BANK_ACCOUNT,
    ],
  );

  // The public registry is a versioned audit projection. Add any canonical
  // owner-approved version that is missing, but never rewrite an existing
  // snapshot's financial values. The exact temporal identity is the only
  // safe conflict key.
  const mirrorInserted = await client.query(
    `INSERT INTO public.qris_provider_settlement_rules (
       company_id, bank_account_id, provider_code, rule_version,
       effective_from, effective_until, source,
       settlement_delay_business_days, match_window_business_days,
       max_effective_deduction_rate, absolute_variance_tolerance,
       percentage_variance_tolerance, is_active
     )
     SELECT
       config.company_id,
       account.id,
       lower(btrim(config.provider_code)),
       config.rule_version,
       config.effective_from,
       config.effective_until,
        $3,
       config.settlement_delay_business_days,
       1,
       greatest(
         coalesce(config.mdr_rate, 0)
           + coalesce(config.settlement_tolerance_rate, 0),
         0.100000
       ),
       coalesce(config.settlement_tolerance_amount, 10000.00),
       coalesce(config.settlement_tolerance_rate, 0.0200) * 100,
       config.is_active
       FROM sport_center.payment_settlement_configs config
       JOIN public.company_bank_accounts account
         ON account.company_id = config.company_id
        AND account.account_number::text = config.bank_account_id::text
        AND account.is_active = TRUE
      WHERE config.company_id = $1
        AND lower(btrim(config.provider_code)) = $2
        AND config.bank_account_id = $4
        AND config.source = 'OWNER_APPROVED'
        AND config.rule_version IS NOT NULL
        AND btrim(config.rule_version) <> ''
        AND NOT EXISTS (
          SELECT 1
            FROM public.qris_provider_settlement_rules existing
           WHERE existing.company_id = config.company_id
             AND existing.bank_account_id = account.id
             AND existing.provider_code = lower(btrim(config.provider_code))
             AND existing.rule_version = config.rule_version
             AND existing.effective_from = config.effective_from
             AND existing.effective_until IS NOT DISTINCT FROM config.effective_until
              AND existing.source = $3
        )
     RETURNING id, rule_version, effective_from::text, effective_until::text`,
    [
      TARGET_COMPANY_ID,
      TARGET_PROVIDER,
      MIRROR_SOURCE,
      TARGET_BANK_ACCOUNT,
    ],
  );

  const mirrorSync = await client.query(
    `UPDATE public.qris_provider_settlement_rules mirror
        SET is_active = config.is_active,
            updated_at = NOW()
       FROM sport_center.payment_settlement_configs config
      WHERE mirror.company_id = config.company_id
        AND mirror.bank_account_id = $2
        AND mirror.provider_code = lower(btrim(config.provider_code))
        AND mirror.rule_version = config.rule_version
        AND mirror.effective_from = config.effective_from
        AND mirror.effective_until IS NOT DISTINCT FROM config.effective_until
        AND mirror.source = $3
        AND config.company_id = $1
        AND lower(btrim(config.provider_code)) = $4
        AND config.bank_account_id = $5
        AND config.source = 'OWNER_APPROVED'
     RETURNING mirror.id, mirror.is_active`,
    [
      TARGET_COMPANY_ID,
      internalBankAccountId,
      MIRROR_SOURCE,
      TARGET_PROVIDER,
      TARGET_BANK_ACCOUNT,
    ],
  );

  const mirrorDeactivated = await client.query(
    `UPDATE public.qris_provider_settlement_rules mirror
        SET is_active = FALSE,
            updated_at = NOW()
      WHERE mirror.company_id = $1
        AND mirror.bank_account_id = $2
        AND mirror.provider_code = $3
        AND mirror.source = $4
        AND NOT EXISTS (
          SELECT 1
            FROM sport_center.payment_settlement_configs config
           WHERE config.company_id = $1
             AND lower(btrim(config.provider_code)) = $3
             AND config.bank_account_id = $5
             AND config.source = 'OWNER_APPROVED'
             AND config.rule_version IS NOT NULL
             AND btrim(config.rule_version) <> ''
             AND config.rule_version = mirror.rule_version
             AND config.effective_from = mirror.effective_from
             AND config.effective_until IS NOT DISTINCT FROM mirror.effective_until
        )
        AND mirror.is_active = TRUE
     RETURNING mirror.id`,
    [
      TARGET_COMPANY_ID,
      internalBankAccountId,
      TARGET_PROVIDER,
      MIRROR_SOURCE,
      TARGET_BANK_ACCOUNT,
    ],
  );

  let configChanged = false;
  if (String(legacy.rows[0].effective_until).slice(0, 10) === OLD_EFFECTIVE_UNTIL) {
    const update = await client.query(
      `UPDATE sport_center.payment_settlement_configs
          SET effective_until = $1::date,
              updated_by = $2,
              updated_at = NOW()
        WHERE id = $3
          AND effective_until = $4::date
        RETURNING id, rule_version, effective_from::text, effective_until::text, updated_by`,
      [SHARED_EFFECTIVE_FROM, ACTOR, legacy.rows[0].id, OLD_EFFECTIVE_UNTIL],
    );
    if (update.rowCount !== 1) {
      throw new Error(
        `QRIS_WINDOW_REPAIR_UPDATE_FAILED: expected 1 changed row, found ${update.rowCount}`,
      );
    }
    configChanged = true;
  }

  const routineChanges = [];
  for (const signature of [
    "sport_center.resolve_and_persist_payment_metadata(integer)",
    "sport_center.mirror_confirmed_payment_to_public()",
  ]) {
    const routine = await client.query(
      `SELECT pg_get_functiondef($1::regprocedure) AS definition`,
      [signature],
    );
    const definition = routine.rows[0]?.definition;
    if (!definition) {
      throw new Error(`QRIS_WINDOW_REPAIR_ROUTINE_MISSING: ${signature}`);
    }
    const occurrences = definition.split(HARD_CODED_RULE_LINE).length - 1;
    if (occurrences > 1) {
      throw new Error(
        `QRIS_WINDOW_REPAIR_ROUTINE_UNEXPECTED_MULTIPLE_PINS: ${signature} occurrences=${occurrences}`,
      );
    }
    if (occurrences === 1) {
      const refreshed = definition.replace(`\n         ${HARD_CODED_RULE_LINE}\n`, "\n");
      if (refreshed === definition) {
        throw new Error(`QRIS_WINDOW_REPAIR_ROUTINE_FORMAT_UNEXPECTED: ${signature}`);
      }
      await client.query(refreshed);
      routineChanges.push(signature);
    }
  }

  const coverage = await client.query(
    `SELECT COUNT(*)::int AS matching_rules,
            string_agg(rule_version, ',' ORDER BY id) AS versions
       FROM sport_center.payment_settlement_configs
      WHERE ${configPredicate}
        AND effective_from <= $4::date
        AND (effective_until IS NULL OR $4::date < effective_until)`,
    [TARGET_COMPANY_ID, TARGET_PROVIDER, TARGET_BANK_ACCOUNT, OLD_EFFECTIVE_UNTIL],
  );
  const coverageRow = coverage.rows[0] ?? {};
  if (coverageRow.matching_rules !== 1 || coverageRow.versions !== LEGACY_RULE_VERSION) {
    throw new Error(
      `QRIS_WINDOW_REPAIR_COVERAGE_FAILED: rules=${coverageRow.matching_rules ?? "null"} versions=${coverageRow.versions ?? "null"}`,
    );
  }

  const mirrorCoverage = await client.query(
    `SELECT
       (SELECT COUNT(*)::int
          FROM public.qris_provider_settlement_rules mirror
         WHERE mirror.company_id = $1
           AND mirror.bank_account_id = $2
           AND mirror.provider_code = $3
           AND mirror.source = $4
           AND mirror.is_active = TRUE) AS active_mirror_rules,
       (SELECT COUNT(*)::int
          FROM sport_center.payment_settlement_configs config
         WHERE config.company_id = $1
           AND lower(btrim(config.provider_code)) = $3
           AND config.bank_account_id = $5
           AND config.source = 'OWNER_APPROVED'
           AND config.rule_version IS NOT NULL
           AND btrim(config.rule_version) <> ''
           AND config.is_active = TRUE) AS active_canonical_rules,
       (SELECT COUNT(*)::int
          FROM public.qris_provider_settlement_rules mirror
         WHERE mirror.company_id = $1
           AND mirror.bank_account_id = $2
           AND mirror.provider_code = $3
           AND mirror.source = $4
           AND mirror.is_active = TRUE
           AND mirror.effective_from <= $6::date
           AND ($6::date < mirror.effective_until OR mirror.effective_until IS NULL)) AS target_date_mirror_rules`,
    [
      TARGET_COMPANY_ID,
      internalBankAccountId,
      TARGET_PROVIDER,
      MIRROR_SOURCE,
      TARGET_BANK_ACCOUNT,
      "2026-08-20",
    ],
  );
  const mirrorCoverageRow = mirrorCoverage.rows[0] ?? {};
  if (
    mirrorCoverageRow.active_mirror_rules !== mirrorCoverageRow.active_canonical_rules ||
    mirrorCoverageRow.target_date_mirror_rules !== 1
  ) {
    throw new Error(
      `QRIS_WINDOW_REPAIR_MIRROR_COVERAGE_FAILED: active_mirror=${mirrorCoverageRow.active_mirror_rules ?? "null"} active_canonical=${mirrorCoverageRow.active_canonical_rules ?? "null"} target_date=${mirrorCoverageRow.target_date_mirror_rules ?? "null"}`,
    );
  }

  await client.query("COMMIT");
  console.log(
    JSON.stringify(
      {
        applied: true,
        projectRef,
        companyId: TARGET_COMPANY_ID,
        providerCode: TARGET_PROVIDER,
        bankAccount: TARGET_BANK_ACCOUNT,
        repairedRuleVersion: LEGACY_RULE_VERSION,
        repairedEffectiveUntil: SHARED_EFFECTIVE_FROM,
        configChanged,
        routineChanges,
        mirrorBefore: mirrorBefore.rowCount,
        mirrorWindowRepaired: mirrorWindowRepair.rowCount,
        mirrorInserted: mirrorInserted.rowCount,
        mirrorSynced: mirrorSync.rowCount,
        mirrorDeactivated: mirrorDeactivated.rowCount,
        mirrorCoverage: mirrorCoverageRow,
        july13Coverage: coverageRow,
      },
      null,
      2,
    ),
  );
} catch (error) {
  await client.query("ROLLBACK").catch(() => {});
  throw error;
} finally {
  await client.end().catch(() => {});
}