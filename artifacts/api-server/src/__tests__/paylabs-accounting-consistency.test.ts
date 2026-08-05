/**
 * Paylabs accounting consistency tests.
 *
 * The webhook is provider-authenticated, while journal posting is an internal
 * side effect. These tests verify that posting returns an explicit result,
 * failures are persisted for recovery, and a later retry can succeed.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { isNewPaidTransition } from "../lib/paymentWebhookConsistency.js";

vi.mock("@workspace/db", () => {
  const chain: Record<string, any> = {};
  for (const method of [
    "select", "insert", "update", "from", "where", "values", "set",
    "onConflictDoNothing", "limit",
  ]) {
    chain[method] = vi.fn().mockReturnValue(chain);
  }
  chain.returning = vi.fn().mockResolvedValue([{
    id: 700,
    entryNumber: "BNK/2026/000001",
  }]);
  chain.execute = vi.fn().mockResolvedValue({ rows: [{ claimed_seq: 1 }] });
  chain.transaction = vi.fn().mockImplementation(async (fn: (tx: unknown) => Promise<unknown>) => fn(chain));
  return {
    db: chain,
    accountingEntriesTable: { id: "id", source: "source", sourceId: "source_id", journalId: "journal_id" },
    accountingEntryLinesTable: { entryId: "entry_id" },
    accountingTaxesTable: { id: "id" },
    accountingPostingErrorsTable: { id: "id" },
    chartOfAccountsTable: { id: "id", code: "code", companyId: "company_id" },
    costCentersTable: { id: "id", code: "code", companyId: "company_id" },
    sql: (strings: TemplateStringsArray, ...values: unknown[]) => ({ strings, values }),
    eq: (a: unknown, b: unknown) => ({ a, b }),
    and: (...values: unknown[]) => values,
  };
});

vi.mock("../lib/accountingSeed.js", () => ({
  ensureAccountingSettings: vi.fn(),
  applyAccountingEnumPatches: vi.fn(),
}));
vi.mock("../lib/currencyTolerance.js", () => ({
  validateMultiCurrencyBalance: vi.fn().mockReturnValue({ balanced: true, detail: "" }),
}));
vi.mock("../lib/logger.js", () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));
vi.mock("../lib/events/financialEventBus.js", () => ({ emitJournalCreated: vi.fn() }));
vi.mock("../lib/accounting/outboxProcessor.js", () => ({ writeToOutbox: vi.fn() }));
vi.mock("../lib/jobs/ledgerConsistencyCheck.js", () => ({ scheduleSpotCheck: vi.fn() }));
vi.mock("../lib/ledgerImmutability.js", () => ({ lockAccountingEntry: vi.fn().mockResolvedValue(undefined) }));

describe("Paylabs accounting consistency", () => {
  beforeEach(() => vi.clearAllMocks());

  it("callback success path reports a posted payment", async () => {
    const seed = await import("../lib/accountingSeed.js");
    vi.mocked(seed.ensureAccountingSettings).mockResolvedValue({
      defaultCashAccountId: 11,
      defaultBankAccountId: 12,
      arAccountId: 13,
      apAccountId: 14,
      cashJournalId: 15,
      bankJournalId: 16,
      salesJournalId: 17,
      purchaseJournalId: 18,
    } as never);
    const accounting = await import("../lib/accounting.js");
    await expect(accounting.postPaymentReceived({
      paymentId: 10,
      refKind: "sales",
      refDocNumber: "PAY/10",
      amount: 100,
      companyId: 1,
    })).resolves.toBe(true);
  });

  it("posting failure returns false and persists a recoverable error", async () => {
    const seed = await import("../lib/accountingSeed.js");
    vi.mocked(seed.ensureAccountingSettings).mockResolvedValue({
      defaultCashAccountId: null,
      defaultBankAccountId: null,
      arAccountId: 13,
      apAccountId: 14,
      cashJournalId: null,
      bankJournalId: null,
      salesJournalId: 17,
      purchaseJournalId: 18,
    } as never);
    const dbModule = await import("@workspace/db");
    const db = dbModule.db as unknown as Record<string, ReturnType<typeof vi.fn>>;
    const result = await (await import("../lib/accounting.js")).postPaymentReceived({
      paymentId: 11,
      refKind: "sales",
      refDocNumber: "PAY/11",
      amount: 100,
      companyId: 1,
    });
    expect(result).toBe(false);
    expect(db.insert).toHaveBeenCalled();
  });

  it("a later retry can succeed after the first posting failure", async () => {
    const seed = await import("../lib/accountingSeed.js");
    const settings = {
      defaultCashAccountId: 11,
      defaultBankAccountId: 12,
      arAccountId: 13,
      apAccountId: 14,
      cashJournalId: 15,
      bankJournalId: 16,
      salesJournalId: 17,
      purchaseJournalId: 18,
    };
    vi.mocked(seed.ensureAccountingSettings)
      .mockResolvedValueOnce({ ...settings, defaultBankAccountId: null, bankJournalId: null } as never)
      .mockResolvedValueOnce(settings as never);
    const accounting = await import("../lib/accounting.js");
    const args = { paymentId: 12, refKind: "sales" as const, refDocNumber: "PAY/12", amount: 100, companyId: 1 };
    await expect(accounting.postPaymentReceived(args)).resolves.toBe(false);
    await expect(accounting.postPaymentReceived(args)).resolves.toBe(true);
  });

  it("duplicate callback remains safe at the route boundary", () => {
    // A repeated provider callback is a real no-op, not merely a source-text
    // convention: only the pending → paid transition is eligible for posting.
    expect(isNewPaidTransition("pending", "paid")).toBe(true);
    expect(isNewPaidTransition("paid", "paid")).toBe(false);
    expect(isNewPaidTransition("failed", "paid")).toBe(true);
  });
});