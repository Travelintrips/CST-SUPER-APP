import { Router } from "express";
import multer from "multer";
import { getOpenAI } from "../lib/openaiClient.js";
import { validateMagicBytes } from "../lib/uploadValidation.js";
import { db, correspondencesTable, correspondenceAttachmentsTable, customersTable, suppliersTable } from "@workspace/db";
import { eq, desc, ilike, or, and, count, inArray } from "drizzle-orm";
import { ObjectStorageService } from "../lib/objectStorage.js";
import { requireAdmin, requireClerkUser } from "../lib/requireAdmin.js";
import { safeSyncImapEmails } from "../lib/imapPoller.js";

const router = Router();
const objectStorageService = new ObjectStorageService();

router.use(async (req, res, next) => {
  if (!(await requireClerkUser(req, res))) return;
  next();
});


const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 20 * 1024 * 1024 } });

const CORRESPONDENCE_SCAN_PROMPT = `Kamu adalah asisten ekstraksi data korespondensi bisnis.
Baca dokumen yang diberikan (bisa berupa screenshot email, foto surat, atau PDF) dan ekstrak informasi korespondensi.
Balas HANYA dengan JSON valid, tanpa markdown, tanpa blok kode, tanpa teks penjelasan.

Format JSON:
{
  "kind": "email" | "whatsapp" | "letter" | "other" | null,
  "subject": string | null,
  "senderName": string | null,
  "senderEmail": string | null,
  "receiverName": string | null,
  "receiverEmail": string | null,
  "correspondedAt": string | null,
  "body": string | null
}

Aturan:
- kind: jenis dokumen korespondensi:
    "email" jika terlihat seperti tampilan antarmuka email (Gmail, Outlook, Thunderbird, dsb.) atau berisi header From/To/Subject khas email
    "whatsapp" jika terlihat seperti percakapan WhatsApp, Telegram, atau aplikasi chat lainnya
    "letter" jika terlihat seperti surat fisik, memo, faks, atau dokumen formal tercetak/bertanda tangan
    "other" untuk jenis lainnya
    null jika tidak dapat ditentukan
- subject: subjek atau judul email/surat (contoh: "Penawaran Harga Freight April 2025")
- senderName: nama lengkap pengirim jika ada
- senderEmail: alamat email pengirim jika ada (format: user@domain.com)
- receiverName: nama lengkap penerima jika ada
- receiverEmail: alamat email penerima jika ada
- correspondedAt: tanggal/waktu korespondensi dalam format ISO 8601 (contoh: "2025-04-15T09:30:00") atau null jika tidak ditemukan
- body: isi utama pesan/surat, ringkas jika panjang (maks 2000 karakter)
- Jika suatu field tidak ditemukan atau tidak yakin, isi dengan null
- Gunakan nilai persis seperti yang tertulis di dokumen (bahasa Indonesia atau Inggris)`;

// POST /api/correspondences/scan
router.post("/scan", async (req, res, next) => {
  if (!(await requireAdmin(req, res))) return;
  next();
}, upload.single("file"), async (req, res): Promise<void> => {
  const file = req.file;
  if (!file) {
    res.status(400).json({ message: "File wajib dilampirkan" });
    return;
  }

  const mimeType = file.mimetype;
  const allowedMimes = ["image/jpeg", "image/png", "image/webp", "application/pdf"];
  const isPdf = mimeType === "application/pdf";

  if (!allowedMimes.includes(mimeType)) {
    res.status(400).json({ message: "Hanya file JPG, PNG, WEBP, dan PDF yang didukung" });
    return;
  }

  // C2-REMEDIATION: magic-byte check — verifikasi konten file sebelum diteruskan ke AI/scanning
  const magicCheck = validateMagicBytes(file.buffer, mimeType);
  if (!magicCheck.ok) {
    res.status(400).json({ message: magicCheck.errorMessage });
    return;
  }

  try {
    const base64Data = file.buffer.toString("base64");
    const dataUrl = `data:${mimeType};base64,${base64Data}`;

    const response = await getOpenAI().chat.completions.create({
      model: "gpt-4o",
      max_tokens: 2048,
      messages: [
        { role: "system", content: CORRESPONDENCE_SCAN_PROMPT },
        {
          role: "user",
          content: [
            { type: "text", text: "Ekstrak data korespondensi dari dokumen ini dan kembalikan sebagai JSON saja." },
            { type: "image_url", image_url: { url: dataUrl } },
          ],
        },
      ],
    });

    const raw = response.choices[0]?.message?.content ?? "{}";
    const cleaned = raw.replace(/```json\n?/g, "").replace(/```\n?/g, "").trim();

    let parsed: unknown;
    try {
      parsed = JSON.parse(cleaned);
    } catch {
      res.status(422).json({ message: "Gagal memproses hasil ekstraksi", raw: cleaned });
      return;
    }

    res.json({ data: parsed });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    res.status(500).json({ message: "Ekstraksi dokumen gagal", error: msg });
  }
});

function serializeCorrespondence(c: typeof correspondencesTable.$inferSelect) {
  return {
    ...c,
    correspondedAt: c.correspondedAt.toISOString(),
    createdAt: c.createdAt.toISOString(),
    tags: c.tags ? c.tags.split(",").map((t) => t.trim()).filter(Boolean) : [],
  };
}

function serializeAttachment(a: typeof correspondenceAttachmentsTable.$inferSelect) {
  return {
    ...a,
    createdAt: a.createdAt.toISOString(),
  };
}

// GET /api/correspondences
router.get("/", async (req, res) => {
  const { q, kind, direction, customerId, supplierId, status } = req.query;
  const conditions = [];
  if (kind) conditions.push(eq(correspondencesTable.kind, kind as "email" | "whatsapp" | "letter" | "other"));
  if (direction) conditions.push(eq(correspondencesTable.direction, direction as "inbound" | "outbound"));
  if (customerId) conditions.push(eq(correspondencesTable.customerId, Number(customerId)));
  if (supplierId) conditions.push(eq(correspondencesTable.supplierId, Number(supplierId)));
  if (status) conditions.push(eq(correspondencesTable.status, status as string));
  if (q) {
    const like = `%${q}%`;
    conditions.push(
      or(
        ilike(correspondencesTable.subject, like),
        ilike(correspondencesTable.body, like),
        ilike(correspondencesTable.extractedText, like),
        ilike(correspondencesTable.senderName, like),
        ilike(correspondencesTable.senderEmail, like),
        ilike(correspondencesTable.tags, like),
      )!
    );
  }
  const rows = await db
    .select()
    .from(correspondencesTable)
    .where(conditions.length ? and(...conditions) : undefined)
    .orderBy(desc(correspondencesTable.correspondedAt));

  const ids = rows.map((r) => r.id);
  const countMap: Record<number, number> = {};
  if (ids.length > 0) {
    const counts = await db
      .select({
        correspondenceId: correspondenceAttachmentsTable.correspondenceId,
        total: count(),
      })
      .from(correspondenceAttachmentsTable)
      .where(inArray(correspondenceAttachmentsTable.correspondenceId, ids))
      .groupBy(correspondenceAttachmentsTable.correspondenceId);
    for (const row of counts) {
      countMap[row.correspondenceId] = Number(row.total);
    }
  }

  return res.json(rows.map((r) => ({ ...serializeCorrespondence(r), attachmentCount: countMap[r.id] ?? 0 })));
});

// GET /api/correspondences/:id
router.get("/:id", async (req, res) => {
  const id = Number(req.params.id);
  const [row] = await db.select().from(correspondencesTable).where(eq(correspondencesTable.id, id));
  if (!row) return res.status(404).json({ message: "Korespondensi tidak ditemukan" });
  const attachments = await db
    .select()
    .from(correspondenceAttachmentsTable)
    .where(eq(correspondenceAttachmentsTable.correspondenceId, id))
    .orderBy(correspondenceAttachmentsTable.createdAt);

  let customerName: string | null = null;
  let supplierName: string | null = null;
  if (row.customerId) {
    const [c] = await db.select({ name: customersTable.name }).from(customersTable).where(eq(customersTable.id, row.customerId));
    customerName = c?.name ?? null;
  }
  if (row.supplierId) {
    const [s] = await db.select({ name: suppliersTable.name }).from(suppliersTable).where(eq(suppliersTable.id, row.supplierId));
    supplierName = s?.name ?? null;
  }

  return res.json({
    ...serializeCorrespondence(row),
    attachments: attachments.map(serializeAttachment),
    customerName,
    supplierName,
  });
});

// POST /api/correspondences
router.post("/", async (req, res) => {
  const {
    kind, direction, subject, body, senderName, senderEmail,
    receiverName, receiverEmail, customerId, supplierId, tags,
    correspondedAt, emailMessageId, emailThreadId,
  } = req.body;
  if (!subject?.trim()) return res.status(400).json({ message: "Subjek wajib diisi" });
  const [row] = await db.insert(correspondencesTable).values({
    kind: kind ?? "email",
    direction: direction ?? "inbound",
    subject: subject.trim(),
    body: body ?? null,
    senderName: senderName ?? null,
    senderEmail: senderEmail ?? null,
    receiverName: receiverName ?? null,
    receiverEmail: receiverEmail ?? null,
    customerId: customerId ?? null,
    supplierId: supplierId ?? null,
    tags: Array.isArray(tags) ? tags.join(", ") : (tags ?? null),
    correspondedAt: correspondedAt ? new Date(correspondedAt) : new Date(),
    emailMessageId: emailMessageId ?? null,
    emailThreadId: emailThreadId ?? null,
  }).returning();
  return res.status(201).json(serializeCorrespondence(row));
});

// PUT /api/correspondences/:id
router.put("/:id", async (req, res) => {
  const id = Number(req.params.id);
  const {
    kind, direction, subject, body, senderName, senderEmail,
    receiverName, receiverEmail, customerId, supplierId, tags,
    correspondedAt,
  } = req.body;
  if (!subject?.trim()) return res.status(400).json({ message: "Subjek wajib diisi" });
  const [row] = await db.update(correspondencesTable).set({
    kind: kind ?? "email",
    direction: direction ?? "inbound",
    subject: subject.trim(),
    body: body ?? null,
    senderName: senderName ?? null,
    senderEmail: senderEmail ?? null,
    receiverName: receiverName ?? null,
    receiverEmail: receiverEmail ?? null,
    customerId: customerId ?? null,
    supplierId: supplierId ?? null,
    tags: Array.isArray(tags) ? tags.join(", ") : (tags ?? null),
    correspondedAt: correspondedAt ? new Date(correspondedAt) : undefined,
  }).where(eq(correspondencesTable.id, id)).returning();
  if (!row) return res.status(404).json({ message: "Korespondensi tidak ditemukan" });
  return res.json(serializeCorrespondence(row));
});

// DELETE /api/correspondences/:id
router.delete("/:id", async (req, res) => {
  const id = Number(req.params.id);
  // Ambil objectPath semua attachment sebelum dihapus dari DB
  const attachments = await db
    .select({ objectPath: correspondenceAttachmentsTable.objectPath })
    .from(correspondenceAttachmentsTable)
    .where(eq(correspondenceAttachmentsTable.correspondenceId, id));
  await db.delete(correspondenceAttachmentsTable).where(eq(correspondenceAttachmentsTable.correspondenceId, id));
  await db.delete(correspondencesTable).where(eq(correspondencesTable.id, id));
  // Cascade storage cleanup — hapus file fisik (non-fatal)
  for (const a of attachments) {
    if (a.objectPath) objectStorageService.tryDeletePrivateEntity(a.objectPath).catch(() => {});
  }
  return res.json({ message: "Berhasil dihapus" });
});

// POST /api/correspondences/:id/attachments
router.post("/:id/attachments", async (req, res) => {
  const correspondenceId = Number(req.params.id);
  const { fileName, objectPath, mimeType, extractedText } = req.body;
  if (!objectPath) return res.status(400).json({ message: "objectPath wajib diisi" });
  const normalizedPath = objectStorageService.normalizeObjectEntityPath(objectPath);
  const [att] = await db.insert(correspondenceAttachmentsTable).values({
    correspondenceId,
    fileName: fileName ?? objectPath.split("/").pop() ?? "attachment",
    objectPath: normalizedPath,
    mimeType: mimeType ?? null,
    extractedText: extractedText ?? null,
  }).returning();
  return res.status(201).json(serializeAttachment(att));
});

// PUT /api/correspondences/:id/attachments/:attId/extracted-text
router.put("/:id/attachments/:attId/extracted-text", async (req, res) => {
  const attId = Number(req.params.attId);
  const { extractedText } = req.body;
  const [att] = await db.update(correspondenceAttachmentsTable)
    .set({ extractedText: extractedText ?? null })
    .where(eq(correspondenceAttachmentsTable.id, attId))
    .returning();
  if (!att) return res.status(404).json({ message: "Lampiran tidak ditemukan" });
  return res.json(serializeAttachment(att));
});

// DELETE /api/correspondences/:id/attachments/:attId
router.delete("/:id/attachments/:attId", async (req, res) => {
  const attId = Number(req.params.attId);
  await db.delete(correspondenceAttachmentsTable).where(eq(correspondenceAttachmentsTable.id, attId));
  return res.json({ message: "Lampiran berhasil dihapus" });
});

// POST /api/correspondences/:id/validate
router.post("/:id/validate", async (req, res) => {
  const id = Number(req.params.id);
  const [row] = await db
    .update(correspondencesTable)
    .set({ status: "validated" })
    .where(eq(correspondencesTable.id, id))
    .returning();
  if (!row) return res.status(404).json({ message: "Korespondensi tidak ditemukan" });
  return res.json(serializeCorrespondence(row));
});

// POST /api/correspondences/:id/reject
router.post("/:id/reject", async (req, res) => {
  const id = Number(req.params.id);
  const [row] = await db
    .update(correspondencesTable)
    .set({ status: "rejected" })
    .where(eq(correspondencesTable.id, id))
    .returning();
  if (!row) return res.status(404).json({ message: "Korespondensi tidak ditemukan" });
  return res.json(serializeCorrespondence(row));
});

// POST /api/correspondences/:id/archive
router.post("/:id/archive", async (req, res) => {
  const id = Number(req.params.id);
  const [row] = await db
    .update(correspondencesTable)
    .set({ status: "archived" })
    .where(eq(correspondencesTable.id, id))
    .returning();
  if (!row) return res.status(404).json({ message: "Korespondensi tidak ditemukan" });
  return res.json(serializeCorrespondence(row));
});

// POST /api/correspondences/:id/link — link to a transaction
router.post("/:id/link", async (req, res) => {
  const id = Number(req.params.id);
  const { linkedDocType, linkedDocId } = req.body;
  const validDocTypes = ["sales_order", "purchase_order", "expense", "shipment", "payment", "invoice"];
  if (!linkedDocType || !validDocTypes.includes(linkedDocType)) {
    return res.status(400).json({ message: `linkedDocType harus salah satu dari: ${validDocTypes.join(", ")}` });
  }
  if (!linkedDocId || isNaN(Number(linkedDocId))) {
    return res.status(400).json({ message: "linkedDocId harus berupa angka" });
  }
  const [row] = await db
    .update(correspondencesTable)
    .set({ linkedDocType, linkedDocId: Number(linkedDocId), status: "linked" })
    .where(eq(correspondencesTable.id, id))
    .returning();
  if (!row) return res.status(404).json({ message: "Korespondensi tidak ditemukan" });
  return res.json(serializeCorrespondence(row));
});

// POST /api/correspondences/sync — manually trigger IMAP sync
router.post("/sync", async (req, res) => {
  if (!(await requireAdmin(req, res))) return;
  try {
    const result = await safeSyncImapEmails("manual");
    return res.json({ message: `Sinkronisasi selesai: ${result.synced} email baru`, ...result });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    return res.status(500).json({ message: "Sinkronisasi gagal", error: msg });
  }
});

export default router;
