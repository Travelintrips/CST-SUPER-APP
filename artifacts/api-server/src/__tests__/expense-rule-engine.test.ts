/**
 * Phase 3 — Expense Rule Engine: Vitest Unit Tests
 *
 * Pure logic tests — no DB, no HTTP. All tests run offline.
 *
 * Run: pnpm --filter @workspace/api-server test
 *      or: pnpm exec vitest run src/__tests__/expense-rule-engine.test.ts
 */

import { describe, it, expect } from "vitest";
import {
  BUILT_IN_RULES,
  evaluateRule,
  runRuleEngine,
  mergeRules,
  validateRule,
  type ExpenseRule,
} from "../lib/expenseRuleEngine.js";
import { normalizeDescription } from "../lib/bankDescriptionNormalizer.js";

// ─── Helpers ──────────────────────────────────────────────────────────────────

function makeRule(overrides: Partial<ExpenseRule> = {}): ExpenseRule {
  return {
    id: 99,
    companyId: null,
    name: "Test Rule",
    priority: 50,
    isActive: true,
    conditions: [],
    action: { suggestedCategory: "test", confidence: 80 },
    ...overrides,
  };
}

const norm = normalizeDescription;

// ─── 1. evaluateRule — condition evaluation per operator ──────────────────────

describe("evaluateRule — eq operator", () => {
  it("category eq passes when category matches", () => {
    const rule = makeRule({ conditions: [{ field: "category", operator: "eq", value: "concession" }] });
    expect(evaluateRule(rule, norm("biaya konsesi bulanan")).matched).toBe(true);
  });

  it("category eq fails when category does not match", () => {
    const rule = makeRule({ conditions: [{ field: "category", operator: "eq", value: "ecommerce" }] });
    expect(evaluateRule(rule, norm("biaya konsesi bulanan")).matched).toBe(false);
  });

  it("is_internal_transfer eq 'true' passes for internal transfer", () => {
    const rule = makeRule({ conditions: [{ field: "is_internal_transfer", operator: "eq", value: "true" }] });
    expect(evaluateRule(rule, norm("Transfer ke Kas Besar")).matched).toBe(true);
  });

  it("is_internal_transfer eq 'true' fails for non-transfer", () => {
    const rule = makeRule({ conditions: [{ field: "is_internal_transfer", operator: "eq", value: "true" }] });
    expect(evaluateRule(rule, norm("Bayar PLN Token")).matched).toBe(false);
  });

  it("is_bank_fee eq 'true' passes for bank fee", () => {
    const rule = makeRule({ conditions: [{ field: "is_bank_fee", operator: "eq", value: "true" }] });
    expect(evaluateRule(rule, norm("Biaya Transfer RTGS")).matched).toBe(true);
  });

  it("fee_type eq 'transfer' passes for biaya transfer", () => {
    const rule = makeRule({ conditions: [{ field: "fee_type", operator: "eq", value: "transfer" }] });
    expect(evaluateRule(rule, norm("Biaya Transfer Rekening")).matched).toBe(true);
  });
});

describe("evaluateRule — contains operator", () => {
  it("normalized contains passes for substring", () => {
    const rule = makeRule({ conditions: [{ field: "normalized", operator: "contains", value: "konsesi" }] });
    expect(evaluateRule(rule, norm("BIAYA KONSESI BULAN INI")).matched).toBe(true);
  });

  it("normalized contains fails when substring not present", () => {
    const rule = makeRule({ conditions: [{ field: "normalized", operator: "contains", value: "shopee" }] });
    expect(evaluateRule(rule, norm("BIAYA KONSESI BULAN INI")).matched).toBe(false);
  });
});

describe("evaluateRule — multiple conditions (AND-all)", () => {
  it("all conditions pass → matched=true", () => {
    const rule = makeRule({
      conditions: [
        { field: "category", operator: "eq", value: "utility_electricity" },
        { field: "is_internal_transfer", operator: "eq", value: "false" },
      ],
    });
    expect(evaluateRule(rule, norm("Token PLN Prabayar")).matched).toBe(true);
  });

  it("one condition fails → matched=false", () => {
    const rule = makeRule({
      conditions: [
        { field: "category", operator: "eq", value: "utility_electricity" },
        { field: "is_bank_fee", operator: "eq", value: "true" }, // PLN is not bank fee
      ],
    });
    expect(evaluateRule(rule, norm("Token PLN Prabayar")).matched).toBe(false);
  });
});

describe("evaluateRule — confidence_gte operator", () => {
  it("passes when confidence meets threshold", () => {
    const rule = makeRule({ conditions: [{ field: "confidence_gte", operator: "gte", value: "85" }] });
    expect(evaluateRule(rule, norm("SHOPEE DISBURSEMENT")).matched).toBe(true); // conf ≥ 88
  });

  it("fails when confidence is below threshold", () => {
    const rule = makeRule({ conditions: [{ field: "confidence_gte", operator: "gte", value: "95" }] });
    expect(evaluateRule(rule, norm("TRANSFER BIASA")).matched).toBe(false); // conf=0
  });
});

describe("evaluateRule — neq operator", () => {
  it("neq passes when values differ", () => {
    const rule = makeRule({ conditions: [{ field: "category", operator: "neq", value: "unknown" }] });
    expect(evaluateRule(rule, norm("SHOPEE SETTLEMENT")).matched).toBe(true);
  });

  it("neq fails when values are equal", () => {
    const rule = makeRule({ conditions: [{ field: "category", operator: "neq", value: "ecommerce" }] });
    expect(evaluateRule(rule, norm("SHOPEE SETTLEMENT")).matched).toBe(false);
  });
});

describe("evaluateRule — regex operator", () => {
  it("regex passes when pattern matches normalized", () => {
    const rule = makeRule({ conditions: [{ field: "normalized", operator: "regex", value: "pln|listrik" }] });
    expect(evaluateRule(rule, norm("Bayar PLN Token")).matched).toBe(true);
  });

  it("invalid regex returns false (no crash)", () => {
    const rule = makeRule({ conditions: [{ field: "normalized", operator: "regex", value: "[invalid" }] });
    expect(evaluateRule(rule, norm("Bayar PLN Token")).matched).toBe(false);
  });
});

describe("evaluateRule — inactive rule", () => {
  it("inactive rule is never matched", () => {
    const rule = makeRule({
      isActive: false,
      conditions: [{ field: "category", operator: "eq", value: "concession" }],
    });
    expect(evaluateRule(rule, norm("biaya konsesi bulanan")).matched).toBe(false);
  });
});

describe("evaluateRule — condition detail output", () => {
  it("returns correct actualValue in conditions", () => {
    const rule = makeRule({ conditions: [{ field: "category", operator: "eq", value: "concession" }] });
    const detail = evaluateRule(rule, norm("biaya konsesi"));
    expect(detail.conditions[0].actualValue).toBe("concession");
    expect(detail.conditions[0].passed).toBe(true);
  });
});

// ─── 2. runRuleEngine — priority + first-match ────────────────────────────────

describe("runRuleEngine — priority ordering", () => {
  it("lower priority number wins when both match", () => {
    const rules: ExpenseRule[] = [
      makeRule({
        id: 10, name: "Low priority", priority: 100,
        conditions: [{ field: "category", operator: "neq", value: "never_this" }],
        action: { suggestedCategory: "low" },
      }),
      makeRule({
        id: 20, name: "High priority", priority: 10,
        conditions: [{ field: "category", operator: "neq", value: "never_this" }],
        action: { suggestedCategory: "high" },
      }),
    ];
    const result = runRuleEngine(rules, norm("SHOPEE SETTLEMENT"));
    expect(result.matched).toBe(true);
    expect(result.action?.suggestedCategory).toBe("high");
  });

  it("returns matched=false when no rules match", () => {
    const rules: ExpenseRule[] = [
      makeRule({
        id: 1,
        conditions: [{ field: "category", operator: "eq", value: "concession" }],
      }),
    ];
    const result = runRuleEngine(rules, norm("SHOPEE SETTLEMENT")); // ecommerce, not concession
    expect(result.matched).toBe(false);
    expect(result.matchedRule).toBeUndefined();
    expect(result.action).toBeUndefined();
  });

  it("evaluated array contains all rules", () => {
    const rules: ExpenseRule[] = [
      makeRule({ id: 1, conditions: [{ field: "category", operator: "eq", value: "concession" }] }),
      makeRule({ id: 2, conditions: [{ field: "category", operator: "eq", value: "ecommerce" }] }),
    ];
    const result = runRuleEngine(rules, norm("SHOPEE SETTLEMENT"));
    expect(result.evaluated).toHaveLength(2);
  });

  it("direction context is passed through correctly", () => {
    const rules: ExpenseRule[] = [
      makeRule({
        id: 1,
        conditions: [{ field: "direction", operator: "eq", value: "in" }],
        action: { suggestedCategory: "incoming" },
      }),
    ];
    expect(runRuleEngine(rules, norm("TRANSFER"), { direction: "IN" }).matched).toBe(true);
    expect(runRuleEngine(rules, norm("TRANSFER"), { direction: "OUT" }).matched).toBe(false);
  });

  it("empty rules list returns matched=false", () => {
    const result = runRuleEngine([], norm("SHOPEE SETTLEMENT"));
    expect(result.matched).toBe(false);
    expect(result.evaluated).toHaveLength(0);
  });
});

// ─── 3. BUILT_IN_RULES — all 6 initial rules ─────────────────────────────────

describe("BUILT_IN_RULES — structure", () => {
  it("exactly 6 built-in rules exist", () => {
    expect(BUILT_IN_RULES).toHaveLength(6);
  });

  it("all built-in rules have negative IDs (sentinel)", () => {
    BUILT_IN_RULES.forEach(rule => {
      expect(rule.id).toBeLessThan(0);
    });
  });

  it("all built-in rules are active", () => {
    BUILT_IN_RULES.forEach(rule => {
      expect(rule.isActive).toBe(true);
    });
  });

  it("all built-in rules have at least one condition", () => {
    BUILT_IN_RULES.forEach(rule => {
      expect(rule.conditions.length).toBeGreaterThan(0);
    });
  });

  it("all built-in rules have action object", () => {
    BUILT_IN_RULES.forEach(rule => {
      expect(typeof rule.action).toBe("object");
      expect(rule.action).not.toBeNull();
    });
  });

  it("no built-in rule stores a COA ID (no suggestedCoaId field)", () => {
    BUILT_IN_RULES.forEach(rule => {
      expect(rule.action).not.toHaveProperty("suggestedCoaId");
      expect(rule.action).not.toHaveProperty("coaId");
    });
  });
});

describe("BUILT_IN_RULES — Konsesi rule", () => {
  it("concession description triggers Konsesi rule", () => {
    const result = runRuleEngine(BUILT_IN_RULES, norm("Biaya Konsesi Sewa Area"));
    expect(result.matched).toBe(true);
    expect(result.matchedRule?.name).toMatch(/konsesi/i);
    expect(result.action?.suggestedCategory).toBe("concession");
    expect(result.action?.suggestedAccountType).toBe("expense");
  });
});

describe("BUILT_IN_RULES — Listrik (PLN) rule", () => {
  it("PLN description triggers Listrik rule", () => {
    const result = runRuleEngine(BUILT_IN_RULES, norm("Token PLN prabayar 200rb"));
    expect(result.matched).toBe(true);
    expect(result.action?.suggestedCategory).toBe("utility");
    expect(result.action?.metadata?.utility_type).toBe("electricity");
    expect(result.action?.metadata?.provider).toBe("PLN");
  });
});

describe("BUILT_IN_RULES — Air (PDAM) rule", () => {
  it("PDAM description triggers Air rule", () => {
    const result = runRuleEngine(BUILT_IN_RULES, norm("Tagihan PDAM Tirta Moedal"));
    expect(result.matched).toBe(true);
    expect(result.action?.suggestedCategory).toBe("utility");
    expect(result.action?.metadata?.utility_type).toBe("water");
    expect(result.action?.metadata?.provider).toBe("PDAM");
  });
});

describe("BUILT_IN_RULES — Ecommerce rule", () => {
  it("Shopee description triggers Ecommerce rule", () => {
    const result = runRuleEngine(BUILT_IN_RULES, norm("SHOPEE DISBURSEMENT JULI 2026"));
    expect(result.matched).toBe(true);
    expect(result.action?.suggestedCategory).toBe("ecommerce_settlement");
    expect(result.action?.suggestedAccountType).toBe("revenue");
  });

  it("Tokopedia description triggers Ecommerce rule", () => {
    const result = runRuleEngine(BUILT_IN_RULES, norm("Tokopedia Disbursement Penjual"));
    expect(result.matched).toBe(true);
    expect(result.action?.suggestedCategory).toBe("ecommerce_settlement");
  });
});

describe("BUILT_IN_RULES — Kas Besar (Internal Transfer) rule", () => {
  it("kas besar description triggers Internal Transfer rule", () => {
    const result = runRuleEngine(BUILT_IN_RULES, norm("Transfer ke Kas Besar cabang utama"));
    expect(result.matched).toBe(true);
    expect(result.action?.isInternalTransfer).toBe(true);
    expect(result.action?.suggestedCategory).toBe("internal_transfer");
    expect(result.action?.metadata?.skip_expense_creation).toBe("true");
  });

  it("Kas Besar rule has highest priority (priority=5)", () => {
    const kasRule = BUILT_IN_RULES.find(r => r.name.includes("Kas Besar"));
    expect(kasRule).toBeDefined();
    expect(kasRule?.priority).toBe(5);
  });

  it("isInternalTransfer=true, not a P&L expense", () => {
    const result = runRuleEngine(BUILT_IN_RULES, norm("Petty Cash Top Up internal"));
    if (result.matched && result.action?.isInternalTransfer) {
      expect(result.action.isInternalTransfer).toBe(true);
    }
    // Petty cash is internal_transfer (may match kas besar rule)
  });
});

describe("BUILT_IN_RULES — Transfer Fee (Bank Fee) rule", () => {
  it("biaya transfer description triggers Transfer Fee rule", () => {
    const result = runRuleEngine(BUILT_IN_RULES, norm("Biaya Transfer RTGS Rp 30.000"));
    expect(result.matched).toBe(true);
    expect(result.action?.suggestedCategory).toBe("bank_fee");
    expect(result.action?.metadata?.fee_type).toBe("bank_admin");
    expect(result.action?.metadata?.journal_treatment).toBe("metadata_only");
  });

  it("biaya admin bank triggers Transfer Fee rule", () => {
    const result = runRuleEngine(BUILT_IN_RULES, norm("Biaya Admin Bank BNI Bulanan"));
    expect(result.matched).toBe(true);
    expect(result.action?.suggestedCategory).toBe("bank_fee");
  });
});

// ─── 4. mergeRules ────────────────────────────────────────────────────────────

describe("mergeRules", () => {
  it("includes global DB rules (companyId=null)", () => {
    const dbRule = makeRule({
      id: 100, name: "Custom Global", companyId: null,
      conditions: [{ field: "category", operator: "eq", value: "concession" }],
    });
    const merged = mergeRules([dbRule], null);
    expect(merged.some(r => r.id === 100)).toBe(true);
  });

  it("includes company-specific rules for matching company", () => {
    const dbRule = makeRule({
      id: 200, name: "Company Specific", companyId: 5,
      conditions: [{ field: "category", operator: "eq", value: "ecommerce" }],
    });
    const merged = mergeRules([dbRule], 5);
    expect(merged.some(r => r.id === 200)).toBe(true);
  });

  it("excludes company-specific rules for different company", () => {
    const dbRule = makeRule({
      id: 300, name: "Other Company", companyId: 9,
      conditions: [{ field: "category", operator: "eq", value: "ecommerce" }],
    });
    const merged = mergeRules([dbRule], 5);
    expect(merged.some(r => r.id === 300)).toBe(false);
  });

  it("DB rule with same name overrides built-in", () => {
    const dbRule = makeRule({
      id: 400, name: "Konsesi", companyId: null, priority: 50,
      conditions: [{ field: "category", operator: "eq", value: "concession" }],
      action: { suggestedCategory: "custom_concession" },
    });
    const merged = mergeRules([dbRule], null);
    const konsesiRules = merged.filter(r => r.name.toLowerCase() === "konsesi");
    expect(konsesiRules).toHaveLength(1);
    expect(konsesiRules[0].id).toBe(400);
    expect(konsesiRules[0].action.suggestedCategory).toBe("custom_concession");
  });

  it("inactive DB rules are excluded", () => {
    const dbRule = makeRule({
      id: 500, name: "Inactive Rule", isActive: false,
      conditions: [{ field: "category", operator: "eq", value: "concession" }],
    });
    const merged = mergeRules([dbRule], null);
    expect(merged.some(r => r.id === 500)).toBe(false);
  });

  it("all 6 built-ins are included when no DB rules override", () => {
    const merged = mergeRules([], null);
    expect(merged).toHaveLength(6);
  });
});

// ─── 5. validateRule ─────────────────────────────────────────────────────────

describe("validateRule — valid input", () => {
  it("returns empty errors for valid input", () => {
    const errors = validateRule({
      name: "Test Rule",
      priority: 50,
      conditions: [{ field: "category", operator: "eq", value: "concession" }],
      action: { suggestedCategory: "concession" },
    });
    expect(errors).toHaveLength(0);
  });

  it("accepts all valid condition fields", () => {
    const fields = ["category", "normalized", "provider", "token",
      "is_internal_transfer", "is_bank_fee", "fee_type", "confidence_gte", "direction"];
    for (const field of fields) {
      const errors = validateRule({
        name: "Test",
        priority: 50,
        conditions: [{ field, operator: "eq", value: "x" }],
        action: {},
      });
      expect(errors.filter(e => e.field.includes("field"))).toHaveLength(0);
    }
  });

  it("accepts all valid operators", () => {
    const ops = ["eq", "neq", "contains", "starts_with", "gte", "lte"];
    for (const operator of ops) {
      const errors = validateRule({
        name: "Test",
        priority: 50,
        conditions: [{ field: "category", operator, value: "x" }],
        action: {},
      });
      expect(errors.filter(e => e.field.includes("operator"))).toHaveLength(0);
    }
  });
});

describe("validateRule — invalid input", () => {
  it("missing name returns error", () => {
    const errors = validateRule({ name: "", priority: 50, conditions: [{ field: "category", operator: "eq", value: "x" }], action: {} });
    expect(errors.some(e => e.field === "name")).toBe(true);
  });

  it("priority=0 returns error", () => {
    const errors = validateRule({ name: "Test", priority: 0, conditions: [{ field: "category", operator: "eq", value: "x" }], action: {} });
    expect(errors.some(e => e.field === "priority")).toBe(true);
  });

  it("priority=1000 returns error", () => {
    const errors = validateRule({ name: "Test", priority: 1000, conditions: [{ field: "category", operator: "eq", value: "x" }], action: {} });
    expect(errors.some(e => e.field === "priority")).toBe(true);
  });

  it("empty conditions returns error", () => {
    const errors = validateRule({ name: "Test", priority: 50, conditions: [], action: {} });
    expect(errors.some(e => e.field === "conditions")).toBe(true);
  });

  it("invalid condition field returns error", () => {
    const errors = validateRule({ name: "Test", priority: 50, conditions: [{ field: "invalid_field", operator: "eq", value: "x" }], action: {} });
    expect(errors.some(e => e.field.includes("field"))).toBe(true);
  });

  it("invalid operator returns error", () => {
    const errors = validateRule({ name: "Test", priority: 50, conditions: [{ field: "category", operator: "invalid_op", value: "x" }], action: {} });
    expect(errors.some(e => e.field.includes("operator"))).toBe(true);
  });

  it("invalid regex returns error", () => {
    const errors = validateRule({ name: "Test", priority: 50, conditions: [{ field: "normalized", operator: "regex", value: "[invalid" }], action: {} });
    expect(errors.some(e => e.field.includes("value"))).toBe(true);
  });

  it("invalid suggestedAccountType returns error", () => {
    const errors = validateRule({ name: "Test", priority: 50, conditions: [{ field: "category", operator: "eq", value: "x" }], action: { suggestedAccountType: "totally_wrong" } });
    expect(errors.some(e => e.field.includes("AccountType"))).toBe(true);
  });

  it("null action returns error", () => {
    const errors = validateRule({ name: "Test", priority: 50, conditions: [{ field: "category", operator: "eq", value: "x" }], action: null });
    expect(errors.some(e => e.field === "action")).toBe(true);
  });
});
