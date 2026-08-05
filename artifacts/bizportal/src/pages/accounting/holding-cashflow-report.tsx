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
  ArrowDownToLine,
  ArrowUpFromLine,
  Banknote,
  Building2,
  Download,
  Layers,
  Printer,
  RefreshCw,
  TrendingDown,
  TrendingUp,
  Wallet,
  ArrowLeft,
} from "lucide-react";
import {
  ComposedChart,
  Bar,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
  ResponsiveContainer,
  ReferenceLine,
  Cell,
  PieChart,
  Pie,
} from "recharts";
import { Link } from "wouter";

function fmt(n: number) {
  return new Intl.NumberFormat("id-ID", {
    style: "currency",
    currency: "IDR",
    maximumFractionDigits: 0,
  }).format(n);
}

function fmtShort(n: number) {
  const abs = Math.abs(n);
  const sign = n < 0 ? "-" : "";
  if (abs >= 1_000_000_000) return `${sign}${(abs / 1_000_000_000).toFixed(1)}M`;
  if (abs >= 1_000_000) return `${sign}${(abs / 1_000_000).toFixed(1)}jt`;
  if (abs >= 1_000) return `${sign}${(abs / 1_000).toFixed(0)}rb`;
  return String(Math.round(n));
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

const PERIOD_OPTIONS = [
  { label: "Tahunan (Jan–Des)", from: (y: number) => `${y}-01-01`, to: (y: number) => `${y}-12-31` },
  { label: "Q1 (Jan–Mar)",      from: (y: number) => `${y}-01-01`, to: (y: number) => `${y}-03-31` },
  { label: "Q2 (Apr–Jun)",      from: (y: number) => `${y}-04-01`, to: (y: number) => `${y}-06-30` },
  { label: "Q3 (Jul–Sep)",      from: (y: number) => `${y}-07-01`, to: (y: number) => `${y}-09-30` },
  { label: "Q4 (Okt–Des)",      from: (y: number) => `${y}-10-01`, to: (y: number) => `${y}-12-31` },
  { label: "Custom",            from: () => "", to: () => "" },
];

interface CompanyMeta { companyId: number; companyName: string; companyCode: string; }

interface MonthCashflow {
  opInflow: number;
  opOutflow: number;
  opNet: number;
  invNet: number;
  finNet: number;
  cashChange: number;
  endingCash: number;
}

interface CashflowMonth {
  month: string;
  byCompany: Record<number, MonthCashflow>;
}

interface CashflowData {
  companies: CompanyMeta[];
  months: CashflowMonth[];
}

interface HoldingGroup { id: number; holding_name: string; holding_code: string; members: CompanyMeta[]; }

async function fetchGroups(): Promise<HoldingGroup[]> {
  const res = await fetch("/api/accounting/holding/groups", { credentials: "include" });
  if (!res.ok) throw new Error("Gagal memuat holding groups");
  return res.json();
}

async function fetchCashflow(from: string, to: string): Promise<CashflowData> {
  const params = new URLSearchParams({ holdingId: "1", from, to });
  const res = await fetch(`/api/accounting/holding/cashflow-monthly?${params}`, { credentials: "include" });
  if (!res.ok) throw new Error("Gagal memuat data cashflow");
  return res.json();
}

export default function HoldingCashflowReportPage() {
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

  const { data, isLoading, refetch } = useQuery({
    queryKey: ["holding-cashflow-monthly", applied.from, applied.to],
    queryFn: () => fetchCashflow(applied.from, applied.to),
  });

  const companies = data?.companies ?? [];
  const months = data?.months ?? [];

  function palette(idx: number) { return COMPANY_PALETTE[idx % COMPANY_PALETTE.length]!; }

  // Hitung totals konsolidasi per bulan
  const consolidatedMonths = months.map((m) => {
    let opInflow = 0, opOutflow = 0, opNet = 0, invNet = 0, finNet = 0, cashChange = 0;
    companies.forEach((c) => {
      const d = m.byCompany[c.companyId];
      if (d) {
        opInflow += d.opInflow;
        opOutflow += d.opOutflow;
        opNet += d.opNet;
        invNet += d.invNet;
        finNet += d.finNet;
        cashChange += d.cashChange;
      }
    });
    return { month: m.month, opInflow, opOutflow, opNet, invNet, finNet, cashChange };
  });

  const grandTotal = consolidatedMonths.reduce(
    (acc, m) => ({
      opInflow: acc.opInflow + m.opInflow,
      opOutflow: acc.opOutflow + m.opOutflow,
      opNet: acc.opNet + m.opNet,
      invNet: acc.invNet + m.invNet,
      finNet: acc.finNet + m.finNet,
      cashChange: acc.cashChange + m.cashChange,
    }),
    { opInflow: 0, opOutflow: 0, opNet: 0, invNet: 0, finNet: 0, cashChange: 0 },
  );

  // Per-perusahaan totals
  const companyTotals = companies.map((c) => {
    return months.reduce(
      (acc, m) => {
        const d = m.byCompany[c.companyId];
        return {
          opInflow: acc.opInflow + (d?.opInflow ?? 0),
          opOutflow: acc.opOutflow + (d?.opOutflow ?? 0),
          opNet: acc.opNet + (d?.opNet ?? 0),
          invNet: acc.invNet + (d?.invNet ?? 0),
          finNet: acc.finNet + (d?.finNet ?? 0),
          cashChange: acc.cashChange + (d?.cashChange ?? 0),
          endingCash: d?.endingCash ?? 0,
        };
      },
      { opInflow: 0, opOutflow: 0, opNet: 0, invNet: 0, finNet: 0, cashChange: 0, endingCash: 0 },
    );
  });

  function exportCSV() {
    const sections = [
      `Laporan Arus Kas — ${holdingName}`,
      `Periode: ${applied.from} s/d ${applied.to}`,
      ``,
      `=== KONSOLIDASI BULANAN ===`,
      ["Bulan", "Op. Masuk", "Op. Keluar", "Net Operasi", "Net Investasi", "Net Pendanaan", "Perubahan Kas"].join(","),
      ...consolidatedMonths.map((m) => {
        const mIdx = Number(m.month.slice(5)) - 1;
        const label = (MONTH_LABELS[mIdx] ?? m.month.slice(5)) + " " + m.month.slice(0, 4);
        return [label, m.opInflow, m.opOutflow, m.opNet, m.invNet, m.finNet, m.cashChange].join(",");
      }),
      ``,
      `=== BREAKDOWN PER PERUSAHAAN ===`,
      ["Perusahaan", "Op. Masuk", "Op. Keluar", "Net Operasi", "Net Investasi", "Net Pendanaan", "Total Perubahan Kas", "Saldo Akhir Kas"].join(","),
      ...companies.map((c, i) => {
        const t = companyTotals[i]!;
        return [`${c.companyCode} - ${c.companyName}`, t.opInflow, t.opOutflow, t.opNet, t.invNet, t.finNet, t.cashChange, t.endingCash].join(",");
      }),
    ];
    const blob = new Blob([sections.join("\n")], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `CashflowHolding-${holdingCode}-${applied.from}-sd-${applied.to}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  }

  const summaryCards = [
    { label: "Total Kas Masuk Operasi", value: grandTotal.opInflow,  icon: ArrowDownToLine, color: "text-emerald-400", bg: "bg-emerald-500/10" },
    { label: "Total Kas Keluar Operasi", value: grandTotal.opOutflow, icon: ArrowUpFromLine,  color: "text-rose-400",   bg: "bg-rose-500/10" },
    { label: "Net Arus Operasi",          value: grandTotal.opNet,    icon: TrendingUp,      color: grandTotal.opNet >= 0 ? "text-emerald-400" : "text-rose-400", bg: grandTotal.opNet >= 0 ? "bg-emerald-500/10" : "bg-rose-500/10" },
    { label: "Net Arus Investasi",         value: grandTotal.invNet,   icon: Building2,       color: grandTotal.invNet >= 0 ? "text-sky-400" : "text-amber-400",  bg: grandTotal.invNet >= 0 ? "bg-sky-500/10" : "bg-amber-500/10" },
    { label: "Net Arus Pendanaan",         value: grandTotal.finNet,   icon: Wallet,          color: "text-purple-400", bg: "bg-purple-500/10" },
    { label: "Total Perubahan Kas Bersih", value: grandTotal.cashChange, icon: Banknote, color: grandTotal.cashChange >= 0 ? "text-emerald-400" : "text-rose-400", bg: grandTotal.cashChange >= 0 ? "bg-emerald-500/10" : "bg-rose-500/10" },
  ];

  const cashflowColor = (n: number) => n >= 0 ? "text-emerald-400" : "text-rose-400";

  // Data untuk chart
  const chartData = consolidatedMonths.map((m) => {
    const mIdx = Number(m.month.slice(5)) - 1;
    const label = (MONTH_LABELS[mIdx] ?? m.month.slice(5)) + "\n" + m.month.slice(2, 4);
    return {
      name: label,
      opNet: m.opNet,
      invNet: m.invNet,
      finNet: m.finNet,
      cashChange: m.cashChange,
    };
  });

  // Kumulatif kas (line chart)
  let cumulative = 0;
  const trendData = consolidatedMonths.map((m) => {
    cumulative += m.cashChange;
    const mIdx = Number(m.month.slice(5)) - 1;
    return {
      name: (MONTH_LABELS[mIdx] ?? m.month.slice(5)) + "\n" + m.month.slice(2, 4),
      operasi: m.opNet,
      investasi: m.invNet,
      pendanaan: m.finNet,
      kasKumulatif: cumulative,
    };
  });

  function fmtAxis(n: number) {
    const abs = Math.abs(n);
    const sign = n < 0 ? "-" : "";
    if (abs >= 1_000_000_000) return `${sign}${(abs / 1_000_000_000).toFixed(1)}M`;
    if (abs >= 1_000_000) return `${sign}${(abs / 1_000_000).toFixed(0)}jt`;
    if (abs >= 1_000) return `${sign}${(abs / 1_000).toFixed(0)}rb`;
    return String(Math.round(n));
  }

  const CustomTooltip = ({ active, payload, label }: { active?: boolean; payload?: { name: string; value: number; color: string }[]; label?: string }) => {
    if (!active || !payload || payload.length === 0) return null;
    return (
      <div className="rounded-lg border border-border bg-popover/95 backdrop-blur-sm p-3 shadow-xl text-xs min-w-[180px]">
        <p className="font-semibold text-foreground mb-2 whitespace-pre-line">{label}</p>
        {payload.map((p) => (
          <div key={p.name} className="flex items-center justify-between gap-4 py-0.5">
            <span className="flex items-center gap-1.5">
              <span className="h-2 w-2 rounded-full inline-block shrink-0" style={{ backgroundColor: p.color }} />
              <span className="text-muted-foreground">{p.name}</span>
            </span>
            <span className={`font-mono font-semibold ${p.value >= 0 ? "text-emerald-400" : "text-rose-400"}`}>
              {fmt(p.value)}
            </span>
          </div>
        ))}
      </div>
    );
  };

  return (
    <AppShell>
      <style>{`@media print { .no-print { display: none !important; } body { background: white; color: black; } }`}</style>
      <div className="max-w-7xl mx-auto space-y-6" ref={printRef}>

        {/* Header */}
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
          <div className="flex items-center gap-4">
            <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-cyan-600/20 border border-cyan-500/30">
              <TrendingDown className="h-6 w-6 text-cyan-400" />
            </div>
            <div>
              <div className="flex items-center gap-2 flex-wrap">
                <Link href="/accounting"><Button variant="ghost" size="icon" aria-label="Kembali"><ArrowLeft className="h-4 w-4" /></Button></Link>

                <h1 className="text-2xl font-bold tracking-tight">Laporan Arus Kas</h1>
                <Badge className="bg-indigo-600/20 text-indigo-300 border border-indigo-500/40 text-xs font-mono">
                  <Layers className="h-3 w-3 mr-1" /> {holdingName}
                </Badge>
              </div>
              <p className="text-muted-foreground text-sm mt-0.5">
                Cashflow konsolidasi — Operasi · Investasi · Pendanaan per perusahaan
              </p>
            </div>
          </div>
          <div className="flex items-center gap-2 shrink-0 no-print">
            <Button variant="outline" size="sm" onClick={() => void refetch()} disabled={isLoading}>
              <RefreshCw className={`h-3.5 w-3.5 mr-1.5 ${isLoading ? "animate-spin" : ""}`} /> Refresh
            </Button>
            <Button variant="outline" size="sm" onClick={exportCSV} disabled={isLoading || months.length === 0}>
              <Download className="h-3.5 w-3.5 mr-1.5" /> CSV
            </Button>
            <Button variant="outline" size="sm" onClick={() => window.print()}>
              <Printer className="h-3.5 w-3.5 mr-1.5" /> Print
            </Button>
          </div>
        </div>

        {/* Filter Bar */}
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
        <div className="grid grid-cols-2 lg:grid-cols-3 xl:grid-cols-6 gap-3">
          {summaryCards.map((card) => {
            const Icon = card.icon;
            return (
              <Card key={card.label} className="border-border">
                <CardContent className="p-3 flex flex-col gap-2">
                  <div className={`flex h-8 w-8 items-center justify-center rounded-lg ${card.bg}`}>
                    <Icon className={`h-4 w-4 ${card.color}`} />
                  </div>
                  <div>
                    <p className="text-[10px] text-muted-foreground leading-tight">{card.label}</p>
                    {isLoading ? (
                      <div className="h-4 w-20 rounded bg-muted animate-pulse mt-1" />
                    ) : (
                      <p className={`text-sm font-bold ${card.color} mt-0.5`}>
                        {fmtShort(card.value)}
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

        {/* Charts */}
        {!isLoading && trendData.length > 0 && (
          <div className="grid grid-cols-1 xl:grid-cols-2 gap-4">

            {/* Chart 1: Grouped Bar — Operasi / Investasi / Pendanaan */}
            <Card className="border-border">
              <CardHeader className="pb-2">
                <CardTitle className="text-sm font-semibold">Tren Arus Kas per Kategori</CardTitle>
                <p className="text-xs text-muted-foreground">Net Operasi · Investasi · Pendanaan per bulan (konsolidasi)</p>
              </CardHeader>
              <CardContent className="pt-0 pb-4">
                <ResponsiveContainer width="100%" height={260}>
                  <ComposedChart data={trendData} barCategoryGap="25%" barGap={2} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.06)" vertical={false} />
                    <XAxis
                      dataKey="name"
                      tick={{ fill: "#9ca3af", fontSize: 10 }}
                      axisLine={false}
                      tickLine={false}
                    />
                    <YAxis
                      tickFormatter={fmtAxis}
                      tick={{ fill: "#9ca3af", fontSize: 10 }}
                      axisLine={false}
                      tickLine={false}
                      width={48}
                    />
                    <ReferenceLine y={0} stroke="rgba(255,255,255,0.15)" strokeDasharray="4 2" />
                    <Tooltip content={<CustomTooltip />} cursor={{ fill: "rgba(255,255,255,0.04)" }} />
                    <Legend
                      wrapperStyle={{ fontSize: 11, paddingTop: 8 }}
                      formatter={(v) => <span style={{ color: "#9ca3af" }}>{v}</span>}
                    />
                    <Bar dataKey="operasi" name="Net Operasi" radius={[3, 3, 0, 0]} maxBarSize={18}>
                      {trendData.map((entry, i) => (
                        <Cell key={i} fill={entry.operasi >= 0 ? "#34d399" : "#f87171"} fillOpacity={0.85} />
                      ))}
                    </Bar>
                    <Bar dataKey="investasi" name="Net Investasi" fill="#38bdf8" fillOpacity={0.75} radius={[3, 3, 0, 0]} maxBarSize={18}>
                      {trendData.map((entry, i) => (
                        <Cell key={i} fill={entry.investasi >= 0 ? "#38bdf8" : "#fb923c"} fillOpacity={0.75} />
                      ))}
                    </Bar>
                    <Bar dataKey="pendanaan" name="Net Pendanaan" fill="#c084fc" fillOpacity={0.75} radius={[3, 3, 0, 0]} maxBarSize={18}>
                      {trendData.map((entry, i) => (
                        <Cell key={i} fill={entry.pendanaan >= 0 ? "#c084fc" : "#f472b6"} fillOpacity={0.75} />
                      ))}
                    </Bar>
                  </ComposedChart>
                </ResponsiveContainer>
              </CardContent>
            </Card>

            {/* Chart 2: ComposedChart — Bar cashChange + Line kumulatif */}
            <Card className="border-border">
              <CardHeader className="pb-2">
                <CardTitle className="text-sm font-semibold">Perubahan & Akumulasi Kas Bersih</CardTitle>
                <p className="text-xs text-muted-foreground">Batang = Δ kas tiap bulan · Garis = Akumulasi saldo kas</p>
              </CardHeader>
              <CardContent className="pt-0 pb-4">
                <ResponsiveContainer width="100%" height={260}>
                  <ComposedChart data={trendData} barCategoryGap="30%" margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.06)" vertical={false} />
                    <XAxis
                      dataKey="name"
                      tick={{ fill: "#9ca3af", fontSize: 10 }}
                      axisLine={false}
                      tickLine={false}
                    />
                    <YAxis
                      yAxisId="left"
                      tickFormatter={fmtAxis}
                      tick={{ fill: "#9ca3af", fontSize: 10 }}
                      axisLine={false}
                      tickLine={false}
                      width={48}
                    />
                    <YAxis
                      yAxisId="right"
                      orientation="right"
                      tickFormatter={fmtAxis}
                      tick={{ fill: "#9ca3af", fontSize: 10 }}
                      axisLine={false}
                      tickLine={false}
                      width={48}
                    />
                    <ReferenceLine yAxisId="left" y={0} stroke="rgba(255,255,255,0.15)" strokeDasharray="4 2" />
                    <Tooltip content={<CustomTooltip />} cursor={{ fill: "rgba(255,255,255,0.04)" }} />
                    <Legend
                      wrapperStyle={{ fontSize: 11, paddingTop: 8 }}
                      formatter={(v) => <span style={{ color: "#9ca3af" }}>{v}</span>}
                    />
                    <Bar yAxisId="left" dataKey="operasi" name="Δ Kas Operasi" radius={[3, 3, 0, 0]} maxBarSize={24}>
                      {trendData.map((entry, i) => (
                        <Cell key={i} fill={entry.operasi >= 0 ? "#34d399" : "#f87171"} fillOpacity={0.8} />
                      ))}
                    </Bar>
                    <Line
                      yAxisId="right"
                      type="monotone"
                      dataKey="kasKumulatif"
                      name="Akumulasi Kas"
                      stroke="#facc15"
                      strokeWidth={2}
                      dot={{ fill: "#facc15", r: 3, strokeWidth: 0 }}
                      activeDot={{ r: 5, fill: "#facc15" }}
                    />
                  </ComposedChart>
                </ResponsiveContainer>
              </CardContent>
            </Card>

          </div>
        )}

        {/* Donut Chart — Kontribusi per Perusahaan */}
        {!isLoading && companies.length > 1 && companyTotals.some((t) => t.opNet !== 0) && (
          <Card className="border-border">
            <CardHeader className="pb-2">
              <CardTitle className="text-sm font-semibold">Kontribusi Arus Kas Operasi per Perusahaan</CardTitle>
              <p className="text-xs text-muted-foreground">
                Porsi masing-masing perusahaan terhadap total net arus operasi periode · {applied.from} s/d {applied.to}
              </p>
            </CardHeader>
            <CardContent className="pb-5">
              <div className="flex flex-col lg:flex-row items-center gap-6">
                {/* Donut */}
                <div className="shrink-0">
                  <ResponsiveContainer width={260} height={260}>
                    <PieChart>
                      <Pie
                        data={(() => {
                          const raw = companies.map((c, i) => ({
                            name: c.companyCode,
                            fullName: c.companyName,
                            value: Math.abs(companyTotals[i]?.opNet ?? 0),
                            raw: companyTotals[i]?.opNet ?? 0,
                            color: COMPANY_PALETTE[i % COMPANY_PALETTE.length]!.dot,
                          })).filter((d) => d.value > 0);
                          return raw;
                        })()}
                        cx="50%"
                        cy="50%"
                        innerRadius={72}
                        outerRadius={110}
                        paddingAngle={3}
                        dataKey="value"
                        strokeWidth={0}
                      >
                        {companies.map((c, i) => (
                          <Cell
                            key={c.companyId}
                            fill={COMPANY_PALETTE[i % COMPANY_PALETTE.length]!.dot}
                            fillOpacity={0.9}
                          />
                        ))}
                      </Pie>
                      <Tooltip
                        content={({ active, payload }) => {
                          if (!active || !payload?.length) return null;
                          const d = payload[0]!.payload as {
                            name: string; fullName: string; value: number; raw: number; color: string;
                          };
                          const totalAbs = companyTotals.reduce((s, t) => s + Math.abs(t.opNet), 0);
                          const pct = totalAbs > 0 ? ((d.value / totalAbs) * 100).toFixed(1) : "0";
                          return (
                            <div className="rounded-lg border border-border bg-popover/95 backdrop-blur-sm p-3 shadow-xl text-xs min-w-[180px]">
                              <div className="flex items-center gap-1.5 mb-2">
                                <span className="h-2.5 w-2.5 rounded-full shrink-0" style={{ backgroundColor: d.color }} />
                                <span className="font-semibold text-foreground">{d.name} — {d.fullName}</span>
                              </div>
                              <div className="flex justify-between gap-4">
                                <span className="text-muted-foreground">Net Operasi</span>
                                <span className={`font-mono font-semibold ${d.raw >= 0 ? "text-emerald-400" : "text-rose-400"}`}>
                                  {fmt(d.raw)}
                                </span>
                              </div>
                              <div className="flex justify-between gap-4 mt-1">
                                <span className="text-muted-foreground">Kontribusi</span>
                                <span className="font-mono font-bold text-foreground">{pct}%</span>
                              </div>
                            </div>
                          );
                        }}
                      />
                    </PieChart>
                  </ResponsiveContainer>
                </div>

                {/* Legend + stats */}
                <div className="flex-1 w-full space-y-2">
                  {(() => {
                    const totalAbs = companyTotals.reduce((s, t) => s + Math.abs(t.opNet), 0);
                    const sorted = companies
                      .map((c, i) => ({ c, t: companyTotals[i]!, i }))
                      .filter(({ t }) => t.opNet !== 0)
                      .sort((a, b) => Math.abs(b.t.opNet) - Math.abs(a.t.opNet));
                    return sorted.map(({ c, t, i }) => {
                      const pct = totalAbs > 0 ? (Math.abs(t.opNet) / totalAbs) * 100 : 0;
                      const pal = COMPANY_PALETTE[i % COMPANY_PALETTE.length]!;
                      return (
                        <div key={c.companyId} className="flex items-center gap-3">
                          <span
                            className={`inline-flex shrink-0 items-center justify-center rounded-md px-1.5 py-0.5 text-xs font-mono font-semibold border ${pal.bg} ${pal.text} ${pal.border}`}
                          >
                            {c.companyCode}
                          </span>
                          <div className="flex-1 min-w-0">
                            <div className="flex items-center justify-between mb-0.5 gap-2">
                              <span className="text-xs text-muted-foreground truncate">{c.companyName}</span>
                              <span className={`text-xs font-mono font-semibold shrink-0 ${t.opNet >= 0 ? "text-emerald-400" : "text-rose-400"}`}>
                                {fmtShort(t.opNet)}
                              </span>
                            </div>
                            {/* Progress bar */}
                            <div className="h-1.5 rounded-full bg-muted overflow-hidden">
                              <div
                                className="h-full rounded-full transition-all duration-500"
                                style={{ width: `${pct.toFixed(1)}%`, backgroundColor: pal.dot, opacity: 0.85 }}
                              />
                            </div>
                            <p className="text-[10px] text-muted-foreground/60 mt-0.5">{pct.toFixed(1)}%</p>
                          </div>
                        </div>
                      );
                    });
                  })()}
                </div>
              </div>
            </CardContent>
          </Card>
        )}

        {/* Tabel Konsolidasi Bulanan */}
        <Card className="border-border">
          <CardHeader className="pb-3">
            <CardTitle className="text-base">Arus Kas Konsolidasi Bulanan</CardTitle>
            <p className="text-xs text-muted-foreground">Gabungan seluruh perusahaan dalam grup · {applied.from} s/d {applied.to}</p>
          </CardHeader>
          <CardContent className="p-0">
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-border">
                    <th className="text-left px-4 py-3 text-xs font-semibold text-muted-foreground sticky left-0 bg-card">Bulan</th>
                    <th className="text-right px-3 py-3 text-xs font-semibold text-emerald-400">Kas Masuk Operasi</th>
                    <th className="text-right px-3 py-3 text-xs font-semibold text-rose-400">Kas Keluar Operasi</th>
                    <th className="text-right px-3 py-3 text-xs font-semibold text-foreground/70 border-l border-border">Net Operasi</th>
                    <th className="text-right px-3 py-3 text-xs font-semibold text-sky-400 border-l border-border">Net Investasi</th>
                    <th className="text-right px-3 py-3 text-xs font-semibold text-purple-400 border-l border-border">Net Pendanaan</th>
                    <th className="text-right px-3 py-3 text-xs font-semibold text-cyan-400 border-l border-border">Δ Kas Bersih</th>
                  </tr>
                </thead>
                <tbody>
                  {isLoading ? (
                    Array.from({ length: 6 }).map((_, i) => (
                      <tr key={i} className="border-b border-border">
                        {Array.from({ length: 7 }).map((_, j) => (
                          <td key={j} className="px-3 py-2.5">
                            <div className="h-4 rounded bg-muted animate-pulse" />
                          </td>
                        ))}
                      </tr>
                    ))
                  ) : consolidatedMonths.length === 0 ? (
                    <tr>
                      <td colSpan={7} className="px-4 py-8 text-center text-muted-foreground text-sm">
                        Belum ada data arus kas untuk periode ini
                      </td>
                    </tr>
                  ) : (
                    consolidatedMonths.map((m, idx) => {
                      const mIdx = Number(m.month.slice(5)) - 1;
                      const label = (MONTH_LABELS[mIdx] ?? m.month.slice(5)) + " " + m.month.slice(0, 4);
                      return (
                        <tr key={m.month} className={`border-b border-border last:border-0 ${idx % 2 === 0 ? "" : "bg-muted/20"} hover:bg-muted/40 transition-colors`}>
                          <td className="px-4 py-2.5 font-medium text-sm sticky left-0 bg-inherit">{label}</td>
                          <td className="px-3 py-2.5 text-right font-mono text-xs text-emerald-400">{m.opInflow > 0 ? fmt(m.opInflow) : "—"}</td>
                          <td className="px-3 py-2.5 text-right font-mono text-xs text-rose-400">{m.opOutflow > 0 ? fmt(m.opOutflow) : "—"}</td>
                          <td className={`px-3 py-2.5 text-right font-mono text-xs font-semibold border-l border-border ${cashflowColor(m.opNet)}`}>{fmt(m.opNet)}</td>
                          <td className={`px-3 py-2.5 text-right font-mono text-xs border-l border-border ${cashflowColor(m.invNet)}`}>{m.invNet !== 0 ? fmt(m.invNet) : "—"}</td>
                          <td className={`px-3 py-2.5 text-right font-mono text-xs border-l border-border ${cashflowColor(m.finNet)}`}>{m.finNet !== 0 ? fmt(m.finNet) : "—"}</td>
                          <td className={`px-3 py-2.5 text-right font-mono text-xs font-bold border-l border-border ${cashflowColor(m.cashChange)}`}>{fmt(m.cashChange)}</td>
                        </tr>
                      );
                    })
                  )}
                </tbody>
                {!isLoading && consolidatedMonths.length > 0 && (
                  <tfoot>
                    <tr className="border-t-2 border-border bg-muted/40">
                      <td className="px-4 py-3 font-semibold text-xs uppercase tracking-wide text-muted-foreground">Total Periode</td>
                      <td className="px-3 py-3 text-right font-mono font-bold text-emerald-400 text-xs">{fmt(grandTotal.opInflow)}</td>
                      <td className="px-3 py-3 text-right font-mono font-bold text-rose-400 text-xs">{fmt(grandTotal.opOutflow)}</td>
                      <td className={`px-3 py-3 text-right font-mono font-bold text-xs border-l border-border ${cashflowColor(grandTotal.opNet)}`}>{fmt(grandTotal.opNet)}</td>
                      <td className={`px-3 py-3 text-right font-mono font-bold text-xs border-l border-border ${cashflowColor(grandTotal.invNet)}`}>{fmt(grandTotal.invNet)}</td>
                      <td className={`px-3 py-3 text-right font-mono font-bold text-xs border-l border-border ${cashflowColor(grandTotal.finNet)}`}>{fmt(grandTotal.finNet)}</td>
                      <td className={`px-3 py-3 text-right font-mono font-bold text-xs border-l border-border ${cashflowColor(grandTotal.cashChange)}`}>{fmt(grandTotal.cashChange)}</td>
                    </tr>
                  </tfoot>
                )}
              </table>
            </div>
          </CardContent>
        </Card>

        {/* Tabel Breakdown per Perusahaan */}
        <Card className="border-border">
          <CardHeader className="pb-3">
            <CardTitle className="text-base">Ringkasan Arus Kas per Perusahaan</CardTitle>
            <p className="text-xs text-muted-foreground">Total akumulasi seluruh periode yang dipilih</p>
          </CardHeader>
          <CardContent className="p-0">
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-border">
                    <th className="text-left px-4 py-3 text-xs font-semibold text-muted-foreground">Perusahaan</th>
                    <th className="text-right px-3 py-3 text-xs font-semibold text-emerald-400">Kas Masuk Operasi</th>
                    <th className="text-right px-3 py-3 text-xs font-semibold text-rose-400">Kas Keluar Operasi</th>
                    <th className="text-right px-3 py-3 text-xs font-semibold text-foreground/70 border-l border-border">Net Operasi</th>
                    <th className="text-right px-3 py-3 text-xs font-semibold text-sky-400 border-l border-border">Net Investasi</th>
                    <th className="text-right px-3 py-3 text-xs font-semibold text-purple-400 border-l border-border">Net Pendanaan</th>
                    <th className="text-right px-3 py-3 text-xs font-semibold text-cyan-400 border-l border-border">Δ Kas Bersih</th>
                    <th className="text-right px-3 py-3 text-xs font-semibold text-foreground/60 border-l border-border">Saldo Akhir Kas</th>
                  </tr>
                </thead>
                <tbody>
                  {isLoading ? (
                    Array.from({ length: 4 }).map((_, i) => (
                      <tr key={i} className="border-b border-border">
                        {Array.from({ length: 8 }).map((_, j) => (
                          <td key={j} className="px-3 py-3">
                            <div className="h-4 rounded bg-muted animate-pulse" />
                          </td>
                        ))}
                      </tr>
                    ))
                  ) : companies.length === 0 ? (
                    <tr>
                      <td colSpan={8} className="px-4 py-8 text-center text-muted-foreground text-sm">
                        Tidak ada data perusahaan dalam grup
                      </td>
                    </tr>
                  ) : (
                    companies.map((c, i) => {
                      const t = companyTotals[i]!;
                      return (
                        <tr key={c.companyId} className="border-b border-border last:border-0 hover:bg-muted/30 transition-colors">
                          <td className="px-4 py-3">
                            <div className="flex items-center gap-2">
                              <span className={`inline-flex items-center justify-center rounded-md px-1.5 py-0.5 text-xs font-mono font-semibold border ${palette(i).bg} ${palette(i).text} ${palette(i).border}`}>
                                {c.companyCode}
                              </span>
                              <span className="font-medium truncate max-w-[160px]">{c.companyName}</span>
                            </div>
                          </td>
                          <td className="px-3 py-3 text-right font-mono text-xs text-emerald-400">{t.opInflow > 0 ? fmt(t.opInflow) : "—"}</td>
                          <td className="px-3 py-3 text-right font-mono text-xs text-rose-400">{t.opOutflow > 0 ? fmt(t.opOutflow) : "—"}</td>
                          <td className={`px-3 py-3 text-right font-mono text-xs font-semibold border-l border-border ${cashflowColor(t.opNet)}`}>{fmt(t.opNet)}</td>
                          <td className={`px-3 py-3 text-right font-mono text-xs border-l border-border ${cashflowColor(t.invNet)}`}>{t.invNet !== 0 ? fmt(t.invNet) : "—"}</td>
                          <td className={`px-3 py-3 text-right font-mono text-xs border-l border-border ${cashflowColor(t.finNet)}`}>{t.finNet !== 0 ? fmt(t.finNet) : "—"}</td>
                          <td className={`px-3 py-3 text-right font-mono text-xs font-bold border-l border-border ${cashflowColor(t.cashChange)}`}>{fmt(t.cashChange)}</td>
                          <td className={`px-3 py-3 text-right font-mono text-xs border-l border-border ${cashflowColor(t.endingCash)}`}>{fmt(t.endingCash)}</td>
                        </tr>
                      );
                    })
                  )}
                </tbody>
                {!isLoading && companies.length > 0 && (
                  <tfoot>
                    <tr className="border-t-2 border-border bg-muted/40">
                      <td className="px-4 py-3 font-semibold text-xs uppercase tracking-wide text-muted-foreground">Total Konsolidasi</td>
                      <td className="px-3 py-3 text-right font-mono font-bold text-emerald-400 text-xs">{fmt(grandTotal.opInflow)}</td>
                      <td className="px-3 py-3 text-right font-mono font-bold text-rose-400 text-xs">{fmt(grandTotal.opOutflow)}</td>
                      <td className={`px-3 py-3 text-right font-mono font-bold text-xs border-l border-border ${cashflowColor(grandTotal.opNet)}`}>{fmt(grandTotal.opNet)}</td>
                      <td className={`px-3 py-3 text-right font-mono font-bold text-xs border-l border-border ${cashflowColor(grandTotal.invNet)}`}>{fmt(grandTotal.invNet)}</td>
                      <td className={`px-3 py-3 text-right font-mono font-bold text-xs border-l border-border ${cashflowColor(grandTotal.finNet)}`}>{fmt(grandTotal.finNet)}</td>
                      <td className={`px-3 py-3 text-right font-mono font-bold text-xs border-l border-border ${cashflowColor(grandTotal.cashChange)}`}>{fmt(grandTotal.cashChange)}</td>
                      <td className="px-3 py-3 border-l border-border" />
                    </tr>
                  </tfoot>
                )}
              </table>
            </div>
          </CardContent>
        </Card>

        {/* Tabel Monthly per Perusahaan */}
        {companies.length > 0 && months.length > 0 && (
          <Card className="border-border">
            <CardHeader className="pb-3">
              <CardTitle className="text-base">Detail Arus Kas per Perusahaan per Bulan</CardTitle>
              <p className="text-xs text-muted-foreground">Net Arus Operasi tiap perusahaan per bulan</p>
            </CardHeader>
            <CardContent className="p-0">
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-border">
                      <th className="text-left px-4 py-3 text-xs font-semibold text-muted-foreground sticky left-0 bg-card w-24">Bulan</th>
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
                        <th key={`${c.companyId}-op`} className="px-3 py-2 text-right text-[10px] text-emerald-400 font-medium border-l border-border">Net Operasi</th>
                        <th key={`${c.companyId}-cash`} className="px-3 py-2 text-right text-[10px] text-cyan-400 font-medium">Δ Kas</th>
                      </>))}
                      <th className="px-3 py-2 text-right text-[10px] text-emerald-400 font-medium border-l border-border">Net Operasi</th>
                      <th className="px-3 py-2 text-right text-[10px] text-cyan-400 font-medium">Δ Kas</th>
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
                    ) : (
                      months.map((m, rowIdx) => {
                        const mIdx = Number(m.month.slice(5)) - 1;
                        const monthLabel = (MONTH_LABELS[mIdx] ?? m.month.slice(5)) + " " + m.month.slice(0, 4);
                        const consolidated = consolidatedMonths.find((cm) => cm.month === m.month);
                        return (
                          <tr key={m.month} className={`border-b border-border last:border-0 ${rowIdx % 2 === 0 ? "" : "bg-muted/20"} hover:bg-muted/40 transition-colors`}>
                            <td className="px-4 py-2.5 font-medium text-xs sticky left-0 bg-inherit whitespace-nowrap">{monthLabel}</td>
                            {companies.map((c) => {
                              const d = m.byCompany[c.companyId];
                              return (<>
                                <td key={`${c.companyId}-op`} className={`px-3 py-2.5 text-right font-mono text-xs border-l border-border ${cashflowColor(d?.opNet ?? 0)}`}>
                                  {d && d.opNet !== 0 ? fmtShort(d.opNet) : "—"}
                                </td>
                                <td key={`${c.companyId}-cash`} className={`px-3 py-2.5 text-right font-mono text-xs ${cashflowColor(d?.cashChange ?? 0)}`}>
                                  {d && d.cashChange !== 0 ? fmtShort(d.cashChange) : "—"}
                                </td>
                              </>);
                            })}
                            <td className={`px-3 py-2.5 text-right font-mono text-xs font-semibold border-l border-border ${cashflowColor(consolidated?.opNet ?? 0)}`}>
                              {consolidated ? fmtShort(consolidated.opNet) : "—"}
                            </td>
                            <td className={`px-3 py-2.5 text-right font-mono text-xs font-semibold ${cashflowColor(consolidated?.cashChange ?? 0)}`}>
                              {consolidated ? fmtShort(consolidated.cashChange) : "—"}
                            </td>
                          </tr>
                        );
                      })
                    )}
                  </tbody>
                </table>
              </div>
            </CardContent>
          </Card>
        )}

        <p className="text-xs text-muted-foreground text-center pb-2">
          Klasifikasi arus kas berdasarkan tipe akun COA. Operasi = Revenue & Expense · Investasi = Aset Tetap · Pendanaan = Modal & Pinjaman.
        </p>
      </div>
    </AppShell>
  );
}
