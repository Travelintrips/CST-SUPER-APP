/**
 * Shared guard for reconciliation-related background workers.
 *
 * Development uses a single database connection. Running an automatic sheet
 * reconciliation loop by default makes interactive requests compete with the
 * same connection, so development must opt in explicitly.
 */
export function isReconciliationWorkerEnabled(): boolean {
  if (
    process.env.DISABLE_BACKGROUND_WORKERS === "true" ||
    process.env.DISABLE_RECONCILIATION_WORKER === "true" ||
    process.env.SAFE_DEV_TEST_MODE === "true"
  ) {
    return false;
  }

  if (
    process.env.APP_ENV === "development" &&
    process.env.RECONCILIATION_WORKER_ENABLED !== "true"
  ) {
    return false;
  }

  return true;
}

export function isDevelopmentEnvironment(): boolean {
  return process.env.APP_ENV === "development" || process.env.NODE_ENV !== "production";
}

export function positiveIntEnv(name: string, fallback: number, max = Number.MAX_SAFE_INTEGER): number {
  const parsed = Number.parseInt(process.env[name] ?? "", 10);
  if (!Number.isFinite(parsed) || parsed < 1) return fallback;
  return Math.min(parsed, max);
}