import { useQuery } from "@tanstack/react-query";
import { AppShell } from "@/components/layout/AppShell";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useState } from "react";
import {
  TrendingUp, TrendingDown, Package, Truck, Users, DollarSign,
  Clock, CheckCircle, XCircle, BarChart2, Star, RefreshCw,
  Target, AlertTriangle, Activity,
} from "lucide-react";
import { useCompany } from "@/contexts/CompanyContext";

const idr = (n: number | null | undefined) =>
  n == null ? "—" : new Intl.NumberFormat("id-ID", { style: "currency", currency: "IDR", maximumFractionDigits: 0 }).format(n);

const pct = (n: number | null | undefined) =>
  n == null ? "—" : `${Number(n).toFixed(1)}%`;

async function fetchAnalytics(period: string, companyId?: number) {
  const params = new URLSearchParams({ period });
  if (companyId) params.set("companyId", String(companyId));
  const r = await fetch(`/api/dashboard/analytics?${params}`);
  if (!r.ok) return null;
  return r.json();
}

async function fetchVendorPerformance(companyId?: number) {
  const params = new URLSearchParams();
  if (companyId) params.set("companyId", String(companyId));
  const r = await fetch(`/api/vendor-performance?${params}`);
  if (!r.ok) return [];
  return r.json();
}

async function fetchTaskStats(companyId?: number) {
  const params = new URLSearchParams();
  if (companyId) params.set("companyId", String(companyId));
  const r = await fetch(`/api/internal-tasks/stats/summary?${params}`);
  if (!r.ok) return [];
  return r.json();
}

const BADGE_COLORS: Record<string, string> = {
  "Top Vendor": "bg-yellow-100 text-yellow-800 border-yellow-200",
  "Fast Response": "bg-blue-100 text-blue-800 border-blue-200",
  "Best ETA": "bg-green-100 text-green-800 border-green-200",
  "Trusted Vendor": "bg-purple-100 text-purple-800 border-purple-200",
};

export default function AnalyticsDashboardPage() {
  const [period, setPeriod] = useState("30d");
  const { selectedCompany } = useCompany();
  const companyId = selectedCompany?.id;

  const { data: analytics, isLoading: loadingAnalytics, refetch } = useQuery({
    queryKey: ["analytics", period, companyId],
    queryFn: () => fetchAnalytics(period, companyId),
    refetchInterval: 60000,
  });

  const { data: vendors = [] } = useQuery({
    queryKey: ["vendor-performance", companyId],
    queryFn: () => fetchVendorPerformance(companyId),
  });

  const { data: taskStats = [] } = useQuery({
    queryKey: ["task-stats", companyId],
    queryFn: () => fetchTaskStats(companyId),
  });

  const kpis = [
    {
      label: "Total RFQ",
      value: analytics?.totalRfq ?? "—",
      icon: <Package className="h-5 w-5 text-blue-500" />,
      sub: `${analytics?.rfqThisPeriod ?? 0} periode ini`,
      color: "border-l-blue-500",
    },
    {
      label: "Total Orders",
      value: analytics?.totalOrders ?? "—",
      icon: <Truck className="h-5 w-5 text-indigo-500" />,
      sub: `${analytics?.ordersThisPeriod ?? 0} periode ini`,
      color: "border-l-indigo-500",
    },
    {
      label: "Approval Rate",
      value: pct(analytics?.approvalRate),
      icon: <CheckCircle className="h-5 w-5 text-green-500" />,
      sub: "Customer confirm",
      color: "border-l-green-500",
    },
    {
      label: "Revenue",
      value: idr(analytics?.totalRevenue),
      icon: <DollarSign className="h-5 w-5 text-emerald-500" />,
      sub: "Periode ini",
      color: "border-l-emerald-500",
    },
    {
      label: "Gross Profit",
      value: idr(analytics?.grossProfit),
      icon: <TrendingUp className="h-5 w-5 text-teal-500" />,
      sub: `Margin ${pct(analytics?.marginPct)}`,
      color: "border-l-teal-500",
    },
    {
      label: "Avg Response",
      value: analytics?.avgResponseMin ? `${Number(analytics.avgResponseMin).toFixed(0)} mnt` : "—",
      icon: <Clock className="h-5 w-5 text-orange-500" />,
      sub: "Vendor response",
      color: "border-l-orange-500",
    },
  ];

  return (
    <AppShell>
      <div className="p-4 md:p-6 space-y-6">
        {/* Header */}
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
          <div>
            <h1 className="text-2xl font-bold flex items-center gap-2">
              <BarChart2 className="h-6 w-6 text-primary" />
              Analytics Dashboard
            </h1>
            <p className="text-muted-foreground text-sm mt-0.5">
              KPI & performa operasional bisnis
            </p>
          </div>
          <div className="flex items-center gap-2">
            <Select value={period} onValueChange={setPeriod}>
              <SelectTrigger className="w-36">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="7d">7 Hari</SelectItem>
                <SelectItem value="30d">30 Hari</SelectItem>
                <SelectItem value="90d">90 Hari</SelectItem>
                <SelectItem value="1y">1 Tahun</SelectItem>
              </SelectContent>
            </Select>
            <Button variant="outline" size="icon" onClick={() => refetch()}>
              <RefreshCw className="h-4 w-4" />
            </Button>
          </div>
        </div>

        {/* KPI Cards */}
        <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-3">
          {kpis.map((k) => (
            <Card key={k.label} className={`border-l-4 ${k.color}`}>
              <CardContent className="p-4">
                <div className="flex items-center justify-between mb-2">
                  <span className="text-xs text-muted-foreground">{k.label}</span>
                  {k.icon}
                </div>
                <div className="text-xl font-bold">{k.value}</div>
                <div className="text-xs text-muted-foreground mt-0.5">{k.sub}</div>
              </CardContent>
            </Card>
          ))}
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          {/* Top Vendors */}
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-base flex items-center gap-2">
                <Star className="h-4 w-4 text-yellow-500" />
                Top Vendor Performance
              </CardTitle>
              <CardDescription>Berdasarkan recommendation score</CardDescription>
            </CardHeader>
            <CardContent>
              {vendors.length === 0 ? (
                <div className="text-center text-muted-foreground py-8 text-sm">
                  Belum ada data performa vendor
                </div>
              ) : (
                <div className="space-y-3">
                  {vendors.slice(0, 8).map((v: any, i: number) => {
                    const p = v.perf;
                    const score = Number(p?.recommendationScore ?? 0);
                    return (
                      <div key={v.vendor.id} className="flex items-center gap-3">
                        <span className="text-xs font-bold text-muted-foreground w-5">{i + 1}</span>
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-2">
                            <span className="font-medium text-sm truncate">{v.vendor.name}</span>
                            {v.badges?.map((b: string) => (
                              <span key={b} className={`text-xs px-1.5 py-0.5 rounded-full border font-medium ${BADGE_COLORS[b] ?? "bg-gray-100 text-gray-700"}`}>
                                {b}
                              </span>
                            ))}
                          </div>
                          <div className="text-xs text-muted-foreground mt-0.5 flex gap-3">
                            <span>On-time: {pct(p?.ontimePercentage)}</span>
                            <span>Resp: {p?.averageResponseMinutes ? `${Number(p.averageResponseMinutes).toFixed(0)} mnt` : "—"}</span>
                            <span>{p?.totalOrders ?? 0} order</span>
                          </div>
                        </div>
                        <div className="text-right">
                          <div className={`text-sm font-bold ${score >= 70 ? "text-green-600" : score >= 50 ? "text-yellow-600" : "text-red-500"}`}>
                            {score.toFixed(0)}
                          </div>
                          <div className="text-xs text-muted-foreground">score</div>
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </CardContent>
          </Card>

          {/* Internal Tasks Summary */}
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-base flex items-center gap-2">
                <Activity className="h-4 w-4 text-primary" />
                Internal Tasks per Departemen
              </CardTitle>
              <CardDescription>Status task operasional</CardDescription>
            </CardHeader>
            <CardContent>
              {taskStats.length === 0 ? (
                <div className="text-center text-muted-foreground py-8 text-sm">
                  Belum ada task
                </div>
              ) : (
                <div className="space-y-3">
                  {taskStats.map((dept: any) => (
                    <div key={dept.department ?? "unassigned"} className="space-y-1">
                      <div className="flex items-center justify-between">
                        <span className="text-sm font-medium">{dept.department ?? "Tidak Ada Dept"}</span>
                        <div className="flex gap-2 text-xs">
                          <span className="text-blue-600 font-medium">{dept.open} open</span>
                          <span className="text-green-600 font-medium">{dept.completed} done</span>
                          {dept.overdue > 0 && (
                            <span className="text-red-600 font-bold">{dept.overdue} overdue</span>
                          )}
                        </div>
                      </div>
                      <div className="w-full bg-gray-100 rounded-full h-1.5">
                        <div
                          className="bg-green-500 h-1.5 rounded-full"
                          style={{ width: `${dept.total > 0 ? (dept.completed / dept.total) * 100 : 0}%` }}
                        />
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>

          {/* Order Status Distribution */}
          {analytics?.orderStatusCounts && (
            <Card>
              <CardHeader className="pb-3">
                <CardTitle className="text-base flex items-center gap-2">
                  <Target className="h-4 w-4 text-primary" />
                  Distribusi Status Order
                </CardTitle>
              </CardHeader>
              <CardContent>
                <div className="space-y-2">
                  {Object.entries(analytics.orderStatusCounts as Record<string, number>).map(([status, count]) => {
                    const total = analytics.totalOrders || 1;
                    const pctVal = ((count as number) / total) * 100;
                    return (
                      <div key={status} className="flex items-center gap-2">
                        <span className="text-xs w-32 truncate text-muted-foreground">{status}</span>
                        <div className="flex-1 bg-gray-100 rounded-full h-2">
                          <div className="bg-primary h-2 rounded-full" style={{ width: `${pctVal}%` }} />
                        </div>
                        <span className="text-xs font-medium w-8 text-right">{count as number}</span>
                      </div>
                    );
                  })}
                </div>
              </CardContent>
            </Card>
          )}

          {/* Top Customers */}
          {analytics?.topCustomers?.length > 0 && (
            <Card>
              <CardHeader className="pb-3">
                <CardTitle className="text-base flex items-center gap-2">
                  <Users className="h-4 w-4 text-primary" />
                  Top Customers (repeat order)
                </CardTitle>
              </CardHeader>
              <CardContent>
                <div className="space-y-2">
                  {analytics.topCustomers.slice(0, 8).map((c: any, i: number) => (
                    <div key={c.customerName} className="flex items-center justify-between">
                      <div className="flex items-center gap-2">
                        <span className="text-xs text-muted-foreground w-5">{i + 1}</span>
                        <span className="text-sm">{c.customerName}</span>
                      </div>
                      <div className="text-xs text-muted-foreground">
                        <span className="font-medium text-foreground">{c.orderCount}</span> order
                      </div>
                    </div>
                  ))}
                </div>
              </CardContent>
            </Card>
          )}
        </div>
      </div>
    </AppShell>
  );
}
