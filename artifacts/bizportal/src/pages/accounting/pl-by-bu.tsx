import { DatePicker } from "@/components/ui/date-picker";
import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { TrendingUp, TrendingDown, Minus, ArrowLeft } from "lucide-react";
import { Link } from "wouter";

const BUS = ["SPORT_CENTER","AIRPORT_SERVICE","RENTAL_CAR","TENANT","LOGISTICS","FINANCE","UNASSIGNED"];

function fmt(n: number) {
  return new Intl.NumberFormat("id-ID", { style: "currency", currency: "IDR", minimumFractionDigits: 0 }).format(n);
}

async function api(path: string) {
  const r = await fetch(`/api/bank-mutation-masters${path}`);
  const j = await r.json();
  if (!r.ok) throw new Error(j.error ?? "Request gagal");
  return j;
}

export default function PlByBuPage() {
  const [from, setFrom] = useState(() => {
    const d = new Date(); d.setDate(1); return d.toISOString().split("T")[0];
  });
  const [to, setTo] = useState(() => new Date().toISOString().split("T")[0]);
  const [companyId, setCompanyId] = useState("");
  const [enabled, setEnabled] = useState(true);

  const params = new URLSearchParams({ from, to });
  if (companyId) params.set("company_id", companyId);

  const { data, isLoading, refetch } = useQuery({
    queryKey: ["pl-by-bu", from, to, companyId],
    queryFn: () => api(`/pl-by-bu?${params}`),
    enabled,
  });

  const summary: any[] = data?.summary ?? [];
  const detail: any[] = data?.detail ?? [];
  const totalRevenue = summary.reduce((s, r) => s + Number(r.revenue), 0);
  const totalExpense = summary.reduce((s, r) => s + Number(r.expense), 0);
  const totalNet = totalRevenue - totalExpense;

  return (
    <div className="p-6 space-y-6">
      <div>
        <Link href="/accounting"><Button variant="ghost" size="icon" aria-label="Kembali"><ArrowLeft className="h-4 w-4" /></Button></Link>
        <h1 className="text-2xl font-semibold">P&L per Unit Bisnis</h1>
        <p className="text-sm text-muted-foreground">Fase 9 — Laporan laba rugi berdasarkan business unit</p>
      </div>

      <div className="flex flex-wrap gap-3 items-end">
        <div>
          <label className="text-sm font-medium block mb-1">Dari</label>
          <DatePicker value={from} onChange={v => setFrom(v)} className="w-36" />
        </div>
        <div>
          <label className="text-sm font-medium block mb-1">Sampai</label>
          <DatePicker value={to} onChange={v => setTo(v)} className="w-36" />
        </div>
        <div>
          <label className="text-sm font-medium block mb-1">Company ID</label>
          <Input placeholder="Semua" value={companyId} onChange={e => setCompanyId(e.target.value)} className="w-24" />
        </div>
        <Button onClick={() => refetch()}>Tampilkan</Button>
      </div>

      {/* Summary Cards */}
      <div className="grid grid-cols-3 gap-4">
        <Card>
          <CardHeader className="pb-1"><CardTitle className="text-sm text-muted-foreground">Total Pendapatan</CardTitle></CardHeader>
          <CardContent><div className="text-2xl font-bold text-green-600">{fmt(totalRevenue)}</div></CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-1"><CardTitle className="text-sm text-muted-foreground">Total Beban</CardTitle></CardHeader>
          <CardContent><div className="text-2xl font-bold text-red-600">{fmt(totalExpense)}</div></CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-1"><CardTitle className="text-sm text-muted-foreground">Net Profit / Loss</CardTitle></CardHeader>
          <CardContent>
            <div className={`text-2xl font-bold flex items-center gap-1 ${totalNet >= 0 ? "text-green-600" : "text-red-600"}`}>
              {totalNet >= 0 ? <TrendingUp className="w-5 h-5" /> : <TrendingDown className="w-5 h-5" />}
              {fmt(totalNet)}
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Per BU Table */}
      {isLoading ? (
        <div className="text-center py-8 text-muted-foreground">Memuat data...</div>
      ) : summary.length === 0 ? (
        <div className="text-center py-8 text-muted-foreground">Belum ada data pada periode ini</div>
      ) : (
        <div className="border rounded-lg overflow-auto">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Unit Bisnis</TableHead>
                <TableHead className="text-right">Pendapatan</TableHead>
                <TableHead className="text-right">Beban</TableHead>
                <TableHead className="text-right">Lain-lain</TableHead>
                <TableHead className="text-right font-semibold">Net</TableHead>
                <TableHead className="text-center">Margin</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {summary.map((row: any) => {
                const rev = Number(row.revenue);
                const exp = Number(row.expense);
                const net = Number(row.net);
                const margin = rev > 0 ? ((net / rev) * 100).toFixed(1) : "—";
                return (
                  <TableRow key={row.business_unit}>
                    <TableCell className="font-medium">{row.business_unit}</TableCell>
                    <TableCell className="text-right text-green-700">{fmt(rev)}</TableCell>
                    <TableCell className="text-right text-red-700">{fmt(exp)}</TableCell>
                    <TableCell className="text-right text-muted-foreground">{fmt(Number(row.others))}</TableCell>
                    <TableCell className={`text-right font-semibold ${net >= 0 ? "text-green-700" : "text-red-700"}`}>{fmt(net)}</TableCell>
                    <TableCell className="text-center">
                      {margin !== "—" ? (
                        <span className={`text-sm font-medium ${Number(margin) >= 0 ? "text-green-600" : "text-red-600"}`}>{margin}%</span>
                      ) : <Minus className="w-3 h-3 mx-auto text-muted-foreground" />}
                    </TableCell>
                  </TableRow>
                );
              })}
              <TableRow className="border-t-2 font-semibold bg-muted/30">
                <TableCell>TOTAL</TableCell>
                <TableCell className="text-right text-green-700">{fmt(totalRevenue)}</TableCell>
                <TableCell className="text-right text-red-700">{fmt(totalExpense)}</TableCell>
                <TableCell className="text-right">—</TableCell>
                <TableCell className={`text-right ${totalNet >= 0 ? "text-green-700" : "text-red-700"}`}>{fmt(totalNet)}</TableCell>
                <TableCell />
              </TableRow>
            </TableBody>
          </Table>
        </div>
      )}

      {/* Detail per kategori */}
      {detail.length > 0 && (
        <details className="border rounded-lg p-4">
          <summary className="cursor-pointer font-medium text-sm">Detail per ERP Category ({detail.length} baris)</summary>
          <div className="mt-3 overflow-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Unit Bisnis</TableHead>
                  <TableHead>ERP Category</TableHead>
                  <TableHead>Accounting Class</TableHead>
                  <TableHead className="text-right">Credit</TableHead>
                  <TableHead className="text-right">Debit</TableHead>
                  <TableHead className="text-right">Transaksi</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {detail.map((r: any, i: number) => (
                  <TableRow key={i}>
                    <TableCell className="text-sm">{r.business_unit}</TableCell>
                    <TableCell className="font-mono text-xs">{r.erp_category ?? "—"}</TableCell>
                    <TableCell className="text-sm">{r.accounting_class ?? "—"}</TableCell>
                    <TableCell className="text-right text-sm">{fmt(Number(r.total_credit))}</TableCell>
                    <TableCell className="text-right text-sm">{fmt(Number(r.total_debit))}</TableCell>
                    <TableCell className="text-right text-sm">{r.tx_count}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        </details>
      )}
    </div>
  );
}
