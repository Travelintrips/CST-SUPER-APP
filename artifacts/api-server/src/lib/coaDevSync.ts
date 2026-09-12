/**
 * coaDevSync.ts
 *
 * Prevents COA ID mismatch after a dev database reset.
 *
 * PROBLEM
 * -------
 * After `seedAccountingDefaults()` runs on a fresh dev DB, chart_of_accounts
 * rows receive low sequential IDs (1, 2, 3…). But production uses IDs in the
 * 49 000–76 000 range. Any accounting_entry_lines imported from production
 * reference those prod IDs, so they silently fail JOIN lookups in dev
 * (Trial Balance is blank, reconciliation breaks, etc.).
 *
 * SOLUTION
 * --------
 * `syncDevCoaToFixture()` compares the committed fixture file
 * `coa-prod-fixture.json` (generated from prod) against the dev DB.
 *
 * For every account whose `(code, company_id)` maps to a different `id` in
 * dev vs the fixture, the function runs a two-phase PK remap inside a single
 * transaction:
 *   Phase 1 — dev_id → -(dev_id)   (temp negatives avoid PK conflicts)
 *   Phase 2 — -(dev_id) → fixture_id
 *
 * All FK-referencing tables are updated in the same transaction with
 * `session_replication_role = replica` to bypass FK triggers temporarily.
 *
 * After remapping, the sequence is advanced past the max fixture ID.
 *
 * SAFETY
 * ------
 * - Only runs when `APP_ENV !== production` and `REPLIT_DEPLOYMENT` is unset
 * - Idempotent — exits immediately if no mismatch is found
 * - If the fixture file is absent, logs a warning and returns without touching DB
 * - Never touches prod DB (uses the DB connection already configured by lib/db)
 *
 * REFRESHING THE FIXTURE
 * ----------------------
 * Run: `node load-secrets.mjs node scripts/generate-coa-fixture.mjs`
 * from the `artifacts/api-server/` directory.
 * Commit the updated `src/lib/coa-prod-fixture.json`.
 */

import { db } from "@workspace/db";
import { sql } from "drizzle-orm";
import { readFileSync, existsSync } from "fs";
import { fileURLToPath } from "url";
import { dirname, join } from "path";
import { logger } from "./logger.js";

// ── Fixture type ──────────────────────────────────────────────────────────────

interface FixtureAccount {
  id: number;
  code: string;
  companyId: number | null;
  name: string;
  type: string;
}

interface CoaFixture {
  generatedAt: string;
  description: string;
  accounts: FixtureAccount[];
}

// ── FK table/column pairs that reference chart_of_accounts(id) ───────────────
// Keep this list in sync with any new tables that add FK refs to COA.

const COA_FK_REFS: Array<{ table: string; column: string }> = [
  // Journal lines + ledger
  { table: "accounting_entry_lines",      column: "account_id" },
  { table: "fleet_ledger_entries",        column: "account_id" },
  // Journals
  { table: "accounting_journals",         column: "default_debit_account_id" },
  { table: "accounting_journals",         column: "default_credit_account_id" },
  // Taxes
  { table: "accounting_taxes",            column: "account_id" },
  { table: "transaction_taxes",           column: "account_id" },
  // Settings (all COA-backed columns)
  { table: "accounting_settings",         column: "ar_account_id" },
  { table: "accounting_settings",         column: "ap_account_id" },
  { table: "accounting_settings",         column: "sales_income_account_id" },
  { table: "accounting_settings",         column: "purchase_expense_account_id" },
  { table: "accounting_settings",         column: "default_bank_account_id" },
  { table: "accounting_settings",         column: "default_cash_account_id" },
  { table: "accounting_settings",         column: "grir_account_id" },
  { table: "accounting_settings",         column: "tenant_rent_income_account_id" },
  { table: "accounting_settings",         column: "salary_expense_account_id" },
  { table: "accounting_settings",         column: "allowance_expense_account_id" },
  { table: "accounting_settings",         column: "salary_payable_account_id" },
  { table: "accounting_settings",         column: "tax_payable_account_id" },
  { table: "accounting_settings",         column: "bpjs_payable_account_id" },
  { table: "accounting_settings",         column: "fleet_cash_account_id" },
  { table: "accounting_settings",         column: "fleet_driver_receivable_account_id" },
  // Accounting hub rules
  { table: "accounting_hub_rules",        column: "debit_account_id" },
  { table: "accounting_hub_rules",        column: "credit_account_id" },
  // Disbursements and receipts
  { table: "bank_disbursement_requests",  column: "account_id" },
  { table: "bank_disbursement_requests",  column: "wht_account_id" },
  { table: "bank_disbursement_requests",  column: "ppn_account_id" },
  { table: "bank_receipts",               column: "account_id" },
  // COA governance
  { table: "coa_proposals",              column: "proposed_parent_id" },
  // Bank accounts (kas/bank migration)
  { table: "bank_accounts",              column: "coa_id" },
  // Self-referencing (parent_id) — must come LAST so parents are already remapped
  { table: "chart_of_accounts",          column: "parent_id" },
];

// ── Load fixture ──────────────────────────────────────────────────────────────

function loadFixture(): CoaFixture | null {
  // Works for both CJS (compiled) and ESM contexts
  let baseDir: string;
  try {
    baseDir = dirname(fileURLToPath(import.meta.url));
  } catch {
    // Fallback for CommonJS
    baseDir = __dirname;
  }
  const fixturePath = join(baseDir, "coa-prod-fixture.json");

  if (!existsSync(fixturePath)) {
    logger.warn({ fixturePath }, "coaDevSync: fixture file not found — skipping COA ID sync");
    return null;
  }

  try {
    const raw = readFileSync(fixturePath, "utf8");
    return JSON.parse(raw) as CoaFixture;
  } catch (err) {
    logger.warn({ err }, "coaDevSync: failed to parse fixture — skipping COA ID sync");
    return null;
  }
}

// ── Main sync function ────────────────────────────────────────────────────────

/**
 * Syncs dev chart_of_accounts IDs to match the committed prod fixture.
 * No-op if already in sync, or if running in production.
 */
export async function syncDevCoaToFixture(): Promise<void> {
  // Safety: never run in production
  const isProd = process.env["NODE_ENV"] === "production" || !!process.env["REPLIT_DEPLOYMENT"];
  if (isProd) {
    logger.debug("coaDevSync: production environment — skipping COA ID sync");
    return;
  }

  const fixture = loadFixture();
  if (!fixture) return;

  logger.info(
    { fixtureDate: fixture.generatedAt, fixtureAccounts: fixture.accounts.length },
    "coaDevSync: checking dev COA IDs against prod fixture…",
  );

  // ── Fetch dev COA by (code, company_id) ──────────────────────────────────
  let devRows: Array<{ id: number; code: string; company_id: number | null }>;
  try {
    const res = await db.execute(sql`SELECT id, code, company_id FROM chart_of_accounts`);
    devRows = res.rows as Array<{ id: number; code: string; company_id: number | null }>;
  } catch (err) {
    logger.warn({ err }, "coaDevSync: cannot query chart_of_accounts — skipping");
    return;
  }

  if (devRows.length === 0) {
    logger.info("coaDevSync: dev chart_of_accounts is empty — nothing to remap");
    return;
  }

  // Build lookup: "code||company_id" → devId
  const devMap = new Map<string, number>();
  for (const row of devRows) {
    const key = `${row.code}||${row.company_id ?? "null"}`;
    devMap.set(key, Number(row.id));
  }

  // Build remap list: entries where devId !== fixtureId
  // Only include accounts that exist in BOTH dev and fixture (skip prod-only or dev-only).
  const remaps: Array<{ devId: number; fixtureId: number; code: string; companyId: number | null }> = [];

  for (const fa of fixture.accounts) {
    const key = `${fa.code}||${fa.companyId ?? "null"}`;
    const devId = devMap.get(key);
    if (devId === undefined) continue;           // not in dev (prod-only)
    if (devId === fa.id) continue;               // already correct
    remaps.push({ devId, fixtureId: fa.id, code: fa.code, companyId: fa.companyId });
  }

  if (remaps.length === 0) {
    logger.info("coaDevSync: all dev COA IDs already match fixture — no remap needed ✓");
    return;
  }

  logger.warn(
    { remapCount: remaps.length },
    "coaDevSync: COA ID mismatch detected — starting two-phase PK remap",
  );

  // Compute max fixture ID to advance the sequence later
  const maxFixtureId = Math.max(...fixture.accounts.map((a) => a.id));

  // ── Two-phase remap in a single transaction ───────────────────────────────
  // Phase 1: devId → -devId  (temp negatives; avoids PK collisions during phase 2)
  // Phase 2: -devId → fixtureId
  //
  // session_replication_role = replica bypasses FK triggers in the session.
  // We restore it to DEFAULT at the end.

  try {
    await db.execute(sql`SET session_replication_role = replica`);

    // Phase 1: move devIds to negatives
    for (const { devId } of remaps) {
      const tempId = -devId;
      // Update all FK refs first, then update PK
      for (const { table, column } of COA_FK_REFS) {
        try {
          await db.execute(
            sql.raw(
              `UPDATE ${table} SET ${column} = ${tempId} WHERE ${column} = ${devId}`,
            ),
          );
        } catch {
          /* table may not exist yet — non-fatal */
        }
      }
      // Now update the PK itself
      await db.execute(
        sql.raw(`UPDATE chart_of_accounts SET id = ${tempId} WHERE id = ${devId}`),
      );
    }

    // Phase 2: move negatives to fixture IDs
    for (const { devId, fixtureId } of remaps) {
      const tempId = -devId;
      // Update all FK refs first
      for (const { table, column } of COA_FK_REFS) {
        try {
          await db.execute(
            sql.raw(
              `UPDATE ${table} SET ${column} = ${fixtureId} WHERE ${column} = ${tempId}`,
            ),
          );
        } catch {
          /* table may not exist yet — non-fatal */
        }
      }
      // Update the PK
      await db.execute(
        sql.raw(`UPDATE chart_of_accounts SET id = ${fixtureId} WHERE id = ${tempId}`),
      );
    }

    // Advance sequence past max fixture ID so new inserts don't collide
    const newSeqVal = maxFixtureId + 1000;
    await db.execute(
      sql.raw(`SELECT setval('chart_of_accounts_id_seq', ${newSeqVal}, false)`),
    );

    logger.info(
      { remapped: remaps.length, sequenceAt: newSeqVal },
      "coaDevSync: PK remap complete — dev COA IDs now match prod fixture ✓",
    );
  } catch (err) {
    logger.error({ err }, "coaDevSync: PK remap FAILED — dev COA IDs may be inconsistent");
    throw err;
  } finally {
    try {
      await db.execute(sql`SET session_replication_role = DEFAULT`);
    } catch {
      /* ignore */
    }
  }
}

/**
 * Refreshes the fixture hint printed to stdout — helps devs know the fixture is stale.
 * Call after seedAccountingDefaults() if needed.
 */
export function printCoaFixtureRefreshHint(): void {
  const isProd = process.env["NODE_ENV"] === "production" || !!process.env["REPLIT_DEPLOYMENT"];
  if (isProd) return;

  console.log(
    "\n[coaDevSync] TIP: to refresh the COA prod fixture after a prod schema change, run:\n" +
    "  cd artifacts/api-server && node load-secrets.mjs node scripts/generate-coa-fixture.mjs\n" +
    "  Then commit src/lib/coa-prod-fixture.json.\n",
  );
}
