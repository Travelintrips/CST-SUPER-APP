import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { QueryState } from "@/components/ui/query-state";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Separator } from "@/components/ui/separator";
import { useToast } from "@/hooks/use-toast";
import {
  Truck, MapPin, Calendar, Package, Phone, User, Clock,
  ChevronRight, Loader2, RefreshCw, Filter, DollarSign,
} from "lucide-react";
import { cn } from "@/lib/utils";

// ── Types ─────────────────────────────────────────────────────────────────────

interface TruckingOrder {
  id: number;
  booking_number: string;
  customer_id: number | null;
  vehicle_type: string;
  vehicle_name: string;
  area_pickup: string;
  alamat_pickup: string;
  pic_pickup: string;
  hp_pickup: string;
  area_delivery: string;
  alamat_delivery: string;
  pic_penerima: string;
  hp_penerima: string;
  jadwal_type: string;
  tanggal_pickup: string | null;
  jam_pickup: string | null;
  jenis_barang: string | null;
  berat_kg: string | null;
  jumlah_koli: number | null;
  volume_m3: string | null;
  catatan: string | null;
  jumlah_trip: number;
  addons: Record<string, boolean>;
  estimasi_total: string;
  estimated_distance_km: string | null;
  estimated_price: string | null;
  pricing_breakdown: Record<string, unknown> | null;
  candidate_vendor_ids: number[] | null;
  selected_vendor_id: number | null;
  final_price: string | null;
  source: string;
  status: string;
  created_at: string;
  updated_at: string;
}

interface ListResponse {
  rows: TruckingOrder[];
  total: number;
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function formatRp(n: number | string | null | undefined): string {
  if (!n) return "—";
  return new Intl.NumberFormat("id-ID", { style: "currency", currency: "IDR", maximumFractionDigits: 0 }).format(Number(n));
}

function fmtDate(d: string): string {
  try {
    return new Date(d).toLocaleDateString("id-ID", { day: "2-digit", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" });
  } catch { return d; }
}

const AREA_LABEL: Record<string, string> = {
  "jawa-sumatra": "Jawa, Sumatra",
  kalimantan: "Kalimantan",
  sulawesi: "Sulawesi",
  "bali-nusra": "Bali & Nusa Tenggara",
};

const ADDON_LABEL: Record<string, string> = {
  bantuanMuat: "Bantuan Muat",
  bantuanBongkar: "Bantuan Bongkar",
  asuransi: "Asuransi",
  ferry: "Ferry / Penyeberangan",
  tol: "Tol (actual cost)",
  multiDrop: "Multi-drop",
  urgentDelivery: "Urgent Delivery",
  overnight: "Overnight / Sewa Seharian",
};

const STATUS_CONFIG: Record<string, { label: string; variant: "default" | "secondary" | "destructive" | "outline"; cls: string }> = {
  pending_review: { label: "Menunggu Review", variant: "outline",     cls: "border-amber-300 bg-amber-50 text-amber-800" },
  reviewed:       { label: "Sudah Direview",  variant: "secondary",   cls: "border-blue-300 bg-blue-50 text-blue-800" },
  confirmed:      { label: "Dikonfirmasi",    variant: "default",     cls: "bg-green-100 text-green-800 border-green-300" },
  in_progress:    { label: "Dalam Proses",    variant: "default",     cls: "bg-indigo-100 text-indigo-800 border-indigo-300" },
  completed:      { label: "Selesai",         variant: "default",     cls: "bg-slate-100 text-slate-700 border-slate-300" },
  cancelled:      { label: "Dibatalkan",      variant: "destructive", cls: "bg-red-50 text-red-700 border-red-300" },
};

const ALL_STATUSES = Object.entries(STATUS_CONFIG).map(([v, c]) => ({ value: v, label: c.label }));

function StatusBadge({ status }: { status: string }) {
  const cfg = STATUS_CONFIG[status] ?? { label: status, cls: "bg-slate-100 text-slate-600 border-slate-200" };
  return (
    <span className={cn("inline-flex items-center px-2.5 py-0.5 rounded-full text-[11px] font-semibold border", cfg.cls)}>
      {cfg.label}
    </span>
  );
}

// ── Detail Sheet ──────────────────────────────────────────────────────────────

function DetailSheet({ order, open, onClose }: { order: TruckingOrder | null; open: boolean; onClose: () => void }) {
  const qc = useQueryClient();
  const { toast } = useToast();
  const [finalPrice, setFinalPrice] = useState("");
  const [status, setStatus] = useState("");

  const mutation = useMutation({
    mutationFn: async () => {
      const body: Record<string, unknown> = {};
      if (finalPrice) body.finalPrice = parseFloat(finalPrice.replace(/\D/g, ""));
      if (status)     body.status = status;
      const res = await fetch(`/api/trucking/bookings/${order!.id}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      if (!res.ok) throw new Error((await res.json().catch(() => ({}))).message ?? "Gagal menyimpan");
      return res.json();
    },
    onSuccess: () => {
      toast({ title: "Order diperbarui" });
      void qc.invalidateQueries({ queryKey: ["trucking-orders"] });
      onClose();
    },
    onError: (e: Error) => toast({ title: "Gagal", description: e.message, variant: "destructive" }),
  });

  if (!order) return null;

  const activeAddons = Object.entries(order.addons ?? {})
    .filter(([, v]) => v)
    .map(([k]) => ADDON_LABEL[k] ?? k);

  const jadwal = order.jadwal_type === "sekarang"
    ? "Pickup Sekarang"
    : `${order.tanggal_pickup ?? "—"} ${order.jam_pickup ? `jam ${order.jam_pickup}` : ""}`;

  return (
    <Sheet open={open} onOpenChange={(v) => !v && onClose()}>
      <SheetContent className="w-full sm:max-w-2xl overflow-y-auto">
        <SheetHeader className="mb-4">
          <SheetTitle className="flex items-center gap-2">
            <Truck className="h-5 w-5 text-blue-600" />
            {order.booking_number}
          </SheetTitle>
          <div className="flex items-center gap-2">
            <StatusBadge status={order.status} />
            <span className="text-[11px] text-slate-400">{fmtDate(order.created_at)}</span>
          </div>
        </SheetHeader>

        <div className="space-y-5">

          {/* Armada */}
          <section>
            <p className="text-[11px] font-bold text-slate-400 uppercase tracking-wider mb-2">Armada</p>
            <div className="bg-slate-50 rounded-xl p-3 flex items-center gap-3">
              <Truck className="h-5 w-5 text-blue-500 shrink-0" />
              <div>
                <p className="text-sm font-semibold text-slate-800">{order.vehicle_name}</p>
                <p className="text-[11px] text-slate-400">{order.jumlah_trip} trip</p>
              </div>
            </div>
          </section>

          {/* Rute */}
          <section>
            <p className="text-[11px] font-bold text-slate-400 uppercase tracking-wider mb-2">Rute</p>
            <div className="grid grid-cols-2 gap-3">
              <div className="bg-green-50 border border-green-200 rounded-xl p-3 space-y-1">
                <p className="text-[10px] font-bold text-green-700 uppercase">Pickup</p>
                <p className="text-[12px] font-semibold text-slate-800">{AREA_LABEL[order.area_pickup] ?? order.area_pickup}</p>
                <p className="text-[11px] text-slate-600">{order.alamat_pickup}</p>
                <p className="text-[11px] text-slate-500 flex items-center gap-1"><User className="h-3 w-3" />{order.pic_pickup}</p>
                <p className="text-[11px] text-slate-500 flex items-center gap-1"><Phone className="h-3 w-3" />{order.hp_pickup}</p>
              </div>
              <div className="bg-blue-50 border border-blue-200 rounded-xl p-3 space-y-1">
                <p className="text-[10px] font-bold text-blue-700 uppercase">Delivery</p>
                <p className="text-[12px] font-semibold text-slate-800">{AREA_LABEL[order.area_delivery] ?? order.area_delivery}</p>
                <p className="text-[11px] text-slate-600">{order.alamat_delivery}</p>
                <p className="text-[11px] text-slate-500 flex items-center gap-1"><User className="h-3 w-3" />{order.pic_penerima}</p>
                <p className="text-[11px] text-slate-500 flex items-center gap-1"><Phone className="h-3 w-3" />{order.hp_penerima}</p>
              </div>
            </div>
            {order.estimated_distance_km && (
              <p className="text-[11px] text-slate-400 mt-1.5">Estimasi jarak: <b>{Number(order.estimated_distance_km).toLocaleString("id-ID")} km</b></p>
            )}
          </section>

          {/* Jadwal */}
          <section>
            <p className="text-[11px] font-bold text-slate-400 uppercase tracking-wider mb-2">Jadwal</p>
            <div className="flex items-center gap-2 bg-slate-50 rounded-xl p-3">
              <Clock className="h-4 w-4 text-slate-400" />
              <span className="text-sm text-slate-700">{jadwal}</span>
            </div>
          </section>

          {/* Barang */}
          <section>
            <p className="text-[11px] font-bold text-slate-400 uppercase tracking-wider mb-2">Info Barang</p>
            <div className="bg-slate-50 rounded-xl p-3 grid grid-cols-2 gap-y-1.5 text-[12px]">
              <span className="text-slate-400">Jenis</span>
              <span className="font-medium text-slate-700">{order.jenis_barang ?? "—"}</span>
              <span className="text-slate-400">Berat</span>
              <span className="font-medium text-slate-700">{order.berat_kg ? `${order.berat_kg} kg` : "—"}</span>
              <span className="text-slate-400">Koli</span>
              <span className="font-medium text-slate-700">{order.jumlah_koli ?? "—"}</span>
              <span className="text-slate-400">Volume</span>
              <span className="font-medium text-slate-700">{order.volume_m3 ? `${order.volume_m3} m³` : "—"}</span>
              {order.catatan && (
                <>
                  <span className="text-slate-400">Catatan</span>
                  <span className="font-medium text-slate-700">{order.catatan}</span>
                </>
              )}
            </div>
          </section>

          {/* Tambahan */}
          {activeAddons.length > 0 && (
            <section>
              <p className="text-[11px] font-bold text-slate-400 uppercase tracking-wider mb-2">Layanan Tambahan</p>
              <div className="flex flex-wrap gap-1.5">
                {activeAddons.map((a) => (
                  <span key={a} className="text-[11px] bg-indigo-50 text-indigo-700 border border-indigo-200 rounded-full px-2.5 py-0.5 font-medium">{a}</span>
                ))}
              </div>
            </section>
          )}

          {/* Harga */}
          <section>
            <p className="text-[11px] font-bold text-slate-400 uppercase tracking-wider mb-2">Harga</p>
            <div className="bg-slate-50 rounded-xl p-3 space-y-1.5 text-[12px]">
              <div className="flex justify-between">
                <span className="text-slate-400">Estimasi Customer</span>
                <span className="font-semibold text-slate-700">{formatRp(order.estimated_price ?? order.estimasi_total)}</span>
              </div>
              {order.final_price && (
                <div className="flex justify-between border-t border-slate-200 pt-1.5">
                  <span className="text-slate-600 font-semibold">Harga Final</span>
                  <span className="font-bold text-green-700 text-[14px]">{formatRp(order.final_price)}</span>
                </div>
              )}
            </div>
          </section>

          <Separator />

          {/* Admin Actions */}
          <section>
            <p className="text-[11px] font-bold text-slate-400 uppercase tracking-wider mb-3">Review Admin</p>
            <div className="space-y-3">
              <div className="space-y-1.5">
                <Label className="text-[12px] font-semibold text-slate-600">Harga Final (Rp)</Label>
                <div className="relative">
                  <DollarSign className="absolute left-3 top-2.5 h-4 w-4 text-slate-300 pointer-events-none" />
                  <Input
                    type="number"
                    placeholder={order.estimated_price ?? order.estimasi_total ?? "0"}
                    value={finalPrice}
                    onChange={(e) => setFinalPrice(e.target.value)}
                    className="pl-9 h-10 text-[13px] rounded-xl border-slate-200"
                  />
                </div>
                <p className="text-[10.5px] text-slate-400">Estimasi customer: {formatRp(order.estimated_price ?? order.estimasi_total)}</p>
              </div>

              <div className="space-y-1.5">
                <Label className="text-[12px] font-semibold text-slate-600">Update Status</Label>
                <Select value={status || order.status} onValueChange={setStatus}>
                  <SelectTrigger className="h-10 text-[13px] rounded-xl border-slate-200">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {ALL_STATUSES.map((s) => (
                      <SelectItem key={s.value} value={s.value}>{s.label}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              <Button
                onClick={() => mutation.mutate()}
                disabled={mutation.isPending || (!finalPrice && !status)}
                className="w-full h-10 bg-blue-600 hover:bg-blue-700 text-white rounded-xl font-semibold text-sm gap-2"
              >
                {mutation.isPending ? <><Loader2 className="h-4 w-4 animate-spin" />Menyimpan...</> : "Simpan Perubahan"}
              </Button>
            </div>
          </section>
        </div>
      </SheetContent>
    </Sheet>
  );
}

// ── Main Page ─────────────────────────────────────────────────────────────────

export default function TruckingOrdersPage() {
  const [statusFilter, setStatusFilter] = useState("pending_review");
  const [selectedOrder, setSelectedOrder] = useState<TruckingOrder | null>(null);

  const { data, isLoading, refetch, isFetching } = useQuery<ListResponse>({
    queryKey: ["trucking-orders", statusFilter],
    queryFn: async () => {
      const qs = statusFilter !== "all" ? `?status=${statusFilter}` : "";
      const res = await fetch(`/api/trucking/bookings${qs}`);
      if (!res.ok) throw new Error("Gagal memuat data");
      return res.json() as Promise<ListResponse>;
    },
    refetchInterval: 30_000,
  });

  const orders = data?.rows ?? [];

  return (
    <div className="p-6 max-w-6xl mx-auto space-y-5">

      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-bold text-slate-900 flex items-center gap-2">
            <Truck className="h-5 w-5 text-blue-600" />
            Order Trucking
          </h1>
          <p className="text-[12px] text-slate-400 mt-0.5">Order dari customer portal — review dan tetapkan harga final</p>
        </div>
        <Button variant="outline" size="sm" onClick={() => refetch()} disabled={isFetching}
          className="gap-1.5 text-[12px] h-8 rounded-lg border-slate-200">
          <RefreshCw className={cn("h-3.5 w-3.5", isFetching && "animate-spin")} />
          Refresh
        </Button>
      </div>

      {/* Filter */}
      <div className="flex items-center gap-2 flex-wrap">
        <Filter className="h-4 w-4 text-slate-400" />
        {[
          { value: "pending_review", label: "Menunggu Review" },
          { value: "reviewed",       label: "Sudah Direview" },
          { value: "confirmed",      label: "Dikonfirmasi" },
          { value: "in_progress",    label: "Dalam Proses" },
          { value: "completed",      label: "Selesai" },
          { value: "cancelled",      label: "Dibatalkan" },
          { value: "all",            label: "Semua" },
        ].map((f) => (
          <button
            key={f.value}
            onClick={() => setStatusFilter(f.value)}
            className={cn(
              "text-[12px] font-semibold px-3 py-1 rounded-lg border transition-all",
              statusFilter === f.value
                ? "bg-blue-600 text-white border-blue-600"
                : "bg-white text-slate-600 border-slate-200 hover:border-blue-300",
            )}
          >
            {f.label}
          </button>
        ))}
        {data?.total !== undefined && (
          <span className="ml-auto text-[11px] text-slate-400">{data.total} order ditemukan</span>
        )}
      </div>

      {/* Table */}
      <QueryState loading={isLoading} empty={orders.length === 0} emptyMessage="Tidak ada order" emptyIcon={<Truck className="h-10 w-10 opacity-30" />}>
        <div className="bg-white rounded-2xl border border-slate-100 shadow-sm overflow-hidden">
          <table className="w-full text-[12.5px]">
            <thead>
              <tr className="border-b border-slate-100 bg-slate-50">
                <th className="text-left px-4 py-3 font-semibold text-slate-500">No. Order</th>
                <th className="text-left px-4 py-3 font-semibold text-slate-500">Armada</th>
                <th className="text-left px-4 py-3 font-semibold text-slate-500 hidden md:table-cell">Rute</th>
                <th className="text-left px-4 py-3 font-semibold text-slate-500 hidden lg:table-cell">Jadwal</th>
                <th className="text-right px-4 py-3 font-semibold text-slate-500">Estimasi</th>
                <th className="text-right px-4 py-3 font-semibold text-slate-500 hidden sm:table-cell">Harga Final</th>
                <th className="text-left px-4 py-3 font-semibold text-slate-500">Status</th>
                <th className="px-4 py-3" />
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-50">
              {orders.map((o) => (
                <tr
                  key={o.id}
                  className="hover:bg-slate-50/70 cursor-pointer transition-colors"
                  onClick={() => setSelectedOrder(o)}
                  role="button"
                  tabIndex={0}
                  aria-label={`Lihat order trucking ${o.booking_number}`}
                  onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); setSelectedOrder(o); } }}
                >
                  <td className="px-4 py-3">
                    <div className="font-mono font-semibold text-slate-800 text-[11.5px]">{o.booking_number}</div>
                    <div className="text-[10px] text-slate-400 mt-0.5">{fmtDate(o.created_at)}</div>
                  </td>
                  <td className="px-4 py-3">
                    <div className="flex items-center gap-1.5">
                      <Truck className="h-3.5 w-3.5 text-slate-400 shrink-0" />
                      <span className="font-medium text-slate-700">{o.vehicle_name}</span>
                    </div>
                    {o.jumlah_trip > 1 && <div className="text-[10px] text-slate-400 ml-5">{o.jumlah_trip} trip</div>}
                  </td>
                  <td className="px-4 py-3 hidden md:table-cell">
                    <div className="flex items-center gap-1 text-slate-600">
                      <MapPin className="h-3 w-3 text-green-500 shrink-0" />
                      <span>{AREA_LABEL[o.area_pickup] ?? o.area_pickup}</span>
                    </div>
                    <div className="flex items-center gap-1 text-slate-500 mt-0.5">
                      <MapPin className="h-3 w-3 text-blue-500 shrink-0" />
                      <span>{AREA_LABEL[o.area_delivery] ?? o.area_delivery}</span>
                    </div>
                  </td>
                  <td className="px-4 py-3 hidden lg:table-cell">
                    <div className="flex items-center gap-1.5 text-slate-500">
                      <Calendar className="h-3.5 w-3.5 text-slate-300" />
                      <span>{o.jadwal_type === "sekarang" ? "Sekarang" : (o.tanggal_pickup ?? "—")}</span>
                    </div>
                  </td>
                  <td className="px-4 py-3 text-right">
                    <span className="font-semibold text-slate-700">{formatRp(o.estimated_price ?? o.estimasi_total)}</span>
                  </td>
                  <td className="px-4 py-3 text-right hidden sm:table-cell">
                    {o.final_price
                      ? <span className="font-bold text-green-700">{formatRp(o.final_price)}</span>
                      : <span className="text-slate-300">—</span>}
                  </td>
                  <td className="px-4 py-3">
                    <StatusBadge status={o.status} />
                  </td>
                  <td className="px-4 py-3">
                    <ChevronRight className="h-4 w-4 text-slate-300" />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </QueryState>

      <DetailSheet
        order={selectedOrder}
        open={!!selectedOrder}
        onClose={() => setSelectedOrder(null)}
      />
    </div>
  );
}
