import { DatePicker } from "@/components/ui/date-picker";
import { useState, useRef, useEffect } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { AppShell } from "@/components/layout/AppShell";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { SafeSelect } from "@/components/ui/safe-select";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Progress } from "@/components/ui/progress";
import {
  Upload, FileText, CheckCircle, XCircle, Clock, RefreshCw, Eye,
  AlertTriangle, RotateCcw, ChevronRight, Trash2, ShieldAlert,
  Activity, Database, TrendingUp, Server, ArrowLeft, FileSpreadsheet,
} from "lucide-react";
import { Link } from "wouter";
import { toast } from "sonner";

// ─── Shared helpers ──────────────────────────────────────────────────────────

function statusColor(s: string) {
  if (s === "done")       return "bg-emerald-500/20 text-emerald-300 border-emerald-600";
  if (s === "error")      return "bg-red-500/20 text-red-300 border-red-600";
  if (s === "processing" || s === "queued") return "bg-blue-500/20 text-blue-300 border-blue-600";
  if (s === "partial")    return "bg-amber-500/20 text-amber-300 border-amber-600";
  if (s === "rolled_back" || s === "purged") return "bg-slate-500/20 text-slate-400 border-slate-600";
  return "bg-slate-500/20 text-slate-300 border-slate-600";
}

function gradeColor(g: string) {
  if (g === "A") return "text-emerald-400";
  if (g === "B") return "text-green-400";
  if (g === "C") return "text-yellow-400";
  if (g === "D") return "text-orange-400";
  return "text-red-400";
}

function fmtDate(v: unknown) {
  if (!v) return "-";
  return new Date(String(v)).toLocaleString("id-ID", { dateStyle: "short", timeStyle: "short" });
}

function fmtNum(v: unknown) {
  return Number(v ?? 0).toLocaleString("id-ID");
}

function fmtIdr(v: unknown) {
  return new Intl.NumberFormat("id-ID", { style: "currency", currency: "IDR", maximumFractionDigits: 0 }).format(Number(v ?? 0));
}

// ─── Types ───────────────────────────────────────────────────────────────────

type LedgerSummaryDTO = {
  transactionCount: number;
  totalCredit: number;
  totalDebit: number;
  netFlow: number;
  vehicleCoverage: number;
  driverCoverage: number;
  typeBreakdown: Record<string, { count: number; total: number }>;
};

type PreviewData = {
  data: LedgerSummaryDTO;
  meta: { version: string; generatedAt: string };
  fileHash: string;
  rowCount: number;
  headers: string[];
  columnMapping: Record<string, string | null>;
  previewRows: Array<Record<string, unknown>>;
  warnings: string[];
  duplicateReport: { id: number; original_filename: string; status: string } | null;
};

type ProgressData = {
  reportId: number;
  status: string;
  rowCount: number;
  rawInserted: number;
  successRows: number;
  failedRows: number;
  dlqCount: number;
  healthScore: number;
  grade: string;
  durationMs: number | null;
  updatedAt: string;
};

type Step = "select" | "preview" | "done";

type SnapshotRow = {
  driver_name: string;
  phone_number: string;
  license_plate: string;
  rental_fee_daily: number;
  outstanding: number;
  status: string;
  match_status: "found" | "unmatched";
  matched_driver_id: number | null;
  matched_name: string | null;
};

type SnapshotPreviewResult = {
  ok: boolean;
  rows: SnapshotRow[];
  total: number;
  found: number;
  unmatched: number;
  skipped: number;
};

// ─── Tab: CSV Gojek (Transaksi) ──────────────────────────────────────────────

function GojekUploadTab() {
  const qc = useQueryClient();
  const fileRef = useRef<HTMLInputElement>(null);
  const [file, setFile] = useState<File | null>(null);
  const [partnerId, setPartnerId] = useState<string | null>(null);
  const [periodStart, setPeriodStart] = useState("");
  const [periodEnd, setPeriodEnd] = useState("");
  const [dragging, setDragging] = useState(false);
  const [step, setStep] = useState<Step>("select");
  const [preview, setPreview] = useState<PreviewData | null>(null);
  const [forceUpload, setForceUpload] = useState(false);
  const [activeReportId, setActiveReportId] = useState<number | null>(null);
  const [pollEnabled, setPollEnabled] = useState(false);
  const [dbRecovering, setDbRecovering] = useState(false);
  const [selectedPurgeId, setSelectedPurgeId] = useState<number | null>(null);

  const { data: partners } = useQuery({
    queryKey: ["fleet-partners"],
    queryFn: async () => {
      const res = await fetch("/api/logistics/fleet/partners", { credentials: "include" });
      return res.json() as Promise<{ partners: Array<{ id: number; name: string }> }>;
    },
  });

  const { data: reports, refetch: refetchReports } = useQuery({
    queryKey: ["fleet-reports"],
    queryFn: async () => {
      const res = await fetch("/api/logistics/fleet/reports", { credentials: "include" });
      return res.json() as Promise<{ reports: Array<Record<string, unknown>> }>;
    },
    refetchInterval: pollEnabled ? 3000 : 8000,
  });

  const { data: progressData } = useQuery({
    queryKey: ["fleet-progress", activeReportId],
    queryFn: async () => {
      if (!activeReportId) return null;
      const res = await fetch(`/api/logistics/fleet/reports/${activeReportId}/progress`, { credentials: "include" });
      if (!res.ok) return null;
      return res.json() as Promise<ProgressData>;
    },
    enabled: !!activeReportId && pollEnabled,
    refetchInterval: pollEnabled ? 2000 : false,
  });

  useEffect(() => {
    if (progressData && ["done", "error", "partial"].includes(progressData.status)) {
      setPollEnabled(false);
      refetchReports();
    }
  }, [progressData?.status]);

  const previewMutation = useMutation({
    mutationFn: async () => {
      if (!file) throw new Error("Pilih file terlebih dahulu");
      const fd = new FormData();
      fd.append("file", file);
      const res = await fetch("/api/logistics/fleet/reports/preview", {
        method: "POST", credentials: "include", body: fd,
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({})) as Record<string, unknown>;
        const msg = String(err.error ?? "Gagal preview file");
        if (res.status === 401) throw new Error("Sesi berakhir — silakan login ulang");
        if (res.status === 500 && (msg.includes("timeout") || msg.includes("circuit") || msg.includes("ECIRCUIT")))
          throw new Error("Database sedang pulih dari gangguan sementara. Tunggu 30 detik lalu coba lagi.");
        throw new Error(msg);
      }
      return res.json() as Promise<PreviewData>;
    },
    onSuccess: (data) => { setDbRecovering(false); setPreview(data); setStep("preview"); },
    onError: (err: Error) => {
      if (err.message.includes("Database sedang pulih") || err.message.includes("timeout") || err.message.includes("circuit"))
        setDbRecovering(true);
      toast.error(err.message);
    },
  });

  const uploadMutation = useMutation({
    mutationFn: async (opts: { skipDuplicateCheck?: boolean } = {}) => {
      if (!file) throw new Error("Pilih file terlebih dahulu");
      const fd = new FormData();
      fd.append("file", file);
      if (partnerId) fd.append("partnerId", partnerId);
      if (periodStart) fd.append("periodStart", periodStart);
      if (periodEnd) fd.append("periodEnd", periodEnd);
      if (opts.skipDuplicateCheck || forceUpload) fd.append("skipDuplicateCheck", "true");
      const res = await fetch("/api/logistics/fleet/reports/upload", {
        method: "POST", credentials: "include", body: fd,
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({})) as Record<string, unknown>;
        if ((err as any).duplicateReportId)
          throw Object.assign(new Error(String(err.error)), { isDuplicate: true, data: err });
        const msg = String(err.error ?? "Upload gagal");
        if (res.status === 401) throw new Error("Sesi berakhir — silakan login ulang");
        if (res.status === 500 && (msg.includes("timeout") || msg.includes("circuit") || msg.includes("ECIRCUIT")))
          throw new Error("Database sedang pulih. Tunggu ~30 detik lalu coba import ulang.");
        throw new Error(msg);
      }
      return res.json() as Promise<{ reportId: number; message: string }>;
    },
    onSuccess: (data) => {
      toast.success("File berhasil diupload dan sedang diproses di Supabase...");
      setDbRecovering(false);
      setActiveReportId(data.reportId);
      setPollEnabled(true);
      resetForm();
      qc.invalidateQueries({ queryKey: ["fleet-reports"] });
    },
    onError: (err: Error & { isDuplicate?: boolean; data?: Record<string, unknown> }) => {
      if (err.isDuplicate) {
        toast.error(`Duplikat terdeteksi (ID: ${err.data?.duplicateReportId}). Gunakan "Upload Paksa" atau "Replace" untuk menimpa.`);
      } else {
        if (err.message.includes("Database sedang pulih") || err.message.includes("timeout") || err.message.includes("circuit"))
          setDbRecovering(true);
        toast.error(err.message);
      }
    },
  });

  const purgeMutation = useMutation({
    mutationFn: async (id: number) => {
      const res = await fetch(`/api/logistics/fleet/reports/${id}/purge`, { method: "POST", credentials: "include" });
      if (!res.ok) throw new Error("Gagal purge");
      return res.json();
    },
    onSuccess: () => { toast.success("Semua data dihapus bersih. Siap re-upload."); qc.invalidateQueries({ queryKey: ["fleet-reports"] }); },
    onError: (e: Error) => toast.error(e.message),
  });

  const rollbackMutation = useMutation({
    mutationFn: async (id: number) => {
      const res = await fetch(`/api/logistics/fleet/reports/${id}`, { method: "DELETE", credentials: "include" });
      if (!res.ok) throw new Error("Gagal rollback");
      return res.json();
    },
    onSuccess: () => { toast.success("Report di-rollback, transaksi dan raw data dihapus"); qc.invalidateQueries({ queryKey: ["fleet-reports"] }); },
    onError: (e: Error) => toast.error(e.message),
  });

  const purgeAllMutation = useMutation({
    mutationFn: async () => {
      const res = await fetch("/api/logistics/fleet/reports/purge-all", { method: "POST", credentials: "include" });
      if (!res.ok) {
        const err = await res.json().catch(() => ({})) as Record<string, unknown>;
        throw new Error(String(err.error ?? "Gagal hapus semua data"));
      }
      return res.json() as Promise<{ ok: boolean; message: string; reportCount: number }>;
    },
    onSuccess: (data) => { toast.success(data.message); qc.invalidateQueries({ queryKey: ["fleet-reports"] }); },
    onError: (e: Error) => toast.error(e.message),
  });

  function resetForm() {
    setFile(null); setPreview(null); setStep("select"); setForceUpload(false); setSelectedPurgeId(null);
    if (fileRef.current) fileRef.current.value = "";
  }

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault(); setDragging(false);
    const f = e.dataTransfer.files[0];
    if (f) { setFile(f); setPreview(null); setStep("select"); }
  };

  const fileSize = file ? (file.size / 1024).toFixed(1) + " KB" : null;

  const colMapLabels: Record<string, string> = {
    driverName: "Nama Driver", driverExtId: "ID Driver", driverPhone: "No HP",
    txDate: "Tanggal & Waktu", simpleDate: "Tanggal", vehiclePlate: "Plat Kendaraan",
    amount: "Amount", outstanding: "Total Outstanding", transactionType: "Jenis Transaksi",
    gopayRef: "GoPay Ref ID", grossRevenue: "Gross Revenue",
    tripCount: "Jumlah Trip", incentive: "Insentif", commission: "Komisi",
    deduction: "Potongan", netRevenue: "Net Revenue", serviceType: "Layanan",
  };

  const isProcessing = pollEnabled && activeReportId && progressData;
  const processPct = progressData && progressData.rowCount > 0
    ? Math.min(100, Math.round((progressData.rawInserted / progressData.rowCount) * 100)) : 0;

  return (
    <div className="space-y-6">
      {/* Live progress */}
      {isProcessing && progressData && (
        <Card className="bg-slate-800/80 border-blue-700/50">
          <CardHeader className="pb-2">
            <CardTitle className="text-white text-base flex items-center gap-2">
              <Activity className="w-4 h-4 text-blue-400 animate-pulse" />
              Pipeline Aktif — Report #{activeReportId}
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
              {[
                { label: "Total Baris", val: fmtNum(progressData.rowCount), cls: "text-white" },
                { label: "Raw Tersimpan", val: fmtNum(progressData.rawInserted), cls: "text-blue-400" },
                { label: "Sukses Transform", val: fmtNum(progressData.successRows), cls: "text-emerald-400" },
                { label: "DLQ (Gagal)", val: fmtNum(progressData.dlqCount), cls: "text-red-400" },
              ].map((s) => (
                <div key={s.label} className="bg-slate-900/60 rounded-lg p-3">
                  <p className={`text-2xl font-bold ${s.cls}`}>{s.val}</p>
                  <p className="text-xs text-slate-400 mt-0.5">{s.label}</p>
                </div>
              ))}
            </div>
            <div className="space-y-1.5">
              <div className="flex justify-between text-xs text-slate-400">
                <span>Raw ingestion progress</span><span>{processPct}%</span>
              </div>
              <Progress value={processPct} className="h-2" />
            </div>
            {progressData.healthScore > 0 && (
              <div className="flex items-center gap-3 text-sm">
                <span className="text-slate-400">Health Score:</span>
                <span className={`text-xl font-bold ${gradeColor(progressData.grade)}`}>{progressData.grade}</span>
                <span className="text-slate-300">{progressData.healthScore.toFixed(1)}/100</span>
                {progressData.dlqCount > 0 && (
                  <Badge className="bg-red-500/20 text-red-300 border-red-600 border text-xs">
                    <ShieldAlert className="w-3 h-3 mr-1" />{fmtNum(progressData.dlqCount)} di DLQ
                  </Badge>
                )}
              </div>
            )}
            {["done", "partial", "error"].includes(progressData.status) && (
              <div className="flex gap-2">
                <Badge className={`border ${statusColor(progressData.status)} text-sm px-3 py-1`}>
                  {progressData.status === "done" ? "✓ Selesai" : progressData.status === "partial" ? "⚠ Parsial" : "✗ Error"}
                </Badge>
                <Button variant="ghost" size="sm" className="text-slate-400 hover:text-white"
                  onClick={() => { setActiveReportId(null); setPollEnabled(false); }}>Tutup</Button>
              </div>
            )}
          </CardContent>
        </Card>
      )}

      {/* DB Recovering Banner */}
      {dbRecovering && (
        <div className="flex items-start gap-3 p-4 bg-amber-900/30 border border-amber-600/40 rounded-xl">
          <AlertTriangle className="w-5 h-5 text-amber-400 flex-shrink-0 mt-0.5" />
          <div className="flex-1">
            <p className="text-amber-300 font-semibold text-sm">Database sedang pulih</p>
            <p className="text-slate-400 text-xs mt-0.5">
              Supabase pgBouncer memblok koneksi sementara setelah restart server. Tunggu ~30 detik lalu coba lagi.
            </p>
          </div>
          <Button size="sm" variant="ghost" className="text-amber-400 hover:text-amber-300 hover:bg-amber-900/30 h-7 px-2 text-xs"
            onClick={() => { setDbRecovering(false); previewMutation.reset(); }}>
            <RefreshCw className="w-3.5 h-3.5 mr-1" /> Coba Lagi
          </Button>
        </div>
      )}

      {/* Step indicator */}
      <div className="flex items-center gap-2 text-sm">
        {(["select", "preview", "done"] as Step[]).map((s, i) => (
          <div key={s} className="flex items-center gap-2">
            {i > 0 && <ChevronRight className="w-4 h-4 text-slate-600" />}
            <div className={`flex items-center gap-1.5 px-3 py-1 rounded-full ${step === s ? "bg-blue-600 text-white" : step === "done" && i < 2 ? "bg-emerald-600/30 text-emerald-400" : "bg-slate-700 text-slate-400"}`}>
              <span className="text-xs font-medium">
                {i + 1}. {s === "select" ? "Pilih File" : s === "preview" ? "Preview" : "Upload"}
              </span>
            </div>
          </div>
        ))}
      </div>

      {/* STEP 1: Select */}
      {step === "select" && (
        <Card className="bg-slate-800/60 border-slate-700">
          <CardHeader><CardTitle className="text-white text-base">Upload File Report</CardTitle></CardHeader>
          <CardContent className="space-y-5">
            <div
              className={`relative border-2 border-dashed rounded-xl p-8 text-center cursor-pointer transition-all ${dragging ? "border-blue-500 bg-blue-900/20" : "border-slate-600 hover:border-slate-500 bg-slate-900/30"}`}
              onDragOver={(e) => { e.preventDefault(); setDragging(true); }}
              onDragLeave={() => setDragging(false)}
              onDrop={handleDrop}
              onClick={() => fileRef.current?.click()}
            >
              <input ref={fileRef} type="file" accept=".csv,.xlsx,.xls" className="hidden"
                onChange={(e) => { setFile(e.target.files?.[0] ?? null); setPreview(null); }} />
              <Upload className="w-10 h-10 text-slate-400 mx-auto mb-3" />
              {file ? (
                <div>
                  <p className="text-white font-medium">{file.name}</p>
                  <p className="text-slate-400 text-sm mt-1">{fileSize}</p>
                </div>
              ) : (
                <div>
                  <p className="text-slate-300">Drag & drop file CSV/Excel di sini</p>
                  <p className="text-slate-500 text-sm mt-1">atau klik untuk pilih file</p>
                  <p className="text-slate-600 text-xs mt-2">Format: Gojek Fleet Ledger / Transaction Report</p>
                </div>
              )}
            </div>

            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
              <div className="space-y-1.5">
                <Label className="text-slate-300 text-sm">Fleet Partner (opsional)</Label>
                <SafeSelect
                  value={partnerId} onValueChange={setPartnerId}
                  options={(partners?.partners ?? []).map((p) => ({ value: String(p.id), label: p.name }))}
                  noneLabel="— Tanpa Partner —" placeholder="Pilih partner..."
                  triggerClassName="bg-slate-700 border-slate-600 text-white"
                />
              </div>
              <div className="space-y-1.5">
                <Label className="text-slate-300 text-sm">Periode Mulai</Label>
                <DatePicker value={periodStart} onChange={(v) => setPeriodStart(v)} className="bg-slate-700 border-slate-600 text-white" />
              </div>
              <div className="space-y-1.5">
                <Label className="text-slate-300 text-sm">Periode Akhir</Label>
                <DatePicker value={periodEnd} onChange={(v) => setPeriodEnd(v)} className="bg-slate-700 border-slate-600 text-white" />
              </div>
            </div>

            <div className="flex items-center gap-2">
              <input type="checkbox" id="forceUpload" checked={forceUpload} onChange={(e) => setForceUpload(e.target.checked)} className="w-4 h-4 accent-blue-500" />
              <label htmlFor="forceUpload" className="text-slate-400 text-sm">Upload paksa (abaikan cek duplikat)</label>
            </div>

            <Button
              className="w-full bg-blue-600 hover:bg-blue-700 h-12 text-base font-semibold shadow-lg shadow-blue-900/30 disabled:opacity-50"
              disabled={!file || previewMutation.isPending}
              onClick={() => { setDbRecovering(false); previewMutation.mutate(); }}
            >
              {previewMutation.isPending
                ? <><RefreshCw className="w-5 h-5 mr-2 animate-spin" /> Menganalisis file — bisa 5–30 detik...</>
                : <><Eye className="w-5 h-5 mr-2" /> Preview Sebelum Import</>}
            </Button>
          </CardContent>
        </Card>
      )}

      {/* STEP 2: Preview */}
      {step === "preview" && preview && (
        <div className="space-y-4">
          {preview.duplicateReport && (
            <div className="p-4 bg-amber-900/30 border border-amber-600/40 rounded-xl space-y-3">
              <div className="flex items-start gap-3">
                <AlertTriangle className="w-5 h-5 text-amber-400 flex-shrink-0 mt-0.5" />
                <div className="flex-1">
                  <p className="text-amber-300 font-semibold">File Duplikat Terdeteksi</p>
                  <p className="text-slate-400 text-sm mt-0.5">
                    File identik sudah ada: <span className="text-white font-medium">{String(preview.duplicateReport.original_filename)}</span>
                    {" "}(ID #{preview.duplicateReport.id}, status:{" "}
                    <span className={`font-medium ${preview.duplicateReport.status === "done" ? "text-emerald-400" : "text-amber-300"}`}>
                      {preview.duplicateReport.status}
                    </span>)
                  </p>
                </div>
              </div>
            </div>
          )}

          {preview.warnings?.length > 0 && (
            <div className="p-4 bg-yellow-900/20 border border-yellow-700/40 rounded-xl space-y-2">
              <p className="text-yellow-400 font-semibold text-sm flex items-center gap-2">
                <AlertTriangle className="w-4 h-4" /> Peringatan
              </p>
              {preview.warnings.map((w, i) => (
                <p key={i} className="text-yellow-300 text-sm flex items-center gap-2">
                  <AlertTriangle className="w-3.5 h-3.5" /> {w}
                </p>
              ))}
            </div>
          )}

          {/* Fresh import section */}
          {(() => {
            const activeReports = (reports?.reports ?? []).filter(
              (r: Record<string, unknown>) => !["rolled_back","purged","purged_all"].includes(String(r.status))
            );
            if (activeReports.length === 0) return null;
            const totalRows = activeReports.reduce((sum: number, r: Record<string, unknown>) => sum + Number(r.row_count ?? 0), 0);
            const purgeTargetId = selectedPurgeId ?? Number(activeReports[0].id);
            const purgeTarget = activeReports.find((r: Record<string, unknown>) => Number(r.id) === purgeTargetId) ?? activeReports[0];
            return (
              <div className="p-4 bg-red-900/20 border border-red-600/50 rounded-xl space-y-3">
                <div className="flex items-start gap-3">
                  <Trash2 className="w-5 h-5 text-red-400 flex-shrink-0 mt-0.5" />
                  <div className="flex-1">
                    <p className="text-red-300 font-bold text-sm">Fresh Import — Hapus Semua Data Lama</p>
                    <p className="text-slate-400 text-xs mt-0.5">
                      Ada <span className="text-white font-medium">{activeReports.length} laporan</span> ({totalRows.toLocaleString("id-ID")} baris) yang akan dihapus seluruhnya.
                    </p>
                  </div>
                </div>
                <div className="ml-8 flex flex-col sm:flex-row gap-2">
                  <Button size="sm" className="bg-red-700 hover:bg-red-600 text-white gap-1.5 font-semibold"
                    disabled={purgeAllMutation.isPending || uploadMutation.isPending || purgeMutation.isPending}
                    onClick={() => {
                      if (confirm(`⚠️ HAPUS SEMUA DATA FLEET?\n\n${activeReports.length} laporan (${totalRows.toLocaleString("id-ID")} baris) akan dihapus permanen.\n\nLanjutkan?`)) {
                        purgeAllMutation.mutate(undefined, {
                          onSuccess: () => uploadMutation.mutate({ skipDuplicateCheck: true }),
                        });
                      }
                    }}>
                    {purgeAllMutation.isPending
                      ? <><RefreshCw className="w-3.5 h-3.5 animate-spin" /> Menghapus semua...</>
                      : <><Trash2 className="w-3.5 h-3.5" /> Hapus Semua & Upload Baru</>}
                  </Button>
                </div>
                {activeReports.length > 1 && (
                  <div className="ml-8 pt-2 border-t border-red-800/30">
                    <p className="text-slate-500 text-xs mb-2">Atau hapus satu laporan saja:</p>
                    <div className="flex flex-col sm:flex-row gap-2 items-start sm:items-center">
                      <select className="flex-1 bg-slate-800 border border-slate-700 text-white text-xs rounded px-2 py-1.5 focus:outline-none focus:border-red-500"
                        value={purgeTargetId} onChange={(e) => setSelectedPurgeId(Number(e.target.value))}>
                        {activeReports.map((r: Record<string, unknown>) => (
                          <option key={String(r.id)} value={String(r.id)}>
                            #{String(r.id)} — {String(r.original_filename ?? "—")} ({String(r.status)}, {Number(r.row_count ?? 0).toLocaleString("id-ID")} baris)
                          </option>
                        ))}
                      </select>
                      <Button size="sm" variant="outline" className="border-red-700 text-red-300 hover:text-red-200 gap-1.5 text-xs whitespace-nowrap"
                        disabled={purgeMutation.isPending || uploadMutation.isPending || purgeAllMutation.isPending}
                        onClick={() => {
                          const fname = String(purgeTarget?.original_filename ?? `Report #${purgeTargetId}`);
                          if (confirm(`Hapus data laporan "${fname}" saja?`)) {
                            purgeMutation.mutate(purgeTargetId, {
                              onSuccess: () => uploadMutation.mutate({ skipDuplicateCheck: true }),
                            });
                          }
                        }}>
                        {purgeMutation.isPending ? <><RefreshCw className="w-3 h-3 animate-spin" /> Menghapus...</> : <><Trash2 className="w-3 h-3" /> Hapus Laporan Ini & Upload</>}
                      </Button>
                    </div>
                  </div>
                )}
              </div>
            );
          })()}

          {/* Ledger metrics */}
          {preview.data && (
            <Card className="bg-slate-800/60 border-slate-700">
              <CardHeader className="pb-2">
                <CardTitle className="text-white text-base flex items-center gap-2">
                  <TrendingUp className="w-4 h-4 text-emerald-400" />Ledger Summary
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                  <div className="bg-slate-900/60 rounded-lg p-3">
                    <p className="text-2xl font-bold text-white">{fmtNum(preview.data.transactionCount)}</p>
                    <p className="text-xs text-slate-400 mt-0.5">Total Transaksi</p>
                  </div>
                  <div className="bg-slate-900/60 rounded-lg p-3">
                    <p className="text-2xl font-bold text-emerald-400">{Number(preview.data.totalCredit).toLocaleString("id-ID")}</p>
                    <p className="text-xs text-slate-400 mt-0.5">Total Credit (+)</p>
                  </div>
                  <div className="bg-slate-900/60 rounded-lg p-3">
                    <p className="text-2xl font-bold text-red-400">{Number(preview.data.totalDebit).toLocaleString("id-ID")}</p>
                    <p className="text-xs text-slate-400 mt-0.5">Total Debit (−)</p>
                  </div>
                  <div className="bg-slate-900/60 rounded-lg p-3">
                    <p className={`text-2xl font-bold ${preview.data.netFlow >= 0 ? "text-emerald-300" : "text-red-300"}`}>
                      {Number(preview.data.netFlow).toLocaleString("id-ID")}
                    </p>
                    <p className="text-xs text-slate-400 mt-0.5">Net Flow</p>
                  </div>
                </div>
              </CardContent>
            </Card>
          )}

          {/* Analysis */}
          <Card className="bg-slate-800/60 border-slate-700">
            <CardHeader className="pb-2">
              <CardTitle className="text-white text-base flex items-center gap-2">
                <Database className="w-4 h-4 text-blue-400" />
                Analisis File — {preview.rowCount} baris akan masuk raw layer
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-4">
                <div><p className="text-lg font-bold text-white">{preview.rowCount}</p><p className="text-xs text-slate-400">Total Baris</p></div>
                <div><p className="text-lg font-bold text-white">{preview.headers.length}</p><p className="text-xs text-slate-400">Kolom</p></div>
                <div><p className="text-lg font-bold text-emerald-400">{Object.values(preview.columnMapping).filter(Boolean).length}</p><p className="text-xs text-slate-400">Kolom Terdeteksi</p></div>
                <div><p className="text-lg font-bold text-yellow-400">{preview.warnings.length}</p><p className="text-xs text-slate-400">Peringatan</p></div>
              </div>
              <div className="flex flex-wrap gap-2">
                {Object.entries(preview.columnMapping).map(([key, val]) =>
                  val ? (
                    <span key={key} className="text-xs px-2 py-1 rounded border bg-emerald-500/10 border-emerald-700 text-emerald-300">
                      {colMapLabels[key] ?? key}: {val}
                    </span>
                  ) : null
                )}
              </div>
            </CardContent>
          </Card>

          {/* Preview table */}
          <Card className="bg-slate-800/60 border-slate-700">
            <CardHeader className="pb-2">
              <CardTitle className="text-white text-base">Preview Data (20 baris pertama dari {preview.rowCount})</CardTitle>
            </CardHeader>
            <CardContent className="p-0">
              <div className="overflow-x-auto">
                <table className="w-full text-xs">
                  <thead className="border-b border-slate-700">
                    <tr>
                      <th className="text-left px-3 py-2.5 text-slate-500 font-medium">#</th>
                      {preview.headers.map((h) => (
                        <th key={h} className="text-left px-3 py-2.5 text-slate-400 font-medium whitespace-nowrap capitalize">{h}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {preview.previewRows.map((r, i) => {
                      const raw = (r as any)._raw ?? {};
                      return (
                        <tr key={i} className="border-b border-slate-700/50 hover:bg-slate-700/20">
                          <td className="px-3 py-2 text-slate-600">{i + 1}</td>
                          {preview.headers.map((h) => {
                            const val = raw[h];
                            const str = val == null || val === "" ? "—" : String(val);
                            const isNum = !isNaN(Number(String(val).replace(/,/g, ""))) && str !== "—";
                            return (
                              <td key={h} className={`px-3 py-2 whitespace-nowrap ${isNum ? "text-right font-mono text-emerald-300" : "text-slate-300"}`} title={str}>
                                {str.length > 30 ? str.slice(0, 28) + "…" : str}
                              </td>
                            );
                          })}
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </CardContent>
          </Card>

          {/* Actions */}
          <div className="space-y-2">
            <div className="flex gap-3">
              <Button variant="outline" className="border-slate-600 text-slate-300 hover:text-white h-12 px-5" onClick={resetForm}>
                ← Kembali
              </Button>
              <Button
                className="flex-1 bg-emerald-600 hover:bg-emerald-700 h-12 text-base font-semibold shadow-lg shadow-emerald-900/30 disabled:opacity-50"
                disabled={uploadMutation.isPending}
                onClick={() => uploadMutation.mutate({})}
              >
                {uploadMutation.isPending
                  ? <><RefreshCw className="w-5 h-5 mr-2 animate-spin" /> Menyimpan ke Supabase...</>
                  : <><Database className="w-5 h-5 mr-2" /> Simpan {preview.rowCount} Baris ke Supabase</>}
              </Button>
            </div>
            {!uploadMutation.isPending && (
              <p className="text-center text-slate-500 text-xs">
                <Server className="w-3 h-3 inline mr-1 text-emerald-500" />
                Data akan disimpan ke tabel <span className="text-slate-400 font-mono">gojek_raw_transactions</span> di Supabase
              </p>
            )}
          </div>
        </div>
      )}

      {/* Report history */}
      <Card className="bg-slate-800/60 border-slate-700">
        <CardHeader className="flex flex-row items-center justify-between pb-2">
          <CardTitle className="text-white text-base flex items-center gap-2">
            <FileText className="w-4 h-4 text-slate-400" />Riwayat Upload
          </CardTitle>
          <Button variant="ghost" size="sm" onClick={() => refetchReports()} className="text-slate-400 hover:text-white">
            <RefreshCw className="w-4 h-4" />
          </Button>
        </CardHeader>
        <CardContent>
          <div className="space-y-2">
            {(reports?.reports ?? []).length === 0 && (
              <div className="text-center py-8 text-slate-500">
                <FileText className="w-10 h-10 mx-auto mb-2 opacity-40" />
                <p>Belum ada report yang diupload</p>
              </div>
            )}
            {(reports?.reports ?? []).map((r) => {
              const isActive = activeReportId === Number(r.id);
              return (
                <div key={String(r.id)} className={`p-3 rounded-lg border transition-colors ${isActive ? "bg-blue-900/20 border-blue-700/50" : "bg-slate-900/40 border-slate-700/50"}`}>
                  <div className="flex items-center justify-between gap-3">
                    <div className="flex items-center gap-3 min-w-0">
                      <FileText className="w-5 h-5 text-slate-400 flex-shrink-0" />
                      <div className="min-w-0">
                        <p className="text-white text-sm font-medium truncate">{String(r.original_filename)}</p>
                        <p className="text-slate-500 text-xs mt-0.5">
                          {fmtDate(r.created_at)}
                          {!!r.file_hash && <span className="ml-2 font-mono opacity-40">#{String(r.file_hash).slice(0, 8)}</span>}
                        </p>
                      </div>
                    </div>
                    <div className="flex items-center gap-2 flex-shrink-0">
                      <div className="text-right text-xs text-slate-400 hidden md:block space-y-0.5">
                        <p>
                          <span className="text-emerald-400">{fmtNum(r.processed_count)}</span>
                          <span className="text-slate-600"> / </span>
                          <span>{fmtNum(r.row_count)}</span>
                          <span className="text-slate-500"> baris</span>
                        </p>
                        {Number(r.error_count) > 0 && (
                          <p className="text-red-400 flex items-center gap-1 justify-end">
                            <ShieldAlert className="w-3 h-3" />{fmtNum(r.error_count)} DLQ
                          </p>
                        )}
                      </div>
                      <Badge className={`text-xs border ${statusColor(String(r.status))}`}>
                        {r.status === "done" && <CheckCircle className="w-3 h-3 mr-1" />}
                        {r.status === "error" && <XCircle className="w-3 h-3 mr-1" />}
                        {(r.status === "processing" || r.status === "queued") && <Clock className="w-3 h-3 mr-1 animate-spin" />}
                        {String(r.status)}
                      </Badge>
                      {(r.status === "processing" || r.status === "queued") && !isActive && (
                        <Button variant="ghost" size="sm" className="h-7 px-2 text-blue-400 hover:text-blue-300 hover:bg-blue-900/20 text-xs"
                          onClick={() => { setActiveReportId(Number(r.id)); setPollEnabled(true); }}>
                          <Activity className="w-3.5 h-3.5 mr-1" />Live
                        </Button>
                      )}
                      {(r.status === "done" || r.status === "partial") && (
                        <Button variant="ghost" size="sm" className="h-7 w-7 p-0 text-amber-400 hover:text-amber-300 hover:bg-amber-900/20" title="Rollback transaksi"
                          onClick={() => {
                            if (confirm(`Rollback "${r.original_filename}"?\nSemua transaksi dari report ini akan dihapus.`))
                              rollbackMutation.mutate(Number(r.id));
                          }}>
                          <RotateCcw className="w-3.5 h-3.5" />
                        </Button>
                      )}
                      {!["rolled_back", "purged"].includes(String(r.status)) && (
                        <Button variant="ghost" size="sm" className="h-7 w-7 p-0 text-red-500 hover:text-red-400 hover:bg-red-900/20" title="Delete & Replace"
                          disabled={purgeMutation.isPending}
                          onClick={() => {
                            if (confirm(`Delete & Replace "${r.original_filename}"?\n\nSEMUA DATA dihapus bersih.`))
                              purgeMutation.mutate(Number(r.id));
                          }}>
                          <Trash2 className="w-3.5 h-3.5" />
                        </Button>
                      )}
                    </div>
                  </div>
                  {isActive && progressData && (
                    <div className="mt-2 space-y-1">
                      <Progress value={processPct} className="h-1.5" />
                      <div className="flex justify-between text-xs text-slate-500">
                        <span>{fmtNum(progressData.rawInserted)} raw tersimpan</span>
                        <span>{fmtNum(progressData.successRows)} transformed · {fmtNum(progressData.dlqCount)} DLQ</span>
                      </div>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </CardContent>
      </Card>

      <div className="flex flex-wrap gap-4 text-xs text-slate-500 px-1">
        <span className="flex items-center gap-1.5"><Database className="w-3.5 h-3.5 text-blue-400" /> Raw = 100% tersimpan sebelum transform</span>
        <span className="flex items-center gap-1.5"><ShieldAlert className="w-3.5 h-3.5 text-amber-400" /> DLQ = baris gagal (tidak hilang, bisa di-retry)</span>
        <span className="flex items-center gap-1.5"><Trash2 className="w-3.5 h-3.5 text-red-400" /> Purge = hapus bersih tanpa orphan</span>
      </div>
    </div>
  );
}

// ─── Tab: Ringkasan Outstanding ───────────────────────────────────────────────

type SnapshotStep = "select" | "preview" | "done";

type ImportLogRow = {
  id: number;
  report_file_name: string;
  uploaded_by: string;
  uploaded_at: string;
  total_rows: number;
  rows_imported: number;
  rows_skipped: number;
  unmatched_drivers: number;
  notes: string | null;
};

function SnapshotUploadTab() {
  const qc = useQueryClient();
  const fileRef = useRef<HTMLInputElement>(null);
  const [file, setFile] = useState<File | null>(null);
  const [dragging, setDragging] = useState(false);
  const [step, setStep] = useState<SnapshotStep>("select");
  const [previewData, setPreviewData] = useState<SnapshotPreviewResult | null>(null);
  const [importResult, setImportResult] = useState<{ updated: number; inserted: number; skipped: number; errors?: number; total: number; message: string } | null>(null);
  const [logDays, setLogDays] = useState<7 | 30>(30);

  const fileSize = file ? (file.size / 1024).toFixed(1) + " KB" : null;

  const { data: importLogs, refetch: refetchLogs } = useQuery({
    queryKey: ["fleet-snapshot-import-log", logDays],
    queryFn: async () => {
      const res = await fetch(`/api/logistics/fleet/outstanding/import-log?days=${logDays}`, { credentials: "include" });
      if (!res.ok) return { logs: [] as ImportLogRow[] };
      return res.json() as Promise<{ logs: ImportLogRow[] }>;
    },
    refetchInterval: 30_000,
  });

  const previewMutation = useMutation({
    mutationFn: async () => {
      if (!file) throw new Error("Pilih file terlebih dahulu");
      const fd = new FormData();
      fd.append("file", file);
      const res = await fetch("/api/logistics/fleet/outstanding/snapshot/preview", {
        method: "POST", credentials: "include", body: fd,
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({})) as Record<string, unknown>;
        throw new Error(String(err.error ?? "Gagal preview file"));
      }
      return res.json() as Promise<SnapshotPreviewResult>;
    },
    onSuccess: (data) => { setPreviewData(data); setStep("preview"); },
    onError: (e: Error) => toast.error(e.message),
  });

  const importMutation = useMutation({
    mutationFn: async () => {
      if (!previewData) throw new Error("Preview data hilang — ulangi langkah preview");
      const res = await fetch("/api/logistics/fleet/outstanding/snapshot/confirm", {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          rows: previewData.rows,
          fileName: file?.name ?? "snapshot.csv",
        }),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({})) as Record<string, unknown>;
        throw new Error(String(err.error ?? "Gagal konfirmasi import"));
      }
      return res.json() as Promise<{ updated: number; inserted: number; skipped: number; errors: number; total: number; message: string }>;
    },
    onSuccess: (data) => {
      toast.success(data.message);
      setImportResult(data);
      setStep("done");
      qc.invalidateQueries({ queryKey: ["fleet-macet-outstanding"] });
      qc.invalidateQueries({ queryKey: ["fleet-outstanding"] });
      qc.invalidateQueries({ queryKey: ["fleet-outstanding-index"] });
      qc.invalidateQueries({ queryKey: ["fleet-dashboard"] });
      refetchLogs();
    },
    onError: (e: Error) => toast.error(e.message),
  });

  function reset() {
    setFile(null); setPreviewData(null); setImportResult(null); setStep("select");
    if (fileRef.current) fileRef.current.value = "";
  }

  const totalOutstanding = (previewData?.rows ?? []).reduce((s, r) => s + r.outstanding, 0);

  return (
    <div className="space-y-6">
      {/* Info box */}
      <div className="p-4 bg-blue-900/20 border border-blue-700/40 rounded-xl space-y-3">
        <p className="text-blue-300 font-semibold text-sm flex items-center gap-2">
          <FileSpreadsheet className="w-4 h-4" />
          Format CSV: Ringkasan Outstanding Gojek
        </p>
        <div className="text-xs space-y-1.5">
          <p className="text-slate-300 font-medium">Kolom yang dibutuhkan (header baris pertama):</p>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-1.5">
            {[
              { col: "Driver Name", desc: "Nama driver — wajib ada" },
              { col: "Phone Number", desc: 'No. HP — bisa diawali tab (otomatis dibersihkan)' },
              { col: "License Plate", desc: 'Plat kendaraan — boleh kosong (driver "Need to assign")' },
              { col: "Rental fee(Daily)", desc: "Rental fee harian — boleh 0" },
              { col: "Outstanding", desc: "Saldo outstanding — baris dengan nilai 0 akan dilewati" },
              { col: "Status", desc: '"Active" atau "Need to assign"' },
            ].map(({ col, desc }) => (
              <div key={col} className="flex items-start gap-2">
                <code className="bg-slate-700/80 px-1.5 py-0.5 rounded text-indigo-300 whitespace-nowrap shrink-0">{col}</code>
                <span className="text-slate-500">{desc}</span>
              </div>
            ))}
          </div>
        </div>
        <p className="text-slate-500 text-xs">
          Import ini akan <strong className="text-amber-300">memperbarui</strong> data outstanding yang ada untuk setiap driver yang cocok, atau menambahkan entri baru jika belum ada.
        </p>
      </div>

      {/* Step indicator */}
      <div className="flex items-center gap-2 text-sm">
        {(["select", "preview", "done"] as SnapshotStep[]).map((s, i) => (
          <div key={s} className="flex items-center gap-2">
            {i > 0 && <ChevronRight className="w-4 h-4 text-slate-600" />}
            <div className={`flex items-center gap-1.5 px-3 py-1 rounded-full ${step === s ? "bg-emerald-600 text-white" : (step === "done" && i < 2) || (step === "preview" && i === 0) ? "bg-emerald-600/30 text-emerald-400" : "bg-slate-700 text-slate-400"}`}>
              <span className="text-xs font-medium">
                {i + 1}. {s === "select" ? "Pilih File" : s === "preview" ? "Preview" : "Selesai"}
              </span>
            </div>
          </div>
        ))}
      </div>

      {/* STEP 1: Select */}
      {step === "select" && (
        <Card className="bg-slate-800/60 border-slate-700">
          <CardHeader><CardTitle className="text-white text-base">Upload CSV Ringkasan Outstanding</CardTitle></CardHeader>
          <CardContent className="space-y-5">
            <div
              className={`relative border-2 border-dashed rounded-xl p-8 text-center cursor-pointer transition-all ${dragging ? "border-emerald-500 bg-emerald-900/10" : "border-slate-600 hover:border-slate-500 bg-slate-900/30"}`}
              onDragOver={(e) => { e.preventDefault(); setDragging(true); }}
              onDragLeave={() => setDragging(false)}
              onDrop={(e) => { e.preventDefault(); setDragging(false); const f = e.dataTransfer.files[0]; if (f) { setFile(f); setPreviewData(null); setStep("select"); } }}
              onClick={() => fileRef.current?.click()}
            >
              <input ref={fileRef} type="file" accept=".csv" className="hidden"
                onChange={(e) => { setFile(e.target.files?.[0] ?? null); setPreviewData(null); }} />
              <FileSpreadsheet className="w-10 h-10 text-slate-400 mx-auto mb-3" />
              {file ? (
                <div>
                  <p className="text-white font-medium">{file.name}</p>
                  <p className="text-slate-400 text-sm mt-1">{fileSize}</p>
                </div>
              ) : (
                <div>
                  <p className="text-slate-300">Drag & drop file CSV di sini</p>
                  <p className="text-slate-500 text-sm mt-1">atau klik untuk pilih file</p>
                  <p className="text-slate-600 text-xs mt-2">Format: CSV Ringkasan Outstanding Gojek</p>
                </div>
              )}
            </div>

            <Button
              className="w-full bg-emerald-600 hover:bg-emerald-700 h-12 text-base font-semibold disabled:opacity-50"
              disabled={!file || previewMutation.isPending}
              onClick={() => previewMutation.mutate()}
            >
              {previewMutation.isPending
                ? <><RefreshCw className="w-5 h-5 mr-2 animate-spin" /> Menganalisis...</>
                : <><Eye className="w-5 h-5 mr-2" /> Preview Sebelum Import</>}
            </Button>
          </CardContent>
        </Card>
      )}

      {/* STEP 2: Preview */}
      {step === "preview" && previewData && (
        <div className="space-y-4">
          {/* Summary cards */}
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            {[
              { label: "Total Driver", val: previewData.total, cls: "text-white" },
              { label: "Driver Cocok", val: previewData.found, cls: "text-emerald-400" },
              { label: "Tidak Cocok (Baru)", val: previewData.unmatched, cls: "text-amber-400" },
              { label: "Lunas / Dilewati", val: previewData.skipped, cls: "text-slate-400" },
            ].map((s) => (
              <div key={s.label} className="bg-slate-900/60 rounded-lg p-3">
                <p className={`text-2xl font-bold ${s.cls}`}>{s.val}</p>
                <p className="text-xs text-slate-400 mt-0.5">{s.label}</p>
              </div>
            ))}
          </div>

          <div className="bg-slate-900/40 rounded-lg p-3 flex items-center justify-between">
            <span className="text-slate-400 text-sm">Total Outstanding yang akan diimport</span>
            <span className="text-red-400 font-bold text-lg">{fmtIdr(totalOutstanding)}</span>
          </div>

          {/* Preview table */}
          <Card className="bg-slate-800/60 border-slate-700">
            <CardHeader className="pb-2">
              <CardTitle className="text-white text-base">
                Preview {previewData.total} driver (outstanding &gt; 0 atau "Need to assign")
              </CardTitle>
            </CardHeader>
            <CardContent className="p-0">
              <div className="overflow-x-auto">
                <table className="w-full text-xs">
                  <thead className="border-b border-slate-700 bg-slate-900/40">
                    <tr>
                      <th className="px-3 py-2.5 text-left text-slate-400">#</th>
                      <th className="px-3 py-2.5 text-left text-slate-400">Nama Driver</th>
                      <th className="px-3 py-2.5 text-left text-slate-400">Phone</th>
                      <th className="px-3 py-2.5 text-left text-slate-400">Plat</th>
                      <th className="px-3 py-2.5 text-right text-slate-400">Rental/hari</th>
                      <th className="px-3 py-2.5 text-right text-slate-400">Outstanding</th>
                      <th className="px-3 py-2.5 text-left text-slate-400">Status CSV</th>
                      <th className="px-3 py-2.5 text-left text-slate-400">Match DB</th>
                    </tr>
                  </thead>
                  <tbody>
                    {previewData.rows.map((row, i) => (
                      <tr key={i} className="border-b border-slate-700/40 hover:bg-slate-700/20">
                        <td className="px-3 py-2 text-slate-500">{i + 1}</td>
                        <td className="px-3 py-2 font-medium text-white whitespace-nowrap">{row.driver_name}</td>
                        <td className="px-3 py-2 text-slate-400 whitespace-nowrap">{row.phone_number || "-"}</td>
                        <td className="px-3 py-2 text-slate-300">{row.license_plate || "-"}</td>
                        <td className="px-3 py-2 text-right text-slate-300">{fmtIdr(row.rental_fee_daily)}</td>
                        <td className="px-3 py-2 text-right font-bold text-amber-400">{fmtIdr(row.outstanding)}</td>
                        <td className="px-3 py-2">
                          <Badge className={`text-[10px] ${row.status === "Active" ? "bg-emerald-900/40 text-emerald-300 border-emerald-700" : "bg-amber-900/40 text-amber-300 border-amber-700"} border`}>
                            {row.status}
                          </Badge>
                        </td>
                        <td className="px-3 py-2">
                          {row.match_status === "found" ? (
                            <span className="flex items-center gap-1 text-emerald-400">
                              <CheckCircle className="w-3 h-3" />
                              <span>Cocok</span>
                              {row.matched_name && <span className="text-slate-500 ml-1">({row.matched_name})</span>}
                            </span>
                          ) : (
                            <span className="flex items-center gap-1 text-amber-400">
                              <AlertTriangle className="w-3 h-3" />
                              <span>Tidak cocok</span>
                            </span>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                  <tfoot>
                    <tr className="border-t border-slate-600 bg-slate-800/80">
                      <td colSpan={5} className="px-3 py-2 text-slate-400 text-xs font-medium">Total ({previewData.total} driver)</td>
                      <td className="px-3 py-2 text-right text-red-400 font-bold text-xs">{fmtIdr(totalOutstanding)}</td>
                      <td colSpan={2} />
                    </tr>
                  </tfoot>
                </table>
              </div>
            </CardContent>
          </Card>

          {previewData.unmatched > 0 && (
            <div className="p-3 bg-amber-900/20 border border-amber-700/40 rounded-lg">
              <p className="text-amber-300 text-sm flex items-center gap-2">
                <AlertTriangle className="w-4 h-4" />
                <strong>{previewData.unmatched} driver tidak cocok</strong> — akan ditambahkan sebagai entri baru di fleet_outstanding tanpa link ke fleet_drivers.
              </p>
            </div>
          )}

          {/* Actions */}
          <div className="flex gap-3">
            <Button variant="outline" className="border-slate-600 text-slate-300 hover:text-white h-12 px-5" onClick={reset}>
              ← Kembali
            </Button>
            <Button
              className="flex-1 bg-emerald-600 hover:bg-emerald-700 h-12 text-base font-semibold disabled:opacity-50"
              disabled={importMutation.isPending || previewData.total === 0}
              onClick={() => importMutation.mutate()}
            >
              {importMutation.isPending
                ? <><RefreshCw className="w-5 h-5 mr-2 animate-spin" /> Mengimport...</>
                : <><Database className="w-5 h-5 mr-2" /> Konfirmasi Import {previewData.total} Driver</>}
            </Button>
          </div>
        </div>
      )}

      {/* STEP 3: Done */}
      {step === "done" && importResult && (
        <Card className="bg-emerald-900/20 border-emerald-700/50">
          <CardContent className="p-6 space-y-4">
            <div className="flex items-center gap-3">
              <CheckCircle className="w-8 h-8 text-emerald-400" />
              <div>
                <p className="text-white font-bold text-lg">Import Berhasil!</p>
                <p className="text-emerald-300 text-sm">{importResult.message}</p>
              </div>
            </div>
            <div className="grid grid-cols-3 gap-3">
              {[
                { label: "Driver Diperbarui", val: importResult.updated, cls: "text-emerald-400" },
                { label: "Driver Baru (Unmatched)", val: importResult.inserted, cls: "text-amber-400" },
                { label: "Dilewati", val: importResult.skipped, cls: "text-slate-400" },
              ].map((s) => (
                <div key={s.label} className="bg-slate-900/60 rounded-lg p-3 text-center">
                  <p className={`text-2xl font-bold ${s.cls}`}>{s.val}</p>
                  <p className="text-xs text-slate-400 mt-0.5">{s.label}</p>
                </div>
              ))}
            </div>
            <div className="flex gap-3">
              <Button variant="outline" className="border-slate-600 text-slate-300" onClick={reset}>Upload Lagi</Button>
              <Link href="/logistics/fleet-intelligence/driver-macet">
                <Button className="bg-red-700 hover:bg-red-600">Lihat Driver Macet →</Button>
              </Link>
            </div>
          </CardContent>
        </Card>
      )}

      {/* ─── IMPORT HISTORY ─────────────────────────────────────────────── */}
      <Card className="bg-slate-800/60 border-slate-700">
        <CardHeader className="flex flex-row items-center justify-between pb-2">
          <CardTitle className="text-white text-base flex items-center gap-2">
            <FileText className="w-4 h-4 text-slate-400" />
            Import History — Ringkasan Outstanding
          </CardTitle>
          <div className="flex items-center gap-2">
            <div className="flex rounded-lg overflow-hidden border border-slate-600">
              {([7, 30] as const).map((d) => (
                <button
                  key={d}
                  onClick={() => setLogDays(d)}
                  className={`px-3 py-1 text-xs font-medium transition-colors ${logDays === d ? "bg-emerald-700 text-white" : "bg-slate-800 text-slate-400 hover:text-white"}`}
                >
                  {d}h
                </button>
              ))}
            </div>
            <Button variant="ghost" size="sm" onClick={() => refetchLogs()} className="text-slate-400 hover:text-white h-7 w-7 p-0">
              <RefreshCw className="w-4 h-4" />
            </Button>
          </div>
        </CardHeader>
        <CardContent className="p-0">
          {(importLogs?.logs ?? []).length === 0 ? (
            <div className="text-center py-10 text-slate-500">
              <FileSpreadsheet className="w-10 h-10 mx-auto mb-2 opacity-30" />
              <p className="text-sm">Belum ada import dalam {logDays} hari terakhir</p>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-xs">
                <thead className="border-b border-slate-700 bg-slate-900/40">
                  <tr>
                    <th className="px-3 py-2.5 text-left text-slate-400 font-medium whitespace-nowrap">Tanggal</th>
                    <th className="px-3 py-2.5 text-left text-slate-400 font-medium">File</th>
                    <th className="px-3 py-2.5 text-left text-slate-400 font-medium whitespace-nowrap">User</th>
                    <th className="px-3 py-2.5 text-right text-slate-400 font-medium whitespace-nowrap">Total Rows</th>
                    <th className="px-3 py-2.5 text-right text-slate-400 font-medium whitespace-nowrap">Imported</th>
                    <th className="px-3 py-2.5 text-right text-slate-400 font-medium whitespace-nowrap">Skipped</th>
                    <th className="px-3 py-2.5 text-right text-slate-400 font-medium whitespace-nowrap">Unmatched</th>
                  </tr>
                </thead>
                <tbody>
                  {(importLogs?.logs ?? []).map((log) => (
                    <tr key={log.id} className="border-b border-slate-700/40 hover:bg-slate-700/20 transition-colors">
                      <td className="px-3 py-2.5 whitespace-nowrap text-slate-300">
                        {fmtDate(log.uploaded_at)}
                      </td>
                      <td className="px-3 py-2.5 max-w-[200px]">
                        <p className="text-white truncate font-medium" title={log.report_file_name}>
                          {log.report_file_name}
                        </p>
                      </td>
                      <td className="px-3 py-2.5 text-slate-400 whitespace-nowrap">
                        {log.uploaded_by ?? "-"}
                      </td>
                      <td className="px-3 py-2.5 text-right font-mono text-white">{fmtNum(log.total_rows)}</td>
                      <td className="px-3 py-2.5 text-right font-mono text-emerald-400">{fmtNum(log.rows_imported)}</td>
                      <td className="px-3 py-2.5 text-right font-mono text-slate-400">{fmtNum(log.rows_skipped)}</td>
                      <td className="px-3 py-2.5 text-right font-mono text-amber-400">{fmtNum(log.unmatched_drivers)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

// ─── Main Page ────────────────────────────────────────────────────────────────

export default function FleetUploadPage() {
  return (
    <AppShell>
      <div className="space-y-6 max-w-4xl">
        <Link href="/logistics/fleet-intelligence">
          <Button variant="ghost" size="sm" className="text-slate-400 hover:text-white gap-1.5 -ml-2">
            <ArrowLeft className="w-4 h-4" /> Fleet Intelligence
          </Button>
        </Link>

        <div>
          <div className="flex items-center gap-3 flex-wrap">
            <h1 className="text-2xl font-bold text-white">Upload Ringkasan Outstanding</h1>
            <Badge className="bg-emerald-500/15 text-emerald-300 border border-emerald-600/50 text-xs px-2 py-0.5 gap-1.5">
              <Server className="w-3 h-3" />Tersimpan ke Supabase
            </Badge>
          </div>
          <p className="text-slate-400 text-sm mt-1">
            Upload CSV ringkasan outstanding per driver dari dashboard Gojek
          </p>
        </div>

        <SnapshotUploadTab />
      </div>
    </AppShell>
  );
}
