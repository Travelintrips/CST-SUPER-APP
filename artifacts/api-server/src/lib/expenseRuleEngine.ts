/**
 * Phase 3 — Expense Rule Engine
 *
 * Rule evaluation engine for bank mutation descriptions.
 * Rules are loaded from the `expense_rules` DB table plus
 * the built-in seed rules shipped with the service.
 *
 * KEY CONSTRAINT: COA IDs are NEVER stored here.
 * Rules store `suggested_account_type` and `suggested_account_subtype`
 * (semantic references) that callers resolve to actual COA IDs via
 * chart_of_accounts lookup at runtime.
 *
 * Rule evaluation: conditions are AND-ed; first active rule (by priority ASC,
 * then id ASC) whose conditions all pass wins.
 */

import type { NormalizationResult, DescriptionCategory } from "./bankDescriptionNormalizer.js";

// ─── Types ─────────────────────────────────────────────────────────────────────

/** Supported condition fields */
export type ConditionField =
  | "category"          // matches NormalizationResult.category
  | "normalized"        // substring match in NormalizationResult.normalized
  | "provider"          // matches NormalizationResult.provider
  | "token"             // token in NormalizationResult.tokens
  | "is_internal_transfer"  // boolean flag
  | "is_bank_fee"       // boolean flag
  | "fee_type"          // matches NormalizationResult.feeType
  | "confidence_gte"    // NormalizationResult.confidence >= value
  | "direction";        // "IN" | "OUT" (passed from caller context)

/** Supported comparison operators */
export type ConditionOperator = "eq" | "neq" | "contains" | "starts_with" | "regex" | "gte" | "lte";

export interface RuleCondition {
  field: ConditionField;
  operator: ConditionOperator;
  value: string;
}

/** Action applied when all conditions match */
export interface RuleAction {
  /** Semantic expense category label (not a COA ID) */
  suggestedCategory?: string;
  /**
   * Account type hint for COA resolution: "expense" | "revenue" | "asset" | "liability".
   * Callers use this to narrow the chart_of_accounts lookup.
   */
  suggestedAccountType?: string;
  /**
   * Account subtype hint (e.g. "utility", "concession", "bank_charge").
   * Combined with suggestedAccountType to guide COA lookup.
   */
  suggestedAccountSubtype?: string;
  /** When true, this mutation is an internal transfer (not a P&L item) */
  isInternalTransfer?: boolean;
  /** Arbitrary key-value metadata attached to this match */
  metadata?: Record<string, string>;
  /** Human-readable explanation */
  notes?: string;
  /** Confidence 0–100 for this specific rule action */
  confidence?: number;
}

/** One rule from the expense_rules table or built-in seed */
export interface ExpenseRule {
  id: number;
  companyId: number | null;   // null = global (applies to all companies)
  name: string;
  priority: number;           // lower = evaluated first
  conditions: RuleCondition[];
  action: RuleAction;
  isActive: boolean;
  createdAt?: string;
  updatedAt?: string;
}

/** Per-condition evaluation detail (useful for simulation/debug) */
export interface ConditionEvalDetail {
  condition: RuleCondition;
  passed: boolean;
  actualValue: string | boolean | number | undefined;
}

/** Result for one rule evaluated against a normalization result */
export interface RuleEvalDetail {
  rule: Pick<ExpenseRule, "id" | "name" | "priority">;
  matched: boolean;
  conditions: ConditionEvalDetail[];
}

/** Final output of the rule engine for a single mutation */
export interface RuleEngineResult {
  /** Whether any rule matched */
  matched: boolean;
  /** The winning rule, if any */
  matchedRule?: Pick<ExpenseRule, "id" | "name" | "priority">;
  /** Action from the winning rule */
  action?: RuleAction;
  /** Details of every evaluated rule (for simulation transparency) */
  evaluated: RuleEvalDetail[];
}

// ─── Built-in seed rules ──────────────────────────────────────────────────────
//
// These rules ship with the service and are mirrored in the expense_rules table
// via expenseRuleMigration.ts (idempotent seed). If the DB row is modified, the
// DB version wins at runtime; built-ins serve as a fallback when DB is unreachable.

export const BUILT_IN_RULES: ExpenseRule[] = [
  {
    id: -1,   // sentinel: negative IDs are built-in, never from DB
    companyId: null,
    name: "Konsesi",
    priority: 10,
    isActive: true,
    conditions: [
      { field: "category", operator: "eq", value: "concession" },
    ],
    action: {
      suggestedCategory: "concession",
      suggestedAccountType: "expense",
      suggestedAccountSubtype: "concession",
      notes: "Biaya konsesi / sewa area konsesi — beban operasional",
      confidence: 88,
    },
  },
  {
    id: -2,
    companyId: null,
    name: "Listrik dan Air — Listrik (PLN)",
    priority: 20,
    isActive: true,
    conditions: [
      { field: "category", operator: "eq", value: "utility_electricity" },
    ],
    action: {
      suggestedCategory: "utility",
      suggestedAccountType: "expense",
      suggestedAccountSubtype: "utility",
      metadata: { utility_type: "electricity", provider: "PLN" },
      notes: "Biaya listrik PLN — beban utilitas",
      confidence: 88,
    },
  },
  {
    id: -3,
    companyId: null,
    name: "Listrik dan Air — Air (PDAM)",
    priority: 21,
    isActive: true,
    conditions: [
      { field: "category", operator: "eq", value: "utility_water" },
    ],
    action: {
      suggestedCategory: "utility",
      suggestedAccountType: "expense",
      suggestedAccountSubtype: "utility",
      metadata: { utility_type: "water", provider: "PDAM" },
      notes: "Biaya air PDAM — beban utilitas",
      confidence: 88,
    },
  },
  {
    id: -4,
    companyId: null,
    name: "Ecommerce Settlement",
    priority: 30,
    isActive: true,
    conditions: [
      { field: "category", operator: "eq", value: "ecommerce" },
    ],
    action: {
      suggestedCategory: "ecommerce_settlement",
      suggestedAccountType: "revenue",
      suggestedAccountSubtype: "ecommerce",
      notes: "Penerimaan dari platform e-commerce (Shopee, Tokopedia, dll) — bukan beban",
      confidence: 85,
    },
  },
  {
    id: -5,
    companyId: null,
    name: "Kas Besar — Internal Transfer",
    priority: 5,   // highest priority: must be detected before anything else
    isActive: true,
    conditions: [
      { field: "is_internal_transfer", operator: "eq", value: "true" },
    ],
    action: {
      suggestedCategory: "internal_transfer",
      suggestedAccountType: "asset",
      suggestedAccountSubtype: "cash_bank",
      isInternalTransfer: true,
      metadata: { transfer_type: "kas_besar", skip_expense_creation: "true" },
      notes: "Transfer ke/dari kas besar — pemindahan dana internal, BUKAN beban P&L",
      confidence: 90,
    },
  },
  {
    id: -6,
    companyId: null,
    name: "Transfer Fee — Biaya Bank",
    priority: 40,
    isActive: true,
    conditions: [
      { field: "is_bank_fee", operator: "eq", value: "true" },
    ],
    action: {
      suggestedCategory: "bank_fee",
      suggestedAccountType: "expense",
      suggestedAccountSubtype: "bank_charge",
      metadata: { fee_type: "bank_admin", journal_treatment: "metadata_only" },
      notes: "Biaya transfer/admin bank — dicatat sebagai metadata bank, bukan beban terpisah",
      confidence: 85,
    },
  },
];

// ─── Condition evaluator ──────────────────────────────────────────────────────

function evaluateCondition(
  condition: RuleCondition,
  norm: NormalizationResult,
  context: { direction?: string } = {},
): ConditionEvalDetail {
  const { field, operator, value } = condition;

  let actual: string | boolean | number | undefined;

  switch (field as ConditionField) {
    case "category":
      actual = norm.category;
      break;
    case "normalized":
      actual = norm.normalized;
      break;
    case "provider":
      actual = norm.provider ?? "";
      break;
    case "token":
      actual = norm.tokens.join(" ");
      break;
    case "is_internal_transfer":
      actual = String(norm.isInternalTransfer);
      break;
    case "is_bank_fee":
      actual = String(norm.isBankFee);
      break;
    case "fee_type":
      actual = norm.feeType ?? "";
      break;
    case "confidence_gte":
      actual = norm.confidence;
      break;
    case "direction":
      actual = context.direction ?? "";
      break;
    default:
      actual = undefined;
  }

  let passed = false;
  const strActual = String(actual ?? "").toLowerCase();
  const strValue  = value.toLowerCase();

  switch (operator as ConditionOperator) {
    case "eq":
      passed = strActual === strValue;
      break;
    case "neq":
      passed = strActual !== strValue;
      break;
    case "contains":
      passed = strActual.includes(strValue);
      break;
    case "starts_with":
      passed = strActual.startsWith(strValue);
      break;
    case "regex":
      try {
        passed = new RegExp(value, "i").test(strActual);
      } catch {
        passed = false;
      }
      break;
    case "gte":
      passed = Number(actual ?? 0) >= Number(value);
      break;
    case "lte":
      passed = Number(actual ?? 0) <= Number(value);
      break;
  }

  return { condition, passed, actualValue: actual };
}

// ─── Rule evaluator ───────────────────────────────────────────────────────────

/** Evaluate one rule against a normalization result. Returns detail + pass/fail. */
export function evaluateRule(
  rule: ExpenseRule,
  norm: NormalizationResult,
  context: { direction?: string } = {},
): RuleEvalDetail {
  if (!rule.isActive || !rule.conditions.length) {
    return {
      rule: { id: rule.id, name: rule.name, priority: rule.priority },
      matched: false,
      conditions: [],
    };
  }

  const conditions = rule.conditions.map(c => evaluateCondition(c, norm, context));
  const matched = conditions.every(c => c.passed);

  return {
    rule: { id: rule.id, name: rule.name, priority: rule.priority },
    matched,
    conditions,
  };
}

// ─── Engine entry point ───────────────────────────────────────────────────────

/**
 * Evaluate a list of rules against a normalized description.
 *
 * @param rules   - Rules to evaluate (typically: DB rules merged with built-ins)
 * @param norm    - Normalization result from bankDescriptionNormalizer
 * @param context - Optional runtime context (e.g. direction IN/OUT)
 *
 * Rules are sorted by priority ASC then id ASC. First matching rule wins.
 */
export function runRuleEngine(
  rules: ExpenseRule[],
  norm: NormalizationResult,
  context: { direction?: string } = {},
): RuleEngineResult {
  // Sort: priority ASC, id ASC (built-ins have negative IDs so come last if same priority)
  const sorted = [...rules].sort((a, b) => {
    if (a.priority !== b.priority) return a.priority - b.priority;
    return a.id - b.id;
  });

  const evaluated: RuleEvalDetail[] = [];
  let matchedRule: ExpenseRule | undefined;

  for (const rule of sorted) {
    const detail = evaluateRule(rule, norm, context);
    evaluated.push(detail);
    if (detail.matched && !matchedRule) {
      matchedRule = rule;
    }
  }

  if (!matchedRule) {
    return { matched: false, evaluated };
  }

  return {
    matched: true,
    matchedRule: {
      id: matchedRule.id,
      name: matchedRule.name,
      priority: matchedRule.priority,
    },
    action: matchedRule.action,
    evaluated,
  };
}

// ─── Merge helper ─────────────────────────────────────────────────────────────

/**
 * Merge DB rules with built-in rules.
 * DB rules override built-ins with the same name (case-insensitive).
 * DB rules with companyId=null are global; those with companyId apply only to that company.
 *
 * @param dbRules    - Rules fetched from expense_rules table
 * @param companyId  - Company context (null = global)
 */
export function mergeRules(
  dbRules: ExpenseRule[],
  companyId: number | null,
): ExpenseRule[] {
  // Filter DB rules: global (companyId=null) + company-specific
  const relevantDb = dbRules.filter(
    r => r.isActive && (r.companyId === null || r.companyId === companyId),
  );

  // Built-in names that are overridden by DB
  const dbNames = new Set(relevantDb.map(r => r.name.toLowerCase()));

  // Built-ins not overridden
  const fallbackBuiltIns = BUILT_IN_RULES.filter(
    b => !dbNames.has(b.name.toLowerCase()),
  );

  return [...relevantDb, ...fallbackBuiltIns];
}

// ─── Validation ───────────────────────────────────────────────────────────────

export interface RuleValidationError {
  field: string;
  message: string;
}

/** Validate rule input before INSERT/UPDATE. Returns empty array if valid. */
export function validateRule(input: {
  name?: unknown;
  priority?: unknown;
  conditions?: unknown;
  action?: unknown;
}): RuleValidationError[] {
  const errors: RuleValidationError[] = [];

  if (!input.name || typeof input.name !== "string" || !input.name.trim()) {
    errors.push({ field: "name", message: "name wajib diisi dan tidak boleh kosong" });
  }

  const prio = Number(input.priority ?? 50);
  if (isNaN(prio) || prio < 1 || prio > 999) {
    errors.push({ field: "priority", message: "priority harus angka antara 1–999" });
  }

  if (!Array.isArray(input.conditions) || input.conditions.length === 0) {
    errors.push({ field: "conditions", message: "minimal satu kondisi wajib ada" });
  } else {
    const validFields: ConditionField[] = [
      "category", "normalized", "provider", "token",
      "is_internal_transfer", "is_bank_fee", "fee_type",
      "confidence_gte", "direction",
    ];
    const validOps: ConditionOperator[] = ["eq", "neq", "contains", "starts_with", "regex", "gte", "lte"];

    (input.conditions as RuleCondition[]).forEach((c, i) => {
      if (!validFields.includes(c.field as ConditionField)) {
        errors.push({ field: `conditions[${i}].field`, message: `field tidak valid: ${c.field}` });
      }
      if (!validOps.includes(c.operator as ConditionOperator)) {
        errors.push({ field: `conditions[${i}].operator`, message: `operator tidak valid: ${c.operator}` });
      }
      if (c.value === undefined || c.value === null) {
        errors.push({ field: `conditions[${i}].value`, message: "value tidak boleh null/undefined" });
      }
      if (c.operator === "regex") {
        try { new RegExp(c.value); } catch {
          errors.push({ field: `conditions[${i}].value`, message: `regex tidak valid: ${c.value}` });
        }
      }
    });
  }

  if (!input.action || typeof input.action !== "object") {
    errors.push({ field: "action", message: "action wajib berupa object" });
  } else {
    const a = input.action as RuleAction;
    const validAccountTypes = ["expense", "revenue", "asset", "liability", undefined];
    if (a.suggestedAccountType && !validAccountTypes.includes(a.suggestedAccountType)) {
      errors.push({ field: "action.suggestedAccountType", message: `nilai tidak valid: ${a.suggestedAccountType}` });
    }
  }

  return errors;
}
