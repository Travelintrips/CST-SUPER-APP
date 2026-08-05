import { useState, useEffect, useRef, Fragment } from "react";
import { useLocation, useSearch } from "wouter";
import {
  useListLogisticOrders,
  useUpdateLogisticOrderStatus,
  useUpdateLogisticOrderType,
  useCreateSalesDocument,
  getListLogisticOrdersQueryKey,
  getGetLogisticOrderQueryOptions,
  useGetLogisticOrder,
} from "@workspace/api-client-react";
import type { LogisticOrder } from "@workspace/api-client-react";
import { useQueryClient, useQuery } from "@tanstack/react-query";
import { usePrefetchOnHover } from "@/hooks/use-prefetch-on-hover";
import { AppShell } from "@/components/layout/AppShell";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { useToast } from "@/hooks/use-toast";
import { useLanguage } from "@/contexts/LanguageContext";
import { PackageOpen, Search, RefreshCw, FilePlus, X, Eye, Zap, Send, ExternalLink, Ship, ClipboardCheck, Trash2 } from "lucide-react";
import { OrderProgressBar, PROGRESS_STEPS, deriveCompletedSteps } from "@/components/logistics/OrderProgressBar";
import { Button } from "@/components/ui/button";
import { Link } from "wouter";
import { useOrderNotificationsContext } from "@/contexts/OrderNotificationsContext";
import { useCompany } from "@/contexts/CompanyContext";

interface VendorRow {
  id: number;
  name: string;
  phone: string | null;
  email: string | null;
  serviceType: string | null;
  isActive: boolean;
}

function Highlight({ text, query }: { text: string; query: string }) {
  if (!query.trim()) return <>{text}</>;
  const idx = text.toLowerCase().indexOf(query.toLowerCase());
  if (idx === -1) return <>{text}</>;
  return (
    <>
      {text.slice(0, idx)}
      <mark className="bg-yellow-200 text-yellow-900 rounded-sm px-0.5 not-italic">
        {text.slice(idx, idx + query.length)}
      </mark>
      {text.slice(idx + query.length)}
    </>
  );
}

const STATUS_OPTIONS = ["New Order", "Confirmed", "In Progress", "Completed", "Cancelled"];

const SHIPMENT_TYPE_OPTIONS = [
  "Sea Freight",
  "Sea Freight FCL",
  "Sea Freight LCL",
  "Air Freight",
  "Trucking",
  "Pickup Trucking",
  "Delivery Trucking",
  "Container Trucking",
  "Cargo Trucking",
  "Customs Clearance",
  "FOB",
];

const STATUS_COLORS: Record<string, string> = {
  "New Order":   "bg-yellow-100 text-yellow-800 border-yellow-200",
  "Confirmed":   "bg-blue-100 text-blue-800 border-blue-200",
  "In Progress": "bg-orange-100 text-orange-800 border-orange-200",
  "Completed":   "bg-green-100 text-green-800 border-green-200",
  "Cancelled":   "bg-red-100 text-red-800 border-red-200",
};

const STATUS_DOT_COLOR: Record<string, string> = {
  "New Order":   "bg-yellow-400",
  "Confirmed":   "bg-blue-400",
  "In Progress": "bg-orange-400",
  "Completed":   "bg-green-400",
  "Cancelled":   "bg-red-400",
};

const STATUS_LABEL_ID: Record<string, string> = {
  "New Order":   "Pesanan Baru",
  "Confirmed":   "Dikonfirmasi",
  "In Progress": "Dalam Proses",
  "Completed":   "Selesai",
  "Cancelled":   "Dibatalkan",
};

const idr = (n: number) =>
  new Intl.NumberFormat("id-ID", { style: "currency", currency: "IDR", maximumFractionDigits: 0 }).format(n);

const RFQ_STATUS_LABELS: Record<string, string> = {
  open: "Terkirim",
  admin_review: "Review",
  vendor_blasted: "Blast Terkirim",
  rfq_sent: "Terkirim",
  vendor_selected: "Vendor Dipilih",
  customer_quoted: "Quoted",
  customer_approved: "Disetujui",
  customer_rejected: "Ditolak",
  customer_revision_requested: "Revisi",
  closed: "Ditutup",
};

const RFQ_STATUS_COLORS: Record<string, string> = {
  open:                        "bg-blue-100 text-blue-700 border-blue-200",
  admin_review:                "bg-slate-100 text-slate-600 border-slate-200",
  vendor_blasted:              "bg-blue-100 text-blue-700 border-blue-200",
  rfq_sent:                    "bg-blue-100 text-blue-700 border-blue-200",
  vendor_selected:             "bg-violet-100 text-violet-700 border-violet-200",
  customer_quoted:             "bg-amber-100 text-amber-700 border-amber-200",
  customer_approved:           "bg-emerald-100 text-emerald-800 border-emerald-200",
  customer_rejected:           "bg-red-100 text-red-700 border-red-200",
  customer_revision_requested: "bg-orange-100 text-orange-700 border-orange-200",
  closed:                      "bg-gray-100 text-gray-600 border-gray-200",
};

type LatestRfq = {
  rfqId: number; rfqNumber: string; rfqStatus: string;
  freightShipmentId: number | null; freightShipmentNumber: string | null;
} | null;

function RfqStatusCell({ latestRfq, onCreateRfq }: { latestRfq: LatestRfq; onCreateRfq: () => void }) {
  if (!latestRfq) {
    return (
      <Button
        size="sm"
        variant="outline"
        className="h-6 text-[10px] px-1.5 py-0 gap-1 text-muted-foreground border-dashed hover:border-solid hover:text-foreground"
        onClick={onCreateRfq}
      >
        <Send className="h-2.5 w-2.5 shrink-0" />
        Buat RFQ
      </Button>
    );
  }
  return (
    <div className="flex flex-col gap-1 min-w-0">
      <Link href={`/logistics/rfq/${latestRfq.rfqId}/comparison`}>
        <Badge
          className={`${RFQ_STATUS_COLORS[latestRfq.rfqStatus] ?? "bg-slate-100 text-slate-600"} border text-[10px] font-medium px-1.5 py-0.5 cursor-pointer hover:opacity-80 whitespace-nowrap`}
          title={latestRfq.rfqNumber}
        >
          {RFQ_STATUS_LABELS[latestRfq.rfqStatus] ?? latestRfq.rfqStatus}
        </Badge>
      </Link>
      {latestRfq.freightShipmentId && (
        <Link href={`/logistics/freight/${latestRfq.freightShipmentId}`}>
          <span className="inline-flex items-center gap-0.5 text-[10px] text-teal-600 hover:underline font-mono">
            <Ship className="h-2.5 w-2.5 shrink-0" />
            {latestRfq.freightShipmentNumber ?? `#${latestRfq.freightShipmentId}`}
          </span>
        </Link>
      )}
    </div>
  );
}

const BULAN_ID = ["Jan","Feb","Mar","Apr","Mei","Jun","Jul","Agt","Sep","Okt","Nov","Des"];
function formatTanggal(iso: string) {
  const d = new Date(iso);
  const day = String(d.getDate()).padStart(2, "0");
  const mon = BULAN_ID[d.getMonth()];
  const year = d.getFullYear();
  const hh = String(d.getHours()).padStart(2, "0");
  const mm = String(d.getMinutes()).padStart(2, "0");
  return `${day}-${mon}-${year}, ${hh}:${mm}`;
}

export default function LogisticsPortalOrdersPage() {
  const queryClient = useQueryClient();
  const prefetchHover = usePrefetchOnHover();
  const { toast } = useToast();
  const { t } = useLanguage();
  const [, navigate] = useLocation();
  const searchString = useSearch();

  const initialStatus = new URLSearchParams(searchString).get("status") ?? "all";

  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState(initialStatus);
  const [fulfillmentFilter, setFulfillmentFilter] = useState("all");
  const [koliFilter, setKoliFilter] = useState("all");
  const [shipmentTypeFilter, setShipmentTypeFilter] = useState("all");
  const [updatingId, setUpdatingId] = useState<number | null>(null);
  const [updatingTypeId, setUpdatingTypeId] = useState<number | null>(null);
  const [soDialog, setSoDialog] = useState<LogisticOrder | null>(null);
  const [viewPhoto, setViewPhoto] = useState<string | null>(null);
  const [detailDialog, setDetailDialog] = useState<LogisticOrder | null>(null);

  const [selectedIds, setSelectedIds] = useState<Set<number>>(new Set());
  const [bulkDeleteDialog, setBulkDeleteDialog] = useState(false);
  const [progressStepFilter, setProgressStepFilter] = useState<string | null>(null);
  const [isBulkDeleting, setIsBulkDeleting] = useState(false);
  const [bulkStatusValue, setBulkStatusValue] = useState("");
  const [isBulkUpdating, setIsBulkUpdating] = useState(false);

  const [newOrderCount, setNewOrderCount] = useState(0);
  const [lastAutoRefresh, setLastAutoRefresh] = useState<Date | null>(null);
  const bannerTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // RFQ dialog state
  const [rfqTargetOrder, setRfqTargetOrder] = useState<LogisticOrder | null>(null);
  const [rfqSelectedVendors, setRfqSelectedVendors] = useState<number[]>([]);
  const [rfqNotes, setRfqNotes] = useState("");
  const [rfqShipmentType, setRfqShipmentType] = useState("");
  const [sendingRfq, setSendingRfq] = useState(false);

  const { setOnNewOrder } = useOrderNotificationsContext();

  useEffect(() => {
    setOnNewOrder((n) => {
      if (n.type !== "logistic") return;
      queryClient.invalidateQueries({ queryKey: getListLogisticOrdersQueryKey() });
      setNewOrderCount((c) => c + 1);
      setLastAutoRefresh(new Date());
      if (bannerTimerRef.current) clearTimeout(bannerTimerRef.current);
      bannerTimerRef.current = setTimeout(() => setNewOrderCount(0), 10_000);
    });
    return () => {
      if (bannerTimerRef.current) clearTimeout(bannerTimerRef.current);
    };
  }, [setOnNewOrder, queryClient]);

  const { data: soDetail } = useGetLogisticOrder(
    soDialog?.id ?? 0,
    { query: { enabled: !!soDialog?.id, queryKey: [`/api/logistic/orders/${soDialog?.id ?? 0}`] } },
  );
  const { data: detailData } = useGetLogisticOrder(
    detailDialog?.id ?? 0,
    { query: { enabled: !!detailDialog?.id, queryKey: [`/api/logistic/orders/detail/${detailDialog?.id ?? 0}`] } },
  );

  const cargoPhotos: string[] = (() => {
    const truckingItem = soDetail?.items?.find((it) => it.calculatorType === "trucking");
    const urls = (truckingItem?.inputData as Record<string, unknown> | undefined)?.cargo_photo_urls;
    return Array.isArray(urls) ? (urls as string[]) : [];
  })();

  const detailCargoPhotos: string[] = (() => {
    const truckingItem = detailData?.items?.find((it) => it.calculatorType === "trucking");
    const urls = (truckingItem?.inputData as Record<string, unknown> | undefined)?.cargo_photo_urls;
    return Array.isArray(urls) ? (urls as string[]) : [];
  })();

  const { activeCompanyId } = useCompany();
  const { data: orders = [], isLoading, refetch } = useListLogisticOrders(
    { ...(statusFilter !== "all" ? { status: statusFilter } : {}), company: activeCompanyId } as any,
    { query: { queryKey: [...getListLogisticOrdersQueryKey(), statusFilter, activeCompanyId] } },
  );

  const updateStatus = useUpdateLogisticOrderStatus();
  const updateType = useUpdateLogisticOrderType();
  const createSalesDoc = useCreateSalesDocument();

  const { data: vendors = [] } = useQuery<VendorRow[]>({
    queryKey: ["logistic-vendors"],
    queryFn: async () => {
      const res = await fetch("/api/logistic/orders/vendors");
      if (!res.ok) throw new Error("Failed");
      return res.json() as Promise<VendorRow[]>;
    },
    staleTime: 5 * 60 * 1000,
  });
  const activeVendors = vendors.filter((v) => v.isActive !== false);

  function openRfqDialog(o: LogisticOrder) {
    setRfqTargetOrder(o);
    setRfqSelectedVendors([]);
    setRfqNotes("");
    setRfqShipmentType(o.shipmentType ?? "");
  }

  async function handleSendRfq() {
    if (!rfqTargetOrder || rfqSelectedVendors.length === 0) return;
    setSendingRfq(true);
    try {
      const res = await fetch(`/api/logistic/orders/${rfqTargetOrder.id}/rfq-blast`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({
          vendorIds: rfqSelectedVendors,
          notes: rfqNotes || undefined,
          deadlineHours: 48,
        }),
      });
      const data = await res.json() as { ok?: boolean; rfqId?: number; rfqNumber?: string; sentCount?: number; message?: string };
      if (!res.ok) throw new Error(data.message ?? "Gagal mengirim RFQ");
      toast({
        title: `RFQ berhasil dikirim ke ${data.sentCount ?? 0} vendor`,
        description: `No. RFQ: ${data.rfqNumber ?? ""}`,
      });
      setRfqTargetOrder(null);
      queryClient.invalidateQueries({ queryKey: getListLogisticOrdersQueryKey() });
    } catch (e: unknown) {
      toast({ title: (e as Error).message ?? "Gagal mengirim RFQ", variant: "destructive" });
    } finally {
      setSendingRfq(false);
    }
  }

  function handleStatusChange(id: number, status: string) {
    setUpdatingId(id);
    const order = orders.find((o) => o.id === id);
    updateStatus.mutate(
      { id, data: { status, clientUpdatedAt: order?.updatedAt } },
      {
        onSuccess: () => {
          toast({ title: t.common.success, description: status });
          queryClient.invalidateQueries({ queryKey: getListLogisticOrdersQueryKey() });
        },
        onError: (err: any) => {
          const msg = err?.response?.data?.message ?? err?.response?.data?.error ?? t.common.error;
          toast({ title: msg, variant: "destructive" });
        },
        onSettled: () => setUpdatingId(null),
      },
    );
  }

  function handleTypeChange(id: number, shipmentType: string) {
    setUpdatingTypeId(id);
    updateType.mutate(
      { id, data: { shipmentType } },
      {
        onSuccess: () => {
          toast({ title: "Tipe berhasil diperbarui", description: shipmentType });
          queryClient.invalidateQueries({ queryKey: getListLogisticOrdersQueryKey() });
          if (detailDialog?.id === id) {
            setDetailDialog((prev) => prev ? { ...prev, shipmentType } : prev);
          }
        },
        onError: () => toast({ title: t.common.error, variant: "destructive" }),
        onSettled: () => setUpdatingTypeId(null),
      },
    );
  }

  function handleCreateSalesOrder() {
    if (!soDialog) return;
    const o = soDialog;
    createSalesDoc.mutate(
      {
        data: {
          kind: "order",
          customerName: o.companyName || o.customerName,
          origin: o.origin,
          destination: o.destination,
          notes: [
            `Ref Portal Order: ${o.orderNumber}`,
            `Tipe: ${o.shipmentType}`,
            o.commodity ? `Komoditi: ${o.commodity}` : null,
            o.cargoDescription ? `Kargo: ${o.cargoDescription}` : null,
            o.notes ?? null,
          ].filter(Boolean).join(" | "),
          lines: [
            {
              name: `Jasa Logistik ${o.shipmentType} — ${o.origin} → ${o.destination}`,
              description: `Portal Order #${o.orderNumber} (${o.customerName})`,
              quantity: 1,
              unitPrice: o.grandTotal,
            },
          ],
          logisticOrderId: o.id,
        } as Parameters<typeof createSalesDoc.mutate>[0]["data"],
      },
      {
        onSuccess: (doc) => {
          toast({ title: t.common.success, description: doc.docNumber });
          setSoDialog(null);
          queryClient.invalidateQueries({ queryKey: getListLogisticOrdersQueryKey() });
          navigate("/sales/orders");
        },
        onError: (err: unknown) => {
          const msg = (err as { response?: { data?: { message?: string; existingDocNumber?: string } } })?.response?.data;
          if (msg?.existingDocNumber) {
            toast({ title: "SO sudah ada", description: `Sales Order ${msg.existingDocNumber} sudah pernah dibuat untuk order ini.`, variant: "destructive" });
            setSoDialog(null);
          } else {
            toast({ title: t.common.error, variant: "destructive" });
          }
        },
      },
    );
  }

  const fulfillmentOf = (o: typeof orders[number]) =>
    (o as unknown as { fulfillmentStatus: string | null }).fulfillmentStatus;

  const filtered = orders.filter((o) => {
    if (search) {
      const q = search.toLowerCase();
      const matchSearch =
        o.orderNumber.toLowerCase().includes(q) ||
        o.customerName.toLowerCase().includes(q) ||
        o.companyName.toLowerCase().includes(q) ||
        o.email.toLowerCase().includes(q);
      if (!matchSearch) return false;
    }
    if (fulfillmentFilter !== "all") {
      const fs = fulfillmentOf(o);
      if (fulfillmentFilter === "not_sent" && fs !== null) return false;
      if (fulfillmentFilter === "pending" && fs !== "pending") return false;
      if (fulfillmentFilter === "submitted" && fs !== "submitted") return false;
    }
    if (koliFilter !== "all") {
      const k = o.jumlahKoli ?? null;
      if (koliFilter === "has_koli" && k == null) return false;
      if (koliFilter === "lt5" && (k == null || k >= 5)) return false;
      if (koliFilter === "5to10" && (k == null || k < 5 || k > 10)) return false;
      if (koliFilter === "gt10" && (k == null || k <= 10)) return false;
    }
    if (shipmentTypeFilter !== "all") {
      const st = (o.shipmentType ?? "").toLowerCase();
      if (!st.includes(shipmentTypeFilter.toLowerCase())) return false;
    }
    if (progressStepFilter) {
      if (getActiveStepKey(o) !== progressStepFilter) return false;
    }
    return true;
  });

  const allFilteredIds = filtered.map((o) => o.id);
  const allSelected = allFilteredIds.length > 0 && allFilteredIds.every((id) => selectedIds.has(id));
  const someSelected = allFilteredIds.some((id) => selectedIds.has(id)) && !allSelected;

  function toggleAll() {
    if (allSelected) {
      setSelectedIds((prev) => {
        const next = new Set(prev);
        allFilteredIds.forEach((id) => next.delete(id));
        return next;
      });
    } else {
      setSelectedIds((prev) => new Set([...prev, ...allFilteredIds]));
    }
  }

  function toggleOne(id: number) {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  async function handleBulkStatusUpdate(status: string) {
    const ids = Array.from(selectedIds);
    if (ids.length === 0 || !status) return;
    setIsBulkUpdating(true);
    try {
      const res = await fetch("/api/logistic/orders/bulk-status", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ids, status }),
      });
      if (!res.ok) throw new Error("Gagal update");
      const data = await res.json();
      toast({ title: `${data.count} transaksi diubah ke "${status}"` });
      setSelectedIds(new Set());
      setBulkStatusValue("");
      queryClient.invalidateQueries({ queryKey: getListLogisticOrdersQueryKey() });
    } catch {
      toast({ title: "Gagal mengubah status", variant: "destructive" });
    } finally {
      setIsBulkUpdating(false);
    }
  }

  async function handleBulkDelete() {
    const ids = Array.from(selectedIds);
    if (ids.length === 0) return;
    setIsBulkDeleting(true);
    try {
      const res = await fetch("/api/logistic/orders/bulk", {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ids }),
      });
      if (!res.ok) throw new Error("Gagal menghapus");
      const data = await res.json();
      toast({ title: `${data.count} transaksi berhasil dihapus` });
      setSelectedIds(new Set());
      setBulkDeleteDialog(false);
      queryClient.invalidateQueries({ queryKey: getListLogisticOrdersQueryKey() });
    } catch {
      toast({ title: "Gagal menghapus transaksi", variant: "destructive" });
    } finally {
      setIsBulkDeleting(false);
    }
  }

  function getActiveStepKey(o: typeof orders[number]): string | null {
    const done = deriveCompletedSteps(o as any);
    const doneIdx = PROGRESS_STEPS.map((s, i) => done.has(s.key) ? i : -1).filter(i => i >= 0);
    if (doneIdx.length === 0) return null;
    return PROGRESS_STEPS[Math.max(...doneIdx)].key;
  }

  const stepCounts: Record<string, number> = {};
  for (const step of PROGRESS_STEPS) stepCounts[step.key] = 0;
  for (const o of orders) {
    const key = getActiveStepKey(o);
    if (key) stepCounts[key] = (stepCounts[key] ?? 0) + 1;
  }

  const counts = {
    total: orders.length,
    newOrder: orders.filter((o) => o.status === "New Order").length,
    inProgress: orders.filter((o) => o.status === "In Progress").length,
    completed: orders.filter((o) => o.status === "Completed").length,
    fulfillmentPending: orders.filter((o) => fulfillmentOf(o) === "pending").length,
  };

  return (
    <AppShell>
      <div className="space-y-6 p-6">
        <div className="flex items-center justify-between gap-4">
          <div>
            <h1 className="text-2xl font-bold flex items-center gap-2">
              <PackageOpen className="h-6 w-6" /> Portal Orders
            </h1>
            <p className="text-sm text-muted-foreground mt-1">
              Pesanan masuk dari customer portal — ubah status atau konversi ke Sales Order
            </p>
          </div>
          <div className="flex items-center gap-2 shrink-0">
            {newOrderCount > 0 && (
              <div className="flex items-center gap-1.5 rounded-full bg-green-500/10 border border-green-500/30 px-3 py-1.5 text-green-700 dark:text-green-400 animate-in fade-in slide-in-from-right-4 duration-300">
                <span className="relative flex h-2 w-2">
                  <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-green-500 opacity-75" />
                  <span className="relative inline-flex rounded-full h-2 w-2 bg-green-500" />
                </span>
                <Zap className="h-3.5 w-3.5" />
                <span className="text-xs font-semibold">
                  {newOrderCount === 1 ? "1 order baru" : `${newOrderCount} order baru`} — diperbarui otomatis
                </span>
                {lastAutoRefresh && (
                  <span className="text-[10px] text-green-600/70 dark:text-green-500/60">
                    {lastAutoRefresh.toLocaleTimeString("id-ID", { hour: "2-digit", minute: "2-digit", second: "2-digit" })}
                  </span>
                )}
              </div>
            )}
            <Button variant="outline" size="sm" onClick={() => refetch()} className="gap-2">
              <RefreshCw className="h-4 w-4" /> Refresh
            </Button>
          </div>
        </div>

        {/* Summary Stat Cards */}
        <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
          {[
            { label: "Total", value: counts.total, color: "text-foreground", onClick: () => { setProgressStepFilter(null); setFulfillmentFilter("all"); setStatusFilter("all"); }, active: !progressStepFilter && fulfillmentFilter === "all" && statusFilter === "all" },
            { label: "New Order", value: counts.newOrder, color: "text-yellow-700", onClick: () => { setProgressStepFilter(null); setStatusFilter(statusFilter === "New Order" ? "all" : "New Order"); setFulfillmentFilter("all"); }, active: statusFilter === "New Order" },
            { label: "In Progress", value: counts.inProgress, color: "text-orange-700", onClick: () => { setProgressStepFilter(null); setStatusFilter(statusFilter === "In Progress" ? "all" : "In Progress"); setFulfillmentFilter("all"); }, active: statusFilter === "In Progress" },
            { label: "Completed", value: counts.completed, color: "text-green-700", onClick: () => { setProgressStepFilter(null); setStatusFilter(statusFilter === "Completed" ? "all" : "Completed"); setFulfillmentFilter("all"); }, active: statusFilter === "Completed" },
            { label: "Vendor Pending", value: counts.fulfillmentPending, color: "text-emerald-700", onClick: () => { setProgressStepFilter(null); setFulfillmentFilter(fulfillmentFilter === "pending" ? "all" : "pending"); setStatusFilter("all"); }, active: fulfillmentFilter === "pending", icon: <ClipboardCheck className="h-3 w-3 text-emerald-600" /> },
          ].map((s) => (
            <Card
              key={s.label}
              className={`cursor-pointer transition-all hover:shadow-md ${s.active ? "ring-2 ring-primary" : ""}`}
              onClick={s.onClick}
            >
              <CardHeader className="pb-1 pt-3 px-3">
                <CardTitle className="text-xs text-muted-foreground flex items-center gap-1">
                  {s.icon ?? null}{s.label}
                </CardTitle>
              </CardHeader>
              <CardContent className="px-3 pb-3">
                <p className={`text-xl font-bold ${s.color}`}>{s.value}</p>
              </CardContent>
            </Card>
          ))}
        </div>

        {/* Progress Step Cards — scrollable row */}
        <div className="overflow-x-auto pb-1">
          <div className="flex gap-2 min-w-max">
            {PROGRESS_STEPS.map((step) => {
              const count = stepCounts[step.key] ?? 0;
              const isActive = progressStepFilter === step.key;
              return (
                <button
                  key={step.key}
                  onClick={() => setProgressStepFilter(isActive ? null : step.key)}
                  className={`flex flex-col items-start gap-0.5 rounded-lg border px-3 py-2 min-w-[108px] transition-all hover:shadow-sm ${
                    isActive
                      ? "ring-2 ring-offset-1 ring-current border-transparent bg-white dark:bg-slate-900 shadow"
                      : "border-border bg-card hover:bg-accent/50"
                  }`}
                >
                  <div className="flex items-center gap-1.5 w-full">
                    <span className={`inline-block w-2 h-2 rounded-full shrink-0 ${step.color}`} />
                    <span className={`text-[10px] font-medium leading-tight truncate max-w-[80px] ${step.text}`}>
                      {step.label}
                    </span>
                  </div>
                  <span className={`text-lg font-bold leading-none mt-0.5 ${step.text}`}>{count}</span>
                </button>
              );
            })}
          </div>
        </div>

        {/* Filters */}
        <div className="flex flex-col sm:flex-row gap-3 flex-wrap">
          <div className="relative flex-1 min-w-48">
            <Search className="absolute left-3 top-2.5 h-4 w-4 text-muted-foreground" />
            <Input
              placeholder="Cari nomor order, nama, perusahaan, email..."
              className={`pl-9 ${search ? "pr-9" : ""}`}
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
            {search && (
              <button
                onClick={() => setSearch("")}
                className="absolute right-2.5 top-2.5 text-muted-foreground hover:text-foreground transition-colors"
                aria-label="Hapus pencarian"
              >
                <X className="h-4 w-4" />
              </button>
            )}
          </div>
          <Select value={statusFilter} onValueChange={setStatusFilter}>
            <SelectTrigger className="w-44">
              <SelectValue placeholder="Semua status" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">Semua Status</SelectItem>
              {STATUS_OPTIONS.map((s) => (
                <SelectItem key={s} value={s}>{s}</SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Select value={fulfillmentFilter} onValueChange={setFulfillmentFilter}>
            <SelectTrigger className="w-52">
              <ClipboardCheck className="h-4 w-4 text-emerald-600 mr-1 shrink-0" />
              <SelectValue placeholder="Semua fulfillment" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">Semua Fulfillment</SelectItem>
              <SelectItem value="not_sent">Belum Dikirim ke Vendor</SelectItem>
              <SelectItem value="pending">Menunggu Konfirmasi</SelectItem>
              <SelectItem value="submitted">Sudah Dikonfirmasi</SelectItem>
            </SelectContent>
          </Select>
          <Select value={koliFilter} onValueChange={setKoliFilter}>
            <SelectTrigger className="w-44">
              <SelectValue placeholder="Semua koli" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">Semua Koli</SelectItem>
              <SelectItem value="has_koli">Ada Koli</SelectItem>
              <SelectItem value="lt5">&lt; 5 koli</SelectItem>
              <SelectItem value="5to10">5 – 10 koli</SelectItem>
              <SelectItem value="gt10">&gt; 10 koli</SelectItem>
            </SelectContent>
          </Select>
          <Select value={shipmentTypeFilter} onValueChange={setShipmentTypeFilter}>
            <SelectTrigger className="w-44">
              <SelectValue placeholder="Semua tipe" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">Semua Tipe</SelectItem>
              <SelectItem value="fcl">FCL</SelectItem>
              <SelectItem value="lcl">LCL</SelectItem>
              <SelectItem value="trucking">Trucking</SelectItem>
              <SelectItem value="air">Air Freight</SelectItem>
            </SelectContent>
          </Select>
          {(fulfillmentFilter !== "all" || koliFilter !== "all" || shipmentTypeFilter !== "all") && (
            <Button variant="ghost" size="sm" className="text-muted-foreground gap-1" onClick={() => { setFulfillmentFilter("all"); setKoliFilter("all"); setShipmentTypeFilter("all"); }}>
              <X className="h-3.5 w-3.5" /> Reset
            </Button>
          )}
        </div>

        {/* Bulk Action Toolbar */}
        {selectedIds.size > 0 && (
          <div className="flex flex-wrap items-center gap-3 rounded-lg border border-primary/20 bg-primary/5 px-4 py-2.5 animate-in fade-in slide-in-from-top-2 duration-200">
            <span className="text-sm font-semibold">
              {selectedIds.size} transaksi dipilih
            </span>
            <div className="w-px h-4 bg-border" />
            {/* Bulk Status Update */}
            <div className="flex items-center gap-2">
              <Select
                value={bulkStatusValue}
                onValueChange={(v) => {
                  setBulkStatusValue(v);
                  handleBulkStatusUpdate(v);
                }}
                disabled={isBulkUpdating}
              >
                <SelectTrigger className="h-7 w-44 text-xs">
                  <SelectValue placeholder={isBulkUpdating ? "Memperbarui..." : "Ubah status ke..."} />
                </SelectTrigger>
                <SelectContent>
                  {STATUS_OPTIONS.map((s) => (
                    <SelectItem key={s} value={s} className="text-xs">
                      <span className={`inline-block w-2 h-2 rounded-full mr-1.5 ${
                        s === "New Order" ? "bg-yellow-500" :
                        s === "Confirmed" ? "bg-blue-500" :
                        s === "In Progress" ? "bg-orange-500" :
                        s === "Completed" ? "bg-green-500" :
                        "bg-red-500"
                      }`} />
                      {s}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="w-px h-4 bg-border" />
            {/* Bulk Delete */}
            <Button
              size="sm"
              variant="destructive"
              className="gap-1.5 h-7"
              onClick={() => setBulkDeleteDialog(true)}
              disabled={isBulkDeleting || isBulkUpdating}
            >
              <Trash2 className="h-3.5 w-3.5" />
              Hapus
            </Button>
            <Button
              size="sm"
              variant="ghost"
              className="h-7 text-muted-foreground"
              onClick={() => { setSelectedIds(new Set()); setBulkStatusValue(""); }}
              disabled={isBulkUpdating}
            >
              <X className="h-3.5 w-3.5 mr-1" />
              Batal
            </Button>
          </div>
        )}

        {/* Table */}
        <Card>
          <CardContent className="p-0">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="w-10 pl-4">
                    <Checkbox
                      checked={allSelected}
                      data-state={someSelected ? "indeterminate" : allSelected ? "checked" : "unchecked"}
                      onCheckedChange={toggleAll}
                      aria-label="Pilih semua"
                    />
                  </TableHead>
                  <TableHead>No. Order</TableHead>
                  <TableHead>Pelanggan</TableHead>
                  <TableHead>Rute</TableHead>
                  <TableHead>Tipe</TableHead>
                  <TableHead className="text-center">Koli</TableHead>
                  <TableHead className="text-right">Total</TableHead>
                  <TableHead>Tanggal</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>RFQ</TableHead>
                  <TableHead>Fulfillment</TableHead>
                  <TableHead></TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {isLoading ? (
                  <TableRow>
                    <TableCell colSpan={12} className="text-center py-8 text-muted-foreground">
                      Memuat...
                    </TableCell>
                  </TableRow>
                ) : filtered.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={12} className="text-center py-10 text-muted-foreground">
                      <div className="flex flex-col items-center gap-1.5">
                        <span className="text-2xl">📭</span>
                        <span className="text-sm font-medium">Tidak ada pesanan ditemukan</span>
                        <span className="text-xs">Coba ubah filter atau kata kunci pencarian</span>
                      </div>
                    </TableCell>
                  </TableRow>
                ) : filtered.map((o) => (
                  <Fragment key={o.id}>
                  <TableRow
                    className={`cursor-pointer hover:bg-muted/40 transition-colors ${selectedIds.has(o.id) ? "bg-destructive/5" : ""}`}
                    onClick={() => setDetailDialog(o)}
                    {...prefetchHover(getGetLogisticOrderQueryOptions(o.id))}
                  >
                    <TableCell className="pl-4" onClick={(e) => e.stopPropagation()}>
                      <Checkbox
                        checked={selectedIds.has(o.id)}
                        onCheckedChange={() => toggleOne(o.id)}
                        aria-label={`Pilih order ${o.orderNumber}`}
                      />
                    </TableCell>
                    <TableCell onClick={(e) => e.stopPropagation()}>
                      <div className="flex items-center gap-1.5 flex-wrap">
                        <button
                          className="font-mono text-xs font-medium hover:underline text-left"
                          onClick={(e) => { e.stopPropagation(); setDetailDialog(o); }}
                        >
                          <Highlight text={o.orderNumber} query={search} />
                        </button>
                        {(o as { source?: string }).source === "ai_agent" && (
                          <span className="inline-flex items-center gap-0.5 px-1.5 py-0.5 rounded text-[10px] font-bold bg-violet-100 text-violet-700 border border-violet-200">
                            🤖 Via AI
                          </span>
                        )}
                        {(o as { orderType?: string }).orderType === "product" && (
                          <span className="inline-flex px-1.5 py-0.5 rounded text-[10px] font-bold bg-emerald-100 text-emerald-700 border border-emerald-200">Produk</span>
                        )}
                        {(o as { orderType?: string }).orderType === "service" && (
                          <span className="inline-flex px-1.5 py-0.5 rounded text-[10px] font-bold bg-violet-100 text-violet-700 border border-violet-200">Jasa</span>
                        )}
                        {(() => {
                          const fsId = (o as any).directFreightShipmentId ?? (o as any).latestRfq?.freightShipmentId;
                          const fsNum = (o as any).directFreightShipmentNumber ?? (o as any).latestRfq?.freightShipmentNumber;
                          if (!fsId) return null;
                          return (
                            <button
                              className="inline-flex items-center gap-0.5 px-1.5 py-0.5 rounded text-[10px] font-bold bg-teal-100 text-teal-700 border border-teal-200 hover:bg-teal-200 transition-colors"
                              onClick={(e) => { e.stopPropagation(); navigate(`/logistics/freight/${fsId}`); }}
                              title={`Freight Shipment: ${fsNum ?? fsId}`}
                            >
                              <Ship className="h-2.5 w-2.5 shrink-0" />
                              {fsNum ?? `FS#${fsId}`}
                            </button>
                          );
                        })()}
                      </div>
                    </TableCell>
                    <TableCell>
                      <div className="flex flex-col">
                        <span className="font-medium text-sm"><Highlight text={o.customerName} query={search} /></span>
                        <span className="text-xs text-muted-foreground"><Highlight text={o.companyName} query={search} /></span>
                        <span className="text-xs text-muted-foreground"><Highlight text={o.email} query={search} /></span>
                      </div>
                    </TableCell>
                    <TableCell>
                      <span className="text-sm">{o.origin} → {o.destination}</span>
                    </TableCell>
                    {/* Tipe — editable dropdown */}
                    <TableCell onClick={(e) => e.stopPropagation()}>
                      <Select
                        value={o.shipmentType}
                        onValueChange={(v) => handleTypeChange(o.id, v)}
                        disabled={updatingTypeId === o.id}
                      >
                        <SelectTrigger className="h-7 w-36 text-xs border border-dashed hover:border-solid">
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          {/* Show current value if not in standard list */}
                          {!!o.shipmentType && !SHIPMENT_TYPE_OPTIONS.includes(o.shipmentType) && (
                            <SelectItem value={o.shipmentType} className="text-xs">
                              {o.shipmentType}
                            </SelectItem>
                          )}
                          {SHIPMENT_TYPE_OPTIONS.map((s) => (
                            <SelectItem key={s} value={s} className="text-xs">{s}</SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </TableCell>
                    <TableCell className="text-center text-sm text-muted-foreground">
                      {o.jumlahKoli != null ? <span className="font-medium text-foreground">{o.jumlahKoli}</span> : <span className="text-xs">—</span>}
                    </TableCell>
                    <TableCell className="text-right font-medium text-sm">
                      {idr(o.grandTotal)}
                    </TableCell>
                    <TableCell className="text-xs text-muted-foreground">
                      {new Date(o.createdAt).toLocaleDateString("id-ID", {
                        day: "2-digit", month: "short", year: "numeric",
                      })}
                    </TableCell>
                    <TableCell onClick={(e) => e.stopPropagation()}>
                      <div className="flex items-center gap-2">
                        <Badge className={`${STATUS_COLORS[o.status] ?? "bg-gray-100 text-gray-800"} border text-xs whitespace-nowrap`}>
                          {o.status}
                        </Badge>
                        <Select
                          value={o.status}
                          onValueChange={(v) => handleStatusChange(o.id, v)}
                          disabled={updatingId === o.id}
                        >
                          <SelectTrigger className="h-7 w-32 text-xs">
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent>
                            {STATUS_OPTIONS.map((s) => (
                              <SelectItem key={s} value={s} className="text-xs">{s}</SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      </div>
                    </TableCell>
                    {/* RFQ status column */}
                    <TableCell onClick={(e) => e.stopPropagation()}>
                      <RfqStatusCell
                        latestRfq={(o as any).latestRfq ?? null}
                        onCreateRfq={() => openRfqDialog(o)}
                      />
                    </TableCell>
                    {/* Fulfillment status column */}
                    <TableCell onClick={(e) => e.stopPropagation()}>
                      {(() => {
                        const fs = fulfillmentOf(o);
                        if (fs === "submitted") return (
                          <Badge className="bg-emerald-100 text-emerald-800 border border-emerald-200 text-[10px] px-1.5 py-0.5 gap-1 whitespace-nowrap">
                            <ClipboardCheck className="h-2.5 w-2.5" /> Dikonfirmasi
                          </Badge>
                        );
                        if (fs === "pending") return (
                          <Badge className="bg-amber-100 text-amber-800 border border-amber-200 text-[10px] px-1.5 py-0.5 whitespace-nowrap">
                            ⏳ Menunggu
                          </Badge>
                        );
                        return (
                          <span className="text-[10px] text-slate-400">—</span>
                        );
                      })()}
                    </TableCell>
                    <TableCell onClick={(e) => e.stopPropagation()}>
                      <div className="flex items-center gap-1">
                        <Button
                          size="sm"
                          variant="outline"
                          className="gap-1.5 text-xs h-7 whitespace-nowrap"
                          onClick={() => navigate(`/logistics/portal-orders/${o.id}`)}
                          title="Detail & RFQ"
                        >
                          Detail / RFQ
                        </Button>
                        <Button
                          size="sm"
                          variant="outline"
                          className="gap-1.5 text-xs h-7 whitespace-nowrap text-blue-600 border-blue-200 hover:bg-blue-50"
                          onClick={() => openRfqDialog(o)}
                          disabled={o.status === "Cancelled" || o.status === "Completed"}
                          title="Kirim RFQ ke Vendor"
                        >
                          <Send className="h-3 w-3" />
                          Kirim RFQ
                        </Button>
                        <Button
                          size="sm"
                          variant="outline"
                          className="gap-1.5 text-xs h-7 whitespace-nowrap"
                          onClick={() => setSoDialog(o)}
                          disabled={o.status === "Cancelled"}
                          title="Buat Sales Order"
                        >
                          <FilePlus className="h-3.5 w-3.5" />
                          Buat SO
                        </Button>
                        {o.status !== "Completed" && o.status !== "Cancelled" && (
                          <Button
                            size="sm"
                            variant="ghost"
                            className="h-7 w-7 p-0 text-muted-foreground hover:text-destructive hover:bg-destructive/10"
                            title="Batalkan"
                            disabled={updatingId === o.id}
                            onClick={() => {
                              if (!confirm(`Batalkan order ${o.orderNumber}?`)) return;
                              handleStatusChange(o.id, "Cancelled");
                            }}
                            data-testid={`btn-cancel-${o.id}`}
                          >
                            <X className="h-3.5 w-3.5" />
                          </Button>
                        )}
                      </div>
                    </TableCell>
                  </TableRow>
                  <TableRow className="border-b hover:bg-transparent">
                    <TableCell colSpan={12} className="py-1 px-4 pb-2 pt-0">
                      <OrderProgressBar status={o.status} />
                    </TableCell>
                  </TableRow>
                  </Fragment>
                ))}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      </div>

      {/* Quick Detail Dialog */}
      {detailDialog && (
        <Dialog open onOpenChange={() => setDetailDialog(null)}>
          <DialogContent className="max-w-lg max-h-[90vh] overflow-y-auto">
            <DialogHeader>
              <DialogTitle className="flex items-center gap-2">
                <PackageOpen className="h-5 w-5" />
                {detailDialog.orderNumber}
              </DialogTitle>
              <DialogDescription>
                {detailDialog.customerName} · {detailDialog.companyName}
              </DialogDescription>
            </DialogHeader>

            <div className="space-y-3 py-1 text-sm">
              <div className="rounded-lg border bg-muted/40 p-4 space-y-2">
                <InfoRow label="Status">
                  <Badge className={`${STATUS_COLORS[detailDialog.status] ?? "bg-gray-100 text-gray-800"} border text-xs`}>
                    {detailDialog.status}
                  </Badge>
                </InfoRow>
                <InfoRow label="Tipe">
                  <Select
                    value={detailDialog.shipmentType}
                    onValueChange={(v) => handleTypeChange(detailDialog.id, v)}
                    disabled={updatingTypeId === detailDialog.id}
                  >
                    <SelectTrigger className="h-7 w-40 text-xs border-dashed">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {!!detailDialog.shipmentType && !SHIPMENT_TYPE_OPTIONS.includes(detailDialog.shipmentType) && (
                        <SelectItem value={detailDialog.shipmentType} className="text-xs">
                          {detailDialog.shipmentType}
                        </SelectItem>
                      )}
                      {SHIPMENT_TYPE_OPTIONS.map((s) => (
                        <SelectItem key={s} value={s} className="text-xs">{s}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </InfoRow>
                <InfoRow label="Rute" value={`${detailDialog.origin} → ${detailDialog.destination}`} />
                <InfoRow label="Email" value={detailDialog.email} />
                <InfoRow label="Telepon" value={detailDialog.phone} />
                {detailDialog.companyName && <InfoRow label="Perusahaan" value={detailDialog.companyName} />}
                {detailDialog.commodity && <InfoRow label="Komoditi" value={detailDialog.commodity} />}
                {detailDialog.cargoDescription && <InfoRow label="Kargo" value={detailDialog.cargoDescription} />}
                {detailDialog.grossWeight != null && <InfoRow label="Berat" value={`${detailDialog.grossWeight} kg`} />}
                {detailDialog.volumeCbm != null && <InfoRow label="Volume" value={`${detailDialog.volumeCbm} CBM`} />}
                {detailDialog.notes && <InfoRow label="Catatan" value={detailDialog.notes} />}
                {detailDialog.namaPenerima && <InfoRow label="Penerima" value={detailDialog.namaPenerima} />}
                {detailDialog.nomorPenerima && <InfoRow label="Telp Penerima" value={detailDialog.nomorPenerima} />}
                <div className="border-t pt-2 mt-2">
                  <InfoRow label="Total" value={<span className="font-bold text-base">{idr(detailDialog.grandTotal)}</span>} />
                </div>
              </div>

              {/* Cargo photos */}
              {detailCargoPhotos.length > 0 && (
                <div>
                  <p className="text-xs text-muted-foreground mb-2">Foto Barang ({detailCargoPhotos.length})</p>
                  <div className="flex flex-wrap gap-2">
                    {detailCargoPhotos.map((url, i) => (
                      <button
                        key={i}
                        type="button"
                        onClick={() => setViewPhoto(url)}
                        className="relative group rounded-md overflow-hidden border w-16 h-16 bg-muted hover:opacity-90 transition-opacity"
                      >
                        <img src={url} alt={`Foto ${i + 1}`} className="w-full h-full object-cover" />
                        <div className="absolute inset-0 bg-black/30 opacity-0 group-hover:opacity-100 flex items-center justify-center transition-opacity">
                          <Eye className="h-4 w-4 text-white" />
                        </div>
                      </button>
                    ))}
                  </div>
                </div>
              )}

              <p className="text-xs text-muted-foreground">
                Dibuat: {formatTanggal(detailDialog.createdAt)}
              </p>
            </div>

            <DialogFooter className="flex-col sm:flex-row gap-2">
              <Select
                value={detailDialog.status}
                onValueChange={(v) => handleStatusChange(detailDialog.id, v)}
                disabled={updatingId === detailDialog.id}
              >
                <SelectTrigger className="w-40">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {STATUS_OPTIONS.map((s) => (
                    <SelectItem key={s} value={s}>
                      <span className={`inline-block w-2 h-2 rounded-full mr-1.5 ${STATUS_DOT_COLOR[s] ?? "bg-gray-400"}`} />
                      {STATUS_LABEL_ID[s] ?? s}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <Button
                variant="outline"
                className="gap-1.5 text-xs"
                onClick={() => { setDetailDialog(null); navigate(`/logistics/portal-orders/${detailDialog.id}`); }}
              >
                Detail / RFQ →
              </Button>
              <Button variant="outline" onClick={() => setDetailDialog(null)}>Tutup</Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      )}

      {/* Create Sales Order Dialog */}
      <Dialog open={!!soDialog} onOpenChange={(open) => { if (!open) { setSoDialog(null); setViewPhoto(null); } }}>
        <DialogContent className="max-w-lg max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <FilePlus className="h-5 w-5" /> Buat Sales Order
            </DialogTitle>
            <DialogDescription>
              Sales Order akan dibuat dari portal order berikut dan diarahkan ke halaman Sales.
            </DialogDescription>
          </DialogHeader>
          {soDialog && (
            <div className="space-y-3 py-2">
              <div className="rounded-lg border bg-muted/40 p-4 space-y-2 text-sm">
                <div className="flex justify-between">
                  <span className="text-muted-foreground">No. Order</span>
                  <span className="font-mono font-medium">{soDialog.orderNumber}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Pelanggan</span>
                  <span className="font-medium">{soDialog.customerName}</span>
                </div>
                {soDialog.phone && (
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">Telepon Pengirim</span>
                    <span>{soDialog.phone}</span>
                  </div>
                )}
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Perusahaan</span>
                  <span>{soDialog.companyName}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Tipe</span>
                  <Badge variant="outline" className="text-xs">{soDialog.shipmentType}</Badge>
                </div>
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Rute</span>
                  <span className="text-right max-w-[60%]">{soDialog.origin} → {soDialog.destination}</span>
                </div>
                {soDialog.commodity && (
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">Kategori Barang</span>
                    <span>{soDialog.commodity}</span>
                  </div>
                )}
                {soDialog.volumeCbm != null && (
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">Total Volume</span>
                    <span>{soDialog.volumeCbm} m³</span>
                  </div>
                )}
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Tanggal Order</span>
                  <span>{formatTanggal(soDialog.createdAt)}</span>
                </div>
                {soDialog.namaPenerima && (
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">Nama Penerima</span>
                    <span>{soDialog.namaPenerima}</span>
                  </div>
                )}
                {soDialog.nomorPenerima && (
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">No. Telepon Penerima</span>
                    <span>{soDialog.nomorPenerima}</span>
                  </div>
                )}
                {cargoPhotos.length > 0 && (
                  <div className="pt-1">
                    <span className="text-muted-foreground block mb-2">Foto Barang ({cargoPhotos.length})</span>
                    <div className="flex flex-wrap gap-2">
                      {cargoPhotos.map((url, i) => (
                        <button
                          key={i}
                          type="button"
                          onClick={() => setViewPhoto(url)}
                          className="relative group rounded-md overflow-hidden border w-16 h-16 bg-muted hover:opacity-90 transition-opacity"
                        >
                          <img src={url} alt={`Foto ${i + 1}`} className="w-full h-full object-cover" />
                          <div className="absolute inset-0 bg-black/30 opacity-0 group-hover:opacity-100 flex items-center justify-center transition-opacity">
                            <Eye className="h-4 w-4 text-white" />
                          </div>
                        </button>
                      ))}
                    </div>
                  </div>
                )}
                <div className="flex justify-between border-t pt-2 mt-2">
                  <span className="text-muted-foreground font-medium">Total</span>
                  <span className="font-bold text-base">{idr(soDialog.grandTotal)}</span>
                </div>
              </div>
              <p className="text-xs text-muted-foreground">
                Sales Order akan dibuat dengan status <strong>Draft</strong> dengan 1 line item berisi total harga portal order ini.
                Anda bisa mengubah detail di halaman Sales setelah dibuat.
              </p>
            </div>
          )}
          <DialogFooter>
            <Button variant="outline" onClick={() => setSoDialog(null)}>Batal</Button>
            {(soDialog as any)?.linkedSalesDocId ? (
              <Button
                variant="secondary"
                className="gap-2"
                onClick={() => { setSoDialog(null); navigate("/sales/orders"); }}
              >
                <ExternalLink className="h-4 w-4" />
                Lihat SO: {(soDialog as any).linkedSalesDocNumber}
              </Button>
            ) : (
              <Button
                onClick={handleCreateSalesOrder}
                disabled={createSalesDoc.isPending}
                className="gap-2"
              >
                <FilePlus className="h-4 w-4" />
                {createSalesDoc.isPending ? "Membuat..." : "Buat Sales Order"}
              </Button>
            )}
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Bulk Delete Confirmation Dialog */}
      <Dialog open={bulkDeleteDialog} onOpenChange={(open) => { if (!open) setBulkDeleteDialog(false); }}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2 text-destructive">
              <Trash2 className="h-5 w-5" /> Hapus Transaksi
            </DialogTitle>
            <DialogDescription>
              Anda akan menghapus <strong>{selectedIds.size} transaksi</strong> secara permanen. Tindakan ini tidak dapat dibatalkan.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setBulkDeleteDialog(false)} disabled={isBulkDeleting}>
              Batal
            </Button>
            <Button variant="destructive" onClick={handleBulkDelete} disabled={isBulkDeleting} className="gap-2">
              <Trash2 className="h-4 w-4" />
              {isBulkDeleting ? "Menghapus..." : `Hapus ${selectedIds.size} transaksi`}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Photo lightbox */}
      {viewPhoto && (
        <Dialog open={!!viewPhoto} onOpenChange={() => setViewPhoto(null)}>
          <DialogContent className="max-w-2xl p-2">
            <img src={viewPhoto} alt="Foto Barang" className="w-full rounded-md object-contain max-h-[80vh]" />
          </DialogContent>
        </Dialog>
      )}

      {/* RFQ Dialog */}
      <Dialog open={!!rfqTargetOrder} onOpenChange={(open) => { if (!open) setRfqTargetOrder(null); }}>
        <DialogContent className="max-w-xl">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Send className="h-5 w-5" /> Kirim RFQ ke Vendor
            </DialogTitle>
            {rfqTargetOrder && (
              <DialogDescription>
                {rfqTargetOrder.orderNumber} · {rfqTargetOrder.customerName}
              </DialogDescription>
            )}
          </DialogHeader>
          {rfqTargetOrder && (
            <div className="space-y-4 py-2">
              <div className="rounded-lg border bg-muted/40 px-4 py-3 text-sm space-y-1">
                <div className="font-medium font-mono">{rfqTargetOrder.orderNumber}</div>
                <div className="text-muted-foreground">{rfqTargetOrder.shipmentType} · {rfqTargetOrder.origin} → {rfqTargetOrder.destination}</div>
              </div>

              <div>
                <Label className="text-sm font-medium mb-1 block">Tipe Pengiriman</Label>
                <Select value={rfqShipmentType} onValueChange={setRfqShipmentType}>
                  <SelectTrigger className="h-8 text-xs">
                    <SelectValue placeholder="Pilih tipe..." />
                  </SelectTrigger>
                  <SelectContent>
                    {!!rfqShipmentType && !SHIPMENT_TYPE_OPTIONS.includes(rfqShipmentType) && (
                      <SelectItem value={rfqShipmentType} className="text-xs">{rfqShipmentType}</SelectItem>
                    )}
                    {SHIPMENT_TYPE_OPTIONS.map((s) => (
                      <SelectItem key={s} value={s} className="text-xs">{s}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              <div>
                <Label className="text-sm font-medium mb-2 block">
                  Pilih Vendor ({rfqSelectedVendors.length} dipilih)
                </Label>
                <div className="space-y-2 max-h-56 overflow-y-auto pr-1">
                  {activeVendors.length === 0 && (
                    <p className="text-sm text-muted-foreground">Tidak ada vendor aktif.</p>
                  )}
                  {activeVendors.map((v) => (
                    <label
                      key={v.id}
                      className="flex items-center gap-3 rounded-lg border px-3 py-2 cursor-pointer hover:bg-muted/50 transition-colors"
                    >
                      <Checkbox
                        checked={rfqSelectedVendors.includes(v.id)}
                        onCheckedChange={(checked) => {
                          setRfqSelectedVendors((prev) =>
                            checked ? [...prev, v.id] : prev.filter((x) => x !== v.id)
                          );
                        }}
                      />
                      <div className="flex-1 min-w-0">
                        <div className="font-medium text-sm">{v.name}</div>
                        <div className="text-xs text-muted-foreground">
                          {v.phone ?? "Tidak ada nomor WA"} · {v.serviceType ?? "Semua tipe"}
                        </div>
                      </div>
                      {!v.phone && (
                        <Badge variant="outline" className="text-xs text-orange-600 border-orange-200 shrink-0">No WA</Badge>
                      )}
                    </label>
                  ))}
                </div>
              </div>

              <div>
                <Label className="text-sm">Catatan Tambahan (opsional)</Label>
                <Input
                  className="mt-1"
                  placeholder="Catatan untuk vendor..."
                  value={rfqNotes}
                  onChange={(e) => setRfqNotes(e.target.value)}
                />
              </div>
            </div>
          )}
          <DialogFooter>
            <Button variant="outline" onClick={() => setRfqTargetOrder(null)} disabled={sendingRfq}>Batal</Button>
            <Button
              onClick={() => void handleSendRfq()}
              disabled={sendingRfq || rfqSelectedVendors.length === 0}
              className="gap-2"
            >
              <Send className="h-4 w-4" />
              {sendingRfq ? "Mengirim..." : `Kirim ke ${rfqSelectedVendors.length} Vendor`}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </AppShell>
  );
}

function InfoRow({
  label,
  value,
  children,
}: {
  label: string;
  value?: React.ReactNode;
  children?: React.ReactNode;
}) {
  return (
    <div className="flex justify-between items-center gap-2">
      <span className="text-muted-foreground shrink-0">{label}</span>
      <span className="text-right font-medium">{children ?? value}</span>
    </div>
  );
}
