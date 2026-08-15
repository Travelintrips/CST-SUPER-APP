/**
 * Shared target resolver for non-Vitest live regression scripts.
 *
 * This module never prints or returns masked credentials; callers use the
 * returned URL only to create their short-lived test pool.
 */

const PROD_PROJECT_REF = "nzdweipzckfszczzqtuw";
const DEFAULT_DEV_PROJECT_REF = "xssrfshdrtdfupgqwfdw";

function extractProjectRef(url) {
  return (
    url.match(/postgres(?:ql)?:\/\/[^.]+\.([a-z0-9]+):/i)?.[1] ??
    url.match(/db\.([a-z0-9]+)\.supabase\.co/i)?.[1] ??
    null
  );
}

export function resolveIsolatedTestDatabaseUrl(env = process.env) {
  const source = env.TEST_DATABASE_URL ? "TEST_DATABASE_URL" : "STAGING_DATABASE_URL";
  const url = env.TEST_DATABASE_URL ?? env.STAGING_DATABASE_URL;
  if (!url) {
    throw new Error(
      "[test-db] BLOCKED: set TEST_DATABASE_URL or STAGING_DATABASE_URL; " +
      "live regression scripts never fall back to DEV, PROD, or Helium/Replit.",
    );
  }

  let parsed;
  try {
    parsed = new URL(url);
  } catch {
    throw new Error(`[test-db] BLOCKED: ${source} is not a valid PostgreSQL URL.`);
  }

  const host = parsed.hostname.toLowerCase();
  if (
    !["postgres:", "postgresql:"].includes(parsed.protocol) ||
    host.includes("helium") ||
    host.includes("replit") ||
    host === "localhost" ||
    host === "127.0.0.1" ||
    host === "::1" ||
    (!host.endsWith(".supabase.co") && !host.endsWith(".supabase.com"))
  ) {
    throw new Error(
      "[test-db] BLOCKED: target must be an isolated Supabase PostgreSQL database, " +
      "not Helium/Replit/local/shared DB.",
    );
  }

  const projectRef = extractProjectRef(url);
  const reservedRefs = new Set([
    PROD_PROJECT_REF,
    env.SUPABASE_DEV_PROJECT_REF ?? DEFAULT_DEV_PROJECT_REF,
  ]);
  if (projectRef && reservedRefs.has(projectRef)) {
    throw new Error("[test-db] BLOCKED: target points to a reserved DEV/PROD Supabase project.");
  }

  return url;
}