import { DatePicker } from "@/components/ui/date-picker";
import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { api } from "@/lib/api";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer,
  PieChart, Pie, Cell, Legend, FunnelChart, Funnel, LabelList,
} from "recharts";
import {
  TrendingUp, Package, Truck, Clock, Percent, RefreshCw, AlertTriangle,
  CheckCircle, Trophy, ArrowDown, BarChart2, ShieldAlert, Users, ArrowLeft,
} from "lucide-react";

// ── Formatters ────────────────────────────────────────────────────────────────
const IDR = (n: number | string | null) => {
  const v = Number(n ?? 0);
  if (v >= 1_000_000_000) return `Rp ${(v / 1_000_000_000).toFixed(1)}M`;
  if (v >= 1_000_000) return `Rp ${(v / 1_000_000).toFixed(1)} Jt`;
  if (v >= 1_000) return `Rp ${(v / 1_000).toFixed(0)} Rb`;
  return `Rp ${v.toLocaleString("id-ID")}`;
};
const PCT = (n: number | string | null) => `${Number(n ?? 0).toFixed(1)}%`;
const HRS = (n: number | string | null) => {
  const h = Number(n ?? 0);
  if (h < 1) return `${Math.round(h * 60)} mnt`;
  if (h < 24) return `${h.toFixed(1)} jam`;
  return `${(h / 24).toFixed(1)} hari`;
};

const MODE_COLORS: Record<string, string> = { trucking: "#6366f1", pickup_self: "#22c55e" };
const STATUS_COLORS = ["#6366f1","#22c55e","#f59e0b","#ef4444","#3b82f6","#8b5cf6","#ec4899","#14b8a6","#f97316","#84cc16"];
const SEV_CLASS: Record<string, string> = {
  critical: "text-red-400 border-red-500/30 bg-red-500/10",
  high:     "text-orange-400 border-orange-500/30 bg-orange-500/10",
  medium:   "text-yellow-400 border-yellow-500/30 bg-yellow-500/10",
  low:      "text-slate-400 border-slate-600",
};
const EXCEPTION_LABELS: Record<string, string> = {
  product_vendor_rejected:   "Vendor Ditolak",
  product_stock_not_available: "Stok Tidak Tersedia",
  product_ready_date_delayed: "Ready Date Delay",
  shipment_not_selected:     "Shipment Belum Dipilih",
  shipment_rfq_no_response:  "RFQ Tidak Direspons",
  pickup_self_overdue:       "Pickup Overdue",
};
const EXCEPTION_COLORS: Record<string, string> = {
  product_vendor_rejected:   "#ef4444",
  product_stock_not_available: "#f97316",
  product_ready_date_delayed: "#f59e0b",
  shipment_not_selected:     "#8b5cf6",
  shipment_rfq_no_response:  "#3b82f6",
  pickup_self_overdue:       "#ec4899",
};
const FUNNEL_COLORS = ["#6366f1","#7c3aed","#9333ea","#a855f7","#c084fc","#e879f9","#f0abfc","#f5d0fe","#fae8ff"];

// ── Helper: SLA status indicator ──────────────────────────────────────────────
function SlaBar({ avgH, targetH }: { avgH: number; targetH: number | null }) {
  if (!targetH) return <span className="text-slate-500 text-xs">No target</span>;
  const pct = Math.min(avgH / targetH * 100, 150);
  const breached = avgH > targetH;
  return (
    <div className="flex items-center gap-2 mt-1">
      <div className="flex-1 bg-slate-700 rounded-full h-1.5 overflow-hidden">
        <div
          className={`h-full rounded-full transition-all ${breached ? "bg-red-500" : "bg-emerald-500"}`}
          style={{ width: `${Math.min(pct, 100)}%` }}
        />
      </div>
      <span className={`text-xs font-mono font-medium ${breached ? "text-red-400" : "text-emerald-400"}`}>
        {breached ? "✗ Breached" : "✓ On Time"}
      </span>
    </div>
  );
}

// ── Main page ─────────────────────────────────────────────────────────────────
export default function ProductFirstAnalyticsPage() {
  const today = new Date().toISOString().slice(0, 10);
  const ninetyDaysAgo = new Date(Date.now() - 90 * 86400000).toISOString().slice(0, 10);

  const [dateFrom, setDateFrom] = useState(ninetyDaysAgo);
  const [dateTo, setDateTo] = useState(today);
  const [filterApplied, setFilterApplied] = useState({ dateFrom: ninetyDaysAgo, dateTo: today });
  const [tab, setTab] = useState("funnel");

  const params = new URLSearchParams({ dateFrom: filterApplied.dateFrom, dateTo: filterApplied.dateTo });

  // ── Queries ─────────────────────────────────────────────────────────────────
  const summaryQ = useQuery({
    queryKey: ["pf-analytics-summary2", filterApplied],
    queryFn: () => api.get(`/api/logistic/product-first/analytics/summary?${params}`).then(r => r.data),
  });
  const funnelQ = useQuery({
    queryKey: ["pf-analytics-funnel", filterApplied],
    queryFn: () => api.get(`/api/logistic/product-first/analytics/funnel?${params}`).then(r => r.data),
  });
  const slaQ = useQuery({
    queryKey: ["pf-analytics-sla-detail", filterApplied],
    queryFn: () => api.get(`/api/logistic/product-first/analytics/sla-detail?${params}`).then(r => r.data),
  });
  const blockedQ = useQuery({
    queryKey: ["pf-analytics-blocked-exception", filterApplied],
    queryFn: () => api.get(`/api/logistic/product-first/analytics/blocked-by-exception?${params}`).then(r => r.data),
  });
  const rankingQ = useQuery({
    queryKey: ["pf-analytics-vendor-ranking", filterApplied],
    queryFn: () => api.get(`/api/logistic/product-first/analytics/vendor-ranking?${params}`).then(r => r.data),
  });
  const modeQ = useQuery({
    queryKey: ["pf-analytics-mode2", filterApplied],
    queryFn: () => api.get(`/api/logistic/product-first/analytics/mode-ratio?${params}`).then(r => r.data),
  });
  const marginQ = useQuery({
    queryKey: ["pf-analytics-margin2", filterApplied],
    queryFn: () => api.get(`/api/logistic/product-first/analytics/margin?${params}`).then(r => r.data),
  });

  const totals: any = (summaryQ.data as any)?.totals ?? {};
  const funnelData: any[] = (funnelQ.data as any)?.funnel ?? [];
  const slaData: any[] = (slaQ.data as any)?.sla ?? [];
  const blockedTotal = (blockedQ.data as any)?.summary?.totalOpen ?? 0;
  const vendors: any[] = (rankingQ.data as any)?.vendors ?? [];

  function applyFilter() { setFilterApplied({ dateFrom, dateTo }); }
  function refetchAll() {
    summaryQ.refetch(); funnelQ.refetch(); slaQ.refetch();
    blockedQ.refetch(); rankingQ.refetch(); modeQ.refetch(); marginQ.refetch();
  }

  // Derived: funnel recharts data (custom horizontal bars)
  const funnelMax = funnelData[0]?.count || 1;
  const exceptionByType: any[] = (blockedQ.data as any)?.byType ?? [];

  return (
    <div className="p-6 space-y-6">
      {/* ── Header ── */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <button onClick={() => window.history.back()} aria-label="Kembali" className="shrink-0 rounded-md p-1.5 text-slate-400 hover:text-white hover:bg-slate-700 transition-colors">
            <ArrowLeft className="w-4 h-4" />
          </button>
          <div>
            <h1 className="text-2xl font-bold text-white flex items-center gap-2">
              <TrendingUp className="w-6 h-6 text-indigo-400" />
              Analytics — Product-First Orders
            </h1>
            <p className="text-sm text-slate-400 mt-1">
              Funnel · SLA · Blocked Orders · Vendor Ranking
            </p>
          </div>
        </div>
        <Button variant="outline" size="sm" onClick={refetchAll}
          className="gap-2 border-slate-600 text-slate-300 hover:text-white">
          <RefreshCw className="w-4 h-4" /> Refresh
        </Button>
      </div>

      {/* ── Date Filter ── */}
      <Card className="bg-slate-800/50 border-slate-700">
        <CardContent className="pt-4 pb-4">
          <div className="flex flex-wrap gap-4 items-end">
            <div className="space-y-1">
              <Label className="text-xs text-slate-400">Dari Tanggal</Label>
              <DatePicker value={dateFrom} onChange={v => setDateFrom(v)}
                className="bg-slate-700 border-slate-600 text-white h-8 w-40" />
            </div>
            <div className="space-y-1">
              <Label className="text-xs text-slate-400">Sampai Tanggal</Label>
              <DatePicker value={dateTo} onChange={v => setDateTo(v)}
                className="bg-slate-700 border-slate-600 text-white h-8 w-40" />
            </div>
            <Button size="sm" onClick={applyFilter} className="bg-indigo-600 hover:bg-indigo-500 text-white">
              Terapkan
            </Button>
          </div>
        </CardContent>
      </Card>

      {/* ── KPI Cards ── */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <Card className="bg-slate-800/60 border-slate-700">
          <CardContent className="pt-4">
            <div className="flex items-center gap-2 text-slate-400 text-xs mb-1">
              <Package className="w-3.5 h-3.5" /> Total Orders
            </div>
            <div className="text-2xl font-bold text-white">{totals.total ?? 0}</div>
            <div className="flex gap-2 mt-1 text-xs">
              <span className="text-emerald-400">{totals.completed ?? 0} selesai</span>
              <span className="text-blue-400">{totals.active ?? 0} aktif</span>
            </div>
          </CardContent>
        </Card>

        <Card className="bg-slate-800/60 border-slate-700">
          <CardContent className="pt-4">
            <div className="flex items-center gap-2 text-slate-400 text-xs mb-1">
              <TrendingUp className="w-3.5 h-3.5" /> Funnel Conversion
            </div>
            <div className="text-2xl font-bold text-white">
              {funnelData.length > 0 && funnelData[funnelData.length - 1]?.count && funnelData[0]?.count
                ? PCT(funnelData[funnelData.length - 1].count / funnelData[0].count * 100)
                : "—"}
            </div>
            <div className="text-xs text-slate-400">Order Received → Completed</div>
          </CardContent>
        </Card>

        <Card className="bg-slate-800/60 border-slate-700">
          <CardContent className="pt-4">
            <div className="flex items-center gap-2 text-slate-400 text-xs mb-1">
              <ShieldAlert className="w-3.5 h-3.5" /> Open Exceptions
            </div>
            <div className={`text-2xl font-bold ${blockedTotal > 0 ? "text-red-400" : "text-emerald-400"}`}>
              {blockedTotal}
            </div>
            <div className="text-xs text-slate-400">
              {exceptionByType.length} tipe exception aktif
            </div>
          </CardContent>
        </Card>

        <Card className="bg-slate-800/60 border-slate-700">
          <CardContent className="pt-4">
            <div className="flex items-center gap-2 text-slate-400 text-xs mb-1">
              <Trophy className="w-3.5 h-3.5" /> Top Vendor Win Rate
            </div>
            <div className="text-2xl font-bold text-white">
              {vendors.length > 0 ? PCT(vendors[0]?.win_rate_pct) : "—"}
            </div>
            <div className="text-xs text-slate-400 truncate">
              {vendors[0]?.vendor_name ?? "—"}
            </div>
          </CardContent>
        </Card>
      </div>

      {/* ── Tabs ── */}
      <Tabs value={tab} onValueChange={setTab}>
        <TabsList className="bg-slate-800 border border-slate-700 flex-wrap h-auto gap-1 p-1">
          <TabsTrigger value="funnel"   className="text-xs data-[state=active]:bg-slate-700">Funnel</TabsTrigger>
          <TabsTrigger value="sla"      className="text-xs data-[state=active]:bg-slate-700">SLA</TabsTrigger>
          <TabsTrigger value="blocked"  className="text-xs data-[state=active]:bg-slate-700">
            Blocked
            {blockedTotal > 0 && (
              <span className="ml-1 text-red-400 font-bold">{blockedTotal}</span>
            )}
          </TabsTrigger>
          <TabsTrigger value="ranking"  className="text-xs data-[state=active]:bg-slate-700">Vendor Ranking</TabsTrigger>
          <TabsTrigger value="overview" className="text-xs data-[state=active]:bg-slate-700">Overview</TabsTrigger>
        </TabsList>

        {/* ═══════════════════════════════════════════════════════════════════
            TAB: FUNNEL
        ═══════════════════════════════════════════════════════════════════ */}
        <TabsContent value="funnel" className="space-y-4">
          <Card className="bg-slate-800/60 border-slate-700">
            <CardHeader className="pb-2">
              <CardTitle className="text-sm text-slate-300 font-medium flex items-center gap-2">
                <ArrowDown className="w-4 h-4 text-indigo-400" /> Product-First Order Funnel
              </CardTitle>
            </CardHeader>
            <CardContent>
              {funnelQ.isLoading && <div className="text-slate-400 text-sm py-8 text-center">Memuat funnel...</div>}
              {!funnelQ.isLoading && funnelData.length === 0 && (
                <div className="text-slate-500 text-sm py-8 text-center">Belum ada data funnel</div>
              )}
              {funnelData.length > 0 && (
                <div className="space-y-2 mt-2">
                  {funnelData.map((row, i) => {
                    const barW = funnelMax > 0 ? Math.max(row.count / funnelMax * 100, 4) : 4;
                    return (
                      <div key={row.stage} className="group">
                        <div className="flex items-center gap-3 mb-0.5">
                          <div className="w-48 text-xs text-slate-300 shrink-0 truncate" title={row.stage}>
                            <span className="text-slate-500 mr-1">{i + 1}.</span> {row.stage}
                          </div>
                          <div className="flex-1 relative h-7 bg-slate-700/40 rounded overflow-hidden">
                            <div
                              className="h-full rounded transition-all duration-500"
                              style={{ width: `${barW}%`, backgroundColor: FUNNEL_COLORS[i % FUNNEL_COLORS.length] + "cc" }}
                            />
                            <span className="absolute left-2 top-0 h-full flex items-center text-xs font-mono font-medium text-white">
                              {row.count.toLocaleString("id-ID")}
                            </span>
                          </div>
                          <div className="w-32 text-right shrink-0 space-x-2">
                            <Badge variant="outline" className="text-xs border-indigo-500/30 text-indigo-400 bg-indigo-500/10">
                              {PCT(row.conversionPct)}
                            </Badge>
                            {row.dropOffPct > 0 && (
                              <Badge variant="outline" className="text-xs border-red-500/30 text-red-400 bg-red-500/10">
                                -{PCT(row.dropOffPct)}
                              </Badge>
                            )}
                          </div>
                        </div>
                        {i < funnelData.length - 1 && (
                          <div className="ml-48 pl-3 text-xs text-slate-600 flex items-center gap-1 h-3">
                            <div className="h-3 border-l border-dashed border-slate-600 ml-1" />
                            <ArrowDown className="w-2.5 h-2.5 text-slate-600" />
                            {funnelData[i].count - funnelData[i + 1].count > 0 && (
                              <span className="text-slate-600">
                                -{(funnelData[i].count - funnelData[i + 1].count).toLocaleString("id-ID")} drop
                              </span>
                            )}
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              )}
            </CardContent>
          </Card>

          {/* Funnel as recharts BarChart (horizontal) */}
          {funnelData.length > 0 && (
            <Card className="bg-slate-800/60 border-slate-700">
              <CardHeader className="pb-2">
                <CardTitle className="text-sm text-slate-300 font-medium">Conversion % per Stage</CardTitle>
              </CardHeader>
              <CardContent>
                <ResponsiveContainer width="100%" height={260}>
                  <BarChart data={funnelData} layout="vertical" margin={{ left: 4, right: 48, top: 4, bottom: 4 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke="#334155" />
                    <XAxis type="number" domain={[0, 100]} tick={{ fill: "#94a3b8", fontSize: 11 }}
                      tickFormatter={v => `${v}%`} />
                    <YAxis type="category" dataKey="stage" width={190}
                      tick={{ fill: "#94a3b8", fontSize: 10 }} />
                    <Tooltip
                      contentStyle={{ background: "#1e293b", border: "1px solid #334155", borderRadius: 6 }}
                      labelStyle={{ color: "#e2e8f0" }}
                      formatter={(v: any, name: string) =>
                        name === "conversionPct" ? [`${v}%`, "Conversion"] :
                        name === "dropOffPct" ? [`${v}%`, "Drop-off"] : [v, name]
                      }
                    />
                    <Bar dataKey="conversionPct" name="Conversion %" radius={[0, 4, 4, 0]} fill="#6366f1">
                      <LabelList dataKey="conversionPct" position="right" formatter={(v: any) => `${v}%`}
                        style={{ fill: "#c7d2fe", fontSize: 11 }} />
                    </Bar>
                  </BarChart>
                </ResponsiveContainer>
              </CardContent>
            </Card>
          )}
        </TabsContent>

        {/* ═══════════════════════════════════════════════════════════════════
            TAB: SLA
        ═══════════════════════════════════════════════════════════════════ */}
        <TabsContent value="sla" className="space-y-4">
          <Card className="bg-slate-800/60 border-slate-700">
            <CardHeader className="pb-2">
              <CardTitle className="text-sm text-slate-300 font-medium flex items-center gap-2">
                <Clock className="w-4 h-4 text-amber-400" /> SLA per Phase (Avg Time)
              </CardTitle>
            </CardHeader>
            <CardContent>
              {slaQ.isLoading && <div className="text-slate-400 text-sm py-8 text-center">Memuat data SLA...</div>}
              <div className="space-y-3">
                {slaData.map((s: any) => (
                  <div key={s.label} className="p-3 rounded-lg bg-slate-700/40">
                    <div className="flex items-start justify-between gap-3">
                      <div className="flex-1 min-w-0">
                        <div className="text-sm font-medium text-slate-200">{s.label}</div>
                        <div className="text-xs text-slate-500 mt-0.5 truncate">
                          {s.from} → {s.to}
                        </div>
                        {s.targetHours && (
                          <SlaBar avgH={s.avgHours} targetH={s.targetHours} />
                        )}
                      </div>
                      <div className="text-right shrink-0">
                        <div className={`text-lg font-mono font-bold ${
                          !s.targetHours ? "text-slate-300"
                          : s.slaStatus === "on_time" ? "text-emerald-400"
                          : "text-red-400"
                        }`}>
                          {s.ordersMeasured > 0 ? HRS(s.avgHours) : "—"}
                        </div>
                        {s.targetHours && (
                          <div className="text-xs text-slate-500">target {HRS(s.targetHours)}</div>
                        )}
                        <div className="text-xs text-slate-600 mt-0.5">{s.ordersMeasured} orders</div>
                      </div>
                    </div>
                    {s.ordersMeasured > 0 && (
                      <div className="flex gap-4 mt-2 text-xs text-slate-500 border-t border-slate-600/50 pt-2">
                        <span>Min: <span className="text-slate-400 font-mono">{HRS(s.minHours)}</span></span>
                        <span>Median: <span className="text-slate-400 font-mono">{HRS(s.medianHours)}</span></span>
                        <span>Max: <span className="text-slate-400 font-mono">{HRS(s.maxHours)}</span></span>
                      </div>
                    )}
                  </div>
                ))}
                {!slaQ.isLoading && slaData.length === 0 && (
                  <div className="text-center text-slate-500 text-sm py-8">Belum ada data SLA</div>
                )}
              </div>
            </CardContent>
          </Card>

          {/* SLA bar chart */}
          {slaData.filter(s => s.ordersMeasured > 0).length > 0 && (
            <Card className="bg-slate-800/60 border-slate-700">
              <CardHeader className="pb-2">
                <CardTitle className="text-sm text-slate-300 font-medium">Avg Hours per Phase</CardTitle>
              </CardHeader>
              <CardContent>
                <ResponsiveContainer width="100%" height={220}>
                  <BarChart data={slaData.filter(s => s.ordersMeasured > 0)} margin={{ left: 4, right: 16 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke="#334155" />
                    <XAxis dataKey="label" tick={{ fill: "#94a3b8", fontSize: 10 }} />
                    <YAxis tick={{ fill: "#94a3b8", fontSize: 11 }} tickFormatter={v => `${v}h`} />
                    <Tooltip
                      contentStyle={{ background: "#1e293b", border: "1px solid #334155", borderRadius: 6 }}
                      labelStyle={{ color: "#e2e8f0" }}
                      formatter={(v: any) => [`${v} jam`, "Avg"]}
                    />
                    <Bar dataKey="avgHours" name="Avg Jam" radius={[4, 4, 0, 0]}>
                      {slaData.filter(s => s.ordersMeasured > 0).map((s: any, i: number) => (
                        <Cell key={i} fill={
                          !s.targetHours ? "#64748b"
                          : s.slaStatus === "on_time" ? "#22c55e" : "#ef4444"
                        } />
                      ))}
                    </Bar>
                  </BarChart>
                </ResponsiveContainer>
              </CardContent>
            </Card>
          )}
        </TabsContent>

        {/* ═══════════════════════════════════════════════════════════════════
            TAB: BLOCKED
        ═══════════════════════════════════════════════════════════════════ */}
        <TabsContent value="blocked" className="space-y-4">
          {/* Summary cards per exception type */}
          <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
            {exceptionByType.length === 0 && !blockedQ.isLoading && (
              <div className="col-span-full flex flex-col items-center py-8 text-slate-500 gap-2">
                <CheckCircle className="w-8 h-8 text-emerald-500/40" />
                <span className="text-sm">Tidak ada open exceptions ✓</span>
              </div>
            )}
            {exceptionByType.map((exc: any) => (
              <Card key={exc.exception_type} className="bg-slate-800/60 border-slate-700">
                <CardContent className="pt-3 pb-3">
                  <div className="flex items-start justify-between gap-2">
                    <div>
                      <div className="text-xs text-slate-400 mb-1">
                        {EXCEPTION_LABELS[exc.exception_type] ?? exc.exception_type.replace(/_/g, " ")}
                      </div>
                      <div className="text-2xl font-bold text-white">{exc.open_count}</div>
                      <Badge variant="outline" className={`text-xs mt-1 ${SEV_CLASS[exc.severity] ?? ""}`}>
                        {exc.severity}
                      </Badge>
                    </div>
                    <div
                      className="w-2 h-12 rounded-full shrink-0"
                      style={{ backgroundColor: EXCEPTION_COLORS[exc.exception_type] ?? "#64748b" }}
                    />
                  </div>
                </CardContent>
              </Card>
            ))}
          </div>

          {/* Exception bar chart */}
          {exceptionByType.length > 0 && (
            <Card className="bg-slate-800/60 border-slate-700">
              <CardHeader className="pb-2">
                <CardTitle className="text-sm text-slate-300 font-medium">Open Exceptions per Tipe</CardTitle>
              </CardHeader>
              <CardContent>
                <ResponsiveContainer width="100%" height={200}>
                  <BarChart data={exceptionByType.map(e => ({
                    ...e,
                    label: EXCEPTION_LABELS[e.exception_type] ?? e.exception_type,
                  }))} margin={{ left: 4, right: 16 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke="#334155" />
                    <XAxis dataKey="label" tick={{ fill: "#94a3b8", fontSize: 9 }} />
                    <YAxis tick={{ fill: "#94a3b8", fontSize: 11 }} allowDecimals={false} />
                    <Tooltip
                      contentStyle={{ background: "#1e293b", border: "1px solid #334155", borderRadius: 6 }}
                      labelStyle={{ color: "#e2e8f0" }}
                    />
                    <Bar dataKey="open_count" name="Open" radius={[4, 4, 0, 0]}>
                      {exceptionByType.map((e: any, i: number) => (
                        <Cell key={i} fill={EXCEPTION_COLORS[e.exception_type] ?? "#64748b"} />
                      ))}
                    </Bar>
                  </BarChart>
                </ResponsiveContainer>
              </CardContent>
            </Card>
          )}

          {/* Historical summary */}
          {((blockedQ.data as any)?.historySummary?.length ?? 0) > 0 && (
            <Card className="bg-slate-800/60 border-slate-700">
              <CardHeader className="pb-2">
                <CardTitle className="text-sm text-slate-300 font-medium">Riwayat Exceptions (semua waktu)</CardTitle>
              </CardHeader>
              <CardContent>
                <div className="space-y-2">
                  {((blockedQ.data as any)?.historySummary ?? []).map((h: any) => {
                    const resolvePct = h.total_count > 0 ? Math.round(h.resolved_count / h.total_count * 100) : 0;
                    return (
                      <div key={h.exception_type} className="flex items-center justify-between text-sm p-2 rounded bg-slate-700/30">
                        <span className="text-slate-300 text-xs">
                          {EXCEPTION_LABELS[h.exception_type] ?? h.exception_type.replace(/_/g, " ")}
                        </span>
                        <div className="flex items-center gap-3 text-xs">
                          <span className="text-slate-400">{h.total_count} total</span>
                          <span className="text-emerald-400">{h.resolved_count} resolved</span>
                          <Badge variant="outline" className={`${h.open_count > 0 ? "text-red-400 border-red-500/30 bg-red-500/10" : "text-emerald-400 border-emerald-500/30 bg-emerald-500/10"}`}>
                            {h.open_count} open
                          </Badge>
                          <span className="text-slate-500 font-mono">{resolvePct}% resolved</span>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </CardContent>
            </Card>
          )}

          {/* Recent open exceptions list */}
          {((blockedQ.data as any)?.recentOpen?.length ?? 0) > 0 && (
            <Card className="bg-slate-800/60 border-slate-700">
              <CardHeader className="pb-2">
                <CardTitle className="text-sm text-slate-300 font-medium">Open Exceptions Terbaru</CardTitle>
              </CardHeader>
              <CardContent>
                <div className="space-y-2 max-h-80 overflow-y-auto">
                  {((blockedQ.data as any)?.recentOpen ?? []).map((e: any) => (
                    <div key={e.id} className="p-3 rounded-lg bg-slate-700/40 flex items-start justify-between gap-3">
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 flex-wrap">
                          <Badge variant="outline" className={`text-xs ${SEV_CLASS[e.severity] ?? ""}`}>
                            {e.severity}
                          </Badge>
                          <span className="font-mono text-xs text-indigo-400">{e.order_number}</span>
                          <Badge variant="outline" className="text-xs border-slate-600 text-slate-400">
                            {e.order_status}
                          </Badge>
                        </div>
                        <div className="text-xs text-slate-200 mt-1 truncate">{e.title}</div>
                        <div className="text-xs text-slate-500 mt-0.5">
                          {EXCEPTION_LABELS[e.exception_type] ?? e.exception_type.replace(/_/g, " ")} · {e.customer_name}
                        </div>
                      </div>
                      <div className="text-right shrink-0">
                        <div className={`text-xs font-mono font-medium ${Number(e.hours_open) > 48 ? "text-red-400" : Number(e.hours_open) > 24 ? "text-orange-400" : "text-yellow-400"}`}>
                          {HRS(e.hours_open)} open
                        </div>
                        <div className="text-xs text-slate-600">{e.created_at?.slice(0, 10)}</div>
                      </div>
                    </div>
                  ))}
                </div>
              </CardContent>
            </Card>
          )}
        </TabsContent>

        {/* ═══════════════════════════════════════════════════════════════════
            TAB: VENDOR RANKING
        ═══════════════════════════════════════════════════════════════════ */}
        <TabsContent value="ranking">
          <Card className="bg-slate-800/60 border-slate-700">
            <CardHeader className="pb-2">
              <CardTitle className="text-sm text-slate-300 font-medium flex items-center gap-2">
                <Trophy className="w-4 h-4 text-amber-400" /> Product Vendor Ranking
              </CardTitle>
            </CardHeader>
            <CardContent>
              {rankingQ.isLoading && <div className="text-slate-400 text-sm py-8 text-center">Memuat ranking...</div>}
              {!rankingQ.isLoading && vendors.length === 0 && (
                <div className="text-center text-slate-500 text-sm py-8">
                  Belum ada data vendor produk
                </div>
              )}
              {vendors.length > 0 && (
                <>
                  {/* Table */}
                  <div className="overflow-x-auto">
                    <table className="w-full text-xs">
                      <thead>
                        <tr className="border-b border-slate-700">
                          <th className="text-left text-slate-400 font-medium pb-2 pr-3">#</th>
                          <th className="text-left text-slate-400 font-medium pb-2 pr-3">Vendor</th>
                          <th className="text-right text-slate-400 font-medium pb-2 pr-3">Orders</th>
                          <th className="text-right text-slate-400 font-medium pb-2 pr-3">
                            <Clock className="w-3 h-3 inline mr-0.5" />Resp. Time
                          </th>
                          <th className="text-right text-slate-400 font-medium pb-2 pr-3">
                            <CheckCircle className="w-3 h-3 inline mr-0.5" />Win Rate
                          </th>
                          <th className="text-right text-slate-400 font-medium pb-2 pr-3">
                            <AlertTriangle className="w-3 h-3 inline mr-0.5" />Rejection
                          </th>
                          <th className="text-right text-slate-400 font-medium pb-2">
                            <Package className="w-3 h-3 inline mr-0.5" />Stock OK
                          </th>
                        </tr>
                      </thead>
                      <tbody>
                        {vendors.map((v: any, i: number) => {
                          const stockOkPct = 100 - Number(v.stock_unavailable_pct ?? 0);
                          const responseH = Number(v.avg_response_hours ?? 0);
                          return (
                            <tr key={v.product_vendor_id} className="border-b border-slate-700/50 hover:bg-slate-700/20">
                              <td className="py-2 pr-3 text-slate-500">
                                {i === 0 ? "🥇" : i === 1 ? "🥈" : i === 2 ? "🥉" : i + 1}
                              </td>
                              <td className="py-2 pr-3 font-medium text-slate-200 max-w-[160px] truncate">
                                {v.vendor_name}
                              </td>
                              <td className="py-2 pr-3 text-right text-slate-400 font-mono">
                                {v.total_orders}
                              </td>
                              <td className="py-2 pr-3 text-right">
                                <span className={`font-mono font-medium ${
                                  !responseH ? "text-slate-500"
                                  : responseH <= 24 ? "text-emerald-400"
                                  : responseH <= 48 ? "text-amber-400"
                                  : "text-red-400"
                                }`}>
                                  {responseH ? HRS(responseH) : "—"}
                                </span>
                              </td>
                              <td className="py-2 pr-3 text-right">
                                <span className={`font-mono font-medium ${
                                  Number(v.win_rate_pct) >= 70 ? "text-emerald-400"
                                  : Number(v.win_rate_pct) >= 40 ? "text-amber-400"
                                  : "text-red-400"
                                }`}>
                                  {PCT(v.win_rate_pct)}
                                </span>
                              </td>
                              <td className="py-2 pr-3 text-right">
                                <span className={`font-mono font-medium ${
                                  Number(v.rejection_rate_pct) <= 10 ? "text-emerald-400"
                                  : Number(v.rejection_rate_pct) <= 30 ? "text-amber-400"
                                  : "text-red-400"
                                }`}>
                                  {PCT(v.rejection_rate_pct)}
                                </span>
                              </td>
                              <td className="py-2 text-right">
                                <span className={`font-mono font-medium ${
                                  stockOkPct >= 90 ? "text-emerald-400"
                                  : stockOkPct >= 70 ? "text-amber-400"
                                  : "text-red-400"
                                }`}>
                                  {PCT(stockOkPct)}
                                </span>
                              </td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>

                  {/* Win Rate chart */}
                  <div className="mt-6">
                    <div className="text-xs text-slate-400 mb-2">Win Rate per Vendor</div>
                    <ResponsiveContainer width="100%" height={180}>
                      <BarChart data={vendors.slice(0, 10).map((v: any) => ({
                        name: v.vendor_name.length > 14 ? v.vendor_name.slice(0, 13) + "…" : v.vendor_name,
                        "Win Rate": Number(v.win_rate_pct),
                        "Rejection": Number(v.rejection_rate_pct),
                      }))} margin={{ left: 4, right: 16 }}>
                        <CartesianGrid strokeDasharray="3 3" stroke="#334155" />
                        <XAxis dataKey="name" tick={{ fill: "#94a3b8", fontSize: 9 }} />
                        <YAxis domain={[0, 100]} tick={{ fill: "#94a3b8", fontSize: 11 }} tickFormatter={v => `${v}%`} />
                        <Tooltip
                          contentStyle={{ background: "#1e293b", border: "1px solid #334155", borderRadius: 6 }}
                          labelStyle={{ color: "#e2e8f0" }}
                          formatter={(v: any, name: string) => [`${v}%`, name]}
                        />
                        <Legend wrapperStyle={{ fontSize: 11, color: "#94a3b8" }} />
                        <Bar dataKey="Win Rate" fill="#22c55e" radius={[4, 4, 0, 0]} />
                        <Bar dataKey="Rejection" fill="#ef4444" radius={[4, 4, 0, 0]} />
                      </BarChart>
                    </ResponsiveContainer>
                  </div>
                </>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        {/* ═══════════════════════════════════════════════════════════════════
            TAB: OVERVIEW (existing charts)
        ═══════════════════════════════════════════════════════════════════ */}
        <TabsContent value="overview" className="space-y-6">
          {/* Status distribution */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            <Card className="bg-slate-800/60 border-slate-700">
              <CardHeader className="pb-2">
                <CardTitle className="text-sm text-slate-300 font-medium">Distribusi Status Saat Ini</CardTitle>
              </CardHeader>
              <CardContent>
                {((summaryQ.data as any)?.byStatus?.length ?? 0) > 0 ? (
                  <ResponsiveContainer width="100%" height={220}>
                    <BarChart data={(summaryQ.data as any).byStatus} layout="vertical" margin={{ left: 8, right: 24 }}>
                      <CartesianGrid strokeDasharray="3 3" stroke="#334155" />
                      <XAxis type="number" tick={{ fill: "#94a3b8", fontSize: 11 }} />
                      <YAxis type="category" dataKey="status" width={160} tick={{ fill: "#94a3b8", fontSize: 10 }} />
                      <Tooltip contentStyle={{ background: "#1e293b", border: "1px solid #334155", borderRadius: 6 }}
                        labelStyle={{ color: "#e2e8f0" }} />
                      <Bar dataKey="count" radius={[0, 4, 4, 0]}>
                        {((summaryQ.data as any)?.byStatus ?? []).map((_: any, i: number) => (
                          <Cell key={i} fill={STATUS_COLORS[i % STATUS_COLORS.length]} />
                        ))}
                      </Bar>
                    </BarChart>
                  </ResponsiveContainer>
                ) : (
                  <div className="flex items-center justify-center h-40 text-slate-500 text-sm">Belum ada data status</div>
                )}
              </CardContent>
            </Card>

            {/* Mode ratio pie */}
            <Card className="bg-slate-800/60 border-slate-700">
              <CardHeader className="pb-2">
                <CardTitle className="text-sm text-slate-300 font-medium">Pickup Self vs Trucking</CardTitle>
              </CardHeader>
              <CardContent>
                {((modeQ.data as any)?.byMode?.length ?? 0) > 0 ? (
                  <ResponsiveContainer width="100%" height={220}>
                    <PieChart>
                      <Pie data={(modeQ.data as any).byMode} dataKey="count" nameKey="shipment_mode"
                        cx="50%" cy="50%" outerRadius={80}
                        label={e => `${e.shipment_mode}: ${e.count} (${e.pct}%)`}>
                        {((modeQ.data as any).byMode as any[]).map((entry: any, i: number) => (
                          <Cell key={i} fill={MODE_COLORS[entry.shipment_mode] ?? "#64748b"} />
                        ))}
                      </Pie>
                      <Legend />
                      <Tooltip formatter={(v: any) => [`${v} orders`, ""]} />
                    </PieChart>
                  </ResponsiveContainer>
                ) : (
                  <div className="flex items-center justify-center h-40 text-slate-500 text-sm">Belum ada data mode</div>
                )}
              </CardContent>
            </Card>
          </div>

          {/* Margin by mode */}
          <Card className="bg-slate-800/60 border-slate-700">
            <CardHeader className="pb-2">
              <CardTitle className="text-sm text-slate-300 font-medium">Margin per Mode Pengiriman</CardTitle>
            </CardHeader>
            <CardContent>
              {((marginQ.data as any)?.byMode?.length ?? 0) > 0 ? (
                <div className="space-y-3">
                  {((marginQ.data as any).byMode as any[]).map((m: any, i: number) => (
                    <div key={i} className="p-3 rounded-lg bg-slate-700/50">
                      <div className="flex items-center justify-between mb-1">
                        <span className="text-sm font-medium text-slate-200 capitalize">
                          {m.shipment_mode === "pickup_self" ? "Pickup Mandiri" : "Trucking"}
                        </span>
                        <Badge className={`text-xs ${Number(m.avg_margin_pct) >= 20
                          ? "bg-emerald-500/20 text-emerald-400 border-emerald-500/30"
                          : "bg-amber-500/20 text-amber-400 border-amber-500/30"}`} variant="outline">
                          {PCT(m.avg_margin_pct)} margin
                        </Badge>
                      </div>
                      <div className="flex gap-4 text-xs text-slate-400">
                        <span>{m.order_count} orders</span>
                        <span>Avg rev: {IDR(m.avg_grand_total)}</span>
                        <span>Gross: {IDR(m.avg_gross_margin)}</span>
                      </div>
                    </div>
                  ))}
                </div>
              ) : (
                <div className="flex items-center justify-center h-24 text-slate-500 text-sm">
                  Belum ada data margin (butuh orders Completed)
                </div>
              )}
            </CardContent>
          </Card>

          {/* Monthly trend */}
          {((summaryQ.data as any)?.byMonth?.length ?? 0) > 0 && (
            <Card className="bg-slate-800/60 border-slate-700">
              <CardHeader className="pb-2">
                <CardTitle className="text-sm text-slate-300 font-medium">Tren Bulanan</CardTitle>
              </CardHeader>
              <CardContent>
                <ResponsiveContainer width="100%" height={180}>
                  <BarChart data={(summaryQ.data as any).byMonth}>
                    <CartesianGrid strokeDasharray="3 3" stroke="#334155" />
                    <XAxis dataKey="month" tick={{ fill: "#94a3b8", fontSize: 11 }} />
                    <YAxis tick={{ fill: "#94a3b8", fontSize: 11 }} />
                    <Tooltip contentStyle={{ background: "#1e293b", border: "1px solid #334155", borderRadius: 6 }}
                      labelStyle={{ color: "#e2e8f0" }} />
                    <Bar dataKey="count" fill="#6366f1" radius={[4, 4, 0, 0]} name="Jumlah Order" />
                  </BarChart>
                </ResponsiveContainer>
              </CardContent>
            </Card>
          )}
        </TabsContent>
      </Tabs>
    </div>
  );
}
