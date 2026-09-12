import { useState, useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { AppShell } from "@/components/layout/AppShell";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { DatePicker } from "@/components/ui/date-picker";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import { useCompany } from "@/contexts/CompanyContext";
import {
  ArrowLeft, Ship, Printer, Download,
  TrendingUp, TrendingDown, DollarSign, Percent, Truck, Receipt,
} from "lucide-react";
import { exportXlsx, printWindow } from "@/lib/export";
import { Link } from "wouter";

const idr = (n: number) =>
  new Intl.NumberFormat("id-ID", { style: "currency", currency: "IDR", minimumFractionDigits: 0, maximumFractionDigits: 0 }).format(n);

const pct = (n: number) => `${n.toFixed(1)}%`;

type FreightProfitItem = {
  soId: number; soNumber: string; soStatus: string;
  customerName: string; orderNumber: string;
  origin: string; destination: string;
  shipmentType: string; transportMode: string | null;
  vendorName: string | null;
  revenue: number; vendorCost: number; truckCost: number; tax: number;
  grossMargin: number; margin: number; marginPct: number;
  createdAt: string;
};

type FreightProfitResponse = {
  from: string | null; to: string | null;
  summary: {
    totalRevenue: number; totalVendorCost: number; totalTruckCost: number; totalTax: number;
    totalMargin: number; totalMarginPct: number; count: number;
  };
  items: FreightProfitItem[];
};

function marginBadge(p: number) {
  if (p >= 20) return <Badge className="bg-emerald-100 text-emerald-800 border-emerald-200">{p.toFixed(1)}%</Badge>;
  if (p >= 10) return <Badge className="bg-amber-100 text-amber-800 border-amber-200">{p.toFixed(1)}%</Badge>;
  if (p >= 0)  return <Badge className="bg-orange-100 text-orange-800 border-orange-200">{p.toFixed(1)}%</Badge>;
  return <Badge className="bg-red-100 text-red-800 border-red-200">{p.toFixed(1)}%</Badge>;
}

export default function FreightProfitabilityPage() {
  const { activeCompanyId, isConsolidated } = useCompany();
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");

  const params = useMemo(() => {
    const p: Record<string, string> = {};
    if (from) p.from = new Date(from).toISOString();
    if (to)   p.to   = new Date(to + "T23:59:59").toISOString();
    p.company = isConsolidated ? "all" : String(activeCompanyId ?? "");
    return p;
  }, [from, to, activeCompanyId, isConsolidated]);

  const { data, isLoading } = useQuery<FreightProfitResponse>({
    queryKey: ["freight-profitability", params],
    queryFn: async () => {
      const qs = new URLSearchParams(params).toString();
      const res = await fetch(`/api/accounting/reports/freight-profitability?${qs}`);
      if (!res.ok) throw new Error(await res.text());
      return res.json();
    },
  });

  const s = data?.summary;
  const items = data?.items ?? [];

  function buildExportRows() {
    return items.map((r) => {
      const gm = r.grossMargin ?? r.margin;
      return [
        r.soNumber, r.orderNumber, r.customerName,
        `${r.origin} → ${r.destination}`,
        r.shipmentType, r.vendorName ?? "-",
        r.revenue, r.vendorCost, r.truckCost ?? 0, r.tax ?? 0,
        gm, r.marginPct,
        new Date(r.createdAt).toLocaleDateString("id-ID"),
      ];
    });
  }

  const exportHeaders = [
    "No SO", "No Order", "Customer", "Rute", "Jenis", "Vendor",
    "Revenue (IDR)", "Biaya Vendor (IDR)", "Truck Cost (IDR)", "Tax (IDR)",
    "Gross Margin (IDR)", "Margin (%)", "Tanggal",
  ];

  return (
    <AppShell>
      <div className="space-y-6 p-6">
        {/* Header */}
        <div className="flex items-center justify-between">
          <div>
            <Link href="/accounting"><Button variant="ghost" size="icon" aria-label="Kembali"><ArrowLeft className="h-4 w-4" /></Button></Link>
            <h1 className="text-2xl font-bold flex items-center gap-2">
              <Ship className="h-6 w-6" />
              Profitabilitas Freight
            </h1>
            <p className="text-sm text-muted-foreground">
              Revenue − Vendor Cost − Truck Cost = Gross Margin per shipment VMF
            </p>
          </div>
          <div className="flex gap-2">
            <Button
              variant="outline" size="sm"
              onClick={() => printWindow("Profitabilitas Freight", exportHeaders, buildExportRows(), [6, 7, 8, 9, 10])}
              disabled={!data}
            >
              <Printer className="h-4 w-4 mr-1.5" />Print Preview
            </Button>
            <Button
              variant="outline" size="sm"
              onClick={() => exportXlsx("Profitabilitas_Freight", exportHeaders, buildExportRows())}
              disabled={!data}
            >
              <Download className="h-4 w-4 mr-1.5" />Export XLSX
            </Button>
          </div>
        </div>

        {/* Date filters */}
        <Card>
          <CardContent className="p-4 flex gap-4">
            <div className="flex-1">
              <Label>Dari</Label>
              <DatePicker value={from} onChange={setFrom} />
            </div>
            <div className="flex-1">
              <Label>Sampai</Label>
              <DatePicker value={to} onChange={setTo} />
            </div>
          </CardContent>
        </Card>

        {isLoading ? (
          <Card><CardContent className="p-4 text-muted-foreground">Memuat data...</CardContent></Card>
        ) : !data ? null : (
          <>
            {/* Summary cards — 6 metrics */}
            <div className="grid grid-cols-2 lg:grid-cols-3 xl:grid-cols-6 gap-3">
              <Card>
                <CardContent className="p-4">
                  <div className="flex items-center gap-2 text-xs text-muted-foreground mb-1">
                    <DollarSign className="h-3.5 w-3.5" />Revenue
                  </div>
                  <div className="text-lg font-bold text-emerald-700">{idr(s?.totalRevenue ?? 0)}</div>
                  <div className="text-xs text-muted-foreground mt-0.5">{s?.count ?? 0} shipment</div>
                </CardContent>
              </Card>
              <Card>
                <CardContent className="p-4">
                  <div className="flex items-center gap-2 text-xs text-muted-foreground mb-1">
                    <TrendingDown className="h-3.5 w-3.5" />Biaya Vendor
                  </div>
                  <div className="text-lg font-bold text-rose-700">{idr(s?.totalVendorCost ?? 0)}</div>
                  <div className="text-xs text-muted-foreground mt-0.5">Harga vendor approved</div>
                </CardContent>
              </Card>
              <Card>
                <CardContent className="p-4">
                  <div className="flex items-center gap-2 text-xs text-muted-foreground mb-1">
                    <Truck className="h-3.5 w-3.5" />Truck Cost
                  </div>
                  <div className="text-lg font-bold text-orange-700">{idr(s?.totalTruckCost ?? 0)}</div>
                  <div className="text-xs text-muted-foreground mt-0.5">Biaya truk per order</div>
                </CardContent>
              </Card>
              <Card>
                <CardContent className="p-4">
                  <div className="flex items-center gap-2 text-xs text-muted-foreground mb-1">
                    <Receipt className="h-3.5 w-3.5" />Tax
                  </div>
                  <div className="text-lg font-bold text-violet-700">{idr(s?.totalTax ?? 0)}</div>
                  <div className="text-xs text-muted-foreground mt-0.5">Pajak per order</div>
                </CardContent>
              </Card>
              <Card>
                <CardContent className="p-4">
                  <div className="flex items-center gap-2 text-xs text-muted-foreground mb-1">
                    <TrendingUp className="h-3.5 w-3.5" />Gross Margin
                  </div>
                  <div className={`text-lg font-bold ${(s?.totalMargin ?? 0) >= 0 ? "text-emerald-700" : "text-rose-700"}`}>
                    {idr(s?.totalMargin ?? 0)}
                  </div>
                  <div className="text-xs text-muted-foreground mt-0.5">Rev − Vendor − Truck</div>
                </CardContent>
              </Card>
              <Card>
                <CardContent className="p-4">
                  <div className="flex items-center gap-2 text-xs text-muted-foreground mb-1">
                    <Percent className="h-3.5 w-3.5" />Margin %
                  </div>
                  <div className={`text-lg font-bold ${(s?.totalMarginPct ?? 0) >= 10 ? "text-emerald-700" : "text-amber-700"}`}>
                    {pct(s?.totalMarginPct ?? 0)}
                  </div>
                  <div className="text-xs text-muted-foreground mt-0.5">Rata-rata tertimbang</div>
                </CardContent>
              </Card>
            </div>

            {/* Detail table */}
            <Card>
              <CardContent className="p-0">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>No SO</TableHead>
                      <TableHead>No Order</TableHead>
                      <TableHead>Customer</TableHead>
                      <TableHead>Rute</TableHead>
                      <TableHead>Vendor</TableHead>
                      <TableHead className="text-right">Revenue</TableHead>
                      <TableHead className="text-right">Biaya Vendor</TableHead>
                      <TableHead className="text-right">Truck Cost</TableHead>
                      <TableHead className="text-right">Tax</TableHead>
                      <TableHead className="text-right">Gross Margin</TableHead>
                      <TableHead className="text-center">Margin %</TableHead>
                      <TableHead>Tanggal</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {items.length === 0 ? (
                      <TableRow>
                        <TableCell colSpan={12} className="text-center text-muted-foreground py-8">
                          Tidak ada data. Pilih rentang tanggal atau pastikan ada SO dari VMF.
                        </TableCell>
                      </TableRow>
                    ) : items.map((row) => {
                      const gm = row.grossMargin ?? row.margin;
                      return (
                        <TableRow key={row.soId}>
                          <TableCell>
                            <Link href={`/sales/${row.soId}`} className="text-blue-600 hover:underline font-mono text-xs">
                              {row.soNumber}
                            </Link>
                          </TableCell>
                          <TableCell className="text-xs font-mono text-muted-foreground">{row.orderNumber}</TableCell>
                          <TableCell className="font-medium">{row.customerName}</TableCell>
                          <TableCell className="text-xs text-muted-foreground">
                            {row.origin} → {row.destination}
                            {row.transportMode && <span className="ml-1 text-[10px] bg-slate-100 px-1 rounded">{row.transportMode}</span>}
                          </TableCell>
                          <TableCell className="text-xs">{row.vendorName ?? <span className="text-muted-foreground">-</span>}</TableCell>
                          <TableCell className="text-right font-mono text-sm text-emerald-700">{idr(row.revenue)}</TableCell>
                          <TableCell className="text-right font-mono text-sm text-rose-700">{idr(row.vendorCost)}</TableCell>
                          <TableCell className="text-right font-mono text-sm">
                            {(row.truckCost ?? 0) > 0
                              ? <span className="text-orange-700">{idr(row.truckCost)}</span>
                              : <span className="text-muted-foreground text-xs">—</span>}
                          </TableCell>
                          <TableCell className="text-right font-mono text-sm">
                            {(row.tax ?? 0) > 0
                              ? <span className="text-violet-700">{idr(row.tax)}</span>
                              : <span className="text-muted-foreground text-xs">—</span>}
                          </TableCell>
                          <TableCell className={`text-right font-mono text-sm font-semibold ${gm >= 0 ? "text-emerald-700" : "text-rose-700"}`}>
                            {idr(gm)}
                          </TableCell>
                          <TableCell className="text-center">{marginBadge(row.marginPct)}</TableCell>
                          <TableCell className="text-xs text-muted-foreground">
                            {new Date(row.createdAt).toLocaleDateString("id-ID")}
                          </TableCell>
                        </TableRow>
                      );
                    })}
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
