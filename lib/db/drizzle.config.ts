import { defineConfig } from "drizzle-kit";
import path from "path";

function resolveUrl(): string {
  const candidates = [
    // Use the local Replit PostgreSQL first so Replit's publish migration system
    // compares dev-local vs prod-Neon (both empty of app tables) → zero diff.
    // App data lives in Supabase (SUPABASE_DATABASE_URL), not here.
    process.env.DATABASE_URL,
    process.env.SUPABASE_MIGRATION_URL, // direct connection (port 5432) — preferred for DDL
    process.env.SUPABASE_DATABASE_URL,
    process.env.SUPABASE_SESSION_URL,
    process.env.SUPABASE_DIRECT_URL,
    process.env.SUPABASE_PG_URL,
  ];
  for (const url of candidates) {
    if (url && /^postgres(?:ql)?:\/\//i.test(url)) return url;
  }
  throw new Error(
    "No Supabase PostgreSQL URL found. Set SUPABASE_DATABASE_URL or SUPABASE_MIGRATION_URL.",
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
