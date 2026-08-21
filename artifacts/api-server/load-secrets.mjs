/**
 * load-secrets.mjs
 *
 * Bootstrap secret loader — runs ONCE at startup before the API server starts.
 *
 * ┌─────────────────────────────────────────────────────────────────────────────┐
 * │  NEW ARCHITECTURE (single-credential — Phase 5 GCP Bootstrap)               │
 * │                                                                             │
 * │  Replit Secrets (ONE bootstrap credential)                                  │
 * │    GCP_SECRET_MANAGER_BOOTSTRAP_JSON   ← Service Account JSON               │
 * │         ↓ project_id extracted from JSON                                    │
 * │  Google Cloud Secret Manager                                                │
 * │    projects/{project_id}/secrets/cst-super-app-{APP_ENV}/versions/latest   │
 * │         ↓                                                                   │
 * │  load-secrets.mjs (this file)                                               │
 * │    – verifies payload.APP_ENV matches runtime APP_ENV                       │
 * │    – injects all keys into process.env (never overwrites APP_ENV itself)    │
 * │         ↓                                                                   │
 * │  Application (API Server)                                                   │
 * │    reads process.env.SUPABASE_DATABASE_URL (canonical, no _DEV)            │
 * └─────────────────────────────────────────────────────────────────────────────┘
 *
 * ┌─────────────────────────────────────────────────────────────────────────────┐
 * │  LEGACY ARCHITECTURE (three-credential — backward compat)                   │
 * │                                                                             │
 * │  Replit Secrets                                                             │
 * │    GCP_PROJECT_ID + GCP_SECRET_ID + GCP_SECRET_MANAGER_BOOTSTRAP_JSON       │
 * │         ↓                                                                   │
 * │  Google Cloud Secret Manager                                                │
 * │    projects/{GCP_PROJECT_ID}/secrets/{GCP_SECRET_ID}/versions/latest        │
 * │    (single bundle with both prod keys and *_DEV keys mixed)                 │
 * │         ↓                                                                   │
 * │  load-secrets.mjs selects env-appropriate keys                              │
 * │    dev: inject *_DEV keys as canonical names                                │
 * │    prod: inject production keys only                                        │
 * └─────────────────────────────────────────────────────────────────────────────┘
 *
 * Architecture rules (per SECRET_MANAGER_RULES.md):
 *   APP_ENV=production  → production bundle (new) or prod keys (legacy)
 *   APP_ENV=development → dev bundle (new) or *_DEV keys (legacy)
 *   Missing APP_ENV     → STARTUP FAILS (no fallback, no NODE_ENV substitution)
 *   Invalid APP_ENV     → STARTUP FAILS
 *
 * Fail-closed (per SECRET_MANAGER_RULES.md §STARTUP_VALIDATION):
 *   Any missing bootstrap credential → process.exit(1)
 *   Invalid bootstrap JSON          → process.exit(1)
 *   GCP fetch failure               → process.exit(1)
 *   Bundle APP_ENV mismatch (new)   → process.exit(1)
 *   Required secret missing         → process.exit(1)
 *
 * Usage:
 *   node load-secrets.mjs node ./dist/index.mjs        # start app
 *   node load-secrets.mjs --validate                    # dry-run validation only
 */

import { SecretManagerServiceClient } from "@google-cloud/secret-manager";
import { spawn } from "node:child_process";

// ─────────────────────────────────────────────────────────────────────────────
// CONSTANTS
// ─────────────────────────────────────────────────────────────────────────────

const ALLOWED_ENVIRONMENTS = ["development", "production"];
const SAFE_SECRET_VERSION = /^[A-Za-z0-9._-]{1,200}$/;
const SAFE_IDENTITY_VALUE = /^[A-Za-z0-9._-]{1,200}$/;

/**
 * Extract only the non-secret version identifier from Secret Manager's
 * resolved resource name. The payload itself is never involved.
 */
export function extractSecretVersion(resourceName) {
  if (typeof resourceName !== "string") return null;
  const match = resourceName.match(/\/versions\/([^/]+)$/);
  const version = match?.[1] ?? "";
  return SAFE_SECRET_VERSION.test(version) ? version : null;
}

/**
 * Build the non-secret startup identity passed to the child application.
 * Keep this separate from the secret payload so observability cannot
 * accidentally inherit credentials or other bundle values.
 */
export function buildStartupIdentity({
  appEnv,
  projectId,
  bundleId,
  legacyMode,
  secretVersion,
} = {}) {
  const safeValue = (value) =>
    typeof value === "string" && SAFE_IDENTITY_VALUE.test(value) ? value : null;

  return {
    APP_SECRET_ARCHITECTURE_MODE: legacyMode ? "LEGACY" : "NEW",
    APP_SECRET_PROJECT_ID: safeValue(projectId),
    APP_SECRET_BUNDLE_ID: safeValue(bundleId),
    APP_SECRET_BUNDLE_VERSION: safeValue(secretVersion),
    APP_ENV: appEnv === "development" || appEnv === "production" ? appEnv : null,
  };
}

/** Default bundle name prefix for new-architecture bundles. */
const DEFAULT_BUNDLE_PREFIX = "cst-super-app";

/**
 * Required secrets that MUST be present in process.env after loading.
 * Startup fails if any of these is missing or empty.
 */
const REQUIRED_SECRETS = [
  { name: "SESSION_SECRET",          minLen: 32, feature: "Express session signing" },
  { name: "SUPABASE_DATABASE_URL",   minLen: 10, feature: "Database connection" },
];

// ─────────────────────────────────────────────────────────────────────────────
// EXPORTED CORE FUNCTIONS (testable without GCP calls)
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Resolve and validate APP_ENV.
 *
 * NOTE: NODE_ENV is intentionally NOT used as a fallback for secret bundle
 * selection (per master prompt Phase 3 / SECRET_MANAGER_RULES.md).
 * NODE_ENV may still be used by framework libraries for their own purposes.
 *
 * @param {NodeJS.ProcessEnv} env
 * @returns {{ appEnv: string }}
 * @throws if APP_ENV is missing or not in ALLOWED_ENVIRONMENTS
 */
export function resolveEnvironment(env) {
  const appEnv = env.APP_ENV;

  if (!appEnv) {
    throw new Error(
      "APP_ENV is not set.\n" +
      "  Allowed values: development | production\n" +
      "  NODE_ENV is NOT a fallback for secret bundle selection.\n" +
      "  Startup aborted — no environment fallback allowed."
    );
  }

  if (!ALLOWED_ENVIRONMENTS.includes(appEnv)) {
    throw new Error(
      `APP_ENV="${appEnv}" is not valid.\n` +
      `  Allowed values: ${ALLOWED_ENVIRONMENTS.join(" | ")}\n` +
      "  Startup aborted."
    );
  }

  return { appEnv };
}

/**
 * Parse and validate the bootstrap Service Account JSON.
 *
 * Required fields: project_id, client_email, private_key.
 * Never logs the value — only reports which fields are missing.
 *
 * @param {string|undefined} raw  Raw string value of GCP_SECRET_MANAGER_BOOTSTRAP_JSON
 * @returns {{ credentials: object, projectId: string }}
 * @throws if missing, not valid JSON, or missing required SA fields
 */
export function validateBootstrapJson(raw) {
  if (!raw) {
    throw new Error(
      "GCP_SECRET_MANAGER_BOOTSTRAP_JSON is not set.\n" +
      "  This is the ONLY bootstrap credential required in Replit Secrets.\n" +
      "  It must be a GCP Service Account JSON with Secret Manager Secret Accessor role."
    );
  }

  let credentials;
  try {
    credentials = JSON.parse(raw);
  } catch {
    throw new Error(
      "GCP_SECRET_MANAGER_BOOTSTRAP_JSON is not valid JSON.\n" +
      "  Verify the secret value in Replit Secrets is the full Service Account JSON."
    );
  }

  if (typeof credentials !== "object" || Array.isArray(credentials)) {
    throw new Error("GCP_SECRET_MANAGER_BOOTSTRAP_JSON must be a JSON object.");
  }

  const requiredFields = ["project_id", "client_email", "private_key"];
  const missingFields = requiredFields.filter((f) => !credentials[f]);
  if (missingFields.length > 0) {
    throw new Error(
      `GCP_SECRET_MANAGER_BOOTSTRAP_JSON is missing required fields: ${missingFields.join(", ")}\n` +
      "  Ensure the credential is a full GCP Service Account JSON."
    );
  }

  return { credentials, projectId: credentials.project_id };
}

/**
 * Determine which bundle to load and whether we are in legacy mode.
 *
 * New mode  (recommended, single credential):
 *   canonical bootstrap is present and SECRET_MANAGER_LEGACY_MODE is not "1".
 *   Stale GCP_PROJECT_ID/GCP_SECRET_ID values do not override this mode.
 *   Bundle name = "{bundlePrefix}-{APP_ENV}" (e.g. "cst-super-app-development").
 *   project_id comes from the bootstrap JSON.
 *
 * Legacy mode (backward compat, three credentials):
 *   canonical bootstrap is absent and GCP_PROJECT_ID/GCP_SECRET_ID are set,
 *   or SECRET_MANAGER_LEGACY_MODE is explicitly "1".
 *   Bundle name = GCP_SECRET_ID (single mixed bundle with *_DEV suffix keys).
 *   project_id comes from GCP_PROJECT_ID (or bootstrap JSON if different).
 *
 * @param {string} appEnv
 * @param {object} credentials  Parsed bootstrap JSON
 * @param {NodeJS.ProcessEnv} env
 * @returns {{ secretName: string, projectId: string, legacyMode: boolean, bundlePrefix?: string }}
 */
export function resolveBundleName(appEnv, credentials, env) {
  const legacyProjectId = env.GCP_PROJECT_ID;
  const legacySecretId  = env.GCP_SECRET_ID;
  const hasCanonicalBootstrap = Boolean(
    env.GCP_SECRET_MANAGER_BOOTSTRAP_JSON ||
    env.GOOGLE_SECRET_MANAGER_SERVICE_ACCOUNT_JSON,
  );
  const explicitLegacyMode = env.SECRET_MANAGER_LEGACY_MODE === "1";
  // The canonical bootstrap is authoritative. Legacy selectors may remain in
  // an old deployment's environment and must not silently redirect production
  // to replit-app-secrets when the canonical environment bundle is available.
  const legacyMode = !hasCanonicalBootstrap && !!(legacyProjectId && legacySecretId)
    || explicitLegacyMode;

  const projectId = legacyProjectId ?? credentials.project_id;

  if (legacyMode) {
    // Legacy: single bundle, _DEV suffix key selection done in injectSecrets()
    const secretName = `projects/${projectId}/secrets/${legacySecretId}/versions/latest`;
    return { secretName, projectId, legacyMode: true };
  }

  // New mode: separate bundle per environment
  const bundlePrefix = env.GCP_SECRET_BUNDLE_PREFIX ?? DEFAULT_BUNDLE_PREFIX;
  const bundleName   = `${bundlePrefix}-${appEnv}`;
  const secretName   = `projects/${projectId}/secrets/${bundleName}/versions/latest`;
  return { secretName, projectId, legacyMode: false, bundlePrefix, bundleName };
}

/**
 * Inject secret payload into the target env object.
 *
 * New-mode bundles:
 *   Payload has flat keys (no _DEV suffix) and an APP_ENV field.
 *   - Verify payload.APP_ENV === runtime appEnv (fail-closed).
 *   - Inject all string keys EXCEPT APP_ENV (APP_ENV must not be overwritten).
 *
 * Legacy-mode bundles (single mixed bundle):
 *   Same _DEV suffix selection logic as the previous architecture.
 *   - Dev:  inject *_DEV keys as canonical names; inject shared keys (no _DEV variant).
 *   - Prod: inject non-_DEV keys only.
 *
 * @param {Record<string, unknown>} payload  Parsed bundle JSON
 * @param {string}                  appEnv
 * @param {boolean}                 legacyMode
 * @param {Record<string, string>}  target    Mutable env object to inject into
 * @returns {{ injected: number, overridden: number, loadedKeys: string[] }}
 * @throws if new-mode payload.APP_ENV mismatches runtime appEnv
 */
export function injectSecrets(payload, appEnv, legacyMode, target) {
  if (typeof payload !== "object" || Array.isArray(payload)) {
    throw new Error("Secret payload must be a flat JSON object of key-value pairs.");
  }

  let injected   = 0;
  let overridden = 0;
  const loadedKeys = [];

  function inject(key, value) {
    if (key === "APP_ENV") return; // never overwrite runtime APP_ENV
    if (typeof value !== "string") return;
    if (target[key] !== undefined) overridden++;
    else injected++;
    target[key] = value;
    loadedKeys.push(key);
  }

  if (!legacyMode) {
    // ── NEW MODE ──────────────────────────────────────────────────────────────
    // Verify bundle is for the correct environment
    const payloadEnv = payload["APP_ENV"];
    if (payloadEnv && payloadEnv !== appEnv) {
      throw new Error(
        `Bundle environment mismatch: runtime APP_ENV="${appEnv}" but bundle contains APP_ENV="${payloadEnv}".\n` +
        "  This means the wrong bundle was fetched. Startup aborted to prevent cross-environment contamination."
      );
    }
    if (!payloadEnv) {
      if (process.env.SCHEMA_SYNC_REQUIRE_BUNDLE_ENV === "1") {
        throw new Error(
          `Bundle is missing required APP_ENV metadata for schema sync runtime "${appEnv}".\n` +
            "  Add APP_ENV=development or APP_ENV=production to the environment-specific bundle.\n" +
            "  Schema sync aborted to prevent cross-environment contamination."
        );
      }
      // Keep backward compatibility for existing application bundles created
      // before APP_ENV metadata was added. Schema sync enables the strict mode
      // above through its isolated child-process environment.
      console.warn(
        "[load-secrets] WARN: Bundle does not contain APP_ENV field.\n" +
          "  Add APP_ENV to the bundle payload to enable cross-verification."
      );
    }

    // Development bundles may still use the shared-bundle naming convention
    // (`*_DEV`) even when they are fetched through the environment-specific
    // bundle path. Map those values to the canonical names consumed by the
    // application, while keeping production-only values isolated.
    if (appEnv === "development") {
      const hasDevVariant = new Set(
        Object.keys(payload)
          .filter((key) => key.endsWith("_DEV"))
          .map((key) => key.slice(0, -4)),
      );

      // Prefer the development value and expose it under the canonical name.
      for (const [rawKey, value] of Object.entries(payload)) {
        if (!rawKey.endsWith("_DEV")) continue;
        // Keep the suffixed key available for the runtime environment guard
        // and other code paths that explicitly select the development DB.
        inject(rawKey, value);
        inject(rawKey.slice(0, -4), value);
      }

      // Shared values are still available when no development-specific
      // counterpart exists (for example SESSION_SECRET).
      for (const [rawKey, value] of Object.entries(payload)) {
        if (rawKey === "APP_ENV" || rawKey.endsWith("_DEV")) continue;
        if (hasDevVariant.has(rawKey)) continue;
        inject(rawKey, value);
      }
    } else {
      // Production bundles use canonical, non-suffixed names only.
      for (const [key, value] of Object.entries(payload)) {
        if (key.endsWith("_DEV")) continue;
        inject(key, value);
      }
    }
  } else {
    // ── LEGACY MODE ───────────────────────────────────────────────────────────
    const isDev = appEnv === "development";

    if (isDev) {
      // Collect canonical names that have a _DEV counterpart in payload or process.env
      const hasDevVariant = new Set();
      for (const rawKey of Object.keys(payload)) {
        if (rawKey.endsWith("_DEV")) hasDevVariant.add(rawKey.slice(0, -4));
      }
      for (const envKey of Object.keys(target)) {
        if (envKey.endsWith("_DEV")) hasDevVariant.add(envKey.slice(0, -4));
      }

      // Step 1: inject _DEV keys as canonical names AND keep the _DEV suffixed key
      // (legacy parity with new-mode: both SUPABASE_DATABASE_URL_DEV and
      //  SUPABASE_DATABASE_URL are set so the runtime env guard in index.ts
      //  correctly detects that we're using the dev DB, not the prod DB.)
      for (const [rawKey, value] of Object.entries(payload)) {
        if (!rawKey.endsWith("_DEV")) continue;
        const canonical = rawKey.slice(0, -4);
        inject(rawKey, value);      // keep _DEV suffixed key available
        inject(canonical, value);   // also inject as canonical name
      }
      // Fill gaps from process.env _DEV keys
      for (const [envKey, value] of Object.entries(target)) {
        if (!envKey.endsWith("_DEV")) continue;
        const canonical = envKey.slice(0, -4);
        if (loadedKeys.includes(canonical)) continue; // GCP already set it
        if (typeof value === "string" && value) {
          // Already in target from process.env spread; mark as loaded
          loadedKeys.push(canonical);
        }
      }

      // Step 2: inject non-_DEV keys that have no _DEV counterpart (shared keys)
      for (const [rawKey, value] of Object.entries(payload)) {
        if (rawKey.endsWith("_DEV")) continue;
        if (hasDevVariant.has(rawKey)) continue; // isolation enforced
        inject(rawKey, value);
      }
    } else {
      // Production: inject non-_DEV keys only
      for (const [rawKey, value] of Object.entries(payload)) {
        if (rawKey.endsWith("_DEV")) continue;
        inject(rawKey, value);
      }
    }
  }

  return { injected, overridden, loadedKeys };
}

/**
 * Validate that all REQUIRED_SECRETS are present in the env object.
 *
 * @param {Record<string, string|undefined>} env
 * @returns {{ missing: string[], weak: string[] }}
 */
export function validateRequiredSecrets(env) {
  const missing = [];
  const weak    = [];

  for (const { name, minLen = 1 } of REQUIRED_SECRETS) {
    const val = env[name] ?? "";
    if (!val) {
      missing.push(name);
    } else if (val.length < minLen) {
      weak.push(`${name} (length ${val.length} < required ${minLen})`);
    }
  }

  return { missing, weak };
}

// ─────────────────────────────────────────────────────────────────────────────
// MAIN ENTRY POINT
// ─────────────────────────────────────────────────────────────────────────────

async function main() {
  const args = process.argv.slice(2);
  const validateOnly = args[0] === "--validate";
  const cmd          = validateOnly ? [] : args;

  if (!validateOnly && cmd.length === 0) {
    console.error("[load-secrets] ERROR: No command provided.");
    console.error("  Usage: node load-secrets.mjs <cmd> [args...]");
    console.error("         node load-secrets.mjs --validate");
    process.exit(1);
  }

  // ── Phase 1: Resolve APP_ENV ────────────────────────────────────────────────
  let appEnv;
  try {
    ({ appEnv } = resolveEnvironment(process.env));
  } catch (err) {
    console.error("[load-secrets] ERROR:", err.message);
    process.exit(1);
  }
  console.log(`[load-secrets] Environment: ${appEnv}`);

  // ── Phase 2: Validate bootstrap JSON ────────────────────────────────────────
  let credentials, projectId;
  try {
    ({ credentials, projectId } = validateBootstrapJson(
      process.env.GCP_SECRET_MANAGER_BOOTSTRAP_JSON ??
      process.env.GOOGLE_SECRET_MANAGER_SERVICE_ACCOUNT_JSON
    ));
  } catch (err) {
    console.error("[load-secrets] ERROR:", err.message);
    process.exit(1);
  }

  // ── Phase 3: Determine bundle name ──────────────────────────────────────────
  const { secretName, projectId: selectedSecretProjectId, legacyMode, bundleName } =
    resolveBundleName(appEnv, credentials, process.env);
  const selectedSecretBundleId = bundleName ??
    (process.env.GCP_SECRET_ID || (secretName.match(/\/secrets\/([^/]+)\/versions\//)?.[1] ?? null));

  if (legacyMode) {
    console.warn(
      "[load-secrets] WARN: Running in LEGACY MODE (GCP_PROJECT_ID + GCP_SECRET_ID detected).\n" +
      "  To use single-credential mode, create separate GCP bundles:\n" +
      `    cst-super-app-development   (for APP_ENV=development)\n` +
      `    cst-super-app-production    (for APP_ENV=production)\n` +
      "  Then remove GCP_PROJECT_ID and GCP_SECRET_ID from Replit Secrets.\n" +
      "  See docs/GCP_BOOTSTRAP_SECRET_SETUP.md for migration steps."
    );
    console.log(`[load-secrets] GCP project: ${projectId} (from GCP_PROJECT_ID)`);
    console.log(`[load-secrets] Bundle (legacy): ${secretName}`);
    console.log(`[load-secrets] Key strategy: ${appEnv === "development" ? "inject *_DEV keys as canonical names" : "inject production keys only"}`);
  } else {
    console.log(`[load-secrets] GCP project: ${projectId} (from bootstrap JSON)`);
    console.log(`[load-secrets] Bundle: ${bundleName}`);
  }

  // ── Phase 4: Initialize GCP client + fetch secret ───────────────────────────
  console.log(`[load-secrets] Fetching: ${secretName}`);

  const client = new SecretManagerServiceClient({ credentials });

  let secretPayload;
  let resolvedSecretVersion = null;
  try {
    const [version] = await client.accessSecretVersion({ name: secretName });
    secretPayload = version.payload?.data?.toString("utf8");
    resolvedSecretVersion = extractSecretVersion(version.name);
  } catch (err) {
    console.error(`[load-secrets] ERROR: Failed to fetch "${secretName}": ${err.message}`);
    console.error(
      legacyMode
        ? "  Verify GCP_PROJECT_ID, GCP_SECRET_ID, and GCP_SECRET_MANAGER_BOOTSTRAP_JSON."
        : `  Verify the bundle "${bundleName ?? secretName}" exists in GCP Secret Manager\n` +
          "  and the Service Account has Secret Manager Secret Accessor role.\n" +
          "  See docs/GCP_BOOTSTRAP_SECRET_SETUP.md for bundle creation steps."
    );
    process.exit(1);
  }

  if (!secretPayload) {
    console.error("[load-secrets] ERROR: Secret payload is empty.");
    process.exit(1);
  }

  // ── Phase 5: Parse payload ───────────────────────────────────────────────────
  let payload;
  try {
    payload = JSON.parse(secretPayload);
    if (typeof payload !== "object" || Array.isArray(payload)) {
      throw new Error("Payload must be a flat JSON object.");
    }
  } catch (err) {
    console.error(`[load-secrets] ERROR: Secret payload is not a valid JSON object: ${err.message}`);
    process.exit(1);
  }

  // ── Phase 6: Inject secrets ─────────────────────────────────────────────────
  const merged = { ...process.env };
  delete merged.APP_SECRET_BUNDLE_VERSION;
  if (resolvedSecretVersion) {
    // Keep only the non-secret version identifier in the child runtime.
    merged.APP_SECRET_BUNDLE_VERSION = resolvedSecretVersion;
  }
  Object.assign(
    merged,
    buildStartupIdentity({
      appEnv,
      projectId: selectedSecretProjectId,
      bundleId: selectedSecretBundleId,
      legacyMode,
      secretVersion: resolvedSecretVersion,
    }),
  );
  let injectedCount, overriddenCount, loadedKeys;

  try {
    ({ injected: injectedCount, overridden: overriddenCount, loadedKeys } =
      injectSecrets(payload, appEnv, legacyMode, merged));
  } catch (err) {
    console.error("[load-secrets] ERROR:", err.message);
    process.exit(1);
  }

  // ── Phase 7: Validate required secrets ─────────────────────────────────────
  const { missing, weak } = validateRequiredSecrets(merged);

  if (missing.length > 0 || weak.length > 0) {
    if (missing.length > 0) {
      console.error("[load-secrets] ERROR: Required secrets missing after loading:");
      for (const name of missing) console.error(`  Missing: ${name}`);
      console.error(
        legacyMode
          ? `  Ensure these exist in the GCP bundle (with _DEV suffix for development).`
          : `  Ensure these exist in the "${bundleName ?? secretName}" GCP bundle.`
      );
    }
    if (weak.length > 0) {
      console.error("[load-secrets] ERROR: Required secrets are too short (possibly placeholder values):");
      for (const w of weak) console.error(`  Weak: ${w}`);
    }
    process.exit(1);
  }

  // ── Phase 8: Log summary (no values, key names only) ────────────────────────
  console.log(`[load-secrets] Secrets loaded — new: ${injectedCount}, overridden: ${overriddenCount}`);
  if (loadedKeys.length > 0) {
    console.log(`[load-secrets] Injected keys: ${loadedKeys.join(", ")}`);
  }
  console.log("[load-secrets] Required secrets: OK ✓");

  // ── Validate-only mode: stop here ────────────────────────────────────────────
  if (validateOnly) {
    console.log("[load-secrets] --validate complete. All checks passed. Application NOT started.");
    process.exit(0);
  }

  // ── Phase 9: Exec target command with merged env ─────────────────────────────
  const [bin, ...binArgs] = cmd;
  console.log(`[load-secrets] Starting: ${bin} ${binArgs.join(" ")}`);

  const child = spawn(bin, binArgs, { env: merged, stdio: "inherit" });
  child.on("exit", (code, signal) => {
    if (signal) process.kill(process.pid, signal);
    else process.exit(code ?? 0);
  });
  process.on("SIGTERM", () => child.kill("SIGTERM"));
  process.on("SIGINT",  () => child.kill("SIGINT"));
}

// Run main only when executed directly (not when imported by tests)
const isMain = process.argv[1]?.endsWith("load-secrets.mjs");
if (isMain) {
  main().catch((err) => {
    console.error("[load-secrets] Unexpected error:", err.message);
    process.exit(1);
  });
}
