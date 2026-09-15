import { describe, expect, it, vi, beforeEach } from "vitest";

const { postEntryWithClient, captureFailedJob } = vi.hoisted(() => ({
  postEntryWithClient: vi.fn(),
  captureFailedJob: vi.fn(),
}));

vi.mock("@workspace/db", () => ({
  db: {
    transaction: vi.fn(),
  },
  RECONCILIATION_CANDIDATE_SOURCES: {
    LEGACY_QRIS: "public.qris_settlements",
    CANONICAL_SPORT_CENTER: "sport_center.payment_settlement_batches",
  },
}));

vi.mock("drizzle-orm", () => ({
  sql: {
    raw: (query: string) => ({ query }),
  },
}));

vi.mock("../lib/logger.js", () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

vi.mock("../lib/financial/failedJobSystem.js", () => ({
  captureFailedJob,
}));

vi.mock("../lib/expenseClassificationService.js", () => ({
  classifyMutationDescription: vi.fn(),
  persistClassification: vi.fn(),
}));

vi.mock("../lib/accounting.js", () => ({
  postEntryWithClient,
}));

import { db } from "@workspace/db";
import {
  approveAndCreateJournal,
  buildBankMutationJournalLines,
} from "../lib/reconciliation/unifiedMatchingEngine.js";

type MockStatement = { query?: string };

function createTransactionMock(candidateRequired = false) {
  const executedQueries: string[] = [];
  const tx = {
    execute: vi.fn(async (statement: MockStatement) => {
      const query = statement.query ?? "";
      executedQueries.push(query);

      if (query.includes("FROM bank_mutations bm")) {
        return {
          rows: [{
            id: 7001,
            status: "unmatched",
            amount: "125000",
            direction: "OUT",
            transaction_date: "2026-09-14",
            description: "Pembelian ATK manual",
            mutation_key: "manual-coa-7001",
            provider_name: "bank_statement",
            provider_order_id: null,
            normalized_description: "pembelian atk manual",
            company_id: 42,
            bank_account_reference: "1234-5678",
            journal_entry_id: null,
            expense_category: "office_supplies",
            expense_suggested_account_subtype: null,
          }],
        };
      }

      if (query.includes("FROM company_bank_accounts")) {
        return { rows: [{ coa_id: 1101 }] };
      }

      if (query.includes("FROM accounting_settings")) {
        return {
          rows: [{
            default_bank_account_id: null,
            ar_account_id: null,
            ap_account_id: null,
            purchase_expense_account_id: null,
            bank_journal_id: 88,
          }],
        };
      }

      if (query.includes("FROM bank_reconciliation_audit bra")) {
        return candidateRequired ? { rows: [{ id: 1 }] } : { rows: [] };
      }

      if (query.includes("FROM chart_of_accounts")) {
        return { rows: [{ id: 2202 }] };
      }

      return { rows: [] };
    }),
  };

  return { tx, executedQueries };
}

describe("manual COA approval without a candidate", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    captureFailedJob.mockResolvedValue(undefined);
    postEntryWithClient.mockResolvedValue({
      id: 9901,
      entryNumber: "BNK/2026/009901",
    });
  });

  it("creates a balanced draft journal from the external bank account reference", async () => {
    const { tx, executedQueries } = createTransactionMock();
    vi.mocked(db.transaction).mockImplementation(async (callback) =>
      callback(tx as never),
    );

    const result = await approveAndCreateJournal(
      7001,
      null,
      null,
      null,
      "manual-coa-regression",
      "Approval manual COA",
      "5-1035-CST",
    );

    expect(result).toMatchObject({
      ok: true,
      journalEntryId: 9901,
    });
    expect(postEntryWithClient).toHaveBeenCalledTimes(1);

    const postingInput = postEntryWithClient.mock.calls[0]?.[1];
    expect(postingInput).toMatchObject({
      journalId: 88,
      companyId: 42,
      source: "bank_reconciliation",
      sourceId: 7001,
    });
    expect(postingInput.lines).toEqual([
      {
        accountId: 2202,
        debit: 125000,
        credit: 0,
        description: "Approval manual COA",
      },
      {
        accountId: 1101,
        debit: 0,
        credit: 125000,
        description: "Approval manual COA",
      },
    ]);
    expect(postingInput.lines.reduce(
      (sum: number, line: { debit: number }) => sum + line.debit,
      0,
    )).toBe(postingInput.lines.reduce(
      (sum: number, line: { credit: number }) => sum + line.credit,
      0,
    ));

    expect(executedQueries.some((query) =>
      query.includes("account_number::text = '1234-5678'"),
    )).toBe(true);
    expect(executedQueries.some((query) =>
      query.includes("regexp_replace(account_number::text"),
    )).toBe(true);
    expect(executedQueries.some((query) =>
      query.includes("INSERT INTO bank_reconciliation_matches"),
    )).toBe(false);
  });

  it("keeps the line builder balanced for manual COA on an incoming mutation", () => {
    const lines = buildBankMutationJournalLines(
      "IN",
      1101,
      2202,
      125_000,
      "Penerimaan manual COA",
    );

    expect(lines[0]).toMatchObject({ accountId: 1101, debit: 125_000, credit: 0 });
    expect(lines[1]).toMatchObject({ accountId: 2202, debit: 0, credit: 125_000 });
    expect(lines.reduce((sum, line) => sum + line.debit, 0))
      .toBe(lines.reduce((sum, line) => sum + line.credit, 0));
  });

  it("normalizes legacy candidate aliases before journal reuse", async () => {
    const { tx } = createTransactionMock();
    vi.mocked(db.transaction).mockImplementation(async (callback) =>
      callback(tx as never),
    );

    const result = await approveAndCreateJournal(
      7001,
      null,
      "sales_documents",
      123,
      "manual-coa-alias-regression",
      "Approval manual COA dengan kandidat legacy",
      "5-1035-CST",
    );

    expect(result).toMatchObject({
      ok: true,
      journalEntryId: 9901,
    });
    expect(postEntryWithClient).toHaveBeenCalledTimes(1);
  });

  it("allows an explicit manual COA despite a Rule AI candidate-required marker", async () => {
    const { tx } = createTransactionMock(true);
    vi.mocked(db.transaction).mockImplementation(async (callback) =>
      callback(tx as never),
    );

    const result = await approveAndCreateJournal(
      7001,
      null,
      null,
      null,
      "manual-coa-rule-override-regression",
      "Approval manual COA setelah Rule AI",
      "5-1035-CST",
    );

    expect(result).toMatchObject({
      ok: true,
      journalEntryId: 9901,
    });
    expect(postEntryWithClient).toHaveBeenCalledTimes(1);
  });

  it("keeps the candidate-required block when no manual COA is supplied", async () => {
    const { tx } = createTransactionMock(true);
    vi.mocked(db.transaction).mockImplementation(async (callback) =>
      callback(tx as never),
    );

    const result = await approveAndCreateJournal(
      7001,
      null,
      null,
      null,
      "candidate-required-regression",
    );

    expect(result).toMatchObject({
      ok: false,
      code: "RULE_CANDIDATE_REQUIRED",
    });
    expect(postEntryWithClient).not.toHaveBeenCalled();
  });
});