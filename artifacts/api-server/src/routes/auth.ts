import * as oidc from "openid-client";
import { OAuth2Client } from "google-auth-library";
import { Router, type IRouter, type Request, type Response } from "express";
import crypto, { randomUUID } from "crypto";
import bcrypt from "bcryptjs";
import {
  GetCurrentAuthUserResponse,
  ExchangeMobileAuthorizationCodeBody,
  ExchangeMobileAuthorizationCodeResponse,
  LogoutMobileSessionResponse,
} from "@workspace/api-zod";
import { db } from "@workspace/db";
import { usersTable, waOtpCodesTable, portalCustomersTable } from "@workspace/db";
import { and, desc, eq, gte, ne, sql } from "drizzle-orm";
import {
  saveOauthState,
  consumeOauthState,
  OAuthStateStorageError,
} from "../lib/oauthStateMigration";
import { sendViaService as sendWhatsApp } from "../lib/waTransport.js";
import {
  clearSession,
  getOidcConfig,
  getSessionId,
  getBearerToken,
  createSession,
  deleteSession,
  SESSION_COOKIE,
  SESSION_TTL,
  ISSUER_URL,
  type SessionData,
} from "../lib/auth";
import { writeAuditLog, extractRequestMeta } from "../lib/auditLog.js";
import { trackSuspiciousActivity } from "../lib/suspiciousActivity.js";
import { verifySupabaseToken } from "../lib/supabaseAdmin";
import { signPortalJwt } from "../lib/portalJwt.js";
import { setPortalSessionCookie } from "../lib/supabaseAuth.js";
import { linkPortalGoogleIdentity } from "../lib/services/portalIdentityService.js";
import {
  decodeGoogleOAuthContext,
  encodeGoogleOAuthContext,
  getGoogleOAuthCallbackContext,
  getGoogleOAuthFailureRedirect,
  type GoogleOAuthFlow,
} from "../lib/googleOAuthRouting.js";

const GOOGLE_CLIENT_ID = process.env.GOOGLE_CLIENT_ID!;
const GOOGLE_CLIENT_SECRET = process.env.GOOGLE_CLIENT_SECRET!;

// Startup diagnostic intentionally reports presence only. Never log credential
// fragments or lengths because logs are retained outside the application.
console.log(
  `[Google OAuth] client_id configured: ${Boolean(GOOGLE_CLIENT_ID)}` +
  ` | client_secret configured: ${Boolean(GOOGLE_CLIENT_SECRET)}`
);

function getGoogleOAuthClient(redirectUri: string) {
  return new OAuth2Client(GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET, redirectUri);
}

const OIDC_COOKIE_TTL = 10 * 60 * 1000;

const router: IRouter = Router();

type GoogleOAuthFailureCategory =
  | "STATE_MISSING"
  | "STATE_INVALID"
  | "STATE_EXPIRED"
  | "STATE_STORAGE_FAILURE"
  | "CODE_MISSING"
  | "TOKEN_EXCHANGE_FAILED"
  | "GOOGLE_PROFILE_FAILED"
  | "EMAIL_MISSING"
  | "ACCOUNT_RESOLUTION_FAILED"
  | "ACCOUNT_NOT_ALLOWED"
  | "SESSION_CREATION_FAILED"
  | "COOKIE_FAILED"
  | "FINAL_REDIRECT_FAILED";

type GoogleOAuthStage =
  | "STATE_VALIDATION"
  | "TOKEN_EXCHANGE"
  | "ID_TOKEN_VERIFICATION"
  | "GOOGLE_PROFILE"
  | "ACCOUNT_LOOKUP"
  | "ACCOUNT_CREATE"
  | "ACCOUNT_LINK"
  | "SESSION_JWT"
  | "COOKIE_SET"
  | "FINAL_REDIRECT";

type GoogleOAuthStageOutcome = "started" | "passed" | "failed";

type GoogleOAuthStageDetails = {
  result?: string;
  providerStatus?: number;
  providerCode?: string;
};

type GoogleOAuthFailureDetails = Pick<
  GoogleOAuthStageDetails,
  "providerStatus" | "providerCode"
>;

const googleOAuthFailureStages: Record<GoogleOAuthFailureCategory, GoogleOAuthStage> = {
  STATE_MISSING: "STATE_VALIDATION",
  STATE_INVALID: "STATE_VALIDATION",
  STATE_EXPIRED: "STATE_VALIDATION",
  STATE_STORAGE_FAILURE: "STATE_VALIDATION",
  CODE_MISSING: "TOKEN_EXCHANGE",
  TOKEN_EXCHANGE_FAILED: "TOKEN_EXCHANGE",
  GOOGLE_PROFILE_FAILED: "GOOGLE_PROFILE",
  EMAIL_MISSING: "GOOGLE_PROFILE",
  ACCOUNT_RESOLUTION_FAILED: "ACCOUNT_LOOKUP",
  ACCOUNT_NOT_ALLOWED: "ACCOUNT_LOOKUP",
  SESSION_CREATION_FAILED: "SESSION_JWT",
  COOKIE_FAILED: "COOKIE_SET",
  FINAL_REDIRECT_FAILED: "FINAL_REDIRECT",
};

// A callback can classify its failure before throwing to the common redirect
// handler. Preserve that category so diagnostics keep the actual failed stage.
const classifiedGoogleOAuthFailures = new WeakSet<Request>();

const sensitiveOAuthErrorValue = /\b(authorization[_-]?code|access[_-]?token|refresh[_-]?token|id[_-]?token|client[_-]?secret|session[_-]?secret|portal_session|sid|state)\s*([=:])\s*([^\s,;]+)/gi;
const jwtLikeValue = /\beyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\b/g;

function getSanitizedOAuthErrorDetails(error: unknown): {
  errorName: string;
  errorMessage: string;
} | undefined {
  if (!(error instanceof Error)) return undefined;

  const errorName = /^[A-Za-z][A-Za-z0-9_.:-]{0,80}$/.test(error.name)
    ? error.name
    : "Error";
  const errorMessage = error.message
    .replace(sensitiveOAuthErrorValue, "$1$2[redacted]")
    .replace(/\bBearer\s+[A-Za-z0-9._~-]+/gi, "Bearer [redacted]")
    .replace(jwtLikeValue, "[redacted-jwt]")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 300);

  return {
    errorName,
    errorMessage: errorMessage || "No error message",
  };
}

function safeProviderCode(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  return /^[a-z][a-z0-9_]{0,63}$/.test(value) ? value : undefined;
}

function logGoogleOAuthStage(
  req: Request,
  flow: GoogleOAuthFlow | "unknown",
  stage: GoogleOAuthStage,
  outcome: GoogleOAuthStageOutcome,
  details: GoogleOAuthStageDetails = {},
): void {
  const payload = { flow, stage, outcome, ...details };
  if (outcome === "failed") {
    req.log.warn(payload, `[Google OAuth] ${stage} failed`);
  } else {
    req.log.info(payload, `[Google OAuth] ${stage} ${outcome}`);
  }
}

function logGoogleOAuthFailure(
  req: Request,
  category: GoogleOAuthFailureCategory,
  _error?: unknown,
  details: GoogleOAuthFailureDetails = {},
): void {
  // Never include authorization codes, OAuth state, tokens, JWTs, session IDs,
  // cookie values, or client secrets in callback diagnostics.
  classifiedGoogleOAuthFailures.add(req);
  const errorDetails = getSanitizedOAuthErrorDetails(_error);
  req.log.error(
    {
      category,
      failingStage: googleOAuthFailureStages[category],
      ...details,
      ...errorDetails,
    },
    "[Google OAuth] callback failed",
  );
}

function getOrigin(req: Request): string {
  const proto = req.headers["x-forwarded-proto"] || "https";
  const host =
    req.headers["x-forwarded-host"] || req.headers["host"] || "localhost";
  return `${proto}://${host}`;
}

function getSafeReturnTo(value: unknown): string {
  if (value === "popup") return "popup";
  if (typeof value !== "string" || !value.startsWith("/") || value.startsWith("//")) {
    return "/";
  }
  return value;
}

const CUSTOMER_PORTAL_GOOGLE_HOSTS = new Set([
  "cstlogistic.co.id",
  "www.cstlogistic.co.id",
]);

function getRequestHost(req: Request): string {
  const forwardedHost = String(req.headers["x-forwarded-host"] || "");
  const host = (forwardedHost || String(req.headers["host"] || ""))
    .split(",")[0]
    .trim()
    .toLowerCase();
  return host.replace(/:\d+$/, "");
}

function getGoogleOrigin(req: Request, preferCustomerPortalHost = false): string {
  // Customer Portal is reached through the verified public domain. Do not let a
  // stale GOOGLE_REDIRECT_BASE_URL from the Replit deployment override the host
  // that the customer actually used, otherwise Google rejects the request with
  // redirect_uri_mismatch.
  const requestHost = getRequestHost(req);
  if (preferCustomerPortalHost) {
    // The OAuth request and callback must use one canonical origin. In
    // production the API may receive the request through the Replit deployment
    // hostname even when the browser entered via the custom domain, so using
    // req.host here can produce a redirect URI that is not registered in
    // Google Cloud. Keep www support, but never fall back to a Replit host for
    // the public portal flow.
    if (requestHost === "www.cstlogistic.co.id") {
      return "https://www.cstlogistic.co.id";
    }
    if (requestHost === "cstlogistic.co.id" || !requestHost) {
      return "https://cstlogistic.co.id";
    }
    return "https://cstlogistic.co.id";
  }

  // In Replit dev (NOT deployed), always prefer the stable dev domain.
  // REPLIT_DEPLOYMENT=1 is injected by Replit in deployed environments only.
  if (process.env.REPLIT_DEV_DOMAIN && !process.env.REPLIT_DEPLOYMENT) {
    return `https://${process.env.REPLIT_DEV_DOMAIN}`;
  }
  // Explicit override takes priority — allows admins to pin the redirect URI to a
  // specific registered domain (e.g. https://cstlogistic.co.id) so it always
  // matches what is registered in Google Cloud Console, regardless of which host
  // the request arrives on (custom domain, replit.app, etc.).
  const override = process.env.GOOGLE_REDIRECT_BASE_URL || process.env.GOOGLE_CALLBACK_ORIGIN;
  if (override) {
    return override.replace(/\/$/, "");
  }
  // Fallback: use the actual request host dynamically.
  const origin = getOrigin(req);
  const host = String(req.headers["x-forwarded-host"] || req.headers["host"] || "");
  if (host && !host.startsWith("localhost") && !host.startsWith("127.")) {
    return `https://${host.split(",")[0].trim()}`;
  }
  if (process.env.APP_URL) {
    return process.env.APP_URL.replace(/\/$/, "");
  }
  return origin;
}

function setSessionCookie(res: Response, sid: string) {
  // In the Replit dev environment the BizPortal frontend runs inside a
  // cross-site iframe (top-level: replit.com, API/app: *.replit.dev).
  // SameSite=Lax blocks cookies on cross-site fetch requests, which makes
  // /api/auth/user always return {user:null} inside the preview pane.
  // We use SameSite=None (which still requires Secure=true) so the session
  // cookie is included in credentialed fetch calls from the iframe.
  // In production (REPLIT_DEPLOYMENT=1) we revert to Lax for CSRF safety.
  const isReplitDev = !!process.env.REPLIT_DEV_DOMAIN && !process.env.REPLIT_DEPLOYMENT;
  res.cookie(SESSION_COOKIE, sid, {
    httpOnly: true,
    secure: true,
    sameSite: isReplitDev ? "none" : "lax",
    path: "/",
    maxAge: SESSION_TTL,
  });
}

function setOidcCookie(res: Response, name: string, value: string) {
  res.cookie(name, value, {
    httpOnly: true,
    secure: true,
    // Same reasoning as setSessionCookie above. The OIDC state/nonce cookies
    // are consumed by the Google callback (a top-level GET navigation) which
    // "lax" permits.
    sameSite: "lax",
    path: "/",
    maxAge: OIDC_COOKIE_TTL,
  });
}

async function upsertUser(claims: Record<string, unknown>) {
  const id = claims.sub as string;
  const email = (claims.email as string) || "";
  const firstName = (claims.first_name as string) || null;
  const lastName = (claims.last_name as string) || null;
  const profileImageUrl = ((claims.profile_image_url || claims.picture) as string) || null;
  const name = [firstName, lastName].filter(Boolean).join(" ") || email.split("@")[0] || id;

  // Remove any stale user rows with the same email but a different id
  // (e.g. leftover Clerk users after migration). No FK constraints on users.id
  // so this is safe.
  if (email) {
    await db
      .delete(usersTable)
      .where(and(eq(usersTable.email, email), ne(usersTable.id, id)));
  }

  // Auto-promote to admin if email matches hardcoded list or ADMIN_EMAIL/ADMIN_EMAILS env var
  const adminEmails = [
    "admcst001@gmail.com",
    "divatranssoetta@gmail.com",
    ...(process.env.ADMIN_EMAIL ?? "").split(","),
    ...(process.env.ADMIN_EMAILS ?? "").split(","),
  ]
    .map((e) => e.trim().toLowerCase())
    .filter(Boolean);
  const isAdmin = adminEmails.includes(email.toLowerCase());

  const [user] = await db
    .insert(usersTable)
    .values({
      id,
      email,
      name,
      firstName,
      lastName,
      profileImageUrl,
      role: isAdmin ? ("admin" as const) : ("ecommerce" as const),
    })
    .onConflictDoUpdate({
      target: usersTable.id,
      set: {
        email,
        name,
        firstName,
        lastName,
        profileImageUrl,
        updatedAt: new Date(),
        // Promote to admin if configured, but never demote existing role
        ...(isAdmin ? { role: "admin" as const } : {}),
      },
    })
    .returning();
  return user;
}

/**
 * Google OAuth for the public Customer Portal must end in a portal JWT/cookie,
 * not the internal `sid` session used by BizPortal. This keeps the portal
 * account model independent from Supabase Auth's external-provider exchange.
 */
type PortalGoogleAccountStageObserver = (
  stage: Extract<GoogleOAuthStage, "ACCOUNT_LOOKUP" | "ACCOUNT_CREATE" | "ACCOUNT_LINK">,
  outcome: GoogleOAuthStageOutcome,
  details?: GoogleOAuthStageDetails,
) => void;

async function upsertPortalGoogleCustomer(
  claims: Record<string, unknown>,
  observeStage?: PortalGoogleAccountStageObserver,
) {
  const email = String(claims.email ?? "").trim().toLowerCase();
  if (!email) throw new Error("Google account did not provide an email");

  const googleId = String(claims.sub ?? "");
  const givenName = String(claims.first_name ?? "").trim();
  const familyName = String(claims.last_name ?? "").trim();
  const name = [givenName, familyName].filter(Boolean).join(" ") || email.split("@")[0];
  const avatarUrl = String(claims.picture ?? "").trim() || null;
  const portalAdminEmails = [
    "admcst001@gmail.com",
    "wangsamasindo@gmail.com",
    ...(process.env.PORTAL_ADMIN_EMAILS ?? "").split(","),
  ].map((value) => value.trim().toLowerCase()).filter(Boolean);
  const role = portalAdminEmails.includes(email) ? "admin" : "customer";

  observeStage?.("ACCOUNT_LOOKUP", "started");
  let customer;
  try {
    [customer] = await db
      .select()
      .from(portalCustomersTable)
      .where(eq(portalCustomersTable.email, email))
      .limit(1);
  } catch (error) {
    observeStage?.("ACCOUNT_LOOKUP", "failed", { result: "database_error" });
    throw error;
  }

  if (!customer) {
    observeStage?.("ACCOUNT_LOOKUP", "passed", { result: "not_found" });
    observeStage?.("ACCOUNT_CREATE", "started");
    try {
      [customer] = await db
        .insert(portalCustomersTable)
        .values({
          name,
          email,
          passwordHash: "",
          role,
          oauthProvider: "google",
          oauthId: googleId || null,
          avatarUrl,
        })
        .returning();
      observeStage?.("ACCOUNT_CREATE", "passed", {
        result: customer ? "created" : "empty_result",
      });
    } catch (error) {
      // Concurrent first login: the other request may have inserted the row.
      try {
        [customer] = await db
          .select()
          .from(portalCustomersTable)
          .where(eq(portalCustomersTable.email, email))
          .limit(1);
      } catch {
        observeStage?.("ACCOUNT_CREATE", "failed", { result: "recovery_failed" });
        throw error;
      }
      observeStage?.("ACCOUNT_CREATE", customer ? "passed" : "failed", {
        result: customer ? "concurrent_existing" : "insert_failed",
      });
    }
  } else {
    observeStage?.("ACCOUNT_LOOKUP", "passed", { result: "existing" });
    observeStage?.("ACCOUNT_LINK", "started");
    try {
      if (
        customer.oauthProvider === "google"
        && customer.oauthId
        && googleId
        && customer.oauthId !== googleId
      ) {
        throw new Error("Portal account already has a different Google identity");
      }
      await linkPortalGoogleIdentity(customer.id, googleId);
      const [updated] = await db
        .update(portalCustomersTable)
        .set({
          oauthProvider: "google",
          oauthId: googleId || customer.oauthId,
          ...(avatarUrl ? { avatarUrl } : {}),
          ...(role === "admin" && customer.role !== "admin" ? { role } : {}),
        })
        .where(eq(portalCustomersTable.id, customer.id))
        .returning();
      customer = updated ?? customer;
      observeStage?.("ACCOUNT_LINK", "passed", {
        result: updated ? "linked" : "unchanged",
      });
    } catch (error) {
      observeStage?.("ACCOUNT_LINK", "failed", { result: "database_error" });
      throw error;
    }
  }

  if (!customer) {
    observeStage?.("ACCOUNT_CREATE", "failed", { result: "empty_result" });
    throw new Error("Unable to create portal customer");
  }
  if (
    customer.oauthProvider === "google"
    && customer.oauthId
    && googleId
    && customer.oauthId !== googleId
  ) {
    throw new Error("Portal account already has a different Google identity");
  }
  if (googleId) {
    await linkPortalGoogleIdentity(customer.id, googleId);
  }
  if ((customer.accountStatus ?? "active") !== "active") {
    observeStage?.("ACCOUNT_LOOKUP", "failed", { result: "account_not_active" });
    throw new Error("Portal account is not active");
  }
  return customer;
}

router.get("/auth/user", (req: Request, res: Response) => {
  res.json(
    GetCurrentAuthUserResponse.parse({
      user: req.isAuthenticated() ? req.user : null,
    }),
  );
});

router.get("/login", async (req: Request, res: Response) => {
  const config = await getOidcConfig();
  const callbackUrl = `${getOrigin(req)}/api/callback`;

  const returnTo = getSafeReturnTo(req.query.returnTo);

  const state = oidc.randomState();
  const nonce = oidc.randomNonce();
  const codeVerifier = oidc.randomPKCECodeVerifier();
  const codeChallenge = await oidc.calculatePKCECodeChallenge(codeVerifier);

  const redirectTo = oidc.buildAuthorizationUrl(config, {
    redirect_uri: callbackUrl,
    scope: "openid email profile offline_access",
    code_challenge: codeChallenge,
    code_challenge_method: "S256",
    prompt: "login consent",
    state,
    nonce,
  });

  setOidcCookie(res, "code_verifier", codeVerifier);
  setOidcCookie(res, "nonce", nonce);
  setOidcCookie(res, "state", state);
  setOidcCookie(res, "return_to", returnTo);

  res.redirect(redirectTo.href);
});

// Query params are not validated because the OIDC provider may include
// parameters not expressed in the schema.
router.get("/callback", async (req: Request, res: Response) => {
  const config = await getOidcConfig();
  const callbackUrl = `${getOrigin(req)}/api/callback`;

  const codeVerifier = req.cookies?.code_verifier;
  const nonce = req.cookies?.nonce;
  const expectedState = req.cookies?.state;

  if (!codeVerifier || !expectedState) {
    res.redirect("/api/login");
    return;
  }

  const currentUrl = new URL(
    `${callbackUrl}?${new URL(req.url, `http://${req.headers.host}`).searchParams}`,
  );

  let tokens: oidc.TokenEndpointResponse & oidc.TokenEndpointResponseHelpers;
  try {
    tokens = await oidc.authorizationCodeGrant(config, currentUrl, {
      pkceCodeVerifier: codeVerifier,
      expectedNonce: nonce,
      expectedState,
      idTokenExpected: true,
    });
  } catch {
    res.redirect("/api/login");
    return;
  }

  const returnTo = getSafeReturnTo(req.cookies?.return_to);

  res.clearCookie("code_verifier", { path: "/" });
  res.clearCookie("nonce", { path: "/" });
  res.clearCookie("state", { path: "/" });
  res.clearCookie("return_to", { path: "/" });

  const claims = tokens.claims();
  if (!claims) {
    res.redirect("/api/login");
    return;
  }

  const dbUser = await upsertUser(
    claims as unknown as Record<string, unknown>,
  );

  const now = Math.floor(Date.now() / 1000);
  const sessionData: SessionData = {
    user: {
      id: dbUser.id,
      email: dbUser.email,
      firstName: dbUser.firstName,
      lastName: dbUser.lastName,
      profileImageUrl: dbUser.profileImageUrl,
      role: dbUser.role ?? null,
      companyId: dbUser.companyId ?? null,
    },
    access_token: tokens.access_token,
    refresh_token: tokens.refresh_token,
    expires_at: tokens.expiresIn() ? now + tokens.expiresIn()! : claims.exp,
  };

  const sid = await createSession(sessionData);
  setSessionCookie(res, sid);
  res.redirect(returnTo);
});

// ─── Supabase Token Exchange → Session Cookie ─────────────────────────────────
// BizPortal frontend melakukan Supabase Google OAuth via popup, lalu POST token
// ke sini untuk mendapat session cookie (supaya semua API call tetap pakai cookie).

router.post("/auth/supabase-exchange", async (req: Request, res: Response) => {
  const { access_token } = req.body as { access_token?: string };
  if (!access_token || typeof access_token !== "string") {
    res.status(400).json({ error: "access_token required" });
    return;
  }

  const supabaseUser = await verifySupabaseToken(access_token);
  if (!supabaseUser?.email) {
    const _metaSE = extractRequestMeta(req);
    writeAuditLog({
      action:    "FAILED_LOGIN",
      module:    "auth",
      ipAddress: _metaSE.ipAddress,
      userAgent: _metaSE.userAgent,
      newData:   { method: "supabase-exchange", reason: "invalid_or_expired_token" },
    });
    trackSuspiciousActivity("failed_login", _metaSE.ipAddress);
    res.status(401).json({ error: "Invalid or expired token" });
    return;
  }

  // Cari user di DB berdasarkan email (handle migrasi dari id "google_<sub>")
  let [dbUser] = await db
    .select()
    .from(usersTable)
    .where(eq(usersTable.email, supabaseUser.email));

  const _adminEmailsSE = [
    "admcst001@gmail.com",
    "divatranssoetta@gmail.com",
    ...(process.env.ADMIN_EMAIL ?? "").split(","),
    ...(process.env.ADMIN_EMAILS ?? "").split(","),
  ].map((e) => e.trim().toLowerCase()).filter(Boolean);
  const _isAdminSE = _adminEmailsSE.includes(supabaseUser.email.toLowerCase());

  if (!dbUser) {
    const meta = supabaseUser.user_metadata ?? {};

    const firstName =
      (meta.given_name as string) ||
      (meta.full_name as string)?.split(" ")[0] ||
      null;
    const lastName =
      (meta.family_name as string) ||
      (meta.full_name as string)?.split(" ").slice(1).join(" ") ||
      null;
    const profileImageUrl =
      (meta.avatar_url as string) || (meta.picture as string) || null;

    try {
      const [created] = await db
        .insert(usersTable)
        .values({
          id: supabaseUser.id,
          email: supabaseUser.email,
          firstName,
          lastName,
          profileImageUrl,
          role: _isAdminSE ? "admin" : "ecommerce",
        })
        .returning();
      dbUser = created;
    } catch {
      // Race condition — coba select lagi
      const [retry] = await db
        .select()
        .from(usersTable)
        .where(eq(usersTable.email, supabaseUser.email));
      if (!retry) {
        res.status(500).json({ error: "Failed to create user" });
        return;
      }
      dbUser = retry;
    }
  }

  // Promote existing user to admin jika email ada di allowlist tapi role belum admin
  if (dbUser && _isAdminSE && dbUser.role !== "admin") {
    const [promoted] = await db
      .update(usersTable)
      .set({ role: "admin" })
      .where(eq(usersTable.id, dbUser.id))
      .returning();
    if (promoted) dbUser = promoted;
  }

  const now = Math.floor(Date.now() / 1000);
  const sessionData: SessionData = {
    user: {
      id: dbUser.id,
      email: dbUser.email,
      firstName: dbUser.firstName,
      lastName: dbUser.lastName,
      profileImageUrl: dbUser.profileImageUrl,
      role: dbUser.role ?? null,
      companyId: dbUser.companyId ?? null,
    },
    access_token,
    expires_at: now + 3600,
  };

  const sid = await createSession(sessionData);
  setSessionCookie(res, sid);

  const _meta = extractRequestMeta(req);
  writeAuditLog({
    companyId: dbUser.companyId ?? null,
    userId: dbUser.id,
    userEmail: dbUser.email ?? null,
    action: "login",
    module: "auth",
    referenceId: "supabase-exchange",
    newData: { email: dbUser.email, role: dbUser.role },
    ipAddress: _meta.ipAddress,
    userAgent: _meta.userAgent,
  });

  res.json({
    user: {
      id: dbUser.id,
      email: dbUser.email,
      firstName: dbUser.firstName,
      lastName: dbUser.lastName,
      profileImageUrl: dbUser.profileImageUrl,
      role: dbUser.role,
    },
  });
});

// ─── Dev Login Bypass (dev only, disabled in production) ──────────────────────

router.post("/auth/dev-login", async (req: Request, res: Response) => {
  if (process.env.REPLIT_DEPLOYMENT) {
    res.status(403).json({ error: "Not available in production" });
    return;
  }

  const { email } = req.body as { email?: string };
  if (!email || typeof email !== "string" || !email.includes("@")) {
    res.status(400).json({ error: "email wajib diisi" });
    return;
  }

  const normalizedEmail = email.trim().toLowerCase();

  const adminEmails = [
    ...(process.env.ADMIN_EMAIL ?? "").split(","),
    ...(process.env.ADMIN_EMAILS ?? "").split(","),
  ]
    .map((e) => e.trim().toLowerCase())
    .filter(Boolean);
  const isAdmin = adminEmails.length === 0 || adminEmails.includes(normalizedEmail);
  const parts = normalizedEmail.split("@")[0].split(".");
  const firstName = parts[0] ? parts[0].charAt(0).toUpperCase() + parts[0].slice(1) : "Dev";
  const lastName = parts[1] ? parts[1].charAt(0).toUpperCase() + parts[1].slice(1) : "User";

  // Build a synthetic user as fallback when DB is unavailable
  const syntheticUser = {
    id: `dev_${crypto.randomBytes(8).toString("hex")}`,
    email: normalizedEmail,
    name: `${firstName} ${lastName}`.trim(),
    firstName,
    lastName,
    role: isAdmin ? "admin" : "ecommerce",
    profileImageUrl: null as string | null,
    companyId: null as number | null,
  };

  let dbUser: { id: string; email: string | null; firstName: string | null; lastName: string | null; profileImageUrl: string | null; role?: string | null; companyId?: number | null; name?: string | null };

  // Race DB lookup against a 4-second timeout so slow DB connections fall back
  // to a synthetic user instead of making the browser abort the request.
  const dbTimeout = new Promise<never>((_, reject) =>
    setTimeout(() => reject(new Error("dev-login db timeout")), 4000)
  );
  try {
    dbUser = await Promise.race([
      (async () => {
        let [found] = await db.select().from(usersTable).where(eq(usersTable.email, normalizedEmail));
        if (!found) {
          try {
            const [created] = await db.insert(usersTable).values({
              id: syntheticUser.id,
              email: normalizedEmail,
              name: syntheticUser.name,
              firstName,
              lastName,
              role: syntheticUser.role as "admin" | "ecommerce" | "trading" | "logistics",
            }).returning();
            found = created;
          } catch {
            const [retry] = await db.select().from(usersTable).where(eq(usersTable.email, normalizedEmail));
            found = retry;
          }
        }
        // Jika email ada di ADMIN_EMAIL tapi role di DB bukan admin, update sekarang
        if (found && isAdmin && found.role !== "admin") {
          const [updated] = await db.update(usersTable).set({ role: "admin" }).where(eq(usersTable.id, found.id)).returning();
          if (updated) found = updated;
        }
        return found ?? syntheticUser;
      })(),
      dbTimeout,
    ]);
  } catch {
    // DB unavailable or timed out — use synthetic user (session stored in memory)
    dbUser = syntheticUser;
  }

  const sessionData: SessionData = {
    user: {
      id: dbUser.id,
      email: dbUser.email,
      firstName: dbUser.firstName,
      lastName: dbUser.lastName,
      profileImageUrl: dbUser.profileImageUrl,
      role: dbUser.role,
    },
    access_token: `dev_${crypto.randomBytes(16).toString("hex")}`,
    expires_at: Math.floor(Date.now() / 1000) + SESSION_TTL / 1000,
  };

  const sid = await createSession(sessionData);
  setSessionCookie(res, sid);
  res.json({
    user: {
      id: dbUser.id,
      email: dbUser.email,
      firstName: dbUser.firstName,
      lastName: dbUser.lastName,
      profileImageUrl: dbUser.profileImageUrl,
      role: dbUser.role,
    },
  });
});

// ─── Google OAuth ─────────────────────────────────────────────────────────────

router.get("/login/google", async (req: Request, res: Response) => {
  if (!GOOGLE_CLIENT_ID || !GOOGLE_CLIENT_SECRET) {
    req.log.error("[Google OAuth] production credentials are not configured");
    res.status(503).send("Login Google sedang tidak tersedia. Hubungi admin.");
    return;
  }
  const returnTo = typeof req.query.returnTo === "string" ? req.query.returnTo : "/";
  const state = crypto.randomBytes(16).toString("hex");
  const isPortalFlow = req.query.portal === "1";
  const redirectUri = `${getGoogleOrigin(req, isPortalFlow)}/api/callback/google`;

  req.log.info({ redirectUri }, "[Google OAuth] initiating login, redirect_uri");

  // Store state in DB (domain-agnostic — avoids cross-subdomain cookie issues)
  try {
    await saveOauthState(
      state,
      encodeGoogleOAuthContext(isPortalFlow ? "customer_portal" : "bizportal", returnTo),
    );
  } catch (error) {
    req.log.error({ err: error }, "[Google OAuth] state storage failed during login start");
    res.status(503).send("Login Google sedang tidak tersedia. Coba lagi sebentar.");
    return;
  }

  const client = getGoogleOAuthClient(redirectUri);
  const authUrl = client.generateAuthUrl({
    access_type: "offline",
    scope: ["openid", "email", "profile"],
    state,
    prompt: "select_account",
  });

  res.redirect(authUrl);
});

router.get("/callback/google", async (req: Request, res: Response) => {
  const { code, state, error } = req.query as Record<string, string>;

  req.log.info(
    {
      hasCode: !!code,
      hasState: !!state,
      providerCode: safeProviderCode(error),
    },
    "[Google OAuth] callback received"
  );

  logGoogleOAuthStage(req, "unknown", "STATE_VALIDATION", "started", {
    providerCode: safeProviderCode(error),
  });

  // Look up state from DB (domain-agnostic, no cookie dependency). Production
  // storage errors are distinct from an invalid/expired state and must not be
  // hidden as a normal state validation failure.
  let storedReturnTo: string | null = null;
  try {
    storedReturnTo = state ? await consumeOauthState(state) : null;
  } catch (storageError) {
    logGoogleOAuthStage(req, "unknown", "STATE_VALIDATION", "failed", {
      result: storageError instanceof OAuthStateStorageError
        ? "storage_unavailable"
        : "storage_error",
    });
    logGoogleOAuthFailure(req, "STATE_STORAGE_FAILURE", storageError);
    res.redirect(getGoogleOAuthFailureRedirect(null));
    return;
  }
  const storedContext = decodeGoogleOAuthContext(storedReturnTo);
  const callbackContext = getGoogleOAuthCallbackContext(storedReturnTo);
  const isPortalFlow = callbackContext.flow === "customer_portal";
  const returnTo = callbackContext.returnTo;
  const failureRedirect = getGoogleOAuthFailureRedirect(storedContext?.flow ?? null);

  if (!state) {
    logGoogleOAuthStage(req, "customer_portal", "STATE_VALIDATION", "failed", {
      result: "missing",
    });
    logGoogleOAuthFailure(req, "STATE_MISSING");
    res.redirect(failureRedirect);
    return;
  }

  if (!storedReturnTo) {
    logGoogleOAuthStage(req, "customer_portal", "STATE_VALIDATION", "failed", {
      result: "invalid_or_expired",
    });
    logGoogleOAuthFailure(req, "STATE_INVALID");
    req.log.warn("[Google OAuth] state not found or expired — redirecting to safe flow fallback");
    res.redirect(returnTo);
    return;
  }

  logGoogleOAuthStage(req, callbackContext.flow, "STATE_VALIDATION", "passed", {
    result: "validated",
  });

  if (error || !code) {
    logGoogleOAuthStage(req, callbackContext.flow, "TOKEN_EXCHANGE", "failed", {
      result: error ? "provider_rejected" : "code_missing",
      providerCode: safeProviderCode(error),
    });
    logGoogleOAuthFailure(req, "CODE_MISSING");
    req.log.warn(
      { providerCode: safeProviderCode(error), hasCode: !!code },
      "[Google OAuth] callback error from Google — redirecting to login",
    );
    res.redirect(failureRedirect);
    return;
  }

  if (!GOOGLE_CLIENT_ID || !GOOGLE_CLIENT_SECRET) {
    logGoogleOAuthStage(req, callbackContext.flow, "TOKEN_EXCHANGE", "failed", {
      result: "credentials_not_configured",
    });
    logGoogleOAuthFailure(req, "TOKEN_EXCHANGE_FAILED");
    res.redirect(failureRedirect);
    return;
  }

  const redirectUri = `${getGoogleOrigin(req, isPortalFlow)}/api/callback/google`;
  const client = getGoogleOAuthClient(redirectUri);
  let tokenRes: { ok: boolean; status: number; json(): Promise<unknown> };

  try {
    logGoogleOAuthStage(req, callbackContext.flow, "TOKEN_EXCHANGE", "started");
    // Manual token exchange — menggunakan fetch + URLSearchParams untuk memastikan
    // code di-encode dengan benar di request body (menghindari bug gaxios v7).
    tokenRes = await fetch("https://oauth2.googleapis.com/token", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        code,
        client_id: GOOGLE_CLIENT_ID,
        client_secret: GOOGLE_CLIENT_SECRET,
        redirect_uri: redirectUri,
        grant_type: "authorization_code",
      }).toString(),
    }) as unknown as typeof tokenRes;

    if (!tokenRes.ok) {
      const errBody = await tokenRes.json().catch(() => ({})) as Record<string, unknown>;
      const providerError = safeProviderCode(errBody.error);
      logGoogleOAuthStage(req, callbackContext.flow, "TOKEN_EXCHANGE", "failed", {
        result: "provider_rejected",
        providerStatus: tokenRes.status,
        providerCode: providerError,
      });
      const tokenExchangeError = new Error(
        providerError === "invalid_client"
          ? "Google token endpoint rejected the OAuth client credentials"
          : "Google token endpoint rejected authorization-code exchange",
      );
      logGoogleOAuthFailure(req, "TOKEN_EXCHANGE_FAILED", tokenExchangeError, {
        providerStatus: tokenRes.status,
        providerCode: providerError,
      });
      throw tokenExchangeError;
    }
    logGoogleOAuthStage(req, callbackContext.flow, "TOKEN_EXCHANGE", "passed", {
      result: "provider_accepted",
      providerStatus: tokenRes.status,
    });

    const tokenData = await tokenRes.json() as {
      id_token?: string;
      access_token?: string;
      refresh_token?: string;
      expires_in?: number;
    };

    if (!tokenData.id_token) {
      logGoogleOAuthStage(req, callbackContext.flow, "ID_TOKEN_VERIFICATION", "failed", {
        result: "id_token_missing",
      });
      logGoogleOAuthFailure(req, "GOOGLE_PROFILE_FAILED");
      throw new Error("Google ID token missing");
    }

    logGoogleOAuthStage(req, callbackContext.flow, "ID_TOKEN_VERIFICATION", "started");
    let ticket;
    try {
      ticket = await client.verifyIdToken({
        idToken: tokenData.id_token,
        audience: GOOGLE_CLIENT_ID,
      });
    } catch (verificationError) {
      logGoogleOAuthStage(req, callbackContext.flow, "ID_TOKEN_VERIFICATION", "failed", {
        result: "verification_failed",
      });
      throw verificationError;
    }
    const payload = ticket.getPayload();
    if (!payload || !payload.sub) {
      logGoogleOAuthStage(req, callbackContext.flow, "ID_TOKEN_VERIFICATION", "failed", {
        result: "invalid_claims",
      });
      throw new Error("Invalid token payload");
    }
    logGoogleOAuthStage(req, callbackContext.flow, "ID_TOKEN_VERIFICATION", "passed", {
      result: "verified",
    });

    logGoogleOAuthStage(req, callbackContext.flow, "GOOGLE_PROFILE", "started");
    if (!payload.email) {
      logGoogleOAuthStage(req, callbackContext.flow, "GOOGLE_PROFILE", "failed", {
        result: "email_missing",
      });
      logGoogleOAuthFailure(req, "EMAIL_MISSING");
      throw new Error("Google account did not provide an email");
    }
    logGoogleOAuthStage(req, callbackContext.flow, "GOOGLE_PROFILE", "passed", {
      result: "claims_accepted",
    });

    const claims: Record<string, unknown> = {
      sub: `google_${payload.sub}`,
      email: payload.email,
      first_name: payload.given_name || null,
      last_name: payload.family_name || null,
      picture: payload.picture || null,
    };

    if (isPortalFlow) {
      let portalCustomer;
      try {
        portalCustomer = await upsertPortalGoogleCustomer(claims, (stage, outcome, details) => {
          logGoogleOAuthStage(req, "customer_portal", stage, outcome, details);
        });
      } catch (accountError) {
        const category = accountError instanceof Error && accountError.message.includes("not active")
          ? "ACCOUNT_NOT_ALLOWED"
          : "ACCOUNT_RESOLUTION_FAILED";
        logGoogleOAuthFailure(req, category, accountError);
        throw accountError;
      }

      let portalToken: string;
      try {
        logGoogleOAuthStage(req, "customer_portal", "SESSION_JWT", "started");
        portalToken = await signPortalJwt({
          sub: String(portalCustomer.id),
          email: portalCustomer.email,
          customerId: portalCustomer.id,
          role: portalCustomer.role,
        });
        logGoogleOAuthStage(req, "customer_portal", "SESSION_JWT", "passed", {
          result: "created",
        });
      } catch (sessionError) {
        logGoogleOAuthStage(req, "customer_portal", "SESSION_JWT", "failed", {
          result: "creation_failed",
        });
        logGoogleOAuthFailure(req, "SESSION_CREATION_FAILED", sessionError);
        throw sessionError;
      }

      try {
        logGoogleOAuthStage(req, "customer_portal", "COOKIE_SET", "started");
        setPortalSessionCookie(res, portalToken);
        logGoogleOAuthStage(req, "customer_portal", "COOKIE_SET", "passed", {
          result: "portal_session_and_hint_set",
        });
      } catch (cookieError) {
        logGoogleOAuthStage(req, "customer_portal", "COOKIE_SET", "failed", {
          result: "set_cookie_failed",
        });
        logGoogleOAuthFailure(req, "COOKIE_FAILED", cookieError);
        throw cookieError;
      }

      const portalMeta = extractRequestMeta(req);
      writeAuditLog({
        userId: String(portalCustomer.id),
        userEmail: portalCustomer.email,
        action: "login",
        module: "portal-auth",
        referenceId: "google-oauth",
        newData: { email: portalCustomer.email, role: portalCustomer.role, provider: "google" },
        ipAddress: portalMeta.ipAddress,
        userAgent: portalMeta.userAgent,
      });
      try {
        logGoogleOAuthStage(req, "customer_portal", "FINAL_REDIRECT", "started", {
          result: "customer_portal",
        });
        req.log.info("[Google OAuth] callback succeeded");
        res.redirect(returnTo);
        logGoogleOAuthStage(req, "customer_portal", "FINAL_REDIRECT", "passed", {
          result: "customer_portal",
        });
      } catch (redirectError) {
        logGoogleOAuthStage(req, "customer_portal", "FINAL_REDIRECT", "failed", {
          result: "redirect_failed",
        });
        logGoogleOAuthFailure(req, "FINAL_REDIRECT_FAILED", redirectError);
      }
      return;
    }

    let dbUser: { id: string; email: string | null; firstName: string | null; lastName: string | null; profileImageUrl: string | null; role?: string | null; companyId?: number | null };
    try {
      dbUser = await upsertUser(claims);
    } catch (dbErr) {
      // DB tidak tersedia — buat user sementara dari Google claims
      req.log.warn({ err: dbErr }, "[Google OAuth] upsertUser DB error — using claims-only user");
      const _email = ((claims.email as string) || "").toLowerCase();
      const _adminEmails = [
        "admcst001@gmail.com",
        "divatranssoetta@gmail.com",
        ...(process.env.ADMIN_EMAIL ?? "").split(","),
        ...(process.env.ADMIN_EMAILS ?? "").split(","),
      ].map((e) => e.trim().toLowerCase()).filter(Boolean);
      dbUser = {
        id: claims.sub as string,
        email: (claims.email as string) || null,
        firstName: (claims.first_name as string) || null,
        lastName: (claims.last_name as string) || null,
        profileImageUrl: ((claims.picture || claims.profile_image_url) as string) || null,
        role: _adminEmails.includes(_email) ? "admin" : null,
        companyId: null,
      };
    }

    const now = Math.floor(Date.now() / 1000);
    const sessionData: SessionData = {
      user: {
        id: dbUser.id,
        email: dbUser.email,
        firstName: dbUser.firstName,
        lastName: dbUser.lastName,
        profileImageUrl: dbUser.profileImageUrl,
        role: dbUser.role ?? null,
        companyId: dbUser.companyId ?? null,
      },
      access_token: tokenData.access_token || "",
      refresh_token: tokenData.refresh_token || undefined,
      expires_at: tokenData.expires_in ? now + tokenData.expires_in : now + 3600,
    };

    const sid = await createSession(sessionData);
    setSessionCookie(res, sid);
    // Audit log: login berhasil via Google OAuth
    const _meta = extractRequestMeta(req);
    writeAuditLog({
      companyId: dbUser.companyId ?? null,
      userId: dbUser.id,
      userEmail: dbUser.email ?? null,
      action: "login",
      module: "auth",
      referenceId: "google-oauth",
      newData: { email: dbUser.email, role: dbUser.role },
      ipAddress: _meta.ipAddress,
      userAgent: _meta.userAgent,
    });
    // If returnTo is the sentinel value "popup", render a page that signals
    // the parent window via postMessage then closes itself.
    if (returnTo === "popup") {
      res.send(`<!DOCTYPE html><html><body><script>
        try { window.opener && window.opener.postMessage("auth:done", "*"); } catch(e){}
        window.close();
      </script><p>Login berhasil. Tutup tab ini jika tidak tertutup otomatis.</p></body></html>`);
      return;
    }
    res.redirect(returnTo);
  } catch (err) {
    if (!classifiedGoogleOAuthFailures.has(req)) {
      logGoogleOAuthFailure(req, "GOOGLE_PROFILE_FAILED", err);
    }
    if (returnTo === "popup") {
      res.send(`<!DOCTYPE html><html><body><script>
        try { window.opener && window.opener.postMessage("auth:error", "*"); } catch(e){}
        window.close();
      </script><p>Login gagal. Tutup tab ini dan coba lagi.</p></body></html>`);
      return;
    }
    const failureTarget = isPortalFlow
      ? `${returnTo}${returnTo.includes("?") ? "&" : "?"}oauth_error=google_callback_failed`
      : returnTo;
    res.redirect(failureTarget);
  }
});

// ─── Dev Login (development only) ─────────────────────────────────────────────

router.get("/dev-users", async (req: Request, res: Response) => {
  // The unified Gateway runs the preview API with NODE_ENV=production.
  // Dev endpoints are still safe there because public deployments set
  // REPLIT_DEPLOYMENT=1, which is the same guard used by /dev-login.
  if (process.env.REPLIT_DEPLOYMENT === "1") {
    res.status(404).json({ error: "Not found" });
    return;
  }
  try {
    const users = await db
      .select({
        id: usersTable.id,
        email: usersTable.email,
        firstName: usersTable.firstName,
        lastName: usersTable.lastName,
        role: usersTable.role,
      })
      .from(usersTable)
      .orderBy(usersTable.role, usersTable.email);
    res.json({ users });
  } catch {
    res.json({ users: [] });
  }
});

router.post("/dev-login", async (req: Request, res: Response) => {
  if (process.env.REPLIT_DEPLOYMENT === "1") {
    res.status(404).json({ error: "Not found" });
    return;
  }

  const { email } = req.body as { email?: string };
  if (!email || typeof email !== "string" || !email.includes("@")) {
    res.status(400).json({ error: "Valid email required" });
    return;
  }

  // Build synthetic user as fallback when DB is unavailable
  const _nameParts = email.split("@")[0].split(".");
  const _synth = {
    id: `dev_${email.replace(/[^a-z0-9]/gi, "_")}`,
    email,
    firstName: _nameParts[0] ?? "Dev",
    lastName: _nameParts[1] ?? null,
    profileImageUrl: null as string | null,
    role: "admin" as string | null,
    companyId: null as number | null,
  };

  const _adminEmails2 = [
    ...(process.env.ADMIN_EMAIL ?? "").split(","),
    ...(process.env.ADMIN_EMAILS ?? "").split(","),
  ]
    .map((e) => e.trim().toLowerCase())
    .filter(Boolean);
  const _isAdmin2 = _adminEmails2.length === 0 || _adminEmails2.includes(email.trim().toLowerCase());

  let dbUser: { id: string; email: string | null; firstName: string | null; lastName: string | null; profileImageUrl: string | null; role?: string | null; companyId?: number | null; name?: string | null };
  try {
    // Kalau user dengan email ini sudah ada di DB (mis. dari OIDC prod), langsung pakai
    // agar tidak trigger DELETE yang bisa gagal karena FK constraint di tabel lain.
    const [existingUser] = await db
      .select()
      .from(usersTable)
      .where(eq(usersTable.email, email))
      .limit(1);

    if (existingUser) {
      dbUser = existingUser;
    } else {
      const claims: Record<string, unknown> = {
        sub: _synth.id,
        email,
        first_name: _synth.firstName,
        last_name: null,
        picture: null,
      };
      dbUser = await upsertUser(claims);
    }
    // Jika email ada di ADMIN_EMAIL tapi role di DB bukan admin, update sekarang
    if (dbUser && _isAdmin2 && dbUser.role !== "admin") {
      const [updated] = await db.update(usersTable).set({ role: "admin" }).where(eq(usersTable.id, dbUser.id)).returning();
      if (updated) dbUser = updated;
    }
  } catch {
    // DB unavailable — use synthetic user (session stored in memory)
    dbUser = _synth;
  }
  const now = Math.floor(Date.now() / 1000);
  const sessionData: SessionData = {
    user: {
      id: dbUser.id,
      email: dbUser.email,
      firstName: dbUser.firstName,
      lastName: dbUser.lastName,
      profileImageUrl: dbUser.profileImageUrl,
      role: dbUser.role,
      companyId: dbUser.companyId,
    },
    access_token: "dev",
    refresh_token: undefined,
    expires_at: now + 86400,
  };

  const sid = await createSession(sessionData);
  setSessionCookie(res, sid);
  req.log.info({ email }, "[Dev Login] session created");
  // Audit log: dev login
  const _devMeta = extractRequestMeta(req);
  writeAuditLog({
    companyId: dbUser.companyId ?? null,
    userId: dbUser.id,
    userEmail: dbUser.email ?? null,
    action: "login",
    module: "auth",
    referenceId: "dev-login",
    newData: { email: dbUser.email, role: dbUser.role },
    ipAddress: _devMeta.ipAddress,
    userAgent: _devMeta.userAgent,
  });

  const redirectTo = typeof req.query.redirect === "string" ? req.query.redirect : null;
  if (redirectTo) {
    res.redirect(302, redirectTo);
    return;
  }
  res.json({ ok: true, email: dbUser.email, role: dbUser.role });
});

// ─── WA OTP Login untuk BizPortal Staff ───────────────────────────────────────

function normalizePhoneBiz(raw: string): string {
  let p = String(raw).replace(/[^\d+]/g, "");
  if (p.startsWith("+")) p = p.slice(1);
  if (p.startsWith("0")) p = "62" + p.slice(1);
  if (!p.startsWith("62")) p = "62" + p;
  return p;
}

function genOtpCode(): string {
  return String(Math.floor(100000 + Math.random() * 900000));
}

// In-memory OTP store sebagai fallback ketika tabel DB tidak tersedia
// Key: `${phone}:${purpose}`, Value: array of OTP entries
type MemOtp = { id: number; codeHash: string; attempts: number; verified: boolean; expiresAt: Date; createdAt: Date };
const memOtpStore = new Map<string, MemOtp[]>();
let memOtpSeq = 1;
function memOtpKey(phone: string, purpose: string) { return `${phone}:${purpose}`; }
function memOtpClean() {
  const now = new Date();
  for (const [k, arr] of memOtpStore) {
    const alive = arr.filter(o => o.expiresAt > now);
    if (alive.length === 0) memOtpStore.delete(k);
    else memOtpStore.set(k, alive);
  }
}
setInterval(memOtpClean, 60_000);

async function otpSend(phone: string, purpose: string, codeHash: string, expiresAt: Date): Promise<void> {
  try {
    await db.insert(waOtpCodesTable).values({ phone, codeHash, purpose, expiresAt });
  } catch {
    // Fallback: in-memory
    const key = memOtpKey(phone, purpose);
    const arr = memOtpStore.get(key) ?? [];
    arr.push({ id: memOtpSeq++, codeHash, attempts: 0, verified: false, expiresAt, createdAt: new Date() });
    memOtpStore.set(key, arr);
  }
}

async function otpCountRecent(phone: string, purpose: string, since: Date): Promise<number> {
  try {
    const rows = await db
      .select({ id: waOtpCodesTable.id })
      .from(waOtpCodesTable)
      .where(and(eq(waOtpCodesTable.phone, phone), eq(waOtpCodesTable.purpose, purpose), gte(waOtpCodesTable.createdAt, since)));
    return rows.length;
  } catch {
    const key = memOtpKey(phone, purpose);
    return (memOtpStore.get(key) ?? []).filter(o => o.createdAt >= since).length;
  }
}

async function otpGetLatest(phone: string, purpose: string): Promise<MemOtp | null> {
  try {
    const [row] = await db
      .select()
      .from(waOtpCodesTable)
      .where(and(eq(waOtpCodesTable.phone, phone), eq(waOtpCodesTable.purpose, purpose), eq(waOtpCodesTable.verified, false)))
      .orderBy(desc(waOtpCodesTable.createdAt))
      .limit(1);
    if (!row) return null;
    return { id: row.id, codeHash: row.codeHash, attempts: row.attempts, verified: row.verified, expiresAt: row.expiresAt, createdAt: row.createdAt };
  } catch {
    const key = memOtpKey(phone, purpose);
    const arr = (memOtpStore.get(key) ?? []).filter(o => !o.verified).sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
    return arr[0] ?? null;
  }
}

async function otpIncAttempts(id: number, phone: string, purpose: string): Promise<void> {
  try {
    await db.update(waOtpCodesTable).set({ attempts: sql`attempts + 1` }).where(eq(waOtpCodesTable.id, id));
  } catch {
    const key = memOtpKey(phone, purpose);
    const arr = memOtpStore.get(key) ?? [];
    const entry = arr.find(o => o.id === id);
    if (entry) entry.attempts++;
  }
}

async function otpMarkVerified(id: number, phone: string, purpose: string): Promise<void> {
  try {
    await db.update(waOtpCodesTable).set({ verified: true }).where(eq(waOtpCodesTable.id, id));
  } catch {
    const key = memOtpKey(phone, purpose);
    const arr = memOtpStore.get(key) ?? [];
    const entry = arr.find(o => o.id === id);
    if (entry) entry.verified = true;
  }
}

// POST /api/auth/wa-otp/send — kirim OTP ke nomor WA staff
router.post("/auth/wa-otp/send", async (req: Request, res: Response) => {
  const { phone } = req.body ?? {};
  if (!phone) { res.status(400).json({ message: "Nomor HP diperlukan." }); return; }
  const normalized = normalizePhoneBiz(String(phone));
  if (normalized.length < 10) { res.status(400).json({ message: "Nomor HP tidak valid." }); return; }

  // Rate limit: max 3 OTP per phone per 10 menit
  const tenMinAgo = new Date(Date.now() - 10 * 60 * 1000);
  const recentCount = await otpCountRecent(normalized, "biz-login", tenMinAgo);
  if (recentCount >= 3) {
    res.status(429).json({ message: "Terlalu banyak permintaan OTP. Coba lagi nanti." });
    return;
  }

  const code = genOtpCode();
  const codeHash = await bcrypt.hash(code, 10);
  const expiresAt = new Date(Date.now() + 5 * 60 * 1000);

  await otpSend(normalized, "biz-login", codeHash, expiresAt);

  const hasFonnte = !!process.env.FONNTE_TOKEN;
  const isDev = !process.env.REPLIT_DEPLOYMENT;

  if (hasFonnte) {
    try {
      await sendWhatsApp(
        normalized,
        `🔐 Verifikasi Login\n\nKode OTP Anda\n\n*${code}*\n\nKode berlaku selama 5 menit.\n\nUntuk menjaga keamanan akun Anda, jangan pernah membagikan kode ini kepada siapa pun.\n\nApabila Anda tidak melakukan permintaan login, abaikan pesan ini.\n\n—\nPT Cahaya Sejati Teknologi`
      );
    } catch (err) {
      req.log.error({ err }, "wa-otp biz send failed");
      res.status(500).json({ message: "Gagal mengirim OTP via WhatsApp." });
      return;
    }
    res.json({ ok: true, phone: normalized });
    return;
  }

  if (isDev) {
    req.log.warn({ normalized }, "wa-otp biz dev mode: FONNTE_TOKEN not set");
    res.json({ ok: true, phone: normalized, _dev_code: code });
    return;
  }

  res.status(503).json({ message: "Layanan WhatsApp belum dikonfigurasi. Hubungi admin." });
});

// POST /api/auth/wa-otp/verify — verifikasi OTP & buat session BizPortal
router.post("/auth/wa-otp/verify", async (req: Request, res: Response) => {
  const { phone, code } = req.body ?? {};
  if (!phone || !code) { res.status(400).json({ message: "Nomor HP dan kode OTP diperlukan." }); return; }
  const normalized = normalizePhoneBiz(String(phone));

  const otp = await otpGetLatest(normalized, "biz-login");

  if (!otp) { res.status(400).json({ message: "OTP tidak ditemukan. Minta OTP baru." }); return; }
  if (otp.expiresAt < new Date()) { res.status(400).json({ message: "OTP kadaluarsa. Minta OTP baru." }); return; }
  if (otp.attempts >= 5) { res.status(429).json({ message: "Terlalu banyak percobaan. Minta OTP baru." }); return; }

  const valid = await bcrypt.compare(String(code), otp.codeHash);
  if (!valid) {
    await otpIncAttempts(otp.id, normalized, "biz-login");
    const _metaOTP = extractRequestMeta(req);
    writeAuditLog({
      action:    "FAILED_LOGIN",
      module:    "auth",
      ipAddress: _metaOTP.ipAddress,
      userAgent: _metaOTP.userAgent,
      newData:   { method: "wa-otp", phone: normalized.slice(0, 6) + "****" },
    });
    trackSuspiciousActivity("failed_login", _metaOTP.ipAddress);
    res.status(400).json({ message: "Kode OTP salah." });
    return;
  }

  // Mark verified
  await otpMarkVerified(otp.id, normalized, "biz-login");

  // Cari atau buat user BizPortal berdasarkan phone
  const waUserId = `wa_${normalized}`;
  const phoneEmail = `${normalized}@wa.local`;

  let dbUser: typeof usersTable.$inferSelect;
  try {
    const [existing] = await db.select().from(usersTable).where(eq(usersTable.id, waUserId)).limit(1);
    if (existing) {
      dbUser = existing;
    } else {
      // Belum ada — daftar otomatis dengan role ecommerce (admin bisa promote)
      const [created] = await db
        .insert(usersTable)
        .values({
          id: waUserId,
          email: phoneEmail,
          name: normalized,
          role: "ecommerce" as const,
        })
        .onConflictDoUpdate({ target: usersTable.id, set: { updatedAt: new Date() } })
        .returning();
      dbUser = created;
    }
  } catch (err) {
    req.log.error({ err }, "wa-otp biz user upsert failed");
    res.status(500).json({ message: "Gagal membuat akun. Coba lagi." });
    return;
  }

  // Buat server-side session (sama seperti Google login)
  const now = Math.floor(Date.now() / 1000);
  const sessionData: SessionData = {
    user: {
      id: dbUser.id,
      email: dbUser.email,
      firstName: dbUser.firstName,
      lastName: dbUser.lastName,
      profileImageUrl: dbUser.profileImageUrl,
      role: dbUser.role,
      companyId: dbUser.companyId,
    },
    access_token: "wa-otp",
    expires_at: now + SESSION_TTL / 1000,
  };

  const sid = await createSession(sessionData);
  setSessionCookie(res, sid);

  res.json({ ok: true, user: { id: dbUser.id, email: dbUser.email, role: dbUser.role } });
});

// ─── Logout ───────────────────────────────────────────────────────────────────

router.get("/logout", async (req: Request, res: Response) => {
  const config = await getOidcConfig();
  const origin = getOrigin(req);
  const redirectPath = (req.query.redirect as string) || "/";
  const postLogoutUri = `${origin}${redirectPath.startsWith("/") ? redirectPath : "/" + redirectPath}`;

  const sid = getSessionId(req);
  await clearSession(res, sid);

  const endSessionUrl = oidc.buildEndSessionUrl(config, {
    client_id: process.env.REPL_ID!,
    post_logout_redirect_uri: postLogoutUri,
  });

  res.redirect(endSessionUrl.href);
});

router.post(
  "/mobile-auth/token-exchange",
  async (req: Request, res: Response) => {
    const parsed = ExchangeMobileAuthorizationCodeBody.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: "Missing or invalid required parameters" });
      return;
    }

    const { code, code_verifier, redirect_uri, state, nonce } = parsed.data;

    try {
      const config = await getOidcConfig();

      const callbackUrl = new URL(redirect_uri);
      callbackUrl.searchParams.set("code", code);
      callbackUrl.searchParams.set("state", state);
      callbackUrl.searchParams.set("iss", ISSUER_URL);

      const tokens = await oidc.authorizationCodeGrant(config, callbackUrl, {
        pkceCodeVerifier: code_verifier,
        expectedNonce: nonce ?? undefined,
        expectedState: state,
        idTokenExpected: true,
      });

      const claims = tokens.claims();
      if (!claims) {
        res.status(401).json({ error: "No claims in ID token" });
        return;
      }

      const dbUser = await upsertUser(
        claims as unknown as Record<string, unknown>,
      );

      const now = Math.floor(Date.now() / 1000);
      const sessionData: SessionData = {
        user: {
          id: dbUser.id,
          email: dbUser.email,
          firstName: dbUser.firstName,
          lastName: dbUser.lastName,
          profileImageUrl: dbUser.profileImageUrl,
          role: dbUser.role ?? null,
          companyId: dbUser.companyId ?? null,
        },
        access_token: tokens.access_token,
        refresh_token: tokens.refresh_token,
        expires_at: tokens.expiresIn() ? now + tokens.expiresIn()! : claims.exp,
      };

      const sid = await createSession(sessionData);
      res.json(ExchangeMobileAuthorizationCodeResponse.parse({ token: sid }));
    } catch (err) {
      req.log.error({ err }, "Mobile token exchange error");
      res.status(500).json({ error: "Token exchange failed" });
    }
  },
);

router.post("/mobile-auth/logout", async (req: Request, res: Response) => {
  // Mobile app sends the session SID via Authorization: Bearer <sid>.
  // getSessionId() reads cookies only, so we use getBearerToken() here.
  const sid = getBearerToken(req);
  if (sid) {
    await deleteSession(sid);
  }
  res.json(LogoutMobileSessionResponse.parse({ success: true }));
});

// ─── Email + Password Login (prod-safe) ───────────────────────────────────────
// POST /api/auth/email-login  { email, password }

router.post("/auth/email-login", async (req: Request, res: Response) => {
  const { email, password } = req.body as { email?: string; password?: string };

  if (!email || typeof email !== "string" || !email.includes("@")) {
    res.status(400).json({ error: "Email tidak valid" });
    return;
  }
  if (!password || typeof password !== "string" || password.length < 1) {
    res.status(400).json({ error: "Password tidak boleh kosong" });
    return;
  }

  const normalizedEmail = email.trim().toLowerCase();

  let dbUser: (typeof usersTable.$inferSelect) | undefined;
  try {
    [dbUser] = await db
      .select()
      .from(usersTable)
      .where(eq(usersTable.email, normalizedEmail))
      .limit(1);
  } catch {
    res.status(503).json({ error: "Database tidak tersedia, coba lagi" });
    return;
  }

  if (!dbUser || !dbUser.passwordHash) {
    const _metaEL = extractRequestMeta(req);
    trackSuspiciousActivity("failed_login", _metaEL.ipAddress);
    res.status(401).json({ error: "Email atau password salah" });
    return;
  }

  const valid = await bcrypt.compare(password, dbUser.passwordHash);
  if (!valid) {
    const _metaEL2 = extractRequestMeta(req);
    trackSuspiciousActivity("failed_login", _metaEL2.ipAddress);
    writeAuditLog({
      action: "FAILED_LOGIN",
      module: "auth",
      ipAddress: _metaEL2.ipAddress,
      userAgent: _metaEL2.userAgent,
      newData: { method: "email-password", email: normalizedEmail },
    });
    res.status(401).json({ error: "Email atau password salah" });
    return;
  }

  const sessionData: SessionData = {
    user: {
      id: dbUser.id,
      email: dbUser.email,
      firstName: dbUser.firstName,
      lastName: dbUser.lastName,
      profileImageUrl: dbUser.profileImageUrl,
      role: dbUser.role ?? null,
      companyId: dbUser.companyId ?? null,
    },
    access_token: `email_${crypto.randomBytes(16).toString("hex")}`,
    expires_at: Math.floor(Date.now() / 1000) + SESSION_TTL / 1000,
  };

  const sid = await createSession(sessionData);
  setSessionCookie(res, sid);

  const _metaEL3 = extractRequestMeta(req);
  writeAuditLog({
    companyId: dbUser.companyId ?? null,
    userId: dbUser.id,
    action: "LOGIN",
    module: "auth",
    referenceId: "email-password",
    newData: { email: dbUser.email, role: dbUser.role },
    ipAddress: _metaEL3.ipAddress,
    userAgent: _metaEL3.userAgent,
  });

  res.json({
    user: {
      id: dbUser.id,
      email: dbUser.email,
      firstName: dbUser.firstName,
      lastName: dbUser.lastName,
      profileImageUrl: dbUser.profileImageUrl,
      role: dbUser.role,
    },
  });
});

// ─── Admin: Kelola password email login ───────────────────────────────────────

router.post("/auth/admin/set-password", async (req: Request, res: Response) => {
  if (!req.isAuthenticated() || req.user?.role !== "admin") {
    res.status(403).json({ error: "Admin only" });
    return;
  }

  const { userId, password } = req.body as { userId?: string; password?: string };
  if (!userId || typeof userId !== "string") {
    res.status(400).json({ error: "userId wajib diisi" });
    return;
  }
  if (!password || typeof password !== "string" || password.length < 6) {
    res.status(400).json({ error: "Password minimal 6 karakter" });
    return;
  }

  const hash = await bcrypt.hash(password, 12);
  try {
    const [updated] = await db
      .update(usersTable)
      .set({ passwordHash: hash, updatedAt: new Date() })
      .where(eq(usersTable.id, userId))
      .returning({ id: usersTable.id, email: usersTable.email });
    if (!updated) {
      res.status(404).json({ error: "User tidak ditemukan" });
      return;
    }
    const _metaSP = extractRequestMeta(req);
    writeAuditLog({
      userId: req.user!.id,
      action: "UPDATE",
      module: "auth",
      referenceId: userId,
      newData: { action: "set_password", targetEmail: updated.email },
      ipAddress: _metaSP.ipAddress,
      userAgent: _metaSP.userAgent,
    });
    res.json({ ok: true, email: updated.email });
  } catch {
    res.status(500).json({ error: "Gagal menyimpan password" });
  }
});

router.delete("/auth/admin/remove-password/:userId", async (req: Request, res: Response) => {
  if (!req.isAuthenticated() || req.user?.role !== "admin") {
    res.status(403).json({ error: "Admin only" });
    return;
  }

  const userId = String(req.params.userId ?? "");
  try {
    const [updated] = await db
      .update(usersTable)
      .set({ passwordHash: null, updatedAt: new Date() })
      .where(eq(usersTable.id, userId))
      .returning({ id: usersTable.id, email: usersTable.email });
    if (!updated) {
      res.status(404).json({ error: "User tidak ditemukan" });
      return;
    }
    const _metaRP = extractRequestMeta(req);
    writeAuditLog({
      userId: req.user!.id,
      action: "UPDATE",
      module: "auth",
      referenceId: userId,
      newData: { action: "remove_password", targetEmail: updated.email },
      ipAddress: _metaRP.ipAddress,
      userAgent: _metaRP.userAgent,
    });
    res.json({ ok: true });
  } catch {
    res.status(500).json({ error: "Gagal menghapus password" });
  }
});

// ─── Admin: List users with password status ───────────────────────────────────

router.get("/auth/admin/users-password-status", async (req: Request, res: Response) => {
  if (!req.isAuthenticated() || req.user?.role !== "admin") {
    res.status(403).json({ error: "Admin only" });
    return;
  }
  try {
    const users = await db
      .select({
        id: usersTable.id,
        email: usersTable.email,
        name: usersTable.name,
        role: usersTable.role,
        hasPassword: sql<boolean>`(password_hash IS NOT NULL AND password_hash <> '')`,
      })
      .from(usersTable)
      .orderBy(usersTable.role, usersTable.email);
    res.json({ users });
  } catch {
    res.status(500).json({ error: "Gagal memuat data" });
  }
});

export default router;
