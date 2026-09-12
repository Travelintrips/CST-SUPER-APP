import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { AppShell } from "@/components/layout/AppShell";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Download, RefreshCw, TrendingUp, TrendingDown, ArrowLeft } from "lucide-react";
import { useLocation } from "wouter";
import { useCompany } from "@/contexts/CompanyContext";
import { BackButton } from "@/components/ui/back-button";

function formatRp(n: number) { return "Rp " + Math.abs(Math.round(n)).toLocaleString("id-ID"); }
function generatePeriods() {
  const p: string[] = [];
  const now = new Date();
  for (let i = 0; i < 24; i++) {
    const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
    p.push(`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`);
  }
  return p;
}
const PERIODS = ["all", ...generatePeriods()];

interface PpnRow {
  period: string;
  transaction_type: string;
  transaction_ref: string | null;
  partner_name: string | null;
  npwp: string | null;
  tax_invoice_number: string | null;
  base_amount: string;
  tax_amount: string;
  tax_rate: string;
  status: string;
  created_at: string;
}

const STATUS_COLOR: Record<string, string> = {
  pending: "bg-orange-100 text-orange-700",
  paid: "bg-emerald-100 text-emerald-700",
  reported: "bg-blue-100 text-blue-700",
};

function PpnTable({ rows, emptyMsg }: { rows: PpnRow[]; emptyMsg: string }) {
  const total = rows.reduce((s, r) => s + Number(r.tax_amount), 0);
  return (
    <div>
      <div className="rounded-xl border overflow-hidden shadow-sm">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-muted/60 text-xs uppercase tracking-wide text-muted-foreground">
              <tr>
                <th className="px-4 py-3 text-left">Periode</th>
                <th className="px-4 py-3 text-left">Referensi</th>
                <th className="px-4 py-3 text-left">Partner / NPWP</th>
                <th className="px-4 py-3 text-left">No. Faktur</th>
                <th className="px-4 py-3 text-right">DPP</th>
                <th className="px-4 py-3 text-right">PPN</th>
                <th className="px-4 py-3 text-left">Status</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {rows.length === 0 && (
                <tr><td colSpan={7} className="text-center py-10 text-muted-foreground">{emptyMsg}</td></tr>
              )}
              {rows.map((r, i) => (
                <tr key={i} className="hover:bg-muted/30 transition-colors">
                  <td className="px-4 py-3 text-xs text-muted-foreground">{r.period}</td>
                  <td className="px-4 py-3 font-mono text-xs">{r.transaction_ref ?? "-"}</td>
                  <td className="px-4 py-3 text-xs">
                    <div>{r.partner_name ?? <span className="text-muted-foreground/50 text-[10px]">Belum diisi</span>}</div>
                    {r.npwp ? <div className="text-muted-foreground font-mono text-[10px]">{r.npwp}</div> : <div className="text-[10px] text-red-400">Tanpa NPWP</div>}
                  </td>
                  <td className="px-4 py-3 text-xs font-mono">
                    {r.tax_invoice_number ?? <span className="text-red-400 text-[10px]">Belum ada</span>}
                  </td>
                  <td className="px-4 py-3 text-right text-xs">{formatRp(Number(r.base_amount))}</td>
                  <td className="px-4 py-3 text-right font-semibold">{formatRp(Number(r.tax_amount))}</td>
                  <td className="px-4 py-3">
                    <span className={`text-xs font-medium px-2 py-0.5 rounded-full ${STATUS_COLOR[r.status] ?? "bg-muted text-muted-foreground"}`}>
                      {r.status}
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
            {rows.length > 0 && (
              <tfoot className="bg-muted/40 border-t">
                <tr>
                  <td colSpan={5} className="px-4 py-2 text-xs font-semibold text-right">Total</td>
                  <td className="px-4 py-2 text-right font-bold text-sm">{formatRp(total)}</td>
                  <td />
                </tr>
              </tfoot>
            )}
          </table>
        </div>
      </div>
    </div>
  );
}

export default function TaxPpnPage() {
  const { selectedCompanyId } = useCompany();
  const [period, setPeriod] = useState(generatePeriods()[0]);

  const params = new URLSearchParams({ period });
  if (selectedCompanyId) params.set("companyId", String(selectedCompanyId));

  const { data, isLoading, isFetching, refetch } = useQuery<{ keluaran: PpnRow[]; masukan: PpnRow[] }>({
    queryKey: ["tax-ppn", selectedCompanyId, period],
    queryFn: () => fetch(`/api/tax/ppn?${params}`, { credentials: "include" }).then((r) => r.json()),
  });

  const keluaran = data?.keluaran ?? [];
  const masukan = data?.masukan ?? [];
  const totalKeluaran = keluaran.reduce((s, r) => s + Number(r.tax_amount), 0);
  const totalMasukan = masukan.reduce((s, r) => s + Number(r.tax_amount), 0);
  const kurangBayar = totalKeluaran - totalMasukan;

  return (
    <AppShell>
      <BackButton href="/finance/workspace/tax-center" />
      <div className="p-6 space-y-6 max-w-7xl mx-auto">
        <Button variant="ghost" size="sm" className="-ml-2" onClick={() => window.history.back()}>
          <ArrowLeft className="h-4 w-4 mr-1" />Kembali
        </Button>
        <div className="flex items-center justify-between gap-3 flex-wrap">
          <div>
            <h1 className="text-xl font-bold">PPN Masukan & Keluaran</h1>
            <p className="text-sm text-muted-foreground">Rekap PPN untuk pelaporan SPT Masa</p>
          </div>
          <div className="flex items-center gap-2">
            <Select value={period} onValueChange={setPeriod}>
              <SelectTrigger className="w-36 h-9"><SelectValue /></SelectTrigger>
              <SelectContent>
                {PERIODS.map((p) => <SelectItem key={p} value={p}>{p === "all" ? "Semua" : p}</SelectItem>)}
              </SelectContent>
            </Select>
            <Button variant="outline" size="sm" onClick={() => {
              window.open(`/api/tax/export?${params}&type=ppn`, "_blank");
            }}>
              <Download className="h-4 w-4 mr-1.5" />Export
            </Button>
            <Button variant="outline" size="sm" onClick={() => refetch()} disabled={isFetching}>
              <RefreshCw className={`h-4 w-4 ${isFetching ? "animate-spin" : ""}`} />
            </Button>
          </div>
        </div>

        {/* Summary */}
        <div className="grid grid-cols-3 gap-4">
          <Card className="bg-blue-50/60 border-blue-200">
            <CardContent className="p-4">
              <div className="flex items-center gap-2">
                <TrendingUp className="h-4 w-4 text-blue-600" />
                <p className="text-xs font-medium text-blue-700">PPN Keluaran</p>
              </div>
              <p className="text-2xl font-bold text-blue-800 mt-1">{formatRp(totalKeluaran)}</p>
              <p className="text-xs text-blue-600">{keluaran.length} transaksi</p>
            </CardContent>
          </Card>
          <Card className="bg-violet-50/60 border-violet-200">
            <CardContent className="p-4">
              <div className="flex items-center gap-2">
                <TrendingDown className="h-4 w-4 text-violet-600" />
                <p className="text-xs font-medium text-violet-700">PPN Masukan</p>
              </div>
              <p className="text-2xl font-bold text-violet-800 mt-1">{formatRp(totalMasukan)}</p>
              <p className="text-xs text-violet-600">{masukan.length} transaksi</p>
            </CardContent>
          </Card>
          <Card className={kurangBayar > 0 ? "bg-orange-50/60 border-orange-200" : "bg-emerald-50/60 border-emerald-200"}>
            <CardContent className="p-4">
              <p className={`text-xs font-medium ${kurangBayar > 0 ? "text-orange-700" : "text-emerald-700"}`}>
                {kurangBayar > 0 ? "Kurang Bayar" : kurangBayar < 0 ? "Lebih Bayar" : "Nihil"}
              </p>
              <p className={`text-2xl font-bold mt-1 ${kurangBayar > 0 ? "text-orange-800" : "text-emerald-800"}`}>
                {formatRp(Math.abs(kurangBayar))}
              </p>
              <p className="text-xs text-muted-foreground">{kurangBayar > 0 ? "Perlu disetor" : kurangBayar < 0 ? "Bisa dikompensasi" : "-"}</p>
            </CardContent>
          </Card>
        </div>

        {isLoading ? (
          <div className="h-48 bg-muted rounded-xl animate-pulse" />
        ) : (
          <div className="space-y-6">
            <div>
              <h2 className="text-sm font-semibold mb-3 flex items-center gap-2">
                <TrendingUp className="h-4 w-4 text-blue-600" />PPN Keluaran ({keluaran.length})
              </h2>
              <PpnTable rows={keluaran} emptyMsg="Tidak ada PPN Keluaran untuk periode ini" />
            </div>
            <div>
              <h2 className="text-sm font-semibold mb-3 flex items-center gap-2">
                <TrendingDown className="h-4 w-4 text-violet-600" />PPN Masukan ({masukan.length})
              </h2>
              <PpnTable rows={masukan} emptyMsg="Tidak ada PPN Masukan untuk periode ini" />
            </div>
          </div>
        )}
      </div>
    </AppShell>
  );
}
