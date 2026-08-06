import path from "path";
import fs from "fs";
import { fileURLToPath } from "url";
import type { IncomingMessage, ServerResponse } from "http";
import express, { type Express, type Request, type Response, type NextFunction } from "express";
import compression from "compression";
import cors from "cors";
import cookieParser from "cookie-parser";
import { pinoHttp } from "pino-http";
import router from "./routes";
import authRouter from "./routes/auth";
import companiesRouter from "./routes/companies";
import { shortLinkRedirectRouter } from "./routes/shortLinkRedirect";
import { adminActionRouter } from "./routes/adminAction";
import mktAdminRouter from "./routes/mktAdmin";
import mktPortalRouter from "./routes/mktPortal";
import mktQaFixtureRouter from "./routes/mktQaFixture";
import { marketplaceRouter } from "./routes/marketplace";
import { treasuryRouter } from "./routes/treasury.js";
import translationsRouter from "./routes/translations";
import { aiTranslateRouter } from "./routes/aiTranslate";
import { authMiddleware } from "./middlewares/authMiddleware";
import { pool as _sysPool } from "@workspace/db";
import { bearerRateLimiter } from "./middlewares/bearerRateLimiter";
import { authRateLimiter } from "./middlewares/securityRateLimiter";
import { correlationIdMiddleware } from "./middlewares/correlationId";
import { logger } from "./lib/logger";
import { recordResponseTime } from "./lib/responseTimeLog";

const app: Express = express();

// Trust a single upstream reverse proxy (Replit's edge / nginx).
// This makes req.ip reflect the real client IP from X-Forwarded-For instead
// of the proxy's internal address, which is required for IP-based rate limiting.
app.set("trust proxy", 1);

// ── Correlation ID — assign / echo X-Request-ID on every request ─────────────
app.use(correlationIdMiddleware);

// ── Gzip compression ─────────────────────────────────────────────────────────
app.use(compression());

// ── Security headers ──────────────────────────────────────────────────────────
app.use((_req: Request, res: Response, next: NextFunction) => {
  const isProd = process.env["REPLIT_DEPLOYMENT"] === "1";

  res.setHeader("X-Content-Type-Options", "nosniff");
  res.setHeader("Referrer-Policy", "strict-origin-when-cross-origin");
  res.setHeader("Permissions-Policy", "camera=(), microphone=(), geolocation=()");

  if (isProd) {
    res.setHeader("X-Frame-Options", "SAMEORIGIN");
    res.setHeader("Strict-Transport-Security", "max-age=63072000; includeSubDomains");
  }

  // CSP: allow Replit preview in dev, restrict to own domain in prod
  const frameAncestors = isProd
    ? "'self' https://cstlogistic.co.id https://www.cstlogistic.co.id https://bizportal.cstlogistic.co.id"
    : "'self' https://replit.com https://*.replit.dev https://*.sisko.replit.dev";

  res.setHeader(
    "Content-Security-Policy",
    [
      "default-src 'self'",
      "script-src 'self' 'unsafe-inline' 'unsafe-eval' blob:",
      "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
      "font-src 'self' https://fonts.gstatic.com data:",
      "img-src 'self' data: https: blob:",
      "connect-src 'self' https: wss: ws:",
      "media-src 'self' https: blob:",
      "worker-src 'self' blob:",
      `frame-ancestors ${frameAncestors}`,
      "object-src 'none'",
      "base-uri 'self'",
    ].join("; "),
  );

  next();
});

// ── Dynamic sitemap.xml ────────────────────────────────────────────────────────
app.get("/sitemap.xml", (_req: Request, res: Response) => {
  const base = process.env["APP_URL"]
    ? process.env["APP_URL"].replace(/\/$/, "")
    : process.env["REPLIT_DEV_DOMAIN"]
      ? `https://${process.env["REPLIT_DEV_DOMAIN"]}`
      : "https://cstlogistic.co.id";

  const today = new Date().toISOString().split("T")[0];
  const pages = [
    { loc: "/",                 priority: "1.0", changefreq: "daily"   },
    { loc: "/services",         priority: "0.9", changefreq: "weekly"  },
    { loc: "/products",         priority: "0.8", changefreq: "weekly"  },
    { loc: "/freight-forwarding", priority: "0.8", changefreq: "weekly" },
    { loc: "/pabean",           priority: "0.8", changefreq: "weekly"  },
    { loc: "/calculator",       priority: "0.7", changefreq: "monthly" },
    { loc: "/track",            priority: "0.7", changefreq: "monthly" },
    { loc: "/contact",          priority: "0.6", changefreq: "monthly" },
    { loc: "/privacy-policy",   priority: "0.3", changefreq: "yearly"  },
  ];

  const xml = `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${pages.map((p) => `  <url>
    <loc>${base}${p.loc}</loc>
    <lastmod>${today}</lastmod>
    <changefreq>${p.changefreq}</changefreq>
    <priority>${p.priority}</priority>
  </url>`).join("\n")}
</urlset>`;

  res.setHeader("Content-Type", "application/xml; charset=utf-8");
  res.setHeader("Cache-Control", "public, max-age=3600");
  res.send(xml);
});

app.use((req, res, next) => {
  const startNs = process.hrtime.bigint();
  const originalEnd = res.end.bind(res) as typeof res.end;
  res.end = ((...args: Parameters<typeof res.end>) => {
    if (!res.headersSent) {
      const elapsedMs = Number(process.hrtime.bigint() - startNs) / 1e6;
      res.setHeader("X-Response-Time", `${elapsedMs.toFixed(2)}ms`);
      recordResponseTime(req.path, elapsedMs);
    }
    return originalEnd(...args);
  }) as typeof res.end;
  next();
});

app.use(
  pinoHttp({
    logger,
    // Reuse the correlation ID already set by correlationIdMiddleware so every
    // pino-http log line carries the same reqId as the X-Request-ID header.
    genReqId: (req) => (req as IncomingMessage & { id?: string }).id,
    serializers: {
      req(req: IncomingMessage & { id?: string }) {
        return {
          id: req.id,
          method: req.method,
          url: req.url?.split("?")[0],
        };
      },
      res(res: ServerResponse) {
        return {
          statusCode: res.statusCode,
        };
      },
    },
  }),
);

// ── Strict CORS origin allowlist ─────────────────────────────────────────────
// `origin: true` (the previous value) reflects any caller origin, which –
// combined with `credentials: true` and `SameSite=None` session cookies –
// allows arbitrary third-party sites to make authenticated requests on behalf
// of a logged-in user and read the response (cross-origin data exfiltration).
// Only explicitly listed origins may use credentialed cross-origin requests.
const CORS_ALLOWED_ORIGINS: Set<string> = new Set(
  [
    // Production custom domains
    "https://bizportal.cstlogistic.co.id",
    "https://cstlogistic.co.id",
    "https://www.cstlogistic.co.id",
    // Explicitly configured app base URL (deployed Replit or custom domain)
    process.env["APP_URL"] ? process.env["APP_URL"].replace(/\/$/, "") : null,
    // Replit dev domain — only in the non-deployed development environment
    process.env["REPLIT_DEV_DOMAIN"] && !process.env["REPLIT_DEPLOYMENT"]
      ? `https://${process.env["REPLIT_DEV_DOMAIN"]}`
      : null,
    // Extra origins — comma-separated, e.g. Vercel frontend domains
    // Set CORS_EXTRA_ORIGINS=https://bizportal.vercel.app,https://portal.vercel.app
    ...(process.env["CORS_EXTRA_ORIGINS"]
      ? process.env["CORS_EXTRA_ORIGINS"]
          .split(",")
          .map((o) => o.trim())
          .filter((o) => o.length > 0)
      : []),
  ].filter((o): o is string => typeof o === "string" && o.length > 0),
);

app.use(
  cors({
    credentials: true,
    origin: (incomingOrigin, callback) => {
      // No Origin header → same-origin or non-browser request; allow without
      // echoing a wildcard so credentials still flow correctly.
      if (!incomingOrigin) return callback(null, false);
      if (CORS_ALLOWED_ORIGINS.has(incomingOrigin)) {
        return callback(null, incomingOrigin);
      }
      // Reject unlisted origins — do not echo them back.
      logger.warn({ origin: incomingOrigin }, "CORS: rejected unlisted origin");
      return callback(null, false);
    },
  }),
);
app.use(express.json({ limit: "20mb" }));
app.use(express.urlencoded({ extended: true, limit: "20mb" }));
app.use(cookieParser());

// Rate-limit bearer-token requests before any auth processing.
// Applies only to requests carrying "Authorization: Bearer ..." headers
// (portal/mobile Supabase tokens). Internal BizPortal session-cookie
// requests carry no Authorization header and are not affected.
app.use(bearerRateLimiter);

// Replit Auth middleware — populates req.user and req.isAuthenticated()
app.use(authMiddleware);

// Part A — Rate limit auth endpoints (login, callback, auth/*, logout) before authRouter
app.use(
  ["/api/login", "/api/callback", "/api/auth", "/api/logout"],
  authRateLimiter,
);

// Auth routes (login/callback/logout/mobile-auth) — mounted under /api
app.use("/api", authRouter);

// ─── Base directory resolved from this file's location ───────────────────────
// process.cwd() varies based on where node is invoked from; using import.meta.url
// gives us a stable path relative to this source file regardless of cwd.
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
// In prod (compiled dist): artifacts/api-server/dist → artifacts/ needs ../..
const ARTIFACTS_DIR = path.resolve(__dirname, "../..");

// ─── POS Images Static Serving ───────────────────────────────────────────────
// Gambar produk POS kasir disimpan di folder ini dan diakses secara publik.
const POS_IMAGES_DIR = path.resolve(ARTIFACTS_DIR, "api-server/public/pos-images");
if (!fs.existsSync(POS_IMAGES_DIR)) fs.mkdirSync(POS_IMAGES_DIR, { recursive: true });
app.use("/pos-images", express.static(POS_IMAGES_DIR, { maxAge: "7d" }));

// ─── Customer Portal Static Serving ──────────────────────────────────────────
// Customer portal is built with base="/" so assets are at /assets/...
// Serves at root "/" so confirm links (https://domain/confirm/:token) work.
// Must come BEFORE /api routes for static assets, but SPA fallback is AFTER.

const CUSTOMER_PORTAL_DIST = path.resolve(
  ARTIFACTS_DIR,
  "customer-portal/dist/public",
);

if (fs.existsSync(CUSTOMER_PORTAL_DIST)) {
  // Serve static files (JS/CSS/images) — these paths never conflict with /api/*
  app.use(express.static(CUSTOMER_PORTAL_DIST, { index: false }));
}

// ─── Health check + Dev-mode root ─────────────────────────────────────────────
// /healthz always returns 200 — used by Replit's workflow port health-check.
app.get("/healthz", (_req: Request, res: Response) => {
  res.status(200).json({ status: "ok" });
});

// /api (root) — Replit deployment healthcheck target, harus selalu 200.
app.get("/api", (_req: Request, res: Response) => {
  res.status(200).json({ status: "ok" });
});

// ─── System health endpoints (no-auth, always fast) ───────────────────────────
// GET /system/health — lightweight liveness check.
// GET /system/status — richer status including DB, bundle, active modules.
const _systemStartedAt = Date.now();
const _ACTIVE_MODULES = [
  "sales", "purchase", "accounting", "logistics", "freight",
  "expenses", "correspondences", "ecommerce", "trading",
  "fleet-intelligence", "ai-governance", "sport-center", "tenant",
  "portal", "media", "whatsapp", "webhooks",
] as const;

app.get("/system/health", (_req: Request, res: Response) => {
  res.status(200).json({
    status: "ok",
    timestamp: new Date().toISOString(),
    uptime_seconds: Math.floor((Date.now() - _systemStartedAt) / 1000),
  });
});

app.get("/system/status", async (_req: Request, res: Response) => {
  const t0 = Date.now();
  let dbStatus: "ok" | "error" = "ok";
  let dbLatencyMs: number | null = null;
  try {
    const client = await _sysPool.connect();
    const q0 = Date.now();
    await client.query("SELECT 1");
    dbLatencyMs = Date.now() - q0;
    client.release();
  } catch {
    dbStatus = "error";
  }

  const bundleExists = fs.existsSync(path.resolve(__dirname, "index.mjs"));

  res.status(200).json({
    status: dbStatus === "error" ? "degraded" : "ok",
    timestamp: new Date().toISOString(),
    uptime_seconds: Math.floor((Date.now() - _systemStartedAt) / 1000),
    api: { status: "ok" },
    db: { status: dbStatus, latency_ms: dbLatencyMs },
    bundle: { status: bundleExists ? "ok" : "missing" },
    active_modules: _ACTIVE_MODULES,
    env: process.env["NODE_ENV"] ?? "development",
    response_time_ms: Date.now() - t0,
  });
});

// In development, frontend apps run as separate Vite processes so
// customer-portal/dist doesn't exist yet. Return 200 with a redirect meta tag
// so Replit's proxy health-check passes (302 causes health-check failures).
app.get("/", (_req: Request, res: Response, next: NextFunction) => {
  if (fs.existsSync(CUSTOMER_PORTAL_DIST)) return next();
  const bizportalDist = path.join(ARTIFACTS_DIR, "bizportal/dist/public");
  if (fs.existsSync(bizportalDist)) return next();
  res.status(200).send(`<!DOCTYPE html><html><head><meta http-equiv="refresh" content="0;url=/bizportal/"></head><body><a href="/bizportal/">BizPortal</a></body></html>`);
});

// ─── BizPortal Static Serving ────────────────────────────────────────────────
// BizPortal is built with base="/bizportal/" so all asset hrefs are /bizportal/...
// The API server handles /bizportal/* so that:
//   1. cst-super-app.replit.app/bizportal/ works (normal access)
//   2. bizportal.cstlogistic.co.id/bizportal/ works (custom domain, old cached redirect)
//   3. bizportal.cstlogistic.co.id/ works (custom domain root — served below)

const BIZPORTAL_DIST = path.resolve(
  ARTIFACTS_DIR,
  "bizportal/dist/public",
);

// Serve static assets at /bizportal/* (strips /bizportal prefix internally)
if (fs.existsSync(BIZPORTAL_DIST)) {
  app.use(
    "/bizportal",
    express.static(BIZPORTAL_DIST, { index: "index.html" }),
  );

  // SPA fallback: any /bizportal/* path that isn't a file → index.html
  app.use("/bizportal/{*path}", (_req: Request, res: Response) => {
    res.sendFile(path.join(BIZPORTAL_DIST, "index.html"));
  });
}

// ─── Logistic Order Static Serving ───────────────────────────────────────────
// logistic-order is built with base="/logistic-order/" — serves as redirect shim
// pointing to customer portal routes (/book, /track, /logistic-admin).

const LOGISTIC_ORDER_DIST = path.resolve(
  ARTIFACTS_DIR,
  "logistic-order/dist/public",
);

if (fs.existsSync(LOGISTIC_ORDER_DIST)) {
  app.use(
    "/logistic-order",
    express.static(LOGISTIC_ORDER_DIST, { index: "index.html" }),
  );

  app.use("/logistic-order/{*path}", (_req: Request, res: Response) => {
    res.sendFile(path.join(LOGISTIC_ORDER_DIST, "index.html"));
  });
}

// ─── Custom domain: serve BizPortal at root "/" ───────────────────────────────
// When accessed via bizportal.cstlogistic.co.id, requests for "/" should show
// BizPortal. The HTML will load assets from /bizportal/assets/... which are
// handled by the express.static above.
app.use((req: Request, res: Response, next: NextFunction) => {
  const host =
    (req.headers["x-forwarded-host"] as string) || req.headers.host || "";
  const hostname = host.split(":")[0];

  if (hostname !== "bizportal.cstlogistic.co.id") return next();

  // Skip API / auth routes
  const skip = ["/api/", "/login", "/logout", "/callback", "/auth", "/mobile-auth", "/bizportal"];
  if (skip.some((p) => req.path === p || req.path.startsWith(p + "/") || req.path.startsWith(p))) {
    return next();
  }

  const indexPath = path.join(BIZPORTAL_DIST, "index.html");
  if (fs.existsSync(indexPath)) {
    res.sendFile(indexPath);
  } else {
    next();
  }
});

app.use(shortLinkRedirectRouter);
app.use(adminActionRouter);
app.use("/api/companies", companiesRouter);
app.use("/api/translations", translationsRouter);
app.use("/api/ai-translate", aiTranslateRouter);
app.use("/api", treasuryRouter);
// ── Marketplace routes (Phase 2A–2E) ─────────────────────────────────────────
app.use("/api/marketplace", marketplaceRouter);
app.use("/api/mkt/admin", mktAdminRouter);
app.use("/api/mkt/portal", mktPortalRouter);
// QA Fixture Manager — DEV only (backend triple guard enforces HTTP 403 in prod)
app.use("/api/admin/marketplace/qa", mktQaFixtureRouter);
app.use("/api", router);

// ─── Customer Portal SPA Fallback ────────────────────────────────────────────
// For any non-API, non-BizPortal path (e.g. /confirm/:token, /, /services, etc.)
// serve the customer portal index.html so client-side routing works.
if (fs.existsSync(CUSTOMER_PORTAL_DIST)) {
  const PORTAL_SKIP = ["/api/", "/bizportal", "/login", "/logout", "/callback", "/auth", "/mobile-auth"];
  app.use((req: Request, res: Response, next: NextFunction) => {
    if (PORTAL_SKIP.some((p) => req.path === p || req.path.startsWith(p + "/") || req.path.startsWith(p))) {
      return next();
    }
    const indexPath = path.join(CUSTOMER_PORTAL_DIST, "index.html");
    if (fs.existsSync(indexPath)) {
      res.sendFile(indexPath);
    } else {
      next();
    }
  });
}

// Global error handler — logs unhandled errors and returns JSON
app.use((err: Error, req: express.Request, res: express.Response, _next: express.NextFunction) => {
  const reqId = (req as express.Request & { id?: string }).id;
  logger.error(
    {
      reqId,
      err: { message: err.message, stack: err.stack, name: err.name },
      method: req.method,
      url: req.url,
    },
    "Unhandled request error",
  );
  if (res.headersSent) return;
  const isProd = process.env["NODE_ENV"] === "production";
  res.status(500).json({
    message: "Internal Server Error",
    reqId,
    ...(isProd ? {} : { error: err.message }),
  });
});

export default app;
