import { useState } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { ZoomIn, FileText, ExternalLink, X } from "lucide-react";

interface PaymentProofPreviewProps {
  proofUrl: string | null | undefined;
  proofUploadedAt?: string | null;
  proofRemarks?: string | null;
  compact?: boolean;
}

function isPdf(url: string) {
  return /\.pdf($|\?)/i.test(url) || url.includes("application/pdf");
}

function isImage(url: string) {
  return /\.(jpe?g|png|webp|gif)($|\?)/i.test(url);
}

function resolveUrl(url: string): string {
  if (url.startsWith("http://") || url.startsWith("https://")) return url;
  return url;
}

export function PaymentProofPreview({
  proofUrl,
  proofUploadedAt,
  proofRemarks,
  compact = false,
}: PaymentProofPreviewProps) {
  const [open, setOpen] = useState(false);

  if (!proofUrl) return null;

  const resolved = resolveUrl(proofUrl);
  const pdf = isPdf(resolved);
  const image = isImage(resolved);
  const uploadedDate = proofUploadedAt
    ? new Date(proofUploadedAt).toLocaleString("id-ID", {
        day: "numeric", month: "short", year: "numeric",
        hour: "2-digit", minute: "2-digit",
      })
    : null;

  return (
    <>
      <div
        className={`rounded-lg border border-blue-200 bg-blue-50 overflow-hidden ${compact ? "mt-1.5" : "mt-2"}`}
      >
        <div className="flex items-center gap-2 px-2.5 py-1.5">
          <span className="text-[10px] font-semibold text-blue-700 uppercase tracking-wide flex items-center gap-1">
            <FileText className="w-3 h-3" />
            Bukti Pembayaran
          </span>
          {uploadedDate && (
            <span className="text-[10px] text-blue-500 ml-auto">{uploadedDate}</span>
          )}
        </div>

        {/* Preview area */}
        <div className="px-2.5 pb-2 space-y-1.5">
          {image && (
            <div
              className="relative group cursor-pointer rounded overflow-hidden border border-blue-100"
              style={{ maxWidth: compact ? 120 : 200, maxHeight: compact ? 80 : 130 }}
              onClick={() => setOpen(true)}
            >
              <img
                src={resolved}
                alt="Bukti pembayaran"
                className="w-full h-full object-cover"
                style={{ maxHeight: compact ? 80 : 130 }}
              />
              <div className="absolute inset-0 bg-black/30 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center">
                <ZoomIn className="w-5 h-5 text-white" />
              </div>
            </div>
          )}

          {pdf && (
            <button
              onClick={() => setOpen(true)}
              className="flex items-center gap-2 px-2.5 py-1.5 rounded border border-blue-200 bg-white hover:bg-blue-50 transition-colors text-xs text-blue-700 font-medium w-full text-left"
            >
              <FileText className="w-4 h-4 shrink-0 text-blue-500" />
              <span className="truncate">Lihat PDF Bukti Pembayaran</span>
              <ZoomIn className="w-3.5 h-3.5 ml-auto shrink-0" />
            </button>
          )}

          {!image && !pdf && (
            <a
              href={resolved}
              target="_blank"
              rel="noopener noreferrer"
              className="flex items-center gap-1.5 text-xs text-blue-600 hover:underline"
            >
              <ExternalLink className="w-3 h-3" />
              Lihat lampiran
            </a>
          )}

          {proofRemarks && (
            <p className="text-[11px] text-slate-500 italic leading-tight">
              Catatan: {proofRemarks}
            </p>
          )}
        </div>
      </div>

      {/* Full-screen modal */}
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-w-3xl w-full p-0 overflow-hidden">
          <DialogHeader className="px-4 pt-4 pb-2 flex flex-row items-center justify-between">
            <DialogTitle className="text-sm font-semibold text-slate-700 flex items-center gap-2">
              <FileText className="w-4 h-4 text-blue-600" />
              Bukti Pembayaran
              {uploadedDate && (
                <span className="text-xs text-slate-400 font-normal">— {uploadedDate}</span>
              )}
            </DialogTitle>
            <div className="flex items-center gap-1 ml-auto">
              <a
                href={resolved}
                target="_blank"
                rel="noopener noreferrer"
                className="text-slate-400 hover:text-slate-600"
                title="Buka di tab baru"
              >
                <ExternalLink className="w-4 h-4" />
              </a>
              <button
                onClick={() => setOpen(false)}
                className="text-slate-400 hover:text-slate-600 ml-1"
              >
                <X className="w-4 h-4" />
              </button>
            </div>
          </DialogHeader>

          {proofRemarks && (
            <div className="px-4 pb-1">
              <p className="text-xs text-slate-500 bg-slate-50 border border-slate-200 rounded px-2.5 py-1.5 italic">
                Catatan customer: {proofRemarks}
              </p>
            </div>
          )}

          <div className="flex-1 overflow-hidden">
            {image && (
              <div className="flex items-center justify-center bg-slate-900 min-h-[300px] max-h-[75vh] p-4">
                <img
                  src={resolved}
                  alt="Bukti pembayaran"
                  className="max-w-full max-h-[70vh] object-contain rounded"
                />
              </div>
            )}
            {pdf && (
              <iframe
                src={resolved}
                title="Bukti pembayaran PDF"
                className="w-full"
                style={{ height: "70vh", border: "none" }}
              />
            )}
          </div>

          {(image || pdf) && (
            <div className="px-4 py-2 border-t flex justify-end">
              <Button asChild size="sm" variant="outline" className="gap-1.5 text-xs">
                <a href={resolved} target="_blank" rel="noopener noreferrer">
                  <ExternalLink className="w-3.5 h-3.5" />
                  Buka di Tab Baru
                </a>
              </Button>
            </div>
          )}
        </DialogContent>
      </Dialog>
    </>
  );
}
