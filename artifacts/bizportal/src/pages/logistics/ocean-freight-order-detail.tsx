import { DatePicker } from "@/components/ui/date-picker";
import { useState } from "react";
import { useParams, useLocation } from "wouter";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { LoadingSkeleton } from "@/components/ui/loading-skeleton";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { useToast } from "@/hooks/use-toast";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import {
  Ship, ArrowLeft, Send, CheckCircle2, Package, Anchor,
  RefreshCw, Copy, ExternalLink, Loader2, Users, DollarSign,
} from "lucide-react";
import { FreightDocVerifyPanel } from "@/components/logistics/FreightDocVerifyPanel";

const IDR = (n: number) =>
  new Intl.NumberFormat("id-ID", { style: "currency", currency: "IDR", maximumFractionDigits: 0 }).format(n);

const STATUS_COLORS: Record<string, string> = {
  waiting_rate:   "bg-yellow-100 text-yellow-700",
  rate_requested: "bg-blue-100 text-blue-700",
  rate_received:  "bg-purple-100 text-purple-700",
  quoted:         "bg-green-100 text-green-700",
  approved:       "bg-green-200 text-green-800",
  booked:         "bg-sky-100 text-sky-700",
  sailed:         "bg-sky-200 text-sky-800",
  completed:      "bg-gray-100 text-gray-700",
  cancelled:      "bg-red-100 text-red-700",
  quote_declined: "bg-red-100 text-red-700",
};
const STATUS_LABELS: Record<string, string> = {
  waiting_rate: "Waiting Rate", rate_requested: "RFQ Sent", rate_received: "Rate Received",
  quoted: "Quoted", approved: "Approved", booked: "Booked", sailed: "Sailed",
  arrived: "Arrived", completed: "Completed", cancelled: "Cancelled", quote_declined: "Declined",
};
const ORDER_STATUSES = Object.entries(STATUS_LABELS);
const TRACKING_STATUSES = [
  "booked","container_empty_released","stuffed","gate_in","sailed",
  "transshipment","arrived","customs_clearance","delivered","completed",
];

export default function OceanFreightOrderDetailPage() {
  const { id } = useParams<{ id: string }>();
  const [, setLocation] = useLocation();
  const { toast } = useToast();
  const qc = useQueryClient();

  const [tab, setTab] = useState<"detail"|"rfq"|"submissions"|"quote"|"booking">("detail");

  // RFQ blast state
  const [blastNotes,     setBlastNotes]     = useState("");
  const [responseHours,  setResponseHours]  = useState("48");
  const [blasting,       setBlasting]       = useState(false);
  const [blastResult,    setBlastResult]    = useState<any>(null);

  // Final quote state
  const [finalPrice,     setFinalPrice]     = useState("");
  const [markupAmount,   setMarkupAmount]   = useState("0");
  const [ppnAmount,      setPpnAmount]      = useState("0");
  const [grandTotal,     setGrandTotal]     = useState("");
  const [adminNotes,     setAdminNotes]     = useState("");
  const [sendingQuote,   setSendingQuote]   = useState(false);
  const [selectedSub,    setSelectedSub]    = useState<any>(null);

  // Booking state
  const [bookCarrier,    setBookCarrier]    = useState("");
  const [bookVessel,     setBookVessel]     = useState("");
  const [bookVoyage,     setBookVoyage]     = useState("");
  const [bookEtd,        setBookEtd]        = useState("");
  const [bookEta,        setBookEta]        = useState("");
  const [bookBlNum,      setBookBlNum]      = useState("");
  const [bookContNum,    setBookContNum]    = useState("");
  const [bookingLoading, setBookingLoading] = useState(false);
  const [trackingStatus, setTrackingStatus] = useState("");

  const { data, isLoading, refetch } = useQuery<any>({
    queryKey: ["ocean-freight-order", id],
    queryFn: async () => {
      const res = await fetch(`/api/ocean-freight/${id}`);
      if (!res.ok) throw new Error("Gagal ambil data");
      return res.json();
    },
  });

  const order       = data?.order;
  const rfqs        = data?.rfqs ?? [];
  const submissions = data?.submissions ?? [];
  const baseUrl     = window.location.origin;
  const quoteUrl    = order?.quote_token ? `${baseUrl}/ocean-freight-quote/${order.quote_token}` : "";

  async function changeStatus(status: string) {
    await fetch(`/api/ocean-freight/${id}/status`, {
      method: "PATCH", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ status }),
    });
    refetch();
    toast({ title: "Status diperbarui" });
  }

  async function handleBlastRfq() {
    setBlasting(true);
    try {
      const res = await fetch(`/api/ocean-freight/${id}/blast-rfq`, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ blast_notes: blastNotes, response_hours: Number(responseHours) }),
      });
      const d = await res.json();
      if (!res.ok) throw new Error(d.error ?? "Gagal blast RFQ");
      setBlastResult(d);
      refetch();
      toast({ title: "RFQ berhasil di-blast!", description: `RFQ dibuat dengan ${d.vendor_links?.length ?? 0} link` });
    } catch (e: any) {
      toast({ title: "Error", description: e.message, variant: "destructive" });
    } finally {
      setBlasting(false);
    }
  }

  async function handleSendFinalQuote() {
    if (!grandTotal || Number(grandTotal) <= 0) {
      toast({ title: "Error", description: "Grand Total wajib diisi", variant: "destructive" }); return;
    }
    setSendingQuote(true);
    try {
      const finalBreakdown = selectedSub ? {
        ocean_freight: Number(selectedSub.ocean_freight_amount ?? 0),
        origin_charges: Number(selectedSub.thc_origin ?? 0),
        destination_charges: Number(selectedSub.thc_destination ?? 0),
        document_charges: Number(selectedSub.doc_fee ?? 0) + Number(selectedSub.bl_fee ?? 0) + Number(selectedSub.do_fee ?? 0),
        handling_fee: Number(selectedSub.handling_fee ?? 0),
        trucking_pickup: Number(selectedSub.trucking_pickup ?? 0),
        trucking_delivery: Number(selectedSub.trucking_delivery ?? 0),
        customs_clearance: Number(selectedSub.customs_clearance_fee ?? 0),
        surcharge: Number(selectedSub.surcharge_amount ?? 0),
        markup: Number(markupAmount),
        ppn: Number(ppnAmount),
      } : {};

      const res = await fetch(`/api/ocean-freight/${id}/final-quote`, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          final_rate_id: selectedSub?.id,
          final_price: Number(finalPrice || 0),
          final_price_idr: Number(finalPrice || 0) * (selectedSub?.exchange_rate ?? 1),
          markup_amount: Number(markupAmount),
          ppn_amount: Number(ppnAmount),
          grand_total: Number(grandTotal),
          final_breakdown: finalBreakdown,
          admin_notes: adminNotes,
        }),
      });
      const d = await res.json();
      if (!res.ok) throw new Error(d.error ?? "Gagal kirim quote");
      refetch();
      toast({ title: "Final quote berhasil dikirim!" });
    } catch (e: any) {
      toast({ title: "Error", description: e.message, variant: "destructive" });
    } finally {
      setSendingQuote(false);
    }
  }

  async function handleConfirmBooking() {
    setBookingLoading(true);
    try {
      const res = await fetch(`/api/ocean-freight/${id}/confirm-booking`, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          carrier: bookCarrier, vessel_name: bookVessel, voyage: bookVoyage,
          etd: bookEtd, eta: bookEta, bl_number: bookBlNum,
          container_number: bookContNum,
          pol: order?.origin_port, pod: order?.destination_port,
        }),
      });
      const d = await res.json();
      if (!res.ok) throw new Error(d.error ?? "Gagal konfirmasi booking");
      refetch();
      toast({ title: "Booking dikonfirmasi!", description: `No: ${d.booking_number}` });
    } catch (e: any) {
      toast({ title: "Error", description: e.message, variant: "destructive" });
    } finally {
      setBookingLoading(false);
    }
  }

  async function handleUpdateTracking() {
    if (!trackingStatus) return;
    await fetch(`/api/ocean-freight/${id}/tracking`, {
      method: "PATCH", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ tracking_status: trackingStatus, status: trackingStatus }),
    });
    refetch();
    toast({ title: "Tracking diperbarui" });
  }

  // Auto-calc grand total
  function calcGrandTotal() {
    const base    = Number(finalPrice || 0);
    const markup  = Number(markupAmount || 0);
    const ppn     = Number(ppnAmount || 0);
    const total   = base + markup + ppn;
    setGrandTotal(String(total));
  }

  if (isLoading) return <LoadingSkeleton variant="detail" />;
  if (!order) return (
    <div className="p-6 text-center text-red-500">Order tidak ditemukan</div>
  );

  const TAB_STYLE = (t: string) =>
    `px-4 py-2 text-sm font-medium rounded-t-lg border-b-2 transition-colors ${
      tab === t ? "border-blue-600 text-blue-700 bg-blue-50" : "border-transparent text-gray-600 hover:text-gray-900"
    }`;

  return (
    <div className="p-6 space-y-4 max-w-6xl">
      {/* Header */}
      <div className="flex items-center gap-3">
        <button onClick={() => setLocation("/logistics/ocean-freight-orders")}
          className="text-gray-400 hover:text-gray-700">
          <ArrowLeft className="w-5 h-5" />
        </button>
        <Ship className="w-5 h-5 text-blue-600" />
        <div className="flex-1">
          <h1 className="text-xl font-bold text-gray-900">{order.order_number}</h1>
          <p className="text-sm text-gray-500">{order.customer_name} · {order.origin_port} → {order.destination_port}</p>
        </div>
        <div className="flex items-center gap-2">
          <Select defaultValue={order.status} onValueChange={changeStatus}>
            <SelectTrigger className="w-44">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {ORDER_STATUSES.map(([v, l]) => (
                <SelectItem key={v} value={v}>{l}</SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Badge className={STATUS_COLORS[order.status] ?? "bg-gray-100 text-gray-700"}>
            {STATUS_LABELS[order.status] ?? order.status}
          </Badge>
          <Button variant="outline" size="sm" onClick={() => refetch()}><RefreshCw className="w-4 h-4" /></Button>
        </div>
      </div>

      {/* Quote URL */}
      {quoteUrl && (
        <div className="flex items-center gap-2 bg-blue-50 rounded-lg px-3 py-2 text-sm">
          <span className="text-blue-700 font-medium">Link Customer:</span>
          <span className="text-blue-600 text-xs flex-1 truncate">{quoteUrl}</span>
          <button onClick={() => navigator.clipboard.writeText(quoteUrl)} className="text-blue-600 hover:text-blue-800">
            <Copy className="w-4 h-4" />
          </button>
          <a href={quoteUrl} target="_blank" rel="noreferrer" className="text-blue-600 hover:text-blue-800">
            <ExternalLink className="w-4 h-4" />
          </a>
        </div>
      )}

      {/* Tabs */}
      <div className="flex border-b">
        {[["detail","Detail"],["rfq","Blast RFQ"],["submissions","Rate Submissions"],["quote","Final Quote"],["booking","Booking & Tracking"]].map(([t, l]) => (
          <button key={t} onClick={() => setTab(t as any)} className={TAB_STYLE(t)}>
            {l}
            {t === "submissions" && submissions.length > 0 && (
              <Badge className="ml-1 bg-blue-100 text-blue-700 text-xs">{submissions.length}</Badge>
            )}
          </button>
        ))}
      </div>

      {/* ── Tab: Detail ── */}
      {tab === "detail" && (
        <div className="space-y-4">
        <div className="grid md:grid-cols-2 gap-4">
          <div className="bg-white rounded-xl shadow p-4 space-y-3">
            <h3 className="font-bold text-gray-800 text-sm border-b pb-2">Customer</h3>
            {[["Nama", order.customer_name],["Phone", order.customer_phone],["Email", order.customer_email],["Perusahaan", order.customer_company]].filter(([,v])=>v).map(([k,v])=>(
              <div key={k as string} className="flex justify-between text-sm">
                <span className="text-gray-500">{k as string}</span>
                <span className="text-gray-800 font-medium">{v as string}</span>
              </div>
            ))}
          </div>
          <div className="bg-white rounded-xl shadow p-4 space-y-3">
            <h3 className="font-bold text-gray-800 text-sm border-b pb-2">Rute & Shipment</h3>
            {[
              ["Origin",`${order.origin_city} (${order.origin_port})`],
              ["Destination",`${order.destination_city} (${order.destination_port})`],
              ["Trade Type",order.trade_type],
              ["Service Mode",order.service_mode?.replace(/_/g," ")],
              ["Shipment Type",order.shipment_type],
              order.container_type && ["Container",`${order.container_type} x${order.container_qty}`],
              order.total_cbm && ["CBM", order.total_cbm],
              order.gross_weight && ["Gross Weight",`${order.gross_weight} kg`],
              order.incoterm && ["Incoterm",order.incoterm],
            ].filter(Boolean).map(([k,v])=>(
              <div key={k as string} className="flex justify-between text-sm">
                <span className="text-gray-500">{k as string}</span>
                <span className="text-gray-800 font-medium capitalize">{v as string}</span>
              </div>
            ))}
          </div>
          <div className="bg-white rounded-xl shadow p-4 space-y-3">
            <h3 className="font-bold text-gray-800 text-sm border-b pb-2">Kargo</h3>
            {[
              ["Komoditi",order.commodity],
              ["HS Code",order.hs_code],
              ["Cargo Condition",order.cargo_condition],
              order.cargo_value && ["Cargo Value", IDR(Number(order.cargo_value))],
              order.etd_preferred && ["ETD Preferred",order.etd_preferred],
            ].filter(Boolean).map(([k,v])=>(
              <div key={k as string} className="flex justify-between text-sm">
                <span className="text-gray-500">{k as string}</span>
                <span className="text-gray-800 font-medium">{v as string}</span>
              </div>
            ))}
            {Array.isArray(order.selected_additional_services) && order.selected_additional_services.length > 0 && (
              <div>
                <p className="text-gray-500 text-xs mb-1">Additional Services</p>
                <div className="flex flex-wrap gap-1">
                  {order.selected_additional_services.map((s: string) => (
                    <Badge key={s} variant="outline" className="text-xs">{s}</Badge>
                  ))}
                </div>
              </div>
            )}
          </div>
          <div className="bg-white rounded-xl shadow p-4 space-y-3">
            <h3 className="font-bold text-gray-800 text-sm border-b pb-2">Estimasi</h3>
            {[
              order.selected_estimate_option && ["Pilihan Estimasi", order.selected_estimate_option],
              order.estimated_price_idr && ["Estimasi IDR", IDR(Number(order.estimated_price_idr))],
              order.grand_total && ["Grand Total", IDR(Number(order.grand_total))],
            ].filter(Boolean).map(([k,v])=>(
              <div key={k as string} className="flex justify-between text-sm">
                <span className="text-gray-500">{k as string}</span>
                <span className="text-gray-800 font-bold">{v as string}</span>
              </div>
            ))}
            {order.customer_notes && (
              <div>
                <p className="text-gray-500 text-xs">Catatan Customer</p>
                <p className="text-gray-700 text-sm mt-0.5">{order.customer_notes}</p>
              </div>
            )}
          </div>
        </div>
        <FreightDocVerifyPanel
          shipmentRef={order.bl_number ?? order.booking_number ?? order.order_number}
          defaultSlots={[{ label: "BL" }, { label: "Invoice" }, { label: "Packing List" }]}
        />
        </div>
      )}

      {/* ── Tab: Blast RFQ ── */}
      {tab === "rfq" && (
        <div className="space-y-4">
          <div className="bg-white rounded-xl shadow p-5 space-y-4">
            <h3 className="font-bold text-gray-800 flex items-center gap-2">
              <Send className="w-4 h-4 text-blue-600" /> Blast RFQ ke Vendor
            </h3>
            <p className="text-sm text-gray-600">
              Sistem akan membuat link unik untuk setiap vendor. Vendor mengisi rate via link tersebut.
              Jika tidak ada vendor dipilih, satu link generik akan dibuat.
            </p>
            <div className="grid gap-3">
              <div>
                <Label>Notes untuk Vendor</Label>
                <Textarea value={blastNotes} onChange={e => setBlastNotes(e.target.value)} rows={2}
                  placeholder="Instruksi khusus untuk vendor..." />
              </div>
              <div>
                <Label>Deadline Respon (jam)</Label>
                <Input type="number" value={responseHours} onChange={e => setResponseHours(e.target.value)} className="w-32" />
              </div>
            </div>
            <Button onClick={handleBlastRfq} disabled={blasting} className="bg-blue-600 hover:bg-blue-700 text-white">
              {blasting ? <><Loader2 className="mr-2 w-4 h-4 animate-spin" />Memproses...</> : <><Send className="mr-2 w-4 h-4" />Blast RFQ</>}
            </Button>

            {blastResult && (
              <div className="bg-green-50 rounded-lg p-4 space-y-2">
                <p className="font-semibold text-green-800 flex items-center gap-2">
                  <CheckCircle2 className="w-4 h-4" /> RFQ berhasil dibuat
                </p>
                {blastResult.vendor_links?.map((vl: any, i: number) => (
                  <div key={i} className="flex items-center gap-2 text-sm">
                    <span className="text-gray-600 w-32 truncate">{vl.vendor_name}</span>
                    <span className="text-gray-500 text-xs flex-1 truncate">{vl.form_url}</span>
                    <button onClick={() => navigator.clipboard.writeText(vl.form_url)}
                      className="text-blue-600 hover:text-blue-800 flex-shrink-0">
                      <Copy className="w-4 h-4" />
                    </button>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* RFQ History */}
          {rfqs.length > 0 && (
            <div className="bg-white rounded-xl shadow overflow-hidden">
              <div className="px-4 py-3 border-b">
                <h4 className="font-semibold text-gray-800 text-sm">Riwayat RFQ</h4>
              </div>
              <table className="w-full text-sm">
                <thead className="bg-gray-50">
                  <tr>
                    {["No RFQ","Status","Blast At","Deadline","Notes"].map(h => (
                      <th key={h} className="px-4 py-2 text-left text-xs font-semibold text-gray-500">{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100">
                  {rfqs.map((r: any) => (
                    <tr key={r.id} className="hover:bg-gray-50">
                      <td className="px-4 py-2 font-mono text-xs">{r.rfq_number}</td>
                      <td className="px-4 py-2"><Badge variant="outline">{r.status}</Badge></td>
                      <td className="px-4 py-2 text-xs text-gray-500">{r.blast_at ? new Date(r.blast_at).toLocaleString("id-ID") : "-"}</td>
                      <td className="px-4 py-2 text-xs text-gray-500">{r.response_deadline ? new Date(r.response_deadline).toLocaleString("id-ID") : "-"}</td>
                      <td className="px-4 py-2 text-xs text-gray-500">{r.blast_notes ?? "-"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}

      {/* ── Tab: Rate Submissions ── */}
      {tab === "submissions" && (
        <div className="space-y-3">
          {submissions.length === 0 ? (
            <div className="bg-white rounded-xl shadow p-8 text-center text-gray-500">
              <Users className="w-10 h-10 mx-auto mb-2 text-gray-300" />
              Belum ada rate submission
            </div>
          ) : (
            <div className="bg-white rounded-xl shadow overflow-hidden">
              <table className="w-full text-sm">
                <thead className="bg-gray-50 border-b">
                  <tr>
                    {["Vendor","Carrier","Ocean Freight","Total IDR","Transit","ETD","Validity","Status","Aksi"].map(h => (
                      <th key={h} className="px-3 py-3 text-left text-xs font-semibold text-gray-500 uppercase">{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100">
                  {submissions.map((s: any) => (
                    <tr key={s.id} className={`hover:bg-gray-50 transition-colors ${selectedSub?.id === s.id ? "bg-blue-50 ring-1 ring-inset ring-blue-300" : ""}`}>
                      <td className="px-3 py-3">
                        <p className="font-medium text-gray-800">{s.vendor_name_db ?? s.vendor_name ?? "Unknown"}</p>
                        <p className="text-xs text-gray-500">{s.rate_source_name}</p>
                      </td>
                      <td className="px-3 py-3 text-xs">{s.carrier ?? "-"}</td>
                      <td className="px-3 py-3 whitespace-nowrap">
                        <p className="font-semibold">{s.currency} {Number(s.ocean_freight_amount ?? 0).toLocaleString("id-ID")}</p>
                        <p className="text-xs text-gray-500">Rate: {Number(s.exchange_rate ?? 16500).toLocaleString("id-ID")}</p>
                      </td>
                      <td className="px-3 py-3 font-semibold text-green-700 whitespace-nowrap">
                        {s.total_amount_idr ? IDR(Number(s.total_amount_idr)) : "-"}
                      </td>
                      <td className="px-3 py-3 text-xs">{s.transit_days ? `${s.transit_days}d` : "-"}</td>
                      <td className="px-3 py-3 text-xs">{s.etd ?? "-"}</td>
                      <td className="px-3 py-3 text-xs">{s.validity_date ?? "-"}</td>
                      <td className="px-3 py-3">
                        <Badge className={s.status === "submitted" ? "bg-green-100 text-green-700" : "bg-gray-100 text-gray-600"}>
                          {s.status}
                        </Badge>
                      </td>
                      <td className="px-3 py-3">
                        {s.status === "submitted" && (
                          <Button size="sm" variant={selectedSub?.id === s.id ? "default" : "outline"}
                            onClick={() => {
                              setSelectedSub(s.id === selectedSub?.id ? null : s);
                              if (s.id !== selectedSub?.id) {
                                const base = Number(s.total_amount_idr ?? s.total_amount ?? 0);
                                setFinalPrice(String(base));
                                setGrandTotal(String(base));
                                setBookCarrier(s.carrier ?? "");
                                setBookVessel(s.vessel_name ?? "");
                                setBookVoyage(s.voyage ?? "");
                                setBookEtd(s.etd ?? "");
                                setBookEta(s.eta ?? "");
                              }
                            }}
                            className="text-xs"
                          >
                            {selectedSub?.id === s.id ? "✓ Dipilih" : "Pilih Rate"}
                          </Button>
                        )}
                        {s.attachment_url && (
                          <a href={s.attachment_url} target="_blank" rel="noreferrer" className="ml-1">
                            <Button size="sm" variant="ghost" className="text-xs">
                              <ExternalLink className="w-3 h-3" />
                            </Button>
                          </a>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}

      {/* ── Tab: Final Quote ── */}
      {tab === "quote" && (
        <div className="bg-white rounded-xl shadow p-5 space-y-4 max-w-lg">
          <h3 className="font-bold text-gray-800 flex items-center gap-2">
            <DollarSign className="w-4 h-4 text-green-600" /> Kirim Final Quote ke Customer
          </h3>
          {selectedSub && (
            <div className="bg-blue-50 rounded-lg p-3 text-sm">
              <p className="font-medium text-blue-800">Rate Dipilih: {selectedSub.vendor_name_db ?? selectedSub.vendor_name}</p>
              <p className="text-blue-600">{selectedSub.currency} {Number(selectedSub.ocean_freight_amount ?? 0).toLocaleString("id-ID")} · Total IDR: {IDR(Number(selectedSub.total_amount_idr ?? 0))}</p>
            </div>
          )}
          <div className="grid gap-3">
            <div>
              <Label>Harga Final (IDR setelah konversi)</Label>
              <Input type="number" value={finalPrice} onChange={e => { setFinalPrice(e.target.value); }} placeholder="0" />
            </div>
            <div>
              <Label>Markup (IDR)</Label>
              <Input type="number" value={markupAmount} onChange={e => setMarkupAmount(e.target.value)} placeholder="0" />
            </div>
            <div>
              <Label>PPN (IDR, opsional)</Label>
              <Input type="number" value={ppnAmount} onChange={e => setPpnAmount(e.target.value)} placeholder="0" />
            </div>
            <Button variant="outline" size="sm" onClick={calcGrandTotal} className="w-fit">
              Hitung Grand Total
            </Button>
            <div>
              <Label>Grand Total (IDR) *</Label>
              <Input type="number" value={grandTotal} onChange={e => setGrandTotal(e.target.value)} placeholder="0"
                className="font-bold text-base" />
            </div>
            <div>
              <Label>Catatan Admin</Label>
              <Textarea value={adminNotes} onChange={e => setAdminNotes(e.target.value)} rows={2}
                placeholder="Catatan untuk customer..." />
            </div>
          </div>
          <Button
            onClick={handleSendFinalQuote}
            disabled={sendingQuote}
            className="bg-green-600 hover:bg-green-700 text-white w-full"
          >
            {sendingQuote ? <><Loader2 className="mr-2 w-4 h-4 animate-spin" />Mengirim...</> : <><Send className="mr-2 w-4 h-4" />Kirim Final Quote ke Customer</>}
          </Button>
          {order.status === "quoted" && (
            <div className="p-3 bg-green-50 rounded-lg text-sm text-green-700 flex items-center gap-2">
              <CheckCircle2 className="w-4 h-4" /> Quote sudah dikirim ke customer
            </div>
          )}
        </div>
      )}

      {/* ── Tab: Booking & Tracking ── */}
      {tab === "booking" && (
        <div className="space-y-4">
          {/* Confirm Booking */}
          <div className="bg-white rounded-xl shadow p-5 space-y-4">
            <h3 className="font-bold text-gray-800 flex items-center gap-2">
              <Anchor className="w-4 h-4 text-blue-600" /> Konfirmasi Booking
            </h3>
            {order.booking_confirmed_at && (
              <div className="p-3 bg-blue-50 rounded-lg text-sm text-blue-700">
                ✓ Booking dikonfirmasi: {new Date(order.booking_confirmed_at).toLocaleString("id-ID")}
                {order.booking_number && ` · No. ${order.booking_number}`}
              </div>
            )}
            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label>Carrier / Shipping Line</Label>
                <Input value={bookCarrier} onChange={e => setBookCarrier(e.target.value)} placeholder="Maersk / CMA CGM" />
              </div>
              <div>
                <Label>Vessel Name</Label>
                <Input value={bookVessel} onChange={e => setBookVessel(e.target.value)} />
              </div>
              <div>
                <Label>Voyage</Label>
                <Input value={bookVoyage} onChange={e => setBookVoyage(e.target.value)} />
              </div>
              <div>
                <Label>ETD</Label>
                <DatePicker value={bookEtd} onChange={v => setBookEtd(v)} />
              </div>
              <div>
                <Label>ETA</Label>
                <DatePicker value={bookEta} onChange={v => setBookEta(v)} />
              </div>
              <div>
                <Label>B/L Number</Label>
                <Input value={bookBlNum} onChange={e => setBookBlNum(e.target.value)} />
              </div>
              <div>
                <Label>Container Number (opsional)</Label>
                <Input value={bookContNum} onChange={e => setBookContNum(e.target.value)} />
              </div>
            </div>
            <Button onClick={handleConfirmBooking} disabled={bookingLoading}
              className="bg-blue-600 hover:bg-blue-700 text-white">
              {bookingLoading ? <><Loader2 className="mr-2 w-4 h-4 animate-spin" />Memproses...</> : <><CheckCircle2 className="mr-2 w-4 h-4" />Confirm Booking</>}
            </Button>
          </div>

          {/* Update Tracking */}
          <div className="bg-white rounded-xl shadow p-5 space-y-3">
            <h3 className="font-bold text-gray-800">Update Tracking Status</h3>
            {order.tracking_status && (
              <p className="text-sm text-gray-600">Current: <Badge variant="outline">{order.tracking_status}</Badge></p>
            )}
            <div className="flex gap-2">
              <Select value={trackingStatus} onValueChange={setTrackingStatus}>
                <SelectTrigger className="flex-1">
                  <SelectValue placeholder="Pilih status tracking" />
                </SelectTrigger>
                <SelectContent>
                  {TRACKING_STATUSES.map(s => (
                    <SelectItem key={s} value={s}>{s.replace(/_/g, " ")}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <Button onClick={handleUpdateTracking} disabled={!trackingStatus}
                className="bg-blue-600 text-white">
                Update
              </Button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
