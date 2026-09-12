import { DatePicker } from "@/components/ui/date-picker";
import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { AppShell } from "@/components/layout/AppShell";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  TrendingUp,
  TrendingDown,
  Banknote,
  Receipt,
  CreditCard,
  Layers,
  RefreshCw,
  Download,
  Eye,
  ArrowLeft,
} from "lucide-react";
import { Link } from "wouter";

function fmt(n: number) {
  return new Intl.NumberFormat("id-ID", {
    style: "currency",
    currency: "IDR",
    maximumFractionDigits: 0,
  }).format(n);
}

interface HoldingSummary {
  revenue: number;
  expense: number;
  netPL: number;
  cashBalance: number;
  receivable: number;
  payable: number;
  companyIds: number[];
}

interface CompanyBreakdown {
  companyId: number;
  companyName: string;
  companyCode: string;
  revenue: number;
  expense: number;
  netPL: number;
  cashBalance: number;
  receivable: number;
  payable: number;
}

interface HoldingEntry {
  id: number;
  entry_date: string;
  description: string | null;
  status: string;
  company_id: number;
  company_name: string;
  company_code: string;
  total_debit: string;
  total_credit: string;
}

interface HoldingGroup {
  id: number;
  holding_name: string;
  holding_code: string;
  members: { companyId: number; companyName: string; companyCode: string }[];
}

async function fetchGroups(): Promise<HoldingGroup[]> {
  const res = await fetch("/api/accounting/holding/groups", { credentials: "include" });
  if (!res.ok) throw new Error("Gagal memuat holding groups");
  return res.json();
}

async function fetchSummary(from: string, to: string, companyId: string): Promise<HoldingSummary> {
  const params = new URLSearchParams({ holdingId: "1" });
  if (from) params.set("from", from);
  if (to) params.set("to", to);
  if (companyId !== "all") params.set("companyId", companyId);
  const res = await fetch(`/api/accounting/holding/summary?${params}`, {
    credentials: "include",
  });
  if (!res.ok) throw new Error("Gagal memuat data summary");
  return res.json() as Promise<HoldingSummary>;
}

async function fetchBreakdown(from: string, to: string, companyId: string): Promise<CompanyBreakdown[]> {
  const params = new URLSearchParams({ holdingId: "1" });
  if (from) params.set("from", from);
  if (to) params.set("to", to);
  if (companyId !== "all") params.set("companyId", companyId);
  const res = await fetch(`/api/accounting/holding/breakdown?${params}`, {
    credentials: "include",
  });
  if (!res.ok) throw new Error("Gagal memuat data breakdown");
  return res.json() as Promise<CompanyBreakdown[]>;
}

async function fetchEntries(from: string, to: string, companyId: string): Promise<HoldingEntry[]> {
  const params = new URLSearchParams({ holdingId: "1" });
  if (from) params.set("from", from);
  if (to) params.set("to", to);
  if (companyId !== "all") params.set("companyId", companyId);
  const res = await fetch(`/api/accounting/holding/entries?${params}`, {
    credentials: "include",
  });
  if (!res.ok) throw new Error("Gagal memuat data transaksi");
  return res.json() as Promise<HoldingEntry[]>;
}

const COMPANY_COLORS: Record<string, string> = {
  CST: "bg-indigo-500/10 text-indigo-400 border-indigo-500/30",
  WS:  "bg-emerald-500/10 text-emerald-400 border-emerald-500/30",
  DV:  "bg-amber-500/10 text-amber-400 border-amber-500/30",
  ER:  "bg-rose-500/10 text-rose-400 border-rose-500/30",
};

function getColorClass(code: string) {
  const prefix = code.slice(0, 2).toUpperCase();
  return COMPANY_COLORS[prefix] ?? COMPANY_COLORS["CST"]!;
}

function formatDate(d: string) {
  if (!d) return "-";
  return new Date(d).toLocaleDateString("id-ID", { day: "2-digit", month: "short", year: "numeric" });
}

export default function HoldingDashboardPage() {
  const currentYear = new Date().getFullYear();
  const [from, setFrom] = useState(`${currentYear}-01-01`);
  const [to, setTo] = useState(`${currentYear}-12-31`);
  const [appliedFrom, setAppliedFrom] = useState(from);
  const [appliedTo, setAppliedTo] = useState(to);
  const [selectedCompany, setSelectedCompany] = useState<string>("all");
  const [appliedCompany, setAppliedCompany] = useState<string>("all");

  const { data: groups = [] } = useQuery({
    queryKey: ["holding-groups"],
    queryFn: fetchGroups,
  });

  const members = groups[0]?.members ?? [];

  const { data: summary, isLoading: loadingS, refetch: refetchS } = useQuery({
    queryKey: ["holding-summary", appliedFrom, appliedTo, appliedCompany],
    queryFn: () => fetchSummary(appliedFrom, appliedTo, appliedCompany),
  });

  const { data: breakdown = [], isLoading: loadingB, refetch: refetchB } = useQuery({
    queryKey: ["holding-breakdown", appliedFrom, appliedTo, appliedCompany],
    queryFn: () => fetchBreakdown(appliedFrom, appliedTo, appliedCompany),
  });

  const { data: entries = [], isLoading: loadingE, refetch: refetchE } = useQuery({
    queryKey: ["holding-entries", appliedFrom, appliedTo, appliedCompany],
    queryFn: () => fetchEntries(appliedFrom, appliedTo, appliedCompany),
  });

  const isLoading = loadingS || loadingB || loadingE;

  const activeMemberName = appliedCompany === "all"
    ? null
    : members.find((m) => String(m.companyId) === appliedCompany)?.companyName ?? appliedCompany;

  function applyFilter() {
    setAppliedFrom(from);
    setAppliedTo(to);
    setAppliedCompany(selectedCompany);
  }

  function refetch() {
    void refetchS();
    void refetchB();
    void refetchE();
  }

  function handleExportCSV() {
    const headerEntries = ["Tanggal", "No. Jurnal", "Deskripsi", "Status", "Asal Perusahaan", "Total Debit", "Total Kredit"];
    const rowsEntries = entries.map((e) => [
      formatDate(e.entry_date),
      e.id,
      e.description ?? "",
      e.status,
      `${e.company_code} - ${e.company_name}`,
      Number(e.total_debit),
      Number(e.total_credit),
    ]);

    const headerSummary = ["", "Perusahaan", "Revenue", "Expense", "Net P&L", "Kas & Bank", "Piutang", "Utang"];
    const rowsSummary = breakdown.map((b) => [
      "", b.companyName, b.revenue, b.expense, b.netPL, b.cashBalance, b.receivable, b.payable,
    ]);
    if (summary) {
      rowsSummary.push(["", "TOTAL KONSOLIDASI", summary.revenue, summary.expense, summary.netPL, summary.cashBalance, summary.receivable, summary.payable]);
    }

    const lines = [
      `CST GROUP — Holding Dashboard Export`,
      `Periode: ${appliedFrom} s/d ${appliedTo}`,
      `Filter: ${appliedCompany === "all" ? "Semua Perusahaan (Gabungan)" : activeMemberName ?? appliedCompany}`,
      ``,
      `=== RINGKASAN KEUANGAN ===`,
      headerSummary.join(","),
      ...rowsSummary.map((r) => r.join(",")),
      ``,
      `=== DATA TRANSAKSI ===`,
      headerEntries.join(","),
      ...rowsEntries.map((r) => r.join(",")),
    ];

    const csv = lines.join("\n");
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `CST-Group-Holding-${appliedFrom}-sd-${appliedTo}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  }

  const summaryCards = [
    { label: "Total Revenue",    value: summary?.revenue,     icon: TrendingUp,  color: "text-emerald-400", bg: "bg-emerald-500/10" },
    { label: "Total Expense",    value: summary?.expense,     icon: TrendingDown, color: "text-rose-400",   bg: "bg-rose-500/10" },
    {
      label: "Net Profit / Loss",
      value: summary?.netPL,
      icon: Banknote,
      color: (summary?.netPL ?? 0) >= 0 ? "text-emerald-400" : "text-rose-400",
      bg:    (summary?.netPL ?? 0) >= 0 ? "bg-emerald-500/10" : "bg-rose-500/10",
    },
    { label: "Total Kas & Bank", value: summary?.cashBalance, icon: Banknote,    color: "text-sky-400",    bg: "bg-sky-500/10" },
    { label: "Total Piutang",    value: summary?.receivable,  icon: Receipt,     color: "text-amber-400",  bg: "bg-amber-500/10" },
    { label: "Total Utang",      value: summary?.payable,     icon: CreditCard,  color: "text-orange-400", bg: "bg-orange-500/10" },
  ];

  return (
    <AppShell>
      <div className="max-w-7xl mx-auto space-y-6">

        {/* Header */}
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
          <div className="flex items-center gap-4">
            <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-indigo-600/20 border border-indigo-500/30">
              <Layers className="h-6 w-6 text-indigo-400" />
            </div>
            <div>
              <div className="flex items-center gap-2 flex-wrap">
                <Link href="/accounting"><Button variant="ghost" size="icon" aria-label="Kembali"><ArrowLeft className="h-4 w-4" /></Button></Link>

                <h1 className="text-2xl font-bold tracking-tight">Holding Dashboard</h1>
                <Badge className="bg-indigo-600/20 text-indigo-300 border border-indigo-500/40 text-xs font-mono">
                  CST GROUP
                </Badge>
              </div>
              <p className="text-muted-foreground text-sm mt-0.5">
                Laporan keuangan konsolidasi seluruh entitas grup
              </p>
            </div>
          </div>
          <div className="flex items-center gap-2 shrink-0">
            <Button variant="outline" size="sm" onClick={refetch} disabled={isLoading}>
              <RefreshCw className={`h-3.5 w-3.5 mr-1.5 ${isLoading ? "animate-spin" : ""}`} />
              Refresh
            </Button>
            <Button variant="outline" size="sm" onClick={handleExportCSV} disabled={isLoading || entries.length === 0}>
              <Download className="h-3.5 w-3.5 mr-1.5" />
              Export CSV
            </Button>
          </div>
        </div>

        {/* Filter Bar */}
        <div className="flex flex-wrap items-end gap-3 rounded-lg border border-border bg-card p-4">
          <div className="space-y-1">
            <Label className="text-xs text-muted-foreground">Dari Tanggal</Label>
            <DatePicker value={from} onChange={(v) => setFrom(v)} className="h-8 text-sm w-40" />
          </div>
          <div className="space-y-1">
            <Label className="text-xs text-muted-foreground">Sampai Tanggal</Label>
            <DatePicker value={to} onChange={(v) => setTo(v)} className="h-8 text-sm w-40" />
          </div>
          <div className="space-y-1">
            <Label className="text-xs text-muted-foreground">Perusahaan</Label>
            <Select value={selectedCompany} onValueChange={setSelectedCompany}>
              <SelectTrigger className="h-8 text-sm w-52">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">🔗 Semua Perusahaan (Gabungan)</SelectItem>
                {members.map((m) => (
                  <SelectItem key={m.companyId} value={String(m.companyId)}>
                    {m.companyCode} — {m.companyName}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <Button size="sm" onClick={applyFilter} className="h-8">
            Terapkan Filter
          </Button>
        </div>

        {/* View Indicator Badge */}
        <div className="flex items-center gap-2">
          <div className="flex items-center gap-2 rounded-md border border-border bg-card px-3 py-1.5 text-sm">
            <Eye className="h-3.5 w-3.5 text-indigo-400 shrink-0" />
            <span className="text-muted-foreground">Menampilkan:</span>
            {appliedCompany === "all" ? (
              <span className="font-semibold text-indigo-400">Data Gabungan {members.length > 0 ? members.length : 4} Perusahaan</span>
            ) : (
              <span className={`font-semibold ${getColorClass(members.find((m) => String(m.companyId) === appliedCompany)?.companyCode ?? "CST").split(" ")[1]}`}>
                {activeMemberName}
              </span>
            )}
            <span className="text-muted-foreground">·</span>
            <span className="text-xs text-muted-foreground">{appliedFrom} s/d {appliedTo}</span>
          </div>
        </div>

        {/* Summary Cards */}
        <div className="grid gap-4 grid-cols-2 lg:grid-cols-3">
          {summaryCards.map((card) => {
            const Icon = card.icon;
            return (
              <Card key={card.label} className="border-border">
                <CardContent className="p-4 flex items-center gap-3">
                  <div className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-xl ${card.bg}`}>
                    <Icon className={`h-5 w-5 ${card.color}`} />
                  </div>
                  <div className="min-w-0">
                    <p className="text-xs text-muted-foreground">{card.label}</p>
                    {loadingS ? (
                      <div className="h-5 w-32 rounded bg-muted animate-pulse mt-1" />
                    ) : (
                      <p className={`text-base font-bold ${card.color} truncate`}>
                        {card.value !== undefined ? fmt(card.value) : "—"}
                      </p>
                    )}
                  </div>
                </CardContent>
              </Card>
            );
          })}
        </div>

        {/* Company Breakdown Table */}
        {appliedCompany === "all" && (
          <Card className="border-border">
            <CardHeader className="pb-3">
              <CardTitle className="text-base">Breakdown per Perusahaan</CardTitle>
            </CardHeader>
            <CardContent className="p-0">
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-border">
                      <th className="text-left px-4 py-3 text-xs font-medium text-muted-foreground">Perusahaan</th>
                      <th className="text-right px-4 py-3 text-xs font-medium text-muted-foreground">Revenue</th>
                      <th className="text-right px-4 py-3 text-xs font-medium text-muted-foreground">Expense</th>
                      <th className="text-right px-4 py-3 text-xs font-medium text-muted-foreground">Net P&L</th>
                      <th className="text-right px-4 py-3 text-xs font-medium text-muted-foreground">Kas & Bank</th>
                      <th className="text-right px-4 py-3 text-xs font-medium text-muted-foreground">Piutang</th>
                      <th className="text-right px-4 py-3 text-xs font-medium text-muted-foreground">Utang</th>
                    </tr>
                  </thead>
                  <tbody>
                    {loadingB ? (
                      Array.from({ length: 4 }).map((_, i) => (
                        <tr key={i} className="border-b border-border">
                          {Array.from({ length: 7 }).map((_, j) => (
                            <td key={j} className="px-4 py-3">
                              <div className="h-4 rounded bg-muted animate-pulse" />
                            </td>
                          ))}
                        </tr>
                      ))
                    ) : breakdown.length === 0 ? (
                      <tr>
                        <td colSpan={7} className="px-4 py-6 text-center text-muted-foreground text-sm">
                          Belum ada data jurnal yang diposting untuk periode ini
                        </td>
                      </tr>
                    ) : (
                      breakdown.map((b) => (
                        <tr key={b.companyId} className="border-b border-border last:border-0 hover:bg-muted/30 transition-colors">
                          <td className="px-4 py-3">
                            <div className="flex items-center gap-2">
                              <span className={`inline-flex items-center justify-center rounded-md px-1.5 py-0.5 text-xs font-mono font-semibold border ${getColorClass(b.companyCode)}`}>
                                {b.companyCode}
                              </span>
                              <span className="font-medium truncate max-w-[160px]">{b.companyName}</span>
                            </div>
                          </td>
                          <td className="px-4 py-3 text-right font-mono text-emerald-400">{fmt(b.revenue)}</td>
                          <td className="px-4 py-3 text-right font-mono text-rose-400">{fmt(b.expense)}</td>
                          <td className={`px-4 py-3 text-right font-mono font-semibold ${b.netPL >= 0 ? "text-emerald-400" : "text-rose-400"}`}>{fmt(b.netPL)}</td>
                          <td className="px-4 py-3 text-right font-mono text-sky-400">{fmt(b.cashBalance)}</td>
                          <td className="px-4 py-3 text-right font-mono text-amber-400">{fmt(b.receivable)}</td>
                          <td className="px-4 py-3 text-right font-mono text-orange-400">{fmt(b.payable)}</td>
                        </tr>
                      ))
                    )}
                  </tbody>
                  {!loadingB && breakdown.length > 0 && summary && (
                    <tfoot>
                      <tr className="border-t-2 border-border bg-muted/40">
                        <td className="px-4 py-3 font-semibold text-xs uppercase tracking-wide text-muted-foreground">Total Konsolidasi</td>
                        <td className="px-4 py-3 text-right font-mono font-bold text-emerald-400">{fmt(summary.revenue)}</td>
                        <td className="px-4 py-3 text-right font-mono font-bold text-rose-400">{fmt(summary.expense)}</td>
                        <td className={`px-4 py-3 text-right font-mono font-bold ${summary.netPL >= 0 ? "text-emerald-400" : "text-rose-400"}`}>{fmt(summary.netPL)}</td>
                        <td className="px-4 py-3 text-right font-mono font-bold text-sky-400">{fmt(summary.cashBalance)}</td>
                        <td className="px-4 py-3 text-right font-mono font-bold text-amber-400">{fmt(summary.receivable)}</td>
                        <td className="px-4 py-3 text-right font-mono font-bold text-orange-400">{fmt(summary.payable)}</td>
                      </tr>
                    </tfoot>
                  )}
                </table>
              </div>
            </CardContent>
          </Card>
        )}

        {/* Merged Transactions Table */}
        <Card className="border-border">
          <CardHeader className="pb-3 flex flex-row items-center justify-between">
            <div>
              <CardTitle className="text-base">Data Transaksi Gabungan</CardTitle>
              <p className="text-xs text-muted-foreground mt-0.5">
                {entries.length > 0 ? `${entries.length} entri jurnal (maks. 200 terbaru)` : "Tidak ada data"}
              </p>
            </div>
            {appliedCompany === "all" && (
              <Badge variant="outline" className="text-xs text-indigo-400 border-indigo-500/30 bg-indigo-500/5">
                👁️ Data Gabungan {members.length > 0 ? members.length : 4} Perusahaan
              </Badge>
            )}
          </CardHeader>
          <CardContent className="p-0">
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-border">
                    <th className="text-left px-4 py-3 text-xs font-medium text-muted-foreground">Asal Perusahaan</th>
                    <th className="text-left px-4 py-3 text-xs font-medium text-muted-foreground">Tanggal</th>
                    <th className="text-left px-4 py-3 text-xs font-medium text-muted-foreground">Deskripsi</th>
                    <th className="text-left px-4 py-3 text-xs font-medium text-muted-foreground">Status</th>
                    <th className="text-right px-4 py-3 text-xs font-medium text-muted-foreground">Debit</th>
                    <th className="text-right px-4 py-3 text-xs font-medium text-muted-foreground">Kredit</th>
                  </tr>
                </thead>
                <tbody>
                  {loadingE ? (
                    Array.from({ length: 6 }).map((_, i) => (
                      <tr key={i} className="border-b border-border">
                        {Array.from({ length: 6 }).map((_, j) => (
                          <td key={j} className="px-4 py-3">
                            <div className="h-4 rounded bg-muted animate-pulse" />
                          </td>
                        ))}
                      </tr>
                    ))
                  ) : entries.length === 0 ? (
                    <tr>
                      <td colSpan={6} className="px-4 py-8 text-center text-muted-foreground text-sm">
                        Belum ada transaksi untuk periode dan filter yang dipilih
                      </td>
                    </tr>
                  ) : (
                    entries.map((e) => (
                      <tr key={`${e.company_id}-${e.id}`} className="border-b border-border last:border-0 hover:bg-muted/30 transition-colors">
                        <td className="px-4 py-2.5">
                          <div className="flex items-center gap-1.5">
                            <span className={`inline-flex items-center justify-center rounded px-1.5 py-0.5 text-xs font-mono font-semibold border ${getColorClass(e.company_code)}`}>
                              {e.company_code}
                            </span>
                            <span className="text-xs text-muted-foreground truncate max-w-[120px]">{e.company_name}</span>
                          </div>
                        </td>
                        <td className="px-4 py-2.5 text-xs text-muted-foreground whitespace-nowrap">{formatDate(e.entry_date)}</td>
                        <td className="px-4 py-2.5 max-w-[220px]">
                          <span className="truncate block text-xs" title={e.description ?? ""}>
                            {e.description || <span className="italic text-muted-foreground">—</span>}
                          </span>
                        </td>
                        <td className="px-4 py-2.5">
                          <Badge
                            variant="outline"
                            className={`text-xs ${e.status === "posted"
                              ? "text-emerald-400 border-emerald-500/30 bg-emerald-500/5"
                              : "text-amber-400 border-amber-500/30 bg-amber-500/5"}`}
                          >
                            {e.status === "posted" ? "Diposting" : "Draft"}
                          </Badge>
                        </td>
                        <td className="px-4 py-2.5 text-right font-mono text-xs text-emerald-400">
                          {Number(e.total_debit) > 0 ? fmt(Number(e.total_debit)) : "—"}
                        </td>
                        <td className="px-4 py-2.5 text-right font-mono text-xs text-rose-400">
                          {Number(e.total_credit) > 0 ? fmt(Number(e.total_credit)) : "—"}
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          </CardContent>
        </Card>

        <p className="text-xs text-muted-foreground text-center pb-2">
          Data real-time dari database. Setiap perusahaan tersimpan terpisah — Holding membaca dan menggabungkan secara otomatis.
        </p>
      </div>
    </AppShell>
  );
}
