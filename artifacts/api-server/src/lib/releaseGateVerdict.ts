/**
 * Pure functions for release gate verdict computation.
 * No file I/O, no side effects — safe to import in unit tests.
 */

export interface RotationCredential {
  name: string;
  rotated: boolean;
  oldCredentialRevoked: boolean;
  verified: boolean;
}

export interface RotationStatusDoc {
  verifiedByOwner: boolean;
  verifiedAt: string | null;
  credentials: RotationCredential[];
}

export interface RotationResult {
  status: "PASS" | "INCOMPLETE";
  reason: string;
  incomplete?: string[];
}

/**
 * Evaluates whether secret rotation is complete.
 * Rules (all must hold for PASS):
 *   - verifiedByOwner === true
 *   - every credential: rotated && oldCredentialRevoked && verified
 */
export function evaluateRotationStatus(doc: RotationStatusDoc): RotationResult {
  if (!doc.verifiedByOwner) {
    return {
      status: "INCOMPLETE",
      reason: "Owner verification not marked complete (verifiedByOwner: false)",
    };
  }

  const incomplete = doc.credentials.filter(
    (c) => !c.rotated || !c.oldCredentialRevoked || !c.verified,
  );

  if (incomplete.length > 0) {
    const names = incomplete.map((c) => {
      const missing: string[] = [];
      if (!c.rotated) missing.push("not rotated");
      if (!c.oldCredentialRevoked) missing.push("old credential not revoked");
      if (!c.verified) missing.push("not verified");
      return `${c.name} (${missing.join(", ")})`;
    });
    return {
      status: "INCOMPLETE",
      reason: `${incomplete.length} credential(s) not fully rotated`,
      incomplete: names,
    };
  }

  return { status: "PASS", reason: "All credentials rotated, revoked, and verified" };
}

export type GateStatus = "PASS" | "FAIL" | "BLOCKED" | "INCOMPLETE" | "NO-GO" | "GO" | "RUNNING";

export interface ProductionSummary {
  static?: GateStatus;
  runtimeSafeDev?: GateStatus;
  httpE2E?: GateStatus;
  secretAvailability?: GateStatus;
  secretRotation?: GateStatus;
  tenantIsolation?: GateStatus;
  security?: GateStatus;
  accounting?: GateStatus;
  sse?: GateStatus;
  cleanup?: GateStatus;
}

export interface ProductionVerdict {
  verdict: "GO" | "NO-GO";
  reasons: string[];
}

/**
 * Computes the production GO/NO-GO verdict from a summary object.
 * GO requires ALL gates to be "PASS".
 */
export function computeProductionVerdict(summary: ProductionSummary): ProductionVerdict {
  const reasons: string[] = [];

  if (summary.static !== "PASS")
    reasons.push(`Static gate is ${summary.static ?? "INCOMPLETE"} (builds/typechecks/tests must PASS)`);
  if (summary.runtimeSafeDev !== "PASS")
    reasons.push(`Runtime SAFE DEV gate is ${summary.runtimeSafeDev ?? "INCOMPLETE"}`);
  if (summary.secretAvailability !== "PASS")
    reasons.push(`Secret availability is ${summary.secretAvailability ?? "INCOMPLETE"} — required secrets missing or invalid`);
  if (summary.secretRotation !== "PASS")
    reasons.push("Secret rotation has not been manually verified — see docs/security/secret-rotation-status.json");
  if (summary.httpE2E !== "PASS")
    reasons.push(`HTTP E2E is ${summary.httpE2E ?? "BLOCKED"} — full E2E on a dedicated staging target is required`);
  if (summary.tenantIsolation !== "PASS")
    reasons.push(`Tenant isolation is ${summary.tenantIsolation ?? "BLOCKED"}`);
  if (summary.security !== "PASS")
    reasons.push(`Security HTTP matrix is ${summary.security ?? "BLOCKED"}`);
  if (summary.accounting !== "PASS")
    reasons.push(`Accounting gate is ${summary.accounting ?? "BLOCKED"}`);
  if (summary.sse !== "PASS")
    reasons.push(`SSE gate is ${summary.sse ?? "BLOCKED"}`);
  if (summary.cleanup !== "PASS")
    reasons.push(`Cleanup gate is ${summary.cleanup ?? "BLOCKED"}`);

  return reasons.length === 0 ? { verdict: "GO", reasons: [] } : { verdict: "NO-GO", reasons };
}
