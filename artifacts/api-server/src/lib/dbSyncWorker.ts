import { logger } from "./logger.js";

/**
 * The former worker copied schema from the Replit/Helium database into
 * Supabase. Application data has one authoritative store now, so a background
 * worker must never inspect or mutate a second database.
 */
export async function runDbSyncCheck(): Promise<{
  missing: string[];
  applied: string[];
  failed: string[];
}> {
  logger.info("[dbSyncWorker] disabled: Supabase is the only application database");
  return { missing: [], applied: [], failed: [] };
}

export function startDbSyncWorker(): void {
  logger.info("[dbSyncWorker] disabled: no Replit/Helium database synchronization");
}