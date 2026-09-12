import { Router } from "express";
import { eq, desc, and, sql, like } from "drizzle-orm";
import { db, erpAuditReportsTable, erpAuditResponsesTable } from "@workspace/db";
import { requireAdmin } from "../lib/requireAdmin.js";
import { resolveCompanyId } from "../lib/resolveCompany.js";

const router = Router();

router.use(async (req, res, next) => {
  if (!(await requireAdmin(req, res))) return;
  next();
});

function serializeReport(r: typeof erpAuditReportsTable.$inferSelect) {
  return {
    ...r,
    periodStart: r.periodStart ?? null,
    periodEnd: r.periodEnd ?? null,
    createdAt: r.createdAt.toISOString(),
    updatedAt: r.updatedAt.toISOString(),
  };
}

async function nextReportNumber(): Promise<string> {
  const year = new Date().getFullYear();
  const [{ cnt }] = await db
    .select({ cnt: sql<number>`cast(count(*) as int)` })
    .from(erpAuditReportsTable)
    .where(like(erpAuditReportsTable.reportNumber, `AUD/${year}/%`));
  const seq = (Number(cnt) + 1).toString().padStart(5, "0");
  return `AUD/${year}/${seq}`;
}

function computeCounts(responses: { status: string }[]) {
  let ok = 0, not_ok = 0, warning = 0, na = 0;
  for (const r of responses) {
    if (r.status === "ok") ok++;
    else if (r.status === "not_ok") not_ok++;
    else if (r.status === "warning") warning++;
    else na++;
  }
  return { ok_count: ok, not_ok_count: not_ok, warning_count: warning, na_count: na, total_answered: ok + not_ok + warning };
}

router.get("/", async (req, res) => {
  const companyId = await resolveCompanyId(req);
  const rows = await db
    .select()
    .from(erpAuditReportsTable)
    .where(companyId ? eq(erpAuditReportsTable.companyId, companyId) : sql`1=1`)
    .orderBy(desc(erpAuditReportsTable.createdAt));
  return res.json(rows.map(serializeReport));
});

router.post("/", async (req, res) => {
  const companyId = await resolveCompanyId(req);
  const user = (req as any).user;
  const { title, auditorName, periodStart, periodEnd } = req.body ?? {};
  if (!title) return res.status(400).json({ message: "title wajib diisi" });

  const reportNumber = await nextReportNumber();
  const [created] = await db
    .insert(erpAuditReportsTable)
    .values({
      companyId,
      reportNumber,
      title,
      auditorName: auditorName || null,
      periodStart: periodStart || null,
      periodEnd: periodEnd || null,
      status: "draft",
      createdById: user?.id ?? null,
    })
    .returning();
  return res.status(201).json(serializeReport(created));
});

router.get("/:id", async (req, res) => {
  const id = Number(req.params.id);
  if (Number.isNaN(id)) return res.status(400).json({ message: "id tidak valid" });

  const companyId = await resolveCompanyId(req);
  const [report] = await db
    .select()
    .from(erpAuditReportsTable)
    .where(
      companyId
        ? and(eq(erpAuditReportsTable.id, id), eq(erpAuditReportsTable.companyId, companyId))
        : eq(erpAuditReportsTable.id, id)
    );
  if (!report) return res.status(404).json({ message: "Laporan tidak ditemukan" });

  const responses = await db
    .select()
    .from(erpAuditResponsesTable)
    .where(eq(erpAuditResponsesTable.reportId, id));

  return res.json({
    ...serializeReport(report),
    responses: responses.map(r => ({
      itemId: r.itemId,
      status: r.status,
      notes: r.notes ?? "",
    })),
  });
});

router.put("/:id", async (req, res) => {
  const id = Number(req.params.id);
  if (Number.isNaN(id)) return res.status(400).json({ message: "id tidak valid" });

  const { title, auditorName, periodStart, periodEnd, status, conclusion, overallNotes } = req.body ?? {};
  const updates: Partial<typeof erpAuditReportsTable.$inferInsert> = {
    updatedAt: new Date(),
  };
  if (title !== undefined) updates.title = title;
  if (auditorName !== undefined) updates.auditorName = auditorName || null;
  if (periodStart !== undefined) updates.periodStart = periodStart || null;
  if (periodEnd !== undefined) updates.periodEnd = periodEnd || null;
  if (status !== undefined) updates.status = status;
  if (conclusion !== undefined) updates.conclusion = conclusion || null;
  if (overallNotes !== undefined) updates.overallNotes = overallNotes || null;

  const [updated] = await db
    .update(erpAuditReportsTable)
    .set(updates)
    .where(eq(erpAuditReportsTable.id, id))
    .returning();
  if (!updated) return res.status(404).json({ message: "Laporan tidak ditemukan" });
  return res.json(serializeReport(updated));
});

router.put("/:id/responses", async (req, res) => {
  const id = Number(req.params.id);
  if (Number.isNaN(id)) return res.status(400).json({ message: "id tidak valid" });

  const { responses } = req.body ?? {};
  if (!Array.isArray(responses)) return res.status(400).json({ message: "responses harus array" });

  if (responses.length > 0) {
    for (const r of responses) {
      await db
        .insert(erpAuditResponsesTable)
        .values({
          reportId: id,
          itemId: String(r.itemId),
          status: String(r.status ?? "na"),
          notes: r.notes ? String(r.notes) : null,
          updatedAt: new Date(),
        })
        .onConflictDoUpdate({
          target: [erpAuditResponsesTable.reportId, erpAuditResponsesTable.itemId],
          set: {
            status: sql`EXCLUDED.status`,
            notes: sql`EXCLUDED.notes`,
            updatedAt: new Date(),
          },
        });
    }
  }

  const allResponses = await db
    .select({ status: erpAuditResponsesTable.status })
    .from(erpAuditResponsesTable)
    .where(eq(erpAuditResponsesTable.reportId, id));

  const counts = computeCounts(allResponses);
  await db
    .update(erpAuditReportsTable)
    .set({ ...counts, updatedAt: new Date() })
    .where(eq(erpAuditReportsTable.id, id));

  return res.json({ success: true, ...counts });
});

router.delete("/:id", async (req, res) => {
  const id = Number(req.params.id);
  if (Number.isNaN(id)) return res.status(400).json({ message: "id tidak valid" });

  await db.delete(erpAuditReportsTable).where(eq(erpAuditReportsTable.id, id));
  return res.json({ success: true });
});

export default router;
