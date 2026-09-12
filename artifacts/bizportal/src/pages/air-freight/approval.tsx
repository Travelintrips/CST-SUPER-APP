import { useState } from "react";
import { useParams } from "wouter";
import { useQuery, useMutation } from "@tanstack/react-query";
import { Plane, CheckCircle2, XCircle, AlertCircle, RefreshCw, ChevronDown, ChevronUp } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Alert, AlertDescription } from "@/components/ui/alert";

/* ── helpers ─────────────────────────────────────────────────────────────── */
const IDR = (n: number | null | undefined) =>
  n == null ? "—" : new Intl.NumberFormat("id-ID", { style: "currency", currency: "IDR", maximumFractionDigits: 0 }).format(Number(n));

function Row({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="flex gap-3 py-2 border-b border-white/10 last:border-0">
      <span className="text-sm text-white/60 min-w-[160px] shrink-0">{label}</span>
      <span className="text-sm text-white">{value ?? "—"}</span>
    </div>
  );
}

export default function AirFreightApprovalPage() {
  const { token } = useParams<{ token: string }>();
  const [showBreakdown, setShowBreakdown] = useState(false);
  const [declineMode,   setDeclineMode]   = useState(false);
  const [declineReason, setDeclineReason] = useState("");
  const [done,          setDone]          = useState<"approved" | "declined" | null>(null);
  const [doneMsg,       setDoneMsg]       = useState("");
  const [err,           setErr]           = useState<string | null>(null);

  const { data: order, isLoading, error: loadError } = useQuery({
    queryKey: ["air-freight-approval", token],
    queryFn: async () => {
      const r = await fetch(`/api/air-freight/approval/${token}`);
      if (!r.ok) {
        const body = await r.json();
        throw new Error(body.error ?? "Gagal memuat data");
      }
      return r.json() as Promise<any>;
    },
    enabled: !!token,
    retry: false,
  });

  const approveMut = useMutation({
    mutationFn: async () => {
      const r = await fetch(`/api/air-freight/approval/${token}/approve`, { method: "POST" });
      const body = await r.json();
      if (!r.ok) throw new Error(body.error ?? "Gagal memproses");
      return body;
    },
    onSuccess: (data) => { setDone("approved"); setDoneMsg(data.message); },
    onError: (e: any) => setErr(e.message),
  });

  const declineMut = useMutation({
    mutationFn: async () => {
      const r = await fetch(`/api/air-freight/approval/${token}/decline`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ reason: declineReason || undefined }),
      });
      const body = await r.json();
      if (!r.ok) throw new Error(body.error ?? "Gagal memproses");
      return body;
    },
    onSuccess: (data) => { setDone("declined"); setDoneMsg(data.message); },
    onError: (e: any) => setErr(e.message),
  });

  const selisih = order
    ? Number(order.grand_total ?? 0) - Number(order.estimated_price_idr ?? 0)
    : 0;

  /* ── sudah approve/decline ───────────────────────────────────────────── */
  if (done) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-slate-950 via-slate-900 to-sky-950 flex items-center justify-center p-4">
        <div className="bg-white/5 border border-white/10 rounded-2xl p-8 max-w-md w-full text-center space-y-4">
          {done === "approved" ? (
            <CheckCircle2 className="h-14 w-14 text-emerald-400 mx-auto" />
          ) : (
            <XCircle className="h-14 w-14 text-red-400 mx-auto" />
          )}
          <h2 className="text-xl font-bold text-white">
            {done === "approved" ? "Penawaran Disetujui" : "Penawaran Ditolak"}
          </h2>
          <p className="text-white/70 text-sm">{doneMsg}</p>
        </div>
      </div>
    );
  }

  /* ── sudah quoted+approved/declined sebelumnya ───────────────────────── */
  if (order && !["quoted"].includes(order.status)) {
    const statusMsg: Record<string, { icon: React.ReactNode; msg: string }> = {
      approved:      { icon: <CheckCircle2 className="h-10 w-10 text-emerald-400" />, msg: "Penawaran ini sudah disetujui." },
      quote_declined:{ icon: <XCircle className="h-10 w-10 text-red-400" />, msg: "Penawaran ini sudah ditolak." },
    };
    const s = statusMsg[order.status];
    if (s) return (
      <div className="min-h-screen bg-gradient-to-br from-slate-950 via-slate-900 to-sky-950 flex items-center justify-center p-4">
        <div className="bg-white/5 border border-white/10 rounded-2xl p-8 max-w-md w-full text-center space-y-4">
          {s.icon}
          <p className="text-white">{s.msg}</p>
          <p className="text-white/50 text-xs">Order: {order.order_number}</p>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-950 via-slate-900 to-sky-950 py-8 px-4">
      <div className="max-w-2xl mx-auto space-y-5">
        {/* Logo / header */}
        <div className="text-center space-y-2">
          <div className="flex items-center justify-center gap-2">
            <div className="w-10 h-10 rounded-xl bg-sky-600 flex items-center justify-center">
              <Plane className="h-5 w-5 text-white" />
            </div>
            <span className="text-white font-bold text-lg">Air Freight</span>
          </div>
          <h1 className="text-2xl font-bold text-white">Review & Approval Penawaran</h1>
          <p className="text-white/60 text-sm">Silakan periksa detail dan berikan keputusan Anda</p>
        </div>

        {isLoading && (
          <div className="space-y-3">
            {Array.from({length:4}).map((_,i) => <div key={i} className="h-16 rounded-xl bg-white/5 animate-pulse" />)}
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
            {/* Order Number */}
            <div className="bg-sky-900/30 border border-sky-700/40 rounded-xl px-4 py-3 flex items-center justify-between">
              <span className="text-white/60 text-sm">No. Order</span>
              <span className="text-sky-300 font-mono font-bold">{order.order_number}</span>
            </div>

            {/* Pricing Comparison */}
            <div className="bg-white/5 border border-white/10 rounded-xl p-5 space-y-3">
              <h3 className="text-white font-semibold text-sm">Perbandingan Harga</h3>
              <div className="grid grid-cols-3 gap-3">
                <div className="bg-white/5 rounded-lg p-3 text-center">
                  <p className="text-white/50 text-xs mb-1">Estimasi Awal</p>
                  <p className="text-blue-300 font-bold text-sm">{IDR(Number(order.estimated_price_idr))}</p>
                </div>
                <div className="bg-white/5 rounded-lg p-3 text-center">
                  <p className="text-white/50 text-xs mb-1">Harga Final</p>
                  <p className="text-emerald-300 font-bold text-sm">{IDR(Number(order.grand_total))}</p>
                </div>
                <div className={`rounded-lg p-3 text-center ${selisih > 0 ? "bg-red-900/30" : selisih < 0 ? "bg-emerald-900/30" : "bg-white/5"}`}>
                  <p className="text-white/50 text-xs mb-1">Selisih</p>
                  <p className={`font-bold text-sm ${selisih > 0 ? "text-red-300" : selisih < 0 ? "text-emerald-300" : "text-white/60"}`}>
                    {selisih > 0 ? "+" : ""}{IDR(Math.abs(selisih))}
                  </p>
                </div>
              </div>
            </div>

            {/* Rute & Detail */}
            <div className="bg-white/5 border border-white/10 rounded-xl p-5">
              <h3 className="text-white font-semibold text-sm mb-3">Detail Pengiriman</h3>
              <Row label="Rute" value={<span className="font-mono">{order.origin_airport} → {order.destination_airport}</span>} />
              <Row label="Komoditi" value={order.commodity} />
              <Row label="Cargo Type" value={order.cargo_type} />
              <Row label="Chargeable Weight" value={`${order.chargeable_weight} kg`} />
              <Row label="Jumlah Koli" value={`${order.koli} koli`} />
            </div>

            {/* Airline / Rate info */}
            {(order.airline || order.flight_number || order.etd || order.transit_days) && (
              <div className="bg-white/5 border border-white/10 rounded-xl p-5">
                <h3 className="text-white font-semibold text-sm mb-3">Info Penerbangan</h3>
                {order.airline        && <Row label="Airline" value={order.airline} />}
                {order.flight_number  && <Row label="Flight Number" value={<span className="font-mono">{order.flight_number}</span>} />}
                {order.etd            && <Row label="ETD" value={order.etd} />}
                {order.eta            && <Row label="ETA" value={order.eta} />}
                {order.transit_days != null && <Row label="Transit Days" value={`${order.transit_days} hari`} />}
                {order.service_mode   && <Row label="Service Mode" value={order.service_mode} />}
              </div>
            )}

            {/* Admin Notes */}
            {order.admin_notes && (
              <div className="bg-amber-900/20 border border-amber-700/40 rounded-xl p-4">
                <p className="text-amber-300 text-xs font-semibold mb-1">📝 Catatan dari Tim Kami</p>
                <p className="text-white/80 text-sm">{order.admin_notes}</p>
              </div>
            )}

            {/* Breakdown collapsible */}
            {order.final_breakdown && Object.keys(order.final_breakdown).length > 0 && (
              <div className="bg-white/5 border border-white/10 rounded-xl overflow-hidden">
                <button
                  className="w-full flex items-center justify-between px-5 py-3 text-sm text-white font-medium"
                  onClick={() => setShowBreakdown(v => !v)}
                >
                  <span>Detail Breakdown Harga</span>
                  {showBreakdown ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
                </button>
                {showBreakdown && (
                  <div className="px-5 pb-4 space-y-1">
                    {Object.entries(order.final_breakdown).map(([k, v]) => (
                      <div key={k} className="flex justify-between text-xs">
                        <span className="text-white/60 capitalize">{k.replace(/_/g, " ")}</span>
                        <span className="text-white">{typeof v === "number" ? IDR(v) : String(v)}</span>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )}

            {/* Error */}
            {err && (
              <Alert className="border-red-700 bg-red-950/40">
                <AlertCircle className="h-4 w-4 text-red-400" />
                <AlertDescription className="text-red-300 text-sm">{err}</AlertDescription>
              </Alert>
            )}

            {/* Decline reason */}
            {declineMode && (
              <div className="bg-white/5 border border-red-700/30 rounded-xl p-5 space-y-3">
                <p className="text-white text-sm font-medium">Alasan Penolakan (opsional)</p>
                <Textarea
                  value={declineReason}
                  onChange={e => setDeclineReason(e.target.value)}
                  placeholder="Ceritakan mengapa harga ini tidak sesuai…"
                  className="bg-white/5 border-white/20 text-white placeholder:text-white/30 text-sm resize-none"
                  rows={3}
                />
                <div className="flex gap-2">
                  <Button
                    className="flex-1 bg-red-700 hover:bg-red-600 gap-1.5"
                    onClick={() => declineMut.mutate()}
                    disabled={declineMut.isPending}
                  >
                    {declineMut.isPending ? <RefreshCw className="h-4 w-4 animate-spin" /> : <XCircle className="h-4 w-4" />}
                    Konfirmasi Tolak
                  </Button>
                  <Button variant="ghost" className="text-white/60 hover:text-white" onClick={() => setDeclineMode(false)}>
                    Batal
                  </Button>
                </div>
              </div>
            )}

            {/* Action buttons */}
            {!declineMode && (
              <div className="flex flex-col sm:flex-row gap-3">
                <Button
                  className="flex-1 bg-emerald-700 hover:bg-emerald-600 gap-2 h-12 text-base font-semibold"
                  onClick={() => approveMut.mutate()}
                  disabled={approveMut.isPending}
                >
                  {approveMut.isPending ? <RefreshCw className="h-5 w-5 animate-spin" /> : <CheckCircle2 className="h-5 w-5" />}
                  Setuju & Approve
                </Button>
                <Button
                  variant="outline"
                  className="flex-1 border-red-700/50 text-red-400 hover:bg-red-950/40 gap-2 h-12 text-base"
                  onClick={() => setDeclineMode(true)}
                >
                  <XCircle className="h-5 w-5" /> Tolak Penawaran
                </Button>
              </div>
            )}

            <p className="text-center text-white/30 text-xs">
              Dengan menekan Setuju, Anda menyetujui harga final {IDR(Number(order.grand_total))} untuk order {order.order_number}.
            </p>
          </>
        )}
      </div>
    </div>
  );
}
