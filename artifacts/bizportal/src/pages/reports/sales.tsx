import { useState } from "react";
import { useGetSalesReport, getGetSalesReportQueryKey } from "@workspace/api-client-react";
import { AppShell } from "@/components/layout/AppShell";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { DatePicker } from "@/components/ui/date-picker";
import { Label } from "@/components/ui/label";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { ArrowLeft, TrendingUp } from "lucide-react";
import { Link } from "wouter";

const idr = (n: number) =>
  new Intl.NumberFormat("id-ID", { style: "currency", currency: "IDR", maximumFractionDigits: 0 }).format(n);

export default function SalesReportPage() {
  const [from, setFrom] = useState<string>("");
  const [to, setTo] = useState<string>("");
  const params = {
    ...(from ? { from: new Date(from).toISOString() } : {}),
    ...(to ? { to: new Date(to + "T23:59:59").toISOString() } : {}),
  };
  const { data, isLoading, error } = useGetSalesReport(params, {
    query: { queryKey: getGetSalesReportQueryKey(params) },
  });

  return (
    <AppShell>
      <div className="space-y-6 p-6">
        <div className="flex items-center justify-between">
          <div>
            <Link href="/reports"><Button variant="ghost" size="icon"><ArrowLeft className="h-4 w-4" /></Button></Link>

            <h1 className="text-2xl font-bold flex items-center gap-2">
              <TrendingUp className="h-6 w-6" /> Laporan Penjualan
            </h1>
            <p className="text-sm text-muted-foreground">Analisis pendapatan, pelanggan teratas, dan produk laris</p>
          </div>
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
                <CardHeader>
                  <CardTitle className="text-sm font-medium text-muted-foreground">Total Pendapatan</CardTitle>
                </CardHeader>
                <CardContent>
                  <div className="text-3xl font-bold" data-testid="stat-total-revenue">{idr(data.totalRevenue)}</div>
                </CardContent>
              </Card>
              <Card>
                <CardHeader>
                  <CardTitle className="text-sm font-medium text-muted-foreground">Total Order</CardTitle>
                </CardHeader>
                <CardContent>
                  <div className="text-3xl font-bold" data-testid="stat-total-orders">{data.totalOrders}</div>
                </CardContent>
              </Card>
              <Card>
                <CardHeader>
                  <CardTitle className="text-sm font-medium text-muted-foreground">Rata-Rata per Order</CardTitle>
                </CardHeader>
                <CardContent>
                  <div className="text-3xl font-bold">{idr(data.avgOrderValue)}</div>
                </CardContent>
              </Card>
            </div>

            <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
              <Card>
                <CardHeader><CardTitle>Pendapatan per Bulan</CardTitle></CardHeader>
                <CardContent>
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Periode</TableHead>
                        <TableHead className="text-right">Order</TableHead>
                        <TableHead className="text-right">Pendapatan</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {data.byMonth.length === 0 ? (
                        <TableRow><TableCell colSpan={3} className="text-center text-muted-foreground">Tidak ada data</TableCell></TableRow>
                      ) : data.byMonth.map((m) => (
                        <TableRow key={m.period}>
                          <TableCell>{m.period}</TableCell>
                          <TableCell className="text-right">{m.count}</TableCell>
                          <TableCell className="text-right font-medium">{idr(m.revenue)}</TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </CardContent>
              </Card>

              <Card>
                <CardHeader><CardTitle>Pelanggan Teratas</CardTitle></CardHeader>
                <CardContent>
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Pelanggan</TableHead>
                        <TableHead className="text-right">Order</TableHead>
                        <TableHead className="text-right">Total</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {data.byCustomer.length === 0 ? (
                        <TableRow><TableCell colSpan={3} className="text-center text-muted-foreground">Tidak ada data</TableCell></TableRow>
                      ) : data.byCustomer.map((c) => (
                        <TableRow key={c.name}>
                          <TableCell>{c.name}</TableCell>
                          <TableCell className="text-right">{c.count}</TableCell>
                          <TableCell className="text-right font-medium">{idr(c.revenue)}</TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </CardContent>
              </Card>
            </div>

            <Card>
              <CardHeader><CardTitle>Produk Terlaris</CardTitle></CardHeader>
              <CardContent>
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Produk</TableHead>
                      <TableHead className="text-right">Qty</TableHead>
                      <TableHead className="text-right">Total Pendapatan</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {data.byProduct.length === 0 ? (
                      <TableRow><TableCell colSpan={3} className="text-center text-muted-foreground">Tidak ada data</TableCell></TableRow>
                    ) : data.byProduct.map((p) => (
                      <TableRow key={p.name}>
                        <TableCell>{p.name}</TableCell>
                        <TableCell className="text-right">{p.qty}</TableCell>
                        <TableCell className="text-right font-medium">{idr(p.revenue)}</TableCell>
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
