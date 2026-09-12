import { logger } from "./logger";

export interface BackfillSportCenterResult {
  total: number;
  posted: number;
  skipped: number;
  errors: number;
  entriesLinked: number;
  entriesMissing: number;
}

/**
 * Legacy compatibility boundary.
 *
 * Sport Center accounting is isolated until the Supabase payment-trigger
 * phase. Keep this export so old callers remain source-compatible, but never
 * backfill or create accounting rows from the CST application.
 */
export async function backfillSportCenterAccountingPayments(): Promise<BackfillSportCenterResult> {
  logger.info("[backfill] Sport Center accounting isolated — no accounting rows created");
  return { total: 0, posted: 0, skipped: 0, errors: 0, entriesLinked: 0, entriesMissing: 0 };
}
