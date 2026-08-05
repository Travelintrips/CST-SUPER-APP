import { useState } from "react";
import { DatePicker } from "@/components/ui/date-picker";
import { AppShell } from "@/components/layout/AppShell";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { useQuery } from "@tanstack/react-query";
import { BarChart2, TrendingUp, Wallet, AlertCircle, ChevronLeft } from "lucide-react";
import { Link } from "wouter";

interface LaporanData {
  monthly: { bulan: string; total_bayar: number; jumlah_bayar: number }[];
  byLokasi: { lokasi: string; total_bayar: number; jumlah_bayar: number }[];
  summary: { total_terkumpul: number; total_outstanding: number; jumlah_transaksi: number; invoice_overdue: number };
}

function fmt(n: number) {
  return new Intl.NumberFormat("id-ID", { style: "currency", currency: "IDR", maximumFractionDigits: 0 }).format(n ?? 0);
}

export default function TenantLaporanKeuanganPage() {
  const thisYear = new Date().getFullYear();
  const [from, setFrom] = useState(`${thisYear}-01-01`);
  const [to, setTo] = useState(`${thisYear}-12-31`);

  const { data, isLoading } = useQuery<LaporanData>({
    queryKey: ["tenant-laporan-keuangan", from, to],
    queryFn: async () => {
      const p = new URLSearchParams({ from, to });
      const r = await fetch(`/api/tenant/laporan-keuangan?${p}`, { credentials: "include" });
      if (!r.ok) throw new Error("Gagal");
      return r.json();
    },
    staleTime: 30_000,
  });

  const summary = data?.summary ?? { total_terkumpul: 0, total_outstanding: 0, jumlah_transaksi: 0, invoice_overdue: 0 };
  const monthly = data?.monthly ?? [];
  const byLokasi = data?.byLokasi ?? [];
  const maxMonthly = Math.max(...monthly.map((m) => m.total_bayar), 1);

  return (
    <AppShell>
      <div className="space-y-5 p-6">
        <button onClick={() => window.history.back()} className="mb-1 inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground transition-colors"><ChevronLeft className="h-4 w-4" />Kembali</button>
        <div>
          <h1 className="text-2xl font-bold flex items-center gap-2"><BarChart2 className="h-6 w-6 text-green-600" />Laporan Keuangan Tenant</h1>
          <p className="text-sm text-muted-foreground mt-1">Rekapitulasi pendapatan dan piutang sewa</p>
        </div>

        <div className="flex flex-wrap gap-3 items-end">
          <div>
            <Label className="text-xs text-muted-foreground">Dari</Label>
            <DatePicker value={from} onChange={(v) => setFrom(v)} className="h-8 text-sm w-[150px]" />
          </div>
          <div>
            <Label className="text-xs text-muted-foreground">Sampai</Label>
            <DatePicker value={to} onChange={(v) => setTo(v)} className="h-8 text-sm w-[150px]" />
          </div>
        </div>

        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          <Card><CardContent className="pt-4 pb-3">
            <p className="text-xs text-muted-foreground flex items-center gap-1"><TrendingUp className="h-3 w-3" />Terkumpul</p>
            <p className="text-lg font-bold mt-0.5 text-green-700">{fmt(summary.total_terkumpul)}</p>
            <p className="text-xs text-muted-foreground">{summary.jumlah_transaksi} transaksi</p>
          </CardContent></Card>
          <Card><CardContent className="pt-4 pb-3">
            <p className="text-xs text-muted-foreground flex items-center gap-1"><Wallet className="h-3 w-3" />Outstanding</p>
            <p className="text-lg font-bold mt-0.5 text-amber-700">{fmt(summary.total_outstanding)}</p>
          </CardContent></Card>
          <Card><CardContent className="pt-4 pb-3">
            <p className="text-xs text-muted-foreground flex items-center gap-1"><AlertCircle className="h-3 w-3" />Invoice Overdue</p>
            <p className="text-2xl font-bold mt-0.5 text-red-700">{summary.invoice_overdue}</p>
          </CardContent></Card>
          <Card><CardContent className="pt-4 pb-3">
            <p className="text-xs text-muted-foreground">Collection Rate</p>
            <p className="text-2xl font-bold mt-0.5">
              {summary.total_terkumpul + summary.total_outstanding > 0
                ? Math.round(summary.total_terkumpul / (summary.total_terkumpul + summary.total_outstanding) * 100) + "%"
                : "—"}
            </p>
          </CardContent></Card>
        </div>

        <div className="grid md:grid-cols-2 gap-4">
          <Card>
            <CardHeader><CardTitle className="text-sm">Pendapatan per Bulan</CardTitle></CardHeader>
            <CardContent>
              {isLoading ? <p className="text-center text-muted-foreground py-8 text-sm">Memuat...</p> : monthly.length === 0 ? (
                <p className="text-center text-muted-foreground py-8 text-sm">Belum ada data pada periode ini.</p>
              ) : (
                <div className="space-y-2">
                  {monthly.map((m) => (
                    <div key={m.bulan} className="flex items-center gap-2">
                      <span className="text-xs w-16 text-muted-foreground shrink-0">{m.bulan}</span>
                      <div className="flex-1 h-5 bg-slate-100 rounded overflow-hidden">
                        <div
                          className="h-full bg-green-500 rounded transition-all"
                          style={{ width: `${(m.total_bayar / maxMonthly) * 100}%` }}
                        />
                      </div>
                      <span className="text-xs font-mono w-28 text-right text-green-700 shrink-0">{fmt(m.total_bayar)}</span>
                      <span className="text-xs text-muted-foreground w-8 shrink-0">{m.jumlah_bayar}x</span>
                    </div>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader><CardTitle className="text-sm">Pendapatan per Lokasi</CardTitle></CardHeader>
            <CardContent>
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Lokasi</TableHead>
                    <TableHead className="text-right">Pendapatan</TableHead>
                    <TableHead className="text-center">Transaksi</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {byLokasi.map((l) => (
                    <TableRow key={l.lokasi}>
                      <TableCell className="font-medium text-sm">{l.lokasi}</TableCell>
                      <TableCell className="text-right font-mono text-sm text-green-700">{fmt(l.total_bayar)}</TableCell>
                      <TableCell className="text-center text-sm">{l.jumlah_bayar}</TableCell>
                    </TableRow>
                  ))}
                  {byLokasi.length === 0 && (
                    <TableRow><TableCell colSpan={3} className="text-center text-muted-foreground py-6 text-sm">Tidak ada data.</TableCell></TableRow>
                  )}
                </TableBody>
              </Table>
            </CardContent>
          </Card>
        </div>
      </div>
    </AppShell>
  );
}
