import sharp from "sharp";

export type ImageCompressMode = "photo" | "ocr-doc";

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
 */
export async function compressImageBuffer(
  buffer: Buffer,
  contentType: string,
  mode: ImageCompressMode = "photo",
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
