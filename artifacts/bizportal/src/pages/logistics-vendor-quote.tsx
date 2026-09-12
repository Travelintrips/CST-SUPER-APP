import { useState, useEffect } from "react";
import { useParams } from "wouter";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { useToast } from "@/hooks/use-toast";
import {
  CheckCircle2,
  Truck,
  MapPin,
  Package,
  Calendar,
  ClipboardList,
  Send,
  AlertCircle,
  Loader2,
  ThumbsUp,
  Clock,
  Timer,
  BoxIcon,
} from "lucide-react";

interface OrderItem {
  serviceName: string | null;
  category: string | null;
  qty: number;
  unit: string;
  vendorUnitPrice: number | null;
  vendorSubtotal: number | null;
  ppnAmount: number | null;
  vendorGrandTotal: number | null;
}

interface V2FormData {
  linkId: number;
  rfqNumber: string;
  vendorName: string;
  orderType: string;
  serviceType: string;
  origin: string;
  destination: string;
  commodity: string | null;
  cargoDescription: string | null;
  grossWeight: number | null;
  volumeCbm: number | null;
  requiredDate: string | null;
  basicPrice: number | null;
  responseDeadline: string | null;
  alreadySubmitted: boolean;
  currentStatus: string;
  currentOfferedPrice: number | null;
  currentEta: string | null;
  currentNotes: string | null;
  currentLeadTimeDays: number | null;
  currentStockAvailability: string | null;
  orderItems: OrderItem[];
}

const fmt = (n: number) =>
  new Intl.NumberFormat("id-ID", {
    style: "currency",
    currency: "IDR",
    maximumFractionDigits: 0,
  }).format(n);

const STOCK_OPTIONS = [
  { value: "available", label: "✓ Tersedia", color: "bg-green-50 border-green-300 text-green-800" },
  { value: "limited", label: "⚠ Terbatas", color: "bg-yellow-50 border-yellow-300 text-yellow-800" },
  { value: "unavailable", label: "✕ Tidak Tersedia", color: "bg-red-50 border-red-300 text-red-700" },
  { value: "unknown", label: "? Tidak Tahu", color: "bg-gray-50 border-gray-300 text-gray-600" },
];

export default function LogisticsVendorQuotePage() {
  const { token } = useParams<{ token: string }>();
  const { toast } = useToast();

  const [loading, setLoading] = useState(true);
  const [data, setData] = useState<V2FormData | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [submitted, setSubmitted] = useState(false);

  const [action, setAction] = useState<"accept" | "counter" | "reject">("counter");
  const [offeredPrice, setOfferedPrice] = useState("");
  const [eta, setEta] = useState("");
  const [notes, setNotes] = useState("");
  const [leadTimeDays, setLeadTimeDays] = useState("");
  const [stockAvailability, setStockAvailability] = useState("unknown");
  const [sending, setSending] = useState(false);

  useEffect(() => {
    if (!token) {
      setError("Link tidak valid. Token tidak ditemukan.");
      setLoading(false);
      return;
    }

    fetch(`/api/logistic/rfq/vendor-form/${encodeURIComponent(token)}`)
      .then((res) => {
        if (res.status === 410) return res.json().then((j: any) => { throw new Error(j.message ?? "Link sudah kadaluarsa"); });
        if (!res.ok) return res.json().then((j: any) => { throw new Error(j.message ?? "Link tidak valid"); });
        return res.json();
      })
      .then((json: V2FormData) => {
        setData(json);
        if (json.alreadySubmitted) {
          if (json.currentOfferedPrice != null) {
            setOfferedPrice(String(json.currentOfferedPrice));
          } else if (json.basicPrice) {
            setOfferedPrice(String(json.basicPrice));
          }
          setEta(json.currentEta ?? "");
          setNotes(json.currentNotes ?? "");
          if (json.currentLeadTimeDays != null) setLeadTimeDays(String(json.currentLeadTimeDays));
          if (json.currentStockAvailability) setStockAvailability(json.currentStockAvailability);
          if (json.currentStatus === "accepted_basic_price") setAction("accept");
          else if (json.currentStatus === "rejected") setAction("reject");
          else setAction("counter");
        } else if (json.basicPrice && json.basicPrice > 0) {
          setOfferedPrice(String(json.basicPrice));
        }
      })
      .catch((e: Error) => setError(e.message || "Gagal memuat data RFQ. Coba lagi atau hubungi B2B Marketplace and Logistic."))
      .finally(() => setLoading(false));
  }, [token]);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!token) return;

    if (action === "counter") {
      const price = parseInt(offeredPrice.replace(/[^0-9]/g, ""), 10);
      if (!price || price <= 0) {
        toast({ title: "Harga penawaran wajib diisi", variant: "destructive" });
        return;
      }
      if (!eta.trim()) {
        toast({ title: "ETA wajib diisi untuk counter offer", variant: "destructive" });
        return;
      }
    }

    setSending(true);
    try {
      const price = action === "counter" ? parseInt(offeredPrice.replace(/[^0-9]/g, ""), 10) : undefined;
      const body: Record<string, unknown> = {
        action,
        notes: notes.trim() || undefined,
        stockAvailability: stockAvailability || "unknown",
      };
      if (action === "counter") {
        body.offeredPrice = price;
        body.eta = eta.trim();
      } else if (action === "accept" && eta.trim()) {
        body.eta = eta.trim();
      }
      if (leadTimeDays.trim()) body.leadTimeDays = parseInt(leadTimeDays, 10);

      const res = await fetch(`/api/logistic/rfq/vendor-form/${encodeURIComponent(token)}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const json = await res.json() as { success?: boolean; message?: string };
      if (json.success) {
        setSubmitted(true);
      } else {
        toast({ title: "Gagal mengirim", description: json.message ?? "Terjadi kesalahan.", variant: "destructive" });
      }
    } catch {
      toast({ title: "Error", description: "Tidak dapat terhubung ke server.", variant: "destructive" });
    } finally {
      setSending(false);
    }
  }

  if (loading) {
    return (
      <div className="min-h-screen bg-slate-50 flex items-center justify-center">
        <div className="text-center space-y-3">
          <Loader2 className="w-10 h-10 animate-spin text-blue-600 mx-auto" />
          <p className="text-slate-500 text-sm">Memuat data RFQ...</p>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="min-h-screen bg-slate-50 flex items-center justify-center p-4">
        <div className="bg-white rounded-2xl shadow-sm border border-red-100 p-8 max-w-sm w-full text-center space-y-4">
          <AlertCircle className="w-12 h-12 text-red-400 mx-auto" />
          <h2 className="text-lg font-semibold text-slate-800">Link Tidak Valid</h2>
          <p className="text-sm text-slate-500">{error}</p>
          <p className="text-xs text-slate-400">
            Hubungi B2B Marketplace and Logistic untuk mendapatkan link yang baru.
          </p>
        </div>
      </div>
    );
  }

  if (submitted) {
    const finalPrice = action === "counter" ? parseInt(offeredPrice.replace(/[^0-9]/g, ""), 10) : (data?.basicPrice ?? 0);
    const actionLabel = action === "accept" ? "diterima" : action === "reject" ? "ditolak" : "counter offer dikirim";
    return (
      <div className="min-h-screen bg-slate-50 flex items-center justify-center p-4">
        <div className="bg-white rounded-2xl shadow-sm border border-green-100 p-8 max-w-sm w-full text-center space-y-4">
          <div className="w-16 h-16 bg-green-100 rounded-full flex items-center justify-center mx-auto">
            <CheckCircle2 className="w-9 h-9 text-green-600" />
          </div>
          <h2 className="text-xl font-bold text-slate-800">
            {action === "reject" ? "Penawaran Ditolak" : "Penawaran Terkirim!"}
          </h2>
          <p className="text-sm text-slate-500">
            {action === "reject"
              ? "Anda telah menolak RFQ ini. Terima kasih telah memberi tahu kami."
              : `Penawaran Anda sudah ${actionLabel}. Tim B2B Marketplace and Logistic akan menghubungi Anda apabila penawaran Anda dipilih.`}
          </p>
          {data && action !== "reject" && (
            <div className="bg-slate-50 rounded-xl p-4 text-left text-sm space-y-1.5 mt-2">
              <div className="flex justify-between">
                <span className="text-slate-500">No. RFQ</span>
                <span className="font-mono font-semibold text-slate-800">{data.rfqNumber}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-slate-500">Rute</span>
                <span className="font-medium text-slate-800">{data.origin} → {data.destination}</span>
              </div>
              {action === "counter" && finalPrice > 0 && (
                <div className="flex justify-between">
                  <span className="text-slate-500">Harga</span>
                  <span className="font-bold text-green-700">{fmt(finalPrice)}</span>
                </div>
              )}
              {leadTimeDays && (
                <div className="flex justify-between">
                  <span className="text-slate-500">Lead Time</span>
                  <span className="font-medium text-slate-800">{leadTimeDays} hari</span>
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    );
  }

  if (!data) return null;

  const isTrucking = data.serviceType?.toLowerCase().includes("trucking");
  const isAlreadySubmitted = data.alreadySubmitted;
  const jenisLayanan = data.serviceType;
  const isDeadlinePassed = data.responseDeadline ? new Date(data.responseDeadline) < new Date() : false;

  return (
    <div className="min-h-screen bg-slate-50">
      <div className={`text-white ${isTrucking ? "bg-orange-600" : "bg-blue-700"}`}>
        <div className="max-w-lg mx-auto px-4 py-6">
          <div className="flex items-center gap-3 mb-1">
            <Truck className="w-5 h-5 opacity-80" />
            <span className="text-sm font-medium opacity-80">B2B Marketplace and Logistic</span>
          </div>
          <h1 className="text-xl font-bold">Form Penawaran Vendor</h1>
          <p className={`text-sm mt-1 ${isTrucking ? "text-orange-200" : "text-blue-200"}`}>
            Kepada: <span className="text-white font-semibold">{data.vendorName}</span>
          </p>
        </div>
      </div>

      <div className="max-w-lg mx-auto px-4 py-5 space-y-4">
        {isAlreadySubmitted && (
          <div className="bg-amber-50 border border-amber-200 rounded-xl p-4 flex items-start gap-3">
            <AlertCircle className="w-5 h-5 text-amber-500 flex-shrink-0 mt-0.5" />
            <div className="text-sm">
              <p className="font-semibold text-amber-800">Penawaran Sudah Dikirim</p>
              <p className="text-amber-600 mt-0.5">
                Anda sudah mengajukan penawaran sebelumnya. Anda dapat memperbarui di bawah ini.
              </p>
            </div>
          </div>
        )}

        {isDeadlinePassed && (
          <div className="bg-red-50 border border-red-200 rounded-xl p-3 text-sm text-red-700 flex items-center gap-2">
            <AlertCircle className="w-4 h-4 flex-shrink-0" />
            Batas waktu respons sudah lewat. Penawaran Anda masih bisa dikirim sebagai late response.
          </div>
        )}

        {data.responseDeadline && !isDeadlinePassed && (
          <div className="bg-blue-50 border border-blue-200 rounded-xl p-3 text-sm text-blue-700 flex items-center gap-2">
            <Clock className="w-4 h-4 flex-shrink-0" />
            Batas waktu: <strong>{new Date(data.responseDeadline).toLocaleString("id-ID")}</strong>
          </div>
        )}

        {/* Detail Order */}
        <div className="bg-white rounded-2xl border border-slate-200 shadow-sm p-5 space-y-4">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <ClipboardList className="w-4 h-4 text-blue-600" />
              <span className="text-sm font-semibold text-slate-700">Detail Order</span>
            </div>
            <Badge variant="outline" className="text-xs font-mono">{data.rfqNumber}</Badge>
          </div>

          <div className="grid grid-cols-2 gap-y-2.5 text-sm">
            <span className="text-slate-500">Jenis Layanan</span>
            <span className="font-medium text-slate-800 text-right">{jenisLayanan}</span>
            {data.commodity && (
              <>
                <span className="text-slate-500">Komoditi</span>
                <span className="font-medium text-slate-800 text-right">{data.commodity}</span>
              </>
            )}
          </div>

          <div className="bg-blue-50 rounded-xl px-4 py-3 space-y-1.5">
            <p className="text-xs text-blue-500 font-semibold uppercase tracking-wide flex items-center gap-1">
              <MapPin className="w-3 h-3" /> Rute Pengiriman
            </p>
            <div className="flex items-center gap-2 text-sm">
              <span className="font-semibold text-slate-800">{data.origin}</span>
              <span className="text-blue-400">→</span>
              <span className="font-bold text-blue-700">{data.destination}</span>
            </div>
          </div>

          {data.requiredDate && (
            <div className="bg-slate-50 rounded-xl border border-slate-200 p-3">
              <p className="text-xs text-slate-400 mb-1 flex items-center gap-1">
                <Calendar className="w-3 h-3" /> Tgl Diperlukan
              </p>
              <p className="text-sm font-bold text-slate-800">{data.requiredDate}</p>
            </div>
          )}

          {(data.cargoDescription || data.grossWeight || data.volumeCbm) && (
            <div className="border border-slate-100 rounded-xl overflow-hidden">
              <div className="bg-slate-50 px-4 py-2 border-b border-slate-100">
                <p className="text-xs font-semibold text-slate-500 uppercase tracking-wide flex items-center gap-1">
                  <Package className="w-3 h-3" /> Informasi Barang
                </p>
              </div>
              <div className="px-4 py-3 grid grid-cols-2 gap-y-2.5 text-sm">
                {data.cargoDescription && (
                  <>
                    <span className="text-slate-500">Jenis Barang</span>
                    <span className="font-medium text-slate-800 text-right">{data.cargoDescription}</span>
                  </>
                )}
                {data.grossWeight != null && (
                  <>
                    <span className="text-slate-500">Berat</span>
                    <span className="font-bold text-slate-800 text-right">{data.grossWeight} kg</span>
                  </>
                )}
                {data.volumeCbm != null && (
                  <>
                    <span className="text-slate-500">Volume</span>
                    <span className="font-medium text-slate-800 text-right">{data.volumeCbm} CBM</span>
                  </>
                )}
              </div>
            </div>
          )}

          {data.orderItems.length > 0 && (
            <div className="border border-slate-100 rounded-xl overflow-hidden">
              <div className="bg-slate-50 px-4 py-2 border-b border-slate-100">
                <p className="text-xs font-semibold text-slate-500 uppercase tracking-wide">Item Order</p>
              </div>
              <div className="divide-y divide-slate-50">
                {data.orderItems.map((item, i) => (
                  <div key={i} className="px-4 py-3 text-sm space-y-1">
                    <div className="flex justify-between">
                      <span className="font-medium text-slate-800">{item.serviceName || item.category || `Item ${i + 1}`}</span>
                      <span className="text-slate-500 text-xs">{item.qty} {item.unit}</span>
                    </div>
                    {item.vendorUnitPrice != null && (
                      <div className="text-xs text-slate-500 space-y-0.5">
                        <div className="flex justify-between">
                          <span>Harga etalase / {item.unit}</span>
                          <span className="text-slate-700">{fmt(item.vendorUnitPrice)}</span>
                        </div>
                        {item.vendorGrandTotal != null && (
                          <div className="flex justify-between font-semibold text-slate-700">
                            <span>Total (inc. PPN)</span>
                            <span>{fmt(item.vendorGrandTotal)}</span>
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>

        {/* Form */}
        <form onSubmit={handleSubmit} className="bg-white rounded-2xl border border-slate-200 shadow-sm p-5 space-y-5">
          <div className="flex items-center gap-2">
            <Send className="w-4 h-4 text-blue-600" />
            <span className="text-sm font-semibold text-slate-700">
              {isAlreadySubmitted ? "Perbarui Penawaran" : "Isi Penawaran Anda"}
            </span>
          </div>

          {/* Action selection */}
          <div className="space-y-2">
            <Label className="text-sm font-semibold text-slate-700">Respons Anda <span className="text-red-500">*</span></Label>
            <div className="grid grid-cols-3 gap-2">
              {[
                { value: "accept", label: "✓ Terima Harga Dasar", color: "border-green-300 bg-green-50 text-green-800" },
                { value: "counter", label: "↕ Counter Offer", color: "border-blue-300 bg-blue-50 text-blue-800" },
                { value: "reject", label: "✕ Tolak", color: "border-red-300 bg-red-50 text-red-700" },
              ].map((opt) => (
                <button
                  key={opt.value}
                  type="button"
                  onClick={() => setAction(opt.value as any)}
                  className={`px-2 py-2.5 rounded-xl border-2 text-xs font-semibold transition-all ${
                    action === opt.value ? opt.color + " ring-2 ring-offset-1 ring-current" : "border-slate-200 bg-white text-slate-500 hover:border-slate-300"
                  }`}
                >
                  {opt.label}
                </button>
              ))}
            </div>
            {action === "accept" && data.basicPrice && (
              <p className="text-xs text-green-700 bg-green-50 border border-green-200 rounded-lg px-3 py-1.5">
                Anda menerima harga dasar: <strong>{fmt(data.basicPrice)}</strong>
              </p>
            )}
          </div>

          {/* Harga counter offer */}
          {action === "counter" && (
            <div className="space-y-1.5">
              <Label htmlFor="offeredPrice" className="text-sm font-semibold text-slate-700">
                Harga Penawaran (Rp) <span className="text-red-500">*</span>
              </Label>
              {data.basicPrice && data.basicPrice > 0 && (
                <p className="text-xs text-slate-500">
                  Harga dasar: <span className="font-medium text-slate-700">{fmt(data.basicPrice)}</span>
                </p>
              )}
              <input
                id="offeredPrice"
                type="text"
                inputMode="numeric"
                placeholder="Contoh: 5000000"
                value={offeredPrice}
                onChange={(e) => setOfferedPrice(e.target.value.replace(/[^0-9]/g, ""))}
                className="w-full h-12 px-3 text-lg font-semibold text-slate-900 bg-white border border-slate-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                required={action === "counter"}
              />
              {offeredPrice && parseInt(offeredPrice, 10) > 0 && (
                <div className="bg-green-50 border border-green-200 rounded-lg px-3 py-2">
                  <p className="text-sm text-green-700 font-semibold">{fmt(parseInt(offeredPrice, 10))}</p>
                </div>
              )}
            </div>
          )}

          {/* ETA */}
          {action !== "reject" && (
            <div className="space-y-1.5">
              <Label htmlFor="eta" className="text-sm font-semibold text-slate-700 flex items-center gap-1.5">
                <Clock className="w-3.5 h-3.5" />
                ETA {action === "counter" ? <span className="text-red-500">*</span> : <span className="text-slate-400 font-normal">(opsional)</span>}
              </Label>
              <input
                id="eta"
                type="text"
                placeholder="Contoh: 3-5 hari kerja, 2026-06-10, H+2"
                value={eta}
                onChange={(e) => setEta(e.target.value)}
                className="w-full h-10 px-3 text-sm text-slate-900 bg-white border border-slate-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
                required={action === "counter"}
              />
            </div>
          )}

          {/* Lead Time Days */}
          {action !== "reject" && (
            <div className="space-y-1.5">
              <Label htmlFor="leadTimeDays" className="text-sm font-semibold text-slate-700 flex items-center gap-1.5">
                <Timer className="w-3.5 h-3.5" />
                Lead Time (hari) <span className="text-slate-400 font-normal">(opsional)</span>
              </Label>
              <input
                id="leadTimeDays"
                type="number"
                inputMode="numeric"
                min="0"
                max="365"
                placeholder="Contoh: 3"
                value={leadTimeDays}
                onChange={(e) => setLeadTimeDays(e.target.value.replace(/[^0-9]/g, ""))}
                className="w-full h-10 px-3 text-sm text-slate-900 bg-white border border-slate-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
              />
              <p className="text-xs text-slate-400">Jumlah hari dari order diterima hingga pengiriman siap dilakukan</p>
            </div>
          )}

          {/* Stock Availability */}
          {action !== "reject" && (
            <div className="space-y-2">
              <Label className="text-sm font-semibold text-slate-700 flex items-center gap-1.5">
                <BoxIcon className="w-3.5 h-3.5" />
                Ketersediaan Stok / Armada
              </Label>
              <div className="grid grid-cols-2 gap-2">
                {STOCK_OPTIONS.map((opt) => (
                  <button
                    key={opt.value}
                    type="button"
                    onClick={() => setStockAvailability(opt.value)}
                    className={`px-3 py-2.5 rounded-xl border-2 text-xs font-semibold transition-all text-left ${
                      stockAvailability === opt.value
                        ? opt.color + " ring-2 ring-offset-1 ring-current"
                        : "border-slate-200 bg-white text-slate-500 hover:border-slate-300"
                    }`}
                  >
                    {opt.label}
                  </button>
                ))}
              </div>
            </div>
          )}

          {/* Notes */}
          <div className="space-y-1.5">
            <Label htmlFor="notes" className="text-sm text-slate-600">
              Catatan / Syarat Tambahan <span className="text-slate-400">(opsional)</span>
            </Label>
            <Textarea
              id="notes"
              rows={3}
              placeholder={
                action === "reject"
                  ? "Alasan menolak (opsional)..."
                  : "Misal: Sudah termasuk asuransi, pembayaran 14 hari, dll."
              }
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              className="text-sm resize-none"
            />
          </div>

          <Button
            type="submit"
            disabled={sending}
            className={`w-full h-12 text-white text-base font-semibold rounded-xl ${
              action === "reject"
                ? "bg-red-500 hover:bg-red-600"
                : action === "accept"
                  ? "bg-green-600 hover:bg-green-700"
                  : "bg-blue-600 hover:bg-blue-700"
            }`}
          >
            {sending ? (
              <>
                <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                Mengirim...
              </>
            ) : action === "reject" ? (
              <>
                <AlertCircle className="w-4 h-4 mr-2" />
                {isAlreadySubmitted ? "Perbarui (Tolak)" : "Tolak RFQ Ini"}
              </>
            ) : action === "accept" ? (
              <>
                <ThumbsUp className="w-4 h-4 mr-2" />
                {isAlreadySubmitted ? "Perbarui Konfirmasi" : "Terima Harga Dasar"}
              </>
            ) : (
              <>
                <Send className="w-4 h-4 mr-2" />
                {isAlreadySubmitted ? "Perbarui Counter Offer" : "Kirim Counter Offer"}
              </>
            )}
          </Button>
        </form>

        <p className="text-center text-xs text-slate-400 pb-6">
          © B2B Marketplace and Logistic — Form ini hanya untuk vendor yang menerima RFQ.
        </p>
      </div>
    </div>
  );
}
