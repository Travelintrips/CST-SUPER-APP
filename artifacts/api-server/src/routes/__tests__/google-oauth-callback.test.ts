import express, { type Request } from "express";
import request from "supertest";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";

const requestLog = {
  error: vi.fn(),
  info: vi.fn(),
  warn: vi.fn(),
};

vi.mock("@workspace/db", () => ({
  db: {},
  usersTable: {},
  waOtpCodesTable: {},
  portalCustomersTable: {},
}));

vi.mock("../../lib/oauthStateMigration", () => ({
  OAuthStateStorageError: class OAuthStateStorageError extends Error {},
  saveOauthState: vi.fn(),
  consumeOauthState: vi.fn(async () => "portal:/login"),
}));

vi.mock("../../lib/auth", () => ({
  clearSession: vi.fn(),
  getOidcConfig: vi.fn(),
  getSessionId: vi.fn(),
  getBearerToken: vi.fn(),
  createSession: vi.fn(),
  deleteSession: vi.fn(),
  SESSION_COOKIE: "sid",
  SESSION_TTL: 60 * 60 * 1000,
  ISSUER_URL: "https://issuer.example.test",
}));

vi.mock("../../lib/waTransport.js", () => ({
  sendViaService: vi.fn(),
}));

vi.mock("../../lib/auditLog.js", () => ({
  writeAuditLog: vi.fn(),
  extractRequestMeta: vi.fn(() => ({
    ipAddress: "127.0.0.1",
    userAgent: "test",
  })),
}));

vi.mock("../../lib/suspiciousActivity.js", () => ({
  trackSuspiciousActivity: vi.fn(),
}));

vi.mock("../../lib/supabaseAdmin", () => ({
  verifySupabaseToken: vi.fn(),
}));

vi.mock("../../lib/portalJwt.js", () => ({
  signPortalJwt: vi.fn(),
}));

vi.mock("../../lib/supabaseAuth.js", () => ({
  setPortalSessionCookie: vi.fn(),
}));

describe("Google OAuth callback diagnostics", () => {
  beforeAll(() => {
    process.env.GOOGLE_CLIENT_ID = "test-client-id";
    process.env.GOOGLE_CLIENT_SECRET = "test-client-secret";
  });

  afterEach(() => {
    vi.clearAllMocks();
    vi.unstubAllGlobals();
  });

  it("logs a rejected token exchange without leaking OAuth secrets", async () => {
    const authorizationCode = "authorization-code-that-must-not-be-logged";
    const clientSecret = "client-secret-that-must-not-be-logged";
    const accessToken = "access-token-that-must-not-be-logged";
    const sessionSecret = "session-secret-that-must-not-be-logged";

    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({
        ok: false,
        status: 401,
        json: async () => ({
          error: "invalid_client",
          error_description:
            `client_secret=${clientSecret} authorization_code=${authorizationCode} ` +
            `access_token=${accessToken} session_secret=${sessionSecret}`,
        }),
      })),
    );

    const { default: authRouter } = await import("../auth.js");
    const app = express();
    app.use((req: Request, _res, next) => {
      (req as unknown as { log: typeof requestLog }).log = requestLog;
      next();
    });
    app.use("/api", authRouter);

    const response = await request(app)
      .get("/api/callback/google")
      .query({
        state: "valid-state",
        code: authorizationCode,
      });

    expect(response.status).toBe(302);
    expect(response.headers.location).toBe(
      "/login?oauth_error=google_callback_failed",
    );

    const failureCall = requestLog.error.mock.calls.find(
      ([, message]) => message === "[Google OAuth] callback failed",
    );
    expect(failureCall).toBeDefined();
    expect(failureCall?.[0]).toMatchObject({
      category: "TOKEN_EXCHANGE_FAILED",
      failingStage: "TOKEN_EXCHANGE",
      providerStatus: 401,
      providerCode: "invalid_client",
      errorName: "Error",
      errorMessage:
        "Google token endpoint rejected the OAuth client credentials",
    });

    const diagnostics = JSON.stringify([
      ...requestLog.error.mock.calls,
      ...requestLog.warn.mock.calls,
      ...requestLog.info.mock.calls,
    ]);
    expect(diagnostics).toContain("TOKEN_EXCHANGE_FAILED");
    expect(diagnostics).toContain("TOKEN_EXCHANGE");
    expect(diagnostics).toContain("invalid_client");
    expect(diagnostics).toContain("401");
    expect(diagnostics).not.toContain(authorizationCode);
    expect(diagnostics).not.toContain(clientSecret);
    expect(diagnostics).not.toContain(accessToken);
    expect(diagnostics).not.toContain(sessionSecret);
  });
});