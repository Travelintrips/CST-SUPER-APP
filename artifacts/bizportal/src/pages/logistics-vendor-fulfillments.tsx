import { DatePicker } from "@/components/ui/date-picker";
import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { AppShell } from "@/components/layout/AppShell";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { RefreshCw, PackageCheck, Clock, CheckCircle2, XCircle, Loader2, ExternalLink, ArrowLeft } from "lucide-react";
import { Link } from "wouter";

interface VendorFulfillmentRow {
  id: number;
  orderId: number;
  orderItemId: number;
  orderNumber: string;
  vendorId: number;
  vendorName: string;
  serviceType: string;
  itemServiceName: string;
  status: string;
  adminNotes: string | null;
  customerName: string;
  companyName: string;
  subtotal: number;
  createdAt: string;
}

interface VendorFulfillmentsResponse {
  data: VendorFulfillmentRow[];
  stats: { pending: number; in_progress: number; completed: number; cancelled: number };
}

const STATUS_COLORS: Record<string, string> = {
  pending:     "bg-yellow-100 text-yellow-800 border-yellow-200",
  in_progress: "bg-orange-100 text-orange-800 border-orange-200",
  completed:   "bg-green-100 text-green-800 border-green-200",
  cancelled:   "bg-red-100 text-red-800 border-red-200",
};

const STATUS_LABELS: Record<string, string> = {
  pending:     "Pending",
  in_progress: "In Progress",
  completed:   "Selesai",
  cancelled:   "Dibatalkan",
};

const idr = (n: number) =>
  new Intl.NumberFormat("id-ID", { style: "currency", currency: "IDR", maximumFractionDigits: 0 }).format(n);

const fmt = (iso: string) => {
  if (!iso) return "—";
  return new Date(iso).toLocaleString("id-ID", { dateStyle: "short", timeStyle: "short" });
};

export default function LogisticsVendorFulfillmentsPage() {
  const [statusFilter, setStatusFilter] = useState("all");
  const [serviceTypeFilter, setServiceTypeFilter] = useState("all");
  const [search, setSearch] = useState("");
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");

  const buildQs = () => {
    const params = new URLSearchParams();
    if (statusFilter !== "all") params.set("status", statusFilter);
    if (serviceTypeFilter !== "all") params.set("serviceType", serviceTypeFilter);
    if (search.trim()) params.set("search", search.trim());
    if (dateFrom) params.set("dateFrom", dateFrom);
    if (dateTo) params.set("dateTo", dateTo);
    return params.toString();
  };

  const { data, isLoading, refetch, isFetching } = useQuery<VendorFulfillmentsResponse>({
    queryKey: ["vendor-fulfillments", statusFilter, serviceTypeFilter, search, dateFrom, dateTo],
    queryFn: async () => {
      const qs = buildQs();
      const res = await fetch(`/api/logistic/orders/vendor-fulfillments${qs ? `?${qs}` : ""}`);
      if (!res.ok) throw new Error("Gagal mengambil data");
      return res.json();
    },
    staleTime: 30_000,
  });

  const rows = data?.data ?? [];
  const stats = data?.stats ?? { pending: 0, in_progress: 0, completed: 0, cancelled: 0 };

  return (
    <AppShell>
      <div className="p-6 space-y-6">
        <Button variant="ghost" size="sm" className="-ml-2" onClick={() => window.history.back()}>
          <ArrowLeft className="h-4 w-4 mr-1" />Kembali
        </Button>
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-bold text-gray-900">Vendor Fulfillment</h1>
            <p className="text-sm text-gray-500 mt-1">Manajemen fulfillment vendor per item order</p>
          </div>
          <Button variant="outline" size="sm" onClick={() => refetch()} disabled={isFetching}>
            <RefreshCw className={`h-4 w-4 mr-2 ${isFetching ? "animate-spin" : ""}`} />
            Refresh
          </Button>
        </div>

        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          <Card className="cursor-pointer hover:border-yellow-400 transition-colors" onClick={() => setStatusFilter("pending")}>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm font-medium text-gray-500 flex items-center gap-2">
                <Clock className="h-4 w-4 text-yellow-500" />
                Pending
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="text-3xl font-bold text-yellow-600">{stats.pending}</div>
            </CardContent>
          </Card>

          <Card className="cursor-pointer hover:border-orange-400 transition-colors" onClick={() => setStatusFilter("in_progress")}>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm font-medium text-gray-500 flex items-center gap-2">
                <Loader2 className="h-4 w-4 text-orange-500" />
                In Progress
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="text-3xl font-bold text-orange-600">{stats.in_progress}</div>
            </CardContent>
          </Card>

          <Card className="cursor-pointer hover:border-green-400 transition-colors" onClick={() => setStatusFilter("completed")}>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm font-medium text-gray-500 flex items-center gap-2">
                <CheckCircle2 className="h-4 w-4 text-green-500" />
                Selesai
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="text-3xl font-bold text-green-600">{stats.completed}</div>
            </CardContent>
          </Card>

          <Card className="cursor-pointer hover:border-red-400 transition-colors" onClick={() => setStatusFilter("cancelled")}>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm font-medium text-gray-500 flex items-center gap-2">
                <XCircle className="h-4 w-4 text-red-500" />
                Dibatalkan
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="text-3xl font-bold text-red-600">{stats.cancelled}</div>
            </CardContent>
          </Card>
        </div>

        <Card>
          <CardContent className="pt-4 pb-2">
            <div className="flex flex-wrap gap-3 items-end">
              <div className="flex-1 min-w-[200px]">
                <Label className="text-xs text-gray-500 mb-1 block">Cari (No. Order / Pelanggan / Vendor)</Label>
                <Input
                  placeholder="Cari..."
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  className="h-8 text-sm"
                />
              </div>

              <div>
                <Label className="text-xs text-gray-500 mb-1 block">Status</Label>
                <Select value={statusFilter} onValueChange={setStatusFilter}>
                  <SelectTrigger className="h-8 text-sm w-36">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">Semua Status</SelectItem>
                    <SelectItem value="pending">Pending</SelectItem>
                    <SelectItem value="in_progress">In Progress</SelectItem>
                    <SelectItem value="completed">Selesai</SelectItem>
                    <SelectItem value="cancelled">Dibatalkan</SelectItem>
                  </SelectContent>
                </Select>
              </div>

              <div>
                <Label className="text-xs text-gray-500 mb-1 block">Tipe Layanan</Label>
                <Select value={serviceTypeFilter} onValueChange={setServiceTypeFilter}>
                  <SelectTrigger className="h-8 text-sm w-44">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">Semua Layanan</SelectItem>
                    <SelectItem value="Sea Freight">Sea Freight</SelectItem>
                    <SelectItem value="Air Freight">Air Freight</SelectItem>
                    <SelectItem value="Trucking">Trucking</SelectItem>
                    <SelectItem value="Customs Clearance">Customs Clearance</SelectItem>
                    <SelectItem value="Warehousing">Warehousing</SelectItem>
                  </SelectContent>
                </Select>
              </div>

              <div>
                <Label className="text-xs text-gray-500 mb-1 block">Dari</Label>
                <DatePicker value={dateFrom} onChange={(v) => setDateFrom(v)} className="h-8 text-sm w-36" />
              </div>

              <div>
                <Label className="text-xs text-gray-500 mb-1 block">Sampai</Label>
                <DatePicker value={dateTo} onChange={(v) => setDateTo(v)} className="h-8 text-sm w-36" />
              </div>

              {(statusFilter !== "all" || serviceTypeFilter !== "all" || search || dateFrom || dateTo) && (
                <Button
                  variant="ghost"
                  size="sm"
                  className="h-8"
                  onClick={() => {
                    setStatusFilter("all");
                    setServiceTypeFilter("all");
                    setSearch("");
                    setDateFrom("");
                    setDateTo("");
                  }}
                >
                  Reset Filter
                </Button>
              )}
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardContent className="p-0">
            {isLoading ? (
              <div className="flex items-center justify-center py-16 text-gray-400">
                <Loader2 className="h-6 w-6 animate-spin mr-2" />
                Memuat data...
              </div>
            ) : rows.length === 0 ? (
              <div className="flex flex-col items-center justify-center py-16 text-gray-400 gap-2">
                <PackageCheck className="h-10 w-10 opacity-30" />
                <p className="text-sm">Tidak ada data vendor fulfillment</p>
              </div>
            ) : (
              <Table>
                <TableHeader>
                  <TableRow className="bg-gray-50">
                    <TableHead className="text-xs font-semibold text-gray-600">No. Order</TableHead>
                    <TableHead className="text-xs font-semibold text-gray-600">Pelanggan</TableHead>
                    <TableHead className="text-xs font-semibold text-gray-600">Vendor</TableHead>
                    <TableHead className="text-xs font-semibold text-gray-600">Tipe Layanan</TableHead>
                    <TableHead className="text-xs font-semibold text-gray-600">Nama Layanan</TableHead>
                    <TableHead className="text-xs font-semibold text-gray-600 text-right">Subtotal</TableHead>
                    <TableHead className="text-xs font-semibold text-gray-600">Status</TableHead>
                    <TableHead className="text-xs font-semibold text-gray-600">Dibuat</TableHead>
                    <TableHead className="text-xs font-semibold text-gray-600"></TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {rows.map((row) => (
                    <TableRow key={row.id} className="hover:bg-gray-50">
                      <TableCell className="font-mono text-xs font-medium text-blue-700">
                        <Link href={`/logistics/portal-orders/${row.orderId}`}>
                          <span className="hover:underline cursor-pointer">{row.orderNumber || `#${row.orderId}`}</span>
                        </Link>
                      </TableCell>
                      <TableCell className="text-sm">
                        <div className="font-medium">{row.customerName || "—"}</div>
                        {row.companyName && <div className="text-xs text-gray-500">{row.companyName}</div>}
                      </TableCell>
                      <TableCell className="text-sm font-medium">{row.vendorName}</TableCell>
                      <TableCell className="text-xs">
                        <span className="bg-blue-50 text-blue-700 px-2 py-0.5 rounded-full border border-blue-100">
                          {row.serviceType}
                        </span>
                      </TableCell>
                      <TableCell className="text-xs text-gray-600 max-w-[180px] truncate" title={row.itemServiceName}>
                        {row.itemServiceName}
                      </TableCell>
                      <TableCell className="text-right text-sm font-medium tabular-nums">
                        {row.subtotal > 0 ? idr(row.subtotal) : "—"}
                      </TableCell>
                      <TableCell>
                        <Badge className={`text-xs border ${STATUS_COLORS[row.status] ?? "bg-gray-100 text-gray-700 border-gray-200"}`}>
                          {STATUS_LABELS[row.status] ?? row.status}
                        </Badge>
                      </TableCell>
                      <TableCell className="text-xs text-gray-500 whitespace-nowrap">{fmt(row.createdAt)}</TableCell>
                      <TableCell>
                        <Link href={`/logistics/vendor-fulfillments/${row.id}`}>
                          <Button variant="ghost" size="icon" className="h-7 w-7" title="Lihat detail">
                            <ExternalLink className="h-3.5 w-3.5 text-gray-400" />
                          </Button>
                        </Link>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            )}
          </CardContent>
          {rows.length > 0 && (
            <div className="px-4 py-2 border-t text-xs text-gray-400">
              {rows.length} fulfillment ditampilkan
            </div>
          )}
        </Card>
      </div>
    </AppShell>
  );
}
