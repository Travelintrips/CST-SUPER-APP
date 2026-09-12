import { DatePicker } from "@/components/ui/date-picker";
import { useState } from "react";
import { useParams, useLocation, Link } from "wouter";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { AppShell } from "@/components/layout/AppShell";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { LoadingSkeleton } from "@/components/ui/loading-skeleton";
import { QueryState } from "@/components/ui/query-state";
import { Separator } from "@/components/ui/separator";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter,
} from "@/components/ui/dialog";
import { TemplateSnapshotCard } from "@/components/TemplateSnapshotCard";
import { EscrowPanel } from "@/components/sales/EscrowPanel";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import {
  useGetSalesDocument,
  useSalesDocumentAction,
  useDeleteSalesDocument,
  getGetSalesDocumentQueryKey,
  getListSalesDocumentsQueryKey,
  useListAccountingPayments,
  getListAccountingPaymentsQueryKey,
  useCreateAccountingPayment,
  useVoidAccountingPayment,
  useListJournals,
} from "@workspace/api-client-react";
import { useToast } from "@/hooks/use-toast";
import {
  ArrowLeft, FileEdit, Printer, CheckCircle, Send, XCircle,
  Truck, Receipt, User, Calendar, MapPin, Package, FileText,
  Clock, Loader2, Trash2, ExternalLink, PlusCircle, Ban,
  CreditCard, AlertCircle, History, CircleDot, SquareArrowOutUpRight, Bell,
  Upload, Eye, RefreshCw,
} from "lucide-react";

// ── Helpers ──────────────────────────────────────────────────────────────────

const idr = (n: number | string | null | undefined) =>
  n == null
    ? "—"
    : `Rp ${Math.round(Number(n)).toLocaleString("id-ID")}`;

const dateStr = (s: string | null | undefined) =>
  s
    ? new Date(s).toLocaleDateString("id-ID", {
        day: "numeric",
        month: "long",
        year: "numeric",
      })
    : "—";

const dateTimeStr = (s: string | null | undefined) =>
  s
    ? new Date(s).toLocaleString("id-ID", {
        day: "numeric",
        month: "short",
        year: "numeric",
        hour: "2-digit",
        minute: "2-digit",
      })
    : "—";

const todayIso = () => new Date().toISOString().split("T")[0]!;

// ── Status config ─────────────────────────────────────────────────────────────

const STATUS_LABELS: Record<string, string> = {
  draft: "Draft",
  sent: "Terkirim",
  confirmed: "Dikonfirmasi",
  done: "Selesai",
  cancelled: "Dibatalkan",
};

const STATUS_COLORS: Record<string, string> = {
  draft: "bg-slate-100 text-slate-700 border-slate-200",
  sent: "bg-blue-100 text-blue-700 border-blue-200",
  confirmed: "bg-emerald-100 text-emerald-700 border-emerald-200",
  done: "bg-green-100 text-green-800 border-green-200",
  cancelled: "bg-red-100 text-red-700 border-red-200",
};

const PAYMENT_LABELS: Record<string, string> = {
  unpaid: "Belum Bayar",
  partial: "Sebagian",
  paid: "Lunas",
  overdue: "Jatuh Tempo",
};

const PAYMENT_COLORS: Record<string, string> = {
  unpaid: "bg-amber-100 text-amber-700 border-amber-200",
  partial: "bg-orange-100 text-orange-700 border-orange-200",
  paid: "bg-emerald-100 text-emerald-700 border-emerald-200",
  overdue: "bg-red-100 text-red-700 border-red-200",
};

const INVOICE_LABELS: Record<string, string> = {
  none: "Belum Ditagih",
  to_invoice: "Perlu Invoice",
  invoiced: "Sudah Ditagih",
};

const DELIVERY_LABELS: Record<string, string> = {
  to_deliver: "Perlu Dikirim",
  delivered: "Sudah Dikirim",
};

// ── InfoRow helper ─────────────────────────────────────────────────────────────

function InfoRow({ label, value, mono }: { label: string; value: React.ReactNode; mono?: boolean }) {
  return (
    <div className="flex items-start gap-3 py-2">
      <span className="text-xs text-muted-foreground w-32 shrink-0 mt-0.5">{label}</span>
      <span className={`text-sm font-medium flex-1 ${mono ? "font-mono" : ""}`}>{value || "—"}</span>
    </div>
  );
}

// ── Add Payment Dialog ────────────────────────────────────────────────────────

function AddPaymentDialog({
  open,
  onClose,
  docId,
  customerName,
  remaining,
  onSuccess,
}: {
  open: boolean;
  onClose: () => void;
  docId: number;
  customerName: string;
  remaining: number;
  onSuccess: () => void;
}) {
  const { toast } = useToast();
  const [amount, setAmount] = useState(remaining > 0 ? String(Math.round(remaining)) : "");
  const [journalId, setJournalId] = useState<string>("");
  const [date, setDate] = useState(todayIso());
  const [ref, setRef] = useState("");
  const [memo, setMemo] = useState("");
  const [loading, setLoading] = useState(false);

  const { data: journals } = useListJournals();
  const cashBankJournals = (journals ?? []).filter(
    (j) => j.type === "bank" || j.type === "cash",
  );

  const createMut = useCreateAccountingPayment();

  const handleSubmit = async () => {
    if (!journalId || !amount || !date) {
      toast({ title: "Lengkapi semua field", variant: "destructive" });
      return;
    }
    const amt = Number(amount.replace(/\D/g, "")) || Number(amount);
    if (amt <= 0) {
      toast({ title: "Jumlah harus lebih dari 0", variant: "destructive" });
      return;
    }
    setLoading(true);
    try {
      await createMut.mutateAsync({
        data: {
          paymentType: "inbound",
          amount: amt,
          journalId: Number(journalId),
          partnerName: customerName,
          date,
          ref: ref || undefined,
          memo: memo || undefined,
          sourceType: "sales_order",
          sourceDocId: docId,
        },
      });
      toast({ title: "Pembayaran berhasil dicatat" });
      onSuccess();
      onClose();
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : "Gagal mencatat pembayaran";
      toast({ title: msg, variant: "destructive" });
    } finally {
      setLoading(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onClose}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <CreditCard className="h-4 w-4" /> Tambah Pembayaran
          </DialogTitle>
        </DialogHeader>
        <div className="space-y-4 py-2">
          {/* Amount */}
          <div className="space-y-1.5">
            <Label>Jumlah *</Label>
            <Input
              type="number"
              placeholder="0"
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
            />
            {remaining > 0 && (
              <p className="text-xs text-muted-foreground">
                Sisa tagihan: <span className="font-semibold text-amber-700">{idr(remaining)}</span>
                <button
                  type="button"
                  className="ml-2 text-primary underline text-xs"
                  onClick={() => setAmount(String(Math.round(remaining)))}
                >
                  Pakai jumlah penuh
                </button>
              </p>
            )}
          </div>

          {/* Journal */}
          <div className="space-y-1.5">
            <Label>Metode Pembayaran *</Label>
            <Select value={journalId} onValueChange={setJournalId}>
              <SelectTrigger>
                <SelectValue placeholder="Pilih jurnal kas/bank…" />
              </SelectTrigger>
              <SelectContent>
                {cashBankJournals.map((j) => (
                  <SelectItem key={j.id} value={String(j.id)}>
                    {j.name} ({j.type === "cash" ? "Kas" : "Bank"})
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          {/* Date */}
          <div className="space-y-1.5">
            <Label>Tanggal *</Label>
            <DatePicker value={date} onChange={(v) => setDate(v)} />
          </div>

          {/* Ref */}
          <div className="space-y-1.5">
            <Label>Referensi</Label>
            <Input
              placeholder="No. transfer / kwitansi"
              value={ref}
              onChange={(e) => setRef(e.target.value)}
            />
          </div>

          {/* Memo */}
          <div className="space-y-1.5">
            <Label>Catatan</Label>
            <Input
              placeholder="Opsional"
              value={memo}
              onChange={(e) => setMemo(e.target.value)}
            />
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={loading}>
            Batal
          </Button>
          <Button onClick={handleSubmit} disabled={loading} className="gap-2">
            {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <CreditCard className="h-4 w-4" />}
            Simpan Pembayaran
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ── Void Dialog ───────────────────────────────────────────────────────────────

function VoidDialog({
  open,
  onClose,
  paymentId,
  onSuccess,
}: {
  open: boolean;
  onClose: () => void;
  paymentId: number;
  onSuccess: () => void;
}) {
  const { toast } = useToast();
  const [reason, setReason] = useState("");
  const [loading, setLoading] = useState(false);
  const voidMut = useVoidAccountingPayment();

  const handleVoid = async () => {
    setLoading(true);
    try {
      await voidMut.mutateAsync({ id: paymentId, data: { reason: reason || null } });
      toast({ title: "Pembayaran dibatalkan" });
      onSuccess();
      onClose();
    } catch {
      toast({ title: "Gagal membatalkan pembayaran", variant: "destructive" });
    } finally {
      setLoading(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onClose}>
      <DialogContent className="max-w-sm">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 text-destructive">
            <Ban className="h-4 w-4" /> Batalkan Pembayaran
          </DialogTitle>
        </DialogHeader>
        <div className="space-y-4 py-2">
          <p className="text-sm text-muted-foreground">
            Tindakan ini akan membuat jurnal pembalik dan mengurangi jumlah terbayar.
          </p>
          <div className="space-y-1.5">
            <Label>Alasan (opsional)</Label>
            <Input
              placeholder="Mis. Salah input"
              value={reason}
              onChange={(e) => setReason(e.target.value)}
            />
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={loading}>
            Batal
          </Button>
          <Button variant="destructive" onClick={handleVoid} disabled={loading} className="gap-2">
            {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Ban className="h-4 w-4" />}
            Batalkan Pembayaran
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ── Payment Proof Section ─────────────────────────────────────────────────────

interface ProofInfo {
  id: number;
  docNumber: string;
  invoiceNumber: string | null;
  customerName: string;
  grandTotal: string;
  hasToken: boolean;
  proofUrl: string | null;
  proofUploadedAt: string | null;
  proofRemarks: string | null;
}

function PaymentProofSection({ docId }: { docId: number }) {
  const { toast } = useToast();
  const [resending, setResending] = useState(false);

  const { data: proof, isLoading } = useQuery<ProofInfo>({
    queryKey: ["payment-proof-info", docId],
    queryFn: async () => {
      const r = await fetch(`/api/customer-invoice/${docId}/proof-info`);
      if (!r.ok) throw new Error("Gagal memuat info bukti");
      return r.json();
    },
    staleTime: 30_000,
  });

  const handleResendWa = async () => {
    setResending(true);
    try {
      const r = await fetch(`/api/customer-invoice/${docId}/resend-proof-wa`, { method: "POST" });
      if (!r.ok) {
        const j = await r.json().catch(() => ({}));
        throw new Error((j as any)?.message || "Gagal mengirim WA");
      }
      toast({ title: "WA link bukti pembayaran dikirim ulang" });
    } catch (err: unknown) {
      toast({ title: err instanceof Error ? err.message : "Gagal mengirim WA", variant: "destructive" });
    } finally {
      setResending(false);
    }
  };

  if (isLoading) return <LoadingSkeleton skeletonRows={1} skeletonRowClassName="h-20" />;
  if (!proof) return null;

  return (
    <div className="rounded-lg border bg-muted/30 p-4 space-y-3">
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-semibold flex items-center gap-2">
          <Upload className="h-4 w-4 text-muted-foreground" /> Bukti Pembayaran Customer
        </h3>
        {proof.proofUrl ? (
          <Badge variant="outline" className="text-xs bg-emerald-50 text-emerald-700 border-emerald-200">
            <CheckCircle className="h-3 w-3 mr-1" /> Diterima
          </Badge>
        ) : (
          <Badge variant="outline" className="text-xs bg-amber-50 text-amber-600 border-amber-200">
            Belum Diunggah
          </Badge>
        )}
      </div>

      {proof.proofUrl ? (
        <div className="space-y-1.5">
          {proof.proofUploadedAt && (
            <p className="text-xs text-muted-foreground">
              Diunggah:{" "}
              {new Date(proof.proofUploadedAt).toLocaleString("id-ID", {
                day: "numeric", month: "short", year: "numeric",
                hour: "2-digit", minute: "2-digit",
              })}
            </p>
          )}
          {proof.proofRemarks && (
            <p className="text-xs text-muted-foreground">Catatan: {proof.proofRemarks}</p>
          )}
          <div className="flex items-center gap-2 pt-1">
            <a href={proof.proofUrl} target="_blank" rel="noopener noreferrer">
              <Button size="sm" variant="outline" className="gap-2 text-blue-600 border-blue-200 hover:bg-blue-50">
                <Eye className="h-3.5 w-3.5" /> Lihat Bukti
              </Button>
            </a>
            <Button size="sm" variant="ghost" className="gap-2 text-muted-foreground text-xs"
              onClick={handleResendWa} disabled={resending}>
              {resending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <RefreshCw className="h-3.5 w-3.5" />}
              Kirim Ulang WA
            </Button>
          </div>
        </div>
      ) : (
        <div className="flex items-center gap-3">
          <p className="text-xs text-muted-foreground flex-1">
            {proof.hasToken
              ? "Customer belum mengunggah bukti pembayaran. Kirim ulang link WA jika diperlukan."
              : "Link WA belum dikirim. Kirim link agar customer bisa mengunggah bukti."}
          </p>
          <Button size="sm" variant="outline" className="gap-2 shrink-0"
            onClick={handleResendWa} disabled={resending}>
            {resending
              ? <Loader2 className="h-3.5 w-3.5 animate-spin" />
              : <RefreshCw className="h-3.5 w-3.5" />}
            {proof.hasToken ? "Kirim Ulang WA" : "Kirim WA Link"}
          </Button>
        </div>
      )}
    </div>
  );
}

// ── Payment History Tab ───────────────────────────────────────────────────────

function PaymentHistoryTab({
  docId,
  docNumber,
  customerName,
  grandTotal,
  amountPaid,
  isOrder,
}: {
  docId: number;
  docNumber?: string | null;
  customerName: string;
  grandTotal: number;
  amountPaid: number;
  isOrder: boolean;
}) {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [showAdd, setShowAdd] = useState(false);
  const [voidPaymentId, setVoidPaymentId] = useState<number | null>(null);

  const paymentParams = { sourceType: "sales_order", sourceDocId: docId };
  const { data: payments, isLoading } = useListAccountingPayments(paymentParams);

  const invalidate = () => {
    queryClient.invalidateQueries({ queryKey: getListAccountingPaymentsQueryKey(paymentParams) });
    queryClient.invalidateQueries({ queryKey: getGetSalesDocumentQueryKey(docId) });
    queryClient.invalidateQueries({ queryKey: getListSalesDocumentsQueryKey({}) });
  };

  const remaining = Math.max(0, grandTotal - amountPaid);
  const postedPayments = (payments ?? []).filter((p) => p.status !== "voided");
  const voidedPayments = (payments ?? []).filter((p) => p.status === "voided");
  const totalPosted = postedPayments.reduce((s, p) => s + Number(p.amount), 0);

  if (isLoading) {
    return <LoadingSkeleton skeletonRows={3} skeletonRowClassName="h-10" />;
  }

  return (
    <div className="space-y-4">
      {/* Summary strip */}
      <div className="grid grid-cols-3 gap-3">
        <div className="rounded-lg border bg-muted/30 p-3 text-center">
          <p className="text-xs text-muted-foreground mb-0.5">Total Tagihan</p>
          <p className="text-sm font-bold">{idr(grandTotal)}</p>
        </div>
        <div className="rounded-lg border bg-emerald-50 border-emerald-200 p-3 text-center">
          <p className="text-xs text-emerald-600 mb-0.5">Sudah Dibayar</p>
          <p className="text-sm font-bold text-emerald-700">{idr(totalPosted)}</p>
        </div>
        <div className={`rounded-lg border p-3 text-center ${remaining > 0 ? "bg-amber-50 border-amber-200" : "bg-slate-50"}`}>
          <p className={`text-xs mb-0.5 ${remaining > 0 ? "text-amber-600" : "text-muted-foreground"}`}>Sisa Tagihan</p>
          <p className={`text-sm font-bold ${remaining > 0 ? "text-amber-700" : "text-muted-foreground"}`}>{idr(remaining)}</p>
        </div>
      </div>

      {/* Add button */}
      <div className="flex items-center justify-between">
        {docNumber ? (
          <Link href={`/accounting/payments?refDocNumber=${encodeURIComponent(docNumber)}`}>
            <Button size="sm" variant="ghost" className="gap-1.5 text-xs text-muted-foreground hover:text-foreground">
              <SquareArrowOutUpRight className="h-3.5 w-3.5" /> Lihat di Akuntansi
            </Button>
          </Link>
        ) : <span />}
        {isOrder && (
          <Button size="sm" className="gap-2" onClick={() => setShowAdd(true)}>
            <PlusCircle className="h-3.5 w-3.5" /> Tambah Pembayaran
          </Button>
        )}
      </div>

      {/* Payment list */}
      {(payments ?? []).length === 0 ? (
        <div className="rounded-lg border border-dashed py-12 flex flex-col items-center gap-2 text-muted-foreground">
          <CreditCard className="h-8 w-8 opacity-30" />
          <p className="text-sm">Belum ada pembayaran tercatat</p>
        </div>
      ) : (
        <Card>
          <Table>
            <TableHeader>
              <TableRow className="bg-muted/30">
                <TableHead className="pl-4">Tanggal</TableHead>
                <TableHead>No. Pembayaran</TableHead>
                <TableHead>Ref</TableHead>
                <TableHead>Catatan</TableHead>
                <TableHead className="text-right">Jumlah</TableHead>
                <TableHead className="text-center">Status</TableHead>
                <TableHead className="pr-4 w-16" />
              </TableRow>
            </TableHeader>
            <TableBody>
              {(payments ?? []).map((p) => (
                <TableRow key={p.id} className={p.status === "voided" ? "opacity-50" : ""}>
                  <TableCell className="pl-4 text-sm">
                    {new Date(p.date).toLocaleDateString("id-ID", { day: "numeric", month: "short", year: "numeric" })}
                  </TableCell>
                  <TableCell className="font-mono text-xs text-muted-foreground">
                    {p.id}
                  </TableCell>
                  <TableCell className="text-sm">{p.ref ?? "—"}</TableCell>
                  <TableCell className="text-sm text-muted-foreground max-w-[160px] truncate">
                    {p.memo ?? "—"}
                  </TableCell>
                  <TableCell className="text-right text-sm font-medium tabular-nums">
                    {p.status === "voided" ? (
                      <span className="line-through text-muted-foreground">{idr(p.amount)}</span>
                    ) : (
                      <span className="text-emerald-700">{idr(p.amount)}</span>
                    )}
                  </TableCell>
                  <TableCell className="text-center">
                    {p.status === "voided" ? (
                      <Badge variant="outline" className="text-xs bg-red-50 text-red-600 border-red-200">
                        Dibatalkan
                      </Badge>
                    ) : (
                      <Badge variant="outline" className="text-xs bg-emerald-50 text-emerald-700 border-emerald-200">
                        Terpposting
                      </Badge>
                    )}
                  </TableCell>
                  <TableCell className="pr-4">
                    {p.status !== "voided" && (
                      <Button
                        variant="ghost"
                        size="icon"
                        className="h-7 w-7 text-muted-foreground hover:text-destructive"
                        title="Batalkan pembayaran"
                        onClick={() => setVoidPaymentId(p.id)}
                      >
                        <Ban className="h-3.5 w-3.5" />
                      </Button>
                    )}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </Card>
      )}

      {voidedPayments.length > 0 && postedPayments.length > 0 && (
        <p className="text-xs text-muted-foreground text-right flex items-center justify-end gap-1">
          <AlertCircle className="h-3 w-3" />
          {voidedPayments.length} pembayaran dibatalkan tidak dihitung
        </p>
      )}

      {/* Proof section — hanya tampil untuk Sales Order */}
      {isOrder && <PaymentProofSection docId={docId} />}

      {/* Dialogs */}
      {showAdd && (
        <AddPaymentDialog
          open
          onClose={() => setShowAdd(false)}
          docId={docId}
          customerName={customerName}
          remaining={remaining}
          onSuccess={invalidate}
        />
      )}
      {voidPaymentId != null && (
        <VoidDialog
          open
          onClose={() => setVoidPaymentId(null)}
          paymentId={voidPaymentId}
          onSuccess={invalidate}
        />
      )}
    </div>
  );
}

// ── Activity Log Tab ──────────────────────────────────────────────────────────

interface AuditEntry {
  id: number;
  user_email: string | null;
  action: string;
  new_data: Record<string, unknown> | null;
  old_data: Record<string, unknown> | null;
  created_at: string;
}

const ACTION_META: Record<string, { label: string; color: string; icon: React.ReactNode }> = {
  create:          { label: "Dokumen Dibuat",           color: "bg-emerald-500", icon: <FileText className="h-3 w-3 text-white" /> },
  update:          { label: "Dokumen Diperbarui",       color: "bg-blue-500",    icon: <FileEdit className="h-3 w-3 text-white" /> },
  delete:          { label: "Dokumen Dihapus",          color: "bg-red-500",     icon: <Trash2 className="h-3 w-3 text-white" /> },
  send:            { label: "Dikirim ke Customer",      color: "bg-blue-500",    icon: <Send className="h-3 w-3 text-white" /> },
  confirm:         { label: "Dikonfirmasi",             color: "bg-emerald-600", icon: <CheckCircle className="h-3 w-3 text-white" /> },
  cancel:          { label: "Dibatalkan",               color: "bg-red-500",     icon: <XCircle className="h-3 w-3 text-white" /> },
  draft:           { label: "Dikembalikan ke Draft",    color: "bg-slate-400",   icon: <CircleDot className="h-3 w-3 text-white" /> },
  mark_delivered:  { label: "Tandai Terkirim",          color: "bg-indigo-500",  icon: <Truck className="h-3 w-3 text-white" /> },
  mark_invoiced:   { label: "Invoice Dibuat",           color: "bg-orange-500",  icon: <Receipt className="h-3 w-3 text-white" /> },
  cancel_invoice:  { label: "Invoice Dibatalkan",       color: "bg-red-400",     icon: <XCircle className="h-3 w-3 text-white" /> },
};

function ActivityLogTab({ docId }: { docId: number }) {
  const { data: entries, isLoading } = useQuery<AuditEntry[]>({
    queryKey: ["sales-audit-log", docId],
    queryFn: async () => {
      const res = await fetch(`/api/sales/documents/${docId}/audit-log`);
      if (!res.ok) throw new Error("Gagal memuat riwayat");
      return res.json() as Promise<AuditEntry[]>;
    },
    refetchInterval: 30_000,
  });

  return (
    <QueryState loading={isLoading} empty={!entries?.length} emptyMessage="Belum ada aktivitas tercatat">
      <div className="relative">
        {/* Vertical line */}
        <div className="absolute left-[13px] top-3 bottom-3 w-px bg-border" />

      <div className="space-y-0">
        {(entries ?? []).map((entry, idx) => {
          const meta = ACTION_META[entry.action] ?? {
            label: entry.action,
            color: "bg-slate-400",
            icon: <CircleDot className="h-3 w-3 text-white" />,
          };
          const nd = entry.new_data;
          const isLast = idx === (entries?.length ?? 0) - 1;

          return (
            <div key={entry.id} className={`flex gap-4 ${isLast ? "" : "pb-5"}`}>
              {/* Icon dot */}
              <div className={`relative z-10 h-7 w-7 rounded-full ${meta.color} flex items-center justify-center shrink-0 shadow-sm`}>
                {meta.icon}
              </div>

              {/* Content */}
              <div className="flex-1 pt-0.5 pb-1">
                <div className="flex items-start justify-between gap-2">
                  <div>
                    <p className="text-sm font-semibold leading-tight">{meta.label}</p>
                    {entry.user_email && (
                      <p className="text-xs text-muted-foreground mt-0.5">
                        oleh <span className="font-medium">{entry.user_email}</span>
                      </p>
                    )}
                    {/* Extra detail from new_data */}
                    {nd && entry.action === "create" && !!nd.docNumber && (
                      <p className="text-xs text-muted-foreground mt-1">
                        Nomor dokumen: <span className="font-mono font-medium">{String(nd.docNumber)}</span>
                      </p>
                    )}
                    {nd && (entry.action === "confirm" || entry.action === "send" || entry.action === "cancel" || entry.action === "draft") && !!nd.fromStatus && !!nd.toStatus && (
                      <p className="text-xs text-muted-foreground mt-1">
                        Status: <span className="line-through opacity-60">{String(nd.fromStatus)}</span>
                        {" → "}
                        <span className="font-medium">{String(nd.toStatus)}</span>
                      </p>
                    )}
                    {nd && entry.action === "mark_invoiced" && !!nd.invoiceNumber && (
                      <p className="text-xs text-muted-foreground mt-1">
                        Invoice: <span className="font-mono font-medium">{String(nd.invoiceNumber)}</span>
                      </p>
                    )}
                  </div>
                  <time className="text-[11px] text-muted-foreground shrink-0 mt-0.5" dateTime={entry.created_at}>
                    {new Date(entry.created_at).toLocaleString("id-ID", {
                      day: "numeric", month: "short", year: "numeric",
                      hour: "2-digit", minute: "2-digit",
                    })}
                  </time>
                </div>
              </div>
            </div>
          );
        })}
        </div>
      </div>
    </QueryState>
  );
}

// ── Main Component ─────────────────────────────────────────────────────────────

export default function SalesDocumentDetailPage() {
  const { id } = useParams<{ id: string }>();
  const docId = Number(id);
  const [, navigate] = useLocation();
  const { toast } = useToast();
  const queryClient = useQueryClient();

  const [actionLoading, setActionLoading] = useState<string | null>(null);
  const [pdfLoading, setPdfLoading] = useState(false);

  const { data: doc, isLoading, error } = useGetSalesDocument(docId, {
    query: { queryKey: getGetSalesDocumentQueryKey(docId), enabled: !Number.isNaN(docId) },
  });

  const actionMut = useSalesDocumentAction();
  const deleteMut = useDeleteSalesDocument();

  const invalidate = () => {
    queryClient.invalidateQueries({ queryKey: getGetSalesDocumentQueryKey(docId) });
    queryClient.invalidateQueries({ queryKey: getListSalesDocumentsQueryKey({}) });
  };

  const handleAction = async (action: string, label: string) => {
    if (!confirm(`${label}?`)) return;
    setActionLoading(action);
    try {
      await actionMut.mutateAsync({ id: docId, data: { action: action as any } });
      invalidate();
      toast({ title: "Berhasil" });
    } catch {
      toast({ title: "Gagal", variant: "destructive" });
    } finally {
      setActionLoading(null);
    }
  };

  const handleDelete = async () => {
    if (!confirm("Hapus dokumen ini? Tindakan ini tidak bisa dibatalkan.")) return;
    setActionLoading("delete");
    try {
      await deleteMut.mutateAsync({ id: docId });
      queryClient.invalidateQueries({ queryKey: getListSalesDocumentsQueryKey({}) });
      toast({ title: "Dokumen dihapus" });
      navigate(doc?.kind === "order" ? "/sales/orders" : "/sales/documents");
    } catch {
      toast({ title: "Gagal menghapus", variant: "destructive" });
      setActionLoading(null);
    }
  };

  const handleDownloadPdf = async () => {
    setPdfLoading(true);
    try {
      const res = await fetch(`/api/sales/documents/${docId}/pdf`);
      if (!res.ok) throw new Error();
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.target = "_blank";
      a.rel = "noopener noreferrer";
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      setTimeout(() => URL.revokeObjectURL(url), 10000);
    } catch {
      toast({ title: "Gagal download PDF", variant: "destructive" });
    } finally {
      setPdfLoading(false);
    }
  };

  // ── Loading ──────────────────────────────────────────────────────────────────

  if (isLoading) {
    return (
      <AppShell>
        <LoadingSkeleton variant="detail" />
      </AppShell>
    );
  }

  if (error || !doc || Number.isNaN(docId)) {
    return (
      <AppShell>
        <div className="max-w-5xl mx-auto py-16 text-center">
          <FileText className="w-14 h-14 mx-auto mb-4 text-muted-foreground/40" />
          <h2 className="text-lg font-semibold mb-1">Dokumen tidak ditemukan</h2>
          <p className="text-sm text-muted-foreground mb-6">
            Dokumen dengan ID <span className="font-mono font-medium">{id}</span> tidak ada atau kamu tidak punya akses.
          </p>
          <Button variant="outline" onClick={() => navigate("/sales/documents")}>
            <ArrowLeft className="mr-2 h-4 w-4" /> Kembali ke Daftar
          </Button>
        </div>
      </AppShell>
    );
  }

  const isOrder = doc.kind === "order";
  const isEditable = doc.status === "draft" || doc.status === "sent";
  const isCancelled = doc.status === "cancelled";
  const isDone = doc.status === "done";
  const isConfirmed = doc.status === "confirmed";

  const subtotal = Number(doc.totalAmount ?? 0);
  const taxAmount = Number(doc.taxAmount ?? 0);
  const grandTotal = Number(doc.grandTotal ?? subtotal);
  const amountPaid = Number(doc.amountPaid ?? 0);
  const amountDue = Math.max(0, grandTotal - amountPaid);

  const backHref = isOrder ? "/sales/orders" : "/sales/documents";

  return (
    <AppShell>
      <div className="space-y-5 max-w-5xl mx-auto pb-8">

        {/* ── Header ──────────────────────────────────────────────────────────── */}
        <div className="flex items-start justify-between gap-4 flex-wrap">
          <div className="flex items-center gap-3 flex-wrap">
            <Button variant="ghost" size="icon" onClick={() => navigate(backHref)} className="shrink-0">
              <ArrowLeft className="h-4 w-4" />
            </Button>
            <div>
              <div className="flex items-center gap-2 flex-wrap">
                <h1 className="text-xl font-bold font-mono tracking-tight">{doc.docNumber}</h1>
                <Badge variant="outline" className="text-xs capitalize">
                  {isOrder ? "Sales Order" : "Quotation"}
                </Badge>
                <Badge className={`text-xs border ${STATUS_COLORS[doc.status] ?? "bg-gray-100 text-gray-700 border-gray-200"}`}>
                  {STATUS_LABELS[doc.status] ?? doc.status}
                </Badge>
                {doc.aiGenerated && (
                  <span className="inline-flex items-center gap-0.5 px-1.5 py-0.5 rounded text-[10px] font-bold bg-violet-100 text-violet-700 border border-violet-200">
                    🤖 AI
                  </span>
                )}
              </div>
              <p className="text-xs text-muted-foreground mt-0.5">
                Dibuat {dateTimeStr(doc.createdAt)}
                {doc.confirmedAt ? ` · Dikonfirmasi ${dateTimeStr(doc.confirmedAt)}` : ""}
              </p>
            </div>
          </div>

          {/* Action buttons */}
          <div className="flex items-center gap-2 flex-wrap">
            <Button variant="outline" size="sm" onClick={handleDownloadPdf} disabled={pdfLoading} className="gap-2">
              {pdfLoading ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Printer className="h-3.5 w-3.5" />}
              PDF
            </Button>

            {isEditable && (
              <Button variant="outline" size="sm" asChild className="gap-2">
                <Link href={`/sales/documents/${docId}/edit`}>
                  <FileEdit className="h-3.5 w-3.5" /> Edit
                </Link>
              </Button>
            )}

            {doc.status === "draft" && (
              <Button size="sm" variant="outline" className="gap-2 text-blue-600 border-blue-200 hover:bg-blue-50"
                onClick={() => handleAction("send", "Kirim ke customer")}
                disabled={actionLoading === "send"}
              >
                {actionLoading === "send" ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Send className="h-3.5 w-3.5" />}
                Kirim
              </Button>
            )}

            {(doc.status === "draft" || doc.status === "sent") && (
              <Button size="sm" className="gap-2 bg-emerald-600 hover:bg-emerald-700"
                onClick={() => handleAction("confirm", "Konfirmasi sebagai Sales Order")}
                disabled={actionLoading === "confirm"}
              >
                {actionLoading === "confirm" ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <CheckCircle className="h-3.5 w-3.5" />}
                Konfirmasi
              </Button>
            )}

            {isOrder && isConfirmed && doc.deliveryStatus !== "delivered" && (
              <Button size="sm" variant="outline" className="gap-2 text-indigo-600 border-indigo-200 hover:bg-indigo-50"
                onClick={() => handleAction("mark_delivered", "Tandai sudah dikirim")}
                disabled={actionLoading === "mark_delivered"}
              >
                {actionLoading === "mark_delivered" ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Truck className="h-3.5 w-3.5" />}
                Tandai Terkirim
              </Button>
            )}

            {isOrder && (isConfirmed || isDone) && doc.invoiceStatus !== "invoiced" && (
              <Button size="sm" variant="outline" className="gap-2 text-orange-600 border-orange-200 hover:bg-orange-50"
                onClick={() => handleAction("mark_invoiced", "Buat invoice untuk dokumen ini")}
                disabled={actionLoading === "mark_invoiced"}
              >
                {actionLoading === "mark_invoiced" ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Receipt className="h-3.5 w-3.5" />}
                Buat Invoice
              </Button>
            )}

            {doc.invoiceStatus === "invoiced" && doc.paymentStatus !== "paid" && (
              <Button size="sm" variant="outline" className="gap-2 text-violet-600 border-violet-200 hover:bg-violet-50"
                onClick={() => handleAction("send_reminder", "Kirim reminder pembayaran ke customer")}
                disabled={actionLoading === "send_reminder"}
              >
                {actionLoading === "send_reminder" ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Bell className="h-3.5 w-3.5" />}
                Kirim Reminder
              </Button>
            )}

            {!isCancelled && !isDone && (
              <Button size="sm" variant="ghost"
                className="gap-2 text-destructive hover:text-destructive hover:bg-destructive/10"
                onClick={() => handleAction("cancel", "Batalkan dokumen ini")}
                disabled={actionLoading === "cancel"}
              >
                {actionLoading === "cancel" ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <XCircle className="h-3.5 w-3.5" />}
                Batalkan
              </Button>
            )}

            {doc.status === "draft" && (
              <Button size="sm" variant="ghost"
                className="gap-2 text-destructive hover:text-destructive hover:bg-destructive/10"
                onClick={handleDelete}
                disabled={actionLoading === "delete"}
              >
                {actionLoading === "delete" ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Trash2 className="h-3.5 w-3.5" />}
              </Button>
            )}
          </div>
        </div>

        {/* ── Tabs ─────────────────────────────────────────────────────────────── */}
        <Tabs defaultValue="detail">
          <TabsList>
            <TabsTrigger value="detail" className="gap-2">
              <FileText className="h-3.5 w-3.5" /> Detail
            </TabsTrigger>
            <TabsTrigger value="pembayaran" className="gap-2">
              <CreditCard className="h-3.5 w-3.5" /> Pembayaran
              {isOrder && amountPaid > 0 && (
                <span className="ml-1 rounded-full bg-emerald-100 text-emerald-700 text-[10px] font-bold px-1.5 py-0.5">
                  {idr(amountPaid)}
                </span>
              )}
            </TabsTrigger>
            <TabsTrigger value="aktivitas" className="gap-2">
              <History className="h-3.5 w-3.5" /> Aktivitas
            </TabsTrigger>
          </TabsList>

          {/* ── Detail Tab ─────────────────────────────────────────────────────── */}
          <TabsContent value="detail" className="space-y-4 mt-4">

            {/* Info Cards */}
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <Card>
                <CardHeader className="pb-2 pt-4 px-4">
                  <CardTitle className="text-sm font-medium flex items-center gap-2">
                    <User className="h-4 w-4 text-muted-foreground" /> Customer
                  </CardTitle>
                </CardHeader>
                <CardContent className="px-4 pb-4 pt-0 divide-y divide-border/50">
                  <InfoRow label="Nama" value={<span className="font-semibold">{doc.customerName}</span>} />
                  {doc.customerAddress && (
                    <InfoRow label="Alamat" value={doc.customerAddress} />
                  )}
                </CardContent>
              </Card>

              <Card>
                <CardHeader className="pb-2 pt-4 px-4">
                  <CardTitle className="text-sm font-medium flex items-center gap-2">
                    <Calendar className="h-4 w-4 text-muted-foreground" /> Tanggal & Status
                  </CardTitle>
                </CardHeader>
                <CardContent className="px-4 pb-4 pt-0 divide-y divide-border/50">
                  <InfoRow label="Dibuat" value={dateStr(doc.createdAt)} />
                  {doc.validUntil && (
                    <InfoRow label="Berlaku hingga" value={dateStr(doc.validUntil)} />
                  )}
                  {doc.expectedDate && (
                    <InfoRow label="Tanggal kirim" value={dateStr(doc.expectedDate)} />
                  )}
                  {isOrder && (
                    <>
                      <InfoRow
                        label="Invoice"
                        value={
                          <Badge variant="outline" className="text-xs">
                            {INVOICE_LABELS[doc.invoiceStatus] ?? doc.invoiceStatus}
                          </Badge>
                        }
                      />
                      <InfoRow
                        label="Pengiriman"
                        value={
                          <Badge variant="outline" className="text-xs">
                            {DELIVERY_LABELS[doc.deliveryStatus ?? "to_deliver"] ?? doc.deliveryStatus}
                          </Badge>
                        }
                      />
                      <InfoRow
                        label="Pembayaran"
                        value={
                          <Badge className={`text-xs border ${PAYMENT_COLORS[doc.paymentStatus ?? "unpaid"] ?? ""}`}>
                            {PAYMENT_LABELS[doc.paymentStatus ?? "unpaid"] ?? doc.paymentStatus}
                          </Badge>
                        }
                      />
                    </>
                  )}
                  {!!(doc as any).invoiceNumber && (
                    <InfoRow label="No. Invoice" value={(doc as any).invoiceNumber} mono />
                  )}
                  {!!(doc as any).dueDate && (
                    <InfoRow label="Jatuh tempo" value={dateStr((doc as any).dueDate)} />
                  )}
                </CardContent>
              </Card>

              {(doc.origin || doc.destination || doc.transportMode) && (
                <Card>
                  <CardHeader className="pb-2 pt-4 px-4">
                    <CardTitle className="text-sm font-medium flex items-center gap-2">
                      <MapPin className="h-4 w-4 text-muted-foreground" /> Pengiriman
                    </CardTitle>
                  </CardHeader>
                  <CardContent className="px-4 pb-4 pt-0 divide-y divide-border/50">
                    {doc.origin && <InfoRow label="Asal" value={doc.origin} />}
                    {doc.destination && <InfoRow label="Tujuan" value={doc.destination} />}
                    {doc.transportMode && <InfoRow label="Moda" value={doc.transportMode} />}
                    {doc.etd && <InfoRow label="ETD" value={dateStr(doc.etd)} />}
                    {doc.eta && <InfoRow label="ETA" value={dateStr(doc.eta)} />}
                  </CardContent>
                </Card>
              )}

              {doc.notes && (
                <Card>
                  <CardHeader className="pb-2 pt-4 px-4">
                    <CardTitle className="text-sm font-medium flex items-center gap-2">
                      <FileText className="h-4 w-4 text-muted-foreground" /> Catatan
                    </CardTitle>
                  </CardHeader>
                  <CardContent className="px-4 pb-4 pt-0">
                    <p className="text-sm text-muted-foreground whitespace-pre-wrap">{doc.notes}</p>
                  </CardContent>
                </Card>
              )}

              {!!(doc as any).logisticOrderId && (
                <Card className="border-indigo-200/60 bg-indigo-50/30">
                  <CardContent className="px-4 py-3 flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <Package className="h-4 w-4 text-indigo-500" />
                      <span className="text-sm text-indigo-700 font-medium">Terhubung ke Logistic Order</span>
                    </div>
                    <Button variant="outline" size="sm" asChild className="gap-1.5 text-indigo-600 border-indigo-200 hover:bg-indigo-100">
                      <Link href={`/logistics/orders/${(doc as any).logisticOrderId}`}>
                        Lihat <ExternalLink className="h-3 w-3" />
                      </Link>
                    </Button>
                  </CardContent>
                </Card>
              )}
            </div>

            {(doc as any).templateSnapshot && (
              <TemplateSnapshotCard templateSnapshot={(doc as any).templateSnapshot} />
            )}

            {/* Line Items */}
            <Card>
              <CardHeader className="pb-2 pt-4 px-4">
                <CardTitle className="text-sm font-medium flex items-center gap-2">
                  <Package className="h-4 w-4 text-muted-foreground" /> Item / Jasa
                  <span className="ml-auto text-xs text-muted-foreground font-normal">{doc.lines?.length ?? 0} baris</span>
                </CardTitle>
              </CardHeader>
              <CardContent className="p-0">
                <Table>
                  <TableHeader>
                    <TableRow className="bg-muted/30">
                      <TableHead className="pl-4 w-8">#</TableHead>
                      <TableHead>Nama / Deskripsi</TableHead>
                      <TableHead className="text-right w-28">Qty</TableHead>
                      <TableHead className="text-right w-36">Harga Satuan</TableHead>
                      <TableHead className="text-right w-36 pr-4">Subtotal</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {(doc.lines ?? []).map((line, idx) => (
                      <TableRow key={line.id ?? idx}>
                        <TableCell className="pl-4 text-muted-foreground text-sm">{idx + 1}</TableCell>
                        <TableCell>
                          <p className="font-medium text-sm">{line.name}</p>
                          {line.description && (
                            <p className="text-xs text-muted-foreground mt-0.5">{line.description}</p>
                          )}
                        </TableCell>
                        <TableCell className="text-right text-sm tabular-nums">
                          {Number(line.quantity).toLocaleString("id-ID")}
                        </TableCell>
                        <TableCell className="text-right text-sm tabular-nums">
                          {idr(line.unitPrice)}
                        </TableCell>
                        <TableCell className="text-right text-sm font-medium tabular-nums pr-4">
                          {idr(line.subtotal)}
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </CardContent>
              <div className="px-4 py-4 border-t">
                <div className="ml-auto max-w-xs space-y-2">
                  <div className="flex justify-between text-sm text-muted-foreground">
                    <span>Subtotal</span>
                    <span className="tabular-nums">{idr(subtotal)}</span>
                  </div>
                  {taxAmount > 0 && (
                    <div className="flex justify-between text-sm text-muted-foreground">
                      <span>Pajak</span>
                      <span className="tabular-nums">{idr(taxAmount)}</span>
                    </div>
                  )}
                  <Separator />
                  <div className="flex justify-between text-base font-bold">
                    <span>Grand Total</span>
                    <span className="tabular-nums text-emerald-700">{idr(grandTotal)}</span>
                  </div>
                  {isOrder && amountPaid > 0 && (
                    <>
                      <div className="flex justify-between text-sm text-muted-foreground">
                        <span>Sudah Dibayar</span>
                        <span className="tabular-nums text-emerald-600">({idr(amountPaid)})</span>
                      </div>
                      <Separator />
                      <div className="flex justify-between text-sm font-semibold">
                        <span>Sisa Tagihan</span>
                        <span className={`tabular-nums ${amountDue > 0 ? "text-amber-700" : "text-emerald-700"}`}>
                          {idr(amountDue)}
                        </span>
                      </div>
                    </>
                  )}
                </div>
              </div>
            </Card>

            {/* Timestamps */}
            <div className="flex items-center gap-4 text-xs text-muted-foreground px-1">
              <span className="flex items-center gap-1">
                <Clock className="h-3 w-3" /> Dibuat {dateTimeStr(doc.createdAt)}
              </span>
              {doc.updatedAt !== doc.createdAt && (
                <span className="flex items-center gap-1">
                  <Clock className="h-3 w-3" /> Diperbarui {dateTimeStr(doc.updatedAt)}
                </span>
              )}
            </div>
          </TabsContent>

          {/* ── Payment Tab ────────────────────────────────────────────────────── */}
          <TabsContent value="pembayaran" className="mt-4 space-y-4">
            {isOrder && (
              <EscrowPanel docId={docId} grandTotal={grandTotal} />
            )}
            <PaymentHistoryTab
              docId={docId}
              docNumber={doc.docNumber}
              customerName={doc.customerName ?? ""}
              grandTotal={grandTotal}
              amountPaid={amountPaid}
              isOrder={isOrder}
            />
          </TabsContent>

          {/* ── Activity Tab ───────────────────────────────────────────────────── */}
          <TabsContent value="aktivitas" className="mt-4">
            <ActivityLogTab docId={docId} />
          </TabsContent>
        </Tabs>

      </div>
    </AppShell>
  );
}
