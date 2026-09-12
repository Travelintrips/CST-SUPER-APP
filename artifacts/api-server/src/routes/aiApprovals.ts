import { Router, type Request, type Response } from "express";
import { db } from "@workspace/db";
import { sql } from "drizzle-orm";
import { requireAdmin } from "../lib/requireAdmin.js";

export const aiApprovalsRouter = Router();

// ── GET /api/ai-approvals ─────────────────────────────────────────────────────
// Query: ?status=pending&priority=high&agentType=ops&limit=50&offset=0
aiApprovalsRouter.get("/", async (req: Request, res: Response) => {
  if (!(await requireAdmin(req, res))) return;
  try {
    const status = req.query.status ? String(req.query.status) : null;
    const priority = req.query.priority ? String(req.query.priority) : null;
    const agentType = req.query.agentType ? String(req.query.agentType) : null;
    const limit = Math.min(parseInt(String(req.query.limit ?? "50"), 10), 200);
    const offset = parseInt(String(req.query.offset ?? "0"), 10);

    const conditions: string[] = [];
    const params: unknown[] = [];

    if (status && status !== "all") {
      params.push(status);
      conditions.push(`q.status = $${params.length}`);
    }
    if (priority) {
      params.push(priority);
      conditions.push(`q.priority = $${params.length}`);
    }
    if (agentType) {
      params.push(agentType);
      conditions.push(`q.agent_type = $${params.length}`);
    }

    const where = conditions.length > 0 ? `WHERE ${conditions.join(" AND ")}` : "";

    params.push(limit, offset);
    const dataQuery = `
      SELECT
        q.id,
        q.execution_id,
        q.agent_type,
        q.action,
        q.action_description,
        q.context_data,
        q.priority,
        q.amount,
        q.order_id,
        q.rfq_id,
        q.company_id,
        q.requested_by_id,
        q.status,
        q.expires_at,
        q.auto_approve_at,
        q.decided_by,
        q.decided_at,
        q.decision_reason,
        q.undo_deadline,
        q.was_undone,
        q.undone_by,
        q.undone_at,
        q.requested_at,
        e.reasoning,
        e.confidence,
        e.model_used,
        e.input_summary
      FROM ai_approval_queue q
      LEFT JOIN ai_agent_executions e ON e.id = q.execution_id
      ${where}
      ORDER BY
        CASE q.priority
          WHEN 'critical' THEN 1
          WHEN 'high'     THEN 2
          WHEN 'medium'   THEN 3
          WHEN 'low'      THEN 4
          ELSE 5
        END,
        q.requested_at DESC
      LIMIT $${params.length - 1} OFFSET $${params.length}
    `;

    const countParams = params.slice(0, params.length - 2);
    const countQuery = `SELECT COUNT(*)::int AS total FROM ai_approval_queue q ${where}`;

    const [dataResult, countResult] = await Promise.all([
      db.execute((sql as any).raw(dataQuery, params)),
      db.execute((sql as any).raw(countQuery, countParams)),
    ]);

    res.json({
      items: dataResult.rows,
      total: (countResult.rows[0] as { total: number })?.total ?? 0,
      limit,
      offset,
    }); return;
  } catch (err) {
    console.error("[aiApprovals] list error", err);
    res.status(500).json({ error: "Gagal mengambil AI approval queue" }); return;
  }
});

// ── GET /api/ai-approvals/stats ───────────────────────────────────────────────
aiApprovalsRouter.get("/stats", async (req: Request, res: Response) => {
  if (!(await requireAdmin(req, res))) return;
  try {
    const result = await db.execute(sql`
      SELECT
        COUNT(*) FILTER (WHERE status = 'pending')                              AS pending,
        COUNT(*) FILTER (WHERE status = 'approved' AND decided_at::date = CURRENT_DATE) AS approved_today,
        COUNT(*) FILTER (WHERE status = 'rejected' AND decided_at::date = CURRENT_DATE) AS rejected_today,
        COUNT(*) FILTER (WHERE status = 'expired')                             AS expired,
        COUNT(*) FILTER (WHERE status = 'pending' AND priority = 'critical')   AS pending_critical,
        COUNT(*) FILTER (WHERE status = 'pending' AND priority = 'high')       AS pending_high
      FROM ai_approval_queue
    `);
    const row = result.rows[0] as Record<string, number>;
    res.json({
      pending:         Number(row.pending ?? 0),
      approvedToday:   Number(row.approved_today ?? 0),
      rejectedToday:   Number(row.rejected_today ?? 0),
      expired:         Number(row.expired ?? 0),
      pendingCritical: Number(row.pending_critical ?? 0),
      pendingHigh:     Number(row.pending_high ?? 0),
    }); return;
  } catch (err) {
    console.error("[aiApprovals] stats error", err);
    res.status(500).json({ error: "Gagal mengambil statistik" }); return;
  }
});

// ── POST /api/ai-approvals/:id/resolve ───────────────────────────────────────
// Body: { decision: "approved" | "rejected", reason?: string }
aiApprovalsRouter.post("/:id/resolve", async (req: Request, res: Response) => {
  if (!(await requireAdmin(req, res))) return;
  try {
    const id = parseInt(String(req.params.id), 10);
    if (!id || isNaN(id)) { res.status(400).json({ error: "ID tidak valid" }); return; }

    const { decision, reason } = req.body as { decision?: string; reason?: string };
    if (decision !== "approved" && decision !== "rejected") {
      return res.status(400).json({ error: "decision harus 'approved' atau 'rejected'" });
    }

    const actor = (req as any).user?.name ?? (req as any).user?.email ?? "admin";

    const checkResult = await db.execute(sql`
      SELECT id, status FROM ai_approval_queue WHERE id = ${id}
    `);
    const row = checkResult.rows[0] as { id: number; status: string } | undefined;
    if (!row) return res.status(404).json({ error: "Approval tidak ditemukan" });
    if (row.status !== "pending") {
      return res.status(409).json({ error: `Approval sudah berstatus '${row.status}'` });
    }

    const undoDeadline = decision === "approved"
      ? sql`NOW() + INTERVAL '30 minutes'`
      : sql`NULL`;

    await db.execute(sql`
      UPDATE ai_approval_queue SET
        status          = ${decision},
        decided_by      = ${actor},
        decided_at      = NOW(),
        decision_reason = ${reason ?? null},
        undo_deadline   = ${undoDeadline}
      WHERE id = ${id}
    `);

    await db.execute(sql`
      UPDATE ai_agent_executions SET
        status = ${decision === "approved" ? "completed" : "skipped"}
      WHERE id = (SELECT execution_id FROM ai_approval_queue WHERE id = ${id})
        AND execution_id IS NOT NULL
    `);

    res.json({ success: true, decision, decidedBy: actor }); return;
  } catch (err) {
    console.error("[aiApprovals] resolve error", err);
    res.status(500).json({ error: "Gagal memproses keputusan" }); return;
  }
});

// ── POST /api/ai-approvals/:id/undo ──────────────────────────────────────────
aiApprovalsRouter.post("/:id/undo", async (req: Request, res: Response) => {
  if (!(await requireAdmin(req, res))) return;
  try {
    const id = parseInt(String(req.params.id), 10);
    if (!id || isNaN(id)) { res.status(400).json({ error: "ID tidak valid" }); return; }

    const actor = (req as any).user?.name ?? (req as any).user?.email ?? "admin";

    const checkResult = await db.execute(sql`
      SELECT id, status, undo_deadline, was_undone
      FROM ai_approval_queue
      WHERE id = ${id}
    `);
    const row = checkResult.rows[0] as {
      id: number; status: string; undo_deadline: string | null; was_undone: boolean;
    } | undefined;

    if (!row) return res.status(404).json({ error: "Approval tidak ditemukan" });
    if (row.status !== "approved") return res.status(409).json({ error: "Hanya approval 'approved' yang bisa di-undo" });
    if (row.was_undone) return res.status(409).json({ error: "Approval sudah pernah di-undo" });
    if (!row.undo_deadline || new Date(row.undo_deadline) < new Date()) {
      return res.status(409).json({ error: "Undo window sudah habis" });
    }

    await db.execute(sql`
      UPDATE ai_approval_queue SET
        was_undone  = true,
        undone_by   = ${actor},
        undone_at   = NOW()
      WHERE id = ${id}
    `);

    await db.execute(sql`
      UPDATE ai_agent_executions SET
        status         = 'skipped',
        was_overridden = true,
        override_by    = ${actor},
        override_reason = 'Undo oleh ' || ${actor}
      WHERE id = (SELECT execution_id FROM ai_approval_queue WHERE id = ${id})
        AND execution_id IS NOT NULL
    `);

    res.json({ success: true, undoneBy: actor }); return;
  } catch (err) {
    console.error("[aiApprovals] undo error", err);
    res.status(500).json({ error: "Gagal undo approval" }); return;
  }
});
