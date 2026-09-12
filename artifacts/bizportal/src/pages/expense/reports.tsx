import { DatePicker } from "@/components/ui/date-picker";
import { useState, useMemo } from "react";
import { useGetExpenseSummary } from "@workspace/api-client-react";
import { AppShell } from "@/components/layout/AppShell";
import { QueryState } from "@/components/ui/query-state";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import {
  ChartContainer,
  ChartTooltip,
  ChartTooltipContent,
  type ChartConfig,
} from "@/components/ui/chart";
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  LineChart,
  Line,
  PieChart,
  Pie,
  Cell,
  Legend,
  Tooltip,
} from "recharts";
import { Download, TrendingUp, Receipt, Users, BarChart2, Printer } from "lucide-react";
import { Link, useLocation } from "wouter";
import { ArrowLeft } from "lucide-react";

const idr = (n: number) =>
  new Intl.NumberFormat("id-ID", {
    style: "currency",
    currency: "IDR",
    maximumFractionDigits: 0,
  }).format(n);

const idrShort = (n: number) => {
  if (n >= 1_000_000_000) return `${(n / 1_000_000_000).toFixed(1)}M`;
  if (n >= 1_000_000) return `Rp ${(n / 1_000_000).toFixed(0)}jt`;
  if (n >= 1_000) return `Rp ${(n / 1_000).toFixed(0)}rb`;
  return `Rp ${n}`;
};

const BAR_COLORS = [
  "hsl(var(--chart-1))",
  "hsl(var(--chart-2))",
  "hsl(var(--chart-3))",
  "hsl(var(--chart-4))",
  "hsl(var(--chart-5))",
];

const barChartConfig: ChartConfig = {
  total: { label: "Total", color: "hsl(var(--chart-1))" },
};
const lineChartConfig: ChartConfig = {
  total: { label: "Total", color: "hsl(var(--chart-2))" },
};

function thisYearFrom() {
  return `${new Date().getFullYear()}-01-01`;
}
function today() {
  return new Date().toISOString().slice(0, 10);
}

export default function ExpenseReportsPage() {
  const [from, setFrom] = useState(thisYearFrom());
  const [to, setTo] = useState(today());
  const [status, setStatus] = useState("all");
  const [, navigate] = useLocation();

  const params = {
    from,
    to,
    ...(status !== "all" ? { status } : {}),
  };

  const { data, isLoading } = useGetExpenseSummary(params);

  const categoryData = useMemo(
    () =>
      (data?.byCategory ?? []).map((c, i) => ({
        name:
          c.categoryName.length > 18
            ? c.categoryName.slice(0, 16) + "…"
            : c.categoryName,
        fullName: c.categoryName,
        categoryId: c.categoryId ?? null,
        total: c.total,
        count: c.count,
        fill: BAR_COLORS[i % BAR_COLORS.length],
      })),
    [data],
  );

  function navigateToCategoryDrill(categoryId: number | null) {
    const params = new URLSearchParams({ from, to });
    if (categoryId != null) params.set("categoryId", String(categoryId));
    navigate(`/expense?${params.toString()}`);
  }

  function navigateToVendorDrill(vendor: string) {
    const params = new URLSearchParams({ from, to, search: vendor });
    navigate(`/expense?${params.toString()}`);
  }

  const monthData = useMemo(
    () =>
      (data?.byMonth ?? []).map((m) => ({
        month: m.month,
        label: m.month.slice(5) + "/" + m.month.slice(2, 4),
        total: m.total,
        count: m.count,
      })),
    [data],
  );

  const avg =
    data && data.totalCount > 0 ? data.grandTotal / data.totalCount : 0;

  const handleExportCsv = () => {
    if (!data) return;
    const rows: string[][] = [];
    rows.push(["Laporan Expense", "", ""]);
    rows.push([`Periode: ${from} s/d ${to}`, "", ""]);
    rows.push([]);
    rows.push(["=== RINGKASAN ==="]);
    rows.push(["Total Expense", idr(data.grandTotal)]);
    rows.push(["Jumlah Transaksi", String(data.totalCount)]);
    rows.push(["Rata-rata per Transaksi", idr(avg)]);
    rows.push([]);
    rows.push(["=== PER KATEGORI ==="]);
    rows.push(["Kategori", "Total (IDR)", "Jumlah"]);
    for (const c of data.byCategory) {
      rows.push([c.categoryName, String(c.total), String(c.count)]);
    }
    rows.push([]);
    rows.push(["=== TREN PER BULAN ==="]);
    rows.push(["Bulan", "Total (IDR)", "Jumlah"]);
    for (const m of data.byMonth) {
      rows.push([m.month, String(m.total), String(m.count)]);
    }
    rows.push([]);
    rows.push(["=== TOP VENDOR ==="]);
    rows.push(["Vendor / Karyawan", "Total (IDR)", "Jumlah"]);
    for (const v of data.topVendors) {
      rows.push([v.vendor, String(v.total), String(v.count)]);
    }

    const csvContent = rows
      .map((r) => r.map((c) => `"${String(c).replace(/"/g, '""')}"`).join(","))
      .join("\n");
    const blob = new Blob([csvContent], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `laporan-expense-${from}-${to}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <AppShell>
      <div className="p-6 space-y-6 max-w-6xl mx-auto">
        {/* Header */}
        <div className="flex items-center gap-3">
          <Link href="/expense">
            <Button variant="ghost" size="icon">
              <ArrowLeft size={18} />
            </Button>
          </Link>
          <div className="flex-1">
            <h1 className="text-xl font-bold">Laporan Expense</h1>
            <p className="text-sm text-muted-foreground">
              Ringkasan pengeluaran operasional per kategori, vendor, dan waktu
            </p>
          </div>
          <Button variant="outline" size="sm" onClick={() => window.print()}>
            <Printer size={14} className="mr-1.5" />
            Cetak
          </Button>
          <Button variant="outline" size="sm" onClick={handleExportCsv} disabled={!data}>
            <Download size={14} className="mr-1.5" />
            Export CSV
          </Button>
        </div>

        {/* Filters */}
        <Card>
          <CardContent className="pt-4">
            <div className="flex flex-wrap gap-4 items-end">
              <div className="space-y-1">
                <Label className="text-xs">Dari</Label>
                <DatePicker value={from} onChange={(v) => setFrom(v)} className="w-40" />
              </div>
              <div className="space-y-1">
                <Label className="text-xs">Sampai</Label>
                <DatePicker value={to} onChange={(v) => setTo(v)} className="w-40" />
              </div>
              <div className="space-y-1">
                <Label className="text-xs">Status</Label>
                <Select value={status} onValueChange={setStatus}>
                  <SelectTrigger className="w-40">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">Semua Status</SelectItem>
                    <SelectItem value="draft">Draft</SelectItem>
                    <SelectItem value="submitted">Diajukan</SelectItem>
                    <SelectItem value="approved">Disetujui</SelectItem>
                    <SelectItem value="posted">Diposting</SelectItem>
                    <SelectItem value="paid">Lunas</SelectItem>
                    <SelectItem value="rejected">Ditolak</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="text-xs text-muted-foreground self-center pt-4">
                {isLoading ? "Memuat..." : data ? `${data.totalCount} transaksi ditemukan` : ""}
              </div>
            </div>
          </CardContent>
        </Card>

        {/* Summary stats */}
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
          <Card>
            <CardContent className="pt-5">
              <div className="flex items-center gap-3">
                <div className="flex h-10 w-10 items-center justify-center rounded-full bg-primary/10">
                  <Receipt size={18} className="text-primary" />
                </div>
                <div>
                  <p className="text-xs text-muted-foreground">Total Expense</p>
                  <p className="text-lg font-bold tabular-nums">
                    {isLoading ? "—" : idr(data?.grandTotal ?? 0)}
                  </p>
                </div>
              </div>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="pt-5">
              <div className="flex items-center gap-3">
                <div className="flex h-10 w-10 items-center justify-center rounded-full bg-blue-500/10">
                  <BarChart2 size={18} className="text-blue-400" />
                </div>
                <div>
                  <p className="text-xs text-muted-foreground">Jumlah Transaksi</p>
                  <p className="text-lg font-bold tabular-nums">
                    {isLoading ? "—" : (data?.totalCount ?? 0).toLocaleString("id-ID")}
                  </p>
                </div>
              </div>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="pt-5">
              <div className="flex items-center gap-3">
                <div className="flex h-10 w-10 items-center justify-center rounded-full bg-emerald-500/10">
                  <TrendingUp size={18} className="text-emerald-400" />
                </div>
                <div>
                  <p className="text-xs text-muted-foreground">Rata-rata per Transaksi</p>
                  <p className="text-lg font-bold tabular-nums">
                    {isLoading ? "—" : idr(avg)}
                  </p>
                </div>
              </div>
            </CardContent>
          </Card>
        </div>

        {/* Category charts row: bar + pie side by side */}
        <div className="grid grid-cols-1 gap-5 lg:grid-cols-2">
          {/* By category bar chart */}
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm">Pengeluaran per Kategori (Bar)</CardTitle>
            </CardHeader>
            <CardContent>
              <QueryState loading={isLoading} empty={!isLoading && categoryData.length === 0} emptyMessage="Tidak ada data">
                <ChartContainer config={barChartConfig} className="h-64 w-full">
                  <BarChart
                    data={categoryData}
                    layout="vertical"
                    margin={{ top: 0, right: 12, left: 4, bottom: 0 }}
                    style={{ cursor: "pointer" }}
                    onClick={(d) => {
                      const entry = d?.activePayload?.[0]?.payload;
                      if (entry) navigateToCategoryDrill(entry.categoryId);
                    }}
                  >
                    <CartesianGrid horizontal={false} strokeDasharray="3 3" />
                    <XAxis
                      type="number"
                      tickFormatter={idrShort}
                      tick={{ fontSize: 10 }}
                      width={60}
                    />
                    <YAxis
                      type="category"
                      dataKey="name"
                      tick={{ fontSize: 10 }}
                      width={90}
                    />
                    <ChartTooltip
                      content={
                        <ChartTooltipContent
                          formatter={(v) => idr(Number(v))}
                          labelFormatter={(_, payload) =>
                            payload?.[0]?.payload?.fullName ?? ""
                          }
                        />
                      }
                    />
                    <Bar dataKey="total" fill="hsl(var(--chart-1))" radius={[0, 4, 4, 0]} cursor="pointer" />
                  </BarChart>
                </ChartContainer>
              </QueryState>
            </CardContent>
          </Card>

          {/* By category pie chart */}
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm">Komposisi per Kategori (Pie)</CardTitle>
            </CardHeader>
            <CardContent>
              <QueryState loading={isLoading} empty={!isLoading && categoryData.length === 0} emptyMessage="Tidak ada data">
                <div className="h-64 w-full">
                  <PieChart width={300} height={256} style={{ margin: "0 auto" }}>
                    <Pie
                      data={categoryData}
                      dataKey="total"
                      nameKey="fullName"
                      cx="50%"
                      cy="45%"
                      outerRadius={90}
                      innerRadius={40}
                    >
                      {categoryData.map((entry, i) => (
                        <Cell key={entry.fullName} fill={BAR_COLORS[i % BAR_COLORS.length]} />
                      ))}
                    </Pie>
                    <Tooltip
                      formatter={(v: number) => [idr(v), "Total"]}
                    />
                    <Legend
                      iconType="circle"
                      iconSize={8}
                      formatter={(value) =>
                        value.length > 16 ? value.slice(0, 14) + "…" : value
                      }
                      wrapperStyle={{ fontSize: "10px" }}
                    />
                  </PieChart>
                </div>
              </QueryState>
            </CardContent>
          </Card>
        </div>

        {/* Monthly trend line chart — full width */}
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm">Tren Pengeluaran per Bulan</CardTitle>
          </CardHeader>
          <CardContent>
            <QueryState loading={isLoading} empty={!isLoading && monthData.length === 0} emptyMessage="Tidak ada data">
              <ChartContainer config={lineChartConfig} className="h-56 w-full">
                <LineChart
                  data={monthData}
                  margin={{ top: 4, right: 16, left: 4, bottom: 0 }}
                >
                  <CartesianGrid strokeDasharray="3 3" />
                  <XAxis
                    dataKey="label"
                    tick={{ fontSize: 10 }}
                  />
                  <YAxis
                    tickFormatter={idrShort}
                    tick={{ fontSize: 10 }}
                    width={60}
                  />
                  <ChartTooltip
                    content={
                      <ChartTooltipContent
                        formatter={(v) => idr(Number(v))}
                        labelFormatter={(_, payload) =>
                          payload?.[0]?.payload?.month ?? ""
                        }
                      />
                    }
                  />
                  <Line
                    type="monotone"
                    dataKey="total"
                    stroke="hsl(var(--chart-2))"
                    strokeWidth={2}
                    dot={{ r: 3 }}
                  />
                </LineChart>
              </ChartContainer>
            </QueryState>
          </CardContent>
        </Card>

        {/* Top vendors table */}
        <Card>
          <CardHeader className="pb-2">
            <div className="flex items-center gap-2">
              <Users size={14} className="text-muted-foreground" />
              <CardTitle className="text-sm">Top Vendor / Karyawan</CardTitle>
            </div>
          </CardHeader>
          <CardContent>
            <QueryState loading={isLoading} empty={!isLoading && (data?.topVendors ?? []).length === 0} emptyMessage="Tidak ada data">
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b text-left text-xs text-muted-foreground">
                      <th className="pb-2 pr-4 font-medium">#</th>
                      <th className="pb-2 pr-4 font-medium">Vendor / Karyawan</th>
                      <th className="pb-2 pr-4 text-right font-medium">Total</th>
                      <th className="pb-2 pr-4 text-right font-medium">Transaksi</th>
                      <th className="pb-2 font-medium">% dari Total</th>
                    </tr>
                  </thead>
                  <tbody>
                    {(data?.topVendors ?? []).map((v, i) => {
                      const pct =
                        data!.grandTotal > 0
                          ? ((v.total / data!.grandTotal) * 100).toFixed(1)
                          : "0.0";
                      return (
                        <tr
                          key={v.vendor}
                          className="border-b last:border-0 hover:bg-muted/30 cursor-pointer"
                          onClick={() => navigateToVendorDrill(v.vendor)}
                          title={`Lihat expenses dari ${v.vendor}`}
                        >
                          <td className="py-2.5 pr-4 text-muted-foreground">{i + 1}</td>
                          <td className="py-2.5 pr-4 font-medium">{v.vendor}</td>
                          <td className="py-2.5 pr-4 text-right tabular-nums">{idr(v.total)}</td>
                          <td className="py-2.5 pr-4 text-right tabular-nums">
                            <Badge variant="secondary" className="font-mono text-xs">
                              {v.count}
                            </Badge>
                          </td>
                          <td className="py-2.5">
                            <div className="flex items-center gap-2">
                              <div className="h-1.5 w-24 rounded-full bg-muted overflow-hidden">
                                <div
                                  className="h-full rounded-full bg-primary"
                                  style={{ width: `${pct}%` }}
                                />
                              </div>
                              <span className="text-xs text-muted-foreground tabular-nums">
                                {pct}%
                              </span>
                            </div>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </QueryState>
          </CardContent>
        </Card>
      </div>
    </AppShell>
  );
}
