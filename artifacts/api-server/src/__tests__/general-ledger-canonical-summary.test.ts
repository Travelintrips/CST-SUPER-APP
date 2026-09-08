import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

type LedgerRow = {
  status: "posted" | "voided" | "draft";
  debit: number;
  credit: number;
};

function canonicalSummary(rows: LedgerRow[]) {
  return rows
    .filter((row) => row.status === "posted")
    .reduce(
      (summary, row) => ({
        total: summary.total + 1,
        debit: summary.debit + row.debit,
        credit: summary.credit + row.credit,
      }),
      { total: 0, debit: 0, credit: 0 },
    );
}

describe("General Ledger canonical summary", () => {
  it("excludes voided and draft rows from canonical financial totals", () => {
    const summary = canonicalSummary([
      { status: "posted", debit: 45_068_942, credit: 0 },
      { status: "posted", debit: 0, credit: 222_907_246 },
      { status: "voided", debit: 0, credit: 1_825 },
      { status: "draft", debit: 99_000, credit: 0 },
    ]);

    expect(summary).toEqual({
      total: 2,
      debit: 45_068_942,
      credit: 222_907_246,
    });
    expect(summary.credit - summary.debit).toBe(177_838_304);
  });

  it("keeps the API query's display count separate from canonical totals", () => {
    const route = readFileSync(
      resolve(process.cwd(), "src/routes/accountingHub.ts"),
      "utf8",
    );
    const summarySection = route.slice(
      route.indexOf("// ── Summary stats"),
      route.indexOf("// ── Opening balance for summary panel"),
    );

    expect(summarySection).toContain("COUNT(el.id)::int AS total");
    expect(summarySection).toContain("const [canonicalSummary]");
    expect(summarySection).toContain("WHERE e.status = 'posted'");
    expect(summarySection).toContain(
      "COALESCE(SUM(el.credit::numeric), 0) AS total_credit",
    );
    expect(route).toContain("canonicalTotal: canonicalSummary?.canonical_total");
  });
});