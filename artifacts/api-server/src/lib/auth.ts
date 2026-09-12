import * as client from "openid-client";
import crypto from "crypto";
import { type Request, type Response } from "express";
import { db, sessionsTable } from "@workspace/db";
import { eq } from "drizzle-orm";
export interface AuthUser {
  id: string;
  email?: string | null;
  firstName?: string | null;
  lastName?: string | null;
  profileImageUrl?: string | null;
  role?: string | null;
  companyId?: number | null;
  /** Admin-only: list of company IDs this user may access. Empty = all companies. */
  allowedCompanyIds?: number[];
}

export const ISSUER_URL = process.env.ISSUER_URL ?? "https://replit.com/oidc";
export const SESSION_COOKIE = "sid";
export const SESSION_TTL = 7 * 24 * 60 * 60 * 1000;

export interface SessionData {
  user: AuthUser;
  access_token: string;
  refresh_token?: string;
  expires_at?: number;
}

// In-memory session store — fallback when DB is unavailable (dev & prod)
const _memSessions = new Map<string, { data: SessionData; expire: Date }>();

// Read-through cache: populated whenever getSession succeeds from DB.
// Survives ECIRCUITBREAKER — session stays accessible while CB cooldown is active.
// Max 500 entries; entries expire when the DB session expires.
const _sessionReadCache = new Map<string, { data: SessionData; expireMs: number }>();

const IS_DEV = !process.env.REPLIT_DEPLOYMENT;

function _memGet(sid: string): SessionData | null {
  const entry = _memSessions.get(sid);
  if (!entry) return null;
  if (entry.expire < new Date()) { _memSessions.delete(sid); return null; }
  return entry.data;
}

function _memSet(sid: string, data: SessionData): void {
  _memSessions.set(sid, { data, expire: new Date(Date.now() + SESSION_TTL) });
}

function _memDelete(sid: string): void {
  _memSessions.delete(sid);
}

function _readCacheGet(sid: string): SessionData | null {
  const entry = _sessionReadCache.get(sid);
  if (!entry) return null;
  if (entry.expireMs < Date.now()) { _sessionReadCache.delete(sid); return null; }
  return entry.data;
}

function _readCacheSet(sid: string, data: SessionData, expireMs: number): void {
  if (_sessionReadCache.size > 500) {
    // Evict oldest entry
    const firstKey = _sessionReadCache.keys().next().value;
    if (firstKey) _sessionReadCache.delete(firstKey);
  }
  _sessionReadCache.set(sid, { data, expireMs });
}

function _readCacheDelete(sid: string): void {
  _sessionReadCache.delete(sid);
}

let oidcConfig: client.Configuration | null = null;

export async function getOidcConfig(): Promise<client.Configuration> {
  if (!oidcConfig) {
    oidcConfig = await client.discovery(
      new URL(ISSUER_URL),
      process.env.REPL_ID!,
    );
  }
  return oidcConfig;
}

export async function createSession(data: SessionData): Promise<string> {
  const sid = crypto.randomBytes(32).toString("hex");
  try {
    await db.insert(sessionsTable).values({
      sid,
      sess: data as unknown as Record<string, unknown>,
      expire: new Date(Date.now() + SESSION_TTL),
    });
    return sid;
  } catch {
    // DB unavailable — store in memory, schedule async retry to persist to DB
    _memSet(sid, data);
    _scheduleMemToDB(sid);
    return sid;
  }
}

/**
 * Retry persisting a memory-only session to DB in the background.
 * Attempts every 5s for up to 2 minutes. Once persisted, removes from memory.
 * This ensures sessions survive server restarts even when DB was temporarily unavailable at login.
 */
function _scheduleMemToDB(sid: string, attempt = 0): void {
  const MAX_ATTEMPTS = 24; // 24 × 5s = 2 minutes
  const INTERVAL_MS = 5_000;
  setTimeout(async () => {
    const entry = _memSessions.get(sid);
    if (!entry) return; // already deleted (logout)
    try {
      await db.insert(sessionsTable)
        .values({
          sid,
          sess: entry.data as unknown as Record<string, unknown>,
          expire: entry.expire,
        })
        .onConflictDoNothing();
      // Successfully persisted — remove from memory-only store
      _memSessions.delete(sid);
    } catch {
      if (attempt < MAX_ATTEMPTS) _scheduleMemToDB(sid, attempt + 1);
    }
  }, INTERVAL_MS);
}

export async function getSession(sid: string): Promise<SessionData | null> {
  // 1. In-memory store (sessions created when DB was unavailable)
  const memData = _memGet(sid);
  if (memData) return memData;

  // 2. Read-through cache (survives ECIRCUITBREAKER restarts)
  const cached = _readCacheGet(sid);

  try {
    const [row] = await db
      .select()
      .from(sessionsTable)
      .where(eq(sessionsTable.sid, sid));

    if (!row || row.expire < new Date()) {
      if (row) await deleteSession(sid).catch(() => {});
      _readCacheDelete(sid);
      return null;
    }

    // Cache on successful DB read so subsequent requests survive ECIRCUITBREAKER
    const data = row.sess as unknown as SessionData;
    _readCacheSet(sid, data, row.expire.getTime());
    return data;
  } catch {
    // DB unavailable (ECIRCUITBREAKER or other transient error).
    // Return cached data if available — it was verified from DB previously.
    if (cached) return cached;
    return null;
  }
}

/**
 * Cache-only session lookup — no DB query.
 * Used as ECIRCUITBREAKER fallback in authMiddleware: if getSession returns null
 * but we know DB is in cooldown, this lets previously-verified sessions survive.
 */
export function getSessionFromCacheOnly(sid: string): SessionData | null {
  return _memGet(sid) ?? _readCacheGet(sid);
}

export async function updateSession(
  sid: string,
  data: SessionData,
): Promise<void> {
  if (_memSessions.has(sid)) {
    _memSet(sid, data);
    return;
  }
  try {
    await db
      .update(sessionsTable)
      .set({
        sess: data as unknown as Record<string, unknown>,
        expire: new Date(Date.now() + SESSION_TTL),
      })
      .where(eq(sessionsTable.sid, sid));
  } catch {
    _memSet(sid, data);
  }
}

export async function deleteSession(sid: string): Promise<void> {
  _memDelete(sid);
  _readCacheDelete(sid);
  try {
    await db.delete(sessionsTable).where(eq(sessionsTable.sid, sid));
  } catch {
    // ignore — memory already cleared
  }
}

export async function clearSession(
  res: Response,
  sid?: string,
): Promise<void> {
  if (sid) await deleteSession(sid);
  res.clearCookie(SESSION_COOKIE, { path: "/" });
}

/**
 * Returns the session ID from the cookie only.
 * Use this for cookie-based auth (BizPortal / web login via Google OAuth / Replit OIDC).
 */
export function getSessionId(req: Request): string | undefined {
  return req.cookies?.[SESSION_COOKIE];
}

/**
 * Returns the raw Bearer token value from the Authorization header.
 * The value may be a session SID (mobile app) or a Supabase JWT (customer portal).
 * Use this instead of reading req.headers.authorization directly in auth paths.
 */
export function getBearerToken(req: Request): string | undefined {
  const auth = req.headers["authorization"];
  if (auth?.startsWith("Bearer ")) return auth.slice(7);
  return undefined;
}
