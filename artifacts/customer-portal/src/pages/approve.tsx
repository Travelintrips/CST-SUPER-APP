import { useState, useEffect, useCallback } from "react";
import { useParams } from "wouter";
import { CheckCircle2, AlertCircle, Loader2, Truck, MapPin, Package, User, Phone, ChevronDown, ChevronUp, Send, RefreshCw } from "lucide-react";
import { useLanguage } from "@/i18n/LanguageContext";

const BASE = import.meta.env.BASE_URL?.replace(/\/$/, "") ?? "";
function apiUrl(path: string) {
  return `${BASE}${path}`;
}

interface Quote {
  id: number;
  vendorId: number;
  vendorName: string;
  estimatedPickup: string | null;
  estimatedDelivery: string | null;
  estimatedDays: number | null;
  vendorNotes: string | null;
  vendorPrice: number;
  markupType: string;
  markupPercentage: number;
  fixedSellingPrice: number | null;
  sellingPrice: number;
  quoteStatus: string;
  replySource: string | null;
}

interface PendingVendor {
  id: number;
  name: string;
  hasPhone: boolean;
}

interface OrderData {
  orderId: number;
  orderNumber: string;
  shipmentType: string;
  origin: string;
  destination: string;
  commodity: string | null;
  customerName: string;
  phone: string | null;
  adminApprovalStatus: string;
  approvedQuoteId: number | null;
  finalSellingPrice: number | null;
  rfqId: number | null;
  rfqNumber: string | null;
  pendingVendors: PendingVendor[];
  quotes: Quote[];
}

interface VendorOption {
  id: number;
  name: string;
  serviceType: string;
  hasPhone: boolean;
}

function fmt(n: number) {
  return `Rp ${Math.round(n).toLocaleString("id-ID")}`;
}

function calcSuggested(q: Quote): number {
  return q.sellingPrice;
}

export default function ApprovePage() {
  const { t } = useLanguage();
  const { orderNumber } = useParams<{ orderNumber: string }>();
  const [data, setData] = useState<OrderData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [selectedQuoteId, setSelectedQuoteId] = useState<number | null>(null);
  const [sellingPrice, setSellingPrice] = useState<string>("");
  const [submitting, setSubmitting] = useState(false);
  const [success, setSuccess] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [expandedQuote, setExpandedQuote] = useState<number | null>(null);

  // Manual RFQ state
  const [vendors, setVendors] = useState<VendorOption[]>([]);
  const [selectedVendorIds, setSelectedVendorIds] = useState<number[]>([]);
  const [rfqShipmentType, setRfqShipmentType] = useState<string>("");
  const [sendingRfq, setSendingRfq] = useState(false);
  const [rfqSent, setRfqSent] = useState(false);
  const [rfqError, setRfqError] = useState<string | null>(null);

  // Resend RFQ state
  const [resendingIds, setResendingIds] = useState<Set<number>>(new Set());
  const [resendResults, setResendResults] = useState<Record<number, "ok" | "fail">>({});

  const loadData = useCallback(() => {
    if (!orderNumber) return;
    fetch(apiUrl(`/api/logistic/orders/approve-form/${orderNumber}`))
      .then((r) => {
        if (r.status === 401) return Promise.reject("__unauthorized__");
        return r.ok ? r.json() : r.json().then((e: { message: string }) => Promise.reject(e.message));
      })
      .then((d: OrderData) => {
        setData(d);
        setRfqShipmentType(d.shipmentType || "");
        if (d.approvedQuoteId) {
          setSelectedQuoteId(d.approvedQuoteId);
          if (d.finalSellingPrice) setSellingPrice(String(Math.round(d.finalSellingPrice)));
        } else if (d.quotes.length === 1) {
          setSelectedQuoteId(d.quotes[0].id);
          setSellingPrice(String(Math.round(calcSuggested(d.quotes[0]))));
        }
      })
      .catch((msg: string) => setError(typeof msg === "string" ? msg : "Gagal memuat data"))
      .finally(() => setLoading(false));
  }, [orderNumber]);

  useEffect(() => { loadData(); }, [loadData]);

  useEffect(() => {
    fetch(apiUrl("/api/logistic/orders/logistic-vendors"))
      .then((r) => r.ok ? r.json() : [])
      .then((v: VendorOption[]) => setVendors(v))
      .catch(() => {});
  }, []);

  async function handleSendRfq() {
    if (!data || selectedVendorIds.length === 0) return;
    setSendingRfq(true);
    setRfqError(null);
    try {
      const r = await fetch(apiUrl(`/api/logistic/orders/${data.orderId}/manual-rfq`), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ vendorIds: selectedVendorIds, shipmentType: rfqShipmentType || undefined }),
      });
      if (r.status === 401) throw new Error("Sesi login diperlukan. Buka BizPortal untuk melanjutkan.");
      const res = await r.json() as { ok?: boolean; vendorCount?: number; message?: string };
      if (!r.ok) throw new Error(res.message ?? "Gagal kirim RFQ");
      setRfqSent(true);
      setSelectedVendorIds([]);
      setTimeout(() => {
        setRfqSent(false);
        setLoading(true);
        loadData();
      }, 3000);
    } catch (e: unknown) {
      setRfqError(e instanceof Error ? e.message : "Gagal kirim RFQ");
    } finally {
      setSendingRfq(false);
    }
  }

  function toggleVendor(id: number) {
    setSelectedVendorIds((prev) =>
      prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]
    );
  }

  async function handleResendWa(vendorId: number) {
    if (!data?.orderId) return;
    setResendingIds((prev) => new Set(prev).add(vendorId));
    setResendResults((prev) => { const n = { ...prev }; delete n[vendorId]; return n; });
    try {
      const r = await fetch(apiUrl(`/api/logistic/orders/${data.orderId}/resend-rfq`), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ vendorIds: [vendorId] }),
      });
      const res = await r.json() as { ok?: boolean; sentCount?: number; message?: string };
      if (!r.ok) throw new Error(res.message ?? "Gagal kirim ulang");
      setResendResults((prev) => ({ ...prev, [vendorId]: (res.sentCount ?? 0) > 0 ? "ok" : "fail" }));
    } catch {
      setResendResults((prev) => ({ ...prev, [vendorId]: "fail" }));
    } finally {
      setResendingIds((prev) => { const n = new Set(prev); n.delete(vendorId); return n; });
    }
  }

  function onSelectQuote(q: Quote) {
    setSelectedQuoteId(q.id);
    setSellingPrice(String(Math.round(calcSuggested(q))));
    setExpandedQuote(q.id);
  }

  async function handleApprove() {
    if (!data || !selectedQuoteId) return;
    const sp = parseFloat(sellingPrice.replace(/[^\d.]/g, ""));
    if (isNaN(sp) || sp <= 0) {
      setSubmitError("Harga jual tidak valid");
      return;
    }
    setSubmitting(true);
    setSubmitError(null);
    try {
      const r = await fetch(apiUrl(`/api/logistic/orders/${data.orderId}/approve`), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ quoteId: selectedQuoteId, sellingPrice: sp }),
      });
      if (r.status === 401) throw new Error("Sesi login diperlukan. Buka BizPortal untuk melanjutkan.");
      if (!r.ok) {
        const e = await r.json() as { message?: string };
        throw new Error(e.message ?? "Gagal approve");
      }
      setSuccess(true);
    } catch (e: unknown) {
      setSubmitError(e instanceof Error ? e.message : "Gagal approve order");
    } finally {
      setSubmitting(false);
    }
  }

  const isAlreadyApproved = data?.adminApprovalStatus === "approved";

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-50">
        <div className="flex flex-col items-center gap-3 text-gray-500">
          <Loader2 className="w-8 h-8 animate-spin" />
          <p className="text-sm">Memuat data order...</p>
        </div>
      </div>
    );
  }

  if (error === "__unauthorized__" || (!loading && !data && error === null)) {
    const returnTo = encodeURIComponent(window.location.pathname + window.location.search);
    window.location.replace(`/api/login?returnTo=${returnTo}`);
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-50">
        <div className="flex flex-col items-center gap-3 text-gray-500">
          <Loader2 className="w-8 h-8 animate-spin" />
          <p className="text-sm">Mengalihkan ke halaman login...</p>
        </div>
      </div>
    );
  }

  if (error || !data) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-50 px-4">
        <div className="bg-white rounded-2xl shadow p-6 max-w-sm w-full text-center space-y-3">
          <AlertCircle className="w-10 h-10 text-red-500 mx-auto" />
          <h2 className="font-semibold text-gray-800">Order Tidak Ditemukan</h2>
          <p className="text-sm text-gray-500">{error ?? "Order tidak ditemukan"}</p>
        </div>
      </div>
    );
  }

  if (success) {
    const approved = data.quotes.find((q) => q.id === selectedQuoteId);
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-50 px-4">
        <div className="bg-white rounded-2xl shadow p-6 max-w-sm w-full text-center space-y-4">
          <div className="w-16 h-16 rounded-full bg-green-100 flex items-center justify-center mx-auto">
            <CheckCircle2 className="w-9 h-9 text-green-600" />
          </div>
          <div>
            <h2 className="font-bold text-lg text-gray-900">Penawaran Dikirim!</h2>
            <p className="text-sm text-gray-500 mt-1">Harga telah dikirim ke customer via WhatsApp</p>
          </div>
          <div className="bg-green-50 rounded-xl p-4 text-left space-y-1 text-sm">
            <div className="flex justify-between">
              <span className="text-gray-500">Order</span>
              <span className="font-mono font-medium">{data.orderNumber}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-gray-500">Vendor</span>
              <span className="font-medium">{approved?.vendorName}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-gray-500">Harga Jual</span>
              <span className="font-bold text-green-700">{fmt(parseFloat(sellingPrice))}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-gray-500">Customer</span>
              <span className="font-medium">{data.customerName}</span>
            </div>
          </div>
        </div>
      </div>
    );
  }

  const selectedQuote = data.quotes.find((q) => q.id === selectedQuoteId) ?? null;

  return (
    <div className="min-h-screen bg-gray-50 pb-10">
      {/* Header */}
      <div className="bg-white border-b sticky top-0 z-10">
        <div className="max-w-lg mx-auto px-4 py-3 flex items-center gap-3">
          <div className="w-8 h-8 bg-blue-600 rounded-lg flex items-center justify-center">
            <Truck className="w-4 h-4 text-white" />
          </div>
          <div>
            <p className="text-xs text-gray-400 leading-none">Approve Penawaran</p>
            <p className="font-mono text-sm font-semibold text-gray-800 leading-tight">{data.orderNumber}</p>
          </div>
          {isAlreadyApproved && (
            <span className="ml-auto text-xs bg-green-100 text-green-700 px-2 py-0.5 rounded-full font-medium">
              Sudah Diapprove
            </span>
          )}
        </div>
      </div>

      <div className="max-w-lg mx-auto px-4 pt-4 space-y-4">
        {/* Order Summary */}
        <div className="bg-white rounded-2xl shadow-sm p-4 space-y-3">
          <h3 className="font-semibold text-gray-700 text-sm uppercase tracking-wide">Detail Order</h3>
          <div className="space-y-2">
            <InfoRow icon={<User className="w-4 h-4" />} label="Customer" value={data.customerName} />
            {data.phone && <InfoRow icon={<Phone className="w-4 h-4" />} label="Telepon" value={data.phone} />}
            <InfoRow icon={<Truck className="w-4 h-4" />} label="Jenis" value={data.shipmentType} />
            <InfoRow
              icon={<MapPin className="w-4 h-4" />}
              label="Rute"
              value={`${data.origin} → ${data.destination}`}
            />
            {data.commodity && (
              <InfoRow icon={<Package className="w-4 h-4" />} label="Komoditi" value={data.commodity} />
            )}
          </div>
        </div>

        {/* Quotes */}
        <div className="space-y-2">
          <h3 className="font-semibold text-gray-700 text-sm uppercase tracking-wide px-1">
            Penawaran Vendor ({data.quotes.length})
          </h3>

          {data.quotes.length === 0 ? (
            <div className="space-y-3">
              <div className="bg-amber-50 border border-amber-200 rounded-2xl p-4 text-sm text-amber-800">
                <p className="font-semibold mb-1">Belum ada penawaran masuk</p>
                <p className="text-amber-700">
                  {data.shipmentType
                    ? `Tidak ada vendor dengan tipe "${data.shipmentType}" yang terdaftar, atau vendor belum merespons.`
                    : "Jenis layanan (shipmentType) kosong sehingga RFQ tidak terkirim otomatis."}
                </p>
              </div>

              {/* Manual RFQ section */}
              {rfqSent ? (
                <div className="bg-green-50 border border-green-200 rounded-2xl p-5 text-center space-y-2">
                  <CheckCircle2 className="w-8 h-8 text-green-600 mx-auto" />
                  <p className="font-semibold text-green-800">RFQ berhasil dikirim!</p>
                  <p className="text-sm text-green-600">Halaman akan refresh untuk menunggu balasan vendor...</p>
                </div>
              ) : (
                <div className="bg-white rounded-2xl shadow-sm p-4 space-y-4">
                  <h3 className="font-semibold text-gray-700 text-sm uppercase tracking-wide">
                    Kirim RFQ Manual ke Vendor
                  </h3>

                  {/* shipmentType input if empty */}
                  {!data.shipmentType && (
                    <div>
                      <label className="block text-xs font-medium text-gray-500 mb-1">
                        Jenis Layanan (opsional, untuk info vendor)
                      </label>
                      <input
                        type="text"
                        className="w-full border border-gray-200 rounded-xl px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-400"
                        placeholder="cth: Sea Freight, Trucking, Air Freight..."
                        value={rfqShipmentType}
                        onChange={(e) => setRfqShipmentType(e.target.value)}
                      />
                    </div>
                  )}

                  {/* Vendor list */}
                  {vendors.length === 0 ? (
                    <p className="text-sm text-gray-400">Tidak ada vendor aktif tersedia</p>
                  ) : (
                    <div className="space-y-2">
                      <p className="text-xs text-gray-400">Pilih vendor yang akan menerima RFQ:</p>
                      {vendors.map((v) => (
                        <button
                          key={v.id}
                          type="button"
                          onClick={() => v.hasPhone && toggleVendor(v.id)}
                          className={`w-full text-left flex items-center gap-3 p-3 rounded-xl border-2 transition-colors ${
                            !v.hasPhone
                              ? "border-gray-100 bg-gray-50 opacity-50 cursor-not-allowed"
                              : selectedVendorIds.includes(v.id)
                              ? "border-blue-500 bg-blue-50"
                              : "border-gray-200 hover:border-gray-300"
                          }`}
                        >
                          <div className={`w-5 h-5 rounded-full border-2 flex-shrink-0 flex items-center justify-center ${
                            selectedVendorIds.includes(v.id) ? "border-blue-500 bg-blue-500" : "border-gray-300"
                          }`}>
                            {selectedVendorIds.includes(v.id) && <div className="w-2 h-2 rounded-full bg-white" />}
                          </div>
                          <div className="flex-1 min-w-0">
                            <p className="text-sm font-medium text-gray-900">{v.name}</p>
                            <p className="text-xs text-gray-400">
                              {v.serviceType}
                              {!v.hasPhone && " · Tidak ada nomor WA"}
                            </p>
                          </div>
                        </button>
                      ))}
                    </div>
                  )}

                  {rfqError && (
                    <div className="flex items-start gap-2 bg-red-50 rounded-xl p-3 text-sm text-red-600">
                      <AlertCircle className="w-4 h-4 flex-shrink-0 mt-0.5" />
                      <span>{rfqError}</span>
                    </div>
                  )}

                  <button
                    onClick={handleSendRfq}
                    disabled={sendingRfq || selectedVendorIds.length === 0}
                    className="w-full py-3 bg-blue-600 hover:bg-blue-700 active:bg-blue-800 text-white font-semibold rounded-xl transition-colors disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2 text-sm"
                  >
                    {sendingRfq ? (
                      <><Loader2 className="w-4 h-4 animate-spin" />Mengirim RFQ...</>
                    ) : (
                      <><Send className="w-4 h-4" />Kirim RFQ ke {selectedVendorIds.length > 0 ? `${selectedVendorIds.length} vendor` : "Vendor"}</>
                    )}
                  </button>
                </div>
              )}
            </div>
          ) : (
            data.quotes.map((q) => {
              const isSelected = selectedQuoteId === q.id;
              const isExpanded = expandedQuote === q.id;
              const suggested = calcSuggested(q);

              return (
                <div
                  key={q.id}
                  className={`bg-white rounded-2xl shadow-sm overflow-hidden border-2 transition-colors ${
                    isSelected ? "border-blue-500" : "border-transparent"
                  }`}
                >
                  <button
                    className="w-full text-left p-4"
                    onClick={() => {
                      if (isSelected) {
                        setExpandedQuote(isExpanded ? null : q.id);
                      } else {
                        onSelectQuote(q);
                      }
                    }}
                  >
                    <div className="flex items-start justify-between gap-2">
                      <div className="flex items-start gap-3">
                        <div className={`w-5 h-5 rounded-full border-2 mt-0.5 flex-shrink-0 flex items-center justify-center ${
                          isSelected ? "border-blue-500 bg-blue-500" : "border-gray-300"
                        }`}>
                          {isSelected && <div className="w-2 h-2 rounded-full bg-white" />}
                        </div>
                        <div>
                          <p className="font-semibold text-gray-900">{q.vendorName}</p>
                          <p className="text-xs text-gray-400 mt-0.5">
                            {q.replySource === "whatsapp" ? "Via WhatsApp" : "Via Portal"}
                            {q.quoteStatus === "approved" && " · ✅ Dipilih"}
                          </p>
                        </div>
                      </div>
                      <div className="text-right flex-shrink-0">
                        <p className="text-xs text-gray-400">Harga Vendor</p>
                        <p className="font-bold text-gray-900">{fmt(q.vendorPrice)}</p>
                        <p className="text-xs text-blue-600 mt-0.5">Jual ≈ {fmt(suggested)}</p>
                      </div>
                    </div>

                    {(q.estimatedDays || q.estimatedPickup || q.estimatedDelivery) && (
                      <div className="mt-2 ml-8 flex flex-wrap gap-2">
                        {q.estimatedDays && (
                          <span className="text-xs bg-gray-100 text-gray-600 px-2 py-0.5 rounded-full">
                            ⏱ {q.estimatedDays} hari
                          </span>
                        )}
                        {q.estimatedPickup && (
                          <span className="text-xs bg-gray-100 text-gray-600 px-2 py-0.5 rounded-full">
                            📦 Pickup: {q.estimatedPickup}
                          </span>
                        )}
                        {q.estimatedDelivery && (
                          <span className="text-xs bg-gray-100 text-gray-600 px-2 py-0.5 rounded-full">
                            🏁 Tiba: {q.estimatedDelivery}
                          </span>
                        )}
                      </div>
                    )}

                    {isSelected && (
                      <div className="ml-8 mt-1 flex items-center gap-1 text-xs text-gray-400">
                        {isExpanded ? <ChevronUp className="w-3 h-3" /> : <ChevronDown className="w-3 h-3" />}
                        {isExpanded ? "Sembunyikan detail" : "Lihat detail"}
                      </div>
                    )}
                  </button>

                  {isSelected && isExpanded && q.vendorNotes && (
                    <div className="px-4 pb-3 ml-8">
                      <p className="text-xs text-gray-500 bg-gray-50 rounded-lg p-2">
                        📝 {q.vendorNotes}
                      </p>
                    </div>
                  )}
                </div>
              );
            })
          )}
        </div>

        {/* Pending vendors — resend WA */}
        {data.pendingVendors?.length > 0 && (
          <div className="bg-white rounded-2xl shadow-sm p-4 space-y-3">
            <h3 className="font-semibold text-gray-700 text-sm uppercase tracking-wide flex items-center gap-2">
              <RefreshCw className="w-4 h-4 text-amber-500" />
              Vendor Belum Merespons ({data.pendingVendors.length})
            </h3>
            <p className="text-xs text-gray-400">Vendor berikut sudah menerima RFQ tapi belum mengirimkan penawaran. Klik untuk kirim ulang WA.</p>
            <div className="space-y-2">
              {data.pendingVendors.map((v) => {
                const isSending = resendingIds.has(v.id);
                const result = resendResults[v.id];
                return (
                  <div key={v.id} className="flex items-center justify-between gap-3 bg-amber-50 border border-amber-100 rounded-xl px-3 py-2.5">
                    <div className="min-w-0">
                      <p className="text-sm font-medium text-gray-900 truncate">{v.name}</p>
                      {!v.hasPhone && <p className="text-xs text-red-400">Tidak ada nomor WA</p>}
                    </div>
                    {result === "ok" ? (
                      <span className="text-xs text-green-600 font-medium flex items-center gap-1 flex-shrink-0">
                        <CheckCircle2 className="w-3.5 h-3.5" /> Terkirim
                      </span>
                    ) : result === "fail" ? (
                      <span className="text-xs text-red-500 font-medium flex items-center gap-1 flex-shrink-0">
                        <AlertCircle className="w-3.5 h-3.5" /> Gagal
                      </span>
                    ) : (
                      <button
                        onClick={() => handleResendWa(v.id)}
                        disabled={isSending || !v.hasPhone}
                        className="flex items-center gap-1.5 text-xs font-semibold text-blue-600 border border-blue-200 bg-blue-50 hover:bg-blue-100 px-3 py-1.5 rounded-lg transition-colors disabled:opacity-50 disabled:cursor-not-allowed flex-shrink-0"
                      >
                        {isSending ? (
                          <><Loader2 className="w-3.5 h-3.5 animate-spin" />Mengirim...</>
                        ) : (
                          <><Send className="w-3.5 h-3.5" />Kirim Ulang WA</>
                        )}
                      </button>
                    )}
                  </div>
                );
              })}
            </div>
          </div>
        )}

        {/* Selling price + approve */}
        {data.quotes.length > 0 && (
          <div className="bg-white rounded-2xl shadow-sm p-4 space-y-4">
            <h3 className="font-semibold text-gray-700 text-sm uppercase tracking-wide">Harga Jual ke Customer</h3>

            {!selectedQuoteId ? (
              <p className="text-sm text-gray-400">Pilih vendor di atas terlebih dahulu</p>
            ) : (
              <>
                {selectedQuote && (
                  <div className="bg-blue-50 rounded-xl p-3 text-sm space-y-1">
                    <div className="flex justify-between text-gray-600">
                      <span>Vendor terpilih</span>
                      <span className="font-medium">{selectedQuote.vendorName}</span>
                    </div>
                    <div className="flex justify-between text-gray-600">
                      <span>Harga vendor</span>
                      <span className="font-medium">{fmt(selectedQuote.vendorPrice)}</span>
                    </div>
                    <div className="flex justify-between text-gray-600">
                      <span>Markup ({selectedQuote.markupPercentage}%)</span>
                      <span className="font-medium">
                        {selectedQuote.markupType === "fixed_price"
                          ? "Fixed"
                          : fmt(selectedQuote.vendorPrice * selectedQuote.markupPercentage / 100)}
                      </span>
                    </div>
                  </div>
                )}

                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">
                    Harga Jual (Rp)
                  </label>
                  <div className="relative">
                    <span className="absolute left-3 top-1/2 -translate-y-1/2 text-sm font-bold text-yellow-500">Rp</span>
                    <input
                      type="number"
                      className="w-full border border-gray-300 rounded-xl pl-10 pr-4 py-3 text-gray-900 font-semibold text-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
                      value={sellingPrice}
                      onChange={(e) => setSellingPrice(e.target.value)}
                      placeholder="0"
                      min={0}
                    />
                  </div>
                  {sellingPrice && !isNaN(parseFloat(sellingPrice)) && (
                    <p className="text-xs text-gray-400 mt-1 ml-1">
                      = {fmt(parseFloat(sellingPrice))}
                    </p>
                  )}
                </div>

                {submitError && (
                  <div className="flex items-start gap-2 bg-red-50 rounded-xl p-3 text-sm text-red-600">
                    <AlertCircle className="w-4 h-4 flex-shrink-0 mt-0.5" />
                    <span>{submitError}</span>
                  </div>
                )}

                {isAlreadyApproved ? (
                  <div className="bg-green-50 rounded-xl p-4 text-center space-y-1">
                    <CheckCircle2 className="w-6 h-6 text-green-600 mx-auto" />
                    <p className="text-sm font-semibold text-green-700">Order sudah diapprove</p>
                    <p className="text-xs text-green-600">
                      Harga jual: {data.finalSellingPrice ? fmt(data.finalSellingPrice) : "-"}
                    </p>
                    <button
                      onClick={handleApprove}
                      disabled={submitting}
                      className="mt-2 w-full py-2 rounded-xl border border-green-500 text-green-700 text-sm font-medium hover:bg-green-100 transition-colors disabled:opacity-50 flex items-center justify-center gap-2"
                    >
                      {submitting && <Loader2 className="w-4 h-4 animate-spin" />}
                      Kirim Ulang ke Customer
                    </button>
                  </div>
                ) : (
                  <button
                    onClick={handleApprove}
                    disabled={submitting || !sellingPrice}
                    className="w-full py-4 bg-blue-600 hover:bg-blue-700 active:bg-blue-800 text-white font-semibold rounded-2xl transition-colors disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2 text-base shadow-lg shadow-blue-200"
                  >
                    {submitting ? (
                      <>
                        <Loader2 className="w-5 h-5 animate-spin" />
                        Mengirim...
                      </>
                    ) : (
                      <>
                        <CheckCircle2 className="w-5 h-5" />
                        Approve & Kirim ke Customer
                      </>
                    )}
                  </button>
                )}
              </>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

function InfoRow({ icon, label, value }: { icon: React.ReactNode; label: string; value: string }) {
  return (
    <div className="flex items-start gap-3">
      <span className="text-gray-400 mt-0.5 flex-shrink-0">{icon}</span>
      <div className="flex-1 min-w-0">
        <p className="text-xs text-gray-400">{label}</p>
        <p className="text-sm text-gray-800 font-medium break-words">{value}</p>
      </div>
    </div>
  );
}
