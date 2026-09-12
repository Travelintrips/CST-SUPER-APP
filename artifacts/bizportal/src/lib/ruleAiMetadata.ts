export interface RuleAiMetadataForm {
  name: string;
  description: string;
  referenceAmount: string;
  amountTolerance: string;
  confidence: string;
  priority: string;
  candidateRequirement?: "required" | "not_required";
}

export interface EditableRuleAiFields {
  reference_amount: number | null;
  amount_tolerance: number;
  confidence: number;
  priority: number;
  candidate_requirement: "required" | "not_required";
}

interface RuleAiMutation {
  id: number;
  description: string;
  direction: "IN" | "OUT";
  provider_order_id?: string | null;
  company_id?: number | null;
}

interface RuleAiCoa {
  code: string;
}

export function defaultRuleAiMetadata(mutation: RuleAiMutation): RuleAiMetadataForm {
  const description = String(mutation.description ?? "").trim();
  return {
    name: `Pemetaan COA — ${description}`.slice(0, 120),
    description: `Dibuat dari pemilihan COA pada mutasi bank #${mutation.id}`,
    referenceAmount: "",
    amountTolerance: "",
    confidence: "1",
    priority: "120",
    candidateRequirement: "not_required",
  };
}

/**
 * Converts the API row to the values expected by the Rule AI editor.
 *
 * Older rules may have stored their reference nominal in amount_tolerance.
 * Preserve that compatibility behavior when opening a rule so an edit does
 * not silently clear the existing nominal.
 */
export function editableRuleAiFieldsFromRow(row: Record<string, unknown>): EditableRuleAiFields {
  const referenceAmount = row.reference_amount != null && Number(row.reference_amount) !== 0
    ? Number(row.reference_amount)
    : row.amount_tolerance != null && Number(row.amount_tolerance) > 0
      ? Number(row.amount_tolerance)
      : null;

  return {
    reference_amount: referenceAmount,
    amount_tolerance: row.reference_amount != null && row.amount_tolerance != null
      ? Number(row.amount_tolerance)
      : 0,
    confidence: Number(row.confidence ?? 0.8),
    priority: Number(row.priority ?? 50),
    candidate_requirement: row.candidate_requirement === "required" ? "required" : "not_required",
  };
}

export function buildManualRuleAiPayload(
  mutation: RuleAiMutation,
  selectedCoa: RuleAiCoa,
  metadata: RuleAiMetadataForm,
  companyId: number,
) {
  const description = String(mutation.description ?? "").trim();
  if (!description) {
    throw new Error("Deskripsi mutasi wajib tersedia untuk membuat Rule AI");
  }

  const ruleName = metadata.name.trim();
  if (!ruleName) {
    throw new Error("Nama Rule AI wajib diisi");
  }

  const confidence = Number(metadata.confidence);
  if (!Number.isFinite(confidence) || confidence < 0 || confidence > 1) {
    throw new Error("Confidence harus berupa angka antara 0 dan 1");
  }

  const priority = Number(metadata.priority);
  if (!Number.isSafeInteger(priority) || priority < 1 || priority > 999) {
    throw new Error("Prioritas harus berupa angka bulat antara 1 dan 999");
  }

  const referenceAmount = metadata.referenceAmount.trim() === ""
    ? null
    : Number(metadata.referenceAmount);
  const amountTolerance = metadata.amountTolerance.trim() === ""
    ? null
    : Number(metadata.amountTolerance);

  if (referenceAmount !== null && (!Number.isFinite(referenceAmount) || referenceAmount < 0)) {
    throw new Error("Nominal referensi harus berupa angka nol atau lebih");
  }
  if (amountTolerance !== null && (!Number.isFinite(amountTolerance) || amountTolerance < 0)) {
    throw new Error("Toleransi nominal harus berupa angka nol atau lebih");
  }
  if (amountTolerance !== null && amountTolerance > 0 && referenceAmount === null) {
    throw new Error("Nominal referensi wajib diisi jika toleransi nominal lebih besar dari nol");
  }

  const ruleAiReference = String(mutation.provider_order_id ?? "").trim();
  const primaryCondition = ruleAiReference
    ? { field: "reference", operator: "equals", value: ruleAiReference }
    : { field: "description", operator: "contains", value: description };
  const conditions = [
    primaryCondition,
    { field: "direction", operator: "equals", value: mutation.direction },
  ];

  return {
    name: ruleName,
    description: metadata.description.trim() || null,
    condition_field: primaryCondition.field,
    condition_operator: primaryCondition.operator,
    condition_value: primaryCondition.value,
    conditions,
    logic: "AND" as const,
    specificity: conditions.length,
    action_flow: mutation.direction === "IN"
      ? "INCOME_ALLOCATION"
      : "ROUTINE_EXPENSE_ALLOCATION",
    action_coa_code: selectedCoa.code,
    amount_tolerance: amountTolerance,
    reference_amount: referenceAmount,
    confidence,
    priority,
    candidate_requirement: metadata.candidateRequirement === "required" ? "required" : "not_required",
    source: "manual" as const,
    company_id: companyId,
  };
}