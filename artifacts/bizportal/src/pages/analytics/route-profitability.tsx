import { DatePicker } from "@/components/ui/date-picker";
import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { AppShell } from "@/components/layout/AppShell";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import {
  BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, Cell,
} from "recharts";
import { Map, TrendingUp, TrendingDown, Search, ArrowRight, RefreshCw, ArrowLeft } from "lucide-react";
import { BackButton } from "@/components/ui/back-button";

const idr = (v: number) =>
  new Intl.NumberFormat("id-ID", { style: "currency", currency: "IDR", maximumFractionDigits: 0 }).format(v);
const pct = (v: number) => `${v >= 0 ? "+" : ""}${v.toFixed(1)}%`;

type RouteRow = {
  origin: string; destination: string; orderCount: number;
  revenue: number; vendorCost: number; truckCost: number; tax: number;
  grossMargin: number; marginPct: number;
};

const CHART_COLORS = ["#3b82f6","#10b981","#f59e0b","#8b5cf6","#ef4444","#06b6d4","#84cc16","#f97316"];

const marginColor = (pct: number) =>
  pct >= 20 ? "text-emerald-400" : pct >= 10 ? "text-yellow-400" : pct >= 0 ? "text-orange-400" : "text-red-400";

export default function RouteProfitabilityPage() {
  const today       = new Date().toISOString().split("T")[0];
  const firstOfYear = `${new Date().getFullYear()}-01-01`;
  const [dateFrom, setDateFrom] = useState(firstOfYear);
  const [dateTo,   setDateTo]   = useState(today);
  const [search,   setSearch]   = useState("");
  const [sortKey,  setSortKey]  = useState<"revenue" | "margin" | "marginPct" | "orderCount">("revenue");

  const params = new URLSearchParams({ dateFrom, dateTo, limit: "200" });

  const { data, isLoading, refetch } = useQuery<{
    rows: RouteRow[]; total: number;
  }>({
    queryKey: ["analytics-routes", dateFrom, dateTo],
    queryFn:  () => fetch(`/api/analytics/profitability/routes?${params}`, { credentials: "include" }).then(r => r.json()),
  });

  const sortValue = (r: RouteRow, key: typeof sortKey) =>
    key === "margin" ? r.grossMargin : r[key];

  const rows = (data?.rows ?? [])
    .filter(r => {
      if (!search) return true;
      const s = search.toLowerCase();
      return r.origin.toLowerCase().includes(s) || r.destination.toLowerCase().includes(s);
    })
    .sort((a, b) => sortValue(b, sortKey) - sortValue(a, sortKey));

  const totalRevenue = rows.reduce((s, r) => s + r.revenue, 0);
  const totalMargin  = rows.reduce((s, r) => s + r.grossMargin, 0);
  const avgMarginPct = totalRevenue > 0 ? totalMargin / totalRevenue * 100 : 0;
  const totalOrders  = rows.reduce((s, r) => s + r.orderCount, 0);

  const chartData = rows.slice(0, 10).map(r => ({
    route:  `${r.origin.slice(0, 8)}→${r.destination.slice(0, 8)}`,
    margin: r.grossMargin,
    revenue: r.revenue,
  }));

  return (
    <AppShell>
      <BackButton href="/analytics" />
      <div className="p-6 space-y-6">
        <Button variant="ghost" size="sm" className="-ml-2" onClick={() => window.history.back()}>
          <ArrowLeft className="h-4 w-4 mr-1" />Kembali
        </Button>
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-bold text-white flex items-center gap-2">
              <Map className="w-6 h-6 text-blue-400" />
              Route Profitability Intelligence
            </h1>
            <p className="text-slate-400 text-sm mt-1">Analisis profitabilitas per rute — pendapatan, biaya, dan margin.</p>
          </div>
          <Button variant="outline" size="sm" onClick={() => refetch()} className="border-slate-700 text-slate-400 hover:text-white">
            <RefreshCw className="w-4 h-4 mr-1" /> Refresh
          </Button>
        </div>

        {/* Filters */}
        <Card className="bg-slate-900 border-slate-800">
          <CardContent className="pt-4 pb-4">
            <div className="flex flex-wrap gap-4 items-end">
              <div className="space-y-1">
                <Label className="text-xs text-slate-400">Dari</Label>
                <DatePicker value={dateFrom} onChange={v => setDateFrom(v)} className="bg-slate-800 border-slate-700 text-white w-36" />
              </div>
              <div className="space-y-1">
                <Label className="text-xs text-slate-400">Sampai</Label>
                <DatePicker value={dateTo} onChange={v => setDateTo(v)} className="bg-slate-800 border-slate-700 text-white w-36" />
              </div>
              <div className="space-y-1 flex-1 min-w-40">
                <Label className="text-xs text-slate-400">Cari rute</Label>
                <div className="relative">
                  <Search className="absolute left-2 top-2.5 w-4 h-4 text-slate-500" />
                  <Input value={search} onChange={e => setSearch(e.target.value)}
                    placeholder="Asal atau tujuan..."
                    className="bg-slate-800 border-slate-700 text-white pl-8" />
                </div>
              </div>
            </div>
          </CardContent>
        </Card>

        {/* KPI Cards */}
        <div className="grid grid-cols-4 gap-4">
          {[
            { label: "Total Rute", value: rows.length.toString(), icon: Map, color: "text-blue-400" },
            { label: "Total Order", value: totalOrders.toString(), icon: TrendingUp, color: "text-indigo-400" },
            { label: "Total Revenue", value: idr(totalRevenue), icon: TrendingUp, color: "text-emerald-400" },
            { label: "Avg Margin", value: `${avgMarginPct.toFixed(1)}%`, icon: avgMarginPct >= 15 ? TrendingUp : TrendingDown,
              color: avgMarginPct >= 15 ? "text-emerald-400" : "text-red-400" },
          ].map(k => (
            <Card key={k.label} className="bg-slate-900 border-slate-800">
              <CardContent className="p-4">
                <div className="flex items-center gap-2">
                  <k.icon className={`w-5 h-5 ${k.color}`} />
                  <span className="text-xs text-slate-500">{k.label}</span>
                </div>
                <p className="text-xl font-bold text-white mt-1">{k.value}</p>
              </CardContent>
            </Card>
          ))}
        </div>

        {/* Chart */}
        {chartData.length > 0 && (
          <Card className="bg-slate-900 border-slate-800">
            <CardHeader className="pb-2">
              <CardTitle className="text-sm text-slate-400">Top 10 Rute — Margin (IDR)</CardTitle>
            </CardHeader>
            <CardContent>
              <ResponsiveContainer width="100%" height={200}>
                <BarChart data={chartData} margin={{ top: 0, right: 0, left: 0, bottom: 0 }}>
                  <XAxis dataKey="route" tick={{ fill: "#94a3b8", fontSize: 10 }} />
                  <YAxis tick={{ fill: "#94a3b8", fontSize: 10 }} tickFormatter={v => `${(v/1e6).toFixed(0)}M`} />
                  <Tooltip formatter={(v: number) => idr(v)} contentStyle={{ background: "#1e293b", border: "1px solid #334155" }} />
                  <Bar dataKey="margin" radius={[3,3,0,0]}>
                    {chartData.map((_, i) => (
                      <Cell key={i} fill={CHART_COLORS[i % CHART_COLORS.length]} />
                    ))}
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            </CardContent>
          </Card>
        )}

        {/* Sort controls */}
        <div className="flex items-center gap-2">
          <span className="text-xs text-slate-500">Urutkan:</span>
          {(["revenue","margin","marginPct","orderCount"] as const).map(k => (
            <button key={k}
              onClick={() => setSortKey(k)}
              className={`text-xs px-3 py-1 rounded-full border transition-colors ${
                sortKey === k ? "bg-indigo-600 border-indigo-600 text-white" : "border-slate-700 text-slate-400 hover:border-slate-500"
              }`}
            >
              {{ revenue:"Revenue", margin:"Margin", marginPct:"Margin%", orderCount:"Order" }[k]}
            </button>
          ))}
        </div>

        {/* Table */}
        {isLoading ? (
          <div className="text-center py-12 text-slate-500">Memuat data...</div>
        ) : (
          <Card className="bg-slate-900 border-slate-800">
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-slate-800 text-xs text-slate-500">
                    <th className="text-left py-3 px-4">#</th>
                    <th className="text-left py-3 px-4">Rute</th>
                    <th className="text-right py-3 px-4">Order</th>
                    <th className="text-right py-3 px-4">Revenue</th>
                    <th className="text-right py-3 px-4">Biaya Vendor</th>
                    <th className="text-right py-3 px-4">Gross Margin</th>
                    <th className="text-right py-3 px-4">Margin %</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.length === 0 ? (
                    <tr><td colSpan={7} className="text-center py-8 text-slate-500">Tidak ada data</td></tr>
                  ) : rows.map((r, i) => (
                    <tr key={`${r.origin}-${r.destination}`}
                      className="border-b border-slate-800/60 hover:bg-slate-800/40 transition-colors">
                      <td className="py-3 px-4 text-slate-500 text-xs">{i + 1}</td>
                      <td className="py-3 px-4">
                        <div className="flex items-center gap-1 text-white font-medium">
                          <span>{r.origin}</span>
                          <ArrowRight className="w-3 h-3 text-slate-500" />
                          <span>{r.destination}</span>
                        </div>
                      </td>
                      <td className="py-3 px-4 text-right text-slate-300">{r.orderCount}</td>
                      <td className="py-3 px-4 text-right text-white">{idr(r.revenue)}</td>
                      <td className="py-3 px-4 text-right text-slate-400">{idr(r.vendorCost)}</td>
                      <td className="py-3 px-4 text-right text-white font-medium">{idr(r.grossMargin)}</td>
                      <td className="py-3 px-4 text-right">
                        <span className={`font-semibold ${marginColor(r.marginPct)}`}>
                          {r.marginPct.toFixed(1)}%
                        </span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Card>
        )}
        {rows.length > 0 && (
          <p className="text-xs text-slate-600 text-right">{rows.length} rute ditampilkan</p>
        )}
      </div>
    </AppShell>
  );
}
