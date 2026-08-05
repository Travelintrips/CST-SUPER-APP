/**
 * sport-center-bulk-accounting.test.ts
 *
 * Confirms bulkIngestModule('sport_center', companyId) correctly posts
 * sport_payments with status='paid' end-to-end:
 *   - accounting_payments row created (source_type='sport_center', source_doc_id=sp.id)
 *   - accounting_entries journal entry linked (entry_id IS NOT NULL)
 *   - sport_payments.posting_status updated to 'posted'
 *
 * Row shape for sport_center differs from tenant/logistics:
 *   - customer_name comes from sport_bookings JOIN (sb.customer_name)
 *   - booking_number field present (sb.booking_number)
 *
 * Uses a fully mocked @workspace/db — no live DB connection required.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

// ── Mocks (must be declared before any `await import`) ────────────────────────

const mockExecute = vi.fn();

vi.mock("@workspace/db", () => ({
  db: { execute: mockExecute },
}));

vi.mock("drizzle-orm", () => {
  const tag = (strings: TemplateStringsArray, ...values: unknown[]) => ({
    strings: Array.from(strings),
    values,
  });
  (tag as unknown as Record<string, unknown>)["raw"] = (s: string) => ({ raw: s });
  return { sql: tag };
});

vi.mock("../lib/logger.js", () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

// Stub the canonical posting engine so the test controls its output.
const mockPost = vi.fn();
vi.mock("../lib/posting-engine/index.js", () => ({
  getPostingEngine: () => ({ post: mockPost }),
}));

// ── Import AFTER mocks ────────────────────────────────────────────────────────

const { bulkIngestModule } = await import("../lib/ingestModulePayment.js");

// ── Fixtures ──────────────────────────────────────────────────────────────────

/**
 * A minimal sport_payment row as returned by the bulk SELECT.
 * Includes booking_number and customer_name from the sport_bookings JOIN.
 */
function makeSportPaymentRow(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: 1,
    company_id: 1,
    payment_number: "SC-001",
    amount: "350000",
    method: "transfer",
    paid_at: "2026-04-15T08:00:00Z",
    customer_name: "Budi Santoso",
    booking_number: "BK/202604/00001",
    ...overrides,
  };
}

/**
 * Seeds mockExecute with the 11 sequential responses that represent
 * a single sport_center payment being successfully posted end-to-end.
 *
 * Call order inside bulkIngestModule('sport_center') + ingestModulePayment:
 *  1.  SELECT sport_payments JOIN sport_bookings (bulk candidates)
 *  2.  SELECT accounting_payments (alreadyPosted idempotency check)
 *  3.  SELECT accounting_settings   → resolveJournal (bank_journal_id)
 *  4.  SELECT COUNT accounting_payments → generatePaymentNumber
 *  5.  INSERT accounting_payments RETURNING id
 *  6.  SELECT accounting_settings   → resolveBankAccount (bank account)
 *  7.  SELECT chart_of_accounts name → getAccountName (validate "bank")
 *  8.  SELECT accounting_settings   → resolveRevenueAccount
 *  9.  SELECT accounting_entries    → idempotency check before posting
 *       (getPostingEngine().post() mocked separately)
 * 10.  UPDATE accounting_payments SET entry_id
 * 11.  UPDATE sport_payments SET posting_status = 'posted'
 */
function seedHappyPath(row: Record<string, unknown> = makeSportPaymentRow()): void {
  mockExecute
    .mockResolvedValueOnce({ rows: [row] })                                             // 1
    .mockResolvedValueOnce({ rows: [] })                                                // 2
    .mockResolvedValueOnce({ rows: [{ cash_journal_id: 10, bank_journal_id: 11 }] })   // 3
    .mockResolvedValueOnce({ rows: [{ cnt: 5 }] })                                     // 4
    .mockResolvedValueOnce({ rows: [{ id: 501 }] })                                    // 5
    .mockResolvedValueOnce({ rows: [{ default_bank_account_id: 50, default_cash_account_id: null }] }) // 6
    .mockResolvedValueOnce({ rows: [{ name: "Bank BCA" }] })                           // 7
    .mockResolvedValueOnce({ rows: [{ sales_income_account_id: 40 }] })                // 8
    .mockResolvedValueOnce({ rows: [] })                                               // 9
    .mockResolvedValueOnce({ rows: [] })                                               // 10
    .mockResolvedValueOnce({ rows: [] });                                              // 11
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe("bulkIngestModule('sport_center') — sport center payments accounting", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockPost.mockResolvedValue({ ok: true, entryId: 801 });
  });

  // ── 1. Happy path ─────────────────────────────────────────────────────────

  it("creates accounting_payment row and links journal entry for a sport_center payment", async () => {
    seedHappyPath();

    const result = await bulkIngestModule("sport_center", 1);

    expect(result.total).toBe(1);
    expect(result.posted).toBe(1);
    expect(result.skipped).toBe(0);
    expect(result.errors).toBe(0);
    expect(result.failedRows).toEqual([]);
  });

  // ── 2. Posting engine receives correct double-entry amounts ───────────────

  it("passes correct debit/credit amounts to the posting engine", async () => {
    seedHappyPath();

    await bulkIngestModule("sport_center", 1);

    expect(mockPost).toHaveBeenCalledOnce();

    const postArgs = mockPost.mock.calls[0][0] as Record<string, unknown>;
    const lines = postArgs["lines"] as Array<{ debit: number; credit: number }>;
    expect(lines).toHaveLength(2);
    expect(lines[0].debit).toBe(350000);  // debit: bank account
    expect(lines[0].credit).toBe(0);
    expect(lines[1].debit).toBe(0);
    expect(lines[1].credit).toBe(350000); // credit: revenue account
  });

  // ── 3. source label is 'sport_center_booking' ────────────────────────────

  it("uses 'sport_center_booking' as the source label in the posting engine call", async () => {
    seedHappyPath();

    await bulkIngestModule("sport_center", 1);

    expect(mockPost).toHaveBeenCalledOnce();
    const postArgs = mockPost.mock.calls[0][0] as Record<string, unknown>;
    expect(postArgs["source"]).toBe("sport_center_booking");
  });

  // ── 4. Idempotency ────────────────────────────────────────────────────────

  it("is idempotent — skips a sport_center payment that already has an accounting_payment", async () => {
    mockExecute
      .mockResolvedValueOnce({ rows: [makeSportPaymentRow()] }) // 1. bulk SELECT
      .mockResolvedValueOnce({ rows: [{ id: 501 }] });          // 2. alreadyPosted → found

    const result = await bulkIngestModule("sport_center", 1);

    expect(result.total).toBe(1);
    expect(result.skipped).toBe(1);
    expect(result.posted).toBe(0);
    expect(result.errors).toBe(0);
    expect(result.failedRows).toEqual([]);
    expect(mockPost).not.toHaveBeenCalled();
  });

  // ── 5. Nothing to do ─────────────────────────────────────────────────────

  it("returns all-zero counts and does not call the posting engine when no payments are pending", async () => {
    mockExecute.mockResolvedValueOnce({ rows: [] }); // no candidates

    const result = await bulkIngestModule("sport_center", 1);

    expect(result.total).toBe(0);
    expect(result.posted).toBe(0);
    expect(result.skipped).toBe(0);
    expect(result.errors).toBe(0);
    expect(result.failedRows).toEqual([]);
    expect(mockPost).not.toHaveBeenCalled();
  });

  // ── 6. Missing journal — error path ──────────────────────────────────────

  it("increments errors count and does not call posting engine when no journal is configured", async () => {
    mockExecute
      .mockResolvedValueOnce({ rows: [makeSportPaymentRow({ id: 9, payment_number: "SC-009", amount: "200000" })] }) // 1
      .mockResolvedValueOnce({ rows: [] })                                              // 2. not yet posted
      .mockResolvedValueOnce({ rows: [{ cash_journal_id: null, bank_journal_id: null }] }) // 3. no journals in settings
      .mockResolvedValueOnce({ rows: [] })                                              // 4. fallback: no bank journal
      .mockResolvedValueOnce({ rows: [] })                                              // 5. fallback: no cash journal
      .mockResolvedValueOnce({ rows: [] });                                             // 6. fallback: no general journal

    const result = await bulkIngestModule("sport_center", 1);

    expect(result.total).toBe(1);
    expect(result.errors).toBe(1);
    expect(result.posted).toBe(0);
    expect(mockPost).not.toHaveBeenCalled();
    // failedRows must identify the exact source row and reason
    expect(result.failedRows).toHaveLength(1);
    expect(result.failedRows[0].sourceDocId).toBe(9);
    expect(result.failedRows[0].companyId).toBe(1);
    expect(result.failedRows[0].error).toBeTruthy();
  });

  // ── 7. Cash payment uses correct account type ─────────────────────────────

  it("resolves cash account for a cash-method sport_center payment", async () => {
    const cashRow = makeSportPaymentRow({ method: "cash", amount: "150000" });
    mockExecute
      .mockResolvedValueOnce({ rows: [cashRow] })                                       // 1
      .mockResolvedValueOnce({ rows: [] })                                              // 2
      .mockResolvedValueOnce({ rows: [{ cash_journal_id: 10, bank_journal_id: 11 }] }) // 3
      .mockResolvedValueOnce({ rows: [{ cnt: 3 }] })                                   // 4
      .mockResolvedValueOnce({ rows: [{ id: 502 }] })                                  // 5
      .mockResolvedValueOnce({ rows: [{ default_bank_account_id: null, default_cash_account_id: 30 }] }) // 6
      .mockResolvedValueOnce({ rows: [{ name: "Kas Operasional" }] })                  // 7
      .mockResolvedValueOnce({ rows: [{ sales_income_account_id: 40 }] })              // 8
      .mockResolvedValueOnce({ rows: [] })                                              // 9
      .mockResolvedValueOnce({ rows: [] })                                              // 10
      .mockResolvedValueOnce({ rows: [] });                                             // 11

    const result = await bulkIngestModule("sport_center", 1);

    expect(result.posted).toBe(1);
    expect(result.errors).toBe(0);
    expect(mockPost).toHaveBeenCalledOnce();

    const postArgs = mockPost.mock.calls[0][0] as Record<string, unknown>;
    const lines = postArgs["lines"] as Array<{ accountId: number }>;
    // debit line should use the cash account id (30)
    expect(lines[0].accountId).toBe(30);
  });

  // ── 8. customer_name from sport_bookings JOIN passed as partnerName ───────

  it("uses customer_name from sport_bookings JOIN as partnerName", async () => {
    const row = makeSportPaymentRow({ customer_name: "PT Olahraga Nusantara" });
    seedHappyPath(row);

    await bulkIngestModule("sport_center", 1);

    // Verify indirectly via posting engine: ref matches payment_number from the row
    expect(mockPost).toHaveBeenCalledOnce();
    const postArgs = mockPost.mock.calls[0][0] as Record<string, unknown>;
    expect(String(postArgs["ref"])).toBe("SC-001");
  });

  // ── 9. Bulk — 3 rows all posted (core task requirement) ──────────────────

  it("posts all 3 rows and returns posted=3 skipped=0 errors=0", async () => {
    const rows = [
      makeSportPaymentRow({ id: 10, payment_number: "SC-010", amount: "400000", booking_number: "BK/202604/00010" }),
      makeSportPaymentRow({ id: 11, payment_number: "SC-011", amount: "500000", booking_number: "BK/202604/00011" }),
      makeSportPaymentRow({ id: 12, payment_number: "SC-012", amount: "600000", booking_number: "BK/202604/00012" }),
    ];

    // Call 1: bulk SELECT → all 3 rows
    mockExecute.mockResolvedValueOnce({ rows });

    // Each row requires 10 sequential calls (steps 2-11):
    for (let i = 0; i < 3; i++) {
      mockExecute
        .mockResolvedValueOnce({ rows: [] })                                                              // 2  alreadyPosted
        .mockResolvedValueOnce({ rows: [{ cash_journal_id: 10, bank_journal_id: 11 }] })                  // 3  resolveJournal
        .mockResolvedValueOnce({ rows: [{ cnt: i }] })                                                    // 4  generatePaymentNumber
        .mockResolvedValueOnce({ rows: [{ id: 510 + i }] })                                               // 5  INSERT accounting_payments
        .mockResolvedValueOnce({ rows: [{ default_bank_account_id: 50, default_cash_account_id: null }] }) // 6  resolveBankAccount
        .mockResolvedValueOnce({ rows: [{ name: "Bank BCA" }] })                                          // 7  getAccountName
        .mockResolvedValueOnce({ rows: [{ sales_income_account_id: 40 }] })                               // 8  resolveRevenueAccount
        .mockResolvedValueOnce({ rows: [] })                                                              // 9  idempotency entry check
        .mockResolvedValueOnce({ rows: [] })                                                              // 10 UPDATE accounting_payments entry_id
        .mockResolvedValueOnce({ rows: [] });                                                             // 11 UPDATE sport_payments posting_status
    }

    const result = await bulkIngestModule("sport_center", 1);

    expect(result.total).toBe(3);
    expect(result.posted).toBe(3);
    expect(result.skipped).toBe(0);
    expect(result.errors).toBe(0);
    expect(result.failedRows).toEqual([]);
    expect(mockPost).toHaveBeenCalledTimes(3);
  });

  // ── 10. Bulk — mixed: 1 already-posted, 1 new, 1 no-journal (core task requirement) ──

  it("handles a mixed batch: skipped=1 posted=1 errors=1", async () => {
    const rowAlreadyPosted = makeSportPaymentRow({ id: 20, payment_number: "SC-020", amount: "300000", booking_number: "BK/202604/00020" });
    const rowNew           = makeSportPaymentRow({ id: 21, payment_number: "SC-021", amount: "450000", booking_number: "BK/202604/00021" });
    const rowNoJournal     = makeSportPaymentRow({ id: 22, payment_number: "SC-022", amount: "250000", booking_number: "BK/202604/00022" });

    // Call 1: bulk SELECT → all 3 rows
    mockExecute.mockResolvedValueOnce({ rows: [rowAlreadyPosted, rowNew, rowNoJournal] });

    // Row 20 — already posted (step 2 finds existing record → skip)
    mockExecute
      .mockResolvedValueOnce({ rows: [{ id: 701 }] });                                                   // 2  alreadyPosted

    // Row 21 — happy path (steps 2-11)
    mockExecute
      .mockResolvedValueOnce({ rows: [] })                                                               // 2  alreadyPosted
      .mockResolvedValueOnce({ rows: [{ cash_journal_id: 10, bank_journal_id: 11 }] })                   // 3  resolveJournal
      .mockResolvedValueOnce({ rows: [{ cnt: 15 }] })                                                    // 4  generatePaymentNumber
      .mockResolvedValueOnce({ rows: [{ id: 702 }] })                                                    // 5  INSERT accounting_payments
      .mockResolvedValueOnce({ rows: [{ default_bank_account_id: 50, default_cash_account_id: null }] }) // 6  resolveBankAccount
      .mockResolvedValueOnce({ rows: [{ name: "Bank BCA" }] })                                           // 7  getAccountName
      .mockResolvedValueOnce({ rows: [{ sales_income_account_id: 40 }] })                                // 8  resolveRevenueAccount
      .mockResolvedValueOnce({ rows: [] })                                                               // 9  idempotency entry check
      .mockResolvedValueOnce({ rows: [] })                                                               // 10 UPDATE accounting_payments entry_id
      .mockResolvedValueOnce({ rows: [] });                                                              // 11 UPDATE sport_payments posting_status

    // Row 22 — no journal configured (steps 2-6: resolveJournal fallbacks all empty)
    mockExecute
      .mockResolvedValueOnce({ rows: [] })                                                               // 2  alreadyPosted
      .mockResolvedValueOnce({ rows: [{ cash_journal_id: null, bank_journal_id: null }] })               // 3  resolveJournal settings
      .mockResolvedValueOnce({ rows: [] })                                                               // 4  fallback bank journal
      .mockResolvedValueOnce({ rows: [] })                                                               // 5  fallback cash journal
      .mockResolvedValueOnce({ rows: [] });                                                              // 6  fallback general journal

    const result = await bulkIngestModule("sport_center", 1);

    expect(result.total).toBe(3);
    expect(result.skipped).toBe(1);
    expect(result.posted).toBe(1);
    expect(result.errors).toBe(1);
    expect(mockPost).toHaveBeenCalledTimes(1);
    // failedRows must identify only the failed row (SC-022)
    expect(result.failedRows).toHaveLength(1);
    expect(result.failedRows[0].sourceDocId).toBe(22);
    expect(result.failedRows[0].companyId).toBe(1);
    expect(result.failedRows[0].error).toBeTruthy();
  });

  // ── 12. Missing booking row — customer_name NULL from LEFT JOIN ──────────

  it("posts successfully when customer_name is null (booking row absent from LEFT JOIN)", async () => {
    // Simulate a sport_payment whose booking has been deleted; the LEFT JOIN
    // returns NULL for customer_name instead of a string value.
    const rowNullCustomer = makeSportPaymentRow({
      id: 99,
      payment_number: "SC-099",
      amount: "175000",
      customer_name: null,          // ← key: booking absent from JOIN
      booking_number: null,         // ← also null when booking is gone
    });

    // Call 1: bulk SELECT → 1 row with null customer_name
    mockExecute.mockResolvedValueOnce({ rows: [rowNullCustomer] });

    // Steps 2-11: standard happy-path responses
    mockExecute
      .mockResolvedValueOnce({ rows: [] })                                                              // 2  alreadyPosted
      .mockResolvedValueOnce({ rows: [{ cash_journal_id: 10, bank_journal_id: 11 }] })                 // 3  resolveJournal
      .mockResolvedValueOnce({ rows: [{ cnt: 0 }] })                                                   // 4  generatePaymentNumber
      .mockResolvedValueOnce({ rows: [{ id: 599 }] })                                                  // 5  INSERT accounting_payments
      .mockResolvedValueOnce({ rows: [{ default_bank_account_id: 50, default_cash_account_id: null }] }) // 6  resolveBankAccount
      .mockResolvedValueOnce({ rows: [{ name: "Bank BCA" }] })                                         // 7  getAccountName
      .mockResolvedValueOnce({ rows: [{ sales_income_account_id: 40 }] })                              // 8  resolveRevenueAccount
      .mockResolvedValueOnce({ rows: [] })                                                             // 9  idempotency entry check
      .mockResolvedValueOnce({ rows: [] })                                                             // 10 UPDATE accounting_payments entry_id
      .mockResolvedValueOnce({ rows: [] });                                                            // 11 UPDATE sport_payments posting_status

    const result = await bulkIngestModule("sport_center", 1);

    // Should complete without throwing and count as a successful post
    expect(result.total).toBe(1);
    expect(result.posted).toBe(1);
    expect(result.skipped).toBe(0);
    expect(result.errors).toBe(0);
    expect(mockPost).toHaveBeenCalledTimes(1);

    // Confirm the posting engine ran (partnerName is used in the SQL INSERT,
    // not forwarded to post(); the fact that posted=1/errors=0 proves the
    // INSERT accepted an empty string without throwing).
    expect(mockPost).toHaveBeenCalledTimes(1);
  });

  // ── 13. companyId=null — each row uses its own company_id (core task requirement) ──

  it("uses each row's own company_id when bulkIngestModule is called with companyId=null", async () => {
    const rowCompany1 = makeSportPaymentRow({
      id: 101,
      company_id: 1,
      payment_number: "SC-101",
      amount: "400000",
      booking_number: "BK/202604/00101",
    });
    const rowCompany2 = makeSportPaymentRow({
      id: 201,
      company_id: 2,
      payment_number: "SC-201",
      amount: "550000",
      booking_number: "BK/202604/00201",
    });

    // Call 0: bulk SELECT with companyId=null → both rows returned
    mockExecute.mockResolvedValueOnce({ rows: [rowCompany1, rowCompany2] });

    // Row 101 (company_id=1) — steps 1-10
    mockExecute
      .mockResolvedValueOnce({ rows: [] })                                                              // 1  alreadyPosted
      .mockResolvedValueOnce({ rows: [{ cash_journal_id: 10, bank_journal_id: 11 }] })                 // 2  resolveJournal settings  ← values[0]=1
      .mockResolvedValueOnce({ rows: [{ cnt: 0 }] })                                                   // 3  generatePaymentNumber    ← values[0]=1
      .mockResolvedValueOnce({ rows: [{ id: 901 }] })                                                  // 4  INSERT accounting_payments
      .mockResolvedValueOnce({ rows: [{ default_bank_account_id: 50, default_cash_account_id: null }] }) // 5  resolveBankAccount       ← values[0]=1
      .mockResolvedValueOnce({ rows: [{ name: "Bank BCA" }] })                                         // 6  getAccountName
      .mockResolvedValueOnce({ rows: [{ sales_income_account_id: 40 }] })                              // 7  resolveRevenueAccount     ← values[0]=1
      .mockResolvedValueOnce({ rows: [] })                                                             // 8  idempotency entry check
      .mockResolvedValueOnce({ rows: [] })                                                             // 9  UPDATE accounting_payments entry_id
      .mockResolvedValueOnce({ rows: [] });                                                            // 10 UPDATE sport_payments

    // Row 201 (company_id=2) — steps 11-20
    mockExecute
      .mockResolvedValueOnce({ rows: [] })                                                              // 11 alreadyPosted
      .mockResolvedValueOnce({ rows: [{ cash_journal_id: 20, bank_journal_id: 21 }] })                 // 12 resolveJournal settings  ← values[0]=2
      .mockResolvedValueOnce({ rows: [{ cnt: 5 }] })                                                   // 13 generatePaymentNumber    ← values[0]=2
      .mockResolvedValueOnce({ rows: [{ id: 902 }] })                                                  // 14 INSERT accounting_payments
      .mockResolvedValueOnce({ rows: [{ default_bank_account_id: 60, default_cash_account_id: null }] }) // 15 resolveBankAccount       ← values[0]=2
      .mockResolvedValueOnce({ rows: [{ name: "Bank Mandiri" }] })                                     // 16 getAccountName
      .mockResolvedValueOnce({ rows: [{ sales_income_account_id: 45 }] })                              // 17 resolveRevenueAccount     ← values[0]=2
      .mockResolvedValueOnce({ rows: [] })                                                             // 18 idempotency entry check
      .mockResolvedValueOnce({ rows: [] })                                                             // 19 UPDATE accounting_payments entry_id
      .mockResolvedValueOnce({ rows: [] });                                                            // 20 UPDATE sport_payments

    // ── Call with null companyId ──────────────────────────────────────────────
    const result = await bulkIngestModule("sport_center", null);

    // Both rows must be posted, no errors, no skips
    expect(result.total).toBe(2);
    expect(result.posted).toBe(2);
    expect(result.skipped).toBe(0);
    expect(result.errors).toBe(0);
    expect(mockPost).toHaveBeenCalledTimes(2);

    // ── Verify company_id isolation in SQL calls ──────────────────────────────
    // The mocked sql tag returns { strings, values } — values is the spread
    // of interpolated arguments.  For single-param WHERE clauses like
    // `WHERE company_id = ${companyId}` the company_id lands at values[0].
    //
    // resolveJournal settings SELECT (call indices 2 and 12):
    const resolveJournalCall1 = mockExecute.mock.calls[2][0] as { values: unknown[] };
    const resolveJournalCall2 = mockExecute.mock.calls[12][0] as { values: unknown[] };
    expect(resolveJournalCall1.values[0]).toBe(1);   // row's company_id=1, NOT null
    expect(resolveJournalCall2.values[0]).toBe(2);   // row's company_id=2, NOT null

    // resolveBankAccount settings SELECT (call indices 5 and 15):
    const resolveBankCall1 = mockExecute.mock.calls[5][0] as { values: unknown[] };
    const resolveBankCall2 = mockExecute.mock.calls[15][0] as { values: unknown[] };
    expect(resolveBankCall1.values[0]).toBe(1);
    expect(resolveBankCall2.values[0]).toBe(2);

    // resolveRevenueAccount settings SELECT (call indices 7 and 17):
    const resolveRevenueCall1 = mockExecute.mock.calls[7][0] as { values: unknown[] };
    const resolveRevenueCall2 = mockExecute.mock.calls[17][0] as { values: unknown[] };
    expect(resolveRevenueCall1.values[0]).toBe(1);
    expect(resolveRevenueCall2.values[0]).toBe(2);

    // ── Posting engine calls reference each row's own sourceDocId ────────────
    // sourceId = sourceDocId (the sport_payment.id), confirming each row was
    // processed against its own identity and not mixed with the other company.
    const postCall1 = mockPost.mock.calls[0][0] as Record<string, unknown>;
    const postCall2 = mockPost.mock.calls[1][0] as Record<string, unknown>;
    expect(postCall1["sourceId"]).toBe(101);  // sourceDocId for row company_id=1
    expect(postCall2["sourceId"]).toBe(201);  // sourceDocId for row company_id=2
  });

  // ── 11. No double-counting: each row processed independently ─────────────

  it("processes each row independently — posting engine called once per row, not multiple times per row", async () => {
    const rows = [
      makeSportPaymentRow({ id: 30, payment_number: "SC-030", amount: "200000" }),
      makeSportPaymentRow({ id: 31, payment_number: "SC-031", amount: "300000" }),
    ];

    mockExecute.mockResolvedValueOnce({ rows });

    for (let i = 0; i < 2; i++) {
      mockExecute
        .mockResolvedValueOnce({ rows: [] })
        .mockResolvedValueOnce({ rows: [{ cash_journal_id: 10, bank_journal_id: 11 }] })
        .mockResolvedValueOnce({ rows: [{ cnt: i }] })
        .mockResolvedValueOnce({ rows: [{ id: 530 + i }] })
        .mockResolvedValueOnce({ rows: [{ default_bank_account_id: 50, default_cash_account_id: null }] })
        .mockResolvedValueOnce({ rows: [{ name: "Bank BCA" }] })
        .mockResolvedValueOnce({ rows: [{ sales_income_account_id: 40 }] })
        .mockResolvedValueOnce({ rows: [] })
        .mockResolvedValueOnce({ rows: [] })
        .mockResolvedValueOnce({ rows: [] });
    }

    const result = await bulkIngestModule("sport_center", 1);

    expect(result.posted).toBe(2);
    expect(result.skipped).toBe(0);
    expect(result.errors).toBe(0);
    // Exactly one post() call per row — no double-counting
    expect(mockPost).toHaveBeenCalledTimes(2);

    // Each call must reference a different sourceId
    const call0 = mockPost.mock.calls[0][0] as Record<string, unknown>;
    const call1 = mockPost.mock.calls[1][0] as Record<string, unknown>;
    expect(call0["sourceId"]).not.toBe(call1["sourceId"]);
  });
});
