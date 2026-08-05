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
  | "counterparty_name"
  | "counterparty_account";

export type ConditionOperator =
  | "equals"
  | "contains"
  | "starts_with"
  | "ends_with"
  | "regex"
  | "greater_than"
  | "less_than"
  | "between";

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
  conditionType: string;                // always "SIMPLE" for now
  conditionField: ConditionField;
  conditionOperator: ConditionOperator;
  conditionValue: string;               // for "between": "min,max"
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

export interface ReconRuleMutationInput {
  description: string;
  reference?: string | null;
  amount: number;
  direction: "IN" | "OUT";
  bankAccountId?: number | null;
  counterpartyName?: string | null;
  counterpartyAccount?: string | null;
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

  const validFields: ConditionField[] = [
    "description", "reference", "amount", "direction",
    "bank_account", "counterparty_name", "counterparty_account",
  ];
  if (rule.conditionField && !validFields.includes(rule.conditionField as ConditionField)) {
    errors.push(`conditionField tidak valid: ${rule.conditionField}`);
  }

  const validOperators: ConditionOperator[] = [
    "equals", "contains", "starts_with", "ends_with",
    "regex", "greater_than", "less_than", "between",
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
    case "reference":          return (mutation.reference ?? "").toLowerCase();
    case "amount":             return Number(mutation.amount);
    case "direction":          return mutation.direction;
    case "bank_account":       return mutation.bankAccountId != null ? String(mutation.bankAccountId) : null;
    case "counterparty_name":  return (mutation.counterpartyName ?? "").toLowerCase();
    case "counterparty_account": return (mutation.counterpartyAccount ?? "").toLowerCase();
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

    case "less_than": {
      const num = Number(rawValue);
      const threshold = Number(conditionValue);
      return !isNaN(num) && !isNaN(threshold) && num < threshold;
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
    counterparty_name: "COUNTERPARTY_NAME",
    counterparty_account: "COUNTERPARTY_ACCOUNT",
  };
  const opLabel: Record<ConditionOperator, string> = {
    equals: "EQUALS",
    contains: "CONTAINS",
    starts_with: "STARTS_WITH",
    ends_with: "ENDS_WITH",
    regex: "REGEX",
    greater_than: "GT",
    less_than: "LT",
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
    counterparty_name: "Nama pihak lawan",
    counterparty_account: "Rekening pihak lawan",
  };
  const opDesc: Record<ConditionOperator, string> = {
    equals: "sama dengan",
    contains: "mengandung",
    starts_with: "dimulai dengan",
    ends_with: "diakhiri dengan",
    regex: "cocok pola",
    greater_than: "lebih besar dari",
    less_than: "lebih kecil dari",
    between: "antara",
  };
  return `${fieldName[field]} ${opDesc[operator]} "${value}"`;
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

  // Sort: priority DESC, id ASC as deterministic tie-breaker
  const sorted = [...rules].sort((a, b) => {
    if (b.priority !== a.priority) return b.priority - a.priority;
    return a.id - b.id;
  });

  for (const rule of sorted) {
    if (!rule.isActive) {
      evaluated.push({ ruleId: rule.id, ruleName: rule.name, matched: false });
      continue;
    }

    // Direction filter: if rule specifies a direction, mutation must match
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

    // Evaluate the condition
    const conditionPassed = evaluateCondition(
      mutation,
      rule.conditionField,
      rule.conditionOperator,
      rule.conditionValue,
    );

    evaluated.push({ ruleId: rule.id, ruleName: rule.name, matched: conditionPassed });

    if (conditionPassed) {
      const reasonCode = buildReasonCode(rule.conditionField, rule.conditionOperator);
      const reasonLabel = buildReasonLabel(rule.conditionField, rule.conditionOperator, rule.conditionValue);

      const result: ReconRuleMatchResult = {
        matched: true,
        ruleId: rule.id,
        ruleName: rule.name,
        targetType: rule.targetType,
        targetCoaCode: rule.targetCoaCode,
        confidence: rule.confidenceScore,
        reasons: [
          {
            code: reasonCode,
            label: reasonLabel,
            score: rule.confidenceScore,
          },
        ],
        stopProcessing: rule.stopProcessing,
        evaluated,
      };

      return result;
    }

    // stop_processing on a non-matching rule does NOT stop — only a match stops further rules
  }

  return { matched: false, evaluated };
}
