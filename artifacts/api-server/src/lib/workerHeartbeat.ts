/**
 * workerHeartbeat.ts
 *
 * Lightweight in-memory heartbeat registry for background workers.
 *
 * Usage:
 *   1. In the worker's start function call:
 *        registerHeartbeat("my-worker", intervalMs);
 *   2. Inside each tick call:
 *        beat("my-worker");
 *   3. The health endpoint reads getWorkerHeartbeats() to report status.
 *
 * Status rules (checked at query time, not on a timer):
 *   waiting   — registered & started, but no beat received yet AND age < 3× interval
 *   ok        — last beat within 2× interval
 *   degraded  — last beat between 2× and 5× interval (missed ≥ 2 ticks)
 *   dead      — last beat > 5× interval, OR registered but no beat after 5× interval
 */

export type HeartbeatStatus = "waiting" | "ok" | "degraded" | "dead";

export interface HeartbeatEntry {
  name: string;
  /** Expected tick period in ms. Used to compute degraded/dead thresholds. */
  intervalMs: number;
  registeredAt: number;
  /** Timestamp when the first beat() arrived, or null if none yet. */
  startedAt: number | null;
  /** Timestamp of the most recent beat(), or null if none yet. */
  lastBeat: number | null;
  totalBeats: number;
  status: HeartbeatStatus;
  /** Human-readable reason for current status (for operators). */
  detail: string;
}

// ── Internal registry ─────────────────────────────────────────────────────────

const _registry = new Map<string, Omit<HeartbeatEntry, "status" | "detail">>();

// ── Helpers ───────────────────────────────────────────────────────────────────

function computeStatus(entry: Omit<HeartbeatEntry, "status" | "detail">): Pick<HeartbeatEntry, "status" | "detail"> {
  const now = Date.now();
  const { intervalMs, registeredAt, startedAt, lastBeat } = entry;

  if (lastBeat === null) {
    // No beat received yet — check if we've been waiting too long
    const age = now - registeredAt;
    if (age > 5 * intervalMs) {
      return { status: "dead", detail: `No beat received in ${Math.round(age / 1000)}s (expected first beat within ${Math.round(intervalMs / 1000)}s)` };
    }
    return { status: "waiting", detail: `Waiting for first beat (${Math.round(age / 1000)}s since registration)` };
  }

  const elapsed = now - lastBeat;

  if (elapsed <= 2 * intervalMs) {
    return { status: "ok", detail: `Last beat ${Math.round(elapsed / 1000)}s ago` };
  }
  if (elapsed <= 5 * intervalMs) {
    const missed = Math.floor(elapsed / intervalMs) - 1;
    return { status: "degraded", detail: `Missed ~${missed} tick(s) — last beat ${Math.round(elapsed / 1000)}s ago` };
  }
  return { status: "dead", detail: `No beat for ${Math.round(elapsed / 1000)}s (threshold: ${Math.round(5 * intervalMs / 1000)}s)` };
}

// ── Public API ────────────────────────────────────────────────────────────────

/**
 * Call once when the worker's start function is invoked.
 * Safe to call multiple times — subsequent calls update intervalMs but don't reset beats.
 */
export function registerHeartbeat(name: string, intervalMs: number): void {
  const existing = _registry.get(name);
  if (existing) {
    existing.intervalMs = intervalMs; // allow hot update
    return;
  }
  _registry.set(name, {
    name,
    intervalMs,
    registeredAt: Date.now(),
    startedAt: null,
    lastBeat: null,
    totalBeats: 0,
  });
}

/**
 * Call on every successful tick. Thread-safe (single-threaded Node.js).
 * No-ops if the worker was not registered — safe to call unconditionally.
 */
export function beat(name: string): void {
  const entry = _registry.get(name);
  if (!entry) return;
  const now = Date.now();
  if (entry.startedAt === null) entry.startedAt = now;
  entry.lastBeat = now;
  entry.totalBeats++;
}

/**
 * Returns a point-in-time snapshot of all registered workers with computed status.
 */
export function getWorkerHeartbeats(): HeartbeatEntry[] {
  return Array.from(_registry.values()).map((entry) => ({
    ...entry,
    ...computeStatus(entry),
  }));
}

/**
 * Returns aggregate health across all registered workers.
 * Ignores workers in 'waiting' state (they haven't had time to beat yet).
 */
export function getWorkerAggregateStatus(): "ok" | "degraded" | "unconfigured" {
  const entries = getWorkerHeartbeats();
  if (entries.length === 0) return "unconfigured";
  const nonWaiting = entries.filter((e) => e.status !== "waiting");
  if (nonWaiting.some((e) => e.status === "dead" || e.status === "degraded")) return "degraded";
  return "ok";
}
