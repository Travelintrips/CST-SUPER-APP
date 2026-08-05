import { Router } from "express";
import multer from "multer";
import { db, productMediaTable, vendorCatalogItemsTable, suppliersTable } from "@workspace/db";
import { eq, and, asc, desc, inArray, isNull, ne, sql } from "drizzle-orm";
import { requireClerkUser } from "../lib/requireAdmin.js";
import { uploadToSupabase, deleteFromSupabase } from "../lib/supabaseStorage.js";
import { compressImageBuffer, isCompressibleImage } from "../lib/imageCompress.js";
import {
  generateSingleImage,
  generateImagesForItem,
  type CatalogItemData,
} from "../lib/aiImageGenerator.js";
import { getOpenAI } from "../lib/openaiClient.js";
import {
  validateVideo,
  optimizeAndUploadVideo,
  VIDEO_MAX_BYTES,
} from "../lib/videoOptimizer.js";

const router = Router();

const IMAGE_MIME = new Set(["image/jpeg", "image/jpg", "image/png", "image/webp"]);
const VIDEO_MIME = new Set(["video/mp4", "video/webm", "video/quicktime"]);
const IMAGE_MAX = 5 * 1024 * 1024;
const VIDEO_MAX = 50 * 1024 * 1024;

const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: VIDEO_MAX } });
const uploadVideo = multer({ storage: multer.memoryStorage(), limits: { fileSize: VIDEO_MAX_BYTES } });

function actor(req: any) {
  const u = req.user as { email?: string; role?: string } | undefined;
  return { email: u?.email ?? "ai-system", role: u?.role ?? "system" };
}

// ─────────────────────────────────────────────────────────────────────────────
// GET /api/product-media/item/:id  — public, approved/non-AI only
// ─────────────────────────────────────────────────────────────────────────────
router.get("/item/:vendorCatalogItemId", async (req, res): Promise<void> => {
  const itemId = parseInt(String(req.params.vendorCatalogItemId));
  if (isNaN(itemId)) { res.status(400).json({ error: "Invalid id" }); return; }
  try {
    const media = await db.execute(sql`
      SELECT * FROM product_media
      WHERE vendor_catalog_item_id = ${itemId}
        AND is_active = true
        AND (image_source IS NULL OR image_source != 'ai' OR ai_image_status = 'approved')
        AND (media_type != 'document' OR visibility IS NULL OR visibility = 'public')
      ORDER BY sort_order ASC, created_at ASC
    `);
    res.json({ media });
  } catch (e: any) { res.status(500).json({ error: e?.message }); }
});

// ─────────────────────────────────────────────────────────────────────────────
// GET /api/product-media/admin/item/:id — auth, all records
// ─────────────────────────────────────────────────────────────────────────────
router.get("/admin/item/:vendorCatalogItemId", async (req, res): Promise<void> => {
  if (!(await requireClerkUser(req, res))) return;
  const itemId = parseInt(String(req.params.vendorCatalogItemId));
  if (isNaN(itemId)) { res.status(400).json({ error: "Invalid id" }); return; }
  try {
    const media = await db.select().from(productMediaTable)
      .where(eq(productMediaTable.vendorCatalogItemId, itemId))
      .orderBy(asc(productMediaTable.sortOrder), asc(productMediaTable.createdAt));
    res.json({ media });
  } catch (e: any) { res.status(500).json({ error: e?.message }); }
});

// ─────────────────────────────────────────────────────────────────────────────
// GET /api/product-media/generation-status
// ─────────────────────────────────────────────────────────────────────────────
router.get("/generation-status", async (req, res): Promise<void> => {
  if (!(await requireClerkUser(req, res))) return;
  try {
    const rows = await db.execute(sql`
      SELECT
        vci.id, vci.name, vci.template_kind, vci.description, vci.spec_values,
        vci.kategori, vci.service_type, vci.origin, vci.is_published, vci.vendor_id,
        s.name AS vendor_name, s.service_type AS vendor_service_type,
        COUNT(pm.id) FILTER (WHERE pm.is_active = true)                                              AS media_count,
        COUNT(pm.id) FILTER (WHERE pm.is_active = true AND pm.image_source = 'vendor')               AS vendor_count,
        COUNT(pm.id) FILTER (WHERE pm.is_active = true AND pm.image_source = 'ai')                   AS ai_count,
        COUNT(pm.id) FILTER (WHERE pm.is_active = true AND pm.ai_image_status = 'waiting_approval')  AS pending_count,
        COUNT(pm.id) FILTER (WHERE pm.is_active = true AND pm.ai_image_status = 'approved')          AS approved_count,
        MAX(pm.file_url)    FILTER (WHERE pm.is_active = true AND (pm.image_source != 'ai' OR pm.ai_image_status = 'approved') AND pm.is_primary = true) AS primary_image_url,
        MAX(pm.created_at)  FILTER (WHERE pm.is_active = true)                                       AS last_generated_at
      FROM vendor_catalog_items vci
      LEFT JOIN suppliers s ON s.id = vci.vendor_id
      LEFT JOIN product_media pm ON pm.vendor_catalog_item_id = vci.id
      GROUP BY vci.id, vci.name, vci.template_kind, vci.description, vci.spec_values,
               vci.kategori, vci.service_type, vci.origin, vci.is_published, vci.vendor_id,
               s.name, s.service_type
      ORDER BY vci.is_published DESC, vci.id
    `);

    const items = ((rows as any).rows as any[]).map((r: any) => ({
      id: r.id,
      name: r.name,
      templateKind: r.template_kind,
      description: r.description,
      specValues: r.spec_values,
      kategori: r.kategori,
      serviceType: r.service_type,
      origin: r.origin,
      isPublished: r.is_published,
      vendorId: r.vendor_id,
      vendorName: r.vendor_name,
      vendorServiceType: r.vendor_service_type,
      mediaCount: parseInt(r.media_count ?? "0"),
      vendorCount: parseInt(r.vendor_count ?? "0"),
      aiCount: parseInt(r.ai_count ?? "0"),
      pendingCount: parseInt(r.pending_count ?? "0"),
      approvedCount: parseInt(r.approved_count ?? "0"),
      primaryImageUrl: r.primary_image_url ?? null,
      lastGeneratedAt: r.last_generated_at ?? null,
      hasVendorImage: parseInt(r.vendor_count ?? "0") > 0,
      hasApprovedImage: parseInt(r.approved_count ?? "0") > 0,
      hasPending: parseInt(r.pending_count ?? "0") > 0,
    }));

    const total = items.length;
    const withImage = items.filter((i) => i.hasApprovedImage || i.hasVendorImage).length;
    const withoutImage = items.filter((i) => !i.hasApprovedImage && !i.hasVendorImage && !i.hasPending).length;
    const pendingApproval = items.filter((i) => i.hasPending).length;

    res.json({ items, stats: { total, withImage, withoutImage, pendingApproval } });
  } catch (e: any) {
    res.status(500).json({ error: e?.message });
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// GET /api/product-media/approval-queue
// ─────────────────────────────────────────────────────────────────────────────
router.get("/approval-queue", async (req, res): Promise<void> => {
  if (!(await requireClerkUser(req, res))) return;
  try {
    const pendingImages = await db.execute(sql`
      SELECT pm.*, vci.name AS item_name, vci.template_kind, vci.is_published,
             vci.service_type, s.name AS vendor_name
      FROM product_media pm
      JOIN vendor_catalog_items vci ON vci.id = pm.vendor_catalog_item_id
      LEFT JOIN suppliers s ON s.id = vci.vendor_id
      WHERE pm.ai_image_status = 'waiting_approval'
        AND pm.is_active = true
      ORDER BY vci.is_published DESC, pm.vendor_catalog_item_id, pm.created_at
    `) as unknown as any[];

    const byItem: Record<number, {
      itemId: number; itemName: string; templateKind: string; isPublished: boolean;
      serviceType: string | null; vendorName: string | null; images: any[];
    }> = {};

    for (const img of pendingImages) {
      const itemId = Number(img.vendor_catalog_item_id);
      if (!byItem[itemId]) {
        byItem[itemId] = {
          itemId,
          itemName: img.item_name,
          templateKind: img.template_kind,
          isPublished: img.is_published,
          serviceType: img.service_type,
          vendorName: img.vendor_name,
          images: [],
        };
      }
      byItem[itemId].images.push({
        id: img.id,
        fileUrl: img.file_url,
        aiImageStatus: img.ai_image_status,
        imageSource: img.image_source,
        generationPrompt: img.generation_prompt,
        isPrimary: img.is_primary,
        createdAt: img.created_at,
      });
    }

    const queue = Object.values(byItem);
    res.json({ queue, totalItems: queue.length, totalImages: pendingImages.length });
  } catch (e: any) {
    res.status(500).json({ error: e?.message });
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// POST /api/product-media/upload
// ─────────────────────────────────────────────────────────────────────────────
router.post("/upload", upload.single("file"), async (req, res): Promise<void> => {
  if (!(await requireClerkUser(req, res))) return;
  if (!req.file) { res.status(400).json({ error: "Tidak ada file" }); return; }
  const { mimetype } = req.file;
  const isImage = IMAGE_MIME.has(mimetype);
  const isVideo = VIDEO_MIME.has(mimetype);
  if (!isImage && !isVideo) { res.status(415).json({ error: `Tipe tidak didukung: ${mimetype}` }); return; }
  if (isImage && req.file.buffer.byteLength > IMAGE_MAX) { res.status(413).json({ error: "Foto maks 5 MB" }); return; }
  if (isVideo && req.file.buffer.byteLength > VIDEO_MAX) { res.status(413).json({ error: "Video maks 50 MB" }); return; }

  const vendorCatalogItemId = req.body.vendorCatalogItemId ? parseInt(req.body.vendorCatalogItemId) : null;
  const vendorId = req.body.vendorId ? parseInt(req.body.vendorId) : null;
  const isPrimary = req.body.isPrimary === "true";
  const imageSource = (req.body.imageSource === "vendor") ? "vendor" : "admin";
  if (!vendorCatalogItemId) { res.status(400).json({ error: "vendorCatalogItemId wajib" }); return; }

  try {
    let buffer = req.file.buffer;
    let mime = mimetype;
    if (isImage && isCompressibleImage(mimetype)) {
      const c = await compressImageBuffer(buffer, mimetype, "photo");
      buffer = c.buffer; mime = c.contentType;
    }
    const folder = isImage ? "product-media/images" : "product-media/videos";
    const { publicUrl, storagePath } = await uploadToSupabase(buffer, mime, folder);

    if (isPrimary) {
      await db.update(productMediaTable).set({ isPrimary: false, updatedAt: new Date() })
        .where(and(eq(productMediaTable.vendorCatalogItemId, vendorCatalogItemId), eq(productMediaTable.isPrimary, true)));
    }
    const a = actor(req);
    const [inserted] = await db.insert(productMediaTable).values({
      vendorCatalogItemId, vendorId, mediaType: isImage ? "image" : "video",
      fileUrl: publicUrl, storagePath, isPrimary, isActive: true,
      uploadedBy: a.email, uploadedByRole: a.role, sortOrder: 0,
      imageSource,
      aiImageStatus: null,
    }).returning();
    res.status(201).json({ media: inserted });
  } catch (e: any) { res.status(500).json({ error: e?.message }); }
});

// ─────────────────────────────────────────────────────────────────────────────
// POST /api/product-media/upload-video
//
// Video Optimization Engine Pipeline:
//   validate → compress (H.264 CRF28) → thumbnail → upload → REPORT
//
// Allowed:  mp4, mov
// Max:      100 MB
// Generates: thumbnailUrl (640×360 JPEG)
// Stores:   videoUrl, thumbnailUrl, duration, fileSizeBytes
// ─────────────────────────────────────────────────────────────────────────────
router.post(
  "/upload-video",
  (req: any, res: any, next: any) =>
    (uploadVideo.single("file") as any)(req, res, (err: any) => {
      if (err?.code === "LIMIT_FILE_SIZE") {
        return res.status(413).json({ error: "Ukuran video melebihi batas 100 MB." });
      }
      next(err);
    }),
  async (req: any, res: any): Promise<void> => {
    if (!(await requireClerkUser(req, res))) return;
    if (!req.file) { res.status(400).json({ error: "Tidak ada file yang diunggah." }); return; }

    const validation = validateVideo(req.file.buffer, req.file.mimetype, req.file.originalname);
    if (!validation.ok) {
      res.status(validation.status ?? 400).json({ error: validation.errorMessage }); return;
    }

    const vendorCatalogItemId = req.body.vendorCatalogItemId
      ? parseInt(req.body.vendorCatalogItemId) : null;
    const vendorId = req.body.vendorId ? parseInt(req.body.vendorId) : null;
    const isPrimary = req.body.isPrimary === "true";
    const imageSource = req.body.imageSource === "vendor" ? "vendor" : "admin";

    if (!vendorCatalogItemId) {
      res.status(400).json({ error: "vendorCatalogItemId wajib diisi." }); return;
    }

    const pipelineStart = Date.now();

    try {
      // Run full optimization pipeline
      const report = await optimizeAndUploadVideo(
        req.file.buffer,
        req.file.mimetype,
        "product-media/videos",
      );

      // If setting as primary, unset others first
      if (isPrimary) {
        await db
          .update(productMediaTable)
          .set({ isPrimary: false, updatedAt: new Date() })
          .where(
            and(
              eq(productMediaTable.vendorCatalogItemId, vendorCatalogItemId),
              eq(productMediaTable.isPrimary, true),
            ),
          );
      }

      const a = actor(req);
      const [inserted] = await db
        .insert(productMediaTable)
        .values({
          vendorCatalogItemId,
          vendorId,
          mediaType: "video",
          fileUrl: report.videoUrl,
          thumbnailUrl: report.thumbnailUrl,
          storagePath: report.videoStoragePath,
          isPrimary,
          isActive: true,
          uploadedBy: a.email,
          uploadedByRole: a.role,
          sortOrder: 0,
          imageSource,
          aiImageStatus: null,
          duration: Math.round(report.compressed.durationSec),
          fileSizeBytes: report.compressed.fileSizeBytes,
        } as any)
        .returning();

      const totalMs = Date.now() - pipelineStart;

      // ── VIDEO OPTIMIZATION REPORT ─────────────────────────────────────────
      res.status(201).json({
        ok: true,
        media: inserted,
        report: {
          title: "VIDEO OPTIMIZATION REPORT",
          generatedAt: new Date().toISOString(),
          pipeline: ["validate", "probe", "compress", "thumbnail", "upload"],

          input: {
            originalName: req.file.originalname,
            mimeType: report.original.mime,
            extension: report.original.ext,
            fileSizeBytes: report.original.fileSizeBytes,
            fileSizeMb: +(report.original.fileSizeBytes / 1024 / 1024).toFixed(2),
          },

          video: {
            url: report.videoUrl,
            storagePath: report.videoStoragePath,
            fileSizeBytes: report.compressed.fileSizeBytes,
            fileSizeMb: +(report.compressed.fileSizeBytes / 1024 / 1024).toFixed(2),
            durationSec: report.compressed.durationSec,
            width: report.compressed.width,
            height: report.compressed.height,
            codec: report.compressed.codec,
            bitrateKbps: report.compressed.bitrateKbps,
          },

          thumbnail: {
            url: report.thumbnailUrl,
            storagePath: report.thumbnailStoragePath,
            fileSizeBytes: report.thumbnail.fileSizeBytes,
            timestampSec: report.thumbnail.timestampSec,
            width: report.thumbnail.width,
            height: report.thumbnail.height,
            format: "JPEG",
          },

          optimization: {
            originalSizeBytes: report.original.fileSizeBytes,
            compressedSizeBytes: report.compressed.fileSizeBytes,
            savedBytes: report.compressed.savedBytes,
            savedMb: +(report.compressed.savedBytes / 1024 / 1024).toFixed(2),
            compressionRatioPct: report.compressed.compressionRatioPct,
            status: report.compressed.compressionRatioPct > 0 ? "compressed" : "already_optimal",
          },

          timing: {
            ...report.timingMs,
            totalMs,
          },
        },
      });
    } catch (e: any) {
      console.error("[product-media/upload-video] Error:", e?.message ?? e);
      res.status(500).json({ error: e?.message ?? "Video upload gagal" });
    }
  },
);

// ─────────────────────────────────────────────────────────────────────────────
// POST /api/product-media/link
// ─────────────────────────────────────────────────────────────────────────────
router.post("/link", async (req, res): Promise<void> => {
  if (!(await requireClerkUser(req, res))) return;
  const { vendorCatalogItemId: rawId, vendorId: rawVid, externalUrl, title, isPrimary } = req.body;
  const vendorCatalogItemId = rawId ? parseInt(rawId) : null;
  const vendorId = rawVid ? parseInt(rawVid) : null;
  if (!vendorCatalogItemId) { res.status(400).json({ error: "vendorCatalogItemId wajib" }); return; }
  if (!externalUrl || !/^https?:\/\//.test(externalUrl)) { res.status(400).json({ error: "URL tidak valid" }); return; }
  try {
    const a = actor(req);
    const [ins] = await db.insert(productMediaTable).values({
      vendorCatalogItemId, vendorId, mediaType: "video_link",
      externalUrl: externalUrl.trim(), title: title?.trim() ?? null,
      isPrimary: isPrimary === true || isPrimary === "true",
      isActive: true, uploadedBy: a.email, uploadedByRole: a.role, sortOrder: 0,
      imageSource: "admin",
    }).returning();
    res.status(201).json({ media: ins });
  } catch (e: any) { res.status(500).json({ error: e?.message }); }
});

// ─────────────────────────────────────────────────────────────────────────────
// PUT /api/product-media/:id
// ─────────────────────────────────────────────────────────────────────────────
router.put("/:id", async (req, res): Promise<void> => {
  if (!(await requireClerkUser(req, res))) return;
  const id = parseInt(String(req.params.id));
  if (isNaN(id)) { res.status(400).json({ error: "Invalid id" }); return; }
  const { title, description, isActive, visibility, documentType } = req.body;
  const update: Record<string, unknown> = { updatedAt: new Date() };
  if (title !== undefined) update.title = title?.trim() ?? null;
  if (description !== undefined) update.description = description?.trim() ?? null;
  if (isActive !== undefined) update.isActive = isActive === true || isActive === "true";
  if (visibility !== undefined) update.visibility = visibility?.trim() ?? "public";
  if (documentType !== undefined) update.documentType = documentType?.trim() ?? null;
  try {
    const [updated] = await db.update(productMediaTable).set(update as any)
      .where(eq(productMediaTable.id, id)).returning();
    if (!updated) { res.status(404).json({ error: "Tidak ditemukan" }); return; }
    res.json({ media: updated });
  } catch (e: any) { res.status(500).json({ error: e?.message }); }
});

// ─────────────────────────────────────────────────────────────────────────────
// DELETE /api/product-media/:id
// ─────────────────────────────────────────────────────────────────────────────
router.delete("/:id", async (req, res): Promise<void> => {
  if (!(await requireClerkUser(req, res))) return;
  const id = parseInt(String(req.params.id));
  if (isNaN(id)) { res.status(400).json({ error: "Invalid id" }); return; }
  try {
    const [found] = await db.select().from(productMediaTable).where(eq(productMediaTable.id, id));
    if (!found) { res.status(404).json({ error: "Tidak ditemukan" }); return; }
    if (found.storagePath) await deleteFromSupabase(found.storagePath);
    await db.delete(productMediaTable).where(eq(productMediaTable.id, id));
    res.json({ success: true });
  } catch (e: any) { res.status(500).json({ error: e?.message }); }
});

// ─────────────────────────────────────────────────────────────────────────────
// POST /api/product-media/:id/set-primary
// ─────────────────────────────────────────────────────────────────────────────
router.post("/:id/set-primary", async (req, res): Promise<void> => {
  if (!(await requireClerkUser(req, res))) return;
  const id = parseInt(String(req.params.id));
  if (isNaN(id)) { res.status(400).json({ error: "Invalid id" }); return; }
  try {
    const [found] = await db.select().from(productMediaTable).where(eq(productMediaTable.id, id));
    if (!found) { res.status(404).json({ error: "Tidak ditemukan" }); return; }
    if (found.vendorCatalogItemId) {
      await db.update(productMediaTable).set({ isPrimary: false, updatedAt: new Date() })
        .where(and(eq(productMediaTable.vendorCatalogItemId, found.vendorCatalogItemId), eq(productMediaTable.isPrimary, true)));
    }
    const [updated] = await db.update(productMediaTable)
      .set({ isPrimary: true, updatedAt: new Date() }).where(eq(productMediaTable.id, id)).returning();
    res.json({ media: updated });
  } catch (e: any) { res.status(500).json({ error: e?.message }); }
});

// ─────────────────────────────────────────────────────────────────────────────
// POST /api/product-media/:id/approve
// ─────────────────────────────────────────────────────────────────────────────
router.post("/:id/approve", async (req, res): Promise<void> => {
  if (!(await requireClerkUser(req, res))) return;
  const id = parseInt(String(req.params.id));
  if (isNaN(id)) { res.status(400).json({ error: "Invalid id" }); return; }
  try {
    const [found] = await db.select().from(productMediaTable).where(eq(productMediaTable.id, id));
    if (!found) { res.status(404).json({ error: "Tidak ditemukan" }); return; }

    // Jika belum ada primary image yang approved untuk item ini, jadikan ini primary
    const hasApprovedPrimary = found.vendorCatalogItemId
      ? await db.execute(sql`
          SELECT id FROM product_media
          WHERE vendor_catalog_item_id = ${found.vendorCatalogItemId}
            AND is_primary = true
            AND is_active = true
            AND (image_source != 'ai' OR ai_image_status = 'approved')
            AND id != ${id}
          LIMIT 1
        `)
      : [];

    const shouldBePrimary = Array.isArray(hasApprovedPrimary) && hasApprovedPrimary.length === 0;

    const [updated] = await db.update(productMediaTable)
      .set({
        aiImageStatus: "approved",
        isPrimary: shouldBePrimary,
        updatedAt: new Date(),
      })
      .where(eq(productMediaTable.id, id))
      .returning();

    res.json({ media: updated });
  } catch (e: any) { res.status(500).json({ error: e?.message }); }
});

// ─────────────────────────────────────────────────────────────────────────────
// POST /api/product-media/:id/reject
// ─────────────────────────────────────────────────────────────────────────────
router.post("/:id/reject", async (req, res): Promise<void> => {
  if (!(await requireClerkUser(req, res))) return;
  const id = parseInt(String(req.params.id));
  if (isNaN(id)) { res.status(400).json({ error: "Invalid id" }); return; }
  try {
    const [updated] = await db.update(productMediaTable)
      .set({ aiImageStatus: "rejected", isActive: false, isPrimary: false, updatedAt: new Date() })
      .where(eq(productMediaTable.id, id))
      .returning();
    if (!updated) { res.status(404).json({ error: "Tidak ditemukan" }); return; }
    res.json({ media: updated });
  } catch (e: any) { res.status(500).json({ error: e?.message }); }
});

// ─────────────────────────────────────────────────────────────────────────────
// POST /api/product-media/:id/approve-all  — approve semua gambar waiting untuk item ini
// ─────────────────────────────────────────────────────────────────────────────
router.post("/:itemId/approve-all", async (req, res): Promise<void> => {
  if (!(await requireClerkUser(req, res))) return;
  const itemId = parseInt(String(req.params.itemId));
  if (isNaN(itemId)) { res.status(400).json({ error: "Invalid id" }); return; }
  try {
    await db.execute(sql`
      UPDATE product_media
      SET ai_image_status = 'approved', updated_at = NOW()
      WHERE vendor_catalog_item_id = ${itemId}
        AND ai_image_status = 'waiting_approval'
        AND is_active = true
    `);
    // Set first approved as primary if none
    await db.execute(sql`
      UPDATE product_media
      SET is_primary = true, updated_at = NOW()
      WHERE id = (
        SELECT id FROM product_media
        WHERE vendor_catalog_item_id = ${itemId}
          AND ai_image_status = 'approved'
          AND is_active = true
        ORDER BY created_at ASC
        LIMIT 1
      )
      AND NOT EXISTS (
        SELECT 1 FROM product_media
        WHERE vendor_catalog_item_id = ${itemId}
          AND is_primary = true
          AND is_active = true
          AND (image_source != 'ai' OR ai_image_status = 'approved')
      )
    `);
    res.json({ success: true });
  } catch (e: any) { res.status(500).json({ error: e?.message }); }
});

// ─────────────────────────────────────────────────────────────────────────────
// POST /api/product-media/generate-ai  — single item, 4 images
// ─────────────────────────────────────────────────────────────────────────────
router.post("/generate-ai", async (req, res): Promise<void> => {
  if (!(await requireClerkUser(req, res))) return;
  const {
    productName, vendorCatalogItemId: rawId, vendorId: rawVid,
    description, specValues, origin, templateKind, serviceType, kategori, vendorName, vendorServiceType,
    count: rawCount,
  } = req.body;
  const vendorCatalogItemId = rawId ? parseInt(rawId) : null;
  const vendorId = rawVid ? parseInt(rawVid) : null;
  const count = Math.min(parseInt(rawCount ?? "4") || 4, 4);
  if (!vendorCatalogItemId) { res.status(400).json({ error: "vendorCatalogItemId wajib" }); return; }
  if (!productName?.trim()) { res.status(400).json({ error: "productName wajib" }); return; }

  const item: CatalogItemData = {
    id: vendorCatalogItemId,
    name: productName.trim(),
    templateKind: templateKind ?? null,
    description: description?.trim() ?? null,
    specValues: specValues ?? null,
    kategori: kategori ?? null,
    serviceType: serviceType ?? null,
    origin: origin ?? null,
    vendorId,
    vendorName: vendorName ?? null,
    vendorServiceType: vendorServiceType ?? null,
  };

  try {
    const a = actor(req);
    const results = await generateImagesForItem({ item, uploadedBy: a.email, uploadedByRole: a.role, count });
    const succeeded = results.filter((r) => r.success);
    const failed = results.filter((r) => !r.success);
    res.status(201).json({ generated: succeeded.length, failed: failed.length, results });
  } catch (e: any) {
    res.status(500).json({ error: e?.message ?? "Gagal generate gambar" });
  }
});

// ─── AI Generation helpers ────────────────────────────────────────────────────

async function generateAiImageForItem(
  item: { id: number; name: string; vendorId?: number | null; kategori?: string | null; description?: string | null },
  actorEmail: string,
  actorRole: string,
): Promise<{ fileUrl: string; storagePath: string }> {
  const prompt = [
    `Professional B2B marketplace product photography for a logistics and international trading platform.`,
    `Product name: ${item.name.trim()}.`,
    item.kategori?.trim() ? `Category: ${item.kategori.trim()}.` : "",
    item.description?.trim() ? `Description: ${item.description.trim()}.` : "",
    `Style: Commercial product photography, ultra realistic, marketplace quality, professional lighting, sharp focus, high detail, premium B2B catalog image.`,
    `The product must be centered as the main subject. Clean, modern, professional background. Realistic lighting and high quality. No text, no watermarks, no logos, no writing of any kind.`,
    `Square 1:1 ratio. High resolution. Suitable for logistics and international trade marketplace.`,
  ].filter(Boolean).join(" ");

  const openai = getOpenAI();
  const response = await openai.images.generate({
    model: "dall-e-3",
    prompt,
    n: 1,
    size: "1024x1024",
    quality: "standard",
    response_format: "b64_json",
  });

  const b64 = response.data?.[0]?.b64_json;
  if (!b64) throw new Error("Model tidak mengembalikan gambar");

  const buffer = Buffer.from(b64, "base64");
  const { publicUrl, storagePath } = await uploadToSupabase(buffer, "image/png", "product-media/images");
  return { fileUrl: publicUrl, storagePath };
}

// GET /api/product-media/generation-status
router.get("/generation-status", async (req, res): Promise<void> => {
  if (!(await requireClerkUser(req, res))) return;
  try {
    const items = await db
      .select({
        id: vendorCatalogItemsTable.id,
        name: vendorCatalogItemsTable.name,
        vendorId: vendorCatalogItemsTable.vendorId,
        vendorName: suppliersTable.name,
        kategori: vendorCatalogItemsTable.kategori,
        type: vendorCatalogItemsTable.type,
        isPublished: vendorCatalogItemsTable.isPublished,
        description: vendorCatalogItemsTable.description,
      })
      .from(vendorCatalogItemsTable)
      .leftJoin(suppliersTable, eq(vendorCatalogItemsTable.vendorId, suppliersTable.id))
      .where(eq(vendorCatalogItemsTable.isActive, true));

    const itemIds = items.map((i) => i.id);
    const allMedia =
      itemIds.length > 0
        ? await db
            .select()
            .from(productMediaTable)
            .where(
              and(
                inArray(productMediaTable.vendorCatalogItemId, itemIds),
                eq(productMediaTable.isActive, true),
                eq(productMediaTable.mediaType, "image"),
              ),
            )
        : [];

    const mediaByItem = new Map<number, typeof allMedia>();
    for (const m of allMedia) {
      const k = m.vendorCatalogItemId!;
      if (!mediaByItem.has(k)) mediaByItem.set(k, []);
      mediaByItem.get(k)!.push(m);
    }

    const result = items.map((item) => {
      const media = mediaByItem.get(item.id) ?? [];
      const primary = media.find((m) => m.isPrimary) ?? media[0] ?? null;
      return {
        ...item,
        mediaCount: media.length,
        hasImage: media.length > 0,
        primaryImageUrl: primary?.fileUrl ?? null,
        lastGeneratedAt: primary?.createdAt ?? null,
      };
    });

    const withImage = result.filter((i) => i.hasImage).length;
    res.json({
      total: result.length,
      withImage,
      withoutImage: result.length - withImage,
      items: result,
    });
  } catch (e: any) {
    res.status(500).json({ error: e?.message });
  }
});

// POST /api/product-media/bulk-generate-ai
router.post("/bulk-generate-ai", async (req, res): Promise<void> => {
  if (!(await requireClerkUser(req, res))) return;
  const { limit = 10, onlyPublished = false, force = false } = req.body;

  try {
    const conditions: any[] = [eq(vendorCatalogItemsTable.isActive, true)];
    if (onlyPublished) conditions.push(eq(vendorCatalogItemsTable.isPublished, true));

    const allItems = await db
      .select({
        id: vendorCatalogItemsTable.id,
        name: vendorCatalogItemsTable.name,
        vendorId: vendorCatalogItemsTable.vendorId,
        kategori: vendorCatalogItemsTable.kategori,
        description: vendorCatalogItemsTable.description,
      })
      .from(vendorCatalogItemsTable)
      .where(and(...conditions));

    let candidates = allItems;
    if (!force) {
      const itemIds = allItems.map((i) => i.id);
      const existingMedia =
        itemIds.length > 0
          ? await db
              .select({ vendorCatalogItemId: productMediaTable.vendorCatalogItemId })
              .from(productMediaTable)
              .where(
                and(
                  inArray(productMediaTable.vendorCatalogItemId, itemIds),
                  eq(productMediaTable.isActive, true),
                  eq(productMediaTable.mediaType, "image"),
                ),
              )
          : [];
      const withImageIds = new Set(existingMedia.map((m) => m.vendorCatalogItemId!));
      candidates = allItems.filter((i) => !withImageIds.has(i.id));
    }

    const batch = candidates.slice(0, Math.min(Number(limit), 50));
    const a = actor(req);
    const results: Array<{ id: number; name: string; success: boolean; error?: string }> = [];

    for (const item of batch) {
      try {
        if (force) {
          await db
            .update(productMediaTable)
            .set({ isActive: false, updatedAt: new Date() })
            .where(
              and(
                eq(productMediaTable.vendorCatalogItemId, item.id),
                eq(productMediaTable.mediaType, "image"),
              ),
            );
        }
        const { fileUrl, storagePath } = await generateAiImageForItem(item, a.email, a.role);
        await db.insert(productMediaTable).values({
          vendorCatalogItemId: item.id,
          vendorId: item.vendorId,
          mediaType: "image",
          fileUrl,
          storagePath,
          isPrimary: true,
          isActive: true,
          title: `AI — ${item.name.trim()}`,
          uploadedBy: a.email,
          uploadedByRole: a.role,
          sortOrder: 0,
        });
        results.push({ id: item.id, name: item.name, success: true });
      } catch (e: any) {
        results.push({ id: item.id, name: item.name, success: false, error: e?.message });
      }
    }

    res.json({
      processed: results.length,
      success: results.filter((r) => r.success).length,
      failed: results.filter((r) => !r.success).length,
      results,
    });
  } catch (e: any) {
    res.status(500).json({ error: e?.message });
  }
});

// POST /api/product-media/regenerate-ai/:id  (id = vendor_catalog_item id)
router.post("/regenerate-ai/:id", async (req, res): Promise<void> => {
  if (!(await requireClerkUser(req, res))) return;
  const itemId = parseInt(String(req.params.id));
  if (isNaN(itemId)) { res.status(400).json({ error: "Invalid id" }); return; }

  try {
    const [item] = await db
      .select({
        id: vendorCatalogItemsTable.id,
        name: vendorCatalogItemsTable.name,
        vendorId: vendorCatalogItemsTable.vendorId,
        kategori: vendorCatalogItemsTable.kategori,
        description: vendorCatalogItemsTable.description,
      })
      .from(vendorCatalogItemsTable)
      .where(eq(vendorCatalogItemsTable.id, itemId));

    if (!item) { res.status(404).json({ error: "Item tidak ditemukan" }); return; }

    await db
      .update(productMediaTable)
      .set({ isActive: false, isPrimary: false, updatedAt: new Date() })
      .where(
        and(
          eq(productMediaTable.vendorCatalogItemId, itemId),
          eq(productMediaTable.mediaType, "image"),
        ),
      );

    const a = actor(req);
    const { fileUrl, storagePath } = await generateAiImageForItem(item, a.email, a.role);

    const [inserted] = await db
      .insert(productMediaTable)
      .values({
        vendorCatalogItemId: item.id,
        vendorId: item.vendorId,
        mediaType: "image",
        fileUrl,
        storagePath,
        isPrimary: true,
        isActive: true,
        title: `AI — ${item.name.trim()}`,
        uploadedBy: a.email,
        uploadedByRole: a.role,
        sortOrder: 0,
      })
      .returning();

    res.status(201).json({ media: inserted });
  } catch (e: any) {
    res.status(500).json({ error: e?.message ?? "Gagal regenerate gambar" });
  }
});

// POST /api/product-media/reorder
// ─────────────────────────────────────────────────────────────────────────────
router.post("/reorder", async (req, res): Promise<void> => {
  if (!(await requireClerkUser(req, res))) return;
  const { order } = req.body as { order: Array<{ id: number; sortOrder: number }> };
  if (!Array.isArray(order)) { res.status(400).json({ error: "order harus array" }); return; }
  try {
    for (const item of order) {
      await db.update(productMediaTable).set({ sortOrder: item.sortOrder, updatedAt: new Date() })
        .where(eq(productMediaTable.id, item.id));
    }
    res.json({ success: true });
  } catch (e: any) { res.status(500).json({ error: e?.message }); }
});

// ── Prompt builder ────────────────────────────────────────────────────────────
function buildAiPrompt(item: {
  name: string;
  templateKind?: string | null;
  categoryKey?: string | null;
  serviceType?: string | null;
  description?: string | null;
  origin?: string | null;
  location?: string | null;
  vendorName?: string | null;
  specValues?: Record<string, unknown> | null;
}): string {
  const sv = item.specValues ?? {};
  const kind = item.templateKind ?? "product";

  if (kind === "service") {
    const stype = (item.serviceType ?? item.categoryKey ?? "logistics").toLowerCase();
    let base = "";
    if (stype.includes("trucking") || stype.includes("truck")) {
      const truck = sv.truck_type ?? sv.truckType ?? "";
      const from = sv.route_from ?? sv.routeFrom ?? sv.coverage_area ?? item.location ?? "";
      const to = sv.route_to ?? sv.routeTo ?? "";
      base = `Professional Indonesian trucking service, ${truck ? truck + " truck, " : ""}container truck on highway${from ? ", route " + from : ""}${to ? " to " + to : ""}, clean corporate logistics style, professional lighting`;
    } else if (stype.includes("ppjk") || stype.includes("custom") || stype.includes("bea cukai")) {
      base = `Customs clearance service, port documentation, customs officer reviewing shipping documents, container inspection at port, professional logistics environment, Indonesia customs office`;
    } else if (stype.includes("sea") || stype.includes("ocean") || stype.includes("fcl") || stype.includes("lcl")) {
      const pol = sv.port_loading ?? sv.portLoading ?? "";
      const pod = sv.port_discharge ?? sv.portDischarge ?? "";
      const cont = sv.container_size ?? sv.containerSize ?? "";
      base = `Container vessel at port terminal, international sea freight${cont ? ", " + cont + " container" : ""}${pol ? ", loading at " + pol : ""}${pod ? ", discharge " + pod : ""}, professional logistics operation, realistic maritime photography`;
    } else if (stype.includes("air")) {
      base = `Cargo aircraft and airport warehouse, professional air freight logistics, cargo loading operation, modern airport terminal, commercial aviation freight`;
    } else if (stype.includes("warehouse") || stype.includes("gudang")) {
      base = `Modern logistics warehouse interior, organized shelving systems, forklift operations, inventory management, professional storage facility, bright lighting`;
    } else {
      base = `Professional ${item.name} logistics service, B2B commercial photography, modern logistics operations, professional lighting, clean corporate environment`;
    }
    return [
      base,
      "Ultra realistic, professional photography quality, high detail, no text, no watermarks, no logos.",
      "Square 1:1 ratio, suitable for professional B2B logistics marketplace.",
    ].join(" ");
  }

  // Product prompt
  const category = item.categoryKey ?? item.specValues?.commodity ?? "";
  const grade = sv.grade ?? sv.quality ?? "";
  const commodity = sv.commodity ?? category;
  const origin = item.origin ?? sv.origin ?? sv.country_of_origin ?? "";
  return [
    `Professional B2B marketplace product photography for a logistics and international trading platform.`,
    `Product: ${item.name}.`,
    commodity ? `Commodity: ${commodity}.` : "",
    grade ? `Grade/Quality: ${grade}.` : "",
    origin ? `Origin: ${origin}.` : "",
    item.description ? `Details: ${item.description.slice(0, 120)}.` : "",
    `Style: Commercial product photography, ultra realistic, marketplace quality, professional lighting, sharp focus, high detail, premium B2B catalog image.`,
    `Product centered as main subject. Clean modern background. No text, no watermarks, no logos. Square 1:1 ratio.`,
  ].filter(Boolean).join(" ");
}

// GET /api/product-media/generation-status — admin, status overview
router.get("/generation-status", async (req, res): Promise<void> => {
  if (!(await requireClerkUser(req, res))) return;
  const { onlyPublished } = req.query;
  try {
    // 1. All catalog items
    const allItems = await db
      .select({
        id: vendorCatalogItemsTable.id,
        name: vendorCatalogItemsTable.name,
        vendorName: vendorCatalogItemsTable.vendorName,
        vendorId: vendorCatalogItemsTable.vendorId,
        categoryKey: vendorCatalogItemsTable.categoryKey,
        templateKind: vendorCatalogItemsTable.templateKind,
        serviceType: vendorCatalogItemsTable.serviceType,
        isPublished: vendorCatalogItemsTable.isPublished,
      })
      .from(vendorCatalogItemsTable)
      .where(
        onlyPublished === "true"
          ? eq(vendorCatalogItemsTable.isPublished, true)
          : eq(vendorCatalogItemsTable.isActive, true),
      )
      .orderBy(asc(vendorCatalogItemsTable.id));

    // 2. All active images
    const allMedia = await db
      .select({
        vendorCatalogItemId: productMediaTable.vendorCatalogItemId,
        fileUrl: productMediaTable.fileUrl,
        isPrimary: productMediaTable.isPrimary,
        createdAt: productMediaTable.createdAt,
      })
      .from(productMediaTable)
      .where(
        and(
          eq(productMediaTable.isActive, true),
          eq(productMediaTable.mediaType, "image"),
        ),
      );

    // 3. Build lookup: itemId → { primaryImageUrl, mediaCount, lastGeneratedAt }
    const mediaByItem = new Map<number, { primaryImageUrl: string | null; mediaCount: number; lastGeneratedAt: Date | null }>();
    for (const m of allMedia) {
      if (m.vendorCatalogItemId == null) continue;
      const existing = mediaByItem.get(m.vendorCatalogItemId);
      if (!existing) {
        mediaByItem.set(m.vendorCatalogItemId, {
          primaryImageUrl: m.isPrimary ? (m.fileUrl ?? null) : null,
          mediaCount: 1,
          lastGeneratedAt: m.createdAt ?? null,
        });
      } else {
        existing.mediaCount += 1;
        if (m.isPrimary) existing.primaryImageUrl = m.fileUrl ?? null;
        if (m.createdAt && (!existing.lastGeneratedAt || m.createdAt > existing.lastGeneratedAt)) {
          existing.lastGeneratedAt = m.createdAt;
        }
      }
    }

    // 4. Build response items
    const items = allItems.map((item) => {
      const med = mediaByItem.get(item.id);
      return {
        id: item.id,
        name: item.name,
        vendorName: item.vendorName ?? null,
        category: item.categoryKey ?? item.serviceType ?? null,
        templateKind: item.templateKind ?? null,
        serviceType: item.serviceType ?? null,
        isPublished: item.isPublished,
        hasImage: !!med?.primaryImageUrl || (med?.mediaCount ?? 0) > 0,
        primaryImageUrl: med?.primaryImageUrl ?? null,
        mediaCount: med?.mediaCount ?? 0,
        lastGeneratedAt: med?.lastGeneratedAt ?? null,
      };
    });

    const withImage = items.filter((i) => i.hasImage).length;
    const withoutImage = items.length - withImage;
    res.json({
      totalItems: items.length,
      withImage,
      withoutImage,
      coveragePercent: items.length > 0 ? Math.round((withImage / items.length) * 100) : 0,
      items,
    });
  } catch (e: any) { res.status(500).json({ error: e?.message }); }
});

// POST /api/product-media/bulk-generate-ai — admin, batch AI image generation
router.post("/bulk-generate-ai", async (req, res): Promise<void> => {
  if (!(await requireClerkUser(req, res))) return;
  const { limit = 10, onlyPublished = true, dryRun = false, force = false } = req.body ?? {};
  const limitNum = Math.min(Math.max(1, Number(limit) || 10), 50);
  const a = actor(req);

  try {
    // 1. Get all catalog items
    const allItems = await db
      .select({
        id: vendorCatalogItemsTable.id,
        vendorId: vendorCatalogItemsTable.vendorId,
        vendorName: vendorCatalogItemsTable.vendorName,
        name: vendorCatalogItemsTable.name,
        description: vendorCatalogItemsTable.description,
        templateKind: vendorCatalogItemsTable.templateKind,
        categoryKey: vendorCatalogItemsTable.categoryKey,
        serviceType: vendorCatalogItemsTable.serviceType,
        origin: vendorCatalogItemsTable.origin,
        location: vendorCatalogItemsTable.location,
        specValues: vendorCatalogItemsTable.specValues,
      })
      .from(vendorCatalogItemsTable)
      .where(
        onlyPublished
          ? eq(vendorCatalogItemsTable.isPublished, true)
          : eq(vendorCatalogItemsTable.isActive, true),
      )
      .orderBy(asc(vendorCatalogItemsTable.id));

    // 2. Get items that already have active images
    const existingMedia = await db
      .select({ vendorCatalogItemId: productMediaTable.vendorCatalogItemId })
      .from(productMediaTable)
      .where(and(eq(productMediaTable.isActive, true), eq(productMediaTable.mediaType, "image")));
    const itemsWithImage = new Set(existingMedia.map((m) => m.vendorCatalogItemId));

    // 3. Filter: skip items that already have image (unless force=true)
    const targets = allItems
      .filter((item) => force || !itemsWithImage.has(item.id))
      .slice(0, limitNum);

    if (dryRun) {
      res.json({
        dryRun: true,
        wouldProcess: targets.length,
        items: targets.map((t) => ({ id: t.id, name: t.name, templateKind: t.templateKind })),
      });
      return;
    }

    const openai = getOpenAI();
    const results: Array<{ id: number; name: string; success: boolean; imageUrl?: string; error?: string }> = [];

    for (const item of targets) {
      try {
        const prompt = buildAiPrompt({
          name: item.name,
          templateKind: item.templateKind,
          categoryKey: item.categoryKey,
          serviceType: item.serviceType,
          description: item.description,
          origin: item.origin,
          location: item.location,
          vendorName: item.vendorName,
          specValues: item.specValues as Record<string, unknown> | null,
        });

        const aiRes = await openai.images.generate({
          model: "dall-e-3",
          prompt,
          n: 1,
          size: "1024x1024",
          quality: "standard",
          response_format: "b64_json",
        });

        const b64 = aiRes.data?.[0]?.b64_json;
        if (!b64) throw new Error("Model tidak mengembalikan gambar");

        const buffer = Buffer.from(b64, "base64");
        const folder = `product-media/vendor-${item.vendorId}/item-${item.id}`;
        const { publicUrl, storagePath } = await uploadToSupabase(buffer, "image/png", folder);

        // Ensure only one primary
        await db.update(productMediaTable)
          .set({ isPrimary: false, updatedAt: new Date() })
          .where(and(eq(productMediaTable.vendorCatalogItemId, item.id), eq(productMediaTable.isPrimary, true)));

        await db.insert(productMediaTable).values({
          vendorCatalogItemId: item.id,
          vendorId: item.vendorId,
          mediaType: "image",
          fileUrl: publicUrl,
          storagePath,
          isPrimary: true,
          isActive: true,
          title: `AI — ${item.name}`,
          uploadedBy: a.email,
          uploadedByRole: a.role,
          sortOrder: 0,
        });

        results.push({ id: item.id, name: item.name, success: true, imageUrl: publicUrl });
      } catch (err: any) {
        results.push({ id: item.id, name: item.name, success: false, error: err?.message ?? "Unknown error" });
      }
    }

    const succeeded = results.filter((r) => r.success).length;
    const failed = results.filter((r) => !r.success).length;
    res.json({ processed: results.length, succeeded, failed, results });
  } catch (e: any) { res.status(500).json({ error: e?.message }); }
});

// POST /api/product-media/regenerate-ai/:id — admin, regenerate single item (id = vendor_catalog_item_id)
router.post("/regenerate-ai/:id", async (req, res): Promise<void> => {
  if (!(await requireClerkUser(req, res))) return;
  const itemId = parseInt(String(req.params.id));
  if (isNaN(itemId)) { res.status(400).json({ error: "Invalid id" }); return; }
  const a = actor(req);

  try {
    const [item] = await db
      .select({
        id: vendorCatalogItemsTable.id,
        vendorId: vendorCatalogItemsTable.vendorId,
        vendorName: vendorCatalogItemsTable.vendorName,
        name: vendorCatalogItemsTable.name,
        description: vendorCatalogItemsTable.description,
        templateKind: vendorCatalogItemsTable.templateKind,
        categoryKey: vendorCatalogItemsTable.categoryKey,
        serviceType: vendorCatalogItemsTable.serviceType,
        origin: vendorCatalogItemsTable.origin,
        location: vendorCatalogItemsTable.location,
        specValues: vendorCatalogItemsTable.specValues,
      })
      .from(vendorCatalogItemsTable)
      .where(eq(vendorCatalogItemsTable.id, itemId));

    if (!item) { res.status(404).json({ error: "Item tidak ditemukan" }); return; }

    // Deactivate all existing images for this item
    await db.update(productMediaTable)
      .set({ isActive: false, isPrimary: false, updatedAt: new Date() })
      .where(and(eq(productMediaTable.vendorCatalogItemId, itemId), eq(productMediaTable.mediaType, "image")));

    const prompt = buildAiPrompt({
      name: item.name,
      templateKind: item.templateKind,
      categoryKey: item.categoryKey,
      serviceType: item.serviceType,
      description: item.description,
      origin: item.origin,
      location: item.location,
      vendorName: item.vendorName,
      specValues: item.specValues as Record<string, unknown> | null,
    });

    const openai = getOpenAI();
    const aiRes = await openai.images.generate({
      model: "dall-e-3",
      prompt,
      n: 1,
      size: "1024x1024",
      quality: "standard",
      response_format: "b64_json",
    });

    const b64 = aiRes.data?.[0]?.b64_json;
    if (!b64) { res.status(500).json({ error: "Model tidak mengembalikan gambar" }); return; }

    const buffer = Buffer.from(b64, "base64");
    const folder = `product-media/vendor-${item.vendorId}/item-${item.id}`;
    const { publicUrl, storagePath } = await uploadToSupabase(buffer, "image/png", folder);

    const [inserted] = await db.insert(productMediaTable).values({
      vendorCatalogItemId: item.id,
      vendorId: item.vendorId,
      mediaType: "image",
      fileUrl: publicUrl,
      storagePath,
      isPrimary: true,
      isActive: true,
      title: `AI — ${item.name}`,
      uploadedBy: a.email,
      uploadedByRole: a.role,
      sortOrder: 0,
    }).returning();

    res.status(201).json({ media: inserted, prompt });
  } catch (e: any) { res.status(500).json({ error: e?.message ?? "Gagal generate gambar" }); }
});

export default router;
