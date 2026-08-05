import { Router, type Request, type Response, type NextFunction } from "express";
import { db, exceptionsTable } from "@workspace/db";
import { eq, and, desc, ilike, or, sql, type SQL } from "drizzle-orm";
import { requireAdmin } from "../lib/requireAdmin.js";
import { resolveCompanyId } from "../lib/resolveCompany.js";
import { auditFromReq } from "../lib/auditLog.js";

const router = Router();

async function requireAdminMiddleware(req: Request, res: Response, next: NextFunction) {
  const ok = await requireAdmin(req, res);
  if (ok) next();
}

router.use(requireAdminMiddleware);

// GET /api/exceptions/stats
router.get("/stats", async (req, res) => {
  const companyId = resolveCompanyId(req);
  const [stats] = await db
    .select({
      total: sql<number>`cast(count(*) as int)`,
      open: sql<number>`cast(sum(case when ${exceptionsTable.status} = 'open' then 1 else 0 end) as int)`,
      in_progress: sql<number>`cast(sum(case when ${exceptionsTable.status} = 'in_progress' then 1 else 0 end) as int)`,
      resolved: sql<number>`cast(sum(case when ${exceptionsTable.status} = 'resolved' then 1 else 0 end) as int)`,
      closed: sql<number>`cast(sum(case when ${exceptionsTable.status} = 'closed' then 1 else 0 end) as int)`,
      critical: sql<number>`cast(sum(case when ${exceptionsTable.severity} = 'critical' then 1 else 0 end) as int)`,
      high: sql<number>`cast(sum(case when ${exceptionsTable.severity} = 'high' then 1 else 0 end) as int)`,
    })
    .from(exceptionsTable)
    .where(eq(exceptionsTable.companyId, companyId));

  res.json(stats ?? { total: 0, open: 0, in_progress: 0, resolved: 0, closed: 0, critical: 0, high: 0 });
});

// GET /api/exceptions
router.get("/", async (req, res) => {
  const companyId = resolveCompanyId(req);
  const { status, exceptionType, severity, search, limit = "100", offset = "0" } = req.query as Record<string, string>;

  const conds: SQL[] = [eq(exceptionsTable.companyId, companyId)];
  if (status && status !== "all") conds.push(eq(exceptionsTable.status, status as never));
  if (exceptionType && exceptionType !== "all") conds.push(eq(exceptionsTable.exceptionType, exceptionType as never));
  if (severity && severity !== "all") conds.push(eq(exceptionsTable.severity, severity as never));
  if (search?.trim()) {
    const q = `%${search.trim()}%`;
    conds.push(or(
      ilike(exceptionsTable.title, q),
      ilike(exceptionsTable.customerName, q),
      ilike(exceptionsTable.supplierName, q),
      ilike(exceptionsTable.refNumber, q),
      ilike(exceptionsTable.description, q),
    ) as SQL);
  }

  const rows = await db
    .select()
    .from(exceptionsTable)
    .where(and(...conds))
    .orderBy(
      sql`case ${exceptionsTable.severity} when 'critical' then 1 when 'high' then 2 when 'medium' then 3 else 4 end`,
      desc(exceptionsTable.createdAt),
    )
    .limit(Math.min(Number(limit), 500))
    .offset(Number(offset));

  res.json({ data: rows, total: rows.length });
});

// GET /api/exceptions/:id
router.get("/:id", async (req, res) => {
  const id = Number(req.params.id);
  if (Number.isNaN(id)) { res.status(400).json({ error: "Invalid id" }); return; }
  const [row] = await db.select().from(exceptionsTable).where(eq(exceptionsTable.id, id)).limit(1);
  if (!row) { res.status(404).json({ error: "Tidak ditemukan" }); return; }
  res.json(row);
});

// POST /api/exceptions
router.post("/", async (req, res) => {
  const companyId = resolveCompanyId(req);
  const user = req.user as { email?: string | null; firstName?: string | null; lastName?: string | null } | undefined;
  const {
    exceptionType, severity, title, description,
    refType, refId, refNumber,
    customerName, supplierName, assignedTo,
  } = req.body ?? {};

  if (!exceptionType || !title?.trim()) {
    res.status(400).json({ error: "exceptionType dan title wajib diisi" }); return;
  }

  const [created] = await db.insert(exceptionsTable).values({
    companyId,
    exceptionType,
    severity: severity ?? "medium",
    status: "open",
    title: title.trim(),
    description: description ?? null,
    refType: refType ?? null,
    refId: refId ? String(refId) : null,
    refNumber: refNumber ?? null,
    customerName: customerName ?? null,
    supplierName: supplierName ?? null,
    assignedTo: assignedTo ?? null,
    createdBy: (user as any)?.name ?? user?.email ?? null,
  }).returning();

  auditFromReq(req, {
    action: "create_exception",
    module: "exceptions",
    referenceId: String(created.id),
    newData: { exceptionType, title, severity },
  });

  res.status(201).json(created);
});

// PUT /api/exceptions/:id
router.put("/:id", async (req, res) => {
  const id = Number(req.params.id);
  if (Number.isNaN(id)) { res.status(400).json({ error: "Invalid id" }); return; }

  const user = req.user as { email?: string | null; firstName?: string | null; lastName?: string | null } | undefined;
  const {
    title, description, severity, status, assignedTo,
    refType, refId, refNumber, customerName, supplierName,
    resolutionNotes, exceptionType,
  } = req.body ?? {};

  type Patch = Parameters<typeof db.update>[0] extends infer U ? U : never;
  const patch: Record<string, unknown> = { updatedAt: new Date() };

  if (title !== undefined) patch["title"] = title;
  if (description !== undefined) patch["description"] = description;
  if (exceptionType !== undefined) patch["exceptionType"] = exceptionType;
  if (severity !== undefined) patch["severity"] = severity;
  if (status !== undefined) patch["status"] = status;
  if (assignedTo !== undefined) patch["assignedTo"] = assignedTo;
  if (refType !== undefined) patch["refType"] = refType;
  if (refId !== undefined) patch["refId"] = refId;
  if (refNumber !== undefined) patch["refNumber"] = refNumber;
  if (customerName !== undefined) patch["customerName"] = customerName;
  if (supplierName !== undefined) patch["supplierName"] = supplierName;
  if (resolutionNotes !== undefined) patch["resolutionNotes"] = resolutionNotes;

  if (status === "resolved" || status === "closed") {
    patch["resolvedAt"] = new Date();
    patch["resolvedBy"] = (user as any)?.name ?? user?.email ?? null;
  }

  const [updated] = await db
    .update(exceptionsTable)
    .set(patch as never)
    .where(eq(exceptionsTable.id, id))
    .returning();

  if (!updated) { res.status(404).json({ error: "Tidak ditemukan" }); return; }

  auditFromReq(req, {
    action: "update_exception",
    module: "exceptions",
    referenceId: String(id),
    newData: patch,
  });

  res.json(updated);
});

// DELETE /api/exceptions/:id
router.delete("/:id", async (req, res) => {
  const id = Number(req.params.id);
  if (Number.isNaN(id)) { res.status(400).json({ error: "Invalid id" }); return; }
  await db.delete(exceptionsTable).where(eq(exceptionsTable.id, id));
  auditFromReq(req, { action: "delete_exception", module: "exceptions", referenceId: String(id) });
  res.json({ ok: true });
});

export { router as exceptionsRouter };
