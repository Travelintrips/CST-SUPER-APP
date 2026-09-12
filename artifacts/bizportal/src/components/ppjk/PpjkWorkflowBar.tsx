/**
 * PPJK Phase 2 — Workflow status bar with transition controls
 */
import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter,
} from "@/components/ui/dialog";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { CheckCircle, ArrowRight, Loader2, ChevronRight, AlertTriangle } from "lucide-react";
import { toast } from "sonner";

const STATUS_LABELS: Record<string, string> = {
  draft: "Draft",
  waiting_documents: "Menunggu Dokumen",
  document_review: "Review Dokumen",
  document_completed: "Dokumen Lengkap",
  quotation: "Penawaran Harga",
  waiting_customer: "Menunggu Customer",
  customer_approved: "Customer Setuju",
  preparing_pib: "Persiapan PIB",
  preparing_peb: "Persiapan PEB",
  submitted_ceisa: "Diajukan ke CEISA",
  inspection: "Pemeriksaan BC",
  red_lane: "Jalur Merah",
  yellow_lane: "Jalur Kuning",
  green_lane: "Jalur Hijau",
  hold: "Ditahan",
  sppb: "SPPB Terbit",
  released: "Barang Dikeluarkan",
  completed: "Selesai",
  cancelled: "Dibatalkan",
};

const STATUS_COLORS: Record<string, string> = {
  draft: "bg-gray-100 text-gray-700 border-gray-200",
  waiting_documents: "bg-yellow-100 text-yellow-800 border-yellow-200",
  document_review: "bg-blue-100 text-blue-800 border-blue-200",
  document_completed: "bg-teal-100 text-teal-800 border-teal-200",
  quotation: "bg-purple-100 text-purple-800 border-purple-200",
  waiting_customer: "bg-orange-100 text-orange-800 border-orange-200",
  customer_approved: "bg-emerald-100 text-emerald-800 border-emerald-200",
  preparing_pib: "bg-sky-100 text-sky-800 border-sky-200",
  preparing_peb: "bg-sky-100 text-sky-800 border-sky-200",
  submitted_ceisa: "bg-indigo-100 text-indigo-800 border-indigo-200",
  inspection: "bg-amber-100 text-amber-800 border-amber-200",
  red_lane: "bg-red-100 text-red-800 border-red-200",
  yellow_lane: "bg-yellow-100 text-yellow-800 border-yellow-200",
  green_lane: "bg-green-100 text-green-800 border-green-200",
  hold: "bg-orange-100 text-orange-800 border-orange-200",
  sppb: "bg-green-200 text-green-900 border-green-300",
  released: "bg-emerald-200 text-emerald-900 border-emerald-300",
  completed: "bg-emerald-300 text-emerald-950 border-emerald-400",
  cancelled: "bg-red-100 text-red-800 border-red-200",
};

const PROGRESS_STEPS = [
  "draft", "waiting_documents", "document_review", "document_completed",
  "quotation", "waiting_customer", "customer_approved",
  "preparing_pib", "submitted_ceisa", "inspection", "green_lane", "sppb", "released", "completed",
];

interface Props {
  orderId: number;
  currentStatus: string;
  allowedTransitions: string[];
  onUpdated: () => void;
}

export function PpjkWorkflowBar({ orderId, currentStatus, allowedTransitions, onUpdated }: Props) {
  const [dialogOpen, setDialogOpen] = useState(false);
  const [targetStatus, setTargetStatus] = useState("");
  const [notes, setNotes] = useState("");
  const qc = useQueryClient();

  const currentIdx = PROGRESS_STEPS.indexOf(currentStatus);

  const mutation = useMutation({
    mutationFn: async () => {
      const r = await fetch(`/api/ppjk/orders/${orderId}/workflow`, {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status: targetStatus, notes: notes || undefined }),
      });
      const data = await r.json();
      if (!r.ok) throw new Error(data.message ?? "Gagal");
      return data;
    },
    onSuccess: () => {
      toast.success(`Status diperbarui → ${STATUS_LABELS[targetStatus] ?? targetStatus}`);
      qc.invalidateQueries({ queryKey: ["ppjk-order", orderId] });
      onUpdated();
      setDialogOpen(false);
      setNotes("");
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const isTerminal = currentStatus === "completed" || currentStatus === "cancelled";
  const isCancelled = currentStatus === "cancelled";

  return (
    <div className="space-y-3">
      {/* Current status badge */}
      <div className="flex items-center gap-3 flex-wrap">
        <Badge className={`text-sm px-3 py-1 border font-semibold ${STATUS_COLORS[currentStatus] ?? "bg-gray-100 text-gray-700"}`}>
          {STATUS_LABELS[currentStatus] ?? currentStatus}
        </Badge>
        {!isTerminal && allowedTransitions.length > 0 && (
          <Button
            size="sm"
            className="gap-1.5"
            onClick={() => {
              setTargetStatus(allowedTransitions[0] ?? "");
              setDialogOpen(true);
            }}
          >
            <ArrowRight className="w-3.5 h-3.5" />
            Ubah Status
          </Button>
        )}
      </div>

      {/* Progress stepper */}
      {!isCancelled && (
        <div className="flex items-center gap-0 overflow-x-auto pb-1 scrollbar-hide">
          {PROGRESS_STEPS.map((s, i) => {
            const done = i < currentIdx;
            const active = i === currentIdx;
            return (
              <div key={s} className="flex items-center shrink-0">
                <div className="flex flex-col items-center gap-0.5 min-w-[52px]">
                  <div className={`w-5 h-5 rounded-full border-2 flex items-center justify-center transition-all ${
                    done ? "border-emerald-500 bg-emerald-500" :
                    active ? "border-blue-500 bg-blue-500" :
                    "border-gray-300 bg-white"
                  }`}>
                    {done && <CheckCircle className="w-3.5 h-3.5 text-white" />}
                    {active && <div className="w-2 h-2 rounded-full bg-white" />}
                  </div>
                  <span className={`text-[8px] text-center leading-tight max-w-[52px] ${
                    active ? "text-blue-700 font-semibold" : done ? "text-emerald-600" : "text-gray-400"
                  }`}>
                    {(STATUS_LABELS[s] ?? s).split(" ").slice(0, 2).join(" ")}
                  </span>
                </div>
                {i < PROGRESS_STEPS.length - 1 && (
                  <div className={`h-px w-3 mt-[-8px] ${done ? "bg-emerald-400" : "bg-gray-200"}`} />
                )}
              </div>
            );
          })}
        </div>
      )}

      {isCancelled && (
        <div className="flex items-center gap-2 text-red-700 bg-red-50 border border-red-200 rounded-lg px-3 py-2 text-sm">
          <AlertTriangle className="w-4 h-4 shrink-0" />
          Order ini telah dibatalkan.
        </div>
      )}

      {/* Transition dialog */}
      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle>Ubah Status Workflow</DialogTitle>
          </DialogHeader>
          <div className="space-y-4 py-2">
            <div className="flex items-center gap-2 text-sm text-muted-foreground">
              <span className={`px-2 py-0.5 rounded-full text-xs font-medium border ${STATUS_COLORS[currentStatus] ?? ""}`}>
                {STATUS_LABELS[currentStatus] ?? currentStatus}
              </span>
              <ChevronRight className="w-4 h-4" />
              <span className={`px-2 py-0.5 rounded-full text-xs font-medium border ${STATUS_COLORS[targetStatus] ?? ""}`}>
                {STATUS_LABELS[targetStatus] ?? targetStatus}
              </span>
            </div>
            <div className="space-y-1.5">
              <Label>Status Tujuan</Label>
              <Select value={targetStatus} onValueChange={setTargetStatus}>
                <SelectTrigger>
                  <SelectValue placeholder="Pilih status..." />
                </SelectTrigger>
                <SelectContent>
                  {allowedTransitions.map((s) => (
                    <SelectItem key={s} value={s}>{STATUS_LABELS[s] ?? s}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label>Catatan (opsional)</Label>
              <Textarea
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                rows={2}
                className="resize-none"
                placeholder="Alasan perubahan status..."
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDialogOpen(false)}>Batal</Button>
            <Button onClick={() => mutation.mutate()} disabled={mutation.isPending || !targetStatus}>
              {mutation.isPending ? <Loader2 className="w-4 h-4 animate-spin mr-2" /> : <CheckCircle className="w-4 h-4 mr-2" />}
              Konfirmasi
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
