/**
 * PPJK Phase 9 — Extended financial breakdown
 */
import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter,
} from "@/components/ui/dialog";
import { Loader2, Pencil, TrendingUp } from "lucide-react";
import { toast } from "sonner";

const IDR = (v: string | null | undefined) =>
  !v || v === "0" ? "—" : `Rp ${Number(v).toLocaleString("id-ID")}`;

const NUM = (v: string | null | undefined) => (!v ? "" : String(Number(v)));

interface FinancialData {
  nilaiPabean?: string | null;
  beaMasuk?: string | null;
  ppnImpor?: string | null;
  pphImpor?: string | null;
  totalTagihanPabean?: string | null;
  bmtp?: string | null;
  bmad?: string | null;
  storageFee?: string | null;
  handlingFee?: string | null;
  thc?: string | null;
  doFee?: string | null;
  forwardingFee?: string | null;
  truckingFee?: string | null;
  miscFee?: string | null;
  serviceFee?: string | null;
  ppnServiceFee?: string | null;
  totalServiceFee?: string | null;
}

interface Props {
  orderId: number;
  data: FinancialData;
}

function Row({ label, value, highlight = false }: { label: string; value: string; highlight?: boolean }) {
  if (value === "—") return null;
  return (
    <div className={`flex justify-between items-center py-1.5 border-b last:border-0 ${highlight ? "font-bold" : ""}`}>
      <span className="text-xs text-muted-foreground">{label}</span>
      <span className={`text-xs font-medium ${highlight ? "text-orange-700 text-sm" : ""}`}>{value}</span>
    </div>
  );
}

function computeGrandTotal(d: FinancialData): number {
  const vals = [
    d.totalTagihanPabean,
    d.bmtp, d.bmad, d.storageFee, d.handlingFee, d.thc, d.doFee,
    d.forwardingFee, d.truckingFee, d.miscFee, d.totalServiceFee,
  ];
  return vals.reduce((sum, v) => sum + (v ? Number(v) : 0), 0);
}

export function PpjkFinancialBreakdown({ orderId, data }: Props) {
  const qc = useQueryClient();
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState({
    nilaiPabean: NUM(data.nilaiPabean),
    beaMasuk: NUM(data.beaMasuk),
    ppnImpor: NUM(data.ppnImpor),
    pphImpor: NUM(data.pphImpor),
    totalTagihanPabean: NUM(data.totalTagihanPabean),
    bmtp: NUM(data.bmtp),
    bmad: NUM(data.bmad),
    storageFee: NUM(data.storageFee),
    handlingFee: NUM(data.handlingFee),
    thc: NUM(data.thc),
    doFee: NUM(data.doFee),
    forwardingFee: NUM(data.forwardingFee),
    truckingFee: NUM(data.truckingFee),
    miscFee: NUM(data.miscFee),
    serviceFee: NUM(data.serviceFee),
    ppnServiceFee: NUM(data.ppnServiceFee),
    totalServiceFee: NUM(data.totalServiceFee),
  });
  const f = (k: keyof typeof form, v: string) => setForm((p) => ({ ...p, [k]: v }));

  const mutation = useMutation({
    mutationFn: async () => {
      const r = await fetch(`/api/ppjk/orders/${orderId}`, {
        method: "PUT",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(form),
      });
      if (!r.ok) throw new Error("Gagal menyimpan");
      return r.json();
    },
    onSuccess: () => {
      toast.success("Data finansial disimpan");
      qc.invalidateQueries({ queryKey: ["ppjk-order", orderId] });
      setOpen(false);
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const grandTotal = computeGrandTotal(data);

  const NumField = ({ label, k }: { label: string; k: keyof typeof form }) => (
    <div className="space-y-1">
      <Label className="text-xs">{label}</Label>
      <Input
        type="number"
        value={form[k]}
        onChange={(e) => f(k, e.target.value)}
        className="h-8 text-xs"
        placeholder="0"
      />
    </div>
  );

  return (
    <>
      <div className="space-y-0">
        <div className="flex items-center justify-between mb-2">
          <span className="text-xs text-muted-foreground font-semibold uppercase tracking-wide">Rincian Biaya</span>
          <Button size="sm" variant="ghost" className="h-7 text-xs" onClick={() => setOpen(true)}>
            <Pencil className="w-3 h-3 mr-1" /> Edit
          </Button>
        </div>
        <div className="text-xs font-semibold text-muted-foreground mb-1 mt-2">Kepabeanan</div>
        <Row label="Nilai Pabean (CIF)" value={IDR(data.nilaiPabean)} />
        <Row label="Bea Masuk" value={IDR(data.beaMasuk)} />
        <Row label="PPN Impor" value={IDR(data.ppnImpor)} />
        <Row label="PPh Impor" value={IDR(data.pphImpor)} />
        <Row label="BMTP" value={IDR(data.bmtp)} />
        <Row label="BMAD" value={IDR(data.bmad)} />
        <Row label="Total Tagihan Pabean" value={IDR(data.totalTagihanPabean)} highlight />
        <div className="text-xs font-semibold text-muted-foreground mb-1 mt-3">Biaya Operasional</div>
        <Row label="Storage" value={IDR(data.storageFee)} />
        <Row label="Handling" value={IDR(data.handlingFee)} />
        <Row label="THC" value={IDR(data.thc)} />
        <Row label="Delivery Order (DO)" value={IDR(data.doFee)} />
        <Row label="Forwarding" value={IDR(data.forwardingFee)} />
        <Row label="Trucking" value={IDR(data.truckingFee)} />
        <Row label="Lain-lain" value={IDR(data.miscFee)} />
        <div className="text-xs font-semibold text-muted-foreground mb-1 mt-3">Jasa PPJK</div>
        <Row label="Service Fee" value={IDR(data.serviceFee)} />
        <Row label="PPN Service Fee" value={IDR(data.ppnServiceFee)} />
        <Row label="Total Jasa PPJK" value={IDR(data.totalServiceFee)} highlight />
        {grandTotal > 0 && (
          <div className="mt-3 pt-3 border-t-2 flex justify-between items-center">
            <span className="text-sm font-bold flex items-center gap-1.5"><TrendingUp className="w-4 h-4 text-blue-600" /> Grand Total</span>
            <span className="text-base font-bold text-blue-700">{`Rp ${grandTotal.toLocaleString("id-ID")}`}</span>
          </div>
        )}
      </div>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-w-2xl max-h-[85vh] overflow-y-auto">
          <DialogHeader><DialogTitle>Edit Rincian Finansial</DialogTitle></DialogHeader>
          <div className="space-y-4 py-2">
            <div>
              <p className="text-xs font-semibold text-muted-foreground uppercase mb-2">Kepabeanan</p>
              <div className="grid grid-cols-3 gap-3">
                <NumField label="Nilai Pabean (CIF)" k="nilaiPabean" />
                <NumField label="Bea Masuk" k="beaMasuk" />
                <NumField label="PPN Impor" k="ppnImpor" />
                <NumField label="PPh Impor" k="pphImpor" />
                <NumField label="BMTP" k="bmtp" />
                <NumField label="BMAD" k="bmad" />
                <div className="col-span-3"><NumField label="Total Tagihan Pabean" k="totalTagihanPabean" /></div>
              </div>
            </div>
            <div className="border-t pt-4">
              <p className="text-xs font-semibold text-muted-foreground uppercase mb-2">Biaya Operasional</p>
              <div className="grid grid-cols-3 gap-3">
                <NumField label="Storage" k="storageFee" />
                <NumField label="Handling" k="handlingFee" />
                <NumField label="THC" k="thc" />
                <NumField label="Delivery Order (DO)" k="doFee" />
                <NumField label="Forwarding" k="forwardingFee" />
                <NumField label="Trucking" k="truckingFee" />
                <NumField label="Lain-lain (Misc)" k="miscFee" />
              </div>
            </div>
            <div className="border-t pt-4">
              <p className="text-xs font-semibold text-muted-foreground uppercase mb-2">Jasa PPJK</p>
              <div className="grid grid-cols-3 gap-3">
                <NumField label="Service Fee" k="serviceFee" />
                <NumField label="PPN Service Fee" k="ppnServiceFee" />
                <NumField label="Total Jasa PPJK" k="totalServiceFee" />
              </div>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setOpen(false)}>Batal</Button>
            <Button onClick={() => mutation.mutate()} disabled={mutation.isPending}>
              {mutation.isPending ? <Loader2 className="w-4 h-4 animate-spin mr-2" /> : null}
              Simpan
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
