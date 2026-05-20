import { useState, useEffect, useCallback } from "react";
import { useLocation } from "wouter";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import { Textarea } from "@/components/ui/textarea";
import {
  ArrowLeft, Search, Ship, Truck, CheckCircle2, Clock,
  MapPin, Package, RefreshCw, AlertCircle, FileText,
  Circle, ArrowRight, Loader2, ThumbsUp, ThumbsDown, RotateCcw, Tag,
} from "lucide-react";
import { formatDate } from "@/lib/utils";
import { cn } from "@/lib/utils";

const BASE = import.meta.env.BASE_URL?.replace(/\/$/, "") ?? "";

type DriverJobStatus =
  | "ASSIGNED" | "ACCEPTED" | "ON_THE_WAY_TO_PICKUP" | "ARRIVED_AT_PICKUP"
  | "PICKED_UP" | "IN_TRANSIT" | "ARRIVED_AT_DESTINATION" | "DELIVERED"
  | "COMPLETED" | "CANCELLED";

interface DriverLog { id: number; status: DriverJobStatus; timestamp: string; }
interface DriverJob {
  id: number; jobNumber: string; status: DriverJobStatus;
  vehicleType: string | null;
  pickupDateTime: string | null; deliveryDateTime: string | null;
  cargoDescription: string | null; weight: string | null;
  distance: string | null; assignedAt: string; completedAt: string | null;
  logs: DriverLog[];
}

interface RfqQuote {
  rfqId: number;
  rfqStatus: string;
  quotedPrice: number | null;
  quotedAt: string | null;
  quoteNotes: string | null;
  customerResponseNotes: string | null;
  customerRespondedAt: string | null;
}

interface TrackingData {
  id: number; orderNumber: string;
  shipmentType: string; origin: string; destination: string;
  status: string; createdAt: string;
  items: { id: number; category: string; serviceName: string }[];
  driverJob: DriverJob | null;
  rfqQuote: RfqQuote | null;
}

async function fetchTracking(orderNumber: string): Promise<TrackingData> {
  const res = await fetch(`${BASE}/api/logistic/orders/track/${encodeURIComponent(orderNumber)}`);
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error((body as { message?: string }).message ?? "Order tidak ditemukan");
  }
  return res.json() as Promise<TrackingData>;
}

const ORDER_STEPS = [
  { key: "New Order",   label: "Order Masuk",        icon: FileText },
  { key: "Processing",  label: "Diproses",            icon: Clock },
  { key: "In Progress", label: "Dalam Pengerjaan",    icon: Truck },
  { key: "Completed",   label: "Selesai",             icon: CheckCircle2 },
];

const ORDER_STATUS_RANK: Record<string, number> = {
  "New Order": 0, "Processing": 1, "In Progress": 2, "Completed": 3,
};

const DRIVER_STEPS: { key: DriverJobStatus; label: string }[] = [
  { key: "ASSIGNED",              label: "Driver Ditugaskan" },
  { key: "ACCEPTED",              label: "Driver Menerima" },
  { key: "ON_THE_WAY_TO_PICKUP",  label: "Menuju Pickup" },
  { key: "ARRIVED_AT_PICKUP",     label: "Tiba di Pickup" },
  { key: "PICKED_UP",             label: "Barang Diambil" },
  { key: "IN_TRANSIT",            label: "Dalam Perjalanan" },
  { key: "ARRIVED_AT_DESTINATION", label: "Tiba di Tujuan" },
  { key: "DELIVERED",             label: "Terkirim" },
  { key: "COMPLETED",             label: "Selesai" },
];

const DRIVER_STATUS_RANK: Record<string, number> = Object.fromEntries(
  DRIVER_STEPS.map((s, i) => [s.key, i])
);

const STATUS_COLORS: Record<string, string> = {
  "New Order":   "bg-yellow-100 text-yellow-800 border-yellow-200",
  "Processing":  "bg-blue-100 text-blue-800 border-blue-200",
  "In Progress": "bg-indigo-100 text-indigo-800 border-indigo-200",
  "Completed":   "bg-green-100 text-green-800 border-green-200",
  "Cancelled":   "bg-red-100 text-red-800 border-red-200",
};

function formatDateTime(iso: string) {
  return new Date(iso).toLocaleString("id-ID", {
    day: "2-digit", month: "short", year: "numeric",
    hour: "2-digit", minute: "2-digit",
  });
}

function idr(n: number | null | undefined) {
  if (n == null) return "—";
  return new Intl.NumberFormat("id-ID", { style: "currency", currency: "IDR", maximumFractionDigits: 0 }).format(n);
}

function OrderStepper({ status }: { status: string }) {
  const current = ORDER_STATUS_RANK[status] ?? 0;
  return (
    <div className="flex items-center w-full gap-0">
      {ORDER_STEPS.map((step, i) => {
        const done = i < current;
        const active = i === current;
        const Icon = step.icon;
        return (
          <div key={step.key} className="flex items-center flex-1 last:flex-none">
            <div className="flex flex-col items-center gap-1">
              <div className={cn(
                "w-8 h-8 rounded-full flex items-center justify-center border-2 transition-all",
                done  ? "bg-green-500 border-green-500 text-white" :
                active ? "bg-primary border-primary text-primary-foreground shadow-md" :
                          "bg-muted border-border text-muted-foreground"
              )}>
                {done ? <CheckCircle2 className="w-4 h-4" /> : <Icon className="w-4 h-4" />}
              </div>
              <span className={cn(
                "text-[10px] font-medium text-center leading-tight max-w-[60px]",
                active ? "text-primary" : done ? "text-green-600" : "text-muted-foreground"
              )}>
                {step.label}
              </span>
            </div>
            {i < ORDER_STEPS.length - 1 && (
              <div className={cn(
                "flex-1 h-0.5 mx-1 mb-4 rounded-full",
                i < current ? "bg-green-400" : "bg-border"
              )} />
            )}
          </div>
        );
      })}
    </div>
  );
}

function DriverStepper({ job }: { job: DriverJob }) {
  const current = DRIVER_STATUS_RANK[job.status] ?? 0;
  const isCancelled = job.status === "CANCELLED";
  const visibleSteps = DRIVER_STEPS.filter((s) => s.key !== "COMPLETED" || job.status === "COMPLETED");

  return (
    <div className="space-y-0">
      {visibleSteps.map((step, i) => {
        const stepRank = DRIVER_STATUS_RANK[step.key];
        const done = stepRank < current;
        const active = stepRank === current;
        const log = [...job.logs].reverse().find((l) => l.status === step.key);

        return (
          <div key={step.key} className="flex gap-3">
            <div className="flex flex-col items-center">
              <div className={cn(
                "w-7 h-7 rounded-full flex items-center justify-center border-2 flex-shrink-0 mt-0.5",
                isCancelled ? "bg-red-100 border-red-300 text-red-400" :
                done   ? "bg-green-500 border-green-500 text-white" :
                active ? "bg-primary border-primary text-primary-foreground" :
                          "bg-muted border-border text-muted-foreground"
              )}>
                {done && !isCancelled
                  ? <CheckCircle2 className="w-3.5 h-3.5" />
                  : active && !isCancelled
                    ? <Circle className="w-3.5 h-3.5 fill-current" />
                    : <Circle className="w-2 h-2" />
                }
              </div>
              {i < visibleSteps.length - 1 && (
                <div className={cn(
                  "w-0.5 flex-1 my-1",
                  done && !isCancelled ? "bg-green-400" : "bg-border"
                )} />
              )}
            </div>
            <div className={cn("pb-4", i === visibleSteps.length - 1 && "pb-0")}>
              <p className={cn(
                "text-sm font-medium",
                active && !isCancelled ? "text-primary" :
                done && !isCancelled ? "text-foreground" : "text-muted-foreground"
              )}>
                {step.label}
              </p>
              {log && (
                <p className="text-xs text-muted-foreground mt-0.5">
                  {formatDateTime(log.timestamp)}
                </p>
              )}
            </div>
          </div>
        );
      })}
    </div>
  );
}

function QuoteCard({
  rfqQuote,
  orderNumber,
  onRespond,
}: {
  rfqQuote: RfqQuote;
  orderNumber: string;
  onRespond: () => void;
}) {
  const [showNotes, setShowNotes] = useState(false);
  const [notes, setNotes] = useState("");
  const [pendingResponse, setPendingResponse] = useState<"approved" | "revision_requested" | "rejected" | null>(null);
  const qc = useQueryClient();

  const respondMut = useMutation({
    mutationFn: async (payload: { response: "approved" | "revision_requested" | "rejected"; notes?: string }) => {
      const r = await fetch(`${BASE}/api/logistic/rfq/quote-respond`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ orderNumber, ...payload }),
      });
      const d = await r.json();
      if (!r.ok) throw new Error(d.message ?? "Gagal mengirim respons");
      return d;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["tracking", orderNumber] });
      setShowNotes(false);
      setPendingResponse(null);
      setNotes("");
      onRespond();
    },
  });

  const { rfqStatus, quotedPrice, quotedAt, quoteNotes, customerResponseNotes, customerRespondedAt } = rfqQuote;

  // Jika customer sudah approved
  if (rfqStatus === "customer_approved") {
    return (
      <div className="bg-card border border-green-200 rounded-xl p-5 space-y-3">
        <div className="flex items-center gap-2 text-green-700 font-semibold text-sm">
          <ThumbsUp className="w-4 h-4" /> Anda telah menyetujui penawaran ini
        </div>
        <div className="text-sm text-muted-foreground">
          Tim kami akan segera memproses pengiriman Anda. Harga yang disepakati: <strong className="text-foreground">{idr(quotedPrice)}</strong>.
          {customerResponseNotes && <p className="mt-1">Catatan Anda: {customerResponseNotes}</p>}
        </div>
        {customerRespondedAt && (
          <p className="text-xs text-muted-foreground">Disetujui pada {formatDateTime(customerRespondedAt)}</p>
        )}
      </div>
    );
  }

  // Jika customer sudah rejected
  if (rfqStatus === "customer_rejected") {
    return (
      <div className="bg-card border border-red-200 rounded-xl p-5 space-y-3">
        <div className="flex items-center gap-2 text-red-700 font-semibold text-sm">
          <ThumbsDown className="w-4 h-4" /> Anda telah menolak penawaran ini
        </div>
        <div className="text-sm text-muted-foreground">
          Tim kami akan menghubungi Anda untuk membahas opsi lain.
          {customerResponseNotes && <p className="mt-1">Alasan Anda: {customerResponseNotes}</p>}
        </div>
        {customerRespondedAt && (
          <p className="text-xs text-muted-foreground">Ditolak pada {formatDateTime(customerRespondedAt)}</p>
        )}
      </div>
    );
  }

  // Jika customer minta revisi
  if (rfqStatus === "customer_revision_requested") {
    return (
      <div className="bg-card border border-yellow-200 rounded-xl p-5 space-y-3">
        <div className="flex items-center gap-2 text-yellow-700 font-semibold text-sm">
          <RotateCcw className="w-4 h-4" /> Anda telah meminta revisi penawaran
        </div>
        <div className="text-sm text-muted-foreground">
          Tim kami sedang meninjau permintaan revisi Anda dan akan menghubungi Anda kembali.
          {customerResponseNotes && <p className="mt-1">Catatan Anda: {customerResponseNotes}</p>}
        </div>
        {customerRespondedAt && (
          <p className="text-xs text-muted-foreground">Diminta pada {formatDateTime(customerRespondedAt)}</p>
        )}
      </div>
    );
  }

  // Jika penawaran sudah dikirim dan menunggu respons customer
  if (rfqStatus === "customer_quoted" && quotedPrice != null) {
    return (
      <div className="bg-card border border-primary/20 rounded-xl p-5 space-y-4">
        <div className="flex items-center gap-2 text-primary font-semibold text-sm">
          <Tag className="w-4 h-4" /> Penawaran Harga Tersedia
        </div>
        <p className="text-xs text-muted-foreground">
          Tim kami telah menyiapkan penawaran terbaik untuk pengiriman Anda. Silakan tinjau dan berikan respons Anda.
        </p>

        <div className="bg-muted/40 rounded-lg px-4 py-3 space-y-2">
          <div className="flex items-center justify-between">
            <span className="text-sm text-muted-foreground">Harga Penawaran</span>
            <span className="text-xl font-bold text-foreground">{idr(quotedPrice)}</span>
          </div>
          {quotedAt && (
            <div className="flex items-center justify-between text-xs text-muted-foreground">
              <span>Dikirim</span>
              <span>{formatDateTime(quotedAt)}</span>
            </div>
          )}
          {quoteNotes && (
            <div className="text-xs text-muted-foreground bg-background rounded p-2 border border-border">
              📝 {quoteNotes}
            </div>
          )}
        </div>

        {respondMut.isError && (
          <p className="text-xs text-red-500">{(respondMut.error as Error).message}</p>
        )}

        {respondMut.isSuccess && !showNotes && (
          <p className="text-xs text-green-600 font-medium">✓ Respons berhasil dikirim. Terima kasih!</p>
        )}

        {showNotes && pendingResponse && (
          <div className="space-y-2">
            <p className="text-sm text-muted-foreground">
              {pendingResponse === "revision_requested"
                ? "Apa yang perlu direvisi? (opsional)"
                : pendingResponse === "rejected"
                  ? "Alasan penolakan (opsional)"
                  : "Catatan tambahan (opsional)"}
            </p>
            <Textarea
              placeholder={
                pendingResponse === "revision_requested"
                  ? "Contoh: Harga terlalu tinggi, mohon diskusikan lagi..."
                  : pendingResponse === "rejected"
                    ? "Contoh: Sudah mendapatkan vendor lain..."
                    : "Catatan untuk tim kami..."
              }
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              rows={3}
              className="text-sm"
            />
            <div className="flex gap-2">
              <Button
                size="sm"
                variant="outline"
                className="flex-1"
                onClick={() => { setShowNotes(false); setPendingResponse(null); setNotes(""); }}
                disabled={respondMut.isPending}
              >
                Batal
              </Button>
              <Button
                size="sm"
                className={cn(
                  "flex-1",
                  pendingResponse === "approved" && "bg-green-600 hover:bg-green-700",
                  pendingResponse === "revision_requested" && "bg-yellow-600 hover:bg-yellow-700",
                  pendingResponse === "rejected" && "bg-red-600 hover:bg-red-700",
                )}
                onClick={() => respondMut.mutate({ response: pendingResponse, notes: notes || undefined })}
                disabled={respondMut.isPending}
              >
                {respondMut.isPending
                  ? <Loader2 className="w-4 h-4 animate-spin" />
                  : pendingResponse === "approved" ? "Konfirmasi Setuju"
                    : pendingResponse === "revision_requested" ? "Kirim Permintaan Revisi"
                      : "Konfirmasi Tolak"}
              </Button>
            </div>
          </div>
        )}

        {!showNotes && !respondMut.isSuccess && (
          <div className="space-y-2">
            <p className="text-xs text-muted-foreground text-center">Berikan respons Anda:</p>
            <div className="grid grid-cols-3 gap-2">
              <Button
                size="sm"
                className="bg-green-600 hover:bg-green-700 text-white text-xs"
                onClick={() => { setPendingResponse("approved"); setShowNotes(true); }}
                disabled={respondMut.isPending}
              >
                <ThumbsUp className="w-3.5 h-3.5 mr-1" /> Setuju
              </Button>
              <Button
                size="sm"
                variant="outline"
                className="text-yellow-700 border-yellow-300 hover:bg-yellow-50 text-xs"
                onClick={() => { setPendingResponse("revision_requested"); setShowNotes(true); }}
                disabled={respondMut.isPending}
              >
                <RotateCcw className="w-3.5 h-3.5 mr-1" /> Revisi
              </Button>
              <Button
                size="sm"
                variant="outline"
                className="text-red-600 border-red-300 hover:bg-red-50 text-xs"
                onClick={() => { setPendingResponse("rejected"); setShowNotes(true); }}
                disabled={respondMut.isPending}
              >
                <ThumbsDown className="w-3.5 h-3.5 mr-1" /> Tolak
              </Button>
            </div>
          </div>
        )}
      </div>
    );
  }

  return null;
}

export default function TrackPage() {
  const [, setLocation] = useLocation();
  const [input, setInput] = useState("");
  const [searchTerm, setSearchTerm] = useState("");
  const [lastRefreshed, setLastRefreshed] = useState<Date | null>(null);
  const [respondedFlag, setRespondedFlag] = useState(false);

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const o = params.get("order");
    if (o) { setInput(o); setSearchTerm(o.toUpperCase().trim()); }
  }, []);

  const {
    data: tracking, isLoading, isError, error, refetch, isFetching,
  } = useQuery<TrackingData, Error>({
    queryKey: ["tracking", searchTerm],
    queryFn: () => fetchTracking(searchTerm),
    enabled: !!searchTerm,
    refetchInterval: 30_000,
    staleTime: 10_000,
  });

  useEffect(() => {
    if (tracking) setLastRefreshed(new Date());
  }, [tracking]);

  function handleSearch() {
    const trimmed = input.trim().toUpperCase();
    if (!trimmed) return;
    setSearchTerm(trimmed);
    setRespondedFlag(false);
  }

  const handleRefresh = useCallback(() => { refetch(); }, [refetch]);

  return (
    <div className="min-h-screen bg-background">
      <nav className="border-b border-border bg-card sticky top-0 z-50">
        <div className="max-w-2xl mx-auto px-4 h-14 flex items-center gap-3">
          <button onClick={() => setLocation("/")} className="text-muted-foreground hover:text-foreground">
            <ArrowLeft className="w-4 h-4" />
          </button>
          <span className="font-semibold text-foreground">Lacak Pengiriman</span>
        </div>
      </nav>

      <div className="max-w-2xl mx-auto px-4 py-8 space-y-6">
        <div>
          <h1 className="text-xl font-bold text-foreground mb-1">Tracking Order</h1>
          <p className="text-sm text-muted-foreground">Masukkan nomor order untuk melihat status pengiriman secara real-time.</p>
        </div>

        <div className="flex gap-2">
          <Input
            placeholder="Contoh: LOG-250513-12345"
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && handleSearch()}
            className="font-mono uppercase"
          />
          <Button onClick={handleSearch} disabled={isLoading}>
            {isLoading ? <Loader2 className="w-4 h-4 animate-spin" /> : <Search className="w-4 h-4" />}
            <span className="ml-1 hidden sm:inline">{isLoading ? "Mencari..." : "Cari"}</span>
          </Button>
        </div>

        {isError && (
          <div className="text-center py-10 text-muted-foreground">
            <AlertCircle className="w-10 h-10 mx-auto mb-3 text-red-400" />
            <p className="font-medium text-foreground">Order tidak ditemukan</p>
            <p className="text-sm mt-1">{error?.message ?? "Pastikan nomor order sudah benar."}</p>
          </div>
        )}

        {tracking && (
          <div className="space-y-4">
            {/* Auto-refresh indicator */}
            <div className="flex items-center justify-between text-xs text-muted-foreground">
              <span className="flex items-center gap-1">
                <RefreshCw className={cn("w-3 h-3", isFetching && "animate-spin")} />
                {isFetching ? "Memperbarui..." : lastRefreshed ? `Diperbarui ${formatDateTime(lastRefreshed.toISOString())}` : ""}
              </span>
              <button onClick={handleRefresh} disabled={isFetching}
                className="flex items-center gap-1 hover:text-foreground transition-colors disabled:opacity-50">
                Perbarui sekarang
              </button>
            </div>

            {/* Penawaran harga — tampil di atas jika ada dan relevan */}
            {tracking.rfqQuote && ["customer_quoted", "customer_approved", "customer_rejected", "customer_revision_requested"].includes(tracking.rfqQuote.rfqStatus) && (
              <QuoteCard
                rfqQuote={tracking.rfqQuote}
                orderNumber={tracking.orderNumber}
                onRespond={() => {
                  setRespondedFlag(true);
                  setTimeout(() => refetch(), 1000);
                }}
              />
            )}

            {/* Header — order number & status */}
            <div className="bg-card border border-border rounded-xl p-5">
              <div className="flex items-start justify-between gap-3 mb-4">
                <div>
                  <p className="text-xs text-muted-foreground mb-1 uppercase tracking-wider">Nomor Order</p>
                  <p className="text-xl font-bold font-mono text-foreground">{tracking.orderNumber}</p>
                </div>
                <Badge className={cn("border font-medium", STATUS_COLORS[tracking.status] ?? "bg-gray-100 text-gray-800")}>
                  {tracking.status}
                </Badge>
              </div>
              <Separator className="mb-4" />

              {/* Route */}
              <div className="flex items-center gap-2 mb-4 bg-muted/40 rounded-lg px-4 py-3">
                <div className="text-center flex-1">
                  <p className="text-xs text-muted-foreground mb-0.5">Asal</p>
                  <p className="font-semibold text-sm text-foreground leading-tight">{tracking.origin}</p>
                </div>
                <div className="flex flex-col items-center gap-1 flex-shrink-0">
                  <ArrowRight className="w-4 h-4 text-muted-foreground" />
                  <span className="text-[10px] text-muted-foreground">{tracking.shipmentType}</span>
                </div>
                <div className="text-center flex-1">
                  <p className="text-xs text-muted-foreground mb-0.5">Tujuan</p>
                  <p className="font-semibold text-sm text-foreground leading-tight">{tracking.destination}</p>
                </div>
              </div>

              {/* Order stepper */}
              <OrderStepper status={tracking.status} />

              <Separator className="mt-5 mb-4" />
              <div className="grid grid-cols-2 gap-y-2 text-sm">
                <span className="text-muted-foreground">Tgl Order</span>
                <span className="font-medium text-foreground text-right">{formatDate(tracking.createdAt)}</span>
              </div>
            </div>

            {/* Driver job tracking */}
            {tracking.driverJob ? (
              <div className="bg-card border border-border rounded-xl p-5">
                <div className="flex items-center justify-between mb-4">
                  <h3 className="font-semibold text-foreground text-sm flex items-center gap-2">
                    <Truck className="w-4 h-4 text-primary" />
                    Status Pengiriman Driver
                  </h3>
                  <Badge variant="outline" className="text-xs font-mono">
                    {tracking.driverJob.jobNumber}
                  </Badge>
                </div>

                {/* Driver info */}
                <div className="bg-muted/40 rounded-lg px-4 py-3 mb-4 grid grid-cols-2 gap-y-2 text-sm">
                  {tracking.driverJob.vehicleType && (
                    <>
                      <span className="text-muted-foreground">Kendaraan</span>
                      <span className="font-medium text-right">{tracking.driverJob.vehicleType}</span>
                    </>
                  )}
                  {tracking.driverJob.pickupDateTime && (
                    <>
                      <span className="text-muted-foreground flex items-center gap-1"><MapPin className="w-3 h-3" />Est. Pickup</span>
                      <span className="font-medium text-right text-xs leading-snug">{formatDateTime(tracking.driverJob.pickupDateTime)}</span>
                    </>
                  )}
                  {tracking.driverJob.deliveryDateTime && (
                    <>
                      <span className="text-muted-foreground">Est. Tiba</span>
                      <span className="font-medium text-right text-xs leading-snug">{formatDateTime(tracking.driverJob.deliveryDateTime)}</span>
                    </>
                  )}
                </div>

                {/* Driver status timeline */}
                <DriverStepper job={tracking.driverJob} />

              </div>
            ) : (
              tracking.status !== "Completed" && (
                <div className="bg-card border border-border rounded-xl p-4 flex items-center gap-3 text-sm text-muted-foreground">
                  <Clock className="w-4 h-4 flex-shrink-0" />
                  <p>Driver belum ditugaskan. Anda akan menerima notifikasi setelah order dikonfirmasi dan driver ditetapkan.</p>
                </div>
              )
            )}

            {/* Services */}
            {tracking.items.length > 0 && (
              <div className="bg-card border border-border rounded-xl p-5">
                <h3 className="font-semibold text-foreground text-sm mb-3 flex items-center gap-2">
                  <Package className="w-4 h-4 text-primary" />
                  Layanan ({tracking.items.length})
                </h3>
                <div className="space-y-2">
                  {tracking.items.map((item) => (
                    <div key={item.id} className="flex items-center justify-between py-2 border-b border-border last:border-0 gap-3">
                      <div>
                        <Badge variant="outline" className="text-xs mr-1">{item.category}</Badge>
                        <span className="text-sm text-foreground">{item.serviceName}</span>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}

            <div className="bg-muted/40 rounded-lg p-4 text-xs text-muted-foreground">
              <p className="font-medium text-foreground mb-1">Informasi</p>
              <p>Status diperbarui otomatis setiap 30 detik. Hubungi kami jika ada pertanyaan mengenai pengiriman Anda.</p>
            </div>

            <Button variant="outline" className="w-full" onClick={() => setLocation("/jasa")}>
              <Ship className="w-4 h-4 mr-2" /> Buat Order Baru
            </Button>
          </div>
        )}
      </div>
    </div>
  );
}
