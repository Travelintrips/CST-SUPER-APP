import { Router } from "express";
import {
  db,
  emailCorrespondencesTable,
  emailAttachmentsTable,
  emailLinksTable,
} from "@workspace/db";
import { eq, desc, ilike, or, and, inArray, gte, lte } from "drizzle-orm";
import { requireClerkUser } from "../lib/requireAdmin.js";
import { ObjectStorageService } from "../lib/objectStorage.js";

const router = Router();
const _emailObjectStorage = new ObjectStorageService();

router.use(async (req, res, next) => {
  if (!(await requireClerkUser(req, res))) return;
  next();
});

function serializeCorrespondence(c: typeof emailCorrespondencesTable.$inferSelect) {
  return {
    ...c,
    receivedAt: c.receivedAt.toISOString(),
    validatedAt: c.validatedAt ? c.validatedAt.toISOString() : null,
    createdAt: c.createdAt.toISOString(),
    updatedAt: c.updatedAt.toISOString(),
  };
}

function serializeAttachment(a: typeof emailAttachmentsTable.$inferSelect) {
  return {
    ...a,
    createdAt: a.createdAt.toISOString(),
  };
}

function serializeLink(l: typeof emailLinksTable.$inferSelect) {
  return {
    ...l,
    validatedAt: l.validatedAt ? l.validatedAt.toISOString() : null,
    createdAt: l.createdAt.toISOString(),
  };
}

// GET /api/email-correspondences
router.get("/", async (req, res) => {
  const { q, status, from, subject, dateFrom, dateTo, linkedType, isValidated } = req.query;
  const conditions = [];

  if (status) conditions.push(eq(emailCorrespondencesTable.status, status as string));

  if (q) {
    const like = `%${q}%`;
    conditions.push(
      or(
        ilike(emailCorrespondencesTable.subject, like),
        ilike(emailCorrespondencesTable.fromEmail, like),
        ilike(emailCorrespondencesTable.toEmail, like),
        ilike(emailCorrespondencesTable.body, like),
      ),
    );
  }

  if (from) conditions.push(ilike(emailCorrespondencesTable.fromEmail, `%${from}%`));
  if (subject) conditions.push(ilike(emailCorrespondencesTable.subject, `%${subject}%`));
  if (dateFrom) conditions.push(gte(emailCorrespondencesTable.receivedAt, new Date(dateFrom as string)));
  if (dateTo) {
    const end = new Date(dateTo as string);
    end.setHours(23, 59, 59, 999);
    conditions.push(lte(emailCorrespondencesTable.receivedAt, end));
  }

  // Filter by linkedType or isValidated — requires join via subquery on email_links
  if (linkedType || isValidated !== undefined) {
    const linkConditions = [];
    if (linkedType) linkConditions.push(eq(emailLinksTable.linkedType, linkedType as string));
    if (isValidated === "true") linkConditions.push(eq(emailLinksTable.isValidated, true));
    if (isValidated === "false") linkConditions.push(eq(emailLinksTable.isValidated, false));

    const linkedEmailIds = await db
      .selectDistinct({ id: emailLinksTable.emailCorrespondenceId })
      .from(emailLinksTable)
      .where(linkConditions.length > 0 ? and(...linkConditions) : undefined);

    const ids = linkedEmailIds.map((r) => r.id);
    if (ids.length === 0) {
      return res.json([]);
    }
    conditions.push(inArray(emailCorrespondencesTable.id, ids));
  }

  const rows = await db
    .select()
    .from(emailCorrespondencesTable)
    .where(conditions.length > 0 ? and(...conditions) : undefined)
    .orderBy(desc(emailCorrespondencesTable.receivedAt))
    .limit(200);

  return res.json(rows.map(serializeCorrespondence));
});

// GET /api/email-correspondences/by-transaction
router.get("/by-transaction", async (req, res) => {
  const { linkedType, linkedId } = req.query;
  if (!linkedType || !linkedId) {
    return res.status(400).json({ message: "linkedType dan linkedId wajib diisi" });
  }

  const links = await db
    .select()
    .from(emailLinksTable)
    .where(
      and(
        eq(emailLinksTable.linkedType, linkedType as string),
        eq(emailLinksTable.linkedId, Number(linkedId)),
      ),
    )
    .orderBy(desc(emailLinksTable.createdAt));

  if (links.length === 0) return res.json([]);

  const emailIds = links.map((l) => l.emailCorrespondenceId);
  const emails = await db
    .select()
    .from(emailCorrespondencesTable)
    .where(inArray(emailCorrespondencesTable.id, emailIds));

  const attachments = await db
    .select()
    .from(emailAttachmentsTable)
    .where(inArray(emailAttachmentsTable.emailCorrespondenceId, emailIds))
    .orderBy(emailAttachmentsTable.id);

  const emailMap = new Map(emails.map((e) => [e.id, e]));
  const attMap = new Map<number, (typeof emailAttachmentsTable.$inferSelect)[]>();
  for (const att of attachments) {
    const list = attMap.get(att.emailCorrespondenceId) ?? [];
    list.push(att);
    attMap.set(att.emailCorrespondenceId, list);
  }

  const result = links.map((link) => {
    const email = emailMap.get(link.emailCorrespondenceId);
    return {
      link: serializeLink(link),
      email: email ? serializeCorrespondence(email) : null,
      attachments: (attMap.get(link.emailCorrespondenceId) ?? []).map(serializeAttachment),
    };
  });

  return res.json(result);
});

// GET /api/email-correspondences/:id
router.get("/:id", async (req, res) => {
  const id = Number(req.params.id);
  const [row] = await db
    .select()
    .from(emailCorrespondencesTable)
    .where(eq(emailCorrespondencesTable.id, id))
    .limit(1);
  if (!row) return res.status(404).json({ message: "Email tidak ditemukan" });

  const attachments = await db
    .select()
    .from(emailAttachmentsTable)
    .where(eq(emailAttachmentsTable.emailCorrespondenceId, id))
    .orderBy(emailAttachmentsTable.id);

  const links = await db
    .select()
    .from(emailLinksTable)
    .where(eq(emailLinksTable.emailCorrespondenceId, id))
    .orderBy(desc(emailLinksTable.createdAt));

  return res.json({
    ...serializeCorrespondence(row),
    attachments: attachments.map(serializeAttachment),
    links: links.map(serializeLink),
  });
});

// POLICY: Email correspondences are EVIDENCE ONLY.
// Validating or linking an email NEVER changes the status of a Sales Order,
// Purchase Order, Payment, or Expense. Transaction status changes must be
// performed explicitly by an authorized user through the respective transaction endpoints.

// POST /api/email-correspondences/:id/validate-status
router.post("/:id/validate-status", async (req, res) => {
  const id = Number(req.params.id);
  const { status } = req.body;
  const validStatuses = ["new", "linked", "validated", "rejected", "archived"];
  if (!status || !validStatuses.includes(status)) {
    return res.status(400).json({ message: `status harus salah satu dari: ${validStatuses.join(", ")}` });
  }

  const userId = req.isAuthenticated() ? (req.user as { id: string }).id : null;

  const updateData = status === "validated"
    ? { status, updatedAt: new Date(), validatedBy: userId, validatedAt: new Date() }
    : { status, updatedAt: new Date() };

  const [row] = await db
    .update(emailCorrespondencesTable)
    .set(updateData)
    .where(eq(emailCorrespondencesTable.id, id))
    .returning();
  if (!row) return res.status(404).json({ message: "Email tidak ditemukan" });

  // When validating, also mark all links as validated
  if (status === "validated") {
    await db
      .update(emailLinksTable)
      .set({ isValidated: true, validatedBy: userId, validatedAt: new Date() })
      .where(and(
        eq(emailLinksTable.emailCorrespondenceId, id),
        eq(emailLinksTable.isValidated, false),
      ));
  }

  return res.json(serializeCorrespondence(row));
});

// GET /api/email-correspondences/:id/links
router.get("/:id/links", async (req, res) => {
  const id = Number(req.params.id);
  const links = await db
    .select()
    .from(emailLinksTable)
    .where(eq(emailLinksTable.emailCorrespondenceId, id))
    .orderBy(desc(emailLinksTable.createdAt));
  return res.json(links.map(serializeLink));
});

// NOTE: Creating a link only updates the email's own status to "linked".
// It does NOT modify any Sales Order, Purchase Order, Payment, or Expense status.
// POST /api/email-correspondences/:id/links
router.post("/:id/links", async (req, res) => {
  const emailCorrespondenceId = Number(req.params.id);
  const { linkedType, linkedId, linkReason, notes } = req.body;

  const validLinkedTypes = ["sales_order", "purchase_order", "expense", "shipment", "payment", "invoice"];
  if (!linkedType || !validLinkedTypes.includes(linkedType)) {
    return res.status(400).json({ message: `linkedType harus salah satu dari: ${validLinkedTypes.join(", ")}` });
  }
  if (!linkedId || isNaN(Number(linkedId))) {
    return res.status(400).json({ message: "linkedId harus berupa angka" });
  }

  const [emailRow] = await db
    .select({ id: emailCorrespondencesTable.id })
    .from(emailCorrespondencesTable)
    .where(eq(emailCorrespondencesTable.id, emailCorrespondenceId))
    .limit(1);
  if (!emailRow) return res.status(404).json({ message: "Email tidak ditemukan" });

  const [link] = await db
    .insert(emailLinksTable)
    .values({
      emailCorrespondenceId,
      linkedType,
      linkedId: Number(linkedId),
      linkReason: linkReason ?? null,
      notes: notes ?? null,
    })
    .returning();

  await db
    .update(emailCorrespondencesTable)
    .set({ status: "linked", updatedAt: new Date() })
    .where(eq(emailCorrespondencesTable.id, emailCorrespondenceId));

  return res.status(201).json(serializeLink(link));
});

// PUT /api/email-correspondences/:id/links/:linkId/validate
router.put("/:id/links/:linkId/validate", async (req, res) => {
  const linkId = Number(req.params.linkId);
  const { notes } = req.body;
  const userId = req.isAuthenticated() ? (req.user as { id: string }).id : null;

  const [link] = await db
    .update(emailLinksTable)
    .set({
      isValidated: true,
      validatedBy: userId,
      validatedAt: new Date(),
      notes: notes ?? null,
    })
    .where(eq(emailLinksTable.id, linkId))
    .returning();
  if (!link) return res.status(404).json({ message: "Link tidak ditemukan" });
  return res.json(serializeLink(link));
});

// DELETE /api/email-correspondences/:id/links/:linkId
router.delete("/:id/links/:linkId", async (req, res) => {
  const linkId = Number(req.params.linkId);
  await db.delete(emailLinksTable).where(eq(emailLinksTable.id, linkId));
  return res.json({ message: "Link berhasil dihapus" });
});

// DELETE /api/email-correspondences/:id
router.delete("/:id", async (req, res) => {
  const id = Number(req.params.id);
  if (isNaN(id)) return res.status(400).json({ message: "ID tidak valid" });

  const [row] = await db
    .select({ id: emailCorrespondencesTable.id })
    .from(emailCorrespondencesTable)
    .where(eq(emailCorrespondencesTable.id, id))
    .limit(1);
  if (!row) return res.status(404).json({ message: "Email tidak ditemukan" });

  // Ambil fileUrl semua attachment sebelum dihapus dari DB
  const attachments = await db
    .select({ fileUrl: emailAttachmentsTable.fileUrl })
    .from(emailAttachmentsTable)
    .where(eq(emailAttachmentsTable.emailCorrespondenceId, id));
  // Cascade: delete links and attachments first
  await db.delete(emailLinksTable).where(eq(emailLinksTable.emailCorrespondenceId, id));
  await db.delete(emailAttachmentsTable).where(eq(emailAttachmentsTable.emailCorrespondenceId, id));
  await db.delete(emailCorrespondencesTable).where(eq(emailCorrespondencesTable.id, id));
  // Cascade storage cleanup — hapus file fisik (non-fatal)
  for (const a of attachments) {
    if (a.fileUrl) _emailObjectStorage.tryDeletePrivateEntity(a.fileUrl).catch(() => {});
  }
  return res.json({ message: "Email berhasil dihapus" });
});

export default router;
