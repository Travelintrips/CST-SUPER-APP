/**
 * devTestRoutes — endpoint khusus untuk verifikasi pre-UAT blocker fixes.
 *
 * ⚠️  FAIL-CLOSED: hanya aktif jika SEMUA kondisi berikut terpenuhi:
 *     1. APP_ENV === "development"   (harus eksplisit — tidak cukup "tidak di-set")
 *     2. ENABLE_DEV_ROUTES !== "false"
 *
 *     Jika APP_ENV tidak di-set, kosong, atau bukan "development" → 404.
 *     Jika ENABLE_DEV_ROUTES === "false" → 404.
 *     NODE_ENV saja TIDAK cukup sebagai penjaga.
 *
 * Prefix: /api/dev-test
 *
 * Routes:
 *   GET  /smoke                     — smoke test semua integrasi (Fonnte, Paylabs, Google Sheets, OpenAI)
 *   POST /send-wa                   — kirim WA sungguhan via Fonnte ke nomor test (bypass E2E/SafeDev mode)
 *   POST /test-period-lock          — verifikasi BLOCKER 1 (requireOpenPeriod)
 *   POST /simulate-tax-capture-fail — verifikasi BLOCKER 4 (tax_capture_queue)
 *   POST /simulate-audit-fail       — verifikasi BLOCKER 5 (tax_audit_log_failures)
 *   GET  /queue-status              — cek isi kedua tabel fallback sekaligus
 *   POST /cleanup-test-data         — bersihkan test entries dari kedua tabel
 */

import { Router, type Request, type Response, type NextFunction } from "express";
import { db } from "@workspace/db";
import { sql } from "drizzle-orm";
import { logger } from "../lib/logger.js";
import { requireAdmin } from "../lib/requireAdmin.js";
import { requireOpenPeriod } from "../lib/financeGovernanceGuard.js";
import { runIntegrationHealthCheck, type SmokeResult } from "../lib/integrationHealthService.js";
import { logNotification } from "../lib/notificationLog.js";
import { getFonnteToken } from "../lib/appSecrets.js";

// ── Rate limiter for smoke test (1 call per 30s per IP, max burst 2) ──────────
const smokeCalls = new Map<string, number[]>();
function smokeRateLimiter(req: Request, res: Response, next: NextFunction): void {
  const ip = req.ip ?? "unknown";
  const now = Date.now();
  const window = 30_000; // 30 s
  const limit = 2;
  const timestamps = (smokeCalls.get(ip) ?? []).filter((t) => now - t < window);
  if (timestamps.length >= limit) {
    res.status(429).json({ error: "Too many smoke test calls — wait 30 s before retrying" });
    return;
  }
  timestamps.push(now);
  smokeCalls.set(ip, timestamps);
  next();
}

const router = Router();

// ── Fail-closed dev-environment guard ────────────────────────────────────────
// ALLOWLIST approach: active ONLY when APP_ENV is explicitly "development"
// AND ENABLE_DEV_ROUTES is not explicitly set to "false".
// An unset, empty, or non-"development" APP_ENV always blocks (returns 404).
export function isDevRoutesEnabled(): boolean {
  const appEnv = process.env["APP_ENV"];
  const enableDevRoutes = process.env["ENABLE_DEV_ROUTES"];
  // Both conditions must hold: explicit dev environment AND not explicitly disabled
  return appEnv === "development" && enableDevRoutes !== "false";
}

router.use((_req, res, next) => {
  if (!isDevRoutesEnabled()) {
    return res.status(404).json({ message: "Not found" });
  }
  next();
});

// ── Auth guard (applies to ALL routes below, including smoke) ─────────────────
router.use(async (req, res, next) => {
  if (!(await requireAdmin(req, res))) return;
  next();
});

// ── 0. Smoke Test — verifikasi semua integrasi ────────────────────────────────
/**
 * GET /api/dev-test/smoke
 *
 * Menguji konektivitas semua integrasi eksternal:
 *   - Fonnte WhatsApp  → POST https://api.fonnte.com/device (device status, no message sent)
 *   - Paylabs          → RSA sign test + POST ke SIT endpoint (minimal test payload)
 *   - Google Sheets    → getSpreadsheetMeta pada sheet pertama yang dikonfigurasi
 *   - OpenAI           → chat.completions.create model=gpt-4o-mini, 1 token
 *
 * Tidak mengirim pesan WA sungguhan, tidak membuat transaksi nyata.
 * Response: { results: Record<string, SmokeResult>, allPassed: boolean }
 */
router.get("/smoke", smokeRateLimiter, async (_req, res) => {
  const { results, allPassed, testedAt } = await runIntegrationHealthCheck();

  const verdicts = Object.fromEntries(
    Object.entries(results).map(([k, v]) => [
      k,
      `${v.status === "pass" ? "✅" : v.status === "unconfigured" ? "⚠️" : "❌"} ${v.status.toUpperCase()}` +
        (v.detail ? ` — ${v.detail}` : "") +
        (v.latencyMs != null ? ` (${v.latencyMs}ms)` : ""),
    ]),
  );

  logger.info({ results: verdicts }, "[devTest/smoke] smoke test results");

  return res.json({
    allPassed,
    summary: allPassed
      ? "✅ Semua integrasi yang dikonfigurasi berfungsi normal"
      : "❌ Satu atau lebih integrasi gagal — lihat results untuk detail",
    results,
    verdicts,
    testedAt,
  });
});

// ── 1. Send Real WhatsApp (E2E Fonnte test) ───────────────────────────────────
/**
 * POST /api/dev-test/send-wa
 * Body: { target?: string, message?: string }
 *
 * Mengirim pesan WhatsApp SUNGGUHAN via Fonnte untuk memverifikasi pipeline end-to-end.
 * Mengabaikan SAFE_DEV_TEST_MODE / E2E_TEST_MODE agar pesan benar-benar terkirim.
 * Menggunakan refId berbasis timestamp sehingga deduplication tidak memblokir pengiriman
 * berulang dalam satu sesi test.
 *
 * Fallback nomor tujuan: env WA_TEST_NUMBER (jika body.target tidak diberikan).
 * Response: { ok, verdict, target, waMessageId, logId, fonnteResponse }
 */
router.post("/send-wa", async (req: Request, res: Response) => {
  const FONNTE_TOKEN = await getFonnteToken();
  if (!FONNTE_TOKEN) {
    return res.status(503).json({
      ok: false,
      verdict: "❌ FONNTE_TOKEN tidak dikonfigurasi — atur secret FONNTE_TOKEN terlebih dahulu",
    });
  }

  const rawTarget: string | undefined = req.body?.target ?? process.env.WA_TEST_NUMBER;
  if (!rawTarget?.trim()) {
    return res.status(400).json({
      ok: false,
      verdict: "❌ Nomor tujuan tidak ada — kirim { target: '08xxxxxxxxxx' } di body atau set env WA_TEST_NUMBER",
    });
  }

  // Normalize phone number (same logic as sendWhatsApp)
  let phone = rawTarget.trim().replace(/[^\d+]/g, "").replace(/^\+/, "");
  if (phone.startsWith("0")) phone = "62" + phone.slice(1);
  else if (!phone.startsWith("62")) phone = "62" + phone;

  if (phone.length < 10) {
    return res.status(400).json({
      ok: false,
      verdict: `❌ Nomor terlalu pendek setelah normalisasi: "${phone}"`,
    });
  }

  // Unique refId per call so dedup window never blocks repeated test sends
  const testRefId = `dev-test-wa-${Date.now()}`;
  const message: string = req.body?.message?.trim()
    || `[DEV TEST] Fonnte E2E verification — ${new Date().toISOString()} (refId: ${testRefId})`;

  let fonnteResponse: Record<string, unknown> = {};
  let ok = false;
  let waMessageId: string | undefined;
  let verdict = "";
  let loggedStatus: "sent" | "failed" = "failed";
  let errorMsg: string | undefined;

  try {
    const startMs = Date.now();
    const apiRes = await fetch("https://api.fonnte.com/send", {
      method: "POST",
      headers: {
        Authorization: FONNTE_TOKEN,
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body: new URLSearchParams({ target: phone, message }).toString(),
    });
    const latencyMs = Date.now() - startMs;

    fonnteResponse = (await apiRes.json()) as Record<string, unknown>;
    fonnteResponse["_httpStatus"] = apiRes.status;
    fonnteResponse["_latencyMs"] = latencyMs;

    if (!apiRes.ok) {
      errorMsg = `HTTP ${apiRes.status}`;
      verdict = `❌ FAIL — Fonnte HTTP ${apiRes.status}`;
    } else if (fonnteResponse["status"] === false || fonnteResponse["status"] === "false") {
      errorMsg = String(fonnteResponse["reason"] ?? fonnteResponse["message"] ?? "Fonnte status:false");
      verdict = `❌ FAIL — Fonnte status:false — ${errorMsg}`;
    } else {
      // Extract wa_message_id
      const rawId = fonnteResponse["id"] ?? fonnteResponse["message_id"] ?? fonnteResponse["messageId"];
      if (rawId != null) {
        waMessageId = Array.isArray(rawId) ? String(rawId[0]) : String(rawId);
      }
      ok = true;
      loggedStatus = "sent";
      verdict = `✅ PASS — pesan terkirim via Fonnte${waMessageId ? ` (wa_message_id: ${waMessageId})` : ""}`;
    }
  } catch (err: unknown) {
    errorMsg = String(err);
    verdict = `❌ ERROR — ${errorMsg}`;
  }

  // Always log to notification_logs (no dedup applied — unique refId per call)
  await logNotification({
    channel: "wa",
    recipient: phone,
    message,
    status: loggedStatus,
    errorMsg,
    context: "dev-test",
    refType: "dev-test",
    refId: testRefId,
    waMessageId,
  });

  logger.info({ ok, phone, waMessageId, verdict }, "[devTest/send-wa] E2E WA test result");

  return res.status(ok ? 200 : 502).json({
    ok,
    verdict,
    target: phone,
    rawTarget,
    waMessageId: waMessageId ?? null,
    testRefId,
    fonnteResponse,
    instructions: ok
      ? "Periksa HP tujuan untuk konfirmasi pesan diterima, dan cek tabel notification_logs untuk status='sent'."
      : "Periksa FONNTE_TOKEN dan pastikan device Fonnte online.",
  });
});

// ── 2. Period Lock Test ───────────────────────────────────────────────────────
/**
 * POST /api/dev-test/test-period-lock
 *
 * Menguji BLOCKER 1: requireOpenPeriod harus return 422 untuk:
 *   - date kosong (tidak ada body.date)
 *   - date invalid (bukan ISO 8601)
 *   - companyId tidak ada (komplikasi: harus bypass session)
 *   - periode sudah dikunci (jika ada di DB)
 *
 * Middleware requireOpenPeriod dipasang langsung pada route ini.
 * Jika middleware meloloskan request, handler menjawab 200 OK.
 */
router.post("/test-period-lock", requireOpenPeriod, (req: Request, res) => {
  res.json({
    ok: true,
    message: "requireOpenPeriod meloloskan request — tanggal valid dan periode terbuka",
    date: req.body?.date ?? req.query["date"],
  });
});

// ── 3. Simulate Tax Capture Failure (BLOCKER 4) ───────────────────────────────
/**
 * POST /api/dev-test/simulate-tax-capture-fail
 * Body: { companyId?: number }
 *
 * Menggunakan flag internal taxAutoService untuk memaksa catch block dieksekusi,
 * lalu memverifikasi bahwa entry muncul di tax_capture_queue.
 */
router.post("/simulate-tax-capture-fail", async (req: Request, res) => {
  const companyId = Number(req.body?.companyId ?? 1);

  let queueBefore = 0;
  let queueAfter  = 0;
  let errorMsg    = "";

  try {
    // Hitung entries sebelum test
    const before = await db.execute(sql`
      SELECT COUNT(*) AS cnt FROM tax_capture_queue
      WHERE company_id = ${companyId} AND error_message LIKE 'DEV TEST%'
    `);
    queueBefore = Number((before.rows[0] as any)?.cnt ?? 0);

    // Aktifkan force-fail flag lalu panggil recordTransactionTax
    const taxAutoService = await import("../lib/taxAutoService.js");
    if (typeof (taxAutoService as any)._setForceFailForTesting === "function") {
      (taxAutoService as any)._setForceFailForTesting(true);
    }

    try {
      await taxAutoService.recordTransactionTax({
        companyId,
        transactionType: "expense",
        transactionId:   -9999, // ID tidak nyata
        direction:       "output" as any,
        taxName:         "PPN 11%",
        taxRate:         11,
        baseAmount:      1_000_000,
        taxAmount:       110_000,
      } as any);
    } catch {
      // Expected jika force fail
    } finally {
      if (typeof (taxAutoService as any)._setForceFailForTesting === "function") {
        (taxAutoService as any)._setForceFailForTesting(false);
      }
    }

    // Tunggu sebentar agar async enqueue selesai
    await new Promise((r) => setTimeout(r, 300));

    // Hitung entries sesudah
    const after = await db.execute(sql`
      SELECT COUNT(*) AS cnt FROM tax_capture_queue
      WHERE company_id = ${companyId}
    `);
    queueAfter = Number((after.rows[0] as any)?.cnt ?? 0);
  } catch (e: any) {
    errorMsg = e?.message ?? String(e);
    logger.error({ err: e }, "[devTest] simulate-tax-capture-fail error");
  }

  // Ambil 5 entries terbaru
  const recent = await db.execute(sql`
    SELECT id, transaction_type, transaction_id, error_message, status, created_at
    FROM tax_capture_queue
    WHERE company_id = ${companyId}
    ORDER BY id DESC LIMIT 5
  `).catch(() => ({ rows: [] }));

  const newEntries = queueAfter - queueBefore;

  return res.json({
    ok:          newEntries > 0,
    verdict:     newEntries > 0 ? "✅ PASS — entry berhasil masuk tax_capture_queue" : "❌ FAIL — tidak ada entry baru",
    queueBefore,
    queueAfter,
    newEntries,
    recentEntries: recent.rows,
    error:       errorMsg || undefined,
    note:        !errorMsg && newEntries === 0
      ? "Pastikan _setForceFailForTesting diekspor dari taxAutoService.ts"
      : undefined,
  });
});

// ── 3. Simulate Audit Log Failure (BLOCKER 5) ─────────────────────────────────
/**
 * POST /api/dev-test/simulate-audit-fail
 * Body: { companyId?: number }
 *
 * Menggunakan flag internal taxAuditService untuk memaksa catch block dieksekusi,
 * lalu memverifikasi bahwa entry muncul di tax_audit_log_failures.
 */
router.post("/simulate-audit-fail", async (req: Request, res) => {
  const companyId = Number(req.body?.companyId ?? 1);

  let fallbackBefore = 0;
  let fallbackAfter  = 0;
  let errorMsg       = "";

  try {
    const before = await db.execute(sql`
      SELECT COUNT(*) AS cnt FROM tax_audit_log_failures
      WHERE company_id = ${companyId}
    `);
    fallbackBefore = Number((before.rows[0] as any)?.cnt ?? 0);

    // Aktifkan force-fail flag
    const taxAuditService = await import("../lib/taxAuditService.js");
    if (typeof (taxAuditService as any)._setForceFailForTesting === "function") {
      (taxAuditService as any)._setForceFailForTesting(true);
    }

    try {
      await taxAuditService.logTaxActivity({
        companyId,
        entityType: "test" as any,
        entityId:   `dev-test-${Date.now()}`,
        action:     "DEV_TEST_FAIL" as any,
        after:      { test: true, timestamp: new Date().toISOString() },
        performedBy: "dev-test-script",
        ipAddress:   req.ip ?? "127.0.0.1",
      });
    } catch {
      // Expected
    } finally {
      if (typeof (taxAuditService as any)._setForceFailForTesting === "function") {
        (taxAuditService as any)._setForceFailForTesting(false);
      }
    }

    // Tunggu agar async fallback write selesai
    await new Promise((r) => setTimeout(r, 500));

    const after = await db.execute(sql`
      SELECT COUNT(*) AS cnt FROM tax_audit_log_failures
      WHERE company_id = ${companyId}
    `);
    fallbackAfter = Number((after.rows[0] as any)?.cnt ?? 0);
  } catch (e: any) {
    errorMsg = e?.message ?? String(e);
    logger.error({ err: e }, "[devTest] simulate-audit-fail error");
  }

  const recent = await db.execute(sql`
    SELECT id, entity_type, action, error_message, created_at
    FROM tax_audit_log_failures
    WHERE company_id = ${companyId}
    ORDER BY id DESC LIMIT 5
  `).catch(() => ({ rows: [] }));

  const newEntries = fallbackAfter - fallbackBefore;

  return res.json({
    ok:            newEntries > 0,
    verdict:       newEntries > 0 ? "✅ PASS — entry berhasil masuk tax_audit_log_failures" : "❌ FAIL — tidak ada entry baru",
    fallbackBefore,
    fallbackAfter,
    newEntries,
    recentEntries: recent.rows,
    error:         errorMsg || undefined,
    note:          !errorMsg && newEntries === 0
      ? "Pastikan _setForceFailForTesting diekspor dari taxAuditService.ts"
      : undefined,
  });
});

// ── 4. Queue Status — lihat isi kedua tabel sekaligus ─────────────────────────
router.get("/queue-status", async (_req, res) => {
  const [captureQueue, auditFallback] = await Promise.all([
    db.execute(sql`
      SELECT id, company_id, transaction_type, transaction_id,
             status, error_message, attempts, created_at
      FROM tax_capture_queue
      ORDER BY id DESC LIMIT 20
    `).catch(() => ({ rows: [] })),
    db.execute(sql`
      SELECT id, company_id, entity_type, action, error_message, created_at
      FROM tax_audit_log_failures
      ORDER BY id DESC LIMIT 20
    `).catch(() => ({ rows: [] })),
  ]);

  return res.json({
    taxCaptureQueue:    { count: captureQueue.rows.length,  rows: captureQueue.rows },
    taxAuditFailures:   { count: auditFallback.rows.length, rows: auditFallback.rows },
  });
});

// ── 5. Cleanup test data ───────────────────────────────────────────────────────
router.post("/cleanup-test-data", async (_req, res) => {
  const [q, f] = await Promise.all([
    db.execute(sql`
      DELETE FROM tax_capture_queue
      WHERE transaction_id = -9999 OR error_message LIKE 'DEV TEST%'
      RETURNING id
    `).catch(() => ({ rows: [] })),
    db.execute(sql`
      DELETE FROM tax_audit_log_failures
      WHERE action IN ('DEV_TEST_FAIL', 'TEST_FAIL')
      RETURNING id
    `).catch(() => ({ rows: [] })),
  ]);

  return res.json({
    deleted: {
      taxCaptureQueue:  q.rows.length,
      taxAuditFailures: f.rows.length,
    },
    message: "Test data dibersihkan.",
  });
});

export default router;
