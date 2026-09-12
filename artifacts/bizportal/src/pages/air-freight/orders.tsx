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
  Plane, Plus, Search, RefreshCw, ChevronLeft, ChevronRight,
  MoreHorizontal, Eye, XCircle,
} from "lucide-react";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

const STATUS_LABEL: Record<string, string> = {
  inquiry:        "Inquiry Baru",
  draft:          "Draft",
  estimated:      "Estimasi",
  waiting_rate:   "Menunggu Rate",
  rate_requested: "Rate Diminta",
  rate_received:  "Rate Diterima",
  quoted:         "Quoted",
  approved:       "Disetujui",
  booked:         "Booked",
  departed:       "Berangkat",
  arrived:        "Tiba",
  delivered:      "Terkirim",
  completed:      "Selesai",
  cancelled:      "Dibatalkan",
  quote_declined: "Penawaran Ditolak",
};

const STATUS_COLOR: Record<string, string> = {
  inquiry:        "bg-violet-900/40 text-violet-300 border-violet-600",
  draft:          "bg-gray-800/40 text-gray-300 border-gray-600",
  estimated:      "bg-blue-900/40 text-blue-300 border-blue-600",
  waiting_rate:   "bg-yellow-900/40 text-yellow-300 border-yellow-600",
  rate_requested: "bg-orange-900/40 text-orange-300 border-orange-600",
  rate_received:  "bg-purple-900/40 text-purple-300 border-purple-600",
  quoted:         "bg-cyan-900/40 text-cyan-300 border-cyan-600",
  approved:       "bg-teal-900/40 text-teal-300 border-teal-600",
  booked:         "bg-emerald-900/40 text-emerald-300 border-emerald-600",
  departed:       "bg-sky-900/40 text-sky-300 border-sky-600",
  arrived:        "bg-indigo-900/40 text-indigo-300 border-indigo-600",
  delivered:      "bg-green-900/40 text-green-300 border-green-600",
  completed:      "bg-emerald-900/40 text-emerald-400 border-emerald-500",
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

const STATUSES = Object.keys(STATUS_LABEL);

export default function AirFreightOrdersPage() {
  const [, navigate] = useLocation();
  const { activeCompanyId } = useCompany();
  const qc = useQueryClient();

  const [search, setSearch]       = useState("");
  const [searchQ, setSearchQ]     = useState("");
  const [statusFilter, setStatus] = useState<string>("__all__");
  const [page, setPage]           = useState(1);
  const LIMIT = 50;

  const { data, isLoading, refetch } = useQuery({
    queryKey: ["air-freight-orders", activeCompanyId, searchQ, statusFilter, page],
    queryFn: async () => {
      const qs = new URLSearchParams({ page: String(page), limit: String(LIMIT) });
      if (activeCompanyId) qs.set("companyId", String(activeCompanyId));
      if (searchQ) qs.set("search", searchQ);
      if (statusFilter !== "__all__") qs.set("status", statusFilter);
      const r = await fetch(`/api/air-freight/orders?${qs}`, { credentials: "include" });
      if (!r.ok) throw new Error("Gagal memuat orders");
      return r.json() as Promise<{ data: any[]; total: number; page: number; limit: number }>;
    },
  });

  const cancelMut = useMutation({
    mutationFn: async (id: number) => {
      const r = await fetch(`/api/air-freight/orders/${id}`, { method: "DELETE", credentials: "include" });
      if (!r.ok) throw new Error("Gagal membatalkan");
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["air-freight-orders"] }),
  });

  const requestQuoteMut = useMutation({
    mutationFn: async (id: number) => {
      const r = await fetch(`/api/air-freight/orders/${id}/request-quote`, {
        method: "POST", credentials: "include",
      });
      if (!r.ok) throw new Error("Gagal");
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["air-freight-orders"] }),
  });

  const orders = data?.data ?? [];
  const total  = data?.total ?? 0;
  const totalPages = Math.ceil(total / LIMIT);

  return (
    <AppShell>
      <div className="p-6 space-y-5">
        {/* Header */}
        <div className="flex items-center justify-between flex-wrap gap-3">
          <div className="flex items-center gap-3">
            <Plane className="h-6 w-6 text-sky-400" />
            <div>
              <h1 className="text-2xl font-bold text-foreground">Air Freight Orders</h1>
              <p className="text-sm text-muted-foreground">Manajemen order pengiriman udara</p>
            </div>
          </div>
          <Button
            className="bg-sky-700 hover:bg-sky-600 text-white gap-1.5"
            onClick={() => navigate("/air-freight/orders/new")}
          >
            <Plus className="h-4 w-4" /> Buat Order
          </Button>
        </div>

        {/* Filters */}
        <Card className="border-border/60">
          <CardContent className="p-4 flex flex-wrap gap-3 items-end">
            <div className="flex gap-2 flex-1 min-w-[200px]">
              <Input
                placeholder="Cari order number, customer, komoditi…"
                value={search}
                onChange={e => setSearch(e.target.value)}
                onKeyDown={e => { if (e.key === "Enter") { setSearchQ(search); setPage(1); }}}
                className="bg-muted/30"
              />
              <Button variant="outline" size="icon" onClick={() => { setSearchQ(search); setPage(1); }}>
                <Search className="h-4 w-4" />
              </Button>
            </div>
            <Select value={statusFilter} onValueChange={v => { setStatus(v); setPage(1); }}>
              <SelectTrigger className="w-44 bg-muted/30">
                <SelectValue placeholder="Semua Status" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="__all__">Semua Status</SelectItem>
                {STATUSES.map(s => (
                  <SelectItem key={s} value={s}>{STATUS_LABEL[s]}</SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Button variant="ghost" size="icon" onClick={() => refetch()} title="Refresh">
              <RefreshCw className={`h-4 w-4 ${isLoading ? "animate-spin" : ""}`} />
            </Button>
          </CardContent>
        </Card>

        {/* Table */}
        <Card className="border-border/60">
          <CardHeader className="pb-2">
            <CardTitle className="text-sm text-muted-foreground flex items-center gap-2">
              <Plane className="h-4 w-4 text-sky-400" /> Order List
              <Badge className="bg-sky-900/40 text-sky-300 border-sky-600 text-xs">{total} order</Badge>
            </CardTitle>
          </CardHeader>
          <CardContent className="p-0">
            {isLoading ? (
              <div className="p-4 space-y-2">
                {Array.from({ length: 8 }).map((_, i) => (
                  <div key={i} className="h-10 rounded-lg bg-muted/20 animate-pulse" />
                ))}
              </div>
            ) : orders.length === 0 ? (
              <div className="py-12 text-center text-muted-foreground">
                <Plane className="h-10 w-10 mx-auto mb-3 opacity-20" />
                <p>Belum ada air freight order</p>
              </div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-xs">
                  <thead>
                    <tr className="border-b border-border/40 bg-muted/30">
                      {["No. Order","Customer","Rute","Komoditi","Berat (kg)","Tgl Dibuat","Estimasi Harga","Status","Aksi"].map(h => (
                        <th key={h} className="text-left py-2.5 px-3 text-muted-foreground font-medium whitespace-nowrap">{h}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {orders.map((o: any) => (
                      <tr key={o.id} className="border-b border-border/20 hover:bg-muted/30 transition-colors">
                        <td className="py-2 px-3 font-mono text-sky-300 whitespace-nowrap">{o.order_number}</td>
                        <td className="py-2 px-3">
                          <p className="font-medium text-foreground truncate max-w-[140px]">{o.customer_name || "-"}</p>
                          <p className="text-muted-foreground text-[10px]">{o.customer_email || ""}</p>
                        </td>
                        <td className="py-2 px-3 whitespace-nowrap">
                          <span className="font-medium">{o.origin_airport || "-"}</span>
                          <span className="text-muted-foreground mx-1">→</span>
                          <span className="font-medium">{o.destination_airport || "-"}</span>
                        </td>
                        <td className="py-2 px-3 max-w-[120px] truncate text-muted-foreground">{o.commodity || "-"}</td>
                        <td className="py-2 px-3 whitespace-nowrap">
                          <p className="font-medium">{o.chargeable_weight ?? 0} kg</p>
                          <p className="text-muted-foreground text-[10px]">{o.koli ?? 0} koli</p>
                        </td>
                        <td className="py-2 px-3 text-muted-foreground whitespace-nowrap">{fmtDate(o.created_at)}</td>
                        <td className="py-2 px-3 whitespace-nowrap">
                          {o.estimated_price_idr
                            ? <span className="text-emerald-400 font-medium">{idr(Number(o.estimated_price_idr))}</span>
                            : <span className="text-muted-foreground">—</span>}
                        </td>
                        <td className="py-2 px-3">
                          <Badge className={`text-[10px] border ${STATUS_COLOR[o.status] ?? "bg-muted text-muted-foreground border-border"}`}>
                            {STATUS_LABEL[o.status] ?? o.status}
                          </Badge>
                        </td>
                        <td className="py-2 px-3">
                          <DropdownMenu>
                            <DropdownMenuTrigger asChild>
                              <Button variant="ghost" size="icon" className="h-7 w-7">
                                <MoreHorizontal className="h-3.5 w-3.5" />
                              </Button>
                            </DropdownMenuTrigger>
                            <DropdownMenuContent align="end" className="text-xs">
                              <DropdownMenuItem
                                className="gap-2"
                                onClick={() => navigate(`/air-freight/orders/${o.id}`)}
                              >
                                <Eye className="h-3.5 w-3.5" /> Lihat Detail
                              </DropdownMenuItem>
                              {["draft","estimated"].includes(o.status) && (
                                <DropdownMenuItem
                                  className="gap-2 text-yellow-400"
                                  onClick={() => requestQuoteMut.mutate(o.id)}
                                >
                                  <Plane className="h-3.5 w-3.5" /> Minta Penawaran Final
                                </DropdownMenuItem>
                              )}
                              {!["completed","cancelled","quote_declined"].includes(o.status) && (
                                <DropdownMenuItem
                                  className="gap-2 text-red-400"
                                  onClick={() => { if (confirm("Batalkan order ini?")) cancelMut.mutate(o.id); }}
                                >
                                  <XCircle className="h-3.5 w-3.5" /> Batalkan
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
            )}

            {/* Pagination */}
            {totalPages > 1 && (
              <div className="flex items-center justify-between px-4 py-3 border-t border-border/40">
                <span className="text-xs text-muted-foreground">
                  {(page - 1) * LIMIT + 1}–{Math.min(page * LIMIT, total)} dari {total}
                </span>
                <div className="flex items-center gap-1">
                  <Button variant="ghost" size="icon" className="h-7 w-7" disabled={page === 1} onClick={() => setPage(p => p - 1)}>
                    <ChevronLeft className="h-3.5 w-3.5" />
                  </Button>
                  <span className="text-xs px-2">{page}/{totalPages}</span>
                  <Button variant="ghost" size="icon" className="h-7 w-7" disabled={page >= totalPages} onClick={() => setPage(p => p + 1)}>
                    <ChevronRight className="h-3.5 w-3.5" />
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
