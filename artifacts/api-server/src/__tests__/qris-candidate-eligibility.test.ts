import { describe, expect, it } from "vitest";
import {
  ACTIVE_CANONICAL_SETTLEMENT_STATUSES,
  ACTIVE_LEGACY_QRIS_SETTLEMENT_STATUS_SQL,
  ACTIVE_QRIS_CANDIDATE_STATUSES,
  ACTIVE_QRIS_MATCH_STATUSES,
  isActiveCanonicalSettlementStatus,
  isActiveLegacyQrisSettlementStatus,
  isActiveQrisCandidateStatus,
  isActiveQrisMatchStatus,
} from "../lib/reconciliation/qrisCandidateEligibility.js";

describe("QRIS current candidate eligibility", () => {
  it("uses allow-lists so terminal snapshot lifecycle states never become active", () => {
    expect(ACTIVE_QRIS_CANDIDATE_STATUSES).toEqual([
      "candidate_auto_matched",
      "candidate_review",
    ]);

    for (const status of ["rejected", "blocked", "superseded", "stale", "ineligible", "voided"]) {
      expect(isActiveQrisCandidateStatus(status)).toBe(false);
    }
    expect(isActiveQrisCandidateStatus("candidate_review")).toBe(true);
  });

  it("uses allow-lists so terminal match rows never become current QRIS evidence", () => {
    expect(ACTIVE_QRIS_MATCH_STATUSES).toEqual(["candidate", "approved"]);

    for (const status of ["rejected", "blocked", "superseded", "voided", "reversed"]) {
      expect(isActiveQrisMatchStatus(status)).toBe(false);
    }
    expect(isActiveQrisMatchStatus("candidate")).toBe(true);
    expect(isActiveQrisMatchStatus("approved")).toBe(true);
  });

  it("keeps reversed and voided source settlements out of active source evidence", () => {
    expect(ACTIVE_CANONICAL_SETTLEMENT_STATUSES).toEqual(["posted", "reconciled"]);
    expect(isActiveCanonicalSettlementStatus("posted")).toBe(true);
    expect(isActiveCanonicalSettlementStatus("reconciled")).toBe(true);
    expect(isActiveCanonicalSettlementStatus("reversed")).toBe(false);
    expect(isActiveCanonicalSettlementStatus("voided")).toBe(false);

    expect(isActiveLegacyQrisSettlementStatus("settled")).toBe(true);
    expect(isActiveLegacyQrisSettlementStatus("reversed")).toBe(false);
    expect(isActiveLegacyQrisSettlementStatus("voided")).toBe(false);
    expect(ACTIVE_LEGACY_QRIS_SETTLEMENT_STATUS_SQL).not.toContain("reversed");
    expect(ACTIVE_LEGACY_QRIS_SETTLEMENT_STATUS_SQL).not.toContain("voided");
  });
});