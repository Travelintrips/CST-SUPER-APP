/**
 * imageOptimizer.ts
 *
 * Image Optimization Engine — Marketplace Media Pipeline
 *
 * Pipeline:
 *   Original buffer
 *     → Validate (MIME + size)
 *     → Compress/Convert WebP per variant
 *     → Upload all variants to storage in parallel
 *     → Return { originalUrl, webpUrl, thumbnailUrl, mediumUrl, largeUrl }
 *
 * Variants:
 *   thumbnail  300×300  WebP  cover (exact square, center-crop)  quality 78
 *   medium     800×800  WebP  inside (maintain ratio, no crop)   quality 80
 *   large     1600×1600 WebP  inside (maintain ratio, no crop)   quality 82
 *   original   as-is    (original MIME, stored for audit)
 */

import sharp from "sharp";
import { randomUUID } from "crypto";
import { uploadToSupabase } from "./supabaseStorage.js";

// ── Constants ─────────────────────────────────────────────────────────────────

export const MARKETPLACE_IMAGE_MAX_BYTES = 5 * 1024 * 1024; // 5 MB

export const MARKETPLACE_ALLOWED_MIME = new Set([
  "image/jpeg",
  "image/jpg",
  "image/png",
  "image/webp",
]);

export const MARKETPLACE_ALLOWED_EXT = new Set([
  "jpg",
  "jpeg",
  "png",
  "webp",
]);

// ── Types ─────────────────────────────────────────────────────────────────────

export interface ImageVariant {
  variantName: "thumbnail" | "medium" | "large" | "original";
  url: string;
  objectPath: string;
  width?: number;
  height?: number;
  sizeBytes: number;
  mimeType: string;
}

export interface OptimizedImageResult {
  originalUrl: string;
  webpUrl: string;
  thumbnailUrl: string;
  mediumUrl: string;
  largeUrl: string;
  variants: ImageVariant[];
}

// ── Validation ────────────────────────────────────────────────────────────────

export type ImageValidationResult =
  | { ok: true }
  | { ok: false; status: 413 | 415; message: string };

export function validateMarketplaceImage(
  buffer: Buffer,
  mimeType: string,
  originalName?: string,
): ImageValidationResult {
  if (buffer.byteLength > MARKETPLACE_IMAGE_MAX_BYTES) {
    return {
      ok: false,
      status: 413,
      message: `Ukuran file melebihi batas 5MB. File Anda: ${(buffer.byteLength / 1024 / 1024).toFixed(1)}MB.`,
    };
  }

  if (!MARKETPLACE_ALLOWED_MIME.has(mimeType.toLowerCase())) {
    return {
      ok: false,
      status: 415,
      message: `Tipe file '${mimeType}' tidak didukung. Gunakan JPG, PNG, atau WebP.`,
    };
  }

  if (originalName) {
    const ext = originalName.split(".").pop()?.toLowerCase() ?? "";
    if (ext && !MARKETPLACE_ALLOWED_EXT.has(ext)) {
      return {
        ok: false,
        status: 415,
        message: `Ekstensi '.${ext}' tidak diizinkan. Gunakan .jpg, .jpeg, .png, atau .webp.`,
      };
    }
  }

  return { ok: true };
}

// ── Variant generators ────────────────────────────────────────────────────────

async function generateThumbnail(buffer: Buffer): Promise<Buffer> {
  return sharp(buffer, { failOn: "none" })
    .rotate()
    .resize({
      width: 300,
      height: 300,
      fit: "cover",
      position: "center",
      withoutEnlargement: true,
    })
    .webp({ quality: 78, effort: 4, smartSubsample: true })
    .toBuffer();
}

async function generateMedium(buffer: Buffer): Promise<Buffer> {
  return sharp(buffer, { failOn: "none" })
    .rotate()
    .resize({
      width: 800,
      height: 800,
      fit: "inside",
      withoutEnlargement: true,
    })
    .webp({ quality: 80, effort: 4, smartSubsample: true })
    .toBuffer();
}

async function generateLarge(buffer: Buffer): Promise<Buffer> {
  return sharp(buffer, { failOn: "none" })
    .rotate()
    .resize({
      width: 1600,
      height: 1600,
      fit: "inside",
      withoutEnlargement: true,
    })
    .webp({ quality: 82, effort: 4, smartSubsample: true })
    .toBuffer();
}

// ── Dimension reader ──────────────────────────────────────────────────────────

async function getDimensions(buffer: Buffer): Promise<{ width?: number; height?: number }> {
  try {
    const meta = await sharp(buffer, { failOn: "none" }).metadata();
    return { width: meta.width, height: meta.height };
  } catch {
    return {};
  }
}

// ── Main pipeline ─────────────────────────────────────────────────────────────

/**
 * Jalankan full marketplace image pipeline:
 *   1. Generate thumbnail, medium, large variant via sharp
 *   2. Upload semua variant + original ke storage secara paralel
 *   3. Return semua URL + metadata per variant
 *
 * @param buffer      - raw file buffer dari multer (memory storage)
 * @param mimeType    - MIME type dari file (sudah divalidasi)
 * @param folder      - storage folder prefix (default: "marketplace")
 */
export async function optimizeAndUploadMarketplaceImage(
  buffer: Buffer,
  mimeType: string,
  folder = "marketplace",
): Promise<OptimizedImageResult> {
  const prefix = `${folder}/${randomUUID()}`;

  // Generate semua variant secara paralel
  const [thumbBuf, mediumBuf, largeBuf] = await Promise.all([
    generateThumbnail(buffer),
    generateMedium(buffer),
    generateLarge(buffer),
  ]);

  // Upload semua ke storage secara paralel
  const [thumbUpload, mediumUpload, largeUpload, origUpload] = await Promise.all([
    uploadToSupabase(thumbBuf, "image/webp", `${prefix}-thumb`),
    uploadToSupabase(mediumBuf, "image/webp", `${prefix}-medium`),
    uploadToSupabase(largeBuf, "image/webp", `${prefix}-large`),
    uploadToSupabase(buffer, mimeType, `${prefix}-original`),
  ]);

  // Ambil dimensi semua variant secara paralel
  const [thumbDim, mediumDim, largeDim, origDim] = await Promise.all([
    getDimensions(thumbBuf),
    getDimensions(mediumBuf),
    getDimensions(largeBuf),
    getDimensions(buffer),
  ]);

  const variants: ImageVariant[] = [
    {
      variantName: "thumbnail",
      url: thumbUpload.publicUrl,
      objectPath: thumbUpload.storagePath,
      ...thumbDim,
      sizeBytes: thumbBuf.byteLength,
      mimeType: "image/webp",
    },
    {
      variantName: "medium",
      url: mediumUpload.publicUrl,
      objectPath: mediumUpload.storagePath,
      ...mediumDim,
      sizeBytes: mediumBuf.byteLength,
      mimeType: "image/webp",
    },
    {
      variantName: "large",
      url: largeUpload.publicUrl,
      objectPath: largeUpload.storagePath,
      ...largeDim,
      sizeBytes: largeBuf.byteLength,
      mimeType: "image/webp",
    },
    {
      variantName: "original",
      url: origUpload.publicUrl,
      objectPath: origUpload.storagePath,
      ...origDim,
      sizeBytes: buffer.byteLength,
      mimeType,
    },
  ];

  return {
    originalUrl: origUpload.publicUrl,
    webpUrl: largeUpload.publicUrl,
    thumbnailUrl: thumbUpload.publicUrl,
    mediumUrl: mediumUpload.publicUrl,
    largeUrl: largeUpload.publicUrl,
    variants,
  };
}
