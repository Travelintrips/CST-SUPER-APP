import React, { useState, useCallback } from "react";
import { useQuery } from "@tanstack/react-query";
import { DatePicker } from "@/components/ui/date-picker";
import {
  BarChart2, TrendingUp, Store, Users, Package, AlertTriangle,
  ArrowLeftRight, RotateCcw, Flame, FileDown, RefreshCw, Filter,
  ShoppingBag, Warehouse, CalendarRange,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { useToast } from "@/hooks/use-toast";

// ─── Utility ────────────────────────────────────────────────────────────────

const API = "/api/reports";

async function fetchJSON(url: string) {
  const r = await fetch(url);
  if (!r.ok) throw new Error(await r.text());
  return r.json();
}

function fmt(n: number | string | null | undefined) {
  const num = Number(n ?? 0);
  return new Intl.NumberFormat("id-ID", { minimumFractionDigits: 0, maximumFractionDigits: 0 }).format(num);
}

function fmtCur(n: number | string | null | undefined) {
  const num = Number(n ?? 0);
  return new Intl.NumberFormat("id-ID", { style: "currency", currency: "IDR", minimumFractionDigits: 0 }).format(num);
}

function fmtDate(s: string | null | undefined) {
  if (!s) return "-";
  return new Date(s).toLocaleDateString("id-ID", { day: "2-digit", month: "short", year: "numeric" });
}

type Option = { id: number | string; name: string; code?: string; branch_name?: string };

// ─── Filter Bar ─────────────────────────────────────────────────────────────

interface Filters {
  from: string;
  to: string;
  companyId: string;
  branchId: string;
  warehouseId: string;
  cashierId: string;
  productId: string;
  threshold: string;
}

const today = new Date().toISOString().split("T")[0];
const firstOfMonth = new Date(new Date().getFullYear(), new Date().getMonth(), 1).toISOString().split("T")[0];

const defaultFilters: Filters = {
  from: firstOfMonth,
  to: today,
  companyId: "",
  branchId: "",
  warehouseId: "",
  cashierId: "",
  productId: "",
  threshold: "5",
};

function buildQS(f: Filters, extras?: Record<string, string>) {
  const p: Record<string, string> = {};
  if (f.from) p.from = f.from;
  if (f.to) p.to = f.to;
  if (f.companyId) p.companyId = f.companyId;
  if (f.branchId) p.branchId = f.branchId;
  if (f.warehouseId) p.warehouseId = f.warehouseId;
  if (f.cashierId) p.cashierId = f.cashierId;
  if (f.productId) p.productId = f.productId;
  if (extras) Object.assign(p, extras);
  return new URLSearchParams(p).toString();
}

// ─── Export CSV ─────────────────────────────────────────────────────────────

function exportCSV(filename: string, rows: Record<string, unknown>[]) {
  if (!rows?.length) return;
  const headers = Object.keys(rows[0]);
  const lines = [headers.join(",")];
  for (const r of rows) {
    lines.push(headers.map((h) => {
      const v = String(r[h] ?? "").replace(/"/g, '""');
      return `"${v}"`;
    }).join(","));
  }
  const blob = new Blob([lines.join("\n")], { type: "text/csv" });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = `${filename}_${today}.csv`;
  a.click();
}

// ─── Komponen Filter Panel ───────────────────────────────────────────────────

function FilterPanel({
  filters, setFilters, showCashier, showWarehouse, showProduct, showThreshold,
}: {
  filters: Filters;
  setFilters: React.Dispatch<React.SetStateAction<Filters>>;
  showCashier?: boolean;
  showWarehouse?: boolean;
  showProduct?: boolean;
  showThreshold?: boolean;
}) {
  const set = (k: keyof Filters, v: string) => setFilters((f) => ({ ...f, [k]: v }));

  const { data: companies } = useQuery<Option[]>({ queryKey: ["rpt-meta-companies"], queryFn: () => fetchJSON(`${API}/meta/companies`), staleTime: 60000 });
  const { data: branches } = useQuery<Option[]>({ queryKey: ["rpt-meta-branches", filters.companyId], queryFn: () => fetchJSON(`${API}/meta/branches?${buildQS(filters)}`), staleTime: 30000 });
  const { data: warehouses } = useQuery<(Option & { branch_name?: string })[]>({ queryKey: ["rpt-meta-warehouses", filters.companyId, filters.branchId], queryFn: () => fetchJSON(`${API}/meta/warehouses?${buildQS(filters)}`), staleTime: 30000, enabled: showWarehouse });
  const { data: cashiers } = useQuery<(Option & { branch_name?: string })[]>({ queryKey: ["rpt-meta-cashiers", filters.companyId, filters.branchId], queryFn: () => fetchJSON(`${API}/meta/cashiers?${buildQS(filters)}`), staleTime: 30000, enabled: showCashier });

  return (
    <Card className="mb-4">
      <CardContent className="pt-4">
        <div className="flex flex-wrap gap-3 items-end">
          <div className="flex flex-col gap-1 min-w-[130px]">
            <Label className="text-xs">Dari</Label>
            <DatePicker value={filters.from} onChange={(v) => set("from", v)} className="h-8 text-sm" />
          </div>
          <div className="flex flex-col gap-1 min-w-[130px]">
            <Label className="text-xs">Sampai</Label>
            <DatePicker value={filters.to} onChange={(v) => set("to", v)} className="h-8 text-sm" />
          </div>

          {companies && companies.length > 1 && (
            <div className="flex flex-col gap-1 min-w-[160px]">
              <Label className="text-xs">Perusahaan</Label>
              <Select value={filters.companyId} onValueChange={(v) => { set("companyId", v === "all" ? "" : v); set("branchId", ""); set("warehouseId", ""); }}>
                <SelectTrigger className="h-8 text-sm"><SelectValue placeholder="Semua" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">Semua Perusahaan</SelectItem>
                  {companies.map((c) => <SelectItem key={c.id} value={String(c.id)}>{c.name}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
          )}

          {branches && branches.length > 0 && (
            <div className="flex flex-col gap-1 min-w-[150px]">
              <Label className="text-xs">Cabang</Label>
              <Select value={filters.branchId} onValueChange={(v) => { set("branchId", v === "all" ? "" : v); set("warehouseId", ""); }}>
                <SelectTrigger className="h-8 text-sm"><SelectValue placeholder="Semua Cabang" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">Semua Cabang</SelectItem>
                  {branches.map((b) => <SelectItem key={b.id} value={String(b.id)}>{b.name}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
          )}

          {showWarehouse && warehouses && warehouses.length > 0 && (
            <div className="flex flex-col gap-1 min-w-[160px]">
              <Label className="text-xs">Gudang</Label>
              <Select value={filters.warehouseId} onValueChange={(v) => set("warehouseId", v === "all" ? "" : v)}>
                <SelectTrigger className="h-8 text-sm"><SelectValue placeholder="Semua Gudang" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">Semua Gudang</SelectItem>
                  {warehouses.map((w) => <SelectItem key={w.id} value={String(w.id)}>{w.name}{w.branch_name ? ` (${w.branch_name})` : ""}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
          )}

          {showCashier && cashiers && cashiers.length > 0 && (
            <div className="flex flex-col gap-1 min-w-[150px]">
              <Label className="text-xs">Kasir</Label>
              <Select value={filters.cashierId} onValueChange={(v) => set("cashierId", v === "all" ? "" : v)}>
                <SelectTrigger className="h-8 text-sm"><SelectValue placeholder="Semua Kasir" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">Semua Kasir</SelectItem>
                  {cashiers.map((c) => <SelectItem key={c.id} value={String(c.id)}>{c.name}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
          )}

          {showThreshold && (
            <div className="flex flex-col gap-1 w-[120px]">
              <Label className="text-xs">Batas Stok Min.</Label>
              <Input type="number" value={filters.threshold} onChange={(e) => set("threshold", e.target.value)} className="h-8 text-sm" min={0} />
            </div>
          )}
        </div>
      </CardContent>
    </Card>
  );
}

// ─── Summary Cards ────────────────────────────────────────────────────────────

function SummaryCards({ data }: { data: Record<string, number> | undefined }) {
  if (!data) return null;
  return (
    <div className="grid grid-cols-2 md:grid-cols-3 xl:grid-cols-6 gap-3 mb-4">
      {data.jumlah_transaksi !== undefined && (
        <Card><CardContent className="p-3">
          <p className="text-xs text-muted-foreground">Transaksi</p>
          <p className="text-xl font-bold">{fmt(data.jumlah_transaksi)}</p>
        </CardContent></Card>
      )}
      {data.total_penjualan !== undefined && (
        <Card><CardContent className="p-3">
          <p className="text-xs text-muted-foreground">Total Penjualan</p>
          <p className="text-lg font-bold text-emerald-500">{fmtCur(data.total_penjualan)}</p>
        </CardContent></Card>
      )}
      {data.total_diskon !== undefined && (
        <Card><CardContent className="p-3">
          <p className="text-xs text-muted-foreground">Total Diskon</p>
          <p className="text-lg font-bold text-amber-500">{fmtCur(data.total_diskon)}</p>
        </CardContent></Card>
      )}
      {data.rata_rata_transaksi !== undefined && (
        <Card><CardContent className="p-3">
          <p className="text-xs text-muted-foreground">Rata-rata/Transaksi</p>
          <p className="text-lg font-bold">{fmtCur(data.rata_rata_transaksi)}</p>
        </CardContent></Card>
      )}
      {data.jumlah_kasir_aktif !== undefined && (
        <Card><CardContent className="p-3">
          <p className="text-xs text-muted-foreground">Kasir Aktif</p>
          <p className="text-xl font-bold">{fmt(data.jumlah_kasir_aktif)}</p>
        </CardContent></Card>
      )}
      {data.jumlah_cabang_aktif !== undefined && (
        <Card><CardContent className="p-3">
          <p className="text-xs text-muted-foreground">Cabang Aktif</p>
          <p className="text-xl font-bold">{fmt(data.jumlah_cabang_aktif)}</p>
        </CardContent></Card>
      )}
    </div>
  );
}

// ─── Tab: Penjualan Harian ────────────────────────────────────────────────────

function TabSalesDaily({ filters }: { filters: Filters }) {
  const qs = buildQS(filters);
  const { data, isLoading, refetch } = useQuery<any[]>({ queryKey: ["rpt-pos-daily", qs], queryFn: () => fetchJSON(`${API}/pos/daily?${qs}`) });
  const sum = useQuery<any>({ queryKey: ["rpt-pos-summary", qs], queryFn: () => fetchJSON(`${API}/pos/summary?${qs}`) });

  return (
    <div>
      <SummaryCards data={sum.data} />
      <div className="flex justify-end mb-2 gap-2">
        <Button size="sm" variant="outline" onClick={() => refetch()}><RefreshCw size={14} className="mr-1" />Refresh</Button>
        <Button size="sm" variant="outline" onClick={() => exportCSV("penjualan_harian", data ?? [])}><FileDown size={14} className="mr-1" />Ekspor CSV</Button>
      </div>
      <div className="rounded-md border overflow-auto max-h-[55vh]">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Tanggal</TableHead>
              <TableHead className="text-right">Transaksi</TableHead>
              <TableHead className="text-right">Subtotal</TableHead>
              <TableHead className="text-right">Diskon</TableHead>
              <TableHead className="text-right">Total Penjualan</TableHead>
              <TableHead className="text-right">Kasir</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {isLoading ? (
              <TableRow><TableCell colSpan={6} className="text-center py-8 text-muted-foreground">Memuat...</TableCell></TableRow>
            ) : !data?.length ? (
              <TableRow><TableCell colSpan={6} className="text-center py-8 text-muted-foreground">Tidak ada data</TableCell></TableRow>
            ) : data.map((row, i) => (
              <TableRow key={i}>
                <TableCell>{fmtDate(row.tanggal)}</TableCell>
                <TableCell className="text-right">{fmt(row.jumlah_transaksi)}</TableCell>
                <TableCell className="text-right">{fmtCur(row.subtotal)}</TableCell>
                <TableCell className="text-right text-amber-600">{fmtCur(row.total_diskon)}</TableCell>
                <TableCell className="text-right font-semibold text-emerald-600">{fmtCur(row.total_penjualan)}</TableCell>
                <TableCell className="text-right">{fmt(row.jumlah_kasir)}</TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>
    </div>
  );
}

// ─── Tab: Per Cabang ─────────────────────────────────────────────────────────

function TabSalesBranch({ filters }: { filters: Filters }) {
  const qs = buildQS(filters);
  const { data, isLoading, refetch } = useQuery<any[]>({ queryKey: ["rpt-pos-branch", qs], queryFn: () => fetchJSON(`${API}/pos/by-branch?${qs}`) });

  return (
    <div>
      <div className="flex justify-end mb-2 gap-2">
        <Button size="sm" variant="outline" onClick={() => refetch()}><RefreshCw size={14} className="mr-1" />Refresh</Button>
        <Button size="sm" variant="outline" onClick={() => exportCSV("penjualan_per_cabang", data ?? [])}><FileDown size={14} className="mr-1" />Ekspor CSV</Button>
      </div>
      <div className="rounded-md border overflow-auto max-h-[60vh]">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Cabang</TableHead>
              <TableHead>Unit Bisnis</TableHead>
              <TableHead className="text-right">Transaksi</TableHead>
              <TableHead className="text-right">Diskon</TableHead>
              <TableHead className="text-right">Total Penjualan</TableHead>
              <TableHead className="text-right">Rata-rata/Transaksi</TableHead>
              <TableHead className="text-right">Kasir</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {isLoading ? (
              <TableRow><TableCell colSpan={7} className="text-center py-8 text-muted-foreground">Memuat...</TableCell></TableRow>
            ) : !data?.length ? (
              <TableRow><TableCell colSpan={7} className="text-center py-8 text-muted-foreground">Tidak ada data</TableCell></TableRow>
            ) : data.map((row, i) => (
              <TableRow key={i}>
                <TableCell className="font-medium">{row.branch_name}</TableCell>
                <TableCell className="text-muted-foreground text-sm">{row.business_unit || "-"}</TableCell>
                <TableCell className="text-right">{fmt(row.jumlah_transaksi)}</TableCell>
                <TableCell className="text-right text-amber-600">{fmtCur(row.total_diskon)}</TableCell>
                <TableCell className="text-right font-semibold text-emerald-600">{fmtCur(row.total_penjualan)}</TableCell>
                <TableCell className="text-right">{fmtCur(row.rata_rata_transaksi)}</TableCell>
                <TableCell className="text-right">{fmt(row.jumlah_kasir)}</TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>
    </div>
  );
}

// ─── Tab: Per Kasir ──────────────────────────────────────────────────────────

function TabSalesCashier({ filters }: { filters: Filters }) {
  const qs = buildQS(filters);
  const { data, isLoading, refetch } = useQuery<any[]>({ queryKey: ["rpt-pos-cashier", qs], queryFn: () => fetchJSON(`${API}/pos/by-cashier?${qs}`) });

  return (
    <div>
      <div className="flex justify-end mb-2 gap-2">
        <Button size="sm" variant="outline" onClick={() => refetch()}><RefreshCw size={14} className="mr-1" />Refresh</Button>
        <Button size="sm" variant="outline" onClick={() => exportCSV("penjualan_per_kasir", data ?? [])}><FileDown size={14} className="mr-1" />Ekspor CSV</Button>
      </div>
      <div className="rounded-md border overflow-auto max-h-[60vh]">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Kasir</TableHead>
              <TableHead>Email</TableHead>
              <TableHead>Cabang</TableHead>
              <TableHead className="text-right">Transaksi</TableHead>
              <TableHead className="text-right">Diskon</TableHead>
              <TableHead className="text-right">Total Penjualan</TableHead>
              <TableHead className="text-right">Rata-rata/Transaksi</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {isLoading ? (
              <TableRow><TableCell colSpan={7} className="text-center py-8 text-muted-foreground">Memuat...</TableCell></TableRow>
            ) : !data?.length ? (
              <TableRow><TableCell colSpan={7} className="text-center py-8 text-muted-foreground">Tidak ada data</TableCell></TableRow>
            ) : data.map((row, i) => (
              <TableRow key={i}>
                <TableCell className="font-medium">{row.kasir_name}</TableCell>
                <TableCell className="text-muted-foreground text-sm">{row.kasir_email}</TableCell>
                <TableCell>{row.branch_name}</TableCell>
                <TableCell className="text-right">{fmt(row.jumlah_transaksi)}</TableCell>
                <TableCell className="text-right text-amber-600">{fmtCur(row.total_diskon)}</TableCell>
                <TableCell className="text-right font-semibold text-emerald-600">{fmtCur(row.total_penjualan)}</TableCell>
                <TableCell className="text-right">{fmtCur(row.rata_rata_per_transaksi)}</TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>
    </div>
  );
}

// ─── Tab: Produk Terlaris ─────────────────────────────────────────────────────

function TabTopProducts({ filters }: { filters: Filters }) {
  const qs = buildQS(filters);
  const { data, isLoading, refetch } = useQuery<any[]>({ queryKey: ["rpt-pos-top-products", qs], queryFn: () => fetchJSON(`${API}/pos/top-products?${qs}&limit=100`) });

  return (
    <div>
      <div className="flex justify-end mb-2 gap-2">
        <Button size="sm" variant="outline" onClick={() => refetch()}><RefreshCw size={14} className="mr-1" />Refresh</Button>
        <Button size="sm" variant="outline" onClick={() => exportCSV("produk_terlaris", data ?? [])}><FileDown size={14} className="mr-1" />Ekspor CSV</Button>
      </div>
      <div className="rounded-md border overflow-auto max-h-[60vh]">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>#</TableHead>
              <TableHead>Produk</TableHead>
              <TableHead>SKU</TableHead>
              <TableHead>Satuan</TableHead>
              <TableHead className="text-right">Qty Terjual</TableHead>
              <TableHead className="text-right">Transaksi</TableHead>
              <TableHead className="text-right">Harga Rata-rata</TableHead>
              <TableHead className="text-right">Total Pendapatan</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {isLoading ? (
              <TableRow><TableCell colSpan={8} className="text-center py-8 text-muted-foreground">Memuat...</TableCell></TableRow>
            ) : !data?.length ? (
              <TableRow><TableCell colSpan={8} className="text-center py-8 text-muted-foreground">Tidak ada data</TableCell></TableRow>
            ) : data.map((row, i) => (
              <TableRow key={i}>
                <TableCell className="text-muted-foreground">{i + 1}</TableCell>
                <TableCell className="font-medium">
                  {i < 3 && <span className="mr-1">{["🥇", "🥈", "🥉"][i]}</span>}
                  {row.product_name}
                </TableCell>
                <TableCell className="text-muted-foreground text-sm">{row.sku || "-"}</TableCell>
                <TableCell>{row.unit || "-"}</TableCell>
                <TableCell className="text-right font-bold">{fmt(row.total_qty_terjual)}</TableCell>
                <TableCell className="text-right">{fmt(row.jumlah_transaksi)}</TableCell>
                <TableCell className="text-right">{fmtCur(row.harga_rata_rata)}</TableCell>
                <TableCell className="text-right font-semibold text-emerald-600">{fmtCur(row.total_pendapatan)}</TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>
    </div>
  );
}

// ─── Tab: Stok Bahan Baku ─────────────────────────────────────────────────────

function TabStock({ filters }: { filters: Filters }) {
  const qs = buildQS(filters);
  const { data, isLoading, refetch } = useQuery<any[]>({ queryKey: ["rpt-inv-stock", qs], queryFn: () => fetchJSON(`${API}/inv/stock?${qs}`) });

  const totalNilai = data?.reduce((s, r) => s + Number(r.nilai_stok ?? 0), 0) ?? 0;

  return (
    <div>
      {data?.length ? (
        <div className="flex gap-4 mb-3">
          <Card className="flex-1"><CardContent className="p-3">
            <p className="text-xs text-muted-foreground">Total Produk</p>
            <p className="text-xl font-bold">{fmt(data.length)}</p>
          </CardContent></Card>
          <Card className="flex-1"><CardContent className="p-3">
            <p className="text-xs text-muted-foreground">Total Nilai Stok</p>
            <p className="text-lg font-bold text-blue-500">{fmtCur(totalNilai)}</p>
          </CardContent></Card>
        </div>
      ) : null}
      <div className="flex justify-end mb-2 gap-2">
        <Button size="sm" variant="outline" onClick={() => refetch()}><RefreshCw size={14} className="mr-1" />Refresh</Button>
        <Button size="sm" variant="outline" onClick={() => exportCSV("stok_produk", data ?? [])}><FileDown size={14} className="mr-1" />Ekspor CSV</Button>
      </div>
      <div className="rounded-md border overflow-auto max-h-[55vh]">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Produk</TableHead>
              <TableHead>SKU</TableHead>
              <TableHead>Satuan</TableHead>
              <TableHead>Gudang</TableHead>
              <TableHead>Cabang</TableHead>
              <TableHead>Rak</TableHead>
              <TableHead className="text-right">Qty</TableHead>
              <TableHead className="text-right">Harga Pokok</TableHead>
              <TableHead className="text-right">Nilai Stok</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {isLoading ? (
              <TableRow><TableCell colSpan={9} className="text-center py-8 text-muted-foreground">Memuat...</TableCell></TableRow>
            ) : !data?.length ? (
              <TableRow><TableCell colSpan={9} className="text-center py-8 text-muted-foreground">Tidak ada data</TableCell></TableRow>
            ) : data.map((row, i) => (
              <TableRow key={i} className={Number(row.qty) <= 0 ? "opacity-50" : ""}>
                <TableCell className="font-medium">{row.product_name}</TableCell>
                <TableCell className="text-muted-foreground text-sm">{row.sku || "-"}</TableCell>
                <TableCell>{row.unit || "-"}</TableCell>
                <TableCell>{row.warehouse_name}</TableCell>
                <TableCell>{row.branch_name || "-"}</TableCell>
                <TableCell>{row.rack_code || "-"}</TableCell>
                <TableCell className="text-right font-bold">{fmt(row.qty)}</TableCell>
                <TableCell className="text-right">{fmtCur(row.cost_price)}</TableCell>
                <TableCell className="text-right font-semibold text-blue-600">{fmtCur(row.nilai_stok)}</TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>
    </div>
  );
}

// ─── Tab: Stok Minimum ────────────────────────────────────────────────────────

function TabStockLow({ filters }: { filters: Filters }) {
  const qs = buildQS(filters, { threshold: filters.threshold });
  const { data, isLoading, refetch } = useQuery<any[]>({ queryKey: ["rpt-inv-stock-low", qs], queryFn: () => fetchJSON(`${API}/inv/stock-low?${qs}`) });

  return (
    <div>
      {data?.length ? (
        <div className="mb-3">
          <Badge variant="destructive" className="text-sm px-3 py-1">
            <AlertTriangle size={14} className="mr-1" />
            {data.filter((r) => Number(r.qty) <= 0).length} produk habis &nbsp;·&nbsp;
            {data.filter((r) => Number(r.qty) > 0).length} produk hampir habis
          </Badge>
        </div>
      ) : null}
      <div className="flex justify-end mb-2 gap-2">
        <Button size="sm" variant="outline" onClick={() => refetch()}><RefreshCw size={14} className="mr-1" />Refresh</Button>
        <Button size="sm" variant="outline" onClick={() => exportCSV("stok_minimum", data ?? [])}><FileDown size={14} className="mr-1" />Ekspor CSV</Button>
      </div>
      <div className="rounded-md border overflow-auto max-h-[55vh]">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Produk</TableHead>
              <TableHead>SKU</TableHead>
              <TableHead>Satuan</TableHead>
              <TableHead>Gudang</TableHead>
              <TableHead>Cabang</TableHead>
              <TableHead className="text-right">Qty</TableHead>
              <TableHead>Status</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {isLoading ? (
              <TableRow><TableCell colSpan={7} className="text-center py-8 text-muted-foreground">Memuat...</TableCell></TableRow>
            ) : !data?.length ? (
              <TableRow><TableCell colSpan={7} className="text-center py-8 text-muted-foreground">Semua stok aman ✓</TableCell></TableRow>
            ) : data.map((row, i) => (
              <TableRow key={i}>
                <TableCell className="font-medium">{row.product_name}</TableCell>
                <TableCell className="text-muted-foreground text-sm">{row.sku || "-"}</TableCell>
                <TableCell>{row.unit || "-"}</TableCell>
                <TableCell>{row.warehouse_name}</TableCell>
                <TableCell>{row.branch_name || "-"}</TableCell>
                <TableCell className="text-right font-bold text-destructive">{fmt(row.qty)}</TableCell>
                <TableCell>
                  <Badge variant={row.status === "Habis" ? "destructive" : "outline"} className={row.status !== "Habis" ? "text-amber-600 border-amber-400" : ""}>
                    {row.status}
                  </Badge>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>
    </div>
  );
}

// ─── Tab: Mutasi Stok ─────────────────────────────────────────────────────────

const MOVEMENT_LABELS: Record<string, string> = {
  po_receipt: "Terima PO", so_delivery: "Kirim SO",
  transfer_in: "Transfer Masuk", transfer_out: "Transfer Keluar",
  return_in: "Retur Masuk", return_out: "Retur Keluar",
  damage: "Rusak/Hilang", manual_in: "Masuk Manual", manual_out: "Keluar Manual",
  opname_adjust: "Penyesuaian Opname", opname_in: "Opname Masuk", opname_out: "Opname Keluar",
};

function TabMovements({ filters }: { filters: Filters }) {
  const [typeFilter, setTypeFilter] = useState("");
  const qs = buildQS(filters, typeFilter ? { type: typeFilter } : undefined);
  const { data, isLoading, refetch } = useQuery<any[]>({ queryKey: ["rpt-inv-movements", qs], queryFn: () => fetchJSON(`${API}/inv/movements?${qs}&limit=500`) });

  return (
    <div>
      <div className="flex flex-wrap gap-2 mb-3 items-end">
        <div className="flex flex-col gap-1 min-w-[180px]">
          <Label className="text-xs">Jenis Mutasi</Label>
          <Select value={typeFilter || "all"} onValueChange={(v) => setTypeFilter(v === "all" ? "" : v)}>
            <SelectTrigger className="h-8 text-sm"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">Semua Jenis</SelectItem>
              {Object.entries(MOVEMENT_LABELS).map(([k, v]) => <SelectItem key={k} value={k}>{v}</SelectItem>)}
            </SelectContent>
          </Select>
        </div>
        <Button size="sm" variant="outline" onClick={() => refetch()}><RefreshCw size={14} className="mr-1" />Refresh</Button>
        <Button size="sm" variant="outline" onClick={() => exportCSV("mutasi_stok", data ?? [])}><FileDown size={14} className="mr-1" />Ekspor CSV</Button>
      </div>
      <div className="rounded-md border overflow-auto max-h-[55vh]">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Waktu</TableHead>
              <TableHead>Jenis</TableHead>
              <TableHead>Produk</TableHead>
              <TableHead>Gudang</TableHead>
              <TableHead>Cabang</TableHead>
              <TableHead>Rak</TableHead>
              <TableHead className="text-right">Qty</TableHead>
              <TableHead className="text-right">Sebelum</TableHead>
              <TableHead className="text-right">Sesudah</TableHead>
              <TableHead>Referensi</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {isLoading ? (
              <TableRow><TableCell colSpan={10} className="text-center py-8 text-muted-foreground">Memuat...</TableCell></TableRow>
            ) : !data?.length ? (
              <TableRow><TableCell colSpan={10} className="text-center py-8 text-muted-foreground">Tidak ada mutasi</TableCell></TableRow>
            ) : data.map((row, i) => (
              <TableRow key={i}>
                <TableCell className="text-sm whitespace-nowrap">{fmtDate(row.created_at)}</TableCell>
                <TableCell>
                  <Badge variant="outline" className="text-xs whitespace-nowrap">
                    {MOVEMENT_LABELS[row.type] || row.type}
                  </Badge>
                </TableCell>
                <TableCell className="font-medium max-w-[180px] truncate">{row.product_name}</TableCell>
                <TableCell className="text-sm">{row.warehouse_name}</TableCell>
                <TableCell className="text-sm">{row.branch_name || "-"}</TableCell>
                <TableCell className="text-sm">{row.rack_code || "-"}</TableCell>
                <TableCell className={`text-right font-semibold ${Number(row.qty) > 0 ? "text-emerald-600" : "text-destructive"}`}>
                  {Number(row.qty) > 0 ? "+" : ""}{fmt(row.qty)}
                </TableCell>
                <TableCell className="text-right text-muted-foreground">{fmt(row.qty_before)}</TableCell>
                <TableCell className="text-right">{fmt(row.qty_after)}</TableCell>
                <TableCell className="text-sm text-muted-foreground">{row.ref_type ? `${row.ref_type} #${row.ref_id}` : row.note || "-"}</TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>
    </div>
  );
}

// ─── Tab: Transfer Stok ───────────────────────────────────────────────────────

const TRANSFER_STATUS_LABELS: Record<string, string> = {
  draft: "Draft", sent: "Dikirim", received: "Diterima", cancelled: "Batal",
};
const TRANSFER_STATUS_COLORS: Record<string, string> = {
  draft: "outline", sent: "secondary", received: "default", cancelled: "destructive",
};

function TabTransfers({ filters }: { filters: Filters }) {
  const qs = buildQS(filters);
  const { data, isLoading, refetch } = useQuery<any[]>({ queryKey: ["rpt-inv-transfers", qs], queryFn: () => fetchJSON(`${API}/inv/transfers?${qs}`) });

  return (
    <div>
      <div className="flex justify-end mb-2 gap-2">
        <Button size="sm" variant="outline" onClick={() => refetch()}><RefreshCw size={14} className="mr-1" />Refresh</Button>
        <Button size="sm" variant="outline" onClick={() => exportCSV("transfer_stok", data ?? [])}><FileDown size={14} className="mr-1" />Ekspor CSV</Button>
      </div>
      <div className="rounded-md border overflow-auto max-h-[60vh]">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>No. Transfer</TableHead>
              <TableHead>Dari</TableHead>
              <TableHead>Ke</TableHead>
              <TableHead>Status</TableHead>
              <TableHead className="text-right">Item</TableHead>
              <TableHead className="text-right">Qty Diminta</TableHead>
              <TableHead className="text-right">Qty Dikirim</TableHead>
              <TableHead className="text-right">Qty Diterima</TableHead>
              <TableHead>Dibuat</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {isLoading ? (
              <TableRow><TableCell colSpan={9} className="text-center py-8 text-muted-foreground">Memuat...</TableCell></TableRow>
            ) : !data?.length ? (
              <TableRow><TableCell colSpan={9} className="text-center py-8 text-muted-foreground">Tidak ada transfer</TableCell></TableRow>
            ) : data.map((row, i) => (
              <TableRow key={i}>
                <TableCell className="font-mono text-sm font-medium">{row.transfer_number}</TableCell>
                <TableCell className="text-sm">
                  <div>{row.from_warehouse}</div>
                  {row.from_branch && <div className="text-muted-foreground text-xs">{row.from_branch}</div>}
                </TableCell>
                <TableCell className="text-sm">
                  <div>{row.to_warehouse}</div>
                  {row.to_branch && <div className="text-muted-foreground text-xs">{row.to_branch}</div>}
                </TableCell>
                <TableCell>
                  <Badge variant={TRANSFER_STATUS_COLORS[row.status] as any || "outline"}>
                    {TRANSFER_STATUS_LABELS[row.status] || row.status}
                  </Badge>
                </TableCell>
                <TableCell className="text-right">{fmt(row.jumlah_item)}</TableCell>
                <TableCell className="text-right">{fmt(row.total_qty_diminta)}</TableCell>
                <TableCell className="text-right">{fmt(row.total_qty_dikirim)}</TableCell>
                <TableCell className="text-right">{fmt(row.total_qty_diterima)}</TableCell>
                <TableCell className="text-sm">{fmtDate(row.created_at)}</TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>
    </div>
  );
}

// ─── Tab: Retur / Rusak / Hilang ──────────────────────────────────────────────

function TabReturns({ filters }: { filters: Filters }) {
  const qs = buildQS(filters);
  const { data: returns, isLoading: lR, refetch: rR } = useQuery<any[]>({ queryKey: ["rpt-inv-returns", qs], queryFn: () => fetchJSON(`${API}/inv/returns?${qs}`) });
  const { data: damage, isLoading: lD, refetch: rD } = useQuery<any[]>({ queryKey: ["rpt-inv-damage", qs], queryFn: () => fetchJSON(`${API}/inv/damage?${qs}`) });

  return (
    <div className="space-y-6">
      {/* Retur */}
      <div>
        <div className="flex items-center justify-between mb-2">
          <h3 className="font-semibold flex items-center gap-1.5"><RotateCcw size={16} />Retur Barang</h3>
          <div className="flex gap-2">
            <Button size="sm" variant="outline" onClick={() => rR()}><RefreshCw size={14} className="mr-1" />Refresh</Button>
            <Button size="sm" variant="outline" onClick={() => exportCSV("retur_barang", returns ?? [])}><FileDown size={14} className="mr-1" />Ekspor</Button>
          </div>
        </div>
        <div className="rounded-md border overflow-auto max-h-[35vh]">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>No. Retur</TableHead>
                <TableHead>Tipe</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Gudang</TableHead>
                <TableHead>Cabang</TableHead>
                <TableHead className="text-right">Item</TableHead>
                <TableHead className="text-right">Total Qty</TableHead>
                <TableHead className="text-right">Layak</TableHead>
                <TableHead className="text-right">Tidak Layak</TableHead>
                <TableHead>Tanggal</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {lR ? (
                <TableRow><TableCell colSpan={10} className="text-center py-6 text-muted-foreground">Memuat...</TableCell></TableRow>
              ) : !returns?.length ? (
                <TableRow><TableCell colSpan={10} className="text-center py-6 text-muted-foreground">Tidak ada retur</TableCell></TableRow>
              ) : returns.map((row, i) => (
                <TableRow key={i}>
                  <TableCell className="font-mono text-sm">{row.return_number}</TableCell>
                  <TableCell><Badge variant="outline">{row.type}</Badge></TableCell>
                  <TableCell><Badge variant={row.status === "confirmed" ? "default" : "secondary"}>{row.status}</Badge></TableCell>
                  <TableCell className="text-sm">{row.warehouse_name}</TableCell>
                  <TableCell className="text-sm">{row.branch_name || "-"}</TableCell>
                  <TableCell className="text-right">{fmt(row.jumlah_item)}</TableCell>
                  <TableCell className="text-right">{fmt(row.total_qty)}</TableCell>
                  <TableCell className="text-right text-emerald-600">{fmt(row.qty_layak)}</TableCell>
                  <TableCell className="text-right text-destructive">{fmt(row.qty_tidak_layak)}</TableCell>
                  <TableCell className="text-sm">{fmtDate(row.created_at)}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      </div>

      {/* Rusak / Hilang */}
      <div>
        <div className="flex items-center justify-between mb-2">
          <h3 className="font-semibold flex items-center gap-1.5"><Flame size={16} />Laporan Rusak / Hilang</h3>
          <div className="flex gap-2">
            <Button size="sm" variant="outline" onClick={() => rD()}><RefreshCw size={14} className="mr-1" />Refresh</Button>
            <Button size="sm" variant="outline" onClick={() => exportCSV("rusak_hilang", damage ?? [])}><FileDown size={14} className="mr-1" />Ekspor</Button>
          </div>
        </div>
        <div className="rounded-md border overflow-auto max-h-[35vh]">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>No. Laporan</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Gudang</TableHead>
                <TableHead>Cabang</TableHead>
                <TableHead className="text-right">Item</TableHead>
                <TableHead className="text-right">Total Qty</TableHead>
                <TableHead className="text-right">Rusak</TableHead>
                <TableHead className="text-right">Hilang</TableHead>
                <TableHead className="text-right">Expired</TableHead>
                <TableHead>Tanggal</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {lD ? (
                <TableRow><TableCell colSpan={10} className="text-center py-6 text-muted-foreground">Memuat...</TableCell></TableRow>
              ) : !damage?.length ? (
                <TableRow><TableCell colSpan={10} className="text-center py-6 text-muted-foreground">Tidak ada laporan</TableCell></TableRow>
              ) : damage.map((row, i) => (
                <TableRow key={i}>
                  <TableCell className="font-mono text-sm">{row.report_number}</TableCell>
                  <TableCell><Badge variant={row.status === "confirmed" ? "destructive" : "secondary"}>{row.status}</Badge></TableCell>
                  <TableCell className="text-sm">{row.warehouse_name}</TableCell>
                  <TableCell className="text-sm">{row.branch_name || "-"}</TableCell>
                  <TableCell className="text-right">{fmt(row.jumlah_item)}</TableCell>
                  <TableCell className="text-right">{fmt(row.total_qty)}</TableCell>
                  <TableCell className="text-right text-amber-600">{fmt(row.qty_rusak)}</TableCell>
                  <TableCell className="text-right text-destructive">{fmt(row.qty_hilang)}</TableCell>
                  <TableCell className="text-right text-muted-foreground">{fmt(row.qty_expired)}</TableCell>
                  <TableCell className="text-sm">{fmtDate(row.created_at)}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      </div>
    </div>
  );
}

// ─── Halaman Utama ────────────────────────────────────────────────────────────

const TABS = [
  { value: "daily",     label: "Penjualan Harian",  icon: CalendarRange,  group: "pos" },
  { value: "branch",    label: "Per Cabang",         icon: Store,          group: "pos" },
  { value: "cashier",   label: "Per Kasir",          icon: Users,          group: "pos" },
  { value: "products",  label: "Produk Terlaris",    icon: TrendingUp,     group: "pos" },
  { value: "stock",     label: "Stok Produk",        icon: Package,        group: "inv" },
  { value: "stocklow",  label: "Stok Minimum",       icon: AlertTriangle,  group: "inv" },
  { value: "movements", label: "Mutasi Stok",        icon: BarChart2,      group: "inv" },
  { value: "transfers", label: "Transfer Stok",      icon: ArrowLeftRight, group: "inv" },
  { value: "returns",   label: "Retur / Rusak",      icon: RotateCcw,      group: "inv" },
];

export default function ReportsMainPage() {
  const [tab, setTab] = useState("daily");
  const [filters, setFilters] = useState<Filters>(defaultFilters);

  const isInvTab = ["stock", "stocklow", "movements", "transfers", "returns"].includes(tab);
  const isPosTab = ["daily", "branch", "cashier", "products"].includes(tab);

  return (
    <div className="flex flex-col gap-4 p-4 md:p-6 max-w-full">
      {/* Header */}
      <div className="flex items-center gap-3">
        <BarChart2 className="h-7 w-7 text-primary" />
        <div>
          <h1 className="text-2xl font-bold">Laporan Operasional</h1>
          <p className="text-muted-foreground text-sm">Penjualan POS, stok, mutasi, transfer, dan retur</p>
        </div>
      </div>

      {/* Tabs */}
      <Tabs value={tab} onValueChange={setTab}>
        <div className="overflow-x-auto pb-1">
          <TabsList className="flex h-auto gap-1 flex-wrap bg-muted/60 p-1 w-full">
            <span className="text-xs text-muted-foreground px-2 py-1 flex items-center gap-1 font-semibold">
              <ShoppingBag size={12} />POS
            </span>
            {TABS.filter((t) => t.group === "pos").map((t) => (
              <TabsTrigger key={t.value} value={t.value} className="flex items-center gap-1.5 h-8 text-xs px-3">
                <t.icon size={13} />{t.label}
              </TabsTrigger>
            ))}
            <div className="w-px bg-border h-6 self-center mx-1" />
            <span className="text-xs text-muted-foreground px-2 py-1 flex items-center gap-1 font-semibold">
              <Warehouse size={12} />Inventory
            </span>
            {TABS.filter((t) => t.group === "inv").map((t) => (
              <TabsTrigger key={t.value} value={t.value} className="flex items-center gap-1.5 h-8 text-xs px-3">
                <t.icon size={13} />{t.label}
              </TabsTrigger>
            ))}
          </TabsList>
        </div>

        {/* Filter Panel */}
        <div className="mt-3">
          <FilterPanel
            filters={filters}
            setFilters={setFilters}
            showCashier={isPosTab}
            showWarehouse={isInvTab}
            showProduct={tab === "products"}
            showThreshold={tab === "stocklow"}
          />
        </div>

        <TabsContent value="daily" className="mt-0">
          <TabSalesDaily filters={filters} />
        </TabsContent>
        <TabsContent value="branch" className="mt-0">
          <TabSalesBranch filters={filters} />
        </TabsContent>
        <TabsContent value="cashier" className="mt-0">
          <TabSalesCashier filters={filters} />
        </TabsContent>
        <TabsContent value="products" className="mt-0">
          <TabTopProducts filters={filters} />
        </TabsContent>
        <TabsContent value="stock" className="mt-0">
          <TabStock filters={filters} />
        </TabsContent>
        <TabsContent value="stocklow" className="mt-0">
          <TabStockLow filters={filters} />
        </TabsContent>
        <TabsContent value="movements" className="mt-0">
          <TabMovements filters={filters} />
        </TabsContent>
        <TabsContent value="transfers" className="mt-0">
          <TabTransfers filters={filters} />
        </TabsContent>
        <TabsContent value="returns" className="mt-0">
          <TabReturns filters={filters} />
        </TabsContent>
      </Tabs>
    </div>
  );
}
