import { useQuery } from "@tanstack/react-query";
import { AppShell } from "@/components/layout/AppShell";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { AlertTriangle, ArrowLeft, ArrowRightLeft, Clock, ExternalLink, Loader2 } from "lucide-react";
import { Link } from "wouter";
import { useCompany } from "@/contexts/CompanyContext";

const idr = (n: number) =>
  new Intl.NumberFormat("id-ID", { style: "currency", currency: "IDR", maximumFractionDigits: 0 }).format(n);

function fmtDate(d: string) {
  return new Date(d).toLocaleDateString("id-ID", { day: "2-digit", month: "short", year: "numeric" });
}

interface TransferHistory {
  id: number;
  ref: string;
  date: string;
  description: string;
  amount: number;
  createdAt: string;
}

export default function KasTransferPage() {
  const { activeCompanyId } = useCompany();

  const { data: history = [], isLoading: histLoading, refetch } = useQuery<TransferHistory[]>({
    queryKey: ["kas-transfer-history", activeCompanyId],
    queryFn: () =>
      fetch(`/api/expenses/kas-transfer-history${activeCompanyId ? `?company=${activeCompanyId}` : ""}`, {
        credentials: "include",
      }).then((r) => r.json()),
  });

  return (
    <AppShell>
      <div className="p-6 max-w-5xl mx-auto space-y-6">
        {/* Header */}
        <div className="flex items-center gap-3">
          <Button variant="ghost" size="icon" asChild>
            <Link href="/expense"><ArrowLeft className="h-4 w-4" /></Link>
          </Button>
          <div>
            <h1 className="text-xl font-bold flex items-center gap-2">
              <ArrowRightLeft className="h-5 w-5 text-primary" />
              Transfer Kas / Bank
              <Badge className="bg-amber-600/20 text-amber-400 border-amber-500 text-[10px] px-1.5 py-0">
                DEPRECATED
              </Badge>
            </h1>
            <p className="text-sm text-muted-foreground">Data historis — read only</p>
          </div>
        </div>

        {/* ── Deprecated Banner ── */}
        <div className="rounded-lg border border-amber-500/40 bg-amber-500/10 p-4 flex items-start gap-3">
          <AlertTriangle size={18} className="text-amber-400 mt-0.5 shrink-0" />
          <div className="flex-1 min-w-0">
            <p className="text-sm font-semibold text-amber-300">Modul ini sudah deprecated</p>
            <p className="text-xs text-amber-200/80 mt-0.5">
              Kas Transfer tidak lagi menerima transaksi baru. Semua transfer dana antar rekening harus
              dilakukan melalui <strong>Finance → Bank Disbursement</strong> dengan tipe{" "}
              <code className="bg-amber-900/40 px-1 rounded">fund_transfer</code>.
              Data historis (referensi KTF/…) tetap tersedia untuk audit.
            </p>
            <div className="mt-3 flex gap-2 flex-wrap">
              <Link href="/accounting/bank-disbursements">
                <Button size="sm" className="bg-amber-500 hover:bg-amber-600 text-black font-semibold gap-1.5">
                  <ExternalLink size={13} />
                  Buka Bank Disbursement
                </Button>
              </Link>
            </div>
          </div>
        </div>

        {/* ── Historical Transfer List ── */}
        <Card>
          <CardHeader className="pb-3">
            <div className="flex items-center justify-between">
              <CardTitle className="text-sm flex items-center gap-2">
                <Clock className="h-4 w-4 text-muted-foreground" />
                Riwayat Transfer Historis
                <Badge variant="outline" className="text-[10px] text-muted-foreground border-muted-foreground/30 ml-1">Read Only</Badge>
              </CardTitle>
              <Button variant="ghost" size="sm" onClick={() => refetch()}>
                <ArrowRightLeft className="h-3.5 w-3.5" />
              </Button>
            </div>
          </CardHeader>
          <CardContent>
            {histLoading ? (
              <div className="flex items-center justify-center py-16">
                <Loader2 className="animate-spin text-muted-foreground" size={22} />
              </div>
            ) : history.length === 0 ? (
              <div className="text-center py-10 text-muted-foreground text-sm">
                <ArrowRightLeft className="h-8 w-8 mx-auto mb-2 opacity-20" />
                <p>Belum ada riwayat transfer</p>
              </div>
            ) : (
              <div className="space-y-2">
                {history.map((h) => (
                  <div key={h.id} className="flex items-start gap-3 rounded-lg border p-3 opacity-80 hover:opacity-100 transition-opacity">
                    <div className="p-1.5 rounded-md bg-primary/10 shrink-0 mt-0.5">
                      <ArrowRightLeft className="h-3.5 w-3.5 text-primary" />
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center justify-between gap-2">
                        <span className="font-mono text-xs font-semibold">{h.ref}</span>
                        <span className="text-xs font-bold text-emerald-600 shrink-0">{idr(h.amount)}</span>
                      </div>
                      <p className="text-xs text-muted-foreground truncate mt-0.5">{h.description}</p>
                      <p className="text-[10px] text-muted-foreground/60 mt-0.5">{fmtDate(h.date)}</p>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>

        {/* Info jurnal pola lama */}
        <Card className="border-dashed opacity-60">
          <CardContent className="pt-4">
            <p className="text-xs font-semibold text-muted-foreground mb-2">Pola Jurnal (historis)</p>
            <div className="space-y-1 text-xs font-mono">
              <div className="flex justify-between">
                <span className="text-blue-500">DR Akun Tujuan</span>
                <span className="text-muted-foreground">xxx</span>
              </div>
              <div className="flex justify-between pl-4">
                <span className="text-red-500">CR Akun Sumber</span>
                <span className="text-muted-foreground">xxx</span>
              </div>
            </div>
            <p className="text-[10px] text-muted-foreground mt-2">
              Entri lama dapat dilihat di Akuntansi → Entri Jurnal dengan filter ref KTF/…
            </p>
          </CardContent>
        </Card>
      </div>
    </AppShell>
  );
}
