export type NormalizedExpenseLine = {
  lineNo: number;
  description: string;
  qty: number;
  unit: string | null;
  unitPrice: number;
  subtotal: number;
  taxAmount: number;
  total: number;
  coaAccountId: number;
};

export function roundMoney(value: number) {
  return Math.round(value * 100) / 100;
}

export function normalizeExpenseLines(
  rawLines: unknown,
  fallback: { description?: unknown; qty?: unknown; unit?: unknown; unitPrice?: unknown; expenseAccountId?: unknown },
): NormalizedExpenseLine[] {
  const source = Array.isArray(rawLines) && rawLines.length > 0
    ? rawLines
    : [{
        description: fallback.description,
        qty: fallback.qty,
        unit: fallback.unit,
        unitPrice: fallback.unitPrice,
        coaAccountId: fallback.expenseAccountId,
      }];

  const lines = source.map((raw: any, index) => {
    const qty = Number(raw?.qty ?? raw?.quantity ?? 1);
    const unitPrice = Number(raw?.unitPrice ?? raw?.unit_price ?? 0);
    const coaAccountId = Number(raw?.coaAccountId ?? raw?.coa_account_id ?? raw?.expenseAccountId);
    if (!(qty > 0) || unitPrice < 0 || !Number.isInteger(coaAccountId) || coaAccountId <= 0) {
      throw new Error(`Line ${index + 1} wajib memiliki qty, nominal, dan COA existing yang valid.`);
    }
    const subtotal = roundMoney(qty * unitPrice);
    return {
      lineNo: index + 1,
      description: String(raw?.description ?? raw?.name ?? fallback.description ?? `Biaya line ${index + 1}`).trim(),
      qty,
      unit: raw?.unit ? String(raw.unit) : (fallback.unit ? String(fallback.unit) : null),
      unitPrice,
      subtotal,
      taxAmount: 0,
      total: subtotal,
      coaAccountId,
    };
  });
  if (lines.some((line) => !line.description)) throw new Error("Deskripsi setiap line wajib diisi.");
  return lines;
}

export function allocateExpenseTax(lines: NormalizedExpenseLine[], taxAmount: number) {
  const base = lines.reduce((sum, line) => sum + line.subtotal, 0);
  let allocated = 0;
  return lines.map((line, index) => {
    const tax = index === lines.length - 1
      ? roundMoney(taxAmount - allocated)
      : roundMoney(base > 0 ? taxAmount * line.subtotal / base : 0);
    allocated = roundMoney(allocated + tax);
    return { ...line, taxAmount: tax, total: roundMoney(line.subtotal + tax) };
  });
}