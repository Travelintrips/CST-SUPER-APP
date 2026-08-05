import { DatePicker } from "@/components/ui/date-picker";
import { useState, useRef } from "react";
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
  Percent,
  RefreshCw,
  Download,
  Printer,
  FileBarChart2,
  Layers,
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

function fmtShort(n: number) {
  if (Math.abs(n) >= 1_000_000_000) return `${(n / 1_000_000_000).toFixed(1)}M`;
  if (Math.abs(n) >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}jt`;
  if (Math.abs(n) >= 1_000) return `${(n / 1_000).toFixed(0)}rb`;
  return String(Math.round(n));
}

function pct(part: number, total: number) {
  if (!total) return "—";
  return `${((part / total) * 100).toFixed(1)}%`;
}

function marginPct(netPL: number, revenue: number) {
  if (!revenue) return "—";
  return `${((netPL / revenue) * 100).toFixed(1)}%`;
}

const MONTH_LABELS = ["Jan","Feb","Mar","Apr","Mei","Jun","Jul","Agu","Sep","Okt","Nov","Des"];

const COMPANY_PALETTE = [
  { bg: "bg-indigo-500/10", text: "text-indigo-400", border: "border-indigo-500/30", dot: "#818cf8" },
  { bg: "bg-emerald-500/10", text: "text-emerald-400", border: "border-emerald-500/30", dot: "#34d399" },
  { bg: "bg-amber-500/10",  text: "text-amber-400",  border: "border-amber-500/30",  dot: "#fbbf24" },
  { bg: "bg-rose-500/10",   text: "text-rose-400",   border: "border-rose-500/30",   dot: "#f87171" },
  { bg: "bg-sky-500/10",    text: "text-sky-400",    border: "border-sky-500/30",    dot: "#38bdf8" },
  { bg: "bg-purple-500/10", text: "text-purple-400", border: "border-purple-500/30", dot: "#c084fc" },
];

interface CompanyMeta { companyId: number; companyName: string; companyCode: string; }
interface MonthEntry {
  month: string;
  byCompany: Record<number, { revenue: number; expense: number; netPL: number }>;
}
interface PLData { companies: CompanyMeta[]; months: MonthEntry[]; }
interface HoldingGroup { id: number; holding_name: string; holding_code: string; members: CompanyMeta[]; }

async function fetchGroups(): Promise<HoldingGroup[]> {
  const res = await fetch("/api/accounting/holding/groups", { credentials: "include" });
  if (!res.ok) throw new Error("Gagal memuat holding groups");
  return res.json();
}

async function fetchPLMonthly(from: string, to: string): Promise<PLData> {
  const params = new URLSearchParams({ holdingId: "1", from, to });
  const res = await fetch(`/api/accounting/holding/pl-monthly?${params}`, { credentials: "include" });
  if (!res.ok) throw new Error("Gagal memuat data P&L");
  return res.json();
}

async function fetchBreakdown(from: string, to: string) {
  const params = new URLSearchParams({ holdingId: "1", from, to });
  const res = await fetch(`/api/accounting/holding/breakdown?${params}`, { credentials: "include" });
  if (!res.ok) throw new Error("Gagal memuat breakdown");
  return res.json() as Promise<(CompanyMeta & { revenue: number; expense: number; netPL: number; cashBalance: number; receivable: number; payable: number })[]>;
}

const PERIOD_OPTIONS = [
  { label: "Tahunan (Jan–Des)", from: (y: number) => `${y}-01-01`, to: (y: number) => `${y}-12-31` },
  { label: "Q1 (Jan–Mar)",      from: (y: number) => `${y}-01-01`, to: (y: number) => `${y}-03-31` },
  { label: "Q2 (Apr–Jun)",      from: (y: number) => `${y}-04-01`, to: (y: number) => `${y}-06-30` },
  { label: "Q3 (Jul–Sep)",      from: (y: number) => `${y}-07-01`, to: (y: number) => `${y}-09-30` },
  { label: "Q4 (Okt–Des)",      from: (y: number) => `${y}-10-01`, to: (y: number) => `${y}-12-31` },
  { label: "Custom",            from: () => "", to: () => "" },
];

export default function HoldingPLReportPage() {
  const currentYear = new Date().getFullYear();
  const [year, setYear] = useState(currentYear);
  const [period, setPeriod] = useState("0");
  const [customFrom, setCustomFrom] = useState(`${currentYear}-01-01`);
  const [customTo, setCustomTo] = useState(`${currentYear}-12-31`);
  const [applied, setApplied] = useState({ from: `${currentYear}-01-01`, to: `${currentYear}-12-31` });
  const printRef = useRef<HTMLDivElement>(null);

  const isCustom = period === "5";
  const periodOpt = PERIOD_OPTIONS[Number(period)]!;

  function applyFilter() {
    if (isCustom) {
      setApplied({ from: customFrom, to: customTo });
    } else {
      setApplied({ from: periodOpt.from(year), to: periodOpt.to(year) });
    }
  }

  const { data: groups = [] } = useQuery({ queryKey: ["holding-groups"], queryFn: fetchGroups });
  const holdingName = groups[0]?.holding_name ?? "CST GROUP";
  const holdingCode = groups[0]?.holding_code ?? "CST-GROUP";

  const { data: plData, isLoading: loadingPL, refetch: refetchPL } = useQuery({
    queryKey: ["holding-pl-monthly", applied.from, applied.to],
    queryFn: () => fetchPLMonthly(applied.from, applied.to),
  });

  const { data: breakdown = [], isLoading: loadingBD, refetch: refetchBD } = useQuery({
    queryKey: ["holding-breakdown-pl", applied.from, applied.to],
    queryFn: () => fetchBreakdown(applied.from, applied.to),
  });

  const isLoading = loadingPL || loadingBD;
  const companies = plData?.companies ?? [];
  const months = plData?.months ?? [];

  function palette(idx: number) { return COMPANY_PALETTE[idx % COMPANY_PALETTE.length]!; }

  const totals = breakdown.reduce(
    (acc, b) => ({ revenue: acc.revenue + b.revenue, expense: acc.expense + b.expense, netPL: acc.netPL + b.netPL }),
    { revenue: 0, expense: 0, netPL: 0 },
  );

  function exportCSV() {
    const header = ["Bulan", ...companies.map((c) => `Revenue ${c.companyCode}`), ...companies.map((c) => `Expense ${c.companyCode}`), ...companies.map((c) => `NetPL ${c.companyCode}`), "Total Revenue", "Total Expense", "Total Net P&L"];
    const rows = months.map((m) => {
      const label = MONTH_LABELS[(Number(m.month.slice(5)) - 1)] + " " + m.month.slice(0, 4);
      const revs = companies.map((c) => m.byCompany[c.companyId]?.revenue ?? 0);
      const exps = companies.map((c) => m.byCompany[c.companyId]?.expense ?? 0);
      const nets = companies.map((c) => m.byCompany[c.companyId]?.netPL ?? 0);
      const tRev = revs.reduce((a, v) => a + v, 0);
      const tExp = exps.reduce((a, v) => a + v, 0);
      return [label, ...revs, ...exps, ...nets, tRev, tExp, tRev - tExp].join(",");
    });
    const csv = [header.join(","), ...rows].join("\n");
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `PL-${holdingCode}-${applied.from}-sd-${applied.to}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  }

  function handlePrint() {
    window.print();
  }

  const summaryCards = [
    { label: "Total Revenue",  value: totals.revenue, icon: TrendingUp,   color: "text-emerald-400", bg: "bg-emerald-500/10" },
    { label: "Total Expense",  value: totals.expense, icon: TrendingDown,  color: "text-rose-400",   bg: "bg-rose-500/10" },
    { label: "Net Profit/Loss", value: totals.netPL,  icon: Banknote, color: totals.netPL >= 0 ? "text-emerald-400" : "text-rose-400", bg: totals.netPL >= 0 ? "bg-emerald-500/10" : "bg-rose-500/10" },
    { label: "Net Margin",      value: null,           icon: Percent,       color: "text-sky-400",    bg: "bg-sky-500/10", extra: marginPct(totals.netPL, totals.revenue) },
  ];

  return (
    <AppShell>
      <style>{`@media print { .no-print { display: none !important; } body { background: white; color: black; } }`}</style>
      <div className="max-w-7xl mx-auto space-y-6" ref={printRef}>

        {/* Header */}
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
          <div className="flex items-center gap-4">
            <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-indigo-600/20 border border-indigo-500/30">
              <FileBarChart2 className="h-6 w-6 text-indigo-400" />
            </div>
            <div>
              <div className="flex items-center gap-2 flex-wrap">
                <Link href="/accounting"><Button variant="ghost" size="icon" aria-label="Kembali"><ArrowLeft className="h-4 w-4" /></Button></Link>

                <h1 className="text-2xl font-bold tracking-tight">Laporan Laba Rugi</h1>
                <Badge className="bg-indigo-600/20 text-indigo-300 border border-indigo-500/40 text-xs font-mono">
                  <Layers className="h-3 w-3 mr-1" /> {holdingName}
                </Badge>
              </div>
              <p className="text-muted-foreground text-sm mt-0.5">
                Konsolidasi P&L per perusahaan · {applied.from} s/d {applied.to}
              </p>
            </div>
          </div>
          <div className="flex items-center gap-2 shrink-0 no-print">
            <Button variant="outline" size="sm" onClick={() => { void refetchPL(); void refetchBD(); }} disabled={isLoading}>
              <RefreshCw className={`h-3.5 w-3.5 mr-1.5 ${isLoading ? "animate-spin" : ""}`} /> Refresh
            </Button>
            <Button variant="outline" size="sm" onClick={exportCSV} disabled={isLoading || months.length === 0}>
              <Download className="h-3.5 w-3.5 mr-1.5" /> CSV
            </Button>
            <Button variant="outline" size="sm" onClick={handlePrint}>
              <Printer className="h-3.5 w-3.5 mr-1.5" /> Print
            </Button>
          </div>
        </div>

        {/* Filter */}
        <div className="flex flex-wrap items-end gap-3 rounded-lg border border-border bg-card p-4 no-print">
          <div className="space-y-1">
            <Label className="text-xs text-muted-foreground">Tahun</Label>
            <Select value={String(year)} onValueChange={(v) => setYear(Number(v))} disabled={isCustom}>
              <SelectTrigger className="h-8 text-sm w-24"><SelectValue /></SelectTrigger>
              <SelectContent>
                {[currentYear + 1, currentYear, currentYear - 1, currentYear - 2, currentYear - 3].map((y) => (
                  <SelectItem key={y} value={String(y)}>{y}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1">
            <Label className="text-xs text-muted-foreground">Periode</Label>
            <Select value={period} onValueChange={setPeriod}>
              <SelectTrigger className="h-8 text-sm w-44"><SelectValue /></SelectTrigger>
              <SelectContent>
                {PERIOD_OPTIONS.map((opt, i) => (
                  <SelectItem key={i} value={String(i)}>{opt.label}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          {isCustom && (<>
            <div className="space-y-1">
              <Label className="text-xs text-muted-foreground">Dari</Label>
              <DatePicker value={customFrom} onChange={(v) => setCustomFrom(v)} className="h-8 text-sm w-40" />
            </div>
            <div className="space-y-1">
              <Label className="text-xs text-muted-foreground">Sampai</Label>
              <DatePicker value={customTo} onChange={(v) => setCustomTo(v)} className="h-8 text-sm w-40" />
            </div>
          </>)}
          <Button size="sm" className="h-8" onClick={applyFilter}>Terapkan</Button>
        </div>

        {/* Summary Cards */}
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
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
                    {isLoading ? (
                      <div className="h-5 w-28 rounded bg-muted animate-pulse mt-1" />
                    ) : (
                      <p className={`text-sm font-bold ${card.color} truncate`}>
                        {card.extra !== undefined ? card.extra : fmt(card.value ?? 0)}
                      </p>
                    )}
                  </div>
                </CardContent>
              </Card>
            );
          })}
        </div>

        {/* Company Legend */}
        {companies.length > 0 && (
          <div className="flex flex-wrap items-center gap-2">
            {companies.map((c, i) => (
              <span key={c.companyId} className={`inline-flex items-center gap-1.5 rounded-md border px-2 py-1 text-xs font-mono font-semibold ${palette(i).bg} ${palette(i).text} ${palette(i).border}`}>
                <span className="h-2 w-2 rounded-full" style={{ backgroundColor: palette(i).dot }} />
                {c.companyCode} — {c.companyName}
              </span>
            ))}
          </div>
        )}

        {/* Side-by-Side P&L Summary Table */}
        <Card className="border-border">
          <CardHeader className="pb-3">
            <CardTitle className="text-base">Perbandingan P&L per Perusahaan</CardTitle>
            <p className="text-xs text-muted-foreground">Periode: {applied.from} s/d {applied.to}</p>
          </CardHeader>
          <CardContent className="p-0">
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-border">
                    <th className="text-left px-4 py-3 text-xs font-semibold text-muted-foreground w-36">Keterangan</th>
                    {companies.map((c, i) => (
                      <th key={c.companyId} className="text-right px-4 py-3 text-xs font-semibold">
                        <span className={`${palette(i).text}`}>{c.companyCode}</span>
                        <span className="block text-[10px] text-muted-foreground font-normal">{c.companyName}</span>
                      </th>
                    ))}
                    <th className="text-right px-4 py-3 text-xs font-semibold text-muted-foreground">TOTAL</th>
                    <th className="text-right px-4 py-3 text-xs font-semibold text-muted-foreground">Kontribusi %</th>
                  </tr>
                </thead>
                <tbody>
                  {/* Revenue Row */}
                  <tr className="border-b border-border bg-emerald-500/5">
                    <td className="px-4 py-3 font-semibold text-emerald-400 text-xs uppercase tracking-wide">Revenue</td>
                    {companies.map((c) => {
                      const b = breakdown.find((x) => x.companyId === c.companyId);
                      return (
                        <td key={c.companyId} className="px-4 py-3 text-right font-mono text-sm text-emerald-400">
                          {isLoading ? <span className="inline-block h-4 w-24 rounded bg-muted animate-pulse" /> : fmt(b?.revenue ?? 0)}
                        </td>
                      );
                    })}
                    <td className="px-4 py-3 text-right font-mono font-bold text-emerald-400">
                      {isLoading ? <span className="inline-block h-4 w-24 rounded bg-muted animate-pulse" /> : fmt(totals.revenue)}
                    </td>
                    <td className="px-4 py-3 text-right text-xs text-muted-foreground">—</td>
                  </tr>
                  {/* Expense Row */}
                  <tr className="border-b border-border bg-rose-500/5">
                    <td className="px-4 py-3 font-semibold text-rose-400 text-xs uppercase tracking-wide">Expense</td>
                    {companies.map((c) => {
                      const b = breakdown.find((x) => x.companyId === c.companyId);
                      return (
                        <td key={c.companyId} className="px-4 py-3 text-right font-mono text-sm text-rose-400">
                          {isLoading ? <span className="inline-block h-4 w-24 rounded bg-muted animate-pulse" /> : fmt(b?.expense ?? 0)}
                        </td>
                      );
                    })}
                    <td className="px-4 py-3 text-right font-mono font-bold text-rose-400">
                      {isLoading ? <span className="inline-block h-4 w-24 rounded bg-muted animate-pulse" /> : fmt(totals.expense)}
                    </td>
                    <td className="px-4 py-3 text-right text-xs text-muted-foreground">—</td>
                  </tr>
                  {/* Net P&L Row */}
                  <tr className="border-b border-border">
                    <td className="px-4 py-3 font-bold text-xs uppercase tracking-wide">Net P&L</td>
                    {companies.map((c) => {
                      const b = breakdown.find((x) => x.companyId === c.companyId);
                      const net = b?.netPL ?? 0;
                      return (
                        <td key={c.companyId} className={`px-4 py-3 text-right font-mono font-semibold text-sm ${net >= 0 ? "text-emerald-400" : "text-rose-400"}`}>
                          {isLoading ? <span className="inline-block h-4 w-24 rounded bg-muted animate-pulse" /> : fmt(net)}
                        </td>
                      );
                    })}
                    <td className={`px-4 py-3 text-right font-mono font-bold ${totals.netPL >= 0 ? "text-emerald-400" : "text-rose-400"}`}>
                      {isLoading ? <span className="inline-block h-4 w-24 rounded bg-muted animate-pulse" /> : fmt(totals.netPL)}
                    </td>
                    <td className="px-4 py-3 text-right text-xs text-muted-foreground">—</td>
                  </tr>
                  {/* Margin Row */}
                  <tr className="border-b border-border bg-muted/20">
                    <td className="px-4 py-3 font-semibold text-sky-400 text-xs uppercase tracking-wide">Net Margin</td>
                    {companies.map((c) => {
                      const b = breakdown.find((x) => x.companyId === c.companyId);
                      return (
                        <td key={c.companyId} className="px-4 py-3 text-right text-xs text-sky-400">
                          {isLoading ? <span className="inline-block h-4 w-16 rounded bg-muted animate-pulse" /> : marginPct(b?.netPL ?? 0, b?.revenue ?? 0)}
                        </td>
                      );
                    })}
                    <td className="px-4 py-3 text-right text-xs font-bold text-sky-400">
                      {isLoading ? "" : marginPct(totals.netPL, totals.revenue)}
                    </td>
                    <td className="px-4 py-3 text-right text-xs text-muted-foreground">—</td>
                  </tr>
                  {/* Revenue Contribution Row */}
                  <tr>
                    <td className="px-4 py-3 font-semibold text-amber-400 text-xs uppercase tracking-wide">Revenue Share</td>
                    {companies.map((c) => {
                      const b = breakdown.find((x) => x.companyId === c.companyId);
                      return (
                        <td key={c.companyId} className="px-4 py-3 text-right text-xs text-amber-400">
                          {isLoading ? <span className="inline-block h-4 w-16 rounded bg-muted animate-pulse" /> : pct(b?.revenue ?? 0, totals.revenue)}
                        </td>
                      );
                    })}
                    <td className="px-4 py-3 text-right text-xs font-bold text-amber-400">100%</td>
                    <td className="px-4 py-3 text-right text-xs text-muted-foreground">—</td>
                  </tr>
                </tbody>
              </table>
            </div>
          </CardContent>
        </Card>

        {/* Monthly P&L Trend Table */}
        <Card className="border-border">
          <CardHeader className="pb-3">
            <CardTitle className="text-base">Tren Bulanan per Perusahaan</CardTitle>
            <p className="text-xs text-muted-foreground">Revenue dan Net P&L per bulan</p>
          </CardHeader>
          <CardContent className="p-0">
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-border">
                    <th className="text-left px-4 py-3 text-xs font-semibold text-muted-foreground sticky left-0 bg-card w-20">Bulan</th>
                    {companies.map((c, i) => (
                      <th key={c.companyId} colSpan={2} className={`text-center px-2 py-3 text-xs font-semibold border-l border-border ${palette(i).text}`}>
                        {c.companyCode}
                      </th>
                    ))}
                    <th colSpan={2} className="text-center px-2 py-3 text-xs font-semibold text-muted-foreground border-l border-border">TOTAL</th>
                  </tr>
                  <tr className="border-b border-border">
                    <th className="px-4 py-2 sticky left-0 bg-card" />
                    {companies.map((c) => (<>
                      <th key={`${c.companyId}-rev`} className="px-3 py-2 text-right text-[10px] text-emerald-400 font-medium border-l border-border">Revenue</th>
                      <th key={`${c.companyId}-net`} className="px-3 py-2 text-right text-[10px] text-foreground/60 font-medium">Net P&L</th>
                    </>))}
                    <th className="px-3 py-2 text-right text-[10px] text-emerald-400 font-medium border-l border-border">Revenue</th>
                    <th className="px-3 py-2 text-right text-[10px] text-foreground/60 font-medium">Net P&L</th>
                  </tr>
                </thead>
                <tbody>
                  {isLoading ? (
                    Array.from({ length: 6 }).map((_, i) => (
                      <tr key={i} className="border-b border-border">
                        {Array.from({ length: companies.length * 2 + 3 }).map((_, j) => (
                          <td key={j} className="px-3 py-2.5">
                            <div className="h-4 rounded bg-muted animate-pulse" />
                          </td>
                        ))}
                      </tr>
                    ))
                  ) : months.length === 0 ? (
                    <tr>
                      <td colSpan={companies.length * 2 + 3} className="px-4 py-8 text-center text-muted-foreground text-sm">
                        Belum ada data P&L untuk periode ini
                      </td>
                    </tr>
                  ) : (
                    months.map((m, rowIdx) => {
                      const monthIdx = Number(m.month.slice(5)) - 1;
                      const monthLabel = (MONTH_LABELS[monthIdx] ?? m.month.slice(5)) + " " + m.month.slice(0, 4);
                      let totalRev = 0; let totalNet = 0;
                      companies.forEach((c) => {
                        totalRev += m.byCompany[c.companyId]?.revenue ?? 0;
                        totalNet += m.byCompany[c.companyId]?.netPL ?? 0;
                      });
                      return (
                        <tr key={m.month} className={`border-b border-border last:border-0 ${rowIdx % 2 === 0 ? "" : "bg-muted/20"} hover:bg-muted/40 transition-colors`}>
                          <td className="px-4 py-2.5 font-medium text-xs sticky left-0 bg-inherit whitespace-nowrap">{monthLabel}</td>
                          {companies.map((c) => {
                            const d = m.byCompany[c.companyId];
                            const rev = d?.revenue ?? 0;
                            const net = d?.netPL ?? 0;
                            return (<>
                              <td key={`${c.companyId}-rev`} className="px-3 py-2.5 text-right font-mono text-xs text-emerald-400 border-l border-border whitespace-nowrap">
                                {rev > 0 ? fmtShort(rev) : <span className="text-muted-foreground/40">—</span>}
                              </td>
                              <td key={`${c.companyId}-net`} className={`px-3 py-2.5 text-right font-mono text-xs whitespace-nowrap ${net > 0 ? "text-sky-400" : net < 0 ? "text-rose-400" : "text-muted-foreground/40"}`}>
                                {net !== 0 ? fmtShort(net) : "—"}
                              </td>
                            </>);
                          })}
                          <td className="px-3 py-2.5 text-right font-mono text-xs font-semibold text-emerald-400 border-l border-border whitespace-nowrap">
                            {totalRev > 0 ? fmt(totalRev) : <span className="text-muted-foreground/40">—</span>}
                          </td>
                          <td className={`px-3 py-2.5 text-right font-mono text-xs font-semibold whitespace-nowrap ${totalNet > 0 ? "text-sky-400" : totalNet < 0 ? "text-rose-400" : "text-muted-foreground/40"}`}>
                            {totalNet !== 0 ? fmt(totalNet) : "—"}
                          </td>
                        </tr>
                      );
                    })
                  )}
                </tbody>
                {!isLoading && months.length > 0 && (
                  <tfoot>
                    <tr className="border-t-2 border-border bg-muted/40">
                      <td className="px-4 py-3 font-bold text-xs uppercase tracking-wide text-muted-foreground sticky left-0 bg-muted/40">Total</td>
                      {companies.map((c) => {
                        const b = breakdown.find((x) => x.companyId === c.companyId);
                        const rev = b?.revenue ?? 0;
                        const net = b?.netPL ?? 0;
                        return (<>
                          <td key={`${c.companyId}-rev`} className="px-3 py-3 text-right font-mono font-bold text-sm text-emerald-400 border-l border-border whitespace-nowrap">{fmt(rev)}</td>
                          <td key={`${c.companyId}-net`} className={`px-3 py-3 text-right font-mono font-bold text-sm whitespace-nowrap ${net >= 0 ? "text-sky-400" : "text-rose-400"}`}>{fmt(net)}</td>
                        </>);
                      })}
                      <td className="px-3 py-3 text-right font-mono font-bold text-sm text-emerald-400 border-l border-border whitespace-nowrap">{fmt(totals.revenue)}</td>
                      <td className={`px-3 py-3 text-right font-mono font-bold text-sm whitespace-nowrap ${totals.netPL >= 0 ? "text-sky-400" : "text-rose-400"}`}>{fmt(totals.netPL)}</td>
                    </tr>
                  </tfoot>
                )}
              </table>
            </div>
          </CardContent>
        </Card>

        <p className="text-xs text-muted-foreground text-center pb-2">
          Data berdasarkan jurnal yang telah diposting (status: posted). Holding membaca dan menggabungkan data dari semua perusahaan anggota secara otomatis.
        </p>
      </div>
    </AppShell>
  );
}
