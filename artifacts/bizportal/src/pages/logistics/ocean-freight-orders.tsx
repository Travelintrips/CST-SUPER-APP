import { useState } from "react";
import { Link, useLocation } from "wouter";
import { useQuery } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Ship, Plus, Search, ExternalLink, RefreshCw } from "lucide-react";
import { QueryState } from "@/components/ui/query-state";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";

const IDR = (n: number) =>
  new Intl.NumberFormat("id-ID", { style: "currency", currency: "IDR", maximumFractionDigits: 0 }).format(n);

const STATUS_COLORS: Record<string, string> = {
  waiting_rate:   "bg-yellow-100 text-yellow-700",
  rate_requested: "bg-blue-100 text-blue-700",
  rate_received:  "bg-purple-100 text-purple-700",
  quoted:         "bg-green-100 text-green-700",
  approved:       "bg-green-200 text-green-800",
  booked:         "bg-sky-100 text-sky-700",
  sailed:         "bg-sky-200 text-sky-800",
  arrived:        "bg-teal-100 text-teal-700",
  completed:      "bg-gray-100 text-gray-700",
  cancelled:      "bg-red-100 text-red-700",
  quote_declined: "bg-red-100 text-red-700",
};
const STATUS_LABELS: Record<string, string> = {
  waiting_rate:   "Waiting Rate",
  rate_requested: "RFQ Sent",
  rate_received:  "Rate Received",
  quoted:         "Quoted",
  approved:       "Approved",
  booked:         "Booked",
  sailed:         "Sailed",
  arrived:        "Arrived",
  completed:      "Completed",
  cancelled:      "Cancelled",
  quote_declined: "Declined",
};

export default function OceanFreightOrdersPage() {
  const [, setLocation] = useLocation();
  const [search,     setSearch]     = useState("");
  const [statusFilter, setStatusFilter] = useState("all");

  const { data: orders = [], isLoading, isError, error, refetch } = useQuery<any[]>({
    queryKey: ["ocean-freight-orders", statusFilter],
    queryFn: async () => {
      const params = new URLSearchParams();
      if (statusFilter !== "all") params.set("status", statusFilter);
      const res = await fetch(`/api/ocean-freight?${params}`, { credentials: "include" });
      if (!res.ok) throw new Error(`${res.status} ${res.statusText}`);
      return res.json();
    },
    retry: 1,
  });

  const filtered = orders.filter(o => {
    if (!search) return true;
    const q = search.toLowerCase();
    return o.order_number?.toLowerCase().includes(q) ||
           o.customer_name?.toLowerCase().includes(q) ||
           o.origin_port?.toLowerCase().includes(q) ||
           o.destination_port?.toLowerCase().includes(q);
  });

  return (
    <div className="p-6 space-y-4">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Ship className="w-5 h-5 text-blue-600" />
          <h1 className="text-xl font-bold text-gray-900">Ocean Freight Orders</h1>
        </div>
        <div className="flex gap-2">
          <Button variant="outline" size="sm" onClick={() => refetch()}>
            <RefreshCw className="w-4 h-4" />
          </Button>
          <Button size="sm" className="bg-blue-600 hover:bg-blue-700 text-white"
            onClick={() => setLocation("/logistics/ocean-freight/new")}>
            <Plus className="w-4 h-4 mr-1" /> Tambah Order
          </Button>
        </div>
      </div>

      {/* Filters */}
      <div className="flex gap-3">
        <div className="relative flex-1 max-w-xs">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
          <Input
            placeholder="Cari order / customer..."
            value={search}
            onChange={e => setSearch(e.target.value)}
            className="pl-9"
          />
        </div>
        <Select value={statusFilter} onValueChange={setStatusFilter}>
          <SelectTrigger className="w-44">
            <SelectValue placeholder="Semua Status" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">Semua Status</SelectItem>
            {Object.entries(STATUS_LABELS).map(([v, l]) => (
              <SelectItem key={v} value={v}>{l}</SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      {/* Table */}
      <QueryState
        loading={isLoading}
        error={isError ? error : null}
        empty={filtered.length === 0}
        emptyMessage="Belum ada order Ocean Freight"
        emptyIcon={<Ship className="w-10 h-10 opacity-30" />}
      >
        <div className="bg-white rounded-xl shadow overflow-hidden">
          <table className="w-full text-sm">
            <thead className="bg-gray-50 border-b">
              <tr>
                {["No. Order","Customer","Rute","Shipment","Estimasi","RFQ","Sub","Status","Aksi"].map(h => (
                  <th key={h} className="px-4 py-3 text-left text-xs font-semibold text-gray-500 uppercase tracking-wider">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {filtered.map(o => (
                <tr key={o.id} className="hover:bg-gray-50 transition-colors">
                  <td className="px-4 py-3 font-mono text-xs text-blue-700 font-semibold whitespace-nowrap">
                    {o.order_number}
                  </td>
                  <td className="px-4 py-3">
                    <p className="font-medium text-gray-800">{o.customer_name}</p>
                    {o.customer_phone && <p className="text-xs text-gray-500">{o.customer_phone}</p>}
                  </td>
                  <td className="px-4 py-3 whitespace-nowrap">
                    <p className="text-gray-700">{o.origin_port} → {o.destination_port}</p>
                    <p className="text-xs text-gray-500 capitalize">{o.trade_type} · {o.service_mode?.replace(/_/g, " ")}</p>
                  </td>
                  <td className="px-4 py-3 whitespace-nowrap">
                    <Badge variant="outline" className="text-xs">{o.shipment_type}</Badge>
                    {o.container_type && <span className="ml-1 text-xs text-gray-500">{o.container_type}</span>}
                    {o.total_cbm && <span className="text-xs text-gray-500">{o.total_cbm} CBM</span>}
                  </td>
                  <td className="px-4 py-3 whitespace-nowrap">
                    {o.grand_total
                      ? <span className="font-semibold text-green-700">{IDR(Number(o.grand_total))}</span>
                      : o.estimated_price_idr
                        ? <span className="text-gray-500 text-xs">{IDR(Number(o.estimated_price_idr))} <span className="text-gray-400">(est)</span></span>
                        : <span className="text-gray-400 text-xs">-</span>
                    }
                  </td>
                  <td className="px-4 py-3 text-center text-xs text-gray-600">{o.rfq_count ?? 0}</td>
                  <td className="px-4 py-3 text-center text-xs text-gray-600">{o.submission_count ?? 0}</td>
                  <td className="px-4 py-3">
                    <Badge className={`text-xs ${STATUS_COLORS[o.status] ?? "bg-gray-100 text-gray-600"}`}>
                      {STATUS_LABELS[o.status] ?? o.status}
                    </Badge>
                  </td>
                  <td className="px-4 py-3">
                    <Link href={`/logistics/ocean-freight/${o.id}`}>
                      <Button size="sm" variant="outline" className="text-xs">
                        Detail <ExternalLink className="ml-1 w-3 h-3" />
                      </Button>
                    </Link>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </QueryState>
    </div>
  );
}
