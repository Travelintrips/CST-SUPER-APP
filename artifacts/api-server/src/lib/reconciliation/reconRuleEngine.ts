/**
 * Recon Rule Engine
 *
 * Configurable per-company rule engine for bank reconciliation.
 * Rules are stored in the `recon_rules` table and evaluated against
 * incoming bank mutations BEFORE any AI/ERP matching.
 *
 * Key constraints:
 *  - Rules NEVER execute arbitrary code or expressions.
 *  - Regex is validated at save time; invalid patterns are rejected.
 *  - stop_processing=true halts evaluation after first match.
 *  - Manual rules have higher priority than AI matching.
 *  - company_id isolation is enforced at DB query level.
 *  - Each rule returns structured JSON with confidence + reasons[].
 */

// ─── Types ─────────────────────────────────────────────────────────────────────

export type ConditionField =
  | "description"
  | "reference"
  | "amount"
  | "direction"
  | "bank_account"
  | "bank"
  | "transaction_code"
  | "normalized"
  | "counterparty_name"
  | "counterparty_account";

export type ConditionOperator =
  | "equals"
  | "contains"
  | "not_contains"
  | "starts_with"
  | "ends_with"
  | "not_equals"
  | "eq"
  | "neq"
  | "regex"
  | "greater_than"
  | "less_than"
  | "gte"
  | "lte"
  | "between";

export interface ReconRuleCondition {
  field: ConditionField;
  operator: ConditionOperator;
  value: string;
  negate?: boolean;
}

export type TargetType =
  | "expense"
  | "customer_payment"
  | "vendor_payment"
  | "payroll"
  | "bank_fee"
  | "internal_transfer"
  | "intercompany_transfer"
  | "income"
  | "unknown";

export interface ReconRule {
  id: number;
  companyId: number;
  name: string;
  description: string | null;
  priority: number;           // higher = evaluated first (DESC)
  isActive: boolean;
  direction: "IN" | "OUT" | null;       // null = any direction
  bankAccountId: number | null;
  conditionType: string;
  conditionField: ConditionField;
  conditionOperator: ConditionOperator;
  conditionValue: string;               // for "between": "min,max"
  /** Optional stable AND/OR condition set. Legacy fields remain the first condition. */
  conditionsJson?: ReconRuleCondition[] | null;
  logic?: "AND" | "OR";
  specificity?: number;
  /** Maximum absolute difference from referenceAmount, in the mutation currency. */
  amountTolerance?: number | null;
  /** Amount captured when a reference rule was created. */
  referenceAmount?: number | null;
  /** A matching mutation must have a proof document before this rule can apply. */
  requiresDocumentUpload?: boolean;
  /** Optional tax routing selected in the Rule AI editor. */
  taxType?: "none" | "ppn_input" | "ppn_output";
  aiClassificationRuleId?: number | null;
  conditions?: RuleCondition[];
  targetType: TargetType;
  targetId: number | null;
  targetCoaCode: string | null;
  confidenceScore: number;              // 0–100 for this rule
  stopProcessing: boolean;
  matchCount: number;
  lastMatchedAt: string | null;
  createdBy: string | null;
  createdAt: string;
  updatedAt: string;
}

export type RuleLogic = "AND" | "OR";

export interface RuleCondition {
  field: ConditionField;
  operator: ConditionOperator;
  value: string;
  negate?: boolean;
}

export interface ReconRuleMutationInput {
  description: string;
  reference?: string | null;
  amount: number;
  direction: "IN" | "OUT";
  bankAccountId?: number | null;
  counterpartyName?: string | null;
  counterpartyAccount?: string | null;
  bank?: string | null;
  transactionCode?: string | null;
  normalizedDescription?: string | null;
  /** True when the bank mutation has at least one uploaded proof document. */
  hasDocumentUpload?: boolean;
  companyId: number;
}

export interface ReconRuleMatchReason {
  code: string;
  label: string;
  score: number;
}

export interface ReconRuleMatchResult {
  matched: boolean;
  ruleId?: number;
  ruleName?: string;
  targetType?: TargetType;
  targetCoaCode?: string | null;
  confidence?: number;
  reasons?: ReconRuleMatchReason[];
  stopProcessing?: boolean;
  ambiguityCode?: "AMBIGUOUS_RULE_MATCH";
  ambiguityReason?: string;
  documentRequired?: {
    ruleId: number;
    ruleName: string;
  };
  evaluated: Array<{ ruleId: number; ruleName: string; matched: boolean }>;
}

// ─── Validation ────────────────────────────────────────────────────────────────

/**
 * Validate a regex pattern — returns error message or null if valid.
 * Called at save time so we never store broken regexes.
 */
export function validateRegexPattern(pattern: string): string | null {
  if (!pattern || pattern.trim() === "") return "Pattern tidak boleh kosong";
  try {
    new RegExp(pattern);
    return null;
  } catch (e: any) {
    return `Regex tidak valid: ${e.message}`;
  }
}

/**
 * Validate a recon rule before persistence.
 * Returns array of error messages (empty = valid).
 */
export function validateReconRule(rule: Partial<ReconRule>): string[] {
  const errors: string[] = [];

  if (!rule.name?.trim()) errors.push("name wajib diisi");
  if (rule.priority === undefined || rule.priority === null) errors.push("priority wajib diisi");
  if (!rule.conditionField) errors.push("conditionField wajib diisi");
  if (!rule.conditionOperator) errors.push("conditionOperator wajib diisi");
  if (!rule.targetType) errors.push("targetType wajib diisi");

  if (rule.confidenceScore !== undefined) {
    if (rule.confidenceScore < 0 || rule.confidenceScore > 100) {
      errors.push("confidenceScore harus antara 0 dan 100");
    }
  }

  if (rule.conditionOperator === "regex" && rule.conditionValue) {
    const regexError = validateRegexPattern(rule.conditionValue);
    if (regexError) errors.push(regexError);
  }

  if (rule.conditionOperator === "between" && rule.conditionValue) {
    const parts = rule.conditionValue.split(",");
    if (parts.length !== 2 || isNaN(Number(parts[0])) || isNaN(Number(parts[1]))) {
      errors.push("Untuk operator 'between', conditionValue harus berformat 'min,max' (angka)");
    }
  }

  if (rule.amountTolerance !== undefined && rule.amountTolerance !== null) {
    if (!Number.isFinite(Number(rule.amountTolerance)) || Number(rule.amountTolerance) < 0) {
      errors.push("amountTolerance harus berupa angka nol atau lebih");
    }
    if (Number(rule.amountTolerance) > 0 && rule.referenceAmount == null) {
      errors.push("referenceAmount wajib diisi jika amountTolerance digunakan");
    }
  }

  if (rule.conditionsJson !== undefined && rule.conditionsJson !== null) {
    if (!Array.isArray(rule.conditionsJson) || rule.conditionsJson.length === 0) {
      errors.push("conditionsJson harus berisi minimal satu kondisi");
    } else {
      for (const condition of rule.conditionsJson) {
        if (!condition?.field || !condition?.operator || condition.value === undefined) {
          errors.push("Setiap kondisi harus memiliki field, operator, dan value");
        }
      }
    }
  }

  const validFields: ConditionField[] = [
    "description", "reference", "amount", "direction", "bank_account", "bank",
    "transaction_code", "normalized", "counterparty_name", "counterparty_account",
  ];
  if (rule.conditionField && !validFields.includes(rule.conditionField as ConditionField)) {
    errors.push(`conditionField tidak valid: ${rule.conditionField}`);
  }

  const validOperators: ConditionOperator[] = [
    "equals", "contains", "not_contains", "starts_with", "ends_with",
    "not_equals", "eq", "neq", "regex", "greater_than", "less_than",
    "gte", "lte", "between",
  ];
  if (rule.conditionOperator && !validOperators.includes(rule.conditionOperator as ConditionOperator)) {
    errors.push(`conditionOperator tidak valid: ${rule.conditionOperator}`);
  }

  const validTargetTypes: TargetType[] = [
    "expense", "customer_payment", "vendor_payment", "payroll",
    "bank_fee", "internal_transfer", "intercompany_transfer", "income", "unknown",
  ];
  if (rule.targetType && !validTargetTypes.includes(rule.targetType as TargetType)) {
    errors.push(`targetType tidak valid: ${rule.targetType}`);
  }

  return errors;
}

// ─── Condition Evaluation ──────────────────────────────────────────────────────

/** Extract the field value from a mutation input for a given condition field. */
function extractFieldValue(
  mutation: ReconRuleMutationInput,
  field: ConditionField,
): string | number | null {
  switch (field) {
    case "description":        return (mutation.description ?? "").toLowerCase();
    case "reference":          return mutation.reference == null ? null : mutation.reference.toLowerCase();
    case "amount":             return Number(mutation.amount);
    case "direction":          return mutation.direction;
    case "bank_account":       return mutation.bankAccountId != null ? String(mutation.bankAccountId) : null;
    case "counterparty_name":  return mutation.counterpartyName == null ? null : mutation.counterpartyName.toLowerCase();
    case "counterparty_account": return mutation.counterpartyAccount == null ? null : mutation.counterpartyAccount.toLowerCase();
    case "bank":                return mutation.bank == null ? null : mutation.bank.toLowerCase();
    case "transaction_code":    return mutation.transactionCode == null ? null : mutation.transactionCode.toLowerCase();
    case "normalized":          return mutation.normalizedDescription == null
      ? null
      : mutation.normalizedDescription.toLowerCase();
    default:                   return null;
  }
}

/** Evaluate one condition against a mutation. Returns true if condition passes. */
export function evaluateCondition(
  mutation: ReconRuleMutationInput,
  field: ConditionField,
  operator: ConditionOperator,
  conditionValue: string,
): boolean {
  const rawValue = extractFieldValue(mutation, field);
  if (rawValue === null || rawValue === undefined) return false;

  const strValue = String(rawValue).toLowerCase();
  const condLower = conditionValue.toLowerCase().trim();

  switch (operator) {
    case "equals":
      return strValue === condLower;

    case "contains":
      return strValue.includes(condLower);

    case "not_contains":
      return !strValue.includes(condLower);

    case "not_equals":
    case "neq":
      return strValue !== condLower;

    case "eq":
      return strValue === condLower;

    case "starts_with":
      return strValue.startsWith(condLower);

    case "ends_with":
      return strValue.endsWith(condLower);

    case "regex": {
      try {
        return new RegExp(conditionValue, "i").test(strValue);
      } catch {
        return false;
      }
    }

    case "greater_than": {
      const num = Number(rawValue);
      const threshold = Number(conditionValue);
      return !isNaN(num) && !isNaN(threshold) && num > threshold;
    }

    case "gte": {
      const num = Number(rawValue);
      const threshold = Number(conditionValue);
      return !isNaN(num) && !isNaN(threshold) && num >= threshold;
    }

    case "less_than": {
      const num = Number(rawValue);
      const threshold = Number(conditionValue);
      return !isNaN(num) && !isNaN(threshold) && num < threshold;
    }

    case "lte": {
      const num = Number(rawValue);
      const threshold = Number(conditionValue);
      return !isNaN(num) && !isNaN(threshold) && num <= threshold;
    }

    case "between": {
      const num = Number(rawValue);
      const parts = conditionValue.split(",");
      if (parts.length !== 2) return false;
      const min = Number(parts[0]);
      const max = Number(parts[1]);
      return !isNaN(num) && !isNaN(min) && !isNaN(max) && num >= min && num <= max;
    }

    default:
      return false;
  }
}

/** Build a human-readable reason code for a condition match. */
function buildReasonCode(field: ConditionField, operator: ConditionOperator): string {
  const fieldLabel: Record<ConditionField, string> = {
    description: "DESCRIPTION",
    reference: "REFERENCE",
    amount: "AMOUNT",
    direction: "DIRECTION",
    bank_account: "BANK_ACCOUNT",
    bank: "BANK",
    transaction_code: "TRANSACTION_CODE",
    normalized: "NORMALIZED",
    counterparty_name: "COUNTERPARTY_NAME",
    counterparty_account: "COUNTERPARTY_ACCOUNT",
  };
  const opLabel: Record<ConditionOperator, string> = {
    equals: "EQUALS",
    contains: "CONTAINS",
    not_contains: "NOT_CONTAINS",
    starts_with: "STARTS_WITH",
    ends_with: "ENDS_WITH",
    not_equals: "NOT_EQUALS",
    eq: "EQUALS",
    neq: "NOT_EQUALS",
    regex: "REGEX",
    greater_than: "GT",
    less_than: "LT",
    gte: "GTE",
    lte: "LTE",
    between: "BETWEEN",
  };
  return `RULE_${fieldLabel[field]}_${opLabel[operator]}`;
}

function buildReasonLabel(field: ConditionField, operator: ConditionOperator, value: string): string {
  const fieldName: Record<ConditionField, string> = {
    description: "Deskripsi",
    reference: "Referensi",
    amount: "Nominal",
    direction: "Arah",
    bank_account: "Rekening bank",
    bank: "Bank",
    transaction_code: "Kode transaksi",
    normalized: "Deskripsi ternormalisasi",
    counterparty_name: "Nama pihak lawan",
    counterparty_account: "Rekening pihak lawan",
  };
  const opDesc: Record<ConditionOperator, string> = {
    equals: "sama dengan",
    contains: "mengandung",
    not_contains: "tidak mengandung",
    starts_with: "dimulai dengan",
    ends_with: "diakhiri dengan",
    not_equals: "tidak sama dengan",
    eq: "sama dengan",
    neq: "tidak sama dengan",
    regex: "cocok pola",
    greater_than: "lebih besar dari",
    less_than: "lebih kecil dari",
    gte: "lebih besar atau sama dengan",
    lte: "lebih kecil atau sama dengan",
    between: "antara",
  };
  return `${fieldName[field]} ${opDesc[operator]} "${value}"`;
}

function getRuleConditions(rule: ReconRule): ReconRuleCondition[] {
  if (Array.isArray(rule.conditionsJson) && rule.conditionsJson.length > 0) {
    return rule.conditionsJson;
  }
  if (Array.isArray(rule.conditions) && rule.conditions.length > 0) {
    return rule.conditions;
  }
  return [{
    field: rule.conditionField,
    operator: rule.conditionOperator,
    value: rule.conditionValue,
  }];
}

// ─── Core Rule Evaluation ──────────────────────────────────────────────────────

/**
 * Evaluate a list of recon rules against a mutation.
 *
 * Sort order: priority DESC, then created_at ASC (deterministic tie-breaker).
 * Returns the first matching rule result (stop_processing respected).
 */
export function evaluateReconRules(
  rules: ReconRule[],
  mutation: ReconRuleMutationInput,
): ReconRuleMatchResult {
  const evaluated: Array<{ ruleId: number; ruleName: string; matched: boolean }> = [];
  const matching: Array<{ rule: ReconRule; reasons: ReconRuleMatchReason[] }> = [];
  let documentRequired: ReconRuleMatchResult["documentRequired"];

  // Priority first; specificity makes business-context rules win over broad
  // signals without relying on creation order.
  const sorted = [...rules].sort((a, b) => {
    if (b.priority !== a.priority) return b.priority - a.priority;
    if ((b.specificity ?? 0) !== (a.specificity ?? 0)) {
      return (b.specificity ?? 0) - (a.specificity ?? 0);
    }
    if (b.confidenceScore !== a.confidenceScore) return b.confidenceScore - a.confidenceScore;
    return a.id - b.id;
  });

  let stopAfterPriority: number | null = null;
  for (const rule of sorted) {
    if (stopAfterPriority !== null && rule.priority < stopAfterPriority) break;
    if (!rule.isActive) {
      evaluated.push({ ruleId: rule.id, ruleName: rule.name, matched: false });
      continue;
    }

    if (rule.direction && rule.direction !== mutation.direction) {
      evaluated.push({ ruleId: rule.id, ruleName: rule.name, matched: false });
      continue;
    }

    // Bank account filter: if rule specifies a bank account, mutation must match
    if (rule.bankAccountId !== null && rule.bankAccountId !== undefined) {
      if (mutation.bankAccountId !== rule.bankAccountId) {
        evaluated.push({ ruleId: rule.id, ruleName: rule.name, matched: false });
        continue;
      }
    }

    // Company isolation: already enforced at DB query level, but double-check
    if (rule.companyId !== mutation.companyId) {
      evaluated.push({ ruleId: rule.id, ruleName: rule.name, matched: false });
      continue;
    }

    // Evaluate every configured condition. A multi-condition rule is
    // deliberately fail-closed: AND requires all conditions, and a negated
    // condition must not pass merely because its source field is missing.
    const conditions = getRuleConditions(rule);
    const conditionResults = conditions.map(condition => {
      // A negated predicate must not turn missing evidence into a match.
      // This is especially important for rules such as "not_contains X":
      // an absent reference/bank field is not proof of the negative.
      if (condition.negate && extractFieldValue(mutation, condition.field) == null) {
        return false;
      }
      const passed = evaluateCondition(
        mutation,
        condition.field,
        condition.operator,
        String(condition.value ?? ""),
      );
      return condition.negate ? !passed : passed;
    });
    const conditionsPassed = rule.logic === "OR"
      ? conditionResults.some(Boolean)
      : conditionResults.every(Boolean);
    // `referenceAmount` is the nominal criterion. A missing tolerance means
    // exact equality; tolerance is only an optional compatibility extension
    // for rules that explicitly need a range around that reference.
    const hasStoredReferenceAmount = rule.referenceAmount !== null
      && rule.referenceAmount !== undefined
      && Number.isFinite(Number(rule.referenceAmount));
    const hasPositiveTolerance = rule.amountTolerance !== null
      && rule.amountTolerance !== undefined
      && Number(rule.amountTolerance) > 0;
    // The first version of the Rule AI form wrote its nominal input to
    // amount_tolerance. Only linked AI mirrors may use that value as a
    // legacy exact reference; an independent operational rule with a
    // tolerance but no reference remains invalid and fails closed.
    const isLegacyAiReference = !hasStoredReferenceAmount
      && rule.aiClassificationRuleId != null
      && hasPositiveTolerance
      && Number.isFinite(Number(rule.amountTolerance));
    const referenceAmount = hasStoredReferenceAmount
      ? Number(rule.referenceAmount)
      : isLegacyAiReference
        ? Number(rule.amountTolerance)
        : null;
    const hasReferenceAmount = referenceAmount !== null;
    // A positive tolerance without a reference is invalid and must fail
    // closed. A zero/default tolerance without a reference is treated as
    // "no nominal criterion", which keeps ordinary description rules usable.
    const amountPassed = hasPositiveTolerance && !hasReferenceAmount
      ? false
      : !hasReferenceAmount
        ? true
        : Number.isFinite(Number(mutation.amount))
          && Math.abs(Number(mutation.amount) - referenceAmount)
            <= (isLegacyAiReference ? 0 : hasPositiveTolerance ? Number(rule.amountTolerance) : 0);
    const conditionPassed = conditionsPassed && amountPassed;
    if (conditionPassed && rule.requiresDocumentUpload && !mutation.hasDocumentUpload) {
      evaluated.push({ ruleId: rule.id, ruleName: rule.name, matched: false });
      documentRequired ??= { ruleId: rule.id, ruleName: rule.name };
      continue;
    }
    evaluated.push({ ruleId: rule.id, ruleName: rule.name, matched: conditionPassed });
    if (conditionPassed) {
      const reasons: ReconRuleMatchReason[] = conditions.map((condition, index) => ({
        code: `${buildReasonCode(condition.field, condition.operator)}_${index + 1}`,
        label: `${condition.negate ? "Bukan " : ""}${buildReasonLabel(
          condition.field,
          condition.operator,
          String(condition.value ?? ""),
        )}`,
        score: rule.confidenceScore,
      }));
      if (hasReferenceAmount) {
        reasons.push({
          code: isLegacyAiReference
            ? "RULE_AMOUNT_REFERENCE"
            : hasPositiveTolerance
              ? "RULE_AMOUNT_WITHIN_TOLERANCE"
              : "RULE_AMOUNT_REFERENCE",
          label: isLegacyAiReference || !hasPositiveTolerance
            ? `Nominal ${mutation.amount} sama dengan nominal referensi ${referenceAmount}`
            : `Nominal ${mutation.amount} berada dalam toleransi ±${rule.amountTolerance} dari referensi ${referenceAmount}`,
          score: rule.confidenceScore,
        });
      }

      matching.push({ rule, reasons });
      // Still inspect rules tied on precedence so conflicting actions fail closed.
      // Once the tie group is complete, lower-priority rules cannot override it.
      if (rule.stopProcessing) stopAfterPriority = rule.priority;
    }
  }

  if (documentRequired) return { matched: false, documentRequired, evaluated };
  if (matching.length === 0) return { matched: false, evaluated };
  const top = matching[0];
  const contenders = matching.filter(candidate =>
    candidate.rule.priority === top.rule.priority &&
    (candidate.rule.specificity ?? 0) === (top.rule.specificity ?? 0) &&
    candidate.rule.confidenceScore === top.rule.confidenceScore
  );
  const outputs = new Set(contenders.map(candidate =>
    `${candidate.rule.targetType}:${candidate.rule.targetCoaCode ?? ""}`,
  ));
  if (outputs.size > 1) {
    return {
      matched: false,
      ambiguityCode: "AMBIGUOUS_RULE_MATCH",
      ambiguityReason: "Beberapa rule dengan prioritas, spesifisitas, dan confidence setara menghasilkan action berbeda.",
      evaluated,
    };
  }
  return {
    matched: true,
    ruleId: top.rule.id,
    ruleName: top.rule.name,
    targetType: top.rule.targetType,
    targetCoaCode: top.rule.targetCoaCode,
    confidence: top.rule.confidenceScore,
    reasons: top.reasons,
    stopProcessing: top.rule.stopProcessing,
    evaluated,
  };
}
