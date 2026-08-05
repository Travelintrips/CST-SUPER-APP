import { Router, type Request, type Response } from "express";
import { db } from "@workspace/db";
import { sql } from "drizzle-orm";
import { requireClerkUser } from "../lib/requireAdmin.js";
import { resolveCompanyId } from "../lib/resolveCompany.js";

const router = Router();
router.use(async (req: Request, res: Response, next) => {
  if (!(await requireClerkUser(req, res))) return;
  next();
});

// ── Runtime migration for approval_requests table ──────────────────────────────
async function runApprovalMigration() {
  await db.execute(sql`
    CREATE TABLE IF NOT EXISTS approval_requests (
      id SERIAL PRIMARY KEY,
      company_id INTEGER,
      module TEXT NOT NULL,
      doc_type TEXT NOT NULL,
      doc_id INTEGER NOT NULL,
      doc_number TEXT NOT NULL,
      requested_by TEXT,
      requested_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      status TEXT NOT NULL DEFAULT 'pending',
      approved_by TEXT,
      approved_at TIMESTAMPTZ,
      rejected_by TEXT,
      rejected_at TIMESTAMPTZ,
      note TEXT,
      metadata JSONB DEFAULT '{}'::jsonb
    )
  `);
  await db.execute(sql`CREATE INDEX IF NOT EXISTS idx_approval_requests_status ON approval_requests(status)`);
  await db.execute(sql`CREATE INDEX IF NOT EXISTS idx_approval_requests_company ON approval_requests(company_id)`);
  await db.execute(sql`CREATE INDEX IF NOT EXISTS idx_approval_requests_module ON approval_requests(module, doc_type)`);
}
runApprovalMigration().catch((e) => console.error("[approval migration]", e));

// GET /api/approvals — list approval requests
router.get("/", async (req: Request, res: Response) => {
  const companyId = resolveCompanyId(req);
  const status = (req.query["status"] as string) || "pending";
  const module_ = req.query["module"] as string | undefined;
  const page = Math.max(1, Number(req.query["page"] ?? 1));
  const limit = Math.min(100, Math.max(1, Number(req.query["limit"] ?? 20)));
  const offset = (page - 1) * limit;

  const rows = await db.execute(sql`
    SELECT * FROM approval_requests
    WHERE company_id = ${companyId}
      AND (${status === "all" ? sql`TRUE` : sql`status = ${status}`})
      AND (${module_ ? sql`module = ${module_}` : sql`TRUE`})
    ORDER BY requested_at DESC
    LIMIT ${limit} OFFSET ${offset}
  `);

  const countRow = await db.execute(sql`
    SELECT COUNT(*)::int AS total FROM approval_requests
    WHERE company_id = ${companyId}
      AND (${status === "all" ? sql`TRUE` : sql`status = ${status}`})
      AND (${module_ ? sql`module = ${module_}` : sql`TRUE`})
  `);

  return res.json({
    items: rows.rows,
    total: (countRow.rows[0] as any)?.total ?? 0,
    page,
    limit,
  });
});

// GET /api/approvals/stats — counts by status
router.get("/stats", async (req: Request, res: Response) => {
  const companyId = resolveCompanyId(req);
  const rows = await db.execute(sql`
    SELECT status, COUNT(*)::int AS count
    FROM approval_requests
    WHERE company_id = ${companyId}
    GROUP BY status
  `);
  const stats: Record<string, number> = { pending: 0, approved: 0, rejected: 0 };
  for (const r of rows.rows as any[]) { stats[r.status] = r.count; }
  return res.json(stats);
});

// POST /api/approvals — create approval request
router.post("/", async (req: Request, res: Response) => {
  const companyId = resolveCompanyId(req);
  const { module, docType, docId, docNumber, requestedBy, note, metadata } = req.body as {
    module: string; docType: string; docId: number; docNumber: string;
    requestedBy?: string; note?: string; metadata?: Record<string, unknown>;
  };
  if (!module || !docType || !docId || !docNumber) {
    return res.status(400).json({ message: "module, docType, docId, docNumber diperlukan" });
  }
  const result = await db.execute(sql`
    INSERT INTO approval_requests (company_id, module, doc_type, doc_id, doc_number, requested_by, note, metadata)
    VALUES (${companyId}, ${module}, ${docType}, ${docId}, ${docNumber},
            ${requestedBy ?? null}, ${note ?? null}, ${JSON.stringify(metadata ?? {})}::jsonb)
    RETURNING *
  `);
  return res.status(201).json(result.rows[0]);
});

// PATCH /api/approvals/:id/approve
router.patch("/:id/approve", async (req: Request, res: Response) => {
  const id = Number(req.params.id);
  const actorEmail = req.user?.email ?? null;
  const { note } = req.body as { note?: string };

  const existing = await db.execute(sql`SELECT * FROM approval_requests WHERE id = ${id}`);
  if (!existing.rows[0]) return res.status(404).json({ message: "Permintaan tidak ditemukan" });
  const row = existing.rows[0] as any;
  if (row.status !== "pending") {
    return res.status(400).json({ message: "Hanya permintaan berstatus pending yang bisa disetujui" });
  }
  // Self-approval guard: requester cannot approve their own request
  if (actorEmail && row.requested_by && actorEmail === row.requested_by) {
    return res.status(403).json({ message: "Anda tidak bisa menyetujui permintaan yang Anda buat sendiri" });
  }

  const result = await db.execute(sql`
    UPDATE approval_requests
    SET status = 'approved', approved_by = ${actorEmail},
        approved_at = NOW(), note = COALESCE(${note ?? null}, note)
    WHERE id = ${id}
    RETURNING *
  `);
  return res.json(result.rows[0]);
});

// PATCH /api/approvals/:id/reject
router.patch("/:id/reject", async (req: Request, res: Response) => {
  const id = Number(req.params.id);
  const actorEmail = req.user?.email ?? null;
  const { note } = req.body as { note?: string };

  const existing = await db.execute(sql`SELECT * FROM approval_requests WHERE id = ${id}`);
  if (!existing.rows[0]) return res.status(404).json({ message: "Permintaan tidak ditemukan" });
  const row = existing.rows[0] as any;
  if (row.status !== "pending") {
    return res.status(400).json({ message: "Hanya permintaan berstatus pending yang bisa ditolak" });
  }

  const result = await db.execute(sql`
    UPDATE approval_requests
    SET status = 'rejected', rejected_by = ${actorEmail},
        rejected_at = NOW(), note = COALESCE(${note ?? null}, note)
    WHERE id = ${id}
    RETURNING *
  `);
  return res.json(result.rows[0]);
});

// DELETE /api/approvals/:id — cancel/delete draft request
router.delete("/:id", async (req: Request, res: Response) => {
  const id = Number(req.params.id);
  await db.execute(sql`DELETE FROM approval_requests WHERE id = ${id} AND status = 'pending'`);
  return res.json({ ok: true });
});

export default router;
