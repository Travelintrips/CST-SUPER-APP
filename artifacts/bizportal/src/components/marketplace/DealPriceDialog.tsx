import { useEffect, useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { toast } from "sonner";
import { BadgeDollarSign } from "lucide-react";

interface DealLine {
  rfqLineId: number;
  itemName: string | null;
  offeredQty: string;
  vendorUnitPrice: string;
  vendorSubtotal: string;
  dealUnitPrice: string | null;
  dealSubtotal: string | null;
  unit: string | null;
}

interface DealData {
  updatedAt: string;
  vendorName: string | null;
  negotiatedNotes: string | null;
  lines: DealLine[];
}

interface Props {
  open: boolean;
  rfqId: number;
  quoteId: number | null;
  vendorName: string;
  locked?: boolean;
  onClose: () => void;
  onSaved?: () => void;
}

export function DealPriceDialog({ open, rfqId, quoteId, vendorName, locked = false, onClose, onSaved }: Props) {
  const qc = useQueryClient();
  const [prices, setPrices] = useState<Record<number, string>>({});
  const [notes, setNotes] = useState("");

  const { data, isLoading, isError } = useQuery<{ ok: boolean; data: DealData }>({
    queryKey: ["mkt-deal-price", rfqId, quoteId],
    queryFn: async () => {
      const res = await fetch(`/api/mkt/admin/rfqs/${rfqId}/quotes/${quoteId}/deal-price`, { credentials: "include" });
      if (!res.ok) throw new Error("Gagal memuat harga deal");
      return res.json();
    },
    enabled: open && !!quoteId,
  });

  useEffect(() => {
    if (!data?.data) return;
    setPrices(Object.fromEntries(data.data.lines.map((line) => [line.rfqLineId, line.dealUnitPrice ?? ""])));
    setNotes(data.data.negotiatedNotes ?? "");
  }, [data]);

  const total = useMemo(() => (data?.data.lines ?? []).reduce((sum, line) => {
    const price = Number(prices[line.rfqLineId]);
    return sum + (Number.isFinite(price) ? price * Number(line.offeredQty) : 0);
  }, 0), [data, prices]);

  const saveMutation = useMutation({
    mutationFn: async () => {
      if (!data?.data) throw new Error("Data quote belum tersedia");
      const lines = data.data.lines.map((line) => ({
        rfqLineId: line.rfqLineId,
        dealUnitPrice: Number(prices[line.rfqLineId]),
      }));
      if (lines.some((line) => !Number.isFinite(line.dealUnitPrice) || line.dealUnitPrice <= 0)) {
        throw new Error("Semua harga deal harus diisi dan lebih besar dari nol");
      }
      const res = await fetch(`/api/mkt/admin/rfqs/${rfqId}/quotes/${quoteId}/deal-price`, {
        method: "PUT",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          expectedUpdatedAt: data.data.updatedAt,
          dealNotes: notes || null,
          lines,
        }),
      });
      const body = await res.json() as { error?: string; message?: string };
      if (!res.ok) throw new Error(body.message ?? body.error ?? "Gagal menyimpan harga deal");
      return body;
    },
    onSuccess: () => {
      toast.success("Harga deal berhasil disimpan");
      void qc.invalidateQueries({ queryKey: ["mkt-deal-price", rfqId, quoteId] });
      void qc.invalidateQueries({ queryKey: ["mkt-comparison", rfqId] });
      void qc.invalidateQueries({ queryKey: ["mkt-vendor-quotes", rfqId] });
      onSaved?.();
      onClose();
    },
    onError: (error: Error) => toast.error(error.message),
  });

  return (
    <Dialog open={open} onOpenChange={(value) => { if (!value) onClose(); }}>
      <DialogContent className="max-w-3xl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 text-orange-700">
            <BadgeDollarSign className="w-5 h-5" />
            Harga Deal — {vendorName}
          </DialogTitle>
        </DialogHeader>

        {isLoading && <p className="py-8 text-center text-sm text-muted-foreground">Memuat detail harga…</p>}
        {isError && <p className="py-8 text-center text-sm text-red-600">Harga deal tidak dapat dimuat.</p>}
        {!isLoading && !isError && data?.data && (
          <div className="space-y-4">
            <p className="text-sm text-muted-foreground">
              Harga vendor adalah biaya sumber dan tidak diubah. Harga deal di bawah ini menjadi harga yang terlihat customer dan disalin ke PO.
            </p>
            <div className="rounded-lg border overflow-hidden">
              <div className="grid grid-cols-[1.5fr_.7fr_1fr_1fr_1fr] gap-2 bg-gray-50 px-3 py-2 text-xs font-semibold text-muted-foreground">
                <span>Item</span><span>Qty</span><span>Harga Vendor</span><span>Harga Deal</span><span>Subtotal Deal</span>
              </div>
              {data.data.lines.map((line) => {
                const dealPrice = Number(prices[line.rfqLineId]);
                const subtotal = Number.isFinite(dealPrice) ? dealPrice * Number(line.offeredQty) : 0;
                return (
                  <div key={line.rfqLineId} className="grid grid-cols-[1.5fr_.7fr_1fr_1fr_1fr] gap-2 items-center px-3 py-2 border-t text-sm">
                    <span className="truncate">{line.itemName ?? `Line #${line.rfqLineId}`}</span>
                    <span>{line.offeredQty} {line.unit ?? ""}</span>
                    <span className="text-muted-foreground">Rp {Number(line.vendorUnitPrice).toLocaleString("id-ID")}</span>
                    <Input
                      type="number"
                      min="1"
                      step="0.01"
                      value={prices[line.rfqLineId] ?? ""}
                      disabled={locked}
                      onChange={(event) => setPrices((current) => ({ ...current, [line.rfqLineId]: event.target.value }))}
                      className="h-8"
                    />
                    <span className="font-semibold">Rp {subtotal.toLocaleString("id-ID")}</span>
                  </div>
                );
              })}
            </div>
            <div className="flex justify-end text-base font-bold">Total Deal: Rp {total.toLocaleString("id-ID")}</div>
            <div>
              <Label>Catatan negosiasi (opsional)</Label>
              <Textarea value={notes} disabled={locked} onChange={(event) => setNotes(event.target.value)} rows={3} className="mt-1 resize-none" />
            </div>
          </div>
        )}
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>Tutup</Button>
          {!locked && (
            <Button className="bg-orange-500 hover:bg-orange-600" onClick={() => saveMutation.mutate()} disabled={saveMutation.isPending || isLoading || isError}>
              {saveMutation.isPending ? "Menyimpan…" : "Simpan Harga Deal"}
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}