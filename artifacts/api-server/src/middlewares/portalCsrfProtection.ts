import type { NextFunction, Request, Response } from "express";
import { timingSafeEqual } from "crypto";

const SAFE_METHODS = new Set(["GET", "HEAD", "OPTIONS"]);
const SESSION_COOKIES = new Set(["portal_session", "sid"]);

function isProduction(): boolean {
  return process.env.REPLIT_DEPLOYMENT === "1";
}

function configuredOrigins(): Set<string> {
  return new Set(
    [
      "https://cstlogistic.co.id",
      "https://www.cstlogistic.co.id",
      "https://bizportal.cstlogistic.co.id",
      process.env.APP_URL?.replace(/\/$/, ""),
      process.env.REPLIT_DEV_DOMAIN && !isProduction()
        ? `https://${process.env.REPLIT_DEV_DOMAIN}`
        : undefined,
      ...(process.env.CORS_EXTRA_ORIGINS ?? "")
        .split(",")
        .map((origin) => origin.trim().replace(/\/$/, ""))
        .filter(Boolean),
    ].filter((origin): origin is string => Boolean(origin)),
  );
}

function isLoopbackOrigin(origin: string): boolean {
  if (isProduction()) return false;
  try {
    const parsed = new URL(origin);
    return (
      (parsed.protocol === "http:" || parsed.protocol === "https:") &&
      (parsed.hostname === "127.0.0.1" ||
        parsed.hostname === "localhost" ||
        parsed.hostname === "::1")
    );
  } catch {
    return false;
  }
}

function originFromReferer(referer: string | undefined): string | null {
  if (!referer) return null;
  try {
    return new URL(referer).origin;
  } catch {
    return null;
  }
}

function originIsAllowed(origin: string | null): boolean {
  if (!origin) return false;
  const normalized = origin.replace(/\/$/, "");
  return configuredOrigins().has(normalized) || isLoopbackOrigin(normalized);
}

function hasSessionCookie(req: Request): boolean {
  const cookies = (req.cookies ?? {}) as Record<string, unknown>;
  return [...SESSION_COOKIES].some((name) => typeof cookies[name] === "string" && cookies[name]);
}

function isLoopbackRequest(req: Request): boolean {
  const remote = req.socket.remoteAddress ?? "";
  const ip = req.ip ?? "";
  return [remote, ip].some((value) =>
    value === "127.0.0.1" || value === "::1" || value === "::ffff:127.0.0.1",
  );
}

/**
 * Cookie-authenticated unsafe requests must prove they originated from an
 * allowlisted portal origin. CORS is not sufficient because simple forms and
 * navigations do not need a successful CORS preflight.
 *
 * Development loopback is allowed without an Origin/Referer so Node-based safe
 * harnesses can exercise cookie sessions. Production is always fail-closed.
 */
export function portalCsrfProtection(req: Request, res: Response, next: NextFunction): void {
  if (SAFE_METHODS.has(req.method) || !hasSessionCookie(req)) {
    next();
    return;
  }

  const originHeader = typeof req.headers.origin === "string" ? req.headers.origin : null;
  const candidateOrigin = originHeader ?? originFromReferer(
    typeof req.headers.referer === "string" ? req.headers.referer : undefined,
  );

  if (originIsAllowed(candidateOrigin)) {
    next();
    return;
  }

  if (!candidateOrigin && !isProduction() && isLoopbackRequest(req)) {
    next();
    return;
  }

  res.status(403).json({
    message: "Permintaan ditolak: origin sesi tidak valid.",
    code: "PORTAL_CSRF_ORIGIN_INVALID",
  });
}

/**
 * Exported for focused route/middleware tests without exposing any secrets.
 */
export function constantTimeEqual(a: string, b: string): boolean {
  const left = Buffer.from(a);
  const right = Buffer.from(b);
  return left.length === right.length && timingSafeEqual(left, right);
}