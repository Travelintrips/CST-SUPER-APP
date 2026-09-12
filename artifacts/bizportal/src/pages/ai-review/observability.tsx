import { useQuery } from "@tanstack/react-query";
import { AppShell } from "@/components/layout/AppShell";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { ChartContainer, type ChartConfig } from "@/components/ui/chart";
import {
  BarChart,
  Bar,
  PieChart,
  Pie,
  Cell,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
  ResponsiveContainer,
} from "recharts";
import {
  RefreshCw,
  AlertTriangle,
  BarChart3,
  CheckCircle2,
  Clock,
  TrendingUp,
  ArrowLeft,
} from "lucide-react";
import { Link } from "wouter";
import { aiReviewApi, QUEUE_LABELS, PRIORITY_LABELS, STATUS_LABELS } from "@/lib/ai-review-api";

// ── Colors ───────────────────────────────────────────────────────────────────

const COLORS = [
  "#6366f1", "#22c55e", "#f59e0b", "#ef4444",
  "#3b82f6", "#8b5cf6", "#10b981", "#f97316",
];

// ── Metric Card ───────────────────────────────────────────────────────────────

function MetricCard({
  label,
  value,
  unit,
  icon: Icon,
  color,
}: {
  label: string;
  value: number | undefined | null;
  unit?: string;
  icon: React.ComponentType<{ className?: string }>;
  color?: string;
}) {
  const display =
    value == null
      ? "—"
      : unit === "%"
      ? `${Math.round(value * 100)}%`
      : unit === "min"
      ? `${Math.round(value)}m`
      : value.toLocaleString("id-ID");

  return (
    <Card>
      <CardContent className="p-4">
        <div className="flex items-center gap-3">
          <div className={`rounded-full p-2 ${color ?? "bg-indigo-100"}`}>
            <Icon className="h-4 w-4 text-indigo-600" />
          </div>
          <div>
            <p className="text-xl font-bold leading-none">{display}</p>
            <p className="text-xs text-muted-foreground mt-1">{label}</p>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

// ── Main Page ─────────────────────────────────────────────────────────────────

export default function AiReviewObservabilityPage() {
  const { data, isLoading, error, refetch } = useQuery({
    queryKey: ["ai-review-observability"],
    queryFn: aiReviewApi.getObservability,
    refetchInterval: 120_000,
  });

  // Prepare chart data
  const queueChartData = Object.entries(data?.byQueue ?? {}).map(([key, count]) => ({
    name: QUEUE_LABELS[key as keyof typeof QUEUE_LABELS] ?? key,
    value: count,
  }));

  const priorityChartData = Object.entries(data?.byPriority ?? {}).map(([key, count]) => ({
    name: PRIORITY_LABELS[key as keyof typeof PRIORITY_LABELS] ?? key,
    value: count,
  }));

  const statusChartData = Object.entries(data?.byStatus ?? {}).map(([key, count]) => ({
    name: STATUS_LABELS[key as keyof typeof STATUS_LABELS] ?? key,
    value: count,
  }));

  const anomalyChartData = Object.entries(data?.byAnomalyRisk ?? {}).map(([key, count]) => ({
    name: key,
    value: count,
  }));

  const queueChartConfig: ChartConfig = {
    value: { label: "Kasus", color: "#6366f1" },
  };

  return (
    <AppShell>
      <div className="p-6 space-y-6 max-w-7xl mx-auto">
        {/* Header */}
        <div className="flex items-center justify-between flex-wrap gap-3">
          <div className="flex items-center gap-3">
            <Link href="/ai/review">
              <Button variant="ghost" size="icon"><ArrowLeft className="h-4 w-4" /></Button>
            </Link>
            <div>
              <h1 className="text-2xl font-bold tracking-tight flex items-center gap-2">
                <BarChart3 className="h-6 w-6 text-indigo-500" />
                Observabilitas AI Transaction Review
              </h1>
              <p className="text-muted-foreground text-sm mt-0.5">
                Metrik dan grafik performa sistem review transaksi AI.
              </p>
            </div>
          </div>
          <Button variant="outline" size="sm" onClick={() => refetch()}>
            <RefreshCw className="h-4 w-4 mr-2" /> Refresh
          </Button>
        </div>

        {/* Error */}
        {error && (
          <div className="flex items-center gap-3 rounded-lg border border-destructive/30 bg-destructive/5 p-4">
            <AlertTriangle className="h-4 w-4 text-destructive shrink-0" />
            <p className="text-sm text-destructive">
              {error instanceof Error ? error.message : "Gagal memuat data observabilitas."}
            </p>
            <Button variant="outline" size="sm" onClick={() => refetch()}>Coba Lagi</Button>
          </div>
        )}

        {/* Loading */}
        {isLoading && (
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
            {Array.from({ length: 12 }).map((_, i) => (
              <Card key={i}><CardContent className="p-4 h-16 animate-pulse bg-muted rounded" /></Card>
            ))}
          </div>
        )}

        {!isLoading && data && (
          <>
            {/* Metric Cards */}
            <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-3">
              <MetricCard label="Total Kasus" value={data.totalCases} icon={BarChart3} color="bg-indigo-100" />
              <MetricCard label="Kasus Terbuka" value={data.openCases} icon={Clock} color="bg-yellow-100" />
              <MetricCard label="Kasus Terlambat" value={data.overdueCases} icon={AlertTriangle} color="bg-red-100" />
              <MetricCard label="Manual Review Rate" value={data.manualReviewRate} unit="%" icon={TrendingUp} color="bg-orange-100" />
              <MetricCard label="Approval Rate" value={data.approvalRate} unit="%" icon={CheckCircle2} color="bg-green-100" />
              <MetricCard label="COA Change Rate" value={data.coaChangeRate} unit="%" icon={TrendingUp} color="bg-blue-100" />
              <MetricCard label="Rejection Rate" value={data.rejectionRate} unit="%" icon={AlertTriangle} color="bg-red-100" />
              <MetricCard label="Escalation Rate" value={data.escalationRate} unit="%" icon={TrendingUp} color="bg-purple-100" />
              <MetricCard label="Agreement Rate" value={data.agreementRate} unit="%" icon={CheckCircle2} color="bg-teal-100" />
              <MetricCard label="Avg Review Duration" value={data.avgReviewDurationMinutes} unit="min" icon={Clock} color="bg-gray-100" />
              <MetricCard label="SLA Compliance" value={data.slaComplianceRate} unit="%" icon={CheckCircle2} color="bg-green-100" />
            </div>

            {/* Charts */}
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
              {/* By Queue */}
              {queueChartData.length > 0 && (
                <Card>
                  <CardHeader className="pb-2">
                    <CardTitle className="text-sm font-semibold">Kasus per Antrian</CardTitle>
                  </CardHeader>
                  <CardContent>
                    <ChartContainer config={queueChartConfig} className="h-52">
                      <BarChart data={queueChartData} margin={{ left: 0, right: 8, top: 4, bottom: 4 }}>
                        <CartesianGrid strokeDasharray="3 3" className="stroke-border/30" />
                        <XAxis dataKey="name" tick={{ fontSize: 10 }} />
                        <YAxis tick={{ fontSize: 10 }} />
                        <Tooltip />
                        <Bar dataKey="value" fill="#6366f1" radius={[2, 2, 0, 0]} />
                      </BarChart>
                    </ChartContainer>
                  </CardContent>
                </Card>
              )}

              {/* By Priority */}
              {priorityChartData.length > 0 && (
                <Card>
                  <CardHeader className="pb-2">
                    <CardTitle className="text-sm font-semibold">Kasus per Prioritas</CardTitle>
                  </CardHeader>
                  <CardContent>
                    <ChartContainer config={{ value: { label: "Kasus", color: "#f59e0b" } }} className="h-52">
                      <BarChart data={priorityChartData} margin={{ left: 0, right: 8, top: 4, bottom: 4 }}>
                        <CartesianGrid strokeDasharray="3 3" className="stroke-border/30" />
                        <XAxis dataKey="name" tick={{ fontSize: 10 }} />
                        <YAxis tick={{ fontSize: 10 }} />
                        <Tooltip />
                        <Bar dataKey="value" fill="#f59e0b" radius={[2, 2, 0, 0]} />
                      </BarChart>
                    </ChartContainer>
                  </CardContent>
                </Card>
              )}

              {/* By Status - Pie */}
              {statusChartData.length > 0 && (
                <Card>
                  <CardHeader className="pb-2">
                    <CardTitle className="text-sm font-semibold">Distribusi Status</CardTitle>
                  </CardHeader>
                  <CardContent>
                    <ChartContainer config={{ value: { label: "Kasus" } }} className="h-52">
                      <PieChart>
                        <Pie
                          data={statusChartData}
                          dataKey="value"
                          nameKey="name"
                          cx="50%"
                          cy="50%"
                          outerRadius={80}
                          label={({ name, percent }) => `${name} ${Math.round((percent ?? 0) * 100)}%`}
                          labelLine={false}
                        >
                          {statusChartData.map((_, i) => (
                            <Cell key={i} fill={COLORS[i % COLORS.length]} />
                          ))}
                        </Pie>
                        <Tooltip />
                        <Legend formatter={(value) => <span className="text-xs">{value}</span>} />
                      </PieChart>
                    </ChartContainer>
                  </CardContent>
                </Card>
              )}

              {/* Anomaly Distribution */}
              {anomalyChartData.length > 0 && (
                <Card>
                  <CardHeader className="pb-2">
                    <CardTitle className="text-sm font-semibold">Distribusi Risiko Anomali</CardTitle>
                  </CardHeader>
                  <CardContent>
                    <ChartContainer config={{ value: { label: "Kasus", color: "#ef4444" } }} className="h-52">
                      <BarChart data={anomalyChartData} margin={{ left: 0, right: 8, top: 4, bottom: 4 }}>
                        <CartesianGrid strokeDasharray="3 3" className="stroke-border/30" />
                        <XAxis dataKey="name" tick={{ fontSize: 10 }} />
                        <YAxis tick={{ fontSize: 10 }} />
                        <Tooltip />
                        <Bar dataKey="value" radius={[2, 2, 0, 0]}>
                          {anomalyChartData.map((entry, i) => {
                            const color =
                              entry.name === "CRITICAL" ? "#ef4444" :
                              entry.name === "HIGH" ? "#f97316" :
                              entry.name === "MEDIUM" ? "#f59e0b" :
                              entry.name === "LOW" ? "#22c55e" : "#94a3b8";
                            return <Cell key={i} fill={color} />;
                          })}
                        </Bar>
                      </BarChart>
                    </ChartContainer>
                  </CardContent>
                </Card>
              )}
            </div>

            {/* Empty state for charts */}
            {queueChartData.length === 0 && priorityChartData.length === 0 && statusChartData.length === 0 && anomalyChartData.length === 0 && (
              <Card>
                <CardContent className="py-12 text-center">
                  <BarChart3 className="h-10 w-10 text-muted-foreground/30 mx-auto mb-3" />
                  <p className="text-sm text-muted-foreground">Belum ada data grafik yang tersedia.</p>
                </CardContent>
              </Card>
            )}
          </>
        )}
      </div>
    </AppShell>
  );
}
