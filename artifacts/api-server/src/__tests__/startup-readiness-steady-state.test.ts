import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const apiIndex = readFileSync(resolve(process.cwd(), "src/index.ts"), "utf8");
const rlsMigration = readFileSync(resolve(process.cwd(), "src/lib/rlsMigration.ts"), "utf8");
const startupState = readFileSync(resolve(process.cwd(), "src/lib/startupMigrationState.ts"), "utf8");
const startupRegistry = readFileSync(resolve(process.cwd(), "src/lib/startupMigrationRegistry.ts"), "utf8");
const bankImport = readFileSync(resolve(process.cwd(), "src/routes/bankMutationImport.ts"), "utf8");
const bankMasters = readFileSync(resolve(process.cwd(), "src/routes/bankMutationMasters.ts"), "utf8");
const sportMigration = readFileSync(resolve(process.cwd(), "src/modules/sport-center/migration.ts"), "utf8");

describe("startup readiness steady-state contract", () => {
  it("persists bootstrap completion and skips the pre-start DDL/backfill pass", () => {
    const guard = apiIndex.indexOf(
      'isStartupMigrationComplete("api_pre_start_schema", PRE_START_SCHEMA_BOOTSTRAP_VERSION)',
    );
    const marker = apiIndex.indexOf(
      'markStartupMigrationComplete(\n    "api_pre_start_schema"',
    );

    expect(guard).toBeGreaterThan(-1);
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
    expect(startupState).toContain("updateState(stage.name, stage.version, \"completed\")");
    expect(startupState).toContain("updateState(stage.name, stage.version, \"failed\", sanitizeError(error))");
    expect(startupState).toContain("process crash");
  });

  it("has an explicit 114-stage registry with stable names and metadata", () => {
    const rows = startupRegistry.match(/^  \["/gm) ?? [];
    expect(rows).toHaveLength(114);
    expect(startupRegistry).toContain("version: 1");
    expect(startupRegistry).toContain("critical: true");
    expect(startupRegistry).toContain('"schema"');
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