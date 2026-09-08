import { describe, expect, it } from "vitest";
import { getVendorWithholdingAccountRule } from "../lib/vendorWithholdingAccountRules.js";

describe("vendor withholding account rules", () => {
  it.each([
    ["PPh 21", "2-1092-"],
    ["PPh Pasal 22", "2-1093-"],
    ["PPh Pasal 23", "2-1094-"],
    ["PPh 25", "2-1095-"],
    ["PPh Final Pasal 26", "2-1096-"],
    ["PPh Pasal 29", "2-1097-"],
    ["PPh 4(2)", "2-1098-"],
    ["PPh Final Pasal 4 Ayat 2", "2-1098-"],
    ["PPh 15", "2-1102-"],
  ])("maps %s to the correct liability prefix", (taxType, expectedPrefix) => {
    expect(getVendorWithholdingAccountRule(taxType)?.codePrefixes[0]).toBe(expectedPrefix);
  });

  it("does not guess an account for ambiguous tax text", () => {
    expect(getVendorWithholdingAccountRule("Pajak penghasilan")).toBeNull();
    expect(getVendorWithholdingAccountRule("PPh")).toBeNull();
  });
});