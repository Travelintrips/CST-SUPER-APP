import { Link } from "wouter";
import { AppShell } from "@/components/layout/AppShell";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { useCompany } from "@/contexts/CompanyContext";
import { useQuery } from "@tanstack/react-query";
import { ArrowLeft, AlertTriangle, Banknote, Loader2, ExternalLink } from "lucide-react";

const idr = (n: number | string) =>
  new Intl.NumberFormat("id-ID", { style: "currency", currency: "IDR", maximumFractionDigits: 0 }).format(Number(n));
const fmtDate = (d: string) =>
  d ? new Date(d).toLocaleDateString("id-ID", { day: "2-digit", month: "short", year: "numeric" }) : "-";

async function apiFetch(url: string) {
  const r = await fetch(url, { credentials: "include" });
  const d = await r.json();
  if (!r.ok) throw new Error(d.message ?? "Terjadi kesalahan.");
  return d;
}

export default function VendorPaymentsPage() {
  const { activeCompanyId } = useCompany();
  const cq = activeCompanyId ? `?company=${activeCompanyId}` : "";

  const { data: list = [], isLoading } = useQuery({
    queryKey: ["vendor-payments", activeCompanyId],
    queryFn: () => apiFetch(`/api/vendor-payments${cq}`),
  });

  const { data: summary } = useQuery({
    queryKey: ["vendor-payments-summary", activeCompanyId],
    queryFn: () => apiFetch(`/api/vendor-payments/summary${cq}`),
  });

  const totalAmount = Number(summary?.total_amount ?? 0);
  const thisMonth   = Number(summary?.this_month_amount ?? 0);

  return (
    <AppShell>
      <div className="p-6 space-y-5 max-w-5xl mx-auto">
        {/* Header */}
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <Link href="/expense">
              <Button variant="ghost" size="icon" className="h-8 w-8"><ArrowLeft size={15} /></Button>
            </Link>
            <div className="flex items-center gap-2">
              <Banknote size={20} className="text-emerald-400" />
              <div>
                <h1 className="text-xl font-bold flex items-center gap-2">
                  Pembayaran Vendor
                  <Badge className="bg-amber-600/20 text-amber-400 border-amber-500 text-[10px] px-1.5 py-0">
                    DEPRECATED
                  </Badge>
                </h1>
                <p className="text-sm text-muted-foreground">Data historis — read only</p>
              </div>
            </div>
          </div>
        </div>

        {/* ── Deprecated Banner ── */}
        <div className="rounded-lg border border-amber-500/40 bg-amber-500/10 p-4 flex items-start gap-3">
          <AlertTriangle size={18} className="text-amber-400 mt-0.5 shrink-0" />
          <div className="flex-1 min-w-0">
            <p className="text-sm font-semibold text-amber-300">Modul ini sudah deprecated</p>
            <p className="text-xs text-amber-200/80 mt-0.5">
              Vendor Payments tidak lagi menerima transaksi baru. Semua pembayaran keluar via bank harus
              dilakukan melalui <strong>Finance → Bank Disbursement</strong> (tipe: <code className="bg-amber-900/40 px-1 rounded">supplier_payment</code>).
              Data historis di bawah tetap tersedia untuk audit.
            </p>
            <div className="mt-3">
              <Link href="/accounting/bank-disbursements">
                <Button size="sm" className="bg-amber-500 hover:bg-amber-600 text-black font-semibold gap-1.5">
                  <ExternalLink size={13} />
                  Buka Bank Disbursement
                </Button>
              </Link>
            </div>
          </div>
        </div>

        {/* Summary cards — read only */}
        {summary && (
          <div className="grid grid-cols-3 gap-4">
            <Card className="opacity-70">
              <CardContent className="pt-4 pb-3">
                <p className="text-xs text-muted-foreground">Total Transaksi (historis)</p>
                <p className="text-2xl font-bold">{summary.total_count ?? 0}</p>
                <p className="text-xs text-muted-foreground mt-1">Bank: {summary.bank_count} · Kas: {summary.cash_count}</p>
              </CardContent>
            </Card>
            <Card className="opacity-70">
              <CardContent className="pt-4 pb-3">
                <p className="text-xs text-muted-foreground">Total Nominal (historis)</p>
                <p className="text-xl font-bold text-emerald-400">{idr(totalAmount)}</p>
              </CardContent>
            </Card>
            <Card className="opacity-70">
              <CardContent className="pt-4 pb-3">
                <p className="text-xs text-muted-foreground">Bulan Ini (historis)</p>
                <p className="text-xl font-bold text-sky-400">{idr(thisMonth)}</p>
                <p className="text-xs text-muted-foreground mt-1">{summary.this_month_count ?? 0} transaksi</p>
              </CardContent>
            </Card>
          </div>
        )}

        {/* Historical data table — read only */}
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm text-muted-foreground flex items-center gap-2">
              Data Historis
              <Badge variant="outline" className="text-[10px] text-muted-foreground border-muted-foreground/30">Read Only</Badge>
            </CardTitle>
          </CardHeader>
          <CardContent className="p-0">
            {isLoading ? (
              <div className="flex items-center justify-center py-16">
                <Loader2 className="animate-spin text-muted-foreground" size={24} />
              </div>
            ) : list.length === 0 ? (
              <div className="flex flex-col items-center justify-center py-16 text-muted-foreground gap-2">
                <Banknote size={32} className="opacity-30" />
                <p className="text-sm">Tidak ada data historis.</p>
              </div>
            ) : (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>No. Pembayaran</TableHead>
                    <TableHead>Vendor</TableHead>
                    <TableHead>Tanggal</TableHead>
                    <TableHead>Referensi</TableHead>
                    <TableHead>Metode</TableHead>
                    <TableHead className="text-right">Nominal</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {list.map((row: any) => (
                    <TableRow key={row.id} className="opacity-80">
                      <TableCell className="font-mono text-xs text-sky-400">{row.payment_number}</TableCell>
                      <TableCell className="font-medium">{row.vendor_name}</TableCell>
                      <TableCell className="text-sm text-muted-foreground">{fmtDate(row.payment_date)}</TableCell>
                      <TableCell className="text-xs text-muted-foreground">{row.reference ?? "—"}</TableCell>
                      <TableCell>
                        <Badge variant="outline" className={row.payment_method === "bank"
                          ? "bg-blue-900/30 text-blue-300 border-blue-600"
                          : "bg-amber-900/30 text-amber-300 border-amber-600"}>
                          {row.payment_method === "bank" ? "Bank" : "Kas"}
                        </Badge>
                      </TableCell>
                      <TableCell className="text-right font-mono text-sm">{idr(row.amount)}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            )}
          </CardContent>
        </Card>
      </div>
    </AppShell>
  );
}
