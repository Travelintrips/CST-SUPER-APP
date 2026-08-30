import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const routeSource = readFileSync(
  resolve(process.cwd(), "src/routes/bankReconciliation.ts"),
  "utf8",
);
const canonicalBuilderSource = readFileSync(
  resolve(process.cwd(), "src/lib/reconciliation/canonicalSettlementBuilder.ts"),
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

describe("QRIS exact-net approval route", () => {
  const routeStart = routeSource.lastIndexOf(
    'router.post("/qris-candidates/:candidateId/approve"',
  );
  const routeEnd = routeSource.indexOf(
    "// ─── GET /api/bank-reconciliation/mutations",
    routeStart,
  );
  const route = routeSource.slice(routeStart, routeEnd);

  it("does not block on provider, canonical-group, rail-label, or stale snapshot metadata", () => {
    expect(route).toContain("selectQrisExactNetConfig");
    expect(route).not.toContain(
      "Provider dan settlement QRIS tidak dapat di-resolve secara unik",
    );
    expect(route).not.toContain("InhouseTrf");
    expect(route).not.toContain("assertQrisBatchApprovalEligible");
    expect(route).not.toContain("checkQrisCandidateFreshness");
  });

  it("keeps the live QRIS, H-1, company, and exact-net guards", () => {
    expect(route).toContain("payment.payment_method");
    expect(route).toContain("COALESCE(payment_method::text, '')");
    expect(route).not.toContain("COALESCE(payment_method::text, method::text");
    expect(route).toContain("expectedPaymentDate");
    expect(route).toContain("payment.company_id");
    expect(route).toContain("calculatedNetAmount");
    expect(route).toContain("selectQrisApprovalPaymentIds");
    expect(route).toContain("DUPLICATE_APPROVAL");
  });

  it("resolves the settlement account number through an active company account before comparing IDs", () => {
    expect(route).toContain("JOIN public.company_bank_accounts cba");
    expect(route).toContain("cba.account_number::text = psc.bank_account_id::text");
    expect(route).toContain("cba.is_active = TRUE");
    expect(route).toContain("const bankMutationAccountId = Number(row.bank_mutation_account_id)");
    expect(route).toContain("AND cba.id = ${bankMutationAccountId}");
    expect(route).not.toContain("OR psc.bank_account_id::text");
  });

  it("treats an explicit manual QRIS selection as authoritative instead of using the source group", () => {
    expect(canonicalBuilderSource).toContain(
      "options.qrisApprovalEvidence != null && requestedPaymentIds !== null",
    );
    expect(canonicalBuilderSource).toContain(
      "p.id IN (${sql.join(requestedPaymentIds!.map",
    );
    expect(canonicalBuilderSource).toContain(
      "if (requestedPaymentIds !== null && !manualQrisSelection)",
    );
    expect(canonicalBuilderSource).not.toContain(
      "partitionQrisCanonicalGroup",
    );
  });
});