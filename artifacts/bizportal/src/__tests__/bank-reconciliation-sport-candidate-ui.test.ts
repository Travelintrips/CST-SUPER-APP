import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const pageSource = readFileSync(
  resolve(process.cwd(), "src/pages/accounting/bank-reconciliation.tsx"),
  "utf8",
);

describe("Sport Center candidate selection UI contract", () => {
  it("hides generic exact-match readiness while multiple Sport Center candidates remain", () => {
    expect(pageSource).toContain("function sportPaymentSelectionRequired");
    expect(pageSource).toContain("sportPaymentSelectionRequired(m)");
    expect(pageSource).toContain("Pilih tepat satu kandidat Sport Center");
    expect(pageSource).toContain("isUiApprovalEligible(m, selectedCandidateId ?? null)");
  });

  it("keeps candidate selection and approval distinct from canonical settlement linking", () => {
    expect(pageSource).toContain("Pilih kandidat");
    expect(pageSource).toContain("Tautkan &amp; Approve Settlement");
    expect(pageSource).toContain("Belum berarti siap approve");
    expect(pageSource).toContain("candidateApprovalReadinessReason");
  });

  it("shows the Sport Center bookings that compose a canonical QRIS settlement", () => {
    expect(pageSource).toContain("item.bookingNumber");
    expect(pageSource).toContain("item.customerName");
    expect(pageSource).toContain("item.facilityName");
    expect(pageSource).toContain("item.bookingDate");
    expect(pageSource).toContain("Rincian payment settlement");
  });
});