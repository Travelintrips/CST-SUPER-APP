import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { AppShell } from "@/components/layout/AppShell";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { ChevronDown, ChevronRight, Search, Layers, RefreshCw, Package, ArrowLeft } from "lucide-react";
import { QueryState } from "@/components/ui/query-state";
import { CompanySelect } from "@/components/CompanySelect";
import { BackButton } from "@/components/ui/back-button";

const idr = (v: number) =>
  new Intl.NumberFormat("id-ID", { style: "currency", currency: "IDR", maximumFractionDigits: 0 }).format(v);

type CommodityEntry = {
  commodity: string; orderCount: number;
  revenue: number; vendorCost: number; margin: number; marginPct: number;
  completed: number; cancelled: number;
};

type VendorEntry = {
  vendorId: number; vendorName: string; vendorGrade: string;
  commodities: CommodityEntry[];
};

const GRADE_COLOR: Record<string, string> = {
  "A+": "bg-emerald-500 text-white",
  "A":  "bg-green-500 text-white",
  "B":  "bg-blue-500 text-white",
  "C":  "bg-yellow-500 text-black",
  "D":  "bg-red-500 text-white",
};

const marginColor = (pct: number) =>
  pct >= 20 ? "text-emerald-400" : pct >= 10 ? "text-yellow-400" : pct >= 0 ? "text-orange-400" : "text-red-400";

function VendorRow({ vendor }: { vendor: VendorEntry }) {
  const [open, setOpen] = useState(false);
  const totalOrders   = vendor.commodities.reduce((s, c) => s + c.orderCount, 0);
  const totalRevenue  = vendor.commodities.reduce((s, c) => s + c.revenue,    0);
  const totalMargin   = vendor.commodities.reduce((s, c) => s + c.margin,     0);
  const avgMarginPct  = totalRevenue > 0 ? totalMargin / totalRevenue * 100 : 0;
  const gradeClass = GRADE_COLOR[vendor.vendorGrade] ?? "bg-slate-700 text-white";

  return (
    <>
      <tr
        className="border-b border-slate-800 hover:bg-slate-800/40 cursor-pointer transition-colors"
        onClick={() => setOpen(!open)}
      >
        <td className="py-3 px-4">
          <span className="text-slate-500">{open ? <ChevronDown className="w-4 h-4 inline" /> : <ChevronRight className="w-4 h-4 inline" />}</span>
        </td>
        <td className="py-3 px-4">
          <div className="flex items-center gap-2">
            <span className="font-medium text-white">{vendor.vendorName}</span>
            <Badge className={`text-xs px-1.5 py-0 ${gradeClass}`}>{vendor.vendorGrade}</Badge>
          </div>
        </td>
        <td className="py-3 px-4 text-right text-slate-300">{vendor.commodities.length}</td>
        <td className="py-3 px-4 text-right text-slate-300">{totalOrders}</td>
        <td className="py-3 px-4 text-right text-white">{idr(totalRevenue)}</td>
        <td className="py-3 px-4 text-right text-white font-medium">{idr(totalMargin)}</td>
        <td className="py-3 px-4 text-right">
          <span className={`font-semibold ${marginColor(avgMarginPct)}`}>{avgMarginPct.toFixed(1)}%</span>
        </td>
      </tr>
      {open && vendor.commodities.map(c => (
        <tr key={c.commodity} className="border-b border-slate-800/40 bg-slate-800/20">
          <td className="py-2 px-4" />
          <td className="py-2 px-4 pl-10">
            <div className="flex items-center gap-2">
              <Package className="w-3 h-3 text-slate-500" />
              <span className="text-sm text-slate-300">{c.commodity}</span>
            </div>
          </td>
          <td className="py-2 px-4" />
          <td className="py-2 px-4 text-right text-xs text-slate-400">{c.orderCount}</td>
          <td className="py-2 px-4 text-right text-xs text-slate-400">{idr(c.revenue)}</td>
          <td className="py-2 px-4 text-right text-xs text-slate-400">{idr(c.margin)}</td>
          <td className="py-2 px-4 text-right text-xs">
            <span className={marginColor(c.marginPct)}>{c.marginPct.toFixed(1)}%</span>
          </td>
        </tr>
      ))}
    </>
  );
}

export default function VendorCommodityIntelligencePage() {
  const [search, setSearch] = useState("");
  const [sortKey, setSortKey] = useState<"orders" | "revenue" | "commodities">("revenue");
  const [companyId, setCompanyId] = useState("all");

  const params = new URLSearchParams();
  if (companyId !== "all") params.set("companyId", companyId);

  const { data, isLoading, refetch } = useQuery<{ vendors: VendorEntry[]; total: number }>({
    queryKey: ["vendor-commodity-intelligence", companyId],
    queryFn: () => fetch(`/api/vendor-intelligence/commodities?${params}`, { credentials: "include" }).then(r => r.json()),
  });

  const vendors = (data?.vendors ?? [])
    .filter(v => !search || v.vendorName.toLowerCase().includes(search.toLowerCase()))
    .sort((a, b) => {
      if (sortKey === "orders") return b.commodities.reduce((s,c) => s+c.orderCount,0) - a.commodities.reduce((s,c) => s+c.orderCount,0);
      if (sortKey === "revenue") return b.commodities.reduce((s,c) => s+c.revenue,0) - a.commodities.reduce((s,c) => s+c.revenue,0);
      return b.commodities.length - a.commodities.length;
    });

  const totalVendors = vendors.length;
  const allCommodities = [...new Set((data?.vendors ?? []).flatMap(v => v.commodities.map(c => c.commodity)))].length;
  const totalOrders = vendors.reduce((s,v) => s+v.commodities.reduce((ss,c) => ss+c.orderCount,0), 0);

  return (
    <AppShell>
      <BackButton href="/logistics" />
      <div className="p-6 space-y-6">
        <Button variant="ghost" size="sm" className="-ml-2" onClick={() => window.history.back()}>
          <ArrowLeft className="h-4 w-4 mr-1" />Kembali
        </Button>
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-bold text-white flex items-center gap-2">
              <Layers className="w-6 h-6 text-cyan-400" />
              Vendor × Commodity Intelligence
            </h1>
            <p className="text-slate-400 text-sm mt-1">
              Matriks vendor–komoditas: vendor mana menangani komoditas apa, dengan performa seperti apa.
            </p>
          </div>
          <Button variant="outline" size="sm" onClick={() => refetch()} className="border-slate-700 text-slate-400 hover:text-white">
            <RefreshCw className="w-4 h-4 mr-1" /> Refresh
          </Button>
        </div>

        {/* KPI Cards */}
        <div className="grid grid-cols-3 gap-4">
          <Card className="bg-slate-900 border-slate-800">
            <CardContent className="p-4">
              <p className="text-xs text-slate-500">Total Vendor Aktif</p>
              <p className="text-2xl font-bold text-white">{totalVendors}</p>
            </CardContent>
          </Card>
          <Card className="bg-slate-900 border-slate-800">
            <CardContent className="p-4">
              <p className="text-xs text-slate-500">Total Komoditas Unik</p>
              <p className="text-2xl font-bold text-white">{allCommodities}</p>
            </CardContent>
          </Card>
          <Card className="bg-slate-900 border-slate-800">
            <CardContent className="p-4">
              <p className="text-xs text-slate-500">Total Order</p>
              <p className="text-2xl font-bold text-white">{totalOrders}</p>
            </CardContent>
          </Card>
        </div>

        {/* Filter + Sort */}
        <div className="flex flex-wrap gap-4 items-end">
          <CompanySelect value={companyId} onChange={setCompanyId} />
          <div className="relative flex-1 min-w-52">
            <Search className="absolute left-2 top-2.5 w-4 h-4 text-slate-500" />
            <Input value={search} onChange={e => setSearch(e.target.value)}
              placeholder="Cari vendor..."
              className="bg-slate-800 border-slate-700 text-white pl-8" />
          </div>
          <div className="flex items-center gap-2">
            <span className="text-xs text-slate-500">Urutkan:</span>
            {(["revenue","orders","commodities"] as const).map(k => (
              <button key={k}
                onClick={() => setSortKey(k)}
                className={`text-xs px-3 py-1 rounded-full border transition-colors ${
                  sortKey === k ? "bg-indigo-600 border-indigo-600 text-white" : "border-slate-700 text-slate-400 hover:border-slate-500"
                }`}
              >
                {{ revenue:"Revenue", orders:"Order", commodities:"# Komoditas" }[k]}
              </button>
            ))}
          </div>
        </div>

        {/* Table */}
        <QueryState loading={isLoading} empty={vendors.length === 0} emptyMessage="Tidak ada data vendor komoditas.">
          <Card className="bg-slate-900 border-slate-800">
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-slate-800 text-xs text-slate-500">
                    <th className="w-8 py-3 px-4" />
                    <th className="text-left py-3 px-4">Vendor</th>
                    <th className="text-right py-3 px-4"># Komoditas</th>
                    <th className="text-right py-3 px-4"># Order</th>
                    <th className="text-right py-3 px-4">Revenue</th>
                    <th className="text-right py-3 px-4">Margin</th>
                    <th className="text-right py-3 px-4">Avg Margin%</th>
                  </tr>
                </thead>
                <tbody>
                  {vendors.map(v => <VendorRow key={v.vendorId} vendor={v} />)}
                </tbody>
              </table>
            </div>
          </Card>
        </QueryState>
        {vendors.length > 0 && (
          <p className="text-xs text-slate-600 text-right">
            {vendors.length} vendor — klik baris untuk expand komoditas
          </p>
        )}
      </div>
    </AppShell>
  );
}
