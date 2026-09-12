import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import {
  AreaChart,
  Area,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  PieChart,
  Pie,
  Cell,
  BarChart,
  Bar,
  Legend,
} from "recharts";
import {
  ChevronDown,
  ChevronRight,
  AlertTriangle,
  RefreshCw,
  Filter,
  ArrowLeft,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";

const SEVERITY_COLOR: Record<string, string> = {
  low: "#22c55e",
  medium: "#f59e0b",
  high: "#ef4444",
  critical: "#7c3aed",
};

const TYPE_COLOR: Record<string, string> = {
  ui_crash: "#ef4444",
  api_failure: "#f59e0b",
  validation_error: "#3b82f6",
  network_error: "#8b5cf6",
  unknown: "#6b7280",
};

interface StatsData {
  todayCount: number;
  spike5m: number;
  spikeHour: number;
  bySeverity: Record<string, number>;
  topComponents: { component: string; count: number }[];
  byType: Record<string, number>;
  hourlyData: { hour: string; count: number }[];
  recurringErrors: { error_message: string; count: number; last_seen: string }[];
}

interface ErrorLog {
  id: number;
  error_message: string;
  stack_trace: string | null;
  route: string | null;
  component: string | null;
  severity: string;
  error_type: string;
  metadata: Record<string, unknown> | null;
  created_at: string;
}

export default function ObservabilityErrorsPage() {
  const [severity, setSeverity] = useState("all");
  const [errorType, setErrorType] = useState("all");
  const [expanded, setExpanded] = useState<Set<number>>(new Set());
  const [page, setPage] = useState(1);

  const { data: stats, refetch: refetchStats, isFetching: fetchingStats } = useQuery<StatsData>({
    queryKey: ["obs-stats"],
    queryFn: async () => {
      const res = await fetch("/api/logs/client-errors/stats", { credentials: "include" });
      if (!res.ok) throw new Error("Gagal memuat statistik");
      return res.json();
    },
    refetchInterval: 30000,
  });

  const limit = 20;
  const params = new URLSearchParams({ limit: String(limit), offset: String((page - 1) * limit) });
  if (severity !== "all") params.set("severity", severity);
  if (errorType !== "all") params.set("error_type", errorType);

  const { data: logsData, refetch: refetchLogs, isFetching: fetchingLogs } = useQuery<{ data: ErrorLog[]; total: number }>({
    queryKey: ["obs-logs", severity, errorType, page],
    queryFn: async () => {
      const res = await fetch(`/api/logs/client-errors?${params}`, { credentials: "include" });
      if (!res.ok) throw new Error("Gagal memuat log");
      return res.json();
    },
  });

  const toggle = (id: number) => {
    setExpanded(prev => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });
  };

  const bySeverityPie = stats
    ? Object.entries(stats.bySeverity).map(([name, value]) => ({ name, value }))
    : [];

  const byTypePie = stats
    ? Object.entries(stats.byType).map(([name, value]) => ({ name, value }))
    : [];

  const totalPages = logsData ? Math.ceil(logsData.total / limit) : 1;

  return (
    <div className="p-6 space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold">Error Observability</h1>
          <p className="text-sm text-muted-foreground">Monitoring error & crash sistem secara real-time</p>
        </div>
        <Button
          variant="outline"
          size="sm"
          onClick={() => { refetchStats(); refetchLogs(); }}
          disabled={fetchingStats || fetchingLogs}
        >
          <RefreshCw className={`w-4 h-4 mr-2 ${fetchingStats || fetchingLogs ? "animate-spin" : ""}`} />
          Refresh
        </Button>
      </div>

      {/* KPI Cards */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">Error Hari Ini</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-3xl font-bold">{stats?.todayCount ?? 0}</div>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">Spike 5 Menit</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-3xl font-bold text-orange-500">{stats?.spike5m ?? 0}</div>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">Spike 1 Jam</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-3xl font-bold text-yellow-500">{stats?.spikeHour ?? 0}</div>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">Komponen Teratas</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-xl font-bold truncate">
              {stats?.topComponents?.[0]?.component ?? "—"}
            </div>
            <div className="text-sm text-muted-foreground">
              {stats?.topComponents?.[0]?.count ?? 0} error
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Charts Row 1 */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <Card className="md:col-span-2">
          <CardHeader>
            <CardTitle className="text-sm">Timeline Error (24 Jam Terakhir)</CardTitle>
          </CardHeader>
          <CardContent>
            <ResponsiveContainer width="100%" height={200}>
              <AreaChart data={stats?.hourlyData ?? []}>
                <defs>
                  <linearGradient id="errorGrad" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%" stopColor="#ef4444" stopOpacity={0.3} />
                    <stop offset="95%" stopColor="#ef4444" stopOpacity={0} />
                  </linearGradient>
                </defs>
                <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
                <XAxis dataKey="hour" tick={{ fontSize: 11 }} />
                <YAxis tick={{ fontSize: 11 }} allowDecimals={false} />
                <Tooltip />
                <Area
                  type="monotone"
                  dataKey="count"
                  stroke="#ef4444"
                  fill="url(#errorGrad)"
                  name="Error"
                />
              </AreaChart>
            </ResponsiveContainer>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-sm">Distribusi Severity</CardTitle>
          </CardHeader>
          <CardContent>
            <ResponsiveContainer width="100%" height={200}>
              <PieChart>
                <Pie
                  data={bySeverityPie}
                  cx="50%"
                  cy="50%"
                  innerRadius={50}
                  outerRadius={80}
                  dataKey="value"
                  label={({ name, percent }) => `${name} ${Math.round((percent ?? 0) * 100)}%`}
                  labelLine={false}
                >
                  {bySeverityPie.map((entry) => (
                    <Cell key={entry.name} fill={SEVERITY_COLOR[entry.name] ?? "#6b7280"} />
                  ))}
                </Pie>
                <Tooltip />
              </PieChart>
            </ResponsiveContainer>
          </CardContent>
        </Card>
      </div>

      {/* Charts Row 2 */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <Card>
          <CardHeader>
            <CardTitle className="text-sm">Top Komponen / Module</CardTitle>
          </CardHeader>
          <CardContent>
            <ResponsiveContainer width="100%" height={200}>
              <BarChart data={stats?.topComponents?.slice(0, 8) ?? []} layout="vertical">
                <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
                <XAxis type="number" tick={{ fontSize: 11 }} allowDecimals={false} />
                <YAxis dataKey="component" type="category" tick={{ fontSize: 11 }} width={110} />
                <Tooltip />
                <Bar dataKey="count" fill="#ef4444" name="Error" radius={[0, 4, 4, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-sm">Distribusi Tipe Error</CardTitle>
          </CardHeader>
          <CardContent>
            <ResponsiveContainer width="100%" height={200}>
              <BarChart data={byTypePie}>
                <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
                <XAxis dataKey="name" tick={{ fontSize: 10 }} />
                <YAxis tick={{ fontSize: 11 }} allowDecimals={false} />
                <Tooltip />
                <Bar dataKey="value" name="Count" radius={[4, 4, 0, 0]}>
                  {byTypePie.map((entry) => (
                    <Cell key={entry.name} fill={TYPE_COLOR[entry.name] ?? "#6b7280"} />
                  ))}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          </CardContent>
        </Card>
      </div>

      {/* Recurring Errors */}
      {(stats?.recurringErrors?.length ?? 0) > 0 && (
        <Card className="border-orange-200 bg-orange-50 dark:bg-orange-950">
          <CardHeader>
            <CardTitle className="text-sm flex items-center gap-2 text-orange-700 dark:text-orange-400">
              <AlertTriangle className="w-4 h-4" />
              Error Berulang ({">"} 5x dalam 1 jam)
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="space-y-2">
              {stats!.recurringErrors.map((e, i) => (
                <div key={i} className="flex items-center justify-between text-sm p-2 rounded bg-orange-100 dark:bg-orange-900/30">
                  <span className="truncate font-mono text-xs flex-1 mr-4">{e.error_message}</span>
                  <span className="text-orange-600 font-bold whitespace-nowrap">{e.count}x</span>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      )}

      {/* Filters + Table */}
      <Card>
        <CardHeader>
          <div className="flex items-center justify-between flex-wrap gap-2">
            <CardTitle className="text-sm">Log Error Terbaru</CardTitle>
            <div className="flex items-center gap-2">
              <Filter className="w-4 h-4 text-muted-foreground" />
              <Select value={severity} onValueChange={v => { setSeverity(v); setPage(1); }}>
                <SelectTrigger className="w-36 h-8 text-xs">
                  <SelectValue placeholder="Semua Severity" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">Semua Severity</SelectItem>
                  <SelectItem value="low">Low</SelectItem>
                  <SelectItem value="medium">Medium</SelectItem>
                  <SelectItem value="high">High</SelectItem>
                  <SelectItem value="critical">Critical</SelectItem>
                </SelectContent>
              </Select>
              <Select value={errorType} onValueChange={v => { setErrorType(v); setPage(1); }}>
                <SelectTrigger className="w-40 h-8 text-xs">
                  <SelectValue placeholder="Semua Tipe" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">Semua Tipe</SelectItem>
                  <SelectItem value="ui_crash">UI Crash</SelectItem>
                  <SelectItem value="api_failure">API Failure</SelectItem>
                  <SelectItem value="validation_error">Validation Error</SelectItem>
                  <SelectItem value="network_error">Network Error</SelectItem>
                  <SelectItem value="unknown">Unknown</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>
        </CardHeader>
        <CardContent className="p-0">
          <div className="text-xs text-muted-foreground px-4 pb-2">
            Total: {logsData?.total ?? 0} log
          </div>
          <div className="divide-y">
            {(logsData?.data ?? []).map((log) => (
              <div key={log.id} className="px-4 py-3">
                <div
                  className="flex items-start gap-2 cursor-pointer"
                  onClick={() => toggle(log.id)}
                >
                  {expanded.has(log.id) ? (
                    <ChevronDown className="w-4 h-4 mt-0.5 shrink-0 text-muted-foreground" />
                  ) : (
                    <ChevronRight className="w-4 h-4 mt-0.5 shrink-0 text-muted-foreground" />
                  )}
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <Badge
                        className="text-xs"
                        style={{ backgroundColor: SEVERITY_COLOR[log.severity], color: "#fff" }}
                      >
                        {log.severity}
                      </Badge>
                      <Badge variant="outline" className="text-xs">
                        {log.error_type.replace(/_/g, " ")}
                      </Badge>
                      {log.component && (
                        <span className="text-xs text-blue-600 font-medium">{log.component}</span>
                      )}
                      {log.route && (
                        <span className="text-xs text-muted-foreground">{log.route}</span>
                      )}
                      <span className="text-xs text-muted-foreground ml-auto">
                        {new Date(log.created_at).toLocaleString("id-ID")}
                      </span>
                    </div>
                    <p className="text-sm font-mono mt-1 truncate">{log.error_message}</p>
                  </div>
                </div>
                {expanded.has(log.id) && (
                  <div className="mt-2 ml-6 space-y-2">
                    {log.stack_trace && (
                      <pre className="text-xs bg-gray-50 dark:bg-gray-900 p-3 rounded overflow-x-auto whitespace-pre-wrap font-mono max-h-64 border">
                        {log.stack_trace}
                      </pre>
                    )}
                    {log.metadata && Object.keys(log.metadata).length > 0 && (
                      <pre className="text-xs bg-blue-50 dark:bg-blue-950 p-2 rounded overflow-x-auto font-mono max-h-32 border border-blue-200">
                        {JSON.stringify(log.metadata, null, 2)}
                      </pre>
                    )}
                  </div>
                )}
              </div>
            ))}
            {(logsData?.data ?? []).length === 0 && (
              <div className="py-12 text-center text-sm text-muted-foreground">
                Tidak ada error ditemukan
              </div>
            )}
          </div>
          {totalPages > 1 && (
            <div className="flex items-center justify-center gap-2 p-4 border-t">
              <Button
                variant="outline"
                size="sm"
                disabled={page <= 1}
                onClick={() => setPage(p => p - 1)}
              >
                Sebelumnya
              </Button>
              <span className="text-sm text-muted-foreground">
                Hal {page} / {totalPages}
              </span>
              <Button
                variant="outline"
                size="sm"
                disabled={page >= totalPages}
                onClick={() => setPage(p => p + 1)}
              >
                Berikutnya
              </Button>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
