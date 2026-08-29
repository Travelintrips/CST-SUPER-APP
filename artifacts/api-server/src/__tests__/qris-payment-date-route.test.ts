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

  it("does not wait for full-company candidate regeneration before responding", () => {
    const routeStart = routeSource.indexOf(
      'router.patch("/qris-candidates/payments/:paymentId/date"',
    );
    const routeEnd = routeSource.indexOf(
      '// ─── POST /api/bank-reconciliation/qris-candidates/:id/approve',
      routeStart,
    );
    const route = routeSource.slice(routeStart, routeEnd);

    expect(route).toContain("setImmediate(() =>");
    expect(route).toContain("candidateRefreshPending: true");
    expect(route).not.toContain("const refreshed = await generateQrisCandidates");
  });

  it("uses the Jakarta payment date for the H-1 review cohort", () => {
    expect(routeSource).toContain("AT TIME ZONE 'Asia/Jakarta'");
    expect(routeSource).not.toContain(
      "COALESCE(sp_h1.paid_at::date, sp_h1.created_at::date) + 1",
    );
  });
});