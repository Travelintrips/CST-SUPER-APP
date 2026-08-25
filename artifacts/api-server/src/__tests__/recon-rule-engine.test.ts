/**
 * Unit tests — Recon Rule Engine (Phase 6)
 *
 * Tests 1–10: Rule Engine
 * Tests 11–20: Expected Cash Flow (pure logic)
 * Tests 21–30: Integration (decision stack + matching logic)
 *
 * Pure-logic tests always run (no DB required).
 * DB-dependent tests are skipped when no connection is available.
 */

import { describe, it, expect } from "vitest";
import {
  evaluateReconRules,
  evaluateCondition,
  validateRegexPattern,
  validateReconRule,
  type ReconRule,
  type ReconRuleMutationInput,
} from "../lib/reconciliation/reconRuleEngine.js";
import {
  buildSourceKey,
} from "../lib/reconciliation/expectedCashFlowService.js";
import {
  BLOCKED_STATUSES,
  ALLOWED_STATUSES,
  ENGINE_VERSION,
} from "../lib/reconciliation/reconDecisionStack.js";
import {
  legacyReferenceCoaReviewReason,
  planReferenceCoaAutoPost,
} from "../lib/reconciliation/referenceCoaAutoPost.js";

// ─── Helpers ───────────────────────────────────────────────────────────────────

function makeRule(overrides: Partial<ReconRule> = {}): ReconRule {
  return {
    id: 1,
    companyId: 42,
    name: "Test Rule",
    description: null,
    priority: 100,
    isActive: true,
    direction: null,
    bankAccountId: null,
    conditionType: "SIMPLE",
    conditionField: "description",
    conditionOperator: "contains",
    conditionValue: "ADMIN",
    targetType: "bank_fee",
    targetId: null,
    targetCoaCode: "5-1010",
    confidenceScore: 100,
    stopProcessing: true,
    matchCount: 0,
    lastMatchedAt: null,
    createdBy: null,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    ...overrides,
  };
}

function makeMutation(overrides: Partial<ReconRuleMutationInput> = {}): ReconRuleMutationInput {
  return {
    description: "biaya admin bank bca",
    reference: null,
    amount: 15000,
    direction: "OUT",
    bankAccountId: null,
    counterpartyName: null,
    counterpartyAccount: null,
    companyId: 42,
    ...overrides,
  };
}

// ─── Test 1: contains match ────────────────────────────────────────────────────

describe("Rule Engine — Test 1: contains match", () => {
  it("matches when description contains the condition value (case-insensitive)", () => {
    const rules = [makeRule({ conditionField: "description", conditionOperator: "contains", conditionValue: "admin" })];
    const result = evaluateReconRules(rules, makeMutation({ description: "biaya ADMIN bank" }));
    expect(result.matched).toBe(true);
    expect(result.ruleId).toBe(1);
    expect(result.targetType).toBe("bank_fee");
    expect(result.confidence).toBe(100);
    expect(result.reasons).toHaveLength(1);
    expect(result.reasons![0].score).toBe(100);
  });

  it("does NOT match when description does not contain value", () => {
    const rules = [makeRule({ conditionField: "description", conditionOperator: "contains", conditionValue: "admin" })];
    const result = evaluateReconRules(rules, makeMutation({ description: "transfer gaji karyawan" }));
    expect(result.matched).toBe(false);
  });
});

// ─── Test 2: equals match ──────────────────────────────────────────────────────

describe("Rule Engine — Test 2: equals match", () => {
  it("matches direction equals exactly", () => {
    const rules = [makeRule({ conditionField: "direction", conditionOperator: "equals", conditionValue: "OUT" })];
    const result = evaluateReconRules(rules, makeMutation({ direction: "OUT" }));
    expect(result.matched).toBe(true);
  });

  it("does NOT match when direction differs", () => {
    const rules = [makeRule({ conditionField: "direction", conditionOperator: "equals", conditionValue: "IN" })];
    const result = evaluateReconRules(rules, makeMutation({ direction: "OUT" }));
    expect(result.matched).toBe(false);
  });
});

// ─── Test 3: regex valid ───────────────────────────────────────────────────────

describe("Rule Engine — Test 3: regex valid", () => {
  it("matches description via valid regex pattern", () => {
    const rules = [makeRule({ conditionOperator: "regex", conditionValue: "admin\\s+bank" })];
    const result = evaluateReconRules(rules, makeMutation({ description: "biaya admin bank bca" }));
    expect(result.matched).toBe(true);
  });

  it("evaluateCondition with regex returns correct match", () => {
    expect(evaluateCondition(makeMutation(), "description", "regex", "admin")).toBe(true);
    expect(evaluateCondition(makeMutation(), "description", "regex", "^gaji")).toBe(false);
  });
});

// ─── Test 4: regex invalid ditolak ────────────────────────────────────────────

describe("Rule Engine — Test 4: invalid regex rejected at validation", () => {
  it("validateRegexPattern returns error for invalid regex", () => {
    const err = validateRegexPattern("[invalid(");
    expect(err).not.toBeNull();
    expect(typeof err).toBe("string");
    expect(err!.length).toBeGreaterThan(0);
  });

  it("validateRegexPattern returns null for valid regex", () => {
    expect(validateRegexPattern("admin\\s+bank")).toBeNull();
    expect(validateRegexPattern("^TRANSFER")).toBeNull();
    expect(validateRegexPattern("(ADMIN|BIAYA)")).toBeNull();
  });

  it("validateReconRule returns error when regex operator has invalid pattern", () => {
    const errors = validateReconRule({
      name: "Test",
      priority: 100,
      conditionField: "description",
      conditionOperator: "regex",
      conditionValue: "[broken(",
      targetType: "bank_fee",
    });
    expect(errors.some(e => e.includes("Regex"))).toBe(true);
  });

  it("invalid regex in rule evaluates to false without throwing", () => {
    const rules = [makeRule({ conditionOperator: "regex", conditionValue: "[broken(" })];
    const result = evaluateReconRules(rules, makeMutation());
    expect(result.matched).toBe(false);
  });
});

// ─── Test 5: priority tertinggi menang ────────────────────────────────────────

describe("Rule Engine — Test 5: highest priority wins", () => {
  it("returns the higher priority rule on match", () => {
    const rules: ReconRule[] = [
      makeRule({ id: 10, priority: 50, conditionValue: "admin", targetCoaCode: "5-ADMIN-LOW" }),
      makeRule({ id: 20, priority: 200, conditionValue: "admin", targetCoaCode: "5-ADMIN-HIGH" }),
    ];
    const result = evaluateReconRules(rules, makeMutation());
    expect(result.matched).toBe(true);
    expect(result.ruleId).toBe(20);
    expect(result.targetCoaCode).toBe("5-ADMIN-HIGH");
  });

  it("lower priority rule wins if higher priority does not match", () => {
    const rules: ReconRule[] = [
      makeRule({ id: 1, priority: 200, conditionValue: "NONEXISTENT", targetCoaCode: "5-HIGH" }),
      makeRule({ id: 2, priority: 50,  conditionValue: "admin",       targetCoaCode: "5-LOW" }),
    ];
    const result = evaluateReconRules(rules, makeMutation());
    expect(result.matched).toBe(true);
    expect(result.ruleId).toBe(2);
  });
});

// ─── Test 6: stop_processing bekerja ─────────────────────────────────────────

describe("Rule Engine — Test 6: stop_processing works", () => {
  it("stops after first match when stop_processing=true", () => {
    const rules: ReconRule[] = [
      makeRule({ id: 1, priority: 200, conditionValue: "admin", stopProcessing: true, targetCoaCode: "5-FIRST" }),
      makeRule({ id: 2, priority: 100, conditionValue: "admin", stopProcessing: false, targetCoaCode: "5-SECOND" }),
    ];
    const result = evaluateReconRules(rules, makeMutation());
    // First match (priority 200) is returned
    expect(result.matched).toBe(true);
    expect(result.ruleId).toBe(1);
    // Only 1 rule in evaluated because stop after first match
    expect(result.evaluated.length).toBe(1);
  });

  it("continues evaluating when stop_processing=false but no match", () => {
    const rules: ReconRule[] = [
      makeRule({ id: 1, priority: 200, conditionValue: "NOMATCH", stopProcessing: true }),
      makeRule({ id: 2, priority: 100, conditionValue: "admin",   stopProcessing: false }),
    ];
    const result = evaluateReconRules(rules, makeMutation());
    expect(result.matched).toBe(true);
    expect(result.ruleId).toBe(2);
    expect(result.evaluated.length).toBe(2);
  });
});

// ─── Test 7: company isolation ────────────────────────────────────────────────

describe("Rule Engine — Test 7: company isolation", () => {
  it("rule with different company_id does not match", () => {
    const rules = [makeRule({ companyId: 99 })];
    const result = evaluateReconRules(rules, makeMutation({ companyId: 42 }));
    expect(result.matched).toBe(false);
  });

  it("rule with same company_id matches", () => {
    const rules = [makeRule({ companyId: 42 })];
    const result = evaluateReconRules(rules, makeMutation({ companyId: 42 }));
    expect(result.matched).toBe(true);
  });
});

// ─── Test 8: inactive rule diabaikan ──────────────────────────────────────────

describe("Rule Engine — Test 8: inactive rule is ignored", () => {
  it("inactive rule does not match even if condition would pass", () => {
    const rules = [makeRule({ isActive: false, conditionValue: "admin" })];
    const result = evaluateReconRules(rules, makeMutation());
    expect(result.matched).toBe(false);
    expect(result.evaluated[0].matched).toBe(false);
  });

  it("active rule after inactive one still matches", () => {
    const rules: ReconRule[] = [
      makeRule({ id: 1, priority: 200, isActive: false }),
      makeRule({ id: 2, priority: 100, isActive: true }),
    ];
    const result = evaluateReconRules(rules, makeMutation());
    expect(result.matched).toBe(true);
    expect(result.ruleId).toBe(2);
  });
});

// ─── Test 9: amount between ───────────────────────────────────────────────────

describe("Rule Engine — Test 9: amount between operator", () => {
  it("matches when amount is within range", () => {
    const rules = [makeRule({ conditionField: "amount", conditionOperator: "between", conditionValue: "10000,20000" })];
    expect(evaluateReconRules(rules, makeMutation({ amount: 15000 })).matched).toBe(true);
    expect(evaluateReconRules(rules, makeMutation({ amount: 10000 })).matched).toBe(true);
    expect(evaluateReconRules(rules, makeMutation({ amount: 20000 })).matched).toBe(true);
  });

  it("does NOT match when amount is outside range", () => {
    const rules = [makeRule({ conditionField: "amount", conditionOperator: "between", conditionValue: "10000,20000" })];
    expect(evaluateReconRules(rules, makeMutation({ amount: 9999 })).matched).toBe(false);
    expect(evaluateReconRules(rules, makeMutation({ amount: 20001 })).matched).toBe(false);
  });

  it("validateReconRule rejects malformed between value", () => {
    const errors = validateReconRule({
      name: "Test",
      priority: 100,
      conditionField: "amount",
      conditionOperator: "between",
      conditionValue: "not,a,number",
      targetType: "bank_fee",
    });
    expect(errors.some(e => e.includes("between"))).toBe(true);
  });
});

// ─── Test 10: deterministic tie-breaker ───────────────────────────────────────

describe("Rule Engine — Test 10: deterministic tie-breaker (id ASC)", () => {
  it("fails closed when equal-precedence rules produce different COAs", () => {
    const rules: ReconRule[] = [
      makeRule({ id: 50, priority: 100, conditionValue: "admin", targetCoaCode: "5-ID50" }),
      makeRule({ id: 10, priority: 100, conditionValue: "admin", targetCoaCode: "5-ID10" }),
    ];
    const result = evaluateReconRules(rules, makeMutation());
    expect(result.matched).toBe(false);
    expect(result.ambiguityCode).toBe("AMBIGUOUS_RULE_MATCH");
  });
});

describe("Rule Engine — structured multi-condition rules", () => {
  it("requires all AND conditions and supports NOT", () => {
    const rules = [makeRule({
      conditions: [
        { field: "description", operator: "contains", value: "felicia" },
        { field: "description", operator: "contains", value: "kas besar" },
        { field: "description", operator: "not_contains", value: "kasbon" },
      ],
      logic: "AND",
      specificity: 3,
    })];
    expect(evaluateReconRules(rules, makeMutation({
      description: "BBLUI FELICIA JUSTIANI KAS BESAR 99102",
    })).matched).toBe(true);
    expect(evaluateReconRules(rules, makeMutation({
      description: "BBLUI FELICIA JUSTIANI KAS BESAR KASBON 99102",
    })).matched).toBe(false);
  });

  it("supports OR conditions", () => {
    const rules = [makeRule({
      conditions: [
        { field: "description", operator: "contains", value: "reimb" },
        { field: "description", operator: "contains", value: "kasbon" },
      ],
      logic: "OR",
    })];
    expect(evaluateReconRules(rules, makeMutation({ description: "REIMB KARYAWAN" })).matched).toBe(true);
    expect(evaluateReconRules(rules, makeMutation({ description: "TRANSFER BIASA" })).matched).toBe(false);
  });
});

// ─── Test 11-20: Expected Cash Flow ───────────────────────────────────────────

describe("Expected Cash Flow — Test 11-14: source_key and structure", () => {
  it("Test 11: buildSourceKey produces deterministic key", () => {
    const key = buildSourceKey(42, "sales_invoice", "123");
    expect(key).toBe("42:sales_invoice:123");
  });

  it("Test 12: buildSourceKey with numeric sourceId", () => {
    expect(buildSourceKey(1, "expense_payable", 456)).toBe("1:expense_payable:456");
  });

  it("Test 13: source_key is unique per company+type+id combination", () => {
    const k1 = buildSourceKey(1, "sales_invoice", "100");
    const k2 = buildSourceKey(2, "sales_invoice", "100");
    const k3 = buildSourceKey(1, "logistic_order", "100");
    expect(k1).not.toBe(k2);  // different company
    expect(k1).not.toBe(k3);  // different source_type
  });

  it("Test 14: company isolation in source_key", () => {
    const compA = buildSourceKey(10, "sales_invoice", "1");
    const compB = buildSourceKey(20, "sales_invoice", "1");
    expect(compA).not.toBe(compB);
  });
});

describe("Expected Cash Flow — Test 15-20: status and validation", () => {
  it("Test 15: ALLOWED_STATUSES includes open ECF statuses", () => {
    expect(ALLOWED_STATUSES.has("unmatched")).toBe(true);
    expect(ALLOWED_STATUSES.has("matched")).toBe(true);
    expect(ALLOWED_STATUSES.has("duplicate_need_review")).toBe(true);
  });

  it("Test 16: BLOCKED_STATUSES includes protected statuses", () => {
    const blocked = ["approved_pending_posting", "approved", "posted", "void", "reversed", "rejected"];
    for (const s of blocked) {
      expect(BLOCKED_STATUSES.has(s)).toBe(true);
    }
  });

  it("Test 17: ALLOWED_STATUSES and BLOCKED_STATUSES are disjoint", () => {
    for (const s of ALLOWED_STATUSES) {
      expect(BLOCKED_STATUSES.has(s)).toBe(false);
    }
  });

  it("Test 18: ENGINE_VERSION is a non-empty string", () => {
    expect(typeof ENGINE_VERSION).toBe("string");
    expect(ENGINE_VERSION.length).toBeGreaterThan(0);
  });

  it("Test 19: validateReconRule catches missing required fields", () => {
    const errors = validateReconRule({});
    expect(errors.some(e => e.includes("name"))).toBe(true);
    expect(errors.some(e => e.includes("priority"))).toBe(true);
    expect(errors.some(e => e.includes("conditionField"))).toBe(true);
    expect(errors.some(e => e.includes("targetType"))).toBe(true);
  });

  it("Test 20: validateReconRule passes for valid rule", () => {
    const errors = validateReconRule({
      name: "Test Rule",
      priority: 100,
      conditionField: "description",
      conditionOperator: "contains",
      conditionValue: "ADMIN",
      targetType: "bank_fee",
      confidenceScore: 100,
    });
    expect(errors).toHaveLength(0);
  });
});

// ─── Test 21-30: Integration (pure logic) ─────────────────────────────────────

describe("Integration — Test 21: rule match overrides AI", () => {
  it("rule-matched result has confidence=100 when rule.confidenceScore=100", () => {
    const rules = [makeRule({ confidenceScore: 100 })];
    const result = evaluateReconRules(rules, makeMutation());
    expect(result.matched).toBe(true);
    expect(result.confidence).toBe(100);
  });
});

describe("Integration — Test 22: exact reference signal in reasons", () => {
  it("reference field equals produces RULE_REFERENCE_EQUALS reason code", () => {
    const rules = [makeRule({ conditionField: "reference", conditionOperator: "equals", conditionValue: "INV-001" })];
    const result = evaluateReconRules(rules, makeMutation({ reference: "INV-001" }));
    expect(result.matched).toBe(true);
    expect(result.reasons![0].code).toContain("REFERENCE");
    expect(result.reasons![0].code).toContain("EQUALS");
  });
});

describe("Integration — Test 23: ECF candidate reasons structure", () => {
  it("reason objects have code, label, score fields", () => {
    const rules = [makeRule()];
    const result = evaluateReconRules(rules, makeMutation());
    expect(result.matched).toBe(true);
    const reason = result.reasons![0];
    expect(reason).toHaveProperty("code");
    expect(reason).toHaveProperty("label");
    expect(reason).toHaveProperty("score");
    expect(typeof reason.score).toBe("number");
  });
});

describe("Integration — Test 24: confidence breakdown total", () => {
  it("confidence equals sum of reason scores (bounded at confidenceScore)", () => {
    const rules = [makeRule({ confidenceScore: 85 })];
    const result = evaluateReconRules(rules, makeMutation());
    const total = (result.reasons ?? []).reduce((s, r) => s + r.score, 0);
    // For single-condition rule: reason score = confidenceScore
    expect(total).toBe(85);
    expect(result.confidence).toBe(85);
  });
});

describe("Integration — Test 25: approved_pending_posting is blocked", () => {
  it("BLOCKED_STATUSES contains approved_pending_posting", () => {
    expect(BLOCKED_STATUSES.has("approved_pending_posting")).toBe(true);
  });
});

describe("Integration — Test 26: posted status is blocked", () => {
  it("BLOCKED_STATUSES contains posted", () => {
    expect(BLOCKED_STATUSES.has("posted")).toBe(true);
  });
});

describe("Integration — Test 27: unmatched status is allowed", () => {
  it("ALLOWED_STATUSES contains unmatched", () => {
    expect(ALLOWED_STATUSES.has("unmatched")).toBe(true);
  });
});

describe("Integration — Test 28: source_key prevents duplicates", () => {
  it("same source produces same key regardless of call order", () => {
    const key1 = buildSourceKey(42, "sales_invoice", "100");
    const key2 = buildSourceKey(42, "sales_invoice", "100");
    expect(key1).toBe(key2);
  });
});

describe("Integration — Test 29: starts_with and ends_with operators", () => {
  it("starts_with matches prefix correctly", () => {
    const rules = [makeRule({ conditionField: "description", conditionOperator: "starts_with", conditionValue: "biaya" })];
    expect(evaluateReconRules(rules, makeMutation({ description: "biaya admin bank" })).matched).toBe(true);
    expect(evaluateReconRules(rules, makeMutation({ description: "transfer biaya" })).matched).toBe(false);
  });

  it("ends_with matches suffix correctly", () => {
    const rules = [makeRule({ conditionField: "description", conditionOperator: "ends_with", conditionValue: "bca" })];
    expect(evaluateReconRules(rules, makeMutation({ description: "admin bank bca" })).matched).toBe(true);
    expect(evaluateReconRules(rules, makeMutation({ description: "bca transfer keluar" })).matched).toBe(false);
  });
});

describe("Integration — Test 30: greater_than and less_than operators", () => {
  it("greater_than works for amount field", () => {
    const rules = [makeRule({ conditionField: "amount", conditionOperator: "greater_than", conditionValue: "10000" })];
    expect(evaluateReconRules(rules, makeMutation({ amount: 15000 })).matched).toBe(true);
    expect(evaluateReconRules(rules, makeMutation({ amount: 5000 })).matched).toBe(false);
    expect(evaluateReconRules(rules, makeMutation({ amount: 10000 })).matched).toBe(false); // not strictly greater
  });

  it("less_than works for amount field", () => {
    const rules = [makeRule({ conditionField: "amount", conditionOperator: "less_than", conditionValue: "20000" })];
    expect(evaluateReconRules(rules, makeMutation({ amount: 15000 })).matched).toBe(true);
    expect(evaluateReconRules(rules, makeMutation({ amount: 25000 })).matched).toBe(false);
  });
});

describe("Reference COA auto-post safeguards", () => {
  it("attempts a draft only for an explicit COA at full confidence", () => {
    expect(planReferenceCoaAutoPost({
      targetCoaCode: "5-3010-CST",
      ruleConfidence: 100,
      decisionConfidence: 100,
    })).toEqual({ shouldAttempt: true, code: null, reason: null });
  });

  it("keeps the mutation reviewable when a matched rule has no COA", () => {
    const plan = planReferenceCoaAutoPost({
      targetCoaCode: null,
      ruleConfidence: 100,
      decisionConfidence: 100,
    });
    expect(plan.shouldAttempt).toBe(false);
    if (!plan.shouldAttempt) {
      expect(plan.code).toBe("REFERENCE_COA_MISSING");
      expect(plan.reason).toContain("belum memiliki akun COA");
    }
  });

  it("keeps the mutation reviewable when confidence is below 100", () => {
    const plan = planReferenceCoaAutoPost({
      targetCoaCode: "5-3010-CST",
      ruleConfidence: 100,
      decisionConfidence: 99,
    });
    expect(plan.shouldAttempt).toBe(false);
    if (!plan.shouldAttempt) {
      expect(plan.code).toBe("REFERENCE_COA_CONFIDENCE_INSUFFICIENT");
    }
  });

  it("gives historical rule-only matches an actionable reviewer message", () => {
    expect(legacyReferenceCoaReviewReason()).toContain("Pilih COA & Buat Draft");
  });
});
