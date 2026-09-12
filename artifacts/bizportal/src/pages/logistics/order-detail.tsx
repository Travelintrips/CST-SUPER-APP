import { DatePicker } from "@/components/ui/date-picker";
import { useState, useRef, useEffect } from "react";
import { useParams, useLocation } from "wouter";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { AppShell } from "@/components/layout/AppShell";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { useToast } from "@/hooks/use-toast";
import { Switch } from "@/components/ui/switch";
import {
  ArrowLeft, Loader2, Copy, ExternalLink, Plus, RefreshCw, Send,
  Package, Truck, User, ClipboardList, Clock, ShieldAlert, Ship,
  ClipboardCheck, CheckCircle2, XCircle, MapPin, MessageCircle,
  Link2, FileText, AlertTriangle, Eye, EyeOff, StickyNote, Globe,
  RotateCcw, Bell, ChevronDown, ChevronUp, Download, Shield, ZoomIn,
  Camera, Navigation, Phone, CreditCard, PenLine,
  Receipt, Search, Trash2, DollarSign, ShoppingBag, TrendingUp,
} from "lucide-react";
import { Skeleton } from "@/components/ui/skeleton";
import { QueryState } from "@/components/ui/query-state";
import { LoadingSkeleton } from "@/components/ui/loading-skeleton";
import { Link } from "wouter";
import GpsTrackingPanel from "@/components/logistics/GpsTrackingPanel";
import { ErrorBoundary } from "@/components/ErrorBoundary";
import { PaymentProofPreview } from "@/components/PaymentProofPreview";
import { OrderProgressBar } from "@/components/logistics/OrderProgressBar";
import { OrderDriverAssignmentPanel } from "@/components/freight/OrderDriverAssignmentPanel";
import { FreightDocVerifyPanel } from "@/components/logistics/FreightDocVerifyPanel";

const idr = (n: number | string | null | undefined) =>
  n == null ? "—" : `Rp ${Math.round(Number(n)).toLocaleString("id-ID")}`;

const dt = (s: string | null | undefined) =>
  s ? new Date(s).toLocaleString("id-ID", { day: "numeric", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" }) : "—";

// ── Types ──────────────────────────────────────────────────────────────────────

type Order = {
  id: number; orderNumber: string; customerName: string; email: string; phone: string;
  shipmentType: string; origin: string; destination: string;
  commodity: string | null; cargoDescription: string | null;
  grossWeight: string | null; volumeCbm: string | null; jumlahKoli: number | null;
  status: string;
  finalSellingPrice: string | null; finalPrice: string | null; markupPercent: string | null;
  approvedVendorId: number | null;
  customerQuoteStatus: string | null;
  etaFinal: string | null; termsConditions: string | null; quoteNotes: string | null;
  vendorCost: string | null; orderMargin: string | null;
  version?: number;
  createdAt: string;
  // Step 2: Product Template Engine
  categoryKey?: string | null;
  templateId?: number | null;
  templateVersion?: string | null;
  requiredDocs?: string[] | null;
};

type Vendor = { id: number; name: string; phone: string | null } | null;

type OrderUpdate = {
  id: number; orderId: number; actorType: string; actorName: string | null;
  status: string | null; notes: string | null; attachmentUrl: string | null;
  isPublic: boolean; createdAt: string;
};

type TaskLink = { id: number; token: string; roleType: string; label: string | null; status: string; taskUrl: string; createdAt: string };
type CustomerLink = { id: number; token: string; status: string; trackUrl: string; createdAt: string };
type QuoteLink = { id: number; token: string; status: string; quoteUrl: string; finalCustomerPrice: string | null; etaFinal: string | null; createdAt: string };
type FulfillmentLink = { id: number; token: string; serviceType: string; status: string; formUrl: string; sentAt: string | null; expiresAt: string | null; submittedAt: string | null; createdAt: string };
type FulfillmentSubmission = { id: number; linkId: number; serviceType: string; fulfillmentData: Record<string, string>; submittedAt: string };
type PodSubmission = { id: number; order_id: number; receiver_name: string | null; photo_url: string | null; note: string | null; submitted_by: string | null; created_at: string };

type DriverPodData = {
  id: number;
  jobNumber: string;
  status: string;
  podReceiverName: string | null;
  podReceiverPosition: string | null;
  podNotes: string | null;
  podPhotos: string[];
  podSubmittedAt: string | null;
  podGeoLat: string | null;
  podGeoLng: string | null;
  podDeviceTimestamp: string | null;
  podMapUrl: string | null;
  podStreetViewUrl: string | null;
  podSignatureDataUrl: string | null;
  driverName: string | null;
  driverPhone: string | null;
  vehiclePlate: string | null;
};

type DriverProgressEvent = {
  id: number;
  step_key: string;
  status: string;
  source: string;
  actor_name: string | null;
  notes: string | null;
  created_at: string;
  gps_latitude: number | null;
  gps_longitude: number | null;
  device_timestamp: string | null;
  map_url: string | null;
  street_view_url: string | null;
};

type FreightShipmentLink = {
  id: number; shipmentNumber: string; status: string;
  origin: string; destination: string; shipperName: string;
  approvedVendorName: string | null; createdAt: string;
  rfqId: number; rfqNumber: string;
};

type CustomerApproval = {
  id: number; token: string; status: string;
  customerName: string | null; customerPhone: string | null;
  sellingPrice: string | null; currency: string | null;
  soNumber: string | null; salesDocId: number | null;
  approvedAt: string | null; rejectedAt: string | null;
  expiresAt: string | null; createdAt: string;
  orderId: number | null; orderNumber: string | null;
};

type DetailData = {
  order: Order; vendor: Vendor;
  updates: OrderUpdate[];
  taskLinks: TaskLink[]; customerLinks: CustomerLink[]; quoteLinks: QuoteLink[];
  rfqs: { id: number; rfqNumber: string; status: string }[];
  freightShipments: FreightShipmentLink[];
};

type WaLog = {
  id: number;
  channel: string;
  recipient: string | null;
  subject: string | null;
  status: string;
  context: string | null;
  refType: string | null;
  refId: string | null;
  errorMsg: string | null;
  createdAt: string;
};

function WaNotificationLogPanel({ orderNumber }: { orderNumber: string }) {
  const [open, setOpen] = useState(false);
  const { data: logData, isLoading, refetch } = useQuery<{ total: number; rows: WaLog[] }>({
    queryKey: ["wa-logs", orderNumber],
    queryFn: () => apiFetch(`/api/whatsapp/notification-logs?refId=${encodeURIComponent(orderNumber)}&limit=50`),
    enabled: open,
    staleTime: 30000,
  });
  const logs = logData?.rows ?? [];

  const fmtStatus = (s: string) => {
    if (s === "sent") return <span className="text-xs text-green-600 font-medium">✓ Terkirim</span>;
    if (s === "failed") return <span className="text-xs text-red-500 font-medium">✗ Gagal</span>;
    if (s === "deduped") return <span className="text-xs text-slate-400 font-medium">↩ Duplikat</span>;
    return <span className="text-xs text-slate-500">{s}</span>;
  };

  const fmtChannel = (c: string) => c === "wa" ? "WhatsApp" : c === "email" ? "Email" : c;

  return (
    <Card className="border-slate-100">
      <CardHeader
        className="pb-2 cursor-pointer select-none"
        onClick={() => setOpen((v) => !v)}
      >
        <div className="flex items-center justify-between">
          <CardTitle className="text-sm font-semibold text-slate-600 uppercase tracking-wide flex items-center gap-1.5">
            <Bell className="w-4 h-4" /> Log Notifikasi WA/Email
            {logData && <span className="ml-1 text-xs font-normal normal-case text-slate-400">({logData.total})</span>}
          </CardTitle>
          <div className="flex items-center gap-2">
            {open && (
              <button
                onClick={(e) => { e.stopPropagation(); void refetch(); }}
                className="text-slate-400 hover:text-slate-600 transition-colors"
                title="Refresh log"
              >
                <RefreshCw className="w-3.5 h-3.5" />
              </button>
            )}
            {open ? <ChevronUp className="w-4 h-4 text-slate-400" /> : <ChevronDown className="w-4 h-4 text-slate-400" />}
          </div>
        </div>
      </CardHeader>
      {open && (
        <CardContent className="pt-0">
          <QueryState loading={isLoading} empty={!isLoading && (!logs || logs.length === 0)} emptyMessage="Belum ada log notifikasi" skeletonRows={2}>
            <div className="space-y-2 max-h-64 overflow-y-auto">
              {logs?.map((log) => (
                <div key={log.id} className={`rounded border px-3 py-2 text-xs ${log.status === "failed" ? "border-red-200 bg-red-50" : log.status === "deduped" ? "border-slate-100 bg-slate-50" : "border-green-100 bg-green-50"}`}>
                  <div className="flex items-center justify-between gap-2">
                    <span className="font-medium text-slate-700">{fmtChannel(log.channel)}</span>
                    {fmtStatus(log.status)}
                  </div>
                  {log.context && <p className="text-slate-500 mt-0.5">{log.context}</p>}
                  {log.recipient && <p className="text-slate-400 truncate">→ {log.recipient}</p>}
                  {log.errorMsg && <p className="text-red-500 mt-1 text-xs">{log.errorMsg}</p>}
                  <p className="text-slate-400 mt-1">
                    {new Date(log.createdAt).toLocaleString("id-ID", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" })}
                  </p>
                </div>
              ))}
            </div>
          </QueryState>
        </CardContent>
      )}
    </Card>
  );
}

const ORDER_STATUSES = [
  "Order Received", "Admin Review", "RFQ Sent", "Quote Received",
  "Customer Approval", "Vendor Confirmed", "In Progress", "Pickup",
  "In Transit", "Arrived", "Delivered", "POD Uploaded",
  "Invoice Issued", "Payment Received", "Completed", "Cancelled",
];

// ── Status badge color map ──────────────────────────────────────────────────────
// Covers both logistic_orders.status values and quote/customer status values.
// Unknown statuses fall back to "bg-slate-100 text-slate-700" (neutral grey).
// Keep this in sync with the status enum in the backend schema.
const STATUS_COLOR: Record<string, string> = {
  // Canonical 15 statuses
  "Order Received":    "bg-slate-100 text-slate-700",
  "Admin Review":      "bg-amber-100 text-amber-800",
  "RFQ Sent":          "bg-blue-100 text-blue-700",
  "Quote Received":    "bg-purple-100 text-purple-800",
  "Customer Approval": "bg-violet-100 text-violet-800",
  "Vendor Confirmed":  "bg-green-100 text-green-800",
  "In Progress":       "bg-blue-100 text-blue-800",
  "Pickup":            "bg-yellow-100 text-yellow-800",
  "In Transit":        "bg-indigo-100 text-indigo-800",
  "Arrived":           "bg-cyan-100 text-cyan-800",
  "Delivered":         "bg-teal-100 text-teal-800",
  "POD Uploaded":      "bg-emerald-100 text-emerald-800",
  "Invoice Issued":    "bg-orange-100 text-orange-800",
  "Payment Received":  "bg-lime-100 text-lime-800",
  "Completed":         "bg-green-200 text-green-900",
  "Cancelled":         "bg-red-100 text-red-800",
  // Legacy / backward compat
  "New Order":                   "bg-yellow-100 text-yellow-800",
  "Under Review":                "bg-blue-100 text-blue-700",
  "Quotation Sent":              "bg-purple-100 text-purple-800",
  "Customer Approved":           "bg-emerald-100 text-emerald-800",
  "Done":                        "bg-green-200 text-green-900",
  order_confirmed:               "bg-green-100 text-green-800",
  assigned_to_vendor:            "bg-blue-100 text-blue-800",
  waiting_pickup:                "bg-yellow-100 text-yellow-800",
  picked_up:                     "bg-blue-100 text-blue-800",
  in_progress:                   "bg-indigo-100 text-indigo-800",
  delivered:                     "bg-teal-100 text-teal-800",
  completed:                     "bg-green-200 text-green-900",
  cancelled:                     "bg-red-100 text-red-800",
  customer_quoted:               "bg-purple-100 text-purple-800",
  customer_approved:             "bg-emerald-100 text-emerald-800",
  customer_rejected:             "bg-red-100 text-red-800",
  customer_revision_requested:   "bg-amber-100 text-amber-800",
};

async function apiFetch<T>(url: string, opts?: RequestInit): Promise<T> {
  const res = await fetch(url, { headers: { "Content-Type": "application/json" }, ...opts });
  const data = await res.json() as T & { message?: string };
  if (!res.ok) throw new Error((data as { message?: string }).message ?? "API error");
  return data;
}

// ── Gap #6: OPEX Panel ────────────────────────────────────────────────────────
type OpexItem = {
  id: number; expenseNumber: string; date: string; description: string | null;
  status: string; total: number; categoryName: string | null; categoryCode: string | null;
  vendorEmployee: string | null; notes: string | null;
};
type OpexSearchResult = {
  id: number; expenseNumber: string; date: string; description: string | null;
  status: string; total: number; categoryName: string | null; linkedOrderId: number | null;
};

function OrderOpexPanel({ orderId }: { orderId: number }) {
  const [open, setOpen] = useState(false);
  const [dlgOpen, setDlgOpen] = useState(false);
  const [searchQ, setSearchQ] = useState("");
  const [searchResults, setSearchResults] = useState<OpexSearchResult[]>([]);
  const [searching, setSearching] = useState(false);
  const [linking, setLinking] = useState<number | null>(null);
  const [unlinking, setUnlinking] = useState<number | null>(null);
  const { toast } = useToast();
  const qc = useQueryClient();

  const { data, isLoading, refetch } = useQuery<{ items: OpexItem[]; totalOpex: number }>({
    queryKey: ["order-opex", orderId],
    queryFn: () => apiFetch(`/api/order-costs/${orderId}/expenses`),
    enabled: open,
    staleTime: 15000,
  });

  useEffect(() => {
    if (!dlgOpen) { setSearchQ(""); setSearchResults([]); }
  }, [dlgOpen]);

  const doSearch = async () => {
    setSearching(true);
    try {
      const r = await apiFetch<OpexSearchResult[]>(`/api/order-costs/expenses/search?q=${encodeURIComponent(searchQ)}&limit=20`);
      setSearchResults(r);
    } catch { toast({ title: "Gagal mencari expense", variant: "destructive" }); }
    finally { setSearching(false); }
  };

  const doLink = async (expId: number) => {
    setLinking(expId);
    try {
      await apiFetch(`/api/order-costs/${orderId}/expenses/${expId}/link`, { method: "POST" });
      toast({ title: "Expense berhasil dilink ke order" });
      void refetch(); void qc.invalidateQueries({ queryKey: ["order-opex-summary", orderId] });
      setDlgOpen(false);
    } catch { toast({ title: "Gagal link expense", variant: "destructive" }); }
    finally { setLinking(null); }
  };

  const doUnlink = async (expId: number) => {
    setUnlinking(expId);
    try {
      await apiFetch(`/api/order-costs/${orderId}/expenses/${expId}/link`, { method: "DELETE" });
      toast({ title: "Expense berhasil di-unlink" });
      void refetch(); void qc.invalidateQueries({ queryKey: ["order-opex-summary", orderId] });
    } catch { toast({ title: "Gagal unlink expense", variant: "destructive" }); }
    finally { setUnlinking(null); }
  };

  const items = data?.items ?? [];
  const totalOpex = data?.totalOpex ?? 0;
  const activeOpex = items.filter(i => i.status === "active").reduce((s, i) => s + i.total, 0);

  return (
    <>
      <Card className="border-orange-200">
        <CardHeader
          className="pb-2 cursor-pointer select-none"
          onClick={() => setOpen(v => !v)}
        >
          <div className="flex items-center justify-between">
            <CardTitle className="text-sm font-semibold text-orange-700 uppercase tracking-wide flex items-center gap-1.5">
              <Receipt className="w-4 h-4" /> OPEX / Operational Expense
              {open && data && (
                <span className="ml-1 text-xs font-normal normal-case text-orange-500">
                  ({items.length} item · {idr(activeOpex)})
                </span>
              )}
            </CardTitle>
            <div className="flex items-center gap-2">
              {open && (
                <Button
                  variant="outline" size="sm"
                  className="h-6 text-xs border-orange-300 text-orange-700 hover:bg-orange-50"
                  onClick={e => { e.stopPropagation(); setDlgOpen(true); }}
                >
                  <Plus className="h-3 w-3 mr-1" /> Link Expense
                </Button>
              )}
              {open ? <ChevronUp className="w-4 h-4 text-slate-400" /> : <ChevronDown className="w-4 h-4 text-slate-400" />}
            </div>
          </div>
        </CardHeader>
        {open && (
          <CardContent className="pt-0">
            <QueryState loading={isLoading} empty={items.length === 0} emptyMessage="Belum ada OPEX terhubung ke order ini" skeletonRows={2} skeletonRowClassName="h-10">
              <div className="space-y-2">
                {items.map(item => (
                  <div key={item.id} className="flex items-start gap-2 rounded-lg border border-orange-100 bg-orange-50/40 px-3 py-2">
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="font-mono text-xs font-semibold text-orange-700">{item.expenseNumber}</span>
                        <Badge
                          className={`text-[10px] ${item.status === "active" ? "bg-emerald-100 text-emerald-700" : item.status === "draft" ? "bg-slate-100 text-slate-600" : "bg-red-100 text-red-600"}`}
                        >
                          {item.status}
                        </Badge>
                        {item.categoryName && <span className="text-[10px] text-slate-500">{item.categoryName}</span>}
                      </div>
                      {item.description && <p className="text-xs text-slate-600 mt-0.5 truncate">{item.description}</p>}
                      <div className="flex items-center gap-3 mt-1">
                        <span className="text-xs text-slate-400">{item.date}</span>
                        <span className={`text-sm font-semibold ${item.status === "active" ? "text-orange-700" : "text-slate-500"}`}>{idr(item.total)}</span>
                      </div>
                    </div>
                    <Button
                      variant="ghost" size="icon"
                      className="h-7 w-7 text-slate-400 hover:text-red-600 shrink-0"
                      disabled={unlinking === item.id}
                      onClick={() => doUnlink(item.id)}
                    >
                      {unlinking === item.id ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Trash2 className="h-3.5 w-3.5" />}
                    </Button>
                  </div>
                ))}
                {activeOpex > 0 && (
                  <div className="flex justify-between items-center pt-1 border-t border-orange-200 text-sm">
                    <span className="text-orange-600 font-medium flex items-center gap-1">
                      <TrendingUp className="h-3.5 w-3.5" /> Total OPEX (aktif)
                    </span>
                    <span className="font-bold text-orange-700">{idr(activeOpex)}</span>
                  </div>
                )}
              </div>
            </QueryState>
          </CardContent>
        )}
      </Card>

      <Dialog open={dlgOpen} onOpenChange={setDlgOpen}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Receipt className="h-4 w-4 text-orange-600" /> Link OPEX ke Order
            </DialogTitle>
          </DialogHeader>
          <div className="space-y-3">
            <div className="flex gap-2">
              <Input
                placeholder="Cari expense (nomor/deskripsi)…"
                value={searchQ}
                onChange={e => setSearchQ(e.target.value)}
                onKeyDown={e => e.key === "Enter" && doSearch()}
                className="flex-1"
              />
              <Button variant="outline" onClick={doSearch} disabled={searching} className="shrink-0">
                {searching ? <Loader2 className="h-4 w-4 animate-spin" /> : <Search className="h-4 w-4" />}
              </Button>
            </div>
            <div className="max-h-64 overflow-y-auto space-y-1.5">
              {searchResults.length === 0 && !searching && (
                <p className="text-sm text-slate-400 text-center py-4">Ketik dan tekan Enter untuk mencari expense</p>
              )}
              {searchResults.map(r => (
                <div key={r.id} className={`flex items-center gap-2 rounded border px-3 py-2 text-sm ${r.linkedOrderId && r.linkedOrderId !== orderId ? "opacity-50 cursor-not-allowed border-slate-100 bg-slate-50" : "border-orange-100 bg-orange-50/30 hover:bg-orange-50 cursor-pointer"}`}
                  onClick={() => !r.linkedOrderId || r.linkedOrderId === orderId ? doLink(r.id) : undefined}
                >
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-1.5 flex-wrap">
                      <span className="font-mono font-semibold text-xs text-orange-700">{r.expenseNumber}</span>
                      <Badge className={`text-[10px] ${r.status === "active" ? "bg-emerald-100 text-emerald-700" : "bg-slate-100 text-slate-600"}`}>{r.status}</Badge>
                      {r.categoryName && <span className="text-[10px] text-slate-500">{r.categoryName}</span>}
                      {r.linkedOrderId && r.linkedOrderId !== orderId && <Badge className="text-[10px] bg-amber-100 text-amber-700">Sudah di-link ke order lain</Badge>}
                    </div>
                    {r.description && <p className="text-xs text-slate-500 truncate">{r.description}</p>}
                  </div>
                  <div className="shrink-0 flex items-center gap-2">
                    <span className="font-semibold text-orange-700 text-xs">{idr(r.total)}</span>
                    {linking === r.id
                      ? <Loader2 className="h-3.5 w-3.5 animate-spin" />
                      : (!r.linkedOrderId || r.linkedOrderId === orderId) && <Plus className="h-3.5 w-3.5 text-orange-500" />}
                  </div>
                </div>
              ))}
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDlgOpen(false)}>Tutup</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}

// ── Gap #7: Purchase Link Panel ────────────────────────────────────────────────
type PoItem = {
  id: number; docNumber: string; kind: string; status: string;
  billStatus: string; paymentStatus: string;
  supplierName: string; totalAmount: number; taxAmount: number; grandTotal: number;
  confirmedAt: string | null; createdAt: string;
};
type PoSearchResult = {
  id: number; docNumber: string; kind: string; status: string;
  supplierName: string; grandTotal: number; createdAt: string;
  linkedOrderId: number | null;
};

function OrderPurchaseLinkPanel({ orderId }: { orderId: number }) {
  const [open, setOpen] = useState(false);
  const [dlgOpen, setDlgOpen] = useState(false);
  const [searchQ, setSearchQ] = useState("");
  const [searchResults, setSearchResults] = useState<PoSearchResult[]>([]);
  const [searching, setSearching] = useState(false);
  const [linking, setLinking] = useState<number | null>(null);
  const [unlinking, setUnlinking] = useState<number | null>(null);
  const { toast } = useToast();
  const qc = useQueryClient();

  const { data, isLoading, refetch } = useQuery<{ items: PoItem[]; totalPurchaseCost: number }>({
    queryKey: ["order-purchases", orderId],
    queryFn: () => apiFetch(`/api/order-costs/${orderId}/purchases`),
    enabled: open,
    staleTime: 15000,
  });

  useEffect(() => {
    if (!dlgOpen) { setSearchQ(""); setSearchResults([]); }
  }, [dlgOpen]);

  const doSearch = async () => {
    setSearching(true);
    try {
      const r = await apiFetch<PoSearchResult[]>(`/api/order-costs/purchases/search?q=${encodeURIComponent(searchQ)}&limit=20`);
      setSearchResults(r);
    } catch { toast({ title: "Gagal mencari PO", variant: "destructive" }); }
    finally { setSearching(false); }
  };

  const doLink = async (poId: number) => {
    setLinking(poId);
    try {
      await apiFetch(`/api/order-costs/${orderId}/purchases/${poId}/link`, { method: "POST" });
      toast({ title: "PO berhasil dilink ke order" });
      void refetch(); void qc.invalidateQueries({ queryKey: ["order-opex-summary", orderId] });
      setDlgOpen(false);
    } catch { toast({ title: "Gagal link PO", variant: "destructive" }); }
    finally { setLinking(null); }
  };

  const doUnlink = async (poId: number) => {
    setUnlinking(poId);
    try {
      await apiFetch(`/api/order-costs/${orderId}/purchases/${poId}/link`, { method: "DELETE" });
      toast({ title: "PO berhasil di-unlink" });
      void refetch(); void qc.invalidateQueries({ queryKey: ["order-opex-summary", orderId] });
    } catch { toast({ title: "Gagal unlink PO", variant: "destructive" }); }
    finally { setUnlinking(null); }
  };

  const items = data?.items ?? [];
  const totalPO = data?.totalPurchaseCost ?? 0;
  const STATUS_PO: Record<string, string> = {
    draft: "bg-slate-100 text-slate-600", sent: "bg-blue-100 text-blue-700",
    confirmed: "bg-emerald-100 text-emerald-700", done: "bg-green-200 text-green-800",
    cancelled: "bg-red-100 text-red-700",
  };

  return (
    <>
      <Card className="border-indigo-200">
        <CardHeader
          className="pb-2 cursor-pointer select-none"
          onClick={() => setOpen(v => !v)}
        >
          <div className="flex items-center justify-between">
            <CardTitle className="text-sm font-semibold text-indigo-700 uppercase tracking-wide flex items-center gap-1.5">
              <ShoppingBag className="w-4 h-4" /> Purchase Order Terkait
              {open && data && (
                <span className="ml-1 text-xs font-normal normal-case text-indigo-500">
                  ({items.length} PO/RFQ · PO total: {idr(totalPO)})
                </span>
              )}
            </CardTitle>
            <div className="flex items-center gap-2">
              {open && (
                <Button
                  variant="outline" size="sm"
                  className="h-6 text-xs border-indigo-300 text-indigo-700 hover:bg-indigo-50"
                  onClick={e => { e.stopPropagation(); setDlgOpen(true); }}
                >
                  <Plus className="h-3 w-3 mr-1" /> Link PO
                </Button>
              )}
              {open ? <ChevronUp className="w-4 h-4 text-slate-400" /> : <ChevronDown className="w-4 h-4 text-slate-400" />}
            </div>
          </div>
        </CardHeader>
        {open && (
          <CardContent className="pt-0">
            <QueryState loading={isLoading} empty={items.length === 0} emptyMessage="Belum ada PO/RFQ terhubung ke order ini" skeletonRows={2} skeletonRowClassName="h-10">
              <div className="space-y-2">
                {items.map(item => (
                  <div key={item.id} className="flex items-start gap-2 rounded-lg border border-indigo-100 bg-indigo-50/40 px-3 py-2">
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="font-mono text-xs font-semibold text-indigo-700">{item.docNumber}</span>
                        <Badge className="text-[10px] bg-slate-100 text-slate-600">{item.kind === "order" ? "PO" : "RFQ"}</Badge>
                        <Badge className={`text-[10px] ${STATUS_PO[item.status] ?? "bg-slate-100 text-slate-600"}`}>{item.status}</Badge>
                        <Badge className={`text-[10px] ${item.billStatus === "billed" ? "bg-emerald-100 text-emerald-700" : "bg-slate-100 text-slate-500"}`}>
                          {item.billStatus}
                        </Badge>
                      </div>
                      <p className="text-xs text-slate-600 mt-0.5">{item.supplierName}</p>
                      <div className="flex items-center gap-3 mt-1">
                        <span className="text-sm font-semibold text-indigo-700">{idr(item.grandTotal)}</span>
                        {item.taxAmount > 0 && <span className="text-xs text-slate-400">PPN: {idr(item.taxAmount)}</span>}
                      </div>
                    </div>
                    <Button
                      variant="ghost" size="icon"
                      className="h-7 w-7 text-slate-400 hover:text-red-600 shrink-0"
                      disabled={unlinking === item.id}
                      onClick={() => doUnlink(item.id)}
                    >
                      {unlinking === item.id ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Trash2 className="h-3.5 w-3.5" />}
                    </Button>
                  </div>
                ))}
                {totalPO > 0 && (
                  <div className="flex justify-between items-center pt-1 border-t border-indigo-200 text-sm">
                    <span className="text-indigo-600 font-medium flex items-center gap-1">
                      <DollarSign className="h-3.5 w-3.5" /> Total Actual Purchase Cost
                    </span>
                    <span className="font-bold text-indigo-700">{idr(totalPO)}</span>
                  </div>
                )}
              </div>
            </QueryState>
          </CardContent>
        )}
      </Card>

      <Dialog open={dlgOpen} onOpenChange={setDlgOpen}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <ShoppingBag className="h-4 w-4 text-indigo-600" /> Link Purchase Order ke Order
            </DialogTitle>
          </DialogHeader>
          <div className="space-y-3">
            <div className="flex gap-2">
              <Input
                placeholder="Cari PO (nomor/supplier)…"
                value={searchQ}
                onChange={e => setSearchQ(e.target.value)}
                onKeyDown={e => e.key === "Enter" && doSearch()}
                className="flex-1"
              />
              <Button variant="outline" onClick={doSearch} disabled={searching} className="shrink-0">
                {searching ? <Loader2 className="h-4 w-4 animate-spin" /> : <Search className="h-4 w-4" />}
              </Button>
            </div>
            <div className="max-h-64 overflow-y-auto space-y-1.5">
              {searchResults.length === 0 && !searching && (
                <p className="text-sm text-slate-400 text-center py-4">Ketik dan tekan Enter untuk mencari PO</p>
              )}
              {searchResults.map(r => (
                <div key={r.id}
                  className={`flex items-center gap-2 rounded border px-3 py-2 text-sm ${r.linkedOrderId && r.linkedOrderId !== orderId ? "opacity-50 cursor-not-allowed border-slate-100 bg-slate-50" : "border-indigo-100 bg-indigo-50/30 hover:bg-indigo-50 cursor-pointer"}`}
                  onClick={() => !r.linkedOrderId || r.linkedOrderId === orderId ? doLink(r.id) : undefined}
                >
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-1.5 flex-wrap">
                      <span className="font-mono font-semibold text-xs text-indigo-700">{r.docNumber}</span>
                      <Badge className="text-[10px] bg-slate-100 text-slate-600">{r.kind === "order" ? "PO" : "RFQ"}</Badge>
                      <Badge className={`text-[10px] ${STATUS_PO[r.status] ?? "bg-slate-100 text-slate-500"}`}>{r.status}</Badge>
                      {r.linkedOrderId && r.linkedOrderId !== orderId && <Badge className="text-[10px] bg-amber-100 text-amber-700">Sudah di-link</Badge>}
                    </div>
                    <p className="text-xs text-slate-500 truncate">{r.supplierName}</p>
                  </div>
                  <div className="shrink-0 flex items-center gap-2">
                    <span className="font-semibold text-indigo-700 text-xs">{idr(r.grandTotal)}</span>
                    {linking === r.id
                      ? <Loader2 className="h-3.5 w-3.5 animate-spin" />
                      : (!r.linkedOrderId || r.linkedOrderId === orderId) && <Plus className="h-3.5 w-3.5 text-indigo-500" />}
                  </div>
                </div>
              ))}
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDlgOpen(false)}>Tutup</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}

// ── Create Customer Approval Dialog ───────────────────────────────────────────
// Dipakai untuk VMF flow: buat link approval langsung dari Order Detail
// tanpa perlu buka halaman Purchase > Vendor Forms.

function CreateApprovalDialog({ order, onCreated }: { order: Order; onCreated: () => void }) {
  const [open, setOpen] = useState(false);
  const [sellingPrice, setSellingPrice] = useState(order.finalSellingPrice ?? "");
  const [currency, setCurrency] = useState("IDR");
  const [termsNotes, setTermsNotes] = useState("");
  const [expiresInDays, setExpiresInDays] = useState("7");
  const [loading, setLoading] = useState(false);
  const { toast } = useToast();

  const vendorCostNum = order.vendorCost ? Number(order.vendorCost) : null;
  const sellingNum = sellingPrice ? Number(sellingPrice) : null;
  const profitMarginPct = sellingNum && vendorCostNum && sellingNum > 0
    ? Number((((sellingNum - vendorCostNum) / sellingNum) * 100).toFixed(2))
    : null;

  const handleCreate = async () => {
    if (!sellingPrice) { toast({ title: "Harga jual wajib diisi", variant: "destructive" }); return; }
    setLoading(true);
    try {
      const result = await apiFetch<{ ok: boolean; token: string }>("/api/vendor-form/admin/customer-approvals", {
        method: "POST",
        body: JSON.stringify({
          orderId: order.id,
          orderNumber: order.orderNumber,
          customerName: order.customerName,
          customerPhone: order.phone,
          sellingPrice: Number(sellingPrice),
          currency,
          termsNotes: termsNotes || undefined,
          expiresInDays: expiresInDays ? Number(expiresInDays) : 7,
          vendorCost: vendorCostNum ?? undefined,
          profitMarginPct: profitMarginPct ?? undefined,
        }),
      });
      const approvalUrl = `${window.location.origin}/vendor-form/customer-approval/${result.token}`;
      navigator.clipboard.writeText(approvalUrl).catch(() => {});
      toast({ title: "✅ Link approval berhasil dibuat!", description: "Link telah disalin ke clipboard." });
      setOpen(false);
      onCreated();
    } catch (e: unknown) {
      toast({ title: "Gagal buat approval", description: (e as Error).message, variant: "destructive" });
    } finally {
      setLoading(false);
    }
  };

  return (
    <>
      <Button
        onClick={() => setOpen(true)}
        className="bg-violet-600 hover:bg-violet-700 text-white"
        size="sm"
      >
        <Send className="w-4 h-4 mr-1" />
        Kirim Penawaran ke Customer
      </Button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Kirim Penawaran ke Customer</DialogTitle>
          </DialogHeader>
          <div className="space-y-4 py-2">
            <div className="text-sm text-slate-600 bg-slate-50 rounded-lg p-3 space-y-1">
              <div><span className="text-slate-400">Order:</span> <strong>{order.orderNumber}</strong></div>
              <div><span className="text-slate-400">Customer:</span> {order.customerName}</div>
              {order.phone && <div><span className="text-slate-400">WA:</span> {order.phone}</div>}
            </div>

            <div className="space-y-1.5">
              <Label>Harga Jual ke Customer (Rp) <span className="text-red-500">*</span></Label>
              <Input
                type="number"
                value={sellingPrice}
                onChange={e => setSellingPrice(e.target.value)}
                placeholder="0"
              />
              {vendorCostNum && sellingPrice && Number(sellingPrice) > 0 && (
                <p className="text-xs text-slate-500">
                  Harga vendor: {idr(vendorCostNum)}
                  {profitMarginPct !== null && (
                    <span className={`ml-2 font-medium ${profitMarginPct < 0 ? "text-red-600" : "text-emerald-600"}`}>
                      Margin: {profitMarginPct}%
                    </span>
                  )}
                </p>
              )}
            </div>

            <div className="space-y-1.5">
              <Label>Mata Uang</Label>
              <Select value={currency} onValueChange={setCurrency}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  {["IDR", "USD", "SGD", "EUR"].map(c => <SelectItem key={c} value={c}>{c}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-1.5">
              <Label>Link berlaku (hari)</Label>
              <Input
                type="number"
                value={expiresInDays}
                onChange={e => setExpiresInDays(e.target.value)}
                min={1}
                max={30}
              />
            </div>

            <div className="space-y-1.5">
              <Label>Syarat &amp; Ketentuan / Catatan</Label>
              <Textarea
                value={termsNotes}
                onChange={e => setTermsNotes(e.target.value)}
                rows={3}
                placeholder="Contoh: Harga sudah termasuk PPN 11%, pembayaran 50% DP..."
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setOpen(false)}>Batal</Button>
            <Button
              onClick={handleCreate}
              disabled={loading}
              className="bg-violet-600 hover:bg-violet-700 text-white"
            >
              {loading
                ? <Loader2 className="w-4 h-4 animate-spin mr-1" />
                : <Send className="w-4 h-4 mr-1" />}
              Buat &amp; Salin Link
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}

// ── Send Quote Dialog ──────────────────────────────────────────────────────────

function SendQuoteDialog({ order, rfqId, onSent }: { order: Order; rfqId: number | null; onSent: () => void }) {
  const [open, setOpen] = useState(false);
  const [price, setPrice] = useState(order.finalSellingPrice ?? "");
  const [eta, setEta] = useState(order.etaFinal ?? "");
  const [terms, setTerms] = useState(order.termsConditions ?? "");
  const [notes, setNotes] = useState(order.quoteNotes ?? "");
  const [validDays, setValidDays] = useState("3");
  const [loading, setLoading] = useState(false);
  const { toast } = useToast();

  const handleSend = async () => {
    if (!rfqId) { toast({ title: "Tidak ada RFQ aktif", variant: "destructive" }); return; }
    if (!price) { toast({ title: "Harga jual wajib diisi", variant: "destructive" }); return; }
    setLoading(true);
    try {
      const result = await apiFetch<{ ok: boolean; quoteUrl: string }>(`/api/logistic/rfq/${rfqId}/send-customer-quote`, {
        method: "POST",
        body: JSON.stringify({
          finalCustomerPrice: Number(price),
          etaFinal: eta || undefined,
          termsConditions: terms || undefined,
          quoteNotes: notes || undefined,
          validInDays: validDays ? Number(validDays) : 3,
        }),
      });
      toast({ title: "Penawaran terkirim ke customer!", description: "WA notifikasi dikirim." });
      navigator.clipboard.writeText(result.quoteUrl).catch(() => {});
      setOpen(false);
      onSent();
    } catch (e: unknown) {
      toast({ title: "Gagal", description: (e as Error).message, variant: "destructive" });
    } finally {
      setLoading(false);
    }
  };

  return (
    <>
      <Button
        onClick={() => setOpen(true)}
        className="bg-purple-600 hover:bg-purple-700 text-white"
        size="sm"
      >
        <Send className="w-4 h-4 mr-1" />
        Kirim Penawaran ke Customer
      </Button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader><DialogTitle>Kirim Penawaran ke Customer</DialogTitle></DialogHeader>
          <div className="space-y-4 py-2">
            <div className="text-sm text-slate-600 bg-slate-50 rounded-lg p-3">
              Customer: <strong>{order.customerName}</strong> · {order.phone}
            </div>
            <div className="space-y-1.5">
              <Label>Harga Jual Final ke Customer (Rp) <span className="text-red-500">*</span></Label>
              <Input type="number" value={price} onChange={e => setPrice(e.target.value)} placeholder="0" />
            </div>
            <div className="space-y-1.5">
              <Label>Estimasi Waktu (ETA)</Label>
              <Input value={eta} onChange={e => setEta(e.target.value)} placeholder="Contoh: 3-5 hari kerja" />
            </div>
            <div className="space-y-1.5">
              <Label>Link Berlaku (hari)</Label>
              <Input type="number" value={validDays} onChange={e => setValidDays(e.target.value)} min={1} max={30} />
            </div>
            <div className="space-y-1.5">
              <Label>Syarat &amp; Ketentuan</Label>
              <Textarea value={terms} onChange={e => setTerms(e.target.value)} rows={3}
                placeholder="Contoh: Harga belum termasuk biaya tambahan, pembayaran 50% di muka..." />
            </div>
            <div className="space-y-1.5">
              <Label>Catatan untuk Customer</Label>
              <Textarea value={notes} onChange={e => setNotes(e.target.value)} rows={2}
                placeholder="Pesan tambahan untuk customer..." />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setOpen(false)}>Batal</Button>
            <Button onClick={handleSend} disabled={loading} className="bg-purple-600 hover:bg-purple-700 text-white">
              {loading ? <Loader2 className="w-4 h-4 animate-spin mr-1" /> : <Send className="w-4 h-4 mr-1" />}
              Kirim via WA
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}

// ── Create Task Link Dialog ────────────────────────────────────────────────────

function CreateTaskLinkDialog({ orderId, vendorId, onCreated }: { orderId: number; vendorId: number | null; onCreated: () => void }) {
  const [open, setOpen] = useState(false);
  const [roleType, setRoleType] = useState("vendor");
  const [label, setLabel] = useState("");
  const [expiredDays, setExpiredDays] = useState("7");
  const [loading, setLoading] = useState(false);
  const { toast } = useToast();

  const handleCreate = async () => {
    setLoading(true);
    try {
      const result = await apiFetch<{ ok: boolean; taskUrl: string }>(`/api/logistic/orders/${orderId}/create-task-link`, {
        method: "POST",
        body: JSON.stringify({ roleType, label: label || undefined, vendorId: roleType === "vendor" ? vendorId : undefined, expiredInDays: expiredDays ? Number(expiredDays) : undefined }),
      });
      toast({ title: "Task link dibuat" });
      navigator.clipboard.writeText(result.taskUrl).catch(() => {});
      setOpen(false);
      onCreated();
    } catch (e: unknown) {
      toast({ title: "Gagal", description: (e as Error).message, variant: "destructive" });
    } finally {
      setLoading(false);
    }
  };

  return (
    <>
      <Button variant="outline" size="sm" onClick={() => setOpen(true)}>
        <Plus className="w-4 h-4 mr-1" />
        Buat Task Link
      </Button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-w-sm">
          <DialogHeader><DialogTitle>Buat Task Link</DialogTitle></DialogHeader>
          <div className="space-y-4 py-2">
            <div className="space-y-1.5">
              <Label>Role</Label>
              <Select value={roleType} onValueChange={setRoleType}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="vendor">Vendor</SelectItem>
                  <SelectItem value="driver">Driver</SelectItem>
                  <SelectItem value="staff">Staff Internal</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label>Label / Keterangan</Label>
              <Input value={label} onChange={e => setLabel(e.target.value)} placeholder="Contoh: Pickup Jakarta Pusat" />
            </div>
            <div className="space-y-1.5">
              <Label>Berlaku (hari)</Label>
              <Input type="number" value={expiredDays} onChange={e => setExpiredDays(e.target.value)} min={1} />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setOpen(false)}>Batal</Button>
            <Button onClick={handleCreate} disabled={loading}>
              {loading ? <Loader2 className="w-4 h-4 animate-spin mr-1" /> : <Plus className="w-4 h-4 mr-1" />}
              Buat
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}

// ── Send Fulfillment Dialog ────────────────────────────────────────────────────

function SendFulfillmentDialog({ orderId, vendor, shipmentType, onSent }: {
  orderId: number;
  vendor: Vendor;
  shipmentType: string;
  onSent: () => void;
}) {
  const [open, setOpen] = useState(false);
  const [expiresInDays, setExpiresInDays] = useState("7");
  const [customNote, setCustomNote] = useState("");
  const [loading, setLoading] = useState(false);
  const { toast } = useToast();

  const handleSend = async () => {
    setLoading(true);
    try {
      const result = await apiFetch<{ ok: boolean; formUrl: string; vendorPhone: string | null }>(`/api/logistic/orders/${orderId}/send-fulfillment`, {
        method: "POST",
        body: JSON.stringify({
          expiresInDays: expiresInDays ? Number(expiresInDays) : 7,
          customNote: customNote || undefined,
        }),
      });
      toast({ title: "Form fulfillment dikirim!", description: result.vendorPhone ? "WA dikirim ke vendor." : "Link berhasil dibuat." });
      navigator.clipboard.writeText(result.formUrl).catch(() => {});
      setOpen(false);
      onSent();
    } catch (e: unknown) {
      toast({ title: "Gagal", description: (e as Error).message, variant: "destructive" });
    } finally {
      setLoading(false);
    }
  };

  return (
    <>
      <Button
        onClick={() => setOpen(true)}
        className="bg-emerald-600 hover:bg-emerald-700 text-white"
        size="sm"
      >
        <ClipboardCheck className="w-4 h-4 mr-1" />
        Kirim ke Vendor
      </Button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader><DialogTitle>Kirim Form Fulfillment ke Vendor</DialogTitle></DialogHeader>
          <div className="space-y-4 py-2">
            <div className="text-sm text-slate-600 bg-slate-50 rounded-lg p-3 space-y-1">
              <p>Layanan: <strong>{shipmentType}</strong></p>
              {vendor && <p>Vendor: <strong className="text-blue-700">{vendor.name}</strong> {vendor.phone ? `· ${vendor.phone}` : ""}</p>}
              {!vendor && <p className="text-amber-600">⚠️ Belum ada vendor terpilih. Link tetap dibuat tanpa notifikasi WA otomatis.</p>}
            </div>
            <div className="space-y-1.5">
              <Label>Link Berlaku (hari)</Label>
              <Input type="number" value={expiresInDays} onChange={e => setExpiresInDays(e.target.value)} min={1} max={30} />
            </div>
            <div className="space-y-1.5">
              <Label>Catatan Tambahan untuk Vendor (opsional)</Label>
              <Textarea value={customNote} onChange={e => setCustomNote(e.target.value)} rows={2}
                placeholder="Instruksi khusus, deadline, dll." />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setOpen(false)}>Batal</Button>
            <Button onClick={handleSend} disabled={loading} className="bg-emerald-600 hover:bg-emerald-700 text-white">
              {loading ? <Loader2 className="w-4 h-4 animate-spin mr-1" /> : <Send className="w-4 h-4 mr-1" />}
              {vendor?.phone ? "Kirim via WA" : "Buat Link"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}

// ── Assign Vendor Dialog ───────────────────────────────────────────────────────

type VendorQuoteRow = {
  id: number;
  vendorId: number;
  vendorName: string | null;
  vendorPhone: string | null;
  vendorPrice: string | null;
  sellingPrice: string | null;
  quoteStatus: string | null;
  eta: string | null;
  currency: string | null;
};

type JobOrderData = {
  jobOrder: {
    id: number; order_id: number; vendor_id: number; token: string; status: string;
    driver_name: string | null; driver_phone: string | null; vehicle_plate: string | null;
    carrier: string | null; eta: string | null; accepted_at: string | null;
    rejected_at: string | null; reject_reason: string | null; completed_at: string | null;
    vendor_name: string | null;
  } | null;
  quotes: VendorQuoteRow[];
  progress: { id: number; status: string; notes: string | null; updated_by: string; created_at: string }[];
  trackingToken: string | null;
  trackingUrl: string | null;
  jobUrl: string | null;
};

function AssignVendorDialog({ orderId, onAssigned }: { orderId: number; onAssigned: () => void }) {
  const [open, setOpen] = useState(false);
  const [selectedQuoteId, setSelectedQuoteId] = useState<number | null>(null);
  const [adminNote, setAdminNote] = useState("");
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<{ jobUrl: string; trackingUrl: string | null; waMessage: string; vendorPhone: string | null } | null>(null);
  const { toast } = useToast();
  const qc = useQueryClient();

  const { data: jobData } = useQuery<JobOrderData>({
    queryKey: ["order-job", orderId],
    queryFn: () => apiFetch(`/api/logistic/orders/${orderId}/job-order`),
    enabled: !isNaN(orderId) && open,
  });

  const handleAssign = async () => {
    if (!selectedQuoteId) {
      toast({ title: "Pilih quote vendor terlebih dahulu", variant: "destructive" });
      return;
    }
    setLoading(true);
    try {
      const r = await apiFetch<{ ok: boolean; jobUrl: string; trackingToken: string; trackingUrl: string; waMessage: string; vendorPhone: string | null }>
        (`/api/logistic/orders/${orderId}/assign-vendor`, {
          method: "POST",
          body: JSON.stringify({ quoteId: selectedQuoteId, adminNote: adminNote || undefined }),
        });
      setResult({ jobUrl: r.jobUrl, trackingUrl: r.trackingUrl, waMessage: r.waMessage, vendorPhone: r.vendorPhone });
      toast({ title: "Vendor berhasil ditugaskan!", description: "Job order telah dibuat." });
      // Invalidate both order-detail (status/price section) and order-job (driver panel).
      // All mutations in this file use ["order-detail", orderId] as the primary cache key.
      // Additional keys (order-job, order-fulfillment, order-approvals) are invalidated
      // only where the mutation specifically affects those panels.
      qc.invalidateQueries({ queryKey: ["order-detail", orderId] });
      qc.invalidateQueries({ queryKey: ["order-job", orderId] });
      onAssigned();
    } catch (e: unknown) {
      toast({ title: "Gagal", description: (e as Error).message, variant: "destructive" });
    } finally {
      setLoading(false);
    }
  };

  const copyText = (text: string, label: string) => {
    navigator.clipboard.writeText(text);
    toast({ title: `${label} disalin!` });
  };

  const QUOTE_STATUS_STYLE: Record<string, string> = {
    approved: "text-green-700 bg-green-50",
    not_selected: "text-slate-400 bg-slate-50",
    pending: "text-amber-700 bg-amber-50",
  };

  return (
    <>
      <Button onClick={() => { setOpen(true); }} className="bg-blue-600 hover:bg-blue-700 text-white" size="sm">
        <CheckCircle2 className="w-4 h-4 mr-1" />
        Tugaskan Vendor
      </Button>
      <Dialog open={open} onOpenChange={o => { setOpen(o); if (!o) setResult(null); }}>
        <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <CheckCircle2 className="w-5 h-5 text-blue-600" />
              Tugaskan Vendor & Buat Job Order
            </DialogTitle>
          </DialogHeader>

          {!result ? (
            <div className="space-y-4 py-2">
              {/* Existing job order warning */}
              {jobData?.jobOrder && (
                <div className={`rounded-lg border px-4 py-3 text-sm ${
                  jobData.jobOrder.status === "accepted" ? "bg-green-50 border-green-200 text-green-800" :
                  jobData.jobOrder.status === "rejected" ? "bg-red-50 border-red-200 text-red-800" :
                  "bg-amber-50 border-amber-200 text-amber-800"
                }`}>
                  ⚠️ Job order sudah ada — Status: <strong>{jobData.jobOrder.status}</strong>
                  {jobData.jobOrder.vendor_name && ` · Vendor: ${jobData.jobOrder.vendor_name}`}
                  <br />
                  <span className="text-xs">Klik "Tugaskan" untuk mendapatkan ulang link job order.</span>
                </div>
              )}

              {/* Quote list */}
              <div className="space-y-1.5">
                <Label className="text-sm font-semibold">Pilih Vendor Pemenang</Label>
                {(!jobData?.quotes || jobData.quotes.length === 0) ? (
                  <p className="text-sm text-slate-400 py-4 text-center border border-dashed rounded-lg">
                    Belum ada quotes vendor. Buat RFQ dan tunggu respon vendor terlebih dahulu.
                  </p>
                ) : (
                  <div className="space-y-2 max-h-60 overflow-y-auto pr-1">
                    {jobData.quotes.map((q) => {
                      const isSelected = selectedQuoteId === q.id;
                      const statusStyle = QUOTE_STATUS_STYLE[q.quoteStatus ?? ""] ?? "text-slate-500 bg-slate-50";
                      return (
                        <button
                          key={q.id}
                          type="button"
                          onClick={() => setSelectedQuoteId(q.id)}
                          className={`w-full text-left rounded-xl border-2 px-4 py-3 text-sm transition-all ${
                            isSelected ? "border-blue-500 bg-blue-50" : "border-slate-200 hover:border-slate-300"
                          }`}
                        >
                          <div className="flex items-center justify-between gap-2">
                            <div className="font-semibold text-slate-800">{q.vendorName ?? "—"}</div>
                            <div className="flex items-center gap-2">
                              <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${statusStyle}`}>
                                {q.quoteStatus ?? "—"}
                              </span>
                              {isSelected && <CheckCircle2 className="w-4 h-4 text-blue-600 flex-shrink-0" />}
                            </div>
                          </div>
                          <div className="flex gap-4 mt-1 text-slate-500 text-xs">
                            {q.vendorPrice && (
                              <span>Vendor: <strong className="text-slate-700">
                                Rp {Math.round(Number(q.vendorPrice)).toLocaleString("id-ID")}
                              </strong></span>
                            )}
                            {q.sellingPrice && (
                              <span>Jual: <strong className="text-blue-700">
                                Rp {Math.round(Number(q.sellingPrice)).toLocaleString("id-ID")}
                              </strong></span>
                            )}
                            {q.eta && <span>ETA: {q.eta}</span>}
                            {q.vendorPhone && <span>📞 {q.vendorPhone}</span>}
                          </div>
                        </button>
                      );
                    })}
                  </div>
                )}
              </div>

              <div className="space-y-1.5">
                <Label className="text-sm font-semibold">Catatan untuk Vendor (opsional)</Label>
                <Textarea
                  value={adminNote}
                  onChange={e => setAdminNote(e.target.value)}
                  rows={2}
                  placeholder="Instruksi khusus, prioritas, dll."
                />
              </div>

              <DialogFooter>
                <Button variant="outline" onClick={() => setOpen(false)}>Batal</Button>
                <Button
                  onClick={handleAssign}
                  disabled={loading || !selectedQuoteId}
                  className="bg-blue-600 hover:bg-blue-700 text-white"
                >
                  {loading ? <Loader2 className="w-4 h-4 animate-spin mr-1" /> : <CheckCircle2 className="w-4 h-4 mr-1" />}
                  Tugaskan Vendor
                </Button>
              </DialogFooter>
            </div>
          ) : (
            <div className="space-y-4 py-2">
              <div className="bg-green-50 border border-green-200 rounded-xl p-4">
                <p className="text-green-800 font-semibold text-sm">✅ Vendor berhasil ditugaskan!</p>
                <p className="text-green-700 text-xs mt-1">Job order telah dibuat dan notifikasi WhatsApp disiapkan.</p>
              </div>

              <div className="space-y-2">
                <Label className="text-sm font-semibold">Link Job Order (untuk Vendor)</Label>
                <div className="flex items-center gap-2">
                  <Input readOnly value={result.jobUrl} className="text-xs font-mono" />
                  <Button variant="outline" size="icon" onClick={() => copyText(result.jobUrl, "Link Job Order")}>
                    <Copy className="w-4 h-4" />
                  </Button>
                  <a href={result.jobUrl} target="_blank" rel="noopener noreferrer">
                    <Button variant="outline" size="icon"><ExternalLink className="w-4 h-4" /></Button>
                  </a>
                </div>
              </div>

              {result.trackingUrl && (
                <div className="space-y-2">
                  <Label className="text-sm font-semibold">Link Tracking (untuk Customer)</Label>
                  <div className="flex items-center gap-2">
                    <Input readOnly value={result.trackingUrl} className="text-xs font-mono" />
                    <Button variant="outline" size="icon" onClick={() => copyText(result.trackingUrl!, "Link Tracking")}>
                      <Copy className="w-4 h-4" />
                    </Button>
                    <a href={result.trackingUrl} target="_blank" rel="noopener noreferrer">
                      <Button variant="outline" size="icon"><ExternalLink className="w-4 h-4" /></Button>
                    </a>
                  </div>
                </div>
              )}

              <div className="space-y-2">
                <Label className="text-sm font-semibold">Pesan WhatsApp (copy-paste ke vendor)</Label>
                <div className="relative">
                  <Textarea readOnly value={result.waMessage} rows={8} className="text-xs font-mono pr-10" />
                  <Button
                    variant="ghost" size="icon"
                    className="absolute top-2 right-2 h-7 w-7"
                    onClick={() => copyText(result.waMessage, "Pesan WA")}
                  >
                    <Copy className="w-3.5 h-3.5" />
                  </Button>
                </div>
                {result.vendorPhone && (
                  <p className="text-xs text-slate-500">
                    📞 Nomor vendor: <strong>{result.vendorPhone}</strong>
                    {" · "}
                    <a
                      href={`https://wa.me/${result.vendorPhone.replace(/\D/g, "")}?text=${encodeURIComponent(result.waMessage)}`}
                      target="_blank" rel="noopener noreferrer"
                      className="text-green-600 underline font-medium"
                    >
                      Buka WhatsApp
                    </a>
                  </p>
                )}
              </div>

              <DialogFooter>
                <Button variant="outline" onClick={() => { setOpen(false); setResult(null); }}>Tutup</Button>
              </DialogFooter>
            </div>
          )}
        </DialogContent>
      </Dialog>
    </>
  );
}

// ── Job Order Status Panel ─────────────────────────────────────────────────────

function JobOrderPanel({ orderId }: { orderId: number }) {
  const { toast } = useToast();
  const qc = useQueryClient();
  const [progressStatus, setProgressStatus] = useState("");
  const [progressNotes, setProgressNotes] = useState("");
  const [updatingProgress, setUpdatingProgress] = useState(false);
  const [completingReview, setCompletingReview] = useState(false);

  const { data, refetch } = useQuery<JobOrderData>({
    queryKey: ["order-job", orderId],
    queryFn: () => apiFetch(`/api/logistic/orders/${orderId}/job-order`),
    enabled: !isNaN(orderId),
    refetchInterval: 20000,
  });

  const copyText = (text: string, label: string) => {
    navigator.clipboard.writeText(text);
    toast({ title: `${label} disalin!` });
  };

  const handleAddProgress = async () => {
    if (!progressStatus) return;
    setUpdatingProgress(true);
    try {
      await apiFetch(`/api/logistic/orders/${orderId}/job-progress`, {
        method: "POST",
        body: JSON.stringify({ status: progressStatus, notes: progressNotes, isPublic: true }),
      });
      toast({ title: "Progress diperbarui" });
      setProgressStatus(""); setProgressNotes("");
      refetch();
      qc.invalidateQueries({ queryKey: ["order-detail", orderId] });
    } catch (e: unknown) {
      toast({ title: "Gagal", description: (e as Error).message, variant: "destructive" });
    } finally {
      setUpdatingProgress(false);
    }
  };

  const handleCompleteReview = async () => {
    setCompletingReview(true);
    try {
      await apiFetch(`/api/logistic/orders/${orderId}/complete-review`, {
        method: "POST",
        body: JSON.stringify({ sendCustomerNotif: true }),
      });
      toast({ title: "Order ditandai Completed", description: "Notifikasi dikirim ke customer." });
      refetch();
      qc.invalidateQueries({ queryKey: ["order-detail", orderId] });
    } catch (e: unknown) {
      toast({ title: "Gagal", description: (e as Error).message, variant: "destructive" });
    } finally {
      setCompletingReview(false);
    }
  };

  if (!data?.jobOrder) return null;

  const job = data.jobOrder;
  const JOB_STATUS_STYLE: Record<string, string> = {
    pending:          "bg-amber-50 border-amber-200 text-amber-800",
    accepted:         "bg-green-50 border-green-200 text-green-800",
    rejected:         "bg-red-50 border-red-200 text-red-800",
    in_progress:      "bg-blue-50 border-blue-200 text-blue-800",
    pickup_scheduled: "bg-indigo-50 border-indigo-200 text-indigo-800",
    completed:        "bg-emerald-50 border-emerald-200 text-emerald-800",
    problem:          "bg-orange-50 border-orange-200 text-orange-800",
  };

  const STATUS_PROGRESS_OPTIONS = [
    "Pickup Scheduled", "In Progress", "In Transit", "Delivered", "Completed", "Problem",
  ];

  return (
    <Card className="border-blue-200">
      <CardHeader className="pb-3">
        <CardTitle className="text-sm font-semibold text-blue-700 uppercase tracking-wide flex items-center gap-1.5">
          <MapPin className="w-4 h-4" /> Job Order & Tracking
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        {/* Job status */}
        <div className={`rounded-xl border px-3 py-2.5 text-sm font-medium ${JOB_STATUS_STYLE[job.status] ?? "bg-slate-50 border-slate-200 text-slate-700"}`}>
          Status: {job.status}
          {job.vendor_name && <span className="ml-2 font-normal">· {job.vendor_name}</span>}
        </div>

        {/* Links */}
        {data.jobUrl && (
          <div className="flex items-center gap-2">
            <span className="text-xs text-slate-500 min-w-fit">Job Order:</span>
            <code className="text-xs text-slate-600 truncate flex-1 bg-slate-50 px-2 py-1 rounded">{data.jobUrl}</code>
            <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => copyText(data.jobUrl!, "Link Job Order")}>
              <Copy className="h-3.5 w-3.5" />
            </Button>
            <a href={data.jobUrl} target="_blank" rel="noopener noreferrer">
              <Button variant="ghost" size="icon" className="h-7 w-7"><ExternalLink className="h-3.5 w-3.5" /></Button>
            </a>
          </div>
        )}
        {data.trackingUrl && (
          <div className="flex items-center gap-2">
            <span className="text-xs text-slate-500 min-w-fit">Tracking:</span>
            <code className="text-xs text-slate-600 truncate flex-1 bg-slate-50 px-2 py-1 rounded">{data.trackingUrl}</code>
            <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => copyText(data.trackingUrl!, "Link Tracking")}>
              <Copy className="h-3.5 w-3.5" />
            </Button>
            <a href={data.trackingUrl} target="_blank" rel="noopener noreferrer">
              <Button variant="ghost" size="icon" className="h-7 w-7"><ExternalLink className="h-3.5 w-3.5" /></Button>
            </a>
          </div>
        )}

        {/* Operational details (if accepted) */}
        {(job.status === "accepted" || job.status === "in_progress" || job.status === "completed") && (
          <div className="bg-slate-50 rounded-lg px-3 py-2.5 text-xs space-y-1">
            {job.driver_name && <div><span className="text-slate-400">Driver:</span> <span className="font-medium">{job.driver_name}</span> {job.driver_phone && `· ${job.driver_phone}`}</div>}
            {job.vehicle_plate && <div><span className="text-slate-400">Kendaraan:</span> <span className="font-medium">{job.vehicle_plate}</span></div>}
            {job.carrier && <div><span className="text-slate-400">Carrier:</span> <span className="font-medium">{job.carrier}</span></div>}
            {job.eta && <div><span className="text-slate-400">ETA:</span> <span className="font-medium">{job.eta}</span></div>}
          </div>
        )}

        {/* Rejected */}
        {job.status === "rejected" && (
          <div className="bg-red-50 rounded-lg px-3 py-2 text-xs text-red-700">
            ❌ Vendor menolak job.{job.reject_reason ? ` Alasan: ${job.reject_reason}` : ""}
          </div>
        )}

        {/* Admin: add progress */}
        {job.status !== "pending" && job.status !== "rejected" && job.status !== "completed" && (
          <div className="space-y-2 border-t border-slate-100 pt-3">
            <p className="text-xs font-semibold text-slate-600">Tambah Update Progress</p>
            <Select value={progressStatus} onValueChange={setProgressStatus}>
              <SelectTrigger className="h-8 text-xs"><SelectValue placeholder="Pilih status..." /></SelectTrigger>
              <SelectContent>
                {STATUS_PROGRESS_OPTIONS.map(s => <SelectItem key={s} value={s}>{s}</SelectItem>)}
              </SelectContent>
            </Select>
            <Textarea
              value={progressNotes}
              onChange={e => setProgressNotes(e.target.value)}
              rows={1}
              placeholder="Keterangan (opsional)"
              className="text-xs"
            />
            <Button
              onClick={handleAddProgress}
              disabled={updatingProgress || !progressStatus}
              size="sm"
              className="w-full bg-blue-600 hover:bg-blue-700 text-white"
            >
              {updatingProgress ? <Loader2 className="w-3.5 h-3.5 animate-spin mr-1" /> : null}
              Tambah Progress
            </Button>
          </div>
        )}

        {/* Admin: complete review */}
        {(job.status === "completed" || job.status === "pod_uploaded") && (
          <Button
            onClick={handleCompleteReview}
            disabled={completingReview}
            size="sm"
            className="w-full bg-emerald-600 hover:bg-emerald-700 text-white mt-2"
          >
            {completingReview ? <Loader2 className="w-3.5 h-3.5 animate-spin mr-1" /> : <CheckCircle2 className="w-3.5 h-3.5 mr-1" />}
            Konfirmasi Selesai & Notif Customer
          </Button>
        )}

        {/* Progress timeline */}
        {data.progress.length > 0 && (
          <div className="border-t border-slate-100 pt-3 space-y-2">
            <p className="text-xs font-semibold text-slate-500 uppercase tracking-wide">Riwayat Progress</p>
            <div className="max-h-48 overflow-y-auto space-y-2">
              {[...data.progress].reverse().map(p => (
                <div key={p.id} className="text-xs border-l-2 border-blue-100 pl-2">
                  <span className="font-medium text-slate-700">{p.status}</span>
                  {p.notes && <p className="text-slate-500">{p.notes}</p>}
                  <p className="text-slate-400">
                    {new Date(p.created_at).toLocaleString("id-ID", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" })}
                    {" · "}{p.updated_by}
                  </p>
                </div>
              ))}
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

// ── Customer Invoice Panel (Tahap 10) ─────────────────────────────────────────

type InvoiceLink = {
  id: number; token: string; invoiceNumber: string | null;
  customerName: string | null; grandTotal: string | null;
  currency: string | null; dueDate: string | null;
  paymentStatus: string | null; acknowledgedAt: string | null;
  viewedAt: string | null; status: string; createdAt: string;
  proofUrl: string | null; proofUploadedAt: string | null; proofRemarks: string | null;
};

function CustomerInvoicePanel({
  orderId, order, salesDocId,
}: {
  orderId: number;
  order: Order;
  salesDocId: number | null | undefined;
}) {
  const { toast } = useToast();
  const [open, setOpen] = useState(false);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [sending, setSending] = useState(false);
  const [resending, setResending] = useState<number | null>(null);

  const today = new Date().toISOString().slice(0, 10);
  const defaultDue = new Date(Date.now() + 14 * 86400000).toISOString().slice(0, 10);

  const [form, setForm] = useState({
    phone: order.phone ?? "",
    invoiceNumber: "",
    notes: "",
    dueDate: defaultDue,
  });
  const [result, setResult] = useState<{ url: string; token: string } | null>(null);

  const { data: links = [], refetch } = useQuery<InvoiceLink[]>({
    queryKey: ["customer-invoice-links", orderId],
    queryFn: () => apiFetch(`/api/vendor-form/admin/customer-invoices?orderId=${orderId}`),
    enabled: open,
    staleTime: 15000,
  });

  const openDialog = () => {
    setForm({ phone: order.phone ?? "", invoiceNumber: "", notes: "", dueDate: defaultDue });
    setResult(null);
    setDialogOpen(true);
  };

  const handleCreate = async () => {
    setSending(true);
    try {
      const body: Record<string, unknown> = {
        orderId,
        orderNumber: order.orderNumber,
        customerName: order.customerName,
        customerPhone: form.phone || undefined,
        invoiceNumber: form.invoiceNumber || undefined,
        dueDate: form.dueDate || undefined,
        notes: form.notes || undefined,
        currency: "IDR",
        sendWa: true,
      };
      if (salesDocId) body.salesDocId = salesDocId;
      const res = await fetch("/api/vendor-form/admin/customer-invoices", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify(body),
      });
      const d = await res.json() as { success?: boolean; url?: string; token?: string; error?: string };
      if (!res.ok) throw new Error(d.error ?? "Gagal");
      setResult({ url: d.url ?? "", token: d.token ?? "" });
      toast({ title: "✅ Link invoice dibuat", description: form.phone ? "WA otomatis dikirim ke customer" : "Salin link di bawah" });
      void refetch();
    } catch (e: unknown) {
      toast({ title: "Error", description: (e as Error).message, variant: "destructive" });
    } finally {
      setSending(false);
    }
  };

  const handleResendWa = async (linkId: number, phone: string) => {
    const p = prompt("No. WhatsApp customer (format: 628...):", phone);
    if (!p) return;
    setResending(linkId);
    try {
      const res = await fetch(`/api/vendor-form/admin/customer-invoices/${linkId}/send-wa`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ phone: p }),
      });
      const d = await res.json() as { ok?: boolean; error?: string };
      if (!res.ok) throw new Error(d.error ?? "Gagal");
      toast({ title: "✅ WA terkirim ulang" });
    } catch (e: unknown) {
      toast({ title: "Gagal kirim WA", description: (e as Error).message, variant: "destructive" });
    } finally {
      setResending(null);
    }
  };

  const copyLink = (url: string) => {
    navigator.clipboard.writeText(url);
    toast({ title: "Link disalin!" });
  };

  const fmtMoney = (v: string | null) =>
    v == null ? "—" : `Rp ${Math.round(Number(v)).toLocaleString("id-ID")}`;

  const payBadge = (s: string | null) => {
    if (s === "paid") return <span className="text-[10px] font-semibold text-green-700 bg-green-100 px-1.5 py-0.5 rounded-full">Lunas</span>;
    if (s === "partial") return <span className="text-[10px] font-semibold text-amber-700 bg-amber-100 px-1.5 py-0.5 rounded-full">Sebagian</span>;
    return <span className="text-[10px] font-semibold text-red-700 bg-red-100 px-1.5 py-0.5 rounded-full">Belum Bayar</span>;
  };

  return (
    <>
      <Card className="border-emerald-200">
        <CardHeader
          className="pb-2 cursor-pointer select-none"
          onClick={() => setOpen(v => !v)}
        >
          <div className="flex items-center justify-between">
            <CardTitle className="text-sm font-semibold text-emerald-700 uppercase tracking-wide flex items-center gap-1.5">
              <FileText className="w-4 h-4" />
              Invoice & Pembayaran
              <span className="ml-1 text-[10px] font-normal normal-case text-slate-400 bg-emerald-50 border border-emerald-200 px-1.5 py-0.5 rounded-full">
                Tahap 10
              </span>
              {links.length > 0 && (
                <span className="text-xs font-normal normal-case text-slate-400">({links.length})</span>
              )}
            </CardTitle>
            <div className="flex items-center gap-2">
              {open && (
                <button
                  onClick={e => { e.stopPropagation(); void refetch(); }}
                  className="text-slate-400 hover:text-slate-600"
                  title="Refresh"
                >
                  <RefreshCw className="w-3.5 h-3.5" />
                </button>
              )}
              {open ? <ChevronUp className="w-4 h-4 text-slate-400" /> : <ChevronDown className="w-4 h-4 text-slate-400" />}
            </div>
          </div>
        </CardHeader>

        {open && (
          <CardContent className="pt-0 space-y-3">
            {/* Existing links */}
            <QueryState empty={links.length === 0} emptyMessage="Belum ada link invoice untuk order ini">
              <div className="space-y-2">
                {links.map(lnk => (
                  <div
                    key={lnk.id}
                    className={`rounded-lg border px-3 py-2.5 space-y-2 ${lnk.acknowledgedAt ? "border-green-200 bg-green-50/40" : "border-slate-100"}`}
                  >
                    <div className="flex items-center justify-between gap-2 flex-wrap">
                      <div className="flex items-center gap-2 flex-wrap">
                        {lnk.invoiceNumber && (
                          <span className="text-xs font-mono font-semibold text-emerald-800">{lnk.invoiceNumber}</span>
                        )}
                        {payBadge(lnk.paymentStatus)}
                        {lnk.acknowledgedAt && (
                          <span className="text-[10px] text-green-600 font-medium">✅ Dikonfirmasi customer</span>
                        )}
                        {lnk.viewedAt && !lnk.acknowledgedAt && (
                          <span className="text-[10px] text-blue-500">👁 Sudah dilihat</span>
                        )}
                      </div>
                      <div className="flex gap-1">
                        <Button
                          variant="ghost" size="icon" className="h-6 w-6"
                          title="Kirim ulang WA"
                          disabled={resending === lnk.id}
                          onClick={() => void handleResendWa(lnk.id, order.phone ?? "")}
                        >
                          {resending === lnk.id
                            ? <Loader2 className="h-3 w-3 animate-spin" />
                            : <Send className="h-3 w-3 text-green-600" />}
                        </Button>
                        <Button
                          variant="ghost" size="icon" className="h-6 w-6"
                          title="Salin link"
                          onClick={() => copyLink(`${window.location.origin}/customer-invoice/${lnk.token}`)}
                        >
                          <Copy className="h-3 w-3" />
                        </Button>
                        <a
                          href={`/customer-invoice/${lnk.token}`}
                          target="_blank" rel="noopener noreferrer"
                        >
                          <Button variant="ghost" size="icon" className="h-6 w-6" title="Buka link">
                            <ExternalLink className="h-3 w-3" />
                          </Button>
                        </a>
                      </div>
                    </div>
                    <div className="flex gap-x-4 gap-y-0.5 flex-wrap text-[11px] text-slate-500">
                      {lnk.grandTotal && <span>Total: <strong>{fmtMoney(lnk.grandTotal)}</strong></span>}
                      {lnk.dueDate && (
                        <span className={new Date(lnk.dueDate) < new Date() && lnk.paymentStatus !== "paid" ? "text-red-500 font-medium" : ""}>
                          Jatuh tempo: {new Date(lnk.dueDate).toLocaleDateString("id-ID", { day: "numeric", month: "short", year: "numeric" })}
                        </span>
                      )}
                      <span className="text-slate-400">
                        Dibuat: {new Date(lnk.createdAt).toLocaleString("id-ID", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" })}
                      </span>
                    </div>
                    <PaymentProofPreview
                      proofUrl={lnk.proofUrl}
                      proofUploadedAt={lnk.proofUploadedAt}
                      proofRemarks={lnk.proofRemarks}
                      compact
                    />
                  </div>
                ))}
              </div>
            </QueryState>

            {/* Create button */}
            <Button
              size="sm" className="w-full bg-emerald-600 hover:bg-emerald-700 text-white"
              onClick={openDialog}
            >
              <Plus className="w-3.5 h-3.5 mr-1" />
              Buat & Kirim Link Invoice
            </Button>
          </CardContent>
        )}
      </Card>

      {/* Create Invoice Dialog */}
      <Dialog open={dialogOpen} onOpenChange={v => { if (!sending) { setDialogOpen(v); if (!v) setResult(null); } }}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <FileText className="w-4 h-4 text-emerald-600" />
              Buat Link Invoice Customer
            </DialogTitle>
          </DialogHeader>

          {result ? (
            <div className="space-y-4 py-2">
              <div className="bg-green-50 border border-green-200 rounded-xl p-4 text-center">
                <p className="text-2xl mb-1">✅</p>
                <p className="font-semibold text-green-700 text-sm">Link Invoice Berhasil Dibuat</p>
                {form.phone && (
                  <p className="text-xs text-green-600 mt-1">WA otomatis dikirim ke customer</p>
                )}
              </div>
              <div className="space-y-1">
                <Label className="text-xs text-slate-500">Link Invoice (untuk customer)</Label>
                <div className="flex gap-2">
                  <input
                    readOnly
                    value={`${window.location.origin}/customer-invoice/${result.token}`}
                    className="flex-1 text-xs rounded-lg border border-slate-200 px-2 py-1.5 bg-slate-50 font-mono truncate"
                  />
                  <Button
                    size="sm" variant="outline"
                    onClick={() => copyLink(`${window.location.origin}/customer-invoice/${result.token}`)}
                  >
                    <Copy className="w-3.5 h-3.5" />
                  </Button>
                </div>
              </div>
              <Button
                className="w-full bg-emerald-600 hover:bg-emerald-700 text-white"
                onClick={() => { setDialogOpen(false); setResult(null); }}
              >
                Selesai
              </Button>
            </div>
          ) : (
            <div className="space-y-4 py-2">
              <div className="bg-slate-50 rounded-lg px-3 py-2 text-sm space-y-0.5">
                <p><span className="text-slate-400 text-xs">Order:</span> <span className="font-mono font-semibold">{order.orderNumber}</span></p>
                <p><span className="text-slate-400 text-xs">Customer:</span> {order.customerName}</p>
                {salesDocId && (
                  <p className="text-xs text-emerald-600">✓ Data rincian harga dari Sales Order akan diambil otomatis</p>
                )}
              </div>

              <div className="space-y-1.5">
                <Label className="text-xs">No. Invoice <span className="text-slate-400">(opsional)</span></Label>
                <Input
                  value={form.invoiceNumber}
                  onChange={e => setForm(f => ({ ...f, invoiceNumber: e.target.value }))}
                  placeholder="INV/2026/001"
                  className="h-9 text-sm"
                />
              </div>

              <div className="space-y-1.5">
                <Label className="text-xs">No. WhatsApp Customer</Label>
                <Input
                  value={form.phone}
                  onChange={e => setForm(f => ({ ...f, phone: e.target.value }))}
                  placeholder="6281234567890"
                  className="h-9 text-sm font-mono"
                />
              </div>

              <div className="space-y-1.5">
                <Label className="text-xs">Jatuh Tempo Pembayaran</Label>
                <DatePicker value={form.dueDate} onChange={v => setForm(f => ({ ...f, dueDate: v }))} className="h-9 text-sm" />
              </div>

              <div className="space-y-1.5">
                <Label className="text-xs">Catatan <span className="text-slate-400">(opsional)</span></Label>
                <Textarea
                  value={form.notes}
                  onChange={e => setForm(f => ({ ...f, notes: e.target.value }))}
                  placeholder="Catatan pembayaran, cara transfer, rekening bank, dll."
                  rows={3}
                  className="text-sm resize-none"
                />
              </div>

              {form.phone && (
                <div className="flex items-center gap-2 py-1 px-2.5 rounded-lg bg-green-50 border border-green-200">
                  <span className="text-sm">📲</span>
                  <span className="text-xs text-green-700">WA otomatis dikirim ke nomor di atas</span>
                </div>
              )}

              <DialogFooter>
                <Button variant="outline" onClick={() => setDialogOpen(false)} disabled={sending}>Batal</Button>
                <Button
                  className="bg-emerald-600 hover:bg-emerald-700 text-white"
                  onClick={() => void handleCreate()}
                  disabled={sending}
                >
                  {sending ? <><Loader2 className="w-3.5 h-3.5 mr-1.5 animate-spin" />Membuat...</> : <><Send className="w-3.5 h-3.5 mr-1.5" />Buat & Kirim</>}
                </Button>
              </DialogFooter>
            </div>
          )}
        </DialogContent>
      </Dialog>
    </>
  );
}

// ── Payment Summary Panel ──────────────────────────────────────────────────────

type SalesDocSummary = {
  id: number; docNumber: string; status: string; invoiceStatus: string;
  customerName: string; totalAmount: number; taxAmount: number;
  grandTotal: number; amountPaid: number;
  lines: { id: number; name: string; quantity: number; unitPrice: number; subtotal: number }[];
};

type Journal = { id: number; name: string; type: string; code: string };
type Payment = {
  id: number; paymentType: string; amount: number; date: string;
  ref: string | null; memo: string | null; partnerName: string | null;
  journalId: number; status: string; voidReason: string | null; createdAt: string;
};

function PaymentSummaryPanel({
  salesDocId, soNumber,
}: {
  salesDocId: number | null | undefined;
  soNumber: string | null | undefined;
}) {
  const { toast } = useToast();
  const qc = useQueryClient();
  const today = new Date().toISOString().slice(0, 10);

  const { data: doc, isLoading, isError, refetch } = useQuery<SalesDocSummary>({
    queryKey: ["sales-doc-summary", salesDocId],
    queryFn: () => apiFetch(`/api/sales/documents/${salesDocId}`),
    enabled: salesDocId != null,
    staleTime: 30000,
  });

  const { data: allJournals = [] } = useQuery<Journal[]>({
    queryKey: ["accounting-journals"],
    queryFn: () => apiFetch("/api/accounting/journals"),
    staleTime: 60000,
  });
  const bankCashJournals = allJournals.filter(j => j.type === "bank" || j.type === "cash");

  const { data: payments = [], refetch: refetchPayments } = useQuery<Payment[]>({
    queryKey: ["so-payments", salesDocId],
    queryFn: () => apiFetch(`/api/accounting/payments?sourceType=sales_order&sourceDocId=${salesDocId}`),
    enabled: salesDocId != null,
    staleTime: 30000,
  });
  const journalMap = Object.fromEntries(allJournals.map(j => [j.id, j]));

  const [payOpen, setPayOpen] = useState(false);
  const [paying, setPaying] = useState(false);
  const [payForm, setPayForm] = useState({
    journalId: "",
    date: today,
    ref: "",
    memo: "",
    amount: "",
  });

  const outstanding = doc ? Math.max(0, doc.grandTotal - doc.amountPaid) : 0;
  const pctPaid = doc && doc.grandTotal > 0 ? Math.round((doc.amountPaid / doc.grandTotal) * 100) : 0;

  const openPayDialog = () => {
    setPayForm({
      journalId: bankCashJournals.length > 0 ? String(bankCashJournals[0]!.id) : "",
      date: today,
      ref: doc?.docNumber ?? soNumber ?? "",
      memo: `Pembayaran ${doc?.docNumber ?? soNumber ?? "SO"}`,
      amount: String(Math.round(outstanding)),
    });
    setPayOpen(true);
  };

  const submitPayment = async () => {
    if (!payForm.journalId || !payForm.date || !payForm.amount) {
      toast({ title: "Lengkapi data pembayaran", variant: "destructive" }); return;
    }
    const amt = Number(payForm.amount);
    if (Number.isNaN(amt) || amt <= 0) {
      toast({ title: "Jumlah harus lebih dari 0", variant: "destructive" }); return;
    }
    setPaying(true);
    try {
      await apiFetch("/api/accounting/payments", {
        method: "POST",
        body: JSON.stringify({
          paymentType: "inbound",
          amount: amt,
          journalId: Number(payForm.journalId),
          partnerName: doc?.customerName ?? "",
          date: payForm.date,
          ref: payForm.ref || undefined,
          memo: payForm.memo || undefined,
          sourceType: "sales_order",
          sourceDocId: salesDocId,
        }),
      });
      toast({ title: "✅ Pembayaran dicatat", description: `${idr(amt)} berhasil direkam ke jurnal` });
      setPayOpen(false);
      void refetch();
      void refetchPayments();
      void qc.invalidateQueries({ queryKey: ["sales-doc-summary", salesDocId] });
      void qc.invalidateQueries({ queryKey: ["so-payments", salesDocId] });
    } catch (e: unknown) {
      toast({ title: "Gagal catat pembayaran", description: (e as Error).message, variant: "destructive" });
    } finally {
      setPaying(false);
    }
  };

  const invoiceBadge = (s: string) => {
    if (s === "invoiced") return <span className="text-[10px] font-semibold text-green-700 bg-green-100 px-1.5 py-0.5 rounded-full">Invoiced</span>;
    if (s === "to_invoice") return <span className="text-[10px] font-semibold text-amber-700 bg-amber-100 px-1.5 py-0.5 rounded-full">Belum Invoice</span>;
    return <span className="text-[10px] font-semibold text-slate-500 bg-slate-100 px-1.5 py-0.5 rounded-full">—</span>;
  };

  const statusBadge = (s: string) => {
    const map: Record<string, string> = {
      draft: "bg-slate-100 text-slate-600",
      sent: "bg-blue-100 text-blue-700",
      confirmed: "bg-emerald-100 text-emerald-700",
      done: "bg-green-200 text-green-900",
      cancelled: "bg-red-100 text-red-700",
    };
    const labels: Record<string, string> = { draft: "Draft", sent: "Terkirim", confirmed: "Dikonfirmasi", done: "Selesai", cancelled: "Dibatalkan" };
    return (
      <span className={`text-[10px] font-semibold px-1.5 py-0.5 rounded-full ${map[s] ?? "bg-slate-100 text-slate-600"}`}>
        {labels[s] ?? s}
      </span>
    );
  };

  if (!salesDocId) {
    return (
      <Card className="border-dashed border-slate-200">
        <CardContent className="py-4">
          <p className="text-xs text-slate-400 text-center">
            Ringkasan pembayaran tersedia setelah customer menyetujui penawaran dan Sales Order dibuat.
          </p>
        </CardContent>
      </Card>
    );
  }

  return (
    <>
      <Card className="border-indigo-200">
        <CardHeader className="pb-3">
          <div className="flex items-center justify-between">
            <CardTitle className="text-sm font-semibold text-indigo-700 uppercase tracking-wide flex items-center gap-1.5">
              <ClipboardList className="w-4 h-4" />
              Ringkasan Pembayaran SO
            </CardTitle>
            <div className="flex items-center gap-1.5">
              {doc && statusBadge(doc.status)}
              {doc && invoiceBadge(doc.invoiceStatus)}
              <button
                onClick={() => void refetch()}
                className="text-slate-400 hover:text-slate-600"
                title="Refresh"
              >
                <RefreshCw className="w-3.5 h-3.5" />
              </button>
            </div>
          </div>
          {(doc?.docNumber ?? soNumber) && (
            <div className="flex items-center gap-2 mt-0.5">
              <span className="font-mono text-xs text-slate-500">{doc?.docNumber ?? soNumber}</span>
              <Link href={`/sales/documents/${salesDocId}`}>
                <ExternalLink className="w-3 h-3 text-indigo-400 hover:text-indigo-600 cursor-pointer" />
              </Link>
            </div>
          )}
        </CardHeader>

        <CardContent className="pt-0 space-y-3">
          <QueryState loading={isLoading} error={isError ? new Error("Gagal memuat data SO") : null} empty={!isLoading && !isError && !doc}>
            {doc && <>
              {/* Line items */}
              {doc.lines.length > 0 && (
                <div className="rounded-lg border border-slate-100 overflow-hidden">
                  <table className="w-full text-xs">
                    <thead>
                      <tr className="bg-slate-50 border-b border-slate-100">
                        <th className="text-left px-3 py-1.5 text-slate-500 font-medium">Item</th>
                        <th className="text-right px-3 py-1.5 text-slate-500 font-medium">Qty</th>
                        <th className="text-right px-3 py-1.5 text-slate-500 font-medium">Subtotal</th>
                      </tr>
                    </thead>
                    <tbody>
                      {doc.lines.map(l => (
                        <tr key={l.id} className="border-b border-slate-50 last:border-0">
                          <td className="px-3 py-1.5 text-slate-700">{l.name}</td>
                          <td className="px-3 py-1.5 text-right text-slate-500">{l.quantity}</td>
                          <td className="px-3 py-1.5 text-right font-mono text-slate-700">
                            {idr(l.subtotal)}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}

              {/* Totals */}
              <div className="rounded-lg bg-indigo-50/60 border border-indigo-100 px-3 py-2.5 space-y-1.5 text-sm">
                <div className="flex justify-between text-xs text-slate-500">
                  <span>Subtotal</span>
                  <span className="font-mono">{idr(doc.totalAmount)}</span>
                </div>
                {doc.taxAmount > 0 && (
                  <div className="flex justify-between text-xs text-slate-500">
                    <span>PPN</span>
                    <span className="font-mono">{idr(doc.taxAmount)}</span>
                  </div>
                )}
                <div className="flex justify-between font-semibold text-slate-800 border-t border-indigo-100 pt-1.5">
                  <span className="text-xs">Total Tagihan</span>
                  <span className="font-mono text-indigo-800">{idr(doc.grandTotal)}</span>
                </div>
                <div className="flex justify-between text-xs text-emerald-600">
                  <span>Sudah Dibayar</span>
                  <span className="font-mono font-semibold">{idr(doc.amountPaid)}</span>
                </div>
                <div className={`flex justify-between text-xs font-semibold ${outstanding > 0 ? "text-red-600" : "text-emerald-600"}`}>
                  <span>Sisa Outstanding</span>
                  <span className="font-mono">{outstanding > 0 ? idr(outstanding) : "✓ Lunas"}</span>
                </div>
              </div>

              {/* Progress bar */}
              {doc.grandTotal > 0 && (
                <div className="space-y-1">
                  <div className="flex justify-between text-[10px] text-slate-400">
                    <span>Progress Pembayaran</span>
                    <span>{pctPaid}%</span>
                  </div>
                  <div className="h-1.5 rounded-full bg-slate-100 overflow-hidden">
                    <div
                      className={`h-full rounded-full transition-all ${pctPaid >= 100 ? "bg-emerald-500" : pctPaid > 0 ? "bg-indigo-400" : "bg-slate-200"}`}
                      style={{ width: `${Math.min(pctPaid, 100)}%` }}
                    />
                  </div>
                </div>
              )}

              {/* Riwayat Pembayaran */}
              {payments.length > 0 && (
                <div className="space-y-1.5">
                  <p className="text-[10px] font-semibold text-slate-500 uppercase tracking-wide">
                    Riwayat Pembayaran ({payments.length})
                  </p>
                  <div className="space-y-1 max-h-40 overflow-y-auto">
                    {payments.map(p => {
                      const isVoided = p.status === "void";
                      const jrnl = journalMap[p.journalId];
                      return (
                        <div
                          key={p.id}
                          className={`rounded-lg border px-3 py-2 text-xs ${isVoided ? "border-slate-100 bg-slate-50 opacity-60" : "border-emerald-100 bg-emerald-50/50"}`}
                        >
                          <div className="flex items-center justify-between gap-2">
                            <span className={`font-mono font-semibold ${isVoided ? "line-through text-slate-400" : "text-emerald-700"}`}>
                              {idr(p.amount)}
                            </span>
                            <div className="flex items-center gap-1.5 shrink-0">
                              {isVoided && (
                                <span className="text-[9px] font-bold text-red-500 bg-red-50 border border-red-200 px-1 py-0.5 rounded">VOID</span>
                              )}
                              <span className="text-slate-400">
                                {new Date(p.date).toLocaleDateString("id-ID", { day: "numeric", month: "short", year: "numeric" })}
                              </span>
                            </div>
                          </div>
                          <div className="flex items-center gap-2 mt-0.5 flex-wrap">
                            {jrnl && (
                              <span className="text-slate-400">{jrnl.name}</span>
                            )}
                            {p.ref && (
                              <span className="text-slate-500 font-medium">#{p.ref}</span>
                            )}
                            {p.memo && (
                              <span className="text-slate-400 truncate">{p.memo}</span>
                            )}
                          </div>
                          {isVoided && p.voidReason && (
                            <p className="text-[10px] text-red-400 mt-0.5">Void: {p.voidReason}</p>
                          )}
                        </div>
                      );
                    })}
                  </div>
                </div>
              )}

              {/* Action buttons */}
              <div className="flex gap-2">
                {outstanding > 0 && (
                  <Button
                    size="sm"
                    className="flex-1 bg-indigo-600 hover:bg-indigo-700 text-white text-xs"
                    onClick={openPayDialog}
                  >
                    <Plus className="w-3.5 h-3.5 mr-1" />
                    Catat Pembayaran
                  </Button>
                )}
                <Link href={`/sales/documents/${salesDocId}`} className={outstanding > 0 ? "" : "flex-1"}>
                  <Button
                    variant="outline" size="sm"
                    className={`text-xs border-indigo-200 text-indigo-600 hover:bg-indigo-50 ${outstanding > 0 ? "" : "w-full"}`}
                  >
                    <ExternalLink className="w-3 h-3 mr-1.5" />
                    Buka Detail SO
                  </Button>
                </Link>
              </div>
            </>}
          </QueryState>
        </CardContent>
      </Card>

      {/* Catat Pembayaran Dialog */}
      <Dialog open={payOpen} onOpenChange={v => { if (!paying) setPayOpen(v); }}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <ClipboardList className="w-4 h-4 text-indigo-600" />
              Catat Pembayaran Masuk
            </DialogTitle>
          </DialogHeader>

          <div className="space-y-3 py-1">
            {/* SO info */}
            <div className="bg-indigo-50 rounded-lg px-3 py-2 text-xs space-y-0.5">
              <p><span className="text-slate-400">SO:</span> <span className="font-mono font-semibold">{doc?.docNumber ?? soNumber}</span></p>
              <p><span className="text-slate-400">Customer:</span> {doc?.customerName}</p>
              <p>
                <span className="text-slate-400">Outstanding:</span>{" "}
                <span className="font-semibold text-red-600">{idr(outstanding)}</span>
              </p>
            </div>

            {/* Jurnal */}
            <div className="space-y-1.5">
              <Label className="text-xs">Jurnal Kas/Bank <span className="text-red-500">*</span></Label>
              {bankCashJournals.length === 0 ? (
                <p className="text-xs text-amber-600 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2">
                  Belum ada jurnal Kas/Bank. Buat dulu di menu Akuntansi → Jurnal.
                </p>
              ) : (
                <Select value={payForm.journalId} onValueChange={v => setPayForm(f => ({ ...f, journalId: v }))}>
                  <SelectTrigger className="h-9 text-sm">
                    <SelectValue placeholder="Pilih jurnal..." />
                  </SelectTrigger>
                  <SelectContent>
                    {bankCashJournals.map(j => (
                      <SelectItem key={j.id} value={String(j.id)}>
                        [{j.code}] {j.name} ({j.type === "bank" ? "Bank" : "Kas"})
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              )}
            </div>

            {/* Tanggal */}
            <div className="space-y-1.5">
              <Label className="text-xs">Tanggal Pembayaran <span className="text-red-500">*</span></Label>
              <DatePicker value={payForm.date} onChange={v => setPayForm(f => ({ ...f, date: v }))} className="h-9 text-sm" />
            </div>

            {/* Jumlah */}
            <div className="space-y-1.5">
              <Label className="text-xs">Jumlah Diterima (IDR) <span className="text-red-500">*</span></Label>
              <Input
                type="number"
                value={payForm.amount}
                onChange={e => setPayForm(f => ({ ...f, amount: e.target.value }))}
                placeholder="0"
                min={1}
                className="h-9 text-sm font-mono"
              />
              {outstanding > 0 && Number(payForm.amount) > 0 && Number(payForm.amount) < outstanding && (
                <p className="text-[10px] text-amber-600">
                  Pembayaran sebagian — sisa {idr(outstanding - Number(payForm.amount))}
                </p>
              )}
            </div>

            {/* Referensi */}
            <div className="space-y-1.5">
              <Label className="text-xs">Referensi <span className="text-slate-400">(opsional)</span></Label>
              <Input
                value={payForm.ref}
                onChange={e => setPayForm(f => ({ ...f, ref: e.target.value }))}
                placeholder="No. transfer / cek / bukti"
                className="h-9 text-sm"
              />
            </div>

            {/* Memo */}
            <div className="space-y-1.5">
              <Label className="text-xs">Memo <span className="text-slate-400">(opsional)</span></Label>
              <Input
                value={payForm.memo}
                onChange={e => setPayForm(f => ({ ...f, memo: e.target.value }))}
                className="h-9 text-sm"
              />
            </div>
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={() => setPayOpen(false)} disabled={paying}>Batal</Button>
            <Button
              className="bg-indigo-600 hover:bg-indigo-700 text-white"
              onClick={() => void submitPayment()}
              disabled={paying || !payForm.journalId}
            >
              {paying
                ? <><Loader2 className="w-3.5 h-3.5 mr-1.5 animate-spin" />Menyimpan...</>
                : <><CheckCircle2 className="w-3.5 h-3.5 mr-1.5" />Catat Pembayaran</>}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}

// ── Update Status Dialog ───────────────────────────────────────────────────────

function UpdateStatusDialog({ orderId, currentStatus, currentVersion, onUpdated }: { orderId: number; currentStatus: string; currentVersion?: number; onUpdated: () => void }) {
  const [open, setOpen] = useState(false);
  const [status, setStatus] = useState(currentStatus);
  const [notes, setNotes] = useState("");
  const [loading, setLoading] = useState(false);
  const { toast } = useToast();

  const handleUpdate = async () => {
    setLoading(true);
    try {
      await apiFetch(`/api/logistic/orders/${orderId}/status`, {
        method: "PATCH",
        body: JSON.stringify({
          status,
          notes,
          ...(currentVersion !== undefined ? { version: currentVersion } : {}),
        }),
      });
      toast({ title: "Status diperbarui" });
      setOpen(false);
      onUpdated();
    } catch (e: unknown) {
      const err = e as { status?: number; message?: string };
      if (err?.status === 409) {
        toast({
          title: "Konflik perubahan",
          description: "Data sudah diubah oleh pengguna lain. Refresh halaman dan coba lagi.",
          variant: "destructive",
        });
        setOpen(false);
        onUpdated();
      } else {
        toast({ title: "Gagal", description: (e as Error).message, variant: "destructive" });
      }
    } finally {
      setLoading(false);
    }
  };

  return (
    <>
      <Button variant="outline" size="sm" onClick={() => setOpen(true)}>
        <ClipboardList className="w-4 h-4 mr-1" />
        Update Status
      </Button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-w-sm">
          <DialogHeader><DialogTitle>Update Status Order</DialogTitle></DialogHeader>
          <div className="space-y-4 py-2">
            <div className="space-y-1.5">
              <Label>Status Baru</Label>
              <Select value={status} onValueChange={setStatus}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  {ORDER_STATUSES.map(s => <SelectItem key={s} value={s}>{s}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label>Catatan (opsional)</Label>
              <Textarea value={notes} onChange={e => setNotes(e.target.value)} rows={2} placeholder="Catatan untuk timeline..." />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setOpen(false)}>Batal</Button>
            <Button onClick={handleUpdate} disabled={loading}>
              {loading ? <Loader2 className="w-4 h-4 animate-spin mr-1" /> : null}
              Simpan
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}

// ── Timeline helpers ───────────────────────────────────────────────────────────

function timelineIcon(status: string | null): React.ReactNode {
  const s = (status ?? "").toLowerCase();
  if (s.includes("vmf") || s.includes("link")) return <Link2 className="w-3.5 h-3.5 text-violet-500" />;
  if (s.includes("so dibuat") || s.includes("sales order") || s.includes("so ")) return <FileText className="w-3.5 h-3.5 text-blue-500" />;
  if (s.includes("gagal") || s.includes("error") || s.includes("reject") || s.includes("tolak")) return <AlertTriangle className="w-3.5 h-3.5 text-red-500" />;
  if (s.includes("approv") || s.includes("setuju") || s.includes("confirm") || s.includes("completed")) return <CheckCircle2 className="w-3.5 h-3.5 text-emerald-500" />;
  if (s.includes("customer") || s.includes("quotat") || s.includes("quote") || s.includes("penawaran")) return <User className="w-3.5 h-3.5 text-purple-500" />;
  if (s.includes("vendor") || s.includes("rfq")) return <Truck className="w-3.5 h-3.5 text-blue-500" />;
  if (s.includes("wa") || s.includes("whatsapp") || s.includes("notif")) return <MessageCircle className="w-3.5 h-3.5 text-green-500" />;
  if (s.includes("op-confirm") || s.includes("op confirm") || s.includes("operational")) return <ClipboardCheck className="w-3.5 h-3.5 text-orange-500" />;
  if (s.includes("status")) return <ClipboardList className="w-3.5 h-3.5 text-slate-500" />;
  return <StickyNote className="w-3.5 h-3.5 text-slate-400" />;
}

function timelineDotColor(u: OrderUpdate): string {
  const s = (u.status ?? "").toLowerCase();
  if (s.includes("gagal") || s.includes("error") || s.includes("reject")) return "bg-red-400";
  if (s.includes("approv") || s.includes("setuju") || s.includes("confirm") || s.includes("completed")) return "bg-emerald-400";
  if (u.isPublic) return "bg-teal-400";
  return "bg-blue-400";
}

// ── Audit Trail Panel ──────────────────────────────────────────────────────────

type AuditEvent = {
  id: string;
  ts: string;
  category: "order" | "rfq" | "status" | "vendor" | "customer" | "wa" | "email" | "driver" | "pod" | "note" | "system";
  label: string;
  detail?: string | null;
  actor?: string | null;
};

const CATEGORY_DOT: Record<string, string> = {
  order:    "bg-blue-500",
  rfq:      "bg-violet-500",
  status:   "bg-slate-400",
  vendor:   "bg-orange-400",
  customer: "bg-purple-500",
  wa:       "bg-green-500",
  email:    "bg-sky-400",
  driver:   "bg-amber-400",
  pod:      "bg-emerald-500",
  note:     "bg-teal-400",
  system:   "bg-slate-300",
};

function auditCategoryIcon(cat: string): React.ReactNode {
  if (cat === "order")    return <Package className="w-3 h-3 text-blue-500" />;
  if (cat === "rfq")      return <ClipboardList className="w-3 h-3 text-violet-500" />;
  if (cat === "status")   return <ClipboardCheck className="w-3 h-3 text-slate-400" />;
  if (cat === "vendor")   return <Truck className="w-3 h-3 text-orange-400" />;
  if (cat === "customer") return <User className="w-3 h-3 text-purple-500" />;
  if (cat === "wa")       return <MessageCircle className="w-3 h-3 text-green-500" />;
  if (cat === "email")    return <Send className="w-3 h-3 text-sky-400" />;
  if (cat === "driver")   return <Navigation className="w-3 h-3 text-amber-400" />;
  if (cat === "pod")      return <Camera className="w-3 h-3 text-emerald-500" />;
  if (cat === "note")     return <StickyNote className="w-3 h-3 text-teal-400" />;
  return <Bell className="w-3 h-3 text-slate-400" />;
}

function fmtTime(ts: string): string {
  return new Date(ts).toLocaleTimeString("id-ID", { hour: "2-digit", minute: "2-digit" });
}

function fmtDate(ts: string): string {
  return new Date(ts).toLocaleDateString("id-ID", { day: "numeric", month: "short", year: "numeric" });
}

function AuditTrailPanel({ orderId }: { orderId: number }) {
  const qc = useQueryClient();

  const { data, isLoading, isFetching, refetch } = useQuery<{ orderNumber: string; timeline: AuditEvent[] }>({
    queryKey: ["audit-trail", orderId],
    queryFn: () => apiFetch(`/api/logistic/orders/${orderId}/audit-trail`),
    enabled: !isNaN(orderId),
    staleTime: 10000,
  });

  const timeline = data?.timeline ?? [];

  const grouped: { date: string; events: AuditEvent[] }[] = [];
  for (const ev of timeline) {
    const d = fmtDate(ev.ts);
    const last = grouped[grouped.length - 1];
    if (last && last.date === d) {
      last.events.push(ev);
    } else {
      grouped.push({ date: d, events: [ev] });
    }
  }

  return (
    <Card className="sticky top-6">
      <CardHeader className="pb-2">
        <div className="flex items-center justify-between">
          <CardTitle className="text-sm font-semibold text-slate-600 uppercase tracking-wide flex items-center gap-1.5">
            <Clock className="w-4 h-4" /> Riwayat Order
            {timeline.length > 0 && (
              <span className="ml-1 text-xs font-normal normal-case text-slate-400">({timeline.length})</span>
            )}
          </CardTitle>
          <div className="flex items-center gap-1">
            <AddTimelineNoteDialog
              orderId={orderId}
              onAdded={() => {
                qc.invalidateQueries({ queryKey: ["order-detail", orderId] });
                refetch();
              }}
            />
            <Button
              variant="ghost"
              size="sm"
              className="h-7 w-7 p-0 text-slate-400 hover:text-slate-700"
              onClick={() => refetch()}
              disabled={isFetching}
            >
              <RefreshCw className={`w-3.5 h-3.5 ${isFetching ? "animate-spin" : ""}`} />
            </Button>
          </div>
        </div>
        <div className="flex flex-wrap gap-x-3 gap-y-1 text-xs text-slate-400 mt-1">
          <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-full bg-blue-500 inline-block" />Order</span>
          <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-full bg-violet-500 inline-block" />RFQ</span>
          <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-full bg-orange-400 inline-block" />Vendor</span>
          <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-full bg-purple-500 inline-block" />Customer</span>
          <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-full bg-green-500 inline-block" />WA</span>
          <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-full bg-emerald-500 inline-block" />POD</span>
        </div>
      </CardHeader>
      <CardContent className="max-h-[700px] overflow-y-auto pt-2 pb-3">
        <QueryState loading={isLoading} empty={timeline.length === 0} emptyMessage="Belum ada aktivitas" skeletonRows={3}>
          <div className="space-y-4">
            {grouped.map((group) => (
              <div key={group.date}>
                <div className="flex items-center gap-2 mb-2">
                  <div className="flex-1 h-px bg-slate-100" />
                  <span className="text-xs text-slate-400 font-medium whitespace-nowrap">{group.date}</span>
                  <div className="flex-1 h-px bg-slate-100" />
                </div>
                <div className="relative pl-5">
                  <div className="absolute left-2 top-0 bottom-0 w-0.5 bg-slate-100" />
                  <div className="space-y-2">
                    {group.events.map((ev) => (
                      <div key={ev.id} className="relative text-sm">
                        <div className={`absolute -left-[17px] top-1.5 w-2.5 h-2.5 rounded-full ${CATEGORY_DOT[ev.category] ?? "bg-slate-300"}`} />
                        <div className="flex items-start gap-1.5 min-h-[1.5rem]">
                          <span className="text-xs text-slate-400 font-mono tabular-nums whitespace-nowrap pt-0.5 shrink-0">
                            {fmtTime(ev.ts)}
                          </span>
                          <div className="flex-1 min-w-0">
                            <div className="flex items-center gap-1 flex-wrap">
                              {auditCategoryIcon(ev.category)}
                              <span className="text-xs font-medium text-slate-700 leading-snug">{ev.label}</span>
                            </div>
                            {ev.detail && (
                              <p className="text-xs text-slate-500 leading-snug mt-0.5 break-words">{ev.detail}</p>
                            )}
                            {ev.actor && (
                              <p className="text-xs text-slate-400 mt-0.5 flex items-center gap-0.5">
                                <User className="w-2.5 h-2.5" />
                                {ev.actor}
                              </p>
                            )}
                          </div>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              </div>
            ))}
          </div>
        </QueryState>
      </CardContent>
    </Card>
  );
}

// ── Add Timeline Note Dialog ───────────────────────────────────────────────────

function AddTimelineNoteDialog({ orderId, onAdded }: { orderId: number; onAdded: () => void }) {
  const [open, setOpen] = useState(false);
  const [notes, setNotes] = useState("");
  const [isPublic, setIsPublic] = useState(false);
  const [loading, setLoading] = useState(false);
  const { toast } = useToast();

  const handleSubmit = async () => {
    if (!notes.trim()) { toast({ title: "Catatan tidak boleh kosong", variant: "destructive" }); return; }
    setLoading(true);
    try {
      await apiFetch(`/api/logistic/orders/${orderId}/updates`, {
        method: "POST",
        body: JSON.stringify({ notes: notes.trim(), isPublic }),
      });
      toast({ title: "Catatan berhasil ditambahkan" });
      setNotes("");
      setIsPublic(false);
      setOpen(false);
      onAdded();
    } catch (e: unknown) {
      toast({ title: "Gagal", description: (e as Error).message, variant: "destructive" });
    } finally {
      setLoading(false);
    }
  };

  return (
    <>
      <Button variant="ghost" size="sm" className="h-7 px-2 text-xs text-slate-500 hover:text-slate-800" onClick={() => setOpen(true)}>
        <Plus className="w-3 h-3 mr-1" /> Tambah Catatan
      </Button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-w-sm">
          <DialogHeader><DialogTitle>Tambah Catatan ke Timeline</DialogTitle></DialogHeader>
          <div className="space-y-4 py-2">
            <div className="space-y-1.5">
              <Label>Catatan <span className="text-red-500">*</span></Label>
              <Textarea
                value={notes}
                onChange={e => setNotes(e.target.value)}
                rows={3}
                placeholder="Tulis catatan internal atau update untuk customer..."
              />
            </div>
            <div className="flex items-center gap-2">
              <Switch id="isPublic" checked={isPublic} onCheckedChange={setIsPublic} />
              <Label htmlFor="isPublic" className="cursor-pointer flex items-center gap-1">
                {isPublic ? <Globe className="w-3.5 h-3.5 text-teal-500" /> : <EyeOff className="w-3.5 h-3.5 text-slate-400" />}
                {isPublic ? "Tampil ke Customer (Publik)" : "Internal (Tidak Tampil ke Customer)"}
              </Label>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setOpen(false)}>Batal</Button>
            <Button onClick={handleSubmit} disabled={loading}>
              {loading ? <Loader2 className="w-4 h-4 animate-spin mr-1" /> : <Plus className="w-4 h-4 mr-1" />}
              Simpan
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}

// ── Exception Panel ───────────────────────────────────────────────────────────

const EXCEPTION_TYPE_LABEL: Record<string, string> = {
  vendor_no_response:  "Vendor Tidak Respon",
  customer_reject:     "Customer Menolak",
  damaged_goods:       "Barang Rusak",
  missing_goods:       "Barang Kurang",
  document_missing:    "Dokumen Kurang",
  delivery_failed:     "Gagal Antar",
  failed_delivery:     "Gagal Antar",
  payment_issue:       "Masalah Pembayaran",
  payment_overdue:     "Pembayaran Terlambat",
  pricing_dispute:     "Sengketa Harga",
  order_rejected:      "Order Ditolak",
  vendor_reject_rfq:   "Vendor Tolak RFQ",
  vendor_out_of_stock: "Stok Habis",
  price_changed:       "Harga Berubah",
  delivery_delayed:    "Pengiriman Terlambat",
  customer_complaint:  "Komplain Customer",
  vendor_rejected:     "Vendor Ditolak",
  pod_pending_review:  "POD Ditinjau",
};

const EXCEPTION_TYPES = [
  "vendor_no_response", "customer_reject", "damaged_goods", "missing_goods",
  "document_missing", "delivery_failed", "payment_issue", "pricing_dispute",
  "order_rejected", "vendor_reject_rfq", "delivery_delayed", "customer_complaint",
  "vendor_out_of_stock",
] as const;

const EXCEPTION_STATUS_LABEL: Record<string, string> = {
  open:          "Terbuka",
  investigating: "Investigasi",
  in_progress:   "Diproses",
  resolved:      "Selesai",
  rejected:      "Ditolak",
  closed:        "Ditutup",
};

const EXCEPTION_STATUS_COLOR: Record<string, string> = {
  open:          "bg-red-100 text-red-700",
  investigating: "bg-orange-100 text-orange-700",
  in_progress:   "bg-yellow-100 text-yellow-700",
  resolved:      "bg-green-100 text-green-700",
  rejected:      "bg-gray-100 text-gray-600",
  closed:        "bg-gray-100 text-gray-500",
};

const EXCEPTION_SEVERITY_COLOR: Record<string, string> = {
  critical: "bg-red-600 text-white",
  high:     "bg-orange-500 text-white",
  medium:   "bg-yellow-500 text-white",
  low:      "bg-green-500 text-white",
};

interface OrderException {
  id: number;
  exceptionType: string;
  severity: string;
  status: string;
  title: string;
  description: string | null;
  resolutionNotes: string | null;
  createdBy: string | null;
  createdAt: string;
  resolvedAt: string | null;
  resolvedBy: string | null;
}

function ExceptionPanel({ orderId }: { orderId: number }) {
  const qc = useQueryClient();
  const { toast } = useToast();
  const [createOpen, setCreateOpen] = useState(false);
  const [resolveId, setResolveId] = useState<number | null>(null);
  const [resolutionNotes, setResolutionNotes] = useState("");
  const [collapsed, setCollapsed] = useState(false);

  const [form, setForm] = useState({
    exceptionType: "",
    severity: "medium",
    title: "",
    description: "",
  });

  const { data, isLoading, refetch } = useQuery<{ data: OrderException[]; total: number }>({
    queryKey: ["order-exceptions", orderId],
    queryFn: () => apiFetch(`/api/logistic/orders/${orderId}/exceptions`),
    enabled: !isNaN(orderId),
    staleTime: 15000,
  });

  const exceptions = data?.data ?? [];
  const openCount = exceptions.filter(e => e.status === "open" || e.status === "investigating").length;

  const createMut = useMutation({
    mutationFn: () => apiFetch(`/api/logistic/orders/${orderId}/exceptions`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(form),
    }),
    onSuccess: () => {
      toast({ title: "Exception dilaporkan", description: "Tim admin telah diberitahu via WA." });
      setCreateOpen(false);
      setForm({ exceptionType: "", severity: "medium", title: "", description: "" });
      qc.invalidateQueries({ queryKey: ["order-exceptions", orderId] });
      qc.invalidateQueries({ queryKey: ["audit-trail", orderId] });
    },
    onError: (e: Error) => toast({ title: "Gagal", description: e.message, variant: "destructive" }),
  });

  const statusMut = useMutation({
    mutationFn: ({ id, status, notes }: { id: number; status: string; notes?: string }) =>
      apiFetch(`/api/logistic/exceptions/${id}/status`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status, resolutionNotes: notes }),
      }),
    onSuccess: () => {
      toast({ title: "Status diperbarui" });
      setResolveId(null);
      setResolutionNotes("");
      qc.invalidateQueries({ queryKey: ["order-exceptions", orderId] });
    },
    onError: (e: Error) => toast({ title: "Gagal", description: e.message, variant: "destructive" }),
  });

  return (
    <Card>
      <CardHeader className="pb-3 cursor-pointer" onClick={() => setCollapsed(c => !c)}>
        <div className="flex items-center justify-between">
          <CardTitle className="text-sm font-semibold text-slate-600 uppercase tracking-wide flex items-center gap-1.5">
            <ShieldAlert className="w-4 h-4 text-red-500" />
            Exception
            {openCount > 0 && (
              <span className="ml-1 inline-flex items-center justify-center w-5 h-5 rounded-full bg-red-500 text-white text-xs font-bold">
                {openCount}
              </span>
            )}
          </CardTitle>
          <div className="flex items-center gap-2">
            <Button
              size="sm"
              variant="outline"
              className="h-7 text-xs gap-1 text-red-600 border-red-200 hover:bg-red-50"
              onClick={(e) => { e.stopPropagation(); setCreateOpen(true); }}
            >
              <Plus className="w-3 h-3" /> Laporkan
            </Button>
            {collapsed ? <ChevronDown className="w-4 h-4 text-slate-400" /> : <ChevronUp className="w-4 h-4 text-slate-400" />}
          </div>
        </div>
      </CardHeader>

      {!collapsed && (
        <CardContent className="pt-0 space-y-2">
          <QueryState loading={isLoading} empty={exceptions.length === 0} emptyMessage="Tidak ada exception" skeletonRows={1} skeletonRowClassName="h-8">
          {exceptions.map((exc) => (
            <div key={exc.id} className="rounded-lg border p-3 space-y-1.5 text-sm">
              <div className="flex items-start gap-1.5 flex-wrap">
                <span className={`inline-flex items-center px-1.5 py-0.5 rounded text-xs font-semibold ${EXCEPTION_SEVERITY_COLOR[exc.severity] ?? "bg-gray-200 text-gray-700"}`}>
                  {exc.severity.toUpperCase()}
                </span>
                <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium ${EXCEPTION_STATUS_COLOR[exc.status] ?? "bg-gray-100 text-gray-600"}`}>
                  {EXCEPTION_STATUS_LABEL[exc.status] ?? exc.status}
                </span>
                <span className="text-xs text-muted-foreground">
                  {EXCEPTION_TYPE_LABEL[exc.exceptionType] ?? exc.exceptionType}
                </span>
              </div>
              <p className="font-medium text-slate-800 leading-snug">{exc.title}</p>
              {exc.description && <p className="text-xs text-slate-500">{exc.description}</p>}
              {exc.resolutionNotes && (
                <p className="text-xs text-green-700 bg-green-50 rounded px-2 py-1">
                  <span className="font-medium">Resolusi:</span> {exc.resolutionNotes}
                </p>
              )}
              <div className="flex items-center justify-between pt-0.5">
                <span className="text-xs text-muted-foreground">
                  {dt(exc.createdAt)}{exc.createdBy ? ` · ${exc.createdBy}` : ""}
                </span>
                {exc.status !== "resolved" && exc.status !== "closed" && exc.status !== "rejected" && (
                  <div className="flex gap-1">
                    {exc.status === "open" && (
                      <Button
                        size="sm"
                        variant="ghost"
                        className="h-6 px-2 text-xs text-orange-600 hover:bg-orange-50"
                        onClick={() => statusMut.mutate({ id: exc.id, status: "investigating" })}
                        disabled={statusMut.isPending}
                      >
                        Investigasi
                      </Button>
                    )}
                    <Button
                      size="sm"
                      variant="ghost"
                      className="h-6 px-2 text-xs text-green-600 hover:bg-green-50"
                      onClick={() => { setResolveId(exc.id); setResolutionNotes(""); }}
                    >
                      Selesaikan
                    </Button>
                  </div>
                )}
              </div>
            </div>
          ))}
          </QueryState>
        </CardContent>
      )}

      {/* Create Dialog */}
      <Dialog open={createOpen} onOpenChange={setCreateOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-1.5">
              <ShieldAlert className="w-4 h-4 text-red-500" /> Laporkan Exception
            </DialogTitle>
          </DialogHeader>
          <div className="space-y-3 py-2">
            <div className="space-y-1">
              <Label>Tipe Exception *</Label>
              <Select value={form.exceptionType} onValueChange={(v) => setForm(f => ({ ...f, exceptionType: v }))}>
                <SelectTrigger>
                  <SelectValue placeholder="Pilih tipe masalah..." />
                </SelectTrigger>
                <SelectContent>
                  {EXCEPTION_TYPES.map((t) => (
                    <SelectItem key={t} value={t}>
                      {EXCEPTION_TYPE_LABEL[t] ?? t}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1">
              <Label>Severity</Label>
              <Select value={form.severity} onValueChange={(v) => setForm(f => ({ ...f, severity: v }))}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="low">🟢 Low</SelectItem>
                  <SelectItem value="medium">🟡 Medium</SelectItem>
                  <SelectItem value="high">🟠 High</SelectItem>
                  <SelectItem value="critical">🔴 Critical</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1">
              <Label>Judul *</Label>
              <Input
                value={form.title}
                onChange={(e) => setForm(f => ({ ...f, title: e.target.value }))}
                placeholder="Ringkasan singkat masalah..."
              />
            </div>
            <div className="space-y-1">
              <Label>Deskripsi</Label>
              <Textarea
                value={form.description}
                onChange={(e) => setForm(f => ({ ...f, description: e.target.value }))}
                placeholder="Detail masalah, kronologi, tindakan yang sudah dilakukan..."
                rows={3}
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setCreateOpen(false)}>Batal</Button>
            <Button
              onClick={() => createMut.mutate()}
              disabled={!form.exceptionType || !form.title.trim() || createMut.isPending}
              className="bg-red-600 hover:bg-red-700"
            >
              {createMut.isPending && <Loader2 className="w-4 h-4 mr-1 animate-spin" />}
              Laporkan
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Resolve Dialog */}
      <Dialog open={resolveId !== null} onOpenChange={() => { setResolveId(null); setResolutionNotes(""); }}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle>Selesaikan Exception</DialogTitle>
          </DialogHeader>
          <div className="space-y-2 py-2">
            <Label>Catatan Resolusi</Label>
            <Textarea
              value={resolutionNotes}
              onChange={(e) => setResolutionNotes(e.target.value)}
              placeholder="Tindakan yang diambil, hasil akhir..."
              rows={3}
            />
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setResolveId(null)}>Batal</Button>
            <Button
              onClick={() => resolveId && statusMut.mutate({ id: resolveId, status: "resolved", notes: resolutionNotes })}
              disabled={statusMut.isPending}
              className="bg-green-600 hover:bg-green-700"
            >
              {statusMut.isPending && <Loader2 className="w-4 h-4 mr-1 animate-spin" />}
              Tandai Selesai
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </Card>
  );
}

// ── Main Page ──────────────────────────────────────────────────────────────────

export default function LogisticOrderDetailPage() {
  const { orderId: orderIdStr } = useParams<{ orderId: string }>();
  const orderId = Number(orderIdStr);
  const [, navigate] = useLocation();
  const { toast } = useToast();
  const [lightboxUrl, setLightboxUrl] = useState<string | null>(null);
  const qc = useQueryClient();

  const { data, isLoading, refetch } = useQuery<DetailData>({
    queryKey: ["order-detail", orderId],
    queryFn: () => apiFetch(`/api/logistic/orders/${orderId}/detail`),
    enabled: !isNaN(orderId),
    refetchInterval: 15000,
  });

  const createCustomerLink = useMutation({
    mutationFn: () => apiFetch<{ ok: boolean; trackUrl: string }>(`/api/logistic/orders/${orderId}/create-customer-link`, { method: "POST" }),
    onSuccess: (r) => {
      toast({ title: "Tracking link dibuat" });
      navigator.clipboard.writeText(r.trackUrl).catch(() => {});
      qc.invalidateQueries({ queryKey: ["order-detail", orderId] });
    },
    onError: (e: Error) => toast({ title: "Gagal", description: e.message, variant: "destructive" }),
  });

  const resendWaGroup = useMutation({
    mutationFn: () => apiFetch<{ ok: boolean; message: string }>(`/api/logistic/orders/${orderId}/resend-wa-group`, { method: "POST" }),
    onSuccess: (r) => toast({ title: "✅ " + r.message }),
    onError: (e: Error) => toast({ title: "Gagal kirim WA", description: e.message, variant: "destructive" }),
  });

  const { data: fulfillmentData, refetch: refetchFulfillment } = useQuery<{ links: FulfillmentLink[]; submissions: FulfillmentSubmission[]; pods: PodSubmission[]; driverPods: DriverPodData[] }>({
    queryKey: ["order-fulfillment", orderId],
    queryFn: () => apiFetch(`/api/logistic/orders/${orderId}/fulfillment`),
    enabled: !isNaN(orderId),
    refetchInterval: 15000,
  });

  const { data: approvalData, refetch: refetchApprovals } = useQuery<CustomerApproval[]>({
    queryKey: ["order-approvals", orderId],
    queryFn: () => apiFetch(`/api/vendor-form/admin/customer-approvals?orderId=${orderId}`),
    enabled: !isNaN(orderId),
    refetchInterval: 30000,
  });

  const { data: driverProgressData } = useQuery<{ events: DriverProgressEvent[] }>({
    queryKey: ["order-driver-progress", orderId],
    queryFn: () => apiFetch(`/api/logistic/orders/${orderId}/progress`),
    enabled: !isNaN(orderId),
    refetchInterval: 30000,
  });

  const retrySoMut = useMutation({
    mutationFn: (approvalId: number) =>
      apiFetch<{ ok: boolean; docNumber: string; already?: boolean }>(
        `/api/vendor-form/admin/customer-approvals/${approvalId}/retry-so`,
        { method: "POST" }
      ),
    onSuccess: (r, approvalId) => {
      toast({
        title: r.already ? "SO sudah ada" : "✅ Sales Order berhasil dibuat",
        description: `Nomor SO: ${r.docNumber}`,
      });
      void refetchApprovals();
      qc.invalidateQueries({ queryKey: ["order-detail", orderId] });
    },
    onError: (e: Error) => toast({ title: "Gagal buat SO", description: e.message, variant: "destructive" }),
  });

  const confirmFulfillmentMut = useMutation({
    mutationFn: () => apiFetch<{ ok: boolean }>(`/api/logistic/orders/${orderId}/confirm-fulfillment`, { method: "POST" }),
    onSuccess: () => {
      toast({ title: "✅ Fulfillment dikonfirmasi", description: "Status diubah ke In Progress. WA dikirim ke customer." });
      qc.invalidateQueries({ queryKey: ["order-detail", orderId] });
      void refetchFulfillment();
    },
    onError: (e: Error) => toast({ title: "Gagal konfirmasi", description: e.message, variant: "destructive" }),
  });

  const resendConfirmWaMut = useMutation({
    mutationFn: () => apiFetch<{ ok: boolean; shortUrl: string; adminWaSent: boolean }>(
      "/api/admin-action/resend-confirm-wa",
      { method: "POST", body: JSON.stringify({ orderId: Number(orderId) }) }
    ),
    onSuccess: (data) => {
      if (data.adminWaSent) {
        toast({ title: "✅ WA konfirmasi terkirim ulang", description: `Link baru dikirim ke grup admin WA.` });
      } else {
        navigator.clipboard.writeText(data.shortUrl).catch(() => {});
        toast({ title: "✅ Link konfirmasi dibuat", description: "Admin WA tidak terkonfigurasi — link disalin ke clipboard." });
      }
    },
    onError: (e: Error) => toast({ title: "Gagal kirim ulang WA", description: e.message, variant: "destructive" }),
  });

  const resendFulfillWaMut = useMutation({
    mutationFn: () => apiFetch<{ ok: boolean; formUrl: string; vendorPhone: string | null; vendorName: string | null }>(
      `/api/logistic/orders/${orderId}/resend-fulfillment-wa`,
      { method: "POST" }
    ),
    onSuccess: (data) => {
      navigator.clipboard.writeText(data.formUrl).catch(() => {});
      toast({
        title: "✅ WA fulfillment dikirim ulang",
        description: data.vendorPhone
          ? `WA dikirim ke ${data.vendorName ?? "vendor"}. Link disalin ke clipboard.`
          : "Vendor tidak punya nomor WA — link disalin ke clipboard.",
      });
    },
    onError: (e: Error) => toast({ title: "Gagal kirim ulang WA", description: e.message, variant: "destructive" }),
  });

  const extendFulfillMut = useMutation({
    mutationFn: () => apiFetch<{ ok: boolean; newExpiresAt: string; hours: number }>(
      `/api/logistic/orders/${orderId}/extend-fulfillment`,
      { method: "PATCH", body: JSON.stringify({ extraHours: 72 }) }
    ),
    onSuccess: (data) => {
      const exp = new Date(data.newExpiresAt).toLocaleString("id-ID", { dateStyle: "short", timeStyle: "short" });
      toast({ title: "✅ Expiry diperpanjang", description: `Link berlaku sampai ${exp}.` });
      void refetchFulfillment();
    },
    onError: (e: Error) => toast({ title: "Gagal perpanjang expiry", description: e.message, variant: "destructive" }),
  });

  const [completeNote, setCompleteNote] = useState("");
  const [completeReceiver, setCompleteReceiver] = useState("");
  const [podPhotoFile, setPodPhotoFile] = useState<File | null>(null);
  const [podPhotoPreview, setPodPhotoPreview] = useState<string | null>(null);
  const [showCompleteDialog, setShowCompleteDialog] = useState(false);
  const [isGeneratingPodPdf, setIsGeneratingPodPdf] = useState(false);
  const podPdfRefs = useRef<Record<number, HTMLDivElement | null>>({});

  const completeOrderMut = useMutation({
    mutationFn: async ({ note, receiverName, photo }: { note: string; receiverName: string; photo: File | null }) => {
      const fd = new FormData();
      fd.append("note", note);
      fd.append("receiverName", receiverName);
      if (photo) fd.append("photo", photo);
      const res = await fetch(`/api/logistic/orders/${orderId}/pod`, { method: "POST", body: fd });
      const data = await res.json() as { ok?: boolean; message?: string };
      if (!res.ok) throw new Error(data.message ?? "Gagal menyimpan POD");
      return data;
    },
    onSuccess: () => {
      toast({ title: "✅ Bukti pengiriman tersimpan", description: "Status → Bukti Pengiriman. WA dikirim ke customer." });
      setShowCompleteDialog(false);
      setCompleteNote("");
      setCompleteReceiver("");
      setPodPhotoFile(null);
      setPodPhotoPreview(null);
      qc.invalidateQueries({ queryKey: ["order-detail", orderId] });
      void refetchFulfillment();
    },
    onError: (e: Error) => toast({ title: "Gagal upload bukti pengiriman", description: e.message, variant: "destructive" }),
  });

  const invoiceIssuedMut = useMutation({
    mutationFn: () => apiFetch<{ ok: boolean }>(`/api/logistic/orders/${orderId}/delivery/invoice-issued`, { method: "POST" }),
    onSuccess: () => {
      toast({ title: "✅ Invoice Diterbitkan", description: "WA dikirim ke customer." });
      qc.invalidateQueries({ queryKey: ["order-detail", orderId] });
    },
    onError: (e: Error) => toast({ title: "Gagal", description: e.message, variant: "destructive" }),
  });

  const paymentReceivedMut = useMutation({
    mutationFn: () => apiFetch<{ ok: boolean }>(`/api/logistic/orders/${orderId}/delivery/payment-received`, { method: "POST" }),
    onSuccess: () => {
      toast({ title: "✅ Pembayaran Dikonfirmasi", description: "Status → Pembayaran Diterima. WA dikirim ke customer." });
      qc.invalidateQueries({ queryKey: ["order-detail", orderId] });
    },
    onError: (e: Error) => toast({ title: "Gagal konfirmasi pembayaran", description: e.message, variant: "destructive" }),
  });

  const completedMut = useMutation({
    mutationFn: () => apiFetch<{ ok: boolean }>(`/api/logistic/orders/${orderId}/delivery/completed`, { method: "POST" }),
    onSuccess: () => {
      toast({ title: "✅ Order Selesai!", description: "WA konfirmasi terkirim ke customer." });
      qc.invalidateQueries({ queryKey: ["order-detail", orderId] });
    },
    onError: (e: Error) => toast({ title: "Gagal tandai selesai", description: e.message, variant: "destructive" }),
  });

  const handleDownloadPodPdf = async (pod: PodSubmission) => {
    const el = podPdfRefs.current[pod.id];
    if (!el) return;
    setIsGeneratingPodPdf(true);
    try {
      const [{ default: html2canvas }, { default: jsPDF }] = await Promise.all([
        import("html2canvas"),
        import("jspdf"),
      ]);
      const canvas = await html2canvas(el, { scale: 2, useCORS: true, backgroundColor: "#ffffff", logging: false });
      const imgData = canvas.toDataURL("image/png");
      const pdf = new jsPDF({ orientation: "portrait", unit: "mm", format: "a4" });
      const pdfWidth = pdf.internal.pageSize.getWidth();
      const pageHeight = pdf.internal.pageSize.getHeight();
      const pdfHeight = (canvas.height * pdfWidth) / canvas.width;
      if (pdfHeight <= pageHeight) {
        pdf.addImage(imgData, "PNG", 0, 0, pdfWidth, pdfHeight);
      } else {
        let heightLeft = pdfHeight;
        let position = 0;
        pdf.addImage(imgData, "PNG", 0, position, pdfWidth, pdfHeight);
        heightLeft -= pageHeight;
        while (heightLeft > 0) {
          position -= pageHeight;
          pdf.addPage();
          pdf.addImage(imgData, "PNG", 0, position, pdfWidth, pdfHeight);
          heightLeft -= pageHeight;
        }
      }
      pdf.save(`POD-${order?.orderNumber ?? pod.order_id}-${pod.id}.pdf`);
    } catch (err) {
      toast({ title: "Gagal generate PDF", variant: "destructive" });
    } finally {
      setIsGeneratingPodPdf(false);
    }
  };

  const copyUrl = (url: string) => {
    navigator.clipboard.writeText(url);
    toast({ title: "Link disalin!" });
  };

  if (isLoading || !data) {
    return (
      <AppShell>
        <div className="p-6">
          <LoadingSkeleton variant="detail" count={6} />
        </div>
      </AppShell>
    );
  }

  const { order, vendor, taskLinks, customerLinks, quoteLinks, rfqs, freightShipments = [] } = data;
  const activeRfqId = rfqs.find(r => r.status === "vendor_selected" || r.status === "open")?.id ?? rfqs[0]?.id ?? null;
  const hasVendorSelected = !!order.approvedVendorId;
  const quoteStatus = order.customerQuoteStatus;

  return (
    <AppShell>
      <div className="p-4 md:p-6 max-w-6xl mx-auto space-y-5">
        {/* Header */}
        <div className="flex flex-wrap items-start gap-3 justify-between">
          <div className="flex items-center gap-3">
            <Button variant="ghost" size="sm" onClick={() => navigate(`/logistics/portal-orders/${orderId}`)}>
              <ArrowLeft className="w-4 h-4 mr-1" /> Kembali
            </Button>
            <div>
              <h1 className="text-xl font-bold text-slate-900 flex items-center gap-2">
                <Package className="w-5 h-5 text-blue-500" />
                {order.orderNumber}
              </h1>
              <p className="text-sm text-slate-500">
                {order.shipmentType} · {order.origin} → {order.destination}
              </p>
            </div>
          </div>
          <div className="flex flex-wrap gap-2">
            <Button variant="outline" size="sm" onClick={() => refetch()}>
              <RefreshCw className="w-4 h-4" />
            </Button>
            <Link href={`/logistics/orders/${orderId}/audit-trail`}>
              <Button variant="outline" size="sm" className="gap-1.5 text-violet-700 border-violet-200 hover:bg-violet-50">
                <Shield className="w-4 h-4" /> Audit Trail
              </Button>
            </Link>
            <UpdateStatusDialog orderId={orderId} currentStatus={order.status} currentVersion={order.version} onUpdated={() => qc.invalidateQueries({ queryKey: ["order-detail", orderId] })} />
            <CreateTaskLinkDialog orderId={orderId} vendorId={order.approvedVendorId} onCreated={() => qc.invalidateQueries({ queryKey: ["order-detail", orderId] })} />
            {hasVendorSelected && (
              <CreateApprovalDialog order={order} onCreated={() => void refetchApprovals()} />
            )}
            {hasVendorSelected && activeRfqId && (
              <SendQuoteDialog order={order} rfqId={activeRfqId} onSent={() => qc.invalidateQueries({ queryKey: ["order-detail", orderId] })} />
            )}
            <AssignVendorDialog orderId={orderId} onAssigned={() => qc.invalidateQueries({ queryKey: ["order-detail", orderId] })} />
            {order.status === "Quotation Sent" ? (
              <div className="flex items-center gap-2 px-3 py-1.5 rounded-lg bg-amber-50 border border-amber-200 text-amber-700 text-xs font-medium">
                ⏳ Menunggu Persetujuan Customer — Forward ke vendor tersedia setelah customer menyetujui penawaran.
              </div>
            ) : (
              <SendFulfillmentDialog
                orderId={orderId}
                vendor={vendor}
                shipmentType={order.shipmentType}
                onSent={() => { qc.invalidateQueries({ queryKey: ["order-detail", orderId] }); void refetchFulfillment(); }}
              />
            )}
            <Button variant="outline" size="sm" onClick={() => createCustomerLink.mutate()} disabled={createCustomerLink.isPending}>
              <Plus className="w-4 h-4 mr-1" /> Tracking Link
            </Button>
            <Button
              variant="outline"
              size="sm"
              onClick={() => resendWaGroup.mutate()}
              disabled={resendWaGroup.isPending}
              title="Kirim ulang notifikasi order ke Admin Group WhatsApp"
            >
              {resendWaGroup.isPending
                ? <Loader2 className="w-4 h-4 animate-spin mr-1" />
                : <MessageCircle className="w-4 h-4 mr-1" />}
              Resend WA Grup
            </Button>
          </div>
        </div>

        {/* Order Progress Bar — 15 canonical steps */}
        <div className="rounded-xl border border-border bg-card px-4 py-3">
          <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-3 flex items-center gap-1.5">
            <ClipboardList className="w-3.5 h-3.5" /> Progress Order
          </p>
          <OrderProgressBar status={order.status} />
        </div>

        {/* Quote status banner */}
        {quoteStatus && (
          <div className={`rounded-xl p-3 flex items-center gap-2 text-sm font-medium ${STATUS_COLOR[quoteStatus] ?? "bg-slate-100 text-slate-700"}`}>
            {quoteStatus === "customer_approved" && "✅ Customer sudah menyetujui penawaran."}
            {quoteStatus === "customer_quoted" && "📤 Penawaran sudah dikirim ke customer, menunggu konfirmasi."}
            {quoteStatus === "customer_revision_requested" && "🔄 Customer meminta revisi. Perlu update penawaran."}
            {quoteStatus === "customer_rejected" && "❌ Customer menolak penawaran."}
          </div>
        )}

        <div className="grid grid-cols-1 lg:grid-cols-3 gap-5">
          {/* Left: Order Info */}
          <div className="lg:col-span-2 space-y-4">
            {/* Order Details */}
            <Card>
              <CardHeader className="pb-3">
                <CardTitle className="text-sm font-semibold text-slate-600 uppercase tracking-wide flex items-center gap-1.5">
                  <User className="w-4 h-4" /> Customer &amp; Pengiriman
                </CardTitle>
              </CardHeader>
              <CardContent className="grid grid-cols-2 gap-3 text-sm">
                <Field label="Customer" value={order.customerName} />
                <Field label="Telepon" value={order.phone} />
                <Field label="Email" value={order.email} />
                <Field label="Layanan" value={order.shipmentType} />
                <Field label="Asal" value={order.origin} />
                <Field label="Tujuan" value={order.destination} />
                {order.commodity && <Field label="Komoditi" value={order.commodity} />}
                {order.cargoDescription && <Field label="Deskripsi" value={order.cargoDescription} />}
                {order.grossWeight && <Field label="Berat" value={`${order.grossWeight} kg`} />}
                {order.volumeCbm && <Field label="Volume" value={`${order.volumeCbm} CBM`} />}
                {order.jumlahKoli != null && <Field label="Jumlah Koli" value={`${order.jumlahKoli} koli`} />}
                <Field label="Status" value={<Badge className={STATUS_COLOR[order.status] ?? "bg-slate-100 text-slate-700"}>{order.status}</Badge>} />
                <Field label="Order Dibuat" value={dt(order.createdAt)} />
              </CardContent>
            </Card>

            {/* Step 2: Product Template Info */}
            {order.categoryKey && (
              <Card>
                <CardHeader className="pb-3">
                  <CardTitle className="text-sm font-semibold text-slate-600 uppercase tracking-wide flex items-center gap-1.5">
                    <ClipboardList className="w-4 h-4" /> Template Produk
                  </CardTitle>
                </CardHeader>
                <CardContent className="space-y-3 text-sm">
                  <div className="grid grid-cols-2 gap-3">
                    <Field label="Category Key" value={order.categoryKey} />
                    {order.templateVersion && <Field label="Versi Template" value={order.templateVersion} />}
                    {order.templateId && <Field label="Template ID" value={String(order.templateId)} />}
                  </div>
                  {order.requiredDocs && order.requiredDocs.length > 0 && (
                    <div>
                      <p className="text-xs font-medium text-slate-500 uppercase tracking-wide mb-1.5">Dokumen Wajib</p>
                      <div className="flex flex-wrap gap-1.5">
                        {order.requiredDocs.map((doc, i) => (
                          <Badge key={i} variant="outline" className="text-xs text-blue-700 border-blue-200 bg-blue-50">{doc}</Badge>
                        ))}
                      </div>
                    </div>
                  )}
                </CardContent>
              </Card>
            )}

            {/* Financial */}
            <Card>
              <CardHeader className="pb-3">
                <CardTitle className="text-sm font-semibold text-slate-600 uppercase tracking-wide">💰 Financial</CardTitle>
              </CardHeader>
              <CardContent className="grid grid-cols-2 gap-3 text-sm">
                <Field label="Harga Vendor" value={idr(order.vendorCost ?? order.finalPrice)} />
                <Field label="Harga ke Customer" value={idr(order.finalSellingPrice)} />
                <Field label="Profit" value={
                  order.finalSellingPrice && order.vendorCost
                    ? idr(Number(order.finalSellingPrice) - Number(order.vendorCost))
                    : "—"
                } />
                <Field label="Margin" value={idr(order.orderMargin)} />
                {order.etaFinal && <Field label="ETA Final" value={order.etaFinal} />}
                {vendor && (
                  <Field label="Vendor Terpilih" value={<span className="text-blue-700 font-medium">{vendor.name}</span>} />
                )}
              </CardContent>
            </Card>

            {/* Quote Links */}
            {quoteLinks.length > 0 && (
              <Card>
                <CardHeader className="pb-3">
                  <CardTitle className="text-sm font-semibold text-slate-600 uppercase tracking-wide">📤 Penawaran Customer</CardTitle>
                </CardHeader>
                <CardContent className="space-y-2">
                  {quoteLinks.map(q => (
                    <div key={q.id} className="flex items-center justify-between text-sm border border-slate-100 rounded-lg px-3 py-2">
                      <div>
                        <Badge className={STATUS_COLOR[q.status] ?? "bg-slate-100 text-slate-700"}>{q.status}</Badge>
                        {q.finalCustomerPrice && <span className="ml-2 text-slate-600">{idr(q.finalCustomerPrice)}</span>}
                        <span className="text-xs text-slate-400 ml-2">{dt(q.createdAt)}</span>
                      </div>
                      <div className="flex gap-1">
                        <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => copyUrl(q.quoteUrl)}>
                          <Copy className="h-3.5 w-3.5" />
                        </Button>
                        <a href={q.quoteUrl} target="_blank" rel="noopener noreferrer">
                          <Button variant="ghost" size="icon" className="h-7 w-7">
                            <ExternalLink className="h-3.5 w-3.5" />
                          </Button>
                        </a>
                      </div>
                    </div>
                  ))}
                </CardContent>
              </Card>
            )}

            {/* Customer Approval & SO */}
            {hasVendorSelected && (
              <Card className="border-violet-200">
                <CardHeader className="pb-3">
                  <CardTitle className="text-sm font-semibold text-violet-700 uppercase tracking-wide flex items-center gap-1.5">
                    <CheckCircle2 className="w-4 h-4" /> Persetujuan Customer &amp; Sales Order
                  </CardTitle>
                </CardHeader>
                <CardContent className="space-y-3">
                  {(approvalData?.length ?? 0) === 0 && (
                    <div className="rounded-lg border border-dashed border-violet-200 bg-violet-50/40 px-4 py-5 text-center space-y-2">
                      <p className="text-sm text-slate-500">Belum ada link penawaran yang dikirim ke customer.</p>
                      <CreateApprovalDialog order={order} onCreated={() => void refetchApprovals()} />
                    </div>
                  )}
                  {approvalData?.map(a => {
                    const APPROVAL_COLOR: Record<string, string> = {
                      pending: "bg-amber-100 text-amber-700",
                      approved: "bg-emerald-100 text-emerald-800",
                      rejected: "bg-red-100 text-red-700",
                    };
                    const needsRetrySo = a.status === "approved" && !a.soNumber;
                    const approvalUrl = `${window.location.origin}/vendor-form/customer-approval/${a.token}`;
                    return (
                      <div key={a.id} className={`rounded-lg border px-3 py-3 space-y-2.5 ${a.status === "approved" ? "border-emerald-200 bg-emerald-50/40" : a.status === "rejected" ? "border-red-100" : "border-amber-100"}`}>
                        {/* Status row */}
                        <div className="flex items-center justify-between gap-2 flex-wrap">
                          <div className="flex items-center gap-2 flex-wrap">
                            <Badge className={APPROVAL_COLOR[a.status] ?? "bg-slate-100 text-slate-600"}>
                              {a.status === "approved" ? "✅ Disetujui" : a.status === "rejected" ? "❌ Ditolak" : "⏳ Menunggu"}
                            </Badge>
                            {a.customerName && <span className="text-sm font-medium text-slate-700">{a.customerName}</span>}
                            {a.sellingPrice && (
                              <span className="text-xs text-slate-500">{idr(a.sellingPrice)} {a.currency ?? "IDR"}</span>
                            )}
                          </div>
                          <div className="flex items-center gap-1">
                            <Button variant="ghost" size="icon" className="h-7 w-7" title="Salin link approval" onClick={() => { navigator.clipboard.writeText(approvalUrl); toast({ title: "Link disalin!" }); }}>
                              <Copy className="h-3.5 w-3.5" />
                            </Button>
                            <a href={approvalUrl} target="_blank" rel="noopener noreferrer">
                              <Button variant="ghost" size="icon" className="h-7 w-7" title="Buka halaman approval">
                                <ExternalLink className="h-3.5 w-3.5" />
                              </Button>
                            </a>
                          </div>
                        </div>

                        {/* SO Number row */}
                        <div className="flex items-center justify-between gap-2">
                          <div className="flex items-center gap-2 text-sm">
                            <FileText className="w-3.5 h-3.5 text-blue-400 shrink-0" />
                            {a.soNumber ? (
                              <>
                                <span className="text-slate-500 text-xs">SO:</span>
                                {a.salesDocId ? (
                                  <Link href={`/sales/documents/${a.salesDocId}`}>
                                    <span className="font-mono font-semibold text-blue-700 hover:underline cursor-pointer">{a.soNumber}</span>
                                  </Link>
                                ) : (
                                  <span className="font-mono font-semibold text-blue-700">{a.soNumber}</span>
                                )}
                              </>
                            ) : (
                              <span className="text-xs text-slate-400 italic">
                                {a.status === "approved" ? "SO belum terbuat" : "—"}
                              </span>
                            )}
                          </div>

                          {/* Retry SO button — hanya muncul saat approved tapi SO belum ada */}
                          {needsRetrySo && (
                            <Button
                              size="sm"
                              variant="outline"
                              className="h-7 text-xs border-blue-300 text-blue-700 hover:bg-blue-50 shrink-0"
                              disabled={retrySoMut.isPending}
                              onClick={() => retrySoMut.mutate(a.id)}
                              title="Buat ulang Sales Order dari approval ini"
                            >
                              {retrySoMut.isPending
                                ? <Loader2 className="h-3 w-3 animate-spin mr-1" />
                                : <RotateCcw className="h-3 w-3 mr-1" />}
                              Buat SO
                            </Button>
                          )}
                        </div>

                        {/* Timestamps */}
                        <div className="text-[10px] text-slate-400 flex gap-3 flex-wrap">
                          <span>Dibuat: {dt(a.createdAt)}</span>
                          {a.approvedAt && <span>Disetujui: {dt(a.approvedAt)}</span>}
                          {a.rejectedAt && <span>Ditolak: {dt(a.rejectedAt)}</span>}
                          {a.expiresAt && new Date(a.expiresAt) > new Date() && (
                            <span>Exp: {dt(a.expiresAt)}</span>
                          )}
                        </div>
                      </div>
                    );
                  })}
                </CardContent>
              </Card>
            )}

            {/* Fulfillment Links & Submissions */}
            {(fulfillmentData?.links?.length ?? 0) > 0 && (
              <Card>
                <CardHeader className="pb-3">
                  <CardTitle className="text-sm font-semibold text-emerald-700 uppercase tracking-wide flex items-center gap-1.5">
                    <ClipboardCheck className="w-4 h-4" /> Form Fulfillment Vendor
                  </CardTitle>
                </CardHeader>
                <CardContent className="space-y-3">
                  {fulfillmentData!.links.map(lnk => {
                    const sub = fulfillmentData?.submissions.find(s => s.linkId === lnk.id);
                    const isSubmitted = lnk.status === "submitted";
                    return (
                      <div key={lnk.id} className={`rounded-lg border px-3 py-3 space-y-2 ${isSubmitted ? "border-emerald-200 bg-emerald-50/40" : "border-slate-100"}`}>
                        <div className="flex items-center justify-between">
                          <div className="flex items-center gap-2 flex-wrap">
                            <Badge className={isSubmitted ? "bg-emerald-100 text-emerald-800" : "bg-slate-100 text-slate-600"}>
                              {isSubmitted ? "✅ Submitted" : "⏳ Menunggu"}
                            </Badge>
                            <span className="text-xs text-slate-500 capitalize">{lnk.serviceType}</span>
                            {lnk.expiresAt && (
                              <span className="text-xs text-slate-400">
                                Exp: {new Date(lnk.expiresAt).toLocaleDateString("id-ID")}
                              </span>
                            )}
                          </div>
                          <div className="flex gap-1">
                            <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => copyUrl(lnk.formUrl)}>
                              <Copy className="h-3.5 w-3.5" />
                            </Button>
                            <a href={lnk.formUrl} target="_blank" rel="noopener noreferrer">
                              <Button variant="ghost" size="icon" className="h-7 w-7">
                                <ExternalLink className="h-3.5 w-3.5" />
                              </Button>
                            </a>
                          </div>
                        </div>
                        {sub && (
                          <div className="bg-white rounded-lg border border-emerald-100 px-3 py-2.5 space-y-1.5">
                            <p className="text-xs font-semibold text-emerald-700 uppercase tracking-wide">Data dari Vendor</p>
                            {Object.entries(sub.fulfillmentData).map(([k, v]) => {
                              if (!v) return null;
                              const LABELS: Record<string, string> = {
                                stockConfirmed: "Status Stok", qtyConfirmed: "Qty Dipenuhi",
                                readyDate: "Tanggal Siap Kirim", leadTime: "Lead Time",
                                warehouseLocation: "Lokasi Gudang", priceConfirmed: "Konfirmasi Harga",
                                revisedPrice: "Harga Revisi (DPP)", driverName: "Nama Driver",
                                driverPhone: "HP Driver", plateNumber: "Plat Nomor",
                                vehicleType: "Jenis Kendaraan", pickupTime: "Waktu Pickup",
                                carrierName: "Carrier", awbBlNumber: "AWB / BL",
                                flightVessel: "Kapal / Flight", bookingNumber: "No. Booking",
                                etd: "ETD", eta: "ETA", customsPicName: "Nama PIC",
                                customsDocuments: "Dokumen", customsProcessEta: "ETA Proses",
                                stockPhotoUrl: "Foto Stok", packingListUrl: "Packing List",
                                invoiceUrl: "Invoice", podUrl: "POD",
                                supportingDocUrl: "Dok. Pendukung", notes: "Catatan",
                                driver_name: "Nama Driver", driver_phone: "HP Driver",
                                vehicle_plate: "Plat Nomor", vehicle_type: "Jenis Kendaraan",
                                pickup_time: "Waktu Pickup", carrier_name: "Carrier",
                                booking_number: "No. Booking", awb_or_bl_number: "AWB / BL",
                                ready_date: "Tanggal Siap Kirim", source_warehouse: "Gudang Asal",
                                operational_note: "Catatan",
                              };
                              const STOCK_MAP: Record<string, string> = {
                                all: "✅ Tersedia Semua", partial: "⚠️ Tersedia Sebagian", none: "❌ Tidak Tersedia",
                              };
                              const PRICE_MAP: Record<string, string> = {
                                agree: "✅ Setuju harga asal", revised: "✏️ Revisi harga",
                              };
                              const label = LABELS[k] ?? k.replace(/([A-Z])/g, " $1").replace(/_/g, " ").trim();
                              const display = STOCK_MAP[v] ?? PRICE_MAP[v] ?? v;
                              const isUrl = v.startsWith("http") || v.startsWith("/api/") || v.startsWith("/");
                              const isImage = isUrl && /\.(jpg|jpeg|png|webp|heic|heif)(\?.*)?$/i.test(v);
                              return (
                                <div key={k} className="flex gap-2 text-xs">
                                  <span className="text-slate-400 min-w-[140px] flex-shrink-0 capitalize">{label}</span>
                                  <span className="text-slate-700 font-medium">
                                    {isImage ? (
                                      <button
                                        type="button"
                                        onClick={() => setLightboxUrl(v)}
                                        className="relative group block"
                                      >
                                        <img src={v} alt={label} className="max-h-28 max-w-[200px] rounded border border-slate-200 object-contain transition-opacity group-hover:opacity-75" />
                                        <span className="absolute inset-0 flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity">
                                          <ZoomIn className="w-6 h-6 text-white drop-shadow-lg" />
                                        </span>
                                      </button>
                                    ) : isUrl ? (
                                      <a href={v} target="_blank" rel="noopener noreferrer" className="text-blue-600 underline">Lihat file ↗</a>
                                    ) : display}
                                  </span>
                                </div>
                              );
                            })}
                            <p className="text-[10px] text-slate-400 pt-1">
                              Diterima: {new Date(sub.submittedAt).toLocaleString("id-ID")}
                            </p>
                          </div>
                        )}

                        {/* ── Kirim ulang WA ke vendor jika belum submit ── */}
                        {!isSubmitted && (
                          <div className="pt-1 flex flex-wrap gap-2">
                            <Button
                              size="sm"
                              variant="outline"
                              className="border-emerald-300 text-emerald-700 hover:bg-emerald-50 h-8 text-xs"
                              disabled={resendFulfillWaMut.isPending}
                              onClick={() => {
                                if (!confirm("Kirim ulang WA form fulfillment ke vendor?")) return;
                                resendFulfillWaMut.mutate();
                              }}
                            >
                              {resendFulfillWaMut.isPending
                                ? <Loader2 className="w-3.5 h-3.5 animate-spin mr-1" />
                                : <MessageCircle className="w-3.5 h-3.5 mr-1" />}
                              Kirim Ulang WA ke Vendor
                            </Button>
                            <Button
                              size="sm"
                              variant="outline"
                              className="border-amber-300 text-amber-700 hover:bg-amber-50 h-8 text-xs"
                              disabled={extendFulfillMut.isPending}
                              onClick={() => {
                                if (!confirm("Perpanjang masa berlaku link fulfillment +72 jam?")) return;
                                extendFulfillMut.mutate();
                              }}
                            >
                              {extendFulfillMut.isPending
                                ? <Loader2 className="w-3.5 h-3.5 animate-spin mr-1" />
                                : <Clock className="w-3.5 h-3.5 mr-1" />}
                              Perpanjang (+72 jam)
                            </Button>
                          </div>
                        )}

                        {/* ── Aksi lanjutan setelah vendor submit ── */}
                        {isSubmitted && sub && (
                          <div className="pt-1 flex flex-wrap gap-2">
                            {["Vendor Confirmed", "Processing", "Customer Approved"].includes(order.status) && (
                              <Button
                                size="sm"
                                className="bg-blue-600 hover:bg-blue-700 text-white h-8 text-xs"
                                disabled={confirmFulfillmentMut.isPending}
                                onClick={() => {
                                  if (!confirm("Konfirmasi fulfillment dan ubah status ke In Progress? WA akan dikirim ke customer.")) return;
                                  confirmFulfillmentMut.mutate();
                                }}
                              >
                                {confirmFulfillmentMut.isPending
                                  ? <Loader2 className="w-3.5 h-3.5 animate-spin mr-1" />
                                  : <Truck className="w-3.5 h-3.5 mr-1" />}
                                Konfirmasi &amp; Mulai Pengiriman
                              </Button>
                            )}
                            {["In Progress", "Pickup", "In Transit", "Arrived", "Delivered"].includes(order.status) && (
                              <Button
                                size="sm"
                                className="bg-teal-600 hover:bg-teal-700 text-white h-8 text-xs"
                                onClick={() => setShowCompleteDialog(true)}
                              >
                                <ClipboardCheck className="w-3.5 h-3.5 mr-1" />
                                Upload Bukti Pengiriman
                              </Button>
                            )}
                            {!["In Progress", "Completed", "Cancelled"].includes(order.status) && (
                              <Button
                                size="sm"
                                variant="outline"
                                className="border-orange-300 text-orange-700 hover:bg-orange-50 h-8 text-xs"
                                disabled={resendConfirmWaMut.isPending}
                                onClick={() => {
                                  if (!confirm("Buat ulang link konfirmasi fulfillment dan kirim WA ke admin group?")) return;
                                  resendConfirmWaMut.mutate();
                                }}
                              >
                                {resendConfirmWaMut.isPending
                                  ? <Loader2 className="w-3.5 h-3.5 animate-spin mr-1" />
                                  : <Bell className="w-3.5 h-3.5 mr-1" />}
                                Kirim Ulang WA Konfirmasi
                              </Button>
                            )}
                          </div>
                        )}
                      </div>
                    );
                  })}
                </CardContent>
              </Card>
            )}

            {/* Dialog: Selesaikan Order + POD */}
            <Dialog open={showCompleteDialog} onOpenChange={(o) => {
              if (!o) { setPodPhotoFile(null); setPodPhotoPreview(null); }
              setShowCompleteDialog(o);
            }}>
              <DialogContent className="max-w-md">
                <DialogHeader>
                  <DialogTitle className="flex items-center gap-2">
                    <ClipboardCheck className="w-5 h-5 text-teal-600" />
                    Upload Bukti Pengiriman (POD)
                  </DialogTitle>
                </DialogHeader>
                <div className="space-y-3 py-2">
                  <p className="text-sm text-slate-500">
                    Status → <strong>Bukti Pengiriman (POD Uploaded)</strong>. Selanjutnya admin buat invoice lalu konfirmasi pembayaran sebelum order Selesai.
                  </p>

                  <div className="space-y-1.5">
                    <Label className="text-xs">Nama Penerima <span className="text-slate-400">(opsional)</span></Label>
                    <Input
                      value={completeReceiver}
                      onChange={e => setCompleteReceiver(e.target.value)}
                      placeholder="Contoh: Budi Santoso"
                    />
                  </div>

                  <div className="space-y-1.5">
                    <Label className="text-xs">Foto Bukti Pengiriman <span className="text-slate-400">(opsional)</span></Label>
                    {podPhotoPreview ? (
                      <div className="relative inline-block">
                        <img src={podPhotoPreview} alt="preview" className="w-full max-h-48 object-contain rounded-lg border border-slate-200" />
                        <button
                          className="absolute top-1 right-1 bg-white/80 rounded-full p-0.5 text-slate-500 hover:text-red-500"
                          onClick={() => { setPodPhotoFile(null); setPodPhotoPreview(null); }}
                          type="button"
                        >
                          <XCircle className="w-4 h-4" />
                        </button>
                      </div>
                    ) : (
                      <label className="flex flex-col items-center justify-center gap-1.5 border-2 border-dashed border-slate-200 rounded-lg py-5 cursor-pointer hover:border-emerald-300 hover:bg-emerald-50/30 transition-colors">
                        <ClipboardCheck className="w-6 h-6 text-slate-400" />
                        <span className="text-xs text-slate-400">Klik untuk pilih foto</span>
                        <input
                          type="file"
                          accept="image/*"
                          className="hidden"
                          onChange={e => {
                            const f = e.target.files?.[0] ?? null;
                            setPodPhotoFile(f);
                            if (f) {
                              const url = URL.createObjectURL(f);
                              setPodPhotoPreview(url);
                            }
                          }}
                        />
                      </label>
                    )}
                  </div>

                  <div className="space-y-1.5">
                    <Label className="text-xs">Catatan <span className="text-slate-400">(opsional)</span></Label>
                    <Textarea
                      value={completeNote}
                      onChange={e => setCompleteNote(e.target.value)}
                      rows={2}
                      placeholder="Contoh: Barang diterima dalam kondisi baik."
                    />
                  </div>
                </div>
                <DialogFooter className="gap-2">
                  <Button variant="outline" size="sm" onClick={() => setShowCompleteDialog(false)}>
                    Batal
                  </Button>
                  <Button
                    size="sm"
                    className="bg-emerald-600 hover:bg-emerald-700 text-white"
                    disabled={completeOrderMut.isPending}
                    onClick={() => completeOrderMut.mutate({ note: completeNote, receiverName: completeReceiver, photo: podPhotoFile })}
                  >
                    {completeOrderMut.isPending
                      ? <Loader2 className="w-4 h-4 animate-spin mr-1" />
                      : <ClipboardCheck className="w-4 h-4 mr-1" />}
                    Simpan Bukti Pengiriman
                  </Button>
                </DialogFooter>
              </DialogContent>
            </Dialog>

            {/* ── Panel POD (Bukti Pengiriman) ── */}
            {((fulfillmentData?.driverPods?.length ?? 0) > 0 || (fulfillmentData?.pods?.length ?? 0) > 0) && (
              <Card className="border-teal-200">
                <CardHeader className="pb-3">
                  <CardTitle className="text-sm font-semibold text-teal-700 uppercase tracking-wide flex items-center gap-1.5">
                    <ClipboardCheck className="w-4 h-4" /> Bukti Pengiriman (POD)
                  </CardTitle>
                </CardHeader>
                <CardContent className="space-y-4">

                  {/* ── Driver POD Cards (dari Driver App) ── */}
                  {(fulfillmentData?.driverPods ?? []).map(dpod => {
                    const statusNorm = (dpod.status ?? "").toUpperCase();
                    const isComplete = statusNorm === "COMPLETED";
                    const isSubmitted = !isComplete && (!!dpod.podSubmittedAt || statusNorm === "DELIVERED");
                    const isPending = !isComplete && !isSubmitted;
                    const hasPhotos = dpod.podPhotos.length > 0;
                    const hasGeo = !!(dpod.podGeoLat && dpod.podGeoLng);
                    const mapsUrl = dpod.podMapUrl ?? (hasGeo
                      ? `https://www.google.com/maps?q=${dpod.podGeoLat},${dpod.podGeoLng}`
                      : null);
                    const podSubmitted = isSubmitted || isComplete;

                    return (
                      <div key={`driver-${dpod.id}`} className="rounded-xl border border-teal-200 bg-gradient-to-br from-teal-50/60 to-white p-4 space-y-4">

                        {/* Header Row */}
                        <div className="flex items-start justify-between gap-2 flex-wrap">
                          <div className="flex items-center gap-2 flex-wrap">
                            {isPending ? (
                              <Badge className="bg-amber-100 text-amber-800 border border-amber-200">⏳ POD Pending</Badge>
                            ) : isComplete ? (
                              <Badge className="bg-blue-100 text-blue-800 border border-blue-200">📋 POD Complete</Badge>
                            ) : (
                              <Badge className="bg-emerald-100 text-emerald-800 border border-emerald-200">✅ POD Submitted</Badge>
                            )}
                            <span className="text-[11px] font-mono text-slate-500 bg-slate-100 px-2 py-0.5 rounded">
                              {dpod.jobNumber}
                            </span>
                          </div>
                          {dpod.podSubmittedAt && (
                            <span className="text-[10px] text-slate-400">
                              {new Date(dpod.podSubmittedAt).toLocaleString("id-ID", { day: "numeric", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" })}
                            </span>
                          )}
                        </div>

                        {/* Order & Job Info */}
                        <div className="grid grid-cols-2 gap-x-4 gap-y-2 text-xs">
                          <div>
                            <span className="text-slate-400 uppercase text-[10px] tracking-wide">No. Order</span>
                            <p className="font-semibold text-slate-700 font-mono">{order.orderNumber}</p>
                          </div>
                          <div>
                            <span className="text-slate-400 uppercase text-[10px] tracking-wide">No. Job Driver</span>
                            <p className="font-semibold text-slate-700 font-mono">{dpod.jobNumber}</p>
                          </div>
                        </div>

                        {/* Driver Info */}
                        {(dpod.driverName || dpod.driverPhone || dpod.vehiclePlate) && (
                          <div className="rounded-lg border border-slate-100 bg-white p-3 space-y-2">
                            <p className="text-[10px] font-semibold text-slate-400 uppercase tracking-wide">Info Driver</p>
                            <div className="grid grid-cols-2 gap-x-4 gap-y-1.5 text-xs">
                              {dpod.driverName && (
                                <div className="flex items-start gap-1.5">
                                  <User className="w-3.5 h-3.5 text-slate-400 mt-0.5 shrink-0" />
                                  <div>
                                    <span className="text-slate-400 block text-[10px]">Nama Driver</span>
                                    <p className="font-semibold text-slate-700">{dpod.driverName}</p>
                                  </div>
                                </div>
                              )}
                              {dpod.driverPhone && (
                                <div className="flex items-start gap-1.5">
                                  <Phone className="w-3.5 h-3.5 text-slate-400 mt-0.5 shrink-0" />
                                  <div>
                                    <span className="text-slate-400 block text-[10px]">Telepon Driver</span>
                                    <p className="font-semibold text-slate-700">{dpod.driverPhone}</p>
                                  </div>
                                </div>
                              )}
                              {dpod.vehiclePlate && (
                                <div className="flex items-start gap-1.5 col-span-2">
                                  <CreditCard className="w-3.5 h-3.5 text-slate-400 mt-0.5 shrink-0" />
                                  <div>
                                    <span className="text-slate-400 block text-[10px]">Plat Nomor</span>
                                    <p className="font-semibold text-slate-700 font-mono tracking-widest">{dpod.vehiclePlate}</p>
                                  </div>
                                </div>
                              )}
                            </div>
                          </div>
                        )}

                        {/* Receiver Info — tampil selalu saat POD submitted, backward compat: old POD hanya punya receiverName */}
                        {podSubmitted && (
                          <div className="rounded-lg border border-teal-100 bg-teal-50/40 p-3 space-y-2">
                            <p className="text-[10px] font-semibold text-teal-600 uppercase tracking-wide">Detail Penerimaan</p>
                            <div className="grid grid-cols-2 gap-x-4 gap-y-1.5 text-xs">
                              <div>
                                <span className="text-slate-400 block text-[10px]">Nama Penerima</span>
                                {dpod.podReceiverName
                                  ? <p className="font-semibold text-slate-800">{dpod.podReceiverName}</p>
                                  : <p className="text-slate-300 italic">—</p>
                                }
                              </div>
                              <div>
                                <span className="text-slate-400 block text-[10px]">Jabatan Penerima</span>
                                {dpod.podReceiverPosition
                                  ? <p className="font-medium text-slate-700">{dpod.podReceiverPosition}</p>
                                  : <p className="text-slate-300 italic">—</p>
                                }
                              </div>
                              {dpod.podNotes && (
                                <div className="col-span-2">
                                  <span className="text-slate-400 block text-[10px]">Catatan Pengiriman</span>
                                  <p className="text-slate-600 whitespace-pre-wrap">{dpod.podNotes}</p>
                                </div>
                              )}
                            </div>
                          </div>
                        )}

                        {/* Geo Location */}
                        {hasGeo && (
                          <div className="rounded-lg border border-blue-100 bg-blue-50/40 px-3 py-2.5 space-y-2">
                            <div className="flex items-center gap-2 text-xs min-w-0">
                              <MapPin className="w-3.5 h-3.5 text-blue-500 shrink-0" />
                              <div className="min-w-0 flex-1">
                                <span className="text-slate-400 block text-[10px]">Lokasi GPS saat submit POD</span>
                                <p className="font-mono text-slate-600 text-[11px] truncate">
                                  {Number(dpod.podGeoLat).toFixed(6)}, {Number(dpod.podGeoLng).toFixed(6)}
                                </p>
                                {dpod.podDeviceTimestamp && (
                                  <p className="text-[10px] text-slate-400 mt-0.5">
                                    ⏱ {new Date(dpod.podDeviceTimestamp).toLocaleString("id-ID", { day: "numeric", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" })} (waktu perangkat)
                                  </p>
                                )}
                              </div>
                            </div>
                            <div className="flex gap-2">
                              <a href={mapsUrl!} target="_blank" rel="noopener noreferrer" className="flex-1">
                                <Button variant="outline" size="sm" className="w-full h-7 px-2 text-[11px] gap-1 text-blue-700 border-blue-200 hover:bg-blue-50">
                                  <Navigation className="w-3 h-3" />
                                  Buka Maps
                                </Button>
                              </a>
                              {dpod.podStreetViewUrl && (
                                <a href={dpod.podStreetViewUrl} target="_blank" rel="noopener noreferrer" className="flex-1">
                                  <Button variant="outline" size="sm" className="w-full h-7 px-2 text-[11px] gap-1 text-violet-700 border-violet-200 hover:bg-violet-50">
                                    <ExternalLink className="w-3 h-3" />
                                    Street View
                                  </Button>
                                </a>
                              )}
                            </div>
                          </div>
                        )}

                        {/* Signature — tampil saat submitted; badge "Tanpa tanda tangan" jika kosong */}
                        {podSubmitted && (
                          <div className="space-y-2">
                            <div className="flex items-center gap-1.5 text-[10px] font-semibold text-slate-500 uppercase tracking-wide">
                              <PenLine className="w-3.5 h-3.5" />
                              Tanda Tangan Penerima
                            </div>
                            {dpod.podSignatureDataUrl ? (
                              <div className="rounded-lg border border-slate-200 bg-white p-2">
                                <img
                                  src={dpod.podSignatureDataUrl}
                                  alt="Tanda tangan penerima"
                                  className="max-h-28 max-w-full object-contain mx-auto"
                                />
                              </div>
                            ) : (
                              <Badge variant="outline" className="text-slate-400 border-slate-200 font-normal text-[10px]">
                                Tanpa tanda tangan
                              </Badge>
                            )}
                          </div>
                        )}

                        {/* POD Photos Grid */}
                        {podSubmitted && (
                          <div className="space-y-2">
                            <div className="flex items-center justify-between">
                              <div className="flex items-center gap-1.5 text-[10px] font-semibold text-slate-500 uppercase tracking-wide">
                                <Camera className="w-3.5 h-3.5" />
                                Foto POD {hasPhotos && <span className="text-teal-600">({dpod.podPhotos.length})</span>}
                              </div>
                            </div>
                            {hasPhotos ? (
                              <>
                                <div className="grid grid-cols-3 gap-2">
                                  {dpod.podPhotos.map((url, idx) => (
                                    <div
                                      key={idx}
                                      className="relative group aspect-square rounded-lg overflow-hidden border border-slate-200 cursor-zoom-in bg-slate-50"
                                      onClick={() => setLightboxUrl(url)}
                                    >
                                      <img
                                        src={url}
                                        alt={`POD foto ${idx + 1}`}
                                        className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-200"
                                      />
                                      <div className="absolute inset-0 bg-black/0 group-hover:bg-black/20 transition-colors flex items-center justify-center">
                                        <ZoomIn className="w-5 h-5 text-white opacity-0 group-hover:opacity-100 transition-opacity drop-shadow-lg" />
                                      </div>
                                    </div>
                                  ))}
                                </div>
                                <div className="flex flex-wrap gap-1 pt-0.5">
                                  {dpod.podPhotos.map((url, idx) => (
                                    <a
                                      key={idx}
                                      href={url}
                                      target="_blank"
                                      rel="noopener noreferrer"
                                      className="inline-flex items-center gap-0.5 text-[10px] text-teal-600 hover:text-teal-800 underline underline-offset-2"
                                    >
                                      <ExternalLink className="w-2.5 h-2.5" /> Foto {idx + 1}
                                    </a>
                                  ))}
                                </div>
                              </>
                            ) : (
                              <div className="text-xs text-slate-400 italic flex items-center gap-1.5 py-1">
                                <Camera className="w-3.5 h-3.5" /> Tidak ada foto pada POD ini
                              </div>
                            )}
                          </div>
                        )}
                      </div>
                    );
                  })}

                  {/* ── Legacy POD Cards (dari Admin Upload / order_pod_submissions) ── */}
                  {(fulfillmentData?.pods ?? []).map(pod => (
                    <div key={`legacy-${pod.id}`} className="rounded-lg border border-teal-100 bg-teal-50/30 px-3 py-3 space-y-2">
                      <div className="flex items-center justify-between gap-2 flex-wrap">
                        <Badge className="bg-emerald-100 text-emerald-800">✅ POD Tersimpan</Badge>
                        <div className="flex items-center gap-2">
                          <span className="text-[10px] text-slate-400">
                            {new Date(pod.created_at).toLocaleString("id-ID", { day: "numeric", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" })}
                          </span>
                          <Button
                            variant="outline"
                            size="sm"
                            className="h-6 px-2 text-[10px] gap-1 text-teal-700 border-teal-200 hover:bg-teal-50"
                            disabled={isGeneratingPodPdf}
                            onClick={() => handleDownloadPodPdf(pod)}
                          >
                            {isGeneratingPodPdf
                              ? <Loader2 className="w-3 h-3 animate-spin" />
                              : <Download className="w-3 h-3" />}
                            PDF
                          </Button>
                        </div>
                      </div>
                      <div className="grid grid-cols-2 gap-x-4 gap-y-1 text-xs">
                        {pod.receiver_name && (
                          <div>
                            <span className="text-slate-400">Penerima</span>
                            <p className="font-semibold text-slate-700">{pod.receiver_name}</p>
                          </div>
                        )}
                        {pod.submitted_by && (
                          <div>
                            <span className="text-slate-400">Diupload oleh</span>
                            <p className="font-medium text-slate-600">{pod.submitted_by}</p>
                          </div>
                        )}
                        {pod.note && (
                          <div className="col-span-2">
                            <span className="text-slate-400">Catatan</span>
                            <p className="text-slate-600">{pod.note}</p>
                          </div>
                        )}
                      </div>
                      {pod.photo_url && (
                        <div
                          className="cursor-zoom-in"
                          onClick={() => setLightboxUrl(pod.photo_url!)}
                        >
                          <img
                            src={pod.photo_url}
                            alt="Bukti pengiriman"
                            className="w-full max-h-56 object-contain rounded-lg border border-teal-100 hover:opacity-90 transition-opacity"
                          />
                        </div>
                      )}

                      {/* Hidden printable template untuk PDF */}
                      <div
                        ref={el => { podPdfRefs.current[pod.id] = el; }}
                        style={{
                          position: "fixed", top: "-9999px", left: "-9999px",
                          width: "794px", background: "#ffffff", fontFamily: "Arial, sans-serif",
                          padding: "48px", boxSizing: "border-box",
                        }}
                      >
                        {/* Header */}
                        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", borderBottom: "2px solid #0d9488", paddingBottom: "16px", marginBottom: "24px" }}>
                          <div>
                            <div style={{ fontSize: "22px", fontWeight: 700, color: "#0f172a" }}>CST LOGISTICS</div>
                            <div style={{ fontSize: "11px", color: "#64748b", marginTop: "2px" }}>Bukti Tanda Terima Pengiriman (Proof of Delivery)</div>
                          </div>
                          <div style={{ textAlign: "right" }}>
                            <div style={{ fontSize: "13px", fontWeight: 700, color: "#0d9488" }}>POD-{order?.orderNumber ?? pod.order_id}</div>
                            <div style={{ fontSize: "10px", color: "#94a3b8", marginTop: "2px" }}>
                              {new Date(pod.created_at).toLocaleString("id-ID", { day: "numeric", month: "long", year: "numeric", hour: "2-digit", minute: "2-digit" })}
                            </div>
                          </div>
                        </div>

                        {/* Order Info */}
                        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "8px", marginBottom: "24px" }}>
                          {[
                            { label: "Nomor Order", value: order?.orderNumber ?? "—" },
                            { label: "Status", value: "Completed" },
                            { label: "Customer", value: order?.customerName ?? "—" },
                            { label: "Jenis Layanan", value: order?.shipmentType ?? "—" },
                            { label: "Asal", value: order?.origin ?? "—" },
                            { label: "Tujuan", value: order?.destination ?? "—" },
                          ].map(({ label, value }) => (
                            <div key={label} style={{ background: "#f8fafc", borderRadius: "6px", padding: "10px 12px" }}>
                              <div style={{ fontSize: "9px", color: "#94a3b8", textTransform: "uppercase", letterSpacing: "0.05em", marginBottom: "2px" }}>{label}</div>
                              <div style={{ fontSize: "12px", fontWeight: 600, color: "#1e293b" }}>{value}</div>
                            </div>
                          ))}
                        </div>

                        {/* POD Details */}
                        <div style={{ border: "1px solid #e2e8f0", borderRadius: "8px", padding: "16px 20px", marginBottom: "24px" }}>
                          <div style={{ fontSize: "11px", fontWeight: 700, color: "#0d9488", textTransform: "uppercase", letterSpacing: "0.05em", marginBottom: "12px" }}>Detail Penerimaan</div>
                          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "12px" }}>
                            <div>
                              <div style={{ fontSize: "9px", color: "#94a3b8", textTransform: "uppercase", marginBottom: "3px" }}>Nama Penerima</div>
                              <div style={{ fontSize: "13px", fontWeight: 700, color: "#0f172a" }}>{pod.receiver_name ?? "—"}</div>
                            </div>
                            <div>
                              <div style={{ fontSize: "9px", color: "#94a3b8", textTransform: "uppercase", marginBottom: "3px" }}>Diverifikasi oleh</div>
                              <div style={{ fontSize: "12px", color: "#475569" }}>{pod.submitted_by ?? "Admin"}</div>
                            </div>
                            {pod.note && (
                              <div style={{ gridColumn: "1 / -1" }}>
                                <div style={{ fontSize: "9px", color: "#94a3b8", textTransform: "uppercase", marginBottom: "3px" }}>Catatan</div>
                                <div style={{ fontSize: "12px", color: "#475569" }}>{pod.note}</div>
                              </div>
                            )}
                          </div>
                        </div>

                        {/* Photo */}
                        {pod.photo_url && (
                          <div style={{ marginBottom: "24px" }}>
                            <div style={{ fontSize: "11px", fontWeight: 700, color: "#0d9488", textTransform: "uppercase", letterSpacing: "0.05em", marginBottom: "10px" }}>Foto Bukti Pengiriman</div>
                            <img
                              src={pod.photo_url}
                              alt="POD Photo"
                              crossOrigin="anonymous"
                              style={{ maxWidth: "100%", maxHeight: "360px", objectFit: "contain", borderRadius: "8px", border: "1px solid #e2e8f0" }}
                            />
                          </div>
                        )}

                        {/* Signature area */}
                        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "40px", marginTop: "32px", paddingTop: "24px", borderTop: "1px solid #e2e8f0" }}>
                          {["Pengirim / Shipper", "Penerima / Receiver"].map(label => (
                            <div key={label} style={{ textAlign: "center" }}>
                              <div style={{ fontSize: "10px", color: "#64748b", marginBottom: "48px" }}>{label}</div>
                              <div style={{ borderTop: "1px solid #94a3b8", paddingTop: "6px", fontSize: "10px", color: "#94a3b8" }}>(Tanda Tangan &amp; Stempel)</div>
                            </div>
                          ))}
                        </div>

                        {/* Footer */}
                        <div style={{ marginTop: "24px", textAlign: "center", fontSize: "9px", color: "#94a3b8" }}>
                          Dokumen ini diterbitkan secara otomatis oleh sistem B2B Marketplace and Logistic • {new Date(pod.created_at).toLocaleDateString("id-ID", { day: "numeric", month: "long", year: "numeric" })}
                        </div>
                      </div>
                    </div>
                  ))}
                </CardContent>
              </Card>
            )}

            {/* ── Panel Aksi Pengiriman Post-POD ── */}
            {["POD Uploaded", "Invoice Issued", "Payment Received"].includes(order.status) && (
              <Card className="border-orange-200">
                <CardHeader className="pb-3">
                  <CardTitle className="text-sm font-semibold text-orange-700 uppercase tracking-wide flex items-center gap-1.5">
                    <FileText className="w-4 h-4" /> Aksi Pengiriman
                  </CardTitle>
                </CardHeader>
                <CardContent className="space-y-3">
                  <div className="text-xs text-slate-500 bg-orange-50 rounded-lg px-3 py-2">
                    Status saat ini: <strong className="text-orange-700">{order.status}</strong>
                    {order.status === "POD Uploaded" && " — Silakan buat & kirim invoice ke customer, lalu tandai Invoice Diterbitkan."}
                    {order.status === "Invoice Issued" && " — Setelah pembayaran diterima, klik Konfirmasi Pembayaran."}
                    {order.status === "Payment Received" && " — Semua proses selesai, klik Tandai Selesai untuk menutup order."}
                  </div>

                  <div className="flex flex-wrap gap-2">
                    {order.status === "POD Uploaded" && (
                      <Button
                        size="sm"
                        className="bg-orange-600 hover:bg-orange-700 text-white h-8 text-xs"
                        disabled={invoiceIssuedMut.isPending}
                        onClick={() => {
                          if (!confirm("Tandai Invoice sudah diterbitkan ke customer? Pastikan sudah membuat & mengirim link invoice via panel Invoice & Pembayaran di bawah.")) return;
                          invoiceIssuedMut.mutate();
                        }}
                      >
                        {invoiceIssuedMut.isPending
                          ? <Loader2 className="w-3.5 h-3.5 animate-spin mr-1" />
                          : <FileText className="w-3.5 h-3.5 mr-1" />}
                        Tandai Invoice Diterbitkan
                      </Button>
                    )}

                    {order.status === "Invoice Issued" && (
                      <Button
                        size="sm"
                        className="bg-lime-600 hover:bg-lime-700 text-white h-8 text-xs"
                        disabled={paymentReceivedMut.isPending}
                        onClick={() => {
                          if (!confirm("Konfirmasi pembayaran sudah diterima? Status akan berubah ke Pembayaran Diterima dan WA dikirim ke customer.")) return;
                          paymentReceivedMut.mutate();
                        }}
                      >
                        {paymentReceivedMut.isPending
                          ? <Loader2 className="w-3.5 h-3.5 animate-spin mr-1" />
                          : <CheckCircle2 className="w-3.5 h-3.5 mr-1" />}
                        Konfirmasi Pembayaran
                      </Button>
                    )}

                    {order.status === "Payment Received" && (
                      <Button
                        size="sm"
                        className="bg-green-600 hover:bg-green-700 text-white h-8 text-xs"
                        disabled={completedMut.isPending}
                        onClick={() => {
                          if (!confirm("Tandai order sebagai Selesai? Ini tindakan final — WA notifikasi dikirim ke customer.")) return;
                          completedMut.mutate();
                        }}
                      >
                        {completedMut.isPending
                          ? <Loader2 className="w-3.5 h-3.5 animate-spin mr-1" />
                          : <CheckCircle2 className="w-3.5 h-3.5 mr-1" />}
                        Tandai Selesai
                      </Button>
                    )}
                  </div>
                </CardContent>
              </Card>
            )}

            {/* ── Panel Driver Progress GPS ── */}
            {(() => {
              const gpsEvents = (driverProgressData?.events ?? []).filter(
                (e) => e.gps_latitude != null && e.gps_longitude != null,
              );
              if (gpsEvents.length === 0) return null;
              const STEP_LABEL: Record<string, string> = {
                PICKUP: "Penjemputan", IN_TRANSIT: "Dalam Perjalanan",
                ARRIVED: "Tiba di Tujuan", DELIVERED: "Terkirim", COMPLETED: "Selesai",
              };
              return (
                <Card className="border-blue-200">
                  <CardHeader className="pb-3">
                    <CardTitle className="text-sm font-semibold text-blue-700 uppercase tracking-wide flex items-center gap-1.5">
                      <MapPin className="w-4 h-4" /> Lokasi GPS Driver
                    </CardTitle>
                  </CardHeader>
                  <CardContent className="space-y-3">
                    {gpsEvents.map((ev) => (
                      <div key={ev.id} className="rounded-lg border border-blue-100 bg-blue-50/30 px-3 py-3 space-y-2">
                        <div className="flex items-center justify-between gap-2 flex-wrap">
                          <Badge className="bg-blue-100 text-blue-800 font-mono text-xs">
                            {STEP_LABEL[ev.step_key] ?? ev.step_key}
                          </Badge>
                          <span className="text-[10px] text-slate-400">
                            {ev.device_timestamp
                              ? new Date(ev.device_timestamp).toLocaleString("id-ID", {
                                  day: "numeric", month: "short", year: "numeric",
                                  hour: "2-digit", minute: "2-digit", second: "2-digit",
                                })
                              : new Date(ev.created_at).toLocaleString("id-ID", {
                                  day: "numeric", month: "short", year: "numeric",
                                  hour: "2-digit", minute: "2-digit",
                                })}
                          </span>
                        </div>
                        <div className="text-xs text-slate-600 space-y-1">
                          <div className="flex items-center gap-1 font-mono">
                            <MapPin className="w-3 h-3 text-blue-500 flex-shrink-0" />
                            <span>
                              {Number(ev.gps_latitude).toFixed(6)}, {Number(ev.gps_longitude).toFixed(6)}
                            </span>
                          </div>
                          {ev.actor_name && (
                            <div className="text-slate-400">Driver: {ev.actor_name}</div>
                          )}
                        </div>
                        <div className="flex gap-2 pt-1">
                          {ev.map_url && (
                            <a
                              href={ev.map_url}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="inline-flex items-center gap-1 text-xs text-blue-600 underline underline-offset-2 hover:text-blue-800"
                            >
                              <ExternalLink className="w-3 h-3" /> Lihat di Maps
                            </a>
                          )}
                          {ev.street_view_url && (
                            <a
                              href={ev.street_view_url}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="inline-flex items-center gap-1 text-xs text-blue-600 underline underline-offset-2 hover:text-blue-800"
                            >
                              <Eye className="w-3 h-3" /> Street View
                            </a>
                          )}
                        </div>
                      </div>
                    ))}
                  </CardContent>
                </Card>
              );
            })()}

            {/* Driver Assignment Panel */}
            <OrderDriverAssignmentPanel
              orderId={orderId}
              orderNumber={order.orderNumber}
              customerName={order.customerName}
              origin={order.origin}
              destination={order.destination}
              commodity={order.commodity}
            />

            {/* Job Order & Tracking Panel */}
            <JobOrderPanel orderId={orderId} />

            {/* Task Links */}
            {taskLinks.length > 0 && (
              <Card>
                <CardHeader className="pb-3">
                  <CardTitle className="text-sm font-semibold text-slate-600 uppercase tracking-wide flex items-center gap-1.5">
                    <Truck className="w-4 h-4" /> Task Links (Vendor/Driver)
                  </CardTitle>
                </CardHeader>
                <CardContent className="space-y-2">
                  {taskLinks.map(t => (
                    <div key={t.id} className="flex items-center justify-between text-sm border border-slate-100 rounded-lg px-3 py-2">
                      <div>
                        <span className="font-medium text-slate-700">{t.label ?? t.roleType}</span>
                        <Badge className="ml-2 bg-slate-100 text-slate-600">{t.roleType}</Badge>
                        <span className="text-xs text-slate-400 ml-2">{dt(t.createdAt)}</span>
                      </div>
                      <div className="flex gap-1">
                        <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => copyUrl(t.taskUrl)}>
                          <Copy className="h-3.5 w-3.5" />
                        </Button>
                        <a href={t.taskUrl} target="_blank" rel="noopener noreferrer">
                          <Button variant="ghost" size="icon" className="h-7 w-7">
                            <ExternalLink className="h-3.5 w-3.5" />
                          </Button>
                        </a>
                      </div>
                    </div>
                  ))}
                </CardContent>
              </Card>
            )}

            {/* Customer Tracking Links */}
            {customerLinks.length > 0 && (
              <Card>
                <CardHeader className="pb-3">
                  <CardTitle className="text-sm font-semibold text-slate-600 uppercase tracking-wide">📍 Customer Tracking Links</CardTitle>
                </CardHeader>
                <CardContent className="space-y-2">
                  {customerLinks.map(c => (
                    <div key={c.id} className="flex items-center justify-between text-sm border border-slate-100 rounded-lg px-3 py-2">
                      <div>
                        <Badge className="bg-teal-50 text-teal-700">{c.status}</Badge>
                        <span className="text-xs text-slate-400 ml-2">{dt(c.createdAt)}</span>
                      </div>
                      <div className="flex gap-1">
                        <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => copyUrl(c.trackUrl)}>
                          <Copy className="h-3.5 w-3.5" />
                        </Button>
                        <a href={c.trackUrl} target="_blank" rel="noopener noreferrer">
                          <Button variant="ghost" size="icon" className="h-7 w-7">
                            <ExternalLink className="h-3.5 w-3.5" />
                          </Button>
                        </a>
                      </div>
                    </div>
                  ))}
                </CardContent>
              </Card>
            )}

            {/* Freight Shipments */}
            {freightShipments.length > 0 && (
              <Card className="border-teal-200">
                <CardHeader className="pb-3">
                  <CardTitle className="text-sm font-semibold text-teal-700 uppercase tracking-wide flex items-center gap-1.5">
                    <Ship className="w-4 h-4" /> Freight Shipments
                  </CardTitle>
                </CardHeader>
                <CardContent className="space-y-3">
                  {freightShipments.map(fs => {
                    const FREIGHT_STATUS_COLORS: Record<string, string> = {
                      draft: "bg-slate-100 text-slate-600",
                      rfq_sent: "bg-amber-100 text-amber-700",
                      confirmed: "bg-blue-100 text-blue-700",
                      in_transit: "bg-indigo-100 text-indigo-700",
                      completed: "bg-emerald-100 text-emerald-800",
                      cancelled: "bg-red-100 text-red-700",
                    };
                    const FREIGHT_STATUS_LABELS: Record<string, string> = {
                      draft: "Draft",
                      rfq_sent: "RFQ Dikirim",
                      confirmed: "Dikonfirmasi",
                      in_transit: "Dalam Perjalanan",
                      completed: "Selesai",
                      cancelled: "Dibatalkan",
                    };
                    return (
                      <div key={fs.id} className="rounded-lg border border-teal-100 bg-teal-50/40 p-3 space-y-2">
                        <div className="flex items-center justify-between gap-2">
                          <div className="flex items-center gap-2 min-w-0">
                            <span className="font-mono font-semibold text-sm text-teal-800 truncate">{fs.shipmentNumber}</span>
                            <Badge className={`text-xs ${FREIGHT_STATUS_COLORS[fs.status] ?? "bg-slate-100 text-slate-600"}`}>
                              {FREIGHT_STATUS_LABELS[fs.status] ?? fs.status}
                            </Badge>
                          </div>
                          <Link href={`/logistics/freight/${fs.id}`}>
                            <Button variant="outline" size="sm" className="h-7 text-xs shrink-0 border-teal-300 text-teal-700 hover:bg-teal-50">
                              <ExternalLink className="h-3 w-3 mr-1" />
                              Detail
                            </Button>
                          </Link>
                        </div>
                        <div className="grid grid-cols-2 gap-x-4 gap-y-1 text-xs text-slate-600">
                          <div>
                            <span className="text-slate-400">Rute</span>
                            <p className="font-medium">{fs.origin} → {fs.destination}</p>
                          </div>
                          {fs.approvedVendorName && (
                            <div>
                              <span className="text-slate-400">Vendor</span>
                              <p className="font-medium text-teal-700">{fs.approvedVendorName}</p>
                            </div>
                          )}
                          <div>
                            <span className="text-slate-400">Dari RFQ</span>
                            <Link href={`/logistics/rfq/${fs.rfqId}/comparison`}>
                              <span className="font-mono text-teal-600 hover:underline cursor-pointer">{fs.rfqNumber}</span>
                            </Link>
                          </div>
                          <div>
                            <span className="text-slate-400">Dibuat</span>
                            <p className="font-medium">{dt(fs.createdAt)}</p>
                          </div>
                        </div>
                      </div>
                    );
                  })}
                </CardContent>
              </Card>
            )}

            {/* Ringkasan Pembayaran SO */}
            <PaymentSummaryPanel
              salesDocId={approvalData?.find(a => a.salesDocId != null)?.salesDocId}
              soNumber={approvalData?.find(a => a.soNumber != null)?.soNumber}
            />

            {/* Invoice & Payment — Tahap 10 */}
            <CustomerInvoicePanel
              orderId={orderId}
              order={order}
              salesDocId={approvalData?.find(a => a.salesDocId != null)?.salesDocId}
            />

            {/* Gap #6: OPEX */}
            <OrderOpexPanel orderId={orderId} />

            {/* Gap #7: Purchase Linkage */}
            <OrderPurchaseLinkPanel orderId={orderId} />
          </div>

          {/* Right: Exception + Audit Trail + WA Log */}
          <div className="space-y-4">
            <ExceptionPanel orderId={orderId} />
            <FreightDocVerifyPanel shipmentRef={order.orderNumber} />
            <WaNotificationLogPanel orderNumber={order.orderNumber} />
            <AuditTrailPanel orderId={orderId} />
          </div>
        </div>
      </div>

      {/* GPS Tracking Panel — full width below main grid */}
      <ErrorBoundary label="GPS Tracking">
        <GpsTrackingPanel orderId={orderId} orderNumber={order.orderNumber} />
      </ErrorBoundary>

      {/* Lightbox */}
      {lightboxUrl && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-sm"
          onClick={() => setLightboxUrl(null)}
        >
          <div
            className="relative max-w-[90vw] max-h-[90vh] flex flex-col items-center"
            onClick={(e) => e.stopPropagation()}
          >
            <img
              src={lightboxUrl}
              alt="Preview"
              className="max-w-[90vw] max-h-[80vh] rounded-lg object-contain shadow-2xl"
            />
            <div className="flex gap-3 mt-4">
              <a
                href={lightboxUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-1.5 px-4 py-2 rounded-md bg-white text-slate-800 text-sm font-medium hover:bg-slate-100 transition-colors shadow"
              >
                <ExternalLink className="w-4 h-4" />
                Buka di tab baru
              </a>
              <button
                type="button"
                onClick={() => setLightboxUrl(null)}
                className="inline-flex items-center gap-1.5 px-4 py-2 rounded-md bg-slate-700 text-white text-sm font-medium hover:bg-slate-600 transition-colors shadow"
              >
                <XCircle className="w-4 h-4" />
                Tutup
              </button>
            </div>
          </div>
        </div>
      )}
    </AppShell>
  );
}

function Field({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div>
      <p className="text-xs text-slate-400 mb-0.5">{label}</p>
      <div className="font-medium text-slate-800">{value ?? "—"}</div>
    </div>
  );
}
