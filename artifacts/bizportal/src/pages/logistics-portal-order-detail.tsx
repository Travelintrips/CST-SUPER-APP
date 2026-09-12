import { DatePicker } from "@/components/ui/date-picker";
import { useState, useRef, useEffect } from "react";
import { useParams, useLocation } from "wouter";
import { useQueryClient } from "@tanstack/react-query";
import {
  useGetLogisticOrder,
  useListLogisticOrderRfqs,
  useListLogisticOrderQuotes,
  useCreateLogisticOrderQuote,
  useUpdateLogisticOrderQuote,
  useApproveLogisticOrderQuote,
  useUpdateLogisticOrderStatus,
  getListLogisticOrderRfqsQueryKey,
  getListLogisticOrderQuotesQueryKey,
  getListLogisticOrdersQueryKey,
  getGetLogisticOrderQueryKey,
} from "@workspace/api-client-react";
import type { LogisticQuote, LogisticRfq } from "@workspace/api-client-react";
import { useQuery } from "@tanstack/react-query";
import { AppShell } from "@/components/layout/AppShell";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import { Checkbox } from "@/components/ui/checkbox";
import { useToast } from "@/hooks/use-toast";
import { useLanguage } from "@/contexts/LanguageContext";
import {
  ArrowLeft, PackageOpen, Send, Plus, CheckCircle, Edit, Star, Zap, TrendingDown,
  RefreshCw, MessageCircle, Trash2, ListChecks, Link, Link2, Copy, ExternalLink, Loader2, Eye,
  Clock, Truck, Package, DollarSign, Activity,
} from "lucide-react";

const idr = (n: number | null | undefined) =>
  n == null
    ? "—"
    : new Intl.NumberFormat("id-ID", { style: "currency", currency: "IDR", maximumFractionDigits: 0 }).format(n);

const STATUS_COLORS: Record<string, string> = {
  "Order Received":    "bg-slate-100 text-slate-800 border-slate-200",
  "Admin Review":      "bg-blue-100 text-blue-800 border-blue-200",
  "RFQ Sent":          "bg-indigo-100 text-indigo-800 border-indigo-200",
  "Quote Received":    "bg-violet-100 text-violet-800 border-violet-200",
  "Customer Approval": "bg-amber-100 text-amber-800 border-amber-200",
  "Vendor Confirmed":  "bg-teal-100 text-teal-800 border-teal-200",
  "In Progress":       "bg-orange-100 text-orange-800 border-orange-200",
  "Pickup":            "bg-yellow-100 text-yellow-800 border-yellow-200",
  "In Transit":        "bg-sky-100 text-sky-800 border-sky-200",
  "Arrived":           "bg-cyan-100 text-cyan-800 border-cyan-200",
  "Delivered":         "bg-emerald-100 text-emerald-800 border-emerald-200",
  "POD Uploaded":      "bg-lime-100 text-lime-800 border-lime-200",
  "Invoice Issued":    "bg-purple-100 text-purple-800 border-purple-200",
  "Payment Received":  "bg-green-100 text-green-800 border-green-200",
  "Completed":         "bg-green-200 text-green-900 border-green-300",
  "Cancelled":         "bg-red-100 text-red-800 border-red-200",
  // legacy aliases
  "New Order":         "bg-slate-100 text-slate-800 border-slate-200",
  "Under Review":      "bg-blue-100 text-blue-800 border-blue-200",
  "Quotation Sent":    "bg-amber-100 text-amber-800 border-amber-200",
  "Confirmed":         "bg-teal-100 text-teal-800 border-teal-200",
};

interface VendorRow {
  id: number;
  name: string;
  phone: string | null;
  email: string | null;
  serviceType: string | null;
  isActive: boolean;
  eta: string;
}

function formatMsgTime(iso: string): string {
  const d = new Date(iso);
  if (isNaN(d.getTime())) return "";
  const hhmm = d.toLocaleTimeString("id-ID", { hour: "2-digit", minute: "2-digit" });
  const now = new Date();
  if (d.toDateString() === now.toDateString()) return hhmm;
  const yesterday = new Date(now);
  yesterday.setDate(now.getDate() - 1);
  if (d.toDateString() === yesterday.toDateString()) return `Kemarin ${hhmm}`;
  return d.toLocaleDateString("id-ID", { day: "numeric", month: "short" }) + " " + hhmm;
}

function formatDateLabel(iso: string): string {
  const d = new Date(iso);
  if (isNaN(d.getTime())) return "";
  const now = new Date();
  if (d.toDateString() === now.toDateString()) return "Hari ini";
  const yesterday = new Date(now);
  yesterday.setDate(now.getDate() - 1);
  if (d.toDateString() === yesterday.toDateString()) return "Kemarin";
  return d.toLocaleDateString("id-ID", { day: "numeric", month: "short", year: "numeric" });
}

export default function LogisticsPortalOrderDetailPage() {
  const { id } = useParams<{ id: string }>();
  const orderId = parseInt(id ?? "0", 10);
  const [, navigate] = useLocation();
  const qc = useQueryClient();
  const { toast } = useToast();
  const { t } = useLanguage();

  const [rfqDialog, setRfqDialog] = useState(false);
  const [selectedVendors, setSelectedVendors] = useState<number[]>([]);
  const [rfqNotes, setRfqNotes] = useState("");

  // ── Edit Order Detail dialog ────────────────────────────────────────────────
  const [editDetailDialog, setEditDetailDialog] = useState(false);
  const [editDetailForm, setEditDetailForm] = useState({
    shipmentType: "", origin: "", destination: "", commodity: "",
    cargoDescription: "", grossWeight: "", volumeCbm: "",
    jumlahKoli: "", requiredDate: "", notes: "",
  });
  const [editDetailSaving, setEditDetailSaving] = useState(false);

  // ── Konversi ke Shipment dialog ───────────────────────────────────────────
  const [convertDialog, setConvertDialog] = useState(false);
  const [convertForm, setConvertForm] = useState({ transportMode: "", cargoType: "" });
  const [converting, setConverting] = useState(false);

  // ── Vendor Fulfillment Modal ───────────────────────────────────────────────
  interface VendorFulfillItem {
    id: number;
    serviceName: string;
    serviceType: string | null;
    category: string | null;
    subtotal: number;
    priceSnapshot: Record<string, unknown> | null;
    calculationInput: Record<string, unknown> | null;
    templateSnapshot: Record<string, unknown> | null;
    vendorCatalogItemId: number | null;
    vendorFulfillmentId: number | null;
  }
  const [vfModal, setVfModal] = useState<{ open: boolean; item: VendorFulfillItem | null; notes: string }>({ open: false, item: null, notes: "" });
  const [vfSubmitting, setVfSubmitting] = useState(false);

  async function submitVendorFulfillment(notes?: string) {
    if (!vfModal.item) return;
    setVfSubmitting(true);
    try {
      const res = await fetch(`/api/logistic/orders/${orderId}/items/${vfModal.item.id}/vendor-fulfillment`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ notes: notes ?? "" }),
      });
      const data = await res.json() as { success?: boolean; message?: string; fulfillment?: { id: number; status: string } };
      if (!res.ok && !data.success) {
        throw new Error(data.message ?? "Gagal membuat vendor fulfillment");
      }
      const isNew = data.message !== "already_exists";
      toast({
        title: isNew ? "Vendor Fulfillment berhasil dibuat" : "Vendor Fulfillment sudah ada",
        description: `Item: ${vfModal.item.serviceName}${!isNew ? " — data fulfillment sudah tersedia" : ""}`,
      });
      setVfModal({ open: false, item: null, notes: "" });
      qc.invalidateQueries({ queryKey: getGetLogisticOrderQueryKey(orderId) });
    } catch (e) {
      toast({ title: "Gagal", description: (e as Error).message, variant: "destructive" });
    } finally {
      setVfSubmitting(false);
    }
  }

  function openEditDetail() {
    if (!order) return;
    setEditDetailForm({
      shipmentType:    order.shipmentType ?? "",
      origin:          order.origin ?? "",
      destination:     order.destination ?? "",
      commodity:       order.commodity ?? "",
      cargoDescription: order.cargoDescription ?? "",
      grossWeight:     order.grossWeight != null ? String(order.grossWeight) : "",
      volumeCbm:       order.volumeCbm != null ? String(order.volumeCbm) : "",
      jumlahKoli:      order.jumlahKoli != null ? String(order.jumlahKoli) : "",
      requiredDate:    order.requiredDate ?? "",
      notes:           order.notes ?? "",
    });
    setEditDetailDialog(true);
  }

  async function saveEditDetail() {
    if (!order) return;
    setEditDetailSaving(true);
    try {
      const res = await fetch(`/api/logistic/orders/${orderId}/details`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({
          shipmentType:     editDetailForm.shipmentType,
          origin:           editDetailForm.origin,
          destination:      editDetailForm.destination,
          commodity:        editDetailForm.commodity,
          cargoDescription: editDetailForm.cargoDescription,
          grossWeight:      editDetailForm.grossWeight,
          volumeCbm:        editDetailForm.volumeCbm,
          jumlahKoli:       editDetailForm.jumlahKoli ? parseInt(editDetailForm.jumlahKoli) : undefined,
          requiredDate:     editDetailForm.requiredDate,
          notes:            editDetailForm.notes,
        }),
      });
      if (!res.ok) throw new Error(((await res.json()) as { message?: string }).message ?? "Gagal");
      qc.invalidateQueries({ queryKey: getGetLogisticOrderQueryKey(orderId) });
      setEditDetailDialog(false);
      toast({ title: "Detail order diperbarui" });
    } catch (e) {
      toast({ title: "Gagal simpan", description: (e as Error).message, variant: "destructive" });
    } finally {
      setEditDetailSaving(false);
    }
  }

  // ── Vendor Tracker & Lihat Link Form dialog ────────────────────────────────
  interface VendorTrackerEntry {
    vendorId: number;
    vendorName: string;
    phone: string | null;
    hasPhone: boolean;
    hasOpened: boolean;
    hasSubmitted: boolean;
    formUrl: string | null;
    quote: {
      vendorPrice: number;
      estimatedDays: number | null;
      estimatedPickup: string | null;
      estimatedDelivery: string | null;
      vendorNotes: string | null;
      submittedAt: string | null;
      replySource: string;
      quoteStatus: string;
    } | null;
  }
  // Keep old interface alias for compat with dialog
  type VendorFormLink = VendorTrackerEntry;
  const [linkFormDialog, setLinkFormDialog] = useState(false);
  const [linkFormData, setLinkFormData] = useState<{ rfqNumber: string; vendors: VendorTrackerEntry[] } | null>(null);
  const [linkFormLoading, setLinkFormLoading] = useState(false);

  // Inline tracker (auto-refresh)
  const [trackerData, setTrackerData] = useState<{ rfqNumber: string; vendors: VendorTrackerEntry[] } | null>(null);
  const [trackerLoading, setTrackerLoading] = useState(false);
  const [trackerLastUpdated, setTrackerLastUpdated] = useState<Date | null>(null);

  async function fetchTrackerData(silent = false) {
    if (!silent) setTrackerLoading(true);
    try {
      const res = await fetch(`/api/logistic/orders/${orderId}/vendor-form-links`, { credentials: "include" });
      if (res.ok) {
        const data = await res.json() as { rfqNumber: string; vendors: VendorTrackerEntry[] };
        setTrackerData(data);
        setTrackerLastUpdated(new Date());
      }
    } catch { /* silent */ } finally {
      setTrackerLoading(false);
    }
  }

  const [resendingVendorIds, setResendingVendorIds] = useState<Set<number>>(new Set());
  const [resendResults, setResendResults] = useState<Record<number, "ok" | "fail">>({});

  const [quoteDialog, setQuoteDialog] = useState<{ open: boolean; rfqId: number; vendorId?: number } | null>(null);
  const [quoteForm, setQuoteForm] = useState({
    vendorId: "", vendorPrice: "", estimatedPickup: "", estimatedDelivery: "",
    estimatedDays: "", vendorNotes: "", fixedSellingPrice: "",
  });

  const [editDialog, setEditDialog] = useState<LogisticQuote | null>(null);
  const [editForm, setEditForm] = useState({
    vendorPrice: "", estimatedPickup: "", estimatedDelivery: "", estimatedDays: "",
    vendorNotes: "", fixedSellingPrice: "",
  });

  const [approveDialog, setApproveDialog] = useState<LogisticQuote | null>(null);
  const [adminReply, setAdminReply] = useState("");

  // [MULTI-MODE] Vendor Offers state
  const [offerDialog, setOfferDialog] = useState(false);
  const [offerForm, setOfferForm] = useState({
    vendorId: "", offerPrice: "", finalCustomerPrice: "",
    vehicleYear: "", carrierName: "", transitDays: "", notes: "",
  });
  const [sendingOptions, setSendingOptions] = useState(false);
  const [sendingReply, setSendingReply] = useState(false);
  const chatEndRef = useRef<HTMLDivElement>(null);

  // Lihat Link Form state (legacy dialog kept for copy-link usage)
  const [linkDialog, setLinkDialog] = useState(false);
  const [vendorFormLinks, setVendorFormLinks] = useState<VendorFormLink[]>([]);
  const [linksLoading, setLinksLoading] = useState(false);

  // ── Operational/Payment Status ──────────────────────────────────────────
  interface OpStatus { operationalStatus: string | null; paymentStatus: string }
  const { data: opStatus, refetch: refetchOpStatus } = useQuery<OpStatus>({
    queryKey: ["op-status", orderId],
    queryFn: async () => {
      const res = await fetch(`/api/logistic/orders/${orderId}/operational-status`, { credentials: "include" });
      if (!res.ok) throw new Error("Gagal memuat status");
      return res.json() as Promise<OpStatus>;
    },
  });
  const [opStatusLoading, setOpStatusLoading] = useState(false);

  async function updateOpStatus(field: "operationalStatus" | "paymentStatus", value: string) {
    setOpStatusLoading(true);
    try {
      const res = await fetch(`/api/logistic/orders/${orderId}/operational-status`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ [field]: value }),
      });
      if (!res.ok) throw new Error("Gagal update");
      await refetchOpStatus();
      toast({ title: "Status diperbarui" });
    } catch {
      toast({ title: "Gagal update status", variant: "destructive" });
    } finally {
      setOpStatusLoading(false);
    }
  }

  // [NEW-RFQ-FLOW] Blast V2 dialog state
  const [blastV2Dialog, setBlastV2Dialog] = useState(false);
  const [blastV2VendorIds, setBlastV2VendorIds] = useState<number[]>([]);
  const [blastV2Hours, setBlastV2Hours] = useState("48");
  const [blastingV2, setBlastingV2] = useState(false);

  function openLinkDialog() {
    setLinkDialog(true);
    setLinksLoading(true);
    fetch(`/api/logistic/orders/${orderId}/vendor-form-links`, { credentials: "include" })
      .then((r) => r.json())
      .then((d) => {
        // New response format: { vendors: [...] } instead of { links: [...] }
        const vendors = (d.vendors ?? d.links ?? []) as VendorFormLink[];
        setVendorFormLinks(vendors);
        setLinksLoading(false);
      })
      .catch(() => setLinksLoading(false));
  }

  function copyLink(url: string, name: string) {
    navigator.clipboard.writeText(url).then(() => {
      toast({ title: `Link ${name} disalin`, description: url.slice(0, 60) + "…" });
    });
  }

  const { data: order, isLoading } = useGetLogisticOrder(orderId);
  const { data: rfqs = [] } = useListLogisticOrderRfqs(orderId);

  // Auto-refresh tracker when RFQ tab is visible
  useEffect(() => {
    if (rfqs.length === 0) return;
    void fetchTrackerData();
    const interval = setInterval(() => void fetchTrackerData(true), 30_000);
    return () => clearInterval(interval);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [orderId, rfqs.length]);

  const { data: comparison, refetch: refetchQuotes } = useListLogisticOrderQuotes(orderId);
  const quotes = comparison?.quotes ?? [];
  const cheapest = comparison?.cheapest;
  const fastest = comparison?.fastest;
  const recommended = comparison?.recommended;

  const { data: vendors = [] } = useQuery<VendorRow[]>({
    queryKey: ["logistic-vendors"],
    queryFn: async () => {
      const res = await fetch("/api/logistic/orders/vendors");
      if (!res.ok) throw new Error("Failed to load vendors");
      return res.json() as Promise<VendorRow[]>;
    },
    staleTime: 0,
    refetchOnMount: "always",
  });

  // [MULTI-MODE] Vendor Offers query
  interface VendorOffer {
    id: number; orderId: number; vendorId: number | null; vendorName: string | null;
    transportMode: string | null; offerPrice: number; vehicleYear: number | null;
    carrierName: string | null; transitDays: number | null; notes: string | null;
    isSelectedByAdmin: boolean; finalCustomerPrice: number | null;
    optionLabel: string | null; status: string;
  }
  const { data: vendorOffers = [], refetch: refetchOffers } = useQuery<VendorOffer[]>({
    queryKey: ["vendor-offers", orderId],
    queryFn: async () => {
      const res = await fetch(`/api/logistic/orders/${orderId}/vendor-offers`);
      if (!res.ok) throw new Error("Failed");
      return res.json() as Promise<VendorOffer[]>;
    },
  });

  interface AiChatMessage { id: number; role: string; content: string; createdAt: string }
  interface AiChatSession { id: number; sessionToken: string; logisticOrderId: number | null; createdAt: string }
  interface AiChatData { session: AiChatSession; messages: AiChatMessage[] }

  const isAiOrder = !!(order && (order as { source?: string }).source === "ai_agent");
  const { data: chatData, refetch: refetchChat } = useQuery<AiChatData>({
    queryKey: ["ai-chat", orderId],
    enabled: isAiOrder,
    queryFn: async () => {
      const res = await fetch(`/api/ai-agent/session/by-order/${orderId}`);
      if (!res.ok) throw new Error("Chat tidak ditemukan");
      return res.json() as Promise<AiChatData>;
    },
  });

  useEffect(() => {
    chatEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [chatData]);

  async function handleAdminReply() {
    if (!adminReply.trim() || !chatData?.session.sessionToken) return;
    setSendingReply(true);
    try {
      const res = await fetch(`/api/ai-agent/session/${chatData.session.sessionToken}/admin-reply`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ message: adminReply.trim() }),
      });
      if (res.ok) {
        setAdminReply("");
        await refetchChat();
        toast({ title: t.common.success });
      } else {
        toast({ title: t.common.error, variant: "destructive" });
      }
    } catch {
      toast({ title: t.common.error, variant: "destructive" });
    } finally {
      setSendingReply(false);
    }
  }

  const createQuote = useCreateLogisticOrderQuote();
  const updateQuote = useUpdateLogisticOrderQuote();
  const approveQuote = useApproveLogisticOrderQuote();
  const updateStatus = useUpdateLogisticOrderStatus();

  function invalidateAll() {
    qc.invalidateQueries({ queryKey: getListLogisticOrderRfqsQueryKey(orderId) });
    qc.invalidateQueries({ queryKey: getListLogisticOrderQuotesQueryKey(orderId) });
    qc.invalidateQueries({ queryKey: getGetLogisticOrderQueryKey(orderId) });
    qc.invalidateQueries({ queryKey: getListLogisticOrdersQueryKey() });
  }

  // [MULTI-MODE] Vendor Offer handlers
  async function handleCreateOffer() {
    const vp = parseFloat(offerForm.offerPrice);
    if (isNaN(vp) || vp <= 0) { toast({ title: "Harga vendor wajib diisi", variant: "destructive" }); return; }
    const payload: Record<string, unknown> = { offerPrice: vp };
    if (offerForm.vendorId) payload.vendorId = parseInt(offerForm.vendorId);
    if (offerForm.finalCustomerPrice) payload.finalCustomerPrice = parseFloat(offerForm.finalCustomerPrice);
    if (offerForm.vehicleYear) payload.vehicleYear = parseInt(offerForm.vehicleYear);
    if (offerForm.carrierName) payload.carrierName = offerForm.carrierName;
    if (offerForm.transitDays) payload.transitDays = parseInt(offerForm.transitDays);
    if (offerForm.notes) payload.notes = offerForm.notes;
    try {
      const res = await fetch(`/api/logistic/orders/${orderId}/vendor-offers`, {
        method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload),
      });
      if (!res.ok) throw new Error("Gagal menyimpan");
      toast({ title: "Opsi berhasil ditambahkan" });
      setOfferDialog(false);
      setOfferForm({ vendorId: "", offerPrice: "", finalCustomerPrice: "", vehicleYear: "", carrierName: "", transitDays: "", notes: "" });
      void refetchOffers();
    } catch { toast({ title: t.common.error, variant: "destructive" }); }
  }

  async function handleDeleteOffer(offerId: number) {
    if (!confirm("Hapus opsi ini?")) return;
    try {
      await fetch(`/api/logistic/orders/vendor-offers/${offerId}`, { method: "DELETE" });
      void refetchOffers();
    } catch { toast({ title: t.common.error, variant: "destructive" }); }
  }

  async function handleSendOptions() {
    setSendingOptions(true);
    try {
      const res = await fetch(`/api/logistic/orders/${orderId}/send-customer-options`, { method: "POST" });
      const body = await res.json() as { ok?: boolean; message?: string; optionCount?: number };
      if (!res.ok) throw new Error(body.message ?? "Gagal");
      toast({ title: `${body.optionCount ?? 0} opsi berhasil dikirim ke customer via WA` });
      void refetchOffers();
      invalidateAll();
    } catch (e: unknown) {
      toast({ title: (e as Error).message, variant: "destructive" });
    } finally {
      setSendingOptions(false);
    }
  }

  async function handleSendRfq() {
    if (selectedVendors.length === 0) {
      toast({ title: t.common.error, variant: "destructive" });
      return;
    }
    try {
      const res = await fetch(`/api/logistic/orders/${orderId}/rfq-blast`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ vendorIds: selectedVendors, notes: rfqNotes || undefined, deadlineHours: 48 }),
      });
      const data = await res.json() as { ok?: boolean; rfqId?: number; rfqNumber?: string; sentCount?: number; message?: string };
      if (!res.ok) throw new Error(data.message ?? "Gagal mengirim RFQ");
      toast({ title: `RFQ terkirim ke ${data.sentCount ?? 0} vendor`, description: `No. RFQ: ${data.rfqNumber ?? ""}` });
      setRfqDialog(false);
      setSelectedVendors([]);
      setRfqNotes("");
      invalidateAll();
      if (data.rfqId) navigate(`/logistics/rfq/${data.rfqId}/comparison`);
    } catch (e: unknown) {
      toast({ title: (e as Error).message ?? t.common.error, variant: "destructive" });
    }

  }

  function handleCreateQuote() {
    if (!quoteDialog) return;
    const vp = parseFloat(quoteForm.vendorPrice.replace(/[.,]/g, ""));
    if (!quoteForm.vendorId || isNaN(vp) || vp <= 0) {
      toast({ title: t.common.error, variant: "destructive" });
      return;
    }
    const fp = quoteForm.fixedSellingPrice ? parseFloat(quoteForm.fixedSellingPrice) : undefined;
    createQuote.mutate(
      {
        id: orderId,
        data: {
          rfqId: quoteDialog.rfqId,
          vendorId: parseInt(quoteForm.vendorId, 10),
          vendorPrice: vp,
          estimatedPickup: quoteForm.estimatedPickup || undefined,
          estimatedDelivery: quoteForm.estimatedDelivery || undefined,
          estimatedDays: quoteForm.estimatedDays ? parseInt(quoteForm.estimatedDays) : undefined,
          vendorNotes: quoteForm.vendorNotes || undefined,
          markupType: "fixed_price",
          markupPercentage: 0,
          fixedSellingPrice: fp,
        },
      },
      {
        onSuccess: () => {
          toast({ title: t.common.success });
          setQuoteDialog(null);
          setQuoteForm({ vendorId: "", vendorPrice: "", estimatedPickup: "", estimatedDelivery: "", estimatedDays: "", vendorNotes: "", fixedSellingPrice: "" });
          invalidateAll();
        },
        onError: () => toast({ title: t.common.error, variant: "destructive" }),
      }
    );
  }

  function openEditDialog(q: LogisticQuote) {
    setEditDialog(q);
    setEditForm({
      vendorPrice: String(q.vendorPrice),
      estimatedPickup: q.estimatedPickup ?? "",
      estimatedDelivery: q.estimatedDelivery ?? "",
      estimatedDays: q.estimatedDays != null ? String(q.estimatedDays) : "",
      vendorNotes: q.vendorNotes ?? "",
      fixedSellingPrice: q.fixedSellingPrice != null ? String(q.fixedSellingPrice) : (q.sellingPrice != null ? String(q.sellingPrice) : ""),
    });
  }

  function handleUpdateQuote() {
    if (!editDialog) return;
    const vp = parseFloat(editForm.vendorPrice);
    if (isNaN(vp) || vp <= 0) {
      toast({ title: t.common.error, variant: "destructive" });
      return;
    }
    updateQuote.mutate(
      {
        quoteId: editDialog.id,
        data: {
          vendorPrice: vp,
          estimatedPickup: editForm.estimatedPickup || undefined,
          estimatedDelivery: editForm.estimatedDelivery || undefined,
          estimatedDays: editForm.estimatedDays ? parseInt(editForm.estimatedDays) : undefined,
          vendorNotes: editForm.vendorNotes || undefined,
          markupType: "fixed_price",
          markupPercentage: 0,
          fixedSellingPrice: editForm.fixedSellingPrice ? parseFloat(editForm.fixedSellingPrice) : undefined,
        },
      },
      {
        onSuccess: () => {
          toast({ title: t.common.success });
          setEditDialog(null);
          invalidateAll();
          refetchQuotes();
        },
        onError: () => toast({ title: t.common.error, variant: "destructive" }),
      }
    );
  }

  function handleApproveQuote() {
    if (!approveDialog) return;
    approveQuote.mutate(
      { id: orderId, data: { quoteId: approveDialog.id } },
      {
        onSuccess: () => {
          toast({ title: t.common.success });
          setApproveDialog(null);
          invalidateAll();
        },
        onError: () => toast({ title: t.common.error, variant: "destructive" }),
      }
    );
  }

  async function openLinkFormDialog() {
    setLinkFormDialog(true);
    setLinkFormLoading(true);
    setResendResults({});
    try {
      const res = await fetch(`/api/logistic/orders/${orderId}/vendor-form-links`, { credentials: "include" });
      if (!res.ok) throw new Error((await res.json() as { message?: string }).message ?? "Gagal memuat link form");
      setLinkFormData(await res.json() as { rfqNumber: string; vendors: VendorFormLink[] });
    } catch (e: unknown) {
      toast({ title: "Gagal memuat link form", description: e instanceof Error ? e.message : "Coba lagi", variant: "destructive" });
      setLinkFormDialog(false);
    } finally {
      setLinkFormLoading(false);
    }
  }

  async function handleResendVendorWa(vendorId: number) {
    setResendingVendorIds((prev) => new Set(prev).add(vendorId));
    setResendResults((prev) => { const n = { ...prev }; delete n[vendorId]; return n; });
    try {
      const res = await fetch(`/api/logistic/orders/${orderId}/resend-rfq`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ vendorIds: [vendorId] }),
      });
      const data = await res.json() as { ok?: boolean; sentCount?: number; message?: string };
      if (!res.ok) throw new Error(data.message ?? "Gagal mengirim ulang");
      setResendResults((prev) => ({ ...prev, [vendorId]: (data.sentCount ?? 0) > 0 ? "ok" : "fail" }));
      if ((data.sentCount ?? 0) > 0) toast({ title: "WA berhasil dikirim ulang" });
      else toast({ title: "Tidak ada WA terkirim", description: "Vendor mungkin tidak memiliki nomor WA", variant: "destructive" });
    } catch (e: unknown) {
      setResendResults((prev) => ({ ...prev, [vendorId]: "fail" }));
      toast({ title: "Gagal kirim ulang", description: e instanceof Error ? e.message : "Coba lagi", variant: "destructive" });
    } finally {
      setResendingVendorIds((prev) => { const n = new Set(prev); n.delete(vendorId); return n; });
    }
  }

  async function handleConvertToShipment() {
    setConverting(true);
    try {
      const res = await fetch(`/api/logistics/freight-shipments/from-portal-order/${orderId}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({
          transportMode: convertForm.transportMode || undefined,
          cargoType: convertForm.cargoType || undefined,
        }),
      });
      const data = await res.json() as { id?: number; shipmentNumber?: string; message?: string };
      if (!res.ok) throw new Error(data.message ?? "Gagal");
      toast({ title: `Freight Shipment ${data.shipmentNumber} berhasil dibuat` });
      setConvertDialog(false);
      navigate(`/logistics/freight/${data.id}`);
    } catch (e) {
      toast({ title: "Gagal konversi", description: (e as Error).message, variant: "destructive" });
    } finally {
      setConverting(false);
    }
  }

  // Filter vendors: active + serviceType compatible with order shipment type
  // Vendors with null/empty serviceType ("Semua tipe") always appear
  const activeVendors = vendors.filter((v) => {
    if (!v.isActive) return false;
    if (!v.serviceType) return true;
    const st = v.serviceType.toLowerCase().trim();
    if (!st || st === "semua tipe" || st === "all") return true;
    const orderType = (order?.shipmentType ?? "").toLowerCase().trim();
    if (!orderType) return true;
    return orderType.includes(st) || st.includes(orderType);
  });

  if (isLoading) {
    return (
      <AppShell>
        <div className="flex items-center justify-center h-64">
          <RefreshCw className="h-6 w-6 animate-spin text-muted-foreground" />
        </div>
      </AppShell>
    );
  }

  if (!order) {
    return (
      <AppShell>
        <div className="p-6">
          <p className="text-muted-foreground">Order tidak ditemukan.</p>
          <Button variant="outline" className="mt-4" onClick={() => navigate("/logistics/portal-orders")}>
            <ArrowLeft className="h-4 w-4 mr-2" /> Kembali
          </Button>
        </div>
      </AppShell>
    );
  }

  const latestRfq: LogisticRfq | undefined = rfqs[0];

  return (
    <AppShell>
      <div className="space-y-6 p-6 max-w-6xl mx-auto">
        {/* Header */}
        <div className="flex items-center gap-4">
          <Button variant="ghost" size="sm" onClick={() => navigate("/logistics/portal-orders")}>
            <ArrowLeft className="h-4 w-4" />
          </Button>
          <div className="flex-1">
            <div className="flex items-center gap-3 flex-wrap">
              <h1 className="text-xl font-bold flex items-center gap-2">
                <PackageOpen className="h-5 w-5" />
                {order.orderNumber}
              </h1>
              <Badge className={`${STATUS_COLORS[order.status] ?? "bg-gray-100 text-gray-800"} border text-xs`}>
                {order.status}
              </Badge>
            </div>
            <p className="text-sm text-muted-foreground mt-0.5">
              {order.customerName} · {order.companyName} · {order.email} · {order.phone}
            </p>
          </div>
          <div className="flex gap-2 flex-wrap">
            {(order.status === "Order Received" || order.status === "Admin Review" ||
              order.status === "New Order" || order.status === "Under Review") ? (
              <Button size="sm" className="gap-2" onClick={() => setRfqDialog(true)}>
                <Send className="h-4 w-4" /> Kirim RFQ ke Vendor
              </Button>
            ) : null}
            {rfqs.length > 0 && (
              <Button size="sm" variant="outline" className="gap-2" onClick={openLinkDialog}>
                <Link2 className="h-4 w-4" /> Lihat Link Form
              </Button>
            )}
            {latestRfq && (
              <Button size="sm" variant="outline" className="gap-2 border-blue-300 text-blue-700 hover:bg-blue-50"
                onClick={() => navigate(`/logistics/rfq/${latestRfq.id}/comparison`)}>
                <ListChecks className="h-4 w-4" /> Comparison
              </Button>
            )}
            {(order.status === "Vendor Confirmed" || order.status === "Confirmed") && (
              <Button
                size="sm"
                className="gap-2 bg-green-600 hover:bg-green-700 text-white"
                onClick={() => {
                  const params = new URLSearchParams({
                    kind: "order",
                    fromPortal: order.orderNumber,
                    customer: order.customerName,
                    origin: order.origin,
                    destination: order.destination,
                    ...(order.finalSellingPrice != null ? { price: String(order.finalSellingPrice) } : {}),
                  });
                  navigate(`/sales/quotations/new?${params.toString()}`);
                }}
              >
                <Plus className="h-4 w-4" /> Buat Sales Order
              </Button>
            )}
            {(order.status === "Vendor Confirmed" || order.status === "In Progress" ||
              order.status === "Confirmed" || order.status === "Pickup" || order.status === "In Transit") && !!(order as any).linkedSalesDocId && (
              <Button
                size="sm"
                className="gap-2 bg-indigo-600 hover:bg-indigo-700 text-white"
                onClick={() => {
                  const st = (order.shipmentType ?? "").toLowerCase();
                  let tm = "";
                  if (st.includes("sea") || st.includes("laut")) tm = "sea";
                  else if (st.includes("air") || st.includes("udara")) tm = "air";
                  else if (st.includes("truck") || st.includes("darat") || st.includes("land")) tm = "land";
                  else if (st.includes("multi")) tm = "multimodal";
                  setConvertForm({ transportMode: tm, cargoType: "" });
                  setConvertDialog(true);
                }}
              >
                <Truck className="h-4 w-4" /> Konversi ke Shipment
              </Button>
            )}
          </div>
        </div>

        <Tabs defaultValue={isAiOrder ? "chat-ai" : "detail"}>
          <TabsList>
            <TabsTrigger value="detail">Detail Order</TabsTrigger>
            <TabsTrigger value="rfq">
              RFQ & Quotes
              {quotes.length > 0 && (
                <span className="ml-1.5 inline-flex items-center justify-center rounded-full bg-blue-600 text-white text-[10px] w-4 h-4">
                  {quotes.length}
                </span>
              )}
            </TabsTrigger>
            <TabsTrigger value="options" className="gap-1.5">
              <ListChecks className="h-3.5 w-3.5" />
              Opsi Customer
              {vendorOffers.length > 0 && (
                <span className="ml-0.5 inline-flex items-center justify-center rounded-full bg-green-600 text-white text-[10px] w-4 h-4">
                  {vendorOffers.length}
                </span>
              )}
            </TabsTrigger>
            <TabsTrigger value="status" className="gap-1.5">
              <Activity className="h-3.5 w-3.5" />
              Status
            </TabsTrigger>
            {isAiOrder && (
              <TabsTrigger value="chat-ai" className="gap-1.5">
                <MessageCircle className="h-3.5 w-3.5" />
                Chat AI
                {chatData && chatData.messages.length > 0 && (
                  <span className="ml-0.5 inline-flex items-center justify-center rounded-full bg-violet-600 text-white text-[10px] w-4 h-4">
                    {chatData.messages.length}
                  </span>
                )}
              </TabsTrigger>
            )}
          </TabsList>

          {/* ── Tab 1: Order Detail ── */}
          <TabsContent value="detail" className="space-y-4 mt-4">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <Card>
                <CardHeader className="pb-2">
                  <div className="flex items-center justify-between">
                    <CardTitle className="text-sm">Info Pengiriman</CardTitle>
                    <Button size="sm" variant="ghost" className="h-7 px-2 text-xs gap-1" onClick={openEditDetail}>
                      <Edit className="w-3 h-3" /> Edit
                    </Button>
                  </div>
                </CardHeader>
                <CardContent className="space-y-2 text-sm">
                  <InfoRow label="Tipe" value={order.shipmentType || <span className="text-slate-400 italic">kosong</span>} />
                  <InfoRow label="Rute" value={order.origin || order.destination ? `${order.origin || "—"} → ${order.destination || "—"}` : <span className="text-slate-400 italic">kosong</span>} />
                  {(order as any).senderName && <InfoRow label="Nama Pengirim" value={(order as any).senderName} />}
                  {order.commodity && <InfoRow label="Komoditi" value={order.commodity} />}
                  {order.cargoDescription && <InfoRow label="Kargo" value={order.cargoDescription} />}
                  {order.grossWeight != null && <InfoRow label="Berat" value={`${order.grossWeight} kg`} />}
                  {order.volumeCbm != null && <InfoRow label="Volume" value={`${order.volumeCbm} CBM`} />}
                  {order.jumlahKoli != null && <InfoRow label="Jumlah Koli" value={`${order.jumlahKoli} koli`} />}
                  {order.requiredDate && <InfoRow label="Tgl Butuh" value={order.requiredDate} />}
                  {order.paymentType && <InfoRow label="Pembayaran" value={order.paymentType} />}
                  {order.notes && <InfoRow label="Catatan" value={order.notes} />}
                </CardContent>
              </Card>
              <Card>
                <CardHeader className="pb-2"><CardTitle className="text-sm">Nilai Order</CardTitle></CardHeader>
                <CardContent className="space-y-2 text-sm">
                  <InfoRow label="Subtotal" value={idr(order.subtotal)} />
                  <InfoRow label="Pajak" value={idr(order.tax)} />
                  <InfoRow label="Total Estimasi" value={<span className="font-bold text-base">{idr(order.grandTotal)}</span>} />
                  {order.finalSellingPrice != null && (
                    <InfoRow label="Harga Jual Final" value={<span className="font-bold text-green-700">{idr(order.finalSellingPrice)}</span>} />
                  )}
                  {order.approvedVendorName && <InfoRow label="Vendor Dipilih" value={order.approvedVendorName} />}
                  {order.quotationSentAt && (
                    <InfoRow label="Penawaran Dikirim" value={new Date(order.quotationSentAt).toLocaleString("id-ID")} />
                  )}
                </CardContent>
              </Card>
            </div>

            {(order.items ?? []).length > 0 && (() => {
              const approvedQuote = quotes.find((q) => q.quoteStatus === "approved");
              const approvedVendorPrice = approvedQuote?.vendorPrice ?? 0;
              const totalSubtotal = (order.items ?? []).reduce((s, i) => s + (i.subtotal ?? 0), 0);
              const showMargin = approvedVendorPrice > 0 && totalSubtotal > 0;
              return (
                <Card>
                  <CardHeader className="pb-2">
                    <div className="flex items-center justify-between flex-wrap gap-2">
                      <CardTitle className="text-sm">Item Layanan</CardTitle>
                      {showMargin && (
                        <div className="flex items-center gap-3 text-xs text-muted-foreground">
                          <span>Vendor Total: <span className="font-mono text-foreground">{idr(approvedVendorPrice)}</span></span>
                          <span>Margin Total: <span className={`font-mono font-semibold ${(totalSubtotal - approvedVendorPrice) >= 0 ? "text-green-700" : "text-red-600"}`}>{idr(totalSubtotal - approvedVendorPrice)}</span></span>
                          <span className={`font-semibold ${totalSubtotal > 0 && ((totalSubtotal - approvedVendorPrice) / totalSubtotal) >= 0 ? "text-green-700" : "text-red-600"}`}>
                            {totalSubtotal > 0 ? `${(((totalSubtotal - approvedVendorPrice) / totalSubtotal) * 100).toFixed(1)}%` : "—"}
                          </span>
                        </div>
                      )}
                    </div>
                  </CardHeader>
                  <CardContent className="p-0">
                    <Table>
                      <TableHeader>
                        <TableRow>
                          <TableHead>Layanan</TableHead>
                          <TableHead>Kategori</TableHead>
                          <TableHead className="text-right">Harga Jual</TableHead>
                          {showMargin && <TableHead className="text-right">Harga Vendor*</TableHead>}
                          {showMargin && <TableHead className="text-right">Margin</TableHead>}
                          {showMargin && <TableHead className="text-right">%</TableHead>}
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {(order.items ?? []).map((item) => {
                          const sellingPrice = item.subtotal ?? 0;
                          const itemVendorCost = showMargin ? (approvedVendorPrice * (sellingPrice / totalSubtotal)) : 0;
                          const margin = sellingPrice - itemVendorCost;
                          const marginPct = sellingPrice > 0 ? (margin / sellingPrice) * 100 : 0;
                          return (
                            <TableRow key={item.id}>
                              <TableCell className="font-medium text-sm">
                                <div>{item.serviceName}</div>
                                <div className="flex flex-wrap gap-1 mt-0.5">
                                  {(item as any).itemSource === "vendor_catalog_item" && (
                                    <span className="inline-flex items-center text-[10px] font-medium bg-blue-100 text-blue-700 border border-blue-200 rounded px-1.5 py-0.5">Vendor Marketplace</span>
                                  )}
                                  {(item as any).serviceType && (
                                    <span className="inline-flex items-center text-[10px] font-medium bg-muted text-muted-foreground border rounded px-1.5 py-0.5">{(item as any).serviceType}</span>
                                  )}
                                </div>
                                {(item as any).itemSource === "vendor_catalog_item" && (item as any).priceSnapshot && (
                                  <div className="mt-1.5 flex flex-wrap gap-x-3 gap-y-0.5 text-[10px] bg-blue-50 border border-blue-100 rounded px-2 py-1.5">
                                    {(item as any).priceSnapshot.vendorName && (
                                      <span><span className="text-slate-400">Vendor: </span><span className="font-semibold text-slate-700">{(item as any).priceSnapshot.vendorName}</span></span>
                                    )}
                                    {(item as any).priceSnapshot.priceSell != null && (
                                      <span><span className="text-slate-400">Harga Jual: </span><span className="font-semibold text-sky-700">{Number((item as any).priceSnapshot.priceSell).toLocaleString("id-ID", { style: "currency", currency: (item as any).priceSnapshot.currency ?? "IDR", maximumFractionDigits: 0 })}</span></span>
                                    )}
                                    {(item as any).priceSnapshot.unit && (
                                      <span><span className="text-slate-400">Unit: </span><span className="font-medium text-slate-700">/ {(item as any).priceSnapshot.unit}</span></span>
                                    )}
                                  </div>
                                )}
                                {(item as any).itemSource === "vendor_catalog_item" && (item as any).calculationInput && typeof (item as any).calculationInput === "object" && Object.keys((item as any).calculationInput).length > 0 && (
                                  <div className="mt-1 flex flex-wrap gap-x-3 gap-y-0.5 text-[10px] bg-slate-50 border border-slate-100 rounded px-2 py-1.5">
                                    <span className="text-slate-400 font-semibold w-full">Input Kalkulator:</span>
                                    {Object.entries((item as any).calculationInput as Record<string, unknown>)
                                      .filter(([, v]) => v !== undefined && v !== null && v !== "")
                                      .map(([k, v]) => (
                                        <span key={k}><span className="text-slate-400">{k}: </span><span className="font-medium text-slate-700">{String(v)}</span></span>
                                      ))}
                                  </div>
                                )}
                                {(item as any).itemSource === "vendor_catalog_item" && (() => {
                                  const snap = (item as any).templateSnapshot ?? (item as any).inputData?.templateSnapshot;
                                  if (!snap || typeof snap !== "object") return null;
                                  const fields = (snap as Record<string, unknown>).fields;
                                  const serviceType = (snap as Record<string, unknown>).serviceType as string | undefined;
                                  const category = (snap as Record<string, unknown>).category as string | undefined;
                                  const version = (snap as Record<string, unknown>).version as string | undefined;
                                  const hasFields = Array.isArray(fields) && fields.length > 0;
                                  return (
                                    <details className="mt-1">
                                      <summary className="text-[10px] text-slate-400 font-semibold cursor-pointer select-none hover:text-slate-600">
                                        Template Snapshot {version ? `v${version}` : ""}
                                      </summary>
                                      <div className="mt-1 flex flex-wrap gap-x-3 gap-y-0.5 text-[10px] bg-violet-50 border border-violet-100 rounded px-2 py-1.5">
                                        {serviceType && <span><span className="text-slate-400">serviceType: </span><span className="font-medium text-slate-700">{serviceType}</span></span>}
                                        {category && <span><span className="text-slate-400">category: </span><span className="font-medium text-slate-700">{category}</span></span>}
                                        {hasFields && (
                                          <span className="w-full">
                                            <span className="text-slate-400">fields: </span>
                                            <span className="font-medium text-slate-700">
                                              {(fields as Array<{ key?: string; label?: string; required?: boolean }>)
                                                .map((f) => f.label ?? f.key ?? "?")
                                                .join(" · ")}
                                            </span>
                                          </span>
                                        )}
                                      </div>
                                    </details>
                                  );
                                })()}
                                {(item as any).itemSource === "vendor_catalog_item" && (item as any).vendorCatalogItemId && (
                                  <div className="mt-2 flex flex-wrap items-center gap-1.5">
                                    {(item as any).vendorFulfillmentId ? (
                                      <>
                                        {(() => {
                                          const st: string = (item as any).vendorFulfillmentStatus ?? "pending";
                                          const label = st === "completed" ? "Completed" : st === "in_progress" ? "In Progress" : st === "cancelled" ? "Cancelled" : "Pending";
                                          const cls = st === "completed"
                                            ? "bg-emerald-100 text-emerald-700 border-emerald-200"
                                            : st === "in_progress"
                                            ? "bg-amber-100 text-amber-700 border-amber-200"
                                            : st === "cancelled"
                                            ? "bg-red-100 text-red-700 border-red-200"
                                            : "bg-blue-100 text-blue-700 border-blue-200";
                                          return (
                                            <span className={`inline-flex items-center gap-1 text-[10px] font-semibold rounded px-2 py-0.5 border ${cls}`}>
                                              <CheckCircle className="h-3 w-3" /> Vendor Fulfillment: {label}
                                            </span>
                                          );
                                        })()}
                                        <Button
                                          size="sm"
                                          variant="outline"
                                          className="h-6 text-[11px] px-2 gap-1 border-slate-200 text-slate-500"
                                          disabled
                                          title="Halaman detail fulfillment belum tersedia"
                                        >
                                          <ExternalLink className="h-3 w-3" /> Lihat Fulfillment
                                        </Button>
                                      </>
                                    ) : (
                                      <Button
                                        size="sm"
                                        variant="outline"
                                        className="h-6 text-[11px] px-2 gap-1 border-blue-300 text-blue-700 hover:bg-blue-50"
                                        onClick={() => setVfModal({
                                          open: true,
                                          notes: "",
                                          item: {
                                            id: item.id,
                                            serviceName: item.serviceName,
                                            serviceType: (item as any).serviceType ?? null,
                                            category: item.category ?? null,
                                            subtotal: item.subtotal ?? 0,
                                            priceSnapshot: (item as any).priceSnapshot ?? null,
                                            calculationInput: (item as any).calculationInput ?? null,
                                            templateSnapshot: (item as any).templateSnapshot ?? null,
                                            vendorCatalogItemId: (item as any).vendorCatalogItemId ?? null,
                                            vendorFulfillmentId: (item as any).vendorFulfillmentId ?? null,
                                          },
                                        })}
                                      >
                                        <Truck className="h-3 w-3" /> Proses Vendor
                                      </Button>
                                    )}
                                  </div>
                                )}
                              </TableCell>
                              <TableCell className="text-sm text-muted-foreground">{item.category}</TableCell>
                              <TableCell className="text-right text-sm font-mono">{idr(sellingPrice)}</TableCell>
                              {showMargin && (
                                <TableCell className="text-right text-sm font-mono text-muted-foreground">{idr(Math.round(itemVendorCost))}</TableCell>
                              )}
                              {showMargin && (
                                <TableCell className={`text-right text-sm font-mono font-semibold ${margin >= 0 ? "text-green-700" : "text-red-600"}`}>
                                  {idr(Math.round(margin))}
                                </TableCell>
                              )}
                              {showMargin && (
                                <TableCell className={`text-right text-sm font-semibold ${marginPct >= 0 ? "text-green-700" : "text-red-600"}`}>
                                  {marginPct.toFixed(1)}%
                                </TableCell>
                              )}
                            </TableRow>
                          );
                        })}
                      </TableBody>
                    </Table>
                    {showMargin && (
                      <p className="text-[11px] text-muted-foreground px-4 py-2">
                        * Harga Vendor dialokasikan proporsional dari total harga vendor ({idr(approvedVendorPrice)}) berdasarkan bobot harga jual tiap item.
                      </p>
                    )}
                  </CardContent>
                </Card>
              );
            })()}
          </TabsContent>

          {/* ── Tab 2: RFQ & Quotes ── */}
          <TabsContent value="rfq" className="space-y-4 mt-4">

            {/* [NEW-RFQ-FLOW] Comparison & Blast banner */}
            <div className="flex flex-wrap items-center gap-2 p-3 bg-blue-50 border border-blue-100 rounded-lg">
              <ListChecks className="h-4 w-4 text-blue-600 shrink-0" />
              <span className="text-sm text-blue-800 font-medium flex-1">
                {latestRfq ? `RFQ ${(latestRfq as any).rfqNumber ?? `#${latestRfq.id}`}` : "Kirim RFQ ke vendor via sistem baru"}
              </span>
              <div className="flex gap-2">
                {latestRfq && (
                  <Button size="sm" variant="outline" className="h-7 text-xs gap-1 border-blue-300 text-blue-700 hover:bg-blue-100"
                    onClick={() => navigate(`/logistics/rfq/${latestRfq.id}/comparison`)}>
                    <Eye className="h-3 w-3" /> Lihat Comparison
                  </Button>
                )}
                <Button size="sm" className="h-7 text-xs gap-1 bg-blue-600 hover:bg-blue-700 text-white"
                  onClick={() => { setBlastV2VendorIds([]); setBlastV2Dialog(true); }}>
                  <Send className="h-3 w-3" /> Blast Vendor
                </Button>
              </div>
            </div>

            {/* Vendor Response Tracker */}
            {rfqs.length > 0 && (
              <Card>
                <CardHeader className="pb-2 flex flex-row items-center justify-between flex-wrap gap-2">
                  <div>
                    <CardTitle className="text-sm flex items-center gap-2">
                      Vendor Response Tracker
                      {trackerData && (
                        <span className="text-xs font-normal text-muted-foreground">
                          — {trackerData.rfqNumber}
                        </span>
                      )}
                    </CardTitle>
                    {trackerLastUpdated && (
                      <p className="text-[10px] text-muted-foreground mt-0.5">
                        Diperbarui {trackerLastUpdated.toLocaleTimeString("id-ID")} · auto-refresh 30s
                      </p>
                    )}
                  </div>
                  <div className="flex items-center gap-2">
                    <Button
                      size="sm"
                      variant="ghost"
                      className="h-7 gap-1.5 text-xs"
                      onClick={() => void fetchTrackerData()}
                      disabled={trackerLoading}
                    >
                      <RefreshCw className={`h-3.5 w-3.5 ${trackerLoading ? "animate-spin" : ""}`} />
                      Refresh
                    </Button>
                    <Button
                      size="sm"
                      variant="outline"
                      className="h-7 gap-1.5 text-xs"
                      onClick={openLinkFormDialog}
                    >
                      <Link className="h-3.5 w-3.5" /> Link Form
                    </Button>
                  </div>
                </CardHeader>
                <CardContent className="p-0">
                  {trackerLoading && !trackerData ? (
                    <div className="flex items-center justify-center py-8 gap-2 text-muted-foreground">
                      <Loader2 className="h-4 w-4 animate-spin" />
                      <span className="text-sm">Memuat data vendor...</span>
                    </div>
                  ) : !trackerData || trackerData.vendors.length === 0 ? (
                    <div className="py-8 text-center text-sm text-muted-foreground">
                      Tidak ada vendor di RFQ ini.
                    </div>
                  ) : (
                    <div className="divide-y">
                      {trackerData.vendors.map((v) => {
                        const statusColor = v.hasSubmitted
                          ? "bg-green-50 border-l-4 border-l-green-500"
                          : v.hasOpened
                          ? "bg-yellow-50 border-l-4 border-l-yellow-400"
                          : "bg-background border-l-4 border-l-gray-200";

                        const statusBadge = v.hasSubmitted ? (
                          <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium bg-green-100 text-green-700">
                            <CheckCircle className="h-3 w-3" /> Sudah Submit
                          </span>
                        ) : v.hasOpened ? (
                          <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium bg-yellow-100 text-yellow-700">
                            <Eye className="h-3 w-3" /> Sudah Buka Form
                          </span>
                        ) : (
                          <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium bg-gray-100 text-gray-500">
                            <MessageCircle className="h-3 w-3" /> Belum Respons
                          </span>
                        );

                        const isResending = resendingVendorIds.has(v.vendorId);
                        const resendResult = resendResults[v.vendorId];

                        return (
                          <div key={v.vendorId} className={`px-4 py-3 ${statusColor}`}>
                            <div className="flex items-start gap-3 flex-wrap">
                              <div className="flex-1 min-w-0 space-y-1">
                                <div className="flex items-center gap-2 flex-wrap">
                                  <span className="font-medium text-sm">{v.vendorName}</span>
                                  {statusBadge}
                                  {!v.hasPhone && (
                                    <span className="text-xs text-orange-500 border border-orange-200 rounded-full px-2 py-0.5">No WA</span>
                                  )}
                                </div>
                                {v.phone && (
                                  <p className="text-xs text-muted-foreground">{v.phone}</p>
                                )}
                                {v.quote && (
                                  <div className="mt-1.5 grid grid-cols-2 sm:grid-cols-4 gap-x-4 gap-y-0.5 text-xs">
                                    <div>
                                      <span className="text-muted-foreground">Harga Vendor: </span>
                                      <span className="font-semibold text-green-700">
                                        {new Intl.NumberFormat("id-ID", { style: "currency", currency: "IDR", maximumFractionDigits: 0 }).format(v.quote.vendorPrice)}
                                      </span>
                                    </div>
                                    {v.quote.estimatedDays != null && (
                                      <div>
                                        <span className="text-muted-foreground">ETA: </span>
                                        <span className="font-medium">{v.quote.estimatedDays} hari</span>
                                      </div>
                                    )}
                                    {v.quote.estimatedPickup && (
                                      <div>
                                        <span className="text-muted-foreground">Pickup: </span>
                                        <span>{v.quote.estimatedPickup}</span>
                                      </div>
                                    )}
                                    {v.quote.submittedAt && (
                                      <div>
                                        <span className="text-muted-foreground">Submit: </span>
                                        <span>{new Date(v.quote.submittedAt).toLocaleString("id-ID", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" })}</span>
                                      </div>
                                    )}
                                    {v.quote.vendorNotes && (
                                      <div className="col-span-2 sm:col-span-4">
                                        <span className="text-muted-foreground">Catatan: </span>
                                        <span className="italic">{v.quote.vendorNotes}</span>
                                      </div>
                                    )}
                                  </div>
                                )}
                              </div>
                              {!v.hasSubmitted && (
                                <Button
                                  size="sm"
                                  variant={resendResult === "ok" ? "default" : resendResult === "fail" ? "destructive" : "outline"}
                                  className={`h-7 gap-1.5 text-xs shrink-0 ${resendResult === "ok" ? "bg-green-600 hover:bg-green-700" : ""}`}
                                  disabled={isResending || !v.hasPhone}
                                  title={!v.hasPhone ? "Tidak ada nomor WA" : "Kirim ulang WA dengan link form"}
                                  onClick={() => handleResendVendorWa(v.vendorId)}
                                >
                                  {isResending
                                    ? <Loader2 className="h-3 w-3 animate-spin" />
                                    : resendResult === "ok"
                                    ? <CheckCircle className="h-3 w-3" />
                                    : <MessageCircle className="h-3 w-3" />}
                                  {isResending ? "Mengirim..." : resendResult === "ok" ? "Terkirim!" : resendResult === "fail" ? "Coba Lagi" : "Kirim Ulang WA"}
                                </Button>
                              )}
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  )}
                </CardContent>
              </Card>
            )}

            {/* Comparison Summary */}
            {quotes.length > 0 && (
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                <ComparisonCard
                  icon={<TrendingDown className="h-4 w-4 text-green-600" />}
                  label="Termurah"
                  quote={cheapest}
                  badge="bg-green-100 text-green-800"
                />
                <ComparisonCard
                  icon={<Zap className="h-4 w-4 text-yellow-600" />}
                  label="Tercepat"
                  quote={fastest}
                  badge="bg-yellow-100 text-yellow-800"
                />
                <ComparisonCard
                  icon={<Star className="h-4 w-4 text-purple-600" />}
                  label="Rekomendasi"
                  quote={recommended}
                  badge="bg-purple-100 text-purple-800"
                />
              </div>
            )}

            {/* Quotes Table */}
            <Card>
              <CardHeader className="pb-2 flex flex-row items-center justify-between">
                <CardTitle className="text-sm">
                  Penawaran Vendor ({quotes.length})
                </CardTitle>
                {latestRfq && !["Customer Approval", "Quotation Sent", "Vendor Confirmed", "Confirmed", "In Progress", "Pickup", "In Transit", "Arrived", "Delivered", "POD Uploaded", "Invoice Issued", "Payment Received", "Completed"].includes(order.status ?? "") && (
                  <Button
                    size="sm"
                    variant="outline"
                    className="h-7 gap-1.5 text-xs"
                    onClick={() => {
                      setQuoteForm({ vendorId: "", vendorPrice: "", estimatedPickup: "", estimatedDelivery: "", estimatedDays: "", vendorNotes: "", fixedSellingPrice: "" });
                      setQuoteDialog({ open: true, rfqId: latestRfq.id });
                    }}
                  >
                    <Plus className="h-3.5 w-3.5" /> Tambah Manual
                  </Button>
                )}
              </CardHeader>
              <CardContent className="p-0">
                {quotes.length === 0 ? (
                  <div className="py-10 text-center text-sm text-muted-foreground">
                    Belum ada penawaran. Kirim RFQ ke vendor atau tambah manual.
                  </div>
                ) : (
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Vendor</TableHead>
                        <TableHead className="text-right">Harga Vendor</TableHead>
                        <TableHead>Markup</TableHead>
                        <TableHead className="text-right">Harga Jual</TableHead>
                        <TableHead>ETA</TableHead>
                        <TableHead>Status</TableHead>
                        <TableHead>Sumber</TableHead>
                        <TableHead></TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {quotes.map((q) => {
                        const isCheapest = cheapest?.id === q.id;
                        const isFastest = fastest?.id === q.id;
                        const isRecommended = recommended?.id === q.id;
                        const isApproved = q.quoteStatus === "approved";
                        return (
                          <TableRow key={q.id} className={isApproved ? "bg-green-50" : ""}>
                            <TableCell>
                              <div className="flex items-center gap-1.5 flex-wrap">
                                <span className="font-medium text-sm">{q.vendorName}</span>
                                {isCheapest && <Badge className="text-[10px] bg-green-100 text-green-800 border-0 px-1 py-0">Murah</Badge>}
                                {isFastest && <Badge className="text-[10px] bg-yellow-100 text-yellow-800 border-0 px-1 py-0">Cepat</Badge>}
                                {isRecommended && <Badge className="text-[10px] bg-purple-100 text-purple-800 border-0 px-1 py-0">★ Rekomendasi</Badge>}
                              </div>
                              {q.vendorNotes && <p className="text-xs text-muted-foreground mt-0.5">{q.vendorNotes}</p>}
                            </TableCell>
                            <TableCell className="text-right font-mono text-sm">
                              {idr(q.vendorPrice)}
                            </TableCell>
                            <TableCell className="text-sm text-muted-foreground">
                              {q.sellingPrice && q.vendorPrice
                                ? `+${idr(q.sellingPrice - q.vendorPrice)}`
                                : "—"}
                            </TableCell>
                            <TableCell className="text-right font-mono text-sm font-semibold">
                              {idr(q.sellingPrice)}
                            </TableCell>
                            <TableCell className="text-xs">
                              {q.estimatedPickup && <div>Pickup: {q.estimatedPickup}</div>}
                              {q.estimatedDelivery && <div>Kirim: {q.estimatedDelivery}</div>}
                              {q.estimatedDays != null && <div>{q.estimatedDays} hari</div>}
                            </TableCell>
                            <TableCell>
                              <Badge variant="outline" className={`text-xs ${
                                isApproved ? "bg-green-100 text-green-800 border-green-200"
                                : q.quoteStatus === "rejected" ? "bg-red-100 text-red-800"
                                : "bg-gray-100 text-gray-700"
                              }`}>
                                {isApproved ? "✓ Approved" : q.quoteStatus}
                              </Badge>
                            </TableCell>
                            <TableCell className="text-xs text-muted-foreground">
                              {q.replySource === "whatsapp" ? "🟢 WA" : "Manual"}
                              {q.replyTimestamp && (
                                <div>{new Date(q.replyTimestamp).toLocaleDateString("id-ID")}</div>
                              )}
                            </TableCell>
                            <TableCell>
                              {!isApproved && !["Vendor Confirmed", "Confirmed", "In Progress", "Pickup", "In Transit", "Arrived", "Delivered", "POD Uploaded", "Invoice Issued", "Payment Received", "Completed"].includes(order.status ?? "") && (
                                <div className="flex gap-1.5 justify-end">
                                  <Button size="sm" variant="ghost" className="h-7 w-7 p-0" title="Edit" onClick={() => openEditDialog(q)}>
                                    <Edit className="h-3.5 w-3.5" />
                                  </Button>
                                  <Button
                                    size="sm"
                                    variant="default"
                                    className="h-7 px-2 text-xs gap-1"
                                    title="Approve & Kirim ke Customer"
                                    onClick={() => setApproveDialog(q)}
                                  >
                                    <CheckCircle className="h-3.5 w-3.5" />
                                    Approve
                                  </Button>
                                </div>
                              )}
                            </TableCell>
                          </TableRow>
                        );
                      })}
                    </TableBody>
                  </Table>
                )}
              </CardContent>
            </Card>
          </TabsContent>
          {/* ── Tab 3: Opsi Customer (Multi-Mode) ── */}
          <TabsContent value="options" className="space-y-4 mt-4">
            <Card>
              <CardHeader className="pb-2">
                <div className="flex items-center justify-between">
                  <CardTitle className="text-sm">Opsi Anonim untuk Customer ({vendorOffers.length})</CardTitle>
                  <div className="flex gap-2">
                    <Button size="sm" variant="outline" className="h-7 gap-1.5 text-xs" onClick={() => setOfferDialog(true)}>
                      <Plus className="h-3.5 w-3.5" /> Tambah Opsi
                    </Button>
                    {vendorOffers.some((o) => o.status !== "CUSTOMER_CHOSEN") && vendorOffers.length > 0 && (
                      <Button
                        size="sm"
                        className="h-7 gap-1.5 text-xs bg-green-600 hover:bg-green-700"
                        onClick={() => void handleSendOptions()}
                        disabled={sendingOptions}
                      >
                        <Send className="h-3.5 w-3.5" />
                        {sendingOptions ? "Mengirim..." : "Kirim ke Customer via WA"}
                      </Button>
                    )}
                  </div>
                </div>
              </CardHeader>
              <CardContent className="p-0">
                {vendorOffers.length === 0 ? (
                  <div className="py-10 text-center text-sm text-muted-foreground">
                    Belum ada opsi. Tambahkan minimal 1 opsi vendor, lalu kirim ke customer.
                  </div>
                ) : (
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead className="w-24">Label</TableHead>
                        <TableHead>Vendor (Internal)</TableHead>
                        <TableHead className="text-right">Harga Vendor</TableHead>
                        <TableHead className="text-right">Harga Customer</TableHead>
                        <TableHead>Info</TableHead>
                        <TableHead>Status</TableHead>
                        <TableHead className="w-10"></TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {vendorOffers.map((o) => (
                        <TableRow key={o.id} className={o.status === "CUSTOMER_CHOSEN" ? "bg-green-50" : ""}>
                          <TableCell className="font-medium text-sm">{o.optionLabel ?? `#${o.id}`}</TableCell>
                          <TableCell className="text-sm text-muted-foreground">{o.vendorName ?? o.carrierName ?? "—"}</TableCell>
                          <TableCell className="text-right font-mono text-sm">{idr(o.offerPrice)}</TableCell>
                          <TableCell className="text-right font-mono text-sm font-semibold">
                            {idr(o.finalCustomerPrice ?? o.offerPrice)}
                          </TableCell>
                          <TableCell className="text-xs text-muted-foreground space-y-0.5">
                            {o.vehicleYear && <div>Tahun: {o.vehicleYear}</div>}
                            {o.transitDays && <div>Transit: {o.transitDays} hari</div>}
                            {o.notes && <div className="max-w-[160px] truncate">{o.notes}</div>}
                          </TableCell>
                          <TableCell>
                            <Badge variant="outline" className={`text-xs ${
                              o.status === "CUSTOMER_CHOSEN" ? "bg-green-100 text-green-800 border-green-200" :
                              o.status === "OPTIONS_SENT" ? "bg-blue-100 text-blue-800 border-blue-200" :
                              o.status === "CUSTOMER_REJECTED" ? "bg-red-100 text-red-800 border-red-200" :
                              "bg-gray-100 text-gray-700"
                            }`}>
                              {o.status === "CUSTOMER_CHOSEN" ? "✓ Dipilih" :
                               o.status === "OPTIONS_SENT" ? "Terkirim" :
                               o.status === "CUSTOMER_REJECTED" ? "Ditolak" : "Menunggu"}
                            </Badge>
                          </TableCell>
                          <TableCell>
                            {o.status === "PENDING" && (
                              <Button
                                size="sm" variant="ghost"
                                className="h-7 w-7 p-0 text-red-400 hover:text-red-600"
                                onClick={() => void handleDeleteOffer(o.id)}
                              >
                                <Trash2 className="h-3.5 w-3.5" />
                              </Button>
                            )}
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                )}
              </CardContent>
            </Card>

            {(order as any).optionsToken && (
              <Card className="border-blue-200 bg-blue-50/50">
                <CardContent className="p-4 text-sm space-y-1">
                  <p className="font-medium text-blue-800">Link opsi sudah dikirim ke customer:</p>
                  <a
                    href={`/choose-option/${(order as any).optionsToken}`}
                    target="_blank" rel="noopener noreferrer"
                    className="text-blue-600 underline text-xs break-all"
                  >
                    /choose-option/{(order as any).optionsToken}
                  </a>
                </CardContent>
              </Card>
            )}
          </TabsContent>

          {/* ── Tab Status: Timeline + Operational/Payment ── */}
          <TabsContent value="status" className="space-y-4 mt-4">
            {/* 15-Step Workflow Progress */}
            {(() => {
              const CANONICAL_STEPS = [
                { key: "Order Received",    label: "Order Diterima",          icon: "📋" },
                { key: "Admin Review",      label: "Ditinjau Admin",          icon: "🔍" },
                { key: "RFQ Sent",          label: "RFQ ke Vendor",           icon: "📤" },
                { key: "Quote Received",    label: "Penawaran Masuk",         icon: "💬" },
                { key: "Customer Approval", label: "Menunggu Persetujuan",    icon: "✋" },
                { key: "Vendor Confirmed",  label: "Vendor Dikonfirmasi",     icon: "🤝" },
                { key: "In Progress",       label: "Sedang Diproses",         icon: "🔄" },
                { key: "Pickup",            label: "Penjemputan",             icon: "🚚" },
                { key: "In Transit",        label: "Dalam Perjalanan",        icon: "🛣️" },
                { key: "Arrived",           label: "Tiba di Tujuan",          icon: "📍" },
                { key: "Delivered",         label: "Terkirim",                icon: "✅" },
                { key: "POD Uploaded",      label: "Bukti Pengiriman",        icon: "📄" },
                { key: "Invoice Issued",    label: "Invoice Diterbitkan",     icon: "🧾" },
                { key: "Payment Received",  label: "Pembayaran Diterima",     icon: "💳" },
                { key: "Completed",         label: "Selesai",                 icon: "🎉" },
              ];
              const LEGACY_MAP: Record<string, string> = {
                "New Order": "Order Received", "Under Review": "Admin Review",
                "Quotation Sent": "Customer Approval", "Confirmed": "Vendor Confirmed",
              };
              const normalizedStatus = LEGACY_MAP[order.status ?? ""] ?? (order.status ?? "");
              const currentIdx = CANONICAL_STEPS.findIndex(s => s.key === normalizedStatus);
              const isCancelled = order.status === "Cancelled";
              const nextStep = (!isCancelled && currentIdx >= 0 && currentIdx < CANONICAL_STEPS.length - 1)
                ? CANONICAL_STEPS[currentIdx + 1] : null;

              return (
                <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
                  {/* Left: Stepper */}
                  <Card className="lg:col-span-2">
                    <CardHeader className="pb-3">
                      <CardTitle className="text-sm flex items-center gap-2">
                        <Activity className="h-4 w-4 text-indigo-600" />
                        Alur Workflow Order (15 Tahap)
                      </CardTitle>
                    </CardHeader>
                    <CardContent>
                      <div className="grid grid-cols-2 gap-x-4 gap-y-0">
                        {CANONICAL_STEPS.map((step, i) => {
                          const done = !isCancelled && currentIdx > i;
                          const active = !isCancelled && currentIdx === i;
                          return (
                            <div key={step.key} className="flex items-start gap-2.5 py-1.5">
                              <div className="flex flex-col items-center shrink-0">
                                <div className={`w-7 h-7 rounded-full flex items-center justify-center text-xs font-bold border-2 ${
                                  isCancelled ? "bg-gray-100 border-gray-200 text-gray-400" :
                                  active ? "bg-indigo-600 border-indigo-600 text-white shadow-sm shadow-indigo-200" :
                                  done ? "bg-green-500 border-green-500 text-white" :
                                  "bg-white border-gray-200 text-gray-400"
                                }`}>
                                  {done ? "✓" : step.icon}
                                </div>
                              </div>
                              <div className="flex-1 min-w-0">
                                <p className={`text-xs font-medium leading-tight ${
                                  active ? "text-indigo-700" : done ? "text-green-700" : isCancelled ? "text-gray-400" : "text-gray-500"
                                }`}>
                                  {i + 1}. {step.label}
                                </p>
                                {active && (
                                  <span className="text-[10px] text-indigo-500 font-medium">← sekarang</span>
                                )}
                              </div>
                            </div>
                          );
                        })}
                        {isCancelled && (
                          <div className="col-span-2 mt-2 flex items-center gap-2 text-red-600 text-sm font-medium bg-red-50 rounded-lg px-3 py-2">
                            <span className="w-2 h-2 rounded-full bg-red-500 inline-block shrink-0" />
                            Order dibatalkan
                          </div>
                        )}
                      </div>
                    </CardContent>
                  </Card>

                  {/* Right: Advance Status */}
                  <div className="space-y-4">
                    <Card className="border-indigo-100 bg-indigo-50/40">
                      <CardHeader className="pb-2">
                        <CardTitle className="text-sm flex items-center gap-2">
                          <CheckCircle className="h-4 w-4 text-indigo-600" />
                          Ubah Status
                        </CardTitle>
                      </CardHeader>
                      <CardContent className="space-y-3">
                        <div>
                          <p className="text-xs text-muted-foreground mb-1">Status saat ini</p>
                          <Badge className={`${STATUS_COLORS[order.status] ?? "bg-gray-100 text-gray-800"} border text-xs`}>
                            {order.status}
                          </Badge>
                        </div>
                        {nextStep && !isCancelled && (
                          <div>
                            <p className="text-xs text-muted-foreground mb-1.5">Lanjutkan ke</p>
                            <Button
                              size="sm"
                              className="w-full gap-2 bg-indigo-600 hover:bg-indigo-700 text-white text-xs"
                              disabled={updateStatus.isPending}
                              onClick={() => {
                                updateStatus.mutate(
                                  { id: orderId, data: { status: nextStep.key } },
                                  {
                                    onSuccess: () => {
                                      toast({ title: `Status diubah ke "${nextStep.label}"` });
                                      invalidateAll();
                                    },
                                    onError: () => toast({ title: t.common.error, variant: "destructive" }),
                                  },
                                );
                              }}
                            >
                              {updateStatus.isPending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <>{nextStep.icon} {nextStep.label}</>}
                            </Button>
                          </div>
                        )}
                        <div>
                          <p className="text-xs text-muted-foreground mb-1.5">Atau pilih status lain</p>
                          <select
                            className="w-full text-xs border rounded-md px-2 py-1.5 bg-white"
                            value=""
                            onChange={(e) => {
                              const newStatus = e.target.value;
                              if (!newStatus) return;
                              updateStatus.mutate(
                                { id: orderId, data: { status: newStatus } },
                                {
                                  onSuccess: () => {
                                    const label = CANONICAL_STEPS.find(s => s.key === newStatus)?.label ?? newStatus;
                                    toast({ title: `Status diubah ke "${label}"` });
                                    invalidateAll();
                                  },
                                  onError: () => toast({ title: t.common.error, variant: "destructive" }),
                                },
                              );
                            }}
                          >
                            <option value="">— Pilih status —</option>
                            {CANONICAL_STEPS.map(s => (
                              <option key={s.key} value={s.key} disabled={s.key === normalizedStatus}>
                                {s.icon} {s.label}
                              </option>
                            ))}
                            <option value="Cancelled">❌ Batalkan Order</option>
                          </select>
                        </div>
                      </CardContent>
                    </Card>
                  </div>
                </div>
              );
            })()}

            {/* Operational + Payment Status */}
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <Card>
                <CardHeader className="pb-2">
                  <CardTitle className="text-sm flex items-center gap-2">
                    <Truck className="h-4 w-4 text-orange-500" />
                    Status Operasional
                  </CardTitle>
                </CardHeader>
                <CardContent className="space-y-3">
                  {[
                    { value: "pending",     label: "Menunggu Penjemputan", color: "bg-gray-100 text-gray-700",   dot: "bg-gray-400" },
                    { value: "picking_up",  label: "Sedang Dijemput",      color: "bg-yellow-100 text-yellow-700", dot: "bg-yellow-500" },
                    { value: "in_transit",  label: "Dalam Pengiriman",     color: "bg-blue-100 text-blue-700",   dot: "bg-blue-500" },
                    { value: "delivered",   label: "Terkirim",             color: "bg-green-100 text-green-700",  dot: "bg-green-500" },
                    { value: "cancelled",   label: "Dibatalkan",           color: "bg-red-100 text-red-700",     dot: "bg-red-500" },
                  ].map(opt => {
                    const isActive = (opStatus?.operationalStatus ?? "pending") === opt.value;
                    return (
                      <button
                        key={opt.value}
                        disabled={opStatusLoading}
                        onClick={() => updateOpStatus("operationalStatus", opt.value)}
                        className={`w-full flex items-center gap-3 px-3 py-2.5 rounded-lg border-2 text-sm font-medium transition-all text-left
                          ${isActive ? `${opt.color} border-current` : "border-transparent hover:bg-gray-50"}`}
                      >
                        <span className={`w-2.5 h-2.5 rounded-full shrink-0 ${isActive ? opt.dot : "bg-gray-300"}`} />
                        {opt.label}
                        {isActive && <CheckCircle className="h-3.5 w-3.5 ml-auto" />}
                      </button>
                    );
                  })}
                </CardContent>
              </Card>

              <Card>
                <CardHeader className="pb-2">
                  <CardTitle className="text-sm flex items-center gap-2">
                    <DollarSign className="h-4 w-4 text-green-600" />
                    Status Pembayaran
                  </CardTitle>
                </CardHeader>
                <CardContent className="space-y-3">
                  {[
                    { value: "unpaid",  label: "Belum Dibayar", color: "bg-red-100 text-red-700",    dot: "bg-red-500" },
                    { value: "partial", label: "Sebagian",      color: "bg-yellow-100 text-yellow-700", dot: "bg-yellow-500" },
                    { value: "paid",    label: "Lunas",         color: "bg-green-100 text-green-700", dot: "bg-green-500" },
                  ].map(opt => {
                    const isActive = (opStatus?.paymentStatus ?? "unpaid") === opt.value;
                    return (
                      <button
                        key={opt.value}
                        disabled={opStatusLoading}
                        onClick={() => updateOpStatus("paymentStatus", opt.value)}
                        className={`w-full flex items-center gap-3 px-3 py-2.5 rounded-lg border-2 text-sm font-medium transition-all text-left
                          ${isActive ? `${opt.color} border-current` : "border-transparent hover:bg-gray-50"}`}
                      >
                        <span className={`w-2.5 h-2.5 rounded-full shrink-0 ${isActive ? opt.dot : "bg-gray-300"}`} />
                        {opt.label}
                        {isActive && <CheckCircle className="h-3.5 w-3.5 ml-auto" />}
                      </button>
                    );
                  })}

                  {/* Summary */}
                  <div className="mt-3 pt-3 border-t space-y-1">
                    <div className="flex justify-between text-xs text-muted-foreground">
                      <span>Nilai Order</span>
                      <span className="font-medium text-foreground">{idr(order.grandTotal)}</span>
                    </div>
                    {order.finalSellingPrice != null && (
                      <div className="flex justify-between text-xs text-muted-foreground">
                        <span>Harga Jual Final</span>
                        <span className="font-semibold text-green-700">{idr(order.finalSellingPrice)}</span>
                      </div>
                    )}
                  </div>
                </CardContent>
              </Card>
            </div>

            {/* Status Summary Card */}
            <Card className="bg-gradient-to-r from-slate-50 to-indigo-50 border-indigo-100">
              <CardContent className="p-4 flex flex-wrap gap-6">
                <div>
                  <p className="text-xs text-muted-foreground mb-1">Status Order</p>
                  <Badge className={`${STATUS_COLORS[order.status] ?? "bg-gray-100 text-gray-800"} border text-xs`}>
                    {order.status}
                  </Badge>
                </div>
                <div>
                  <p className="text-xs text-muted-foreground mb-1">Status Operasional</p>
                  <Badge className={`text-xs ${
                    opStatus?.operationalStatus === "delivered" ? "bg-green-100 text-green-700 border-green-200 border" :
                    opStatus?.operationalStatus === "in_transit" ? "bg-blue-100 text-blue-700 border-blue-200 border" :
                    opStatus?.operationalStatus === "picking_up" ? "bg-yellow-100 text-yellow-700 border-yellow-200 border" :
                    opStatus?.operationalStatus === "cancelled" ? "bg-red-100 text-red-700 border-red-200 border" :
                    "bg-gray-100 text-gray-700 border-gray-200 border"
                  }`}>
                    {opStatus?.operationalStatus === "delivered" ? "Terkirim" :
                     opStatus?.operationalStatus === "in_transit" ? "Dalam Pengiriman" :
                     opStatus?.operationalStatus === "picking_up" ? "Sedang Dijemput" :
                     opStatus?.operationalStatus === "cancelled" ? "Dibatalkan" : "Menunggu"}
                  </Badge>
                </div>
                <div>
                  <p className="text-xs text-muted-foreground mb-1">Pembayaran</p>
                  <Badge className={`text-xs ${
                    opStatus?.paymentStatus === "paid" ? "bg-green-100 text-green-700 border-green-200 border" :
                    opStatus?.paymentStatus === "partial" ? "bg-yellow-100 text-yellow-700 border-yellow-200 border" :
                    "bg-red-100 text-red-700 border-red-200 border"
                  }`}>
                    {opStatus?.paymentStatus === "paid" ? "Lunas" :
                     opStatus?.paymentStatus === "partial" ? "Sebagian" : "Belum Dibayar"}
                  </Badge>
                </div>
                {order.approvedAt && (
                  <div>
                    <p className="text-xs text-muted-foreground mb-1">Dikonfirmasi</p>
                    <span className="text-xs font-medium">{new Date(order.approvedAt).toLocaleDateString("id-ID", { day: "numeric", month: "short", year: "numeric" })}</span>
                  </div>
                )}
                <div>
                  <p className="text-xs text-muted-foreground mb-1">Order Dibuat</p>
                  <span className="text-xs font-medium">{new Date(order.createdAt).toLocaleDateString("id-ID", { day: "numeric", month: "short", year: "numeric" })}</span>
                </div>
              </CardContent>
            </Card>
          </TabsContent>

          {/* ── Tab 4: Chat AI ── */}
          {isAiOrder && (
            <TabsContent value="chat-ai" className="mt-4">
              <Card>
                <CardHeader className="pb-3">
                  <CardTitle className="text-sm flex items-center gap-2">
                    <MessageCircle className="h-4 w-4 text-violet-600" />
                    Riwayat Percakapan AI
                    <span className="text-xs font-normal text-muted-foreground">— order dibuat via chatbot B2B Marketplace and Logistic</span>
                  </CardTitle>
                </CardHeader>
                <CardContent className="space-y-4">
                  {/* Messages */}
                  <div className="border rounded-xl bg-gray-50 p-3 space-y-3 max-h-[420px] overflow-y-auto">
                    {!chatData ? (
                      <p className="text-sm text-muted-foreground text-center py-4">Memuat riwayat chat...</p>
                    ) : chatData.messages.length === 0 ? (
                      <p className="text-sm text-muted-foreground text-center py-4">Tidak ada pesan</p>
                    ) : (
                      chatData.messages.reduce<{ lastDateStr: string | null; els: React.ReactNode[] }>(
                        (acc, msg) => {
                          const dateStr = msg.createdAt ? new Date(msg.createdAt).toDateString() : null;
                          if (dateStr && dateStr !== acc.lastDateStr) {
                            const label = formatDateLabel(msg.createdAt);
                            if (label) {
                              acc.els.push(
                                <div key={`sep-${msg.id}`} className="flex items-center gap-2 py-1">
                                  <div className="flex-1 h-px bg-gray-200" />
                                  <span className="text-[10px] text-gray-400 font-medium px-2 shrink-0">{label}</span>
                                  <div className="flex-1 h-px bg-gray-200" />
                                </div>
                              );
                            }
                            acc.lastDateStr = dateStr;
                          }
                          acc.els.push(
                            <div key={msg.id} className={`flex gap-2 ${msg.role === "user" ? "flex-row-reverse" : "flex-row"}`}>
                              <div className={`flex-shrink-0 w-6 h-6 rounded-full flex items-center justify-center text-[10px] font-bold mt-0.5 ${
                                msg.role === "user" ? "bg-sky-100 text-sky-700" :
                                msg.role === "admin" ? "bg-amber-100 text-amber-700" :
                                "bg-violet-100 text-violet-700"
                              }`}>
                                {msg.role === "user" ? "C" : msg.role === "admin" ? "A" : "AI"}
                              </div>
                              <div className={`max-w-[75%] rounded-xl px-3 py-2 text-sm leading-relaxed whitespace-pre-wrap ${
                                msg.role === "user"
                                  ? "bg-sky-600 text-white rounded-tr-sm"
                                  : msg.role === "admin"
                                  ? "bg-amber-50 border border-amber-200 text-gray-800 rounded-tl-sm"
                                  : "bg-white border border-gray-200 text-gray-800 shadow-sm rounded-tl-sm"
                              }`}>
                                {msg.role === "admin" && (
                                  <p className="text-[10px] font-semibold text-amber-600 mb-1">Admin (via WA)</p>
                                )}
                                {msg.content}
                                <p className="text-[10px] mt-1 opacity-50">
                                  {formatMsgTime(msg.createdAt)}
                                </p>
                              </div>
                            </div>
                          );
                          return acc;
                        },
                        { lastDateStr: null, els: [] },
                      ).els
                    )}
                    <div ref={chatEndRef} />
                  </div>

                  {/* Admin Reply */}
                  <div className="space-y-2">
                    <Label className="text-sm font-medium">Balas ke Pelanggan (via WhatsApp)</Label>
                    <div className="flex gap-2">
                      <Input
                        placeholder="Tulis balasan untuk pelanggan..."
                        value={adminReply}
                        onChange={(e) => setAdminReply(e.target.value)}
                        onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); void handleAdminReply(); } }}
                        disabled={sendingReply}
                      />
                      <Button
                        onClick={() => void handleAdminReply()}
                        disabled={sendingReply || !adminReply.trim()}
                        className="gap-2 shrink-0"
                      >
                        <Send className="h-4 w-4" />
                        {sendingReply ? "Mengirim..." : "Kirim WA"}
                      </Button>
                    </div>
                    <p className="text-xs text-muted-foreground">
                      Balasan akan dikirim via WhatsApp ke nomor pelanggan ({order?.phone ?? "—"})
                    </p>
                  </div>
                </CardContent>
              </Card>
            </TabsContent>
          )}
        </Tabs>
      </div>

      {/* ── Dialog: Kirim RFQ ── */}
      <Dialog open={rfqDialog} onOpenChange={setRfqDialog}>
        <DialogContent className="max-w-xl">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Send className="h-5 w-5" /> Kirim RFQ ke Vendor
            </DialogTitle>
          </DialogHeader>
          <div className="space-y-4 py-2">
            <div className="rounded-lg border bg-muted/40 px-4 py-3 text-sm space-y-1">
              <div className="font-medium">{order.orderNumber}</div>
              <div className="text-muted-foreground">{order.shipmentType} · {order.origin} → {order.destination}</div>
            </div>
            <div>
              <Label className="text-sm font-medium mb-2 block">Pilih Vendor ({selectedVendors.length} dipilih)</Label>
              <div className="space-y-2 max-h-56 overflow-y-auto">
                {activeVendors.length === 0 && (
                  <p className="text-sm text-muted-foreground">Tidak ada vendor aktif.</p>
                )}
                {activeVendors.map((v) => (
                  <label
                    key={v.id}
                    className="flex items-center gap-3 rounded-lg border px-3 py-2 cursor-pointer hover:bg-muted/50 transition-colors"
                  >
                    <Checkbox
                      checked={selectedVendors.includes(v.id)}
                      onCheckedChange={(checked) => {
                        setSelectedVendors((prev) =>
                          checked ? [...prev, v.id] : prev.filter((x) => x !== v.id)
                        );
                      }}
                    />
                    <div className="flex-1 min-w-0">
                      <div className="font-medium text-sm">{v.name}</div>
                      <div className="text-xs text-muted-foreground">
                        {v.phone ?? "No phone"} · {v.serviceType ?? "Semua tipe"}
                      </div>
                    </div>
                    {!v.phone && (
                      <Badge variant="outline" className="text-xs text-orange-600">No WA</Badge>
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
          <DialogFooter>
            <Button variant="outline" onClick={() => setRfqDialog(false)}>Batal</Button>
            <Button onClick={() => void handleSendRfq()} disabled={selectedVendors.length === 0} className="gap-2">
              <Send className="h-4 w-4" />
              {`Kirim ke ${selectedVendors.length} Vendor`}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ── Dialog: Tambah Quote Manual ── */}
      <Dialog open={!!quoteDialog?.open} onOpenChange={(open) => { if (!open) setQuoteDialog(null); }}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Plus className="h-5 w-5" /> Tambah Penawaran Manual
            </DialogTitle>
          </DialogHeader>
          <div className="space-y-3 py-2">
            <div>
              <Label className="text-sm">Vendor *</Label>
              <select
                className="mt-1 w-full rounded-md border bg-background px-3 py-2 text-sm"
                value={quoteForm.vendorId}
                onChange={(e) => setQuoteForm((f) => ({ ...f, vendorId: e.target.value }))}
              >
                <option value="">Pilih vendor...</option>
                {activeVendors.map((v) => (
                  <option key={v.id} value={v.id}>{v.name}</option>
                ))}
              </select>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label className="text-sm">Harga Vendor (IDR) *</Label>
                <Input className="mt-1" placeholder="5000000" value={quoteForm.vendorPrice}
                  onChange={(e) => setQuoteForm((f) => ({ ...f, vendorPrice: e.target.value }))} />
              </div>
              <div>
                <Label className="text-sm">Estimasi Hari</Label>
                <Input className="mt-1" type="number" placeholder="3" value={quoteForm.estimatedDays}
                  onChange={(e) => setQuoteForm((f) => ({ ...f, estimatedDays: e.target.value }))} />
              </div>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label className="text-sm">ETA Pickup</Label>
                <Input className="mt-1" placeholder="Besok pagi" value={quoteForm.estimatedPickup}
                  onChange={(e) => setQuoteForm((f) => ({ ...f, estimatedPickup: e.target.value }))} />
              </div>
              <div>
                <Label className="text-sm">ETA Delivery</Label>
                <Input className="mt-1" placeholder="2-3 hari" value={quoteForm.estimatedDelivery}
                  onChange={(e) => setQuoteForm((f) => ({ ...f, estimatedDelivery: e.target.value }))} />
              </div>
            </div>
            <div>
              <Label className="text-sm">Harga Jual ke Customer (IDR)</Label>
              <Input className="mt-1" placeholder="Masukkan harga jual..." value={quoteForm.fixedSellingPrice}
                onChange={(e) => setQuoteForm((f) => ({ ...f, fixedSellingPrice: e.target.value }))} />
              {quoteForm.vendorPrice && quoteForm.fixedSellingPrice && (
                <p className="text-xs text-muted-foreground mt-1">
                  Profit: {idr(parseFloat(quoteForm.fixedSellingPrice) - (parseFloat(quoteForm.vendorPrice) || 0))}
                </p>
              )}
            </div>
            <div>
              <Label className="text-sm">Catatan Vendor</Label>
              <Input className="mt-1" placeholder="Catatan..." value={quoteForm.vendorNotes}
                onChange={(e) => setQuoteForm((f) => ({ ...f, vendorNotes: e.target.value }))} />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setQuoteDialog(null)}>Batal</Button>
            <Button onClick={handleCreateQuote} disabled={createQuote.isPending}>
              {createQuote.isPending ? "Menyimpan..." : "Simpan Quote"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ── Dialog: Edit Quote ── */}
      <Dialog open={!!editDialog} onOpenChange={(open) => { if (!open) setEditDialog(null); }}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Edit className="h-5 w-5" /> Edit Quote — {editDialog?.vendorName}
            </DialogTitle>
          </DialogHeader>
          <div className="space-y-3 py-2">
            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label className="text-sm">Harga Vendor (IDR) *</Label>
                <Input className="mt-1" placeholder="5000000" value={editForm.vendorPrice}
                  onChange={(e) => setEditForm((f) => ({ ...f, vendorPrice: e.target.value }))} />
              </div>
              <div>
                <Label className="text-sm">Estimasi Hari</Label>
                <Input className="mt-1" type="number" placeholder="3" value={editForm.estimatedDays}
                  onChange={(e) => setEditForm((f) => ({ ...f, estimatedDays: e.target.value }))} />
              </div>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label className="text-sm">ETA Pickup</Label>
                <Input className="mt-1" placeholder="Besok pagi" value={editForm.estimatedPickup}
                  onChange={(e) => setEditForm((f) => ({ ...f, estimatedPickup: e.target.value }))} />
              </div>
              <div>
                <Label className="text-sm">ETA Delivery</Label>
                <Input className="mt-1" placeholder="2-3 hari" value={editForm.estimatedDelivery}
                  onChange={(e) => setEditForm((f) => ({ ...f, estimatedDelivery: e.target.value }))} />
              </div>
            </div>
            <div>
              <Label className="text-sm">Harga Jual ke Customer (IDR)</Label>
              <Input className="mt-1" placeholder="Masukkan harga jual..." value={editForm.fixedSellingPrice}
                onChange={(e) => setEditForm((f) => ({ ...f, fixedSellingPrice: e.target.value }))} />
              {editForm.vendorPrice && editForm.fixedSellingPrice && (
                <p className="text-xs text-muted-foreground mt-1">
                  Profit: {idr(parseFloat(editForm.fixedSellingPrice) - (parseFloat(editForm.vendorPrice) || 0))}
                </p>
              )}
            </div>
            <div>
              <Label className="text-sm">Catatan Vendor</Label>
              <Input className="mt-1" placeholder="Catatan..." value={editForm.vendorNotes}
                onChange={(e) => setEditForm((f) => ({ ...f, vendorNotes: e.target.value }))} />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setEditDialog(null)}>Batal</Button>
            <Button onClick={handleUpdateQuote} disabled={updateQuote.isPending}>
              {updateQuote.isPending ? "Menyimpan..." : "Update Quote"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ── Dialog: Approve & Send ── */}
      <Dialog open={!!approveDialog} onOpenChange={(open) => { if (!open) setApproveDialog(null); }}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2 text-green-700">
              <CheckCircle className="h-5 w-5" /> Approve & Kirim ke Customer
            </DialogTitle>
          </DialogHeader>
          {approveDialog && (
            <div className="space-y-3 py-2">
              <p className="text-sm text-muted-foreground">
                Konfirmasi pilihan penawaran ini. Harga jual akan dikirim ke customer via WhatsApp.
                <strong className="text-foreground"> Harga vendor tidak akan ditampilkan ke customer.</strong>
              </p>
              <div className="rounded-lg border bg-muted/40 p-4 space-y-2 text-sm">
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Vendor</span>
                  <span className="font-medium">{approveDialog.vendorName}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Harga Vendor (internal)</span>
                  <span className="font-mono">{idr(approveDialog.vendorPrice)}</span>
                </div>
                <div className="flex justify-between border-t pt-2 mt-2">
                  <span className="font-medium">Harga Jual ke Customer</span>
                  <span className="font-bold text-lg text-green-700">{idr(approveDialog.sellingPrice)}</span>
                </div>
                {approveDialog.estimatedDelivery && (
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">Estimasi Pengiriman</span>
                    <span>{approveDialog.estimatedDelivery}</span>
                  </div>
                )}
              </div>
              <p className="text-xs text-muted-foreground">
                Setelah approve, status order otomatis berubah ke "Quotation Sent" dan customer menerima WA.
              </p>
            </div>
          )}
          <DialogFooter>
            <Button variant="outline" onClick={() => setApproveDialog(null)}>Batal</Button>
            <Button
              className="gap-2 bg-green-600 hover:bg-green-700"
              onClick={handleApproveQuote}
              disabled={approveQuote.isPending}
            >
              <CheckCircle className="h-4 w-4" />
              {approveQuote.isPending ? "Menyimpan..." : "Approve & Kirim WA"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
      {/* ── Dialog Tambah Opsi Vendor (Multi-Mode) ── */}
      <Dialog open={offerDialog} onOpenChange={setOfferDialog}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Tambah Opsi untuk Customer</DialogTitle>
          </DialogHeader>
          <div className="space-y-3 py-2">
            <div>
              <label className="text-xs font-medium text-muted-foreground">Vendor (opsional)</label>
              <select
                className="w-full mt-1 border rounded-md px-3 py-2 text-sm bg-background"
                value={offerForm.vendorId}
                onChange={(e) => setOfferForm({ ...offerForm, vendorId: e.target.value })}
              >
                <option value="">— Pilih vendor (opsional) —</option>
                {vendors.map((v) => (
                  <option key={v.id} value={v.id}>{v.name}</option>
                ))}
              </select>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="text-xs font-medium text-muted-foreground">Harga Vendor (Rp) *</label>
                <input
                  type="number" min="0" placeholder="0"
                  className="w-full mt-1 border rounded-md px-3 py-2 text-sm bg-background"
                  value={offerForm.offerPrice}
                  onChange={(e) => setOfferForm({ ...offerForm, offerPrice: e.target.value })}
                />
              </div>
              <div>
                <label className="text-xs font-medium text-muted-foreground">Harga Customer (Rp)</label>
                <input
                  type="number" min="0" placeholder="Sama dgn harga vendor"
                  className="w-full mt-1 border rounded-md px-3 py-2 text-sm bg-background"
                  value={offerForm.finalCustomerPrice}
                  onChange={(e) => setOfferForm({ ...offerForm, finalCustomerPrice: e.target.value })}
                />
              </div>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="text-xs font-medium text-muted-foreground">Tahun Unit</label>
                <input
                  type="number" min="2000" max="2030" placeholder="contoh: 2022"
                  className="w-full mt-1 border rounded-md px-3 py-2 text-sm bg-background"
                  value={offerForm.vehicleYear}
                  onChange={(e) => setOfferForm({ ...offerForm, vehicleYear: e.target.value })}
                />
              </div>
              <div>
                <label className="text-xs font-medium text-muted-foreground">Transit (hari)</label>
                <input
                  type="number" min="1" placeholder="contoh: 3"
                  className="w-full mt-1 border rounded-md px-3 py-2 text-sm bg-background"
                  value={offerForm.transitDays}
                  onChange={(e) => setOfferForm({ ...offerForm, transitDays: e.target.value })}
                />
              </div>
            </div>
            <div>
              <label className="text-xs font-medium text-muted-foreground">Catatan</label>
              <input
                type="text" placeholder="Catatan untuk customer (opsional)"
                className="w-full mt-1 border rounded-md px-3 py-2 text-sm bg-background"
                value={offerForm.notes}
                onChange={(e) => setOfferForm({ ...offerForm, notes: e.target.value })}
              />
            </div>
            <p className="text-xs text-muted-foreground bg-amber-50 border border-amber-200 rounded-md p-2">
              ⚠️ Nama vendor <strong>tidak</strong> akan ditampilkan ke customer — hanya label "Opsi 1", "Opsi 2", dst.
            </p>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setOfferDialog(false)}>Batal</Button>
            <Button onClick={() => void handleCreateOffer()}>Simpan Opsi</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ── Dialog: Lihat Link Form Vendor ── */}
      <Dialog open={linkFormDialog} onOpenChange={(open) => { if (!open) { setLinkFormDialog(false); setLinkFormData(null); setResendResults({}); } }}>
        <DialogContent className="max-w-2xl max-h-[85vh] flex flex-col">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Link className="h-5 w-5 text-blue-500" />
              Link Form Vendor
              {linkFormData && (
                <span className="text-sm font-normal text-muted-foreground ml-1">— {linkFormData.rfqNumber}</span>
              )}
            </DialogTitle>
          </DialogHeader>

          {linkFormLoading ? (
            <div className="flex items-center justify-center py-12">
              <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
              <span className="ml-2 text-sm text-muted-foreground">Memuat data vendor...</span>
            </div>
          ) : linkFormData ? (
            <div className="overflow-y-auto flex-1 space-y-2 pr-1">
              {linkFormData.vendors.length === 0 ? (
                <p className="text-sm text-muted-foreground text-center py-8">Tidak ada vendor di RFQ ini.</p>
              ) : (
                linkFormData.vendors.map((v) => {
                  const isResending = resendingVendorIds.has(v.vendorId);
                  const result = resendResults[v.vendorId];
                  return (
                    <div
                      key={v.vendorId}
                      className={`rounded-lg border px-4 py-3 space-y-2 ${v.hasSubmitted ? "bg-green-50 border-green-200" : "bg-background"}`}
                    >
                      {/* Vendor header row */}
                      <div className="flex items-center gap-3 flex-wrap">
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-2 flex-wrap">
                            <span className="font-medium text-sm">{v.vendorName}</span>
                            {v.hasSubmitted ? (
                              <Badge className="bg-green-100 text-green-700 border-green-200 text-xs gap-1">
                                <CheckCircle className="h-3 w-3" /> Sudah Submit
                              </Badge>
                            ) : (
                              <Badge variant="outline" className="text-xs text-orange-600 border-orange-300">
                                Belum Submit
                              </Badge>
                            )}
                            {!v.hasPhone && (
                              <Badge variant="outline" className="text-xs text-muted-foreground">No WA</Badge>
                            )}
                          </div>
                          {v.phone && (
                            <p className="text-xs text-muted-foreground mt-0.5">{v.phone}</p>
                          )}
                        </div>

                        {/* Resend WA button */}
                        <Button
                          size="sm"
                          variant={result === "ok" ? "default" : result === "fail" ? "destructive" : "outline"}
                          className={`h-7 gap-1.5 text-xs shrink-0 ${result === "ok" ? "bg-green-600 hover:bg-green-700" : ""}`}
                          disabled={isResending || !v.hasPhone}
                          onClick={() => handleResendVendorWa(v.vendorId)}
                          title={!v.hasPhone ? "Vendor tidak memiliki nomor WhatsApp" : "Kirim ulang WA dengan link form"}
                        >
                          {isResending
                            ? <Loader2 className="h-3 w-3 animate-spin" />
                            : result === "ok"
                            ? <CheckCircle className="h-3 w-3" />
                            : <MessageCircle className="h-3 w-3" />}
                          {isResending ? "Mengirim..." : result === "ok" ? "Terkirim!" : result === "fail" ? "Coba Lagi" : "Kirim Ulang WA"}
                        </Button>
                      </div>

                      {/* Form URL row */}
                      {v.formUrl ? (
                        <div className="flex items-center gap-2 bg-muted/50 rounded-md px-3 py-1.5">
                          <span className="text-xs font-mono text-muted-foreground truncate flex-1 min-w-0">
                            {v.formUrl}
                          </span>
                          <button
                            className="shrink-0 text-muted-foreground hover:text-foreground transition-colors"
                            title="Salin link"
                            onClick={() => {
                              void navigator.clipboard.writeText(v.formUrl!);
                              toast({ title: "Link disalin", description: v.vendorName });
                            }}
                          >
                            <Copy className="h-3.5 w-3.5" />
                          </button>
                          <a
                            href={v.formUrl}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="shrink-0 text-muted-foreground hover:text-blue-600 transition-colors"
                            title="Buka form"
                          >
                            <ExternalLink className="h-3.5 w-3.5" />
                          </a>
                        </div>
                      ) : (
                        <p className="text-xs text-muted-foreground">Link tidak tersedia (token RFQ belum di-set).</p>
                      )}
                    </div>
                  );
                })
              )}
            </div>
          ) : null}
          <DialogFooter className="pt-2 shrink-0">
            <Button variant="outline" onClick={() => { setLinkFormDialog(false); setLinkFormData(null); setResendResults({}); }}>Tutup</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* [NEW-RFQ-FLOW] Blast V2 Dialog */}
      <Dialog open={blastV2Dialog} onOpenChange={(o) => !o && setBlastV2Dialog(false)}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Send className="h-4 w-4 text-blue-600" /> Blast ke Vendor (New Flow)
            </DialogTitle>
          </DialogHeader>
          <div className="space-y-4 py-2">
            <p className="text-sm text-muted-foreground">
              Pilih vendor dan kirim link form penawaran personal ke masing-masing vendor via WhatsApp.
            </p>
            <div>
              <Label className="text-xs font-semibold mb-2 block">Pilih Vendor</Label>
              <div className="max-h-48 overflow-y-auto border rounded-lg divide-y">
                {activeVendors.length === 0 ? (
                  <p className="text-sm text-muted-foreground p-3">Tidak ada vendor aktif</p>
                ) : activeVendors.map((v) => (
                  <label key={v.id} className="flex items-center gap-3 p-2.5 hover:bg-muted/30 cursor-pointer">
                    <Checkbox
                      checked={blastV2VendorIds.includes(v.id)}
                      onCheckedChange={(checked) => {
                        setBlastV2VendorIds(prev =>
                          checked ? [...prev, v.id] : prev.filter(id => id !== v.id)
                        );
                      }}
                    />
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-medium truncate">{v.name}</p>
                      <p className="text-xs text-muted-foreground">{v.serviceType ?? "—"} {v.phone ? `· ${v.phone}` : "· ⚠️ No WA"}</p>
                    </div>
                  </label>
                ))}
              </div>
              <p className="text-xs text-muted-foreground mt-1">{blastV2VendorIds.length} vendor dipilih</p>
            </div>
            <div>
              <Label className="text-xs font-semibold">Batas Waktu Respon (jam)</Label>
              <Input
                type="number"
                value={blastV2Hours}
                onChange={(e) => setBlastV2Hours(e.target.value)}
                className="mt-1 h-8 text-sm w-28"
                min={1}
                max={168}
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setBlastV2Dialog(false)}>Batal</Button>
            <Button
              disabled={blastV2VendorIds.length === 0 || blastingV2}
              onClick={async () => {
                setBlastingV2(true);
                try {
                  const res = await fetch(`/api/logistic/orders/${orderId}/rfq-blast`, {
                    method: "POST",
                    headers: { "Content-Type": "application/json" },
                    credentials: "include",
                    body: JSON.stringify({ vendorIds: blastV2VendorIds, deadlineHours: Number(blastV2Hours) }),
                  });
                  const d = await res.json() as { ok: boolean; rfqId?: number; sentCount: number; rfqNumber: string; message?: string };
                  if (!res.ok) throw new Error(d.message ?? "Gagal blast");
                  toast({ title: `Blast berhasil ke ${d.sentCount} vendor`, description: `RFQ: ${d.rfqNumber}` });
                  setBlastV2Dialog(false);
                  invalidateAll();
                  if (d.rfqId) navigate(`/logistics/rfq/${d.rfqId}/comparison`);
                } catch (e) {
                  toast({ title: "Gagal blast", description: (e as Error).message, variant: "destructive" });
                } finally {
                  setBlastingV2(false);
                }
              }}
            >
              {blastingV2 ? <><Loader2 className="h-4 w-4 animate-spin mr-1" /> Mengirim...</> : <><Send className="h-4 w-4 mr-1" /> Blast</>}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ── Dialog Edit Detail Order ── */}
      <Dialog open={editDetailDialog} onOpenChange={setEditDetailDialog}>
        <DialogContent className="max-w-lg max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Edit Detail Order</DialogTitle>
          </DialogHeader>
          <div className="grid grid-cols-2 gap-3 py-2">
            <div className="col-span-2">
              <Label className="text-xs">Tipe Layanan</Label>
              <Input value={editDetailForm.shipmentType} onChange={e => setEditDetailForm(f => ({ ...f, shipmentType: e.target.value }))} placeholder="Trucking, Sea Freight, ..." />
            </div>
            <div>
              <Label className="text-xs">Origin (Asal)</Label>
              <Input value={editDetailForm.origin} onChange={e => setEditDetailForm(f => ({ ...f, origin: e.target.value }))} placeholder="Kota asal" />
            </div>
            <div>
              <Label className="text-xs">Destination (Tujuan)</Label>
              <Input value={editDetailForm.destination} onChange={e => setEditDetailForm(f => ({ ...f, destination: e.target.value }))} placeholder="Kota tujuan" />
            </div>
            <div className="col-span-2">
              <Label className="text-xs">Komoditi</Label>
              <Input value={editDetailForm.commodity} onChange={e => setEditDetailForm(f => ({ ...f, commodity: e.target.value }))} placeholder="Kopi, Elektronik, dll" />
            </div>
            <div className="col-span-2">
              <Label className="text-xs">Deskripsi Kargo</Label>
              <Input value={editDetailForm.cargoDescription} onChange={e => setEditDetailForm(f => ({ ...f, cargoDescription: e.target.value }))} placeholder="Deskripsi muatan" />
            </div>
            <div>
              <Label className="text-xs">Berat (kg)</Label>
              <Input type="number" value={editDetailForm.grossWeight} onChange={e => setEditDetailForm(f => ({ ...f, grossWeight: e.target.value }))} placeholder="0" />
            </div>
            <div>
              <Label className="text-xs">Volume (CBM)</Label>
              <Input type="number" value={editDetailForm.volumeCbm} onChange={e => setEditDetailForm(f => ({ ...f, volumeCbm: e.target.value }))} placeholder="0" />
            </div>
            <div>
              <Label className="text-xs">Jumlah Koli</Label>
              <Input type="number" value={editDetailForm.jumlahKoli} onChange={e => setEditDetailForm(f => ({ ...f, jumlahKoli: e.target.value }))} placeholder="0" />
            </div>
            <div>
              <Label className="text-xs">Tanggal Dibutuhkan</Label>
              <DatePicker value={editDetailForm.requiredDate} onChange={v => setEditDetailForm(f => ({ ...f, requiredDate: v }))} />
            </div>
            <div className="col-span-2">
              <Label className="text-xs">Catatan</Label>
              <Input value={editDetailForm.notes} onChange={e => setEditDetailForm(f => ({ ...f, notes: e.target.value }))} placeholder="Catatan tambahan" />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setEditDetailDialog(false)}>Batal</Button>
            <Button onClick={saveEditDetail} disabled={editDetailSaving}>
              {editDetailSaving ? <><Loader2 className="h-4 w-4 animate-spin mr-1" />Menyimpan...</> : "Simpan"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ── Dialog: Konversi ke Freight Shipment ── */}
      <Dialog open={convertDialog} onOpenChange={setConvertDialog}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Truck className="h-5 w-5 text-indigo-600" /> Konversi ke Freight Shipment
            </DialogTitle>
          </DialogHeader>
          <div className="space-y-4 py-2 text-sm">
            <div className="rounded-lg border bg-slate-50 p-3 space-y-1.5">
              <InfoRow label="Shipper" value={order?.customerName ?? "—"} />
              <InfoRow label="Consignee" value={(order as any)?.companyName ?? order?.customerName ?? "—"} />
              <InfoRow label="Rute" value={`${order?.origin ?? "—"} → ${order?.destination ?? "—"}`} />
              <InfoRow label="Komoditi" value={order?.commodity ?? order?.shipmentType ?? "General Cargo"} />
              {order?.grossWeight != null && <InfoRow label="Berat" value={`${order.grossWeight} kg`} />}
              <InfoRow label="Sales Order" value={(order as any)?.linkedSalesDocNumber ?? "—"} />
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs">Mode Transportasi</Label>
              <select
                className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                value={convertForm.transportMode}
                onChange={e => setConvertForm(f => ({ ...f, transportMode: e.target.value }))}
              >
                <option value="">— Pilih (opsional) —</option>
                <option value="sea">Sea (Laut)</option>
                <option value="air">Air (Udara)</option>
                <option value="land">Land (Darat)</option>
                <option value="multimodal">Multimodal</option>
              </select>
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs">Tipe Kargo</Label>
              <select
                className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                value={convertForm.cargoType}
                onChange={e => setConvertForm(f => ({ ...f, cargoType: e.target.value }))}
              >
                <option value="">— Pilih (opsional) —</option>
                <option value="FCL">FCL</option>
                <option value="LCL">LCL</option>
                <option value="Air">Air</option>
              </select>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setConvertDialog(false)} disabled={converting}>Batal</Button>
            <Button
              className="gap-2 bg-indigo-600 hover:bg-indigo-700 text-white"
              onClick={handleConvertToShipment}
              disabled={converting}
            >
              {converting ? <><Loader2 className="h-4 w-4 animate-spin" /> Memproses...</> : <><Truck className="h-4 w-4" /> Konversi</>}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ── Modal: Buat Vendor Fulfillment ── */}
      <Dialog open={vfModal.open} onOpenChange={(o) => { if (!vfSubmitting) setVfModal(s => ({ ...s, open: o, notes: o ? s.notes : "" })); }}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Truck className="h-5 w-5 text-blue-600" /> Buat Vendor Fulfillment
            </DialogTitle>
          </DialogHeader>
          {vfModal.item && (
            <div className="space-y-3 py-1 text-sm">
              <div className="rounded-lg border bg-blue-50 border-blue-100 p-3 space-y-1.5">
                <div className="flex justify-between gap-4">
                  <span className="text-muted-foreground shrink-0">Layanan</span>
                  <span className="text-right font-semibold">{vfModal.item.serviceName}</span>
                </div>
                {!!vfModal.item.priceSnapshot && !!(vfModal.item.priceSnapshot as Record<string,unknown>).vendorName && (
                  <div className="flex justify-between gap-4">
                    <span className="text-muted-foreground shrink-0">Vendor</span>
                    <span className="text-right font-semibold text-slate-700">{String((vfModal.item.priceSnapshot as Record<string,unknown>).vendorName)}</span>
                  </div>
                )}
                {vfModal.item.serviceType && (
                  <div className="flex justify-between gap-4">
                    <span className="text-muted-foreground shrink-0">Service Type</span>
                    <span className="text-right">{vfModal.item.serviceType}</span>
                  </div>
                )}
                {vfModal.item.category && (
                  <div className="flex justify-between gap-4">
                    <span className="text-muted-foreground shrink-0">Kategori</span>
                    <span className="text-right">{vfModal.item.category}</span>
                  </div>
                )}
                <div className="flex justify-between gap-4">
                  <span className="text-muted-foreground shrink-0">Total Harga Customer</span>
                  <span className="text-right font-semibold text-sky-700">{idr(vfModal.item.subtotal)}</span>
                </div>
                {!!vfModal.item.priceSnapshot && !!(vfModal.item.priceSnapshot as Record<string,unknown>).unit && (
                  <div className="flex justify-between gap-4">
                    <span className="text-muted-foreground shrink-0">Unit</span>
                    <span className="text-right">/ {String((vfModal.item.priceSnapshot as Record<string,unknown>).unit)}</span>
                  </div>
                )}
              </div>
              {vfModal.item.calculationInput && Object.keys(vfModal.item.calculationInput).length > 0 && (
                <div className="rounded-lg border bg-slate-50 p-3 space-y-1">
                  <p className="text-[11px] font-semibold text-slate-500 mb-1">Input Kalkulator</p>
                  {Object.entries(vfModal.item.calculationInput)
                    .filter(([, v]) => v !== undefined && v !== null && v !== "")
                    .map(([k, v]) => (
                      <div key={k} className="flex justify-between gap-4 text-xs">
                        <span className="text-muted-foreground shrink-0">{k}</span>
                        <span className="text-right font-medium">{String(v)}</span>
                      </div>
                    ))}
                </div>
              )}
              {vfModal.item.templateSnapshot && (() => {
                const snap = vfModal.item!.templateSnapshot as Record<string,unknown>;
                const st = snap.serviceType as string | undefined;
                const cat = snap.category as string | undefined;
                const ver = snap.version as string | undefined;
                if (!st && !cat && !ver) return null;
                return (
                  <div className="rounded-lg border bg-violet-50 border-violet-100 p-3 space-y-1">
                    <p className="text-[11px] font-semibold text-slate-500 mb-1">Template Snapshot</p>
                    {st && <div className="flex justify-between gap-4 text-xs"><span className="text-muted-foreground">serviceType</span><span className="font-medium">{st}</span></div>}
                    {cat && <div className="flex justify-between gap-4 text-xs"><span className="text-muted-foreground">category</span><span className="font-medium">{cat}</span></div>}
                    {ver && <div className="flex justify-between gap-4 text-xs"><span className="text-muted-foreground">version</span><span className="font-medium">{ver}</span></div>}
                  </div>
                );
              })()}
              <div className="space-y-1.5">
                <Label className="text-xs text-slate-500">Catatan Admin (opsional)</Label>
                <textarea
                  className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring resize-none"
                  rows={2}
                  placeholder="Instruksi atau catatan untuk vendor..."
                  value={vfModal.notes}
                  onChange={(e) => setVfModal(s => ({ ...s, notes: e.target.value }))}
                  disabled={vfSubmitting}
                />
              </div>
              <p className="text-xs text-muted-foreground bg-amber-50 border border-amber-100 rounded px-3 py-2">
                Vendor fulfillment akan dibuat dengan status <strong>pending</strong>. Data snapshot order item akan tersimpan untuk referensi vendor.
              </p>
            </div>
          )}
          <DialogFooter>
            <Button variant="outline" onClick={() => setVfModal({ open: false, item: null, notes: "" })} disabled={vfSubmitting}>Batal</Button>
            <Button
              className="gap-2 bg-blue-600 hover:bg-blue-700 text-white"
              onClick={() => submitVendorFulfillment(vfModal.notes)}
              disabled={vfSubmitting}
            >
              {vfSubmitting
                ? <><Loader2 className="h-4 w-4 animate-spin" /> Memproses...</>
                : <><Truck className="h-4 w-4" /> Buat Vendor Fulfillment</>}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

    </AppShell>
  );
}

function InfoRow({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="flex justify-between gap-4">
      <span className="text-muted-foreground shrink-0">{label}</span>
      <span className="text-right">{value}</span>
    </div>
  );
}

function ComparisonCard({ icon, label, quote, badge }: {
  icon: React.ReactNode;
  label: string;
  quote: LogisticQuote | null | undefined;
  badge: string;
}) {
  const idr = (n: number | null | undefined) =>
    n == null ? "—"
    : new Intl.NumberFormat("id-ID", { style: "currency", currency: "IDR", maximumFractionDigits: 0 }).format(n);

  return (
    <Card className="border">
      <CardContent className="p-4">
        <div className="flex items-center gap-2 mb-2">
          {icon}
          <span className={`text-xs font-semibold px-2 py-0.5 rounded-full ${badge}`}>{label}</span>
        </div>
        {quote ? (
          <div>
            <div className="font-medium text-sm">{quote.vendorName}</div>
            <div className="text-lg font-bold mt-0.5">{idr(quote.sellingPrice)}</div>
            {quote.estimatedDays != null && (
              <div className="text-xs text-muted-foreground mt-0.5">{quote.estimatedDays} hari</div>
            )}
          </div>
        ) : (
          <div className="text-sm text-muted-foreground">Belum ada data</div>
        )}
      </CardContent>
    </Card>
  );
}
