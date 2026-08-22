import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import {
  observeSportCenterShadow,
  shadowObserverZeroEffectContract,
} from "../lib/sportCenterShadowObserver.js";

const observer = readFileSync(
  resolve(process.cwd(), "src/lib/sportCenterShadowObserver.ts"),
  "utf8",
);

describe("Sport Center shadow observer contract", () => {
  it("only runs in shadow mode and never delegates to the central processor", async () => {
    const previous = process.env.SPORT_CENTER_FINANCE_MODE;
    delete process.env.SPORT_CENTER_FINANCE_MODE;
    const client = { async query() { throw new Error("must not query outside shadow"); } };
    await expect(observeSportCenterShadow({ client: client as never })).resolves.toEqual({
      claimed: 0, compared: 0, manualReview: 0, notObserved: 0,
    });
    if (previous == null) delete process.env.SPORT_CENTER_FINANCE_MODE;
    else process.env.SPORT_CENTER_FINANCE_MODE = previous;
    expect(observer).not.toContain("processCentralFinance");
  });

  it("uses source-qualified versioned identity and a concurrency-safe claim", () => {
    expect(observer).toContain("FOR UPDATE OF o SKIP LOCKED");
    expect(observer).toContain("ON CONFLICT (project_code, source_payment_id, event_type, comparison_version)");
    expect(observer).toContain("shadow_started_at");
  });

  it("has an explicit zero-effect write boundary", () => {
    expect(shadowObserverZeroEffectContract()).toEqual(expect.arrayContaining([
      "accounting_entries",
      "accounting_journals",
      "accounting_entry_lines",
      "payment_settlement_batches",
      "bank_mutations",
      "reconciliation_matches",
    ]));
    expect(observer).not.toContain("create_payment_accounting_draft");
    expect(observer).not.toContain("create_payment_settlement_batch");
    expect(observer).not.toContain("ensure_canonical_bank_mutation_for_settlement");
  });

  it("persists deterministic comparison classifications", () => {
    for (const status of ["MATCH", "ALLOWED_DIFFERENCE", "MISMATCH", "MANUAL_REVIEW", "NOT_OBSERVED"]) {
      expect(observer).toContain(`status: "${status}"`);
    }
    expect(observer).toContain("comparison_evidence");
    expect(observer).toContain("expected_net_settlement");
    expect(observer).toContain("actual_net_settlement");
  });
});