export interface InvoiceTaxReviewInput {
  withholdingTaxType?: unknown;
  taxObject?: unknown;
  withholdingAmount?: unknown;
  invoiceBreakdown?: unknown;
  forcedReviewReason?: string | null;
}

export interface InvoiceTaxReview {
  required: boolean;
  status: "required" | "not_required";
  reasons: string[];
  withholding_tax_type: string | null;
  tax_object: string | null;
  withholding_amount: number | null;
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

function asText(value: unknown): string | null {
  return typeof value === "string" && value.trim().length > 0
    ? value.trim()
    : null;
}

function asFiniteNumber(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  return null;
}

/**
 * PPh is deliberately review-only here. A vendor invoice journal cannot safely
 * infer AP net and the correct liability account from OCR alone.
 */
export function buildInvoiceTaxReview(input: InvoiceTaxReviewInput): InvoiceTaxReview {
  const breakdown = asRecord(input.invoiceBreakdown);
  const breakdownWithholding = asRecord(breakdown?.withholding_tax);
  const breakdownTotals = asRecord(breakdown?.totals);
  const withholdingTaxType =
    asText(input.withholdingTaxType) ??
    asText(breakdownWithholding?.type);
  const taxObject = asText(input.taxObject);
  const withholdingAmount =
    asFiniteNumber(input.withholdingAmount) ??
    asFiniteNumber(breakdownWithholding?.amount) ??
    asFiniteNumber(breakdownTotals?.withholding_tax_amount);
  const withholdingRate = asFiniteNumber(breakdownWithholding?.rate);
  const withholdingEvidence = asText(breakdownWithholding?.evidence);

  const reasons: string[] = [];
  if (
    withholdingTaxType ||
    withholdingAmount != null ||
    withholdingRate != null ||
    withholdingEvidence ||
    input.forcedReviewReason
  ) {
    reasons.push(
      "PPh terdeteksi; nominal invoice dapat dihitung, tetapi jurnal Utang PPh per jenis dan bukti potong resmi tetap perlu tax review.",
    );
    if (!withholdingTaxType) reasons.push("Jenis PPh belum terbaca dengan pasti.");
    if (!taxObject) reasons.push("Tax object belum terbaca dengan pasti.");
    if (withholdingAmount == null) reasons.push("Nilai PPh belum terbaca dengan pasti.");
    if (input.forcedReviewReason) reasons.push(input.forcedReviewReason);
  }

  return {
    required: reasons.length > 0,
    status: reasons.length > 0 ? "required" : "not_required",
    reasons,
    withholding_tax_type: withholdingTaxType,
    tax_object: taxObject,
    withholding_amount: withholdingAmount,
  };
}