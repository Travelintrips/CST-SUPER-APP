/**
 * PPJK Phase 2 — Workflow Engine Tests
 * Tests: workflow transitions, SLA, status validation, auto-create detection
 */
import { describe, it, expect } from "vitest";
import {
  isTransitionAllowed,
  allowedTransitions,
  computeSlaDeadline,
  isOverdue,
  isValidStatus,
  normaliseStatus,
  PPJK_STATUSES,
  SLA_HOURS,
  LEGACY_STATUS_MAP,
} from "../lib/ppjkWorkflowEngine.js";
import { isPpjkOrder } from "../lib/ppjkAutoCreate.js";

// ── Workflow transition tests ─────────────────────────────────────────────────
describe("Workflow transitions", () => {
  it("allows draft → waiting_documents", () => {
    expect(isTransitionAllowed("draft", "waiting_documents")).toBe(true);
  });

  it("blocks draft → completed", () => {
    expect(isTransitionAllowed("draft", "completed")).toBe(false);
  });

  it("blocks draft → sppb", () => {
    expect(isTransitionAllowed("draft", "sppb")).toBe(false);
  });

  it("allows waiting_documents → document_review", () => {
    expect(isTransitionAllowed("waiting_documents", "document_review")).toBe(true);
  });

  it("allows document_review → document_completed", () => {
    expect(isTransitionAllowed("document_review", "document_completed")).toBe(true);
  });

  it("allows document_review → waiting_documents (re-request)", () => {
    expect(isTransitionAllowed("document_review", "waiting_documents")).toBe(true);
  });

  it("allows inspection → red_lane, yellow_lane, green_lane", () => {
    expect(isTransitionAllowed("inspection", "red_lane")).toBe(true);
    expect(isTransitionAllowed("inspection", "yellow_lane")).toBe(true);
    expect(isTransitionAllowed("inspection", "green_lane")).toBe(true);
  });

  it("allows green_lane → sppb", () => {
    expect(isTransitionAllowed("green_lane", "sppb")).toBe(true);
  });

  it("allows sppb → released", () => {
    expect(isTransitionAllowed("sppb", "released")).toBe(true);
  });

  it("allows released → completed", () => {
    expect(isTransitionAllowed("released", "completed")).toBe(true);
  });

  it("blocks completed → any status (terminal)", () => {
    expect(isTransitionAllowed("completed", "draft")).toBe(false);
    expect(isTransitionAllowed("completed", "sppb")).toBe(false);
  });

  it("blocks cancelled → any status (terminal)", () => {
    expect(isTransitionAllowed("cancelled", "draft")).toBe(false);
    expect(isTransitionAllowed("cancelled", "completed")).toBe(false);
  });

  it("allows any non-terminal → cancelled with forceAdmin=true", () => {
    expect(isTransitionAllowed("preparing_pib", "cancelled", true)).toBe(true);
    expect(isTransitionAllowed("inspection", "cancelled", true)).toBe(true);
  });

  it("blocks completed → cancelled even with forceAdmin", () => {
    expect(isTransitionAllowed("completed", "cancelled", true)).toBe(false);
  });

  it("blocks same-status transition", () => {
    expect(isTransitionAllowed("draft", "draft")).toBe(false);
  });
});

// ── Legacy status migration tests ─────────────────────────────────────────────
describe("Legacy status normalisation", () => {
  it("maps confirmed → waiting_documents", () => {
    expect(normaliseStatus("confirmed")).toBe("waiting_documents");
  });

  it("maps processing → document_review", () => {
    expect(normaliseStatus("processing")).toBe("document_review");
  });

  it("maps submitted → submitted_ceisa", () => {
    expect(normaliseStatus("submitted")).toBe("submitted_ceisa");
  });

  it("maps examining → inspection", () => {
    expect(normaliseStatus("examining")).toBe("inspection");
  });

  it("maps approved → sppb", () => {
    expect(normaliseStatus("approved")).toBe("sppb");
  });

  it("maps on_hold → hold", () => {
    expect(normaliseStatus("on_hold")).toBe("hold");
  });

  it("passes through new statuses unchanged", () => {
    expect(normaliseStatus("draft")).toBe("draft");
    expect(normaliseStatus("green_lane")).toBe("green_lane");
    expect(normaliseStatus("submitted_ceisa")).toBe("submitted_ceisa");
  });

  it("allows legacy confirmed → document_review after normalisation", () => {
    expect(isTransitionAllowed("confirmed", "document_review")).toBe(true);
  });
});

// ── Valid status tests ────────────────────────────────────────────────────────
describe("Status validation", () => {
  it("accepts all 19 new statuses", () => {
    for (const s of PPJK_STATUSES) {
      expect(isValidStatus(s)).toBe(true);
    }
  });

  it("accepts legacy statuses via normalisation map", () => {
    for (const s of Object.keys(LEGACY_STATUS_MAP)) {
      expect(isValidStatus(s)).toBe(true);
    }
  });

  it("rejects invalid status strings", () => {
    expect(isValidStatus("random_garbage")).toBe(false);
    expect(isValidStatus("")).toBe(false);
    expect(isValidStatus("DRAFT")).toBe(false); // case sensitive
  });

  it("reports allowed transitions from draft", () => {
    const allowed = allowedTransitions("draft");
    expect(allowed).toContain("waiting_documents");
    expect(allowed).toContain("cancelled");
    expect(allowed).not.toContain("completed");
    expect(allowed).not.toContain("sppb");
  });
});

// ── SLA tests ─────────────────────────────────────────────────────────────────
describe("SLA calculation", () => {
  it("computes SLA deadline for waiting_documents (24h)", () => {
    const enteredAt = new Date("2026-01-01T10:00:00Z");
    const deadline = computeSlaDeadline("waiting_documents", enteredAt);
    expect(deadline).not.toBeNull();
    expect(deadline!.getTime()).toBe(enteredAt.getTime() + 24 * 3600 * 1000);
  });

  it("computes SLA deadline for sppb (2h)", () => {
    const enteredAt = new Date("2026-01-01T10:00:00Z");
    const deadline = computeSlaDeadline("sppb", enteredAt);
    expect(deadline).not.toBeNull();
    expect(deadline!.getTime()).toBe(enteredAt.getTime() + 2 * 3600 * 1000);
  });

  it("returns null SLA for terminal statuses (completed, cancelled, draft)", () => {
    const now = new Date();
    expect(computeSlaDeadline("completed", now)).toBeNull();
    expect(computeSlaDeadline("cancelled", now)).toBeNull();
    expect(computeSlaDeadline("draft", now)).toBeNull();
  });

  it("detects overdue when deadline in past", () => {
    const pastDeadline = new Date(Date.now() - 3600 * 1000); // 1h ago
    expect(isOverdue(pastDeadline)).toBe(true);
  });

  it("detects not-overdue when deadline in future", () => {
    const futureDeadline = new Date(Date.now() + 3600 * 1000); // 1h from now
    expect(isOverdue(futureDeadline)).toBe(false);
  });

  it("returns false for null deadline", () => {
    expect(isOverdue(null)).toBe(false);
  });

  it("all SLA hours are positive integers", () => {
    for (const [status, hours] of Object.entries(SLA_HOURS)) {
      expect(typeof hours).toBe("number");
      expect(hours).toBeGreaterThan(0);
    }
  });
});

// ── Auto-create detection tests ───────────────────────────────────────────────
describe("PPJK auto-create detection", () => {
  it("detects 'Pengurusan Pabean / PPJK'", () => {
    expect(isPpjkOrder("Pengurusan Pabean / PPJK")).toBe(true);
  });

  it("detects 'Custom Clearance Proses'", () => {
    expect(isPpjkOrder("Custom Clearance Proses")).toBe(true);
  });

  it("detects PIB-related shipment types", () => {
    expect(isPpjkOrder("Pembuatan PIB Impor")).toBe(true);
  });

  it("detects PEB-related shipment types", () => {
    expect(isPpjkOrder("Pengurusan PEB Ekspor")).toBe(true);
  });

  it("detects kepabeanan keyword", () => {
    expect(isPpjkOrder("Layanan Kepabeanan")).toBe(true);
  });

  it("does NOT detect regular freight", () => {
    expect(isPpjkOrder("Air Freight")).toBe(false);
    expect(isPpjkOrder("Sea Freight")).toBe(false);
    expect(isPpjkOrder("Trucking Surabaya")).toBe(false);
    expect(isPpjkOrder("Ocean Freight")).toBe(false);
  });
});

// ── Transition completeness tests ─────────────────────────────────────────────
describe("Workflow completeness", () => {
  it("every status has an entry in PPJK_STATUS_LABELS", async () => {
    const { PPJK_STATUS_LABELS } = await import("../lib/ppjkWorkflowEngine.js");
    for (const s of PPJK_STATUSES) {
      expect(PPJK_STATUS_LABELS[s]).toBeDefined();
      expect(typeof PPJK_STATUS_LABELS[s]).toBe("string");
    }
  });

  it("there is a path from draft to completed", () => {
    // BFS through transition graph
    const visited = new Set<string>(["draft"]);
    const queue = ["draft"];
    while (queue.length > 0) {
      const curr = queue.shift()!;
      for (const next of allowedTransitions(curr)) {
        if (!visited.has(next)) {
          visited.add(next);
          queue.push(next);
        }
      }
    }
    expect(visited.has("completed")).toBe(true);
  });

  it("there is a path from any non-terminal status to cancelled", () => {
    const nonTerminals = PPJK_STATUSES.filter((s) => s !== "completed" && s !== "cancelled");
    for (const s of nonTerminals) {
      // Either direct cancellation or via forceAdmin
      const direct = allowedTransitions(s).includes("cancelled");
      const forceAllowed = isTransitionAllowed(s, "cancelled", true);
      expect(direct || forceAllowed).toBe(true);
    }
  });
});
