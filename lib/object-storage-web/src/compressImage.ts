export type ImageCompressMode = "photo" | "ocr-doc";

interface ModeConfig {
  maxWidth: number;
  quality: number;
  outputType: "image/webp" | "image/jpeg";
  ext: string;
}

const MODES: Record<ImageCompressMode, ModeConfig> = {
  photo: { maxWidth: 1600, quality: 0.80, outputType: "image/webp", ext: "webp" },
  "ocr-doc": { maxWidth: 2000, quality: 0.85, outputType: "image/jpeg", ext: "jpg" },
};

const COMPRESSIBLE_TYPES = new Set([
  "image/jpeg",
  "image/jpg",
  "image/png",
  "image/webp",
  "image/gif",
  "image/bmp",
  "image/tiff",
]);

function canEncodeWebp(): boolean {
  try {
    const c = document.createElement("canvas");
    c.width = 1;
    c.height = 1;
    return c.toDataURL("image/webp").startsWith("data:image/webp");
  } catch {
    return false;
  }
}

/**
 * Draw an image element onto a canvas with high-quality downsampling.
 * Uses multi-step downscaling for large reductions to prevent blur.
 */
function drawHighQuality(
  ctx: CanvasRenderingContext2D,
  img: HTMLImageElement,
  targetW: number,
  targetH: number,
): void {
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = "high";

  const srcW = img.naturalWidth;
  const srcH = img.naturalHeight;

  const steps = Math.ceil(Math.log2(srcW / targetW));

  if (steps <= 1) {
    ctx.drawImage(img, 0, 0, targetW, targetH);
    return;
  }

  let currentW = srcW;
  let currentH = srcH;
  let source: HTMLImageElement | HTMLCanvasElement = img;

  for (let i = 0; i < steps - 1; i++) {
    currentW = Math.max(Math.round(currentW / 2), targetW);
    currentH = Math.max(Math.round(currentH / 2), targetH);

    const stepCanvas = document.createElement("canvas");
    stepCanvas.width = currentW;
    stepCanvas.height = currentH;
    const stepCtx = stepCanvas.getContext("2d")!;
    stepCtx.imageSmoothingEnabled = true;
    stepCtx.imageSmoothingQuality = "high";
    stepCtx.drawImage(source, 0, 0, currentW, currentH);
    source = stepCanvas;
  }

  ctx.drawImage(source, 0, 0, targetW, targetH);
}

function blobToFile(blob: Blob, originalName: string, ext: string): File {
  const baseName = originalName.replace(/\.[^.]+$/, "");
  return new File([blob], `${baseName}.${ext}`, {
    type: blob.type,
    lastModified: Date.now(),
  });
}

/**
 * Compress an image File in the browser.
 *
 * Mode "photo"   → WebP 80%, max 1600 px (operational / cargo photos)
 * Mode "ocr-doc" → JPEG 85%, max 2000 px (documents for OCR)
 *
 * Falls back to JPEG if WebP is not supported (Safari).
 * Uses multi-step downscaling to prevent blur on large reductions.
 * Returns the original file for non-image types (PDF, etc.).
 */
export async function compressImageFile(
  file: File,
  mode: ImageCompressMode = "photo",
): Promise<File> {
  if (!COMPRESSIBLE_TYPES.has(file.type.toLowerCase())) return file;

  const cfg = { ...MODES[mode] };
  if (cfg.outputType === "image/webp" && !canEncodeWebp()) {
    cfg.outputType = "image/jpeg";
    cfg.ext = "jpg";
  }

  return new Promise((resolve) => {
    const img = new Image();
    const objectUrl = URL.createObjectURL(file);

    img.onload = () => {
      URL.revokeObjectURL(objectUrl);

      const srcW = img.naturalWidth;
      const srcH = img.naturalHeight;
      const scale = srcW > cfg.maxWidth ? cfg.maxWidth / srcW : 1;
      const targetW = Math.round(srcW * scale);
      const targetH = Math.round(srcH * scale);

      const canvas = document.createElement("canvas");
      canvas.width = targetW;
      canvas.height = targetH;
      const ctx = canvas.getContext("2d");
      if (!ctx) { resolve(file); return; }

      drawHighQuality(ctx, img, targetW, targetH);

      canvas.toBlob(
        (blob) => {
          if (!blob) { resolve(file); return; }
          resolve(blobToFile(blob, file.name, cfg.ext));
        },
        cfg.outputType,
        cfg.quality,
      );
    };

    img.onerror = () => { URL.revokeObjectURL(objectUrl); resolve(file); };
    img.src = objectUrl;
  });
}

export interface CompressResult {
  file: File;
  previewUrl: string;
}

/**
 * Compress an image and return both the compressed File and a
 * preview object URL (caller must call URL.revokeObjectURL when done).
 */
export async function compressImageFileWithPreview(
  file: File,
  mode: ImageCompressMode = "photo",
): Promise<CompressResult> {
  if (!COMPRESSIBLE_TYPES.has(file.type.toLowerCase())) {
    return { file, previewUrl: URL.createObjectURL(file) };
  }

  const cfg = { ...MODES[mode] };
  if (cfg.outputType === "image/webp" && !canEncodeWebp()) {
    cfg.outputType = "image/jpeg";
    cfg.ext = "jpg";
  }

  return new Promise((resolve) => {
    const img = new Image();
    const objectUrl = URL.createObjectURL(file);

    img.onload = () => {
      URL.revokeObjectURL(objectUrl);

      const srcW = img.naturalWidth;
      const srcH = img.naturalHeight;
      const scale = srcW > cfg.maxWidth ? cfg.maxWidth / srcW : 1;
      const targetW = Math.round(srcW * scale);
      const targetH = Math.round(srcH * scale);

      const canvas = document.createElement("canvas");
      canvas.width = targetW;
      canvas.height = targetH;
      const ctx = canvas.getContext("2d");
      if (!ctx) {
        resolve({ file, previewUrl: URL.createObjectURL(file) });
        return;
      }

      drawHighQuality(ctx, img, targetW, targetH);

      canvas.toBlob(
        (blob) => {
          if (!blob) {
            resolve({ file, previewUrl: URL.createObjectURL(file) });
            return;
          }
          const compressed = blobToFile(blob, file.name, cfg.ext);
          const previewUrl = URL.createObjectURL(blob);
          resolve({ file: compressed, previewUrl });
        },
        cfg.outputType,
        cfg.quality,
      );
    };

    img.onerror = () => {
      URL.revokeObjectURL(objectUrl);
      resolve({ file, previewUrl: URL.createObjectURL(file) });
    };
    img.src = objectUrl;
  });
}
