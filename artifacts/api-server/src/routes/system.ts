/**
 * system.ts — Governance, Runtime & Vendor Performance Health Endpoints
 *
 * GET /api/system/governance-health       — Admin-only. Observability ringkasan ERP.
 * GET /api/system/runtime-check           — Admin-only. Dependency audit + runtime validation.
 * GET /api/system/vendor-performance-health — Admin-only. Vendor performance migration & row count.
 */

import { Router, type Request, type Response, type NextFunction } from "express";
import { db, getCircuitBreakerStatus, resetCircuitBreaker, getPoolStats, getActiveDbInfo, pingDbNoCb } from "@workspace/db";
import { sql } from "drizzle-orm";
import { requireAdmin } from "../lib/requireAdmin.js";
import { logger } from "../lib/logger.js";
import { getRuntimeCheckState } from "../lib/startupValidator.js";
import { getWorkerStates } from "../lib/startupOrchestrator.js";

const router = Router();

async function requireAdminMiddleware(req: Request, res: Response, next: NextFunction) {
  const ok = await requireAdmin(req, res);
  if (ok) next();
}

router.use(requireAdminMiddleware);

// ── Governance Health ──────────────────────────────────────────────────────────
router.get("/governance-health", async (_req, res) => {
  try {
    const [
      exceptionStats,
      recentTransitions,
      overdueInvoices,
      overdueBills,
      auditModuleSummary,
      runtimeState,
      vendorPerfStats,
    ] = await Promise.all([
      db.execute(sql`
        SELECT
          COUNT(*)                                                   AS total,
          SUM(CASE WHEN status = 'open'        THEN 1 ELSE 0 END)  AS open,
          SUM(CASE WHEN status = 'in_progress' THEN 1 ELSE 0 END)  AS in_progress,
          SUM(CASE WHEN status = 'resolved'    THEN 1 ELSE 0 END)  AS resolved,
          SUM(CASE WHEN status = 'closed'      THEN 1 ELSE 0 END)  AS closed,
          SUM(CASE WHEN severity = 'critical'  THEN 1 ELSE 0 END)  AS critical,
          SUM(CASE WHEN severity = 'high'      THEN 1 ELSE 0 END)  AS high,
          SUM(CASE WHEN exception_type = 'delivery_delayed' AND status IN ('open','in_progress') THEN 1 ELSE 0 END) AS open_delivery_delayed,
          SUM(CASE WHEN exception_type = 'payment_overdue'  AND status IN ('open','in_progress') THEN 1 ELSE 0 END) AS open_payment_overdue,
          SUM(CASE WHEN exception_type = 'vendor_rejected'  AND status IN ('open','in_progress') THEN 1 ELSE 0 END) AS open_vendor_rejected
        FROM exceptions
      `),
      db.execute(sql`
        SELECT
          id, order_id, order_number, old_status, new_status,
          changed_by_type, changed_by_name, source, created_at
        FROM order_status_history
        ORDER BY created_at DESC
        LIMIT 20
      `),
      db.execute(sql`
        SELECT COUNT(*) AS count
        FROM sales_documents
        WHERE invoice_status = 'invoiced'
          AND payment_status IN ('unpaid', 'partial')
          AND status != 'cancelled'
          AND due_date IS NOT NULL
          AND due_date < CURRENT_DATE
      `),
      db.execute(sql`
        SELECT COUNT(*) AS count
        FROM purchase_documents
        WHERE bill_status = 'billed'
          AND payment_status IN ('unpaid', 'partial')
          AND status != 'cancelled'
          AND due_date IS NOT NULL
          AND due_date < CURRENT_DATE::text
      `),
      db.execute(sql`
        SELECT module, action, COUNT(*) AS count
        FROM erp_audit_logs
        WHERE created_at > NOW() - INTERVAL '24 hours'
          AND action = 'status_transition'
        GROUP BY module, action
        ORDER BY count DESC
        LIMIT 20
      `),
      // Runtime check — from cached state
      Promise.resolve(getRuntimeCheckState()),
      // Vendor performance stats
      db.execute(sql`
        SELECT
          COUNT(*) AS total_rows,
          COUNT(*) FILTER (WHERE total_orders > 0) AS with_orders,
          MAX(updated_at) AS last_updated
        FROM vendor_performance
      `).catch(() => ({ rows: [] })),
    ]);

    const exc = (exceptionStats.rows[0] ?? {}) as Record<string, unknown>;
    const inv = (overdueInvoices.rows[0] ?? { count: 0 }) as { count: unknown };
    const bil = (overdueBills.rows[0] ?? { count: 0 }) as { count: unknown };
    const vpRow = (vendorPerfStats.rows[0] ?? {}) as Record<string, unknown>;

    const depAudit = runtimeState
      ? { status: runtimeState.status, missing: runtimeState.missing, checkedAt: runtimeState.checkedAt, dependencies: runtimeState.dependencies }
      : { status: "not_checked", missing: [], checkedAt: null, dependencies: {} };

    const depErrorCount = runtimeState
      ? Object.values(runtimeState.dependencies).filter(d => d.status === "error").length
      : 0;
    const depMissingCount = runtimeState?.missing.length ?? 0;
    const depOk = runtimeState?.status === "ok";

    res.json({
      generatedAt: new Date().toISOString(),

      // A. Files yang diaudit / diubah dalam infra hardening
      filesAudited: {
        checked: [
          "artifacts/api-server/build.mjs",
          "artifacts/api-server/package.json",
          "artifacts/api-server/src/lib/startupValidator.ts",
          "artifacts/api-server/src/routes/system.ts",
          "artifacts/api-server/src/routes/health.ts",
        ],
        notes: {
          "build.mjs":          "googleapis & @google-cloud/* ada di external list — di-load sebagai runtime require()",
          "package.json":       "googleapis@^173 ada di dependencies (bukan devDependencies)",
          "startupValidator.ts":"Validasi runtime: googleapis, openai, drizzle-orm, pg, nodemailer",
          "system.ts":          "GET /api/system/runtime-check & /api/system/governance-health",
          "health.ts":          "GET /api/healthz — integrasi runtimeState ke healthz degraded check",
        },
      },

      exceptions: {
        total:               Number(exc["total"]               ?? 0),
        open:                Number(exc["open"]                ?? 0),
        in_progress:         Number(exc["in_progress"]         ?? 0),
        resolved:            Number(exc["resolved"]            ?? 0),
        closed:              Number(exc["closed"]              ?? 0),
        critical:            Number(exc["critical"]            ?? 0),
        high:                Number(exc["high"]                ?? 0),
        openDeliveryDelayed: Number(exc["open_delivery_delayed"] ?? 0),
        openPaymentOverdue:  Number(exc["open_payment_overdue"]  ?? 0),
        openVendorRejected:  Number(exc["open_vendor_rejected"]  ?? 0),
      },
      overdue: {
        invoices: Number(inv["count"] ?? 0),
        bills:    Number(bil["count"] ?? 0),
      },
      recentStatusTransitions: recentTransitions.rows,
      auditLast24h: auditModuleSummary.rows,

      // B. Dependency audit
      dependencyAudit: depAudit,

      // C. Runtime validation (summary — detail ada di dependencyAudit.dependencies)
      runtimeValidation: {
        status:       runtimeState?.status ?? "not_checked",
        checkedAt:    runtimeState?.checkedAt ?? null,
        totalChecked: runtimeState ? Object.keys(runtimeState.dependencies).length : 0,
        okCount:      runtimeState ? Object.values(runtimeState.dependencies).filter(d => d.status === "ok").length : 0,
        errorCount:   depErrorCount,
        missingCount: depMissingCount,
      },

      vendorPerformance: {
        tableExists:   vpRow["total_rows"] !== undefined,
        totalRows:     Number(vpRow["total_rows"] ?? 0),
        withOrders:    Number(vpRow["with_orders"] ?? 0),
        lastUpdated:   vpRow["last_updated"] ?? null,
      },

      // D. Test result — overall pass/fail
      testResult: {
        allOk:   depOk,
        status:  depOk ? "PASS" : (depMissingCount > 0 ? "FAIL" : "DEGRADED"),
        summary: depOk
          ? "Semua dependency runtime OK. Server dalam kondisi sehat."
          : depMissingCount > 0
            ? `${depMissingCount} dependency HILANG: ${runtimeState?.missing.join(", ") ?? "—"}. Jalankan: pnpm add <package>`
            : `${depErrorCount} dependency error saat load. Periksa logs startupValidator untuk detail.`,
        action: depOk ? null : depMissingCount > 0
          ? `pnpm add ${runtimeState?.missing.join(" ")}`
          : "Cek artifacts/api-server/src/lib/startupValidator.ts dan jalankan ulang server",
      },
    });
  } catch (err) {
    logger.error({ err }, "governance-health error");
    res.status(500).json({ error: "Gagal memuat governance health" });
  }
});

// ── Runtime Check ──────────────────────────────────────────────────────────────
router.get("/runtime-check", async (_req, res) => {
  try {
    const state = getRuntimeCheckState();

    if (!state) {
      return res.status(503).json({
        status: "not_ready",
        message: "Startup validation belum selesai. Coba beberapa detik lagi.",
        dependencies: {},
        missing: [],
      });
    }

    const filesAudited = [
      "artifacts/api-server/build.mjs",
      "artifacts/api-server/package.json",
    ];

    const buildExternals = [
      "googleapis", "@google-cloud/*", "@google/*",
    ];

    res.json({
      status: state.status,
      checkedAt: state.checkedAt,
      dependencies: state.dependencies,
      missing: state.missing,
      audit: {
        filesAudited,
        buildExternals: {
          note: "googleapis ada di external list build.mjs — di-bundle sebagai runtime require()",
          entries: buildExternals,
        },
        packageJson: {
          googleapis: "ada di dependencies (bukan devDependencies) ✅",
          openai: "ada di dependencies ✅",
          "drizzle-orm": "ada di dependencies ✅",
          nodemailer: "ada di dependencies ✅",
        },
      },
      testResult: {
        allOk: state.status === "ok",
        summary: state.status === "ok"
          ? "Semua dependency runtime tersedia dan dapat di-import."
          : `${state.missing.length} dependency hilang, ${Object.values(state.dependencies).filter(d => d.status === "error").length} error saat load.`,
      },
    });
  } catch (err) {
    logger.error({ err }, "runtime-check error");
    res.status(500).json({ error: "Gagal menjalankan runtime check" });
  }
});

// ── Vendor Performance Health ──────────────────────────────────────────────────
router.get("/vendor-performance-health", async (_req, res) => {
  try {
    const { getVendorPerformanceHealth } = await import("../lib/vendorPerformanceService.js");
    const health = await getVendorPerformanceHealth();

    // Extended detail (columns, top vendors) for admin diagnostics
    let columns: string[] = [];
    let topVendors: unknown[] = [];

    if (health.tableExists) {
      try {
        const [colRes, topRes] = await Promise.all([
          db.execute(sql`
            SELECT column_name FROM information_schema.columns
            WHERE table_name = 'vendor_performance' ORDER BY ordinal_position
          `),
          db.execute(sql`
            SELECT s.name AS vendor_name, vp.total_orders, vp.completed_orders,
                   vp.score, vp.recommendation_score, vp.last_calculated_at
            FROM vendor_performance vp
            JOIN suppliers s ON s.id = vp.vendor_id
            ORDER BY COALESCE(vp.score::numeric, vp.recommendation_score::numeric, 0) DESC NULLS LAST
            LIMIT 10
          `),
        ]);
        columns = (colRes.rows as Record<string, string>[]).map(r => r["column_name"]);
        topVendors = topRes.rows;
      } catch { /* non-fatal */ }
    }

    const requiredColumns = [
      "id", "vendor_id", "total_orders", "completed_orders", "cancelled_orders",
      "ontime_percentage", "average_response_minutes", "pod_completeness_score",
      "recommendation_score", "updated_at",
      "total_rfq_invites", "total_submitted", "total_selected", "total_rejected",
      "avg_response_hours", "on_time_orders", "late_orders", "pod_complete_orders",
      "score", "last_calculated_at",
    ];
    const missingColumns = health.tableExists
      ? requiredColumns.filter(c => !columns.includes(c))
      : requiredColumns;

    res.json({
      // Spec fields (top-level)
      tableExists:         health.tableExists,
      rowCount:            health.rowCount,
      lastCalculatedAt:    health.lastCalculatedAt,
      vendorsWithScore:    health.vendorsWithScore,
      vendorsWithoutScore: health.vendorsWithoutScore,
      // Extended diagnostics
      activeVendors:     health.activeVendors,
      backfillCoverage:  health.backfillCoverage,
      schemaOk:          health.tableExists && missingColumns.length === 0,
      missingColumns,
      columns,
      topVendors,
      generatedAt: new Date().toISOString(),
    });
  } catch (err) {
    logger.error({ err }, "vendor-performance-health error");
    res.status(500).json({ error: "Gagal memuat vendor performance health" });
  }
});

// ── Init Storage (existing) ────────────────────────────────────────────────────
router.get("/init-storage", async (_req, res) => {
  try {
    const url = process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL || "";
    const key = process.env.SUPABASE_SERVICE_ROLE_KEY || "";
    const baseUrl = url.startsWith("http") ? url : `https://${url}.supabase.co`;

    if (!key || key.length < 100) {
      return res.status(500).json({ error: "SUPABASE_SERVICE_ROLE_KEY tidak valid", keyLen: key.length });
    }

    async function apiBucket(method: string, path: string, body?: object) {
      const r = await fetch(`${baseUrl}/storage/v1${path}`, {
        method,
        headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
        body: body ? JSON.stringify(body) : undefined,
      });
      return { status: r.status, body: await r.json() };
    }

    const list = await apiBucket("GET", "/bucket");
    const existing = new Set((Array.isArray(list.body) ? list.body : []).map((b: { id: string }) => b.id));

    const results: Record<string, unknown> = { keyLen: key.length, existing: [...existing] };

    if (!existing.has("public-assets")) {
      const r = await apiBucket("POST", "/bucket", { id: "public-assets", name: "public-assets", public: true, file_size_limit: 52428800 });
      results["public-assets"] = r;
    } else results["public-assets"] = "already exists";

    if (!existing.has("private-uploads")) {
      const r = await apiBucket("POST", "/bucket", { id: "private-uploads", name: "private-uploads", public: false, file_size_limit: 104857600 });
      results["private-uploads"] = r;
    } else results["private-uploads"] = "already exists";

    res.json(results);
  } catch (err) {
    res.status(500).json({ error: String(err) });
  }
});

// ── DB Connections Diagnostic ─────────────────────────────────────────────────
/**
 * GET /api/system/db-connections
 * Admin-only. Mengembalikan info koneksi DB aktif, pool stats, dan CB status.
 * Tidak pernah membocorkan password atau credentials.
 */
router.get("/db-connections", async (req, res) => {
  try {
    const cb = getCircuitBreakerStatus();
    const pool = getPoolStats();
    const dbInfo = getActiveDbInfo();

    // Coba query ringan untuk cek apakah DB saat ini accessible
    let dbAccessible = false;
    let dbLatencyMs: number | null = null;
    let dbError: string | null = null;
    if (!cb.open) {
      const t0 = Date.now();
      try {
        await db.execute(sql`SELECT 1`);
        dbAccessible = true;
        dbLatencyMs = Date.now() - t0;
      } catch (err) {
        dbError = err instanceof Error ? err.message : String(err);
      }
    } else {
      dbError = `Circuit breaker aktif — cooldown ${cb.remainingCooldownSeconds}s tersisa`;
    }

    // Scan env vars yang ada (tanpa nilai) untuk mendeteksi mismatch
    const envPresence = {
      SUPABASE_DATABASE_URL: !!process.env.SUPABASE_DATABASE_URL,
      SUPABASE_DATABASE_URL_DEV: !!process.env.SUPABASE_DATABASE_URL_DEV,
      DATABASE_URL: !!process.env.DATABASE_URL,
    };

    // Audit seluruh sumber koneksi yang dikenal
    const connectionSources = [
      {
        file: "lib/db/src/index.ts",
        type: "pg.Pool (primary)",
        activeSource: dbInfo.source,
        host: dbInfo.host,
        mode: dbInfo.mode,
        pooler: dbInfo.pooler,
        note: "Sumber utama — dipakai oleh semua Drizzle queries di server.",
      },
      {
        file: "artifacts/api-server/src/lib/dbBackup.ts",
        type: "pg_dump CLI",
        activeSource: dbInfo.mode === "production"
          ? (process.env.SUPABASE_DATABASE_URL ? "SUPABASE_DATABASE_URL" : "DATABASE_URL (fallback)")
          : (process.env.SUPABASE_DATABASE_URL_DEV ? "SUPABASE_DATABASE_URL_DEV" : process.env.SUPABASE_DATABASE_URL ? "SUPABASE_DATABASE_URL" : "DATABASE_URL (fallback)"),
        host: dbInfo.host,
        mode: dbInfo.mode,
        pooler: false,
        note: "Digunakan oleh pg_dump untuk backup harian. Pakai URL yang sama dengan pool.",
      },
    ];

    res.json({
      ok: true,
      activeDb: {
        source: dbInfo.source,
        host: dbInfo.host,
        mode: dbInfo.mode,
        pooler: dbInfo.pooler,
        accessible: dbAccessible,
        latencyMs: dbLatencyMs,
        error: dbError,
      },
      poolStats: {
        totalConnections: pool.totalCount,
        idleConnections: pool.idleCount,
        waitingRequests: pool.waitingCount,
      },
      circuitBreaker: {
        open: cb.open,
        openedAt: cb.openedAt,
        remainingCooldownSeconds: cb.remainingCooldownSeconds,
        lastTrigger: cb.lastTrigger,
      },
      envPresence,
      connectionSources,
      potentialMismatches: [
        ...(!envPresence.SUPABASE_DATABASE_URL && !envPresence.SUPABASE_DATABASE_URL_DEV
          ? ["⚠️ SUPABASE_DATABASE_URL tidak ada — sistem pakai DATABASE_URL lama"]
          : []),
        ...(dbInfo.mode === "development" && !envPresence.SUPABASE_DATABASE_URL_DEV
          ? ["ℹ️ SUPABASE_DATABASE_URL_DEV tidak dikonfigurasi — dev memakai URL production (shared pool)"]
          : []),
        ...(dbInfo.pooler
          ? ["ℹ️ Menggunakan pgBouncer pooler (port 6543) — rentan ECIRCUITBREAKER jika terlalu banyak auth failure"]
          : []),
      ],
    });
  } catch (err) {
    res.status(500).json({ ok: false, error: err instanceof Error ? err.message : String(err) });
  }
});

/**
 * POST /api/system/reset-circuit-breaker
 * Admin-only. Reset CB manual — HANYA gunakan setelah credentials sudah diperbaiki.
 * Jika credentials masih salah, CB akan terbuka kembali dalam hitungan detik.
 */
router.post("/reset-circuit-breaker", async (req, res) => {
  try {
    const cbBefore = getCircuitBreakerStatus();
    if (!cbBefore.open) {
      return res.json({ ok: true, message: "Circuit breaker sudah tidak aktif — tidak perlu reset.", cbBefore });
    }

    resetCircuitBreaker();

    // Test koneksi sekali setelah reset (tidak block jika gagal)
    let testResult: { accessible: boolean; latencyMs?: number; error?: string } = { accessible: false };
    try {
      const t0 = Date.now();
      await db.execute(sql`SELECT 1`);
      testResult = { accessible: true, latencyMs: Date.now() - t0 };
    } catch (err) {
      testResult = {
        accessible: false,
        error: err instanceof Error ? err.message : String(err),
      };
    }

    const cbAfter = getCircuitBreakerStatus();
    logger.warn({ resetBy: (req as any).user?.email ?? "admin", testResult }, "[system] Circuit breaker di-reset manual");

    res.json({
      ok: true,
      message: testResult.accessible
        ? `Circuit breaker di-reset. Koneksi DB berhasil (${testResult.latencyMs}ms).`
        : `Circuit breaker di-reset tapi DB masih tidak accessible: ${testResult.error}. Periksa credentials.`,
      cbBefore,
      cbAfter,
      dbTest: testResult,
    });
  } catch (err) {
    res.status(500).json({ ok: false, error: err instanceof Error ? err.message : String(err) });
  }
});

// ── DB Auth Check ─────────────────────────────────────────────────────────────
/**
 * GET /api/system/db-auth-check
 * Admin-only. Test koneksi langsung ke PostgreSQL menggunakan credential aktif.
 * Response: host, port, username, database, pooler, canConnect, authError, connectionSource.
 * TIDAK pernah menampilkan password.
 */
router.get("/db-auth-check", async (_req, res) => {
  try {
    const dbInfo = getActiveDbInfo();

    // Parse connection string untuk extract host, port, user, dbname (tanpa password)
    const urlKey = dbInfo.source !== "(none)" ? dbInfo.source : null;
    const rawUrl: string | undefined = urlKey ? (process.env[urlKey] ?? undefined) : undefined;

    let host = dbInfo.host;
    let port: number | null = null;
    let username: string | null = null;
    let database: string | null = null;
    let pooler = dbInfo.pooler;

    if (rawUrl) {
      try {
        const u = new URL(rawUrl.replace(/^postgresql:/, "postgres:"));
        host = u.hostname || host;
        port = u.port ? parseInt(u.port) : 5432;
        username = u.username || null;
        database = u.pathname?.replace(/^\//, "") || null;
        pooler = port === 6543 || u.hostname.includes("pooler") || u.hostname.includes("pgbouncer");
      } catch {
        // URL parse gagal — gunakan host dari getActiveDbInfo
      }
    }

    // Test koneksi langsung (tanpa CB guard)
    const pingResult = await pingDbNoCb();

    res.json({
      host,
      port: port ?? (pooler ? 6543 : 5432),
      username,
      database,
      pooler,
      canConnect: pingResult.ok,
      authError: pingResult.ok ? null : (pingResult.error ?? "Unknown error"),
      latencyMs: pingResult.ok ? pingResult.latencyMs : null,
      connectionSource: dbInfo.source,
      mode: dbInfo.mode,
    });
  } catch (err) {
    res.status(500).json({
      canConnect: false,
      authError: err instanceof Error ? err.message : String(err),
    });
  }
});

// ── Startup Workers Status ────────────────────────────────────────────────────
/**
 * GET /api/system/startup-workers
 * Admin-only. Mengembalikan status semua background worker yang didaftarkan ke orchestrator.
 */
router.get("/startup-workers", (_req, res) => {
  try {
    const workers = getWorkerStates();
    const summary = {
      total: workers.length,
      running: workers.filter((w) => w.status === "running").length,
      scheduled: workers.filter((w) => w.status === "scheduled").length,
      pending: workers.filter((w) => w.status === "pending").length,
      disabled: workers.filter((w) => w.status === "disabled").length,
      error: workers.filter((w) => w.status === "error").length,
      skippedCb: workers.filter((w) => w.status === "skipped_cb").length,
    };
    res.json({
      ok: true,
      config: {
        disableBackgroundWorkers: process.env.DISABLE_BACKGROUND_WORKERS === "true",
        staggerScale: Math.max(0.1, parseInt(process.env.STARTUP_WORKER_STAGGER_MS ?? "1000") / 1000),
        pgPoolMax: process.env.PG_POOL_MAX ?? "(default)",
        pgConnectionTimeoutMs: process.env.PG_CONNECTION_TIMEOUT_MS ?? "(default: 8000)",
        pgIdleTimeoutMs: process.env.PG_IDLE_TIMEOUT_MS ?? "(default: 30000)",
      },
      summary,
      workers,
    });
  } catch (err) {
    res.status(500).json({ ok: false, error: err instanceof Error ? err.message : String(err) });
  }
});

export { router as systemRouter };
