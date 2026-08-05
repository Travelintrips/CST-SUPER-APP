import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Separator } from "@/components/ui/separator";
import { useToast } from "@/hooks/use-toast";
import {
  Shield, CheckCircle2, Clock, Loader2, Copy, Lock, Unlock, BadgeCheck,
  AlertCircle, ChevronRight,
} from "lucide-react";

const idr = (n: number | string | null | undefined) =>
  n == null ? "—" : `Rp ${Math.round(Number(n)).toLocaleString("id-ID")}`;

const dtStr = (s: string | null | undefined) =>
  s ? new Date(s).toLocaleString("id-ID", { day: "numeric", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" }) : null;

// ── Status timeline config ────────────────────────────────────────────────────

type DpStatus = "none" | "dp_pending" | "dp_held" | "confirmed_by_customer" | "dp_released" | "completed";

interface StepDef {
  key: DpStatus;
  label: string;
  desc: string;
  icon: React.ReactNode;
  color: string;
  activeColor: string;
}

const STEPS: StepDef[] = [
  {
    key: "dp_pending",
    label: "DP Menunggu",
    desc: "Escrow aktif — customer belum transfer DP",
    icon: <Clock className="h-4 w-4" />,
    color: "bg-slate-200 text-slate-500",
    activeColor: "bg-amber-100 text-amber-700 border-amber-200",
  },
  {
    key: "dp_held",
    label: "DP Diterima Platform",
    desc: "Dana DP sudah masuk & ditahan oleh platform",
    icon: <Lock className="h-4 w-4" />,
    color: "bg-slate-200 text-slate-500",
    activeColor: "bg-blue-100 text-blue-700 border-blue-200",
  },
  {
    key: "confirmed_by_customer",
    label: "Barang/Jasa Dikonfirmasi",
    desc: "Customer mengkonfirmasi sudah menerima barang/jasa",
    icon: <BadgeCheck className="h-4 w-4" />,
    color: "bg-slate-200 text-slate-500",
    activeColor: "bg-violet-100 text-violet-700 border-violet-200",
  },
  {
    key: "dp_released",
    label: "Dana Dirilis ke Vendor",
    desc: "Platform merilis dana DP ke vendor",
    icon: <Unlock className="h-4 w-4" />,
    color: "bg-slate-200 text-slate-500",
    activeColor: "bg-emerald-100 text-emerald-700 border-emerald-200",
  },
];

const STATUS_ORDER: DpStatus[] = ["dp_pending", "dp_held", "confirmed_by_customer", "dp_released", "completed"];

function stepStatus(stepKey: DpStatus, currentStatus: DpStatus) {
  const stepIdx = STATUS_ORDER.indexOf(stepKey);
  const curIdx = STATUS_ORDER.indexOf(currentStatus);
  if (curIdx < 0 || stepIdx < 0) return "upcoming";
  if (stepIdx < curIdx) return "done";
  if (stepIdx === curIdx) return "active";
  return "upcoming";
}

// ── API helpers ───────────────────────────────────────────────────────────────

async function apiFetch(url: string, method = "GET", body?: object) {
  const res = await fetch(url, {
    method,
    headers: { "Content-Type": "application/json" },
    credentials: "include",
    body: body ? JSON.stringify(body) : undefined,
  });
  if (!res.ok) {
    const d = await res.json().catch(() => ({})) as { error?: string };
    throw new Error(d.error ?? "Gagal");
  }
  return res.json();
}

// ── EscrowPanel ───────────────────────────────────────────────────────────────

export function EscrowPanel({ docId, grandTotal }: { docId: number; grandTotal: number }) {
  const { toast } = useToast();
  const qc = useQueryClient();

  const [dpPct, setDpPct] = useState("50");
  const [notes, setNotes] = useState("");
  const [copied, setCopied] = useState(false);

  const key = ["escrow", docId];

  const { data, isLoading } = useQuery({
    queryKey: key,
    queryFn: () => apiFetch(`/api/sales/escrow/${docId}`) as Promise<Record<string, unknown>>,
    refetchInterval: 15000,
  });

  const invalidate = () => qc.invalidateQueries({ queryKey: key });

  const enableMut = useMutation({
    mutationFn: () => apiFetch(`/api/sales/escrow/${docId}/enable`, "POST", { dpPercentage: Number(dpPct), notes }),
    onSuccess: () => { invalidate(); toast({ title: "Escrow diaktifkan" }); },
    onError: (e) => toast({ title: (e as Error).message, variant: "destructive" }),
  });

  const holdMut = useMutation({
    mutationFn: () => apiFetch(`/api/sales/escrow/${docId}/hold`, "POST"),
    onSuccess: () => { invalidate(); toast({ title: "DP ditandai sudah diterima platform" }); },
    onError: (e) => toast({ title: (e as Error).message, variant: "destructive" }),
  });

  const releaseMut = useMutation({
    mutationFn: () => apiFetch(`/api/sales/escrow/${docId}/release`, "POST"),
    onSuccess: () => { invalidate(); toast({ title: "Dana DP dirilis ke vendor" }); },
    onError: (e) => toast({ title: (e as Error).message, variant: "destructive" }),
  });

  const copyLink = async () => {
    if (!data?.confirm_url) return;
    try {
      await navigator.clipboard.writeText(String(data.confirm_url));
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
      toast({ title: "Link konfirmasi disalin" });
    } catch {
      toast({ title: "Gagal menyalin", variant: "destructive" });
    }
  };

  if (isLoading) {
    return (
      <Card>
        <CardContent className="flex items-center gap-2 py-6 text-muted-foreground text-sm">
          <Loader2 className="h-4 w-4 animate-spin" /> Memuat data escrow…
        </CardContent>
      </Card>
    );
  }

  const escrowEnabled = Boolean(data?.escrow_enabled);
  const dpStatus = String(data?.dp_status ?? "none") as DpStatus;
  const dpAmount = Number(data?.dp_amount ?? 0);
  const dpPctCurrent = Number(data?.dp_percentage ?? 0);
  const confirmUrl = data?.confirm_url ? String(data.confirm_url) : null;
  const customerConfirmedAt = dtStr(data?.customer_confirmed_at as string | null);
  const dpHeldAt = dtStr(data?.dp_held_at as string | null);
  const dpReleasedAt = dtStr(data?.dp_released_at as string | null);

  // ── NOT YET ENABLED ─────────────────────────────────────────────────────────
  if (!escrowEnabled) {
    const dpPreview = Math.round((grandTotal * Number(dpPct)) / 100);

    return (
      <Card className="border-dashed">
        <CardHeader className="pb-3 pt-4 px-5">
          <CardTitle className="text-sm font-semibold flex items-center gap-2">
            <Shield className="h-4 w-4 text-slate-400" />
            Proteksi Escrow
            <Badge variant="outline" className="ml-auto text-[10px] text-slate-500">Belum Aktif</Badge>
          </CardTitle>
          <p className="text-xs text-muted-foreground mt-0.5">
            Aktifkan escrow agar dana DP customer ditahan platform sebelum dirilis ke vendor setelah konfirmasi.
          </p>
        </CardHeader>
        <CardContent className="px-5 pb-5 space-y-4">
          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label className="text-xs">DP Percentage (%)</Label>
              <Input
                type="number"
                min={1}
                max={100}
                value={dpPct}
                onChange={(e) => setDpPct(e.target.value)}
                className="mt-1 h-8 text-sm"
              />
              <p className="text-xs text-muted-foreground mt-1">
                Jumlah DP: <span className="font-semibold text-foreground">{idr(dpPreview)}</span>
              </p>
            </div>
            <div>
              <Label className="text-xs">Catatan (opsional)</Label>
              <Input
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                placeholder="Syarat, dll."
                className="mt-1 h-8 text-sm"
              />
            </div>
          </div>
          <Button
            size="sm"
            className="gap-2 bg-blue-600 hover:bg-blue-700"
            onClick={() => enableMut.mutate()}
            disabled={enableMut.isPending}
          >
            {enableMut.isPending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Shield className="h-3.5 w-3.5" />}
            Aktifkan Escrow
          </Button>
        </CardContent>
      </Card>
    );
  }

  // ── ENABLED ─────────────────────────────────────────────────────────────────
  return (
    <Card className="border-blue-200/70 bg-gradient-to-br from-blue-50/40 to-white">
      <CardHeader className="pb-3 pt-4 px-5">
        <CardTitle className="text-sm font-semibold flex items-center gap-2">
          <Shield className="h-4 w-4 text-blue-500" />
          Proteksi Escrow
          <Badge className="ml-auto text-[10px] bg-blue-100 text-blue-700 border border-blue-200">Aktif</Badge>
        </CardTitle>
        <div className="flex items-center gap-4 mt-1 text-xs text-muted-foreground">
          <span>DP <strong className="text-foreground">{dpPctCurrent}%</strong></span>
          <span className="text-slate-300">|</span>
          <span>Jumlah <strong className="text-foreground">{idr(dpAmount)}</strong></span>
          {!!data?.escrow_notes && (
            <>
              <span className="text-slate-300">|</span>
              <span className="truncate max-w-[160px]">{String(data.escrow_notes)}</span>
            </>
          )}
        </div>
      </CardHeader>

      <CardContent className="px-5 pb-5 space-y-5">

        {/* ── Timeline ─────────────────────────────────────────────────────── */}
        <div className="space-y-2">
          {STEPS.map((step, idx) => {
            const s = stepStatus(step.key, dpStatus);
            const isDone = s === "done";
            const isActive = s === "active";
            const isUpcoming = s === "upcoming";
            const ts =
              step.key === "dp_held" ? dpHeldAt :
              step.key === "confirmed_by_customer" ? customerConfirmedAt :
              step.key === "dp_released" ? dpReleasedAt : null;

            return (
              <div key={step.key} className="flex items-start gap-3">
                <div className={`mt-0.5 h-6 w-6 rounded-full flex items-center justify-center shrink-0 border text-[10px] font-bold
                  ${isDone ? "bg-emerald-100 text-emerald-600 border-emerald-200" :
                    isActive ? step.activeColor + " border" :
                    "bg-slate-100 text-slate-400 border-slate-200"}`}>
                  {isDone ? <CheckCircle2 className="h-3.5 w-3.5" /> : isActive ? step.icon : idx + 1}
                </div>
                <div className="flex-1 pt-0.5">
                  <p className={`text-xs font-semibold ${isUpcoming ? "text-muted-foreground" : "text-foreground"}`}>
                    {step.label}
                  </p>
                  <p className="text-[11px] text-muted-foreground">{ts ?? step.desc}</p>
                </div>
                {idx < STEPS.length - 1 && (
                  <ChevronRight className="h-3 w-3 text-slate-300 shrink-0 mt-1.5" />
                )}
              </div>
            );
          })}
        </div>

        <Separator />

        {/* ── Action buttons ──────────────────────────────────────────────── */}
        <div className="flex flex-wrap gap-2">
          {dpStatus === "dp_pending" && (
            <Button
              size="sm"
              className="gap-2 bg-blue-600 hover:bg-blue-700"
              onClick={() => {
                if (!confirm("Tandai DP sudah diterima dan ditahan platform?")) return;
                holdMut.mutate();
              }}
              disabled={holdMut.isPending}
            >
              {holdMut.isPending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Lock className="h-3.5 w-3.5" />}
              DP Diterima Platform
            </Button>
          )}

          {(dpStatus === "dp_held" || dpStatus === "confirmed_by_customer") && (
            <Button
              size="sm"
              className="gap-2 bg-emerald-600 hover:bg-emerald-700"
              onClick={() => {
                if (!confirm("Rilis dana DP ke vendor sekarang?")) return;
                releaseMut.mutate();
              }}
              disabled={releaseMut.isPending}
            >
              {releaseMut.isPending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Unlock className="h-3.5 w-3.5" />}
              Rilis Dana ke Vendor
            </Button>
          )}

          {dpStatus === "dp_released" && (
            <div className="flex items-center gap-2 text-xs text-emerald-700 bg-emerald-50 border border-emerald-200 rounded-md px-3 py-2">
              <CheckCircle2 className="h-4 w-4" />
              Dana DP berhasil dirilis ke vendor
            </div>
          )}
        </div>

        {/* ── Confirm link ────────────────────────────────────────────────── */}
        {confirmUrl && dpStatus !== "dp_released" && dpStatus !== "completed" && (
          <div className="bg-slate-50 border border-slate-200 rounded-lg p-3 space-y-2">
            <p className="text-xs font-semibold text-slate-700 flex items-center gap-1.5">
              <AlertCircle className="h-3.5 w-3.5 text-amber-500" />
              Link Konfirmasi untuk Customer
            </p>
            <p className="text-[11px] text-muted-foreground">
              Bagikan link ini ke customer untuk konfirmasi penerimaan barang/jasa setelah DP diterima.
            </p>
            <div className="flex items-center gap-2">
              <code className="text-[10px] bg-white border border-slate-200 rounded px-2 py-1 flex-1 truncate font-mono text-slate-600">
                {confirmUrl}
              </code>
              <Button size="sm" variant="outline" className="shrink-0 h-7 px-2 gap-1 text-[11px]" onClick={copyLink}>
                <Copy className="h-3 w-3" />
                {copied ? "Disalin!" : "Salin"}
              </Button>
            </div>
          </div>
        )}

      </CardContent>
    </Card>
  );
}
