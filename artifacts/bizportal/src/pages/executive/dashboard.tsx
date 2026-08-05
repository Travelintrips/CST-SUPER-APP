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
  BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, Cell, Legend,
} from "recharts";
import {
  Building2, TrendingUp, TrendingDown, DollarSign, Landmark,
  Trophy, ArrowUpRight, ArrowDownRight, RefreshCw, ShieldCheck,
} from "lucide-react";

const idr = (v: number) =>
  new Intl.NumberFormat("id-ID", { style: "currency", currency: "IDR", maximumFractionDigits: 0 }).format(v);

const pct = (v: number) => `${v >= 0 ? "+" : ""}${v.toFixed(1)}%`;

type CompanyPerf = {
  company_id: number;
  company_name: string;
  company_code: string;
  is_holding: boolean;
  revenue: number;
  expense: number;
  profit: number;
  profit_margin_pct: number;
  cash_balance: number;
};

type CostCenterPerf = {
  cost_center_id: number;
  code: string;
  name: string;
  company_id: number | null;
  company_name: string | null;
  revenue: number;
  expense: number;
  profit: number;
};

type CashPerCompany = {
  company_id: number;
  company_name: string;
  company_code: string;
  cash_balance: number;
};

type Validation = { sum_per_company: number; consolidated: number; match: boolean };

type SummaryData = {
  revenue_total: number;
  expense_total: number;
  profit_total: number;
  cash_position: number;
  top_company: CompanyPerf | null;
  top_cost_center: CostCenterPerf | null;
  company_performance: CompanyPerf[];
  cost_center_performance: CostCenterPerf[];
  top_companies: CompanyPerf[];
  top_cost_centers: CostCenterPerf[];
  bottom_cost_centers: CostCenterPerf[];
  cash_per_company: CashPerCompany[];
  validation: Validation;
};

const CHART_COLORS = [
  "#3b82f6", "#10b981", "#f59e0b", "#8b5cf6", "#ef4444",
  "#06b6d4", "#84cc16", "#f97316", "#ec4899", "#6366f1",
];

export default function ExecutiveDashboard() {
  const today = new Date().toISOString().split("T")[0];
  const firstOfYear = `${new Date().getFullYear()}-01-01`;

  const [from, setFrom] = useState(firstOfYear);
  const [to, setTo] = useState(today);
  const [queryFrom, setQueryFrom] = useState(firstOfYear);
  const [queryTo, setQueryTo] = useState(today);

  const { data, isLoading, refetch, isFetching } = useQuery<SummaryData>({
    queryKey: ["executive-summary", queryFrom, queryTo],
    queryFn: async () => {
      const qs = new URLSearchParams({ from: queryFrom, to: queryTo });
      const r = await fetch(`/api/executive/summary?${qs}`, { credentials: "include" });
      if (!r.ok) throw new Error("Gagal memuat executive summary");
      return r.json();
    },
    staleTime: 60_000,
    refetchOnWindowFocus: false,
  });

  const d = data;

  const revenueChartData = (d?.company_performance ?? [])
    .filter((c) => !c.is_holding)
    .map((c) => ({ name: c.company_code, revenue: c.revenue, expense: c.expense, profit: c.profit }));

  const ccChartData = (d?.cost_center_performance ?? [])
    .sort((a, b) => b.profit - a.profit)
    .map((cc) => ({ name: cc.code || cc.name.slice(0, 10), profit: cc.profit, revenue: cc.revenue }));

  const cashChartData = (d?.cash_per_company ?? [])
    .filter((c) => c.cash_balance !== 0)
    .map((c) => ({ name: c.company_code, cash: c.cash_balance }));

  return (
    <AppShell>
      <div className="p-6 space-y-6">
        {/* ── Header ──────────────────────────────────────────────────────── */}
        <div className="flex items-center justify-between flex-wrap gap-3">
          <div className="flex items-center gap-3">
            <Building2 className="h-7 w-7 text-blue-400" />
            <div>
              <h1 className="text-2xl font-bold text-foreground">Executive Dashboard</h1>
              <p className="text-sm text-muted-foreground">KPI lintas perusahaan & cost center — konsolidasi</p>
            </div>
          </div>
          <div className="flex items-center gap-2 flex-wrap">
            <div className="flex items-center gap-1">
              <Label className="text-xs text-muted-foreground">Dari</Label>
              <DatePicker value={from} onChange={(v) => setFrom(v)} className="h-8 text-xs w-36" />
            </div>
            <div className="flex items-center gap-1">
              <Label className="text-xs text-muted-foreground">S/d</Label>
              <DatePicker value={to} onChange={(v) => setTo(v)} className="h-8 text-xs w-36" />
            </div>
            <Button size="sm" variant="outline" className="h-8 gap-1"
              onClick={() => { setQueryFrom(from); setQueryTo(to); void refetch(); }}>
              <RefreshCw className={`h-3 w-3 ${isFetching ? "animate-spin" : ""}`} /> Terapkan
            </Button>
          </div>
        </div>

        {/* ── Section B: KPI Cards ─────────────────────────────────────────── */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          <Card className="border-border/60 bg-blue-950/20">
            <CardContent className="p-5">
              <div className="flex items-center justify-between mb-1">
                <p className="text-xs text-muted-foreground">Total Revenue</p>
                <TrendingUp className="h-4 w-4 text-blue-400" />
              </div>
              {isLoading ? (
                <div className="h-8 bg-slate-700 animate-pulse rounded" />
              ) : (
                <p className="text-xl font-bold text-blue-300">{idr(d?.revenue_total ?? 0)}</p>
              )}
              <p className="text-xs text-muted-foreground mt-1">konsolidasi</p>
            </CardContent>
          </Card>

          <Card className="border-border/60 bg-red-950/20">
            <CardContent className="p-5">
              <div className="flex items-center justify-between mb-1">
                <p className="text-xs text-muted-foreground">Total Expense</p>
                <TrendingDown className="h-4 w-4 text-red-400" />
              </div>
              {isLoading ? (
                <div className="h-8 bg-slate-700 animate-pulse rounded" />
              ) : (
                <p className="text-xl font-bold text-red-300">{idr(d?.expense_total ?? 0)}</p>
              )}
              <p className="text-xs text-muted-foreground mt-1">konsolidasi</p>
            </CardContent>
          </Card>

          <Card className={`border-border/60 ${(d?.profit_total ?? 0) >= 0 ? "bg-emerald-950/20" : "bg-red-950/20"}`}>
            <CardContent className="p-5">
              <div className="flex items-center justify-between mb-1">
                <p className="text-xs text-muted-foreground">Net Profit</p>
                <DollarSign className={`h-4 w-4 ${(d?.profit_total ?? 0) >= 0 ? "text-emerald-400" : "text-red-400"}`} />
              </div>
              {isLoading ? (
                <div className="h-8 bg-slate-700 animate-pulse rounded" />
              ) : (
                <p className={`text-xl font-bold ${(d?.profit_total ?? 0) >= 0 ? "text-emerald-300" : "text-red-300"}`}>
                  {idr(d?.profit_total ?? 0)}
                </p>
              )}
              <p className="text-xs text-muted-foreground mt-1">revenue − expense</p>
            </CardContent>
          </Card>

          <Card className="border-border/60 bg-cyan-950/20">
            <CardContent className="p-5">
              <div className="flex items-center justify-between mb-1">
                <p className="text-xs text-muted-foreground">Cash Position</p>
                <Landmark className="h-4 w-4 text-cyan-400" />
              </div>
              {isLoading ? (
                <div className="h-8 bg-slate-700 animate-pulse rounded" />
              ) : (
                <p className="text-xl font-bold text-cyan-300">{idr(d?.cash_position ?? 0)}</p>
              )}
              <p className="text-xs text-muted-foreground mt-1">kas + bank</p>
            </CardContent>
          </Card>
        </div>

        {/* ── Section H: Validasi ──────────────────────────────────────────── */}
        {d?.validation && (
          <div className={`flex items-center gap-2 text-xs px-3 py-2 rounded-md border ${d.validation.match ? "border-emerald-700 bg-emerald-950/20 text-emerald-300" : "border-red-700 bg-red-950/20 text-red-300"}`}>
            <ShieldCheck className="h-3.5 w-3.5 shrink-0" />
            {d.validation.match
              ? `✓ Validasi: Sum profit per perusahaan (${idr(d.validation.sum_per_company)}) = Konsolidasi (${idr(d.validation.consolidated)})`
              : `⚠ Mismatch: Sum per perusahaan ${idr(d.validation.sum_per_company)} ≠ konsolidasi ${idr(d.validation.consolidated)}`}
          </div>
        )}

        {/* ── Charts Row 1 ────────────────────────────────────────────────── */}
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          {/* Section C: Revenue per Company */}
          <Card className="border-border/60">
            <CardHeader className="pb-2">
              <CardTitle className="text-sm font-medium text-muted-foreground flex items-center gap-2">
                <TrendingUp className="h-4 w-4 text-blue-400" /> Revenue per Perusahaan
              </CardTitle>
            </CardHeader>
            <CardContent>
              {isLoading ? (
                <div className="h-48 bg-slate-700 animate-pulse rounded" />
              ) : revenueChartData.length === 0 ? (
                <p className="text-sm text-muted-foreground text-center py-10">Belum ada data</p>
              ) : (
                <ResponsiveContainer width="100%" height={200}>
                  <BarChart data={revenueChartData} margin={{ left: 0, right: 8, top: 4, bottom: 0 }}>
                    <XAxis dataKey="name" stroke="#6b7280" tick={{ fontSize: 10 }} />
                    <YAxis stroke="#6b7280" tick={{ fontSize: 10 }} width={42}
                      tickFormatter={(v) => `${(v / 1_000_000).toFixed(0)}M`} />
                    <Tooltip
                      formatter={(v: number, name: string) => [idr(v), name]}
                      contentStyle={{ backgroundColor: "#1f2937", border: "1px solid #374151", borderRadius: 8, fontSize: 11 }} />
                    <Legend wrapperStyle={{ fontSize: 11 }} />
                    <Bar dataKey="revenue" name="Revenue" fill="#3b82f6" radius={[3, 3, 0, 0]} />
                    <Bar dataKey="expense" name="Expense" fill="#ef4444" radius={[3, 3, 0, 0]} />
                  </BarChart>
                </ResponsiveContainer>
              )}
            </CardContent>
          </Card>

          {/* Section D: Profit per Cost Center */}
          <Card className="border-border/60">
            <CardHeader className="pb-2">
              <CardTitle className="text-sm font-medium text-muted-foreground flex items-center gap-2">
                <DollarSign className="h-4 w-4 text-emerald-400" /> Profit per Cost Center
              </CardTitle>
            </CardHeader>
            <CardContent>
              {isLoading ? (
                <div className="h-48 bg-slate-700 animate-pulse rounded" />
              ) : ccChartData.length === 0 ? (
                <p className="text-sm text-muted-foreground text-center py-10">Belum ada data</p>
              ) : (
                <ResponsiveContainer width="100%" height={200}>
                  <BarChart data={ccChartData} margin={{ left: 0, right: 8, top: 4, bottom: 0 }}>
                    <XAxis dataKey="name" stroke="#6b7280" tick={{ fontSize: 10 }} />
                    <YAxis stroke="#6b7280" tick={{ fontSize: 10 }} width={42}
                      tickFormatter={(v) => `${(v / 1_000_000).toFixed(0)}M`} />
                    <Tooltip
                      formatter={(v: number) => [idr(v), "Profit"]}
                      contentStyle={{ backgroundColor: "#1f2937", border: "1px solid #374151", borderRadius: 8, fontSize: 11 }} />
                    <Bar dataKey="profit" name="Profit" radius={[3, 3, 0, 0]}>
                      {ccChartData.map((entry, i) => (
                        <Cell key={i} fill={entry.profit >= 0 ? CHART_COLORS[i % CHART_COLORS.length] : "#ef4444"} />
                      ))}
                    </Bar>
                  </BarChart>
                </ResponsiveContainer>
              )}
            </CardContent>
          </Card>
        </div>

        {/* ── Section F: Cash Position Chart ──────────────────────────────── */}
        {cashChartData.length > 0 && (
          <Card className="border-border/60">
            <CardHeader className="pb-2">
              <CardTitle className="text-sm font-medium text-muted-foreground flex items-center gap-2">
                <Landmark className="h-4 w-4 text-cyan-400" /> Cash Position per Perusahaan
              </CardTitle>
            </CardHeader>
            <CardContent>
              <ResponsiveContainer width="100%" height={160}>
                <BarChart data={cashChartData} margin={{ left: 0, right: 8, top: 4, bottom: 0 }}>
                  <XAxis dataKey="name" stroke="#6b7280" tick={{ fontSize: 10 }} />
                  <YAxis stroke="#6b7280" tick={{ fontSize: 10 }} width={48}
                    tickFormatter={(v) => `${(v / 1_000_000).toFixed(0)}M`} />
                  <Tooltip
                    formatter={(v: number) => [idr(v), "Kas + Bank"]}
                    contentStyle={{ backgroundColor: "#1f2937", border: "1px solid #374151", borderRadius: 8, fontSize: 11 }} />
                  <Bar dataKey="cash" name="Cash" radius={[3, 3, 0, 0]}>
                    {cashChartData.map((entry, i) => (
                      <Cell key={i} fill={entry.cash >= 0 ? "#06b6d4" : "#ef4444"} />
                    ))}
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            </CardContent>
          </Card>
        )}

        {/* ── Section C: Company Performance Table ────────────────────────── */}
        <Card className="border-border/60">
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground flex items-center gap-2">
              <Building2 className="h-4 w-4 text-purple-400" /> Performa per Perusahaan
            </CardTitle>
          </CardHeader>
          <CardContent className="p-0">
            <div className="overflow-x-auto">
              <table className="w-full text-xs">
                <thead>
                  <tr className="border-b border-border/50 text-muted-foreground">
                    <th className="px-4 py-2 text-left">Perusahaan</th>
                    <th className="px-4 py-2 text-right">Revenue</th>
                    <th className="px-4 py-2 text-right">Expense</th>
                    <th className="px-4 py-2 text-right">Profit</th>
                    <th className="px-4 py-2 text-right">Margin</th>
                    <th className="px-4 py-2 text-right">Kas+Bank</th>
                  </tr>
                </thead>
                <tbody>
                  {isLoading
                    ? Array.from({ length: 3 }).map((_, i) => (
                        <tr key={i}><td colSpan={6} className="px-4 py-2"><div className="h-4 bg-slate-700 animate-pulse rounded" /></td></tr>
                      ))
                    : (d?.company_performance ?? []).map((c) => (
                        <tr key={c.company_id} className="border-b border-border/30 hover:bg-slate-800/30">
                          <td className="px-4 py-2">
                            <div className="flex items-center gap-2">
                              <span className="font-medium text-foreground">{c.company_name}</span>
                              <span className="text-muted-foreground">({c.company_code})</span>
                              {c.is_holding && <Badge className="text-[10px] bg-purple-900/40 text-purple-300 border-purple-600">Holding</Badge>}
                            </div>
                          </td>
                          <td className="px-4 py-2 text-right text-blue-300">{idr(c.revenue)}</td>
                          <td className="px-4 py-2 text-right text-red-300">{idr(c.expense)}</td>
                          <td className={`px-4 py-2 text-right font-semibold ${c.profit >= 0 ? "text-emerald-300" : "text-red-300"}`}>
                            {idr(c.profit)}
                          </td>
                          <td className={`px-4 py-2 text-right ${c.profit_margin_pct >= 0 ? "text-emerald-400" : "text-red-400"}`}>
                            {pct(c.profit_margin_pct)}
                          </td>
                          <td className="px-4 py-2 text-right text-cyan-300">{idr(c.cash_balance)}</td>
                        </tr>
                      ))}
                </tbody>
              </table>
            </div>
          </CardContent>
        </Card>

        {/* ── Section D: Cost Center Performance Table ─────────────────────── */}
        <Card className="border-border/60">
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground flex items-center gap-2">
              <DollarSign className="h-4 w-4 text-yellow-400" /> Performa per Cost Center
            </CardTitle>
          </CardHeader>
          <CardContent className="p-0">
            <div className="overflow-x-auto">
              <table className="w-full text-xs">
                <thead>
                  <tr className="border-b border-border/50 text-muted-foreground">
                    <th className="px-4 py-2 text-left">Cost Center</th>
                    <th className="px-4 py-2 text-left">Perusahaan</th>
                    <th className="px-4 py-2 text-right">Revenue</th>
                    <th className="px-4 py-2 text-right">Expense</th>
                    <th className="px-4 py-2 text-right">Profit</th>
                  </tr>
                </thead>
                <tbody>
                  {isLoading
                    ? Array.from({ length: 3 }).map((_, i) => (
                        <tr key={i}><td colSpan={5} className="px-4 py-2"><div className="h-4 bg-slate-700 animate-pulse rounded" /></td></tr>
                      ))
                    : (d?.cost_center_performance ?? []).map((cc) => (
                        <tr key={cc.cost_center_id} className="border-b border-border/30 hover:bg-slate-800/30">
                          <td className="px-4 py-2">
                            <span className="font-medium text-foreground">{cc.name}</span>
                            {cc.code && <span className="ml-2 text-muted-foreground">({cc.code})</span>}
                          </td>
                          <td className="px-4 py-2 text-muted-foreground">{cc.company_name ?? "—"}</td>
                          <td className="px-4 py-2 text-right text-blue-300">{idr(cc.revenue)}</td>
                          <td className="px-4 py-2 text-right text-red-300">{idr(cc.expense)}</td>
                          <td className={`px-4 py-2 text-right font-semibold ${cc.profit >= 0 ? "text-emerald-300" : "text-red-300"}`}>
                            {idr(cc.profit)}
                          </td>
                        </tr>
                      ))}
                </tbody>
              </table>
            </div>
          </CardContent>
        </Card>

        {/* ── Section E: Top Ranking ───────────────────────────────────────── */}
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
          {/* Top 5 Company */}
          <Card className="border-border/60">
            <CardHeader className="pb-2">
              <CardTitle className="text-sm font-medium text-muted-foreground flex items-center gap-2">
                <Trophy className="h-4 w-4 text-yellow-400" /> Top 5 Perusahaan
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-2">
              {isLoading
                ? Array.from({ length: 3 }).map((_, i) => (
                    <div key={i} className="h-8 bg-slate-700 animate-pulse rounded" />
                  ))
                : (d?.top_companies ?? []).map((c, i) => (
                    <div key={c.company_id} className="flex items-center justify-between">
                      <div className="flex items-center gap-2 min-w-0">
                        <span className={`text-xs font-bold w-4 shrink-0 ${i === 0 ? "text-yellow-400" : "text-muted-foreground"}`}>#{i + 1}</span>
                        <span className="text-xs truncate">{c.company_name}</span>
                      </div>
                      <span className={`text-xs font-semibold shrink-0 ml-2 ${c.profit >= 0 ? "text-emerald-300" : "text-red-300"}`}>
                        {idr(c.profit)}
                      </span>
                    </div>
                  ))}
              {(d?.top_companies ?? []).length === 0 && !isLoading && (
                <p className="text-xs text-muted-foreground text-center py-4">Belum ada data</p>
              )}
            </CardContent>
          </Card>

          {/* Top 5 Cost Center */}
          <Card className="border-border/60">
            <CardHeader className="pb-2">
              <CardTitle className="text-sm font-medium text-muted-foreground flex items-center gap-2">
                <ArrowUpRight className="h-4 w-4 text-emerald-400" /> Top 5 Cost Center
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-2">
              {isLoading
                ? Array.from({ length: 3 }).map((_, i) => (
                    <div key={i} className="h-8 bg-slate-700 animate-pulse rounded" />
                  ))
                : (d?.top_cost_centers ?? []).map((cc, i) => (
                    <div key={cc.cost_center_id} className="flex items-center justify-between">
                      <div className="flex items-center gap-2 min-w-0">
                        <span className={`text-xs font-bold w-4 shrink-0 ${i === 0 ? "text-emerald-400" : "text-muted-foreground"}`}>#{i + 1}</span>
                        <span className="text-xs truncate">{cc.name}</span>
                      </div>
                      <span className="text-xs font-semibold text-emerald-300 shrink-0 ml-2">{idr(cc.profit)}</span>
                    </div>
                  ))}
              {(d?.top_cost_centers ?? []).length === 0 && !isLoading && (
                <p className="text-xs text-muted-foreground text-center py-4">Belum ada data</p>
              )}
            </CardContent>
          </Card>

          {/* Bottom 5 Cost Center */}
          <Card className="border-border/60">
            <CardHeader className="pb-2">
              <CardTitle className="text-sm font-medium text-muted-foreground flex items-center gap-2">
                <ArrowDownRight className="h-4 w-4 text-red-400" /> Bottom 5 Cost Center
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-2">
              {isLoading
                ? Array.from({ length: 3 }).map((_, i) => (
                    <div key={i} className="h-8 bg-slate-700 animate-pulse rounded" />
                  ))
                : (d?.bottom_cost_centers ?? []).map((cc, i) => (
                    <div key={cc.cost_center_id} className="flex items-center justify-between">
                      <div className="flex items-center gap-2 min-w-0">
                        <span className="text-xs font-bold w-4 text-red-400 shrink-0">#{i + 1}</span>
                        <span className="text-xs truncate">{cc.name}</span>
                      </div>
                      <span className={`text-xs font-semibold shrink-0 ml-2 ${cc.profit >= 0 ? "text-emerald-300" : "text-red-300"}`}>
                        {idr(cc.profit)}
                      </span>
                    </div>
                  ))}
              {(d?.bottom_cost_centers ?? []).length === 0 && !isLoading && (
                <p className="text-xs text-muted-foreground text-center py-4">Belum ada data</p>
              )}
            </CardContent>
          </Card>
        </div>
      </div>
    </AppShell>
  );
}
