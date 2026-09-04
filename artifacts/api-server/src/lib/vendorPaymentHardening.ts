import type { PostingLine } from "./accounting.js";

export type VendorInvoiceLineForGate = {
  id?: number;
  subtotal: number | string;
  taxAmount?: number | string | null;
  coaAccountId?: number | null;
  coaResolutionStatus?: string | null;
  coaHint?: string | null;
};

export type VendorLineTaxForGate = {
  invoiceLineId: number;
  taxType?: string | null;
  taxObject?: string | null;
  taxAmount: number | string;
  liabilityAccountId?: number | null;
  resolutionStatus?: string | null;
  withholdingRecordStatus?: string | null;
};

export type ThreeWayLineForGate = {
  poLineId: number;
  invoiceQuantity: number;
  invoiceUnitPrice: number;
  acceptedQuantity: number;
  poUnitPrice: number;
};

export type GateReason = {
  code: string;
  message: string;
  lineId?: number;
};

const MONEY_TOLERANCE = 0.01;
const QTY_TOLERANCE = 0.005;

function money(value: number): number {
  return Math.round(value * 100) / 100;
}

function amount(value: unknown): number {
  const parsed = Number(value ?? 0);
  return Number.isFinite(parsed) ? parsed : 0;
}

export function normalizeVendorLineMappingKey(value: unknown): string {
  return String(value ?? "")
    .trim()
    .toLowerCase()
    .replace(/\s+/g, " ")
    .slice(0, 240);
}

export function evaluateVendorInvoiceCoaGate(
  lines: readonly VendorInvoiceLineForGate[],
): { ok: boolean; reasons: GateReason[] } {
  const reasons: GateReason[] = [];
  lines.forEach((line, index) => {
    const lineId = line.id ?? index + 1;
    if (!Number.isInteger(line.coaAccountId) || (line.coaAccountId ?? 0) <= 0) {
      reasons.push({
        code: "COA_CONFIRMATION_REQUIRED",
        message: `Line ${lineId} belum memiliki COA yang dikonfirmasi Finance.`,
        lineId,
      });
    } else if (line.coaResolutionStatus !== "confirmed") {
      reasons.push({
        code: "COA_CONFIRMATION_REQUIRED",
        message: `COA line ${lineId} masih berstatus ${line.coaResolutionStatus ?? "unresolved"}; coa_hint bukan konfirmasi.`,
        lineId,
      });
    }
  });
  return { ok: reasons.length === 0, reasons };
}

export function evaluateVendorWithholdingGate(
  taxes: readonly VendorLineTaxForGate[],
): { ok: boolean; reasons: GateReason[] } {
  const reasons: GateReason[] = [];
  for (const tax of taxes) {
    const lineId = tax.invoiceLineId;
    const taxAmount = amount(tax.taxAmount);
    if (taxAmount <= 0) continue;
    if (!tax.taxType?.trim() || !tax.taxObject?.trim()) {
      reasons.push({
        code: "TAX_REVIEW_REQUIRED",
        message: `PPh line ${lineId} belum memiliki jenis dan tax object yang pasti.`,
        lineId,
      });
    }
    if (!Number.isInteger(tax.liabilityAccountId) || (tax.liabilityAccountId ?? 0) <= 0) {
      reasons.push({
        code: "TAX_LIABILITY_REQUIRED",
        message: `Akun liabilitas PPh line ${lineId} belum dikonfirmasi Finance.`,
        lineId,
      });
    }
    if (!["confirmed", "approved"].includes(String(tax.resolutionStatus))) {
      reasons.push({
        code: "TAX_REVIEW_REQUIRED",
        message: `PPh line ${lineId} masih memerlukan tax_review.`,
        lineId,
      });
    }
    if (!["proof_pending", "proof_received", "posted"].includes(String(tax.withholdingRecordStatus))) {
      reasons.push({
        code: "WITHHOLDING_RECORD_REQUIRED",
        message: `Record withholding PPh line ${lineId} belum dibuat melalui tax review.`,
        lineId,
      });
    }
  }
  return { ok: reasons.length === 0, reasons };
}

export function evaluateVendorInvoicePostingGate(input: {
  lines: readonly VendorInvoiceLineForGate[];
  withholdingTaxes?: readonly VendorLineTaxForGate[];
  legacyTaxReviewStatus?: string | null;
  legacyWithholdingTaxType?: string | null;
  legacyWithholdingTaxAmount?: number | string | null;
}): { ok: boolean; reasons: GateReason[] } {
  const coa = evaluateVendorInvoiceCoaGate(input.lines);
  const withholding = evaluateVendorWithholdingGate(input.withholdingTaxes ?? []);
  const reasons = [...coa.reasons, ...withholding.reasons];

  // Preserve the safe behavior of legacy header-level OCR fields. They can
  // trigger review, but can never authorize posting.
  if (
    input.legacyTaxReviewStatus === "required" ||
    input.legacyWithholdingTaxType?.trim() ||
    amount(input.legacyWithholdingTaxAmount) > 0
  ) {
    reasons.push({
      code: "TAX_REVIEW_REQUIRED",
      message: "Data PPh header lama belum dipindahkan dan disetujui per line/tax object.",
    });
  }
  return { ok: reasons.length === 0, reasons };
}

export function evaluateThreeWayMatchLines(
  lines: readonly ThreeWayLineForGate[],
  inputTotals: { total: number; poTotal: number; tolerance?: number },
): { ok: boolean; reasons: GateReason[] } {
  const tolerance = inputTotals.tolerance ?? MONEY_TOLERANCE;
  const reasons: GateReason[] = [];
  const seen = new Set<number>();
  for (const line of lines) {
    if (seen.has(line.poLineId)) {
      reasons.push({ code: "DUPLICATE_PO_LINE", message: `PO line ${line.poLineId} muncul lebih dari sekali.`, lineId: line.poLineId });
      continue;
    }
    seen.add(line.poLineId);
    if (Math.abs(line.invoiceQuantity - line.acceptedQuantity) > QTY_TOLERANCE) {
      reasons.push({ code: "QUANTITY_OUT_OF_TOLERANCE", message: `Quantity PO/GR/invoice untuk line ${line.poLineId} di luar toleransi.`, lineId: line.poLineId });
    }
    if (Math.abs(line.invoiceUnitPrice - line.poUnitPrice) > tolerance) {
      reasons.push({ code: "PRICE_OUT_OF_TOLERANCE", message: `Harga line ${line.poLineId} di luar toleransi.`, lineId: line.poLineId });
    }
  }
  if (Math.abs(inputTotals.total - inputTotals.poTotal) > tolerance) {
    reasons.push({ code: "TOTAL_OUT_OF_TOLERANCE", message: "Total PO-GR-Invoice berada di luar toleransi yang dikonfigurasi." });
  }
  return { ok: reasons.length === 0, reasons };
}

export function buildGrossVendorInvoicePostingLines(input: {
  lines: ReadonlyArray<{ coaAccountId: number; subtotal: number; description?: string | null }>;
  ppnInputAccountId?: number | null;
  taxAmount: number;
  apAccountId: number;
  grandTotal: number;
}): PostingLine[] {
  const postingLines: PostingLine[] = input.lines.map((line) => ({
    accountId: line.coaAccountId,
    debit: money(line.subtotal),
    credit: 0,
    description: line.description ?? "Beban/Persediaan vendor invoice",
  }));
  if (input.taxAmount > 0 && input.ppnInputAccountId) {
    postingLines.push({
      accountId: input.ppnInputAccountId,
      debit: money(input.taxAmount),
      credit: 0,
      description: "PPN Masukan",
    });
  }
  postingLines.push({
    accountId: input.apAccountId,
    debit: 0,
    credit: money(input.grandTotal),
    description: "Hutang Usaha — gross vendor invoice",
  });
  return postingLines;
}

export function buildNetVendorPaymentPostingLines(input: {
  apAccountId: number;
  bankAccountId: number;
  grossPayment: number;
  withholdingByAccount: ReadonlyMap<number, number>;
  description?: string;
}): PostingLine[] {
  const gross = money(input.grossPayment);
  const withholdingTotal = [...input.withholdingByAccount.values()]
    .reduce((sum, value) => sum + money(value), 0);
  const lines: PostingLine[] = [{
    accountId: input.apAccountId,
    debit: gross,
    credit: 0,
    description: input.description ?? "Pelunasan Hutang Usaha gross",
  }];
  for (const [accountId, taxAmount] of input.withholdingByAccount) {
    lines.push({
      accountId,
      debit: 0,
      credit: money(taxAmount),
      description: "Utang PPh",
    });
  }
  lines.push({
    accountId: input.bankAccountId,
    debit: 0,
    credit: money(gross - withholdingTotal),
    description: "Pembayaran vendor net setelah PPh",
  });
  return lines;
}