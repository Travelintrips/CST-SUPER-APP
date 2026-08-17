import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const apiIndex = readFileSync(resolve(process.cwd(), "src/index.ts"), "utf8");
const rlsMigration = readFileSync(resolve(process.cwd(), "src/lib/rlsMigration.ts"), "utf8");
const startupState = readFileSync(resolve(process.cwd(), "src/lib/startupMigrationState.ts"), "utf8");
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

  it("uses a persistent marker helper with a safe legacy fallback", () => {
    expect(startupState).toContain("FROM app_config");
    expect(startupState).toContain("ON CONFLICT (key) DO UPDATE");
    expect(startupState).toContain("return false");
    expect(startupState).toContain("retaining legacy migration path");
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
});