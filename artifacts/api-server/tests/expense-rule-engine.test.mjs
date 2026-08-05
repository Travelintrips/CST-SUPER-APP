/**
 * Phase 3 — Expense Rule Engine: Unit Tests
 *
 * Run: node --test artifacts/api-server/tests/expense-rule-engine.test.mjs
 *
 * No DB dependency. Tests pure logic: evaluateRule, runRuleEngine,
 * mergeRules, validateRule, BUILT_IN_RULES.
 *
 * Test groups:
 *   1. evaluateRule — condition evaluation per operator
 *   2. runRuleEngine — first-match wins, priority ordering
 *   3. BUILT_IN_RULES — all 6 initial rules evaluate correctly
 *   4. mergeRules — DB overrides built-ins by name
 *   5. validateRule — input validation
 */

import { strict as assert } from "node:assert";
import { describe, it } from "node:test";

// ─── Imports ──────────────────────────────────────────────────────────────────

const {
  BUILT_IN_RULES,
  evaluateRule,
  runRuleEngine,
  mergeRules,
  validateRule,
} = await import("../src/lib/expenseRuleEngine.js").catch(async () =>
  import("../dist/lib/expenseRuleEngine.js"),
);

const { normalizeDescription } = await import("../src/lib/bankDescriptionNormalizer.js").catch(async () =>
  import("../dist/lib/bankDescriptionNormalizer.js"),
);

// ─── Helpers ──────────────────────────────────────────────────────────────────

function makeRule(overrides = {}) {
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

function norm(raw) {
  return normalizeDescription(raw);
}

// ─── 1. evaluateRule — condition evaluation per operator ──────────────────────

describe("evaluateRule — eq operator", () => {
  it("category eq passes when category matches", () => {
    const rule = makeRule({
      conditions: [{ field: "category", operator: "eq", value: "concession" }],
    });
    const n = norm("biaya konsesi bulanan");
    const result = evaluateRule(rule, n);
    assert.equal(result.matched, true);
  });

  it("category eq fails when category does not match", () => {
    const rule = makeRule({
      conditions: [{ field: "category", operator: "eq", value: "ecommerce" }],
    });
    const n = norm("biaya konsesi bulanan");
    const result = evaluateRule(rule, n);
    assert.equal(result.matched, false);
  });

  it("is_internal_transfer eq 'true' passes for internal transfer", () => {
    const rule = makeRule({
      conditions: [{ field: "is_internal_transfer", operator: "eq", value: "true" }],
    });
    const n = norm("Transfer ke Kas Besar");
    const result = evaluateRule(rule, n);
    assert.equal(result.matched, true);
  });

  it("is_internal_transfer eq 'true' fails for non-transfer", () => {
    const rule = makeRule({
      conditions: [{ field: "is_internal_transfer", operator: "eq", value: "true" }],
    });
    const n = norm("Bayar PLN Token");
    const result = evaluateRule(rule, n);
    assert.equal(result.matched, false);
  });

  it("is_bank_fee eq 'true' passes for bank fee", () => {
    const rule = makeRule({
      conditions: [{ field: "is_bank_fee", operator: "eq", value: "true" }],
    });
    const n = norm("Biaya Transfer RTGS");
    const result = evaluateRule(rule, n);
    assert.equal(result.matched, true);
  });
});

describe("evaluateRule — contains operator", () => {
  it("normalized contains passes for substring", () => {
    const rule = makeRule({
      conditions: [{ field: "normalized", operator: "contains", value: "konsesi" }],
    });
    const n = norm("BIAYA KONSESI BULAN INI");
    const result = evaluateRule(rule, n);
    assert.equal(result.matched, true);
  });

  it("normalized contains fails when substring not present", () => {
    const rule = makeRule({
      conditions: [{ field: "normalized", operator: "contains", value: "shopee" }],
    });
    const n = norm("BIAYA KONSESI BULAN INI");
    const result = evaluateRule(rule, n);
    assert.equal(result.matched, false);
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
    const n = norm("Token PLN Prabayar");
    const result = evaluateRule(rule, n);
    assert.equal(result.matched, true);
  });

  it("one condition fails → matched=false", () => {
    const rule = makeRule({
      conditions: [
        { field: "category", operator: "eq", value: "utility_electricity" },
        { field: "is_bank_fee", operator: "eq", value: "true" }, // PLN is not bank fee
      ],
    });
    const n = norm("Token PLN Prabayar");
    const result = evaluateRule(rule, n);
    assert.equal(result.matched, false);
  });
});

describe("evaluateRule — confidence_gte operator", () => {
  it("confidence_gte passes when confidence meets threshold", () => {
    const rule = makeRule({
      conditions: [{ field: "confidence_gte", operator: "gte", value: "85" }],
    });
    const n = norm("SHOPEE DISBURSEMENT"); // confidence ≥ 90
    const result = evaluateRule(rule, n);
    assert.equal(result.matched, true);
  });

  it("confidence_gte fails when confidence is below threshold", () => {
    const rule = makeRule({
      conditions: [{ field: "confidence_gte", operator: "gte", value: "95" }],
    });
    const n = norm("TRANSFER BIASA"); // category=unknown, confidence=0
    const result = evaluateRule(rule, n);
    assert.equal(result.matched, false);
  });
});

describe("evaluateRule — inactive rule", () => {
  it("inactive rule is never matched", () => {
    const rule = makeRule({
      isActive: false,
      conditions: [{ field: "category", operator: "eq", value: "concession" }],
    });
    const n = norm("biaya konsesi bulanan");
    const result = evaluateRule(rule, n);
    assert.equal(result.matched, false);
  });
});

// ─── 2. runRuleEngine — priority + first-match ────────────────────────────────

describe("runRuleEngine — priority ordering", () => {
  it("lower priority rule wins when both match", () => {
    const rules = [
      makeRule({ id: 10, name: "Low priority", priority: 100, action: { suggestedCategory: "low" } }),
      makeRule({ id: 20, name: "High priority", priority: 10,  action: { suggestedCategory: "high" } }),
    ];
    // Both have no conditions → both always match
    rules.forEach(r => { r.conditions = []; });
    // Empty conditions → inactive by engine logic (0 conditions → skip)
    // Add a trivially-true condition to both
    rules[0].conditions = [{ field: "category", operator: "neq", value: "never_this" }];
    rules[1].conditions = [{ field: "category", operator: "neq", value: "never_this" }];

    const n = norm("SHOPEE SETTLEMENT");
    const result = runRuleEngine(rules, n);
    assert.equal(result.matched, true);
    assert.equal(result.action?.suggestedCategory, "high", "higher priority (lower number) wins");
  });

  it("returns matched=false when no rules match", () => {
    const rules = [
      makeRule({
        conditions: [{ field: "category", operator: "eq", value: "concession" }],
        action: { suggestedCategory: "concession" },
      }),
    ];
    const n = norm("SHOPEE SETTLEMENT"); // category=ecommerce, not concession
    const result = runRuleEngine(rules, n);
    assert.equal(result.matched, false);
    assert.equal(result.matchedRule, undefined);
    assert.equal(result.action, undefined);
  });

  it("evaluated array contains all rules", () => {
    const rules = [
      makeRule({ id: 1, conditions: [{ field: "category", operator: "eq", value: "concession" }] }),
      makeRule({ id: 2, conditions: [{ field: "category", operator: "eq", value: "ecommerce" }] }),
    ];
    const n = norm("SHOPEE SETTLEMENT");
    const result = runRuleEngine(rules, n);
    assert.equal(result.evaluated.length, 2);
  });

  it("direction context is passed through correctly", () => {
    const rules = [
      makeRule({
        conditions: [{ field: "direction", operator: "eq", value: "in" }],
        action: { suggestedCategory: "incoming" },
      }),
    ];
    const n = norm("TRANSFER MASUK");
    const resultIn  = runRuleEngine(rules, n, { direction: "IN" });
    const resultOut = runRuleEngine(rules, n, { direction: "OUT" });
    assert.equal(resultIn.matched, true, "direction=IN should match");
    assert.equal(resultOut.matched, false, "direction=OUT should not match");
  });
});

// ─── 3. BUILT_IN_RULES — all 6 initial rules ─────────────────────────────────

describe("BUILT_IN_RULES — structure", () => {
  it("exactly 6 built-in rules exist", () => {
    assert.equal(BUILT_IN_RULES.length, 6, "expected 6 built-in rules");
  });

  it("all built-in rules have negative IDs", () => {
    for (const rule of BUILT_IN_RULES) {
      assert.ok(rule.id < 0, `rule "${rule.name}" should have negative id, got ${rule.id}`);
    }
  });

  it("all built-in rules are active", () => {
    for (const rule of BUILT_IN_RULES) {
      assert.equal(rule.isActive, true, `rule "${rule.name}" should be active`);
    }
  });

  it("all built-in rules have at least one condition", () => {
    for (const rule of BUILT_IN_RULES) {
      assert.ok(rule.conditions.length > 0, `rule "${rule.name}" needs conditions`);
    }
  });

  it("all built-in rules have non-empty action", () => {
    for (const rule of BUILT_IN_RULES) {
      assert.ok(typeof rule.action === "object", `rule "${rule.name}" action must be object`);
    }
  });
});

describe("BUILT_IN_RULES — Konsesi rule matches correctly", () => {
  it("konsesi description triggers the Konsesi rule", () => {
    const n = norm("Biaya Konsesi Sewa Area");
    const result = runRuleEngine(BUILT_IN_RULES, n);
    assert.equal(result.matched, true);
    assert.ok(result.matchedRule?.name?.toLowerCase().includes("konsesi"));
    assert.equal(result.action?.suggestedCategory, "concession");
    assert.equal(result.action?.suggestedAccountType, "expense");
  });
});

describe("BUILT_IN_RULES — Listrik rule matches correctly", () => {
  it("PLN description triggers Listrik rule", () => {
    const n = norm("Token PLN prabayar 200rb");
    const result = runRuleEngine(BUILT_IN_RULES, n);
    assert.equal(result.matched, true);
    assert.equal(result.action?.suggestedCategory, "utility");
    assert.equal(result.action?.metadata?.utility_type, "electricity");
    assert.equal(result.action?.metadata?.provider, "PLN");
  });
});

describe("BUILT_IN_RULES — Air rule matches correctly", () => {
  it("PDAM description triggers Air rule", () => {
    const n = norm("Tagihan PDAM Tirta Moedal");
    const result = runRuleEngine(BUILT_IN_RULES, n);
    assert.equal(result.matched, true);
    assert.equal(result.action?.suggestedCategory, "utility");
    assert.equal(result.action?.metadata?.utility_type, "water");
    assert.equal(result.action?.metadata?.provider, "PDAM");
  });
});

describe("BUILT_IN_RULES — Ecommerce rule matches correctly", () => {
  it("Shopee description triggers Ecommerce rule", () => {
    const n = norm("SHOPEE DISBURSEMENT JULI 2026");
    const result = runRuleEngine(BUILT_IN_RULES, n);
    assert.equal(result.matched, true);
    assert.equal(result.action?.suggestedCategory, "ecommerce_settlement");
    assert.equal(result.action?.suggestedAccountType, "revenue");
  });
});

describe("BUILT_IN_RULES — Kas Besar rule matches correctly", () => {
  it("kas besar description triggers Internal Transfer rule", () => {
    const n = norm("Transfer ke Kas Besar cabang utama");
    const result = runRuleEngine(BUILT_IN_RULES, n);
    assert.equal(result.matched, true);
    assert.equal(result.action?.isInternalTransfer, true);
    assert.equal(result.action?.suggestedCategory, "internal_transfer");
    assert.equal(result.action?.metadata?.skip_expense_creation, "true");
  });

  it("kas besar rule has highest priority (priority=5)", () => {
    const kasRule = BUILT_IN_RULES.find(r => r.name.includes("Kas Besar"));
    assert.ok(kasRule, "Kas Besar rule must exist");
    assert.equal(kasRule.priority, 5, "Kas Besar must have priority=5 (highest)");
  });
});

describe("BUILT_IN_RULES — Transfer Fee rule matches correctly", () => {
  it("biaya transfer description triggers Transfer Fee rule", () => {
    const n = norm("Biaya Transfer RTGS Rp 30.000");
    const result = runRuleEngine(BUILT_IN_RULES, n);
    assert.equal(result.matched, true);
    assert.equal(result.action?.suggestedCategory, "bank_fee");
    assert.equal(result.action?.metadata?.fee_type, "bank_admin");
    assert.equal(result.action?.metadata?.journal_treatment, "metadata_only");
  });
});

// ─── 4. mergeRules ────────────────────────────────────────────────────────────

describe("mergeRules", () => {
  it("includes global DB rules (companyId=null)", () => {
    const dbRule = makeRule({ id: 100, name: "Custom Global", companyId: null });
    dbRule.conditions = [{ field: "category", operator: "eq", value: "concession" }];
    const merged = mergeRules([dbRule], null);
    assert.ok(merged.some(r => r.id === 100));
  });

  it("includes company-specific DB rules for matching company", () => {
    const dbRule = makeRule({ id: 200, name: "Company Specific", companyId: 5 });
    dbRule.conditions = [{ field: "category", operator: "eq", value: "ecommerce" }];
    const merged = mergeRules([dbRule], 5);
    assert.ok(merged.some(r => r.id === 200));
  });

  it("excludes company-specific DB rules for different company", () => {
    const dbRule = makeRule({ id: 300, name: "Other Company", companyId: 9 });
    dbRule.conditions = [{ field: "category", operator: "eq", value: "ecommerce" }];
    const merged = mergeRules([dbRule], 5);
    assert.ok(!merged.some(r => r.id === 300));
  });

  it("DB rule with same name overrides built-in", () => {
    const dbRule = makeRule({
      id: 400,
      name: "Konsesi",   // same name as built-in
      companyId: null,
      priority: 50,
      action: { suggestedCategory: "custom_concession" },
    });
    dbRule.conditions = [{ field: "category", operator: "eq", value: "concession" }];
    const merged = mergeRules([dbRule], null);
    // Built-in "Konsesi" should NOT be in merged (overridden)
    const konsesiRules = merged.filter(r => r.name.toLowerCase() === "konsesi");
    assert.equal(konsesiRules.length, 1, "only one Konsesi rule after override");
    assert.equal(konsesiRules[0].id, 400, "DB rule wins over built-in");
    assert.equal(konsesiRules[0].action.suggestedCategory, "custom_concession");
  });

  it("inactive DB rules are excluded from merged set", () => {
    const dbRule = makeRule({ id: 500, name: "Inactive Rule", isActive: false });
    dbRule.conditions = [{ field: "category", operator: "eq", value: "concession" }];
    const merged = mergeRules([dbRule], null);
    assert.ok(!merged.some(r => r.id === 500));
  });
});

// ─── 5. validateRule ─────────────────────────────────────────────────────────

describe("validateRule", () => {
  it("valid rule returns empty errors", () => {
    const errors = validateRule({
      name: "Test Rule",
      priority: 50,
      conditions: [{ field: "category", operator: "eq", value: "concession" }],
      action: { suggestedCategory: "concession" },
    });
    assert.equal(errors.length, 0);
  });

  it("missing name returns error", () => {
    const errors = validateRule({
      name: "",
      priority: 50,
      conditions: [{ field: "category", operator: "eq", value: "concession" }],
      action: {},
    });
    assert.ok(errors.some(e => e.field === "name"), "should report name error");
  });

  it("priority out of range returns error", () => {
    const errors = validateRule({
      name: "Test",
      priority: 0,
      conditions: [{ field: "category", operator: "eq", value: "concession" }],
      action: {},
    });
    assert.ok(errors.some(e => e.field === "priority"), "should report priority error");
  });

  it("empty conditions returns error", () => {
    const errors = validateRule({
      name: "Test",
      priority: 50,
      conditions: [],
      action: {},
    });
    assert.ok(errors.some(e => e.field === "conditions"), "should report conditions error");
  });

  it("invalid condition field returns error", () => {
    const errors = validateRule({
      name: "Test",
      priority: 50,
      conditions: [{ field: "invalid_field", operator: "eq", value: "x" }],
      action: {},
    });
    assert.ok(errors.some(e => e.field.includes("field")), "should report invalid field");
  });

  it("invalid condition operator returns error", () => {
    const errors = validateRule({
      name: "Test",
      priority: 50,
      conditions: [{ field: "category", operator: "invalid_op", value: "x" }],
      action: {},
    });
    assert.ok(errors.some(e => e.field.includes("operator")), "should report invalid operator");
  });

  it("invalid regex returns error", () => {
    const errors = validateRule({
      name: "Test",
      priority: 50,
      conditions: [{ field: "normalized", operator: "regex", value: "[invalid" }],
      action: {},
    });
    assert.ok(errors.some(e => e.field.includes("value")), "should report invalid regex");
  });

  it("invalid suggestedAccountType returns error", () => {
    const errors = validateRule({
      name: "Test",
      priority: 50,
      conditions: [{ field: "category", operator: "eq", value: "concession" }],
      action: { suggestedAccountType: "totally_wrong" },
    });
    assert.ok(errors.some(e => e.field.includes("AccountType")), "should report accountType error");
  });

  it("null action returns error", () => {
    const errors = validateRule({
      name: "Test",
      priority: 50,
      conditions: [{ field: "category", operator: "eq", value: "concession" }],
      action: null,
    });
    assert.ok(errors.some(e => e.field === "action"), "should report action error");
  });
});
