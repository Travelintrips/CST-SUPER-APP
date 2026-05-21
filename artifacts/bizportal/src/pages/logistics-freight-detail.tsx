import { AppShell } from "@/components/layout/AppShell";
import { useQueryClient } from "@tanstack/react-query";
import { useLocation, useParams } from "wouter";
import { useState, useEffect, useRef } from "react";
import { useQuery } from "@tanstack/react-query";
import { useOrderNotificationsContext } from "@/contexts/OrderNotificationsContext";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Separator } from "@/components/ui/separator";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import {
  ArrowLeft, Pencil, Printer, Plus, CheckCircle, Loader2, Ship, FileText, FileDown, Paperclip,
  TrendingDown, TrendingUp, Receipt, ExternalLink, MessageSquare, ShoppingCart, Package, Truck,
  History, User, ArrowRight,
} from "lucide-react";
import { CorrespondenceTab } from "@/components/CorrespondenceTab";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import { FreightAttachmentsPanel } from "@/components/freight/FreightAttachmentsPanel";
import { FreightCustomsPanel } from "@/components/freight/FreightCustomsPanel";
import { DriverAssignmentPanel } from "@/components/freight/DriverAssignmentPanel";
import { useToast } from "@/hooks/use-toast";
import { useLanguage } from "@/contexts/LanguageContext";
import {
  useGetFreightShipment,
  useGetSalesDocument,
  useGetPurchaseDocument,
  useCreateFreightRfq,
  useCreateFreightQuote,
  useApproveFreightQuote,
  useUpdateFreightShipment,
  useUpsertShipmentStage,
  useListExpenses,
  useGetFreightShipmentProfitability,
  getGetFreightShipmentQueryKey,
  getGetSalesDocumentQueryKey,
  getGetPurchaseDocumentQueryKey,
  getGetFreightShipmentProfitabilityQueryKey,
  type FreightRfqWithQuotes,
  type FreightQuote,
  type ShipmentStage,
  type FreightShipmentDetail,
} from "@workspace/api-client-react";
import { Link } from "wouter";

const STATUS_LABELS: Record<string, string> = {
  draft: "Draft",
  rfq_sent: "RFQ Dikirim",
  confirmed: "Dikonfirmasi",
  in_transit: "Dalam Perjalanan",
  completed: "Selesai",
  cancelled: "Dibatalkan",
};

const STATUS_COLORS: Record<string, string> = {
  draft: "bg-muted text-muted-foreground",
  rfq_sent: "bg-amber-500/10 text-amber-500 border-amber-500/20",
  confirmed: "bg-blue-500/10 text-blue-500 border-blue-500/20",
  in_transit: "bg-indigo-500/10 text-indigo-500 border-indigo-500/20",
  completed: "bg-emerald-500/10 text-emerald-500 border-emerald-500/20",
  cancelled: "bg-destructive/10 text-destructive border-destructive/20",
};

const QUOTE_STATUS_COLORS: Record<string, string> = {
  pending: "bg-muted text-muted-foreground",
  approved: "bg-emerald-500/10 text-emerald-500 border-emerald-500/20",
  rejected: "bg-destructive/10 text-destructive border-destructive/20",
};

function fmt(n: string | null | undefined) {
  if (!n) return "—";
  return new Intl.NumberFormat("id-ID", { style: "currency", currency: "IDR", maximumFractionDigits: 0 }).format(Number(n));
}

function InfoRow({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="flex gap-2">
      <span className="text-muted-foreground w-40 shrink-0 text-sm">{label}</span>
      <span className="text-sm font-medium">{value ?? "—"}</span>
    </div>
  );
}

export default function LogisticsFreightDetailPage() {
  const params = useParams<{ id: string }>();
  const id = Number(params.id);
  const [, navigate] = useLocation();
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const { t } = useLanguage();
  const { lastFreightEventAt, notifications } = useOrderNotificationsContext();
  const [liveRefreshFlash, setLiveRefreshFlash] = useState(false);
  const lastSeenNotifIdRef = useRef<string | null>(null);

  const { data: shipment, isLoading } = useGetFreightShipment(id);
  const typedShipment = shipment as FreightShipmentDetail | undefined;
  const salesDocId = typedShipment?.salesDocId;
  const purchaseDocId = typedShipment?.purchaseDocId;
  const { data: linkedSalesDoc } = useGetSalesDocument(salesDocId ?? 0, { query: { queryKey: getGetSalesDocumentQueryKey(salesDocId ?? 0), enabled: !!salesDocId } });
  const { data: linkedPurchaseDoc } = useGetPurchaseDocument(purchaseDocId ?? 0, { query: { queryKey: getGetPurchaseDocumentQueryKey(purchaseDocId ?? 0), enabled: !!purchaseDocId } });
  const { data: expenses = [], isLoading: expensesLoading } = useListExpenses({ shipmentId: id });
  const { data: profitability } = useGetFreightShipmentProfitability(id, { query: { queryKey: getGetFreightShipmentProfitabilityQueryKey(id), enabled: !!id } });

  interface AuditLog { id: number; shipmentId: number; shipmentNumber: string; fromStatus: string | null; toStatus: string; changedBy: string; changedById: string | null; notes: string | null; createdAt: string; }
  const auditLogQueryKey = ["freight-audit-log", id];
  const { data: auditLogs = [], refetch: refetchAuditLog } = useQuery<AuditLog[]>({
    queryKey: auditLogQueryKey,
    queryFn: async () => {
      const res = await fetch(`/api/logistics/freight-shipments/${id}/audit-log`, { credentials: "include" });
      if (!res.ok) throw new Error("Failed to fetch audit log");
      return res.json() as Promise<AuditLog[]>;
    },
    enabled: !!id,
  });
  const idr = (n: number) =>
    new Intl.NumberFormat("id-ID", { style: "currency", currency: "IDR", maximumFractionDigits: 0 }).format(n);
  const createRfq = useCreateFreightRfq();
  const createQuote = useCreateFreightQuote();
  const approveQuote = useApproveFreightQuote();
  const updateShipment = useUpdateFreightShipment();

  const [showRfqDialog, setShowRfqDialog] = useState(false);
  const [rfqVendors, setRfqVendors] = useState("");
  const [rfqNotes, setRfqNotes] = useState("");

  const [showInTransitDialog, setShowInTransitDialog] = useState(false);
  const [inTransitForm, setInTransitForm] = useState({ departureDate: "", trackingNumber: "", awbNumber: "" });

  const [showCompletedDialog, setShowCompletedDialog] = useState(false);
  const [completedForm, setCompletedForm] = useState({ arrivalDate: "", actualCost: "" });

  const [showEditAktualDialog, setShowEditAktualDialog] = useState(false);
  const [editAktualForm, setEditAktualForm] = useState({
    departureDate: "",
    arrivalDate: "",
    trackingNumber: "",
    awbNumber: "",
    actualCost: "",
  });

  const [showQuoteDialog, setShowQuoteDialog] = useState(false);
  const [quoteRfqId, setQuoteRfqId] = useState<number | null>(null);
  const [quoteForm, setQuoteForm] = useState({
    vendorName: "",
    truckingCost: "",
    handlingCost: "",
    freightCost: "",
    otherCost: "",
    estimatedDays: "",
    notes: "",
  });

  const upsertStage = useUpsertShipmentStage();
  type StageType = "booking" | "trucking" | "handling" | "customs";
  const STAGE_DEFS: { type: StageType; label: string }[] = [
    { type: "booking", label: "Booking" },
    { type: "trucking", label: "Trucking" },
    { type: "handling", label: "Handling" },
    { type: "customs", label: "Customs Clearance" },
  ];
  const [stageForms, setStageForms] = useState<Record<StageType, { vendorName: string; date: string; status: string; notes: string }>>({
    booking:  { vendorName: "", date: "", status: "pending", notes: "" },
    trucking: { vendorName: "", date: "", status: "pending", notes: "" },
    handling: { vendorName: "", date: "", status: "pending", notes: "" },
    customs:  { vendorName: "", date: "", status: "pending", notes: "" },
  });
  const [stagesInitialized, setStagesInitialized] = useState(false);
  const [expenseFilter, setExpenseFilter] = useState<"all" | "approved">("all");

  useEffect(() => {
    if (typedShipment?.stages && !stagesInitialized) {
      const stages: ShipmentStage[] = typedShipment.stages ?? [];
      setStageForms((prev) => {
        const next = { ...prev };
        for (const s of stages) {
          const t = s.stageType as StageType;
          if (t in next) {
            next[t] = {
              vendorName: s.vendorName ?? "",
              date: s.date ? String(s.date).slice(0, 10) : "",
              status: s.status ?? "pending",
              notes: s.notes ?? "",
            };
          }
        }
        return next;
      });
      setStagesInitialized(true);
    }
  }, [shipment, stagesInitialized]);

  const invalidate = () => queryClient.invalidateQueries({ queryKey: getGetFreightShipmentQueryKey(id) });

  useEffect(() => {
    if (!lastFreightEventAt || notifications.length === 0) return;
    const latest = notifications[0];
    if (latest.id === lastSeenNotifIdRef.current) return;
    const isFreight = latest.type === "freight_new" || latest.type === "freight_status" || latest.type === "freight_stage";
    if (!isFreight) return;
    if (latest.orderId !== id) return;
    lastSeenNotifIdRef.current = latest.id;
    queryClient.invalidateQueries({ queryKey: getGetFreightShipmentQueryKey(id) });
    queryClient.invalidateQueries({ queryKey: getGetFreightShipmentProfitabilityQueryKey(id) });
    refetchAuditLog();
    setLiveRefreshFlash(true);
    const timer = setTimeout(() => setLiveRefreshFlash(false), 2500);
    return () => clearTimeout(timer);
  }, [lastFreightEventAt, notifications]);

  const handleSaveStage = (stageType: StageType) => {
    const f = stageForms[stageType];
    upsertStage.mutate(
      { shipmentId: id, data: { stageType, vendorName: f.vendorName || null, date: f.date || null, status: f.status as "pending" | "in_progress" | "done" | "cancelled", notes: f.notes || null } },
      {
        onSuccess: () => { invalidate(); toast({ title: t.common.success }); },
        onError: () => toast({ title: t.common.error, variant: "destructive" }),
      }
    );
  };

  const handleCreateRfq = () => {
    createRfq.mutate(
      { shipmentId: id, data: { vendorNames: rfqVendors.split(",").map((v) => v.trim()).filter(Boolean), notes: rfqNotes || undefined } },
      {
        onSuccess: () => {
          invalidate();
          setShowRfqDialog(false);
          setRfqVendors("");
          setRfqNotes("");
          toast({ title: t.common.success });
        },
        onError: () => toast({ title: t.common.error, variant: "destructive" }),
      }
    );
  };

  const openQuoteDialog = (rfqId: number) => {
    setQuoteRfqId(rfqId);
    setQuoteForm({ vendorName: "", truckingCost: "", handlingCost: "", freightCost: "", otherCost: "", estimatedDays: "", notes: "" });
    setShowQuoteDialog(true);
  };

  const handleCreateQuote = () => {
    if (!quoteRfqId || !quoteForm.vendorName) {
      toast({ title: t.common.error, variant: "destructive" });
      return;
    }
    createQuote.mutate(
      {
        rfqId: quoteRfqId,
        data: {
          vendorName: quoteForm.vendorName,
          truckingCost: quoteForm.truckingCost ? Number(quoteForm.truckingCost) : undefined,
          handlingCost: quoteForm.handlingCost ? Number(quoteForm.handlingCost) : undefined,
          freightCost: quoteForm.freightCost ? Number(quoteForm.freightCost) : undefined,
          otherCost: quoteForm.otherCost ? Number(quoteForm.otherCost) : undefined,
          estimatedDays: quoteForm.estimatedDays ? Number(quoteForm.estimatedDays) : undefined,
          notes: quoteForm.notes || undefined,
        },
      },
      {
        onSuccess: () => {
          invalidate();
          setShowQuoteDialog(false);
          toast({ title: t.common.success });
        },
        onError: () => toast({ title: t.common.error, variant: "destructive" }),
      }
    );
  };

  const handleApprove = (quoteId: number) => {
    if (!confirm("Setujui quote ini? Quote lain akan otomatis ditolak dan status shipment menjadi Dikonfirmasi.")) return;
    approveQuote.mutate(
      { id: quoteId },
      {
        onSuccess: () => {
          invalidate();
          toast({ title: t.common.success });
        },
        onError: () => toast({ title: t.common.error, variant: "destructive" }),
      }
    );
  };

  const handleMarkInTransit = () => {
    if (!inTransitForm.departureDate) {
      toast({ title: t.common.error, variant: "destructive" });
      return;
    }
    updateShipment.mutate(
      {
        id,
        data: {
          shipperName: shipment!.shipperName,
          consigneeName: shipment!.consigneeName,
          commodity: shipment!.commodity,
          origin: shipment!.origin,
          destination: shipment!.destination,
          status: "in_transit",
          departureDate: inTransitForm.departureDate,
          trackingNumber: inTransitForm.trackingNumber || undefined,
          awbNumber: inTransitForm.awbNumber || undefined,
        },
      },
      {
        onSuccess: () => {
          invalidate();
          setShowInTransitDialog(false);
          setInTransitForm({ departureDate: "", trackingNumber: "", awbNumber: "" });
          toast({ title: t.common.success });
        },
        onError: () => toast({ title: t.common.error, variant: "destructive" }),
      }
    );
  };

  const handleMarkCompleted = () => {
    if (!completedForm.arrivalDate) {
      toast({ title: t.common.error, variant: "destructive" });
      return;
    }
    updateShipment.mutate(
      {
        id,
        data: {
          shipperName: shipment!.shipperName,
          consigneeName: shipment!.consigneeName,
          commodity: shipment!.commodity,
          origin: shipment!.origin,
          destination: shipment!.destination,
          status: "completed",
          arrivalDate: completedForm.arrivalDate,
          actualCost: completedForm.actualCost ? Number(completedForm.actualCost) : undefined,
        },
      },
      {
        onSuccess: () => {
          invalidate();
          setShowCompletedDialog(false);
          setCompletedForm({ arrivalDate: "", actualCost: "" });
          toast({ title: t.common.success });
        },
        onError: () => toast({ title: t.common.error, variant: "destructive" }),
      }
    );
  };

  const openEditAktual = () => {
    setEditAktualForm({
      departureDate: shipment!.departureDate ? shipment!.departureDate.substring(0, 10) : "",
      arrivalDate: shipment!.arrivalDate ? shipment!.arrivalDate.substring(0, 10) : "",
      trackingNumber: shipment!.trackingNumber ?? "",
      awbNumber: shipment!.awbNumber ?? "",
      actualCost: shipment!.actualCost ? String(shipment!.actualCost) : "",
    });
    setShowEditAktualDialog(true);
  };

  const handleSaveAktual = () => {
    updateShipment.mutate(
      {
        id,
        data: {
          shipperName: shipment!.shipperName,
          consigneeName: shipment!.consigneeName,
          commodity: shipment!.commodity,
          origin: shipment!.origin,
          destination: shipment!.destination,
          departureDate: editAktualForm.departureDate || null,
          arrivalDate: editAktualForm.arrivalDate || null,
          trackingNumber: editAktualForm.trackingNumber || null,
          awbNumber: editAktualForm.awbNumber || null,
          actualCost: editAktualForm.actualCost ? Number(editAktualForm.actualCost) : null,
        },
      },
      {
        onSuccess: () => {
          invalidate();
          setShowEditAktualDialog(false);
          toast({ title: t.common.success });
        },
        onError: () => toast({ title: t.common.error, variant: "destructive" }),
      }
    );
  };

  if (isLoading) {
    return (
      <AppShell>
        <div className="p-6 space-y-4">
          <Skeleton className="h-8 w-64" />
          <Skeleton className="h-48 w-full" />
        </div>
      </AppShell>
    );
  }

  if (!shipment) {
    return (
      <AppShell>
        <div className="p-6 text-center text-muted-foreground">Shipment tidak ditemukan.</div>
      </AppShell>
    );
  }

  const rfqs: FreightRfqWithQuotes[] = shipment.rfqs ?? [];
  const printDate = new Date().toLocaleDateString("id-ID", { day: "numeric", month: "long", year: "numeric" });

  const allApprovedQuotes = rfqs.flatMap((r) => r.quotes ?? []).filter((q) => q.status === "approved");
  const approvedQuote = allApprovedQuotes.length > 0
    ? allApprovedQuotes.reduce((latest, q) => q.id > latest.id ? q : latest)
    : undefined;
  const quotedCost = approvedQuote?.totalCost ? Number(approvedQuote.totalCost) : null;
  const actualCost = shipment.actualCost ? Number(shipment.actualCost) : null;
  const hasCostComparison = quotedCost !== null && actualCost !== null;
  const variance = hasCostComparison ? actualCost - quotedCost : null;
  const variancePct = hasCostComparison && quotedCost !== 0 ? ((actualCost - quotedCost) / quotedCost) * 100 : null;
  const isOverBudget = variance !== null && variance > 0;

  return (
    <AppShell>
      <div className="p-6 max-w-5xl mx-auto space-y-6">
        {/* Header */}
        <div className="flex items-center justify-between print:hidden">
          <div className="flex items-center gap-3">
            <Button variant="ghost" size="icon" onClick={() => navigate("/logistics/freight")}>
              <ArrowLeft className="h-4 w-4" />
            </Button>
            <div>
              <div className="flex items-center gap-2">
                <Ship className="h-5 w-5 text-primary" />
                <h1 className="text-2xl font-bold font-mono">{shipment.shipmentNumber}</h1>
                <Badge variant="outline" className={STATUS_COLORS[shipment.status] ?? ""}>
                  {STATUS_LABELS[shipment.status] ?? shipment.status}
                </Badge>
              </div>
              <p className="text-sm text-muted-foreground mt-1 flex items-center gap-2">
                <span>Dibuat {new Date(shipment.createdAt).toLocaleDateString("id-ID", { day: "numeric", month: "long", year: "numeric" })}</span>
                {liveRefreshFlash && (
                  <span className="flex items-center gap-1 text-emerald-600 dark:text-emerald-400 font-medium text-xs animate-pulse">
                    <span className="inline-block h-1.5 w-1.5 rounded-full bg-emerald-500 animate-ping" />
                    Diperbarui otomatis
                  </span>
                )}
              </p>
            </div>
          </div>
          <div className="flex gap-2">
            <Button variant="outline" onClick={() => window.print()}>
              <Printer className="h-4 w-4 mr-2" />
              Cetak Packing List
            </Button>
            {["confirmed", "in_transit", "completed"].includes(shipment.status) && (
              <Button variant="outline" onClick={() => navigate(`/logistics/freight/${id}/bl`)}>
                <FileDown className="h-4 w-4 mr-2" />
                Cetak Bill of Lading
              </Button>
            )}
            <Button variant="outline" onClick={() => navigate(`/logistics/freight/edit/${id}`)}>
              <Pencil className="h-4 w-4 mr-2" />
              Edit
            </Button>
            {shipment.status === "confirmed" && (
              <Button onClick={() => setShowInTransitDialog(true)} disabled={updateShipment.isPending}>
                Tandai Dalam Perjalanan
              </Button>
            )}
            {shipment.status === "in_transit" && (
              <Button onClick={() => setShowCompletedDialog(true)} disabled={updateShipment.isPending}>
                Tandai Selesai
              </Button>
            )}
          </div>
        </div>

        {/* Packing List — print only */}
        <div className="hidden print:block">
          <div className="text-center mb-6">
            <h2 className="text-2xl font-bold uppercase tracking-widest">Packing List</h2>
            <p className="text-lg font-semibold mt-1">{shipment.shipmentNumber}</p>
            <p className="text-sm mt-1">Tanggal: {printDate}</p>
          </div>
          <div className="grid grid-cols-2 gap-8 mb-6">
            <div>
              <p className="font-bold text-sm uppercase mb-1">Shipper</p>
              <p className="font-semibold">{shipment.shipperName}</p>
              {shipment.shipperAddress && <p className="text-sm">{shipment.shipperAddress}</p>}
            </div>
            <div>
              <p className="font-bold text-sm uppercase mb-1">Consignee</p>
              <p className="font-semibold">{shipment.consigneeName}</p>
              {shipment.consigneeAddress && <p className="text-sm">{shipment.consigneeAddress}</p>}
            </div>
          </div>
          <table className="w-full border border-gray-300 text-sm mb-4">
            <thead>
              <tr className="bg-gray-100">
                <th className="border border-gray-300 p-2 text-left">Komoditi</th>
                <th className="border border-gray-300 p-2 text-left">HS Code</th>
                <th className="border border-gray-300 p-2 text-right">Qty</th>
                <th className="border border-gray-300 p-2 text-left">Jenis Packing</th>
                <th className="border border-gray-300 p-2 text-right">Berat Bruto</th>
                <th className="border border-gray-300 p-2 text-right">Berat Neto</th>
                <th className="border border-gray-300 p-2 text-left">Dimensi</th>
              </tr>
            </thead>
            <tbody>
              <tr>
                <td className="border border-gray-300 p-2">{shipment.commodity}</td>
                <td className="border border-gray-300 p-2">{shipment.hsCode ?? "—"}</td>
                <td className="border border-gray-300 p-2 text-right">{shipment.quantity ?? "—"}</td>
                <td className="border border-gray-300 p-2">{shipment.packingType ?? "—"}</td>
                <td className="border border-gray-300 p-2 text-right">{shipment.grossWeight ? `${shipment.grossWeight} kg` : "—"}</td>
                <td className="border border-gray-300 p-2 text-right">{shipment.netWeight ? `${shipment.netWeight} kg` : "—"}</td>
                <td className="border border-gray-300 p-2">{shipment.dimensions ?? "—"}</td>
              </tr>
            </tbody>
          </table>
          <div className="flex gap-8 text-sm mb-4">
            <div><span className="font-bold">Asal: </span>{shipment.origin}</div>
            <div><span className="font-bold">Tujuan: </span>{shipment.destination}</div>
          </div>
          {shipment.notes && (
            <p className="text-sm mb-6"><span className="font-bold">Catatan: </span>{shipment.notes}</p>
          )}
          <div className="grid grid-cols-2 gap-8 mt-12">
            <div className="text-center">
              <p className="text-sm mb-16">Dibuat oleh,</p>
              <div className="border-t border-gray-400 pt-2 text-sm">Shipper / Pengirim</div>
            </div>
            <div className="text-center">
              <p className="text-sm mb-16">Mengetahui,</p>
              <div className="border-t border-gray-400 pt-2 text-sm">Freight Forwarder</div>
            </div>
          </div>
        </div>

        {/* Shipment Details Card — screen only */}
        <Card className="print:hidden">
          <CardHeader><CardTitle>Detail Shipment</CardTitle></CardHeader>
          <CardContent className="space-y-3">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
              <div className="space-y-2">
                <p className="text-sm font-semibold text-muted-foreground uppercase tracking-wide">Shipper</p>
                <InfoRow label="Nama" value={shipment.shipperName} />
                <InfoRow label="Alamat" value={shipment.shipperAddress} />
              </div>
              <div className="space-y-2">
                <p className="text-sm font-semibold text-muted-foreground uppercase tracking-wide">Consignee</p>
                <InfoRow label="Nama" value={shipment.consigneeName} />
                <InfoRow label="Alamat" value={shipment.consigneeAddress} />
              </div>
            </div>
            <Separator />
            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
              <div className="space-y-2">
                <p className="text-sm font-semibold text-muted-foreground uppercase tracking-wide">Kargo</p>
                <InfoRow label="Komoditi" value={shipment.commodity} />
                <InfoRow label="HS Code" value={shipment.hsCode} />
                <InfoRow label="Berat Bruto" value={shipment.grossWeight ? `${shipment.grossWeight} kg` : null} />
                <InfoRow label="Berat Neto" value={shipment.netWeight ? `${shipment.netWeight} kg` : null} />
                <InfoRow label="Jumlah" value={shipment.quantity} />
                <InfoRow label="Jenis Packing" value={shipment.packingType} />
                <InfoRow label="Dimensi" value={shipment.dimensions} />
              </div>
              <div className="space-y-2">
                <p className="text-sm font-semibold text-muted-foreground uppercase tracking-wide">Rute</p>
                <InfoRow label="Asal" value={shipment.origin} />
                <InfoRow label="Tujuan" value={shipment.destination} />
                {(shipment.departureDate || shipment.arrivalDate || shipment.trackingNumber || shipment.awbNumber || shipment.actualCost) && (
                  <>
                    <Separator className="my-2" />
                    <div className="flex items-center justify-between">
                      <p className="text-sm font-semibold text-muted-foreground uppercase tracking-wide">Pengiriman Aktual</p>
                      <Button
                        size="icon"
                        variant="ghost"
                        className="h-6 w-6 print:hidden"
                        onClick={openEditAktual}
                        aria-label="Edit info aktual"
                        data-testid="button-edit-aktual"
                      >
                        <Pencil className="h-3.5 w-3.5" />
                      </Button>
                    </div>
                    {shipment.departureDate && (
                      <InfoRow label="Tgl Berangkat" value={new Date(shipment.departureDate).toLocaleDateString("id-ID", { day: "numeric", month: "long", year: "numeric" })} />
                    )}
                    {shipment.arrivalDate && (
                      <InfoRow label="Tgl Tiba" value={new Date(shipment.arrivalDate).toLocaleDateString("id-ID", { day: "numeric", month: "long", year: "numeric" })} />
                    )}
                    {shipment.trackingNumber && <InfoRow label="No. Tracking" value={shipment.trackingNumber} />}
                    {shipment.awbNumber && <InfoRow label="No. AWB / BL" value={shipment.awbNumber} />}
                    {shipment.actualCost && <InfoRow label="Biaya Aktual" value={fmt(shipment.actualCost)} />}
                  </>
                )}
                {shipment.notes && (
                  <>
                    <Separator className="my-2" />
                    <p className="text-sm font-semibold text-muted-foreground uppercase tracking-wide">Catatan</p>
                    <p className="text-sm">{shipment.notes}</p>
                  </>
                )}
                {(salesDocId || purchaseDocId || (typedShipment as any)?.linkedLogisticRfq) && (
                  <>
                    <Separator className="my-2" />
                    <p className="text-sm font-semibold text-muted-foreground uppercase tracking-wide">Tautan</p>
                    <div className="flex flex-wrap gap-2">
                      {salesDocId && (
                        <Link href={`/sales/orders/${salesDocId}`}>
                          <span className="inline-flex items-center gap-1 text-xs text-indigo-600 dark:text-indigo-400 hover:underline font-mono">
                            <ShoppingCart size={10} />
                            {linkedSalesDoc?.docNumber ?? `SO #${salesDocId}`}
                          </span>
                        </Link>
                      )}
                      {purchaseDocId && (
                        <Link href={`/purchase/orders/${purchaseDocId}`}>
                          <span className="inline-flex items-center gap-1 text-xs text-violet-600 dark:text-violet-400 hover:underline font-mono">
                            <Package size={10} />
                            {linkedPurchaseDoc?.docNumber ?? `PO #${purchaseDocId}`}
                          </span>
                        </Link>
                      )}
                      {(typedShipment as any)?.linkedLogisticRfq && (
                        <Link href={`/logistics/rfq/${(typedShipment as any).linkedLogisticRfq.id}/comparison`}>
                          <span className="inline-flex items-center gap-1 text-xs text-teal-600 dark:text-teal-400 hover:underline font-mono">
                            <ArrowLeft size={10} />
                            {(typedShipment as any).linkedLogisticRfq.rfqNumber}
                          </span>
                        </Link>
                      )}
                    </div>
                  </>
                )}
              </div>
            </div>
          </CardContent>
        </Card>

        {/* Cost Comparison Card — shown when approved quote + actual cost both exist */}
        {hasCostComparison && (
          <Card className="print:hidden">
            <CardHeader>
              <CardTitle className="text-base flex items-center gap-2">
                {isOverBudget
                  ? <TrendingUp className="h-4 w-4 text-destructive" />
                  : <TrendingDown className="h-4 w-4 text-emerald-500" />}
                Perbandingan Biaya
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="grid grid-cols-3 gap-4 text-center">
                <div className="space-y-1">
                  <p className="text-xs text-muted-foreground uppercase tracking-wide">Biaya Penawaran</p>
                  <p className="text-lg font-semibold">{fmt(String(quotedCost))}</p>
                  <p className="text-xs text-muted-foreground">dari quote disetujui</p>
                </div>
                <div className="space-y-1">
                  <p className="text-xs text-muted-foreground uppercase tracking-wide">Biaya Aktual</p>
                  <p className="text-lg font-semibold">{fmt(String(actualCost))}</p>
                  <p className="text-xs text-muted-foreground">realisasi pengiriman</p>
                </div>
                <div className="space-y-1">
                  <p className="text-xs text-muted-foreground uppercase tracking-wide">Selisih</p>
                  <p className={`text-lg font-semibold ${isOverBudget ? "text-destructive" : "text-emerald-500"}`}>
                    {variance! > 0 ? "+" : ""}{fmt(String(variance))}
                  </p>
                  {variancePct !== null && (
                    <p className={`text-xs font-medium ${isOverBudget ? "text-destructive" : "text-emerald-500"}`}>
                      {variance! > 0 ? "+" : ""}{variancePct.toFixed(1)}%
                      {isOverBudget ? " melebihi anggaran" : " di bawah anggaran"}
                    </p>
                  )}
                </div>
              </div>
            </CardContent>
          </Card>
        )}

        {/* Bill of Lading Section — screen only */}
        {(shipment.vessel || shipment.voyage || shipment.portOfLoading || shipment.portOfDischarge || shipment.notifyParty || shipment.marksAndNumbers || shipment.measurement) && (
          <Card className="print:hidden">
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Ship className="h-4 w-4 text-primary" />
                Detail Bill of Lading
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                <div className="space-y-2">
                  <InfoRow label="Kapal (Vessel)" value={shipment.vessel} />
                  <InfoRow label="Voyage" value={shipment.voyage} />
                  <InfoRow label="Port of Loading" value={shipment.portOfLoading} />
                  <InfoRow label="Port of Discharge" value={shipment.portOfDischarge} />
                </div>
                <div className="space-y-2">
                  <InfoRow label="Notify Party" value={shipment.notifyParty} />
                  <InfoRow label="Marks & Numbers" value={shipment.marksAndNumbers} />
                  <InfoRow label="Measurement" value={shipment.measurement} />
                </div>
              </div>
            </CardContent>
          </Card>
        )}

        {/* Operational Stages Section */}
        <Card className="print:hidden">
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <FileText className="h-4 w-4 text-primary" />
              Tahapan Operasional
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              {STAGE_DEFS.map(({ type, label }) => {
                const f = stageForms[type];
                const existingStage = (typedShipment?.stages ?? []).find((s: ShipmentStage) => s.stageType === type);
                const statusColor: Record<string, string> = {
                  pending: "bg-muted text-muted-foreground",
                  in_progress: "bg-blue-500/10 text-blue-500 border-blue-500/20",
                  done: "bg-emerald-500/10 text-emerald-500 border-emerald-500/20",
                  cancelled: "bg-destructive/10 text-destructive border-destructive/20",
                };
                return (
                  <div key={type} className="border rounded-lg p-4 space-y-3">
                    <div className="flex items-center justify-between">
                      <p className="font-semibold text-sm">{label}</p>
                      <Badge variant="outline" className={`text-xs ${statusColor[f.status] ?? ""}`}>
                        {{ pending: "Menunggu", in_progress: "Proses", done: "Selesai", cancelled: "Batal" }[f.status] ?? f.status}
                      </Badge>
                    </div>
                    <div className="grid grid-cols-2 gap-2">
                      <div className="space-y-1 col-span-2">
                        <Label className="text-xs">Vendor</Label>
                        <Input
                          className="h-7 text-xs"
                          value={f.vendorName}
                          onChange={(e) => setStageForms((prev) => ({ ...prev, [type]: { ...prev[type], vendorName: e.target.value } }))}
                          placeholder="Nama vendor..."
                        />
                      </div>
                      <div className="space-y-1">
                        <Label className="text-xs">Tanggal</Label>
                        <Input
                          className="h-7 text-xs"
                          type="date"
                          value={f.date}
                          onChange={(e) => setStageForms((prev) => ({ ...prev, [type]: { ...prev[type], date: e.target.value } }))}
                        />
                      </div>
                      <div className="space-y-1">
                        <Label className="text-xs">Status</Label>
                        <Select value={f.status} onValueChange={(v) => setStageForms((prev) => ({ ...prev, [type]: { ...prev[type], status: v } }))}>
                          <SelectTrigger className="h-7 text-xs"><SelectValue /></SelectTrigger>
                          <SelectContent>
                            <SelectItem value="pending">Menunggu</SelectItem>
                            <SelectItem value="in_progress">Proses</SelectItem>
                            <SelectItem value="done">Selesai</SelectItem>
                            <SelectItem value="cancelled">Batal</SelectItem>
                          </SelectContent>
                        </Select>
                      </div>
                      <div className="space-y-1 col-span-2">
                        <Label className="text-xs">Catatan</Label>
                        <Input
                          className="h-7 text-xs"
                          value={f.notes}
                          onChange={(e) => setStageForms((prev) => ({ ...prev, [type]: { ...prev[type], notes: e.target.value } }))}
                          placeholder="Catatan..."
                        />
                      </div>
                    </div>
                    <Button
                      size="sm"
                      variant={existingStage ? "outline" : "default"}
                      className="w-full h-7 text-xs"
                      onClick={() => handleSaveStage(type)}
                      disabled={upsertStage.isPending}
                    >
                      {upsertStage.isPending ? <Loader2 className="h-3 w-3 animate-spin mr-1" /> : null}
                      {existingStage ? "Perbarui" : "Simpan"}
                    </Button>
                  </div>
                );
              })}
            </div>
          </CardContent>
        </Card>

        {/* Sales Order & Invoice Section */}
        <Card className="print:hidden">
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Receipt className="h-4 w-4 text-primary" />
              Sales Order &amp; Invoice
            </CardTitle>
          </CardHeader>
          <CardContent>
            {salesDocId && linkedSalesDoc ? (
              <div className="space-y-3">
                <div className="flex flex-wrap items-center gap-4 p-3 border rounded-lg bg-muted/10">
                  <div className="flex-1 min-w-0 space-y-1">
                    <p className="text-xs text-muted-foreground uppercase tracking-wide">No. Sales Order</p>
                    <p className="font-mono font-semibold text-sm">{linkedSalesDoc.docNumber}</p>
                  </div>
                  <div className="flex-1 min-w-0 space-y-1">
                    <p className="text-xs text-muted-foreground uppercase tracking-wide">Pelanggan</p>
                    <p className="text-sm font-medium truncate">{linkedSalesDoc.customerName}</p>
                  </div>
                  <div className="flex-1 min-w-0 space-y-1">
                    <p className="text-xs text-muted-foreground uppercase tracking-wide">Grand Total</p>
                    <p className="text-sm font-semibold">{idr(Number(linkedSalesDoc.grandTotal))}</p>
                  </div>
                  <div className="space-y-1">
                    <p className="text-xs text-muted-foreground uppercase tracking-wide">Status Invoice</p>
                    <Badge
                      variant="outline"
                      className={
                        linkedSalesDoc.invoiceStatus === "invoiced"
                          ? "bg-emerald-500/10 text-emerald-500 border-emerald-500/20"
                          : linkedSalesDoc.invoiceStatus === "to_invoice"
                          ? "bg-amber-500/10 text-amber-500 border-amber-500/20"
                          : "bg-muted text-muted-foreground"
                      }
                    >
                      {linkedSalesDoc.invoiceStatus === "invoiced"
                        ? "Sudah Diinvoice"
                        : linkedSalesDoc.invoiceStatus === "to_invoice"
                        ? "Perlu Diinvoice"
                        : "Belum Ada Invoice"}
                    </Badge>
                  </div>
                  <Link href={`/sales/orders/${salesDocId}`}>
                    <Button variant="outline" size="sm">
                      <ExternalLink className="h-3.5 w-3.5 mr-1.5" />
                      Lihat Sales Order
                    </Button>
                  </Link>
                </div>
                {linkedSalesDoc.invoiceStatus === "to_invoice" && (
                  <div className="flex items-center gap-2 p-2 rounded-lg bg-amber-500/10 border border-amber-500/20">
                    <Receipt className="h-4 w-4 text-amber-500 shrink-0" />
                    <p className="text-xs text-amber-600">Sales Order ini sudah dikonfirmasi dan siap diinvoice. Buka Sales Order untuk menyelesaikan invoicing.</p>
                    <Link href={`/sales/orders/${salesDocId}`} className="ml-auto">
                      <Button size="sm" variant="outline" className="h-7 text-xs border-amber-500/40 text-amber-600 hover:bg-amber-500/10">
                        Invoice Sekarang
                      </Button>
                    </Link>
                  </div>
                )}
              </div>
            ) : salesDocId ? (
              <div className="flex items-center gap-3 text-muted-foreground text-sm py-2">
                <Loader2 className="h-4 w-4 animate-spin" />
                Memuat data Sales Order...
              </div>
            ) : (
              <div className="space-y-3">
                <p className="text-sm text-muted-foreground">Shipment ini belum terhubung ke Sales Order. Buat Sales Order untuk membuat invoice kepada pelanggan.</p>
                <Link href="/sales/new">
                  <Button variant="outline" size="sm">
                    <Plus className="h-3.5 w-3.5 mr-1.5" />
                    Buat Sales Order Baru
                  </Button>
                </Link>
              </div>
            )}
          </CardContent>
        </Card>

        {/* Linked from RFQ Card */}
        {(typedShipment as any)?.linkedLogisticRfq && (() => {
          const lrfq = (typedShipment as any).linkedLogisticRfq as {
            id: number; rfqNumber: string; rfqStatus: string;
            orderId: number; orderNumber: string | null;
          };
          const RFQ_STATUS_LABELS: Record<string, string> = {
            admin_review: "Review Admin",
            rfq_sent: "RFQ Terkirim",
            vendor_selected: "Vendor Dipilih",
            customer_quoted: "Penawaran Dikirim",
            customer_approved: "Disetujui Customer",
            customer_rejected: "Ditolak Customer",
            customer_revision_requested: "Revisi Diminta",
            closed: "Ditutup",
          };
          const RFQ_STATUS_COLORS: Record<string, string> = {
            admin_review: "bg-muted text-muted-foreground",
            rfq_sent: "bg-blue-500/10 text-blue-600 border-blue-500/20",
            vendor_selected: "bg-violet-500/10 text-violet-600 border-violet-500/20",
            customer_quoted: "bg-amber-500/10 text-amber-600 border-amber-500/20",
            customer_approved: "bg-emerald-500/10 text-emerald-600 border-emerald-500/20",
            customer_rejected: "bg-destructive/10 text-destructive border-destructive/20",
            customer_revision_requested: "bg-orange-500/10 text-orange-600 border-orange-500/20",
            closed: "bg-muted text-muted-foreground",
          };
          return (
            <Card className="print:hidden border-teal-200 dark:border-teal-900">
              <CardHeader className="pb-3">
                <CardTitle className="flex items-center gap-2 text-teal-700 dark:text-teal-400">
                  <ArrowLeft className="h-4 w-4" />
                  Dibuat dari RFQ Logistik
                </CardTitle>
                <p className="text-xs text-muted-foreground">
                  Freight Shipment ini dibuat otomatis dari proses negosiasi RFQ berikut.
                </p>
              </CardHeader>
              <CardContent>
                <div className="flex flex-wrap items-center gap-4 p-3 rounded-lg border border-teal-100 dark:border-teal-900 bg-teal-50/50 dark:bg-teal-950/20">
                  <div className="flex-1 min-w-0 space-y-1">
                    <p className="text-xs text-muted-foreground uppercase tracking-wide">No. RFQ</p>
                    <p className="font-mono font-semibold text-sm">{lrfq.rfqNumber}</p>
                  </div>
                  {lrfq.orderNumber && (
                    <div className="flex-1 min-w-0 space-y-1">
                      <p className="text-xs text-muted-foreground uppercase tracking-wide">Order Logistik</p>
                      <p className="font-mono text-sm">{lrfq.orderNumber}</p>
                    </div>
                  )}
                  <div className="space-y-1">
                    <p className="text-xs text-muted-foreground uppercase tracking-wide">Status RFQ</p>
                    <Badge variant="outline" className={RFQ_STATUS_COLORS[lrfq.rfqStatus] ?? "bg-muted text-muted-foreground"}>
                      {RFQ_STATUS_LABELS[lrfq.rfqStatus] ?? lrfq.rfqStatus}
                    </Badge>
                  </div>
                  <Link href={`/logistics/rfq/${lrfq.id}/comparison`}>
                    <Button variant="outline" size="sm" className="border-teal-300 text-teal-700 hover:bg-teal-50 dark:border-teal-700 dark:text-teal-400">
                      <ExternalLink className="h-3.5 w-3.5 mr-1.5" />
                      Buka Perbandingan RFQ
                    </Button>
                  </Link>
                </div>
              </CardContent>
            </Card>
          );
        })()}

        {/* Profitability Report Card */}
        <Card className="print:hidden">
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              {profitability && profitability.profit >= 0
                ? <TrendingUp className="h-4 w-4 text-emerald-500" />
                : <TrendingDown className="h-4 w-4 text-destructive" />}
              Laporan Profitabilitas
            </CardTitle>
            <p className="text-xs text-muted-foreground">
              {profitability?.invoiceStatus === "invoiced"
                ? "Revenue dihitung dari Sales Order yang sudah diinvoice."
                : "Revenue belum tersedia — Sales Order belum diinvoice."}
            </p>
          </CardHeader>
          <CardContent>
            {profitability ? (
              <div className="grid grid-cols-2 md:grid-cols-4 gap-4 text-center">
                <div className="space-y-1 p-3 rounded-lg bg-muted/20 border">
                  <p className="text-xs text-muted-foreground uppercase tracking-wide">Revenue</p>
                  <p className="text-base font-semibold">{idr(profitability.revenue)}</p>
                  <p className="text-xs text-muted-foreground">dari Sales Order</p>
                </div>
                <div className="space-y-1 p-3 rounded-lg bg-muted/20 border">
                  <p className="text-xs text-muted-foreground uppercase tracking-wide">Total Biaya</p>
                  <p className="text-base font-semibold">{idr(profitability.totalCost)}</p>
                  <p className="text-xs text-muted-foreground">dari semua expenses</p>
                </div>
                <div className={`space-y-1 p-3 rounded-lg border ${profitability.profit >= 0 ? "bg-emerald-500/5 border-emerald-500/20" : "bg-destructive/5 border-destructive/20"}`}>
                  <p className="text-xs text-muted-foreground uppercase tracking-wide">Profit</p>
                  <p className={`text-base font-semibold ${profitability.profit >= 0 ? "text-emerald-600" : "text-destructive"}`}>
                    {profitability.profit >= 0 ? "" : "-"}{idr(Math.abs(profitability.profit))}
                  </p>
                  <p className="text-xs text-muted-foreground">revenue − biaya</p>
                </div>
                <div className={`space-y-1 p-3 rounded-lg border ${(profitability.margin ?? null) != null && profitability.margin! >= 0 ? "bg-emerald-500/5 border-emerald-500/20" : "bg-destructive/5 border-destructive/20"}`}>
                  <p className="text-xs text-muted-foreground uppercase tracking-wide">Margin</p>
                  <p className={`text-base font-semibold ${(profitability.margin ?? null) != null && profitability.margin! >= 0 ? "text-emerald-600" : "text-destructive"}`}>
                    {profitability.margin != null ? `${profitability.margin.toFixed(1)}%` : "—"}
                  </p>
                  <p className="text-xs text-muted-foreground">profit / revenue</p>
                </div>
              </div>
            ) : (
              <div className="flex items-center gap-2 text-sm text-muted-foreground py-4 justify-center">
                <Loader2 className="h-4 w-4 animate-spin" />
                Menghitung profitabilitas...
              </div>
            )}
          </CardContent>
        </Card>

        {/* RFQ Section — screen only */}
        <div className="print:hidden space-y-4">
          <div className="flex items-center justify-between">
            <h2 className="text-lg font-semibold flex items-center gap-2">
              <FileText className="h-5 w-5" />
              Request for Quotation
            </h2>
            {["draft", "rfq_sent"].includes(shipment.status) && (
              <Button onClick={() => setShowRfqDialog(true)}>
                <Plus className="h-4 w-4 mr-2" />
                Buat RFQ
              </Button>
            )}
          </div>

          {rfqs.length === 0 ? (
            <Card>
              <CardContent className="py-10 text-center text-muted-foreground">
                Belum ada RFQ. Buat RFQ untuk mulai mengumpulkan penawaran vendor.
              </CardContent>
            </Card>
          ) : (
            rfqs.map((rfq: FreightRfqWithQuotes) => (
              <Card key={rfq.id}>
                <CardHeader>
                  <div className="flex items-center justify-between">
                    <div>
                      <CardTitle className="text-base font-mono">{rfq.rfqNumber}</CardTitle>
                      <p className="text-sm text-muted-foreground mt-1">
                        Vendor: {rfq.vendorNames?.join(", ") || "—"} · {new Date(rfq.createdAt).toLocaleDateString("id-ID")}
                      </p>
                    </div>
                    <div className="flex items-center gap-2">
                      <Badge variant="outline">{rfq.status === "open" ? "Terbuka" : "Tertutup"}</Badge>
                      {rfq.status === "open" && (
                        <Button size="sm" onClick={() => openQuoteDialog(rfq.id)}>
                          <Plus className="h-3 w-3 mr-1" />
                          Tambah Quote
                        </Button>
                      )}
                    </div>
                  </div>
                </CardHeader>
                {rfq.quotes?.length > 0 && (
                  <CardContent>
                    <div className="space-y-3">
                      {rfq.quotes.map((q: FreightQuote) => (
                        <div
                          key={q.id}
                          className={`border rounded-lg p-4 space-y-2 ${q.status === "approved" ? "border-emerald-500/30 bg-emerald-500/5" : q.status === "rejected" ? "opacity-60" : ""}`}
                        >
                          <div className="flex items-center justify-between">
                            <div className="flex items-center gap-2">
                              <p className="font-semibold">{q.vendorName}</p>
                              <Badge variant="outline" className={QUOTE_STATUS_COLORS[q.status] ?? ""}>
                                {q.status === "pending" ? "Menunggu" : q.status === "approved" ? "Disetujui" : "Ditolak"}
                              </Badge>
                            </div>
                            {q.status === "pending" && ["rfq_sent", "draft"].includes(shipment.status) && (
                              <Button size="sm" onClick={() => handleApprove(q.id)} disabled={approveQuote.isPending}>
                                <CheckCircle className="h-4 w-4 mr-1" />
                                Setujui
                              </Button>
                            )}
                          </div>
                          <div className="grid grid-cols-2 md:grid-cols-5 gap-2 text-sm">
                            <div>
                              <p className="text-muted-foreground text-xs">Trucking</p>
                              <p className="font-medium">{fmt(q.truckingCost)}</p>
                            </div>
                            <div>
                              <p className="text-muted-foreground text-xs">Handling</p>
                              <p className="font-medium">{fmt(q.handlingCost)}</p>
                            </div>
                            <div>
                              <p className="text-muted-foreground text-xs">Freight</p>
                              <p className="font-medium">{fmt(q.freightCost)}</p>
                            </div>
                            <div>
                              <p className="text-muted-foreground text-xs">Lainnya</p>
                              <p className="font-medium">{fmt(q.otherCost)}</p>
                            </div>
                            <div>
                              <p className="text-muted-foreground text-xs">Total</p>
                              <p className="font-semibold text-primary">{fmt(q.totalCost)}</p>
                            </div>
                          </div>
                          {q.estimatedDays != null && (
                            <p className="text-xs text-muted-foreground">Estimasi: {q.estimatedDays} hari</p>
                          )}
                          {q.notes && <p className="text-xs text-muted-foreground">{q.notes}</p>}
                        </div>
                      ))}
                    </div>
                  </CardContent>
                )}
              </Card>
            ))
          )}
        </div>

        {/* Biaya / Expenses Section */}
        <Card className="print:hidden">
          <CardHeader>
            <div className="flex items-center justify-between">
              <CardTitle className="flex items-center gap-2 text-base">
                <Receipt className="h-4 w-4" />
                Biaya Operasional
              </CardTitle>
              <Link href={`/expense/new?shipmentId=${id}`}>
                <Button size="sm" variant="outline" className="gap-1">
                  <Plus className="h-3.5 w-3.5" /> Tambah Biaya
                </Button>
              </Link>
            </div>
          </CardHeader>
          <CardContent>
            {expensesLoading ? (
              <div className="space-y-2">
                <Skeleton className="h-8 w-full" />
                <Skeleton className="h-8 w-full" />
              </div>
            ) : expenses.length === 0 ? (
              <p className="text-sm text-muted-foreground text-center py-4">
                Belum ada biaya terkait pengiriman ini.
              </p>
            ) : (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>No. Biaya</TableHead>
                    <TableHead>Tanggal</TableHead>
                    <TableHead>Vendor / Pegawai</TableHead>
                    <TableHead>Deskripsi</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead className="text-right">Total</TableHead>
                    <TableHead className="w-8"></TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {expenses.map((exp) => (
                    <TableRow key={exp.id}>
                      <TableCell className="font-mono text-xs">{exp.expenseNumber}</TableCell>
                      <TableCell className="text-xs">{exp.date}</TableCell>
                      <TableCell className="text-xs">{exp.vendorEmployee ?? "—"}</TableCell>
                      <TableCell className="text-xs max-w-[180px] truncate">{exp.description ?? "—"}</TableCell>
                      <TableCell>
                        <Badge variant="outline" className="text-xs">{exp.status}</Badge>
                      </TableCell>
                      <TableCell className="text-right text-xs font-medium">{idr(exp.total)}</TableCell>
                      <TableCell>
                        <Link href={`/expense/${exp.id}`}>
                          <Button size="icon" variant="ghost" className="h-6 w-6">
                            <ExternalLink className="h-3 w-3" />
                          </Button>
                        </Link>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            )}
            {expenses.length > 0 && (() => {
              const filteredExpenses = expenseFilter === "approved"
                ? expenses.filter((e) => e.status === "approved")
                : expenses;
              const totalExpenses = filteredExpenses.reduce((s, e) => s + e.total, 0);
              const expVsQuoted = quotedCost !== null ? totalExpenses - quotedCost : null;
              const expVsActual = actualCost !== null ? totalExpenses - actualCost : null;
              const hasComparison = quotedCost !== null || actualCost !== null;
              return (
                <div className="mt-3 pt-3 border-t border-slate-700/50 space-y-1.5">
                  <div className="flex items-center gap-1.5">
                    <span className="text-xs text-muted-foreground">Filter:</span>
                    <button type="button" onClick={() => setExpenseFilter("all")} className={`text-xs px-2 py-0.5 rounded-full border transition-colors ${expenseFilter === "all" ? "border-primary bg-primary/10 text-primary font-medium" : "border-transparent text-muted-foreground hover:text-foreground"}`}>Semua</button>
                    <button type="button" onClick={() => setExpenseFilter("approved")} className={`text-xs px-2 py-0.5 rounded-full border transition-colors ${expenseFilter === "approved" ? "border-emerald-500 bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 font-medium" : "border-transparent text-muted-foreground hover:text-foreground"}`}>Disetujui</button>
                  </div>
                  {filteredExpenses.length === 0 ? (
                    <p className="text-xs text-muted-foreground">Belum ada biaya disetujui.</p>
                  ) : (
                    <>
                      <div className="flex justify-between text-sm font-semibold">
                        <span className="text-muted-foreground">Total Biaya Operasional</span>
                        <span>{idr(totalExpenses)}</span>
                      </div>
                      {hasComparison && (
                        <div className="rounded-md bg-muted/40 border px-3 py-2 mt-2 space-y-1.5">
                          <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-1.5">Perbandingan Biaya</p>
                          {quotedCost !== null && (
                            <div className="flex justify-between items-center text-sm">
                              <span className="text-muted-foreground">Estimasi (Quote Disetujui)</span>
                              <span className="font-medium">{idr(quotedCost)}</span>
                            </div>
                          )}
                          {actualCost !== null && (
                            <div className="flex justify-between items-center text-sm">
                              <span className="text-muted-foreground">Biaya Aktual Shipment</span>
                              <span className="font-medium">{idr(actualCost)}</span>
                            </div>
                          )}
                          {expVsActual !== null && (
                            <div className="flex justify-between items-center text-sm pt-1 border-t border-border/50">
                              <span className="text-muted-foreground flex items-center gap-1">
                                {expVsActual > 0
                                  ? <TrendingUp className="h-3.5 w-3.5 text-destructive" />
                                  : <TrendingDown className="h-3.5 w-3.5 text-emerald-500" />}
                                Selisih vs. Aktual
                              </span>
                              <span className={`font-semibold ${expVsActual > 0 ? "text-destructive" : "text-emerald-500"}`}>
                                {expVsActual > 0 ? "+" : ""}{idr(expVsActual)}
                              </span>
                            </div>
                          )}
                          {expVsQuoted !== null && expVsActual === null && (
                            <div className="flex justify-between items-center text-sm pt-1 border-t border-border/50">
                              <span className="text-muted-foreground flex items-center gap-1">
                                {expVsQuoted > 0
                                  ? <TrendingUp className="h-3.5 w-3.5 text-destructive" />
                                  : <TrendingDown className="h-3.5 w-3.5 text-emerald-500" />}
                                Selisih vs. Estimasi
                              </span>
                              <span className={`font-semibold ${expVsQuoted > 0 ? "text-destructive" : "text-emerald-500"}`}>
                                {expVsQuoted > 0 ? "+" : ""}{idr(expVsQuoted)}
                              </span>
                            </div>
                          )}
                        </div>
                      )}
                    </>
                  )}
                </div>
              );
            })()}
          </CardContent>
        </Card>

        {/* Driver Assignment Section */}
        <Card className="print:hidden">
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base">
              <Truck className="h-4 w-4 text-primary" />
              Driver Trucking
            </CardTitle>
          </CardHeader>
          <CardContent>
            <DriverAssignmentPanel
              shipmentId={id}
              shipperName={typedShipment?.shipperName}
              commodity={typedShipment?.commodity}
              origin={typedShipment?.origin}
              destination={typedShipment?.destination}
            />
          </CardContent>
        </Card>

        {/* Attachments Section */}
        <Card className="print:hidden">
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base">
              <Paperclip className="h-4 w-4" />
              Foto, Dokumen &amp; Scan
            </CardTitle>
          </CardHeader>
          <CardContent>
            <FreightAttachmentsPanel
              shipmentId={id}
              onBarcodeScanned={(value) => {
                toast({
                  title: t.common.success,
                  description: value,
                });
              }}
            />
          </CardContent>
        </Card>

        {/* Customs Documents Section */}
        <Card className="print:hidden">
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base">
              <FileText className="h-4 w-4" />
              Dokumen Kepabeanan
            </CardTitle>
          </CardHeader>
          <CardContent>
            <FreightCustomsPanel shipmentId={id} />
          </CardContent>
        </Card>

        {/* Audit Trail Section */}
        <Card className="print:hidden">
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base">
              <History className="h-4 w-4 text-primary" />
              Riwayat Perubahan Status
            </CardTitle>
          </CardHeader>
          <CardContent>
            {auditLogs.length === 0 ? (
              <div className="flex flex-col items-center gap-2 py-8 text-muted-foreground">
                <History className="h-8 w-8 opacity-25" />
                <p className="text-sm">Belum ada riwayat perubahan status.</p>
              </div>
            ) : (
              <ol className="relative border-l border-border ml-3 space-y-0">
                {auditLogs.map((log, idx) => (
                  <li key={log.id} className="ml-6 pb-6 last:pb-0">
                    <span className={`absolute -left-3 flex h-6 w-6 items-center justify-center rounded-full ring-4 ring-background ${idx === 0 ? "bg-primary text-primary-foreground" : "bg-muted text-muted-foreground"}`}>
                      <History className="h-3 w-3" />
                    </span>
                    <div className="flex flex-col gap-1 pt-0.5">
                      <div className="flex items-center gap-2 flex-wrap">
                        {log.fromStatus ? (
                          <>
                            <Badge variant="outline" className={`text-[11px] px-1.5 py-0 ${STATUS_COLORS[log.fromStatus] ?? "bg-muted text-muted-foreground"}`}>
                              {STATUS_LABELS[log.fromStatus] ?? log.fromStatus}
                            </Badge>
                            <ArrowRight className="h-3 w-3 text-muted-foreground shrink-0" />
                          </>
                        ) : (
                          <span className="text-xs text-muted-foreground italic mr-1">Dibuat</span>
                        )}
                        <Badge variant="outline" className={`text-[11px] px-1.5 py-0 ${STATUS_COLORS[log.toStatus] ?? "bg-muted text-muted-foreground"}`}>
                          {STATUS_LABELS[log.toStatus] ?? log.toStatus}
                        </Badge>
                      </div>
                      <div className="flex items-center gap-1.5 text-xs text-muted-foreground flex-wrap">
                        <User className="h-3 w-3 shrink-0" />
                        <span className="font-medium text-foreground">{log.changedBy}</span>
                        <span className="text-muted-foreground/50">·</span>
                        <span>
                          {new Date(log.createdAt).toLocaleString("id-ID", {
                            day: "numeric", month: "short", year: "numeric",
                            hour: "2-digit", minute: "2-digit",
                          })}
                        </span>
                      </div>
                      {log.notes && (
                        <p className="text-xs text-muted-foreground italic mt-0.5">{log.notes}</p>
                      )}
                    </div>
                  </li>
                ))}
              </ol>
            )}
          </CardContent>
        </Card>

        {id && (
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2 text-sm">
                <MessageSquare className="h-4 w-4" /> Korespondensi Email
              </CardTitle>
            </CardHeader>
            <CardContent>
              <CorrespondenceTab linkedType="shipment" linkedId={id} />
            </CardContent>
          </Card>
        )}
      </div>

      {/* RFQ Dialog */}
      <Dialog open={showRfqDialog} onOpenChange={setShowRfqDialog}>
        <DialogContent>
          <DialogHeader><DialogTitle>Buat RFQ Baru</DialogTitle></DialogHeader>
          <div className="space-y-4 py-2">
            <div className="space-y-2">
              <Label>Nama Vendor (pisah dengan koma)</Label>
              <Input
                value={rfqVendors}
                onChange={(e) => setRfqVendors(e.target.value)}
                placeholder="PT. Vendor A, PT. Vendor B"
              />
            </div>
            <div className="space-y-2">
              <Label>Catatan</Label>
              <Textarea value={rfqNotes} onChange={(e) => setRfqNotes(e.target.value)} rows={3} />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowRfqDialog(false)}>Batal</Button>
            <Button onClick={handleCreateRfq} disabled={createRfq.isPending}>
              {createRfq.isPending && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
              Buat RFQ
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* In Transit Dialog */}
      <Dialog open={showInTransitDialog} onOpenChange={setShowInTransitDialog}>
        <DialogContent className="max-w-md">
          <DialogHeader><DialogTitle>Tandai Dalam Perjalanan</DialogTitle></DialogHeader>
          <div className="space-y-4 py-2">
            <div className="space-y-2">
              <Label>Tanggal Keberangkatan <span className="text-destructive">*</span></Label>
              <Input
                type="date"
                value={inTransitForm.departureDate}
                onChange={(e) => setInTransitForm((f) => ({ ...f, departureDate: e.target.value }))}
              />
            </div>
            <div className="space-y-2">
              <Label>No. Tracking</Label>
              <Input
                value={inTransitForm.trackingNumber}
                onChange={(e) => setInTransitForm((f) => ({ ...f, trackingNumber: e.target.value }))}
                placeholder="Nomor tracking pengiriman"
              />
            </div>
            <div className="space-y-2">
              <Label>No. AWB / BL</Label>
              <Input
                value={inTransitForm.awbNumber}
                onChange={(e) => setInTransitForm((f) => ({ ...f, awbNumber: e.target.value }))}
                placeholder="Air Waybill atau Bill of Lading"
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowInTransitDialog(false)}>Batal</Button>
            <Button onClick={handleMarkInTransit} disabled={updateShipment.isPending}>
              {updateShipment.isPending && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
              Konfirmasi
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Completed Dialog */}
      <Dialog open={showCompletedDialog} onOpenChange={setShowCompletedDialog}>
        <DialogContent className="max-w-md">
          <DialogHeader><DialogTitle>Tandai Selesai</DialogTitle></DialogHeader>
          <div className="space-y-4 py-2">
            <div className="space-y-2">
              <Label>Tanggal Tiba <span className="text-destructive">*</span></Label>
              <Input
                type="date"
                value={completedForm.arrivalDate}
                onChange={(e) => setCompletedForm((f) => ({ ...f, arrivalDate: e.target.value }))}
              />
            </div>
            <div className="space-y-2">
              <Label>Biaya Aktual (IDR)</Label>
              <Input
                type="number"
                value={completedForm.actualCost}
                onChange={(e) => setCompletedForm((f) => ({ ...f, actualCost: e.target.value }))}
                placeholder="0"
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowCompletedDialog(false)}>Batal</Button>
            <Button onClick={handleMarkCompleted} disabled={updateShipment.isPending}>
              {updateShipment.isPending && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
              Konfirmasi
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Edit Aktual Dialog */}
      <Dialog open={showEditAktualDialog} onOpenChange={setShowEditAktualDialog}>
        <DialogContent className="max-w-md" data-testid="dialog-edit-aktual">
          <DialogHeader><DialogTitle>Edit Info Aktual</DialogTitle></DialogHeader>
          <div className="space-y-4 py-2">
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-2">
                <Label htmlFor="aktual-departure">Tgl Berangkat</Label>
                <Input
                  id="aktual-departure"
                  type="date"
                  value={editAktualForm.departureDate}
                  onChange={(e) => setEditAktualForm((f) => ({ ...f, departureDate: e.target.value }))}
                  data-testid="input-aktual-departure"
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="aktual-arrival">Tgl Tiba</Label>
                <Input
                  id="aktual-arrival"
                  type="date"
                  value={editAktualForm.arrivalDate}
                  onChange={(e) => setEditAktualForm((f) => ({ ...f, arrivalDate: e.target.value }))}
                  data-testid="input-aktual-arrival"
                />
              </div>
            </div>
            <div className="space-y-2">
              <Label htmlFor="aktual-tracking">No. Tracking</Label>
              <Input
                id="aktual-tracking"
                value={editAktualForm.trackingNumber}
                onChange={(e) => setEditAktualForm((f) => ({ ...f, trackingNumber: e.target.value }))}
                placeholder="Nomor tracking pengiriman"
                data-testid="input-aktual-tracking"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="aktual-awb">No. AWB / BL</Label>
              <Input
                id="aktual-awb"
                value={editAktualForm.awbNumber}
                onChange={(e) => setEditAktualForm((f) => ({ ...f, awbNumber: e.target.value }))}
                placeholder="Air Waybill atau Bill of Lading"
                data-testid="input-aktual-awb"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="aktual-cost">Biaya Aktual (IDR)</Label>
              <Input
                id="aktual-cost"
                type="number"
                value={editAktualForm.actualCost}
                onChange={(e) => setEditAktualForm((f) => ({ ...f, actualCost: e.target.value }))}
                placeholder="0"
                data-testid="input-aktual-cost"
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowEditAktualDialog(false)}>Batal</Button>
            <Button onClick={handleSaveAktual} disabled={updateShipment.isPending} data-testid="button-save-aktual">
              {updateShipment.isPending && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
              Simpan
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Quote Dialog */}
      <Dialog open={showQuoteDialog} onOpenChange={setShowQuoteDialog}>
        <DialogContent className="max-w-lg">
          <DialogHeader><DialogTitle>Tambah Penawaran Vendor</DialogTitle></DialogHeader>
          <div className="space-y-4 py-2">
            <div className="space-y-2">
              <Label>Nama Vendor <span className="text-destructive">*</span></Label>
              <Input
                value={quoteForm.vendorName}
                onChange={(e) => setQuoteForm((f) => ({ ...f, vendorName: e.target.value }))}
                placeholder="PT. Contoh Freight"
              />
            </div>
            <div className="grid grid-cols-2 gap-3">
              {(["truckingCost", "handlingCost", "freightCost", "otherCost"] as const).map((k) => (
                <div key={k} className="space-y-2">
                  <Label>
                    {{ truckingCost: "Trucking", handlingCost: "Handling", freightCost: "Freight", otherCost: "Lainnya" }[k]}
                  </Label>
                  <Input
                    type="number"
                    value={quoteForm[k]}
                    onChange={(e) => setQuoteForm((f) => ({ ...f, [k]: e.target.value }))}
                    placeholder="0"
                  />
                </div>
              ))}
            </div>
            <div className="space-y-2">
              <Label>Estimasi Hari</Label>
              <Input
                type="number"
                value={quoteForm.estimatedDays}
                onChange={(e) => setQuoteForm((f) => ({ ...f, estimatedDays: e.target.value }))}
                placeholder="7"
              />
            </div>
            <div className="space-y-2">
              <Label>Catatan</Label>
              <Textarea
                value={quoteForm.notes}
                onChange={(e) => setQuoteForm((f) => ({ ...f, notes: e.target.value }))}
                rows={2}
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowQuoteDialog(false)}>Batal</Button>
            <Button onClick={handleCreateQuote} disabled={createQuote.isPending}>
              {createQuote.isPending && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
              Simpan Quote
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </AppShell>
  );
}
