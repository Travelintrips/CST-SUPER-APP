import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { AppShell } from "@/components/layout/AppShell";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Car, AlertTriangle, TrendingUp, Wrench, ArrowLeft } from "lucide-react";
import { Link } from "wouter";
import { toast } from "sonner";
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer,
  RadarChart, Radar, PolarGrid, PolarAngleAxis, PolarRadiusAxis,
} from "recharts";

function fmtIdr(v: unknown) {
  return new Intl.NumberFormat("id-ID", { style: "currency", currency: "IDR", maximumFractionDigits: 0 }).format(parseFloat(String(v ?? 0)) || 0);
}
function fmtNum(v: unknown) {
  return new Intl.NumberFormat("id-ID").format(parseFloat(String(v ?? 0)) || 0);
}

function tierBadge(revenue: number) {
  if (revenue >= 5_000_000) return { label: "Top", cls: "bg-yellow-500/20 text-yellow-300 border-yellow-600" };
  if (revenue >= 2_000_000) return { label: "Good", cls: "bg-emerald-500/20 text-emerald-300 border-emerald-600" };
  return { label: "Standard", cls: "bg-slate-500/20 text-slate-400 border-slate-600" };
}

export default function FleetAnalyticsPage() {
  const [days, setDays] = useState("30");
  const [idleDays, setIdleDays] = useState("7");
  const qc = useQueryClient();

  const repairMutation = useMutation({
    mutationFn: async () => {
      const res = await fetch("/api/logistics/fleet/outstanding/repair", { method: "POST", credentials: "include" });
      if (!res.ok) throw new Error("Gagal repair outstanding");
      return res.json();
    },
    onSuccess: (d: { summary?: { drivers?: string; total?: string } }) => {
      toast.success(`Outstanding dihitung ulang — ${d.summary?.drivers ?? 0} driver, total ${new Intl.NumberFormat("id-ID", { style: "currency", currency: "IDR", maximumFractionDigits: 0 }).format(parseFloat(String(d.summary?.total ?? 0)) || 0)}`);
      qc.invalidateQueries({ queryKey: ["fleet-analytics"] });
    },
    onError: () => toast.error("Gagal repair outstanding"),
  });

  const { data, isLoading } = useQuery({
    queryKey: ["fleet-analytics", days],
    queryFn: async () => {
      const res = await fetch(`/api/logistics/fleet/analytics?days=${days}`, { credentials: "include" });
      return res.json() as Promise<{
        driverPerformance: Array<Record<string, unknown>>;
        vehiclePerformance: Array<Record<string, unknown>>;
        weekdayPattern: Array<Record<string, unknown>>;
        serviceBreakdown: Array<Record<string, unknown>>;
      }>;
    },
  });

  const { data: idleData, isLoading: idleLoading } = useQuery({
    queryKey: ["fleet-idle-vehicles", idleDays],
    queryFn: async () => {
      const res = await fetch(`/api/logistics/fleet/analytics/idle-vehicles?days=${idleDays}`, { credentials: "include" });
      return res.json() as Promise<{ idleVehicles: Array<Record<string, unknown>> }>;
    },
  });

  const { data: churnData, isLoading: churnLoading } = useQuery({
    queryKey: ["fleet-churn-risk"],
    queryFn: async () => {
      const res = await fetch("/api/logistics/fleet/analytics/churn-risk", { credentials: "include" });
      return res.json() as Promise<{ churnRisk: Array<Record<string, unknown>> }>;
    },
  });

  const { data: forecastData, isLoading: forecastLoading } = useQuery({
    queryKey: ["fleet-forecast"],
    queryFn: async () => {
      const res = await fetch("/api/logistics/fleet/analytics/forecast", { credentials: "include" });
      return res.json() as Promise<{
        historical: Array<Record<string, unknown>>;
        forecast: Array<Record<string, unknown>>;
        forecastAvg: number;
      }>;
    },
  });

  const drivers = data?.driverPerformance ?? [];
  const vehicles = data?.vehiclePerformance ?? [];
  const weekday = data?.weekdayPattern ?? [];
  const services = data?.serviceBreakdown ?? [];
  const idleVehicles = idleData?.idleVehicles ?? [];
  const churnRisk = churnData?.churnRisk ?? [];
  const historical = forecastData?.historical ?? [];
  const forecast = forecastData?.forecast ?? [];
  const maxForecastRev = Math.max(
    ...[...historical.slice(-30), ...forecast].map((r) => parseFloat(String((r as any).net_revenue ?? (r as any).forecast_revenue ?? 0))),
    1,
  );

  const weekdayData = weekday.map((w) => ({
    day: String(w.day_name ?? "").trim().slice(0, 3),
    avgDrivers: Math.round(parseFloat(String(w.avg_drivers ?? 0))),
    avgTrips: Math.round(parseFloat(String(w.avg_trips ?? 0))),
    avgRevenue: Math.round(parseFloat(String(w.avg_revenue ?? 0))),
  }));

  return (
    <AppShell>
      <div className="space-y-6">
        <Link href="/logistics/fleet-intelligence">
          <Button variant="ghost" size="sm" className="text-slate-400 hover:text-white gap-1.5 -ml-2">
            <ArrowLeft className="w-4 h-4" /> Fleet Intelligence
          </Button>
        </Link>
        <div className="flex items-center justify-between flex-wrap gap-3">
          <div>
            <h1 className="text-2xl font-bold text-white">Analytics Performa Fleet</h1>
            <p className="text-slate-400 text-sm mt-1">Analisis mendalam performa driver, kendaraan, dan pola operasional</p>
          </div>
          <Select value={days} onValueChange={setDays}>
            <SelectTrigger className="w-36 bg-slate-800 border-slate-700 text-white">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="7">7 Hari</SelectItem>
              <SelectItem value="14">14 Hari</SelectItem>
              <SelectItem value="30">30 Hari</SelectItem>
              <SelectItem value="60">60 Hari</SelectItem>
              <SelectItem value="90">90 Hari</SelectItem>
            </SelectContent>
          </Select>
        </div>

        {/* Charts Row */}
        <div className="grid grid-cols-1 xl:grid-cols-2 gap-6">
          {/* Weekday Pattern */}
          <Card className="bg-slate-800/60 border-slate-700">
            <CardHeader className="pb-2">
              <CardTitle className="text-white text-base">Pola Aktivitas per Hari dalam Seminggu</CardTitle>
            </CardHeader>
            <CardContent>
              {isLoading ? (
                <div className="h-52 bg-slate-700/40 rounded animate-pulse" />
              ) : (
                <ResponsiveContainer width="100%" height={220}>
                  <BarChart data={weekdayData}>
                    <CartesianGrid strokeDasharray="3 3" stroke="#334155" />
                    <XAxis dataKey="day" tick={{ fill: "#94a3b8", fontSize: 12 }} />
                    <YAxis tick={{ fill: "#94a3b8", fontSize: 11 }} />
                    <Tooltip
                      contentStyle={{ background: "#1e293b", border: "1px solid #334155", borderRadius: 8 }}
                      labelStyle={{ color: "#94a3b8" }}
                    />
                    <Bar dataKey="avgTrips" fill="#818cf8" radius={[2, 2, 0, 0]} name="Rata-rata Trip" />
                    <Bar dataKey="avgDrivers" fill="#34d399" radius={[2, 2, 0, 0]} name="Rata-rata Driver" />
                  </BarChart>
                </ResponsiveContainer>
              )}
            </CardContent>
          </Card>

          {/* Service Breakdown */}
          <Card className="bg-slate-800/60 border-slate-700">
            <CardHeader className="pb-2">
              <CardTitle className="text-white text-base">Breakdown per Jenis Layanan</CardTitle>
            </CardHeader>
            <CardContent>
              {isLoading ? (
                <div className="h-52 bg-slate-700/40 rounded animate-pulse" />
              ) : (
                <div className="space-y-3 pt-2">
                  {services.map((s, i) => {
                    const total = services.reduce((acc, x) => acc + parseFloat(String(x.revenue ?? 0)), 0);
                    const pct = total > 0 ? (parseFloat(String(s.revenue ?? 0)) / total) * 100 : 0;
                    return (
                      <div key={i}>
                        <div className="flex items-center justify-between text-sm mb-1">
                          <span className="text-white font-medium">{String(s.service_type ?? "-")}</span>
                          <div className="text-right">
                            <span className="text-emerald-400 font-semibold">{fmtIdr(s.revenue)}</span>
                            <span className="text-slate-500 ml-2 text-xs">{pct.toFixed(1)}%</span>
                          </div>
                        </div>
                        <div className="h-2 bg-slate-700 rounded-full overflow-hidden">
                          <div className="h-full bg-gradient-to-r from-indigo-500 to-cyan-400 rounded-full" style={{ width: `${pct}%` }} />
                        </div>
                        <div className="text-xs text-slate-500 mt-0.5">{fmtNum(s.trips)} trip · {fmtNum(s.count)} transaksi</div>
                      </div>
                    );
                  })}
                  {services.length === 0 && <p className="text-slate-500 text-sm py-4 text-center">Tidak ada data</p>}
                </div>
              )}
            </CardContent>
          </Card>
        </div>

        {/* Driver Performance Table */}
        <Card className="bg-slate-800/60 border-slate-700">
          <CardHeader className="pb-2">
            <div className="flex items-center justify-between gap-2">
              <CardTitle className="text-white text-base">Performa Driver (Top 50)</CardTitle>
              <Button
                size="sm"
                variant="outline"
                className="border-amber-600 text-amber-400 hover:bg-amber-900/30 text-xs"
                onClick={() => repairMutation.mutate()}
                disabled={repairMutation.isPending}
              >
                <Wrench className="w-3 h-3 mr-1" />
                {repairMutation.isPending ? "Menghitung..." : "Repair Outstanding"}
              </Button>
            </div>
          </CardHeader>
          <CardContent className="p-0">
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="border-b border-slate-700">
                  <tr>
                    {["#", "Nama Driver", "Plat", "Tipe", "Hari Aktif", "Total Trip", "Outstanding / Hutang", "Avg/Hari", "Total Insentif", "Total Potongan", "Terakhir Aktif", "Tier"].map((h) => (
                      <th key={h} className="text-left px-4 py-3 text-slate-400 font-medium whitespace-nowrap">{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {isLoading
                    ? Array.from({ length: 8 }).map((_, i) => (
                        <tr key={i} className="border-b border-slate-700/50">
                          <td colSpan={12} className="px-4 py-3"><div className="h-4 bg-slate-700 rounded animate-pulse" /></td>
                        </tr>
                      ))
                    : drivers.map((d, i) => {
                        const rev = parseFloat(String(d.total_revenue ?? 0));
                        const { label, cls } = tierBadge(rev);
                        return (
                          <tr key={String(d.id)} className="border-b border-slate-700/50 hover:bg-slate-700/20 transition-colors">
                            <td className="px-4 py-2.5 text-slate-400">{i + 1}</td>
                            <td className="px-4 py-2.5 text-white font-medium">{String(d.name)}</td>
                            <td className="px-4 py-2.5 text-slate-400">{String(d.vehicle_plate ?? "-")}</td>
                            <td className="px-4 py-2.5 text-slate-400">{String(d.vehicle_type ?? "-")}</td>
                            <td className="px-4 py-2.5 text-right text-slate-300">{fmtNum(d.day_count)}</td>
                            <td className="px-4 py-2.5 text-right text-slate-300">{fmtNum(d.total_trips)}</td>
                            <td className="px-4 py-2.5 text-right font-semibold text-orange-400">{fmtIdr(d.outstanding_amount)}</td>
                            <td className="px-4 py-2.5 text-right text-slate-300">{fmtIdr(d.avg_daily_revenue)}</td>
                            <td className="px-4 py-2.5 text-right text-yellow-400">{fmtIdr(d.total_incentive)}</td>
                            <td className="px-4 py-2.5 text-right text-red-400">{fmtIdr(d.total_deduction)}</td>
                            <td className="px-4 py-2.5 text-slate-400 text-xs">{String(d.last_active ?? "-")}</td>
                            <td className="px-4 py-2.5">
                              <Badge className={`text-xs border ${cls}`}>{label}</Badge>
                            </td>
                          </tr>
                        );
                      })}
                </tbody>
                {!isLoading && drivers.length > 0 && (() => {
                  const totalOutstanding = drivers.reduce((sum, d) => sum + parseFloat(String(d.outstanding_amount ?? 0)), 0);
                  const totalTrips = drivers.reduce((sum, d) => sum + parseFloat(String(d.total_trips ?? 0)), 0);
                  const totalIncentive = drivers.reduce((sum, d) => sum + parseFloat(String(d.total_incentive ?? 0)), 0);
                  const totalDeduction = drivers.reduce((sum, d) => sum + parseFloat(String(d.total_deduction ?? 0)), 0);
                  const withDebt = drivers.filter((d) => parseFloat(String(d.outstanding_amount ?? 0)) > 0).length;
                  return (
                    <tfoot>
                      <tr className="border-t-2 border-orange-500/40 bg-orange-500/5">
                        <td className="px-4 py-3 text-slate-400 font-semibold" colSpan={2}>
                          TOTAL ({drivers.length} driver, {withDebt} berpiutang)
                        </td>
                        <td colSpan={3} />
                        <td className="px-4 py-3 text-right font-bold text-slate-300">{fmtNum(totalTrips)}</td>
                        <td className="px-4 py-3 text-right font-bold text-orange-400 text-base">{fmtIdr(totalOutstanding)}</td>
                        <td className="px-4 py-3 text-right" />
                        <td className="px-4 py-3 text-right font-bold text-yellow-400">{fmtIdr(totalIncentive)}</td>
                        <td className="px-4 py-3 text-right font-bold text-red-400">{fmtIdr(totalDeduction)}</td>
                        <td colSpan={2} />
                      </tr>
                    </tfoot>
                  );
                })()}
              </table>
            </div>
          </CardContent>
        </Card>

        {/* Vehicle Performance */}
        <Card className="bg-slate-800/60 border-slate-700">
          <CardHeader className="pb-2">
            <CardTitle className="text-white text-base">Performa per Kendaraan (Top 20)</CardTitle>
          </CardHeader>
          <CardContent>
            {isLoading ? (
              <div className="h-52 bg-slate-700/40 rounded animate-pulse" />
            ) : vehicles.length === 0 ? (
              <p className="text-slate-500 text-sm py-4 text-center">Tidak ada data kendaraan</p>
            ) : (
              <ResponsiveContainer width="100%" height={260}>
                <BarChart data={vehicles.slice(0, 15).map((v) => ({ plate: String(v.vehicle_plate ?? "-"), revenue: parseFloat(String(v.total_revenue ?? 0)), trips: parseFloat(String(v.total_trips ?? 0)) }))}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#334155" />
                  <XAxis dataKey="plate" tick={{ fill: "#94a3b8", fontSize: 10 }} angle={-35} textAnchor="end" height={55} />
                  <YAxis tick={{ fill: "#94a3b8", fontSize: 11 }} tickFormatter={(v) => `${(v / 1_000_000).toFixed(1)}M`} />
                  <Tooltip
                    contentStyle={{ background: "#1e293b", border: "1px solid #334155", borderRadius: 8 }}
                    labelStyle={{ color: "#94a3b8" }}
                    formatter={(v: number, n: string) => [n === "revenue" ? fmtIdr(v) : fmtNum(v), n === "revenue" ? "Revenue" : "Trip"]}
                  />
                  <Bar dataKey="revenue" fill="#22d3ee" radius={[2, 2, 0, 0]} name="revenue" />
                </BarChart>
              </ResponsiveContainer>
            )}
          </CardContent>
        </Card>

        {/* ── Revenue Forecast ─────────────────────────────────── */}
        <Card className="bg-slate-800/60 border-slate-700">
          <CardHeader className="pb-2">
            <CardTitle className="text-white text-base flex items-center gap-2">
              <TrendingUp className="w-4 h-4 text-cyan-400" />
              Revenue Forecast (7-day MA + 14-hari ke depan)
            </CardTitle>
          </CardHeader>
          <CardContent>
            {forecastLoading ? (
              <div className="h-28 bg-slate-700/40 rounded animate-pulse" />
            ) : (historical.length === 0 && forecast.length === 0) ? (
              <p className="text-slate-500 text-sm text-center py-8">Belum ada data historis untuk proyeksi</p>
            ) : (
              <>
                <div className="flex items-center gap-4 mb-3 flex-wrap text-xs">
                  <span className="flex items-center gap-1.5"><span className="w-3 h-2 bg-emerald-500 rounded inline-block" /> Historis</span>
                  <span className="flex items-center gap-1.5"><span className="w-3 h-2 bg-cyan-400/60 rounded border border-cyan-400 border-dashed inline-block" /> Proyeksi</span>
                  <span className="text-slate-400">
                    Avg proyeksi: <span className="text-cyan-300 font-medium">{fmtIdr(forecastData?.forecastAvg ?? 0)}/hari</span>
                  </span>
                </div>
                <div className="flex items-end gap-px overflow-x-auto" style={{ height: "96px" }}>
                  {historical.slice(-30).map((r, i) => {
                    const rev = parseFloat(String(r.net_revenue ?? 0));
                    const pct = maxForecastRev > 0 ? (rev / maxForecastRev) * 100 : 0;
                    return (
                      <div
                        key={i}
                        className="flex flex-col items-center flex-1 min-w-[6px]"
                        title={`${r.summary_date}: ${fmtIdr(rev)}`}
                      >
                        <div className="w-full bg-emerald-500 rounded-sm" style={{ height: `${Math.max(pct, 2)}%` }} />
                      </div>
                    );
                  })}
                  {forecast.map((r, i) => {
                    const rev = parseFloat(String((r as any).forecast_revenue ?? 0));
                    const pct = maxForecastRev > 0 ? (rev / maxForecastRev) * 100 : 0;
                    return (
                      <div
                        key={`f${i}`}
                        className="flex flex-col items-center flex-1 min-w-[6px]"
                        title={`${(r as any).summary_date} (proyeksi): ${fmtIdr(rev)}`}
                      >
                        <div className="w-full bg-cyan-400/60 rounded-sm border-t border-cyan-400" style={{ height: `${Math.max(pct, 2)}%` }} />
                      </div>
                    );
                  })}
                </div>
                <div className="flex justify-between text-xs text-slate-500 mt-1.5">
                  <span>{historical.length > 0 ? String(historical[Math.max(0, historical.length - 30)].summary_date ?? "") : ""}</span>
                  <span className="text-cyan-400 text-center">← Proyeksi →</span>
                  <span>{forecast.length > 0 ? String((forecast[forecast.length - 1] as any).summary_date ?? "") : ""}</span>
                </div>
              </>
            )}
          </CardContent>
        </Card>

        {/* ── Idle Vehicles ─────────────────────────────────────── */}
        <Card className="bg-slate-800/60 border-slate-700">
          <CardHeader className="flex flex-row items-center justify-between pb-2">
            <CardTitle className="text-white text-base flex items-center gap-2">
              <Car className="w-4 h-4 text-amber-400" />
              Kendaraan / Driver Tidak Aktif
            </CardTitle>
            <Select value={idleDays} onValueChange={setIdleDays}>
              <SelectTrigger className="w-28 bg-slate-700 border-slate-600 text-white h-8 text-xs">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="3">3 hari</SelectItem>
                <SelectItem value="7">7 hari</SelectItem>
                <SelectItem value="14">14 hari</SelectItem>
                <SelectItem value="30">30 hari</SelectItem>
              </SelectContent>
            </Select>
          </CardHeader>
          <CardContent>
            {idleLoading ? (
              <div className="space-y-2">{Array.from({ length: 5 }).map((_, i) => <div key={i} className="h-9 bg-slate-700/40 rounded animate-pulse" />)}</div>
            ) : idleVehicles.length === 0 ? (
              <div className="text-center py-8">
                <Car className="w-8 h-8 mx-auto mb-2 text-emerald-400 opacity-60" />
                <p className="text-emerald-400 text-sm">Semua driver aktif dalam {idleDays} hari terakhir 👍</p>
              </div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead className="border-b border-slate-700">
                    <tr>
                      {["Driver", "Plat", "Tipe", "Terakhir Aktif", "Idle (hari)", "Revenue 30d"].map((h) => (
                        <th key={h} className="text-left px-3 py-2 text-slate-400 font-medium whitespace-nowrap">{h}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {idleVehicles.map((v) => {
                      const idle = parseInt(String(v.idle_days ?? "0"), 10);
                      return (
                        <tr key={String(v.id)} className="border-b border-slate-700/50 hover:bg-slate-700/20">
                          <td className="px-3 py-2.5 text-white">{String(v.driver_name ?? "—")}</td>
                          <td className="px-3 py-2.5 text-slate-400">{String(v.vehicle_plate ?? "—")}</td>
                          <td className="px-3 py-2.5 text-slate-400">{String(v.vehicle_type ?? "—")}</td>
                          <td className="px-3 py-2.5 text-slate-400 whitespace-nowrap">{String(v.last_active_date ?? "Belum pernah")}</td>
                          <td className="px-3 py-2.5 text-center">
                            <span className={`px-2 py-0.5 rounded text-xs font-medium ${idle >= 30 ? "bg-red-500/20 text-red-300" : idle >= 14 ? "bg-amber-500/20 text-amber-300" : "bg-yellow-500/20 text-yellow-300"}`}>
                              {isNaN(idle) ? "—" : idle}
                            </span>
                          </td>
                          <td className="px-3 py-2.5 text-right">
                            {parseFloat(String(v.revenue_last_30d ?? 0)) > 0
                              ? <span className="text-slate-300">{fmtIdr(v.revenue_last_30d)}</span>
                              : <span className="text-red-400 text-xs">—</span>}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </CardContent>
        </Card>

        {/* ── Churn Risk ────────────────────────────────────────── */}
        <Card className="bg-slate-800/60 border-slate-700">
          <CardHeader className="pb-2">
            <CardTitle className="text-white text-base flex items-center gap-2">
              <AlertTriangle className="w-4 h-4 text-red-400" />
              Risiko Churn Driver (14 Hari Terakhir vs 14 Hari Sebelumnya)
            </CardTitle>
          </CardHeader>
          <CardContent>
            {churnLoading ? (
              <div className="space-y-2">{Array.from({ length: 5 }).map((_, i) => <div key={i} className="h-9 bg-slate-700/40 rounded animate-pulse" />)}</div>
            ) : churnRisk.length === 0 ? (
              <div className="text-center py-8">
                <TrendingUp className="w-8 h-8 mx-auto mb-2 text-emerald-400 opacity-60" />
                <p className="text-emerald-400 text-sm">Tidak ada driver dengan risiko churn signifikan ✓</p>
              </div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead className="border-b border-slate-700">
                    <tr>
                      {["Driver", "Rev 14d Lalu", "Rev 14d Ini", "Penurunan", "Level Risiko"].map((h) => (
                        <th key={h} className="text-left px-3 py-2 text-slate-400 font-medium whitespace-nowrap">{h}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {churnRisk.map((r) => {
                      const riskPct = parseFloat(String(r.churn_risk_pct ?? 0));
                      const riskLevel = String(r.risk_level ?? "low");
                      return (
                        <tr key={String(r.driver_id)} className="border-b border-slate-700/50 hover:bg-slate-700/20">
                          <td className="px-3 py-2.5 text-white font-medium">{String(r.driver_name ?? "—")}</td>
                          <td className="px-3 py-2.5 text-right text-slate-300">{fmtIdr(r.rev_prev)}</td>
                          <td className="px-3 py-2.5 text-right text-slate-300">{fmtIdr(r.rev_recent)}</td>
                          <td className="px-3 py-2.5 text-right">
                            <span className={`font-semibold ${riskPct > 50 ? "text-red-400" : riskPct > 25 ? "text-amber-400" : "text-yellow-400"}`}>
                              -{riskPct.toFixed(1)}%
                            </span>
                          </td>
                          <td className="px-3 py-2.5">
                            <Badge className={`text-xs border ${
                              riskLevel === "high" ? "bg-red-500/20 text-red-300 border-red-600/40" :
                              riskLevel === "medium" ? "bg-amber-500/20 text-amber-300 border-amber-600/40" :
                              "bg-yellow-500/20 text-yellow-300 border-yellow-600/40"
                            }`}>
                              {riskLevel === "high" ? "Tinggi" : riskLevel === "medium" ? "Sedang" : "Rendah"}
                            </Badge>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </CardContent>
        </Card>
      </div>
    </AppShell>
  );
}
