/**
 * PPJK Workflow Security — Unit Tests
 * Tests the workflow engine's security rules (forceAdmin, terminal states, transitions).
 */
import { describe, it, expect } from "vitest";
import {
  isTransitionAllowed,
  allowedTransitions,
  isValidStatus,
  normaliseStatus,
  isValidCustomsStatus,
  PPJK_TERMINAL_STATUSES,
  PPJK_CUSTOMS_STATUSES,
  PPJK_STATUSES,
  LEGACY_STATUS_MAP,
} from "../lib/ppjkWorkflowEngine.js";

describe("isTransitionAllowed", () => {
  describe("normal transitions", () => {
    it("allows draft → waiting_documents", () => {
      expect(isTransitionAllowed("draft", "waiting_documents")).toBe(true);
    });

    it("allows document_completed → quotation", () => {
      expect(isTransitionAllowed("document_completed", "quotation")).toBe(true);
    });

    it("blocks draft → completed (non-sequential)", () => {
      expect(isTransitionAllowed("draft", "completed")).toBe(false);
    });

    it("blocks no-op same status", () => {
      expect(isTransitionAllowed("draft", "draft")).toBe(false);
    });

    it("blocks unknown status", () => {
      expect(isTransitionAllowed("draft", "unknown_status")).toBe(false);
    });
  });

  describe("forceAdmin (cancel override)", () => {
    it("forceAdmin=true allows any non-terminal → cancelled", () => {
      for (const status of ["draft", "waiting_documents", "document_review", "quotation", "inspection"]) {
        expect(isTransitionAllowed(status, "cancelled", true)).toBe(true);
      }
    });

    it("forceAdmin=true CANNOT transition out of completed (terminal)", () => {
      expect(isTransitionAllowed("completed", "waiting_documents", true)).toBe(false);
    });

    it("forceAdmin=true CANNOT transition out of cancelled (terminal)", () => {
      expect(isTransitionAllowed("cancelled", "draft", true)).toBe(false);
    });

    it("forceAdmin=false cannot skip normal flow", () => {
      expect(isTransitionAllowed("draft", "completed", false)).toBe(false);
    });

    it("forceAdmin=true only allows → cancelled, not arbitrary skips", () => {
      // Cannot skip from draft to sppb even with forceAdmin
      expect(isTransitionAllowed("draft", "sppb", true)).toBe(false);
    });
  });

  describe("terminal status enforcement", () => {
    it("completed is terminal — no transitions allowed", () => {
      expect(allowedTransitions("completed")).toEqual([]);
    });

    it("cancelled is terminal — no transitions allowed", () => {
      expect(allowedTransitions("cancelled")).toEqual([]);
    });

    it("PPJK_TERMINAL_STATUSES contains completed and cancelled", () => {
      expect(PPJK_TERMINAL_STATUSES).toContain("completed");
      expect(PPJK_TERMINAL_STATUSES).toContain("cancelled");
    });
  });

  describe("legacy status normalization", () => {
    it("accepts legacy 'confirmed' as waiting_documents", () => {
      expect(isTransitionAllowed("confirmed", "document_review")).toBe(true);
    });

    it("accepts legacy 'processing' as document_review", () => {
      expect(isTransitionAllowed("processing", "document_completed")).toBe(true);
    });

    it("maps 'on_hold' to 'hold' for transitions", () => {
      expect(isTransitionAllowed("on_hold", "inspection")).toBe(true);
    });

    it("normaliseStatus maps all legacy values", () => {
      for (const [legacy, canonical] of Object.entries(LEGACY_STATUS_MAP)) {
        expect(normaliseStatus(legacy)).toBe(canonical);
      }
    });
  });
});

describe("isValidStatus", () => {
  it("accepts all canonical statuses", () => {
    for (const s of PPJK_STATUSES) {
      expect(isValidStatus(s)).toBe(true);
    }
  });

  it("accepts legacy status strings", () => {
    expect(isValidStatus("confirmed")).toBe(true);
    expect(isValidStatus("processing")).toBe(true);
    expect(isValidStatus("submitted")).toBe(true);
  });

  it("rejects garbage strings", () => {
    expect(isValidStatus("random_garbage")).toBe(false);
    expect(isValidStatus("")).toBe(false);
    expect(isValidStatus("DRAFT")).toBe(false); // case-sensitive
  });
});

describe("isValidCustomsStatus", () => {
  it("accepts all valid customs statuses", () => {
    for (const s of PPJK_CUSTOMS_STATUSES) {
      expect(isValidCustomsStatus(s)).toBe(true);
    }
  });

  it("rejects invalid customs status", () => {
    expect(isValidCustomsStatus("invalid")).toBe(false);
    expect(isValidCustomsStatus("draft")).toBe(false); // workflow status, not customs
    expect(isValidCustomsStatus("")).toBe(false);
  });
});

describe("allowedTransitions", () => {
  it("returns array for every valid status", () => {
    for (const s of PPJK_STATUSES) {
      const allowed = allowedTransitions(s);
      expect(Array.isArray(allowed)).toBe(true);
    }
  });

  it("all targets of a transition are valid statuses", () => {
    for (const s of PPJK_STATUSES) {
      for (const t of allowedTransitions(s)) {
        expect(PPJK_STATUSES).toContain(t);
      }
    }
  });
});
