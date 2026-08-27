import { beforeEach, describe, expect, it, vi } from "vitest";

const dbMock = vi.hoisted(() => ({
  execute: vi.fn(),
}));

vi.mock("@workspace/db", () => ({
  db: { execute: dbMock.execute },
}));

import { generateQrisCandidates } from "../lib/reconciliation/qrisCandidateService.js";

function queryText(query: { queryChunks?: Array<{ value?: unknown }> }): string {
  return (query.queryChunks ?? [])
    .flatMap((chunk) => Array.isArray(chunk.value) ? chunk.value : [chunk.value])
    .join("");
}

describe("QRIS candidate final-state race protection", () => {
  beforeEach(() => {
    dbMock.execute.mockReset();
    dbMock.execute.mockImplementation(async (query: { queryChunks?: Array<{ value?: unknown }> }) => {
      const text = queryText(query);

      if (text.includes("to_regclass('sport_center.payment_settlement_items')")) {
        return { rows: [{ s: null }] };
      }
      if (text.includes("information_schema.columns")) {
        return { rows: [{ column_name: "settlement_rule_version" }] };
      }
      if (text.includes("FROM sport_center.sport_payments")) {
        return {
          rows: [{
            id: 1, company_id: 1, amount: 100, method: "QRIS", status: "paid",
            paid_at: "2026-08-23T09:00:00+07:00", provider_code: "gpn_qris",
            settlement_date: "2026-08-24", settlement_rule_version: "default-v1",
            bank_account_id: 7, already_reconciled: false,
          }],
        };
      }
      if (text.includes("FROM bank_mutations bm")) {
        return {
          rows: [{
            id: 99, company_id: 1, raw_bank_account_id: 7,
            transaction_date: "2026-08-24", amount: 99, direction: "IN",
            source: "bank_import", source_classification: "actual_bank_mutation",
            description: "QRIS SETTLEMENT", status: "unmatched",
          }],
        };
      }
      if (text.includes("FROM qris_business_calendar_holidays")
        || text.includes("FROM qris_provider_settlement_rules")) {
        return { rows: [] };
      }
      if (text.includes("FROM qris_mutation_batch_candidates")) {
        return {
          rows: [{
            id: 71, mutation_id: 99, status: "candidate_review",
            gross_amount: 100, net_amount: 99, estimated_settlement_date: "2026-08-24",
            settlement_rule_version: "default-v1",
            payment_items: [{
              paymentId: 1, grossAmount: 100, expectedSettlementDate: "2026-08-24",
              settlementRuleVersion: "default-v1", canonicalSettlementId: null,
            }],
          }],
        };
      }
      if (text.includes("FROM company_bank_accounts")) {
        return { rows: [{ id: 7, company_id: 1, account_number: "123" }] };
      }
      if (text.includes("UPDATE qris_mutation_batch_candidates")) {
        // The approval transaction committed after candidate generation read
        // the row; the conditional refresh must therefore affect no rows.
        return { rows: [], rowCount: 0 };
      }
      if (text.includes("INSERT INTO qris_mutation_batch_candidates")) {
        throw new Error("A concurrently final candidate must never be replaced.");
      }

      throw new Error(`Unexpected SQL: ${text.slice(0, 120)}`);
    });
  });

  it("does not reopen or replace a candidate when concurrent approval wins", async () => {
    const result = await generateQrisCandidates({ mutationId: 99, dryRun: false });

    expect(result.generated).toBe(1);
    const refresh = dbMock.execute.mock.calls
      .map(([query]) => queryText(query))
      .find((text) => text.includes("SET candidate_source"));
    expect(refresh).toContain("status NOT IN ('approved', 'completed', 'superseded', 'stale', 'ineligible')");
    expect(dbMock.execute.mock.calls.map(([query]) => queryText(query)).join("\n"))
      .toContain("company_id IS NULL OR bank_account_id IS NOT NULL");
    expect(dbMock.execute.mock.calls.map(([query]) => queryText(query)).join("\n"))
      .not.toContain("INSERT INTO qris_mutation_batch_candidates");
  });
});