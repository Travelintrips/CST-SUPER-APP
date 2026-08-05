#!/usr/bin/env node
/**
 * Runtime test database guard.
 *
 * Dedicated test/staging is the preferred target. The only approved shared
 * database exception is the standalone SAFE_DEV_TEST_MODE harness; it never
 * uses this guard's dedicated-target path.
 */

import pg from "pg";

const { Client } = pg;
export const PROD_PROJECT_REF = "nzdweipzckfszczzqtuw";
export const DEV_PROJECT_REF = "xssrfshdrtdfupgqwfdw";

function firstValue(...values) {
  return values.find((value) => typeof value === "string" && value.trim() !== "");
}

export function extractProjectRef(url) {
  if (!url) return null;
  const poolerMatch = url.match(/postgres(?:ql)?:\/\/[^.]+\.([a-z0-9]+):/i);
  if (poolerMatch) return poolerMatch[1];
  const directMatch = url.match(/db\.([a-z0-9]+)\.supabase\.co/i);
  if (directMatch) return directMatch[1];
  return null;
}

function maskProjectRef(ref) {
  if (!ref) return "(unknown)";
  if (ref.length <= 8) return `${ref.slice(0, 3)}…`;
  return `${ref.slice(0, 4)}…${ref.slice(-4)}`;
}

function hostFromUrl(url) {
  try {
    return new URL(url).hostname;
  } catch {
    return "unknown";
  }
}

function providerFromUrl(url) {
  return url.includes("supabase") ? "Supabase PostgreSQL" : "PostgreSQL";
}

function isSameUrl(left, right) {
  return Boolean(left && right && left.trim() === right.trim());
}

export function resolveDedicatedTestConfig({ requireAppSecrets = false } = {}) {
  const url = firstValue(
    process.env.TEST_DATABASE_URL,
    process.env.STAGING_DATABASE_URL,
  );
  if (!url) {
    throw new Error(
      "Dedicated test database is not configured. Set TEST_DATABASE_URL " +
      "(or STAGING_DATABASE_URL); runtime tests never fall back to shared databases.",
    );
  }
  if (!/^postgres(?:ql)?:\/\//i.test(url)) {
    throw new Error("TEST_DATABASE_URL must be a PostgreSQL connection URL.");
  }

  const projectRef = extractProjectRef(url);
  const devProjectRef = extractProjectRef(process.env.SUPABASE_DATABASE_URL_DEV);
  const prodProjectRef = extractProjectRef(process.env.SUPABASE_DATABASE_URL);

  if (projectRef === PROD_PROJECT_REF || projectRef === prodProjectRef || isSameUrl(url, process.env.SUPABASE_DATABASE_URL)) {
    throw new Error(
      "Runtime test target points to the production database; refusing to continue.",
    );
  }
  if (projectRef && projectRef === devProjectRef) {
    throw new Error(
      "Runtime test target points to the development shared database; refusing to continue.",
    );
  }
  if (isSameUrl(url, process.env.SUPABASE_DATABASE_URL_DEV)) {
    throw new Error(
      "Runtime test target equals SUPABASE_DATABASE_URL_DEV; refusing to continue.",
    );
  }

  const requiredSecrets = [
    ["TEST_SUPABASE_URL", process.env.TEST_SUPABASE_URL],
    ["TEST_SUPABASE_ANON_KEY", process.env.TEST_SUPABASE_ANON_KEY],
    ["TEST_SUPABASE_SERVICE_ROLE_KEY", process.env.TEST_SUPABASE_SERVICE_ROLE_KEY],
    ["TEST_STORAGE_BUCKET", process.env.TEST_STORAGE_BUCKET],
  ];
  if (requireAppSecrets) {
    const missing = requiredSecrets.filter(([, value]) => !value?.trim()).map(([key]) => key);
    if (missing.length > 0) {
      throw new Error(
        `Dedicated test integration credentials are incomplete: ${missing.join(", ")}`,
      );
    }
  }

  return {
    url,
    provider: providerFromUrl(url),
    host: hostFromUrl(url),
    projectRef,
    databaseEnvironment: firstValue(
      process.env.TEST_DATABASE_ENVIRONMENT,
      process.env.STAGING_DATABASE_ENVIRONMENT,
      "test",
    ),
    storageConfigured: Boolean(process.env.TEST_STORAGE_BUCKET?.trim()),
  };
}

/**
 * Explicitly identify the owner-approved shared-development exception.
 * This helper is intentionally strict: callers must opt into the standalone
 * harness and must not use it to boot the full API or external workers.
 */
export function isSafeDevTestMode() {
  const enabled = process.env.SAFE_DEV_TEST_MODE === "true";
  const url = firstValue(process.env.SUPABASE_DATABASE_URL_DEV);
  const projectRef = extractProjectRef(url);
  const isDeployment = Boolean(process.env.REPLIT_DEPLOYMENT) ||
    process.env.NODE_ENV === "production";
  return {
    enabled,
    allowed: enabled && !isDeployment && Boolean(url) &&
      projectRef === DEV_PROJECT_REF && projectRef !== PROD_PROJECT_REF,
    projectRef,
    databaseEnvironment: "development",
    externalIntegrations: "mocked",
  };
}

export async function verifyDedicatedTestDatabase({ requireAppSecrets = false } = {}) {
  const config = resolveDedicatedTestConfig({ requireAppSecrets });
  const client = new Client({
    connectionString: config.url,
    ssl: { rejectUnauthorized: false },
    connectionTimeoutMillis: 8_000,
  });

  try {
    await client.connect();
    const result = await client.query(
      "SELECT current_database() AS database_name, current_user AS database_user, version() AS version",
    );
    const row = result.rows[0];
    return {
      ...config,
      databaseName: row.database_name,
      databaseUser: row.database_user,
      postgresVersion: String(row.version).split(" ").slice(0, 2).join(" "),
    };
  } finally {
    await client.end().catch(() => {});
  }
}

function printReport(report) {
  console.log("=".repeat(64));
  console.log("[runtime-db] Environment readiness");
  console.log(`[runtime-db] provider: ${report.provider}`);
  console.log(`[runtime-db] project identifier: ${maskProjectRef(report.projectRef)}`);
  console.log(`[runtime-db] database: ${report.databaseName ?? "(not checked)"}`);
  console.log(`[runtime-db] environment: ${report.databaseEnvironment}`);
  console.log("[runtime-db] production: false");
  console.log("[runtime-db] development shared: false");
  console.log(`[runtime-db] storage configured: ${report.storageConfigured ? "yes" : "no"}`);
  if (report.postgresVersion) console.log(`[runtime-db] server: ${report.postgresVersion}`);
  console.log("=".repeat(64));
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const requireAppSecrets = process.argv.includes("--require-app-secrets");
  try {
    const report = await verifyDedicatedTestDatabase({ requireAppSecrets });
    printReport(report);
    console.log("[runtime-db] Dedicated test database verified.");
  } catch (error) {
    console.error(`[runtime-db] BLOCKED: ${error instanceof Error ? error.message : String(error)}`);
    process.exit(1);
  }
}