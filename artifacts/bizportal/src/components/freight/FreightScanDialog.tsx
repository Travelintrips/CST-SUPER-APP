import { useRef, useState, useEffect, useCallback } from "react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import { Label } from "@/components/ui/label";
import {
  QrCode,
  ScanLine,
  CheckCircle,
  AlertCircle,
  Loader2,
  X,
  ChevronDown,
  FileText,
  Upload,
  Camera,
} from "lucide-react";
import { toast } from "sonner";

// ── Form field types ──────────────────────────────────────────────────────────

export type FreightFormFields = {
  shipperName?: string;
  shipperAddress?: string;
  consigneeName?: string;
  consigneeAddress?: string;
  notifyParty?: string;
  commodity?: string;
  hsCode?: string;
  grossWeight?: string;
  netWeight?: string;
  quantity?: string;
  packingType?: string;
  dimensions?: string;
  marksAndNumbers?: string;
  measurement?: string;
  origin?: string;
  destination?: string;
  portOfLoading?: string;
  portOfDischarge?: string;
  vessel?: string;
  voyage?: string;
  containerNo?: string;
  notes?: string;
};

export const FIELD_LABELS: Record<keyof FreightFormFields, string> = {
  shipperName: "Nama Shipper",
  shipperAddress: "Alamat Shipper",
  consigneeName: "Nama Consignee",
  consigneeAddress: "Alamat Consignee",
  notifyParty: "Notify Party",
  commodity: "Komoditi",
  hsCode: "HS Code",
  grossWeight: "Berat Bruto (kg)",
  netWeight: "Berat Neto (kg)",
  quantity: "Jumlah / Pieces",
  packingType: "Jenis Packing",
  dimensions: "Dimensi",
  marksAndNumbers: "Marks & Numbers / AWB No.",
  measurement: "Measurement (CBM)",
  origin: "Asal / Origin",
  destination: "Tujuan / Destination",
  portOfLoading: "Port / Airport of Loading",
  portOfDischarge: "Port / Airport of Discharge",
  vessel: "Vessel / Freight Carrier",
  voyage: "Voyage No. / Flight No.",
  containerNo: "Nomor Kontainer",
  notes: "Catatan / Remarks",
};

const VALID_KEYS = Object.keys(FIELD_LABELS) as (keyof FreightFormFields)[];

// ── AWB field alias map ────────────────────────────────────────────────────────
// Maps common AWB JSON keys → one or more FreightFormFields keys.
// A single AWB key can populate multiple form fields (e.g. originAirport → origin + portOfLoading).

type AliasMap = Partial<Record<string, (keyof FreightFormFields)[]>>;

const AWB_ALIASES: AliasMap = {
  // AWB number / B/L number → Marks & Numbers field
  awbNumber: ["marksAndNumbers"],
  awb_number: ["marksAndNumbers"],
  awb: ["marksAndNumbers"],
  mawb: ["marksAndNumbers"],
  hawb: ["marksAndNumbers"],
  blNumber: ["marksAndNumbers"],
  bl_number: ["marksAndNumbers"],
  billOfLadingNumber: ["marksAndNumbers"],
  bl_no: ["marksAndNumbers"],
  blNo: ["marksAndNumbers"],

  // Container numbers
  containerNo: ["containerNo"],
  container_no: ["containerNo"],
  containerNumber: ["containerNo"],
  container_number: ["containerNo"],
  containerNumbers: ["containerNo"],
  containers: ["containerNo"],

  // Shipper
  shipper: ["shipperName"],
  shipperName: ["shipperName"],
  shipper_name: ["shipperName"],
  shipperAddr: ["shipperAddress"],
  shipper_address: ["shipperAddress"],
  shipperAddress: ["shipperAddress"],

  // Consignee
  consignee: ["consigneeName"],
  consigneeName: ["consigneeName"],
  consignee_name: ["consigneeName"],
  consigneeAddr: ["consigneeAddress"],
  consignee_address: ["consigneeAddress"],
  consigneeAddress: ["consigneeAddress"],

  // Notify
  notify: ["notifyParty"],
  notifyParty: ["notifyParty"],
  notify_party: ["notifyParty"],
  notifyAddress: ["notifyParty"],

  // Commodity
  goods: ["commodity"],
  goodsDesc: ["commodity"],
  goods_description: ["commodity"],
  cargo: ["commodity"],
  cargoDesc: ["commodity"],
  commodity: ["commodity"],
  description: ["commodity"],

  // HS Code
  hs: ["hsCode"],
  hs_code: ["hsCode"],
  hscode: ["hsCode"],
  tariff: ["hsCode"],
  hsCode: ["hsCode"],

  // Weights
  gw: ["grossWeight"],
  gross_weight: ["grossWeight"],
  grossKg: ["grossWeight"],
  grossWeight: ["grossWeight"],
  chargeableWeight: ["grossWeight"],
  cw: ["grossWeight"],

  nw: ["netWeight"],
  net_weight: ["netWeight"],
  netKg: ["netWeight"],
  netWeight: ["netWeight"],

  // Pieces / Quantity
  pcs: ["quantity"],
  pieces: ["quantity"],
  qty: ["quantity"],
  quantity: ["quantity"],
  noOfPieces: ["quantity"],
  no_of_pieces: ["quantity"],

  // Packing
  packing: ["packingType"],
  packingType: ["packingType"],
  packing_type: ["packingType"],
  packageType: ["packingType"],

  // Dimensions
  dim: ["dimensions"],
  dimensions: ["dimensions"],

  // Volume / CBM
  cbm: ["measurement"],
  volume: ["measurement"],
  measurement: ["measurement"],
  volumeCbm: ["measurement"],

  // Origin — fills both origin AND portOfLoading
  from: ["origin", "portOfLoading"],
  origin: ["origin", "portOfLoading"],
  originCity: ["origin"],
  originAirport: ["origin", "portOfLoading"],
  origin_airport: ["origin", "portOfLoading"],
  pol: ["origin", "portOfLoading"],
  aog: ["portOfLoading"],
  portOfLoading: ["portOfLoading"],
  port_of_loading: ["portOfLoading"],
  airportOfDeparture: ["origin", "portOfLoading"],
  departurePort: ["origin", "portOfLoading"],

  // Destination — fills both destination AND portOfDischarge
  to: ["destination", "portOfDischarge"],
  destination: ["destination", "portOfDischarge"],
  destCity: ["destination"],
  destAirport: ["destination", "portOfDischarge"],
  dest_airport: ["destination", "portOfDischarge"],
  destinationAirport: ["destination", "portOfDischarge"],
  destination_airport: ["destination", "portOfDischarge"],
  pod: ["destination", "portOfDischarge"],
  aod: ["portOfDischarge"],
  portOfDischarge: ["portOfDischarge"],
  port_of_discharge: ["portOfDischarge"],
  airportOfArrival: ["destination", "portOfDischarge"],
  arrivalPort: ["destination", "portOfDischarge"],

  // Carrier / Vessel
  airline: ["vessel"],
  carrier: ["vessel"],
  vessel: ["vessel"],
  vesselName: ["vessel"],

  // Flight number / Voyage — flight number is the voyage identifier for air freight
  flightNo: ["voyage"],
  flight_no: ["voyage"],
  flightNumber: ["voyage"],
  flight: ["voyage"],
  voyage: ["voyage"],

  // Flight date — fallback to voyage only when no flight number is present
  flightDate: ["voyage"],
  flight_date: ["voyage"],
  etd: ["voyage"],
  flightDateVoyage: ["voyage"],

  // Marks
  marks: ["marksAndNumbers"],
  marksAndNumbers: ["marksAndNumbers"],
  marks_and_numbers: ["marksAndNumbers"],

  // Notes / Remarks
  remarks: ["notes"],
  notes: ["notes"],
  specialInstructions: ["notes"],
  handling: ["notes"],
};

// ── Scan state ────────────────────────────────────────────────────────────────

type ScanState =
  | { kind: "idle" }
  | { kind: "scanning" }
  | { kind: "uploading"; fileName: string }
  | { kind: "json"; fields: FreightFormFields; isAwb: boolean; source?: "qr" | "upload" }
  | { kind: "text"; value: string; targetField: keyof FreightFormFields | "" };

interface Props {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  onApply: (fields: FreightFormFields) => void;
}

// ── Sample AWB JSON ───────────────────────────────────────────────────────────

const AWB_SAMPLE = JSON.stringify(
  {
    awbNumber: "081-12345678",
    shipper: "PT. Maju Bersama",
    shipperAddr: "Jl. Sudirman No. 1, Jakarta",
    consignee: "Singapore Trading Co. Pte. Ltd.",
    consigneeAddr: "10 Kallang Ave, Singapore 339510",
    notify: "Same as consignee",
    originAirport: "Jakarta (CGK)",
    destAirport: "Singapore (SIN)",
    airline: "Garuda Indonesia",
    flightNo: "GA 826",
    flightDate: "2026-05-10",
    pcs: "5",
    gw: "150.5",
    nw: "148.0",
    cbm: "1.2",
    goods: "Peralatan Elektronik",
    hs: "8471.30.00",
    packing: "Karton",
    dim: "60x40x50 cm",
    remarks: "Handle with care",
  },
  null,
  2
);

// ── Component ─────────────────────────────────────────────────────────────────

export function FreightScanDialog({ open, onOpenChange, onApply }: Props) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const readerRef = useRef<any>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const [scanState, setScanState] = useState<ScanState>({ kind: "idle" });
  const [cameraError, setCameraError] = useState<string | null>(null);
  const [applied, setApplied] = useState(false);
  const [showFormat, setShowFormat] = useState(false);
  const [lastTruncation, setLastTruncation] = useState<{ phrase: string; lineIndex: number } | null>(null);
  const [lastCharLimitHit, setLastCharLimitHit] = useState(false);

  const stopCamera = useCallback(() => {
    try {
      readerRef.current?.reset?.();
    } catch {
      /* ignore */
    }
    readerRef.current = null;
    streamRef.current?.getTracks().forEach((t) => t.stop());
    streamRef.current = null;
    if (videoRef.current) videoRef.current.srcObject = null;
  }, []);

  const startScanning = useCallback(async () => {
    setCameraError(null);
    setScanState({ kind: "scanning" });
    setApplied(false);
    setShowFormat(false);
    try {
      const { BrowserMultiFormatReader } = await import("@zxing/browser");
      const reader = new BrowserMultiFormatReader();
      readerRef.current = reader;

      const stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: "environment" },
      });
      streamRef.current = stream;

      if (videoRef.current) {
        videoRef.current.srcObject = stream;
        await videoRef.current.play();
      }

      reader.decodeFromStream(stream, videoRef.current!, (result) => {
        if (result) {
          const text = result.getText();
          stopCamera();
          parseResult(text);
        }
      });
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : "Gagal mengakses kamera";
      setCameraError(
        msg.toLowerCase().includes("permission") || msg.toLowerCase().includes("denied")
          ? "Izin kamera ditolak. Aktifkan akses kamera di pengaturan browser."
          : msg
      );
      setScanState({ kind: "idle" });
    }
  }, [stopCamera]);

  function parseResult(text: string) {
    try {
      const obj = JSON.parse(text);
      if (typeof obj === "object" && obj !== null) {
        const fields: FreightFormFields = {};
        let matched = 0;
        let isAwb = false;

        // First pass: direct field name match
        const AWB_DIRECT_KEYS = new Set(["vessel", "voyage", "marksAndNumbers", "grossWeight", "quantity", "shipperName", "consigneeName"]);
        for (const key of VALID_KEYS) {
          if (key in obj && obj[key] !== undefined && obj[key] !== null) {
            (fields as Record<string, string>)[key] = String(obj[key]);
            matched++;
            if (AWB_DIRECT_KEYS.has(key)) isAwb = true;
          }
        }

        // Second pass: AWB alias match
        for (const [alias, targets] of Object.entries(AWB_ALIASES)) {
          if (alias in obj && obj[alias] !== undefined && obj[alias] !== null) {
            const val = String(obj[alias]);
            for (const target of targets!) {
              if (!(target in fields)) {
                (fields as Record<string, string>)[target] = val;
                matched++;
              }
            }
            // Detect AWB format by known AWB keys
            if (["awb", "awbNumber", "mawb", "hawb", "awb_number", "airline", "vessel", "voyage", "flightNo", "pcs", "gw"].includes(alias)) {
              isAwb = true;
            }
          }
        }

        if (matched > 0) {
          setScanState({ kind: "json", fields, isAwb });
          return;
        }
      }
    } catch {
      // not JSON — fall through to text mode
    }

    // Plain text / barcode — auto-detect AWB number pattern (e.g. "081-12345678")
    const awbPattern = /^\d{3}-\d{7,8}$/;
    if (awbPattern.test(text.trim())) {
      setScanState({
        kind: "text",
        value: text.trim(),
        targetField: "marksAndNumbers",
      });
    } else {
      setScanState({ kind: "text", value: text, targetField: "" });
    }
  }

  function handleApplyJson(fields: FreightFormFields) {
    onApply(fields);
    setApplied(true);
    setTimeout(() => {
      onOpenChange(false);
      setScanState({ kind: "idle" });
      setApplied(false);
    }, 1200);
  }

  function handleApplyText() {
    const state = scanState as {
      kind: "text";
      value: string;
      targetField: keyof FreightFormFields | "";
    };
    if (!state.targetField) return;
    onApply({ [state.targetField]: state.value } as FreightFormFields);
    setApplied(true);
    setTimeout(() => {
      onOpenChange(false);
      setScanState({ kind: "idle" });
      setApplied(false);
    }, 1200);
  }

  function handleRescan() {
    setScanState({ kind: "idle" });
    setApplied(false);
    setCameraError(null);
    setLastTruncation(null);
    setLastCharLimitHit(false);
  }

  async function handleFileUpload(file: File) {
    setScanState({ kind: "uploading", fileName: file.name });
    setApplied(false);
    setCameraError(null);
    setLastTruncation(null);
    setLastCharLimitHit(false);
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
        throw new Error((err as { message?: string })?.message ?? `Error ${resp.status}`);
      }
      const json = (await resp.json()) as {
        data: Record<string, unknown>;
        mode?: string;
        truncation?: { phrase: string; lineIndex: number } | null;
        charLimitHit?: boolean;
      };
      if (json.truncation) setLastTruncation(json.truncation);
      if (json.charLimitHit) setLastCharLimitHit(true);
      const text = JSON.stringify(json.data ?? {});
      const matched = parseResultFromUpload(text);
      if (!matched) {
        toast.error("Tidak ada field yang dapat dikenali dari dokumen");
        setScanState({ kind: "idle" });
      }
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : "Gagal memproses dokumen";
      toast.error(msg);
      setScanState({ kind: "idle" });
    }
  }

  function parseResultFromUpload(text: string): boolean {
    try {
      const obj = JSON.parse(text);
      if (typeof obj === "object" && obj !== null) {
        const fields: FreightFormFields = {};
        let matched = 0;
        let isAwb = false;

        const AWB_DIRECT_KEYS_UPLOAD = new Set(["vessel", "voyage", "marksAndNumbers", "grossWeight", "quantity", "shipperName", "consigneeName"]);
        for (const key of VALID_KEYS) {
          if (key in obj && obj[key] !== undefined && obj[key] !== null && obj[key] !== "") {
            (fields as Record<string, string>)[key] = String(obj[key]);
            matched++;
            if (AWB_DIRECT_KEYS_UPLOAD.has(key)) isAwb = true;
          }
        }

        for (const [alias, targets] of Object.entries(AWB_ALIASES)) {
          if (alias in obj && obj[alias] !== undefined && obj[alias] !== null && obj[alias] !== "") {
            const val = String(obj[alias]);
            for (const target of targets!) {
              if (!(target in fields)) {
                (fields as Record<string, string>)[target] = val;
                matched++;
              }
            }
            if (["awb", "awbNumber", "mawb", "hawb", "awb_number", "airline", "vessel", "voyage", "flightNo", "pcs", "gw"].includes(alias)) {
              isAwb = true;
            }
          }
        }

        if (matched > 0) {
          setScanState({ kind: "json", fields, isAwb, source: "upload" });
          return true;
        }
      }
    } catch {
      /* not JSON */
    }
    return false;
  }

  function handleFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (file) handleFileUpload(file);
    e.target.value = "";
  }

  useEffect(() => {
    if (!open) {
      stopCamera();
      setScanState({ kind: "idle" });
      setCameraError(null);
      setApplied(false);
      setShowFormat(false);
      setLastTruncation(null);
    }
    return () => stopCamera();
  }, [open, stopCamera]);

  const isScanningOrIdle =
    scanState.kind === "idle" || scanState.kind === "scanning";

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <QrCode className="h-5 w-5" />
            Scan AWB / Dokumen
          </DialogTitle>
        </DialogHeader>

        <div className="space-y-4">
          {/* Action buttons — show when idle (no camera, no upload, no result) */}
          {scanState.kind === "idle" && (
            <div className="space-y-3">
              <p className="text-sm text-muted-foreground">
                Pilih cara untuk mengisi form freight: scan QR code AWB pakai kamera, atau upload file MAWB / BL / dokumen pengiriman (PDF / foto). AI akan mengekstrak data otomatis.
              </p>
              <div className="grid grid-cols-2 gap-2">
                <Button
                  variant="outline"
                  className="h-auto flex-col gap-2 py-4"
                  onClick={startScanning}
                >
                  <Camera className="h-6 w-6" />
                  <span className="text-sm font-medium">Pakai Kamera</span>
                  <span className="text-xs text-muted-foreground font-normal">QR / Barcode AWB</span>
                </Button>
                <Button
                  variant="outline"
                  className="h-auto flex-col gap-2 py-4"
                  onClick={() => fileInputRef.current?.click()}
                >
                  <Upload className="h-6 w-6" />
                  <span className="text-sm font-medium">Upload File</span>
                  <span className="text-xs text-muted-foreground font-normal">PDF / Foto MAWB</span>
                </Button>
              </div>
              <input
                ref={fileInputRef}
                type="file"
                accept="image/*,application/pdf"
                className="hidden"
                onChange={handleFileChange}
              />
            </div>
          )}

          {/* Camera view */}
          {scanState.kind === "scanning" && (
            <div className="relative rounded-lg overflow-hidden bg-black aspect-video">
              <video
                ref={videoRef}
                className="w-full h-full object-cover"
                autoPlay
                muted
                playsInline
              />
              <div className="absolute inset-0 flex flex-col items-center justify-center pointer-events-none">
                <ScanLine className="h-10 w-10 text-white/80 animate-pulse" />
                <span className="text-white/80 text-xs mt-2 bg-black/40 px-2 py-1 rounded">
                  Arahkan ke QR code AWB atau barcode
                </span>
              </div>
            </div>
          )}

          {/* Upload progress */}
          {scanState.kind === "uploading" && (
            <div className="flex flex-col items-center gap-3 py-8 border rounded-lg bg-muted/30">
              <Loader2 className="h-8 w-8 animate-spin text-primary" />
              <div className="text-center">
                <p className="text-sm font-medium">Mengekstrak data dengan AI...</p>
                <p className="text-xs text-muted-foreground mt-1 max-w-xs truncate">{scanState.fileName}</p>
                <p className="text-xs text-muted-foreground mt-2">PDF teks: ±5–10 detik · PDF/foto hasil scan: ±30–60 detik</p>
              </div>
            </div>
          )}

          {/* Camera error */}
          {cameraError && scanState.kind !== "scanning" && (
            <div className="flex items-start gap-2 p-3 rounded-lg bg-destructive/10 text-destructive text-sm">
              <AlertCircle className="h-4 w-4 mt-0.5 shrink-0" />
              <div>
                <p className="font-medium">Tidak dapat mengakses kamera</p>
                <p className="text-xs mt-0.5">{cameraError}</p>
              </div>
            </div>
          )}

          {/* JSON / AWB result (from QR scan or AI upload) */}
          {scanState.kind === "json" && (
            <div className="space-y-3">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2 text-sm font-medium text-green-600">
                  <CheckCircle className="h-4 w-4" />
                  {scanState.source === "upload"
                    ? "Data berhasil diekstrak dari dokumen"
                    : scanState.isAwb
                    ? "Data AWB berhasil dibaca"
                    : "QR berhasil dibaca"}
                </div>
                <span className="text-xs font-semibold text-emerald-700 bg-emerald-100 border border-emerald-200 rounded-full px-2 py-0.5">
                  {Object.keys(scanState.fields).length} field aktif
                </span>
              </div>
              {lastTruncation && scanState.source === "upload" && (
                <div className="flex items-start gap-1.5 text-xs text-amber-700 bg-amber-50 border border-amber-200 rounded-md px-2.5 py-1.5">
                  <FileText className="h-3.5 w-3.5 shrink-0 text-amber-500 mt-0.5" />
                  <span>Teks PDF dipotong di baris {lastTruncation.lineIndex + 1} (<span className="font-medium">"{lastTruncation.phrase}"</span>) — data setelahnya tidak dikirim ke AI. Periksa field yang mungkin kosong.</span>
                </div>
              )}
              {lastCharLimitHit && !lastTruncation && scanState.source === "upload" && (
                <div className="flex items-start gap-1.5 text-xs text-amber-700 bg-amber-50 border border-amber-200 rounded-md px-2.5 py-1.5">
                  <FileText className="h-3.5 w-3.5 shrink-0 text-amber-500 mt-0.5" />
                  <span>Dokumen panjang — teks dipotong di 5.000 karakter pertama. Data di halaman akhir mungkin tidak terbaca. Periksa field yang kosong.</span>
                </div>
              )}
              <div className="max-h-60 overflow-y-auto space-y-1 rounded-lg border border-emerald-200 bg-emerald-50/40 p-2">
                {(Object.entries(scanState.fields) as [keyof FreightFormFields, string][]).map(([key, value]) => (
                  <div key={key} className="flex items-start gap-2 text-xs rounded-md bg-white/80 border border-emerald-100 px-2 py-1.5">
                    <span className="mt-0.5 h-2 w-2 shrink-0 rounded-full bg-emerald-500" />
                    <span className="font-medium text-foreground/60 min-w-[110px] shrink-0">{FIELD_LABELS[key]}</span>
                    <span className="text-foreground font-medium break-all">{value}</span>
                  </div>
                ))}
              </div>
              {applied ? (
                <div className="flex items-center gap-2 text-green-600 text-sm">
                  <CheckCircle className="h-4 w-4" />
                  Form berhasil diisi!
                </div>
              ) : (
                <div className="flex gap-2">
                  <Button
                    className="flex-1"
                    onClick={() => handleApplyJson(scanState.fields)}
                  >
                    Isi Form Sekarang
                  </Button>
                  <Button
                    variant="outline"
                    size="icon"
                    onClick={handleRescan}
                    title="Scan ulang"
                  >
                    <X className="h-4 w-4" />
                  </Button>
                </div>
              )}
            </div>
          )}

          {/* Plain text result */}
          {scanState.kind === "text" && (
            <div className="space-y-3">
              <div className="flex items-center gap-2 text-sm font-medium text-blue-600">
                <ScanLine className="h-4 w-4" />
                Hasil scan (teks / barcode)
              </div>
              <div className="rounded-lg border p-3 bg-muted/30 font-mono text-sm break-all">
                {scanState.value}
              </div>
              <div className="space-y-1.5">
                <Label className="text-xs text-muted-foreground">
                  Masukkan ke field:
                </Label>
                <Select
                  value={scanState.targetField}
                  onValueChange={(v) =>
                    setScanState((s) => ({
                      ...s,
                      targetField: v as keyof FreightFormFields,
                    }))
                  }
                >
                  <SelectTrigger>
                    <SelectValue placeholder="Pilih field tujuan..." />
                  </SelectTrigger>
                  <SelectContent>
                    {VALID_KEYS.map((k) => (
                      <SelectItem key={k} value={k}>
                        {FIELD_LABELS[k]}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              {applied ? (
                <div className="flex items-center gap-2 text-green-600 text-sm">
                  <CheckCircle className="h-4 w-4" />
                  Field berhasil diisi!
                </div>
              ) : (
                <div className="flex gap-2">
                  <Button
                    className="flex-1"
                    disabled={!scanState.targetField}
                    onClick={handleApplyText}
                  >
                    Isi Field
                  </Button>
                  <Button
                    variant="outline"
                    size="icon"
                    onClick={handleRescan}
                    title="Scan ulang"
                  >
                    <X className="h-4 w-4" />
                  </Button>
                </div>
              )}
            </div>
          )}

          {/* AWB format reference */}
          <Collapsible open={showFormat} onOpenChange={setShowFormat}>
            <CollapsibleTrigger asChild>
              <Button
                variant="ghost"
                size="sm"
                className="w-full flex items-center justify-between text-xs text-muted-foreground hover:text-foreground"
                type="button"
              >
                <span className="flex items-center gap-1.5">
                  <FileText className="h-3.5 w-3.5" />
                  Lihat format QR AWB yang didukung
                </span>
                <ChevronDown
                  className={`h-3.5 w-3.5 transition-transform ${showFormat ? "rotate-180" : ""}`}
                />
              </Button>
            </CollapsibleTrigger>
            <CollapsibleContent>
              <div className="mt-2 space-y-2">
                <p className="text-xs text-muted-foreground">
                  Buat QR code dari JSON berikut. Field AWB standar seperti{" "}
                  <code className="bg-muted px-1 rounded">awbNumber</code>,{" "}
                  <code className="bg-muted px-1 rounded">shipper</code>,{" "}
                  <code className="bg-muted px-1 rounded">originAirport</code>,{" "}
                  <code className="bg-muted px-1 rounded">gw</code>,{" "}
                  <code className="bg-muted px-1 rounded">pcs</code>, dll.
                  langsung dikenali.
                </p>
                <pre className="text-xs bg-muted rounded-lg p-3 overflow-x-auto whitespace-pre-wrap break-all leading-relaxed">
                  {AWB_SAMPLE}
                </pre>
              </div>
            </CollapsibleContent>
          </Collapsible>
        </div>

        <DialogFooter className="mt-2">
          <Button
            variant="ghost"
            size="sm"
            onClick={() => onOpenChange(false)}
          >
            Tutup
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
