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

  it("groups the summary by the effective bank mutation status projection", () => {
    expect(summaryRoute).toContain(
      '${effectiveBankMutationStatusSql("bm")} AS status',
    );
    expect(summaryRoute).toContain("GROUP BY 1");
  });
});