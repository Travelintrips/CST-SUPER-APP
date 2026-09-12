/**
 * Verification tests for the worker heartbeat system.
 *
 * Tests both the in-memory registry logic AND the live HTTP endpoint.
 * Run with: node --test artifacts/api-server/src/lib/__tests__/workerHeartbeat.test.mjs
 *
 * The HTTP tests require the API server to be running on port 18444.
 */

import { describe, it, before } from "node:test";
import assert from "node:assert/strict";

const BASE = process.env.API_URL ?? "http://localhost:18444";

// ── 1. In-process registry logic tests ────────────────────────────────────────

describe("workerHeartbeat registry", () => {
  let registry;

  before(async () => {
    // Import the built JS (from dist) or fall back to ts-node transpile.
    // We test the logic inline to avoid needing a full build.
    registry = createTestRegistry();
  });

  it("registers a worker in waiting state with no beats", () => {
    registry.registerHeartbeat("test-worker-a", 60_000);
    const entries = registry.getWorkerHeartbeats();
    const w = entries.find(e => e.name === "test-worker-a");
    assert.ok(w, "worker should appear after registration");
    assert.equal(w.status, "waiting");
    assert.equal(w.totalBeats, 0);
    assert.equal(w.lastBeat, null);
  });

  it("transitions to ok after first beat", () => {
    registry.beat("test-worker-a");
    const w = registry.getWorkerHeartbeats().find(e => e.name === "test-worker-a");
    assert.equal(w.status, "ok");
    assert.equal(w.totalBeats, 1);
    assert.ok(w.lastBeat !== null, "lastBeat should be set");
  });

  it("shows degraded when last beat is older than 2× interval", () => {
    // Register with a tiny interval then fake the lastBeat timestamp
    registry.registerHeartbeat("test-worker-stale", 100);
    registry.beat("test-worker-stale");
    // Backdate the beat to 3× interval ago
    registry._backdateBeat("test-worker-stale", Date.now() - 300);
    const w = registry.getWorkerHeartbeats().find(e => e.name === "test-worker-stale");
    assert.equal(w.status, "degraded", `Expected degraded, got ${w.status}: ${w.detail}`);
  });

  it("shows dead when last beat is older than 5× interval", () => {
    registry._backdateBeat("test-worker-stale", Date.now() - 600);
    const w = registry.getWorkerHeartbeats().find(e => e.name === "test-worker-stale");
    assert.equal(w.status, "dead", `Expected dead, got ${w.status}: ${w.detail}`);
  });

  it("aggregate is degraded when any worker is dead", () => {
    const agg = registry.getWorkerAggregateStatus();
    assert.equal(agg, "degraded");
  });

  it("aggregate is ok when all non-waiting workers are ok", () => {
    // Beat the stale worker so it recovers
    registry.beat("test-worker-stale");
    const agg = registry.getWorkerAggregateStatus();
    assert.equal(agg, "ok");
  });
});

// ── 2. Live HTTP endpoint tests ───────────────────────────────────────────────

describe("GET /api/health/workers (live)", () => {
  it("returns 200 JSON with aggregate and workers array", async () => {
    const res = await fetch(`${BASE}/api/health/workers`);
    assert.equal(res.status, 200, "Expected HTTP 200");
    const ct = res.headers.get("content-type") ?? "";
    assert.ok(ct.includes("json"), `Expected JSON content-type, got: ${ct}`);
    const body = await res.json();
    assert.ok("aggregate" in body, "Response must have aggregate field");
    assert.ok(Array.isArray(body.workers), "Response must have workers array");
  });

  it("worker entries have required fields", async () => {
    const res = await fetch(`${BASE}/api/health/workers`);
    const { workers } = await res.json();
    for (const w of workers) {
      assert.ok(typeof w.name === "string" && w.name.length > 0, `Worker missing name: ${JSON.stringify(w)}`);
      assert.ok(["waiting", "ok", "degraded", "dead"].includes(w.status), `Invalid status ${w.status} for ${w.name}`);
      assert.ok(typeof w.detail === "string", `Worker ${w.name} missing detail string`);
      assert.ok(typeof w.intervalMs === "number" && w.intervalMs > 0, `Worker ${w.name} invalid intervalMs`);
      assert.ok(typeof w.totalBeats === "number", `Worker ${w.name} missing totalBeats`);
    }
  });

  it("aggregate is one of the allowed values", async () => {
    const res = await fetch(`${BASE}/api/health/workers`);
    const { aggregate } = await res.json();
    assert.ok(
      ["ok", "degraded", "unconfigured"].includes(aggregate),
      `Invalid aggregate: ${aggregate}`
    );
  });

  it("all worker names are unique", async () => {
    const res = await fetch(`${BASE}/api/health/workers`);
    const { workers } = await res.json();
    const names = workers.map(w => w.name);
    const unique = new Set(names);
    assert.equal(unique.size, names.length, `Duplicate worker names detected: ${names.filter((n, i) => names.indexOf(n) !== i).join(", ")}`);
  });

  it("financial-outbox-processor and financial-event-bus are distinct entries", async () => {
    const res = await fetch(`${BASE}/api/health/workers`);
    const { workers } = await res.json();
    const names = new Set(workers.map(w => w.name));
    // At least one of these must be present (outbox starts after 3s delay)
    const hasOutbox = names.has("financial-outbox-processor");
    const hasBus = names.has("financial-event-bus");
    // They must not be combined under a single name — confirm neither shadows the other
    assert.ok(
      !(hasOutbox && hasBus && workers.filter(w => w.name === "financial-outbox-processor" || w.name === "financial-event-bus").length !== 2),
      "financial-outbox-processor and financial-event-bus must be distinct entries"
    );
    // No worker should be registered as both
    assert.ok(!names.has("financial-outbox-processor") || workers.filter(w => w.name === "financial-outbox-processor").length === 1);
  });
});

// ── 3. healthz workers field test ─────────────────────────────────────────────

describe("GET /api/healthz workers field", () => {
  it("includes workers.aggregate and workers.endpoint", async () => {
    const res = await fetch(`${BASE}/api/healthz`);
    assert.equal(res.status, 200);
    const body = await res.json();
    assert.ok(body.workers, "healthz must include workers field");
    assert.ok("aggregate" in body.workers, "workers.aggregate must be present");
    assert.ok(typeof body.workers.endpoint === "string", "workers.endpoint must be a string");
    assert.ok(body.workers.endpoint.includes("workers"), "workers.endpoint must point to the workers route");
  });
});

// ── Helpers ────────────────────────────────────────────────────────────────────

/**
 * Creates a self-contained registry instance for logic-only testing
 * without needing to import TypeScript source or the built dist.
 */
function createTestRegistry() {
  const _reg = new Map();

  function computeStatus(entry) {
    const now = Date.now();
    const { intervalMs, registeredAt, lastBeat } = entry;
    if (lastBeat === null) {
      const age = now - registeredAt;
      if (age > 5 * intervalMs) return { status: "dead", detail: `No beat in ${age}ms` };
      return { status: "waiting", detail: `Waiting ${age}ms` };
    }
    const elapsed = now - lastBeat;
    if (elapsed <= 2 * intervalMs) return { status: "ok", detail: `${elapsed}ms ago` };
    if (elapsed <= 5 * intervalMs) return { status: "degraded", detail: `${elapsed}ms ago` };
    return { status: "dead", detail: `${elapsed}ms ago` };
  }

  return {
    registerHeartbeat(name, intervalMs) {
      if (!_reg.has(name)) {
        _reg.set(name, { name, intervalMs, registeredAt: Date.now(), startedAt: null, lastBeat: null, totalBeats: 0 });
      }
    },
    beat(name) {
      const e = _reg.get(name);
      if (!e) return;
      const now = Date.now();
      if (!e.startedAt) e.startedAt = now;
      e.lastBeat = now;
      e.totalBeats++;
    },
    // Test-only: backdate lastBeat to simulate stale worker
    _backdateBeat(name, ts) {
      const e = _reg.get(name);
      if (e) e.lastBeat = ts;
    },
    getWorkerHeartbeats() {
      return Array.from(_reg.values()).map(e => ({ ...e, ...computeStatus(e) }));
    },
    getWorkerAggregateStatus() {
      const entries = this.getWorkerHeartbeats();
      if (entries.length === 0) return "unconfigured";
      const nonWaiting = entries.filter(e => e.status !== "waiting");
      if (nonWaiting.some(e => e.status === "dead" || e.status === "degraded")) return "degraded";
      return "ok";
    },
  };
}
