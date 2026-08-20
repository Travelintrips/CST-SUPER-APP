import { afterEach, describe, expect, it } from "vitest";
import { getSportCenterFinanceMode, isCentralFinanceMode, shouldRunLegacyFinanceWrites } from "../lib/financeBoundary.js";

const original = process.env.SPORT_CENTER_FINANCE_MODE;

afterEach(() => {
  if (original == null) delete process.env.SPORT_CENTER_FINANCE_MODE;
  else process.env.SPORT_CENTER_FINANCE_MODE = original;
});

describe("central finance mode boundary", () => {
  it("defaults safely to legacy", () => {
    delete process.env.SPORT_CENTER_FINANCE_MODE;
    expect(getSportCenterFinanceMode()).toBe("legacy");
    expect(shouldRunLegacyFinanceWrites()).toBe(true);
  });

  it("enables central only explicitly", () => {
    process.env.SPORT_CENTER_FINANCE_MODE = "central";
    expect(isCentralFinanceMode()).toBe(true);
    expect(shouldRunLegacyFinanceWrites()).toBe(false);
  });

  it("fails closed for unsupported values", () => {
    process.env.SPORT_CENTER_FINANCE_MODE = "unsupported";
    expect(getSportCenterFinanceMode()).toBe("legacy");
  });
});