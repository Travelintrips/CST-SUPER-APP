/**
 * Returns true when running inside a Vitest worker or any test environment.
 *
 * Checks four independent signals so the helper works regardless of how the
 * test runner sets the flags:
 *   1. NODE_ENV === "test"
 *   2. VITEST === "true"  (set by Vitest on the main runner thread)
 *   3. VITEST_WORKER_ID is defined (set by Vitest on every worker)
 *   4. VITEST_POOL_ID is defined (set on fork/thread pool workers)
 *
 * Use this — not raw env checks — in logger, DB pool, scheduler, and any
 * module that must behave differently during tests.
 */
export function isTestEnvironment(): boolean {
  return (
    process.env.NODE_ENV === "test" ||
    process.env.VITEST === "true" ||
    process.env.VITEST_WORKER_ID !== undefined ||
    process.env.VITEST_POOL_ID !== undefined
  );
}
