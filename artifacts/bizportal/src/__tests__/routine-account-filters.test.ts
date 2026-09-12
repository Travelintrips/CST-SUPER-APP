import { describe, expect, it } from "vitest";
import {
  filterRoutineExpenseAccounts,
  filterRoutineSourceAccounts,
} from "../pages/expense/routineAccountFilters";

describe("routine expense source account filter", () => {
  it("keeps eligible cash and bank accounts", () => {
    const accounts = [
      { id: 1, type: "asset", subtype: "cash_bank", name: "Kas Kecil", code: "1-100-01" },
      { id: 2, type: "asset", name: "Bank Operasional", code: "1-200-01" },
      { id: 3, type: "asset", name: "Rekening Giro", code: "1-101-99" },
      { id: 4, type: "asset", name: "Dana Kas", code: "1-102-77" },
    ];

    expect(filterRoutineSourceAccounts(accounts).map((account) => account.id)).toEqual([1, 2, 3, 4]);
  });

  it("excludes inactive, header, non-postable, and non-cash/bank accounts", () => {
    const accounts = [
      { id: 1, type: "asset", subtype: "cash_bank", name: "Kas Tidak Aktif", isActive: false },
      { id: 2, type: "asset", subtype: "cash_bank", name: "Bank Header", isHeader: true },
      { id: 3, type: "asset", subtype: "cash_bank", name: "Kas Non-postable", isPostable: false },
      { id: 4, type: "asset", subtype: "inventory", name: "Persediaan", code: "1-300-01" },
      { id: 5, type: "liability", subtype: "cash_bank", name: "Bank Hutang" },
    ];

    expect(filterRoutineSourceAccounts(accounts)).toEqual([]);
  });
});

describe("routine expense account filter", () => {
  it("keeps postable active expense accounts across company-specific COA formats", () => {
    const accounts = [
      { id: 1, type: "expense", name: "Beban Operasional", code: "6-100-01" },
      { id: 2, type: "expense", name: "Beban Operasional Cabang", code: "EXP-CABANG-A-01" },
      { id: 3, type: "expense", name: "Beban Operasional Unit", code: "7.01.02" },
    ];

    expect(filterRoutineExpenseAccounts(accounts).map((account) => account.id)).toEqual([1, 2, 3]);
  });

  it("excludes inactive, header, non-postable, and non-expense accounts", () => {
    const accounts = [
      { id: 1, type: "expense", name: "Beban Tidak Aktif", isActive: false },
      { id: 2, type: "expense", name: "Beban Header", isHeader: true },
      { id: 3, type: "expense", name: "Beban Non-postable", isPostable: false },
      { id: 4, type: "asset", name: "Kas" },
      { id: 5, type: "income", name: "Pendapatan" },
    ];

    expect(filterRoutineExpenseAccounts(accounts)).toEqual([]);
  });
});