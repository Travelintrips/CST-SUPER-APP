import { Router, type Request, type Response } from "express";
import { randomBytes } from "crypto";
import { eq, sql } from "drizzle-orm";
import { db, customerFeedbackLinksTable, logisticOrdersTable } from "@workspace/db";
import { requireClerkUser, requireAdmin } from "../lib/requireAdmin.js";
import { logger } from "../lib/logger.js";

export const customerFeedbackPublicRouter = Router();
export const customerFeedbackAdminRouter = Router();

// ─── Boot migration ───────────────────────────────────────────────────────────
let migrationDone = false;
async function ensureTable() {
  if (migrationDone) return;
  try {
    await db.execute(sql`
      CREATE TABLE IF NOT EXISTS customer_feedback_links (
        id SERIAL PRIMARY KEY,
        token TEXT NOT NULL UNIQUE,
        order_id INTEGER,
        order_number TEXT,
        customer_name TEXT,
        service_type TEXT,
        completed_at TIMESTAMPTZ,
        status TEXT NOT NULL DEFAULT 'pending',
        rating INTEGER,
        feedback TEXT,
        submitted_at TIMESTAMPTZ,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        created_by TEXT,
        expires_at TIMESTAMPTZ
      )
    `);
    migrationDone = true;
  } catch (err) {
    logger.error({ err }, "customerFeedback ensureTable error");
  }
}

// ─── Admin: POST /api/customer-feedback/create ────────────────────────────────
// Buat link feedback baru untuk order yang selesai
customerFeedbackAdminRouter.post("/create", async (req: Request, res: Response) => {
  if (!(await requireClerkUser(req, res))) return;
  await ensureTable();

  const { orderId, orderNumber, customerName, serviceType, completedAt, expiresInDays = 30 } = req.body as {
    orderId?: number;
    orderNumber?: string;
    customerName?: string;
    serviceType?: string;
    completedAt?: string;
    expiresInDays?: number;
  };

  try {
    let finalOrderNumber = orderNumber;
    let finalCustomerName = customerName;
    let finalServiceType = serviceType;

    if (orderId && !finalOrderNumber) {
      const [order] = await db
        .select({
          orderNumber: logisticOrdersTable.orderNumber,
          customerName: logisticOrdersTable.customerName,
          shipmentType: logisticOrdersTable.shipmentType,
        })
        .from(logisticOrdersTable)
        .where(eq(logisticOrdersTable.id, orderId))
        .limit(1);
      if (order) {
        finalOrderNumber = order.orderNumber;
        finalCustomerName = finalCustomerName ?? order.customerName;
        finalServiceType = finalServiceType ?? order.shipmentType;
      }
    }

    const token = randomBytes(32).toString("hex"); // P0.2 — 256-bit
    const expiresAt = new Date(Date.now() + expiresInDays * 86_400_000);

    const [inserted] = await db
      .insert(customerFeedbackLinksTable)
      .values({
        token,
        orderId: orderId ?? null,
        orderNumber: finalOrderNumber ?? null,
        customerName: finalCustomerName ?? null,
        serviceType: finalServiceType ?? null,
        completedAt: completedAt ? new Date(completedAt) : null,
        status: "pending",
        expiresAt,
        createdBy: (req as any).user?.email ?? null,
      })
      .returning();

    return res.json({ ok: true, token, feedbackUrl: `/customer-feedback/${token}`, link: inserted });
  } catch (err) {
    logger.error({ err }, "customerFeedback create error");
    return res.status(500).json({ error: "Gagal membuat link feedback" });
  }
});

// ─── Admin: GET /api/customer-feedback/list ───────────────────────────────────
customerFeedbackAdminRouter.get("/list", async (req: Request, res: Response) => {
  if (!(await requireClerkUser(req, res))) return;
  await ensureTable();
  try {
    const rows = await db
      .select()
      .from(customerFeedbackLinksTable)
      .orderBy(sql`${customerFeedbackLinksTable.createdAt} DESC`)
      .limit(200);
    return res.json(rows);
  } catch (err) {
    logger.error({ err }, "customerFeedback list error");
    return res.status(500).json({ error: "Gagal memuat data" });
  }
});

// ─── Public: GET /api/customer-feedback/:token ───────────────────────────────
customerFeedbackPublicRouter.get("/:token", async (req: Request, res: Response) => {
  const { token } = req.params as { token: string };
  await ensureTable();

  try {
    const [row] = await db
      .select()
      .from(customerFeedbackLinksTable)
      .where(eq(customerFeedbackLinksTable.token, token))
      .limit(1);

    if (!row) return res.status(404).json({ error: "Link tidak ditemukan atau sudah tidak berlaku" });
    if (row.expiresAt && row.expiresAt < new Date()) {
      return res.status(410).json({ error: "Link ini sudah kedaluwarsa" });
    }

    return res.json({
      token: row.token,
      orderNumber: row.orderNumber,
      customerName: row.customerName,
      serviceType: row.serviceType,
      completedAt: row.completedAt?.toISOString() ?? null,
      status: row.status,
      rating: row.rating,
      feedback: row.feedback,
    });
  } catch (err) {
    logger.error({ err }, "customerFeedback GET error");
    return res.status(500).json({ error: "Gagal memuat data" });
  }
});

// ─── Public: POST /api/customer-feedback/:token ──────────────────────────────
customerFeedbackPublicRouter.post("/:token", async (req: Request, res: Response) => {
  const { token } = req.params as { token: string };
  await ensureTable();

  try {
    const [row] = await db
      .select()
      .from(customerFeedbackLinksTable)
      .where(eq(customerFeedbackLinksTable.token, token))
      .limit(1);

    if (!row) return res.status(404).json({ error: "Link tidak ditemukan" });
    if (row.expiresAt && row.expiresAt < new Date()) {
      return res.status(410).json({ error: "Link ini sudah kedaluwarsa" });
    }
    if (row.status === "submitted") {
      return res.status(409).json({ error: "Feedback sudah pernah dikirim", alreadySubmitted: true });
    }

    const { rating, feedback } = req.body as { rating: number; feedback?: string | null };
    if (!rating || rating < 1 || rating > 5) {
      return res.status(400).json({ error: "Rating harus antara 1 sampai 5" });
    }

    await db
      .update(customerFeedbackLinksTable)
      .set({
        rating,
        feedback: feedback ?? null,
        status: "submitted",
        submittedAt: new Date(),
      })
      .where(eq(customerFeedbackLinksTable.token, token));

    return res.json({ success: true });
  } catch (err) {
    logger.error({ err }, "customerFeedback POST error");
    return res.status(500).json({ error: "Gagal menyimpan feedback" });
  }
});
