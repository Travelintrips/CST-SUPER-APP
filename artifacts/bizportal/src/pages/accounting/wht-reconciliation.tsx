import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { AppShell } from "@/components/layout/AppShell";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import { useCompany } from "@/contexts/CompanyContext";
import { AlertCircle, CheckCircle2, Download, RefreshCw, ShieldCheck, ArrowLeft } from "lucide-react";
import { Link } from "wouter";

const API = "/api/accounting";

function formatRp(n: number) {
  return "Rp " + Math.round(n).toLocaleString("id-ID");
}

function currentPeriod() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
}

function generatePeriods() {
  const periods: string[] = [];
  const now = new Date();
  for (let i = 0; i < 24; i++) {
    const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
    periods.push(`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`);
  }
  return periods;
}

function periodLabel(p: string) {
  const [y, m] = p.split("-");
  const MONTHS = ["Jan","Feb","Mar","Apr","Mei","Jun","Jul","Agt","Sep","Okt","Nov","Des"];
  return `${MONTHS[(parseInt(m ?? "1") - 1) % 12]} ${y}`;
}

interface WhtSummary {
  totalWhtPotongan: number;
  totalJournaled: number;
  selisih: number;
  isBalanced: boolean;
}

interface BySupplier {
  supplierId: number | null;
  supplierName: string;
  paymentCount: number;
  totalGross: number;
  totalWht: number;
  totalNetBank: number;
}

interface DetailRow {
  id: number;
  paymentNumber: string;
  createdAt: string;
  supplierName: string;
  grossAmount: number;
  whtAmount: number;
  netBank: number;
  journalEntryId: number | null;
  whtAccountCode: string | null;
  whtAccountName: string | null;
  isJournaled: boolean;
}

interface WhtReconData {
  period: string;
  companyId: number;
  summary: WhtSummary;
  bySupplier: BySupplier[];
  detail: DetailRow[];
}

export default function WhtReconciliationPage() {
  const { activeCompanyId } = useCompany();
  const [period, setPeriod] = useState(currentPeriod());
  const [view, setView] = useState<"supplier" | "detail">("supplier");
  const periods = generatePeriods();

  const { data, isLoading, refetch } = useQuery<WhtReconData>({
    queryKey: ["wht-reconciliation", period, activeCompanyId],
    queryFn: async () => {
      const params = new URLSearchParams({ period });
      if (activeCompanyId) params.set("companyId", String(activeCompanyId));
      const res = await fetch(`${API}/wht-reconciliation?${params}`);
      if (!res.ok) throw new Error("Gagal memuat data rekonsiliasi WHT");
      return res.json() as Promise<WhtReconData>;
    },
    staleTime: 60_000,
  });

  function exportCsv() {
    if (!data) return;
    const rows = [
      ["Rekonsiliasi WHT Payable", periodLabel(period)],
      [],
      ["== Ringkasan =="],
      ["Total WHT Dipotong", data.summary.totalWhtPotongan],
      ["Total Terjurnal (2-1030)", data.summary.totalJournaled],
      ["Selisih", data.summary.selisih],
      ["Status", data.summary.isBalanced ? "BALANCE" : "TIDAK BALANCE"],
      [],
      ["== Per Vendor =="],
      ["Vendor", "Jumlah Transaksi", "Total Bruto", "Total WHT", "Net ke Bank"],
      ...data.bySupplier.map((r) => [
        r.supplierName, r.paymentCount, r.totalGross, r.totalWht, r.totalNetBank,
      ]),
      [],
      ["== Detail Transaksi =="],
      ["No. Pembayaran", "Tanggal", "Vendor", "Bruto", "WHT", "Net Bank", "Terjurnal?", "Akun WHT"],
      ...data.detail.map((r) => [
        r.paymentNumber,
        r.createdAt.slice(0, 10),
        r.supplierName,
        r.grossAmount,
        r.whtAmount,
        r.netBank,
        r.isJournaled ? "Ya" : "Tidak",
        r.whtAccountCode ? `${r.whtAccountCode} - ${r.whtAccountName}` : "—",
      ]),
    ];
    const csv = rows.map((r) => r.map(String).map((v) => `"${v.replace(/"/g, '""')}"`).join(",")).join("\n");
    const blob = new Blob(["\uFEFF" + csv], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `WHT-Rekonsiliasi-${period}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  }

  const s = data?.summary;
  const notJournaled = data?.detail.filter((d) => !d.isJournaled) ?? [];

  return (
    <AppShell>
      <div className="flex flex-col gap-6 p-6 max-w-6xl mx-auto">
        {/* Header */}
        <div className="flex items-center justify-between gap-4 flex-wrap">
          <div>
            <Link href="/accounting"><Button variant="ghost" size="icon" aria-label="Kembali"><ArrowLeft className="h-4 w-4" /></Button></Link>
            <h1 className="text-xl font-semibold text-white flex items-center gap-2">
              <ShieldCheck className="h-5 w-5 text-orange-400" />
              Rekonsiliasi WHT Payable
            </h1>
            <p className="text-sm text-slate-400 mt-0.5">
              WHT yang dipotong dari pembayaran vendor vs jurnal WHT Payable (2-1030)
            </p>
          </div>
          <div className="flex items-center gap-2">
            <Select value={period} onValueChange={setPeriod}>
              <SelectTrigger className="w-36 bg-slate-800 border-slate-700 text-white text-sm">
                <SelectValue />
              </SelectTrigger>
              <SelectContent className="bg-slate-800 border-slate-700">
                {periods.map((p) => (
                  <SelectItem key={p} value={p} className="text-slate-200 text-sm">
                    {periodLabel(p)}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Button
              variant="ghost"
              size="icon"
              onClick={() => refetch()}
              className="text-slate-400 hover:text-white"
            >
              <RefreshCw className="h-4 w-4" />
            </Button>
            <Button
              variant="outline"
              size="sm"
              onClick={exportCsv}
              disabled={!data}
              className="border-slate-700 text-slate-300 hover:text-white text-xs"
            >
              <Download className="h-3 w-3 mr-1" />
              Export CSV
            </Button>
          </div>
        </div>

        {/* Summary Cards */}
        {isLoading ? (
          <div className="grid grid-cols-3 gap-4">
            {[1, 2, 3].map((i) => (
              <Card key={i} className="bg-slate-800/60 border-slate-700 animate-pulse h-24" />
            ))}
          </div>
        ) : s ? (
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
            <Card className="bg-slate-800/60 border-slate-700">
              <CardContent className="p-4">
                <p className="text-xs text-slate-400 mb-1">Total WHT Dipotong</p>
                <p className="text-lg font-semibold text-orange-300">{formatRp(s.totalWhtPotongan)}</p>
                <p className="text-xs text-slate-500 mt-1">dari {data.bySupplier.length} vendor</p>
              </CardContent>
            </Card>
            <Card className="bg-slate-800/60 border-slate-700">
              <CardContent className="p-4">
                <p className="text-xs text-slate-400 mb-1">Terjurnal ke WHT Payable (2-1030)</p>
                <p className="text-lg font-semibold text-blue-300">{formatRp(s.totalJournaled)}</p>
                <p className="text-xs text-slate-500 mt-1">Credit ke akun WHT Payable</p>
              </CardContent>
            </Card>
            <Card className={`border ${s.isBalanced ? "bg-green-900/20 border-green-700" : "bg-red-900/20 border-red-700"}`}>
              <CardContent className="p-4">
                <div className="flex items-center justify-between mb-1">
                  <p className="text-xs text-slate-400">Selisih</p>
                  {s.isBalanced ? (
                    <CheckCircle2 className="h-4 w-4 text-green-400" />
                  ) : (
                    <AlertCircle className="h-4 w-4 text-red-400" />
                  )}
                </div>
                <p className={`text-lg font-semibold ${s.isBalanced ? "text-green-300" : "text-red-300"}`}>
                  {formatRp(Math.abs(s.selisih))}
                </p>
                <p className="text-xs mt-1">
                  <Badge className={`text-xs ${s.isBalanced ? "bg-green-900/40 text-green-300 border-green-700" : "bg-red-900/40 text-red-300 border-red-700"}`}>
                    {s.isBalanced ? "BALANCE" : "TIDAK BALANCE"}
                  </Badge>
                </p>
              </CardContent>
            </Card>
          </div>
        ) : null}

        {/* Alert jika ada payment belum dijurnal */}
        {notJournaled.length > 0 && (
          <div className="flex items-start gap-3 bg-amber-900/20 border border-amber-700 rounded-lg p-3">
            <AlertCircle className="h-4 w-4 text-amber-400 mt-0.5 shrink-0" />
            <div>
              <p className="text-sm font-medium text-amber-300">
                {notJournaled.length} pembayaran WHT belum memiliki jurnal
              </p>
              <p className="text-xs text-amber-400/80 mt-0.5">
                Cek kolom "Terjurnal?" di tab Detail untuk melihat detail pembayaran yang belum ter-jurnal.
              </p>
            </div>
          </div>
        )}

        {/* DJP Setor Info */}
        {s && s.totalWhtPotongan > 0 && (
          <div className="flex items-start gap-3 bg-slate-800/40 border border-slate-700 rounded-lg p-3">
            <ShieldCheck className="h-4 w-4 text-orange-400 mt-0.5 shrink-0" />
            <div>
              <p className="text-sm font-medium text-slate-200">
                Estimasi Setoran ke DJP bulan {periodLabel(period)}
              </p>
              <p className="text-base font-bold text-orange-300 mt-0.5">
                {formatRp(s.totalWhtPotongan)}
              </p>
              <p className="text-xs text-slate-400 mt-0.5">
                Batas setor PPh 23: tanggal 10 bulan berikutnya · Batas lapor: tanggal 20 bulan berikutnya
              </p>
            </div>
          </div>
        )}

        {/* Tab: Per Vendor / Detail */}
        <div>
          <div className="flex gap-2 mb-4">
            <button
              onClick={() => setView("supplier")}
              className={`px-3 py-1.5 rounded text-sm font-medium transition-colors ${
                view === "supplier"
                  ? "bg-indigo-600 text-white"
                  : "text-slate-400 hover:text-white"
              }`}
            >
              Per Vendor
            </button>
            <button
              onClick={() => setView("detail")}
              className={`px-3 py-1.5 rounded text-sm font-medium transition-colors ${
                view === "detail"
                  ? "bg-indigo-600 text-white"
                  : "text-slate-400 hover:text-white"
              }`}
            >
              Detail Transaksi
              {notJournaled.length > 0 && (
                <span className="ml-1.5 bg-red-600 text-white text-xs rounded-full px-1.5 py-0.5">
                  {notJournaled.length}
                </span>
              )}
            </button>
          </div>

          {view === "supplier" && (
            <div className="rounded-lg border border-slate-700 overflow-hidden">
              <Table>
                <TableHeader>
                  <TableRow className="border-slate-700 bg-slate-800/60">
                    <TableHead className="text-slate-400 text-xs">Vendor</TableHead>
                    <TableHead className="text-slate-400 text-xs text-right">Jumlah Transaksi</TableHead>
                    <TableHead className="text-slate-400 text-xs text-right">Total Bruto</TableHead>
                    <TableHead className="text-slate-400 text-xs text-right">Total WHT</TableHead>
                    <TableHead className="text-slate-400 text-xs text-right">Net ke Bank</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {isLoading ? (
                    <TableRow>
                      <TableCell colSpan={5} className="text-center text-slate-500 py-8 text-sm">
                        Memuat...
                      </TableCell>
                    </TableRow>
                  ) : (data?.bySupplier.length ?? 0) === 0 ? (
                    <TableRow>
                      <TableCell colSpan={5} className="text-center text-slate-500 py-8 text-sm">
                        Tidak ada WHT yang dipotong pada periode ini
                      </TableCell>
                    </TableRow>
                  ) : (
                    <>
                      {data!.bySupplier.map((r, i) => (
                        <TableRow key={i} className="border-slate-700 hover:bg-slate-800/40">
                          <TableCell className="text-slate-200 text-sm font-medium">{r.supplierName}</TableCell>
                          <TableCell className="text-slate-300 text-sm text-right">{r.paymentCount}</TableCell>
                          <TableCell className="text-slate-300 text-sm text-right">{formatRp(r.totalGross)}</TableCell>
                          <TableCell className="text-orange-300 text-sm text-right font-medium">{formatRp(r.totalWht)}</TableCell>
                          <TableCell className="text-slate-300 text-sm text-right">{formatRp(r.totalNetBank)}</TableCell>
                        </TableRow>
                      ))}
                      <TableRow className="border-slate-700 bg-slate-800/60 font-semibold">
                        <TableCell className="text-slate-200 text-sm">TOTAL</TableCell>
                        <TableCell className="text-right text-sm text-slate-300">
                          {data!.bySupplier.reduce((s, r) => s + r.paymentCount, 0)}
                        </TableCell>
                        <TableCell className="text-right text-sm text-slate-300">
                          {formatRp(data!.bySupplier.reduce((s, r) => s + r.totalGross, 0))}
                        </TableCell>
                        <TableCell className="text-right text-sm text-orange-300">
                          {formatRp(data!.bySupplier.reduce((s, r) => s + r.totalWht, 0))}
                        </TableCell>
                        <TableCell className="text-right text-sm text-slate-300">
                          {formatRp(data!.bySupplier.reduce((s, r) => s + r.totalNetBank, 0))}
                        </TableCell>
                      </TableRow>
                    </>
                  )}
                </TableBody>
              </Table>
            </div>
          )}

          {view === "detail" && (
            <div className="rounded-lg border border-slate-700 overflow-hidden">
              <Table>
                <TableHeader>
                  <TableRow className="border-slate-700 bg-slate-800/60">
                    <TableHead className="text-slate-400 text-xs">No. Pembayaran</TableHead>
                    <TableHead className="text-slate-400 text-xs">Tanggal</TableHead>
                    <TableHead className="text-slate-400 text-xs">Vendor</TableHead>
                    <TableHead className="text-slate-400 text-xs text-right">Bruto</TableHead>
                    <TableHead className="text-slate-400 text-xs text-right">WHT</TableHead>
                    <TableHead className="text-slate-400 text-xs text-right">Net Bank</TableHead>
                    <TableHead className="text-slate-400 text-xs">Akun WHT</TableHead>
                    <TableHead className="text-slate-400 text-xs text-center">Terjurnal?</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {isLoading ? (
                    <TableRow>
                      <TableCell colSpan={8} className="text-center text-slate-500 py-8 text-sm">
                        Memuat...
                      </TableCell>
                    </TableRow>
                  ) : (data?.detail.length ?? 0) === 0 ? (
                    <TableRow>
                      <TableCell colSpan={8} className="text-center text-slate-500 py-8 text-sm">
                        Tidak ada WHT yang dipotong pada periode ini
                      </TableCell>
                    </TableRow>
                  ) : (
                    data!.detail.map((r) => (
                      <TableRow key={r.id} className="border-slate-700 hover:bg-slate-800/40">
                        <TableCell className="text-slate-200 text-xs font-mono">{r.paymentNumber}</TableCell>
                        <TableCell className="text-slate-300 text-xs">{r.createdAt.slice(0, 10)}</TableCell>
                        <TableCell className="text-slate-300 text-sm">{r.supplierName}</TableCell>
                        <TableCell className="text-slate-300 text-xs text-right">{formatRp(r.grossAmount)}</TableCell>
                        <TableCell className="text-orange-300 text-xs text-right font-medium">{formatRp(r.whtAmount)}</TableCell>
                        <TableCell className="text-slate-300 text-xs text-right">{formatRp(r.netBank)}</TableCell>
                        <TableCell className="text-slate-400 text-xs">
                          {r.whtAccountCode ? `${r.whtAccountCode}` : "—"}
                        </TableCell>
                        <TableCell className="text-center">
                          {r.isJournaled ? (
                            <Badge className="bg-green-900/40 text-green-300 border-green-700 text-xs">Ya</Badge>
                          ) : (
                            <Badge className="bg-red-900/40 text-red-300 border-red-700 text-xs">Belum</Badge>
                          )}
                        </TableCell>
                      </TableRow>
                    ))
                  )}
                </TableBody>
              </Table>
            </div>
          )}
        </div>
      </div>
    </AppShell>
  );
}
