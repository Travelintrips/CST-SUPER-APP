import { Link } from "wouter";
import { DatePicker } from "@/components/ui/date-picker";
import { AppShell } from "@/components/layout/AppShell";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  useListSalesDocuments,
  useCreateAccountingPayment,
  useListJournals,
  getListSalesDocumentsQueryKey,
} from "@workspace/api-client-react";
import { useState, useMemo } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { useToast } from "@/hooks/use-toast";
import { ArrowLeft, CreditCard, MessageSquare, ShoppingCart, Send, Clock, AlertCircle, CheckCircle2, Banknote } from "lucide-react";
import { CorrespondenceTab } from "@/components/CorrespondenceTab";
import { useLanguage } from "@/contexts/LanguageContext";

const idr = (n: number) =>
  new Intl.NumberFormat("id-ID", { style: "currency", currency: "IDR", maximumFractionDigits: 0 }).format(n);

interface PayDoc {
  id: number;
  docNumber: string;
  customerName: string;
  grandTotal: number;
  amountPaid: number;
}

interface WaInvoiceDoc {
  id: number;
  docNumber: string;
  invoiceNumber?: string | null;
  customerName: string;
  grandTotal: number;
  dueDate?: string | null;
  taxRate?: number | null;
  taxAmount?: number | null;
  subtotal?: number | null;
}

function PaymentStatusBadge({ status }: { status: string }) {
  if (status === "paid") return <Badge className="bg-emerald-900/40 text-emerald-300 border-emerald-700 text-xs">Lunas</Badge>;
  if (status === "partial") return <Badge className="bg-amber-900/40 text-amber-300 border-amber-700 text-xs">Sebagian</Badge>;
  if (status === "overdue") return <Badge className="bg-red-900/40 text-red-300 border-red-700 text-xs">Lewat Jatuh Tempo</Badge>;
  return <Badge variant="outline" className="text-xs text-slate-400 border-slate-600">Belum Bayar</Badge>;
}

type InvoiceFilter = "all" | "to_invoice" | "invoiced";
type PayFilter = "all" | "unpaid" | "partial" | "paid" | "overdue";

export default function SalesInvoicesPage() {
  const qc = useQueryClient();
  const { toast } = useToast();
  const { t } = useLanguage();
  const [filter, setFilter] = useState<InvoiceFilter>("all");
  const [payFilter, setPayFilter] = useState<PayFilter>("all");
  const { data: _docsPaginated } = useListSalesDocuments({ kind: "order", limit: 500 });
  const docs = _docsPaginated?.data;
  const { data: journals = [] } = useListJournals();
  const bankCashJournals = journals.filter((j) => j.type === "bank" || j.type === "cash");

  const invoiceFiltered = useMemo(() => {
    return (docs ?? []).filter((d) => {
      if (filter === "all") return d.invoiceStatus !== "none";
      return d.invoiceStatus === filter;
    });
  }, [docs, filter]);

  const filtered = useMemo(() => {
    return invoiceFiltered.filter((d) => {
      if (payFilter === "all") return true;
      const balanceDue = Math.max(0, Number(d.grandTotal) - Number(d.amountPaid ?? 0));
      const effectiveStatus = balanceDue === 0 ? "paid" : (Number(d.amountPaid ?? 0) > 0 ? "partial" : "unpaid");
      const status = d.invoiceStatus === "invoiced" ? (d.paymentStatus ?? effectiveStatus) : effectiveStatus;
      return status === payFilter;
    });
  }, [invoiceFiltered, payFilter]);

  const stats = useMemo(() => {
    const base = (docs ?? []).filter((d) => d.invoiceStatus === "invoiced" && !(d as any).cancelledAt);
    const unpaid = base.filter((d) => (d.paymentStatus ?? "unpaid") === "unpaid");
    const partial = base.filter((d) => (d.paymentStatus ?? "unpaid") === "partial");
    const paid = base.filter((d) => (d.paymentStatus ?? "unpaid") === "paid");
    const overdue = base.filter((d) => {
      const due = (d as any).dueDate;
      const ps = d.paymentStatus ?? "unpaid";
      return due && new Date(due) < new Date() && ps !== "paid";
    });
    return {
      totalInvoiced: base.length,
      totalAmount: base.reduce((s, d) => s + Number(d.grandTotal ?? 0), 0),
      unpaidCount: unpaid.length,
      unpaidAmount: unpaid.reduce((s, d) => s + Math.max(0, Number(d.grandTotal ?? 0) - Number(d.amountPaid ?? 0)), 0),
      partialCount: partial.length,
      partialAmount: partial.reduce((s, d) => s + Math.max(0, Number(d.grandTotal ?? 0) - Number(d.amountPaid ?? 0)), 0),
      paidCount: paid.length,
      paidAmount: paid.reduce((s, d) => s + Number(d.amountPaid ?? d.grandTotal ?? 0), 0),
      overdueCount: overdue.length,
    };
  }, [docs]);

  const [corrDocId, setCorrDocId] = useState<number | null>(null);
  const [waDoc, setWaDoc] = useState<WaInvoiceDoc | null>(null);
  const [waForm, setWaForm] = useState({ phone: "", notes: "" });
  const [waSending, setWaSending] = useState(false);
  const [waResult, setWaResult] = useState<{ url: string } | null>(null);

  const openWaDialog = (doc: WaInvoiceDoc) => {
    setWaDoc(doc);
    setWaForm({ phone: "", notes: "" });
    setWaResult(null);
  };

  const sendWaInvoice = async () => {
    if (!waDoc) return;
    setWaSending(true);
    try {
      const res = await fetch("/api/vendor-form/admin/customer-invoices", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({
          salesDocId: waDoc.id,
          orderNumber: waDoc.docNumber,
          invoiceNumber: waDoc.invoiceNumber ?? undefined,
          customerName: waDoc.customerName,
          customerPhone: waForm.phone || undefined,
          currency: "IDR",
          dueDate: waDoc.dueDate ?? undefined,
          notes: waForm.notes || undefined,
          sendWa: !!waForm.phone,
        }),
      });
      const d = await res.json() as { success?: boolean; url?: string; error?: string };
      if (!res.ok) throw new Error(d.error ?? "Gagal membuat link");
      setWaResult({ url: d.url ?? "" });
      toast({ title: "Link invoice berhasil dibuat", description: waForm.phone ? "WA terkirim ke customer" : "Salin link di bawah" });
    } catch (err: unknown) {
      toast({ title: "Error", description: (err as Error).message, variant: "destructive" });
    } finally {
      setWaSending(false);
    }
  };

  const createMut = useCreateAccountingPayment();
  const [payDoc, setPayDoc] = useState<PayDoc | null>(null);
  const today = new Date().toISOString().slice(0, 10);
  const [payForm, setPayForm] = useState({
    journalId: "",
    date: today,
    ref: "",
    memo: "",
    amount: "",
  });

  const openPayDialog = (doc: PayDoc) => {
    const balanceDue = Math.max(0, doc.grandTotal - doc.amountPaid);
    setPayDoc(doc);
    setPayForm({
      journalId: bankCashJournals.length > 0 ? String(bankCashJournals[0]!.id) : "",
      date: today,
      ref: doc.docNumber,
      memo: `Pembayaran invoice ${doc.docNumber}`,
      amount: String(balanceDue),
    });
  };

  const closePayDialog = () => setPayDoc(null);

  const submitPayment = async () => {
    if (!payDoc || !payForm.journalId || !payForm.date || !payForm.amount) {
      toast({ title: t.common.error, variant: "destructive" });
      return;
    }
    const amt = Number(payForm.amount);
    if (Number.isNaN(amt) || amt <= 0) {
      toast({ title: t.common.error, variant: "destructive" });
      return;
    }
    try {
      await createMut.mutateAsync({
        data: {
          paymentType: "inbound",
          amount: amt,
          journalId: Number(payForm.journalId),
          partnerName: payDoc.customerName,
          date: payForm.date,
          ref: payForm.ref || undefined,
          memo: payForm.memo || undefined,
          sourceType: "sales_order",
          sourceDocId: payDoc.id,
        },
      });
      toast({ title: t.common.success, description: `Jurnal pembayaran ${payDoc.docNumber} dibuat — DR Kas/Bank, CR Piutang` });
      await qc.invalidateQueries({ queryKey: getListSalesDocumentsQueryKey() });
      closePayDialog();
    } catch (err: unknown) {
      const msg = (err as { response?: { data?: { message?: string } } })?.response?.data?.message ?? String(err);
      toast({ title: t.common.error, description: msg, variant: "destructive" });
    }
  };

  return (
    <AppShell>
      <div className="flex flex-col gap-6">
        <div className="flex items-center justify-between flex-wrap gap-3">
          <Link href="/sales"><Button variant="ghost" size="icon"><ArrowLeft className="h-4 w-4" /></Button></Link>
          <div>
            <h1 className="text-2xl font-bold">Invoices Penjualan</h1>
            <p className="text-sm text-muted-foreground">Faktur dari sales orders · Jurnal otomatis: DR Kas/Bank — CR Piutang → CR Pendapatan</p>
          </div>
          <div className="flex gap-2 flex-wrap">
            <Button size="sm" variant={filter === "all" ? "default" : "outline"} onClick={() => setFilter("all")}>Semua</Button>
            <Button size="sm" variant={filter === "to_invoice" ? "default" : "outline"} onClick={() => setFilter("to_invoice")}>Belum Invoice</Button>
            <Button size="sm" variant={filter === "invoiced" ? "default" : "outline"} onClick={() => setFilter("invoiced")}>Sudah Invoice</Button>
          </div>
        </div>

        {/* Stats Summary */}
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
          <button
            onClick={() => setPayFilter(payFilter === "unpaid" ? "all" : "unpaid")}
            className={`rounded-lg border p-3 text-left transition-colors ${payFilter === "unpaid" ? "bg-slate-700/80 border-slate-500" : "bg-slate-800/50 border-slate-700 hover:bg-slate-700/50"}`}
          >
            <div className="flex items-center gap-1.5 mb-1">
              <Clock className="h-3.5 w-3.5 text-slate-400" />
              <span className="text-xs text-slate-400">Belum Bayar</span>
              {stats.overdueCount > 0 && (
                <Badge className="bg-red-900/60 text-red-300 border-red-700 text-xs h-4 px-1">{stats.overdueCount} jatuh tempo</Badge>
              )}
            </div>
            <div className="text-sm font-bold text-slate-200">{stats.unpaidCount} invoice</div>
            <div className="text-xs text-amber-400 font-mono">{idr(stats.unpaidAmount)}</div>
          </button>

          <button
            onClick={() => setPayFilter(payFilter === "partial" ? "all" : "partial")}
            className={`rounded-lg border p-3 text-left transition-colors ${payFilter === "partial" ? "bg-amber-900/30 border-amber-600" : "bg-slate-800/50 border-slate-700 hover:bg-slate-700/50"}`}
          >
            <div className="flex items-center gap-1.5 mb-1">
              <AlertCircle className="h-3.5 w-3.5 text-amber-400" />
              <span className="text-xs text-slate-400">Sebagian</span>
            </div>
            <div className="text-sm font-bold text-slate-200">{stats.partialCount} invoice</div>
            <div className="text-xs text-amber-400 font-mono">{idr(stats.partialAmount)} sisa</div>
          </button>

          <button
            onClick={() => setPayFilter(payFilter === "paid" ? "all" : "paid")}
            className={`rounded-lg border p-3 text-left transition-colors ${payFilter === "paid" ? "bg-emerald-900/30 border-emerald-600" : "bg-slate-800/50 border-slate-700 hover:bg-slate-700/50"}`}
          >
            <div className="flex items-center gap-1.5 mb-1">
              <CheckCircle2 className="h-3.5 w-3.5 text-emerald-400" />
              <span className="text-xs text-slate-400">Lunas</span>
            </div>
            <div className="text-sm font-bold text-slate-200">{stats.paidCount} invoice</div>
            <div className="text-xs text-emerald-400 font-mono">{idr(stats.paidAmount)}</div>
          </button>

          <div className="rounded-lg border border-slate-700 bg-slate-800/50 p-3">
            <div className="flex items-center gap-1.5 mb-1">
              <Banknote className="h-3.5 w-3.5 text-blue-400" />
              <span className="text-xs text-slate-400">Total Ditagihkan</span>
            </div>
            <div className="text-sm font-bold text-slate-200">{stats.totalInvoiced} invoice</div>
            <div className="text-xs text-blue-400 font-mono">{idr(stats.totalAmount)}</div>
          </div>
        </div>

        <Card>
          <CardHeader className="pb-3">
            <div className="flex items-center justify-between flex-wrap gap-2">
              <CardTitle className="text-base">
                Daftar Invoice
                {payFilter !== "all" && (
                  <Badge
                    variant="outline"
                    className="ml-2 text-xs cursor-pointer"
                    onClick={() => setPayFilter("all")}
                  >
                    Filter: {payFilter === "unpaid" ? "Belum Bayar" : payFilter === "partial" ? "Sebagian" : payFilter === "paid" ? "Lunas" : payFilter} ✕
                  </Badge>
                )}
              </CardTitle>
              <div className="flex gap-1.5 flex-wrap">
                <Button size="sm" variant={payFilter === "all" ? "default" : "outline"} className="h-7 text-xs" onClick={() => setPayFilter("all")}>Semua</Button>
                <Button size="sm" variant={payFilter === "unpaid" ? "default" : "outline"} className="h-7 text-xs" onClick={() => setPayFilter("unpaid")}>Belum Bayar</Button>
                <Button size="sm" variant={payFilter === "partial" ? "default" : "outline"} className="h-7 text-xs" onClick={() => setPayFilter("partial")}>Sebagian</Button>
                <Button size="sm" variant={payFilter === "paid" ? "default" : "outline"} className="h-7 text-xs" onClick={() => setPayFilter("paid")}>Lunas</Button>
              </div>
            </div>
          </CardHeader>
          <CardContent>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>No. Invoice</TableHead>
                  <TableHead>No. Order</TableHead>
                  <TableHead>Customer</TableHead>
                  <TableHead>Status Invoice</TableHead>
                  <TableHead>Status Bayar</TableHead>
                  <TableHead className="text-right">Total</TableHead>
                  <TableHead className="text-right">Sisa Tagihan</TableHead>
                  <TableHead>Tgl Invoice</TableHead>
                  <TableHead>Jatuh Tempo</TableHead>
                  <TableHead></TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {filtered.map((d) => {
                  const balanceDue = Math.max(0, Number(d.grandTotal) - Number(d.amountPaid ?? 0));
                  const effectivePayStatus = balanceDue === 0 ? "paid" : (Number(d.amountPaid ?? 0) > 0 ? "partial" : "unpaid");
                  const displayPayStatus = d.invoiceStatus === "invoiced" ? (d.paymentStatus ?? effectivePayStatus) : effectivePayStatus;
                  const canPay = d.invoiceStatus === "invoiced" && displayPayStatus !== "paid" && !(d as any).cancelledAt;
                  const isOverdue = (d as any).dueDate && new Date((d as any).dueDate) < new Date() && displayPayStatus !== "paid" && d.invoiceStatus === "invoiced";
                  return (
                    <TableRow key={d.id} className={(d as any).cancelledAt ? "opacity-50" : undefined}>
                      <TableCell className="font-mono text-xs text-indigo-400">
                        {(d as any).invoiceNumber ?? <span className="text-slate-600">—</span>}
                      </TableCell>
                      <TableCell>
                        <Link href={`/sales/orders/${d.id}`}>
                          <Badge className="bg-indigo-900/40 text-indigo-300 border-indigo-700 text-xs gap-1 cursor-pointer hover:bg-indigo-900/60 font-mono">
                            <ShoppingCart className="h-3 w-3" /> {d.docNumber}
                          </Badge>
                        </Link>
                      </TableCell>
                      <TableCell>{d.customerName}</TableCell>
                      <TableCell>
                        {(d as any).cancelledAt ? (
                          <Badge className="bg-slate-700/60 text-slate-400 border-slate-600 text-xs">Dibatalkan</Badge>
                        ) : (
                          <Badge variant={d.invoiceStatus === "invoiced" ? "default" : "outline"} className="capitalize">
                            {d.invoiceStatus === "invoiced" ? "Posted" : d.invoiceStatus.replace("_", " ")}
                          </Badge>
                        )}
                      </TableCell>
                      <TableCell>
                        {d.invoiceStatus === "invoiced" && !(d as any).cancelledAt ? (
                          <PaymentStatusBadge status={displayPayStatus} />
                        ) : (
                          <span className="text-slate-500 text-xs">-</span>
                        )}
                      </TableCell>
                      <TableCell className="text-right font-medium">{idr(Number(d.grandTotal ?? d.totalAmount))}</TableCell>
                      <TableCell className="text-right">
                        {d.invoiceStatus === "invoiced" && !(d as any).cancelledAt && balanceDue > 0 ? (
                          <span className={`font-mono text-sm ${isOverdue ? "text-red-400" : "text-amber-400"}`}>{idr(balanceDue)}</span>
                        ) : d.invoiceStatus === "invoiced" && !(d as any).cancelledAt && balanceDue === 0 ? (
                          <span className="text-emerald-400 text-xs">✓ Lunas</span>
                        ) : (
                          <span className="text-slate-500 text-xs">-</span>
                        )}
                      </TableCell>
                      <TableCell className="text-xs text-slate-400">
                        {(d as any).invoiceDate ? new Date((d as any).invoiceDate + "T00:00:00").toLocaleDateString("id-ID", { day: "2-digit", month: "short", year: "numeric" }) : "—"}
                      </TableCell>
                      <TableCell className={`text-xs ${isOverdue ? "text-red-400 font-semibold" : "text-slate-400"}`}>
                        {(d as any).dueDate ? new Date((d as any).dueDate + "T00:00:00").toLocaleDateString("id-ID", { day: "2-digit", month: "short", year: "numeric" }) : "—"}
                        {isOverdue && <span className="ml-1">(Lewat)</span>}
                      </TableCell>
                      <TableCell>
                        <div className="flex items-center gap-1 flex-wrap">
                          {canPay && (
                            <Button
                              size="sm"
                              variant="outline"
                              className="gap-1 h-7 text-xs"
                              onClick={() => openPayDialog({
                                id: d.id,
                                docNumber: d.docNumber,
                                customerName: d.customerName,
                                grandTotal: Number(d.grandTotal ?? d.totalAmount),
                                amountPaid: Number(d.amountPaid ?? 0),
                              })}
                            >
                              <CreditCard className="h-3 w-3" /> Bayar
                            </Button>
                          )}
                          {d.invoiceStatus === "invoiced" && !(d as any).cancelledAt && (
                            <Button
                              size="sm"
                              variant="ghost"
                              className="gap-1 h-7 text-xs text-green-400 hover:text-green-300 hover:bg-green-900/20"
                              onClick={() => openWaDialog({
                                id: d.id,
                                docNumber: d.docNumber,
                                invoiceNumber: (d as any).invoiceNumber,
                                customerName: d.customerName,
                                grandTotal: Number(d.grandTotal ?? d.totalAmount),
                                dueDate: (d as any).dueDate,
                              })}
                            >
                              <Send className="h-3 w-3" /> WA
                            </Button>
                          )}
                          <Button
                            size="sm"
                            variant="ghost"
                            className="gap-1 h-7 text-xs text-muted-foreground"
                            onClick={() => setCorrDocId(d.id)}
                          >
                            <MessageSquare className="h-3 w-3" />
                          </Button>
                        </div>
                      </TableCell>
                    </TableRow>
                  );
                })}
                {filtered.length === 0 && (
                  <TableRow>
                    <TableCell colSpan={10} className="text-center text-muted-foreground py-8">
                      {payFilter !== "all" ? `Tidak ada invoice dengan status "${payFilter === "unpaid" ? "Belum Bayar" : payFilter === "partial" ? "Sebagian" : "Lunas"}".` : "Belum ada invoice."}
                    </TableCell>
                  </TableRow>
                )}
              </TableBody>
            </Table>
          </CardContent>
        </Card>

        {/* Dialog Catat Pembayaran */}
        <Dialog open={!!payDoc} onOpenChange={(v) => { if (!v) closePayDialog(); }}>
          <DialogContent className="max-w-md">
            <DialogHeader>
              <DialogTitle>Catat Pembayaran — {payDoc?.docNumber}</DialogTitle>
            </DialogHeader>
            <div className="space-y-4 py-2">
              <div className="text-sm text-muted-foreground">
                Customer: <span className="font-medium text-foreground">{payDoc?.customerName}</span>
              </div>
              {payDoc && payDoc.amountPaid > 0 && (
                <div className="text-xs rounded bg-amber-900/20 border border-amber-700/30 p-2 text-amber-300">
                  Sudah dibayar: {idr(payDoc.amountPaid)} — Sisa tagihan: {idr(Math.max(0, payDoc.grandTotal - payDoc.amountPaid))}
                </div>
              )}
              <div className="rounded bg-slate-800/60 border border-slate-700 p-2.5 text-xs text-slate-400">
                Jurnal otomatis yang akan dibuat:<br />
                <span className="text-emerald-400">DR</span> Kas / Bank &nbsp;·&nbsp; <span className="text-rose-400">CR</span> Piutang Usaha (AR)
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1">
                  <Label>Tanggal</Label>
                  <DatePicker value={payForm.date} onChange={(v) => setPayForm((f) => ({ ...f, date: v }))} />
                </div>
                <div className="space-y-1">
                  <Label>Jumlah (IDR)</Label>
                  <Input
                    type="number"
                    min="0"
                    step="1000"
                    value={payForm.amount}
                    onChange={(e) => setPayForm((f) => ({ ...f, amount: e.target.value }))}
                  />
                </div>
              </div>
              <div className="space-y-1">
                <Label>Jurnal (Bank / Kas)</Label>
                <Select
                  value={payForm.journalId}
                  onValueChange={(v) => setPayForm((f) => ({ ...f, journalId: v }))}
                >
                  <SelectTrigger>
                    <SelectValue placeholder="Pilih jurnal..." />
                  </SelectTrigger>
                  <SelectContent>
                    {bankCashJournals.map((j) => (
                      <SelectItem key={j.id} value={String(j.id)}>
                        [{j.code}] {j.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1">
                <Label>No. Referensi</Label>
                <Input
                  value={payForm.ref}
                  onChange={(e) => setPayForm((f) => ({ ...f, ref: e.target.value }))}
                />
              </div>
              <div className="space-y-1">
                <Label>Memo</Label>
                <Textarea
                  rows={2}
                  value={payForm.memo}
                  onChange={(e) => setPayForm((f) => ({ ...f, memo: e.target.value }))}
                />
              </div>
            </div>
            <DialogFooter>
              <Button variant="outline" onClick={closePayDialog}>Batal</Button>
              <Button onClick={submitPayment} disabled={createMut.isPending}>
                {createMut.isPending ? "Menyimpan..." : "Konfirmasi Pembayaran"}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>

        {/* Dialog Kirim WA Invoice ke Customer */}
        <Dialog open={!!waDoc} onOpenChange={(v) => { if (!v) { setWaDoc(null); setWaResult(null); } }}>
          <DialogContent className="max-w-md">
            <DialogHeader>
              <DialogTitle className="flex items-center gap-2">
                <Send className="h-4 w-4 text-green-400" />
                Kirim Invoice ke Customer
              </DialogTitle>
            </DialogHeader>
            {waDoc && !waResult && (
              <div className="space-y-4 py-2">
                <div className="rounded-lg bg-slate-800/50 border border-slate-700 p-3 text-sm space-y-1">
                  <div className="flex justify-between">
                    <span className="text-slate-400">Dokumen</span>
                    <span className="font-mono text-indigo-300">{waDoc.invoiceNumber ?? waDoc.docNumber}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-slate-400">Customer</span>
                    <span className="font-medium">{waDoc.customerName}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-slate-400">Total</span>
                    <span className="font-semibold text-blue-300">{idr(waDoc.grandTotal)}</span>
                  </div>
                  {waDoc.dueDate && (
                    <div className="flex justify-between">
                      <span className="text-slate-400">Jatuh Tempo</span>
                      <span>{new Date(waDoc.dueDate + "T00:00:00").toLocaleDateString("id-ID", { day: "numeric", month: "long", year: "numeric" })}</span>
                    </div>
                  )}
                </div>
                <div className="space-y-1.5">
                  <Label>No. WhatsApp Customer <span className="text-slate-500 font-normal text-xs">(opsional)</span></Label>
                  <Input
                    placeholder="62812345678xx"
                    value={waForm.phone}
                    onChange={(e) => setWaForm(f => ({ ...f, phone: e.target.value }))}
                  />
                </div>
                <div className="space-y-1.5">
                  <Label>Catatan Tambahan <span className="text-slate-500 font-normal text-xs">(opsional)</span></Label>
                  <Textarea
                    rows={2}
                    placeholder="Contoh: Mohon segera dilunasi sebelum jatuh tempo"
                    value={waForm.notes}
                    onChange={(e) => setWaForm(f => ({ ...f, notes: e.target.value }))}
                  />
                </div>
              </div>
            )}
            {waResult && (
              <div className="py-4 space-y-3">
                <div className="rounded-lg bg-green-900/20 border border-green-700/40 p-3 text-center">
                  <p className="text-green-300 font-semibold text-sm mb-1">✅ Link invoice berhasil dibuat</p>
                  {waForm.phone && <p className="text-xs text-green-400">WA terkirim ke {waForm.phone}</p>}
                </div>
                <div className="space-y-1">
                  <Label className="text-xs text-slate-400">Link Invoice Publik</Label>
                  <div className="flex gap-2">
                    <Input readOnly value={waResult.url} className="font-mono text-xs" />
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() => { navigator.clipboard.writeText(waResult.url); toast({ title: "Link disalin" }); }}
                    >
                      Salin
                    </Button>
                  </div>
                </div>
              </div>
            )}
            <DialogFooter>
              <Button variant="outline" onClick={() => { setWaDoc(null); setWaResult(null); }}>
                {waResult ? "Tutup" : "Batal"}
              </Button>
              {!waResult && (
                <Button onClick={sendWaInvoice} disabled={waSending} className="gap-1.5">
                  <Send className="h-3.5 w-3.5" />
                  {waSending ? "Membuat..." : waForm.phone ? "Buat & Kirim WA" : "Buat Link Invoice"}
                </Button>
              )}
            </DialogFooter>
          </DialogContent>
        </Dialog>

        <Dialog open={corrDocId !== null} onOpenChange={(v) => { if (!v) setCorrDocId(null); }}>
          <DialogContent className="max-w-2xl max-h-[85vh] overflow-y-auto">
            <DialogHeader>
              <DialogTitle className="flex items-center gap-2">
                <MessageSquare className="h-4 w-4" /> Korespondensi Email — Invoice
              </DialogTitle>
            </DialogHeader>
            {corrDocId !== null && (
              <CorrespondenceTab linkedType="invoice" linkedId={corrDocId} />
            )}
            <DialogFooter>
              <Button variant="outline" onClick={() => setCorrDocId(null)}>Tutup</Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </div>
    </AppShell>
  );
}
