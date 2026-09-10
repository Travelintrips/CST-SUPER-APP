import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { URL } from "node:url";
import {
  asRepairResult,
  buildQrisAutoPostDiagnosis,
} from "../lib/reconciliation/structuredDiagnosis.js";

const bankReconciliationRouteSource = readFileSync(
  new URL("../routes/bankReconciliation.ts", import.meta.url),
  "utf8",
);

describe("structured QRIS reconciliation diagnosis", () => {
  it("returns the complete admin contract for missing settlement configuration", () => {
    const diagnosis = buildQrisAutoPostDiagnosis(
      {
        code: "CANONICAL_SETTLEMENT_CONFIG_UNRESOLVED",
        message: "Tidak ada konfigurasi settlement yang berlaku.",
      },
      { candidateId: 41, mutationId: 9001, companyId: 7 },
    );

    expect(diagnosis).toMatchObject({
      errorCode: "CANONICAL_SETTLEMENT_CONFIG_UNRESOLVED",
      title: expect.any(String),
      rootCause: expect.any(String),
      expectedValue: expect.anything(),
      actualValue: expect.objectContaining({ candidateId: 41, mutationId: 9001 }),
      canAutoFix: false,
      adminAction: expect.any(String),
      adminLocation: expect.any(String),
      tableName: "sport_center.payment_settlement_configs",
      recordId: 41,
      fieldNames: expect.arrayContaining(["provider", "effective_from"]),
      retryAllowed: true,
      correlationId: expect.any(String),
      component: "bank-reconciliation.qris-auto-post",
    });
    expect(asRepairResult(diagnosis)).toBe("ADMIN_ACTION_REQUIRED");
  });

  it("classifies a stale candidate as safe to regenerate and retry", () => {
    const diagnosis = buildQrisAutoPostDiagnosis(
      { code: "INVALID_CANDIDATE", message: "Snapshot payment sudah berubah." },
      { candidateId: 12, mutationId: 99, companyId: 1 },
    );

    expect(diagnosis.canAutoFix).toBe(true);
    expect(diagnosis.autoFixAction).toContain("source canonical");
    expect(diagnosis.retryAllowed).toBe(true);
    expect(asRepairResult(diagnosis)).toBe("FIXED_AND_RETRIED");
  });

  it("keeps portal origin mismatch fail-closed without changing financial data", () => {
    const diagnosis = buildQrisAutoPostDiagnosis(
      {
        code: "PORTAL_CSR_ORIGIN_INVALID",
        message: "PORTAL_CSR_ORIGIN_INVALID: origin aktual tidak terdaftar",
      },
      { candidateId: 22, mutationId: 101, companyId: 1 },
    );

    expect(diagnosis.errorCode).toBe("PORTAL_CSR_ORIGIN_INVALID");
    expect(diagnosis.canAutoFix).toBe(false);
    expect(diagnosis.adminLocation).toContain("origin");
    expect(diagnosis.fieldNames).toEqual(
      expect.arrayContaining(["origin", "portal_origin"]),
    );
    expect(asRepairResult(diagnosis)).toBe("ADMIN_ACTION_REQUIRED");
  });

  it("explains provider mismatch and settlement ownership conflicts as admin actions", () => {
    for (const code of ["PROVIDER_MISMATCH", "SETTLEMENT_OWNERSHIP_CONFLICT"]) {
      const diagnosis = buildQrisAutoPostDiagnosis(
        { code, message: `blocked: ${code}` },
        { candidateId: 31, mutationId: 102, companyId: 1 },
      );
      expect(diagnosis.errorCode).toBe(code);
      expect(diagnosis.tableName).toBeTruthy();
      expect(diagnosis.fieldNames.length).toBeGreaterThan(0);
      expect(diagnosis.adminAction).toBeTruthy();
      expect(asRepairResult(diagnosis)).toBe("ADMIN_ACTION_REQUIRED");
    }
  });

  it("classifies schema/query failures as developer actions and never suggests DB edits", () => {
    const diagnosis = buildQrisAutoPostDiagnosis(
      { code: "42P01", message: 'relation "missing_table" does not exist' },
      { candidateId: 33, mutationId: 103, companyId: 1 },
    );

    expect(diagnosis.errorCode).toBe("SCHEMA_QUERY_ERROR");
    expect(diagnosis.adminAction).toBeNull();
    expect(diagnosis.adminLocation).toContain("Developer action");
    expect(diagnosis.retryAllowed).toBe(false);
    expect(asRepairResult(diagnosis)).toBe("DEVELOPER_ACTION_REQUIRED");
  });

  it("preserves retry idempotency outcomes without inventing a fourth result", () => {
    const retriableConflict = buildQrisAutoPostDiagnosis(
      { code: "QRIS_APPROVAL_CONFLICT", message: "claim sedang dipakai proses lain" },
      { candidateId: 34, mutationId: 104, companyId: 1 },
    );
    expect(retriableConflict.canAutoFix).toBe(true);
    expect(asRepairResult(retriableConflict)).toBe("FIXED_AND_RETRIED");

    const developerFailure = buildQrisAutoPostDiagnosis(
      { code: "INCONSISTENT_STATE", message: "canonical state tidak konsisten" },
      { candidateId: 35, mutationId: 105, companyId: 1 },
    );
    expect(asRepairResult(developerFailure)).toBe("DEVELOPER_ACTION_REQUIRED");
  });

  it("keeps repair scoped to canonical regeneration and the existing approval owner", () => {
    const repairStart = bankReconciliationRouteSource.indexOf(
      'router.post("/qris-candidates/:candidateId/repair"',
    );
    const repairEnd = bankReconciliationRouteSource.indexOf(
      'router.patch("/qris-candidates/payments/:paymentId/amount"',
      repairStart,
    );
    expect(repairStart).toBeGreaterThanOrEqual(0);
    expect(repairEnd).toBeGreaterThan(repairStart);
    const repairSource = bankReconciliationRouteSource.slice(repairStart, repairEnd);

    expect(repairSource).toContain("generateQrisCandidates");
    expect(repairSource).toContain("mutationId");
    expect(repairSource).toContain("triggerAutomaticQrisApproval");
    expect(repairSource).toContain("FIXED_AND_RETRIED");
    expect(repairSource).toContain("ADMIN_ACTION_REQUIRED");
    expect(repairSource).toContain("DEVELOPER_ACTION_REQUIRED");
    expect(repairSource).not.toMatch(/UPDATE\s+sport_center\.sport_payments/i);
    expect(repairSource).not.toMatch(/INSERT\s+INTO\s+accounting_entries/i);
  });

  it("returns diagnosis from approval and candidate-generation failure responses", () => {
    expect(bankReconciliationRouteSource).toContain("qrisAutoPostDiagnostic(");
    expect(bankReconciliationRouteSource).toContain("buildQrisAutoPostDiagnosis(");
    expect(bankReconciliationRouteSource).toContain("return res.status(500).json({");
    expect(bankReconciliationRouteSource).toContain(
      'diagnosis: failedDiagnosis',
    );
  });
});