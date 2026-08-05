import { DatePicker } from "@/components/ui/date-picker";
import { useState, useEffect, useRef } from "react";
import { useLocation } from "wouter";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { AppShell } from "@/components/layout/AppShell";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import { useCompany } from "@/contexts/CompanyContext";
import {
  TrendingUp, TrendingDown, DollarSign, Users, CalendarDays,
  RefreshCw, BarChart2, ArrowUpRight, ArrowDownRight, Activity,
  Trophy, Target, Percent, Zap, Filter, ArrowLeft,
} from "lucide-react";
import {
  BarChart, Bar, LineChart, Line, XAxis, YAxis, CartesianGrid,
  Tooltip, Legend, ResponsiveContainer, PieChart, Pie, Cell,
} from "recharts";
import { useSportCostCenter } from "@/hooks/useSportCostCenter";

// ─── Formatters ──────────────────────────────────────────────────────────────

const idr = (n: number) =>
  new Intl.NumberFormat("id-ID", { style: "currency", currency: "IDR", maximumFractionDigits: 0 }).format(n);

const idrC = (n: number) => {
  const abs = Math.abs(n);
  const sign = n < 0 ? "-" : "";
  if (abs >= 1_000_000_000) return `${sign}${(abs / 1_000_000_000).toFixed(1)}M`;
  if (abs >= 1_000_000) return `${sign}${(abs / 1_000_000).toFixed(0)}Jt`;
  if (abs >= 1_000) return `${sign}${(abs / 1_000).toFixed(0)}rb`;
  return idr(n);
};

const fmtMonth = (m: string) => {
  const [y, mo] = m.split("-");
  const names = ["Jan","Feb","Mar","Apr","Mei","Jun","Jul","Ags","Sep","Okt","Nov","Des"];
  return `${names[Number(mo) - 1]} '${y.slice(2)}`;
};

// ─── Types ────────────────────────────────────────────────────────────────────

interface BreakEven {
  monthly_expense: number;
  avg_booking_value: number;
  break_even_bookings: number | null;
}

interface FacilityRow {
  facility_id: number | null;
  facility_name: string;
  bookings_count: number;
  revenue: number;
  refund: number;
  expense: number;
  net_revenue: number;
  net_profit: number;
  occupancy_pct: number;
}

interface MonthRow {
  month: string;
  booking_revenue: number;
  membership_revenue: number;
  total_revenue: number;
  expense: number;
  refund: number;
  net_profit: number;
}

interface CategoryRow {
  category: string;
  amount: number;
}

interface ProfitData {
  revenue_booking: number;
  revenue_membership: number;
  total_revenue: number;
  refund_amount: number;
  net_revenue: number;
  operational_expense: number;
  gross_profit: number;
  net_profit: number;
  profit_margin_pct: number;
  bookings_count: number;
  active_members: number;
  break_even: BreakEven;
  top_facilities: FacilityRow[];
  bottom_facilities: FacilityRow[];
  facility_profitability: FacilityRow[];
  revenue_by_month: MonthRow[];
  expense_by_category: CategoryRow[];
}

// ─── Sub-components ───────────────────────────────────────────────────────────

function KpiCard({
  title, value, icon: Icon, color, subtitle, trend,
}: {
  title: string; value: string; icon: React.ElementType;
  color: string; subtitle?: string; trend?: "up" | "down" | "neutral";
}) {
  return (
    <Card className="bg-gray-900 border-gray-700">
      <CardContent className="p-5">
        <div className="flex items-center justify-between mb-3">
          <span className="text-gray-400 text-sm">{title}</span>
          <div className={`p-2 rounded-lg ${color}`}><Icon className="h-4 w-4" /></div>
        </div>
        <div className="flex items-end gap-2">
          <span className="text-xl font-bold text-white leading-none">{value}</span>
          {trend === "up" && <ArrowUpRight className="h-4 w-4 text-emerald-400 mb-0.5" />}
          {trend === "down" && <ArrowDownRight className="h-4 w-4 text-red-400 mb-0.5" />}
        </div>
        {subtitle && <p className="text-gray-500 text-xs mt-1">{subtitle}</p>}
      </CardContent>
    </Card>
  );
}

function NetBadge({ value }: { value: number }) {
  if (value > 0) return <Badge className="bg-emerald-900/60 text-emerald-300 border-emerald-700">{idrC(value)}</Badge>;
  if (value < 0) return <Badge className="bg-red-900/60 text-red-300 border-red-700">{idrC(value)}</Badge>;
  return <Badge className="bg-gray-800 text-gray-400 border-gray-700">{idrC(value)}</Badge>;
}

const CATEGORY_COLORS: Record<string, string> = {
  maintenance: "#f59e0b",
  utility: "#3b82f6",
  service: "#8b5cf6",
  consumable: "#10b981",
  other: "#6b7280",
};

const CATEGORY_LABELS: Record<string, string> = {
  maintenance: "Maintenance",
  utility: "Utility",
  service: "Service",
  consumable: "Consumable",
  other: "Lainnya",
};

// ─── Main Page ────────────────────────────────────────────────────────────────

export default function SportCenterProfitability() {
  const [, navigate] = useLocation();
  const { activeCompanyId } = useCompany();
  const qc = useQueryClient();
  const esRef = useRef<EventSource | null>(null);
  const today = new Date().toISOString().split("T")[0];
  const firstOfYear = `${new Date().getFullYear()}-01-01`;

  const [from, setFrom] = useState(firstOfYear);
  const [to, setTo] = useState(today);
  const [queryFrom, setQueryFrom] = useState(firstOfYear);
  const [queryTo, setQueryTo] = useState(today);

  const { costCenters, selectedId: costCenterId, setSelectedId: setCostCenterId, selectedLabel: costCenterLabel } = useSportCostCenter();

  // ── FASE 6D-E: SSE live update ────────────────────────────────────────────
  useEffect(() => {
    const qs = activeCompanyId ? `?companyId=${activeCompanyId}` : "";
    const es = new EventSource(`/api/sport-center/events${qs}`);
    esRef.current = es;
    es.onmessage = (e) => {
      try {
        const ev = JSON.parse(e.data as string) as { type?: string; entity?: string };
        if (ev.type === "connected") return;
        if (["booking", "payment", "refund"].includes(ev.entity ?? "")) {
          void qc.invalidateQueries({ queryKey: ["sc-profitability-6c"] });
        }
      } catch { /* ignore */ }
    };
    return () => { es.close(); esRef.current = null; };
  }, [activeCompanyId, qc]);

  const { data, isLoading, refetch } = useQuery<ProfitData>({
    queryKey: ["sc-profitability-6c", activeCompanyId, queryFrom, queryTo, costCenterId],
    queryFn: async () => {
      const qs = new URLSearchParams({ from: queryFrom, to: queryTo });
      if (activeCompanyId) qs.set("company_id", String(activeCompanyId));
      if (costCenterId != null) qs.set("cost_center_id", String(costCenterId));
      const r = await fetch(`/api/sport-center/profitability?${qs}`, { credentials: "include" });
      if (!r.ok) throw new Error("Gagal memuat profitabilitas");
      return r.json();
    },
  });

  const d = data;
  const netProfitPositive = (d?.net_profit ?? 0) >= 0;
  const profitMargin = d?.profit_margin_pct ?? 0;

  const handleApply = () => { setQueryFrom(from); setQueryTo(to); };

  const KpiSkeleton = () => (
    <Card className="bg-gray-900 border-gray-700">
      <CardContent className="p-5">
        <Skeleton className="h-4 w-24 mb-3 bg-gray-800" />
        <Skeleton className="h-6 w-32 bg-gray-800" />
      </CardContent>
    </Card>
  );

  return (
    <AppShell>
      <div className="p-6 space-y-6">
        <Button variant="ghost" size="sm" className="-ml-2" onClick={() => window.history.back()}>
          <ArrowLeft className="h-4 w-4 mr-1" />Kembali
        </Button>
        {/* Header */}
        <div className="flex items-center justify-between flex-wrap gap-3">
          <div className="flex items-center gap-3">
            <Button variant="ghost" size="icon" onClick={() => navigate("/sport-center/dashboard")} className="h-8 w-8 shrink-0">
              <ArrowLeft className="h-4 w-4" />
            </Button>
            <div className="p-2 bg-emerald-900/40 rounded-lg">
              <Trophy className="h-5 w-5 text-emerald-400" />
            </div>
            <div>
              <h1 className="text-xl font-bold text-white">Profitabilitas Sport Center</h1>
              <p className="text-gray-400 text-sm">Laba/rugi berbasis jurnal accounting yang terposting</p>
            </div>
          </div>
          <Button variant="outline" size="sm" onClick={() => refetch()} className="border-gray-700 text-gray-300">
            <RefreshCw className="h-4 w-4 mr-1" /> Refresh
          </Button>
        </div>

        {/* Filter */}
        <Card className="bg-gray-900 border-gray-700">
          <CardContent className="p-4">
            <div className="flex flex-wrap gap-4 items-end">
              <div className="space-y-1">
                <Label className="text-gray-400 text-xs">Dari</Label>
                <DatePicker value={from} onChange={v => setFrom(v)} className="bg-gray-800 border-gray-700 text-white h-8 w-36" />
              </div>
              <div className="space-y-1">
                <Label className="text-gray-400 text-xs">Sampai</Label>
                <DatePicker value={to} onChange={v => setTo(v)} className="bg-gray-800 border-gray-700 text-white h-8 w-36" />
              </div>
              <div className="space-y-1">
                <Label className="text-gray-400 text-xs flex items-center gap-1">
                  <Filter className="h-3 w-3" /> Cost Center
                </Label>
                <Select
                  value={costCenterId != null ? String(costCenterId) : "__all__"}
                  onValueChange={v => setCostCenterId(v === "__all__" ? null : Number(v))}
                >
                  <SelectTrigger className="h-8 w-52 bg-gray-800 border-gray-700 text-gray-200 text-xs">
                    <SelectValue placeholder="Semua Cost Center" />
                  </SelectTrigger>
                  <SelectContent className="bg-gray-800 border-gray-700">
                    <SelectItem value="__all__" className="text-xs text-gray-200">Semua Cost Center</SelectItem>
                    {costCenters.map(cc => (
                      <SelectItem key={cc.id} value={String(cc.id)} className="text-xs text-gray-200">
                        {cc.code} — {cc.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <Button size="sm" onClick={handleApply} className="bg-emerald-700 hover:bg-emerald-600 text-white">
                Terapkan
              </Button>
              {costCenterId != null && (
                <Badge className="bg-indigo-900/40 text-indigo-300 border-indigo-700 text-xs gap-1 self-end mb-0.5">
                  <Filter className="h-3 w-3" /> {costCenterLabel}
                </Badge>
              )}
            </div>
          </CardContent>
        </Card>

        {/* KPI Cards — 6 utama */}
        <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-4">
          {isLoading ? Array.from({ length: 6 }).map((_, i) => <KpiSkeleton key={i} />) : (<>
            <KpiCard
              title="Gross Revenue"
              value={idrC(d?.total_revenue ?? 0)}
              icon={DollarSign}
              color="bg-blue-900/40 text-blue-400"
              subtitle="Booking + Membership"
              trend="up"
            />
            <KpiCard
              title="Refund"
              value={idrC(d?.refund_amount ?? 0)}
              icon={ArrowDownRight}
              color="bg-orange-900/40 text-orange-400"
              subtitle="dikurangi dari revenue"
              trend="down"
            />
            <KpiCard
              title="Biaya Operasional"
              value={idrC(d?.operational_expense ?? 0)}
              icon={Activity}
              color="bg-red-900/40 text-red-400"
              subtitle="dari vendor bill SC"
              trend="down"
            />
            <KpiCard
              title="Net Revenue"
              value={idrC(d?.net_revenue ?? 0)}
              icon={TrendingUp}
              color={(d?.net_revenue ?? 0) >= 0 ? "bg-cyan-900/40 text-cyan-400" : "bg-red-900/40 text-red-400"}
              subtitle="Revenue − Refund"
              trend={(d?.net_revenue ?? 0) >= 0 ? "up" : "down"}
            />
            <KpiCard
              title="Net Profit"
              value={idrC(d?.net_profit ?? 0)}
              icon={netProfitPositive ? TrendingUp : TrendingDown}
              color={netProfitPositive ? "bg-emerald-900/40 text-emerald-400" : "bg-red-900/40 text-red-400"}
              subtitle="Net Revenue − Expense"
              trend={netProfitPositive ? "up" : "down"}
            />
            <KpiCard
              title="Profit Margin"
              value={`${profitMargin.toFixed(1)}%`}
              icon={Percent}
              color={profitMargin >= 20 ? "bg-emerald-900/40 text-emerald-400" : profitMargin >= 0 ? "bg-yellow-900/40 text-yellow-400" : "bg-red-900/40 text-red-400"}
              subtitle="(Net Profit / Revenue) × 100"
              trend={profitMargin >= 0 ? "up" : "down"}
            />
          </>)}
        </div>

        {/* KPI sekunder */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          {isLoading ? Array.from({ length: 4 }).map((_, i) => <KpiSkeleton key={i} />) : (<>
            <KpiCard
              title="Pendapatan Booking"
              value={idrC(d?.revenue_booking ?? 0)}
              icon={CalendarDays}
              color="bg-blue-900/40 text-blue-400"
              subtitle="dari accounting entries"
            />
            <KpiCard
              title="Pendapatan Membership"
              value={idrC(d?.revenue_membership ?? 0)}
              icon={Users}
              color="bg-purple-900/40 text-purple-400"
              subtitle="dari accounting entries"
            />
            <KpiCard
              title="Booking Aktif"
              value={String(d?.bookings_count ?? 0)}
              icon={CalendarDays}
              color="bg-cyan-900/40 text-cyan-400"
              subtitle="dalam periode"
            />
            <KpiCard
              title="Member Aktif"
              value={String(d?.active_members ?? 0)}
              icon={Users}
              color="bg-indigo-900/40 text-indigo-400"
              subtitle="status aktif"
            />
          </>)}
        </div>

        {/* Charts baris 1: Revenue vs Expense + Expense Category Breakdown */}
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">

          {/* Revenue vs Expense vs Profit (line chart) */}
          <Card className="bg-gray-900 border-gray-700">
            <CardHeader className="pb-2">
              <CardTitle className="text-white text-sm flex items-center gap-2">
                <TrendingUp className="h-4 w-4 text-emerald-400" /> Revenue vs Expense vs Laba Bersih
              </CardTitle>
            </CardHeader>
            <CardContent>
              {isLoading ? <Skeleton className="h-48 w-full bg-gray-800" /> :
               (d?.revenue_by_month?.length ?? 0) === 0 ? (
                <div className="h-48 flex items-center justify-center text-gray-500 text-sm">Belum ada data</div>
              ) : (
                <ResponsiveContainer width="100%" height={200}>
                  <LineChart data={d?.revenue_by_month ?? []} margin={{ left: 0, right: 0, top: 4, bottom: 0 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke="#374151" />
                    <XAxis dataKey="month" tickFormatter={fmtMonth} stroke="#6b7280" tick={{ fontSize: 11 }} />
                    <YAxis tickFormatter={v => idrC(v)} stroke="#6b7280" tick={{ fontSize: 10 }} width={56} />
                    <Tooltip
                      formatter={(v: number) => idr(v)}
                      labelFormatter={fmtMonth}
                      contentStyle={{ backgroundColor: "#1f2937", border: "1px solid #374151", borderRadius: 8 }}
                      labelStyle={{ color: "#e5e7eb" }}
                    />
                    <Legend wrapperStyle={{ fontSize: 11, color: "#9ca3af" }} />
                    <Line type="monotone" dataKey="total_revenue" name="Revenue" stroke="#3b82f6" strokeWidth={2} dot={false} />
                    <Line type="monotone" dataKey="expense" name="Expense" stroke="#ef4444" strokeWidth={2} dot={false} />
                    <Line type="monotone" dataKey="net_profit" name="Laba Bersih" stroke="#10b981" strokeWidth={2} dot={false} strokeDasharray="4 2" />
                  </LineChart>
                </ResponsiveContainer>
              )}
            </CardContent>
          </Card>

          {/* Expense Category Breakdown (pie/bar) */}
          <Card className="bg-gray-900 border-gray-700">
            <CardHeader className="pb-2">
              <CardTitle className="text-white text-sm flex items-center gap-2">
                <BarChart2 className="h-4 w-4 text-orange-400" /> Breakdown Kategori Expense
              </CardTitle>
            </CardHeader>
            <CardContent>
              {isLoading ? <Skeleton className="h-48 w-full bg-gray-800" /> :
               (d?.expense_by_category?.length ?? 0) === 0 ? (
                <div className="h-48 flex items-center justify-center text-gray-500 text-sm">Belum ada expense tercatat</div>
              ) : (
                <div className="flex gap-4 items-center">
                  <ResponsiveContainer width="55%" height={180}>
                    <PieChart>
                      <Pie
                        data={d?.expense_by_category ?? []}
                        dataKey="amount"
                        nameKey="category"
                        cx="50%"
                        cy="50%"
                        innerRadius={45}
                        outerRadius={75}
                        paddingAngle={2}
                      >
                        {(d?.expense_by_category ?? []).map((entry, i) => (
                          <Cell key={i} fill={CATEGORY_COLORS[entry.category] ?? "#6b7280"} />
                        ))}
                      </Pie>
                      <Tooltip
                        formatter={(v: number) => idr(v)}
                        contentStyle={{ backgroundColor: "#1f2937", border: "1px solid #374151", borderRadius: 8 }}
                      />
                    </PieChart>
                  </ResponsiveContainer>
                  <div className="space-y-2 flex-1">
                    {(d?.expense_by_category ?? []).map((r, i) => {
                      const total = d?.operational_expense ?? 1;
                      const pct = total > 0 ? Math.round((r.amount / total) * 100) : 0;
                      return (
                        <div key={i} className="flex items-center gap-2">
                          <div className="w-2.5 h-2.5 rounded-full flex-shrink-0"
                            style={{ backgroundColor: CATEGORY_COLORS[r.category] ?? "#6b7280" }} />
                          <div className="flex-1 min-w-0">
                            <div className="flex justify-between items-center">
                              <span className="text-gray-300 text-xs truncate">{CATEGORY_LABELS[r.category] ?? r.category}</span>
                              <span className="text-gray-400 text-xs ml-2">{pct}%</span>
                            </div>
                            <div className="text-gray-500 text-xs">{idrC(r.amount)}</div>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </div>
              )}
            </CardContent>
          </Card>
        </div>

        {/* Charts baris 2: Revenue per Bulan + Facility Profit Ranking */}
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">

          {/* Revenue per Bulan (stacked bar) */}
          <Card className="bg-gray-900 border-gray-700">
            <CardHeader className="pb-2">
              <CardTitle className="text-white text-sm flex items-center gap-2">
                <BarChart2 className="h-4 w-4 text-blue-400" /> Revenue per Bulan
              </CardTitle>
            </CardHeader>
            <CardContent>
              {isLoading ? <Skeleton className="h-48 w-full bg-gray-800" /> :
               (d?.revenue_by_month?.length ?? 0) === 0 ? (
                <div className="h-48 flex items-center justify-center text-gray-500 text-sm">Belum ada data</div>
              ) : (
                <ResponsiveContainer width="100%" height={200}>
                  <BarChart data={d?.revenue_by_month ?? []} margin={{ left: 0, right: 0, top: 4, bottom: 0 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke="#374151" />
                    <XAxis dataKey="month" tickFormatter={fmtMonth} stroke="#6b7280" tick={{ fontSize: 11 }} />
                    <YAxis tickFormatter={v => idrC(v)} stroke="#6b7280" tick={{ fontSize: 10 }} width={56} />
                    <Tooltip
                      formatter={(v: number) => idr(v)}
                      labelFormatter={fmtMonth}
                      contentStyle={{ backgroundColor: "#1f2937", border: "1px solid #374151", borderRadius: 8 }}
                      labelStyle={{ color: "#e5e7eb" }}
                    />
                    <Legend wrapperStyle={{ fontSize: 11, color: "#9ca3af" }} />
                    <Bar dataKey="booking_revenue" name="Booking" fill="#3b82f6" stackId="rev" radius={[0,0,0,0]} />
                    <Bar dataKey="membership_revenue" name="Membership" fill="#8b5cf6" stackId="rev" radius={[2,2,0,0]} />
                  </BarChart>
                </ResponsiveContainer>
              )}
            </CardContent>
          </Card>

          {/* Facility Profit Ranking (horizontal bar) */}
          <Card className="bg-gray-900 border-gray-700">
            <CardHeader className="pb-2">
              <CardTitle className="text-white text-sm flex items-center gap-2">
                <Trophy className="h-4 w-4 text-yellow-400" /> Facility Profit Ranking
              </CardTitle>
            </CardHeader>
            <CardContent>
              {isLoading ? <Skeleton className="h-48 w-full bg-gray-800" /> :
               (d?.facility_profitability?.length ?? 0) === 0 ? (
                <div className="h-48 flex items-center justify-center text-gray-500 text-sm">Belum ada data fasilitas</div>
              ) : (
                <ResponsiveContainer width="100%" height={200}>
                  <BarChart
                    data={(d?.facility_profitability ?? []).slice(0, 8)}
                    layout="vertical"
                    margin={{ left: 0, right: 16, top: 4, bottom: 0 }}
                  >
                    <CartesianGrid strokeDasharray="3 3" stroke="#374151" horizontal={false} />
                    <XAxis type="number" tickFormatter={v => idrC(v)} stroke="#6b7280" tick={{ fontSize: 10 }} />
                    <YAxis type="category" dataKey="facility_name" stroke="#6b7280" tick={{ fontSize: 10 }} width={90} />
                    <Tooltip
                      formatter={(v: number) => idr(v)}
                      contentStyle={{ backgroundColor: "#1f2937", border: "1px solid #374151", borderRadius: 8 }}
                    />
                    <Bar dataKey="net_profit" name="Net Profit" radius={[0, 3, 3, 0]}>
                      {(d?.facility_profitability ?? []).slice(0, 8).map((entry, i) => (
                        <Cell key={i} fill={entry.net_profit >= 0 ? "#10b981" : "#ef4444"} />
                      ))}
                    </Bar>
                  </BarChart>
                </ResponsiveContainer>
              )}
            </CardContent>
          </Card>
        </div>

        {/* Top 5 & Bottom 5 Facilities */}
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          {(["top", "bottom"] as const).map(type => {
            const rows = type === "top" ? (d?.top_facilities ?? []) : (d?.bottom_facilities ?? []);
            const label = type === "top" ? "Top 5 Facility by Profit" : "Bottom 5 Facility by Profit";
            const icon = type === "top" ? "🏆" : "⚠️";
            return (
              <Card key={type} className="bg-gray-900 border-gray-700">
                <CardHeader className="pb-2">
                  <CardTitle className="text-white text-sm">{icon} {label}</CardTitle>
                </CardHeader>
                <CardContent className="p-0">
                  {isLoading ? (
                    <div className="p-4 space-y-2">{Array.from({ length: 4 }).map((_, i) => <Skeleton key={i} className="h-8 w-full bg-gray-800" />)}</div>
                  ) : rows.length === 0 ? (
                    <div className="py-8 text-center text-gray-500 text-sm">Belum ada data</div>
                  ) : (
                    <Table>
                      <TableHeader>
                        <TableRow className="border-gray-800 hover:bg-transparent">
                          <TableHead className="text-gray-400 text-xs">Fasilitas</TableHead>
                          <TableHead className="text-gray-400 text-xs text-right">Revenue</TableHead>
                          <TableHead className="text-gray-400 text-xs text-right">Expense</TableHead>
                          <TableHead className="text-gray-400 text-xs text-right">Net Profit</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {rows.map((f, i) => (
                          <TableRow key={i} className="border-gray-800 hover:bg-gray-800/40">
                            <TableCell className="text-white font-medium py-2 text-sm">{f.facility_name || "—"}</TableCell>
                            <TableCell className="text-blue-300 text-right py-2 text-xs">{idrC(f.revenue)}</TableCell>
                            <TableCell className="text-red-300 text-right py-2 text-xs">{f.expense > 0 ? idrC(f.expense) : "—"}</TableCell>
                            <TableCell className="text-right py-2">
                              <NetBadge value={f.net_profit} />
                            </TableCell>
                          </TableRow>
                        ))}
                      </TableBody>
                    </Table>
                  )}
                </CardContent>
              </Card>
            );
          })}
        </div>

        {/* Full Facility Profitability Table */}
        <Card className="bg-gray-900 border-gray-700">
          <CardHeader className="pb-2">
            <CardTitle className="text-white text-sm flex items-center gap-2">
              <Zap className="h-4 w-4 text-cyan-400" /> Profitabilitas per Fasilitas (Lengkap)
            </CardTitle>
          </CardHeader>
          <CardContent className="p-0">
            {isLoading ? (
              <div className="p-4 space-y-2">{Array.from({ length: 4 }).map((_, i) => <Skeleton key={i} className="h-10 w-full bg-gray-800" />)}</div>
            ) : (d?.facility_profitability?.length ?? 0) === 0 ? (
              <div className="py-10 text-center text-gray-500 text-sm">Belum ada data fasilitas dalam periode ini</div>
            ) : (
              <Table>
                <TableHeader>
                  <TableRow className="border-gray-800 hover:bg-transparent">
                    <TableHead className="text-gray-400 text-xs">Fasilitas</TableHead>
                    <TableHead className="text-gray-400 text-xs text-right">Booking</TableHead>
                    <TableHead className="text-gray-400 text-xs text-right">Revenue</TableHead>
                    <TableHead className="text-gray-400 text-xs text-right">Refund</TableHead>
                    <TableHead className="text-gray-400 text-xs text-right">Expense</TableHead>
                    <TableHead className="text-gray-400 text-xs text-right">Net Profit</TableHead>
                    <TableHead className="text-gray-400 text-xs text-right">Occupancy</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {(d?.facility_profitability ?? []).map((f, i) => (
                    <TableRow key={i} className="border-gray-800 hover:bg-gray-800/40">
                      <TableCell className="text-white font-medium py-3">{f.facility_name || "—"}</TableCell>
                      <TableCell className="text-gray-300 text-right py-3">{f.bookings_count.toLocaleString("id-ID")}</TableCell>
                      <TableCell className="text-blue-300 text-right py-3">{idrC(f.revenue)}</TableCell>
                      <TableCell className="text-orange-300 text-right py-3">{f.refund > 0 ? idrC(f.refund) : "—"}</TableCell>
                      <TableCell className="text-red-300 text-right py-3">{f.expense > 0 ? idrC(f.expense) : "—"}</TableCell>
                      <TableCell className="text-right py-3"><NetBadge value={f.net_profit} /></TableCell>
                      <TableCell className="text-right py-3">
                        <div className="flex items-center justify-end gap-2">
                          <div className="w-16 bg-gray-800 rounded-full h-1.5 overflow-hidden">
                            <div className="h-full rounded-full bg-emerald-500" style={{ width: `${Math.min(100, f.occupancy_pct)}%` }} />
                          </div>
                          <span className="text-gray-400 text-xs w-8">{f.occupancy_pct}%</span>
                        </div>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            )}
          </CardContent>
        </Card>

        {/* P&L Summary + Break-Even */}
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">

          {/* P&L Summary */}
          <Card className="bg-gray-900 border-gray-700">
            <CardHeader className="pb-2">
              <CardTitle className="text-white text-sm flex items-center gap-2">
                <DollarSign className="h-4 w-4 text-cyan-400" /> Ringkasan Laba/Rugi
              </CardTitle>
            </CardHeader>
            <CardContent>
              {isLoading ? <Skeleton className="h-40 w-full bg-gray-800" /> : (
                <div className="space-y-2 max-w-sm">
                  <div className="flex justify-between items-center py-1.5 border-b border-gray-800">
                    <span className="text-gray-400 text-sm">Pendapatan Booking</span>
                    <span className="text-blue-300 font-mono text-sm">{idr(d?.revenue_booking ?? 0)}</span>
                  </div>
                  <div className="flex justify-between items-center py-1.5 border-b border-gray-800">
                    <span className="text-gray-400 text-sm">Pendapatan Membership</span>
                    <span className="text-purple-300 font-mono text-sm">{idr(d?.revenue_membership ?? 0)}</span>
                  </div>
                  <div className="flex justify-between items-center py-1.5 border-b border-gray-700 font-semibold">
                    <span className="text-white text-sm">= Gross Revenue</span>
                    <span className="text-white font-mono text-sm">{idr(d?.total_revenue ?? 0)}</span>
                  </div>
                  <div className="flex justify-between items-center py-1.5 border-b border-gray-800">
                    <span className="text-gray-400 text-sm">Refund</span>
                    <span className="text-orange-300 font-mono text-sm">({idr(d?.refund_amount ?? 0)})</span>
                  </div>
                  <div className="flex justify-between items-center py-1.5 border-b border-gray-700 font-semibold">
                    <span className="text-white text-sm">= Net Revenue</span>
                    <span className={`font-mono text-sm ${(d?.net_revenue ?? 0) >= 0 ? "text-cyan-300" : "text-red-300"}`}>
                      {idr(d?.net_revenue ?? 0)}
                    </span>
                  </div>
                  <div className="flex justify-between items-center py-1.5 border-b border-gray-800">
                    <span className="text-gray-400 text-sm">Biaya Operasional</span>
                    <span className="text-red-300 font-mono text-sm">({idr(d?.operational_expense ?? 0)})</span>
                  </div>
                  <div className="flex justify-between items-center py-2 bg-gray-800/60 px-3 rounded-lg font-bold">
                    <span className="text-white">= Net Profit</span>
                    <span className={`font-mono ${netProfitPositive ? "text-emerald-400" : "text-red-400"}`}>
                      {idr(d?.net_profit ?? 0)}
                    </span>
                  </div>
                  <div className="flex justify-between items-center py-1.5 px-3">
                    <span className="text-gray-400 text-sm">Profit Margin</span>
                    <span className={`font-mono text-sm font-bold ${profitMargin >= 20 ? "text-emerald-400" : profitMargin >= 0 ? "text-yellow-400" : "text-red-400"}`}>
                      {profitMargin.toFixed(1)}%
                    </span>
                  </div>
                </div>
              )}
            </CardContent>
          </Card>

          {/* Break-Even Analysis */}
          <Card className="bg-gray-900 border-gray-700">
            <CardHeader className="pb-2">
              <CardTitle className="text-white text-sm flex items-center gap-2">
                <Target className="h-4 w-4 text-yellow-400" /> Break-Even Analysis
              </CardTitle>
            </CardHeader>
            <CardContent>
              {isLoading ? <Skeleton className="h-40 w-full bg-gray-800" /> : (
                <div className="space-y-4">
                  <div className="grid grid-cols-2 gap-3">
                    <div className="bg-gray-800/60 rounded-lg p-3">
                      <div className="text-gray-400 text-xs mb-1">Biaya Bulanan Rata-rata</div>
                      <div className="text-white font-bold text-lg">{idrC(d?.break_even?.monthly_expense ?? 0)}</div>
                      <div className="text-gray-500 text-xs">Total Expense ÷ Jumlah Bulan</div>
                    </div>
                    <div className="bg-gray-800/60 rounded-lg p-3">
                      <div className="text-gray-400 text-xs mb-1">Rata-rata Nilai Booking</div>
                      <div className="text-white font-bold text-lg">{idrC(d?.break_even?.avg_booking_value ?? 0)}</div>
                      <div className="text-gray-500 text-xs">Revenue Booking ÷ Booking Count</div>
                    </div>
                  </div>
                  <div className={`rounded-lg p-4 border ${(d?.break_even?.break_even_bookings ?? null) !== null ? "bg-yellow-900/20 border-yellow-700/40" : "bg-gray-800/40 border-gray-700"}`}>
                    <div className="text-gray-400 text-xs mb-1">Break-Even Bookings / Bulan</div>
                    {d?.break_even?.break_even_bookings != null ? (
                      <>
                        <div className="text-yellow-300 font-bold text-3xl">
                          {d.break_even.break_even_bookings.toLocaleString("id-ID")}
                          <span className="text-sm font-normal text-gray-400 ml-1">booking</span>
                        </div>
                        <div className="text-gray-500 text-xs mt-1">
                          Biaya Bulanan ÷ Rata-rata Nilai Booking
                        </div>
                        <div className="mt-2 text-xs">
                          {(d.bookings_count ?? 0) >= d.break_even.break_even_bookings ? (
                            <span className="text-emerald-400">✓ Target tercapai dalam periode ini</span>
                          ) : (
                            <span className="text-orange-400">⚠ Masih kurang {(d.break_even.break_even_bookings - (d.bookings_count ?? 0)).toLocaleString("id-ID")} booking</span>
                          )}
                        </div>
                      </>
                    ) : (
                      <div className="text-gray-500 text-sm">Tidak dapat dihitung — tidak ada data booking atau expense</div>
                    )}
                  </div>
                </div>
              )}
            </CardContent>
          </Card>
        </div>

        <p className="text-gray-600 text-xs">
          * Seluruh angka bersumber dari <code className="text-gray-500">accounting_entries</code> yang berstatus <code className="text-gray-500">posted</code>.
          Occupancy dihitung estimasi berdasarkan kapasitas fasilitas × 30 hari.
        </p>
      </div>
    </AppShell>
  );
}
