import { useState, useEffect } from "react";
import { useRoute } from "wouter";
import { useQuery } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Separator } from "@/components/ui/separator";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { PlaneTakeoff, CheckCircle2, AlertCircle, Loader2, Upload, ArrowLeft } from "lucide-react";

const IDR = (v: string | number | null | undefined) =>
  v ? `Rp ${Number(v).toLocaleString("id-ID")}` : "-";

const n = (v: any) => parseFloat(v ?? "0") || 0;

function Field({ label, required, children }: {
  label: string; required?: boolean; children: React.ReactNode;
}) {
  return (
    <div className="space-y-1">
      <Label className="text-sm font-medium">
        {label} {required && <span className="text-red-500">*</span>}
      </Label>
      {children}
    </div>
  );
}

function InfoRow({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="flex justify-between py-1.5 border-b border-slate-100 last:border-0">
      <span className="text-sm text-slate-500">{label}</span>
      <span className="text-sm font-medium text-slate-800">{value ?? "-"}</span>
    </div>
  );
}

export default function AirFreightVendorFormPage() {
  const [, params] = useRoute("/air-freight-form/:token");
  const token = params?.token ?? "";

  const [form, setForm] = useState({
    airline: "",
    flightNumber: "",
    etd: "",
    eta: "",
    transitDays: "",
    isDirect: "true",
    currency: "IDR",
    exchangeRate: "1",
    ratePerKg: "",
    fuelSurcharge: "0",
    securitySurcharge: "0",
    awbFee: "0",
    handlingFee: "0",
    xrayFee: "0",
    docFee: "0",
    customsClearanceFee: "0",
    pickupTrucking: "0",
    deliveryTrucking: "0",
    cargoSurcharge: "0",
    validityDate: "",
    notes: "",
  });

  const [uploading, setUploading] = useState(false);
  const [attachmentUrl, setAttachmentUrl] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [submitted, setSubmitted] = useState(false);
  const [error, setError] = useState("");

  const { data, isLoading, error: loadError } = useQuery({
    queryKey: ["air-freight-vendor-form", token],
    queryFn: async () => {
      const r = await fetch(`/api/air-freight-form/${token}`);
      if (!r.ok) {
        const err = await r.json().catch(() => ({ error: "Error" }));
        throw new Error(err.error ?? "Gagal memuat form");
      }
      return r.json();
    },
    enabled: !!token,
    retry: false,
  });

  useEffect(() => {
    if (data?.submission?.status === "submitted" || data?.submission?.status === "selected") {
      setSubmitted(true);
    }
  }, [data]);

  const set = (k: string, v: string) => setForm(f => ({ ...f, [k]: v }));

  const cw = n(data?.order?.chargeableWeight);
  const exchRate = n(form.currency === "IDR" ? "1" : form.exchangeRate);
  const rateIDR = n(form.ratePerKg) * (form.currency === "IDR" ? 1 : exchRate);
  const freightIDR = rateIDR * cw;
  const surcharges = n(form.fuelSurcharge) + n(form.securitySurcharge) + n(form.cargoSurcharge);
  const fees = n(form.awbFee) + n(form.handlingFee) + n(form.xrayFee) + n(form.docFee)
    + n(form.customsClearanceFee) + n(form.pickupTrucking) + n(form.deliveryTrucking);
  const totalIDR = freightIDR + surcharges + fees;

  const handleUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setUploading(true);
    try {
      const fd = new FormData();
      fd.append("file", file);
      const r = await fetch(`/api/air-freight-form/${token}/upload`, { method: "POST", body: fd });
      if (!r.ok) throw new Error(await r.text());
      const { url } = await r.json();
      setAttachmentUrl(url);
    } catch (e: any) {
      setError("Upload gagal: " + e.message);
    } finally {
      setUploading(false);
    }
  };

  const handleSubmit = async () => {
    if (!form.ratePerKg) { setError("Rate/kg wajib diisi"); return; }
    setSubmitting(true);
    setError("");
    try {
      const r = await fetch(`/api/air-freight-form/${token}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...form, totalIDR: String(Math.round(totalIDR)), attachmentUrl }),
      });
      if (!r.ok) {
        const err = await r.json().catch(() => ({ error: "Gagal submit" }));
        throw new Error(err.error ?? "Gagal submit");
      }
      setSubmitted(true);
    } catch (e: any) {
      setError(e.message);
    } finally {
      setSubmitting(false);
    }
  };

  if (isLoading) {
    return (
      <div className="min-h-screen bg-slate-50 flex items-center justify-center">
        <div className="flex items-center gap-3 text-slate-500">
          <Loader2 className="h-5 w-5 animate-spin" />
          <span>Memuat form...</span>
        </div>
      </div>
    );
  }

  if (loadError) {
    return (
      <div className="min-h-screen bg-slate-50 flex items-center justify-center p-6">
        <Card className="w-full max-w-md">
          <CardContent className="pt-8 pb-8 text-center space-y-3">
            <AlertCircle className="h-12 w-12 text-red-400 mx-auto" />
            <h2 className="text-lg font-semibold text-slate-800">Link Tidak Valid</h2>
            <p className="text-sm text-slate-500">{(loadError as Error).message}</p>
          </CardContent>
        </Card>
      </div>
    );
  }

  if (submitted) {
    return (
      <div className="min-h-screen bg-slate-50 flex items-center justify-center p-6">
        <Card className="w-full max-w-md">
          <CardContent className="pt-8 pb-8 text-center space-y-4">
            <CheckCircle2 className="h-14 w-14 text-green-500 mx-auto" />
            <h2 className="text-xl font-semibold text-slate-800">Penawaran Diterima</h2>
            <p className="text-sm text-slate-500">
              Terima kasih! Penawaran rate Anda untuk RFQ <strong>{data?.rfq?.rfqNumber}</strong> sudah kami terima.
              Kami akan menghubungi Anda jika penawaran dipilih.
            </p>
            <div className="rounded-lg bg-slate-50 border p-4 text-left space-y-1 mt-2">
              <InfoRow label="No. RFQ" value={data?.rfq?.rfqNumber} />
              <InfoRow label="Order" value={data?.order?.orderNumber} />
              <InfoRow label="Rute" value={`${data?.order?.originAirport} → ${data?.order?.destAirport}`} />
              <InfoRow label="Total IDR" value={IDR(totalIDR || data?.submission?.totalIDR)} />
            </div>
          </CardContent>
        </Card>
      </div>
    );
  }

  const { order, rfq, vendorName } = data ?? {};

  return (
    <div className="min-h-screen bg-slate-50 py-8 px-4">
      <div className="max-w-2xl mx-auto space-y-6">
        {/* Header */}
        <div className="text-center space-y-2">
          <div className="flex h-14 w-14 items-center justify-center rounded-2xl bg-sky-600 text-white mx-auto">
            <PlaneTakeoff className="h-7 w-7" />
          </div>
          <h1 className="text-2xl font-bold text-slate-900">Form Penawaran Air Freight</h1>
          <p className="text-sm text-slate-500">
            {vendorName && <strong>{vendorName} — </strong>}
            RFQ <strong>{rfq?.rfqNumber}</strong>
          </p>
          {rfq?.responseDeadline && (
            <p className="text-xs text-orange-600 font-medium">
              ⏰ Deadline: {new Date(rfq.responseDeadline).toLocaleString("id-ID", { dateStyle: "full", timeStyle: "short" })}
            </p>
          )}
        </div>

        {/* Order Summary */}
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-slate-500 uppercase tracking-wide">Detail Permintaan</CardTitle>
          </CardHeader>
          <CardContent>
            <InfoRow label="No. Order" value={order?.orderNumber} />
            <InfoRow label="Rute" value={`${order?.originAirport} → ${order?.destAirport}`} />
            <InfoRow label="Trade Type" value={order?.tradeType} />
            <InfoRow label="Cargo Type" value={order?.cargoType} />
            <InfoRow label="Komoditi" value={order?.commodity} />
            <InfoRow label="Jumlah Koli" value={order?.pieces ? `${order.pieces} pcs` : null} />
            <InfoRow label="Gross Weight" value={order?.grossWeight ? `${n(order.grossWeight).toLocaleString("id-ID")} kg` : null} />
            <InfoRow label="Chargeable Weight" value={order?.chargeableWeight
              ? <span className="font-semibold text-orange-700">{n(order.chargeableWeight).toLocaleString("id-ID")} kg</span>
              : null} />
            <InfoRow label="ETD Requested" value={order?.etdRequested} />
            {(order?.additionalServices ?? []).length > 0 && (
              <InfoRow label="Layanan Tambahan" value={(order.additionalServices ?? []).join(", ")} />
            )}
          </CardContent>
        </Card>

        {/* Rate Form */}
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-slate-500 uppercase tracking-wide">Detail Penerbangan</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="grid grid-cols-2 gap-4">
              <Field label="Airline" required>
                <Input value={form.airline} onChange={(e) => set("airline", e.target.value)} placeholder="e.g. Garuda Indonesia" />
              </Field>
              <Field label="Flight Number">
                <Input value={form.flightNumber} onChange={(e) => set("flightNumber", e.target.value)} placeholder="e.g. GA-401" />
              </Field>
              <Field label="ETD (Departure)" required>
                <Input value={form.etd} onChange={(e) => set("etd", e.target.value)} placeholder="e.g. 2026-07-01" />
              </Field>
              <Field label="ETA (Arrival)" required>
                <Input value={form.eta} onChange={(e) => set("eta", e.target.value)} placeholder="e.g. 2026-07-01" />
              </Field>
              <Field label="Transit Days">
                <Input value={form.transitDays} onChange={(e) => set("transitDays", e.target.value)} type="number" min="0" placeholder="0 = direct" />
              </Field>
              <Field label="Direct / Transit">
                <Select value={form.isDirect} onValueChange={(v) => set("isDirect", v)}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="true">Direct</SelectItem>
                    <SelectItem value="false">Via Transit</SelectItem>
                  </SelectContent>
                </Select>
              </Field>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-slate-500 uppercase tracking-wide">Rate & Biaya</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="grid grid-cols-2 gap-4">
              <Field label="Mata Uang">
                <Select value={form.currency} onValueChange={(v) => set("currency", v)}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="IDR">IDR</SelectItem>
                    <SelectItem value="USD">USD</SelectItem>
                    <SelectItem value="SGD">SGD</SelectItem>
                    <SelectItem value="EUR">EUR</SelectItem>
                  </SelectContent>
                </Select>
              </Field>
              {form.currency !== "IDR" && (
                <Field label="Exchange Rate (ke IDR)">
                  <Input value={form.exchangeRate} onChange={(e) => set("exchangeRate", e.target.value)} type="number" />
                </Field>
              )}
              <Field label={`Rate per kg (${form.currency})`} required>
                <Input value={form.ratePerKg} onChange={(e) => set("ratePerKg", e.target.value)} type="number" placeholder="0" className="font-semibold" />
              </Field>
            </div>

            <Separator />
            <p className="text-xs font-semibold text-slate-400 uppercase tracking-wide">Surcharge & Fee (IDR)</p>

            <div className="grid grid-cols-2 gap-3">
              {[
                ["Fuel Surcharge", "fuelSurcharge"],
                ["Security Surcharge", "securitySurcharge"],
                ["AWB Fee", "awbFee"],
                ["Handling Fee", "handlingFee"],
                ["X-Ray Fee", "xrayFee"],
                ["Doc Fee", "docFee"],
                ["Customs Clearance", "customsClearanceFee"],
                ["Pickup Trucking", "pickupTrucking"],
                ["Delivery Trucking", "deliveryTrucking"],
                ["Cargo Surcharge", "cargoSurcharge"],
              ].map(([label, key]) => (
                <Field key={key} label={label}>
                  <Input
                    value={(form as any)[key]}
                    onChange={(e) => set(key, e.target.value)}
                    type="number"
                    min="0"
                    placeholder="0"
                    className="h-8 text-sm"
                  />
                </Field>
              ))}
            </div>

            {/* Total Calculation */}
            {(n(form.ratePerKg) > 0 || n(form.fuelSurcharge) > 0) && (
              <div className="rounded-xl bg-sky-50 border border-sky-200 p-4 space-y-1.5">
                <p className="text-xs font-semibold text-sky-600 uppercase tracking-wide mb-2">Estimasi Total</p>
                <div className="flex justify-between text-sm">
                  <span className="text-slate-600">Freight ({n(form.ratePerKg).toLocaleString("id-ID")} {form.currency} × {cw} kg)</span>
                  <span className="font-mono">{IDR(freightIDR)}</span>
                </div>
                <div className="flex justify-between text-sm">
                  <span className="text-slate-600">Surcharges</span>
                  <span className="font-mono">{IDR(surcharges)}</span>
                </div>
                <div className="flex justify-between text-sm">
                  <span className="text-slate-600">Fees</span>
                  <span className="font-mono">{IDR(fees)}</span>
                </div>
                <Separator />
                <div className="flex justify-between text-base font-bold text-sky-800">
                  <span>Total IDR</span>
                  <span>{IDR(totalIDR)}</span>
                </div>
              </div>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-slate-500 uppercase tracking-wide">Informasi Tambahan</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <Field label="Berlaku s/d (Validity Date)">
              <Input value={form.validityDate} onChange={(e) => set("validityDate", e.target.value)} placeholder="e.g. 2026-07-31" />
            </Field>
            <Field label="Catatan">
              <Textarea value={form.notes} onChange={(e) => set("notes", e.target.value)} rows={3} placeholder="Informasi tambahan, syarat & ketentuan, dll." />
            </Field>

            {/* Attachment */}
            <Field label="Lampiran Quote (PDF/Image, opsional)">
              <div className="flex items-center gap-3">
                <label className="flex-1 cursor-pointer">
                  <input type="file" className="hidden" accept=".pdf,.jpg,.jpeg,.png" onChange={handleUpload} disabled={uploading} />
                  <div className="flex items-center gap-2 border rounded-lg px-4 py-2 hover:bg-slate-50 text-sm text-slate-600">
                    <Upload className="h-4 w-4" />
                    {uploading ? "Mengupload..." : attachmentUrl ? "Ganti file" : "Pilih file"}
                  </div>
                </label>
                {attachmentUrl && (
                  <a href={attachmentUrl} target="_blank" rel="noreferrer" className="text-sm text-sky-600 hover:underline">
                    Lihat file →
                  </a>
                )}
              </div>
            </Field>
          </CardContent>
        </Card>

        {error && (
          <div className="rounded-lg bg-red-50 border border-red-200 p-3 flex items-center gap-2 text-sm text-red-700">
            <AlertCircle className="h-4 w-4 flex-shrink-0" />
            {error}
          </div>
        )}

        <Button
          onClick={handleSubmit}
          disabled={submitting || !form.ratePerKg}
          className="w-full h-12 text-base"
          size="lg"
        >
          {submitting ? (
            <><Loader2 className="h-4 w-4 mr-2 animate-spin" /> Mengirim Penawaran...</>
          ) : (
            <><CheckCircle2 className="h-4 w-4 mr-2" /> Submit Penawaran Rate</>
          )}
        </Button>

        <p className="text-center text-xs text-slate-400 pb-4">
          Form ini khusus untuk vendor yang menerima undangan RFQ dari B2B Marketplace and Logistic
        </p>
      </div>
    </div>
  );
}
