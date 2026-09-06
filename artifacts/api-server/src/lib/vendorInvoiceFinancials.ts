import { buildSapTaxInput } from "./sapTaxEngine.js";

export interface VendorInvoiceFinancialAmounts {
  subtotal: number;
  taxAmount: number;
  grandTotal: number;
}

/**
 * Resolve invoice financial amounts using the same evidence policy used when
 * posting a vendor invoice. Older OCR rows can have tax_amount = 0 even when
 * invoice_breakdown contains an explicit PPN value.
 */
export function resolveVendorInvoiceFinancialAmounts(input: {
  totalAmount: unknown;
  taxAmount: unknown;
  grandTotal: unknown;
  invoiceBreakdown?: unknown;
}): VendorInvoiceFinancialAmounts {
  const subtotal = Number(input.totalAmount ?? 0);
  const taxAmount = Number(input.taxAmount ?? 0);
  const grandTotal = Number(input.grandTotal ?? 0);
  const resolved = buildSapTaxInput({
    subtotal,
    tax: taxAmount,
    total_amount: grandTotal,
    invoice_breakdown: input.invoiceBreakdown,
  });

  return {
    subtotal: resolved.net ?? subtotal,
    taxAmount: resolved.vat ?? taxAmount,
    grandTotal: resolved.gross ?? grandTotal,
  };
}