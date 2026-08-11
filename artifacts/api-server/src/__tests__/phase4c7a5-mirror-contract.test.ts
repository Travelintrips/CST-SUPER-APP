import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const migrationSql = readFileSync(
  resolve(process.cwd(), "../../lib/db/drizzle/0034_phase4c7a5_sport_payment_mirror_metadata.sql"),
  "utf8",
);
const mirrorMigration = readFileSync(
  resolve(process.cwd(), "src/modules/sport-center/migration.ts"),
  "utf8",
);
const worker = readFileSync(
  resolve(process.cwd(), "src/modules/sport-center/incrementalSyncWorker.ts"),
  "utf8",
);

describe("Phase 4C-7A.5 additive mirror contract", () => {
  it("adds only nullable metadata columns and does not backfill rows", () => {
    expect(migrationSql).toContain("ALTER TABLE public.sport_payments");
    for (const column of [
      "provider_id TEXT",
      "external_bank_account_id TEXT",
      "source_schema TEXT",
      "source_table TEXT",
    ]) {
      expect(migrationSql).toContain(`ADD COLUMN IF NOT EXISTS ${column}`);
    }
    expect(migrationSql).not.toMatch(/\bUPDATE\b|\bINSERT\b|\bDELETE\b|\bNOT NULL\b/i);
  });

  it("uses a deterministic booking bridge and fails closed on missing or duplicate rows", () => {
    expect(mirrorMigration).toContain("WHERE pb.sc_booking_id = NEW.booking_id");
    expect(mirrorMigration).toContain("MIRROR_BOOKING_BRIDGE_MISSING");
    expect(mirrorMigration).toContain("MIRROR_BOOKING_BRIDGE_AMBIGUOUS");
    expect(mirrorMigration).not.toContain("ORDER BY pb.id DESC");
    expect(mirrorMigration).not.toContain("LIMIT 1");
  });

  it("resolves company, bank, and provider configuration without hardcoded ownership", () => {
    expect(mirrorMigration).toContain("sport_center.facility_company_mappings");
    expect(mirrorMigration).toContain("fcm.is_active = TRUE");
    expect(mirrorMigration).toContain("MIRROR_COMPANY_UNRESOLVED");
    expect(mirrorMigration).toContain("cba.account_number::text = v_external_bank_account_id");
    expect(mirrorMigration).toContain("cba.is_active = TRUE");
    expect(mirrorMigration).toContain("MIRROR_BANK_ACCOUNT_UNRESOLVED");
    expect(mirrorMigration).toContain("psc.source = 'OWNER_APPROVED'");
    expect(mirrorMigration).toContain("psc.rule_version = 'PROD-MANDIRI-SC-20260810-v1'");
    expect(mirrorMigration).toContain("MIRROR_PROVIDER_RULE_UNRESOLVED");
    expect(mirrorMigration).not.toMatch(/VALUES\s*\(\s*1\s*,/);
  });

  it("propagates canonical provider, settlement, and source identity", () => {
    for (const value of [
      "provider_id",
      "payment_provider",
      "provider_code",
      "bank_account_id",
      "external_bank_account_id",
      "expected_settlement_date",
      "settlement_rule_version",
      "source_schema",
      "source_table",
      "source_payment_id",
    ]) {
      expect(mirrorMigration).toContain(value);
    }
    expect(mirrorMigration).toContain("'sport_center'");
    expect(mirrorMigration).toContain("'sport_payments'");
    expect(mirrorMigration).toContain("NEW.id");
    expect(mirrorMigration).toContain("payment_business_calendar");
  });

  it("keeps PostgreSQL trigger/function as the single mirror owner", () => {
    expect(worker).not.toMatch(/INSERT\s+INTO\s+sport_payments/i);
    expect(worker).toContain("replay_confirmed_payment_mirror");
    expect(worker).toContain("trigger-owned replay");
    expect(worker).toContain("accountingSynced = 0");
    expect(worker).not.toContain("payment confirmed tanpa mirror → insert mirror manual");
  });

  it("preserves the stable SCPAY idempotency key", () => {
    expect(mirrorMigration).toContain("'SCPAY-SC-' || NEW.id::text");
    expect(mirrorMigration).toContain("ON CONFLICT (payment_number)");
  });
});