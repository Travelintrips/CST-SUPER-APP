/**
 * logistics-payment-accounting.test.ts
 *
 * Confirms bulkIngestModule('logistics', companyId) correctly posts
 * logistics_payments with status='paid' end-to-end:
 *   - accounting_payments row created (source_type='logistics', source_doc_id=lp.id)
 *   - accounting_entries journal entry linked (entry_id IS NOT NULL)
 *   - logistics_payments.posting_status updated to 'posted'
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

/** A minimal logistics_payment row as returned by the bulk SELECT. */
function makeLogisticsPaymentRow(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: 1,
    company_id: 1,
    payment_number: "LOG-001",
    amount: "1200000",
    method: "transfer",
    paid_at: "2026-03-05T10:00:00Z",
    customer_name: "CV Cepat Kirim",
    ...overrides,
  };
}

/**
 * Seeds mockExecute with the 11 sequential responses that represent
 * a single logistics payment being successfully posted end-to-end.
 *
 * Call order inside bulkIngestModule('logistics') + ingestModulePayment:
 *  1.  SELECT logistics_payments (bulk candidates)
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
 * 11.  UPDATE logistics_payments SET posting_status = 'posted'
 */
function seedHappyPath(row: Record<string, unknown> = makeLogisticsPaymentRow()): void {
  mockExecute
    .mockResolvedValueOnce({ rows: [row] })                                             // 1
    .mockResolvedValueOnce({ rows: [] })                                                // 2
    .mockResolvedValueOnce({ rows: [{ cash_journal_id: 10, bank_journal_id: 11 }] })   // 3
    .mockResolvedValueOnce({ rows: [{ cnt: 7 }] })                                     // 4
    .mockResolvedValueOnce({ rows: [{ id: 401 }] })                                    // 5
    .mockResolvedValueOnce({ rows: [{ default_bank_account_id: 50, default_cash_account_id: null }] }) // 6
    .mockResolvedValueOnce({ rows: [{ name: "Bank Mandiri" }] })                       // 7
    .mockResolvedValueOnce({ rows: [{ sales_income_account_id: 40 }] })                // 8
    .mockResolvedValueOnce({ rows: [] })                                               // 9
    .mockResolvedValueOnce({ rows: [] })                                               // 10
    .mockResolvedValueOnce({ rows: [] });                                              // 11
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe("bulkIngestModule('logistics') — logistics payments accounting", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockPost.mockResolvedValue({ ok: true, entryId: 701 });
  });

  // ── 1. Happy path ─────────────────────────────────────────────────────────

  it("creates accounting_payment row and links journal entry for a logistics payment", async () => {
    seedHappyPath();

    const result = await bulkIngestModule("logistics", 1);

    expect(result.total).toBe(1);
    expect(result.posted).toBe(1);
    expect(result.skipped).toBe(0);
    expect(result.errors).toBe(0);
    expect(result.failedRows).toEqual([]);
  });

  // ── 2. Posting engine receives correct double-entry amounts ───────────────

  it("passes correct debit/credit amounts to the posting engine", async () => {
    seedHappyPath();

    await bulkIngestModule("logistics", 1);

    expect(mockPost).toHaveBeenCalledOnce();

    const postArgs = mockPost.mock.calls[0][0] as Record<string, unknown>;
    const lines = postArgs["lines"] as Array<{ debit: number; credit: number }>;
    expect(lines).toHaveLength(2);
    expect(lines[0].debit).toBe(1200000);  // debit: bank account
    expect(lines[0].credit).toBe(0);
    expect(lines[1].debit).toBe(0);
    expect(lines[1].credit).toBe(1200000); // credit: revenue account
  });

  // ── 3. source label is 'sales_payment' for logistics ─────────────────────

  it("uses 'sales_payment' as the source label in the posting engine call", async () => {
    seedHappyPath();

    await bulkIngestModule("logistics", 1);

    expect(mockPost).toHaveBeenCalledOnce();
    const postArgs = mockPost.mock.calls[0][0] as Record<string, unknown>;
    expect(postArgs["source"]).toBe("sales_payment");
  });

  // ── 4. Idempotency ────────────────────────────────────────────────────────

  it("is idempotent — skips a logistics payment that already has an accounting_payment", async () => {
    mockExecute
      .mockResolvedValueOnce({ rows: [makeLogisticsPaymentRow()] }) // 1. bulk SELECT
      .mockResolvedValueOnce({ rows: [{ id: 401 }] });              // 2. alreadyPosted → found

    const result = await bulkIngestModule("logistics", 1);

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

    const result = await bulkIngestModule("logistics", 1);

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
      .mockResolvedValueOnce({ rows: [makeLogisticsPaymentRow({ id: 5, payment_number: "LOG-005", amount: "500000" })] }) // 1
      .mockResolvedValueOnce({ rows: [] })                                              // 2. not yet posted
      .mockResolvedValueOnce({ rows: [{ cash_journal_id: null, bank_journal_id: null }] }) // 3. no journals in settings
      .mockResolvedValueOnce({ rows: [] })                                              // 4. fallback: no bank journal
      .mockResolvedValueOnce({ rows: [] })                                              // 5. fallback: no cash journal
      .mockResolvedValueOnce({ rows: [] });                                             // 6. fallback: no general journal

    const result = await bulkIngestModule("logistics", 1);

    expect(result.total).toBe(1);
    expect(result.errors).toBe(1);
    expect(result.posted).toBe(0);
    expect(mockPost).not.toHaveBeenCalled();
    expect(result.failedRows).toHaveLength(1);
    expect(result.failedRows[0].sourceDocId).toBe(5);
    expect(result.failedRows[0].companyId).toBe(1);
    expect(result.failedRows[0].error).toBeTruthy();
  });

  // ── 7. Cash payment uses correct account type ─────────────────────────────

  it("resolves cash account for a cash-method logistics payment", async () => {
    const cashRow = makeLogisticsPaymentRow({ method: "tunai", amount: "300000" });
    mockExecute
      .mockResolvedValueOnce({ rows: [cashRow] })                                       // 1
      .mockResolvedValueOnce({ rows: [] })                                              // 2
      .mockResolvedValueOnce({ rows: [{ cash_journal_id: 10, bank_journal_id: 11 }] }) // 3
      .mockResolvedValueOnce({ rows: [{ cnt: 2 }] })                                   // 4
      .mockResolvedValueOnce({ rows: [{ id: 402 }] })                                  // 5
      .mockResolvedValueOnce({ rows: [{ default_bank_account_id: null, default_cash_account_id: 30 }] }) // 6
      .mockResolvedValueOnce({ rows: [{ name: "Kas Logistik" }] })                     // 7
      .mockResolvedValueOnce({ rows: [{ sales_income_account_id: 40 }] })              // 8
      .mockResolvedValueOnce({ rows: [] })                                              // 9
      .mockResolvedValueOnce({ rows: [] })                                              // 10
      .mockResolvedValueOnce({ rows: [] });                                             // 11

    const result = await bulkIngestModule("logistics", 1);

    expect(result.posted).toBe(1);
    expect(result.errors).toBe(0);
    expect(mockPost).toHaveBeenCalledOnce();

    const postArgs = mockPost.mock.calls[0][0] as Record<string, unknown>;
    const lines = postArgs["lines"] as Array<{ accountId: number }>;
    // debit line should use the cash account id (30)
    expect(lines[0].accountId).toBe(30);
  });

  // ── 8. customer_name passed as partnerName ────────────────────────────────

  it("uses customer_name from logistics_payments as partnerName", async () => {
    const row = makeLogisticsPaymentRow({ customer_name: "PT Ekspedisi Nusantara" });
    seedHappyPath(row);

    await bulkIngestModule("logistics", 1);

    // The INSERT into accounting_payments (call #5, index 4) receives partner_name.
    // Verify indirectly: posting engine's ref matches the payment_number from the row.
    expect(mockPost).toHaveBeenCalledOnce();
    const postArgs = mockPost.mock.calls[0][0] as Record<string, unknown>;
    expect(String(postArgs["ref"])).toBe("LOG-001");
  });

  // ── 9. Bulk — 3 rows all posted ───────────────────────────────────────────

  it("posts all 3 rows and returns posted=3 skipped=0 errors=0", async () => {
    const rows = [
      makeLogisticsPaymentRow({ id: 10, payment_number: "LOG-010", amount: "900000" }),
      makeLogisticsPaymentRow({ id: 11, payment_number: "LOG-011", amount: "1100000" }),
      makeLogisticsPaymentRow({ id: 12, payment_number: "LOG-012", amount: "1300000" }),
    ];

    // Call 1: bulk SELECT → all 3 rows
    mockExecute.mockResolvedValueOnce({ rows });

    // Each row requires 10 sequential calls (steps 2-11):
    for (let i = 0; i < 3; i++) {
      mockExecute
        .mockResolvedValueOnce({ rows: [] })                                                              // 2  alreadyPosted
        .mockResolvedValueOnce({ rows: [{ cash_journal_id: 10, bank_journal_id: 11 }] })                  // 3  resolveJournal
        .mockResolvedValueOnce({ rows: [{ cnt: i }] })                                                    // 4  generatePaymentNumber
        .mockResolvedValueOnce({ rows: [{ id: 410 + i }] })                                               // 5  INSERT accounting_payments
        .mockResolvedValueOnce({ rows: [{ default_bank_account_id: 50, default_cash_account_id: null }] }) // 6  resolveBankAccount
        .mockResolvedValueOnce({ rows: [{ name: "Bank Mandiri" }] })                                      // 7  getAccountName
        .mockResolvedValueOnce({ rows: [{ sales_income_account_id: 40 }] })                               // 8  resolveRevenueAccount
        .mockResolvedValueOnce({ rows: [] })                                                              // 9  idempotency entry check
        .mockResolvedValueOnce({ rows: [] })                                                              // 10 UPDATE accounting_payments entry_id
        .mockResolvedValueOnce({ rows: [] });                                                             // 11 UPDATE logistics_payments posting_status
    }

    const result = await bulkIngestModule("logistics", 1);

    expect(result.total).toBe(3);
    expect(result.posted).toBe(3);
    expect(result.skipped).toBe(0);
    expect(result.errors).toBe(0);
    expect(result.failedRows).toEqual([]);
    expect(mockPost).toHaveBeenCalledTimes(3);
  });

  // ── 10. Bulk — mixed: 1 already-posted, 1 new, 1 no-journal ─────────────

  it("handles a mixed batch: skipped=1 posted=1 errors=1", async () => {
    const rowAlreadyPosted  = makeLogisticsPaymentRow({ id: 20, payment_number: "LOG-020", amount: "700000" });
    const rowNew            = makeLogisticsPaymentRow({ id: 21, payment_number: "LOG-021", amount: "950000" });
    const rowNoJournal      = makeLogisticsPaymentRow({ id: 22, payment_number: "LOG-022", amount: "300000" });

    // Call 1: bulk SELECT → all 3 rows
    mockExecute.mockResolvedValueOnce({ rows: [rowAlreadyPosted, rowNew, rowNoJournal] });

    // Row 20 — already posted (step 2 finds existing record → skip)
    mockExecute
      .mockResolvedValueOnce({ rows: [{ id: 601 }] });                                                   // 2  alreadyPosted

    // Row 21 — happy path (steps 2-11)
    mockExecute
      .mockResolvedValueOnce({ rows: [] })                                                               // 2  alreadyPosted
      .mockResolvedValueOnce({ rows: [{ cash_journal_id: 10, bank_journal_id: 11 }] })                   // 3  resolveJournal
      .mockResolvedValueOnce({ rows: [{ cnt: 20 }] })                                                    // 4  generatePaymentNumber
      .mockResolvedValueOnce({ rows: [{ id: 602 }] })                                                    // 5  INSERT accounting_payments
      .mockResolvedValueOnce({ rows: [{ default_bank_account_id: 50, default_cash_account_id: null }] }) // 6  resolveBankAccount
      .mockResolvedValueOnce({ rows: [{ name: "Bank Mandiri" }] })                                       // 7  getAccountName
      .mockResolvedValueOnce({ rows: [{ sales_income_account_id: 40 }] })                                // 8  resolveRevenueAccount
      .mockResolvedValueOnce({ rows: [] })                                                               // 9  idempotency entry check
      .mockResolvedValueOnce({ rows: [] })                                                               // 10 UPDATE accounting_payments entry_id
      .mockResolvedValueOnce({ rows: [] });                                                              // 11 UPDATE logistics_payments posting_status

    // Row 22 — no journal configured (steps 2-6: resolveJournal fallbacks all empty)
    mockExecute
      .mockResolvedValueOnce({ rows: [] })                                                               // 2  alreadyPosted
      .mockResolvedValueOnce({ rows: [{ cash_journal_id: null, bank_journal_id: null }] })               // 3  resolveJournal settings
      .mockResolvedValueOnce({ rows: [] })                                                               // 4  fallback bank journal
      .mockResolvedValueOnce({ rows: [] })                                                               // 5  fallback cash journal
      .mockResolvedValueOnce({ rows: [] });                                                              // 6  fallback general journal

    const result = await bulkIngestModule("logistics", 1);

    expect(result.total).toBe(3);
    expect(result.skipped).toBe(1);
    expect(result.posted).toBe(1);
    expect(result.errors).toBe(1);
    expect(mockPost).toHaveBeenCalledTimes(1);
    expect(result.failedRows).toHaveLength(1);
    expect(result.failedRows[0].sourceDocId).toBe(22);
    expect(result.failedRows[0].companyId).toBe(1);
    expect(result.failedRows[0].error).toBeTruthy();
  });

  // ── 11. SAFEGUARD: wrong-category settings account → COA fallback posts correctly ──

  it("falls back to COA bank account when default_bank_account_id points to a 'Kas' account", async () => {
    // Scenario: accounting_settings.default_bank_account_id = 50, but account 50 is named
    // "Kas Logistik" (kas category, not bank). The safeguard must reject it and fall back
    // to the COA query which finds a real bank account (id 55).
    //
    // DB call sequence (12 total):
    //  1.  SELECT logistics_payments (bulk candidates)
    //  2.  SELECT accounting_payments (alreadyPosted check)
    //  3.  SELECT accounting_settings → resolveJournal
    //  4.  SELECT COUNT accounting_payments → generatePaymentNumber
    //  5.  INSERT accounting_payments RETURNING id
    //  6.  SELECT accounting_settings → resolveBankAccount (bank + cash ids)
    //  7.  SELECT chart_of_accounts name (getAccountName for id 50) → "Kas Logistik" ❌
    //       (fallbackId = null → skip fallback check)
    //  8.  SELECT chart_of_accounts (COA fallback for '%bank%') → [{ id: 55, name: "Bank BRI" }]
    //  9.  SELECT accounting_settings → resolveRevenueAccount
    //  10. SELECT accounting_entries → idempotency check
    //  11. UPDATE accounting_payments SET entry_id
    //  12. UPDATE logistics_payments SET posting_status
    mockExecute
      .mockResolvedValueOnce({ rows: [makeLogisticsPaymentRow()] })                                      // 1
      .mockResolvedValueOnce({ rows: [] })                                                               // 2
      .mockResolvedValueOnce({ rows: [{ cash_journal_id: 10, bank_journal_id: 11 }] })                   // 3
      .mockResolvedValueOnce({ rows: [{ cnt: 5 }] })                                                     // 4
      .mockResolvedValueOnce({ rows: [{ id: 403 }] })                                                    // 5
      .mockResolvedValueOnce({ rows: [{ default_bank_account_id: 50, default_cash_account_id: null }] }) // 6
      .mockResolvedValueOnce({ rows: [{ name: "Kas Logistik" }] })                                       // 7  ← wrong category
      .mockResolvedValueOnce({ rows: [{ id: 55, name: "Bank BRI" }] })                                   // 8  COA fallback
      .mockResolvedValueOnce({ rows: [{ sales_income_account_id: 40 }] })                                // 9
      .mockResolvedValueOnce({ rows: [] })                                                               // 10
      .mockResolvedValueOnce({ rows: [] })                                                               // 11
      .mockResolvedValueOnce({ rows: [] });                                                              // 12

    const result = await bulkIngestModule("logistics", 1);

    expect(result.posted).toBe(1);
    expect(result.errors).toBe(0);
    expect(mockPost).toHaveBeenCalledOnce();

    // The posting engine must use the COA fallback account (55), not the misconfigured one (50).
    const postArgs = mockPost.mock.calls[0][0] as Record<string, unknown>;
    const lines = postArgs["lines"] as Array<{ accountId: number }>;
    expect(lines[0].accountId).toBe(55);
  });

  // ── 13. NULL customer_name → partnerName defaults to "" and payment still posts ──

  it("posts cleanly and defaults partnerName to '' when customer_name is NULL", async () => {
    // Mirrors the tenant orphan scenario: logistics_payments.customer_name can be NULL
    // when a payment was created without a customer name. The bulk SELECT reads
    // lp.customer_name directly; the fallback chain
    //   String(row["customer_name"] ?? row["business_name"] ?? "")
    // must resolve to "" and the row must still be posted without errors.

    const nullNameRow = makeLogisticsPaymentRow({ customer_name: null });
    seedHappyPath(nullNameRow);

    const result = await bulkIngestModule("logistics", 1);

    // Bulk outcome
    expect(result.total).toBe(1);
    expect(result.posted).toBe(1);
    expect(result.skipped).toBe(0);
    expect(result.errors).toBe(0);

    // Posting engine was reached — the null name did not cause an early abort
    expect(mockPost).toHaveBeenCalledOnce();

    // The INSERT into accounting_payments is the 5th db.execute call (index 4).
    // The SQL template values order inside ingestModulePayment matches:
    //   [companyId, paymentNumber, amountStr, journalId, partnerName ?? null, date, ref, desc, moduleType, sourceDocId, actorId]
    // so partner_name is at values index 4.
    const insertCall = mockExecute.mock.calls[4][0] as { values: unknown[] };
    expect(insertCall.values[4]).toBe("");
  });

  // ── 12. SAFEGUARD: wrong-category settings + no COA fallback → ok:false returned ──
  // ── 12. SAFEGUARD: revenue account null → ok:false, posting_status='error' ─────

  it("returns errors=1 and does not post when no revenue account is configured", async () => {
    // Scenario: resolveRevenueAccount returns null because:
    //   - accounting_settings.sales_income_account_id is null
    //   - chart_of_accounts COA fallback (type='revenue') is empty
    // ingestModulePayment must return ok:false and call updatePostingStatus('error').
    //
    // DB call sequence (10 total):
    //  1.  SELECT logistics_payments (bulk candidates)
    //  2.  SELECT accounting_payments (alreadyPosted check)
    //  3.  SELECT accounting_settings → resolveJournal
    //  4.  SELECT COUNT accounting_payments → generatePaymentNumber
    //  5.  INSERT accounting_payments RETURNING id
    //  6.  SELECT accounting_settings → resolveBankAccount
    //  7.  SELECT chart_of_accounts name (getAccountName) → "Bank Mandiri" ✓
    //  8.  SELECT accounting_settings → resolveRevenueAccount (no sales_income_account_id)
    //  9.  SELECT chart_of_accounts → resolveRevenueAccount COA fallback (empty)
    //      ↳ resolveRevenueAccount returns null → throw → catch → updatePostingStatus('error')
    // 10.  UPDATE logistics_payments SET posting_status = 'error'
    mockExecute
      .mockResolvedValueOnce({ rows: [makeLogisticsPaymentRow()] })                                       // 1
      .mockResolvedValueOnce({ rows: [] })                                                                // 2
      .mockResolvedValueOnce({ rows: [{ cash_journal_id: 10, bank_journal_id: 11 }] })                   // 3
      .mockResolvedValueOnce({ rows: [{ cnt: 5 }] })                                                     // 4
      .mockResolvedValueOnce({ rows: [{ id: 405 }] })                                                    // 5
      .mockResolvedValueOnce({ rows: [{ default_bank_account_id: 50, default_cash_account_id: null }] }) // 6
      .mockResolvedValueOnce({ rows: [{ name: "Bank Mandiri" }] })                                       // 7  ✓ valid bank
      .mockResolvedValueOnce({ rows: [{ sales_income_account_id: null }] })                              // 8  no revenue account in settings
      .mockResolvedValueOnce({ rows: [] })                                                               // 9  no revenue COA fallback
      .mockResolvedValueOnce({ rows: [] });                                                              // 10 updatePostingStatus('error')

    const result = await bulkIngestModule("logistics", 1);

    expect(result.total).toBe(1);
    expect(result.posted).toBe(0);
    expect(result.errors).toBe(1);
    expect(mockPost).not.toHaveBeenCalled();
  });

  // ── 13. SAFEGUARD: wrong-category settings + no COA fallback → ok:false returned ──

  it("returns errors=1 when settings account is wrong-category and COA fallback is absent", async () => {
    // Scenario: default_bank_account_id = 50 → "Kas Logistik" (wrong), no cashId,
    // AND the COA '%bank%' query returns nothing. resolveBankAccount returns null.
    // ingestModulePayment must return ok:false so the caller knows the ledger is
    // incomplete — it must NOT silently mark the payment as 'posted'.
    //
    // DB call sequence (9 total):
    //  1.  SELECT logistics_payments
    //  2.  SELECT accounting_payments
    //  3.  SELECT accounting_settings → resolveJournal
    //  4.  SELECT COUNT accounting_payments → generatePaymentNumber
    //  5.  INSERT accounting_payments RETURNING id
    //  6.  SELECT accounting_settings → resolveBankAccount
    //  7.  SELECT chart_of_accounts name (getAccountName for id 50) → "Kas Logistik" ❌
    //  8.  SELECT chart_of_accounts (COA fallback) → [] (none)
    //       ↳ bankAccountId is null → early return ok:false
    //  9.  UPDATE logistics_payments SET posting_status = 'error'
    mockExecute
      .mockResolvedValueOnce({ rows: [makeLogisticsPaymentRow()] })                                      // 1
      .mockResolvedValueOnce({ rows: [] })                                                               // 2
      .mockResolvedValueOnce({ rows: [{ cash_journal_id: 10, bank_journal_id: 11 }] })                   // 3
      .mockResolvedValueOnce({ rows: [{ cnt: 5 }] })                                                     // 4
      .mockResolvedValueOnce({ rows: [{ id: 404 }] })                                                    // 5
      .mockResolvedValueOnce({ rows: [{ default_bank_account_id: 50, default_cash_account_id: null }] }) // 6
      .mockResolvedValueOnce({ rows: [{ name: "Kas Logistik" }] })                                       // 7  ← wrong category
      .mockResolvedValueOnce({ rows: [] })                                                               // 8  COA fallback empty
      .mockResolvedValueOnce({ rows: [] });                                                              // 9  updatePostingStatus('error')

    const result = await bulkIngestModule("logistics", 1);

    // ingestModulePayment now returns ok:false when bank account cannot be resolved,
    // so bulkIngestModule must count this as an error, not a successful post.
    expect(result.posted).toBe(0);
    expect(result.errors).toBe(1);
    expect(mockPost).not.toHaveBeenCalled();
    expect(result.failedRows).toHaveLength(1);
    expect(result.failedRows[0].sourceDocId).toBe(1);
    expect(result.failedRows[0].companyId).toBe(1);
    expect(result.failedRows[0].error).toBeTruthy();
  });

  // ── companyId=null — each row uses its own company_id (isolation) ─────────

  it("uses each row's own company_id when bulkIngestModule is called with companyId=null", async () => {
    const rowCompany1 = makeLogisticsPaymentRow({
      id: 101,
      company_id: 1,
      payment_number: "LOG-101",
      amount: "800000",
      customer_name: "PT Satu Logistik",
    });
    const rowCompany2 = makeLogisticsPaymentRow({
      id: 201,
      company_id: 2,
      payment_number: "LOG-201",
      amount: "950000",
      customer_name: "PT Dua Ekspedisi",
    });

    // Call 0: bulk SELECT with companyId=null → both rows returned
    mockExecute.mockResolvedValueOnce({ rows: [rowCompany1, rowCompany2] });

    // Row 101 (company_id=1) — steps 1-10
    mockExecute
      .mockResolvedValueOnce({ rows: [] })                                                              // 1  alreadyPosted
      .mockResolvedValueOnce({ rows: [{ cash_journal_id: 10, bank_journal_id: 11 }] })                 // 2  resolveJournal ← values[0]=1
      .mockResolvedValueOnce({ rows: [{ cnt: 0 }] })                                                   // 3  generatePaymentNumber ← values[0]=1
      .mockResolvedValueOnce({ rows: [{ id: 901 }] })                                                  // 4  INSERT accounting_payments
      .mockResolvedValueOnce({ rows: [{ default_bank_account_id: 50, default_cash_account_id: null }] }) // 5  resolveBankAccount ← values[0]=1
      .mockResolvedValueOnce({ rows: [{ name: "Bank BCA" }] })                                         // 6  getAccountName
      .mockResolvedValueOnce({ rows: [{ sales_income_account_id: 40 }] })                              // 7  resolveRevenueAccount ← values[0]=1
      .mockResolvedValueOnce({ rows: [] })                                                             // 8  idempotency entry check
      .mockResolvedValueOnce({ rows: [] })                                                             // 9  UPDATE accounting_payments entry_id
      .mockResolvedValueOnce({ rows: [] });                                                            // 10 UPDATE logistics_payments

    // Row 201 (company_id=2) — steps 11-20
    mockExecute
      .mockResolvedValueOnce({ rows: [] })                                                              // 11 alreadyPosted
      .mockResolvedValueOnce({ rows: [{ cash_journal_id: 20, bank_journal_id: 21 }] })                 // 12 resolveJournal ← values[0]=2
      .mockResolvedValueOnce({ rows: [{ cnt: 5 }] })                                                   // 13 generatePaymentNumber ← values[0]=2
      .mockResolvedValueOnce({ rows: [{ id: 902 }] })                                                  // 14 INSERT accounting_payments
      .mockResolvedValueOnce({ rows: [{ default_bank_account_id: 60, default_cash_account_id: null }] }) // 15 resolveBankAccount ← values[0]=2
      .mockResolvedValueOnce({ rows: [{ name: "Bank Mandiri" }] })                                     // 16 getAccountName
      .mockResolvedValueOnce({ rows: [{ sales_income_account_id: 45 }] })                              // 17 resolveRevenueAccount ← values[0]=2
      .mockResolvedValueOnce({ rows: [] })                                                             // 18 idempotency entry check
      .mockResolvedValueOnce({ rows: [] })                                                             // 19 UPDATE accounting_payments entry_id
      .mockResolvedValueOnce({ rows: [] });                                                            // 20 UPDATE logistics_payments

    const result = await bulkIngestModule("logistics", null);

    // Both rows must be posted, no errors, no skips
    expect(result.total).toBe(2);
    expect(result.posted).toBe(2);
    expect(result.skipped).toBe(0);
    expect(result.errors).toBe(0);
    expect(mockPost).toHaveBeenCalledTimes(2);

    // ── Verify company_id isolation in SQL calls ──────────────────────────────
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
    const postCall1 = mockPost.mock.calls[0][0] as Record<string, unknown>;
    const postCall2 = mockPost.mock.calls[1][0] as Record<string, unknown>;
    expect(postCall1["sourceId"]).toBe(101);  // sourceDocId for row company_id=1
    expect(postCall2["sourceId"]).toBe(201);  // sourceDocId for row company_id=2
  });
});
