import { Router, type Request, type Response } from "express";
import { eq, and, desc, ilike, inArray, or, sql, lt, lte, isNull } from "drizzle-orm";
import { db } from "@workspace/db";
import { notificationLogsTable } from "@workspace/db/schema";
import { requireAdmin } from "../lib/requireAdmin.js";
import { logger } from "../lib/logger.js";

export const waNotificationLogsRouter = Router();

const DRIVER_CONTEXTS = [
  "fulfillment-driver-assigned",
  "op-confirm-driver",
  "driver-job-assigned-internal",
  "driver-job-assigned-external",
];

const FONNTE_TOKEN = process.env.FONNTE_TOKEN ?? "";
const FONNTE_URL   = "https://api.fonnte.com/send";
const MAX_RETRIES  = 3;

// ── GET /api/wa-notification-logs/stats ───────────────────────────────────────
waNotificationLogsRouter.get("/stats", async (req: Request, res: Response) => {
  if (!(await requireAdmin(req, res))) return;
  try {
    const driverOnly = req.query.driverOnly === "true";
    const baseWhere = driverOnly
      ? and(eq(notificationLogsTable.channel, "wa"), inArray(notificationLogsTable.context, DRIVER_CONTEXTS))
      : eq(notificationLogsTable.channel, "wa");

    const [row] = await db
      .select({
        total:    sql<number>`count(*)::int`,
        sent:     sql<number>`count(*) filter (where ${notificationLogsTable.status} = 'sent')::int`,
        failed:   sql<number>`count(*) filter (where ${notificationLogsTable.status} = 'failed')::int`,
        deduped:  sql<number>`count(*) filter (where ${notificationLogsTable.status} = 'deduped')::int`,
        retrying: sql<number>`count(*) filter (where ${notificationLogsTable.status} = 'failed' and ${notificationLogsTable.retryCount} < ${MAX_RETRIES})::int`,
        exhausted: sql<number>`count(*) filter (where ${notificationLogsTable.status} = 'failed' and ${notificationLogsTable.retryCount} >= ${MAX_RETRIES})::int`,
        delivered: sql<number>`count(*) filter (where ${notificationLogsTable.waDeliveryStatus} = 'delivered')::int`,
      })
      .from(notificationLogsTable)
      .where(baseWhere);

    return res.json(row ?? { total: 0, sent: 0, failed: 0, deduped: 0, retrying: 0, exhausted: 0, delivered: 0 });
  } catch (err) {
    logger.error({ err }, "wa-notification-logs stats error");
    return res.status(500).json({ error: "Gagal mengambil stats" });
  }
});

// ── GET /api/wa-notification-logs ─────────────────────────────────────────────
waNotificationLogsRouter.get("/", async (req: Request, res: Response) => {
  if (!(await requireAdmin(req, res))) return;
  try {
    const page       = Math.max(1, parseInt(String(req.query.page ?? "1"), 10));
    const pageSize   = Math.min(100, Math.max(1, parseInt(String(req.query.pageSize ?? "50"), 10)));
    const offset     = (page - 1) * pageSize;
    const status     = String(req.query.status ?? "").trim() || null;
    const driverOnly = req.query.driverOnly === "true";
    const search     = String(req.query.search ?? "").trim() || null;

    const conditions = [eq(notificationLogsTable.channel, "wa")];
    if (driverOnly) conditions.push(inArray(notificationLogsTable.context, DRIVER_CONTEXTS));
    if (status) conditions.push(eq(notificationLogsTable.status, status));
    if (search) {
      conditions.push(
        or(
          ilike(notificationLogsTable.recipient, `%${search}%`),
          ilike(notificationLogsTable.context, `%${search}%`),
          ilike(notificationLogsTable.refId, `%${search}%`),
          ilike(notificationLogsTable.errorMsg, `%${search}%`),
        )!,
      );
    }

    const where = and(...conditions);

    const [{ count }] = await db
      .select({ count: sql<number>`count(*)::int` })
      .from(notificationLogsTable)
      .where(where);

    const rows = await db
      .select()
      .from(notificationLogsTable)
      .where(where)
      .orderBy(desc(notificationLogsTable.createdAt))
      .limit(pageSize)
      .offset(offset);

    return res.json({
      data: rows,
      total: count,
      page,
      pageSize,
      totalPages: Math.ceil(count / pageSize),
    });
  } catch (err) {
    logger.error({ err }, "wa-notification-logs list error");
    return res.status(500).json({ error: "Gagal mengambil data" });
  }
});

// ── POST /api/wa-notification-logs/:id/retry ──────────────────────────────────
waNotificationLogsRouter.post("/:id/retry", async (req: Request, res: Response) => {
  if (!(await requireAdmin(req, res))) return;
  const id = parseInt(String(req.params.id), 10);
  if (isNaN(id)) return res.status(400).json({ error: "ID tidak valid" });

  try {
    const [row] = await db
      .select()
      .from(notificationLogsTable)
      .where(and(eq(notificationLogsTable.id, id), eq(notificationLogsTable.channel, "wa")));

    if (!row) return res.status(404).json({ error: "Log tidak ditemukan" });
    if (row.status !== "failed") return res.status(400).json({ error: "Hanya log dengan status 'failed' yang bisa di-retry" });

    if (!FONNTE_TOKEN) return res.status(503).json({ error: "FONNTE_TOKEN belum dikonfigurasi" });

    const params: Record<string, string> = { target: row.recipient, message: row.message };
    if (row.mediaUrl?.trim()) params.url = row.mediaUrl.trim();

    const fres = await fetch(FONNTE_URL, {
      method: "POST",
      headers: { Authorization: FONNTE_TOKEN, "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams(params).toString(),
    });
    const body = await fres.json() as Record<string, unknown>;

    const ok = fres.ok && body.status !== false && body.status !== "false";
    const newRetryCount = (row.retryCount ?? 0) + 1;

    if (ok) {
      const waMessageId = (() => {
        const raw = body.id ?? body.message_id ?? body.messageId;
        if (!raw) return undefined;
        if (Array.isArray(raw)) return raw[0] ? String(raw[0]) : undefined;
        return String(raw);
      })();
      await db.update(notificationLogsTable)
        .set({ status: "sent", retryCount: newRetryCount, nextRetryAt: null, errorMsg: null, waMessageId: waMessageId ?? null })
        .where(eq(notificationLogsTable.id, id));
      logger.info({ id, recipient: row.recipient, retryCount: newRetryCount }, "[wa-logs] manual retry sukses");
      return res.json({ ok: true, message: "WA berhasil dikirim ulang" });
    } else {
      const errorMsg = `[manual-retry ${newRetryCount}] ${String(body.reason ?? body.message ?? `HTTP ${fres.status}`)}`;
      await db.update(notificationLogsTable)
        .set({ retryCount: newRetryCount, errorMsg })
        .where(eq(notificationLogsTable.id, id));
      logger.warn({ id, recipient: row.recipient, errorMsg }, "[wa-logs] manual retry gagal");
      return res.status(502).json({ ok: false, error: errorMsg });
    }
  } catch (err) {
    logger.error({ err, id }, "wa-notification-logs retry error");
    return res.status(500).json({ error: "Gagal melakukan retry" });
  }
});
