import { useState, useCallback } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  FileText, RefreshCw, ShieldCheck, Download, Send, Loader2,
  CheckCircle2, XCircle, AlertTriangle, Info, ChevronRight,
  Receipt, BarChart3, FileSpreadsheet, Stamp, ArrowLeft,
} from "lucide-react";
import { useCompany } from "@/contexts/CompanyContext";
import { toast } from "sonner";

// ── Helpers ──────────────────────────────────────────────────────────────────

const IDR = (n: number) =>
  new Intl.NumberFormat("id-ID", { style: "currency", currency: "IDR", maximumFractionDigits: 0 }).format(n);

function currentPeriod() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
}

function buildMonthList() {
  const months: string[] = [];
  const d = new Date();
  for (let i = 0; i < 24; i++) {
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, "0");
    months.push(`${y}-${m}`);
    d.setMonth(d.getMonth() - 1);
  }
  return months;
}

function fmtPeriod(p: string) {
  const [y, m] = p.split("-");
  const monthNames = ["Jan","Feb","Mar","Apr","Mei","Jun","Jul","Agu","Sep","Okt","Nov","Des"];
  return `${monthNames[parseInt(m) - 1]} ${y}`;
}

const STATUS_META: Record<string, { label: string; color: string; icon: React.ReactNode }> = {
  draft:     { label: "Draft",     color: "bg-slate-100 text-slate-700",   icon: <FileText className="h-3 w-3" /> },
  validated: { label: "Validated", color: "bg-blue-100 text-blue-700",     icon: <ShieldCheck className="h-3 w-3" /> },
  exported:  { label: "Exported",  color: "bg-amber-100 text-amber-700",   icon: <Download className="h-3 w-3" /> },
  submitted: { label: "Submitted", color: "bg-emerald-100 text-emerald-700", icon: <CheckCircle2 className="h-3 w-3" /> },
};

const SEVERITY_META = {
  HIGH:   { label: "High",    cls: "text-red-600 bg-red-50 border-red-200",    icon: <XCircle className="h-3.5 w-3.5" /> },
  MEDIUM: { label: "Medium",  cls: "text-amber-600 bg-amber-50 border-amber-200", icon: <AlertTriangle className="h-3.5 w-3.5" /> },
  LOW:    { label: "Low",     cls: "text-blue-600 bg-blue-50 border-blue-200",  icon: <Info className="h-3.5 w-3.5" /> },
};

type TaxFilter = "ALL" | "PPN" | "PPH23" | "PPH21" | "PPH15" | "PPH4";

function filterTx(transactions: any[], f: TaxFilter) {
  if (f === "ALL") return transactions;
  const n = (t: any) => t.tax_name.toLowerCase();
  if (f === "PPN")   return transactions.filter(t => n(t).includes("ppn") || n(t).includes("vat"));
  if (f === "PPH23") return transactions.filter(t => n(t).includes("23") && t.direction === "withholding");
  if (f === "PPH21") return transactions.filter(t => n(t).includes("21") && t.direction === "withholding");
  if (f === "PPH15") return transactions.filter(t => n(t).includes("15") && t.direction === "withholding");
  if (f === "PPH4")  return transactions.filter(t => (n(t).includes("4(2)") || n(t).includes("pph 4")) && t.direction === "withholding");
  return transactions;
}

// ── Download helper ───────────────────────────────────────────────────────────

function downloadBase64Csv(b64: string, filename: string) {
  const bytes = Uint8Array.from(atob(b64), c => c.charCodeAt(0));
  const blob  = new Blob([bytes], { type: "text/csv;charset=utf-8" });
  const url   = URL.createObjectURL(blob);
  const a     = document.createElement("a");
  a.href      = url;
  a.download  = filename;
  a.click();
  URL.revokeObjectURL(url);
}

// ── Component ─────────────────────────────────────────────────────────────────

export default function SptBuilderPage() {
  const { activeCompanyId: companyId } = useCompany();
  const qc = useQueryClient();

  const [period, setPeriod]       = useState(currentPeriod);
  const [taxFilter, setTaxFilter] = useState<TaxFilter>("ALL");
  const [validation, setValidation] = useState<any>(null);
  const months = buildMonthList();

  // ── Status query ────────────────────────────────────────────────────────────
  const { data: statusData, refetch: refetchStatus } = useQuery({
    queryKey: ["spt-status", companyId, period],
    queryFn: () => fetch(`/api/tax/spt/status?companyId=${companyId}&period=${period}`, { credentials: "include" }).then(r => r.json()),
    enabled: !!companyId && !!period,
  });

  const status: string = statusData?.status ?? "draft";
  const isSubmitted = status === "submitted";

  // ── Draft query ─────────────────────────────────────────────────────────────
  const { data: draft, isFetching: draftLoading, refetch: refetchDraft } = useQuery({
    queryKey: ["spt-v2-draft", companyId, period],
    queryFn: () => fetch(`/api/tax/spt/draft?companyId=${companyId}&period=${period}`, { credentials: "include" }).then(r => r.json()),
    enabled: false, // manual trigger
  });

  const generateDraftMut = useMutation({
    mutationFn: () => fetch(`/api/tax/spt/draft?companyId=${companyId}&period=${period}`, { credentials: "include" }).then(r => r.json()),
    onSuccess: (data) => {
      if (data.error) { toast.error(data.error); return; }
      qc.setQueryData(["spt-v2-draft", companyId, period], data);
      const total = data.transactions?.length ?? 0;
      toast.success(`Draft SPT ${fmtPeriod(period)} berhasil di-generate (${total} transaksi)`);
      setValidation(null);
    },
    onError: () => toast.error("Gagal generate draft SPT"),
  });

  // ── Validate mutation ───────────────────────────────────────────────────────
  const validateMut = useMutation({
    mutationFn: () => fetch("/api/tax/spt/validate", {
      method: "POST", credentials: "include",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ companyId, period }),
    }).then(r => r.json()),
    onSuccess: (data) => {
      setValidation(data);
      refetchStatus();
      if (data.is_valid) {
        toast.success("Validasi berhasil — tidak ada error HIGH severity");
      } else {
        toast.warning(`Ditemukan ${data.error_count} error dan ${data.warning_count} warning`);
      }
    },
    onError: () => toast.error("Gagal validasi SPT"),
  });

  // ── Export mutation ─────────────────────────────────────────────────────────
  const exportMut = useMutation({
    mutationFn: (taxTypes: string[]) => fetch("/api/tax/spt/export", {
      method: "POST", credentials: "include",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ companyId, period, taxTypes }),
    }).then(r => r.json()),
    onSuccess: (data) => {
      if (data.error) { toast.error(data.error); return; }
      const files: any[] = data.files ?? [];
      files.forEach(f => downloadBase64Csv(f.content_b64, f.filename));
      toast.success(`${files.length} file CSV berhasil di-download`);
      refetchStatus();
    },
    onError: () => toast.error("Gagal export CSV"),
  });

  // ── Submit mutation ─────────────────────────────────────────────────────────
  const submitMut = useMutation({
    mutationFn: () => fetch("/api/tax/spt/submit", {
      method: "PATCH", credentials: "include",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ companyId, period }),
    }).then(r => r.json()),
    onSuccess: (data) => {
      if (data.error) { toast.error(data.error); return; }
      toast.success(data.message ?? `SPT ${fmtPeriod(period)} berhasil disubmit`);
      refetchStatus();
    },
    onError: () => toast.error("Gagal submit SPT"),
  });

  const txns: any[] = draft?.transactions ?? [];
  const filtered = filterTx(txns, taxFilter);

  const ppnOut  = draft?.ppn?.output_tax_total ?? 0;
  const ppnIn   = draft?.ppn?.input_tax_total  ?? 0;
  const netVat  = draft?.ppn?.net_vat          ?? 0;
  const pph23   = draft?.pph23?.total_withholding ?? 0;
  const pph21   = draft?.pph21?.total_withholding ?? 0;

  const statusMeta = STATUS_META[status] ?? STATUS_META.draft;

  return (
    <div className="flex flex-col gap-4 p-4 max-w-7xl mx-auto">

      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-semibold text-slate-900 flex items-center gap-2">
            <FileSpreadsheet className="h-5 w-5 text-indigo-600" />SPT Builder
          </h1>
          <p className="text-sm text-muted-foreground mt-0.5">Generate, validasi, dan ekspor SPT Masa PPN & PPh ke format DJP</p>
        </div>
        <div className={`flex items-center gap-1.5 rounded-full px-3 py-1 text-xs font-semibold ${statusMeta.color}`}>
          {statusMeta.icon}{statusMeta.label}
          <ChevronRight className="h-3 w-3 opacity-40" />
          {["draft","validated","exported","submitted"].map((s, i) => (
            <span key={s} className={`${s === status ? "font-bold" : "opacity-40"}`}>
              {i > 0 && <ChevronRight className="inline h-2.5 w-2.5 mx-0.5" />}
              {STATUS_META[s].label}
            </span>
          ))}
        </div>
      </div>

      {/* Filter bar */}
      <Card>
        <CardContent className="px-4 py-3">
          <div className="flex flex-wrap gap-3 items-end">
            <div className="flex flex-col gap-1">
              <span className="text-xs text-muted-foreground font-medium">Periode</span>
              <Select value={period} onValueChange={v => { setPeriod(v); setValidation(null); }}>
                <SelectTrigger className="w-36 h-9">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {months.map(m => <SelectItem key={m} value={m}>{fmtPeriod(m)}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>

            <div className="flex flex-col gap-1">
              <span className="text-xs text-muted-foreground font-medium">Filter Jenis Pajak</span>
              <Select value={taxFilter} onValueChange={v => setTaxFilter(v as TaxFilter)}>
                <SelectTrigger className="w-36 h-9">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="ALL">Semua Pajak</SelectItem>
                  <SelectItem value="PPN">PPN</SelectItem>
                  <SelectItem value="PPH23">PPh 23</SelectItem>
                  <SelectItem value="PPH21">PPh 21</SelectItem>
                  <SelectItem value="PPH15">PPh 15</SelectItem>
                  <SelectItem value="PPH4">PPh 4(2)</SelectItem>
                </SelectContent>
              </Select>
            </div>

            <div className="flex gap-2 flex-wrap ml-auto">
              {/* Generate Draft */}
              <Button
                size="sm" variant="outline"
                disabled={generateDraftMut.isPending || isSubmitted}
                onClick={() => generateDraftMut.mutate()}
                className="border-indigo-300 text-indigo-700 hover:bg-indigo-50"
              >
                {generateDraftMut.isPending
                  ? <Loader2 className="h-4 w-4 animate-spin mr-1.5" />
                  : <RefreshCw className="h-4 w-4 mr-1.5" />}
                Generate Draft SPT
              </Button>

              {/* Validate */}
              <Button
                size="sm" variant="outline"
                disabled={validateMut.isPending || !draft || isSubmitted}
                onClick={() => validateMut.mutate()}
                className="border-blue-300 text-blue-700 hover:bg-blue-50"
              >
                {validateMut.isPending
                  ? <Loader2 className="h-4 w-4 animate-spin mr-1.5" />
                  : <ShieldCheck className="h-4 w-4 mr-1.5" />}
                Validate Data
              </Button>

              {/* Export PPN */}
              <Button
                size="sm" variant="outline"
                disabled={exportMut.isPending || isSubmitted}
                onClick={() => exportMut.mutate(["PPN"])}
                className="border-amber-300 text-amber-700 hover:bg-amber-50"
              >
                {exportMut.isPending
                  ? <Loader2 className="h-4 w-4 animate-spin mr-1.5" />
                  : <Download className="h-4 w-4 mr-1.5" />}
                Export PPN CSV
              </Button>

              {/* Export PPh */}
              <Button
                size="sm" variant="outline"
                disabled={exportMut.isPending || isSubmitted}
                onClick={() => exportMut.mutate(["PPH23", "PPH21"])}
                className="border-violet-300 text-violet-700 hover:bg-violet-50"
              >
                {exportMut.isPending
                  ? <Loader2 className="h-4 w-4 animate-spin mr-1.5" />
                  : <Download className="h-4 w-4 mr-1.5" />}
                Export PPh CSV
              </Button>

              {/* Submit */}
              <Button
                size="sm"
                disabled={submitMut.isPending || isSubmitted || !draft}
                onClick={() => {
                  if (!confirm(`Tandai SPT ${fmtPeriod(period)} sebagai SUBMITTED? Periode akan terkunci.`)) return;
                  submitMut.mutate();
                }}
                className="bg-emerald-600 hover:bg-emerald-700 text-white"
              >
                {submitMut.isPending
                  ? <Loader2 className="h-4 w-4 animate-spin mr-1.5" />
                  : <Send className="h-4 w-4 mr-1.5" />}
                {isSubmitted ? "Sudah Submitted" : "Mark as Submitted"}
              </Button>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Dashboard summary */}
      {draft && (
        <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
          {[
            { label: "PPN Masukan", value: ppnIn,  color: "text-blue-700",   bg: "bg-blue-50",   desc: "Input tax" },
            { label: "PPN Keluaran", value: ppnOut, color: "text-indigo-700", bg: "bg-indigo-50", desc: "Output tax" },
            {
              label: "Net VAT",
              value: netVat,
              color: netVat >= 0 ? "text-red-700" : "text-emerald-700",
              bg: netVat >= 0 ? "bg-red-50" : "bg-emerald-50",
              desc: netVat >= 0 ? "Kurang bayar" : "Lebih bayar",
            },
            { label: "PPh 23",  value: pph23, color: "text-violet-700", bg: "bg-violet-50", desc: `${draft.pph23?.tx_count ?? 0} transaksi` },
            { label: "PPh 21",  value: pph21, color: "text-pink-700",   bg: "bg-pink-50",   desc: `${draft.pph21?.tx_count ?? 0} transaksi` },
          ].map(c => (
            <Card key={c.label} className={`${c.bg} border-0`}>
              <CardContent className="px-4 py-3">
                <p className="text-xs text-muted-foreground font-medium">{c.label}</p>
                <p className={`text-base font-bold mt-0.5 ${c.color}`}>{IDR(c.value)}</p>
                <p className="text-[10px] text-muted-foreground mt-0.5">{c.desc}</p>
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      {/* Empty state */}
      {!draft && !generateDraftMut.isPending && (
        <Card className="border-dashed">
          <CardContent className="py-12 flex flex-col items-center gap-3 text-center">
            <BarChart3 className="h-10 w-10 text-slate-300" />
            <p className="font-medium text-slate-600">Belum ada draft SPT</p>
            <p className="text-sm text-muted-foreground">Pilih periode lalu klik <strong>Generate Draft SPT</strong></p>
            <Button
              size="sm"
              onClick={() => generateDraftMut.mutate()}
              disabled={generateDraftMut.isPending}
              className="mt-1 bg-indigo-600 hover:bg-indigo-700 text-white"
            >
              <RefreshCw className="h-4 w-4 mr-1.5" />Generate Draft SPT {fmtPeriod(period)}
            </Button>
          </CardContent>
        </Card>
      )}

      {generateDraftMut.isPending && (
        <Card>
          <CardContent className="py-10 flex flex-col items-center gap-3">
            <Loader2 className="h-8 w-8 animate-spin text-indigo-500" />
            <p className="text-sm text-muted-foreground">Membangun draft SPT {fmtPeriod(period)}…</p>
          </CardContent>
        </Card>
      )}

      {draft && (
        <Tabs defaultValue="transactions">
          <TabsList className="bg-slate-100">
            <TabsTrigger value="transactions" className="text-xs">
              <Receipt className="h-3.5 w-3.5 mr-1.5" />Transaksi ({filtered.length})
            </TabsTrigger>
            <TabsTrigger value="validation" className="text-xs">
              <ShieldCheck className="h-3.5 w-3.5 mr-1.5" />
              Validasi
              {validation && validation.error_count > 0 && (
                <Badge variant="destructive" className="ml-1.5 h-4 px-1 text-[10px]">{validation.error_count}</Badge>
              )}
              {validation && validation.is_valid && (
                <Badge className="ml-1.5 h-4 px-1 text-[10px] bg-emerald-500">✓</Badge>
              )}
            </TabsTrigger>
          </TabsList>

          {/* ── Tab: Transaksi ─────────────────────────────────────────────── */}
          <TabsContent value="transactions">
            <Card>
              <CardHeader className="pb-2 pt-4 px-4">
                <div className="flex items-center justify-between">
                  <CardTitle className="text-sm flex items-center gap-2">
                    <Receipt className="h-4 w-4 text-slate-500" />
                    Detail Transaksi Pajak — {fmtPeriod(period)}
                  </CardTitle>
                  <span className="text-xs text-muted-foreground">{filtered.length} dari {txns.length} transaksi</span>
                </div>
              </CardHeader>
              <CardContent className="p-0">
                {filtered.length === 0 ? (
                  <div className="py-10 text-center text-sm text-muted-foreground">
                    Tidak ada transaksi untuk filter yang dipilih
                  </div>
                ) : (
                  <div className="overflow-x-auto">
                    <Table>
                      <TableHeader>
                        <TableRow className="text-xs bg-slate-50">
                          <TableHead className="py-2 px-3">ID</TableHead>
                          <TableHead className="py-2 px-3">Jenis Pajak</TableHead>
                          <TableHead className="py-2 px-3">Tipe TX</TableHead>
                          <TableHead className="py-2 px-3">Arah</TableHead>
                          <TableHead className="py-2 px-3 text-right">DPP</TableHead>
                          <TableHead className="py-2 px-3 text-right">Pajak</TableHead>
                          <TableHead className="py-2 px-3">No Faktur/Bupot</TableHead>
                          <TableHead className="py-2 px-3">Status</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {filtered.slice(0, 200).map((t: any) => {
                          const isPpn = t.tax_name.toLowerCase().includes("ppn") || t.tax_name.toLowerCase().includes("vat");
                          const docNum = isPpn ? t.faktur_pajak_number : t.bukti_potong_number;
                          return (
                            <TableRow key={t.id} className="text-xs hover:bg-slate-50">
                              <TableCell className="py-1.5 px-3 font-mono text-slate-500">{t.id}</TableCell>
                              <TableCell className="py-1.5 px-3 font-medium">{t.tax_name}</TableCell>
                              <TableCell className="py-1.5 px-3 text-slate-500">{t.transaction_type}</TableCell>
                              <TableCell className="py-1.5 px-3">
                                <Badge variant="outline" className={`text-[10px] px-1.5 ${
                                  t.direction === "output" ? "border-indigo-300 text-indigo-700"
                                  : t.direction === "input" ? "border-blue-300 text-blue-700"
                                  : "border-violet-300 text-violet-700"
                                }`}>
                                  {t.direction || "—"}
                                </Badge>
                              </TableCell>
                              <TableCell className="py-1.5 px-3 text-right font-mono">{IDR(t.base_amount)}</TableCell>
                              <TableCell className="py-1.5 px-3 text-right font-mono text-slate-700">{IDR(t.tax_amount)}</TableCell>
                              <TableCell className="py-1.5 px-3 font-mono text-[10px]">
                                {docNum
                                  ? <span className="text-emerald-700">{docNum}</span>
                                  : <span className="text-orange-500 italic">—</span>
                                }
                              </TableCell>
                              <TableCell className="py-1.5 px-3">
                                <Badge variant="outline" className="text-[10px] px-1.5">{t.status}</Badge>
                              </TableCell>
                            </TableRow>
                          );
                        })}
                      </TableBody>
                    </Table>
                    {filtered.length > 200 && (
                      <p className="text-center text-xs text-muted-foreground py-2">
                        Menampilkan 200 dari {filtered.length} transaksi
                      </p>
                    )}
                  </div>
                )}
              </CardContent>
            </Card>
          </TabsContent>

          {/* ── Tab: Validasi ─────────────────────────────────────────────── */}
          <TabsContent value="validation">
            {!validation ? (
              <Card className="border-dashed">
                <CardContent className="py-12 flex flex-col items-center gap-3 text-center">
                  <ShieldCheck className="h-10 w-10 text-slate-300" />
                  <p className="font-medium text-slate-600">Belum divalidasi</p>
                  <p className="text-sm text-muted-foreground">Klik <strong>Validate Data</strong> untuk memeriksa kelengkapan SPT</p>
                  <Button
                    size="sm"
                    onClick={() => validateMut.mutate()}
                    disabled={validateMut.isPending}
                    className="mt-1 bg-blue-600 hover:bg-blue-700 text-white"
                  >
                    {validateMut.isPending
                      ? <Loader2 className="h-4 w-4 animate-spin mr-1.5" />
                      : <ShieldCheck className="h-4 w-4 mr-1.5" />}
                    Validate Data Sekarang
                  </Button>
                </CardContent>
              </Card>
            ) : (
              <div className="space-y-3">
                {/* Result header */}
                <Card className={validation.is_valid ? "border-emerald-200 bg-emerald-50/40" : "border-red-200 bg-red-50/30"}>
                  <CardContent className="px-4 py-3 flex items-center gap-3">
                    {validation.is_valid
                      ? <CheckCircle2 className="h-5 w-5 text-emerald-600" />
                      : <XCircle className="h-5 w-5 text-red-600" />}
                    <div>
                      <p className="font-semibold text-sm">
                        {validation.is_valid ? "Data valid — siap untuk ekspor" : `${validation.error_count} error ditemukan`}
                      </p>
                      <p className="text-xs text-muted-foreground">
                        {validation.warning_count} warning · {fmtPeriod(period)}
                      </p>
                    </div>
                    {validation.is_valid && (
                      <Badge className="ml-auto bg-emerald-600 text-white">VALIDATED</Badge>
                    )}
                  </CardContent>
                </Card>

                {/* Summary GL */}
                {validation.summary && (
                  <Card>
                    <CardHeader className="pb-1 pt-3 px-4">
                      <CardTitle className="text-xs text-muted-foreground uppercase tracking-wide">Ringkasan Rekonsiliasi GL</CardTitle>
                    </CardHeader>
                    <CardContent className="px-4 pb-3">
                      <div className="grid grid-cols-3 md:grid-cols-6 gap-3">
                        {[
                          { label: "PPN Keluar (TT)", value: validation.summary.ppn_output_tt },
                          { label: "PPN Keluar (GL)", value: validation.summary.ppn_output_gl },
                          { label: "PPN Masuk (TT)",  value: validation.summary.ppn_input_tt },
                          { label: "PPN Masuk (GL)",  value: validation.summary.ppn_input_gl },
                          { label: "PPh WHT (TT)",    value: validation.summary.pph_wht_tt },
                          { label: "PPh WHT (GL)",    value: validation.summary.pph_wht_gl },
                        ].map(s => (
                          <div key={s.label} className="text-center">
                            <p className="text-[10px] text-muted-foreground">{s.label}</p>
                            <p className="text-xs font-semibold mt-0.5">{IDR(Number(s.value ?? 0))}</p>
                          </div>
                        ))}
                      </div>
                    </CardContent>
                  </Card>
                )}

                {/* Error list */}
                {(validation.errors as any[]).length === 0 ? (
                  <p className="text-center text-sm text-emerald-600 py-4">✓ Tidak ada masalah yang terdeteksi</p>
                ) : (
                  <Card>
                    <CardHeader className="pb-1 pt-3 px-4">
                      <CardTitle className="text-sm">Daftar Masalah</CardTitle>
                    </CardHeader>
                    <CardContent className="p-0">
                      <div className="divide-y">
                        {(validation.errors as any[]).map((e: any, i: number) => {
                          const sv = SEVERITY_META[e.severity as keyof typeof SEVERITY_META] ?? SEVERITY_META.LOW;
                          return (
                            <div key={i} className="flex items-start gap-3 px-4 py-3">
                              <div className={`flex items-center gap-1 rounded px-1.5 py-0.5 text-[10px] font-semibold border flex-shrink-0 mt-0.5 ${sv.cls}`}>
                                {sv.icon}{sv.label}
                              </div>
                              <div className="flex-1 min-w-0">
                                <p className="text-xs font-medium text-slate-800">{e.message}</p>
                                <p className="text-[10px] text-muted-foreground font-mono mt-0.5">{e.code}</p>
                              </div>
                            </div>
                          );
                        })}
                      </div>
                    </CardContent>
                  </Card>
                )}
              </div>
            )}
          </TabsContent>
        </Tabs>
      )}
    </div>
  );
}
