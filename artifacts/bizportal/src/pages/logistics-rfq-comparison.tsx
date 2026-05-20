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
} from "lucide-react";

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
  isNewUpdate: boolean;
  openedAt: string | null;
  submittedAt: string | null;
  formUrl: string;
}

interface RankingBadge {
  label: string;
  color: string;
}

function getRankingBadges(vendor: VendorRow, allVendors: VendorRow[]): RankingBadge[] {
  const badges: RankingBadge[] = [];
  const answered = allVendors.filter(v => v.offeredPrice != null || v.basicPrice != null);
  if (answered.length < 2) return badges;

  const prices = answered.map(v => v.offeredPrice ?? v.basicPrice ?? Infinity);
  const minPrice = Math.min(...prices);
  const myPrice = vendor.offeredPrice ?? vendor.basicPrice;

  if (myPrice != null && myPrice === minPrice) {
    badges.push({ label: "💰 Best Price", color: "bg-green-100 text-green-700 border-green-200" });
  }

  const answeredWithEta = answered.filter(v => v.eta);
  if (answeredWithEta.length > 0 && vendor.eta) {
    const sortedEtas = [...answeredWithEta].sort((a, b) => (a.eta ?? "").localeCompare(b.eta ?? ""));
    if (sortedEtas[0]?.vendorId === vendor.vendorId) {
      badges.push({ label: "⚡ Tercepat", color: "bg-blue-100 text-blue-700 border-blue-200" });
    }
  }

  if (vendor.submittedAt) {
    const answeredWithTime = answered.filter(v => v.submittedAt);
    const sortedByTime = [...answeredWithTime].sort((a, b) =>
      new Date(a.submittedAt!).getTime() - new Date(b.submittedAt!).getTime()
    );
    if (sortedByTime[0]?.vendorId === vendor.vendorId) {
      badges.push({ label: "🏃 Respon Tercepat", color: "bg-purple-100 text-purple-700 border-purple-200" });
    }
  }

  return badges;
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
  stats: {
    total: number; answered: number; pending: number;
    rejected: number; counterOffer: number; expired: number; selected: number;
  };
  vendors: VendorRow[];
  activities: { id: number; actorType: string; actorName: string | null; action: string; description: string | null; createdAt: string }[];
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
    mutationFn: async () => {
      const price = Number(quotePrice);
      if (!price || price <= 0) throw new Error("Harga jual tidak valid");
      const r = await fetch(`/api/logistic/rfq/${rfqId}/send-customer-quote`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ sellingPrice: price, quoteNotes: quoteNotes || undefined, sendWhatsApp: quoteSendWa }),
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

  const copyLink = useCallback((url: string) => {
    navigator.clipboard.writeText(url).then(() => toast({ title: "Link disalin" }));
  }, [toast]);

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

  const hasSelected = data.stats.selected > 0;
  const isCustomerQuoted = data.rfqStatus === "customer_quoted";
  const isCustomerApproved = data.rfqStatus === "customer_approved";
  const isCustomerRejected = data.rfqStatus === "customer_rejected";
  const isCustomerRevision = data.rfqStatus === "customer_revision_requested";
  const isClosed = data.rfqStatus === "closed";
  const canSendQuote = ["vendor_selected", "customer_revision_requested"].includes(data.rfqStatus);
  const canClose = ["customer_approved", "customer_rejected", "customer_quoted"].includes(data.rfqStatus);

  // Pre-fill harga jual saat buka dialog
  const openQuoteDialog = () => {
    const selectedVendor = data.vendors.find((v) => v.status === "selected");
    const vendorPrice = selectedVendor ? (selectedVendor.offeredPrice ?? selectedVendor.basicPrice) : null;
    const suggested = vendorPrice ? Math.round(vendorPrice * 1.2) : (data.finalSellingPrice ?? 0);
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
          <div className="bg-gray-50 border border-gray-200 rounded-xl p-4 flex items-center gap-3">
            <Lock className="w-4 h-4 text-gray-500 flex-shrink-0" />
            <div className="text-sm text-gray-600">
              <span className="font-semibold text-gray-800">RFQ telah ditutup.</span>{" "}
              Semua aktivitas untuk RFQ ini sudah selesai.
            </div>
          </div>
        )}

        {/* Banner: customer approved */}
        {isCustomerApproved && (
          <div className="bg-green-50 border border-green-200 rounded-xl p-4 space-y-2">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div className="flex items-center gap-2 text-green-800 font-semibold text-sm">
                <ThumbsUp className="w-4 h-4 flex-shrink-0" />
                Customer menyetujui penawaran ini
              </div>
              <Button
                size="sm"
                className="text-xs bg-green-700 hover:bg-green-800 text-white"
                onClick={() => closeMut.mutate("Customer approved")}
                disabled={closeMut.isPending}
              >
                {closeMut.isPending ? <Loader2 className="w-3.5 h-3.5 animate-spin mr-1" /> : <Lock className="w-3.5 h-3.5 mr-1" />}
                Tutup & Proses Order
              </Button>
            </div>
            <div className="grid grid-cols-2 md:grid-cols-3 gap-x-6 gap-y-1 text-xs text-green-900">
              <span><span className="text-green-600">Harga Disetujui:</span> <strong>{idr(data.quotedPrice)}</strong></span>
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

        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          {/* Vendor comparison table */}
          <div className="lg:col-span-2 space-y-3">
            <h2 className="font-semibold text-gray-800">Perbandingan Vendor</h2>
            {data.vendors.length === 0 ? (
              <Card>
                <CardContent className="p-8 text-center text-gray-500">
                  <AlertCircle className="w-8 h-8 mx-auto mb-2 text-gray-300" />
                  Belum ada vendor yang di-blast. Kembali ke detail order dan pilih vendor.
                </CardContent>
              </Card>
            ) : (
              data.vendors.map((v, idx) => (
                <VendorCard
                  key={v.linkId}
                  vendor={v}
                  rank={idx + 1}
                  rankingBadges={getRankingBadges(v, data.vendors)}
                  hasSelected={hasSelected}
                  onSelect={() => {
                    setSelectDialog({ linkId: v.linkId, vendorName: v.vendorName, price: v.offeredPrice ?? v.basicPrice });
                    setSellingPrice(v.offeredPrice ? String(Math.round(v.offeredPrice * 1.2)) : "");
                  }}
                  onRevision={() => { setRevisionDialog({ linkId: v.linkId, vendorName: v.vendorName }); setRevisionMsg(""); }}
                  onReject={() => actionMut.mutate({ linkId: v.linkId, action: "reject" })}
                  onMarkRead={() => actionMut.mutate({ linkId: v.linkId, action: "mark_read" })}
                  onCopyLink={() => copyLink(window.location.origin + v.formUrl.replace(/^https?:\/\/[^/]+/, ""))}
                />
              ))
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
              return (
                <div className="bg-teal-50 border border-teal-200 rounded-lg p-3 text-xs space-y-1">
                  <p className="font-semibold text-teal-800 text-sm">Vendor Terpilih: {sv.vendorName}</p>
                  <div className="text-teal-700 grid grid-cols-2 gap-x-4">
                    <span>Harga Vendor: <strong>{idr(sv.offeredPrice ?? sv.basicPrice)}</strong></span>
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
              onClick={() => sendQuoteMut.mutate()}
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

function VendorCard({
  vendor, rank, rankingBadges, hasSelected, onSelect, onRevision, onReject, onMarkRead, onCopyLink,
}: {
  vendor: VendorRow; rank: number; rankingBadges?: RankingBadge[]; hasSelected: boolean;
  onSelect: () => void; onRevision: () => void;
  onReject: () => void; onMarkRead: () => void; onCopyLink: () => void;
}) {
  const isSelected = vendor.status === "selected";
  const canAct = !hasSelected && !["rejected", "expired", "not_selected"].includes(vendor.status);
  const hasAnswer = !!vendor.submittedAt;
  const price = vendor.offeredPrice ?? vendor.basicPrice;

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
              </div>
              {vendor.phone && <p className="text-xs text-gray-400">{vendor.phone}</p>}
            </div>
          </div>
          <Badge className={STATUS_COLOR[vendor.status] ?? "bg-gray-100 text-gray-500"}>
            {STATUS_LABEL[vendor.status] ?? vendor.status}
          </Badge>
        </div>

        <div className="grid grid-cols-2 gap-3 mb-3 text-sm">
          <InfoItem label="Harga Penawaran" value={idr(price)} highlight={!!hasAnswer} />
          <InfoItem label="ETA" value={vendor.eta ?? "—"} />
          <InfoItem label="Dibuka" value={vendor.openedAt ? timeSince(vendor.openedAt) : "Belum dibuka"} />
          <InfoItem label="Submit" value={vendor.submittedAt ? timeSince(vendor.submittedAt) : "Belum"} />
        </div>

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
