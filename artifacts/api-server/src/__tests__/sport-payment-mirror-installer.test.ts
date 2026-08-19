import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const migration = readFileSync(
  resolve(process.cwd(), "src/modules/sport-center/migration.ts"),
  "utf8",
);

describe("Sport payment mirror startup installer", () => {
  it("does not destructively replace a runtime-owned trigger", () => {
    expect(migration).toContain("existing canonical contract verified; destructive refresh skipped");
    expect(migration).toContain("contractComplete");
    expect(migration).toContain("t.tgname = 'trg_mirror_confirmed_payment_to_public'");
    expect(migration).not.toContain("DROP TRIGGER IF EXISTS trg_mirror_confirmed_payment_to_public");
    expect(migration).not.toContain("DROP TRIGGER IF EXISTS trg_sync_sport_payment_to_accounting");
  });

  it("checks the complete canonical object contract before returning", () => {
    for (const contractPart of [
      "resolver_exists",
      "mirror_function_exists",
      "accounting_function_exists",
      "unmirrored_function_exists",
      "replay_function_exists",
      "payment_number_index_exists",
    ]) {
      expect(migration).toContain(contractPart);
    }
    expect(migration).toContain("to_regprocedure");
    expect(migration).toContain("Only the fully");
  });
});