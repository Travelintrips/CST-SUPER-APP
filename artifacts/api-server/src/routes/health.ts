import { Router, type IRouter } from "express";
import { pool } from "@workspace/db";
import { getRuntimeCheckState } from "../lib/startupValidator.js";
import { getWorkerHeartbeats, getWorkerAggregateStatus } from "../lib/workerHeartbeat.js";
import { getE2ESafetyStatus, isProductionMode } from "../lib/e2eSafetyGuard.js";
import { checkSequenceDesync } from "../lib/accountingMigration.js";
import { checkSmtpConnection } from "../lib/mailer.js";
import { getApiRevision } from "../lib/buildMetadata.js";

const router: IRouter = Router();
const startedAt = Date.now();

type ServiceStatus = "ok" | "error" | "unconfigured" | "degraded";

interface ExternalCheckResult {
  status: ServiceStatus;
  latencyMs: number | null;
  detail?: string;
}

const cache = new Map<string, { result: ExternalCheckResult; expiresAt: number }>();

async function cachedCheck(
  key: string,
  fn: () => Promise<ExternalCheckResult>,
  ttlMs = 60_000,
): Promise<ExternalCheckResult> {
  const hit = cache.get(key);
  if (hit && hit.expiresAt > Date.now()) return hit.result;
  const result = await fn();
  cache.set(key, { result, expiresAt: Date.now() + ttlMs });
  return result;
}

async function checkDb(): Promise<ExternalCheckResult> {
  try {
    const t0 = Date.now();
    await pool.query("SELECT 1");
    return { status: "ok", latencyMs: Date.now() - t0 };
  } catch (err) {
    return { status: "error", latencyMs: null, detail: String(err) };
  }
}

async function checkFonnte(): Promise<ExternalCheckResult> {
  const token = process.env.FONNTE_TOKEN?.trim();
  if (!token) return { status: "unconfigured", latencyMs: null };
  try {
    const t0 = Date.now();
    type FetchRes = { ok: boolean; status: number; json(): Promise<unknown> };
    const res = await fetch("https://api.fonnte.com/device", {
      method: "POST",
      headers: { Authorization: token },
      signal: AbortSignal.timeout(5_000),
    }) as unknown as FetchRes;
    const latencyMs = Date.now() - t0;
    if (!res.ok) return { status: "error", latencyMs, detail: `HTTP ${res.status}` };
    const body = await res.json() as Record<string, unknown>;
    if (body.status === false || body.status === "false") {
      return { status: "error", latencyMs, detail: String(body.reason ?? body.message ?? "status:false") };
    }
    return { status: "ok", latencyMs };
  } catch (err) {
    return { status: "error", latencyMs: null, detail: String(err) };
  }
}

async function checkSmtp(): Promise<ExternalCheckResult> {
  return checkSmtpConnection();
}

router.get("/ping", (_req, res) => {
  res.json({ ok: true, ts: Date.now() });
});

// ── GET /api/health/workers ───────────────────────────────────────────────────
// Returns per-worker heartbeat status. No auth required — read-only, no secrets.
// Route is /health/workers because healthRouter is mounted without prefix at /api,
// making the final path /api/health/workers.
router.get("/health/workers", (_req, res) => {
  const workers = getWorkerHeartbeats();
  const aggregate = getWorkerAggregateStatus();

  res.json({
    aggregate,
    workers: workers.map((w) => ({
      name:         w.name,
      status:       w.status,
      detail:       w.detail,
      intervalMs:   w.intervalMs,
      lastBeat:     w.lastBeat ? new Date(w.lastBeat).toISOString() : null,
      totalBeats:   w.totalBeats,
      registeredAt: new Date(w.registeredAt).toISOString(),
    })),
  });
});

// ── GET /api/healthz ─────────────────────────────────────────────────────────
router.get("/healthz", async (_req, res) => {
  const uptimeSeconds = Math.floor((Date.now() - startedAt) / 1000);
  const version = process.env.npm_package_version ?? "0.0.0";

  const [db, whatsapp, smtp] = await Promise.all([
    checkDb(),
    cachedCheck("fonnte", checkFonnte),
    cachedCheck("smtp", checkSmtp),
  ]);

  const runtimeState = getRuntimeCheckState();
  const hasMissingDeps = (runtimeState?.missing.length ?? 0) > 0;
  const missingIntegrations = runtimeState?.missingIntegrationSecrets ?? [];

  const workerAggregate = getWorkerAggregateStatus();

  const criticalFailing = db.status === "error";
  const anyExternalError = whatsapp.status === "error" || smtp.status === "error";
  const workersDegraded = workerAggregate === "degraded";

  const overallStatus = criticalFailing ? "error"
    : hasMissingDeps ? "degraded"
    : anyExternalError ? "degraded"
    : workersDegraded ? "degraded"
    : "ok";

  // Selalu return 200 agar deployment platform tidak restart server.
  // DB down bukan alasan untuk membunuh proses — session memory masih bisa melayani user.
  res.status(200).json({
    status: overallStatus,
    db: db.status,
    dbLatencyMs: db.latencyMs,
    uptimeSeconds,
    version,
    revision: getApiRevision(),
    services: {
      db: db.status,
      whatsapp: whatsapp.status,
      whatsappLatencyMs: whatsapp.latencyMs,
      smtp: smtp.status,
      smtpLatencyMs: smtp.latencyMs,
    },
    workers: {
      aggregate: workerAggregate,
      endpoint: "/api/health/workers",
    },
    dependencies: runtimeState
      ? {
          status: runtimeState.status,
          missing: runtimeState.missing,
          checkedAt: runtimeState.checkedAt,
        }
      : { status: "not_checked", missing: [] },
    integrationSecrets: {
      missing: missingIntegrations,
      all: runtimeState?.integrationSecrets ?? [],
    },
  });
});

// ── GET /api/health/sequence-check ───────────────────────────────────────────
// Manual diagnostic: returns all serial sequences where last_value < MAX(id).
// Read-only — never mutates the database.
// Empty desynced array means all sequences are in sync.
router.get("/health/sequence-check", async (_req, res) => {
  try {
    const desynced = await checkSequenceDesync();
    const status = desynced.length === 0 ? "ok" : "desync_detected";
    return res.status(200).json({
      status,
      desyncedCount: desynced.length,
      desynced: desynced.map(d => ({
        table:     d.table,
        column:    d.column,
        sequence:  d.seq,
        lastValue: d.lastValue,
        maxId:     d.maxId,
        gap:       d.gap,
      })),
      checkedAt: new Date().toISOString(),
      hint: desynced.length > 0
        ? "Restart the API server — syncAccountingSequences() runs on startup and will fix these gaps."
        : undefined,
    });
  } catch (err) {
    return res.status(500).json({ status: "error", detail: String(err) });
  }
});

// GET /api/health/e2e-safety — read-only E2E safety status.
// NOT available in production mode.
router.get("/e2e-safety", (req, res) => {
  if (isProductionMode()) {
    // Return 404 — do not reveal e2e mode metadata in production
    return res.status(404).json({ error: "Not found" });
  }
  const status = getE2ESafetyStatus();
  return res.status(200).json(status);
});

export default router;
