import { useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { AppShell } from "@/components/layout/AppShell";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import {
  Activity, AlertTriangle, CheckCircle, XCircle, RefreshCw,
  ChevronDown, ChevronUp, ArrowRight, Zap, TrendingUp,
  Database, Layers, Users, Inbox, ArrowUpCircle, Car, ArrowLeft,
} from "lucide-react";
import { toast } from "sonner";
import { Link } from "wouter";

// ── Types ────────────────────────────────────────────────────────────────────

type PriorityTask = {
  taskId: string;
  title: string;
  reason: string;
  action: string;
  href: string;
  severity: "critical" | "warning" | "optimization";
};

type ExecutiveSummary = {
  generatedAt: string;
  systemStatus: "OK" | "DEGRADED" | "CRITICAL";
  healthScore: number;
  recommendedAction: string;
  priorityTask: PriorityTask;
  top3Risks: PriorityTask[];
};

type SystemOverview = {
  generatedAt: string;
  healthScore: number;
  healthStatus: "green" | "yellow" | "red";
  systemBounds: {
    limits: Record<string, number>;
    violations: { rule: string; current: number; limit: number; severity: string }[];
    queueSaturation: number;
    dlqSaturation: number;
  };
  ingestionQueue: {
    pending: number; processing: number; completed: number; failed: number; total: number;
    recentWeek: { total: number; succeeded: number; failed: number; processing: number; pending: number; successRate: number };
  };
  dlq: { total: number; unresolved: number; resolved: number; latestError: string | null; pressure: number };
  reconciliation: { status: "ok" | "warn" | "fail"; summaryMismatches: number; message: string };
  alerts: { criticalUnread: number; otherUnread: number; totalUnread: number };
  transactions: { total: number; todayCount: number; totalGross: number; latestDate: string | null };
  drivers: { total: number; active: number; suspended: number };
};

// ── Helpers ──────────────────────────────────────────────────────────────────

function fmtNum(v: unknown) {
  return new Intl.NumberFormat("id-ID").format(parseFloat(String(v ?? 0)) || 0);
}
function fmtTs(v: unknown) {
  if (!v) return "–";
  return new Date(String(v)).toLocaleString("id-ID", { dateStyle: "short", timeStyle: "short" });
}

// ── Sub-components ────────────────────────────────────────────────────────────

const SEVERITY_MAP = {
  critical:     { bg: "bg-red-950/60",    border: "border-red-600",    icon: XCircle,       iconCls: "text-red-400",    badge: "bg-red-900 text-red-200",    label: "KRITIS"      },
  warning:      { bg: "bg-amber-950/60",  border: "border-amber-600",  icon: AlertTriangle, iconCls: "text-amber-400",  badge: "bg-amber-900 text-amber-200", label: "PERHATIAN"   },
  optimization: { bg: "bg-blue-950/40",   border: "border-blue-700",   icon: TrendingUp,    iconCls: "text-blue-400",   badge: "bg-blue-900 text-blue-200",   label: "OPTIMASI"    },
};

function ActionCard({ task, rank }: { task: PriorityTask; rank: number }) {
  const s = SEVERITY_MAP[task.severity];
  const Icon = s.icon;
  return (
    <div className={`rounded-lg border ${s.border} ${s.bg} p-4 flex flex-col gap-3`}>
      <div className="flex items-start justify-between gap-2">
        <div className="flex items-center gap-2">
          <span className="text-xs text-slate-500 font-mono">#{rank}</span>
          <span className={`text-xs font-bold px-2 py-0.5 rounded ${s.badge}`}>{s.label}</span>
        </div>
        <Icon className={`h-4 w-4 flex-shrink-0 mt-0.5 ${s.iconCls}`} />
      </div>
      <div>
        <p className="text-sm font-semibold text-slate-100 mb-1">{task.title}</p>
        <p className="text-xs text-slate-400">{task.reason}</p>
      </div>
      <Link href={task.href}>
        <Button size="sm" variant="outline"
          className={`w-full text-xs gap-1.5 border-slate-600 text-slate-200 hover:bg-slate-800`}>
          {task.action} <ArrowRight className="h-3.5 w-3.5" />
        </Button>
      </Link>
    </div>
  );
}

function StatusPill({ status }: { status: "OK" | "DEGRADED" | "CRITICAL" | string }) {
  const map: Record<string, string> = {
    OK:       "bg-emerald-900 text-emerald-200 border-emerald-600",
    DEGRADED: "bg-amber-900 text-amber-200 border-amber-600",
    CRITICAL: "bg-red-900 text-red-200 border-red-600 animate-pulse",
  };
  return (
    <span className={`inline-block border rounded px-2.5 py-1 text-xs font-black tracking-widest ${map[status] ?? "bg-slate-800 text-slate-300 border-slate-600"}`}>
      {status}
    </span>
  );
}

function KPICard({ label, value, sub, color }: { label: string; value: string | number; sub?: string; color: string }) {
  return (
    <div className="bg-slate-800 rounded-lg p-4 flex flex-col gap-1">
      <span className="text-xs text-slate-400">{label}</span>
      <span className={`text-3xl font-black ${color}`}>{value}</span>
      {sub && <span className="text-xs text-slate-500">{sub}</span>}
    </div>
  );
}

function SatBar({ value, label }: { value: number; label: string }) {
  const color = value >= 80 ? "bg-red-500" : value >= 50 ? "bg-yellow-500" : "bg-emerald-500";
  return (
    <div>
      <div className="flex justify-between text-xs text-slate-400 mb-1"><span>{label}</span><span>{value}%</span></div>
      <div className="h-1.5 rounded-full bg-slate-700 overflow-hidden">
        <div className={`h-full rounded-full transition-all ${color}`} style={{ width: `${Math.min(value, 100)}%` }} />
      </div>
    </div>
  );
}

// ── Main Page ─────────────────────────────────────────────────────────────────

export default function FleetControlCenterPage() {
  const [showDetails, setShowDetails] = useState(false);

  const { data: summary, isLoading: summaryLoading, refetch: refetchSummary } = useQuery<ExecutiveSummary>({
    queryKey: ["fleet-executive-summary"],
    queryFn: async () => {
      const res = await fetch("/api/logistics/fleet/executive-summary", { credentials: "include" });
      if (!res.ok) throw new Error("Gagal mengambil executive summary");
      return res.json();
    },
    refetchInterval: 60_000,
    staleTime: 30_000,
  });

  const { data: overview, isFetching: overviewFetching, refetch: refetchOverview } = useQuery<SystemOverview>({
    queryKey: ["fleet-system-overview"],
    queryFn: async () => {
      const res = await fetch("/api/logistics/fleet/system-overview", { credentials: "include" });
      if (!res.ok) throw new Error("Gagal mengambil system overview");
      return res.json();
    },
    enabled: showDetails,
    staleTime: 30_000,
  });

  const reconcileMutation = useMutation({
    mutationFn: async () => {
      const res = await fetch("/api/logistics/fleet/pipeline/reconcile", { method: "POST", credentials: "include" });
      if (!res.ok) throw new Error("Rekonsiliasi gagal");
      return res.json();
    },
    onSuccess: () => { toast.success("Rekonsiliasi selesai"); refetchSummary(); refetchOverview(); },
    onError: (e: Error) => toast.error(e.message),
  });

  function handleRefresh() { refetchSummary(); if (showDetails) refetchOverview(); }

  // ── Loading ──
  if (summaryLoading) {
    return (
      <AppShell>
        <div className="flex items-center justify-center h-96 text-slate-400">
          <RefreshCw className="h-5 w-5 animate-spin mr-2" /> Memuat status sistem...
        </div>
      </AppShell>
    );
  }

  if (!summary) {
    return (
      <AppShell>
        <div className="flex flex-col items-center justify-center h-96 gap-3 text-slate-400">
          <XCircle className="h-8 w-8 text-red-400" />
          <p>Gagal memuat. Coba refresh.</p>
          <Button size="sm" onClick={handleRefresh} variant="outline" className="border-slate-600 text-slate-300">
            <RefreshCw className="h-4 w-4 mr-2" /> Retry
          </Button>
        </div>
      </AppShell>
    );
  }

  const { systemStatus, healthScore, top3Risks, recommendedAction } = summary;
  const isFetching = overviewFetching;

  // 3 primary KPIs derived from summary
  const kpi1Color = healthScore >= 80 ? "text-emerald-400" : healthScore >= 50 ? "text-yellow-400" : "text-red-400";
  const kpi2 = summary.priorityTask;
  const dlqCount = top3Risks.find(r => r.taskId.startsWith("DLQ"))
    ? top3Risks.find(r => r.taskId.startsWith("DLQ"))!.title.match(/\d+/)?.[0] ?? "0"
    : "0";
  const failRisk = top3Risks.find(r => r.taskId.startsWith("INGESTION"));

  return (
    <AppShell>
      <div className="max-w-4xl mx-auto p-5 space-y-5">
        <Link href="/logistics/fleet-intelligence">
          <Button variant="ghost" size="sm" className="text-slate-400 hover:text-white gap-1.5 -ml-2">
            <ArrowLeft className="w-4 h-4" /> Fleet Intelligence
          </Button>
        </Link>

        {/* ── Header ── */}
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <Activity className="h-5 w-5 text-blue-400" />
            <div>
              <h1 className="text-lg font-bold text-slate-100">Fleet Control Center</h1>
              <p className="text-xs text-slate-500">last update: {fmtTs(summary.generatedAt)}</p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <StatusPill status={systemStatus} />
            <Button size="sm" variant="outline" onClick={handleRefresh} disabled={isFetching}
              className="border-slate-600 text-slate-300 hover:bg-slate-800">
              <RefreshCw className={`h-4 w-4 ${isFetching ? "animate-spin" : ""}`} />
            </Button>
          </div>
        </div>

        {/* ── 3 Primary KPIs ── */}
        <div className="grid grid-cols-3 gap-3">
          <KPICard
            label="Health Score"
            value={healthScore}
            sub={systemStatus === "OK" ? "sistem sehat" : systemStatus === "DEGRADED" ? "perlu perhatian" : "kritis"}
            color={kpi1Color}
          />
          <KPICard
            label="DLQ Unresolved"
            value={dlqCount}
            sub="baris gagal di queue"
            color={parseInt(dlqCount) > 0 ? "text-red-400" : "text-emerald-400"}
          />
          <KPICard
            label="Ingestion (7 hari)"
            value={failRisk ? `⚠` : `✓`}
            sub={failRisk ? failRisk.title : "upload berjalan normal"}
            color={failRisk ? "text-amber-400" : "text-emerald-400"}
          />
        </div>

        {/* ── Next Best Action ── */}
        <Card className="bg-slate-900 border-slate-700">
          <CardContent className="p-5 space-y-4">
            <div className="flex items-center gap-2">
              <Zap className="h-4 w-4 text-blue-400" />
              <span className="text-sm font-bold text-slate-100">TINDAKAN BERIKUTNYA</span>
              <span className="text-xs text-slate-500 ml-auto">satu prioritas · satu tindakan</span>
            </div>

            {/* Primary action — full-width prominent */}
            {top3Risks[0] && (
              <div className={`rounded-xl border-2 ${SEVERITY_MAP[top3Risks[0].severity].border} ${SEVERITY_MAP[top3Risks[0].severity].bg} p-5`}>
                <div className="flex items-start justify-between gap-3 mb-3">
                  <div>
                    <span className={`text-xs font-bold px-2 py-0.5 rounded ${SEVERITY_MAP[top3Risks[0].severity].badge}`}>
                      PRIORITAS UTAMA · {SEVERITY_MAP[top3Risks[0].severity].label}
                    </span>
                    <p className="text-base font-bold text-slate-100 mt-2">{top3Risks[0].title}</p>
                    <p className="text-xs text-slate-400 mt-1">{top3Risks[0].reason}</p>
                  </div>
                  {(() => { const Icon = SEVERITY_MAP[top3Risks[0].severity].icon; return <Icon className={`h-6 w-6 flex-shrink-0 ${SEVERITY_MAP[top3Risks[0].severity].iconCls}`} />; })()}
                </div>
                <Link href={top3Risks[0].href}>
                  <Button className="w-full bg-blue-600 hover:bg-blue-700 text-white text-sm gap-2">
                    {top3Risks[0].action} <ArrowRight className="h-4 w-4" />
                  </Button>
                </Link>
              </div>
            )}

            {/* #2 and #3 side by side */}
            {top3Risks.length > 1 && (
              <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                {top3Risks.slice(1).map((t, i) => (
                  <ActionCard key={t.taskId} task={t} rank={i + 2} />
                ))}
              </div>
            )}

            {/* Recommended action banner */}
            <div className="bg-slate-800 rounded-lg p-3 border border-slate-700">
              <p className="text-xs text-slate-400 mb-0.5">Rekomendasi sistem</p>
              <p className="text-sm text-slate-200 font-medium">{recommendedAction}</p>
            </div>
          </CardContent>
        </Card>

        {/* ── Quick Links ── */}
        <div className="flex flex-wrap gap-2">
          {[
            { label: "Upload",      href: "/logistics/fleet-intelligence/upload",      icon: <ArrowUpCircle className="h-3.5 w-3.5" /> },
            { label: "Transaksi",   href: "/logistics/fleet-intelligence/transactions", icon: <Layers className="h-3.5 w-3.5" /> },
            { label: "Analitik",    href: "/logistics/fleet-intelligence/analytics",   icon: <TrendingUp className="h-3.5 w-3.5" /> },
            { label: "Alerts",      href: "/logistics/fleet-intelligence/alerts",       icon: <Zap className="h-3.5 w-3.5" /> },
            { label: "Akuntansi",   href: "/logistics/fleet-intelligence/accounting",   icon: <Database className="h-3.5 w-3.5" /> },
            { label: "Validasi",    href: "/logistics/fleet-intelligence/validation",   icon: <CheckCircle className="h-3.5 w-3.5" /> },
            { label: "Driver",      href: "/logistics/fleet-intelligence/drivers",      icon: <Users className="h-3.5 w-3.5" /> },
          ].map((l) => (
            <Link key={l.href} href={l.href}>
              <Button size="sm" variant="outline" className="border-slate-700 text-slate-400 hover:bg-slate-800 text-xs gap-1.5">
                {l.icon}{l.label}
              </Button>
            </Link>
          ))}
        </div>

        {/* ── Details (collapsed by default) ── */}
        <div>
          <button
            onClick={() => setShowDetails(!showDetails)}
            className="flex items-center gap-2 text-xs text-slate-400 hover:text-slate-200 transition-colors w-full py-2"
          >
            {showDetails ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
            <span>{showDetails ? "Sembunyikan" : "Tampilkan"} detail metrik sistem</span>
            <span className="ml-auto text-slate-600">queue · DLQ · rekonsiliasi · batas sistem · volume data</span>
          </button>

          {showDetails && (
            <div className="space-y-4 mt-2 border-t border-slate-800 pt-4">
              {!overview ? (
                <div className="flex items-center gap-2 text-xs text-slate-500 py-4">
                  <RefreshCw className="h-4 w-4 animate-spin" /> Memuat detail...
                </div>
              ) : (
                <>
                  {/* Detail grid */}
                  <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                    {[
                      { label: "Pending",    value: overview.ingestionQueue.pending,    color: "text-slate-300" },
                      { label: "Processing", value: overview.ingestionQueue.processing, color: "text-blue-400" },
                      { label: "Completed",  value: overview.ingestionQueue.completed,  color: "text-emerald-400" },
                      { label: "Failed",     value: overview.ingestionQueue.failed,     color: "text-red-400" },
                    ].map(s => (
                      <div key={s.label} className="bg-slate-800 rounded-lg p-3 text-center">
                        <div className={`text-2xl font-bold ${s.color}`}>{fmtNum(s.value)}</div>
                        <div className="text-xs text-slate-500 mt-0.5">{s.label}</div>
                      </div>
                    ))}
                  </div>

                  <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                    {/* DLQ detail */}
                    <Card className="bg-slate-900 border-slate-700">
                      <CardContent className="p-4 space-y-2">
                        <div className="flex items-center gap-1.5 text-xs text-slate-400 font-medium mb-2">
                          <AlertTriangle className="h-3.5 w-3.5" /> Dead Letter Queue
                        </div>
                        <div className="flex justify-between items-baseline">
                          <span className={`text-2xl font-black ${overview.dlq.unresolved > 0 ? "text-red-400" : "text-emerald-400"}`}>
                            {fmtNum(overview.dlq.unresolved)}
                          </span>
                          <span className="text-xs text-slate-500">{fmtNum(overview.dlq.resolved)} resolved · {fmtNum(overview.dlq.total)} total</span>
                        </div>
                        <SatBar value={overview.dlq.pressure} label="DLQ pressure" />
                        {overview.dlq.unresolved > 0 && (
                          <Link href="/logistics/fleet-intelligence/upload">
                            <Button size="sm" variant="outline" className="w-full border-red-700 text-red-400 hover:bg-red-900/30 text-xs mt-1">
                              Kelola DLQ →
                            </Button>
                          </Link>
                        )}
                      </CardContent>
                    </Card>

                    {/* Reconciliation detail */}
                    <Card className="bg-slate-900 border-slate-700">
                      <CardContent className="p-4 space-y-2">
                        <div className="flex items-center gap-1.5 text-xs text-slate-400 font-medium mb-2">
                          <Database className="h-3.5 w-3.5" /> Rekonsiliasi
                        </div>
                        <div className="flex items-center gap-2">
                          {overview.reconciliation.status === "ok"
                            ? <CheckCircle className="h-5 w-5 text-emerald-400" />
                            : <AlertTriangle className="h-5 w-5 text-amber-400" />}
                          <span className="text-sm font-semibold text-slate-200">
                            {overview.reconciliation.status === "ok" ? "In Sync" : overview.reconciliation.status === "warn" ? "Minor Gaps" : "Out of Sync"}
                          </span>
                        </div>
                        <p className="text-xs text-slate-400">{overview.reconciliation.message}</p>
                        {overview.reconciliation.summaryMismatches > 0 && (
                          <Button size="sm" onClick={() => reconcileMutation.mutate()} disabled={reconcileMutation.isPending}
                            className="w-full bg-amber-700 hover:bg-amber-800 text-white text-xs mt-1">
                            {reconcileMutation.isPending ? "Proses..." : "Rekonsiliasi Sekarang"}
                          </Button>
                        )}
                      </CardContent>
                    </Card>
                  </div>

                  {/* System bounds */}
                  <Card className="bg-slate-900 border-slate-700">
                    <CardContent className="p-4">
                      <div className="flex items-center gap-1.5 text-xs text-slate-400 font-medium mb-3">
                        <Car className="h-3.5 w-3.5" /> Batas Sistem
                      </div>
                      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                        {[
                          { label: "Queue",    key: "maxQueueSize",          current: overview.ingestionQueue.pending + overview.ingestionQueue.processing },
                          { label: "DLQ",      key: "maxDlqRows",            current: overview.dlq.unresolved },
                          { label: "Driver",   key: "maxActiveDrivers",      current: overview.drivers.active },
                          { label: "TX/Hari",  key: "maxTransactionsPerDay", current: overview.transactions.todayCount },
                        ].map(b => {
                          const limit = overview.systemBounds.limits[b.key] ?? 0;
                          const pct = limit > 0 ? Math.min(Math.round((b.current / limit) * 100), 100) : 0;
                          const bar = pct >= 80 ? "bg-red-500" : pct >= 50 ? "bg-yellow-500" : "bg-emerald-500";
                          const txt = pct >= 80 ? "text-red-400" : pct >= 50 ? "text-yellow-400" : "text-emerald-400";
                          return (
                            <div key={b.key}>
                              <div className="flex justify-between text-xs text-slate-400 mb-1">
                                <span>{b.label}</span><span className={txt}>{pct}%</span>
                              </div>
                              <div className="h-2 rounded-full bg-slate-700 overflow-hidden">
                                <div className={`h-full rounded-full ${bar}`} style={{ width: `${pct}%` }} />
                              </div>
                              <div className="text-xs text-slate-500 mt-1 font-mono">{fmtNum(b.current)}/{fmtNum(limit)}</div>
                            </div>
                          );
                        })}
                      </div>
                    </CardContent>
                  </Card>

                  {/* Volume data */}
                  <div className="grid grid-cols-2 gap-3">
                    <Card className="bg-slate-900 border-slate-700">
                      <CardContent className="p-4">
                        <div className="text-xs text-slate-400 mb-2 flex items-center gap-1.5">
                          <Layers className="h-3.5 w-3.5" /> Transaksi
                        </div>
                        <div className="text-2xl font-bold text-slate-200">{fmtNum(overview.transactions.total)}</div>
                        <div className="text-xs text-slate-500 mt-1">hari ini: {fmtNum(overview.transactions.todayCount)}</div>
                      </CardContent>
                    </Card>
                    <Card className="bg-slate-900 border-slate-700">
                      <CardContent className="p-4">
                        <div className="text-xs text-slate-400 mb-2 flex items-center gap-1.5">
                          <Users className="h-3.5 w-3.5" /> Driver
                        </div>
                        <div className="flex gap-4">
                          <div><span className="text-2xl font-bold text-emerald-400">{fmtNum(overview.drivers.active)}</span><span className="text-xs text-slate-500 ml-1">aktif</span></div>
                          <div><span className="text-2xl font-bold text-red-400">{fmtNum(overview.drivers.suspended)}</span><span className="text-xs text-slate-500 ml-1">suspend</span></div>
                        </div>
                      </CardContent>
                    </Card>
                  </div>

                  {/* Alerts summary in details */}
                  {overview.alerts.totalUnread > 0 && (
                    <Card className="bg-slate-900 border-slate-700">
                      <CardContent className="p-4 flex items-center justify-between">
                        <div className="flex items-center gap-3">
                          <Zap className={`h-5 w-5 ${overview.alerts.criticalUnread > 0 ? "text-red-400" : "text-amber-400"}`} />
                          <div>
                            <span className="text-sm font-semibold text-slate-200">{fmtNum(overview.alerts.totalUnread)} alert belum dibaca</span>
                            {overview.alerts.criticalUnread > 0 && (
                              <p className="text-xs text-red-400">{fmtNum(overview.alerts.criticalUnread)} kritis</p>
                            )}
                          </div>
                        </div>
                        <Link href="/logistics/fleet-intelligence/alerts">
                          <Button size="sm" variant="outline" className="border-slate-600 text-slate-300 text-xs">
                            Lihat Alerts <ArrowRight className="h-3.5 w-3.5 ml-1" />
                          </Button>
                        </Link>
                      </CardContent>
                    </Card>
                  )}
                </>
              )}
            </div>
          )}
        </div>

      </div>
    </AppShell>
  );
}
