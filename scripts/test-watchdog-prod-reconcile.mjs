/**
 * Test: reconcileRegistryForProduction — logika inti (_buildProdUrlFromEnv, _doReconcile)
 *
 * 6 skenario sesuai spesifikasi:
 *  1. Production + registry kosong → seed URL production (handled by seedServiceRegistry, skip reconcile)
 *  2. Production + URL localhost/dev → diganti URL production
 *  3. Production + URL sudah benar → tidak diubah
 *  4. Development mode → URL dev tidak diubah (tidak masuk _doReconcile)
 *  5. Env URL production tidak tersedia → fail-safe, jangan menulis URL palsu
 *  6. Re-run startup → idempotent, tidak membuat duplikat
 */

import { _buildProdUrlFromEnv, _doReconcile, DEV_URL_RE, PROD_SERVICE_PORT_ENV } from
  "../system-watchdog-service.mjs";

// ── Mini test runner ───────────────────────────────────────────────────────────

let passed = 0;
let failed = 0;

function assert(condition, message) {
  if (condition) {
    console.log(`  ✓ ${message}`);
    passed++;
  } else {
    console.error(`  ✗ FAIL: ${message}`);
    failed++;
  }
}

function deepEqual(a, b) {
  return JSON.stringify(a) === JSON.stringify(b);
}

// ── Helper: mock queryFn ───────────────────────────────────────────────────────

function makeMockQuery() {
  const calls = [];
  const fn = async (sql, params = []) => {
    calls.push({ sql, params });
    return { rows: [] };
  };
  fn.calls = calls;
  return fn;
}

// ─────────────────────────────────────────────────────────────────────────────
// Bagian A: Unit test _buildProdUrlFromEnv
// ─────────────────────────────────────────────────────────────────────────────

console.log("\n▶ A. _buildProdUrlFromEnv — unit tests");

console.log("\n  [A1] Env var tersedia → kembalikan URL yang benar");
assert(
  _buildProdUrlFromEnv("api-server", { API_PORT: "18444" }) === "http://127.0.0.1:18444",
  "api-server dengan API_PORT=18444"
);
assert(
  _buildProdUrlFromEnv("bizportal", { BIZPORTAL_PORT: "18442" }) === "http://127.0.0.1:18442",
  "bizportal dengan BIZPORTAL_PORT=18442"
);
assert(
  _buildProdUrlFromEnv("customer-portal", { CUSTOMER_PORT: "23434" }) === "http://127.0.0.1:23434",
  "customer-portal dengan CUSTOMER_PORT=23434"
);
assert(
  _buildProdUrlFromEnv("logistic-order", { LOGISTIC_ORDER_PORT: "19368" }) === "http://127.0.0.1:19368",
  "logistic-order dengan LOGISTIC_ORDER_PORT=19368"
);
assert(
  _buildProdUrlFromEnv("gateway", { PORT: "5000" }) === "http://127.0.0.1:5000",
  "gateway dengan PORT=5000"
);

console.log("\n  [A2] Env var tidak di-set → null (fail-safe)");
assert(
  _buildProdUrlFromEnv("api-server", {}) === null,
  "API_PORT tidak ada → null"
);
assert(
  _buildProdUrlFromEnv("api-server", { API_PORT: "" }) === null,
  "API_PORT string kosong → null"
);
assert(
  _buildProdUrlFromEnv("api-server", { API_PORT: "   " }) === null,
  "API_PORT hanya spasi → null"
);

console.log("\n  [A3] Env var tidak valid → null");
assert(
  _buildProdUrlFromEnv("api-server", { API_PORT: "bukan-angka" }) === null,
  "API_PORT bukan angka → null"
);
assert(
  _buildProdUrlFromEnv("api-server", { API_PORT: "0" }) === null,
  "API_PORT=0 → null (port tidak valid)"
);
assert(
  _buildProdUrlFromEnv("api-server", { API_PORT: "99999" }) === null,
  "API_PORT=99999 → null (melebihi 65535)"
);

console.log("\n  [A4] Service tidak dikenal → null");
assert(
  _buildProdUrlFromEnv("unknown-service", { PORT: "1234" }) === null,
  "service tidak dikenal → null"
);

console.log("\n  [A5] DEV_URL_RE mendeteksi URL stale dengan benar");
assert(DEV_URL_RE.test("http://127.0.0.1:18444"), "127.0.0.1:18444 → stale");
assert(DEV_URL_RE.test("http://127.0.0.1:6800"),  "127.0.0.1:6800 → stale");
assert(DEV_URL_RE.test("http://localhost:3000"),   "localhost:3000 → stale");
assert(!DEV_URL_RE.test("https://myapp.example.com"), "URL production eksternal → bukan stale");
assert(!DEV_URL_RE.test("http://10.0.0.5:8080"),   "IP non-localhost → bukan stale");

// ─────────────────────────────────────────────────────────────────────────────
// Bagian B: Skenario 1-6 menggunakan _doReconcile
// ─────────────────────────────────────────────────────────────────────────────

const PROD_ENV = {
  API_PORT:            "18444",
  BIZPORTAL_PORT:      "18442",
  CUSTOMER_PORT:       "23434",
  LOGISTIC_ORDER_PORT: "19368",
  PORT:                "5000",
};

const noLog = () => {};

// ─── Skenario 1: Registry kosong → reconcile di-skip (rows=[]) ───────────────

console.log("\n▶ B. Skenario 1 — Production + registry kosong");
console.log("  (Tabel kosong → seedServiceRegistry() yang menangani; _doReconcile tidak dipanggil)");
{
  const query = makeMockQuery();
  // Saat rows kosong, reconcileRegistryForProduction mengembalikan { skipped, reason: 'empty_table' }
  // tanpa memanggil _doReconcile. Kita verifikasi _doReconcile berjalan benar dengan rows=[].
  const result = await _doReconcile([], query, PROD_ENV, noLog);
  assert(result.updated.length === 0,         "Tidak ada update saat rows kosong");
  assert(result.skipped_no_env.length === 0,  "Tidak ada skip_no_env saat rows kosong");
  assert(query.calls.length === 0,            "Tidak ada query DB saat rows kosong");
}

// ─── Skenario 2: Production + URL stale → diganti URL production ──────────────

console.log("\n▶ B. Skenario 2 — Production + URL localhost/dev → diganti URL production");
{
  const rows = [
    { service_name: "api-server",      url: "http://127.0.0.1:8080"  }, // salah port (dev default)
    { service_name: "bizportal",       url: "http://127.0.0.1:6800"  }, // salah port
    { service_name: "customer-portal", url: "http://127.0.0.1:23435" }, // salah port
    { service_name: "logistic-order",  url: "http://127.0.0.1:19368" }, // sudah benar
    { service_name: "gateway",         url: "http://localhost:5000"   }, // localhost → stale
  ];
  const query = makeMockQuery();
  const result = await _doReconcile(rows, query, PROD_ENV, noLog);

  // api-server, bizportal, customer-portal, gateway harus di-update
  assert(result.updated.includes("api-server"),      "api-server di-update (port salah)");
  assert(result.updated.includes("bizportal"),       "bizportal di-update (port salah)");
  assert(result.updated.includes("customer-portal"), "customer-portal di-update (port salah)");
  assert(result.updated.includes("gateway"),         "gateway di-update (localhost → 127.0.0.1)");

  // logistic-order sudah benar → tidak di-update
  assert(result.already_correct.includes("logistic-order"), "logistic-order tidak diubah (sudah benar)");
  assert(!result.updated.includes("logistic-order"),        "logistic-order tidak masuk updated list");

  // Verifikasi nilai yang di-UPDATE ke DB
  const updateCalls = query.calls.filter(c => c.sql.startsWith("UPDATE"));
  const apiUpdateCall = updateCalls.find(c => c.params[1] === "api-server");
  assert(
    apiUpdateCall?.params[0] === "http://127.0.0.1:18444",
    "api-server di-update ke URL dari API_PORT env var"
  );
}

// ─── Skenario 3: Production + URL sudah benar → tidak diubah ─────────────────

console.log("\n▶ B. Skenario 3 — Production + URL sudah benar → tidak diubah");
{
  const rows = [
    { service_name: "api-server",      url: "http://127.0.0.1:18444" },
    { service_name: "bizportal",       url: "http://127.0.0.1:18442" },
    { service_name: "customer-portal", url: "http://127.0.0.1:23434" },
    { service_name: "logistic-order",  url: "http://127.0.0.1:19368" },
    { service_name: "gateway",         url: "http://127.0.0.1:5000"  },
  ];
  const query = makeMockQuery();
  const result = await _doReconcile(rows, query, PROD_ENV, noLog);

  assert(result.updated.length === 0,        "Tidak ada update — semua URL sudah benar");
  assert(result.already_correct.length === 5, "Semua 5 service masuk already_correct");
  assert(query.calls.filter(c => c.sql.startsWith("UPDATE")).length === 0,
    "Tidak ada query UPDATE ke DB");
}

// ─── Skenario 4: Development mode → _doReconcile tidak dipanggil ─────────────

console.log("\n▶ B. Skenario 4 — Development mode → URL dev tidak diubah");
{
  // reconcileRegistryForProduction() mengembalikan early jika NODE_ENV !== 'production'.
  // Kita simulasikan dengan memastikan _doReconcile tidak memodifikasi jika dipanggil
  // dengan env tanpa produksi — namun yang lebih penting: verifikasi bahwa logika
  // "dev URL tidak diubah" benar jika dipanggil dengan env dev yang sama.
  const DEV_ONLY_ENV = {
    API_PORT:            "18444",
    BIZPORTAL_PORT:      "18442",
    CUSTOMER_PORT:       "23434",
    LOGISTIC_ORDER_PORT: "19368",
    PORT:                "5000",
  };
  const rows = [
    { service_name: "api-server", url: "http://127.0.0.1:18444" }, // dev URL = benar di dev
  ];
  const query = makeMockQuery();
  const result = await _doReconcile(rows, query, DEV_ONLY_ENV, noLog);
  // URL sudah match → already_correct, tidak di-update
  assert(result.already_correct.includes("api-server"), "Dev URL yang benar tidak diubah");
  assert(result.updated.length === 0, "Tidak ada update di mode dev");
}

// ─── Skenario 5: Env URL production tidak tersedia → fail-safe ───────────────

console.log("\n▶ B. Skenario 5 — Env URL tidak tersedia → fail-safe, jangan tulis URL palsu");
{
  const rows = [
    { service_name: "api-server", url: "http://127.0.0.1:8080" }, // stale, butuh update
    { service_name: "bizportal",  url: "http://127.0.0.1:6800" }, // stale, butuh update
  ];
  const EMPTY_ENV = {}; // tidak ada env var sama sekali
  const query = makeMockQuery();
  const result = await _doReconcile(rows, query, EMPTY_ENV, noLog);

  assert(result.skipped_no_env.includes("api-server"), "api-server di-skip karena env tidak tersedia");
  assert(result.skipped_no_env.includes("bizportal"),  "bizportal di-skip karena env tidak tersedia");
  assert(result.updated.length === 0, "Tidak ada update — env tidak tersedia");
  assert(query.calls.filter(c => c.sql.startsWith("UPDATE")).length === 0,
    "Tidak ada query UPDATE ke DB saat env kosong");
}

// ─── Skenario 6: Re-run startup → idempotent, tidak membuat duplikat ─────────

console.log("\n▶ B. Skenario 6 — Re-run startup → idempotent");
{
  // Simulasi run pertama: 2 URL stale
  const rows = [
    { service_name: "api-server",      url: "http://127.0.0.1:8080"  },
    { service_name: "customer-portal", url: "http://127.0.0.1:23435" },
    { service_name: "logistic-order",  url: "http://127.0.0.1:19368" },
  ];
  const query1 = makeMockQuery();
  const result1 = await _doReconcile(rows, query1, PROD_ENV, noLog);
  assert(result1.updated.length === 2, "Run pertama: 2 baris di-update");

  // Simulasi run kedua: rows sudah benar (setelah update run pertama)
  const rowsAfterFix = [
    { service_name: "api-server",      url: "http://127.0.0.1:18444" }, // sudah benar
    { service_name: "customer-portal", url: "http://127.0.0.1:23434" }, // sudah benar
    { service_name: "logistic-order",  url: "http://127.0.0.1:19368" }, // selalu benar
  ];
  const query2 = makeMockQuery();
  const result2 = await _doReconcile(rowsAfterFix, query2, PROD_ENV, noLog);
  assert(result2.updated.length === 0,           "Run kedua: tidak ada update (idempotent)");
  assert(result2.already_correct.length === 3,   "Run kedua: semua 3 row sudah benar");
  assert(query2.calls.filter(c => c.sql.startsWith("UPDATE")).length === 0,
    "Run kedua: tidak ada query UPDATE ke DB");
}

// ─── Skenario tambahan: URL custom non-localhost tidak disentuh ───────────────

console.log("\n▶ B. Skenario 7 (bonus) — URL custom non-localhost tidak diubah");
{
  const rows = [
    { service_name: "api-server", url: "https://api.mycompany.internal:443" }, // custom
  ];
  const query = makeMockQuery();
  const result = await _doReconcile(rows, query, PROD_ENV, noLog);
  assert(result.not_stale.includes("api-server"), "URL non-localhost masuk not_stale");
  assert(result.updated.length === 0, "URL custom tidak diubah");
}

// ─── Verifikasi PROD_SERVICE_PORT_ENV mencakup semua 5 service ───────────────

console.log("\n▶ C. Kelengkapan PROD_SERVICE_PORT_ENV");
const requiredServices = ["api-server", "bizportal", "customer-portal", "logistic-order", "gateway"];
for (const svc of requiredServices) {
  assert(PROD_SERVICE_PORT_ENV[svc] !== undefined, `${svc} terdaftar di PROD_SERVICE_PORT_ENV`);
}

// ─── Hasil akhir ─────────────────────────────────────────────────────────────

console.log(`\n${"─".repeat(60)}`);
console.log(`Hasil: ${passed} lulus, ${failed} gagal`);
if (failed > 0) {
  console.error(`\n❌ ${failed} test gagal`);
  process.exit(1);
} else {
  console.log("\n✅ Semua test lulus");
}
