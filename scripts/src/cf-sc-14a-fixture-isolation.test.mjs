import assert from "node:assert/strict";
import test from "node:test";
import { isSafeFixturePayment, MAX_ALLOCATION_ATTEMPTS } from "./cf-sc-14a-fixture-isolation.mjs";

test("rejects an unsafe reused payment identity", () => {
  assert.equal(isSafeFixturePayment([
    { schema: "public", table: "accounting_entries", column: "source_payment_id", rowId: 42 },
  ]), false);
});

test("allows a fresh payment identity with no finance references", () => {
  assert.equal(isSafeFixturePayment([]), true);
});

test("allocation is bounded", () => {
  assert.equal(MAX_ALLOCATION_ATTEMPTS, 200);
});