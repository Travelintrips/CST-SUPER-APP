/**
 * Token Guard — Security Patch P0/P2 (Enterprise Hardening)
 *
 * Centralized token validation + audit logging untuk semua public token routes.
 *
 * Pola penggunaan:
 *   const guard = checkToken({ expiresAt: link.expiresAt, revokedAt: link.revokedAt, usedAt: link.usedAt });
 *   if (!guard.ok) return res.status(guard.status).json({ error: guard.error, ...guard.meta });
 *   logTokenAccess({ tokenType: "customer_quote", tokenRef: token, entityId: String(link.id), action: "view", outcome: "ok", req });
 */

import { db } from "@workspace/db";
import { sql } from "drizzle-orm";
import { logger } from "./logger.js";
import { maskToken } from "./tokenUtils.js";
import type { Request } from "express";

// ── Types ───────────────────────────────────────────────────────────────────

export interface TokenCheckInput {
  /** Token dari database (untuk logging) */
  tokenRef?: string;
  /** Apakah token ada di database */
  exists?: boolean;
  /** Timestamp kadaluarsa */
  expiresAt?: Date | string | null;
  /** Timestamp sudah digunakan (one-time-use) */
  usedAt?: Date | string | null;
  /** Flag sudah digunakan (alternatif usedAt) */
  isUsed?: boolean | null;
  /** Timestamp dicabut oleh admin */
  revokedAt?: Date | string | null;
  /** isActive = false → dianggap revoked */
  isActive?: boolean | null;
  /** Status string — jika "revoked" dianggap revoked */
  status?: string | null;
  /** P1.2 — Context binding: purpose yang diharapkan */
  expectedPurpose?: string | null;
  /** P1.2 — Context binding: purpose yang ada di DB */
  actualPurpose?: string | null;
  /** P1.2 — Context binding: entity ID yang diharapkan (opsional, untuk cross-entity protection) */
  expectedEntityId?: string | number | null;
  /** P1.2 — Context binding: entity ID di DB */
  actualEntityId?: string | number | null;
}

export type TokenOutcome =
  | "ok"
  | "denied_not_found"
  | "denied_expired"
  | "denied_used"
  | "denied_revoked"
  | "denied_context_mismatch";

export interface TokenGuardOk {
  ok: true;
  outcome: "ok";
}

export interface TokenGuardDenied {
  ok: false;
  outcome: Exclude<TokenOutcome, "ok">;
  status: 404 | 410 | 409 | 403;
  error: string;
  meta?: Record<string, unknown>;
}

export type TokenGuardResult = TokenGuardOk | TokenGuardDenied;

// ── Core Validator ──────────────────────────────────────────────────────────

/**
 * Cek validitas token berdasarkan field yang ada.
 * Urutan prioritas: not_found → revoked → context_mismatch → expired → used → ok
 */
export function checkToken(input: TokenCheckInput): TokenGuardResult {
  // 1. Not found — fail-closed:
  //    a) explicitly absent (exists: false)
  //    b) existence unknown (exists: undefined) AND no concrete token field is present
  //       → this catches the common bug where caller spreads an undefined DB row
  //         (link?.expiresAt etc. all become undefined, leaking ok:true)
  if (input.exists === false) {
    return { ok: false, outcome: "denied_not_found", status: 404, error: "Link tidak ditemukan" };
  }
  if (input.exists === undefined) {
    const hasAnyRowData =
      input.expiresAt != null || input.revokedAt != null || input.usedAt != null ||
      input.isActive != null || input.status != null || input.isUsed != null;
    if (!hasAnyRowData) {
      return { ok: false, outcome: "denied_not_found", status: 404, error: "Link tidak ditemukan" };
    }
  }

  // 2. Revoked (admin cabut akses)
  const revoked =
    (input.revokedAt != null) ||
    (input.isActive === false) ||
    (input.status === "revoked");

  if (revoked) {
    return {
      ok: false, outcome: "denied_revoked", status: 403,
      error: "Link ini telah dicabut dan tidak dapat diakses",
      meta: { revokedAt: input.revokedAt ?? null },
    };
  }

  // 3. P1.2 — Context binding (purpose / entity mismatch)
  if (input.expectedPurpose != null && input.actualPurpose != null) {
    if (input.expectedPurpose !== input.actualPurpose) {
      return {
        ok: false, outcome: "denied_context_mismatch", status: 403,
        error: "Link ini tidak valid untuk aksi yang diminta",
        meta: { reason: "purpose_mismatch" },
      };
    }
  }
  if (input.expectedEntityId != null && input.actualEntityId != null) {
    if (String(input.expectedEntityId) !== String(input.actualEntityId)) {
      return {
        ok: false, outcome: "denied_context_mismatch", status: 403,
        error: "Link ini tidak valid untuk entitas yang diminta",
        meta: { reason: "entity_mismatch" },
      };
    }
  }

  // 4. Expired
  const expiresAt = input.expiresAt ? new Date(input.expiresAt) : null;
  if (expiresAt && expiresAt < new Date()) {
    return {
      ok: false, outcome: "denied_expired", status: 410,
      error: "Link sudah kadaluarsa",
      meta: { expiredAt: expiresAt.toISOString() },
    };
  }

  // 5. Already used (one-time-use)
  const used = (input.usedAt != null) || (input.isUsed === true);
  if (used) {
    return {
      ok: false, outcome: "denied_used", status: 409,
      error: "Link ini sudah digunakan sebelumnya",
      meta: { usedAt: input.usedAt ?? null },
    };
  }

  return { ok: true, outcome: "ok" };
}

// ── Audit Logger ────────────────────────────────────────────────────────────

export interface LogTokenAccessInput {
  tokenType: string;
  /** Raw token — akan di-MASK sebelum disimpan. Jangan khawatir tentang exposure. */
  tokenRef: string;
  entityId?: string | number | null;
  action: string;
  outcome?: TokenOutcome;
  req?: Request;
  /** P2.1 enrichment */
  responseStatus?: number | null;
  latencyMs?: number | null;
}

/**
 * Fire-and-forget audit log (P2.1 Enriched).
 * Token ref selalu di-mask sebelum masuk DB.
 * Tidak memblok request, error di-swallow dengan log warning.
 */
export function logTokenAccess(input: LogTokenAccessInput): void {
  const ip = input.req
    ? (input.req.headers["x-forwarded-for"] as string | undefined)?.split(",")[0]?.trim() ??
      input.req.socket?.remoteAddress ??
      null
    : null;
  const ua = input.req?.headers["user-agent"] ?? null;

  // P2.4 — Always mask token before storing in audit log
  const maskedRef = maskToken(input.tokenRef);

  // P2.1 — Extract enriched request metadata
  const requestId    = input.req?.headers["x-request-id"] as string | undefined ?? null;
  const requestMethod = input.req?.method ?? null;
  const route        = input.req?.route?.path ?? input.req?.path ?? null;

  db.execute(sql`
    INSERT INTO token_access_log
      (token_type, token_ref, entity_id, action, outcome,
       ip_address, user_agent,
       request_id, response_status, latency_ms, request_method, route,
       created_at)
    VALUES (
      ${input.tokenType},
      ${maskedRef},
      ${input.entityId != null ? String(input.entityId) : null},
      ${input.action},
      ${input.outcome ?? "ok"},
      ${ip},
      ${ua ? ua.slice(0, 512) : null},
      ${requestId},
      ${input.responseStatus ?? null},
      ${input.latencyMs ?? null},
      ${requestMethod},
      ${route ? route.slice(0, 256) : null},
      NOW()
    )
  `).catch((err: unknown) => {
    logger.warn({ err }, "[tokenGuard] audit log insert failed (non-fatal)");
  });
}

// ── Convenience: validate + log in one call ─────────────────────────────────

export interface ValidateAndLogInput extends TokenCheckInput {
  tokenType: string;
  tokenRef: string;
  entityId?: string | number | null;
  action?: string;
  req?: Request;
  responseStatus?: number | null;
  latencyMs?: number | null;
}

/**
 * Validasi token DAN log hasil dalam satu panggilan.
 * Mengembalikan TokenGuardResult. Caller tinggal cek `result.ok`.
 */
export function validateAndLog(input: ValidateAndLogInput): TokenGuardResult {
  const result = checkToken(input);
  logTokenAccess({
    tokenType: input.tokenType,
    tokenRef: input.tokenRef,
    entityId: input.entityId,
    action: input.action ?? (result.ok ? "view" : "denied"),
    outcome: result.outcome,
    req: input.req,
    responseStatus: input.responseStatus,
    latencyMs: input.latencyMs,
  });
  return result;
}
