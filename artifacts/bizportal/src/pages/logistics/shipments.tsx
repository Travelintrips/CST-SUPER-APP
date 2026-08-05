import { DatePicker } from "@/components/ui/date-picker";
import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useLocation } from "wouter";
import { AppShell } from "@/components/layout/AppShell";
import { QueryState } from "@/components/ui/query-state";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import {
  Layers, RefreshCw, Search, Loader2, TrendingUp, ChevronRight, ArrowLeft,
} from "lucide-react";
import { formatDistanceToNow } from "date-fns";
import { id as idLocale } from "date-fns/locale";
import { BackButton } from "@/components/ui/back-button";

// ─── Types ────────────────────────────────────────────────────────────────────

interface UnifiedShipment {
  id: number;
  orderNumber: string;
  customerName: string;
  customerCompany: string | null;
  origin: string | null;
  destination: string | null;
  mode: string | null;
  status: string;
  vendor: string | null;
  revenue: string | null;
  cost: string | null;
  createdAt: string;
  customsStatus: string | null;
  module: string;
  detailPath: string;
  serviceCategory: string;
}

// ─── Constants ────────────────────────────────────────────────────────────────

const MODULE_LABELS: Record<string, string> = {
  general: "General Freight",
  air_freight: "Air Freight",
  ocean_freight: "Ocean Freight",
  trucking: "Trucking",
  ppjk: "PPJK",
};

const MODULE_COLORS: Record<string, string> = {
  general: "bg-slate-100 text-slate-700",
  air_freight: "bg-sky-100 text-sky-700",
  ocean_freight: "bg-blue-100 text-blue-700",
  trucking: "bg-amber-100 text-amber-700",
  ppjk: "bg-purple-100 text-purple-700",
};

const CUSTOMS_STATUS_LABELS: Record<string, string> = {
  draft: "Draft", submitted: "Diajukan", processing: "Diproses",
  approved: "Disetujui", rejected: "Ditolak", completed: "Selesai",
};

const IDR = (n: string | null | undefined) => {
  if (!n || n === "null") return null;
  const num = Number(n);
  if (isNaN(num)) return null;
  return new Intl.NumberFormat("id-ID", { style: "currency", currency: "IDR", maximumFractionDigits: 0 }).format(num);
};

function profit(revenue: string | null, cost: string | null): string | null {
  if (!revenue || !cost || revenue === "null" || cost === "null") return null;
  const r = Number(revenue), c = Number(cost);
  if (isNaN(r) || isNaN(c)) return null;
  return String(r - c);
}

// ─── Stats ────────────────────────────────────────────────────────────────────

function StatsBar({ shipments }: { shipments: UnifiedShipment[] }) {
  const byModule = Object.keys(MODULE_LABELS).map((m) => ({
    module: m,
    count: shipments.filter((s) => s.module === m).length,
  }));
  const totalRevenue = shipments.reduce((sum, s) => sum + (Number(s.revenue) || 0), 0);

  return (
    <div className="grid grid-cols-2 md:grid-cols-6 gap-3">
      <Card className="col-span-2 md:col-span-1 bg-emerald-50 border-emerald-200">
        <CardContent className="p-4">
          <p className="text-xs text-muted-foreground">Total Shipment</p>
          <p className="text-2xl font-bold mt-1">{shipments.length}</p>
        </CardContent>
      </Card>
      {byModule.map(({ module, count }) => (
        <Card key={module} className={`border ${MODULE_COLORS[module].replace("text-", "border-").replace("bg-", "bg-")}`}>
          <CardContent className="p-4">
            <p className="text-xs text-muted-foreground">{MODULE_LABELS[module]}</p>
            <p className="text-xl font-bold mt-1">{count}</p>
          </CardContent>
        </Card>
      ))}
      {totalRevenue > 0 && (
        <Card className="bg-green-50 border-green-200">
          <CardContent className="p-4">
            <p className="text-xs text-muted-foreground flex items-center gap-1"><TrendingUp className="w-3 h-3" /> Total Revenue</p>
            <p className="text-sm font-bold mt-1">{IDR(String(totalRevenue))}</p>
          </CardContent>
        </Card>
      )}
    </div>
  );
}

// ─── Main Page ────────────────────────────────────────────────────────────────

export default function UnifiedShipmentsPage() {
  const [, navigate] = useLocation();
  const [search, setSearch] = useState("");
  const [moduleFilter, setModuleFilter] = useState("all");
  const [statusFilter, setStatusFilter] = useState("all");
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");
  const [searchInput, setSearchInput] = useState("");

  const { data, isLoading, refetch } = useQuery<{ shipments: UnifiedShipment[]; total: number }>({
    queryKey: ["unified-shipments", moduleFilter, statusFilter, search, dateFrom, dateTo],
    queryFn: async () => {
      const p = new URLSearchParams();
      if (moduleFilter !== "all") p.set("module", moduleFilter);
      if (statusFilter !== "all") p.set("status", statusFilter);
      if (search) p.set("q", search);
      if (dateFrom) p.set("dateFrom", dateFrom);
      if (dateTo) p.set("dateTo", dateTo);
      const r = await fetch(`/api/logistics/unified-shipments?${p}`, { credentials: "include" });
      if (!r.ok) throw new Error("Gagal");
      return r.json();
    },
    refetchInterval: 60000,
  });

  const shipments = data?.shipments ?? [];

  function handleSearch(e: React.FormEvent) {
    e.preventDefault();
    setSearch(searchInput);
  }

  return (
    <AppShell>
      <BackButton href="/logistics" />
      <div className="p-6 space-y-5 max-w-screen-2xl mx-auto">
        <Button variant="ghost" size="sm" className="-ml-2" onClick={() => window.history.back()}>
          <ArrowLeft className="h-4 w-4 mr-1" />Kembali
        </Button>
        {/* Header */}
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-bold flex items-center gap-2">
              <Layers className="w-6 h-6 text-blue-600" /> Unified Shipment List
            </h1>
            <p className="text-sm text-muted-foreground mt-0.5">
              Semua shipment dari seluruh modul: General Freight, Air Freight, Ocean Freight, Trucking, dan PPJK
            </p>
          </div>
          <Button variant="outline" size="sm" onClick={() => refetch()}><RefreshCw className="w-4 h-4" /></Button>
        </div>

        {/* Stats */}
        {!isLoading && <StatsBar shipments={shipments} />}

        {/* Filters */}
        <Card>
          <CardContent className="p-4">
            <form onSubmit={handleSearch} className="flex flex-wrap gap-3">
              <div className="flex items-center gap-2 flex-1 min-w-48">
                <Search className="w-4 h-4 text-muted-foreground shrink-0" />
                <Input
                  placeholder="Cari nomor order, customer, origin..."
                  value={searchInput}
                  onChange={(e) => setSearchInput(e.target.value)}
                  className="h-8"
                />
                <Button type="submit" size="sm" variant="secondary" className="h-8 shrink-0">Cari</Button>
              </div>
              <Select value={moduleFilter} onValueChange={setModuleFilter}>
                <SelectTrigger className="w-44 h-8"><SelectValue placeholder="Semua Modul" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">Semua Modul</SelectItem>
                  {Object.entries(MODULE_LABELS).map(([k, v]) => <SelectItem key={k} value={k}>{v}</SelectItem>)}
                </SelectContent>
              </Select>
              <Select value={statusFilter} onValueChange={setStatusFilter}>
                <SelectTrigger className="w-40 h-8"><SelectValue placeholder="Status" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">Semua Status</SelectItem>
                  <SelectItem value="draft">Draft</SelectItem>
                  <SelectItem value="confirmed">Confirmed</SelectItem>
                  <SelectItem value="in_transit">In Transit</SelectItem>
                  <SelectItem value="completed">Selesai</SelectItem>
                  <SelectItem value="cancelled">Dibatalkan</SelectItem>
                </SelectContent>
              </Select>
              <div className="flex items-center gap-2">
                <DatePicker value={dateFrom} onChange={(v) => setDateFrom(v)} className="h-8 w-36" placeholder="Dari" />
                <span className="text-muted-foreground text-xs">s/d</span>
                <DatePicker value={dateTo} onChange={(v) => setDateTo(v)} className="h-8 w-36" placeholder="Sampai" />
              </div>
              {(search || moduleFilter !== "all" || statusFilter !== "all" || dateFrom || dateTo) && (
                <Button type="button" variant="ghost" size="sm" className="h-8" onClick={() => { setSearch(""); setSearchInput(""); setModuleFilter("all"); setStatusFilter("all"); setDateFrom(""); setDateTo(""); }}>
                  Reset
                </Button>
              )}
            </form>
          </CardContent>
        </Card>

        {/* Table */}
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-sm font-semibold text-muted-foreground uppercase tracking-wide">
              {`${isLoading ? "—" : shipments.length} Shipment Ditemukan`}
            </CardTitle>
          </CardHeader>
          <CardContent className="p-0">
            <QueryState
              loading={isLoading}
              empty={shipments.length === 0}
              emptyMessage="Tidak ada shipment ditemukan"
              emptyIcon={<Layers className="w-10 h-10 opacity-25" />}
              skeletonRows={6}
              className="p-4"
            >
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b bg-muted/30">
                      {[
                        "No. Shipment / Order", "Modul", "Customer", "Origin", "Destination", "Mode",
                        "Status", "Status Pabean", "Vendor", "Revenue", "Cost", "Profit", "Dibuat", ""
                      ].map((h) => (
                        <th key={h} className="px-3 py-2.5 text-left text-xs font-semibold text-muted-foreground whitespace-nowrap">{h}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody className="divide-y">
                    {shipments.map((s) => {
                      const prof = profit(s.revenue, s.cost);
                      const profNum = prof ? Number(prof) : null;
                      return (
                        <tr
                          key={`${s.module}-${s.id}`}
                          className="hover:bg-muted/20 cursor-pointer transition-colors"
                          onClick={() => navigate(s.detailPath)}
                        >
                          <td className="px-3 py-3 font-mono text-xs font-semibold">{s.orderNumber}</td>
                          <td className="px-3 py-3">
                            <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${MODULE_COLORS[s.module] ?? "bg-gray-100 text-gray-700"}`}>
                              {MODULE_LABELS[s.module] ?? s.module}
                            </span>
                          </td>
                          <td className="px-3 py-3">
                            <p className="font-medium text-xs">{s.customerName}</p>
                            {s.customerCompany && <p className="text-[10px] text-muted-foreground">{s.customerCompany}</p>}
                          </td>
                          <td className="px-3 py-3 text-xs text-muted-foreground max-w-28 truncate">{s.origin || "—"}</td>
                          <td className="px-3 py-3 text-xs text-muted-foreground max-w-28 truncate">{s.destination || "—"}</td>
                          <td className="px-3 py-3">
                            {s.mode && <Badge variant="outline" className="text-[10px] font-mono">{s.mode}</Badge>}
                          </td>
                          <td className="px-3 py-3">
                            <span className="text-xs capitalize">{s.status?.replace(/_/g, " ") || "—"}</span>
                          </td>
                          <td className="px-3 py-3">
                            {s.customsStatus ? (
                              <span className="text-xs px-2 py-0.5 rounded-full bg-purple-100 text-purple-700 font-medium">
                                {CUSTOMS_STATUS_LABELS[s.customsStatus] ?? s.customsStatus}
                              </span>
                            ) : <span className="text-muted-foreground text-xs">—</span>}
                          </td>
                          <td className="px-3 py-3 text-xs text-muted-foreground max-w-28 truncate">{s.vendor || "—"}</td>
                          <td className="px-3 py-3 text-xs text-right font-medium">
                            {IDR(s.revenue) ?? <span className="text-muted-foreground">—</span>}
                          </td>
                          <td className="px-3 py-3 text-xs text-right">
                            {IDR(s.cost) ?? <span className="text-muted-foreground">—</span>}
                          </td>
                          <td className="px-3 py-3 text-xs text-right font-medium">
                            {profNum !== null ? (
                              <span className={profNum >= 0 ? "text-green-700" : "text-red-700"}>
                                {IDR(String(profNum))}
                              </span>
                            ) : <span className="text-muted-foreground">—</span>}
                          </td>
                          <td className="px-3 py-3 text-xs text-muted-foreground whitespace-nowrap">
                            {formatDistanceToNow(new Date(s.createdAt), { addSuffix: true, locale: idLocale })}
                          </td>
                          <td className="px-3 py-3">
                            <ChevronRight className="w-4 h-4 text-muted-foreground" />
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </QueryState>
          </CardContent>
        </Card>
      </div>
    </AppShell>
  );
}
