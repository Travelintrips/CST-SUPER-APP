/**
 * tenant-payment-accounting.test.ts
 *
 * Confirms bulkIngestModule('tenant', companyId) correctly posts
 * tenant_payments with status='paid' end-to-end:
 *   - accounting_payments row created (source_type='tenant', source_doc_id=tp.id)
 *   - accounting_entries journal entry linked (entry_id IS NOT NULL)
 *   - tenant_payments.posting_status updated to 'posted'
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

/** A minimal tenant_payment row as returned by the bulk SELECT. */
function makeTenantPaymentRow(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: 1,
    company_id: 1,
    payment_number: "TNT-001",
    amount: "750000",
    method: "transfer",
    paid_at: "2026-02-10T09:00:00Z",
    customer_name: "PT Maju Mundur",
    ...overrides,
  };
}

/**
 * Seeds mockExecute with the 11 sequential responses that represent
 * a single tenant payment being successfully posted end-to-end.
 *
 * Call order inside bulkIngestModule('tenant') + ingestModulePayment:
 *  1.  SELECT tenant_payments (bulk candidates)
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
 * 11.  UPDATE tenant_payments SET posting_status = 'posted'
 */
function seedHappyPath(row: Record<string, unknown> = makeTenantPaymentRow()): void {
  mockExecute
    .mockResolvedValueOnce({ rows: [row] })                                             // 1
    .mockResolvedValueOnce({ rows: [] })                                                // 2
    .mockResolvedValueOnce({ rows: [{ cash_journal_id: 10, bank_journal_id: 11 }] })   // 3
    .mockResolvedValueOnce({ rows: [{ cnt: 3 }] })                                     // 4
    .mockResolvedValueOnce({ rows: [{ id: 301 }] })                                    // 5
    .mockResolvedValueOnce({ rows: [{ default_bank_account_id: 50, default_cash_account_id: null }] }) // 6
    .mockResolvedValueOnce({ rows: [{ name: "Bank BCA" }] })                           // 7
    .mockResolvedValueOnce({ rows: [{ sales_income_account_id: 40 }] })                // 8
    .mockResolvedValueOnce({ rows: [] })                                               // 9
    .mockResolvedValueOnce({ rows: [] })                                               // 10
    .mockResolvedValueOnce({ rows: [] });                                              // 11
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe("bulkIngestModule('tenant') — tenant payments accounting", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockPost.mockResolvedValue({ ok: true, entryId: 601 });
  });

  // ── 1. Happy path ─────────────────────────────────────────────────────────

  it("creates accounting_payment row and links journal entry for a tenant payment", async () => {
    seedHappyPath();

    const result = await bulkIngestModule("tenant", 1);

    expect(result.total).toBe(1);
    expect(result.posted).toBe(1);
    expect(result.skipped).toBe(0);
    expect(result.errors).toBe(0);
    expect(result.failedRows).toEqual([]);
  });

  // ── 2. Posting engine receives correct double-entry amounts ───────────────

  it("passes correct debit/credit amounts to the posting engine", async () => {
    seedHappyPath();

    await bulkIngestModule("tenant", 1);

    expect(mockPost).toHaveBeenCalledOnce();

    const postArgs = mockPost.mock.calls[0][0] as Record<string, unknown>;
    const lines = postArgs["lines"] as Array<{ debit: number; credit: number }>;
    expect(lines).toHaveLength(2);
    expect(lines[0].debit).toBe(750000);  // debit: bank account
    expect(lines[0].credit).toBe(0);
    expect(lines[1].debit).toBe(0);
    expect(lines[1].credit).toBe(750000); // credit: revenue account
  });

  // ── 3. source label is 'sales_payment' for tenant ────────────────────────

  it("uses 'sales_payment' as the source label in the posting engine call", async () => {
    seedHappyPath();

    await bulkIngestModule("tenant", 1);

    expect(mockPost).toHaveBeenCalledOnce();
    const postArgs = mockPost.mock.calls[0][0] as Record<string, unknown>;
    expect(postArgs["source"]).toBe("sales_payment");
  });

  // ── 4. Idempotency ────────────────────────────────────────────────────────

  it("is idempotent — skips a tenant payment that already has an accounting_payment", async () => {
    mockExecute
      .mockResolvedValueOnce({ rows: [makeTenantPaymentRow()] }) // 1. bulk SELECT
      .mockResolvedValueOnce({ rows: [{ id: 301 }] });           // 2. alreadyPosted → found

    const result = await bulkIngestModule("tenant", 1);

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

    const result = await bulkIngestModule("tenant", 1);

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
      .mockResolvedValueOnce({ rows: [makeTenantPaymentRow({ id: 9, payment_number: "TNT-009", amount: "200000" })] }) // 1
      .mockResolvedValueOnce({ rows: [] })                                              // 2. not yet posted
      .mockResolvedValueOnce({ rows: [{ cash_journal_id: null, bank_journal_id: null }] }) // 3. no journals in settings
      .mockResolvedValueOnce({ rows: [] })                                              // 4. fallback: no bank journal
      .mockResolvedValueOnce({ rows: [] })                                              // 5. fallback: no cash journal
      .mockResolvedValueOnce({ rows: [] });                                             // 6. fallback: no general journal

    const result = await bulkIngestModule("tenant", 1);

    expect(result.total).toBe(1);
    expect(result.errors).toBe(1);
    expect(result.posted).toBe(0);
    expect(mockPost).not.toHaveBeenCalled();
    expect(result.failedRows).toHaveLength(1);
    expect(result.failedRows[0].sourceDocId).toBe(9);
    expect(result.failedRows[0].companyId).toBe(1);
    expect(result.failedRows[0].error).toBeTruthy();
  });

  // ── 7. Cash payment uses correct account type ─────────────────────────────

  it("resolves cash account for a cash-method tenant payment", async () => {
    const cashRow = makeTenantPaymentRow({ method: "cash", amount: "100000" });
    mockExecute
      .mockResolvedValueOnce({ rows: [cashRow] })                                       // 1
      .mockResolvedValueOnce({ rows: [] })                                              // 2
      .mockResolvedValueOnce({ rows: [{ cash_journal_id: 10, bank_journal_id: 11 }] }) // 3
      .mockResolvedValueOnce({ rows: [{ cnt: 1 }] })                                   // 4
      .mockResolvedValueOnce({ rows: [{ id: 302 }] })                                  // 5
      .mockResolvedValueOnce({ rows: [{ default_bank_account_id: null, default_cash_account_id: 30 }] }) // 6
      .mockResolvedValueOnce({ rows: [{ name: "Kas Operasional" }] })                  // 7
      .mockResolvedValueOnce({ rows: [{ sales_income_account_id: 40 }] })              // 8
      .mockResolvedValueOnce({ rows: [] })                                              // 9
      .mockResolvedValueOnce({ rows: [] })                                              // 10
      .mockResolvedValueOnce({ rows: [] });                                             // 11

    const result = await bulkIngestModule("tenant", 1);

    expect(result.posted).toBe(1);
    expect(result.errors).toBe(0);
    expect(mockPost).toHaveBeenCalledOnce();

    const postArgs = mockPost.mock.calls[0][0] as Record<string, unknown>;
    const lines = postArgs["lines"] as Array<{ accountId: number }>;
    // debit line should use the cash account id (30)
    expect(lines[0].accountId).toBe(30);
  });

  // ── 8. Bulk — 3 rows all posted ───────────────────────────────────────────

  it("posts all 3 rows and returns posted=3 skipped=0 errors=0", async () => {
    const rows = [
      makeTenantPaymentRow({ id: 10, payment_number: "TNT-010", amount: "500000" }),
      makeTenantPaymentRow({ id: 11, payment_number: "TNT-011", amount: "600000" }),
      makeTenantPaymentRow({ id: 12, payment_number: "TNT-012", amount: "700000" }),
    ];

    // Call 1: bulk SELECT → all 3 rows
    mockExecute.mockResolvedValueOnce({ rows });

    // Each row requires 10 sequential calls (steps 2-11):
    for (let i = 0; i < 3; i++) {
      mockExecute
        .mockResolvedValueOnce({ rows: [] })                                                              // 2  alreadyPosted
        .mockResolvedValueOnce({ rows: [{ cash_journal_id: 10, bank_journal_id: 11 }] })                  // 3  resolveJournal
        .mockResolvedValueOnce({ rows: [{ cnt: i }] })                                                    // 4  generatePaymentNumber
        .mockResolvedValueOnce({ rows: [{ id: 310 + i }] })                                               // 5  INSERT accounting_payments
        .mockResolvedValueOnce({ rows: [{ default_bank_account_id: 50, default_cash_account_id: null }] }) // 6  resolveBankAccount
        .mockResolvedValueOnce({ rows: [{ name: "Bank BCA" }] })                                          // 7  getAccountName
        .mockResolvedValueOnce({ rows: [{ sales_income_account_id: 40 }] })                               // 8  resolveRevenueAccount
        .mockResolvedValueOnce({ rows: [] })                                                              // 9  idempotency entry check
        .mockResolvedValueOnce({ rows: [] })                                                              // 10 UPDATE accounting_payments entry_id
        .mockResolvedValueOnce({ rows: [] });                                                             // 11 UPDATE tenant_payments posting_status
    }

    const result = await bulkIngestModule("tenant", 1);

    expect(result.total).toBe(3);
    expect(result.posted).toBe(3);
    expect(result.skipped).toBe(0);
    expect(result.errors).toBe(0);
    expect(result.failedRows).toEqual([]);
    expect(mockPost).toHaveBeenCalledTimes(3);
  });

  // ── 9. Bulk — mixed: 1 already-posted, 1 new, 1 no-journal ──────────────

  it("handles a mixed batch: skipped=1 posted=1 errors=1", async () => {
    const rowAlreadyPosted  = makeTenantPaymentRow({ id: 20, payment_number: "TNT-020", amount: "400000" });
    const rowNew            = makeTenantPaymentRow({ id: 21, payment_number: "TNT-021", amount: "800000" });
    const rowNoJournal      = makeTenantPaymentRow({ id: 22, payment_number: "TNT-022", amount: "200000" });

    // Call 1: bulk SELECT → all 3 rows
    mockExecute.mockResolvedValueOnce({ rows: [rowAlreadyPosted, rowNew, rowNoJournal] });

    // Row 20 — already posted (step 2 finds existing record → skip)
    mockExecute
      .mockResolvedValueOnce({ rows: [{ id: 501 }] });                                                   // 2  alreadyPosted

    // Row 21 — happy path (steps 2-11)
    mockExecute
      .mockResolvedValueOnce({ rows: [] })                                                               // 2  alreadyPosted
      .mockResolvedValueOnce({ rows: [{ cash_journal_id: 10, bank_journal_id: 11 }] })                   // 3  resolveJournal
      .mockResolvedValueOnce({ rows: [{ cnt: 10 }] })                                                    // 4  generatePaymentNumber
      .mockResolvedValueOnce({ rows: [{ id: 502 }] })                                                    // 5  INSERT accounting_payments
      .mockResolvedValueOnce({ rows: [{ default_bank_account_id: 50, default_cash_account_id: null }] }) // 6  resolveBankAccount
      .mockResolvedValueOnce({ rows: [{ name: "Bank BCA" }] })                                           // 7  getAccountName
      .mockResolvedValueOnce({ rows: [{ sales_income_account_id: 40 }] })                                // 8  resolveRevenueAccount
      .mockResolvedValueOnce({ rows: [] })                                                               // 9  idempotency entry check
      .mockResolvedValueOnce({ rows: [] })                                                               // 10 UPDATE accounting_payments entry_id
      .mockResolvedValueOnce({ rows: [] });                                                              // 11 UPDATE tenant_payments posting_status

    // Row 22 — no journal configured (steps 2-6: resolveJournal fallbacks all empty)
    mockExecute
      .mockResolvedValueOnce({ rows: [] })                                                               // 2  alreadyPosted
      .mockResolvedValueOnce({ rows: [{ cash_journal_id: null, bank_journal_id: null }] })               // 3  resolveJournal settings
      .mockResolvedValueOnce({ rows: [] })                                                               // 4  fallback bank journal
      .mockResolvedValueOnce({ rows: [] })                                                               // 5  fallback cash journal
      .mockResolvedValueOnce({ rows: [] });                                                              // 6  fallback general journal

    const result = await bulkIngestModule("tenant", 1);

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

  // ── 10. SAFEGUARD: wrong-category settings account → COA fallback posts correctly ──

  it("falls back to COA bank account when default_bank_account_id points to a 'Kas' account", async () => {
    // Scenario: accounting_settings.default_bank_account_id = 50, but account 50 is named
    // "Kas Operasional" (kas category, not bank). The safeguard must reject it and fall back
    // to the COA query which finds a real bank account (id 55).
    //
    // DB call sequence (12 total):
    //  1.  SELECT tenant_payments (bulk candidates)
    //  2.  SELECT accounting_payments (alreadyPosted check)
    //  3.  SELECT accounting_settings → resolveJournal
    //  4.  SELECT COUNT accounting_payments → generatePaymentNumber
    //  5.  INSERT accounting_payments RETURNING id
    //  6.  SELECT accounting_settings → resolveBankAccount (bank + cash ids)
    //  7.  SELECT chart_of_accounts name (getAccountName for id 50) → "Kas Operasional" ❌
    //       (fallbackId = null → skip fallback check)
    //  8.  SELECT chart_of_accounts (COA fallback for '%bank%') → [{ id: 55, name: "Bank BNI" }]
    //  9.  SELECT accounting_settings → resolveRevenueAccount
    //  10. SELECT accounting_entries → idempotency check
    //  11. UPDATE accounting_payments SET entry_id
    //  12. UPDATE tenant_payments SET posting_status
    mockExecute
      .mockResolvedValueOnce({ rows: [makeTenantPaymentRow()] })                                         // 1
      .mockResolvedValueOnce({ rows: [] })                                                               // 2
      .mockResolvedValueOnce({ rows: [{ cash_journal_id: 10, bank_journal_id: 11 }] })                   // 3
      .mockResolvedValueOnce({ rows: [{ cnt: 5 }] })                                                     // 4
      .mockResolvedValueOnce({ rows: [{ id: 303 }] })                                                    // 5
      .mockResolvedValueOnce({ rows: [{ default_bank_account_id: 50, default_cash_account_id: null }] }) // 6
      .mockResolvedValueOnce({ rows: [{ name: "Kas Operasional" }] })                                    // 7  ← wrong category
      .mockResolvedValueOnce({ rows: [{ id: 55, name: "Bank BNI" }] })                                   // 8  COA fallback
      .mockResolvedValueOnce({ rows: [{ sales_income_account_id: 40 }] })                                // 9
      .mockResolvedValueOnce({ rows: [] })                                                               // 10
      .mockResolvedValueOnce({ rows: [] })                                                               // 11
      .mockResolvedValueOnce({ rows: [] });                                                              // 12

    const result = await bulkIngestModule("tenant", 1);

    expect(result.posted).toBe(1);
    expect(result.errors).toBe(0);
    expect(mockPost).toHaveBeenCalledOnce();

    // The posting engine must use the COA fallback account (55), not the misconfigured one (50).
    const postArgs = mockPost.mock.calls[0][0] as Record<string, unknown>;
    const lines = postArgs["lines"] as Array<{ accountId: number }>;
    expect(lines[0].accountId).toBe(55);
  });

  // ── 11. SAFEGUARD: revenue account null → ok:false, posting_status='error' ─────

  it("returns errors=1 and does not post when no revenue account is configured", async () => {
    // Scenario: resolveRevenueAccount returns null because:
    //   - accounting_settings.sales_income_account_id is null
    //   - chart_of_accounts COA fallback (type='revenue') is empty
    // ingestModulePayment must return ok:false and call updatePostingStatus('error').
    //
    // DB call sequence (10 total):
    //  1.  SELECT tenant_payments (bulk candidates)
    //  2.  SELECT accounting_payments (alreadyPosted check)
    //  3.  SELECT accounting_settings → resolveJournal
    //  4.  SELECT COUNT accounting_payments → generatePaymentNumber
    //  5.  INSERT accounting_payments RETURNING id
    //  6.  SELECT accounting_settings → resolveBankAccount
    //  7.  SELECT chart_of_accounts name (getAccountName) → "Bank BCA" ✓
    //  8.  SELECT accounting_settings → resolveRevenueAccount (no sales_income_account_id)
    //  9.  SELECT chart_of_accounts → resolveRevenueAccount COA fallback (empty)
    //      ↳ resolveRevenueAccount returns null → throw → catch → updatePostingStatus('error')
    // 10.  UPDATE tenant_payments SET posting_status = 'error'
    mockExecute
      .mockResolvedValueOnce({ rows: [makeTenantPaymentRow()] })                                          // 1
      .mockResolvedValueOnce({ rows: [] })                                                                // 2
      .mockResolvedValueOnce({ rows: [{ cash_journal_id: 10, bank_journal_id: 11 }] })                   // 3
      .mockResolvedValueOnce({ rows: [{ cnt: 5 }] })                                                     // 4
      .mockResolvedValueOnce({ rows: [{ id: 305 }] })                                                    // 5
      .mockResolvedValueOnce({ rows: [{ default_bank_account_id: 50, default_cash_account_id: null }] }) // 6
      .mockResolvedValueOnce({ rows: [{ name: "Bank BCA" }] })                                           // 7  ✓ valid bank
      .mockResolvedValueOnce({ rows: [{ sales_income_account_id: null }] })                              // 8  no revenue account in settings
      .mockResolvedValueOnce({ rows: [] })                                                               // 9  no revenue COA fallback
      .mockResolvedValueOnce({ rows: [] });                                                              // 10 updatePostingStatus('error')

    const result = await bulkIngestModule("tenant", 1);

    expect(result.total).toBe(1);
    expect(result.posted).toBe(0);
    expect(result.errors).toBe(1);
    expect(mockPost).not.toHaveBeenCalled();
  });

  // ── 13. Orphaned tenant — still posts, emits warn, partnerName = "" ─────────

  it("posts successfully, emits logger.warn, and defaults partnerName to '' when the linked tenant record is missing (customer_name = null)", async () => {
    // Scenario: tenant_payments LEFT JOIN tenants returns customer_name = null
    // because the linked tenant row has been deleted or was never created.
    // bulkIngestModule must:
    //   a) still post the payment (ok:true) — posting is not blocked by orphaned name
    //   b) call logger.warn exactly once with the orphan diagnostic message
    //   c) pass partnerName = "" (not null / "null") to the INSERT
    const { logger } = await import("../lib/logger.js");
    const orphanRow = makeTenantPaymentRow({ id: 77, payment_number: "TNT-077", customer_name: null });
    seedHappyPath(orphanRow);

    const result = await bulkIngestModule("tenant", 1);

    // Payment must be posted despite the null tenant name.
    expect(result.total).toBe(1);
    expect(result.posted).toBe(1);
    expect(result.skipped).toBe(0);
    expect(result.errors).toBe(0);
    expect(result.failedRows).toEqual([]);
    expect(mockPost).toHaveBeenCalledOnce();

    // logger.warn must have fired with the orphan message.
    expect(logger.warn).toHaveBeenCalledOnce();
    const warnCall = (logger.warn as ReturnType<typeof vi.fn>).mock.calls[0][0] as Record<string, unknown>;
    expect(warnCall["msg"]).toMatch(/tenant.*business_name|business_name.*tenant/i);
    expect(warnCall["tenant_payment_id"]).toBe(77);
    expect(warnCall["company_id"]).toBe(1);

    // INSERT accounting_payments (call index 4) must carry partnerName = ""
    // not null or the string "null".
    const insertCall = mockExecute.mock.calls[4][0] as { values: unknown[] };
    expect(insertCall.values[4]).toBe("");
  });

  // ── 12. SAFEGUARD: wrong-category settings + no COA fallback → ok:false returned ──

  it("returns errors=1 when settings account is wrong-category and COA fallback is absent", async () => {
    // Scenario: default_bank_account_id = 50 → "Kas Operasional" (wrong), no cashId,
    // AND the COA '%bank%' query returns nothing. resolveBankAccount returns null.
    // ingestModulePayment must return ok:false so the caller knows the ledger is
    // incomplete — it must NOT silently mark the payment as 'posted'.
    //
    // DB call sequence (9 total):
    //  1.  SELECT tenant_payments
    //  2.  SELECT accounting_payments
    //  3.  SELECT accounting_settings → resolveJournal
    //  4.  SELECT COUNT accounting_payments → generatePaymentNumber
    //  5.  INSERT accounting_payments RETURNING id
    //  6.  SELECT accounting_settings → resolveBankAccount
    //  7.  SELECT chart_of_accounts name (getAccountName for id 50) → "Kas Operasional" ❌
    //  8.  SELECT chart_of_accounts (COA fallback) → [] (none)
    //       ↳ bankAccountId is null → early return ok:false
    //  9.  UPDATE tenant_payments SET posting_status = 'error'
    mockExecute
      .mockResolvedValueOnce({ rows: [makeTenantPaymentRow()] })                                         // 1
      .mockResolvedValueOnce({ rows: [] })                                                               // 2
      .mockResolvedValueOnce({ rows: [{ cash_journal_id: 10, bank_journal_id: 11 }] })                   // 3
      .mockResolvedValueOnce({ rows: [{ cnt: 5 }] })                                                     // 4
      .mockResolvedValueOnce({ rows: [{ id: 304 }] })                                                    // 5
      .mockResolvedValueOnce({ rows: [{ default_bank_account_id: 50, default_cash_account_id: null }] }) // 6
      .mockResolvedValueOnce({ rows: [{ name: "Kas Operasional" }] })                                    // 7  ← wrong category
      .mockResolvedValueOnce({ rows: [] })                                                               // 8  COA fallback empty
      .mockResolvedValueOnce({ rows: [] });                                                              // 9  updatePostingStatus('error')

    const result = await bulkIngestModule("tenant", 1);

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
    const rowCompany1 = makeTenantPaymentRow({
      id: 101,
      company_id: 1,
      payment_number: "TNT-101",
      amount: "400000",
      customer_name: "PT Satu Jaya",
    });
    const rowCompany2 = makeTenantPaymentRow({
      id: 201,
      company_id: 2,
      payment_number: "TNT-201",
      amount: "550000",
      customer_name: "PT Dua Sejahtera",
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
      .mockResolvedValueOnce({ rows: [] });                                                            // 10 UPDATE tenant_payments

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
      .mockResolvedValueOnce({ rows: [] });                                                            // 20 UPDATE tenant_payments

    const result = await bulkIngestModule("tenant", null);

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
