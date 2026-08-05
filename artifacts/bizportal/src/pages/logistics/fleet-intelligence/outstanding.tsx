import { useState, useRef, useCallback, useEffect } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { AppShell } from "@/components/layout/AppShell";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import {
  AlertTriangle, CheckCircle, DollarSign, Wrench, RefreshCw,
  MessageCircle, Send, RotateCcw, History, ChevronDown, ChevronUp, ArrowLeft,
  Upload, FileText, Users, AlertCircle, ClipboardList, Download, ArrowUpDown,
  ArrowUp, ArrowDown, Clock, Bell, BellOff,
} from "lucide-react";
import { Switch } from "@/components/ui/switch";
import { Link } from "wouter";
import { toast } from "sonner";

/* ─── helpers ──────────────────────────────────────────────────────────── */
function fmtIdr(v: unknown) {
  return new Intl.NumberFormat("id-ID", { style: "currency", currency: "IDR", maximumFractionDigits: 0 })
    .format(parseFloat(String(v ?? 0)) || 0);
}
function fmtNum(v: unknown) {
  return new Intl.NumberFormat("id-ID").format(parseFloat(String(v ?? 0)) || 0);
}
function fmtDatetime(v: unknown): string {
  if (!v || v === "null") return "-";
  try {
    return new Intl.DateTimeFormat("id-ID", {
      day: "2-digit", month: "short", year: "2-digit",
      hour: "2-digit", minute: "2-digit",
    }).format(new Date(String(v)));
  } catch { return "-"; }
}
function fmtDate(v: unknown): string {
  if (!v || v === "null") return "-";
  try {
    return new Intl.DateTimeFormat("id-ID", { day: "2-digit", month: "short", year: "numeric" })
      .format(new Date(String(v)));
  } catch { return "-"; }
}

/* ─── export helpers ────────────────────────────────────────────────────── */
type PreviewRow = {
  driver_name: string; phone_number: string; license_plate: string;
  rental_fee_daily: number; outstanding: number; status: string;
  match_status: string; matched_name: string | null;
};

function exportPreviewCsv(rows: PreviewRow[]) {
  const header = "Driver Name,Phone Number,License Plate,Rental Fee (Daily),Outstanding,Status,Match";
  const lines = rows.map((r) =>
    [r.driver_name, r.phone_number, r.license_plate || "",
     r.rental_fee_daily, r.outstanding, r.status,
     r.match_status === "found" ? "Cocok" : "Tidak Cocok"]
      .map((v) => `"${String(v).replace(/"/g, '""')}"`)
      .join(",")
  );
  const blob = new Blob([header + "\n" + lines.join("\n")], { type: "text/csv;charset=utf-8;" });
  const url  = URL.createObjectURL(blob);
  const a    = document.createElement("a"); a.href = url;
  a.download = `preview_outstanding_${new Date().toISOString().slice(0,10)}.csv`;
  a.click(); URL.revokeObjectURL(url);
}

function exportPreviewXlsx(rows: PreviewRow[]) {
  const header = ["Driver Name","Phone Number","License Plate","Rental Fee (Daily)","Outstanding","Status","Match"];
  const dataRows = rows.map((r) => [
    r.driver_name, r.phone_number, r.license_plate || "",
    r.rental_fee_daily, r.outstanding, r.status,
    r.match_status === "found" ? "Cocok" : "Tidak Cocok",
  ]);
  const maxW = [30,20,14,18,16,16,12];
  const colToLetter = (n: number) => String.fromCharCode(65 + n);
  const esc = (v: unknown) => {
    const s = String(v ?? "");
    return s.replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;").replace(/"/g,"&quot;");
  };
  const cellXml = (val: unknown, col: number, row: number) => {
    const isNum = typeof val === "number";
    const ref = `${colToLetter(col)}${row}`;
    return isNum
      ? `<c r="${ref}" t="n"><v>${val}</v></c>`
      : `<c r="${ref}" t="inlineStr"><is><t>${esc(val)}</t></is></c>`;
  };
  const makeRow = (vals: unknown[], rowIdx: number) =>
    `<row r="${rowIdx}">${vals.map((v, c) => cellXml(v, c, rowIdx)).join("")}</row>`;

  const sheetData = [makeRow(header, 1), ...dataRows.map((r, i) => makeRow(r, i + 2))].join("");
  const colDefs   = maxW.map((w, i) => `<col min="${i+1}" max="${i+1}" width="${w}" bestFit="1"/>`).join("");

  const sheetXml = `<?xml version="1.0" encoding="UTF-8"?>
<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">
<cols>${colDefs}</cols><sheetData>${sheetData}</sheetData></worksheet>`;

  const wbXml = `<?xml version="1.0" encoding="UTF-8"?>
<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"
  xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">
<sheets><sheet name="Preview Outstanding" sheetId="1" r:id="rId1"/></sheets></workbook>`;

  const relXml = `<?xml version="1.0" encoding="UTF-8"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/>
</Relationships>`;

  const ctXml = `<?xml version="1.0" encoding="UTF-8"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
<Default Extension="xml"  ContentType="application/xml"/>
<Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>
<Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>
</Types>`;

  function toUint8(s: string) { return new TextEncoder().encode(s); }
  function crc32(buf: Uint8Array) {
    const tbl: number[] = []; for (let i = 0; i < 256; i++) { let c = i; for (let j = 0; j < 8; j++) c = c & 1 ? (0xEDB88320 ^ (c >>> 1)) : c >>> 1; tbl.push(c); }
    let c = 0xFFFFFFFF; for (const b of buf) c = tbl[(c ^ b) & 0xFF] ^ (c >>> 8); return (c ^ 0xFFFFFFFF) >>> 0;
  }
  function deflateStore(data: Uint8Array): Uint8Array {
    const out: number[] = [0x78, 0x01];
    for (let i = 0; i < data.length; i += 65535) {
      const chunk = data.slice(i, i + 65535); const last = i + 65535 >= data.length;
      out.push(last ? 1 : 0); out.push(chunk.length & 0xFF, (chunk.length >> 8) & 0xFF);
      out.push((~chunk.length) & 0xFF, ((~chunk.length) >> 8) & 0xFF); out.push(...chunk);
    }
    const adler = ((data.reduce((s1, b) => (s1 + b) % 65521, 1)) | 0);
    out.push((adler >> 24) & 0xFF, (adler >> 16) & 0xFF, (adler >> 8) & 0xFF, adler & 0xFF);
    return new Uint8Array(out);
  }
  function localHeader(name: string, data: Uint8Array, crc: number, compressed: Uint8Array) {
    const nb = toUint8(name);
    const h = new Uint8Array(30 + nb.length);
    const v = new DataView(h.buffer);
    v.setUint32(0, 0x04034B50, true); v.setUint16(4, 20, true); v.setUint16(6, 0, true);
    v.setUint16(8, 8, true); v.setUint16(10, 0, true); v.setUint16(12, 0, true);
    v.setUint32(14, crc, true); v.setUint32(18, compressed.length, true); v.setUint32(22, data.length, true);
    v.setUint16(26, nb.length, true); v.setUint16(28, 0, true); h.set(nb, 30); return h;
  }
  function centralDir(name: string, crc: number, compressed: number, original: number, offset: number) {
    const nb = toUint8(name);
    const h = new Uint8Array(46 + nb.length); const v = new DataView(h.buffer);
    v.setUint32(0, 0x02014B50, true); v.setUint16(4, 20, true); v.setUint16(6, 20, true);
    v.setUint16(8, 0, true); v.setUint16(10, 8, true); v.setUint16(12, 0, true); v.setUint16(14, 0, true);
    v.setUint32(16, crc, true); v.setUint32(20, compressed, true); v.setUint32(24, original, true);
    v.setUint16(28, nb.length, true); v.setUint16(30, 0, true); v.setUint16(32, 0, true);
    v.setUint16(34, 0, true); v.setUint16(36, 0, true); v.setUint32(38, 0, true);
    v.setUint32(42, offset, true); h.set(nb, 46); return h;
  }
  function eocd(count: number, cdSize: number, cdOffset: number) {
    const h = new Uint8Array(22); const v = new DataView(h.buffer);
    v.setUint32(0, 0x06054B50, true); v.setUint16(4, 0, true); v.setUint16(6, 0, true);
    v.setUint16(8, count, true); v.setUint16(10, count, true);
    v.setUint32(12, cdSize, true); v.setUint32(16, cdOffset, true); v.setUint16(20, 0, true); return h;
  }
  const files: Array<{ name: string; data: Uint8Array }> = [
    { name: "[Content_Types].xml", data: toUint8(ctXml) },
    { name: "_rels/.rels", data: toUint8(relXml) },
    { name: "xl/workbook.xml", data: toUint8(wbXml) },
    { name: "xl/worksheets/sheet1.xml", data: toUint8(sheetXml) },
  ];
  const parts: Uint8Array[] = []; const cds: Uint8Array[] = []; const offsets: number[] = [];
  let offset = 0;
  for (const f of files) {
    const crc = crc32(f.data); const comp = deflateStore(f.data);
    const lh = localHeader(f.name, f.data, crc, comp);
    offsets.push(offset); offset += lh.length + comp.length;
    parts.push(lh); parts.push(comp);
    cds.push(centralDir(f.name, crc, comp.length, f.data.length, offsets[offsets.length - 1]));
  }
  const cdSize = cds.reduce((s, c) => s + c.length, 0);
  const all = [...parts, ...cds, eocd(files.length, cdSize, offset)];
  const total = all.reduce((s, a) => s + a.length, 0);
  const out = new Uint8Array(total); let pos = 0;
  for (const a of all) { out.set(a, pos); pos += a.length; }
  const blob = new Blob([out], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a"); a.href = url;
  a.download = `preview_outstanding_${new Date().toISOString().slice(0,10)}.xlsx`;
  a.click(); URL.revokeObjectURL(url);
}

function buildTemplate(name: string, plate: string, phone: string, amount: string): string {
  return (
    `*Pemberitahuan Pembayaran Rental Fee*\n\n` +
    `Nama Driver: ${name}\nNomor Kendaraan: ${plate}\nNomor Telepon: ${phone}\nTotal Outstanding: ${amount}\n\n` +
    `*Instruksi Pembayaran*\n\n` +
    `Kami mohon agar pembayaran rental fee segera dilakukan melalui salah satu cara berikut:\n\n` +
    `Top-up Saldo GoPay\nSilakan isi saldo GoPay sesuai nominal outstanding di atas.\n` +
    `Transfer Bank ke Rekening Perusahaan\nLakukan transfer ke rekening resmi perusahaan. ` +
    `Pastikan mencantumkan nama driver dan nomor kendaraan pada kolom keterangan untuk proses rekonsiliasi.\n\n` +
    `*Catatan Penting:*\n\nPembayaran tepat waktu sangat membantu kelancaran operasional.\n` +
    `Simpan bukti pembayaran untuk verifikasi lebih lanjut.`
  );
}

const BULK_HINT = buildTemplate("{nama}", "{plat}", "{hp}", "{jumlah}");

type WaPreview = { id: number; phone: string; name: string; message: string; defaultMessage: string };

const SEND_TYPE_LABEL: Record<string, string> = {
  manual: "Manual", bulk: "Bulk", auto_daily: "Otomatis (1×/hari)", auto_3x: "Otomatis (3×/hari)",
};

type ImportResult = {
  ok: boolean;
  updated: number;
  inserted: number;
  skipped: number;
  total: number;
  message: string;
};

type ImportLog = {
  id: number;
  report_file_name: string;
  uploaded_by: string;
  uploaded_at: string;
  total_rows: number;
  rows_imported: number;
  rows_skipped: number;
  unmatched_drivers: number;
};

/* ─── component ────────────────────────────────────────────────────────── */
export default function FleetOutstandingPage() {
  const qc = useQueryClient();

  /* tab state */
  const [activeTab, setActiveTab] = useState<"list" | "upload">("list");

  /* list tab state */
  const [status, setStatus] = useState("open");
  const [resolving, setResolving] = useState<number | null>(null);
  const [notes, setNotes] = useState("");
  const [waPreview, setWaPreview] = useState<WaPreview | null>(null);
  const [waSending, setWaSending] = useState(false);
  const [bulkOpen, setBulkOpen] = useState(false);
  const [showLogs, setShowLogs] = useState(false);
  const [selectedIds, setSelectedIds] = useState<Set<number>>(new Set());
  const [waBlastOpen, setWaBlastOpen] = useState(false);

  const [sortCol, setSortCol] = useState<"driver_name" | "rental_fee_daily" | "outstanding_amount" | null>(null);
  const [sortDir, setSortDir] = useState<"asc" | "desc">("asc");
  const [plateFilter, setPlateFilter] = useState<"all" | "has_plate" | "no_plate">("all");
  const [search, setSearch] = useState("");

  function toggleSort(col: "driver_name" | "rental_fee_daily" | "outstanding_amount") {
    if (sortCol === col) setSortDir((d) => (d === "asc" ? "desc" : "asc"));
    else { setSortCol(col); setSortDir("asc"); }
  }

  /* upload tab state */
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [previewRows, setPreviewRows] = useState<PreviewRow[] | null>(null);
  const [previewMeta, setPreviewMeta] = useState<{ total: number; found: number; unmatched: number; skipped: number } | null>(null);
  const [previewLoading, setPreviewLoading] = useState(false);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [importResult, setImportResult] = useState<ImportResult | null>(null);
  const [showImportLog, setShowImportLog] = useState(false);
  const [clearFirst, setClearFirst] = useState(false);

  /* auto-blast state */
  const [autoBlastHour, setAutoBlastHour] = useState<number>(8);
  const [autoBlastSaving, setAutoBlastSaving] = useState(false);

  /* ── QUERIES ──────────────────────────────────────────────────────── */
  const { data: autoBlastSettings, refetch: refetchAutoBlast } = useQuery({
    queryKey: ["fleet-auto-blast-settings"],
    queryFn: async () => {
      const res = await fetch("/api/logistics/fleet/outstanding/auto-blast-settings", { credentials: "include" });
      if (!res.ok) return { enabled: false, hour: 8, last_run: null as string | null };
      return res.json() as Promise<{ enabled: boolean; hour: number; last_run: string | null }>;
    },
    staleTime: 30_000,
  });

  useEffect(() => {
    if (autoBlastSettings?.hour != null) setAutoBlastHour(autoBlastSettings.hour);
  }, [autoBlastSettings?.hour]);

  const autoBlastEnabled = autoBlastSettings?.enabled ?? false;
  const autoBlastLastRun = autoBlastSettings?.last_run ?? null;

  async function saveAutoBlast(enabled: boolean, hour?: number) {
    setAutoBlastSaving(true);
    try {
      const res = await fetch("/api/logistics/fleet/outstanding/auto-blast-settings", {
        method: "PUT", credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ enabled, hour: hour ?? autoBlastHour }),
      });
      if (!res.ok) throw new Error("Gagal simpan");
      toast.success(enabled ? `Auto-blast aktif — setiap hari jam ${String(hour ?? autoBlastHour).padStart(2,"0")}:00 WIB` : "Auto-blast dinonaktifkan");
      refetchAutoBlast();
    } catch {
      toast.error("Gagal simpan setting auto-blast");
    } finally {
      setAutoBlastSaving(false);
    }
  }

  const { data, isLoading, refetch } = useQuery({
    queryKey: ["fleet-outstanding", status],
    queryFn: async () => {
      const res = await fetch(`/api/logistics/fleet/outstanding?status=${status}`, { credentials: "include" });
      return res.json() as Promise<{ outstanding: Array<Record<string, unknown>>; summary: Record<string, unknown> }>;
    },
  });

  const { data: logData, refetch: refetchLogs } = useQuery({
    queryKey: ["fleet-wa-logs"],
    queryFn: async () => {
      const res = await fetch("/api/logistics/fleet/outstanding/wa-logs?limit=100", { credentials: "include" });
      return res.json() as Promise<{ logs: Array<Record<string, unknown>>; total: number }>;
    },
    enabled: showLogs,
  });

  const { data: importLogData, refetch: refetchImportLog } = useQuery({
    queryKey: ["fleet-outstanding-import-log"],
    queryFn: async () => {
      const res = await fetch("/api/logistics/fleet/outstanding/import-log", { credentials: "include" });
      if (!res.ok) return { logs: [] as ImportLog[] };
      return res.json() as Promise<{ logs: ImportLog[] }>;
    },
    enabled: showImportLog,
  });

  /* ── MUTATIONS (list tab) ─────────────────────────────────────────── */
  const repairMutation = useMutation({
    mutationFn: async () => {
      const res = await fetch("/api/logistics/fleet/outstanding/repair", { method: "POST", credentials: "include" });
      if (!res.ok) throw new Error("Gagal hitung ulang outstanding");
      return res.json() as Promise<{ ok: boolean; summary: Record<string, unknown> }>;
    },
    onSuccess: (d) => {
      toast.success(`Outstanding diperbarui: ${fmtIdr(d.summary?.total)} dari ${String(d.summary?.drivers ?? 0)} driver`);
      qc.invalidateQueries({ queryKey: ["fleet-outstanding"] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const waAllMutation = useMutation({
    mutationFn: async () => {
      const res = await fetch("/api/logistics/fleet/outstanding/wa-reminder", {
        method: "POST", credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ suppress_hours: 1 }),
      });
      if (!res.ok) throw new Error("Gagal kirim WA reminder");
      return res.json() as Promise<{ ok: boolean; sent: number; failed: number }>;
    },
    onSuccess: (d) => {
      toast.success(`WA terkirim ke ${d.sent} driver${d.failed > 0 ? `, ${d.failed} gagal` : ""}`);
      setBulkOpen(false);
      qc.invalidateQueries({ queryKey: ["fleet-outstanding"] });
      qc.invalidateQueries({ queryKey: ["fleet-wa-logs"] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const waBlastMutation = useMutation({
    mutationFn: async (ids: number[]) => {
      const res = await fetch("/api/logistics/fleet/outstanding/wa-blast", {
        method: "POST", credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ids }),
      });
      if (!res.ok) throw new Error("Gagal kirim WA blast");
      return res.json() as Promise<{ ok: boolean; sent: number; failed: number; total: number }>;
    },
    onSuccess: (d) => {
      toast.success(`WA terkirim ke ${d.sent} driver${d.failed > 0 ? `, ${d.failed} gagal` : ""}`);
      setWaBlastOpen(false);
      setSelectedIds(new Set());
      qc.invalidateQueries({ queryKey: ["fleet-outstanding"] });
      qc.invalidateQueries({ queryKey: ["fleet-wa-logs"] });
      if (showLogs) refetchLogs();
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const resolveMutation = useMutation({
    mutationFn: async () => {
      const res = await fetch(`/api/logistics/fleet/outstanding/${resolving}/resolve`, {
        method: "PUT", credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ notes }),
      });
      if (!res.ok) throw new Error("Gagal resolve outstanding");
    },
    onSuccess: () => {
      toast.success("Outstanding berhasil ditandai lunas");
      setResolving(null); setNotes("");
      qc.invalidateQueries({ queryKey: ["fleet-outstanding"] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  /* ── UPLOAD TAB LOGIC ─────────────────────────────────────────────── */
  const handleFileChange = useCallback(async (file: File) => {
    setSelectedFile(file);
    setPreviewRows(null);
    setPreviewMeta(null);
    setImportResult(null);
    setPreviewLoading(true);
    try {
      const fd = new FormData();
      fd.append("file", file);
      const res = await fetch("/api/logistics/fleet/outstanding/snapshot/preview", {
        method: "POST", credentials: "include", body: fd,
      });
      const json = await res.json() as {
        ok?: boolean; error?: string;
        rows?: PreviewRow[]; total?: number; found?: number; unmatched?: number; skipped?: number;
      };
      if (!res.ok || !json.ok) throw new Error(json.error ?? "Gagal memproses file");
      // Sort descending by outstanding
      const sorted = (json.rows ?? []).sort((a, b) => b.outstanding - a.outstanding);
      setPreviewRows(sorted);
      setPreviewMeta({
        total: json.total ?? 0,
        found: json.found ?? 0,
        unmatched: json.unmatched ?? 0,
        skipped: json.skipped ?? 0,
      });
    } catch (e: unknown) {
      toast.error(e instanceof Error ? e.message : "Gagal preview file");
      setSelectedFile(null);
      setPreviewRows(null);
    } finally {
      setPreviewLoading(false);
    }
  }, []);

  const doImport = useCallback(async () => {
    if (!selectedFile) return;
    setConfirmOpen(false);
    try {
      const fd = new FormData();
      fd.append("file", selectedFile);
      const url = `/api/logistics/fleet/outstanding/snapshot/import${clearFirst ? "?clearFirst=true" : ""}`;
      const res = await fetch(url, {
        method: "POST", credentials: "include", body: fd,
      });
      const json = await res.json() as ImportResult & { error?: string };
      if (!res.ok || !json.ok) throw new Error(json.error ?? "Gagal import");
      setImportResult(json);
      toast.success(json.message ?? "Import berhasil");
      qc.invalidateQueries({ queryKey: ["fleet-outstanding"] });
      qc.invalidateQueries({ queryKey: ["fleet-outstanding-import-log"] });
      if (showImportLog) refetchImportLog();
    } catch (e: unknown) {
      toast.error(e instanceof Error ? e.message : "Gagal import");
    }
  }, [selectedFile, showImportLog, refetchImportLog, qc]);

  /* ── checkbox helpers ────────────────────────────────────────────── */
  function toggleSelect(id: number) {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });
  }
  function toggleSelectAll() {
    const visibleIds = sortedList.map((o) => Number(o.id));
    const allSelected = visibleIds.length > 0 && visibleIds.every((id) => selectedIds.has(id));
    if (allSelected) setSelectedIds((prev) => { const next = new Set(prev); visibleIds.forEach((id) => next.delete(id)); return next; });
    else setSelectedIds((prev) => { const next = new Set(prev); visibleIds.forEach((id) => next.add(id)); return next; });
  }
  function selectAbove500k() {
    const ids500k = sortedList
      .filter((o) => parseFloat(String(o.outstanding_amount ?? 0)) >= 500_000 && String(o.driver_phone ?? "").trim())
      .map((o) => Number(o.id));
    setSelectedIds(new Set(ids500k));
  }

  /* ── WA helpers ───────────────────────────────────────────────────── */
  function openWaModal(o: Record<string, unknown>) {
    const phone = String(o.driver_phone ?? "").trim();
    if (!phone) { toast.error("Nomor HP driver tidak tersedia"); return; }
    const name   = String(o.driver_name ?? "Driver");
    const plate  = String(o.vehicle_plate ?? "-");
    const amount = fmtIdr(o.outstanding_amount);
    const msg    = buildTemplate(name, plate, phone, amount);
    setWaPreview({ id: Number(o.id), phone, name, message: msg, defaultMessage: msg });
  }

  async function sendWa() {
    if (!waPreview) return;
    setWaSending(true);
    try {
      const res = await fetch(`/api/logistics/fleet/outstanding/${waPreview.id}/wa`, {
        method: "POST", credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ phone: waPreview.phone, message: waPreview.message }),
      });
      if (!res.ok) throw new Error("Gagal kirim WA");
      toast.success(`WA berhasil dikirim ke ${waPreview.name}`);
      setWaPreview(null);
      qc.invalidateQueries({ queryKey: ["fleet-outstanding"] });
      qc.invalidateQueries({ queryKey: ["fleet-wa-logs"] });
      if (showLogs) refetchLogs();
    } catch (e: unknown) {
      toast.error(e instanceof Error ? e.message : "Gagal kirim WA");
    } finally { setWaSending(false); }
  }

  /* ── derived ──────────────────────────────────────────────────────── */
  const list     = data?.outstanding ?? [];
  const summary  = data?.summary ?? {};
  const eligible500k = list.filter(
    (o) => parseFloat(String(o.outstanding_amount ?? 0)) >= 500_000 && String(o.driver_phone ?? "").trim(),
  );
  const noPlateCount = list.filter((o) => {
    const p = String(o.vehicle_plate ?? "").trim();
    return !p || p === "-";
  }).length;
  const hasPlateCount = list.length - noPlateCount;

  const filteredList = list.filter((o) => {
    const plate = String(o.vehicle_plate ?? "").trim();
    const hasPlate = plate && plate !== "-";
    if (plateFilter === "has_plate" && !hasPlate) return false;
    if (plateFilter === "no_plate" && hasPlate) return false;
    if (search.trim()) {
      const q = search.trim().toLowerCase();
      const name = String(o.driver_name ?? "").toLowerCase();
      const phone = String(o.driver_phone ?? "").toLowerCase();
      const plt = plate.toLowerCase();
      if (!name.includes(q) && !phone.includes(q) && !plt.includes(q)) return false;
    }
    return true;
  });

  const sortedList = [...filteredList].sort((a, b) => {
    if (!sortCol) return 0;
    const mul = sortDir === "asc" ? 1 : -1;
    if (sortCol === "driver_name") {
      return mul * String(a.driver_name ?? "").localeCompare(String(b.driver_name ?? ""));
    }
    if (sortCol === "rental_fee_daily") {
      return mul * (parseFloat(String(a.rental_fee_daily ?? 0)) - parseFloat(String(b.rental_fee_daily ?? 0)));
    }
    return mul * (parseFloat(String(a.outstanding_amount ?? 0)) - parseFloat(String(b.outstanding_amount ?? 0)));
  });

  function SortIcon({ col }: { col: "driver_name" | "rental_fee_daily" | "outstanding_amount" }) {
    if (sortCol !== col) return <ArrowUpDown className="w-3.5 h-3.5 ml-1 opacity-40" />;
    return sortDir === "asc" ? <ArrowUp className="w-3.5 h-3.5 ml-1 text-indigo-400" /> : <ArrowDown className="w-3.5 h-3.5 ml-1 text-indigo-400" />;
  }

  const logs       = logData?.logs ?? [];
  const importLogs = importLogData?.logs ?? [];

  /* ── RENDER ───────────────────────────────────────────────────────── */
  return (
    <AppShell>
      <div className="space-y-6">

        <Link href="/logistics/fleet-intelligence">
          <Button variant="ghost" size="sm" className="text-slate-400 hover:text-white gap-1.5 -ml-2">
            <ArrowLeft className="w-4 h-4" /> Fleet Intelligence
          </Button>
        </Link>

        {/* ── Header ─────────────────────────────────────────────────── */}
        <div className="flex items-center justify-between flex-wrap gap-3">
          <div>
            <h1 className="text-2xl font-bold text-white">Outstanding Balance</h1>
            <p className="text-slate-400 text-sm mt-1">Saldo hutang / piutang driver yang belum terselesaikan</p>
          </div>
          {activeTab === "list" && (
            <div className="flex items-center gap-2 flex-wrap">
              {status === "open" && selectedIds.size > 0 && (
                <Button size="sm"
                  className="gap-2 bg-green-600 hover:bg-green-700 text-white"
                  onClick={() => setWaBlastOpen(true)}>
                  <Send className="w-4 h-4" />
                  Kirim WA ke Terpilih ({selectedIds.size})
                </Button>
              )}
              {status === "open" && eligible500k.length > 0 && (
                <Button variant="outline" size="sm"
                  className="gap-2 border-green-600 text-green-400 hover:bg-green-900/20"
                  onClick={() => setBulkOpen(true)}>
                  <MessageCircle className="w-4 h-4" />
                  Blast ≥500rb ({eligible500k.length})
                </Button>
              )}
              <Button variant="outline" size="sm"
                className="gap-2 border-amber-600 text-amber-400 hover:bg-amber-900/20"
                disabled={repairMutation.isPending}
                onClick={() => repairMutation.mutate()}>
                <Wrench className="w-4 h-4" />
                {repairMutation.isPending ? "Menghitung..." : "Hitung Ulang"}
              </Button>
              <Button variant="outline" size="sm" className="gap-2" onClick={() => refetch()}>
                <RefreshCw className="w-4 h-4" />
              </Button>
              <Select value={status} onValueChange={setStatus}>
                <SelectTrigger className="w-40 bg-slate-700 border-slate-600 text-white">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="open">Belum Lunas</SelectItem>
                  <SelectItem value="resolved">Sudah Lunas</SelectItem>
                </SelectContent>
              </Select>
            </div>
          )}
        </div>

        {/* ── Tabs ───────────────────────────────────────────────────── */}
        <div className="flex gap-1 bg-slate-800/60 border border-slate-700 rounded-lg p-1 w-fit">
          {([
            { key: "list",   label: "Daftar Outstanding",   icon: <Users className="w-4 h-4" /> },
            { key: "upload", label: "Ringkasan Outstanding", icon: <Upload className="w-4 h-4" /> },
          ] as const).map((t) => (
            <button
              key={t.key}
              onClick={() => setActiveTab(t.key)}
              className={`flex items-center gap-2 px-4 py-2 rounded-md text-sm font-medium transition-colors ${
                activeTab === t.key
                  ? "bg-indigo-600 text-white shadow"
                  : "text-slate-400 hover:text-white hover:bg-slate-700"
              }`}
            >
              {t.icon}{t.label}
            </button>
          ))}
        </div>

        {/* ══════════════════════════════════════════════════════════════
            TAB 1: DAFTAR OUTSTANDING
        ══════════════════════════════════════════════════════════════ */}
        {activeTab === "list" && (
          <>
            {/* Summary cards */}
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
              <Card className="bg-amber-900/20 border-amber-700/40">
                <CardContent className="p-4 flex items-center gap-3">
                  <DollarSign className="w-8 h-8 text-amber-400" />
                  <div>
                    <div className="text-2xl font-bold text-white">{fmtIdr(summary.total)}</div>
                    <div className="text-amber-300 text-sm">Total Outstanding</div>
                  </div>
                </CardContent>
              </Card>
              <Card className="bg-slate-800/60 border-slate-700">
                <CardContent className="p-4 flex items-center gap-3">
                  <AlertTriangle className="w-8 h-8 text-red-400" />
                  <div>
                    <div className="text-2xl font-bold text-white">{fmtNum(summary.count)}</div>
                    <div className="text-slate-400 text-sm">Driver dengan Outstanding</div>
                  </div>
                </CardContent>
              </Card>
              <Card className="bg-slate-800/60 border-slate-700">
                <CardContent className="p-4 flex items-center gap-3">
                  <MessageCircle className="w-8 h-8 text-green-400" />
                  <div>
                    <div className="text-2xl font-bold text-white">{eligible500k.length}</div>
                    <div className="text-slate-400 text-sm">Perlu Notifikasi WA (≥500rb)</div>
                  </div>
                </CardContent>
              </Card>
            </div>

            {/* Auto-blast WA toggle */}
            {status === "open" && (
              <Card className="bg-slate-800/60 border-slate-700">
                <CardContent className="p-4">
                  <div className="flex flex-col sm:flex-row sm:items-center gap-4">
                    <div className="flex items-center gap-3 flex-1">
                      {autoBlastEnabled
                        ? <Bell className="w-5 h-5 text-green-400 shrink-0" />
                        : <BellOff className="w-5 h-5 text-slate-500 shrink-0" />}
                      <div>
                        <div className="text-white text-sm font-medium">Auto-Blast WA Harian</div>
                        <div className="text-slate-400 text-xs">
                          {autoBlastEnabled
                            ? <>Aktif — kirim WA otomatis ke semua driver outstanding ≥Rp 500rb setiap hari jam <strong className="text-green-400">{String(autoBlastHour).padStart(2,"0")}:00 WIB</strong></>
                            : "Nonaktif — aktifkan untuk kirim WA reminder otomatis setiap hari"}
                          {autoBlastLastRun && (
                            <span className="ml-2 text-slate-500">· Terakhir: {autoBlastLastRun}</span>
                          )}
                        </div>
                      </div>
                    </div>
                    <div className="flex items-center gap-3 shrink-0">
                      <div className="flex items-center gap-2">
                        <Clock className="w-4 h-4 text-slate-400" />
                        <select
                          value={autoBlastHour}
                          onChange={(e) => setAutoBlastHour(Number(e.target.value))}
                          className="bg-slate-700 border border-slate-600 text-white text-sm rounded px-2 py-1 focus:outline-none focus:border-indigo-500"
                        >
                          {Array.from({ length: 24 }, (_, i) => (
                            <option key={i} value={i}>{String(i).padStart(2,"0")}:00 WIB</option>
                          ))}
                        </select>
                      </div>
                      <Switch
                        checked={autoBlastEnabled}
                        disabled={autoBlastSaving}
                        onCheckedChange={(v) => saveAutoBlast(v, autoBlastHour)}
                      />
                      {autoBlastEnabled && autoBlastHour !== (autoBlastSettings?.hour ?? 8) && (
                        <Button
                          size="sm"
                          className="bg-indigo-600 hover:bg-indigo-700 text-white text-xs px-3"
                          disabled={autoBlastSaving}
                          onClick={() => saveAutoBlast(true, autoBlastHour)}
                        >
                          Simpan Jam
                        </Button>
                      )}
                    </div>
                  </div>
                </CardContent>
              </Card>
            )}

            {/* Tabel Outstanding */}
            <Card className="bg-slate-800/60 border-slate-700">
              <CardHeader className="pb-3">
                <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between flex-wrap">
                  <CardTitle className="text-white text-base">
                    {status === "open" ? "Outstanding Belum Lunas" : "Outstanding Sudah Lunas"}
                    <span className="ml-2 text-xs text-slate-500 font-normal">
                      ({sortedList.length} dari {list.length})
                    </span>
                  </CardTitle>
                  {/* Search */}
                  <div className="relative w-full sm:w-64">
                    <svg className="absolute left-2.5 top-2.5 w-4 h-4 text-slate-400 pointer-events-none" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24"><circle cx="11" cy="11" r="8"/><path d="m21 21-4.35-4.35"/></svg>
                    <input
                      type="text"
                      placeholder="Cari nama / plat / no HP…"
                      value={search}
                      onChange={(e) => setSearch(e.target.value)}
                      className="w-full pl-8 pr-3 py-1.5 text-sm bg-slate-700 border border-slate-600 rounded-lg text-white placeholder-slate-400 focus:outline-none focus:border-indigo-500"
                    />
                  </div>
                </div>
                {/* Quick-select untuk blast */}
                {status === "open" && sortedList.length > 0 && (
                  <div className="flex items-center gap-2 flex-wrap mt-1">
                    <button
                      onClick={selectAbove500k}
                      className="px-3 py-1 text-xs font-medium rounded-full border border-amber-600/60 text-amber-400 hover:bg-amber-900/20 transition-colors flex items-center gap-1.5">
                      <AlertTriangle className="w-3 h-3" /> Pilih ≥500rb
                    </button>
                    {selectedIds.size > 0 && (
                      <button
                        onClick={() => setSelectedIds(new Set())}
                        className="px-3 py-1 text-xs font-medium rounded-full border border-slate-600 text-slate-400 hover:text-white hover:border-slate-500 transition-colors">
                        Batalkan ({selectedIds.size} dipilih)
                      </button>
                    )}
                  </div>
                )}
                {/* Filter chips */}
                <div className="flex items-center gap-2 flex-wrap mt-1">
                  {(["all", "has_plate", "no_plate"] as const).map((f) => {
                    const labels = { all: `Semua (${list.length})`, has_plate: `Active (${hasPlateCount})`, no_plate: `Need to Assign (${noPlateCount})` };
                    const active = plateFilter === f;
                    const colorMap = {
                      all: active ? "bg-indigo-600 text-white border-indigo-500" : "bg-slate-700/60 text-slate-400 border-slate-600 hover:text-white hover:border-slate-500",
                      has_plate: active ? "bg-emerald-600 text-white border-emerald-500" : "bg-slate-700/60 text-slate-400 border-slate-600 hover:text-emerald-300 hover:border-emerald-600",
                      no_plate: active ? "bg-orange-600 text-white border-orange-500" : "bg-slate-700/60 text-slate-400 border-slate-600 hover:text-orange-300 hover:border-orange-600",
                    };
                    return (
                      <button
                        key={f}
                        onClick={() => setPlateFilter(f)}
                        className={`px-3 py-1 text-xs font-medium rounded-full border transition-colors ${colorMap[f]}`}
                      >
                        {labels[f]}
                      </button>
                    );
                  })}
                </div>
              </CardHeader>
              <CardContent className="p-0">
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead className="border-b border-slate-700">
                      <tr>
                        {status === "open" && (
                          <th className="px-3 py-3 w-8">
                            <input
                              type="checkbox"
                              className="w-3.5 h-3.5 rounded accent-indigo-500 cursor-pointer"
                              checked={sortedList.length > 0 && sortedList.every((o) => selectedIds.has(Number(o.id)))}
                              onChange={toggleSelectAll}
                            />
                          </th>
                        )}
                        <th className="text-left px-4 py-3 text-slate-400 font-medium whitespace-nowrap">
                          <button className="flex items-center hover:text-white transition-colors" onClick={() => toggleSort("driver_name")}>
                            Driver Name <SortIcon col="driver_name" />
                          </button>
                        </th>
                        <th className="text-left px-4 py-3 text-slate-400 font-medium whitespace-nowrap">Phone Number</th>
                        <th className="text-left px-4 py-3 text-slate-400 font-medium whitespace-nowrap">License Plate</th>
                        <th className="text-left px-4 py-3 text-slate-400 font-medium whitespace-nowrap">
                          <button className="flex items-center hover:text-white transition-colors" onClick={() => toggleSort("rental_fee_daily")}>
                            Rental fee (Daily) <SortIcon col="rental_fee_daily" />
                          </button>
                        </th>
                        <th className="text-left px-4 py-3 text-slate-400 font-medium whitespace-nowrap">
                          <button className="flex items-center hover:text-white transition-colors" onClick={() => toggleSort("outstanding_amount")}>
                            Outstanding <SortIcon col="outstanding_amount" />
                          </button>
                        </th>
                        <th className="text-left px-4 py-3 text-slate-400 font-medium whitespace-nowrap">Status</th>
                        {status === "open" && <th className="text-left px-4 py-3 text-slate-400 font-medium whitespace-nowrap">Aksi</th>}
                      </tr>
                    </thead>
                    <tbody>
                      {isLoading
                        ? Array.from({ length: 5 }).map((_, i) => (
                            <tr key={i} className="border-b border-slate-700/50">
                              <td colSpan={status === "open" ? 7 : 6} className="px-4 py-3">
                                <div className="h-4 bg-slate-700 rounded animate-pulse" />
                              </td>
                            </tr>
                          ))
                        : sortedList.length === 0
                          ? (
                              <tr>
                                <td colSpan={status === "open" ? 7 : 6} className="px-4 py-12 text-center text-slate-500">
                                  <CheckCircle className="w-10 h-10 mx-auto mb-2 opacity-40 text-emerald-500" />
                                  <p>Tidak ada outstanding {status === "open" ? "yang belum lunas" : "yang sudah lunas"}</p>
                                </td>
                              </tr>
                            )
                          : sortedList.map((o) => {
                              const amount      = parseFloat(String(o.outstanding_amount ?? 0));
                              const isHigh      = amount >= 1_000_000;
                              const isAbove500k = amount >= 500_000;
                              const hasPhone    = Boolean(String(o.driver_phone ?? "").trim());
                              const rentalFee   = parseFloat(String(o.rental_fee_daily ?? 0));
                              const statusCsv   = String(o.snapshot_source ?? "") === "snapshot_csv"
                                ? String(o.status ?? "open") : String(o.status ?? "open");
                              return (
                                <tr key={String(o.id)} className={`border-b border-slate-700/50 hover:bg-slate-700/20 transition-colors ${selectedIds.has(Number(o.id)) ? "bg-indigo-900/10" : ""}`}>
                                  {status === "open" && (
                                    <td className="px-3 py-3">
                                      <input
                                        type="checkbox"
                                        className="w-3.5 h-3.5 rounded accent-indigo-500 cursor-pointer"
                                        checked={selectedIds.has(Number(o.id))}
                                        onChange={() => toggleSelect(Number(o.id))}
                                      />
                                    </td>
                                  )}
                                  <td className="px-4 py-3 font-medium text-white">
                                    {String(o.driver_name)}
                                    {!!o.driver_external_id && (
                                      <div className="text-xs text-slate-500 font-mono mt-0.5">{String(o.driver_external_id)}</div>
                                    )}
                                  </td>
                                  <td className="px-4 py-3 text-slate-400 text-xs">{String(o.driver_phone ?? "-")}</td>
                                  <td className="px-4 py-3 text-slate-400 font-mono text-xs">{String(o.vehicle_plate ?? "-")}</td>
                                  <td className="px-4 py-3 text-right text-slate-300 text-xs tabular-nums">
                                    {rentalFee > 0 ? fmtIdr(rentalFee) : "—"}
                                  </td>
                                  <td className={`px-4 py-3 text-right font-bold tabular-nums ${isHigh ? "text-red-400" : isAbove500k ? "text-amber-400" : "text-slate-300"}`}>
                                    {fmtIdr(o.outstanding_amount)}
                                  </td>
                                  <td className="px-4 py-3">
                                    {(() => {
                                      const plate = String(o.vehicle_plate ?? "").trim();
                                      const hasPlate = plate && plate !== "-";
                                      return hasPlate ? (
                                        <Badge className="bg-emerald-500/20 text-emerald-300 border border-emerald-600 text-xs">
                                          Active
                                        </Badge>
                                      ) : (
                                        <Badge className="bg-orange-500/20 text-orange-300 border border-orange-600 text-xs">
                                          Need to Assign
                                        </Badge>
                                      );
                                    })()}
                                  </td>
                                  {status === "open" && (
                                    <td className="px-4 py-3">
                                      <div className="flex items-center gap-1.5">
                                        {hasPhone && (
                                          <Button size="sm" variant="outline"
                                            className="border-green-600 text-green-400 hover:bg-green-900/30 h-7 text-xs"
                                            onClick={() => openWaModal(o)}>
                                            <MessageCircle className="w-3 h-3 mr-1" /> WA
                                          </Button>
                                        )}
                                        <Button size="sm" variant="outline"
                                          className="border-emerald-600 text-emerald-400 hover:bg-emerald-900/30 h-7 text-xs"
                                          onClick={() => { setResolving(Number(o.id)); setNotes(""); }}>
                                          <CheckCircle className="w-3 h-3 mr-1" /> Lunas
                                        </Button>
                                      </div>
                                    </td>
                                  )}
                                </tr>
                              );
                            })}
                    </tbody>
                  </table>
                </div>
              </CardContent>
            </Card>

            {/* Riwayat WA */}
            <Card className="bg-slate-800/60 border-slate-700">
              <CardHeader className="pb-2">
                <button
                  className="flex items-center justify-between w-full text-left"
                  onClick={() => { setShowLogs((p) => !p); if (!showLogs) refetchLogs(); }}
                >
                  <div className="flex items-center gap-2">
                    <History className="w-4 h-4 text-slate-400" />
                    <CardTitle className="text-white text-base">
                      Riwayat Pengiriman WA
                      {logData?.total ? <span className="ml-2 text-xs text-slate-400 font-normal">({fmtNum(logData.total)} entri)</span> : null}
                    </CardTitle>
                  </div>
                  {showLogs ? <ChevronUp className="w-4 h-4 text-slate-400" /> : <ChevronDown className="w-4 h-4 text-slate-400" />}
                </button>
              </CardHeader>
              {showLogs && (
                <CardContent className="p-0">
                  <div className="overflow-x-auto">
                    <table className="w-full text-sm">
                      <thead className="border-b border-slate-700">
                        <tr>{["Waktu Kirim","Driver","No HP","Plat","Outstanding","Tipe","Dikirim oleh","Status"].map((h) => (
                          <th key={h} className="text-left px-4 py-3 text-slate-400 font-medium whitespace-nowrap">{h}</th>
                        ))}</tr>
                      </thead>
                      <tbody>
                        {logs.length === 0
                          ? <tr><td colSpan={8} className="px-4 py-10 text-center text-slate-500 text-sm">Belum ada riwayat pengiriman WA</td></tr>
                          : logs.map((log) => (
                              <tr key={String(log.id)} className="border-b border-slate-700/50 hover:bg-slate-700/20">
                                <td className="px-4 py-2.5 text-slate-300 text-xs whitespace-nowrap">{fmtDatetime(log.sent_at)}</td>
                                <td className="px-4 py-2.5 text-white text-sm">{String(log.driver_name ?? "-")}</td>
                                <td className="px-4 py-2.5 text-slate-400 text-xs">{String(log.driver_phone ?? "-")}</td>
                                <td className="px-4 py-2.5 text-slate-400 font-mono text-xs">{String(log.vehicle_plate ?? "-")}</td>
                                <td className="px-4 py-2.5 text-right tabular-nums text-xs font-medium text-amber-400">{fmtIdr(log.outstanding_amount)}</td>
                                <td className="px-4 py-2.5">
                                  <Badge className={String(log.send_type).startsWith("auto")
                                    ? "bg-blue-500/20 text-blue-300 border border-blue-700 text-xs"
                                    : "bg-slate-700/50 text-slate-300 border border-slate-600 text-xs"}>
                                    {SEND_TYPE_LABEL[String(log.send_type)] ?? String(log.send_type)}
                                  </Badge>
                                </td>
                                <td className="px-4 py-2.5 text-slate-400 text-xs">{String(log.sent_by ?? "-")}</td>
                                <td className="px-4 py-2.5">
                                  {String(log.status) === "sent"
                                    ? <span className="text-emerald-400 text-xs">✓ Terkirim</span>
                                    : <span className="text-red-400 text-xs">✗ Gagal</span>}
                                </td>
                              </tr>
                            ))}
                      </tbody>
                    </table>
                  </div>
                </CardContent>
              )}
            </Card>
          </>
        )}

        {/* ══════════════════════════════════════════════════════════════
            TAB 2: UPLOAD CSV RINGKASAN OUTSTANDING
        ══════════════════════════════════════════════════════════════ */}
        {activeTab === "upload" && (
          <>
            {/* Info box */}
            <div className="bg-indigo-900/20 border border-indigo-700/40 rounded-xl p-4 space-y-3">
              <div className="flex items-center gap-2">
                <FileText className="w-5 h-5 text-indigo-400 flex-shrink-0" />
                <p className="text-indigo-300 font-medium text-sm">Format CSV yang diharapkan</p>
              </div>
              <p className="text-slate-400 text-xs leading-relaxed">
                Kolom wajib: <code className="bg-slate-700 px-1 rounded text-indigo-300">Driver Name</code>{" "}
                <code className="bg-slate-700 px-1 rounded text-indigo-300">Phone Number</code>{" "}
                <code className="bg-slate-700 px-1 rounded text-indigo-300">License Plate</code>{" "}
                <code className="bg-slate-700 px-1 rounded text-indigo-300">Rental fee(Daily)</code>{" "}
                <code className="bg-slate-700 px-1 rounded text-indigo-300">Outstanding</code>{" "}
                <code className="bg-slate-700 px-1 rounded text-indigo-300">Status</code>
              </p>
              {/* clearFirst toggle */}
              <label className="flex items-start gap-3 cursor-pointer group">
                <div className="relative mt-0.5">
                  <input
                    type="checkbox"
                    className="sr-only"
                    checked={clearFirst}
                    onChange={(e) => setClearFirst(e.target.checked)}
                  />
                  <div className={`w-10 h-5 rounded-full transition-colors ${clearFirst ? "bg-red-600" : "bg-slate-600"}`} />
                  <div className={`absolute top-0.5 left-0.5 w-4 h-4 rounded-full bg-white transition-transform ${clearFirst ? "translate-x-5" : ""}`} />
                </div>
                <div>
                  <p className={`text-sm font-medium ${clearFirst ? "text-red-300" : "text-slate-300"}`}>
                    Hapus data lama &amp; ganti semua
                  </p>
                  <p className="text-xs text-slate-500 mt-0.5">
                    {clearFirst
                      ? "⚠ Semua data outstanding yang ada akan dihapus sebelum import CSV ini."
                      : "Matikan: hanya update driver yang ada di CSV (data lain tetap)."}
                  </p>
                </div>
              </label>
            </div>

            {/* Upload zone */}
            <Card className="bg-slate-800/60 border-slate-700">
              <CardContent className="p-6">
                <input
                  ref={fileInputRef}
                  type="file"
                  accept=".csv"
                  className="hidden"
                  onChange={(e) => {
                    const f = e.target.files?.[0];
                    if (f) handleFileChange(f);
                    e.target.value = "";
                  }}
                />

                {!selectedFile && !previewLoading && (
                  <div
                    className="border-2 border-dashed border-slate-600 hover:border-indigo-500 rounded-xl p-12 text-center cursor-pointer transition-colors group"
                    onClick={() => fileInputRef.current?.click()}
                    onDragOver={(e) => e.preventDefault()}
                    onDrop={(e) => {
                      e.preventDefault();
                      const f = e.dataTransfer.files[0];
                      if (f && f.name.endsWith(".csv")) handleFileChange(f);
                      else toast.error("Hanya file .csv yang diterima");
                    }}
                  >
                    <Upload className="w-12 h-12 mx-auto mb-3 text-slate-500 group-hover:text-indigo-400 transition-colors" />
                    <p className="text-slate-300 font-medium">Klik atau drag &amp; drop file CSV</p>
                    <p className="text-slate-500 text-sm mt-1">Outstanding Summary dari Gojek Fleet</p>
                  </div>
                )}

                {previewLoading && (
                  <div className="py-12 text-center">
                    <RefreshCw className="w-8 h-8 mx-auto mb-3 text-indigo-400 animate-spin" />
                    <p className="text-slate-400 text-sm">Memproses file dan mencocokkan driver...</p>
                  </div>
                )}

                {selectedFile && !previewLoading && (
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-3">
                      <FileText className="w-8 h-8 text-indigo-400 flex-shrink-0" />
                      <div>
                        <p className="text-white font-medium text-sm">{selectedFile.name}</p>
                        <p className="text-slate-500 text-xs">{(selectedFile.size / 1024).toFixed(1)} KB</p>
                      </div>
                    </div>
                    <Button variant="ghost" size="sm" className="text-slate-400 hover:text-white"
                      onClick={() => { setSelectedFile(null); setPreviewRows(null); setPreviewMeta(null); setImportResult(null); }}>
                      Ganti File
                    </Button>
                  </div>
                )}
              </CardContent>
            </Card>

            {/* Import Result */}
            {importResult && (
              <div className="flex items-start gap-3 bg-emerald-900/20 border border-emerald-700/40 rounded-xl p-4">
                <CheckCircle className="w-5 h-5 text-emerald-400 flex-shrink-0 mt-0.5" />
                <div className="flex-1">
                  <p className="text-emerald-300 font-medium text-sm">Import Berhasil</p>
                  <div className="flex gap-4 mt-2 flex-wrap">
                    {[
                      { label: "Diperbarui", value: importResult.updated, cls: "text-blue-400" },
                      { label: "Driver baru", value: importResult.inserted, cls: "text-amber-400" },
                      { label: "Dilewati", value: importResult.skipped, cls: "text-slate-400" },
                    ].map((s) => (
                      <div key={s.label} className="text-center">
                        <div className={`text-xl font-bold ${s.cls}`}>{s.value}</div>
                        <div className="text-slate-500 text-xs">{s.label}</div>
                      </div>
                    ))}
                  </div>
                </div>
              </div>
            )}

            {/* Preview meta */}
            {previewMeta && previewRows && (
              <>
                <div className="flex items-center justify-between flex-wrap gap-3">
                  <div className="flex items-center gap-4 flex-wrap">
                    <span className="text-slate-400 text-sm">Preview: <strong className="text-white">{previewMeta.total}</strong> driver</span>
                    <Badge className="bg-emerald-500/20 text-emerald-300 border border-emerald-600 text-xs">
                      ✓ {previewMeta.found} cocok
                    </Badge>
                    {previewMeta.unmatched > 0 && (
                      <Badge className="bg-amber-500/20 text-amber-300 border border-amber-600 text-xs">
                        ⚠ {previewMeta.unmatched} tidak cocok
                      </Badge>
                    )}
                    {previewMeta.skipped > 0 && (
                      <span className="text-slate-500 text-xs">{previewMeta.skipped} dilewati (outstanding=0)</span>
                    )}
                  </div>
                  <div className="flex items-center gap-2 flex-wrap">
                    <Button variant="outline" size="sm"
                      className="border-slate-600 text-slate-300 hover:text-white gap-1.5 text-xs"
                      onClick={() => exportPreviewCsv(previewRows)}>
                      <Download className="w-3.5 h-3.5" /> CSV
                    </Button>
                    <Button variant="outline" size="sm"
                      className="border-slate-600 text-slate-300 hover:text-white gap-1.5 text-xs"
                      onClick={() => exportPreviewXlsx(previewRows)}>
                      <Download className="w-3.5 h-3.5" /> Excel
                    </Button>
                    <Button
                      className="bg-indigo-600 hover:bg-indigo-700 gap-2"
                      onClick={() => setConfirmOpen(true)}
                      disabled={!!importResult}
                    >
                      <Upload className="w-4 h-4" />
                      {importResult ? "Sudah Diimport" : "Konfirmasi Import"}
                    </Button>
                  </div>
                </div>

                {/* Preview table */}
                <Card className="bg-slate-800/60 border-slate-700">
                  <CardHeader className="pb-2">
                    <CardTitle className="text-white text-base flex items-center gap-2">
                      <ClipboardList className="w-4 h-4 text-slate-400" />
                      Preview Data Outstanding
                    </CardTitle>
                  </CardHeader>
                  <CardContent className="p-0">
                    <div className="overflow-x-auto">
                      <table className="w-full text-sm">
                        <thead className="border-b border-slate-700">
                          <tr>
                            {["Driver Name","No HP","Plat","Rental/Hari","Outstanding","Status CSV","Match"].map((h) => (
                              <th key={h} className={`px-4 py-3 text-slate-400 font-medium whitespace-nowrap text-xs ${h === "Outstanding" || h === "Rental/Hari" ? "text-right" : "text-left"}`}>{h}</th>
                            ))}
                          </tr>
                        </thead>
                        <tbody>
                          {previewRows.map((r, i) => {
                            const isHigh      = r.outstanding >= 1_000_000;
                            const isAbove500k = r.outstanding >= 500_000;
                            const isMatched   = r.match_status === "found";
                            return (
                              <tr key={i} className="border-b border-slate-700/50 hover:bg-slate-700/20 transition-colors">
                                <td className="px-4 py-3">
                                  <div className="text-white text-sm font-medium">{r.driver_name}</div>
                                  {isMatched && r.matched_name && r.matched_name !== r.driver_name && (
                                    <div className="text-slate-500 text-xs mt-0.5">→ {r.matched_name}</div>
                                  )}
                                </td>
                                <td className="px-4 py-3 text-slate-400 text-xs">{r.phone_number || "-"}</td>
                                <td className="px-4 py-3 text-slate-400 font-mono text-xs">{r.license_plate || "-"}</td>
                                <td className="px-4 py-3 text-right text-slate-300 text-xs tabular-nums">
                                  {r.rental_fee_daily > 0 ? fmtIdr(r.rental_fee_daily) : "-"}
                                </td>
                                <td className={`px-4 py-3 text-right font-bold tabular-nums text-sm ${isHigh ? "text-red-400" : isAbove500k ? "text-amber-400" : "text-slate-300"}`}>
                                  {fmtIdr(r.outstanding)}
                                </td>
                                <td className="px-4 py-3">
                                  <Badge className={
                                    r.status?.toLowerCase().includes("need")
                                      ? "bg-amber-500/20 text-amber-300 border border-amber-600 text-xs"
                                      : "bg-slate-700/50 text-slate-300 border border-slate-600 text-xs"
                                  }>
                                    {r.status || "-"}
                                  </Badge>
                                </td>
                                <td className="px-4 py-3 text-center">
                                  {isMatched
                                    ? <span className="text-emerald-400 text-base" title="Driver ditemukan di DB">✓</span>
                                    : <span className="text-amber-400 text-base" title="Driver tidak ditemukan, akan dibuat baru">⚠</span>}
                                </td>
                              </tr>
                            );
                          })}
                        </tbody>
                        {/* Footer totals */}
                        <tfoot className="border-t border-slate-600 bg-slate-700/20">
                          <tr>
                            <td colSpan={4} className="px-4 py-2 text-slate-400 text-xs font-medium">Total</td>
                            <td className="px-4 py-2 text-right font-bold tabular-nums text-white text-sm">
                              {fmtIdr(previewRows.reduce((s, r) => s + r.outstanding, 0))}
                            </td>
                            <td colSpan={2} />
                          </tr>
                        </tfoot>
                      </table>
                    </div>
                  </CardContent>
                </Card>
              </>
            )}

            {/* Riwayat Import */}
            <Card className="bg-slate-800/60 border-slate-700">
              <CardHeader className="pb-2">
                <button
                  className="flex items-center justify-between w-full text-left"
                  onClick={() => { setShowImportLog((p) => !p); if (!showImportLog) refetchImportLog(); }}
                >
                  <div className="flex items-center gap-2">
                    <History className="w-4 h-4 text-slate-400" />
                    <CardTitle className="text-white text-base">Riwayat Import CSV</CardTitle>
                  </div>
                  {showImportLog ? <ChevronUp className="w-4 h-4 text-slate-400" /> : <ChevronDown className="w-4 h-4 text-slate-400" />}
                </button>
              </CardHeader>
              {showImportLog && (
                <CardContent className="p-0">
                  <div className="overflow-x-auto">
                    <table className="w-full text-sm">
                      <thead className="border-b border-slate-700">
                        <tr>
                          {["Tanggal","File","Diupload oleh","Total Baris","Diimport","Dilewati","Tidak Cocok"].map((h) => (
                            <th key={h} className="text-left px-4 py-3 text-slate-400 font-medium whitespace-nowrap text-xs">{h}</th>
                          ))}
                        </tr>
                      </thead>
                      <tbody>
                        {importLogs.length === 0
                          ? <tr><td colSpan={7} className="px-4 py-10 text-center text-slate-500 text-sm">Belum ada riwayat import</td></tr>
                          : importLogs.map((log) => (
                              <tr key={log.id} className="border-b border-slate-700/50 hover:bg-slate-700/20">
                                <td className="px-4 py-2.5 text-slate-300 text-xs whitespace-nowrap">{fmtDate(log.uploaded_at)}</td>
                                <td className="px-4 py-2.5 text-slate-300 text-xs max-w-[200px] truncate" title={log.report_file_name}>{log.report_file_name}</td>
                                <td className="px-4 py-2.5 text-slate-400 text-xs">{log.uploaded_by}</td>
                                <td className="px-4 py-2.5 text-slate-400 text-xs text-right tabular-nums">{log.total_rows}</td>
                                <td className="px-4 py-2.5 text-emerald-400 text-xs text-right tabular-nums font-medium">{log.rows_imported}</td>
                                <td className="px-4 py-2.5 text-slate-500 text-xs text-right tabular-nums">{log.rows_skipped}</td>
                                <td className="px-4 py-2.5 text-amber-400 text-xs text-right tabular-nums">{log.unmatched_drivers}</td>
                              </tr>
                            ))}
                      </tbody>
                    </table>
                  </div>
                </CardContent>
              )}
            </Card>
          </>
        )}
      </div>

      {/* ── Modal: Preview & Edit WA per-driver ──────────────────────── */}
      {waPreview && (
        <Dialog open onOpenChange={() => setWaPreview(null)}>
          <DialogContent className="bg-slate-800 border-slate-700 text-white max-w-lg">
            <DialogHeader>
              <DialogTitle className="flex items-center gap-2">
                <MessageCircle className="w-5 h-5 text-green-400" />
                Kirim WA — {waPreview.name}
              </DialogTitle>
              <DialogDescription className="text-slate-400 text-xs">
                Nomor: {waPreview.phone} · Edit pesan sebelum mengirim
              </DialogDescription>
            </DialogHeader>
            <div className="space-y-3">
              <div className="flex items-center justify-between">
                <Label className="text-slate-300 text-sm">Pesan WhatsApp</Label>
                <Button variant="ghost" size="sm"
                  className="h-6 text-xs text-slate-400 hover:text-white gap-1"
                  onClick={() => setWaPreview({ ...waPreview, message: waPreview.defaultMessage })}>
                  <RotateCcw className="w-3 h-3" /> Reset
                </Button>
              </div>
              <Textarea
                value={waPreview.message}
                onChange={(e) => setWaPreview({ ...waPreview, message: e.target.value })}
                className="bg-slate-900 border-slate-600 text-white resize-none font-mono text-xs leading-relaxed"
                rows={17}
              />
              <p className="text-slate-500 text-xs">Teks <code className="bg-slate-700 px-1 rounded">*bintang*</code> tampil <strong>bold</strong> di WhatsApp.</p>
              <div className="flex gap-3 pt-1">
                <Button variant="outline" className="flex-1 border-slate-600" onClick={() => setWaPreview(null)}>Batal</Button>
                <Button className="flex-1 bg-green-600 hover:bg-green-700 gap-2"
                  disabled={waSending || !waPreview.message.trim()} onClick={sendWa}>
                  <Send className="w-4 h-4" />
                  {waSending ? "Mengirim..." : "Kirim WA"}
                </Button>
              </div>
            </div>
          </DialogContent>
        </Dialog>
      )}

      {/* ── Modal: Bulk WA ────────────────────────────────────────────── */}
      {bulkOpen && (
        <Dialog open onOpenChange={() => setBulkOpen(false)}>
          <DialogContent className="bg-slate-800 border-slate-700 text-white max-w-lg">
            <DialogHeader>
              <DialogTitle className="flex items-center gap-2">
                <Send className="w-5 h-5 text-green-400" />
                Kirim WA ke {eligible500k.length} Driver (≥ Rp 500rb)
              </DialogTitle>
              <DialogDescription className="text-slate-400 text-xs">
                Data nama, plat, HP, dan jumlah diisi otomatis per driver.
              </DialogDescription>
            </DialogHeader>
            <div className="space-y-3">
              <Label className="text-slate-300 text-sm">Preview Template</Label>
              <div className="bg-slate-900 border border-slate-700 rounded-md p-3 text-xs font-mono text-slate-300 leading-relaxed whitespace-pre-wrap max-h-64 overflow-y-auto">
                {BULK_HINT}
              </div>
              <div className="bg-slate-700/40 rounded-md p-3 text-xs text-slate-400 space-y-1">
                <p className="font-medium text-slate-300 mb-1">Variabel yang diganti otomatis:</p>
                {[["nama","Nama driver"],["plat","Nomor kendaraan"],["hp","Nomor telepon"],["jumlah","Total outstanding"]].map(([v,d]) => (
                  <p key={v}><code className="text-green-400">{`{${v}}`}</code> — {d}</p>
                ))}
              </div>
              <div className="flex gap-3 pt-1">
                <Button variant="outline" className="flex-1 border-slate-600" onClick={() => setBulkOpen(false)}>Batal</Button>
                <Button className="flex-1 bg-green-600 hover:bg-green-700 gap-2"
                  disabled={waAllMutation.isPending} onClick={() => waAllMutation.mutate()}>
                  <Send className="w-4 h-4" />
                  {waAllMutation.isPending ? "Mengirim..." : `Kirim ke ${eligible500k.length} Driver`}
                </Button>
              </div>
            </div>
          </DialogContent>
        </Dialog>
      )}

      {/* ── Modal: Blast ke Driver Terpilih ──────────────────────────── */}
      {waBlastOpen && (
        <Dialog open onOpenChange={() => setWaBlastOpen(false)}>
          <DialogContent className="bg-slate-800 border-slate-700 text-white max-w-lg">
            <DialogHeader>
              <DialogTitle className="flex items-center gap-2">
                <Send className="w-5 h-5 text-green-400" />
                Kirim WA ke {selectedIds.size} Driver Terpilih
              </DialogTitle>
              <DialogDescription className="text-slate-400 text-xs">
                Pesan dikirim dengan nama, plat, HP, dan jumlah outstanding masing-masing driver.
              </DialogDescription>
            </DialogHeader>
            <div className="space-y-3">
              {/* Daftar driver terpilih */}
              <div className="bg-slate-900 border border-slate-700 rounded-md max-h-52 overflow-y-auto divide-y divide-slate-700/60">
                {sortedList.filter((o) => selectedIds.has(Number(o.id))).map((o) => {
                  const phone = String(o.driver_phone ?? "").trim();
                  const amount = parseFloat(String(o.outstanding_amount ?? 0));
                  const isHigh = amount >= 1_000_000;
                  const isAbove500k = amount >= 500_000;
                  return (
                    <div key={String(o.id)} className="flex items-center justify-between px-3 py-2 gap-3">
                      <div className="flex items-center gap-2 min-w-0">
                        <input type="checkbox" className="w-3 h-3 accent-indigo-500 flex-shrink-0"
                          checked onChange={() => toggleSelect(Number(o.id))} />
                        <div className="min-w-0">
                          <p className="text-white text-xs font-medium truncate">{String(o.driver_name)}</p>
                          <p className="text-slate-500 text-[11px]">{phone || <span className="italic text-red-400">No HP tidak ada</span>}</p>
                        </div>
                      </div>
                      <span className={`text-xs font-bold tabular-nums flex-shrink-0 ${isHigh ? "text-red-400" : isAbove500k ? "text-amber-400" : "text-slate-300"}`}>
                        {fmtIdr(o.outstanding_amount)}
                      </span>
                    </div>
                  );
                })}
              </div>
              {/* Driver tanpa HP */}
              {(() => {
                const noPhone = sortedList.filter((o) => selectedIds.has(Number(o.id)) && !String(o.driver_phone ?? "").trim()).length;
                return noPhone > 0 ? (
                  <p className="text-amber-400 text-xs flex items-center gap-1.5">
                    <AlertTriangle className="w-3.5 h-3.5" />
                    {noPhone} driver tidak memiliki nomor HP — akan dilewati otomatis.
                  </p>
                ) : null;
              })()}
              <Label className="text-slate-300 text-sm">Preview Template Pesan</Label>
              <div className="bg-slate-900 border border-slate-700 rounded-md p-3 text-xs font-mono text-slate-300 leading-relaxed whitespace-pre-wrap max-h-40 overflow-y-auto">
                {BULK_HINT}
              </div>
              <p className="text-slate-500 text-xs">Nama, plat, HP, dan jumlah outstanding diisi otomatis per driver.</p>
              <div className="flex gap-3 pt-1">
                <Button variant="outline" className="flex-1 border-slate-600" onClick={() => setWaBlastOpen(false)}>Batal</Button>
                <Button className="flex-1 bg-green-600 hover:bg-green-700 gap-2"
                  disabled={waBlastMutation.isPending || selectedIds.size === 0}
                  onClick={() => waBlastMutation.mutate(Array.from(selectedIds))}>
                  <Send className="w-4 h-4" />
                  {waBlastMutation.isPending ? "Mengirim..." : `Kirim ke ${selectedIds.size} Driver`}
                </Button>
              </div>
            </div>
          </DialogContent>
        </Dialog>
      )}

      {/* ── Modal: Tandai Lunas ───────────────────────────────────────── */}
      {resolving !== null && (
        <Dialog open onOpenChange={() => setResolving(null)}>
          <DialogContent className="bg-slate-800 border-slate-700 text-white max-w-sm">
            <DialogHeader>
              <DialogTitle>Tandai Lunas</DialogTitle>
            </DialogHeader>
            <div className="space-y-4">
              <p className="text-slate-400 text-sm">Konfirmasi bahwa outstanding ini telah diselesaikan oleh driver.</p>
              <div className="space-y-1.5">
                <Label className="text-slate-300 text-sm">Catatan (opsional)</Label>
                <Textarea value={notes} onChange={(e) => setNotes(e.target.value)}
                  placeholder="Metode pelunasan, no. referensi, dll..."
                  className="bg-slate-700 border-slate-600 text-white resize-none" rows={3} />
              </div>
              <div className="flex gap-3">
                <Button variant="outline" className="flex-1 border-slate-600" onClick={() => setResolving(null)}>Batal</Button>
                <Button className="flex-1 bg-emerald-600 hover:bg-emerald-700"
                  disabled={resolveMutation.isPending} onClick={() => resolveMutation.mutate()}>
                  {resolveMutation.isPending ? "Menyimpan..." : "Konfirmasi Lunas"}
                </Button>
              </div>
            </div>
          </DialogContent>
        </Dialog>
      )}

      {/* ── Dialog: Konfirmasi Import ─────────────────────────────────── */}
      <Dialog open={confirmOpen} onOpenChange={setConfirmOpen}>
        <DialogContent className="bg-slate-800 border-slate-700 text-white max-w-sm">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <AlertCircle className="w-5 h-5 text-amber-400" />
              Konfirmasi Import Outstanding
            </DialogTitle>
            <DialogDescription className="text-slate-400 text-sm">
              Import bersifat <strong className="text-amber-300">per-driver</strong>: data outstanding lama
              dari <strong className="text-white">{previewMeta?.total ?? 0} driver</strong> (outstanding &gt; 0)
              akan dihapus dan diganti data CSV baru.
              Driver dengan outstanding = 0 tidak terpengaruh.
              {previewMeta?.unmatched ? (
                <span className="block mt-2 text-amber-400">
                  ⚠ {previewMeta.unmatched} driver tidak ditemukan di DB — akan dibuat sebagai entri baru (unmatched).
                </span>
              ) : null}
            </DialogDescription>
          </DialogHeader>
          <div className="flex gap-3 pt-2">
            <Button variant="outline" className="flex-1 border-slate-600" onClick={() => setConfirmOpen(false)}>Batal</Button>
            <Button className="flex-1 bg-indigo-600 hover:bg-indigo-700 gap-2" onClick={doImport}>
              <Upload className="w-4 h-4" /> Ya, Import Sekarang
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </AppShell>
  );
}
