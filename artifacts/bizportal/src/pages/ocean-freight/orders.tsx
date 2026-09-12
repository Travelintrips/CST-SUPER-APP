import { useState } from "react";
import { useLocation } from "wouter";
import { AppShell } from "@/components/layout/AppShell";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useCompany } from "@/contexts/CompanyContext";
import {
  Ship, Search, RefreshCw, ChevronLeft, ChevronRight, Eye, XCircle,
} from "lucide-react";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { MoreHorizontal, ArrowLeft } from "lucide-react";

const STATUS_LABEL: Record<string, string> = {
  draft:          "Draft",
  estimated:      "Estimasi",
  waiting_rate:   "Menunggu Rate",
  rate_requested: "Rate Diminta",
  rate_received:  "Rate Diterima",
  quoted:         "Quoted",
  approved:       "Disetujui",
  booked:         "Booked",
  sailed:         "Berlayar",
  arrived:        "Tiba",
  completed:      "Selesai",
  cancelled:      "Dibatalkan",
  quote_declined: "Penawaran Ditolak",
};

const STATUS_COLOR: Record<string, string> = {
  draft:          "bg-gray-800/40 text-gray-300 border-gray-600",
  estimated:      "bg-blue-900/40 text-blue-300 border-blue-600",
  waiting_rate:   "bg-yellow-900/40 text-yellow-300 border-yellow-600",
  rate_requested: "bg-orange-900/40 text-orange-300 border-orange-600",
  rate_received:  "bg-purple-900/40 text-purple-300 border-purple-600",
  quoted:         "bg-cyan-900/40 text-cyan-300 border-cyan-600",
  approved:       "bg-teal-900/40 text-teal-300 border-teal-600",
  booked:         "bg-emerald-900/40 text-emerald-300 border-emerald-600",
  sailed:         "bg-sky-900/40 text-sky-300 border-sky-600",
  arrived:        "bg-indigo-900/40 text-indigo-300 border-indigo-600",
  completed:      "bg-green-900/40 text-green-400 border-green-500",
  cancelled:      "bg-red-900/40 text-red-300 border-red-600",
  quote_declined: "bg-rose-900/40 text-rose-300 border-rose-600",
};

const idr = (n: number | null | undefined) =>
  n == null ? "-" : new Intl.NumberFormat("id-ID", { style: "currency", currency: "IDR", maximumFractionDigits: 0 }).format(n);

const fmtDate = (d: string | null | undefined) => {
  if (!d) return "-";
  try { return new Intl.DateTimeFormat("id-ID", { day: "2-digit", month: "short", year: "numeric" }).format(new Date(d)); }
  catch { return d; }
};

export default function OceanFreightOrdersPage() {
  const [, navigate] = useLocation();
  const { activeCompanyId } = useCompany();
  const qc = useQueryClient();

  const [search, setSearch]       = useState("");
  const [searchQ, setSearchQ]     = useState("");
  const [statusFilter, setStatus] = useState<string>("__all__");
  const [page, setPage]           = useState(1);
  const LIMIT = 50;

  const { data, isLoading, refetch } = useQuery({
    queryKey: ["ocean-freight-orders", activeCompanyId, searchQ, statusFilter, page],
    queryFn: async () => {
      const qs = new URLSearchParams({ page: String(page), limit: String(LIMIT) });
      if (activeCompanyId) qs.set("companyId", String(activeCompanyId));
      if (searchQ) qs.set("search", searchQ);
      if (statusFilter && statusFilter !== "__all__") qs.set("status", statusFilter);
      const r = await fetch(`/api/ocean-freight/orders?${qs}`, { credentials: "include" });
      if (!r.ok) throw new Error(await r.text());
      return r.json();
    },
  });

  const cancelMut = useMutation({
    mutationFn: async (id: number) => {
      const r = await fetch(`/api/ocean-freight/orders/${id}/status`, {
        method: "PUT", credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status: "cancelled" }),
      });
      if (!r.ok) throw new Error(await r.text());
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["ocean-freight-orders"] }),
  });

  const orders = data?.data ?? [];
  const total  = data?.total ?? 0;
  const pages  = Math.max(1, Math.ceil(total / LIMIT));

  return (
    <AppShell>
      <div className="p-6 space-y-4">
        <Button variant="ghost" size="sm" className="-ml-2" onClick={() => window.history.back()}>
          <ArrowLeft className="h-4 w-4 mr-1" />Kembali
        </Button>
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <Ship className="h-6 w-6 text-blue-400" />
            <div>
              <h1 className="text-xl font-semibold text-white">Ocean Freight Orders</h1>
              <p className="text-sm text-gray-400">{total} total order</p>
            </div>
          </div>
          <Button variant="outline" size="sm" onClick={() => refetch()} className="text-gray-300 border-gray-600">
            <RefreshCw className="h-4 w-4 mr-1" /> Refresh
          </Button>
        </div>

        {/* Filters */}
        <Card className="bg-gray-900 border-gray-700">
          <CardContent className="pt-4">
            <div className="flex flex-wrap gap-3">
              <div className="flex gap-2 flex-1 min-w-[240px]">
                <Input
                  placeholder="Cari order, customer, rute..."
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  onKeyDown={(e) => { if (e.key === "Enter") { setSearchQ(search); setPage(1); } }}
                  className="bg-gray-800 border-gray-600 text-white"
                />
                <Button variant="outline" className="border-gray-600" onClick={() => { setSearchQ(search); setPage(1); }}>
                  <Search className="h-4 w-4" />
                </Button>
              </div>
              <Select value={statusFilter} onValueChange={(v) => { setStatus(v); setPage(1); }}>
                <SelectTrigger className="w-48 bg-gray-800 border-gray-600 text-white">
                  <SelectValue placeholder="Semua Status" />
                </SelectTrigger>
                <SelectContent className="bg-gray-800 border-gray-700">
                  <SelectItem value="__all__">Semua Status</SelectItem>
                  {Object.entries(STATUS_LABEL).map(([v, l]) => (
                    <SelectItem key={v} value={v}>{l}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </CardContent>
        </Card>

        {/* Table */}
        <Card className="bg-gray-900 border-gray-700">
          <CardContent className="p-0">
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-gray-700 text-gray-400">
                    <th className="text-left p-3 font-medium">No. Order</th>
                    <th className="text-left p-3 font-medium">Customer</th>
                    <th className="text-left p-3 font-medium">Rute</th>
                    <th className="text-left p-3 font-medium">Jenis</th>
                    <th className="text-left p-3 font-medium">RFQ</th>
                    <th className="text-left p-3 font-medium">Grand Total</th>
                    <th className="text-left p-3 font-medium">Status</th>
                    <th className="text-left p-3 font-medium">Tanggal</th>
                    <th className="p-3"></th>
                  </tr>
                </thead>
                <tbody>
                  {isLoading ? (
                    <tr><td colSpan={9} className="text-center p-8 text-gray-500">Memuat...</td></tr>
                  ) : orders.length === 0 ? (
                    <tr><td colSpan={9} className="text-center p-8 text-gray-500">Tidak ada order</td></tr>
                  ) : orders.map((o: any) => (
                    <tr key={o.id} className="border-b border-gray-800 hover:bg-gray-800/50 cursor-pointer" onClick={() => navigate(`/ocean-freight/orders/${o.id}`)}>
                      <td className="p-3 font-mono text-blue-400 text-xs">{o.order_number}</td>
                      <td className="p-3">
                        <div className="text-white text-sm font-medium">{o.customer_name}</div>
                        {o.customer_phone && <div className="text-gray-400 text-xs">{o.customer_phone}</div>}
                      </td>
                      <td className="p-3 text-gray-300 text-xs">
                        <div>{o.origin_port}</div>
                        <div className="text-gray-500">→ {o.destination_port}</div>
                      </td>
                      <td className="p-3 text-gray-300 text-xs">
                        <div>{o.shipment_type}</div>
                        {o.container_type && <div className="text-gray-500">{o.container_type}{o.container_qty && o.container_qty > 1 ? ` ×${o.container_qty}` : ""}</div>}
                        {o.total_cbm && <div className="text-gray-500">{o.total_cbm} CBM</div>}
                      </td>
                      <td className="p-3 text-center" onClick={(e) => e.stopPropagation()}>
                        {Number(o.submission_count ?? 0) > 0
                          ? <span className="text-green-400 text-xs font-medium">{o.submission_count} rate</span>
                          : Number(o.rfq_count ?? 0) > 0
                          ? <span className="text-yellow-400 text-xs">{o.rfq_count} RFQ</span>
                          : <span className="text-gray-600 text-xs">-</span>}
                      </td>
                      <td className="p-3 text-gray-200 text-sm font-medium">{idr(o.grand_total)}</td>
                      <td className="p-3">
                        <Badge variant="outline" className={`text-xs ${STATUS_COLOR[o.status] ?? "bg-gray-800 text-gray-300 border-gray-600"}`}>
                          {STATUS_LABEL[o.status] ?? o.status}
                        </Badge>
                      </td>
                      <td className="p-3 text-gray-500 text-xs">{fmtDate(o.created_at)}</td>
                      <td className="p-3" onClick={(e) => e.stopPropagation()}>
                        <DropdownMenu>
                          <DropdownMenuTrigger asChild>
                            <Button variant="ghost" size="icon" className="h-7 w-7 text-gray-400 hover:text-white">
                              <MoreHorizontal className="h-4 w-4" />
                            </Button>
                          </DropdownMenuTrigger>
                          <DropdownMenuContent className="bg-gray-800 border-gray-700" align="end">
                            <DropdownMenuItem onClick={() => navigate(`/ocean-freight/orders/${o.id}`)} className="text-gray-200 hover:bg-gray-700">
                              <Eye className="h-4 w-4 mr-2" /> Lihat Detail
                            </DropdownMenuItem>
                            {!["completed","cancelled"].includes(o.status) && (
                              <DropdownMenuItem
                                onClick={() => { if (confirm("Batalkan order ini?")) cancelMut.mutate(o.id); }}
                                className="text-red-400 hover:bg-gray-700"
                              >
                                <XCircle className="h-4 w-4 mr-2" /> Batalkan
                              </DropdownMenuItem>
                            )}
                          </DropdownMenuContent>
                        </DropdownMenu>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            {/* Pagination */}
            {pages > 1 && (
              <div className="flex items-center justify-between p-3 border-t border-gray-700">
                <span className="text-xs text-gray-500">Hal {page} dari {pages} ({total} total)</span>
                <div className="flex gap-1">
                  <Button size="sm" variant="outline" className="h-7 border-gray-600" disabled={page <= 1} onClick={() => setPage(p => p - 1)}>
                    <ChevronLeft className="h-3 w-3" />
                  </Button>
                  <Button size="sm" variant="outline" className="h-7 border-gray-600" disabled={page >= pages} onClick={() => setPage(p => p + 1)}>
                    <ChevronRight className="h-3 w-3" />
                  </Button>
                </div>
              </div>
            )}
          </CardContent>
        </Card>
      </div>
    </AppShell>
  );
}
