#!/usr/bin/env node
/**
 * Repair the owner-approved historical Mandiri QRIS rule window and refresh
 * the two live owner routines that previously pinned one rule version.
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