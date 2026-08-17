import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const migrationSource = readFileSync(
  resolve(process.cwd(), "src/modules/sport-center/migration.ts"),
  "utf8",
);

describe("canonical Sport Center owner routine restoration contract", () => {
  it("defines all six required owner signatures", () => {
    for (const signature of [
      "resolve_internal_bank_account_id(",
      "canonical_settlement_group_identity(",
      "mark_settlement_payments_settled(",
      "create_payment_settlement_batch(",
      "finalize_payment_settlement(",
      "recover_posted_settlement_from_bank_mutation(",
      "find_settlement_bank_candidates(",
    ]) {
      expect(migrationSource).toContain(
        `CREATE OR REPLACE FUNCTION sport_center.${signature}`,
      );
    }
  });

  it("keeps candidate evidence read-only and fail-closed", () => {
    const start = migrationSource.indexOf(
      "CREATE OR REPLACE FUNCTION sport_center.find_settlement_bank_candidates(",
    );
    const end = migrationSource.indexOf(
      "Phase 4C-7N: public bank-mutation",
      start,
    );
    const finder = migrationSource.slice(start, end);

    expect(finder).toContain("STABLE");
    expect(finder).toContain("SECURITY DEFINER");
    expect(finder).toContain("DATE_TOLERANCE_MUST_BE_NON_NEGATIVE");
    expect(finder).toContain("candidate_eligible");
    expect(finder).not.toMatch(/\b(INSERT|UPDATE|DELETE)\b/);
  });

  it("exposes a post-migration exact-signature verification", () => {
    expect(migrationSource).toContain(
      "verifyCanonicalSettlementOwnerRoutines",
    );
    expect(migrationSource).toContain(
      "CANONICAL_SETTLEMENT_OWNER_ROUTINES_INCOMPLETE",
    );
    expect(migrationSource).toContain("format_type(argument.oid, NULL)");
  });

  it("guards the restoration runner against production execution", () => {
    const runner = readFileSync(
      resolve(process.cwd(), "src/run-canonical-contract-migration.ts"),
      "utf8",
    );
    expect(runner).toContain('process.env.APP_ENV !== "development"');
    expect(runner).toContain("process.env.REPLIT_DEPLOYMENT");
    expect(runner).toContain("refusing to write outside the development database");
  });
});