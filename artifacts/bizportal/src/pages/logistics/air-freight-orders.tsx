import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Link } from "wouter";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Plus, Search, RefreshCw, PlaneTakeoff } from "lucide-react";
import { CreateAirFreightOrderDialog } from "@/components/logistics/CreateAirFreightOrderDialog";

const STATUS_LABELS: Record<string, string> = {
  inquiry: "Inquiry",
  rfq_blasted: "RFQ Terkirim",
  rate_received: "Rate Diterima",
  quote_ready: "Quote Siap",
  quote_sent: "Quote Terkirim",
  booking_confirmed: "Booking Dikonfirmasi",
  in_transit: "In Transit",
  arrived: "Tiba",
  completed: "Selesai",
  cancelled: "Dibatalkan",
};

const STATUS_COLORS: Record<string, string> = {
  inquiry: "bg-slate-100 text-slate-700",
  rfq_blasted: "bg-blue-100 text-blue-700",
  rate_received: "bg-purple-100 text-purple-700",
  quote_ready: "bg-yellow-100 text-yellow-700",
  quote_sent: "bg-orange-100 text-orange-700",
  booking_confirmed: "bg-green-100 text-green-700",
  in_transit: "bg-cyan-100 text-cyan-700",
  arrived: "bg-teal-100 text-teal-700",
  completed: "bg-emerald-100 text-emerald-700",
  cancelled: "bg-red-100 text-red-700",
};

const CARGO_LABELS: Record<string, string> = {
  general: "General",
  dangerous: "Dangerous Goods",
  perishable: "Perishable",
  valuables: "Valuables",
  live_animals: "Live Animals",
};

const IDR = (v: string | number | null | undefined) =>
  v ? `Rp ${Number(v).toLocaleString("id-ID")}` : "-";

export default function AirFreightOrdersPage() {
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState("all");
  const [page, setPage] = useState(1);
  const [showCreate, setShowCreate] = useState(false);

  const params = new URLSearchParams({ page: String(page), limit: "20" });
  if (statusFilter !== "all") params.set("status", statusFilter);
  if (search) params.set("search", search);

  const { data, isLoading, refetch, isFetching } = useQuery({
    queryKey: ["air-freight-orders", page, statusFilter, search],
    queryFn: async () => {
      const r = await fetch(`/api/air-freight/orders?${params}`);
      if (!r.ok) throw new Error(await r.text());
      return r.json() as Promise<{ orders: any[]; total: number; page: number }>;
    },
    refetchInterval: 30000,
  });

  const orders = data?.orders ?? [];
  const total = data?.total ?? 0;
  const totalPages = Math.ceil(total / 20);

  return (
    <div className="p-6 space-y-6">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-sky-100 text-sky-600">
            <PlaneTakeoff className="h-5 w-5" />
          </div>
          <div>
            <h1 className="text-xl font-semibold text-slate-900">Air Freight Orders</h1>
            <p className="text-sm text-slate-500">{total} order</p>
          </div>
        </div>
        <div className="flex gap-2">
          <Button variant="outline" size="sm" onClick={() => refetch()} disabled={isFetching}>
            <RefreshCw className={`h-4 w-4 mr-1 ${isFetching ? "animate-spin" : ""}`} />
            Refresh
          </Button>
          <Button size="sm" onClick={() => setShowCreate(true)}>
            <Plus className="h-4 w-4 mr-1" />
            New Order
          </Button>
        </div>
      </div>

      {/* Filters */}
      <Card>
        <CardContent className="pt-4 pb-4">
          <div className="flex flex-wrap gap-3">
            <div className="relative flex-1 min-w-[200px]">
              <Search className="absolute left-3 top-2.5 h-4 w-4 text-slate-400" />
              <Input
                placeholder="Cari order, customer, airport..."
                className="pl-9"
                value={search}
                onChange={(e) => { setSearch(e.target.value); setPage(1); }}
              />
            </div>
            <Select value={statusFilter} onValueChange={(v) => { setStatusFilter(v); setPage(1); }}>
              <SelectTrigger className="w-[200px]">
                <SelectValue placeholder="Semua Status" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">Semua Status</SelectItem>
                {Object.entries(STATUS_LABELS).map(([k, v]) => (
                  <SelectItem key={k} value={k}>{v}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </CardContent>
      </Card>

      {/* Table */}
      <Card>
        <CardContent className="p-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>No. Order</TableHead>
                <TableHead>Customer</TableHead>
                <TableHead>Rute</TableHead>
                <TableHead>Cargo Type</TableHead>
                <TableHead className="text-right">Chargeable (kg)</TableHead>
                <TableHead className="text-right">Est. Harga</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Tanggal</TableHead>
                <TableHead />
              </TableRow>
            </TableHeader>
            <TableBody>
              {isLoading ? (
                <TableRow>
                  <TableCell colSpan={9} className="py-12 text-center text-slate-400">
                    Memuat data...
                  </TableCell>
                </TableRow>
              ) : orders.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={9} className="py-12 text-center text-slate-400">
                    Tidak ada order ditemukan
                  </TableCell>
                </TableRow>
              ) : (
                orders.map((o: any) => (
                  <TableRow key={o.id} className="hover:bg-slate-50">
                    <TableCell>
                      <span className="font-mono text-sm font-semibold text-slate-800">
                        {o.orderNumber}
                      </span>
                    </TableCell>
                    <TableCell>
                      <div className="text-sm font-medium text-slate-800">{o.customerName}</div>
                      {o.customerCompany && (
                        <div className="text-xs text-slate-500">{o.customerCompany}</div>
                      )}
                    </TableCell>
                    <TableCell>
                      <div className="flex items-center gap-1 text-sm">
                        <span className="font-semibold">{o.originAirport}</span>
                        <span className="text-slate-400">→</span>
                        <span className="font-semibold">{o.destAirport}</span>
                      </div>
                    </TableCell>
                    <TableCell>
                      <span className="text-sm">{CARGO_LABELS[o.cargoType] ?? o.cargoType}</span>
                    </TableCell>
                    <TableCell className="text-right text-sm">
                      {o.chargeableWeight ? `${parseFloat(o.chargeableWeight).toLocaleString("id-ID")} kg` : "-"}
                    </TableCell>
                    <TableCell className="text-right text-sm font-medium">
                      {IDR(o.estimatedPrice || o.grandTotal)}
                    </TableCell>
                    <TableCell>
                      <span className={`inline-flex rounded-full px-2 py-0.5 text-xs font-medium ${STATUS_COLORS[o.status] ?? "bg-slate-100 text-slate-700"}`}>
                        {STATUS_LABELS[o.status] ?? o.status}
                      </span>
                    </TableCell>
                    <TableCell className="text-sm text-slate-500">
                      {new Date(o.createdAt).toLocaleDateString("id-ID", { day: "2-digit", month: "short", year: "numeric" })}
                    </TableCell>
                    <TableCell>
                      <Link href={`/logistics/air-freight/${o.id}`}>
                        <Button variant="ghost" size="sm">Detail →</Button>
                      </Link>
                    </TableCell>
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      {/* Pagination */}
      {totalPages > 1 && (
        <div className="flex items-center justify-between text-sm text-slate-500">
          <span>Halaman {page} dari {totalPages} ({total} total)</span>
          <div className="flex gap-2">
            <Button variant="outline" size="sm" disabled={page === 1} onClick={() => setPage(p => p - 1)}>
              ← Prev
            </Button>
            <Button variant="outline" size="sm" disabled={page === totalPages} onClick={() => setPage(p => p + 1)}>
              Next →
            </Button>
          </div>
        </div>
      )}

      {showCreate && (
        <CreateAirFreightOrderDialog
          open={showCreate}
          onClose={() => setShowCreate(false)}
          onCreated={() => { setShowCreate(false); refetch(); }}
        />
      )}
    </div>
  );
}
