/**
 * Reusable in-memory per-user/per-key rate limiter (sliding window).
 *
 * Usage:
 *   const limiter = createRateLimiter({ windowMs: 10 * 60_000, limit: 10 });
 *   if (!limiter.check(key)) return res.status(429).json({ error: "..." });
 *
 * Keys are arbitrary strings (user ID, bearer token hash, IP, etc.).
 * The internal Map grows at most to `maxKeys` entries; oldest are evicted
 * when the cap is reached to prevent unbounded memory growth.
 */

import { createHash } from "crypto";
import type { Request } from "express";

export interface RateLimiter {
  /** Returns true if the request is allowed, false if limit exceeded. */
  check(key: string): boolean;
  /** Returns remaining quota for a key (for logging/debugging). */
  remaining(key: string): number;
}

interface Entry { count: number; resetAt: number }

/**
 * Create a rate limiter with a single fixed window.
 *
 * @param windowMs  Window duration in ms.
 * @param limit     Maximum requests allowed per window per key.
 * @param maxKeys   Max distinct keys in memory (default 5 000).
 */
export function createRateLimiter({
  windowMs,
  limit,
  maxKeys = 5_000,
}: {
  windowMs: number;
  limit: number;
  maxKeys?: number;
}): RateLimiter {
  const map = new Map<string, Entry>();

  function evictIfNeeded() {
    if (map.size >= maxKeys) {
      // Remove first (oldest inserted) entry
      const firstKey = map.keys().next().value;
      if (firstKey !== undefined) map.delete(firstKey);
    }
  }

  function getOrCreate(key: string): Entry {
    const now = Date.now();
    const existing = map.get(key);
    if (!existing || now > existing.resetAt) {
      evictIfNeeded();
      const entry: Entry = { count: 0, resetAt: now + windowMs };
      map.set(key, entry);
      return entry;
    }
    return existing;
  }

  return {
    check(key: string): boolean {
      const entry = getOrCreate(key);
      if (entry.count >= limit) return false;
      entry.count += 1;
      return true;
    },
    remaining(key: string): number {
      const now = Date.now();
      const existing = map.get(key);
      if (!existing || now > existing.resetAt) return limit;
      return Math.max(0, limit - existing.count);
    },
  };
}

/**
 * Two-tier rate limiter: enforces both a short burst window and a longer
 * hourly window. Both must pass for the request to be allowed.
 *
 * @param burst   Short-window config (e.g. 5 per minute)
 * @param hourly  Long-window config  (e.g. 30 per hour)
 */
export function createTwoTierRateLimiter(
  burst: { windowMs: number; limit: number },
  hourly: { windowMs: number; limit: number },
): RateLimiter {
  const burstLimiter = createRateLimiter(burst);
  const hourlyLimiter = createRateLimiter(hourly);
  return {
    check(key: string): boolean {
      // Peek hourly first (non-consuming) using remaining, then consume both
      if (hourlyLimiter.remaining(key) === 0) return false;
      if (!burstLimiter.check(key)) return false;
      // Consume hourly slot (burst already consumed above)
      return hourlyLimiter.check(key);
    },
    remaining(key: string): number {
      return Math.min(burstLimiter.remaining(key), hourlyLimiter.remaining(key));
    },
  };
}

/**
 * Extract a stable rate-limit key from the request:
 *  - Clerk session user → "user:{userId}"
 *  - Bearer token      → "bearer:{sha256(token).slice(0,16)}"
 *  - IP fallback       → "ip:{ip}"
 */
export function extractRateLimitKey(req: Request): string {
  // Clerk session (isAuthenticated sets req.user from passport)
  if (req.isAuthenticated && req.isAuthenticated() && req.user) {
    const userId = (req.user as { id?: string }).id;
    if (userId) return `user:${userId}`;
  }
  // Bearer token — hash so raw token never stored in memory
  const auth = req.headers["authorization"];
  if (typeof auth === "string" && auth.startsWith("Bearer ")) {
    const token = auth.slice(7);
    const hash = createHash("sha256").update(token).digest("hex").slice(0, 16);
    return `bearer:${hash}`;
  }
  // IP fallback
  const ip =
    (req.headers["x-forwarded-for"] as string | undefined)?.split(",")[0]?.trim() ??
    req.socket?.remoteAddress ??
    "unknown";
  return `ip:${ip}`;
}
