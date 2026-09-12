import { useState, useCallback } from "react";
import { useParams, useLocation } from "wouter";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { AppShell } from "@/components/layout/AppShell";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Checkbox } from "@/components/ui/checkbox";
import { Separator } from "@/components/ui/separator";
import {
  Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import { useToast } from "@/hooks/use-toast";
import {
  ArrowLeft, RefreshCw, Star, CheckCircle, XCircle, MessageCircle,
  Clock, Users, TrendingDown, ExternalLink, Copy, AlertCircle, Loader2,
  Send, Phone, DollarSign, Eye, ThumbsUp, ThumbsDown, RotateCcw, Lock,
  Package, ExternalLink as LinkIcon, Brain, DatabaseZap, Truck, ChevronDown,
} from "lucide-react";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";

const idr = (n: number | null | undefined) =>
  n == null ? "—" : new Intl.NumberFormat("id-ID", { style: "currency", currency: "IDR", maximumFractionDigits: 0 }).format(n);

function timeSince(iso: string | null) {
  if (!iso) return "—";
  const diff = Date.now() - new Date(iso).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return "baru saja";
  if (mins < 60) return `${mins} menit lalu`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs} jam lalu`;
  return `${Math.floor(hrs / 24)} hari lalu`;
}

const STATUS_LABEL: Record<string, string> = {
  waiting_response: "Menunggu",
  accepted_basic_price: "Terima Harga",
  counter_offer: "Counter Offer",
  rejected: "Tolak",
  expired: "Kadaluarsa",
  selected: "Dipilih ✓",
  not_selected: "Tidak Dipilih",
  late_response: "Terlambat",
};

const STATUS_COLOR: Record<string, string> = {
  waiting_response: "bg-yellow-100 text-yellow-800",
  accepted_basic_price: "bg-green-100 text-green-800",
  counter_offer: "bg-blue-100 text-blue-800",
  rejected: "bg-red-100 text-red-800",
  expired: "bg-gray-100 text-gray-500",
  selected: "bg-teal-100 text-teal-800 font-bold",
  not_selected: "bg-gray-100 text-gray-500",
  late_response: "bg-orange-100 text-orange-800",
};

interface VendorRow {
  linkId: number;
  vendorId: number;
  vendorName: string;
  phone: string | null;
  status: string;
  basicPrice: number | null;
  offeredPrice: number | null;
  eta: string | null;
  notes: string | null;
  attachmentUrl: string | null;
  leadTimeDays: number | null;
  stockAvailability: string | null;
  vendorRating: number | null;
  recommendationScore: number | null;
  ontimePercentage: number | null;
  totalOrders: number | null;
  isNewUpdate: boolean;
  openedAt: string | null;
  submittedAt: string | null;
  formUrl: string;
}

interface VendorAiScore {
  vendorId: number;
  aiScore: number;
  tier: "top" | "good" | "moderate" | "new";
  routeOrderCount: number;
  routeOnTimePct: number | null;
  avgDelayDays: number;
  dataConfidence: "high" | "medium" | "low" | "none";
  scoreBullets: string[];
  badges: string[];
}

const AI_TIER = {
  top:      { label: "Top",  bar: "bg-green-500",  text: "text-green-700",  bg: "bg-green-50",  border: "border-green-200" },
  good:     { label: "Good", bar: "bg-blue-500",   text: "text-blue-700",   bg: "bg-blue-50",   border: "border-blue-200"  },
  moderate: { label: "OK",   bar: "bg-yellow-500", text: "text-yellow-700", bg: "bg-yellow-50", border: "border-yellow-200"},
  new:      { label: "Baru", bar: "bg-gray-400",   text: "text-gray-500",   bg: "bg-gray-50",   border: "border-gray-200"  },
};

interface RankingBadge {
  label: string;
  color: string;
}

function getRankingBadges(vendor: VendorRow, allVendors: VendorRow[], aiScores?: Map<number, VendorAiScore>, sellingPriceRef?: number | null): RankingBadge[] {
  const badges: RankingBadge[] = [];
  const answered = allVendors.filter(v => v.offeredPrice != null || v.basicPrice != null);
  if (answered.length < 2) return badges;

  // 💰 Best Price
  const prices = answered.map(v => v.offeredPrice ?? v.basicPrice ?? Infinity);
  const minPrice = Math.min(...prices);
  const myPrice = vendor.offeredPrice ?? vendor.basicPrice;
  if (myPrice != null && myPrice === minPrice) {
    badges.push({ label: "💰 Best Price", color: "bg-green-100 text-green-700 border-green-200" });
  }

  // 📈 Best Margin (highest margin vs selling price ref)
  if (sellingPriceRef != null && sellingPriceRef > 0) {
    const margins = answered
      .map(v => ({ id: v.vendorId, m: sellingPriceRef - (v.offeredPrice ?? v.basicPrice ?? sellingPriceRef) }))
      .filter(x => x.m > -Infinity);
    if (margins.length >= 2) {
      const maxMargin = Math.max(...margins.map(x => x.m));
      const myMargin = sellingPriceRef - (myPrice ?? sellingPriceRef);
      if (myPrice != null && myMargin === maxMargin) {
        badges.push({ label: "📈 Best Margin", color: "bg-purple-100 text-purple-700 border-purple-200" });
      }
    }
  }

  // ⚡ Tercepat (Lead Time Days — smaller is better)
  const withLeadTime = answered.filter(v => v.leadTimeDays != null);
  if (withLeadTime.length > 0 && vendor.leadTimeDays != null) {
    const minLt = Math.min(...withLeadTime.map(v => v.leadTimeDays!));
    if (vendor.leadTimeDays === minLt) {
      badges.push({ label: "⚡ Tercepat", color: "bg-blue-100 text-blue-700 border-blue-200" });
    }
  } else {
    // Fallback: use eta string comparison
    const answeredWithEta = answered.filter(v => v.eta);
    if (answeredWithEta.length > 0 && vendor.eta) {
      const sortedEtas = [...answeredWithEta].sort((a, b) => (a.eta ?? "").localeCompare(b.eta ?? ""));
      if (sortedEtas[0]?.vendorId === vendor.vendorId) {
        badges.push({ label: "⚡ Tercepat", color: "bg-blue-100 text-blue-700 border-blue-200" });
      }
    }
  }

  // 📦 Stok OK
  if (vendor.stockAvailability === "available") {
    const othersAvailable = answered.filter(v => v.vendorId !== vendor.vendorId && v.stockAvailability === "available");
    if (othersAvailable.length === 0) {
      badges.push({ label: "📦 Stok OK", color: "bg-orange-100 text-orange-700 border-orange-200" });
    } else {
      badges.push({ label: "📦 Stok OK", color: "bg-orange-100 text-orange-700 border-orange-200" });
    }
  }

  // ⭐ Top Rated (highest vendorRating from vendor_performance; fallback to AI score)
  const withRating = answered.filter(v => (v.vendorRating ?? 0) > 0);
  if (withRating.length >= 2 && (vendor.vendorRating ?? 0) > 0) {
    const maxRating = Math.max(...withRating.map(v => v.vendorRating!));
    if (vendor.vendorRating === maxRating) {
      badges.push({ label: "⭐ Top Rated", color: "bg-yellow-100 text-yellow-700 border-yellow-200" });
    }
  } else if (aiScores && aiScores.size >= 2) {
    const myAi = aiScores.get(vendor.vendorId);
    if (myAi) {
      const allScores = [...aiScores.values()].map(s => s.aiScore);
      const maxScore = Math.max(...allScores);
      if (myAi.aiScore === maxScore && maxScore > 0) {
        badges.push({ label: "⭐ Top Rated", color: "bg-yellow-100 text-yellow-700 border-yellow-200" });
      }
    }
  }

  return badges;
}

interface TruckVendor {
  id: number;
  name: string;
  phone: string | null;
  hasInternalTruck: boolean;
  internalTruckPrice: number | null;
}

interface OrderItemComp {
  id: number;
  serviceName: string;
  category: string;
  qty: number;
  unit: string;
}

interface VendorItemOfferComp {
  id: number;
  rfqVendorLinkId: number;
  vendorId: number;
  orderItemId: number | null;
  serviceName: string;
  offeredPrice: number | null;
  currency: string;
  scheduleEtd: string | null;
  scheduleEta: string | null;
  leadTimeDays: number | null;
  validityDate: string | null;
  terms: string | null;
  notes: string | null;
}

interface ComparisonData {
  rfqId: number;
  rfqNumber: string;
  orderId: number;
  orderNumber: string;
  customerName: string;
  customerResponseNotes?: string | null;
  customerRespondedAt?: string | null;
  customerPhone: string | null;
  customerEmail: string | null;
  serviceType: string;
  origin: string;
  destination: string;
  commodity: string | null;
  rfqStatus: string;
  quotedPrice: number | null;
  quotedAt: string | null;
  quoteNotes: string | null;
  finalSellingPrice: number | null;
  freightShipmentId: number | null;
  // Truck assignment
  productApproved: boolean;
  truckVendorId: number | null;
  truckVendorName: string | null;
  truckPrice: number | null;
  truckSource: string | null;
  productPrice: number | null;
  totalPrice: number | null;
  selectedVendorTruckInfo: { hasInternalTruck: boolean; internalTruckPrice: number | null } | null;
  truckVendors: TruckVendor[];
  stats: {
    total: number; answered: number; pending: number;
    rejected: number; counterOffer: number; expired: number; selected: number;
  };
  vendors: VendorRow[];
  activities: { id: number; actorType: string; actorName: string | null; action: string; description: string | null; createdAt: string }[];
  // Step 12: per-item comparison
  orderItems?: OrderItemComp[];
  vendorItemOffers?: VendorItemOfferComp[];
}

export default function LogisticsRfqComparisonPage() {
  const { rfqId: rfqIdStr } = useParams<{ rfqId: string }>();
  const rfqId = parseInt(rfqIdStr ?? "", 10);
  const [, navigate] = useLocation();
  const { toast } = useToast();
  const qc = useQueryClient();

  const [selectDialog, setSelectDialog] = useState<{ linkId: number; vendorName: string; price: number | null } | null>(null);
  const [sellingPrice, setSellingPrice] = useState("");
  const [revisionDialog, setRevisionDialog] = useState<{ linkId: number; vendorName: string } | null>(null);
  const [revisionMsg, setRevisionMsg] = useState("");
  const [autoRefresh, setAutoRefresh] = useState(true);

  const [quoteDialog, setQuoteDialog] = useState(false);
  const [quotePrice, setQuotePrice] = useState("");
  const [quoteNotes, setQuoteNotes] = useState("");
  const [quoteSendWa, setQuoteSendWa] = useState(true);

  // Per-item comparison state (Step 12)
  const [perItemTab, setPerItemTab] = useState(false);
  // itemSelections[orderItemId] = { vendorId, markup, ppnIncluded }
  const [itemSelections, setItemSelections] = useState<Record<number, { vendorId: number; markup: string; ppnIncluded: boolean }>>({});
  const [perItemQuoteDialog, setPerItemQuoteDialog] = useState(false);

  const [freightConfirmDialog, setFreightConfirmDialog] = useState(false);
  const [sortBy, setSortBy] = useState<"price" | "leadtime" | "stock" | "score" | "margin">("price");

  // Truck assignment state
  const [truckPanelOpen, setTruckPanelOpen] = useState(false);
  const [truckSourceSel, setTruckSourceSel] = useState<"internal" | "external">("internal");
  const [truckVendorSel, setTruckVendorSel] = useState<string>("");
  const [truckPriceInput, setTruckPriceInput] = useState<string>("");

  const { data, isLoading, refetch } = useQuery<ComparisonData>({
    queryKey: ["rfq-comparison", rfqId],
    queryFn: async () => {
      const res = await fetch(`/api/logistic/rfq/${rfqId}/comparison`);
      if (!res.ok) throw new Error("Gagal memuat data");
      return res.json();
    },
    enabled: !isNaN(rfqId),
    refetchInterval: autoRefresh ? 10000 : false,
  });

  // AI Vendor Score Engine — blends global performance + route-specific Decision Memory
  const { data: vendorScores = [] } = useQuery<VendorAiScore[]>({
    queryKey: ["vendor-scores-bulk-cmp", rfqId, data?.origin, data?.destination, data?.serviceType],
    queryFn: async () => {
      if (!data || data.vendors.length === 0) return [];
      const ids = data.vendors.map(v => v.vendorId).join(",");
      const params = new URLSearchParams({ vendorIds: ids });
      if (data.origin) params.set("origin", data.origin);
      if (data.destination) params.set("destination", data.destination);
      if (data.serviceType) params.set("shipmentType", data.serviceType);
      const r = await fetch(`/api/vendor-performance/scores-bulk?${params.toString()}`);
      if (!r.ok) return [];
      return r.json();
    },
    enabled: !!data && data.vendors.length > 0,
    staleTime: 60_000,
  });

  const scoreMap = new Map(vendorScores.map(s => [s.vendorId, s]));

  const selectMut = useMutation({
    mutationFn: async (payload: { linkId: number; sellingPrice?: number }) => {
      const res = await fetch(`/api/logistic/rfq/${rfqId}/select-vendor`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      if (!res.ok) { const j = await res.json(); throw new Error(j.message); }
      return res.json();
    },
    onSuccess: (d) => {
      toast({ title: "Vendor Dipilih", description: `${d.selectedVendorName} berhasil dipilih` });
      setSelectDialog(null);
      qc.invalidateQueries({ queryKey: ["rfq-comparison", rfqId] });
    },
    onError: (e) => toast({ title: "Gagal", description: (e as Error).message, variant: "destructive" }),
  });

  const sendQuoteMut = useMutation({
    mutationFn: async (extraPayload?: { priceItems?: Array<{ name: string; qty?: number | null; unit?: string | null; unitPrice?: number | null; subtotal: number }> }) => {
      const price = Number(quotePrice);
      if (!price || price <= 0) throw new Error("Harga jual tidak valid");
      const r = await fetch(`/api/logistic/rfq/${rfqId}/send-customer-quote`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          sellingPrice: price,
          quoteNotes: quoteNotes || undefined,
          sendWhatsApp: quoteSendWa,
          finalCustomerPrice: price,
          ...(extraPayload ?? {}),
        }),
      });
      const d = await r.json();
      if (!r.ok) throw new Error(d.message ?? "Gagal kirim penawaran");
      return d;
    },
    onSuccess: (d) => {
      toast({
        title: "Penawaran terkirim",
        description: `${idr(Number(quotePrice))} → ${d.customerName}${d.waSent ? " — WA terkirim ✓" : ""}`,
      });
      setQuoteDialog(false);
      qc.invalidateQueries({ queryKey: ["rfq-comparison", rfqId] });
      qc.invalidateQueries({ queryKey: ["rfq-list"] });
    },
    onError: (e: Error) => toast({ title: "Gagal", description: e.message, variant: "destructive" }),
  });

  const createFreightMut = useMutation({
    mutationFn: async () => {
      const res = await fetch(`/api/logistic/rfq/${rfqId}/create-freight-shipment`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
      });
      const d = await res.json();
      if (!res.ok) throw new Error(d.message ?? "Gagal membuat freight shipment");
      return d as { ok: boolean; shipmentId: number; shipmentNumber?: string; alreadyExists?: boolean };
    },
    onSuccess: (d) => {
      setFreightConfirmDialog(false);
      if (d.alreadyExists) {
        toast({ title: "Freight sudah ada", description: `Navigasi ke shipment #${d.shipmentId}` });
      } else {
        toast({ title: "Freight Shipment Dibuat!", description: `${d.shipmentNumber} berhasil dibuat dari RFQ ini` });
      }
      qc.invalidateQueries({ queryKey: ["rfq-comparison", rfqId] });
      navigate(`/logistics/freight/${d.shipmentId}`);
    },
    onError: (e: Error) => toast({ title: "Gagal", description: e.message, variant: "destructive" }),
  });

  const refreshPriceMut = useMutation({
    mutationFn: async (linkId: number) => {
      const res = await fetch(`/api/logistic/rfq/vendor-link/${linkId}/refresh-price`, {
        method: "PATCH",
      });
      const j = await res.json();
      if (!res.ok) throw new Error(j.message);
      return j as { oldPrice: number | null; newPrice: number };
    },
    onSuccess: (d) => {
      toast({
        title: "Harga Diperbarui",
        description: `Harga referensi diperbarui: ${idr(d.oldPrice)} → ${idr(d.newPrice)}`,
      });
      qc.invalidateQueries({ queryKey: ["rfq-comparison", rfqId] });
    },
    onError: (e) => toast({ title: "Gagal", description: (e as Error).message, variant: "destructive" }),
  });

  const actionMut = useMutation({
    mutationFn: async ({ linkId, action, message }: { linkId: number; action: string; message?: string }) => {
      const res = await fetch(`/api/logistic/rfq/${rfqId}/vendor-link/${linkId}/action`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action, message }),
      });
      if (!res.ok) { const j = await res.json(); throw new Error(j.message); }
      return res.json();
    },
    onSuccess: (_, vars) => {
      if (vars.action === "mark_read") {
        qc.invalidateQueries({ queryKey: ["rfq-comparison", rfqId] });
        return;
      }
      const label = vars.action === "request_revision" ? "Permintaan revisi terkirim" : "Vendor ditolak";
      toast({ title: "Berhasil", description: label });
      setRevisionDialog(null);
      qc.invalidateQueries({ queryKey: ["rfq-comparison", rfqId] });
    },
    onError: (e) => toast({ title: "Gagal", description: (e as Error).message, variant: "destructive" }),
  });

  const assignTruckMut = useMutation({
    mutationFn: async (payload: { source: "internal" | "external"; vendorId?: number; truckPrice?: number }) => {
      const res = await fetch(`/api/logistic/rfq/${rfqId}/assign-truck`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const d = await res.json();
      if (!res.ok) throw new Error(d.message ?? "Gagal assign truck");
      return d as { truckVendorName: string; truckPrice: number; totalPrice: number; truckSource: string };
    },
    onSuccess: (d) => {
      toast({
        title: "Vendor Truk Ditetapkan",
        description: `${d.truckVendorName} — ${idr(d.truckPrice)} · Total: ${idr(d.totalPrice)}`,
      });
      setTruckPanelOpen(false);
      qc.invalidateQueries({ queryKey: ["rfq-comparison", rfqId] });
    },
    onError: (e: Error) => toast({ title: "Gagal", description: e.message, variant: "destructive" }),
  });

  const handleAssignTruck = () => {
    if (truckSourceSel === "internal") {
      assignTruckMut.mutate({ source: "internal" });
    } else {
      const vid = Number(truckVendorSel);
      const tp = Number(truckPriceInput);
      if (!vid) { toast({ title: "Pilih vendor truk terlebih dahulu", variant: "destructive" }); return; }
      if (!tp || tp <= 0) { toast({ title: "Masukkan harga truk yang valid", variant: "destructive" }); return; }
      assignTruckMut.mutate({ source: "external", vendorId: vid, truckPrice: tp });
    }
  };

  const copyLink = useCallback((url: string) => {
    navigator.clipboard.writeText(url).then(() => toast({ title: "Link disalin" }));
  }, [toast]);

  const closeMut = useMutation({
    mutationFn: async (notes?: string) => {
      const r = await fetch(`/api/logistic/rfq/${rfqId}/close`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ notes }),
      });
      const d = await r.json();
      if (!r.ok) throw new Error(d.message ?? "Gagal menutup RFQ");
      return d;
    },
    onSuccess: () => {
      toast({ title: "RFQ Ditutup", description: "Status RFQ telah diubah ke closed" });
      qc.invalidateQueries({ queryKey: ["rfq-comparison", rfqId] });
      qc.invalidateQueries({ queryKey: ["rfq-list"] });
    },
    onError: (e: Error) => toast({ title: "Gagal", description: e.message, variant: "destructive" }),
  });

  if (isLoading) {
    return (
      <AppShell>
        <div className="flex items-center justify-center h-64">
          <Loader2 className="w-8 h-8 animate-spin text-blue-500" />
        </div>
      </AppShell>
    );
  }

  if (!data) {
    return (
      <AppShell>
        <div className="p-6 text-center text-gray-500">Data tidak ditemukan atau RFQ tidak valid.</div>
      </AppShell>
    );
  }

  const hasSelected = data.stats.selected > 0;
  const isCustomerQuoted = data.rfqStatus === "customer_quoted";
  const isCustomerApproved = data.rfqStatus === "customer_approved";
  const isCustomerRejected = data.rfqStatus === "customer_rejected";
  const isCustomerRevision = data.rfqStatus === "customer_revision_requested";
  const isClosed = data.rfqStatus === "closed";
  const canSendQuote = ["vendor_selected", "customer_revision_requested"].includes(data.rfqStatus);
  const canClose = ["customer_approved", "customer_rejected", "customer_quoted"].includes(data.rfqStatus);
  const canCreateFreight = (isCustomerApproved || isClosed) && !data.freightShipmentId;
  const freightAlreadyCreated = !!data.freightShipmentId;

  const selectedVendorForFreight = data.vendors.find((v) => v.status === "selected");

  const openQuoteDialog = () => {
    const selectedVendor = data.vendors.find((v) => v.status === "selected");
    const vendorPrice = selectedVendor ? (selectedVendor.offeredPrice ?? selectedVendor.basicPrice) : null;
    const suggested = data.finalSellingPrice ?? vendorPrice ?? 0;
    setQuotePrice(data.quotedPrice ? String(data.quotedPrice) : String(suggested));
    setQuoteNotes(data.quoteNotes ?? "");
    setQuoteSendWa(true);
    setQuoteDialog(true);
  };

  return (
    <AppShell>
      <div className="p-4 md:p-6 max-w-7xl mx-auto space-y-6">
        {/* Header */}
        <div className="flex flex-wrap items-start gap-3 justify-between">
          <div className="flex items-center gap-3">
            <Button variant="ghost" size="sm" onClick={() => navigate("/logistics/rfq")}>
              <ArrowLeft className="w-4 h-4 mr-1" /> Kembali
            </Button>
            <div>
              <h1 className="text-xl font-bold text-gray-900">{data.rfqNumber}</h1>
              <p className="text-sm text-gray-500">
                {data.serviceType} · {data.origin} → {data.destination}
                {data.customerName ? ` · ${data.customerName}` : ""}
              </p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <Button
              variant="outline"
              size="sm"
              onClick={() => { setAutoRefresh(p => !p); }}
              className={autoRefresh ? "text-green-600 border-green-300" : ""}
            >
              <RefreshCw className={`w-4 h-4 mr-1 ${autoRefresh ? "animate-spin" : ""}`} style={{ animationDuration: "3s" }} />
              {autoRefresh ? "Auto" : "Manual"}
            </Button>
            <Button variant="outline" size="sm" onClick={() => refetch()}>
              <RefreshCw className="w-4 h-4 mr-1" /> Refresh
            </Button>
          </div>
        </div>

        {/* Stats */}
        <div className="grid grid-cols-2 md:grid-cols-6 gap-3">
          <StatCard label="Total Vendor" value={data.stats.total} icon={<Users className="w-5 h-5 text-gray-500" />} />
          <StatCard label="Sudah Jawab" value={data.stats.answered} icon={<CheckCircle className="w-5 h-5 text-green-500" />} color="green" />
          <StatCard label="Menunggu" value={data.stats.pending} icon={<Clock className="w-5 h-5 text-yellow-500" />} color="yellow" />
          <StatCard label="Counter Offer" value={data.stats.counterOffer} icon={<TrendingDown className="w-5 h-5 text-blue-500" />} color="blue" />
          <StatCard label="Tolak" value={data.stats.rejected} icon={<XCircle className="w-5 h-5 text-red-500" />} color="red" />
          <StatCard label="Dipilih" value={data.stats.selected} icon={<Star className="w-5 h-5 text-teal-500" />} color="teal" />
        </div>

        {/* Banner: RFQ sudah ditutup */}
        {isClosed && (
          <div className="bg-gray-50 border border-gray-200 rounded-xl p-4 flex flex-wrap items-center justify-between gap-3">
            <div className="flex items-center gap-3">
              <Lock className="w-4 h-4 text-gray-500 flex-shrink-0" />
              <div className="text-sm text-gray-600">
                <span className="font-semibold text-gray-800">RFQ telah ditutup.</span>{" "}
                Semua aktivitas untuk RFQ ini sudah selesai.
              </div>
            </div>
            {freightAlreadyCreated ? (
              <Button
                size="sm"
                variant="outline"
                className="text-xs border-blue-300 text-blue-700 hover:bg-blue-50"
                onClick={() => navigate(`/logistics/freight/${data.freightShipmentId}`)}
              >
                <Package className="w-3.5 h-3.5 mr-1" />
                Lihat Freight Shipment
              </Button>
            ) : (
              <Button
                size="sm"
                variant="outline"
                className="text-xs border-teal-300 text-teal-700 hover:bg-teal-50"
                onClick={() => setFreightConfirmDialog(true)}
                disabled={createFreightMut.isPending}
              >
                {createFreightMut.isPending
                  ? <Loader2 className="w-3.5 h-3.5 animate-spin mr-1" />
                  : <Package className="w-3.5 h-3.5 mr-1" />}
                Buat Freight Shipment
              </Button>
            )}
          </div>
        )}

        {/* Banner: customer approved */}
        {isCustomerApproved && (
          <div className="bg-green-50 border border-green-200 rounded-xl p-4 space-y-3">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div className="flex items-center gap-2 text-green-800 font-semibold text-sm">
                <ThumbsUp className="w-4 h-4 flex-shrink-0" />
                Customer menyetujui penawaran ini
              </div>
              <div className="flex flex-wrap items-center gap-2">
                {freightAlreadyCreated ? (
                  <Button
                    size="sm"
                    className="text-xs bg-blue-600 hover:bg-blue-700 text-white"
                    onClick={() => navigate(`/logistics/freight/${data.freightShipmentId}`)}
                  >
                    <Package className="w-3.5 h-3.5 mr-1" />
                    Lihat Freight Shipment
                  </Button>
                ) : (
                  <Button
                    size="sm"
                    className="text-xs bg-teal-600 hover:bg-teal-700 text-white"
                    onClick={() => setFreightConfirmDialog(true)}
                    disabled={createFreightMut.isPending}
                  >
                    {createFreightMut.isPending
                      ? <Loader2 className="w-3.5 h-3.5 animate-spin mr-1" />
                      : <Package className="w-3.5 h-3.5 mr-1" />}
                    Buat Freight Shipment
                  </Button>
                )}
                <Button
                  size="sm"
                  className="text-xs bg-green-700 hover:bg-green-800 text-white"
                  onClick={() => closeMut.mutate("Customer approved")}
                  disabled={closeMut.isPending}
                >
                  {closeMut.isPending ? <Loader2 className="w-3.5 h-3.5 animate-spin mr-1" /> : <Lock className="w-3.5 h-3.5 mr-1" />}
                  Tutup RFQ
                </Button>
              </div>
            </div>
            <div className="grid grid-cols-2 md:grid-cols-3 gap-x-6 gap-y-1 text-xs text-green-900">
              <span>
                <span className="text-green-600">Harga Disetujui:</span>{" "}
                <strong>{idr(data.quotedPrice)}</strong>
                {data.quotedPrice != null && (() => {
                  const rate = 11;
                  const sub = Math.round(data.quotedPrice! * 100 / (100 + rate));
                  const tax = data.quotedPrice! - sub;
                  return (
                    <span className="ml-1 text-[10px] text-green-700 font-normal">
                      (sub {idr(sub)} + PPN {idr(tax)})
                    </span>
                  );
                })()}
              </span>
              <span><span className="text-green-600">Customer:</span> {data.customerName}</span>
              {data.customerRespondedAt && <span><span className="text-green-600">Disetujui:</span> {new Date(data.customerRespondedAt).toLocaleString("id-ID")}</span>}
              {data.customerResponseNotes && <span className="col-span-2"><span className="text-green-600">Catatan Customer:</span> {data.customerResponseNotes}</span>}
            </div>
          </div>
        )}

        {/* Banner: customer rejected */}
        {isCustomerRejected && (
          <div className="bg-red-50 border border-red-200 rounded-xl p-4 space-y-2">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div className="flex items-center gap-2 text-red-800 font-semibold text-sm">
                <ThumbsDown className="w-4 h-4 flex-shrink-0" />
                Customer menolak penawaran ini
              </div>
              <Button
                size="sm"
                variant="outline"
                className="text-xs border-red-300 text-red-700 hover:bg-red-50"
                onClick={() => closeMut.mutate("Customer rejected")}
                disabled={closeMut.isPending}
              >
                {closeMut.isPending ? <Loader2 className="w-3.5 h-3.5 animate-spin mr-1" /> : <Lock className="w-3.5 h-3.5 mr-1" />}
                Tutup RFQ
              </Button>
            </div>
            <div className="text-xs text-red-900 space-y-0.5">
              {data.customerRespondedAt && <p><span className="text-red-600">Ditolak:</span> {new Date(data.customerRespondedAt).toLocaleString("id-ID")}</p>}
              {data.customerResponseNotes && <p><span className="text-red-600">Alasan:</span> {data.customerResponseNotes}</p>}
            </div>
          </div>
        )}

        {/* Banner: customer minta revisi */}
        {isCustomerRevision && (
          <div className="bg-yellow-50 border border-yellow-200 rounded-xl p-4 space-y-2">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div className="flex items-center gap-2 text-yellow-800 font-semibold text-sm">
                <RotateCcw className="w-4 h-4 flex-shrink-0" />
                Customer meminta revisi penawaran
              </div>
              <Button
                size="sm"
                className="bg-purple-600 hover:bg-purple-700 text-white text-xs"
                onClick={openQuoteDialog}
              >
                <Send className="w-3.5 h-3.5 mr-1" /> Kirim Ulang Penawaran
              </Button>
            </div>
            <div className="text-xs text-yellow-900 space-y-0.5">
              {data.customerRespondedAt && <p><span className="text-yellow-600">Diminta:</span> {new Date(data.customerRespondedAt).toLocaleString("id-ID")}</p>}
              {data.customerResponseNotes && <p><span className="text-yellow-600">Catatan revisi:</span> {data.customerResponseNotes}</p>}
            </div>
          </div>
        )}

        {/* Banner: penawaran sudah terkirim ke customer */}
        {isCustomerQuoted && (
          <div className="bg-cyan-50 border border-cyan-200 rounded-xl p-4 space-y-2">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div className="flex items-center gap-2 text-cyan-800 font-semibold text-sm">
                <Send className="w-4 h-4 flex-shrink-0" />
                Penawaran sudah terkirim ke customer
              </div>
              <Button size="sm" variant="outline" className="text-xs border-cyan-300 text-cyan-700" onClick={openQuoteDialog}>
                <Eye className="w-3.5 h-3.5 mr-1" />Lihat / Kirim Ulang
              </Button>
            </div>
            <div className="grid grid-cols-2 md:grid-cols-3 gap-x-6 gap-y-1 text-xs text-cyan-900">
              <span><span className="text-cyan-600">Harga Jual:</span> <strong>{idr(data.quotedPrice)}</strong></span>
              <span><span className="text-cyan-600">Customer:</span> {data.customerName}</span>
              {data.customerPhone && <span><span className="text-cyan-600">WA:</span> {data.customerPhone}</span>}
              {data.quotedAt && <span><span className="text-cyan-600">Dikirim:</span> {new Date(data.quotedAt).toLocaleString("id-ID")}</span>}
              {data.quoteNotes && <span className="col-span-2"><span className="text-cyan-600">Catatan:</span> {data.quoteNotes}</span>}
            </div>
          </div>
        )}

        {/* Banner: vendor dipilih, siap kirim penawaran ke customer */}
        {canSendQuote && (
          <div className="bg-teal-50 border border-teal-200 rounded-xl p-3 flex flex-wrap items-center justify-between gap-3">
            <div className="flex items-center gap-2 text-teal-800 text-sm">
              <CheckCircle className="w-4 h-4 flex-shrink-0" />
              Vendor sudah dipilih. Sekarang kirim penawaran harga ke customer.
            </div>
            <Button
              size="sm"
              className="bg-purple-600 hover:bg-purple-700 text-white text-xs"
              onClick={openQuoteDialog}
            >
              <Send className="w-3.5 h-3.5 mr-1.5" /> Kirim Penawaran ke Customer
            </Button>
          </div>
        )}

        {/* ── Truck Assignment Section ── */}
        {data.stats.total > 0 && (
          <div className="border border-orange-200 rounded-xl overflow-hidden">
            {/* Header */}
            <button
              className="w-full flex items-center justify-between p-3 bg-orange-50 hover:bg-orange-100 transition-colors"
              onClick={() => data.productApproved && setTruckPanelOpen(p => !p)}
            >
              <div className="flex items-center gap-2">
                <Truck className="w-4 h-4 text-orange-600" />
                <span className="font-semibold text-sm text-orange-900">Assign Vendor Truk</span>
                {data.productApproved ? (
                  data.truckVendorName ? (
                    <span className="ml-1 inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium bg-green-100 text-green-800">
                      ✓ {data.truckVendorName}
                      <span className="text-green-600 font-normal">· {data.truckSource === "internal" ? "Internal" : "Eksternal"}</span>
                    </span>
                  ) : (
                    <span className="ml-1 px-2 py-0.5 rounded-full text-xs bg-orange-100 text-orange-700">Belum diassign</span>
                  )
                ) : (
                  <span className="ml-1 px-2 py-0.5 rounded-full text-xs bg-slate-100 text-slate-500">Menunggu vendor produk disetujui</span>
                )}
              </div>
              {data.productApproved && (
                <ChevronDown className={`w-4 h-4 text-orange-500 transition-transform ${truckPanelOpen ? "rotate-180" : ""}`} />
              )}
            </button>

            {/* Not approved yet → info message */}
            {!data.productApproved && (
              <div className="px-4 py-3 border-t border-orange-100 bg-amber-50 text-sm text-amber-700 flex items-center gap-2">
                <span>⏳</span>
                <span>Panel truk akan muncul setelah vendor produk disetujui.</span>
              </div>
            )}

            {/* Current total summary (only when approved) */}
            {data.productApproved && (data.productPrice != null || data.truckPrice != null) && (
              <div className="px-4 py-2 bg-orange-50/50 border-t border-orange-100 flex flex-wrap gap-4 text-xs">
                <span>
                  <span className="text-muted-foreground">Harga Produk:</span>{" "}
                  <strong>{data.productPrice != null ? idr(data.productPrice) : "—"}</strong>
                </span>
                <span>+</span>
                <span>
                  <span className="text-muted-foreground">Harga Truk:</span>{" "}
                  <strong>{data.truckPrice != null ? idr(data.truckPrice) : "—"}</strong>
                </span>
                <span>=</span>
                <span>
                  <span className="text-muted-foreground">Total:</span>{" "}
                  <strong className="text-orange-800">{data.totalPrice != null ? idr(data.totalPrice) : "—"}</strong>
                </span>
              </div>
            )}

            {/* Form panel (only when approved) */}
            {data.productApproved && truckPanelOpen && (
              <div className="p-4 border-t border-orange-200 space-y-4 bg-white">
                {/* Source selector */}
                <div className="flex gap-2">
                  <button
                    type="button"
                    onClick={() => setTruckSourceSel("internal")}
                    className={`flex-1 py-2 px-3 rounded-lg text-sm font-medium border transition-colors ${
                      truckSourceSel === "internal"
                        ? "bg-orange-600 text-white border-orange-600"
                        : "bg-white text-gray-700 border-gray-200 hover:border-orange-300"
                    }`}
                  >
                    🚛 Truk Internal
                  </button>
                  <button
                    type="button"
                    onClick={() => setTruckSourceSel("external")}
                    className={`flex-1 py-2 px-3 rounded-lg text-sm font-medium border transition-colors ${
                      truckSourceSel === "external"
                        ? "bg-blue-600 text-white border-blue-600"
                        : "bg-white text-gray-700 border-gray-200 hover:border-blue-300"
                    }`}
                  >
                    🏢 Truk Eksternal
                  </button>
                </div>

                {truckSourceSel === "internal" ? (
                  <div className="space-y-3">
                    {data.selectedVendorTruckInfo?.hasInternalTruck ? (
                      <div className="flex items-center justify-between p-3 rounded-lg bg-orange-50 border border-orange-200">
                        <div>
                          <p className="text-sm font-medium text-orange-900">Truk internal vendor produk tersedia</p>
                          <p className="text-xs text-orange-600 mt-0.5">
                            Harga: <strong>{idr(data.selectedVendorTruckInfo.internalTruckPrice)}</strong>
                          </p>
                        </div>
                        <span className="text-lg">🚛</span>
                      </div>
                    ) : (
                      <div className="p-3 rounded-lg bg-yellow-50 border border-yellow-200 text-sm text-yellow-800">
                        ⚠️ Vendor produk yang dipilih tidak memiliki truk internal. Gunakan opsi Truk Eksternal.
                      </div>
                    )}
                    {/* Live total preview */}
                    {data.selectedVendorTruckInfo?.hasInternalTruck && (() => {
                      const prodP = data.productPrice ?? (data.vendors.find(v => v.status === "selected")?.offeredPrice ?? data.vendors.find(v => v.status === "selected")?.basicPrice ?? 0);
                      const truckP = data.selectedVendorTruckInfo.internalTruckPrice ?? 0;
                      return (
                        <div className="text-xs text-muted-foreground flex gap-3 flex-wrap px-1">
                          <span>Produk: <strong>{idr(prodP)}</strong></span>
                          <span>+ Truk: <strong>{idr(truckP)}</strong></span>
                          <span>= Total: <strong className="text-orange-700">{idr(Number(prodP) + truckP)}</strong></span>
                        </div>
                      );
                    })()}
                  </div>
                ) : (
                  <div className="space-y-3">
                    <div className="grid gap-1.5">
                      <label className="text-sm font-medium">Vendor Truk Eksternal</label>
                      <Select value={truckVendorSel} onValueChange={setTruckVendorSel}>
                        <SelectTrigger>
                          <SelectValue placeholder="Pilih vendor truk..." />
                        </SelectTrigger>
                        <SelectContent>
                          {data.truckVendors.length === 0 ? (
                            <SelectItem value="__none__" disabled>Tidak ada vendor truk aktif</SelectItem>
                          ) : data.truckVendors.map(tv => (
                            <SelectItem key={tv.id} value={String(tv.id)}>
                              {tv.name}
                              {tv.hasInternalTruck && tv.internalTruckPrice != null && (
                                <span className="ml-2 text-xs text-muted-foreground">
                                  (int. {idr(tv.internalTruckPrice)})
                                </span>
                              )}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>
                    <div className="grid gap-1.5">
                      <label className="text-sm font-medium">Harga Truk (Rp)</label>
                      <Input
                        type="number"
                        min="0"
                        placeholder="0"
                        value={truckPriceInput}
                        onChange={e => setTruckPriceInput(e.target.value)}
                      />
                    </div>
                    {/* Live total preview */}
                    {truckPriceInput && Number(truckPriceInput) > 0 && (() => {
                      const prodP = data.productPrice ?? (data.vendors.find(v => v.status === "selected")?.offeredPrice ?? data.vendors.find(v => v.status === "selected")?.basicPrice ?? 0);
                      const truckP = Number(truckPriceInput);
                      return (
                        <div className="text-xs text-muted-foreground flex gap-3 flex-wrap px-1">
                          <span>Produk: <strong>{idr(prodP)}</strong></span>
                          <span>+ Truk: <strong>{idr(truckP)}</strong></span>
                          <span>= Total: <strong className="text-blue-700">{idr(Number(prodP) + truckP)}</strong></span>
                        </div>
                      );
                    })()}
                  </div>
                )}

                <Button
                  onClick={handleAssignTruck}
                  disabled={assignTruckMut.isPending || (truckSourceSel === "internal" && !data.selectedVendorTruckInfo?.hasInternalTruck)}
                  className="w-full"
                  size="sm"
                >
                  {assignTruckMut.isPending ? <Loader2 className="w-4 h-4 animate-spin mr-2" /> : <Truck className="w-4 h-4 mr-2" />}
                  {data.truckVendorName ? "Ubah Vendor Truk" : "Tetapkan Vendor Truk"}
                </Button>
              </div>
            )}
          </div>
        )}

        {/* ── Per-Item Comparison (Step 12) ── */}
        {data.orderItems && data.orderItems.length > 0 && (
          <div className="border border-indigo-200 rounded-xl overflow-hidden">
            <button
              className="w-full flex items-center justify-between p-3 bg-indigo-50 hover:bg-indigo-100 transition-colors"
              onClick={() => setPerItemTab(p => !p)}
            >
              <div className="flex items-center gap-2">
                <Package className="w-4 h-4 text-indigo-600" />
                <span className="font-semibold text-sm text-indigo-900">Perbandingan Per-Item & Markup</span>
                {data.vendorItemOffers && data.vendorItemOffers.length > 0 && (
                  <span className="ml-1 px-2 py-0.5 rounded-full text-xs bg-indigo-100 text-indigo-700">
                    {data.vendorItemOffers.length} penawaran
                  </span>
                )}
              </div>
              <ChevronDown className={`w-4 h-4 text-indigo-500 transition-transform ${perItemTab ? "rotate-180" : ""}`} />
            </button>

            {perItemTab && (
              <div className="p-4 border-t border-indigo-200 space-y-4 bg-white overflow-x-auto">
                {data.orderItems.map(item => {
                  const offers = (data.vendorItemOffers ?? []).filter(o =>
                    o.orderItemId === item.id || o.serviceName === item.serviceName
                  );

                  const sel = itemSelections[item.id];
                  const selectedOffer = sel ? offers.find(o => o.vendorId === sel.vendorId) : null;
                  const markupPct = sel ? (parseFloat(sel.markup || "0") || 0) : 0;
                  const basePrice = selectedOffer?.offeredPrice ?? null;
                  const withMarkup = basePrice != null ? basePrice * (1 + markupPct / 100) : null;
                  const withPpn = withMarkup != null && sel?.ppnIncluded
                    ? Math.round(withMarkup * 1.11) : withMarkup;

                  return (
                    <div key={item.id} className="border border-gray-100 rounded-lg overflow-hidden">
                      <div className="bg-gray-50 px-3 py-2 flex items-center gap-2">
                        <span className="font-semibold text-sm text-gray-800">{item.serviceName || item.category}</span>
                        <span className="text-xs text-gray-400">{item.qty} {item.unit}</span>
                      </div>
                      {offers.length === 0 ? (
                        <p className="px-3 py-2 text-xs text-gray-400 italic">Belum ada penawaran per-item untuk item ini</p>
                      ) : (
                        <table className="w-full text-xs">
                          <thead className="bg-gray-50">
                            <tr>
                              <th className="text-left px-3 py-1.5 text-gray-500 font-medium">Vendor</th>
                              <th className="text-right px-3 py-1.5 text-gray-500 font-medium">Harga/Unit</th>
                              <th className="text-right px-3 py-1.5 text-gray-500 font-medium">Subtotal</th>
                              <th className="text-center px-3 py-1.5 text-gray-500 font-medium">ETA</th>
                              <th className="text-center px-3 py-1.5 text-gray-500 font-medium">Currency</th>
                              <th className="text-center px-3 py-1.5 text-gray-500 font-medium">Pilih</th>
                            </tr>
                          </thead>
                          <tbody>
                            {offers.map(offer => {
                              const vName = data.vendors.find(v => v.vendorId === offer.vendorId)?.vendorName ?? `Vendor ${offer.vendorId}`;
                              const isSelected = sel?.vendorId === offer.vendorId;
                              const subtotal = offer.offeredPrice != null ? offer.offeredPrice * item.qty : null;
                              return (
                                <tr key={offer.id} className={`border-t border-gray-50 ${isSelected ? "bg-indigo-50" : "hover:bg-gray-50"}`}>
                                  <td className="px-3 py-2 font-medium text-gray-800">{vName}</td>
                                  <td className="px-3 py-2 text-right text-green-700 font-semibold">{offer.offeredPrice != null ? idr(offer.offeredPrice) : "—"}</td>
                                  <td className="px-3 py-2 text-right text-gray-700">{subtotal != null ? idr(subtotal) : "—"}</td>
                                  <td className="px-3 py-2 text-center text-gray-500">{offer.scheduleEta ?? offer.scheduleEtd ?? "—"}</td>
                                  <td className="px-3 py-2 text-center"><span className="px-1.5 py-0.5 rounded bg-gray-100 text-gray-600">{offer.currency}</span></td>
                                  <td className="px-3 py-2 text-center">
                                    <input
                                      type="radio"
                                      checked={isSelected}
                                      onChange={() => setItemSelections(prev => ({
                                        ...prev,
                                        [item.id]: { vendorId: offer.vendorId, markup: prev[item.id]?.markup ?? "0", ppnIncluded: prev[item.id]?.ppnIncluded ?? true },
                                      }))}
                                      className="accent-indigo-600"
                                    />
                                  </td>
                                </tr>
                              );
                            })}
                          </tbody>
                        </table>
                      )}
                      {sel && selectedOffer && (
                        <div className="px-3 py-2 bg-indigo-50 border-t border-indigo-100 flex flex-wrap gap-4 items-center text-xs">
                          <span className="text-indigo-700 font-medium">Markup:</span>
                          <input
                            type="number"
                            min="0"
                            step="0.5"
                            value={sel.markup}
                            onChange={e => setItemSelections(prev => ({ ...prev, [item.id]: { ...prev[item.id], markup: e.target.value } }))}
                            className="w-16 border border-indigo-200 rounded px-2 py-0.5 text-xs"
                            placeholder="0"
                          />
                          <span className="text-indigo-500">%</span>
                          <label className="flex items-center gap-1 cursor-pointer">
                            <input
                              type="checkbox"
                              checked={sel.ppnIncluded}
                              onChange={e => setItemSelections(prev => ({ ...prev, [item.id]: { ...prev[item.id], ppnIncluded: e.target.checked } }))}
                              className="accent-indigo-600"
                            />
                            <span className="text-indigo-700">+ PPN 11%</span>
                          </label>
                          <span className="text-gray-500">Harga Jual:</span>
                          <span className="font-bold text-indigo-800">{withPpn != null ? idr(withPpn) : "—"}</span>
                        </div>
                      )}
                    </div>
                  );
                })}

                {/* Build Per-Item Quote button */}
                {Object.keys(itemSelections).length > 0 && canSendQuote && (
                  <div className="pt-2 border-t border-indigo-100">
                    <Button
                      size="sm"
                      className="bg-indigo-600 hover:bg-indigo-700 text-white text-xs"
                      onClick={() => {
                        // Compute total harga jual dari semua item yang dipilih
                        let total = 0;
                        data.orderItems!.forEach(item => {
                          const sel = itemSelections[item.id];
                          if (!sel) return;
                          const offer = (data.vendorItemOffers ?? []).find(o =>
                            o.vendorId === sel.vendorId && (o.orderItemId === item.id || o.serviceName === item.serviceName)
                          );
                          if (!offer?.offeredPrice) return;
                          const markupPct = parseFloat(sel.markup || "0") || 0;
                          const unitWithMarkup = offer.offeredPrice * (1 + markupPct / 100);
                          const unitFinal = sel.ppnIncluded ? unitWithMarkup * 1.11 : unitWithMarkup;
                          total += unitFinal * item.qty;
                        });
                        setQuotePrice(String(Math.round(total)));
                        setQuoteNotes("");
                        setQuoteSendWa(true);
                        setPerItemQuoteDialog(true);
                      }}
                    >
                      <Send className="w-3.5 h-3.5 mr-1.5" /> Buat Penawaran dari Pilihan Per-Item
                    </Button>
                  </div>
                )}
              </div>
            )}
          </div>
        )}

        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          {/* Vendor comparison table */}
          <div className="lg:col-span-2 space-y-3">
            {(data.finalSellingPrice ?? data.quotedPrice) != null && (
              <div className="flex items-center gap-2 px-3 py-2 bg-purple-50 border border-purple-100 rounded-lg text-xs text-purple-800">
                <span className="font-medium">📈 Referensi Margin:</span>
                <span>Harga jual ke customer = <strong>{idr(data.finalSellingPrice ?? data.quotedPrice)}</strong></span>
                <span className="text-purple-500">— margin tiap vendor dihitung terhadap nilai ini</span>
              </div>
            )}
            <div className="flex flex-wrap items-center justify-between gap-2">
              <h2 className="font-semibold text-gray-800">Perbandingan Vendor</h2>
              {data.vendors.length > 1 && (
                <div className="flex items-center gap-1.5 text-xs">
                  <span className="text-gray-500">Urutkan:</span>
                  {(["price", "margin", "leadtime", "stock", "score"] as const).map((key) => {
                    const hasSellingRef = !!(data.finalSellingPrice ?? data.quotedPrice);
                    if (key === "margin" && !hasSellingRef) return null;
                    const labels: Record<string, string> = { price: "💰 Harga", leadtime: "⚡ Lead Time", stock: "📦 Stok", score: "⭐ Score", margin: "📈 Margin" };
                    return (
                      <button
                        key={key}
                        onClick={() => setSortBy(key)}
                        className={`px-2 py-1 rounded border text-xs font-medium transition-colors ${
                          sortBy === key
                            ? "bg-blue-600 text-white border-blue-600"
                            : "bg-white text-gray-600 border-gray-200 hover:border-blue-300"
                        }`}
                      >
                        {labels[key]}
                      </button>
                    );
                  })}
                </div>
              )}
            </div>
            {data.vendors.length === 0 ? (
              <Card>
                <CardContent className="p-8 text-center text-gray-500">
                  <AlertCircle className="w-8 h-8 mx-auto mb-2 text-gray-300" />
                  Belum ada vendor yang di-blast. Kembali ke detail order dan pilih vendor.
                </CardContent>
              </Card>
            ) : (
              (() => {
                const STOCK_ORDER: Record<string, number> = { available: 0, limited: 1, unknown: 2, unavailable: 3 };
                const sorted = [...data.vendors].sort((a, b) => {
                  if (a.status === "rejected" && b.status !== "rejected") return 1;
                  if (b.status === "rejected" && a.status !== "rejected") return -1;
                  if (a.status === "expired" && b.status !== "expired") return 1;
                  if (b.status === "expired" && a.status !== "expired") return -1;
                  if (sortBy === "price") {
                    return (a.offeredPrice ?? a.basicPrice ?? 9e9) - (b.offeredPrice ?? b.basicPrice ?? 9e9);
                  }
                  if (sortBy === "leadtime") {
                    const la = a.leadTimeDays ?? 999;
                    const lb = b.leadTimeDays ?? 999;
                    return la - lb;
                  }
                  if (sortBy === "stock") {
                    return (STOCK_ORDER[a.stockAvailability ?? "unknown"] ?? 2) - (STOCK_ORDER[b.stockAvailability ?? "unknown"] ?? 2);
                  }
                  if (sortBy === "score") {
                    const sa = scoreMap.get(a.vendorId)?.aiScore ?? a.recommendationScore ?? a.vendorRating ?? 0;
                    const sb = scoreMap.get(b.vendorId)?.aiScore ?? b.recommendationScore ?? b.vendorRating ?? 0;
                    return sb - sa;
                  }
                  if (sortBy === "margin") {
                    const ref = data.finalSellingPrice ?? data.quotedPrice ?? 0;
                    const ma = ref - (a.offeredPrice ?? a.basicPrice ?? 0);
                    const mb = ref - (b.offeredPrice ?? b.basicPrice ?? 0);
                    return mb - ma;
                  }
                  return 0;
                });
                const sellingRef = data.finalSellingPrice ?? data.quotedPrice ?? null;
                return sorted.map((v, idx) => (
                  <VendorCard
                    key={v.linkId}
                    vendor={v}
                    rank={idx + 1}
                    rankingBadges={getRankingBadges(v, data.vendors, scoreMap, sellingRef)}
                    aiScore={scoreMap.get(v.vendorId)}
                    allVendors={data.vendors}
                    hasSelected={hasSelected}
                    sellingPriceRef={sellingRef}
                    onSelect={() => {
                      setSelectDialog({ linkId: v.linkId, vendorName: v.vendorName, price: v.offeredPrice ?? v.basicPrice });
                      const _vp = v.offeredPrice ?? v.basicPrice;
                      setSellingPrice(_vp ? String(_vp) : "");
                    }}
                    onRevision={() => { setRevisionDialog({ linkId: v.linkId, vendorName: v.vendorName }); setRevisionMsg(""); }}
                    onReject={() => actionMut.mutate({ linkId: v.linkId, action: "reject" })}
                    onMarkRead={() => actionMut.mutate({ linkId: v.linkId, action: "mark_read" })}
                    onCopyLink={() => copyLink(window.location.origin + v.formUrl.replace(/^https?:\/\/[^/]+/, ""))}
                    onRefreshPrice={() => refreshPriceMut.mutate(v.linkId)}
                    isRefreshingPrice={refreshPriceMut.isPending && refreshPriceMut.variables === v.linkId}
                  />
                ));
              })()
            )}
          </div>

          {/* Activity log */}
          <div className="space-y-3">
            <h2 className="font-semibold text-gray-800">Aktivitas</h2>
            <Card>
              <CardContent className="p-4 space-y-3 max-h-[600px] overflow-y-auto">
                {data.activities.length === 0 ? (
                  <p className="text-sm text-gray-400 text-center py-4">Belum ada aktivitas</p>
                ) : (
                  data.activities.map((a) => (
                    <div key={a.id} className="flex gap-2 text-sm">
                      <div className="w-1.5 h-1.5 rounded-full bg-blue-400 mt-1.5 shrink-0" />
                      <div>
                        <p className="text-gray-700">{a.description ?? a.action}</p>
                        <p className="text-xs text-gray-400">{timeSince(a.createdAt)}</p>
                      </div>
                    </div>
                  ))
                )}
              </CardContent>
            </Card>
          </div>
        </div>
      </div>

      {/* Dialog: Buat Freight Shipment */}
      <Dialog open={freightConfirmDialog} onOpenChange={(o) => !o && setFreightConfirmDialog(false)}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Package className="w-4 h-4 text-teal-600" />
              Buat Freight Shipment Otomatis
            </DialogTitle>
          </DialogHeader>
          <div className="space-y-4 py-1 text-sm">
            <p className="text-gray-600">
              Freight Shipment baru akan dibuat secara otomatis dengan data berikut dari RFQ ini:
            </p>
            <div className="bg-muted/40 rounded-lg p-3 space-y-2">
              <div className="grid grid-cols-2 gap-x-4 gap-y-1.5 text-xs">
                <div>
                  <p className="text-muted-foreground">Pengirim (Shipper)</p>
                  <p className="font-medium text-gray-800">{data.customerName}</p>
                </div>
                <div>
                  <p className="text-muted-foreground">Layanan</p>
                  <p className="font-medium text-gray-800">{data.serviceType}</p>
                </div>
                <div>
                  <p className="text-muted-foreground">Rute</p>
                  <p className="font-medium text-gray-800">{data.origin} → {data.destination}</p>
                </div>
                {data.commodity && (
                  <div>
                    <p className="text-muted-foreground">Komoditi</p>
                    <p className="font-medium text-gray-800">{data.commodity}</p>
                  </div>
                )}
                {selectedVendorForFreight && (
                  <div>
                    <p className="text-muted-foreground">Vendor Terpilih</p>
                    <p className="font-medium text-teal-700">{selectedVendorForFreight.vendorName}</p>
                  </div>
                )}
                {selectedVendorForFreight && (
                  <div>
                    <p className="text-muted-foreground">Harga Vendor</p>
                    <p className="font-medium text-gray-800">
                      {idr(selectedVendorForFreight.offeredPrice ?? selectedVendorForFreight.basicPrice)}
                    </p>
                  </div>
                )}
                {data.quotedPrice && (
                  <div>
                    <p className="text-muted-foreground">Harga Jual ke Customer</p>
                    <p className="font-medium text-green-700">{idr(data.quotedPrice)}</p>
                  </div>
                )}
                {selectedVendorForFreight?.eta && (
                  <div>
                    <p className="text-muted-foreground">ETA Vendor</p>
                    <p className="font-medium text-gray-800">{selectedVendorForFreight.eta}</p>
                  </div>
                )}
              </div>
            </div>
            <p className="text-xs text-muted-foreground">
              Setelah dibuat, Anda akan diarahkan ke halaman detail Freight Shipment untuk melengkapi data seperti vessel, B/L, dan dokumen lainnya.
            </p>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setFreightConfirmDialog(false)}>Batal</Button>
            <Button
              className="bg-teal-600 hover:bg-teal-700"
              onClick={() => createFreightMut.mutate()}
              disabled={createFreightMut.isPending}
            >
              {createFreightMut.isPending
                ? <><Loader2 className="w-4 h-4 mr-2 animate-spin" />Membuat...</>
                : <><Package className="w-4 h-4 mr-1.5" />Buat Freight Sekarang</>}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Select vendor dialog */}
      <Dialog open={!!selectDialog} onOpenChange={(o) => !o && setSelectDialog(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Pilih Vendor</DialogTitle>
          </DialogHeader>
          {selectDialog && (
            <div className="space-y-4 py-2">
              <p className="text-sm text-gray-600">
                Anda akan memilih <strong>{selectDialog.vendorName}</strong> sebagai vendor untuk RFQ ini.
                Harga vendor: <strong>{idr(selectDialog.price)}</strong>
              </p>
              <div>
                <Label>Harga Jual ke Customer (opsional)</Label>
                <Input
                  type="number"
                  placeholder="Kosongkan jika belum ditentukan"
                  value={sellingPrice}
                  onChange={(e) => setSellingPrice(e.target.value)}
                  className="mt-1"
                />
              </div>
            </div>
          )}
          <DialogFooter>
            <Button variant="outline" onClick={() => setSelectDialog(null)}>Batal</Button>
            <Button
              onClick={() => selectMut.mutate({
                linkId: selectDialog!.linkId,
                sellingPrice: sellingPrice ? Number(sellingPrice) : undefined,
              })}
              disabled={selectMut.isPending}
            >
              {selectMut.isPending ? <Loader2 className="w-4 h-4 animate-spin mr-1" /> : <Star className="w-4 h-4 mr-1" />}
              Pilih Vendor Ini
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Revision dialog */}
      <Dialog open={!!revisionDialog} onOpenChange={(o) => !o && setRevisionDialog(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Minta Revisi</DialogTitle>
          </DialogHeader>
          {revisionDialog && (
            <div className="space-y-4 py-2">
              <p className="text-sm text-gray-600">Kirim pesan revisi ke <strong>{revisionDialog.vendorName}</strong> via WhatsApp.</p>
              <div>
                <Label>Catatan untuk Vendor</Label>
                <Textarea
                  placeholder="Contoh: Mohon review ulang harga, ada perubahan rute..."
                  value={revisionMsg}
                  onChange={(e) => setRevisionMsg(e.target.value)}
                  className="mt-1"
                />
              </div>
            </div>
          )}
          <DialogFooter>
            <Button variant="outline" onClick={() => setRevisionDialog(null)}>Batal</Button>
            <Button
              onClick={() => actionMut.mutate({ linkId: revisionDialog!.linkId, action: "request_revision", message: revisionMsg })}
              disabled={actionMut.isPending}
            >
              <MessageCircle className="w-4 h-4 mr-1" /> Kirim via WA
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Dialog: Kirim Penawaran ke Customer */}
      <Dialog open={quoteDialog} onOpenChange={(o) => !o && setQuoteDialog(false)}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Send className="w-4 h-4 text-purple-600" />
              {isCustomerQuoted ? "Lihat / Kirim Ulang Penawaran" : "Kirim Penawaran ke Customer"}
            </DialogTitle>
          </DialogHeader>
          <div className="space-y-4 py-1">
            {/* Info customer & order */}
            <div className="bg-muted/40 rounded-lg p-3 text-sm space-y-1.5">
              <div className="font-semibold text-gray-800">{data.customerName}</div>
              <div className="text-xs text-muted-foreground grid grid-cols-2 gap-x-4 gap-y-1">
                <span>📦 {data.serviceType}</span>
                <span>📄 {data.orderNumber}</span>
                <span className="col-span-2">🗺 {data.origin} → {data.destination}</span>
                {data.customerPhone && (
                  <span className="col-span-2 flex items-center gap-1">
                    <Phone className="w-3 h-3" />{data.customerPhone}
                  </span>
                )}
              </div>
            </div>

            {/* Vendor yang dipilih */}
            {(() => {
              const sv = data.vendors.find((v) => v.status === "selected");
              if (!sv) return null;
              const vp = sv.offeredPrice ?? sv.basicPrice;
              return (
                <div className="bg-teal-50 border border-teal-200 rounded-lg p-3 text-xs space-y-1">
                  <p className="font-semibold text-teal-800 text-sm">Vendor Terpilih: {sv.vendorName}</p>
                  <div className="text-teal-700 grid grid-cols-2 gap-x-4">
                    <span>Harga Vendor: <strong>{idr(vp)}</strong></span>
                    {sv.eta && <span>ETA: {sv.eta}</span>}
                  </div>
                </div>
              );
            })()}

            <Separator />

            {/* Harga jual ke customer */}
            <div className="space-y-1.5">
              <Label className="flex items-center gap-1.5">
                <DollarSign className="w-3.5 h-3.5 text-purple-600" />
                Harga Jual ke Customer <span className="text-red-500">*</span>
              </Label>
              <Input
                type="number"
                placeholder="Masukkan harga jual..."
                value={quotePrice}
                onChange={(e) => setQuotePrice(e.target.value)}
                className="font-mono"
              />
              {quotePrice && Number(quotePrice) > 0 && (
                <p className="text-xs text-muted-foreground">{idr(Number(quotePrice))}</p>
              )}
              {(() => {
                const sv = data.vendors.find((v) => v.status === "selected");
                const vp = sv ? (sv.offeredPrice ?? sv.basicPrice) : null;
                const sp = Number(quotePrice);
                if (vp && sp > 0) {
                  const margin = ((sp - vp) / vp * 100).toFixed(1);
                  const marginNum = parseFloat(margin);
                  return (
                    <p className={`text-xs font-medium ${marginNum >= 0 ? "text-green-700" : "text-red-600"}`}>
                      Margin: {margin}% ({idr(sp - vp)})
                    </p>
                  );
                }
                return null;
              })()}
            </div>

            {/* Catatan untuk customer */}
            <div className="space-y-1.5">
              <Label>Catatan (opsional)</Label>
              <Textarea
                placeholder="Catatan tambahan untuk customer, syarat, dll..."
                value={quoteNotes}
                onChange={(e) => setQuoteNotes(e.target.value)}
                rows={2}
                className="text-sm"
              />
            </div>

            {/* Kirim via WA */}
            <div className="flex items-center gap-2">
              <Checkbox
                id="send-wa"
                checked={quoteSendWa}
                onCheckedChange={(v) => setQuoteSendWa(!!v)}
              />
              <label htmlFor="send-wa" className="text-sm cursor-pointer">
                Kirim notifikasi via WhatsApp ke customer
                {!data.customerPhone && (
                  <span className="ml-1 text-xs text-orange-600">(No. WA tidak tersedia)</span>
                )}
              </label>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setQuoteDialog(false)}>Batal</Button>
            <Button
              onClick={() => sendQuoteMut.mutate(undefined as any)}
              disabled={!quotePrice || Number(quotePrice) <= 0 || sendQuoteMut.isPending}
              className="bg-purple-600 hover:bg-purple-700"
            >
              {sendQuoteMut.isPending
                ? <><Loader2 className="w-4 h-4 mr-2 animate-spin" />Mengirim...</>
                : <><Send className="w-4 h-4 mr-1.5" />{isCustomerQuoted ? "Kirim Ulang" : "Kirim Penawaran"}</>
              }
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Dialog: Per-Item Quote (Step 12) */}
      <Dialog open={perItemQuoteDialog} onOpenChange={(o) => !o && setPerItemQuoteDialog(false)}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Package className="w-4 h-4 text-indigo-600" />
              Kirim Penawaran Per-Item ke Customer
            </DialogTitle>
          </DialogHeader>
          <div className="space-y-4 py-1">
            {/* Preview per-item breakdown */}
            <div className="bg-indigo-50 border border-indigo-100 rounded-lg p-3 space-y-1.5 text-xs">
              <p className="font-semibold text-indigo-800 text-sm mb-2">Rincian Harga Item</p>
              {(data.orderItems ?? []).map(item => {
                const sel = itemSelections[item.id];
                if (!sel) return <div key={item.id} className="text-gray-400 italic">{item.serviceName}: tidak dipilih</div>;
                const offer = (data.vendorItemOffers ?? []).find(o =>
                  o.vendorId === sel.vendorId && (o.orderItemId === item.id || o.serviceName === item.serviceName)
                );
                const vName = data.vendors.find(v => v.vendorId === sel.vendorId)?.vendorName ?? "-";
                const mp = parseFloat(sel.markup || "0") || 0;
                const base = offer?.offeredPrice ?? 0;
                const withMkp = base * (1 + mp / 100);
                const final = sel.ppnIncluded ? Math.round(withMkp * 1.11) : Math.round(withMkp);
                return (
                  <div key={item.id} className="flex justify-between items-center">
                    <span className="text-gray-700">{item.serviceName}</span>
                    <span className="text-right text-indigo-800 font-medium">
                      {item.qty} × {idr(final)} = <strong>{idr(final * item.qty)}</strong>
                      <span className="text-gray-400 font-normal ml-1">via {vName}</span>
                    </span>
                  </div>
                );
              })}
              <div className="pt-1.5 border-t border-indigo-200 flex justify-between font-bold text-indigo-900">
                <span>Total</span>
                <span>{idr(Number(quotePrice))}</span>
              </div>
            </div>

            <div className="space-y-1.5">
              <Label className="flex items-center gap-1.5">
                <DollarSign className="w-3.5 h-3.5 text-indigo-600" />
                Total Harga Jual ke Customer <span className="text-red-500">*</span>
              </Label>
              <Input
                type="number"
                placeholder="Total harga jual..."
                value={quotePrice}
                onChange={(e) => setQuotePrice(e.target.value)}
                className="font-mono"
              />
              {quotePrice && Number(quotePrice) > 0 && (
                <p className="text-xs text-muted-foreground">{idr(Number(quotePrice))}</p>
              )}
            </div>
            <div className="space-y-1.5">
              <Label>Catatan (opsional)</Label>
              <Textarea
                placeholder="Catatan tambahan untuk customer..."
                value={quoteNotes}
                onChange={(e) => setQuoteNotes(e.target.value)}
                rows={2}
                className="text-sm"
              />
            </div>
            <div className="flex items-center gap-2">
              <Checkbox
                id="per-item-send-wa"
                checked={quoteSendWa}
                onCheckedChange={(v) => setQuoteSendWa(!!v)}
              />
              <label htmlFor="per-item-send-wa" className="text-sm cursor-pointer">
                Kirim notifikasi via WhatsApp ke customer
              </label>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setPerItemQuoteDialog(false)}>Batal</Button>
            <Button
              onClick={() => {
                // Build priceItems from selections
                const priceItems = (data.orderItems ?? []).flatMap(item => {
                  const sel = itemSelections[item.id];
                  if (!sel) return [];
                  const offer = (data.vendorItemOffers ?? []).find(o =>
                    o.vendorId === sel.vendorId && (o.orderItemId === item.id || o.serviceName === item.serviceName)
                  );
                  const mp = parseFloat(sel.markup || "0") || 0;
                  const base = offer?.offeredPrice ?? 0;
                  const withMkp = base * (1 + mp / 100);
                  const unitPrice = Math.round(sel.ppnIncluded ? withMkp * 1.11 : withMkp);
                  return [{
                    name: item.serviceName,
                    qty: item.qty,
                    unit: item.unit,
                    unitPrice,
                    subtotal: unitPrice * item.qty,
                  }];
                });
                sendQuoteMut.mutate({ priceItems });
                setPerItemQuoteDialog(false);
              }}
              disabled={!quotePrice || Number(quotePrice) <= 0 || sendQuoteMut.isPending}
              className="bg-indigo-600 hover:bg-indigo-700"
            >
              {sendQuoteMut.isPending
                ? <><Loader2 className="w-4 h-4 mr-2 animate-spin" />Mengirim...</>
                : <><Send className="w-4 h-4 mr-1.5" />Kirim Penawaran</>
              }
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </AppShell>
  );
}

function StatCard({ label, value, icon, color }: {
  label: string; value: number; icon: React.ReactNode;
  color?: "green" | "yellow" | "blue" | "red" | "teal";
}) {
  const bg = color ? {
    green: "bg-green-50", yellow: "bg-yellow-50", blue: "bg-blue-50",
    red: "bg-red-50", teal: "bg-teal-50",
  }[color] : "bg-gray-50";
  return (
    <Card className={`${bg} border-0`}>
      <CardContent className="p-3 flex flex-col gap-1">
        <div className="flex items-center justify-between">
          {icon}
          <span className="text-2xl font-bold text-gray-800">{value}</span>
        </div>
        <p className="text-xs text-gray-500">{label}</p>
      </CardContent>
    </Card>
  );
}

function DimBar({ label, pct, color }: { label: string; pct: number; color: string }) {
  return (
    <div className="flex items-center gap-1.5 text-xs">
      <span className="w-16 text-gray-400 shrink-0 truncate">{label}</span>
      <div className="flex-1 bg-gray-100 rounded-full h-1.5 overflow-hidden">
        <div className={`h-1.5 rounded-full ${color}`} style={{ width: `${Math.max(4, Math.min(100, pct))}%` }} />
      </div>
      <span className="w-7 text-right text-gray-500 font-mono">{Math.round(pct)}</span>
    </div>
  );
}

function VendorCard({
  vendor, rank, rankingBadges, aiScore, allVendors, hasSelected, sellingPriceRef, onSelect, onRevision, onReject, onMarkRead, onCopyLink, onRefreshPrice, isRefreshingPrice,
}: {
  vendor: VendorRow; rank: number; rankingBadges?: RankingBadge[]; aiScore?: VendorAiScore;
  allVendors: VendorRow[]; hasSelected: boolean; sellingPriceRef: number | null;
  onSelect: () => void; onRevision: () => void;
  onReject: () => void; onMarkRead: () => void; onCopyLink: () => void;
  onRefreshPrice: () => void; isRefreshingPrice?: boolean;
}) {
  const isSelected = vendor.status === "selected";
  const canAct = !hasSelected && !["rejected", "expired", "not_selected"].includes(vendor.status);
  const hasAnswer = !!vendor.submittedAt;
  const price = vendor.offeredPrice ?? vendor.basicPrice;

  // Margin computation vs selling price reference
  const marginRp = (sellingPriceRef != null && sellingPriceRef > 0 && price != null)
    ? sellingPriceRef - price : null;
  const marginPct = (marginRp != null && sellingPriceRef != null && sellingPriceRef > 0)
    ? (marginRp / sellingPriceRef) * 100 : null;

  // Compute per-dimension normalized scores (0–100) relative to all answered vendors
  const answered = allVendors.filter(v => v.offeredPrice != null || v.basicPrice != null);
  const dimScores = (() => {
    if (answered.length < 2 || !hasAnswer) return null;
    // Price: lower is better
    const prices = answered.map(v => v.offeredPrice ?? v.basicPrice ?? Infinity).filter(p => p < Infinity);
    const minP = Math.min(...prices); const maxP = Math.max(...prices); const rangeP = maxP - minP || 1;
    const myPrice = price ?? Infinity;
    const priceScore = myPrice < Infinity ? 100 - ((myPrice - minP) / rangeP) * 100 : 0;
    // Lead Time: lower is better
    const lts = answered.filter(v => v.leadTimeDays != null).map(v => v.leadTimeDays!);
    const minLt = lts.length ? Math.min(...lts) : null; const maxLt = lts.length ? Math.max(...lts) : null;
    const ltRange = (minLt != null && maxLt != null) ? (maxLt - minLt || 1) : 1;
    const ltScore = (vendor.leadTimeDays != null && minLt != null)
      ? 100 - ((vendor.leadTimeDays - minLt) / ltRange) * 100 : null;
    // Stock: categorical
    const STOCK_MAP: Record<string, number> = { available: 100, limited: 50, unknown: 30, unavailable: 0 };
    const stockScore = STOCK_MAP[vendor.stockAvailability ?? "unknown"] ?? 30;
    // Rating: higher is better (0–5 → 0–100)
    const ratingScore = vendor.vendorRating != null ? (vendor.vendorRating / 5) * 100 : null;
    // Margin: higher is better (normalized against all vendors' margins)
    let marginScore: number | null = null;
    if (sellingPriceRef != null && sellingPriceRef > 0) {
      const vendorMargins = answered
        .map(v => sellingPriceRef - (v.offeredPrice ?? v.basicPrice ?? sellingPriceRef))
        .filter(m => isFinite(m));
      if (vendorMargins.length >= 2 && price != null) {
        const minM = Math.min(...vendorMargins); const maxM = Math.max(...vendorMargins); const rangeM = maxM - minM || 1;
        const myM = sellingPriceRef - price;
        marginScore = ((myM - minM) / rangeM) * 100;
      }
    }
    return { priceScore, ltScore, stockScore, ratingScore, marginScore };
  })();
  const [showScoreDetail, setShowScoreDetail] = useState(false);

  const tierCfg = aiScore ? AI_TIER[aiScore.tier] : null;

  return (
    <Card className={`transition-all ${isSelected ? "ring-2 ring-teal-400 bg-teal-50/50" : ""} ${vendor.isNewUpdate ? "ring-2 ring-blue-300" : ""}`}>
      <CardContent className="p-4">
        <div className="flex flex-wrap items-start justify-between gap-2 mb-3">
          <div className="flex items-center gap-2">
            <span className="w-6 h-6 rounded-full bg-gray-200 text-gray-600 text-xs font-bold flex items-center justify-center">{rank}</span>
            <div>
              <div className="flex flex-wrap items-center gap-2">
                <span className="font-semibold text-gray-800">{vendor.vendorName}</span>
                {vendor.isNewUpdate && (
                  <Badge className="bg-blue-100 text-blue-700 text-xs animate-pulse">NEW</Badge>
                )}
                {isSelected && <Badge className="bg-teal-100 text-teal-700 text-xs">★ Dipilih</Badge>}
                {rankingBadges?.map((b, i) => (
                  <span key={i} className={`text-xs px-1.5 py-0.5 rounded border font-medium ${b.color}`}>{b.label}</span>
                ))}
                {aiScore && aiScore.badges.map((b, i) => (
                  <span key={`ai-${i}`} className="text-xs px-1.5 py-0.5 rounded border font-medium bg-violet-50 text-violet-700 border-violet-200">{b}</span>
                ))}
              </div>
              {vendor.phone && <p className="text-xs text-gray-400">{vendor.phone}</p>}
            </div>
          </div>
          <div className="flex items-center gap-2">
            {aiScore && tierCfg && (
              <button
                onClick={() => setShowScoreDetail(s => !s)}
                className={`flex items-center gap-1.5 px-2 py-1 rounded-lg border text-xs font-semibold cursor-pointer transition-colors ${tierCfg.bg} ${tierCfg.text} ${tierCfg.border} hover:opacity-80`}
                title="Klik untuk lihat detail AI Score"
              >
                <Brain className="w-3 h-3" />
                AI Score: {aiScore.aiScore.toFixed(0)}
                <span className="opacity-60">
                  {aiScore.dataConfidence === "high" ? "★★" : aiScore.dataConfidence === "medium" ? "★" : aiScore.dataConfidence === "low" ? "·" : ""}
                </span>
              </button>
            )}
            <Badge className={STATUS_COLOR[vendor.status] ?? "bg-gray-100 text-gray-500"}>
              {STATUS_LABEL[vendor.status] ?? vendor.status}
            </Badge>
          </div>
        </div>

        {/* AI Score Detail Panel */}
        {aiScore && showScoreDetail && (
          <div className={`mb-3 rounded-lg border p-2.5 text-xs space-y-1.5 ${tierCfg?.bg ?? "bg-gray-50"} ${tierCfg?.border ?? "border-gray-200"}`}>
            <div className="flex items-center justify-between">
              <span className={`font-semibold flex items-center gap-1 ${tierCfg?.text ?? "text-gray-600"}`}>
                <Brain className="w-3 h-3" /> AI Vendor Score — {aiScore.aiScore.toFixed(1)} / 100
              </span>
              <span className="text-gray-400">
                {aiScore.dataConfidence === "high" ? "Kepercayaan data: Tinggi ★★" :
                 aiScore.dataConfidence === "medium" ? "Kepercayaan data: Sedang ★" :
                 aiScore.dataConfidence === "low" ? "Kepercayaan data: Rendah (data terbatas)" :
                 "Berbasis skor global (belum ada data rute)"}
              </span>
            </div>
            {/* Score bar */}
            <div className="w-full bg-gray-200 rounded-full h-1.5">
              <div
                className={`h-1.5 rounded-full ${tierCfg?.bar ?? "bg-gray-400"}`}
                style={{ width: `${Math.min(100, aiScore.aiScore)}%` }}
              />
            </div>
            <ul className="space-y-0.5 text-gray-600">
              {aiScore.scoreBullets.map((b, i) => (
                <li key={i} className="flex items-start gap-1">
                  <span className="text-gray-400 mt-0.5">›</span>{b}
                </li>
              ))}
            </ul>
          </div>
        )}

        <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-3 text-sm">
          <div>
            <p className="text-xs text-gray-400">Harga Penawaran</p>
            <p className={`font-semibold ${hasAnswer ? "text-gray-900" : "text-gray-400"}`}>{idr(price)}</p>
            {marginRp != null && (
              <p className={`text-xs font-medium mt-0.5 ${marginRp >= 0 ? "text-green-600" : "text-red-600"}`}>
                Margin: {marginPct != null ? `${marginPct.toFixed(1)}%` : "—"} ({marginRp >= 0 ? "+" : ""}{idr(Math.round(marginRp))})
              </p>
            )}
          </div>
          <div>
            <p className="text-xs text-gray-400">Lead Time</p>
            <p className="font-medium text-gray-800">
              {vendor.leadTimeDays != null ? `${vendor.leadTimeDays} hari` : "—"}
            </p>
          </div>
          <div>
            <p className="text-xs text-gray-400">Stok</p>
            {vendor.stockAvailability && vendor.stockAvailability !== "unknown" ? (
              <span className={`inline-flex items-center gap-1 text-xs font-semibold px-2 py-0.5 rounded-full border ${
                vendor.stockAvailability === "available" ? "bg-green-100 text-green-700 border-green-200" :
                vendor.stockAvailability === "limited" ? "bg-yellow-100 text-yellow-700 border-yellow-200" :
                vendor.stockAvailability === "unavailable" ? "bg-red-100 text-red-600 border-red-200" :
                "bg-gray-100 text-gray-500 border-gray-200"
              }`}>
                {vendor.stockAvailability === "available" ? "✓ Tersedia" :
                 vendor.stockAvailability === "limited" ? "⚠ Terbatas" :
                 vendor.stockAvailability === "unavailable" ? "✕ Habis" : "? Tidak Diketahui"}
              </span>
            ) : (
              <p className="font-medium text-gray-400">—</p>
            )}
          </div>
          <div>
            <p className="text-xs text-gray-400">Rating Vendor</p>
            {vendor.vendorRating != null && vendor.vendorRating > 0 ? (
              <div className="flex items-center gap-1">
                <span className="text-yellow-400 text-sm leading-none">
                  {"★".repeat(Math.round(vendor.vendorRating))}{"☆".repeat(5 - Math.round(vendor.vendorRating))}
                </span>
                <span className="text-xs text-gray-500 font-medium">{vendor.vendorRating.toFixed(1)}</span>
              </div>
            ) : vendor.totalOrders != null && vendor.totalOrders > 0 ? (
              <p className="text-xs text-gray-500">{vendor.totalOrders} order</p>
            ) : (
              <p className="font-medium text-gray-400">Baru</p>
            )}
          </div>
        </div>
        <div className="grid grid-cols-3 gap-3 mb-3 text-sm">
          <InfoItem label="ETA" value={vendor.eta ?? "—"} />
          <InfoItem label="Dibuka" value={vendor.openedAt ? timeSince(vendor.openedAt) : "Belum dibuka"} />
          <InfoItem label="Submit" value={vendor.submittedAt ? timeSince(vendor.submittedAt) : "Belum"} />
        </div>

        {dimScores && (
          <div className="mb-3 bg-gray-50 border border-gray-100 rounded-lg px-3 py-2 space-y-1.5">
            <p className="text-xs font-semibold text-gray-400 uppercase tracking-wide mb-1">Skor Perbandingan</p>
            <DimBar label="💰 Harga" pct={dimScores.priceScore} color="bg-green-500" />
            <DimBar label="⚡ Lead Time" pct={dimScores.ltScore ?? 0} color={dimScores.ltScore != null ? "bg-blue-500" : "bg-gray-200"} />
            <DimBar label="📦 Stok" pct={dimScores.stockScore} color="bg-orange-500" />
            <DimBar label="⭐ Rating" pct={dimScores.ratingScore ?? 0} color={dimScores.ratingScore != null ? "bg-yellow-500" : "bg-gray-200"} />
            {dimScores.marginScore != null && (
              <DimBar label="📈 Margin" pct={dimScores.marginScore} color="bg-purple-500" />
            )}
          </div>
        )}

        {vendor.notes && (
          <div className="text-xs bg-gray-50 border border-gray-100 rounded-lg p-2 mb-3 text-gray-600">
            📝 {vendor.notes}
          </div>
        )}
        {vendor.attachmentUrl && (
          <a href={vendor.attachmentUrl} target="_blank" rel="noopener noreferrer"
            className="text-xs text-blue-600 underline flex items-center gap-1 mb-3">
            <ExternalLink className="w-3 h-3" /> Lihat Lampiran
          </a>
        )}

        <div className="flex flex-wrap gap-2 mt-2">
          {vendor.isNewUpdate && (
            <Button variant="ghost" size="sm" className="text-xs h-7" onClick={onMarkRead}>
              Tandai Sudah Baca
            </Button>
          )}
          <Button variant="ghost" size="sm" className="text-xs h-7" onClick={onCopyLink}>
            <Copy className="w-3 h-3 mr-1" /> Salin Link
          </Button>
          <Button
            variant="outline"
            size="sm"
            className="text-xs h-7 text-orange-700 border-orange-300 hover:bg-orange-50"
            onClick={onRefreshPrice}
            disabled={isRefreshingPrice}
            title="Perbarui harga referensi dari katalog etalase vendor terkini"
          >
            {isRefreshingPrice
              ? <Loader2 className="w-3 h-3 mr-1 animate-spin" />
              : <DatabaseZap className="w-3 h-3 mr-1" />}
            Refresh Harga
          </Button>
          {canAct && hasAnswer && (
            <>
              <Button size="sm" className="text-xs h-7 bg-teal-600 hover:bg-teal-700 text-white" onClick={onSelect}>
                <Star className="w-3 h-3 mr-1" /> Pilih
              </Button>
              <Button variant="outline" size="sm" className="text-xs h-7" onClick={onRevision}>
                <MessageCircle className="w-3 h-3 mr-1" /> Revisi
              </Button>
            </>
          )}
          {canAct && !hasAnswer && (
            <Button variant="outline" size="sm" className="text-xs h-7" onClick={onRevision}>
              <MessageCircle className="w-3 h-3 mr-1" /> Ping
            </Button>
          )}
          {canAct && ["accepted_basic_price", "counter_offer"].includes(vendor.status) && (
            <Button variant="ghost" size="sm" className="text-xs h-7 text-red-600 hover:text-red-700" onClick={onReject}>
              <XCircle className="w-3 h-3 mr-1" /> Tolak
            </Button>
          )}
        </div>
      </CardContent>
    </Card>
  );
}

function InfoItem({ label, value, highlight }: { label: string; value: string; highlight?: boolean }) {
  return (
    <div>
      <p className="text-xs text-gray-400">{label}</p>
      <p className={`font-medium ${highlight ? "text-blue-700" : "text-gray-800"}`}>{value}</p>
    </div>
  );
}
