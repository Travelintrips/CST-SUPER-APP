import { useState, useCallback } from "react";
import { useQuery } from "@tanstack/react-query";
import { AppShell } from "@/components/layout/AppShell";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { useCompany } from "@/contexts/CompanyContext";
import {
  TrendingUp, TrendingDown, Minus,
  ShoppingCart, FileText, DollarSign, BarChart2,
  AlertTriangle, Clock, Users, Truck, Target,
  CheckCircle2, RefreshCw, Crown, ArrowRight,
  CreditCard, Package,
} from "lucide-react";
import {
  AreaChart, Area, BarChart, Bar, LineChart, Line,
  XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Legend,
} from "recharts";
import { Link } from "wouter";

const idr = (n: number) =>
  new Intl.NumberFormat("id-ID", { style: "currency", currency: "IDR", maximumFractionDigits: 0 }).format(n);

const idrCompact = (n: number) => {
  if (n >= 1_000_000_000) return `${(n / 1_000_000_000).toFixed(1)}M`;
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(0)}Jt`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(0)}rb`;
  return String(n);
};

const monthLabel = (m: string) => {
  const [, mo] = m.split("-");
  const months = ["Jan","Feb","Mar","Apr","Mei","Jun","Jul","Agt","Sep","Okt","Nov","Des"];
  return months[Number(mo) - 1] ?? m;
};

interface CeoDashData {
  ordersCreatedToday: number;
  rfqSentToday: number;
  revenueToday: number;
  grossMarginTodayPct: number;
  openExceptions: number;
  slaViolations: number;
  orderVolumeThisMonth: number;
  orderVolumePrevMonth: number;
  orderVolumeChangePct: number | null;
  conversionRatePct: number;
  paymentCollection: number;
  topCustomers: { name: string; orderCount: number; revenue: number }[];
  topVendors: { vendorId: number; name: string; orderCount: number; successRate: number }[];
  revenueTrend: { month: string; revenue: number; profit: number }[];
  rfqResponseTrend: { month: string; avgMin: number; totalRfq: number }[];
  vendorRanking: { vendorId: number; name: string; score: number; ontimePct: number; totalOrders: number; avgResponseMin: number }[];
  slaComplianceTrend: { month: string; total: number; onTime: number; compliancePct: number }[];
}

function TrendBadge({ diff }: { diff: number | null }) {
  if (diff === null) return <span className="text-xs text-muted-foreground">—</span>;
  if (diff > 0) return (
    <span className="inline-flex items-center gap-0.5 text-xs text-emerald-600 font-medium">
      <TrendingUp className="h-3 w-3" />+{diff.toFixed(1)}%
    </span>
  );
  if (diff < 0) return (
    <span className="inline-flex items-center gap-0.5 text-xs text-red-500 font-medium">
      <TrendingDown className="h-3 w-3" />{diff.toFixed(1)}%
    </span>
  );
  return <span className="inline-flex items-center gap-0.5 text-xs text-muted-foreground"><Minus className="h-3 w-3" />0%</span>;
}

function StatCard({
  label, value, sub, icon, color, href, alert,
}: {
  label: string; value: string | number; sub?: React.ReactNode; icon: React.ReactNode;
  color: string; href?: string; alert?: boolean;
}) {
  const inner = (
    <Card className={`h-full border-l-4 ${color} ${alert ? "border-red-400 bg-red-50/40" : ""} hover:shadow-md transition-all group`}>
      <CardContent className="p-4">
        <div className="flex items-center justify-between mb-2">
          <span className="text-xs font-medium text-muted-foreground">{label}</span>
          <div className={`p-1.5 rounded-lg ${alert ? "bg-red-100" : "bg-slate-100"}`}>{icon}</div>
        </div>
        <div className={`text-2xl font-bold ${alert ? "text-red-600" : ""}`}>{value}</div>
        {sub && <div className="mt-1 flex items-center gap-1">{sub}</div>}
        {href && (
          <div className="mt-2 flex items-center gap-1 text-xs text-primary opacity-0 group-hover:opacity-100 transition-opacity">
            Lihat detail <ArrowRight className="h-3 w-3" />
          </div>
        )}
      </CardContent>
    </Card>
  );
  if (href) return <Link href={href} className="block focus:outline-none">{inner}</Link>;
  return inner;
}

export default function CeoDashboardPage() {
  const { companyQueryParam } = useCompany();
  const [lastFetched, setLastFetched] = useState<Date | null>(null);

  const { data, isLoading, isFetching, refetch } = useQuery<CeoDashData>({
    queryKey: ["ceo-dashboard", companyQueryParam],
    queryFn: async () => {
      const res = await fetch(`/api/dashboard/ceo?${companyQueryParam}`, { credentials: "include" });
      if (!res.ok) throw new Error("Gagal memuat data");
      const d = await res.json() as CeoDashData;
      setLastFetched(new Date());
      return d;
    },
    refetchInterval: 120_000,
  });

  const handleRefresh = useCallback(() => void refetch(), [refetch]);

  const sectionLabel = "text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-3";
  const divider = "border-t border-border my-6";

  return (
    <AppShell>
      <div className="p-4 md:p-6 max-w-[1600px] mx-auto space-y-6">
        {/* ── Header ── */}
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
          <div>
            <div className="flex items-center gap-2">
              <Crown className="h-6 w-6 text-amber-500" />
              <h1 className="text-2xl font-bold tracking-tight">CEO / Director Dashboard</h1>
            </div>
            <p className="text-sm text-muted-foreground mt-1">Ringkasan eksekutif performa bisnis hari ini &amp; bulan ini</p>
          </div>
          <div className="flex flex-col items-end gap-1">
            <Button variant="outline" size="sm" onClick={handleRefresh} disabled={isFetching} className="gap-1.5 h-8">
              <RefreshCw className={`h-3.5 w-3.5 ${isFetching ? "animate-spin" : ""}`} />
              {isFetching ? "Memuat…" : "Refresh"}
            </Button>
            {lastFetched && (
              <span className="text-[11px] text-muted-foreground">
                Update: {lastFetched.toLocaleTimeString("id-ID", { hour: "2-digit", minute: "2-digit", second: "2-digit" })}
              </span>
            )}
          </div>
        </div>

        {/* ═══ SECTION: TODAY ═══ */}
        <div>
          <div className={sectionLabel}>📅 Hari Ini</div>
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3">
            {/* Orders Created */}
            <StatCard
              label="Order Dibuat"
              value={isLoading ? "—" : (data?.ordersCreatedToday ?? 0)}
              icon={<ShoppingCart className="h-3.5 w-3.5 text-blue-600" />}
              color="border-l-blue-500"
              sub={<span className="text-[10px] text-muted-foreground">order baru hari ini</span>}
              href="/logistics/portal-orders"
            />
            {/* RFQ Sent */}
            <StatCard
              label="RFQ Dikirim"
              value={isLoading ? "—" : (data?.rfqSentToday ?? 0)}
              icon={<FileText className="h-3.5 w-3.5 text-indigo-600" />}
              color="border-l-indigo-500"
              sub={<span className="text-[10px] text-muted-foreground">permintaan penawaran</span>}
              href="/logistics/rfq"
            />
            {/* Revenue */}
            <StatCard
              label="Revenue"
              value={isLoading ? "—" : idrCompact(data?.revenueToday ?? 0)}
              icon={<DollarSign className="h-3.5 w-3.5 text-emerald-600" />}
              color="border-l-emerald-500"
              sub={<span className="text-[10px] text-muted-foreground">{isLoading ? "" : idr(data?.revenueToday ?? 0)}</span>}
              href="/sales/documents"
            />
            {/* Gross Margin */}
            <StatCard
              label="Gross Margin"
              value={isLoading ? "—" : `${data?.grossMarginTodayPct ?? 0}%`}
              icon={<BarChart2 className="h-3.5 w-3.5 text-teal-600" />}
              color="border-l-teal-500"
              sub={
                <span className={`text-[10px] font-medium ${(data?.grossMarginTodayPct ?? 0) >= 20 ? "text-emerald-600" : "text-amber-600"}`}>
                  {(data?.grossMarginTodayPct ?? 0) >= 20 ? "Sehat" : "Perlu perhatian"}
                </span>
              }
            />
            {/* Open Exceptions */}
            <StatCard
              label="Exception Terbuka"
              value={isLoading ? "—" : (data?.openExceptions ?? 0)}
              icon={<AlertTriangle className="h-3.5 w-3.5 text-orange-600" />}
              color="border-l-orange-500"
              alert={(data?.openExceptions ?? 0) > 0}
              sub={<span className="text-[10px] text-muted-foreground">butuh penanganan</span>}
              href="/exceptions"
            />
            {/* SLA Violations */}
            <StatCard
              label="SLA Violation"
              value={isLoading ? "—" : (data?.slaViolations ?? 0)}
              icon={<Clock className="h-3.5 w-3.5 text-red-600" />}
              color="border-l-red-500"
              alert={(data?.slaViolations ?? 0) > 0}
              sub={<span className="text-[10px] text-muted-foreground">order &gt;7 hari aktif</span>}
              href="/logistics/portal-orders"
            />
          </div>
        </div>

        <div className={divider} />

        {/* ═══ SECTION: THIS MONTH ═══ */}
        <div>
          <div className={sectionLabel}>📆 Bulan Ini</div>
          <div className="grid grid-cols-1 lg:grid-cols-5 gap-4">
            {/* KPI Row: 3 compact cards */}
            <div className="lg:col-span-3 grid grid-cols-3 gap-3 content-start">
              {/* Order Volume */}
              <Card className="border-l-4 border-l-violet-500 hover:shadow-md transition-all">
                <CardContent className="p-4">
                  <div className="flex items-center justify-between mb-1">
                    <span className="text-xs text-muted-foreground">Volume Order</span>
                    <Package className="h-3.5 w-3.5 text-violet-600" />
                  </div>
                  {isLoading ? <Skeleton className="h-7 w-16 mb-1" /> : (
                    <div className="text-2xl font-bold">{data?.orderVolumeThisMonth ?? 0}</div>
                  )}
                  <div className="flex items-center gap-1 mt-1">
                    <TrendBadge diff={data?.orderVolumeChangePct ?? null} />
                    <span className="text-[10px] text-muted-foreground">vs bln lalu</span>
                  </div>
                </CardContent>
              </Card>
              {/* Conversion Rate */}
              <Card className="border-l-4 border-l-cyan-500 hover:shadow-md transition-all">
                <CardContent className="p-4">
                  <div className="flex items-center justify-between mb-1">
                    <span className="text-xs text-muted-foreground">Conversion Rate</span>
                    <Target className="h-3.5 w-3.5 text-cyan-600" />
                  </div>
                  {isLoading ? <Skeleton className="h-7 w-16 mb-1" /> : (
                    <div className="text-2xl font-bold">{data?.conversionRatePct ?? 0}%</div>
                  )}
                  <div className="mt-1">
                    <span className="text-[10px] text-muted-foreground">customer confirmed</span>
                  </div>
                </CardContent>
              </Card>
              {/* Payment Collection */}
              <Card className="border-l-4 border-l-green-500 hover:shadow-md transition-all">
                <CardContent className="p-4">
                  <div className="flex items-center justify-between mb-1">
                    <span className="text-xs text-muted-foreground">Payment Collection</span>
                    <CreditCard className="h-3.5 w-3.5 text-green-600" />
                  </div>
                  {isLoading ? <Skeleton className="h-7 w-24 mb-1" /> : (
                    <div className="text-2xl font-bold truncate">{idrCompact(data?.paymentCollection ?? 0)}</div>
                  )}
                  <div className="mt-1">
                    <span className="text-[10px] text-muted-foreground">{isLoading ? "" : idr(data?.paymentCollection ?? 0)}</span>
                  </div>
                </CardContent>
              </Card>

              {/* Top Customers Table */}
              <div className="col-span-3">
                <Card>
                  <CardHeader className="pb-2 pt-4 px-4">
                    <CardTitle className="text-sm font-semibold flex items-center gap-1.5">
                      <Users className="h-4 w-4 text-blue-500" /> Top Pelanggan Bulan Ini
                    </CardTitle>
                  </CardHeader>
                  <CardContent className="px-4 pb-4">
                    {isLoading ? (
                      <div className="space-y-2">{[...Array(5)].map((_, i) => <Skeleton key={i} className="h-8 w-full" />)}</div>
                    ) : (data?.topCustomers ?? []).length === 0 ? (
                      <p className="text-sm text-muted-foreground text-center py-4">Belum ada data</p>
                    ) : (
                      <div className="space-y-1.5">
                        {(data?.topCustomers ?? []).slice(0, 7).map((c, i) => (
                          <div key={c.name} className="flex items-center gap-2 text-sm">
                            <span className="w-5 text-center text-xs font-bold text-muted-foreground">{i + 1}</span>
                            <span className="flex-1 truncate font-medium" title={c.name}>{c.name || "—"}</span>
                            <Badge variant="outline" className="text-[10px] gap-0.5 shrink-0">
                              <ShoppingCart className="h-2.5 w-2.5" />{c.orderCount}
                            </Badge>
                            <span className="text-xs text-emerald-700 font-semibold shrink-0 w-20 text-right">
                              {idrCompact(c.revenue)}
                            </span>
                          </div>
                        ))}
                      </div>
                    )}
                  </CardContent>
                </Card>
              </div>
            </div>

            {/* Top Vendors Table */}
            <div className="lg:col-span-2">
              <Card className="h-full">
                <CardHeader className="pb-2 pt-4 px-4">
                  <CardTitle className="text-sm font-semibold flex items-center gap-1.5">
                    <Truck className="h-4 w-4 text-indigo-500" /> Top Vendor Bulan Ini
                  </CardTitle>
                </CardHeader>
                <CardContent className="px-4 pb-4">
                  {isLoading ? (
                    <div className="space-y-2">{[...Array(7)].map((_, i) => <Skeleton key={i} className="h-9 w-full" />)}</div>
                  ) : (data?.topVendors ?? []).length === 0 ? (
                    <p className="text-sm text-muted-foreground text-center py-4">Belum ada data</p>
                  ) : (
                    <div className="space-y-2">
                      {(data?.topVendors ?? []).slice(0, 8).map((v, i) => (
                        <div key={v.vendorId} className="flex items-center gap-2">
                          <span className="w-5 text-center text-xs font-bold text-muted-foreground">{i + 1}</span>
                          <div className="flex-1 min-w-0">
                            <div className="text-sm font-medium truncate" title={v.name}>{v.name}</div>
                            <div className="flex items-center gap-1 mt-0.5">
                              <div className="h-1 rounded-full bg-slate-100 flex-1">
                                <div
                                  className={`h-1 rounded-full ${v.successRate >= 80 ? "bg-emerald-500" : v.successRate >= 50 ? "bg-amber-400" : "bg-red-400"}`}
                                  style={{ width: `${v.successRate}%` }}
                                />
                              </div>
                              <span className="text-[10px] text-muted-foreground shrink-0">{v.successRate}%</span>
                            </div>
                          </div>
                          <Badge variant="secondary" className="text-[10px] shrink-0">{v.orderCount} ord</Badge>
                        </div>
                      ))}
                    </div>
                  )}
                </CardContent>
              </Card>
            </div>
          </div>
        </div>

        <div className={divider} />

        {/* ═══ WIDGETS ═══ */}
        <div>
          <div className={sectionLabel}>📊 Widgets Analitik (6 Bulan Terakhir)</div>
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
            {/* Revenue Trend */}
            <Card>
              <CardHeader className="pb-2 pt-4 px-4">
                <CardTitle className="text-sm font-semibold flex items-center gap-1.5">
                  <TrendingUp className="h-4 w-4 text-emerald-500" /> Revenue Trend
                </CardTitle>
              </CardHeader>
              <CardContent className="px-2 pb-4">
                {isLoading ? <Skeleton className="h-48 w-full" /> : (
                  <ResponsiveContainer width="100%" height={220}>
                    <AreaChart data={(data?.revenueTrend ?? []).map(d => ({ ...d, monthLabel: monthLabel(d.month) }))} margin={{ top: 5, right: 10, left: 0, bottom: 0 }}>
                      <defs>
                        <linearGradient id="gradRev" x1="0" y1="0" x2="0" y2="1">
                          <stop offset="5%" stopColor="#10b981" stopOpacity={0.25} />
                          <stop offset="95%" stopColor="#10b981" stopOpacity={0} />
                        </linearGradient>
                        <linearGradient id="gradProfit" x1="0" y1="0" x2="0" y2="1">
                          <stop offset="5%" stopColor="#6366f1" stopOpacity={0.2} />
                          <stop offset="95%" stopColor="#6366f1" stopOpacity={0} />
                        </linearGradient>
                      </defs>
                      <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
                      <XAxis dataKey="monthLabel" tick={{ fontSize: 11 }} />
                      <YAxis tickFormatter={v => idrCompact(v)} tick={{ fontSize: 10 }} width={50} />
                      <Tooltip formatter={(v: number) => idr(v)} labelFormatter={l => `Bulan: ${l}`} />
                      <Legend iconSize={10} wrapperStyle={{ fontSize: 11 }} />
                      <Area type="monotone" dataKey="revenue" name="Revenue" stroke="#10b981" strokeWidth={2} fill="url(#gradRev)" dot={{ r: 3 }} />
                      <Area type="monotone" dataKey="profit" name="Profit" stroke="#6366f1" strokeWidth={2} fill="url(#gradProfit)" dot={{ r: 3 }} />
                    </AreaChart>
                  </ResponsiveContainer>
                )}
              </CardContent>
            </Card>

            {/* RFQ Response Time */}
            <Card>
              <CardHeader className="pb-2 pt-4 px-4">
                <CardTitle className="text-sm font-semibold flex items-center gap-1.5">
                  <Clock className="h-4 w-4 text-orange-500" /> RFQ Response Time (Menit)
                </CardTitle>
              </CardHeader>
              <CardContent className="px-2 pb-4">
                {isLoading ? <Skeleton className="h-48 w-full" /> : (data?.rfqResponseTrend ?? []).length === 0 ? (
                  <div className="h-[220px] flex items-center justify-center text-sm text-muted-foreground">Belum ada data RFQ</div>
                ) : (
                  <ResponsiveContainer width="100%" height={220}>
                    <BarChart data={(data?.rfqResponseTrend ?? []).map(d => ({ ...d, monthLabel: monthLabel(d.month) }))} margin={{ top: 5, right: 10, left: 0, bottom: 0 }}>
                      <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
                      <XAxis dataKey="monthLabel" tick={{ fontSize: 11 }} />
                      <YAxis yAxisId="left" tick={{ fontSize: 10 }} width={40} />
                      <YAxis yAxisId="right" orientation="right" tick={{ fontSize: 10 }} width={35} />
                      <Tooltip />
                      <Legend iconSize={10} wrapperStyle={{ fontSize: 11 }} />
                      <Bar yAxisId="left" dataKey="avgMin" name="Avg Menit" fill="#f97316" radius={[3, 3, 0, 0]} />
                      <Line yAxisId="right" type="monotone" dataKey="totalRfq" name="Total RFQ" stroke="#6366f1" strokeWidth={2} dot={{ r: 3 }} />
                    </BarChart>
                  </ResponsiveContainer>
                )}
              </CardContent>
            </Card>

            {/* Vendor Ranking */}
            <Card>
              <CardHeader className="pb-2 pt-4 px-4">
                <CardTitle className="text-sm font-semibold flex items-center gap-1.5">
                  <CheckCircle2 className="h-4 w-4 text-blue-500" /> Vendor Ranking (Top 5)
                </CardTitle>
              </CardHeader>
              <CardContent className="px-4 pb-4">
                {isLoading ? (
                  <div className="space-y-3">{[...Array(5)].map((_, i) => <Skeleton key={i} className="h-12 w-full" />)}</div>
                ) : (data?.vendorRanking ?? []).length === 0 ? (
                  <p className="text-sm text-muted-foreground text-center py-8">Belum ada data vendor</p>
                ) : (
                  <div className="space-y-3">
                    {(data?.vendorRanking ?? []).map((v, i) => {
                      const score = v.score;
                      const tier = score >= 80 ? { label: "Top", color: "bg-amber-100 text-amber-800 border-amber-200" }
                        : score >= 65 ? { label: "Good", color: "bg-blue-100 text-blue-800 border-blue-200" }
                        : score >= 50 ? { label: "Moderate", color: "bg-slate-100 text-slate-700 border-slate-200" }
                        : { label: "New", color: "bg-gray-100 text-gray-600 border-gray-200" };
                      return (
                        <div key={v.vendorId} className="flex items-center gap-3">
                          <div className={`w-7 h-7 rounded-full flex items-center justify-center text-xs font-bold shrink-0 ${i === 0 ? "bg-amber-400 text-white" : i === 1 ? "bg-slate-300 text-slate-800" : i === 2 ? "bg-orange-300 text-white" : "bg-slate-100 text-slate-600"}`}>
                            {i + 1}
                          </div>
                          <div className="flex-1 min-w-0">
                            <div className="flex items-center gap-2">
                              <span className="text-sm font-medium truncate">{v.name}</span>
                              <Badge variant="outline" className={`text-[10px] shrink-0 ${tier.color}`}>{tier.label}</Badge>
                            </div>
                            <div className="flex items-center gap-2 mt-1">
                              <div className="h-1.5 flex-1 rounded-full bg-slate-100">
                                <div className={`h-1.5 rounded-full ${score >= 80 ? "bg-emerald-500" : score >= 65 ? "bg-blue-400" : score >= 50 ? "bg-amber-400" : "bg-slate-300"}`} style={{ width: `${score}%` }} />
                              </div>
                              <span className="text-[10px] font-semibold text-muted-foreground w-8 text-right shrink-0">{score}</span>
                            </div>
                          </div>
                          <div className="text-right text-xs text-muted-foreground shrink-0">
                            <div>{v.ontimePct}% on-time</div>
                            <div>{v.totalOrders} ord</div>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                )}
              </CardContent>
            </Card>

            {/* SLA Compliance */}
            <Card>
              <CardHeader className="pb-2 pt-4 px-4">
                <CardTitle className="text-sm font-semibold flex items-center gap-1.5">
                  <Target className="h-4 w-4 text-violet-500" /> SLA Compliance (%)
                </CardTitle>
              </CardHeader>
              <CardContent className="px-2 pb-4">
                {isLoading ? <Skeleton className="h-48 w-full" /> : (data?.slaComplianceTrend ?? []).length === 0 ? (
                  <div className="h-[220px] flex items-center justify-center text-sm text-muted-foreground">Belum ada data SLA</div>
                ) : (
                  <ResponsiveContainer width="100%" height={220}>
                    <AreaChart data={(data?.slaComplianceTrend ?? []).map(d => ({ ...d, monthLabel: monthLabel(d.month) }))} margin={{ top: 5, right: 10, left: 0, bottom: 0 }}>
                      <defs>
                        <linearGradient id="gradSla" x1="0" y1="0" x2="0" y2="1">
                          <stop offset="5%" stopColor="#8b5cf6" stopOpacity={0.25} />
                          <stop offset="95%" stopColor="#8b5cf6" stopOpacity={0} />
                        </linearGradient>
                      </defs>
                      <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
                      <XAxis dataKey="monthLabel" tick={{ fontSize: 11 }} />
                      <YAxis domain={[0, 100]} tickFormatter={v => `${v}%`} tick={{ fontSize: 10 }} width={40} />
                      <Tooltip formatter={(v: number) => `${v}%`} />
                      <Legend iconSize={10} wrapperStyle={{ fontSize: 11 }} />
                      <Area type="monotone" dataKey="compliancePct" name="SLA Compliance" stroke="#8b5cf6" strokeWidth={2} fill="url(#gradSla)" dot={{ r: 3 }} />
                    </AreaChart>
                  </ResponsiveContainer>
                )}
              </CardContent>
            </Card>
          </div>
        </div>
      </div>
    </AppShell>
  );
}
