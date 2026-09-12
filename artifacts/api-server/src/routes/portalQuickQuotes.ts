import { Router, type Request, type Response } from "express";
import { db, portalQuickQuotesTable } from "@workspace/db";
import { eq, desc, sql, ilike, or } from "drizzle-orm";
import { requireAdmin } from "../lib/requireAdmin.js";
import { logger } from "../lib/logger.js";
import { broadcastToAdmins } from "../lib/sseManager.js";
import { saveAndBroadcast } from "../lib/notificationStore.js";

export const portalQuickQuotesPublicRouter = Router();
export const portalQuickQuotesAdminRouter = Router();

db.execute(sql`
  CREATE TABLE IF NOT EXISTS portal_quick_quotes (
    id SERIAL PRIMARY KEY,
    quote_number TEXT NOT NULL UNIQUE,
    name TEXT NOT NULL,
    company TEXT,
    email TEXT,
    phone TEXT NOT NULL,
    service_category TEXT NOT NULL,
    origin TEXT,
    destination TEXT,
    commodity TEXT,
    weight_kg NUMERIC(12,2),
    volume TEXT,
    description TEXT,
    status TEXT NOT NULL DEFAULT 'new',
    admin_notes TEXT,
    assigned_to TEXT,
    contacted_at TIMESTAMPTZ,
    meta JSONB DEFAULT '{}',
    created_at TIMESTAMP NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
  )
`).catch(() => {});

db.execute(sql`
  ALTER TABLE portal_quick_quotes ADD COLUMN IF NOT EXISTS email TEXT
`).catch(() => {});

db.execute(sql`
  ALTER TABLE portal_quick_quotes ADD COLUMN IF NOT EXISTS volume TEXT
`).catch(() => {});

db.execute(sql`
  ALTER TABLE portal_quick_quotes ADD COLUMN IF NOT EXISTS meta JSONB DEFAULT '{}'
`).catch(() => {});

function generateQuoteNumber(): string {
  const ts = Date.now().toString(36).toUpperCase();
  const rand = Math.random().toString(36).substring(2, 5).toUpperCase();
  return `QQ-${ts}-${rand}`;
}

portalQuickQuotesPublicRouter.post("/", async (req: Request, res: Response) => {
  try {
    const {
      name, company, email, phone, serviceCategory,
      origin, destination, commodity, weightKg, volume, description,
    } = req.body as Record<string, string>;

    if (!name?.trim() || !phone?.trim() || !serviceCategory?.trim()) {
      return res.status(400).json({ error: "name, phone, dan serviceCategory wajib diisi." });
    }

    if (phone.trim().replace(/\D/g, "").length < 8) {
      return res.status(400).json({ error: "Nomor telepon tidak valid." });
    }

    const quoteNumber = generateQuoteNumber();
    const [row] = await db.insert(portalQuickQuotesTable).values({
      quoteNumber,
      name: name.trim(),
      company: company?.trim() || null,
      email: email?.trim() || null,
      phone: phone.trim(),
      serviceCategory: serviceCategory.trim(),
      origin: origin?.trim() || null,
      destination: destination?.trim() || null,
      commodity: commodity?.trim() || null,
      weightKg: weightKg ? String(weightKg) : null,
      volume: volume?.trim() || null,
      description: description?.trim() || null,
      status: "new",
    }).returning();

    try {
      await saveAndBroadcast("quick_quote", {
        type: "quick_quote",
        orderNumber: quoteNumber,
        customerName: name,
        title: "Quick Quote Baru",
        message: `${name} (${serviceCategory}) — ${phone}`,
        link: `/portal/quick-quotes`,
        severity: "info",
      });
      broadcastToAdmins("quick_quote_new", { id: row.id, quoteNumber, name, serviceCategory });
    } catch { /* non-fatal */ }

    logger.info({ quoteNumber, serviceCategory }, "[quick-quote] Submitted");
    return res.status(201).json({ ok: true, quoteNumber, id: row.id });
  } catch (err) {
    logger.error(err, "[quick-quote] POST error");
    return res.status(500).json({ error: "Gagal menyimpan permintaan." });
  }
});

portalQuickQuotesAdminRouter.get("/", async (req: Request, res: Response) => {
  const ok = await requireAdmin(req, res);
  if (!ok) return;
  try {
    const { status, search, limit = "50", offset = "0" } = req.query as Record<string, string>;
    let query = db.select().from(portalQuickQuotesTable).$dynamic();
    const conds = [];
    if (status && status !== "all") conds.push(eq(portalQuickQuotesTable.status, status));
    if (search?.trim()) {
      const s = `%${search.trim()}%`;
      conds.push(or(
        ilike(portalQuickQuotesTable.name, s),
        ilike(portalQuickQuotesTable.phone, s),
        ilike(portalQuickQuotesTable.company, s),
        ilike(portalQuickQuotesTable.email, s),
        ilike(portalQuickQuotesTable.quoteNumber, s),
      ));
    }
    if (conds.length) {
      const { and: drizzleAnd } = await import("drizzle-orm");
      query = query.where(drizzleAnd(...conds)) as typeof query;
    }
    const rows = await query.orderBy(desc(portalQuickQuotesTable.createdAt)).limit(Number(limit)).offset(Number(offset));
    const [{ count }] = await db.select({ count: sql<number>`COUNT(*)` }).from(portalQuickQuotesTable);
    return res.json({ items: rows, total: Number(count) });
  } catch (err) {
    logger.error(err, "[quick-quote] GET list error");
    return res.status(500).json({ error: "Gagal memuat data." });
  }
});

portalQuickQuotesAdminRouter.get("/:id", async (req: Request, res: Response) => {
  const ok = await requireAdmin(req, res);
  if (!ok) return;
  try {
    const [row] = await db.select().from(portalQuickQuotesTable).where(eq(portalQuickQuotesTable.id, Number(req.params.id)));
    if (!row) return res.status(404).json({ error: "Tidak ditemukan." });
    return res.json(row);
  } catch (err) {
    logger.error(err, "[quick-quote] GET detail error");
    return res.status(500).json({ error: "Gagal memuat data." });
  }
});

portalQuickQuotesAdminRouter.patch("/:id", async (req: Request, res: Response) => {
  const ok = await requireAdmin(req, res);
  if (!ok) return;
  try {
    const { status, adminNotes, assignedTo } = req.body as Record<string, string>;
    const updates: Record<string, unknown> = { updatedAt: new Date() };
    if (status) updates.status = status;
    if (adminNotes !== undefined) updates.adminNotes = adminNotes;
    if (assignedTo !== undefined) updates.assignedTo = assignedTo;
    if (status === "contacted") updates.contactedAt = new Date();
    const [row] = await db.update(portalQuickQuotesTable).set(updates).where(eq(portalQuickQuotesTable.id, Number(req.params.id))).returning();
    if (!row) return res.status(404).json({ error: "Tidak ditemukan." });
    return res.json(row);
  } catch (err) {
    logger.error(err, "[quick-quote] PATCH error");
    return res.status(500).json({ error: "Gagal memperbarui." });
  }
});

portalQuickQuotesAdminRouter.delete("/:id", async (req: Request, res: Response) => {
  const ok = await requireAdmin(req, res);
  if (!ok) return;
  try {
    await db.delete(portalQuickQuotesTable).where(eq(portalQuickQuotesTable.id, Number(req.params.id)));
    return res.json({ ok: true });
  } catch (err) {
    logger.error(err, "[quick-quote] DELETE error");
    return res.status(500).json({ error: "Gagal menghapus." });
  }
});
