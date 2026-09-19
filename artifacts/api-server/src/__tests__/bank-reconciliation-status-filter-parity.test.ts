import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const routeSource = readFileSync(
  new URL("../routes/bankReconciliation.ts", import.meta.url),
  "utf8",
);

const listStart = routeSource.indexOf(
  "// ─── GET /api/bank-reconciliation/mutations",
);
const listEnd = routeSource.indexOf(
  "// Historical repair only",
  listStart,
);
const listRoute = routeSource.slice(listStart, listEnd);

const summaryStart = routeSource.indexOf(
  "// ─── GET /api/bank-reconciliation/summary",
);
const summaryEnd = routeSource.indexOf(
  "// ─── GET /api/bank-reconciliation/audit",
  summaryStart,
);
const summaryRoute = routeSource.slice(summaryStart, summaryEnd);

describe("bank reconciliation status source parity", () => {
  it("filters every requested bank mutation status by the effective projection", () => {
    expect(listRoute).toContain(
      'const effectiveStatus = effectiveBankMutationStatusSql("bm");',
    );
    expect(listRoute).toContain(
      "bmFilters.push(`${effectiveStatus} = '${esc(status)}'`);",
    );
    expect(listRoute).not.toContain(
      "bmFilters.push(`bm.status = '${esc(status)}'`);",
    );
  });

  it("filters imported mutations by the same status expression returned in rows", () => {
    expect(listRoute).toContain(
      'const effectiveImportStatus = effectiveBankMutationImportStatusSql("bmi");',
    );
    expect(listRoute).toContain(
      "bmiFilters.push(`${effectiveImportStatus} = '${esc(status)}'`);",
    );
    expect(listRoute).toContain(
      '${effectiveBankMutationImportStatusSql("bmi")} AS status',
    );
  });

  it("keeps imported NEED_REVIEW rows in the duplicate review queue", () => {
    expect(routeSource).toContain(
      "WHEN ${alias}.status = 'NEED_REVIEW'",
    );
    expect(routeSource).toContain(
      "THEN 'duplicate_need_review'",
    );
    expect(listRoute).toContain(
      "bmiFilters.push(`${effectiveImportStatus} = '${esc(status)}'`);",
    );
  });

  it("keeps score-based matched evidence out of the ready-to-approve queue", () => {
    const statusProjection = routeSource.slice(
      routeSource.indexOf("function effectiveBankMutationStatusSql"),
      routeSource.indexOf("type ReconciliationRepairDisposition"),
    );
    expect(statusProjection).toContain(
      "AND ${alias}.review_code = 'MATCH_SCORE_REVIEW'",
    );
    expect(statusProjection).toContain("THEN 'manual_review'");
  });

  it("counts from the same filtered predicates used by the paginated list", () => {
    expect(listRoute).toContain(
      "SELECT bm.id FROM bank_mutations bm ${bmWhere}",
    );
    expect(listRoute).toContain(
      "SELECT bmi.id FROM bank_mutation_imports bmi ${bmiWhere}",
    );
    expect(listRoute).toContain(
      "total: Number((countRows[0] as any)?.total ?? 0)",
    );
  });

  it("includes deduplicated imported review rows in the summary projection", () => {
    expect(summaryRoute).toContain(
      '${effectiveBankMutationImportStatusSql("bmi")} AS status',
    );
    expect(summaryRoute).toContain(
      "FROM bank_mutation_imports bmi",
    );
    expect(summaryRoute).toContain(
      "bm2.mutation_key::text = COALESCE(bmi.unique_key::text, bmi.id::text)",
    );
  });

  it("groups the summary by the effective bank mutation status projection", () => {
    expect(summaryRoute).toContain(
      '${effectiveBankMutationStatusSql("bm")} AS status',
    );
    expect(summaryRoute).toContain("GROUP BY summary_rows.status");
  });
});