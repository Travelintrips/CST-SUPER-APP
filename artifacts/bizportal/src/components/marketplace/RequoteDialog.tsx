import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { AlertCircle, RotateCcw } from "lucide-react";
import { toast } from "sonner";

interface RequoteDialogProps {
  open: boolean;
  onClose: () => void;
  rfqId: number;
  quoteId: number;
  vendorName: string;
  currentRound?: number;
}

export function RequoteDialog({ open, onClose, rfqId, quoteId, vendorName, currentRound = 1 }: RequoteDialogProps) {
  const [notes, setNotes] = useState("");
  const [deadline, setDeadline] = useState("");
  const qc = useQueryClient();

  const mutation = useMutation({
    mutationFn: async () => {
      const body: Record<string, unknown> = { notes: notes.trim() };
      if (deadline) body["deadline"] = deadline;
      const res = await fetch(`/api/mkt/admin/rfqs/${rfqId}/quotes/${quoteId}/request-requote`, {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      if (!res.ok) {
        const data = await res.json() as { error?: string };
        throw new Error(data.error ?? "Gagal meminta requote");
      }
      return res.json();
    },
    onSuccess: () => {
      toast.success(`Requote berhasil diminta dari ${vendorName}`);
      void qc.invalidateQueries({ queryKey: ["mkt-comparison", rfqId] });
      void qc.invalidateQueries({ queryKey: ["mkt-vendor-quotes", rfqId] });
      setNotes("");
      setDeadline("");
      onClose();
    },
    onError: (err: Error) => {
      toast.error(err.message);
    },
  });

  function handleSubmit() {
    if (!notes.trim()) {
      toast.error("Alasan requote wajib diisi");
      return;
    }
    mutation.mutate();
  }

  return (
    <Dialog open={open} onOpenChange={(v) => { if (!v) onClose(); }}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <RotateCcw className="w-4 h-4 text-orange-500" />
            Request Requote
          </DialogTitle>
        </DialogHeader>

        <div className="space-y-4 py-2">
          <div className="flex items-center gap-2 p-3 bg-orange-50 rounded-lg border border-orange-200">
            <AlertCircle className="w-4 h-4 text-orange-500 shrink-0" />
            <div className="text-sm">
              <p className="font-medium text-orange-800">Vendor: {vendorName}</p>
              <p className="text-orange-600">Round {currentRound} → {currentRound + 1}</p>
            </div>
            <Badge variant="outline" className="ml-auto text-xs bg-orange-100 text-orange-700 border-orange-300">
              Round {currentRound}
            </Badge>
          </div>

          <div className="space-y-2">
            <Label htmlFor="requote-notes">
              Alasan Requote <span className="text-red-500">*</span>
            </Label>
            <Textarea
              id="requote-notes"
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              placeholder="Contoh: Harga terlalu tinggi, mohon revisi untuk item X. Detail spesifikasi perlu diperjelas."
              rows={4}
              className="resize-none"
            />
            <p className="text-xs text-muted-foreground">{notes.length}/500 karakter</p>
          </div>

          <div className="space-y-2">
            <Label htmlFor="requote-deadline">Deadline (opsional)</Label>
            <Input
              id="requote-deadline"
              type="datetime-local"
              value={deadline}
              onChange={(e) => setDeadline(e.target.value)}
              min={new Date().toISOString().slice(0, 16)}
            />
            <p className="text-xs text-muted-foreground">Kosongkan jika tidak ada deadline</p>
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={mutation.isPending}>
            Batal
          </Button>
          <Button
            onClick={handleSubmit}
            disabled={mutation.isPending || !notes.trim()}
            className="bg-orange-500 hover:bg-orange-600 text-white"
          >
            {mutation.isPending ? "Mengirim…" : "Kirim Requote"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
