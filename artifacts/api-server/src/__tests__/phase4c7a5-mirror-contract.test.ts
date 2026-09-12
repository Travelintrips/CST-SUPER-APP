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
const mirrorTrigger = mirrorMigration.match(
  /CREATE OR REPLACE FUNCTION sport_center\.mirror_confirmed_payment_to_public\(\)[\s\S]*?AS \$function\$[\s\S]*?\$function\$/,
)?.[0] ?? "";
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
    expect(mirrorTrigger).toContain("WHERE pb.sc_booking_id = NEW.booking_id");
    expect(mirrorTrigger).toContain("MIRROR_BOOKING_BRIDGE_MISSING");
    expect(mirrorTrigger).toContain("MIRROR_BOOKING_BRIDGE_AMBIGUOUS");
    expect(mirrorTrigger).not.toContain("ORDER BY pb.id DESC");
    expect(mirrorTrigger).not.toContain("LIMIT 1");
  });

  it("resolves company, bank, and provider configuration without hardcoded ownership", () => {
    expect(mirrorMigration).toContain("sport_center.facility_company_mappings");
    expect(mirrorMigration).toContain("fcm.is_active = TRUE");
    expect(mirrorMigration).toContain("MIRROR_COMPANY_UNRESOLVED");
    expect(mirrorMigration).toContain("cba.account_number::text = v_external_bank_account_id");
    expect(mirrorMigration).toContain("cba.is_active = TRUE");
    expect(mirrorMigration).toContain("MIRROR_BANK_ACCOUNT_UNRESOLVED");
    expect(mirrorMigration).toContain("psc.source = 'OWNER_APPROVED'");
    expect(mirrorMigration).toContain("psc.effective_from <= v_payment_date");
    expect(mirrorMigration).toContain("v_payment_date < psc.effective_until");
    expect(mirrorMigration).not.toContain("psc.rule_version = 'PROD-MANDIRI-SC-20260810-v1'");
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

  it("does not guess a canonical bank account during QRIS backfill", () => {
    expect(mirrorMigration).toContain(
      "ADD COLUMN IF NOT EXISTS bank_account_id            TEXT",
    );
    expect(mirrorMigration).toContain(
      "SET bank_account_id = NULLIF(BTRIM(m.external_bank_account_id::text), '')",
    );
    expect(mirrorMigration).toContain(
      "SET bank_account_id = resolved.bank_account_id",
    );
    expect(mirrorMigration).toContain("HAVING COUNT(*) = 1");
    expect(mirrorMigration).not.toContain(
      "SELECT DISTINCT ON (company_id) id, company_id",
    );
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