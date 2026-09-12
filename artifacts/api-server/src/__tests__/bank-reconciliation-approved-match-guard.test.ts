import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const routeSource = readFileSync(
  new URL("../routes/bankReconciliation.ts", import.meta.url),
  "utf8",
);
const approvalSource = readFileSync(
  new URL("../lib/reconciliation/canonicalSettlementApproval.ts", import.meta.url),
  "utf8",
);
const historicalSource = readFileSync(
  new URL("../lib/reconciliation/historicalMatchingEngine.ts", import.meta.url),
  "utf8",
);

type CanonicalRetryFixture = {
  settlement_status: string;
  settlement_bank_mutation_id: number | null;
  mutation_id: number;
  match_status: string;
  public_mutation_status: string;
};

function isCompleteCanonicalRetry(row: CanonicalRetryFixture): boolean {
  return (
    row.settlement_status.toLowerCase() === "reconciled" &&
    row.settlement_bank_mutation_id != null &&
    Number(row.settlement_bank_mutation_id) === Number(row.mutation_id) &&
    row.match_status.toLowerCase() === "approved" &&
    row.public_mutation_status.toLowerCase() === "approved"
  );
}

describe("bank reconciliation approved-match guard", () => {
  it("excludes a QRIS mutation with any approved match from the matched queue", () => {
    expect(routeSource).toContain(
      "function qrisMutationReadyForApprovalSql(alias = \"bm\"): string",
    );
    expect(routeSource).toContain(
      "qris_existing_approval.mutation_id = ${alias}.id",
    );
    expect(routeSource).toContain(
      "qris_existing_approval.status = 'approved'",
    );
    expect(routeSource).toContain(
      'bmFilters.push(`${effectiveBankMutationStatusSql("bm")} =',
    );
  });

  it("reports a stale matched QRIS row with an approved match as duplicate_need_review", () => {
    expect(routeSource).toContain(
      "function effectiveBankMutationStatusSql(alias = \"bm\"): string",
    );
    expect(routeSource).toContain(
      "effective_approved_qris.mutation_id = ${alias}.id",
    );
    expect(routeSource).toContain(
      "effective_approved_qris.status = 'approved'",
    );
    expect(routeSource).toContain(
      "THEN 'duplicate_need_review'",
    );
    expect(routeSource).toContain(
      '${effectiveBankMutationStatusSql("bm")} AS status',
    );
  });

  it("keeps legacy and source-less QRIS matches out of current result projections", () => {
    expect(routeSource).toContain(
      "function currentReconciliationMatchResultSql(alias = \"m\"): string",
    );
    expect(routeSource).toContain(
      "${alias}.candidate_type <> 'qris_settlement'",
    );
    expect(routeSource).toContain(
      "${alias}.candidate_source = '${RECONCILIATION_CANDIDATE_SOURCES.CANONICAL_SPORT_CENTER}'",
    );
    expect(routeSource).toContain(
      "AND ${currentReconciliationMatchResultSql(\"m\")}",
    );
    expect(routeSource).toContain(
      "AND ${currentReconciliationMatchResultSql(\"effective_approved_qris\")}",
    );
  });

  it("does not let retired QRIS history seed new historical suggestions", () => {
    expect(historicalSource).toContain(
      "brm.candidate_type <> 'qris_settlement'",
    );
    expect(historicalSource).toContain(
      "brm.candidate_source = '${RECONCILIATION_CANDIDATE_SOURCES.CANONICAL_SPORT_CENTER}'",
    );
  });

  it("recognizes a complete approved canonical retry as idempotent", () => {
    expect(
      isCompleteCanonicalRetry({
        settlement_status: "reconciled",
        settlement_bank_mutation_id: 665310,
        mutation_id: 665310,
        match_status: "approved",
        public_mutation_status: "approved",
      }),
    ).toBe(true);
    expect(approvalSource).toContain(
      "export function isCanonicalApprovalIdempotentState",
    );
    expect(approvalSource).toContain(
      'String(row.settlement_status ?? "").toLowerCase() === "reconciled"',
    );
    expect(approvalSource).toContain(
      'String(row.match_status ?? "").toLowerCase() === "approved"',
    );
    expect(approvalSource).toContain(
      'String(row.public_mutation_status ?? "").toLowerCase() === "approved"',
    );
  });

  it.each([
    ["the settlement is still posted", { settlement_status: "posted" }],
    ["the settlement points to another mutation", { settlement_bank_mutation_id: 991 }],
    ["the canonical match is not approved", { match_status: "candidate" }],
    ["the public mutation is still matched", { public_mutation_status: "matched" }],
  ])("does not treat an incomplete canonical state as idempotent: %s", (_reason, override) => {
    expect(
      isCompleteCanonicalRetry({
        settlement_status: "reconciled",
        settlement_bank_mutation_id: 665310,
        mutation_id: 665310,
        match_status: "approved",
        public_mutation_status: "approved",
        ...override,
      }),
    ).toBe(false);
  });
});