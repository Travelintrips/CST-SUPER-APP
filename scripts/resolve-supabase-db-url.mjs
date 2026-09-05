/**
 * Resolve the application database without ever consulting the built-in
 * Replit/Helium DATABASE_URL.
 *
 * Development accepts the DEV URL.
 * Production approvals and maintenance always use SUPABASE_DATABASE_URL.
 * SUPABASE_MIGRATION_URL is never an implicit production fallback.
 */
function parsePostgresUrl(name, value) {
  if (typeof value !== "string" || !value.trim()) return null;
  if (!/^postgres(?:ql)?:\/\//i.test(value)) {
    throw new Error(`${name} must be a PostgreSQL URL.`);
  }
  try {
    return new URL(value);
  } catch {
    throw new Error(`${name} is not a valid PostgreSQL URL.`);
  }
}

export function resolveProductionSupabaseDatabaseUrl(env = process.env) {
  parsePostgresUrl(
    "SUPABASE_DATABASE_URL",
    env.SUPABASE_DATABASE_URL,
  );
  if (!env.SUPABASE_DATABASE_URL?.trim()) {
    throw new Error(
      "Production database resolution requires SUPABASE_DATABASE_URL; " +
      "SUPABASE_MIGRATION_URL cannot be used as an implicit approval target.",
    );
  }

  return {
    name: "SUPABASE_DATABASE_URL",
    url: env.SUPABASE_DATABASE_URL,
    isProduction: true,
  };
}

export function resolveSupabaseDatabaseUrl(env = process.env) {
  const isProduction =
    env.APP_ENV === "production" ||
    env.NODE_ENV === "production" ||
    !!env.REPLIT_DEPLOYMENT;

  if (isProduction) {
    return resolveProductionSupabaseDatabaseUrl(env);
  }

  const candidates = [
    ["SUPABASE_DATABASE_URL_DEV", env.SUPABASE_DATABASE_URL_DEV],
  ];

  for (const [name, value] of candidates) {
    if (typeof value === "string" && /^postgres(?:ql)?:\/\//i.test(value)) {
      return { name, url: value, isProduction };
    }
  }

  if (env.SUPABASE_MIGRATION_URL && env.SUPABASE_DATABASE_URL_DEV) {
    try {
      const migration = parsePostgresUrl("SUPABASE_MIGRATION_URL", env.SUPABASE_MIGRATION_URL);
      const development = parsePostgresUrl("SUPABASE_DATABASE_URL_DEV", env.SUPABASE_DATABASE_URL_DEV);
      if (
        migration.protocol === development.protocol &&
        migration.hostname.toLowerCase() === development.hostname.toLowerCase() &&
        migration.pathname === development.pathname &&
        decodeURIComponent(migration.username) === decodeURIComponent(development.username)
      ) {
        return {
          name: "SUPABASE_MIGRATION_URL",
          url: env.SUPABASE_MIGRATION_URL,
          isProduction,
        };
      }
    } catch {
      // Fall through to the explicit missing/mismatch error below.
    }
  }

  const environment = isProduction ? "production" : "development";
  throw new Error(
    `No Supabase ${environment} database URL configured. ` +
    (isProduction
      ? "Set SUPABASE_DATABASE_URL."
      : "Set SUPABASE_DATABASE_URL_DEV or a matching SUPABASE_MIGRATION_URL."),
  );
}