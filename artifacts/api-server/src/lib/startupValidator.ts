/**
 * startupValidator.ts
 * Cek ketersediaan runtime dependencies saat server startup.
 * Hasil disimpan di modul-level untuk di-expose via /api/system/runtime-check.
 *
 * REQUIRED secrets — server tidak boleh start tanpa ini:
 *   SESSION_SECRET            — Express session signing (minLen 32)
 *
 * Integration secrets checked at startup (warn-only, tidak fatal):
 *   PORTAL_ADMIN_KEY          — Customer portal admin claim + internal audit bypass
 *                               (fail-closed per endpoint: 401/403/503 jika tidak ada;
 *                                vendorResponseToken fallback ke SESSION_SECRET)
 *   OPENAI_API_KEY            — AI assistant / expense classifier / chatbot
 *   PAYLABS_PRIVATE_KEY       — Paylabs payment gateway (RSA private key PEM)
 *   FONNTE_TOKEN              — WhatsApp messaging via Fonnte
 *   GOOGLE_SERVICE_ACCOUNT_JSON — Google Sheets / Drive nightly sync
 *
 * NOTE: CASHIER_TOKEN_SECRET dihapus dari REQUIRED_SECRETS — tidak ada kode
 *   bisnis yang menggunakannya. Jika di masa depan fitur cashier token dibuat,
 *   tambahkan kembali ke INTEGRATION_SECRETS.
 */

import { logger } from "./logger.js";
import { getCircuitBreakerStatus, pingDbNoCb } from "@workspace/db";

export interface DepCheckResult {
  status: "ok" | "missing" | "error";
  version?: string;
  detail?: string;
}

export interface IntegrationSecretStatus {
  key: string;
  present: boolean;
  feature: string;
}

export interface RuntimeCheckState {
  checkedAt: string;
  status: "ok" | "degraded";
  dependencies: Record<string, DepCheckResult>;
  missing: string[];
  integrationSecrets: IntegrationSecretStatus[];
  missingIntegrationSecrets: string[];
}

let _state: RuntimeCheckState | null = null;

async function checkImport(pkg: string): Promise<DepCheckResult> {
  try {
    const m = await import(pkg);
    const version: string | undefined =
      m?.version ??
      m?.default?.version ??
      (m?.VERSION as string | undefined) ??
      undefined;
    return { status: "ok", version };
  } catch (err: any) {
    if (err?.code === "MODULE_NOT_FOUND") {
      return { status: "missing", detail: `Module '${pkg}' tidak ditemukan di node_modules` };
    }
    return { status: "error", detail: String(err?.message ?? err) };
  }
}

async function checkGoogleapis(): Promise<DepCheckResult> {
  try {
    const g = await import("googleapis");
    const version: string | undefined =
      (g as any)?.version ?? (g as any)?.default?.version ?? undefined;
    if (!g?.google && !g?.default?.google && !g?.Auth) {
      return { status: "error", detail: "googleapis loaded tapi export 'google' tidak ditemukan" };
    }
    return { status: "ok", version };
  } catch (err: any) {
    if (err?.code === "MODULE_NOT_FOUND") {
      return { status: "missing", detail: "Package 'googleapis' tidak ditemukan" };
    }
    return { status: "error", detail: String(err?.message ?? err) };
  }
}

async function checkDrizzle(): Promise<DepCheckResult> {
  try {
    const m = await import("drizzle-orm");
    const hasSql = typeof m?.sql === "function";
    if (!hasSql) return { status: "error", detail: "drizzle-orm loaded tapi export 'sql' tidak tersedia" };
    return { status: "ok" };
  } catch (err: any) {
    if (err?.code === "MODULE_NOT_FOUND") {
      return { status: "missing", detail: "Package 'drizzle-orm' tidak ditemukan" };
    }
    return { status: "error", detail: String(err?.message ?? err) };
  }
}

async function checkPg(): Promise<DepCheckResult> {
  // Gunakan pingDbNoCb() — raw pool sementara yang TIDAK melewati CB guard.
  // Dengan ini, hasil ping tidak akan membuka circuit breaker lokal,
  // sehingga startup validator tidak ikut-ikutan memicu ECB saat pgBouncer throttle.
  const cbStatus = getCircuitBreakerStatus();
  if (cbStatus.open) {
    const remaining = cbStatus.remainingCooldownSeconds;
    return {
      status: "error",
      detail: `Circuit breaker open — pgBouncer sedang throttle (cooldown ${remaining}s lagi). Queries di-hold sampai CB expire.`,
    };
  }

  const result = await pingDbNoCb();
  if (result.ok) {
    return { status: "ok", detail: `DB ping OK (${result.latencyMs}ms)` };
  }
  return { status: "error", detail: result.error ?? "Ping gagal (tidak ada detail)" };
}

async function checkOpenai(): Promise<DepCheckResult> {
  try {
    const m = await import("openai");
    const hasClass = !!(m?.OpenAI ?? m?.default?.OpenAI ?? m?.default);
    if (!hasClass) return { status: "error", detail: "openai loaded tapi class OpenAI tidak ditemukan" };
    return { status: "ok" };
  } catch (err: any) {
    if (err?.code === "MODULE_NOT_FOUND") {
      return { status: "missing", detail: "Package 'openai' tidak ditemukan" };
    }
    return { status: "error", detail: String(err?.message ?? err) };
  }
}

async function checkNodemailer(): Promise<DepCheckResult> {
  try {
    const m = await import("nodemailer");
    const hasCreate = typeof (m?.createTransport ?? m?.default?.createTransport) === "function";
    if (!hasCreate) return { status: "error", detail: "nodemailer loaded tapi createTransport tidak ditemukan" };
    return { status: "ok" };
  } catch (err: any) {
    if (err?.code === "MODULE_NOT_FOUND") {
      return { status: "missing", detail: "Package 'nodemailer' tidak ditemukan" };
    }
    return { status: "error", detail: String(err?.message ?? err) };
  }
}

const REQUIRED_SECRETS: Array<{ name: string; minLen?: number }> = [
  { name: "SESSION_SECRET", minLen: 32 },
];

/**
 * Integration secrets — warn-only (tidak fatal).
 * Fitur terkait tetap bisa dinonaktifkan secara graceful jika secret kosong,
 * tapi server mencatat peringatan agar operator tahu apa yang belum dikonfigurasi.
 *
 * PORTAL_ADMIN_KEY: semua endpoint fail-closed (401/403/503) jika tidak ada;
 *   vendorResponseToken.ts fallback ke SESSION_SECRET → tetap aman.
 *   Core accounting, AI, dan bank reconciliation tidak terpengaruh.
 */
const INTEGRATION_SECRETS: Array<{ key: string; feature: string }> = [
  { key: "PORTAL_ADMIN_KEY",           feature: "Customer portal admin claim + internal audit endpoints (sport-center, translations)" },
  { key: "OPENAI_API_KEY",             feature: "AI assistant / expense classifier / chatbot" },
  { key: "PAYLABS_PRIVATE_KEY",        feature: "Paylabs payment gateway" },
  { key: "FONNTE_TOKEN",               feature: "WhatsApp messaging via Fonnte" },
  { key: "GOOGLE_SERVICE_ACCOUNT_JSON", feature: "Google Sheets / Drive nightly sync" },
];

function checkIntegrationSecrets(): {
  statuses: IntegrationSecretStatus[];
  missing: string[];
} {
  const statuses: IntegrationSecretStatus[] = INTEGRATION_SECRETS.map(({ key, feature }) => ({
    key,
    feature,
    present: !!(process.env[key]?.trim()),
  }));
  const missing = statuses.filter((s) => !s.present).map((s) => s.key);
  return { statuses, missing };
}

function checkRequiredSecrets(): { missing: string[]; weak: string[] } {
  const missing: string[] = [];
  const weak: string[] = [];
  for (const { name, minLen = 1 } of REQUIRED_SECRETS) {
    const val = process.env[name] ?? "";
    if (!val) {
      missing.push(name);
    } else if (val.length < minLen) {
      weak.push(`${name} (panjang ${val.length} < ${minLen})`);
    } else if (
      val === "admin123" ||
      val === "secret" ||
      val === "changeme" ||
      val === "password" ||
      val === "1234" ||
      val === "test"
    ) {
      weak.push(`${name} (nilai default tidak aman)`);
    }
  }
  return { missing, weak };
}

export async function runStartupValidation(): Promise<RuntimeCheckState> {
  logger.info("[startupValidator] Memeriksa runtime dependencies...");

  const { missing: missingSecrets, weak: weakSecrets } = checkRequiredSecrets();
  if (missingSecrets.length > 0) {
    logger.error({ missingSecrets }, "[startupValidator] SECRET WAJIB TIDAK DIKONFIGURASI — set di Replit Secrets");
    throw new Error(
      `Secret wajib tidak dikonfigurasi: ${missingSecrets.join(", ")}. ` +
      "Set di Replit Secrets sebelum menjalankan server."
    );
  }
  if (weakSecrets.length > 0) {
    logger.error({ weakSecrets }, "[startupValidator] SECRET LEMAH TERDETEKSI — ganti sekarang");
    throw new Error(
      `Secret tidak aman: ${weakSecrets.join(", ")}. ` +
      "Ganti dengan nilai acak yang kuat di Replit Secrets."
    );
  }

  // Check integration secrets (warn-only — missing keys disable features gracefully)
  const { statuses: integrationStatuses, missing: missingIntegrations } = checkIntegrationSecrets();
  if (missingIntegrations.length > 0) {
    logger.warn(
      { missingIntegrationSecrets: missingIntegrations },
      "[startupValidator] Integration secrets belum dikonfigurasi — fitur terkait tidak aktif",
    );
  } else {
    logger.info("[startupValidator] Semua integration secrets terkonfigurasi ✓");
  }

  const [googleapis, openai, drizzle, pg, nodemailer] = await Promise.allSettled([
    checkGoogleapis(),
    checkOpenai(),
    checkDrizzle(),
    checkPg(),
    checkNodemailer(),
  ]);

  const deps: Record<string, DepCheckResult> = {
    googleapis:  googleapis.status  === "fulfilled" ? googleapis.value  : { status: "error", detail: String((googleapis as any).reason) },
    openai:      openai.status      === "fulfilled" ? openai.value      : { status: "error", detail: String((openai as any).reason) },
    "drizzle-orm": drizzle.status   === "fulfilled" ? drizzle.value     : { status: "error", detail: String((drizzle as any).reason) },
    pg:          pg.status          === "fulfilled" ? pg.value          : { status: "error", detail: String((pg as any).reason) },
    nodemailer:  nodemailer.status  === "fulfilled" ? nodemailer.value  : { status: "error", detail: String((nodemailer as any).reason) },
  };

  const missing = Object.entries(deps)
    .filter(([, v]) => v.status === "missing")
    .map(([k]) => k);

  const hasError = Object.values(deps).some((v) => v.status === "missing" || v.status === "error");

  const state: RuntimeCheckState = {
    checkedAt: new Date().toISOString(),
    status: hasError ? "degraded" : "ok",
    dependencies: deps,
    missing,
    integrationSecrets: integrationStatuses,
    missingIntegrationSecrets: missingIntegrations,
  };

  _state = state;

  if (missing.length > 0) {
    logger.error({ missing }, "[startupValidator] DEPENDENCY HILANG — install dengan pnpm add <package>");
  } else if (hasError) {
    const errors = Object.entries(deps).filter(([, v]) => v.status === "error").map(([k]) => k);
    logger.warn({ errors }, "[startupValidator] Beberapa dependency error saat load");
  } else {
    logger.info("[startupValidator] Semua runtime dependencies OK");
  }

  return state;
}

export function getRuntimeCheckState(): RuntimeCheckState | null {
  return _state;
}
