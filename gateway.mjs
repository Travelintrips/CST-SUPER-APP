/**
 * Unified Gateway — DATA PLANE only
 *
 * Responsibilities:
 *   - Route incoming requests to the correct upstream
 *   - Retry with exponential backoff on ECONNREFUSED / ETIMEDOUT
 *   - Proxy WebSocket upgrades (Vite HMR)
 *   - Serve /system/health (own liveness — no external deps)
 *   - Proxy /system/global-health and /system/control/* to Watchdog Service
 *
 * This file NEVER:
 *   - spawns child processes
 *   - restarts services
 *   - manages process lifecycle
 *   - runs circuit breakers or health monitors
 *
 * All monitoring, circuit breaking, and control-plane logic lives in:
 *   system-watchdog-service.mjs  (port WATCHDOG_PORT — static, default 3001)
 *
 * Route table:
 *   /system/health         → inline liveness (always 200)
 *   /system/global-health  → proxy → Watchdog Service
 *   /system/control/*      → proxy → Watchdog Service
 *   /api/*                 → API Server      :8080
 *   /pos-images/*          → API Server      :8080
 *   /q/*                   → API Server      :8080
 *   /s/*                   → API Server      :8080
 *   /bizportal/*           → BizPortal       :6800
 *   /logistic-order/*      → Logistic Order  :19368
 *   /sport-center/*        → 302 /bizportal/sport-center/*
 *   /*                     → Customer Portal :8080 (falls back to API)
 */

import http from "node:http";
import net  from "node:net";
import fs   from "node:fs";

const PORT             = Number(process.env.PORT             ?? 5000);
const WATCHDOG_PORT    = Number(process.env.WATCHDOG_PORT    ?? 3001);
const SYSTEM_MODE      = process.env.SYSTEM_MODE ?? "PROD";
const MAX_ATTEMPTS     = Number(process.env.GW_MAX_ATTEMPTS  ?? 8);
const BACKOFF_CAP      = Number(process.env.GW_BACKOFF_CAP   ?? 2000);
const BASE_DELAY       = Number(process.env.GW_BASE_DELAY    ?? 200);

const RETRYABLE_CODES  = new Set(["ECONNREFUSED","ECONNRESET","ETIMEDOUT","ENOTFOUND"]);

const API_PORT            = Number(process.env.API_PORT            ?? 8080);
const BIZPORTAL_PORT      = Number(process.env.BIZPORTAL_PORT      ?? API_PORT);
const CUSTOMER_PORT       = Number(process.env.CUSTOMER_PORT       ?? API_PORT);
const LOGISTIC_ORDER_PORT = Number(process.env.LOGISTIC_ORDER_PORT ?? API_PORT);

const ROUTES = [
  { prefix: "/api",             upstream: { host: "localhost", port: API_PORT } },
  { prefix: "/pos-images",      upstream: { host: "localhost", port: API_PORT } },
  { prefix: "/q",               upstream: { host: "localhost", port: API_PORT } },
  { prefix: "/s",               upstream: { host: "localhost", port: API_PORT } },
  { prefix: "/bizportal",       upstream: { host: "localhost", port: BIZPORTAL_PORT } },
  { prefix: "/logistic-order",  upstream: { host: "localhost", port: LOGISTIC_ORDER_PORT } },
  { prefix: "/sport-center",    upstream: null, redirectMapTo: "/bizportal/sport-center",    redirectDefaultSuffix: "/dashboard" },

  { prefix: "/sales",                upstream: null, redirectMapTo: "/bizportal/sales",                redirectDefaultSuffix: "/documents" },
  { prefix: "/purchase",             upstream: null, redirectMapTo: "/bizportal/purchase",              redirectDefaultSuffix: "/documents" },
  { prefix: "/logistics",            upstream: null, redirectMapTo: "/bizportal/logistics",             redirectDefaultSuffix: "/" },
  { prefix: "/accounting",           upstream: null, redirectMapTo: "/bizportal/accounting",            redirectDefaultSuffix: "/journals" },
  { prefix: "/settings",             upstream: null, redirectMapTo: "/bizportal/settings",              redirectDefaultSuffix: "/" },
  { prefix: "/reports",              upstream: null, redirectMapTo: "/bizportal/reports",               redirectDefaultSuffix: "/operasional" },
  { prefix: "/analytics",            upstream: null, redirectMapTo: "/bizportal/analytics",             redirectDefaultSuffix: "/" },
  { prefix: "/holding",              upstream: null, redirectMapTo: "/bizportal/holding",               redirectDefaultSuffix: "/" },
  { prefix: "/expense",              upstream: null, redirectMapTo: "/bizportal/expense",               redirectDefaultSuffix: "/" },
  { prefix: "/expenses",             upstream: null, redirectMapTo: "/bizportal/expense",               redirectDefaultSuffix: "/" },
  { prefix: "/ceo-dashboard",        upstream: null, redirectMapTo: "/bizportal/ceo-dashboard",         redirectDefaultSuffix: "/" },
  { prefix: "/enterprise-dashboard", upstream: null, redirectMapTo: "/bizportal/enterprise-dashboard",  redirectDefaultSuffix: "/" },
  { prefix: "/operational-dashboard",upstream: null, redirectMapTo: "/bizportal/operational-dashboard", redirectDefaultSuffix: "/" },
  { prefix: "/approvals",            upstream: null, redirectMapTo: "/bizportal/approvals",             redirectDefaultSuffix: "/" },
  { prefix: "/notifications",        upstream: null, redirectMapTo: "/bizportal/notifications",         redirectDefaultSuffix: "/" },
  { prefix: "/exceptions",           upstream: null, redirectMapTo: "/bizportal/exceptions",            redirectDefaultSuffix: "/" },
  { prefix: "/correspondences",      upstream: null, redirectMapTo: "/bizportal/correspondences",       redirectDefaultSuffix: "/" },
  { prefix: "/email-inbox",          upstream: null, redirectMapTo: "/bizportal/email-inbox",           redirectDefaultSuffix: "/" },
  { prefix: "/notification-history", upstream: null, redirectMapTo: "/bizportal/notification-history",  redirectDefaultSuffix: "/" },
  { prefix: "/users",                upstream: null, redirectMapTo: "/bizportal/users",                 redirectDefaultSuffix: "/" },
  { prefix: "/org",                  upstream: null, redirectMapTo: "/bizportal/org",                   redirectDefaultSuffix: "/" },
  { prefix: "/media",                upstream: null, redirectMapTo: "/bizportal/media",                 redirectDefaultSuffix: "/" },
  { prefix: "/product-templates",    upstream: null, redirectMapTo: "/bizportal/product-templates",     redirectDefaultSuffix: "/" },
  { prefix: "/katalog-terpadu",      upstream: null, redirectMapTo: "/bizportal/katalog-terpadu",       redirectDefaultSuffix: "/" },
  { prefix: "/vendors",              upstream: null, redirectMapTo: "/bizportal/vendors",               redirectDefaultSuffix: "/" },
  { prefix: "/ecommerce",            upstream: null, redirectMapTo: "/bizportal/ecommerce",             redirectDefaultSuffix: "/" },
  { prefix: "/trading",              upstream: null, redirectMapTo: "/bizportal/trading",               redirectDefaultSuffix: "/" },
  { prefix: "/air-freight/orders",   upstream: null, redirectMapTo: "/bizportal/air-freight/orders",    redirectDefaultSuffix: "" },
  { prefix: "/air-freight/rates",    upstream: null, redirectMapTo: "/bizportal/air-freight/rates",     redirectDefaultSuffix: "" },
  { prefix: "/audit",                upstream: null, redirectMapTo: "/bizportal/audit",                 redirectDefaultSuffix: "/" },
  { prefix: "/intelligence-alerts",  upstream: null, redirectMapTo: "/bizportal/intelligence-alerts",   redirectDefaultSuffix: "/" },
  { prefix: "/ai-approvals",         upstream: null, redirectMapTo: "/bizportal/ai-approvals",          redirectDefaultSuffix: "/" },
  { prefix: "/kasir",                upstream: null, redirectMapTo: "/bizportal/tenant/kasir/companies", redirectDefaultSuffix: "" },
  { prefix: "/pos",                  upstream: null, redirectMapTo: "/bizportal/tenant/pos/branches",    redirectDefaultSuffix: "" },
  { prefix: "/tenant",               upstream: null, redirectMapTo: "/bizportal/tenant",                redirectDefaultSuffix: "/dashboard" },
  { prefix: "/customer-portal",      upstream: null, redirectStrip: "/customer-portal" },
];

const DEFAULT_UPSTREAM = { host: "localhost", port: CUSTOMER_PORT };

const SERVICE_NAMES = {
  [API_PORT]:            "API Server",
  [BIZPORTAL_PORT]:      "BizPortal",
  [CUSTOMER_PORT]:       "Customer Portal",
  [LOGISTIC_ORDER_PORT]: "Logistic Order",
};

// ── Route resolution ──────────────────────────────────────────────────────────

function resolve(url) {
  for (const route of ROUTES) {
    if (url === route.prefix || url.startsWith(route.prefix + "/") || url.startsWith(route.prefix + "?")) {
      return {
        upstream:              route.upstream ?? null,
        stripPrefix:           route.stripPrefix          ?? null,
        redirectStrip:         route.redirectStrip        ?? null,
        redirectMapTo:         route.redirectMapTo        ?? null,
        redirectDefaultSuffix: route.redirectDefaultSuffix ?? "/",
        matchedPrefix:         route.prefix,
      };
    }
  }
  return { upstream: DEFAULT_UPSTREAM, stripPrefix: null, redirectStrip: null,
           redirectMapTo: null, redirectDefaultSuffix: "/", matchedPrefix: null };
}

function rewritePath(url, stripPrefix) {
  if (!stripPrefix) return url;
  if (url === stripPrefix) return "/";
  if (url.startsWith(stripPrefix + "/")) return url.slice(stripPrefix.length) || "/";
  if (url.startsWith(stripPrefix + "?")) return "/" + url.slice(stripPrefix.length);
  return url;
}

// ── Timing helpers ────────────────────────────────────────────────────────────

function delay(ms) { return new Promise(r => setTimeout(r, ms)); }

function backoffMs(attempt) {
  return Math.min(BASE_DELAY * Math.pow(2, attempt) + Math.random() * BASE_DELAY, BACKOFF_CAP);
}

// ── Starting page ─────────────────────────────────────────────────────────────

function startingPage(port, attempt) {
  const name = SERVICE_NAMES[port] ?? `upstream :${port}`;
  return `<!DOCTYPE html>
<html lang="id">
<head>
  <meta charset="utf-8">
  <meta http-equiv="refresh" content="3">
  <title>Menunggu ${name}…</title>
  <style>
    *{box-sizing:border-box;margin:0;padding:0}
    body{display:flex;align-items:center;justify-content:center;min-height:100vh;
         font-family:system-ui,sans-serif;background:#0f172a;color:#e2e8f0}
    .card{text-align:center;padding:2.5rem 3rem;background:#1e293b;
          border-radius:1rem;border:1px solid #334155;max-width:420px}
    .spinner{width:48px;height:48px;border:4px solid #334155;
             border-top-color:#38bdf8;border-radius:50%;margin:0 auto 1.5rem;
             animation:spin 0.9s linear infinite}
    @keyframes spin{to{transform:rotate(360deg)}}
    h1{font-size:1.125rem;font-weight:600;color:#f8fafc;margin-bottom:.5rem}
    p{font-size:.875rem;color:#94a3b8;line-height:1.6}
    .attempt{margin-top:1rem;font-size:.75rem;color:#475569}
  </style>
</head>
<body>
  <div class="card">
    <div class="spinner"></div>
    <h1>${name} sedang starting…</h1>
    <p>Gateway menunggu upstream siap.<br>Halaman akan refresh otomatis.</p>
    <div class="attempt">Percobaan ${attempt} / ${MAX_ATTEMPTS} — port ${port}</div>
  </div>
</body>
</html>`;
}

// ── System endpoints ──────────────────────────────────────────────────────────

/** GET /system/health — gateway liveness only, no external dependencies */
function handleSystemHealth(res) {
  res.writeHead(200, { "content-type": "application/json", "cache-control": "no-store" });
  res.end(JSON.stringify({ status: "up", service: "gateway", ts: new Date().toISOString() }));
}

/** GET /system/global-health  GET /system/control/* → proxy to Watchdog Service */
function proxyToWatchdog(req, res, watchdogPath) {
  const chunks = [];
  req.on("data", c => chunks.push(c));
  req.on("end", () => {
    const body    = Buffer.concat(chunks);
    const wPort   = WATCHDOG_PORT;
    const options = {
      hostname: "127.0.0.1",
      port:     wPort,
      path:     watchdogPath,
      method:   req.method,
      headers:  { ...req.headers, host: `127.0.0.1:${wPort}` },
    };
    const proxy = http.request(options, upstream => {
      res.writeHead(upstream.statusCode ?? 502, upstream.headers);
      upstream.pipe(res, { end: true });
    });
    proxy.on("error", () => {
      if (!res.headersSent) {
        res.writeHead(503, { "content-type": "application/json" });
        res.end(JSON.stringify({
          error:   "watchdog_unavailable",
          message: `Watchdog Service tidak dapat dihubungi (port ${wPort})`,
        }));
      }
    });
    if (body.length) proxy.write(body);
    proxy.end();
  });
}

// ── HTTP proxy with retry ─────────────────────────────────────────────────────

function proxyAttempt(req, upstream, body, rewrittenPath) {
  return new Promise((resolve, reject) => {
    const options = {
      hostname: upstream.host,
      port:     upstream.port,
      path:     rewrittenPath ?? req.url,
      method:   req.method,
      headers:  { ...req.headers, host: `${upstream.host}:${upstream.port}` },
    };
    const proxy = http.request(options, resolve);
    proxy.on("error", reject);
    if (body?.length) proxy.write(body);
    proxy.end();
  });
}

// ── Request handler ───────────────────────────────────────────────────────────

function handleRequest(req, res) {
  const url = req.url ?? "/";

  // Gateway liveness — always inline, no external deps
  if (url === "/system/health" || url.startsWith("/system/health?")) {
    handleSystemHealth(res);
    return;
  }

  // Control plane — forward to Watchdog Service
  if (url === "/system/global-health" || url.startsWith("/system/global-health?")) {
    proxyToWatchdog(req, res, "/global-health");
    return;
  }
  if (url.startsWith("/system/control")) {
    proxyToWatchdog(req, res, url.replace("/system/control", "/control"));
    return;
  }

  // Bare SPA-mount paths (no trailing slash, no query) must redirect to the
  // trailing-slash form — Vite's `base` config only serves under the exact
  // "/prefix/" path and otherwise returns its own 404 hint page.
  const bareUrl = url.split("?")[0];
  if (bareUrl === "/bizportal" || bareUrl === "/logistic-order") {
    const query = url.includes("?") ? url.slice(url.indexOf("?")) : "";
    res.writeHead(302, { location: `${bareUrl}/${query}` });
    res.end();
    return;
  }

  const { upstream, stripPrefix, redirectStrip, redirectMapTo, redirectDefaultSuffix, matchedPrefix } = resolve(url);

  if (redirectStrip) {
    res.writeHead(302, { location: rewritePath(url, redirectStrip) });
    res.end();
    return;
  }

  if (redirectMapTo) {
    const suffix = matchedPrefix ? url.slice(matchedPrefix.length) : "";
    const target = (!suffix || suffix === "/")
      ? (redirectMapTo + redirectDefaultSuffix)
      : (redirectMapTo + suffix);
    res.writeHead(302, { location: target });
    res.end();
    return;
  }

  const rewrittenPath = rewritePath(url, stripPrefix);
  const chunks = [];
  req.on("data", c => chunks.push(c));
  req.on("end", async () => {
    const body = Buffer.concat(chunks);
    let lastErr;
    for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
      try {
        const proxyRes = await proxyAttempt(req, upstream, body, rewrittenPath);
        res.writeHead(proxyRes.statusCode ?? 502, proxyRes.headers);
        proxyRes.pipe(res, { end: true });
        return;
      } catch (err) {
        lastErr = err;
        if (!RETRYABLE_CODES.has(err.code)) break;
        if (attempt === 0) console.warn(`[gw] :${upstream.port} not ready (${err.code}), retrying… (${req.method} ${url})`);
        await delay(backoffMs(attempt));
      }
    }
    const port  = upstream.port;
    const isApi = url.startsWith("/api");
    console.error(`[gw] :${port} unreachable after ${MAX_ATTEMPTS} attempts — ${lastErr?.message}`);
    if (!res.headersSent) {
      if (isApi) {
        res.writeHead(503, { "content-type": "application/json", "retry-after": "5" });
        res.end(JSON.stringify({ error: "upstream_not_ready",
          message: `${SERVICE_NAMES[port] ?? `:${port}`} belum siap, coba lagi.`, port }));
      } else {
        res.writeHead(503, { "content-type": "text/html; charset=utf-8" });
        res.end(startingPage(port, MAX_ATTEMPTS));
      }
    }
  });
}

// ── WebSocket upgrade ─────────────────────────────────────────────────────────

function wsConnect(upstream) {
  return new Promise((resolve, reject) => {
    const sock = net.connect(upstream.port, upstream.host);
    sock.once("connect", () => resolve(sock));
    sock.once("error", reject);
  });
}

async function handleUpgrade(req, socket, head) {
  const { upstream } = resolve(req.url ?? "/");
  if (!upstream) { socket.destroy(); return; }
  let tunnel, lastErr;
  for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
    try { tunnel = await wsConnect(upstream); break; }
    catch (err) {
      lastErr = err;
      if (!RETRYABLE_CODES.has(err.code)) break;
      await delay(backoffMs(attempt));
    }
  }
  if (!tunnel) {
    console.error(`[gw] WS: :${upstream.port} unreachable — ${lastErr?.message}`);
    socket.destroy();
    return;
  }
  tunnel.write(
    `${req.method} ${req.url} HTTP/1.1\r\n` +
    Object.entries(req.headers).map(([k, v]) => `${k}: ${v}`).join("\r\n") + "\r\n\r\n"
  );
  if (head?.length) tunnel.write(head);
  tunnel.on("error", err => { console.error(`[gw] WS tunnel error — ${err.message}`); socket.destroy(); });
  socket.on("error", () => tunnel.destroy());
  tunnel.pipe(socket, { end: true });
  socket.pipe(tunnel, { end: true });
}

// ── Kill port helper (NixOS — no fuser) ──────────────────────────────────────

function killPort(port) {
  const hex    = port.toString(16).toUpperCase().padStart(4, "0");
  const inodes = new Set();
  for (const f of ["/proc/net/tcp6", "/proc/net/tcp"]) {
    try {
      for (const line of fs.readFileSync(f, "utf8").split("\n")) {
        const parts = line.trim().split(/\s+/);
        if (parts[1]?.endsWith(":" + hex)) inodes.add(parts[9]);
      }
    } catch (_) {}
  }
  if (!inodes.size) return;
  try {
    for (const pid of fs.readdirSync("/proc")) {
      if (!/^\d+$/.test(pid)) continue;
      try {
        for (const fd of fs.readdirSync(`/proc/${pid}/fd`)) {
          try {
            const link = fs.readlinkSync(`/proc/${pid}/fd/${fd}`);
            if (link.startsWith("socket:[") && inodes.has(link.slice(8, -1))) {
              try { process.kill(Number(pid), "SIGKILL"); } catch (_) {}
            }
          } catch (_) {}
        }
      } catch (_) {}
    }
  } catch (_) {}
}

// ── Start ─────────────────────────────────────────────────────────────────────

async function startGateway() {
  for (let attempt = 0; attempt < 20; attempt++) {
    const started = await new Promise((resolve) => {
      const srv = http.createServer(handleRequest);
      srv.on("upgrade", handleUpgrade);
      srv.once("error", async (err) => {
        if (err.code === "EADDRINUSE") {
          console.warn(`[gw] Port ${PORT} busy, retrying in 1s… (attempt ${attempt + 1}/20)`);
          srv.close();
          resolve(false);
        } else {
          console.error(`[gw] Fatal: ${err.message}`);
          process.exit(1);
        }
      });
      srv.listen(PORT, "0.0.0.0", () => {
        console.log(`[PORT CHECK] PID=${process.pid} PORT=${PORT} SERVICE=gateway`);
        console.log(`[gw] SYSTEM_MODE=${SYSTEM_MODE} — Gateway listening on port ${PORT} (static topology)`);
        console.log(`[gw]   DATA PLANE:`);
        console.log(`[gw]     /api/*            → :${API_PORT} (API Server)`);
        console.log(`[gw]     /bizportal/*       → :${BIZPORTAL_PORT} (BizPortal)`);
        console.log(`[gw]     /logistic-order/*  → :${LOGISTIC_ORDER_PORT} (Logistic Order)`);
        console.log(`[gw]     /*                 → :${CUSTOMER_PORT} (Customer Portal)`);
        console.log(`[gw]   CONTROL PLANE (→ Watchdog :${WATCHDOG_PORT} — fixed):`);
        console.log(`[gw]     /system/health          → inline liveness`);
        console.log(`[gw]     /system/global-health   → Watchdog /global-health`);
        console.log(`[gw]     /system/control/*       → Watchdog /control/*`);
        resolve(true);
      });
    });
    if (started) return;
    await delay(1000);
  }
  console.error(`[gw] Could not bind port ${PORT} after 20 attempts`);
  process.exit(1);
}

startGateway();
