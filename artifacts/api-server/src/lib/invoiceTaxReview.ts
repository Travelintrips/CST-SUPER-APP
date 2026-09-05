export interface InvoiceTaxReviewInput {
  withholdingTaxType?: unknown;
  taxObject?: unknown;
  withholdingAmount?: unknown;
}

export interface InvoiceTaxReview {
  required: boolean;
  status: "required" | "not_required";
  reasons: string[];
  withholding_tax_type: string | null;
  tax_object: string | null;
  withholding_amount: number | null;
}

/**
 * PPh is deliberately review-only here. A vendor invoice journal cannot safely
 * infer AP net and the correct liability account from OCR alone.
 */
export function buildInvoiceTaxReview(input: InvoiceTaxReviewInput): InvoiceTaxReview {
  const withholdingTaxType = typeof input.withholdingTaxType === "string"
    ? input.withholdingTaxType.trim()
    : null;
  const taxObject = typeof input.taxObject === "string"
    ? input.taxObject.trim()
    : null;
  const withholdingAmount = typeof input.withholdingAmount === "number" &&
    Number.isFinite(input.withholdingAmount)
    ? input.withholdingAmount
    : null;

  const reasons: string[] = [];
  if (withholdingTaxType || withholdingAmount != null) {
    reasons.push(
      "PPh terdeteksi; jurnal Utang PPh per jenis dan bukti potong belum boleh ditentukan otomatis.",
    );
    if (!withholdingTaxType) reasons.push("Jenis PPh belum terbaca dengan pasti.");
    if (!taxObject) reasons.push("Tax object belum terbaca dengan pasti.");
    if (withholdingAmount == null) reasons.push("Nilai PPh belum terbaca dengan pasti.");
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