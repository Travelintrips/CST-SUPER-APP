#!/usr/bin/env node

import fs from "node:fs/promises";
import pg from "pg";
import { getTaxCoaTargetStructure } from "../../artifacts/api-server/src/lib/coa/coaTaxMigration.ts";
import {
  TAX_MIGRATION_MAKER,
  compareLedgerTotals,
  deriveExpectedTaxRequests,
  hasRejectionDocumentation,
  hasReviewDocumentation,
} from "./tax-coa-activation-contract.mjs";

const { Client } = pg;

function parseArgs(argv) {
  const args = {
    companyId: null,
    compare: null,
    phase: "snapshot",
    writeReport: null,
    json: false,
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--") continue;
    if (arg === "--help" || arg === "-h") {
      args.help = true;
    } else if (arg === "--json") {
      args.json = true;
    } else if (arg === "--company-id") {
      args.companyId = Number(argv[++index]);
    } else if (arg === "--compare") {
      args.compare = argv[++index];
    } else if (arg === "--phase") {
      args.phase = argv[++index];
    } else if (arg === "--write-report") {
      args.writeReport = argv[++index];
    } else {
      throw new Error(`Unknown argument: ${arg}`);
    }
  }

  if (args.companyId !== null && !Number.isInteger(args.companyId)) {
    throw new Error("--company-id must be an integer.");
  }
  if (!["before", "after", "snapshot"].includes(args.phase)) {
    throw new Error("--phase must be before, after, or snapshot.");
  }
  return args;
}

function printHelp() {
  console.log(`
Read-only tax COA activation gate.

Usage:
  bash scripts/verify-tax-coa-activation.sh [options]

Options:
  --phase before|after|snapshot  Label the ledger capture (default: snapshot)
  --compare FILE                 Compare current ledger totals with a prior report
  --write-report FILE            Write the JSON report to FILE
  --company-id ID                Restrict the check to one company
  --json                         Print the complete report as JSON
`);
}

function issue(code, message, context = {}) {
  return { code, message, ...context };
}

function numericString(value) {
  return value === null || value === undefined ? "0" : String(value);
}

function sortedObject(value) {
  if (Array.isArray(value)) return value.map(sortedObject);
  if (!value || typeof value !== "object") return value;
  return Object.fromEntries(
    Object.entries(value)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, child]) => [key, sortedObject(child)]),
  );
}

function normalizeTotals(value) {
  return sortedObject(value);
}

async function collectLedgerTotals(client, companyIds) {
  const [journals, entries, lines] = await Promise.all([
    client.query(
      `SELECT company_id, COUNT(*)::int AS count
         FROM accounting_journals
        WHERE company_id = ANY($1::int[])
        GROUP BY company_id
        ORDER BY company_id`,
      [companyIds],
    ),
    client.query(
      `SELECT company_id,
              COUNT(*)::int AS count,
              COALESCE(SUM(total_debit), 0)::text AS total_debit,
              COALESCE(SUM(total_credit), 0)::text AS total_credit
         FROM accounting_entries
        WHERE company_id = ANY($1::int[])
        GROUP BY company_id
        ORDER BY company_id`,
      [companyIds],
    ),
    client.query(
      `SELECT e.company_id,
              COUNT(l.id)::int AS count,
              COALESCE(SUM(l.debit), 0)::text AS total_debit,
              COALESCE(SUM(l.credit), 0)::text AS total_credit
         FROM accounting_entry_lines l
         JOIN accounting_entries e ON e.id = l.entry_id
        WHERE e.company_id = ANY($1::int[])
        GROUP BY e.company_id
        ORDER BY e.company_id`,
      [companyIds],
    ),
  ]);

  const byCompany = new Map();
  for (const companyId of companyIds) {
    byCompany.set(String(companyId), {
      journals: { count: 0 },
      entries: { count: 0, totalDebit: "0", totalCredit: "0" },
      entryLines: { count: 0, totalDebit: "0", totalCredit: "0" },
    });
  }

  for (const row of journals.rows) {
    byCompany.get(String(row.company_id)).journals = {
      count: Number(row.count),
    };
  }
  for (const row of entries.rows) {
    byCompany.get(String(row.company_id)).entries = {
      count: Number(row.count),
      totalDebit: numericString(row.total_debit),
      totalCredit: numericString(row.total_credit),
    };
  }
  for (const row of lines.rows) {
    byCompany.get(String(row.company_id)).entryLines = {
      count: Number(row.count),
      totalDebit: numericString(row.total_debit),
      totalCredit: numericString(row.total_credit),
    };
  }

  return Object.fromEntries(byCompany);
}

function indexRows(rows, key) {
  const indexed = new Map();
  for (const row of rows) {
    const value = row[key];
    const current = indexed.get(value) ?? [];
    current.push(row);
    indexed.set(value, current);
  }
  return indexed;
}

function asJson(value) {
  return value && typeof value === "object" ? value : {};
}

async function inspectCompany(client, company, targetStructure) {
  const expected = deriveExpectedTaxRequests(targetStructure, company);
  const expectedKeys = expected.map((item) => item.idempotencyKey);
  const expectedCodes = [
    ...expected.map((item) => item.code),
    ...expected.filter((item) => item.kind === "reparent").map((item) => item.parentCode),
  ];
  const expectedByKey = new Map(expected.map((item) => [item.idempotencyKey, item]));
  const issues = [];

  const requestResult = await client.query(
    `SELECT id, company_id, coa_id, action, status,
            before_snapshot_json, after_snapshot_json, reason,
            requested_by, requested_at, reviewed_by, reviewed_at,
            review_comments, idempotency_key
       FROM coa_change_requests
      WHERE company_id = $1
        AND requested_by = $2
        AND idempotency_key = ANY($3::text[])
      ORDER BY id`,
    [company.id, TAX_MIGRATION_MAKER, expectedKeys],
  );
  const requestsByKey = indexRows(requestResult.rows, "idempotency_key");

  const accountResult = await client.query(
    `SELECT child.id, child.company_id, child.code, child.name,
            child.status, child.is_active, child.is_header, child.is_postable,
            child.parent_id, child.version,
            parent.code AS parent_code,
            parent.company_id AS parent_company_id
       FROM chart_of_accounts child
       LEFT JOIN chart_of_accounts parent ON parent.id = child.parent_id
      WHERE child.company_id = $1
        AND child.code = ANY($2::text[])
      ORDER BY child.code, child.id`,
    [company.id, expectedCodes],
  );
  const accountsByCode = indexRows(accountResult.rows, "code");

  const duplicateResult = await client.query(
    `SELECT code, COUNT(*)::int AS count
       FROM chart_of_accounts
      WHERE company_id = $1
        AND code = ANY($2::text[])
      GROUP BY code
     HAVING COUNT(*) > 1
      ORDER BY code`,
    [company.id, expectedCodes],
  );
  for (const duplicate of duplicateResult.rows) {
    issues.push(issue(
      "DUPLICATE_TAX_CODE",
      `Tax COA code ${duplicate.code} exists ${duplicate.count} times.`,
      { companyId: company.id, code: duplicate.code },
    ));
  }

  const requestIds = requestResult.rows.map((row) => row.id);
  const versionResult = requestIds.length === 0
    ? { rows: [] }
    : await client.query(
      `SELECT id, company_id, coa_id, version, snapshot_json,
              change_request_id, created_by, approved_by
         FROM coa_versions
        WHERE company_id = $1
          AND change_request_id = ANY($2::int[])
        ORDER BY change_request_id, id`,
      [company.id, requestIds],
    );
  const versionsByRequest = indexRows(versionResult.rows, "change_request_id");

  const result = {
    companyId: company.id,
    companyCode: company.abbr,
    expectedCount: expected.length,
    requestCount: requestResult.rows.length,
    requests: {
      approved: 0,
      rejected: 0,
      incomplete: 0,
    },
    activeAccounts: 0,
    versionSnapshots: 0,
  };

  for (const expectedRequest of expected) {
    const matchingRequests = requestsByKey.get(expectedRequest.idempotencyKey) ?? [];
    if (matchingRequests.length === 0) {
      result.requests.incomplete += 1;
      issues.push(issue(
        "MISSING_CHANGE_REQUEST",
        `Missing tax COA change request for ${expectedRequest.code}.`,
        { companyId: company.id, idempotencyKey: expectedRequest.idempotencyKey },
      ));
      continue;
    }
    if (matchingRequests.length > 1) {
      issues.push(issue(
        "DUPLICATE_CHANGE_REQUEST",
        `Multiple change requests found for ${expectedRequest.code}.`,
        { companyId: company.id, idempotencyKey: expectedRequest.idempotencyKey, count: matchingRequests.length },
      ));
    }

    const request = matchingRequests[0];
    const after = asJson(request.after_snapshot_json);
    const accounts = accountsByCode.get(expectedRequest.code) ?? [];
    const versions = versionsByRequest.get(request.id) ?? [];
    const status = String(request.status);

    if (request.action !== expectedRequest.action) {
      issues.push(issue(
        "ACTION_MISMATCH",
        `Request ${request.id} for ${expectedRequest.code} has action ${request.action}, expected ${expectedRequest.action}.`,
        { companyId: company.id, requestId: request.id },
      ));
    }
    if (request.requested_by !== TAX_MIGRATION_MAKER || !String(request.reason ?? "").trim()) {
      issues.push(issue(
        "REQUEST_DOCUMENTATION_INCOMPLETE",
        `Request ${request.id} is missing its migration maker or reason.`,
        { companyId: company.id, requestId: request.id },
      ));
    }

    if (status === "APPROVED") {
      result.requests.approved += 1;
      if (!hasReviewDocumentation(request)) {
        issues.push(issue(
          "APPROVAL_DOCUMENTATION_INCOMPLETE",
          `Approved request ${request.id} has no reviewer and review timestamp.`,
          { companyId: company.id, requestId: request.id },
        ));
      }
      if (accounts.length !== 1) {
        issues.push(issue(
          "APPROVED_ACCOUNT_MISSING_OR_DUPLICATE",
          `Approved request ${request.id} resolves to ${accounts.length} accounts for ${expectedRequest.code}.`,
          { companyId: company.id, requestId: request.id, code: expectedRequest.code },
        ));
      } else {
        const account = accounts[0];
        if (account.status !== "ACTIVE" || account.is_active !== true) {
          issues.push(issue(
            "APPROVED_ACCOUNT_NOT_ACTIVE",
            `Approved account ${expectedRequest.code} is not ACTIVE.`,
            { companyId: company.id, code: expectedRequest.code, status: account.status },
          ));
        } else {
          result.activeAccounts += 1;
        }

        if (expectedRequest.kind === "header") {
          if (account.is_header !== true || account.is_postable !== false) {
            issues.push(issue(
              "HEADER_POLICY_MISMATCH",
              `Header ${expectedRequest.code} must be header=true and postable=false.`,
              { companyId: company.id, code: expectedRequest.code },
            ));
          }
        } else if (expectedRequest.kind === "child") {
          if (account.is_header !== false || account.is_postable !== true) {
            issues.push(issue(
              "CHILD_POLICY_MISMATCH",
              `Child ${expectedRequest.code} must be header=false and postable=true.`,
              { companyId: company.id, code: expectedRequest.code },
            ));
          }
        }

        if (account.parent_code !== expectedRequest.parentCode) {
          issues.push(issue(
            "PARENT_HIERARCHY_MISMATCH",
            `${expectedRequest.code} points to ${account.parent_code ?? "(null)"}, expected ${expectedRequest.parentCode}.`,
            { companyId: company.id, code: expectedRequest.code, expectedParent: expectedRequest.parentCode },
          ));
        }
      }

      if (request.coa_id == null) {
        issues.push(issue(
          "APPROVED_REQUEST_MISSING_COA_ID",
          `Approved request ${request.id} has no coa_id.`,
          { companyId: company.id, requestId: request.id },
        ));
      }
      if (versions.length !== 1) {
        issues.push(issue(
          "VERSION_SNAPSHOT_MISSING_OR_DUPLICATE",
          `Approved request ${request.id} has ${versions.length} version snapshots; expected exactly one.`,
          { companyId: company.id, requestId: request.id },
        ));
      } else {
        const version = versions[0];
        result.versionSnapshots += 1;
        if (version.coa_id !== request.coa_id || !version.approved_by || !version.snapshot_json) {
          issues.push(issue(
            "VERSION_SNAPSHOT_INCOMPLETE",
            `Version snapshot for request ${request.id} is incomplete or not linked to the approved COA.`,
            { companyId: company.id, requestId: request.id },
          ));
        }
        if (accounts.length === 1 && Number(version.version) !== Number(accounts[0].version)) {
          issues.push(issue(
            "VERSION_NUMBER_MISMATCH",
            `Version snapshot for ${expectedRequest.code} does not match the live COA version.`,
            { companyId: company.id, requestId: request.id, liveVersion: accounts[0].version, snapshotVersion: version.version },
          ));
        }
        const snapshot = asJson(version.snapshot_json);
        if (snapshot.code !== expectedRequest.code || snapshot.companyId !== company.id) {
          issues.push(issue(
            "VERSION_CONTENT_MISMATCH",
            `Version snapshot for ${expectedRequest.code} does not describe the expected account.`,
            { companyId: company.id, requestId: request.id },
          ));
        }
      }
    } else if (status === "REJECTED") {
      result.requests.rejected += 1;
      if (!hasRejectionDocumentation(request)) {
        issues.push(issue(
          "REJECTION_DOCUMENTATION_INCOMPLETE",
          `Rejected request ${request.id} requires reviewer, timestamp, and review comments.`,
          { companyId: company.id, requestId: request.id },
        ));
      }
      if (versions.length > 0) {
        issues.push(issue(
          "REJECTED_REQUEST_HAS_VERSION",
          `Rejected request ${request.id} has a version snapshot.`,
          { companyId: company.id, requestId: request.id },
        ));
      }
      if (expectedRequest.action === "CREATE" && accounts.some((account) => account.status === "ACTIVE" && account.is_active === true)) {
        issues.push(issue(
          "REJECTED_REQUEST_STILL_ACTIVE",
          `Rejected CREATE request ${request.id} still has an active account ${expectedRequest.code}.`,
          { companyId: company.id, requestId: request.id },
        ));
      }
      issues.push(issue(
        "TAX_ACTIVATION_REJECTED",
        `Tax COA activation request ${request.id} was rejected and remains incomplete.`,
        { companyId: company.id, requestId: request.id, code: expectedRequest.code },
      ));
    } else {
      result.requests.incomplete += 1;
      issues.push(issue(
        "TAX_ACTIVATION_INCOMPLETE",
        `Tax COA request ${request.id} for ${expectedRequest.code} is ${status}, not APPROVED.`,
        { companyId: company.id, requestId: request.id, status, code: expectedRequest.code },
      ));
    }

    if (after.code && after.code !== expectedRequest.code && expectedRequest.action === "CREATE") {
      issues.push(issue(
        "REQUEST_CODE_MISMATCH",
        `Request ${request.id} snapshot code ${after.code} does not match ${expectedRequest.code}.`,
        { companyId: company.id, requestId: request.id },
      ));
    }
  }

  return { result, issues };
}

async function readReport(path) {
  const content = await fs.readFile(path, "utf8");
  const report = JSON.parse(content);
  const totals = report?.ledgerTotals?.current ?? report?.ledgerTotals;
  if (!totals || typeof totals !== "object") {
    throw new Error(`Comparison report ${path} has no ledgerTotals.current.`);
  }
  return totals;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) {
    printHelp();
    return;
  }

  const connectionString = process.env.SUPABASE_DATABASE_URL;
  if (!connectionString) {
    throw new Error("SUPABASE_DATABASE_URL must be loaded before running the activation gate.");
  }

  const client = new Client({
    connectionString,
    ssl: { rejectUnauthorized: false },
    connectionTimeoutMillis: 8_000,
  });
  await client.connect();

  try {
    await client.query("BEGIN");
    await client.query("SET TRANSACTION READ ONLY");
    await client.query("SET TRANSACTION ISOLATION LEVEL REPEATABLE READ");

    const companyQuery = args.companyId === null
      ? "SELECT id, company_code FROM companies WHERE is_active = true ORDER BY id"
      : "SELECT id, company_code FROM companies WHERE is_active = true AND id = $1 ORDER BY id";
    const companyResult = await client.query(companyQuery, args.companyId === null ? [] : [args.companyId]);
    if (companyResult.rows.length === 0) {
      throw new Error("No active company matched the requested scope.");
    }

    const targetStructure = getTaxCoaTargetStructure();
    const companyReports = [];
    const issues = [];
    for (const company of companyResult.rows) {
      const checked = await inspectCompany(client, company, targetStructure);
      companyReports.push(checked.result);
      issues.push(...checked.issues);
    }

    const companyIds = companyResult.rows.map((row) => Number(row.id));
    const currentTotals = normalizeTotals(await collectLedgerTotals(client, companyIds));
    let comparison = null;
    if (args.compare) {
      const beforeTotals = normalizeTotals(await readReport(args.compare));
      comparison = compareLedgerTotals(beforeTotals, currentTotals);
      if (!comparison.unchanged) {
        issues.push(issue(
          "LEDGER_TOTALS_CHANGED",
          "Journal or entry-line totals differ from the supplied before-approval report.",
          { before: comparison.before, after: comparison.after },
        ));
      }
    }

    const report = {
      schemaVersion: 1,
      readOnly: true,
      generatedAt: new Date().toISOString(),
      phase: args.phase,
      maker: TAX_MIGRATION_MAKER,
      targetDefinition: {
        headers: targetStructure.headers.length,
        subaccounts: targetStructure.subaccounts.length,
        reparenting: targetStructure.reparenting.length,
      },
      companies: companyReports,
      ledgerTotals: {
        current: currentTotals,
        comparison,
      },
      issues,
      ok: issues.length === 0,
    };

    if (args.writeReport) {
      await fs.writeFile(args.writeReport, `${JSON.stringify(report, null, 2)}\n`, "utf8");
    }

    if (args.json) {
      console.log(JSON.stringify(report, null, 2));
    } else {
      console.log(`[tax-coa-gate] ${report.ok ? "PASS" : "FAIL"} — companies=${companyReports.length} issues=${issues.length}`);
      console.log(`[tax-coa-gate] target requests/company=${targetStructure.headers.length + targetStructure.subaccounts.length + targetStructure.reparenting.length}`);
      console.log(`[tax-coa-gate] ledger phase=${args.phase} comparison=${comparison ? (comparison.unchanged ? "unchanged" : "changed") : "not-requested"}`);
      if (args.writeReport) console.log(`[tax-coa-gate] report=${args.writeReport}`);
      for (const item of issues.slice(0, 20)) {
        console.error(`[tax-coa-gate] ${item.code}: ${item.message}`);
      }
      if (issues.length > 20) {
        console.error(`[tax-coa-gate] ... ${issues.length - 20} more issue(s); use --json for the full report.`);
      }
    }

    await client.query("ROLLBACK");
    if (!report.ok) process.exitCode = 1;
  } finally {
    await client.end();
  }
}

main().catch((error) => {
  console.error(`[tax-coa-gate] FATAL: ${error instanceof Error ? error.message : String(error)}`);
  process.exitCode = 1;
});