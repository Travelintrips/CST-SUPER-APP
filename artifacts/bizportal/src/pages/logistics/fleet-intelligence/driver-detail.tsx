import { useState } from "react";
import { useParams, Link } from "wouter";
import { useQuery } from "@tanstack/react-query";
import { AppShell } from "@/components/layout/AppShell";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  ArrowLeft, User, Car, Phone, Calendar, TrendingUp,
  TrendingDown, AlertTriangle, CheckCircle, CreditCard,
  BarChart3, List, ChevronLeft, ChevronRight,
} from "lucide-react";
import {
  LineChart, Line, XAxis, YAxis, Tooltip, ResponsiveContainer,
  ReferenceLine, CartesianGrid,
} from "recharts";

// ── Formatters ────────────────────────────────────────────────────────────────
function fmtIdr(v: unknown) {
  return new Intl.NumberFormat("id-ID", {
    style: "currency", currency: "IDR", maximumFractionDigits: 0,
  }).format(parseFloat(String(v ?? 0)) || 0);
}
function fmtNum(v: unknown) {
  return new Intl.NumberFormat("id-ID").format(parseFloat(String(v ?? 0)) || 0);
}
function fmtDate(s: string | null | undefined) {
  if (!s) return "—";
  return new Date(s).toLocaleDateString("id-ID", { day: "2-digit", month: "short", year: "numeric" });
}
function fmtDateTime(s: string | null | undefined) {
  if (!s) return "—";
  return String(s).replace("T", " ").replace(".000Z", "").slice(0, 16);
}

// ── Types ─────────────────────────────────────────────────────────────────────
type DriverInfo = Record<string, unknown>;
type TxRow = {
  id: number;
  date_time_jkt: string;
  date_iso: string;
  driver_name: string;
  vehicle: string;
  phone_number: string;
  amount: number;
  outstanding: number;
  transaction_type: string;
  gopay_ref: string | null;
  service_type: string | null;
  report_name: string | null;
};
type DailyPoint = { date: string; outstanding: number };
type Summary = {
  totalRows: number; dueCount: number; deductionCount: number;
  totalDue: number; totalDeduction: number; netAmount: number;
  firstDate: string | null; lastDate: string | null;
  activeDays: number; latestOutstanding: number;
};
type DriverDetail = {
  driver: DriverInfo | null;
  transactions: TxRow[];
  dailyOutstanding: DailyPoint[];
  summary: Summary;
};

// ── Custom Tooltip ────────────────────────────────────────────────────────────
function OutstandingTooltip({ active, payload, label }: any) {
  if (!active || !payload?.length) return null;
  return (
    <div className="bg-slate-800 border border-slate-600 rounded-lg px-3 py-2 text-xs shadow-xl">
      <p className="text-slate-400 mb-1">{fmtDate(label)}</p>
      <p className="text-emerald-400 font-bold">{fmtIdr(payload[0]?.value)}</p>
    </div>
  );
}

// ── Stat Card ─────────────────────────────────────────────────────────────────
function StatCard({ label, value, sub, color = "text-white", icon: Icon }: {
  label: string; value: string; sub?: string; color?: string;
  icon: React.ComponentType<{ className?: string }>;
}) {
  return (
    <Card className="bg-slate-800/60 border-slate-700">
      <CardContent className="p-4">
        <div className="flex items-start justify-between">
          <div>
            <p className={`text-xl font-bold ${color}`}>{value}</p>
            <p className="text-xs text-slate-400 mt-0.5">{label}</p>
            {sub && <p className="text-xs text-slate-500 mt-0.5">{sub}</p>}
          </div>
          <Icon className={`w-5 h-5 ${color} opacity-60`} />
        </div>
      </CardContent>
    </Card>
  );
}

// ── Transaction type badge ────────────────────────────────────────────────────
function TxTypeBadge({ type }: { type: string }) {
  const lower = (type ?? "").toLowerCase();
  if (lower.includes("due")) return (
    <Badge className="bg-emerald-500/15 text-emerald-300 border border-emerald-700/50 text-xs">
      <TrendingUp className="w-3 h-3 mr-1" /> Rental Due
    </Badge>
  );
  if (lower.includes("deduction")) return (
    <Badge className="bg-red-500/15 text-red-300 border border-red-700/50 text-xs">
      <TrendingDown className="w-3 h-3 mr-1" /> Deduction
    </Badge>
  );
  return <Badge className="bg-slate-700 text-slate-300 border-slate-600 text-xs">{type}</Badge>;
}

const PAGE_SIZE = 50;

// ─────────────────────────────────────────────────────────────────────────────
export default function FleetDriverDetailPage() {
  const { extId } = useParams<{ extId: string }>();
  const [txFilter, setTxFilter] = useState<"all" | "due" | "deduction">("all");
  const [page, setPage] = useState(1);

  const { data, isLoading, isError } = useQuery<DriverDetail>({
    queryKey: ["fleet-driver-detail", extId],
    queryFn: async () => {
      const res = await fetch(`/api/logistics/fleet/drivers/${extId}/detail`, {
        credentials: "include",
      });
      if (!res.ok) throw new Error("Gagal memuat detail driver");
      return res.json();
    },
    enabled: !!extId,
  });

  if (isLoading) {
    return (
      <AppShell>
        <div className="flex items-center justify-center h-64">
          <div className="text-slate-400 animate-pulse">Memuat data driver...</div>
        </div>
      </AppShell>
    );
  }

  if (isError || !data) {
    return (
      <AppShell>
        <div className="flex flex-col items-center justify-center h-64 gap-3">
          <AlertTriangle className="w-10 h-10 text-red-400" />
          <p className="text-red-300">Gagal memuat detail driver</p>
          <Link href="/logistics/fleet-intelligence/drivers">
            <Button variant="outline" size="sm" className="gap-2">
              <ArrowLeft className="w-4 h-4" /> Kembali
            </Button>
          </Link>
        </div>
      </AppShell>
    );
  }

  const { driver, transactions, dailyOutstanding, summary } = data;
  const driverName = String(driver?.name ?? extId);
  const vehiclePlate = String(driver?.vehicle_plate ?? transactions[0]?.vehicle ?? "—");
  const phone = String(driver?.phone ?? transactions[0]?.phone_number ?? "—").replace(/^\t+/, "");

  // Filter transactions
  const filteredTx = transactions.filter((t) => {
    if (txFilter === "due") return Number(t.amount) > 0;
    if (txFilter === "deduction") return Number(t.amount) < 0;
    return true;
  });
  const totalPages = Math.ceil(filteredTx.length / PAGE_SIZE);
  const pageTx = filteredTx.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE);

  // Outstanding trend min/max
  const outValues = dailyOutstanding.map((d) => d.outstanding);
  const maxOut = outValues.length ? Math.max(...outValues) : 0;
  const minOut = outValues.length ? Math.min(...outValues) : 0;

  return (
    <AppShell>
      <div className="space-y-6 max-w-5xl">

        {/* ── Breadcrumb + Header ── */}
        <div>
          <Link href="/logistics/fleet-intelligence/drivers">
            <Button variant="ghost" size="sm" className="text-slate-400 hover:text-white gap-1.5 mb-3 -ml-2">
              <ArrowLeft className="w-4 h-4" /> Semua Driver
            </Button>
          </Link>
          <div className="flex items-start gap-4 flex-wrap">
            <div className="w-12 h-12 rounded-full bg-slate-700 flex items-center justify-center flex-shrink-0">
              <User className="w-6 h-6 text-slate-300" />
            </div>
            <div className="flex-1 min-w-0">
              <h1 className="text-2xl font-bold text-white">{driverName}</h1>
              <div className="flex items-center gap-3 flex-wrap mt-1">
                <span className="flex items-center gap-1.5 text-slate-400 text-sm">
                  <Car className="w-3.5 h-3.5" /> {vehiclePlate}
                </span>
                <span className="flex items-center gap-1.5 text-slate-400 text-sm">
                  <Phone className="w-3.5 h-3.5" /> {phone}
                </span>
                <span className="flex items-center gap-1.5 text-slate-400 text-sm font-mono">
                  ID: {extId}
                </span>
                {!!driver?.status && (
                  <Badge className={String(driver.status) === "active"
                    ? "bg-emerald-500/20 text-emerald-300 border border-emerald-600"
                    : "bg-slate-500/20 text-slate-300 border border-slate-600"}>
                    {String(driver.status)}
                  </Badge>
                )}
              </div>
            </div>
          </div>
        </div>

        {/* ── Stat Cards ── */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          <StatCard
            label="Outstanding Sekarang"
            value={fmtIdr(summary.latestOutstanding)}
            color={summary.latestOutstanding > 0 ? "text-amber-400" : "text-emerald-400"}
            icon={summary.latestOutstanding > 0 ? AlertTriangle : CheckCircle}
          />
          <StatCard
            label="Total Rental Fee"
            value={fmtIdr(summary.totalDue)}
            sub={`${fmtNum(summary.dueCount)} transaksi`}
            color="text-emerald-400"
            icon={TrendingUp}
          />
          <StatCard
            label="Total Deduction"
            value={fmtIdr(Math.abs(summary.totalDeduction))}
            sub={`${fmtNum(summary.deductionCount)} transaksi`}
            color="text-red-400"
            icon={TrendingDown}
          />
          <StatCard
            label="Net (Due - Deduction)"
            value={fmtIdr(summary.netAmount)}
            sub={`${fmtNum(summary.activeDays)} hari aktif`}
            color={summary.netAmount >= 0 ? "text-blue-400" : "text-orange-400"}
            icon={CreditCard}
          />
        </div>

        {/* Date range info */}
        <div className="flex items-center gap-2 text-xs text-slate-400 px-1">
          <Calendar className="w-3.5 h-3.5" />
          <span>Periode: <span className="text-slate-200">{fmtDate(summary.firstDate)}</span> s/d <span className="text-slate-200">{fmtDate(summary.lastDate)}</span></span>
          <span className="text-slate-600">•</span>
          <span>Total {fmtNum(summary.totalRows)} transaksi dari semua report</span>
        </div>

        {/* ── Outstanding Trend Chart ── */}
        {dailyOutstanding.length > 1 && (
          <Card className="bg-slate-800/60 border-slate-700">
            <CardHeader className="pb-2">
              <CardTitle className="text-white text-base flex items-center gap-2">
                <BarChart3 className="w-4 h-4 text-blue-400" />
                Tren Outstanding Harian
                <span className="ml-auto text-xs text-slate-400 font-normal">
                  Min: {fmtIdr(minOut)} · Max: {fmtIdr(maxOut)}
                </span>
              </CardTitle>
            </CardHeader>
            <CardContent>
              <ResponsiveContainer width="100%" height={200}>
                <LineChart data={dailyOutstanding} margin={{ top: 4, right: 8, left: 0, bottom: 0 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#334155" />
                  <XAxis
                    dataKey="date"
                    tick={{ fill: "#94a3b8", fontSize: 10 }}
                    tickFormatter={(v) => {
                      const d = new Date(v);
                      return `${d.getDate()}/${d.getMonth() + 1}`;
                    }}
                    interval="preserveStartEnd"
                  />
                  <YAxis
                    tick={{ fill: "#94a3b8", fontSize: 10 }}
                    tickFormatter={(v) => {
                      if (v >= 1_000_000) return `${(v / 1_000_000).toFixed(1)}M`;
                      if (v >= 1_000) return `${(v / 1_000).toFixed(0)}K`;
                      return String(v);
                    }}
                    width={52}
                  />
                  <Tooltip content={<OutstandingTooltip />} />
                  <ReferenceLine y={0} stroke="#ef4444" strokeDasharray="4 2" strokeWidth={1} />
                  <Line
                    type="monotone"
                    dataKey="outstanding"
                    stroke="#f59e0b"
                    strokeWidth={2}
                    dot={dailyOutstanding.length <= 30
                      ? { fill: "#f59e0b", r: 3, strokeWidth: 0 }
                      : false}
                    activeDot={{ r: 5, fill: "#fbbf24" }}
                  />
                </LineChart>
              </ResponsiveContainer>
              <p className="text-xs text-slate-500 mt-1 text-center">
                Saldo outstanding akhir hari per tanggal — positif = hutang belum lunas
              </p>
            </CardContent>
          </Card>
        )}

        {/* ── Transaction History ── */}
        <Card className="bg-slate-800/60 border-slate-700">
          <CardHeader className="pb-2">
            <div className="flex items-center justify-between flex-wrap gap-2">
              <CardTitle className="text-white text-base flex items-center gap-2">
                <List className="w-4 h-4 text-slate-400" />
                Riwayat Transaksi ({fmtNum(filteredTx.length)})
              </CardTitle>
              <div className="flex gap-1">
                {(["all", "due", "deduction"] as const).map((f) => (
                  <button
                    key={f}
                    onClick={() => { setTxFilter(f); setPage(1); }}
                    className={`px-3 py-1 rounded-md text-xs font-medium transition-colors ${
                      txFilter === f
                        ? f === "due" ? "bg-emerald-600 text-white"
                          : f === "deduction" ? "bg-red-600 text-white"
                          : "bg-slate-600 text-white"
                        : "text-slate-400 hover:text-white"
                    }`}
                  >
                    {f === "all" ? "Semua" : f === "due" ? "Rental Due" : "Deduction"}
                  </button>
                ))}
              </div>
            </div>
          </CardHeader>
          <CardContent className="p-0">
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="border-b border-slate-700">
                  <tr>
                    {["Waktu", "Tanggal", "Tipe", "Amount", "Outstanding", "GoPay Ref", "Kendaraan"].map((h) => (
                      <th key={h} className="px-3 py-2.5 text-left text-xs text-slate-400 font-medium whitespace-nowrap">{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {pageTx.map((t) => {
                    const amt = Number(t.amount);
                    const isDue = amt > 0;
                    return (
                      <tr key={t.id} className="border-b border-slate-700/30 hover:bg-slate-700/20 transition-colors">
                        <td className="px-3 py-2 text-slate-400 text-xs font-mono whitespace-nowrap">
                          {fmtDateTime(t.date_time_jkt)}
                        </td>
                        <td className="px-3 py-2 text-slate-300 text-xs whitespace-nowrap">
                          {fmtDate(t.date_iso)}
                        </td>
                        <td className="px-3 py-2">
                          <TxTypeBadge type={t.transaction_type} />
                        </td>
                        <td className={`px-3 py-2 font-semibold text-right tabular-nums whitespace-nowrap ${isDue ? "text-emerald-400" : "text-red-400"}`}>
                          {isDue ? "+" : ""}{fmtIdr(amt)}
                        </td>
                        <td className="px-3 py-2 text-amber-300 text-right tabular-nums whitespace-nowrap font-mono text-xs">
                          {fmtIdr(t.outstanding)}
                        </td>
                        <td className="px-3 py-2 text-slate-500 font-mono text-xs whitespace-nowrap max-w-[160px] truncate">
                          {t.gopay_ref ?? "—"}
                        </td>
                        <td className="px-3 py-2 text-slate-400 text-xs whitespace-nowrap">
                          {t.vehicle ?? "—"}
                        </td>
                      </tr>
                    );
                  })}
                  {pageTx.length === 0 && (
                    <tr>
                      <td colSpan={7} className="px-3 py-12 text-center text-slate-500">
                        Tidak ada transaksi
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>

            {/* Pagination */}
            {totalPages > 1 && (
              <div className="flex items-center justify-between px-4 py-3 border-t border-slate-700">
                <span className="text-xs text-slate-400">
                  Hal {page} / {totalPages} ({fmtNum(filteredTx.length)} baris)
                </span>
                <div className="flex gap-1">
                  <Button
                    variant="outline" size="sm"
                    disabled={page === 1}
                    onClick={() => setPage((p) => p - 1)}
                    className="h-7 w-7 p-0"
                  >
                    <ChevronLeft className="w-3.5 h-3.5" />
                  </Button>
                  <Button
                    variant="outline" size="sm"
                    disabled={page >= totalPages}
                    onClick={() => setPage((p) => p + 1)}
                    className="h-7 w-7 p-0"
                  >
                    <ChevronRight className="w-3.5 h-3.5" />
                  </Button>
                </div>
              </div>
            )}
          </CardContent>
        </Card>

        {/* Outstanding accounting breakdown */}
        <Card className="bg-slate-800/40 border-slate-700/50">
          <CardContent className="p-4">
            <p className="text-xs text-slate-400 mb-3 font-medium uppercase tracking-wide">Rekap Akumulasi</p>
            <div className="space-y-2 font-mono text-sm">
              <div className="flex justify-between text-slate-300">
                <span>Total Rental Fee Due (+)</span>
                <span className="text-emerald-400">{fmtIdr(summary.totalDue)}</span>
              </div>
              <div className="flex justify-between text-slate-300">
                <span>Total Deduction (−)</span>
                <span className="text-red-400">{fmtIdr(Math.abs(summary.totalDeduction))}</span>
              </div>
              <div className="border-t border-slate-700 pt-2 flex justify-between font-bold">
                <span className="text-slate-200">Net Akumulasi</span>
                <span className={summary.netAmount >= 0 ? "text-amber-400" : "text-emerald-400"}>
                  {fmtIdr(summary.netAmount)}
                </span>
              </div>
              <div className="flex justify-between text-slate-400 text-xs pt-1">
                <span>Outstanding saldo terakhir (dari CSV)</span>
                <span className="text-amber-300">{fmtIdr(summary.latestOutstanding)}</span>
              </div>
            </div>
          </CardContent>
        </Card>

      </div>
    </AppShell>
  );
}
