import { useEffect, useState } from "react";
import { AppShell } from "@/components/layout/AppShell";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Link } from "wouter";
import {
  Wallet, TrendingUp, TrendingDown, AlertTriangle, CheckCircle2,
  ArrowRight, RefreshCw, FileText, Users, BarChart2, Activity,
  DollarSign, Clock, ArrowUpRight, ArrowDownRight, Landmark,
  Receipt, BookOpen, PieChart, ArrowLeft,
} from "lucide-react";
import { useCompany } from "@/contexts/CompanyContext";
import { BackButton } from "@/components/ui/back-button";
import {
  AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer,
  BarChart, Bar, Cell,
} from "recharts";

const idr = (n: number) =>
  new Intl.NumberFormat("id-ID", { minimumFractionDigits: 0, maximumFractionDigits: 0 }).format(Math.abs(n));

const idrShort = (n: number) => {
  const abs = Math.abs(n);
  const sign = n < 0 ? "-" : "";
  if (abs >= 1_000_000_000) return `${sign}Rp ${(abs / 1_000_000_000).toFixed(1)}M`;
  if (abs >= 1_000_000) return `${sign}Rp ${(abs / 1_000_000).toFixed(1)}jt`;
  return `${sign}Rp ${idr(abs)}`;
};

async function apiFetch<T>(url: string): Promise<T> {
  const r = await fetch(url, { credentials: "include" });
  if (!r.ok) throw new Error("fetch failed");
  return r.json();
}

interface TrialRow { accountId: number; code: string; name: string; type: string; debit: number; credit: number; balance: number }
interface MonthPoint { month: string; label: string; saldo: number }
interface ArAgingRow { dueDate: string; totalAmount: number; customerId: number; customerName: string }
interface ApAgingRow { dueDate: string; totalAmount: number; vendorId: number; vendorName: string }
interface EntryRow { id: number; status: string }
interface PLData { totalRevenue?: number; totalExpenses?: number; netIncome?: number; period?: string }

interface KpiCardProps {
  title: string;
  value: string;
  sub?: string;
  trend?: "up" | "down" | "neutral";
  trendLabel?: string;
  icon: React.ElementType;
  color: "blue" | "green" | "red" | "amber" | "purple" | "teal";
  href: string;
  loading?: boolean;
  status?: "ok" | "warn" | "danger";
}

function KpiCard({ title, value, sub, trend, trendLabel, icon: Icon, color, href, loading, status }: KpiCardProps) {
  const colorMap: Record<string, { icon: string; iconBg: string; accent: string; val: string }> = {
    blue:   { icon: "text-blue-400",   iconBg: "bg-blue-900/60 border-blue-800",   accent: "text-blue-400",   val: "text-white" },
    green:  { icon: "text-emerald-400",iconBg: "bg-emerald-900/60 border-emerald-800",accent: "text-emerald-400",val: "text-white" },
    red:    { icon: "text-rose-400",   iconBg: "bg-rose-900/60 border-rose-800",   accent: "text-rose-400",   val: "text-white" },
    amber:  { icon: "text-amber-400",  iconBg: "bg-amber-900/60 border-amber-800", accent: "text-amber-400",  val: "text-white" },
    purple: { icon: "text-purple-400", iconBg: "bg-purple-900/60 border-purple-800",accent: "text-purple-400",val: "text-white" },
    teal:   { icon: "text-teal-400",   iconBg: "bg-teal-900/60 border-teal-800",   accent: "text-teal-400",   val: "text-white" },
  };
  const c = colorMap[color];
  const dangerRing = status === "danger" ? "ring-1 ring-rose-600/60" : status === "warn" ? "ring-1 ring-amber-500/60" : "";

  return (
    <Link href={href}>
      <div className={`group relative rounded-xl bg-slate-800 border border-slate-700/60 p-5 cursor-pointer hover:bg-slate-750 hover:border-slate-600 transition-all hover:-translate-y-0.5 hover:shadow-xl hover:shadow-black/20 ${dangerRing}`}>
        <div className="flex items-start justify-between mb-3">
          <div className={`p-2.5 rounded-xl border ${c.iconBg}`}>
            <Icon className={`h-5 w-5 ${c.icon}`} />
          </div>
          <ArrowRight className="h-4 w-4 text-slate-500 mt-0.5 opacity-0 group-hover:opacity-100 transition-opacity" />
        </div>
        <p className="text-[11px] font-medium text-slate-400 mb-1 uppercase tracking-widest">{title}</p>
        {loading ? (
          <div className="h-7 w-32 bg-slate-700 rounded animate-pulse" />
        ) : (
          <p className={`text-2xl font-bold leading-tight ${c.val}`}>{value}</p>
        )}
        <div className="flex items-center gap-2 mt-2">
          {sub && <p className="text-xs text-slate-500">{sub}</p>}
          {trend && trendLabel && (
            <span className={`flex items-center gap-0.5 text-xs font-medium ${trend === "up" ? "text-emerald-400" : trend === "down" ? "text-rose-400" : "text-slate-500"}`}>
              {trend === "up" ? <ArrowUpRight className="h-3 w-3" /> : trend === "down" ? <ArrowDownRight className="h-3 w-3" /> : null}
              {trendLabel}
            </span>
          )}
        </div>
      </div>
    </Link>
  );
}

function SectionTitle({ children }: { children: React.ReactNode }) {
  return (
    <h2 className="text-sm font-semibold text-slate-500 uppercase tracking-widest mb-3">{children}</h2>
  );
}

function QuickLink({ href, icon: Icon, label, desc, badge }: { href: string; icon: React.ElementType; label: string; desc: string; badge?: string }) {
  return (
    <Link href={href}>
      <div className="flex items-center gap-3 p-3 rounded-lg border border-white/8 hover:border-blue-700/40 hover:bg-blue-950/20 transition-colors cursor-pointer group">
        <div className="p-1.5 rounded-md bg-white/8 group-hover:bg-blue-900/40 transition-colors shrink-0">
          <Icon className="h-4 w-4 text-slate-400 group-hover:text-blue-400" />
        </div>
        <div className="min-w-0 flex-1">
          <p className="text-sm font-medium">{label}</p>
          <p className="text-xs text-muted-foreground truncate">{desc}</p>
        </div>
        {badge && <Badge variant="secondary" className="text-xs shrink-0">{badge}</Badge>}
        <ArrowRight className="h-3.5 w-3.5 text-muted-foreground shrink-0 opacity-0 group-hover:opacity-100 transition-opacity" />
      </div>
    </Link>
  );
}

interface AgingBucket { label: string; amount: number }

function AgingBar({ buckets, type }: { buckets: AgingBucket[]; type: "ar" | "ap" }) {
  const total = buckets.reduce((s, b) => s + b.amount, 0);
  if (total === 0) return <p className="text-xs text-muted-foreground">Tidak ada data aging</p>;
  const colors = type === "ar"
    ? ["#22c55e", "#f59e0b", "#f97316", "#ef4444"]
    : ["#3b82f6", "#f59e0b", "#f97316", "#ef4444"];

  return (
    <div className="space-y-1.5">
      {buckets.map((b, i) => (
        <div key={b.label} className="flex items-center gap-2">
          <span className="text-xs text-muted-foreground w-20 shrink-0">{b.label}</span>
          <div className="flex-1 bg-white/10 rounded-full h-1.5 overflow-hidden">
            <div
              className="h-full rounded-full transition-all"
              style={{ width: `${Math.min(100, (b.amount / total) * 100)}%`, backgroundColor: colors[i] }}
            />
          </div>
          <span className="text-xs font-medium text-slate-300 w-20 text-right shrink-0">{idrShort(b.amount)}</span>
        </div>
      ))}
    </div>
  );
}

export default function CfoOverviewPage() {
  const { activeCompanyId } = useCompany();
  const companyId = activeCompanyId ?? 1;

  const [loading, setLoading] = useState(true);
  const [refreshed, setRefreshed] = useState(0);
  const [period, setPeriod] = useState<"month" | "quarter" | "year">("month");

  const [totalKasBank, setTotalKasBank] = useState(0);
  const [bankAccountCount, setBankAccountCount] = useState(0);
  const [monthlyData, setMonthlyData] = useState<MonthPoint[]>([]);

  const [plData, setPlData] = useState<PLData>({});

  const [arTotal, setArTotal] = useState(0);
  const [arOverdue, setArOverdue] = useState(0);
  const [arBuckets, setArBuckets] = useState<AgingBucket[]>([]);

  const [apTotal, setApTotal] = useState(0);
  const [apOverdue, setApOverdue] = useState(0);
  const [apBuckets, setApBuckets] = useState<AgingBucket[]>([]);

  const [draftCount, setDraftCount] = useState(0);
  const [postedCount, setPostedCount] = useState(0);

  const [cfNetOperating, setCfNetOperating] = useState<number | null>(null);

  useEffect(() => {
    setLoading(true);
    const now = new Date();
    const year = now.getFullYear();
    let startOfPeriod: string;
    let endOfPeriod: string;
    if (period === "month") {
      const month = String(now.getMonth() + 1).padStart(2, "0");
      startOfPeriod = `${year}-${month}-01`;
      endOfPeriod = new Date(year, now.getMonth() + 1, 0).toISOString().slice(0, 10);
    } else if (period === "quarter") {
      const qStart = Math.floor(now.getMonth() / 3) * 3;
      startOfPeriod = new Date(year, qStart, 1).toISOString().slice(0, 10);
      endOfPeriod = new Date(year, qStart + 3, 0).toISOString().slice(0, 10);
    } else {
      startOfPeriod = `${year}-01-01`;
      endOfPeriod = `${year}-12-31`;
    }

    Promise.all([
      apiFetch<{ rows: TrialRow[] }>(`/api/accounting/reports/trial-balance?company=${companyId}`).catch(() => null),
      apiFetch<{ months: MonthPoint[] }>(`/api/accounting/dashboard/monthly-cash?company=${companyId}`).catch(() => null),
      apiFetch<{ data?: PLData; netIncome?: number; totalRevenue?: number; totalExpenses?: number }>(
        `/api/accounting/reports/profit-loss?company=${companyId}&startDate=${startOfPeriod}&endDate=${endOfPeriod}`
      ).catch(() => null),
      apiFetch<{ rows?: ArAgingRow[]; buckets?: Record<string, number> }>(`/api/reports/ar-aging?company=${companyId}`).catch(() => null),
      apiFetch<{ rows?: ApAgingRow[]; buckets?: Record<string, number> }>(`/api/reports/ap-aging?company=${companyId}`).catch(() => null),
      apiFetch<EntryRow[]>(`/api/accounting/entries?company=${companyId}&limit=500`).catch(() => []),
      apiFetch<{ netOperating?: number; summary?: { netOperating?: number } }>(
        `/api/accounting/reports/cash-flow?company=${companyId}&startDate=${startOfPeriod}&endDate=${endOfPeriod}`
      ).catch(() => null),
    ]).then(([tb, mc, pl, ar, ap, entries, cf]) => {
      if (tb) {
        const bankAccs = (tb.rows ?? []).filter((r) => r.type === "asset" && /kas|bank|cash/i.test(r.name));
        setTotalKasBank(bankAccs.reduce((s, r) => s + r.balance, 0));
        setBankAccountCount(bankAccs.length);
      }

      if (mc) setMonthlyData(mc.months ?? []);

      if (pl) {
        const d = (pl as any);
        setPlData({
          netIncome: d.netIncome ?? d.data?.netIncome ?? null,
          totalRevenue: d.totalRevenue ?? d.data?.totalRevenue ?? null,
          totalExpenses: d.totalExpenses ?? d.data?.totalExpenses ?? null,
        });
      }

      if (ar) {
        const rows: ArAgingRow[] = (ar as any).rows ?? [];
        const bk = (ar as any).buckets ?? {};
        const b0 = bk["0-30"] ?? 0;
        const b30 = bk["31-60"] ?? 0;
        const b60 = bk["61-90"] ?? 0;
        const b90 = bk["90+"] ?? 0;
        const total = rows.reduce((s, r) => s + Number(r.totalAmount ?? 0), 0);
        const overdue = b30 + b60 + b90;
        setArTotal(total > 0 ? total : b0 + overdue);
        setArOverdue(overdue);
        setArBuckets([
          { label: "0–30 hari", amount: b0 },
          { label: "31–60 hari", amount: b30 },
          { label: "61–90 hari", amount: b60 },
          { label: "> 90 hari", amount: b90 },
        ]);
      }

      if (ap) {
        const rows: ApAgingRow[] = (ap as any).rows ?? [];
        const bk = (ap as any).buckets ?? {};
        const b0 = bk["0-30"] ?? 0;
        const b30 = bk["31-60"] ?? 0;
        const b60 = bk["61-90"] ?? 0;
        const b90 = bk["90+"] ?? 0;
        const total = rows.reduce((s, r) => s + Number(r.totalAmount ?? 0), 0);
        const overdue = b30 + b60 + b90;
        setApTotal(total > 0 ? total : b0 + overdue);
        setApOverdue(overdue);
        setApBuckets([
          { label: "0–30 hari", amount: b0 },
          { label: "31–60 hari", amount: b30 },
          { label: "61–90 hari", amount: b60 },
          { label: "> 90 hari", amount: b90 },
        ]);
      }

      if (entries) {
        const e = entries as EntryRow[];
        setDraftCount(e.filter((x) => x.status === "draft").length);
        setPostedCount(e.filter((x) => x.status === "posted").length);
      }

      if (cf) {
        const c = cf as any;
        setCfNetOperating(c.netOperating ?? c.summary?.netOperating ?? null);
      }

      setLoading(false);
    });
  }, [companyId, refreshed, period]);

  const netIncome = plData.netIncome ?? null;
  const totalRevenue = plData.totalRevenue ?? null;

  const chartMin = monthlyData.length ? Math.min(...monthlyData.map((d) => d.saldo)) * 0.9 : 0;
  const chartMax = monthlyData.length ? Math.max(...monthlyData.map((d) => d.saldo)) * 1.1 : 0;
  const latestCash = monthlyData.length ? monthlyData[monthlyData.length - 1]?.saldo : null;
  const prevCash = monthlyData.length > 1 ? monthlyData[monthlyData.length - 2]?.saldo : null;
  const cashTrend = latestCash && prevCash ? (latestCash > prevCash ? "up" : "down") : "neutral";

  const now = new Date();
  const bulanIni = now.toLocaleDateString("id-ID", { month: "long", year: "numeric" });

  return (
    <AppShell>
      <BackButton href="/finance" />
      <div className="space-y-6 p-6 max-w-7xl mx-auto">
        <Button variant="ghost" size="sm" className="-ml-2" onClick={() => window.history.back()}>
          <ArrowLeft className="h-4 w-4 mr-1" />Kembali
        </Button>
        {/* ── Header ── */}
        <div className="flex items-center justify-between flex-wrap gap-3">
          <div>
            <h1 className="text-2xl font-bold flex items-center gap-2">
              <PieChart className="h-6 w-6 text-blue-400" />
              CFO Overview
            </h1>
            <p className="text-sm text-muted-foreground mt-0.5">Ringkasan eksekutif keuangan · {bulanIni}</p>
          </div>
          <div className="flex items-center gap-2 flex-wrap">
            {/* Period Picker */}
            <div className="flex items-center rounded-lg border border-white/10 bg-white/5 p-0.5 gap-0.5">
              {(["month", "quarter", "year"] as const).map((p) => {
                const label = p === "month" ? "Bulan Ini" : p === "quarter" ? "3 Bulan" : "Tahun Ini";
                return (
                  <button
                    key={p}
                    onClick={() => setPeriod(p)}
                    className={`px-3 py-1 text-xs font-medium rounded-md transition-colors ${
                      period === p
                        ? "bg-blue-600 text-white"
                        : "text-slate-400 hover:text-slate-200"
                    }`}
                  >
                    {label}
                  </button>
                );
              })}
            </div>
            <Link href="/advanced-accounting">
              <Button variant="outline" size="sm" className="gap-1.5 text-xs">
                <BookOpen className="h-3.5 w-3.5" />
                Akuntansi Lanjutan
              </Button>
            </Link>
            <Button variant="outline" size="sm" onClick={() => setRefreshed((x) => x + 1)} disabled={loading} className="gap-1.5">
              <RefreshCw className={`h-3.5 w-3.5 ${loading ? "animate-spin" : ""}`} />
              Refresh
            </Button>
          </div>
        </div>

        {/* ── 6 KPI Cards ── */}
        <div className="rounded-2xl bg-slate-900 p-5">
          <h2 className="text-xs font-semibold text-slate-400 uppercase tracking-widest mb-4">Metrik Utama</h2>
          <div className="grid grid-cols-2 md:grid-cols-3 gap-4">
            <KpiCard
              title="Cash Position"
              value={loading ? "—" : `Rp ${idr(totalKasBank)}`}
              sub={`${bankAccountCount} rekening aktif`}
              trend={cashTrend as "up" | "down" | "neutral"}
              trendLabel={cashTrend === "up" ? "Naik bulan ini" : cashTrend === "down" ? "Turun bulan ini" : undefined}
              icon={Wallet}
              color="blue"
              href="/finance/kpi/cash"
              loading={loading}
            />
            <KpiCard
              title="Net Profit"
              value={loading ? "—" : netIncome !== null ? idrShort(netIncome) : "N/A"}
              sub={totalRevenue !== null ? `Revenue: ${idrShort(totalRevenue)}` : undefined}
              trend={netIncome !== null ? (netIncome >= 0 ? "up" : "down") : "neutral"}
              trendLabel={netIncome !== null ? (netIncome >= 0 ? "Profit" : "Rugi") : undefined}
              icon={TrendingUp}
              color={netIncome !== null && netIncome < 0 ? "red" : "green"}
              href="/finance/kpi/profit"
              loading={loading}
              status={netIncome !== null && netIncome < 0 ? "danger" : "ok"}
            />
            <KpiCard
              title="Accounts Receivable"
              value={loading ? "—" : idrShort(arOverdue)}
              sub={arTotal > 0 ? `Total AR: ${idrShort(arTotal)}` : "Tidak ada piutang"}
              trend={arOverdue > 0 ? "down" : "up"}
              trendLabel={arOverdue > 0 ? "Ada yang overdue" : "Semua lancar"}
              icon={Users}
              color={arOverdue > 0 ? "amber" : "green"}
              href="/finance/kpi/ar"
              loading={loading}
              status={arOverdue > 0 ? "warn" : "ok"}
            />
            <KpiCard
              title="Accounts Payable"
              value={loading ? "—" : idrShort(apOverdue)}
              sub={apTotal > 0 ? `Total AP: ${idrShort(apTotal)}` : "Tidak ada hutang"}
              trend={apOverdue > 0 ? "down" : "up"}
              trendLabel={apOverdue > 0 ? "Ada yang overdue" : "Semua lancar"}
              icon={Receipt}
              color={apOverdue > 0 ? "red" : "green"}
              href="/finance/kpi/ap"
              loading={loading}
              status={apOverdue > 0 ? "warn" : "ok"}
            />
            <KpiCard
              title="Revenue"
              value={loading ? "—" : totalRevenue !== null ? idrShort(totalRevenue) : "N/A"}
              sub="Pendapatan bulan berjalan"
              trend={totalRevenue !== null ? (totalRevenue > 0 ? "up" : "neutral") : "neutral"}
              trendLabel={totalRevenue !== null && totalRevenue > 0 ? "Ada pendapatan" : undefined}
              icon={Activity}
              color="teal"
              href="/finance/kpi/revenue"
              loading={loading}
            />
            <KpiCard
              title="Tax Position"
              value={loading ? "—" : `${draftCount} draft`}
              sub={`${postedCount} jurnal posted · Periode ${bulanIni}`}
              trend={draftCount > 0 ? "down" : "neutral"}
              trendLabel={draftCount > 0 ? "Ada draft pending" : "Bersih"}
              icon={FileText}
              color={draftCount > 10 ? "amber" : "purple"}
              href="/finance/kpi/tax"
              loading={loading}
              status={draftCount > 10 ? "warn" : "ok"}
            />
          </div>
        </div>

        {/* ── Charts Row ── */}
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          {/* Cash Trend Chart */}
          <Card>
            <CardHeader className="pb-2 pt-4 px-5">
              <CardTitle className="text-sm font-semibold flex items-center gap-2">
                <Wallet className="h-4 w-4 text-blue-400" />
                Tren Saldo Kas & Bank (12 Bulan)
              </CardTitle>
            </CardHeader>
            <CardContent className="px-2 pb-4">
              {loading ? (
                <div className="h-40 bg-white/5 rounded animate-pulse" />
              ) : monthlyData.length > 0 ? (
                <ResponsiveContainer width="100%" height={160}>
                  <AreaChart data={monthlyData} margin={{ top: 4, right: 8, left: 0, bottom: 0 }}>
                    <defs>
                      <linearGradient id="cashGrad" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="5%" stopColor="#3b82f6" stopOpacity={0.25} />
                        <stop offset="95%" stopColor="#3b82f6" stopOpacity={0} />
                      </linearGradient>
                    </defs>
                    <CartesianGrid strokeDasharray="3 3" stroke="#ffffff10" />
                    <XAxis dataKey="label" tick={{ fontSize: 10 }} tickLine={false} axisLine={false} />
                    <YAxis
                      tick={{ fontSize: 9 }}
                      tickLine={false}
                      axisLine={false}
                      domain={[chartMin, chartMax]}
                      tickFormatter={(v) => idrShort(v).replace("Rp ", "")}
                      width={48}
                    />
                    <Tooltip
                      content={({ active, payload, label }) => {
                        if (!active || !payload?.length) return null;
                        return (
                          <div className="bg-slate-900 border border-white/10 rounded-lg shadow-lg p-3 text-sm">
                            <p className="font-semibold text-slate-300 mb-1">{label}</p>
                            <p className="text-blue-400 font-bold">Rp {idr(payload[0].value as number)}</p>
                          </div>
                        );
                      }}
                    />
                    <Area type="monotone" dataKey="saldo" stroke="#3b82f6" strokeWidth={2} fill="url(#cashGrad)" dot={false} />
                  </AreaChart>
                </ResponsiveContainer>
              ) : (
                <div className="h-40 flex items-center justify-center text-sm text-muted-foreground">Belum ada data kas</div>
              )}
            </CardContent>
          </Card>

          {/* AR + AP Aging */}
          <Card>
            <CardHeader className="pb-2 pt-4 px-5">
              <CardTitle className="text-sm font-semibold flex items-center gap-2">
                <BarChart2 className="h-4 w-4 text-amber-400" />
                Aging Piutang & Hutang
              </CardTitle>
            </CardHeader>
            <CardContent className="px-5 pb-5 space-y-4">
              <div>
                <p className="text-xs font-semibold text-emerald-400 mb-2 uppercase tracking-wide">Piutang (AR)</p>
                {loading ? <div className="h-16 bg-white/5 rounded animate-pulse" /> : <AgingBar buckets={arBuckets} type="ar" />}
              </div>
              <div>
                <p className="text-xs font-semibold text-blue-400 mb-2 uppercase tracking-wide">Hutang (AP)</p>
                {loading ? <div className="h-16 bg-white/5 rounded animate-pulse" /> : <AgingBar buckets={apBuckets} type="ap" />}
              </div>
            </CardContent>
          </Card>
        </div>

        {/* ── Quick Actions ── */}
        <div>
          <SectionTitle>Laporan Keuangan</SectionTitle>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2">
            <QuickLink href="/accounting/reports/profit-loss" icon={TrendingUp} label="Laba Rugi" desc="P&L bulan / periode tertentu" />
            <QuickLink href="/accounting/reports/balance-sheet" icon={Landmark} label="Neraca" desc="Aset, kewajiban, ekuitas" />
            <QuickLink href="/accounting/reports/cash-flow" icon={Activity} label="Arus Kas" desc="Cash flow statement" />
            <QuickLink href="/accounting/reports/trial-balance" icon={BarChart2} label="Neraca Saldo" desc="Trial balance semua akun" />
            <QuickLink href="/reports/ar-aging" icon={Users} label="AR Aging" desc="Piutang per umur" />
            <QuickLink href="/reports/ap-aging" icon={Receipt} label="AP Aging" desc="Hutang per umur" />
          </div>
        </div>

        <div>
          <SectionTitle>Operasional Keuangan</SectionTitle>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2">
            <QuickLink href="/accounting/entries" icon={FileText} label="Jurnal Entries" desc="Semua entri akuntansi" badge={draftCount > 0 ? `${draftCount} draft` : undefined} />
            <QuickLink href="/accounting/bank-reconciliation" icon={CheckCircle2} label="Rekonsiliasi Bank" desc="Cocokkan mutasi bank" />
            <QuickLink href="/accounting/bank-mutation-import" icon={DollarSign} label="Import Mutasi" desc="Upload mutasi rekening" />
            <QuickLink href="/accounting/closing-entries" icon={Clock} label="Jurnal Penutup" desc="Closing entry periode" />
            <QuickLink href="/accounting/pl-by-bu" icon={PieChart} label="P&L per Unit Bisnis" desc="Breakdown per cabang / BU" />
            <QuickLink href="/accounting/reports/freight-profitability" icon={TrendingDown} label="Profitabilitas Freight" desc="Margin per shipment" />
          </div>
        </div>

        <div>
          <SectionTitle>Pajak & Aset</SectionTitle>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2">
            <QuickLink href="/tax" icon={Receipt} label="Dashboard Pajak" desc="Overview perpajakan" />
            <QuickLink href="/accounting/taxes" icon={Receipt} label="Master Pajak" desc="PPn, PPh, dan lainnya" />
            <QuickLink href="/expense/fixed-assets" icon={Landmark} label="Aset Tetap" desc="Fixed assets & depresiasi" />
            <QuickLink href="/expense/asset-depreciation" icon={TrendingDown} label="Depresiasi Aset" desc="Jurnal depresiasi otomatis" />
            <QuickLink href="/accounting/wht-reconciliation" icon={BarChart2} label="Rekonsiliasi WHT" desc="Withholding tax check" />
            <QuickLink href="/accounting/tax-report" icon={FileText} label="Laporan Pajak" desc="Rekap laporan pajak" />
          </div>
        </div>
      </div>
    </AppShell>
  );
}
