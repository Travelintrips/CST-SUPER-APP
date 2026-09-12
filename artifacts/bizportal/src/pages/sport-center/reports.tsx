import { DatePicker } from "@/components/ui/date-picker";
import { useState } from "react";
import { useLocation } from "wouter";
import { AppShell } from "@/components/layout/AppShell";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { useQuery } from "@tanstack/react-query";
import { useCompany } from "@/contexts/CompanyContext";
import { BarChart2, TrendingUp, DollarSign, ArrowLeft, Receipt } from "lucide-react";

const idr = (n: number) =>
  new Intl.NumberFormat("id-ID", { style: "currency", currency: "IDR", maximumFractionDigits: 0 }).format(n);

export default function SportCenterReports() {
  const [, navigate] = useLocation();
  const { activeCompanyId } = useCompany();
  const today = new Date().toISOString().split("T")[0];
  const thirtyDaysAgo = new Date(Date.now() - 30 * 86400000).toISOString().split("T")[0];

  const [from, setFrom] = useState(thirtyDaysAgo);
  const [to, setTo] = useState(today);
  const [queryFrom, setQueryFrom] = useState(thirtyDaysAgo);
  const [queryTo, setQueryTo] = useState(today);

  const { data, isLoading } = useQuery({
    queryKey: ["sport-center-reports", activeCompanyId, queryFrom, queryTo],
    queryFn: async () => {
      const qs = new URLSearchParams({ from: queryFrom, to: queryTo });
      if (activeCompanyId) qs.set("companyId", String(activeCompanyId));
      const r = await fetch(`/api/sport-center/reports/revenue?${qs}`, { credentials: "include" });
      if (!r.ok) throw new Error("Gagal memuat");
      return r.json();
    },
  });

  const totalRevenue = (data?.monthly ?? []).reduce((s: number, m: any) => s + Number(m.revenue), 0);
  const totalTx = (data?.monthly ?? []).reduce((s: number, m: any) => s + Number(m.transactions), 0);

  const fmtTs = (ts: string | null | undefined) => {
    if (!ts) return "-";
    try {
      return new Intl.DateTimeFormat("id-ID", {
        day: "2-digit", month: "short", year: "numeric",
        hour: "2-digit", minute: "2-digit",
      }).format(new Date(ts));
    } catch { return ts; }
  };

  return (
    <AppShell>
      <div className="p-6 space-y-5">
        <div className="flex items-center gap-3">
          <Button variant="ghost" size="icon" onClick={() => navigate("/tenant/workspace/sport-center")} className="h-8 w-8 shrink-0">
            <ArrowLeft className="h-4 w-4" />
          </Button>
          <BarChart2 className="h-6 w-6 text-cyan-400" />
          <div>
            <h1 className="text-2xl font-bold text-foreground">Laporan Revenue</h1>
            <p className="text-sm text-muted-foreground">Analisis pendapatan Sport Center</p>
          </div>
        </div>

        <Card className="border-border/60">
          <CardContent className="p-4 flex flex-wrap items-end gap-3">
            <div className="space-y-1">
              <Label className="text-xs">Dari</Label>
              <DatePicker value={from} onChange={(v) => setFrom(v)} className="w-38" />
            </div>
            <div className="space-y-1">
              <Label className="text-xs">Sampai</Label>
              <DatePicker value={to} onChange={(v) => setTo(v)} className="w-38" />
            </div>
            <Button size="sm" onClick={() => { setQueryFrom(from); setQueryTo(to); }}>
              Tampilkan
            </Button>
          </CardContent>
        </Card>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <Card className="border-border/60 bg-emerald-900/10">
            <CardContent className="p-5">
              <p className="text-xs text-muted-foreground mb-1">Total Revenue Periode</p>
              <p className="text-2xl font-bold text-emerald-400">{idr(totalRevenue)}</p>
            </CardContent>
          </Card>
          <Card className="border-border/60 bg-blue-900/10">
            <CardContent className="p-5">
              <p className="text-xs text-muted-foreground mb-1">Total Transaksi</p>
              <p className="text-2xl font-bold text-blue-400">{totalTx}</p>
            </CardContent>
          </Card>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
          <Card className="border-border/60">
            <CardHeader className="pb-2">
              <CardTitle className="text-sm text-muted-foreground flex items-center gap-2">
                <TrendingUp className="h-4 w-4" /> Revenue Bulanan
              </CardTitle>
            </CardHeader>
            <CardContent>
              {isLoading ? (
                <p className="text-sm text-muted-foreground text-center py-4">Memuat…</p>
              ) : (data?.monthly ?? []).length === 0 ? (
                <p className="text-sm text-muted-foreground text-center py-4">Tidak ada data</p>
              ) : (
                <div className="space-y-2">
                  {(data?.monthly ?? []).map((m: any) => (
                    <div key={m.month} className="flex items-center justify-between">
                      <span className="text-sm text-muted-foreground">{m.month}</span>
                      <div className="text-right">
                        <p className="text-sm font-medium text-foreground">{idr(Number(m.revenue))}</p>
                        <p className="text-xs text-muted-foreground">{m.transactions} transaksi</p>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>

          <Card className="border-border/60">
            <CardHeader className="pb-2">
              <CardTitle className="text-sm text-muted-foreground flex items-center gap-2">
                <DollarSign className="h-4 w-4" /> Revenue per Fasilitas
              </CardTitle>
            </CardHeader>
            <CardContent>
              {isLoading ? (
                <p className="text-sm text-muted-foreground text-center py-4">Memuat…</p>
              ) : (data?.byFacility ?? []).length === 0 ? (
                <p className="text-sm text-muted-foreground text-center py-4">Tidak ada data</p>
              ) : (
                <div className="space-y-3">
                  {(data?.byFacility ?? []).map((f: any) => (
                    <div key={f.facility_name} className="flex items-center justify-between">
                      <div>
                        <p className="text-sm font-medium text-foreground">{f.facility_name}</p>
                        <p className="text-xs text-muted-foreground">{f.bookings} booking</p>
                      </div>
                      <p className="text-sm font-medium text-emerald-400">{idr(Number(f.revenue))}</p>
                    </div>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>
        </div>

        <Card className="border-border/60">
          <CardHeader className="pb-2">
            <CardTitle className="text-sm text-muted-foreground">Revenue per Metode Pembayaran</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
              {(data?.byMethod ?? []).map((m: any) => (
                <div key={m.method} className="p-3 rounded-lg bg-muted/20 border border-border/40">
                  <p className="text-xs text-muted-foreground capitalize">{m.method}</p>
                  <p className="text-sm font-bold text-foreground mt-1">{idr(Number(m.total))}</p>
                  <p className="text-xs text-muted-foreground">{m.transactions} tx</p>
                </div>
              ))}
              {(data?.byMethod ?? []).length === 0 && !isLoading && (
                <p className="col-span-4 text-sm text-muted-foreground text-center py-4">Tidak ada data</p>
              )}
            </div>
          </CardContent>
        </Card>

        <Card className="border-border/60">
          <CardHeader className="pb-2">
            <CardTitle className="text-sm text-muted-foreground flex items-center gap-2">
              <Receipt className="h-4 w-4" /> Daftar Transaksi
              {(data?.transactions ?? []).length > 0 && (
                <Badge className="bg-muted/60 text-muted-foreground border-border text-xs">
                  {(data?.transactions ?? []).length} transaksi
                </Badge>
              )}
            </CardTitle>
          </CardHeader>
          <CardContent className="p-0">
            {isLoading ? (
              <div className="p-4 space-y-2">
                {Array.from({ length: 5 }).map((_, i) => (
                  <div key={i} className="h-10 rounded-lg bg-muted/20 animate-pulse" />
                ))}
              </div>
            ) : (data?.transactions ?? []).length === 0 ? (
              <p className="text-sm text-muted-foreground text-center py-8">
                Tidak ada transaksi pada periode ini
              </p>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-xs">
                  <thead>
                    <tr className="border-b border-border/40 bg-muted/30">
                      {["No. Pembayaran", "No. Booking", "Pelanggan", "Tanggal Booking", "Metode", "Status", "Jumlah", "Sumber Fasilitas"].map(h => (
                        <th key={h} className="text-left py-2.5 px-3 text-muted-foreground font-medium whitespace-nowrap">{h}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {(data?.transactions ?? []).map((tx: any, i: number) => (
                      <tr key={tx.id ?? i} className="border-b border-border/20 hover:bg-muted/30 transition-colors">
                        <td className="py-2 px-3 font-mono text-xs text-muted-foreground whitespace-nowrap">
                          {tx.payment_number ?? "-"}
                        </td>
                        <td className="py-2 px-3 font-mono text-xs text-muted-foreground whitespace-nowrap">
                          {tx.booking_number ?? "-"}
                        </td>
                        <td className="py-2 px-3 text-foreground max-w-[140px] truncate">
                          {tx.customer_name || "-"}
                        </td>
                        <td className="py-2 px-3 text-muted-foreground whitespace-nowrap">
                          {tx.booking_date
                            ? new Intl.DateTimeFormat("id-ID", { day: "2-digit", month: "short", year: "numeric" }).format(new Date(tx.booking_date))
                            : "-"}
                        </td>
                        <td className="py-2 px-3 text-muted-foreground capitalize">
                          {tx.payment_method ?? "cash"}
                        </td>
                        <td className="py-2 px-3">
                          <span className={`inline-flex px-1.5 py-0.5 rounded border text-[10px] font-medium ${
                            tx.payment_status === "paid"
                              ? "bg-emerald-900/40 text-emerald-300 border-emerald-600"
                              : tx.payment_status === "pending"
                              ? "bg-yellow-900/40 text-yellow-300 border-yellow-600"
                              : "bg-muted/40 text-muted-foreground border-border"
                          }`}>
                            {tx.payment_status === "paid" ? "Lunas" : tx.payment_status === "pending" ? "Pending" : (tx.payment_status ?? "-")}
                          </span>
                        </td>
                        <td className="py-2 px-3 text-right font-medium text-foreground whitespace-nowrap">
                          {idr(Number(tx.amount ?? 0))}
                        </td>
                        <td className="py-2 px-3 text-muted-foreground max-w-[140px] truncate">
                          {tx.facility_name || "-"}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                  <tfoot>
                    <tr className="border-t border-border/40 bg-muted/20">
                      <td colSpan={7} className="py-2 px-3 text-xs text-muted-foreground font-medium">
                        Total ({(data?.transactions ?? []).length} transaksi)
                      </td>
                      <td className="py-2 px-3 text-right font-bold text-emerald-400 whitespace-nowrap">
                        {idr((data?.transactions ?? []).reduce((s: number, tx: any) => s + Number(tx.amount ?? 0), 0))}
                      </td>
                    </tr>
                  </tfoot>
                </table>
              </div>
            )}
          </CardContent>
        </Card>
      </div>
    </AppShell>
  );
}
