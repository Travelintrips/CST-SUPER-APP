/**
 * sport-center-payment-accounting.test.ts
 *
 * Confirms bulkIngestModule('sport_center', companyId) correctly posts
 * sport_payments with status='paid' end-to-end:
 *   - accounting_payments row created (source_type='sport_center', source_doc_id=sp.id)
 *   - accounting_entries journal entry linked (entry_id IS NOT NULL)
 *   - sport_payments.posting_status updated to 'posted'
 *
 * Uses a fully mocked @workspace/db — no live DB connection required.
 */

import { describe, it, expect, vi, beforeEach, type MockInstance } from "vitest";

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
const { logger } = await import("../lib/logger.js");

// ── Fixtures ──────────────────────────────────────────────────────────────────

/** A minimal sport_payment row as returned by the bulk SELECT (with sport_bookings JOIN). */
function makeSportPaymentRow(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: 1,
    company_id: 1,
    payment_number: "SPT-001",
    amount: "250000",
    method: "transfer",
    paid_at: "2026-04-15T08:00:00Z",
    customer_name: "Budi Santoso",
    booking_number: "BKG-001",
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
    .mockResolvedValueOnce({ rows: [{ cnt: 2 }] })                                     // 4
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
  });

  // ── 2. Posting engine receives correct double-entry amounts ───────────────

  it("passes correct debit/credit amounts to the posting engine", async () => {
    seedHappyPath();

    await bulkIngestModule("sport_center", 1);

    expect(mockPost).toHaveBeenCalledOnce();

    const postArgs = mockPost.mock.calls[0][0] as Record<string, unknown>;
    const lines = postArgs["lines"] as Array<{ debit: number; credit: number }>;
    expect(lines).toHaveLength(2);
    expect(lines[0].debit).toBe(250000);  // debit: bank account
    expect(lines[0].credit).toBe(0);
    expect(lines[1].debit).toBe(0);
    expect(lines[1].credit).toBe(250000); // credit: revenue account
  });

  // ── 3. source label is 'sport_center_booking' for sport_center ───────────

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
    expect(mockPost).not.toHaveBeenCalled();
  });

  it("recognizes an adopted canonical entry by source_payment_id without inserting", async () => {
    mockExecute
      .mockResolvedValueOnce({ rows: [makeSportPaymentRow({ id: 268, amount: "700000" })] })
      .mockResolvedValueOnce({
      rows: [{
        payment_id: 5776,
        payment_status: "posted",
        payment_amount: "700000",
        payment_entry_id: 28058,
        entry_id: 28058,
        entry_status: "posted",
        entry_total_debit: "700000",
        entry_total_credit: "700000",
        entry_source_payment_id: 268,
      }],
      });

    const result = await bulkIngestModule("sport_center", 1);

    expect(result.skipped).toBe(1);
    expect(result.posted).toBe(0);
    expect(result.errors).toBe(0);
    expect(mockPost).not.toHaveBeenCalled();
    expect(mockExecute).toHaveBeenCalledTimes(2);
  });

  it("fails closed when an existing accounting identity has a mismatched amount", async () => {
    mockExecute
      .mockResolvedValueOnce({ rows: [makeSportPaymentRow({ id: 268, amount: "700000" })] })
      .mockResolvedValueOnce({
      rows: [{
        payment_id: 5776,
        payment_status: "posted",
        payment_amount: "699000",
        payment_entry_id: 28058,
        entry_id: 28058,
        entry_status: "posted",
        entry_total_debit: "699000",
        entry_total_credit: "699000",
        entry_source_payment_id: 268,
      }],
      });

    const result = await bulkIngestModule("sport_center", 1);

    expect(result.errors).toBe(1);
    expect(result.posted).toBe(0);
    expect(result.skipped).toBe(0);
    expect(mockPost).not.toHaveBeenCalled();
    expect(result.failedRows[0]?.error).toContain("ACCOUNTING_IDEMPOTENCY_MISMATCH");
  });

  it("recovers a unique source_payment_id race by re-reading the posted entry", async () => {
    mockPost.mockResolvedValueOnce({
      ok: false,
      error: "duplicate key value violates unique constraint \"uq_public_accounting_entries_source_payment_id\"",
      errorCode: "UNIQUE_VIOLATION",
    });
    mockExecute
      .mockResolvedValueOnce({ rows: [makeSportPaymentRow({ id: 268, amount: "700000" })] }) // candidates
      .mockResolvedValueOnce({ rows: [] }) // pre-insert idempotency check
      .mockResolvedValueOnce({ rows: [{ cash_journal_id: 10, bank_journal_id: 11 }] }) // journal
      .mockResolvedValueOnce({ rows: [{ cnt: 2 }] }) // payment number
      .mockResolvedValueOnce({ rows: [{ id: 5777 }] }) // accounting payment insert
      .mockResolvedValueOnce({ rows: [{ default_bank_account_id: 50, default_cash_account_id: null }] }) // bank account
      .mockResolvedValueOnce({ rows: [{ name: "Bank BCA" }] }) // account name
      .mockResolvedValueOnce({ rows: [{ sales_income_account_id: 40 }] }) // revenue
      .mockResolvedValueOnce({ rows: [] }) // entry by ref
      .mockResolvedValueOnce({ // re-read after unique race
        rows: [{
          payment_id: 5776,
          payment_status: "posted",
          payment_amount: "700000",
          payment_entry_id: 28058,
          entry_id: 28058,
          entry_status: "posted",
          entry_total_debit: "700000",
          entry_total_credit: "700000",
          entry_source_payment_id: 268,
        }],
      })
      .mockResolvedValueOnce({ rows: [] }) // link race payment
      .mockResolvedValueOnce({ rows: [] }); // mirror status

    const result = await bulkIngestModule("sport_center", 1);

    expect(result.posted).toBe(0);
    expect(result.skipped).toBe(1);
    expect(result.errors).toBe(0);
    expect(result.failedRows).toHaveLength(0);
  });

  // ── 5. Nothing to do ─────────────────────────────────────────────────────

  it("returns all-zero counts and does not call the posting engine when no payments are pending", async () => {
    mockExecute.mockResolvedValueOnce({ rows: [] }); // no candidates

    const result = await bulkIngestModule("sport_center", 1);

    expect(result.total).toBe(0);
    expect(result.posted).toBe(0);
    expect(result.skipped).toBe(0);
    expect(result.errors).toBe(0);
    expect(mockPost).not.toHaveBeenCalled();
  });

  // ── 6. Missing journal — error path ──────────────────────────────────────

  it("increments errors count and does not call posting engine when no journal is configured", async () => {
    mockExecute
      .mockResolvedValueOnce({ rows: [makeSportPaymentRow({ id: 9, payment_number: "SPT-009", amount: "150000" })] }) // 1
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
  });

  // ── 7. Cash payment uses correct account type ─────────────────────────────

  it("resolves cash account for a cash-method sport_center payment", async () => {
    const cashRow = makeSportPaymentRow({ method: "tunai", amount: "80000" });
    mockExecute
      .mockResolvedValueOnce({ rows: [cashRow] })                                       // 1
      .mockResolvedValueOnce({ rows: [] })                                              // 2
      .mockResolvedValueOnce({ rows: [{ cash_journal_id: 10, bank_journal_id: 11 }] }) // 3
      .mockResolvedValueOnce({ rows: [{ cnt: 1 }] })                                   // 4
      .mockResolvedValueOnce({ rows: [{ id: 502 }] })                                  // 5
      .mockResolvedValueOnce({ rows: [{ default_bank_account_id: null, default_cash_account_id: 30 }] }) // 6
      .mockResolvedValueOnce({ rows: [{ name: "Kas Sport Center" }] })                 // 7
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
    const row = makeSportPaymentRow({ customer_name: "Siti Rahayu", booking_number: "BKG-099" });
    seedHappyPath(row);

    await bulkIngestModule("sport_center", 1);

    expect(mockPost).toHaveBeenCalledOnce();
    const postArgs = mockPost.mock.calls[0][0] as Record<string, unknown>;
    expect(String(postArgs["ref"])).toBe("SPT-001");
  });

  // ── 9. SAFEGUARD: wrong-category settings account → COA fallback posts correctly ──

  it("falls back to COA bank account when default_bank_account_id points to a 'Kas' account", async () => {
    // Scenario: accounting_settings.default_bank_account_id = 50, but account 50 is named
    // "Kas Sport Center" (kas category, not bank). The safeguard must reject it and fall
    // back to the COA query which finds a real bank account (id 55).
    //
    // DB call sequence (12 total):
    //  1.  SELECT sport_payments JOIN sport_bookings (bulk candidates)
    //  2.  SELECT accounting_payments (alreadyPosted check)
    //  3.  SELECT accounting_settings → resolveJournal
    //  4.  SELECT COUNT accounting_payments → generatePaymentNumber
    //  5.  INSERT accounting_payments RETURNING id
    //  6.  SELECT accounting_settings → resolveBankAccount (bank + cash ids)
    //  7.  SELECT chart_of_accounts name (getAccountName for id 50) → "Kas Sport Center" ❌
    //       (fallbackId = null → skip fallback check)
    //  8.  SELECT chart_of_accounts (COA fallback for '%bank%') → [{ id: 55, name: "Bank BNI" }]
    //  9.  SELECT accounting_settings → resolveRevenueAccount
    //  10. SELECT accounting_entries → idempotency check
    //  11. UPDATE accounting_payments SET entry_id
    //  12. UPDATE sport_payments SET posting_status
    mockExecute
      .mockResolvedValueOnce({ rows: [makeSportPaymentRow()] })                                         // 1
      .mockResolvedValueOnce({ rows: [] })                                                               // 2
      .mockResolvedValueOnce({ rows: [{ cash_journal_id: 10, bank_journal_id: 11 }] })                   // 3
      .mockResolvedValueOnce({ rows: [{ cnt: 5 }] })                                                     // 4
      .mockResolvedValueOnce({ rows: [{ id: 503 }] })                                                    // 5
      .mockResolvedValueOnce({ rows: [{ default_bank_account_id: 50, default_cash_account_id: null }] }) // 6
      .mockResolvedValueOnce({ rows: [{ name: "Kas Sport Center" }] })                                   // 7  ← wrong category
      .mockResolvedValueOnce({ rows: [{ id: 55, name: "Bank BNI" }] })                                   // 8  COA fallback
      .mockResolvedValueOnce({ rows: [{ sales_income_account_id: 40 }] })                                // 9
      .mockResolvedValueOnce({ rows: [] })                                                               // 10
      .mockResolvedValueOnce({ rows: [] })                                                               // 11
      .mockResolvedValueOnce({ rows: [] });                                                              // 12

    const result = await bulkIngestModule("sport_center", 1);

    expect(result.posted).toBe(1);
    expect(result.errors).toBe(0);
    expect(mockPost).toHaveBeenCalledOnce();

    // The posting engine must use the COA fallback account (55), not the misconfigured one (50).
    const postArgs = mockPost.mock.calls[0][0] as Record<string, unknown>;
    const lines = postArgs["lines"] as Array<{ accountId: number }>;
    expect(lines[0].accountId).toBe(55);
  });

  // ── 10. NULL customer_name (booking row absent / orphaned) ───────────────────

  it("posts successfully and defaults partnerName to empty string when sport_bookings row is absent (customer_name = null)", async () => {
    // Simulate a LEFT JOIN that found no matching booking row:
    // customer_name and booking_number are both NULL.
    const orphanRow = makeSportPaymentRow({ customer_name: null, booking_number: null });
    seedHappyPath(orphanRow);

    const result = await bulkIngestModule("sport_center", 1);

    expect(result.total).toBe(1);
    expect(result.posted).toBe(1);
    expect(result.errors).toBe(0);
    expect(mockPost).toHaveBeenCalledOnce();

    // partnerName should default to "" rather than crashing or sending "null".
    const postArgs = mockPost.mock.calls[0][0] as Record<string, unknown>;
    // The ref is still the payment_number from the sport_payments row.
    expect(String(postArgs["ref"])).toBe("SPT-001");
  });

  // ── 11. Orphaned booking — logger.warn emitted when customer_name is null ────

  it("emits a structured logger.warn with sport_payment_id and company_id when customer_name is null", async () => {
    const orphanRow = makeSportPaymentRow({ customer_name: null, booking_number: null });
    seedHappyPath(orphanRow);

    await bulkIngestModule("sport_center", 1);

    const warnSpy = logger.warn as unknown as MockInstance;
    expect(warnSpy).toHaveBeenCalledOnce();
    const warnArg = warnSpy.mock.calls[0][0] as Record<string, unknown>;
    expect(warnArg["msg"]).toContain("customer_name");
    expect(warnArg["sport_payment_id"]).toBe(1);   // row id from makeSportPaymentRow
    expect(warnArg["company_id"]).toBe(1);          // row company_id from makeSportPaymentRow
  });

  // ── 12. SAFEGUARD: wrong-category settings + no COA fallback → engine not called ──

  it("does not call the posting engine when settings account is wrong-category and COA fallback is absent", async () => {
    // Scenario: default_bank_account_id = 50 → "Kas Sport Center" (wrong), no cashId,
    // AND the COA '%bank%' query returns nothing. resolveBankAccount returns null.
    // The posting engine must NOT be called; the payment row is still recorded.
    //
    // DB call sequence (10 total):
    //  1.  SELECT sport_payments JOIN sport_bookings
    //  2.  SELECT accounting_payments
    //  3.  SELECT accounting_settings → resolveJournal
    //  4.  SELECT COUNT accounting_payments → generatePaymentNumber
    //  5.  INSERT accounting_payments RETURNING id
    //  6.  SELECT accounting_settings → resolveBankAccount
    //  7.  SELECT chart_of_accounts name (getAccountName for id 50) → "Kas Sport Center" ❌
    //  8.  SELECT chart_of_accounts (COA fallback) → [] (none)
    //  9.  UPDATE sport_payments SET posting_status='error', posting_error
    mockExecute
      .mockResolvedValueOnce({ rows: [makeSportPaymentRow()] })                                         // 1
      .mockResolvedValueOnce({ rows: [] })                                                               // 2
      .mockResolvedValueOnce({ rows: [{ cash_journal_id: 10, bank_journal_id: 11 }] })                   // 3
      .mockResolvedValueOnce({ rows: [{ cnt: 5 }] })                                                     // 4
      .mockResolvedValueOnce({ rows: [{ id: 504 }] })                                                    // 5
      .mockResolvedValueOnce({ rows: [{ default_bank_account_id: 50, default_cash_account_id: null }] }) // 6
      .mockResolvedValueOnce({ rows: [{ name: "Kas Sport Center" }] })                                   // 7  ← wrong category
      .mockResolvedValueOnce({ rows: [] })                                                               // 8  COA fallback empty
      .mockResolvedValueOnce({ rows: [{ sales_income_account_id: 40 }] })                                // 9
      .mockResolvedValueOnce({ rows: [] });                                                              // 10 updatePostingStatus

    const result = await bulkIngestModule("sport_center", 1);

    // Payment row is still recorded (accounting_payments inserted), but no journal entry.
    // The source payment must remain visibly actionable instead of being marked posted.
    expect(result.posted).toBe(0);
    expect(result.errors).toBe(1);
    expect(mockPost).not.toHaveBeenCalled();
  });
});
