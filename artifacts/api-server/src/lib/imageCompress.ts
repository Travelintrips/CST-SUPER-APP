import sharp from "sharp";

export type ImageCompressMode = "photo" | "ocr-doc";
export type ImageOutputFormat = "webp" | "preserve";

const MODES = {
  photo: { maxWidth: 1600, quality: 80 },
  "ocr-doc": { maxWidth: 2000, quality: 85 },
} satisfies Record<ImageCompressMode, { maxWidth: number; quality: number }>;

const IMAGE_MIME_TYPES = new Set([
  "image/jpeg",
  "image/jpg",
  "image/png",
  "image/webp",
  "image/gif",
  "image/tiff",
  "image/bmp",
  "image/heic",
  "image/heif",
]);

export function isCompressibleImage(contentType: string): boolean {
  return IMAGE_MIME_TYPES.has(contentType.toLowerCase());
}

/**
 * Compress an image buffer using sharp.
 *
 * Mode "photo"   → WebP, max 1600 px wide, quality 80 (operational / cargo photos)
 * Mode "ocr-doc" → JPEG mozjpeg, max 2000 px wide, quality 85 (documents / OCR scans)
 *
 * In both modes:
 *  - EXIF rotation is applied automatically
 *  - Upscaling is disabled (withoutEnlargement)
 *  - Falls back to original if compression fails
 *  - `outputFormat: "preserve"` keeps JPG/PNG/WebP paths compatible with
 *    existing storage references while still reducing their size
 */
export async function compressImageBuffer(
  buffer: Buffer,
  contentType: string,
  mode: ImageCompressMode = "photo",
  outputFormat: ImageOutputFormat = "webp",
): Promise<{ buffer: Buffer; contentType: string }> {
  if (!isCompressibleImage(contentType)) {
    return { buffer, contentType };
  }

  const { maxWidth, quality } = MODES[mode];

  try {
    const image = sharp(buffer, { failOn: "none" });
    const meta = await image.metadata();

    const width = meta.width ?? 0;

    let pipeline = image.rotate();

    if (width > maxWidth) {
      pipeline = pipeline.resize({ width: maxWidth, withoutEnlargement: true });
    }

    const normalizedType = contentType.toLowerCase();

    if (outputFormat === "preserve") {
      // Animated GIFs must not be sent through a single-frame sharp pipeline.
      // Unsupported formats are left untouched rather than changing a stored
      // object's extension/content contract.
      if (normalizedType === "image/gif" || normalizedType === "image/bmp" ||
          normalizedType === "image/heic" || normalizedType === "image/heif") {
        return { buffer, contentType };
      }

      if (normalizedType === "image/png") {
        const compressed = await pipeline
          .png({ compressionLevel: 9, adaptiveFiltering: true })
          .toBuffer();
        return { buffer: compressed, contentType: "image/png" };
      }

      if (normalizedType === "image/jpeg" || normalizedType === "image/jpg") {
        const compressed = await pipeline
          .jpeg({ quality, mozjpeg: true })
          .toBuffer();
        return { buffer: compressed, contentType: "image/jpeg" };
      }

      if (normalizedType === "image/webp") {
        const compressed = await pipeline
          .webp({ quality, effort: 4, smartSubsample: true })
          .toBuffer();
        return { buffer: compressed, contentType: "image/webp" };
      }

      if (normalizedType === "image/tiff") {
        const compressed = await pipeline
          .tiff({ compression: "jpeg", quality })
          .toBuffer();
        return { buffer: compressed, contentType: "image/tiff" };
      }
    }

    if (mode === "photo") {
      const compressed = await pipeline
        .webp({ quality, effort: 4, smartSubsample: true })
        .toBuffer();
      return { buffer: compressed, contentType: "image/webp" };
    }

    const compressed = await pipeline
      .jpeg({ quality, mozjpeg: true })
      .toBuffer();
    return { buffer: compressed, contentType: "image/jpeg" };
  } catch {
    return { buffer, contentType };
  }
}
