import { useState } from "react";
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
} from "lucide-react";
import { Link } from "wouter";
import GpsTrackingPanel from "@/components/logistics/GpsTrackingPanel";

const idr = (n: number | string | null | undefined) =>
  n == null ? "—" : `Rp ${Math.round(Number(n)).toLocaleString("id-ID")}`;

const dt = (s: string | null | undefined) =>
  s ? new Date(s).toLocaleString("id-ID", { day: "numeric", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" }) : "—";

// ── Types ──────────────────────────────────────────────────────────────────────

type Order = {
  id: number; orderNumber: string; customerName: string; email: string; phone: string;
  shipmentType: string; origin: string; destination: string;
  commodity: string | null; cargoDescription: string | null;
  grossWeight: string | null; volumeCbm: string | null;
  status: string;
  finalSellingPrice: string | null; finalPrice: string | null; markupPercent: string | null;
  approvedVendorId: number | null;
  customerQuoteStatus: string | null;
  etaFinal: string | null; termsConditions: string | null; quoteNotes: string | null;
  vendorCost: string | null; orderMargin: string | null;
  createdAt: string;
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

type FreightShipmentLink = {
  id: number; shipmentNumber: string; status: string;
  origin: string; destination: string; shipperName: string;
  approvedVendorName: string | null; createdAt: string;
  rfqId: number; rfqNumber: string;
};

type DetailData = {
  order: Order; vendor: Vendor;
  updates: OrderUpdate[];
  taskLinks: TaskLink[]; customerLinks: CustomerLink[]; quoteLinks: QuoteLink[];
  rfqs: { id: number; rfqNumber: string; status: string }[];
  freightShipments: FreightShipmentLink[];
};

const ORDER_STATUSES = [
  "New Order", "Pending Vendor", "Vendor Confirmed", "Quotation Sent",
  "order_confirmed", "assigned_to_vendor", "waiting_pickup", "picked_up",
  "in_progress", "delivered", "pod_uploaded", "invoice_created",
  "payment_pending", "paid", "completed", "cancelled",
];

const STATUS_COLOR: Record<string, string> = {
  order_confirmed: "bg-green-100 text-green-800",
  assigned_to_vendor: "bg-blue-100 text-blue-800",
  waiting_pickup: "bg-yellow-100 text-yellow-800",
  picked_up: "bg-blue-100 text-blue-800",
  in_progress: "bg-indigo-100 text-indigo-800",
  delivered: "bg-teal-100 text-teal-800",
  completed: "bg-green-200 text-green-900",
  cancelled: "bg-red-100 text-red-800",
  customer_quoted: "bg-purple-100 text-purple-800",
  customer_approved: "bg-green-100 text-green-800",
  customer_rejected: "bg-red-100 text-red-800",
  customer_revision_requested: "bg-amber-100 text-amber-800",
};

async function apiFetch<T>(url: string, opts?: RequestInit): Promise<T> {
  const res = await fetch(url, { headers: { "Content-Type": "application/json" }, ...opts });
  const data = await res.json() as T & { message?: string };
  if (!res.ok) throw new Error((data as { message?: string }).message ?? "API error");
  return data;
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

// ── Update Status Dialog ───────────────────────────────────────────────────────

function UpdateStatusDialog({ orderId, currentStatus, onUpdated }: { orderId: number; currentStatus: string; onUpdated: () => void }) {
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
        body: JSON.stringify({ status, notes }),
      });
      toast({ title: "Status diperbarui" });
      setOpen(false);
      onUpdated();
    } catch (e: unknown) {
      toast({ title: "Gagal", description: (e as Error).message, variant: "destructive" });
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

// ── Main Page ──────────────────────────────────────────────────────────────────

export default function LogisticOrderDetailPage() {
  const { orderId: orderIdStr } = useParams<{ orderId: string }>();
  const orderId = Number(orderIdStr);
  const [, navigate] = useLocation();
  const { toast } = useToast();
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

  const copyUrl = (url: string) => {
    navigator.clipboard.writeText(url);
    toast({ title: "Link disalin!" });
  };

  if (isLoading || !data) {
    return (
      <AppShell>
        <div className="flex items-center justify-center h-64">
          <Loader2 className="w-8 h-8 animate-spin text-blue-500" />
        </div>
      </AppShell>
    );
  }

  const { order, vendor, updates, taskLinks, customerLinks, quoteLinks, rfqs, freightShipments = [] } = data;
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
            <UpdateStatusDialog orderId={orderId} currentStatus={order.status} onUpdated={() => qc.invalidateQueries({ queryKey: ["order-detail", orderId] })} />
            <CreateTaskLinkDialog orderId={orderId} vendorId={order.approvedVendorId} onCreated={() => qc.invalidateQueries({ queryKey: ["order-detail", orderId] })} />
            {hasVendorSelected && (
              <SendQuoteDialog order={order} rfqId={activeRfqId} onSent={() => qc.invalidateQueries({ queryKey: ["order-detail", orderId] })} />
            )}
            <Button variant="outline" size="sm" onClick={() => createCustomerLink.mutate()} disabled={createCustomerLink.isPending}>
              <Plus className="w-4 h-4 mr-1" /> Tracking Link
            </Button>
          </div>
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
                <Field label="Status" value={<Badge className={STATUS_COLOR[order.status] ?? "bg-slate-100 text-slate-700"}>{order.status}</Badge>} />
                <Field label="Order Dibuat" value={dt(order.createdAt)} />
              </CardContent>
            </Card>

            {/* Financial */}
            <Card>
              <CardHeader className="pb-3">
                <CardTitle className="text-sm font-semibold text-slate-600 uppercase tracking-wide">💰 Financial</CardTitle>
              </CardHeader>
              <CardContent className="grid grid-cols-2 gap-3 text-sm">
                <Field label="Harga Vendor" value={idr(order.vendorCost ?? order.finalPrice)} />
                <Field label="Harga ke Customer" value={idr(order.finalSellingPrice)} />
                <Field label="Markup %" value={order.markupPercent ? `${order.markupPercent}%` : "—"} />
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
          </div>

          {/* Right: Timeline */}
          <div className="space-y-4">
            <Card className="sticky top-6">
              <CardHeader className="pb-3">
                <CardTitle className="text-sm font-semibold text-slate-600 uppercase tracking-wide flex items-center gap-1.5">
                  <Clock className="w-4 h-4" /> Timeline Aktivitas
                </CardTitle>
              </CardHeader>
              <CardContent className="max-h-[550px] overflow-y-auto">
                {updates.length === 0 ? (
                  <p className="text-sm text-slate-400 text-center py-4">Belum ada aktivitas</p>
                ) : (
                  <div className="relative pl-4">
                    <div className="absolute left-1 top-0 bottom-0 w-0.5 bg-slate-100" />
                    <div className="space-y-4">
                      {updates.map(u => (
                        <div key={u.id} className="relative text-sm">
                          <div className={`absolute -left-[13px] top-1 w-2.5 h-2.5 rounded-full border-2 border-white ${u.isPublic ? "bg-teal-400" : "bg-blue-400"}`} />
                          <div>
                            {u.status && (
                              <span className={`text-xs font-medium rounded-full px-2 py-0.5 ${STATUS_COLOR[u.status] ?? "bg-slate-100 text-slate-600"}`}>
                                {u.status}
                              </span>
                            )}
                            {u.notes && <p className="text-slate-700 mt-1">{u.notes}</p>}
                            <p className="text-xs text-slate-400 mt-0.5">
                              {u.actorName ?? u.actorType} · {dt(u.createdAt)}
                            </p>
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </CardContent>
            </Card>
          </div>
        </div>
      </div>

      {/* GPS Tracking Panel — full width below main grid */}
      <GpsTrackingPanel orderId={orderId} orderNumber={order.orderNumber} />
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
