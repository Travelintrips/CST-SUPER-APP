import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Link } from "wouter";
import { AppShell } from "@/components/layout/AppShell";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { LoadingSkeleton } from "@/components/ui/loading-skeleton";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import { ArrowLeft,
  BarChart2, CheckCircle2, XCircle, Clock, Loader2, Truck,
  MessageCircle, Smartphone, FileCheck, Timer, TrendingUp, RefreshCw,
} from "lucide-react";

interface AnalyticsSummary {
  period: { days: number; from: string; to: string };
  summary: {
    total: number;
    completed: number;
    delivered: number;
    cancelled: number;
    inProgress: number;
    internalCount: number;
    externalCount: number;
    podSubmitted: number;
    deliveredForPod: number;
    podRate: number | null;
    successRate: number | null;
    avgDurationHours: number | null;
    onTimeCount: number;
    onTimeTotal: number;
    onTimePct: number | null;
  };
  statusDistribution: Record<string, number>;
  recentJobs: Array<{
    id: number;
    jobNumber: string;
    status: string;
    driverType: string | null;
    driverName: string;
    assignedAt: string;
    completedAt: string | null;
    logisticOrderId: number | null;
  }>;
}

const STATUS_LABELS: Record<string, string> = {
  ASSIGNED: "Ditugaskan",
  ACCEPTED: "Diterima",
  ON_THE_WAY_TO_PICKUP: "Menuju Pickup",
  ARRIVED_AT_PICKUP: "Tiba Pickup",
  PICKED_UP: "Diambil",
  IN_TRANSIT: "Transit",
  ARRIVED_AT_DESTINATION: "Tiba Tujuan",
  DELIVERED: "Terkirim",
  COMPLETED: "Selesai",
  CANCELLED: "Dibatalkan",
};

const STATUS_COLORS: Record<string, string> = {
  COMPLETED: "bg-green-50 text-green-700 border-green-200",
  DELIVERED: "bg-emerald-50 text-emerald-700 border-emerald-200",
  CANCELLED: "bg-red-50 text-red-700 border-red-200",
  IN_TRANSIT: "bg-orange-50 text-orange-700 border-orange-200",
  ASSIGNED: "bg-amber-50 text-amber-700 border-amber-200",
  PICKED_UP: "bg-cyan-50 text-cyan-700 border-cyan-200",
};

function pctColor(v: number | null): string {
  if (v === null) return "text-slate-400";
  if (v >= 90) return "text-green-600 font-bold";
  if (v >= 70) return "text-amber-600 font-semibold";
  return "text-red-600 font-semibold";
}

function RateBadge({ value }: { value: number | null }) {
  if (value === null) return <span className="text-xs text-slate-400">—</span>;
  const color =
    value >= 90 ? "bg-emerald-50 text-emerald-700 border-emerald-200" :
    value >= 70 ? "bg-amber-50 text-amber-700 border-amber-200" :
    "bg-red-50 text-red-700 border-red-200";
  return <Badge variant="outline" className={`text-xs font-semibold ${color}`}>{value}%</Badge>;
}

const STATUS_ORDER = [
  "ASSIGNED", "ACCEPTED", "ON_THE_WAY_TO_PICKUP", "ARRIVED_AT_PICKUP",
  "PICKED_UP", "IN_TRANSIT", "ARRIVED_AT_DESTINATION", "DELIVERED", "COMPLETED", "CANCELLED",
];

const dt = (s: string | null) =>
  s ? new Date(s).toLocaleString("id-ID", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" }) : "—";

export default function DriverAnalyticsDashboardPage() {
  const [days, setDays] = useState("30");
  const [driverType, setDriverType] = useState("ALL");

  const params = new URLSearchParams({ days });
  if (driverType !== "ALL") params.set("driverType", driverType);

  const { data, isLoading, refetch, isFetching } = useQuery<AnalyticsSummary>({
    queryKey: ["driver-analytics-summary", days, driverType],
    queryFn: async () => {
      const res = await fetch(`/api/drivers/analytics/summary?${params}`, { credentials: "include" });
      if (!res.ok) throw new Error("Gagal memuat analytics");
      return res.json() as Promise<AnalyticsSummary>;
    },
    refetchInterval: 60_000,
  });

  const s = data?.summary;
  const maxCount = s ? Math.max(s.total, 1) : 1;

  // Status distribution bar chart data
  const distEntries = data
    ? STATUS_ORDER
        .filter((k) => (data.statusDistribution[k] ?? 0) > 0)
        .map((k) => ({ status: k, count: data.statusDistribution[k] ?? 0 }))
    : [];

  return (
    <AppShell title="Driver Analytics" breadcrumbs={[
      { label: "Logistics", href: "/logistics" },
      { label: "Driver Analytics" },
    ]}>
      <div className="max-w-5xl mx-auto space-y-5 p-4">
        {/* Filter bar */}
        <div className="flex items-center gap-3 flex-wrap">
          <Link href="/logistics/drivers"><Button variant="ghost" size="icon"><ArrowLeft className="h-4 w-4" /></Button></Link>
          <div className="flex items-center gap-2">
            <span className="text-sm text-slate-500">Periode:</span>
            <Select value={days} onValueChange={setDays}>
              <SelectTrigger className="w-28 h-8 text-sm">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="7">7 hari</SelectItem>
                <SelectItem value="14">14 hari</SelectItem>
                <SelectItem value="30">30 hari</SelectItem>
                <SelectItem value="60">60 hari</SelectItem>
                <SelectItem value="90">90 hari</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div className="flex items-center gap-2">
            <span className="text-sm text-slate-500">Mode:</span>
            <Select value={driverType} onValueChange={setDriverType}>
              <SelectTrigger className="w-36 h-8 text-sm">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="ALL">Semua Driver</SelectItem>
                <SelectItem value="INTERNAL">Internal (WA)</SelectItem>
                <SelectItem value="EXTERNAL">Eksternal (App)</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <Button variant="ghost" size="sm" className="h-8 gap-1.5" onClick={() => void refetch()} disabled={isFetching}>
            <RefreshCw className={`w-3.5 h-3.5 ${isFetching ? "animate-spin" : ""}`} />
            Refresh
          </Button>
          <div className="ml-auto">
            <Link href="/logistics/driver-performance">
              <Button variant="outline" size="sm" className="h-8 text-xs gap-1.5">
                <BarChart2 className="w-3.5 h-3.5" /> Per-Driver Detail
              </Button>
            </Link>
          </div>
        </div>

        {/* KPI Cards — Row 1 */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          {[
            { label: "Total Job", value: s?.total, icon: Truck, color: "blue" },
            { label: "Terkirim", value: s?.delivered, icon: CheckCircle2, color: "green" },
            { label: "Dibatalkan", value: s?.cancelled, icon: XCircle, color: "red" },
            { label: "Sedang Berjalan", value: s?.inProgress, icon: Loader2, color: "amber" },
          ].map(({ label, value, icon: Icon, color }) => (
            <Card key={label}>
              <CardContent className="pt-4">
                <div className="flex items-center gap-3">
                  <div className={`w-9 h-9 rounded-lg bg-${color}-500/10 flex items-center justify-center shrink-0`}>
                    <Icon className={`w-4 h-4 text-${color}-600`} />
                  </div>
                  <div>
                    {isLoading ? <Skeleton className="h-7 w-12" /> : <p className="text-2xl font-bold">{value ?? 0}</p>}
                    <p className="text-xs text-slate-500">{label}</p>
                  </div>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>

        {/* KPI Cards — Row 2 */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          <Card>
            <CardContent className="pt-4">
              <div className="flex items-center gap-3">
                <div className="w-9 h-9 rounded-lg bg-emerald-500/10 flex items-center justify-center shrink-0">
                  <TrendingUp className="w-4 h-4 text-emerald-600" />
                </div>
                <div>
                  {isLoading ? <Skeleton className="h-7 w-16" /> : <div className="flex items-baseline gap-1"><p className="text-2xl font-bold">{s?.successRate ?? "—"}</p>{s?.successRate != null && <span className="text-sm text-slate-400">%</span>}</div>}
                  <p className="text-xs text-slate-500">Success Rate</p>
                </div>
              </div>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="pt-4">
              <div className="flex items-center gap-3">
                <div className="w-9 h-9 rounded-lg bg-sky-500/10 flex items-center justify-center shrink-0">
                  <FileCheck className="w-4 h-4 text-sky-600" />
                </div>
                <div>
                  {isLoading ? <Skeleton className="h-7 w-16" /> : <div className="flex items-baseline gap-1"><p className="text-2xl font-bold">{s?.podRate ?? "—"}</p>{s?.podRate != null && <span className="text-sm text-slate-400">%</span>}</div>}
                  <p className="text-xs text-slate-500">POD Rate</p>
                </div>
              </div>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="pt-4">
              <div className="flex items-center gap-3">
                <div className="w-9 h-9 rounded-lg bg-purple-500/10 flex items-center justify-center shrink-0">
                  <Timer className="w-4 h-4 text-purple-600" />
                </div>
                <div>
                  {isLoading ? <Skeleton className="h-7 w-16" /> : <div className="flex items-baseline gap-1"><p className="text-2xl font-bold">{s?.avgDurationHours ?? "—"}</p>{s?.avgDurationHours != null && <span className="text-sm text-slate-400">jam</span>}</div>}
                  <p className="text-xs text-slate-500">Rata-rata Durasi</p>
                </div>
              </div>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="pt-4">
              <div className="flex items-center gap-3">
                <div className="w-9 h-9 rounded-lg bg-teal-500/10 flex items-center justify-center shrink-0">
                  <Clock className="w-4 h-4 text-teal-600" />
                </div>
                <div>
                  {isLoading ? <Skeleton className="h-7 w-16" /> : <div className="flex items-baseline gap-1"><p className="text-2xl font-bold">{s?.onTimePct ?? "—"}</p>{s?.onTimePct != null && <span className="text-sm text-slate-400">%</span>}</div>}
                  <p className="text-xs text-slate-500">On-Time Delivery</p>
                  {!isLoading && s && s.onTimeTotal > 0 && <p className="text-[10px] text-slate-400">{s.onTimeCount}/{s.onTimeTotal} job</p>}
                </div>
              </div>
            </CardContent>
          </Card>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          {/* Internal vs External */}
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm">Mode Driver</CardTitle>
            </CardHeader>
            <CardContent>
              {isLoading ? (
                <LoadingSkeleton skeletonRows={2} skeletonRowClassName="h-10" />
              ) : s ? (
                <div className="space-y-3">
                  <div>
                    <div className="flex items-center justify-between mb-1">
                      <span className="text-xs flex items-center gap-1"><MessageCircle className="w-3 h-3 text-indigo-500" /> Internal (WA)</span>
                      <span className="text-xs font-semibold">{s.internalCount}</span>
                    </div>
                    <div className="h-2 rounded-full bg-slate-100 overflow-hidden">
                      <div className="h-full bg-indigo-400 rounded-full transition-all" style={{ width: `${Math.round((s.internalCount / Math.max(s.total, 1)) * 100)}%` }} />
                    </div>
                    <p className="text-[10px] text-slate-400 mt-0.5">{s.total > 0 ? Math.round((s.internalCount / s.total) * 100) : 0}% dari total</p>
                  </div>
                  <div>
                    <div className="flex items-center justify-between mb-1">
                      <span className="text-xs flex items-center gap-1"><Smartphone className="w-3 h-3 text-sky-500" /> Eksternal (App)</span>
                      <span className="text-xs font-semibold">{s.externalCount}</span>
                    </div>
                    <div className="h-2 rounded-full bg-slate-100 overflow-hidden">
                      <div className="h-full bg-sky-400 rounded-full transition-all" style={{ width: `${Math.round((s.externalCount / Math.max(s.total, 1)) * 100)}%` }} />
                    </div>
                    <p className="text-[10px] text-slate-400 mt-0.5">{s.total > 0 ? Math.round((s.externalCount / s.total) * 100) : 0}% dari total</p>
                  </div>
                  <div className="pt-1 border-t border-slate-100">
                    <div className="flex items-center justify-between">
                      <span className="text-xs flex items-center gap-1"><FileCheck className="w-3 h-3 text-slate-400" /> POD Submitted</span>
                      <RateBadge value={s.podRate} />
                    </div>
                    <p className="text-[10px] text-slate-400 mt-0.5">{s.podSubmitted} dari {s.deliveredForPod} terkirim</p>
                  </div>
                </div>
              ) : null}
            </CardContent>
          </Card>

          {/* Status Distribution */}
          <Card className="md:col-span-2">
            <CardHeader className="pb-2">
              <CardTitle className="text-sm">Distribusi Status Job</CardTitle>
            </CardHeader>
            <CardContent>
              {isLoading ? (
                <LoadingSkeleton skeletonRows={4} skeletonRowClassName="h-6" />
              ) : distEntries.length === 0 ? (
                <p className="text-sm text-slate-400 text-center py-4">Tidak ada data</p>
              ) : (
                <div className="space-y-2">
                  {distEntries.map(({ status, count }) => {
                    const pct = Math.round((count / maxCount) * 100);
                    const isGood = ["COMPLETED", "DELIVERED"].includes(status);
                    const isBad = status === "CANCELLED";
                    return (
                      <div key={status} className="flex items-center gap-2">
                        <span className="text-[11px] text-slate-500 w-36 shrink-0">{STATUS_LABELS[status] ?? status}</span>
                        <div className="flex-1 h-5 bg-slate-100 rounded overflow-hidden">
                          <div
                            className={`h-full rounded transition-all ${isGood ? "bg-green-400" : isBad ? "bg-red-400" : "bg-indigo-300"}`}
                            style={{ width: `${pct}%` }}
                          />
                        </div>
                        <span className="text-[11px] font-semibold text-slate-700 w-6 text-right">{count}</span>
                      </div>
                    );
                  })}
                </div>
              )}
            </CardContent>
          </Card>
        </div>

        {/* Recent Jobs Table */}
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm">Job Terbaru (15)</CardTitle>
          </CardHeader>
          <CardContent className="p-0">
            {isLoading ? (
              <LoadingSkeleton skeletonRows={3} skeletonRowClassName="h-8" className="p-4" />
            ) : !data?.recentJobs.length ? (
              <p className="text-sm text-slate-400 text-center py-6">Tidak ada job dalam periode ini</p>
            ) : (
              <Table>
                <TableHeader>
                  <TableRow className="text-xs">
                    <TableHead>Job No.</TableHead>
                    <TableHead>Driver</TableHead>
                    <TableHead>Mode</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead>Ditugaskan</TableHead>
                    <TableHead>Selesai</TableHead>
                    <TableHead></TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {data.recentJobs.map((j) => (
                    <TableRow key={j.id} className="text-xs">
                      <TableCell className="font-mono text-slate-600">{j.jobNumber}</TableCell>
                      <TableCell className="max-w-[120px] truncate font-medium">{j.driverName}</TableCell>
                      <TableCell>
                        {j.driverType === "INTERNAL" ? (
                          <Badge variant="outline" className="text-[10px] h-4 px-1 bg-indigo-50 text-indigo-600 border-indigo-200">
                            <MessageCircle className="w-2.5 h-2.5 mr-0.5" />WA
                          </Badge>
                        ) : (
                          <Badge variant="outline" className="text-[10px] h-4 px-1 bg-sky-50 text-sky-600 border-sky-200">
                            <Smartphone className="w-2.5 h-2.5 mr-0.5" />App
                          </Badge>
                        )}
                      </TableCell>
                      <TableCell>
                        <Badge variant="outline" className={`text-[10px] h-4 px-1.5 ${STATUS_COLORS[j.status] ?? "bg-slate-50 text-slate-600 border-slate-200"}`}>
                          {STATUS_LABELS[j.status] ?? j.status}
                        </Badge>
                      </TableCell>
                      <TableCell className="text-slate-500">{dt(j.assignedAt)}</TableCell>
                      <TableCell className="text-slate-500">{dt(j.completedAt)}</TableCell>
                      <TableCell>
                        {j.logisticOrderId && (
                          <Link href={`/logistics/portal-orders/${j.logisticOrderId}`}>
                            <Button variant="ghost" size="sm" className="h-5 text-[10px] px-1.5">Order</Button>
                          </Link>
                        )}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            )}
          </CardContent>
        </Card>
      </div>
    </AppShell>
  );
}
