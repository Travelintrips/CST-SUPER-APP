import { useState, useEffect, useCallback } from "react";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Loader2 } from "lucide-react";
import { cn } from "@/lib/utils";

export const PROGRESS_STEPS = [
  { key: "ORDER_RECEIVED",    label: "Order Diterima",        color: "bg-blue-400",     ring: "ring-blue-300",    text: "text-blue-600",    line: "bg-blue-300",    hover: "hover:bg-blue-500",    header: "bg-blue-600"    },
  { key: "ADMIN_REVIEW",      label: "Ditinjau Admin",        color: "bg-indigo-400",   ring: "ring-indigo-300",  text: "text-indigo-600",  line: "bg-indigo-300",  hover: "hover:bg-indigo-500",  header: "bg-indigo-600"  },
  { key: "RFQ_SENT",          label: "RFQ ke Vendor",         color: "bg-violet-400",   ring: "ring-violet-300",  text: "text-violet-600",  line: "bg-violet-300",  hover: "hover:bg-violet-500",  header: "bg-violet-600"  },
  { key: "QUOTE_RECEIVED",    label: "Penawaran Masuk",       color: "bg-fuchsia-400",  ring: "ring-fuchsia-300", text: "text-fuchsia-600",  line: "bg-fuchsia-300", hover: "hover:bg-fuchsia-500",  header: "bg-fuchsia-600" },
  { key: "CUSTOMER_APPROVAL", label: "Menunggu Persetujuan",  color: "bg-pink-400",     ring: "ring-pink-300",    text: "text-pink-600",    line: "bg-pink-300",    hover: "hover:bg-pink-500",    header: "bg-pink-600"    },
  { key: "VENDOR_CONFIRMED",  label: "Vendor Dikonfirmasi",   color: "bg-rose-400",     ring: "ring-rose-300",    text: "text-rose-600",    line: "bg-rose-300",    hover: "hover:bg-rose-500",    header: "bg-rose-600"    },
  { key: "IN_PROGRESS",       label: "Sedang Diproses",       color: "bg-orange-400",   ring: "ring-orange-300",  text: "text-orange-600",  line: "bg-orange-300",  hover: "hover:bg-orange-500",  header: "bg-orange-600"  },
  { key: "PICKUP",            label: "Penjemputan",           color: "bg-amber-400",    ring: "ring-amber-300",   text: "text-amber-600",   line: "bg-amber-300",   hover: "hover:bg-amber-500",   header: "bg-amber-600"   },
  { key: "IN_TRANSIT",        label: "Dalam Perjalanan",      color: "bg-yellow-400",   ring: "ring-yellow-300",  text: "text-yellow-600",  line: "bg-yellow-300",  hover: "hover:bg-yellow-500",  header: "bg-yellow-600"  },
  { key: "ARRIVED",           label: "Tiba di Tujuan",        color: "bg-lime-400",     ring: "ring-lime-300",    text: "text-lime-600",    line: "bg-lime-300",    hover: "hover:bg-lime-500",    header: "bg-lime-600"    },
  { key: "DELIVERED",         label: "Terkirim",              color: "bg-green-400",    ring: "ring-green-300",   text: "text-green-600",   line: "bg-green-300",   hover: "hover:bg-green-500",   header: "bg-green-600"   },
  { key: "POD_UPLOADED",      label: "Bukti Pengiriman",      color: "bg-teal-400",     ring: "ring-teal-300",    text: "text-teal-600",    line: "bg-teal-300",    hover: "hover:bg-teal-500",    header: "bg-teal-600"    },
  { key: "INVOICE_ISSUED",    label: "Invoice Diterbitkan",   color: "bg-cyan-400",     ring: "ring-cyan-300",    text: "text-cyan-600",    line: "bg-cyan-300",    hover: "hover:bg-cyan-500",    header: "bg-cyan-600"    },
  { key: "PAYMENT_RECEIVED",  label: "Pembayaran Diterima",   color: "bg-sky-400",      ring: "ring-sky-300",     text: "text-sky-600",     line: "bg-sky-300",     hover: "hover:bg-sky-500",     header: "bg-sky-600"     },
  { key: "COMPLETED",         label: "Selesai",               color: "bg-emerald-500",  ring: "ring-emerald-300", text: "text-emerald-600",  line: "bg-emerald-400", hover: "hover:bg-emerald-600", header: "bg-emerald-600" },
] as const;

type StepKey = typeof PROGRESS_STEPS[number]["key"];

const STATUS_TO_STEP: Record<string, StepKey> = {
  "Order Received":    "ORDER_RECEIVED",
  "Admin Review":      "ADMIN_REVIEW",
  "RFQ Sent":          "RFQ_SENT",
  "Quote Received":    "QUOTE_RECEIVED",
  "Customer Approval": "CUSTOMER_APPROVAL",
  "Vendor Confirmed":  "VENDOR_CONFIRMED",
  "In Progress":       "IN_PROGRESS",
  "Pickup":            "PICKUP",
  "In Transit":        "IN_TRANSIT",
  "Arrived":           "ARRIVED",
  "Delivered":         "DELIVERED",
  "POD Uploaded":      "POD_UPLOADED",
  "Invoice Issued":    "INVOICE_ISSUED",
  "Payment Received":  "PAYMENT_RECEIVED",
  "Completed":         "COMPLETED",
  "New Order":         "ORDER_RECEIVED",
  "Under Review":      "ADMIN_REVIEW",
  "Quotation Sent":    "CUSTOMER_APPROVAL",
  "Confirmed":         "VENDOR_CONFIRMED",
};

export function deriveCompletedSteps(order: {
  status: string;
  latestRfq?: { rfqStatus?: string } | null;
  fulfillmentStatus?: string | null;
  linkedSalesDocId?: number | null;
}): Set<StepKey> {
  const done = new Set<StepKey>();
  const stepKey = STATUS_TO_STEP[order.status];
  if (!stepKey) return done;
  const stepIdx = PROGRESS_STEPS.findIndex(s => s.key === stepKey);
  for (let i = 0; i <= stepIdx; i++) done.add(PROGRESS_STEPS[i].key);
  return done;
}

interface ProgressEvent {
  step_key: string;
  actor_name: string | null;
  source: string;
  notes: string | null;
  created_at: string;
}

function formatAuditTime(iso: string): string {
  const d = new Date(iso);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getDate()}/${d.getMonth() + 1}/${d.getFullYear()} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

function sourceLabel(source: string): string {
  switch (source) {
    case "admin":       return "Admin";
    case "customer_wa": return "WhatsApp Customer";
    case "vendor_wa":   return "WhatsApp Vendor";
    case "system":      return "Sistem";
    default:            return source;
  }
}

interface OrderProgressBarProps {
  status?: string;
  order?: {
    status: string;
    latestRfq?: { rfqStatus?: string } | null;
    fulfillmentStatus?: string | null;
    linkedSalesDocId?: number | null;
  };
  orderId?: number;
  onUpdate?: () => void;
}

interface MiniFormState {
  step: typeof PROGRESS_STEPS[number];
  idx: number;
  isUndo: boolean;
}

export function OrderProgressBar({ status, order, orderId, onUpdate }: OrderProgressBarProps) {
  const effectiveStatus = status ?? order?.status ?? "";
  const effectiveOrder = order ?? { status: effectiveStatus };
  const isCancelled = effectiveStatus === "Cancelled";

  const [manualDone, setManualDone] = useState<Set<StepKey>>(new Set());
  const [manualRemoved, setManualRemoved] = useState<Set<StepKey>>(new Set());
  const [loading, setLoading] = useState<string | null>(null);
  const [eventMap, setEventMap] = useState<Map<string, ProgressEvent>>(new Map());
  const [miniForm, setMiniForm] = useState<MiniFormState | null>(null);
  const [notes, setNotes] = useState("");

  const fetchEvents = useCallback(async () => {
    if (!orderId) return;
    try {
      const res = await fetch(`/api/logistic/orders/${orderId}/progress`, { credentials: "include" });
      if (!res.ok) return;
      const data: { events: ProgressEvent[] } = await res.json();
      const map = new Map<string, ProgressEvent>();
      for (const ev of data.events) map.set(ev.step_key, ev);
      setEventMap(map);
    } catch {
      // non-fatal
    }
  }, [orderId]);

  useEffect(() => { fetchEvents(); }, [fetchEvents]);

  const baseDone = deriveCompletedSteps(effectiveOrder);
  const completedSteps = new Set<StepKey>([
    ...Array.from(baseDone).filter(k => !manualRemoved.has(k)),
    ...Array.from(manualDone),
  ]);

  const doneIndices = PROGRESS_STEPS.map((s, i) => completedSteps.has(s.key) ? i : -1).filter(i => i >= 0);
  const activeIdx = doneIndices.length > 0 ? Math.max(...doneIndices) : -1;
  const activeStep = activeIdx >= 0 ? PROGRESS_STEPS[activeIdx] : null;

  const clickable = !!orderId && !isCancelled;

  function handleDotClick(step: typeof PROGRESS_STEPS[number], idx: number) {
    if (!clickable || loading) return;
    const isDone = completedSteps.has(step.key);
    const isActive = idx === activeIdx;
    setNotes("");
    setMiniForm({ step, idx, isUndo: isDone && isActive });
  }

  async function submitMiniForm() {
    if (!miniForm || !orderId) return;
    const { step, idx, isUndo } = miniForm;
    setLoading(step.key);
    try {
      if (isUndo) {
        const res = await fetch(`/api/logistic/orders/${orderId}/progress/${step.key}`, { method: "DELETE", credentials: "include" });
        if (res.ok) {
          setManualDone(prev => { const n = new Set(prev); n.delete(step.key); return n; });
          setManualRemoved(prev => new Set([...prev, step.key]));
          setEventMap(prev => { const n = new Map(prev); n.delete(step.key); return n; });
          onUpdate?.();
        }
      } else {
        const stepsToSet = PROGRESS_STEPS.slice(0, idx + 1).filter(s => !completedSteps.has(s.key));
        for (const s of stepsToSet) {
          await fetch(`/api/logistic/orders/${orderId}/progress/set`, {
            method: "POST",
            credentials: "include",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ stepKey: s.key, notes: notes.trim() || undefined }),
          });
          setManualDone(prev => new Set([...prev, s.key]));
          setManualRemoved(prev => { const n = new Set(prev); n.delete(s.key); return n; });
        }
        await fetchEvents();
        onUpdate?.();
      }
    } finally {
      setLoading(null);
      setMiniForm(null);
      setNotes("");
    }
  }

  return (
    <>
      <TooltipProvider delayDuration={80}>
        <div className="flex items-center gap-2" onClick={(e) => e.stopPropagation()}>
          <div className="flex items-center flex-1 min-w-0">
            {PROGRESS_STEPS.map((step, idx) => {
              const isDone = completedSteps.has(step.key);
              const isActive = idx === activeIdx;
              const isLoadingThis = loading === step.key;
              const isLast = idx === PROGRESS_STEPS.length - 1;
              const isClickable = clickable && (isDone ? isActive : true);
              const event = eventMap.get(step.key);

              const dotClass = cn(
                "flex-shrink-0 rounded-full transition-all duration-200",
                isLoadingThis ? "w-3 h-3 animate-pulse" : isActive ? "w-3.5 h-3.5" : "w-2.5 h-2.5",
                isCancelled && isDone
                  ? "bg-red-400"
                  : isDone && isActive
                  ? `${step.color} ring-2 ${step.ring} scale-110`
                  : isDone
                  ? step.color
                  : "bg-slate-200 dark:bg-slate-700",
                isClickable && !isCancelled ? `cursor-pointer ${step.hover} transition-transform active:scale-90` : "",
                !isDone && clickable ? "hover:bg-slate-400 cursor-pointer" : "",
              );

              const lineClass = cn(
                "flex-1 h-0.5 min-w-[4px] transition-colors duration-200",
                isCancelled && isDone ? "bg-red-200" : isDone && !isActive ? step.line : "bg-slate-200 dark:bg-slate-700",
              );

              return (
                <div key={step.key} className="flex items-center flex-1 min-w-0">
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <div className={dotClass} onClick={() => handleDotClick(step, idx)} />
                    </TooltipTrigger>
                    <TooltipContent side="top" className="text-xs max-w-[200px] text-left p-0 overflow-hidden">
                      <AuditTooltip
                        label={step.label}
                        isDone={isDone}
                        isActive={isActive}
                        isCancelled={isCancelled}
                        clickable={clickable}
                        event={event}
                      />
                    </TooltipContent>
                  </Tooltip>
                  {!isLast && <div className={lineClass} />}
                </div>
              );
            })}
          </div>

          {activeStep && (
            <span className={cn(
              "text-[10px] font-semibold whitespace-nowrap shrink-0 px-1.5 py-0.5 rounded-full border",
              isCancelled
                ? "bg-red-50 text-red-500 border-red-200"
                : `${activeStep.text} border-current bg-white dark:bg-transparent opacity-90`,
            )}>
              {isCancelled ? "✗ Dibatalkan" : `● ${activeStep.label}`}
            </span>
          )}
        </div>
      </TooltipProvider>

      {miniForm && (
        <Dialog open onOpenChange={() => { setMiniForm(null); setNotes(""); }}>
          <DialogContent className="max-w-sm" onClick={(e) => e.stopPropagation()}>
            <DialogHeader>
              <DialogTitle className="flex items-center gap-2 text-sm">
                <span className={cn("inline-block w-3 h-3 rounded-full shrink-0", miniForm.step.color)} />
                {miniForm.isUndo ? "Batalkan" : "Tandai"}: {miniForm.step.label}
              </DialogTitle>
            </DialogHeader>
            {!miniForm.isUndo && (
              <div className="space-y-2 py-1">
                <Label className="text-xs text-muted-foreground">Catatan (opsional)</Label>
                <Textarea
                  rows={2}
                  placeholder={`Catatan untuk langkah "${miniForm.step.label}"…`}
                  value={notes}
                  onChange={(e) => setNotes(e.target.value)}
                  className="text-sm resize-none"
                  autoFocus
                  onKeyDown={(e) => { if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) submitMiniForm(); }}
                />
                <p className="text-[10px] text-muted-foreground">Ctrl+Enter untuk konfirmasi</p>
              </div>
            )}
            {miniForm.isUndo && (
              <p className="text-sm text-muted-foreground py-1">
                Ini akan membatalkan step <strong>{miniForm.step.label}</strong> dan menghapus riwayatnya.
              </p>
            )}
            <DialogFooter className="gap-2">
              <Button variant="outline" size="sm" onClick={() => { setMiniForm(null); setNotes(""); }}>
                Batal
              </Button>
              <Button
                size="sm"
                variant={miniForm.isUndo ? "destructive" : "default"}
                onClick={submitMiniForm}
                disabled={!!loading}
              >
                {loading ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : miniForm.isUndo ? "Batalkan Step" : "Konfirmasi"}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      )}
    </>
  );
}

interface AuditTooltipProps {
  label: string;
  isDone: boolean;
  isActive: boolean;
  isCancelled: boolean;
  clickable: boolean;
  event?: ProgressEvent;
}

function AuditTooltip({ label, isDone, isActive, isCancelled, clickable, event }: AuditTooltipProps) {
  return (
    <div className="min-w-[140px]">
      <div className={cn(
        "px-2.5 py-1.5 font-semibold text-[11px] border-b",
        isDone ? "bg-slate-700 text-white border-slate-600" : "bg-slate-100 text-slate-500 border-slate-200",
      )}>
        {isDone ? "✓ " : ""}{label}
      </div>

      {event ? (
        <div className="px-2.5 py-2 space-y-1 bg-slate-800 text-slate-200">
          <div className="flex items-center gap-1.5">
            <span className="text-slate-400 text-[10px]">👤</span>
            <span className="text-[11px] font-medium truncate max-w-[150px]">
              {event.actor_name ?? sourceLabel(event.source)}
            </span>
          </div>
          {event.actor_name && event.source !== "admin" && (
            <div className="flex items-center gap-1.5">
              <span className="text-slate-400 text-[10px]">🔗</span>
              <span className="text-[10px] text-slate-400">{sourceLabel(event.source)}</span>
            </div>
          )}
          <div className="flex items-center gap-1.5">
            <span className="text-slate-400 text-[10px]">🕐</span>
            <span className="text-[10px] text-slate-300">{formatAuditTime(event.created_at)}</span>
          </div>
          {event.notes && (
            <div className="mt-1 pt-1 border-t border-slate-700 text-[10px] text-slate-400 italic line-clamp-2">
              {event.notes}
            </div>
          )}
        </div>
      ) : isDone ? (
        <div className="px-2.5 py-2 bg-slate-800 text-slate-400 text-[10px] italic">
          Tidak ada rekaman audit
        </div>
      ) : (
        <div className="px-2.5 py-2 bg-slate-50 text-slate-400 text-[10px]">
          {clickable ? "Klik → isi & tandai selesai" : "Belum dilakukan"}
        </div>
      )}

      {isDone && isActive && clickable && !isCancelled && (
        <div className="px-2.5 py-1 bg-red-50 text-red-400 text-[10px] border-t border-red-100">
          Klik untuk undo step ini
        </div>
      )}
    </div>
  );
}
