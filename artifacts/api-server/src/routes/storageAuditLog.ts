import { Router } from "express";
import { db, storageAuditLogTable } from "@workspace/db";
import { desc, eq, and, gte, lte, like, or, sql } from "drizzle-orm";
import { requireAdmin } from "../lib/requireAdmin.js";

const router = Router();

router.use(async (req, res, next) => {
  if (!(await requireAdmin(req, res))) return;
  next();
});

// GET /api/storage-audit — daftar storage audit log dengan pagination + filter
// Query params:
//   page       : halaman (default 1)
//   limit      : per halaman (default 50, max 200)
//   action     : filter action (upload|upload_presigned_issued|download|delete|delete_orphan)
//   entityType : filter entity type
//   actorId    : filter actor ID
//   q          : free-text search di objectPath / fileName / details
//   from       : ISO date string (createdAt >=)
//   to         : ISO date string (createdAt <=)
router.get("/", async (req, res) => {
  try {
    const page = Math.max(1, parseInt(String(req.query.page ?? "1"), 10));
    const rawLimit = parseInt(String(req.query.limit ?? "50"), 10);
    const limit = Math.min(Math.max(1, rawLimit), 200);
    const offset = (page - 1) * limit;

    const action = req.query.action ? String(req.query.action) : undefined;
    const entityType = req.query.entityType ? String(req.query.entityType) : undefined;
    const actorId = req.query.actorId ? String(req.query.actorId) : undefined;
    const q = req.query.q ? String(req.query.q).trim() : undefined;
    const from = req.query.from ? new Date(String(req.query.from)) : undefined;
    const to = req.query.to ? new Date(String(req.query.to)) : undefined;

    const conditions = [];
    if (action) conditions.push(eq(storageAuditLogTable.action, action as any));
    if (entityType) conditions.push(eq(storageAuditLogTable.entityType, entityType as any));
    if (actorId) conditions.push(eq(storageAuditLogTable.actorId, actorId));
    if (from && !isNaN(from.getTime())) conditions.push(gte(storageAuditLogTable.createdAt, from));
    if (to && !isNaN(to.getTime())) conditions.push(lte(storageAuditLogTable.createdAt, to));
    if (q) {
      conditions.push(
        or(
          like(storageAuditLogTable.objectPath, `%${q}%`),
          like(storageAuditLogTable.fileName, `%${q}%`),
          like(storageAuditLogTable.details, `%${q}%`),
          like(storageAuditLogTable.actorId, `%${q}%`),
        )!
      );
    }

    const where = conditions.length > 0 ? and(...conditions) : undefined;

    const [rows, [{ total }]] = await Promise.all([
      db.select()
        .from(storageAuditLogTable)
        .where(where)
        .orderBy(desc(storageAuditLogTable.createdAt))
        .limit(limit)
        .offset(offset),
      db.select({ total: sql<number>`cast(count(*) as int)` })
        .from(storageAuditLogTable)
        .where(where),
    ]);

    res.json({
      items: rows.map((r) => ({
        ...r,
        createdAt: r.createdAt.toISOString(),
      })),
      total,
      page,
      limit,
      pages: Math.ceil(total / limit),
    });
  } catch (err: any) {
    res.status(500).json({ error: err?.message ?? "Gagal mengambil storage audit log" });
  }
});

// GET /api/storage-audit/stats — ringkasan per action & entity type (7 hari terakhir)
router.get("/stats", async (_req, res) => {
  try {
    const since = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
    const byAction = await db
      .select({
        action: storageAuditLogTable.action,
        count: sql<number>`cast(count(*) as int)`,
      })
      .from(storageAuditLogTable)
      .where(gte(storageAuditLogTable.createdAt, since))
      .groupBy(storageAuditLogTable.action);

    const byEntityType = await db
      .select({
        entityType: storageAuditLogTable.entityType,
        count: sql<number>`cast(count(*) as int)`,
      })
      .from(storageAuditLogTable)
      .where(gte(storageAuditLogTable.createdAt, since))
      .groupBy(storageAuditLogTable.entityType);

    const [{ total }] = await db
      .select({ total: sql<number>`cast(count(*) as int)` })
      .from(storageAuditLogTable)
      .where(gte(storageAuditLogTable.createdAt, since));

    res.json({ period: "7d", total, byAction, byEntityType });
  } catch (err: any) {
    res.status(500).json({ error: err?.message ?? "Gagal mengambil storage audit stats" });
  }
});

export default router;
