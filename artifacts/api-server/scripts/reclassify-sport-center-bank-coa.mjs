/**
 * Reclassify Sport Center bank lines from the non-postable CST header to the
 * existing postable Ciputat child account.
 *
 * Scope:
 *   company_id = 1
 *   source     = sport_center_booking
 *   status     = posted
 *   ref        = SC-* or SCPAY-*
 *   current account_id = 49098 (1-1020-CST)
 *
 * This is a controlled historical correction approved after the production
 * audit. It preserves journal totals and leaves OTHER references untouched.
 *
 * Usage:
 *   APP_ENV=production node load-secrets.mjs \
 *     node scripts/reclassify-sport-center-bank-coa.mjs --apply
 */

import pg from "pg";

const { Client } = pg;

const COMPANY_ID = 1;
const SOURCE = "sport_center_booking";
const HEADER_ID = 49098;
const HEADER_CODE = "1-1020-CST";
const CHILD_ID = 75590;
const CHILD_CODE = "1-1023-CST";
const BANK_ACCOUNT_ID = 2;
const BANK_JOURNAL_ID = 8194;
const EXPECTED_LINE_COUNT = 313;
const EXPECTED_ENTRY_COUNT = 313;
const EXPECTED_DEBIT = 62885007;
const RUN_KEY = "sport-center-bank-reclass-sc-scpay-2026-08-16";

if (process.env.APP_ENV !== "production") {
  throw new Error("This production correction requires APP_ENV=production.");
}
if (!process.argv.includes("--apply")) {
  throw new Error("Refusing to write without the explicit --apply flag.");
}

const connectionString = process.env.SUPABASE_DATABASE_URL;
if (!connectionString) {
  throw new Error("SUPABASE_DATABASE_URL is required.");
}

const client = new Client({
  connectionString,
  ssl: { rejectUnauthorized: false },
});

function numberValue(value) {
  return Number(value ?? 0);
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

async function getScopeStats() {
  const result = await client.query(`
    WITH selected_entries AS (
      SELECT DISTINCT ae.id
      FROM accounting_entries ae
      JOIN accounting_entry_lines ael ON ael.entry_id = ae.id
      WHERE ae.company_id = $1
        AND ae.source = $2
        AND ae.status = 'posted'
        AND (ae.ref LIKE 'SC-%' OR ae.ref LIKE 'SCPAY-%')
        AND ael.account_id = $3
    )
    SELECT
      COUNT(DISTINCT ae.id)::int AS entry_count,
      COUNT(ael.id)::int AS line_count,
      COALESCE(SUM(ael.debit), 0)::numeric AS debit,
      COALESCE(SUM(ael.credit), 0)::numeric AS credit
    FROM accounting_entries ae
    JOIN accounting_entry_lines ael ON ael.entry_id = ae.id
    WHERE ae.id IN (SELECT id FROM selected_entries)
      AND ael.account_id = $3
  `, [COMPANY_ID, SOURCE, HEADER_ID]);

  const row = result.rows[0];
  return {
    entries: numberValue(row.entry_count),
    lines: numberValue(row.line_count),
    debit: numberValue(row.debit),
    credit: numberValue(row.credit),
  };
}

async function getSelectedEntryTotals() {
  const result = await client.query(`
    WITH selected_entries AS (
      SELECT DISTINCT ae.id
      FROM accounting_entries ae
      JOIN accounting_entry_lines ael ON ael.entry_id = ae.id
      WHERE ae.company_id = $1
        AND ae.source = $2
        AND ae.status = 'posted'
        AND (ae.ref LIKE 'SC-%' OR ae.ref LIKE 'SCPAY-%')
        AND ael.account_id IN ($3, $4)
    ),
    per_entry AS (
      SELECT
        ae.id,
        COALESCE(SUM(ael.debit), 0) AS debit,
        COALESCE(SUM(ael.credit), 0) AS credit
      FROM accounting_entries ae
      JOIN accounting_entry_lines ael ON ael.entry_id = ae.id
      WHERE ae.id IN (SELECT id FROM selected_entries)
      GROUP BY ae.id
    )
    SELECT
      COUNT(*)::int AS entry_count,
      COUNT(*) FILTER (WHERE ABS(debit - credit) > 0.01)::int AS unbalanced,
      COALESCE(SUM(debit), 0)::numeric AS debit,
      COALESCE(SUM(credit), 0)::numeric AS credit
    FROM per_entry
  `, [COMPANY_ID, SOURCE, HEADER_ID, CHILD_ID]);

  const row = result.rows[0];
  return {
    entries: numberValue(row.entry_count),
    unbalanced: numberValue(row.unbalanced),
    debit: numberValue(row.debit),
    credit: numberValue(row.credit),
  };
}

async function getOtherHeaderStats() {
  const result = await client.query(`
    SELECT
      COUNT(*)::int AS line_count,
      COALESCE(SUM(ael.debit), 0)::numeric AS debit,
      COALESCE(SUM(ael.credit), 0)::numeric AS credit
    FROM accounting_entry_lines ael
    JOIN accounting_entries ae ON ae.id = ael.entry_id
    WHERE ae.company_id = $1
      AND ae.source = $2
      AND ae.status = 'posted'
      AND (ae.ref IS NULL OR (ae.ref NOT LIKE 'SC-%' AND ae.ref NOT LIKE 'SCPAY-%'))
      AND ael.account_id = $3
  `, [COMPANY_ID, SOURCE, HEADER_ID]);

  const row = result.rows[0];
  return {
    lines: numberValue(row.line_count),
    debit: numberValue(row.debit),
    credit: numberValue(row.credit),
  };
}

async function getAccount(id, lock = false) {
  const result = await client.query(`
    SELECT id, company_id, code, name, type::text AS type, subtype,
           parent_id, is_active, is_postable, is_header,
           normal_balance::text AS normal_balance,
           account_category::text AS account_category,
           status::text AS status, version
    FROM chart_of_accounts
    WHERE id = $1
    ${lock ? "FOR UPDATE" : ""}
  `, [id]);

  assert(result.rows.length === 1, `Expected exactly one COA account id=${id}.`);
  return result.rows[0];
}

function assertChildContract(child) {
  assert(child.code === CHILD_CODE, `Target code is ${child.code}, expected ${CHILD_CODE}.`);
  assert(Number(child.parent_id) === HEADER_ID, "Target is not a child of the CST header.");
  assert(child.is_postable === true && child.is_header === false,
    "Target must be postable and non-header.");
  assert(child.is_active === true && child.status === "ACTIVE",
    "Target must be active.");
  assert(child.account_category === "ASSET", "Target must be an ASSET account.");
}

async function getMapping() {
  const result = await client.query(`
    SELECT
      (SELECT default_bank_account_id FROM accounting_settings WHERE company_id = $1 LIMIT 1) AS settings_account_id,
      (SELECT default_debit_account_id FROM accounting_journals WHERE id = $2) AS journal_debit_id,
      (SELECT default_credit_account_id FROM accounting_journals WHERE id = $2) AS journal_credit_id,
      (SELECT coa_id FROM company_bank_accounts WHERE id = $3 AND company_id = $1) AS bank_account_coa_id
  `, [COMPANY_ID, BANK_JOURNAL_ID, BANK_ACCOUNT_ID]);

  const row = result.rows[0];
  return {
    settings: row.settings_account_id == null ? null : Number(row.settings_account_id),
    journalDebit: row.journal_debit_id == null ? null : Number(row.journal_debit_id),
    journalCredit: row.journal_credit_id == null ? null : Number(row.journal_credit_id),
    bankAccount: row.bank_account_coa_id == null ? null : Number(row.bank_account_coa_id),
  };
}

function assertMappingBefore(mapping) {
  assert(mapping.settings === CHILD_ID,
    `accounting_settings.default_bank_account_id=${mapping.settings}, expected ${CHILD_ID}.`);
  assert(mapping.journalDebit === CHILD_ID && mapping.journalCredit === CHILD_ID,
    `BNK-CST defaults are ${mapping.journalDebit}/${mapping.journalCredit}, expected ${CHILD_ID}.`);
  assert(mapping.bankAccount === HEADER_ID,
    `company_bank_accounts#${BANK_ACCOUNT_ID}.coa_id=${mapping.bankAccount}, expected stale header ${HEADER_ID}.`);
}

function assertMappingAfter(mapping) {
  assert(mapping.settings === CHILD_ID, "Accounting settings mapping changed unexpectedly.");
  assert(mapping.journalDebit === CHILD_ID && mapping.journalCredit === CHILD_ID,
    "BNK-CST mapping changed unexpectedly.");
  assert(mapping.bankAccount === CHILD_ID,
    `company_bank_accounts#${BANK_ACCOUNT_ID}.coa_id=${mapping.bankAccount}, expected ${CHILD_ID}.`);
}

function assertStats(label, actual, expected) {
  for (const [key, value] of Object.entries(expected)) {
    assert(Math.abs(actual[key] - value) < 0.005,
      `${label}.${key}=${actual[key]}, expected ${value}.`);
  }
}

async function main() {
  await client.connect();
  try {
    await client.query("BEGIN");
    await client.query("SET LOCAL lock_timeout = '10s'");
    await client.query("SET LOCAL statement_timeout = '120s'");

    const header = await getAccount(HEADER_ID, true);
    const child = await getAccount(CHILD_ID, true);
    assert(header.code === HEADER_CODE, `Source id ${HEADER_ID} is ${header.code}.`);
    assert(header.is_header === true && header.is_postable === false,
      "Source must remain the non-postable CST header.");
    assertChildContract(child);

    const mappingBefore = await getMapping();
    assertMappingBefore(mappingBefore);

    const before = await getScopeStats();
    assertStats("scope before", before, {
      entries: EXPECTED_ENTRY_COUNT,
      lines: EXPECTED_LINE_COUNT,
      debit: EXPECTED_DEBIT,
      credit: 0,
    });

    const selectedTotalsBefore = await getSelectedEntryTotals();
    assertStats("selected totals before", selectedTotalsBefore, {
      entries: EXPECTED_ENTRY_COUNT,
      debit: EXPECTED_DEBIT,
      credit: EXPECTED_DEBIT,
      unbalanced: 0,
    });

    const otherBefore = await getOtherHeaderStats();

    // Posted journal lines are immutable during ordinary application flows.
    // This approved, narrowly-scoped correction bypasses those triggers only
    // inside this transaction, then checks all journal and scope invariants.
    await client.query("SET LOCAL session_replication_role = replica");
    const moved = await client.query(`
      UPDATE accounting_entry_lines ael
      SET account_id = $1
      FROM accounting_entries ae
      WHERE ael.entry_id = ae.id
        AND ae.company_id = $2
        AND ae.source = $3
        AND ae.status = 'posted'
        AND (ae.ref LIKE 'SC-%' OR ae.ref LIKE 'SCPAY-%')
        AND ael.account_id = $4
    `, [CHILD_ID, COMPANY_ID, SOURCE, HEADER_ID]);
    assert(Number(moved.rowCount) === EXPECTED_LINE_COUNT,
      `Moved ${moved.rowCount} lines, expected ${EXPECTED_LINE_COUNT}.`);

    const bankUpdate = await client.query(`
      UPDATE company_bank_accounts
      SET name = 'Bank Mandiri Ciputat',
          coa_id = $1,
          updated_at = NOW()
      WHERE id = $2 AND company_id = $3
    `, [CHILD_ID, BANK_ACCOUNT_ID, COMPANY_ID]);
    assert(Number(bankUpdate.rowCount) === 1,
      `Expected one company bank account update, got ${bankUpdate.rowCount}.`);

    const after = await getScopeStats();
    assert(after.entries === 0 && after.lines === 0 && after.debit === 0 && after.credit === 0,
      `Source account still has selected lines: ${JSON.stringify(after)}.`);

    const targetAfter = await client.query(`
      SELECT
        COUNT(*)::int AS line_count,
        COALESCE(SUM(ael.debit), 0)::numeric AS debit,
        COALESCE(SUM(ael.credit), 0)::numeric AS credit
      FROM accounting_entry_lines ael
      JOIN accounting_entries ae ON ae.id = ael.entry_id
      WHERE ae.company_id = $1
        AND ae.source = $2
        AND ae.status = 'posted'
        AND (ae.ref LIKE 'SC-%' OR ae.ref LIKE 'SCPAY-%')
        AND ael.account_id = $3
    `, [COMPANY_ID, SOURCE, CHILD_ID]);
    const targetRow = targetAfter.rows[0];
    assertStats("target after", {
      lines: numberValue(targetRow.line_count),
      debit: numberValue(targetRow.debit),
      credit: numberValue(targetRow.credit),
    }, { lines: EXPECTED_LINE_COUNT, debit: EXPECTED_DEBIT, credit: 0 });

    const selectedTotalsAfter = await getSelectedEntryTotals();
    assertStats("selected totals after", selectedTotalsAfter, {
      entries: EXPECTED_ENTRY_COUNT,
      debit: EXPECTED_DEBIT,
      credit: EXPECTED_DEBIT,
      unbalanced: 0,
    });

    const otherAfter = await getOtherHeaderStats();
    assertStats("OTHER header preservation", otherAfter, otherBefore);

    const mappingAfter = await getMapping();
    assertMappingAfter(mappingAfter);

    await client.query("COMMIT");
    console.log(JSON.stringify({
      runKey: RUN_KEY,
      environment: "production",
      scope: {
        references: ["SC-*", "SCPAY-*"],
        entries: EXPECTED_ENTRY_COUNT,
        linesMoved: Number(moved.rowCount),
        debitMoved: EXPECTED_DEBIT,
      },
      source: { id: HEADER_ID, code: HEADER_CODE },
      target: { id: CHILD_ID, code: CHILD_CODE },
      bankAccount: {
        id: BANK_ACCOUNT_ID,
        coaId: CHILD_ID,
        name: "Bank Mandiri Ciputat",
      },
      invariants: {
        selectedJournalsBalanced: true,
        otherReferencesPreserved: true,
        settingsAndJournalDefaultsPreserved: true,
      },
    }, null, 2));
  } catch (error) {
    await client.query("ROLLBACK").catch(() => {});
    throw error;
  } finally {
    await client.end();
  }
}

main().catch((error) => {
  console.error(`[sport-center-bank-reclass] FAILED: ${error.message}`);
  process.exit(1);
});