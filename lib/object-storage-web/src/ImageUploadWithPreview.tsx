import { useRef, useState, useCallback, useId } from "react";
import { compressImageFileWithPreview, type ImageCompressMode } from "./compressImage";

interface UploadResult {
  uploadURL: string;
  objectPath: string;
}

interface ImageUploadWithPreviewProps {
  /**
   * Compression mode.
   * "photo"   → WebP 80%, max 1600 px  (cargo/operational photos)
   * "ocr-doc" → JPEG 85%, max 2000 px  (scanned documents)
   */
  mode?: ImageCompressMode;
  /** Label shown on the pick-file button (default: "Pilih Gambar") */
  label?: string;
  /** accepted MIME types for the file input (default: "image/*") */
  accept?: string;
  /** Endpoint that returns { uploadURL, objectPath } via POST */
  requestUrlEndpoint: string;
  /** Extra headers sent to requestUrlEndpoint (e.g. auth cookies are included automatically) */
  extraHeaders?: Record<string, string>;
  /** Called when the file is successfully stored. Receives objectPath. */
  onSuccess?: (result: UploadResult) => void;
  onError?: (err: Error) => void;
  /** Max original file size in bytes before compression (default: 20 MB) */
  maxFileSizeBytes?: number;
  className?: string;
  disabled?: boolean;
}

function formatBytes(b: number) {
  if (b < 1024) return `${b} B`;
  if (b < 1024 * 1024) return `${(b / 1024).toFixed(1)} KB`;
  return `${(b / (1024 * 1024)).toFixed(1)} MB`;
}

type Phase = "idle" | "compressing" | "preview" | "uploading" | "done" | "error";

/**
 * Image upload component with client-side compression and preview.
 *
 * Flow:
 * 1. User picks a file → compress in browser → show preview + size stats
 * 2. User confirms → file uploaded to storage
 * 3. onSuccess callback with objectPath
 *
 * Supports WebP for photos and high-quality JPEG for OCR documents.
 */
export function ImageUploadWithPreview({
  mode = "photo",
  label = "Pilih Gambar",
  accept = "image/*",
  requestUrlEndpoint,
  extraHeaders = {},
  onSuccess,
  onError,
  maxFileSizeBytes = 20 * 1024 * 1024,
  className = "",
  disabled = false,
}: ImageUploadWithPreviewProps) {
  const inputId = useId();
  const fileInputRef = useRef<HTMLInputElement>(null);

  const [phase, setPhase] = useState<Phase>("idle");
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [compressedFile, setCompressedFile] = useState<File | null>(null);
  const [originalSize, setOriginalSize] = useState(0);
  const [compressedSize, setCompressedSize] = useState(0);
  const [progress, setProgress] = useState(0);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  const resetState = useCallback(() => {
    setPhase("idle");
    setErrorMsg(null);
    setProgress(0);
    setCompressedFile(null);
    setOriginalSize(0);
    setCompressedSize(0);
    if (previewUrl) { URL.revokeObjectURL(previewUrl); setPreviewUrl(null); }
    if (fileInputRef.current) fileInputRef.current.value = "";
  }, [previewUrl]);

  const handleFileChange = useCallback(async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    if (file.size > maxFileSizeBytes) {
      setErrorMsg(`File terlalu besar. Maks: ${formatBytes(maxFileSizeBytes)}`);
      setPhase("error");
      return;
    }

    if (previewUrl) URL.revokeObjectURL(previewUrl);
    setPhase("compressing");
    setErrorMsg(null);

    try {
      const { file: compressed, previewUrl: pUrl } = await compressImageFileWithPreview(file, mode);
      setOriginalSize(file.size);
      setCompressedSize(compressed.size);
      setCompressedFile(compressed);
      setPreviewUrl(pUrl);
      setPhase("preview");
    } catch {
      setErrorMsg("Gagal memproses gambar.");
      setPhase("error");
    }
  }, [mode, maxFileSizeBytes, previewUrl]);

  const handleUpload = useCallback(async () => {
    if (!compressedFile) return;

    setPhase("uploading");
    setProgress(10);

    try {
      const res = await fetch(requestUrlEndpoint, {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json", ...extraHeaders },
        body: JSON.stringify({
          name: compressedFile.name,
          size: compressedFile.size,
          contentType: compressedFile.type,
        }),
      });

      if (!res.ok) {
        const d = await res.json().catch(() => ({}));
        throw new Error(d.error ?? d.message ?? "Gagal mendapatkan URL upload");
      }

      const { uploadURL, objectPath } = await res.json() as UploadResult;
      setProgress(40);

      const putRes = await fetch(uploadURL, {
        method: "PUT",
        body: compressedFile,
        headers: { "Content-Type": compressedFile.type },
      });

      if (!putRes.ok) throw new Error("Gagal mengunggah file ke storage");

      setProgress(100);
      setPhase("done");
      onSuccess?.({ uploadURL, objectPath });
    } catch (err) {
      const e = err instanceof Error ? err : new Error("Upload gagal");
      setErrorMsg(e.message);
      setPhase("error");
      onError?.(e);
    }
  }, [compressedFile, requestUrlEndpoint, extraHeaders, onSuccess, onError]);

  const savingPct =
    originalSize > 0 ? Math.round((1 - compressedSize / originalSize) * 100) : 0;

  const isWorking = phase === "compressing" || phase === "uploading";

  return (
    <div className={`flex flex-col gap-3 ${className}`}>
      {/* File picker */}
      <input
        id={inputId}
        ref={fileInputRef}
        type="file"
        accept={accept}
        className="hidden"
        disabled={disabled || isWorking}
        onChange={handleFileChange}
      />

      {phase === "idle" || phase === "error" ? (
        <label
          htmlFor={inputId}
          className={`
            inline-flex items-center gap-2 px-4 py-2 rounded-md border text-sm font-medium cursor-pointer
            transition-colors select-none
            ${disabled
              ? "opacity-50 cursor-not-allowed bg-muted text-muted-foreground border-border"
              : "bg-background hover:bg-accent border-border text-foreground"}
          `}
        >
          <PickIcon />
          {label}
        </label>
      ) : null}

      {/* Compressing spinner */}
      {phase === "compressing" && (
        <div className="flex items-center gap-2 text-sm text-muted-foreground">
          <Spinner />
          Mengompresi gambar…
        </div>
      )}

      {/* Preview + stats */}
      {(phase === "preview" || phase === "uploading" || phase === "done") && previewUrl && (
        <div className="rounded-lg border border-border overflow-hidden bg-muted/30">
          <div className="relative">
            <img
              src={previewUrl}
              alt="Preview"
              className="w-full max-h-72 object-contain bg-checkerboard"
              onLoad={() => {}}
            />
            {phase === "done" && (
              <div className="absolute inset-0 flex items-center justify-center bg-black/40 rounded-t-lg">
                <span className="text-white text-4xl">✓</span>
              </div>
            )}
          </div>

          {/* Size info bar */}
          <div className="px-3 py-2 flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted-foreground border-t border-border">
            <span>Asli: <strong className="text-foreground">{formatBytes(originalSize)}</strong></span>
            <span>Setelah kompresi: <strong className="text-foreground">{formatBytes(compressedSize)}</strong></span>
            {savingPct > 0 && (
              <span className="text-emerald-600 font-semibold">↓ {savingPct}% lebih kecil</span>
            )}
            <span>Format: <strong className="text-foreground uppercase">{compressedFile?.type.split("/")[1]}</strong></span>
          </div>

          {/* Upload progress bar */}
          {phase === "uploading" && (
            <div className="px-3 pb-2">
              <div className="h-1.5 rounded-full bg-muted overflow-hidden">
                <div
                  className="h-full bg-primary rounded-full transition-all duration-300"
                  style={{ width: `${progress}%` }}
                />
              </div>
              <p className="text-xs text-muted-foreground mt-1">Mengunggah… {progress}%</p>
            </div>
          )}
        </div>
      )}

      {/* Error message */}
      {phase === "error" && errorMsg && (
        <p className="text-sm text-destructive">{errorMsg}</p>
      )}

      {/* Action buttons */}
      {phase === "preview" && (
        <div className="flex gap-2">
          <button
            type="button"
            onClick={handleUpload}
            className="flex items-center gap-1.5 px-4 py-2 rounded-md bg-primary text-primary-foreground text-sm font-medium hover:bg-primary/90 transition-colors"
          >
            <UploadIcon />
            Upload
          </button>
          <button
            type="button"
            onClick={resetState}
            className="px-4 py-2 rounded-md border border-border text-sm text-muted-foreground hover:bg-accent transition-colors"
          >
            Batal
          </button>
        </div>
      )}

      {/* Done state — allow re-upload */}
      {phase === "done" && (
        <div className="flex gap-2 items-center">
          <span className="text-sm text-emerald-600 font-medium">Upload berhasil</span>
          <button
            type="button"
            onClick={resetState}
            className="text-xs text-muted-foreground underline hover:text-foreground"
          >
            Ganti gambar
          </button>
        </div>
      )}
    </div>
  );
}

function PickIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
      <polyline points="17 8 12 3 7 8" />
      <line x1="12" y1="3" x2="12" y2="15" />
    </svg>
  );
}

function UploadIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
      <polyline points="16 16 12 12 8 16" />
      <line x1="12" y1="12" x2="12" y2="21" />
      <path d="M20.39 18.39A5 5 0 0 0 18 9h-1.26A8 8 0 1 0 3 16.3" />
    </svg>
  );
}

function Spinner() {
  return (
    <svg className="animate-spin" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
      <path d="M21 12a9 9 0 1 1-6.219-8.56" />
    </svg>
  );
}
