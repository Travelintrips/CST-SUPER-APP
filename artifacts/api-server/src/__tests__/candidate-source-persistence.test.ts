import { describe, expect, it } from "vitest";
import {
  bankReconciliationMatchesTable,
  RECONCILIATION_CANDIDATE_SOURCES,
  reconciliationCandidateIdentityKey,
} from "@workspace/db/schema";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const migrationPath = resolve(
  process.cwd(),
  "../../lib/db/drizzle/0033_reconciliation_candidate_source.sql",
);

describe("Phase 4C-1 candidate_source persistence", () => {
  it("models candidate_source as a nullable text column", () => {
    const column = bankReconciliationMatchesTable.candidateSource;

    expect(column.name).toBe("candidate_source");
    expect(column.dataType).toBe("string");
    expect(column.notNull).toBe(false);
    expect(column.hasDefault).toBe(false);
  });

  it("keeps the additive migration nullable with no backfill or default", () => {
    const migration = readFileSync(migrationPath, "utf8");

    expect(migration).toContain(
      "ALTER TABLE public.bank_reconciliation_matches",
    );
    expect(migration).toContain(
      "ADD COLUMN IF NOT EXISTS candidate_source TEXT",
    );
    expect(migration).not.toMatch(/NOT NULL|DEFAULT|UPDATE\s+/i);
  });

  it("retains historical NULL as a distinct persistence state", () => {
    const key = reconciliationCandidateIdentityKey({
      candidateType: "qris_settlement",
      candidateId: 123,
      candidateSource: null,
    });

    expect(key).toBe("qris_settlement:123:<historical-null>");
  });

  it("keeps canonical and legacy same-number IDs distinct", () => {
    const legacy = reconciliationCandidateIdentityKey({
      candidateType: "qris_settlement",
      candidateId: 1,
      candidateSource: RECONCILIATION_CANDIDATE_SOURCES.LEGACY_QRIS,
    });
    const canonical = reconciliationCandidateIdentityKey({
      candidateType: "qris_settlement",
      candidateId: 1,
      candidateSource:
        RECONCILIATION_CANDIDATE_SOURCES.CANONICAL_SPORT_CENTER,
    });

    expect(legacy).not.toBe(canonical);
    expect(legacy).toBe("qris_settlement:1:public.qris_settlements");
    expect(canonical).toBe(
      "qris_settlement:1:sport_center.payment_settlement_batches",
    );
  });
});