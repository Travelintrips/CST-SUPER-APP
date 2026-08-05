import { DatePicker } from "@/components/ui/date-picker";
import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { AppShell } from "@/components/layout/AppShell";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import {
  PieChart, Pie, Cell, Tooltip, ResponsiveContainer, BarChart, Bar, XAxis, YAxis,
} from "recharts";
import { Package2, TrendingUp, TrendingDown, Search, RefreshCw, ArrowLeft } from "lucide-react";
import { useLocation } from "wouter";
import { CompanySelect } from "@/components/CompanySelect";
import { BackButton } from "@/components/ui/back-button";

const idr = (v: number) =>
  new Intl.NumberFormat("id-ID", { style: "currency", currency: "IDR", maximumFractionDigits: 0 }).format(v);

type CommodityRow = {
  commodity: string; orderCount: number;
  revenue: number; vendorCost: number; truckCost: number; tax: number;
  grossMargin: number; marginPct: number;
};

type SummaryType = {
  totalRevenue: number; totalVendorCost: number; totalTruckCost: number;
  totalTax: number; totalGrossMargin: number; totalOrders: number; avgMarginPct: number;
};

const COLORS = ["#3b82f6","#10b981","#f59e0b","#8b5cf6","#ef4444","#06b6d4","#84cc16","#f97316","#ec4899","#6366f1"];
const marginColor = (pct: number) =>
  pct >= 20 ? "text-emerald-400" : pct >= 10 ? "text-yellow-400" : pct >= 0 ? "text-orange-400" : "text-red-400";

export default function CommodityProfitabilityPage() {
  const today       = new Date().toISOString().split("T")[0];
  const firstOfYear = `${new Date().getFullYear()}-01-01`;
  const [dateFrom, setDateFrom] = useState(firstOfYear);
  const [dateTo,   setDateTo]   = useState(today);
  const [search,   setSearch]   = useState("");
  const [sortKey,  setSortKey]  = useState<"revenue" | "margin" | "marginPct" | "orderCount">("revenue");
  const [companyId, setCompanyId] = useState("all");

  const params = new URLSearchParams({ dateFrom, dateTo });
  if (companyId !== "all") params.set("companyId", companyId);

  const { data, isLoading, refetch } = useQuery<{ items: CommodityRow[]; summary: SummaryType }>({
    queryKey: ["analytics-commodities", dateFrom, dateTo, companyId],
    queryFn:  () => fetch(`/api/analytics/profitability/commodities?${params}`, { credentials: "include" }).then(r => r.json()),
  });

  const allItems = data?.items ?? [];
  const summary  = data?.summary;

  const sortValue = (r: CommodityRow, key: typeof sortKey) =>
    key === "margin" ? r.grossMargin : r[key];

  const items = allItems
    .filter(r => !search || r.commodity.toLowerCase().includes(search.toLowerCase()))
    .sort((a, b) => sortValue(b, sortKey) - sortValue(a, sortKey));

  const pieData = allItems.slice(0, 8).map(r => ({ name: r.commodity, value: r.revenue }));
  const barData = allItems.slice(0, 10).map(r => ({
    name: r.commodity.length > 12 ? r.commodity.slice(0, 12) + "…" : r.commodity,
    margin: r.grossMargin,
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
              <Package2 className="w-6 h-6 text-purple-400" />
              Commodity Profitability Intelligence
            </h1>
            <p className="text-slate-400 text-sm mt-1">Analisis profitabilitas per komoditas — mana yang paling menguntungkan.</p>
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
              <CompanySelect value={companyId} onChange={setCompanyId} />
              <div className="space-y-1 flex-1 min-w-40">
                <Label className="text-xs text-slate-400">Cari komoditas</Label>
                <div className="relative">
                  <Search className="absolute left-2 top-2.5 w-4 h-4 text-slate-500" />
                  <Input value={search} onChange={e => setSearch(e.target.value)}
                    placeholder="Nama komoditas..."
                    className="bg-slate-800 border-slate-700 text-white pl-8" />
                </div>
              </div>
            </div>
          </CardContent>
        </Card>

        {/* KPI Cards */}
        {summary && (
          <div className="grid grid-cols-4 gap-4">
            {[
              { label: "Total Komoditas", value: allItems.length.toString(), icon: Package2, color: "text-purple-400" },
              { label: "Total Order", value: summary.totalOrders.toString(), icon: TrendingUp, color: "text-blue-400" },
              { label: "Total Revenue", value: idr(summary.totalRevenue), icon: TrendingUp, color: "text-emerald-400" },
              { label: "Avg Margin", value: `${summary.avgMarginPct.toFixed(1)}%`,
                icon: summary.avgMarginPct >= 15 ? TrendingUp : TrendingDown,
                color: summary.avgMarginPct >= 15 ? "text-emerald-400" : "text-red-400" },
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
        )}

        {/* Charts */}
        {!isLoading && allItems.length > 0 && (
          <div className="grid grid-cols-2 gap-4">
            <Card className="bg-slate-900 border-slate-800">
              <CardHeader className="pb-2">
                <CardTitle className="text-sm text-slate-400">Distribusi Revenue (Top 8)</CardTitle>
              </CardHeader>
              <CardContent>
                <ResponsiveContainer width="100%" height={200}>
                  <PieChart>
                    <Pie data={pieData} dataKey="value" nameKey="name" cx="50%" cy="50%" outerRadius={75} label={({ name, percent }) => `${(percent*100).toFixed(0)}%`}>
                      {pieData.map((_, i) => <Cell key={i} fill={COLORS[i % COLORS.length]} />)}
                    </Pie>
                    <Tooltip formatter={(v: number) => idr(v)} contentStyle={{ background: "#1e293b", border: "1px solid #334155" }} />
                  </PieChart>
                </ResponsiveContainer>
              </CardContent>
            </Card>
            <Card className="bg-slate-900 border-slate-800">
              <CardHeader className="pb-2">
                <CardTitle className="text-sm text-slate-400">Gross Margin Top 10 Komoditas</CardTitle>
              </CardHeader>
              <CardContent>
                <ResponsiveContainer width="100%" height={200}>
                  <BarChart data={barData} layout="vertical" margin={{ top: 0, right: 20, left: 0, bottom: 0 }}>
                    <XAxis type="number" tick={{ fill: "#94a3b8", fontSize: 10 }} tickFormatter={v => `${(v/1e6).toFixed(0)}M`} />
                    <YAxis type="category" dataKey="name" tick={{ fill: "#94a3b8", fontSize: 10 }} width={90} />
                    <Tooltip formatter={(v: number) => idr(v)} contentStyle={{ background: "#1e293b", border: "1px solid #334155" }} />
                    <Bar dataKey="margin" radius={[0,3,3,0]}>
                      {barData.map((_, i) => <Cell key={i} fill={COLORS[i % COLORS.length]} />)}
                    </Bar>
                  </BarChart>
                </ResponsiveContainer>
              </CardContent>
            </Card>
          </div>
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
                    <th className="text-left py-3 px-4">Komoditas</th>
                    <th className="text-right py-3 px-4">Order</th>
                    <th className="text-right py-3 px-4">Revenue</th>
                    <th className="text-right py-3 px-4">Biaya Vendor</th>
                    <th className="text-right py-3 px-4">Gross Margin</th>
                    <th className="text-right py-3 px-4">Margin %</th>
                  </tr>
                </thead>
                <tbody>
                  {items.length === 0 ? (
                    <tr><td colSpan={7} className="text-center py-8 text-slate-500">Tidak ada data</td></tr>
                  ) : items.map((r, i) => (
                    <tr key={r.commodity} className="border-b border-slate-800/60 hover:bg-slate-800/40 transition-colors">
                      <td className="py-3 px-4 text-slate-500 text-xs">{i + 1}</td>
                      <td className="py-3 px-4 text-white font-medium">{r.commodity}</td>
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
        {items.length > 0 && (
          <p className="text-xs text-slate-600 text-right">{items.length} komoditas ditampilkan</p>
        )}
      </div>
    </AppShell>
  );
}
