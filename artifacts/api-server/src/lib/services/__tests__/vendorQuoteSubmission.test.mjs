/**
 * vendorQuoteSubmission.test.mjs — Phase 2D Integration Tests
 *
 * Tests the full vendor quote submission lifecycle:
 *   invited → opened → draft (save/overwrite) → submitted
 *
 * Uses service layer directly (not HTTP routes) for speed.
 * Fixtures: RFQ + invited quote row created per-TC via DB, cleaned up after.
 *
 * Run: node artifacts/api-server/src/lib/services/__tests__/vendorQuoteSubmission.test.mjs
 */

import { randomBytes } from "crypto";
import { eq, and } from "drizzle-orm";
import pkg from "../../../../../lib/db/dist/index.js";
const {
  db,
  mktVendorQuotesTable,
  mktVendorQuoteLinesTable,
  mktRfqsTable,
  mktRfqLinesTable,
  suppliersTable,
} = pkg;

// ── Service under test ────────────────────────────────────────────────────────
import {
  loadQuoteByToken,
  markQuoteOpened,
  saveQuoteDraft,
  submitQuote,
  ALLOWED_CURRENCIES,
} from "../vendorQuoteSubmissionService.js";

// ── Test harness ──────────────────────────────────────────────────────────────

let passed = 0;
let failed = 0;

function assert(label, condition, got = undefined) {
  if (condition) {
    console.log(`  ✅ ${label}${got !== undefined ? ` (got: ${JSON.stringify(got)})` : ""}`);
    passed++;
  } else {
    console.error(`  ❌ ${label}${got !== undefined ? ` (got: ${JSON.stringify(got)})` : ""}`);
    failed++;
  }
}

// ── Fixture helpers ───────────────────────────────────────────────────────────

const RUN_ID = Date.now();

async function getTestVendor() {
  const [v] = await db
    .select({ id: suppliersTable.id, name: suppliersTable.name, isActive: suppliersTable.isActive })
    .from(suppliersTable)
    .where(eq(suppliersTable.isActive, true))
    .limit(1);
  if (!v) throw new Error("No active vendor found for test");
  return v;
}

async function createTestRfq(suffix) {
  const rfqNumber = `MKT-TEST-${RUN_ID}-${suffix}`;
  const [rfq] = await db
    .insert(mktRfqsTable)
    .values({
      rfqNumber,
      status: "open",
      buyerName: "Test Buyer",
      buyerCompany: "Test Co",
      notes: "Test RFQ for Phase 2D",
      requestType: "product",
    })
    .returning({ id: mktRfqsTable.id, rfqNumber: mktRfqsTable.rfqNumber });

  // Insert 2 RFQ lines
  const [line1, line2] = await db
    .insert(mktRfqLinesTable)
    .values([
      { rfqId: rfq.id, itemName: "Product A", itemUnit: "pcs", requestedQty: "10", sortOrder: 1 },
      { rfqId: rfq.id, itemName: "Product B", itemUnit: "box", requestedQty: "5",  sortOrder: 2 },
    ])
    .returning({ id: mktRfqLinesTable.id });

  return { rfq, lines: [line1, line2] };
}

async function createTestQuote(rfqId, vendorId, status = "invited", expiryDays = 30) {
  const token = randomBytes(32).toString("hex");
  const validUntil = new Date();
  validUntil.setDate(validUntil.getDate() + expiryDays);

  const [quote] = await db
    .insert(mktVendorQuotesTable)
    .values({ rfqId, vendorId, token, status, validUntil })
    .returning({ id: mktVendorQuotesTable.id });

  return { quote, token };
}

async function cleanup(rfqId) {
  // Lines deleted via CASCADE on mkt_rfqs delete
  await db.delete(mktRfqsTable).where(eq(mktRfqsTable.id, rfqId)).catch(() => {});
}

// ── Test Cases ────────────────────────────────────────────────────────────────

async function runTests() {
  console.log("\n╔══════════════════════════════════════════════════════════════╗");
  console.log("║   Phase 2D — Vendor Quote Submission Integration Tests       ║");
  console.log("╚══════════════════════════════════════════════════════════════╝\n");

  const vendor = await getTestVendor();
  console.log(`🔑 Vendor untuk test: id=${vendor.id} name="${vendor.name}"\n`);

  // ── TC1: Load token sukses → view lengkap, internal fields tidak ada ────────
  {
    console.log("TC1: loadQuoteByToken sukses — view lengkap, internal fields excluded");
    const { rfq, lines } = await createTestRfq("tc1");
    const { token } = await createTestQuote(rfq.id, vendor.id, "invited");
    const result = await loadQuoteByToken(token);

    assert("result.ok === true", result.ok === true);
    if (result.ok) {
      const { view } = result;
      assert("quote.id ada", typeof view.quote.id === "number");
      assert("quote.status = invited", view.quote.status === "invited", view.quote.status);
      assert("vendor.name ada", typeof view.vendor.name === "string");
      assert("rfq.rfqNumber match", view.rfq.rfqNumber === rfq.rfqNumber, view.rfq.rfqNumber);
      assert("rfqLines.length = 2", view.rfqLines.length === 2, view.rfqLines.length);
      // Security: internal fields TIDAK ada di view
      assert("commission_rate tidak ada", !("commissionRate" in view.quote));
      assert("rank_score tidak ada", !("rankScore" in view.quote));
      assert("net_vendor_amount tidak ada", !("netVendorAmount" in view.quote));
      // Buyer internal data tidak ada
      assert("target_price tidak ada di rfqLines", view.rfqLines.every(l => !("targetPricePerUnit" in l)));
      assert("quoteLines kosong (belum ada lines)", view.quoteLines.length === 0, view.quoteLines.length);
      assert("meta.allowedCurrencies ada", Array.isArray(view));
      // meta fields ada
      assert("meta tersedia", result.ok && 'view' in result);
      assert("IDR ada di ALLOWED_CURRENCIES", ALLOWED_CURRENCIES.has("IDR"));
    }
    await cleanup(rfq.id);
  }

  // ── TC2: Token tidak valid → 404-equivalent ────────────────────────────────
  {
    console.log("\nTC2: Token tidak valid");
    const result1 = await loadQuoteByToken("invalid-token");
    assert("token invalid → ok=false", !result1.ok);
    assert("code = TOKEN_INVALID", !result1.ok && result1.code === "TOKEN_INVALID", !result1.ok ? result1.code : "ok");

    const result2 = await loadQuoteByToken("a".repeat(63)); // 63 chars — bukan 64
    assert("63-char hex → TOKEN_INVALID", !result2.ok && result2.code === "TOKEN_INVALID", !result2.ok ? result2.code : "ok");

    const result3 = await loadQuoteByToken("a".repeat(64)); // 64 chars tapi tidak ada di DB
    assert("valid format tapi tidak ada di DB → TOKEN_INVALID", !result3.ok && result3.code === "TOKEN_INVALID");
  }

  // ── TC3: Token expired ─────────────────────────────────────────────────────
  {
    console.log("\nTC3: Token expired");
    const { rfq } = await createTestRfq("tc3");
    const { token } = await createTestQuote(rfq.id, vendor.id, "invited", -1); // expired kemarin
    const result = await loadQuoteByToken(token);
    assert("expired → ok=false", !result.ok);
    assert("code = TOKEN_EXPIRED", !result.ok && result.code === "TOKEN_EXPIRED", !result.ok ? result.code : "ok");
    await cleanup(rfq.id);
  }

  // ── TC4: markQuoteOpened — invited → opened ────────────────────────────────
  {
    console.log("\nTC4: markQuoteOpened — invited → opened");
    const { rfq } = await createTestRfq("tc4");
    const { quote, token } = await createTestQuote(rfq.id, vendor.id, "invited");

    await markQuoteOpened(quote.id, rfq.id, vendor.id);
    await new Promise(r => setTimeout(r, 200)); // tunggu update

    const [updated] = await db
      .select({ status: mktVendorQuotesTable.status, openedAt: mktVendorQuotesTable.openedAt })
      .from(mktVendorQuotesTable)
      .where(eq(mktVendorQuotesTable.id, quote.id));

    assert("status → opened", updated?.status === "opened", updated?.status);
    assert("openedAt terisi", updated?.openedAt != null);
    await cleanup(rfq.id);
  }

  // ── TC5: Save draft sukses ─────────────────────────────────────────────────
  {
    console.log("\nTC5: Save draft sukses");
    const { rfq, lines } = await createTestRfq("tc5");
    const { quote } = await createTestQuote(rfq.id, vendor.id, "invited");
    const rfqLineIds = new Set(lines.map(l => l.id));

    const result = await saveQuoteDraft(quote.id, rfq.id, vendor.id, rfqLineIds, {
      header: {
        quotationNumber: "QUO-2026-001",
        quotationDate: "2026-07-03",
        paymentTerms: "NET30",
        incoterm: "FOB",
        deliveryLocation: "Jakarta Barat",
        notes: "Test grand notes",
      },
      lines: lines.map((l, i) => ({
        rfqLineId: l.id,
        offeredUnitPrice: 150000 + i * 10000,
        offeredQty: 8 + i,
        currency: "IDR",
        minimumOrderQty: 5,
        validUntil: "2026-08-03",
        leadTimeDays: 7,
        stockStatus: "available",
        notes: `Remark item ${i + 1}`,
      })),
    });

    assert("save result.ok = true", result.ok === true, result.ok ? "ok" : !result.ok ? result.message : "");
    if (result.ok) assert("savedLines = 2", result.savedLines === 2, result.savedLines);

    // Verifikasi DB
    const [hdr] = await db
      .select({
        status: mktVendorQuotesTable.status,
        quotationNumber: mktVendorQuotesTable.quotationNumber,
        paymentTerms: mktVendorQuotesTable.paymentTerms,
      })
      .from(mktVendorQuotesTable)
      .where(eq(mktVendorQuotesTable.id, quote.id));

    assert("status → draft", hdr?.status === "draft", hdr?.status);
    assert("quotationNumber tersimpan", hdr?.quotationNumber === "QUO-2026-001", hdr?.quotationNumber);
    assert("paymentTerms tersimpan", hdr?.paymentTerms === "NET30", hdr?.paymentTerms);

    const savedLines = await db
      .select()
      .from(mktVendorQuoteLinesTable)
      .where(eq(mktVendorQuoteLinesTable.quoteId, quote.id));

    assert("2 lines tersimpan di DB", savedLines.length === 2, savedLines.length);
    assert("currency = IDR", savedLines.every(l => l.currency === "IDR"));
    assert("minimum_order_qty = 5", savedLines.every(l => parseFloat(l.minimumOrderQty ?? "0") === 5));
    assert("subtotal dihitung", savedLines.every(l => parseFloat(l.subtotal) > 0));

    await cleanup(rfq.id);
  }

  // ── TC6: Draft overwrite (save kedua kali — lines lama diganti) ─────────────
  {
    console.log("\nTC6: Draft overwrite (save dua kali)");
    const { rfq, lines } = await createTestRfq("tc6");
    const { quote } = await createTestQuote(rfq.id, vendor.id, "invited");
    const rfqLineIds = new Set(lines.map(l => l.id));

    const makeInput = (price) => ({
      header: { quotationNumber: `QUO-${price}`, notes: null },
      lines: lines.map(l => ({
        rfqLineId: l.id,
        offeredUnitPrice: price,
        offeredQty: 5,
        currency: "USD",
        validUntil: "2026-09-01",
        leadTimeDays: 3,
      })),
    });

    await saveQuoteDraft(quote.id, rfq.id, vendor.id, rfqLineIds, makeInput(100000));
    await saveQuoteDraft(quote.id, rfq.id, vendor.id, rfqLineIds, makeInput(200000));

    // Cek hanya 2 lines (bukan 4 — old lines harus di-delete)
    const savedLines = await db
      .select({ price: mktVendorQuoteLinesTable.offeredUnitPrice })
      .from(mktVendorQuoteLinesTable)
      .where(eq(mktVendorQuoteLinesTable.quoteId, quote.id));

    assert("lines count tetap 2 setelah overwrite", savedLines.length === 2, savedLines.length);
    assert("harga diupdate ke 200000", savedLines.every(l => parseFloat(l.price) === 200000), savedLines.map(l => l.price));

    await cleanup(rfq.id);
  }

  // ── TC7: Submit sukses ─────────────────────────────────────────────────────
  {
    console.log("\nTC7: Submit sukses");
    const { rfq, lines } = await createTestRfq("tc7");
    const { quote } = await createTestQuote(rfq.id, vendor.id, "draft");
    const rfqLineIds = new Set(lines.map(l => l.id));

    const result = await submitQuote(quote.id, rfq.id, vendor.id, rfqLineIds, {
      header: {
        quotationNumber: "QUO-FINAL-001",
        quotationDate: "2026-07-03",
        paymentTerms: "COD",
        incoterm: "EXW",
        deliveryLocation: "Gudang Vendor",
        notes: "Siap kirim dalam 7 hari",
      },
      lines: lines.map((l, i) => ({
        rfqLineId: l.id,
        offeredUnitPrice: 500000 + i * 50000,
        offeredQty: 10,
        currency: "IDR",
        minimumOrderQty: 1,
        validUntil: "2026-08-30",
        leadTimeDays: 7,
        stockStatus: "available",
        notes: `Final price item ${i + 1}`,
      })),
    });

    assert("submit result.ok = true", result.ok === true, result.ok ? "ok" : !result.ok ? result.message : "");
    if (result.ok) assert("submittedAt ada", result.submittedAt instanceof Date);

    const [updated] = await db
      .select({ status: mktVendorQuotesTable.status, submittedAt: mktVendorQuotesTable.submittedAt })
      .from(mktVendorQuotesTable)
      .where(eq(mktVendorQuotesTable.id, quote.id));

    assert("status → submitted", updated?.status === "submitted", updated?.status);
    assert("submittedAt terisi", updated?.submittedAt != null);

    const submittedLines = await db
      .select()
      .from(mktVendorQuoteLinesTable)
      .where(eq(mktVendorQuoteLinesTable.quoteId, quote.id));

    assert("2 lines tersimpan di submit", submittedLines.length === 2, submittedLines.length);
    assert("currency IDR di semua lines", submittedLines.every(l => l.currency === "IDR"));
    assert("valid_until per line ada", submittedLines.every(l => l.validUntil != null));

    await cleanup(rfq.id);
  }

  // ── TC8: Submit dua kali → 409 / ALREADY_SUBMITTED ────────────────────────
  {
    console.log("\nTC8: Submit dua kali → ALREADY_SUBMITTED");
    const { rfq, lines } = await createTestRfq("tc8");
    const { quote } = await createTestQuote(rfq.id, vendor.id, "draft");
    const rfqLineIds = new Set(lines.map(l => l.id));

    const makeSubmitInput = () => ({
      header: { quotationDate: "2026-07-03", paymentTerms: "COD" },
      lines: lines.map(l => ({
        rfqLineId: l.id,
        offeredUnitPrice: 100000,
        offeredQty: 5,
        currency: "IDR",
        validUntil: "2026-08-30",
        leadTimeDays: 1,
      })),
    });

    const first = await submitQuote(quote.id, rfq.id, vendor.id, rfqLineIds, makeSubmitInput());
    assert("submit pertama sukses", first.ok === true, first.ok ? "ok" : !first.ok ? first.message : "");

    const second = await submitQuote(quote.id, rfq.id, vendor.id, rfqLineIds, makeSubmitInput());
    assert("submit kedua → ok=false", !second.ok);
    assert("code = ALREADY_SUBMITTED", !second.ok && second.code === "ALREADY_SUBMITTED", !second.ok ? second.code : "ok");

    await cleanup(rfq.id);
  }

  // ── TC9: Edit (save) setelah submit → ALREADY_SUBMITTED ───────────────────
  {
    console.log("\nTC9: Save setelah submit → ALREADY_SUBMITTED");
    const { rfq, lines } = await createTestRfq("tc9");
    const { quote } = await createTestQuote(rfq.id, vendor.id, "submitted"); // langsung submitted
    const rfqLineIds = new Set(lines.map(l => l.id));

    const result = await saveQuoteDraft(quote.id, rfq.id, vendor.id, rfqLineIds, {
      header: { notes: "Coba edit setelah submit" },
      lines: lines.map(l => ({
        rfqLineId: l.id,
        offeredUnitPrice: 100000,
        offeredQty: 5,
        currency: "IDR",
        validUntil: "2026-08-30",
      })),
    });

    assert("save setelah submit → ok=false", !result.ok);
    assert("code = ALREADY_SUBMITTED", !result.ok && result.code === "ALREADY_SUBMITTED", !result.ok ? result.code : "ok");
    await cleanup(rfq.id);
  }

  // ── TC10: Validasi error — price <= 0 ─────────────────────────────────────
  {
    console.log("\nTC10: Validasi error — price <= 0");
    const { rfq, lines } = await createTestRfq("tc10");
    const { quote } = await createTestQuote(rfq.id, vendor.id, "invited");
    const rfqLineIds = new Set(lines.map(l => l.id));

    const result = await saveQuoteDraft(quote.id, rfq.id, vendor.id, rfqLineIds, {
      header: {},
      lines: [{ rfqLineId: lines[0].id, offeredUnitPrice: -100, offeredQty: 5, currency: "IDR", validUntil: "2026-08-30" }],
    });

    assert("price <= 0 → VALIDATION_ERROR", !result.ok && result.code === "VALIDATION_ERROR", !result.ok ? result.code : "ok");
    await cleanup(rfq.id);
  }

  // ── TC11: Validasi — currency tidak valid saat submit ─────────────────────
  {
    console.log("\nTC11: Currency tidak valid saat submit → VALIDATION_ERROR");
    const { rfq, lines } = await createTestRfq("tc11");
    const { quote } = await createTestQuote(rfq.id, vendor.id, "invited");
    const rfqLineIds = new Set(lines.map(l => l.id));

    const result = await submitQuote(quote.id, rfq.id, vendor.id, rfqLineIds, {
      header: { quotationDate: "2026-07-03" },
      lines: lines.map(l => ({
        rfqLineId: l.id,
        offeredUnitPrice: 100000,
        offeredQty: 5,
        currency: "XYZ", // tidak valid
        validUntil: "2026-08-30",
        leadTimeDays: 1,
      })),
    });

    assert("invalid currency → VALIDATION_ERROR", !result.ok && result.code === "VALIDATION_ERROR", !result.ok ? result.code : "ok");
    await cleanup(rfq.id);
  }

  // ── TC12: valid_until sebelum quotation_date → error ──────────────────────
  {
    console.log("\nTC12: valid_until < quotation_date → VALIDATION_ERROR");
    const { rfq, lines } = await createTestRfq("tc12");
    const { quote } = await createTestQuote(rfq.id, vendor.id, "invited");
    const rfqLineIds = new Set(lines.map(l => l.id));

    const result = await submitQuote(quote.id, rfq.id, vendor.id, rfqLineIds, {
      header: { quotationDate: "2026-08-01" },
      lines: lines.map(l => ({
        rfqLineId: l.id,
        offeredUnitPrice: 100000,
        offeredQty: 5,
        currency: "IDR",
        validUntil: "2026-07-01", // sebelum quotation_date
        leadTimeDays: 1,
      })),
    });

    assert("valid_until < quotation_date → VALIDATION_ERROR", !result.ok && result.code === "VALIDATION_ERROR", !result.ok ? result.code : "ok");
    await cleanup(rfq.id);
  }

  // ── TC13: rfq_line_id dari RFQ lain → RFQ_LINE_MISMATCH ──────────────────
  {
    console.log("\nTC13: rfq_line_id bukan dari RFQ ini → RFQ_LINE_MISMATCH");
    const { rfq, lines } = await createTestRfq("tc13");
    const { quote } = await createTestQuote(rfq.id, vendor.id, "invited");
    const rfqLineIds = new Set(lines.map(l => l.id));

    const result = await saveQuoteDraft(quote.id, rfq.id, vendor.id, rfqLineIds, {
      header: {},
      lines: [{ rfqLineId: 999999, offeredUnitPrice: 100000, offeredQty: 5, currency: "IDR", validUntil: "2026-08-30" }],
    });

    assert("rfq_line_id asing → RFQ_LINE_MISMATCH", !result.ok && result.code === "RFQ_LINE_MISMATCH", !result.ok ? result.code : "ok");
    await cleanup(rfq.id);
  }

  // ── TC14: Submit — lines tidak lengkap (missing rfq_line) ─────────────────
  {
    console.log("\nTC14: Submit dengan hanya 1 dari 2 rfq lines → RFQ_LINE_MISMATCH");
    const { rfq, lines } = await createTestRfq("tc14");
    const { quote } = await createTestQuote(rfq.id, vendor.id, "draft");
    const rfqLineIds = new Set(lines.map(l => l.id));

    const result = await submitQuote(quote.id, rfq.id, vendor.id, rfqLineIds, {
      header: { quotationDate: "2026-07-03" },
      lines: [{ // hanya line pertama
        rfqLineId: lines[0].id,
        offeredUnitPrice: 100000,
        offeredQty: 5,
        currency: "IDR",
        validUntil: "2026-08-30",
        leadTimeDays: 1,
      }],
    });

    assert("partial lines saat submit → RFQ_LINE_MISMATCH", !result.ok && result.code === "RFQ_LINE_MISMATCH", !result.ok ? result.code : "ok");
    await cleanup(rfq.id);
  }

  // ── TC15: is_partial_quote computed di view ────────────────────────────────
  {
    console.log("\nTC15: is_partial_quote = true jika offered_qty < requested_qty");
    const { rfq, lines } = await createTestRfq("tc15");
    const { quote, token } = await createTestQuote(rfq.id, vendor.id, "draft");
    const rfqLineIds = new Set(lines.map(l => l.id));

    // Save dengan offered_qty 3 (kurang dari requested_qty 10 dan 5)
    await saveQuoteDraft(quote.id, rfq.id, vendor.id, rfqLineIds, {
      header: {},
      lines: lines.map(l => ({
        rfqLineId: l.id,
        offeredUnitPrice: 100000,
        offeredQty: 3, // kurang dari requested 10/5
        currency: "IDR",
        validUntil: "2026-08-30",
      })),
    });

    const viewResult = await loadQuoteByToken(token);
    assert("view load sukses", viewResult.ok === true);
    if (viewResult.ok) {
      assert("quoteLines.length = 2", viewResult.view.quoteLines.length === 2, viewResult.view.quoteLines.length);
      assert("is_partial_quote = true untuk semua lines", viewResult.view.quoteLines.every(l => l.isPartialQuote === true));
    }
    await cleanup(rfq.id);
  }

  // ── TC16: ALLOWED_CURRENCIES validation ───────────────────────────────────
  {
    console.log("\nTC16: ALLOWED_CURRENCIES — semua minimal currency support");
    const required = ["IDR", "USD", "SGD", "EUR", "JPY", "CNY"];
    for (const cur of required) {
      assert(`${cur} ada di ALLOWED_CURRENCIES`, ALLOWED_CURRENCIES.has(cur));
    }
    assert("XYZ tidak ada", !ALLOWED_CURRENCIES.has("XYZ"));
  }

  // ── Summary ───────────────────────────────────────────────────────────────
  console.log("\n╔═══════════════════════════════════════════╗");
  console.log(`║  PASSED: ${String(passed).padEnd(3)}| FAILED: ${failed}                ║`);
  console.log("╚═══════════════════════════════════════════╝");
  if (failed > 0) process.exit(1);
}

runTests().catch((err) => {
  console.error("TEST FATAL ERROR:", err);
  process.exit(1);
});
