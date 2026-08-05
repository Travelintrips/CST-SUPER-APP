/**
 * Targeted release gate tests — 5 scenarios.
 *
 *   1. Secret PRESENT + rotation INCOMPLETE  → production NO-GO
 *   2. Secret PRESENT + rotation PASS + HTTP E2E BLOCKED → production NO-GO
 *   3. Secret PRESENT + rotation PASS + all gates PASS → production GO
 *   4. Secret MISSING (availability FAIL) + rotation PASS → production NO-GO
 *   5. Credential rotated=true but oldCredentialRevoked=false → secretRotation INCOMPLETE
 */

import { describe, it, expect } from "vitest";
import {
  evaluateRotationStatus,
  computeProductionVerdict,
  type RotationStatusDoc,
  type ProductionSummary,
} from "../lib/releaseGateVerdict.js";

function allPassSummary(): ProductionSummary {
  return {
    static:             "PASS",
    runtimeSafeDev:     "PASS",
    httpE2E:            "PASS",
    secretAvailability: "PASS",
    secretRotation:     "PASS",
    tenantIsolation:    "PASS",
    security:           "PASS",
    accounting:         "PASS",
    sse:                "PASS",
    cleanup:            "PASS",
  };
}

function rotatedDoc(): RotationStatusDoc {
  return {
    verifiedByOwner: true,
    verifiedAt: "2026-07-24T00:00:00.000Z",
    credentials: [
      { name: "FONNTE_TOKEN",  rotated: true, oldCredentialRevoked: true, verified: true },
      { name: "SESSION_SECRET", rotated: true, oldCredentialRevoked: true, verified: true },
    ],
  };
}

// ── Case 1 ────────────────────────────────────────────────────────────────────
describe("Case 1: secrets available but rotation not verified", () => {
  it("produces NO-GO when secretRotation is INCOMPLETE", () => {
    const summary: ProductionSummary = { ...allPassSummary(), secretRotation: "INCOMPLETE" };
    const result = computeProductionVerdict(summary);
    expect(result.verdict).toBe("NO-GO");
    expect(result.reasons.some((r) => r.toLowerCase().includes("rotation"))).toBe(true);
  });

  it("evaluateRotationStatus returns INCOMPLETE when verifiedByOwner=false", () => {
    const doc: RotationStatusDoc = {
      verifiedByOwner: false,
      verifiedAt: null,
      credentials: [
        { name: "FONNTE_TOKEN", rotated: true, oldCredentialRevoked: true, verified: true },
      ],
    };
    const result = evaluateRotationStatus(doc);
    expect(result.status).toBe("INCOMPLETE");
    expect(result.reason).toMatch(/owner verification/i);
  });
});

// ── Case 2 ────────────────────────────────────────────────────────────────────
describe("Case 2: rotation verified but HTTP E2E blocked", () => {
  it("produces NO-GO when httpE2E is BLOCKED even if secrets and rotation are PASS", () => {
    const summary: ProductionSummary = {
      ...allPassSummary(),
      httpE2E:         "BLOCKED",
      tenantIsolation: "BLOCKED",
      security:        "BLOCKED",
      accounting:      "BLOCKED",
      sse:             "BLOCKED",
      cleanup:         "BLOCKED",
    };
    const result = computeProductionVerdict(summary);
    expect(result.verdict).toBe("NO-GO");
    expect(result.reasons.some((r) => /http e2e|blocked/i.test(r))).toBe(true);
  });
});

// ── Case 3 ────────────────────────────────────────────────────────────────────
describe("Case 3: all gates pass", () => {
  it("produces GO when every gate is PASS", () => {
    const result = computeProductionVerdict(allPassSummary());
    expect(result.verdict).toBe("GO");
    expect(result.reasons).toHaveLength(0);
  });

  it("evaluateRotationStatus returns PASS when all credentials are complete", () => {
    expect(evaluateRotationStatus(rotatedDoc()).status).toBe("PASS");
  });
});

// ── Case 4 ────────────────────────────────────────────────────────────────────
describe("Case 4: secret availability fails even when rotation is marked verified", () => {
  it("produces NO-GO when secretAvailability is FAIL", () => {
    const summary: ProductionSummary = { ...allPassSummary(), secretAvailability: "FAIL" };
    const result = computeProductionVerdict(summary);
    expect(result.verdict).toBe("NO-GO");
    expect(result.reasons.some((r) => /availability|missing/i.test(r))).toBe(true);
  });

  it("secretAvailability FAIL + secretRotation PASS still yields NO-GO", () => {
    const summary: ProductionSummary = {
      ...allPassSummary(),
      secretAvailability: "FAIL",
      secretRotation:     "PASS",
    };
    expect(computeProductionVerdict(summary).verdict).toBe("NO-GO");
  });
});

// ── Case 5 ────────────────────────────────────────────────────────────────────
describe("Case 5: partially rotated credential — old credential not revoked", () => {
  it("returns INCOMPLETE when rotated=true but oldCredentialRevoked=false", () => {
    const doc: RotationStatusDoc = {
      verifiedByOwner: true,
      verifiedAt: "2026-07-24T00:00:00.000Z",
      credentials: [
        { name: "FONNTE_TOKEN", rotated: true, oldCredentialRevoked: false, verified: true },
        { name: "SMTP_PASS",    rotated: true, oldCredentialRevoked: true,  verified: true },
      ],
    };
    const result = evaluateRotationStatus(doc);
    expect(result.status).toBe("INCOMPLETE");
    expect(result.incomplete!.some((s) => s.includes("FONNTE_TOKEN"))).toBe(true);
    expect(result.incomplete!.some((s) => s.includes("old credential not revoked"))).toBe(true);
  });

  it("returns INCOMPLETE when verified=false even if rotated and revoked", () => {
    const doc: RotationStatusDoc = {
      verifiedByOwner: true,
      verifiedAt: "2026-07-24T00:00:00.000Z",
      credentials: [
        { name: "PAYLABS_PRIVATE_KEY", rotated: true, oldCredentialRevoked: true, verified: false },
      ],
    };
    expect(evaluateRotationStatus(doc).status).toBe("INCOMPLETE");
  });

  it("returns PASS only when all three flags are true for all credentials", () => {
    expect(evaluateRotationStatus(rotatedDoc()).status).toBe("PASS");
  });
});
