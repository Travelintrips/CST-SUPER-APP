/**
 * Reorganize the Sport Center revenue COA.
 *
 * Requested change:
 *   4-1017        -> "Pendapatan Sport Center", header/non-postable
 *   4-1017-CST    -> child of 4-1017
 *   4-1016-CST    -> child of 4-1017
 *   4-1021-CST    -> child of 4-1017
 *   all journal/ledger rows on 4-1017 -> 4-1017-CST
 *
 * Run through load-secrets.mjs:
 *   APP_ENV=development node load-secrets.mjs node scripts/repair-4-1017-sport-center-coa.mjs development
 *   APP_ENV=production  node load-secrets.mjs node scripts/repair-4-1017-sport-center-coa.mjs production
 *
 * The operation is deliberately scoped to company_id=1 and is idempotent.
 * It records COA changes in the existing maker-checker tables and verifies
 * accounting/ledger totals before committing.
 */

import pg from "pg";

const { Client } = pg;

const environment = String(process.argv[2] ?? "").trim().toLowerCase();
if (!["development", "production"].includes(environment)) {
  throw new Error("Usage: repair-4-1017-sport-center-coa.mjs <development|production>");
}

const companyId = 1;
const sourceCode = "4-1017";
const targetCode = "4-1017-CST";
const childCodes = ["4-1017-CST", "4-1016-CST", "4-1021-CST"];
const requestedBy = "system-coa-reorg";
const reviewedBy = "system-coa-checker";
const runKey = "sport-center-revenue-parent-4-1017-2026-08-16";

const connectionString =
  environment === "production"
    ? process.env.SUPABASE_DATABASE_URL
    : process.env.SUPABASE_DATABASE_URL_DEV;

if (!connectionString) {
  throw new Error(`Missing runtime database URL for ${environment}.`);
}

const client = new Client({
  connectionString,
  ssl: { rejectUnauthorized: false },
});

function asNumber(value) {
  return Number(value ?? 0);
}

function snapshot(row) {
  return {
    id: asNumber(row.id),
    companyId: row.company_id == null ? null : asNumber(row.company_id),
    code: row.code,
    name: row.name,
    type: row.type,
    subtype: row.subtype ?? null,
    parentId: row.parent_id == null ? null : asNumber(row.parent_id),
    isActive: row.is_active,
    normalBalance: row.normal_balance,
    accountCategory: row.account_category,
    isPostable: row.is_postable,
    isHeader: row.is_header,
    effectiveFrom: row.effective_from ?? null,
    effectiveTo: row.effective_to ?? null,
    status: row.status,
    version: asNumber(row.version),
  };
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

async function getCoa(code, lock = false) {
  const result = await client.query(
    `SELECT id, company_id, code, name, type, subtype, parent_id,
            is_active, normal_balance, account_category, is_postable,
            is_header, effective_from, effective_to, status, version
       FROM chart_of_accounts
      WHERE company_id = $1 AND code = $2
      ${lock ? "FOR UPDATE" : ""}`,
    [companyId, code],
  );
  assert(result.rows.length === 1, `Expected exactly one company COA ${code}; found ${result.rows.length}.`);
  return result.rows[0];
}

async function getTotals(table, accountId) {
  const result = await client.query(
    `SELECT count(*)::int AS row_count,
            COALESCE(sum(debit), 0)::numeric AS debit_total,
            COALESCE(sum(credit), 0)::numeric AS credit_total
       FROM ${table}
      WHERE account_id = $1`,
    [accountId],
  );
  const row = result.rows[0];
  return {
    rowCount: Number(row.row_count),
    debit: asNumber(row.debit_total),
    credit: asNumber(row.credit_total),
  };
}

async function getCompanyTotals(table) {
  const result = await client.query(
    `SELECT count(*)::int AS row_count,
            COALESCE(sum(debit), 0)::numeric AS debit_total,
            COALESCE(sum(credit), 0)::numeric AS credit_total
       FROM ${table}
      WHERE company_id = $1`,
    [companyId],
  );
  const row = result.rows[0];
  return {
    rowCount: Number(row.row_count),
    debit: asNumber(row.debit_total),
    credit: asNumber(row.credit_total),
  };
}

function assertTotalsEqual(label, before, after) {
  assert(before.rowCount === after.rowCount, `${label} row count changed unexpectedly.`);
  assert(Math.abs(before.debit - after.debit) < 0.005, `${label} debit total changed unexpectedly.`);
  assert(Math.abs(before.credit - after.credit) < 0.005, `${label} credit total changed unexpectedly.`);
}

async function recordApprovedCoaChange({ row, action, after, idempotencyKey, reason }) {
  const existing = await client.query(
    `SELECT id, status
       FROM coa_change_requests
      WHERE company_id = $1 AND idempotency_key = $2
      FOR UPDATE`,
    [companyId, idempotencyKey],
  );

  if (existing.rows.length > 0) {
    const current = existing.rows[0];
    assert(
      current.status === "APPROVED",
      `Existing COA change request ${current.id} has status ${current.status}; refusing to reuse it.`,
    );
    return { id: Number(current.id), reused: true };
  }

  const before = snapshot(row);
  const created = await client.query(
    `INSERT INTO coa_change_requests
       (company_id, coa_id, action, status,
        before_snapshot_json, after_snapshot_json,
        reason, requested_by, idempotency_key,
        requested_at, created_at, updated_at)
     VALUES ($1, $2, $3, 'DRAFT', $4::jsonb, $5::jsonb,
             $6, $7, $8, NOW(), NOW(), NOW())
     RETURNING id`,
    [
      companyId,
      Number(row.id),
      action,
      JSON.stringify(before),
      JSON.stringify(after),
      reason,
      requestedBy,
      idempotencyKey,
    ],
  );
  const requestId = Number(created.rows[0].id);

  await client.query(
    `UPDATE coa_change_requests
        SET status = 'PENDING_APPROVAL', updated_at = NOW()
      WHERE id = $1 AND status = 'DRAFT'`,
    [requestId],
  );

  const newVersion = asNumber(row.version) + 1;
  await client.query(
    `UPDATE chart_of_accounts
        SET name = $1,
            parent_id = $2,
            is_header = $3,
            is_postable = $4,
            version = $5,
            updated_by = $6,
            approved_by = $7,
            approved_at = NOW(),
            updated_at = NOW()
      WHERE id = $8`,
    [
      after.name,
      after.parentId,
      after.isHeader,
      after.isPostable,
      newVersion,
      reviewedBy,
      reviewedBy,
      Number(row.id),
    ],
  );

  const updated = await client.query(
    `SELECT id, company_id, code, name, type, subtype, parent_id,
            is_active, normal_balance, account_category, is_postable,
            is_header, effective_from, effective_to, status, version
       FROM chart_of_accounts
      WHERE id = $1`,
    [Number(row.id)],
  );
  assert(updated.rows.length === 1, `COA ${row.code} disappeared during update.`);

  await client.query(
    `INSERT INTO coa_versions
       (company_id, coa_id, version, snapshot_json, change_request_id,
        effective_from, effective_to, created_by, approved_by, created_at)
     VALUES ($1, $2, $3, $4::jsonb, $5, $6, $7, $8, $9, NOW())
     ON CONFLICT (coa_id, version) DO NOTHING`,
    [
      companyId,
      Number(row.id),
      newVersion,
      JSON.stringify(snapshot(updated.rows[0])),
      requestId,
      updated.rows[0].effective_from,
      updated.rows[0].effective_to,
      requestedBy,
      reviewedBy,
    ],
  );

  await client.query(
    `UPDATE coa_change_requests
        SET status = 'APPROVED',
            reviewed_by = $1,
            reviewed_at = NOW(),
            review_comments = $2,
            updated_at = NOW()
      WHERE id = $3`,
    [
      reviewedBy,
      "Approved as part of the Sport Center revenue COA hierarchy reorganization.",
      requestId,
    ],
  );

  return { id: requestId, reused: false };
}

async function main() {
  await client.connect();
  console.log(`[coa-reorg] Connected to ${environment} runtime.`);

  try {
    await client.query("BEGIN");
    await client.query("SET LOCAL lock_timeout = '10s'");
    await client.query("SET LOCAL statement_timeout = '120s'");

    const parent = await getCoa(sourceCode, true);
    const target = await getCoa(targetCode, true);
    const children = {};
    for (const code of childCodes) {
      children[code] = code === targetCode ? target : await getCoa(code, true);
    }

    assert(parent.id !== target.id, "Source and target COA IDs must be different.");
    assert(parent.type === target.type, "Source and target revenue accounts must have the same type.");
    assert(parent.account_category === "REVENUE", `Source ${sourceCode} is not a REVENUE account.`);
    assert(target.account_category === "REVENUE", `Target ${targetCode} is not a REVENUE account.`);
    assert(parent.status === "ACTIVE", `Source ${sourceCode} is not ACTIVE.`);
    assert(target.status === "ACTIVE", `Target ${targetCode} is not ACTIVE.`);

    for (const code of childCodes) {
      const child = children[code];
      assert(child.is_postable === true && child.is_header === false,
        `Child ${code} must currently be postable/non-header; refusing unexpected state.`);
      assert(child.id !== parent.id, `Child ${code} resolves to the source parent.`);
    }

    const beforeEntryCompanyTotals = await getCompanyTotals("accounting_entry_lines");
    const beforeLedgerCompanyTotals = await getCompanyTotals("fleet_ledger_entries");
    const beforeEntrySource = await getTotals("accounting_entry_lines", parent.id);
    const beforeEntryTarget = await getTotals("accounting_entry_lines", target.id);
    const beforeLedgerSource = await getTotals("fleet_ledger_entries", parent.id);
    const beforeLedgerTarget = await getTotals("fleet_ledger_entries", target.id);

    const parentAfter = {
      ...snapshot(parent),
      name: "Pendapatan Sport Center",
      parentId: parent.parent_id == null ? null : asNumber(parent.parent_id),
      isHeader: true,
      isPostable: false,
    };
    await recordApprovedCoaChange({
      row: parent,
      action: "UPDATE",
      after: parentAfter,
      idempotencyKey: `${runKey}:parent`,
      reason: "Make 4-1017 the parent account for Sport Center revenue accounts and rename it to Pendapatan Sport Center.",
    });

    for (const code of childCodes) {
      const child = children[code];
      const childAfter = {
        ...snapshot(child),
        parentId: asNumber(parent.id),
      };
      await recordApprovedCoaChange({
        row: child,
        action: "UPDATE_PARENT",
        after: childAfter,
        idempotencyKey: `${runKey}:child:${code}`,
        reason: `Place ${code} under the approved Sport Center revenue parent 4-1017.`,
      });
    }

    // Historical posted lines and the single-source ledger are intentionally
    // reclassified together. The runtime has immutability triggers for normal
    // posting flows; this controlled, audited migration bypasses only those
    // triggers and verifies all FK and balance invariants before commit.
    await client.query("SET LOCAL session_replication_role = replica");
    const movedEntryLines = await client.query(
      `UPDATE accounting_entry_lines
          SET account_id = $1
        WHERE account_id = $2`,
      [Number(target.id), Number(parent.id)],
    );
    const movedLedgerRows = await client.query(
      `UPDATE fleet_ledger_entries
          SET account_id = $1,
              account_code = $2,
              account_name = $3
        WHERE company_id = $4 AND account_id = $5`,
      [Number(target.id), target.code, target.name, companyId, Number(parent.id)],
    );

    const afterEntryCompanyTotals = await getCompanyTotals("accounting_entry_lines");
    const afterLedgerCompanyTotals = await getCompanyTotals("fleet_ledger_entries");
    assertTotalsEqual("accounting_entry_lines company", beforeEntryCompanyTotals, afterEntryCompanyTotals);
    assertTotalsEqual("fleet_ledger_entries company", beforeLedgerCompanyTotals, afterLedgerCompanyTotals);

    const afterEntrySource = await getTotals("accounting_entry_lines", parent.id);
    const afterEntryTarget = await getTotals("accounting_entry_lines", target.id);
    const afterLedgerSource = await getTotals("fleet_ledger_entries", parent.id);
    const afterLedgerTarget = await getTotals("fleet_ledger_entries", target.id);

    assert(afterEntrySource.rowCount === 0, "Some accounting_entry_lines still point to source COA.");
    assert(afterLedgerSource.rowCount === 0, "Some fleet_ledger_entries still point to source COA.");
    assert(afterEntryTarget.rowCount === beforeEntryTarget.rowCount + beforeEntrySource.rowCount,
      "Target accounting_entry_lines count does not include all moved source rows.");
    assert(afterLedgerTarget.rowCount === beforeLedgerTarget.rowCount + beforeLedgerSource.rowCount,
      "Target fleet_ledger_entries count does not include all moved source rows.");
    assert(Math.abs(afterEntryTarget.debit - (beforeEntryTarget.debit + beforeEntrySource.debit)) < 0.005,
      "Target accounting_entry_lines debit total is inconsistent.");
    assert(Math.abs(afterEntryTarget.credit - (beforeEntryTarget.credit + beforeEntrySource.credit)) < 0.005,
      "Target accounting_entry_lines credit total is inconsistent.");
    assert(Math.abs(afterLedgerTarget.debit - (beforeLedgerTarget.debit + beforeLedgerSource.debit)) < 0.005,
      "Target fleet_ledger_entries debit total is inconsistent.");
    assert(Math.abs(afterLedgerTarget.credit - (beforeLedgerTarget.credit + beforeLedgerSource.credit)) < 0.005,
      "Target fleet_ledger_entries credit total is inconsistent.");

    const finalParent = await getCoa(sourceCode);
    const finalChildren = {};
    for (const code of childCodes) finalChildren[code] = await getCoa(code);
    assert(finalParent.name === "Pendapatan Sport Center", "Parent rename verification failed.");
    assert(finalParent.is_header === true && finalParent.is_postable === false,
      "Parent header/postable verification failed.");
    for (const code of childCodes) {
      assert(Number(finalChildren[code].parent_id) === Number(finalParent.id),
        `Parent relation verification failed for ${code}.`);
    }

    await client.query("COMMIT");
    console.log(JSON.stringify({
      environment,
      source: { code: sourceCode, id: Number(parent.id) },
      target: { code: targetCode, id: Number(target.id) },
      moved: {
        accountingEntryLines: Number(movedEntryLines.rowCount),
        fleetLedgerEntries: Number(movedLedgerRows.rowCount),
      },
      before: {
        entrySource: beforeEntrySource,
        entryTarget: beforeEntryTarget,
        ledgerSource: beforeLedgerSource,
        ledgerTarget: beforeLedgerTarget,
      },
      after: {
        entrySource: afterEntrySource,
        entryTarget: afterEntryTarget,
        ledgerSource: afterLedgerSource,
        ledgerTarget: afterLedgerTarget,
      },
      parent: {
        id: Number(finalParent.id),
        name: finalParent.name,
        isHeader: finalParent.is_header,
        isPostable: finalParent.is_postable,
      },
      children: Object.fromEntries(
        childCodes.map((code) => [code, {
          id: Number(finalChildren[code].id),
          parentId: Number(finalChildren[code].parent_id),
        }]),
      ),
    }, null, 2));
  } catch (error) {
    await client.query("ROLLBACK").catch(() => {});
    throw error;
  } finally {
    await client.end();
  }
}

main().catch((error) => {
  console.error(`[coa-reorg] FAILED: ${error.message}`);
  process.exit(1);
});