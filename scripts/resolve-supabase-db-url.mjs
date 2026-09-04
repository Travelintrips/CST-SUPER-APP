/**
 * Resolve the application database without ever consulting the built-in
 * Replit/Helium DATABASE_URL.
 *
 * Development accepts the explicitly matched migration URL or the DEV URL.
 * Production accepts only the production migration/database URL.
 */
export function resolveSupabaseDatabaseUrl() {
  const isProduction =
    process.env.APP_ENV === "production" ||
    process.env.NODE_ENV === "production" ||
    !!process.env.REPLIT_DEPLOYMENT;

  const candidates = isProduction
    ? [
        ["SUPABASE_MIGRATION_URL", process.env.SUPABASE_MIGRATION_URL],
        ["SUPABASE_DATABASE_URL", process.env.SUPABASE_DATABASE_URL],
      ]
    : [
        ["SUPABASE_DATABASE_URL_DEV", process.env.SUPABASE_DATABASE_URL_DEV],
      ];

  for (const [name, value] of candidates) {
    if (typeof value === "string" && /^postgres(?:ql)?:\/\//i.test(value)) {
      return { name, url: value, isProduction };
    }
  }

  if (!isProduction &&
      process.env.SUPABASE_MIGRATION_URL &&
      process.env.SUPABASE_DATABASE_URL_DEV) {
    try {
      const migration = new URL(process.env.SUPABASE_MIGRATION_URL);
      const development = new URL(process.env.SUPABASE_DATABASE_URL_DEV);
      if (
        migration.protocol === development.protocol &&
        migration.hostname.toLowerCase() === development.hostname.toLowerCase() &&
        migration.pathname === development.pathname &&
        decodeURIComponent(migration.username) === decodeURIComponent(development.username)
      ) {
        return {
          name: "SUPABASE_MIGRATION_URL",
          url: process.env.SUPABASE_MIGRATION_URL,
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
      ? "Set SUPABASE_DATABASE_URL or SUPABASE_MIGRATION_URL."
      : "Set SUPABASE_DATABASE_URL_DEV or a matching SUPABASE_MIGRATION_URL."),
  );
}