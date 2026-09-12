import { Router } from "express";
import multer from "multer";

import { db, mediaAssetsTable } from "@workspace/db";
import { eq, desc, sql, inArray } from "drizzle-orm";
import { requireClerkUser, requireAdmin } from "../lib/requireAdmin";
import { uploadToSupabase, downloadFromSupabase, isSupabaseUrl, deleteFromSupabase } from "../lib/supabaseStorage";
import { logStorageEvent, getRequestIp, getActor } from "../lib/storageAuditLog";
import { writeAuditLog, extractRequestMeta } from "../lib/auditLog.js";
import {
  optimizeAndUploadMarketplaceImage,
  validateMarketplaceImage,
  MARKETPLACE_IMAGE_MAX_BYTES,
} from "../lib/imageOptimizer.js";

const router = Router();
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 20 * 1024 * 1024 } });
const uploadMarketplace = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: MARKETPLACE_IMAGE_MAX_BYTES },
});

router.use(async (req, res, next) => {
  if (!(await requireClerkUser(req, res))) return;
  next();
});

// GET /api/media/folders — daftar folder beserta jumlah gambar
router.get("/folders", async (_req, res) => {
  try {
    const rows = await db
      .select({
        folder: mediaAssetsTable.folder,
        count: sql<number>`cast(count(*) as int)`,
      })
      .from(mediaAssetsTable)
      .groupBy(mediaAssetsTable.folder)
      .orderBy(mediaAssetsTable.folder);
    res.json({ folders: rows });
  } catch (err: any) {
    console.error("[media/folders] Error:", err?.message ?? err);
    res.status(500).json({ error: err?.message ?? "Gagal mengambil daftar folder" });
  }
});

// GET /api/media — daftar semua gambar (opsional filter ?folder=xxx)
router.get("/", async (req, res) => {
  const folderFilter = req.query.folder as string | undefined;
  const query = db
    .select()
    .from(mediaAssetsTable)
    .orderBy(desc(mediaAssetsTable.createdAt));

  const items = folderFilter
    ? await db
        .select()
        .from(mediaAssetsTable)
        .where(eq(mediaAssetsTable.folder, folderFilter))
        .orderBy(desc(mediaAssetsTable.createdAt))
    : await query;

  res.json({ items });
});

const MEDIA_ALLOWED_MIME = new Set([
  "image/jpeg", "image/jpg", "image/png", "image/webp", "image/gif",
  "image/tiff", "image/bmp", "image/heic", "image/heif", "image/svg+xml",
  "application/pdf",
  "application/msword",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  "application/vnd.ms-excel",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
]);

// POST /api/media/upload — upload dan kompres gambar, simpan ke Supabase Storage
router.post("/upload", upload.single("file"), async (req, res): Promise<void> => {
  try {
    if (!req.file) {
      res.status(400).json({ error: "Tidak ada file yang diunggah" }); return;
    }

    const { mimetype, originalname } = req.file;

    if (!MEDIA_ALLOWED_MIME.has(mimetype)) {
      res.status(415).json({ error: `Tipe file tidak didukung: ${mimetype}. Gunakan gambar, PDF, atau dokumen Office.` }); return;
    }

    const folder = (req.body.folder as string)?.trim() || "Umum";
    const uploaded = await uploadToSupabase(req.file.buffer, mimetype, "uploads");

    const [inserted] = await db.insert(mediaAssetsTable).values({
      originalName: originalname,
      contentType: uploaded.contentType,
      sizeBytes: uploaded.sizeBytes,
      url: uploaded.publicUrl,
      objectPath: `supabase:media/${uploaded.storagePath}`,
      uploadedBy: (req as any).user?.email ?? null,
      folder,
      publicUrl: uploaded.publicUrl,
    }).returning();

    res.json({ ok: true, item: inserted });
  } catch (err: any) {
    console.error("[media/upload] Error:", err?.message ?? err);
    res.status(500).json({ error: err?.message ?? "Upload gagal" });
  }
});

// POST /api/media/marketplace-upload — upload + optimize gambar marketplace
// Pipeline: Validate → Thumbnail(300x300) + Medium(800x800) + Large(1600x1600) → WebP → Upload
// Auth: admin only (marketplace images bukan user content biasa)
const _mktplaceUploadMiddleware = (req: any, res: any, next: any) =>
  (uploadMarketplace.single("file") as any)(req, res, (err: any) => {
    if (err?.code === "LIMIT_FILE_SIZE") {
      return res.status(413).json({ error: "Ukuran file melebihi batas 5MB untuk gambar marketplace." });
    }
    next(err);
  });

router.post("/marketplace-upload", _mktplaceUploadMiddleware, async (req, res): Promise<void> => {
  try {
    if (!req.file) { res.status(400).json({ error: "Tidak ada file yang diunggah" }); return; }

    const { mimetype, originalname, buffer } = req.file;
    const folder = (req.body.folder as string)?.trim() || "marketplace";

    const validation = validateMarketplaceImage(buffer, mimetype, originalname);
    if (!validation.ok) {
      res.status(validation.status).json({ error: validation.message }); return;
    }

    const result = await optimizeAndUploadMarketplaceImage(buffer, mimetype, folder);

    const [inserted] = await db.insert(mediaAssetsTable).values({
      originalName: originalname,
      contentType: "image/webp",
      sizeBytes: result.variants.find(v => v.variantName === "large")?.sizeBytes ?? buffer.byteLength,
      url: result.webpUrl,
      objectPath: `supabase:media/${result.variants.find(v => v.variantName === "large")?.objectPath ?? ""}`,
      uploadedBy: (req as any).user?.email ?? null,
      folder,
      publicUrl: result.webpUrl,
    }).returning();

    res.json({
      ok: true,
      originalUrl: result.originalUrl,
      webpUrl: result.webpUrl,
      thumbnailUrl: result.thumbnailUrl,
      mediumUrl: result.mediumUrl,
      largeUrl: result.largeUrl,
      variants: result.variants,
      mediaAssetId: inserted.id,
    });
  } catch (err: any) {
    console.error("[media/marketplace-upload] Error:", err?.message ?? err);
    res.status(500).json({ error: err?.message ?? "Upload gagal" });
  }
});

// PATCH /api/media/folders/rename — rename folder (update semua gambar di folder lama)
router.patch("/folders/rename", async (req, res): Promise<void> => {
  const oldName = (req.body.oldName as string)?.trim();
  const newName = (req.body.newName as string)?.trim();
  if (!oldName || !newName) { res.status(400).json({ error: "oldName dan newName wajib diisi" }); return; }
  if (oldName === newName) { res.json({ ok: true, affected: 0 }); return; }
  const result = await db
    .update(mediaAssetsTable)
    .set({ folder: newName })
    .where(eq(mediaAssetsTable.folder, oldName));
  res.json({ ok: true, affected: (result as any).rowCount ?? 0 });
});

// DELETE /api/media/folders/:name — hapus folder, pindahkan isinya ke "Umum"
router.delete("/folders/:name", async (req, res): Promise<void> => {
  const name = decodeURIComponent(req.params.name).trim();
  if (!name || name === "Umum") {
    res.status(400).json({ error: "Folder ini tidak dapat dihapus" }); return;
  }
  const result = await db
    .update(mediaAssetsTable)
    .set({ folder: "Umum" })
    .where(eq(mediaAssetsTable.folder, name));
  res.json({ ok: true, moved: (result as any).rowCount ?? 0 });
});

// POST /api/media/bulk-move — pindahkan banyak gambar ke satu folder
router.post("/bulk-move", async (req, res): Promise<void> => {
  if (!(await requireAdmin(req, res))) return;
  const ids = (req.body.ids as number[]) ?? [];
  const folder = (req.body.folder as string)?.trim();
  if (!ids.length || !folder) { res.status(400).json({ error: "ids dan folder wajib diisi" }); return; }
  const moveMeta = extractRequestMeta(req);
  writeAuditLog({
    ...moveMeta, companyId: null, action: "BULK_OPERATION_VERIFIED", module: "media",
    newData: {
      operationType: "bulk-move", recordCount: ids.length,
      targetFolder: folder, timestamp: new Date().toISOString(),
    },
  });
  const result = await db
    .update(mediaAssetsTable)
    .set({ folder })
    .where(inArray(mediaAssetsTable.id, ids));
  res.json({ ok: true, affected: (result as any).rowCount ?? 0 });
});

// POST /api/media/bulk-delete — hapus banyak gambar sekaligus
router.post("/bulk-delete", async (req, res): Promise<void> => {
  if (!(await requireAdmin(req, res))) return;
  const ids = (req.body.ids as number[]) ?? [];
  if (!ids.length) { res.status(400).json({ error: "ids wajib diisi" }); return; }
  const delMeta = extractRequestMeta(req);
  writeAuditLog({
    ...delMeta, companyId: null, action: "BULK_OPERATION_VERIFIED", module: "media",
    newData: {
      operationType: "bulk-delete", recordCount: ids.length,
      timestamp: new Date().toISOString(),
    },
  });
  // Lookup storage paths before deletion so we can clean up Supabase objects
  const assets = await db
    .select({ id: mediaAssetsTable.id, objectPath: mediaAssetsTable.objectPath, publicUrl: mediaAssetsTable.publicUrl })
    .from(mediaAssetsTable)
    .where(inArray(mediaAssetsTable.id, ids));
  const result = await db.delete(mediaAssetsTable).where(inArray(mediaAssetsTable.id, ids));
  // Delete from Supabase Storage (non-fatal) after DB record is removed
  const actor = getActor(req);
  const ip = getRequestIp(req);
  for (const asset of assets) {
    if (asset.objectPath) {
      deleteFromSupabase(asset.objectPath).catch(() => {});
    }
    if (asset.publicUrl && asset.publicUrl !== asset.objectPath) {
      deleteFromSupabase(asset.publicUrl).catch(() => {});
    }
    logStorageEvent({
      action: "delete",
      entityType: "media_asset",
      entityId: asset.id,
      objectPath: asset.objectPath,
      actorId: actor.actorId,
      actorType: actor.actorType,
      ipAddress: ip,
      details: "bulk-delete",
    });
  }
  res.json({ ok: true, affected: (result as any).rowCount ?? 0 });
});

// PATCH /api/media/:id/folder — pindahkan gambar ke folder lain
router.patch("/:id/folder", async (req, res): Promise<void> => {
  const id = Number(req.params.id);
  if (!id) { res.status(400).json({ error: "ID tidak valid" }); return; }
  const folder = (req.body.folder as string)?.trim();
  if (!folder) { res.status(400).json({ error: "Nama folder wajib diisi" }); return; }

  // Ownership guard: only owner or admin may move an asset
  const [asset] = await db
    .select({ uploadedBy: mediaAssetsTable.uploadedBy })
    .from(mediaAssetsTable)
    .where(eq(mediaAssetsTable.id, id));
  if (!asset) { res.status(404).json({ error: "Asset tidak ditemukan" }); return; }
  const currentUserEmail = (req as any).user?.email ?? null;
  const isOwner = asset.uploadedBy && currentUserEmail && asset.uploadedBy === currentUserEmail;
  if (!isOwner) {
    const isAdm = await requireAdmin(req, res);
    if (!isAdm) return;
  }

  const [updated] = await db
    .update(mediaAssetsTable)
    .set({ folder })
    .where(eq(mediaAssetsTable.id, id))
    .returning();
  res.json({ ok: true, item: updated });
});

// POST /api/media/:id/copy-public — salin ke public storage, kembalikan URL absolut
router.post("/:id/copy-public", async (req, res): Promise<void> => {
  const id = Number(req.params.id);
  if (!id) { res.status(400).json({ error: "ID tidak valid" }); return; }

  try {
    const [asset] = await db.select().from(mediaAssetsTable).where(eq(mediaAssetsTable.id, id));
    if (!asset) { res.status(404).json({ error: "Asset tidak ditemukan" }); return; }

    // File Supabase sudah public — return URL langsung
    if (isSupabaseUrl(asset.url)) {
      if (!asset.publicUrl) {
        await db.update(mediaAssetsTable).set({ publicUrl: asset.url }).where(eq(mediaAssetsTable.id, id));
      }
      res.json({ ok: true, publicUrl: asset.url, cached: true }); return;
    }

    // Sudah punya publicUrl yang tersimpan — kembalikan langsung
    if (asset.publicUrl) {
      const baseUrl = `${req.protocol}://${req.get("host")}`;
      const absoluteUrl = asset.publicUrl.startsWith("http")
        ? asset.publicUrl
        : `${baseUrl}${asset.publicUrl}`;
      res.json({ ok: true, publicUrl: absoluteUrl, cached: true }); return;
    }

    // Legacy private object — download lalu re-upload ke Supabase public
    const baseUrl = `${req.protocol}://${req.get("host")}`;
    let fileBuffer: Buffer;
    if (asset.objectPath.startsWith("supabase:media/")) {
      const storagePath = asset.objectPath.replace("supabase:media/", "");
      fileBuffer = await downloadFromSupabase(storagePath);
    } else {
      const serveUrl = asset.url.startsWith("http") ? asset.url : `${baseUrl}${asset.url}`;
      const resp = await fetch(serveUrl, { headers: { cookie: req.headers.cookie ?? "" } });
      if (!resp.ok) throw new Error(`Gagal download file asal (${resp.status})`);
      fileBuffer = Buffer.from(await resp.arrayBuffer());
    }

    const { publicUrl } = await uploadToSupabase(fileBuffer, asset.contentType, "shared");

    await db.update(mediaAssetsTable).set({ publicUrl }).where(eq(mediaAssetsTable.id, id));
    res.json({ ok: true, publicUrl });
  } catch (err: any) {
    console.error("[media/copy-public] Error:", err?.message ?? err);
    res.status(500).json({ error: err?.message ?? "Gagal membuat URL publik" });
  }
});

// DELETE /api/media/:id — hapus metadata dari DB dan file dari storage
router.delete("/:id", async (req, res): Promise<void> => {
  const id = Number(req.params.id);
  if (!id) { res.status(400).json({ error: "ID tidak valid" }); return; }
  // Lookup storage paths before deletion so we can clean up Supabase objects
  const [asset] = await db
    .select({ objectPath: mediaAssetsTable.objectPath, publicUrl: mediaAssetsTable.publicUrl, uploadedBy: mediaAssetsTable.uploadedBy })
    .from(mediaAssetsTable)
    .where(eq(mediaAssetsTable.id, id));
  if (!asset) { res.status(404).json({ error: "Asset tidak ditemukan" }); return; }

  // Ownership guard: only owner or admin may delete an asset
  const currentUserEmail = (req as any).user?.email ?? null;
  const isOwner = asset.uploadedBy && currentUserEmail && asset.uploadedBy === currentUserEmail;
  if (!isOwner) {
    const isAdm = await requireAdmin(req, res);
    if (!isAdm) return;
  }

  await db.delete(mediaAssetsTable).where(eq(mediaAssetsTable.id, id));
  // Delete from Supabase Storage (non-fatal) after DB record is removed
  if (asset?.objectPath) {
    deleteFromSupabase(asset.objectPath).catch(() => {});
  }
  if (asset?.publicUrl && asset.publicUrl !== asset.objectPath) {
    deleteFromSupabase(asset.publicUrl).catch(() => {});
  }
  if (asset) {
    const actor = getActor(req);
    logStorageEvent({
      action: "delete",
      entityType: "media_asset",
      entityId: id,
      objectPath: asset.objectPath,
      actorId: actor.actorId,
      actorType: actor.actorType,
      ipAddress: getRequestIp(req),
    });
  }
  res.json({ ok: true });
});

export default router;
