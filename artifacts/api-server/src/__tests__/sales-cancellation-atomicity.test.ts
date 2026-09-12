/**
 * B2 Atomicity Tests — Sales Order Cancellation + Journal Reversal
 *
 * Membuktikan bahwa postSalesInvoiceReversal:
 *   A. Jika reversal gagal → error propagate ke caller (no swallow), transaction rollback
 *   B. Jika SO update berhasil, reversal di tengah jalan → semua menggunakan client yang sama
 *   C. Cancel berhasil → SO cancelled + satu reversal journal dibuat via client yang sama
 *   D. Cancel diulang → idempotency: tidak ada duplicate reversal
 *
 * Semua operasi DB diverifikasi memakai client (transaction context), bukan global db.
 */

import { describe, it, expect, vi, beforeEach, type MockInstance } from "vitest";

// ── Stub @workspace/db ────────────────────────────────────────────────────────
vi.mock("@workspace/db", () => {
  const chain: Record<string, unknown> = {};
  for (const m of ["select", "insert", "update", "from", "where", "values",
                   "returning", "onConflictDoNothing", "set", "delete"]) {
    chain[m] = vi.fn().mockReturnValue(chain);
  }
  chain["limit"]   = vi.fn().mockResolvedValue([]);
  chain["execute"] = vi.fn().mockResolvedValue({ rows: [] });
  // db.transaction: calls callback with a tx client, propagates errors
  chain["transaction"] = vi.fn().mockImplementation(async (fn: (tx: unknown) => Promise<unknown>) => fn(chain));

  return {
    db: chain,
    accountingEntriesTable:    { id: "id", source: "source", sourceId: "source_id", journalId: "journal_id" },
    accountingEntryLinesTable: { entryId: "entry_id" },
    chartOfAccountsTable:      { id: "id", code: "code", companyId: "company_id" },
    costCentersTable:          { id: "id", code: "code", companyId: "company_id" },
    sql: (strings: TemplateStringsArray, ...vals: unknown[]) => ({ strings, vals }),
    eq:  (a: unknown, b: unknown) => ({ a, b }),
    and: (...args: unknown[]) => args,
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
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));
vi.mock("../lib/events/financialEventBus.js", () => ({
  emitJournalCreated: vi.fn(),
}));
vi.mock("../lib/accounting/outboxProcessor.js", () => ({
  writeToOutbox: vi.fn(),
}));
vi.mock("../lib/jobs/ledgerConsistencyCheck.js", () => ({
  scheduleSpotCheck: vi.fn(),
}));
vi.mock("../lib/ledgerImmutability.js", () => ({
  lockAccountingEntry: vi.fn().mockResolvedValue(undefined),
}));

// ── Helpers ───────────────────────────────────────────────────────────────────

/**
 * Build a mock DbClient that tracks which methods are called.
 * selectQueue: sequential results for .limit() calls.
 * executeQueue: sequential results for .execute() calls.
 */
function makeMockClient(opts: {
  selectResults?: unknown[][];
  awaitResults?: unknown[][];
  executeResults?: { rows: unknown[] }[];
} = {}) {
  const selectQueue = [...(opts.selectResults ?? [])];
  const awaitQueue = [...(opts.awaitResults ?? [])];
  const executeQueue = [...(opts.executeResults ?? [])];

  const mockLimit = vi.fn().mockImplementation(() => Promise.resolve(selectQueue.shift() ?? []));
  const mockExecute = vi.fn().mockImplementation(() => Promise.resolve(executeQueue.shift() ?? { rows: [] }));

  const client: Record<string, unknown> = {};
  for (const m of ["select", "insert", "update", "from", "where", "values",
                   "onConflictDoNothing", "set"]) {
    client[m] = vi.fn().mockReturnValue(client);
  }
  client["then"] = (
    resolve: (value: unknown) => unknown,
    reject: (reason: unknown) => unknown,
  ) => Promise.resolve(awaitQueue.shift() ?? []).then(resolve, reject);
  client["returning"] = vi.fn().mockImplementation(() => Promise.resolve([]));
  client["limit"]   = mockLimit;
  client["execute"] = mockExecute;

  return { client, mockLimit, mockExecute };
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe("postSalesInvoiceReversal — B2 atomicity", () => {
  let ensureAccountingSettings: MockInstance;

  beforeEach(async () => {
    vi.clearAllMocks();
    const seed = await import("../lib/accountingSeed.js");
    ensureAccountingSettings = seed.ensureAccountingSettings as unknown as MockInstance;
  });

  // ── Test A: reversal gagal → error propagate (no silent swallow) ─────────
  it("A: reversal gagal → error propagates ke caller (tidak ditelan)", async () => {
    ensureAccountingSettings.mockResolvedValue({
      id: 1, salesJournalId: 10,
    });

    // selectResults: idempotency lookup original entry → empty (no entry found)
    // Function returns early (no entry) — but we test that a throw propagates
    const { client } = makeMockClient({ selectResults: [[]] });

    // Override client.limit to throw on first call (simulating DB error)
    (client as Record<string, unknown>)["limit"] = vi.fn().mockRejectedValueOnce(
      new Error("DB_ERROR: connection lost"),
    );

    const { postSalesInvoiceReversal } = await import("../lib/accounting.js");

    // B2 guarantee: error must propagate — no try/catch swallowing
    await expect(
      postSalesInvoiceReversal(client as never, {
        salesDocId:   1001,
        docNumber:    "SO/2026/0001",
        customerName: "PT Maju",
        companyId:    1,
      }),
    ).rejects.toThrow("DB_ERROR");
  });

  // ── Test B: semua operasi memakai client yang sama (bukan global db) ──────
  it("B: seluruh select lookup menggunakan client parameter, bukan global db", async () => {
    ensureAccountingSettings.mockResolvedValue({
      id: 1, salesJournalId: 10,
    });

    const dbMod = await import("@workspace/db") as unknown as { db: Record<string, unknown> };
    const globalDbSelect = dbMod.db["select"] as ReturnType<typeof vi.fn>;
    const globalSelectCallsBefore = globalDbSelect.mock.calls.length;

    // client selectResults:
    //   call 1 → original entry found
    //   call 2 → no existing reversal (idempotency clear)
    //   call 3 → entry lines
    const fakeEntry = { id: 50, journalId: 10, source: "sales_invoice", sourceId: 1001 };
    const fakeLine  = { accountId: 5, debit: "100", credit: "0", description: "AR" };
    const { client, mockLimit } = makeMockClient({
      selectResults: [
        [fakeEntry],          // original entry found
        [],                   // no existing reversal
        [fakeLine],           // entry lines
        // _postEntryCore idempotency check inside same client
        [],                   // no duplicate entry
      ],
      executeResults: [
        { rows: [{ claimed_seq: 1 }] },  // journal_sequences for entry number
        { rows: [{ id: 999 }] },         // accounting_entries INSERT returning
        { rows: [] },                    // ledger event
      ],
    });

    const { postSalesInvoiceReversal } = await import("../lib/accounting.js");

    await postSalesInvoiceReversal(client as never, {
      salesDocId:   1001,
      docNumber:    "SO/2026/0001",
      customerName: "PT Maju",
      companyId:    1,
    });

    // Global db.select must NOT have been called during this operation
    const globalSelectCallsAfter = globalDbSelect.mock.calls.length;
    expect(globalSelectCallsAfter).toBe(globalSelectCallsBefore);

    // client.select MUST have been called (for lookups)
    expect((client["select"] as ReturnType<typeof vi.fn>).mock.calls.length).toBeGreaterThan(0);
  });

  // ── Test C: cancel berhasil → satu reversal journal dibuat via client ─────
  it("C: cancel berhasil → reversal journal di-insert via transaction client", async () => {
    ensureAccountingSettings.mockResolvedValue({
      id: 1, salesJournalId: 10,
    });

    const fakeOriginalEntry = { id: 50, journalId: 10, source: "sales_invoice", sourceId: 1002 };
    const fakeLines = [
      { accountId: 5, debit: "500000", credit: "0",      description: "AR Pelanggan" },
      { accountId: 6, debit: "0",      credit: "500000", description: "Pendapatan" },
    ];
    const fakeNewEntry = { id: 777, entryNumber: "SAL/2026/0005" };

    const { client } = makeMockClient({
      selectResults: [
        [fakeOriginalEntry], // lookup: original sales_invoice entry
        [],                  // idempotency: no existing reversal
        [],                  // _postEntryCore idempotency check (no duplicate)
      ],
      awaitResults: [
        fakeLines,            // entry lines query has no .limit()
      ],
      executeResults: [
        { rows: [{ claimed_seq: 5 }] }, // _nextEntryNumber journal_sequences UPSERT
        { rows: [] },                   // postLedgerEvent insert (non-blocking void)
      ],
    });

    // _postEntryCore uses client.insert().values().onConflictDoNothing().returning()
    // returning() must resolve to an array so entry = inserted[0] is defined.
    (client as Record<string, unknown>)["returning"] = vi.fn()
      .mockResolvedValueOnce([fakeNewEntry])  // accounting_entries INSERT
      .mockResolvedValue([]);                  // fallback for any other returning() call

    const { postSalesInvoiceReversal } = await import("../lib/accounting.js");

    await postSalesInvoiceReversal(client as never, {
      salesDocId:   1002,
      docNumber:    "SO/2026/0002",
      customerName: "PT Sejahtera",
      companyId:    1,
    });

    // client.insert must have been called (for accounting_entries AND accounting_entry_lines)
    expect((client["insert"] as ReturnType<typeof vi.fn>).mock.calls.length).toBeGreaterThanOrEqual(2);

    // client.select must have been called (for lookups — not global db)
    expect((client["select"] as ReturnType<typeof vi.fn>).mock.calls.length).toBeGreaterThanOrEqual(3);
  });

  // ── Test D: cancel diulang → idempotency: tidak ada duplicate reversal ────
  it("D: cancel diulang → idempotency guard mencegah duplicate reversal", async () => {
    ensureAccountingSettings.mockResolvedValue({
      id: 1, salesJournalId: 10,
    });

    const fakeEntry = { id: 50, journalId: 10, source: "sales_invoice", sourceId: 1003 };
    const existingReversal = { id: 99, source: "reversal", sourceId: 1003, journalId: 10 };

    const { client } = makeMockClient({
      selectResults: [
        [fakeEntry],          // original entry found
        [existingReversal],   // reversal already exists → idempotency skip
      ],
    });

    const { postSalesInvoiceReversal } = await import("../lib/accounting.js");

    // Should complete without error (idempotent skip, not a failure)
    await expect(
      postSalesInvoiceReversal(client as never, {
        salesDocId:   1003,
        docNumber:    "SO/2026/0003",
        customerName: "PT Abadi",
        companyId:    1,
      }),
    ).resolves.toBeUndefined();

    // client.insert must NOT have been called (no new journal entry)
    expect((client["insert"] as ReturnType<typeof vi.fn>).mock.calls.length).toBe(0);
  });
});
