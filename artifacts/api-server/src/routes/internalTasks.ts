import { Router } from "express";
import { db, internalTasksTable, usersTable, logisticOrdersTable } from "@workspace/db";
import { eq, and, desc, sql } from "drizzle-orm";
import { requireClerkUser } from "../lib/requireAdmin.js";
import { sendWhatsApp } from "../lib/fonnte.js";
import { getAdminWa } from "../lib/adminWa.js";

const router = Router();

router.use(async (req, res, next) => {
  const ok = await requireClerkUser(req, res);
  if (ok) next();
});

// GET /api/internal-tasks — list all tasks (filterable by status, dept, order)
router.get("/", async (req, res) => {
  const { status, department, orderId, companyId } = req.query;

  let query = db
    .select({
      task: internalTasksTable,
      assignee: {
        id: usersTable.id,
        name: usersTable.name,
        email: usersTable.email,
      },
    })
    .from(internalTasksTable)
    .leftJoin(usersTable, sql`${internalTasksTable.assignedUserId} = ${usersTable.id}::int`);

  const conditions = [];
  if (status && status !== "all") conditions.push(eq(internalTasksTable.status, String(status)));
  if (department && department !== "all") conditions.push(eq(internalTasksTable.department, String(department)));
  if (orderId) conditions.push(eq(internalTasksTable.orderId, Number(orderId)));
  if (companyId) conditions.push(eq(internalTasksTable.companyId, Number(companyId)));

  const rows = await (conditions.length > 0
    ? query.where(and(...conditions)).orderBy(desc(internalTasksTable.createdAt))
    : query.orderBy(desc(internalTasksTable.createdAt))
  );

  res.json(rows);
});

// GET /api/internal-tasks/:id
router.get("/:id", async (req, res) => {
  const [row] = await db
    .select({
      task: internalTasksTable,
      assignee: { id: usersTable.id, name: usersTable.name, email: usersTable.email },
    })
    .from(internalTasksTable)
    .leftJoin(usersTable, sql`${internalTasksTable.assignedUserId} = ${usersTable.id}::int`)
    .where(eq(internalTasksTable.id, Number(req.params.id)));

  if (!row) { res.status(404).json({ error: "Task not found" }); return; }
  res.json(row);
});

// POST /api/internal-tasks — create task
router.post("/", async (req, res) => {
  const session = (req as any).session;
  const user = session?.user;
  const {
    orderId, orderNumber, refType, refId,
    assignedTo, assignedUserId, department, taskType,
    title, description, deadline, priority, companyId,
  } = req.body ?? {};

  if (!taskType || !title) {
    res.status(400).json({ error: "taskType dan title wajib diisi" }); return;
  }

  const [task] = await db.insert(internalTasksTable).values({
    orderId: orderId ? Number(orderId) : null,
    orderNumber: orderNumber ?? null,
    refType: refType ?? "logistic_order",
    refId: refId ? String(refId) : null,
    assignedTo: assignedTo ?? null,
    assignedUserId: assignedUserId ? Number(assignedUserId) : null,
    department: department ?? null,
    taskType: String(taskType),
    title: String(title),
    description: description ?? null,
    deadline: deadline ? new Date(deadline) : null,
    status: "open",
    priority: priority ?? "normal",
    companyId: companyId ? Number(companyId) : null,
    createdBy: user?.email ?? "system",
  }).returning();

  res.json({ ok: true, task });
});

// PUT /api/internal-tasks/:id — update task
router.put("/:id", async (req, res) => {
  const session = (req as any).session;
  const user = session?.user;
  const { status, assignedTo, assignedUserId, deadline, priority, description, department } = req.body ?? {};

  const updateData: Partial<typeof internalTasksTable.$inferInsert> = {
    updatedAt: new Date(),
  };
  if (status !== undefined) {
    updateData.status = String(status);
    if (status === "completed") {
      updateData.completedAt = new Date();
      updateData.completedBy = user?.email ?? "system";
    }
  }
  if (assignedTo !== undefined) updateData.assignedTo = String(assignedTo);
  if (assignedUserId !== undefined) updateData.assignedUserId = Number(assignedUserId);
  if (deadline !== undefined) updateData.deadline = deadline ? new Date(deadline) : null;
  if (priority !== undefined) updateData.priority = String(priority);
  if (description !== undefined) updateData.description = String(description);
  if (department !== undefined) updateData.department = String(department);

  const [updated] = await db
    .update(internalTasksTable)
    .set(updateData)
    .where(eq(internalTasksTable.id, Number(req.params.id)))
    .returning();

  if (!updated) { res.status(404).json({ error: "Task not found" }); return; }
  res.json({ ok: true, task: updated });
});

// DELETE /api/internal-tasks/:id
router.delete("/:id", async (req, res) => {
  await db.delete(internalTasksTable).where(eq(internalTasksTable.id, Number(req.params.id)));
  res.json({ ok: true });
});

// GET /api/internal-tasks/summary — stats per department
router.get("/stats/summary", async (req, res) => {
  const { companyId } = req.query;
  const condition = companyId ? sql`company_id = ${Number(companyId)}` : sql`TRUE`;

  const rows = await db.execute(sql`
    SELECT
      department,
      count(*)::int as total,
      count(*) filter (where status = 'open')::int as open,
      count(*) filter (where status = 'in_progress')::int as in_progress,
      count(*) filter (where status = 'completed')::int as completed,
      count(*) filter (where deadline < NOW() AND status != 'completed')::int as overdue
    FROM internal_tasks
    WHERE ${condition}
    GROUP BY department
    ORDER BY total DESC
  `);

  res.json(rows.rows);
});

export { router as internalTasksRouter };
