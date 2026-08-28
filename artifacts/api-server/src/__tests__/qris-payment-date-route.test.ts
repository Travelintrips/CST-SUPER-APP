import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const routeSource = readFileSync(
  resolve(process.cwd(), "src/routes/bankReconciliation.ts"),
  "utf8",
);

describe("QRIS payment date update route", () => {
  it("locks only the canonical payment row when company mappings are nullable joins", () => {
    const routeStart = routeSource.indexOf(
      'router.patch("/qris-candidates/payments/:paymentId/date"',
    );
    const routeEnd = routeSource.indexOf(
      '// ─── POST /api/bank-reconciliation/qris-candidates/:id/approve',
      routeStart,
    );
    const route = routeSource.slice(routeStart, routeEnd);

    expect(route).toContain("FOR UPDATE OF sp");
    expect(route).not.toContain("\n        FOR UPDATE\n");
  });
});