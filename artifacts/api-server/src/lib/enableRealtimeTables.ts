import { logger } from "./logger";

/**
 * Supabase Realtime table enablement — no-op on Replit.
 * Previously used to enable Supabase Realtime publications.
 * On Replit, the database is Replit PostgreSQL which does not use Supabase publications.
 */
export async function enableRealtimeTables(): Promise<void> {
  logger.info("enableRealtimeTables: skipped (not using Supabase Realtime)");
}
