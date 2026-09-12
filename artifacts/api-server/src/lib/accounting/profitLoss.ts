export interface ProfitLossAmountRow {
  amount: number;
}

export interface ProfitLossSummary {
  totalRevenue: number;
  totalCogs: number;
  totalOperatingExpense: number;
  totalExpense: number;
  grossProfit: number;
  netIncome: number;
}

/**
 * HPP is the 5-10xx branch; company leaf accounts may carry a suffix.
 */
export function isCogsAccountCode(code: string): boolean {
  return code === "5-1000" || code.startsWith("5-10");
}

export function splitProfitLossExpenses<T extends { code: string }>(
  expenses: readonly T[],
): { cogs: T[]; operatingExpenses: T[] } {
  return {
    cogs: expenses.filter((expense) => isCogsAccountCode(expense.code)),
    operatingExpenses: expenses.filter((expense) => !isCogsAccountCode(expense.code)),
  };
}

export function calculateProfitLossSummary({
  revenue,
  cogs,
  operatingExpense,
}: {
  revenue: number;
  cogs: number;
  operatingExpense: number;
}): ProfitLossSummary {
  const totalExpense = cogs + operatingExpense;
  return {
    totalRevenue: Math.round(revenue * 100) / 100,
    totalCogs: Math.round(cogs * 100) / 100,
    totalOperatingExpense: Math.round(operatingExpense * 100) / 100,
    totalExpense: Math.round(totalExpense * 100) / 100,
    grossProfit: Math.round((revenue - cogs) * 100) / 100,
    netIncome: Math.round((revenue - cogs - operatingExpense) * 100) / 100,
  };
}