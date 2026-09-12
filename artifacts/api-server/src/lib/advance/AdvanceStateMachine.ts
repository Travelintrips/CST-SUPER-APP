/**
 * AdvanceStateMachine — Canonical status transition graph for Advance Management.
 *
 * ALL status changes MUST be validated through canTransition() or assertTransition().
 * Routes that bypass this guard are architecture violations.
 *
 * ┌─────────────────────────────────────────────────────────────────────────┐
 * │  Status Flow                                                             │
 * │                                                                          │
 * │  draft ──► pending_approval ──► approved ──► disbursed ──► outstanding │
 * │    │             │                  │                          │         │
 * │    │             ▼                  │                          ▼         │
 * │    │          rejected (terminal)   ▼                  partially_settled │
 * │    │                             void                          │         │
 * │    │                               │                          ▼         │
 * │    ▼                               ▼                        settled      │
 * │ cancelled (terminal)           reversed (terminal)             │         │
 * │                                                                ▼         │
 * │                                                             closed        │
 * │                                                           (terminal)      │
 * └─────────────────────────────────────────────────────────────────────────┘
 *
 * VOID rules:   Only from draft / pending_approval / approved. Money must NOT have moved.
 * REVERSE rules: Only when a posted journal exists (outstanding / partially_settled).
 * REPAY rules:  Only from disbursed / outstanding / partially_settled.
 * SETTLE rules: Same as REPAY.
 */

import { InvalidTransitionError } from "./AdvanceErrors.js";

// ── Status type ───────────────────────────────────────────────────────────────

export type LifecycleStatus =
  | "draft"
  | "pending_approval"
  | "approved"
  | "rejected"
  | "disbursed"
  | "outstanding"
  | "partially_settled"
  | "settled"
  | "closed"
  | "void"
  | "reversed"
  | "cancelled";

export const ALL_LIFECYCLE_STATUSES: LifecycleStatus[] = [
  "draft",
  "pending_approval",
  "approved",
  "rejected",
  "disbursed",
  "outstanding",
  "partially_settled",
  "settled",
  "closed",
  "void",
  "reversed",
  "cancelled",
];

export const TERMINAL_STATUSES: LifecycleStatus[] = [
  "rejected",
  "cancelled",
  "closed",
  "reversed",
];

// ── Transition graph ──────────────────────────────────────────────────────────

const TRANSITIONS: Record<LifecycleStatus, LifecycleStatus[]> = {
  draft:             ["pending_approval", "cancelled", "void"],
  pending_approval:  ["approved", "rejected", "cancelled", "void"],
  approved:          ["disbursed", "void"],
  rejected:          [],
  disbursed:         ["outstanding", "reversed"],
  outstanding:       ["partially_settled", "settled", "reversed"],
  partially_settled: ["settled", "reversed"],
  settled:           ["closed"],
  closed:            [],
  void:              ["reversed"],
  reversed:          [],
  cancelled:         [],
};

// ── Guard functions ───────────────────────────────────────────────────────────

/** Returns true if from → to is a valid transition. */
export function canTransition(from: LifecycleStatus, to: LifecycleStatus): boolean {
  return (TRANSITIONS[from] ?? []).includes(to);
}

/** Throws InvalidTransitionError if transition is not allowed. */
export function assertTransition(from: LifecycleStatus, to: LifecycleStatus): void {
  if (!canTransition(from, to)) {
    throw new InvalidTransitionError(from, to);
  }
}

/**
 * Void rules:
 *  ✓ Allowed: draft (no journal), pending_approval, approved (journal posted, money not out)
 *  ✗ Blocked: if money has moved (paid_amount > 0 OR disbursed)
 *  ✗ Blocked: settled, closed, reversed, rejected, cancelled
 */
export function canVoid(status: LifecycleStatus, moneyMoved: boolean): boolean {
  if (moneyMoved) return false;
  return ["draft", "pending_approval", "approved"].includes(status);
}

/**
 * Reverse rules: only for advances where money has moved and a posted journal exists.
 * Creates a counter-entry; advance status moves to 'reversed'.
 */
export function canReverse(status: LifecycleStatus): boolean {
  return ["disbursed", "outstanding", "partially_settled"].includes(status);
}

/**
 * Repayment rules: money is already out and counterparty is returning it.
 */
export function canRepay(status: LifecycleStatus): boolean {
  return ["disbursed", "outstanding", "partially_settled"].includes(status);
}

/**
 * Settlement rules: reclassify remaining to expense or apply allocation.
 */
export function canSettle(status: LifecycleStatus): boolean {
  return ["disbursed", "outstanding", "partially_settled"].includes(status);
}

/**
 * Delete rules: hard-delete only if no journal has been posted.
 */
export function canDelete(status: LifecycleStatus, entryId: number | null): boolean {
  return entryId == null && ["draft", "pending_approval", "rejected", "cancelled"].includes(status);
}

// ── Status derivation ─────────────────────────────────────────────────────────

/**
 * Derive lifecycle_status after a repayment or settlement reduces remaining_amount.
 */
export function deriveStatusAfterPayment(remaining: number): LifecycleStatus {
  return remaining <= 0.005 ? "settled" : "partially_settled";
}

/**
 * Map legacy cash_advances.status → lifecycle_status (for migration + legacy reads).
 */
export function mapLegacyStatus(legacyStatus: string): LifecycleStatus {
  const map: Record<string, LifecycleStatus> = {
    active:           "outstanding",
    partial:          "partially_settled",
    repaid:           "settled",
    accounted:        "settled",
    void:             "void",
    pending_approval: "pending_approval",
    rejected:         "rejected",
    approved:         "approved",
    disbursed:        "disbursed",
  };
  return map[legacyStatus] ?? "outstanding";
}

/**
 * Map lifecycle_status → legacy cash_advances.status (for backward compat with legacy routes).
 */
export function mapToLegacyStatus(lifecycle: LifecycleStatus): string {
  const map: Record<LifecycleStatus, string> = {
    draft:             "pending_approval",
    pending_approval:  "pending_approval",
    approved:          "active",
    rejected:          "rejected",
    disbursed:         "active",
    outstanding:       "active",
    partially_settled: "partial",
    settled:           "repaid",
    closed:            "repaid",
    void:              "void",
    reversed:          "void",
    cancelled:         "rejected",
  };
  return map[lifecycle] ?? "active";
}
