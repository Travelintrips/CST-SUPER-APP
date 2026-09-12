import { useState, useCallback } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { AppShell } from "@/components/layout/AppShell";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter,
} from "@/components/ui/dialog";
import {
  AlertTriangle, CheckCircle2, Download, RefreshCw, FileText,
  ShieldCheck, XCircle, Save, Loader2, Search, Sparkles,
  FileSpreadsheet, FileCode, Trash2, ChevronRight, Clock, Send,
  BarChart3, Receipt, ScrollText, Hash, Stamp, ArrowLeft,
} from "lucide-react";
import { useCompany } from "@/contexts/CompanyContext";
import { toast } from "sonner";
import { BackButton } from "@/components/ui/back-button";

// ── Helpers ────────────────────────────────────────────────────────────────────

function formatRp(n: number | string) {
  return "Rp " + Math.abs(Math.round(Number(n))).toLocaleString("id-ID");
}

function generateYears() {
  const now = new Date().getFullYear();
  return Array.from({ length: 5 }, (_, i) => String(now - i));
}

function generateMonths(year: string) {
  return Array.from({ length: 12 }, (_, i) => {
    const m = String(i + 1).padStart(2, "0");
    return `${year}-${m}`;
  });
}

const MONTH_NAMES = ["Jan", "Feb", "Mar", "Apr", "Mei", "Jun", "Jul", "Agu", "Sep", "Okt", "Nov", "Des"];
function monthLabel(period: string) {
  const parts = period.split("-");
  const m = parseInt(parts[1] ?? "1") - 1;
  return `${MONTH_NAMES[m] ?? "?"} ${parts[0]}`;
}

const STATUS_CONFIG: Record<string, { label: string; color: string; icon: React.ReactNode }> = {
  draft:     { label: "Draft",     color: "bg-slate-100 text-slate-700",   icon: <Clock className="h-3 w-3" /> },
  validated: { label: "Validated", color: "bg-blue-100 text-blue-700",     icon: <CheckCircle2 className="h-3 w-3" /> },
  exported:  { label: "Exported",  color: "bg-purple-100 text-purple-700", icon: <Download className="h-3 w-3" /> },
  submitted: { label: "Submitted", color: "bg-emerald-100 text-emerald-700", icon: <Send className="h-3 w-3" /> },
};

function StatusBadge({ status }: { status: string }) {
  const cfg = STATUS_CONFIG[status] ?? STATUS_CONFIG["draft"];
  return (
    <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[11px] font-medium ${cfg.color}`}>
      {cfg.icon}{cfg.label}
    </span>
  );
}

// ── Types ──────────────────────────────────────────────────────────────────────

interface SptPeriodSummary {
  period: string;
  ppn_output: number;
  ppn_input: number;
  net_ppn: number;
  pph_total: number;
  tx_count: number;
  has_faktur: number;
  missing_faktur: number;
  has_bupot: number;
  missing_bupot: number;
}

interface SptTransaction {
  id: number;
  transaction_type: string;
  transaction_id: number;
  tax_name: string;
  tax_rate: number;
  base_amount: number;
  tax_amount: number;
  direction: string;
  status: string;
  faktur_pajak_number: string | null;
  bukti_potong_number: string | null;
  created_at: string;
}

interface SptDraft {
  company_id: number;
  period: string;
  built_at: string;
  ppn: { output_tax_total: number; input_tax_total: number; net_vat: number; tx_count: number };
  pph23: { total_withholding: number; tx_count: number };
  pph21: { total_withholding: number; tx_count: number };
  pph15: { total_withholding: number; tx_count: number };
  pph4:  { total_withholding: number; tx_count: number };
  all_pph: { total_withholding: number; tx_count: number };
  transactions: SptTransaction[];
}

interface SavedDraft {
  id: number;
  company_id: number;
  period: string;
  type: string;
  status: string;
  payload_json: SptDraft;
  created_at: string;
  updated_at: string;
}

interface ReconcileResult {
  status: "OK" | "MISMATCH";
  period: string;
  checked_at: string;
  is_balanced: boolean;
  missing_in_gl: Array<{ description: string; severity: string; transaction_type?: string; amount_tt?: number }>;
  missing_in_tax: Array<{ description: string; severity: string; gl_entry_id?: number; amount_gl?: number }>;
  amount_mismatches: Array<{ description: string; severity: string; diff?: number }>;
  summary: Record<string, number>;
  total_gaps: number;
}

// ── Main Component ─────────────────────────────────────────────────────────────

export default function TaxSptBuilderPage() {
  const { activeCompanyId } = useCompany();
  const companyId = typeof activeCompanyId === "number" ? activeCompanyId : Number(activeCompanyId) || 1;
  const qc = useQueryClient();

  const [year, setYear] = useState(String(new Date().getFullYear()));
  const [selectedPeriod, setSelectedPeriod] = useState(() => {
    const now = new Date();
    return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;
  });
  const [activeTab, setActiveTab] = useState("periods");
  const [saveNotes, setSaveNotes] = useState("");
  const [saveDialogOpen, setSaveDialogOpen] = useState(false);
  const [npwp, setNpwp] = useState("");
  const [nama, setNama] = useState("");
  const [expandedTx, setExpandedTx] = useState(false);
  const [deleteConfirmId, setDeleteConfirmId] = useState<number | null>(null);

  // ── Queries ──────────────────────────────────────────────────────────────────

  const periodsQ = useQuery<{ year: string; periods: SptPeriodSummary[] }>({
    queryKey: ["spt-builder-periods", companyId, year],
    queryFn: () => fetch(`/api/tax/spt-builder/periods?companyId=${companyId}&year=${year}`, { credentials: "include" }).then(r => r.json()),
    enabled: !!companyId,
  });

  const draftQ = useQuery<SptDraft>({
    queryKey: ["spt-builder-draft", companyId, selectedPeriod],
    queryFn: () => fetch(`/api/tax/spt-builder/draft?companyId=${companyId}&period=${selectedPeriod}`, { credentials: "include" }).then(r => r.json()),
    enabled: !!companyId && activeTab === "builder",
  });

  const savedDraftsQ = useQuery<{ drafts: SavedDraft[] }>({
    queryKey: ["spt-builder-drafts", companyId, year],
    queryFn: () => fetch(`/api/tax/spt-builder/drafts?companyId=${companyId}&year=${year}`, { credentials: "include" }).then(r => r.json()),
    enabled: !!companyId && activeTab === "drafts",
  });

  const reconcileQ = useQuery<ReconcileResult>({
    queryKey: ["spt-builder-reconcile", companyId, selectedPeriod],
    queryFn: () => fetch(`/api/tax/spt-builder/reconcile?companyId=${companyId}&period=${selectedPeriod}`, { credentials: "include" }).then(r => r.json()),
    enabled: !!companyId && activeTab === "reconcile",
  });

  // ── Mutations ────────────────────────────────────────────────────────────────

  const saveMut = useMutation({
    mutationFn: (body: { period: string; type: string; notes: string }) =>
      fetch("/api/tax/spt-builder/draft/save", {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ companyId, ...body }),
      }).then(r => r.json()),
    onSuccess: (data) => {
      if (data.error) { toast.error(data.error); return; }
      toast.success(`Draft SPT ${data.period} berhasil disimpan (ID: ${data.id})`);
      setSaveDialogOpen(false);
      setSaveNotes("");
      qc.invalidateQueries({ queryKey: ["spt-builder-drafts"] });
    },
    onError: () => toast.error("Gagal menyimpan draft"),
  });

  const fakturGenMut = useMutation({
    mutationFn: (opts: { period: string; kodeTransaksi?: string }) =>
      fetch("/api/tax/faktur/auto-generate", {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ companyId, period: opts.period, kodeTransaksi: opts.kodeTransaksi }),
      }).then(r => r.json()),
    onSuccess: (data) => {
      if (data.message && !data.ok) { toast.error(data.message); return; }
      toast.success(data.message ?? `${data.updated ?? 0} nomor faktur berhasil di-generate`);
      if (data.samples?.length) toast.info(`Contoh: ${data.samples.slice(0, 2).join(", ")}`);
      qc.invalidateQueries({ queryKey: ["spt-builder-draft"] });
    },
    onError: () => toast.error("Gagal generate nomor faktur"),
  });

  const bupotGenMut = useMutation({
    mutationFn: (opts: { period: string; taxType?: string }) =>
      fetch("/api/tax/bupot/auto-generate", {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ companyId, period: opts.period, taxType: opts.taxType }),
      }).then(r => r.json()),
    onSuccess: (data) => {
      if (data.message && !data.ok) { toast.error(data.message); return; }
      toast.success(data.message ?? `${data.updated ?? 0} nomor bupot berhasil di-generate`);
      if (data.samples?.length) toast.info(`Contoh: ${data.samples.slice(0, 2).join(", ")}`);
      qc.invalidateQueries({ queryKey: ["spt-builder-draft"] });
    },
    onError: () => toast.error("Gagal generate nomor bupot"),
  });

  const statusMut = useMutation({
    mutationFn: ({ id, status }: { id: number; status: string }) =>
      fetch(`/api/tax/spt-builder/drafts/${id}/status`, {
        method: "PUT",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ companyId, status }),
      }).then(r => r.json()),
    onSuccess: (data) => {
      if (data.error) { toast.error(data.error); return; }
      toast.success(`Status diperbarui: ${data.status}`);
      qc.invalidateQueries({ queryKey: ["spt-builder-drafts"] });
    },
    onError: () => toast.error("Gagal update status"),
  });

  const deleteMut = useMutation({
    mutationFn: (id: number) =>
      fetch(`/api/tax/spt-builder/drafts/${id}?companyId=${companyId}`, {
        method: "DELETE",
        credentials: "include",
      }).then(r => r.json()),
    onSuccess: (data) => {
      if (data.error) { toast.error(data.error); return; }
      toast.success("Draft dihapus");
      setDeleteConfirmId(null);
      qc.invalidateQueries({ queryKey: ["spt-builder-drafts"] });
    },
    onError: () => toast.error("Gagal hapus draft"),
  });

  // ── Export helpers ───────────────────────────────────────────────────────────

  const doExportCsv = useCallback((period: string, taxType: string) => {
    const params = new URLSearchParams({ companyId: String(companyId), period, taxType });
    if (npwp) params.set("npwp", npwp);
    if (nama) params.set("nama", nama);
    window.open(`/api/tax/spt-builder/export/csv?${params}`, "_blank");
    toast.info(`Mengunduh CSV ${taxType} - ${period}`);
  }, [companyId, npwp, nama]);

  const doExportXml = useCallback((period: string) => {
    const params = new URLSearchParams({ companyId: String(companyId), period });
    if (npwp) params.set("npwp", npwp);
    if (nama) params.set("nama", nama);
    window.open(`/api/tax/spt-builder/export/xml?${params}`, "_blank");
    toast.info(`Mengunduh XML PPN - ${period}`);
  }, [companyId, npwp, nama]);

  // ── Derived ──────────────────────────────────────────────────────────────────

  const periods = periodsQ.data?.periods ?? [];
  const draft = draftQ.data;
  const savedDrafts = savedDraftsQ.data?.drafts ?? [];
  const recon = reconcileQ.data;

  const periodMonths = generateMonths(year);

  // ── Render ───────────────────────────────────────────────────────────────────

  return (
    <AppShell>
      <BackButton href="/finance/workspace/tax-center" />
      <div className="p-6 space-y-5 max-w-6xl mx-auto">
        <Button variant="ghost" size="sm" className="-ml-2" onClick={() => window.history.back()}>
          <ArrowLeft className="h-4 w-4 mr-1" />Kembali
        </Button>
        {/* Header */}
        <div className="flex items-start justify-between gap-3 flex-wrap">
          <div>
            <h1 className="text-xl font-bold flex items-center gap-2">
              <ScrollText className="h-5 w-5 text-indigo-600" />
              Coretax SPT Builder
            </h1>
            <p className="text-sm text-muted-foreground mt-0.5">
              Kelola draft SPT Masa PPN & PPh, rekonsiliasi, dan export DJP Coretax
            </p>
          </div>
          <div className="flex items-center gap-2">
            <Select value={year} onValueChange={setYear}>
              <SelectTrigger className="w-28 h-9"><SelectValue /></SelectTrigger>
              <SelectContent>{generateYears().map(y => <SelectItem key={y} value={y}>{y}</SelectItem>)}</SelectContent>
            </Select>
            <Select value={selectedPeriod} onValueChange={setSelectedPeriod}>
              <SelectTrigger className="w-36 h-9"><SelectValue /></SelectTrigger>
              <SelectContent>
                {periodMonths.map(p => (
                  <SelectItem key={p} value={p}>{monthLabel(p)}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </div>

        {/* Tabs */}
        <Tabs value={activeTab} onValueChange={setActiveTab}>
          <TabsList className="grid grid-cols-4 w-full max-w-xl">
            <TabsTrigger value="periods" className="text-xs gap-1.5">
              <BarChart3 className="h-3.5 w-3.5" />Periode
            </TabsTrigger>
            <TabsTrigger value="builder" className="text-xs gap-1.5">
              <Sparkles className="h-3.5 w-3.5" />Builder
            </TabsTrigger>
            <TabsTrigger value="drafts" className="text-xs gap-1.5">
              <FileText className="h-3.5 w-3.5" />Draft Tersimpan
            </TabsTrigger>
            <TabsTrigger value="reconcile" className="text-xs gap-1.5">
              <ShieldCheck className="h-3.5 w-3.5" />Rekonsiliasi
            </TabsTrigger>
          </TabsList>

          {/* ── TAB: PERIODE ─────────────────────────────────────────────────── */}
          <TabsContent value="periods" className="mt-4">
            <div className="flex items-center justify-between mb-3">
              <p className="text-sm text-muted-foreground">
                {periods.length} periode aktif di tahun {year}
              </p>
              <Button variant="outline" size="sm" onClick={() => periodsQ.refetch()} disabled={periodsQ.isFetching}>
                <RefreshCw className={`h-4 w-4 mr-1.5 ${periodsQ.isFetching ? "animate-spin" : ""}`} />Refresh
              </Button>
            </div>

            {periodsQ.isLoading ? (
              <div className="space-y-3">{Array.from({ length: 4 }).map((_, i) => (
                <div key={i} className="h-16 bg-muted rounded-lg animate-pulse" />
              ))}</div>
            ) : periods.length === 0 ? (
              <div className="text-center py-16 text-muted-foreground">
                <Receipt className="h-10 w-10 mx-auto mb-3 opacity-20" />
                <p className="text-sm">Tidak ada data pajak untuk tahun {year}</p>
              </div>
            ) : (
              <div className="rounded-lg border overflow-hidden">
                <Table>
                  <TableHeader>
                    <TableRow className="bg-muted/40">
                      <TableHead>Periode</TableHead>
                      <TableHead className="text-right">PPN Keluaran</TableHead>
                      <TableHead className="text-right">PPN Masukan</TableHead>
                      <TableHead className="text-right">Net PPN</TableHead>
                      <TableHead className="text-right">PPh WHT</TableHead>
                      <TableHead className="text-right">Tx</TableHead>
                      <TableHead className="text-right">Faktur</TableHead>
                      <TableHead className="text-center">Aksi</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {periods.map((p) => (
                      <TableRow key={p.period} className="hover:bg-muted/20">
                        <TableCell className="font-medium">{monthLabel(p.period)}</TableCell>
                        <TableCell className="text-right text-xs">{formatRp(p.ppn_output)}</TableCell>
                        <TableCell className="text-right text-xs">{formatRp(p.ppn_input)}</TableCell>
                        <TableCell className={`text-right text-xs font-semibold ${p.net_ppn > 0 ? "text-orange-600" : "text-emerald-600"}`}>
                          {formatRp(p.net_ppn)}
                        </TableCell>
                        <TableCell className="text-right text-xs">{formatRp(p.pph_total)}</TableCell>
                        <TableCell className="text-right text-xs text-muted-foreground">{p.tx_count}</TableCell>
                        <TableCell className="text-right text-xs">
                          <span className="text-emerald-600">{p.has_faktur}</span>
                          {p.missing_faktur > 0 && <span className="text-orange-500 ml-1">/ {p.missing_faktur} missing</span>}
                        </TableCell>
                        <TableCell>
                          <div className="flex items-center justify-center gap-1">
                            <Button
                              variant="ghost" size="sm" className="h-7 text-xs px-2"
                              onClick={() => { setSelectedPeriod(p.period); setActiveTab("builder"); }}
                            >
                              <ChevronRight className="h-3.5 w-3.5 mr-1" />Build
                            </Button>
                            <Button
                              variant="ghost" size="sm" className="h-7 text-xs px-2"
                              onClick={() => { setSelectedPeriod(p.period); setActiveTab("reconcile"); }}
                            >
                              <ShieldCheck className="h-3.5 w-3.5" />
                            </Button>
                          </div>
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            )}
          </TabsContent>

          {/* ── TAB: BUILDER ─────────────────────────────────────────────────── */}
          <TabsContent value="builder" className="mt-4 space-y-4">
            <div className="flex items-center justify-between flex-wrap gap-2">
              <div className="flex items-center gap-2">
                <span className="text-sm font-medium">Periode:</span>
                <Badge variant="outline" className="text-sm px-3">{monthLabel(selectedPeriod)}</Badge>
              </div>
              <div className="flex items-center gap-2">
                <Button
                  variant="outline" size="sm"
                  onClick={() => draftQ.refetch()} disabled={draftQ.isFetching}
                >
                  <RefreshCw className={`h-4 w-4 mr-1.5 ${draftQ.isFetching ? "animate-spin" : ""}`} />Refresh
                </Button>
                <Button
                  size="sm"
                  onClick={() => setSaveDialogOpen(true)}
                  disabled={!draft || draftQ.isLoading}
                  className="gap-1.5 bg-indigo-600 hover:bg-indigo-700"
                >
                  <Save className="h-4 w-4" />Simpan Draft
                </Button>
              </div>
            </div>

            {/* NPWP / Nama untuk export */}
            <Card>
              <CardContent className="p-4 flex gap-3 items-end flex-wrap">
                <div className="flex-1 min-w-40">
                  <p className="text-xs text-muted-foreground mb-1">NPWP Perusahaan (untuk export)</p>
                  <Input placeholder="000000000000000" value={npwp} onChange={e => setNpwp(e.target.value)} className="h-8 text-sm font-mono" />
                </div>
                <div className="flex-1 min-w-40">
                  <p className="text-xs text-muted-foreground mb-1">Nama Perusahaan</p>
                  <Input placeholder="PT. ..." value={nama} onChange={e => setNama(e.target.value)} className="h-8 text-sm" />
                </div>
                <p className="text-xs text-muted-foreground pb-1.5">Digunakan pada export CSV/XML DJP</p>
              </CardContent>
            </Card>

            {draftQ.isLoading ? (
              <div className="flex items-center justify-center py-16">
                <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
              </div>
            ) : !draft ? (
              <div className="text-center py-16 text-muted-foreground">
                <Search className="h-10 w-10 mx-auto mb-3 opacity-20" />
                <p className="text-sm">Tidak ada data pajak untuk periode {selectedPeriod}</p>
              </div>
            ) : (
              <div className="space-y-4">
                {/* Summary Cards */}
                <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                  <Card className="border-indigo-200 bg-indigo-50/60">
                    <CardContent className="p-4">
                      <p className="text-xs text-indigo-700">PPN Keluaran</p>
                      <p className="text-lg font-bold text-indigo-900">{formatRp(draft.ppn.output_tax_total)}</p>
                      <p className="text-[10px] text-indigo-600 mt-0.5">{draft.ppn.tx_count} transaksi</p>
                    </CardContent>
                  </Card>
                  <Card className="border-teal-200 bg-teal-50/60">
                    <CardContent className="p-4">
                      <p className="text-xs text-teal-700">PPN Masukan</p>
                      <p className="text-lg font-bold text-teal-900">{formatRp(draft.ppn.input_tax_total)}</p>
                      <p className="text-[10px] text-teal-600 mt-0.5">Pajak dikreditkan</p>
                    </CardContent>
                  </Card>
                  <Card className={draft.ppn.net_vat > 0 ? "border-orange-200 bg-orange-50/60" : "border-emerald-200 bg-emerald-50/60"}>
                    <CardContent className="p-4">
                      <p className={`text-xs ${draft.ppn.net_vat > 0 ? "text-orange-700" : "text-emerald-700"}`}>Net PPN</p>
                      <p className={`text-lg font-bold ${draft.ppn.net_vat > 0 ? "text-orange-900" : "text-emerald-900"}`}>
                        {formatRp(draft.ppn.net_vat)}
                      </p>
                      <p className={`text-[10px] mt-0.5 ${draft.ppn.net_vat > 0 ? "text-orange-600" : "text-emerald-600"}`}>
                        {draft.ppn.net_vat > 0 ? "Kurang bayar" : "Lebih bayar"}
                      </p>
                    </CardContent>
                  </Card>
                  <Card className="border-violet-200 bg-violet-50/60">
                    <CardContent className="p-4">
                      <p className="text-xs text-violet-700">Total PPh WHT</p>
                      <p className="text-lg font-bold text-violet-900">{formatRp(draft.all_pph.total_withholding)}</p>
                      <p className="text-[10px] text-violet-600 mt-0.5">{draft.all_pph.tx_count} transaksi</p>
                    </CardContent>
                  </Card>
                </div>

                {/* PPh breakdown */}
                {draft.all_pph.tx_count > 0 && (
                  <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                    {[
                      { key: "pph21", label: "PPh 21" },
                      { key: "pph23", label: "PPh 23" },
                      { key: "pph15", label: "PPh 15" },
                      { key: "pph4",  label: "PPh 4(2)" },
                    ].map(({ key, label }) => {
                      const v = draft[key as keyof SptDraft] as { total_withholding: number; tx_count: number };
                      if (!v || v.tx_count === 0) return null;
                      return (
                        <Card key={key} className="border-slate-200">
                          <CardContent className="p-3">
                            <p className="text-xs text-muted-foreground">{label}</p>
                            <p className="text-sm font-bold">{formatRp(v.total_withholding)}</p>
                            <p className="text-[10px] text-muted-foreground">{v.tx_count} tx</p>
                          </CardContent>
                        </Card>
                      );
                    })}
                  </div>
                )}

                {/* Export Buttons */}
                <Card>
                  <CardHeader className="pb-2 pt-4 px-4">
                    <CardTitle className="text-sm flex items-center gap-2">
                      <Download className="h-4 w-4 text-indigo-600" />Export DJP Coretax
                    </CardTitle>
                  </CardHeader>
                  <CardContent className="px-4 pb-4 flex flex-wrap gap-2">
                    <Button variant="outline" size="sm" className="gap-1.5" onClick={() => doExportCsv(selectedPeriod, "PPN")}>
                      <FileSpreadsheet className="h-4 w-4 text-green-600" />CSV PPN 1111
                    </Button>
                    <Button variant="outline" size="sm" className="gap-1.5" onClick={() => doExportCsv(selectedPeriod, "PPH23")}>
                      <FileSpreadsheet className="h-4 w-4 text-blue-600" />CSV PPh 23/26
                    </Button>
                    <Button variant="outline" size="sm" className="gap-1.5" onClick={() => doExportCsv(selectedPeriod, "PPH21")}>
                      <FileSpreadsheet className="h-4 w-4 text-teal-600" />CSV PPh 21
                    </Button>
                    <Button variant="outline" size="sm" className="gap-1.5" onClick={() => doExportCsv(selectedPeriod, "WHT")}>
                      <FileSpreadsheet className="h-4 w-4 text-violet-600" />CSV Semua PPh
                    </Button>
                    <Button variant="outline" size="sm" className="gap-1.5" onClick={() => doExportXml(selectedPeriod)}>
                      <FileCode className="h-4 w-4 text-orange-600" />XML PPN
                    </Button>
                  </CardContent>
                </Card>

                {/* Auto-Generate Nomor Dokumen */}
                <Card className="border-amber-200 bg-amber-50/40">
                  <CardHeader className="pb-2 pt-4 px-4">
                    <CardTitle className="text-sm flex items-center gap-2">
                      <Hash className="h-4 w-4 text-amber-600" />Auto-Generate Nomor Dokumen Pajak
                    </CardTitle>
                  </CardHeader>
                  <CardContent className="px-4 pb-4 space-y-3">
                    {/* Faktur Pajak */}
                    <div className="flex items-start justify-between gap-4 rounded-lg border bg-white p-3">
                      <div>
                        <p className="text-sm font-medium flex items-center gap-1.5">
                          <Stamp className="h-3.5 w-3.5 text-indigo-500" />Nomor Faktur Pajak PPN
                        </p>
                        <p className="text-xs text-muted-foreground mt-0.5">
                          Format DJP e-Faktur: <span className="font-mono">KKK.SSS-TT.SSSSSSSS</span><br />
                          Hanya mengisi transaksi PPN yang belum punya nomor faktur
                        </p>
                        {draft && (() => {
                          const missingFaktur = draft.transactions.filter(
                            t => (t.tax_name.toLowerCase().includes("ppn") || t.tax_name.toLowerCase().includes("vat"))
                              && t.direction !== "withholding"
                              && !t.faktur_pajak_number
                          ).length;
                          return missingFaktur > 0
                            ? <p className="text-xs text-orange-600 mt-1 font-medium">{missingFaktur} transaksi belum bernomor faktur</p>
                            : <p className="text-xs text-emerald-600 mt-1 font-medium">✓ Semua transaksi PPN sudah bernomor faktur</p>;
                        })()}
                      </div>
                      <Button
                        size="sm"
                        variant="outline"
                        className="flex-shrink-0 border-indigo-300 text-indigo-700 hover:bg-indigo-50"
                        disabled={fakturGenMut.isPending}
                        onClick={() => fakturGenMut.mutate({ period: selectedPeriod, kodeTransaksi: "010" })}
                      >
                        {fakturGenMut.isPending
                          ? <Loader2 className="h-4 w-4 animate-spin mr-1.5" />
                          : <Hash className="h-4 w-4 mr-1.5" />}
                        Generate Faktur
                      </Button>
                    </div>

                    {/* Bukti Potong */}
                    <div className="flex items-start justify-between gap-4 rounded-lg border bg-white p-3">
                      <div>
                        <p className="text-sm font-medium flex items-center gap-1.5">
                          <Stamp className="h-3.5 w-3.5 text-violet-500" />Nomor Bukti Potong PPh
                        </p>
                        <p className="text-xs text-muted-foreground mt-0.5">
                          Format: <span className="font-mono">BP23-YYYYMM-NNNNNN</span> / <span className="font-mono">BP21-...</span><br />
                          Hanya mengisi transaksi WHT yang belum punya bukti potong
                        </p>
                        {draft && (() => {
                          const missingBupot = draft.transactions.filter(
                            t => t.direction === "withholding" && !t.bukti_potong_number
                          ).length;
                          return missingBupot > 0
                            ? <p className="text-xs text-orange-600 mt-1 font-medium">{missingBupot} transaksi belum bernomor bukti potong</p>
                            : <p className="text-xs text-emerald-600 mt-1 font-medium">✓ Semua transaksi WHT sudah bernomor bupot</p>;
                        })()}
                      </div>
                      <div className="flex flex-col gap-1.5 flex-shrink-0">
                        <Button
                          size="sm"
                          variant="outline"
                          className="border-violet-300 text-violet-700 hover:bg-violet-50"
                          disabled={bupotGenMut.isPending}
                          onClick={() => bupotGenMut.mutate({ period: selectedPeriod })}
                        >
                          {bupotGenMut.isPending
                            ? <Loader2 className="h-4 w-4 animate-spin mr-1.5" />
                            : <Hash className="h-4 w-4 mr-1.5" />}
                          Generate Semua PPh
                        </Button>
                        <div className="flex gap-1">
                          {["PPh 23", "PPh 21", "PPh 15", "PPh 4(2)"].map(t => (
                            <Button
                              key={t}
                              size="sm"
                              variant="ghost"
                              className="h-6 px-1.5 text-[10px] text-violet-600"
                              disabled={bupotGenMut.isPending}
                              onClick={() => bupotGenMut.mutate({ period: selectedPeriod, taxType: t })}
                            >
                              {t}
                            </Button>
                          ))}
                        </div>
                      </div>
                    </div>
                  </CardContent>
                </Card>

                {/* Transactions */}
                <Card>
                  <CardHeader className="pb-2 pt-4 px-4">
                    <div className="flex items-center justify-between">
                      <CardTitle className="text-sm flex items-center gap-2">
                        <Receipt className="h-4 w-4 text-slate-500" />
                        Detail Transaksi Pajak
                        <Badge variant="secondary" className="text-xs">{draft.transactions.length}</Badge>
                      </CardTitle>
                      <Button variant="ghost" size="sm" className="h-7 text-xs" onClick={() => setExpandedTx(v => !v)}>
                        {expandedTx ? "Sembunyikan" : "Tampilkan Semua"}
                      </Button>
                    </div>
                  </CardHeader>
                  {expandedTx && (
                    <CardContent className="p-0 overflow-auto max-h-96">
                      <Table>
                        <TableHeader>
                          <TableRow className="bg-muted/40">
                            <TableHead className="text-xs">Tipe TX</TableHead>
                            <TableHead className="text-xs">Pajak</TableHead>
                            <TableHead className="text-xs">Arah</TableHead>
                            <TableHead className="text-xs text-right">DPP</TableHead>
                            <TableHead className="text-xs text-right">Pajak</TableHead>
                            <TableHead className="text-xs">Status</TableHead>
                            <TableHead className="text-xs">No. Dokumen</TableHead>
                          </TableRow>
                        </TableHeader>
                        <TableBody>
                          {draft.transactions.map((tx) => (
                            <TableRow key={tx.id} className="text-xs">
                              <TableCell className="font-mono text-[10px]">{tx.transaction_type}</TableCell>
                              <TableCell>{tx.tax_name}</TableCell>
                              <TableCell>
                                <span className={`px-1.5 py-0.5 rounded text-[10px] font-medium ${
                                  tx.direction === "output" ? "bg-orange-100 text-orange-700" :
                                  tx.direction === "input" ? "bg-teal-100 text-teal-700" :
                                  "bg-violet-100 text-violet-700"
                                }`}>{tx.direction}</span>
                              </TableCell>
                              <TableCell className="text-right">{formatRp(tx.base_amount)}</TableCell>
                              <TableCell className="text-right font-semibold">{formatRp(tx.tax_amount)}</TableCell>
                              <TableCell>
                                <span className={`text-[10px] px-1.5 py-0.5 rounded ${
                                  tx.status === "paid" ? "bg-emerald-100 text-emerald-700" :
                                  tx.status === "reported" ? "bg-blue-100 text-blue-700" :
                                  "bg-slate-100 text-slate-600"
                                }`}>{tx.status}</span>
                              </TableCell>
                              <TableCell className="font-mono text-[10px] text-muted-foreground">
                                {tx.faktur_pajak_number || tx.bukti_potong_number || "-"}
                              </TableCell>
                            </TableRow>
                          ))}
                        </TableBody>
                      </Table>
                    </CardContent>
                  )}
                </Card>
              </div>
            )}
          </TabsContent>

          {/* ── TAB: DRAFT TERSIMPAN ─────────────────────────────────────────── */}
          <TabsContent value="drafts" className="mt-4 space-y-4">
            <div className="flex items-center justify-between">
              <p className="text-sm text-muted-foreground">{savedDrafts.length} draft tersimpan tahun {year}</p>
              <Button variant="outline" size="sm" onClick={() => savedDraftsQ.refetch()} disabled={savedDraftsQ.isFetching}>
                <RefreshCw className={`h-4 w-4 mr-1.5 ${savedDraftsQ.isFetching ? "animate-spin" : ""}`} />Refresh
              </Button>
            </div>

            {savedDraftsQ.isLoading ? (
              <div className="space-y-3">{Array.from({ length: 3 }).map((_, i) => (
                <div key={i} className="h-16 bg-muted rounded-lg animate-pulse" />
              ))}</div>
            ) : savedDrafts.length === 0 ? (
              <div className="text-center py-16 text-muted-foreground">
                <FileText className="h-10 w-10 mx-auto mb-3 opacity-20" />
                <p className="text-sm">Belum ada draft tersimpan untuk tahun {year}</p>
                <p className="text-xs mt-1">Buka tab Builder, pilih periode, lalu klik "Simpan Draft"</p>
              </div>
            ) : (
              <div className="rounded-lg border overflow-hidden">
                <Table>
                  <TableHeader>
                    <TableRow className="bg-muted/40">
                      <TableHead>Periode</TableHead>
                      <TableHead>Tipe</TableHead>
                      <TableHead>Status</TableHead>
                      <TableHead className="text-right">Net PPN</TableHead>
                      <TableHead className="text-right">PPh WHT</TableHead>
                      <TableHead>Disimpan</TableHead>
                      <TableHead className="text-center">Aksi</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {savedDrafts.map((d) => {
                      const payload = d.payload_json as SptDraft;
                      const netPpn = payload?.ppn?.net_vat ?? 0;
                      const pphTotal = payload?.all_pph?.total_withholding ?? 0;
                      return (
                        <TableRow key={d.id} className="hover:bg-muted/20">
                          <TableCell className="font-medium">{monthLabel(d.period)}</TableCell>
                          <TableCell>
                            <span className="text-xs px-2 py-0.5 rounded-full bg-slate-100 text-slate-700">{d.type}</span>
                          </TableCell>
                          <TableCell><StatusBadge status={d.status} /></TableCell>
                          <TableCell className={`text-right text-xs font-semibold ${netPpn > 0 ? "text-orange-600" : "text-emerald-600"}`}>
                            {formatRp(netPpn)}
                          </TableCell>
                          <TableCell className="text-right text-xs">{formatRp(pphTotal)}</TableCell>
                          <TableCell className="text-xs text-muted-foreground">
                            {new Date(d.updated_at).toLocaleDateString("id-ID")}
                          </TableCell>
                          <TableCell>
                            <div className="flex items-center justify-center gap-1">
                              {d.status === "draft" && (
                                <Button
                                  variant="ghost" size="sm" className="h-7 text-[11px] px-2 text-blue-700 hover:text-blue-800"
                                  onClick={() => statusMut.mutate({ id: d.id, status: "validated" })}
                                  disabled={statusMut.isPending}
                                >
                                  <CheckCircle2 className="h-3.5 w-3.5 mr-1" />Validasi
                                </Button>
                              )}
                              {d.status === "validated" && (
                                <Button
                                  variant="ghost" size="sm" className="h-7 text-[11px] px-2 text-emerald-700 hover:text-emerald-800"
                                  onClick={() => statusMut.mutate({ id: d.id, status: "submitted" })}
                                  disabled={statusMut.isPending}
                                >
                                  <Send className="h-3.5 w-3.5 mr-1" />Submit
                                </Button>
                              )}
                              <Button
                                variant="ghost" size="sm" className="h-7 text-[11px] px-2"
                                onClick={() => doExportCsv(d.period, "PPN")}
                              >
                                <Download className="h-3.5 w-3.5" />
                              </Button>
                              {d.status !== "submitted" && (
                                <Button
                                  variant="ghost" size="sm" className="h-7 text-[11px] px-2 text-red-500 hover:text-red-600"
                                  onClick={() => setDeleteConfirmId(d.id)}
                                >
                                  <Trash2 className="h-3.5 w-3.5" />
                                </Button>
                              )}
                            </div>
                          </TableCell>
                        </TableRow>
                      );
                    })}
                  </TableBody>
                </Table>
              </div>
            )}
          </TabsContent>

          {/* ── TAB: REKONSILIASI ────────────────────────────────────────────── */}
          <TabsContent value="reconcile" className="mt-4 space-y-4">
            <div className="flex items-center justify-between flex-wrap gap-2">
              <div className="flex items-center gap-2">
                <span className="text-sm font-medium">Rekonsiliasi periode:</span>
                <Badge variant="outline" className="text-sm px-3">{monthLabel(selectedPeriod)}</Badge>
              </div>
              <Button variant="outline" size="sm" onClick={() => reconcileQ.refetch()} disabled={reconcileQ.isFetching}>
                <RefreshCw className={`h-4 w-4 mr-1.5 ${reconcileQ.isFetching ? "animate-spin" : ""}`} />Jalankan
              </Button>
            </div>

            {reconcileQ.isLoading ? (
              <div className="flex items-center justify-center py-16">
                <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
              </div>
            ) : !recon ? (
              <div className="text-center py-16 text-muted-foreground">
                <ShieldCheck className="h-10 w-10 mx-auto mb-3 opacity-20" />
                <p className="text-sm">Klik "Jalankan" untuk memulai rekonsiliasi</p>
              </div>
            ) : (
              <div className="space-y-4">
                {/* Status banner */}
                <Card className={recon.is_balanced ? "border-emerald-300 bg-emerald-50/60" : "border-orange-300 bg-orange-50/60"}>
                  <CardContent className="p-4 flex items-center gap-3">
                    {recon.is_balanced
                      ? <CheckCircle2 className="h-6 w-6 text-emerald-600 flex-shrink-0" />
                      : <AlertTriangle className="h-6 w-6 text-orange-500 flex-shrink-0" />
                    }
                    <div>
                      <p className={`font-semibold ${recon.is_balanced ? "text-emerald-800" : "text-orange-800"}`}>
                        {recon.is_balanced ? "Rekonsiliasi OK — Tidak ada selisih" : `Ditemukan ${recon.total_gaps} gap pajak`}
                      </p>
                      <p className="text-xs text-muted-foreground">
                        Dicek: {new Date(recon.checked_at).toLocaleString("id-ID")}
                      </p>
                    </div>
                    <span className={`ml-auto text-xs font-bold px-3 py-1 rounded-full ${recon.is_balanced ? "bg-emerald-200 text-emerald-800" : "bg-orange-200 text-orange-800"}`}>
                      {recon.status}
                    </span>
                  </CardContent>
                </Card>

                {/* Summary grid */}
                <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
                  {[
                    { label: "PPN Keluaran (TX)", val: recon.summary["ppn_output_tt"] ?? 0 },
                    { label: "PPN Keluaran (GL)", val: recon.summary["ppn_output_gl"] ?? 0 },
                    { label: "Δ PPN Keluaran",    val: recon.summary["diff_ppn_output"] ?? 0, diff: true },
                    { label: "PPN Masukan (TX)",  val: recon.summary["ppn_input_tt"] ?? 0 },
                    { label: "PPN Masukan (GL)",  val: recon.summary["ppn_input_gl"] ?? 0 },
                    { label: "Δ PPN Masukan",     val: recon.summary["diff_ppn_input"] ?? 0, diff: true },
                  ].map(({ label, val, diff }) => (
                    <Card key={label} className={diff && val > 0 ? "border-orange-200 bg-orange-50/50" : ""}>
                      <CardContent className="p-3">
                        <p className="text-xs text-muted-foreground">{label}</p>
                        <p className={`text-sm font-bold ${diff && val > 0 ? "text-orange-700" : ""}`}>{formatRp(val)}</p>
                      </CardContent>
                    </Card>
                  ))}
                </div>

                {/* Gap details */}
                {!recon.is_balanced && (
                  <div className="space-y-3">
                    {recon.missing_in_gl.length > 0 && (
                      <Card className="border-red-200">
                        <CardHeader className="pb-2 pt-4 px-4">
                          <CardTitle className="text-sm text-red-700 flex items-center gap-2">
                            <XCircle className="h-4 w-4" />
                            Transaksi tanpa GL Entry ({recon.missing_in_gl.length})
                          </CardTitle>
                        </CardHeader>
                        <CardContent className="px-4 pb-4">
                          <div className="space-y-1.5">
                            {recon.missing_in_gl.map((g, i) => (
                              <div key={i} className="flex items-start gap-2 text-xs bg-red-50 rounded p-2">
                                <span className={`flex-shrink-0 px-1.5 py-0.5 rounded text-[10px] font-bold ${g.severity === "HIGH" ? "bg-red-200 text-red-800" : "bg-orange-200 text-orange-800"}`}>
                                  {g.severity}
                                </span>
                                <span className="text-muted-foreground">{g.description}</span>
                                {g.amount_tt && <span className="ml-auto flex-shrink-0 font-semibold text-red-700">{formatRp(g.amount_tt)}</span>}
                              </div>
                            ))}
                          </div>
                        </CardContent>
                      </Card>
                    )}

                    {recon.missing_in_tax.length > 0 && (
                      <Card className="border-orange-200">
                        <CardHeader className="pb-2 pt-4 px-4">
                          <CardTitle className="text-sm text-orange-700 flex items-center gap-2">
                            <AlertTriangle className="h-4 w-4" />
                            GL Entry tanpa Tax Record ({recon.missing_in_tax.length})
                          </CardTitle>
                        </CardHeader>
                        <CardContent className="px-4 pb-4">
                          <div className="space-y-1.5">
                            {recon.missing_in_tax.map((g, i) => (
                              <div key={i} className="flex items-start gap-2 text-xs bg-orange-50 rounded p-2">
                                <span className={`flex-shrink-0 px-1.5 py-0.5 rounded text-[10px] font-bold ${g.severity === "HIGH" ? "bg-red-200 text-red-800" : "bg-orange-200 text-orange-800"}`}>
                                  {g.severity}
                                </span>
                                <span className="text-muted-foreground">{g.description}</span>
                              </div>
                            ))}
                          </div>
                        </CardContent>
                      </Card>
                    )}

                    {recon.amount_mismatches.length > 0 && (
                      <Card className="border-yellow-200">
                        <CardHeader className="pb-2 pt-4 px-4">
                          <CardTitle className="text-sm text-yellow-700 flex items-center gap-2">
                            <AlertTriangle className="h-4 w-4" />
                            Selisih Nominal ({recon.amount_mismatches.length})
                          </CardTitle>
                        </CardHeader>
                        <CardContent className="px-4 pb-4">
                          <div className="space-y-1.5">
                            {recon.amount_mismatches.map((g, i) => (
                              <div key={i} className="flex items-start gap-2 text-xs bg-yellow-50 rounded p-2">
                                <span className="flex-shrink-0 px-1.5 py-0.5 rounded text-[10px] font-bold bg-yellow-200 text-yellow-800">{g.severity}</span>
                                <span className="text-muted-foreground">{g.description}</span>
                                {g.diff && <span className="ml-auto flex-shrink-0 font-semibold text-yellow-800">Δ {formatRp(g.diff)}</span>}
                              </div>
                            ))}
                          </div>
                        </CardContent>
                      </Card>
                    )}
                  </div>
                )}
              </div>
            )}
          </TabsContent>
        </Tabs>
      </div>

      {/* ── Dialog: Simpan Draft ─────────────────────────────────────────────── */}
      <Dialog open={saveDialogOpen} onOpenChange={setSaveDialogOpen}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle>Simpan Draft SPT</DialogTitle>
          </DialogHeader>
          <div className="space-y-3 py-1">
            <div>
              <p className="text-sm text-muted-foreground mb-1">Periode: <span className="font-semibold text-foreground">{monthLabel(selectedPeriod)}</span></p>
            </div>
            <div>
              <p className="text-xs text-muted-foreground mb-1">Catatan (opsional)</p>
              <Textarea
                placeholder="Mis: Draft awal sebelum rekonsiliasi"
                value={saveNotes}
                onChange={e => setSaveNotes(e.target.value)}
                rows={2}
                className="text-sm"
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" size="sm" onClick={() => setSaveDialogOpen(false)}>Batal</Button>
            <Button
              size="sm"
              disabled={saveMut.isPending}
              onClick={() => saveMut.mutate({ period: selectedPeriod, type: "ALL", notes: saveNotes })}
              className="bg-indigo-600 hover:bg-indigo-700"
            >
              {saveMut.isPending && <Loader2 className="h-4 w-4 mr-1.5 animate-spin" />}
              Simpan
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ── Dialog: Konfirmasi Hapus ─────────────────────────────────────────── */}
      <Dialog open={deleteConfirmId !== null} onOpenChange={() => setDeleteConfirmId(null)}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle>Hapus Draft SPT?</DialogTitle>
          </DialogHeader>
          <p className="text-sm text-muted-foreground">Draft yang sudah disubmit tidak bisa dihapus. Lanjutkan?</p>
          <DialogFooter>
            <Button variant="outline" size="sm" onClick={() => setDeleteConfirmId(null)}>Batal</Button>
            <Button
              variant="destructive" size="sm"
              disabled={deleteMut.isPending}
              onClick={() => deleteConfirmId !== null && deleteMut.mutate(deleteConfirmId)}
            >
              {deleteMut.isPending && <Loader2 className="h-4 w-4 mr-1.5 animate-spin" />}
              Hapus
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </AppShell>
  );
}
