import { useState, useMemo } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { AppShell } from "@/components/layout/AppShell";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from "@/components/ui/dialog";
import { Textarea } from "@/components/ui/textarea";
import { Input } from "@/components/ui/input";
import { Separator } from "@/components/ui/separator";
import {
  CheckCircle2, XCircle, Clock, Lock, Unlock, AlertTriangle,
  ArrowLeft, RefreshCw, Wand2, RotateCcw, ChevronRight, Info,
} from "lucide-react";
import { Link } from "wouter";
import { useCompany } from "@/contexts/CompanyContext";
import { toast } from "sonner";
import { format } from "date-fns";
import { id as localeId } from "date-fns/locale";

const MONTHS = [
  { v: "01", label: "Januari" },
  { v: "02", label: "Februari" },
  { v: "03", label: "Maret" },
  { v: "04", label: "April" },
  { v: "05", label: "Mei" },
  { v: "06", label: "Juni" },
  { v: "07", label: "Juli" },
  { v: "08", label: "Agustus" },
  { v: "09", label: "September" },
  { v: "10", label: "Oktober" },
  { v: "11", label: "November" },
  { v: "12", label: "Desember" },
];

type ChecklistItem = {
  ok: boolean;
  unpostedCount?: number;
  unsettledCount?: number;
  unreconciledCount?: number;
  unbalancedCount?: number;
  totalDebit?: number;
  totalCredit?: number;
  diff?: number;
};

type ChecklistData = {
  bankDisbursementsPosted: ChecklistItem;
  bankReceiptsPosted: ChecklistItem;
  invoicesPosted: ChecklistItem;
  kasbonSettled: ChecklistItem;
  bankReconciliationDone: ChecklistItem;
  journalsBalanced: ChecklistItem;
  trialBalanceBalanced: ChecklistItem;
};

type WizardData = {
  period: string;
  companyId: number;
  isClosed: boolean;
  closedAt: string | null;
  closedBy: string | null;
  checklist: ChecklistData;
};

const idr = (n: number) =>
  new Intl.NumberFormat("id-ID", { maximumFractionDigits: 0 }).format(Math.abs(n));

function ItemIcon({ ok, loading }: { ok: boolean; loading?: boolean }) {
  if (loading) return <Clock className="w-5 h-5 text-muted-foreground animate-pulse" />;
  if (ok) return <CheckCircle2 className="w-5 h-5 text-green-600" />;
  return <XCircle className="w-5 h-5 text-red-500" />;
}

function ChecklistRow({
  label, hint, item, loading, linkTo,
}: {
  label: string;
  hint?: string;
  item?: ChecklistItem;
  loading?: boolean;
  linkTo?: string;
}) {
  const ok = item?.ok ?? false;
  return (
    <div className={`flex items-start gap-3 p-3 rounded-lg border transition-colors ${
      loading ? "bg-muted/20 border-muted" :
      ok ? "bg-green-50/60 border-green-200" : "bg-red-50/60 border-red-200"
    }`}>
      <div className="mt-0.5 shrink-0">
        <ItemIcon ok={ok} loading={loading} />
      </div>
      <div className="flex-1 min-w-0">
        <div className="flex items-center justify-between gap-2">
          <span className={`font-medium text-sm ${ok ? "text-green-800" : loading ? "text-muted-foreground" : "text-red-800"}`}>
            {label}
          </span>
          {!loading && !ok && linkTo && (
            <Link href={linkTo}>
              <Button variant="outline" size="sm" className="h-6 text-xs px-2 shrink-0">
                Perbaiki <ChevronRight className="w-3 h-3 ml-1" />
              </Button>
            </Link>
          )}
        </div>
        {hint && <p className="text-xs text-muted-foreground mt-0.5">{hint}</p>}
        {!loading && item && !ok && (
          <div className="mt-1 text-xs font-medium text-red-700">
            {item.unpostedCount !== undefined && item.unpostedCount > 0 &&
              `${item.unpostedCount} transaksi belum diposting`}
            {item.unsettledCount !== undefined && item.unsettledCount > 0 &&
              `${item.unsettledCount} kasbon belum diselesaikan`}
            {item.unreconciledCount !== undefined && item.unreconciledCount > 0 &&
              `${item.unreconciledCount} mutasi belum direkonsiliasi`}
            {item.unbalancedCount !== undefined && item.unbalancedCount > 0 &&
              `${item.unbalancedCount} jurnal tidak balance`}
            {item.diff !== undefined && item.diff > 0.01 &&
              `Selisih Trial Balance: Rp ${idr(item.diff)}`}
          </div>
        )}
        {!loading && ok && (
          <p className="mt-0.5 text-xs text-green-700 font-medium">✓ Selesai</p>
        )}
      </div>
    </div>
  );
}

export default function ClosingWizardPage() {
  const { activeCompanyId } = useCompany();
  const qc = useQueryClient();

  const now = new Date();
  const [year, setYear] = useState(now.getFullYear());
  const [month, setMonth] = useState(String(now.getMonth() + 1).padStart(2, "0"));

  const [lockDialog, setLockDialog] = useState(false);
  const [unlockDialog, setUnlockDialog] = useState(false);
  const [lockNotes, setLockNotes] = useState("");
  const [unlockReason, setUnlockReason] = useState("");

  const [reversalDialog, setReversalDialog] = useState(false);
  const [reversalEntryId, setReversalEntryId] = useState("");
  const [reversalReason, setReversalReason] = useState("");

  const period = `${year}-${month}`;

  const checklistQ = useQuery<WizardData>({
    queryKey: ["closing-wizard-checklist", activeCompanyId, period],
    queryFn: async () => {
      const r = await fetch(
        `/api/accounting/closing/wizard-checklist?companyId=${activeCompanyId}&period=${period}`,
        { credentials: "include" }
      );
      if (!r.ok) {
        const d = await r.json();
        throw new Error(d.error ?? "Gagal memuat checklist");
      }
      return r.json();
    },
    enabled: !!activeCompanyId,
    refetchInterval: false,
  });

  const data = checklistQ.data;
  const loading = checklistQ.isLoading;

  const allOk = useMemo(() => {
    if (!data) return false;
    const cl = data.checklist;
    return (
      cl.bankDisbursementsPosted.ok &&
      cl.bankReceiptsPosted.ok &&
      cl.invoicesPosted.ok &&
      cl.kasbonSettled.ok &&
      cl.bankReconciliationDone.ok &&
      cl.journalsBalanced.ok &&
      cl.trialBalanceBalanced.ok
    );
  }, [data]);

  const passCount = useMemo(() => {
    if (!data) return 0;
    return Object.values(data.checklist).filter((v) => v.ok).length;
  }, [data]);

  const lockMutation = useMutation({
    mutationFn: async () => {
      const [yr, mo] = period.split("-").map(Number);
      const r = await fetch("/api/finance-core/fiscal-periods/close", {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ companyId: activeCompanyId, year: yr, month: mo, notes: lockNotes || undefined }),
      });
      const d = await r.json();
      if (!r.ok) throw new Error(d.error ?? "Gagal mengunci periode");
      return d;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["closing-wizard-checklist"] });
      setLockDialog(false);
      setLockNotes("");
      toast.success(`Periode ${period} berhasil dikunci`);
    },
    onError: (e: any) => toast.error(e.message ?? "Gagal mengunci periode"),
  });

  const unlockMutation = useMutation({
    mutationFn: async () => {
      if (!unlockReason.trim()) throw new Error("Alasan wajib diisi");
      const [yr, mo] = period.split("-").map(Number);
      const r = await fetch("/api/finance-core/fiscal-periods/reopen", {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ companyId: activeCompanyId, year: yr, month: mo, reason: unlockReason }),
      });
      const d = await r.json();
      if (!r.ok) throw new Error(d.error ?? "Gagal membuka periode");
      return d;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["closing-wizard-checklist"] });
      setUnlockDialog(false);
      setUnlockReason("");
      toast.success(`Periode ${period} dibuka kembali`);
    },
    onError: (e: any) => toast.error(e.message ?? "Gagal membuka periode"),
  });

  const reversalMutation = useMutation({
    mutationFn: async () => {
      const eid = Number(reversalEntryId);
      if (!eid) throw new Error("Entry ID tidak valid");
      if (!reversalReason.trim()) throw new Error("Alasan reversal wajib diisi");
      const r = await fetch(`/api/accounting/entries/${eid}/reverse`, {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          reason: reversalReason,
          companyId: activeCompanyId,
          // date wajib untuk validasi period lock (governance guard)
          date: new Date().toISOString().split("T")[0],
        }),
      });
      const d = await r.json();
      if (!r.ok) throw new Error(d.message ?? "Gagal membuat reversal");
      return d;
    },
    onSuccess: (d: any) => {
      setReversalDialog(false);
      setReversalEntryId("");
      setReversalReason("");
      toast.success(`Reversal entry berhasil: ${d.entryNumber ?? ""}`);
    },
    onError: (e: any) => toast.error(e.message ?? "Gagal membuat reversal"),
  });

  const yearOptions = [now.getFullYear() - 2, now.getFullYear() - 1, now.getFullYear(), now.getFullYear() + 1];

  return (
    <AppShell>
      <div className="p-6 space-y-6 max-w-3xl mx-auto">
        {/* Header */}
        <div className="flex items-center gap-3">
          <Link href="/accounting/dashboard">
            <Button variant="ghost" size="icon"><ArrowLeft className="h-4 w-4" /></Button>
          </Link>
          <Wand2 className="w-6 h-6 text-indigo-600" />
          <div>
            <h1 className="text-xl font-bold">Month-End Closing Wizard</h1>
            <p className="text-sm text-muted-foreground">
              Verifikasi checklist sebelum mengunci periode akuntansi
            </p>
          </div>
        </div>

        {/* Period Selector */}
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-base">Pilih Periode</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="flex gap-3 items-end">
              <div className="space-y-1">
                <Label className="text-xs">Bulan</Label>
                <Select value={month} onValueChange={setMonth}>
                  <SelectTrigger className="w-36">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {MONTHS.map((m) => (
                      <SelectItem key={m.v} value={m.v}>{m.label}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1">
                <Label className="text-xs">Tahun</Label>
                <Select value={String(year)} onValueChange={(v) => setYear(Number(v))}>
                  <SelectTrigger className="w-28">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {yearOptions.map((y) => (
                      <SelectItem key={y} value={String(y)}>{y}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <Button
                variant="outline"
                size="sm"
                onClick={() => qc.invalidateQueries({ queryKey: ["closing-wizard-checklist"] })}
                disabled={loading}
              >
                <RefreshCw className={`w-4 h-4 mr-2 ${loading ? "animate-spin" : ""}`} />
                Refresh
              </Button>
            </div>
          </CardContent>
        </Card>

        {/* Period Status Banner */}
        {data && (
          <div className={`flex items-center gap-3 p-4 rounded-lg border ${
            data.isClosed
              ? "bg-red-50 border-red-300 text-red-800"
              : allOk
              ? "bg-green-50 border-green-300 text-green-800"
              : "bg-amber-50 border-amber-300 text-amber-800"
          }`}>
            {data.isClosed
              ? <Lock className="w-5 h-5 shrink-0" />
              : allOk
              ? <CheckCircle2 className="w-5 h-5 shrink-0" />
              : <AlertTriangle className="w-5 h-5 shrink-0" />
            }
            <div className="flex-1">
              <p className="font-semibold text-sm">
                {data.isClosed
                  ? `Periode ${period} sudah terkunci`
                  : allOk
                  ? `Periode ${period} siap dikunci`
                  : `Periode ${period} — ${passCount}/7 item selesai`
                }
              </p>
              {data.isClosed && data.closedAt && (
                <p className="text-xs mt-0.5">
                  Dikunci {format(new Date(data.closedAt), "dd MMM yyyy HH:mm", { locale: localeId })}
                  {data.closedBy ? ` oleh ${data.closedBy}` : ""}
                </p>
              )}
            </div>
            <div className="flex gap-2 shrink-0">
              {!data.isClosed && (
                <Button
                  size="sm"
                  disabled={!allOk}
                  className="bg-red-600 hover:bg-red-700 text-white"
                  onClick={() => setLockDialog(true)}
                >
                  <Lock className="w-4 h-4 mr-1.5" />
                  Kunci Periode
                </Button>
              )}
              {data.isClosed && (
                <>
                  <Button
                    size="sm"
                    variant="outline"
                    className="border-amber-400 text-amber-700 hover:bg-amber-50"
                    onClick={() => setReversalDialog(true)}
                  >
                    <RotateCcw className="w-4 h-4 mr-1.5" />
                    Reversal Entry
                  </Button>
                  <Button
                    size="sm"
                    variant="outline"
                    className="border-red-300 text-red-700 hover:bg-red-50"
                    onClick={() => setUnlockDialog(true)}
                  >
                    <Unlock className="w-4 h-4 mr-1.5" />
                    Buka Kembali
                  </Button>
                </>
              )}
            </div>
          </div>
        )}

        {/* Checklist */}
        <Card>
          <CardHeader className="pb-3">
            <div className="flex items-center justify-between">
              <CardTitle className="text-base">Checklist Penutupan</CardTitle>
              {!loading && data && (
                <Badge variant={allOk ? "default" : "secondary"} className={allOk ? "bg-green-600" : ""}>
                  {passCount}/7 selesai
                </Badge>
              )}
            </div>
          </CardHeader>
          <CardContent className="space-y-2.5">
            <ChecklistRow
              label="Semua Bank Disbursement Posted"
              hint="Pembayaran keluar (purchase_payment, manual_payment) harus sudah diposting"
              item={data?.checklist.bankDisbursementsPosted}
              loading={loading}
              linkTo="/accounting/bank-disbursements"
            />
            <ChecklistRow
              label="Semua Bank Receipt Posted"
              hint="Penerimaan kas/bank (sales_payment, bank reconciliation) harus sudah diposting"
              item={data?.checklist.bankReceiptsPosted}
              loading={loading}
              linkTo="/accounting/bank-recon"
            />
            <ChecklistRow
              label="Semua Invoice Posted"
              hint="Sales invoice dan purchase bill harus sudah diposting ke buku besar"
              item={data?.checklist.invoicesPosted}
              loading={loading}
              linkTo="/accounting/entries"
            />
            <ChecklistRow
              label="Semua Kasbon Settled"
              hint="Kasbon yang sudah dibayarkan di bulan ini harus berstatus settled"
              item={data?.checklist.kasbonSettled}
              loading={loading}
              linkTo="/expense/cash-advances"
            />
            <ChecklistRow
              label="Bank Reconciliation Selesai"
              hint="Semua mutasi bank harus sudah direkonsiliasi"
              item={data?.checklist.bankReconciliationDone}
              loading={loading}
              linkTo="/accounting/bank-recon"
            />
            <ChecklistRow
              label="Jurnal Balanced"
              hint="Semua entri yang sudah diposting harus memiliki total debit = total kredit"
              item={data?.checklist.journalsBalanced}
              loading={loading}
              linkTo="/accounting/entries"
            />
            <ChecklistRow
              label="Trial Balance Balanced"
              hint="Total debit keseluruhan harus sama dengan total kredit di periode ini"
              item={data?.checklist.trialBalanceBalanced}
              loading={loading}
              linkTo="/accounting/reports/trial-balance"
            />

            {data?.checklist.trialBalanceBalanced && !data.checklist.trialBalanceBalanced.ok && (
              <div className="rounded-md border border-slate-200 bg-slate-50 p-3 text-xs text-slate-700 space-y-1">
                <div className="flex items-center gap-1 font-medium">
                  <Info className="w-3.5 h-3.5" />
                  Detail Trial Balance — {period}
                </div>
                <div className="grid grid-cols-3 gap-2 pt-1">
                  <div>
                    <p className="text-muted-foreground">Total Debit</p>
                    <p className="font-mono font-medium">Rp {idr(data.checklist.trialBalanceBalanced.totalDebit ?? 0)}</p>
                  </div>
                  <div>
                    <p className="text-muted-foreground">Total Kredit</p>
                    <p className="font-mono font-medium">Rp {idr(data.checklist.trialBalanceBalanced.totalCredit ?? 0)}</p>
                  </div>
                  <div>
                    <p className="text-muted-foreground">Selisih</p>
                    <p className="font-mono font-medium text-red-600">
                      Rp {idr(data.checklist.trialBalanceBalanced.diff ?? 0)}
                    </p>
                  </div>
                </div>
              </div>
            )}
          </CardContent>
        </Card>

        {/* Rules */}
        <Alert className="border-amber-200 bg-amber-50">
          <AlertTriangle className="h-4 w-4 text-amber-600" />
          <AlertDescription className="text-amber-800 text-sm space-y-1">
            <p><strong>Aturan Penutupan Periode:</strong></p>
            <ul className="list-disc list-inside space-y-0.5 text-xs">
              <li>Semua 7 checklist harus hijau sebelum periode bisa dikunci</li>
              <li>Setelah dikunci, semua jurnal baru di periode ini akan diblokir</li>
              <li>Jika ada koreksi setelah tutup buku → gunakan <strong>Reversal Entry</strong></li>
              <li>Buka kembali periode hanya untuk darurat — alasan wajib tercatat untuk audit</li>
            </ul>
          </AlertDescription>
        </Alert>

        {/* Quick Links */}
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm text-muted-foreground">Halaman Terkait</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="flex flex-wrap gap-2">
              {[
                { label: "Closing Entries", href: "/accounting/closing-entries" },
                { label: "Status Periode", href: "/accounting/period-closing" },
                { label: "Trial Balance", href: "/accounting/reports/trial-balance" },
                { label: "Jurnal Entries", href: "/accounting/entries" },
                { label: "Bank Recon", href: "/accounting/bank-recon" },
                { label: "Kasbon", href: "/expense/cash-advances" },
              ].map((l) => (
                <Link key={l.href} href={l.href}>
                  <Button variant="outline" size="sm" className="h-7 text-xs">
                    {l.label}
                  </Button>
                </Link>
              ))}
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Lock Period Dialog */}
      <Dialog open={lockDialog} onOpenChange={setLockDialog}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Lock className="w-5 h-5 text-red-600" />
              Kunci Periode {period}
            </DialogTitle>
            <DialogDescription>
              Setelah dikunci, semua jurnal baru di periode ini akan diblokir.
              Gunakan Reversal Entry untuk koreksi setelah periode dikunci.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            <div className="rounded-lg border border-green-200 bg-green-50 p-3">
              <p className="text-sm font-medium text-green-800 mb-2">✓ Semua checklist selesai:</p>
              <ul className="text-xs text-green-700 space-y-0.5 list-disc list-inside">
                <li>Bank Disbursement Posted</li>
                <li>Bank Receipt Posted</li>
                <li>Invoice Posted</li>
                <li>Kasbon Settled</li>
                <li>Bank Reconciliation Selesai</li>
                <li>Jurnal Balanced</li>
                <li>Trial Balance Balanced</li>
              </ul>
            </div>
            <div className="space-y-1">
              <Label className="text-sm">Catatan Penutupan (opsional)</Label>
              <Textarea
                value={lockNotes}
                onChange={(e) => setLockNotes(e.target.value)}
                placeholder="Catatan untuk audit trail..."
                rows={3}
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setLockDialog(false)}>Batal</Button>
            <Button
              variant="destructive"
              onClick={() => lockMutation.mutate()}
              disabled={lockMutation.isPending}
            >
              {lockMutation.isPending
                ? <><RefreshCw className="w-4 h-4 mr-2 animate-spin" />Mengunci...</>
                : <><Lock className="w-4 h-4 mr-2" />Kunci Periode</>
              }
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Unlock Dialog */}
      <Dialog open={unlockDialog} onOpenChange={setUnlockDialog}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Unlock className="w-5 h-5 text-amber-600" />
              Buka Kembali Periode {period}
            </DialogTitle>
            <DialogDescription>
              Membuka kembali periode yang sudah ditutup. Alasan wajib dicatat untuk keperluan audit.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-2">
            <Label>Alasan membuka kembali *</Label>
            <Textarea
              value={unlockReason}
              onChange={(e) => setUnlockReason(e.target.value)}
              placeholder="Jelaskan alasan membuka kembali periode ini..."
              rows={3}
            />
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setUnlockDialog(false)}>Batal</Button>
            <Button
              onClick={() => unlockMutation.mutate()}
              disabled={unlockMutation.isPending || !unlockReason.trim()}
            >
              {unlockMutation.isPending
                ? <><RefreshCw className="w-4 h-4 mr-2 animate-spin" />Membuka...</>
                : <><Unlock className="w-4 h-4 mr-2" />Buka Kembali</>
              }
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Reversal Entry Dialog */}
      <Dialog open={reversalDialog} onOpenChange={setReversalDialog}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <RotateCcw className="w-5 h-5 text-indigo-600" />
              Buat Reversal Entry
            </DialogTitle>
            <DialogDescription>
              Buat jurnal pembalik (reversal) untuk entry yang sudah diposting.
              Ini adalah cara yang benar untuk koreksi di periode yang sudah dikunci.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            <Alert className="border-blue-200 bg-blue-50">
              <Info className="h-4 w-4 text-blue-600" />
              <AlertDescription className="text-blue-800 text-xs">
                Masukkan ID entri jurnal yang ingin dibalik. ID bisa ditemukan di halaman
                <Link href="/accounting/entries" className="underline mx-1">Jurnal Entries</Link>
                (kolom paling kiri).
              </AlertDescription>
            </Alert>
            <div className="space-y-1">
              <Label>ID Entri Jurnal *</Label>
              <Input
                type="number"
                placeholder="Contoh: 123"
                value={reversalEntryId}
                onChange={(e) => setReversalEntryId(e.target.value)}
              />
            </div>
            <Separator />
            <div className="space-y-1">
              <Label>Alasan Reversal *</Label>
              <Textarea
                value={reversalReason}
                onChange={(e) => setReversalReason(e.target.value)}
                placeholder="Jelaskan alasan koreksi/reversal..."
                rows={3}
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setReversalDialog(false)}>Batal</Button>
            <Button
              className="bg-indigo-600 hover:bg-indigo-700"
              onClick={() => reversalMutation.mutate()}
              disabled={reversalMutation.isPending || !reversalEntryId || !reversalReason.trim()}
            >
              {reversalMutation.isPending
                ? <><RefreshCw className="w-4 h-4 mr-2 animate-spin" />Membuat...</>
                : <><RotateCcw className="w-4 h-4 mr-2" />Buat Reversal</>
              }
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </AppShell>
  );
}
