import { type Request, type Response, type NextFunction } from "express";
import { db, portalCustomersTable, userProfilesTable } from "@workspace/db";
import { eq } from "drizzle-orm";
import { verifySupabaseToken } from "./supabaseAdmin";
import { verifyPortalJwt } from "./portalJwt";
import { createHmac } from "crypto";

const IS_PROD =
  process.env.REPLIT_DEPLOYMENT === "1" || process.env.NODE_ENV === "production";
// Fallback ke hardcoded secret di non-production agar dev-login bekerja tanpa konfigurasi tambahan.
const DEV_SECRET = process.env.DEV_PORTAL_SECRET ?? (IS_PROD ? "" : "cst-dev-portal-fallback-2025");

export function signDevToken(payload: object): string {
  const b64 = Buffer.from(JSON.stringify(payload)).toString("base64url");
  const sig = createHmac("sha256", DEV_SECRET).update(b64).digest("hex");
  return `devportal.${b64}.${sig}`;
}

function verifyDevToken(token: string): { id: number; email: string; role: string } | null {
  if (IS_PROD) return null;
  if (!DEV_SECRET) return null; // explicitly unset → dev bypass disabled
  if (!token.startsWith("devportal.")) return null;
  const parts = token.split(".");
  if (parts.length !== 3) return null;
  const [, b64, sig] = parts;
  const expected = createHmac("sha256", DEV_SECRET).update(b64).digest("hex");
  if (sig !== expected) return null;
  try {
    const payload = JSON.parse(Buffer.from(b64, "base64url").toString("utf-8"));
    if (payload.exp && payload.exp < Date.now()) return null;
    return payload as { id: number; email: string; role: string };
  } catch { return null; }
}

export type PortalAuthReq = Request & { portalCustomerId: number; portalRole: string };

function rejectUnavailablePortalAccount(
  customer: { accountStatus?: string | null; sanctionUntil?: Date | string | null },
  res: Response,
): boolean {
  const status = customer.accountStatus ?? "active";
  if (status === "active") return false;
  const message = status === "sanctioned"
    ? "Akun terkena sanksi dan tidak dapat digunakan."
    : "Akun tidak aktif dan tidak dapat digunakan.";
  res.status(403).json({
    message,
    accountStatus: status,
    sanctionUntil: customer.sanctionUntil ?? null,
  });
  return true;
}

/**
 * Safely extract the email from a devportal.* token.
 * Returns null when:
 *   - Running in production (IS_PROD = true)
 *   - HMAC signature is invalid (forgery attempt)
 *   - Token is expired
 *   - Token is not a devportal.* token
 *
 * Use this instead of inline base64 decoding — the inline approach has NO
 * signature verification and allows anyone to forge any email.
 */
export function verifyDevPortalEmail(token: string): string | null {
  const payload = verifyDevToken(token);
  return payload?.email ?? null;
}

const PORTAL_ADMIN_EMAILS = [
  "admcst001@gmail.com",
  "wangsamasindo@gmail.com",
  ...(process.env.PORTAL_ADMIN_EMAILS ?? "").split(","),
]
  .map((e) => e.trim().toLowerCase())
  .filter(Boolean);

// ── Cookie config (C1-REMEDIATION) ───────────────────────────────────────────
// portal_session: HttpOnly, secure in prod — the actual JWT token.
// portal_session_hint: non-httponly — JS-readable signal that a session exists.
export const PORTAL_SESSION_COOKIE = "portal_session";
export const PORTAL_SESSION_HINT_COOKIE = "portal_session_hint";

/** Set HttpOnly portal session cookie + a non-httponly hint cookie on the response. */
export function setPortalSessionCookie(
  res: Response,
  token: string,
  maxAgeMs = 7 * 24 * 60 * 60 * 1000, // 7 days
): void {
  const secure = IS_PROD;
  const sameSite: "none" | "lax" = IS_PROD ? "none" : "lax";
  res.cookie(PORTAL_SESSION_COOKIE, token, {
    httpOnly: true,
    secure,
    sameSite,
    maxAge: maxAgeMs,
    path: "/",
  });
  // Non-httponly hint so frontend JS can detect an active cookie session without
  // being able to read the actual token. Value is always '1'.
  res.cookie(PORTAL_SESSION_HINT_COOKIE, "1", {
    httpOnly: false,
    secure,
    sameSite,
    maxAge: maxAgeMs,
    path: "/",
  });
}

/** Clear both portal session cookies on the response (logout). */
export function clearPortalSessionCookie(res: Response): void {
  const secure = IS_PROD;
  const sameSite: "none" | "lax" = IS_PROD ? "none" : "lax";
  res.clearCookie(PORTAL_SESSION_COOKIE, { path: "/", secure, sameSite });
  res.clearCookie(PORTAL_SESSION_HINT_COOKIE, { path: "/", secure, sameSite });
}

// ── requirePortalAuth ─────────────────────────────────────────────────────────
// C1-REMEDIATION: accepts HttpOnly cookie (portal_session) FIRST, then falls back
// to Bearer header for backward compatibility with legacy sessions.
// Legacy Bearer path retained until 2026-12-31 or next major release.
export async function requirePortalAuth(req: Request, res: Response, next: NextFunction) {
  const cookieToken = (req.cookies as Record<string, string> | undefined)?.[PORTAL_SESSION_COOKIE];
  const bearerToken = req.headers.authorization?.startsWith("Bearer ")
    ? req.headers.authorization.slice(7)
    : undefined;
  const token = cookieToken ?? bearerToken;

  if (!token) {
    res.status(401).json({ message: "Unauthorized" });
    return;
  }

  // 1) Dev token bypass (non-production only)
  const devPayload = verifyDevToken(token);
  if (devPayload) {
    const [customer] = await db
      .select()
      .from(portalCustomersTable)
      .where(eq(portalCustomersTable.id, devPayload.id));
    if (!customer) { res.status(401).json({ message: "Dev user not found" }); return; }
    if (rejectUnavailablePortalAccount(customer, res)) return;
    (req as PortalAuthReq).portalCustomerId = customer.id;
    (req as PortalAuthReq).portalRole = customer.role;
    next();
    return;
  }

  // 2) Our own portal JWT
  const portalPayload = await verifyPortalJwt(token);
  if (portalPayload) {
    const [customer] = await db
      .select()
      .from(portalCustomersTable)
      .where(eq(portalCustomersTable.id, portalPayload.customerId));
    if (!customer) { res.status(401).json({ message: "Customer not found" }); return; }
    if (rejectUnavailablePortalAccount(customer, res)) return;
    (req as PortalAuthReq).portalCustomerId = customer.id;
    (req as PortalAuthReq).portalRole = customer.role;
    next();
    return;
  }

  // 3) Supabase token fallback
  const supabaseUser = await verifySupabaseToken(token);
  if (!supabaseUser?.email) {
    res.status(401).json({ message: "Invalid or expired token" });
    return;
  }

  let [customer] = await db
    .select()
    .from(portalCustomersTable)
    .where(eq(portalCustomersTable.email, supabaseUser.email));

  if (!customer) {
    const meta = supabaseUser.user_metadata ?? {};
    const isAdmin = PORTAL_ADMIN_EMAILS.includes(supabaseUser.email.toLowerCase());
    const role = isAdmin ? "admin" : "customer";
    const [created] = await db
      .insert(portalCustomersTable)
      .values({
        name: (meta.name as string) || (meta.full_name as string) || supabaseUser.email.split("@")[0],
        email: supabaseUser.email,
        passwordHash: "",
        phone: (meta.phone as string) || null,
        company: (meta.company as string) || null,
        role,
      })
      .returning();
    customer = created;
  } else {
    const emailLower = supabaseUser.email.toLowerCase();
    if (PORTAL_ADMIN_EMAILS.includes(emailLower) && customer.role !== "admin") {
      await db.update(portalCustomersTable).set({ role: "admin" }).where(eq(portalCustomersTable.id, customer.id));
      customer = { ...customer, role: "admin" };
    }
  }

  if (rejectUnavailablePortalAccount(customer, res)) return;
  (req as PortalAuthReq).portalCustomerId = customer.id;
  (req as PortalAuthReq).portalRole = customer.role;
  next();
}

/**
 * Customer-private portal routes must not be reachable by vendor/admin sessions.
 *
 * Keep requirePortalAuth separate because shared endpoints such as /auth/me and
 * /me/dashboard-stats intentionally support multiple portal roles.
 */
export async function requireCustomerPortalAuth(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  await requirePortalAuth(req, res, () => {
    if ((req as PortalAuthReq).portalRole !== "customer") {
      res.status(403).json({ message: "Akses customer diperlukan" });
      return;
    }
    next();
  });
}

// ── requirePortalAdmin ────────────────────────────────────────────────────────
// C1-REMEDIATION: accepts HttpOnly cookie first, then Bearer fallback.
export async function requirePortalAdmin(req: Request, res: Response, next: NextFunction) {
  // Allow BizPortal internal staff session (cookie-based) as admin too
  if (req.isAuthenticated && req.isAuthenticated() && (req as Request & { isInternalSession?: boolean }).isInternalSession) {
    const u = req.user as { id?: string; role?: string | null } | undefined;
    if (u && (u.role === "admin" || u.role === "owner" || u.role === "staff" || u.role === "manager")) {
      (req as PortalAuthReq).portalCustomerId = 0;
      (req as PortalAuthReq).portalRole = "admin";
      next();
      return;
    }
  }

  const cookieToken = (req.cookies as Record<string, string> | undefined)?.[PORTAL_SESSION_COOKIE];
  const bearerToken = req.headers.authorization?.startsWith("Bearer ")
    ? req.headers.authorization.slice(7)
    : undefined;
  const token = cookieToken ?? bearerToken;

  if (!token) {
    res.status(401).json({ message: "Unauthorized" });
    return;
  }

  // 1) Dev token bypass
  const devPayload = verifyDevToken(token);
  if (devPayload) {
    const [customer] = await db
      .select()
      .from(portalCustomersTable)
      .where(eq(portalCustomersTable.id, devPayload.id));
    if (!customer || customer.role !== "admin") {
      res.status(403).json({ message: "Akses admin diperlukan" });
      return;
    }
    if (rejectUnavailablePortalAccount(customer, res)) return;
    (req as PortalAuthReq).portalCustomerId = customer.id;
    (req as PortalAuthReq).portalRole = customer.role;
    next();
    return;
  }

  // 2) Our own portal JWT
  const portalPayload = await verifyPortalJwt(token);
  if (portalPayload) {
    const [customer] = await db
      .select()
      .from(portalCustomersTable)
      .where(eq(portalCustomersTable.id, portalPayload.customerId));
    if (!customer || customer.role !== "admin") {
      res.status(403).json({ message: "Akses admin diperlukan" });
      return;
    }
    if (rejectUnavailablePortalAccount(customer, res)) return;
    (req as PortalAuthReq).portalCustomerId = customer.id;
    (req as PortalAuthReq).portalRole = customer.role;
    next();
    return;
  }

  // 3) Supabase token fallback
  const supabaseUser = await verifySupabaseToken(token);
  if (!supabaseUser?.email) {
    res.status(401).json({ message: "Invalid or expired token" });
    return;
  }

  const emailLower = supabaseUser.email.toLowerCase();
  // [C10-FIX] Always enforce email allowlist — remove conditional that could bypass the check
  // when adminListConfigured=false. PORTAL_ADMIN_EMAILS always has at least hardcoded entries.
  if (!PORTAL_ADMIN_EMAILS.includes(emailLower)) {
    res.status(403).json({ message: "Akses admin diperlukan" });
    return;
  }

  const [customer] = await db
    .select()
    .from(portalCustomersTable)
    .where(eq(portalCustomersTable.email, supabaseUser.email));

  if (!customer || customer.role !== "admin") {
    res.status(403).json({ message: "Akses admin diperlukan" });
    return;
  }
  if (rejectUnavailablePortalAccount(customer, res)) return;

  (req as PortalAuthReq).portalCustomerId = customer.id;
  (req as PortalAuthReq).portalRole = customer.role;
  next();
}

/**
 * requireActiveVendor — chain AFTER requirePortalAuth.
 *
 * Guards vendor-operational routes against accounts that submitted onboarding
 * but have not yet been approved by admin. Problem: onboarding/complete sets
 * portal_customers.role = 'vendor' BEFORE admin approval, so requirePortalAuth
 * alone grants portalRole='vendor' to pending accounts.
 *
 * This middleware enforces the additional invariant:
 *   user_profiles.status = 'active'   (set only by PATCH /admin/approvals/:id)
 *
 * Returns 403 when status is 'pending' or 'rejected'.
 */
export async function requireActiveVendor(req: Request, res: Response, next: NextFunction): Promise<void> {
  const customerId = (req as PortalAuthReq).portalCustomerId;
  if (!customerId) {
    res.status(401).json({ message: "Unauthorized" });
    return;
  }
  try {
    const [up] = await db
      .select({ status: userProfilesTable.status })
      .from(userProfilesTable)
      .where(eq(userProfilesTable.customerId, customerId));
    if (up?.status !== "active") {
      res.status(403).json({
        message: "Akun belum aktif. Menunggu persetujuan admin.",
        profileStatus: up?.status ?? "unknown",
      });
      return;
    }
    next();
  } catch {
    res.status(500).json({ message: "Gagal memverifikasi status akun" });
  }
}
