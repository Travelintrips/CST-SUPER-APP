import { Router } from "express";
import { db } from "@workspace/db";
import { systemErrorLogs } from "@workspace/db/schema";
import { sql, desc, eq, gte, and } from "drizzle-orm";
import { z } from "zod";
import { requireAdmin } from "../lib/requireAdmin.js";
import { sendWhatsApp } from "../lib/fonnte.js";
import {
  getLastHealthSnapshot,
  getRecentHealthSnapshots,
  runIntegrationHealthCheck,
  saveHealthSnapshot,
  detectStatusFlips,
} from "../lib/integrationHealthService.js";
import { getIntegrationHealthWorkerStatus } from "../lib/integrationHealthWorker.js";

export const systemObservabilityRouter = Router();

const clientErrorSchema = z.object({
  error_message: z.string().min(1).max(2000),
  stack_trace: z.string().max(10000).optional(),
  route: z.string().max(500).optional(),
  component: z.string().max(200).optional(),
  severity: z.enum(["low", "medium", "high", "critical"]).optional(),
  metadata: z.record(z.string(), z.unknown()).optional(),
});

function classifyErrorType(
  message: string,
  stack?: string
): "ui_crash" | "api_failure" | "validation_error" | "network_error" | "unknown" {
  const m = (message + " " + (stack ?? "")).toLowerCase();
  if (m.includes("fetch") || m.includes("network") || m.includes("econnrefused") || m.includes("timeout")) {
    return "network_error";
  }
  if (m.includes("validation") || m.includes("zod") || m.includes("invalid") || m.includes("required")) {
    return "validation_error";
  }
  if (m.includes("api") || m.includes(" 500") || m.includes(" 404") || m.includes(" 401") || m.includes(" 403")) {
    return "api_failure";
  }
  if (m.includes("cannot read") || m.includes("is not a function") || m.includes("undefined") || m.includes("null")) {
    return "ui_crash";
  }
  return "unknown";
}

const waAlertCache = new Map<string, { count: number; firstSeen: number; alerted: boolean }>();

async function maybeAlertWA(message: string, severity: string) {
  if (severity !== "high" && severity !== "critical") return;

  const key = message.slice(0, 100);
  const now = Date.now();
  const WINDOW_MS = 10 * 60 * 1000;
  const THRESHOLD = 10;

  const entry = waAlertCache.get(key);
  if (!entry) {
    waAlertCache.set(key, { count: 1, firstSeen: now, alerted: false });
    return;
  }

  if (now - entry.firstSeen > WINDOW_MS) {
    waAlertCache.set(key, { count: 1, firstSeen: now, alerted: false });
    return;
  }

  entry.count++;

  if (entry.count >= THRESHOLD && !entry.alerted) {
    entry.alerted = true;
    const adminWa = process.env.FONNTE_ADMIN_WA;
    if (adminWa) {
      const text =
        `🚨 *[System Alert] Error Spike Terdeteksi*\n\n` +
        `Severity: *${severity.toUpperCase()}*\n` +
        `Error: ${message.slice(0, 200)}\n` +
        `Frekuensi: ${entry.count}x dalam 10 menit\n` +
        `Waktu: ${new Date().toLocaleString("id-ID")}`;
      sendWhatsApp(adminWa, text).catch(() => {});
    }
  }
}

systemObservabilityRouter.post("/client-error", async (req, res) => {
  const parsed = clientErrorSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Invalid payload" });
    return;
  }

  const { error_message, stack_trace, route, component, severity, metadata } = parsed.data;
  const errorType = classifyErrorType(error_message, stack_trace);
  const finalSeverity = severity ?? "medium";

  try {
    await db.insert(systemErrorLogs).values({
      error_message,
      stack_trace: stack_trace ?? null,
      route: route ?? null,
      component: component ?? null,
      severity: finalSeverity as "low" | "medium" | "high" | "critical",
      error_type: errorType,
      metadata: metadata ?? null,
    });

    await maybeAlertWA(error_message, finalSeverity);

    res.json({ ok: true });
  } catch (err) {
    console.error("[observability] insert error:", err);
    res.status(500).json({ error: "Failed to log error" });
  }
});

systemObservabilityRouter.get("/client-errors/stats", async (req, res) => {
  if (!(await requireAdmin(req, res))) return;

  const now = new Date();
  const startOfDay = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const minus5m = new Date(now.getTime() - 5 * 60 * 1000);
  const minus1h = new Date(now.getTime() - 60 * 60 * 1000);
  const minus24h = new Date(now.getTime() - 24 * 60 * 60 * 1000);

  const [todayRows, spike5mRows, spikeHourRows, bySeverityRows, topComponentRows, byTypeRows, hourlyRows, recurringRows] =
    await Promise.all([
      db
        .select({ count: sql<number>`cast(count(*) as int)` })
        .from(systemErrorLogs)
        .where(gte(systemErrorLogs.created_at, startOfDay)),
      db
        .select({ count: sql<number>`cast(count(*) as int)` })
        .from(systemErrorLogs)
        .where(gte(systemErrorLogs.created_at, minus5m)),
      db
        .select({ count: sql<number>`cast(count(*) as int)` })
        .from(systemErrorLogs)
        .where(gte(systemErrorLogs.created_at, minus1h)),
      db
        .select({
          severity: systemErrorLogs.severity,
          count: sql<number>`cast(count(*) as int)`,
        })
        .from(systemErrorLogs)
        .where(gte(systemErrorLogs.created_at, startOfDay))
        .groupBy(systemErrorLogs.severity),
      db
        .select({
          component: systemErrorLogs.component,
          count: sql<number>`cast(count(*) as int)`,
        })
        .from(systemErrorLogs)
        .where(
          and(
            gte(systemErrorLogs.created_at, startOfDay),
            sql`${systemErrorLogs.component} is not null`
          )
        )
        .groupBy(systemErrorLogs.component)
        .orderBy(desc(sql`count(*)`))
        .limit(10),
      db
        .select({
          error_type: systemErrorLogs.error_type,
          count: sql<number>`cast(count(*) as int)`,
        })
        .from(systemErrorLogs)
        .where(gte(systemErrorLogs.created_at, startOfDay))
        .groupBy(systemErrorLogs.error_type),
      db.execute(sql`
        SELECT
          to_char(date_trunc('hour', created_at), 'HH24:00') as hour,
          cast(count(*) as int) as count
        FROM system_error_logs
        WHERE created_at >= ${minus24h}
        GROUP BY date_trunc('hour', created_at)
        ORDER BY date_trunc('hour', created_at)
      `),
      db.execute(sql`
        SELECT
          error_message,
          cast(count(*) as int) as count,
          max(created_at) as last_seen
        FROM system_error_logs
        WHERE created_at >= ${minus1h}
        GROUP BY error_message
        HAVING count(*) > 5
        ORDER BY count DESC
        LIMIT 10
      `),
    ]);

  const bySeverity: Record<string, number> = {};
  for (const r of bySeverityRows) bySeverity[r.severity] = r.count;

  const byType: Record<string, number> = {};
  for (const r of byTypeRows) byType[r.error_type] = r.count;

  res.json({
    todayCount: todayRows[0]?.count ?? 0,
    spike5m: spike5mRows[0]?.count ?? 0,
    spikeHour: spikeHourRows[0]?.count ?? 0,
    bySeverity,
    topComponents: topComponentRows.map((r) => ({
      component: r.component ?? "(unknown)",
      count: r.count,
    })),
    byType,
    hourlyData: (hourlyRows.rows as { hour: string; count: number }[]),
    recurringErrors: (recurringRows.rows as { error_message: string; count: number; last_seen: string }[]),
  });
});

systemObservabilityRouter.get("/client-errors", async (req, res) => {
  if (!(await requireAdmin(req, res))) return;

  const severity = req.query.severity as string | undefined;
  const errorType = req.query.error_type as string | undefined;
  const limit = Math.min(Number(req.query.limit ?? 20), 100);
  const offset = Number(req.query.offset ?? 0);

  const conditions = [];
  if (severity && severity !== "all") {
    conditions.push(eq(systemErrorLogs.severity, severity as "low" | "medium" | "high" | "critical"));
  }
  if (errorType && errorType !== "all") {
    conditions.push(
      eq(
        systemErrorLogs.error_type,
        errorType as "ui_crash" | "api_failure" | "validation_error" | "network_error" | "unknown"
      )
    );
  }

  const where = conditions.length > 0 ? and(...conditions) : undefined;

  const [rows, countRows] = await Promise.all([
    db
      .select()
      .from(systemErrorLogs)
      .where(where)
      .orderBy(desc(systemErrorLogs.created_at))
      .limit(limit)
      .offset(offset),
    db
      .select({ count: sql<number>`cast(count(*) as int)` })
      .from(systemErrorLogs)
      .where(where),
  ]);

  res.json({ data: rows, total: countRows[0]?.count ?? 0 });
});

// ── Integration Health ────────────────────────────────────────────────────────

/**
 * GET /api/logs/integration-health
 * Returns the latest health snapshot + worker status.
 * Admin-only.
 */
systemObservabilityRouter.get("/integration-health", async (req, res) => {
  if (!(await requireAdmin(req, res))) return;

  const [latest, history] = await Promise.all([
    getLastHealthSnapshot(),
    getRecentHealthSnapshots(10),
  ]);

  const workerStatus = getIntegrationHealthWorkerStatus();

  res.json({
    latest,
    history,
    worker: workerStatus,
    checkedAt: latest?.checkedAt ?? null,
    allPassed: latest?.allPassed ?? null,
  });
});

/**
 * POST /api/logs/integration-health/run
 * Trigger an immediate health check (admin-only, rate-limited implicitly by admin auth).
 */
systemObservabilityRouter.post("/integration-health/run", async (req, res) => {
  if (!(await requireAdmin(req, res))) return;

  try {
    const previous = await getLastHealthSnapshot();
    const { results, allPassed, testedAt } = await runIntegrationHealthCheck();
    const flips = detectStatusFlips(previous?.results ?? null, results);
    await saveHealthSnapshot(results, allPassed, false);

    const verdicts = Object.fromEntries(
      Object.entries(results).map(([k, v]) => [
        k,
        `${v.status === "pass" ? "✅" : v.status === "unconfigured" ? "⚠️" : "❌"} ${v.status.toUpperCase()}` +
          (v.latencyMs != null ? ` (${v.latencyMs}ms)` : ""),
      ]),
    );

    res.json({ ok: true, allPassed, results, verdicts, flips, testedAt });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    res.status(500).json({ ok: false, error: msg });
  }
});
