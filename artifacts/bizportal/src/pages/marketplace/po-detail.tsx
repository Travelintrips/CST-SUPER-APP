import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Link, useParams } from "wouter";
import { AppShell } from "@/components/layout/AppShell";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter,
} from "@/components/ui/dialog";
import {
  PoStatusBadge, ShipmentStatusBadge, GoodsReceiptBadge, InspectionStatusBadge,
} from "@/components/marketplace/MktStatusBadge";
import {
  ArrowLeft, Package, AlertCircle, ChevronDown, ChevronUp,
  Truck, ClipboardCheck, Clock, Activity, Info, CheckCircle2,
} from "lucide-react";
import { useToast } from "@/hooks/use-toast";

// ── Types ─────────────────────────────────────────────────────────────────────

interface PoLine {
  id:          number;
  lineNumber:  number;
  itemName:    string;
  description: string | null;
  qty:         string;
  unit:        string | null;
  unitPrice:   string;
  subtotal:    string;
  notes:       string | null;
  createdAt:   string;
}

interface PoDetail {
  id: number;
  poNumber: string;
  rfqId: number;
  quoteId: number;
  companyId: number;
  vendorId: number;
  status: string;
  totalAmount: string | null;
  taxAmount: string | null;
  grandTotal: string | null;
  createdBy: string | null;
  confirmedAt: string | null;
  cancelledAt: string | null;
  cancelReason: string | null;
  journalPostedAt: string | null;
  createdAt: string;
  updatedAt: string;
  vendorNameSnapshot: string | null;
  vendorAddressSnapshot: string | null;
  paymentTermsSnapshot: string | null;
  incotermSnapshot: string | null;
  quotationNumberSnapshot: string | null;
  quotationDateSnapshot: string | null;
  currencySnapshot: string | null;
  leadTimeDaysSnapshot: number | null;
  rfqNumber: string | null;
  rfqStatus: string | null;
  buyerName: string | null;
  buyerEmail: string | null;
  vendorName: string | null;
  vendorPhone: string | null;
  vendorEmail: string | null;
  quoteStatus: string | null;
}

interface Shipment {
  id: number;
  poId: number;
  shipmentNumber: string;
  status: string;
  dispatchedAt: string | null;
  estimatedArrival: string | null;
  actualArrival: string | null;
  carrier: string | null;
  trackingNumber: string | null;
  notes: string | null;
  createdAt: string;
}

interface ShipmentEvent {
  id: number;
  shipmentId: number;
  eventType: string;
  note: string | null;
  actorId: string | null;
  actorName: string | null;
  occurredAt: string;
  createdAt: string;
}

interface GoodsReceipt {
  id: number;
  shipmentId: number;
  receiptNumber: string;
  receiptType: string;
  inspectionStatus: string;
  receivedAt: string | null;
  notes: string | null;
  createdAt: string;
}

interface ActivityLogEntry {
  id: number;
  purchaseOrderId: number | null;
  action: string;
  statusFrom: string | null;
  statusTo: string | null;
  message: string | null;
  actorName: string | null;
  actorRole: string | null;
  createdAt: string;
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function fmtDate(s: string | null | undefined) {
  if (!s) return "—";
  return new Date(s).toLocaleDateString("id-ID", { day: "numeric", month: "short", year: "numeric" });
}

function fmtDateTime(s: string | null | undefined) {
  if (!s) return "—";
  return new Date(s).toLocaleString("id-ID", {
    day: "numeric", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit",
  });
}

function fmtCurrency(amount: string | null | undefined, currency: string | null | undefined) {
  if (!amount) return "—";
  const num = parseFloat(amount);
  if (isNaN(num)) return "—";
  const cur = currency ?? "IDR";
  return new Intl.NumberFormat("id-ID", {
    style: "currency", currency: cur, minimumFractionDigits: 0, maximumFractionDigits: 0,
  }).format(num);
}

// ── Action definitions ────────────────────────────────────────────────────────

interface ActionDef {
  label: string;
  endpoint: string;
  variant?: "default" | "destructive" | "outline";
  confirm?: string;
}

function getActions(status: string): ActionDef[] {
  switch (status) {
    case "pending":
    case "revision_requested":
      return [{ label: "Terbitkan ke Vendor", endpoint: "issue", variant: "default" }];
    case "issued":
      return [];
    case "vendor_accepted":
      return [{ label: "Mulai Produksi", endpoint: "production" }];
    case "production":
      return [{ label: "Ready To Ship", endpoint: "ready-to-ship" }];
    case "ready_to_ship":
      return [{ label: "In Transit", endpoint: "in-transit" }];
    case "in_transit":
      return [{ label: "Delivered", endpoint: "delivered" }];
    case "delivered":
      return [{ label: "Complete PO", endpoint: "complete" }];
    case "completed":
      return [{ label: "Close PO", endpoint: "close", confirm: "Yakin ingin menutup PO ini? Tindakan ini tidak dapat dibatalkan." }];
    default:
      return [];
  }
}

// ── Sub-components ────────────────────────────────────────────────────────────

function InfoRow({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="flex justify-between py-2 border-b last:border-b-0">
      <span className="text-sm text-muted-foreground">{label}</span>
      <span className="text-sm font-medium text-right max-w-xs">{value ?? "—"}</span>
    </div>
  );
}

function ShipmentCard({ shipment }: { shipment: Shipment }) {
  const [expanded, setExpanded] = useState(false);

  const { data: timelineData, isLoading: loadingTimeline } = useQuery<{ ok: boolean; data: ShipmentEvent[] }>({
    queryKey: ["mkt-shipment-timeline", shipment.id],
    queryFn: async () => {
      const res = await fetch(`/api/mkt/admin/shipments/${shipment.id}/timeline`, { credentials: "include" });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      return res.json();
    },
    enabled: expanded,
    staleTime: 30_000,
  });

  const { data: receiptsData, isLoading: loadingReceipts } = useQuery<{ ok: boolean; data: GoodsReceipt[] }>({
    queryKey: ["mkt-shipment-receipts", shipment.id],
    queryFn: async () => {
      const res = await fetch(`/api/mkt/admin/shipments/${shipment.id}/goods-receipts`, { credentials: "include" });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      return res.json();
    },
    enabled: expanded,
    staleTime: 30_000,
  });

  const timeline = timelineData?.data ?? [];
  const receipts = receiptsData?.data ?? [];

  return (
    <Card className="border-l-4 border-l-blue-400">
      <CardHeader className="pb-2">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <Truck className="w-4 h-4 text-blue-500" />
            <div>
              <p className="font-semibold text-sm">{shipment.shipmentNumber}</p>
              <p className="text-xs text-muted-foreground">Dibuat {fmtDateTime(shipment.createdAt)}</p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <ShipmentStatusBadge status={shipment.status} />
            <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => setExpanded(!expanded)}>
              {expanded ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
            </Button>
          </div>
        </div>
      </CardHeader>

      {expanded && (
        <CardContent className="pt-0 space-y-4">
          <div className="grid grid-cols-2 gap-3 text-sm">
            <div><span className="text-muted-foreground">Carrier:</span> <span className="font-medium">{shipment.carrier ?? "—"}</span></div>
            <div><span className="text-muted-foreground">Tracking:</span> <span className="font-mono text-xs">{shipment.trackingNumber ?? "—"}</span></div>
            <div><span className="text-muted-foreground">Estimasi Tiba:</span> <span className="font-medium">{fmtDate(shipment.estimatedArrival)}</span></div>
            <div><span className="text-muted-foreground">Tiba Aktual:</span> <span className="font-medium">{fmtDate(shipment.actualArrival)}</span></div>
            {shipment.notes && (
              <div className="col-span-2"><span className="text-muted-foreground">Catatan:</span> <span>{shipment.notes}</span></div>
            )}
          </div>

          <div>
            <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-2">Timeline Pengiriman</p>
            {loadingTimeline && <Skeleton className="h-8 w-full" />}
            {!loadingTimeline && timeline.length === 0 && (
              <p className="text-xs text-muted-foreground italic">Belum ada event</p>
            )}
            {!loadingTimeline && timeline.length > 0 && (
              <div className="space-y-2">
                {timeline.map((ev) => (
                  <div key={ev.id} className="flex gap-3 items-start text-sm">
                    <Clock className="w-3.5 h-3.5 text-muted-foreground shrink-0 mt-0.5" />
                    <div>
                      <span className="font-medium">{ev.eventType}</span>
                      {ev.note && <span className="text-muted-foreground"> — {ev.note}</span>}
                      <p className="text-xs text-muted-foreground">{fmtDateTime(ev.occurredAt)}{ev.actorName ? ` · ${ev.actorName}` : ""}</p>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>

          <div>
            <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-2">Goods Receipts</p>
            {loadingReceipts && <Skeleton className="h-8 w-full" />}
            {!loadingReceipts && receipts.length === 0 && (
              <p className="text-xs text-muted-foreground italic">Belum ada goods receipt</p>
            )}
            {!loadingReceipts && receipts.map((gr) => (
              <div key={gr.id} className="flex items-center gap-3 p-2 rounded bg-muted/40 mb-2">
                <ClipboardCheck className="w-4 h-4 text-green-500 shrink-0" />
                <div className="flex-1">
                  <p className="text-sm font-medium">{gr.receiptNumber}</p>
                  <p className="text-xs text-muted-foreground">{fmtDate(gr.receivedAt)}</p>
                </div>
                <GoodsReceiptBadge type={gr.receiptType} />
                <InspectionStatusBadge status={gr.inspectionStatus} />
              </div>
            ))}
          </div>
        </CardContent>
      )}
    </Card>
  );
}

function GoodsReceiptPanel({ shipment }: { shipment: Shipment }) {
  const { data, isLoading } = useQuery<{ ok: boolean; data: GoodsReceipt[] }>({
    queryKey: ["mkt-shipment-receipts", shipment.id],
    queryFn: async () => {
      const res = await fetch(`/api/mkt/admin/shipments/${shipment.id}/goods-receipts`, { credentials: "include" });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      return res.json();
    },
    staleTime: 30_000,
  });

  const receipts = data?.data ?? [];

  return (
    <Card>
      <CardHeader className="pb-2">
        <div className="flex items-center gap-2">
          <Truck className="w-4 h-4 text-blue-500" />
          <CardTitle className="text-sm">{shipment.shipmentNumber}</CardTitle>
          <ShipmentStatusBadge status={shipment.status} />
        </div>
      </CardHeader>
      <CardContent>
        {isLoading && <Skeleton className="h-10 w-full" />}
        {!isLoading && receipts.length === 0 && (
          <p className="text-xs text-muted-foreground italic">Belum ada goods receipt untuk shipment ini</p>
        )}
        {!isLoading && receipts.map((gr) => (
          <div key={gr.id} className="flex items-center gap-3 p-2 rounded bg-muted/40 mb-2">
            <ClipboardCheck className="w-4 h-4 text-green-500 shrink-0" />
            <div className="flex-1">
              <p className="text-sm font-medium">{gr.receiptNumber}</p>
              <p className="text-xs text-muted-foreground">{gr.receivedAt ? new Date(gr.receivedAt).toLocaleDateString("id-ID") : "—"}</p>
              {gr.notes && <p className="text-xs text-muted-foreground mt-0.5">{gr.notes}</p>}
            </div>
            <GoodsReceiptBadge type={gr.receiptType} />
            <InspectionStatusBadge status={gr.inspectionStatus} />
          </div>
        ))}
      </CardContent>
    </Card>
  );
}

function ShipmentTimeline({ shipment }: { shipment: Shipment }) {
  const { data, isLoading } = useQuery<{ ok: boolean; data: ShipmentEvent[] }>({
    queryKey: ["mkt-shipment-timeline", shipment.id],
    queryFn: async () => {
      const res = await fetch(`/api/mkt/admin/shipments/${shipment.id}/timeline`, { credentials: "include" });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      return res.json();
    },
    staleTime: 30_000,
  });

  const events = data?.data ?? [];

  return (
    <Card className="mb-4">
      <CardHeader className="pb-2">
        <div className="flex items-center gap-2">
          <Truck className="w-4 h-4 text-blue-500" />
          <CardTitle className="text-sm">{shipment.shipmentNumber}</CardTitle>
          <ShipmentStatusBadge status={shipment.status} />
        </div>
      </CardHeader>
      <CardContent>
        {isLoading && <Skeleton className="h-20 w-full" />}
        {!isLoading && events.length === 0 && (
          <p className="text-xs text-muted-foreground italic">Belum ada event timeline</p>
        )}
        {!isLoading && events.length > 0 && (
          <ol className="relative border-l border-muted-foreground/20 space-y-4 ml-2">
            {events.map((ev) => (
              <li key={ev.id} className="ml-4">
                <span className="absolute -left-1.5 mt-1 w-3 h-3 rounded-full bg-blue-400 border-2 border-white" />
                <p className="text-sm font-semibold">{ev.eventType}</p>
                {ev.note && <p className="text-xs text-muted-foreground">{ev.note}</p>}
                <p className="text-xs text-muted-foreground mt-0.5">
                  {new Date(ev.occurredAt).toLocaleString("id-ID")}
                  {ev.actorName ? ` · ${ev.actorName}` : ""}
                </p>
              </li>
            ))}
          </ol>
        )}
      </CardContent>
    </Card>
  );
}

function ActivityItem({ icon, label, time, actor }: {
  icon: React.ReactNode; label: string; time: string | null; actor: string | null | undefined;
}) {
  if (!time) return null;
  return (
    <div className="flex items-start gap-3 p-3 rounded-lg border bg-muted/20">
      <div className="shrink-0 mt-0.5">{icon}</div>
      <div>
        <p className="text-sm font-medium">{label}</p>
        <p className="text-xs text-muted-foreground">
          {new Date(time).toLocaleString("id-ID")}
          {actor ? ` · ${actor}` : ""}
        </p>
      </div>
    </div>
  );
}

// ── Main Page ─────────────────────────────────────────────────────────────────

export default function MktPoDetailPage() {
  const params = useParams<{ poId: string }>();
  const poId = Number(params.poId);
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [confirmAction, setConfirmAction] = useState<ActionDef | null>(null);

  const { data: poData, isLoading, isError } = useQuery<{ ok: boolean; data: PoDetail }>({
    queryKey: ["mkt-po-detail", poId],
    queryFn: async () => {
      const res = await fetch(`/api/mkt/admin/purchase-orders/${poId}`, { credentials: "include" });
      if (!res.ok) {
        const d = await res.json() as { error?: string };
        throw new Error(d.error ?? `HTTP ${res.status}`);
      }
      return res.json();
    },
    enabled: !!poId && !isNaN(poId),
    staleTime: 30_000,
  });

  const { data: shipmentsData, isLoading: loadingShipments } = useQuery<{ ok: boolean; data: Shipment[] }>({
    queryKey: ["mkt-po-shipments", poId],
    queryFn: async () => {
      const res = await fetch(`/api/mkt/admin/purchase-orders/${poId}/shipments`, { credentials: "include" });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      return res.json();
    },
    enabled: !!poId && !isNaN(poId),
    staleTime: 30_000,
  });

  const { data: linesData, isLoading: loadingLines } = useQuery<{ ok: boolean; count: number; data: PoLine[] }>({
    queryKey: ["mkt-po-lines", poId],
    queryFn: async () => {
      const res = await fetch(`/api/mkt/admin/purchase-orders/${poId}/lines`, { credentials: "include" });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      return res.json();
    },
    enabled: !!poId && !isNaN(poId),
    staleTime: 60_000,
  });

  const { data: activityData, isLoading: loadingActivity, isError: activityError } = useQuery<{ ok: boolean; count: number; data: ActivityLogEntry[] }>({
    queryKey: ["mkt-po-activity-log", poId],
    queryFn: async () => {
      const res = await fetch(`/api/mkt/admin/purchase-orders/${poId}/activity-log`, { credentials: "include" });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      return res.json();
    },
    enabled: !!poId && !isNaN(poId),
    staleTime: 30_000,
  });

  const po = poData?.data;
  const shipments = shipmentsData?.data ?? [];
  const poLines  = linesData?.data ?? [];
  const actions = po ? getActions(po.status) : [];
  const isReadOnly = po?.status === "closed" || po?.status === "cancelled";

  const lifecycleMutation = useMutation({
    mutationFn: async (endpoint: string) => {
      const res = await fetch(`/api/mkt/admin/purchase-orders/${poId}/${endpoint}`, {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
      });
      const body = await res.json() as { ok: boolean; error?: string; message?: string };
      if (!res.ok || !body.ok) throw new Error(body.message ?? body.error ?? `HTTP ${res.status}`);
      return body;
    },
    onSuccess: () => {
      toast({ title: "Berhasil", description: "Status PO berhasil diperbarui." });
      queryClient.invalidateQueries({ queryKey: ["mkt-po-detail", poId] });
      queryClient.invalidateQueries({ queryKey: ["mkt-admin-purchase-orders"] });
    },
    onError: (err: Error) => {
      toast({ title: "Gagal", description: err.message, variant: "destructive" });
    },
  });

  function handleAction(action: ActionDef) {
    if (action.confirm) {
      setConfirmAction(action);
    } else {
      lifecycleMutation.mutate(action.endpoint);
    }
  }

  if (isLoading) {
    return (
      <AppShell>
        <div className="p-6 max-w-5xl mx-auto space-y-4">
          <Skeleton className="h-8 w-64" />
          <Skeleton className="h-48 w-full" />
          <Skeleton className="h-64 w-full" />
        </div>
      </AppShell>
    );
  }

  if (isError || !po) {
    return (
      <AppShell>
        <div className="p-6 max-w-5xl mx-auto">
          <div className="text-center py-24 space-y-4">
            <AlertCircle className="w-12 h-12 text-red-400 mx-auto" />
            <p className="text-lg font-semibold text-gray-700">Purchase Order tidak ditemukan</p>
            <p className="text-sm text-muted-foreground">PO #{poId} tidak ada atau Anda tidak memiliki akses.</p>
            <Link href="/marketplace/purchase-orders">
              <Button variant="outline"><ArrowLeft className="w-4 h-4 mr-1" /> Kembali ke Daftar PO</Button>
            </Link>
          </div>
        </div>
      </AppShell>
    );
  }

  return (
    <AppShell>
      <div className="p-6 max-w-5xl mx-auto space-y-6">

        <div className="flex items-start justify-between gap-4">
          <div className="flex items-center gap-3">
            <Link href="/marketplace/purchase-orders">
              <Button variant="ghost" size="icon" className="h-8 w-8">
                <ArrowLeft className="w-4 h-4" />
              </Button>
            </Link>
            <div>
              <div className="flex items-center gap-2">
                <Package className="w-5 h-5 text-orange-500" />
                <h1 className="text-xl font-bold text-gray-900">{po.poNumber}</h1>
                <PoStatusBadge status={po.status} />
                {isReadOnly && <Badge variant="outline" className="text-xs text-slate-500 border-slate-300">Read Only</Badge>}
              </div>
              <p className="text-sm text-muted-foreground mt-0.5">Dibuat {fmtDateTime(po.createdAt)}</p>
            </div>
          </div>

          {po.status === "issued" && (
            <div className="flex items-center gap-2 shrink-0 text-xs text-muted-foreground border rounded px-3 py-1.5 bg-blue-50 border-blue-200">
              <Clock className="w-3.5 h-3.5 text-blue-400" />
              Menunggu konfirmasi vendor
            </div>
          )}
          {!isReadOnly && actions.length > 0 && (
            <div className="flex items-center gap-2 shrink-0">
              {actions.map((action) => (
                <Button
                  key={action.endpoint}
                  variant={action.variant ?? "default"}
                  size="sm"
                  disabled={lifecycleMutation.isPending}
                  onClick={() => handleAction(action)}
                >
                  {action.label}
                </Button>
              ))}
            </div>
          )}
        </div>

        <Tabs defaultValue="overview">
          <TabsList className="w-full justify-start overflow-x-auto">
            <TabsTrigger value="overview"><Info className="w-3.5 h-3.5 mr-1" />Overview</TabsTrigger>
            <TabsTrigger value="items"><Package className="w-3.5 h-3.5 mr-1" />Items</TabsTrigger>
            <TabsTrigger value="shipment"><Truck className="w-3.5 h-3.5 mr-1" />Shipment</TabsTrigger>
            <TabsTrigger value="goods-receipt"><ClipboardCheck className="w-3.5 h-3.5 mr-1" />Goods Receipt</TabsTrigger>
            <TabsTrigger value="timeline"><Clock className="w-3.5 h-3.5 mr-1" />Timeline</TabsTrigger>
            <TabsTrigger value="activity"><Activity className="w-3.5 h-3.5 mr-1" />Activity Log</TabsTrigger>
          </TabsList>

          <TabsContent value="overview" className="mt-4">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <Card>
                <CardHeader className="pb-2"><CardTitle className="text-sm">Informasi PO</CardTitle></CardHeader>
                <CardContent>
                  <InfoRow label="No. PO" value={<span className="font-mono text-xs">{po.poNumber}</span>} />
                  <InfoRow label="No. RFQ" value={po.rfqNumber ? (
                    <Link href={`/marketplace/rfqs/${po.rfqId}`} className="text-blue-600 hover:underline font-mono text-xs">{po.rfqNumber}</Link>
                  ) : "—"} />
                  <InfoRow label="Status" value={<PoStatusBadge status={po.status} />} />
                  <InfoRow label="Dibuat" value={fmtDateTime(po.createdAt)} />
                  <InfoRow label="Dikonfirmasi" value={fmtDateTime(po.confirmedAt)} />
                  {po.cancelledAt && <InfoRow label="Dibatalkan" value={fmtDateTime(po.cancelledAt)} />}
                  {po.cancelReason && <InfoRow label="Alasan Batal" value={po.cancelReason} />}
                </CardContent>
              </Card>

              <Card>
                <CardHeader className="pb-2"><CardTitle className="text-sm">Finansial</CardTitle></CardHeader>
                <CardContent>
                  <InfoRow label="Sub Total" value={fmtCurrency(po.totalAmount, po.currencySnapshot)} />
                  <InfoRow label="Pajak" value={fmtCurrency(po.taxAmount, po.currencySnapshot)} />
                  <InfoRow label="Grand Total" value={
                    <span className="font-bold text-base">{fmtCurrency(po.grandTotal, po.currencySnapshot)}</span>
                  } />
                  <InfoRow label="Mata Uang" value={po.currencySnapshot ?? "—"} />
                  <InfoRow label="Journal Posted" value={fmtDateTime(po.journalPostedAt)} />
                </CardContent>
              </Card>

              <Card>
                <CardHeader className="pb-2"><CardTitle className="text-sm">Vendor</CardTitle></CardHeader>
                <CardContent>
                  <InfoRow label="Nama" value={po.vendorName ?? po.vendorNameSnapshot} />
                  <InfoRow label="Email" value={po.vendorEmail} />
                  <InfoRow label="Telepon" value={po.vendorPhone} />
                  <InfoRow label="Alamat" value={po.vendorAddressSnapshot} />
                  <InfoRow label="Quote Status" value={
                    <Badge variant="outline" className="text-xs">{po.quoteStatus ?? "—"}</Badge>
                  } />
                </CardContent>
              </Card>

              <Card>
                <CardHeader className="pb-2"><CardTitle className="text-sm">Buyer</CardTitle></CardHeader>
                <CardContent>
                  <InfoRow label="Nama" value={po.buyerName} />
                  <InfoRow label="Email" value={po.buyerEmail} />
                </CardContent>
              </Card>

              <Card className="md:col-span-2">
                <CardHeader className="pb-2"><CardTitle className="text-sm">Snapshot Penawaran (Immutable)</CardTitle></CardHeader>
                <CardContent>
                  <div className="grid grid-cols-2 md:grid-cols-3 gap-x-6">
                    <InfoRow label="No. Quotation" value={<span className="font-mono text-xs">{po.quotationNumberSnapshot}</span>} />
                    <InfoRow label="Tgl Quotation" value={fmtDate(po.quotationDateSnapshot)} />
                    <InfoRow label="Payment Terms" value={po.paymentTermsSnapshot} />
                    <InfoRow label="Incoterm" value={po.incotermSnapshot} />
                    <InfoRow label="Lead Time" value={po.leadTimeDaysSnapshot != null ? `${po.leadTimeDaysSnapshot} hari` : "—"} />
                  </div>
                </CardContent>
              </Card>
            </div>
          </TabsContent>

          <TabsContent value="items" className="mt-4">
            <Card>
              <CardHeader>
                <CardTitle className="text-sm flex items-center gap-2">
                  <Package className="w-4 h-4" />
                  Item PO (Snapshot Immutable)
                  {!loadingLines && (
                    <span className="ml-auto text-xs font-normal text-muted-foreground">
                      {poLines.length} item
                    </span>
                  )}
                </CardTitle>
              </CardHeader>
              <CardContent className="p-0">
                {loadingLines ? (
                  <div className="p-6 space-y-2">
                    <Skeleton className="h-8 w-full" />
                    <Skeleton className="h-8 w-full" />
                    <Skeleton className="h-8 w-full" />
                  </div>
                ) : poLines.length === 0 ? (
                  <div className="flex flex-col items-center justify-center py-12 gap-3 text-center px-6">
                    <AlertCircle className="w-8 h-8 text-muted-foreground/40" />
                    <p className="text-sm text-muted-foreground">Tidak ada item pada PO ini.</p>
                  </div>
                ) : (
                  <div className="overflow-x-auto">
                    <table className="w-full text-sm">
                      <thead>
                        <tr className="border-b bg-muted/40 text-xs text-muted-foreground">
                          <th className="px-4 py-2.5 text-left font-medium w-12">Line</th>
                          <th className="px-4 py-2.5 text-left font-medium">Item</th>
                          <th className="px-4 py-2.5 text-left font-medium hidden md:table-cell">Description</th>
                          <th className="px-4 py-2.5 text-right font-medium">Qty</th>
                          <th className="px-4 py-2.5 text-left font-medium">Unit</th>
                          <th className="px-4 py-2.5 text-right font-medium">Unit Price</th>
                          <th className="px-4 py-2.5 text-right font-medium">Subtotal</th>
                          <th className="px-4 py-2.5 text-left font-medium hidden lg:table-cell">Notes</th>
                        </tr>
                      </thead>
                      <tbody>
                        {poLines.map((line) => (
                          <tr key={line.id} className="border-b last:border-b-0 hover:bg-muted/20 transition-colors">
                            <td className="px-4 py-3 text-center text-muted-foreground font-mono text-xs">
                              {line.lineNumber}
                            </td>
                            <td className="px-4 py-3 font-medium">{line.itemName}</td>
                            <td className="px-4 py-3 text-muted-foreground hidden md:table-cell">
                              {line.description ?? "—"}
                            </td>
                            <td className="px-4 py-3 text-right tabular-nums">
                              {parseFloat(line.qty).toLocaleString("id-ID")}
                            </td>
                            <td className="px-4 py-3 text-muted-foreground">{line.unit ?? "—"}</td>
                            <td className="px-4 py-3 text-right tabular-nums">
                              {fmtCurrency(line.unitPrice, po.currencySnapshot)}
                            </td>
                            <td className="px-4 py-3 text-right tabular-nums font-semibold">
                              {fmtCurrency(line.subtotal, po.currencySnapshot)}
                            </td>
                            <td className="px-4 py-3 text-muted-foreground hidden lg:table-cell text-xs">
                              {line.notes ?? "—"}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                      <tfoot>
                        <tr className="border-t bg-muted/20">
                          <td colSpan={6} className="px-4 py-2.5 text-right text-xs font-medium text-muted-foreground">
                            Total
                          </td>
                          <td className="px-4 py-2.5 text-right font-bold">
                            {fmtCurrency(po.grandTotal, po.currencySnapshot)}
                          </td>
                          <td className="hidden lg:table-cell" />
                        </tr>
                      </tfoot>
                    </table>
                  </div>
                )}
              </CardContent>
            </Card>
          </TabsContent>

          <TabsContent value="shipment" className="mt-4">
            <div className="space-y-4">
              <div className="flex items-center justify-between">
                <h3 className="text-sm font-semibold">Daftar Pengiriman ({shipments.length})</h3>
              </div>
              {loadingShipments && (
                <div className="space-y-3">
                  {[1, 2].map((i) => <Skeleton key={i} className="h-16 w-full" />)}
                </div>
              )}
              {!loadingShipments && shipments.length === 0 && (
                <Card>
                  <CardContent className="py-12 flex flex-col items-center gap-3">
                    <Truck className="w-10 h-10 text-gray-200" />
                    <p className="text-sm text-muted-foreground">Belum ada shipment untuk PO ini</p>
                  </CardContent>
                </Card>
              )}
              {!loadingShipments && shipments.map((s) => (
                <ShipmentCard key={s.id} shipment={s} />
              ))}
            </div>
          </TabsContent>

          <TabsContent value="goods-receipt" className="mt-4">
            <div className="space-y-4">
              {loadingShipments && <Skeleton className="h-24 w-full" />}
              {!loadingShipments && shipments.length === 0 && (
                <Card>
                  <CardContent className="py-12 flex flex-col items-center gap-3">
                    <ClipboardCheck className="w-10 h-10 text-gray-200" />
                    <p className="text-sm text-muted-foreground">Belum ada shipment — goods receipt belum bisa dibuat</p>
                  </CardContent>
                </Card>
              )}
              {!loadingShipments && shipments.map((s) => (
                <GoodsReceiptPanel key={s.id} shipment={s} />
              ))}
            </div>
          </TabsContent>

          <TabsContent value="timeline" className="mt-4">
            {loadingShipments && <Skeleton className="h-32 w-full" />}
            {!loadingShipments && shipments.length === 0 && (
              <Card>
                <CardContent className="py-12 flex flex-col items-center gap-3">
                  <Clock className="w-10 h-10 text-gray-200" />
                  <p className="text-sm text-muted-foreground">Belum ada shipment — timeline belum tersedia</p>
                </CardContent>
              </Card>
            )}
            {!loadingShipments && shipments.map((s) => (
              <ShipmentTimeline key={s.id} shipment={s} />
            ))}
          </TabsContent>

          <TabsContent value="activity" className="mt-4">
            <Card>
              <CardHeader>
                <CardTitle className="text-sm flex items-center gap-2">
                  <Activity className="w-4 h-4" />
                  Activity Log (Audit Trail)
                </CardTitle>
              </CardHeader>
              <CardContent>
                {loadingActivity && (
                  <div className="space-y-2">
                    <Skeleton className="h-12 w-full" />
                    <Skeleton className="h-12 w-full" />
                    <Skeleton className="h-12 w-full" />
                  </div>
                )}
                {!loadingActivity && activityError && (
                  <div className="flex items-center gap-2 text-sm text-red-500 py-4">
                    <AlertCircle className="w-4 h-4" />
                    <span>Gagal memuat activity log.</span>
                  </div>
                )}
                {!loadingActivity && !activityError && (activityData?.data ?? []).length === 0 && (
                  <div className="flex flex-col items-center gap-2 py-10 text-muted-foreground">
                    <Clock className="w-8 h-8 text-gray-200" />
                    <p className="text-sm">Belum ada aktivitas tercatat untuk PO ini.</p>
                  </div>
                )}
                {!loadingActivity && !activityError && (activityData?.data ?? []).length > 0 && (
                  <div className="space-y-2">
                    {(activityData!.data).map((entry) => (
                      <div key={entry.id} className="flex items-start gap-3 p-3 rounded-lg border bg-muted/20">
                        <div className="shrink-0 mt-0.5">
                          {entry.statusTo === "cancelled" || entry.action?.includes("cancel")
                            ? <AlertCircle className="w-4 h-4 text-red-500" />
                            : entry.statusTo === "completed" || entry.statusTo === "closed"
                              ? <CheckCircle2 className="w-4 h-4 text-green-500" />
                              : <Activity className="w-4 h-4 text-blue-500" />}
                        </div>
                        <div className="flex-1 min-w-0">
                          <div className="flex items-start justify-between gap-2">
                            <p className="text-sm font-medium">{entry.action}</p>
                            <p className="text-xs text-muted-foreground whitespace-nowrap shrink-0">
                              {new Date(entry.createdAt).toLocaleString("id-ID")}
                            </p>
                          </div>
                          {(entry.statusFrom || entry.statusTo) && (
                            <p className="text-xs text-muted-foreground mt-0.5">
                              {entry.statusFrom && <span className="font-mono">{entry.statusFrom}</span>}
                              {entry.statusFrom && entry.statusTo && <span> → </span>}
                              {entry.statusTo && <span className="font-mono">{entry.statusTo}</span>}
                            </p>
                          )}
                          {entry.message && (
                            <p className="text-xs text-muted-foreground mt-0.5">{entry.message}</p>
                          )}
                          {(entry.actorName || entry.actorRole) && (
                            <p className="text-xs text-muted-foreground mt-0.5">
                              {entry.actorName ?? "—"}{entry.actorRole ? ` (${entry.actorRole})` : ""}
                            </p>
                          )}
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </CardContent>
            </Card>
          </TabsContent>
        </Tabs>
      </div>

      <Dialog open={!!confirmAction} onOpenChange={(open) => { if (!open) setConfirmAction(null); }}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Konfirmasi Tindakan</DialogTitle>
          </DialogHeader>
          <p className="text-sm text-muted-foreground">{confirmAction?.confirm}</p>
          <DialogFooter>
            <Button variant="outline" onClick={() => setConfirmAction(null)}>Batal</Button>
            <Button
              variant={confirmAction?.variant === "destructive" ? "destructive" : "default"}
              disabled={lifecycleMutation.isPending}
              onClick={() => {
                if (confirmAction) {
                  lifecycleMutation.mutate(confirmAction.endpoint);
                  setConfirmAction(null);
                }
              }}
            >
              {confirmAction?.label}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </AppShell>
  );
}
