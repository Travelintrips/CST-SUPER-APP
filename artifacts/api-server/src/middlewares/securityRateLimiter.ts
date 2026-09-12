/**
 * Security Rate Limiters — S4.5
 *
 * Part A: authRateLimiter        — 10 req/min/IP  on auth endpoints
 * Part B: publicTokenRateLimiter — 30 req/min/IP  on public token endpoints
 * Part C: aiRateLimiter          — 60 req/min/user on AI endpoints
 *
 * All handlers write RATE_LIMIT_EXCEEDED / AI_RATE_LIMIT_EXCEEDED audit logs
 * and feed the suspicious activity detector.
 */

import { rateLimit } from "express-rate-limit";
import type { Request, Response, NextFunction } from "express";
import { createHash } from "node:crypto";
import { writeAuditLog, extractRequestMeta } from "../lib/auditLog.js";
import { trackSuspiciousActivity } from "../lib/suspiciousActivity.js";

const IS_DEV = process.env.NODE_ENV !== "production";

function getIp(req: Request): string {
  const fwd = req.headers["x-forwarded-for"];
  const raw = (Array.isArray(fwd) ? fwd[0] : fwd?.split(",")[0]) ?? req.ip ?? "unknown";
  return raw.trim().replace(/^::ffff:/, "");
}

function getUserKey(req: Request): string {
  const user = req.user as { id?: string } | undefined;
  return user?.id ? `user:${user.id}` : `ip:${getIp(req)}`;
}

// ── Part A — Auth Rate Limiter ────────────────────────────────────────────────
// 10 req/min/IP in prod; 200/min in dev (avoid breaking dev workflow)
export const authRateLimiter = rateLimit({
  windowMs: 60_000,
  max: IS_DEV ? 200 : 10,
  standardHeaders: "draft-7",
  legacyHeaders: false,
  validate: false,
  keyGenerator: (req: Request) => `auth:${getIp(req)}`,
  handler: (req: Request, res: Response, _next: NextFunction) => {
    const meta = extractRequestMeta(req);
    writeAuditLog({
      action: "RATE_LIMIT_EXCEEDED",
      module: "auth",
      ipAddress: meta.ipAddress,
      userAgent: meta.userAgent,
      newData: {
        route:     req.path,
        method:    req.method,
        timestamp: new Date().toISOString(),
      },
    });
    trackSuspiciousActivity("rate_limit", meta.ipAddress);
    res.status(429).json({
      error: "Too many authentication requests. Please wait 60 seconds before retrying.",
      retryAfter: 60,
    });
  },
});

// ── Part B — Public Token Rate Limiter ───────────────────────────────────────
// 30 req/min/IP in prod; 500/min in dev (broad, for non-token endpoints)
export const publicTokenRateLimiter = rateLimit({
  windowMs: 60_000,
  max: IS_DEV ? 500 : 30,
  standardHeaders: "draft-7",
  legacyHeaders: false,
  validate: false,
  keyGenerator: (req: Request) => `pubtoken:${getIp(req)}`,
  handler: (req: Request, res: Response, _next: NextFunction) => {
    const meta = extractRequestMeta(req);
    writeAuditLog({
      action: "RATE_LIMIT_EXCEEDED",
      module: "public-token",
      ipAddress: meta.ipAddress,
      userAgent: meta.userAgent,
      newData: {
        route:     req.path,
        method:    req.method,
        timestamp: new Date().toISOString(),
      },
    });
    trackSuspiciousActivity("expired_token", meta.ipAddress);
    trackSuspiciousActivity("rate_limit",    meta.ipAddress);
    res.status(429).json({
      error: "Too many requests for this token. Please wait 60 seconds before retrying.",
      retryAfter: 60,
    });
  },
});

// ── Part D — Token GET Rate Limiter (P0.3) ───────────────────────────────────
// 5 req/min per IP+path for GET (view) — prevents token enumeration.
// The token-bearing path is hashed before it becomes a limiter key.
export const tokenGetRateLimiter = rateLimit({
  windowMs: 60_000,
  max: IS_DEV ? 200 : 5,
  standardHeaders: "draft-7",
  legacyHeaders: false,
  validate: false,
  keyGenerator: (req: Request) => {
    const pathKey = req.path.slice(0, 128);
    const pathDigest = createHash("sha256").update(pathKey).digest("hex").slice(0, 16);
    return `tokenget:${getIp(req)}:${pathDigest}`;
  },
  handler: (req: Request, res: Response, _next: NextFunction) => {
    const meta = extractRequestMeta(req);
    writeAuditLog({
      action: "RATE_LIMIT_EXCEEDED",
      module: "token-get",
      ipAddress: meta.ipAddress,
      userAgent: meta.userAgent,
      newData: {
        route:     req.path,
        method:    req.method,
        timestamp: new Date().toISOString(),
      },
    });
    trackSuspiciousActivity("rate_limit", meta.ipAddress);
    res.set("Retry-After", "60").status(429).json({
      error: "Terlalu banyak permintaan. Silakan tunggu 1 menit sebelum mencoba lagi.",
      retryAfter: 60,
    });
  },
});

// ── Part E — Token POST Rate Limiter (P0.3) ──────────────────────────────────
// 10 req/hour per IP+path for POST (submit) — prevents brute-force submission.
// The token-bearing path is hashed before it becomes a limiter key.
export const tokenPostRateLimiter = rateLimit({
  windowMs: 60 * 60_000,   // 1 jam
  max: IS_DEV ? 200 : 10,
  standardHeaders: "draft-7",
  legacyHeaders: false,
  validate: false,
  keyGenerator: (req: Request) => {
    const pathKey = req.path.slice(0, 128);
    const pathDigest = createHash("sha256").update(pathKey).digest("hex").slice(0, 16);
    return `tokenpost:${getIp(req)}:${pathDigest}`;
  },
  handler: (req: Request, res: Response, _next: NextFunction) => {
    const meta = extractRequestMeta(req);
    writeAuditLog({
      action: "RATE_LIMIT_EXCEEDED",
      module: "token-post",
      ipAddress: meta.ipAddress,
      userAgent: meta.userAgent,
      newData: {
        route:     req.path,
        method:    req.method,
        timestamp: new Date().toISOString(),
      },
    });
    trackSuspiciousActivity("rate_limit", meta.ipAddress);
    res.set("Retry-After", "3600").status(429).json({
      error: "Terlalu banyak percobaan submit. Silakan tunggu 1 jam sebelum mencoba lagi.",
      retryAfter: 3600,
    });
  },
});

// ── Part F — InvoiceOCR Rate Limiter (RC3 P1) ────────────────────────────────
// InvoiceOCR calls GPT-4o/GPT-4o-mini (vision) per request — expensive, so it
// gets its own dedicated, stricter budget layered on top of aiRateLimiter.
// Ordering matters: the IP limiter runs BEFORE auth (it exists only to stop
// gross pre-auth abuse/bots hammering the endpoint), so it is deliberately
// generous. The user/company limiters run AFTER auth on these routes, so they
// only ever key on a real authenticated user — anonymous traffic can no longer
// burn through the per-user/per-company budget of legitimate staff sharing an
// office IP.
//   1. Per-IP (pre-auth)     — 40 req / 10 min  — abuse/bot guard only
//   2. Per-user (post-auth)  — 10 req / 10 min  — real per-staff budget
//   3. Per-company (post-auth, skipped if no company context) — 30 req / 10 min
// Any one tripping returns 429 without invoking OCR logic.
function getCompanyKey(req: Request): string | null {
  const user = req.user as { companyId?: number | string | null } | undefined;
  return user?.companyId != null ? `company:${user.companyId}` : null;
}

function ocrLimitHandler(module: string) {
  return (req: Request, res: Response, _next: NextFunction) => {
    const meta = extractRequestMeta(req);
    writeAuditLog({
      action: "AI_RATE_LIMIT_EXCEEDED",
      module,
      userId: meta.userId,
      userEmail: meta.userEmail,
      companyId: meta.companyId,
      ipAddress: meta.ipAddress,
      userAgent: meta.userAgent,
      newData: {
        route: req.path,
        method: req.method,
        timestamp: new Date().toISOString(),
      },
    });
    trackSuspiciousActivity("rate_limit", meta.ipAddress);
    res.set("Retry-After", "600").status(429).json({
      error: "Terlalu banyak permintaan InvoiceOCR. Silakan tunggu beberapa menit sebelum mencoba lagi.",
      retryAfter: 600,
    });
  };
}

export const ocrIpRateLimiter = rateLimit({
  windowMs: 10 * 60_000,
  max: IS_DEV ? 1000 : 40,
  standardHeaders: "draft-7",
  legacyHeaders: false,
  validate: false,
  keyGenerator: (req: Request) => `ocr-ip:${getIp(req)}`,
  handler: ocrLimitHandler("invoice-ocr-ip"),
});

export const ocrUserRateLimiter = rateLimit({
  windowMs: 10 * 60_000,
  max: IS_DEV ? 1000 : 10,
  standardHeaders: "draft-7",
  legacyHeaders: false,
  validate: false,
  keyGenerator: (req: Request) => `ocr-user:${getUserKey(req)}`,
  handler: ocrLimitHandler("invoice-ocr-user"),
});

// Per-company limiter — a no-op passthrough when company context isn't
// resolvable on req.user (schema/auth variance), so it never breaks requests
// that lack company context; it only constrains when the context IS present.
export const ocrCompanyRateLimiter = rateLimit({
  windowMs: 10 * 60_000,
  max: IS_DEV ? 1000 : 30,
  standardHeaders: "draft-7",
  legacyHeaders: false,
  validate: false,
  skip: (req: Request) => getCompanyKey(req) === null,
  keyGenerator: (req: Request) => `ocr-company:${getCompanyKey(req)}`,
  handler: ocrLimitHandler("invoice-ocr-company"),
});

// ── Part C — AI Endpoint Rate Limiter ────────────────────────────────────────
// 60 req/min/user in prod; 1000/min in dev
export const aiRateLimiter = rateLimit({
  windowMs: 60_000,
  max: IS_DEV ? 1000 : 60,
  standardHeaders: "draft-7",
  legacyHeaders: false,
  validate: false,
  keyGenerator: (req: Request) => getUserKey(req),
  handler: (req: Request, res: Response, _next: NextFunction) => {
    const meta = extractRequestMeta(req);
    writeAuditLog({
      action:     "AI_RATE_LIMIT_EXCEEDED",
      module:     "ai",
      userId:     meta.userId,
      userEmail:  meta.userEmail,
      companyId:  meta.companyId,
      ipAddress:  meta.ipAddress,
      userAgent:  meta.userAgent,
      newData: {
        route:     req.path,
        method:    req.method,
        timestamp: new Date().toISOString(),
      },
    });
    res.status(429).json({
      error: "AI rate limit exceeded. Please wait 60 seconds before retrying.",
      retryAfter: 60,
    });
  },
});
