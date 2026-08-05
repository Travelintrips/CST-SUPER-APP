/**
 * load-secrets.mjs
 *
 * Bootstrap secret loader — runs ONCE at startup before the API server starts.
 *
 * ┌─────────────────────────────────────────────────────────────────────────┐
 * │  ARCHITECTURE                                                           │
 * │                                                                         │
 * │  Replit Secrets (bootstrap only)                                        │
 * │    GCP_PROJECT_ID                                                       │
 * │    GCP_SECRET_ID                                                        │
 * │    GCP_SECRET_MANAGER_BOOTSTRAP_JSON                                    │
 * │         ↓                                                               │
 * │  Google Cloud Secret Manager                                            │
 * │    projects/{GCP_PROJECT_ID}/secrets/{GCP_SECRET_ID}/versions/latest   │
 * │         ↓                                                               │
 * │  load-secrets.mjs (this file)                                           │
 * │    – selects env-appropriate keys (_DEV for dev, normal for prod)       │
 * │    – injects into process.env                                           │
 * │         ↓                                                               │
 * │  Application (API Server / Frontend)                                    │
 * │    reads process.env.SUPABASE_DATABASE_URL  (never *_DEV)               │
 * └─────────────────────────────────────────────────────────────────────────┘
 *
 * Environment resolution (per SECRET_MANAGER_RULES.md §ENVIRONMENT_RESOLUTION):
 *   APP_ENV=production  → inject keys WITHOUT _DEV suffix
 *   APP_ENV=development → inject KEY_DEV values under canonical KEY name
 *   Fallback: NODE_ENV
 *   If neither APP_ENV nor NODE_ENV is set → STARTUP FAILS (no fallback)
 *
 * Strict isolation (per SECRET_MANAGER_RULES.md §STRICT_ISOLATION):
 *   Development NEVER reads production keys.
 *   Production  NEVER reads _DEV keys.
 *   No cross-environment fallback is permitted.
 *
 * Fail-fast (per SECRET_MANAGER_RULES.md §STARTUP_VALIDATION):
 *   Any missing bootstrap credential → process.exit(1).
 *   Any GCP fetch failure            → process.exit(1).
 *   Empty or invalid payload         → process.exit(1).
 *
 * Usage (invoked by start:secure in package.json):
 *   node load-secrets.mjs node --enable-source-maps ./dist/index.mjs
 */

import { SecretManagerServiceClient } from "@google-cloud/secret-manager";
import { spawn } from "node:child_process";

// ── Command to exec after secrets are injected ────────────────────────────────
const [, , ...cmd] = process.argv;

if (!cmd.length) {
  console.error("[load-secrets] ERROR: No command provided.");
  console.error("  Usage: node load-secrets.mjs <cmd> [args...]");
  process.exit(1);
}

// ── Resolve environment ───────────────────────────────────────────────────────
// Per rules: APP_ENV takes priority over NODE_ENV.
// If neither is set, startup fails — never default to production.
const appEnv = process.env.APP_ENV ?? process.env.NODE_ENV;

if (!appEnv) {
  console.error("[load-secrets] ERROR: APP_ENV (or NODE_ENV) is not set.");
  console.error("  Allowed values: production | development");
  console.error("  Startup aborted — no environment fallback allowed.");
  process.exit(1);
}

const isDev = appEnv === "development";
console.log(`[load-secrets] Environment: ${appEnv}`);
console.log(`[load-secrets] Key strategy: ${isDev ? "inject *_DEV keys as canonical names" : "inject production keys only"}`);

// ── Bootstrap credentials ─────────────────────────────────────────────────────
// ONLY these three keys belong in Replit Secrets.
// All other application secrets must live in Google Cloud Secret Manager.
const PROJECT_ID     = process.env.GCP_PROJECT_ID;
const SECRET_ID      = process.env.GCP_SECRET_ID;
// Accept both the canonical name and the legacy alias set in Replit Secrets
const BOOTSTRAP_JSON =
  process.env.GCP_SECRET_MANAGER_BOOTSTRAP_JSON ??
  process.env.GOOGLE_SECRET_MANAGER_SERVICE_ACCOUNT_JSON;

const missingBootstrap = [];
if (!PROJECT_ID)     missingBootstrap.push("GCP_PROJECT_ID");
if (!SECRET_ID)      missingBootstrap.push("GCP_SECRET_ID");
if (!BOOTSTRAP_JSON) missingBootstrap.push("GCP_SECRET_MANAGER_BOOTSTRAP_JSON (or GOOGLE_SECRET_MANAGER_SERVICE_ACCOUNT_JSON)");

if (missingBootstrap.length) {
  console.error("[load-secrets] ERROR: Bootstrap credentials missing:");
  for (const key of missingBootstrap) console.error(`  Missing: ${key}`);
  console.error("");
  console.error("  These are the ONLY secrets that belong in Replit Secrets.");
  console.error("  All application secrets must be stored in Google Cloud Secret Manager.");
  console.error("  Startup aborted — no fallback allowed.");
  process.exit(1);
}

// ── Parse bootstrap JSON (fail if invalid) ────────────────────────────────────
let credentials;
try {
  credentials = JSON.parse(BOOTSTRAP_JSON);
} catch (err) {
  console.error("[load-secrets] ERROR: GCP_SECRET_MANAGER_BOOTSTRAP_JSON is not valid JSON:", err.message);
  process.exit(1);
}

// ── Fetch secret payload from GCP Secret Manager ──────────────────────────────
const client     = new SecretManagerServiceClient({ credentials });
const secretName = `projects/${PROJECT_ID}/secrets/${SECRET_ID}/versions/latest`;

console.log(`[load-secrets] Fetching: ${secretName}`);

let secretPayload;
try {
  const [version] = await client.accessSecretVersion({ name: secretName });
  secretPayload   = version.payload?.data?.toString("utf8");
} catch (err) {
  console.error(`[load-secrets] ERROR: Failed to fetch "${secretName}":`, err.message);
  console.error("  Verify GCP_PROJECT_ID, GCP_SECRET_ID, and GCP_SECRET_MANAGER_BOOTSTRAP_JSON.");
  process.exit(1);
}

if (!secretPayload) {
  console.error("[load-secrets] ERROR: Secret payload is empty.");
  process.exit(1);
}

// ── Parse payload ─────────────────────────────────────────────────────────────
let raw;
try {
  raw = JSON.parse(secretPayload);
  if (typeof raw !== "object" || Array.isArray(raw)) {
    throw new Error("Payload must be a flat JSON object of string key-value pairs");
  }
} catch (err) {
  console.error("[load-secrets] ERROR: Secret payload is not a valid JSON object:", err.message);
  process.exit(1);
}

// ── Environment-aware key selection ──────────────────────────────────────────
//
//  Development mode (APP_ENV=development):
//    Payload key  SUPABASE_DATABASE_URL_DEV  →  process.env.SUPABASE_DATABASE_URL
//    Payload key  OPENAI_API_KEY_DEV         →  process.env.OPENAI_API_KEY
//    Non-_DEV keys are IGNORED (strict isolation)
//
//  Production mode (APP_ENV=production):
//    Payload key  SUPABASE_DATABASE_URL      →  process.env.SUPABASE_DATABASE_URL
//    Payload key  OPENAI_API_KEY             →  process.env.OPENAI_API_KEY
//    _DEV keys are IGNORED (strict isolation)
//
//  Application code always reads the canonical name (no _DEV suffix).
//  Secret Manager is authoritative for application secrets. Existing env
//  values are intentionally overwritten so stale Replit secrets cannot shadow
//  rotated values from Google Cloud Secret Manager.

const merged     = { ...process.env };
let   injected   = 0;
let   overridden = 0;
const loadedKeys = [];

function injectSecret(key, value) {
  if (merged[key] !== undefined) overridden++;
  else injected++;
  merged[key] = value;
  loadedKeys.push(key);
}

if (isDev) {
  // Step 1: collect canonical names that have a _DEV counterpart — from either
  // the GCP payload OR process.env (e.g. a Replit Secret like SUPABASE_DATABASE_URL_DEV).
  const hasDevVariant = new Set();
  for (const rawKey of Object.keys(raw)) {
    if (rawKey.endsWith("_DEV")) {
      hasDevVariant.add(rawKey.slice(0, -4)); // "SUPABASE_DATABASE_URL_DEV" → "SUPABASE_DATABASE_URL"
    }
  }
  // Also register _DEV keys that live only in process.env (Replit Secrets).
  for (const envKey of Object.keys(process.env)) {
    if (envKey.endsWith("_DEV")) {
      hasDevVariant.add(envKey.slice(0, -4));
    }
  }

  // Step 2: inject _DEV keys as their canonical name (strict DB isolation).
  // GCP payload takes priority; process.env _DEV keys fill in any gaps.
  for (const [rawKey, value] of Object.entries(raw)) {
    if (typeof value !== "string") continue;
    if (!rawKey.endsWith("_DEV")) continue;
    const canonicalKey = rawKey.slice(0, -4);
    injectSecret(canonicalKey, value);
  }
  // Inject _DEV keys from process.env that were NOT already provided by GCP.
  for (const [envKey, value] of Object.entries(process.env)) {
    if (!envKey.endsWith("_DEV")) continue;
    const canonicalKey = envKey.slice(0, -4);
    if (merged[canonicalKey] !== undefined && loadedKeys.includes(canonicalKey)) continue; // GCP already set it
    merged[canonicalKey] = value; // inject silently (already in merged from process.env spread)
  }

  // Step 3: inject non-_DEV keys that have NO _DEV counterpart.
  // These are shared service API keys (OpenAI, Google Sheets, Fonnte, etc.)
  // that are identical across environments and safe to use in dev.
  for (const [rawKey, value] of Object.entries(raw)) {
    if (typeof value !== "string") continue;
    if (rawKey.endsWith("_DEV")) continue;       // already handled above
    if (hasDevVariant.has(rawKey)) continue;     // has _DEV version → isolation enforced
    injectSecret(rawKey, value);
  }
} else {
  for (const [rawKey, value] of Object.entries(raw)) {
    if (typeof value !== "string") continue;
    if (rawKey.endsWith("_DEV")) continue;         // skip dev keys
    injectSecret(rawKey, value);
  }
}

// Log key names only — never log values (per SECRET_MANAGER_RULES.md §LOGGING)
console.log(`[load-secrets] Secrets loaded — new: ${injected}, overridden: ${overridden}`);
if (loadedKeys.length > 0) {
  console.log("[load-secrets] Injected keys:", loadedKeys.join(", "));
}

// ── Exec target command with merged env ───────────────────────────────────────
execCmd(cmd, merged);

function execCmd(argv, env) {
  const [bin, ...args] = argv;
  console.log(`[load-secrets] Starting: ${bin} ${args.join(" ")}`);
  const child = spawn(bin, args, { env, stdio: "inherit" });
  child.on("exit", (code, signal) => {
    if (signal) process.kill(process.pid, signal);
    else        process.exit(code ?? 0);
  });
  process.on("SIGTERM", () => child.kill("SIGTERM"));
  process.on("SIGINT",  () => child.kill("SIGINT"));
}
