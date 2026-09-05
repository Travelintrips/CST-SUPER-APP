import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const routeSource = readFileSync(
  new URL("../routes/bankReconciliation.ts", import.meta.url),
  "utf8",
);
const canonicalAdapterSource = readFileSync(
  new URL("../lib/reconciliation/canonicalSettlementAdapter.ts", import.meta.url),
  "utf8",
);

const listRouteStart = routeSource.indexOf(
  'router.get("/mutations", async (req, res) => {',
);
const listRouteEnd = routeSource.indexOf(
  '// Historical repair only:',
  listRouteStart,
);
const listRoute = routeSource.slice(listRouteStart, listRouteEnd);

describe("GET /api/bank-reconciliation/mutations finalized candidate contract", () => {
  it("keeps approved canonical matches in candidates with resolved details", () => {
    expect(listRouteStart).toBeGreaterThanOrEqual(0);
    expect(listRouteEnd).toBeGreaterThan(listRouteStart);

    // The mutation list must serialize the persisted match and the live
    // canonical settlement details together. A candidate row without details
    // is not usable by the reviewer UI's date/evidence gate.
    expect(listRoute).toContain(
      "jsonb_build_object('details', ${candidateDetailsSql})",
    );
    expect(listRoute).toContain("m.status IN ('candidate', 'approved')");
    expect(listRoute).toContain("m.candidate_type = 'qris_settlement'");
  });

  it("resolves finalized evidence without making it approval-eligible again", () => {
    // Finalized production rows are approved/reconciled and linked to the same
    // bank mutation. The resolver must expose those details for read-only
    // evidence while preserving the pending candidate predicate separately.
    expect(canonicalAdapterSource).toContain("m.status = 'approved'");
    expect(canonicalAdapterSource).toContain(
      "ebs.settlement_status = 'reconciled'",
    );
    expect(canonicalAdapterSource).toContain(
      "ebs.bank_mutation_id = m.mutation_id",
    );
    expect(canonicalAdapterSource).toContain("m.status <> 'approved'");
    expect(canonicalAdapterSource).toContain(
      "ebs.settlement_status = 'posted'",
    );
    expect(canonicalAdapterSource).toContain(
      "ebs.bank_mutation_id IS NULL",
    );

    // The route still uses the canonical source-aware approval boundary; the
    // display change must not accept a generic or source-less QRIS match.
    expect(listRoute).toContain(
      "m.candidate_source = '${RECONCILIATION_CANDIDATE_SOURCES.CANONICAL_SPORT_CENTER}'",
    );
  });
});