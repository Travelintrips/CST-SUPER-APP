import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { AppShell } from "@/components/layout/AppShell";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { ArrowLeft, PackageSearch, BarChart2, Building2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Link } from "wouter";

const idr = (n: number) =>
  new Intl.NumberFormat("id-ID", { style: "currency", currency: "IDR", maximumFractionDigits: 0 }).format(n);
const num = (n: number) =>
  new Intl.NumberFormat("id-ID", { maximumFractionDigits: 2 }).format(n);

type ValuationData = {
  items: Array<{
    productId: number; productName: string; sku: string | null;
    warehouseId: number; warehouseName: string;
    companyId: number; companyName: string;
    qty: number; costPrice: number; totalValue: number; category: string | null;
  }>;
  summary: { totalValue: number; totalQty: number; totalItems: number };
  byCompany: Array<{ companyId: number; companyName: string; totalValue: number; itemCount: number }>;
  byWarehouse: Array<{ warehouseId: number; warehouseName: string; totalValue: number; itemCount: number }>;
};

export default function InventoryValuationPage() {
  const [companyId, setCompanyId] = useState<string>("all");
  const [warehouseId, setWarehouseId] = useState<string>("");
  const [view, setView] = useState<"detail" | "by-company" | "by-warehouse">("detail");

  const params = new URLSearchParams();
  if (companyId !== "all") params.set("companyId", companyId);
  if (warehouseId) params.set("warehouseId", warehouseId);

  const { data, isLoading, error } = useQuery<ValuationData>({
    queryKey: ["inventory-valuation", companyId, warehouseId],
    queryFn: async () => {
      const res = await fetch(`/api/reports/inventory-valuation?${params}`);
      if (!res.ok) throw new Error(await res.text());
      return res.json();
    },
  });

  const companies = useQuery<Array<{ id: number; company_name: string }>>({
    queryKey: ["companies-list"],
    queryFn: async () => {
      const res = await fetch("/api/companies");
      if (!res.ok) throw new Error(await res.text());
      return res.json();
    },
  });

  return (
    <AppShell>
      <div className="space-y-6 p-6">
        <div className="flex items-center justify-between">
          <div>
            <Link href="/reports"><Button variant="ghost" size="icon"><ArrowLeft className="h-4 w-4" /></Button></Link>

            <h1 className="text-2xl font-bold flex items-center gap-2">
              <PackageSearch className="h-6 w-6" /> Laporan Valuasi Persediaan
            </h1>
            <p className="text-sm text-muted-foreground">Nilai stok per produk, gudang, dan perusahaan</p>
          </div>
        </div>

        <Card>
          <CardContent className="flex flex-wrap gap-4 p-4">
            <div className="w-48">
              <label className="text-xs font-medium text-muted-foreground mb-1 block">Perusahaan</label>
              <Select value={companyId} onValueChange={setCompanyId}>
                <SelectTrigger><SelectValue placeholder="Semua perusahaan" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">Semua Perusahaan</SelectItem>
                  {(companies.data ?? []).map((c) => (
                    <SelectItem key={c.id} value={String(c.id)}>{c.company_name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="w-48">
              <label className="text-xs font-medium text-muted-foreground mb-1 block">Tampilan</label>
              <Select value={view} onValueChange={(v) => setView(v as typeof view)}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="detail">Detail per Produk</SelectItem>
                  <SelectItem value="by-company">Ringkasan per Perusahaan</SelectItem>
                  <SelectItem value="by-warehouse">Ringkasan per Gudang</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </CardContent>
        </Card>

        {error ? (
          <div className="rounded-md border border-destructive/30 bg-destructive/10 p-4 text-sm text-destructive">
            Gagal memuat data: {String((error as any)?.message ?? error)}
          </div>
        ) : isLoading || !data ? (
          <div className="text-muted-foreground p-4">Memuat data valuasi...</div>
        ) : (
          <>
            <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
              <Card>
                <CardHeader><CardTitle className="text-sm font-medium text-muted-foreground">Total Nilai Persediaan</CardTitle></CardHeader>
                <CardContent><div className="text-2xl font-bold">{idr(data.summary.totalValue)}</div></CardContent>
              </Card>
              <Card>
                <CardHeader><CardTitle className="text-sm font-medium text-muted-foreground">Total Produk</CardTitle></CardHeader>
                <CardContent><div className="text-2xl font-bold">{data.summary.totalItems}</div></CardContent>
              </Card>
              <Card>
                <CardHeader><CardTitle className="text-sm font-medium text-muted-foreground">Total Qty</CardTitle></CardHeader>
                <CardContent><div className="text-2xl font-bold">{num(data.summary.totalQty)}</div></CardContent>
              </Card>
            </div>

            {view === "detail" && (
              <Card>
                <CardHeader><CardTitle className="flex items-center gap-2"><BarChart2 className="h-4 w-4" /> Detail Stok per Produk</CardTitle></CardHeader>
                <CardContent className="p-0">
                  <div className="overflow-x-auto">
                    <Table>
                      <TableHeader>
                        <TableRow>
                          <TableHead>Produk</TableHead>
                          <TableHead>SKU</TableHead>
                          <TableHead>Kategori</TableHead>
                          <TableHead>Gudang</TableHead>
                          <TableHead>Perusahaan</TableHead>
                          <TableHead className="text-right">Qty</TableHead>
                          <TableHead className="text-right">Harga Pokok</TableHead>
                          <TableHead className="text-right">Total Nilai</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {data.items.length === 0 ? (
                          <TableRow><TableCell colSpan={8} className="text-center text-muted-foreground py-8">Tidak ada data stok</TableCell></TableRow>
                        ) : data.items.map((item, i) => (
                          <TableRow key={i}>
                            <TableCell className="font-medium">{item.productName}</TableCell>
                            <TableCell className="text-muted-foreground text-sm">{item.sku ?? "-"}</TableCell>
                            <TableCell>{item.category ? <Badge variant="outline">{item.category}</Badge> : <span className="text-muted-foreground">-</span>}</TableCell>
                            <TableCell>{item.warehouseName}</TableCell>
                            <TableCell>{item.companyName}</TableCell>
                            <TableCell className="text-right">{num(item.qty)}</TableCell>
                            <TableCell className="text-right">{idr(item.costPrice)}</TableCell>
                            <TableCell className="text-right font-medium">{idr(item.totalValue)}</TableCell>
                          </TableRow>
                        ))}
                      </TableBody>
                    </Table>
                  </div>
                </CardContent>
              </Card>
            )}

            {view === "by-company" && (
              <Card>
                <CardHeader><CardTitle className="flex items-center gap-2"><Building2 className="h-4 w-4" /> Ringkasan per Perusahaan</CardTitle></CardHeader>
                <CardContent className="p-0">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Perusahaan</TableHead>
                        <TableHead className="text-right">Jumlah Produk</TableHead>
                        <TableHead className="text-right">Total Nilai</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {data.byCompany.map((c) => (
                        <TableRow key={c.companyId}>
                          <TableCell className="font-medium">{c.companyName}</TableCell>
                          <TableCell className="text-right">{c.itemCount}</TableCell>
                          <TableCell className="text-right font-bold">{idr(c.totalValue)}</TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </CardContent>
              </Card>
            )}

            {view === "by-warehouse" && (
              <Card>
                <CardHeader><CardTitle className="flex items-center gap-2"><BarChart2 className="h-4 w-4" /> Ringkasan per Gudang</CardTitle></CardHeader>
                <CardContent className="p-0">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Gudang</TableHead>
                        <TableHead className="text-right">Jumlah Produk</TableHead>
                        <TableHead className="text-right">Total Nilai</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {data.byWarehouse.map((w) => (
                        <TableRow key={w.warehouseId}>
                          <TableCell className="font-medium">{w.warehouseName}</TableCell>
                          <TableCell className="text-right">{w.itemCount}</TableCell>
                          <TableCell className="text-right font-bold">{idr(w.totalValue)}</TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </CardContent>
              </Card>
            )}
          </>
        )}
      </div>
    </AppShell>
  );
}
