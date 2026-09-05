import test from "node:test";
import assert from "node:assert/strict";
import {
  TAX_MIGRATION_IDEMPOTENCY_PREFIX,
  compareLedgerTotals,
  deriveExpectedTaxRequests,
  hasRejectionDocumentation,
  hasReviewDocumentation,
} from "./tax-coa-activation-contract.mjs";

const target = {
  headers: [
    { baseCode: "2-1090", globalParentCode: "2-1000" },
    { baseCode: "1-1070", globalParentCode: "1-1000" },
  ],
  subaccounts: [
    { baseCode: "2-1091", headerBaseCode: "2-1090" },
    { baseCode: "1-1071", headerBaseCode: "1-1070" },
  ],
  reparenting: [
    { existingBaseCode: "2-1030", newHeaderBaseCode: "2-1090" },
  ],
};

test("derives the same request identity shape as tax migration", () => {
  const requests = deriveExpectedTaxRequests(target, { id: 1, companyCode: "cst" });

  assert.equal(requests.length, 5);
  assert.deepEqual(requests.map((request) => request.code), [
    "2-1090-CST",
    "1-1070-CST",
    "2-1091-CST",
    "1-1071-CST",
    "2-1030-CST",
  ]);
  assert.equal(
    requests[0].idempotencyKey,
    `${TAX_MIGRATION_IDEMPOTENCY_PREFIX}:create-header:2-1090:CST`,
  );
  assert.equal(requests[2].parentCode, "2-1090-CST");
  assert.equal(requests[4].action, "UPDATE_PARENT");
});

test("ledger comparison detects both unchanged and changed totals", () => {
  const before = { "1": { entries: { count: 2 }, entryLines: { count: 4 } } };
  assert.equal(compareLedgerTotals(before, structuredClone(before)).unchanged, true);
  assert.equal(
    compareLedgerTotals(before, { "1": { entries: { count: 3 }, entryLines: { count: 4 } } }).unchanged,
    false,
  );
});

test("approval and rejection documentation contracts are explicit", () => {
  const reviewed = { reviewedBy: "checker", reviewedAt: "2026-09-05T00:00:00.000Z" };
  assert.equal(hasReviewDocumentation(reviewed), true);
  assert.equal(hasRejectionDocumentation({ ...reviewed, reviewComments: "Tidak sesuai kebijakan." }), true);
  assert.equal(hasRejectionDocumentation(reviewed), false);
});