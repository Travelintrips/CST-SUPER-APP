/**
 * Shared decision rules for OCR invoice tax posting.
 *
 * This module is pure by design: it does not read or mutate the database.
 * Posting code supplies the resolved company accounts separately.
 */

export type InvoiceTaxDirection = "purchase" | "sale";
export type InvoiceTaxType = "PPN" | "NONE";

export const OCR_AUTO_POST_CONFIDENCE = 0.9;
export const OCR_AUTO_POST_RAW_CONFIDENCE = 0.85;
export const TAX_AMOUNT_TOLERANCE = 100;

export interface InvoiceTaxGateInput {
  direction: InvoiceTaxDirection;
  net: number | null | undefined;
  vat: number | null | undefined;
  gross: number | null | undefined;
  confidence: number;
  rawConfidence?: number | null;
  taxType: InvoiceTaxType;
  validationIsValid: boolean;
  validationDifference?: number | null;
}

export interface InvoiceTaxGateResult {
  direction: InvoiceTaxDirection;
  taxAccountRole: "PPN_INPUT" | "PPN_OUTPUT" | "NONE";
  canAutoPost: boolean;
  requiresReview: boolean;
  reasons: string[];
}

export function taxAccountRoleForDirection(
  direction: InvoiceTaxDirection,
  taxType: InvoiceTaxType,
): "PPN_INPUT" | "PPN_OUTPUT" | "NONE" {
  if (taxType === "NONE") return "NONE";
  return direction === "purchase" ? "PPN_INPUT" : "PPN_OUTPUT";
}

export function isInvoiceTaxBalanced(
  net: number | null | undefined,
  vat: number | null | undefined,
  gross: number | null | undefined,
  tolerance = TAX_AMOUNT_TOLERANCE,
): boolean {
  if (![net, vat, gross].every((value) => typeof value === "number" && Number.isFinite(value))) {
    return false;
  }
  return Math.abs((net as number) + (vat as number) - (gross as number)) <= tolerance;
}

export function evaluateInvoiceTaxGate(input: InvoiceTaxGateInput): InvoiceTaxGateResult {
  const reasons: string[] = [];
  const role = taxAccountRoleForDirection(input.direction, input.taxType);

  if (!isInvoiceTaxBalanced(input.net, input.vat, input.gross)) {
    reasons.push("DPP + PPN tidak sama dengan total invoice dalam toleransi yang diizinkan.");
  }
  if (!input.validationIsValid) {
    reasons.push("Validasi header invoice gagal.");
  }
  if (input.confidence < OCR_AUTO_POST_CONFIDENCE) {
    reasons.push("Confidence SAP Tax di bawah batas auto-post.");
  }
  if (
    input.rawConfidence != null &&
    input.rawConfidence < OCR_AUTO_POST_RAW_CONFIDENCE
  ) {
    reasons.push("Confidence OCR di bawah batas auto-post.");
  }
  if (input.taxType === "PPN" && !(typeof input.vat === "number" && input.vat > 0)) {
    reasons.push("Invoice diklasifikasikan PPN tetapi nilai PPN tidak tersedia.");
  }
  if (
    input.validationDifference != null &&
    Math.abs(input.validationDifference) > TAX_AMOUNT_TOLERANCE
  ) {
    reasons.push("Selisih header invoice melebihi toleransi.");
  }

  return {
    direction: input.direction,
    taxAccountRole: role,
    canAutoPost: reasons.length === 0,
    requiresReview: reasons.length > 0,
    reasons,
  };
}