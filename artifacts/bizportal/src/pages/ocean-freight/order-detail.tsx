import { DatePicker } from "@/components/ui/date-picker";
import { useState } from "react";
import { useRoute, useLocation } from "wouter";
import { AppShell } from "@/components/layout/AppShell";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Textarea } from "@/components/ui/textarea";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import {
  Ship, ArrowLeft, RefreshCw, Send, Check, ExternalLink, Copy,
  Anchor, MapPin, Package, User, DollarSign, ChevronDown, ChevronRight,
  Users,
} from "lucide-react";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { useToast } from "@/hooks/use-toast";
import { FreightCustomsPanel } from "@/components/freight/FreightCustomsPanel";

const STATUS_LABEL: Record<string, string> = {
  draft:"Draft", estimated:"Estimasi", waiting_rate:"Menunggu Rate",
  rate_requested:"Rate Diminta", rate_received:"Rate Diterima",
  quoted:"Quoted", approved:"Disetujui", booked:"Booked",
  sailed:"Berlayar", arrived:"Tiba", completed:"Selesai",
  cancelled:"Dibatalkan", quote_declined:"Penawaran Ditolak",
};
const STATUS_COLOR: Record<string, string> = {
  draft:"bg-gray-800 text-gray-300", estimated:"bg-blue-900 text-blue-300",
  waiting_rate:"bg-yellow-900 text-yellow-300", rate_requested:"bg-orange-900 text-orange-300",
  rate_received:"bg-purple-900 text-purple-300", quoted:"bg-cyan-900 text-cyan-300",
  approved:"bg-teal-900 text-teal-300", booked:"bg-emerald-900 text-emerald-300",
  sailed:"bg-sky-900 text-sky-300", arrived:"bg-indigo-900 text-indigo-300",
  completed:"bg-green-900 text-green-400", cancelled:"bg-red-900 text-red-300",
  quote_declined:"bg-rose-900 text-rose-300",
};

const TRACKING_OPTS = [
  { v:"booked", l:"Booked" }, { v:"container_empty_released", l:"Container Empty Released" },
  { v:"stuffed", l:"Stuffed" }, { v:"gate_in", l:"Gate In" }, { v:"sailed", l:"Sailed" },
  { v:"transshipment", l:"Transshipment" }, { v:"arrived", l:"Arrived" },
  { v:"customs_clearance", l:"Customs Clearance" }, { v:"delivered", l:"Delivered" },
  { v:"completed", l:"Completed" },
];

const idr = (n: any) =>
  n == null ? "-" : new Intl.NumberFormat("id-ID", { style: "currency", currency: "IDR", maximumFractionDigits: 0 }).format(Number(n));
const num = (n: any) =>
  n == null ? "-" : new Intl.NumberFormat("id-ID", { maximumFractionDigits: 2 }).format(Number(n));
const fmtDate = (d: any) => {
  if (!d) return "-";
  try { return new Intl.DateTimeFormat("id-ID", { day:"2-digit", month:"short", year:"numeric" }).format(new Date(d)); }
  catch { return d; }
};

function Section({ title, icon: Icon, defaultOpen = true, children }: any) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <Card className="bg-gray-900 border-gray-700">
      <CardHeader className="pb-2 cursor-pointer" onClick={() => setOpen(!open)}>
        <CardTitle className="text-sm font-medium text-gray-200 flex items-center gap-2">
          <Icon className="h-4 w-4 text-blue-400" />
          {title}
          <span className="ml-auto text-gray-500">{open ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}</span>
        </CardTitle>
      </CardHeader>
      {open && <CardContent className="pt-0">{children}</CardContent>}
    </Card>
  );
}

export default function OceanFreightOrderDetailPage() {
  const [, navigate] = useLocation();
  const [match, params] = useRoute("/ocean-freight/orders/:id");
  const id = params?.id ? Number(params.id) : 0;
  const qc = useQueryClient();
  const { toast } = useToast();

  // RFQ blast state
  const [selectedVendors, setSelectedVendors] = useState<number[]>([]);
  const [blastNotes,  setBlastNotes]  = useState("");
  const [blastHours,  setBlastHours]  = useState(48);

  // Final quote state
  const [selectedSubId,  setSelectedSubId]  = useState<number | null>(null);
  const [finalPrice,     setFinalPrice]     = useState("");
  const [finalCurrency,  setFinalCurrency]  = useState("USD");
  const [finalExRate,    setFinalExRate]     = useState(16500);
  const [markupAmount,   setMarkupAmount]   = useState(0);
  const [ppnPct,         setPpnPct]         = useState(0);
  const [quoteNotes,     setQuoteNotes]     = useState("");
  const [quoteCarrier,   setQuoteCarrier]   = useState("");
  const [quoteVessel,    setQuoteVessel]    = useState("");
  const [quoteVoyage,    setQuoteVoyage]    = useState("");
  const [quoteEtd,       setQuoteEtd]       = useState("");
  const [quoteEta,       setQuoteEta]       = useState("");

  // Booking state
  const [bkgNumber,      setBkgNumber]      = useState("");
  const [bkgCarrier,     setBkgCarrier]     = useState("");
  const [bkgVessel,      setBkgVessel]      = useState("");
  const [bkgVoyage,      setBkgVoyage]      = useState("");
  const [bkgEtd,         setBkgEtd]         = useState("");
  const [bkgEta,         setBkgEta]         = useState("");
  const [bkgContainer,   setBkgContainer]   = useState("");
  const [bkgSeal,        setBkgSeal]        = useState("");
  const [bkgBl,          setBkgBl]          = useState("");

  // Tracking state
  const [trackStatus,    setTrackStatus]    = useState("");
  const [trackNotes,     setTrackNotes]     = useState("");

  const { data, isLoading, refetch } = useQuery({
    queryKey: ["ocean-freight-order", id],
    queryFn: async () => {
      const r = await fetch(`/api/ocean-freight/orders/${id}`, { credentials: "include" });
      if (!r.ok) throw new Error("Gagal memuat order");
      return r.json();
    },
    enabled: !!id,
    onSuccess: (d: any) => {
      const o = d.order;
      if (o.carrier)     { setQuoteCarrier(o.carrier); setBkgCarrier(o.carrier); }
      if (o.vessel_name) { setQuoteVessel(o.vessel_name); setBkgVessel(o.vessel_name); }
      if (o.voyage)      { setQuoteVoyage(o.voyage); setBkgVoyage(o.voyage); }
      if (o.etd)         { setQuoteEtd(o.etd); setBkgEtd(o.etd); }
      if (o.eta)         { setQuoteEta(o.eta); setBkgEta(o.eta); }
      if (o.grand_total) setFinalPrice(String(o.grand_total));
      if (o.currency)    setFinalCurrency(o.currency);
      if (o.markup_amount) setMarkupAmount(Number(o.markup_amount));
      if (o.ppn_pct)     setPpnPct(Number(o.ppn_pct));
      if (o.admin_notes) setQuoteNotes(o.admin_notes);
      if (o.tracking_status) setTrackStatus(o.tracking_status);
      if (o.booking_number) setBkgNumber(o.booking_number);
    },
  } as any);

  const { data: vendorsData } = useQuery({
    queryKey: ["ocean-freight-vendors"],
    queryFn: async () => {
      const r = await fetch(`/api/ocean-freight/orders/${id}/vendors`, { credentials: "include" });
      if (!r.ok) return { data: [] };
      return r.json();
    },
    enabled: !!id,
  });

  function mutOpts(msg: string) {
    return {
      onSuccess: () => { toast({ title: msg }); refetch(); qc.invalidateQueries({ queryKey: ["ocean-freight-orders"] }); },
      onError: (e: any) => toast({ title: "Error", description: e.message, variant: "destructive" }),
    };
  }

  const blastMut = useMutation({
    mutationFn: async () => {
      const r = await fetch(`/api/ocean-freight/orders/${id}/rfq-blast`, {
        method: "POST", credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ vendor_ids: selectedVendors, blast_notes: blastNotes, expires_hours: blastHours }),
      });
      const d = await r.json();
      if (!r.ok) throw new Error(d.error);
      return d;
    },
    ...mutOpts("RFQ berhasil dikirim!"),
  });

  const finalQuoteMut = useMutation({
    mutationFn: async () => {
      const r = await fetch(`/api/ocean-freight/orders/${id}/final-quote`, {
        method: "POST", credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          submission_id: selectedSubId, final_price: Number(finalPrice),
          currency: finalCurrency, exchange_rate: finalExRate,
          markup_amount: markupAmount, ppn_pct: ppnPct,
          admin_notes: quoteNotes, carrier: quoteCarrier,
          vessel_name: quoteVessel, voyage: quoteVoyage,
          etd: quoteEtd, eta: quoteEta,
        }),
      });
      const d = await r.json();
      if (!r.ok) throw new Error(d.error);
      return d;
    },
    ...mutOpts("Final quote tersimpan!"),
  });

  const sendQuoteMut = useMutation({
    mutationFn: async () => {
      const r = await fetch(`/api/ocean-freight/orders/${id}/send-quote`, {
        method: "POST", credentials: "include", headers: { "Content-Type": "application/json" }, body: "{}",
      });
      const d = await r.json();
      if (!r.ok) throw new Error(d.error);
      return d;
    },
    ...mutOpts("Quote dikirim ke customer!"),
  });

  const bookingMut = useMutation({
    mutationFn: async () => {
      const r = await fetch(`/api/ocean-freight/orders/${id}/confirm-booking`, {
        method: "POST", credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ booking_number: bkgNumber, carrier: bkgCarrier, vessel_name: bkgVessel, voyage: bkgVoyage, etd: bkgEtd, eta: bkgEta, container_number: bkgContainer, seal_number: bkgSeal, bl_number: bkgBl }),
      });
      const d = await r.json();
      if (!r.ok) throw new Error(d.error);
      return d;
    },
    ...mutOpts("Booking dikonfirmasi!"),
  });

  const trackingMut = useMutation({
    mutationFn: async () => {
      const r = await fetch(`/api/ocean-freight/orders/${id}/tracking`, {
        method: "PUT", credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ tracking_status: trackStatus, tracking_notes: trackNotes }),
      });
      const d = await r.json();
      if (!r.ok) throw new Error(d.error);
      return d;
    },
    ...mutOpts("Tracking status diperbarui!"),
  });

  if (isLoading) return <AppShell><div className="p-6 text-gray-400">Memuat...</div></AppShell>;

  const order       = (data as any)?.order;
  const rfqs        = (data as any)?.rfqs ?? [];
  const submissions = (data as any)?.submissions ?? [];
  const vendors     = vendorsData?.data ?? [];

  if (!order) return <AppShell><div className="p-6 text-red-400">Order tidak ditemukan</div></AppShell>;

  // Compute quoted amounts live
  const base      = Number(finalPrice || 0);
  const markup    = Number(markupAmount || 0);
  const subtotal  = base + markup;
  const ppnAmt    = subtotal * (ppnPct / 100);
  const grandTotal = subtotal + ppnAmt;

  function fillFromSubmission(sub: any) {
    setSelectedSubId(sub.id);
    setFinalPrice(String(sub.total_amount ?? 0));
    setFinalCurrency(sub.currency ?? "USD");
    setFinalExRate(Number(sub.exchange_rate_to_idr ?? 16500));
    if (sub.carrier)      setQuoteCarrier(sub.carrier);
    if (sub.vessel_name)  setQuoteVessel(sub.vessel_name);
    if (sub.voyage)       setQuoteVoyage(sub.voyage);
    if (sub.etd)          setQuoteEtd(sub.etd);
    if (sub.eta)          setQuoteEta(sub.eta);
  }

  return (
    <AppShell>
      <div className="p-6 space-y-4 max-w-5xl">
        {/* Header */}
        <div className="flex items-center gap-3">
          <Button variant="ghost" size="icon" className="text-gray-400 hover:text-white" onClick={() => navigate("/ocean-freight/orders")}>
            <ArrowLeft className="h-5 w-5" />
          </Button>
          <Ship className="h-6 w-6 text-blue-400" />
          <div className="flex-1">
            <div className="flex items-center gap-3">
              <h1 className="text-xl font-semibold text-white">{order.order_number}</h1>
              <Badge className={`text-xs ${STATUS_COLOR[order.status] ?? "bg-gray-800 text-gray-300"}`}>
                {STATUS_LABEL[order.status] ?? order.status}
              </Badge>
            </div>
            <p className="text-sm text-gray-400">{order.origin_port} → {order.destination_port} · {order.shipment_type}{order.container_type ? ` / ${order.container_type}` : ""}</p>
          </div>
          <Button variant="outline" size="sm" className="border-gray-600 text-gray-300" onClick={() => refetch()}>
            <RefreshCw className="h-4 w-4" />
          </Button>
        </div>

        {/* Order Info */}
        <Section title="Informasi Order" icon={Package}>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4 text-sm">
            <div><p className="text-gray-500 text-xs">Customer</p><p className="text-white font-medium">{order.customer_name}</p>{order.customer_phone && <p className="text-gray-400 text-xs">{order.customer_phone}</p>}{order.customer_email && <p className="text-gray-400 text-xs">{order.customer_email}</p>}</div>
            <div><p className="text-gray-500 text-xs">Rute</p><p className="text-white">{order.origin_port}</p><p className="text-gray-400">→ {order.destination_port}</p></div>
            <div><p className="text-gray-500 text-xs">Jenis Pengiriman</p><p className="text-white">{order.shipment_type}</p>{order.container_type && <p className="text-gray-400">{order.container_type}{order.container_qty > 1 ? ` × ${order.container_qty}` : ""}</p>}{order.total_cbm && <p className="text-gray-400">{order.total_cbm} CBM</p>}</div>
            <div><p className="text-gray-500 text-xs">Komoditas</p><p className="text-white">{order.commodity || "-"}</p>{order.cargo_condition && order.cargo_condition !== "general" && <Badge variant="outline" className="text-xs mt-1">{order.cargo_condition}</Badge>}</div>
            <div><p className="text-gray-500 text-xs">Trade Type</p><p className="text-white capitalize">{order.trade_type}</p></div>
            <div><p className="text-gray-500 text-xs">Service Mode</p><p className="text-white">{order.service_mode?.replace(/_/g, " ")}</p></div>
            <div><p className="text-gray-500 text-xs">Incoterm</p><p className="text-white">{order.incoterm || "-"}</p></div>
            <div><p className="text-gray-500 text-xs">ETD Preferred</p><p className="text-white">{order.etd_preferred || "-"}</p></div>
            {order.estimated_price_idr && <div><p className="text-gray-500 text-xs">Est. Harga Customer</p><p className="text-blue-300">{idr(order.estimated_price_idr)}</p></div>}
            <div><p className="text-gray-500 text-xs">Dibuat</p><p className="text-white">{fmtDate(order.created_at)}</p></div>
          </div>
        </Section>

        {/* RFQ Blast */}
        <Section title={`Blast RFQ ke Vendor (${rfqs.length} dikirim)`} icon={Send} defaultOpen={["waiting_rate","rate_requested"].includes(order.status)}>
          {rfqs.length > 0 && (
            <div className="mb-4 space-y-1">
              {rfqs.map((r: any) => (
                <div key={r.id} className="flex items-center gap-3 p-2 rounded bg-gray-800/60 text-sm">
                  <span className="text-gray-300 font-mono text-xs">{r.rfq_number}</span>
                  <span className="text-gray-400">{r.contact_name || r.vendor_name_db || "Manual"}</span>
                  <Badge variant="outline" className={`text-xs ml-auto ${r.status === "submitted" ? "text-green-400 border-green-700" : r.status === "opened" ? "text-yellow-400 border-yellow-700" : "text-gray-400 border-gray-600"}`}>
                    {r.status}
                  </Badge>
                  <Button variant="ghost" size="icon" className="h-6 w-6 text-gray-400" onClick={() => { navigator.clipboard.writeText(`${window.location.origin}/ocean-freight/vendor-form/${r.rfq_token}`); toast({ title: "Link disalin!" }); }}>
                    <Copy className="h-3 w-3" />
                  </Button>
                </div>
              ))}
            </div>
          )}
          <div className="space-y-3 border-t border-gray-700 pt-3">
            <div>
              <Label className="text-gray-400 text-xs mb-2 block">Pilih Vendor (opsional — kosongkan untuk manual RFQ)</Label>
              <div className="max-h-40 overflow-y-auto space-y-1 bg-gray-800/50 rounded p-2">
                {vendors.length === 0 && <p className="text-gray-500 text-xs">Tidak ada vendor terdaftar</p>}
                {vendors.map((v: any) => (
                  <label key={v.id} className="flex items-center gap-2 cursor-pointer text-sm">
                    <input type="checkbox" checked={selectedVendors.includes(v.id)}
                      onChange={(e) => setSelectedVendors(prev => e.target.checked ? [...prev, v.id] : prev.filter(x => x !== v.id))}
                      className="accent-blue-500" />
                    <span className="text-gray-300">{v.name}</span>
                    {v.contact_phone && <span className="text-gray-500 text-xs">{v.contact_phone}</span>}
                  </label>
                ))}
              </div>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label className="text-gray-400 text-xs">Kadaluarsa (jam)</Label>
                <Input type="number" min="1" value={blastHours} onChange={(e) => setBlastHours(Number(e.target.value))} className="bg-gray-800 border-gray-600 text-white h-8" />
              </div>
              <div>
                <Label className="text-gray-400 text-xs">Catatan untuk vendor</Label>
                <Input value={blastNotes} onChange={(e) => setBlastNotes(e.target.value)} className="bg-gray-800 border-gray-600 text-white h-8" placeholder="Opsional" />
              </div>
            </div>
            <Button onClick={() => blastMut.mutate()} disabled={blastMut.isPending} className="bg-orange-600 hover:bg-orange-700 w-full">
              <Send className="h-4 w-4 mr-2" /> {blastMut.isPending ? "Mengirim..." : "Blast RFQ"}
            </Button>
          </div>
        </Section>

        {/* Rate Submissions */}
        {submissions.length > 0 && (
          <Section title={`Rate Submissions (${submissions.length} masuk)`} icon={DollarSign} defaultOpen={true}>
            <div className="overflow-x-auto">
              <table className="w-full text-xs">
                <thead>
                  <tr className="text-gray-400 border-b border-gray-700">
                    <th className="text-left p-2">Vendor / Carrier</th>
                    <th className="text-right p-2">Ocean Freight</th>
                    <th className="text-right p-2">THC O/D</th>
                    <th className="text-right p-2">Biaya Lain</th>
                    <th className="text-right p-2 font-bold text-white">Total IDR</th>
                    <th className="text-left p-2">ETD / ETA</th>
                    <th className="p-2"></th>
                  </tr>
                </thead>
                <tbody>
                  {submissions.map((s: any, i: number) => (
                    <tr key={s.id} className={`border-b border-gray-800 ${selectedSubId === s.id ? "bg-blue-900/30" : i === 0 ? "bg-green-900/10" : "hover:bg-gray-800/50"}`}>
                      <td className="p-2">
                        <div className="text-gray-200 font-medium">{s.rate_source_name || s.carrier || "-"}</div>
                        {s.carrier && s.carrier !== s.rate_source_name && <div className="text-gray-500">{s.carrier}</div>}
                        {s.rfq_number && <div className="text-gray-500 font-mono">{s.rfq_number}</div>}
                        <div className="text-gray-500">{s.currency} · {s.transit_days != null ? `${s.transit_days}d` : "-"} {s.direct_or_transshipment === "transshipment" ? "T/S" : ""}</div>
                      </td>
                      <td className="p-2 text-right text-gray-200">{s.currency} {num(s.ocean_freight_amount)}</td>
                      <td className="p-2 text-right text-gray-400">{num(s.thc_origin)} / {num(s.thc_destination)}</td>
                      <td className="p-2 text-right text-gray-400">{num(Number(s.doc_fee||0)+Number(s.bl_fee||0)+Number(s.handling_fee||0)+Number(s.surcharge_amount||0))}</td>
                      <td className="p-2 text-right text-green-300 font-bold">{idr(s.total_amount_idr)}</td>
                      <td className="p-2 text-gray-400">{s.etd || "-"}<br/>{s.eta || "-"}</td>
                      <td className="p-2">
                        <Button size="sm" variant={selectedSubId === s.id ? "default" : "outline"} className={`h-6 text-xs ${selectedSubId === s.id ? "bg-blue-600" : "border-gray-600 text-gray-300"}`} onClick={() => fillFromSubmission(s)}>
                          {selectedSubId === s.id ? <Check className="h-3 w-3" /> : "Pilih"}
                        </Button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Section>
        )}

        {/* Final Quote */}
        <Section title="Set Final Quote" icon={DollarSign} defaultOpen={["rate_received","rate_requested"].includes(order.status)}>
          <div className="space-y-3">
            <div className="grid grid-cols-2 md:grid-cols-4 gap-3 text-sm">
              <div>
                <Label className="text-gray-400 text-xs">Harga Dasar (dari vendor) *</Label>
                <Input type="number" value={finalPrice} onChange={(e) => setFinalPrice(e.target.value)} className="bg-gray-800 border-gray-600 text-white h-8" />
              </div>
              <div>
                <Label className="text-gray-400 text-xs">Currency</Label>
                <Select value={finalCurrency} onValueChange={setFinalCurrency}>
                  <SelectTrigger className="bg-gray-800 border-gray-600 text-white h-8"><SelectValue /></SelectTrigger>
                  <SelectContent className="bg-gray-800 border-gray-700">
                    <SelectItem value="USD">USD</SelectItem>
                    <SelectItem value="IDR">IDR</SelectItem>
                    <SelectItem value="SGD">SGD</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              {finalCurrency !== "IDR" && (
                <div>
                  <Label className="text-gray-400 text-xs">Kurs ke IDR</Label>
                  <Input type="number" value={finalExRate} onChange={(e) => setFinalExRate(Number(e.target.value))} className="bg-gray-800 border-gray-600 text-white h-8" />
                </div>
              )}
              <div>
                <Label className="text-gray-400 text-xs">Markup (IDR)</Label>
                <Input type="number" value={markupAmount} onChange={(e) => setMarkupAmount(Number(e.target.value))} className="bg-gray-800 border-gray-600 text-white h-8" />
              </div>
              <div>
                <Label className="text-gray-400 text-xs">PPN %</Label>
                <Input type="number" value={ppnPct} onChange={(e) => setPpnPct(Number(e.target.value))} className="bg-gray-800 border-gray-600 text-white h-8" />
              </div>
            </div>
            <div className="grid grid-cols-4 gap-3 text-sm">
              <div><Label className="text-gray-400 text-xs">Carrier</Label><Input value={quoteCarrier} onChange={(e) => setQuoteCarrier(e.target.value)} className="bg-gray-800 border-gray-600 text-white h-8" /></div>
              <div><Label className="text-gray-400 text-xs">Vessel</Label><Input value={quoteVessel} onChange={(e) => setQuoteVessel(e.target.value)} className="bg-gray-800 border-gray-600 text-white h-8" /></div>
              <div><Label className="text-gray-400 text-xs">Voyage</Label><Input value={quoteVoyage} onChange={(e) => setQuoteVoyage(e.target.value)} className="bg-gray-800 border-gray-600 text-white h-8" /></div>
              <div></div>
              <div><Label className="text-gray-400 text-xs">ETD</Label><DatePicker value={quoteEtd} onChange={(v) => setQuoteEtd(v)} className="bg-gray-800 border-gray-600 text-white h-8" /></div>
              <div><Label className="text-gray-400 text-xs">ETA</Label><DatePicker value={quoteEta} onChange={(v) => setQuoteEta(v)} className="bg-gray-800 border-gray-600 text-white h-8" /></div>
            </div>
            <div>
              <Label className="text-gray-400 text-xs">Catatan Internal</Label>
              <Textarea value={quoteNotes} onChange={(e) => setQuoteNotes(e.target.value)} className="bg-gray-800 border-gray-600 text-white text-sm h-16" />
            </div>
            {/* Summary */}
            <div className="bg-gray-800/60 rounded p-3 text-sm space-y-1">
              <div className="flex justify-between text-gray-300"><span>Harga Dasar</span><span>{idr(finalCurrency === "IDR" ? Number(finalPrice||0) : Number(finalPrice||0) * finalExRate)}</span></div>
              <div className="flex justify-between text-gray-300"><span>Markup</span><span>{idr(markup)}</span></div>
              <div className="flex justify-between text-gray-300"><span>Subtotal</span><span>{idr(subtotal * (finalCurrency === "IDR" ? 1 : finalExRate))}</span></div>
              <div className="flex justify-between text-gray-300"><span>PPN ({ppnPct}%)</span><span>{idr(subtotal * (finalCurrency === "IDR" ? 1 : finalExRate) * (ppnPct / 100))}</span></div>
              <div className="flex justify-between text-white font-bold text-base border-t border-gray-600 pt-1"><span>Grand Total</span><span className="text-green-400">{idr((subtotal * (finalCurrency === "IDR" ? 1 : finalExRate)) * (1 + ppnPct/100))}</span></div>
            </div>
            <div className="flex gap-3">
              <Button onClick={() => finalQuoteMut.mutate()} disabled={finalQuoteMut.isPending || !finalPrice} className="bg-blue-600 hover:bg-blue-700 flex-1">
                <Check className="h-4 w-4 mr-2" /> {finalQuoteMut.isPending ? "Menyimpan..." : "Simpan Final Quote"}
              </Button>
              {order.price_status === "confirmed" && (
                <Button onClick={() => sendQuoteMut.mutate()} disabled={sendQuoteMut.isPending} className="bg-teal-600 hover:bg-teal-700 flex-1">
                  <Send className="h-4 w-4 mr-2" /> {sendQuoteMut.isPending ? "Mengirim..." : "Kirim Quote ke Customer"}
                </Button>
              )}
            </div>
            {order.quote_token && (
              <div className="flex items-center gap-2 bg-gray-800/60 rounded p-2 text-xs">
                <span className="text-gray-400">Link Approval Customer:</span>
                <span className="text-blue-400 font-mono truncate">/ocean-freight/approval/{order.quote_token}</span>
                <Button variant="ghost" size="icon" className="h-5 w-5 text-gray-400 ml-auto" onClick={() => { navigator.clipboard.writeText(`${window.location.origin.replace(":6800", ":3001")}/ocean-freight/approval/${order.quote_token}`); toast({ title: "Link disalin!" }); }}>
                  <Copy className="h-3 w-3" />
                </Button>
              </div>
            )}
          </div>
        </Section>

        {/* Confirm Booking */}
        {["approved", "booked"].includes(order.status) && (
          <Section title="Konfirmasi Booking" icon={Anchor} defaultOpen={order.status === "approved"}>
            <div className="space-y-3 text-sm">
              <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                <div><Label className="text-gray-400 text-xs">Booking Number *</Label><Input value={bkgNumber} onChange={(e) => setBkgNumber(e.target.value)} className="bg-gray-800 border-gray-600 text-white h-8" /></div>
                <div><Label className="text-gray-400 text-xs">Carrier</Label><Input value={bkgCarrier} onChange={(e) => setBkgCarrier(e.target.value)} className="bg-gray-800 border-gray-600 text-white h-8" /></div>
                <div><Label className="text-gray-400 text-xs">Vessel</Label><Input value={bkgVessel} onChange={(e) => setBkgVessel(e.target.value)} className="bg-gray-800 border-gray-600 text-white h-8" /></div>
                <div><Label className="text-gray-400 text-xs">Voyage</Label><Input value={bkgVoyage} onChange={(e) => setBkgVoyage(e.target.value)} className="bg-gray-800 border-gray-600 text-white h-8" /></div>
                <div><Label className="text-gray-400 text-xs">ETD</Label><DatePicker value={bkgEtd} onChange={(v) => setBkgEtd(v)} className="bg-gray-800 border-gray-600 text-white h-8" /></div>
                <div><Label className="text-gray-400 text-xs">ETA</Label><DatePicker value={bkgEta} onChange={(v) => setBkgEta(v)} className="bg-gray-800 border-gray-600 text-white h-8" /></div>
                <div><Label className="text-gray-400 text-xs">Container No.</Label><Input value={bkgContainer} onChange={(e) => setBkgContainer(e.target.value)} className="bg-gray-800 border-gray-600 text-white h-8" /></div>
                <div><Label className="text-gray-400 text-xs">Seal No.</Label><Input value={bkgSeal} onChange={(e) => setBkgSeal(e.target.value)} className="bg-gray-800 border-gray-600 text-white h-8" /></div>
                <div className="col-span-2"><Label className="text-gray-400 text-xs">B/L Number</Label><Input value={bkgBl} onChange={(e) => setBkgBl(e.target.value)} className="bg-gray-800 border-gray-600 text-white h-8" /></div>
              </div>
              <Button onClick={() => bookingMut.mutate()} disabled={bookingMut.isPending || !bkgNumber} className="bg-emerald-600 hover:bg-emerald-700 w-full">
                <Check className="h-4 w-4 mr-2" /> {bookingMut.isPending ? "Konfirmasi..." : "Konfirmasi Booking"}
              </Button>
            </div>
          </Section>
        )}

        {/* Tracking */}
        {["booked","sailed","arrived","completed"].some(s => order.status === s) || order.tracking_status ? (
          <Section title="Update Tracking Status" icon={MapPin} defaultOpen={false}>
            <div className="space-y-3 text-sm">
              {order.booking_number && (
                <div className="bg-gray-800/60 rounded p-3 space-y-1">
                  <p className="text-gray-400 text-xs">Booking Info</p>
                  <div className="grid grid-cols-3 gap-2 text-xs">
                    <span className="text-gray-400">Booking: <span className="text-white">{order.booking_number}</span></span>
                    <span className="text-gray-400">Carrier: <span className="text-white">{order.carrier || "-"}</span></span>
                    <span className="text-gray-400">Vessel: <span className="text-white">{order.vessel_name || "-"} / {order.voyage || "-"}</span></span>
                    <span className="text-gray-400">ETD: <span className="text-white">{order.etd || "-"}</span></span>
                    <span className="text-gray-400">ETA: <span className="text-white">{order.eta || "-"}</span></span>
                    {order.bl_number && <span className="text-gray-400">B/L: <span className="text-white">{order.bl_number}</span></span>}
                  </div>
                </div>
              )}
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <Label className="text-gray-400 text-xs">Status Tracking</Label>
                  <Select value={trackStatus} onValueChange={setTrackStatus}>
                    <SelectTrigger className="bg-gray-800 border-gray-600 text-white h-8"><SelectValue placeholder="Pilih status" /></SelectTrigger>
                    <SelectContent className="bg-gray-800 border-gray-700">
                      {TRACKING_OPTS.map((o) => <SelectItem key={o.v} value={o.v}>{o.l}</SelectItem>)}
                    </SelectContent>
                  </Select>
                </div>
                <div>
                  <Label className="text-gray-400 text-xs">Catatan</Label>
                  <Input value={trackNotes} onChange={(e) => setTrackNotes(e.target.value)} className="bg-gray-800 border-gray-600 text-white h-8" placeholder="Opsional" />
                </div>
              </div>
              <Button onClick={() => trackingMut.mutate()} disabled={trackingMut.isPending || !trackStatus} className="bg-sky-600 hover:bg-sky-700 w-full">
                <MapPin className="h-4 w-4 mr-2" /> {trackingMut.isPending ? "Update..." : "Update Tracking"}
              </Button>
            </div>
          </Section>
        ) : null}

        {/* ── PPJK — Dokumen Kepabeanan ──────────────────────────────────── */}
        <Section title="Dokumen Kepabeanan (PPJK)" icon={Anchor} defaultOpen={false}>
          <FreightCustomsPanel
            sourceModule="ocean_freight"
            sourceOrderId={id}
          />
        </Section>
      </div>
    </AppShell>
  );
}
