import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const routeSource = readFileSync(
  resolve(process.cwd(), "src/modules/sport-center/routes.ts"),
  "utf8",
);
const bankReconciliationRouteSource = readFileSync(
  resolve(process.cwd(), "src/routes/bankReconciliation.ts"),
  "utf8",
);
const paymentPageSource = readFileSync(
  resolve(process.cwd(), "../bizportal/src/pages/sport-center/payments.tsx"),
  "utf8",
);
const reconciliationPageSource = readFileSync(
  resolve(process.cwd(), "../bizportal/src/pages/accounting/bank-reconciliation.tsx"),
  "utf8",
);

describe("Sport Center settlement governance", () => {
  it("rejects settlement status changes through the generic payment PATCH", () => {
    const routeStart = routeSource.indexOf('router.patch("/payments/:id"');
    const routeEnd = routeSource.indexOf('router.post("/payments/:id/mdr/post"', routeStart);
    const route = routeSource.slice(routeStart, routeEnd);

    expect(route).toContain("SETTLEMENT_STATUS_GOVERNED_BY_RECONCILIATION");
    expect(route).toContain('"settlement_status"');
    expect(route).toContain('"settlementStatus"');
    expect(route).not.toContain("const newSettlementStatus");
    expect(route).not.toContain("sets.push(`settlement_status");
  });

  it("does not send settlement status from the Sport Center payment editor", () => {
    expect(paymentPageSource).not.toContain("settlement_status: editForm.settlement_status");
    expect(paymentPageSource).not.toContain("Status Settlement</Label>");
  });

  it("keeps canonical manual override review-only for amount/date mismatches", () => {
    const helperStart = reconciliationPageSource.indexOf(
      "function isCanonicalSettlementManualOverrideEligible",
    );
    const helperEnd = reconciliationPageSource.indexOf(
      "function hasLiveQrisPaymentsForCanonicalApproval",
      helperStart,
    );
    const helper = reconciliationPageSource.slice(helperStart, helperEnd);

    expect(helper).toContain("candidate.amount_match !== false");
    expect(helper).toContain("candidate.date_match !== false");
    expect(reconciliationPageSource).toContain("Selesaikan link historical");
    expect(reconciliationPageSource).not.toContain("Tautkan Settlement Posted");
    expect(reconciliationPageSource).toContain(
      'recoStatus === "MATCHED" && qrisAuditNetMatchesMutation',
    );
  });

  it("does not let QRIS manual override bypass exact-net approval", () => {
    const approvalStart = bankReconciliationRouteSource.lastIndexOf(
      'router.post("/qris-candidates/:candidateId/approve"',
    );
    const approvalEnd = bankReconciliationRouteSource.indexOf(
      "// ─── GET /api/bank-reconciliation/mutations",
      approvalStart,
    );
    const approvalRoute = bankReconciliationRouteSource.slice(approvalStart, approvalEnd);

    expect(approvalRoute).toContain("selectQrisExactNetConfig");
    expect(approvalRoute).toContain("const settlementConfig = exactSettlementConfig;");
    expect(approvalRoute).not.toContain(
      "manualOverride && evaluatedConfigs.length === 1",
    );
  });
});