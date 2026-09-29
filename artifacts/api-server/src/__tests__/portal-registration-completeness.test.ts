import { describe, expect, it } from "vitest";
import { CompleteOnboardingSchema } from "../lib/schemas/vendor/index.js";

const baseCustomer = {
  fullName: "Budi Santoso",
  phone: "628123456789",
  address: "Jl. Sudirman No. 10, Jakarta",
  accountType: "customer" as const,
  customerType: "individual" as const,
  ktpUrl: "https://storage.example/ktp.jpg",
};

describe("CompleteOnboardingSchema registration completeness", () => {
  it("accepts a complete personal customer", () => {
    expect(CompleteOnboardingSchema.safeParse(baseCustomer).success).toBe(true);
  });

  it("rejects customer without KTP", () => {
    const { ktpUrl, ...input } = baseCustomer;
    const result = CompleteOnboardingSchema.safeParse(input);
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues.some((issue) => issue.path.join(".") === "ktpUrl")).toBe(true);
    }
  });

  it("requires company identity for a new company customer", () => {
    const result = CompleteOnboardingSchema.safeParse({
      ...baseCustomer,
      customerType: "company",
      requestedCompanyName: "PT Contoh Baru",
    });
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues.some((issue) => issue.path.join(".") === "requestedRegistrationNumber")).toBe(true);
    }
  });

  it("accepts a company customer linked to an existing canonical company", () => {
    const result = CompleteOnboardingSchema.safeParse({
      ...baseCustomer,
      customerType: "company",
      companyId: 12,
    });
    expect(result.success).toBe(true);
  });

  it("rejects incomplete vendor identity and legality", () => {
    const result = CompleteOnboardingSchema.safeParse({
      fullName: "Siti Vendor",
      phone: "628987654321",
      address: "Jl. Gatot Subroto No. 20, Jakarta",
      accountType: "vendor",
      ktpUrl: "https://storage.example/vendor-ktp.jpg",
      vendor: {
        companyName: "PT Vendor Contoh",
        serviceType: "Trucking",
      },
    });
    expect(result.success).toBe(false);
    if (!result.success) {
      const paths = result.error.issues.map((issue) => issue.path.join("."));
      expect(paths).toContain("vendor.nib");
      expect(paths).toContain("vendor.legalityDocUrl");
    }
  });

  it("accepts a complete vendor registration", () => {
    const result = CompleteOnboardingSchema.safeParse({
      fullName: "Siti Vendor",
      phone: "628987654321",
      address: "Jl. Gatot Subroto No. 20, Jakarta",
      accountType: "vendor",
      ktpUrl: "https://storage.example/vendor-ktp.jpg",
      vendor: {
        companyName: "PT Vendor Contoh",
        nib: "1234567890123",
        npwp: "12.345.678.9-012.345",
        serviceType: "Trucking",
        legalityDocUrl: "https://storage.example/nib.pdf",
      },
    });
    expect(result.success).toBe(true);
  });
});
