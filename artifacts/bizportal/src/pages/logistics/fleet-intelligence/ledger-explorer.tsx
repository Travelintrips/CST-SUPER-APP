import { DatePicker } from "@/components/ui/date-picker";
import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { AppShell } from "@/components/layout/AppShell";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import {
  Database, RefreshCw, Search, XCircle, ChevronDown, ChevronUp,
  TrendingUp, Filter, ArrowLeft,
} from "lucide-react";
import { Link } from "wouter";

type RawTx = {
  id: number;
  report_id: number | null;
  date_time_jkt: string | null;
  driver_external_id: string | null;
  driver_name: string | null;
  phone_number: string | null;
  vehicle: string | null;
  amount: string | null;
  total_outstanding_balance: string | null;
  transaction_type: string | null;
  gopay_transaction_reference_id: string | null;
  date: string | null;
  created_at: string;
};

type LedgerResponse = {
  transactions: RawTx[];
  summary: { total: string; total_amount: string };
  transactionTypes: string[];
  pagination: { page: number; limit: number; offset: number };
};

function fmtDate(v: unknown) {
  if (!v) return "—";
  try {
    return new Date(String(v)).toLocaleDateString("id-ID");
  } catch {
    return String(v);
  }
}

function fmtNum(v: unknown) {
  const n = parseFloat(String(v ?? "0"));
  if (isNaN(n)) return "—";
  return new Intl.NumberFormat("id-ID").format(n);
}

const LIMIT = 50;

type Filters = {
  driverName: string;
  driverExtId: string;
  dateFrom: string;
  dateTo: string;
  transactionType: string;
  reportId: string;
};

const EMPTY_FILTERS: Filters = {
  driverName: "",
  driverExtId: "",
  dateFrom: "",
  dateTo: "",
  transactionType: "",
  reportId: "",
};

export default function LedgerExplorerPage() {
  const [draft, setDraft] = useState<Filters>(EMPTY_FILTERS);
  const [applied, setApplied] = useState<Filters>(EMPTY_FILTERS);
  const [page, setPage] = useState(1);
  const [expandedId, setExpandedId] = useState<number | null>(null);

  const qs = new URLSearchParams({
    page: String(page),
    limit: String(LIMIT),
    ...(applied.driverName ? { driverName: applied.driverName } : {}),
    ...(applied.driverExtId ? { driverExtId: applied.driverExtId } : {}),
    ...(applied.dateFrom ? { dateFrom: applied.dateFrom } : {}),
    ...(applied.dateTo ? { dateTo: applied.dateTo } : {}),
    ...(applied.transactionType ? { transactionType: applied.transactionType } : {}),
    ...(applied.reportId ? { reportId: applied.reportId } : {}),
  });

  const { data, isLoading, error, refetch } = useQuery<LedgerResponse>({
    queryKey: ["fleet-ledger-explorer", applied, page],
    queryFn: async () => {
      const r = await fetch(`/api/logistics/fleet/ledger?${qs}`, {
        credentials: "include",
      });
      if (!r.ok) throw new Error(await r.text());
      return r.json();
    },
  });

  const { data: reportsData } = useQuery<{
    reports: { id: number; original_filename: string; status: string }[];
  }>({
    queryKey: ["fleet-reports-list"],
    queryFn: async () => {
      const r = await fetch("/api/logistics/fleet/reports", {
        credentials: "include",
      });
      if (!r.ok) throw new Error(await r.text());
      return r.json();
    },
  });

  function applyFilters() {
    setApplied({ ...draft });
    setPage(1);
  }

  function clearFilters() {
    setDraft(EMPTY_FILTERS);
    setApplied(EMPTY_FILTERS);
    setPage(1);
  }

  function setF<K extends keyof Filters>(key: K, val: string) {
    setDraft((prev) => ({ ...prev, [key]: val }));
  }

  const total = parseInt(String(data?.summary?.total ?? "0")) || 0;
  const totalAmount = parseFloat(String(data?.summary?.total_amount ?? "0")) || 0;
  const rows = data?.transactions ?? [];
  const txTypes = data?.transactionTypes ?? [];
  const hasFilter = Object.values(applied).some(Boolean);

  return (
    <AppShell>
      <div className="min-h-screen bg-slate-950 p-6 space-y-6">
        <Link href="/logistics/fleet-intelligence">
          <Button variant="ghost" size="sm" className="text-slate-400 hover:text-white gap-1.5 -ml-2">
            <ArrowLeft className="w-4 h-4" /> Fleet Intelligence
          </Button>
        </Link>
        {/* Header */}
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-bold text-white flex items-center gap-2">
              <Database className="w-6 h-6 text-blue-400" />
              Ledger Explorer
            </h1>
            <p className="text-slate-400 text-sm mt-1">
              Jelajahi semua transaksi raw Gojek — filter, cari, dan inspeksi data mentah
            </p>
          </div>
          <Button
            variant="outline"
            size="sm"
            className="border-slate-600 text-slate-300 hover:text-white"
            onClick={() => refetch()}
          >
            <RefreshCw className="w-4 h-4 mr-1" />
            Refresh
          </Button>
        </div>

        {/* Summary cards */}
        <div className="grid grid-cols-2 md:grid-cols-3 gap-4">
          <Card className="bg-slate-800/60 border-slate-700">
            <CardContent className="p-4">
              <p className="text-2xl font-bold text-white">{fmtNum(total)}</p>
              <p className="text-xs text-slate-400 mt-1">
                Total Baris{hasFilter ? " (difilter)" : ""}
              </p>
            </CardContent>
          </Card>
          <Card className="bg-slate-800/60 border-slate-700">
            <CardContent className="p-4">
              <p className="text-xl font-bold text-emerald-400">Rp {fmtNum(totalAmount)}</p>
              <p className="text-xs text-slate-400 mt-1">Total Amount</p>
            </CardContent>
          </Card>
          <Card className="bg-slate-800/60 border-slate-700">
            <CardContent className="p-4">
              <p className="text-2xl font-bold text-blue-400">{txTypes.length}</p>
              <p className="text-xs text-slate-400 mt-1">Jenis Transaksi</p>
            </CardContent>
          </Card>
        </div>

        {/* Filters */}
        <Card className="bg-slate-800/60 border-slate-700">
          <CardHeader className="pb-2">
            <CardTitle className="text-white text-sm flex items-center gap-2">
              <Filter className="w-4 h-4 text-slate-400" />
              Filter
            </CardTitle>
          </CardHeader>
          <CardContent className="pt-0">
            <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-3 mb-3">
              <div className="space-y-1">
                <label className="text-slate-400 text-xs block">Nama Driver</label>
                <Input
                  value={draft.driverName}
                  onChange={(e) => setF("driverName", e.target.value)}
                  onKeyDown={(e) => e.key === "Enter" && applyFilters()}
                  placeholder="Cari nama..."
                  className="h-8 bg-slate-700 border-slate-600 text-white text-xs"
                />
              </div>
              <div className="space-y-1">
                <label className="text-slate-400 text-xs block">ID Driver</label>
                <Input
                  value={draft.driverExtId}
                  onChange={(e) => setF("driverExtId", e.target.value)}
                  onKeyDown={(e) => e.key === "Enter" && applyFilters()}
                  placeholder="Driver ext ID..."
                  className="h-8 bg-slate-700 border-slate-600 text-white text-xs"
                />
              </div>
              <div className="space-y-1">
                <label className="text-slate-400 text-xs block">Dari Tanggal</label>
                <DatePicker value={draft.dateFrom} onChange={(v) => setF("dateFrom", v)} className="h-8 bg-slate-700 border-slate-600 text-white text-xs" />
              </div>
              <div className="space-y-1">
                <label className="text-slate-400 text-xs block">Sampai Tanggal</label>
                <DatePicker value={draft.dateTo} onChange={(v) => setF("dateTo", v)} className="h-8 bg-slate-700 border-slate-600 text-white text-xs" />
              </div>
              <div className="space-y-1">
                <label className="text-slate-400 text-xs block">Jenis Transaksi</label>
                <select
                  value={draft.transactionType}
                  onChange={(e) => setF("transactionType", e.target.value)}
                  className="h-8 w-full bg-slate-700 border border-slate-600 rounded-md text-white text-xs px-2"
                >
                  <option value="">— Semua —</option>
                  {txTypes.map((t) => (
                    <option key={t} value={t}>
                      {t}
                    </option>
                  ))}
                </select>
              </div>
              <div className="space-y-1">
                <label className="text-slate-400 text-xs block">Report</label>
                <select
                  value={draft.reportId}
                  onChange={(e) => setF("reportId", e.target.value)}
                  className="h-8 w-full bg-slate-700 border border-slate-600 rounded-md text-white text-xs px-2"
                >
                  <option value="">— Semua —</option>
                  {(reportsData?.reports ?? []).map((r) => (
                    <option key={r.id} value={String(r.id)}>
                      [{r.id}] {r.original_filename}
                    </option>
                  ))}
                </select>
              </div>
            </div>
            <div className="flex gap-2">
              <Button
                size="sm"
                className="bg-blue-600 hover:bg-blue-700 h-8"
                onClick={applyFilters}
              >
                <Search className="w-3.5 h-3.5 mr-1" />
                Cari
              </Button>
              <Button
                size="sm"
                variant="outline"
                className="border-slate-600 text-slate-400 h-8"
                onClick={clearFilters}
              >
                <XCircle className="w-3.5 h-3.5 mr-1" />
                Reset
              </Button>
            </div>
          </CardContent>
        </Card>

        {/* Table */}
        <Card className="bg-slate-800/60 border-slate-700">
          <CardHeader className="pb-2">
            <CardTitle className="text-white text-base flex items-center gap-2">
              <TrendingUp className="w-4 h-4 text-blue-400" />
              Transaksi Raw
              {total > 0 && (
                <Badge className="bg-blue-500/20 text-blue-300 border-blue-600 border text-xs">
                  {fmtNum(total)} baris
                </Badge>
              )}
            </CardTitle>
          </CardHeader>
          <CardContent className="p-0">
            {isLoading && (
              <div className="flex items-center justify-center py-12 text-slate-400">
                <RefreshCw className="w-5 h-5 animate-spin mr-2" />
                Memuat data...
              </div>
            )}
            {!isLoading && error && (
              <div className="flex items-center justify-center py-12 text-red-400 gap-2">
                <XCircle className="w-5 h-5" />
                Gagal memuat data
              </div>
            )}
            {!isLoading && !error && rows.length === 0 && (
              <div className="text-center py-12 text-slate-500">
                <Database className="w-10 h-10 mx-auto mb-2 opacity-40" />
                <p>Tidak ada data ditemukan</p>
                <p className="text-xs mt-1">
                  Coba ubah filter atau upload data terlebih dahulu
                </p>
              </div>
            )}
            {!isLoading && !error && rows.length > 0 && (
              <div className="overflow-x-auto">
                <table className="w-full text-xs">
                  <thead className="border-b border-slate-700">
                    <tr>
                      {[
                        "#",
                        "Driver",
                        "Plat",
                        "Tanggal",
                        "Amount",
                        "Jenis",
                        "GoPay Ref",
                        "Outstanding",
                        "Report",
                        "Detail",
                      ].map((h) => (
                        <th
                          key={h}
                          className="text-left px-3 py-2.5 text-slate-400 font-medium whitespace-nowrap"
                        >
                          {h}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {rows.map((row) => (
                      <>
                        <tr
                          key={row.id}
                          className="border-b border-slate-700/50 hover:bg-slate-700/20 cursor-pointer"
                          onClick={() =>
                            setExpandedId(expandedId === row.id ? null : row.id)
                          }
                        >
                          <td className="px-3 py-2 text-slate-500 font-mono">{row.id}</td>
                          <td className="px-3 py-2">
                            <p className="text-white font-medium">
                              {row.driver_name || row.driver_external_id || "—"}
                            </p>
                            {row.phone_number && (
                              <p className="text-slate-500 text-xs">{row.phone_number}</p>
                            )}
                          </td>
                          <td className="px-3 py-2 text-slate-400">
                            {row.vehicle || "—"}
                          </td>
                          <td className="px-3 py-2 text-slate-300 whitespace-nowrap">
                            {fmtDate(row.date_time_jkt || row.date)}
                          </td>
                          <td
                            className={`px-3 py-2 text-right font-semibold ${
                              parseFloat(String(row.amount ?? 0)) >= 0
                                ? "text-emerald-400"
                                : "text-red-400"
                            }`}
                          >
                            {fmtNum(row.amount)}
                          </td>
                          <td className="px-3 py-2">
                            {row.transaction_type ? (
                              <Badge className="bg-slate-700/50 text-slate-300 border-slate-600 border text-xs">
                                {row.transaction_type}
                              </Badge>
                            ) : (
                              <span className="text-slate-600">—</span>
                            )}
                          </td>
                          <td
                            className="px-3 py-2 text-slate-500 font-mono truncate max-w-[120px]"
                            title={row.gopay_transaction_reference_id ?? ""}
                          >
                            {row.gopay_transaction_reference_id || "—"}
                          </td>
                          <td className="px-3 py-2 text-right text-amber-400">
                            {fmtNum(row.total_outstanding_balance)}
                          </td>
                          <td className="px-3 py-2 text-slate-500 text-xs">
                            {row.report_id ? `#${row.report_id}` : "—"}
                          </td>
                          <td className="px-3 py-2">
                            {expandedId === row.id ? (
                              <ChevronUp className="w-3.5 h-3.5 text-slate-500" />
                            ) : (
                              <ChevronDown className="w-3.5 h-3.5 text-slate-500" />
                            )}
                          </td>
                        </tr>
                        {expandedId === row.id && (
                          <tr
                            key={`${row.id}-detail`}
                            className="border-b border-slate-700/50 bg-slate-900/40"
                          >
                            <td colSpan={10} className="px-4 py-3">
                              <div className="grid grid-cols-2 md:grid-cols-4 gap-3 text-xs">
                                <div>
                                  <p className="text-slate-500">Driver External ID</p>
                                  <p className="text-white font-mono">
                                    {row.driver_external_id || "—"}
                                  </p>
                                </div>
                                <div>
                                  <p className="text-slate-500">Tanggal Lengkap</p>
                                  <p className="text-white">
                                    {row.date_time_jkt || row.date || "—"}
                                  </p>
                                </div>
                                <div>
                                  <p className="text-slate-500">GoPay Reference</p>
                                  <p className="text-white font-mono break-all">
                                    {row.gopay_transaction_reference_id || "—"}
                                  </p>
                                </div>
                                <div>
                                  <p className="text-slate-500">Dibuat</p>
                                  <p className="text-white">{fmtDate(row.created_at)}</p>
                                </div>
                              </div>
                            </td>
                          </tr>
                        )}
                      </>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </CardContent>
        </Card>

        {/* Pagination */}
        <div className="flex items-center justify-between text-sm text-slate-400">
          <span>
            Halaman {page} · {fmtNum(total)} total baris
            {hasFilter && <span className="text-blue-400 ml-2">(difilter)</span>}
          </span>
          <div className="flex gap-2">
            <Button
              variant="outline"
              size="sm"
              className="border-slate-600"
              disabled={page <= 1}
              onClick={() => setPage(page - 1)}
            >
              ← Prev
            </Button>
            <Button
              variant="outline"
              size="sm"
              className="border-slate-600"
              disabled={page * LIMIT >= total}
              onClick={() => setPage(page + 1)}
            >
              Next →
            </Button>
          </div>
        </div>
      </div>
    </AppShell>
  );
}
