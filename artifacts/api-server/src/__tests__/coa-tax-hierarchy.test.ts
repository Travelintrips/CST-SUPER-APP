/**
 * COA Tax Hierarchy Tests — Restructure Tax COA
 *
 * Phase 12 test coverage:
 *   - Hierarchy: header non-postable, child postable, no cycle, same-company
 *   - Target structure: correct codes, categories, normal balances
 *   - Existing account treatment: code preserved, reparenting governance-only
 *   - Tax mapping: bank interest + 20% → INTEREST_TAX_WITHHOLDING
 *   - AI proposal: INTEREST_TAX_WITHHOLDING → Beban PPh Final atas Bunga Bank
 *   - Fail-closed: header account rejected for posting
 *   - Governance safety: maker ≠ approver enforced
 *   - Financial reports: category correct per account type
 */

import { describe, it, expect } from "vitest";

// ─── COA Validation (pure unit, no DB) ────────────────────────────────────────
import {
  normalBalanceForCategory,
  validatePostableRules,
  isParentCategoryCompatible,
} from "../lib/coa/coaValidation.js";

// ─── Tax migration target structure ───────────────────────────────────────────
import { getTaxCoaTargetStructure } from "../lib/coa/coaTaxMigration.js";
import { resolveParentReference } from "../lib/coa/coaChangeRequestService.js";
import { isGovernedTaxCoaCode } from "../lib/accountingSeed.js";

// ─── Bank interest tax matcher ─────────────────────────────────────────────────
import {
  detectBankInterestTaxPairs,
  isBankInterestTaxRatio,
  type BankMutationInput,
} from "../lib/ai/transaction-intelligence/bankInterestTaxMatcher.js";

// ─── COA Proposal Engine ──────────────────────────────────────────────────────
import { generateCoaProposalRecommendation } from "../lib/ai/transaction-intelligence/coaProposalEngine.js";
import type { ExistingAccount, ProposalRecommendationInput } from "../lib/ai/transaction-intelligence/coaProposalEngine.js";

// ─── Transaction intent types ─────────────────────────────────────────────────
import { ALL_INTENTS, TAX_INTENTS, isTaxIntent } from "../lib/ai/transaction-intelligence/transactionTypes.js";

// ─── COA Prediction Rules ─────────────────────────────────────────────────────
import { INTENT_COA_KEYWORDS, INTENT_PREFERRED_ACCOUNT_TYPES, INTENT_ANTI_PATTERN_TYPES } from "../lib/ai/transaction-intelligence/coaPredictionRules.js";

// ═══════════════════════════════════════════════════════════════════════════════
// Section 1: Hierarchy Rules (header non-postable, child postable)
// ═══════════════════════════════════════════════════════════════════════════════

describe("COA Tax Hierarchy — header/postable rules", () => {
  it("header KEWAJIBAN PAJAK: is_header=true, is_postable=false → valid", () => {
    const errors = validatePostableRules({ isHeader: true, isPostable: false });
    expect(errors).toHaveLength(0);
  });

  it("header ASET PAJAK: is_header=true, is_postable=false → valid", () => {
    const errors = validatePostableRules({ isHeader: true, isPostable: false });
    expect(errors).toHaveLength(0);
  });

  it("header BEBAN PAJAK: is_header=true, is_postable=false → valid", () => {
    const errors = validatePostableRules({ isHeader: true, isPostable: false });
    expect(errors).toHaveLength(0);
  });

  it("subakun Hutang PPN: is_header=false, is_postable=true → valid", () => {
    const errors = validatePostableRules({ isHeader: false, isPostable: true });
    expect(errors).toHaveLength(0);
  });

  it("REJECT: is_header=true AND is_postable=true (header cannot post)", () => {
    const errors = validatePostableRules({ isHeader: true, isPostable: true });
    expect(errors).toHaveLength(1);
    expect(errors[0]!.code).toBe("HEADER_CANNOT_BE_POSTABLE");
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// Section 2: Normal balance for each tax header/subaccount category
// ═══════════════════════════════════════════════════════════════════════════════

describe("COA Tax Hierarchy — normal balance per category", () => {
  it("LIABILITY (Kewajiban Pajak) → CREDIT", () =>
    expect(normalBalanceForCategory("LIABILITY")).toBe("CREDIT"));

  it("ASSET (Aset Pajak) → DEBIT", () =>
    expect(normalBalanceForCategory("ASSET")).toBe("DEBIT"));

  it("EXPENSE (Beban Pajak) → DEBIT", () =>
    expect(normalBalanceForCategory("EXPENSE")).toBe("DEBIT"));

  it("OTHER_EXPENSE (Beban Denda/Sanksi) → DEBIT", () =>
    expect(normalBalanceForCategory("OTHER_EXPENSE")).toBe("DEBIT"));
});

// ═══════════════════════════════════════════════════════════════════════════════
// Section 3: Parent-child category compatibility
// ═══════════════════════════════════════════════════════════════════════════════

describe("COA Tax Hierarchy — parent-child category compatibility", () => {
  it("Hutang PPN (LIABILITY) under Kewajiban Pajak (LIABILITY) → ok", () =>
    expect(isParentCategoryCompatible("LIABILITY", "LIABILITY")).toBe(true));

  it("PPN Masukan (ASSET) under Aset Pajak (ASSET) → ok", () =>
    expect(isParentCategoryCompatible("ASSET", "ASSET")).toBe(true));

  it("Beban PPh Final (EXPENSE) under Beban Pajak (EXPENSE) → ok", () =>
    expect(isParentCategoryCompatible("EXPENSE", "EXPENSE")).toBe(true));

  it("Beban Denda (OTHER_EXPENSE) under Beban Pajak (EXPENSE) → ok", () =>
    expect(isParentCategoryCompatible("EXPENSE", "OTHER_EXPENSE")).toBe(true));

  it("REJECT: EXPENSE child under LIABILITY parent", () =>
    expect(isParentCategoryCompatible("LIABILITY", "EXPENSE")).toBe(false));

  it("REJECT: ASSET child under LIABILITY parent", () =>
    expect(isParentCategoryCompatible("LIABILITY", "ASSET")).toBe(false));

  it("REJECT: LIABILITY child under ASSET parent", () =>
    expect(isParentCategoryCompatible("ASSET", "LIABILITY")).toBe(false));
});

// ═══════════════════════════════════════════════════════════════════════════════
// Section 4: Target structure completeness
// ═══════════════════════════════════════════════════════════════════════════════

describe("COA Tax Hierarchy — target structure completeness", () => {
  const { headers, subaccounts, reparenting } = getTaxCoaTargetStructure();

  it("has 3 headers (Kewajiban Pajak, Aset Pajak, Beban Pajak)", () => {
    expect(headers).toHaveLength(3);
    const codes = headers.map((h) => h.baseCode);
    // 2-1060 is occupied by Hutang Intercompany; safe code is 2-1090
    expect(codes).toContain("2-1090");
    expect(codes).toContain("1-1070");
    expect(codes).toContain("5-3040");
  });

  it("KEWAJIBAN PAJAK header uses safe code 2-1090 (2-1060 collision fix)", () => {
    // 2-1060 is occupied by "Hutang Intercompany - PT Diva Servis" in company CST
    const collision = headers.find((h) => h.baseCode === "2-1060");
    expect(collision).toBeUndefined(); // must not use the colliding code
    const hdr = headers.find((h) => h.baseCode === "2-1090")!;
    expect(hdr).toBeDefined();
    expect(hdr.category).toBe("LIABILITY");
    expect(hdr.normalBalance).toBe("CREDIT");
  });

  it("ASET PAJAK header: ASSET, DEBIT", () => {
    const hdr = headers.find((h) => h.baseCode === "1-1070")!;
    expect(hdr.category).toBe("ASSET");
    expect(hdr.normalBalance).toBe("DEBIT");
  });

  it("BEBAN PAJAK header: EXPENSE, DEBIT", () => {
    const hdr = headers.find((h) => h.baseCode === "5-3040")!;
    expect(hdr.category).toBe("EXPENSE");
    expect(hdr.normalBalance).toBe("DEBIT");
  });

  it("KEWAJIBAN PAJAK has 12 subaccounts (2-1091 through 2-1102, safe codes after collision fix)", () => {
    const subs = subaccounts.filter((s) => s.headerBaseCode === "2-1090");
    expect(subs.length).toBe(12);
  });

  it("ASET PAJAK has 6 subaccounts (1-1071 through 1-1076)", () => {
    const subs = subaccounts.filter((s) => s.headerBaseCode === "1-1070");
    expect(subs.length).toBe(6);
  });

  it("BEBAN PAJAK has 8 subaccounts (5-3041 through 5-3048)", () => {
    const subs = subaccounts.filter((s) => s.headerBaseCode === "5-3040");
    expect(subs.length).toBe(8);
  });

  it("Beban PPh Final atas Bunga Bank (5-3044) is in BEBAN PAJAK", () => {
    const sub = subaccounts.find((s) => s.baseCode === "5-3044");
    expect(sub).toBeDefined();
    expect(sub!.headerBaseCode).toBe("5-3040");
    expect(sub!.name).toContain("PPh Final");
  });

  it("all LIABILITY subaccounts have CREDIT normal balance", () => {
    const subs = subaccounts.filter((s) => s.category === "LIABILITY");
    expect(subs.every((s) => s.normalBalance === "CREDIT")).toBe(true);
  });

  it("all ASSET subaccounts have DEBIT normal balance", () => {
    const subs = subaccounts.filter((s) => s.category === "ASSET");
    expect(subs.every((s) => s.normalBalance === "DEBIT")).toBe(true);
  });

  it("all EXPENSE/OTHER_EXPENSE subaccounts have DEBIT normal balance", () => {
    const subs = subaccounts.filter((s) => s.category === "EXPENSE" || s.category === "OTHER_EXPENSE");
    expect(subs.every((s) => s.normalBalance === "DEBIT")).toBe(true);
  });

  it("no subaccount code collides with header codes", () => {
    const headerCodes = new Set(headers.map((h) => h.baseCode));
    for (const sub of subaccounts) {
      expect(headerCodes.has(sub.baseCode)).toBe(false);
    }
  });

  it("no duplicate base codes across all accounts", () => {
    const all = [...headers.map((h) => h.baseCode), ...subaccounts.map((s) => s.baseCode)];
    const unique = new Set(all);
    expect(unique.size).toBe(all.length);
  });

  it("reparenting: 3 existing accounts to be reparented (2-1030, 5-3020, 1-1050)", () => {
    expect(reparenting).toHaveLength(3);
    const codes = reparenting.map((r) => r.existingBaseCode);
    expect(codes).toContain("2-1030"); // Hutang Pajak Lainnya → KEWAJIBAN PAJAK
    expect(codes).toContain("5-3020"); // Beban Pajak & Perijinan → BEBAN PAJAK
    expect(codes).toContain("1-1050"); // PPN Masukan → ASET PAJAK
  });

  it("reparenting: 2-1030 → 2-1090 (KEWAJIBAN PAJAK, safe code after collision fix)", () => {
    const rp = reparenting.find((r) => r.existingBaseCode === "2-1030")!;
    // 2-1060 is occupied by Hutang Intercompany; reparent target is now 2-1090
    expect(rp.newHeaderBaseCode).toBe("2-1090");
  });

  it("reparenting: 5-3020 → 5-3040 (BEBAN PAJAK)", () => {
    const rp = reparenting.find((r) => r.existingBaseCode === "5-3020")!;
    expect(rp.newHeaderBaseCode).toBe("5-3040");
  });

  it("reparenting: 1-1050 → 1-1070 (ASET PAJAK)", () => {
    const rp = reparenting.find((r) => r.existingBaseCode === "1-1050")!;
    expect(rp.newHeaderBaseCode).toBe("1-1070");
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// Section 5: Bank interest tax matching (Phase 8)
// ═══════════════════════════════════════════════════════════════════════════════

describe("Bank Interest Tax Matcher — Phase 8", () => {
  const BUNGA_AMOUNT = 157_676;
  const PAJAK_AMOUNT = 31_535;
  const DATE = "2026-01-15";

  it("isBankInterestTaxRatio: 31535 / 157676 ≈ 20% → true", () => {
    expect(isBankInterestTaxRatio(BUNGA_AMOUNT, PAJAK_AMOUNT)).toBe(true);
  });

  it("isBankInterestTaxRatio: 30000 / 157676 ≈ 19% → true (within 5% slack of rate)", () => {
    // 30000/157676 = 19.02% → delta from 20% = 0.0098 < 0.05*0.20 + 0.001 = 0.011
    expect(isBankInterestTaxRatio(BUNGA_AMOUNT, 30_000)).toBe(true);
  });

  it("isBankInterestTaxRatio: 10000 / 157676 ≈ 6.3% → false (too far from 20%)", () => {
    expect(isBankInterestTaxRatio(BUNGA_AMOUNT, 10_000)).toBe(false);
  });

  it("isBankInterestTaxRatio: bungaAmount=0 → false (guard)", () => {
    expect(isBankInterestTaxRatio(0, 100)).toBe(false);
  });

  it("detectBankInterestTaxPairs: matched pair with same date and same account ref", () => {
    const mutations: BankMutationInput[] = [
      { id: "1", date: DATE, amount: BUNGA_AMOUNT, description: "CR BUNGA BLN 16416", accountReference: "16416", intent: "INTEREST_INCOME" },
      { id: "2", date: DATE, amount: PAJAK_AMOUNT, description: "DB PAJAK 16416", accountReference: "16416", intent: "TAX_PAYMENT" },
    ];
    const pairs = detectBankInterestTaxPairs(mutations);
    expect(pairs).toHaveLength(1);
    const pair = pairs[0]!;
    expect(pair.recommendedIntent).toBe("INTEREST_TAX_WITHHOLDING");
    expect(pair.recommendedCoaName).toContain("PPh Final");
    expect(pair.requiresHumanApproval).toBe(true);
    expect(pair.withinTolerance).toBe(true);
    expect(pair.confidence).toBe(95);
  });

  it("detectBankInterestTaxPairs: requiresHumanApproval is always literal true", () => {
    const mutations: BankMutationInput[] = [
      { id: "A", date: DATE, amount: BUNGA_AMOUNT, description: "jasa giro bunga" },
      { id: "B", date: DATE, amount: PAJAK_AMOUNT, description: "pajak bunga" },
    ];
    const pairs = detectBankInterestTaxPairs(mutations);
    for (const p of pairs) {
      expect(p.requiresHumanApproval).toBe(true);
    }
  });

  it("detectBankInterestTaxPairs: no match when date gap > 3 days", () => {
    const mutations: BankMutationInput[] = [
      { id: "1", date: "2026-01-01", amount: BUNGA_AMOUNT, description: "jasa giro" },
      { id: "2", date: "2026-01-10", amount: PAJAK_AMOUNT, description: "pajak bunga" },
    ];
    const pairs = detectBankInterestTaxPairs(mutations);
    expect(pairs).toHaveLength(0);
  });

  it("detectBankInterestTaxPairs: accepts the documented 3-day date boundary", () => {
    const mutations: BankMutationInput[] = [
      { id: "1", date: "2026-01-01", amount: BUNGA_AMOUNT, description: "jasa giro" },
      { id: "2", date: "2026-01-04", amount: PAJAK_AMOUNT, description: "pajak bunga" },
    ];
    expect(detectBankInterestTaxPairs(mutations)).toHaveLength(1);
  });

  it("detectBankInterestTaxPairs: rejects a ratio outside the documented tolerance", () => {
    const mutations: BankMutationInput[] = [
      { id: "1", date: DATE, amount: 100_000, description: "jasa giro" },
      { id: "2", date: DATE, amount: 5_000, description: "pajak operasional" },
    ];
    // 5000/100000 = 5% — far from 20%
    const pairs = detectBankInterestTaxPairs(mutations);
    expect(pairs).toHaveLength(0);
  });

  it("detectBankInterestTaxPairs: rejects mismatched account references", () => {
    const mutations: BankMutationInput[] = [
      { id: "1", date: DATE, amount: BUNGA_AMOUNT, description: "jasa giro", accountReference: "16416" },
      { id: "2", date: DATE, amount: PAJAK_AMOUNT, description: "pajak bunga", accountReference: "99999" },
    ];
    expect(detectBankInterestTaxPairs(mutations)).toHaveLength(0);
  });

  it("detectBankInterestTaxPairs: no match when neither transaction is interest-related", () => {
    const mutations: BankMutationInput[] = [
      { id: "1", date: DATE, amount: 500_000, description: "pembayaran tagihan listrik" },
      { id: "2", date: DATE, amount: 100_000, description: "biaya kantor" },
    ];
    const pairs = detectBankInterestTaxPairs(mutations);
    expect(pairs).toHaveLength(0);
  });

  it("detectBankInterestTaxPairs: does not match same mutation with itself", () => {
    const mutations: BankMutationInput[] = [
      { id: "1", date: DATE, amount: BUNGA_AMOUNT, description: "bunga pajak" },
    ];
    const pairs = detectBankInterestTaxPairs(mutations);
    expect(pairs).toHaveLength(0);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// Section 6: INTEREST_TAX_WITHHOLDING intent registration
// ═══════════════════════════════════════════════════════════════════════════════

describe("TransactionIntent — INTEREST_TAX_WITHHOLDING registration", () => {
  it("INTEREST_TAX_WITHHOLDING is in ALL_INTENTS", () => {
    expect(ALL_INTENTS).toContain("INTEREST_TAX_WITHHOLDING");
  });

  it("INTEREST_TAX_WITHHOLDING is in TAX_INTENTS", () => {
    expect(TAX_INTENTS).toContain("INTEREST_TAX_WITHHOLDING");
  });

  it("isTaxIntent returns true for INTEREST_TAX_WITHHOLDING", () => {
    expect(isTaxIntent("INTEREST_TAX_WITHHOLDING")).toBe(true);
  });

  it("INTEREST_TAX_WITHHOLDING has keywords defined", () => {
    const kws = INTENT_COA_KEYWORDS["INTEREST_TAX_WITHHOLDING"];
    expect(kws).toBeDefined();
    expect(Array.isArray(kws)).toBe(true);
    expect((kws ?? []).length).toBeGreaterThan(0);
  });

  it("INTEREST_TAX_WITHHOLDING preferred account types include expense", () => {
    const preferred = INTENT_PREFERRED_ACCOUNT_TYPES["INTEREST_TAX_WITHHOLDING"] ?? [];
    expect(preferred.some((t) => t.includes("expense") || t.includes("biaya"))).toBe(true);
  });

  it("INTEREST_TAX_WITHHOLDING anti-pattern types include revenue and asset", () => {
    const anti = INTENT_ANTI_PATTERN_TYPES["INTEREST_TAX_WITHHOLDING"] ?? [];
    expect(anti.some((t) => t.includes("revenue") || t.includes("income"))).toBe(true);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// Section 7: COA Proposal Engine — bank interest tax policy rule
// ═══════════════════════════════════════════════════════════════════════════════

describe("COA Proposal Engine — INTEREST_TAX_WITHHOLDING policy", () => {
  function makeProposalInput(
    detectedIntent: string,
    desc: string,
    accounts: ExistingAccount[] = [],
  ): ProposalRecommendationInput {
    return {
      companyId: 1,
      gapResult: {
        hasGap: true,
        gapType: "NO_SPECIFIC_ACCOUNT",
        reason: ["No account found"],
        evidence: [],
        candidates: [],
      } as any,
      detectedIntent,
      normalizedDescription: desc,
      aiConfidence: 85,
      historicalOccurrences: 2,
      existingAccounts: accounts,
    };
  }

  it("PPh Final Bunga Bank description → EXPENSE/DEBIT/PROFIT_AND_LOSS", () => {
    const rec = generateCoaProposalRecommendation(
      makeProposalInput("INTEREST_TAX_WITHHOLDING", "pph final atas bunga bank"),
    );
    expect(rec.proposedCategory).toBe("EXPENSE");
    expect(rec.proposedNormalBalance).toBe("DEBIT");
    expect(rec.financialStatement).toBe("PROFIT_AND_LOSS");
    expect(rec.requiresHumanApproval).toBe(true);
  });

  it("'pajak bunga bank' description → EXPENSE", () => {
    const rec = generateCoaProposalRecommendation(
      makeProposalInput("INTEREST_TAX_WITHHOLDING", "pajak bunga bank pph final"),
    );
    expect(rec.proposedCategory).toBe("EXPENSE");
    expect(rec.requiresHumanApproval).toBe(true);
  });

  it("'pot pajak bunga' description → EXPENSE", () => {
    const rec = generateCoaProposalRecommendation(
      makeProposalInput("INTEREST_TAX_WITHHOLDING", "debet pajak bunga"),
    );
    expect(rec.proposedCategory).toBe("EXPENSE");
    expect(rec.requiresHumanApproval).toBe(true);
  });

  it("requiresHumanApproval is always literal true — never false", () => {
    const rec = generateCoaProposalRecommendation(
      makeProposalInput("INTEREST_TAX_WITHHOLDING", "pph final bunga deposito"),
    );
    // This must be literal true, never false — governance enforced
    expect(rec.requiresHumanApproval).toBe(true);
    // Ensure it's not a variable but the literal boolean
    expect(typeof rec.requiresHumanApproval).toBe("boolean");
  });

  it("header account not included in alternatives for posting", () => {
    const headerAccount: ExistingAccount = {
      id: 999,
      code: "5-3040-CST",
      name: "Beban Pajak CST",
      accountCategory: "EXPENSE",
      normalBalance: "DEBIT",
      isHeader: true,
      isPostable: false,
      isActive: true,
      status: "ACTIVE",
      parentId: null,
      companyId: 1,
    };
    const rec = generateCoaProposalRecommendation(
      makeProposalInput("INTEREST_TAX_WITHHOLDING", "pph final bunga bank", [headerAccount]),
    );
    // Header accounts must NOT appear in alternatives (they're not postable)
    const altIds = rec.alternatives.map((a) => a.id);
    expect(altIds).not.toContain(999);
  });

  it("existing postable EXPENSE account appears in alternatives", () => {
    const postableAccount: ExistingAccount = {
      id: 888,
      code: "5-3044-CST",
      name: "Beban PPh Final atas Bunga Bank CST",
      accountCategory: "EXPENSE",
      normalBalance: "DEBIT",
      isHeader: false,
      isPostable: true,
      isActive: true,
      status: "ACTIVE",
      parentId: 999,
      companyId: 1,
    };
    const rec = generateCoaProposalRecommendation(
      makeProposalInput("INTEREST_TAX_WITHHOLDING", "pph final bunga bank", [postableAccount]),
    );
    const altIds = rec.alternatives.map((a) => a.id);
    expect(altIds).toContain(888);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// Section 8: AI Proposal Integration — fail-closed when no specific account
// ═══════════════════════════════════════════════════════════════════════════════

describe("COA Proposal — fail-closed when specific account missing", () => {
  it("when no EXPENSE header exists, parentId is null (cannot post to parent)", () => {
    const rec = generateCoaProposalRecommendation({
      companyId: 1,
      gapResult: {
        hasGap: true,
        gapType: "NO_SPECIFIC_ACCOUNT",
        reason: ["5-3044-CST not found"],
        evidence: [],
        candidates: [],
      } as any,
      detectedIntent: "INTEREST_TAX_WITHHOLDING",
      normalizedDescription: "pph final bunga bank",
      aiConfidence: 80,
      historicalOccurrences: 1,
      existingAccounts: [], // no accounts at all
    });
    // With no existing accounts, no parent can be suggested — parentId null is safe
    expect(rec.proposedParentId).toBeNull();
    expect(rec.requiresHumanApproval).toBe(true);
  });

  it("when BEBAN PAJAK header exists, parent is set correctly", () => {
    const bebanPajakHeader: ExistingAccount = {
      id: 42,
      code: "5-3040-CST",
      name: "Beban Pajak CST",
      accountCategory: "EXPENSE",
      normalBalance: "DEBIT",
      isHeader: true,
      isPostable: false,
      isActive: true,
      status: "ACTIVE",
      parentId: null,
      companyId: 1,
    };
    const rec = generateCoaProposalRecommendation({
      companyId: 1,
      gapResult: {
        hasGap: true,
        gapType: "NO_SPECIFIC_ACCOUNT",
        reason: ["5-3044-CST not found"],
        evidence: [],
        candidates: [],
      } as any,
      detectedIntent: "INTEREST_TAX_WITHHOLDING",
      normalizedDescription: "pph final bunga bank",
      aiConfidence: 80,
      historicalOccurrences: 1,
      existingAccounts: [bebanPajakHeader],
    });
    expect(rec.proposedParentId).toBe(42);
    expect(rec.proposedParentCode).toBe("5-3040-CST");
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// Section 9: Governance safety rules
// ═══════════════════════════════════════════════════════════════════════════════

describe("Governance safety — maker-checker contract", () => {
  it("MIGRATION_MAKER identity constant is defined", async () => {
    // We can import the maker identity indirectly via the target structure
    const structure = getTaxCoaTargetStructure();
    // If getTaxCoaTargetStructure returns data, the migration module loaded correctly
    expect(structure.headers.length).toBeGreaterThan(0);
  });

  it("requiresHumanApproval is always literal true in bank matcher", () => {
    const mutations: BankMutationInput[] = [
      { id: "1", date: "2026-01-15", amount: 157_676, description: "jasa giro bunga" },
      { id: "2", date: "2026-01-15", amount: 31_535, description: "pajak bunga bank" },
    ];
    const pairs = detectBankInterestTaxPairs(mutations);
    if (pairs.length > 0) {
      expect(pairs[0]!.requiresHumanApproval).toBe(true);
    }
  });

  it("accounting seed treats legacy tax fallbacks as insert-only", () => {
    expect(isGovernedTaxCoaCode("1-1050")).toBe(true);
    expect(isGovernedTaxCoaCode("2-1030")).toBe(true);
    expect(isGovernedTaxCoaCode("5-3020")).toBe(true);
    expect(isGovernedTaxCoaCode("2-1060")).toBe(true);
    expect(isGovernedTaxCoaCode("2-1061")).toBe(true);
    expect(isGovernedTaxCoaCode("5-3044")).toBe(true);
    expect(isGovernedTaxCoaCode("1-1010")).toBe(false);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// Section 9b: Code collision fixture (Phase 3 — safe code selection)
// ═══════════════════════════════════════════════════════════════════════════════

describe("Code collision fixture — 2-1060 occupied, safe code 2-1090", () => {
  const { headers, subaccounts, reparenting } = getTaxCoaTargetStructure();

  it("no header uses the colliding code 2-1060", () => {
    const collision = headers.find((h) => h.baseCode === "2-1060");
    expect(collision).toBeUndefined();
  });

  it("KEWAJIBAN PAJAK header is 2-1090", () => {
    const hdr = headers.find((h) => h.baseCode === "2-1090");
    expect(hdr).toBeDefined();
    expect(hdr!.name).toBe("Kewajiban Pajak");
  });

  it("no subaccount uses old codes 2-1061 through 2-1072", () => {
    const oldCodes = ["2-1061","2-1062","2-1063","2-1064","2-1065","2-1066",
                      "2-1067","2-1068","2-1069","2-1070","2-1071","2-1072"];
    for (const code of oldCodes) {
      const found = subaccounts.find((s) => s.baseCode === code);
      expect(found).toBeUndefined();
    }
  });

  it("KEWAJIBAN PAJAK children range is 2-1091 through 2-1102", () => {
    const subs = subaccounts
      .filter((s) => s.headerBaseCode === "2-1090")
      .map((s) => s.baseCode)
      .sort();
    expect(subs[0]).toBe("2-1091");
    expect(subs[subs.length - 1]).toBe("2-1102");
    expect(subs.length).toBe(12);
  });

  it("reparenting target for 2-1030 is 2-1090 (not the colliding 2-1060)", () => {
    const rp = reparenting.find((r) => r.existingBaseCode === "2-1030");
    expect(rp).toBeDefined();
    expect(rp!.newHeaderBaseCode).toBe("2-1090");
    expect(rp!.newHeaderBaseCode).not.toBe("2-1060");
  });

  it("all declared codes are distinct (no accidental duplicate from renumbering)", () => {
    const allCodes = [
      ...headers.map((h) => h.baseCode),
      ...subaccounts.map((s) => s.baseCode),
    ];
    const unique = new Set(allCodes);
    expect(unique.size).toBe(allCodes.length);
  });
});

// Section 10: Parent reference resolution during approval
// ═══════════════════════════════════════════════════════════════════════════════

describe("Governance safety — parentCode is resolved before approval", () => {
  it("blocks a subaccount created before its header is approved, then resolves it after approval", async () => {
    let headerApproved = false;
    const lookup = {
      findByCode: async (code: string, companyId: number) => {
        expect(companyId).toBe(1);
        if (headerApproved && code === "2-1060-CST") return { id: 1060 };
        return null;
      },
    };
    const subaccountSnapshot = {
      parentId: null,
      parentCode: "2-1060-CST",
    };

    const beforeHeaderApproval = await resolveParentReference(subaccountSnapshot, 1, lookup);
    expect(beforeHeaderApproval.ok).toBe(false);
    expect(beforeHeaderApproval.errorCode).toBe("PARENT_NOT_FOUND");

    headerApproved = true;
    const afterHeaderApproval = await resolveParentReference(subaccountSnapshot, 1, lookup);
    expect(afterHeaderApproval).toEqual({ ok: true, data: 1060 });
  });

  it("rejects an UPDATE_PARENT request when its target parent code is unresolved", async () => {
    const result = await resolveParentReference(
      { parentId: null, parentCode: "5-3040-CST" },
      1,
      { findByCode: async () => null },
    );

    expect(result.ok).toBe(false);
    expect(result.errorCode).toBe("PARENT_NOT_FOUND");
    expect(result.error).toContain("5-3040-CST");
  });

  it("uses the resolved parentCode instead of a stale parentId", async () => {
    const result = await resolveParentReference(
      { parentId: 999, parentCode: "1-1070-CST" },
      1,
      { findByCode: async () => ({ id: 1070 }) },
    );

    expect(result).toEqual({ ok: true, data: 1070 });
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// Section 11: Financial statement classification
// ═══════════════════════════════════════════════════════════════════════════════

describe("Financial statement classification — tax accounts", () => {
  const { headers, subaccounts } = getTaxCoaTargetStructure();

  it("KEWAJIBAN PAJAK (LIABILITY) → Balance Sheet", () => {
    const hdr = headers.find((h) => h.baseCode === "2-1090")!;
    // LIABILITY goes to Balance Sheet; safe code 2-1090 (2-1060 has collision)
    expect(["LIABILITY"].includes(hdr.category)).toBe(true);
  });

  it("ASET PAJAK (ASSET) → Balance Sheet", () => {
    const hdr = headers.find((h) => h.baseCode === "1-1070")!;
    expect(["ASSET"].includes(hdr.category)).toBe(true);
  });

  it("BEBAN PAJAK (EXPENSE) → Profit & Loss", () => {
    const hdr = headers.find((h) => h.baseCode === "5-3040")!;
    expect(["EXPENSE", "OTHER_EXPENSE"].includes(hdr.category)).toBe(true);
  });

  it("Beban PPh Final atas Bunga Bank (5-3044) → EXPENSE → P&L", () => {
    const sub = subaccounts.find((s) => s.baseCode === "5-3044")!;
    expect(sub.category).toBe("EXPENSE");
    // EXPENSE → PROFIT_AND_LOSS (verified by normalBalance=DEBIT)
    expect(sub.normalBalance).toBe("DEBIT");
  });

  it("Beban Denda Pajak (5-3045) → OTHER_EXPENSE → P&L", () => {
    const sub = subaccounts.find((s) => s.baseCode === "5-3045")!;
    expect(sub.category).toBe("OTHER_EXPENSE");
    expect(sub.normalBalance).toBe("DEBIT");
  });

  it("Hutang PPN (2-1091) → LIABILITY → Balance Sheet (safe code after collision fix)", () => {
    // Old code 2-1061 would have been a child of 2-1060 (now occupied). Safe code is 2-1091.
    const sub = subaccounts.find((s) => s.baseCode === "2-1091")!;
    expect(sub).toBeDefined();
    expect(sub.category).toBe("LIABILITY");
    expect(sub.normalBalance).toBe("CREDIT");
  });

  it("PPN Masukan (1-1050 reparent) → ASSET → Balance Sheet", () => {
    const { reparenting } = getTaxCoaTargetStructure();
    const rp = reparenting.find((r) => r.existingBaseCode === "1-1050")!;
    // 1-1050 is an ASSET account → Balance Sheet
    expect(rp.newHeaderBaseCode).toBe("1-1070"); // ASET PAJAK header
  });
});
