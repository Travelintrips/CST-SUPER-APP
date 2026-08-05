/**
 * PPJK Financial Service — Unit Tests
 * Tests decimal-safe backend calculation for all fee components.
 */
import { describe, it, expect } from "vitest";
import {
  calculatePpjkFinancials,
  PpjkFinancialError,
  PpjkFinancialInput,
} from "../lib/ppjkFinancialService.js";

describe("calculatePpjkFinancials", () => {
  describe("null / zero / empty inputs", () => {
    it("returns all zeros when no input is provided", () => {
      const result = calculatePpjkFinancials({});
      expect(result.grandTotal).toBe("0.00");
      expect(result.totalTagihanPabean).toBe("0.00");
      expect(result.totalServiceFee).toBe("0.00");
      expect(result.totalLogisticFee).toBe("0.00");
    });

    it("handles null values gracefully", () => {
      const result = calculatePpjkFinancials({
        beaMasuk: null,
        ppnImpor: null,
        serviceFee: null,
      });
      expect(result.grandTotal).toBe("0.00");
    });

    it("handles empty string values gracefully", () => {
      const result = calculatePpjkFinancials({
        beaMasuk: "",
        ppnImpor: "",
      });
      expect(result.grandTotal).toBe("0.00");
    });

    it("handles string zero values", () => {
      const result = calculatePpjkFinancials({ beaMasuk: "0", ppnImpor: "0.00" });
      expect(result.totalTagihanPabean).toBe("0.00");
    });
  });

  describe("decimal precision", () => {
    it("adds two decimal values without floating-point drift", () => {
      // 0.1 + 0.2 = 0.30 (not 0.30000000000000004)
      const result = calculatePpjkFinancials({ beaMasuk: "0.10", ppnImpor: "0.20" });
      expect(result.totalTagihanPabean).toBe("0.30");
    });

    it("handles large IDR amounts (100 billion)", () => {
      const result = calculatePpjkFinancials({
        beaMasuk: "100000000000.00",
        ppnImpor: "11000000000.00",
      });
      expect(result.totalTagihanPabean).toBe("111000000000.00");
    });

    it("handles typical PPJK order", () => {
      const result = calculatePpjkFinancials({
        beaMasuk: "5000000",
        ppnImpor: "2200000",
        pphImpor: "500000",
        serviceFee: "1500000",
        ppnServiceFee: "165000",
        storageFee: "200000",
        handlingFee: "300000",
      });
      expect(result.totalTagihanPabean).toBe("7700000.00");
      expect(result.totalServiceFee).toBe("1665000.00");
      expect(result.totalLogisticFee).toBe("500000.00");
      expect(result.grandTotal).toBe("9865000.00");
    });
  });

  describe("component validation", () => {
    it("all components appear in result", () => {
      const input: PpjkFinancialInput = {
        nilaiPabean: "100000000",
        beaMasuk: "5000000",
        ppnImpor: "2200000",
        pphImpor: "500000",
        bmtp: "1000000",
        bmad: "500000",
        storageFee: "200000",
        handlingFee: "300000",
        thc: "150000",
        doFee: "75000",
        forwardingFee: "600000",
        truckingFee: "800000",
        serviceFee: "1500000",
        ppnServiceFee: "165000",
        miscFee: "50000",
      };
      const result = calculatePpjkFinancials(input);
      expect(result.components.nilaiPabean).toBe("100000000.00");
      expect(result.components.bmtp).toBe("1000000.00");
      expect(result.components.bmad).toBe("500000.00");
      expect(result.components.thc).toBe("150000.00");
      expect(result.components.doFee).toBe("75000.00");
      expect(result.components.miscFee).toBe("50000.00");
      // Grand total should equal sum of all (except nilaiPabean which is the customs value base)
      const expectedGrand = 5000000 + 2200000 + 500000 + 1000000 + 500000
        + 200000 + 300000 + 150000 + 75000 + 600000 + 800000
        + 1500000 + 165000 + 50000;
      expect(result.grandTotal).toBe(`${expectedGrand}.00`);
    });
  });

  describe("negative rejection", () => {
    it("throws PpjkFinancialError for negative beaMasuk", () => {
      expect(() => calculatePpjkFinancials({ beaMasuk: "-1000" }))
        .toThrow(PpjkFinancialError);
    });

    it("error includes the field name", () => {
      try {
        calculatePpjkFinancials({ ppnImpor: "-500" });
        expect.fail("Should have thrown");
      } catch (err) {
        expect(err).toBeInstanceOf(PpjkFinancialError);
        expect((err as PpjkFinancialError).field).toBe("ppnImpor");
      }
    });
  });

  describe("invalid format rejection", () => {
    it("throws PpjkFinancialError for non-numeric string", () => {
      expect(() => calculatePpjkFinancials({ beaMasuk: "abc" }))
        .toThrow(PpjkFinancialError);
    });

    it("throws PpjkFinancialError for value with currency symbol", () => {
      expect(() => calculatePpjkFinancials({ serviceFee: "Rp 1.000.000" }))
        .toThrow(PpjkFinancialError);
    });
  });

  describe("large amount rejection", () => {
    it("throws PpjkFinancialError for value > 10 trillion", () => {
      expect(() => calculatePpjkFinancials({ beaMasuk: "10000000000001" }))
        .toThrow(PpjkFinancialError);
    });

    it("allows value exactly at 10 trillion limit", () => {
      // 10,000,000,000,000.00 — should not throw
      const result = calculatePpjkFinancials({ nilaiPabean: "10000000000000.00" });
      expect(result.components.nilaiPabean).toBe("10000000000000.00");
    });
  });

  describe("totalTagihanPabean formula", () => {
    it("= beaMasuk + ppnImpor + pphImpor + bmtp + bmad", () => {
      const result = calculatePpjkFinancials({
        beaMasuk: "1000000",
        ppnImpor: "110000",
        pphImpor: "50000",
        bmtp: "25000",
        bmad: "15000",
      });
      expect(result.totalTagihanPabean).toBe("1200000.00");
    });

    it("nilaiPabean does NOT contribute to totalTagihanPabean", () => {
      const without = calculatePpjkFinancials({ beaMasuk: "1000000" });
      const with_ = calculatePpjkFinancials({ beaMasuk: "1000000", nilaiPabean: "50000000" });
      expect(without.totalTagihanPabean).toBe(with_.totalTagihanPabean);
    });
  });

  describe("grandTotal formula", () => {
    it("= totalTagihanPabean + totalServiceFee + totalLogisticFee + miscFee", () => {
      const result = calculatePpjkFinancials({
        beaMasuk: "1000000",
        serviceFee: "500000",
        storageFee: "200000",
        miscFee: "100000",
      });
      // totalTagihanPabean=1000000, totalServiceFee=500000, totalLogisticFee=200000, misc=100000
      expect(result.grandTotal).toBe("1800000.00");
    });
  });
});
