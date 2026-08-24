import { describe, expect, it, vi } from "vitest";
import {
  maskVendorBankAccountNumber,
  toVendorProfileViewModel,
} from "../lib/services/vendorProfileViewModel.js";

describe("vendor profile view model", () => {
  it("maps canonical profile columns to the Customer Portal contract", () => {
    const profile = toVendorProfileViewModel({
      id: 41,
      companyName: "PT Angkut Lancar",
      picName: "Rina",
      phone: "08123456789",
      email: "rina@angkut.test",
      fullAddress: "Jl. Merdeka 10",
      bankAccountNumber: "12345678901234",
    });

    expect(profile).toMatchObject({
      id: 41,
      companyName: "PT Angkut Lancar",
      address: "Jl. Merdeka 10",
      picPhone: "08123456789",
      picEmail: "rina@angkut.test",
      bankAccountNumber: "••••••1234",
      bankAccountNumberMasked: "••••••1234",
    });
  });

  it("never returns a full bank account number through the UI read model", () => {
    const rawAccountNumber = "12345678901234";
    const profile = toVendorProfileViewModel({
      bankAccountNumber: rawAccountNumber,
      fullAddress: null,
      phone: null,
      email: null,
    });

    expect(profile.bankAccountNumber).not.toContain(rawAccountNumber);
    expect(profile.bankAccountNumberMasked).not.toContain(rawAccountNumber);
    expect(profile.bankAccountNumber).toBe("••••••1234");
  });

  it("does not reveal a short account number", () => {
    expect(maskVendorBankAccountNumber("1234")).toBe("••••••");
    expect(maskVendorBankAccountNumber("123")).toBe("••••••");
    expect(maskVendorBankAccountNumber("")).toBeNull();
    expect(maskVendorBankAccountNumber(null)).toBeNull();
  });
});

describe("getVendorFullProfile", () => {
  it("looks up only the authenticated vendor's customer id and serializes the masked DTO", async () => {
    const eqMock = vi.fn();
    const profile = {
      id: 41,
      customerId: 12,
      companyName: "PT Angkut Lancar",
      fullAddress: "Jl. Merdeka 10",
      phone: "08123456789",
      email: "rina@angkut.test",
      bankAccountNumber: "12345678901234",
      supplierId: null,
    };
    const where = vi.fn().mockResolvedValue([profile]);
    const from = vi.fn().mockReturnValue({ where });

    vi.resetModules();
    vi.doMock("@workspace/db", () => ({
      db: { select: vi.fn().mockReturnValue({ from }) },
      vendorProfilesTable: {
        customerId: "customerId",
        supplierId: "supplierId",
      },
      portalCustomersTable: {},
      suppliersTable: {},
      logisticOrderRfqsTable: {},
      logisticOrdersTable: {},
      logisticOrderQuotesTable: {},
      vendorCatalogSubmissionLinksTable: {},
    }));
    vi.doMock("drizzle-orm", () => ({
      eq: eqMock,
      desc: vi.fn(),
      inArray: vi.fn(),
      and: vi.fn(),
    }));

    const { getVendorFullProfile } = await import("../lib/services/portalVendorProfileService.js");
    const result = await getVendorFullProfile(12);

    expect(eqMock).toHaveBeenCalledWith("customerId", 12);
    expect(result.vendorProfile).toMatchObject({
      customerId: 12,
      picPhone: "08123456789",
      picEmail: "rina@angkut.test",
      bankAccountNumber: "••••••1234",
    });
    expect(JSON.stringify(result)).not.toContain("12345678901234");
  });
});