/**
 * System Watchdog Service — Control Plane
 *
 * Standalone HTTP service, independent from Gateway (data plane).
 *
 * Architecture:
 *   DATA PLANE  → gateway.mjs   (route, proxy, retry)
 *   CONTROL PLANE → this file   (monitor, circuit-break, persist, command)
 *
 * This service NEVER:
 *   - spawns child processes
 *   - restarts services
 *   - manages process lifecycle
 *
 * This service ONLY:
 *   - pings services
 *   - transitions circuit breakers
 *   - persists state to DB
 *   - answers health queries
 *   - accepts control commands
 *
 * Endpoints:
 *   GET  /health                        — liveness probe
 *   GET  /global-health                 — full health dashboard
 *   GET  /control/state                 — full state dump
 *   POST /control/open-circuit          body: { service: "service-name" }
 *   POST /control/close-circuit         body: { service: "service-name" }
 *   POST /control/restart-service       body: { service: "service-name" }
 *                                       (writes signal file to /tmp/watchdog/ — no spawn)
 *   GET  /control/registry              — list service registry
 *   PUT  /control/registry/:service     body: ServiceRegistryUpdate
 */

import http   from "node:http";
import fs     from "node:fs";
import { Pool } from "pg";

// ── Config ────────────────────────────────────────────────────────────────────

const PORT               = Number(process.env.WATCHDOG_PORT      ?? 3001);
const PING_INTERVAL_MS   = Number(process.env.WATCHDOG_PING_MS   ?? 7000);
const FAILURE_THRESHOLD  = Number(process.env.WATCHDOG_FAIL_THRESH ?? 3);
const COOLDOWN_MS        = Number(process.env.WATCHDOG_COOLDOWN_MS ?? 45_000);
const SLOW_MS            = Number(process.env.WATCHDOG_SLOW_MS   ?? 3000);
const PING_TIMEOUT_MS    = Number(process.env.WATCHDOG_PING_TIMEOUT ?? 5000);
const HISTORY_SIZE       = 20;
const SIGNAL_DIR         = "/tmp/watchdog";
const PERSIST_INTERVAL   = 15_000; // flush CB state to DB every 15s

const SIMULATE_FAILURES  = new Set(
  (process.env.SYSTEM_SIMULATE_FAILURE ?? "").split(",")
    .map(s => s.trim().toLowerCase()).filter(Boolean)
);

try { fs.mkdirSync(SIGNAL_DIR, { recursive: true }); } catch (_) {}

// ── DB pool ───────────────────────────────────────────────────────────────────

function resolveDbUrl() {
  for (const k of ["DATABASE_URL","SUPABASE_DATABASE_URL","SUPABASE_SESSION_URL","SUPABASE_DIRECT_URL"]) {
    const v = process.env[k];
    if (v && /^postgres(?:ql)?:\/\//i.test(v)) return v;
  }
  return null;
}

const DB_URL = resolveDbUrl();
const pool   = DB_URL ? new Pool({ connectionString: DB_URL, max: 3 }) : null;

async function dbQuery(sql, params = []) {
  if (!pool) return { rows: [] };
  const client = await pool.connect();
  try   { return await client.query(sql, params); }
  finally { client.release(); }
}

// ── Bootstrap tables (idempotent) ─────────────────────────────────────────────

async function initDb() {
  if (!pool) {
    console.warn("[watchdog-svc] No DB URL — state will be in-memory only");
    return;
  }
  await dbQuery(`
    CREATE TABLE IF NOT EXISTS service_registry (
      service_name  TEXT PRIMARY KEY,
      display_name  TEXT        NOT NULL,
      url           TEXT        NOT NULL,
      health_path   TEXT        NOT NULL DEFAULT '/',
      weight        INTEGER     NOT NULL DEFAULT 10,
      is_frontend   BOOLEAN     NOT NULL DEFAULT false,
      dependencies  JSONB       NOT NULL DEFAULT '[]',
      is_active     BOOLEAN     NOT NULL DEFAULT true,
      sort_order    INTEGER     NOT NULL DEFAULT 0,
      created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);
  await dbQuery(`
    CREATE TABLE IF NOT EXISTS service_circuit_states (
      service_name      TEXT PRIMARY KEY REFERENCES service_registry(service_name) ON DELETE CASCADE,
      state             TEXT        NOT NULL DEFAULT 'CLOSED',
      failure_count     INTEGER     NOT NULL DEFAULT 0,
      last_state_change TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      opened_at         TIMESTAMPTZ
    )
  `);
  console.log("[watchdog-svc] DB tables ready");
}

// ── Default service registry (seed if DB is empty) ────────────────────────────

const DEFAULT_SERVICES = [
  {
    service_name: "api-server",
    display_name: "API Server",
    url:          `http://127.0.0.1:${process.env.API_PORT ?? 8080}`,
    health_path:  "/",
    weight:       40,
    is_frontend:  false,
    dependencies: [],
    sort_order:   1,
  },
  {
    service_name: "bizportal",
    display_name: "BizPortal",
    url:          `http://127.0.0.1:${process.env.BIZPORTAL_PORT ?? 6800}`,
    health_path:  "/bizportal/",
    weight:       20,
    is_frontend:  true,
    dependencies: ["api-server"],
    sort_order:   2,
  },
  {
    service_name: "customer-portal",
    display_name: "Customer Portal",
    url:          `http://127.0.0.1:${process.env.CUSTOMER_PORT ?? 23434}`,
    health_path:  "/",
    weight:       20,
    is_frontend:  true,
    dependencies: ["api-server"],
    sort_order:   3,
  },
  {
    service_name: "logistic-order",
    display_name: "Logistic Order",
    url:          `http://127.0.0.1:${process.env.LOGISTIC_ORDER_PORT ?? 19368}`,
    health_path:  "/logistic-order/",
    weight:       10,
    is_frontend:  true,
    dependencies: ["api-server"],
    sort_order:   4,
  },
  {
    service_name: "gateway",
    display_name: "Gateway",
    url:          `http://127.0.0.1:${process.env.GATEWAY_PORT ?? 5000}`,
    health_path:  "/system/health",
    weight:       10,
    is_frontend:  true,
    dependencies: [],
    sort_order:   5,
  },
];

async function seedServiceRegistry() {
  if (!pool) return DEFAULT_SERVICES;
  const { rows } = await dbQuery("SELECT COUNT(*) AS c FROM service_registry");
  if (Number(rows[0]?.c) > 0) return;
  for (const svc of DEFAULT_SERVICES) {
    await dbQuery(`
      INSERT INTO service_registry
        (service_name, display_name, url, health_path, weight, is_frontend, dependencies, sort_order)
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8)
      ON CONFLICT (service_name) DO NOTHING
    `, [svc.service_name, svc.display_name, svc.url, svc.health_path,
        svc.weight, svc.is_frontend, JSON.stringify(svc.dependencies), svc.sort_order]);
  }
  console.log("[watchdog-svc] Default service registry seeded");
}

// ── Production registry reconciliation ────────────────────────────────────────

/**
 * Peta service_name → nama env var yang menentukan port-nya.
 * Digunakan oleh _buildProdUrlFromEnv dan test.
 */
const PROD_SERVICE_PORT_ENV = {
  "api-server":      "API_PORT",
  "bizportal":       "BIZPORTAL_PORT",
  "customer-portal": "CUSTOMER_PORT",
  "logistic-order":  "LOGISTIC_ORDER_PORT",
  "gateway":         "PORT",
};

/** Regex untuk mendeteksi URL localhost/dev (127.0.0.1 atau localhost, port apapun). */
const DEV_URL_RE = /^https?:\/\/(127\.0\.0\.1|localhost):\d+/;

/**
 * Bangun URL production untuk suatu service dari env vars (pure function, testable).
 * Kembalikan null jika env var tidak di-set atau nilainya tidak valid (fail-safe).
 *
 * @param {string} serviceName
 * @param {Record<string,string>} env  - biasanya process.env, bisa di-mock saat test
 * @returns {string|null}
 */
function _buildProdUrlFromEnv(serviceName, env) {
  const envVar = PROD_SERVICE_PORT_ENV[serviceName];
  if (!envVar) return null;
  const raw = env[envVar];
  if (raw === undefined || raw === null || !String(raw).trim()) return null;
  const port = Number(String(raw).trim());
  if (!Number.isInteger(port) || port < 1 || port > 65535) return null;
  return `http://127.0.0.1:${port}`;
}

/**
 * Inti logika rekonsiliasi (pure, testable — tidak menyentuh global pool/dbQuery).
 *
 * @param {Array<{service_name:string, url:string}>} rows   - baris dari DB
 * @param {Function} queryFn   - (sql, params?) => Promise<{rows}>
 * @param {Record<string,string>} env   - biasanya process.env
 * @param {Function} log   - (msg:string) => void
 * @returns {Promise<{updated:string[], skipped_no_env:string[], already_correct:string[], not_stale:string[]}>}
 */
async function _doReconcile(rows, queryFn, env, log) {
  const results = { updated: [], skipped_no_env: [], already_correct: [], not_stale: [] };

  for (const row of rows) {
    const expectedUrl = _buildProdUrlFromEnv(row.service_name, env);

    // Env var tidak tersedia → fail-safe, jangan tulis URL palsu
    if (!expectedUrl) {
      log(`[prod-reconcile] ${row.service_name}: env var '${PROD_SERVICE_PORT_ENV[row.service_name] ?? "?"}' tidak di-set — skip`);
      results.skipped_no_env.push(row.service_name);
      continue;
    }

    // URL sudah benar → tidak perlu diubah
    if (row.url === expectedUrl) {
      results.already_correct.push(row.service_name);
      continue;
    }

    // URL bukan localhost/dev pattern → mungkin custom config produksi, jangan diubah
    if (!DEV_URL_RE.test(row.url)) {
      log(`[prod-reconcile] ${row.service_name}: URL bukan localhost pattern ('${row.url}') — skip`);
      results.not_stale.push(row.service_name);
      continue;
    }

    // URL stale (localhost tapi salah port) → update ke URL dari env var
    await queryFn(
      "UPDATE service_registry SET url = $1, updated_at = NOW() WHERE service_name = $2",
      [expectedUrl, row.service_name]
    );
    log(`[prod-reconcile] ${row.service_name}: '${row.url}' → '${expectedUrl}'`);
    results.updated.push(row.service_name);
  }

  return results;
}

/**
 * Rekonsiliasi service_registry saat startup production.
 * Mendeteksi URL stale (localhost/dev hasil Copy dev→prod) dan menggantinya
 * dengan URL dari env vars. Idempotent — row yang sudah benar tidak diubah.
 *
 * Hanya berjalan saat NODE_ENV=production.
 */
async function reconcileRegistryForProduction() {
  if (process.env.NODE_ENV !== "production") {
    return { skipped: true, reason: "not_production" };
  }
  if (!pool) {
    console.warn("[watchdog-svc] [prod-reconcile] Tidak ada koneksi DB — skip rekonsiliasi");
    return { skipped: true, reason: "no_db" };
  }

  let rows;
  try {
    const res = await dbQuery("SELECT service_name, url FROM service_registry");
    rows = res.rows;
  } catch (err) {
    console.error(`[watchdog-svc] [prod-reconcile] Gagal membaca registry: ${err.message}`);
    return { skipped: true, reason: "db_error" };
  }

  if (!rows || rows.length === 0) {
    // Tabel kosong → seedServiceRegistry() menangani seeding, tidak perlu reconcile
    return { skipped: true, reason: "empty_table" };
  }

  const log = (msg) => console.log(`[watchdog-svc] ${msg}`);

  let results;
  try {
    results = await _doReconcile(rows, dbQuery, process.env, log);
  } catch (err) {
    console.error(`[watchdog-svc] [prod-reconcile] Error saat rekonsiliasi: ${err.message}`);
    return { skipped: true, reason: "reconcile_error" };
  }

  if (results.updated.length > 0) {
    console.log(`[watchdog-svc] [prod-reconcile] ${results.updated.length} baris diperbarui ke URL production`);
  } else {
    console.log("[watchdog-svc] [prod-reconcile] Semua URL sudah benar — tidak ada perubahan");
  }

  return results;
}

async function loadServiceRegistry() {
  if (!pool) return DEFAULT_SERVICES;
  const { rows } = await dbQuery(
    "SELECT * FROM service_registry WHERE is_active = true ORDER BY sort_order ASC"
  );
  if (!rows.length) return DEFAULT_SERVICES;
  return rows.map(r => ({
    service_name: r.service_name,
    display_name: r.display_name,
    url:          r.url,
    health_path:  r.health_path,
    weight:       r.weight,
    is_frontend:  r.is_frontend,
    dependencies: Array.isArray(r.dependencies) ? r.dependencies : JSON.parse(r.dependencies ?? "[]"),
    is_active:    r.is_active,
    sort_order:   r.sort_order,
  }));
}

// ── Circuit Breaker ───────────────────────────────────────────────────────────

const CB_CLOSED    = "CLOSED";
const CB_OPEN      = "OPEN";
const CB_HALF_OPEN = "HALF_OPEN";

class CircuitBreaker {
  constructor(serviceId) {
    this.serviceId       = serviceId;
    this.state           = CB_CLOSED;
    this.failureCount    = 0;
    this.openedAt        = null;
    this.lastStateChange = Date.now();
    this._dirty          = false;
  }

  recordSuccess() {
    if (this.state === CB_HALF_OPEN) {
      const prev       = this.state;
      this.state       = CB_CLOSED;
      this.failureCount = 0;
      this.openedAt    = null;
      this.lastStateChange = Date.now();
      this._dirty      = true;
      return { transitioned: true, from: prev, to: CB_CLOSED };
    }
    if (this.failureCount > 0) {
      this.failureCount = Math.max(0, this.failureCount - 1);
      this._dirty = true;
    }
    return { transitioned: false };
  }

  recordFailure() {
    this.failureCount++;
    this._dirty = true;
    if (this.state === CB_HALF_OPEN ||
        (this.state === CB_CLOSED && this.failureCount >= FAILURE_THRESHOLD)) {
      const prev = this.state;
      this.state           = CB_OPEN;
      this.openedAt        = Date.now();
      this.lastStateChange = Date.now();
      return { transitioned: true, from: prev, to: CB_OPEN };
    }
    return { transitioned: false };
  }

  tick() {
    if (this.state === CB_OPEN && this.openedAt && Date.now() - this.openedAt >= COOLDOWN_MS) {
      this.state           = CB_HALF_OPEN;
      this.lastStateChange = Date.now();
      this._dirty          = true;
      return { transitioned: true, from: CB_OPEN, to: CB_HALF_OPEN };
    }
    return { transitioned: false };
  }

  forceOpen() {
    const prev = this.state;
    this.state           = CB_OPEN;
    this.openedAt        = Date.now();
    this.lastStateChange = Date.now();
    this._dirty          = true;
    return { transitioned: true, from: prev, to: CB_OPEN };
  }

  forceClose() {
    const prev = this.state;
    this.state           = CB_CLOSED;
    this.failureCount    = 0;
    this.openedAt        = null;
    this.lastStateChange = Date.now();
    this._dirty          = true;
    return { transitioned: true, from: prev, to: CB_CLOSED };
  }

  isOpen()     { return this.state === CB_OPEN; }
  isHalfOpen() { return this.state === CB_HALF_OPEN; }

  cooldownRemaining() {
    if (this.state !== CB_OPEN || !this.openedAt) return 0;
    return Math.max(0, COOLDOWN_MS - (Date.now() - this.openedAt));
  }

  toDb() {
    return {
      state:             this.state,
      failure_count:     this.failureCount,
      last_state_change: new Date(this.lastStateChange),
      opened_at:         this.openedAt ? new Date(this.openedAt) : null,
    };
  }

  loadFrom(row) {
    this.state           = row.state           ?? CB_CLOSED;
    this.failureCount    = row.failure_count    ?? 0;
    this.lastStateChange = row.last_state_change ? new Date(row.last_state_change).getTime() : Date.now();
    this.openedAt        = row.opened_at        ? new Date(row.opened_at).getTime() : null;
    this._dirty          = false;
  }
}

// ── Service state ─────────────────────────────────────────────────────────────

class ServiceState {
  constructor(def) {
    this.def            = def;
    this.cb             = new CircuitBreaker(def.service_name);
    this.status         = "unknown";
    this.lastCheck      = null;
    this.lastUp         = null;
    this.lastDown       = null;
    this.latencyMs      = null;
    this.latencyHistory = [];
    this.startedAt      = Date.now();
    this.downtime       = 0;
    this._downtimeStart = null;
    this.simulated      = false;
  }

  onSuccess(latencyMs) {
    const prev = this.status;
    this.latencyMs  = latencyMs;
    this.lastCheck  = Date.now();
    this.lastUp     = Date.now();
    this.simulated  = false;
    this.latencyHistory.push(latencyMs);
    if (this.latencyHistory.length > HISTORY_SIZE) this.latencyHistory.shift();
    if (prev !== "up" && prev !== "slow") {
      if (this._downtimeStart) { this.downtime += Date.now() - this._downtimeStart; this._downtimeStart = null; }
    }
    this.status   = latencyMs > SLOW_MS ? "slow" : "up";
    return this.cb.recordSuccess();
  }

  onFailure(reason) {
    const prev = this.status;
    this.lastCheck  = Date.now();
    this.lastDown   = Date.now();
    this.latencyMs  = null;
    if (prev !== "down") this._downtimeStart = Date.now();
    this.status = "down";
    return this.cb.recordFailure();
  }

  uptimeRatio() {
    const totalMs = Date.now() - this.startedAt;
    if (totalMs <= 0) return 1;
    const downMs = this.downtime + (this._downtimeStart ? Date.now() - this._downtimeStart : 0);
    return Math.max(0, Math.min(1, 1 - downMs / totalMs));
  }

  avgLatency() {
    if (!this.latencyHistory.length) return null;
    return Math.round(this.latencyHistory.reduce((a, b) => a + b, 0) / this.latencyHistory.length);
  }

  p95Latency() {
    if (!this.latencyHistory.length) return null;
    const sorted = [...this.latencyHistory].sort((a, b) => a - b);
    return sorted[Math.max(0, Math.ceil(sorted.length * 0.95) - 1)];
  }
}

// ── Watchdog core ─────────────────────────────────────────────────────────────

class WatchdogCore {
  constructor() {
    this._services = new Map();
    this._running  = false;
    this._log      = [];
  }

  async init() {
    await initDb();
    await seedServiceRegistry();
    await reconcileRegistryForProduction();
    const defs = await loadServiceRegistry();
    for (const def of defs) {
      this._services.set(def.service_name, new ServiceState(def));
    }
    await this._loadCbStates();
    console.log(`[watchdog-svc] Loaded ${this._services.size} services`);
  }

  async _loadCbStates() {
    if (!pool) return;
    try {
      const { rows } = await dbQuery("SELECT * FROM service_circuit_states");
      for (const row of rows) {
        const svc = this._services.get(row.service_name);
        if (svc) svc.cb.loadFrom(row);
      }
    } catch (_) {}
  }

  async _persistCbState(svc) {
    if (!pool) return;
    const cb = svc.cb.toDb();
    try {
      await dbQuery(`
        INSERT INTO service_circuit_states (service_name, state, failure_count, last_state_change, opened_at)
        VALUES ($1,$2,$3,$4,$5)
        ON CONFLICT (service_name) DO UPDATE SET
          state             = EXCLUDED.state,
          failure_count     = EXCLUDED.failure_count,
          last_state_change = EXCLUDED.last_state_change,
          opened_at         = EXCLUDED.opened_at
      `, [svc.def.service_name, cb.state, cb.failure_count, cb.last_state_change, cb.opened_at]);
    } catch (_) {}
    svc.cb._dirty = false;
  }

  async _flushDirtyCbStates() {
    for (const svc of this._services.values()) {
      if (svc.cb._dirty) await this._persistCbState(svc);
    }
  }

  start() {
    if (this._running) return;
    this._running = true;
    console.log(`[watchdog-svc] Starting — ping every ${PING_INTERVAL_MS}ms, CB threshold=${FAILURE_THRESHOLD}, cooldown=${COOLDOWN_MS}ms`);
    if (SIMULATE_FAILURES.size) {
      console.warn(`[watchdog-svc] SIMULATION MODE — failing: ${[...SIMULATE_FAILURES].join(", ")}`);
    }
    this._loop().catch(err => console.error("[watchdog-svc] loop crash:", err));
    setInterval(() => this._flushDirtyCbStates().catch(() => {}), PERSIST_INTERVAL).unref();

    let offset = 0;
    for (const id of this._services.keys()) {
      setTimeout(() => this._ping(id).catch(() => {}),
        offset++ * Math.floor(PING_INTERVAL_MS / Math.max(1, this._services.size)));
    }
  }

  async _loop() {
    while (this._running) {
      await new Promise(r => setTimeout(r, PING_INTERVAL_MS));
      for (const id of this._services.keys()) {
        this._ping(id).catch(err => console.error(`[watchdog-svc] ping error [${id}]:`, err));
      }
    }
  }

  async _ping(id) {
    const svc = this._services.get(id);
    if (!svc) return;

    const tick = svc.cb.tick();
    if (tick.transitioned) {
      this._record(id, `CB ${tick.from} → ${tick.to}`);
      if (svc.cb._dirty) await this._persistCbState(svc);
    }

    if (svc.cb.isOpen()) return;

    if (SIMULATE_FAILURES.has(id)) {
      svc.simulated = true;
      const cbr = svc.onFailure("simulated_failure");
      this._record(id, "[SIM] marked down");
      if (cbr.transitioned) {
        this._record(id, `[SIM] CB ${cbr.from} → ${cbr.to}`);
        if (svc.cb._dirty) await this._persistCbState(svc);
      }
      return;
    }

    const start = Date.now();
    try {
      const { url, health_path, is_frontend } = svc.def;
      const parsed = new URL(health_path, url);
      const statusCode = await this._httpPing(parsed.hostname, Number(parsed.port), parsed.pathname);
      const latency    = Date.now() - start;
      const alive = is_frontend ? statusCode > 0 : (statusCode >= 200 && statusCode < 500);
      if (!alive) throw new Error(`HTTP ${statusCode}`);

      const prev = svc.status;
      const cbr  = svc.onSuccess(latency);
      if (prev === "down" || prev === "unknown") {
        this._record(id, `recovered — ${latency}ms`);
        if (svc.cb._dirty) await this._persistCbState(svc);
      }
      if (cbr.transitioned) {
        this._record(id, `CB ${cbr.from} → ${cbr.to}`);
        if (svc.cb._dirty) await this._persistCbState(svc);
      }
    } catch (err) {
      const prev = svc.status;
      const cbr  = svc.onFailure(err.message ?? String(err));
      if (prev !== "down") this._record(id, `down: ${err.message}`);
      if (cbr.transitioned) {
        this._record(id, `CB ${cbr.from} → ${cbr.to}`);
        if (svc.cb._dirty) await this._persistCbState(svc);
        if (cbr.to === CB_OPEN) this._writeSignal(id);
      }
    }
  }

  _writeSignal(id) {
    const svc = this._services.get(id);
    if (!svc) return;
    try {
      fs.writeFileSync(`${SIGNAL_DIR}/${id}.restart`, JSON.stringify({
        service:   id,
        name:      svc.def.display_name,
        ts:        new Date().toISOString(),
        reason:    "circuit_open",
      }));
    } catch (_) {}
    this._record(id, "signal file written to " + SIGNAL_DIR);
  }

  _record(id, msg) {
    const ts   = new Date().toISOString();
    const svc  = this._services.get(id);
    const name = svc?.def.display_name ?? id;
    const line = `[${ts}] [${id}] ${msg}`;
    console.log(`[watchdog-svc] ${line}`);
    this._log.push({ ts, service: id, name, message: msg });
    if (this._log.length > 500) this._log.shift();
  }

  // ── Public API ───────────────────────────────────────────────────────────────

  buildHealthPayload() {
    const services    = {};
    const depMap      = {};
    const cascadeRisks = [];

    for (const svc of this._services.values()) {
      depMap[svc.def.service_name] = svc.def.dependencies ?? [];
    }

    for (const [id, svc] of this._services) {
      const deps = depMap[id] ?? [];
      for (const dep of deps) {
        const ds = this._services.get(dep);
        if (ds && (ds.status === "down" || ds.cb.isOpen())) {
          cascadeRisks.push({ affected: svc.def.display_name, dependency: ds.def.display_name,
            reason: ds.cb.isOpen() ? "circuit_open" : "service_down" });
        }
      }

      services[id] = {
        name:            svc.def.display_name,
        status:          svc.status,
        url:             svc.def.url,
        latency_ms:      svc.latencyMs,
        avg_latency_ms:  svc.avgLatency(),
        p95_latency_ms:  svc.p95Latency(),
        last_check:      svc.lastCheck  ? new Date(svc.lastCheck).toISOString()  : null,
        last_up:         svc.lastUp     ? new Date(svc.lastUp).toISOString()     : null,
        last_down:       svc.lastDown   ? new Date(svc.lastDown).toISOString()   : null,
        uptime_pct:      Math.round(svc.uptimeRatio() * 10000) / 100,
        circuit_breaker: {
          state:              svc.cb.state,
          failure_count:      svc.cb.failureCount,
          cooldown_remaining: svc.cb.cooldownRemaining(),
        },
        dependencies:    depMap[id] ?? [],
        weight:          svc.def.weight,
        simulated:       svc.simulated,
      };
    }

    let score = 0, totalWeight = 0;
    for (const svc of this._services.values()) {
      const w = svc.def.weight;
      totalWeight += w;
      if      (svc.status === "up")      score += w;
      else if (svc.status === "slow")    score += w * 0.65;
      else if (svc.status === "unknown") score += w * 0.5;
    }
    const raw          = totalWeight > 0 ? (score / totalWeight) * 100 : 0;
    const health_score = Math.max(0, Math.round(raw - cascadeRisks.length * 3));
    const overall_status = health_score >= 90 ? "healthy" : health_score >= 60 ? "degraded" : "critical";

    return {
      overall_status,
      health_score,
      timestamp:         new Date().toISOString(),
      simulation_mode:   SIMULATE_FAILURES.size > 0,
      simulated_failures: [...SIMULATE_FAILURES],
      services,
      cascade_risks:     cascadeRisks,
      dependency_graph:  depMap,
      recent_events:     this._log.slice(-20),
    };
  }

  getFullState() {
    const registryRows = [];
    for (const [id, svc] of this._services) {
      registryRows.push({
        service_name:  id,
        display_name:  svc.def.display_name,
        url:           svc.def.url,
        health_path:   svc.def.health_path,
        weight:        svc.def.weight,
        is_frontend:   svc.def.is_frontend,
        dependencies:  svc.def.dependencies,
        status:        svc.status,
        circuit_state: svc.cb.state,
        failure_count: svc.cb.failureCount,
        opened_at:     svc.cb.openedAt ? new Date(svc.cb.openedAt).toISOString() : null,
      });
    }
    return {
      watchdog_port: PORT,
      db_connected:  !!pool,
      simulation_mode: SIMULATE_FAILURES.size > 0,
      registry:      registryRows,
      recent_events: this._log.slice(-50),
    };
  }

  async forceOpenCircuit(serviceId) {
    const svc = this._services.get(serviceId);
    if (!svc) return { ok: false, error: "service_not_found" };
    const r = svc.cb.forceOpen();
    if (svc.cb._dirty) await this._persistCbState(svc);
    this._record(serviceId, `Circuit force-OPEN by control API`);
    return { ok: true, service: serviceId, transition: r };
  }

  async forceCloseCircuit(serviceId) {
    const svc = this._services.get(serviceId);
    if (!svc) return { ok: false, error: "service_not_found" };
    const r = svc.cb.forceClose();
    if (svc.cb._dirty) await this._persistCbState(svc);
    this._record(serviceId, `Circuit force-CLOSED by control API`);
    return { ok: true, service: serviceId, transition: r };
  }

  signalRestart(serviceId) {
    const svc = this._services.get(serviceId);
    if (!svc) return { ok: false, error: "service_not_found" };
    this._writeSignal(serviceId);
    this._record(serviceId, "Manual restart signal via control API");
    return { ok: true, service: serviceId, signal_file: `${SIGNAL_DIR}/${serviceId}.restart` };
  }

  async updateRegistry(serviceId, updates) {
    const svc = this._services.get(serviceId);
    if (!svc) return { ok: false, error: "service_not_found" };
    const allowed = ["url","health_path","weight","is_frontend","dependencies","is_active","sort_order","display_name"];
    for (const [k, v] of Object.entries(updates)) {
      if (!allowed.includes(k)) continue;
      svc.def[k] = v;
    }
    if (pool) {
      try {
        await dbQuery(`
          UPDATE service_registry SET
            display_name = $2, url = $3, health_path = $4, weight = $5,
            is_frontend  = $6, dependencies = $7, is_active = $8,
            sort_order   = $9, updated_at = NOW()
          WHERE service_name = $1
        `, [serviceId, svc.def.display_name, svc.def.url, svc.def.health_path,
            svc.def.weight, svc.def.is_frontend,
            JSON.stringify(svc.def.dependencies), svc.def.is_active, svc.def.sort_order]);
      } catch (e) { return { ok: false, error: e.message }; }
    }
    this._record(serviceId, `Registry updated via control API: ${Object.keys(updates).join(", ")}`);
    return { ok: true, service: serviceId, updated: Object.keys(updates) };
  }

  getRegistry() {
    return [...this._services.values()].map(svc => ({
      service_name: svc.def.service_name,
      display_name: svc.def.display_name,
      url:          svc.def.url,
      health_path:  svc.def.health_path,
      weight:       svc.def.weight,
      is_frontend:  svc.def.is_frontend,
      dependencies: svc.def.dependencies,
      is_active:    svc.def.is_active ?? true,
      sort_order:   svc.def.sort_order,
      status:       svc.status,
    }));
  }

  // ── Internal ─────────────────────────────────────────────────────────────────

  _httpPing(host, port, path) {
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => { req.destroy(); reject(new Error(`timeout after ${PING_TIMEOUT_MS}ms`)); }, PING_TIMEOUT_MS);
      const req = http.get({ hostname: host, port, path, headers: { "x-watchdog": "1" } }, res => {
        clearTimeout(timer);
        res.resume();
        res.on("end", () => resolve(res.statusCode));
        res.on("error", reject);
      });
      req.on("error", err => { clearTimeout(timer); reject(err); });
    });
  }
}

// ── HTTP server ───────────────────────────────────────────────────────────────

function readBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    req.on("data", c => chunks.push(c));
    req.on("end",  () => {
      try { resolve(chunks.length ? JSON.parse(Buffer.concat(chunks).toString()) : {}); }
      catch (_) { resolve({}); }
    });
    req.on("error", reject);
  });
}

function json(res, code, body) {
  const s = JSON.stringify(body, null, 2);
  res.writeHead(code, { "content-type": "application/json", "cache-control": "no-store",
    "access-control-allow-origin": "*" });
  res.end(s);
}

async function handleRequest(core, req, res) {
  const url = req.url?.split("?")[0] ?? "/";
  const method = req.method?.toUpperCase();

  // Liveness
  if (url === "/health") {
    return json(res, 200, { status: "up", service: "watchdog", port: PORT, ts: new Date().toISOString() });
  }

  // Full health dashboard
  if (url === "/global-health" && method === "GET") {
    const payload = core.buildHealthPayload();
    return json(res, payload.health_score >= 60 ? 200 : 503, payload);
  }

  // Control plane — full state
  if (url === "/control/state" && method === "GET") {
    return json(res, 200, core.getFullState());
  }

  // Control plane — open circuit
  if (url === "/control/open-circuit" && method === "POST") {
    const body = await readBody(req);
    if (!body.service) return json(res, 400, { error: "service required" });
    return json(res, 200, await core.forceOpenCircuit(body.service));
  }

  // Control plane — close circuit
  if (url === "/control/close-circuit" && method === "POST") {
    const body = await readBody(req);
    if (!body.service) return json(res, 400, { error: "service required" });
    return json(res, 200, await core.forceCloseCircuit(body.service));
  }

  // Control plane — restart signal
  if (url === "/control/restart-service" && method === "POST") {
    const body = await readBody(req);
    if (!body.service) return json(res, 400, { error: "service required" });
    return json(res, 200, core.signalRestart(body.service));
  }

  // Control plane — registry list
  if (url === "/control/registry" && method === "GET") {
    return json(res, 200, { registry: core.getRegistry() });
  }

  // Control plane — registry update
  const registryUpdate = url.match(/^\/control\/registry\/([^/]+)$/);
  if (registryUpdate && method === "PUT") {
    const serviceId = decodeURIComponent(registryUpdate[1]);
    const body      = await readBody(req);
    return json(res, 200, await core.updateRegistry(serviceId, body));
  }

  // OPTIONS preflight
  if (method === "OPTIONS") {
    res.writeHead(204, { "access-control-allow-origin": "*", "access-control-allow-methods": "GET,POST,PUT", "access-control-allow-headers": "content-type" });
    return res.end();
  }

  return json(res, 404, { error: "not_found", path: url });
}

// ── Exports (digunakan oleh test) ─────────────────────────────────────────────

export { _buildProdUrlFromEnv, _doReconcile, DEV_URL_RE, PROD_SERVICE_PORT_ENV };

// ── Bootstrap ─────────────────────────────────────────────────────────────────

process.on("uncaughtException",  err => console.error(`[watchdog-svc] uncaught: ${err?.message}`));
process.on("unhandledRejection", err => console.error(`[watchdog-svc] unhandled: ${err?.message}`));

// Guard: hanya jalankan server jika file ini di-run langsung (bukan di-import oleh test)
const _isMain = Boolean(
  process.argv[1] &&
  (process.argv[1] === new URL(import.meta.url).pathname ||
   process.argv[1].endsWith("system-watchdog-service.mjs"))
);

if (_isMain) {
  const SYSTEM_MODE = process.env.SYSTEM_MODE ?? "PROD";

  function killPortSync(port) {
    const hex = port.toString(16).toUpperCase().padStart(4, "0");
    const inodes = new Set();
    for (const f of ["/proc/net/tcp6", "/proc/net/tcp"]) {
      try {
        for (const line of fs.readFileSync(f, "utf8").split("\n")) {
          const parts = line.trim().split(/\s+/);
          if (parts[1]?.endsWith(":" + hex)) inodes.add(parts[9]);
        }
      } catch {}
    }
    if (!inodes.size) return;
    try {
      for (const pid of fs.readdirSync("/proc")) {
        if (!/^\d+$/.test(pid) || Number(pid) === process.pid) continue;
        try {
          for (const fd of fs.readdirSync(`/proc/${pid}/fd`)) {
            try {
              const link = fs.readlinkSync(`/proc/${pid}/fd/${fd}`);
              if (link.startsWith("socket:[") && inodes.has(link.slice(8, -1))) {
                process.kill(Number(pid), "SIGKILL");
                console.log(`[watchdog-svc] killed stale PID ${pid} (port ${port})`);
              }
            } catch {}
          }
        } catch {}
      }
    } catch {}
  }

  const core = new WatchdogCore();

  core.init().then(() => {
    console.log(`[watchdog-svc] SYSTEM_MODE=${SYSTEM_MODE} — static port ${PORT} (no auto-shift)`);

    killPortSync(PORT);

    const srv = http.createServer((req, res) =>
      handleRequest(core, req, res).catch(err => {
        console.error(`[watchdog-svc] handler error: ${err?.message}`);
        if (!res.headersSent) json(res, 500, { error: "internal_error", message: err?.message });
      })
    );

    srv.once("error", (err) => {
      if (err.code === "EADDRINUSE") {
        console.error(`[watchdog-svc] FATAL: Port ${PORT} is already in use.`);
        console.error(`[watchdog-svc] Fix: ensure no other process is using port ${PORT} before starting this service.`);
        console.error(`[watchdog-svc] Static topology requires port ${PORT} to be exclusively assigned to watchdog.`);
      } else {
        console.error(`[watchdog-svc] FATAL: ${err.message}`);
      }
      process.exit(1);
    });

    srv.listen(PORT, () => {
      console.log(`[PORT CHECK] PID=${process.pid} PORT=${PORT} SERVICE=watchdog`);
      console.log(`[watchdog-svc] Listening on port ${PORT}`);
      console.log(`[watchdog-svc]   GET  /health`);
      console.log(`[watchdog-svc]   GET  /global-health`);
      console.log(`[watchdog-svc]   GET  /control/state`);
      console.log(`[watchdog-svc]   POST /control/open-circuit`);
      console.log(`[watchdog-svc]   POST /control/close-circuit`);
      console.log(`[watchdog-svc]   POST /control/restart-service`);
      console.log(`[watchdog-svc]   GET  /control/registry`);
      console.log(`[watchdog-svc]   PUT  /control/registry/:service`);
      core.start();
    });
  });
}
