import { useState, useRef } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { ScanLine, Upload, Camera, Loader2, AlertCircle, CheckCircle2 } from "lucide-react";
import { toast } from "sonner";

const SCAN_FIELD_DEFS: Array<{ key: keyof ScannedDocumentData; label: string }> = [
  { key: "partyName",      label: "Nama Pihak" },
  { key: "partyEmail",     label: "Email" },
  { key: "partyPhone",     label: "Telepon" },
  { key: "partyAddress",   label: "Alamat" },
  { key: "docDate",        label: "Tanggal Dokumen" },
  { key: "dueDate",        label: "Jatuh Tempo" },
  { key: "shipmentNumber", label: "No. Shipment" },
  { key: "origin",         label: "Asal" },
  { key: "destination",    label: "Tujuan" },
  { key: "carrier",        label: "Carrier" },
  { key: "weight",         label: "Berat (kg)" },
  { key: "volume",         label: "Volume (CBM)" },
  { key: "estimatedCost",  label: "Estimasi Biaya" },
  { key: "notes",          label: "Catatan" },
];

export interface ScannedDocumentData {
  docType?: "sales" | "purchase" | "freight";
  partyName?: string | null;
  partyEmail?: string | null;
  partyPhone?: string | null;
  partyAddress?: string | null;
  docDate?: string | null;
  dueDate?: string | null;
  notes?: string | null;
  shipmentNumber?: string | null;
  origin?: string | null;
  destination?: string | null;
  carrier?: string | null;
  weight?: number | null;
  volume?: number | null;
  estimatedCost?: number | null;
  lines?: Array<{
    name: string;
    description?: string | null;
    quantity: number;
    unitPrice: number;
  }>;
}

interface ScanDocumentDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onDataExtracted: (data: ScannedDocumentData) => void;
  title?: string;
}

export function ScanDocumentDialog({ open, onOpenChange, onDataExtracted, title = "Scan Dokumen" }: ScanDocumentDialogProps) {
  const [loading, setLoading] = useState(false);
  const [preview, setPreview] = useState<string | null>(null);
  const [fileName, setFileName] = useState<string | null>(null);
  const [extracted, setExtracted] = useState<ScannedDocumentData | null>(null);
  const [truncation, setTruncation] = useState<{ phrase: string; lineIndex: number } | null>(null);
  const [charLimitHit, setCharLimitHit] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const cameraInputRef = useRef<HTMLInputElement>(null);

  const reset = () => {
    setPreview(null);
    setFileName(null);
    setExtracted(null);
    setTruncation(null);
    setCharLimitHit(false);
  };

  const handleFile = async (file: File) => {
    setFileName(file.name);
    setExtracted(null);
    if (file.type.startsWith("image/")) {
      const url = URL.createObjectURL(file);
      setPreview(url);
    } else {
      setPreview(null);
    }

    setLoading(true);
    try {
      const form = new FormData();
      form.append("file", file);
      const resp = await fetch("/api/scan-document", {
        method: "POST",
        body: form,
        credentials: "include",
      });
      if (!resp.ok) {
        const err = await resp.json().catch(() => ({}));
        throw new Error((err as any)?.message ?? `Error ${resp.status}`);
      }
      const json = await resp.json() as {
        data: ScannedDocumentData;
        mode?: string;
        truncation?: { phrase: string; lineIndex: number } | null;
        charLimitHit?: boolean;
      };
      setExtracted(json.data);
      setTruncation(json.truncation ?? null);
      setCharLimitHit(json.charLimitHit ?? false);
    } catch (err: unknown) {
      toast.error(err instanceof Error ? err.message : "Gagal memproses dokumen");
    } finally {
      setLoading(false);
    }
  };

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) handleFile(file);
    e.target.value = "";
  };

  const handleApply = () => {
    if (!extracted) return;
    onDataExtracted(extracted);
    onOpenChange(false);
    reset();
    toast.success("Data dokumen berhasil diisi otomatis");
  };

  const handleClose = () => {
    onOpenChange(false);
    reset();
  };

  return (
    <Dialog open={open} onOpenChange={(v) => { if (!v) handleClose(); }}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <ScanLine className="h-5 w-5 text-primary" />
            {title}
          </DialogTitle>
        </DialogHeader>

        <div className="space-y-4">
          <p className="text-sm text-muted-foreground">
            Upload foto atau PDF dokumen. AI akan mengekstrak data dan mengisi form secara otomatis.
          </p>

          <div className="flex gap-2">
            <Button
              variant="outline"
              className="flex-1"
              onClick={() => fileInputRef.current?.click()}
              disabled={loading}
            >
              <Upload className="h-4 w-4 mr-2" />
              Upload File
            </Button>
            <Button
              variant="outline"
              className="flex-1"
              onClick={() => cameraInputRef.current?.click()}
              disabled={loading}
            >
              <Camera className="h-4 w-4 mr-2" />
              Kamera
            </Button>
          </div>

          <input ref={fileInputRef} type="file" accept="image/*,application/pdf" className="hidden" onChange={handleFileChange} />
          <input ref={cameraInputRef} type="file" accept="image/*" capture="environment" className="hidden" onChange={handleFileChange} />

          {loading && (
            <div className="flex flex-col items-center gap-3 py-6 text-muted-foreground">
              <Loader2 className="h-8 w-8 animate-spin text-primary" />
              <p className="text-sm">Sedang mengekstrak data dokumen...</p>
            </div>
          )}

          {!loading && preview && (
            <div className="rounded-md border overflow-hidden bg-muted">
              <img src={preview} alt="Preview dokumen" className="w-full max-h-48 object-contain" />
            </div>
          )}

          {!loading && !preview && fileName && (
            <div className="flex items-center gap-2 rounded-md border px-3 py-2 text-sm text-muted-foreground">
              <ScanLine className="h-4 w-4 shrink-0" />
              {fileName}
            </div>
          )}

          {!loading && extracted && (() => {
            const activeFields = SCAN_FIELD_DEFS.filter(
              ({ key }) => extracted[key] != null && extracted[key] !== ""
            );
            const lineCount = extracted.lines?.length ?? 0;
            const totalActive = activeFields.length + (lineCount > 0 ? 1 : 0);
            return (
              <div className="rounded-md border border-emerald-200 bg-emerald-50 dark:bg-emerald-950/20 dark:border-emerald-800 p-3 space-y-2.5">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-1.5 text-emerald-700 dark:text-emerald-400 text-sm font-medium">
                    <CheckCircle2 className="h-4 w-4 shrink-0" />
                    Data berhasil diekstrak
                  </div>
                  <span className="text-xs font-semibold text-emerald-700 bg-emerald-100 border border-emerald-200 rounded-full px-2 py-0.5">
                    {totalActive} field aktif
                  </span>
                </div>

                {totalActive > 0 && (
                  <div className="max-h-44 overflow-y-auto space-y-1 pr-1">
                    {activeFields.map(({ key, label }) => {
                      const val = extracted[key];
                      return (
                        <div key={key} className="flex items-start gap-2 text-xs rounded-md bg-white/70 border border-emerald-100 px-2 py-1.5">
                          <span className="mt-0.5 h-2 w-2 shrink-0 rounded-full bg-emerald-500" />
                          <span className="font-medium text-foreground/70 min-w-[90px]">{label}</span>
                          <span className="text-foreground font-medium break-all">{String(val)}</span>
                        </div>
                      );
                    })}
                    {lineCount > 0 && (
                      <div className="flex items-start gap-2 text-xs rounded-md bg-white/70 border border-emerald-100 px-2 py-1.5">
                        <span className="mt-0.5 h-2 w-2 shrink-0 rounded-full bg-emerald-500" />
                        <span className="font-medium text-foreground/70 min-w-[90px]">Item Baris</span>
                        <span className="text-foreground font-medium">{lineCount} item</span>
                      </div>
                    )}
                  </div>
                )}

                {truncation && (
                  <div className="flex items-start gap-1.5 text-xs text-amber-700 bg-amber-100 rounded px-2 py-1.5">
                    <AlertCircle className="h-3 w-3 shrink-0 text-amber-500 mt-0.5" />
                    <span>Teks PDF dipotong di baris {truncation.lineIndex + 1} (<span className="font-medium">"{truncation.phrase}"</span>) — data setelahnya tidak dikirim ke AI. Periksa field yang mungkin kosong.</span>
                  </div>
                )}
                {charLimitHit && !truncation && (
                  <div className="flex items-start gap-1.5 text-xs text-amber-700 bg-amber-100 rounded px-2 py-1.5">
                    <AlertCircle className="h-3 w-3 shrink-0 text-amber-500 mt-0.5" />
                    <span>Dokumen panjang — teks dipotong di 5.000 karakter pertama. Data di halaman akhir mungkin tidak terbaca. Periksa field yang kosong.</span>
                  </div>
                )}
              </div>
            );
          })()}

          {!loading && !extracted && fileName && !preview && (
            <div className="flex items-center gap-2 text-xs text-muted-foreground">
              <AlertCircle className="h-4 w-4 shrink-0" />
              Menunggu hasil ekstraksi...
            </div>
          )}
        </div>

        <DialogFooter>
          <Button variant="ghost" onClick={handleClose}>Batal</Button>
          <Button onClick={handleApply} disabled={!extracted || loading}>
            Terapkan ke Form
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
