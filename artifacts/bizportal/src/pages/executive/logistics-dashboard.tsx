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
  BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, Cell,
  LineChart, Line, CartesianGrid, Legend,
} from "recharts";
import {
  Truck, TrendingUp, TrendingDown, DollarSign, Package,
  Map, Star, Lightbulb, ArrowRight, RefreshCw, CheckCircle2,
} from "lucide-react";
import { CompanySelect } from "@/components/CompanySelect";
import { BackButton } from "@/components/ui/back-button";

const idr = (v: number) =>
  new Intl.NumberFormat("id-ID", { style: "currency", currency: "IDR", maximumFractionDigits: 0 }).format(v);

type KPI = {
  orderCount: number; revenue: number; vendorCost: number; margin: number;
  marginPct: number; avgOrderValue: number; completionRate: number; cancelRate: number;
  completed: number; cancelled: number;
};
type RouteItem = { route: string; origin: string; destination: string; orderCount: number; revenue: number; margin: number; marginPct: number };
type CommodityItem = { commodity: string; orderCount: number; revenue: number; margin: number; marginPct: number };
type TrendPoint = { month: string; orderCount: number; revenue: number; margin: number };
type SummaryData = {
  kpi: KPI;
  topRoutes: RouteItem[];
  topCommodities: CommodityItem[];
  gradeDistribution: Record<string, number>;
  trendData: TrendPoint[];
  insights: string[];
};

const GRADE_ORDER = ["A+","A","B","C","D"];
const GRADE_COLOR_CLASS: Record<string, string> = {
  "A+": "bg-emerald-500",
  "A":  "bg-green-500",
  "B":  "bg-blue-500",
  "C":  "bg-yellow-500",
  "D":  "bg-red-500",
};
const CHART_COLORS = ["#3b82f6","#10b981","#f59e0b","#8b5cf6","#ef4444"];

const marginColor = (pct: number) =>
  pct >= 20 ? "text-emerald-400" : pct >= 10 ? "text-yellow-400" : pct >= 0 ? "text-orange-400" : "text-red-400";

function KpiCard({ label, value, sub, icon: Icon, color }: {
  label: string; value: string; sub?: string;
  icon: React.ElementType; color: string;
}) {
  return (
    <Card className="bg-slate-900 border-slate-800">
      <CardContent className="p-4">
        <div className="flex items-center gap-2 mb-1">
          <Icon className={`w-5 h-5 ${color}`} />
          <span className="text-xs text-slate-500">{label}</span>
        </div>
        <p className="text-xl font-bold text-white">{value}</p>
        {sub && <p className="text-xs text-slate-500 mt-0.5">{sub}</p>}
      </CardContent>
    </Card>
  );
}

export default function LogisticsDashboardPage() {
  const today       = new Date().toISOString().split("T")[0];
  const firstOfYear = `${new Date().getFullYear()}-01-01`;
  const [from, setFrom] = useState(firstOfYear);
  const [to, setTo]     = useState(today);
  const [companyId, setCompanyId] = useState("all");

  const summaryParams = new URLSearchParams({ from, to });
  if (companyId !== "all") summaryParams.set("companyId", companyId);

  const { data, isLoading, refetch } = useQuery<SummaryData>({
    queryKey: ["executive-logistics", from, to, companyId],
    queryFn: () =>
      fetch(`/api/executive/logistics-summary?${summaryParams}`, { credentials: "include" })
        .then(r => r.json()),
    staleTime: 60_000,
    refetchOnWindowFocus: false,
  });

  const kpi = data?.kpi;
  const gradeDistribution = data?.gradeDistribution ?? {};
  const totalGraded = GRADE_ORDER.reduce((s, g) => s + (gradeDistribution[g] ?? 0), 0);

  const trendData = (data?.trendData ?? []).map(t => ({
    ...t,
    month: t.month.slice(2),
  }));

  return (
    <AppShell>
      <BackButton href="/executive" />
      <div className="p-6 space-y-6">
        {/* Header */}
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-bold text-white flex items-center gap-2">
              <Truck className="w-6 h-6 text-indigo-400" />
              Executive Logistics Dashboard
            </h1>
            <p className="text-slate-400 text-sm mt-1">
              KPI operasional logistik, rute terlaris, komoditas, dan insight AI.
            </p>
          </div>
          <Button variant="outline" size="sm" onClick={() => refetch()} className="border-slate-700 text-slate-400 hover:text-white">
            <RefreshCw className="w-4 h-4 mr-1" /> Refresh
          </Button>
        </div>

        {/* Date Filters */}
        <Card className="bg-slate-900 border-slate-800">
          <CardContent className="pt-4 pb-4">
            <div className="flex flex-wrap gap-4 items-end">
              <div className="space-y-1">
                <Label className="text-xs text-slate-400">Dari</Label>
                <DatePicker value={from} onChange={v => setFrom(v)} className="bg-slate-800 border-slate-700 text-white w-36" />
              </div>
              <div className="space-y-1">
                <Label className="text-xs text-slate-400">Sampai</Label>
                <DatePicker value={to} onChange={v => setTo(v)} className="bg-slate-800 border-slate-700 text-white w-36" />
              </div>
              <CompanySelect value={companyId} onChange={setCompanyId} />
            </div>
          </CardContent>
        </Card>

        {isLoading ? (
          <div className="text-center py-16 text-slate-500">Memuat executive dashboard...</div>
        ) : !kpi ? (
          <div className="text-center py-16 text-slate-500">Tidak ada data</div>
        ) : (
          <>
            {/* KPI Cards */}
            <div className="grid grid-cols-4 gap-4">
              <KpiCard label="Total Order" value={kpi.orderCount.toString()}
                sub={`${kpi.completed} selesai · ${kpi.cancelled} cancel`}
                icon={Truck} color="text-indigo-400" />
              <KpiCard label="Total Revenue" value={idr(kpi.revenue)}
                sub={`AOV ${idr(kpi.avgOrderValue)}`}
                icon={DollarSign} color="text-emerald-400" />
              <KpiCard label="Gross Margin" value={idr(kpi.margin)}
                sub={`Margin ${kpi.marginPct.toFixed(1)}%`}
                icon={kpi.marginPct >= 15 ? TrendingUp : TrendingDown}
                color={kpi.marginPct >= 15 ? "text-emerald-400" : "text-red-400"} />
              <KpiCard label="Completion Rate" value={`${kpi.completionRate.toFixed(1)}%`}
                sub={`Cancel rate ${kpi.cancelRate.toFixed(1)}%`}
                icon={CheckCircle2}
                color={kpi.completionRate >= 80 ? "text-emerald-400" : "text-yellow-400"} />
            </div>

            {/* AI Insights */}
            {(data?.insights ?? []).length > 0 && (
              <Card className="bg-gradient-to-br from-indigo-950/60 to-slate-900 border-indigo-800/40">
                <CardHeader className="pb-2">
                  <CardTitle className="text-sm text-indigo-300 flex items-center gap-2">
                    <Lightbulb className="w-4 h-4" /> AI Insights
                  </CardTitle>
                </CardHeader>
                <CardContent>
                  <div className="space-y-2">
                    {data!.insights.map((insight, i) => (
                      <div key={i} className="flex items-start gap-2 text-sm text-slate-300">
                        <span className="text-indigo-500 mt-0.5 flex-shrink-0">▸</span>
                        <span>{insight}</span>
                      </div>
                    ))}
                  </div>
                </CardContent>
              </Card>
            )}

            {/* Revenue Trend */}
            {trendData.length > 0 && (
              <Card className="bg-slate-900 border-slate-800">
                <CardHeader className="pb-2">
                  <CardTitle className="text-sm text-slate-400">Tren Revenue & Margin (6 Bulan Terakhir)</CardTitle>
                </CardHeader>
                <CardContent>
                  <ResponsiveContainer width="100%" height={220}>
                    <LineChart data={trendData} margin={{ top: 5, right: 20, left: 0, bottom: 0 }}>
                      <CartesianGrid strokeDasharray="3 3" stroke="#1e293b" />
                      <XAxis dataKey="month" tick={{ fill: "#94a3b8", fontSize: 11 }} />
                      <YAxis tick={{ fill: "#94a3b8", fontSize: 11 }} tickFormatter={v => `${(v/1e6).toFixed(0)}M`} />
                      <Tooltip formatter={(v: number) => idr(v)} contentStyle={{ background: "#1e293b", border: "1px solid #334155" }} />
                      <Legend />
                      <Line type="monotone" dataKey="revenue" stroke="#3b82f6" strokeWidth={2} dot={false} name="Revenue" />
                      <Line type="monotone" dataKey="margin"  stroke="#10b981" strokeWidth={2} dot={false} name="Margin" />
                    </LineChart>
                  </ResponsiveContainer>
                </CardContent>
              </Card>
            )}

            <div className="grid grid-cols-2 gap-4">
              {/* Top Routes */}
              <Card className="bg-slate-900 border-slate-800">
                <CardHeader className="pb-2">
                  <CardTitle className="text-sm text-slate-400 flex items-center gap-2">
                    <Map className="w-4 h-4 text-blue-400" /> Top Rute
                  </CardTitle>
                </CardHeader>
                <CardContent className="space-y-2">
                  {(data?.topRoutes ?? []).map((r, i) => (
                    <div key={r.route} className="flex items-center gap-3">
                      <span className="text-xs text-slate-600 w-4">{i+1}</span>
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-1 text-xs text-white font-medium truncate">
                          <span>{r.origin}</span>
                          <ArrowRight className="w-3 h-3 text-slate-500 flex-shrink-0" />
                          <span>{r.destination}</span>
                        </div>
                        <div className="text-xs text-slate-500">
                          {r.orderCount} order · {idr(r.revenue)}
                        </div>
                      </div>
                      <span className={`text-xs font-semibold flex-shrink-0 ${marginColor(r.marginPct)}`}>
                        {r.marginPct.toFixed(1)}%
                      </span>
                    </div>
                  ))}
                  {(data?.topRoutes ?? []).length === 0 && (
                    <p className="text-sm text-slate-500">Tidak ada data</p>
                  )}
                </CardContent>
              </Card>

              {/* Top Commodities */}
              <Card className="bg-slate-900 border-slate-800">
                <CardHeader className="pb-2">
                  <CardTitle className="text-sm text-slate-400 flex items-center gap-2">
                    <Package className="w-4 h-4 text-purple-400" /> Top Komoditas
                  </CardTitle>
                </CardHeader>
                <CardContent className="space-y-2">
                  {(data?.topCommodities ?? []).map((c, i) => (
                    <div key={c.commodity} className="flex items-center gap-3">
                      <span className="text-xs text-slate-600 w-4">{i+1}</span>
                      <div className="flex-1 min-w-0">
                        <p className="text-xs text-white font-medium truncate">{c.commodity}</p>
                        <p className="text-xs text-slate-500">{c.orderCount} order · {idr(c.revenue)}</p>
                      </div>
                      <span className={`text-xs font-semibold flex-shrink-0 ${marginColor(c.marginPct)}`}>
                        {c.marginPct.toFixed(1)}%
                      </span>
                    </div>
                  ))}
                  {(data?.topCommodities ?? []).length === 0 && (
                    <p className="text-sm text-slate-500">Tidak ada data</p>
                  )}
                </CardContent>
              </Card>
            </div>

            {/* Vendor Grade Distribution */}
            {totalGraded > 0 && (
              <Card className="bg-slate-900 border-slate-800">
                <CardHeader className="pb-2">
                  <CardTitle className="text-sm text-slate-400 flex items-center gap-2">
                    <Star className="w-4 h-4 text-yellow-400" /> Distribusi Grade Vendor
                  </CardTitle>
                </CardHeader>
                <CardContent>
                  <div className="flex gap-3 flex-wrap">
                    {GRADE_ORDER.map(g => {
                      const cnt = gradeDistribution[g] ?? 0;
                      const pctVal = totalGraded > 0 ? (cnt / totalGraded * 100) : 0;
                      return (
                        <div key={g} className="flex flex-col items-center gap-1">
                          <div className={`w-14 h-14 rounded-lg ${GRADE_COLOR_CLASS[g] ?? "bg-slate-700"} flex items-center justify-center`}>
                            <div className="text-center">
                              <div className="text-lg font-bold text-white">{cnt}</div>
                            </div>
                          </div>
                          <span className="text-xs font-bold text-white">Grade {g}</span>
                          <span className="text-xs text-slate-500">{pctVal.toFixed(0)}%</span>
                        </div>
                      );
                    })}
                  </div>
                  <div className="mt-4">
                    <div className="flex h-3 rounded-full overflow-hidden gap-0.5">
                      {GRADE_ORDER.filter(g => (gradeDistribution[g] ?? 0) > 0).map(g => {
                        const cnt = gradeDistribution[g] ?? 0;
                        const pctVal = totalGraded > 0 ? cnt / totalGraded * 100 : 0;
                        const bg = { "A+": "bg-emerald-500","A":"bg-green-500","B":"bg-blue-500","C":"bg-yellow-500","D":"bg-red-500" }[g] ?? "bg-slate-700";
                        return <div key={g} className={`${bg} rounded-sm`} style={{ width: `${pctVal}%` }} />;
                      })}
                    </div>
                  </div>
                </CardContent>
              </Card>
            )}
          </>
        )}
      </div>
    </AppShell>
  );
}
