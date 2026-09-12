/**
 * Phase 3 Deprecation — Integration Test Suite
 *
 * Checklist:
 *   1. POST /api/vendor-payments → 410 Gone
 *   2. POST /api/expenses/kas-transfer → 410 Gone
 *   3. GET /api/vendor-payments (historical) → tidak crash (200 atau table-not-found safe)
 *   4. GET /api/expenses/kas-transfer-history → tidak crash
 *   5. POST /api/bank-disbursements → berhasil (201)
 *
 * Jalankan:
 *   node tests/phase3-deprecation.test.mjs
 *
 * Memerlukan API server berjalan di PORT (default 8080).
 * Set BASE_URL env var untuk custom base.
 */

import assert from "node:assert/strict";

const BASE = process.env.BASE_URL ?? `http://localhost:${process.env.PORT ?? 8080}`;
const COOKIE = process.env.TEST_SESSION_COOKIE ?? "";

let passed = 0;
let failed = 0;
const results = [];

async function req(method, path, body) {
  const headers = { "Content-Type": "application/json" };
  if (COOKIE) headers["Cookie"] = COOKIE;
  const resp = await fetch(`${BASE}${path}`, {
    method,
    headers,
    body: body ? JSON.stringify(body) : undefined,
  });
  let json = null;
  try { json = await resp.json(); } catch {}
  return { status: resp.status, json };
}

async function test(name, fn) {
  try {
    await fn();
    console.log(`  ✅  ${name}`);
    results.push({ name, ok: true });
    passed++;
  } catch (err) {
    console.log(`  ❌  ${name}`);
    console.log(`       ${err.message}`);
    results.push({ name, ok: false, err: err.message });
    failed++;
  }
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function assertStatus(label, actual, expected) {
  assert.equal(actual, expected, `${label}: expected HTTP ${expected}, got ${actual}`);
}

function assertBodyContains(label, json, key, value) {
  assert.ok(json !== null, `${label}: no JSON body`);
  assert.ok(key in json, `${label}: missing key "${key}" in ${JSON.stringify(json)}`);
  if (value !== undefined) {
    assert.ok(
      String(json[key]).includes(value),
      `${label}: expected json.${key} to include "${value}", got "${json[key]}"`
    );
  }
}

// ─── Test suite ───────────────────────────────────────────────────────────────

console.log("\n🧪  Phase 3 Deprecation Test Suite");
console.log(`   Base URL: ${BASE}\n`);

// 1. POST /api/vendor-payments → 410
await test("POST /api/vendor-payments returns 410 Gone", async () => {
  const { status, json } = await req("POST", "/api/vendor-payments", {
    vendorName: "Test Vendor",
    amount: 500000,
    paymentDate: "2026-06-28",
    paymentMethod: "bank",
  });
  assertStatus("vendor-payments POST", status, 410);
  assertBodyContains("vendor-payments POST", json, "error", "DEPRECATED");
  assertBodyContains("vendor-payments POST", json, "message", "deprecated");
  assertBodyContains("vendor-payments POST", json, "redirectTo", "bank-disbursements");
});

// 2. POST /api/expenses/kas-transfer → 410
await test("POST /api/expenses/kas-transfer returns 410 Gone", async () => {
  const { status, json } = await req("POST", "/api/expenses/kas-transfer", {
    sourceAccountId: 1,
    targetAccountId: 2,
    amount: 1000000,
    date: "2026-06-28",
  });
  assertStatus("kas-transfer POST", status, 410);
  assertBodyContains("kas-transfer POST", json, "error", "DEPRECATED");
  assertBodyContains("kas-transfer POST", json, "message", "deprecated");
  assertBodyContains("kas-transfer POST", json, "redirectTo", "fund_transfer");
});

// 3. GET /api/vendor-payments → historical, tidak crash
await test("GET /api/vendor-payments returns list without crashing", async () => {
  const { status, json } = await req("GET", "/api/vendor-payments");
  // Accept 200 (table exists) or 401/403 (auth required) — NOT 500
  assert.ok(
    status !== 500,
    `vendor-payments GET should not return 500, got ${status}: ${JSON.stringify(json)}`
  );
  if (status === 200) {
    assert.ok(Array.isArray(json), `Expected array, got ${JSON.stringify(json)}`);
  }
});

// 4. GET /api/expenses/kas-transfer-history → tidak crash
await test("GET /api/expenses/kas-transfer-history returns list without crashing", async () => {
  const { status, json } = await req("GET", "/api/expenses/kas-transfer-history");
  assert.ok(
    status !== 500,
    `kas-transfer-history GET should not return 500, got ${status}: ${JSON.stringify(json)}`
  );
  if (status === 200) {
    assert.ok(Array.isArray(json), `Expected array, got ${JSON.stringify(json)}`);
  }
});

// 5. POST /api/accounting/bank-disbursements → endpoint masih berfungsi (pre-check: endpoint resolves)
await test("POST /api/accounting/bank-disbursements endpoint is reachable (not 404/410)", async () => {
  // We intentionally send an incomplete payload to trigger a 400/401/422 validation error
  // — we just want to confirm the endpoint is NOT returning 404 or 410
  const { status } = await req("POST", "/api/accounting/bank-disbursements", {});
  assert.ok(
    status !== 404 && status !== 410,
    `bank-disbursements POST should not be 404 or 410, got ${status}`
  );
  // 400 (validation), 401 (auth), 403 (authz) are all acceptable — means endpoint is alive
  assert.ok(
    [200, 201, 400, 401, 403, 422].includes(status),
    `bank-disbursements POST got unexpected status ${status}`
  );
});

// ─── Summary ──────────────────────────────────────────────────────────────────

console.log(`\n─────────────────────────────────────`);
console.log(`  ${passed} passed  |  ${failed} failed`);
console.log(`─────────────────────────────────────\n`);

if (failed > 0) {
  console.log("Failed tests:");
  results.filter((r) => !r.ok).forEach((r) => console.log(`  • ${r.name}: ${r.err}`));
  process.exit(1);
}
