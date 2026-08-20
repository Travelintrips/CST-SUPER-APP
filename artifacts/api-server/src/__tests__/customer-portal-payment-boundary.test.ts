import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { customerPortalPaymentCorrelation } from "../lib/customerPortalPaymentContract.js";

const boundarySource = readFileSync(
  new URL("../lib/customerPortalPaymentFinance.ts", import.meta.url),
  "utf8",
);
const migrationSource = readFileSync(
  new URL("../lib/customerPortalPaymentBoundaryMigration.ts", import.meta.url),
  "utf8",
);
const proofSource = readFileSync(
  new URL("../routes/paymentProof.ts", import.meta.url),
  "utf8",
);

describe("CF-CP-2 customer portal payment boundary", () => {
  it("uses canonical payment id, never document/proof/provider identity", () => {
    expect(customerPortalPaymentCorrelation(42))
      .toBe("customer_portal:payment:42:payment_confirmed");
    expect(boundarySource).toContain("source_payment_id");
    expect(migrationSource).toContain("UNIQUE (source_project, source_payment_id, event_type)");
    expect(boundarySource).not.toContain("sales_document.id");
    expect(boundarySource).not.toContain("payment proof ID");
  });

  it("locks the canonical payment before transition and uses database uniqueness", () => {
    expect(boundarySource).toContain("FOR UPDATE OF p");
    expect(boundarySource).toContain("ON CONFLICT (source_project, source_payment_id, event_type)");
    expect(boundarySource).toContain("firstPaidTransition");
  });

  it("keeps central mode disabled and shadows only outside production", () => {
    expect(boundarySource).toContain('mode === "shadow"');
    expect(boundarySource).toContain('env !== "production"');
    expect(boundarySource).not.toContain("settlement");
    expect(boundarySource).not.toContain("reconciliation");
  });

  it("does not make proof upload a finance producer", () => {
    expect(proofSource).not.toContain("confirmCustomerPortalPayment");
    expect(proofSource).not.toContain("customer_payment_finance_events");
    expect(proofSource).toContain("payment_proof_uploaded");
  });
});