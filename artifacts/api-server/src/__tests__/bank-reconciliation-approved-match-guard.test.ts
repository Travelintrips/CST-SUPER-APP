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
      "AND NOT EXISTS (\n" +
        "          SELECT 1\n" +
        "          FROM bank_reconciliation_matches qris_existing_approval\n" +
        "          WHERE qris_existing_approval.mutation_id = ${alias}.id\n" +
        "            AND qris_existing_approval.status = 'approved'",
    );
    expect(routeSource).toContain(
      'AND ${qrisMutationReadyForApprovalSql("bm")}',
    );
  });

  it("reports a stale matched QRIS row with an approved match as duplicate_need_review", () => {
    expect(routeSource).toContain(
      "WHEN bm.status = 'matched'\n" +
        "          AND ${bankMutationPaymentTypeSql(\"bm\")} = 'qris'\n" +
        "          AND EXISTS (\n" +
        "            SELECT 1\n" +
        "            FROM bank_reconciliation_matches approved_qris_match\n" +
        "            WHERE approved_qris_match.mutation_id = bm.id\n" +
        "              AND approved_qris_match.status = 'approved'\n" +
        "          )\n" +
        "        THEN 'duplicate_need_review'",
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