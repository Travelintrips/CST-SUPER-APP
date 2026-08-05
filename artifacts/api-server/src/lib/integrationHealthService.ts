/**
 * integrationHealthService.ts
 *
 * Shared logic for testing connectivity to all external integrations.
 * Used by:
 *   - GET /api/dev-test/smoke        (manual trigger, dev-only)
 *   - integrationHealthWorker        (scheduled, every 6 hours)
 *   - GET /api/logs/integration-health (admin dashboard read)
 */

import * as crypto from "crypto";
import { db } from "@workspace/db";
import { sql } from "drizzle-orm";
import { logger } from "./logger.js";

// ── Types ──────────────────────────────────────────────────────────────────────

export interface SmokeResult {
  status: "pass" | "fail" | "unconfigured" | "error";
  latencyMs: number | null;
  detail?: string;
}

export interface HealthSnapshot {
  id: number;
  checkedAt: string;
  results: Record<string, SmokeResult>;
  allPassed: boolean;
  alertSent: boolean;
}

// ── DB setup ───────────────────────────────────────────────────────────────────

export async function ensureIntegrationHealthTable(): Promise<void> {
  await db.execute(sql`
    CREATE TABLE IF NOT EXISTS integration_health_snapshots (
      id          SERIAL PRIMARY KEY,
      checked_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      results     JSONB NOT NULL,
      all_passed  BOOLEAN NOT NULL DEFAULT FALSE,
      alert_sent  BOOLEAN NOT NULL DEFAULT FALSE
    )
  `).catch((err: unknown) =>
    logger.warn({ err }, "[integrationHealth] ensureTable non-fatal error")
  );

  // Keep only last 100 rows (pruned on each write to avoid unbounded growth)
}

async function pruneOldSnapshots(): Promise<void> {
  await db.execute(sql`
    DELETE FROM integration_health_snapshots
    WHERE id NOT IN (
      SELECT id FROM integration_health_snapshots ORDER BY checked_at DESC LIMIT 100
    )
  `).catch(() => {});
}

// ── Load last snapshot ─────────────────────────────────────────────────────────

export async function getLastHealthSnapshot(): Promise<HealthSnapshot | null> {
  try {
    const rows = await db.execute(sql`
      SELECT id, checked_at, results, all_passed, alert_sent
      FROM integration_health_snapshots
      ORDER BY checked_at DESC
      LIMIT 1
    `);
    const row = rows.rows[0] as Record<string, unknown> | undefined;
    if (!row) return null;
    const rawResults = row.results;
    const results: Record<string, SmokeResult> =
      typeof rawResults === "string"
        ? JSON.parse(rawResults)
        : (rawResults as Record<string, SmokeResult>);
    return {
      id: Number(row.id),
      checkedAt: String(row.checked_at),
      results,
      allPassed: Boolean(row.all_passed),
      alertSent: Boolean(row.alert_sent),
    };
  } catch {
    return null;
  }
}

export async function getRecentHealthSnapshots(limit = 10): Promise<HealthSnapshot[]> {
  try {
    const rows = await db.execute(sql`
      SELECT id, checked_at, results, all_passed, alert_sent
      FROM integration_health_snapshots
      ORDER BY checked_at DESC
      LIMIT ${limit}
    `);
    return (rows.rows as Record<string, unknown>[]).map((row) => {
      const rawResults = row.results;
      const results: Record<string, SmokeResult> =
        typeof rawResults === "string"
          ? JSON.parse(rawResults)
          : (rawResults as Record<string, SmokeResult>);
      return {
        id: Number(row.id),
        checkedAt: String(row.checked_at),
        results,
        allPassed: Boolean(row.all_passed),
        alertSent: Boolean(row.alert_sent),
      };
    });
  } catch {
    return [];
  }
}

// ── Save snapshot ──────────────────────────────────────────────────────────────

export async function saveHealthSnapshot(
  results: Record<string, SmokeResult>,
  allPassed: boolean,
  alertSent: boolean,
): Promise<void> {
  await db.execute(sql`
    INSERT INTO integration_health_snapshots (results, all_passed, alert_sent)
    VALUES (${JSON.stringify(results)}::jsonb, ${allPassed}, ${alertSent})
  `);
  await pruneOldSnapshots();
}

// ── Core smoke test ────────────────────────────────────────────────────────────

/**
 * Run all integration health checks.
 * Does NOT send any real messages or create real transactions.
 */
export async function runIntegrationHealthCheck(): Promise<{
  results: Record<string, SmokeResult>;
  allPassed: boolean;
  testedAt: string;
}> {
  const results: Record<string, SmokeResult> = {};

  // ── Fonnte ───────────────────────────────────────────────────────────────────
  await (async () => {
    const token = process.env.FONNTE_TOKEN?.trim();
    if (!token) {
      results.fonnte = { status: "unconfigured", latencyMs: null, detail: "FONNTE_TOKEN tidak dikonfigurasi" };
      return;
    }
    const t0 = Date.now();
    try {
      const resp = await fetch("https://api.fonnte.com/device", {
        method: "POST",
        headers: { Authorization: token },
        signal: AbortSignal.timeout(8_000),
      });
      const latencyMs = Date.now() - t0;
      const body = (await resp.json().catch(() => ({}))) as Record<string, unknown>;
      if (!resp.ok) {
        results.fonnte = { status: "fail", latencyMs, detail: `HTTP ${resp.status}: ${JSON.stringify(body)}` };
        return;
      }
      if (body.status === false || body.status === "false") {
        results.fonnte = {
          status: "fail",
          latencyMs,
          detail: `status:false — ${String(body.reason ?? body.message ?? "unknown")}`,
        };
        return;
      }
      const deviceInfo = Array.isArray(body.target)
        ? `${body.target.length} device(s) registered`
        : "device check OK";
      results.fonnte = { status: "pass", latencyMs, detail: deviceInfo };
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      results.fonnte = { status: "error", latencyMs: Date.now() - t0, detail: msg };
    }
  })();

  // ── Paylabs ───────────────────────────────────────────────────────────────────
  await (async () => {
    const rawKey = process.env.PAYLABS_PRIVATE_KEY?.trim() ?? "";
    const merchantId = process.env.PAYLABS_MERCHANT_ID?.trim() ?? "";

    if (!rawKey) {
      results.paylabs = { status: "unconfigured", latencyMs: null, detail: "PAYLABS_PRIVATE_KEY tidak dikonfigurasi" };
      return;
    }

    // Always re-format: strip whitespace from body and re-chunk into 64-char lines.
    // Skipping normalization when "\n" is present was the bug — a key stored in
    // GCP Secret Manager with real newlines may still have an unchunked body that
    // OpenSSL rejects. Use the same robust approach as _normalizePemKey2.
    const isRsa = rawKey.includes("RSA PRIVATE KEY");
    const pemHeader = isRsa ? "RSA PRIVATE KEY" : "PRIVATE KEY";
    const pemBody = rawKey
      .replace(/-----BEGIN [^-]+-----/g, "")
      .replace(/-----END [^-]+-----/g, "")
      .replace(/\s+/g, "");
    const privateKey = pemBody
      ? `-----BEGIN ${pemHeader}-----\n${(pemBody.match(/.{1,64}/g) ?? []).join("\n")}\n-----END ${pemHeader}-----`
      : rawKey; // fallback: use as-is if stripping produced nothing (unexpected format)

    const t0 = Date.now();
    try {
      const testPayload = `smoke-test-${Date.now()}`;
      const sign = crypto.createSign("RSA-SHA256");
      sign.update(testPayload);
      const signature = sign.sign(privateKey, "base64");
      if (!signature) throw new Error("sign() returned empty result");
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      results.paylabs = {
        status: "fail",
        latencyMs: Date.now() - t0,
        detail: `RSA signing gagal — key mungkin tidak valid: ${msg}`,
      };
      return;
    }

    if (!merchantId) {
      results.paylabs = {
        status: "pass",
        latencyMs: Date.now() - t0,
        detail: "RSA key valid (PAYLABS_MERCHANT_ID tidak diset — skip API call ke SIT)",
      };
      return;
    }

    try {
      const sitUrl = process.env.PAYLABS_API_URL ?? "https://sit-pay.paylabs.co.id/payment/v2.1/h5/createLink";
      const timestamp = new Date().toISOString().replace(/[-:T]/g, "").slice(0, 14);
      const outTradeNo = `SMOKE${Date.now()}`;
      const bodyObj = {
        merchantId,
        requestId: outTradeNo,
        outTradeNo,
        payType: "QRIS",
        paymentAmount: 100,
        notifyUrl: "https://example.com/noop",
        subject: "smoke-test",
      };
      const bodyJson = JSON.stringify(bodyObj);
      const endpoint = new URL(sitUrl).pathname;
      const bodyHash = crypto.createHash("sha256").update(bodyJson).digest("hex").toLowerCase();
      const sigPayload = `POST:${endpoint}:${bodyHash}:${timestamp}`;
      const signObj = crypto.createSign("RSA-SHA256");
      signObj.update(sigPayload);
      const privateKey2 = privateKey; // use already-normalised key (spaces→newlines)
      const signature2 = signObj.sign(privateKey2, "base64");

      const resp = await fetch(sitUrl, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-TIMESTAMP": timestamp,
          "X-SIGNATURE": signature2,
          "X-PARTNER-ID": merchantId,
        },
        body: bodyJson,
        signal: AbortSignal.timeout(10_000),
      });
      const latencyMs = Date.now() - t0;
      const respBody = (await resp.json().catch(() => ({}))) as Record<string, unknown>;
      const errCode = String(respBody.errCode ?? respBody.resultCode ?? "");
      const errMsg = String(respBody.errMessage ?? respBody.msg ?? "");
      if (resp.status === 401 || errCode === "AUTH_001" || errCode === "SIGN_ERROR") {
        results.paylabs = { status: "fail", latencyMs, detail: `Autentikasi gagal (${errCode}): ${errMsg}` };
        return;
      }
      results.paylabs = {
        status: "pass",
        latencyMs,
        detail: `Gateway SIT merespons (HTTP ${resp.status}, errCode=${errCode || "none"})`,
      };
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      results.paylabs = {
        status: "error",
        latencyMs: Date.now() - t0,
        detail: `API call ke SIT gagal: ${msg}`,
      };
    }
  })();

  // ── Google Sheets ─────────────────────────────────────────────────────────────
  await (async () => {
    const saJson = process.env.GOOGLE_SERVICE_ACCOUNT_JSON?.trim() ?? "";
    if (!saJson) {
      results.googleSheets = { status: "unconfigured", latencyMs: null, detail: "GOOGLE_SERVICE_ACCOUNT_JSON tidak dikonfigurasi" };
      return;
    }

    let saEmail = "unknown";
    try {
      const parsed = JSON.parse(saJson);
      if (!parsed.client_email || !parsed.private_key) {
        results.googleSheets = { status: "fail", latencyMs: null, detail: "Service Account JSON tidak memiliki client_email/private_key" };
        return;
      }
      saEmail = parsed.client_email;
    } catch {
      results.googleSheets = { status: "fail", latencyMs: null, detail: "GOOGLE_SERVICE_ACCOUNT_JSON bukan JSON valid" };
      return;
    }

    let sheetId = process.env.GOOGLE_SHEET_ID_BANK_MUTATIONS?.trim() ?? "";
    if (!sheetId) {
      try {
        const { rows } = await db.execute(sql.raw(`SELECT sheet_id FROM bank_sheet_configs WHERE is_active = TRUE LIMIT 1`));
        sheetId = String((rows as Record<string, unknown>[])[0]?.sheet_id ?? "");
      } catch {
        // table may not exist yet
      }
    }

    if (!sheetId) {
      results.googleSheets = {
        status: "unconfigured",
        latencyMs: null,
        detail: `SA JSON valid (${saEmail}) — tidak ada sheet ID yang dikonfigurasi`,
      };
      return;
    }

    const t0 = Date.now();
    try {
      const { checkSpreadsheetHealth } = await import("./googleSheets.js");
      const health = await checkSpreadsheetHealth(sheetId, 8_000);
      const latencyMs = Date.now() - t0;
      if (health.status === "ok") {
        results.googleSheets = {
          status: "pass",
          latencyMs,
          detail: `"${health.title}" — tab: ${health.sheets.join(", ")}`,
        };
      } else if (health.status === "not_found") {
        results.googleSheets = { status: "fail", latencyMs, detail: `Spreadsheet ID tidak ditemukan: ${sheetId}` };
      } else {
        results.googleSheets = { status: "fail", latencyMs, detail: health.reason };
      }
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      results.googleSheets = { status: "error", latencyMs: Date.now() - t0, detail: msg };
    }
  })();

  // ── OpenAI ────────────────────────────────────────────────────────────────────
  await (async () => {
    const hasKey = !!(
      process.env.OPENAI_API_KEY?.trim() ||
      (process.env.AI_INTEGRATIONS_OPENAI_API_KEY?.trim() && process.env.AI_INTEGRATIONS_OPENAI_BASE_URL?.trim())
    );
    if (!hasKey) {
      results.openai = { status: "unconfigured", latencyMs: null, detail: "OPENAI_API_KEY tidak dikonfigurasi" };
      return;
    }
    const t0 = Date.now();
    try {
      const { getOpenAI } = await import("./openaiClient.js");
      const openai = getOpenAI();
      const completion = await openai.chat.completions.create({
        model: "gpt-4o-mini",
        messages: [{ role: "user", content: "Reply with just the word: ok" }],
        max_tokens: 5,
      });
      const latencyMs = Date.now() - t0;
      const reply = completion.choices[0]?.message?.content?.trim() ?? "";
      results.openai = {
        status: "pass",
        latencyMs,
        detail: `model=${completion.model}, reply="${reply}", usage=${JSON.stringify(completion.usage)}`,
      };
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      const isAuth = msg.includes("401") || msg.includes("Incorrect API key") || msg.includes("invalid_api_key");
      results.openai = {
        status: isAuth ? "fail" : "error",
        latencyMs: Date.now() - t0,
        detail: msg,
      };
    }
  })();

  const allPassed = Object.values(results).every(
    (r) => r.status === "pass" || r.status === "unconfigured",
  );

  return { results, allPassed, testedAt: new Date().toISOString() };
}

// ── Diff helper ───────────────────────────────────────────────────────────────

/**
 * Returns integrations that flipped from a "healthy" state (pass/unconfigured)
 * to an unhealthy state (fail/error) compared to the previous snapshot.
 */
export function detectStatusFlips(
  previous: Record<string, SmokeResult> | null,
  current: Record<string, SmokeResult>,
): Array<{ name: string; from: string; to: string; detail?: string }> {
  if (!previous) return []; // No previous baseline — no alert on first run

  const flips: Array<{ name: string; from: string; to: string; detail?: string }> = [];
  for (const [name, cur] of Object.entries(current)) {
    const prev = previous[name];
    const prevHealthy = !prev || prev.status === "pass" || prev.status === "unconfigured";
    const curUnhealthy = cur.status === "fail" || cur.status === "error";
    if (prevHealthy && curUnhealthy) {
      flips.push({ name, from: prev?.status ?? "unknown", to: cur.status, detail: cur.detail });
    }
  }
  return flips;
}
