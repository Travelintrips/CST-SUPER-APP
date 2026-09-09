import { beforeEach, describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";

const { mockExecute, mockPostEntry } = vi.hoisted(() => ({
  mockExecute: vi.fn(),
  mockPostEntry: vi.fn(),
}));

vi.mock("@workspace/db", () => ({
  db: { execute: mockExecute },
  sql: (strings: TemplateStringsArray, ...values: unknown[]) => ({ strings, values }),
}));

vi.mock("../lib/accounting.js", () => ({
  postEntry: mockPostEntry,
}));

vi.mock("../lib/accounting/ledgerGuard.js", () => ({
  validateJournalCreation: vi.fn(),
  tagJournalEntry: vi.fn(),
}));

vi.mock("../lib/events/financialEventBus.js", () => ({
  emitJournalCreated: vi.fn(),
}));

vi.mock("../lib/taxEngineCore.js", () => ({
  autoMapJournalTax: vi.fn(),
}));

vi.mock("../lib/logger.js", () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

import { voidApprovedJournal } from "../lib/accounting/approveAndCreateJournal.js";
import { ORIGINAL_VOID_UPDATE_FAILED } from "../lib/accounting/reversalFailure.js";
import { reverseJournal } from "../lib/sapInvoiceLockEngine.js";

describe("voidApprovedJournal metadata failure", () => {
  beforeEach(() => {
    mockExecute.mockReset();
    mockPostEntry.mockReset();
  });

  it("returns an explicit failure when reversal exists but original void metadata update throws", async () => {
    mockExecute
      .mockResolvedValueOnce({
        rows: [{
          id: 10,
          company_id: 1,
          status: "posted",
          void_entry_id: null,
          ref: "BANK-10",
          description: "Bank mutation",
        }],
      })
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({
        rows: [
          { account_id: 101, debit: "100", credit: "0", description: "Bank" },
          { account_id: 201, debit: "0", credit: "100", description: "Revenue" },
        ],
      })
      .mockRejectedValueOnce(new Error("LEDGER IMMUTABILITY VIOLATION"));
    mockPostEntry.mockResolvedValueOnce({ id: 20 });

    const result = await voidApprovedJournal({
      entryId: 10,
      companyId: 1,
      journalId: 7,
      journalCode: "BANK",
      actor: "admin@example.com",
      reason: "test metadata failure",
    });

    expect(mockPostEntry).toHaveBeenCalledOnce();
    expect(result).toMatchObject({
      ok: false,
      voidEntryId: 20,
      code: ORIGINAL_VOID_UPDATE_FAILED,
    });
    expect(result.error).toContain("LEDGER IMMUTABILITY VIOLATION");
  });

  it("updates void metadata without referencing an updated_at column", async () => {
    mockExecute
      .mockResolvedValueOnce({
        rows: [{
          id: 10,
          company_id: 1,
          status: "posted",
          void_entry_id: null,
          ref: "BANK-10",
          description: "Bank mutation",
        }],
      })
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({
        rows: [
          { account_id: 101, debit: "100", credit: "0", description: "Bank" },
          { account_id: 201, debit: "0", credit: "100", description: "Revenue" },
        ],
      })
      .mockResolvedValueOnce({
        rows: [{ status: "voided", void_entry_id: 20 }],
      });
    mockPostEntry.mockResolvedValueOnce({ id: 20 });

    const result = await voidApprovedJournal({
      entryId: 10,
      companyId: 1,
      journalId: 7,
      journalCode: "BANK",
      actor: "admin@example.com",
      reason: "test schema compatibility",
    });

    const source = readFileSync(
      new URL("../lib/accounting/approveAndCreateJournal.ts", import.meta.url),
      "utf8",
    );
    expect(source).toContain("UPDATE accounting_entries");
    expect(source).not.toContain("updated_at");
    expect(result).toMatchObject({ ok: true, voidEntryId: 20 });
  });

  it("keeps every startup trigger repair compatible with linked reversals", () => {
    const source = readFileSync(
      new URL("../lib/accountingHubMigration.ts", import.meta.url),
      "utf8",
    );
    const repair = source.slice(
      source.indexOf("export async function runSportCenterPaymentAccountingMetadataBackfill"),
    );

    expect(repair).toContain("NEW.status = 'voided'");
    expect(repair).toContain("NEW.void_entry_id IS NOT NULL");
    expect(repair).toContain("NEW.total_debit  IS NOT DISTINCT FROM OLD.total_debit");
    expect(repair).toContain("NEW.total_credit IS NOT DISTINCT FROM OLD.total_credit");
  });

  it("refreshes the linked-reversal guard before startup readiness", () => {
    const source = readFileSync(new URL("../index.ts", import.meta.url), "utf8");

    expect(source).toContain("posted_entry_void_transition_guard_v1");
    expect(source).toContain("ensurePostedEntryVoidTransitionGuard");
  });

  it("does not create a duplicate reversal when retrying the partial state", async () => {
    mockExecute
      // First attempt: original lookup, reversal lookup, original lines,
      // then the metadata update fails after postEntry has committed.
      .mockResolvedValueOnce({
        rows: [{
          id: 10,
          company_id: 1,
          status: "posted",
          void_entry_id: null,
        }],
      })
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({
        rows: [
          { account_id: 101, debit: "100", credit: "0", description: "Bank" },
          { account_id: 201, debit: "0", credit: "100", description: "Revenue" },
        ],
      })
      .mockRejectedValueOnce(new Error("LEDGER IMMUTABILITY VIOLATION"))
      // Retry: the committed reversal is found before postEntry can run.
      .mockResolvedValueOnce({
        rows: [{
          id: 10,
          company_id: 1,
          status: "posted",
          void_entry_id: null,
        }],
      })
      .mockResolvedValueOnce({ rows: [{ id: 20 }] });
    mockPostEntry.mockResolvedValueOnce({ id: 20 });

    const input = {
      entryId: 10,
      companyId: 1,
      journalId: 7,
      journalCode: "BANK",
      actor: "admin@example.com",
      reason: "test metadata failure",
    };

    const firstResult = await voidApprovedJournal(input);
    const retryResult = await voidApprovedJournal(input);

    expect(firstResult).toMatchObject({
      ok: false,
      voidEntryId: 20,
      code: ORIGINAL_VOID_UPDATE_FAILED,
    });
    expect(retryResult).toMatchObject({
      ok: false,
      code: "JOURNAL_ALREADY_VOIDED",
    });
    expect(mockPostEntry).toHaveBeenCalledOnce();
  });

  it("fails closed when a posted vendor correction is attempted twice", () => {
    const original = {
      journal_id: "vendor-journal-1",
      invoice_id: 42,
      entries: [
        { account: "Expense", debit: 28_553_506, credit: 0 },
        { account: "PPN Masukan", debit: 3_140_886, credit: 0 },
        { account: "Accounts Payable", debit: 0, credit: 31_694_392 },
      ],
      status: "POSTED" as const,
      created_at: "2026-09-06T00:00:00.000Z",
    };

    const reversal = reverseJournal(original);

    expect(reversal).toMatchObject({
      invoice_id: 42,
      reversed_from: "vendor-journal-1",
      status: "REVERSED",
    });
    expect(() => reverseJournal(reversal)).toThrow("ONLY_POSTED_JOURNAL_CAN_BE_REVERSED");
  });
});