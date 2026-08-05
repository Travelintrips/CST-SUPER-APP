import { useState } from "react";
import { useGetPurchaseReport, getGetPurchaseReportQueryKey } from "@workspace/api-client-react";
import { AppShell } from "@/components/layout/AppShell";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { DatePicker } from "@/components/ui/date-picker";
import { Label } from "@/components/ui/label";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { ArrowLeft, ShoppingBag } from "lucide-react";
import { Link } from "wouter";

const idr = (n: number) =>
  new Intl.NumberFormat("id-ID", { style: "currency", currency: "IDR", maximumFractionDigits: 0 }).format(n);

export default function PurchaseReportPage() {
  const [from, setFrom] = useState<string>("");
  const [to, setTo] = useState<string>("");
  const params = {
    ...(from ? { from: new Date(from).toISOString() } : {}),
    ...(to ? { to: new Date(to + "T23:59:59").toISOString() } : {}),
  };
  const { data, isLoading, error } = useGetPurchaseReport(params, {
    query: { queryKey: getGetPurchaseReportQueryKey(params) },
  });

  return (
    <AppShell>
      <div className="space-y-6 p-6">
        <div>
          <Link href="/reports"><Button variant="ghost" size="icon"><ArrowLeft className="h-4 w-4" /></Button></Link>

          <h1 className="text-2xl font-bold flex items-center gap-2">
            <ShoppingBag className="h-6 w-6" /> Laporan Pembelian
          </h1>
          <p className="text-sm text-muted-foreground">Analisis pengeluaran, vendor teratas, dan barang yang sering dibeli</p>
        </div>

        <Card>
          <CardContent className="flex gap-4 p-4">
            <div className="flex-1">
              <Label htmlFor="from">Dari Tanggal</Label>
              <DatePicker value={from} onChange={setFrom} data-testid="input-from" />
            </div>
            <div className="flex-1">
              <Label htmlFor="to">Sampai Tanggal</Label>
              <DatePicker value={to} onChange={setTo} data-testid="input-to" />
            </div>
          </CardContent>
        </Card>

        {error ? (
          <div className="rounded-md border border-destructive/30 bg-destructive/10 p-4 text-sm text-destructive" data-testid="error-state">
            Gagal memuat laporan: {String((error as any)?.message ?? error)}
          </div>
        ) : isLoading || !data ? (
          <div className="text-muted-foreground">Memuat laporan...</div>
        ) : (
          <>
            <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
              <Card>
                <CardHeader><CardTitle className="text-sm font-medium text-muted-foreground">Total Pengeluaran</CardTitle></CardHeader>
                <CardContent>
                  <div className="text-3xl font-bold" data-testid="stat-total-spend">{idr(data.totalSpend)}</div>
                </CardContent>
              </Card>
              <Card>
                <CardHeader><CardTitle className="text-sm font-medium text-muted-foreground">Total PO</CardTitle></CardHeader>
                <CardContent>
                  <div className="text-3xl font-bold" data-testid="stat-total-orders">{data.totalOrders}</div>
                </CardContent>
              </Card>
              <Card>
                <CardHeader><CardTitle className="text-sm font-medium text-muted-foreground">Rata-Rata per PO</CardTitle></CardHeader>
                <CardContent>
                  <div className="text-3xl font-bold">{idr(data.avgOrderValue)}</div>
                </CardContent>
              </Card>
            </div>

            <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
              <Card>
                <CardHeader><CardTitle>Pengeluaran per Bulan</CardTitle></CardHeader>
                <CardContent>
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Periode</TableHead>
                        <TableHead className="text-right">PO</TableHead>
                        <TableHead className="text-right">Pengeluaran</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {data.byMonth.length === 0 ? (
                        <TableRow><TableCell colSpan={3} className="text-center text-muted-foreground">Tidak ada data</TableCell></TableRow>
                      ) : data.byMonth.map((m) => (
                        <TableRow key={m.period}>
                          <TableCell>{m.period}</TableCell>
                          <TableCell className="text-right">{m.count}</TableCell>
                          <TableCell className="text-right font-medium">{idr(m.spend)}</TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </CardContent>
              </Card>

              <Card>
                <CardHeader><CardTitle>Vendor Teratas</CardTitle></CardHeader>
                <CardContent>
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Vendor</TableHead>
                        <TableHead className="text-right">PO</TableHead>
                        <TableHead className="text-right">Total</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {data.byVendor.length === 0 ? (
                        <TableRow><TableCell colSpan={3} className="text-center text-muted-foreground">Tidak ada data</TableCell></TableRow>
                      ) : data.byVendor.map((v) => (
                        <TableRow key={v.name}>
                          <TableCell>{v.name}</TableCell>
                          <TableCell className="text-right">{v.count}</TableCell>
                          <TableCell className="text-right font-medium">{idr(v.spend)}</TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </CardContent>
              </Card>
            </div>

            <Card>
              <CardHeader><CardTitle>Barang Paling Sering Dibeli</CardTitle></CardHeader>
              <CardContent>
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Barang</TableHead>
                      <TableHead className="text-right">Qty</TableHead>
                      <TableHead className="text-right">Total Pengeluaran</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {data.byProduct.length === 0 ? (
                      <TableRow><TableCell colSpan={3} className="text-center text-muted-foreground">Tidak ada data</TableCell></TableRow>
                    ) : data.byProduct.map((p) => (
                      <TableRow key={p.name}>
                        <TableCell>{p.name}</TableCell>
                        <TableCell className="text-right">{p.qty}</TableCell>
                        <TableCell className="text-right font-medium">{idr(p.spend)}</TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </CardContent>
            </Card>
          </>
        )}
      </div>
    </AppShell>
  );
}
