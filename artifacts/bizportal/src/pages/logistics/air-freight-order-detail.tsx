import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useRoute, useLocation } from "wouter";
import { Button } from "@/components/ui/button";
import { LoadingSkeleton } from "@/components/ui/loading-skeleton";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter,
} from "@/components/ui/dialog";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { Separator } from "@/components/ui/separator";
import { toast } from "@/hooks/use-toast";
import {
  ArrowLeft, PlaneTakeoff, Send, CheckCircle, Truck,
  RefreshCw, Zap, FileText, DollarSign, Settings2, Star,
} from "lucide-react";
import { Link } from "wouter";
import { FreightDocVerifyPanel } from "@/components/logistics/FreightDocVerifyPanel";

const IDR = (v: string | number | null | undefined) =>
  v ? `Rp ${Number(v).toLocaleString("id-ID")}` : "-";
const N = (v: any) => parseFloat(v ?? "0") || 0;

const STATUS_LABELS: Record<string, string> = {
  inquiry: "Inquiry",
  rfq_blasted: "RFQ Terkirim",
  rate_received: "Rate Diterima",
  quote_ready: "Quote Siap",
  quote_sent: "Quote Terkirim",
  booking_confirmed: "Booking Dikonfirmasi",
  in_transit: "In Transit",
  arrived: "Tiba",
  completed: "Selesai",
  cancelled: "Dibatalkan",
};

const STATUS_COLORS: Record<string, string> = {
  inquiry: "bg-slate-100 text-slate-700",
  rfq_blasted: "bg-blue-100 text-blue-700",
  rate_received: "bg-purple-100 text-purple-700",
  quote_ready: "bg-yellow-100 text-yellow-700",
  quote_sent: "bg-orange-100 text-orange-700",
  booking_confirmed: "bg-green-100 text-green-700",
  in_transit: "bg-cyan-100 text-cyan-700",
  arrived: "bg-teal-100 text-teal-700",
  completed: "bg-emerald-100 text-emerald-700",
  cancelled: "bg-red-100 text-red-700",
};

function FieldRow({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="flex justify-between py-1.5 border-b border-slate-100 last:border-0">
      <span className="text-sm text-slate-500">{label}</span>
      <span className="text-sm font-medium text-slate-800 text-right max-w-[60%]">{value ?? "-"}</span>
    </div>
  );
}

// ── Blast RFQ Dialog ──────────────────────────────────────────────────────────
function BlastRfqDialog({ orderId, open, onClose, onBlasted }: {
  orderId: number; open: boolean; onClose: () => void; onBlasted: () => void;
}) {
  const [selectedVendors, setSelectedVendors] = useState<number[]>([]);
  const [responseHours, setResponseHours] = useState("48");
  const [notes, setNotes] = useState("");
  const [saving, setSaving] = useState(false);

  const { data } = useQuery({
    queryKey: ["air-freight-eligible-vendors", orderId],
    queryFn: async () => {
      const r = await fetch(`/api/air-freight/orders/${orderId}/eligible-vendors`);
      return r.json() as Promise<{ vendors: any[] }>;
    },
    enabled: open,
  });

  const vendors = data?.vendors ?? [];

  const toggleVendor = (id: number) =>
    setSelectedVendors(prev => prev.includes(id) ? prev.filter(v => v !== id) : [...prev, id]);

  const handleBlast = async () => {
    if (selectedVendors.length === 0) { toast({ title: "Pilih vendor dulu", variant: "destructive" }); return; }
    setSaving(true);
    try {
      const r = await fetch(`/api/air-freight/orders/${orderId}/blast-rfq`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ vendorIds: selectedVendors, responseHours: parseInt(responseHours), notes }),
      });
      if (!r.ok) throw new Error(await r.text());
      toast({ title: "RFQ berhasil dikirim ke vendor" });
      onBlasted();
    } catch (e: any) {
      toast({ title: "Gagal", description: e.message, variant: "destructive" });
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>Blast RFQ ke Vendor Air Freight</DialogTitle>
        </DialogHeader>
        <div className="space-y-4">
          <div>
            <Label>Vendor Eligible ({vendors.length})</Label>
            <div className="mt-2 max-h-48 overflow-y-auto border rounded-lg divide-y">
              {vendors.length === 0 && (
                <p className="text-sm text-slate-400 p-3 text-center">Tidak ada vendor air freight aktif</p>
              )}
              {vendors.map((v: any) => (
                <label key={v.id} className="flex items-center gap-3 p-3 cursor-pointer hover:bg-slate-50">
                  <input
                    type="checkbox"
                    checked={selectedVendors.includes(v.id)}
                    onChange={() => toggleVendor(v.id)}
                    className="rounded"
                  />
                  <div>
                    <div className="text-sm font-medium">{v.name}</div>
                    <div className="text-xs text-slate-500">{v.serviceType} · {v.phone ?? "no phone"}</div>
                  </div>
                </label>
              ))}
            </div>
          </div>
          <div>
            <Label>Deadline Respon (jam)</Label>
            <Input value={responseHours} onChange={(e) => setResponseHours(e.target.value)} type="number" min="1" className="mt-1" />
          </div>
          <div>
            <Label>Catatan (opsional)</Label>
            <Textarea value={notes} onChange={(e) => setNotes(e.target.value)} className="mt-1" rows={2} />
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>Batal</Button>
          <Button onClick={handleBlast} disabled={saving || selectedVendors.length === 0}>
            <Send className="h-4 w-4 mr-1" />
            {saving ? "Mengirim..." : `Blast ke ${selectedVendors.length} Vendor`}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ── Manual Rate Dialog ────────────────────────────────────────────────────────
function ManualRateDialog({ orderId, order, open, onClose, onSaved }: {
  orderId: number; order: any; open: boolean; onClose: () => void; onSaved: () => void;
}) {
  const [form, setForm] = useState({
    airline: order?.airline ?? "",
    flightNumber: order?.flightNumber ?? "",
    etd: order?.etd ?? "",
    eta: order?.eta ?? "",
    transitDays: order?.transitDays ?? "",
    finalRatePerKg: order?.finalRatePerKg ?? "",
    fuelSurcharge: order?.fuelSurcharge ?? "0",
    securitySurcharge: order?.securitySurcharge ?? "0",
    awbFee: order?.awbFee ?? "0",
    handlingFee: order?.handlingFee ?? "0",
    xrayFee: order?.xrayFee ?? "0",
    docFee: order?.docFee ?? "0",
    customsClearanceFee: order?.customsClearanceFee ?? "0",
    pickupTrucking: order?.pickupTrucking ?? "0",
    deliveryTrucking: order?.deliveryTrucking ?? "0",
    cargoSurcharge: order?.cargoSurcharge ?? "0",
    markupAmount: order?.markupAmount ?? "0",
    ppnPct: order?.ppnPct ?? "11",
  });
  const [saving, setSaving] = useState(false);
  const set = (k: string, v: string) => setForm(f => ({ ...f, [k]: v }));

  const n = (v: string) => parseFloat(v || "0") || 0;
  const cw = N(order?.chargeableWeight);
  const freight = n(form.finalRatePerKg) * cw;
  const surcharges = n(form.fuelSurcharge) + n(form.securitySurcharge) + n(form.cargoSurcharge);
  const fees = n(form.awbFee) + n(form.handlingFee) + n(form.xrayFee) + n(form.docFee)
    + n(form.customsClearanceFee) + n(form.pickupTrucking) + n(form.deliveryTrucking);
  const markup = n(form.markupAmount);
  const sub = freight + surcharges + fees + markup;
  const ppn = sub * (n(form.ppnPct) / 100);
  const grand = sub + ppn;

  const handleSave = async () => {
    setSaving(true);
    try {
      const r = await fetch(`/api/air-freight/orders/${orderId}/manual-rate`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(form),
      });
      if (!r.ok) throw new Error(await r.text());
      toast({ title: "Rate berhasil disimpan" });
      onSaved();
    } catch (e: any) {
      toast({ title: "Gagal", description: e.message, variant: "destructive" });
    } finally {
      setSaving(false);
    }
  };

  const Field = ({ label, k, type = "text" }: { label: string; k: string; type?: string }) => (
    <div>
      <Label className="text-xs">{label}</Label>
      <Input type={type} value={(form as any)[k]} onChange={(e) => set(k, e.target.value)} className="mt-1 h-8 text-sm" />
    </div>
  );

  return (
    <Dialog open={open} onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Input Manual Final Rate</DialogTitle>
        </DialogHeader>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Airline" k="airline" />
          <Field label="Flight Number" k="flightNumber" />
          <Field label="ETD" k="etd" />
          <Field label="ETA" k="eta" />
          <Field label="Transit Days" k="transitDays" type="number" />
          <Field label="Rate / kg (IDR)" k="finalRatePerKg" type="number" />
          <Field label="Fuel Surcharge" k="fuelSurcharge" type="number" />
          <Field label="Security Surcharge" k="securitySurcharge" type="number" />
          <Field label="AWB Fee" k="awbFee" type="number" />
          <Field label="Handling Fee" k="handlingFee" type="number" />
          <Field label="X-Ray Fee" k="xrayFee" type="number" />
          <Field label="Doc Fee" k="docFee" type="number" />
          <Field label="Customs Clearance Fee" k="customsClearanceFee" type="number" />
          <Field label="Pickup Trucking" k="pickupTrucking" type="number" />
          <Field label="Delivery Trucking" k="deliveryTrucking" type="number" />
          <Field label="Cargo Surcharge" k="cargoSurcharge" type="number" />
          <Field label="Markup Amount" k="markupAmount" type="number" />
          <Field label="PPN (%)" k="ppnPct" type="number" />
        </div>

        <div className="mt-3 rounded-lg bg-slate-50 p-3 space-y-1">
          <div className="flex justify-between text-sm">
            <span className="text-slate-500">Freight ({n(form.finalRatePerKg).toLocaleString("id-ID")} × {cw} kg)</span>
            <span>{IDR(freight)}</span>
          </div>
          <div className="flex justify-between text-sm">
            <span className="text-slate-500">Surcharges</span>
            <span>{IDR(surcharges)}</span>
          </div>
          <div className="flex justify-between text-sm">
            <span className="text-slate-500">Fees</span>
            <span>{IDR(fees)}</span>
          </div>
          <div className="flex justify-between text-sm">
            <span className="text-slate-500">Markup</span>
            <span>{IDR(markup)}</span>
          </div>
          <div className="flex justify-between text-sm font-medium border-t pt-1">
            <span>Subtotal</span>
            <span>{IDR(sub)}</span>
          </div>
          <div className="flex justify-between text-sm">
            <span className="text-slate-500">PPN {n(form.ppnPct)}%</span>
            <span>{IDR(ppn)}</span>
          </div>
          <div className="flex justify-between text-base font-bold border-t pt-1">
            <span>Grand Total</span>
            <span className="text-green-700">{IDR(grand)}</span>
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={onClose}>Batal</Button>
          <Button onClick={handleSave} disabled={saving}>
            {saving ? "Menyimpan..." : "Simpan Rate"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ── Tracking Dialog ───────────────────────────────────────────────────────────
function TrackingDialog({ orderId, order, open, onClose, onSaved }: {
  orderId: number; order: any; open: boolean; onClose: () => void; onSaved: () => void;
}) {
  const [form, setForm] = useState({
    status: order?.status ?? "in_transit",
    awbNumber: order?.awbNumber ?? "",
    airline: order?.airline ?? "",
    flightNumber: order?.flightNumber ?? "",
    etd: order?.etd ?? "",
    eta: order?.eta ?? "",
    trackingNotes: order?.trackingNotes ?? "",
  });
  const [saving, setSaving] = useState(false);
  const set = (k: string, v: string) => setForm(f => ({ ...f, [k]: v }));

  const handleSave = async () => {
    setSaving(true);
    try {
      const r = await fetch(`/api/air-freight/orders/${orderId}/tracking`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(form),
      });
      if (!r.ok) throw new Error(await r.text());
      toast({ title: "Tracking diperbarui" });
      onSaved();
    } catch (e: any) {
      toast({ title: "Gagal", description: e.message, variant: "destructive" });
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Update Tracking</DialogTitle>
        </DialogHeader>
        <div className="space-y-3">
          <div>
            <Label>Status</Label>
            <Select value={form.status} onValueChange={(v) => set("status", v)}>
              <SelectTrigger className="mt-1">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {Object.entries(STATUS_LABELS).map(([k, v]) => (
                  <SelectItem key={k} value={k}>{v}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div>
            <Label>AWB Number</Label>
            <Input value={form.awbNumber} onChange={(e) => set("awbNumber", e.target.value)} className="mt-1" />
          </div>
          <div className="grid grid-cols-2 gap-2">
            <div>
              <Label className="text-xs">Airline</Label>
              <Input value={form.airline} onChange={(e) => set("airline", e.target.value)} className="mt-1 h-8 text-sm" />
            </div>
            <div>
              <Label className="text-xs">Flight No.</Label>
              <Input value={form.flightNumber} onChange={(e) => set("flightNumber", e.target.value)} className="mt-1 h-8 text-sm" />
            </div>
            <div>
              <Label className="text-xs">ETD</Label>
              <Input value={form.etd} onChange={(e) => set("etd", e.target.value)} className="mt-1 h-8 text-sm" />
            </div>
            <div>
              <Label className="text-xs">ETA</Label>
              <Input value={form.eta} onChange={(e) => set("eta", e.target.value)} className="mt-1 h-8 text-sm" />
            </div>
          </div>
          <div>
            <Label>Catatan Tracking</Label>
            <Textarea value={form.trackingNotes} onChange={(e) => set("trackingNotes", e.target.value)} className="mt-1" rows={3} />
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>Batal</Button>
          <Button onClick={handleSave} disabled={saving}>
            {saving ? "Menyimpan..." : "Update"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ── Confirm Booking Dialog ────────────────────────────────────────────────────
function ConfirmBookingDialog({ orderId, open, onClose, onConfirmed }: {
  orderId: number; open: boolean; onClose: () => void; onConfirmed: () => void;
}) {
  const [awbNumber, setAwbNumber] = useState("");
  const [saving, setSaving] = useState(false);

  const handleConfirm = async () => {
    setSaving(true);
    try {
      const r = await fetch(`/api/air-freight/orders/${orderId}/confirm-booking`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ awbNumber }),
      });
      if (!r.ok) throw new Error(await r.text());
      toast({ title: "Booking dikonfirmasi" });
      onConfirmed();
    } catch (e: any) {
      toast({ title: "Gagal", description: e.message, variant: "destructive" });
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="max-w-sm">
        <DialogHeader><DialogTitle>Konfirmasi Booking</DialogTitle></DialogHeader>
        <div>
          <Label>AWB Number (opsional)</Label>
          <Input value={awbNumber} onChange={(e) => setAwbNumber(e.target.value)} className="mt-1" placeholder="e.g. 126-12345678" />
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>Batal</Button>
          <Button onClick={handleConfirm} disabled={saving}>
            <CheckCircle className="h-4 w-4 mr-1" />
            {saving ? "Memproses..." : "Konfirmasi Booking"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ── Main Detail Page ──────────────────────────────────────────────────────────
export default function AirFreightOrderDetailPage() {
  const [, params] = useRoute("/logistics/air-freight/:id");
  const orderId = parseInt(params?.id ?? "0");
  const [, navigate] = useLocation();

  const [showBlast, setShowBlast] = useState(false);
  const [showManualRate, setShowManualRate] = useState(false);
  const [showTracking, setShowTracking] = useState(false);
  const [showConfirmBooking, setShowConfirmBooking] = useState(false);
  const [selectingSubmission, setSelectingSubmission] = useState<number | null>(null);
  const [markupInput, setMarkupInput] = useState("0");
  const [ppnInput, setPpnInput] = useState("11");

  const qc = useQueryClient();
  const refetchAll = () => qc.invalidateQueries({ queryKey: ["air-freight-order", orderId] });

  const { data, isLoading } = useQuery({
    queryKey: ["air-freight-order", orderId],
    queryFn: async () => {
      const r = await fetch(`/api/air-freight/orders/${orderId}`);
      if (!r.ok) throw new Error(await r.text());
      return r.json() as Promise<{
        order: any; dimensions: any[]; rfqs: any[]; submissions: any[]; approvedVendorName: string | null;
      }>;
    },
    enabled: !!orderId,
  });

  const handleSendQuote = async () => {
    try {
      const r = await fetch(`/api/air-freight/orders/${orderId}/send-quote`, { method: "POST", headers: { "Content-Type": "application/json" } });
      if (!r.ok) throw new Error(await r.text());
      toast({ title: "Quote terkirim ke customer" });
      refetchAll();
    } catch (e: any) {
      toast({ title: "Gagal", description: e.message, variant: "destructive" });
    }
  };

  const handleSelectSubmission = async (submissionId: number) => {
    try {
      const r = await fetch(`/api/air-freight/orders/${orderId}/select-submission/${submissionId}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ markupAmount: markupInput, ppnPct: ppnInput }),
      });
      if (!r.ok) throw new Error(await r.text());
      toast({ title: "Submission dipilih sebagai final rate" });
      setSelectingSubmission(null);
      refetchAll();
    } catch (e: any) {
      toast({ title: "Gagal", description: e.message, variant: "destructive" });
    }
  };

  if (isLoading) {
    return <LoadingSkeleton variant="detail" />;
  }

  if (!data) return <div className="p-6 text-slate-500">Order tidak ditemukan.</div>;

  const { order, dimensions, rfqs, submissions, approvedVendorName } = data;
  const submittedSubs = submissions.filter((s: any) => s.status === "submitted" || s.status === "selected");

  return (
    <div className="p-6 space-y-6 max-w-6xl mx-auto">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <Link href="/logistics/air-freight">
            <Button variant="ghost" size="sm"><ArrowLeft className="h-4 w-4 mr-1" /> Kembali</Button>
          </Link>
          <Separator orientation="vertical" className="h-5" />
          <div className="flex items-center gap-2">
            <PlaneTakeoff className="h-5 w-5 text-sky-500" />
            <span className="font-mono font-semibold text-slate-800">{order.orderNumber}</span>
            <span className={`inline-flex rounded-full px-2 py-0.5 text-xs font-medium ${STATUS_COLORS[order.status] ?? "bg-slate-100 text-slate-700"}`}>
              {STATUS_LABELS[order.status] ?? order.status}
            </span>
          </div>
        </div>

        {/* Action buttons */}
        <div className="flex flex-wrap gap-2">
          {!["booking_confirmed", "in_transit", "arrived", "completed", "cancelled"].includes(order.status) && (
            <Button size="sm" variant="outline" onClick={() => setShowBlast(true)}>
              <Zap className="h-4 w-4 mr-1 text-yellow-500" /> Blast RFQ
            </Button>
          )}
          {!["booking_confirmed", "in_transit", "arrived", "completed", "cancelled"].includes(order.status) && (
            <Button size="sm" variant="outline" onClick={() => setShowManualRate(true)}>
              <DollarSign className="h-4 w-4 mr-1" /> Manual Rate
            </Button>
          )}
          {["quote_ready"].includes(order.status) && (
            <Button size="sm" variant="outline" onClick={handleSendQuote}>
              <Send className="h-4 w-4 mr-1" /> Kirim Quote
            </Button>
          )}
          {["quote_sent", "quote_ready"].includes(order.status) && (
            <Button size="sm" onClick={() => setShowConfirmBooking(true)}>
              <CheckCircle className="h-4 w-4 mr-1" /> Konfirmasi Booking
            </Button>
          )}
          <Button size="sm" variant="outline" onClick={() => setShowTracking(true)}>
            <Truck className="h-4 w-4 mr-1" /> Update Tracking
          </Button>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Left column */}
        <div className="lg:col-span-2 space-y-6">
          {/* Customer Info */}
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm text-slate-500 font-medium uppercase tracking-wide">Informasi Customer</CardTitle>
            </CardHeader>
            <CardContent>
              <FieldRow label="Nama" value={order.customerName} />
              <FieldRow label="Perusahaan" value={order.customerCompany} />
              <FieldRow label="Email" value={order.customerEmail} />
              <FieldRow label="No. Telepon" value={order.customerPhone} />
            </CardContent>
          </Card>

          {/* Route & Schedule */}
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm text-slate-500 font-medium uppercase tracking-wide">Rute & Jadwal</CardTitle>
            </CardHeader>
            <CardContent>
              <FieldRow label="Origin Airport" value={<span className="font-semibold text-sky-700">{order.originAirport}</span>} />
              <FieldRow label="Dest Airport" value={<span className="font-semibold text-sky-700">{order.destAirport}</span>} />
              <FieldRow label="Trade Type" value={order.tradeType} />
              <FieldRow label="Incoterm" value={order.incoterm} />
              <FieldRow label="ETD Requested" value={order.etdRequested} />
              {order.airline && <FieldRow label="Airline" value={order.airline} />}
              {order.flightNumber && <FieldRow label="Flight No." value={order.flightNumber} />}
              {order.etd && <FieldRow label="ETD Confirmed" value={order.etd} />}
              {order.eta && <FieldRow label="ETA Confirmed" value={order.eta} />}
              {order.transitDays && <FieldRow label="Transit Days" value={`${order.transitDays} hari`} />}
              {order.awbNumber && <FieldRow label="AWB Number" value={<span className="font-mono font-semibold">{order.awbNumber}</span>} />}
            </CardContent>
          </Card>

          {/* Cargo */}
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm text-slate-500 font-medium uppercase tracking-wide">Detail Kargo</CardTitle>
            </CardHeader>
            <CardContent>
              <FieldRow label="Cargo Type" value={order.cargoType} />
              <FieldRow label="Komoditi" value={order.commodity} />
              <FieldRow label="Packing" value={order.packingType} />
              <FieldRow label="Jumlah Koli" value={order.pieces ? `${order.pieces} pcs` : null} />
              <FieldRow label="Gross Weight" value={order.grossWeight ? `${N(order.grossWeight).toLocaleString("id-ID")} kg` : null} />
              <FieldRow label="Volumetric Weight" value={order.volumetricWeight ? `${N(order.volumetricWeight).toLocaleString("id-ID")} kg` : null} />
              <FieldRow label="Chargeable Weight" value={order.chargeableWeight
                ? <span className="font-semibold text-orange-700">{N(order.chargeableWeight).toLocaleString("id-ID")} kg</span>
                : null} />
              <FieldRow label="Volume CBM" value={order.volumeCbm ? `${N(order.volumeCbm).toLocaleString("id-ID")} CBM` : null} />
              {(order.additionalServices ?? []).length > 0 && (
                <FieldRow label="Layanan Tambahan" value={(order.additionalServices ?? []).join(", ")} />
              )}
              {order.specialInstructions && (
                <FieldRow label="Instruksi Khusus" value={order.specialInstructions} />
              )}
            </CardContent>
          </Card>

          {/* Dimensions */}
          {dimensions.length > 0 && (
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-sm text-slate-500 font-medium uppercase tracking-wide">Dimensi Kargo</CardTitle>
              </CardHeader>
              <CardContent className="p-0">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>#</TableHead>
                      <TableHead>P × L × T (cm)</TableHead>
                      <TableHead>Koli</TableHead>
                      <TableHead>Gross (kg)</TableHead>
                      <TableHead>Volumetric (kg)</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {dimensions.map((d: any, i: number) => (
                      <TableRow key={d.id}>
                        <TableCell className="text-slate-500">{i + 1}</TableCell>
                        <TableCell className="font-mono">{d.length} × {d.width} × {d.height}</TableCell>
                        <TableCell>{d.pieces}</TableCell>
                        <TableCell>{d.grossWeight ? `${N(d.grossWeight)} kg` : "-"}</TableCell>
                        <TableCell>{d.volumetricWeight ? `${N(d.volumetricWeight).toFixed(2)} kg` : "-"}</TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </CardContent>
            </Card>
          )}

          {/* Rate Submissions from vendors */}
          {submittedSubs.length > 0 && (
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-sm text-slate-500 font-medium uppercase tracking-wide flex items-center gap-2">
                  Penawaran Vendor ({submittedSubs.length})
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-3">
                {selectingSubmission !== null && (
                  <div className="flex items-center gap-2 p-3 rounded-lg bg-yellow-50 border border-yellow-200 text-sm">
                    <div className="flex-1">
                      <Label className="text-xs">Markup Amount (IDR)</Label>
                      <Input value={markupInput} onChange={(e) => setMarkupInput(e.target.value)} type="number" className="mt-1 h-7 text-xs w-32" />
                    </div>
                    <div className="flex-1">
                      <Label className="text-xs">PPN (%)</Label>
                      <Input value={ppnInput} onChange={(e) => setPpnInput(e.target.value)} type="number" className="mt-1 h-7 text-xs w-20" />
                    </div>
                    <Button size="sm" className="mt-4" onClick={() => handleSelectSubmission(selectingSubmission)}>
                      <Star className="h-3.5 w-3.5 mr-1" /> Konfirmasi Pilih
                    </Button>
                    <Button size="sm" variant="ghost" className="mt-4" onClick={() => setSelectingSubmission(null)}>Batal</Button>
                  </div>
                )}
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Vendor</TableHead>
                      <TableHead>Airline</TableHead>
                      <TableHead>ETD</TableHead>
                      <TableHead className="text-right">Rate/kg</TableHead>
                      <TableHead className="text-right">Total (IDR)</TableHead>
                      <TableHead>Valid s/d</TableHead>
                      <TableHead />
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {submittedSubs.map((s: any) => (
                      <TableRow key={s.id} className={s.status === "selected" ? "bg-green-50" : ""}>
                        <TableCell className="text-sm font-medium">{s.vendorDisplayName ?? s.vendorName}</TableCell>
                        <TableCell className="text-sm">{s.airline ?? "-"}</TableCell>
                        <TableCell className="text-sm">{s.etd ?? "-"}</TableCell>
                        <TableCell className="text-right text-sm font-mono">{IDR(s.ratePerKg)}</TableCell>
                        <TableCell className="text-right text-sm font-semibold">{IDR(s.totalIDR)}</TableCell>
                        <TableCell className="text-sm">{s.validityDate ?? "-"}</TableCell>
                        <TableCell>
                          {s.status === "selected" ? (
                            <span className="text-xs font-medium text-green-700 flex items-center gap-1">
                              <Star className="h-3 w-3 fill-green-500 text-green-500" /> Dipilih
                            </span>
                          ) : s.status !== "rejected" ? (
                            <Button size="sm" variant="outline" onClick={() => setSelectingSubmission(s.id)}>
                              Pilih
                            </Button>
                          ) : (
                            <span className="text-xs text-slate-400">Ditolak</span>
                          )}
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </CardContent>
            </Card>
          )}

          {/* Notes */}
          {order.notes && (
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-sm text-slate-500 font-medium uppercase tracking-wide">Catatan</CardTitle>
              </CardHeader>
              <CardContent>
                <p className="text-sm text-slate-700 whitespace-pre-line">{order.notes}</p>
              </CardContent>
            </Card>
          )}
        </div>

        {/* Right column */}
        <div className="space-y-6">
          {/* Pricing Breakdown */}
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm text-slate-500 font-medium uppercase tracking-wide">Pricing Breakdown</CardTitle>
            </CardHeader>
            <CardContent className="space-y-1.5">
              {order.finalRatePerKg && (
                <div className="flex justify-between text-sm">
                  <span className="text-slate-500">Rate/kg × {N(order.chargeableWeight)} kg</span>
                  <span className="font-mono">{IDR(N(order.finalRatePerKg) * N(order.chargeableWeight))}</span>
                </div>
              )}
              {N(order.fuelSurcharge) > 0 && <div className="flex justify-between text-sm"><span className="text-slate-500">Fuel Surcharge</span><span>{IDR(order.fuelSurcharge)}</span></div>}
              {N(order.securitySurcharge) > 0 && <div className="flex justify-between text-sm"><span className="text-slate-500">Security Surcharge</span><span>{IDR(order.securitySurcharge)}</span></div>}
              {N(order.awbFee) > 0 && <div className="flex justify-between text-sm"><span className="text-slate-500">AWB Fee</span><span>{IDR(order.awbFee)}</span></div>}
              {N(order.handlingFee) > 0 && <div className="flex justify-between text-sm"><span className="text-slate-500">Handling Fee</span><span>{IDR(order.handlingFee)}</span></div>}
              {N(order.xrayFee) > 0 && <div className="flex justify-between text-sm"><span className="text-slate-500">X-Ray Fee</span><span>{IDR(order.xrayFee)}</span></div>}
              {N(order.docFee) > 0 && <div className="flex justify-between text-sm"><span className="text-slate-500">Doc Fee</span><span>{IDR(order.docFee)}</span></div>}
              {N(order.customsClearanceFee) > 0 && <div className="flex justify-between text-sm"><span className="text-slate-500">Customs Clearance</span><span>{IDR(order.customsClearanceFee)}</span></div>}
              {N(order.pickupTrucking) > 0 && <div className="flex justify-between text-sm"><span className="text-slate-500">Pickup Trucking</span><span>{IDR(order.pickupTrucking)}</span></div>}
              {N(order.deliveryTrucking) > 0 && <div className="flex justify-between text-sm"><span className="text-slate-500">Delivery Trucking</span><span>{IDR(order.deliveryTrucking)}</span></div>}
              {N(order.cargoSurcharge) > 0 && <div className="flex justify-between text-sm"><span className="text-slate-500">Cargo Surcharge</span><span>{IDR(order.cargoSurcharge)}</span></div>}
              {N(order.markupAmount) > 0 && <div className="flex justify-between text-sm"><span className="text-slate-500">Markup</span><span>{IDR(order.markupAmount)}</span></div>}
              <Separator />
              <div className="flex justify-between text-sm font-medium">
                <span>Subtotal</span>
                <span>{IDR(order.subtotal)}</span>
              </div>
              <div className="flex justify-between text-sm">
                <span className="text-slate-500">PPN {N(order.ppnPct)}%</span>
                <span>{IDR(order.ppnAmount)}</span>
              </div>
              <div className="flex justify-between text-base font-bold pt-1">
                <span>Grand Total</span>
                <span className="text-green-700">{IDR(order.grandTotal)}</span>
              </div>
              {order.estimatedPrice && N(order.grandTotal) === 0 && (
                <div className="flex justify-between text-sm mt-2">
                  <span className="text-slate-500">Est. Harga</span>
                  <span className="font-medium text-yellow-700">{IDR(order.estimatedPrice)}</span>
                </div>
              )}
            </CardContent>
          </Card>

          {/* RFQ Status */}
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm text-slate-500 font-medium uppercase tracking-wide">RFQ History</CardTitle>
            </CardHeader>
            <CardContent className="space-y-2">
              {rfqs.length === 0 ? (
                <p className="text-sm text-slate-400">Belum ada RFQ dikirim</p>
              ) : (
                rfqs.map((r: any) => (
                  <div key={r.id} className="rounded-lg border border-slate-200 p-3">
                    <div className="flex items-center justify-between">
                      <span className="text-sm font-mono font-semibold">{r.rfqNumber}</span>
                      <span className={`text-xs px-1.5 py-0.5 rounded-full font-medium ${r.status === "open" ? "bg-blue-100 text-blue-700" : "bg-slate-100 text-slate-600"}`}>
                        {r.status}
                      </span>
                    </div>
                    <div className="text-xs text-slate-500 mt-1">
                      {r.blastCount ?? 0} vendor · Deadline: {r.responseDeadline ? new Date(r.responseDeadline).toLocaleDateString("id-ID") : "-"}
                    </div>
                    <div className="text-xs text-slate-400 mt-0.5">
                      {new Date(r.createdAt).toLocaleString("id-ID")}
                    </div>
                  </div>
                ))
              )}
            </CardContent>
          </Card>

          {/* Vendor */}
          {approvedVendorName && (
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-sm text-slate-500 font-medium uppercase tracking-wide">Vendor Dipilih</CardTitle>
              </CardHeader>
              <CardContent>
                <p className="text-sm font-semibold text-slate-800">{approvedVendorName}</p>
              </CardContent>
            </Card>
          )}

          {/* Tracking Notes */}
          {order.trackingNotes && (
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-sm text-slate-500 font-medium uppercase tracking-wide">Tracking Notes</CardTitle>
              </CardHeader>
              <CardContent>
                <p className="text-sm text-slate-700 whitespace-pre-line">{order.trackingNotes}</p>
              </CardContent>
            </Card>
          )}

          <FreightDocVerifyPanel
            shipmentRef={order.awbNumber ?? order.orderNumber}
            defaultSlots={[{ label: "MAWB" }, { label: "Invoice" }]}
          />
        </div>
      </div>

      {/* Dialogs */}
      {showBlast && (
        <BlastRfqDialog
          orderId={orderId}
          open={showBlast}
          onClose={() => setShowBlast(false)}
          onBlasted={() => { setShowBlast(false); refetchAll(); }}
        />
      )}
      {showManualRate && (
        <ManualRateDialog
          orderId={orderId}
          order={order}
          open={showManualRate}
          onClose={() => setShowManualRate(false)}
          onSaved={() => { setShowManualRate(false); refetchAll(); }}
        />
      )}
      {showTracking && (
        <TrackingDialog
          orderId={orderId}
          order={order}
          open={showTracking}
          onClose={() => setShowTracking(false)}
          onSaved={() => { setShowTracking(false); refetchAll(); }}
        />
      )}
      {showConfirmBooking && (
        <ConfirmBookingDialog
          orderId={orderId}
          open={showConfirmBooking}
          onClose={() => setShowConfirmBooking(false)}
          onConfirmed={() => { setShowConfirmBooking(false); refetchAll(); }}
        />
      )}
    </div>
  );
}
