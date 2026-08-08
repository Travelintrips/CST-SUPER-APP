import { describe, expect, it } from "vitest";
import {
  buildReconciliationCorrelationReference,
  buildReconciliationLinkFingerprint,
  MARKETPLACE_RECONCILIATION_LINK_SOURCE,
  validateReconciliationLinkKey,
} from "../mktReconciliationLinkContract.js";

const base = {
  accountingHandoffId: 11,
  apPreparationId: 12,
  paymentRequestId: 55,
  companyId: 7,
  supplierId: 19,
  currency: "IDR",
  amount: "125000.00",
  paymentReference: "PAY-55",
  accountingReference: "ACC-55",
  marketplaceReference: "AP-12",
};

describe("Sprint 09E Marketplace reconciliation link contract", () => {
  it("declares a reference-only source", () => {
    expect(MARKETPLACE_RECONCILIATION_LINK_SOURCE).toBe("marketplace_reconciliation_link");
  });

  it("validates bounded idempotency keys", () => {
    expect(validateReconciliationLinkKey("  recon-link-123  ")).toBe("recon-link-123");
    expect(validateReconciliationLinkKey("short")).toBeNull();
    expect(validateReconciliationLinkKey("a".repeat(129))).toBeNull();
  });

  it("is deterministic and normalizes currency", () => {
    expect(buildReconciliationLinkFingerprint(base)).toBe(
      buildReconciliationLinkFingerprint({ ...base, currency: "idr" }),
    );
  });

  it("changes when an authoritative reference changes", () => {
    expect(buildReconciliationLinkFingerprint(base)).not.toBe(
      buildReconciliationLinkFingerprint({ ...base, paymentReference: "PAY-56" }),
    );
    expect(buildReconciliationLinkFingerprint(base)).not.toBe(
      buildReconciliationLinkFingerprint({ ...base, amount: "125001.00" }),
    );
  });

  it("builds a traceable correlation reference", () => {
    const fingerprint = buildReconciliationLinkFingerprint(base);
    expect(buildReconciliationCorrelationReference(55, fingerprint))
      .toBe(`MKT-RECON-55-${fingerprint.slice(0, 16)}`);
  });
});