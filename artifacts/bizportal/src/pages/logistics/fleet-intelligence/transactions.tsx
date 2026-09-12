import { DatePicker } from "@/components/ui/date-picker";
import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { AppShell } from "@/components/layout/AppShell";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Receipt, Download, Search, X, ArrowLeft } from "lucide-react";
import { Link } from "wouter";

function fmtIdr(v: unknown) {
  return new Intl.NumberFormat("id-ID", { style: "currency", currency: "IDR", maximumFractionDigits: 0 }).format(parseFloat(String(v ?? 0)) || 0);
}
function fmtNum(v: unknown) {
  return new Intl.NumberFormat("id-ID").format(parseFloat(String(v ?? 0)) || 0);
}

export default function FleetTransactionsPage() {
  const [startDate, setStartDate] = useState(() => {
    const d = new Date();
    d.setDate(d.getDate() - 30);
    return d.toISOString().slice(0, 10);
  });
  const [endDate, setEndDate] = useState(() => new Date().toISOString().slice(0, 10));
  const [driverSearch, setDriverSearch] = useState("");
  const [vehiclePlate, setVehiclePlate] = useState("");
  const [driverSearchApplied, setDriverSearchApplied] = useState("");
  const [vehiclePlateApplied, setVehiclePlateApplied] = useState("");
  const [page, setPage] = useState(1);

  const { data, isLoading } = useQuery({
    queryKey: ["fleet-transactions", startDate, endDate, page, driverSearchApplied, vehiclePlateApplied],
    queryFn: async () => {
      const params = new URLSearchParams({ startDate, endDate, page: String(page), limit: "100" });
      if (driverSearchApplied) params.set("driverSearch", driverSearchApplied);
      if (vehiclePlateApplied) params.set("vehiclePlate", vehiclePlateApplied);
      const res = await fetch(`/api/logistics/fleet/transactions?${params}`, { credentials: "include" });
      return res.json() as Promise<{
        transactions: Array<Record<string, unknown>>;
        summary: Record<string, unknown>;
      }>;
    },
  });

  const transactions = data?.transactions ?? [];
  const summary = data?.summary ?? {};

  function applyFilters() {
    setDriverSearchApplied(driverSearch);
    setVehiclePlateApplied(vehiclePlate);
    setPage(1);
  }

  function clearFilters() {
    setDriverSearch("");
    setVehiclePlate("");
    setDriverSearchApplied("");
    setVehiclePlateApplied("");
    setPage(1);
  }

  const hasActiveFilters = driverSearchApplied || vehiclePlateApplied;

  function exportCsv() {
    const cols = ["Tanggal", "Nama Driver", "Plat", "Layanan", "Trip", "Gross Revenue", "Insentif", "Komisi", "Potongan", "Net Revenue", "Outstanding", "PPN Rate", "PPN Amount"];
    const rows = transactions.map((t) => [
      t.transaction_date, t.driver_name, t.vehicle_plate,
      t.service_type, t.trip_count, t.gross_revenue, t.incentive, t.commission,
      t.deduction, t.net_revenue, t.outstanding_balance, t.ppn_rate, t.ppn_amount,
    ].map((v) => `"${v ?? ""}"`).join(","));
    const csv = [cols.join(","), ...rows].join("\n");
    const blob = new Blob(["\uFEFF" + csv], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `fleet_transactions_${startDate}_${endDate}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  }

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
            <h1 className="text-2xl font-bold text-white">Transaksi Fleet</h1>
            <p className="text-slate-400 text-sm mt-1">Rincian transaksi harian per driver</p>
          </div>
          <Button variant="outline" size="sm" className="gap-2 border-slate-600" onClick={exportCsv}>
            <Download className="w-4 h-4" /> Export CSV
          </Button>
        </div>

        {/* Filter */}
        <Card className="bg-slate-800/60 border-slate-700">
          <CardContent className="p-4">
            <div className="flex flex-wrap gap-4 items-end">
              <div className="space-y-1.5">
                <Label className="text-slate-300 text-sm">Tanggal Mulai</Label>
                <DatePicker value={startDate} onChange={(v) => { setStartDate(v); setPage(1); }} className="bg-slate-700 border-slate-600 text-white" />
              </div>
              <div className="space-y-1.5">
                <Label className="text-slate-300 text-sm">Tanggal Akhir</Label>
                <DatePicker value={endDate} onChange={(v) => { setEndDate(v); setPage(1); }} className="bg-slate-700 border-slate-600 text-white" />
              </div>
              <div className="space-y-1.5">
                <Label className="text-slate-300 text-sm">Cari Driver</Label>
                <div className="relative">
                  <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
                  <Input
                    placeholder="Nama driver..."
                    value={driverSearch}
                    onChange={(e) => setDriverSearch(e.target.value)}
                    onKeyDown={(e) => e.key === "Enter" && applyFilters()}
                    className="bg-slate-700 border-slate-600 text-white pl-8 w-44"
                  />
                </div>
              </div>
              <div className="space-y-1.5">
                <Label className="text-slate-300 text-sm">Plat Kendaraan</Label>
                <Input
                  placeholder="Plat..."
                  value={vehiclePlate}
                  onChange={(e) => setVehiclePlate(e.target.value)}
                  onKeyDown={(e) => e.key === "Enter" && applyFilters()}
                  className="bg-slate-700 border-slate-600 text-white w-32"
                />
              </div>
              <div className="flex gap-2 pb-0.5">
                <Button
                  size="sm"
                  className="bg-blue-600 hover:bg-blue-700 gap-1.5"
                  onClick={applyFilters}
                >
                  <Search className="w-3.5 h-3.5" /> Filter
                </Button>
                {hasActiveFilters && (
                  <Button
                    size="sm"
                    variant="outline"
                    className="border-slate-600 gap-1.5"
                    onClick={clearFilters}
                  >
                    <X className="w-3.5 h-3.5" /> Reset
                  </Button>
                )}
              </div>
            </div>
            {hasActiveFilters && (
              <div className="mt-3 flex gap-2 flex-wrap">
                {driverSearchApplied && (
                  <span className="text-xs px-2 py-1 bg-blue-500/20 border border-blue-600/40 rounded text-blue-300">
                    Driver: "{driverSearchApplied}"
                  </span>
                )}
                {vehiclePlateApplied && (
                  <span className="text-xs px-2 py-1 bg-blue-500/20 border border-blue-600/40 rounded text-blue-300">
                    Plat: "{vehiclePlateApplied}"
                  </span>
                )}
              </div>
            )}
          </CardContent>
        </Card>

        {/* Summary */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          {[
            { label: "Total Transaksi", value: fmtNum(summary.total) },
            { label: "Total Trip", value: fmtNum(summary.total_trips) },
            { label: "Total Net Revenue", value: fmtIdr(summary.total_net) },
            { label: "Total Gross Revenue", value: fmtIdr(summary.total_gross) },
          ].map((s) => (
            <Card key={s.label} className="bg-slate-800/60 border-slate-700">
              <CardContent className="p-4">
                <div className="text-lg font-bold text-white">{s.value}</div>
                <div className="text-xs text-slate-400 mt-0.5">{s.label}</div>
              </CardContent>
            </Card>
          ))}
        </div>

        {/* Table */}
        <Card className="bg-slate-800/60 border-slate-700">
          <CardContent className="p-0">
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="border-b border-slate-700">
                  <tr>
                    {["Tanggal", "Driver", "Plat", "Layanan", "Trip", "Gross", "Insentif", "Komisi", "Potongan", "Net Revenue", "Outstanding", "PPN"].map((h) => (
                      <th key={h} className="text-left px-4 py-3 text-slate-400 font-medium whitespace-nowrap">{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {isLoading
                    ? Array.from({ length: 10 }).map((_, i) => (
                        <tr key={i} className="border-b border-slate-700/50">
                          <td colSpan={12} className="px-4 py-3"><div className="h-4 bg-slate-700 rounded animate-pulse" /></td>
                        </tr>
                      ))
                    : transactions.length === 0 ? (
                        <tr>
                          <td colSpan={12} className="px-4 py-12 text-center text-slate-500">
                            <Receipt className="w-10 h-10 mx-auto mb-2 opacity-40" />
                            <p>Tidak ada transaksi di periode ini</p>
                            {hasActiveFilters && <p className="text-xs mt-1">Coba ubah atau hapus filter</p>}
                          </td>
                        </tr>
                      )
                    : transactions.map((t, i) => (
                        <tr key={i} className="border-b border-slate-700/50 hover:bg-slate-700/20 transition-colors">
                          <td className="px-4 py-2.5 text-slate-300 whitespace-nowrap">{String(t.transaction_date)}</td>
                          <td className="px-4 py-2.5 text-white font-medium max-w-[140px] truncate" title={String(t.driver_name ?? "")}>{String(t.driver_name ?? "-")}</td>
                          <td className="px-4 py-2.5 text-slate-400">{String(t.vehicle_plate ?? "-")}</td>
                          <td className="px-4 py-2.5 text-slate-400">{String(t.service_type ?? "-")}</td>
                          <td className="px-4 py-2.5 text-right text-slate-300">{fmtNum(t.trip_count)}</td>
                          <td className="px-4 py-2.5 text-right text-slate-300">{fmtIdr(t.gross_revenue)}</td>
                          <td className="px-4 py-2.5 text-right text-yellow-400">{fmtIdr(t.incentive)}</td>
                          <td className="px-4 py-2.5 text-right text-red-400">{fmtIdr(t.commission)}</td>
                          <td className="px-4 py-2.5 text-right text-red-400">{fmtIdr(t.deduction)}</td>
                          <td className="px-4 py-2.5 text-right font-semibold text-emerald-400">{fmtIdr(t.net_revenue)}</td>
                          <td className="px-4 py-2.5 text-right text-amber-400">{fmtIdr(t.outstanding_balance)}</td>
                          <td className="px-4 py-2.5 text-right text-slate-500 text-xs">{String(t.ppn_amount && Number(t.ppn_amount) > 0 ? fmtIdr(t.ppn_amount) : "—")}</td>
                        </tr>
                      ))}
                </tbody>
              </table>
            </div>
            <div className="flex items-center justify-between px-4 py-3 border-t border-slate-700">
              <span className="text-slate-400 text-sm">{fmtNum(summary.total)} total transaksi</span>
              <div className="flex gap-2">
                <Button variant="outline" size="sm" disabled={page === 1} onClick={() => setPage((p) => p - 1)}>Prev</Button>
                <span className="px-3 py-1 text-slate-400 text-sm">Hal. {page}</span>
                <Button variant="outline" size="sm" disabled={transactions.length < 100} onClick={() => setPage((p) => p + 1)}>Next</Button>
              </div>
            </div>
          </CardContent>
        </Card>
      </div>
    </AppShell>
  );
}
