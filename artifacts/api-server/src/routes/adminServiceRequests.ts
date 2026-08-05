import { Router, type Request, type Response } from "express";
import { db } from "@workspace/db";
import {
  customerServiceRequestsTable,
  customerServiceRequestItemsTable,
  customerServiceRequestDocumentsTable,
  portalCustomerProfilesTable,
  portalCustomersTable,
} from "@workspace/db";
import { eq, desc, and, ilike, or, sql } from "drizzle-orm";
import { requireAdmin } from "../lib/requireAdmin.js";
import { logger } from "../lib/logger.js";

export const adminServiceRequestsRouter = Router();

const VALID_CSR_STATUSES = [
  "draft", "submitted", "need_review", "need_more_data",
  "approved_for_rfq", "rejected", "cancelled",
] as const;

const VALID_ITEM_STATUSES = [
  "pending", "approved", "rejected", "need_more_data", "quoted", "accepted",
] as const;

// ── middleware ────────────────────────────────────────────────────────────────
adminServiceRequestsRouter.use(async (req, res, next) => {
  const ok = await requireAdmin(req, res);
  if (!ok) return;
  next();
});

// ── GET /api/admin/service-requests ──────────────────────────────────────────
adminServiceRequestsRouter.get("/", async (req: Request, res: Response) => {
  try {
    const status = req.query.status as string | undefined;
    const search = req.query.search as string | undefined;
    const tradeType = req.query.tradeType as string | undefined;
    const limit = Math.min(Number(req.query.limit ?? 50), 200);
    const offset = Number(req.query.offset ?? 0);

    let query = db
      .select()
      .from(customerServiceRequestsTable)
      .orderBy(desc(customerServiceRequestsTable.createdAt))
      .limit(limit)
      .offset(offset);

    const conditions = [];
    if (status && status !== "all") conditions.push(eq(customerServiceRequestsTable.status, status));
    if (tradeType && tradeType !== "all") conditions.push(eq(customerServiceRequestsTable.tradeType, tradeType));
    if (search) {
      conditions.push(
        or(
          ilike(customerServiceRequestsTable.customerName, `%${search}%`),
          ilike(customerServiceRequestsTable.customerEmail, `%${search}%`),
          ilike(customerServiceRequestsTable.requestNumber, `%${search}%`),
          ilike(customerServiceRequestsTable.customerCompany, `%${search}%`),
        )
      );
    }

    const requests = conditions.length
      ? await db.select().from(customerServiceRequestsTable)
          .where(and(...conditions))
          .orderBy(desc(customerServiceRequestsTable.createdAt))
          .limit(limit).offset(offset)
      : await db.select().from(customerServiceRequestsTable)
          .orderBy(desc(customerServiceRequestsTable.createdAt))
          .limit(limit).offset(offset);

    const countResult = await db.execute(
      sql`SELECT COUNT(*)::int as total FROM customer_service_requests ${conditions.length ? sql`WHERE status = ${status ?? ""}` : sql``}`
    );
    const total = Number((countResult.rows[0] as Record<string, unknown>)?.total ?? 0);

    return res.json({ requests, total, limit, offset });
  } catch (err) {
    logger.error({ err }, "[adminCSR] list error");
    return res.status(500).json({ error: "Gagal mengambil daftar CSR" });
  }
});

// ── GET /api/admin/service-requests/:id ──────────────────────────────────────
adminServiceRequestsRouter.get("/:id", async (req: Request, res: Response) => {
  try {
    const id = Number(req.params.id);
    const [request] = await db
      .select()
      .from(customerServiceRequestsTable)
      .where(eq(customerServiceRequestsTable.id, id))
      .limit(1);
    if (!request) return res.status(404).json({ error: "Request tidak ditemukan" });

    const items = await db
      .select()
      .from(customerServiceRequestItemsTable)
      .where(eq(customerServiceRequestItemsTable.requestId, id))
      .orderBy(customerServiceRequestItemsTable.sequenceNo);

    const documents = await db
      .select()
      .from(customerServiceRequestDocumentsTable)
      .where(eq(customerServiceRequestDocumentsTable.requestId, id));

    // Fetch customer profile
    let profile = null;
    if (request.customerId) {
      const [p] = await db.select().from(portalCustomerProfilesTable)
        .where(eq(portalCustomerProfilesTable.customerId, request.customerId)).limit(1);
      profile = p ?? null;
    }
    if (!profile && request.customerEmail) {
      const [p] = await db.select().from(portalCustomerProfilesTable)
        .where(eq(portalCustomerProfilesTable.guestEmail, request.customerEmail)).limit(1);
      profile = p ?? null;
    }

    let customerAccount = null;
    if (request.customerId) {
      const [c] = await db.select({
        id: portalCustomersTable.id,
        name: portalCustomersTable.name,
        email: portalCustomersTable.email,
        role: portalCustomersTable.role,
        createdAt: portalCustomersTable.createdAt,
      }).from(portalCustomersTable)
        .where(eq(portalCustomersTable.id, request.customerId)).limit(1);
      customerAccount = c ?? null;
    }

    return res.json({ ...request, items, documents, profile, customerAccount });
  } catch (err) {
    logger.error({ err }, "[adminCSR] get error");
    return res.status(500).json({ error: "Gagal mengambil CSR" });
  }
});

// ── PUT /api/admin/service-requests/:id/status ───────────────────────────────
adminServiceRequestsRouter.put("/:id/status", async (req: Request, res: Response) => {
  try {
    const id = Number(req.params.id);
    const { status, adminNotes, handledBy } = req.body as Record<string, string>;

    if (!VALID_CSR_STATUSES.includes(status as typeof VALID_CSR_STATUSES[number])) {
      return res.status(400).json({ error: `Status tidak valid. Pilihan: ${VALID_CSR_STATUSES.join(", ")}` });
    }

    const [updated] = await db
      .update(customerServiceRequestsTable)
      .set({
        status,
        adminNotes: adminNotes ?? undefined,
        handledBy: handledBy ?? undefined,
        updatedAt: new Date(),
      })
      .where(eq(customerServiceRequestsTable.id, id))
      .returning();

    if (!updated) return res.status(404).json({ error: "Request tidak ditemukan" });
    logger.info({ id, status }, "[adminCSR] status updated");
    return res.json(updated);
  } catch (err) {
    logger.error({ err }, "[adminCSR] status update error");
    return res.status(500).json({ error: "Gagal mengubah status" });
  }
});

// ── PUT /api/admin/service-requests/:id/items/:itemId/status ─────────────────
adminServiceRequestsRouter.put("/:id/items/:itemId/status", async (req: Request, res: Response) => {
  try {
    const requestId = Number(req.params.id);
    const itemId = Number(req.params.itemId);
    const { status, vendorNotes } = req.body as Record<string, string>;

    if (!VALID_ITEM_STATUSES.includes(status as typeof VALID_ITEM_STATUSES[number])) {
      return res.status(400).json({ error: `Status item tidak valid` });
    }

    const [updated] = await db
      .update(customerServiceRequestItemsTable)
      .set({ status, vendorNotes: vendorNotes ?? undefined, updatedAt: new Date() })
      .where(and(
        eq(customerServiceRequestItemsTable.id, itemId),
        eq(customerServiceRequestItemsTable.requestId, requestId),
      ))
      .returning();

    if (!updated) return res.status(404).json({ error: "Item tidak ditemukan" });
    logger.info({ requestId, itemId, status }, "[adminCSR] item status updated");
    return res.json(updated);
  } catch (err) {
    logger.error({ err }, "[adminCSR] item status update error");
    return res.status(500).json({ error: "Gagal mengubah status item" });
  }
});

// ── POST /api/admin/service-requests/:id/request-more-data ───────────────────
adminServiceRequestsRouter.post("/:id/request-more-data", async (req: Request, res: Response) => {
  try {
    const id = Number(req.params.id);
    const { message, handledBy } = req.body as Record<string, string>;

    const [updated] = await db
      .update(customerServiceRequestsTable)
      .set({
        status: "need_more_data",
        adminNotes: message ?? "Admin meminta data tambahan",
        handledBy: handledBy ?? undefined,
        updatedAt: new Date(),
      })
      .where(eq(customerServiceRequestsTable.id, id))
      .returning();

    if (!updated) return res.status(404).json({ error: "Request tidak ditemukan" });
    logger.info({ id }, "[adminCSR] request-more-data sent");
    return res.json(updated);
  } catch (err) {
    logger.error({ err }, "[adminCSR] request-more-data error");
    return res.status(500).json({ error: "Gagal mengirim permintaan data" });
  }
});

// ── PUT /api/admin/service-requests/:id/verify-profile ───────────────────────
adminServiceRequestsRouter.put("/:id/verify-profile", async (req: Request, res: Response) => {
  try {
    const id = Number(req.params.id);
    const { verifiedBy } = req.body as Record<string, string>;

    const [request] = await db.select()
      .from(customerServiceRequestsTable)
      .where(eq(customerServiceRequestsTable.id, id)).limit(1);
    if (!request) return res.status(404).json({ error: "Request tidak ditemukan" });

    let profile = null;
    const where = request.customerId
      ? eq(portalCustomerProfilesTable.customerId, request.customerId)
      : eq(portalCustomerProfilesTable.guestEmail, request.customerEmail);

    [profile] = await db.select().from(portalCustomerProfilesTable).where(where).limit(1);
    if (!profile) return res.status(404).json({ error: "Profil customer tidak ditemukan" });

    const [updated] = await db.update(portalCustomerProfilesTable)
      .set({ isVerified: true, verifiedBy, verifiedAt: new Date(), profileStatus: "complete" })
      .where(eq(portalCustomerProfilesTable.id, profile.id))
      .returning();

    return res.json(updated);
  } catch (err) {
    logger.error({ err }, "[adminCSR] verify-profile error");
    return res.status(500).json({ error: "Gagal verifikasi profil" });
  }
});
