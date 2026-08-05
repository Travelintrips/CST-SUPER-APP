import { useState } from "react";
import { useParams, useLocation } from "wouter";
import { useQuery, useMutation } from "@tanstack/react-query";
import {
  Plane, CheckCircle2, XCircle, AlertCircle, Loader2,
  ChevronDown, ChevronUp, RefreshCw,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Alert, AlertDescription } from "@/components/ui/alert";

/* ── helpers ─────────────────────────────────────────────────────── */
const IDR = (n: number | string | null | undefined) => {
  if (n == null) return "—";
  return new Intl.NumberFormat("id-ID", { style: "currency", currency: "IDR", maximumFractionDigits: 0 }).format(Number(n));
};

function Row({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="flex gap-3 py-2 border-b border-white/10 last:border-0">
      <span className="text-sm text-white/60 min-w-[160px] shrink-0">{label}</span>
      <span className="text-sm text-white font-medium">{value ?? "—"}</span>
    </div>
  );
}

export default function AirFreightApprovalPage() {
  const { token } = useParams<{ token: string }>();
  const [, setLocation] = useLocation();
  const [showBreakdown, setShowBreakdown] = useState(false);
  const [declineMode,   setDeclineMode]   = useState(false);
  const [declineReason, setDeclineReason] = useState("");
  const [done, setDone] = useState<"approved" | "declined" | null>(null);
  const [doneMsg, setDoneMsg] = useState("");
  const [err,  setErr]  = useState<string | null>(null);

  const { data: order, isLoading, error: loadError } = useQuery({
    queryKey: ["af-approval", token],
    queryFn: async () => {
      const r = await fetch(`/api/air-freight/approval/${token}`);
      const body = await r.json();
      if (!r.ok) throw new Error(body.error ?? "Gagal memuat data");
      return body as Record<string, any>;
    },
    enabled: !!token,
    retry: false,
  });

  const approveMut = useMutation({
    mutationFn: async () => {
      const r = await fetch(`/api/air-freight/approval/${token}/approve`, { method: "POST" });
      const body = await r.json();
      if (!r.ok) throw new Error(body.error ?? "Gagal memproses");
      return body as { message: string };
    },
    onSuccess: (data) => { setDone("approved"); setDoneMsg(data.message); setErr(null); },
    onError: (e: Error) => setErr(e.message),
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
      return body as { message: string };
    },
    onSuccess: (data) => { setDone("declined"); setDoneMsg(data.message); setErr(null); },
    onError: (e: Error) => setErr(e.message),
  });

  /* ── Done screen ─────────────────────────────────────────────── */
  if (done) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-slate-950 via-slate-900 to-sky-950 flex items-center justify-center p-4">
        <div className="bg-white/5 border border-white/10 rounded-2xl p-8 max-w-md w-full text-center space-y-4">
          {done === "approved" ? (
            <CheckCircle2 className="w-14 h-14 text-emerald-400 mx-auto" />
          ) : (
            <XCircle className="w-14 h-14 text-red-400 mx-auto" />
          )}
          <h1 className="text-xl font-bold text-white">
            {done === "approved" ? "Penawaran Disetujui!" : "Penawaran Ditolak"}
          </h1>
          <p className="text-sm text-white/70">{doneMsg}</p>
          {done === "approved" && order?.order_number && (
            <Button
              className="w-full bg-sky-600 hover:bg-sky-700"
              onClick={() => setLocation(`/air-freight/track/${order.order_number}`)}
            >
              Lihat Status Pengiriman
            </Button>
          )}
          <button
            className="text-xs text-white/40 hover:text-white/70 underline"
            onClick={() => setLocation("/")}
          >
            Kembali ke Beranda
          </button>
        </div>
      </div>
    );
  }

  /* ── Loading / error ─────────────────────────────────────────── */
  if (isLoading) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-slate-950 via-slate-900 to-sky-950 flex items-center justify-center">
        <div className="flex flex-col items-center gap-3 text-white/60">
          <Loader2 className="w-8 h-8 animate-spin" />
          <p className="text-sm">Memuat data penawaran…</p>
        </div>
      </div>
    );
  }

  if (loadError || !order) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-slate-950 via-slate-900 to-sky-950 flex items-center justify-center p-4">
        <div className="bg-white/5 border border-red-500/30 rounded-2xl p-8 max-w-md w-full text-center space-y-3">
          <AlertCircle className="w-12 h-12 text-red-400 mx-auto" />
          <h1 className="text-lg font-bold text-white">Link Tidak Valid</h1>
          <p className="text-sm text-white/60">
            {(loadError as Error)?.message ?? "Link penawaran tidak ditemukan atau sudah kedaluwarsa."}
          </p>
        </div>
      </div>
    );
  }

  const alreadyApproved  = order.status === "approved";
  const alreadyDeclined  = order.status === "quote_declined";
  const canAct           = order.status === "quoted";
  const breakdown        = order.final_breakdown ?? {};
  const selisih          = Number(order.grand_total ?? 0) - Number(order.estimated_price_idr ?? 0);

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-950 via-slate-900 to-sky-950 py-8 px-4">
      <div className="max-w-lg mx-auto space-y-4">

        {/* Header */}
        <div className="text-center space-y-1 pb-2">
          <div className="flex items-center justify-center gap-2 mb-3">
            <div className="w-10 h-10 rounded-full bg-sky-900/60 border border-sky-700 flex items-center justify-center">
              <Plane className="w-5 h-5 text-sky-400" />
            </div>
          </div>
          <h1 className="text-xl font-bold text-white">Penawaran Harga Final</h1>
          <p className="text-sm text-white/50">Air Freight Order #{order.order_number}</p>
          {alreadyApproved && (
            <Badge className="bg-emerald-900/40 text-emerald-300 border-emerald-600">Sudah Disetujui</Badge>
          )}
          {alreadyDeclined && (
            <Badge className="bg-red-900/40 text-red-300 border-red-600">Sudah Ditolak</Badge>
          )}
        </div>

        {/* Order info */}
        <div className="bg-white/5 border border-white/10 rounded-2xl p-5 space-y-0">
          <Row label="Pelanggan"   value={order.customer_name} />
          <Row label="Rute"        value={`${order.origin_airport} → ${order.destination_airport}`} />
          <Row label="Komoditi"    value={order.commodity} />
          <Row label="Chargeable"  value={`${Number(order.chargeable_weight ?? 0).toLocaleString("id-ID")} kg`} />
          <Row label="Airline"     value={order.airline ?? "—"} />
          <Row label="Flight No."  value={order.flight_number ?? "—"} />
          <Row label="ETD"         value={order.etd ?? "—"} />
          <Row label="ETA"         value={order.eta ?? "—"} />
          {order.transit_days != null && (
            <Row label="Transit Days" value={`${order.transit_days} hari`} />
          )}
          {order.admin_notes && (
            <Row label="Catatan Admin" value={order.admin_notes} />
          )}
        </div>

        {/* Pricing */}
        <div className="bg-white/5 border border-white/10 rounded-2xl p-5 space-y-0">
          {order.estimated_price_idr && (
            <Row label="Estimasi Awal"    value={IDR(order.estimated_price_idr)} />
          )}
          <Row label="Harga Final"        value={IDR(order.final_price_idr)} />
          {order.markup_amount && Number(order.markup_amount) > 0 && (
            <Row label="Markup"           value={IDR(order.markup_amount)} />
          )}
          {order.ppn_amount && Number(order.ppn_amount) > 0 && (
            <Row label="PPN (11%)"        value={IDR(order.ppn_amount)} />
          )}
          <div className="flex gap-3 py-3 border-t border-white/10 mt-2">
            <span className="text-base font-bold text-white min-w-[160px]">Total Tagihan</span>
            <span className="text-base font-bold text-emerald-400">{IDR(order.grand_total)}</span>
          </div>
          {selisih !== 0 && order.estimated_price_idr && (
            <p className={`text-xs ${selisih > 0 ? "text-amber-400" : "text-emerald-400"}`}>
              {selisih > 0 ? "▲" : "▼"} {IDR(Math.abs(selisih))} dari estimasi awal
            </p>
          )}
        </div>

        {/* Breakdown toggle */}
        {Object.keys(breakdown).length > 0 && (
          <div className="bg-white/5 border border-white/10 rounded-2xl overflow-hidden">
            <button
              className="w-full flex items-center justify-between px-5 py-3 text-sm text-white/80 font-medium"
              onClick={() => setShowBreakdown(!showBreakdown)}
            >
              Rincian Biaya
              {showBreakdown ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
            </button>
            {showBreakdown && (
              <div className="px-5 pb-4 space-y-0 border-t border-white/10">
                {Object.entries(breakdown).map(([k, v]) => (
                  <Row key={k} label={k.replace(/_/g, " ")} value={
                    typeof v === "number" ? IDR(v) : String(v)
                  } />
                ))}
              </div>
            )}
          </div>
        )}

        {/* Error */}
        {err && (
          <Alert className="border-red-600/40 bg-red-950/30">
            <AlertCircle className="h-4 w-4 text-red-400" />
            <AlertDescription className="text-red-300 text-sm">{err}</AlertDescription>
          </Alert>
        )}

        {/* Action buttons */}
        {canAct && !declineMode && (
          <div className="space-y-3 pt-2">
            <Button
              className="w-full h-12 text-base bg-emerald-600 hover:bg-emerald-700 gap-2"
              onClick={() => approveMut.mutate()}
              disabled={approveMut.isPending}
            >
              {approveMut.isPending
                ? <RefreshCw className="w-5 h-5 animate-spin" />
                : <CheckCircle2 className="w-5 h-5" />}
              Setujui Penawaran
            </Button>
            <Button
              variant="outline"
              className="w-full h-10 text-sm border-white/20 text-white/70 hover:bg-white/10 gap-2"
              onClick={() => setDeclineMode(true)}
            >
              <XCircle className="w-4 h-4" /> Tolak Penawaran
            </Button>
          </div>
        )}

        {canAct && declineMode && (
          <div className="space-y-3 bg-red-950/30 border border-red-600/30 rounded-2xl p-5">
            <p className="text-sm text-white font-medium">Alasan Penolakan (opsional)</p>
            <Textarea
              value={declineReason}
              onChange={e => setDeclineReason(e.target.value)}
              placeholder="Misal: Harga terlalu tinggi, jadwal tidak cocok, dsb."
              className="bg-white/5 border-white/20 text-white placeholder:text-white/30 text-sm resize-none"
              rows={3}
            />
            <div className="flex gap-2">
              <Button
                variant="outline"
                className="flex-1 border-white/20 text-white/70 hover:bg-white/10"
                onClick={() => { setDeclineMode(false); setDeclineReason(""); }}
              >
                Batal
              </Button>
              <Button
                className="flex-1 bg-red-700 hover:bg-red-800 gap-2"
                onClick={() => declineMut.mutate()}
                disabled={declineMut.isPending}
              >
                {declineMut.isPending
                  ? <RefreshCw className="w-4 h-4 animate-spin" />
                  : <XCircle className="w-4 h-4" />}
                Konfirmasi Tolak
              </Button>
            </div>
          </div>
        )}

        {!canAct && !alreadyApproved && !alreadyDeclined && (
          <Alert className="border-amber-600/40 bg-amber-950/30">
            <AlertCircle className="h-4 w-4 text-amber-400" />
            <AlertDescription className="text-amber-300 text-sm">
              Order ini dalam status <strong>{order.status}</strong> — penawaran belum tersedia untuk di-review.
            </AlertDescription>
          </Alert>
        )}

        <p className="text-xs text-center text-white/30 pb-4">
          Butuh bantuan? Hubungi tim kami via WhatsApp.
        </p>
      </div>
    </div>
  );
}
