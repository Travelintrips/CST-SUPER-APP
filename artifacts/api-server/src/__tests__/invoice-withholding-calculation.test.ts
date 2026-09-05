import { describe, expect, it } from "vitest";
import { applyWithholdingCalculations, extractWithholdingRateHints } from "../lib/invoiceWithholdingCalculation.js";

describe("invoice withholding calculation", () => {
  const sourceText = `
    Pendapatan Konsesi ( PPH PASAL 23 tarif 15%) 15.834.000 1.741.740 17.575.740
    Pemakaian Listrik ( PPH PASAL 4 AYAT 2 ( FINAL) tarif 10%) 10.962.796 1.205.908 12.168.704
    Pemakaian Air ( PPH PASAL 4 AYAT 2 ( FINAL) tarif 10%) 1.756.710 193.238 1.949.948
  `;

  it("extracts the printed PPh type and rate per component", () => {
    expect(extractWithholdingRateHints(sourceText)).toEqual([
      { component: "concession", type: "PPh 23", rate: 15 },
      { component: "electricity", type: "PPh 4(2)", rate: 10 },
      { component: "water", type: "PPh 4(2)", rate: 10 },
    ]);
  });

  it("calculates PPh from NET and payable from GROSS without using VAT", () => {
    const result = applyWithholdingCalculations(
      [
        { component: "concession", label: "Pendapatan Konsesi", dpp: 15834000, ppn: 1741740, gross: 17575740 },
        { component: "electricity", label: "Pemakaian Listrik", dpp: 10962796, ppn: 1205908, gross: 12168704 },
        { component: "water", label: "Pemakaian Air", dpp: 1756710, ppn: 193238, gross: 1949948 },
      ],
      { type: null, rate: null, amount: null, base_amount: null, evidence: null },
      { dpp: 28553506, ppn: 3140886, gross: 31694392 },
      sourceText,
    );

    expect(result.components.map((component) => component.withholding_tax_amount)).toEqual([
      2375100,
      1096280,
      175671,
    ]);
    expect(result.components.map((component) => component.payable_amount)).toEqual([
      15200640,
      11072424,
      1774277,
    ]);
    expect(result.withholding.amount).toBe(3647051);
    expect(result.totals.withholding_tax_amount).toBe(3647051);
    expect(result.totals.payable_amount).toBe(28047341);
    expect(result.withholding.calculation_method).toBe("calculated_from_printed_rate");
  });

  it("does not calculate when only a PPh label exists without a rate or base", () => {
    const result = applyWithholdingCalculations(
      [{ component: "other", label: "Jasa dengan PPh", dpp: null, ppn: null, gross: null }],
      { type: "PPh 23", rate: null, amount: null, base_amount: null, evidence: "PPh disebutkan" },
      { dpp: null, ppn: null, gross: null },
    );

    expect(result.components[0].withholding_tax_amount).toBeNull();
    expect(result.components[0].payable_amount).toBeNull();
    expect(result.totals.withholding_tax_amount).toBeNull();
    expect(result.totals.payable_amount).toBeNull();
  });
});