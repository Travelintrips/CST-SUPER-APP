import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { AppShell } from "@/components/layout/AppShell";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Users, DollarSign, AlertTriangle, RefreshCw,
  Wrench, Search, ArrowLeft, ArrowUpDown, ArrowUp, ArrowDown,
  MessageCircle, CheckCircle, Send, RotateCcw, Database, Clock,
} from "lucide-react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { useState, useMemo } from "react";
import { Link } from "wouter";
import { toast } from "sonner";
import { Select, SelectTrigger, SelectValue, SelectContent, SelectItem } from "@/components/ui/select";
import { LineChart, Line, BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from "recharts";

function fmtIdr(v: unknown) {
  const n = parseFloat(String(v ?? 0)) || 0;
  return new Intl.NumberFormat("id-ID", { style: "currency", currency: "IDR", maximumFractionDigits: 0 }).format(n);
}
function fmtNum(v: unknown) {
  return new Intl.NumberFormat("id-ID").format(parseFloat(String(v ?? 0)) || 0);
}

type DashboardData = {
  kpi: Record<string, unknown>;
  trend: Array<Record<string, unknown>>;
  topDrivers: Array<Record<string, unknown>>;
  outstanding: Record<string, unknown>;
  rawTotals: Record<string, unknown>;
  lastUploadDate: string | null;
};

type OutstandingRow = {
  id: number;
  driver_name: string;
  driver_phone: string;
  vehicle_plate: string;
  rental_fee_daily: number;
  outstanding_amount: number;
  status: string;
};

type OstSortCol = "driver_name" | "rental_fee_daily" | "outstanding_amount";

function genMonthOptions() {
  const opts: { label: string; value: string }[] = [];
  const now = new Date();
  for (let i = 0; i < 12; i++) {
    const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
    const val = `m:${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
    const label = d.toLocaleDateString("id-ID", { month: "long", year: "numeric" });
    opts.push({ label, value: val });
  }
  return opts;
}
const MONTH_OPTIONS = genMonthOptions();

function buildTemplate(name: string, plate: string, phone: string, amount: string): string {
  return (
    `*Pemberitahuan Pembayaran Rental Fee*\n\n` +
    `Nama Driver: ${name}\nNomor Kendaraan: ${plate}\nNomor Telepon: ${phone}\nTotal Outstanding: ${amount}\n\n` +
    `*Instruksi Pembayaran*\n\n` +
    `Kami mohon agar pembayaran rental fee segera dilakukan melalui salah satu cara berikut:\n\n` +
    `Top-up Saldo GoPay\nSilakan isi saldo GoPay sesuai nominal outstanding di atas.\n` +
    `Transfer Bank ke Rekening Perusahaan\nLakukan transfer ke rekening resmi perusahaan. ` +
    `Pastikan mencantumkan nama driver dan nomor kendaraan pada kolom keterangan untuk proses rekonsiliasi.\n\n` +
    `*Catatan Penting:*\n\nPembayaran tepat waktu sangat membantu kelancaran operasional.\n` +
    `Simpan bukti pembayaran untuk verifikasi lebih lanjut.`
  );
}
const BULK_HINT = buildTemplate("{nama}", "{plat}", "{hp}", "{jumlah}");

export default function FleetIntelligenceDashboard() {
  const qc = useQueryClient();
  const [search, setSearch] = useState("");
  const [showHighOnly, setShowHighOnly] = useState(false);
  const [sortCol, setSortCol] = useState<OstSortCol>("outstanding_amount");
  const [sortDir, setSortDir] = useState<"asc" | "desc">("desc");
  const [waPreview, setWaPreview] = useState<{ id: number; phone: string; name: string; plate: string; message: string; defaultMessage: string } | null>(null);
  const [waSending, setWaSending] = useState(false);
  const [selectedIds, setSelectedIds] = useState<Set<number>>(new Set());
  const [waBlastOpen, setWaBlastOpen] = useState(false);
  const [period, setPeriod] = useState("30");

  const periodLabel = (() => {
    if (period === "7") return "7 Hari Terakhir";
    if (period === "14") return "14 Hari Terakhir";
    if (period === "30") return "30 Hari Terakhir";
    if (period === "60") return "60 Hari Terakhir";
    if (period === "90") return "90 Hari Terakhir";
    if (period === "365") return "1 Tahun Terakhir";
    const mo = MONTH_OPTIONS.find((o) => o.value === period);
    return mo ? mo.label : period;
  })();

  const { data, isLoading, refetch } = useQuery({
    queryKey: ["fleet-dashboard", period],
    queryFn: async () => {
      const params = new URLSearchParams();
      if (period.startsWith("m:")) {
        params.set("month", period.slice(2));
      } else {
        params.set("days", period);
      }
      const res = await fetch(`/api/logistics/fleet/dashboard?${params}`, { credentials: "include" });
      return res.json();
    },
  });

  const { data: ostData, isLoading: ostLoading, refetch: ostRefetch } = useQuery({
    queryKey: ["fleet-outstanding-index"],
    queryFn: async () => {
      const res = await fetch("/api/logistics/fleet/outstanding?status=open", { credentials: "include" });
      return res.json() as Promise<{ outstanding: OutstandingRow[]; summary: Record<string, unknown> }>;
    },
  });

  const repairMutation = useMutation({
    mutationFn: async () => {
      const res = await fetch("/api/logistics/fleet/outstanding/repair", {
        method: "POST", credentials: "include",
      });
      if (!res.ok) throw new Error("Gagal perbaiki outstanding");
      return res.json() as Promise<{ ok: boolean; summary: Record<string, unknown> }>;
    },
    onSuccess: (d) => {
      toast.success(`Outstanding diperbarui: ${fmtIdr(d.summary?.total)} (${fmtNum(d.summary?.drivers)} driver)`);
      qc.invalidateQueries({ queryKey: ["fleet-dashboard"] });
      qc.invalidateQueries({ queryKey: ["fleet-outstanding-index"] });
      refetch();
      ostRefetch();
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const waBlastMutation = useMutation({
    mutationFn: async (ids: number[]) => {
      const res = await fetch("/api/logistics/fleet/outstanding/wa-blast", {
        method: "POST", credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ids }),
      });
      if (!res.ok) throw new Error("Gagal kirim WA blast");
      return res.json() as Promise<{ ok: boolean; sent: number; failed: number; total: number }>;
    },
    onSuccess: (d) => {
      toast.success(`WA terkirim ke ${d.sent} driver${d.failed > 0 ? `, ${d.failed} gagal` : ""}`);
      setWaBlastOpen(false);
      setSelectedIds(new Set());
      qc.invalidateQueries({ queryKey: ["fleet-outstanding-index"] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const kpi = data?.kpi ?? {};
  const trend = data?.trend ?? [];
  const topDrivers = data?.topDrivers ?? [];
  const outstandingSummary = data?.outstanding ?? {};
  const rawTotals = data?.rawTotals ?? {};
  const lastUploadDate = data?.lastUploadDate ?? null;
  const fmtUploadDate = lastUploadDate
    ? new Date(lastUploadDate).toLocaleDateString("id-ID", { day: "numeric", month: "short", year: "numeric" })
    : null;
  const rawOutstanding = parseFloat(String(rawTotals.raw_outstanding_total ?? 0));
  const tableOutstanding = parseFloat(String(outstandingSummary?.total_amount ?? 0));
  const outstandingStale = rawOutstanding > 0 && Math.abs(rawOutstanding - tableOutstanding) / rawOutstanding > 0.01;

  function openWaModal(o: OutstandingRow) {
    const phone = String(o.driver_phone ?? "").trim();
    const name = String(o.driver_name ?? "");
    const plate = String(o.vehicle_plate ?? "-");
    const amount = fmtIdr(parseFloat(String(o.outstanding_amount ?? 0)));
    const msg = buildTemplate(name, plate, phone, amount);
    setWaPreview({ id: o.id, phone, name, plate, message: msg, defaultMessage: msg });
  }

  async function sendWa() {
    if (!waPreview) return;
    setWaSending(true);
    try {
      const res = await fetch(`/api/logistics/fleet/outstanding/${waPreview.id}/wa`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ phone: waPreview.phone, message: waPreview.message }),
      });
      const d = await res.json();
      if (!res.ok) throw new Error(d?.error ?? "Gagal kirim WA");
      toast.success(`WA berhasil dikirim ke ${waPreview.name}`);
      setWaPreview(null);
    } catch (e: unknown) {
      toast.error(e instanceof Error ? e.message : "Gagal kirim WA");
    } finally {
      setWaSending(false);
    }
  }

  function toggleSelect(id: number) {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });
  }
  function toggleSelectAll() {
    const visibleIds = filteredRows.map((o) => o.id);
    const allSelected = visibleIds.length > 0 && visibleIds.every((id) => selectedIds.has(id));
    if (allSelected) {
      setSelectedIds((prev) => { const next = new Set(prev); visibleIds.forEach((id) => next.delete(id)); return next; });
    } else {
      setSelectedIds((prev) => { const next = new Set(prev); visibleIds.forEach((id) => next.add(id)); return next; });
    }
  }

  function toggleSort(col: OstSortCol) {
    if (sortCol === col) setSortDir((d) => (d === "asc" ? "desc" : "asc"));
    else { setSortCol(col); setSortDir("desc"); }
  }

  function SortIcon({ col }: { col: OstSortCol }) {
    if (sortCol !== col) return <ArrowUpDown className="w-3.5 h-3.5 ml-1 opacity-40" />;
    return sortDir === "asc"
      ? <ArrowUp className="w-3.5 h-3.5 ml-1 text-indigo-400" />
      : <ArrowDown className="w-3.5 h-3.5 ml-1 text-indigo-400" />;
  }

  const { filteredRows, highCount, totalOutstanding, allDriverCount } = useMemo(() => {
    const rows = ostData?.outstanding ?? [];
    const highCount = rows.filter((r) => parseFloat(String(r.outstanding_amount ?? 0)) >= 1_000_000).length;
    const totalOutstanding = rows.reduce((s, r) => s + (parseFloat(String(r.outstanding_amount ?? 0)) || 0), 0);
    const allDriverCount = rows.length;
    const q = search.toLowerCase();
    let filtered = q
      ? rows.filter((r) =>
          String(r.driver_name ?? "").toLowerCase().includes(q) ||
          String(r.vehicle_plate ?? "").toLowerCase().includes(q) ||
          String(r.driver_phone ?? "").toLowerCase().includes(q)
        )
      : rows;
    if (showHighOnly) filtered = filtered.filter((r) => parseFloat(String(r.outstanding_amount ?? 0)) >= 1_000_000);
    const sorted = [...filtered].sort((a, b) => {
      const mul = sortDir === "asc" ? 1 : -1;
      if (sortCol === "driver_name") return mul * String(a.driver_name ?? "").localeCompare(String(b.driver_name ?? ""));
      if (sortCol === "rental_fee_daily") return mul * (parseFloat(String(a.rental_fee_daily ?? 0)) - parseFloat(String(b.rental_fee_daily ?? 0)));
      return mul * (parseFloat(String(a.outstanding_amount ?? 0)) - parseFloat(String(b.outstanding_amount ?? 0)));
    });
    return { filteredRows: sorted, highCount, totalOutstanding, allDriverCount };
  }, [ostData?.outstanding, search, showHighOnly, sortCol, sortDir]);

  return (
    <AppShell>
      <div className="space-y-6">
        <Link href="/logistics">
          <Button variant="ghost" size="sm" className="text-slate-400 hover:text-white gap-1.5 -ml-2">
            <ArrowLeft className="w-4 h-4" /> Logistics
          </Button>
        </Link>

        <div className="flex items-center justify-between flex-wrap gap-3">
          <div>
            <h1 className="text-2xl font-bold text-white">Gojek Fleet Intelligence</h1>
            <p className="text-slate-400 text-sm mt-1">
              Dashboard KPI armada & analitik performa driver
              {" · "}<span className="text-blue-400 font-medium">{periodLabel}</span>
            </p>
          </div>
          <div className="flex items-center gap-3 flex-wrap">
            <Select value={period} onValueChange={setPeriod}>
              <SelectTrigger className="w-44 bg-slate-800 border-slate-700 text-white">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="7">7 Hari Terakhir</SelectItem>
                <SelectItem value="14">14 Hari Terakhir</SelectItem>
                <SelectItem value="30">30 Hari Terakhir</SelectItem>
                <SelectItem value="60">60 Hari Terakhir</SelectItem>
                <SelectItem value="90">90 Hari Terakhir</SelectItem>
                <SelectItem value="365">1 Tahun Terakhir</SelectItem>
                <div className="px-2 py-1 text-xs text-slate-500 font-medium border-t border-slate-700 mt-1 pt-2">Per Bulan</div>
                {MONTH_OPTIONS.map((o) => (
                  <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Button
              variant="outline" size="sm"
              className="gap-2 border-amber-600 text-amber-400 hover:bg-amber-900/20"
              disabled={repairMutation.isPending}
              onClick={() => repairMutation.mutate()}
            >
              <Wrench className="w-4 h-4" />
              {repairMutation.isPending ? "Menghitung..." : "Perbaiki Outstanding"}
            </Button>
            <Button variant="outline" size="sm" onClick={() => { refetch(); ostRefetch(); }} className="gap-2">
              <RefreshCw className="w-4 h-4" /> Refresh
            </Button>
            <Link href="/logistics/fleet-intelligence/upload">
              <Button size="sm" className="bg-green-600 hover:bg-green-700">+ Upload Report</Button>
            </Link>
          </div>
        </div>

        {/* Outstanding KPI Cards */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          <Card className="bg-amber-900/20 border-amber-700/40">
            <CardContent className="p-5">
              <div className="w-10 h-10 rounded-xl bg-amber-400/10 flex items-center justify-center mb-3">
                <DollarSign className="w-5 h-5 text-amber-400" />
              </div>
              {ostLoading ? (
                <div className="h-7 bg-slate-700 rounded animate-pulse mb-1 w-2/3" />
              ) : (
                <div className="text-2xl font-bold text-amber-300">{fmtIdr(totalOutstanding)}</div>
              )}
              <div className="text-sm text-slate-400 mt-1">Total Outstanding Belum Lunas</div>
              <div className="text-xs text-slate-500 mt-0.5">All-time · status open</div>
            </CardContent>
          </Card>

          <Card className="bg-blue-900/20 border-blue-700/40">
            <CardContent className="p-5">
              <div className="w-10 h-10 rounded-xl bg-blue-400/10 flex items-center justify-center mb-3">
                <Users className="w-5 h-5 text-blue-400" />
              </div>
              {ostLoading ? (
                <div className="h-7 bg-slate-700 rounded animate-pulse mb-1 w-1/3" />
              ) : (
                <div className="text-2xl font-bold text-blue-300">{fmtNum(allDriverCount)}</div>
              )}
              <div className="text-sm text-slate-400 mt-1">Jumlah Driver Belum Lunas</div>
              <div className="text-xs text-slate-500 mt-0.5">Driver dengan saldo hutang aktif</div>
            </CardContent>
          </Card>

          <Card className="bg-red-900/20 border-red-700/40">
            <CardContent className="p-5">
              <div className="w-10 h-10 rounded-xl bg-red-400/10 flex items-center justify-center mb-3">
                <AlertTriangle className="w-5 h-5 text-red-400" />
              </div>
              {ostLoading ? (
                <div className="h-7 bg-slate-700 rounded animate-pulse mb-1 w-1/4" />
              ) : (
                <div className="text-2xl font-bold text-red-300">{fmtNum(highCount)}</div>
              )}
              <div className="text-sm text-slate-400 mt-1">Driver Outstanding Tinggi</div>
              <div className="text-xs text-slate-500 mt-0.5">Outstanding ≥ Rp 1.000.000</div>
            </CardContent>
          </Card>
        </div>

        {/* Outstanding Alert */}
        {rawOutstanding > 0 && (
          <Card className={`border ${outstandingStale ? "bg-red-900/20 border-red-700/40" : "bg-amber-900/20 border-amber-700/40"}`}>
            <CardContent className="p-4 flex items-center justify-between flex-wrap gap-3">
              <div className="flex items-center gap-3">
                <AlertTriangle className={`w-5 h-5 ${outstandingStale ? "text-red-400" : "text-amber-400"}`} />
                <div>
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className={`font-medium ${outstandingStale ? "text-red-300" : "text-amber-300"}`}>
                      Outstanding Belum Lunas:{" "}
                    </span>
                    <span className="text-white font-bold">{fmtIdr(rawOutstanding)}</span>
                    <span className="text-slate-400 text-sm">
                      ({fmtNum(outstandingSummary.count)} driver)
                    </span>
                    <Badge className="bg-slate-700 text-slate-300 border-slate-600 text-xs">
                      <Database className="w-3 h-3 mr-1" />
                      dari raw CSV
                    </Badge>
                    <Badge className="bg-blue-900/50 text-blue-300 border-blue-700/50 text-xs">
                      <Clock className="w-3 h-3 mr-1" />
                      All-time
                    </Badge>
                  </div>
                  {outstandingStale && (
                    <p className="text-red-300 text-xs mt-1">
                      ⚠ Data tabel berbeda dengan CSV ({fmtIdr(tableOutstanding)}) — klik "Perbaiki Outstanding"
                    </p>
                  )}
                </div>
              </div>
              <div className="flex gap-2">
                {outstandingStale && (
                  <Button
                    size="sm"
                    className="bg-red-700 hover:bg-red-600 gap-1.5"
                    disabled={repairMutation.isPending}
                    onClick={() => repairMutation.mutate()}
                  >
                    <Wrench className="w-3.5 h-3.5" />
                    {repairMutation.isPending ? "Memperbaiki..." : "Perbaiki Sekarang"}
                  </Button>
                )}
                <Link href="/logistics/fleet-intelligence/outstanding">
                  <Button variant="outline" size="sm" className="border-amber-600 text-amber-400 hover:bg-amber-900/30">
                    Lihat Detail
                  </Button>
                </Link>
              </div>
            </CardContent>
          </Card>
        )}

        {/* Charts */}
        <div className="grid grid-cols-1 xl:grid-cols-2 gap-6">
          <Card className="bg-slate-800/60 border-slate-700">
            <CardHeader className="pb-2">
              <CardTitle className="text-white text-base">Tren Payout Driver</CardTitle>
            </CardHeader>
            <CardContent>
              {isLoading ? (
                <div className="h-48 bg-slate-700/40 rounded animate-pulse" />
              ) : (
                <ResponsiveContainer width="100%" height={220}>
                  <LineChart data={trend}>
                    <CartesianGrid strokeDasharray="3 3" stroke="#334155" />
                    <XAxis dataKey="summary_date" tick={{ fill: "#94a3b8", fontSize: 11 }} tickFormatter={(v) => String(v).slice(5)} />
                    <YAxis tick={{ fill: "#94a3b8", fontSize: 11 }} tickFormatter={(v) => `${(v / 1_000_000).toFixed(1)}M`} />
                    <Tooltip
                      contentStyle={{ background: "#1e293b", border: "1px solid #334155", borderRadius: 8 }}
                      labelStyle={{ color: "#94a3b8" }}
                      formatter={(v: number) => [fmtIdr(v), "Net Revenue"]}
                    />
                    <Line type="monotone" dataKey="net_revenue" stroke="#22d3ee" strokeWidth={2} dot={false} />
                    <Line type="monotone" dataKey="gross_revenue" stroke="#818cf8" strokeWidth={1.5} dot={false} strokeDasharray="4 2" />
                  </LineChart>
                </ResponsiveContainer>
              )}
            </CardContent>
          </Card>

          <Card className="bg-slate-800/60 border-slate-700">
            <CardHeader className="pb-2">
              <CardTitle className="text-white text-base">Driver Aktif per Hari</CardTitle>
            </CardHeader>
            <CardContent>
              {isLoading ? (
                <div className="h-48 bg-slate-700/40 rounded animate-pulse" />
              ) : (
                <ResponsiveContainer width="100%" height={220}>
                  <BarChart data={trend}>
                    <CartesianGrid strokeDasharray="3 3" stroke="#334155" />
                    <XAxis dataKey="summary_date" tick={{ fill: "#94a3b8", fontSize: 11 }} tickFormatter={(v) => String(v).slice(5)} />
                    <YAxis tick={{ fill: "#94a3b8", fontSize: 11 }} />
                    <Tooltip
                      contentStyle={{ background: "#1e293b", border: "1px solid #334155", borderRadius: 8 }}
                      labelStyle={{ color: "#94a3b8" }}
                    />
                    <Bar dataKey="active_drivers" fill="#34d399" radius={[2, 2, 0, 0]} name="Driver Aktif" />
                  </BarChart>
                </ResponsiveContainer>
              )}
            </CardContent>
          </Card>
        </div>

        {/* Outstanding Driver Table */}
        <Card className="bg-slate-800/60 border-slate-700">
          <CardHeader className="pb-2">
            <div className="flex items-center justify-between flex-wrap gap-3">
              <div>
                <CardTitle className="text-white text-base">Daftar Outstanding Driver</CardTitle>
                <p className="text-slate-400 text-xs mt-0.5">
                  Driver dengan saldo hutang belum lunas
                  {filteredRows.length > 0 && (
                    <span className="ml-1 text-cyan-400 font-medium">({filteredRows.length} driver)</span>
                  )}
                </p>
              </div>
              <div className="flex items-center gap-2 flex-wrap">
                {selectedIds.size > 0 && (
                  <>
                    <Button size="sm" className="h-8 text-xs gap-1.5 bg-green-700 hover:bg-green-600 text-white"
                      onClick={() => setWaBlastOpen(true)}>
                      <Send className="w-3.5 h-3.5" />
                      Kirim WA ke Terpilih ({selectedIds.size})
                    </Button>
                    <Button size="sm" variant="outline"
                      className="h-8 text-xs border-slate-600 text-slate-400 hover:bg-slate-700"
                      onClick={() => setSelectedIds(new Set())}>
                      Batalkan ({selectedIds.size} dipilih)
                    </Button>
                  </>
                )}
                <Button
                  size="sm"
                  variant={showHighOnly ? "default" : "outline"}
                  className={`h-8 text-xs gap-1.5 ${showHighOnly ? "bg-red-700 hover:bg-red-600 border-red-600 text-white" : "border-slate-600 text-slate-300 hover:bg-slate-700"}`}
                  onClick={() => setShowHighOnly((v) => !v)}
                  disabled={ostLoading}
                >
                  <AlertTriangle className="w-3.5 h-3.5" />
                  {showHighOnly ? "Semua Driver" : "Outstanding Tinggi"}
                  {!showHighOnly && highCount > 0 && (
                    <span className="ml-0.5 bg-red-600 text-white rounded-full text-[10px] w-4 h-4 inline-flex items-center justify-center font-bold">
                      {highCount}
                    </span>
                  )}
                </Button>
                <div className="relative w-52">
                  <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-slate-400" />
                  <Input
                    value={search}
                    onChange={(e) => setSearch(e.target.value)}
                    placeholder="Cari nama / plat / no HP..."
                    className="pl-8 h-8 text-xs bg-slate-700 border-slate-600 text-white placeholder:text-slate-500"
                  />
                </div>
                <Link href="/logistics/fleet-intelligence/outstanding">
                  <Button variant="outline" size="sm" className="h-8 text-xs border-slate-600 text-slate-300 hover:bg-slate-700">
                    Lihat Semua →
                  </Button>
                </Link>
              </div>
            </div>
          </CardHeader>
          <CardContent className="p-0">
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="border-b border-slate-700">
                  <tr>
                    <th className="px-3 py-3 w-8">
                      <input type="checkbox" className="w-3.5 h-3.5 accent-indigo-500"
                        checked={filteredRows.length > 0 && filteredRows.every((o) => selectedIds.has(o.id))}
                        onChange={toggleSelectAll} />
                    </th>
                    <th className="text-left px-4 py-3 text-slate-400 font-medium whitespace-nowrap">
                      <button className="flex items-center hover:text-white transition-colors" onClick={() => toggleSort("driver_name")}>
                        Driver Name <SortIcon col="driver_name" />
                      </button>
                    </th>
                    <th className="text-left px-4 py-3 text-slate-400 font-medium whitespace-nowrap">Phone Number</th>
                    <th className="text-left px-4 py-3 text-slate-400 font-medium whitespace-nowrap">License Plate</th>
                    <th className="text-left px-4 py-3 text-slate-400 font-medium whitespace-nowrap">
                      <button className="flex items-center hover:text-white transition-colors" onClick={() => toggleSort("rental_fee_daily")}>
                        Rental fee (Daily) <SortIcon col="rental_fee_daily" />
                      </button>
                    </th>
                    <th className="text-left px-4 py-3 text-slate-400 font-medium whitespace-nowrap">
                      <button className="flex items-center hover:text-white transition-colors" onClick={() => toggleSort("outstanding_amount")}>
                        Outstanding <SortIcon col="outstanding_amount" />
                      </button>
                    </th>
                    <th className="text-left px-4 py-3 text-slate-400 font-medium whitespace-nowrap">Status</th>
                    <th className="text-left px-4 py-3 text-slate-400 font-medium whitespace-nowrap">Aksi</th>
                  </tr>
                </thead>
                <tbody>
                  {ostLoading
                    ? Array.from({ length: 6 }).map((_, i) => (
                        <tr key={i} className="border-b border-slate-700/40">
                          <td colSpan={8} className="px-4 py-2">
                            <div className="h-4 bg-slate-700 rounded animate-pulse" />
                          </td>
                        </tr>
                      ))
                    : filteredRows.length === 0
                    ? (
                        <tr>
                          <td colSpan={8} className="px-4 py-12 text-center text-slate-500 text-sm">
                            <CheckCircle className="w-10 h-10 mx-auto mb-2 opacity-40 text-emerald-500" />
                            <p>{search ? "Tidak ada driver yang cocok" : "Tidak ada outstanding yang belum lunas"}</p>
                          </td>
                        </tr>
                      )
                    : filteredRows.map((o) => {
                        const amount = parseFloat(String(o.outstanding_amount ?? 0));
                        const isHigh = amount >= 1_000_000;
                        const isAbove500k = amount >= 500_000;
                        const rentalFee = parseFloat(String(o.rental_fee_daily ?? 0));
                        const isSelected = selectedIds.has(o.id);
                        return (
                          <tr key={o.id} className={`border-b border-slate-700/30 hover:bg-slate-700/20 transition-colors ${isSelected ? "bg-indigo-900/10" : isHigh ? "bg-red-950/10" : ""}`}>
                            <td className="px-3 py-3">
                              <input type="checkbox" className="w-3.5 h-3.5 accent-indigo-500"
                                checked={isSelected} onChange={() => toggleSelect(o.id)} />
                            </td>
                            <td className="px-4 py-3 font-medium text-white text-sm">{String(o.driver_name ?? "-")}</td>
                            <td className="px-4 py-3 text-slate-400 text-xs">{String(o.driver_phone ?? "-")}</td>
                            <td className="px-4 py-3 text-slate-400 font-mono text-xs">{String(o.vehicle_plate ?? "-")}</td>
                            <td className="px-4 py-3 text-slate-300 text-xs tabular-nums">
                              {rentalFee > 0 ? fmtIdr(rentalFee) : "—"}
                            </td>
                            <td className={`px-4 py-3 font-bold tabular-nums text-sm ${isHigh ? "text-red-400" : isAbove500k ? "text-amber-400" : "text-slate-300"}`}>
                              {fmtIdr(amount)}
                            </td>
                            <td className="px-4 py-3">
                              <Badge className={String(o.status) === "open"
                                ? "bg-amber-500/20 text-amber-300 border border-amber-600 text-xs"
                                : "bg-emerald-500/20 text-emerald-300 border border-emerald-600 text-xs"}>
                                {String(o.status) === "open" ? "Active" : String(o.status)}
                              </Badge>
                            </td>
                            <td className="px-4 py-3">
                              {Boolean(String(o.driver_phone ?? "").trim()) && (
                                <Button size="sm" variant="outline"
                                  className="border-green-600 text-green-400 hover:bg-green-900/30 h-7 text-xs gap-1"
                                  onClick={() => openWaModal(o)}>
                                  <MessageCircle className="w-3 h-3" /> Kirim WA
                                </Button>
                              )}
                            </td>
                          </tr>
                        );
                      })
                  }
                </tbody>
              </table>
            </div>
          </CardContent>
        </Card>

        {/* Top Drivers */}
        <Card className="bg-slate-800/60 border-slate-700">
          <CardHeader className="pb-2 flex flex-row items-center justify-between">
            <div>
              <CardTitle className="text-white text-base">Top 10 Driver</CardTitle>
              {fmtUploadDate && (
                <p className="text-xs text-slate-500 mt-0.5">
                  Data per: <span className="text-slate-400 font-medium">{fmtUploadDate}</span>
                </p>
              )}
            </div>
            <Link href="/logistics/fleet-intelligence/outstanding">
              <Button variant="ghost" size="sm" className="text-slate-400 hover:text-white">Lihat Semua →</Button>
            </Link>
          </CardHeader>
          <CardContent>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-slate-700">
                    <th className="text-left py-2 text-slate-400 font-medium">#</th>
                    <th className="text-left py-2 text-slate-400 font-medium">Driver</th>
                    <th className="text-left py-2 text-slate-400 font-medium">Plat</th>
                    <th className="text-right py-2 text-slate-400 font-medium">Trip</th>
                    <th className="text-right py-2 text-slate-400 font-medium">Outstanding</th>
                  </tr>
                </thead>
                <tbody>
                  {isLoading
                    ? Array.from({ length: 5 }).map((_, i) => (
                        <tr key={i} className="border-b border-slate-700/50">
                          <td colSpan={5} className="py-2"><div className="h-4 bg-slate-700 rounded animate-pulse" /></td>
                        </tr>
                      ))
                    : topDrivers.map((d: any, i: number) => {
                        const amt = parseFloat(String(d.outstanding ?? 0));
                        const amtColor = amt >= 1_000_000
                          ? "text-red-400"
                          : amt >= 500_000
                          ? "text-amber-400"
                          : "text-emerald-400";
                        const rowBg = amt >= 1_000_000
                          ? "border-red-900/40 bg-red-950/20"
                          : amt >= 500_000
                          ? "border-amber-900/40 bg-amber-950/10"
                          : "border-slate-700/50";
                        return (
                          <tr key={i} className={`border-b ${rowBg} hover:bg-slate-700/30 transition-colors`}>
                            <td className="py-2 pr-2 text-slate-400">{i + 1}</td>
                            <td className="py-2 font-medium text-white">{String(d.name)}</td>
                            <td className="py-2">
                              <span className="text-xs font-mono bg-slate-700 text-slate-300 px-1.5 py-0.5 rounded">
                                {String(d.vehicle_plate ?? "-")}
                              </span>
                            </td>
                            <td className="py-2 text-right text-slate-300">{fmtNum(d.trips)}</td>
                            <td className={`py-2 text-right font-semibold ${amtColor}`}>{fmtIdr(d.outstanding)}</td>
                          </tr>
                        );
                      })}
                </tbody>
              </table>
            </div>
          </CardContent>
        </Card>

        {/* Quick Links */}
        <div className="grid grid-cols-2 md:grid-cols-5 gap-4">
          {[
            { label: "Upload Report", href: "/logistics/fleet-intelligence/upload", color: "bg-blue-600 hover:bg-blue-700" },
            { label: "Outstanding", href: "/logistics/fleet-intelligence/outstanding", color: "bg-amber-600 hover:bg-amber-700" },
            { label: "Drivers", href: "/logistics/fleet-intelligence/drivers", color: "bg-purple-600 hover:bg-purple-700" },
            { label: "Transactions", href: "/logistics/fleet-intelligence/transactions", color: "bg-slate-600 hover:bg-slate-700" },
            { label: "Alerts", href: "/logistics/fleet-intelligence/alerts", color: "bg-red-600 hover:bg-red-700" },
            { label: "Fleet Expenses", href: "/logistics/fleet-intelligence/expenses", color: "bg-orange-600 hover:bg-orange-700" },
          ].map((l) => (
            <Link key={l.href} href={l.href}>
              <Button className={`w-full ${l.color}`}>{l.label}</Button>
            </Link>
          ))}
        </div>
      </div>

      {waBlastOpen && (
        <Dialog open onOpenChange={() => setWaBlastOpen(false)}>
          <DialogContent className="bg-slate-800 border-slate-700 text-white max-w-lg">
            <DialogHeader>
              <DialogTitle className="flex items-center gap-2">
                <Send className="w-5 h-5 text-green-400" />
                Kirim WA ke {selectedIds.size} Driver Terpilih
              </DialogTitle>
              <DialogDescription className="text-slate-400 text-xs">
                Pesan dikirim dengan nama, plat, HP, dan jumlah outstanding masing-masing driver.
              </DialogDescription>
            </DialogHeader>
            <div className="space-y-3">
              <div className="bg-slate-900 border border-slate-700 rounded-md max-h-52 overflow-y-auto divide-y divide-slate-700/60">
                {filteredRows.filter((o) => selectedIds.has(o.id)).map((o) => {
                  const phone = String(o.driver_phone ?? "").trim();
                  const amount = parseFloat(String(o.outstanding_amount ?? 0));
                  const isHigh = amount >= 1_000_000;
                  const isAbove500k = amount >= 500_000;
                  return (
                    <div key={o.id} className="flex items-center justify-between px-3 py-2 gap-3">
                      <div className="flex items-center gap-2 min-w-0">
                        <input type="checkbox" className="w-3 h-3 accent-indigo-500 flex-shrink-0"
                          checked onChange={() => toggleSelect(o.id)} />
                        <div className="min-w-0">
                          <p className="text-white text-xs font-medium truncate">{String(o.driver_name)}</p>
                          <p className="text-slate-500 text-[11px]">{phone || <span className="italic text-red-400">No HP tidak ada</span>}</p>
                        </div>
                      </div>
                      <span className={`text-xs font-bold tabular-nums flex-shrink-0 ${isHigh ? "text-red-400" : isAbove500k ? "text-amber-400" : "text-slate-300"}`}>
                        {fmtIdr(amount)}
                      </span>
                    </div>
                  );
                })}
              </div>
              {(() => {
                const noPhone = filteredRows.filter((o) => selectedIds.has(o.id) && !String(o.driver_phone ?? "").trim()).length;
                return noPhone > 0 ? (
                  <p className="text-amber-400 text-xs flex items-center gap-1.5">
                    <AlertTriangle className="w-3.5 h-3.5" />
                    {noPhone} driver tidak memiliki nomor HP — akan dilewati otomatis.
                  </p>
                ) : null;
              })()}
              <Label className="text-slate-300 text-sm">Preview Template Pesan</Label>
              <div className="bg-slate-900 border border-slate-700 rounded-md p-3 text-xs font-mono text-slate-300 leading-relaxed whitespace-pre-wrap max-h-40 overflow-y-auto">
                {BULK_HINT}
              </div>
              <p className="text-slate-500 text-xs">Nama, plat, HP, dan jumlah outstanding diisi otomatis per driver.</p>
              <div className="flex gap-3 pt-1">
                <Button variant="outline" className="flex-1 border-slate-600" onClick={() => setWaBlastOpen(false)}>Batal</Button>
                <Button className="flex-1 bg-green-600 hover:bg-green-700 gap-2"
                  disabled={waBlastMutation.isPending || selectedIds.size === 0}
                  onClick={() => waBlastMutation.mutate(Array.from(selectedIds))}>
                  <Send className="w-4 h-4" />
                  {waBlastMutation.isPending ? "Mengirim..." : `Kirim ke ${selectedIds.size} Driver`}
                </Button>
              </div>
            </div>
          </DialogContent>
        </Dialog>
      )}

      {waPreview && (
        <Dialog open onOpenChange={() => setWaPreview(null)}>
          <DialogContent className="bg-slate-800 border-slate-700 text-white max-w-lg">
            <DialogHeader>
              <DialogTitle className="flex items-center gap-2">
                <MessageCircle className="w-5 h-5 text-green-400" />
                Kirim WA — {waPreview.name}
              </DialogTitle>
              <DialogDescription className="text-slate-400 text-xs">
                Nomor: {waPreview.phone} · Edit pesan sebelum mengirim
              </DialogDescription>
            </DialogHeader>
            <div className="space-y-3">
              <div className="flex items-center justify-between">
                <Label className="text-slate-300 text-sm">Pesan WhatsApp</Label>
                <Button variant="ghost" size="sm"
                  className="h-6 text-xs text-slate-400 hover:text-white gap-1"
                  onClick={() => setWaPreview({ ...waPreview, message: waPreview.defaultMessage })}>
                  <RotateCcw className="w-3 h-3" /> Reset
                </Button>
              </div>
              <Textarea
                value={waPreview.message}
                onChange={(e) => setWaPreview({ ...waPreview, message: e.target.value })}
                className="bg-slate-900 border-slate-600 text-white resize-none font-mono text-xs leading-relaxed"
                rows={17}
              />
              <p className="text-slate-500 text-xs">Teks <code className="bg-slate-700 px-1 rounded">*bintang*</code> tampil <strong>bold</strong> di WhatsApp.</p>
              <div className="flex gap-3 pt-1">
                <Button variant="outline" className="flex-1 border-slate-600" onClick={() => setWaPreview(null)}>Batal</Button>
                <Button className="flex-1 bg-green-600 hover:bg-green-700 gap-2"
                  disabled={waSending || !waPreview.message.trim()} onClick={sendWa}>
                  <Send className="w-4 h-4" />
                  {waSending ? "Mengirim..." : "Kirim WA"}
                </Button>
              </div>
            </div>
          </DialogContent>
        </Dialog>
      )}
    </AppShell>
  );
}
