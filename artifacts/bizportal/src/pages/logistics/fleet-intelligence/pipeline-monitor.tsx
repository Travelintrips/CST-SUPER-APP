import { DatePicker } from "@/components/ui/date-picker";
import { useState, useCallback } from "react";
import { useQuery } from "@tanstack/react-query";
import { AppShell } from "@/components/layout/AppShell";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Activity, AlertTriangle, Download, RefreshCw, Search,
  TrendingDown, TrendingUp, Users, Car, FileText, ChevronRight,
  ChevronLeft, BarChart2, Phone, ArrowLeft,
} from "lucide-react";
import { Link } from "wouter";
import { toast } from "sonner";

const BASE = "/api/logistics/fleet";

function fmtNum(v: unknown) {
  return Number(v ?? 0).toLocaleString("id-ID");
}
function fmtAmt(v: unknown) {
  const n = Number(v ?? 0);
  return (n >= 0 ? "+" : "") + n.toLocaleString("id-ID");
}
function fmtDate(v: unknown) {
  if (!v || String(v) === "0001-01-01") return "—";
  return String(v);
}

type MonitorRow = {
  driver_external_id: string;
  driver_name: string;
  phone_number: string;
  vehicle: string;
  tx_count: number;
  total_debit: number;
  total_credit: number;
  net_flow: number;
  latest_outstanding: number;
  date_first: string;
  date_last: string;
  type_count: number;
  dedup_refs: number;
  last_report_id: number;
  is_high_risk: boolean;
};

type MonitorData = {
  drivers: MonitorRow[];
  summary: {
    total_rows: number;
    driver_count: number;
    vehicle_count: number;
    total_debit: number;
    total_credit: number;
    net_flow: number;
  };
  transactionTypes: string[];
  pagination: { page: number; limit: number; offset: number; totalDrivers: number };
  debitThreshold: number;
};

export default function PipelineMonitorPage() {
  const [filters, setFilters] = useState({
    driverName: "",
    driverExtId: "",
    dateFrom: "",
    dateTo: "",
    transactionType: "",
    reportId: "",
    minDebit: "-50000",
  });
  const [applied, setApplied] = useState(filters);
  const [page, setPage] = useState(1);
  const [exporting, setExporting] = useState(false);

  const queryParams = useCallback(() => {
    const p = new URLSearchParams();
    if (applied.driverName)      p.set("driverName", applied.driverName);
    if (applied.driverExtId)     p.set("driverExtId", applied.driverExtId);
    if (applied.dateFrom)        p.set("dateFrom", applied.dateFrom);
    if (applied.dateTo)          p.set("dateTo", applied.dateTo);
    if (applied.transactionType) p.set("transactionType", applied.transactionType);
    if (applied.reportId)        p.set("reportId", applied.reportId);
    if (applied.minDebit)        p.set("minDebit", applied.minDebit);
    p.set("page", String(page));
    p.set("limit", "50");
    return p.toString();
  }, [applied, page]);

  const { data, isLoading, refetch } = useQuery<MonitorData>({
    queryKey: ["fleet-pipeline-monitor", applied, page],
    queryFn: async () => {
      const res = await fetch(`${BASE}/pipeline/monitor?${queryParams()}`, { credentials: "include" });
      if (!res.ok) throw new Error("Gagal memuat data monitor");
      return res.json();
    },
    refetchInterval: 30000,
  });

  function applyFilters() {
    setApplied({ ...filters });
    setPage(1);
  }
  function resetFilters() {
    const blank = { driverName: "", driverExtId: "", dateFrom: "", dateTo: "", transactionType: "", reportId: "", minDebit: "-50000" };
    setFilters(blank);
    setApplied(blank);
    setPage(1);
  }

  async function exportExcel(mode: "detail" | "summary") {
    setExporting(true);
    try {
      const p = new URLSearchParams();
      if (applied.driverName)      p.set("driverName", applied.driverName);
      if (applied.driverExtId)     p.set("driverExtId", applied.driverExtId);
      if (applied.dateFrom)        p.set("dateFrom", applied.dateFrom);
      if (applied.dateTo)          p.set("dateTo", applied.dateTo);
      if (applied.transactionType) p.set("transactionType", applied.transactionType);
      if (applied.reportId)        p.set("reportId", applied.reportId);
      if (mode === "summary")      p.set("mode", "summary");

      const res = await fetch(`${BASE}/pipeline/export-excel?${p.toString()}`, { credentials: "include" });
      if (!res.ok) throw new Error("Export gagal");
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = mode === "summary" ? `fleet-driver-summary-${Date.now()}.xlsx` : `fleet-transactions-${Date.now()}.xlsx`;
      a.click();
      URL.revokeObjectURL(url);
      toast.success("Export berhasil diunduh");
    } catch (e) {
      toast.error(String((e as Error).message));
    } finally {
      setExporting(false);
    }
  }

  const totalPages = data ? Math.ceil(data.pagination.totalDrivers / 50) : 1;
  const highRiskCount = data?.drivers.filter((d) => d.is_high_risk).length ?? 0;

  return (
    <AppShell>
      <div className="space-y-5 max-w-screen-xl">
        <Link href="/logistics/fleet-intelligence">
          <Button variant="ghost" size="sm" className="text-slate-400 hover:text-white gap-1.5 -ml-2">
            <ArrowLeft className="w-4 h-4" /> Fleet Intelligence
          </Button>
        </Link>
        {/* Header */}
        <div className="flex items-start justify-between flex-wrap gap-3">
          <div>
            <h1 className="text-2xl font-bold text-white flex items-center gap-2">
              <Activity className="w-6 h-6 text-blue-400" />
              Pipeline Monitor
            </h1>
            <p className="text-slate-400 text-sm mt-0.5">
              Aggregasi transaksi per driver — filter, highlight high-risk, export Excel
            </p>
          </div>
          <div className="flex gap-2">
            <Button
              variant="outline"
              size="sm"
              className="border-slate-600 text-slate-300 hover:text-white gap-1.5"
              onClick={() => exportExcel("summary")}
              disabled={exporting}
            >
              {exporting ? <RefreshCw className="w-3.5 h-3.5 animate-spin" /> : <Download className="w-3.5 h-3.5" />}
              Export Summary
            </Button>
            <Button
              variant="outline"
              size="sm"
              className="border-slate-600 text-slate-300 hover:text-white gap-1.5"
              onClick={() => exportExcel("detail")}
              disabled={exporting}
            >
              {exporting ? <RefreshCw className="w-3.5 h-3.5 animate-spin" /> : <FileText className="w-3.5 h-3.5" />}
              Export Detail
            </Button>
            <Button variant="ghost" size="sm" className="text-slate-400 hover:text-white" onClick={() => refetch()}>
              <RefreshCw className="w-4 h-4" />
            </Button>
          </div>
        </div>

        {/* Summary Cards */}
        {data?.summary && (
          <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-3">
            <Card className="bg-slate-800/60 border-slate-700">
              <CardContent className="p-3">
                <p className="text-xl font-bold text-white">{fmtNum(data.summary.total_rows)}</p>
                <p className="text-xs text-slate-400 mt-0.5 flex items-center gap-1"><FileText className="w-3 h-3" /> Total Transaksi</p>
              </CardContent>
            </Card>
            <Card className="bg-slate-800/60 border-slate-700">
              <CardContent className="p-3">
                <p className="text-xl font-bold text-white">{fmtNum(data.summary.driver_count)}</p>
                <p className="text-xs text-slate-400 mt-0.5 flex items-center gap-1"><Users className="w-3 h-3" /> Driver</p>
              </CardContent>
            </Card>
            <Card className="bg-slate-800/60 border-slate-700">
              <CardContent className="p-3">
                <p className="text-xl font-bold text-white">{fmtNum(data.summary.vehicle_count)}</p>
                <p className="text-xs text-slate-400 mt-0.5 flex items-center gap-1"><Car className="w-3 h-3" /> Kendaraan</p>
              </CardContent>
            </Card>
            <Card className="bg-slate-800/60 border-slate-700">
              <CardContent className="p-3">
                <p className="text-xl font-bold text-emerald-400">{fmtNum(data.summary.total_credit)}</p>
                <p className="text-xs text-slate-400 mt-0.5 flex items-center gap-1"><TrendingUp className="w-3 h-3 text-emerald-400" /> Total Credit</p>
              </CardContent>
            </Card>
            <Card className="bg-slate-800/60 border-slate-700">
              <CardContent className="p-3">
                <p className="text-xl font-bold text-red-400">{fmtNum(data.summary.total_debit)}</p>
                <p className="text-xs text-slate-400 mt-0.5 flex items-center gap-1"><TrendingDown className="w-3 h-3 text-red-400" /> Total Debit</p>
              </CardContent>
            </Card>
            <Card className={`border-slate-700 ${Number(data.summary.net_flow) >= 0 ? "bg-emerald-900/20" : "bg-red-900/20"}`}>
              <CardContent className="p-3">
                <p className={`text-xl font-bold ${Number(data.summary.net_flow) >= 0 ? "text-emerald-300" : "text-red-300"}`}>
                  {fmtAmt(data.summary.net_flow)}
                </p>
                <p className="text-xs text-slate-400 mt-0.5 flex items-center gap-1"><BarChart2 className="w-3 h-3" /> Net Flow</p>
              </CardContent>
            </Card>
          </div>
        )}

        {/* High-risk alert */}
        {highRiskCount > 0 && (
          <div className="flex items-center gap-3 p-3 bg-red-900/20 border border-red-700/40 rounded-xl">
            <AlertTriangle className="w-5 h-5 text-red-400 flex-shrink-0" />
            <p className="text-red-300 text-sm">
              <span className="font-bold">{highRiskCount} driver high-risk</span> terdeteksi — total debit melebihi threshold{" "}
              <span className="font-mono">{fmtNum(applied.minDebit)}</span>
            </p>
          </div>
        )}

        {/* Filters */}
        <Card className="bg-slate-800/60 border-slate-700">
          <CardHeader className="pb-2">
            <CardTitle className="text-white text-sm flex items-center gap-2">
              <Search className="w-4 h-4 text-slate-400" /> Filter
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-3">
              <div className="space-y-1">
                <Label className="text-slate-400 text-xs">Nama Driver</Label>
                <Input
                  value={filters.driverName}
                  onChange={(e) => setFilters((f) => ({ ...f, driverName: e.target.value }))}
                  placeholder="Cari nama..."
                  className="bg-slate-700 border-slate-600 text-white h-8 text-sm"
                  onKeyDown={(e) => e.key === "Enter" && applyFilters()}
                />
              </div>
              <div className="space-y-1">
                <Label className="text-slate-400 text-xs">Driver ID</Label>
                <Input
                  value={filters.driverExtId}
                  onChange={(e) => setFilters((f) => ({ ...f, driverExtId: e.target.value }))}
                  placeholder="702046784"
                  className="bg-slate-700 border-slate-600 text-white h-8 text-sm"
                  onKeyDown={(e) => e.key === "Enter" && applyFilters()}
                />
              </div>
              <div className="space-y-1">
                <Label className="text-slate-400 text-xs">Tanggal Mulai</Label>
                <DatePicker value={filters.dateFrom} onChange={(v) => setFilters((f) => ({ ...f, dateFrom: v }))} className="bg-slate-700 border-slate-600 text-white h-8 text-sm" />
              </div>
              <div className="space-y-1">
                <Label className="text-slate-400 text-xs">Tanggal Akhir</Label>
                <DatePicker value={filters.dateTo} onChange={(v) => setFilters((f) => ({ ...f, dateTo: v }))} className="bg-slate-700 border-slate-600 text-white h-8 text-sm" />
              </div>
              <div className="space-y-1">
                <Label className="text-slate-400 text-xs">Jenis Transaksi</Label>
                <Input
                  value={filters.transactionType}
                  onChange={(e) => setFilters((f) => ({ ...f, transactionType: e.target.value }))}
                  placeholder="Rental fee deduction"
                  className="bg-slate-700 border-slate-600 text-white h-8 text-sm"
                  onKeyDown={(e) => e.key === "Enter" && applyFilters()}
                />
              </div>
              <div className="space-y-1">
                <Label className="text-slate-400 text-xs">Report ID</Label>
                <Input
                  value={filters.reportId}
                  onChange={(e) => setFilters((f) => ({ ...f, reportId: e.target.value }))}
                  placeholder="1"
                  className="bg-slate-700 border-slate-600 text-white h-8 text-sm"
                  onKeyDown={(e) => e.key === "Enter" && applyFilters()}
                />
              </div>
              <div className="space-y-1">
                <Label className="text-slate-400 text-xs">Threshold High-Risk (Debit ≤)</Label>
                <Input
                  value={filters.minDebit}
                  onChange={(e) => setFilters((f) => ({ ...f, minDebit: e.target.value }))}
                  placeholder="-50000"
                  className="bg-slate-700 border-slate-600 text-white h-8 text-sm"
                  onKeyDown={(e) => e.key === "Enter" && applyFilters()}
                />
              </div>
              <div className="flex items-end gap-2">
                <Button
                  className="h-8 bg-blue-600 hover:bg-blue-700 text-white text-sm flex-1"
                  onClick={applyFilters}
                >
                  <Search className="w-3.5 h-3.5 mr-1" /> Cari
                </Button>
                <Button
                  variant="ghost"
                  className="h-8 text-slate-400 hover:text-white text-sm"
                  onClick={resetFilters}
                >
                  Reset
                </Button>
              </div>
            </div>

            {/* Quick type filter badges */}
            {(data?.transactionTypes ?? []).length > 0 && (
              <div className="flex flex-wrap gap-1.5">
                <span className="text-xs text-slate-500">Quick filter:</span>
                {(data?.transactionTypes ?? []).map((t) => (
                  <button
                    key={String(t)}
                    className={`text-xs px-2 py-0.5 rounded border transition-colors ${
                      applied.transactionType === String(t)
                        ? "bg-blue-600 border-blue-500 text-white"
                        : "bg-slate-700 border-slate-600 text-slate-300 hover:border-slate-400"
                    }`}
                    onClick={() => {
                      const newType = applied.transactionType === String(t) ? "" : String(t);
                      setFilters((f) => ({ ...f, transactionType: newType }));
                      setApplied((f) => ({ ...f, transactionType: newType }));
                      setPage(1);
                    }}
                  >
                    {String(t)}
                  </button>
                ))}
              </div>
            )}
          </CardContent>
        </Card>

        {/* Driver Table */}
        <Card className="bg-slate-800/60 border-slate-700">
          <CardHeader className="pb-2 flex flex-row items-center justify-between">
            <CardTitle className="text-white text-sm flex items-center gap-2">
              <Users className="w-4 h-4 text-slate-400" />
              Per-Driver Aggregasi
              {data && (
                <Badge className="bg-slate-700 text-slate-300 border-slate-600 border text-xs ml-1">
                  {data.pagination.totalDrivers} driver
                </Badge>
              )}
              {highRiskCount > 0 && (
                <Badge className="bg-red-500/20 text-red-300 border-red-600 border text-xs">
                  <AlertTriangle className="w-3 h-3 mr-1" />
                  {highRiskCount} high-risk
                </Badge>
              )}
            </CardTitle>
            <span className="text-xs text-slate-500">Diurutkan: total debit terbesar (terburuk) → atas</span>
          </CardHeader>
          <CardContent className="p-0">
            {isLoading ? (
              <div className="flex items-center justify-center py-12 text-slate-400">
                <RefreshCw className="w-5 h-5 animate-spin mr-2" /> Memuat data...
              </div>
            ) : !data?.drivers.length ? (
              <div className="text-center py-12 text-slate-500">
                <Users className="w-10 h-10 mx-auto mb-2 opacity-30" />
                <p>Tidak ada data driver ditemukan</p>
                <p className="text-xs mt-1">Coba ubah filter atau upload file CSV terlebih dahulu</p>
              </div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-xs">
                  <thead className="border-b border-slate-700 bg-slate-900/40">
                    <tr>
                      {[
                        "Driver ID", "Nama Driver", "No HP", "Kendaraan",
                        "Tx Count", "Total Debit", "Total Credit", "Net Flow",
                        "Outstanding", "Periode", "Risk",
                      ].map((h) => (
                        <th key={h} className="text-left px-3 py-2.5 text-slate-400 font-medium whitespace-nowrap">{h}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {data.drivers.map((d) => (
                      <tr
                        key={d.driver_external_id}
                        className={`border-b border-slate-700/40 transition-colors ${
                          d.is_high_risk
                            ? "bg-red-950/30 hover:bg-red-950/50"
                            : "hover:bg-slate-700/20"
                        }`}
                      >
                        <td className="px-3 py-2 font-mono text-blue-300 whitespace-nowrap">
                          {d.driver_external_id || "—"}
                        </td>
                        <td className="px-3 py-2 text-white font-medium whitespace-nowrap">
                          {d.is_high_risk && (
                            <AlertTriangle className="w-3 h-3 text-red-400 inline mr-1 flex-shrink-0" />
                          )}
                          {d.driver_name || "—"}
                        </td>
                        <td className="px-3 py-2 text-slate-300 font-mono whitespace-nowrap">
                          <span className="flex items-center gap-1">
                            <Phone className="w-3 h-3 text-slate-500" />
                            {d.phone_number || "—"}
                          </span>
                        </td>
                        <td className="px-3 py-2 text-slate-300 whitespace-nowrap">{d.vehicle || "—"}</td>
                        <td className="px-3 py-2 text-center text-white font-mono">{fmtNum(d.tx_count)}</td>
                        <td className="px-3 py-2 text-right font-semibold text-red-400 whitespace-nowrap">
                          {Number(d.total_debit).toLocaleString("id-ID")}
                        </td>
                        <td className="px-3 py-2 text-right font-semibold text-emerald-400 whitespace-nowrap">
                          {Number(d.total_credit).toLocaleString("id-ID")}
                        </td>
                        <td className={`px-3 py-2 text-right font-semibold whitespace-nowrap ${Number(d.net_flow) >= 0 ? "text-emerald-300" : "text-red-300"}`}>
                          {fmtAmt(d.net_flow)}
                        </td>
                        <td className={`px-3 py-2 text-right whitespace-nowrap ${Number(d.latest_outstanding) > 0 ? "text-amber-400" : "text-slate-400"}`}>
                          {Number(d.latest_outstanding).toLocaleString("id-ID")}
                        </td>
                        <td className="px-3 py-2 text-slate-400 whitespace-nowrap text-xs">
                          {fmtDate(d.date_first)} — {fmtDate(d.date_last)}
                        </td>
                        <td className="px-3 py-2">
                          {d.is_high_risk ? (
                            <Badge className="bg-red-500/20 text-red-300 border-red-600 border text-xs px-1.5 py-0.5 whitespace-nowrap">
                              ⚠ High Risk
                            </Badge>
                          ) : (
                            <Badge className="bg-emerald-500/10 text-emerald-400 border-emerald-700/50 border text-xs px-1.5 py-0.5">
                              OK
                            </Badge>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </CardContent>
        </Card>

        {/* Pagination */}
        {totalPages > 1 && (
          <div className="flex items-center justify-between text-sm">
            <span className="text-slate-400">
              Halaman {page} dari {totalPages} ({data?.pagination.totalDrivers} driver)
            </span>
            <div className="flex gap-2">
              <Button
                variant="outline"
                size="sm"
                className="border-slate-600 text-slate-300 hover:text-white h-8"
                disabled={page <= 1}
                onClick={() => setPage((p) => p - 1)}
              >
                <ChevronLeft className="w-4 h-4" />
              </Button>
              <Button
                variant="outline"
                size="sm"
                className="border-slate-600 text-slate-300 hover:text-white h-8"
                disabled={page >= totalPages}
                onClick={() => setPage((p) => p + 1)}
              >
                <ChevronRight className="w-4 h-4" />
              </Button>
            </div>
          </div>
        )}
      </div>
    </AppShell>
  );
}
