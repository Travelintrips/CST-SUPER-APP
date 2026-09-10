import { describe, expect, it } from "vitest";
import { resolveSheetBankAccountId } from "../lib/sheetConfigAccountBinding.js";

describe("Google Sheet config account binding", () => {
  const accounts = [
    { id: 11, digits: "111222333", companyId: 1 },
    { id: 22, digits: "999888777", companyId: 1 },
  ];

  it("uses the configured account instead of row text", () => {
    expect(resolveSheetBankAccountId({
      configuredAccountNumber: "999-888-777",
      rowBank: "111222333",
      rowDescription: "Transfer masuk",
      companyId: 1,
      accounts,
    })).toBe(22);
  });

  it("keeps two configs with different account numbers isolated", () => {
    const first = resolveSheetBankAccountId({
      configuredAccountNumber: "111222333",
      rowBank: "999888777",
      companyId: 1,
      accounts,
    });
    const second = resolveSheetBankAccountId({
      configuredAccountNumber: "999888777",
      rowBank: "111222333",
      companyId: 1,
      accounts,
    });

    expect(first).toBe(11);
    expect(second).toBe(22);
  });

  it("only falls back to row evidence for legacy configs without a configured account", () => {
    expect(resolveSheetBankAccountId({
      rowBank: "Bank Mandiri",
      rowDescription: "Mutasi rekening 999888777",
      companyId: 1,
      accounts,
    })).toBe(22);
  });

  it("fails closed on account identity when a configured number is unknown", () => {
    expect(resolveSheetBankAccountId({
      configuredAccountNumber: "000000000",
      rowDescription: "Transfer 111222333",
      companyId: 1,
      accounts,
    })).toBeNull();
  });
});