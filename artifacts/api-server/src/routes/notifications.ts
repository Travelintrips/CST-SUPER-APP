import { Router } from "express";
import { db } from "@workspace/db";
import { sql } from "drizzle-orm";
import { requireAdmin } from "../lib/requireAdmin.js";
import { registerAdminConnection, unregisterAdminConnection } from "../lib/sseManager.js";

const router = Router();
// Wrapper requireAdmin menjadi Express middleware yang benar
router.use(async (req, res, next) => {
  const ok = await requireAdmin(req, res);
  if (ok) next();
});

// GET /api/notifications?type=all&read=all&search=&limit=50&offset=0
router.get("/", async (req, res) => {
  const type = req.query.type as string | undefined;
  const read = req.query.read as string | undefined;
  const search = (req.query.search as string | undefined)?.trim() ?? "";
  const limit = Math.min(Number(req.query.limit ?? 50), 200);
  const offset = Number(req.query.offset ?? 0);

  const typeFilter = type && type !== "all" ? sql`type = ${type}` : sql`TRUE`;
  const readFilter =
    read === "unread" ? sql`read_at IS NULL` :
    read === "read"   ? sql`read_at IS NOT NULL` :
                        sql`TRUE`;
  const searchFilter = search
    ? sql`(order_number ILIKE ${"%" + search + "%"} OR customer_name ILIKE ${"%" + search + "%"})`
    : sql`TRUE`;

  const [rows, countRows, unreadRows] = await Promise.all([
    db.execute(sql`
      SELECT * FROM admin_notifications
      WHERE ${typeFilter} AND ${readFilter} AND ${searchFilter}
      ORDER BY created_at DESC
      LIMIT ${limit} OFFSET ${offset}
    `),
    db.execute(sql`
      SELECT COUNT(*)::int AS count FROM admin_notifications
      WHERE ${typeFilter} AND ${readFilter} AND ${searchFilter}
    `),
    db.execute(sql`
      SELECT COUNT(*)::int AS count FROM admin_notifications WHERE read_at IS NULL
    `),
  ]);

  return res.json({
    data: rows.rows,
    total: (countRows.rows[0] as { count: number }).count,
    unreadTotal: (unreadRows.rows[0] as { count: number }).count,
  });
});

// GET /api/notifications/unread-count
router.get("/unread-count", async (_req, res) => {
  const [row] = (await db.execute(sql`
    SELECT COUNT(*)::int AS count FROM admin_notifications WHERE read_at IS NULL
  `)).rows;
  return res.json({ count: (row as { count: number }).count });
});

// POST /api/notifications/mark-all-read
router.post("/mark-all-read", async (_req, res) => {
  await db.execute(sql`UPDATE admin_notifications SET read_at = NOW() WHERE read_at IS NULL`);
  return res.json({ ok: true });
});

// POST /api/notifications/:id/read
router.post("/:id/read", async (req, res) => {
  const id = Number(req.params.id);
  if (isNaN(id)) return res.status(400).json({ message: "Invalid id" });
  await db.execute(sql`UPDATE admin_notifications SET read_at = NOW() WHERE id = ${id} AND read_at IS NULL`);
  return res.json({ ok: true });
});

// DELETE /api/notifications/:id
router.delete("/:id", async (req, res) => {
  const id = Number(req.params.id);
  if (isNaN(id)) return res.status(400).json({ message: "Invalid id" });
  await db.execute(sql`DELETE FROM admin_notifications WHERE id = ${id}`);
  return res.json({ ok: true });
});

// DELETE /api/notifications — hapus semua
router.delete("/", async (_req, res) => {
  await db.execute(sql`DELETE FROM admin_notifications`);
  return res.json({ ok: true });
});

// GET /api/notifications/events — SSE realtime stream
router.get("/events", (req, res) => {
  res.writeHead(200, {
    "Content-Type": "text/event-stream",
    "Cache-Control": "no-cache, no-transform",
    "Connection": "keep-alive",
    "X-Accel-Buffering": "no",
  });
  res.write(": connected\n\n");
  registerAdminConnection(res);
  const keepAlive = setInterval(() => {
    try { res.write(": ping\n\n"); } catch { clearInterval(keepAlive); }
  }, 25_000);
  req.on("close", () => {
    clearInterval(keepAlive);
    unregisterAdminConnection(res);
  });
});

export default router;
