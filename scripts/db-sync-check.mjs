#!/usr/bin/env node
/**
 * Legacy Replit/Helium sync command.
 *
 * It is intentionally fail-closed: application data has one authoritative
 * database (Supabase), so this command must not inspect or mutate a second
 * database. Use the Supabase migration/audit commands for schema work.
 */
console.error(
  "DB sync aborted: the legacy Replit/Helium database synchronization tool is disabled. " +
  "Supabase is the only application database.",
);
process.exit(1);