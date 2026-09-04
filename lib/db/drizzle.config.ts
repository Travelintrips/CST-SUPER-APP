import { defineConfig } from "drizzle-kit";
import path from "path";

function resolveUrl(): string {
  const isProduction = process.env.APP_ENV === "production" ||
    process.env.NODE_ENV === "production" ||
    !!process.env.REPLIT_DEPLOYMENT;
  const candidates = isProduction
    ? [process.env.SUPABASE_MIGRATION_URL, process.env.SUPABASE_DATABASE_URL]
    : [process.env.SUPABASE_MIGRATION_URL, process.env.SUPABASE_DATABASE_URL_DEV];
  for (const url of candidates) {
    if (url && /^postgres(?:ql)?:\/\//i.test(url)) return url;
  }
  throw new Error(
    isProduction
      ? "No production Supabase PostgreSQL URL found. Set SUPABASE_DATABASE_URL or SUPABASE_MIGRATION_URL."
      : "No development Supabase PostgreSQL URL found. Set SUPABASE_DATABASE_URL_DEV or a matching SUPABASE_MIGRATION_URL.",
  );
}

export default defineConfig({
  schema: path.join(__dirname, "./src/schema/index.ts"),
  dialect: "postgresql",
  dbCredentials: {
    url: resolveUrl(),
  },
  // Exclude tables managed outside drizzle (watchdog tables created by the API server
  // at startup via raw SQL, and legacy oauth_states). This prevents Replit's publish
  // migration system from trying to DROP or ALTER these tables in the Neon prod DB.
  tablesFilter: ["!oauth_states", "!service_circuit_states", "!service_registry"],
});
