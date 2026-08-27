import { describe, expect, it } from "vitest";
import {
  PortalCompanyScopeError,
  resolveOwnedActiveCompanyId,
} from "../lib/services/portalCompanyScope.js";

const ownedActive = (portalCustomerId: number, companyId: number, isActive = true) => ({
  portalCustomerId,
  companyId,
  isActive,
});

describe("Customer Portal RFQ company membership boundary", () => {
  it("blocks a customer with no membership", () => {
    expect(resolveOwnedActiveCompanyId([], 10)).toBeNull();
    expect(() => resolveOwnedActiveCompanyId([], 10, { required: true }))
      .toThrowError(new PortalCompanyScopeError(422, "Customer Portal belum memiliki membership perusahaan aktif."));
  });

  it("blocks an inactive membership", () => {
    expect(resolveOwnedActiveCompanyId([ownedActive(10, 1, false)], 10)).toBeNull();
    expect(() => resolveOwnedActiveCompanyId([ownedActive(10, 1, false)], 10, { required: true }))
      .toThrow(/belum memiliki membership perusahaan aktif/);
  });

  it("allows exactly one active membership owned by the session customer", () => {
    expect(resolveOwnedActiveCompanyId([ownedActive(10, 1)], 10, { required: true })).toBe(1);
  });

  it("does not allow a forged company ID that is not an active membership", () => {
    const rows = [ownedActive(10, 1)];
    expect(resolveOwnedActiveCompanyId(rows, 10, { required: true })).toBe(1);
    expect(rows.some((row) => row.portalCustomerId === 10 && row.companyId === 999 && row.isActive)).toBe(false);
  });

  it("does not allow Customer A to use Customer B membership", () => {
    const rows = [ownedActive(20, 2)];
    expect(resolveOwnedActiveCompanyId(rows, 10)).toBeNull();
    expect(() => resolveOwnedActiveCompanyId(rows, 10, { required: true }))
      .toThrow(/belum memiliki membership perusahaan aktif/);
  });

  it("fails closed when the customer has multiple active companies", () => {
    expect(resolveOwnedActiveCompanyId([ownedActive(10, 1), ownedActive(10, 2)], 10)).toBeNull();
    expect(() => resolveOwnedActiveCompanyId(
      [ownedActive(10, 1), ownedActive(10, 2)],
      10,
      { required: true },
    )).toThrow(/lebih dari satu membership/);
  });
});