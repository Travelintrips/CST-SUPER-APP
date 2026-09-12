import { useParams } from "wouter";
import { useQuery } from "@tanstack/react-query";
import { Plane, AlertCircle, CheckCircle2, Package, MapPin, Clock, FileText } from "lucide-react";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";

/* ── helpers ─────────────────────────────────────────────────────────────── */
const fmtDate = (d: string | null | undefined) => {
  if (!d) return "—";
  try { return new Intl.DateTimeFormat("id-ID", { day: "2-digit", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" }).format(new Date(d)); }
  catch { return d; }
};

const TRACKING_META: Record<string, { label: string; desc: string; color: string }> = {
  booked:            { label: "Booking Confirmed",        desc: "Booking telah dikonfirmasi oleh agen.",            color: "bg-sky-900/50 border-sky-700" },
  approved:          { label: "Disetujui Customer",       desc: "Customer telah menyetujui harga final.",           color: "bg-teal-900/50 border-teal-700" },
  cargo_received:    { label: "Cargo Diterima",           desc: "Cargo telah diterima di gudang bandara.",          color: "bg-blue-900/50 border-blue-700" },
  departed:          { label: "Pesawat Berangkat",        desc: "Cargo sudah berangkat.",                           color: "bg-purple-900/50 border-purple-700" },
  in_transit:        { label: "In Transit",               desc: "Cargo sedang dalam perjalanan.",                   color: "bg-indigo-900/50 border-indigo-700" },
  arrived:           { label: "Tiba di Bandara Tujuan",  desc: "Cargo telah tiba di bandara tujuan.",              color: "bg-orange-900/50 border-orange-700" },
  customs_clearance: { label: "Customs Clearance",       desc: "Proses bea cukai sedang berlangsung.",             color: "bg-amber-900/50 border-amber-700" },
  out_for_delivery:  { label: "Dalam Pengiriman",        desc: "Cargo sedang dikirim ke alamat penerima.",         color: "bg-lime-900/50 border-lime-700" },
  delivered:         { label: "Terkirim",                desc: "Cargo berhasil diterima penerima.",                color: "bg-emerald-900/50 border-emerald-700" },
  completed:         { label: "Selesai",                 desc: "Order telah selesai.",                             color: "bg-green-900/50 border-green-700" },
  quote_declined:    { label: "Penawaran Ditolak",       desc: "Customer menolak harga final.",                    color: "bg-red-900/50 border-red-700" },
  cancelled:         { label: "Dibatalkan",              desc: "Order dibatalkan.",                                color: "bg-gray-900/50 border-gray-700" },
};

function getCurrentStep(events: any[], trackingStatus: string | null): string | null {
  if (trackingStatus) return trackingStatus;
  if (!events || events.length === 0) return null;
  return events[events.length - 1]?.event_type ?? null;
}

export default function AirFreightTrackPage() {
  const { orderNumber } = useParams<{ orderNumber: string }>();

  const { data, isLoading, error: loadError } = useQuery({
    queryKey: ["air-freight-track", orderNumber],
    queryFn: async () => {
      const r = await fetch(`/api/air-freight/track/${orderNumber}`);
      if (!r.ok) { const b = await r.json(); throw new Error(b.error ?? "Gagal memuat tracking"); }
      return r.json() as Promise<{ order: any; events: any[] }>;
    },
    enabled: !!orderNumber,
    refetchInterval: 60000, // refresh every 1 min
    retry: false,
  });

  const order  = data?.order;
  const events = data?.events ?? [];
  const currentStep = getCurrentStep(events, order?.tracking_status);
  const meta = currentStep ? TRACKING_META[currentStep] : null;

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-950 via-slate-900 to-sky-950 py-8 px-4">
      <div className="max-w-xl mx-auto space-y-5">
        {/* Header */}
        <div className="text-center space-y-2">
          <div className="flex items-center justify-center gap-2">
            <div className="w-10 h-10 rounded-xl bg-sky-600 flex items-center justify-center">
              <Plane className="h-5 w-5 text-white" />
            </div>
            <span className="text-white font-bold text-lg">Air Freight Tracking</span>
          </div>
          <p className="text-white/50 text-sm font-mono">{orderNumber}</p>
        </div>

        {isLoading && (
          <div className="space-y-3">
            {Array.from({length:4}).map((_,i) => <div key={i} className="h-14 rounded-xl bg-white/5 animate-pulse" />)}
          </div>
        )}

        {(loadError as Error)?.message && (
          <Alert className="border-red-700 bg-red-950/40">
            <AlertCircle className="h-4 w-4 text-red-400" />
            <AlertDescription className="text-red-300">{(loadError as Error).message}</AlertDescription>
          </Alert>
        )}

        {order && (
          <>
            {/* Current Status Banner */}
            {meta && (
              <div className={`border rounded-xl p-4 ${meta.color}`}>
                <div className="flex items-center gap-3">
                  {currentStep === "completed" || currentStep === "delivered"
                    ? <CheckCircle2 className="h-8 w-8 text-emerald-400 shrink-0" />
                    : <MapPin className="h-8 w-8 text-sky-400 shrink-0 animate-pulse" />
                  }
                  <div>
                    <p className="text-white font-bold">{meta.label}</p>
                    <p className="text-white/70 text-sm">{meta.desc}</p>
                  </div>
                </div>
              </div>
            )}

            {/* Order Info */}
            <div className="bg-white/5 border border-white/10 rounded-xl p-4 space-y-2">
              <div className="flex items-center gap-2 mb-3">
                <Package className="h-4 w-4 text-sky-400" />
                <span className="text-white font-semibold text-sm">Detail Kiriman</span>
              </div>
              {[
                { l: "Rute", v: `${order.origin_airport} → ${order.destination_airport}` },
                { l: "Komoditi", v: order.commodity },
                { l: "Berat", v: `${order.chargeable_weight} kg / ${order.koli} koli` },
                { l: "Penerima", v: order.customer_name },
              ].map(item => (
                <div key={item.l} className="flex gap-3 py-1 border-b border-white/10 last:border-0">
                  <span className="text-white/50 text-xs min-w-[120px]">{item.l}</span>
                  <span className="text-white text-xs">{item.v ?? "—"}</span>
                </div>
              ))}
            </div>

            {/* Flight Info */}
            {(order.airline || order.mawb || order.hawb || order.booking_number) && (
              <div className="bg-white/5 border border-white/10 rounded-xl p-4 space-y-2">
                <div className="flex items-center gap-2 mb-3">
                  <Plane className="h-4 w-4 text-sky-400" />
                  <span className="text-white font-semibold text-sm">Info Penerbangan</span>
                </div>
                {[
                  { l: "Airline", v: order.airline },
                  { l: "Flight", v: order.flight_number },
                  { l: "ETD", v: order.etd },
                  { l: "ETA", v: order.eta },
                  { l: "Transit Days", v: order.transit_days ? `${order.transit_days} hari` : null },
                  { l: "MAWB", v: order.mawb },
                  { l: "HAWB", v: order.hawb },
                  { l: "Booking No.", v: order.booking_number },
                ].filter(x => x.v).map(item => (
                  <div key={item.l} className="flex gap-3 py-1 border-b border-white/10 last:border-0">
                    <span className="text-white/50 text-xs min-w-[120px]">{item.l}</span>
                    <span className="text-white text-xs font-mono">{item.v}</span>
                  </div>
                ))}
              </div>
            )}

            {/* Timeline */}
            <div className="bg-white/5 border border-white/10 rounded-xl p-4">
              <div className="flex items-center gap-2 mb-4">
                <Clock className="h-4 w-4 text-sky-400" />
                <span className="text-white font-semibold text-sm">Riwayat Perjalanan</span>
              </div>

              {events.length === 0 ? (
                <p className="text-white/40 text-xs text-center py-4">Belum ada pembaruan status</p>
              ) : (
                <div className="relative">
                  <div className="absolute left-[11px] top-0 bottom-0 w-px bg-white/10" />
                  <div className="space-y-4">
                    {[...events].reverse().map((ev: any, i) => {
                      const m = TRACKING_META[ev.event_type];
                      const isLatest = i === 0;
                      return (
                        <div key={ev.id ?? i} className="flex gap-3 items-start">
                          <div className={`w-6 h-6 rounded-full border flex items-center justify-center shrink-0 z-10 ${
                            isLatest ? "bg-sky-600 border-sky-400" : "bg-white/10 border-white/20"
                          }`}>
                            <div className={`w-2.5 h-2.5 rounded-full ${isLatest ? "bg-white" : "bg-white/40"}`} />
                          </div>
                          <div className="flex-1 min-w-0">
                            <p className={`text-sm font-medium ${isLatest ? "text-white" : "text-white/70"}`}>
                              {m?.label ?? ev.event_type?.replace(/_/g, " ")}
                            </p>
                            {ev.note && <p className="text-white/50 text-xs mt-0.5">{ev.note}</p>}
                            <p className="text-white/30 text-[10px] mt-0.5">{fmtDate(ev.created_at)}</p>
                          </div>
                          {isLatest && (
                            <Badge className="text-[10px] border bg-sky-900/60 text-sky-300 border-sky-700 shrink-0">
                              Terkini
                            </Badge>
                          )}
                        </div>
                      );
                    })}
                  </div>
                </div>
              )}
            </div>

            <p className="text-center text-white/20 text-xs">
              Tracking diperbarui otomatis setiap menit • {orderNumber}
            </p>
          </>
        )}
      </div>
    </div>
  );
}
