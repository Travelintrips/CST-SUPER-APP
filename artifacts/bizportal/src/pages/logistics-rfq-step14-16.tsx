import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import { Textarea } from "@/components/ui/textarea";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Send, Loader2, CheckCircle2, CircleDot, AlertCircle,
  FileText, Link2, Check, X, RefreshCw, ChevronDown, ChevronUp,
  ClipboardList, Truck, Package2,
} from "lucide-react";
import { useToast } from "@/hooks/use-toast";

// ─── Shared Helpers ───────────────────────────────────────────────────────────
const TRACKING_STATUSES = [
  { value: "RECEIVED_DATA",      label: "Data Diterima",        icon: "📥" },
  { value: "BOOKING_PROCESS",    label: "Proses Booking",       icon: "📋" },
  { value: "SCHEDULE_CONFIRMED", label: "Jadwal Terkonfirmasi", icon: "📅" },
  { value: "PICKUP_ARRANGED",    label: "Pickup Diatur",        icon: "🚛" },
  { value: "DOCUMENT_PROCESS",   label: "Proses Dokumen",       icon: "📄" },
  { value: "CUSTOMS_PROCESS",    label: "Proses Kepabeanan",    icon: "🏛️" },
  { value: "IN_TRANSIT",         label: "Dalam Perjalanan",     icon: "✈️" },
  { value: "DELIVERED",          label: "Terkirim",             icon: "📦" },
  { value: "COMPLETED",          label: "Selesai",              icon: "✅" },
];

// ─── Types ────────────────────────────────────────────────────────────────────
interface DataField {
  key: string;
  label: string;
  value: string | null;
  required: boolean;
  complete: boolean;
}

interface CustomerDataCheck {
  rfqId: number;
  orderId: number;
  orderNumber: string;
  customerName: string;
  shipmentType: string;
  fields: DataField[];
  allComplete: boolean;
  missingRequired: string[];
  customerDataSentAt: string | null;
  customerDataSentBy: string | null;
  customerDataRequestSentAt: string | null;
}

interface TrackingLog {
  status: string;
  label: string;
  notes: string | null;
  attachmentUrl: string | null;
  createdAt: string;
}

interface TrackingInfo {
  id: number;
  token: string;
  vendorId: number;
  vendorName: string;
  currentStatus: string;
  currentLabel: string;
  latestNotes: string | null;
  trackingLinkSentAt: string | null;
  completedAt: string | null;
  updatedAt: string;
  trackingUrl: string;
}

interface VendorTrackingData {
  tracking: TrackingInfo | null;
  logs: TrackingLog[];
  allStatuses: { value: string; label: string; reached: boolean }[];
}

// ─── Step 14: Customer Data Panel ────────────────────────────────────────────
export function Step14CustomerDataPanel({ rfqId }: { rfqId: number }) {
  const { toast } = useToast();
  const qc = useQueryClient();
  const [showFields, setShowFields] = useState(false);
  const [showRequestDialog, setShowRequestDialog] = useState(false);
  const [selectedMissing, setSelectedMissing] = useState<Set<string>>(new Set());
  const [customMsg, setCustomMsg] = useState("");

  const { data, isLoading, error } = useQuery<CustomerDataCheck>({
    queryKey: ["customer-data-check", rfqId],
    queryFn: async () => {
      const r = await fetch(`/api/logistic/rfq/${rfqId}/customer-data-check`, { credentials: "include" });
      if (!r.ok) throw new Error("Gagal load data customer");
      return r.json();
    },
  });

  const sendDataMutation = useMutation({
    mutationFn: async () => {
      const r = await fetch(`/api/logistic/rfq/${rfqId}/send-customer-data`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
      });
      const result = await r.json();
      if (!r.ok) throw new Error(result.message ?? "Gagal kirim data");
      return result;
    },
    onSuccess: (result) => {
      toast({ title: "Berhasil", description: result.message ?? "Data customer dikirim ke vendor" });
      qc.invalidateQueries({ queryKey: ["customer-data-check", rfqId] });
    },
    onError: (e: Error) => toast({ title: "Error", description: e.message, variant: "destructive" }),
  });

  const requestDataMutation = useMutation({
    mutationFn: async () => {
      const fields = selectedMissing.size > 0 ? Array.from(selectedMissing) : data?.missingRequired ?? [];
      const r = await fetch(`/api/logistic/rfq/${rfqId}/request-customer-data`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ missingFields: fields, customMessage: customMsg || undefined }),
      });
      const result = await r.json();
      if (!r.ok) throw new Error(result.message ?? "Gagal kirim permintaan");
      return result;
    },
    onSuccess: (result) => {
      toast({ title: "WA Terkirim", description: result.message ?? "Permintaan data dikirim ke customer" });
      setShowRequestDialog(false);
      qc.invalidateQueries({ queryKey: ["customer-data-check", rfqId] });
    },
    onError: (e: Error) => toast({ title: "Error", description: e.message, variant: "destructive" }),
  });

  const sendFormLinkMutation = useMutation({
    mutationFn: async () => {
      const fields = selectedMissing.size > 0 ? Array.from(selectedMissing) : data?.missingRequired ?? [];
      const r = await fetch(`/api/logistic/rfq/${rfqId}/request-customer-data-form`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ missingFields: fields, customMessage: customMsg || undefined }),
      });
      const result = await r.json();
      if (!r.ok) throw new Error(result.message ?? "Gagal kirim form link");
      return result;
    },
    onSuccess: (result) => {
      toast({ title: "Link Form Terkirim", description: result.message ?? "Link form data dikirim ke customer via WA" });
      setShowRequestDialog(false);
      qc.invalidateQueries({ queryKey: ["customer-data-check", rfqId] });
    },
    onError: (e: Error) => toast({ title: "Error", description: e.message, variant: "destructive" }),
  });

  if (isLoading) return <div className="h-20 animate-pulse bg-muted rounded-xl" />;
  if (error || !data) return null;

  const alreadySent = !!data.customerDataSentAt;
  const requestSent = !!data.customerDataRequestSentAt;

  return (
    <Card>
      <CardHeader className="pb-2 pt-4">
        <CardTitle className="text-sm flex items-center gap-2">
          <ClipboardList className="h-4 w-4 text-blue-500" />
          Step 14 — Data Master Customer ke Vendor
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        {/* Status sent */}
        {alreadySent && (
          <div className="flex items-center gap-2 bg-green-50 border border-green-200 rounded-xl px-3 py-2 text-xs text-green-700">
            <CheckCircle2 className="h-3.5 w-3.5 text-green-500 shrink-0" />
            <span>Data customer telah dikirim ke vendor pada{" "}
              <strong>{new Date(data.customerDataSentAt!).toLocaleString("id-ID")}</strong>
            </span>
          </div>
        )}

        {/* Completeness summary */}
        <div className={`flex items-center gap-2 rounded-xl px-3 py-2 text-xs ${
          data.allComplete
            ? "bg-green-50 border border-green-200 text-green-700"
            : "bg-amber-50 border border-amber-200 text-amber-700"
        }`}>
          {data.allComplete
            ? <CheckCircle2 className="h-3.5 w-3.5 text-green-500 shrink-0" />
            : <AlertCircle className="h-3.5 w-3.5 text-amber-500 shrink-0" />
          }
          <span>
            {data.allComplete
              ? "Semua data wajib sudah lengkap"
              : `Data belum lengkap: ${data.missingRequired.join(", ")}`
            }
          </span>
        </div>

        {/* Field detail toggle */}
        <button
          className="w-full flex items-center justify-between text-xs text-muted-foreground hover:text-foreground px-1"
          onClick={() => setShowFields((v) => !v)}
        >
          <span>Lihat detail data ({data.fields.length} field)</span>
          {showFields ? <ChevronUp className="h-3 w-3" /> : <ChevronDown className="h-3 w-3" />}
        </button>

        {showFields && (
          <div className="border rounded-xl overflow-hidden">
            <table className="w-full text-xs">
              <tbody>
                {data.fields.map((f) => (
                  <tr key={f.key} className={`border-b last:border-b-0 ${!f.complete && f.required ? "bg-red-50" : f.complete ? "" : "bg-muted/20"}`}>
                    <td className="px-3 py-2 text-muted-foreground font-medium w-40 shrink-0">
                      {f.label}
                      {f.required && <span className="text-red-400 ml-0.5">*</span>}
                    </td>
                    <td className="px-3 py-2">
                      {f.complete ? (
                        <span className="text-foreground">{f.value}</span>
                      ) : (
                        <span className="text-muted-foreground italic">— belum diisi</span>
                      )}
                    </td>
                    <td className="px-3 py-2 text-right">
                      {f.complete
                        ? <Check className="h-3 w-3 text-green-500 inline" />
                        : f.required
                          ? <X className="h-3 w-3 text-red-400 inline" />
                          : <span className="text-muted-foreground">—</span>
                      }
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        {/* Action buttons */}
        <div className="flex gap-2 flex-wrap">
          {!data.allComplete && (
            <Button
              variant="outline"
              size="sm"
              className="h-8 text-xs border-amber-300 text-amber-700 hover:bg-amber-50"
              onClick={() => {
                setSelectedMissing(new Set(data.missingRequired));
                setShowRequestDialog(true);
              }}
            >
              <Send className="h-3 w-3 mr-1.5" />
              {requestSent ? "Kirim Ulang WA ke Customer" : "Minta Data via WA"}
            </Button>
          )}

          <Button
            size="sm"
            className="h-8 text-xs"
            onClick={() => sendDataMutation.mutate()}
            disabled={sendDataMutation.isPending}
          >
            {sendDataMutation.isPending
              ? <><Loader2 className="h-3 w-3 mr-1.5 animate-spin" />Mengirim...</>
              : <><FileText className="h-3 w-3 mr-1.5" />{alreadySent ? "Kirim Ulang Data ke Vendor" : "Kirim Data ke Vendor"}</>
            }
          </Button>
        </div>

        {requestSent && (
          <p className="text-[11px] text-muted-foreground">
            Permintaan data terakhir dikirim:{" "}
            {new Date(data.customerDataRequestSentAt!).toLocaleString("id-ID")}
          </p>
        )}
      </CardContent>

      {/* Request dialog */}
      <Dialog open={showRequestDialog} onOpenChange={setShowRequestDialog}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle className="text-sm">Minta Data Customer via WA</DialogTitle>
          </DialogHeader>
          <div className="space-y-3 text-sm">
            <p className="text-xs text-muted-foreground">Pilih data yang akan diminta:</p>
            <div className="space-y-2 max-h-40 overflow-y-auto">
              {[...data.missingRequired, ...data.fields.filter((f) => !f.complete && !f.required).map((f) => f.label)].map((label) => (
                <label key={label} className="flex items-center gap-2 cursor-pointer text-xs">
                  <Checkbox
                    checked={selectedMissing.has(label)}
                    onCheckedChange={(v) => {
                      setSelectedMissing((prev) => {
                        const next = new Set(prev);
                        if (v) next.add(label); else next.delete(label);
                        return next;
                      });
                    }}
                  />
                  {label}
                </label>
              ))}
            </div>
            <div>
              <p className="text-xs text-muted-foreground mb-1">Pesan tambahan (opsional):</p>
              <Textarea
                value={customMsg}
                onChange={(e) => setCustomMsg(e.target.value)}
                placeholder="Tambahkan instruksi khusus..."
                rows={2}
                className="text-xs resize-none"
              />
            </div>
          </div>
          <DialogFooter className="flex-col sm:flex-row gap-2">
            <Button variant="outline" size="sm" onClick={() => setShowRequestDialog(false)}>Batal</Button>
            <Button
              variant="outline"
              size="sm"
              onClick={() => requestDataMutation.mutate()}
              disabled={requestDataMutation.isPending || sendFormLinkMutation.isPending}
            >
              {requestDataMutation.isPending && <Loader2 className="h-3 w-3 mr-1.5 animate-spin" />}
              Kirim Teks WA
            </Button>
            <Button
              size="sm"
              onClick={() => sendFormLinkMutation.mutate()}
              disabled={sendFormLinkMutation.isPending || requestDataMutation.isPending}
            >
              {sendFormLinkMutation.isPending && <Loader2 className="h-3 w-3 mr-1.5 animate-spin" />}
              <Send className="h-3 w-3 mr-1.5" />
              Kirim Link Form
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </Card>
  );
}

// ─── Step 15-16: Vendor Tracking Panel ───────────────────────────────────────
export function Step1516VendorTrackingPanel({ rfqId }: { rfqId: number }) {
  const { toast } = useToast();
  const qc = useQueryClient();
  const [showComplete, setShowComplete] = useState(false);
  const [invoiceNotes, setInvoiceNotes] = useState("");
  const [dueInDays, setDueInDays] = useState("14");

  const { data, isLoading } = useQuery<VendorTrackingData>({
    queryKey: ["vendor-tracking-admin", rfqId],
    queryFn: async () => {
      const r = await fetch(`/api/logistic/rfq/${rfqId}/vendor-tracking`, { credentials: "include" });
      if (!r.ok) throw new Error("Gagal load tracking");
      return r.json();
    },
  });

  const sendLinkMutation = useMutation({
    mutationFn: async () => {
      const r = await fetch(`/api/logistic/rfq/${rfqId}/send-tracking-link`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
      });
      const result = await r.json();
      if (!r.ok) throw new Error(result.message ?? "Gagal kirim link");
      return result;
    },
    onSuccess: (result) => {
      toast({
        title: "Link Tracking Terkirim",
        description: result.message ?? "Link update progress berhasil dikirim ke vendor",
      });
      qc.invalidateQueries({ queryKey: ["vendor-tracking-admin", rfqId] });
    },
    onError: (e: Error) => toast({ title: "Error", description: e.message, variant: "destructive" }),
  });

  const completeMutation = useMutation({
    mutationFn: async () => {
      const r = await fetch(`/api/logistic/rfq/${rfqId}/complete-order`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({
          generateInvoice: true,
          invoiceNotes: invoiceNotes || undefined,
          dueInDays: Number(dueInDays) || 14,
        }),
      });
      const result = await r.json();
      if (!r.ok) throw new Error(result.message ?? "Gagal selesaikan order");
      return result;
    },
    onSuccess: (result) => {
      toast({
        title: "Order Diselesaikan!",
        description: result.message ?? `Invoice ${result.invoiceNumber} telah dibuat`,
      });
      setShowComplete(false);
      qc.invalidateQueries({ queryKey: ["vendor-tracking-admin", rfqId] });
      qc.invalidateQueries({ queryKey: ["rfq-detail-v2"] });
    },
    onError: (e: Error) => toast({ title: "Error", description: e.message, variant: "destructive" }),
  });

  const tracking = data?.tracking ?? null;
  const logs = data?.logs ?? [];
  const allStatuses = data?.allStatuses ?? [];
  const isCompleted = !!tracking?.completedAt;

  if (isLoading) return <div className="h-20 animate-pulse bg-muted rounded-xl" />;

  return (
    <Card>
      <CardHeader className="pb-2 pt-4">
        <CardTitle className="text-sm flex items-center gap-2">
          <Truck className="h-4 w-4 text-orange-500" />
          Step 15-16 — Tracking Vendor & Penyelesaian
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        {/* Send tracking link button */}
        {!tracking?.trackingLinkSentAt ? (
          <div className="space-y-2">
            <p className="text-xs text-muted-foreground">
              Kirim link form update progress ke vendor agar mereka bisa mengupdate status pengiriman.
            </p>
            <Button
              size="sm"
              className="h-8 text-xs"
              onClick={() => sendLinkMutation.mutate()}
              disabled={sendLinkMutation.isPending}
            >
              {sendLinkMutation.isPending
                ? <><Loader2 className="h-3 w-3 mr-1.5 animate-spin" />Mengirim...</>
                : <><Link2 className="h-3 w-3 mr-1.5" />Kirim Link Tracking ke Vendor</>
              }
            </Button>
          </div>
        ) : (
          <div className="flex items-center justify-between gap-2">
            <div className="flex items-center gap-2 text-xs text-green-700 bg-green-50 border border-green-200 rounded-xl px-3 py-2 flex-1">
              <CheckCircle2 className="h-3.5 w-3.5 shrink-0" />
              <span>Link tracking dikirim ke vendor</span>
            </div>
            <Button
              variant="ghost"
              size="sm"
              className="h-8 text-xs shrink-0"
              onClick={() => sendLinkMutation.mutate()}
              disabled={sendLinkMutation.isPending}
            >
              <RefreshCw className={`h-3 w-3 ${sendLinkMutation.isPending ? "animate-spin" : ""}`} />
            </Button>
          </div>
        )}

        {/* Tracking link URL */}
        {tracking?.trackingUrl && (
          <div className="bg-muted/30 rounded-xl px-3 py-2">
            <p className="text-[10px] text-muted-foreground mb-0.5">Link vendor (readonly):</p>
            <a
              href={tracking.trackingUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="text-xs text-blue-600 hover:underline break-all"
            >
              {tracking.trackingUrl}
            </a>
          </div>
        )}

        {/* Current status */}
        {tracking && (
          <div className={`rounded-xl px-3 py-2.5 text-sm font-medium ${
            isCompleted
              ? "bg-green-50 border border-green-200 text-green-800"
              : "bg-blue-50 border border-blue-200 text-blue-800"
          }`}>
            <div className="flex items-center gap-2">
              <span className="text-lg">{TRACKING_STATUSES.find((s) => s.value === tracking.currentStatus)?.icon ?? "📍"}</span>
              <div>
                <span className="font-semibold">{tracking.currentLabel}</span>
                {tracking.latestNotes && <p className="text-xs opacity-80 mt-0.5">{tracking.latestNotes}</p>}
              </div>
            </div>
          </div>
        )}

        {/* Progress timeline */}
        {allStatuses.length > 0 && (
          <div className="space-y-1">
            <p className="text-[10px] font-semibold uppercase tracking-widest text-muted-foreground">Progress</p>
            <div className="flex flex-wrap gap-1">
              {allStatuses.map((s) => (
                <Badge
                  key={s.value}
                  variant={s.reached ? "default" : "outline"}
                  className={`text-[10px] px-2 py-0.5 ${
                    s.reached
                      ? "bg-green-100 text-green-800 border-green-300 hover:bg-green-100"
                      : "text-muted-foreground"
                  }`}
                >
                  {TRACKING_STATUSES.find((st) => st.value === s.value)?.icon} {s.label}
                </Badge>
              ))}
            </div>
          </div>
        )}

        {/* Tracking logs */}
        {logs.length > 0 && (
          <div className="border rounded-xl overflow-hidden">
            <div className="px-3 py-2 bg-muted/30 text-[10px] font-semibold uppercase tracking-widest text-muted-foreground">
              Riwayat Update Vendor
            </div>
            <div className="divide-y max-h-48 overflow-y-auto">
              {[...logs].reverse().map((log, i) => (
                <div key={i} className="px-3 py-2 flex items-start gap-2 text-xs">
                  <span className="text-base leading-none mt-0.5 shrink-0">
                    {TRACKING_STATUSES.find((s) => s.value === log.status)?.icon ?? "•"}
                  </span>
                  <div className="flex-1 min-w-0">
                    <span className="font-medium text-foreground">{log.label}</span>
                    {log.notes && <p className="text-muted-foreground mt-0.5">{log.notes}</p>}
                  </div>
                  <span className="text-muted-foreground shrink-0 text-[10px]">
                    {new Date(log.createdAt).toLocaleString("id-ID", { dateStyle: "short", timeStyle: "short" })}
                  </span>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Step 16: Complete Order */}
        {!isCompleted ? (
          <Button
            size="sm"
            className="w-full h-8 text-xs bg-green-600 hover:bg-green-700 text-white"
            onClick={() => setShowComplete(true)}
          >
            <Package2 className="h-3.5 w-3.5 mr-1.5" />
            Selesaikan Order & Buat Invoice
          </Button>
        ) : (
          <div className="bg-green-50 border border-green-200 rounded-xl px-3 py-2 text-xs text-green-700 flex items-center gap-2">
            <CheckCircle2 className="h-3.5 w-3.5 shrink-0" />
            Order selesai pada{" "}
            {new Date(tracking!.completedAt!).toLocaleString("id-ID")}
          </div>
        )}

        {/* Complete dialog */}
        <Dialog open={showComplete} onOpenChange={setShowComplete}>
          <DialogContent className="max-w-sm">
            <DialogHeader>
              <DialogTitle className="text-sm">Selesaikan Order & Buat Invoice</DialogTitle>
            </DialogHeader>
            <div className="space-y-3 text-sm">
              <div className="bg-amber-50 border border-amber-200 rounded-xl px-3 py-2 text-xs text-amber-800">
                <strong>Yang akan terjadi:</strong>
                <ul className="mt-1 space-y-0.5 list-disc list-inside">
                  <li>Status order diubah ke <strong>Completed</strong></li>
                  <li>Data profitabilitas disimpan ke freight_shipments</li>
                  <li>Invoice customer dibuat otomatis</li>
                  <li>Invoice dikirim ke customer via WA</li>
                  <li>Notifikasi dikirim ke admin group</li>
                </ul>
              </div>
              <div className="space-y-1">
                <label className="text-xs font-medium">Catatan Invoice (opsional)</label>
                <Textarea
                  value={invoiceNotes}
                  onChange={(e) => setInvoiceNotes(e.target.value)}
                  placeholder="Catatan untuk invoice customer..."
                  rows={2}
                  className="text-xs resize-none"
                />
              </div>
              <div className="space-y-1">
                <label className="text-xs font-medium">Jatuh Tempo Pembayaran</label>
                <select
                  value={dueInDays}
                  onChange={(e) => setDueInDays(e.target.value)}
                  className="w-full border rounded-lg px-3 py-2 text-xs bg-background"
                >
                  <option value="7">7 hari</option>
                  <option value="14">14 hari</option>
                  <option value="30">30 hari</option>
                  <option value="45">45 hari</option>
                </select>
              </div>
            </div>
            <DialogFooter>
              <Button variant="outline" size="sm" onClick={() => setShowComplete(false)}>Batal</Button>
              <Button
                size="sm"
                className="bg-green-600 hover:bg-green-700 text-white"
                onClick={() => completeMutation.mutate()}
                disabled={completeMutation.isPending}
              >
                {completeMutation.isPending && <Loader2 className="h-3 w-3 mr-1.5 animate-spin" />}
                Ya, Selesaikan
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </CardContent>
    </Card>
  );
}

// ─── Combined Step 14-16 Panel ────────────────────────────────────────────────
export function Step1416Panel({ rfqId, rfqStatus }: { rfqId: number; rfqStatus: string }) {
  const ACTIVE_STATUSES = ["customer_approved", "closed"];
  if (!ACTIVE_STATUSES.includes(rfqStatus)) return null;

  return (
    <div className="space-y-3">
      <div className="flex items-center gap-2">
        <div className="h-px flex-1 bg-border" />
        <span className="text-[10px] font-semibold uppercase tracking-widest text-muted-foreground px-2">
          Operasional Pasca-Approval
        </span>
        <div className="h-px flex-1 bg-border" />
      </div>

      <Step14CustomerDataPanel rfqId={rfqId} />
      <Step1516VendorTrackingPanel rfqId={rfqId} />
    </div>
  );
}
