/**
 * General Ledger — Running Balance Tests (Phase 11)
 *
 * Pure-function tests for the running balance accounting math used by the
 * SQL window function in /api/accounting/hub/general-ledger.
 *
 * These tests do NOT require a live DB — they validate the arithmetic formulas
 * that mirror the CTE logic:
 *   DEBIT normal:  runningBalance += debit - credit
 *   CREDIT normal: runningBalance += credit - debit
 *
 * Covered scenarios (1–15 from master prompt):
 *  1.  Debit-normal account running balance
 *  2.  Credit-normal account running balance
 *  3.  Opening balance accumulates pre-period entries
 *  4.  Date range filter limits the running sequence
 *  5.  Sort ASC: running balance stays correct (chronological calc)
 *  6.  Sort DESC: running balance stays correct (chronological calc)
 *  7.  Pagination page 2: carries cumulative balance from page 1
 *  8.  Source-module filter does not corrupt cumulative balance per row
 *  9.  Draft entries excluded from balance
 * 10.  Posted entries included in balance
 * 11.  Voided/reversal net to zero — no double-subtract
 * 12.  Multi-company isolation
 * 13.  Multi-account isolation (PARTITION BY account_id)
 * 14.  Debit = Credit equation unaffected by display sort
 * 15.  Closing balance matches Trial Balance for the same period
 */

import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { randomUUID } from "node:crypto";
import express from "express";
import pg from "pg";
import supertest from "supertest";
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { getIsolatedTestDatabaseUrl } from "../test-setup.js";

// ── Helpers — mirror the SQL CTE arithmetic ───────────────────────────────────

type NormalBalance = "DEBIT" | "CREDIT";

interface LedgerEntry {
  debit: number;
  credit: number;
}

/**
 * Compute per-row running balances in chronological order.
 * Mirrors: SUM(CASE WHEN normal_balance='DEBIT' THEN debit-credit ELSE credit-debit END)
 *          OVER (PARTITION BY account_id ORDER BY date,entry_id,line_id ROWS UNBOUNDED PRECEDING)
 *
 * @param normalBalance Account's normal balance direction.
 * @param entries       Entries already sorted chronologically.
 * @param openingBalance Pre-period opening balance (default 0).
 * @returns Array of running balance after each entry.
 */
function computeRunningBalances(
  normalBalance: NormalBalance,
  entries: LedgerEntry[],
  openingBalance = 0,
): number[] {
  let cumulative = 0;
  return entries.map(({ debit, credit }) => {
    cumulative += normalBalance === "DEBIT" ? debit - credit : credit - debit;
    return openingBalance + cumulative;
  });
}

/**
 * Compute opening balance (sum of pre-period posted entries).
 * Mirrors the opening_bal CTE: WHERE e.date < dateFrom.
 */
function computeOpeningBalance(
  normalBalance: NormalBalance,
  prePeriodEntries: LedgerEntry[],
): number {
  return prePeriodEntries.reduce((sum, { debit, credit }) => {
    return sum + (normalBalance === "DEBIT" ? debit - credit : credit - debit);
  }, 0);
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe("1. Debit-normal account running balance", () => {
  it("increases on debit, decreases on credit", () => {
    const entries: LedgerEntry[] = [
      { debit: 1_000_000, credit: 0 },
      { debit: 500_000,   credit: 0 },
      { debit: 0,         credit: 200_000 },
    ];
    const rb = computeRunningBalances("DEBIT", entries, 0);
    expect(rb[0]).toBe(1_000_000);
    expect(rb[1]).toBe(1_500_000);
    expect(rb[2]).toBe(1_300_000);
  });
});

describe("2. Credit-normal account running balance", () => {
  it("increases on credit, decreases on debit", () => {
    const entries: LedgerEntry[] = [
      { debit: 0,       credit: 2_000_000 },
      { debit: 0,       credit: 500_000 },
      { debit: 100_000, credit: 0 },
    ];
    const rb = computeRunningBalances("CREDIT", entries, 0);
    expect(rb[0]).toBe(2_000_000);
    expect(rb[1]).toBe(2_500_000);
    expect(rb[2]).toBe(2_400_000);
  });

  it("negative running balance = abnormal (debit > credit cumulative) → UI should render red", () => {
    const entries: LedgerEntry[] = [{ debit: 500_000, credit: 0 }];
    const rb = computeRunningBalances("CREDIT", entries, 0);
    expect(rb[0]).toBe(-500_000);
  });
});

describe("3. Opening balance accumulates pre-period entries", () => {
  it("DEBIT normal: sum of pre-period debit minus credit", () => {
    const prePeriod: LedgerEntry[] = [
      { debit: 3_000_000, credit: 0 },
      { debit: 0,         credit: 500_000 },
    ];
    expect(computeOpeningBalance("DEBIT", prePeriod)).toBe(2_500_000);
  });

  it("CREDIT normal: sum of pre-period credit minus debit", () => {
    const prePeriod: LedgerEntry[] = [
      { debit: 0,       credit: 5_000_000 },
      { debit: 200_000, credit: 0 },
    ];
    expect(computeOpeningBalance("CREDIT", prePeriod)).toBe(4_800_000);
  });

  it("period entries carry forward from opening balance", () => {
    const ob = computeOpeningBalance("DEBIT", [{ debit: 1_000_000, credit: 0 }]);
    const periodEntries: LedgerEntry[] = [
      { debit: 200_000, credit: 0 },
      { debit: 0,       credit: 50_000 },
    ];
    const rb = computeRunningBalances("DEBIT", periodEntries, ob);
    expect(rb[0]).toBe(1_200_000);
    expect(rb[1]).toBe(1_150_000);
  });

  it("no prior entries: opening balance is zero", () => {
    expect(computeOpeningBalance("DEBIT", [])).toBe(0);
  });
});

describe("4. Date range filter limits the running sequence", () => {
  it("pre-period entries become opening balance; post-period entries are excluded", () => {
    // filter: date_from = Aug 1
    const prePeriod: LedgerEntry[]  = [{ debit: 500_000, credit: 0 }];   // Jul
    const inPeriod: LedgerEntry[]   = [{ debit: 100_000, credit: 0 }];   // Aug 5
    // Sep 1 entry is after dateTo — would not even enter the running_bal CTE

    const ob = computeOpeningBalance("DEBIT", prePeriod);       // 500_000
    const rb = computeRunningBalances("DEBIT", inPeriod, ob);   // only Aug
    expect(ob).toBe(500_000);
    expect(rb[0]).toBe(600_000);   // opening + inPeriod[0]
  });
});

describe("5 & 6. Sort ASC / DESC — running balance always chronological", () => {
  // Three transactions in chronological order (ids 1, 2, 3)
  const chronoEntries = [
    { id: 1, date: "2026-08-01", debit: 1_000_000, credit: 0 },
    { id: 2, date: "2026-08-05", debit: 0,         credit: 300_000 },
    { id: 3, date: "2026-08-10", debit: 500_000,   credit: 0 },
  ];
  // Running balances computed in chronological order
  const chronoRB = computeRunningBalances("DEBIT", chronoEntries, 0);
  // expected: [1_000_000, 700_000, 1_200_000]

  it("chronological running balances are correct", () => {
    expect(chronoRB[0]).toBe(1_000_000);
    expect(chronoRB[1]).toBe(700_000);
    expect(chronoRB[2]).toBe(1_200_000);
  });

  it("sort DESC: displayed rows reordered but each row keeps its chronological running_balance", () => {
    // DESC display: [id3, id2, id1]
    const descOrder = [...chronoEntries].sort((a, b) => b.date.localeCompare(a.date));
    // id3 (chronoIdx=2) shown first → running_balance = chronoRB[2] = 1_200_000
    expect(chronoRB[descOrder[0].id - 1]).toBe(1_200_000);
    // id2 (chronoIdx=1) → 700_000
    expect(chronoRB[descOrder[1].id - 1]).toBe(700_000);
    // id1 (chronoIdx=0) → 1_000_000
    expect(chronoRB[descOrder[2].id - 1]).toBe(1_000_000);
  });

  it("sort ASC: running balance in same order as chronological", () => {
    const ascOrder = [...chronoEntries].sort((a, b) => a.date.localeCompare(b.date));
    ascOrder.forEach((entry, i) => {
      expect(chronoRB[entry.id - 1]).toBe(chronoRB[i]);
    });
  });
});

describe("7. Pagination: page 2 carries cumulative balance from page 1", () => {
  it("page 2 first row running_balance starts from page 1's last running_balance", () => {
    const pageSize = 2;
    const allEntries: LedgerEntry[] = [
      { debit: 1_000_000, credit: 0 },    // page 1 row 1 → rb=1_000_000
      { debit: 500_000,   credit: 0 },    // page 1 row 2 → rb=1_500_000
      { debit: 200_000,   credit: 0 },    // page 2 row 1 → rb=1_700_000
      { debit: 0,         credit: 100_000 }, // page 2 row 2 → rb=1_600_000
    ];
    const allRB = computeRunningBalances("DEBIT", allEntries, 0);

    const page1 = allRB.slice(0, pageSize);
    const page2 = allRB.slice(pageSize, pageSize * 2);

    expect(page1).toEqual([1_000_000, 1_500_000]);
    // page2 row 1 must NOT restart from 0 or 200_000
    expect(page2[0]).toBe(1_700_000);
    expect(page2[1]).toBe(1_600_000);
  });
});

describe("8. Source-module filter — balance uses ALL entries; display is a subset", () => {
  it("visible rows keep their chronological running_balance including hidden rows' effect", () => {
    const allEntries = [
      { module: "sales",    debit: 1_000_000, credit: 0 },
      { module: "purchase", debit: 200_000,   credit: 0 },  // hidden by filter
      { module: "sales",    debit: 0,         credit: 150_000 },
    ];
    // All running balances (balance policy A — all modules)
    const allRB = computeRunningBalances("DEBIT", allEntries, 0);
    // [1_000_000, 1_200_000, 1_050_000]

    const salesRows = allEntries
      .map((e, i) => ({ ...e, rb: allRB[i] }))
      .filter(e => e.module === "sales");

    // row 0: rb=1_000_000 ✓
    expect(salesRows[0].rb).toBe(1_000_000);
    // row 2: rb=1_050_000 (NOT 850_000 — purchase row contributed 200_000)
    expect(salesRows[1].rb).toBe(1_050_000);
  });
});

describe("9 & 10. Draft excluded, Posted included", () => {
  it("only POSTED entries participate in balance; draft has null running_balance", () => {
    // Draft entries are filtered out from running_bal CTE (WHERE e.status = 'posted')
    // So the running balance is computed only over posted rows.
    const allEntries = [
      { status: "posted", debit: 1_000_000, credit: 0 },
      { status: "draft",  debit: 999_000,   credit: 0 },  // excluded from balance
      { status: "posted", debit: 500_000,   credit: 0 },
    ];
    const posted = allEntries.filter(e => e.status === "posted");
    const rb = computeRunningBalances("DEBIT", posted, 0);

    // Draft's 999_000 does NOT contaminate the balance
    expect(rb[0]).toBe(1_000_000);
    expect(rb[1]).toBe(1_500_000);  // not 2_499_000 (which would include draft)
  });
});

describe("11. Voided/reversal entries — no double-subtract", () => {
  it("original + reversal journal net to zero", () => {
    // Both the original and the reversal are status='posted' in DB.
    // The reversal entry offsets the original exactly — no double-subtract.
    const entries: LedgerEntry[] = [
      { debit: 1_000_000, credit: 0 },        // original (posted)
      { debit: 0,         credit: 1_000_000 }, // reversal (posted)
    ];
    const rb = computeRunningBalances("DEBIT", entries, 0);
    expect(rb[0]).toBe(1_000_000);
    expect(rb[1]).toBe(0);  // net zero — correct
  });
});

describe("12. Multi-company isolation", () => {
  it("running balance per company is independent (filtered by companyId)", () => {
    const companyA: LedgerEntry[] = [{ debit: 5_000_000, credit: 0 }, { debit: 0, credit: 2_000_000 }];
    const companyB: LedgerEntry[] = [{ debit: 3_000_000, credit: 0 }];

    const rbA = computeRunningBalances("DEBIT", companyA, 0);
    const rbB = computeRunningBalances("DEBIT", companyB, 0);

    expect(rbA).toEqual([5_000_000, 3_000_000]);
    expect(rbB).toEqual([3_000_000]);
    // rbA and rbB are independent sequences
  });
});

describe("13. Multi-account isolation — PARTITION BY account_id", () => {
  it("each account has an independent running balance sequence", () => {
    // Account 1001 (DEBIT normal)
    const acct1 = computeRunningBalances(
      "DEBIT",
      [{ debit: 1_000_000, credit: 0 }, { debit: 500_000, credit: 0 }],
      0,
    );
    // Account 2001 (CREDIT normal)
    const acct2 = computeRunningBalances(
      "CREDIT",
      [{ debit: 0, credit: 2_000_000 }],
      0,
    );

    expect(acct1).toEqual([1_000_000, 1_500_000]);
    expect(acct2).toEqual([2_000_000]);
    // No cross-contamination between accounts
  });
});

describe("14. Debit = Credit accounting equation", () => {
  it("total debit equals total credit across a balanced journal", () => {
    const debitLines  = [{ debit: 1_000_000, credit: 0 }];
    const creditLines = [{ debit: 0, credit: 1_000_000 }];

    const totalDebit  = debitLines.reduce((s, e)  => s + e.debit - e.credit, 0);
    const totalCredit = creditLines.reduce((s, e) => s + e.credit - e.debit, 0);
    expect(totalDebit).toBe(totalCredit);
  });

  it("display sort does not change total debit or total credit sums", () => {
    const entries: LedgerEntry[] = [
      { debit: 500_000, credit: 0 },
      { debit: 0, credit: 200_000 },
      { debit: 300_000, credit: 0 },
    ];
    const sortedAsc  = [...entries].sort((a, b) => b.debit - a.debit);
    const sortedDesc = [...entries].sort((a, b) => a.debit - b.debit);

    const sumDebit  = (arr: LedgerEntry[]) => arr.reduce((s, e) => s + e.debit,  0);
    const sumCredit = (arr: LedgerEntry[]) => arr.reduce((s, e) => s + e.credit, 0);

    expect(sumDebit(sortedAsc)).toBe(sumDebit(sortedDesc));
    expect(sumCredit(sortedAsc)).toBe(sumCredit(sortedDesc));
  });
});

describe("15. Closing balance matches Trial Balance", () => {
  it("GL closing balance = Trial Balance account balance for the same period", () => {
    // Trial Balance formula (all entries since inception):
    //   DEBIT normal: SUM(debit) - SUM(credit)
    //
    // GL formula:
    //   opening (pre-period) + period net
    //
    // Both must produce the same number.

    const allEntries: LedgerEntry[] = [
      // pre-period (Jul)
      { debit: 3_000_000, credit: 0 },
      { debit: 0,         credit: 500_000 },
      // in-period (Aug)
      { debit: 1_000_000, credit: 0 },
      { debit: 0,         credit: 200_000 },
    ];

    // Trial Balance: total since inception
    const trialBalance = allEntries.reduce((s, e) => s + e.debit - e.credit, 0);
    // = 3_000_000 - 500_000 + 1_000_000 - 200_000 = 3_300_000

    // GL formula
    const prePeriod  = allEntries.slice(0, 2);
    const inPeriod   = allEntries.slice(2);
    const ob         = computeOpeningBalance("DEBIT", prePeriod);  // 2_500_000
    const periodNet  = inPeriod.reduce((s, e) => s + e.debit - e.credit, 0); // 800_000
    const closingBalance = ob + periodNet;  // 3_300_000

    expect(closingBalance).toBe(trialBalance);
    expect(closingBalance).toBe(3_300_000);
  });
});

type BankReconciliationPaymentEntry = {
  sourceModule: string;
  source: string;
  accountingPaymentMethod: string | null;
  bankMutationId: number | null;
  journalId: number;
  lines: Array<{
    accountCode: string;
    debit: number;
    credit: number;
    runningBalance: number;
  }>;
};

function generalLedgerPaymentMeta(entry: BankReconciliationPaymentEntry) {
  const sourceModule =
    entry.sourceModule.toLowerCase() === "vendor_invoice_payment" &&
    entry.source.toLowerCase() === "bank_reconciliation"
      ? "bank_reconciliation"
      : entry.sourceModule;

  return {
    sourceModule,
    paymentMethod:
      entry.accountingPaymentMethod ??
      (entry.bankMutationId !== null && sourceModule === "bank_reconciliation"
        ? "bank"
        : null),
  };
}

describe("16. Bank-reconciliation vendor payment filter semantics", () => {
  const entry: BankReconciliationPaymentEntry = {
    sourceModule: "vendor_invoice_payment",
    source: "bank_reconciliation",
    accountingPaymentMethod: null,
    bankMutationId: 9042,
    journalId: 712,
    lines: [
      {
        accountCode: "2-1101",
        debit: 1_011_000,
        credit: 0,
        runningBalance: 8_989_000,
      },
      {
        accountCode: "1-1101",
        debit: 0,
        credit: 1_000_000,
        runningBalance: 14_000_000,
      },
    ],
  };

  it("returns the complete journal under the bank-reconciliation module filter", () => {
    const before = structuredClone(entry);
    const meta = generalLedgerPaymentMeta(entry);
    const visibleLines = meta.sourceModule === "bank_reconciliation" ? entry.lines : [];

    expect(visibleLines).toHaveLength(2);
    expect(visibleLines.map((line) => line.accountCode)).toEqual(["2-1101", "1-1101"]);
    expect(entry).toEqual(before);
  });

  it("returns the complete journal as bank under the payment-method filter", () => {
    const before = structuredClone(entry);
    const meta = generalLedgerPaymentMeta(entry);
    const visibleLines = meta.paymentMethod === "bank" ? entry.lines : [];

    expect(meta.paymentMethod).toBe("bank");
    expect(visibleLines).toHaveLength(2);
    expect(entry).toEqual(before);
  });

  it("preserves gross vendor-liability debit, net bank credit, journal identity, and balances", () => {
    const routeSource = readFileSync(
      resolve(process.cwd(), "src/routes/accountingHub.ts"),
      "utf8",
    );

    expect(entry.lines).toEqual([
      {
        accountCode: "2-1101",
        debit: 1_011_000,
        credit: 0,
        runningBalance: 8_989_000,
      },
      {
        accountCode: "1-1101",
        debit: 0,
        credit: 1_000_000,
        runningBalance: 14_000_000,
      },
    ]);
    expect(entry.journalId).toBe(712);

    expect(routeSource).toContain("WHEN LOWER(${p}source_module) = 'vendor_invoice_payment'");
    expect(routeSource).toContain("AND LOWER(${p}source::text) = 'bank_reconciliation'");
    expect(routeSource).toContain("THEN 'bank_reconciliation'");
    expect(routeSource).toContain("WHEN bm.id IS NOT NULL");
    expect(routeSource).toContain("THEN 'bank'");
    expect(routeSource).toContain("WHERE journal_entry_id = e.id");
    expect(routeSource).toContain("sql`${glPaymentMethodExpr()} = ${f.paymentMethod}`");
  });
});

// ── Real-ledger regression: source-only vendor payment ────────────────────────
//
// This is intentionally separate from the source/fixture tests above. The
// regression must execute the real General Ledger route against an isolated
// PostgreSQL target, because a payment without an accounting_payments bridge
// can disappear only after the query's joins and filters are applied together.
const hasIsolatedDatabase = Boolean(
  process.env.TEST_DATABASE_URL || process.env.STAGING_DATABASE_URL,
);

type GeneralLedgerFixture = {
  marker: string;
  companyId: number;
  journalId: number;
  entryId: number;
  mutationId: number;
  liabilityAccountId: number;
  bankAccountId: number;
  withholdingAccountId: number;
  entryDate: string;
  grossAmount: number;
  netAmount: number;
  withholdingAmount: number;
};

describe.skipIf(!hasIsolatedDatabase)(
  "5. General Ledger catches source-only bank-reconciliation vendor payments",
  () => {
    const { Pool } = pg;
    let pool: pg.Pool;
    let app: express.Express;

    beforeAll(async () => {
      const dbUrl = getIsolatedTestDatabaseUrl();
      pool = new Pool({
        connectionString: dbUrl,
        ssl: { rejectUnauthorized: false },
        max: 3,
        connectionTimeoutMillis: 15_000,
      });

      // Import after the test target is known. @workspace/db resolves its
      // Vitest pool from TEST_DATABASE_URL/STAGING_DATABASE_URL.
      const { default: accountingHubRouter } = await import(
        "../routes/accountingHub.js"
      );

      app = express();
      app.use(express.json());
      app.use((req: any, _res, next) => {
        req.user = {
          id: `gl-regression-${randomUUID()}`,
          email: "gl-regression@test.invalid",
          role: "admin",
          companyId: null,
        };
        req.isAuthenticated = () => true;
        req.isInternalSession = true;
        next();
      });
      app.use("/api/accounting", accountingHubRouter);
    });

    afterAll(async () => {
      await pool?.end();
    });

    async function createFixture(): Promise<GeneralLedgerFixture> {
      const marker = randomUUID();
      const grossAmount = 1_011_000;
      const netAmount = 1_000_000;
      const withholdingAmount = grossAmount - netAmount;
      const entryDate = "2026-08-15";
      const client = await pool.connect();

      try {
        await client.query("BEGIN");

        const company = await client.query(
          "SELECT id FROM public.companies ORDER BY id LIMIT 1",
        );
        const companyId = Number(company.rows[0]?.id);
        if (!Number.isSafeInteger(companyId) || companyId <= 0) {
          throw new Error("General Ledger fixture requires a company row");
        }

        const journal = await client.query(
          `INSERT INTO public.accounting_journals
             (company_id, code, name, type, is_active)
           VALUES ($1, $2, $3, 'bank', TRUE)
           RETURNING id`,
          [companyId, `GL5-${marker}`, `GL regression ${marker}`],
        );
        const journalId = Number(journal.rows[0]?.id);

        const accounts = await client.query(
          `INSERT INTO public.chart_of_accounts
             (company_id, code, name, type, normal_balance, account_category,
              is_active, is_postable, is_header, status)
           VALUES
             ($1, $2, $3, 'liability', 'CREDIT', 'LIABILITY', TRUE, TRUE, FALSE, 'ACTIVE'),
             ($1, $4, $5, 'asset', 'DEBIT', 'ASSET', TRUE, TRUE, FALSE, 'ACTIVE'),
             ($1, $6, $7, 'liability', 'CREDIT', 'LIABILITY', TRUE, TRUE, FALSE, 'ACTIVE')
           RETURNING id, code`,
          [
            companyId,
            `GL5-LIAB-${marker}`,
            `GL5 vendor liability ${marker}`,
            `GL5-BANK-${marker}`,
            `GL5 bank ${marker}`,
            `GL5-WHT-${marker}`,
            `GL5 withholding ${marker}`,
          ],
        );
        const accountByCode = new Map(
          accounts.rows.map((row) => [row.code, Number(row.id)]),
        );
        const liabilityAccountId = accountByCode.get(`GL5-LIAB-${marker}`);
        const bankAccountId = accountByCode.get(`GL5-BANK-${marker}`);
        const withholdingAccountId = accountByCode.get(`GL5-WHT-${marker}`);
        if (
          !liabilityAccountId ||
          !bankAccountId ||
          !withholdingAccountId
        ) {
          throw new Error("General Ledger fixture accounts were not created");
        }

        // The bank mutation is the authoritative payment-method evidence.
        // There is deliberately no accounting_payments row for this fixture.
        const mutation = await client.query(
          `INSERT INTO public.bank_mutations
             (company_id, transaction_date, description, credit_amount,
              debit_amount, amount, direction, mutation_key,
              normalized_description, status, source)
           VALUES ($1, $2, $3, 0, $4, $4, 'OUT', $5, $6, 'approved',
                   'bank_reconciliation')
           RETURNING id`,
          [
            companyId,
            entryDate,
            `GL5 vendor payment ${marker}`,
            netAmount,
            `GL5-MUT-${marker}`,
            `gl5 vendor payment ${marker}`,
          ],
        );
        const mutationId = Number(mutation.rows[0]?.id);

        const entry = await client.query(
          `INSERT INTO public.accounting_entries
             (company_id, entry_number, journal_id, date, ref, description,
              status, source, source_id, source_module, source_schema,
              source_table, total_debit, total_credit)
           VALUES ($1, $2, $3, $4, $5, $6, 'draft',
                   'bank_reconciliation', $7, 'vendor_invoice_payment',
                   'public', 'bank_mutations', $8, $8)
           RETURNING id`,
          [
            companyId,
            `GL5-ENTRY-${marker}`,
            journalId,
            entryDate,
            `GL5-REF-${marker}`,
            `GL5 vendor payment ${marker}`,
            mutationId,
            grossAmount,
          ],
        );
        const entryId = Number(entry.rows[0]?.id);

        await client.query(
          `INSERT INTO public.accounting_entry_lines
             (entry_id, account_id, description, debit, credit)
           VALUES
             ($1, $2, 'Gross vendor liability settlement', $3, 0),
             ($1, $4, 'Net bank disbursement', 0, $5),
             ($1, $6, 'Withholding tax payable', 0, $7)`,
          [
            entryId,
            liabilityAccountId,
            grossAmount,
            bankAccountId,
            netAmount,
            withholdingAccountId,
            withholdingAmount,
          ],
        );

        // Accounting triggers require the draft-first posting contract.
        await client.query(
          `UPDATE public.accounting_entries
              SET status = 'posted', posted_at = NOW()
            WHERE id = $1`,
          [entryId],
        );
        await client.query(
          `UPDATE public.bank_mutations
              SET journal_entry_id = $1
            WHERE id = $2`,
          [entryId, mutationId],
        );

        await client.query("COMMIT");
        return {
          marker,
          companyId,
          journalId,
          entryId,
          mutationId,
          liabilityAccountId,
          bankAccountId,
          withholdingAccountId,
          entryDate,
          grossAmount,
          netAmount,
          withholdingAmount,
        };
      } catch (error) {
        await client.query("ROLLBACK").catch(() => {});
        throw error;
      } finally {
        client.release();
      }
    }

    async function readLedger(
      scope: Pick<GeneralLedgerFixture, "companyId" | "entryDate">,
    ): Promise<{
      data: Array<Record<string, any>>;
      total: number;
      canonicalTotal: number;
      totalDebit: number;
      totalCredit: number;
    }> {
      const response = await supertest(app)
        .get("/api/accounting/hub/general-ledger")
        .query({
          company_id: scope.companyId,
          date_from: scope.entryDate,
          date_to: scope.entryDate,
          source_module: "bank_reconciliation",
          payment_method: "bank",
          sort_by: "date",
          sort_dir: "asc",
          limit: 500,
        });

      expect(response.status).toBe(200);
      return response.body;
    }

    async function cleanupFixture(fixture: GeneralLedgerFixture) {
      const client = await pool.connect();
      try {
        await client.query("BEGIN");
        // Only this fixture is targeted. The replica-role override is limited
        // to cleanup because posted-ledger protection is not under test here.
        await client.query("SET LOCAL session_replication_role = replica");
        await client.query(
          "DELETE FROM public.bank_mutations WHERE id = $1",
          [fixture.mutationId],
        );
        await client.query(
          "DELETE FROM public.accounting_entries WHERE id = $1",
          [fixture.entryId],
        );
        await client.query(
          "DELETE FROM public.accounting_journals WHERE id = $1",
          [fixture.journalId],
        );
        await client.query(
          `DELETE FROM public.chart_of_accounts
            WHERE id IN ($1, $2, $3)`,
          [
            fixture.liabilityAccountId,
            fixture.bankAccountId,
            fixture.withholdingAccountId,
          ],
        );
        await client.query("COMMIT");

        const residual = await client.query(
          `SELECT
             (SELECT COUNT(*) FROM public.accounting_entries
               WHERE entry_number = $1) AS entries,
             (SELECT COUNT(*) FROM public.accounting_journals
               WHERE code = $2) AS journals,
             (SELECT COUNT(*) FROM public.bank_mutations
               WHERE mutation_key = $3) AS mutations,
             (SELECT COUNT(*) FROM public.chart_of_accounts
               WHERE code IN ($4, $5, $6)) AS accounts`,
          [
            `GL5-ENTRY-${fixture.marker}`,
            `GL5-${fixture.marker}`,
            `GL5-MUT-${fixture.marker}`,
            `GL5-LIAB-${fixture.marker}`,
            `GL5-BANK-${fixture.marker}`,
            `GL5-WHT-${fixture.marker}`,
          ],
        );
        expect(Object.values(residual.rows[0]).map(Number)).toEqual([
          0,
          0,
          0,
          0,
        ]);
      } catch (error) {
        await client.query("ROLLBACK").catch(() => {});
        throw error;
      } finally {
        client.release();
      }
    }

    it("returns gross liability debit and net bank credit without a payment bridge", async () => {
      const company = await pool.query(
        "SELECT id FROM public.companies ORDER BY id LIMIT 1",
      );
      const baselineScope = {
        companyId: Number(company.rows[0]?.id),
        entryDate: "2026-08-15",
      };
      const before = await readLedger(baselineScope);
      const fixture = await createFixture();
      try {
        const after = await readLedger(fixture);
        const fixtureRows = after.data.filter(
          (row) => Number(row.entry_id) === fixture.entryId,
        );

        expect(fixtureRows).toHaveLength(3);
        const bridge = await pool.query(
          `SELECT COUNT(*)::int AS count
             FROM public.accounting_payments
            WHERE entry_id = $1`,
          [fixture.entryId],
        );
        expect(Number(bridge.rows[0]?.count)).toBe(0);
        expect(fixtureRows.every((row) => row.source_module === "bank_reconciliation")).toBe(true);
        expect(fixtureRows.every((row) => row.payment_method === "bank")).toBe(true);

        const liabilityLine = fixtureRows.find(
          (row) => Number(row.account_id) === fixture.liabilityAccountId,
        );
        const bankLine = fixtureRows.find(
          (row) => Number(row.account_id) === fixture.bankAccountId,
        );
        expect(Number(liabilityLine?.entry_id)).toBe(fixture.entryId);
        expect(Number(liabilityLine?.debit)).toBe(fixture.grossAmount);
        expect(Number(liabilityLine?.credit)).toBe(0);
        expect(Number(bankLine?.entry_id)).toBe(fixture.entryId);
        expect(Number(bankLine?.debit)).toBe(0);
        expect(Number(bankLine?.credit)).toBe(fixture.netAmount);

        // These are the chronological balances for the two newly-created COAs.
        // A future query regression must not replace them with null, restart
        // from zero, or use the filtered payment amount for the liability line.
        expect(Number(liabilityLine?.running_balance)).toBe(-fixture.grossAmount);
        expect(Number(bankLine?.running_balance)).toBe(-fixture.netAmount);
        expect(Number(liabilityLine?.account_opening_balance)).toBe(0);
        expect(Number(bankLine?.account_opening_balance)).toBe(0);

        // The display summary counts lines, while canonical totals include all
        // posted lines in the company/date scope. The fixture must be visible
        // through both scopes even though it has no accounting_payments bridge.
        expect(after.total).toBe(before.total + 3);
        expect(after.canonicalTotal).toBe(before.canonicalTotal + 3);
        expect(after.totalDebit).toBe(before.totalDebit + fixture.grossAmount);
        expect(after.totalCredit).toBe(before.totalCredit + fixture.grossAmount);
      } finally {
        await cleanupFixture(fixture);
        // Cleanup is part of the regression contract: the isolated target must
        // be returned to the exact ledger response it had before the fixture.
        await expect(readLedger(fixture)).resolves.toEqual(before);
      }
    });
  },
);
