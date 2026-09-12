import { defineConfig } from "vitest/config";

// NOTE: The .mjs files under tests/ and src/**/__tests__/ use a non-vitest runner
// (TAP/custom integration scripts that require a live DB and HTTP server). They are
// intentionally excluded here — run them separately with `node tests/<file>.mjs`.
export default defineConfig({
  test: {
    include: ["src/**/__tests__/**/*.test.ts", "load-secrets.test.mjs"],
    environment: "node",
    // Serial files prevent independent tests from contending over the isolated
    // staging fixtures and pgBouncer connections; this is not a timeout
    // workaround. src/test-setup.ts rejects every shared/local fallback.
    fileParallelism: false,
    maxWorkers: 1,
    minWorkers: 1,
    // Per-worker teardown: closes the pg Pool after every test file so the
    // process can exit cleanly without --forceExit or artificial delays.
    // DB-backed test files call getIsolatedTestDatabaseUrl() before opening a
    // direct pool. Pure-logic files remain runnable without staging.
    setupFiles: ["./src/__tests__/vitest.setup.ts"],
    // Global teardown: explicitly closes the pg pool after all tests finish.
    globalSetup: ["./vitest.global.setup.ts"],
  },
});
