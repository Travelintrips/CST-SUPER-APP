/**
 * Shared Vitest test-target guard.
 *
 * The API regression suite is allowed to mutate test fixtures, so it must use
 * an explicitly provisioned isolated Supabase project. Never fall back to
 * DATABASE_URL, SUPABASE_DATABASE_URL_DEV, or SUPABASE_DATABASE_URL here.
 */

const PROD_PROJECT_REF = "nzdweipzckfszczzqtuw";
const DEFAULT_DEV_PROJECT_REF = "xssrfshdrtdfupgqwfdw";

export type TestTargetEnv = NodeJS.ProcessEnv;

function extractProjectRef(url: string): string | null {
  const poolerMatch = url.match(/postgres(?:ql)?:\/\/[^.]+\.([a-z0-9]+):/i);
  if (poolerMatch) return poolerMatch[1];
  const directMatch = url.match(/db\.([a-z0-9]+)\.supabase\.co/i);
  return directMatch?.[1] ?? null;
}

function isSameUrl(left: string | undefined, right: string | undefined): boolean {
  if (!left || !right) return false;
  try {
    return new URL(left).toString() === new URL(right).toString();
  } catch {
    return left === right;
  }
}

/**
 * Resolve and validate the only database targets accepted by the regression
 * suite. The returned value is safe to use as a connection string; it is
 * intentionally never logged.
 */
export function getIsolatedTestDatabaseUrl(env: TestTargetEnv = process.env): string {
  const source = env.TEST_DATABASE_URL ? "TEST_DATABASE_URL" : "STAGING_DATABASE_URL";
  const url = env.TEST_DATABASE_URL ?? env.STAGING_DATABASE_URL;

  if (!url) {
    throw new Error(
      "[test-db] BLOCKED: the API regression suite requires TEST_DATABASE_URL or STAGING_DATABASE_URL. " +
      "It will not fall back to Helium/Replit, DEV, or PROD.",
    );
  }

  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    throw new Error(`[test-db] BLOCKED: ${source} is not a valid PostgreSQL URL.`);
  }

  if (!["postgres:", "postgresql:"].includes(parsed.protocol)) {
    throw new Error(`[test-db] BLOCKED: ${source} must use postgres:// or postgresql://.`);
  }

  const host = parsed.hostname.toLowerCase();
  if (
    host.includes("helium") ||
    host.includes("replit") ||
    host === "localhost" ||
    host === "127.0.0.1" ||
    host === "::1"
  ) {
    throw new Error(
      `[test-db] BLOCKED: ${source} points to a built-in/local Replit database. ` +
      "Provision an isolated Supabase staging project instead.",
    );
  }

  if (!host.endsWith(".supabase.co") && !host.endsWith(".supabase.com")) {
    throw new Error(
      `[test-db] BLOCKED: ${source} is not a Supabase database host. ` +
      "The regression suite requires an isolated Supabase target.",
    );
  }

  if (
    isSameUrl(url, env.DATABASE_URL) ||
    isSameUrl(url, env.SUPABASE_DATABASE_URL_DEV) ||
    isSameUrl(url, env.SUPABASE_DATABASE_URL)
  ) {
    throw new Error(
      `[test-db] BLOCKED: ${source} aliases a shared DEV/PROD database variable. ` +
      "Use a separately provisioned staging project URL.",
    );
  }

  const projectRef = extractProjectRef(url);
  const devProjectRef = env.SUPABASE_DEV_PROJECT_REF ?? DEFAULT_DEV_PROJECT_REF;
  if (projectRef && (projectRef === PROD_PROJECT_REF || projectRef === devProjectRef)) {
    throw new Error(
      `[test-db] BLOCKED: ${source} points to a reserved DEV/PROD Supabase project (${projectRef}). ` +
      "Use a distinct staging project.",
    );
  }

  console.log(`[test-db] isolated target accepted: source=${source}, project=${projectRef ?? "unknown"}`);
  return url;
}
