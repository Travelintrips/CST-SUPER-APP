import { useState } from "react";
import { useLocation, useParams } from "wouter";
import { AppShell } from "@/components/layout/AppShell";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useCompany } from "@/contexts/CompanyContext";
import {
  Plane, ArrowLeft, Send, CheckCircle2, XCircle, Package,
  Calendar, Weight, MapPin, RefreshCw, BookOpen, Clock,
  AlertCircle, ChevronDown, ChevronUp, User, FileText,
} from "lucide-react";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import {
  Collapsible, CollapsibleContent, CollapsibleTrigger,
} from "@/components/ui/collapsible";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { FreightCustomsPanel } from "@/components/freight/FreightCustomsPanel";

/* ── helpers ─────────────────────────────────────────────────────────────── */
const IDR = (n: number | null | undefined) =>
  n == null ? "-" : new Intl.NumberFormat("id-ID", { style: "currency", currency: "IDR", maximumFractionDigits: 0 }).format(Number(n));

const fmtDate = (d: string | null | undefined) => {
  if (!d) return "-";
  try { return new Intl.DateTimeFormat("id-ID", { day: "2-digit", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" }).format(new Date(d)); }
  catch { return d; }
};
const fmtDateShort = (d: string | null | undefined) => {
  if (!d) return "-";
  try { return new Intl.DateTimeFormat("id-ID", { day: "2-digit", month: "short", year: "numeric" }).format(new Date(d)); }
  catch { return d; }
};

const STATUS_LABEL: Record<string, string> = {
  draft: "Draft", estimated: "Estimasi", waiting_rate: "Menunggu Rate",
  rate_requested: "Rate Diminta", rate_received: "Rate Diterima",
  quoted: "Quoted → Menunggu Approval", approved: "Disetujui Customer",
  booked: "Booked", departed: "Berangkat", arrived: "Tiba",
  delivered: "Terkirim", completed: "Selesai",
  cancelled: "Dibatalkan", quote_declined: "Penawaran Ditolak",
};
const STATUS_COLOR: Record<string, string> = {
  draft: "bg-gray-800/40 text-gray-300 border-gray-600",
  estimated: "bg-blue-900/40 text-blue-300 border-blue-600",
  waiting_rate: "bg-yellow-900/40 text-yellow-300 border-yellow-600",
  rate_requested: "bg-orange-900/40 text-orange-300 border-orange-600",
  rate_received: "bg-purple-900/40 text-purple-300 border-purple-600",
  quoted: "bg-cyan-900/40 text-cyan-300 border-cyan-600",
  approved: "bg-teal-900/40 text-teal-300 border-teal-600",
  booked: "bg-emerald-900/40 text-emerald-300 border-emerald-600",
  departed: "bg-sky-900/40 text-sky-300 border-sky-600",
  arrived: "bg-indigo-900/40 text-indigo-300 border-indigo-600",
  delivered: "bg-green-900/40 text-green-300 border-green-600",
  completed: "bg-emerald-900/40 text-emerald-400 border-emerald-500",
  cancelled: "bg-red-900/40 text-red-300 border-red-600",
  quote_declined: "bg-rose-900/40 text-rose-300 border-rose-600",
};

const TRACKING_STATUSES = [
  { v: "booked",            l: "Booked" },
  { v: "cargo_received",    l: "Cargo Diterima" },
  { v: "departed",          l: "Berangkat" },
  { v: "in_transit",        l: "In Transit" },
  { v: "arrived",           l: "Tiba di Bandara Tujuan" },
  { v: "customs_clearance", l: "Customs Clearance" },
  { v: "out_for_delivery",  l: "Dalam Pengiriman" },
  { v: "delivered",         l: "Terkirim ke Penerima" },
  { v: "completed",         l: "Selesai" },
];

/* ── InfoRow helper ──────────────────────────────────────────────────────── */
function InfoRow({ label, value, mono }: { label: string; value: React.ReactNode; mono?: boolean }) {
  return (
    <div className="flex items-start gap-2 py-1.5 border-b border-border/20 last:border-0">
      <span className="text-xs text-muted-foreground min-w-[140px] shrink-0">{label}</span>
      <span className={`text-xs text-foreground ${mono ? "font-mono" : ""}`}>{value ?? "—"}</span>
    </div>
  );
}

/* ── Main Page ────────────────────────────────────────────────────────────── */
export default function AirFreightOrderDetailPage() {
  const { id } = useParams<{ id: string }>();
  const [, navigate] = useLocation();
  const { activeCompanyId } = useCompany();
  const qc = useQueryClient();

  // ── Final Quote form state ──────────────────────────────────────────────
  const [selectedRateId, setSelectedRateId] = useState<string>("");
  const [finalPriceIdr,  setFinalPriceIdr]  = useState("");
  const [markupAmount,   setMarkupAmount]   = useState("");
  const [ppnAmount,      setPpnAmount]      = useState("");
  const [grandTotal,     setGrandTotal]     = useState("");
  const [adminNotes,     setAdminNotes]     = useState("");
  const [quoteErr,       setQuoteErr]       = useState<string | null>(null);
  const [quoteSuccess,   setQuoteSuccess]   = useState<string | null>(null);

  // ── Booking form state ──────────────────────────────────────────────────
  const [bookingNumber, setBookingNumber] = useState("");
  const [mawb,          setMawb]          = useState("");
  const [hawb,          setHawb]          = useState("");
  const [bookingNote,   setBookingNote]   = useState("");
  const [bookingErr,    setBookingErr]    = useState<string | null>(null);

  // ── Tracking update state ───────────────────────────────────────────────
  const [newTrackStatus, setNewTrackStatus] = useState("");
  const [trackNote,      setTrackNote]      = useState("");
  const [trackOpen,      setTrackOpen]      = useState(false);

  // ── Queries ─────────────────────────────────────────────────────────────
  const { data: order, isLoading } = useQuery({
    queryKey: ["air-freight-order", id],
    queryFn: async () => {
      const r = await fetch(`/api/air-freight/orders/${id}`, { credentials: "include" });
      if (!r.ok) throw new Error("Gagal memuat order");
      return r.json() as Promise<any>;
    },
    enabled: !!id,
  });

  const { data: rates } = useQuery({
    queryKey: ["air-freight-rates-select", activeCompanyId],
    queryFn: async () => {
      const qs = new URLSearchParams({ valid_only: "true", limit: "200" });
      if (activeCompanyId) qs.set("companyId", String(activeCompanyId));
      const r = await fetch(`/api/air-freight/rates?${qs}`, { credentials: "include" });
      if (!r.ok) throw new Error("Gagal memuat rates");
      const data = await r.json();
      return (data.data ?? []) as any[];
    },
  });

  const { data: events, refetch: refetchEvents } = useQuery({
    queryKey: ["air-freight-tracking-events", id],
    queryFn: async () => {
      const r = await fetch(`/api/air-freight/orders/${id}/tracking-events`, { credentials: "include" });
      if (!r.ok) return [];
      return r.json() as Promise<any[]>;
    },
    enabled: !!id,
  });

  // ── Mutations ────────────────────────────────────────────────────────────
  const sendQuoteMut = useMutation({
    mutationFn: async () => {
      setQuoteErr(null); setQuoteSuccess(null);
      if (!finalPriceIdr || !grandTotal) throw new Error("final_price_idr dan grand_total wajib diisi");
      const payload: any = {
        final_price_idr:  Number(finalPriceIdr),
        grand_total:      Number(grandTotal),
        admin_notes:      adminNotes || undefined,
      };
      if (selectedRateId) payload.final_rate_id = Number(selectedRateId);
      if (markupAmount)   payload.markup_amount  = Number(markupAmount);
      if (ppnAmount)      payload.ppn_amount     = Number(ppnAmount);
      const r = await fetch(`/api/air-freight/orders/${id}/send-final-quote`, {
        method: "POST", credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const body = await r.json();
      if (!r.ok) throw new Error(body.error ?? "Gagal mengirim quote final");
      return body;
    },
    onSuccess: (data) => {
      qc.invalidateQueries({ queryKey: ["air-freight-order", id] });
      setQuoteSuccess(data.approvalUrl ? `Quote terkirim! Approval link: ${data.approvalUrl}` : "Quote final berhasil dikirim");
    },
    onError: (e: any) => setQuoteErr(e.message),
  });

  const confirmBookingMut = useMutation({
    mutationFn: async () => {
      setBookingErr(null);
      const r = await fetch(`/api/air-freight/orders/${id}/confirm-booking`, {
        method: "POST", credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ booking_number: bookingNumber || undefined, mawb: mawb || undefined, hawb: hawb || undefined }),
      });
      const body = await r.json();
      if (!r.ok) throw new Error(body.error ?? "Gagal konfirmasi booking");
      return body;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["air-freight-order", id] });
      refetchEvents();
    },
    onError: (e: any) => setBookingErr(e.message),
  });

  const updateTrackMut = useMutation({
    mutationFn: async () => {
      if (!newTrackStatus) throw new Error("Pilih tracking status");
      const r = await fetch(`/api/air-freight/orders/${id}/tracking-status`, {
        method: "PATCH", credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ tracking_status: newTrackStatus, note: trackNote || undefined }),
      });
      const body = await r.json();
      if (!r.ok) throw new Error(body.error ?? "Gagal update tracking");
      return body;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["air-freight-order", id] });
      refetchEvents();
      setNewTrackStatus(""); setTrackNote(""); setTrackOpen(false);
    },
  });

  if (isLoading) return (
    <AppShell>
      <div className="p-6 space-y-4">
        {Array.from({length:6}).map((_,i) => <div key={i} className="h-16 rounded-lg bg-muted/20 animate-pulse" />)}
      </div>
    </AppShell>
  );
  if (!order) return (
    <AppShell>
      <div className="p-6 text-center text-muted-foreground">Order tidak ditemukan</div>
    </AppShell>
  );

  const canSendQuote = !["completed","cancelled","quote_declined","approved","booked","departed","arrived","delivered"].includes(order.status);
  const canConfirmBooking = order.status === "approved";
  const isBooked = ["booked","departed","arrived","delivered","completed"].includes(order.status);

  const selectedRate = rates?.find((r: any) => String(r.id) === selectedRateId);

  return (
    <AppShell>
      <div className="p-6 space-y-5 max-w-5xl mx-auto">
        {/* Header */}
        <div className="flex items-center gap-3 flex-wrap">
          <Button variant="ghost" size="icon" className="h-8 w-8" onClick={() => navigate("/air-freight/orders")}>
            <ArrowLeft className="h-4 w-4" />
          </Button>
          <div className="flex items-center gap-2 flex-1 min-w-0">
            <Plane className="h-5 w-5 text-sky-400 shrink-0" />
            <h1 className="text-lg font-bold text-foreground font-mono truncate">{order.order_number}</h1>
          </div>
          <Badge className={`text-xs border ${STATUS_COLOR[order.status] ?? "bg-muted"}`}>
            {STATUS_LABEL[order.status] ?? order.status}
          </Badge>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-3 gap-5">
          {/* ── LEFT: Order Info ─────────────────────────────────────────── */}
          <div className="lg:col-span-2 space-y-4">
            {/* Customer & Route */}
            <Card className="border-border/60">
              <CardHeader className="pb-2">
                <CardTitle className="text-sm flex items-center gap-2"><User className="h-4 w-4 text-sky-400" /> Customer & Rute</CardTitle>
              </CardHeader>
              <CardContent className="pt-0 space-y-0">
                <InfoRow label="Customer" value={order.customer_name || "—"} />
                <InfoRow label="Phone" value={order.customer_phone || "—"} />
                <InfoRow label="Email" value={order.customer_email || "—"} />
                <InfoRow label="Rute" value={`${order.origin_airport || "?"} → ${order.destination_airport || "?"}`} />
                <InfoRow label="Kota" value={`${order.origin_city || "?"} → ${order.destination_city || "?"}`} />
                <InfoRow label="Trade Type" value={order.trade_type} />
                <InfoRow label="Service" value={`${order.service_mode} / ${order.service_level}`} />
                <InfoRow label="Incoterm" value={order.incoterm} />
              </CardContent>
            </Card>

            {/* Cargo */}
            <Card className="border-border/60">
              <CardHeader className="pb-2">
                <CardTitle className="text-sm flex items-center gap-2"><Package className="h-4 w-4 text-sky-400" /> Detail Cargo</CardTitle>
              </CardHeader>
              <CardContent className="pt-0 space-y-0">
                <InfoRow label="Komoditi" value={order.commodity || "—"} />
                <InfoRow label="HS Code" value={order.hs_code || "—"} />
                <InfoRow label="Cargo Type" value={order.cargo_type} />
                <InfoRow label="Gross Weight" value={`${order.gross_weight ?? 0} kg`} />
                <InfoRow label="Volumetric Weight" value={`${order.total_volumetric_weight ?? 0} kg`} />
                <InfoRow label="Chargeable Weight" value={<span className="font-semibold text-sky-300">{order.chargeable_weight ?? 0} kg</span>} />
                <InfoRow label="Jumlah Koli" value={`${order.koli ?? 0} koli`} />
                <InfoRow label="Pickup Date" value={fmtDateShort(order.pickup_date)} />
                <InfoRow label="Ready Cargo" value={fmtDateShort(order.ready_cargo_date)} />
                <InfoRow label="Preferred Flight" value={fmtDateShort(order.preferred_flight_date)} />
              </CardContent>
            </Card>

            {/* Estimasi Harga */}
            {order.estimated_price_idr && (
              <Card className="border-border/60">
                <CardHeader className="pb-2">
                  <CardTitle className="text-sm">💰 Estimasi Harga Awal</CardTitle>
                </CardHeader>
                <CardContent className="pt-0">
                  <p className="text-lg font-bold text-blue-300">{IDR(Number(order.estimated_price_idr))}</p>
                  {order.currency !== "IDR" && <p className="text-xs text-muted-foreground">{order.currency} {order.estimated_price ?? "-"}</p>}
                </CardContent>
              </Card>
            )}

            {/* Final Pricing — tampilkan jika sudah quoted */}
            {order.final_price_idr && (
              <Card className="border-border/60">
                <CardHeader className="pb-2">
                  <CardTitle className="text-sm">✅ Harga Final (Confirmed)</CardTitle>
                </CardHeader>
                <CardContent className="pt-0 space-y-0">
                  <InfoRow label="Final Price IDR" value={<span className="font-bold text-emerald-300">{IDR(Number(order.final_price_idr))}</span>} />
                  {order.markup_amount && <InfoRow label="Markup" value={IDR(Number(order.markup_amount))} />}
                  {order.ppn_amount    && <InfoRow label="PPN" value={IDR(Number(order.ppn_amount))} />}
                  {order.grand_total   && <InfoRow label="Grand Total" value={<span className="font-bold text-green-300">{IDR(Number(order.grand_total))}</span>} />}
                  {order.admin_notes   && <InfoRow label="Catatan Admin" value={order.admin_notes} />}
                  <InfoRow label="Quoted At" value={fmtDate(order.quoted_at)} />
                  {order.approved_at && <InfoRow label="Approved At" value={fmtDate(order.approved_at)} />}
                  {order.declined_at && <InfoRow label="Declined At" value={fmtDate(order.declined_at)} />}
                  {order.decline_reason && <InfoRow label="Alasan Tolak" value={<span className="text-red-400">{order.decline_reason}</span>} />}
                </CardContent>
              </Card>
            )}

            {/* Booking Info */}
            {isBooked && (
              <Card className="border-border/60">
                <CardHeader className="pb-2">
                  <CardTitle className="text-sm flex items-center gap-2"><BookOpen className="h-4 w-4 text-emerald-400" /> Booking Data</CardTitle>
                </CardHeader>
                <CardContent className="pt-0 space-y-0">
                  <InfoRow label="Booking Number" value={order.booking_number || "—"} mono />
                  <InfoRow label="MAWB" value={order.mawb || "—"} mono />
                  <InfoRow label="HAWB" value={order.hawb || "—"} mono />
                  <InfoRow label="Booking Confirmed" value={fmtDate(order.booking_confirmed_at)} />
                </CardContent>
              </Card>
            )}
          </div>

          {/* ── RIGHT: Action Panel ──────────────────────────────────────── */}
          <div className="space-y-4">
            {/* Final Quote Section */}
            {canSendQuote && (
              <Card className="border-sky-800/40">
                <CardHeader className="pb-2">
                  <CardTitle className="text-sm flex items-center gap-2">
                    <Send className="h-4 w-4 text-sky-400" /> Kirim Quote Final
                  </CardTitle>
                </CardHeader>
                <CardContent className="pt-0 space-y-3 text-xs">
                  {/* Rate selector */}
                  <div>
                    <Label className="text-xs text-muted-foreground">Pilih Rate</Label>
                    <Select value={selectedRateId} onValueChange={v => {
                      setSelectedRateId(v);
                      const rate = rates?.find((r: any) => String(r.id) === v);
                      if (rate) {
                        // auto fill guidance from rate data
                      }
                    }}>
                      <SelectTrigger className="h-8 text-xs bg-muted/30 mt-1"><SelectValue placeholder="— Pilih rate —" /></SelectTrigger>
                      <SelectContent>
                        {(rates ?? []).map((r: any) => (
                          <SelectItem key={r.id} value={String(r.id)} className="text-xs">
                            {r.airline} | {r.origin_airport}→{r.destination_airport} | {r.service_level}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    {selectedRate && (
                      <p className="text-[10px] text-muted-foreground mt-1">
                        Fuel: {selectedRate.fuel_surcharge_per_kg}/kg | Min: {selectedRate.rate_minimum ?? "—"} | ETD: {selectedRate.etd ?? "—"}
                      </p>
                    )}
                  </div>

                  <div>
                    <Label className="text-xs text-muted-foreground">Final Price IDR *</Label>
                    <Input value={finalPriceIdr} onChange={e => setFinalPriceIdr(e.target.value)} type="number" step="any" className="h-8 text-xs bg-muted/30 mt-1" placeholder="0" />
                  </div>
                  <div>
                    <Label className="text-xs text-muted-foreground">Markup (IDR)</Label>
                    <Input value={markupAmount} onChange={e => setMarkupAmount(e.target.value)} type="number" step="any" className="h-8 text-xs bg-muted/30 mt-1" placeholder="0" />
                  </div>
                  <div>
                    <Label className="text-xs text-muted-foreground">PPN (IDR)</Label>
                    <Input value={ppnAmount} onChange={e => setPpnAmount(e.target.value)} type="number" step="any" className="h-8 text-xs bg-muted/30 mt-1" placeholder="0" />
                  </div>
                  <div>
                    <Label className="text-xs text-muted-foreground">Grand Total *</Label>
                    <Input value={grandTotal} onChange={e => setGrandTotal(e.target.value)} type="number" step="any" className="h-8 text-xs bg-muted/30 mt-1" placeholder="0" />
                  </div>
                  <div>
                    <Label className="text-xs text-muted-foreground">Catatan Admin</Label>
                    <Textarea
                      value={adminNotes}
                      onChange={e => setAdminNotes(e.target.value)}
                      className="text-xs bg-muted/30 mt-1 min-h-[60px] resize-none"
                      placeholder="Catatan tambahan untuk customer…"
                    />
                  </div>

                  {quoteErr && (
                    <Alert className="border-red-700 bg-red-950/40 py-2">
                      <AlertCircle className="h-3.5 w-3.5 text-red-400" />
                      <AlertDescription className="text-red-300 text-xs">{quoteErr}</AlertDescription>
                    </Alert>
                  )}
                  {quoteSuccess && (
                    <Alert className="border-emerald-700 bg-emerald-950/40 py-2">
                      <CheckCircle2 className="h-3.5 w-3.5 text-emerald-400" />
                      <AlertDescription className="text-emerald-300 text-xs break-all">{quoteSuccess}</AlertDescription>
                    </Alert>
                  )}

                  <Button
                    className="w-full bg-sky-700 hover:bg-sky-600 gap-1.5 h-8 text-xs"
                    onClick={() => sendQuoteMut.mutate()}
                    disabled={sendQuoteMut.isPending}
                  >
                    {sendQuoteMut.isPending
                      ? <RefreshCw className="h-3.5 w-3.5 animate-spin" />
                      : <Send className="h-3.5 w-3.5" />}
                    Kirim Quote Final
                  </Button>
                </CardContent>
              </Card>
            )}

            {/* Booking Confirmation */}
            {canConfirmBooking && (
              <Card className="border-emerald-800/40">
                <CardHeader className="pb-2">
                  <CardTitle className="text-sm flex items-center gap-2">
                    <BookOpen className="h-4 w-4 text-emerald-400" /> Konfirmasi Booking
                  </CardTitle>
                </CardHeader>
                <CardContent className="pt-0 space-y-3 text-xs">
                  {[
                    { label: "Booking Number", val: bookingNumber, set: setBookingNumber, placeholder: "BK-2024-001" },
                    { label: "MAWB", val: mawb, set: setMawb, placeholder: "618-12345678" },
                    { label: "HAWB", val: hawb, set: setHawb, placeholder: "Opsional" },
                  ].map(f => (
                    <div key={f.label}>
                      <Label className="text-xs text-muted-foreground">{f.label}</Label>
                      <Input value={f.val} onChange={e => f.set(e.target.value)} placeholder={f.placeholder} className="h-8 text-xs bg-muted/30 mt-1 font-mono" />
                    </div>
                  ))}
                  {bookingErr && (
                    <Alert className="border-red-700 bg-red-950/40 py-2">
                      <AlertCircle className="h-3.5 w-3.5 text-red-400" />
                      <AlertDescription className="text-red-300 text-xs">{bookingErr}</AlertDescription>
                    </Alert>
                  )}
                  <Button
                    className="w-full bg-emerald-700 hover:bg-emerald-600 gap-1.5 h-8 text-xs"
                    onClick={() => confirmBookingMut.mutate()}
                    disabled={confirmBookingMut.isPending}
                  >
                    {confirmBookingMut.isPending
                      ? <RefreshCw className="h-3.5 w-3.5 animate-spin" />
                      : <CheckCircle2 className="h-3.5 w-3.5" />}
                    Konfirmasi Booking
                  </Button>
                </CardContent>
              </Card>
            )}

            {/* Tracking Update */}
            {isBooked && (
              <Card className="border-border/60">
                <Collapsible open={trackOpen} onOpenChange={setTrackOpen}>
                  <CardHeader className="pb-2">
                    <CollapsibleTrigger asChild>
                      <button className="flex items-center justify-between w-full text-sm font-semibold">
                        <span className="flex items-center gap-2">
                          <MapPin className="h-4 w-4 text-orange-400" /> Update Tracking
                        </span>
                        {trackOpen ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
                      </button>
                    </CollapsibleTrigger>
                  </CardHeader>
                  <CollapsibleContent>
                    <CardContent className="pt-0 space-y-3 text-xs">
                      <p className="text-muted-foreground text-xs">
                        Status saat ini: <Badge className="text-[10px] border bg-orange-900/30 text-orange-300 border-orange-700">{order.tracking_status ?? "—"}</Badge>
                      </p>
                      <div>
                        <Label className="text-xs text-muted-foreground">Status Baru</Label>
                        <Select value={newTrackStatus} onValueChange={setNewTrackStatus}>
                          <SelectTrigger className="h-8 text-xs bg-muted/30 mt-1"><SelectValue placeholder="— Pilih status —" /></SelectTrigger>
                          <SelectContent>
                            {TRACKING_STATUSES.map(s => (
                              <SelectItem key={s.v} value={s.v} className="text-xs">{s.l}</SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      </div>
                      <div>
                        <Label className="text-xs text-muted-foreground">Catatan (opsional)</Label>
                        <Input value={trackNote} onChange={e => setTrackNote(e.target.value)} className="h-8 text-xs bg-muted/30 mt-1" placeholder="Misal: Cargo sudah di gudang bandara" />
                      </div>
                      <Button
                        className="w-full bg-orange-700 hover:bg-orange-600 gap-1.5 h-8 text-xs"
                        onClick={() => updateTrackMut.mutate()}
                        disabled={updateTrackMut.isPending || !newTrackStatus}
                      >
                        {updateTrackMut.isPending ? <RefreshCw className="h-3.5 w-3.5 animate-spin" /> : <MapPin className="h-3.5 w-3.5" />}
                        Update Status
                      </Button>
                    </CardContent>
                  </CollapsibleContent>
                </Collapsible>
              </Card>
            )}

            {/* Tracking Timeline */}
            <Card className="border-border/60">
              <CardHeader className="pb-2">
                <CardTitle className="text-sm flex items-center gap-2">
                  <Clock className="h-4 w-4 text-muted-foreground" /> Timeline
                </CardTitle>
              </CardHeader>
              <CardContent className="pt-0">
                {(!events || events.length === 0) ? (
                  <p className="text-xs text-muted-foreground">Belum ada tracking event</p>
                ) : (
                  <div className="relative">
                    <div className="absolute left-3 top-0 bottom-0 w-px bg-border/40" />
                    <div className="space-y-3">
                      {[...events].reverse().map((ev: any, i) => (
                        <div key={ev.id ?? i} className="flex gap-3 items-start pl-1">
                          <div className="w-5 h-5 rounded-full bg-sky-900/60 border border-sky-700 flex items-center justify-center shrink-0 mt-0.5 z-10">
                            <div className="w-2 h-2 rounded-full bg-sky-400" />
                          </div>
                          <div>
                            <p className="text-xs font-medium text-foreground capitalize">{ev.event_type?.replace(/_/g, " ")}</p>
                            {ev.note && <p className="text-[10px] text-muted-foreground">{ev.note}</p>}
                            <p className="text-[10px] text-muted-foreground">{fmtDate(ev.created_at)}</p>
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

      {/* ── PPJK — Dokumen Kepabeanan ─────────────────────────────────────── */}
      <Card className="border-border/60">
        <CardHeader className="pb-2">
          <CardTitle className="text-sm flex items-center gap-2">
            <FileText className="h-4 w-4 text-muted-foreground" /> Dokumen Kepabeanan (PPJK)
          </CardTitle>
        </CardHeader>
        <CardContent>
          <FreightCustomsPanel
            sourceModule="air_freight"
            sourceOrderId={parseInt(id || "0")}
          />
        </CardContent>
      </Card>
    </AppShell>
  );
}
