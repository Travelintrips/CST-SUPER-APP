import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import {
  calculateProfitLossSummary,
  splitProfitLossExpenses,
} from "../lib/accounting/profitLoss.js";

function source(relativePath: string): string {
  return readFileSync(resolve(process.cwd(), relativePath), "utf8");
}

describe("profit and loss HPP separation", () => {
  it("classifies 5-10xx as HPP and 5-20xx/5-30xx as operating expense", () => {
    const expenses = [
      { code: "5-1000", amount: 250 },
      { code: "5-1010-CST", amount: 150 },
      { code: "5-2040", amount: 75 },
      { code: "5-3040-CST", amount: 25 },
    ];

    const { cogs, operatingExpenses } = splitProfitLossExpenses(expenses);

    expect(cogs.map((row) => row.code)).toEqual(["5-1000", "5-1010-CST"]);
    expect(operatingExpenses.map((row) => row.code)).toEqual(["5-2040", "5-3040-CST"]);
  });

  it("keeps gross profit and net income based on their separate subtotals", () => {
    const summary = calculateProfitLossSummary({
      revenue: 1_000,
      cogs: 400,
      operatingExpense: 100,
    });

    expect(summary).toMatchObject({
      totalRevenue: 1_000,
      totalCogs: 400,
      totalOperatingExpense: 100,
      totalExpense: 500,
      grossProfit: 600,
      netIncome: 500,
    });
    expect(summary.grossProfit).toBe(summary.totalRevenue - summary.totalCogs);
    expect(summary.netIncome).toBe(summary.grossProfit - summary.totalOperatingExpense);
  });

  it("keeps both API responses and both report presentations split into two sections", () => {
    const reportRoute = source("src/routes/accounting.ts");
    const hubRoute = source("src/routes/accountingHub.ts");
    const hubPage = source("../bizportal/src/pages/accounting/hub/profit-loss.tsx");
    const reportPage = source("../bizportal/src/pages/accounting/reports/profit-loss.tsx");

    expect(reportRoute).toContain("splitProfitLossExpenses(expenses)");
    expect(reportRoute).toContain("...summary");

    expect(hubRoute).toContain("THEN 'cogs'");
    expect(hubRoute).toContain("THEN 'operating_expense'");
    expect(hubRoute).toContain("total_operating_expense: summary.totalOperatingExpense");
    expect(hubRoute).toContain("gross_profit: summary.grossProfit");

    expect(hubPage).toContain('rows.filter(r => r.expense_group === "cogs")');
    expect(hubPage).toContain('rows.filter(r => r.expense_group === "operating_expense")');
    expect(hubPage).toContain('CardTitle className="text-base text-red-700">HPP');
    expect(hubPage).toContain('CardTitle className="text-base text-orange-700">Beban Operasional');

    expect(reportPage).toContain("accounts={data.cogs as PLAccount[]}");
    expect(reportPage).toContain("accounts={data.operatingExpenses as PLAccount[]}");
    expect(reportPage).toContain('label="HPP (Beban Pokok Penjualan)"');
    expect(reportPage).toContain('label="Beban Operasional"');
    expect(reportPage).toContain("Pendapatan − HPP");
  });
});