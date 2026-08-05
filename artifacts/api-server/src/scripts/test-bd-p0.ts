/**
 * test-bd-p0.ts — P0 Bank Disbursement Source Guard smoke tests
 *
 * Run: cd artifacts/api-server && npx tsx src/scripts/test-bd-p0.ts
 *
 * Tests (6 scenarios):
 *  1. employee_advance tanpa source_id → harus GAGAL
 *  2. expense tanpa source_id → harus GAGAL
 *  3. loan_payment tanpa source_id → harus GAGAL
 *  4. fund_transfer tanpa source_id → harus LULUS
 *  5. supplier_payment tanpa source_id → harus LULUS
 *  6. double-posting employee_advance dengan source_id valid (simulasi) → error 409
 *
 * Note: tes 6 membutuhkan data kasbon yang sudah ada di DB.
 * Tes 1-5 murni logika validasi, tidak perlu hit DB.
 */

import { validateBdSource } from "../lib/bdSourceGuard.js";

// ── ANSI colors ───────────────────────────────────────────────────────────────
const GREEN  = "\x1b[32m";
const RED    = "\x1b[31m";
const YELLOW = "\x1b[33m";
const RESET  = "\x1b[0m";
const BOLD   = "\x1b[1m";

let passed = 0;
let failed = 0;

function assert(label: string, condition: boolean, detail?: string) {
  if (condition) {
    console.log(`  ${GREEN}✓${RESET} ${label}`);
    passed++;
  } else {
    console.log(`  ${RED}✗${RESET} ${label}${detail ? ` — ${detail}` : ""}`);
    failed++;
  }
}

async function main() {
  console.log(`\n${BOLD}BD P0 Source Guard — Smoke Tests${RESET}\n`);

  // ── Test 1: employee_advance tanpa source_id → GAGAL ──────────────────
  console.log("Test 1: employee_advance tanpa source_id → harus GAGAL (422)");
  {
    const result = await validateBdSource({
      transactionTypes: ["employee_advance"],
      sourceModule: null,
      sourceId: null,
      amount: 500000,
      companyId: 1,
    });
    assert("ok = false", !result.ok, `ok=${result.ok}`);
    assert("statusCode = 422", result.statusCode === 422, `statusCode=${result.statusCode}`);
    assert("hard = true", result.hard === true, `hard=${result.hard}`);
    assert("error berisi 'modul sumber'", (result.error ?? "").includes("modul sumber"), result.error);
  }

  // ── Test 2: expense tanpa source_id → GAGAL ───────────────────────────
  console.log("\nTest 2: expense tanpa source_id → harus GAGAL (422)");
  {
    const result = await validateBdSource({
      transactionTypes: ["expense"],
      sourceModule: null,
      sourceId: null,
      amount: 250000,
      companyId: 1,
    });
    assert("ok = false", !result.ok);
    assert("statusCode = 422", result.statusCode === 422);
    assert("error berisi 'modul sumber'", (result.error ?? "").includes("modul sumber"));
  }

  // ── Test 3: loan_payment tanpa source_id → GAGAL ─────────────────────
  console.log("\nTest 3: loan_payment tanpa source_id → harus GAGAL (422)");
  {
    const result = await validateBdSource({
      transactionTypes: ["loan_payment"],
      sourceModule: null,
      sourceId: null,
      amount: 1000000,
      companyId: 1,
    });
    assert("ok = false", !result.ok);
    assert("statusCode = 422", result.statusCode === 422);
    assert("error berisi 'modul sumber'", (result.error ?? "").includes("modul sumber"));
  }

  // ── Test 4: fund_transfer tanpa source_id → LULUS ─────────────────────
  console.log("\nTest 4: fund_transfer tanpa source_id → harus LULUS");
  {
    const result = await validateBdSource({
      transactionTypes: ["fund_transfer"],
      sourceModule: null,
      sourceId: null,
      amount: 5000000,
      companyId: 1,
    });
    assert("ok = true", result.ok === true, `ok=${result.ok}, error=${result.error}`);
  }

  // ── Test 5: supplier_payment tanpa source_id → LULUS ─────────────────
  console.log("\nTest 5: supplier_payment tanpa source_id → harus LULUS (PO flow)");
  {
    const result = await validateBdSource({
      transactionTypes: ["supplier_payment"],
      sourceModule: null,
      sourceId: null,
      amount: 2000000,
      companyId: 1,
    });
    assert("ok = true", result.ok === true, `ok=${result.ok}, error=${result.error}`);
  }

  // ── Test 6: equity_withdrawal + other tanpa source_id → LULUS ────────
  console.log("\nTest 6: equity_withdrawal + other tanpa source_id → harus LULUS");
  {
    const result = await validateBdSource({
      transactionTypes: ["equity_withdrawal", "other"],
      sourceModule: null,
      sourceId: null,
      amount: 3000000,
      companyId: 1,
    });
    assert("ok = true", result.ok === true, `ok=${result.ok}, error=${result.error}`);
  }

  // ── Test 7: wrong source_module for employee_advance → GAGAL ─────────
  console.log("\nTest 7: source_module salah untuk employee_advance → harus GAGAL");
  {
    const result = await validateBdSource({
      transactionTypes: ["employee_advance"],
      sourceModule: "bank_loans",   // wrong module
      sourceId: 999,
      amount: 500000,
      companyId: 1,
    });
    assert("ok = false", !result.ok);
    assert("statusCode = 422", result.statusCode === 422);
    assert("error berisi 'source_module'", (result.error ?? "").includes("source_module"), result.error);
  }

  // ── Test 8: mixed restricted + unrestricted (expense + fund_transfer) without source_id → GAGAL ──
  console.log("\nTest 8: mixed expense+fund_transfer tanpa source_id → harus GAGAL (expense restricted)");
  {
    const result = await validateBdSource({
      transactionTypes: ["expense", "fund_transfer"],
      sourceModule: null,
      sourceId: null,
      amount: 1500000,
      companyId: 1,
    });
    assert("ok = false", !result.ok, `ok=${result.ok}`);
    assert("statusCode = 422", result.statusCode === 422);
  }

  // ── Summary ───────────────────────────────────────────────────────────
  console.log(`\n${BOLD}Results: ${GREEN}${passed} passed${RESET}${BOLD}, ${failed > 0 ? RED : GREEN}${failed} failed${RESET}${BOLD}${RESET}`);
  if (failed > 0) process.exit(1);
}

main().catch((err) => {
  console.error(`${RED}Test runner error:${RESET}`, err);
  process.exit(1);
});
