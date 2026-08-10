/**
 * Universal Journal Reuse Engine — Unit Tests (Phase 25)
 *
 * Tests all 14 decision scenarios defined in the master prompt.
 * All tests use mock DB clients — no live DB required.
 *
 * Scenarios:
 *  1.  Existing posted journal → REUSE_EXISTING_JOURNAL
 *  2.  No existing journal     → CREATE_NEW_JOURNAL
 *  3.  Lookup DB error         → MANUAL_REVIEW_REQUIRED (fail-closed)
 *  4.  Same event already reconciled to another mutation → REJECT_DUPLICATE
 *  5.  Cross-company candidate → MANUAL_REVIEW_REQUIRED
 *  6.  Amount mismatch         → MANUAL_REVIEW_REQUIRED
 *  7.  Draft existing journal  → MANUAL_REVIEW_REQUIRED
 *  8.  Voided journal          → MANUAL_REVIEW_REQUIRED (no reuse)
 *  9.  Reversed journal        → MANUAL_REVIEW_REQUIRED (no reuse)
 * 10.  Same source_id different company → isolated (each company creates its own)
 * 11.  Unknown candidate type  → MANUAL_REVIEW_REQUIRED
 * 12.  No candidate selected   → CREATE_NEW_JOURNAL
 * 13.  Deterministic: same input → same decision
 * 14.  Engine never mutates DB (pure decision function)
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  resolveJournalForEconomicEvent,
  type JournalResolutionResult,
  type ResolveJournalArgs,
} from "../lib/reconciliation/journalReuseEngine.js";
import { RECONCILIATION_CANDIDATE_SOURCES } from "@workspace/db";

// ─── Mock DB client factory ───────────────────────────────────────────────────

type MockRow = Record<string, unknown>;

function makeClient(rows: MockRow[] = [], throwError?: string) {
  return {
    execute: vi.fn().mockImplementation(() => {
      if (throwError) return Promise.reject(new Error(throwError));
      return Promise.resolve({ rows });
    }),
    // Drizzle-style select/from/where/limit chain (not used by engine but required by type)
    select: vi.fn(),
    insert: vi.fn(),
    update: vi.fn(),
    delete: vi.fn(),
  };
}

function posted(overrides: Partial<MockRow> = {}): MockRow {
  return {
    id: 101,
    entry_number: "BNK/2026/0001",
    status: "posted",
    company_id: 5,
    total_debit: "30000",
    is_voided: false,
    is_reversed: false,
    reconciled_mutation_id: null,
    ...overrides,
  };
}

const BASE_ARGS: ResolveJournalArgs = {
  companyId: 5,
  candidateType: "sport_payment",
  candidateId: 42,
  mutationId: 7,
  mutationAmount: 30000,
  mutationDate: "2026-07-01",
};

// ─── Test suite ───────────────────────────────────────────────────────────────

describe("resolveJournalForEconomicEvent — Universal Journal Reuse Engine", () => {

  it("legacy QRIS source resolves through the existing public resolver", async () => {
    const client = makeClient([posted()]);
    const result = await resolveJournalForEconomicEvent(client as any, {
      ...BASE_ARGS,
      candidateType: "qris_settlement",
      candidateId: 1,
      candidateSource: RECONCILIATION_CANDIDATE_SOURCES.LEGACY_QRIS,
    });

    expect(result.decision).toBe("REUSE_EXISTING_JOURNAL");
    expect(result.existingJournalId).toBe(101);
    expect(client.execute).toHaveBeenCalled();
  });

  it("canonical QRIS source is blocked before the legacy resolver", async () => {
    const client = makeClient([posted()]);
    const result = await resolveJournalForEconomicEvent(client as any, {
      ...BASE_ARGS,
      candidateType: "qris_settlement",
      candidateId: 1,
      candidateSource: RECONCILIATION_CANDIDATE_SOURCES.CANONICAL_SPORT_CENTER,
    });

    expect(result.decision).toBe("MANUAL_REVIEW_REQUIRED");
    expect(result.evidence.code).toBe("CANONICAL_SETTLEMENT_ADAPTER_NOT_IMPLEMENTED");
    expect(client.execute).not.toHaveBeenCalled();
  });

  it("historical NULL QRIS source is rejected as ambiguous before lookup", async () => {
    const client = makeClient([posted()]);
    const result = await resolveJournalForEconomicEvent(client as any, {
      ...BASE_ARGS,
      candidateType: "qris_settlement",
      candidateId: 1,
      candidateSource: null,
    });

    expect(result.decision).toBe("MANUAL_REVIEW_REQUIRED");
    expect(result.evidence.code).toBe("AMBIGUOUS_QRIS_SETTLEMENT_SOURCE");
    expect(client.execute).not.toHaveBeenCalled();
  });

  // ── Scenario 1: Posted journal found → REUSE ─────────────────────────────

  it("1. existing posted journal → REUSE_EXISTING_JOURNAL", async () => {
    const client = makeClient([posted()]);
    const result = await resolveJournalForEconomicEvent(client as any, BASE_ARGS);
    expect(result.decision).toBe("REUSE_EXISTING_JOURNAL");
    expect(result.existingJournalId).toBe(101);
    expect(result.existingJournalNumber).toBe("BNK/2026/0001");
    expect(result.confidence).toBeGreaterThanOrEqual(90);
    expect(result.requiresHumanReview).toBe(false);
    expect(result.safeToCreateJournal).toBe(false);
  });

  // ── Scenario 2: No existing journal → CREATE_NEW ──────────────────────────

  it("2. no existing journal → CREATE_NEW_JOURNAL", async () => {
    const client = makeClient([]); // empty rows
    const result = await resolveJournalForEconomicEvent(client as any, BASE_ARGS);
    expect(result.decision).toBe("CREATE_NEW_JOURNAL");
    expect(result.existingJournalId).toBeNull();
    expect(result.safeToCreateJournal).toBe(true);
    expect(result.requiresHumanReview).toBe(false);
  });

  // ── Scenario 3: DB error → MANUAL_REVIEW_REQUIRED (fail-closed) ──────────

  it("3. lookup DB error → MANUAL_REVIEW_REQUIRED (fail-closed, no journal created)", async () => {
    const client = makeClient([], "connection refused");
    const result = await resolveJournalForEconomicEvent(client as any, BASE_ARGS);
    expect(result.decision).toBe("MANUAL_REVIEW_REQUIRED");
    expect(result.safeToCreateJournal).toBe(false);
    expect(result.requiresHumanReview).toBe(true);
    expect(result.confidence).toBe(0);
    // Must never expose raw error message to evidence (would leak SQL/path)
    expect(result.evidence["lookupError"]).toBe("DB_ERROR");
  });

  // ── Scenario 4: Already reconciled to another mutation → REJECT_DUPLICATE ─

  it("4. journal already reconciled to different mutation → REJECT_DUPLICATE", async () => {
    const client = makeClient([posted({ reconciled_mutation_id: 99 })]);
    const result = await resolveJournalForEconomicEvent(client as any, BASE_ARGS);
    expect(result.decision).toBe("REJECT_DUPLICATE");
    expect(result.duplicateRisk).toBe("high");
    expect(result.requiresHumanReview).toBe(true);
    expect(result.evidence["existingMutationId"]).toBe(99);
  });

  // ── Scenario 5: Cross-company → MANUAL_REVIEW_REQUIRED ───────────────────

  it("5. cross-company candidate → MANUAL_REVIEW_REQUIRED", async () => {
    const client = makeClient([posted({ company_id: 99 })]);
    const result = await resolveJournalForEconomicEvent(client as any, {
      ...BASE_ARGS,
      companyId: 5, // caller company is 5, journal belongs to 99
    });
    expect(result.decision).toBe("MANUAL_REVIEW_REQUIRED");
    expect(result.duplicateRisk).toBe("high");
    expect(result.evidence["code"]).toBe("JOURNAL_REUSE_COMPANY_MISMATCH");
  });

  // ── Scenario 6: Amount mismatch → MANUAL_REVIEW_REQUIRED ─────────────────

  it("6. amount mismatch → MANUAL_REVIEW_REQUIRED", async () => {
    // Journal is 30000, mutation is 50000 (clearly different)
    const client = makeClient([posted({ total_debit: "30000" })]);
    const result = await resolveJournalForEconomicEvent(client as any, {
      ...BASE_ARGS,
      mutationAmount: 50000,
    });
    expect(result.decision).toBe("MANUAL_REVIEW_REQUIRED");
    expect(result.evidence["code"]).toBe("JOURNAL_REUSE_AMOUNT_MISMATCH");
  });

  it("6b. 1-unit rounding difference → REUSE_EXISTING_JOURNAL (within tolerance)", async () => {
    const client = makeClient([posted({ total_debit: "29999" })]);
    const result = await resolveJournalForEconomicEvent(client as any, {
      ...BASE_ARGS,
      mutationAmount: 30000,
    });
    expect(result.decision).toBe("REUSE_EXISTING_JOURNAL");
  });

  // ── Scenario 7: Draft journal — new policy ────────────────────────────────
  //
  // Draft journals created by upstream modules (sport center, payroll, etc.)
  // are PROVISIONAL entries awaiting bank confirmation.  Bank reconciliation
  // IS that confirmation.  Policy:
  //   draft + unlinked + amount matches   → REUSE_EXISTING_JOURNAL   (confirms provisional entry)
  //   draft + already claimed             → MANUAL_REVIEW_REQUIRED   (duplicate)
  //   draft + amount mismatch             → MANUAL_REVIEW_REQUIRED   (different event)
  //   pending_approval / approved_pending → MANUAL_REVIEW_REQUIRED   (under governance)

  it("7. draft existing journal (unlinked, amount matches) → REUSE_EXISTING_JOURNAL", async () => {
    // reconciled_mutation_id: null = unlinked; total_debit matches mutationAmount (30000)
    const client = makeClient([posted({ status: "draft", reconciled_mutation_id: null })]);
    const result = await resolveJournalForEconomicEvent(client as any, BASE_ARGS);
    expect(result.decision).toBe("REUSE_EXISTING_JOURNAL");
    expect(result.existingJournalId).toBe(101);
    expect(result.confidence).toBeGreaterThanOrEqual(70);
    expect(result.requiresHumanReview).toBe(false);
    expect(result.evidence["journalStatus"]).toBe("draft");
  });

  it("7d. draft journal already claimed by another mutation → MANUAL_REVIEW_REQUIRED", async () => {
    // reconciled_mutation_id = 999 (different from BASE_ARGS.mutationId = 7)
    const client = makeClient([posted({ status: "draft", reconciled_mutation_id: 999 })]);
    const result = await resolveJournalForEconomicEvent(client as any, BASE_ARGS);
    expect(result.decision).toBe("MANUAL_REVIEW_REQUIRED");
    expect(result.duplicateRisk).toBe("high");
  });

  it("7e. draft journal with amount mismatch → MANUAL_REVIEW_REQUIRED", async () => {
    // total_debit = 50000, mutation = 30000 → big mismatch
    const client = makeClient([posted({ status: "draft", total_debit: "50000", reconciled_mutation_id: null })]);
    const result = await resolveJournalForEconomicEvent(client as any, BASE_ARGS);
    expect(result.decision).toBe("MANUAL_REVIEW_REQUIRED");
  });

  it("7b. pending_approval journal → MANUAL_REVIEW_REQUIRED (under governance)", async () => {
    const client = makeClient([posted({ status: "pending_approval" })]);
    const result = await resolveJournalForEconomicEvent(client as any, BASE_ARGS);
    expect(result.decision).toBe("MANUAL_REVIEW_REQUIRED");
  });

  it("7c. approved_pending_posting journal → MANUAL_REVIEW_REQUIRED (under governance)", async () => {
    const client = makeClient([posted({ status: "approved_pending_posting" })]);
    const result = await resolveJournalForEconomicEvent(client as any, BASE_ARGS);
    expect(result.decision).toBe("MANUAL_REVIEW_REQUIRED");
  });

  // ── Scenario 8: Voided journal → MANUAL_REVIEW_REQUIRED ─────────────────

  it("8. voided journal → MANUAL_REVIEW_REQUIRED (no reuse)", async () => {
    const client = makeClient([posted({ is_voided: true })]);
    const result = await resolveJournalForEconomicEvent(client as any, BASE_ARGS);
    expect(result.decision).toBe("MANUAL_REVIEW_REQUIRED");
    expect(result.evidence["journalStatus"]).toBe("voided");
  });

  // ── Scenario 9: Reversed journal → MANUAL_REVIEW_REQUIRED ───────────────

  it("9. reversed journal → MANUAL_REVIEW_REQUIRED (no reuse)", async () => {
    const client = makeClient([posted({ is_reversed: true })]);
    const result = await resolveJournalForEconomicEvent(client as any, BASE_ARGS);
    expect(result.decision).toBe("MANUAL_REVIEW_REQUIRED");
    expect(result.evidence["journalStatus"]).toBe("reversed");
  });

  // ── Scenario 10: Same source_id, different companies → isolated ──────────

  it("10. same candidateId different company → isolated (company A sees CREATE_NEW)", async () => {
    // Company A (id=5) has no journal yet
    const clientA = makeClient([]);
    const resultA = await resolveJournalForEconomicEvent(clientA as any, {
      ...BASE_ARGS,
      companyId: 5,
    });
    expect(resultA.decision).toBe("CREATE_NEW_JOURNAL");

    // Company B (id=6) has a posted journal for same candidateId
    const clientB = makeClient([posted({ company_id: 6 })]);
    const resultB = await resolveJournalForEconomicEvent(clientB as any, {
      ...BASE_ARGS,
      companyId: 6,
    });
    expect(resultB.decision).toBe("REUSE_EXISTING_JOURNAL");
  });

  // ── Scenario 11: Unknown candidate type → MANUAL_REVIEW_REQUIRED ─────────

  it("11. unknown candidate type → MANUAL_REVIEW_REQUIRED", async () => {
    const client = makeClient([]);
    const result = await resolveJournalForEconomicEvent(client as any, {
      ...BASE_ARGS,
      candidateType: "unknown_future_type",
    });
    expect(result.decision).toBe("MANUAL_REVIEW_REQUIRED");
    expect(result.safeToCreateJournal).toBe(false);
  });

  // ── Scenario 12: No candidate → CREATE_NEW_JOURNAL ───────────────────────

  it("12. no candidate selected → CREATE_NEW_JOURNAL (unmatched mutation)", async () => {
    const client = makeClient([]);
    const result = await resolveJournalForEconomicEvent(client as any, {
      ...BASE_ARGS,
      candidateType: null,
      candidateId: null,
    });
    expect(result.decision).toBe("CREATE_NEW_JOURNAL");
    expect(result.economicEventType).toBe("unknown");
  });

  // ── Scenario 13: Deterministic ───────────────────────────────────────────

  it("13. deterministic — same input always produces same decision", async () => {
    const makeResolve = () => resolveJournalForEconomicEvent(makeClient([posted()]) as any, BASE_ARGS);
    const [r1, r2, r3] = await Promise.all([makeResolve(), makeResolve(), makeResolve()]);
    expect(r1.decision).toBe(r2.decision);
    expect(r2.decision).toBe(r3.decision);
    expect(r1.existingJournalId).toBe(r2.existingJournalId);
    expect(r1.confidence).toBe(r3.confidence);
  });

  // ── Scenario 14: Engine never mutates DB ─────────────────────────────────

  it("14. engine never calls insert/update/delete", async () => {
    const client = makeClient([posted()]);
    await resolveJournalForEconomicEvent(client as any, BASE_ARGS);
    expect(client.insert).not.toHaveBeenCalled();
    expect(client.update).not.toHaveBeenCalled();
    expect(client.delete).not.toHaveBeenCalled();
    // Only execute() (SELECT) should be called
    expect(client.execute).toHaveBeenCalledTimes(1);
  });

  // ── Per-module adapter smoke tests ────────────────────────────────────────

  describe("source adapters — all candidate types", () => {

    it("accounting_payment adapter → REUSE on posted journal", async () => {
      const client = makeClient([posted()]);
      const result = await resolveJournalForEconomicEvent(client as any, {
        ...BASE_ARGS,
        candidateType: "accounting_payment",
        candidateId: 77,
      });
      expect(result.decision).toBe("REUSE_EXISTING_JOURNAL");
    });

    it("invoice adapter → REUSE on posted journal", async () => {
      const client = makeClient([posted()]);
      const result = await resolveJournalForEconomicEvent(client as any, {
        ...BASE_ARGS,
        candidateType: "invoice",
        candidateId: 200,
      });
      expect(result.decision).toBe("REUSE_EXISTING_JOURNAL");
    });

    it("expense adapter → REUSE on posted journal", async () => {
      const client = makeClient([posted()]);
      const result = await resolveJournalForEconomicEvent(client as any, {
        ...BASE_ARGS,
        candidateType: "expense",
        candidateId: 33,
      });
      expect(result.decision).toBe("REUSE_EXISTING_JOURNAL");
    });

    it("logistic_order adapter → CREATE_NEW when no existing journal", async () => {
      const client = makeClient([]);
      const result = await resolveJournalForEconomicEvent(client as any, {
        ...BASE_ARGS,
        candidateType: "logistic_order",
        candidateId: 55,
      });
      expect(result.decision).toBe("CREATE_NEW_JOURNAL");
    });

    it("tenant_invoice adapter → REUSE on posted journal", async () => {
      const client = makeClient([posted()]);
      const result = await resolveJournalForEconomicEvent(client as any, {
        ...BASE_ARGS,
        candidateType: "tenant_invoice",
        candidateId: 88,
      });
      expect(result.decision).toBe("REUSE_EXISTING_JOURNAL");
    });

    it("each adapter fires exactly one SELECT (no mutation)", async () => {
      const types = ["sport_payment", "accounting_payment", "invoice", "expense", "logistic_order", "tenant_invoice"] as const;
      for (const type of types) {
        const client = makeClient([posted()]);
        await resolveJournalForEconomicEvent(client as any, {
          ...BASE_ARGS,
          candidateType: type,
          candidateId: 1,
        });
        expect(client.execute).toHaveBeenCalledTimes(1);
        expect(client.insert).not.toHaveBeenCalled();
      }
    });
  });

  // ── Enterprise Coverage: new module adapters ──────────────────────────────

  describe("enterprise module adapters — full coverage", () => {

    it("cash_advance adapter → REUSE on posted journal (source='kasbon')", async () => {
      const client = makeClient([posted()]);
      const result = await resolveJournalForEconomicEvent(client as any, {
        ...BASE_ARGS,
        candidateType: "cash_advances",
        candidateId: 101,
      });
      expect(result.decision).toBe("REUSE_EXISTING_JOURNAL");
      expect(client.insert).not.toHaveBeenCalled();
    });

    it("cash_advance adapter (singular alias) → REUSE on posted journal", async () => {
      const client = makeClient([posted()]);
      const result = await resolveJournalForEconomicEvent(client as any, {
        ...BASE_ARGS,
        candidateType: "cash_advance",
        candidateId: 102,
      });
      expect(result.decision).toBe("REUSE_EXISTING_JOURNAL");
    });

    it("cash_advance adapter → CREATE_NEW when no existing journal", async () => {
      // Both primary and fallback return nothing
      const client = makeClient([]);
      const result = await resolveJournalForEconomicEvent(client as any, {
        ...BASE_ARGS,
        candidateType: "cash_advances",
        candidateId: 103,
      });
      expect(result.decision).toBe("CREATE_NEW_JOURNAL");
    });

    it("treasury adapter → REUSE on posted journal (via accounting_payments.source_type='treasury')", async () => {
      const client = makeClient([posted()]);
      const result = await resolveJournalForEconomicEvent(client as any, {
        ...BASE_ARGS,
        candidateType: "treasury",
        candidateId: 201,
      });
      expect(result.decision).toBe("REUSE_EXISTING_JOURNAL");
      expect(client.insert).not.toHaveBeenCalled();
    });

    it("treasury adapter → CREATE_NEW when no treasury journal found", async () => {
      const client = makeClient([]);
      const result = await resolveJournalForEconomicEvent(client as any, {
        ...BASE_ARGS,
        candidateType: "treasury",
        candidateId: 202,
      });
      expect(result.decision).toBe("CREATE_NEW_JOURNAL");
    });

    it("fixed_asset adapter → REUSE on posted journal (via fixed_assets.journal_entry_id)", async () => {
      const client = makeClient([posted()]);
      const result = await resolveJournalForEconomicEvent(client as any, {
        ...BASE_ARGS,
        candidateType: "fixed_asset",
        candidateId: 301,
      });
      expect(result.decision).toBe("REUSE_EXISTING_JOURNAL");
      expect(client.insert).not.toHaveBeenCalled();
    });

    it("fixed_asset adapter → CREATE_NEW when no journal linked", async () => {
      const client = makeClient([]);
      const result = await resolveJournalForEconomicEvent(client as any, {
        ...BASE_ARGS,
        candidateType: "fixed_asset",
        candidateId: 302,
      });
      expect(result.decision).toBe("CREATE_NEW_JOURNAL");
    });

    it("bank_loan adapter → REUSE on posted journal (via bank_loans.journal_entry_id)", async () => {
      const client = makeClient([posted()]);
      const result = await resolveJournalForEconomicEvent(client as any, {
        ...BASE_ARGS,
        candidateType: "bank_loan",
        candidateId: 401,
      });
      expect(result.decision).toBe("REUSE_EXISTING_JOURNAL");
      expect(client.insert).not.toHaveBeenCalled();
    });

    it("bank_loan_payment adapter → REUSE on posted journal (via bank_loan_payments.journal_entry_id)", async () => {
      const client = makeClient([posted()]);
      const result = await resolveJournalForEconomicEvent(client as any, {
        ...BASE_ARGS,
        candidateType: "bank_loan_payment",
        candidateId: 402,
      });
      expect(result.decision).toBe("REUSE_EXISTING_JOURNAL");
      expect(client.insert).not.toHaveBeenCalled();
    });

    it("bank_loan adapter → CREATE_NEW when no disbursement journal found", async () => {
      const client = makeClient([]);
      const result = await resolveJournalForEconomicEvent(client as any, {
        ...BASE_ARGS,
        candidateType: "bank_loan",
        candidateId: 403,
      });
      expect(result.decision).toBe("CREATE_NEW_JOURNAL");
    });

    it("payroll adapter → REUSE on posted journal (source='payroll')", async () => {
      const client = makeClient([posted()]);
      const result = await resolveJournalForEconomicEvent(client as any, {
        ...BASE_ARGS,
        candidateType: "payroll",
        candidateId: 501,
      });
      expect(result.decision).toBe("REUSE_EXISTING_JOURNAL");
      expect(client.insert).not.toHaveBeenCalled();
    });

    it("payroll adapter → CREATE_NEW when no payroll journal found", async () => {
      const client = makeClient([]);
      const result = await resolveJournalForEconomicEvent(client as any, {
        ...BASE_ARGS,
        candidateType: "payroll",
        candidateId: 502,
      });
      expect(result.decision).toBe("CREATE_NEW_JOURNAL");
    });

    it("ppjk adapter → REUSE on posted journal (via accounting_payments.source_type='ppjk')", async () => {
      const client = makeClient([posted()]);
      const result = await resolveJournalForEconomicEvent(client as any, {
        ...BASE_ARGS,
        candidateType: "ppjk",
        candidateId: 601,
      });
      expect(result.decision).toBe("REUSE_EXISTING_JOURNAL");
      expect(client.insert).not.toHaveBeenCalled();
    });

    it("ppjk adapter → CREATE_NEW when no PPJK journal found", async () => {
      const client = makeClient([]);
      const result = await resolveJournalForEconomicEvent(client as any, {
        ...BASE_ARGS,
        candidateType: "ppjk",
        candidateId: 602,
      });
      expect(result.decision).toBe("CREATE_NEW_JOURNAL");
    });

    it("payment_gateway adapter → REUSE on posted journal (source='paylabs:webhook')", async () => {
      const client = makeClient([posted()]);
      const result = await resolveJournalForEconomicEvent(client as any, {
        ...BASE_ARGS,
        candidateType: "payment_gateway",
        candidateId: 701,
      });
      expect(result.decision).toBe("REUSE_EXISTING_JOURNAL");
      expect(client.insert).not.toHaveBeenCalled();
    });

    it("payment_gateway adapter → CREATE_NEW when no gateway journal found", async () => {
      const client = makeClient([]);
      const result = await resolveJournalForEconomicEvent(client as any, {
        ...BASE_ARGS,
        candidateType: "payment_gateway",
        candidateId: 702,
      });
      expect(result.decision).toBe("CREATE_NEW_JOURNAL");
    });

    it("all enterprise adapters are read-only (no insert/update/delete)", async () => {
      const newTypes = [
        "cash_advances", "treasury", "fixed_asset",
        "bank_loan", "bank_loan_payment", "payroll", "ppjk", "payment_gateway",
      ] as const;
      for (const type of newTypes) {
        const client = makeClient([posted()]);
        await resolveJournalForEconomicEvent(client as any, {
          ...BASE_ARGS,
          candidateType: type,
          candidateId: 1,
        });
        expect(client.insert).not.toHaveBeenCalled();
        expect(client.update).not.toHaveBeenCalled();
        expect(client.delete).not.toHaveBeenCalled();
      }
    });

    it("all enterprise adapters enforce company isolation (MANUAL_REVIEW cross-company)", async () => {
      const newTypes = [
        "cash_advances", "treasury", "fixed_asset",
        "bank_loan", "bank_loan_payment", "payroll", "ppjk", "payment_gateway",
      ] as const;
      for (const type of newTypes) {
        // Return a journal belonging to company 99, but request from company 1
        const client = makeClient([{ ...posted(), company_id: 99 }]);
        const result = await resolveJournalForEconomicEvent(client as any, {
          ...BASE_ARGS,
          companyId: 1,
          candidateType: type,
          candidateId: 1,
        });
        expect(result.decision).toBe("MANUAL_REVIEW_REQUIRED");
      }
    });

    it("all enterprise adapters fail-closed on DB error → MANUAL_REVIEW_REQUIRED", async () => {
      const newTypes = [
        "cash_advances", "treasury", "fixed_asset",
        "bank_loan", "bank_loan_payment", "payroll", "ppjk", "payment_gateway",
      ] as const;
      for (const type of newTypes) {
        const client = makeClient([], "simulated DB error");
        const result = await resolveJournalForEconomicEvent(client as any, {
          ...BASE_ARGS,
          candidateType: type,
          candidateId: 1,
        });
        expect(result.decision).toBe("MANUAL_REVIEW_REQUIRED");
        expect(result.requiresHumanReview).toBe(true);
        expect(result.safeToCreateJournal).toBe(false);
      }
    });

    it("cash_advance adapter query uses source='kasbon' (not accounting_payment_id)", async () => {
      const client = makeClient([posted()]);
      await resolveJournalForEconomicEvent(client as any, {
        ...BASE_ARGS,
        candidateType: "cash_advances",
        candidateId: 101,
      });
      const callArg = client.execute.mock.calls[0][0];
      const queryText = JSON.stringify(callArg);
      expect(queryText).toContain("kasbon");
      expect(queryText).not.toContain("accounting_payment_id");
    });

    it("payroll adapter query uses source IN ('payroll', 'hrd_salary_payment')", async () => {
      const client = makeClient([posted()]);
      await resolveJournalForEconomicEvent(client as any, {
        ...BASE_ARGS,
        candidateType: "payroll",
        candidateId: 501,
      });
      const callArg = client.execute.mock.calls[0][0];
      const queryText = JSON.stringify(callArg);
      expect(queryText).toContain("payroll");
      expect(queryText).toContain("hrd_salary_payment");
    });

    it("fixed_asset adapter query uses fixed_assets.journal_entry_id join", async () => {
      const client = makeClient([posted()]);
      await resolveJournalForEconomicEvent(client as any, {
        ...BASE_ARGS,
        candidateType: "fixed_asset",
        candidateId: 301,
      });
      const callArg = client.execute.mock.calls[0][0];
      const queryText = JSON.stringify(callArg);
      expect(queryText).toContain("fixed_assets");
      expect(queryText).toContain("journal_entry_id");
    });

    it("payment_gateway adapter query uses paylabs source values", async () => {
      const client = makeClient([posted()]);
      await resolveJournalForEconomicEvent(client as any, {
        ...BASE_ARGS,
        candidateType: "payment_gateway",
        candidateId: 701,
      });
      const callArg = client.execute.mock.calls[0][0];
      const queryText = JSON.stringify(callArg);
      expect(queryText).toContain("paylabs");
    });

  });

  // ── Sport Center specific: verify correct JOIN is used ────────────────────

  describe("sport_payment adapter — correct relationship", () => {

    it("queries via accounting_payments.source_type='sport_center' (not sport_payments.accounting_payment_id)", async () => {
      const client = makeClient([posted()]);
      await resolveJournalForEconomicEvent(client as any, {
        ...BASE_ARGS,
        candidateType: "sport_payment",
        candidateId: 42,
      });
      const callArg = client.execute.mock.calls[0][0];
      // drizzle sql.raw() objects serialize their SQL text into queryChunks;
      // JSON.stringify captures the full internal structure including the raw string.
      const queryText = JSON.stringify(callArg);
      // Must use source_type = 'sport_center' relationship
      expect(queryText).toContain("source_type");
      expect(queryText).toContain("source_doc_id");
      // Must NOT use the broken column
      expect(queryText).not.toContain("accounting_payment_id");
    });

    it("scopes query to company_id when provided", async () => {
      const client = makeClient([posted()]);
      await resolveJournalForEconomicEvent(client as any, {
        ...BASE_ARGS,
        companyId: 5,
        candidateType: "sport_payment",
        candidateId: 42,
      });
      const callArg = client.execute.mock.calls[0][0];
      const queryText = JSON.stringify(callArg);
      expect(queryText).toContain("company_id");
      expect(queryText).toContain("5");
    });
  });

  // ── REJECT_DUPLICATE: same mutation link is NOT a duplicate ───────────────

  it("same mutation already linked to same entry → REUSE (idempotent approve)", async () => {
    // reconciled_mutation_id === mutationId means this mutation already approved this journal
    const client = makeClient([posted({ reconciled_mutation_id: 7 })]);
    const result = await resolveJournalForEconomicEvent(client as any, {
      ...BASE_ARGS,
      mutationId: 7, // same mutation
    });
    // Should still REUSE — linking to same mutation is idempotent
    expect(result.decision).toBe("REUSE_EXISTING_JOURNAL");
  });

});
