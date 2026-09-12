import { DatePicker } from "@/components/ui/date-picker";
import { useState, useCallback } from "react";
import { useQuery } from "@tanstack/react-query";
import { AppShell } from "@/components/layout/AppShell";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useCompany } from "@/contexts/CompanyContext";
import {
  TrendingUp, Search, RefreshCw,
  ShoppingCart, Users, Truck, DollarSign, AlertTriangle,
  ChevronLeft, ChevronRight, Target, BarChart2, Clock,
  Receipt, MapPin, Package, FileDown,
} from "lucide-react";
import { Link } from "wouter";
import { ArrowLeft } from "lucide-react";

const idr = (n: number) =>
  new Intl.NumberFormat("id-ID", { style: "currency", currency: "IDR", maximumFractionDigits: 0 }).format(n);

const idrCompact = (n: number) => {
  const abs = Math.abs(n);
  const sign = n < 0 ? "-" : "";
  if (abs >= 1_000_000_000) return `${sign}${(abs / 1_000_000_000).toFixed(1)}M`;
  if (abs >= 1_000_000) return `${sign}${(abs / 1_000_000).toFixed(0)}Jt`;
  if (abs >= 1_000) return `${sign}${(abs / 1_000).toFixed(0)}rb`;
  return String(n);
};

const pct = (n: number, decimals = 1) => `${n.toFixed(decimals)}%`;

function MarginBadge({ pct: p }: { pct: number }) {
  if (p >= 25) return <Badge className="bg-emerald-100 text-emerald-800 border-emerald-200 text-[10px]">{p.toFixed(1)}%</Badge>;
  if (p >= 10) return <Badge className="bg-blue-100 text-blue-800 border-blue-200 text-[10px]">{p.toFixed(1)}%</Badge>;
  if (p >= 0)  return <Badge className="bg-amber-100 text-amber-800 border-amber-200 text-[10px]">{p.toFixed(1)}%</Badge>;
  return <Badge className="bg-red-100 text-red-800 border-red-200 text-[10px]">{p.toFixed(1)}%</Badge>;
}

function WinRateBadge({ rate }: { rate: number }) {
  if (rate >= 60) return <Badge className="bg-emerald-100 text-emerald-800 border-emerald-200 text-[10px]">{rate.toFixed(1)}%</Badge>;
  if (rate >= 35) return <Badge className="bg-amber-100 text-amber-800 border-amber-200 text-[10px]">{rate.toFixed(1)}%</Badge>;
  return <Badge className="bg-red-100 text-red-800 border-red-200 text-[10px]">{rate.toFixed(1)}%</Badge>;
}

// ─── Types ───────────────────────────────────────────────────────────────────
interface OrderRow {
  id: number; orderNumber: string; customerName: string;
  createdAt: string; status: string; origin: string; destination: string;
  revenue: number; vendorCost: number; truckCost: number; tax: number;
  grossMargin: number; margin: number; marginPct: number;
  opexCost: number; netMargin: number; netMarginPct: number;
  purchaseCost: number;
  vendorName: string | null;
  productCost?: number; shipmentCost?: number;
  shipmentMargin?: number; orderGrossMargin?: number; productMargin?: number;
}
interface OrdersData { rows: OrderRow[]; total: number; limit: number; offset: number; }

interface CustomerRow {
  customerName: string; orderCount: number;
  revenue: number; outstanding: number;
  vendorCost: number; truckCost: number; tax: number;
  profit: number; profitabilityPct: number;
}

interface ProductVendorRow {
  vendorId: number; vendorName: string; vendorType: "product";
  totalOrders: number; totalCost: number; totalRevenue: number;
  totalMargin: number; marginPct: number; avgProductCost: number;
  winInvites: number; winSelected: number; winRate: number;
}
interface ShipmentVendorRow {
  vendorId: number; vendorName: string; vendorType: "shipment";
  totalOrders: number; totalShipmentCost: number; totalShipmentRevenue: number;
  totalShipmentMargin: number; marginPct: number; rfqInvites: number;
  selectedCount: number; winRate: number; avgResponseMin: number;
  totalSpend: number; totalInvites: number; totalWins: number;
  ontimePct: number; recommendationScore: number;
}
interface CombinedVendorRow {
  vendorId: number; vendorName: string; vendorType: string;
  orderCount: number; totalSpend: number; winRate: number;
  totalInvites: number; totalWins: number; ontimePct: number;
  recommendationScore: number; avgResponseMin: number;
}
interface VendorsData {
  productVendors: ProductVendorRow[];
  shipmentVendors: ShipmentVendorRow[];
  combined: CombinedVendorRow[];
}

interface RouteRow {
  origin: string; destination: string; route: string;
  orderCount: number; revenue: number;
  vendorCost: number; truckCost: number; tax: number;
  grossMargin: number; marginPct: number;
  shipmentMargin?: number; orderGrossMargin?: number;
}
interface RoutesData {
  items: RouteRow[]; total: number; limit: number; offset: number;
  summary: {
    totalRevenue: number; totalVendorCost: number; totalTruckCost: number;
    totalTax: number; totalGrossMargin: number; totalOrders: number; avgMarginPct: number;
  };
}

interface CommodityRow {
  commodity: string; orderCount: number;
  revenue: number; vendorCost: number; truckCost: number; tax: number;
  grossMargin: number; marginPct: number;
  shipmentMargin?: number; orderGrossMargin?: number;
}
interface CommoditiesData {
  items: CommodityRow[]; total: number;
  summary: {
    totalRevenue: number; totalVendorCost: number; totalTruckCost: number;
    totalTax: number; totalGrossMargin: number; totalOrders: number; avgMarginPct: number;
  };
}

// commodity → emoji
const COMMODITY_ICON: Record<string, string> = {
  coffee: "☕", coal: "⚫", "palm oil": "🌴", steel: "⚙️", fish: "🐟",
  "batu bara": "⚫", "minyak kelapa sawit": "🌴", "baja": "⚙️", "ikan": "🐟", "kopi": "☕",
  electronics: "📱", textile: "🧵", chemical: "⚗️", food: "🍱", cement: "🏗️",
};
function getCommodityIcon(name: string): string {
  const key = name.toLowerCase();
  for (const [k, v] of Object.entries(COMMODITY_ICON)) {
    if (key.includes(k)) return v;
  }
  return "📦";
}

// ─── Filter bar ──────────────────────────────────────────────────────────────
function FilterBar({
  search, onSearch, dateFrom, dateTo, onDateFrom, onDateTo,
}: {
  search?: string; onSearch?: (v: string) => void;
  dateFrom: string; dateTo: string;
  onDateFrom: (v: string) => void; onDateTo: (v: string) => void;
}) {
  return (
    <div className="flex flex-wrap gap-2 items-center">
      {onSearch !== undefined && (
        <div className="relative">
          <Search className="absolute left-2.5 top-2 h-3.5 w-3.5 text-muted-foreground" />
          <Input
            className="pl-8 h-8 text-sm w-52"
            placeholder="Cari order / customer…"
            value={search}
            onChange={e => onSearch(e.target.value)}
          />
        </div>
      )}
      <div className="flex items-center gap-1.5">
        <span className="text-xs text-muted-foreground">Dari</span>
        <DatePicker value={dateFrom} onChange={v => onDateFrom(v)} className="h-8 text-xs w-36" />
      </div>
      <div className="flex items-center gap-1.5">
        <span className="text-xs text-muted-foreground">Sampai</span>
        <DatePicker value={dateTo} onChange={v => onDateTo(v)} className="h-8 text-xs w-36" />
      </div>
    </div>
  );
}

// ─── Generic horizontal bar chart (pure CSS) ─────────────────────────────────
type BarMetric = "revenue" | "grossMargin" | "marginPct";
interface BarRow { name: string; revenue: number; grossMargin: number; marginPct: number; }

function ProfitBarChart({ rows, metric, label }: {
  rows: BarRow[]; metric: BarMetric; label: string;
}) {
  const top = rows.slice(0, 10);
  const max = Math.max(...top.map(r => Math.abs(r[metric])), 1);
  return (
    <div className="space-y-1.5">
      <div className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-2">{label}</div>
      {top.map((r, i) => {
        const val = r[metric];
        const w = Math.min(Math.abs(val) / max * 100, 100);
        const isNeg = val < 0;
        return (
          <div key={r.name} className="flex items-center gap-2">
            <div className="w-4 text-[10px] font-bold text-muted-foreground text-right shrink-0">{i + 1}</div>
            <div className="text-xs text-slate-700 truncate w-40 shrink-0 font-medium" title={r.name}>{r.name}</div>
            <div className="flex-1 flex items-center gap-1.5 min-w-0">
              <div className="flex-1 bg-slate-100 rounded-full h-2 overflow-hidden">
                <div
                  className={`h-2 rounded-full transition-all ${isNeg ? "bg-red-400" : metric === "marginPct" ? "bg-blue-400" : metric === "grossMargin" ? "bg-indigo-500" : "bg-emerald-500"}`}
                  style={{ width: `${w}%` }}
                />
              </div>
              <span className={`text-[11px] font-semibold w-16 text-right shrink-0 ${isNeg ? "text-red-600" : "text-slate-800"}`}>
                {metric === "marginPct" ? `${val.toFixed(1)}%` : idrCompact(val)}
              </span>
            </div>
          </div>
        );
      })}
    </div>
  );
}

// helpers to cast typed rows → BarRow
const toBarRows = (rows: RouteRow[]): BarRow[] =>
  rows.map(r => ({ name: r.route, revenue: r.revenue, grossMargin: r.grossMargin, marginPct: r.marginPct }));
const commodityToBarRows = (rows: CommodityRow[]): BarRow[] =>
  rows.map(r => ({ name: r.commodity, revenue: r.revenue, grossMargin: r.grossMargin, marginPct: r.marginPct }));

// ─── Main page ────────────────────────────────────────────────────────────────
export default function ProfitabilityAnalyticsPage() {
  const { activeCompanyId } = useCompany();
  const companyParam = activeCompanyId ? `companyId=${activeCompanyId}` : "companyId=all";

  const [tab, setTab] = useState<"orders" | "customers" | "vendors" | "routes" | "commodities" | "leakage">("orders");
  const [search, setSearch] = useState("");
  const [debouncedSearch, setDebouncedSearch] = useState("");
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");
  const [page, setPage] = useState(0);
  const [routePage, setRoutePage] = useState(0);
  const [routeSearch, setRouteSearch] = useState("");
  const [vendorSubTab, setVendorSubTab] = useState<"product" | "shipment" | "combined">("shipment");
  const PAGE_SIZE = 50;
  const ROUTE_PAGE_SIZE = 50;

  const handleSearch = useCallback((v: string) => {
    setSearch(v);
    clearTimeout((handleSearch as unknown as { _t: ReturnType<typeof setTimeout> })._t);
    (handleSearch as unknown as { _t: ReturnType<typeof setTimeout> })._t = setTimeout(() => {
      setDebouncedSearch(v);
      setPage(0);
    }, 400);
  }, []);

  const dateParams = [
    dateFrom ? `dateFrom=${dateFrom}` : "",
    dateTo ? `dateTo=${dateTo}` : "",
  ].filter(Boolean).join("&");

  const ordersQuery = useQuery<OrdersData>({
    queryKey: ["profit-orders", companyParam, debouncedSearch, dateFrom, dateTo, page],
    queryFn: async () => {
      const params = [companyParam, dateParams, `search=${encodeURIComponent(debouncedSearch)}`, `limit=${PAGE_SIZE}`, `offset=${page * PAGE_SIZE}`].filter(Boolean).join("&");
      const r = await fetch(`/api/analytics/profitability/orders?${params}`, { credentials: "include" });
      if (!r.ok) throw new Error("Gagal memuat data order");
      return r.json() as Promise<OrdersData>;
    },
    enabled: tab === "orders" || tab === "leakage",
  });

  const customersQuery = useQuery<CustomerRow[]>({
    queryKey: ["profit-customers", companyParam, dateFrom, dateTo],
    queryFn: async () => {
      const params = [companyParam, dateParams].filter(Boolean).join("&");
      const r = await fetch(`/api/analytics/profitability/customers?${params}`, { credentials: "include" });
      if (!r.ok) throw new Error("Gagal memuat data customer");
      return r.json() as Promise<CustomerRow[]>;
    },
    enabled: tab === "customers",
  });

  const vendorsQuery = useQuery<VendorsData>({
    queryKey: ["profit-vendors", companyParam, dateFrom, dateTo],
    queryFn: async () => {
      const params = [companyParam, dateParams].filter(Boolean).join("&");
      const r = await fetch(`/api/analytics/profitability/vendors?${params}`, { credentials: "include" });
      if (!r.ok) throw new Error("Gagal memuat data vendor");
      const raw = await r.json() as unknown;
      if (Array.isArray(raw)) {
        return { productVendors: [], shipmentVendors: raw as ShipmentVendorRow[], combined: raw as CombinedVendorRow[] };
      }
      return raw as VendorsData;
    },
    enabled: tab === "vendors",
  });

  const routesQuery = useQuery<RoutesData>({
    queryKey: ["profit-routes", companyParam, dateFrom, dateTo, routePage],
    queryFn: async () => {
      const params = [companyParam, dateParams, `limit=${ROUTE_PAGE_SIZE}`, `offset=${routePage * ROUTE_PAGE_SIZE}`].filter(Boolean).join("&");
      const r = await fetch(`/api/analytics/profitability/routes?${params}`, { credentials: "include" });
      if (!r.ok) throw new Error("Gagal memuat data rute");
      return r.json() as Promise<RoutesData>;
    },
    enabled: tab === "routes",
  });

  const commoditiesQuery = useQuery<CommoditiesData>({
    queryKey: ["profit-commodities", companyParam, dateFrom, dateTo],
    queryFn: async () => {
      const params = [companyParam, dateParams].filter(Boolean).join("&");
      const r = await fetch(`/api/analytics/profitability/commodities?${params}`, { credentials: "include" });
      if (!r.ok) throw new Error("Gagal memuat data komoditi");
      return r.json() as Promise<CommoditiesData>;
    },
    enabled: tab === "commodities",
  });

  const handleRefresh = () => {
    if (tab === "orders")      void ordersQuery.refetch();
    if (tab === "customers")   void customersQuery.refetch();
    if (tab === "vendors")     void vendorsQuery.refetch();
    if (tab === "routes")      void routesQuery.refetch();
    if (tab === "commodities") void commoditiesQuery.refetch();
  };

  const isFetching = ordersQuery.isFetching || customersQuery.isFetching || vendorsQuery.isFetching || routesQuery.isFetching || commoditiesQuery.isFetching;

  const thCls = "text-xs font-semibold text-muted-foreground uppercase tracking-wide px-3 py-2 text-left border-b bg-slate-50/80 whitespace-nowrap";
  const tdCls = "px-3 py-2.5 text-sm border-b border-slate-100 align-middle";

  const orderRows = ordersQuery.data?.rows ?? [];
  const totalRevenue    = orderRows.reduce((s, r) => s + r.revenue, 0);
  const totalVendor     = orderRows.reduce((s, r) => s + r.vendorCost, 0);
  const totalTruck      = orderRows.reduce((s, r) => s + (r.truckCost ?? 0), 0);
  const totalTax        = orderRows.reduce((s, r) => s + (r.tax ?? 0), 0);
  const totalGrossMargin = orderRows.reduce((s, r) => s + (r.grossMargin ?? r.margin), 0);
  const avgMarginPct    = totalRevenue > 0 ? (totalGrossMargin / totalRevenue) * 100 : 0;
  const totalOpex       = orderRows.reduce((s, r) => s + (r.opexCost ?? 0), 0);
  const totalNetMargin  = orderRows.reduce((s, r) => s + (r.netMargin ?? r.grossMargin ?? r.margin), 0);
  const avgNetMarginPct = totalRevenue > 0 ? (totalNetMargin / totalRevenue) * 100 : 0;

  // ── Profitability 2.0 derived metrics ─────────────────────────────────────
  const deriveProdCost   = (r: OrderRow) => r.productCost   ?? (r.purchaseCost ?? 0);
  const deriveShipCost   = (r: OrderRow) => r.shipmentCost  ?? (r.vendorCost + (r.truckCost ?? 0));
  const deriveShipMargin = (r: OrderRow) => r.shipmentMargin   ?? (r.grossMargin ?? r.margin);
  const deriveOrderGM    = (r: OrderRow) => r.orderGrossMargin ?? (r.grossMargin ?? r.margin);

  const totalProductCost    = orderRows.reduce((s, r) => s + deriveProdCost(r), 0);
  const totalShipmentCost   = orderRows.reduce((s, r) => s + deriveShipCost(r), 0);
  const totalShipmentMargin = orderRows.reduce((s, r) => s + deriveShipMargin(r), 0);
  const totalOrderGM        = orderRows.reduce((s, r) => s + deriveOrderGM(r), 0);
  const avgOrderMarginPct   = totalRevenue > 0 ? (totalOrderGM / totalRevenue) * 100 : 0;
  const totalProductMargin  = orderRows.reduce((s, r) => {
    const pc = deriveProdCost(r);
    return s + (r.productMargin ?? (pc > 0 ? r.revenue - pc : 0));
  }, 0);

  // ── Sprint 5: Profit Leakage Analysis ─────────────────────────────────────
  const negativeMarginOrders = orderRows.filter(r => (r.grossMargin ?? r.margin) < 0);
  const lowMarginOrders      = orderRows.filter(r => r.marginPct > 0 && r.marginPct < 10);

  const sortedRevs = [...orderRows].map(r => r.revenue).sort((a, b) => a - b);
  const p75Rev = sortedRevs.length > 0
    ? (sortedRevs[Math.floor(sortedRevs.length * 0.75)] ?? 0)
    : 0;
  const highRevLowMargin = p75Rev > 0
    ? orderRows.filter(r => r.revenue >= p75Rev && r.marginPct < 15)
    : [];

  function classifyLeakageReason(r: OrderRow): string {
    const gm = r.grossMargin ?? r.margin;
    const pc = deriveProdCost(r);
    const sc = deriveShipCost(r);
    const sm = deriveShipMargin(r);
    const pm = r.productMargin ?? (pc > 0 ? r.revenue - pc : null);
    if (pc === 0 && sc === 0) return "Missing cost data";
    if (gm < 0) return "Negative margin";
    if (pm !== null && pm < 0) return "Product cost too high";
    if (sm < 0) return "Shipment cost too high";
    if ((r.truckCost ?? 0) > 0 && (r.truckCost ?? 0) > r.vendorCost * 0.5) return "Truck cost too high";
    if ((r.tax ?? 0) > r.revenue * 0.1) return "Tax impact";
    return "Unknown";
  }

  const problematicOrders = orderRows.filter(r =>
    (r.grossMargin ?? r.margin) < 0 || r.marginPct < 10
  );
  const reasonCounts = problematicOrders.reduce<Record<string, number>>((acc, r) => {
    const reason = classifyLeakageReason(r);
    acc[reason] = (acc[reason] ?? 0) + 1;
    return acc;
  }, {});
  const leakageReasonList = Object.entries(reasonCounts)
    .sort(([, a], [, b]) => b - a)
    .map(([reason, count]) => ({ reason, count }));

  const totalLossAmount = negativeMarginOrders.reduce(
    (s, r) => s + Math.abs(r.grossMargin ?? r.margin), 0
  );
  const estimatedLeakage = [...negativeMarginOrders, ...lowMarginOrders]
    .filter((r, i, a) => a.findIndex(x => x.id === r.id) === i)
    .reduce((s, r) => {
      const gm = r.grossMargin ?? r.margin;
      const targetGm = r.revenue * 0.1;
      return s + Math.max(0, targetGm - gm);
    }, 0);

  function getLeakageSuggestions(r: OrderRow): string[] {
    const suggestions: string[] = [];
    const pc = deriveProdCost(r);
    const sc = deriveShipCost(r);
    const sm = deriveShipMargin(r);
    const pm = r.productMargin ?? (pc > 0 ? r.revenue - pc : null);
    if (pm !== null && pm < 0) suggestions.push("Review harga vendor produk atau markup produk.");
    if (sm < 0) suggestions.push("Review biaya shipment/trucking.");
    if (pc === 0 || sc === 0) suggestions.push("Lengkapi data cost agar margin akurat.");
    if (r.marginPct < 10 && r.marginPct >= 0) suggestions.push("Pertimbangkan markup minimum 10%.");
    return suggestions.length > 0 ? suggestions : ["Analisis lebih lanjut diperlukan."];
  }

  const REASON_COLOR: Record<string, string> = {
    "Negative margin":        "bg-red-100 text-red-800 border-red-200",
    "Product cost too high":  "bg-violet-100 text-violet-800 border-violet-200",
    "Shipment cost too high": "bg-indigo-100 text-indigo-800 border-indigo-200",
    "Truck cost too high":    "bg-orange-100 text-orange-800 border-orange-200",
    "Tax impact":             "bg-purple-100 text-purple-800 border-purple-200",
    "Missing cost data":      "bg-amber-100 text-amber-800 border-amber-200",
    "Unknown":                "bg-slate-100 text-slate-800 border-slate-200",
  };

  function downloadLeakageCSV() {
    const allLeakage = [
      ...negativeMarginOrders.map(r => ({ ...r, _category: "Margin Negatif" })),
      ...lowMarginOrders
        .filter(r => !negativeMarginOrders.find(x => x.id === r.id))
        .map(r => ({ ...r, _category: "Margin Rendah (0-10%)" })),
      ...highRevLowMargin
        .filter(r => !negativeMarginOrders.find(x => x.id === r.id) && !lowMarginOrders.find(x => x.id === r.id))
        .map(r => ({ ...r, _category: "High Revenue Low Margin" })),
    ];

    if (allLeakage.length === 0) return;

    const esc = (v: string | number | null | undefined) => {
      const s = String(v ?? "");
      return s.includes(",") || s.includes('"') || s.includes("\n")
        ? `"${s.replace(/"/g, '""')}"`
        : s;
    };

    const headers = [
      "Kategori", "No. Order", "Customer", "Revenue (IDR)",
      "Vendor Cost (IDR)", "Truck Cost (IDR)", "Tax (IDR)",
      "Gross Margin (IDR)", "Margin %",
      "Product Cost (IDR)", "Product Margin (IDR)",
      "Shipment Cost (IDR)", "Shipment Margin (IDR)",
      "Leakage Reason", "Saran Tindakan",
    ];

    const rows = allLeakage.map(r => {
      const pc = deriveProdCost(r);
      const sc = deriveShipCost(r);
      const sm = deriveShipMargin(r);
      const pm = r.productMargin ?? (pc > 0 ? r.revenue - pc : 0);
      const gm = r.grossMargin ?? r.margin;
      return [
        r._category,
        r.orderNumber,
        r.customerName,
        r.revenue.toFixed(0),
        r.vendorCost.toFixed(0),
        (r.truckCost ?? 0).toFixed(0),
        (r.tax ?? 0).toFixed(0),
        gm.toFixed(0),
        r.marginPct.toFixed(2),
        pc.toFixed(0),
        pm.toFixed(0),
        sc.toFixed(0),
        sm.toFixed(0),
        classifyLeakageReason(r),
        getLeakageSuggestions(r).join("; "),
      ].map(esc).join(",");
    });

    const csv = [headers.join(","), ...rows].join("\n");
    const blob = new Blob(["\uFEFF" + csv], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    const now = new Date().toISOString().slice(0, 10);
    a.href = url;
    a.download = `profit-leakage-${now}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  }

  // filtered route rows for search
  const routeRows = (routesQuery.data?.items ?? []).filter(r =>
    !routeSearch || r.route.toLowerCase().includes(routeSearch.toLowerCase())
  );

  return (
    <AppShell>
      <div className="p-4 md:p-6 max-w-[1600px] mx-auto space-y-5">
        {/* Header */}
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
          <div>
            <div className="flex items-center gap-2">
              <BarChart2 className="h-6 w-6 text-indigo-500" />
              <Link href="/analytics-dashboard"><Button variant="ghost" size="icon" aria-label="Kembali"><ArrowLeft className="h-4 w-4" /></Button></Link>
              <h1 className="text-2xl font-bold tracking-tight">Profitability Analytics</h1>
            </div>
            <p className="text-sm text-muted-foreground mt-1">
              Analisis profitabilitas per order, customer, vendor, dan rute
              <span className="ml-2 text-[10px] bg-blue-100 text-blue-700 px-1.5 py-0.5 rounded font-medium">
                Revenue − Vendor Cost − Truck Cost = Gross Margin
              </span>
            </p>
          </div>
          <Button variant="outline" size="sm" onClick={handleRefresh} disabled={isFetching} className="gap-1.5 h-8 self-start">
            <RefreshCw className={`h-3.5 w-3.5 ${isFetching ? "animate-spin" : ""}`} />
            Refresh
          </Button>
        </div>

        <Tabs value={tab} onValueChange={v => { setTab(v as typeof tab); setPage(0); setRoutePage(0); }}>
          <div className="flex flex-col sm:flex-row sm:items-center gap-3">
            <TabsList className="w-full sm:w-auto">
              <TabsTrigger value="orders" className="gap-1.5">
                <ShoppingCart className="h-3.5 w-3.5" /> Per Order
              </TabsTrigger>
              <TabsTrigger value="customers" className="gap-1.5">
                <Users className="h-3.5 w-3.5" /> Per Customer
              </TabsTrigger>
              <TabsTrigger value="routes" className="gap-1.5">
                <MapPin className="h-3.5 w-3.5" /> Per Rute
              </TabsTrigger>
              <TabsTrigger value="commodities" className="gap-1.5">
                <Package className="h-3.5 w-3.5" /> Per Komoditi
              </TabsTrigger>
              <TabsTrigger value="vendors" className="gap-1.5">
                <Truck className="h-3.5 w-3.5" /> Per Vendor
              </TabsTrigger>
            </TabsList>
            <FilterBar
              search={tab === "orders" ? search : undefined}
              onSearch={tab === "orders" ? handleSearch : undefined}
              dateFrom={dateFrom} dateTo={dateTo}
              onDateFrom={v => { setDateFrom(v); setPage(0); setRoutePage(0); }}
              onDateTo={v => { setDateTo(v); setPage(0); setRoutePage(0); }}
            />
          </div>

          {/* ── TAB: Orders ── */}
          <TabsContent value="orders" className="mt-4 space-y-3">
            {orderRows.length > 0 && (
              <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-7 gap-2">
                {[
                  { label: "Revenue", value: idrCompact(totalRevenue), full: idr(totalRevenue), icon: <DollarSign className="h-3.5 w-3.5 text-emerald-600" />, color: "border-l-emerald-500", text: "text-emerald-700" },
                  { label: "Vendor Cost", value: idrCompact(totalVendor), full: idr(totalVendor), icon: <Truck className="h-3.5 w-3.5 text-slate-500" />, color: "border-l-slate-400", text: "text-slate-700" },
                  { label: "Truck Cost", value: idrCompact(totalTruck), full: idr(totalTruck), icon: <Truck className="h-3.5 w-3.5 text-orange-500" />, color: "border-l-orange-400", text: "text-orange-700" },
                  { label: "Tax", value: idrCompact(totalTax), full: idr(totalTax), icon: <Receipt className="h-3.5 w-3.5 text-violet-500" />, color: "border-l-violet-300", text: "text-violet-700" },
                  { label: "Gross Margin", value: idrCompact(totalGrossMargin), full: `${idr(totalGrossMargin)} · ${avgMarginPct.toFixed(1)}%`, icon: <TrendingUp className="h-3.5 w-3.5 text-blue-600" />, color: totalGrossMargin < 0 ? "border-l-red-500" : "border-l-blue-500", text: totalGrossMargin < 0 ? "text-red-600" : "text-blue-700" },
                  { label: "OPEX", value: idrCompact(totalOpex), full: idr(totalOpex), icon: <Receipt className="h-3.5 w-3.5 text-orange-600" />, color: totalOpex > 0 ? "border-l-orange-500" : "border-l-slate-300", text: "text-orange-700" },
                  { label: "Net Margin", value: idrCompact(totalNetMargin), full: `${idr(totalNetMargin)} · ${avgNetMarginPct.toFixed(1)}%`, icon: <Target className="h-3.5 w-3.5 text-indigo-600" />, color: totalNetMargin < 0 ? "border-l-red-500" : "border-l-indigo-500", text: totalNetMargin < 0 ? "text-red-600" : "text-indigo-700" },
                ].map(card => (
                  <Card key={card.label} className={`border-l-4 ${card.color}`}>
                    <CardContent className="flex items-center gap-2 p-2.5">
                      {card.icon}
                      <div className="min-w-0">
                        <div className="text-[10px] text-muted-foreground leading-none mb-0.5">{card.label}</div>
                        <div className={`font-semibold text-sm leading-none ${card.text}`}>{card.value}</div>
                        <div className="text-[10px] text-muted-foreground truncate mt-0.5">{card.full}</div>
                      </div>
                    </CardContent>
                  </Card>
                ))}
              </div>
            )}

            {orderRows.length >= 2 && (
              <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                <Card>
                  <CardContent className="p-4">
                    <ProfitBarChart
                      rows={[...orderRows].sort((a, b) => (b.grossMargin ?? b.margin) - (a.grossMargin ?? a.margin)).map(r => ({ name: r.orderNumber, revenue: r.revenue, grossMargin: r.grossMargin ?? r.margin, marginPct: r.marginPct }))}
                      metric="grossMargin"
                      label="Top 10 Order by Gross Margin"
                    />
                  </CardContent>
                </Card>
                <Card>
                  <CardContent className="p-4">
                    <ProfitBarChart
                      rows={[...orderRows].sort((a, b) => (a.grossMargin ?? a.margin) - (b.grossMargin ?? b.margin)).map(r => ({ name: r.orderNumber, revenue: r.revenue, grossMargin: r.grossMargin ?? r.margin, marginPct: r.marginPct }))}
                      metric="grossMargin"
                      label="Top 10 Low Margin Orders"
                    />
                  </CardContent>
                </Card>
              </div>
            )}

            {/* ── Product vs Shipment Margin Breakdown Chart ── */}
            {orderRows.length >= 2 && (totalProductCost > 0 || totalShipmentCost > 0) && (
              <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                <Card>
                  <CardHeader className="py-3 px-4 border-b">
                    <CardTitle className="text-sm font-semibold flex items-center gap-2">
                      <Package className="h-4 w-4 text-violet-500" />
                      Product Margin vs Shipment Margin
                    </CardTitle>
                  </CardHeader>
                  <CardContent className="p-4 space-y-3">
                    {[
                      { label: "Product Revenue", value: totalRevenue, max: totalRevenue, color: "bg-violet-400" },
                      { label: "Product Cost", value: totalProductCost, max: totalRevenue, color: "bg-violet-200" },
                      { label: "Product Margin", value: totalProductMargin, max: totalRevenue, color: totalProductMargin < 0 ? "bg-red-400" : "bg-violet-600" },
                      { label: "Shipment Revenue", value: totalRevenue, max: totalRevenue, color: "bg-indigo-400" },
                      { label: "Shipment Cost", value: totalShipmentCost, max: totalRevenue, color: "bg-indigo-200" },
                      { label: "Shipment Margin", value: totalShipmentMargin, max: totalRevenue, color: totalShipmentMargin < 0 ? "bg-red-400" : "bg-indigo-600" },
                    ].map(row => (
                      <div key={row.label} className="space-y-0.5">
                        <div className="flex items-center justify-between text-xs">
                          <span className="text-muted-foreground">{row.label}</span>
                          <span className="font-medium tabular-nums">{idrCompact(row.value)}</span>
                        </div>
                        <div className="h-2 bg-slate-100 rounded-full overflow-hidden">
                          <div
                            className={`h-full rounded-full transition-all ${row.color}`}
                            style={{ width: `${row.max > 0 ? Math.max(0, Math.min(100, Math.abs(row.value) / row.max * 100)) : 0}%` }}
                          />
                        </div>
                      </div>
                    ))}
                  </CardContent>
                </Card>
                <Card>
                  <CardHeader className="py-3 px-4 border-b">
                    <CardTitle className="text-sm font-semibold flex items-center gap-2">
                      <TrendingUp className="h-4 w-4 text-blue-500" />
                      Top 10 Order by Gross Margin
                    </CardTitle>
                  </CardHeader>
                  <CardContent className="p-4">
                    <ProfitBarChart
                      rows={[...orderRows]
                        .sort((a, b) => (b.grossMargin ?? b.margin) - (a.grossMargin ?? a.margin))
                        .slice(0, 10)
                        .map(r => ({ name: r.orderNumber, revenue: r.revenue, grossMargin: r.grossMargin ?? r.margin, marginPct: r.marginPct }))}
                      metric="grossMargin"
                      label=""
                    />
                  </CardContent>
                </Card>
              </div>
            )}

            <Card>
              <CardHeader className="py-3 px-4 border-b">
                <CardTitle className="text-sm font-semibold flex items-center gap-2">
                  <ShoppingCart className="h-4 w-4 text-blue-500" />
                  Profitability 2.0 — Detail Order
                  {ordersQuery.data && <Badge variant="secondary" className="text-[10px]">{ordersQuery.data.total} order</Badge>}
                </CardTitle>
              </CardHeader>
              <CardContent className="p-0">
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead>
                      <tr>
                        <th className={thCls}>No. Order</th>
                        <th className={thCls}>Customer</th>
                        <th className={thCls}>Rute</th>
                        <th className={thCls}>Vendor</th>
                        <th className={thCls}>Tanggal</th>
                        <th className={thCls}>Status</th>
                        <th className={`${thCls} text-right`}>Revenue</th>
                        <th className={`${thCls} text-right bg-violet-50`}>Product Cost</th>
                        <th className={`${thCls} text-right bg-violet-50`}>Product Margin</th>
                        <th className={`${thCls} text-right`}>Vendor Cost</th>
                        <th className={`${thCls} text-right`}>Truck Cost</th>
                        <th className={`${thCls} text-right bg-indigo-50`}>Shipment Cost</th>
                        <th className={`${thCls} text-right bg-indigo-50`}>Shipment Margin</th>
                        <th className={`${thCls} text-right`}>Tax</th>
                        <th className={`${thCls} text-right`}>Order Gross Margin</th>
                        <th className={`${thCls} text-right`}>Margin %</th>
                        <th className={`${thCls} text-right`}>OPEX</th>
                        <th className={`${thCls} text-right`}>Net Margin</th>
                        <th className={`${thCls} text-right`}>Net %</th>
                      </tr>
                    </thead>
                    <tbody>
                      {ordersQuery.isLoading
                        ? [...Array(8)].map((_, i) => <tr key={i}>{[...Array(19)].map((_, j) => <td key={j} className={tdCls}><Skeleton className="h-4 w-full" /></td>)}</tr>)
                        : orderRows.length === 0
                        ? <tr><td colSpan={19} className="text-center py-10 text-sm text-muted-foreground">Tidak ada data order</td></tr>
                        : orderRows.map(row => {
                          const gm = row.grossMargin ?? row.margin;
                          const nm = row.netMargin ?? gm;
                          const op = row.opexCost ?? 0;
                          const nmpct = row.netMarginPct ?? row.marginPct;
                          const pc = deriveProdCost(row);
                          const sc = deriveShipCost(row);
                          const sm = deriveShipMargin(row);
                          const pm = row.productMargin ?? (pc > 0 ? row.revenue - pc : null);
                          return (
                            <tr key={row.id} className="hover:bg-white/5 transition-colors duration-150">
                              <td className={tdCls}><Link href={`/logistics/orders/${row.id}`} className="font-mono text-xs text-blue-600 hover:underline">{row.orderNumber}</Link></td>
                              <td className={tdCls}><span className="font-medium">{row.customerName || "—"}</span></td>
                              <td className={tdCls}>{row.origin && row.destination ? <span className="text-xs text-muted-foreground">{row.origin} → {row.destination}</span> : <span className="text-muted-foreground">—</span>}</td>
                              <td className={tdCls}><span className="text-xs">{row.vendorName ?? <span className="text-muted-foreground italic">Belum ada</span>}</span></td>
                              <td className={tdCls}><span className="text-xs text-muted-foreground">{new Date(row.createdAt).toLocaleDateString("id-ID", { day: "2-digit", month: "short", year: "2-digit" })}</span></td>
                              <td className={tdCls}><Badge variant="outline" className="text-[10px] whitespace-nowrap">{row.status}</Badge></td>
                              <td className={`${tdCls} text-right font-medium text-emerald-700`}>{idrCompact(row.revenue)}</td>
                              <td className={`${tdCls} text-right bg-violet-50/40`}>{pc > 0 ? <span className="text-violet-700">{idrCompact(pc)}</span> : <span className="text-muted-foreground text-xs">—</span>}</td>
                              <td className={`${tdCls} text-right bg-violet-50/40`}>{pm !== null ? <span className={`font-semibold ${pm < 0 ? "text-red-600" : "text-violet-700"}`}>{idrCompact(pm)}</span> : <span className="text-muted-foreground text-xs">—</span>}</td>
                              <td className={`${tdCls} text-right text-slate-600`}>{idrCompact(row.vendorCost)}</td>
                              <td className={`${tdCls} text-right`}>{(row.truckCost ?? 0) > 0 ? <span className="text-orange-600">{idrCompact(row.truckCost)}</span> : <span className="text-muted-foreground text-xs">—</span>}</td>
                              <td className={`${tdCls} text-right bg-indigo-50/40`}><span className="text-indigo-700">{idrCompact(sc)}</span></td>
                              <td className={`${tdCls} text-right bg-indigo-50/40 font-semibold ${sm < 0 ? "text-red-600" : "text-indigo-700"}`}>{idrCompact(sm)}</td>
                              <td className={`${tdCls} text-right`}>{(row.tax ?? 0) > 0 ? <span className="text-violet-600">{idrCompact(row.tax)}</span> : <span className="text-muted-foreground text-xs">—</span>}</td>
                              <td className={`${tdCls} text-right font-semibold ${gm < 0 ? "text-red-600" : "text-blue-700"}`}>{idrCompact(gm)}</td>
                              <td className={`${tdCls} text-right`}><MarginBadge pct={row.marginPct} /></td>
                              <td className={`${tdCls} text-right`}>{op > 0 ? <span className="text-orange-600">{idrCompact(op)}</span> : <span className="text-muted-foreground text-xs">—</span>}</td>
                              <td className={`${tdCls} text-right font-semibold ${nm < 0 ? "text-red-600" : "text-indigo-700"}`}>{idrCompact(nm)}</td>
                              <td className={`${tdCls} text-right`}><MarginBadge pct={nmpct} /></td>
                            </tr>
                          );
                        })
                      }
                    </tbody>
                    {orderRows.length > 0 && (
                      <tfoot>
                        <tr className="bg-slate-50 font-semibold border-t-2 border-slate-200">
                          <td colSpan={6} className="px-3 py-2 text-xs text-muted-foreground">Subtotal halaman ini ({orderRows.length} order)</td>
                          <td className="px-3 py-2 text-right text-sm text-emerald-700">{idrCompact(totalRevenue)}</td>
                          <td className="px-3 py-2 text-right text-sm text-violet-700 bg-violet-50/40">{totalProductCost > 0 ? idrCompact(totalProductCost) : "—"}</td>
                          <td className="px-3 py-2 text-right text-sm bg-violet-50/40"><span className={totalProductMargin < 0 ? "text-red-600 font-bold" : "text-violet-700 font-bold"}>{totalProductCost > 0 ? idrCompact(totalProductMargin) : "—"}</span></td>
                          <td className="px-3 py-2 text-right text-sm text-slate-700">{idrCompact(totalVendor)}</td>
                          <td className="px-3 py-2 text-right text-sm text-orange-700">{idrCompact(totalTruck)}</td>
                          <td className="px-3 py-2 text-right text-sm text-indigo-700 bg-indigo-50/40">{idrCompact(totalShipmentCost)}</td>
                          <td className={`px-3 py-2 text-right text-sm font-bold bg-indigo-50/40 ${totalShipmentMargin < 0 ? "text-red-600" : "text-indigo-700"}`}>{idrCompact(totalShipmentMargin)}</td>
                          <td className="px-3 py-2 text-right text-sm text-violet-700">{idrCompact(totalTax)}</td>
                          <td className={`px-3 py-2 text-right text-sm font-bold ${totalOrderGM < 0 ? "text-red-600" : "text-blue-700"}`}>{idrCompact(totalOrderGM)}</td>
                          <td className="px-3 py-2 text-right"><MarginBadge pct={avgOrderMarginPct} /></td>
                          <td className="px-3 py-2 text-right text-sm text-orange-700">{totalOpex > 0 ? idrCompact(totalOpex) : "—"}</td>
                          <td className={`px-3 py-2 text-right text-sm font-bold ${totalNetMargin < 0 ? "text-red-600" : "text-indigo-700"}`}>{idrCompact(totalNetMargin)}</td>
                          <td className="px-3 py-2 text-right"><MarginBadge pct={avgNetMarginPct} /></td>
                        </tr>
                      </tfoot>
                    )}
                  </table>
                </div>
                {ordersQuery.data && ordersQuery.data.total > PAGE_SIZE && (
                  <div className="flex items-center justify-between px-4 py-2 border-t bg-slate-50/50">
                    <span className="text-xs text-muted-foreground">{page * PAGE_SIZE + 1}–{Math.min((page + 1) * PAGE_SIZE, ordersQuery.data.total)} dari {ordersQuery.data.total}</span>
                    <div className="flex gap-1">
                      <Button variant="outline" size="sm" className="h-7 w-7 p-0" disabled={page === 0} onClick={() => setPage(p => p - 1)}><ChevronLeft className="h-3.5 w-3.5" /></Button>
                      <Button variant="outline" size="sm" className="h-7 w-7 p-0" disabled={(page + 1) * PAGE_SIZE >= ordersQuery.data.total} onClick={() => setPage(p => p + 1)}><ChevronRight className="h-3.5 w-3.5" /></Button>
                    </div>
                  </div>
                )}
              </CardContent>
            </Card>
          </TabsContent>

          {/* ── TAB: Customers ── */}
          <TabsContent value="customers" className="mt-4 space-y-3">
            {(customersQuery.data ?? []).length > 0 && (
              <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-2">
                {[
                  { label: "Total Revenue", value: idr(customersQuery.data!.reduce((s, r) => s + r.revenue, 0)), icon: <DollarSign className="h-3.5 w-3.5 text-emerald-600" />, color: "border-l-emerald-500", text: "text-emerald-700" },
                  { label: "Total Vendor Cost", value: idr(customersQuery.data!.reduce((s, r) => s + (r.vendorCost ?? 0), 0)), icon: <Truck className="h-3.5 w-3.5 text-slate-500" />, color: "border-l-slate-400", text: "text-slate-700" },
                  { label: "Total Truck Cost", value: idr(customersQuery.data!.reduce((s, r) => s + (r.truckCost ?? 0), 0)), icon: <Truck className="h-3.5 w-3.5 text-orange-500" />, color: "border-l-orange-400", text: "text-orange-700" },
                  { label: "Total Outstanding", value: idr(customersQuery.data!.reduce((s, r) => s + r.outstanding, 0)), icon: <AlertTriangle className="h-3.5 w-3.5 text-amber-500" />, color: "border-l-amber-400", text: "text-amber-700" },
                  { label: "Total Gross Margin", value: idr(customersQuery.data!.reduce((s, r) => s + r.profit, 0)), icon: <TrendingUp className="h-3.5 w-3.5 text-blue-600" />, color: "border-l-blue-500", text: "text-blue-700" },
                ].map(card => (
                  <Card key={card.label} className={`border-l-4 ${card.color}`}>
                    <CardContent className="flex items-center gap-2 p-2.5">
                      {card.icon}
                      <div className="min-w-0">
                        <div className="text-[10px] text-muted-foreground leading-none mb-0.5">{card.label}</div>
                        <div className={`font-semibold text-xs leading-none ${card.text} truncate`}>{card.value}</div>
                      </div>
                    </CardContent>
                  </Card>
                ))}
              </div>
            )}

            <Card>
              <CardHeader className="py-3 px-4 border-b">
                <CardTitle className="text-sm font-semibold flex items-center gap-2">
                  <Users className="h-4 w-4 text-violet-500" />
                  Revenue · Cost Breakdown · Gross Margin per Customer
                  {customersQuery.data && <Badge variant="secondary" className="text-[10px]">{customersQuery.data.length} customer</Badge>}
                </CardTitle>
              </CardHeader>
              <CardContent className="p-0">
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead>
                      <tr>
                        <th className={thCls}>#</th>
                        <th className={thCls}>Customer</th>
                        <th className={`${thCls} text-right`}>Order</th>
                        <th className={`${thCls} text-right`}>Revenue</th>
                        <th className={`${thCls} text-right`}>Vendor Cost</th>
                        <th className={`${thCls} text-right`}>Truck Cost</th>
                        <th className={`${thCls} text-right`}>Tax</th>
                        <th className={`${thCls} text-right`}>Outstanding</th>
                        <th className={`${thCls} text-right`}>Gross Margin</th>
                        <th className={`${thCls} text-right`}>Margin %</th>
                      </tr>
                    </thead>
                    <tbody>
                      {customersQuery.isLoading
                        ? [...Array(8)].map((_, i) => <tr key={i}>{[...Array(10)].map((_, j) => <td key={j} className={tdCls}><Skeleton className="h-4 w-full" /></td>)}</tr>)
                        : (customersQuery.data ?? []).length === 0
                        ? <tr><td colSpan={10} className="text-center py-10 text-sm text-muted-foreground">Tidak ada data customer</td></tr>
                        : (customersQuery.data ?? []).map((row, i) => (
                          <tr key={row.customerName} className="hover:bg-white/5 transition-colors duration-150">
                            <td className={`${tdCls} text-xs font-bold text-muted-foreground w-8`}>{i + 1}</td>
                            <td className={tdCls}><span className="font-medium">{row.customerName}</span></td>
                            <td className={`${tdCls} text-right`}><Badge variant="secondary" className="text-[10px]">{row.orderCount}</Badge></td>
                            <td className={`${tdCls} text-right font-semibold text-emerald-700`}>{idrCompact(row.revenue)}</td>
                            <td className={`${tdCls} text-right text-slate-600`}>{idrCompact(row.vendorCost ?? 0)}</td>
                            <td className={`${tdCls} text-right`}>{(row.truckCost ?? 0) > 0 ? <span className="text-orange-600">{idrCompact(row.truckCost)}</span> : <span className="text-muted-foreground text-xs">—</span>}</td>
                            <td className={`${tdCls} text-right`}>{(row.tax ?? 0) > 0 ? <span className="text-violet-600">{idrCompact(row.tax)}</span> : <span className="text-muted-foreground text-xs">—</span>}</td>
                            <td className={`${tdCls} text-right`}>{row.outstanding > 0 ? <span className="text-amber-600 font-medium flex items-center justify-end gap-1"><AlertTriangle className="h-3 w-3" />{idrCompact(row.outstanding)}</span> : <span className="text-emerald-600 text-xs">Lunas</span>}</td>
                            <td className={`${tdCls} text-right font-semibold ${row.profit < 0 ? "text-red-600" : "text-blue-700"}`}>{idrCompact(row.profit)}</td>
                            <td className={`${tdCls} text-right`}><MarginBadge pct={row.profitabilityPct} /></td>
                          </tr>
                        ))
                      }
                    </tbody>
                  </table>
                </div>
              </CardContent>
            </Card>
          </TabsContent>

          {/* ── TAB: Per Rute ── */}
          <TabsContent value="routes" className="mt-4 space-y-3">
            {/* Summary cards */}
            {routesQuery.data && (
              <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-2">
                {[
                  { label: "Total Rute", value: String(routesQuery.data.total), icon: <MapPin className="h-3.5 w-3.5 text-indigo-500" />, color: "border-l-indigo-400", text: "text-indigo-700" },
                  { label: "Total Order", value: String(routesQuery.data.summary.totalOrders), icon: <ShoppingCart className="h-3.5 w-3.5 text-blue-500" />, color: "border-l-blue-400", text: "text-blue-700" },
                  { label: "Revenue", value: idrCompact(routesQuery.data.summary.totalRevenue), icon: <DollarSign className="h-3.5 w-3.5 text-emerald-600" />, color: "border-l-emerald-500", text: "text-emerald-700" },
                  { label: "Vendor Cost", value: idrCompact(routesQuery.data.summary.totalVendorCost), icon: <Truck className="h-3.5 w-3.5 text-slate-500" />, color: "border-l-slate-400", text: "text-slate-700" },
                  { label: "Truck Cost", value: idrCompact(routesQuery.data.summary.totalTruckCost), icon: <Truck className="h-3.5 w-3.5 text-orange-500" />, color: "border-l-orange-400", text: "text-orange-700" },
                  {
                    label: "Gross Margin",
                    value: `${idrCompact(routesQuery.data.summary.totalGrossMargin)} · ${routesQuery.data.summary.avgMarginPct.toFixed(1)}%`,
                    icon: <TrendingUp className="h-3.5 w-3.5 text-blue-600" />,
                    color: routesQuery.data.summary.totalGrossMargin < 0 ? "border-l-red-500" : "border-l-blue-500",
                    text: routesQuery.data.summary.totalGrossMargin < 0 ? "text-red-600" : "text-blue-700",
                  },
                ].map(card => (
                  <Card key={card.label} className={`border-l-4 ${card.color}`}>
                    <CardContent className="flex items-center gap-2 p-2.5">
                      {card.icon}
                      <div className="min-w-0">
                        <div className="text-[10px] text-muted-foreground leading-none mb-0.5">{card.label}</div>
                        <div className={`font-semibold text-xs leading-none ${card.text} truncate`}>{card.value}</div>
                      </div>
                    </CardContent>
                  </Card>
                ))}
              </div>
            )}

            {/* Charts — Top 10 routes by Revenue, Gross Margin, Margin % */}
            {(routesQuery.data?.items.length ?? 0) >= 2 && (
              <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                <Card>
                  <CardContent className="p-4">
                    <ProfitBarChart rows={toBarRows(routesQuery.data!.items)} metric="revenue" label="Top 10 Rute by Revenue" />
                  </CardContent>
                </Card>
                <Card>
                  <CardContent className="p-4">
                    <ProfitBarChart rows={toBarRows(routesQuery.data!.items)} metric="grossMargin" label="Top 10 Rute by Gross Margin" />
                  </CardContent>
                </Card>
                <Card>
                  <CardContent className="p-4">
                    <ProfitBarChart
                      rows={toBarRows([...routesQuery.data!.items].sort((a, b) => b.marginPct - a.marginPct))}
                      metric="marginPct"
                      label="Top 10 Rute by Margin %"
                    />
                  </CardContent>
                </Card>
              </div>
            )}

            {/* Route table */}
            <Card>
              <CardHeader className="py-3 px-4 border-b">
                <div className="flex items-center justify-between gap-3 flex-wrap">
                  <CardTitle className="text-sm font-semibold flex items-center gap-2">
                    <MapPin className="h-4 w-4 text-indigo-500" />
                    Profitabilitas per Rute
                    {routesQuery.data && <Badge variant="secondary" className="text-[10px]">{routesQuery.data.total} rute</Badge>}
                  </CardTitle>
                  <div className="relative">
                    <Search className="absolute left-2.5 top-2 h-3.5 w-3.5 text-muted-foreground" />
                    <Input
                      className="pl-8 h-8 text-sm w-48"
                      placeholder="Filter rute…"
                      value={routeSearch}
                      onChange={e => setRouteSearch(e.target.value)}
                    />
                  </div>
                </div>
              </CardHeader>
              <CardContent className="p-0">
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead>
                      <tr>
                        <th className={thCls}>#</th>
                        <th className={thCls}>Origin</th>
                        <th className={thCls}>Destination</th>
                        <th className={`${thCls} text-right`}>Order</th>
                        <th className={`${thCls} text-right`}>Revenue</th>
                        <th className={`${thCls} text-right`}>Vendor Cost</th>
                        <th className={`${thCls} text-right`}>Truck Cost</th>
                        <th className={`${thCls} text-right`}>Tax</th>
                        <th className={`${thCls} text-right bg-indigo-50`}>Shipment Margin</th>
                        <th className={`${thCls} text-right`}>Order Gross Margin</th>
                        <th className={`${thCls} text-right`}>Margin %</th>
                        <th className={thCls}>Bar</th>
                      </tr>
                    </thead>
                    <tbody>
                      {routesQuery.isLoading
                        ? [...Array(8)].map((_, i) => <tr key={i}>{[...Array(12)].map((_, j) => <td key={j} className={tdCls}><Skeleton className="h-4 w-full" /></td>)}</tr>)
                        : routeRows.length === 0
                        ? <tr><td colSpan={12} className="text-center py-10 text-sm text-muted-foreground">Tidak ada data rute{routeSearch ? ` untuk "${routeSearch}"` : ""}</td></tr>
                        : routeRows.map((row, i) => {
                          const maxRev = routeRows[0]?.revenue ?? 1;
                          const barW = Math.min(row.revenue / maxRev * 100, 100);
                          const shipMargin = row.shipmentMargin ?? row.grossMargin;
                          const ogm = row.orderGrossMargin ?? row.grossMargin;
                          return (
                            <tr key={row.route} className="hover:bg-white/5 transition-colors duration-150">
                              <td className={`${tdCls} text-xs font-bold text-muted-foreground w-8`}>{routePage * ROUTE_PAGE_SIZE + i + 1}</td>
                              <td className={tdCls}>
                                <span className="font-medium text-slate-800">{row.origin}</span>
                              </td>
                              <td className={tdCls}>
                                <span className="font-medium text-slate-800">{row.destination}</span>
                              </td>
                              <td className={`${tdCls} text-right`}>
                                <Badge variant="secondary" className="text-[10px]">{row.orderCount}</Badge>
                              </td>
                              <td className={`${tdCls} text-right font-semibold text-emerald-700`}>{idrCompact(row.revenue)}</td>
                              <td className={`${tdCls} text-right text-slate-600`}>{idrCompact(row.vendorCost)}</td>
                              <td className={`${tdCls} text-right`}>
                                {row.truckCost > 0 ? <span className="text-orange-600">{idrCompact(row.truckCost)}</span> : <span className="text-muted-foreground text-xs">—</span>}
                              </td>
                              <td className={`${tdCls} text-right`}>
                                {row.tax > 0 ? <span className="text-violet-600">{idrCompact(row.tax)}</span> : <span className="text-muted-foreground text-xs">—</span>}
                              </td>
                              <td className={`${tdCls} text-right bg-indigo-50/40 font-semibold ${shipMargin < 0 ? "text-red-600" : "text-indigo-700"}`}>{idrCompact(shipMargin)}</td>
                              <td className={`${tdCls} text-right font-semibold ${ogm < 0 ? "text-red-600" : "text-blue-700"}`}>{idrCompact(ogm)}</td>
                              <td className={`${tdCls} text-right`}><MarginBadge pct={row.marginPct} /></td>
                              <td className={`${tdCls} w-24`}>
                                <div className="flex items-center gap-1">
                                  <div className="flex-1 bg-slate-100 rounded-full h-1.5">
                                    <div className="h-1.5 rounded-full bg-emerald-400 transition-all" style={{ width: `${barW}%` }} />
                                  </div>
                                </div>
                              </td>
                            </tr>
                          );
                        })
                      }
                    </tbody>
                    {routeRows.length > 0 && routesQuery.data && (
                      <tfoot>
                        <tr className="bg-slate-50 font-semibold border-t-2 border-slate-200">
                          <td colSpan={3} className="px-3 py-2 text-xs text-muted-foreground">Total semua rute</td>
                          <td className="px-3 py-2 text-right text-sm text-blue-700">{routesQuery.data.summary.totalOrders}</td>
                          <td className="px-3 py-2 text-right text-sm text-emerald-700">{idrCompact(routesQuery.data.summary.totalRevenue)}</td>
                          <td className="px-3 py-2 text-right text-sm text-slate-700">{idrCompact(routesQuery.data.summary.totalVendorCost)}</td>
                          <td className="px-3 py-2 text-right text-sm text-orange-700">{idrCompact(routesQuery.data.summary.totalTruckCost)}</td>
                          <td className="px-3 py-2 text-right text-sm text-violet-700">{idrCompact(routesQuery.data.summary.totalTax)}</td>
                          <td className={`px-3 py-2 text-right text-sm font-bold bg-indigo-50/40 ${routesQuery.data.summary.totalGrossMargin < 0 ? "text-red-600" : "text-indigo-700"}`}>
                            {idrCompact(routesQuery.data.summary.totalGrossMargin)}
                          </td>
                          <td className={`px-3 py-2 text-right text-sm font-bold ${routesQuery.data.summary.totalGrossMargin < 0 ? "text-red-600" : "text-blue-700"}`}>
                            {idrCompact(routesQuery.data.summary.totalGrossMargin)}
                          </td>
                          <td className="px-3 py-2 text-right"><MarginBadge pct={routesQuery.data.summary.avgMarginPct} /></td>
                          <td />
                        </tr>
                      </tfoot>
                    )}
                  </table>
                </div>
                {routesQuery.data && routesQuery.data.total > ROUTE_PAGE_SIZE && !routeSearch && (
                  <div className="flex items-center justify-between px-4 py-2 border-t bg-slate-50/50">
                    <span className="text-xs text-muted-foreground">{routePage * ROUTE_PAGE_SIZE + 1}–{Math.min((routePage + 1) * ROUTE_PAGE_SIZE, routesQuery.data.total)} dari {routesQuery.data.total} rute</span>
                    <div className="flex gap-1">
                      <Button variant="outline" size="sm" className="h-7 w-7 p-0" disabled={routePage === 0} onClick={() => setRoutePage(p => p - 1)}><ChevronLeft className="h-3.5 w-3.5" /></Button>
                      <Button variant="outline" size="sm" className="h-7 w-7 p-0" disabled={(routePage + 1) * ROUTE_PAGE_SIZE >= routesQuery.data.total} onClick={() => setRoutePage(p => p + 1)}><ChevronRight className="h-3.5 w-3.5" /></Button>
                    </div>
                  </div>
                )}
              </CardContent>
            </Card>
          </TabsContent>

          {/* ── TAB: Per Komoditi ── */}
          <TabsContent value="commodities" className="mt-4 space-y-3">
            {/* Summary cards */}
            {commoditiesQuery.data && (
              <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-2">
                {[
                  { label: "Total Komoditi", value: String(commoditiesQuery.data.total), icon: <Package className="h-3.5 w-3.5 text-indigo-500" />, color: "border-l-indigo-400", text: "text-indigo-700" },
                  { label: "Total Order", value: String(commoditiesQuery.data.summary.totalOrders), icon: <ShoppingCart className="h-3.5 w-3.5 text-blue-500" />, color: "border-l-blue-400", text: "text-blue-700" },
                  { label: "Revenue", value: idrCompact(commoditiesQuery.data.summary.totalRevenue), icon: <DollarSign className="h-3.5 w-3.5 text-emerald-600" />, color: "border-l-emerald-500", text: "text-emerald-700" },
                  { label: "Vendor Cost", value: idrCompact(commoditiesQuery.data.summary.totalVendorCost), icon: <Truck className="h-3.5 w-3.5 text-slate-500" />, color: "border-l-slate-400", text: "text-slate-700" },
                  { label: "Truck Cost", value: idrCompact(commoditiesQuery.data.summary.totalTruckCost), icon: <Truck className="h-3.5 w-3.5 text-orange-500" />, color: "border-l-orange-400", text: "text-orange-700" },
                  {
                    label: "Gross Margin",
                    value: `${idrCompact(commoditiesQuery.data.summary.totalGrossMargin)} · ${commoditiesQuery.data.summary.avgMarginPct.toFixed(1)}%`,
                    icon: <TrendingUp className="h-3.5 w-3.5 text-blue-600" />,
                    color: commoditiesQuery.data.summary.totalGrossMargin < 0 ? "border-l-red-500" : "border-l-blue-500",
                    text: commoditiesQuery.data.summary.totalGrossMargin < 0 ? "text-red-600" : "text-blue-700",
                  },
                ].map(card => (
                  <Card key={card.label} className={`border-l-4 ${card.color}`}>
                    <CardContent className="flex items-center gap-2 p-2.5">
                      {card.icon}
                      <div className="min-w-0">
                        <div className="text-[10px] text-muted-foreground leading-none mb-0.5">{card.label}</div>
                        <div className={`font-semibold text-xs leading-none ${card.text} truncate`}>{card.value}</div>
                      </div>
                    </CardContent>
                  </Card>
                ))}
              </div>
            )}

            {/* Charts — 3 panels */}
            {(commoditiesQuery.data?.items.length ?? 0) >= 2 && (
              <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                <Card>
                  <CardContent className="p-4">
                    <ProfitBarChart rows={commodityToBarRows(commoditiesQuery.data!.items)} metric="revenue" label="Revenue per Komoditi" />
                  </CardContent>
                </Card>
                <Card>
                  <CardContent className="p-4">
                    <ProfitBarChart rows={commodityToBarRows(commoditiesQuery.data!.items)} metric="grossMargin" label="Gross Margin per Komoditi" />
                  </CardContent>
                </Card>
                <Card>
                  <CardContent className="p-4">
                    <ProfitBarChart
                      rows={commodityToBarRows([...commoditiesQuery.data!.items].sort((a, b) => b.marginPct - a.marginPct))}
                      metric="marginPct"
                      label="Margin % per Komoditi"
                    />
                  </CardContent>
                </Card>
              </div>
            )}

            {/* Commodity table */}
            <Card>
              <CardHeader className="py-3 px-4 border-b">
                <CardTitle className="text-sm font-semibold flex items-center gap-2">
                  <Package className="h-4 w-4 text-indigo-500" />
                  Profitabilitas per Komoditi
                  {commoditiesQuery.data && <Badge variant="secondary" className="text-[10px]">{commoditiesQuery.data.total} komoditi</Badge>}
                </CardTitle>
              </CardHeader>
              <CardContent className="p-0">
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead>
                      <tr>
                        <th className={thCls}>#</th>
                        <th className={thCls}>Komoditi</th>
                        <th className={`${thCls} text-right`}>Order</th>
                        <th className={`${thCls} text-right`}>Revenue</th>
                        <th className={`${thCls} text-right`}>Vendor Cost</th>
                        <th className={`${thCls} text-right`}>Truck Cost</th>
                        <th className={`${thCls} text-right`}>Tax</th>
                        <th className={`${thCls} text-right bg-indigo-50`}>Shipment Margin</th>
                        <th className={`${thCls} text-right`}>Order Gross Margin</th>
                        <th className={`${thCls} text-right`}>Margin %</th>
                        <th className={thCls}>Bar</th>
                      </tr>
                    </thead>
                    <tbody>
                      {commoditiesQuery.isLoading
                        ? [...Array(6)].map((_, i) => <tr key={i}>{[...Array(11)].map((_, j) => <td key={j} className={tdCls}><Skeleton className="h-4 w-full" /></td>)}</tr>)
                        : (commoditiesQuery.data?.items ?? []).length === 0
                        ? <tr><td colSpan={11} className="text-center py-10 text-sm text-muted-foreground">Tidak ada data komoditi</td></tr>
                        : (commoditiesQuery.data?.items ?? []).map((row, i) => {
                          const maxRev = commoditiesQuery.data!.items[0]?.revenue ?? 1;
                          const barW = Math.min(row.revenue / maxRev * 100, 100);
                          const barMarginW = Math.min(Math.max(row.marginPct, 0) / 60 * 100, 100);
                          const shipMgn = row.shipmentMargin ?? row.grossMargin;
                          const ogm = row.orderGrossMargin ?? row.grossMargin;
                          return (
                            <tr key={row.commodity} className="hover:bg-white/5 transition-colors duration-150">
                              <td className={`${tdCls} text-xs font-bold text-muted-foreground w-8`}>{i + 1}</td>
                              <td className={tdCls}>
                                <div className="flex items-center gap-2">
                                  <span className="text-lg leading-none">{getCommodityIcon(row.commodity)}</span>
                                  <div>
                                    <div className="font-semibold text-slate-800">{row.commodity}</div>
                                  </div>
                                </div>
                              </td>
                              <td className={`${tdCls} text-right`}>
                                <Badge variant="secondary" className="text-[10px]">{row.orderCount}</Badge>
                              </td>
                              <td className={`${tdCls} text-right font-semibold text-emerald-700`}>{idrCompact(row.revenue)}</td>
                              <td className={`${tdCls} text-right text-slate-600`}>{idrCompact(row.vendorCost)}</td>
                              <td className={`${tdCls} text-right`}>
                                {row.truckCost > 0 ? <span className="text-orange-600">{idrCompact(row.truckCost)}</span> : <span className="text-muted-foreground text-xs">—</span>}
                              </td>
                              <td className={`${tdCls} text-right`}>
                                {row.tax > 0 ? <span className="text-violet-600">{idrCompact(row.tax)}</span> : <span className="text-muted-foreground text-xs">—</span>}
                              </td>
                              <td className={`${tdCls} text-right bg-indigo-50/40 font-semibold ${shipMgn < 0 ? "text-red-600" : "text-indigo-700"}`}>{idrCompact(shipMgn)}</td>
                              <td className={`${tdCls} text-right font-semibold ${ogm < 0 ? "text-red-600" : "text-blue-700"}`}>{idrCompact(ogm)}</td>
                              <td className={`${tdCls} text-right`}><MarginBadge pct={row.marginPct} /></td>
                              <td className={`${tdCls} w-32`}>
                                <div className="space-y-0.5">
                                  <div className="flex items-center gap-1">
                                    <div className="flex-1 bg-slate-100 rounded-full h-1.5">
                                      <div className="h-1.5 rounded-full bg-emerald-400" style={{ width: `${barW}%` }} />
                                    </div>
                                  </div>
                                  <div className="flex items-center gap-1">
                                    <div className="flex-1 bg-slate-100 rounded-full h-1.5">
                                      <div className={`h-1.5 rounded-full ${row.marginPct >= 25 ? "bg-blue-500" : row.marginPct >= 10 ? "bg-amber-400" : "bg-red-400"}`} style={{ width: `${barMarginW}%` }} />
                                    </div>
                                  </div>
                                </div>
                              </td>
                            </tr>
                          );
                        })
                      }
                    </tbody>
                    {(commoditiesQuery.data?.items.length ?? 0) > 0 && commoditiesQuery.data && (
                      <tfoot>
                        <tr className="bg-slate-50 font-semibold border-t-2 border-slate-200">
                          <td colSpan={2} className="px-3 py-2 text-xs text-muted-foreground">Total semua komoditi</td>
                          <td className="px-3 py-2 text-right text-sm text-blue-700">{commoditiesQuery.data.summary.totalOrders}</td>
                          <td className="px-3 py-2 text-right text-sm text-emerald-700">{idrCompact(commoditiesQuery.data.summary.totalRevenue)}</td>
                          <td className="px-3 py-2 text-right text-sm text-slate-700">{idrCompact(commoditiesQuery.data.summary.totalVendorCost)}</td>
                          <td className="px-3 py-2 text-right text-sm text-orange-700">{idrCompact(commoditiesQuery.data.summary.totalTruckCost)}</td>
                          <td className="px-3 py-2 text-right text-sm text-violet-700">{idrCompact(commoditiesQuery.data.summary.totalTax)}</td>
                          <td className={`px-3 py-2 text-right text-sm font-bold bg-indigo-50/40 ${commoditiesQuery.data.summary.totalGrossMargin < 0 ? "text-red-600" : "text-indigo-700"}`}>
                            {idrCompact(commoditiesQuery.data.summary.totalGrossMargin)}
                          </td>
                          <td className={`px-3 py-2 text-right text-sm font-bold ${commoditiesQuery.data.summary.totalGrossMargin < 0 ? "text-red-600" : "text-blue-700"}`}>
                            {idrCompact(commoditiesQuery.data.summary.totalGrossMargin)}
                          </td>
                          <td className="px-3 py-2 text-right"><MarginBadge pct={commoditiesQuery.data.summary.avgMarginPct} /></td>
                          <td />
                        </tr>
                      </tfoot>
                    )}
                  </table>
                </div>
              </CardContent>
            </Card>

            {/* Commodity "hero" cards — top 3 by margin */}
            {(commoditiesQuery.data?.items.length ?? 0) > 0 && (
              <div className="space-y-1.5">
                <div className="text-xs font-semibold text-muted-foreground uppercase tracking-wide px-1">Top 3 Komoditi by Gross Margin</div>
                <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                  {[...( commoditiesQuery.data?.items ?? [])]
                    .sort((a, b) => b.grossMargin - a.grossMargin)
                    .slice(0, 3)
                    .map((row, i) => (
                      <Card key={row.commodity} className={`border-l-4 ${i === 0 ? "border-l-yellow-400" : i === 1 ? "border-l-slate-400" : "border-l-amber-600"}`}>
                        <CardContent className="p-3 flex items-start gap-3">
                          <div className="text-3xl leading-none mt-0.5">{getCommodityIcon(row.commodity)}</div>
                          <div className="min-w-0 flex-1">
                            <div className="flex items-center gap-1.5 mb-1">
                              <span className="text-[10px] font-bold text-muted-foreground">#{i + 1}</span>
                              <span className="font-semibold text-sm truncate">{row.commodity}</span>
                            </div>
                            <div className="grid grid-cols-2 gap-x-3 gap-y-0.5 text-xs">
                              <span className="text-muted-foreground">Revenue</span>
                              <span className="font-medium text-emerald-700 text-right">{idrCompact(row.revenue)}</span>
                              <span className="text-muted-foreground">Gross Margin</span>
                              <span className={`font-bold text-right ${row.grossMargin < 0 ? "text-red-600" : "text-blue-700"}`}>{idrCompact(row.grossMargin)}</span>
                              <span className="text-muted-foreground">Margin %</span>
                              <span className="text-right"><MarginBadge pct={row.marginPct} /></span>
                              <span className="text-muted-foreground">Order</span>
                              <span className="text-right"><Badge variant="secondary" className="text-[10px]">{row.orderCount}</Badge></span>
                            </div>
                          </div>
                        </CardContent>
                      </Card>
                    ))}
                </div>
              </div>
            )}
          </TabsContent>

          {/* ── TAB: Vendors ── */}
          <TabsContent value="vendors" className="mt-4 space-y-3">
            {/* Summary cards */}
            {vendorsQuery.data && (
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
                {[
                  {
                    label: "Product Vendors",
                    value: String(vendorsQuery.data.productVendors.length),
                    icon: <Package className="h-3.5 w-3.5 text-violet-500" />,
                    color: "border-l-violet-400", text: "text-violet-700",
                  },
                  {
                    label: "Shipment Vendors",
                    value: String(vendorsQuery.data.shipmentVendors.length),
                    icon: <Truck className="h-3.5 w-3.5 text-indigo-500" />,
                    color: "border-l-indigo-400", text: "text-indigo-700",
                  },
                  {
                    label: "Total Product Cost",
                    value: idrCompact(vendorsQuery.data.productVendors.reduce((s, r) => s + r.totalCost, 0)),
                    icon: <DollarSign className="h-3.5 w-3.5 text-violet-500" />,
                    color: "border-l-violet-300", text: "text-violet-700",
                  },
                  {
                    label: "Avg Shipment Win Rate",
                    value: pct(
                      vendorsQuery.data.shipmentVendors.length > 0
                        ? vendorsQuery.data.shipmentVendors.reduce((s, r) => s + r.winRate, 0) / vendorsQuery.data.shipmentVendors.length
                        : 0
                    ),
                    icon: <Target className="h-3.5 w-3.5 text-emerald-500" />,
                    color: "border-l-emerald-400", text: "text-emerald-700",
                  },
                ].map(card => (
                  <Card key={card.label} className={`border-l-4 ${card.color}`}>
                    <CardContent className="flex items-center gap-2 p-2.5">
                      {card.icon}
                      <div className="min-w-0">
                        <div className="text-[10px] text-muted-foreground leading-none mb-0.5">{card.label}</div>
                        <div className={`font-semibold text-sm leading-none ${card.text} truncate`}>{card.value}</div>
                      </div>
                    </CardContent>
                  </Card>
                ))}
              </div>
            )}

            {/* Sub-tabs: Product / Shipment / Combined */}
            <Tabs value={vendorSubTab} onValueChange={v => setVendorSubTab(v as typeof vendorSubTab)}>
              <TabsList className="w-full sm:w-auto">
                <TabsTrigger value="product" className="gap-1.5">
                  <Package className="h-3.5 w-3.5" />
                  Product Vendors
                  {vendorsQuery.data && (
                    <Badge variant="secondary" className="text-[10px] ml-1">{vendorsQuery.data.productVendors.length}</Badge>
                  )}
                </TabsTrigger>
                <TabsTrigger value="shipment" className="gap-1.5">
                  <Truck className="h-3.5 w-3.5" />
                  Shipment Vendors
                  {vendorsQuery.data && (
                    <Badge variant="secondary" className="text-[10px] ml-1">{vendorsQuery.data.shipmentVendors.length}</Badge>
                  )}
                </TabsTrigger>
                <TabsTrigger value="combined" className="gap-1.5">
                  <BarChart2 className="h-3.5 w-3.5" />
                  Combined
                </TabsTrigger>
              </TabsList>

              {/* ── Product Vendors ── */}
              <TabsContent value="product" className="mt-3 space-y-3">
                {vendorsQuery.isLoading ? (
                  <Card><CardContent className="p-4 space-y-2">{[...Array(4)].map((_, i) => <Skeleton key={i} className="h-8 w-full" />)}</CardContent></Card>
                ) : (vendorsQuery.data?.productVendors ?? []).length === 0 ? (
                  <Card>
                    <CardContent className="py-14 flex flex-col items-center gap-3 text-center">
                      <Package className="h-10 w-10 text-muted-foreground/30" />
                      <div>
                        <p className="font-semibold text-sm text-muted-foreground">Belum ada data Product Vendor</p>
                        <p className="text-xs text-muted-foreground mt-1 max-w-sm mx-auto">
                          Data akan muncul setelah Product-First order memiliki product vendor terpilih.
                        </p>
                      </div>
                    </CardContent>
                  </Card>
                ) : (
                  <>
                    {vendorsQuery.data!.productVendors.length >= 2 && (
                      <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                        <Card>
                          <CardContent className="p-4">
                            <ProfitBarChart
                              rows={vendorsQuery.data!.productVendors.map(v => ({ name: v.vendorName, revenue: v.totalRevenue, grossMargin: v.totalMargin, marginPct: v.marginPct }))}
                              metric="grossMargin"
                              label="Top Product Vendors by Margin"
                            />
                          </CardContent>
                        </Card>
                        <Card>
                          <CardContent className="p-4">
                            <ProfitBarChart
                              rows={[...vendorsQuery.data!.productVendors].sort((a, b) => b.marginPct - a.marginPct).map(v => ({ name: v.vendorName, revenue: v.totalRevenue, grossMargin: v.totalMargin, marginPct: v.marginPct }))}
                              metric="marginPct"
                              label="Top Product Vendors by Margin %"
                            />
                          </CardContent>
                        </Card>
                      </div>
                    )}
                    <Card>
                      <CardHeader className="py-3 px-4 border-b">
                        <CardTitle className="text-sm font-semibold flex items-center gap-2">
                          <Package className="h-4 w-4 text-violet-500" />
                          Product Vendor Analytics
                          <Badge variant="secondary" className="text-[10px]">{vendorsQuery.data!.productVendors.length} vendor</Badge>
                        </CardTitle>
                      </CardHeader>
                      <CardContent className="p-0">
                        <div className="overflow-x-auto">
                          <table className="w-full text-sm">
                            <thead>
                              <tr>
                                <th className={thCls}>#</th>
                                <th className={thCls}>Vendor</th>
                                <th className={`${thCls} text-right`}>Order</th>
                                <th className={`${thCls} text-right`}>Product Revenue</th>
                                <th className={`${thCls} text-right`}>Product Cost</th>
                                <th className={`${thCls} text-right`}>Product Margin</th>
                                <th className={`${thCls} text-right`}>Margin %</th>
                                <th className={`${thCls} text-right`}>Avg Cost</th>
                                <th className={`${thCls} text-right`}>Win Rate</th>
                                <th className={`${thCls} text-right`}>Win</th>
                              </tr>
                            </thead>
                            <tbody>
                              {vendorsQuery.data!.productVendors.map((row, i) => (
                                <tr key={row.vendorId} className="hover:bg-slate-50 transition-colors">
                                  <td className={`${tdCls} text-xs font-bold text-muted-foreground w-8`}>{i + 1}</td>
                                  <td className={tdCls}><Link href={`/purchase/vendors/${row.vendorId}`} className="font-medium text-blue-700 hover:underline">{row.vendorName}</Link></td>
                                  <td className={`${tdCls} text-right`}><Badge variant="secondary" className="text-[10px]">{row.totalOrders}</Badge></td>
                                  <td className={`${tdCls} text-right font-semibold text-emerald-700`}>{idrCompact(row.totalRevenue)}</td>
                                  <td className={`${tdCls} text-right text-slate-600`}>{idrCompact(row.totalCost)}</td>
                                  <td className={`${tdCls} text-right font-semibold ${row.totalMargin < 0 ? "text-red-600" : "text-blue-700"}`}>{idrCompact(row.totalMargin)}</td>
                                  <td className={`${tdCls} text-right`}><MarginBadge pct={row.marginPct} /></td>
                                  <td className={`${tdCls} text-right text-xs text-muted-foreground`}>{row.avgProductCost > 0 ? idrCompact(row.avgProductCost) : "—"}</td>
                                  <td className={`${tdCls} text-right`}><WinRateBadge rate={row.winRate} /></td>
                                  <td className={`${tdCls} text-right text-xs text-muted-foreground`}>{row.winSelected}/{row.winInvites}</td>
                                </tr>
                              ))}
                            </tbody>
                          </table>
                        </div>
                      </CardContent>
                    </Card>
                  </>
                )}
              </TabsContent>

              {/* ── Shipment Vendors ── */}
              <TabsContent value="shipment" className="mt-3 space-y-3">
                {(vendorsQuery.data?.shipmentVendors.length ?? 0) >= 2 && (
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                    <Card>
                      <CardContent className="p-4">
                        <ProfitBarChart
                          rows={(vendorsQuery.data?.shipmentVendors ?? []).map(v => ({ name: v.vendorName, revenue: v.totalShipmentRevenue, grossMargin: v.totalShipmentMargin, marginPct: v.marginPct }))}
                          metric="grossMargin"
                          label="Top Shipment Vendors by Margin"
                        />
                      </CardContent>
                    </Card>
                    <Card>
                      <CardContent className="p-4">
                        <ProfitBarChart
                          rows={(vendorsQuery.data?.shipmentVendors ?? []).map(v => ({ name: v.vendorName, revenue: v.totalShipmentRevenue, grossMargin: v.totalShipmentMargin, marginPct: v.winRate }))}
                          metric="marginPct"
                          label="Top Shipment Vendors by Win Rate %"
                        />
                      </CardContent>
                    </Card>
                  </div>
                )}
                <Card>
                  <CardHeader className="py-3 px-4 border-b">
                    <CardTitle className="text-sm font-semibold flex items-center gap-2">
                      <Truck className="h-4 w-4 text-indigo-500" />
                      Shipment / Trucking Vendor Analytics
                      {vendorsQuery.data && <Badge variant="secondary" className="text-[10px]">{vendorsQuery.data.shipmentVendors.length} vendor</Badge>}
                    </CardTitle>
                  </CardHeader>
                  <CardContent className="p-0">
                    <div className="overflow-x-auto">
                      <table className="w-full text-sm">
                        <thead>
                          <tr>
                            <th className={thCls}>#</th>
                            <th className={thCls}>Vendor</th>
                            <th className={`${thCls} text-right`}>Order</th>
                            <th className={`${thCls} text-right`}>Shipment Revenue</th>
                            <th className={`${thCls} text-right`}>Shipment Cost</th>
                            <th className={`${thCls} text-right`}>Shipment Margin</th>
                            <th className={`${thCls} text-right`}>Margin %</th>
                            <th className={`${thCls} text-right`}>RFQ</th>
                            <th className={`${thCls} text-right`}>Terpilih</th>
                            <th className={`${thCls} text-right`}>Win Rate</th>
                            <th className={`${thCls} text-right`}>Avg Respon</th>
                          </tr>
                        </thead>
                        <tbody>
                          {vendorsQuery.isLoading
                            ? [...Array(6)].map((_, i) => <tr key={i}>{[...Array(11)].map((_, j) => <td key={j} className={tdCls}><Skeleton className="h-4 w-full" /></td>)}</tr>)
                            : (vendorsQuery.data?.shipmentVendors ?? []).length === 0
                            ? <tr><td colSpan={11} className="text-center py-10 text-sm text-muted-foreground">Tidak ada data shipment vendor</td></tr>
                            : (vendorsQuery.data?.shipmentVendors ?? []).map((row, i) => (
                              <tr key={row.vendorId} className="hover:bg-slate-50 transition-colors">
                                <td className={`${tdCls} text-xs font-bold text-muted-foreground w-8`}>{i + 1}</td>
                                <td className={tdCls}><Link href={`/purchase/vendors/${row.vendorId}`} className="font-medium text-blue-700 hover:underline">{row.vendorName}</Link></td>
                                <td className={`${tdCls} text-right`}><Badge variant="secondary" className="text-[10px]">{row.totalOrders}</Badge></td>
                                <td className={`${tdCls} text-right font-semibold text-emerald-700`}>{idrCompact(row.totalShipmentRevenue)}</td>
                                <td className={`${tdCls} text-right text-slate-600`}>{row.totalShipmentCost > 0 ? idrCompact(row.totalShipmentCost) : <span className="text-muted-foreground text-xs">—</span>}</td>
                                <td className={`${tdCls} text-right font-semibold ${row.totalShipmentMargin < 0 ? "text-red-600" : "text-blue-700"}`}>{idrCompact(row.totalShipmentMargin)}</td>
                                <td className={`${tdCls} text-right`}><MarginBadge pct={row.marginPct} /></td>
                                <td className={`${tdCls} text-right text-xs text-muted-foreground`}>{row.rfqInvites}</td>
                                <td className={`${tdCls} text-right text-xs text-muted-foreground`}>{row.selectedCount}</td>
                                <td className={`${tdCls} text-right`}><WinRateBadge rate={row.winRate} /></td>
                                <td className={`${tdCls} text-right`}>
                                  <span className="flex items-center justify-end gap-1 text-xs text-muted-foreground">
                                    <Clock className="h-3 w-3" />
                                    {row.avgResponseMin < 60 ? `${row.avgResponseMin.toFixed(0)}m` : `${(row.avgResponseMin / 60).toFixed(1)}j`}
                                  </span>
                                </td>
                              </tr>
                            ))
                          }
                        </tbody>
                      </table>
                    </div>
                  </CardContent>
                </Card>
              </TabsContent>

              {/* ── Combined / Legacy ── */}
              <TabsContent value="combined" className="mt-3">
                <Card>
                  <CardHeader className="py-3 px-4 border-b">
                    <CardTitle className="text-sm font-semibold flex items-center gap-2">
                      <BarChart2 className="h-4 w-4 text-slate-500" />
                      Combined Vendor View
                      {vendorsQuery.data && <Badge variant="secondary" className="text-[10px]">{vendorsQuery.data.combined.length} vendor</Badge>}
                    </CardTitle>
                  </CardHeader>
                  <CardContent className="p-0">
                    <div className="overflow-x-auto">
                      <table className="w-full text-sm">
                        <thead>
                          <tr>
                            <th className={thCls}>#</th>
                            <th className={thCls}>Vendor</th>
                            <th className={thCls}>Tipe</th>
                            <th className={`${thCls} text-right`}>Order</th>
                            <th className={`${thCls} text-right`}>Total Spend</th>
                            <th className={`${thCls} text-right`}>Win Rate</th>
                            <th className={`${thCls} text-right`}>Win</th>
                            <th className={`${thCls} text-right`}>Avg Respon</th>
                          </tr>
                        </thead>
                        <tbody>
                          {vendorsQuery.isLoading
                            ? [...Array(6)].map((_, i) => <tr key={i}>{[...Array(8)].map((_, j) => <td key={j} className={tdCls}><Skeleton className="h-4 w-full" /></td>)}</tr>)
                            : (vendorsQuery.data?.combined ?? []).length === 0
                            ? <tr><td colSpan={8} className="text-center py-10 text-sm text-muted-foreground">Tidak ada data vendor</td></tr>
                            : (vendorsQuery.data?.combined ?? []).map((row, i) => (
                              <tr key={`${row.vendorType}-${row.vendorId}`} className="hover:bg-slate-50 transition-colors">
                                <td className={`${tdCls} text-xs font-bold text-muted-foreground w-8`}>{i + 1}</td>
                                <td className={tdCls}><Link href={`/purchase/vendors/${row.vendorId}`} className="font-medium text-blue-700 hover:underline">{row.vendorName}</Link></td>
                                <td className={tdCls}>
                                  <Badge className={`text-[10px] ${row.vendorType === "product" ? "bg-violet-100 text-violet-800 border-violet-200" : "bg-indigo-100 text-indigo-800 border-indigo-200"}`}>
                                    {row.vendorType === "product" ? "Produk" : "Pengiriman"}
                                  </Badge>
                                </td>
                                <td className={`${tdCls} text-right`}><Badge variant="secondary" className="text-[10px]">{row.orderCount}</Badge></td>
                                <td className={`${tdCls} text-right font-semibold text-slate-700`}>{idrCompact(row.totalSpend)}</td>
                                <td className={`${tdCls} text-right`}><WinRateBadge rate={row.winRate} /></td>
                                <td className={`${tdCls} text-right text-xs text-muted-foreground`}>{row.totalWins}/{row.totalInvites}</td>
                                <td className={`${tdCls} text-right`}>
                                  <span className="flex items-center justify-end gap-1 text-xs text-muted-foreground">
                                    <Clock className="h-3 w-3" />
                                    {row.avgResponseMin > 0 ? (row.avgResponseMin < 60 ? `${row.avgResponseMin.toFixed(0)}m` : `${(row.avgResponseMin / 60).toFixed(1)}j`) : "—"}
                                  </span>
                                </td>
                              </tr>
                            ))
                          }
                        </tbody>
                      </table>
                    </div>
                  </CardContent>
                </Card>
              </TabsContent>
            </Tabs>
          </TabsContent>

          {/* ─────────────────── PROFIT LEAKAGE TAB ─────────────────── */}
          <TabsContent value="leakage" className="mt-4 space-y-4">
            {/* Tab header with export button */}
            <div className="flex items-center justify-between">
              <div>
                <h2 className="text-base font-semibold flex items-center gap-2 text-red-700">
                  <AlertTriangle className="h-4 w-4" />
                  Profit Leakage Dashboard
                </h2>
                <p className="text-xs text-muted-foreground mt-0.5">
                  Identifikasi order bermasalah: margin negatif, margin rendah, dan high-revenue low-margin.
                </p>
              </div>
              {!ordersQuery.isLoading && problematicOrders.length > 0 && (
                <Button
                  variant="outline"
                  size="sm"
                  onClick={downloadLeakageCSV}
                  className="gap-1.5 h-8 shrink-0 border-red-200 text-red-700 hover:bg-red-50"
                >
                  <FileDown className="h-3.5 w-3.5" />
                  Export CSV
                </Button>
              )}
            </div>

            {/* Loading skeleton */}
            {ordersQuery.isLoading && (
              <div className="grid grid-cols-2 sm:grid-cols-5 gap-3">
                {[...Array(5)].map((_, i) => (
                  <Card key={i}><CardContent className="p-3"><Skeleton className="h-14 w-full" /></CardContent></Card>
                ))}
              </div>
            )}

            {!ordersQuery.isLoading && orderRows.length === 0 && (
              <Card>
                <CardContent className="py-16 text-center">
                  <AlertTriangle className="h-10 w-10 text-muted-foreground mx-auto mb-3 opacity-40" />
                  <p className="text-sm text-muted-foreground">Tidak ada data order untuk periode ini.</p>
                </CardContent>
              </Card>
            )}

            {!ordersQuery.isLoading && orderRows.length > 0 && (
              <>
                {/* ── Summary Cards ── */}
                <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-3">
                  {[
                    {
                      label: "Order Margin Negatif",
                      value: negativeMarginOrders.length,
                      sub: `dari ${orderRows.length} order`,
                      icon: <AlertTriangle className="h-4 w-4 text-red-500" />,
                      color: "border-l-red-500",
                      text: negativeMarginOrders.length > 0 ? "text-red-600" : "text-slate-700",
                    },
                    {
                      label: "Total Kerugian",
                      value: totalLossAmount > 0 ? idrCompact(totalLossAmount) : "—",
                      sub: "dari order margin negatif",
                      icon: <DollarSign className="h-4 w-4 text-red-400" />,
                      color: "border-l-red-400",
                      text: "text-red-600",
                    },
                    {
                      label: "Order Margin Rendah",
                      value: lowMarginOrders.length,
                      sub: "margin 0–10%",
                      icon: <TrendingUp className="h-4 w-4 text-amber-500" />,
                      color: "border-l-amber-400",
                      text: lowMarginOrders.length > 0 ? "text-amber-600" : "text-slate-700",
                    },
                    {
                      label: "High-Rev Low-Margin",
                      value: highRevLowMargin.length,
                      sub: "revenue ≥ P75, margin < 15%",
                      icon: <Target className="h-4 w-4 text-orange-500" />,
                      color: "border-l-orange-400",
                      text: highRevLowMargin.length > 0 ? "text-orange-600" : "text-slate-700",
                    },
                    {
                      label: "Est. Leakage ke Tgt 10%",
                      value: estimatedLeakage > 0 ? idrCompact(estimatedLeakage) : "—",
                      sub: "potensi perbaikan margin",
                      icon: <Receipt className="h-4 w-4 text-indigo-500" />,
                      color: "border-l-indigo-400",
                      text: "text-indigo-700",
                    },
                  ].map(card => (
                    <Card key={card.label} className={`border-l-4 ${card.color}`}>
                      <CardContent className="flex items-start gap-2 p-3">
                        <div className="mt-0.5 shrink-0">{card.icon}</div>
                        <div className="min-w-0">
                          <div className="text-[10px] text-muted-foreground leading-none mb-1">{card.label}</div>
                          <div className={`font-bold text-lg leading-none ${card.text}`}>{card.value}</div>
                          <div className="text-[10px] text-muted-foreground mt-0.5">{card.sub}</div>
                        </div>
                      </CardContent>
                    </Card>
                  ))}
                </div>

                {/* ── Top Leakage Reasons ── */}
                {leakageReasonList.length > 0 && (
                  <Card>
                    <CardHeader className="py-3 px-4 border-b">
                      <CardTitle className="text-sm font-semibold flex items-center gap-2">
                        <AlertTriangle className="h-4 w-4 text-amber-500" />
                        Top Leakage Reasons
                        <span className="text-[10px] font-normal text-muted-foreground ml-1">(order margin negatif atau &lt; 10%)</span>
                      </CardTitle>
                    </CardHeader>
                    <CardContent className="p-4">
                      <div className="flex flex-wrap gap-2">
                        {leakageReasonList.map(({ reason, count }) => (
                          <span
                            key={reason}
                            className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium border ${REASON_COLOR[reason] ?? "bg-slate-100 text-slate-800 border-slate-200"}`}
                          >
                            {reason}
                            <span className="bg-white/60 rounded-full px-1.5 py-0.5 text-[10px] font-bold">{count}</span>
                          </span>
                        ))}
                      </div>
                    </CardContent>
                  </Card>
                )}

                {/* ── Negative Margin Orders ── */}
                {negativeMarginOrders.length > 0 && (
                  <Card>
                    <CardHeader className="py-3 px-4 border-b bg-red-50/60">
                      <CardTitle className="text-sm font-semibold flex items-center gap-2 text-red-700">
                        <AlertTriangle className="h-4 w-4" />
                        Order Margin Negatif ({negativeMarginOrders.length})
                      </CardTitle>
                    </CardHeader>
                    <CardContent className="p-0">
                      <div className="overflow-x-auto">
                        <table className="w-full text-sm">
                          <thead>
                            <tr>
                              <th className={thCls}>#</th>
                              <th className={thCls}>No. Order</th>
                              <th className={thCls}>Customer</th>
                              <th className={`${thCls} text-right`}>Revenue</th>
                              <th className={`${thCls} text-right`}>Gross Margin</th>
                              <th className={`${thCls} text-right`}>Margin %</th>
                              <th className={thCls}>Reason</th>
                              <th className={thCls}>Saran Tindakan</th>
                            </tr>
                          </thead>
                          <tbody>
                            {negativeMarginOrders
                              .sort((a, b) => (a.grossMargin ?? a.margin) - (b.grossMargin ?? b.margin))
                              .map((row, i) => {
                                const gm = row.grossMargin ?? row.margin;
                                const reason = classifyLeakageReason(row);
                                const suggestions = getLeakageSuggestions(row);
                                return (
                                  <tr key={row.id} className="hover:bg-red-50/40 transition-colors">
                                    <td className={`${tdCls} text-xs font-bold text-muted-foreground w-8`}>{i + 1}</td>
                                    <td className={tdCls}>
                                      <Link href={`/logistic-orders/${row.id}`} className="font-medium text-blue-700 hover:underline text-xs">{row.orderNumber}</Link>
                                    </td>
                                    <td className={`${tdCls} text-xs text-muted-foreground`}>{row.customerName}</td>
                                    <td className={`${tdCls} text-right font-semibold text-slate-700`}>{idrCompact(row.revenue)}</td>
                                    <td className={`${tdCls} text-right font-bold text-red-600`}>{idrCompact(gm)}</td>
                                    <td className={`${tdCls} text-right`}>
                                      <span className="text-xs font-bold text-red-600">{row.marginPct.toFixed(1)}%</span>
                                    </td>
                                    <td className={tdCls}>
                                      <span className={`inline-block px-2 py-0.5 rounded-full text-[10px] font-medium border ${REASON_COLOR[reason] ?? "bg-slate-100 text-slate-800 border-slate-200"}`}>
                                        {reason}
                                      </span>
                                    </td>
                                    <td className={`${tdCls} text-xs text-slate-600 max-w-[200px]`}>
                                      <ul className="list-disc list-inside space-y-0.5">
                                        {suggestions.map((s, si) => <li key={si}>{s}</li>)}
                                      </ul>
                                    </td>
                                  </tr>
                                );
                              })}
                          </tbody>
                        </table>
                      </div>
                    </CardContent>
                  </Card>
                )}

                {/* ── Low Margin Orders (0–10%) ── */}
                {lowMarginOrders.length > 0 && (
                  <Card>
                    <CardHeader className="py-3 px-4 border-b bg-amber-50/60">
                      <CardTitle className="text-sm font-semibold flex items-center gap-2 text-amber-700">
                        <TrendingUp className="h-4 w-4" />
                        Order Margin Rendah 0–10% ({lowMarginOrders.length})
                      </CardTitle>
                    </CardHeader>
                    <CardContent className="p-0">
                      <div className="overflow-x-auto">
                        <table className="w-full text-sm">
                          <thead>
                            <tr>
                              <th className={thCls}>#</th>
                              <th className={thCls}>No. Order</th>
                              <th className={thCls}>Customer</th>
                              <th className={`${thCls} text-right`}>Revenue</th>
                              <th className={`${thCls} text-right`}>Gross Margin</th>
                              <th className={`${thCls} text-right`}>Margin %</th>
                              <th className={thCls}>Reason</th>
                              <th className={thCls}>Saran Tindakan</th>
                            </tr>
                          </thead>
                          <tbody>
                            {lowMarginOrders
                              .sort((a, b) => a.marginPct - b.marginPct)
                              .map((row, i) => {
                                const gm = row.grossMargin ?? row.margin;
                                const reason = classifyLeakageReason(row);
                                const suggestions = getLeakageSuggestions(row);
                                return (
                                  <tr key={row.id} className="hover:bg-amber-50/40 transition-colors">
                                    <td className={`${tdCls} text-xs font-bold text-muted-foreground w-8`}>{i + 1}</td>
                                    <td className={tdCls}>
                                      <Link href={`/logistic-orders/${row.id}`} className="font-medium text-blue-700 hover:underline text-xs">{row.orderNumber}</Link>
                                    </td>
                                    <td className={`${tdCls} text-xs text-muted-foreground`}>{row.customerName}</td>
                                    <td className={`${tdCls} text-right font-semibold text-slate-700`}>{idrCompact(row.revenue)}</td>
                                    <td className={`${tdCls} text-right font-bold`}><span className="text-amber-700">{idrCompact(gm)}</span></td>
                                    <td className={`${tdCls} text-right`}>
                                      <span className="text-xs font-bold text-amber-600">{row.marginPct.toFixed(1)}%</span>
                                    </td>
                                    <td className={tdCls}>
                                      <span className={`inline-block px-2 py-0.5 rounded-full text-[10px] font-medium border ${REASON_COLOR[reason] ?? "bg-slate-100 text-slate-800 border-slate-200"}`}>
                                        {reason}
                                      </span>
                                    </td>
                                    <td className={`${tdCls} text-xs text-slate-600 max-w-[200px]`}>
                                      <ul className="list-disc list-inside space-y-0.5">
                                        {suggestions.map((s, si) => <li key={si}>{s}</li>)}
                                      </ul>
                                    </td>
                                  </tr>
                                );
                              })}
                          </tbody>
                        </table>
                      </div>
                    </CardContent>
                  </Card>
                )}

                {/* ── High Revenue Low Margin ── */}
                {highRevLowMargin.length > 0 && (
                  <Card>
                    <CardHeader className="py-3 px-4 border-b bg-orange-50/60">
                      <CardTitle className="text-sm font-semibold flex items-center gap-2 text-orange-700">
                        <Target className="h-4 w-4" />
                        High Revenue, Low Margin ({highRevLowMargin.length})
                        <span className="text-[10px] font-normal text-muted-foreground">Revenue ≥ P75 dan margin &lt; 15% — prioritas review</span>
                      </CardTitle>
                    </CardHeader>
                    <CardContent className="p-0">
                      <div className="overflow-x-auto">
                        <table className="w-full text-sm">
                          <thead>
                            <tr>
                              <th className={thCls}>#</th>
                              <th className={thCls}>No. Order</th>
                              <th className={thCls}>Customer</th>
                              <th className={`${thCls} text-right`}>Revenue</th>
                              <th className={`${thCls} text-right`}>Gross Margin</th>
                              <th className={`${thCls} text-right`}>Margin %</th>
                              <th className={thCls}>Reason</th>
                              <th className={thCls}>Saran Tindakan</th>
                            </tr>
                          </thead>
                          <tbody>
                            {highRevLowMargin
                              .sort((a, b) => b.revenue - a.revenue)
                              .map((row, i) => {
                                const gm = row.grossMargin ?? row.margin;
                                const reason = classifyLeakageReason(row);
                                const suggestions = getLeakageSuggestions(row);
                                return (
                                  <tr key={row.id} className="hover:bg-orange-50/40 transition-colors">
                                    <td className={`${tdCls} text-xs font-bold text-muted-foreground w-8`}>{i + 1}</td>
                                    <td className={tdCls}>
                                      <Link href={`/logistic-orders/${row.id}`} className="font-medium text-blue-700 hover:underline text-xs">{row.orderNumber}</Link>
                                    </td>
                                    <td className={`${tdCls} text-xs text-muted-foreground`}>{row.customerName}</td>
                                    <td className={`${tdCls} text-right font-bold text-orange-700`}>{idrCompact(row.revenue)}</td>
                                    <td className={`${tdCls} text-right`}><span className={gm < 0 ? "font-bold text-red-600" : "font-semibold text-slate-700"}>{idrCompact(gm)}</span></td>
                                    <td className={`${tdCls} text-right`}>
                                      <span className={`text-xs font-bold ${row.marginPct < 5 ? "text-red-600" : "text-orange-600"}`}>{row.marginPct.toFixed(1)}%</span>
                                    </td>
                                    <td className={tdCls}>
                                      <span className={`inline-block px-2 py-0.5 rounded-full text-[10px] font-medium border ${REASON_COLOR[reason] ?? "bg-slate-100 text-slate-800 border-slate-200"}`}>
                                        {reason}
                                      </span>
                                    </td>
                                    <td className={`${tdCls} text-xs text-slate-600 max-w-[200px]`}>
                                      <ul className="list-disc list-inside space-y-0.5">
                                        {suggestions.map((s, si) => <li key={si}>{s}</li>)}
                                      </ul>
                                    </td>
                                  </tr>
                                );
                              })}
                          </tbody>
                        </table>
                      </div>
                    </CardContent>
                  </Card>
                )}

                {/* Empty state if no leakage detected */}
                {negativeMarginOrders.length === 0 && lowMarginOrders.length === 0 && highRevLowMargin.length === 0 && (
                  <Card>
                    <CardContent className="py-16 text-center">
                      <TrendingUp className="h-10 w-10 text-emerald-400 mx-auto mb-3" />
                      <p className="font-semibold text-emerald-700 mb-1">Tidak ada profit leakage terdeteksi</p>
                      <p className="text-sm text-muted-foreground">Semua order dalam periode ini memiliki margin ≥ 10%.</p>
                    </CardContent>
                  </Card>
                )}
              </>
            )}
          </TabsContent>

        </Tabs>
      </div>
    </AppShell>
  );
}
