import { DatePicker } from "@/components/ui/date-picker";
import { useState, useMemo } from "react";
import { Link } from "wouter";
import { AppShell } from "@/components/layout/AppShell";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle, DialogTrigger,
} from "@/components/ui/dialog";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { useToast } from "@/hooks/use-toast";
import { useLanguage } from "@/contexts/LanguageContext";
import { useCompany } from "@/contexts/CompanyContext";
import { useQueryClient } from "@tanstack/react-query";
import { Plus, ArrowDownLeft, ArrowUpRight, ExternalLink, FileText, ChevronDown, ChevronUp, Users, Ban, MessageSquare, ShoppingCart, Printer, Download, Activity, ArrowLeft, ArrowRight, Info } from "lucide-react";
import { exportXlsx, printWindow } from "@/lib/export";
import { CorrespondenceTab } from "@/components/CorrespondenceTab";
import {
  useListAccountingPayments,
  getListAccountingPaymentsQueryKey,
  useCreateAccountingPayment,
  useVoidAccountingPayment,
  useListJournals,
  useGetPartnerBalances,
  getGetPartnerBalancesQueryKey,
  type AccountingPayment,
  type PartnerBalanceEntry,
} from "@workspace/api-client-react";
import {
  Collapsible, CollapsibleContent, CollapsibleTrigger,
} from "@/components/ui/collapsible";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";

const idr = (n: number) =>
  new Intl.NumberFormat("id-ID", { minimumFractionDigits: 0, maximumFractionDigits: 2 }).format(n);

const formatDate = (s: string) =>
  new Date(s + "T00:00:00").toLocaleDateString("id-ID", { day: "2-digit", month: "short", year: "numeric" });

const formatIsoDate = (s: string) =>
  new Date(s).toLocaleDateString("id-ID", { day: "2-digit", month: "short", year: "numeric" });

function LinkedDocBadge({ sourceType, sourceDocId }: { sourceType?: string | null; sourceDocId?: number | null }) {
  if (!sourceType || !sourceDocId) return <span className="text-slate-600 text-xs">-</span>;
  if (sourceType === "sales_order") {
    return (
      <Link href={`/sales/orders/${sourceDocId}`}>
        <Badge className="bg-indigo-900/40 text-indigo-300 border-indigo-700 text-xs gap-1 cursor-pointer hover:bg-indigo-900/60">
          <ShoppingCart className="h-3 w-3" /> SO #{sourceDocId}
        </Badge>
      </Link>
    );
  }
  if (sourceType === "sport_center") {
    return (
      <Link href="/sport-center/payments">
        <Badge className="bg-emerald-900/40 text-emerald-300 border-emerald-700 text-xs gap-1 cursor-pointer hover:bg-emerald-900/60">
          <Activity className="h-3 w-3" /> Sport Center
        </Badge>
      </Link>
    );
  }
  return (
    <Link href={`/purchase/orders/${sourceDocId}`}>
      <Badge className="bg-violet-900/40 text-violet-300 border-violet-700 text-xs gap-1 cursor-pointer hover:bg-violet-900/60">
        <FileText className="h-3 w-3" /> PO #{sourceDocId}
      </Badge>
    </Link>
  );
}

function VoidDialog({ payment, onVoided }: { payment: AccountingPayment; onVoided: () => void }) {
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState("");
  const { toast } = useToast();
  const { t } = useLanguage();
  const voidMut = useVoidAccountingPayment();

  const handleVoid = async () => {
    try {
      await voidMut.mutateAsync({ id: payment.id, data: { reason: reason.trim() || undefined } });
      toast({ title: t.common.success });
      setOpen(false);
      setReason("");
      onVoided();
    } catch (err: unknown) {
      const msg = (err as { response?: { data?: { message?: string } } })?.response?.data?.message ?? String(err);
      toast({ title: t.common.error, description: msg, variant: "destructive" });
    }
  };

  return (
    <Dialog open={open} onOpenChange={(v) => { setOpen(v); if (!v) setReason(""); }}>
      <DialogTrigger asChild>
        <Button
          variant="ghost"
          size="sm"
          className="h-6 text-xs gap-1 text-red-400 hover:text-red-300 hover:bg-red-900/20 px-2"
          data-testid={`void-btn-${payment.id}`}
        >
          <Ban className="h-3 w-3" /> Batalkan
        </Button>
      </DialogTrigger>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Batalkan Pembayaran?</DialogTitle>
        </DialogHeader>
        <div className="space-y-3 py-2 text-sm text-slate-300">
          <p>
            Tindakan ini akan membuat <strong>jurnal pembalik otomatis</strong> (DR/CR dibalik) dan
            menandai pembayaran ini sebagai <strong>Dibatalkan</strong>.
          </p>
          <div className="rounded-md border border-slate-700 bg-slate-800 p-3 space-y-1 text-xs font-mono">
            <div className="flex justify-between">
              <span className="text-slate-400">Mitra</span>
              <span>{payment.partnerName ?? "-"}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-slate-400">Jumlah</span>
              <span className={payment.paymentType === "inbound" ? "text-emerald-400" : "text-red-400"}>
                {idr(payment.amount)}
              </span>
            </div>
            <div className="flex justify-between">
              <span className="text-slate-400">Tanggal</span>
              <span>{formatDate(payment.date)}</span>
            </div>
            {payment.ref && (
              <div className="flex justify-between">
                <span className="text-slate-400">Ref</span>
                <span>{payment.ref}</span>
              </div>
            )}
          </div>
          <div className="space-y-1">
            <Label className="text-slate-300 text-xs">Alasan Pembatalan <span className="text-slate-500">(opsional)</span></Label>
            <Textarea
              placeholder="Mis. jumlah salah input, pembayaran ganda..."
              rows={2}
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              className="text-sm resize-none"
              data-testid={`void-reason-${payment.id}`}
            />
          </div>
          <p className="text-amber-400 text-xs">
            Aksi ini tidak dapat dibatalkan. Jurnal pembalik akan langsung diposting.
          </p>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => { setOpen(false); setReason(""); }} disabled={voidMut.isPending}>
            Kembali
          </Button>
          <Button
            variant="destructive"
            onClick={handleVoid}
            disabled={voidMut.isPending}
            data-testid={`void-confirm-btn-${payment.id}`}
          >
            {voidMut.isPending ? "Membatalkan..." : "Ya, Batalkan"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export default function PaymentsPage() {
  const qc = useQueryClient();
  const { toast } = useToast();
  const { t } = useLanguage();
  const [filter, setFilter] = useState<{
    paymentType?: "inbound" | "outbound";
    from?: string;
    to?: string;
    sourceType?: string;
    refDocNumber?: string;
  }>(() => {
    try {
      const p = new URLSearchParams(window.location.search);
      const refDocNumber = p.get("refDocNumber");
      const sourceType = p.get("sourceType");
      return {
        ...(refDocNumber ? { refDocNumber } : {}),
        ...(sourceType ? { sourceType } : {}),
      };
    } catch {
      return {};
    }
  });
  const [refSearch, setRefSearch] = useState("");

  const { activeCompanyId, isConsolidated } = useCompany();
  const params = useMemo(() => ({
    ...(filter.paymentType ? { paymentType: filter.paymentType } : {}),
    ...(filter.from ? { from: new Date(filter.from).toISOString() } : {}),
    ...(filter.to ? { to: new Date(filter.to + "T23:59:59").toISOString() } : {}),
    ...(filter.sourceType && filter.sourceType !== "all" ? { sourceType: filter.sourceType } : {}),
    ...(filter.refDocNumber ? { refDocNumber: filter.refDocNumber } : {}),
    company: (isConsolidated ? "all" : activeCompanyId) as unknown as number,
  }), [filter, activeCompanyId, isConsolidated]);

  const { data: allPayments = [] as AccountingPayment[], isLoading } = useListAccountingPayments(params as any, {
    query: { queryKey: getListAccountingPaymentsQueryKey(params as any) },
  });

  const payments = useMemo(() => {
    if (!refSearch.trim()) return allPayments;
    const search = refSearch.trim().toLowerCase();
    return allPayments.filter((p) =>
      (p.ref ?? "").toLowerCase().includes(search) ||
      (p.partnerName ?? "").toLowerCase().includes(search)
    );
  }, [allPayments, refSearch]);

  const { data: journals = [] } = useListJournals();
  const bankCashJournals = journals.filter((j) => j.type === "bank" || j.type === "cash");

  const { data: partnerBalances } = useGetPartnerBalances();
  const [corrPaymentId, setCorrPaymentId] = useState<number | null>(null);
  const [balancesOpen, setBalancesOpen] = useState(false);
  const [expandedArPartners, setExpandedArPartners] = useState<Set<string>>(new Set());
  const [expandedApPartners, setExpandedApPartners] = useState<Set<string>>(new Set());

  const arGroups = useMemo(() => {
    if (!partnerBalances) return [];
    const map = new Map<string, { entries: typeof partnerBalances.ar; total: number }>();
    for (const e of partnerBalances.ar) {
      const g = map.get(e.partnerName) ?? { entries: [], total: 0 };
      g.entries.push(e);
      g.total += e.balance;
      map.set(e.partnerName, g);
    }
    return [...map.entries()]
      .map(([name, g]) => ({ name, entries: g.entries, total: g.total }))
      .sort((a, b) => b.total - a.total);
  }, [partnerBalances]);

  const apGroups = useMemo(() => {
    if (!partnerBalances) return [];
    const map = new Map<string, { entries: typeof partnerBalances.ap; total: number }>();
    for (const e of partnerBalances.ap) {
      const g = map.get(e.partnerName) ?? { entries: [], total: 0 };
      g.entries.push(e);
      g.total += e.balance;
      map.set(e.partnerName, g);
    }
    return [...map.entries()]
      .map(([name, g]) => ({ name, entries: g.entries, total: g.total }))
      .sort((a, b) => b.total - a.total);
  }, [partnerBalances]);

  const createMut = useCreateAccountingPayment();
  const [open, setOpen] = useState(false);
  const today = new Date().toISOString().slice(0, 10);

  const emptyForm = {
    paymentType: "inbound" as "inbound" | "outbound",
    amount: "",
    journalId: "",
    partnerName: "",
    date: today,
    ref: "",
    memo: "",
    sourceType: undefined as string | undefined,
    sourceDocId: undefined as number | undefined,
  };
  const [form, setForm] = useState(emptyForm);

  const reset = () => setForm(emptyForm);

  const activePayments = payments.filter((p) => p.status !== "voided");
  const totalInbound = activePayments.filter((p) => p.paymentType === "inbound").reduce((s, p) => s + p.amount, 0);
  const totalOutbound = activePayments.filter((p) => p.paymentType === "outbound").reduce((s, p) => s + p.amount, 0);

  const prefillFromPartner = (entry: PartnerBalanceEntry, paymentType: "inbound" | "outbound") => {
    setForm((f) => ({
      ...f,
      partnerName: entry.partnerName,
      amount: String(Math.round(entry.balance * 100) / 100),
      paymentType,
      sourceType: entry.sourceType,
      sourceDocId: entry.sourceDocId,
      ref: entry.docNumber,
    }));
    setOpen(true);
  };

  const submit = async () => {
    if (!form.paymentType || !form.amount || !form.journalId || !form.date) {
      toast({ title: t.common.error, variant: "destructive" });
      return;
    }
    const amt = Number(form.amount);
    if (Number.isNaN(amt) || amt <= 0) {
      toast({ title: t.common.error, variant: "destructive" });
      return;
    }
    try {
      await createMut.mutateAsync({
        data: {
          paymentType: form.paymentType,
          amount: amt,
          journalId: Number(form.journalId),
          partnerName: form.partnerName || undefined,
          date: form.date,
          ref: form.ref || undefined,
          memo: form.memo || undefined,
          sourceType: form.sourceType || undefined,
          sourceDocId: form.sourceDocId || undefined,
        },
      });
      toast({ title: t.common.success });
      await Promise.all([
        qc.invalidateQueries({ queryKey: getListAccountingPaymentsQueryKey() }),
        qc.invalidateQueries({ queryKey: getGetPartnerBalancesQueryKey() }),
      ]);
      setOpen(false);
      reset();
    } catch (err: unknown) {
      const msg = (err as { response?: { data?: { message?: string } } })?.response?.data?.message ?? String(err);
      toast({ title: t.common.error, description: msg, variant: "destructive" });
    }
  };

  const resetFilters = () => {
    setFilter({});
    setRefSearch("");
  };

  const hasFilters = filter.paymentType || filter.from || filter.to || filter.sourceType || filter.refDocNumber || refSearch;

  const handleVoided = async () => {
    await Promise.all([
      qc.invalidateQueries({ queryKey: getListAccountingPaymentsQueryKey() }),
      qc.invalidateQueries({ queryKey: getGetPartnerBalancesQueryKey() }),
    ]);
  };

  return (
    <AppShell>
      <div className="space-y-6">
        {/* ── Banner Redirect ── */}
        <div className="rounded-xl border border-amber-600/40 bg-amber-950/30 p-4">
          <div className="flex items-start gap-3">
            <div className="flex-shrink-0 mt-0.5">
              <Info className="h-5 w-5 text-amber-400" />
            </div>
            <div className="flex-1 min-w-0">
              <p className="text-sm font-semibold text-amber-300 mb-0.5">Menu Historis & Penerimaan (AR)</p>
              <p className="text-sm text-amber-200/80 leading-relaxed">
                Halaman ini menyimpan histori pembayaran lama dan digunakan untuk mencatat <strong>penerimaan dari pelanggan (AR)</strong>.
                Untuk transaksi <strong>pembayaran keluar baru</strong> (ke supplier, biaya operasional, pajak, dll.),
                gunakan <strong>Bank Disbursement</strong>.
              </p>
            </div>
            <Link href="/accounting/bank-disbursements">
              <button
                type="button"
                className="flex-shrink-0 flex items-center gap-2 rounded-lg bg-orange-500 hover:bg-orange-600 text-white text-sm font-semibold px-4 py-2 transition-colors whitespace-nowrap"
              >
                Buka Bank Disbursement
                <ArrowRight className="h-4 w-4" />
              </button>
            </Link>
          </div>
        </div>

        <div className="flex items-center justify-between">
          <div>
            <Link href="/accounting"><Button variant="ghost" size="icon" aria-label="Kembali"><ArrowLeft className="h-4 w-4" /></Button></Link>
            <h1 className="text-2xl font-bold text-slate-50">Payments <span className="text-slate-400 font-normal text-lg">(Historis &amp; Penerimaan)</span></h1>
            <p className="text-slate-400 text-sm mt-1">
              Histori pembayaran &amp; penerimaan AR. Pembayaran keluar baru → Bank Disbursement.
            </p>
          </div>
          <div className="flex gap-2">
            <Button variant="outline" size="sm" onClick={() => printWindow(
              "Pembayaran",
              ["Tanggal", "Tipe", "Status", "Mitra", "Referensi", "Jumlah", "Jurnal"],
              payments.map((p) => {
                const j = journals.find((x) => x.id === p.journalId);
                return [
                  p.date,
                  p.paymentType === "inbound" ? "Masuk" : "Keluar",
                  p.status === "voided" ? "Dibatalkan" : "Diposting",
                  p.partnerName ?? "",
                  p.ref ?? "",
                  p.amount,
                  j ? `[${j.code}] ${j.name}` : "",
                ];
              }),
              [5]
            )} disabled={payments.length === 0}>
              <Printer className="h-4 w-4 mr-1.5" />Print Preview
            </Button>
            <Button variant="outline" size="sm" onClick={() => exportXlsx(
              "Pembayaran",
              ["Tanggal", "Tipe", "Status", "Mitra", "Referensi", "Jumlah", "Jurnal"],
              payments.map((p) => {
                const j = journals.find((x) => x.id === p.journalId);
                return [
                  p.date,
                  p.paymentType === "inbound" ? "Masuk" : "Keluar",
                  p.status === "voided" ? "Dibatalkan" : "Diposting",
                  p.partnerName ?? "",
                  p.ref ?? "",
                  p.amount,
                  j ? `[${j.code}] ${j.name}` : "",
                ];
              })
            )} disabled={payments.length === 0}>
              <Download className="h-4 w-4 mr-1.5" />Export XLSX
            </Button>
            <Dialog open={open} onOpenChange={(v) => { setOpen(v); if (!v) reset(); }}>
              <DialogTrigger asChild>
                <Button className="gap-2"><Plus className="h-4 w-4" /> Catat Penerimaan</Button>
              </DialogTrigger>
            <DialogContent className="max-w-lg">
              <DialogHeader>
                <DialogTitle>Catat Penerimaan Manual (AR)</DialogTitle>
              </DialogHeader>
              <div className="space-y-4 py-2">
                <div className="rounded border border-orange-700/40 bg-orange-900/20 px-3 py-2 text-xs text-orange-300">
                  ⚠️ Pembayaran keluar (ke supplier) sekarang diproses melalui <strong>Finance → Bank Disbursement</strong>. Halaman ini hanya untuk mencatat penerimaan dari pelanggan (AR).
                </div>
                <div className="space-y-1">
                  <Label>Tipe Pembayaran</Label>
                  <div className="flex items-center gap-2 rounded border border-emerald-700/40 bg-emerald-900/10 px-3 py-2 text-sm text-emerald-300">
                    <ArrowDownLeft className="h-4 w-4 shrink-0" />
                    Bayar Masuk (Penerimaan) — Posting: DR Bank/Kas → CR Piutang (AR)
                  </div>
                </div>

                {form.sourceDocId && (
                  <div className="flex items-center gap-2 rounded-md border border-indigo-700/50 bg-indigo-900/20 px-3 py-2 text-xs text-indigo-300">
                    <FileText className="h-3.5 w-3.5 shrink-0" />
                    <span>
                      Melunasi{" "}
                      <span className="font-mono font-semibold">{form.ref}</span>
                      {" — "}saldo akan diperbarui otomatis setelah disimpan.
                    </span>
                  </div>
                )}

                <div className="grid grid-cols-2 gap-3">
                  <div className="space-y-1">
                    <Label>Tanggal</Label>
                    <DatePicker value={form.date} onChange={(v) => setForm((f) => ({ ...f, date: v }))} />
                  </div>
                  <div className="space-y-1">
                    <Label>Jumlah (IDR)</Label>
                    <Input
                      type="number"
                      min="0"
                      step="1000"
                      placeholder="0"
                      value={form.amount}
                      onChange={(e) => setForm((f) => ({ ...f, amount: e.target.value }))}
                    />
                  </div>
                </div>

                <div className="space-y-1">
                  <Label>Jurnal (Bank / Kas)</Label>
                  <Select
                    value={form.journalId || undefined}
                    onValueChange={(v) => setForm((f) => ({ ...f, journalId: v }))}
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
                  <Label>Nama Mitra (Opsional)</Label>
                  <Input
                    placeholder="Nama pelanggan / pemasok"
                    value={form.partnerName}
                    onChange={(e) => setForm((f) => ({ ...f, partnerName: e.target.value }))}
                  />
                </div>

                <div className="space-y-1">
                  <Label>No. Referensi (Opsional)</Label>
                  <Input
                    placeholder="Mis. INV/2024/001 atau PO-005"
                    value={form.ref}
                    onChange={(e) => setForm((f) => ({ ...f, ref: e.target.value }))}
                  />
                </div>

                <div className="space-y-1">
                  <Label>Memo (Opsional)</Label>
                  <Textarea
                    placeholder="Keterangan tambahan..."
                    rows={2}
                    value={form.memo}
                    onChange={(e) => setForm((f) => ({ ...f, memo: e.target.value }))}
                  />
                </div>
              </div>
              <DialogFooter>
                <Button variant="outline" onClick={() => { setOpen(false); reset(); }}>Batal</Button>
                <Button onClick={submit} disabled={createMut.isPending}>
                  {createMut.isPending ? "Menyimpan..." : "Simpan & Posting"}
                </Button>
              </DialogFooter>
            </DialogContent>
          </Dialog>
        </div>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <Card className="border-emerald-800/40 bg-slate-900">
            <CardHeader className="pb-2">
              <CardTitle className="text-sm font-medium text-slate-400 flex items-center gap-2">
                <ArrowDownLeft className="h-4 w-4 text-emerald-400" /> Total Bayar Masuk
              </CardTitle>
            </CardHeader>
            <CardContent>
              <p className="text-2xl font-bold text-emerald-400">{idr(totalInbound)}</p>
            </CardContent>
          </Card>
          <Card className="border-red-800/40 bg-slate-900">
            <CardHeader className="pb-2">
              <CardTitle className="text-sm font-medium text-slate-400 flex items-center gap-2">
                <ArrowUpRight className="h-4 w-4 text-red-400" /> Total Bayar Keluar
              </CardTitle>
            </CardHeader>
            <CardContent>
              <p className="text-2xl font-bold text-red-400">{idr(totalOutbound)}</p>
            </CardContent>
          </Card>
        </div>

        <Collapsible open={balancesOpen} onOpenChange={setBalancesOpen}>
          <Card className="border-slate-700 bg-slate-900">
            <CollapsibleTrigger asChild>
              <CardHeader className="cursor-pointer hover:bg-slate-800/50 rounded-t-lg transition-colors pb-3">
                <div className="flex items-center justify-between">
                  <CardTitle className="text-sm font-medium text-slate-300 flex items-center gap-2">
                    <Users className="h-4 w-4 text-indigo-400" /> Saldo Terbuka per Mitra
                    {partnerBalances && (partnerBalances.ar.length + partnerBalances.ap.length) > 0 && (
                      <Badge className="bg-indigo-900/50 text-indigo-300 border-indigo-700 text-xs ml-1">
                        {partnerBalances.ar.length + partnerBalances.ap.length}
                      </Badge>
                    )}
                  </CardTitle>
                  <div className="flex items-center gap-4 text-xs text-slate-400">
                    {partnerBalances && (
                      <>
                        <span className="text-emerald-400 font-mono">AR: {idr(partnerBalances.totalAr)}</span>
                        <span className="text-red-400 font-mono">AP: {idr(partnerBalances.totalAp)}</span>
                      </>
                    )}
                    {balancesOpen ? <ChevronUp className="h-4 w-4 text-slate-400" /> : <ChevronDown className="h-4 w-4 text-slate-400" />}
                  </div>
                </div>
              </CardHeader>
            </CollapsibleTrigger>
            <CollapsibleContent>
              <CardContent className="pt-0">
                {!partnerBalances ? (
                  <p className="text-slate-500 text-sm py-4 text-center">Memuat...</p>
                ) : (partnerBalances.ar.length === 0 && partnerBalances.ap.length === 0) ? (
                  <p className="text-slate-500 text-sm py-4 text-center">Tidak ada saldo terbuka. Semua piutang dan hutang telah lunas.</p>
                ) : (
                  <Tabs defaultValue="ar">
                    <TabsList className="mb-3">
                      <TabsTrigger value="ar" className="gap-1.5 text-xs">
                        <ArrowDownLeft className="h-3 w-3 text-emerald-400" />
                        Piutang (AR)
                        {arGroups.length > 0 && (
                          <Badge className="bg-emerald-900/50 text-emerald-300 border-emerald-700 text-xs ml-1">
                            {arGroups.length}
                          </Badge>
                        )}
                      </TabsTrigger>
                      <TabsTrigger value="ap" className="gap-1.5 text-xs">
                        <ArrowUpRight className="h-3 w-3 text-red-400" />
                        Hutang (AP)
                        {apGroups.length > 0 && (
                          <Badge className="bg-red-900/50 text-red-300 border-red-700 text-xs ml-1">
                            {apGroups.length}
                          </Badge>
                        )}
                      </TabsTrigger>
                    </TabsList>
                    <TabsContent value="ar">
                      {arGroups.length === 0 ? (
                        <p className="text-slate-500 text-sm py-3 text-center">Tidak ada piutang terbuka.</p>
                      ) : (
                        <div className="space-y-1">
                          {arGroups.map((group) => {
                            const isOpen = expandedArPartners.has(group.name);
                            const toggle = () => setExpandedArPartners((prev) => {
                              const next = new Set(prev);
                              isOpen ? next.delete(group.name) : next.add(group.name);
                              return next;
                            });
                            return (
                              <div key={group.name} className="rounded-md border border-slate-700/60 overflow-hidden">
                                <button
                                  type="button"
                                  onClick={toggle}
                                  className="w-full flex items-center gap-3 px-3 py-2.5 bg-slate-800/60 hover:bg-slate-800 transition-colors text-left"
                                  data-testid={`group-ar-${group.name}`}
                                >
                                  {isOpen ? <ChevronUp className="h-3.5 w-3.5 text-slate-400 shrink-0" /> : <ChevronDown className="h-3.5 w-3.5 text-slate-400 shrink-0" />}
                                  <span className="flex-1 text-sm font-medium text-slate-200 truncate">{group.name}</span>
                                  {group.entries.length > 1 && (
                                    <Badge className="bg-emerald-900/40 text-emerald-400 border-emerald-800 text-xs shrink-0">
                                      {group.entries.length} faktur
                                    </Badge>
                                  )}
                                  <span className="font-mono text-emerald-400 text-sm tabular-nums shrink-0">{idr(group.total)}</span>
                                </button>
                                {isOpen && (
                                  <div className="border-t border-slate-700/40">
                                    <Table>
                                      <TableHeader>
                                        <TableRow className="bg-slate-900/40">
                                          <TableHead className="pl-8 text-xs">No. Faktur</TableHead>
                                          <TableHead className="text-xs">Tanggal</TableHead>
                                          <TableHead className="text-right text-xs">Sisa Tagihan (IDR)</TableHead>
                                          <TableHead className="text-right text-xs">Aksi</TableHead>
                                        </TableRow>
                                      </TableHeader>
                                      <TableBody>
                                        {group.entries.map((entry) => (
                                          <TableRow key={entry.sourceDocId} className="hover:bg-slate-800/30">
                                            <TableCell className="pl-8">
                                              <Link href={`/sales/orders/${entry.sourceDocId}`}>
                                                <Badge className="bg-indigo-900/40 text-indigo-300 border-indigo-700 text-xs gap-1 cursor-pointer hover:bg-indigo-900/60 font-mono">
                                                  <ShoppingCart className="h-3 w-3" /> {entry.docNumber}
                                                </Badge>
                                              </Link>
                                            </TableCell>
                                            <TableCell className="text-slate-400 text-xs">
                                              {entry.date ? formatIsoDate(entry.date) : "—"}
                                            </TableCell>
                                            <TableCell className="text-right font-mono text-emerald-400 tabular-nums text-sm">
                                              {idr(entry.balance)}
                                            </TableCell>
                                            <TableCell className="text-right">
                                              <Button
                                                size="sm"
                                                variant="outline"
                                                className="h-7 text-xs gap-1 border-emerald-700/50 text-emerald-300 hover:bg-emerald-900/30"
                                                onClick={() => prefillFromPartner(entry, "inbound")}
                                                data-testid={`btn-collect-ar-${entry.sourceDocId}`}
                                              >
                                                <ArrowDownLeft className="h-3 w-3" /> Terima Bayar
                                              </Button>
                                            </TableCell>
                                          </TableRow>
                                        ))}
                                      </TableBody>
                                    </Table>
                                  </div>
                                )}
                              </div>
                            );
                          })}
                        </div>
                      )}
                    </TabsContent>
                    <TabsContent value="ap">
                      {apGroups.length === 0 ? (
                        <p className="text-slate-500 text-sm py-3 text-center">Tidak ada hutang terbuka.</p>
                      ) : (
                        <div className="space-y-1">
                          {apGroups.map((group) => {
                            const isOpen = expandedApPartners.has(group.name);
                            const toggle = () => setExpandedApPartners((prev) => {
                              const next = new Set(prev);
                              isOpen ? next.delete(group.name) : next.add(group.name);
                              return next;
                            });
                            return (
                              <div key={group.name} className="rounded-md border border-slate-700/60 overflow-hidden">
                                <button
                                  type="button"
                                  onClick={toggle}
                                  className="w-full flex items-center gap-3 px-3 py-2.5 bg-slate-800/60 hover:bg-slate-800 transition-colors text-left"
                                  data-testid={`group-ap-${group.name}`}
                                >
                                  {isOpen ? <ChevronUp className="h-3.5 w-3.5 text-slate-400 shrink-0" /> : <ChevronDown className="h-3.5 w-3.5 text-slate-400 shrink-0" />}
                                  <span className="flex-1 text-sm font-medium text-slate-200 truncate">{group.name}</span>
                                  {group.entries.length > 1 && (
                                    <Badge className="bg-red-900/40 text-red-400 border-red-800 text-xs shrink-0">
                                      {group.entries.length} tagihan
                                    </Badge>
                                  )}
                                  <span className="font-mono text-red-400 text-sm tabular-nums shrink-0">{idr(group.total)}</span>
                                </button>
                                {isOpen && (
                                  <div className="border-t border-slate-700/40">
                                    <Table>
                                      <TableHeader>
                                        <TableRow className="bg-slate-900/40">
                                          <TableHead className="pl-8 text-xs">No. Tagihan</TableHead>
                                          <TableHead className="text-xs">Tanggal</TableHead>
                                          <TableHead className="text-right text-xs">Sisa Hutang (IDR)</TableHead>
                                          <TableHead className="text-right text-xs">Aksi</TableHead>
                                        </TableRow>
                                      </TableHeader>
                                      <TableBody>
                                        {group.entries.map((entry) => (
                                          <TableRow key={entry.sourceDocId} className="hover:bg-slate-800/30">
                                            <TableCell className="pl-8">
                                              <Link href={`/purchase/orders/${entry.sourceDocId}`}>
                                                <Badge className="bg-violet-900/40 text-violet-300 border-violet-700 text-xs gap-1 cursor-pointer hover:bg-violet-900/60 font-mono">
                                                  <FileText className="h-3 w-3" /> {entry.docNumber}
                                                </Badge>
                                              </Link>
                                            </TableCell>
                                            <TableCell className="text-slate-400 text-xs">
                                              {entry.date ? formatIsoDate(entry.date) : "—"}
                                            </TableCell>
                                            <TableCell className="text-right font-mono text-red-400 tabular-nums text-sm">
                                              {idr(entry.balance)}
                                            </TableCell>
                                            <TableCell className="text-right">
                                              <a
                                                href="/accounting/bank-disbursements"
                                                className="inline-flex items-center gap-1 h-7 px-2 text-xs rounded border border-orange-700/50 text-orange-400 hover:bg-orange-900/20 transition-colors"
                                                data-testid={`btn-pay-ap-${entry.sourceDocId}`}
                                                title="Buat Bank Disbursement untuk membayar hutang ini"
                                              >
                                                <ArrowUpRight className="h-3 w-3" /> Buat Disbursement
                                              </a>
                                            </TableCell>
                                          </TableRow>
                                        ))}
                                      </TableBody>
                                    </Table>
                                  </div>
                                )}
                              </div>
                            );
                          })}
                        </div>
                      )}
                    </TabsContent>
                  </Tabs>
                )}
              </CardContent>
            </CollapsibleContent>
          </Card>
        </Collapsible>

        <Card className="border-slate-800 bg-slate-900">
          <CardContent className="pt-4">
            <div className="flex flex-wrap gap-3 mb-4">
              <div className="flex items-center gap-2">
                <Label className="text-slate-400 text-xs whitespace-nowrap">Tipe</Label>
                <Select
                  value={filter.paymentType ?? "all"}
                  onValueChange={(v) =>
                    setFilter((f) => ({ ...f, paymentType: v === "all" ? undefined : (v as "inbound" | "outbound") }))
                  }
                >
                  <SelectTrigger className="w-36 h-8 text-xs">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">Semua</SelectItem>
                    <SelectItem value="inbound">Bayar Masuk</SelectItem>
                    <SelectItem value="outbound">Bayar Keluar</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="flex items-center gap-2">
                <Label className="text-slate-400 text-xs whitespace-nowrap">Tipe Dokumen</Label>
                <Select
                  value={filter.sourceType ?? "all"}
                  onValueChange={(v) =>
                    setFilter((f) => ({ ...f, sourceType: v === "all" ? undefined : v }))
                  }
                >
                  <SelectTrigger className="w-44 h-8 text-xs">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">Semua Dokumen</SelectItem>
                    <SelectItem value="sales_order">SO (Sales Order)</SelectItem>
                    <SelectItem value="purchase_order">PO (Purchase Order)</SelectItem>
                    <SelectItem value="sport_center">Sport Center</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="flex items-center gap-2">
                <Label className="text-slate-400 text-xs whitespace-nowrap">No. Dokumen</Label>
                <Input
                  className="h-8 text-xs w-44"
                  placeholder="cth: SO/2024/000001"
                  value={filter.refDocNumber ?? ""}
                  onChange={(e) => {
                    const val = e.target.value;
                    setFilter((f) => ({ ...f, refDocNumber: val.trim() || undefined }));
                  }}
                  data-testid="filter-ref-doc-number"
                />
              </div>
              <div className="flex items-center gap-2">
                <Label className="text-slate-400 text-xs whitespace-nowrap">Cari Mitra</Label>
                <Input
                  className="h-8 text-xs w-36"
                  placeholder="Nama mitra..."
                  value={refSearch}
                  onChange={(e) => setRefSearch(e.target.value)}
                />
              </div>
              <div className="flex items-center gap-2">
                <Label className="text-slate-400 text-xs whitespace-nowrap">Dari</Label>
                <DatePicker value={filter.from ?? ""} onChange={(v) => setFilter((f) => ({ ...f, from: v || undefined }))} className="h-8 text-xs w-36" />
              </div>
              <div className="flex items-center gap-2">
                <Label className="text-slate-400 text-xs whitespace-nowrap">Sampai</Label>
                <DatePicker value={filter.to ?? ""} onChange={(v) => setFilter((f) => ({ ...f, to: v || undefined }))} className="h-8 text-xs w-36" />
              </div>
              {hasFilters && (
                <Button variant="ghost" size="sm" className="h-8 text-xs" onClick={resetFilters}>
                  Reset
                </Button>
              )}
            </div>

            {isLoading ? (
              <p className="text-slate-400 text-sm py-8 text-center">Memuat data...</p>
            ) : payments.length === 0 ? (
              <p className="text-slate-500 text-sm py-8 text-center">
                Belum ada pembayaran yang dicatat. Klik &ldquo;Catat Pembayaran&rdquo; untuk mulai.
              </p>
            ) : (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>No. Pembayaran</TableHead>
                    <TableHead>Tanggal</TableHead>
                    <TableHead>Tipe</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead>Mitra</TableHead>
                    <TableHead>Referensi</TableHead>
                    <TableHead className="text-right">Jumlah (IDR)</TableHead>
                    <TableHead>Jurnal</TableHead>
                    <TableHead>Dokumen Terkait</TableHead>
                    <TableHead>Entry</TableHead>
                    <TableHead></TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {payments.map((p) => {
                    const journal = journals.find((j) => j.id === p.journalId);
                    const isVoided = p.status === "voided";
                    return (
                      <TableRow key={p.id} className={isVoided ? "opacity-50" : undefined}>
                        <TableCell className="text-indigo-400 text-xs font-mono whitespace-nowrap">
                          {(p as any).paymentNumber ?? <span className="text-slate-600">—</span>}
                        </TableCell>
                        <TableCell className="text-slate-300 text-xs whitespace-nowrap">
                          {formatDate(p.date)}
                        </TableCell>
                        <TableCell>
                          {p.paymentType === "inbound" ? (
                            <Badge className="bg-emerald-900/40 text-emerald-300 border-emerald-700 text-xs gap-1">
                              <ArrowDownLeft className="h-3 w-3" /> Masuk
                            </Badge>
                          ) : (
                            <Badge className="bg-red-900/40 text-red-300 border-red-700 text-xs gap-1">
                              <ArrowUpRight className="h-3 w-3" /> Keluar
                            </Badge>
                          )}
                        </TableCell>
                        <TableCell>
                          {isVoided ? (
                            <div className="space-y-0.5">
                              <Badge className="bg-slate-700/60 text-slate-400 border-slate-600 text-xs gap-1">
                                <Ban className="h-3 w-3" /> Dibatalkan
                              </Badge>
                              {p.voidReason && (
                                <p className="text-xs text-slate-500 italic max-w-[160px] truncate" title={p.voidReason}>
                                  {p.voidReason}
                                </p>
                              )}
                            </div>
                          ) : (
                            <Badge className="bg-green-900/40 text-green-300 border-green-700 text-xs">
                              Diposting
                            </Badge>
                          )}
                        </TableCell>
                        <TableCell className="text-slate-300 text-sm">{p.partnerName ?? "-"}</TableCell>
                        <TableCell className="text-slate-400 text-xs font-mono">{p.ref ?? "-"}</TableCell>
                        <TableCell className="text-right font-mono text-sm tabular-nums">
                          <span className={isVoided ? "text-slate-500 line-through" : p.paymentType === "inbound" ? "text-emerald-400" : "text-red-400"}>
                            {idr(p.amount)}
                          </span>
                        </TableCell>
                        <TableCell className="text-slate-400 text-xs">
                          {journal ? `[${journal.code}] ${journal.name}` : "-"}
                        </TableCell>
                        <TableCell>
                          <LinkedDocBadge sourceType={p.sourceType} sourceDocId={p.sourceDocId} />
                        </TableCell>
                        <TableCell>
                          {p.entryId ? (
                            <Link href={`/accounting/entries/${p.entryId}`}>
                              <Button
                                variant="ghost"
                                size="sm"
                                className="h-6 text-xs gap-1 text-indigo-400 hover:text-indigo-300 px-2"
                              >
                                <ExternalLink className="h-3 w-3" /> Lihat
                              </Button>
                            </Link>
                          ) : (
                            <span className="text-slate-600 text-xs">-</span>
                          )}
                        </TableCell>
                        <TableCell>
                          <div className="flex items-center gap-1">
                            {!isVoided && (
                              <VoidDialog payment={p} onVoided={handleVoided} />
                            )}
                            <Button
                              size="sm"
                              variant="ghost"
                              className="h-6 text-xs gap-1 text-muted-foreground px-2"
                              onClick={() => setCorrPaymentId(p.id)}
                            >
                              <MessageSquare className="h-3 w-3" />
                            </Button>
                          </div>
                        </TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
            )}
          </CardContent>
        </Card>
      </div>

      <Dialog open={corrPaymentId !== null} onOpenChange={(v) => { if (!v) setCorrPaymentId(null); }}>
        <DialogContent className="max-w-2xl max-h-[85vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <MessageSquare className="h-4 w-4" /> Korespondensi Email — Payment
            </DialogTitle>
          </DialogHeader>
          {corrPaymentId !== null && (
            <CorrespondenceTab linkedType="payment" linkedId={corrPaymentId} />
          )}
          <DialogFooter>
            <Button variant="outline" onClick={() => setCorrPaymentId(null)}>Tutup</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </AppShell>
  );
}
