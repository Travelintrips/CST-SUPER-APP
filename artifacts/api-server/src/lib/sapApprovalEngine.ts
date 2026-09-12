/**
 * SAP ENTERPRISE APPROVAL WORKFLOW ENGINE (FI Module)
 * =====================================================
 * Strict hierarchical state machine for financial document lifecycle.
 *
 * FLOW (spec-compliant, no-skip):
 *   DRAFT → PENDING_APPROVAL → APPROVED_LEVEL_1 → FINAL_APPROVED → POSTED → LOCKED
 *
 * RULES (NON-NEGOTIABLE):
 *  1. Every document MUST pass through all states — no skipping
 *  2. Rejection always resets to DRAFT
 *  3. Any mutation after FINAL_APPROVED is forbidden — use reversal
 *  4. Approval history is append-only and must never be deleted
 *  5. Only FINAL_APPROVED documents can be posted
 *  6. LOCKED documents are permanently immutable
 */

import { db } from "@workspace/db";
import { sql } from "drizzle-orm";
import { logger } from "./logger.js";

// ── State Machine ─────────────────────────────────────────────────────────────

export const APPROVAL_STATES = {
  DRAFT:   "DRAFT",
  PENDING: "PENDING_APPROVAL",
  L1:      "APPROVED_LEVEL_1",
  L2:      "APPROVED_LEVEL_2",
  FINAL:   "FINAL_APPROVED",
  POSTED:  "POSTED",
  LOCKED:  "LOCKED",
} as const;

export type ApprovalState = (typeof APPROVAL_STATES)[keyof typeof APPROVAL_STATES];

/** Ordered transition map — each state can only advance to the next. */
const ALLOWED_TRANSITIONS: Record<ApprovalState, ApprovalState | null> = {
  DRAFT:             "PENDING_APPROVAL",
  PENDING_APPROVAL:  "APPROVED_LEVEL_1",
  APPROVED_LEVEL_1:  "FINAL_APPROVED",
  APPROVED_LEVEL_2:  "FINAL_APPROVED",
  FINAL_APPROVED:    "POSTED",
  POSTED:            "LOCKED",
  LOCKED:            null,
};

export interface ApprovalHistoryEntry {
  action: "SUBMITTED" | "APPROVED" | "REJECTED" | "POSTED" | "LOCKED";
  from_state: ApprovalState;
  to_state: ApprovalState;
  role: string;
  actor_id?: string | null;
  note?: string | null;
  timestamp: string;
}

export interface SapApprovalDocument {
  entity_type: string;
  entity_id: number | string;
  status: ApprovalState;
  current_approver: string | null;
  approval_history: ApprovalHistoryEntry[];
  updated_at: string;
}

// ── State Machine Core ────────────────────────────────────────────────────────

/**
 * Advance a document to the next approval state.
 * Throws on invalid transition or if document is LOCKED.
 */
export function approveDocument(
  doc: SapApprovalDocument,
  role: string,
  actorId?: string | null,
  note?: string | null,
): SapApprovalDocument {
  if (doc.status === APPROVAL_STATES.LOCKED) {
    throw new Error("DOCUMENT_LOCKED");
  }

  const nextState = ALLOWED_TRANSITIONS[doc.status];
  if (!nextState) {
    throw new Error(`INVALID_STATE_TRANSITION — cannot advance from ${doc.status}`);
  }

  // Only FINAL_APPROVED can move to POSTED
  if (nextState === APPROVAL_STATES.POSTED && doc.status !== APPROVAL_STATES.FINAL) {
    throw new Error("CANNOT_POST — document must be FINAL_APPROVED first");
  }

  const entry: ApprovalHistoryEntry = {
    action:     doc.status === APPROVAL_STATES.DRAFT ? "SUBMITTED" :
                nextState  === APPROVAL_STATES.POSTED ? "POSTED" :
                nextState  === APPROVAL_STATES.LOCKED ? "LOCKED" : "APPROVED",
    from_state: doc.status,
    to_state:   nextState,
    role,
    actor_id:   actorId ?? null,
    note:       note ?? null,
    timestamp:  new Date().toISOString(),
  };

  return {
    ...doc,
    status:           nextState,
    current_approver: role,
    approval_history: [...doc.approval_history, entry],
    updated_at:       new Date().toISOString(),
  };
}

/**
 * Reject a document — always resets to DRAFT regardless of current state.
 * Throws if document is LOCKED or already DRAFT.
 */
export function rejectDocument(
  doc: SapApprovalDocument,
  role: string,
  actorId?: string | null,
  note?: string | null,
): SapApprovalDocument {
  if (doc.status === APPROVAL_STATES.LOCKED) {
    throw new Error("DOCUMENT_LOCKED — cannot reject a locked document");
  }
  if (doc.status === APPROVAL_STATES.DRAFT) {
    throw new Error("ALREADY_DRAFT — document is already in DRAFT state");
  }
  if (doc.status === APPROVAL_STATES.POSTED || doc.status === APPROVAL_STATES.FINAL) {
    throw new Error(`CANNOT_REJECT_${doc.status} — use reversal journal instead`);
  }

  const entry: ApprovalHistoryEntry = {
    action:     "REJECTED",
    from_state: doc.status,
    to_state:   APPROVAL_STATES.DRAFT,
    role,
    actor_id:   actorId ?? null,
    note:       note ?? null,
    timestamp:  new Date().toISOString(),
  };

  return {
    ...doc,
    status:           APPROVAL_STATES.DRAFT,
    current_approver: null,
    approval_history: [...doc.approval_history, entry],
    updated_at:       new Date().toISOString(),
  };
}

// ── DB Persistence ────────────────────────────────────────────────────────────

/**
 * Load or initialize a SAP approval state document from DB.
 * If none exists, creates a fresh DRAFT record.
 */
export async function loadOrCreateApprovalState(
  entityType: string,
  entityId: number | string,
): Promise<SapApprovalDocument> {
  const result = await db.execute<{
    entity_type: string;
    entity_id: string;
    status: string;
    current_approver: string | null;
    approval_history: ApprovalHistoryEntry[] | string;
    updated_at: string;
  }>(sql`
    SELECT entity_type, entity_id, status, current_approver,
           approval_history, updated_at::text
    FROM   sap_approval_states
    WHERE  entity_type = ${entityType}
      AND  entity_id   = ${String(entityId)}
    LIMIT 1
  `);

  if (result.rows.length > 0) {
    const row = result.rows[0];
    const history = typeof row.approval_history === "string"
      ? JSON.parse(row.approval_history)
      : (row.approval_history ?? []);
    return {
      entity_type:      row.entity_type,
      entity_id:        row.entity_id,
      status:           row.status as ApprovalState,
      current_approver: row.current_approver,
      approval_history: history,
      updated_at:       row.updated_at,
    };
  }

  // Create fresh DRAFT
  const now = new Date().toISOString();
  await db.execute(sql`
    INSERT INTO sap_approval_states
      (entity_type, entity_id, status, current_approver, approval_history, updated_at)
    VALUES
      (${entityType}, ${String(entityId)}, 'DRAFT', NULL, '[]'::jsonb, ${now}::timestamptz)
    ON CONFLICT (entity_type, entity_id) DO NOTHING
  `);

  return {
    entity_type:      entityType,
    entity_id:        String(entityId),
    status:           APPROVAL_STATES.DRAFT,
    current_approver: null,
    approval_history: [],
    updated_at:       now,
  };
}

/** Persist updated approval state back to DB. */
export async function saveApprovalState(doc: SapApprovalDocument): Promise<void> {
  await db.execute(sql`
    UPDATE sap_approval_states
    SET status           = ${doc.status},
        current_approver = ${doc.current_approver},
        approval_history = ${JSON.stringify(doc.approval_history)}::jsonb,
        updated_at       = ${doc.updated_at}::timestamptz
    WHERE entity_type = ${doc.entity_type}
      AND entity_id   = ${String(doc.entity_id)}
  `);
}

// ── SAP Audit Ledger ─────────────────────────────────────────────────────────

export interface SapAuditEntry {
  id: string;
  entity_type: string;
  entity_id: string;
  action: string;
  actor_id: string | null;
  role: string | null;
  before: unknown;
  after: unknown;
  timestamp: string;
}

/**
 * Build an audit entry (pure — no DB write).
 * Pass to writeSapAuditLog() to persist.
 */
export function buildAuditLog(params: {
  entityType: string;
  entityId: number | string;
  action: string;
  actorId?: string | null;
  role?: string | null;
  before?: unknown;
  after?: unknown;
}): SapAuditEntry {
  return {
    id:          crypto.randomUUID(),
    entity_type: params.entityType,
    entity_id:   String(params.entityId),
    action:      params.action,
    actor_id:    params.actorId ?? null,
    role:        params.role ?? null,
    before:      params.before ?? null,
    after:       params.after ?? null,
    timestamp:   new Date().toISOString(),
  };
}

/**
 * Write to immutable `sap_audit_ledger`.
 * APPEND-ONLY — no UPDATE, no DELETE ever.
 */
export async function writeSapAuditLog(entry: SapAuditEntry): Promise<void> {
  try {
    await db.execute(sql`
      INSERT INTO sap_audit_ledger
        (id, entity_type, entity_id, action, actor_id, role, before_data, after_data, timestamp)
      VALUES (
        ${entry.id},
        ${entry.entity_type},
        ${entry.entity_id},
        ${entry.action},
        ${entry.actor_id},
        ${entry.role},
        ${entry.before !== null ? JSON.stringify(entry.before) : null}::jsonb,
        ${entry.after  !== null ? JSON.stringify(entry.after)  : null}::jsonb,
        ${entry.timestamp}::timestamptz
      )
    `);
  } catch (e) {
    logger.error({ err: e, entry }, "[sap-audit] Failed to write audit log — non-fatal");
  }
}
