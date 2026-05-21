import { useState, useEffect, useRef } from "react";
import { useLocation } from "wouter";
import {
  useListLogisticOrders,
  useUpdateLogisticOrderStatus,
  useUpdateLogisticOrderType,
  useCreateSalesDocument,
  useCreateLogisticOrderRfq,
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
import { PackageOpen, Search, RefreshCw, FilePlus, X, Eye, Zap, Send, ExternalLink, Ship } from "lucide-react";
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
];

const STATUS_COLORS: Record<string, string> = {
  "New Order":   "bg-yellow-100 text-yellow-800 border-yellow-200",
  "Confirmed":   "bg-blue-100 text-blue-800 border-blue-200",
  "In Progress": "bg-orange-100 text-orange-800 border-orange-200",
  "Completed":   "bg-green-100 text-green-800 border-green-200",
  "Cancelled":   "bg-red-100 text-red-800 border-red-200",
};

const idr = (n: number) =>
  new Intl.NumberFormat("id-ID", { style: "currency", currency: "IDR", maximumFractionDigits: 0 }).format(n);

const RFQ_STATUS_LABELS: Record<string, string> = {
  admin_review: "Review",
  rfq_sent: "Terkirim",
  vendor_selected: "Vendor Dipilih",
  customer_quoted: "Quoted",
  customer_approved: "Disetujui",
  customer_rejected: "Ditolak",
  customer_revision_requested: "Revisi",
  closed: "Ditutup",
};

const RFQ_STATUS_COLORS: Record<string, string> = {
  admin_review:                "bg-slate-100 text-slate-600 border-slate-200",
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

  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState("all");
  const [updatingId, setUpdatingId] = useState<number | null>(null);
  const [updatingTypeId, setUpdatingTypeId] = useState<number | null>(null);
  const [soDialog, setSoDialog] = useState<LogisticOrder | null>(null);
  const [viewPhoto, setViewPhoto] = useState<string | null>(null);
  const [detailDialog, setDetailDialog] = useState<LogisticOrder | null>(null);

  const [newOrderCount, setNewOrderCount] = useState(0);
  const [lastAutoRefresh, setLastAutoRefresh] = useState<Date | null>(null);
  const bannerTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // RFQ dialog state
  const [rfqTargetOrder, setRfqTargetOrder] = useState<LogisticOrder | null>(null);
  const [rfqSelectedVendors, setRfqSelectedVendors] = useState<number[]>([]);
  const [rfqNotes, setRfqNotes] = useState("");
  const [rfqShipmentType, setRfqShipmentType] = useState("");

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
    { ...(statusFilter !== "all" ? { status: statusFilter } : {}), company: activeCompanyId },
    { query: { queryKey: [...getListLogisticOrdersQueryKey(), statusFilter, activeCompanyId] } },
  );

  const updateStatus = useUpdateLogisticOrderStatus();
  const updateType = useUpdateLogisticOrderType();
  const createSalesDoc = useCreateSalesDocument();
  const createRfq = useCreateLogisticOrderRfq();

  const { data: vendors = [] } = useQuery<VendorRow[]>({
    queryKey: ["logistic-vendors"],
    queryFn: async () => {
      const res = await fetch("/api/logistic/orders/vendors");
      if (!res.ok) throw new Error("Failed");
      return res.json() as Promise<VendorRow[]>;
    },
  });
  const activeVendors = vendors.filter((v) => v.isActive !== false);

  function openRfqDialog(o: LogisticOrder) {
    setRfqTargetOrder(o);
    setRfqSelectedVendors([]);
    setRfqNotes("");
    setRfqShipmentType(o.shipmentType ?? "");
  }

  function handleSendRfq() {
    if (!rfqTargetOrder || rfqSelectedVendors.length === 0) return;
    createRfq.mutate(
      {
        id: rfqTargetOrder.id,
        data: {
          vendorIds: rfqSelectedVendors,
          notes: rfqNotes || undefined,
          shipmentType: rfqShipmentType || undefined,
        } as Parameters<typeof createRfq.mutate>[0]["data"],
      },
      {
        onSuccess: () => {
          toast({ title: "RFQ berhasil dikirim ke vendor" });
          setRfqTargetOrder(null);
          queryClient.invalidateQueries({ queryKey: getListLogisticOrdersQueryKey() });
        },
        onError: (err: unknown) => {
          const msg = (err as { response?: { data?: { message?: string } } })?.response?.data?.message;
          toast({ title: msg ?? "Gagal mengirim RFQ", variant: "destructive" });
        },
      },
    );
  }

  function handleStatusChange(id: number, status: string) {
    setUpdatingId(id);
    updateStatus.mutate(
      { id, data: { status } },
      {
        onSuccess: () => {
          toast({ title: t.common.success, description: status });
          queryClient.invalidateQueries({ queryKey: getListLogisticOrdersQueryKey() });
        },
        onError: () => toast({ title: t.common.error, variant: "destructive" }),
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

  const filtered = orders.filter((o) => {
    if (!search) return true;
    const q = search.toLowerCase();
    return (
      o.orderNumber.toLowerCase().includes(q) ||
      o.customerName.toLowerCase().includes(q) ||
      o.companyName.toLowerCase().includes(q) ||
      o.email.toLowerCase().includes(q)
    );
  });

  const counts = {
    total: orders.length,
    newOrder: orders.filter((o) => o.status === "New Order").length,
    inProgress: orders.filter((o) => o.status === "In Progress").length,
    completed: orders.filter((o) => o.status === "Completed").length,
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

        {/* Stat Cards */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          {[
            { label: "Total", value: counts.total, color: "text-foreground" },
            { label: "New Order", value: counts.newOrder, color: "text-yellow-700" },
            { label: "In Progress", value: counts.inProgress, color: "text-orange-700" },
            { label: "Completed", value: counts.completed, color: "text-green-700" },
          ].map((s) => (
            <Card key={s.label}>
              <CardHeader className="pb-1 pt-4 px-4">
                <CardTitle className="text-xs text-muted-foreground">{s.label}</CardTitle>
              </CardHeader>
              <CardContent className="px-4 pb-4">
                <p className={`text-2xl font-bold ${s.color}`}>{s.value}</p>
              </CardContent>
            </Card>
          ))}
        </div>

        {/* Filters */}
        <div className="flex flex-col sm:flex-row gap-3">
          <div className="relative flex-1">
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
        </div>

        {/* Table */}
        <Card>
          <CardContent className="p-0">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>No. Order</TableHead>
                  <TableHead>Pelanggan</TableHead>
                  <TableHead>Rute</TableHead>
                  <TableHead>Tipe</TableHead>
                  <TableHead className="text-right">Total</TableHead>
                  <TableHead>Tanggal</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>RFQ</TableHead>
                  <TableHead></TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {isLoading ? (
                  <TableRow>
                    <TableCell colSpan={9} className="text-center py-8 text-muted-foreground">
                      Memuat...
                    </TableCell>
                  </TableRow>
                ) : filtered.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={9} className="text-center py-8 text-muted-foreground">
                      Tidak ada pesanan
                    </TableCell>
                  </TableRow>
                ) : filtered.map((o) => (
                  <TableRow
                    key={o.id}
                    className="cursor-pointer hover:bg-muted/40 transition-colors"
                    onClick={() => setDetailDialog(o)}
                    {...prefetchHover(getGetLogisticOrderQueryOptions(o.id))}
                  >
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
                    <SelectItem key={s} value={s}>{s}</SelectItem>
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
            {soDialog?.linkedSalesDocId ? (
              <Button
                variant="secondary"
                className="gap-2"
                onClick={() => { setSoDialog(null); navigate("/sales/orders"); }}
              >
                <ExternalLink className="h-4 w-4" />
                Lihat SO: {soDialog.linkedSalesDocNumber}
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
            <Button variant="outline" onClick={() => setRfqTargetOrder(null)}>Batal</Button>
            <Button
              onClick={handleSendRfq}
              disabled={createRfq.isPending || rfqSelectedVendors.length === 0}
              className="gap-2"
            >
              <Send className="h-4 w-4" />
              {createRfq.isPending ? "Mengirim..." : `Kirim ke ${rfqSelectedVendors.length} Vendor`}
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
