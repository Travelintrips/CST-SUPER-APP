/**
 * AI Governance Service
 *
 * Menyediakan fungsi untuk:
 *  1. logExecution()      — catat setiap AI action ke ai_agent_executions
 *  2. completeExecution() — update status + duration setelah AI selesai
 *  3. failExecution()     — tandai execution gagal dengan pesan error
 *  4. requestApproval()   — buat approval request di ai_approval_queue
 *  5. resolveApproval()   — approve/reject dari staff
 *  6. undoApproval()      — undo action dalam undo window
 *  7. expireStaleApprovals() — background job: expire approval yang lewat deadline
 *
 * Semua write adalah fire-and-forget kecuali yang mengembalikan ID.
 * Error ditulis ke logger, tidak melempar ke caller.
 */

import { db } from "@workspace/db";
import { sql } from "drizzle-orm";
import { logger } from "./logger.js";

// ── Types ─────────────────────────────────────────────────────────────────────

export type AgentType =
  | "customer"
  | "vendor"
  | "ops"
  | "customs"
  | "finance"
  | "intake"
  | "ocr"
  | "document";

export type ExecutionStatus =
  | "pending"
  | "running"
  | "completed"
  | "failed"
  | "skipped"
  | "awaiting_approval";

export type ApprovalStatus =
  | "pending"
  | "approved"
  | "rejected"
  | "expired"
  | "auto_approved";

export type ApprovalPriority = "low" | "medium" | "high" | "critical";

export interface SafetyCheck {
  check: string;
  passed: boolean;
  value?: unknown;
}

export interface LogExecutionInput {
  agentType: AgentType;
  action: string;
  confidence?: number | null;
  reasoning?: string | null;
  modelUsed?: string | null;
  inputTokens?: number | null;
  outputTokens?: number | null;
  inputSummary?: string | null;
  outputSummary?: string | null;
  inputData?: Record<string, unknown> | null;
  outputData?: Record<string, unknown> | null;
  orderId?: number | null;
  rfqId?: number | null;
  companyId?: number | null;
  triggeredBy?: "system" | "user" | "agent" | "webhook" | "scheduler";
  triggeredById?: string | null;
  reqId?: string | null;
  safetyChecks?: SafetyCheck[] | null;
  humanApprovalRequired?: boolean;
  status?: ExecutionStatus;
}

export interface RequestApprovalInput {
  executionId?: number | null;
  agentType: AgentType;
  action: string;
  actionDescription: string;
  contextData?: Record<string, unknown> | null;
  priority?: ApprovalPriority;
  amount?: number | null;
  orderId?: number | null;
  rfqId?: number | null;
  companyId?: number | null;
  requestedById?: string | null;
  /** Berapa menit sampai expired. Default: 1440 (24 jam) */
  ttlMinutes?: number;
  /** Berapa menit sampai auto-approve jika tidak ada respons. Null = tidak ada auto-approve */
  autoApproveMinutes?: number | null;
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function safeJson(val: unknown): string | null {
  if (val == null) return null;
  try {
    return JSON.stringify(val);
  } catch {
    return null;
  }
}

// ── 1. Log Execution ──────────────────────────────────────────────────────────

/**
 * Catat AI action baru ke ai_agent_executions.
 * Mengembalikan execution ID untuk dipakai di completeExecution / failExecution.
 */
export async function logExecution(input: LogExecutionInput): Promise<number | null> {
  try {
    const result = await db.execute(sql`
      INSERT INTO ai_agent_executions (
        agent_type, action, status,
        confidence, reasoning, model_used,
        input_tokens, output_tokens,
        input_summary, output_summary,
        input_data, output_data,
        order_id, rfq_id, company_id,
        triggered_by, triggered_by_id, req_id,
        safety_checks, human_approval_required,
        created_at
      ) VALUES (
        ${input.agentType},
        ${input.action},
        ${input.status ?? (input.humanApprovalRequired ? "awaiting_approval" : "running")},
        ${input.confidence ?? null},
        ${input.reasoning ?? null},
        ${input.modelUsed ?? null},
        ${input.inputTokens ?? null},
        ${input.outputTokens ?? null},
        ${input.inputSummary ?? null},
        ${input.outputSummary ?? null},
        ${safeJson(input.inputData) ? sql`${safeJson(input.inputData)}::jsonb` : sql`NULL`},
        ${safeJson(input.outputData) ? sql`${safeJson(input.outputData)}::jsonb` : sql`NULL`},
        ${input.orderId ?? null},
        ${input.rfqId ?? null},
        ${input.companyId ?? null},
        ${input.triggeredBy ?? "system"},
        ${input.triggeredById ?? null},
        ${input.reqId ?? null},
        ${safeJson(input.safetyChecks) ? sql`${safeJson(input.safetyChecks)}::jsonb` : sql`NULL`},
        ${input.humanApprovalRequired ?? false},
        NOW()
      )
      RETURNING id
    `);
    const rows = result.rows as Array<{ id: number }>;
    return rows[0]?.id ?? null;
  } catch (err) {
    logger.error({ err, action: input.action }, "[aiGovernance] logExecution failed");
    return null;
  }
}

// ── 2. Complete Execution ─────────────────────────────────────────────────────

export async function completeExecution(
  executionId: number,
  opts: {
    outputSummary?: string;
    outputData?: Record<string, unknown>;
    durationMs?: number;
    approvalId?: number | null;
  } = {}
): Promise<void> {
  db.execute(sql`
    UPDATE ai_agent_executions SET
      status         = 'completed',
      output_summary = COALESCE(${opts.outputSummary ?? null}, output_summary),
      output_data    = COALESCE(
        ${safeJson(opts.outputData) ? sql`${safeJson(opts.outputData)}::jsonb` : sql`NULL`},
        output_data
      ),
      duration_ms    = ${opts.durationMs ?? null},
      approval_id    = COALESCE(${opts.approvalId ?? null}, approval_id),
      completed_at   = NOW()
    WHERE id = ${executionId}
  `).catch((err: unknown) => {
    logger.error({ err, executionId }, "[aiGovernance] completeExecution failed");
  });
}

// ── 3. Fail Execution ─────────────────────────────────────────────────────────

export async function failExecution(
  executionId: number,
  errorMessage: string,
  durationMs?: number
): Promise<void> {
  db.execute(sql`
    UPDATE ai_agent_executions SET
      status        = 'failed',
      error_message = ${errorMessage},
      duration_ms   = ${durationMs ?? null},
      completed_at  = NOW()
    WHERE id = ${executionId}
  `).catch((err: unknown) => {
    logger.error({ err, executionId }, "[aiGovernance] failExecution failed");
  });
}

// ── 4. Request Approval ───────────────────────────────────────────────────────

/**
 * Buat approval request di ai_approval_queue.
 * Mengembalikan approval ID untuk dilink ke execution.
 */
export async function requestApproval(input: RequestApprovalInput): Promise<number | null> {
  const ttl = input.ttlMinutes ?? 1440;
  const autoApproveMin = input.autoApproveMinutes ?? null;

  try {
    const result = await db.execute(sql`
      INSERT INTO ai_approval_queue (
        execution_id, agent_type, action,
        action_description, context_data,
        priority, amount,
        order_id, rfq_id, company_id, requested_by_id,
        status, expires_at, auto_approve_at,
        requested_at
      ) VALUES (
        ${input.executionId ?? null},
        ${input.agentType},
        ${input.action},
        ${input.actionDescription},
        ${safeJson(input.contextData) ? sql`${safeJson(input.contextData)}::jsonb` : sql`NULL`},
        ${input.priority ?? "medium"},
        ${input.amount ?? null},
        ${input.orderId ?? null},
        ${input.rfqId ?? null},
        ${input.companyId ?? null},
        ${input.requestedById ?? null},
        'pending',
        NOW() + (${ttl} || ' minutes')::INTERVAL,
        ${autoApproveMin != null ? sql`NOW() + (${autoApproveMin} || ' minutes')::INTERVAL` : sql`NULL`},
        NOW()
      )
      RETURNING id
    `);
    const rows = result.rows as Array<{ id: number }>;
    const approvalId = rows[0]?.id ?? null;

    // Link approval ke execution jika ada
    if (approvalId && input.executionId) {
      db.execute(sql`
        UPDATE ai_agent_executions
        SET approval_id = ${approvalId}
        WHERE id = ${input.executionId}
      `).catch((err: unknown) => {
        logger.warn({ err }, "[aiGovernance] link approval_id to execution failed (non-fatal)");
      });
    }

    return approvalId;
  } catch (err) {
    logger.error({ err, action: input.action }, "[aiGovernance] requestApproval failed");
    return null;
  }
}

// ── 5. Resolve Approval ───────────────────────────────────────────────────────

export interface ResolveApprovalResult {
  ok: boolean;
  status: ApprovalStatus | null;
  error?: string;
}

export async function resolveApproval(
  approvalId: number,
  decision: "approved" | "rejected",
  opts: {
    decidedBy: string;
    reason?: string;
    /** Undo window dalam menit. Default 30. 0 = tidak ada undo window. */
    undoWindowMinutes?: number;
  }
): Promise<ResolveApprovalResult> {
  try {
    const undoWindow = opts.undoWindowMinutes ?? 30;
    const result = await db.execute(sql`
      UPDATE ai_approval_queue SET
        status          = ${decision},
        decided_by      = ${opts.decidedBy},
        decided_at      = NOW(),
        decision_reason = ${opts.reason ?? null},
        undo_deadline   = ${decision === "approved" && undoWindow > 0
          ? sql`NOW() + (${undoWindow} || ' minutes')::INTERVAL`
          : sql`NULL`}
      WHERE id = ${approvalId}
        AND status = 'pending'
        AND expires_at > NOW()
      RETURNING status
    `);
    const rows = result.rows as Array<{ status: ApprovalStatus }>;
    if (rows.length === 0) {
      return { ok: false, status: null, error: "Approval not found, already decided, or expired" };
    }
    return { ok: true, status: rows[0].status };
  } catch (err) {
    logger.error({ err, approvalId }, "[aiGovernance] resolveApproval failed");
    return { ok: false, status: null, error: String(err) };
  }
}

// ── 6. Undo Approval ─────────────────────────────────────────────────────────

export async function undoApproval(
  approvalId: number,
  undoneBy: string
): Promise<{ ok: boolean; error?: string }> {
  try {
    const result = await db.execute(sql`
      UPDATE ai_approval_queue SET
        was_undone = TRUE,
        undone_by  = ${undoneBy},
        undone_at  = NOW()
      WHERE id = ${approvalId}
        AND status = 'approved'
        AND was_undone = FALSE
        AND undo_deadline IS NOT NULL
        AND undo_deadline > NOW()
      RETURNING id
    `);
    const rows = result.rows as Array<{ id: number }>;
    if (rows.length === 0) {
      return { ok: false, error: "Undo window sudah lewat atau action tidak ditemukan" };
    }

    // Tandai execution terkait sebagai overridden
    db.execute(sql`
      UPDATE ai_agent_executions SET
        was_overridden  = TRUE,
        override_by     = ${undoneBy},
        override_reason = 'Undone within undo window'
      WHERE approval_id = ${approvalId}
    `).catch((err: unknown) => {
      logger.warn({ err }, "[aiGovernance] mark override on execution failed (non-fatal)");
    });

    return { ok: true };
  } catch (err) {
    logger.error({ err, approvalId }, "[aiGovernance] undoApproval failed");
    return { ok: false, error: String(err) };
  }
}

// ── 7. Expire Stale Approvals ─────────────────────────────────────────────────

/**
 * Guard: returns true only when autoApproveMinutes is a positive finite number.
 *
 * Rules (fail-closed):
 *  - null / undefined / 0 / negative  → false (disabled)
 *  - any positive finite number        → true  (enabled)
 *
 * Exported for unit testing.
 */
export function isAutoApproveConfigured(autoApproveMinutes: number | null | undefined): boolean {
  if (autoApproveMinutes == null) return false;   // null or undefined
  if (!Number.isFinite(autoApproveMinutes)) return false;
  return autoApproveMinutes > 0;
}

/**
 * Dipanggil oleh background job untuk expire approval yang sudah lewat deadline
 * dan auto-approve yang sudah lewat auto_approve_at.
 * Aman untuk dipanggil berkali-kali (idempoten).
 *
 * HARDENING: auto-approve scan hanya berjalan jika ada baris pending yang
 * memiliki auto_approve_at IS NOT NULL (fast pre-check). Jika tidak ada,
 * scanner langsung return tanpa melakukan UPDATE — mencegah false-positive
 * maupun unnecessary DB load ketika fitur tidak dikonfigurasi.
 */
export async function expireStaleApprovals(): Promise<{ expired: number; autoApproved: number }> {
  try {
    const expiredResult = await db.execute(sql`
      UPDATE ai_approval_queue SET
        status     = 'expired',
        decided_at = NOW(),
        decided_by = 'system'
      WHERE status = 'pending'
        AND expires_at <= NOW()
      RETURNING id
    `);

    const expired = (expiredResult.rows as unknown[]).length;

    // ── Fast pre-check: skip auto-approve scan if no candidates exist ─────────
    // This is the fail-closed guard: if autoApproveMinutes was never passed
    // (i.e. all entries have auto_approve_at = NULL), the UPDATE below is
    // skipped entirely — no scanning, no risk of accidental auto-approval.
    const candidateCheck = await db.execute(sql`
      SELECT 1 FROM ai_approval_queue
      WHERE status = 'pending'
        AND auto_approve_at IS NOT NULL
      LIMIT 1
    `);

    if ((candidateCheck.rows as unknown[]).length === 0) {
      // No auto-approve candidates configured — skip scan entirely.
      if (expired > 0) {
        logger.info({ expired, autoApproved: 0 }, "[aiGovernance] stale approvals processed (no auto-approve candidates)");
      }
      return { expired, autoApproved: 0 };
    }

    const autoResult = await db.execute(sql`
      UPDATE ai_approval_queue SET
        status          = 'auto_approved',
        decided_at      = NOW(),
        decided_by      = 'system',
        decision_reason = 'Auto-approved: no response within auto-approve window',
        undo_deadline   = NOW() + INTERVAL '30 minutes'
      WHERE status = 'pending'
        AND auto_approve_at IS NOT NULL
        AND auto_approve_at <= NOW()
        AND expires_at > NOW()
      RETURNING id
    `);

    const autoApproved = (autoResult.rows as unknown[]).length;

    if (expired > 0 || autoApproved > 0) {
      logger.info({ expired, autoApproved }, "[aiGovernance] stale approvals processed");
    }

    return { expired, autoApproved };
  } catch (err) {
    logger.error({ err }, "[aiGovernance] expireStaleApprovals failed");
    return { expired: 0, autoApproved: 0 };
  }
}

// ── Convenience: wrapped AI call with full governance ─────────────────────────

/**
 * Wrapper untuk menjalankan AI call dengan governance penuh.
 * Otomatis:
 *  - Buat execution log
 *  - Jalankan fn() dengan timer
 *  - Update status completed/failed
 *  - Jika humanApprovalRequired, buat approval request dan pause
 *
 * @returns { executionId, approvalId, result } — result NULL jika awaiting approval
 */
export async function withGovernance<T>(
  meta: Omit<LogExecutionInput, "status">,
  approvalConfig: RequestApprovalInput | null,
  fn: () => Promise<T>
): Promise<{ executionId: number | null; approvalId: number | null; result: T | null }> {
  const startMs = Date.now();

  const executionId = await logExecution({
    ...meta,
    status: meta.humanApprovalRequired ? "awaiting_approval" : "running",
  });

  // Jika butuh approval, buat request dulu sebelum execute
  if (meta.humanApprovalRequired && approvalConfig) {
    const approvalId = await requestApproval({
      ...approvalConfig,
      executionId: executionId ?? undefined,
    });
    return { executionId, approvalId, result: null };
  }

  try {
    const result = await fn();
    const durationMs = Date.now() - startMs;

    if (executionId) {
      await completeExecution(executionId, {
        durationMs,
        outputSummary: meta.outputSummary ?? undefined,
      });
    }

    return { executionId, approvalId: null, result };
  } catch (err) {
    const durationMs = Date.now() - startMs;
    if (executionId) {
      failExecution(executionId, err instanceof Error ? err.message : String(err), durationMs);
    }
    throw err;
  }
}
