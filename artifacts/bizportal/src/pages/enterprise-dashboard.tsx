import { useQuery } from "@tanstack/react-query";
import { AppShell } from "@/components/layout/AppShell";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { useState } from "react";
import {
  Package, Truck, Clock, CheckCircle2, XCircle, DollarSign,
  RefreshCw, TrendingUp, TrendingDown, Star, Users,
  BarChart2, Activity, ArrowUpRight, ArrowDownRight,
  FileQuestion, ClipboardCheck, Navigation, Dumbbell, ShoppingCart,
} from "lucide-react";
import { useCompany } from "@/contexts/CompanyContext";
import {
  AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip,
  ResponsiveContainer, PieChart, Pie, Cell, Legend,
} from "recharts";

const idr = (n: number | null | undefined) =>
  n == null ? "—" : new Intl.NumberFormat("id-ID", {
    style: "currency", currency: "IDR", maximumFractionDigits: 0,
  }).format(n);

const idrCompact = (n: number) => {
  if (n >= 1_000_000_000) return `Rp ${(n / 1_000_000_000).toFixed(1)}M`;
  if (n >= 1_000_000) return `Rp ${(n / 1_000_000).toFixed(1)}jt`;
  if (n >= 1_000) return `Rp ${(n / 1_000).toFixed(0)}rb`;
  return idr(n);
};

const STATUS_COLORS: Record<string, string> = {
  "New Order": "#f59e0b",
  "In Progress": "#3b82f6",
  "Completed": "#10b981",
  "Cancelled": "#ef4444",
  "In Transit": "#6366f1",
  "Delivered": "#059669",
};

const PIE_PALETTE = ["#3b82f6", "#10b981", "#f59e0b", "#ef4444", "#6366f1", "#8b5cf6"];

async function fetchEnterprise(companyId?: number) {
  const params = new URLSearchParams();
  if (companyId) params.set("companyId", String(companyId));
  const r = await fetch(`/api/dashboard/enterprise?${params}`, { credentials: "include" });
  if (!r.ok) return null;
  return r.json();
}

async function fetchCrossModule(companyId?: number) {
  const params = new URLSearchParams();
  if (companyId) params.set("companyId", String(companyId));
  const r = await fetch(`/api/dashboard/cross-module?${params}`, { credentials: "include" });
  if (!r.ok) return null;
  return r.json();
}

interface EnterpriseData {
  totalOrders: number;
  pendingRfq: number;
  pendingApproval: number;
  inTransit: number;
  delivered: number;
  cancelled: number;
  revenueThisMonth: number;
  revenueLastMonth: number;
  revenueGrowthPct: number;
  topVendors: { supplierId: number; name: string; score: number; completedOrders: number; onTimeRate: number }[];
  dailyTrend: { day: string; revenue: number; orders: number }[];
  statusBreakdown: { status: string; count: number }[];
  topCustomers: { name: string; orders: number; revenue: number }[];
}

interface CrossModuleData {
  sportCenter: {
    bookingsThisMonth: number;
    bookingsLastMonth: number;
    revenueThisMonth: number;
    revenueLastMonth: number;
    growthPct: number;
    topFacilities: { name: string; bookings: number; revenue: number }[];
  };
  sales: {
    countThisMonth: number;
    countLastMonth: number;
    revenueThisMonth: number;
    revenueLastMonth: number;
    growthPct: number;
  };
}

function GrowthBadge({ pct }: { pct: number }) {
  if (pct > 0) return (
    <span className="flex items-center gap-0.5 text-emerald-600 text-xs font-medium">
      <ArrowUpRight className="h-3 w-3" /> +{pct.toFixed(1)}%
    </span>
  );
  if (pct < 0) return (
    <span className="flex items-center gap-0.5 text-red-500 text-xs font-medium">
      <ArrowDownRight className="h-3 w-3" /> {pct.toFixed(1)}%
    </span>
  );
  return <span className="text-xs text-muted-foreground">±0%</span>;
}

function ModuleRevenueCard({
  icon: Icon,
  title,
  color,
  revenueThis,
  revenueLast,
  growthPct,
  countThis,
  countLabel,
  isLoading,
  children,
}: {
  icon: typeof Dumbbell;
  title: string;
  color: string;
  revenueThis: number;
  revenueLast: number;
  growthPct: number;
  countThis: number;
  countLabel: string;
  isLoading: boolean;
  children?: React.ReactNode;
}) {
  return (
    <Card className={`border-l-4 ${color}`}>
      <CardHeader className="pb-2">
        <CardTitle className="text-sm flex items-center gap-2">
          <Icon className="h-4 w-4" />
          {title}
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        {isLoading ? (
          <div className="space-y-2">
            <div className="h-7 w-28 bg-muted animate-pulse rounded" />
            <div className="h-4 w-20 bg-muted animate-pulse rounded" />
          </div>
        ) : (
          <>
            <div>
              <div className="text-2xl font-bold">{idrCompact(revenueThis)}</div>
              <div className="flex items-center gap-2 mt-0.5">
                <span className="text-xs text-muted-foreground">Bulan ini</span>
                <GrowthBadge pct={growthPct} />
              </div>
            </div>
            <div className="grid grid-cols-2 gap-2 text-xs">
              <div className="rounded-lg bg-muted/50 p-2">
                <div className="text-muted-foreground">{countLabel}</div>
                <div className="font-semibold text-sm">{countThis}</div>
              </div>
              <div className="rounded-lg bg-muted/50 p-2">
                <div className="text-muted-foreground">Bulan lalu</div>
                <div className="font-semibold text-sm">{idrCompact(revenueLast)}</div>
              </div>
            </div>
            {children}
          </>
        )}
      </CardContent>
    </Card>
  );
}

export default function EnterpriseDashboardPage() {
  const { activeCompany } = useCompany();
  const companyId = activeCompany?.id;
  const [refetchCount, setRefetchCount] = useState(0);

  const { data, isLoading, refetch, dataUpdatedAt } = useQuery<EnterpriseData | null>({
    queryKey: ["enterprise-dashboard", companyId, refetchCount],
    queryFn: () => fetchEnterprise(companyId),
    refetchInterval: 120_000,
    staleTime: 60_000,
  });

  const { data: crossData, isLoading: crossLoading } = useQuery<CrossModuleData | null>({
    queryKey: ["cross-module-dashboard", companyId, refetchCount],
    queryFn: () => fetchCrossModule(companyId),
    refetchInterval: 120_000,
    staleTime: 60_000,
  });

  const lastUpdated = dataUpdatedAt
    ? new Date(dataUpdatedAt).toLocaleTimeString("id-ID", { hour: "2-digit", minute: "2-digit" })
    : null;

  const kpis = [
    {
      label: "Total Orders",
      value: data?.totalOrders ?? 0,
      icon: <Package className="h-5 w-5 text-indigo-500" />,
      color: "border-l-indigo-500",
      sub: "Semua waktu",
    },
    {
      label: "Pending RFQ",
      value: data?.pendingRfq ?? 0,
      icon: <FileQuestion className="h-5 w-5 text-amber-500" />,
      color: "border-l-amber-500",
      sub: "Menunggu vendor",
    },
    {
      label: "Pending Approval",
      value: data?.pendingApproval ?? 0,
      icon: <ClipboardCheck className="h-5 w-5 text-orange-500" />,
      color: "border-l-orange-500",
      sub: "Perlu konfirmasi",
    },
    {
      label: "In Transit",
      value: data?.inTransit ?? 0,
      icon: <Navigation className="h-5 w-5 text-blue-500" />,
      color: "border-l-blue-500",
      sub: "Sedang berjalan",
    },
    {
      label: "Delivered",
      value: data?.delivered ?? 0,
      icon: <CheckCircle2 className="h-5 w-5 text-emerald-500" />,
      color: "border-l-emerald-500",
      sub: "Selesai",
    },
    {
      label: "Cancelled",
      value: data?.cancelled ?? 0,
      icon: <XCircle className="h-5 w-5 text-red-400" />,
      color: "border-l-red-400",
      sub: "Dibatalkan",
    },
    {
      label: "Revenue (Bulan Ini)",
      value: idrCompact(data?.revenueThisMonth ?? 0),
      icon: <DollarSign className="h-5 w-5 text-teal-500" />,
      color: "border-l-teal-500",
      sub: (
        <GrowthBadge pct={data?.revenueGrowthPct ?? 0} />
      ),
    },
  ];

  const trendData = (data?.dailyTrend ?? []).map((d) => ({
    day: d.day.slice(5),
    revenue: d.revenue,
    orders: d.orders,
  }));

  const pieData = (data?.statusBreakdown ?? []).map((s) => ({
    name: s.status,
    value: s.count,
  }));

  const sc = crossData?.sportCenter;
  const sales = crossData?.sales;

  // Combined revenue for the summary bar
  const totalRevThis = (data?.revenueThisMonth ?? 0) + (sc?.revenueThisMonth ?? 0) + (sales?.revenueThisMonth ?? 0);
  const totalRevLast = (data?.revenueLastMonth ?? 0) + (sc?.revenueLastMonth ?? 0) + (sales?.revenueLastMonth ?? 0);
  const totalGrowth = totalRevLast > 0
    ? ((totalRevThis - totalRevLast) / totalRevLast) * 100
    : totalRevThis > 0 ? 100 : 0;

  return (
    <AppShell>
      <div className="p-4 md:p-6 space-y-6">

        {/* Header */}
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
          <div>
            <h1 className="text-2xl font-bold flex items-center gap-2">
              <BarChart2 className="h-6 w-6 text-primary" />
              Enterprise Dashboard
            </h1>
            <p className="text-muted-foreground text-sm mt-0.5">
              Ringkasan operasional seluruh divisi & revenue
              {lastUpdated && (
                <span className="ml-2 text-xs text-muted-foreground/60">• Update {lastUpdated}</span>
              )}
            </p>
          </div>
          <Button variant="outline" size="sm" onClick={() => { setRefetchCount((c) => c + 1); refetch(); }}>
            <RefreshCw className={`h-4 w-4 mr-2 ${isLoading ? "animate-spin" : ""}`} />
            Refresh
          </Button>
        </div>

        {/* ── LOGISTIK KPI Cards ─────────────────────────────────────── */}
        <div>
          <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-2 flex items-center gap-1.5">
            <Truck className="h-3.5 w-3.5" /> Logistik
          </p>
          <div className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-7 gap-3">
            {kpis.map((k) => (
              <Card key={k.label} className={`border-l-4 ${k.color}`}>
                <CardContent className="p-4">
                  <div className="flex items-center justify-between mb-2">
                    <span className="text-xs text-muted-foreground leading-tight">{k.label}</span>
                    {k.icon}
                  </div>
                  {isLoading ? (
                    <div className="h-7 w-16 bg-muted animate-pulse rounded" />
                  ) : (
                    <div className="text-2xl font-bold">{k.value}</div>
                  )}
                  <div className="text-xs text-muted-foreground mt-0.5">{k.sub}</div>
                </CardContent>
              </Card>
            ))}
          </div>
        </div>

        {/* ── MODUL LAIN: Sport Centre + Sales ───────────────────────── */}
        <div>
          <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-2 flex items-center gap-1.5">
            <Activity className="h-3.5 w-3.5" /> Modul Lain (Bulan Ini)
          </p>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">

            {/* Sport Centre */}
            <ModuleRevenueCard
              icon={Dumbbell}
              title="Sport Centre"
              color="border-l-violet-500"
              revenueThis={sc?.revenueThisMonth ?? 0}
              revenueLast={sc?.revenueLastMonth ?? 0}
              growthPct={sc?.growthPct ?? 0}
              countThis={sc?.bookingsThisMonth ?? 0}
              countLabel="Booking bulan ini"
              isLoading={crossLoading}
            >
              {(sc?.topFacilities ?? []).length > 0 && (
                <div className="space-y-1 pt-1 border-t border-muted/50">
                  <p className="text-xs text-muted-foreground font-medium">Top Fasilitas</p>
                  {(sc?.topFacilities ?? []).map((f) => (
                    <div key={f.name} className="flex items-center justify-between text-xs">
                      <span className="truncate max-w-[60%] text-muted-foreground">{f.name}</span>
                      <span className="font-medium">{f.bookings}× · {idrCompact(f.revenue)}</span>
                    </div>
                  ))}
                </div>
              )}
            </ModuleRevenueCard>

            {/* Sales / Penjualan */}
            <ModuleRevenueCard
              icon={ShoppingCart}
              title="Penjualan (Sales)"
              color="border-l-sky-500"
              revenueThis={sales?.revenueThisMonth ?? 0}
              revenueLast={sales?.revenueLastMonth ?? 0}
              growthPct={sales?.growthPct ?? 0}
              countThis={sales?.countThisMonth ?? 0}
              countLabel="Dokumen bulan ini"
              isLoading={crossLoading}
            />
          </div>
        </div>

        {/* ── CHARTS ROW ─────────────────────────────────────────────── */}
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">

          {/* Revenue + Orders Trend */}
          <Card className="lg:col-span-2">
            <CardHeader className="pb-3">
              <CardTitle className="text-base flex items-center gap-2">
                <TrendingUp className="h-4 w-4 text-primary" />
                Tren Revenue Logistik 30 Hari
              </CardTitle>
              <CardDescription>Revenue dan jumlah order logistik per hari</CardDescription>
            </CardHeader>
            <CardContent>
              {isLoading ? (
                <div className="h-52 bg-muted/30 animate-pulse rounded-lg" />
              ) : trendData.length === 0 ? (
                <div className="h-52 flex items-center justify-center text-muted-foreground text-sm">
                  Belum ada data trend
                </div>
              ) : (
                <ResponsiveContainer width="100%" height={220}>
                  <AreaChart data={trendData} margin={{ top: 4, right: 4, left: 0, bottom: 0 }}>
                    <defs>
                      <linearGradient id="revGrad" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="5%" stopColor="#3b82f6" stopOpacity={0.25} />
                        <stop offset="95%" stopColor="#3b82f6" stopOpacity={0} />
                      </linearGradient>
                    </defs>
                    <CartesianGrid strokeDasharray="3 3" className="stroke-muted" />
                    <XAxis dataKey="day" tick={{ fontSize: 10 }} tickLine={false} />
                    <YAxis
                      yAxisId="rev"
                      tickFormatter={(v) => idrCompact(v)}
                      tick={{ fontSize: 9 }}
                      tickLine={false}
                      width={60}
                    />
                    <YAxis yAxisId="ord" orientation="right" tick={{ fontSize: 9 }} tickLine={false} width={25} />
                    <Tooltip
                      formatter={(value: number, name: string) =>
                        name === "Revenue" ? [idr(value), "Revenue"] : [value, "Orders"]
                      }
                    />
                    <Area
                      yAxisId="rev"
                      type="monotone"
                      dataKey="revenue"
                      name="Revenue"
                      stroke="#3b82f6"
                      fill="url(#revGrad)"
                      strokeWidth={2}
                    />
                    <Area
                      yAxisId="ord"
                      type="monotone"
                      dataKey="orders"
                      name="Orders"
                      stroke="#10b981"
                      fill="none"
                      strokeWidth={2}
                      strokeDasharray="4 2"
                    />
                  </AreaChart>
                </ResponsiveContainer>
              )}
            </CardContent>
          </Card>

          {/* Status Breakdown Pie */}
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-base flex items-center gap-2">
                <Activity className="h-4 w-4 text-primary" />
                Status Order Logistik
              </CardTitle>
              <CardDescription>Distribusi status saat ini</CardDescription>
            </CardHeader>
            <CardContent>
              {isLoading ? (
                <div className="h-52 bg-muted/30 animate-pulse rounded-lg" />
              ) : pieData.length === 0 ? (
                <div className="h-52 flex items-center justify-center text-muted-foreground text-sm">
                  Belum ada data
                </div>
              ) : (
                <ResponsiveContainer width="100%" height={220}>
                  <PieChart>
                    <Pie
                      data={pieData}
                      cx="50%"
                      cy="45%"
                      outerRadius={70}
                      dataKey="value"
                      nameKey="name"
                      label={({ name, percent }) => `${(percent * 100).toFixed(0)}%`}
                      labelLine={false}
                    >
                      {pieData.map((entry, i) => (
                        <Cell
                          key={entry.name}
                          fill={STATUS_COLORS[entry.name] ?? PIE_PALETTE[i % PIE_PALETTE.length]}
                        />
                      ))}
                    </Pie>
                    <Legend
                      formatter={(value) => <span className="text-xs">{value}</span>}
                      iconSize={8}
                    />
                  </PieChart>
                </ResponsiveContainer>
              )}
            </CardContent>
          </Card>
        </div>

        {/* ── TABLES ROW ─────────────────────────────────────────────── */}
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">

          {/* Top Vendors */}
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-base flex items-center gap-2">
                <Star className="h-4 w-4 text-yellow-500" />
                Top Vendor Performance
              </CardTitle>
              <CardDescription>5 vendor terbaik berdasarkan score</CardDescription>
            </CardHeader>
            <CardContent>
              {isLoading ? (
                <div className="space-y-3">
                  {[1,2,3,4,5].map((i) => (
                    <div key={i} className="h-10 bg-muted/30 animate-pulse rounded" />
                  ))}
                </div>
              ) : (data?.topVendors ?? []).length === 0 ? (
                <p className="text-center text-muted-foreground py-8 text-sm">
                  Belum ada data performa vendor
                </p>
              ) : (
                <div className="space-y-2">
                  {(data?.topVendors ?? []).map((v, i) => (
                    <div key={v.supplierId} className="flex items-center gap-3 p-2 rounded-lg hover:bg-muted/50 transition-colors">
                      <span className="text-muted-foreground text-xs w-4 shrink-0">{i + 1}</span>
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-medium truncate">{v.name || `Supplier #${v.supplierId}`}</p>
                        <p className="text-xs text-muted-foreground">
                          {v.completedOrders} selesai · {Number(v.onTimeRate).toFixed(0)}% on-time
                        </p>
                      </div>
                      <div className="text-right">
                        <Badge
                          variant="secondary"
                          className={
                            v.score >= 90 ? "bg-emerald-100 text-emerald-800" :
                            v.score >= 70 ? "bg-blue-100 text-blue-800" :
                            "bg-orange-100 text-orange-800"
                          }
                        >
                          {Number(v.score).toFixed(0)}
                        </Badge>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>

          {/* Top Customers */}
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-base flex items-center gap-2">
                <Users className="h-4 w-4 text-indigo-500" />
                Top Customer Logistik (90 Hari)
              </CardTitle>
              <CardDescription>Customer dengan order terbanyak</CardDescription>
            </CardHeader>
            <CardContent>
              {isLoading ? (
                <div className="space-y-3">
                  {[1,2,3,4,5].map((i) => (
                    <div key={i} className="h-10 bg-muted/30 animate-pulse rounded" />
                  ))}
                </div>
              ) : (data?.topCustomers ?? []).length === 0 ? (
                <p className="text-center text-muted-foreground py-8 text-sm">
                  Belum ada data customer
                </p>
              ) : (
                <div className="space-y-2">
                  {(data?.topCustomers ?? []).slice(0, 8).map((c, i) => (
                    <div key={i} className="flex items-center gap-3 p-2 rounded-lg hover:bg-muted/50 transition-colors">
                      <span className="text-muted-foreground text-xs w-4 shrink-0">{i + 1}</span>
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-medium truncate">{c.name || "—"}</p>
                        <p className="text-xs text-muted-foreground">{c.orders} order</p>
                      </div>
                      <div className="text-right text-sm font-semibold text-emerald-700">
                        {idrCompact(c.revenue)}
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>
        </div>

        {/* ── TOTAL REVENUE SEMUA DIVISI ─────────────────────────────── */}
        <Card className="border-primary/20 bg-primary/5">
          <CardHeader className="pb-2">
            <CardTitle className="text-sm flex items-center gap-2">
              <DollarSign className="h-4 w-4 text-primary" />
              Total Revenue Semua Divisi — Bulan Ini
            </CardTitle>
          </CardHeader>
          <CardContent className="p-4 pt-0">
            <div className="grid grid-cols-1 sm:grid-cols-4 gap-4 text-center">
              <div>
                <p className="text-xs text-muted-foreground mb-1">Logistik</p>
                <p className="text-xl font-bold text-blue-600">
                  {isLoading ? "—" : idrCompact(data?.revenueThisMonth ?? 0)}
                </p>
              </div>
              <div>
                <p className="text-xs text-muted-foreground mb-1">Sport Centre</p>
                <p className="text-xl font-bold text-violet-600">
                  {crossLoading ? "—" : idrCompact(sc?.revenueThisMonth ?? 0)}
                </p>
              </div>
              <div>
                <p className="text-xs text-muted-foreground mb-1">Penjualan</p>
                <p className="text-xl font-bold text-sky-600">
                  {crossLoading ? "—" : idrCompact(sales?.revenueThisMonth ?? 0)}
                </p>
              </div>
              <div className="border-l border-primary/20 pl-4">
                <p className="text-xs text-muted-foreground mb-1">Total Gabungan</p>
                <p className="text-2xl font-bold text-primary">
                  {isLoading || crossLoading ? "—" : idrCompact(totalRevThis)}
                </p>
                <div className="flex items-center justify-center mt-0.5">
                  {!isLoading && !crossLoading && (
                    <GrowthBadge pct={Number(totalGrowth.toFixed(1))} />
                  )}
                </div>
              </div>
            </div>
          </CardContent>
        </Card>

      </div>
    </AppShell>
  );
}
