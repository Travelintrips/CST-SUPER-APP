/**
 * Phase 2 — Bank Description Normalizer: Vitest Unit Tests
 *
 * Pure logic tests — no DB, no HTTP. All tests run offline.
 *
 * Run: pnpm --filter @workspace/api-server test
 *      or: pnpm exec vitest run src/__tests__/bank-description-normalizer.test.ts
 */

import { describe, it, expect } from "vitest";
import {
  normalizeDescription,
  normalizeDescriptions,
  type NormalizationResult,
  type DescriptionCategory,
} from "../lib/bankDescriptionNormalizer.js";

// ─── Helpers ──────────────────────────────────────────────────────────────────

function cat(desc: string): DescriptionCategory {
  return normalizeDescription(desc).category;
}

function conf(desc: string): number {
  return normalizeDescription(desc).confidence;
}

// ─── 1. Category detection ─────────────────────────────────────────────────────

describe("Category detection — concession", () => {
  it("detects 'BIAYA KONSESI'", () => {
    expect(cat("BIAYA KONSESI BULAN JUNI 2026")).toBe("concession");
  });
  it("detects 'sewa konsesi'", () => {
    expect(cat("Sewa Konsesi Area Parkir")).toBe("concession");
  });
  it("detects lowercase 'konsesi'", () => {
    expect(cat("pembayaran konsesi mingguan")).toBe("concession");
  });
  it("detects English 'concession'", () => {
    expect(cat("Monthly concession payment area B")).toBe("concession");
  });
  it("detects 'fee konsesi'", () => {
    expect(cat("fee konsesi area lantai dasar")).toBe("concession");
  });
});

describe("Category detection — utility_electricity", () => {
  it("detects 'PLN' keyword", () => {
    expect(cat("BAYAR PLN PREPAID 450000")).toBe("utility_electricity");
  });
  it("detects 'token listrik'", () => {
    expect(cat("Token listrik prabayar Rp 200.000")).toBe("utility_electricity");
  });
  it("detects 'listrik pascabayar'", () => {
    expect(cat("Tagihan Listrik Pascabayar Juni")).toBe("utility_electricity");
  });
  it("detects 'KWH'", () => {
    expect(cat("Pembelian KWH meter periode Juli")).toBe("utility_electricity");
  });
  it("detects 'token pln'", () => {
    expect(cat("token pln prabayar 100000")).toBe("utility_electricity");
  });
});

describe("Category detection — utility_water", () => {
  it("detects 'PDAM' keyword", () => {
    expect(cat("BAYAR PDAM TIRTA MOEDAL")).toBe("utility_water");
  });
  it("detects 'air minum'", () => {
    expect(cat("Retribusi air minum PDAM Kota")).toBe("utility_water");
  });
  it("detects 'retribusi air'", () => {
    expect(cat("Retribusi Air Bersih Bulan Juli 2026")).toBe("utility_water");
  });
  it("detects 'tagihan air'", () => {
    expect(cat("Tagihan Air PDAM Cabang Selatan")).toBe("utility_water");
  });
});

describe("Category detection — ecommerce", () => {
  it("detects 'Shopee'", () => {
    expect(cat("SHOPEE SETTLEMENT ORDER 12345")).toBe("ecommerce");
  });
  it("detects 'Tokopedia'", () => {
    expect(cat("Tokopedia Disbursement Juli 2026")).toBe("ecommerce");
  });
  it("detects 'tokped' abbreviation", () => {
    expect(cat("pencairan tokped minggu 3")).toBe("ecommerce");
  });
  it("detects 'Lazada'", () => {
    expect(cat("LAZADA SELLER DISBURSEMENT")).toBe("ecommerce");
  });
  it("detects 'Bukalapak'", () => {
    expect(cat("bukalapak pencairan penjual")).toBe("ecommerce");
  });
  it("detects 'Blibli'", () => {
    expect(cat("BLIBLI MERCHANT PAYOUT JULI")).toBe("ecommerce");
  });
  it("detects 'TikTok Shop'", () => {
    expect(cat("TikTok Shop Settlement Payment")).toBe("ecommerce");
  });
});

describe("Category detection — internal_transfer (kas besar)", () => {
  it("detects 'kas besar'", () => {
    expect(cat("Transfer ke Kas Besar Cabang Utama")).toBe("internal_transfer");
  });
  it("detects 'petty cash'", () => {
    expect(cat("Petty Cash Replenishment Juli")).toBe("internal_transfer");
  });
  it("detects 'pemindahan dana'", () => {
    expect(cat("Pemindahan Dana Antar Rekening Internal")).toBe("internal_transfer");
  });
  it("detects 'transfer internal'", () => {
    expect(cat("Transfer Internal Kas Perusahaan")).toBe("internal_transfer");
  });
  it("detects 'antar rekening'", () => {
    expect(cat("Transfer Antar Rekening BNI ke Mandiri")).toBe("internal_transfer");
  });
});

describe("Category detection — bank_fee", () => {
  it("detects 'biaya transfer'", () => {
    expect(cat("BIAYA TRANSFER RTGS Rp 30.000")).toBe("bank_fee");
  });
  it("detects 'biaya administrasi'", () => {
    expect(cat("Biaya Administrasi Bank Bulanan")).toBe("bank_fee");
  });
  it("detects 'provisi'", () => {
    expect(cat("Provisi kredit investasi")).toBe("bank_fee");
  });
  it("detects 'materai'", () => {
    expect(cat("Bea Materai transaksi Rp 10.000")).toBe("bank_fee");
  });
  it("detects 'fee kliring'", () => {
    expect(cat("Fee Kliring Cek Giro")).toBe("bank_fee");
  });
});

describe("Category detection — marketplace_settlement", () => {
  it("detects 'dompet anak bangsa' (GoPay)", () => {
    expect(cat("DOMPET ANAK BANGSA PT TRANSFER")).toBe("marketplace_settlement");
  });
  it("detects 'OVO'", () => {
    expect(cat("OVO MERCHANT SETTLEMENT HARIAN")).toBe("marketplace_settlement");
  });
  it("detects 'DANA'", () => {
    expect(cat("DANA Merchant Disbursement")).toBe("marketplace_settlement");
  });
  it("detects 'QRIS'", () => {
    expect(cat("QRIS Settlement BNI Merchant")).toBe("marketplace_settlement");
  });
});

describe("Category detection — unknown fallback", () => {
  it("returns unknown for generic text", () => {
    expect(cat("SETORAN TUNAI COUNTER")).toBe("unknown");
  });
  it("returns unknown for whitespace-only", () => {
    expect(cat("   ")).toBe("unknown");
  });
  it("returns unknown for empty string", () => {
    expect(cat("")).toBe("unknown");
  });
});

// ─── 2. Confidence levels ─────────────────────────────────────────────────────

describe("Confidence levels", () => {
  it("konsesi has confidence ≥ 90", () => {
    expect(conf("Biaya konsesi Rp 5.000.000")).toBeGreaterThanOrEqual(90);
  });
  it("PLN has confidence ≥ 88", () => {
    expect(conf("Token PLN prabayar 200rb")).toBeGreaterThanOrEqual(88);
  });
  it("ecommerce has confidence ≥ 88", () => {
    expect(conf("SHOPEE DISBURSEMENT")).toBeGreaterThanOrEqual(88);
  });
  it("internal_transfer has confidence ≥ 88", () => {
    expect(conf("transfer kas besar cabang semarang")).toBeGreaterThanOrEqual(88);
  });
  it("bank_fee has confidence ≥ 85", () => {
    expect(conf("biaya admin bank bulanan")).toBeGreaterThanOrEqual(85);
  });
  it("unknown has confidence 0", () => {
    expect(conf("SESUATU YANG TIDAK DIKENAL XYZ123")).toBe(0);
  });
});

// ─── 3. isInternalTransfer flag ────────────────────────────────────────────────

describe("isInternalTransfer flag", () => {
  it("kas besar → isInternalTransfer=true", () => {
    expect(normalizeDescription("Transfer ke Kas Besar").isInternalTransfer).toBe(true);
  });
  it("petty cash → isInternalTransfer=true", () => {
    expect(normalizeDescription("Petty Cash Top Up").isInternalTransfer).toBe(true);
  });
  it("PLN payment → isInternalTransfer=false", () => {
    expect(normalizeDescription("Bayar PLN token listrik").isInternalTransfer).toBe(false);
  });
  it("shopee settlement → isInternalTransfer=false", () => {
    expect(normalizeDescription("SHOPEE SELLER SETTLEMENT").isInternalTransfer).toBe(false);
  });
  it("metadata contains transfer_type=internal for internal transfer", () => {
    expect(normalizeDescription("Pemindahan Dana kas besar").metadata["transfer_type"]).toBe("internal");
  });
});

// ─── 4. isBankFee + feeType ────────────────────────────────────────────────────

describe("isBankFee and feeType detection", () => {
  it("isBankFee=true for biaya transfer", () => {
    expect(normalizeDescription("BIAYA TRANSFER RTGS 30000").isBankFee).toBe(true);
  });
  it("feeType=transfer for biaya transfer", () => {
    expect(normalizeDescription("Biaya Transfer Rekening").feeType).toBe("transfer");
  });
  it("feeType=admin for biaya admin", () => {
    expect(normalizeDescription("Biaya Administrasi Bank").feeType).toBe("admin");
  });
  it("feeType=kliring for fee kliring", () => {
    expect(normalizeDescription("Fee Kliring Cek Giro").feeType).toBe("kliring");
  });
  it("feeType=provisi for provisi kredit", () => {
    expect(normalizeDescription("Provisi Kredit Modal Kerja").feeType).toBe("provisi");
  });
  it("feeType=materai for bea materai", () => {
    expect(normalizeDescription("Bea Materai Akta Notaris").feeType).toBe("materai");
  });
  it("metadata.fee_type is set for bank fees", () => {
    expect(normalizeDescription("Biaya Admin Bank Mandiri").metadata["fee_type"]).toBeTruthy();
  });
  it("isBankFee=false for PLN", () => {
    expect(normalizeDescription("Bayar PLN token listrik").isBankFee).toBe(false);
  });
});

// ─── 5. Provider extraction ───────────────────────────────────────────────────

describe("Provider extraction", () => {
  it("PLN detected as provider for electricity", () => {
    expect(normalizeDescription("Token PLN Prabayar").provider).toBe("PLN");
  });
  it("PDAM detected as provider for water", () => {
    expect(normalizeDescription("Tagihan PDAM Tirta").provider).toBe("PDAM");
  });
  it("no provider for unknown", () => {
    expect(normalizeDescription("TRANSFER BIASA").provider).toBeUndefined();
  });
});

// ─── 6. Output structure integrity ───────────────────────────────────────────

describe("Output structure integrity", () => {
  it("result always has required fields", () => {
    const r: NormalizationResult = normalizeDescription("Bayar PLN Listrik");
    expect(typeof r.raw).toBe("string");
    expect(typeof r.normalized).toBe("string");
    expect(Array.isArray(r.tokens)).toBe(true);
    expect(typeof r.category).toBe("string");
    expect(typeof r.confidence).toBe("number");
    expect(typeof r.isInternalTransfer).toBe("boolean");
    expect(typeof r.isBankFee).toBe("boolean");
    expect(typeof r.metadata).toBe("object");
  });

  it("normalized is lowercase", () => {
    const r = normalizeDescription("BIAYA TRANSFER RTGS");
    expect(r.normalized).toBe(r.normalized.toLowerCase());
  });

  it("tokens contain only words ≥ 3 chars", () => {
    const r = normalizeDescription("Biaya Transfer Antar Rekening Bank");
    expect(r.tokens.every(t => t.length >= 3)).toBe(true);
  });

  it("raw is preserved exactly", () => {
    const raw = "BIAYA KONSESI AREA B-12 / Rp.5.000.000";
    expect(normalizeDescription(raw).raw).toBe(raw);
  });
});

// ─── 7. Batch helper ─────────────────────────────────────────────────────────

describe("normalizeDescriptions (batch)", () => {
  it("returns array of same length as input", () => {
    const results = normalizeDescriptions(["Bayar PLN", "SHOPEE SETTLEMENT", "Transfer kas besar"]);
    expect(results).toHaveLength(3);
  });

  it("each result has correct category", () => {
    const results = normalizeDescriptions(["Bayar PLN", "SHOPEE SETTLEMENT", "Transfer kas besar"]);
    expect(results[0].category).toBe("utility_electricity");
    expect(results[1].category).toBe("ecommerce");
    expect(results[2].category).toBe("internal_transfer");
  });

  it("empty array returns empty array", () => {
    expect(normalizeDescriptions([])).toHaveLength(0);
  });
});

// ─── 8. Edge cases ────────────────────────────────────────────────────────────

describe("Edge cases", () => {
  it("special chars return unknown with confidence 0", () => {
    const r = normalizeDescription("!@#$%^&*()");
    expect(r.category).toBe("unknown");
    expect(r.confidence).toBe(0);
  });

  it("very long description is handled", () => {
    const r = normalizeDescription("BIAYA KONSESI ".repeat(100));
    expect(r.category).toBe("concession");
  });

  it("mixed-case PLN detected", () => {
    expect(cat("bayar PLN prepaid token")).toBe("utility_electricity");
  });

  it("internal_transfer takes priority over bank_fee when both keywords present", () => {
    // "kas besar" (internal_transfer) is listed before "biaya transfer" (bank_fee) in CATEGORY_RULES
    expect(cat("Biaya transfer kas besar")).toBe("internal_transfer");
  });
});
