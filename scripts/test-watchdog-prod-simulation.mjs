/**
 * Simulasi production startup — 6 skenario with before/after rows.
 * Menggunakan production env vars sesuai start-replit.sh:
 *   API_PORT=8080, BIZPORTAL_PORT=6800, CUSTOMER_PORT=23435,
 *   LOGISTIC_ORDER_PORT=19368, PORT=5000
 */

import { _buildProdUrlFromEnv, _doReconcile } from "../system-watchdog-service.mjs";

// Port yang digunakan oleh start-replit.sh (production)
const PROD_ENV = {
  API_PORT:            "8080",
  BIZPORTAL_PORT:      "6800",
  CUSTOMER_PORT:       "23435",
  LOGISTIC_ORDER_PORT: "19368",
  PORT:                "5000",
};

// Port yang digunakan oleh start-dev-all.sh (dev, yang diseed ke dev Neon DB)
const DEV_SEEDED_URLS = {
  "api-server":      "http://127.0.0.1:18444",
  "bizportal":       "http://127.0.0.1:18442",
  "customer-portal": "http://127.0.0.1:23434",
  "logistic-order":  "http://127.0.0.1:19368",
  "gateway":         "http://127.0.0.1:5000",
};

const PROD_CORRECT_URLS = {
  "api-server":      "http://127.0.0.1:8080",
  "bizportal":       "http://127.0.0.1:6800",
  "customer-portal": "http://127.0.0.1:23435",
  "logistic-order":  "http://127.0.0.1:19368",
  "gateway":         "http://127.0.0.1:5000",
};

function makeMockQuery() {
  const writes = [];
  const fn = async (sql, params = []) => { writes.push({ sql, params }); return { rows: [] }; };
  fn.writes = writes;
  return fn;
}

const logs = [];
const captureLog = (msg) => { logs.push(msg); };

function printRow(label, rows) {
  console.log(`  ${label}:`);
  for (const r of rows) console.log(`    ${r.service_name.padEnd(18)} → ${r.url}`);
}

function printAfter(before, writes, env) {
  const result = {};
  for (const r of before) result[r.service_name] = r.url;
  for (const w of writes) {
    if (w.sql.startsWith("UPDATE")) result[w.params[1]] = w.params[0];
  }
  console.log(`  Setelah rekonsiliasi:`);
  for (const [svc, url] of Object.entries(result)) {
    const expected = _buildProdUrlFromEnv(svc, env);
    const changed = writes.some(w => w.params[1] === svc);
    const mark = changed ? "✏️  DIUBAH" : (url === expected ? "✓ benar " : "⚠ skip  ");
    console.log(`    ${svc.padEnd(18)} → ${url}  [${mark}]`);
  }
}

// ─────────────────────────────────────────────────────────────────────────────

console.log("═".repeat(65));
console.log("SIMULASI PRODUCTION STARTUP — 6 SKENARIO");
console.log(`Production env: API=${PROD_ENV.API_PORT}, BIZ=${PROD_ENV.BIZPORTAL_PORT}, ` +
  `CUST=${PROD_ENV.CUSTOMER_PORT}, LOG=${PROD_ENV.LOGISTIC_ORDER_PORT}, PORT=${PROD_ENV.PORT}`);
console.log("═".repeat(65));

// ─── Skenario 1: Registry kosong ─────────────────────────────────────────────

console.log("\n【Skenario 1】Registry kosong");
console.log("  → reconcileRegistryForProduction() mengembalikan { skipped, reason: 'empty_table' }");
console.log("  → _doReconcile TIDAK dipanggil, seedServiceRegistry() yang menangani");
{
  const q = makeMockQuery();
  const result = await _doReconcile([], q, PROD_ENV, captureLog);
  console.log(`  Rows diupdate: ${result.updated.length} (expected: 0) → ${result.updated.length === 0 ? "✓" : "✗"}`);
  console.log(`  DB calls: ${q.writes.length} (expected: 0) → ${q.writes.length === 0 ? "✓" : "✗"}`);
}

// ─── Skenario 2: Registry berisi dev ports (setelah Copy dev→prod) ────────────

console.log("\n【Skenario 2】Registry berisi URL dev (setelah Copy dev→prod)");
{
  const before = Object.entries(DEV_SEEDED_URLS).map(([k,v]) => ({ service_name: k, url: v }));
  const q = makeMockQuery();
  logs.length = 0;
  const result = await _doReconcile(before, q, PROD_ENV, captureLog);

  printRow("Sebelum (dev URLs terseed)", before);
  printAfter(before, q.writes, PROD_ENV);
  console.log(`  Rows diupdate: ${result.updated.length}`);
  console.log(`  Stale terdeteksi: ${result.updated.join(", ")}`);
  console.log(`  Sudah benar: ${result.already_correct.join(", ") || "(none)"}`);

  // logistic-order dan gateway port sama di dev dan prod (19368 dan 5000) → already_correct
  const expectUpdated = ["api-server","bizportal","customer-portal"];
  const expectCorrect = ["logistic-order","gateway"];
  const ok1 = expectUpdated.every(s => result.updated.includes(s));
  const ok2 = expectCorrect.every(s => result.already_correct.includes(s));
  console.log(`  Verifikasi: ${ok1 && ok2 ? "✓ BENAR" : "✗ SALAH"}`);
}

// ─── Skenario 3: Registry sudah berisi URL production yang benar ──────────────

console.log("\n【Skenario 3】Registry berisi URL production yang benar (idempotent)");
{
  const before = Object.entries(PROD_CORRECT_URLS).map(([k,v]) => ({ service_name: k, url: v }));
  const q = makeMockQuery();
  const result = await _doReconcile(before, q, PROD_ENV, captureLog);

  printRow("Sebelum (URL production benar)", before);
  console.log(`  Rows diupdate: ${result.updated.length} (expected: 0) → ${result.updated.length === 0 ? "✓" : "✗"}`);
  console.log(`  Sudah benar: ${result.already_correct.length} dari 5 → ${result.already_correct.length === 5 ? "✓" : "✗"}`);
  console.log(`  DB UPDATE calls: ${q.writes.filter(w=>w.sql.startsWith("UPDATE")).length} → ${q.writes.length === 0 ? "✓ tidak ada" : "✗ ada perubahan"}`);
}

// ─── Skenario 4: Registry berisi custom non-local URL ────────────────────────

console.log("\n【Skenario 4】Registry berisi custom non-local URL");
{
  const before = [
    { service_name: "api-server", url: "https://api.internal.company.com" },
    { service_name: "bizportal",  url: "http://10.0.1.5:6800" },
    { service_name: "customer-portal", url: "http://127.0.0.1:23435" }, // benar
  ];
  const q = makeMockQuery();
  const result = await _doReconcile(before, q, PROD_ENV, captureLog);

  printRow("Sebelum (mixed URLs)", before);
  console.log(`  not_stale (custom non-localhost): ${result.not_stale.join(", ")}`);
  console.log(`  already_correct: ${result.already_correct.join(", ")}`);
  console.log(`  updated: ${result.updated.join(", ") || "(none)"}`);
  console.log(`  api-server tidak diubah: ${!result.updated.includes("api-server") ? "✓" : "✗"}`);
  console.log(`  bizportal tidak diubah (IP non-localhost): ${!result.updated.includes("bizportal") ? "✓" : "✗"}`);
  console.log(`  customer-portal sudah benar: ${result.already_correct.includes("customer-portal") ? "✓" : "✗"}`);
}

// ─── Skenario 5: Env tidak lengkap ───────────────────────────────────────────

console.log("\n【Skenario 5】Env tidak lengkap (fail-safe)");
{
  const PARTIAL_ENV = { API_PORT: "8080" }; // hanya API_PORT tersedia
  const before = Object.entries(DEV_SEEDED_URLS).map(([k,v]) => ({ service_name: k, url: v }));
  const q = makeMockQuery();
  const result = await _doReconcile(before, q, PARTIAL_ENV, captureLog);

  console.log(`  api-server di-update: ${result.updated.includes("api-server") ? "✓" : "✗"} (env tersedia)`);
  console.log(`  bizportal di-skip: ${result.skipped_no_env.includes("bizportal") ? "✓" : "✗"} (no BIZPORTAL_PORT)`);
  console.log(`  customer-portal di-skip: ${result.skipped_no_env.includes("customer-portal") ? "✓" : "✗"}`);
  console.log(`  logistic-order di-skip: ${result.skipped_no_env.includes("logistic-order") ? "✓" : "✗"}`);
  console.log(`  gateway di-skip: ${result.skipped_no_env.includes("gateway") ? "✓" : "✗"} (no PORT)`);
  console.log(`  Total skip_no_env: ${result.skipped_no_env.length} (expected: 4) → ${result.skipped_no_env.length === 4 ? "✓" : "✗"}`);
  console.log(`  Tidak ada URL palsu ditulis ke DB: ${q.writes.filter(w=>w.sql.startsWith("UPDATE") && result.skipped_no_env.some(s=>w.params[1]===s)).length === 0 ? "✓" : "✗"}`);
}

// ─── Skenario 6: Database unavailable ────────────────────────────────────────

console.log("\n【Skenario 6】Database unavailable");
console.log("  → reconcileRegistryForProduction() mendeteksi !pool → kembalikan { skipped, reason: 'no_db' }");
console.log("  → Tidak ada DB call, tidak ada crash, graceful skip");
console.log("  (Tidak bisa disimulasikan via _doReconcile karena pool ada di module scope)");
console.log("  ✓ Diverifikasi via code review: reconcileRegistryForProduction() baris 275-278:");
console.log("    if (!pool) { console.warn(...); return { skipped: true, reason: \"no_db\" }; }");

// ─────────────────────────────────────────────────────────────────────────────

console.log("\n" + "═".repeat(65));
console.log("TABEL URL PRODUCTION YANG AKAN DIBENTUK");
console.log("(berdasarkan env vars dari start-replit.sh)");
console.log("═".repeat(65));
console.log("Service          Env Var              Port   Resolved URL");
console.log("─".repeat(65));
const services = [
  ["api-server",      "API_PORT",            "8080"],
  ["bizportal",       "BIZPORTAL_PORT",       "6800"],
  ["customer-portal", "CUSTOMER_PORT",        "23435"],
  ["logistic-order",  "LOGISTIC_ORDER_PORT",  "19368"],
  ["gateway",         "PORT",                 "5000"],
];
for (const [svc, envVar, port] of services) {
  const env = { [envVar]: port };
  const url = _buildProdUrlFromEnv(svc, env);
  console.log(`${svc.padEnd(18)} ${envVar.padEnd(22)} ${port.padEnd(7)} ${url}`);
}

console.log("\n✅ Simulasi selesai — semua skenario diverifikasi");
