/**
 * Phase 2 — Bank Description Normalizer: Unit Tests
 *
 * Run: node --test artifacts/api-server/tests/bank-description-normalizer.test.mjs
 *
 * No DB dependency. Pure logic tested in isolation.
 *
 * Test groups:
 *   1. normalizeDescription — category detection for each rule
 *   2. normalizeDescription — confidence levels
 *   3. normalizeDescription — isInternalTransfer flag
 *   4. normalizeDescription — isBankFee + feeType
 *   5. normalizeDescription — provider extraction
 *   6. normalizeDescription — unknown fallback
 *   7. normalizeDescriptions — batch helper
 *   8. Edge cases (empty, null-like, special chars)
 */

import { strict as assert } from "node:assert";
import { describe, it } from "node:test";

// ─── Import module under test (ESM, no DB deps) ───────────────────────────────

// Resolve from workspace root (run from project root or with --test)
// Using dynamic import to stay compatible with ESM-only dist
const { normalizeDescription, normalizeDescriptions } = await import(
  "../src/lib/bankDescriptionNormalizer.js"
).catch(async () => {
  // Fallback: try compiled dist
  return import("../dist/lib/bankDescriptionNormalizer.js");
});

// ─── Helpers ──────────────────────────────────────────────────────────────────

function assertCategory(desc, expectedCategory, msg) {
  const result = normalizeDescription(desc);
  assert.equal(
    result.category,
    expectedCategory,
    `[category] "${desc.slice(0, 60)}" → expected ${expectedCategory}, got ${result.category}${msg ? " | " + msg : ""}`,
  );
}

function assertConfidence(desc, minConfidence, msg) {
  const result = normalizeDescription(desc);
  assert.ok(
    result.confidence >= minConfidence,
    `[confidence] "${desc.slice(0, 60)}" → expected ≥${minConfidence}, got ${result.confidence}${msg ? " | " + msg : ""}`,
  );
}

// ─── 1. Category detection ─────────────────────────────────────────────────────

describe("Category detection — concession", () => {
  it("detects 'konsesi' keyword", () => assertCategory(
    "BIAYA KONSESI BULAN JUNI 2026", "concession",
  ));
  it("detects 'sewa konsesi'", () => assertCategory(
    "Sewa Konsesi Area Parkir", "concession",
  ));
  it("detects lowercase 'konsesi'", () => assertCategory(
    "pembayaran konsesi mingguan", "concession",
  ));
  it("detects English 'concession'", () => assertCategory(
    "Monthly concession payment area B", "concession",
  ));
});

describe("Category detection — utility_electricity", () => {
  it("detects 'PLN' keyword", () => assertCategory(
    "BAYAR PLN PREPAID 450000", "utility_electricity",
  ));
  it("detects 'token listrik'", () => assertCategory(
    "Token listrik prabayar Rp 200.000", "utility_electricity",
  ));
  it("detects 'listrik pascabayar'", () => assertCategory(
    "Tagihan Listrik Pascabayar Juni", "utility_electricity",
  ));
  it("detects 'KWH'", () => assertCategory(
    "Pembelian KWH meter periode Juli", "utility_electricity",
  ));
});

describe("Category detection — utility_water", () => {
  it("detects 'PDAM' keyword", () => assertCategory(
    "BAYAR PDAM TIRTA MOEDAL", "utility_water",
  ));
  it("detects 'air minum'", () => assertCategory(
    "Retribusi air minum PDAM Kota", "utility_water",
  ));
  it("detects 'retribusi air'", () => assertCategory(
    "Retribusi Air Bersih Bulan Juli 2026", "utility_water",
  ));
});

describe("Category detection — ecommerce", () => {
  it("detects 'Shopee'", () => assertCategory(
    "SHOPEE SETTLEMENT ORDER 12345", "ecommerce",
  ));
  it("detects 'Tokopedia'", () => assertCategory(
    "Tokopedia Disbursement Juli 2026", "ecommerce",
  ));
  it("detects 'tokped' abbreviation", () => assertCategory(
    "pencairan tokped minggu 3", "ecommerce",
  ));
  it("detects 'Lazada'", () => assertCategory(
    "LAZADA SELLER DISBURSEMENT", "ecommerce",
  ));
  it("detects 'Bukalapak'", () => assertCategory(
    "bukalapak pencairan penjual", "ecommerce",
  ));
  it("detects 'Blibli'", () => assertCategory(
    "BLIBLI MERCHANT PAYOUT JULI", "ecommerce",
  ));
  it("detects 'TikTok Shop'", () => assertCategory(
    "TikTok Shop Settlement Payment", "ecommerce",
  ));
});

describe("Category detection — internal_transfer (kas besar)", () => {
  it("detects 'kas besar'", () => assertCategory(
    "Transfer ke Kas Besar Cabang Utama", "internal_transfer",
  ));
  it("detects 'petty cash'", () => assertCategory(
    "Petty Cash Replenishment Juli", "internal_transfer",
  ));
  it("detects 'pemindahan dana'", () => assertCategory(
    "Pemindahan Dana Antar Rekening Internal", "internal_transfer",
  ));
  it("detects 'transfer internal'", () => assertCategory(
    "Transfer Internal Kas Perusahaan", "internal_transfer",
  ));
  it("detects 'antar rekening'", () => assertCategory(
    "Transfer Antar Rekening BNI ke Mandiri", "internal_transfer",
  ));
});

describe("Category detection — bank_fee", () => {
  it("detects 'biaya transfer'", () => assertCategory(
    "BIAYA TRANSFER RTGS Rp 30.000", "bank_fee",
  ));
  it("detects 'biaya admin'", () => assertCategory(
    "Biaya Administrasi Bank Bulanan", "bank_fee",
  ));
  it("detects 'provisi'", () => assertCategory(
    "Provisi kredit investasi", "bank_fee",
  ));
  it("detects 'materai'", () => assertCategory(
    "Bea Materai transaksi Rp 10.000", "bank_fee",
  ));
  it("detects 'fee kliring'", () => assertCategory(
    "Fee Kliring Cek Giro", "bank_fee",
  ));
});

describe("Category detection — marketplace_settlement", () => {
  it("detects 'GoPay' / 'dompet anak bangsa'", () => assertCategory(
    "DOMPET ANAK BANGSA PT TRANSFER", "marketplace_settlement",
  ));
  it("detects 'OVO'", () => assertCategory(
    "OVO MERCHANT SETTLEMENT HARIAN", "marketplace_settlement",
  ));
  it("detects 'DANA'", () => assertCategory(
    "DANA Merchant Disbursement", "marketplace_settlement",
  ));
  it("detects 'QRIS'", () => assertCategory(
    "QRIS Settlement BNI Merchant", "marketplace_settlement",
  ));
});

describe("Category detection — unknown fallback", () => {
  it("returns unknown for generic text", () => assertCategory(
    "SETORAN TUNAI COUNTER", "unknown",
  ));
  it("returns unknown for empty-ish description", () => assertCategory(
    "   ", "unknown",
  ));
  it("returns unknown for 'TRANSFER' alone (no qualifier)", () => assertCategory(
    "TRANSFER 1234567 BANK BCA", "unknown",
  ));
});

// ─── 2. Confidence levels ─────────────────────────────────────────────────────

describe("Confidence levels", () => {
  it("konsesi has confidence ≥ 90", () => assertConfidence(
    "Biaya konsesi Rp 5.000.000", 90,
  ));
  it("PLN has confidence ≥ 88", () => assertConfidence(
    "Token PLN prabayar 200rb", 88,
  ));
  it("ecommerce has confidence ≥ 88", () => assertConfidence(
    "SHOPEE DISBURSEMENT", 88,
  ));
  it("internal_transfer has confidence ≥ 88", () => assertConfidence(
    "transfer kas besar cabang semarang", 88,
  ));
  it("bank_fee has confidence ≥ 85", () => assertConfidence(
    "biaya admin bank bulanan", 85,
  ));
  it("unknown has confidence 0", () => {
    const result = normalizeDescription("SESUATU YANG TIDAK DIKENAL XYZ123");
    assert.equal(result.confidence, 0, "unknown should have confidence=0");
  });
});

// ─── 3. isInternalTransfer flag ────────────────────────────────────────────────

describe("isInternalTransfer flag", () => {
  it("kas besar → isInternalTransfer=true", () => {
    const r = normalizeDescription("Transfer ke Kas Besar");
    assert.equal(r.isInternalTransfer, true);
  });
  it("petty cash → isInternalTransfer=true", () => {
    const r = normalizeDescription("Petty Cash Top Up");
    assert.equal(r.isInternalTransfer, true);
  });
  it("PLN payment → isInternalTransfer=false", () => {
    const r = normalizeDescription("Bayar PLN token listrik");
    assert.equal(r.isInternalTransfer, false);
  });
  it("shopee settlement → isInternalTransfer=false", () => {
    const r = normalizeDescription("SHOPEE SELLER SETTLEMENT");
    assert.equal(r.isInternalTransfer, false);
  });
  it("metadata contains transfer_type=internal for internal transfer", () => {
    const r = normalizeDescription("Pemindahan Dana kas besar");
    assert.equal(r.metadata["transfer_type"], "internal");
  });
});

// ─── 4. isBankFee + feeType ────────────────────────────────────────────────────

describe("isBankFee and feeType", () => {
  it("isBankFee=true for biaya transfer", () => {
    const r = normalizeDescription("BIAYA TRANSFER RTGS 30000");
    assert.equal(r.isBankFee, true);
  });
  it("feeType=transfer for biaya transfer", () => {
    const r = normalizeDescription("Biaya Transfer Rekening");
    assert.equal(r.feeType, "transfer");
  });
  it("feeType=admin for biaya admin", () => {
    const r = normalizeDescription("Biaya Administrasi Bank");
    assert.equal(r.feeType, "admin");
  });
  it("feeType=kliring for fee kliring", () => {
    const r = normalizeDescription("Fee Kliring Cek Giro");
    assert.equal(r.feeType, "kliring");
  });
  it("feeType=provisi for provisi kredit", () => {
    const r = normalizeDescription("Provisi Kredit Modal Kerja");
    assert.equal(r.feeType, "provisi");
  });
  it("feeType=materai for bea materai", () => {
    const r = normalizeDescription("Bea Materai Akta Notaris");
    assert.equal(r.feeType, "materai");
  });
  it("metadata contains fee_type for bank fees", () => {
    const r = normalizeDescription("Biaya Admin Bank Mandiri");
    assert.ok(r.metadata["fee_type"], "metadata.fee_type should be set");
  });
  it("isBankFee=false for PLN", () => {
    const r = normalizeDescription("Bayar PLN token listrik");
    assert.equal(r.isBankFee, false);
  });
});

// ─── 5. Provider extraction ───────────────────────────────────────────────────

describe("Provider extraction", () => {
  it("PLN detected as provider for electricity", () => {
    const r = normalizeDescription("Token PLN Prabayar");
    assert.equal(r.provider, "PLN");
  });
  it("PDAM detected as provider for water", () => {
    const r = normalizeDescription("Tagihan PDAM Tirta");
    assert.equal(r.provider, "PDAM");
  });
  it("no provider for unknown", () => {
    const r = normalizeDescription("TRANSFER BIASA");
    assert.equal(r.provider, undefined);
  });
});

// ─── 6. Output structure ──────────────────────────────────────────────────────

describe("Output structure integrity", () => {
  it("result always has required fields", () => {
    const r = normalizeDescription("Bayar PLN Listrik");
    assert.ok(typeof r.raw === "string", "raw is string");
    assert.ok(typeof r.normalized === "string", "normalized is string");
    assert.ok(Array.isArray(r.tokens), "tokens is array");
    assert.ok(typeof r.category === "string", "category is string");
    assert.ok(typeof r.confidence === "number", "confidence is number");
    assert.ok(typeof r.isInternalTransfer === "boolean", "isInternalTransfer is boolean");
    assert.ok(typeof r.isBankFee === "boolean", "isBankFee is boolean");
    assert.ok(typeof r.metadata === "object", "metadata is object");
  });

  it("normalized is lowercase", () => {
    const r = normalizeDescription("BIAYA TRANSFER RTGS");
    assert.equal(r.normalized, r.normalized.toLowerCase());
  });

  it("tokens contain only words ≥ 3 chars", () => {
    const r = normalizeDescription("Biaya Transfer Antar Rekening Bank");
    assert.ok(r.tokens.every(t => t.length >= 3), "all tokens ≥ 3 chars");
  });

  it("raw is preserved exactly", () => {
    const raw = "BIAYA KONSESI AREA B-12 / Rp.5.000.000";
    const r = normalizeDescription(raw);
    assert.equal(r.raw, raw);
  });
});

// ─── 7. Batch helper ─────────────────────────────────────────────────────────

describe("normalizeDescriptions (batch)", () => {
  it("returns array of same length as input", () => {
    const inputs = ["Bayar PLN", "SHOPEE SETTLEMENT", "Transfer kas besar"];
    const results = normalizeDescriptions(inputs);
    assert.equal(results.length, 3);
  });

  it("each result has correct category", () => {
    const inputs = ["Bayar PLN", "SHOPEE SETTLEMENT", "Transfer kas besar"];
    const results = normalizeDescriptions(inputs);
    assert.equal(results[0].category, "utility_electricity");
    assert.equal(results[1].category, "ecommerce");
    assert.equal(results[2].category, "internal_transfer");
  });

  it("empty array returns empty array", () => {
    const results = normalizeDescriptions([]);
    assert.equal(results.length, 0);
  });
});

// ─── 8. Edge cases ────────────────────────────────────────────────────────────

describe("Edge cases", () => {
  it("empty string returns unknown with confidence 0", () => {
    const r = normalizeDescription("");
    assert.equal(r.category, "unknown");
    assert.equal(r.confidence, 0);
    assert.equal(r.isInternalTransfer, false);
    assert.equal(r.isBankFee, false);
  });

  it("string with only special chars returns unknown", () => {
    const r = normalizeDescription("!@#$%^&*()");
    assert.equal(r.category, "unknown");
  });

  it("very long description is handled", () => {
    const longDesc = "BIAYA KONSESI ".repeat(100);
    const r = normalizeDescription(longDesc);
    assert.equal(r.category, "concession");
  });

  it("mixed-case PLN detected", () => {
    const r = normalizeDescription("bayar PLN prepaid token");
    assert.equal(r.category, "utility_electricity");
  });

  it("internal_transfer takes priority over bank_fee in ambiguous case", () => {
    // "kas besar" should win because internal_transfer rules are checked first
    const r = normalizeDescription("Biaya transfer kas besar");
    // Both 'internal_transfer' and 'bank_fee' keywords present
    // 'kas besar' (internal_transfer) is listed BEFORE 'biaya transfer' (bank_fee) in CATEGORY_RULES
    assert.equal(r.category, "internal_transfer");
  });
});
