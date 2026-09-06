import { beforeEach, describe, expect, it, vi } from "vitest";

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
});