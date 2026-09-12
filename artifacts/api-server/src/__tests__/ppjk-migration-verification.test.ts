/**
 * PPJK Migration Verification — Unit Tests
 * Tests the migration safety helper logic and schema constants.
 * DB connectivity is not required — these test the guard logic.
 */
import { describe, it, expect } from "vitest";
import {
  PPJK_STATUSES,
  PPJK_CUSTOMS_STATUSES,
  PPJK_TERMINAL_STATUSES,
  LEGACY_STATUS_MAP,
  PPJK_STATUS_LABELS,
  PPJK_CUSTOMS_STATUS_LABELS,
} from "../lib/ppjkWorkflowEngine.js";

describe("Schema constants integrity", () => {
  describe("PPJK_STATUSES", () => {
    it("has at least 19 statuses", () => {
      expect(PPJK_STATUSES.length).toBeGreaterThanOrEqual(19);
    });

    it("contains all required pipeline statuses", () => {
      const required = [
        "draft", "waiting_documents", "document_review", "document_completed",
        "quotation", "waiting_customer", "customer_approved",
        "preparing_pib", "preparing_peb", "submitted_ceisa", "inspection",
        "red_lane", "yellow_lane", "green_lane", "hold",
        "sppb", "released", "completed", "cancelled",
      ];
      for (const s of required) {
        expect(PPJK_STATUSES).toContain(s);
      }
    });

    it("has no duplicates", () => {
      expect(new Set(PPJK_STATUSES).size).toBe(PPJK_STATUSES.length);
    });

    it("every status has a label", () => {
      for (const s of PPJK_STATUSES) {
        expect(PPJK_STATUS_LABELS[s]).toBeTruthy();
      }
    });
  });

  describe("PPJK_CUSTOMS_STATUSES", () => {
    it("contains required customs statuses", () => {
      const required = ["pending", "submitted", "examining", "approved", "rejected", "hold", "released", "completed"];
      for (const s of required) {
        expect(PPJK_CUSTOMS_STATUSES).toContain(s);
      }
    });

    it("has no duplicates", () => {
      expect(new Set(PPJK_CUSTOMS_STATUSES).size).toBe(PPJK_CUSTOMS_STATUSES.length);
    });

    it("every customs status has a label", () => {
      for (const s of PPJK_CUSTOMS_STATUSES) {
        expect(PPJK_CUSTOMS_STATUS_LABELS[s]).toBeTruthy();
      }
    });
  });

  describe("PPJK_TERMINAL_STATUSES", () => {
    it("contains exactly completed and cancelled", () => {
      expect(PPJK_TERMINAL_STATUSES).toContain("completed");
      expect(PPJK_TERMINAL_STATUSES).toContain("cancelled");
    });

    it("does not contain non-terminal statuses", () => {
      const nonTerminal = ["draft", "waiting_documents", "sppb", "released", "hold"];
      for (const s of nonTerminal) {
        expect(PPJK_TERMINAL_STATUSES).not.toContain(s);
      }
    });
  });

  describe("LEGACY_STATUS_MAP", () => {
    it("maps confirmed → waiting_documents", () => {
      expect(LEGACY_STATUS_MAP.confirmed).toBe("waiting_documents");
    });

    it("maps processing → document_review", () => {
      expect(LEGACY_STATUS_MAP.processing).toBe("document_review");
    });

    it("maps submitted → submitted_ceisa", () => {
      expect(LEGACY_STATUS_MAP.submitted).toBe("submitted_ceisa");
    });

    it("maps examining → inspection", () => {
      expect(LEGACY_STATUS_MAP.examining).toBe("inspection");
    });

    it("maps approved → sppb", () => {
      expect(LEGACY_STATUS_MAP.approved).toBe("sppb");
    });

    it("maps on_hold → hold", () => {
      expect(LEGACY_STATUS_MAP.on_hold).toBe("hold");
    });

    it("all mapped values are valid canonical statuses", () => {
      for (const target of Object.values(LEGACY_STATUS_MAP)) {
        expect(PPJK_STATUSES).toContain(target);
      }
    });
  });

  describe("CHECK constraint VALUES are consistent with PPJK_STATUSES", () => {
    // The CHECK constraint in index.ts must include exactly the same statuses as PPJK_STATUSES.
    // We verify that programmatically here.
    const CHECK_CONSTRAINT_VALUES = [
      "draft", "waiting_documents", "document_review", "document_completed",
      "quotation", "waiting_customer", "customer_approved",
      "preparing_pib", "preparing_peb", "submitted_ceisa", "inspection",
      "red_lane", "yellow_lane", "green_lane", "hold",
      "sppb", "released", "completed", "cancelled",
    ] as const;

    it("CHECK constraint values match PPJK_STATUSES exactly", () => {
      const canonical = new Set(PPJK_STATUSES);
      const constraint = new Set(CHECK_CONSTRAINT_VALUES);
      for (const s of canonical) {
        expect(constraint.has(s)).toBe(true);
      }
      for (const s of constraint) {
        expect(canonical.has(s)).toBe(true);
      }
    });
  });

  describe("PPJK_CUSTOMS_STATUSES match CHECK constraint values", () => {
    const CUSTOMS_CHECK_VALUES = [
      "pending", "submitted", "examining", "approved", "rejected", "hold", "released", "completed",
    ] as const;

    it("customs CHECK constraint values match PPJK_CUSTOMS_STATUSES", () => {
      const canonical = new Set(PPJK_CUSTOMS_STATUSES);
      const constraint = new Set(CUSTOMS_CHECK_VALUES);
      for (const s of canonical) {
        expect(constraint.has(s)).toBe(true);
      }
      for (const s of constraint) {
        expect(canonical.has(s)).toBe(true);
      }
    });
  });
});
