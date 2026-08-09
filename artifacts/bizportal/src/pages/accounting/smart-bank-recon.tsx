import { useState, useCallback, useRef } from "react";
import { useLocation } from "wouter";
import { AppShell } from "@/components/layout/AppShell";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useToast } from "@/hooks/use-toast";
import { BackButton } from "@/components/ui/back-button";
import {
  Upload, FileText, CheckCircle2, AlertTriangle, Loader2,
  TrendingUp, ChevronRight, Info, RefreshCw, X, FileSpreadsheet,
  Shield, Zap, ArrowUpDown, ArrowLeft, Brain, Clock,
} from "lucide-react";
import { useRecommendations } from "@/hooks/useAiLearning";
import { useQuery } from "@tanstack/react-query";
import { useCompany } from "@/contexts/CompanyContext";

// ── Types ─────────────────────────────────────────────────────────────────────

type BankFormat = "auto" | "csv" | "excel" | "mt940" | "camt053";

interface MatchedRow {
  id: number;
  date: string;
  description: string;
  amount: number;
  direction: "IN" | "OUT";
  reference?: string;
  vendorName?: string;
  confidence: number;
  score: number;
  reason: string[];
  match_status: "auto_matched" | "manual_review" | "unmatched";
  candidate_type?: string;
  candidate_id?: number;
  vendor_match: boolean;
  amount_match: boolean;
  date_match: boolean;
  ref_match: boolean;
}

interface ImportResult {
  ok: boolean;
  format: string;
  imported: number;
  duplicates: number;
  total_parsed: number;
  reconciled_count: number;
  exception_count: number;
  reconciled: MatchedRow[];
  exceptions: MatchedRow[];
}

// ── Confidence badge ──────────────────────────────────────────────────────────

function ConfidenceBadge({ score }: { score: number }) {
  if (score >= 95) return (
    <Badge className="bg-green-600 text-white font-bold text-xs gap-1">
      <Shield className="h-3 w-3" /> {score}% Tinggi
    </Badge>
  );
  if (score >= 90) return (
    <Badge className="bg-emerald-500 text-white font-bold text-xs gap-1">
      <CheckCircle2 className="h-3 w-3" /> {score}%
    </Badge>
  );
  if (score >= 80) return (
    <Badge className="bg-yellow-500 text-white font-bold text-xs gap-1">
      <TrendingUp className="h-3 w-3" /> {score}%
    </Badge>
  );
  if (score >= 65) return (
    <Badge className="bg-orange-500 text-white font-bold text-xs gap-1">
      <Info className="h-3 w-3" /> {score}%
    </Badge>
  );
  return (
    <Badge className="bg-red-500 text-white font-bold text-xs gap-1">
      <AlertTriangle className="h-3 w-3" /> {score}%
    </Badge>
  );
}

function FormatBadge({ fmt }: { fmt: string }) {
  const map: Record<string, { label: string; color: string }> = {
    mt940:   { label: "MT940", color: "bg-blue-600 text-white" },
    camt053: { label: "CAMT.053", color: "bg-purple-600 text-white" },
    csv:     { label: "CSV", color: "bg-gray-600 text-white" },
    excel:   { label: "Excel", color: "bg-green-700 text-white" },
  };
  const info = map[fmt.toLowerCase()] ?? { label: fmt.toUpperCase(), color: "bg-slate-600 text-white" };
  return <Badge className={`${info.color} text-xs`}>{info.label}</Badge>;
}

function MatchFactors({ row }: { row: MatchedRow }) {
  return (
    <div className="flex flex-wrap gap-1 mt-1">
      {row.amount_match && <span className="text-[10px] bg-green-100 text-green-800 rounded px-1">Nominal ✓</span>}
      {row.date_match   && <span className="text-[10px] bg-blue-100 text-blue-800 rounded px-1">Tanggal ✓</span>}
      {row.ref_match    && <span className="text-[10px] bg-purple-100 text-purple-800 rounded px-1">Referensi ✓</span>}
      {row.vendor_match && <span className="text-[10px] bg-amber-100 text-amber-800 rounded px-1">Vendor ✓</span>}
    </div>
  );
}

function AmountDisplay({ amount, direction }: { amount: number; direction: "IN" | "OUT" }) {
  const fmt = new Intl.NumberFormat("id-ID", { style: "currency", currency: "IDR", minimumFractionDigits: 0 });
  return (
    <span className={direction === "IN" ? "text-green-700 font-semibold" : "text-red-600 font-semibold"}>
      {direction === "IN" ? "+" : "-"}{fmt.format(amount)}
    </span>
  );
}

// ── ResultTable component ─────────────────────────────────────────────────────

function ResultTable({ rows, type }: { rows: MatchedRow[]; type: "reconciled" | "exception" }) {
  if (!rows.length) {
    return (
      <div className="text-center py-12 text-muted-foreground">
        {type === "reconciled"
          ? "Tidak ada transaksi yang otomatis terrekonsiliasi"
          : "Tidak ada transaksi di Exception Queue"}
      </div>
    );
  }

  return (
    <div className="rounded-md border overflow-auto">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Tanggal</TableHead>
            <TableHead>Keterangan</TableHead>
            <TableHead className="text-right">Nominal</TableHead>
            <TableHead>Referensi</TableHead>
            <TableHead>Vendor / Counterparty</TableHead>
            <TableHead className="text-center">Confidence Score</TableHead>
            <TableHead>Match Factors</TableHead>
            {type === "exception" && <TableHead>Status</TableHead>}
          </TableRow>
        </TableHeader>
        <TableBody>
          {rows.map((row) => (
            <TableRow key={row.id} className={type === "exception" ? "bg-red-50/30" : "bg-green-50/20"}>
              <TableCell className="font-mono text-xs whitespace-nowrap">{row.date}</TableCell>
              <TableCell className="max-w-[200px] truncate text-sm" title={row.description}>
                {row.description}
              </TableCell>
              <TableCell className="text-right">
                <AmountDisplay amount={row.amount} direction={row.direction} />
              </TableCell>
              <TableCell className="font-mono text-xs text-muted-foreground">
                {row.reference ?? "—"}
              </TableCell>
              <TableCell className="text-sm">
                {row.vendorName ?? row.candidate_type ?? "—"}
              </TableCell>
              <TableCell className="text-center">
                <ConfidenceBadge score={row.confidence} />
              </TableCell>
              <TableCell>
                <MatchFactors row={row} />
                {row.reason.length > 0 && (
                  <div className="text-[10px] text-muted-foreground mt-1 leading-tight">
                    {row.reason.join(" • ")}
                  </div>
                )}
              </TableCell>
              {type === "exception" && (
                <TableCell>
                  <Badge variant={row.match_status === "manual_review" ? "outline" : "secondary"} className="text-xs">
                    {row.match_status === "manual_review" ? "Review Manual" : "Tidak Cocok"}
                  </Badge>
                </TableCell>
              )}
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  );
}

// ── Main Page ─────────────────────────────────────────────────────────────────

// ── Sport Center Pending Payments Banner ──────────────────────────────────────

function SportCenterPendingBanner() {
  const [, navigate] = useLocation();
  const { activeCompanyId } = useCompany();

  const { data, isLoading } = useQuery<{ total: number }>({
    queryKey: ["sport-pending-count-banner", activeCompanyId],
    queryFn: async () => {
      const qs = new URLSearchParams();
      if (activeCompanyId) qs.set("companyId", String(activeCompanyId));
      qs.set("status", "pending");
      qs.set("page", "1");
      const r = await fetch(`/api/sport-center/payments?${qs}`, { credentials: "include" });
      const d = await r.json();
      return { total: d.total ?? 0 };
    },
    staleTime: 60_000,
  });

  if (isLoading || (data?.total ?? 0) === 0) return null;

  return (
    <div className="border border-yellow-500/40 bg-yellow-500/5 rounded-lg p-4 flex items-center gap-4">
      <Clock className="h-5 w-5 text-yellow-400 shrink-0" />
      <div className="flex-1 min-w-0">
        <p className="text-sm font-semibold text-yellow-200">
          {data!.total} pembayaran sport center menunggu konfirmasi operator
        </p>
        <p className="text-xs text-muted-foreground mt-0.5">
          Pembayaran ini harus dikonfirmasi di aplikasi Sport Center agar rekonsiliasi bank dapat diselesaikan.
        </p>
      </div>
      <Button
        size="sm"
        variant="outline"
        className="shrink-0 gap-1.5 border-yellow-600 text-yellow-300 hover:bg-yellow-900/20 text-xs"
        onClick={() => navigate("/sport-center/pending-confirmation")}
      >
        <Clock className="h-3.5 w-3.5" />
        Cek Pembayaran Pending
      </Button>
    </div>
  );
}

// ── AI Recommendation Banner (Phase 5) ───────────────────────────────────────

function AiRecommendationBanner() {
  const { data, isLoading } = useRecommendations();
  const pending = data?.recommendations.filter(
    (r) => r.status === "PENDING_REVIEW" || r.status === "DRAFT",
  ) ?? [];

  if (isLoading || pending.length === 0) return null;

  const first = pending[0]!;

  return (
    <div className="border border-violet-200 bg-violet-50 rounded-lg p-4 flex items-start justify-between gap-4">
      <div className="flex items-start gap-3">
        <Brain className="h-5 w-5 text-violet-600 mt-0.5 shrink-0" />
        <div>
          <p className="text-sm font-semibold text-violet-800">AI Recommendation</p>
          <p className="text-sm text-violet-700 mt-0.5">
            Saya menemukan{" "}
            <strong>{first.occurrence > 0 ? `${first.occurrence} transaksi` : `${pending.length} rekomendasi`}</strong>{" "}
            selalu dipilih
            {first.recommendedCoa && (
              <>
                {" "}↓{" "}
                <span className="font-mono font-semibold">{first.recommendedCoa}</span>
              </>
            )}
          </p>
          {first.confidence > 0 && (
            <p className="text-xs text-violet-600 mt-0.5">
              Confidence: {Math.round(first.confidence * 100)}%
            </p>
          )}
        </div>
      </div>
      <a href="/ai/review/recommendations">
        <button className="shrink-0 text-xs font-medium text-violet-700 border border-violet-300 rounded px-3 py-1.5 hover:bg-violet-100 transition-colors whitespace-nowrap">
          Lihat Recommendation
        </button>
      </a>
    </div>
  );
}

export default function SmartBankReconPage() {
  const { toast } = useToast();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [dragging, setDragging] = useState(false);
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [format, setFormat] = useState<BankFormat>("auto");
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<ImportResult | null>(null);
  const [activeTab, setActiveTab] = useState("reconciled");

  const handleFile = useCallback((file: File) => {
    setSelectedFile(file);
    setResult(null);
    // Auto-suggest format based on extension
    const ext = file.name.toLowerCase().split(".").pop() ?? "";
    if (ext === "sta" || ext === "mt940" || ext === "mts") setFormat("mt940");
    else if (ext === "xml") setFormat("camt053");
    else if (ext === "xlsx" || ext === "xls") setFormat("excel");
    else if (ext === "csv") setFormat("csv");
    else setFormat("auto");
  }, []);

  const onDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setDragging(false);
    const file = e.dataTransfer.files[0];
    if (file) handleFile(file);
  }, [handleFile]);

  const onFileSelect = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) handleFile(file);
  }, [handleFile]);

  const handleImport = async () => {
    if (!selectedFile) return;
    setLoading(true);
    setResult(null);
    try {
      const form = new FormData();
      form.append("file", selectedFile);
      if (format !== "auto") form.append("format", format);

      const resp = await fetch("/api/bank-reconciliation/smart-import", {
        method: "POST",
        credentials: "include",
        body: form,
      });
      const data = await resp.json();
      if (!resp.ok) {
        toast({ variant: "destructive", title: "Gagal import", description: data.error ?? "Error tidak diketahui" });
        return;
      }
      setResult(data);
      setActiveTab(data.reconciled_count > 0 ? "reconciled" : "exceptions");
      toast({
        title: "Import berhasil",
        description: `${data.reconciled_count} reconciled, ${data.exception_count} exception queue`,
      });
    } catch (e: any) {
      toast({ variant: "destructive", title: "Error", description: e.message });
    } finally {
      setLoading(false);
    }
  };

  const handleReset = () => {
    setSelectedFile(null);
    setResult(null);
    setFormat("auto");
    if (fileInputRef.current) fileInputRef.current.value = "";
  };

  const matchRate = result
    ? result.total_parsed > 0 ? Math.round((result.reconciled_count / result.total_parsed) * 100) : 0
    : 0;

  return (
    <AppShell>
      <BackButton href="/accounting" />
      <div className="p-6 max-w-7xl mx-auto space-y-6">
        {/* Header */}
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <button onClick={() => window.history.back()} aria-label="Kembali" className="shrink-0 rounded-md p-1.5 text-muted-foreground hover:text-foreground hover:bg-accent transition-colors">
              <ArrowLeft className="h-4 w-4" />
            </button>
            <div>
              <h1 className="text-2xl font-black text-foreground flex items-center gap-2">
                <Zap className="h-6 w-6 text-orange-500" />
                Smart Bank Reconciliation
              </h1>
              <p className="text-sm text-muted-foreground mt-1">
                Import CSV, Excel, MT940, atau CAMT.053 — auto-match dengan confidence score
              </p>
            </div>
          </div>
          {result && (
            <Button variant="outline" size="sm" onClick={handleReset} className="gap-2">
              <RefreshCw className="h-4 w-4" /> Import Baru
            </Button>
          )}
        </div>

        {/* Legend */}
        <Card className="border-blue-100 bg-blue-50/40">
          <CardContent className="p-4">
            <div className="flex flex-wrap items-center gap-4 text-xs">
              <span className="font-semibold text-blue-800">Confidence Score:</span>
              <span className="flex items-center gap-1"><Badge className="bg-green-600 text-white text-[10px]">≥95% Tinggi</Badge> Auto-reconciled (sangat yakin)</span>
              <span className="flex items-center gap-1"><Badge className="bg-emerald-500 text-white text-[10px]">90–94%</Badge> Auto-reconciled</span>
              <span className="flex items-center gap-1"><Badge className="bg-yellow-500 text-white text-[10px]">80–89%</Badge> Auto-reconciled (perlu dicek)</span>
              <span className="flex items-center gap-1"><Badge className="bg-orange-500 text-white text-[10px]">65–79%</Badge> Exception Queue — review manual</span>
              <span className="flex items-center gap-1"><Badge className="bg-red-500 text-white text-[10px]">&lt;65%</Badge> Exception Queue — tidak cocok</span>
            </div>
          </CardContent>
        </Card>

        {/* Sport Center Pending Payments Banner */}
        <SportCenterPendingBanner />

        {!result && (
          <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
            {/* Upload zone */}
            <div className="md:col-span-2">
              <Card>
                <CardHeader>
                  <CardTitle className="text-base flex items-center gap-2">
                    <Upload className="h-4 w-4" /> Upload File Mutasi Bank
                  </CardTitle>
                </CardHeader>
                <CardContent className="space-y-4">
                  {/* Drop zone */}
                  <div
                    className={`border-2 border-dashed rounded-xl p-10 text-center cursor-pointer transition-colors ${
                      dragging
                        ? "border-orange-400 bg-orange-50"
                        : selectedFile
                        ? "border-green-400 bg-green-50"
                        : "border-gray-200 hover:border-gray-300 hover:bg-gray-50"
                    }`}
                    onDragOver={e => { e.preventDefault(); setDragging(true); }}
                    onDragLeave={() => setDragging(false)}
                    onDrop={onDrop}
                    onClick={() => fileInputRef.current?.click()}
                  >
                    <input
                      ref={fileInputRef}
                      type="file"
                      className="hidden"
                      accept=".csv,.xlsx,.xls,.sta,.mt940,.mts,.xml"
                      onChange={onFileSelect}
                    />
                    {selectedFile ? (
                      <div className="space-y-2">
                        <FileSpreadsheet className="h-10 w-10 text-green-600 mx-auto" />
                        <p className="font-semibold text-green-700">{selectedFile.name}</p>
                        <p className="text-xs text-muted-foreground">
                          {(selectedFile.size / 1024).toFixed(1)} KB
                        </p>
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={e => { e.stopPropagation(); handleReset(); }}
                          className="text-red-500 hover:text-red-600 gap-1"
                        >
                          <X className="h-3 w-3" /> Hapus file
                        </Button>
                      </div>
                    ) : (
                      <div className="space-y-2">
                        <Upload className="h-10 w-10 text-muted-foreground mx-auto" />
                        <p className="text-sm font-medium text-muted-foreground">
                          Drag & drop file, atau klik untuk browse
                        </p>
                        <p className="text-xs text-muted-foreground">
                          Mendukung: CSV, Excel (.xlsx), MT940 (.sta), CAMT.053 (.xml)
                        </p>
                      </div>
                    )}
                  </div>

                  {/* Format selector */}
                  <div className="flex items-center gap-3">
                    <label className="text-sm font-medium min-w-fit">Format file:</label>
                    <Select value={format} onValueChange={v => setFormat(v as BankFormat)}>
                      <SelectTrigger className="max-w-[200px]">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="auto">Auto-deteksi</SelectItem>
                        <SelectItem value="csv">CSV</SelectItem>
                        <SelectItem value="excel">Excel (.xlsx)</SelectItem>
                        <SelectItem value="mt940">MT940 (SWIFT)</SelectItem>
                        <SelectItem value="camt053">CAMT.053 (SEPA XML)</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>

                  <Button
                    className="w-full bg-orange-500 hover:bg-orange-600 text-white font-semibold gap-2"
                    disabled={!selectedFile || loading}
                    onClick={handleImport}
                  >
                    {loading ? (
                      <><Loader2 className="h-4 w-4 animate-spin" /> Memproses & Matching...</>
                    ) : (
                      <><Zap className="h-4 w-4" /> Import & Jalankan Smart Matching</>
                    )}
                  </Button>
                </CardContent>
              </Card>
            </div>

            {/* Format guide */}
            <Card>
              <CardHeader>
                <CardTitle className="text-base flex items-center gap-2">
                  <Info className="h-4 w-4" /> Panduan Format
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-4 text-xs">
                <div className="space-y-1">
                  <div className="flex items-center gap-2 font-semibold">
                    <Badge className="bg-gray-600 text-white text-[10px]">CSV</Badge>
                    Standard export bank
                  </div>
                  <p className="text-muted-foreground pl-2">Kolom: tanggal, keterangan, debit, kredit. Separator koma atau titik koma.</p>
                </div>
                <div className="space-y-1">
                  <div className="flex items-center gap-2 font-semibold">
                    <Badge className="bg-green-700 text-white text-[10px]">Excel</Badge>
                    .xlsx / .xls
                  </div>
                  <p className="text-muted-foreground pl-2">Header di baris pertama, data di baris berikutnya. Sama dengan CSV tapi file Excel.</p>
                </div>
                <div className="space-y-1">
                  <div className="flex items-center gap-2 font-semibold">
                    <Badge className="bg-blue-600 text-white text-[10px]">MT940</Badge>
                    SWIFT Standard
                  </div>
                  <p className="text-muted-foreground pl-2">Format text SWIFT (:61: transaksi, :86: keterangan). Download dari internet banking.</p>
                </div>
                <div className="space-y-1">
                  <div className="flex items-center gap-2 font-semibold">
                    <Badge className="bg-purple-600 text-white text-[10px]">CAMT.053</Badge>
                    ISO 20022 XML
                  </div>
                  <p className="text-muted-foreground pl-2">Format XML standar Eropa/SEPA. Berisi tag &lt;Ntry&gt; untuk setiap transaksi.</p>
                </div>

                <div className="border-t pt-3 space-y-1">
                  <p className="font-semibold text-foreground">Auto-matching berdasarkan:</p>
                  <ul className="text-muted-foreground space-y-0.5 pl-2">
                    <li className="flex items-center gap-1"><ChevronRight className="h-3 w-3" /> Nominal (+50 poin)</li>
                    <li className="flex items-center gap-1"><ChevronRight className="h-3 w-3" /> Tanggal ±1 hari (+20 poin)</li>
                    <li className="flex items-center gap-1"><ChevronRight className="h-3 w-3" /> Nomor referensi (+20 poin)</li>
                    <li className="flex items-center gap-1"><ChevronRight className="h-3 w-3" /> Nama vendor (+10 poin)</li>
                  </ul>
                </div>
              </CardContent>
            </Card>
          </div>
        )}

        {/* AI Recommendation Banner (Phase 5) */}
        <AiRecommendationBanner />

        {/* Results */}
        {result && (
          <div className="space-y-4">
            {/* Summary cards */}
            <div className="grid grid-cols-2 md:grid-cols-5 gap-4">
              <Card>
                <CardContent className="p-4">
                  <p className="text-xs text-muted-foreground">Format Dideteksi</p>
                  <div className="mt-1"><FormatBadge fmt={result.format} /></div>
                </CardContent>
              </Card>
              <Card>
                <CardContent className="p-4">
                  <p className="text-xs text-muted-foreground">Total Parsed</p>
                  <p className="text-2xl font-black">{result.total_parsed}</p>
                </CardContent>
              </Card>
              <Card>
                <CardContent className="p-4">
                  <p className="text-xs text-muted-foreground">Imported Baru</p>
                  <p className="text-2xl font-black text-blue-600">{result.imported}</p>
                  {result.duplicates > 0 && (
                    <p className="text-[10px] text-muted-foreground">{result.duplicates} duplikat dilewati</p>
                  )}
                </CardContent>
              </Card>
              <Card className="border-green-200">
                <CardContent className="p-4">
                  <p className="text-xs text-muted-foreground">Auto-Reconciled</p>
                  <p className="text-2xl font-black text-green-600">{result.reconciled_count}</p>
                </CardContent>
              </Card>
              <Card className="border-red-200">
                <CardContent className="p-4">
                  <p className="text-xs text-muted-foreground">Exception Queue</p>
                  <p className="text-2xl font-black text-red-600">{result.exception_count}</p>
                </CardContent>
              </Card>
            </div>

            {/* Match rate bar */}
            <Card>
              <CardContent className="p-4">
                <div className="flex items-center justify-between mb-2">
                  <span className="text-sm font-semibold flex items-center gap-2">
                    <TrendingUp className="h-4 w-4 text-orange-500" /> Match Rate
                  </span>
                  <span className="text-sm font-bold">{matchRate}%</span>
                </div>
                <div className="w-full bg-gray-100 rounded-full h-3 overflow-hidden">
                  <div
                    className={`h-3 rounded-full transition-all ${
                      matchRate >= 80 ? "bg-green-500" : matchRate >= 50 ? "bg-yellow-500" : "bg-red-500"
                    }`}
                    style={{ width: `${matchRate}%` }}
                  />
                </div>
                <div className="flex justify-between text-[10px] text-muted-foreground mt-1">
                  <span>0%</span>
                  <span>50%</span>
                  <span>100%</span>
                </div>
              </CardContent>
            </Card>

            {/* Tabs */}
            <Tabs value={activeTab} onValueChange={setActiveTab}>
              <TabsList className="grid w-full grid-cols-3">
                <TabsTrigger value="reconciled" className="gap-2">
                  <CheckCircle2 className="h-4 w-4 text-green-600" />
                  Reconciled
                  <Badge className="bg-green-600 text-white text-[10px] ml-1">{result.reconciled_count}</Badge>
                </TabsTrigger>
                <TabsTrigger value="exceptions" className="gap-2">
                  <AlertTriangle className="h-4 w-4 text-red-500" />
                  Exception Queue
                  <Badge className="bg-red-500 text-white text-[10px] ml-1">{result.exception_count}</Badge>
                </TabsTrigger>
                <TabsTrigger value="all" className="gap-2">
                  <ArrowUpDown className="h-4 w-4" />
                  Semua ({result.total_parsed})
                </TabsTrigger>
              </TabsList>

              <TabsContent value="reconciled" className="mt-4">
                <div className="flex items-center gap-2 text-sm text-green-700 bg-green-50 border border-green-200 rounded-md p-3 mb-4">
                  <CheckCircle2 className="h-4 w-4 flex-shrink-0" />
                  Transaksi di bawah telah <strong>otomatis direkonsiliasi</strong> dan disimpan dengan status <strong>Reconciled</strong> di bank mutations.
                </div>
                <ResultTable rows={result.reconciled} type="reconciled" />
              </TabsContent>

              <TabsContent value="exceptions" className="mt-4">
                <div className="flex items-center gap-2 text-sm text-red-700 bg-red-50 border border-red-200 rounded-md p-3 mb-4">
                  <AlertTriangle className="h-4 w-4 flex-shrink-0" />
                  Transaksi ini <strong>tidak memiliki cukup confidence</strong> untuk auto-reconciled. Silakan lakukan <strong>review manual</strong> di halaman Bank Mutations.
                </div>
                <ResultTable rows={result.exceptions} type="exception" />
              </TabsContent>

              <TabsContent value="all" className="mt-4">
                <ResultTable rows={[...result.reconciled, ...result.exceptions]} type="reconciled" />
              </TabsContent>
            </Tabs>
          </div>
        )}
      </div>
    </AppShell>
  );
}
