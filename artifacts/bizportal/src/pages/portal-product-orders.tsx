import { useState, useCallback, useEffect } from "react";
import { CATEGORY_LABELS } from "@workspace/product-templates";
import {
  useListPortalProductOrders,
  useGetPortalProductOrder,
  useUpdatePortalProductOrderStatus,
  useDeletePortalProductOrder,
  useLinkPortalProductOrderItem,
  useListPortalProducts,
  getListPortalProductOrdersQueryKey,
  getGetPortalProductOrderQueryOptions,
} from "@workspace/api-client-react";
import type { PortalProductOrder } from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { usePrefetchOnHover } from "@/hooks/use-prefetch-on-hover";
import { AppShell } from "@/components/layout/AppShell";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Separator } from "@/components/ui/separator";
import { Textarea } from "@/components/ui/textarea";
import { useToast } from "@/hooks/use-toast";
import {
  Search, RefreshCw, Package, Trash2, CheckCircle2, Circle,
  Clock, Truck, XCircle, ChevronRight, AlertTriangle, User,
  Mail, Phone, MapPin, StickyNote, Loader2, Tag, FileText,
  ClipboardList, Wrench, ChevronDown, Eye, CreditCard, Send, ExternalLink, Store,
  Factory, Calendar, DollarSign, ShoppingBag, Package2, ArrowRight,
  Boxes, Radio, Bell, Navigation,
} from "lucide-react";
import { getTemplate } from "@/lib/productTemplates";
import type { ProductTemplate } from "@/lib/productTemplates";
import { BackButton } from "@/components/ui/back-button";

/* ─────────────────────────────────────────────── types ─── */

type ExtOrder = PortalProductOrder & {
  orderType?: string;
  productApproveToken?: string | null;
  shipmentMode?: string | null;
  vendorQuotedPrice?: number | null;
  vendorNameSelected?: string | null;
  readyDate?: string | null;
  pickupLocation?: string | null;
  productCategory?: string | null;
  templateVersion?: string | null;
  customFieldValues?: Record<string, string | number | boolean>;
  uploadedDocuments?: { key: string; label: string; reference: string }[];
  checklistStatus?: Record<string, boolean>;
  packagingNotes?: string | null;
};

/* ─────────────────────────────────────────────── constants ─── */

const STANDARD_STATUSES = ["New Order", "Confirmed", "Processing", "Shipped", "Completed", "Cancelled"] as const;
const PRODUCT_FIRST_STATUSES = [
  "Admin Review", "Product RFQ Sent", "Product Quote Received",
  "Product Vendor Selected", "Customer Product Approval", "Shipment Selection Pending",
  "Ready for Pickup", "Shipment RFQ Sent",
] as const;
const ALL_STATUS_OPTIONS = [...STANDARD_STATUSES, ...PRODUCT_FIRST_STATUSES] as const;
type AnyStatus = typeof ALL_STATUS_OPTIONS[number];

const STATUS_FLOW = ["New Order", "Confirmed", "Processing", "Shipped", "Completed"] as const;
type OrderStatus = typeof STANDARD_STATUSES[number];

const NEXT_STATUS: Partial<Record<string, string>> = {
  "New Order": "Confirmed",
  "Confirmed": "Processing",
  "Processing": "Shipped",
  "Shipped": "Completed",
};
const NEXT_LABEL: Partial<Record<string, string>> = {
  "New Order": "Konfirmasi Order",
  "Confirmed": "Mulai Proses",
  "Processing": "Tandai Dikirim",
  "Shipped": "Selesaikan",
};

const STATUS_COLORS: Record<string, string> = {
  "New Order": "bg-yellow-100 text-yellow-800 border-yellow-200",
  "Confirmed": "bg-blue-100 text-blue-800 border-blue-200",
  "Processing": "bg-orange-100 text-orange-800 border-orange-200",
  "Shipped": "bg-purple-100 text-purple-800 border-purple-200",
  "Completed": "bg-green-100 text-green-800 border-green-200",
  "Cancelled": "bg-red-100 text-red-800 border-red-200",
  "Admin Review": "bg-slate-100 text-slate-800 border-slate-200",
  "Product RFQ Sent": "bg-cyan-100 text-cyan-800 border-cyan-200",
  "Product Quote Received": "bg-indigo-100 text-indigo-800 border-indigo-200",
  "Product Vendor Selected": "bg-violet-100 text-violet-800 border-violet-200",
  "Customer Product Approval": "bg-amber-100 text-amber-800 border-amber-200",
  "Shipment Selection Pending": "bg-teal-100 text-teal-800 border-teal-200",
  "Ready for Pickup": "bg-emerald-100 text-emerald-800 border-emerald-200",
  "Shipment RFQ Sent": "bg-pink-100 text-pink-800 border-pink-200",
};

const STATUS_ICONS: Record<string, React.ReactNode> = {
  "New Order": <Clock className="w-3.5 h-3.5" />,
  "Confirmed": <CheckCircle2 className="w-3.5 h-3.5" />,
  "Processing": <Loader2 className="w-3.5 h-3.5" />,
  "Shipped": <Truck className="w-3.5 h-3.5" />,
  "Completed": <CheckCircle2 className="w-3.5 h-3.5" />,
  "Cancelled": <XCircle className="w-3.5 h-3.5" />,
  "Admin Review": <Eye className="w-3.5 h-3.5" />,
  "Product RFQ Sent": <Send className="w-3.5 h-3.5" />,
  "Product Quote Received": <DollarSign className="w-3.5 h-3.5" />,
  "Product Vendor Selected": <Factory className="w-3.5 h-3.5" />,
  "Customer Product Approval": <CheckCircle2 className="w-3.5 h-3.5" />,
  "Shipment Selection Pending": <Radio className="w-3.5 h-3.5" />,
  "Ready for Pickup": <Package2 className="w-3.5 h-3.5" />,
  "Shipment RFQ Sent": <Truck className="w-3.5 h-3.5" />,
};

const STATS_LIST: { status: string; label: string }[] = [
  { status: "New Order",  label: "Pesanan Baru" },
  { status: "Confirmed",  label: "Dikonfirmasi" },
  { status: "Processing", label: "Diproses" },
  { status: "Shipped",    label: "Dikirim" },
  { status: "Completed",  label: "Selesai" },
  { status: "Cancelled",  label: "Dibatalkan" },
];

const PRODUCT_FIRST_STATS: { status: string; label: string }[] = [
  { status: "Admin Review",              label: "Ditinjau" },
  { status: "Product RFQ Sent",          label: "RFQ Produk" },
  { status: "Product Quote Received",    label: "Quote Masuk" },
  { status: "Product Vendor Selected",   label: "Vendor Dipilih" },
  { status: "Shipment Selection Pending", label: "Pilih Kirim" },
  { status: "Shipment RFQ Sent",         label: "RFQ Kirim" },
];

const SHIPMENT_MODE_LABELS: Record<string, string> = {
  pickup_self: "Ambil Sendiri",
  trucking: "Trucking (Darat)",
  air_cargo: "Kargo Udara",
  sea_cargo: "Kargo Laut",
  door_to_door: "Door-to-Door",
  courier: "Kurir",
};

const idr = (n: number) =>
  new Intl.NumberFormat("id-ID", { style: "currency", currency: "IDR", maximumFractionDigits: 0 }).format(n);

const BULAN_ID = ["Jan","Feb","Mar","Apr","Mei","Jun","Jul","Agt","Sep","Okt","Nov","Des"];
function formatTanggal(iso: string) {
  const d = new Date(iso);
  return `${String(d.getDate()).padStart(2,"0")} ${BULAN_ID[d.getMonth()]} ${d.getFullYear()}, ${String(d.getHours()).padStart(2,"0")}:${String(d.getMinutes()).padStart(2,"0")}`;
}

/* ─────────────────────────────────────────────── StatusTimeline (standard) ─── */

function StatusTimeline({ status, orderType }: { status: string; orderType?: string }) {
  if (orderType === "product_first") return <ProductFirstTimeline status={status} />;

  const isCancelled = status === "Cancelled";
  const currentIdx = STATUS_FLOW.indexOf(status as any);

  if (isCancelled) {
    return (
      <div className="flex items-center gap-2 px-1 py-3">
        <XCircle className="w-5 h-5 text-red-500 shrink-0" />
        <span className="text-sm font-medium text-red-600">Pesanan Dibatalkan</span>
      </div>
    );
  }

  return (
    <div className="relative">
      <div className="absolute top-[18px] left-[18px] right-[18px] h-0.5 bg-muted" />
      <div className="flex justify-between relative">
        {STATUS_FLOW.map((s, idx) => {
          const done = idx < currentIdx;
          const active = idx === currentIdx;
          return (
            <div key={s} className="flex flex-col items-center gap-1.5 flex-1">
              <div className={`w-9 h-9 rounded-full border-2 flex items-center justify-center z-10 transition-all ${
                done   ? "bg-primary border-primary text-primary-foreground shadow-sm" :
                active ? "bg-primary/10 border-primary text-primary shadow-sm ring-2 ring-primary/20" :
                         "bg-background border-muted-foreground/30 text-muted-foreground/40"
              }`}>
                {done ? <CheckCircle2 className="w-4 h-4" /> : active ? <Circle className="w-4 h-4 fill-primary/30" /> : <Circle className="w-4 h-4" />}
              </div>
              <span className={`text-[10px] text-center leading-tight max-w-[60px] ${done || active ? "font-semibold text-foreground" : "text-muted-foreground"}`}>
                {s === "New Order" ? "Pesanan\nBaru" : s === "Confirmed" ? "Konfirmasi" :
                 s === "Processing" ? "Diproses" : s === "Shipped" ? "Dikirim" : "Selesai"}
              </span>
            </div>
          );
        })}
      </div>
    </div>
  );
}

/* ─────────────────────────────────────────────── ProductFirstTimeline ─── */

const PF_STEPS = [
  { status: "New Order",                label: "Order Masuk",       icon: "📦" },
  { status: "Admin Review",             label: "Review Admin",      icon: "🔍" },
  { status: "Product RFQ Sent",         label: "RFQ Produk",        icon: "📤" },
  { status: "Product Quote Received",   label: "Quote Masuk",       icon: "💰" },
  { status: "Product Vendor Selected",  label: "Vendor Dipilih",    icon: "🏭" },
  { status: "Customer Product Approval",label: "Approval Customer", icon: "✅" },
  { status: "Shipment Selection Pending",label: "Pilih Kirim",      icon: "🚚" },
];

function ProductFirstTimeline({ status }: { status: string }) {
  if (status === "Cancelled") {
    return (
      <div className="flex items-center gap-2 px-1 py-3">
        <XCircle className="w-5 h-5 text-red-500 shrink-0" />
        <span className="text-sm font-medium text-red-600">Pesanan Dibatalkan</span>
      </div>
    );
  }

  const isEndStatus = ["Ready for Pickup", "Shipment RFQ Sent", "Completed", "Shipped"].includes(status);
  const steps = [...PF_STEPS];
  if (isEndStatus) {
    const endLabel = status === "Ready for Pickup" ? "Siap Diambil" :
                     status === "Shipment RFQ Sent" ? "RFQ Pengiriman" :
                     status === "Completed" ? "Selesai" : "Dikirim";
    const endIcon = status === "Ready for Pickup" ? "📦" : status === "Completed" ? "✅" : "🚢";
    steps.push({ status, label: endLabel, icon: endIcon });
  }

  const currentIdx = steps.findIndex(s => s.status === status);

  return (
    <div className="overflow-x-auto">
      <div className="flex items-start gap-0 min-w-max px-1">
        {steps.map((step, idx) => {
          const done = idx < currentIdx;
          const active = idx === currentIdx;
          return (
            <div key={step.status} className="flex items-center">
              <div className="flex flex-col items-center gap-1 w-16">
                <div className={`w-8 h-8 rounded-full border-2 flex items-center justify-center text-sm z-10 transition-all ${
                  done   ? "bg-primary border-primary shadow-sm" :
                  active ? "bg-primary/10 border-primary shadow-sm ring-2 ring-primary/20" :
                           "bg-background border-muted-foreground/30"
                }`}>
                  {done ? <CheckCircle2 className="w-3.5 h-3.5 text-primary-foreground" /> :
                   active ? <span className="text-xs">{step.icon}</span> :
                   <span className="text-xs opacity-40">{step.icon}</span>}
                </div>
                <span className={`text-[9px] text-center leading-tight ${done || active ? "font-semibold text-foreground" : "text-muted-foreground/60"}`}>
                  {step.label}
                </span>
              </div>
              {idx < steps.length - 1 && (
                <div className={`w-4 h-0.5 mb-4 shrink-0 ${done ? "bg-primary" : "bg-muted"}`} />
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

/* ─────────────────────────────────────────────── QuickActions (standard) ─── */

function QuickActions({ order, updating, onStatus }: { order: PortalProductOrder; updating: boolean; onStatus: (status: string) => void }) {
  const status = order.status as OrderStatus;
  const next = NEXT_STATUS[status];
  const nextLabel = NEXT_LABEL[status];
  const canCancel = status !== "Completed" && status !== "Cancelled";

  if (status === "Completed") {
    return <div className="flex items-center gap-2 text-sm text-green-600 font-medium"><CheckCircle2 className="w-4 h-4" /> Pesanan telah selesai</div>;
  }
  if (status === "Cancelled") {
    return <Button variant="outline" size="sm" disabled={updating} onClick={() => onStatus("New Order")}>Aktifkan Kembali</Button>;
  }
  return (
    <div className="flex flex-wrap gap-2">
      {next && nextLabel && (
        <Button size="sm" disabled={updating} onClick={() => onStatus(next)} className="gap-1.5">
          {updating ? <Loader2 className="w-4 h-4 animate-spin" /> : <ChevronRight className="w-4 h-4" />}
          {nextLabel}
        </Button>
      )}
      {canCancel && (
        <Button size="sm" variant="outline" disabled={updating}
          onClick={() => { if (confirm(`Batalkan pesanan ${order.orderNumber}?`)) onStatus("Cancelled"); }}
          className="gap-1.5 text-destructive hover:text-destructive border-destructive/30 hover:bg-destructive/5"
        >
          <XCircle className="w-4 h-4" /> Batalkan
        </Button>
      )}
    </div>
  );
}

/* ─────────────────────────────────────────────── ProductPhasePanel ─── */

interface ProductPhasePanelProps {
  order: ExtOrder;
  orderId: number;
  onRefresh: () => void;
}

function ProductPhasePanel({ order, orderId, onRefresh }: ProductPhasePanelProps) {
  const { toast } = useToast();
  const [editing, setEditing] = useState(false);
  const [saving, setSaving] = useState(false);
  const [form, setForm] = useState({
    vendorName: order.vendorNameSelected ?? "",
    quotedPrice: order.vendorQuotedPrice != null ? String(order.vendorQuotedPrice) : "",
    readyDate: order.readyDate ?? "",
    pickupLocation: order.pickupLocation ?? "",
  });

  useEffect(() => {
    setForm({
      vendorName: order.vendorNameSelected ?? "",
      quotedPrice: order.vendorQuotedPrice != null ? String(order.vendorQuotedPrice) : "",
      readyDate: order.readyDate ?? "",
      pickupLocation: order.pickupLocation ?? "",
    });
  }, [order.vendorNameSelected, order.vendorQuotedPrice, order.readyDate, order.pickupLocation]);

  const handleSave = async (selectVendor = false) => {
    setSaving(true);
    try {
      const res = await fetch(`/api/portal-product/admin/orders/${orderId}/update-product-phase`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          vendorName: form.vendorName || null,
          quotedPrice: form.quotedPrice ? parseFloat(form.quotedPrice) : null,
          readyDate: form.readyDate || null,
          pickupLocation: form.pickupLocation || null,
          selectVendor,
        }),
      });
      const d = await res.json() as { success?: boolean; error?: string; status?: string | null };
      if (!res.ok) throw new Error(d.error ?? "Gagal");
      toast({ title: selectVendor ? "Vendor dipilih ✅" : "Data fase produk disimpan ✅" });
      setEditing(false);
      onRefresh();
    } catch (e: unknown) {
      toast({ title: (e as Error).message ?? "Gagal", variant: "destructive" });
    } finally { setSaving(false); }
  };

  const pf = order as ExtOrder;
  const hasData = pf.vendorNameSelected || pf.vendorQuotedPrice || pf.readyDate || pf.pickupLocation;

  return (
    <div className="border rounded-lg overflow-hidden">
      <div className="flex items-center justify-between px-3 py-2 bg-violet-50 border-b border-violet-100">
        <div className="flex items-center gap-2">
          <Factory className="w-3.5 h-3.5 text-violet-600" />
          <p className="text-xs font-semibold text-violet-800 uppercase tracking-wide">Fase Produk</p>
        </div>
        {!editing && (
          <Button size="sm" variant="ghost" className="h-6 px-2 text-xs text-violet-700 hover:bg-violet-100"
            onClick={() => setEditing(true)}>
            Edit
          </Button>
        )}
      </div>

      {editing ? (
        <div className="p-3 space-y-3">
          <div className="grid grid-cols-2 gap-3">
            <div className="col-span-2">
              <p className="text-[10px] text-muted-foreground mb-1">Nama Vendor Produk *</p>
              <Input className="h-8 text-xs" placeholder="PT. Supplier ABC..." value={form.vendorName}
                onChange={e => setForm(f => ({ ...f, vendorName: e.target.value }))} />
            </div>
            <div>
              <p className="text-[10px] text-muted-foreground mb-1">Harga Produk (Rp)</p>
              <Input className="h-8 text-xs" type="number" placeholder="5000000" value={form.quotedPrice}
                onChange={e => setForm(f => ({ ...f, quotedPrice: e.target.value }))} />
            </div>
            <div>
              <p className="text-[10px] text-muted-foreground mb-1">Ready Date *</p>
              <Input className="h-8 text-xs" placeholder="3 Jan 2026 / 2026-01-03" value={form.readyDate}
                onChange={e => setForm(f => ({ ...f, readyDate: e.target.value }))} />
            </div>
            <div className="col-span-2">
              <p className="text-[10px] text-muted-foreground mb-1">Lokasi Pickup *</p>
              <Input className="h-8 text-xs" placeholder="Gudang vendor di Jl. ..." value={form.pickupLocation}
                onChange={e => setForm(f => ({ ...f, pickupLocation: e.target.value }))} />
            </div>
          </div>
          <div className="flex gap-2 flex-wrap">
            <Button size="sm" variant="outline" className="gap-1 h-7 text-xs" disabled={saving}
              onClick={() => handleSave(false)}>
              {saving ? <Loader2 className="w-3 h-3 animate-spin" /> : null} Simpan Data
            </Button>
            <Button size="sm" className="gap-1 h-7 text-xs bg-violet-600 hover:bg-violet-700" disabled={saving || !form.vendorName}
              onClick={() => handleSave(true)}>
              {saving ? <Loader2 className="w-3 h-3 animate-spin" /> : <Factory className="w-3 h-3" />}
              Simpan & Pilih Vendor
            </Button>
            <Button size="sm" variant="ghost" className="h-7 text-xs" onClick={() => setEditing(false)}>
              Batal
            </Button>
          </div>
        </div>
      ) : (
        <div className="p-3">
          {!hasData ? (
            <p className="text-xs text-muted-foreground italic">Belum ada data vendor produk</p>
          ) : (
            <div className="grid grid-cols-2 gap-x-4 gap-y-2">
              {pf.vendorNameSelected && (
                <div className="col-span-2 flex items-start gap-2">
                  <Factory className="w-3.5 h-3.5 text-violet-500 mt-0.5 shrink-0" />
                  <div>
                    <p className="text-[10px] text-muted-foreground">Vendor Produk</p>
                    <p className="text-xs font-semibold">{pf.vendorNameSelected}</p>
                  </div>
                </div>
              )}
              {pf.vendorQuotedPrice != null && (
                <div className="flex items-start gap-2">
                  <DollarSign className="w-3.5 h-3.5 text-green-500 mt-0.5 shrink-0" />
                  <div>
                    <p className="text-[10px] text-muted-foreground">Harga Produk</p>
                    <p className="text-xs font-semibold">{idr(pf.vendorQuotedPrice)}</p>
                  </div>
                </div>
              )}
              {pf.readyDate && (
                <div className="flex items-start gap-2">
                  <Calendar className="w-3.5 h-3.5 text-blue-500 mt-0.5 shrink-0" />
                  <div>
                    <p className="text-[10px] text-muted-foreground">Ready Date</p>
                    <p className="text-xs font-medium">{pf.readyDate}</p>
                  </div>
                </div>
              )}
              {pf.pickupLocation && (
                <div className="col-span-2 flex items-start gap-2">
                  <MapPin className="w-3.5 h-3.5 text-orange-500 mt-0.5 shrink-0" />
                  <div>
                    <p className="text-[10px] text-muted-foreground">Lokasi Pickup</p>
                    <p className="text-xs font-medium">{pf.pickupLocation}</p>
                  </div>
                </div>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

/* ─────────────────────────────────────────────── ShipmentPhasePanel ─── */

function ShipmentPhasePanel({ order }: { order: ExtOrder }) {
  const pf = order as ExtOrder;
  const shipmentStatuses = [
    "Shipment Selection Pending", "Ready for Pickup", "Shipment RFQ Sent",
    "Confirmed", "Processing", "Shipped", "Completed",
  ];
  const isInShipmentPhase = shipmentStatuses.includes(pf.status ?? "");
  if (!isInShipmentPhase && !pf.shipmentMode) return null;

  const mode = pf.shipmentMode;
  const modeLabel = mode ? (SHIPMENT_MODE_LABELS[mode] ?? mode) : null;

  return (
    <div className="border rounded-lg overflow-hidden">
      <div className="flex items-center gap-2 px-3 py-2 bg-blue-50 border-b border-blue-100">
        <Truck className="w-3.5 h-3.5 text-blue-600" />
        <p className="text-xs font-semibold text-blue-800 uppercase tracking-wide">Fase Pengiriman</p>
      </div>
      <div className="p-3">
        {!mode ? (
          <p className="text-xs text-muted-foreground italic">Mode pengiriman belum dipilih customer</p>
        ) : (
          <div className="grid grid-cols-2 gap-x-4 gap-y-2">
            <div className="col-span-2 flex items-start gap-2">
              <Truck className="w-3.5 h-3.5 text-blue-500 mt-0.5 shrink-0" />
              <div>
                <p className="text-[10px] text-muted-foreground">Mode Pengiriman</p>
                <p className="text-xs font-semibold">{modeLabel}</p>
              </div>
            </div>
            {pf.status && (
              <div className="col-span-2 flex items-start gap-2">
                <Radio className="w-3.5 h-3.5 text-teal-500 mt-0.5 shrink-0" />
                <div>
                  <p className="text-[10px] text-muted-foreground">Status Pengiriman</p>
                  <Badge className={`text-[10px] h-4 ${STATUS_COLORS[pf.status] ?? "bg-gray-100"}`}>
                    {pf.status}
                  </Badge>
                </div>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

/* ─────────────────────────────────────────────── ProductFirstActions ─── */

interface ProductFirstActionsProps {
  order: ExtOrder;
  orderId: number;
  onRefresh: () => void;
  onStatusChange: (status: string) => void;
}

function ProductFirstActions({ order, orderId, onRefresh, onStatusChange }: ProductFirstActionsProps) {
  const { toast } = useToast();
  const [loading, setLoading] = useState<string | null>(null);
  const [customMsg, setCustomMsg] = useState("");
  const [showCustomMsg, setShowCustomMsg] = useState(false);

  const pf = order as ExtOrder;
  const status = pf.status ?? "";
  const approveToken = pf.productApproveToken;
  const domain = window.location.hostname;
  const baseUrl = `${window.location.protocol}//${window.location.host.replace("18442", "23434").replace(/:\d+/, "")}`;

  const shipmentSelectionUrl = approveToken ? `${baseUrl}/shipment-selection/${approveToken}` : null;

  const guardIssues: string[] = [];
  if (!pf.vendorNameSelected) guardIssues.push("Vendor produk belum dipilih (isi di Fase Produk)");
  if (!pf.readyDate) guardIssues.push("Ready date belum diisi (isi di Fase Produk)");
  if (!pf.pickupLocation) guardIssues.push("Lokasi pickup belum diisi (isi di Fase Produk)");
  if (!pf.shipmentMode) guardIssues.push("Mode pengiriman belum dipilih customer");
  if (pf.shipmentMode === "pickup_self") guardIssues.push("Mode 'Ambil Sendiri' — gunakan 'Mark Siap Ambil'");

  async function adminAction(endpoint: string, label: string, body?: Record<string, unknown>) {
    setLoading(endpoint);
    try {
      const res = await fetch(`/api/portal-product/admin/orders/${orderId}/${endpoint}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: body ? JSON.stringify(body) : undefined,
      });
      const d = await res.json() as { success?: boolean; error?: string; status?: string; missing?: string[] };
      if (!res.ok) {
        const missing = d.missing?.join(", ");
        throw new Error(missing ? `${d.error}: ${missing}` : (d.error ?? "Gagal"));
      }
      toast({ title: `${label} ✅` });
      onRefresh();
    } catch (e: unknown) {
      toast({ title: (e as Error).message ?? "Gagal", variant: "destructive" });
    } finally { setLoading(null); }
  }

  function Btn({ endpoint, label, icon, variant = "default", disabled = false, className = "" }: {
    endpoint: string; label: string; icon: React.ReactNode;
    variant?: "default" | "outline" | "destructive" | "secondary";
    disabled?: boolean; className?: string;
  }) {
    const isLoading = loading === endpoint;
    return (
      <Button size="sm" variant={variant} disabled={disabled || isLoading || !!loading}
        className={`gap-1.5 h-8 text-xs ${className}`}
        onClick={() => adminAction(endpoint, label)}>
        {isLoading ? <Loader2 className="w-3 h-3 animate-spin" /> : icon}
        {label}
      </Button>
    );
  }

  return (
    <div className="border rounded-lg overflow-hidden">
      <div className="flex items-center gap-2 px-3 py-2 bg-amber-50 border-b border-amber-100">
        <Navigation className="w-3.5 h-3.5 text-amber-600" />
        <p className="text-xs font-semibold text-amber-800 uppercase tracking-wide">Aksi Admin — Product First</p>
      </div>
      <div className="p-3 space-y-3">

        {/* Admin Review → blast product RFQ */}
        {status === "Admin Review" && (
          <div className="space-y-1.5">
            <p className="text-[10px] text-muted-foreground font-semibold">Status: Admin Review</p>
            <Btn endpoint="blast-product-rfq" label="Blast Product RFQ" icon={<Send className="w-3 h-3" />} className="bg-cyan-600 hover:bg-cyan-700" />
          </div>
        )}

        {/* Product Quote Received → input vendor quote + select vendor */}
        {(status === "Product Quote Received" || status === "Product RFQ Sent") && (
          <div className="space-y-1.5">
            <p className="text-[10px] text-muted-foreground font-semibold">Status: {status}</p>
            <p className="text-xs text-muted-foreground">Isi data vendor di seksi "Fase Produk" di atas, lalu klik "Simpan & Pilih Vendor".</p>
          </div>
        )}

        {/* Product Vendor Selected → send customer approval */}
        {(status === "Product Vendor Selected" || status === "Customer Product Approval") && (
          <div className="space-y-1.5">
            <p className="text-[10px] text-muted-foreground font-semibold">Status: {status}</p>
            <Btn endpoint="send-product-approval" label="Kirim Approval ke Customer" icon={<Send className="w-3 h-3" />} />
          </div>
        )}

        {/* Shipment Selection Pending → reminder + open link + blast shipment RFQ / pickup */}
        {status === "Shipment Selection Pending" && (
          <div className="space-y-2">
            <p className="text-[10px] text-muted-foreground font-semibold">Status: Shipment Selection Pending</p>
            <div className="flex flex-wrap gap-2">
              {shipmentSelectionUrl && (
                <Button size="sm" variant="outline" className="gap-1.5 h-8 text-xs"
                  onClick={() => window.open(shipmentSelectionUrl, "_blank")}>
                  <ExternalLink className="w-3 h-3" /> Buka Link Pilih Kirim
                </Button>
              )}
              <Btn endpoint="send-shipment-reminder" label="Kirim Reminder WA" icon={<Bell className="w-3 h-3" />} variant="outline" />
            </div>
          </div>
        )}

        {/* After customer picks: pickup_self → mark ready + WA; others → blast shipment RFQ */}
        {(status === "Ready for Pickup" || (pf.shipmentMode === "pickup_self" && status === "Shipment Selection Pending")) && (
          <div className="space-y-2">
            {status !== "Ready for Pickup" && (
              <Btn endpoint="mark-ready-pickup" label="Tandai Siap Ambil" icon={<Package2 className="w-3 h-3" />} className="bg-emerald-600 hover:bg-emerald-700" />
            )}
            <div className="flex flex-wrap gap-2">
              <Button size="sm" variant="outline" className="gap-1.5 h-8 text-xs"
                onClick={() => setShowCustomMsg(v => !v)}>
                <Send className="w-3 h-3" /> Kirim Instruksi Pickup WA
              </Button>
            </div>
            {showCustomMsg && (
              <div className="space-y-2">
                <Textarea className="text-xs h-20" placeholder="Pesan kustom... (kosongkan untuk pesan default)"
                  value={customMsg} onChange={e => setCustomMsg(e.target.value)} />
                <Button size="sm" className="h-7 text-xs gap-1" disabled={!!loading}
                  onClick={() => adminAction("send-pickup-instruction", "Instruksi Pickup terkirim", customMsg ? { customMessage: customMsg } : {})}>
                  {loading === "send-pickup-instruction" ? <Loader2 className="w-3 h-3 animate-spin" /> : <Send className="w-3 h-3" />}
                  Kirim
                </Button>
              </div>
            )}
          </div>
        )}

        {/* After customer picks non-pickup mode → blast shipment RFQ */}
        {pf.shipmentMode && pf.shipmentMode !== "pickup_self" && (status === "Shipment RFQ Sent" || status === "Shipment Selection Pending") && (
          <div className="space-y-2">
            <p className="text-[10px] text-muted-foreground font-semibold">Mode: {SHIPMENT_MODE_LABELS[pf.shipmentMode] ?? pf.shipmentMode}</p>
            {guardIssues.filter(g => !g.includes("Mode 'Ambil Sendiri'") && !g.includes("belum dipilih customer")).length > 0 ? (
              <div className="rounded-lg border border-amber-200 bg-amber-50 p-2 space-y-1">
                <p className="text-[10px] font-semibold text-amber-700 flex items-center gap-1">
                  <AlertTriangle className="w-3 h-3" /> Data kurang untuk Blast Shipment RFQ:
                </p>
                {guardIssues.filter(g => !g.includes("Mode 'Ambil Sendiri'") && !g.includes("belum dipilih customer")).map(g => (
                  <p key={g} className="text-[10px] text-amber-700 pl-4">• {g}</p>
                ))}
              </div>
            ) : (
              <Btn endpoint="blast-shipment-rfq" label="Blast Shipment RFQ" icon={<Truck className="w-3 h-3" />}
                className="bg-pink-600 hover:bg-pink-700"
                disabled={guardIssues.filter(g => !g.includes("Mode 'Ambil Sendiri'") && !g.includes("belum dipilih customer")).length > 0} />
            )}
          </div>
        )}

        {/* Always show cancel button */}
        {!["Completed", "Cancelled"].includes(status) && (
          <div className="pt-1 border-t">
            <Button size="sm" variant="ghost" className="h-7 text-xs gap-1 text-destructive hover:text-destructive hover:bg-destructive/10"
              onClick={() => { if (confirm("Batalkan pesanan ini?")) onStatusChange("Cancelled"); }}>
              <XCircle className="w-3 h-3" /> Batalkan Pesanan
            </Button>
          </div>
        )}
        {status === "Cancelled" && (
          <Button size="sm" variant="outline" className="h-7 text-xs" onClick={() => onStatusChange("New Order")}>
            Aktifkan Kembali
          </Button>
        )}
      </div>
    </div>
  );
}

/* ─────────────────────────────────────────────── TemplateDataPanel ─── */

function TemplateDataPanel({ order }: { order: ExtOrder }) {
  const category = order.productCategory ?? "general";
  const [resolvedTemplate, setResolvedTemplate] = useState<ProductTemplate | null>(null);
  const [showDefinition, setShowDefinition] = useState(false);

  useEffect(() => {
    let active = true;
    fetch(`/api/product-templates/${category}`)
      .then((r) => r.ok ? r.json() : null)
      .then((data) => { if (active && data) setResolvedTemplate(data as ProductTemplate); })
      .catch(() => {});
    return () => { active = false; };
  }, [category]);

  const template: ProductTemplate = resolvedTemplate ?? getTemplate(category);
  const customFields = order.customFieldValues ?? {};
  const docs = order.uploadedDocuments ?? [];
  const checklist = order.checklistStatus ?? {};
  const catLabel = CATEGORY_LABELS[category] ?? category;

  const hasAnyData =
    Object.keys(customFields).length > 0 ||
    docs.length > 0 ||
    Object.keys(checklist).length > 0;

  if (!hasAnyData && !order.productCategory) return null;

  const checklistDone = template.checklist.filter((c) => checklist[c.key]).length;
  const knownFieldKeys = new Set(template.customFields.map((f) => f.key));
  const unknownEntries = Object.entries(customFields).filter(([k]) => !knownFieldKeys.has(k));
  const versionMismatch =
    order.templateVersion && resolvedTemplate && order.templateVersion !== resolvedTemplate.version;

  return (
    <div className="space-y-4">
      <Separator />
      <div>
        <div className="flex items-center gap-2 mb-4 flex-wrap">
          <Tag className="w-3.5 h-3.5 text-primary" />
          <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">Data Template Komoditas</p>
          <Badge variant="secondary" className="text-[10px] h-4">{catLabel}</Badge>
          {order.templateVersion && <span className="text-[10px] text-muted-foreground">Dikirim: v{order.templateVersion}</span>}
          {resolvedTemplate && <span className="text-[10px] text-muted-foreground">· Aktif: v{resolvedTemplate.version}</span>}
          {versionMismatch && (
            <Badge variant="outline" className="text-[10px] h-4 border-amber-400 text-amber-700 bg-amber-50 gap-1">
              <AlertTriangle className="w-2.5 h-2.5" /> Versi berbeda
            </Badge>
          )}
          {unknownEntries.length > 0 && (
            <Badge variant="outline" className="text-[10px] h-4 border-orange-400 text-orange-700 bg-orange-50 gap-1">
              <AlertTriangle className="w-2.5 h-2.5" /> {unknownEntries.length} field di luar template
            </Badge>
          )}
        </div>

        <div className="space-y-4">
          {Object.keys(customFields).length > 0 && (
            <div className="border rounded-lg p-3">
              <div className="flex items-center gap-1.5 mb-3">
                <Package className="w-3 h-3 text-primary" />
                <p className="text-xs font-semibold">Field Khusus</p>
              </div>
              <div className="grid grid-cols-2 gap-x-4 gap-y-2">
                {template.customFields
                  .filter((f) => customFields[f.key] !== undefined && customFields[f.key] !== "" && customFields[f.key] !== 0)
                  .map((f) => (
                    <div key={f.key} className={f.type === "textarea" ? "col-span-2" : ""}>
                      <p className="text-[10px] text-muted-foreground">{f.label}</p>
                      <p className="text-xs font-medium">
                        {String(customFields[f.key])}
                        {(f as any).unit && <span className="text-muted-foreground ml-1">{(f as any).unit}</span>}
                      </p>
                    </div>
                  ))}
                {unknownEntries.map(([key, val]) => (
                  <div key={key} className="col-span-2 rounded bg-amber-50 border border-amber-200 px-2 py-1.5">
                    <div className="flex items-center gap-1.5 mb-0.5">
                      <AlertTriangle className="w-3 h-3 text-amber-500 shrink-0" />
                      <p className="text-[10px] text-amber-700 font-medium">
                        {key}<span className="ml-1.5 font-normal text-amber-500">(di luar template saat ini)</span>
                      </p>
                    </div>
                    <p className="text-xs font-medium text-amber-900 pl-4.5">{String(val)}</p>
                  </div>
                ))}
              </div>
            </div>
          )}

          {docs.length > 0 && (
            <div className="border rounded-lg p-3">
              <div className="flex items-center gap-1.5 mb-3">
                <FileText className="w-3 h-3 text-primary" />
                <p className="text-xs font-semibold">Dokumen Tercatat</p>
              </div>
              <div className="space-y-2">
                {docs.map((doc) => (
                  <div key={doc.key} className="flex items-center justify-between text-xs">
                    <span className="text-muted-foreground">{doc.label}</span>
                    <span className="font-mono font-medium bg-muted px-1.5 py-0.5 rounded text-[10px]">{doc.reference}</span>
                  </div>
                ))}
              </div>
            </div>
          )}

          {template.checklist.length > 0 && (
            <div className="border rounded-lg p-3">
              <div className="flex items-center justify-between mb-3">
                <div className="flex items-center gap-1.5">
                  <ClipboardList className="w-3 h-3 text-primary" />
                  <p className="text-xs font-semibold">Checklist Persiapan</p>
                </div>
                <Badge variant={checklistDone === template.checklist.length ? "default" : "secondary"} className="text-[10px] h-4">
                  {checklistDone}/{template.checklist.length}
                </Badge>
              </div>
              <div className="space-y-1.5">
                {template.checklist.map((item) => (
                  <div key={item.key} className="flex items-center gap-2 text-xs">
                    {checklist[item.key] ? <CheckCircle2 className="w-3.5 h-3.5 text-green-500 shrink-0" /> : <Circle className="w-3.5 h-3.5 text-muted-foreground/40 shrink-0" />}
                    <span className={checklist[item.key] ? "text-foreground" : "text-muted-foreground"}>{item.label}</span>
                  </div>
                ))}
              </div>
            </div>
          )}

          {order.packagingNotes && (
            <div className="border rounded-lg p-3">
              <div className="flex items-center gap-1.5 mb-2">
                <Wrench className="w-3 h-3 text-primary" />
                <p className="text-xs font-semibold">Catatan Packaging</p>
              </div>
              <p className="text-xs text-muted-foreground">{order.packagingNotes}</p>
            </div>
          )}

          <div className="border rounded-lg overflow-hidden">
            <button type="button" onClick={() => setShowDefinition(v => !v)}
              className="w-full flex items-center justify-between px-3 py-2 text-left hover:bg-muted/50 transition-colors">
              <div className="flex items-center gap-1.5">
                <Eye className="w-3 h-3 text-primary" />
                <p className="text-xs font-semibold">Definisi Template Saat Ini</p>
                {resolvedTemplate
                  ? <Badge variant="outline" className="text-[10px] h-4 border-green-300 text-green-700 bg-green-50">DB resolved</Badge>
                  : <Badge variant="outline" className="text-[10px] h-4">in-code</Badge>}
              </div>
              {showDefinition ? <ChevronDown className="w-3.5 h-3.5 text-muted-foreground" /> : <ChevronRight className="w-3.5 h-3.5 text-muted-foreground" />}
            </button>

            {showDefinition && (
              <div className="border-t px-3 py-3 space-y-4 bg-muted/20">
                {template.customFields.length > 0 && (
                  <div>
                    <p className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wide mb-2">Field ({template.customFields.length})</p>
                    <div className="space-y-1">
                      {template.customFields.map((f) => {
                        const submitted = customFields[f.key];
                        const hasValue = submitted !== undefined && submitted !== "" && submitted !== 0;
                        return (
                          <div key={f.key} className="flex items-center gap-2 text-xs">
                            {hasValue ? <CheckCircle2 className="w-3 h-3 text-green-500 shrink-0" /> : <Circle className="w-3 h-3 text-muted-foreground/30 shrink-0" />}
                            <span className={hasValue ? "font-medium" : "text-muted-foreground"}>{f.label}</span>
                            <span className="text-[10px] text-muted-foreground/60 font-mono">{f.type}</span>
                            {f.required && <Badge variant="outline" className="text-[10px] h-3.5 px-1 py-0 border-red-200 text-red-600">wajib</Badge>}
                          </div>
                        );
                      })}
                    </div>
                  </div>
                )}
                {template.requiredDocuments.length > 0 && (
                  <div>
                    <p className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wide mb-2">Dokumen yang Diminta ({template.requiredDocuments.length})</p>
                    <div className="space-y-1">
                      {template.requiredDocuments.map((d) => {
                        const submitted = docs.find((ud) => ud.key === d.key);
                        return (
                          <div key={d.key} className="flex items-center gap-2 text-xs">
                            {submitted ? <CheckCircle2 className="w-3 h-3 text-green-500 shrink-0" /> : <Circle className="w-3 h-3 text-muted-foreground/30 shrink-0" />}
                            <span className={submitted ? "font-medium" : "text-muted-foreground"}>{d.label}</span>
                            {d.required && <Badge variant="outline" className="text-[10px] h-3.5 px-1 py-0 border-red-200 text-red-600">wajib</Badge>}
                          </div>
                        );
                      })}
                    </div>
                  </div>
                )}
                {template.packagingInstructions && (
                  <div>
                    <p className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wide mb-1">Instruksi Packaging</p>
                    <p className="text-xs text-muted-foreground leading-relaxed">{template.packagingInstructions}</p>
                  </div>
                )}
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

/* ─────────────────────────────────────────────── Main Page ─── */

export default function PortalProductOrdersPage() {
  const queryClient = useQueryClient();
  const prefetchHover = usePrefetchOnHover();
  const { toast } = useToast();

  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState("all");
  const [detailOrderId, setDetailOrderId] = useState<number | null>(null);
  const [updatingId, setUpdatingId] = useState<number | null>(null);
  const [selectedIds, setSelectedIds] = useState<Set<number>>(new Set());
  const [bulkDeleting, setBulkDeleting] = useState(false);
  const [linkingItemId, setLinkingItemId] = useState<number | null>(null);
  const [confirmingPaymentId, setConfirmingPaymentId] = useState<number | null>(null);
  const [resendingInvoiceId, setResendingInvoiceId] = useState<number | null>(null);
  const [showAssignDriver, setShowAssignDriver] = useState(false);
  const [assigningDriver, setAssigningDriver] = useState(false);
  const [driverJob, setDriverJob] = useState<Record<string, unknown> | null>(null);
  const [driverList, setDriverList] = useState<{ id: number; name: string; phone: string | null; vehiclePlate: string | null; vehicleType: string | null }[]>([]);
  const [driverForm, setDriverForm] = useState({ driverId: "", driverNameOverride: "", driverPhoneOverride: "", vehiclePlateOverride: "", vehicleType: "", cargoDescription: "", pickupDateTime: "", deliveryDateTime: "" });

  const { data: orders = [], isLoading, refetch } = useListPortalProductOrders(
    { status: statusFilter !== "all" ? statusFilter : undefined, search: search || undefined },
    { query: { queryKey: [...getListPortalProductOrdersQueryKey(), statusFilter, search] } },
  );

  const { data: detail, refetch: refetchDetail } = useGetPortalProductOrder(
    detailOrderId ?? 0,
    { query: { enabled: !!detailOrderId, queryKey: [`portal-product-order-${detailOrderId ?? 0}`] } },
  );

  const { data: masterProducts = [] } = useListPortalProducts(
    {},
    { query: { queryKey: ["listPortalProductsAdmin"], staleTime: 60_000 } },
  );

  const updateStatus = useUpdatePortalProductOrderStatus();
  const deleteMut = useDeletePortalProductOrder();
  const linkItem = useLinkPortalProductOrderItem();

  const invalidate = useCallback(() => {
    queryClient.invalidateQueries({ queryKey: getListPortalProductOrdersQueryKey() });
  }, [queryClient]);

  useEffect(() => {
    if (!detailOrderId) { setDriverJob(null); setShowAssignDriver(false); return; }
    fetch(`/api/portal-product/orders/${detailOrderId}/driver`)
      .then((r) => r.json())
      .then((d: { job: Record<string, unknown> | null }) => setDriverJob(d.job))
      .catch(() => {});
    fetch("/api/portal-product/drivers")
      .then((r) => r.json())
      .then((d: { drivers: typeof driverList }) => setDriverList(d.drivers ?? []))
      .catch(() => {});
  }, [detailOrderId]);

  const filtered = orders.filter((o) => {
    if (!search) return true;
    const q = search.toLowerCase();
    return (
      o.orderNumber.toLowerCase().includes(q) ||
      o.customerName.toLowerCase().includes(q) ||
      o.email.toLowerCase().includes(q)
    );
  });

  const allSelected = filtered.length > 0 && filtered.every((o) => selectedIds.has(o.id));
  const toggleAll = () => { if (allSelected) setSelectedIds(new Set()); else setSelectedIds(new Set(filtered.map((o) => o.id))); };
  const toggleSelect = (id: number) => {
    setSelectedIds((prev) => { const next = new Set(prev); if (next.has(id)) next.delete(id); else next.add(id); return next; });
  };

  async function handleStatusChange(id: number, status: string) {
    setUpdatingId(id);
    try {
      await updateStatus.mutateAsync({ id, data: { status } });
      invalidate();
      if (detailOrderId === id) queryClient.invalidateQueries({ queryKey: [`portal-product-order-${id}`] });
      toast({ title: `Status diperbarui: ${status}` });
    } catch { toast({ title: "Gagal memperbarui status", variant: "destructive" }); }
    finally { setUpdatingId(null); }
  }

  async function handleDelete(id: number) {
    if (!confirm("Hapus pesanan ini? Tindakan ini tidak bisa dibatalkan.")) return;
    try {
      await deleteMut.mutateAsync({ id });
      invalidate();
      if (detailOrderId === id) setDetailOrderId(null);
      toast({ title: "Pesanan berhasil dihapus" });
    } catch { toast({ title: "Gagal menghapus pesanan", variant: "destructive" }); }
  }

  async function handleBulkDelete() {
    if (selectedIds.size === 0) return;
    if (!confirm(`Hapus ${selectedIds.size} pesanan terpilih?`)) return;
    setBulkDeleting(true);
    let success = 0; let failed = 0;
    for (const id of selectedIds) { try { await deleteMut.mutateAsync({ id }); success++; } catch { failed++; } }
    setBulkDeleting(false);
    setSelectedIds(new Set());
    invalidate();
    if (failed === 0) toast({ title: `${success} pesanan berhasil dihapus` });
    else toast({ title: `${success} berhasil, ${failed} gagal`, variant: "destructive" });
  }

  async function handleConfirmPayment(id: number) {
    if (!confirm("Konfirmasi pembayaran sudah diterima?")) return;
    setConfirmingPaymentId(id);
    try {
      const res = await fetch(`/api/portal-product/orders/${id}/confirm-payment`, { method: "POST" });
      if (!res.ok) throw new Error("Gagal");
      invalidate();
      queryClient.invalidateQueries({ queryKey: [`portal-product-order-${id}`] });
      toast({ title: "Pembayaran dikonfirmasi ✅" });
    } catch { toast({ title: "Gagal konfirmasi pembayaran", variant: "destructive" }); }
    finally { setConfirmingPaymentId(null); }
  }

  async function handleAssignDriver(id: number) {
    setAssigningDriver(true);
    try {
      const selected = driverList.find((d) => d.id.toString() === driverForm.driverId);
      const body = {
        ...(driverForm.driverId ? { driverId: parseInt(driverForm.driverId, 10) } : {}),
        driverNameOverride: driverForm.driverNameOverride || selected?.name || undefined,
        driverPhoneOverride: driverForm.driverPhoneOverride || selected?.phone || undefined,
        vehiclePlateOverride: driverForm.vehiclePlateOverride || selected?.vehiclePlate || undefined,
        vehicleType: driverForm.vehicleType || selected?.vehicleType || undefined,
        cargoDescription: driverForm.cargoDescription || undefined,
        pickupDateTime: driverForm.pickupDateTime || undefined,
        deliveryDateTime: driverForm.deliveryDateTime || undefined,
      };
      const res = await fetch(`/api/portal-product/orders/${id}/assign-driver`, {
        method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body),
      });
      const d = await res.json() as { jobNumber?: string; error?: string };
      if (!res.ok) throw new Error(d.error ?? "Gagal");
      toast({ title: `Driver ditugaskan ✅ — ${d.jobNumber}` });
      setShowAssignDriver(false);
      setDriverForm({ driverId: "", driverNameOverride: "", driverPhoneOverride: "", vehiclePlateOverride: "", vehicleType: "", cargoDescription: "", pickupDateTime: "", deliveryDateTime: "" });
      const dj = await fetch(`/api/portal-product/orders/${id}/driver`).then((r) => r.json()) as { job: Record<string, unknown> | null };
      setDriverJob(dj.job);
      invalidate();
    } catch (e: unknown) { toast({ title: (e as Error).message ?? "Gagal assign driver", variant: "destructive" }); }
    finally { setAssigningDriver(false); }
  }

  async function handleResendInvoice(id: number) {
    setResendingInvoiceId(id);
    try {
      const res = await fetch(`/api/portal-product/orders/${id}/resend-invoice`, { method: "POST" });
      const d = await res.json() as { invoiceUrl?: string; message?: string };
      if (!res.ok) throw new Error(d.message ?? "Gagal");
      toast({ title: "Invoice dikirim ulang via WA ✅", description: d.invoiceUrl ?? undefined });
    } catch (e: unknown) { toast({ title: (e as Error).message ?? "Gagal", variant: "destructive" }); }
    finally { setResendingInvoiceId(null); }
  }

  async function handleLinkItem(itemId: number, productId: number) {
    setLinkingItemId(itemId);
    try {
      await linkItem.mutateAsync({ itemId, data: { productId } });
      queryClient.invalidateQueries({ queryKey: [`portal-product-order-${detailOrderId ?? 0}`] });
      refetchDetail();
      toast({ title: "Master item berhasil diperbarui" });
    } catch { toast({ title: "Gagal memperbarui master item", variant: "destructive" }); }
    finally { setLinkingItemId(null); }
  }

  function refreshDetail() {
    invalidate();
    if (detailOrderId) queryClient.invalidateQueries({ queryKey: [`portal-product-order-${detailOrderId}`] });
  }

  const detailOrder = orders.find((o) => o.id === detailOrderId) ?? null;
  const extDetail = (detail ?? detailOrder) as ExtOrder | null;
  const isProductFirst = (extDetail as any)?.orderType === "product_first";

  return (
    <AppShell>
      <BackButton />
      <div className="space-y-6">
        {/* Header */}
        <div>
          <h1 className="text-2xl font-bold">Portal Order Produk</h1>
          <p className="text-muted-foreground text-sm mt-1">Kelola pesanan produk dari Customer Portal — konfirmasi, proses, dan selesaikan</p>
        </div>

        {/* Stats Grid */}
        <div className="grid grid-cols-3 sm:grid-cols-6 gap-3">
          {STATS_LIST.map(({ status, label }) => {
            const count = orders.filter((o) => o.status === status).length;
            const isActive = statusFilter === status;
            return (
              <Card key={status} className={`cursor-pointer hover:border-primary/50 transition-all ${isActive ? "border-primary bg-primary/5 shadow-sm" : ""}`}
                onClick={() => setStatusFilter(isActive ? "all" : status)}>
                <CardContent className="p-3 text-center">
                  <p className="text-[11px] text-muted-foreground leading-tight mb-1">{label}</p>
                  <p className={`text-xl font-bold ${isActive ? "text-primary" : ""}`}>{count}</p>
                </CardContent>
              </Card>
            );
          })}
        </div>

        {/* Product First stats (only if there are any) */}
        {orders.some(o => PRODUCT_FIRST_STATUSES.includes((o.status as any))) && (
          <div>
            <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-2">Product-First Orders</p>
            <div className="grid grid-cols-3 sm:grid-cols-6 gap-2">
              {PRODUCT_FIRST_STATS.map(({ status, label }) => {
                const count = orders.filter((o) => o.status === status).length;
                if (count === 0) return null;
                const isActive = statusFilter === status;
                return (
                  <Card key={status} className={`cursor-pointer hover:border-violet-400/50 transition-all ${isActive ? "border-violet-500 bg-violet-50 shadow-sm" : ""}`}
                    onClick={() => setStatusFilter(isActive ? "all" : status)}>
                    <CardContent className="p-2.5 text-center">
                      <p className="text-[10px] text-muted-foreground leading-tight mb-0.5">{label}</p>
                      <p className={`text-lg font-bold ${isActive ? "text-violet-700" : ""}`}>{count}</p>
                    </CardContent>
                  </Card>
                );
              })}
            </div>
          </div>
        )}

        {/* Bulk action bar */}
        {selectedIds.size > 0 && (
          <div className="flex items-center gap-3 px-4 py-2.5 bg-primary/10 border border-primary/20 rounded-lg">
            <span className="text-sm font-medium">{selectedIds.size} dipilih</span>
            <Button size="sm" variant="destructive" onClick={handleBulkDelete} disabled={bulkDeleting}>
              <Trash2 className="h-3.5 w-3.5 mr-1.5" />
              {bulkDeleting ? "Menghapus..." : "Hapus Terpilih"}
            </Button>
            <Button size="sm" variant="ghost" onClick={() => setSelectedIds(new Set())}>Batal</Button>
          </div>
        )}

        {/* Table Card */}
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="flex items-center gap-2 text-base">
              <Package className="w-4 h-4" />
              Daftar Pesanan
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="flex flex-col sm:flex-row gap-3 mb-4">
              <div className="relative flex-1">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
                <Input placeholder="Cari no. order, nama, email..." className="pl-9" value={search}
                  onChange={(e) => setSearch(e.target.value)} />
              </div>
              <Select value={statusFilter} onValueChange={setStatusFilter}>
                <SelectTrigger className="w-full sm:w-52">
                  <SelectValue placeholder="Semua Status" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">Semua Status</SelectItem>
                  <p className="px-2 pt-2 pb-1 text-[10px] font-semibold text-muted-foreground uppercase">Standard</p>
                  {STANDARD_STATUSES.map((s) => <SelectItem key={s} value={s}>{s}</SelectItem>)}
                  <p className="px-2 pt-2 pb-1 text-[10px] font-semibold text-muted-foreground uppercase">Product-First</p>
                  {PRODUCT_FIRST_STATUSES.map((s) => <SelectItem key={s} value={s}>{s}</SelectItem>)}
                </SelectContent>
              </Select>
              <Button variant="outline" size="icon" onClick={() => refetch()}>
                <RefreshCw className="w-4 h-4" />
              </Button>
            </div>

            {isLoading ? (
              <div className="py-12 text-center text-muted-foreground">
                <Loader2 className="w-6 h-6 animate-spin mx-auto mb-2 opacity-40" /> Memuat...
              </div>
            ) : filtered.length === 0 ? (
              <div className="py-12 text-center text-muted-foreground">
                <Package className="w-10 h-10 mx-auto mb-2 opacity-30" />
                <p>Belum ada pesanan produk</p>
              </div>
            ) : (
              <div className="overflow-x-auto">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead className="w-10"><Checkbox checked={allSelected} onCheckedChange={toggleAll} /></TableHead>
                      <TableHead>No. Order</TableHead>
                      <TableHead>Customer</TableHead>
                      <TableHead>Kategori</TableHead>
                      <TableHead>Total</TableHead>
                      <TableHead>Tanggal</TableHead>
                      <TableHead>Status</TableHead>
                      <TableHead className="w-16">Aksi</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {filtered.map((order) => {
                      const isUpdating = updatingId === order.id;
                      const extO = order as ExtOrder;
                      const isPF = extO.orderType === "product_first";
                      const next = !isPF ? NEXT_STATUS[order.status] : null;
                      const nextLabel = !isPF ? NEXT_LABEL[order.status] : null;
                      const cat = extO.productCategory;
                      return (
                        <TableRow key={order.id} className="cursor-pointer hover:bg-muted/50"
                          onClick={() => setDetailOrderId(order.id)}
                          {...prefetchHover(getGetPortalProductOrderQueryOptions(order.id))}>
                          <TableCell onClick={(e) => e.stopPropagation()}>
                            <Checkbox checked={selectedIds.has(order.id)} onCheckedChange={() => toggleSelect(order.id)} />
                          </TableCell>
                          <TableCell className="font-mono text-xs font-semibold">
                            {order.orderNumber}
                            {isPF && <Badge variant="outline" className="ml-1 text-[9px] h-3.5 border-violet-300 text-violet-700">PF</Badge>}
                          </TableCell>
                          <TableCell>
                            <div>
                              <p className="font-medium text-sm">{order.customerName}</p>
                              <p className="text-xs text-muted-foreground">{order.email}</p>
                            </div>
                          </TableCell>
                          <TableCell>
                            {cat ? (
                              <Badge variant="outline" className="text-[10px] gap-1">
                                <Tag className="w-2.5 h-2.5" />{CATEGORY_LABELS[cat] ?? cat}
                              </Badge>
                            ) : <span className="text-xs text-muted-foreground">—</span>}
                          </TableCell>
                          <TableCell className="font-semibold text-sm">{idr(order.grandTotal)}</TableCell>
                          <TableCell className="text-xs text-muted-foreground whitespace-nowrap">{formatTanggal(order.createdAt)}</TableCell>
                          <TableCell>
                            <Badge className={`text-xs gap-1 ${STATUS_COLORS[order.status] ?? "bg-gray-100 text-gray-700"}`}>
                              {STATUS_ICONS[order.status]}
                              {order.status}
                            </Badge>
                          </TableCell>
                          <TableCell onClick={(e) => e.stopPropagation()}>
                            <div className="flex items-center gap-1">
                              {next && nextLabel && (
                                <Button size="sm" variant="outline" className="h-7 text-xs px-2 whitespace-nowrap"
                                  disabled={isUpdating} title={nextLabel}
                                  onClick={() => handleStatusChange(order.id, next)}>
                                  {isUpdating ? <Loader2 className="h-3 w-3 animate-spin" /> : <ChevronRight className="h-3 w-3" />}
                                </Button>
                              )}
                              <Button size="sm" variant="ghost" className="h-7 w-7 p-0 text-destructive hover:text-destructive hover:bg-destructive/10"
                                title="Hapus" onClick={() => handleDelete(order.id)}>
                                <Trash2 className="h-3.5 w-3.5" />
                              </Button>
                            </div>
                          </TableCell>
                        </TableRow>
                      );
                    })}
                  </TableBody>
                </Table>
              </div>
            )}
          </CardContent>
        </Card>
      </div>

      {/* ── Detail Dialog ── */}
      {detailOrderId && detailOrder && (
        <Dialog open onOpenChange={() => setDetailOrderId(null)}>
          <DialogContent className="max-w-2xl max-h-[92vh] overflow-y-auto">
            <DialogHeader>
              <DialogTitle className="flex items-center gap-2 text-base">
                <Package className="w-4 h-4 text-primary" />
                Pesanan {detailOrder.orderNumber}
                <Badge className={`ml-1 text-xs gap-1 ${STATUS_COLORS[detailOrder.status] ?? "bg-gray-100"}`}>
                  {STATUS_ICONS[detailOrder.status]}
                  {detailOrder.status}
                </Badge>
                {isProductFirst && (
                  <Badge variant="outline" className="text-[10px] h-4 border-violet-400 text-violet-700 bg-violet-50 gap-1">
                    <Boxes className="w-2.5 h-2.5" /> Product-First
                  </Badge>
                )}
                {(detailOrder as any)?.templateSnapshot?.catalogSource === "catalog" && (
                  <Badge variant="outline" className="text-[10px] h-4 border-violet-400 text-violet-700 bg-violet-50 gap-1">
                    <Store className="w-2.5 h-2.5" /> Vendor Catalog
                  </Badge>
                )}
              </DialogTitle>
            </DialogHeader>

            <div className="space-y-5 text-sm">

              {/* Progress Bar */}
              <div className="bg-muted/30 border rounded-xl p-4">
                <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-4">Progress Status</p>
                <StatusTimeline status={detailOrder.status} orderType={(extDetail as any)?.orderType} />
              </div>

              {/* Quick Actions — standard orders only */}
              {!isProductFirst && (
                <div className="flex items-center justify-between flex-wrap gap-3 px-1">
                  <div>
                    <p className="text-xs text-muted-foreground mb-1">Tindakan Cepat</p>
                    <QuickActions
                      order={detailOrder}
                      updating={updatingId === detailOrder.id}
                      onStatus={(s) => handleStatusChange(detailOrder.id, s)}
                    />
                  </div>
                  <div className="flex items-center gap-2">
                    <p className="text-xs text-muted-foreground">Atau pilih status:</p>
                    <Select value={detailOrder.status} onValueChange={(v) => handleStatusChange(detailOrder.id, v)}
                      disabled={updatingId === detailOrder.id}>
                      <SelectTrigger className="h-8 w-40 text-xs"><SelectValue /></SelectTrigger>
                      <SelectContent>
                        {STANDARD_STATUSES.map((s) => <SelectItem key={s} value={s} className="text-xs">{s}</SelectItem>)}
                      </SelectContent>
                    </Select>
                  </div>
                </div>
              )}

              {/* Product-First Admin Actions */}
              {isProductFirst && extDetail && (
                <>
                  <ProductFirstActions
                    order={extDetail}
                    orderId={detailOrder.id}
                    onRefresh={refreshDetail}
                    onStatusChange={(s) => handleStatusChange(detailOrder.id, s)}
                  />

                  {/* Manual status override for product_first */}
                  <div className="flex items-center gap-2 px-1">
                    <p className="text-xs text-muted-foreground shrink-0">Override status:</p>
                    <Select value={detailOrder.status} onValueChange={(v) => handleStatusChange(detailOrder.id, v)}
                      disabled={updatingId === detailOrder.id}>
                      <SelectTrigger className="h-8 flex-1 text-xs"><SelectValue /></SelectTrigger>
                      <SelectContent>
                        {ALL_STATUS_OPTIONS.map((s) => <SelectItem key={s} value={s} className="text-xs">{s}</SelectItem>)}
                      </SelectContent>
                    </Select>
                  </div>
                </>
              )}

              <Separator />

              {/* Info Customer */}
              <div>
                <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-3">Informasi Customer</p>
                <div className="grid grid-cols-2 gap-x-6 gap-y-3">
                  <div className="flex items-start gap-2">
                    <User className="w-3.5 h-3.5 text-muted-foreground mt-0.5 shrink-0" />
                    <div><p className="text-[10px] text-muted-foreground">Customer</p><p className="font-medium">{detailOrder.customerName}</p></div>
                  </div>
                  <div className="flex items-start gap-2">
                    <Mail className="w-3.5 h-3.5 text-muted-foreground mt-0.5 shrink-0" />
                    <div><p className="text-[10px] text-muted-foreground">Email</p><p className="break-all">{detailOrder.email}</p></div>
                  </div>
                  <div className="flex items-start gap-2">
                    <Phone className="w-3.5 h-3.5 text-muted-foreground mt-0.5 shrink-0" />
                    <div><p className="text-[10px] text-muted-foreground">WhatsApp</p><p>{detailOrder.phone}</p></div>
                  </div>
                  <div className="flex items-start gap-2">
                    <Clock className="w-3.5 h-3.5 text-muted-foreground mt-0.5 shrink-0" />
                    <div><p className="text-[10px] text-muted-foreground">Tanggal Order</p><p>{formatTanggal(detailOrder.createdAt)}</p></div>
                  </div>
                  <div className="col-span-2 flex items-start gap-2">
                    <MapPin className="w-3.5 h-3.5 text-muted-foreground mt-0.5 shrink-0" />
                    <div><p className="text-[10px] text-muted-foreground">Alamat Pengiriman</p><p>{detailOrder.shippingAddress}</p></div>
                  </div>
                  {detailOrder.notes && (
                    <div className="col-span-2 flex items-start gap-2">
                      <StickyNote className="w-3.5 h-3.5 text-muted-foreground mt-0.5 shrink-0" />
                      <div><p className="text-[10px] text-muted-foreground">Catatan</p><p className="text-muted-foreground italic">{detailOrder.notes}</p></div>
                    </div>
                  )}
                </div>
              </div>

              {/* Product Phase Panel (product_first only) */}
              {isProductFirst && extDetail && (
                <ProductPhasePanel order={extDetail} orderId={detailOrder.id} onRefresh={refreshDetail} />
              )}

              {/* Shipment Phase Panel (product_first only) */}
              {isProductFirst && extDetail && (
                <ShipmentPhasePanel order={extDetail} />
              )}

              {/* Template Data Panel */}
              <TemplateDataPanel order={extDetail ?? (detailOrder as ExtOrder)} />

              <Separator />

              {/* Item Table */}
              <div>
                <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-3">Item Pesanan</p>
                {detail?.items ? (
                  detail.items.length === 0 ? (
                    <p className="text-muted-foreground text-xs py-3">Tidak ada item</p>
                  ) : (
                    <div className="border rounded-lg overflow-hidden">
                      <table className="w-full text-xs">
                        <thead className="bg-muted">
                          <tr>
                            <th className="text-left px-3 py-2">Produk (dari Portal)</th>
                            <th className="text-left px-3 py-2 w-44">Link Master Item</th>
                            <th className="text-center px-3 py-2 w-16">Qty</th>
                            <th className="text-right px-3 py-2 w-24">Harga</th>
                            <th className="text-right px-3 py-2 w-24">Subtotal</th>
                          </tr>
                        </thead>
                        <tbody>
                          {detail.items.map((item) => (
                            <tr key={item.id} className="border-t align-top">
                              <td className="px-3 py-2">
                                <p className="font-medium">{item.productName}</p>
                                {item.productSku && <p className="text-muted-foreground">{item.productSku}</p>}
                              </td>
                              <td className="px-3 py-2">
                                <Select value={item.productId?.toString() ?? ""}
                                  onValueChange={(v) => handleLinkItem(item.id, parseInt(v, 10))}
                                  disabled={linkingItemId === item.id}>
                                  <SelectTrigger className="h-7 text-xs w-full"><SelectValue placeholder="Pilih master..." /></SelectTrigger>
                                  <SelectContent>
                                    {masterProducts.map((p) => (
                                      <SelectItem key={p.id} value={p.id.toString()} className="text-xs">
                                        {p.name} {p.sku ? `(${p.sku})` : ""}
                                      </SelectItem>
                                    ))}
                                  </SelectContent>
                                </Select>
                                {item.productId
                                  ? <p className="text-[10px] text-green-600 mt-0.5">✓ Terhubung ke master</p>
                                  : <p className="text-[10px] text-amber-500 mt-0.5 flex items-center gap-0.5"><AlertTriangle className="w-2.5 h-2.5" /> Belum terhubung</p>}
                              </td>
                              <td className="px-3 py-2 text-center">{item.qty} {item.unit ?? "pcs"}</td>
                              <td className="px-3 py-2 text-right">{idr(item.unitPrice)}</td>
                              <td className="px-3 py-2 text-right font-semibold">{idr(item.subtotal)}</td>
                            </tr>
                          ))}
                        </tbody>
                        <tfoot className="bg-muted/50">
                          <tr>
                            <td colSpan={4} className="px-3 py-2 text-right font-bold">Grand Total</td>
                            <td className="px-3 py-2 text-right font-bold text-primary">{idr(detailOrder.grandTotal)}</td>
                          </tr>
                        </tfoot>
                      </table>
                    </div>
                  )
                ) : (
                  <div className="py-4 text-center text-muted-foreground text-xs">
                    <Loader2 className="w-4 h-4 animate-spin mx-auto mb-1 opacity-40" /> Memuat item...
                  </div>
                )}
              </div>

              {/* Driver Assignment */}
              <Separator />
              <div>
                <div className="flex items-center justify-between mb-3">
                  <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">Penugasan Driver</p>
                  {!driverJob && (
                    <Button size="sm" variant="outline" className="h-7 text-xs gap-1"
                      onClick={() => setShowAssignDriver(v => !v)}>
                      <Truck className="w-3 h-3" /> {showAssignDriver ? "Tutup" : "Tugaskan Driver"}
                    </Button>
                  )}
                </div>

                {driverJob ? (
                  <div className="rounded-lg bg-muted/50 border px-3 py-2 text-xs space-y-0.5">
                    <p className="font-medium">Driver: {String(driverJob.driverName ?? driverJob.driverNameOverride ?? "—")}</p>
                    {!!driverJob.vehiclePlate && <p className="text-muted-foreground">Plat: {String(driverJob.vehiclePlate)}</p>}
                    <p className="font-mono text-[10px] text-muted-foreground">Job: {String(driverJob.jobNumber)}</p>
                  </div>
                ) : !showAssignDriver ? (
                  <p className="text-xs text-muted-foreground italic">Belum ada driver ditugaskan</p>
                ) : null}

                {showAssignDriver && !driverJob && (
                  <div className="border rounded-lg p-4 space-y-3 mt-2">
                    <div className="grid grid-cols-2 gap-3">
                      <div className="col-span-2">
                        <p className="text-[10px] text-muted-foreground mb-1">Driver (sistem)</p>
                        <Select value={driverForm.driverId || "none"} onValueChange={(v) => setDriverForm((f) => ({ ...f, driverId: v === "none" ? "" : v }))}>
                          <SelectTrigger className="h-8 text-xs"><SelectValue placeholder="Pilih driver..." /></SelectTrigger>
                          <SelectContent>
                            <SelectItem value="none" className="text-xs">— Tidak ada / manual —</SelectItem>
                            {driverList.map((d) => (
                              <SelectItem key={d.id} value={d.id.toString()} className="text-xs">
                                {d.name} {d.vehiclePlate ? `(${d.vehiclePlate})` : ""}
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      </div>
                      <div>
                        <p className="text-[10px] text-muted-foreground mb-1">Nama Driver (override)</p>
                        <Input className="h-8 text-xs" placeholder="Nama driver..." value={driverForm.driverNameOverride}
                          onChange={(e) => setDriverForm((f) => ({ ...f, driverNameOverride: e.target.value }))} />
                      </div>
                      <div>
                        <p className="text-[10px] text-muted-foreground mb-1">Telepon Driver</p>
                        <Input className="h-8 text-xs" placeholder="08xx..." value={driverForm.driverPhoneOverride}
                          onChange={(e) => setDriverForm((f) => ({ ...f, driverPhoneOverride: e.target.value }))} />
                      </div>
                      <div>
                        <p className="text-[10px] text-muted-foreground mb-1">Plat Kendaraan</p>
                        <Input className="h-8 text-xs" placeholder="B 1234 XX" value={driverForm.vehiclePlateOverride}
                          onChange={(e) => setDriverForm((f) => ({ ...f, vehiclePlateOverride: e.target.value }))} />
                      </div>
                      <div>
                        <p className="text-[10px] text-muted-foreground mb-1">Jenis Kendaraan</p>
                        <Input className="h-8 text-xs" placeholder="Truk, Pickup..." value={driverForm.vehicleType}
                          onChange={(e) => setDriverForm((f) => ({ ...f, vehicleType: e.target.value }))} />
                      </div>
                      <div className="col-span-2">
                        <p className="text-[10px] text-muted-foreground mb-1">Deskripsi Muatan</p>
                        <Input className="h-8 text-xs" placeholder="Barang..." value={driverForm.cargoDescription}
                          onChange={(e) => setDriverForm((f) => ({ ...f, cargoDescription: e.target.value }))} />
                      </div>
                      <div>
                        <p className="text-[10px] text-muted-foreground mb-1">Jadwal Pickup</p>
                        <Input className="h-8 text-xs" type="datetime-local" value={driverForm.pickupDateTime}
                          onChange={(e) => setDriverForm((f) => ({ ...f, pickupDateTime: e.target.value }))} />
                      </div>
                      <div>
                        <p className="text-[10px] text-muted-foreground mb-1">Jadwal Pengiriman</p>
                        <Input className="h-8 text-xs" type="datetime-local" value={driverForm.deliveryDateTime}
                          onChange={(e) => setDriverForm((f) => ({ ...f, deliveryDateTime: e.target.value }))} />
                      </div>
                    </div>
                    <Button size="sm" className="gap-1.5 w-full h-8 text-xs" disabled={assigningDriver}
                      onClick={() => handleAssignDriver(detailOrder.id)}>
                      {assigningDriver ? <Loader2 className="w-3 h-3 animate-spin" /> : <Truck className="w-3 h-3" />}
                      Konfirmasi Penugasan Driver
                    </Button>
                  </div>
                )}
              </div>

              {/* Invoice & Payment */}
              {(detailOrder as any).invoiceToken !== undefined && (
                <>
                  <Separator />
                  <div>
                    <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-3">Invoice & Pembayaran</p>
                    <div className="flex flex-wrap items-center gap-2">
                      {(detailOrder as any).paymentStatus === "paid" ? (
                        <span className="inline-flex items-center gap-1.5 text-xs text-green-700 bg-green-50 border border-green-200 rounded-lg px-3 py-1.5 font-medium">
                          <CheckCircle2 className="w-3.5 h-3.5" /> Pembayaran Diterima
                        </span>
                      ) : (
                        <>
                          <Button size="sm" variant="outline" className="gap-1.5 h-8 text-xs"
                            disabled={confirmingPaymentId === detailOrder.id}
                            onClick={() => handleConfirmPayment(detailOrder.id)}>
                            {confirmingPaymentId === detailOrder.id ? <Loader2 className="w-3 h-3 animate-spin" /> : <CreditCard className="w-3 h-3" />}
                            Konfirmasi Bayar
                          </Button>
                          <Button size="sm" variant="outline" className="gap-1.5 h-8 text-xs"
                            disabled={resendingInvoiceId === detailOrder.id}
                            onClick={() => handleResendInvoice(detailOrder.id)}>
                            {resendingInvoiceId === detailOrder.id ? <Loader2 className="w-3 h-3 animate-spin" /> : <Send className="w-3 h-3" />}
                            Kirim Invoice WA
                          </Button>
                        </>
                      )}
                      {(detailOrder as any).salesDocNumber && (
                        <span className="text-xs text-muted-foreground ml-auto">
                          SO: <span className="font-mono font-medium">{(detailOrder as any).salesDocNumber}</span>
                        </span>
                      )}
                    </div>
                  </div>
                </>
              )}

              {/* Danger zone */}
              <Separator />
              <div className="flex items-center justify-between">
                <p className="text-xs text-muted-foreground">Pesanan {detailOrder.orderNumber}</p>
                <Button variant="ghost" size="sm"
                  className="text-destructive hover:text-destructive hover:bg-destructive/10 gap-1.5"
                  onClick={() => handleDelete(detailOrder.id)}>
                  <Trash2 className="h-3.5 w-3.5" /> Hapus Pesanan
                </Button>
              </div>
            </div>
          </DialogContent>
        </Dialog>
      )}
    </AppShell>
  );
}
