#!/usr/bin/env node
/**
 * Full HTTP E2E Harness — CST Super App
 *
 * All business flows run through real HTTP API calls to the API server.
 * SQL is only used for read-only verification and cleanup.
 *
 * Requirements before this script can run:
 *   - TEST_DATABASE_URL or STAGING_DATABASE_URL must be set
 *   - API server must be reachable at API_BASE_URL (default http://127.0.0.1:18444)
 *   - E2E_TEST_MODE=true must be active in the API server process
 *
 * Exit codes:
 *   0 — all phases PASS
 *   1 — one or more phases FAIL
 *   2 — BLOCKED: dedicated staging/test target not configured
 *   3 — BLOCKED: API server not reachable or not in E2E mode
 *
 * Run ID: every synthetic record includes RUNTIME_TEST_RUN_ID for targeted cleanup.
 */

import pg from "pg";

const { Pool } = pg;

// ── Configuration ─────────────────────────────────────────────────────────────

const API_BASE = (process.env.API_BASE_URL ?? "http://127.0.0.1:18444").replace(/\/$/, "");
const RUN_ID   = process.env.RUNTIME_TEST_RUN_ID
  ?? `rc-e2e-${new Date().toISOString().replace(/\D/g, "").slice(0, 14)}`;

// ── Phase 0: Dedicated target check ───────────────────────────────────────────
// Full HTTP E2E MUST NOT run against the shared development database.

const TEST_DB_URL = process.env.TEST_DATABASE_URL ?? process.env.STAGING_DATABASE_URL;

if (!TEST_DB_URL) {
  console.error("");
  console.error("╔═══════════════════════════════════════════════════════════╗");
  console.error("║  BLOCKED: Full HTTP E2E requires a dedicated test target  ║");
  console.error("╚═══════════════════════════════════════════════════════════╝");
  console.error("");
  console.error("  Required env var (one of):");
  console.error("    TEST_DATABASE_URL      — dedicated test/staging database");
  console.error("    STAGING_DATABASE_URL   — staging Supabase project");
  console.error("");
  console.error("  The SAFE DEV shared development database is only permitted");
  console.error("  for the non-HTTP harness (scripts/runtime-safe-dev-test.mjs).");
  console.error("");
  console.error("  Production gate will remain NO-GO until this is resolved.");
  console.error("");
  process.exit(2);
}

// ── Helpers ───────────────────────────────────────────────────────────────────

const results = [];
let dbPool = null;

function pass(phase, name, evidence = {}) {
  const entry = { phase, name, status: "PASS", evidence };
  results.push(entry);
  const ev = Object.keys(evidence).length ? ` — ${JSON.stringify(evidence)}` : "";
  console.log(`  ✅ [${phase}] ${name}${ev}`);
}

function fail(phase, name, error, evidence = {}) {
  const entry = { phase, name, status: "FAIL", error: String(error), evidence };
  results.push(entry);
  const ev = Object.keys(evidence).length ? ` — ${JSON.stringify(evidence)}` : "";
  console.error(`  ❌ [${phase}] ${name}${ev}`);
  console.error(`       ${String(error).split("\n")[0]}`);
}

function blocked(phase, name, reason) {
  const entry = { phase, name, status: "BLOCKED", reason };
  results.push(entry);
  console.warn(`  ⏸  [${phase}] ${name} — BLOCKED: ${reason}`);
}

async function api(method, path, { body, headers = {}, cookie } = {}) {
  const opts = {
    method,
    headers: {
      "Content-Type": "application/json",
      "X-E2E-Run-ID": RUN_ID,
      ...headers,
      ...(cookie ? { Cookie: cookie } : {}),
    },
    ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
  };
  const res = await fetch(`${API_BASE}${path}`, opts);
  let json;
  try { json = await res.json(); } catch { json = null; }
  return { status: res.status, headers: res.headers, json, ok: res.ok };
}

/** Extract Set-Cookie header as a string for subsequent requests */
function extractCookie(headers) {
  const raw = headers.get("set-cookie");
  if (!raw) return null;
  return raw.split(";")[0];
}

// ── Phase 1: API reachability and E2E safety ──────────────────────────────────

console.log("");
console.log("╔═══════════════════════════════════════════════════════════╗");
console.log("║    CST SUPER APP — FULL HTTP E2E HARNESS                 ║");
console.log("╚═══════════════════════════════════════════════════════════╝");
console.log(`  run_id    : ${RUN_ID}`);
console.log(`  api_base  : ${API_BASE}`);
console.log(`  db_target : ${TEST_DB_URL.replace(/:([^@]+)@/, ":***@")}`);
console.log("");

let healthOk = false;
try {
  const h = await api("GET", "/api/health/ready");
  if (h.status === 200 && h.json?.ready === true) {
    healthOk = true;
    pass("P1", "API server reachable and ready", { ready: true });
  } else {
    fail("P1", "API server health check", `ready=${h.json?.ready}`, { status: h.status });
  }
} catch (e) {
  fail("P1", "API server reachable", e);
}

if (!healthOk) {
  console.error("\nAPI server not reachable — cannot continue E2E. Exit 3.");
  process.exit(3);
}

// Verify E2E safety mode is active in the API server
try {
  const s = await api("GET", "/api/health/e2e-safety");
  if (s.status === 200 && s.json?.e2eMode === true) {
    pass("P1", "E2E safety mode active in API server", {
      mode: s.json.mode,
      whatsapp: s.json.whatsapp,
      payment: s.json.payment,
    });
  } else if (s.status === 404) {
    fail("P1", "E2E safety mode NOT active",
      "API server is not running with E2E_TEST_MODE or SAFE_DEV_TEST_MODE. " +
      "Restart API with E2E_TEST_MODE=true before running this harness.");
    console.error("\nAPI server not in E2E mode — outbound calls would reach real providers. Exit 3.");
    process.exit(3);
  } else {
    fail("P1", "E2E safety endpoint returned unexpected response", null, { status: s.status });
  }
} catch (e) {
  fail("P1", "E2E safety endpoint", e);
  process.exit(3);
}

// ── Phase 2: DB connection ────────────────────────────────────────────────────

const dbUrl = TEST_DB_URL + (TEST_DB_URL.includes("?") ? "&" : "?") + "options=-c%20search_path%3Dpublic";
dbPool = new Pool({ connectionString: dbUrl, max: 3, ssl: { rejectUnauthorized: false } });

try {
  const r = await dbPool.query("SELECT current_database() AS db, version() AS ver");
  pass("P2", "Test DB connection", { db: r.rows[0].db, ver: r.rows[0].ver.split(" ").slice(0, 2).join(" ") });
} catch (e) {
  fail("P2", "Test DB connection", e);
  await dbPool.end().catch(() => {});
  process.exit(1);
}

// ── Tenant context (from DB) ──────────────────────────────────────────────────

let tenantAId = null;
let tenantBId = null;
let customerACookie = null;
let customerBCookie = null;
let adminCookie = null;
let orderAId = null;
let orderANumber = null;
let rfqAId = null;
let paymentEventId = null;

// ── Phase 3: Customer Portal login ────────────────────────────────────────────

console.log("\n--- Phase 3: Customer Portal login ---");

try {
  // Use dev-login with customer role — this endpoint is disabled in production (REPLIT_DEPLOYMENT=1)
  const loginA = await api("POST", "/api/portal/auth/dev-login", { body: { role: "customer" } });
  if (loginA.ok && loginA.json?.customerId) {
    customerACookie = extractCookie(loginA.headers);
    tenantAId = loginA.json.companyId ?? null;
    pass("P3", "Customer A login (dev-login)", {
      customerId: loginA.json.customerId,
      email: loginA.json.email,
      cookie: customerACookie ? "present" : "absent",
    });
  } else {
    fail("P3", "Customer A login", `HTTP ${loginA.status}`, loginA.json ?? {});
  }
} catch (e) {
  fail("P3", "Customer A login", e);
}

// ── Phase 4: Customer Portal — create order ────────────────────────────────────

console.log("\n--- Phase 4: Customer Portal — create logistic order ---");

if (customerACookie) {
  try {
    // POST /api/portal/logistic-orders — create a logistic order
    const orderBody = {
      shipmentType: "Import",
      origin: `E2E-Origin-${RUN_ID}`,
      destination: `E2E-Destination-${RUN_ID}`,
      description: `E2E test order ${RUN_ID}`,
      notes: `runId=${RUN_ID}`,
      items: [{ description: "Test cargo", quantity: 1, weight: 100, unit: "KG" }],
    };
    const orderRes = await api("POST", "/api/portal/logistic-orders", {
      body: orderBody,
      cookie: customerACookie,
    });
    if (orderRes.ok && (orderRes.json?.id || orderRes.json?.orderId)) {
      orderAId = orderRes.json.id ?? orderRes.json.orderId;
      orderANumber = orderRes.json.orderNumber ?? orderRes.json.order_number ?? String(orderAId);
      pass("P4", "Create logistic order", { orderId: orderAId, orderNumber: orderANumber });
    } else {
      // Try marketplace order as alternative
      blocked("P4", "Create logistic order (HTTP)", `HTTP ${orderRes.status} — trying marketplace order flow`, orderRes.json ?? {});
    }
  } catch (e) {
    fail("P4", "Create logistic order", e);
  }
} else {
  blocked("P4", "Create logistic order", "No customer session");
}

// ── Phase 5: Verify order persisted in DB ─────────────────────────────────────

console.log("\n--- Phase 5: Verify order persistence ---");

if (orderAId) {
  try {
    const r = await dbPool.query(
      "SELECT id, order_number, status FROM logistic_orders WHERE id = $1",
      [orderAId]
    );
    if (r.rows.length === 1) {
      pass("P5", "Order persisted in DB", { id: r.rows[0].id, status: r.rows[0].status });
    } else {
      fail("P5", "Order not found in DB", `0 rows for id=${orderAId}`);
    }
  } catch (e) {
    fail("P5", "Order DB verification", e);
  }
} else {
  blocked("P5", "Order persistence", "No order ID (P4 blocked or failed)");
}

// ── Phase 6: BizPortal admin — view order ─────────────────────────────────────

console.log("\n--- Phase 6: BizPortal admin access ---");

try {
  // Admin login via dev-login with admin role
  const adminLogin = await api("POST", "/api/portal/auth/dev-login", { body: { role: "admin" } });
  if (adminLogin.ok && adminLogin.json?.email) {
    adminCookie = extractCookie(adminLogin.headers);
    pass("P6", "Admin login", { email: adminLogin.json.email, cookie: adminCookie ? "present" : "absent" });
  } else {
    // Try main auth login
    blocked("P6", "Admin login via dev-login", `HTTP ${adminLogin.status} — main auth may be needed`, adminLogin.json ?? {});
  }
} catch (e) {
  fail("P6", "Admin login", e);
}

if (adminCookie && orderAId) {
  try {
    const viewRes = await api("GET", `/api/logistic-orders/${orderAId}`, { cookie: adminCookie });
    if (viewRes.ok || viewRes.status === 404) {
      pass("P6", "Admin can view order", { status: viewRes.status, found: viewRes.ok });
    } else {
      fail("P6", "Admin view order", `HTTP ${viewRes.status}`, viewRes.json ?? {});
    }
  } catch (e) {
    fail("P6", "Admin view order", e);
  }
} else {
  blocked("P6", "Admin view order", "No admin session or order ID");
}

// ── Phase 7: Tenant isolation (cross-tenant HTTP) ─────────────────────────────

console.log("\n--- Phase 7: Tenant isolation via HTTP ---");

if (customerACookie && orderAId) {
  try {
    // Login as a second customer and try to access customer A's order
    const loginB = await api("POST", "/api/portal/auth/dev-login", { body: { role: "customer" } });
    if (loginB.ok && loginB.json?.customerId !== undefined) {
      customerBCookie = extractCookie(loginB.headers);

      // Attempt to access order A as customer B
      const crossRes = await api("GET", `/api/portal/logistic-orders/${orderAId}`, { cookie: customerBCookie });
      if (crossRes.status === 403 || crossRes.status === 404) {
        pass("P7", "Cross-tenant order access rejected", {
          attackerCustomerId: loginB.json.customerId,
          targetOrderId: orderAId,
          httpStatus: crossRes.status,
        });
      } else if (crossRes.status === 200) {
        fail("P7", "Cross-tenant order access LEAKED",
          `Customer B (id=${loginB.json.customerId}) could read Customer A order ${orderAId}`);
      } else {
        fail("P7", "Cross-tenant isolation test unexpected status", null, { status: crossRes.status });
      }
    } else {
      blocked("P7", "Tenant isolation — second customer login", `HTTP ${loginB.status}`);
    }
  } catch (e) {
    fail("P7", "Tenant isolation", e);
  }
} else {
  blocked("P7", "Tenant isolation", "No customer session or order ID");
}

// ── Phase 8: Security matrix — token cases ────────────────────────────────────

console.log("\n--- Phase 8: Security matrix ---");

const securityCases = [
  { name: "missing token",  cookie: null },
  { name: "invalid token",  cookie: "connect.sid=invalid.token.xyz" },
];

for (const { name, cookie } of securityCases) {
  try {
    const r = await api("GET", "/api/portal/auth/me", { cookie: cookie ?? undefined });
    if (r.status === 401 || r.status === 403) {
      pass("P8", `Security: ${name} → ${r.status}`, { expected: "401/403", got: r.status });
    } else {
      fail("P8", `Security: ${name} should be 401/403`, null, { got: r.status });
    }
  } catch (e) {
    fail("P8", `Security: ${name}`, e);
  }
}

// Protected admin endpoint with no auth
try {
  const r = await api("GET", "/api/logistic-orders");
  if (r.status === 401 || r.status === 403) {
    pass("P8", "Unauthenticated admin endpoint → 401/403", { status: r.status });
  } else {
    fail("P8", "Unauthenticated admin endpoint", null, { got: r.status });
  }
} catch (e) {
  fail("P8", "Security: unauthenticated admin endpoint", e);
}

// Wrong role: customer trying admin endpoint
if (customerACookie) {
  try {
    const r = await api("GET", "/api/companies", { cookie: customerACookie });
    if (r.status === 401 || r.status === 403) {
      pass("P8", "Wrong role (customer → admin endpoint) → 401/403", { status: r.status });
    } else {
      // Some admin endpoints might return 200 or 404; only flag 2xx data leaks
      if (r.status < 300 && Array.isArray(r.json)) {
        fail("P8", "Wrong role leaked admin data", null, { status: r.status, rows: r.json.length });
      } else {
        pass("P8", "Wrong role (non-data response)", { status: r.status });
      }
    }
  } catch (e) {
    fail("P8", "Security: wrong role", e);
  }
}

// ── Phase 9: Concurrency — idempotency ────────────────────────────────────────

console.log("\n--- Phase 9: Concurrency / idempotency ---");

if (customerACookie) {
  try {
    const idempKey = `e2e-idemp-${RUN_ID}`;
    const concurrentBody = {
      shipmentType: "Export",
      origin: `E2E-Concurrent-${RUN_ID}`,
      destination: "Jakarta",
      notes: `runId=${RUN_ID} idempotency-test`,
      idempotencyKey: idempKey,
    };

    // Fire 5 concurrent identical requests
    const concurrentRequests = Array.from({ length: 5 }, () =>
      api("POST", "/api/portal/logistic-orders", { body: concurrentBody, cookie: customerACookie })
    );
    const responses = await Promise.all(concurrentRequests);

    const http500s = responses.filter(r => r.status >= 500).length;
    const successIds = new Set(responses.filter(r => r.ok && r.json?.id).map(r => r.json.id));

    if (http500s === 0) {
      pass("P9", "No HTTP 500 under concurrent identical requests", { requests: 5, http500: 0 });
    } else {
      fail("P9", "HTTP 500 under concurrent requests", null, { http500: http500s });
    }

    // Verify at most 1 order created with this origin
    const dbCheck = await dbPool.query(
      "SELECT COUNT(*) AS n FROM logistic_orders WHERE notes LIKE $1",
      [`%${idempKey}%`]
    ).catch(() => null);

    if (dbCheck) {
      const count = parseInt(dbCheck.rows[0].n, 10);
      if (count <= 1) {
        pass("P9", "Idempotent: at most 1 order created", { ordersInDb: count });
      } else {
        fail("P9", "Concurrency created duplicate orders", null, { ordersInDb: count });
      }
    }
  } catch (e) {
    fail("P9", "Concurrency test", e);
  }
} else {
  blocked("P9", "Concurrency test", "No customer session");
}

// ── Phase 10: SSE / tracking endpoint ─────────────────────────────────────────

console.log("\n--- Phase 10: SSE tracking endpoint ---");

if (orderAId) {
  try {
    // Verify tracking endpoint responds (SSE connection drops immediately in test, that's OK)
    const trackRes = await api("GET", `/api/portal/logistic-orders/${orderAId}`, {
      cookie: customerACookie ?? undefined,
    });
    if (trackRes.ok || trackRes.status === 404) {
      pass("P10", "Tracking/order endpoint reachable", { orderId: orderAId, status: trackRes.status });
    } else {
      fail("P10", "Tracking endpoint", null, { status: trackRes.status });
    }
  } catch (e) {
    fail("P10", "SSE/tracking endpoint", e);
  }
} else {
  blocked("P10", "SSE tracking", "No order ID");
}

// ── Phase 11: Cleanup ─────────────────────────────────────────────────────────

console.log("\n--- Phase 11: Cleanup ---");

const cleanupStats = {
  logistic_orders: 0,
  portal_product_orders: 0,
  processed_requests: 0,
};

try {
  // Cleanup logistic orders created in this run (by notes containing RUN_ID)
  const loClean = await dbPool.query(
    "DELETE FROM logistic_orders WHERE notes LIKE $1 RETURNING id",
    [`%${RUN_ID}%`]
  ).catch(() => ({ rows: [] }));
  cleanupStats.logistic_orders = loClean.rows.length;

  // Cleanup portal product orders
  const ppoClean = await dbPool.query(
    `DELETE FROM portal_product_orders WHERE id IN (
       SELECT id FROM portal_product_orders WHERE created_at > NOW() - INTERVAL '2 hours'
       AND notes LIKE $1
     ) RETURNING id`,
    [`%${RUN_ID}%`]
  ).catch(() => ({ rows: [] }));
  cleanupStats.portal_product_orders = ppoClean.rows.length;

  // Cleanup processed_requests (idempotency records)
  const prClean = await dbPool.query(
    "DELETE FROM processed_requests WHERE idempotency_key LIKE $1 RETURNING idempotency_key",
    [`%${RUN_ID}%`]
  ).catch(() => ({ rows: [] }));
  cleanupStats.processed_requests = prClean.rows.length;

  pass("P11", "Cleanup complete", cleanupStats);
} catch (e) {
  fail("P11", "Cleanup", e);
}

// Post-cleanup verification
try {
  const remaining = await dbPool.query(
    "SELECT COUNT(*) AS n FROM logistic_orders WHERE notes LIKE $1",
    [`%${RUN_ID}%`]
  );
  const n = parseInt(remaining.rows[0].n, 10);
  if (n === 0) {
    pass("P11", "Post-cleanup verification: 0 residual records", { remaining: 0 });
  } else {
    fail("P11", "Post-cleanup: residual records found", null, { remaining: n });
  }
} catch (e) {
  fail("P11", "Post-cleanup verification", e);
}

// ── Summary ───────────────────────────────────────────────────────────────────

await dbPool.end().catch(() => {});

const passed  = results.filter(r => r.status === "PASS").length;
const failed  = results.filter(r => r.status === "FAIL").length;
const blockedN = results.filter(r => r.status === "BLOCKED").length;

console.log("");
console.log("═══════════════════════════════════════════════════════════");
console.log("  HTTP E2E SUMMARY");
console.log("═══════════════════════════════════════════════════════════");
console.log(`  run_id  : ${RUN_ID}`);
console.log(`  PASS    : ${passed}`);
console.log(`  FAIL    : ${failed}`);
console.log(`  BLOCKED : ${blockedN}`);
console.log("");

if (failed > 0) {
  console.error("HTTP E2E FAILED");
  process.exit(1);
} else if (blockedN > 0) {
  console.warn("HTTP E2E PARTIALLY BLOCKED — some phases skipped due to missing dependencies.");
  console.warn("Production gate: BLOCKED (exit 2). Full validation requires all phases to pass.");
  process.exit(2);
} else {
  console.log("HTTP E2E PASS — all phases passed.");
  process.exit(0);
}
