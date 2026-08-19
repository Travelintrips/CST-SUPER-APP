import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { getApiRevision } from "../lib/buildMetadata.js";

const apiIndex = readFileSync(resolve(process.cwd(), "src/index.ts"), "utf8");
const rlsMigration = readFileSync(resolve(process.cwd(), "src/lib/rlsMigration.ts"), "utf8");
const startupState = readFileSync(resolve(process.cwd(), "src/lib/startupMigrationState.ts"), "utf8");
const startupRegistry = readFileSync(resolve(process.cwd(), "src/lib/startupMigrationRegistry.ts"), "utf8");
const healthRoute = readFileSync(resolve(process.cwd(), "src/routes/health.ts"), "utf8");
const buildMetadata = readFileSync(resolve(process.cwd(), "src/lib/buildMetadata.ts"), "utf8");
const bankImport = readFileSync(resolve(process.cwd(), "src/routes/bankMutationImport.ts"), "utf8");
const bankMasters = readFileSync(resolve(process.cwd(), "src/routes/bankMutationMasters.ts"), "utf8");
const sportMigration = readFileSync(resolve(process.cwd(), "src/modules/sport-center/migration.ts"), "utf8");

describe("startup readiness steady-state contract", () => {
  it("installs additive Sport Center repair DDL before skipping the legacy pre-start pass", () => {
    const preStartBlockStart = apiIndex.indexOf(
      "async function runCriticalPreStartMigrations()",
    );
    const preStartBlockEnd = apiIndex.indexOf(
      "// Flag set to true once the full migration + seed chain completes.",
    );
    const preStartBlock = apiIndex.slice(preStartBlockStart, preStartBlockEnd);
    const mirrorInstaller = preStartBlock.indexOf(
      "await ensureSportPaymentMirrorTrigger();",
    );
    const guard = preStartBlock.indexOf(
      'isStartupMigrationComplete(\n    "api_pre_start_schema",\n    PRE_START_SCHEMA_BOOTSTRAP_VERSION,\n  )',
    );
    const earlyReturn = preStartBlock.indexOf(
      "if (preStartAlreadyComplete)",
    );
    const marker = preStartBlock.indexOf(
      'markStartupMigrationComplete(\n    "api_pre_start_schema"',
    );

    expect(mirrorInstaller).toBeGreaterThan(-1);
    expect(guard).toBeGreaterThan(-1);
    expect(guard).toBeLessThan(mirrorInstaller);
    expect(mirrorInstaller).toBeLessThan(earlyReturn);
    expect(marker).toBeGreaterThan(guard);
    expect(apiIndex).toContain("repeated DDL/backfill skipped");
    expect(apiIndex).toContain("Critical API pre-start schema bootstrap and legacy compatibility columns");
  });

  it("uses a dedicated persistent state table with explicit lifecycle states", () => {
    expect(startupState).toContain("CREATE TABLE IF NOT EXISTS startup_migration_state");
    expect(startupState).toContain("stage_name    TEXT PRIMARY KEY");
    expect(startupState).toContain("status        TEXT NOT NULL DEFAULT 'pending'");
    expect(startupState).toContain("'pending', 'running', 'completed', 'failed'");
    expect(startupState).toContain("stage_version TEXT NOT NULL");
    expect(startupState).toContain("last_error    TEXT");
    expect(startupState).toContain("ON CONFLICT (stage_name) DO UPDATE SET");
  });

  it("takes a per-stage advisory lock and re-checks after locking", () => {
    expect(startupState).toContain("pg_try_advisory_lock");
    expect(startupState).toContain("pg_advisory_unlock");
    expect(startupState).toContain("Mandatory TOCTOU re-check after acquiring the per-stage lock");
    expect(startupState).toContain("LOCK_WAIT_TIMEOUT_MS");
  });

  it("bulk-loads the registry and only uses the snapshot for completed version matches", () => {
    expect(startupState).toContain("primeStartupMigrationRegistry");
    expect(startupState).toContain("SELECT stage_name, stage_version, status");
    expect(startupState).toContain('lookupSource: "bulk_snapshot"');
    expect(startupState).toContain('= "database"');
    expect(startupState).toContain('snapshotState?.status === "completed"');
    expect(startupState).toContain("storedVersion = await readCompletedVersion(stage.name)");
    expect(startupState).toContain("status === \"failed\"");
    expect(startupState).toContain("status === \"running\"");
  });

  it("only marks completion after success and records failures safely", () => {
    expect(startupState).toContain("await run()");
    expect(startupState).toContain("updateState(stage.name, stage.version, \"completed\", null, lock)");
    expect(startupState).toContain("updateState(stage.name, stage.version, \"failed\", sanitizeError(error), lock)");
    expect(startupState).toContain("process crash");
  });

  it("reuses the stage-lock client for nested compatibility markers", () => {
    expect(startupState).toContain("await ensureStartupStateStore(context?.client)");
    expect(startupState).toContain("readCompletedVersion(name, context?.client)");
    expect(startupState).toContain("updateState(name, version, \"completed\", null, context.client)");
    expect(startupState).toContain("await updateState(stage.name, stage.version, \"completed\", null, lock)");
  });

  it("exposes only a safe configured API revision on healthz", () => {
    expect(healthRoute).toContain("revision: getApiRevision()");
    expect(buildMetadata).toContain("REPLIT_DEPLOYMENT_REVISION");
    expect(buildMetadata).toContain("SAFE_REVISION");
    expect(buildMetadata).toContain('"unknown"');
    expect(buildMetadata).not.toContain("JSON.stringify(process.env");
    expect(getApiRevision({ REPLIT_DEPLOYMENT_REVISION: "f144be2" })).toBe("f144be2");
    expect(getApiRevision({ REPLIT_DEPLOYMENT_REVISION: "secret value\n" })).toBe("unknown");
  });

  it("has an explicit 117-stage registry with stable names and metadata", () => {
    const rows = startupRegistry.match(/^  \["/gm) ?? [];
    expect(rows).toHaveLength(117);
    expect(startupRegistry).toContain(": 1");
    expect(startupRegistry).toContain("critical: true");
    expect(startupRegistry).toContain('"schema"');
    expect(startupRegistry).toContain('"customer_invoice_company_scope"');
    expect(startupRegistry).toContain('"sport_center_payment_mirror_refresh"');
    expect(startupRegistry).toContain("getStartupStageDefinition");
  });

  it("does not repeat bank mutation schema and cleanup work after provisioning", () => {
    for (const source of [bankImport, bankMasters]) {
      expect(source).toContain("isStartupMigrationComplete");
      expect(source).toContain("markStartupMigrationComplete");
      expect(source).toContain("startup DDL skipped");
    }
  });

  it("keeps Sport Center bootstrap and governance work behind a persistent marker", () => {
    expect(sportMigration).toContain("isStartupMigrationComplete");
    expect(sportMigration).toContain("markStartupMigrationComplete");
    expect(sportMigration).toContain("startup schema/data sync skipped");
    expect(sportMigration).toContain("Canonical Sport Center settlement contract migration");
  });

  it("repairs RLS only after a catalog mismatch instead of recreating every policy", () => {
    expect(rlsMigration).toContain("pg_policies");
    expect(rlsMigration).toContain("const needsPolicyRepair = !catalogState || !catalogState.policy_ok;");
    expect(rlsMigration).toContain("if (needsPolicyRepair)");
    expect(rlsMigration).toContain("if (!catalogState?.rls_enabled)");
  });

  it("uses condition-based registry readiness instead of the fixed startup sleep", () => {
    expect(apiIndex).toContain("initializeStartupMigrationRegistry");
    expect(apiIndex).toContain("fixed_startup_delay_ms: 0");
    expect(apiIndex).not.toContain("sleep(8_000)");
    expect(apiIndex).toContain("database_ready_ms: registryInitializationMs");
  });
});