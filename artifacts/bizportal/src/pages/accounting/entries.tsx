import { useState, useMemo } from "react";
import { Link } from "wouter";
import { AIReviewSourcePanel } from "@/components/ai-review";
import { AppShell } from "@/components/layout/AppShell";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { DatePicker } from "@/components/ui/date-picker";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle, DialogTrigger,
} from "@/components/ui/dialog";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { AccountCombobox } from "@/components/accounting/AccountCombobox";
import { Badge } from "@/components/ui/badge";
import { useToast } from "@/hooks/use-toast";
import { useLanguage } from "@/contexts/LanguageContext";
import { useCompany } from "@/contexts/CompanyContext";
import {
  useListAccountingEntries, useCreateAccountingEntry, useListJournals, useListAccounts,
  getListAccountingEntriesQueryKey,
  getGetAccountingEntryQueryOptions,
  type AccountingEntry,
} from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { usePrefetchOnHover } from "@/hooks/use-prefetch-on-hover";
import { Plus, FileText, Trash2, Printer, Download, RotateCcw, RefreshCw, ArrowLeft } from "lucide-react";
import { exportXlsx, printWindow } from "@/lib/export";

const idr = (n: number) => new Intl.NumberFormat("id-ID", { minimumFractionDigits: 0, maximumFractionDigits: 2 }).format(n);

const SOURCE_LABELS: Record<string, string> = {
  manual: "Manual",
  sales_invoice: "Faktur Jual",
  purchase_bill: "Tagihan Beli",
  sales_payment: "Bayar Masuk",
  purchase_payment: "Bayar Keluar",
  manual_payment: "Bayar Manual",
  reversal: "Pembalik",
  pos_sale: "POS Penjualan",
  ecommerce_order: "E-Commerce",
  stock_received: "Terima Stok",
  cogs_delivery: "HPP Pengiriman",
  purchase_return: "Retur Beli",
  sales_return: "Retur Jual",
  opname_adjust: "Opname",
  damage_adjust: "Penyesuaian Kerusakan",
  grn_receipt: "Penerimaan GRN",
  sport_center_booking: "Booking Sport Center",
  sport_center_membership: "Membership Sport Center",
  sport_center_refund: "Refund Sport Center",
  sport_center_booking_refund: "Refund Booking Sport Center",
  sport_center_booking_reversal: "Pembalik Booking Sport Center",
  sport_center_operational_expense: "Biaya Operasional Sport Center",
  bank_mutation_import: "Import Mutasi Bank",
};

type LineForm = { accountId: number; debit: number; credit: number; description: string };

async function deleteEntry(id: number) {
  const resp = await fetch(`/api/accounting/entries/${id}`, { method: "DELETE" });
  if (!resp.ok) {
    const err = await resp.json().catch(() => ({})) as { message?: string };
    throw new Error(err.message ?? `HTTP ${resp.status}`);
  }
}

function ReverseDialog({ entry, onDone }: { entry: AccountingEntry; onDone: () => void }) {
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState("");
  const [loading, setLoading] = useState(false);
  const { toast } = useToast();

  const handleReverse = async () => {
    setLoading(true);
    try {
      const resp = await fetch(`/api/accounting/entries/${entry.id}/reverse`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          reason: reason.trim() || undefined,
          // date wajib dikirim untuk validasi period lock (governance guard)
          // gunakan hari ini karena reversal diposting di periode berjalan
          date: new Date().toISOString().split("T")[0],
        }),
      });
      if (!resp.ok) {
        const err = await resp.json().catch(() => ({})) as { message?: string };
        throw new Error(err.message ?? `HTTP ${resp.status}`);
      }
      toast({ title: "Jurnal pembalik berhasil dibuat" });
      setOpen(false);
      setReason("");
      onDone();
    } catch (err: unknown) {
      const msg = (err as { response?: { data?: { message?: string } } })?.response?.data?.message ?? String(err);
      toast({ title: "Gagal membalik jurnal", description: msg, variant: "destructive" });
    } finally {
      setLoading(false);
    }
  };

  if ((entry.source as string) === "reversal") return null;
  if ((entry.status as string) !== "posted") return null;

  return (
    <Dialog open={open} onOpenChange={(v) => { setOpen(v); if (!v) setReason(""); }}>
      <DialogTrigger asChild>
        <Button variant="ghost" size="sm" className="h-6 text-xs gap-1 text-amber-400 hover:text-amber-300 hover:bg-amber-900/20 px-2">
          <RotateCcw className="h-3 w-3" /> Balik
        </Button>
      </DialogTrigger>
      <DialogContent className="max-w-sm">
        <DialogHeader><DialogTitle>Buat Jurnal Pembalik?</DialogTitle></DialogHeader>
        <div className="space-y-3 py-2 text-sm text-slate-300">
          <p>Akan membuat entri baru dengan DR/CR <strong>dibalik</strong> untuk mengimbangi entri <span className="font-mono text-indigo-300">{entry.entryNumber}</span>.</p>
          <div className="space-y-1">
            <Label className="text-slate-300 text-xs">Alasan <span className="text-slate-500">(opsional)</span></Label>
            <Textarea rows={2} value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Mis. kesalahan posting..." className="text-sm resize-none" />
          </div>
          <p className="text-amber-400 text-xs">Jurnal pembalik akan langsung diposting.</p>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => setOpen(false)} disabled={loading}>Batal</Button>
          <Button onClick={handleReverse} disabled={loading} className="bg-amber-600 hover:bg-amber-700">
            {loading ? "Memproses..." : "Ya, Buat Pembalik"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function PostDraftButton({ entry, onDone }: { entry: AccountingEntry; onDone: () => void }) {
  const [loading, setLoading] = useState(false);
  const { toast } = useToast();

  if (entry.source !== "manual") return null;
  if ((entry.status as string) !== "draft") return null;

  const handlePost = async () => {
    setLoading(true);
    try {
      const resp = await fetch(`/api/accounting/entries/${entry.id}/status`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status: "posted", date: entry.date }),
      });
      if (!resp.ok) {
        const err = await resp.json().catch(() => ({})) as { message?: string };
        throw new Error(err.message ?? `HTTP ${resp.status}`);
      }
      toast({ title: "Jurnal berhasil diposting" });
      onDone();
    } catch (err: unknown) {
      toast({ title: "Gagal posting jurnal", description: String(err), variant: "destructive" });
    } finally {
      setLoading(false);
    }
  };

  return (
    <Button
      variant="ghost"
      size="sm"
      className="h-6 text-xs gap-1 text-green-400 hover:text-green-300 hover:bg-green-900/20 px-2"
      onClick={handlePost}
      disabled={loading}
    >
      <FileText className="h-3 w-3" /> {loading ? "..." : "Post"}
    </Button>
  );
}

function ResetDraftDialog({ entry, onDone }: { entry: AccountingEntry; onDone: () => void }) {
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const { toast } = useToast();

  const handleReset = async () => {
    setLoading(true);
    try {
      const resp = await fetch(`/api/accounting/entries/${entry.id}/status`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status: "draft" }),
      });
      if (!resp.ok) {
        const err = await resp.json().catch(() => ({})) as { message?: string };
        throw new Error(err.message ?? `HTTP ${resp.status}`);
      }
      toast({ title: "Entri berhasil direset ke Draft" });
      setOpen(false);
      onDone();
    } catch (err: unknown) {
      const msg = (err as { response?: { data?: { message?: string } } })?.response?.data?.message ?? String(err);
      toast({ title: "Gagal reset draft", description: msg, variant: "destructive" });
    } finally {
      setLoading(false);
    }
  };

  if (entry.source !== "manual") return null;
  if (entry.status !== "posted") return null;

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button variant="ghost" size="sm" className="h-6 text-xs gap-1 text-slate-400 hover:text-slate-300 hover:bg-slate-800 px-2">
          <RefreshCw className="h-3 w-3" /> Reset
        </Button>
      </DialogTrigger>
      <DialogContent className="max-w-sm">
        <DialogHeader><DialogTitle>Reset ke Draft?</DialogTitle></DialogHeader>
        <p className="text-sm text-slate-300 py-2">
          Entri <span className="font-mono text-indigo-300">{entry.entryNumber}</span> akan dikembalikan ke status <strong>Draft</strong>. Laporan keuangan tidak akan terpengaruh sampai diposting ulang.
        </p>
        <DialogFooter>
          <Button variant="outline" onClick={() => setOpen(false)} disabled={loading}>Batal</Button>
          <Button onClick={handleReset} disabled={loading} variant="secondary">
            {loading ? "Mereset..." : "Ya, Reset Draft"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function DeleteEntryDialog({ entry, onDone }: { entry: AccountingEntry; onDone: () => void }) {
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const { toast } = useToast();

  const handleDelete = async () => {
    setLoading(true);
    try {
      await deleteEntry(entry.id);
      toast({ title: "Entri berhasil dihapus" });
      setOpen(false);
      onDone();
    } catch (err: unknown) {
      toast({ title: "Gagal menghapus entri", description: String(err), variant: "destructive" });
    } finally {
      setLoading(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button variant="ghost" size="sm" className="h-6 text-xs gap-1 text-red-400 hover:text-red-300 hover:bg-red-900/20 px-2">
          <Trash2 className="h-3 w-3" /> Hapus
        </Button>
      </DialogTrigger>
      <DialogContent className="max-w-sm">
        <DialogHeader><DialogTitle>Hapus Entri?</DialogTitle></DialogHeader>
        <p className="text-sm text-slate-300 py-2">
          Entri <span className="font-mono text-indigo-300">{entry.entryNumber}</span> akan dihapus permanen. Aksi ini tidak bisa dibatalkan.
        </p>
        <DialogFooter>
          <Button variant="outline" onClick={() => setOpen(false)} disabled={loading}>Batal</Button>
          <Button onClick={handleDelete} disabled={loading} variant="destructive">
            {loading ? "Menghapus..." : "Ya, Hapus"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export default function EntriesPage() {
  const qc = useQueryClient();
  const prefetchHover = usePrefetchOnHover();
  const { toast } = useToast();
  const { t } = useLanguage();
  const { activeCompanyId, isConsolidated } = useCompany();
  const [filter, setFilter] = useState<{ journalId?: number; from?: string; to?: string; source?: string; search?: string }>({});
  const params = useMemo(() => ({
    ...(filter.journalId ? { journalId: filter.journalId } : {}),
    ...(filter.from ? { from: new Date(filter.from).toISOString() } : {}),
    ...(filter.to ? { to: new Date(filter.to + "T23:59:59").toISOString() } : {}),
    company: (isConsolidated ? "all" : activeCompanyId) as unknown as number,
  }), [filter, activeCompanyId, isConsolidated]);
  const { data: entries } = useListAccountingEntries(params, { query: { queryKey: getListAccountingEntriesQueryKey(params) } });
  const { data: journals } = useListJournals();
  const { data: accounts } = useListAccounts();
  const createMut = useCreateAccountingEntry();

  const [open, setOpen] = useState(false);
  const today = new Date().toISOString().slice(0, 10);
  const [form, setForm] = useState({
    journalId: 0, date: today, ref: "", description: "",
    lines: [
      { accountId: 0, debit: 0, credit: 0, description: "" },
      { accountId: 0, debit: 0, credit: 0, description: "" },
    ] as LineForm[],
  });

  // Bulk selection state
  const [selected, setSelected] = useState<Set<number>>(new Set());
  const [bulkDeleteOpen, setBulkDeleteOpen] = useState(false);
  const [bulkDeleting, setBulkDeleting] = useState(false);

  const reset = () => setForm({
    journalId: 0, date: today, ref: "", description: "",
    lines: [{ accountId: 0, debit: 0, credit: 0, description: "" }, { accountId: 0, debit: 0, credit: 0, description: "" }],
  });

  const totalD = form.lines.reduce((s, l) => s + (Number(l.debit) || 0), 0);
  const totalC = form.lines.reduce((s, l) => s + (Number(l.credit) || 0), 0);
  const balanced = totalD === totalC && totalD > 0;

  const submit = async () => {
    if (!form.journalId || !form.date) {
      toast({ title: t.common.error, variant: "destructive" }); return;
    }
    if (!balanced) {
      toast({ title: t.common.error, description: `Debit ${idr(totalD)} ≠ Kredit ${idr(totalC)}`, variant: "destructive" }); return;
    }
    const lines = form.lines.filter((l) => l.accountId && (Number(l.debit) || Number(l.credit)));
    if (lines.length < 2) {
      toast({ title: t.common.error, variant: "destructive" }); return;
    }
    try {
      await createMut.mutateAsync({
        data: {
          journalId: form.journalId, date: new Date(form.date).toISOString(),
          ref: form.ref || null, description: form.description || null,
          lines: lines.map((l) => ({ accountId: l.accountId, debit: Number(l.debit) || 0, credit: Number(l.credit) || 0, description: l.description || null })),
        },
      });
      toast({ title: t.common.success });
      qc.invalidateQueries({ queryKey: getListAccountingEntriesQueryKey() });
      reset(); setOpen(false);
    } catch (e: unknown) {
      const msg = (e as { message?: string })?.message ?? String(e);
      toast({ title: t.common.error, description: msg, variant: "destructive" });
    }
  };

  const refreshEntries = () => {
    qc.invalidateQueries({ queryKey: getListAccountingEntriesQueryKey() });
    setSelected(new Set());
  };

  const journalLabel = (id: number) => journals?.find((j) => j.id === id)?.code ?? `#${id}`;

  const allRows = entries ?? [];
  const rows = useMemo(() => {
    let r = allRows;
    if (filter.source) r = r.filter((e) => e.source === filter.source);
    if (filter.search) {
      const q = filter.search.toLowerCase();
      r = r.filter((e) =>
        (e.ref ?? "").toLowerCase().includes(q) ||
        (e.description ?? "").toLowerCase().includes(q),
      );
    }
    return r;
  }, [allRows, filter.source, filter.search]);

  const allSelected = rows.length > 0 && rows.every((e) => selected.has(e.id));
  const someSelected = rows.some((e) => selected.has(e.id));

  const toggleAll = () => {
    if (allSelected) {
      setSelected(new Set());
    } else {
      setSelected(new Set(rows.map((e) => e.id)));
    }
  };

  const toggleOne = (id: number) => {
    const next = new Set(selected);
    if (next.has(id)) next.delete(id); else next.add(id);
    setSelected(next);
  };

  const selectedIds = [...selected];

  const handleBulkDelete = async () => {
    setBulkDeleting(true);
    let ok = 0;
    let fail = 0;
    for (const id of selectedIds) {
      try {
        await deleteEntry(id);
        ok++;
      } catch {
        fail++;
      }
    }
    setBulkDeleting(false);
    setBulkDeleteOpen(false);
    setSelected(new Set());
    qc.invalidateQueries({ queryKey: getListAccountingEntriesQueryKey() });
    toast({
      title: fail === 0 ? `${ok} entri berhasil dihapus` : `${ok} berhasil, ${fail} gagal`,
      variant: fail > 0 ? "destructive" : "default",
    });
  };

  const headers = ["Nomor", "Tanggal", "Jurnal", "Sumber", "Status", "Ref", "Deskripsi", "Debit", "Kredit"];
  const xlsxRows = () => rows.map((e) => [
    e.entryNumber,
    new Date(e.date).toLocaleDateString("id-ID"),
    journalLabel(e.journalId),
    SOURCE_LABELS[e.source] ?? e.source,
    e.status,
    e.ref ?? "",
    e.description ?? "",
    e.totalDebit,
    e.totalCredit,
  ]);

  return (
    <AppShell>
      <div className="space-y-6 p-6">
        <div className="flex items-center justify-between">
          <div className="flex items-start gap-3">
            <Link href="/accounting">
              <Button variant="ghost" size="icon" className="h-8 w-8 mt-1" aria-label="Kembali"><ArrowLeft className="h-4 w-4" /></Button>
            </Link>
            <div>
              <h1 className="text-2xl font-bold flex items-center gap-2"><FileText className="h-6 w-6" />Jurnal Entry</h1>
              <p className="text-sm text-muted-foreground">Daftar entri jurnal — auto-posting & manual. Jurnal posted bisa Dibalik; jurnal manual bisa di-Reset Draft.</p>
            </div>
          </div>
          <div className="flex gap-2">
            {someSelected && (
              <Dialog open={bulkDeleteOpen} onOpenChange={setBulkDeleteOpen}>
                <DialogTrigger asChild>
                  <Button variant="destructive" size="sm">
                    <Trash2 className="h-4 w-4 mr-1.5" />Hapus {selectedIds.length} Entri
                  </Button>
                </DialogTrigger>
                <DialogContent className="max-w-sm">
                  <DialogHeader><DialogTitle>Hapus {selectedIds.length} Entri?</DialogTitle></DialogHeader>
                  <p className="text-sm text-slate-300 py-2">
                    <strong>{selectedIds.length} entri</strong> yang dipilih akan dihapus permanen. Aksi ini tidak bisa dibatalkan.
                  </p>
                  <DialogFooter>
                    <Button variant="outline" onClick={() => setBulkDeleteOpen(false)} disabled={bulkDeleting}>Batal</Button>
                    <Button onClick={handleBulkDelete} disabled={bulkDeleting} variant="destructive">
                      {bulkDeleting ? "Menghapus..." : `Ya, Hapus ${selectedIds.length} Entri`}
                    </Button>
                  </DialogFooter>
                </DialogContent>
              </Dialog>
            )}
            <Button variant="outline" size="sm" onClick={() => printWindow("Jurnal Entry", headers, xlsxRows(), [7, 8])} disabled={rows.length === 0}>
              <Printer className="h-4 w-4 mr-1.5" />Print Preview
            </Button>
            <Button variant="outline" size="sm" onClick={() => exportXlsx("Jurnal_Entry", headers, xlsxRows())} disabled={rows.length === 0}>
              <Download className="h-4 w-4 mr-1.5" />Export XLSX
            </Button>
            <Dialog open={open} onOpenChange={(o) => { setOpen(o); if (!o) reset(); }}>
              <DialogTrigger asChild><Button data-testid="button-add-entry"><Plus className="h-4 w-4 mr-2" />Entry Manual</Button></DialogTrigger>
              <DialogContent className="max-w-3xl">
                <DialogHeader><DialogTitle>Jurnal Entry Manual — No. akan digenerate otomatis sebagai JE/YYYY/NNNN</DialogTitle></DialogHeader>
                <div className="space-y-3">
                  <div className="grid grid-cols-3 gap-3">
                    <div>
                      <Label>Jurnal</Label>
                      <Select value={form.journalId ? String(form.journalId) : ""} onValueChange={(v) => setForm({ ...form, journalId: parseInt(v) })}>
                        <SelectTrigger data-testid="select-entry-journal"><SelectValue placeholder="Pilih" /></SelectTrigger>
                        <SelectContent>{(journals ?? []).map((j) => (<SelectItem key={j.id} value={String(j.id)}>{j.code} - {j.name}</SelectItem>))}</SelectContent>
                      </Select>
                    </div>
                    <div><Label>Tanggal</Label><DatePicker value={form.date} onChange={(date) => setForm({ ...form, date })} data-testid="input-entry-date" /></div>
                    <div><Label>Referensi</Label><Input value={form.ref} onChange={(e) => setForm({ ...form, ref: e.target.value })} placeholder="opsional" /></div>
                  </div>
                  <div><Label>Deskripsi</Label><Input value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} placeholder="opsional" /></div>
                  <div className="border rounded-md">
                    <Table>
                      <TableHeader><TableRow><TableHead>Akun</TableHead><TableHead className="w-32">Debit</TableHead><TableHead className="w-32">Kredit</TableHead><TableHead>Deskripsi</TableHead><TableHead className="w-10"></TableHead></TableRow></TableHeader>
                      <TableBody>
                        {form.lines.map((l, i) => (
                          <TableRow key={i}>
                            <TableCell>
                              <AccountCombobox
                                accounts={accounts ?? []}
                                value={l.accountId || null}
                                onChange={(v) => { const lines = [...form.lines]; lines[i] = { ...lines[i]!, accountId: v }; setForm({ ...form, lines }); }}
                                data-testid={`select-line-account-${i}`}
                              />
                            </TableCell>
                            <TableCell><Input data-testid={`input-line-debit-${i}`} type="number" step="0.01" value={l.debit || ""} onChange={(e) => { const lines = [...form.lines]; lines[i] = { ...lines[i]!, debit: parseFloat(e.target.value) || 0, credit: 0 }; setForm({ ...form, lines }); }} /></TableCell>
                            <TableCell><Input data-testid={`input-line-credit-${i}`} type="number" step="0.01" value={l.credit || ""} onChange={(e) => { const lines = [...form.lines]; lines[i] = { ...lines[i]!, credit: parseFloat(e.target.value) || 0, debit: 0 }; setForm({ ...form, lines }); }} /></TableCell>
                            <TableCell><Input value={l.description} onChange={(e) => { const lines = [...form.lines]; lines[i] = { ...lines[i]!, description: e.target.value }; setForm({ ...form, lines }); }} /></TableCell>
                            <TableCell><Button size="icon" variant="ghost" onClick={() => { const lines = form.lines.filter((_, idx) => idx !== i); setForm({ ...form, lines: lines.length > 0 ? lines : [{ accountId: 0, debit: 0, credit: 0, description: "" }] }); }}><Trash2 className="h-4 w-4" /></Button></TableCell>
                          </TableRow>
                        ))}
                      </TableBody>
                    </Table>
                  </div>
                  <div className="flex items-center justify-between">
                    <Button variant="outline" size="sm" onClick={() => setForm({ ...form, lines: [...form.lines, { accountId: 0, debit: 0, credit: 0, description: "" }] })}>+ Tambah Baris</Button>
                    <div className="flex gap-4 text-sm font-medium">
                      <span>Total Debit: <span className="font-mono">{idr(totalD)}</span></span>
                      <span>Total Kredit: <span className="font-mono">{idr(totalC)}</span></span>
                      <Badge variant={balanced ? "default" : "destructive"}>{balanced ? "✓ Seimbang" : "✗ Tidak seimbang"}</Badge>
                    </div>
                  </div>
                </div>
                <DialogFooter>
                  <Button variant="outline" onClick={() => setOpen(false)}>Batal</Button>
                  <Button onClick={submit} disabled={!balanced} data-testid="button-post-entry">Post</Button>
                </DialogFooter>
              </DialogContent>
            </Dialog>
          </div>
        </div>

        <Card><CardContent className="p-4">
          <div className="grid grid-cols-2 md:grid-cols-3 gap-3 mb-3">
            <div>
              <Label>Jurnal</Label>
              <Select value={filter.journalId ? String(filter.journalId) : "all"} onValueChange={(v) => setFilter({ ...filter, journalId: v === "all" ? undefined : parseInt(v) })}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">Semua Jurnal</SelectItem>
                  {(journals ?? []).map((j) => (<SelectItem key={j.id} value={String(j.id)}>{j.code} - {j.name}</SelectItem>))}
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label>Modul Sumber</Label>
              <Select value={filter.source ?? "all"} onValueChange={(v) => setFilter({ ...filter, source: v === "all" ? undefined : v })}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">Semua Sumber</SelectItem>
                  <SelectItem value="manual">Manual</SelectItem>
                  <SelectItem value="sales_invoice">Faktur Jual</SelectItem>
                  <SelectItem value="purchase_bill">Tagihan Beli</SelectItem>
                  <SelectItem value="sales_payment">Bayar Masuk</SelectItem>
                  <SelectItem value="purchase_payment">Bayar Keluar</SelectItem>
                  <SelectItem value="manual_payment">Bayar Manual</SelectItem>
                  <SelectItem value="pos_sale">POS Penjualan</SelectItem>
                  <SelectItem value="reversal">Pembalik</SelectItem>
                  <SelectItem value="sport_center_booking">Booking Sport Center</SelectItem>
                  <SelectItem value="sport_center_membership">Membership Sport Center</SelectItem>
                  <SelectItem value="sport_center_refund">Refund Sport Center</SelectItem>
                  <SelectItem value="sport_center_booking_reversal">Pembalik Booking Sport</SelectItem>
                  <SelectItem value="bank_mutation_import">Import Mutasi Bank</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label>Cari (Ref / Deskripsi)</Label>
              <Input
                placeholder="Nama pelanggan, fasilitas, no. referensi…"
                value={filter.search ?? ""}
                onChange={(e) => setFilter({ ...filter, search: e.target.value || undefined })}
              />
            </div>
          </div>
          <div className="grid grid-cols-2 gap-3 mb-4">
            <div><Label>Dari</Label><DatePicker value={filter.from ?? ""} onChange={(v) => setFilter({ ...filter, from: v || undefined })} /></div>
            <div><Label>Sampai</Label><DatePicker value={filter.to ?? ""} onChange={(v) => setFilter({ ...filter, to: v || undefined })} /></div>
          </div>

          {someSelected && (
            <div className="flex items-center gap-2 mb-3 px-2 py-1.5 rounded-md bg-red-950/30 border border-red-800/40 text-sm text-red-300">
              <Trash2 className="h-3.5 w-3.5" />
              <span>{selectedIds.length} entri dipilih</span>
              <Button variant="ghost" size="sm" className="h-6 px-2 text-xs text-red-300 hover:text-red-200" onClick={() => setSelected(new Set())}>Batalkan pilihan</Button>
            </div>
          )}

          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="w-10">
                  <Checkbox
                    checked={allSelected}
                    onCheckedChange={toggleAll}
                    aria-label="Pilih semua"
                    className="data-[state=indeterminate]:opacity-60"
                    data-state={allSelected ? "checked" : someSelected ? "indeterminate" : "unchecked"}
                  />
                </TableHead>
                <TableHead>Nomor</TableHead>
                <TableHead>Tanggal</TableHead>
                <TableHead>Jurnal</TableHead>
                <TableHead>Sumber</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Ref</TableHead>
                <TableHead>Deskripsi</TableHead>
                <TableHead className="text-right">Debit</TableHead>
                <TableHead className="text-right">Kredit</TableHead>
                <TableHead className="text-right">Aksi</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.length === 0 ? (
                <TableRow><TableCell colSpan={11} className="text-center text-muted-foreground py-8">Tidak ada entri</TableCell></TableRow>
              ) : rows.map((e) => (
                <TableRow key={e.id} data-testid={`row-entry-${e.id}`} className={(e.status as string) === "cancelled" ? "opacity-40" : selected.has(e.id) ? "bg-red-950/20" : undefined} {...prefetchHover(getGetAccountingEntryQueryOptions(e.id))}>
                  <TableCell>
                    <Checkbox
                      checked={selected.has(e.id)}
                      onCheckedChange={() => toggleOne(e.id)}
                      aria-label={`Pilih ${e.entryNumber}`}
                    />
                  </TableCell>
                  <TableCell>
                    <Link href={`/accounting/entries/${e.id}`} className="text-indigo-400 hover:underline font-mono text-xs">
                      {e.entryNumber}
                    </Link>
                  </TableCell>
                  <TableCell className="text-xs">{new Date(e.date).toLocaleDateString("id-ID")}</TableCell>
                  <TableCell><Badge variant="outline">{journalLabel(e.journalId)}</Badge></TableCell>
                  <TableCell>
                    <Badge variant={(e.source as string) === "reversal" ? "destructive" : "secondary"} className="text-xs">
                      {SOURCE_LABELS[e.source] ?? e.source}
                    </Badge>
                  </TableCell>
                  <TableCell>
                    <Badge
                      className={
                        (e.status as string) === "posted"
                          ? "bg-green-900/40 text-green-300 border-green-700 text-xs"
                          : (e.status as string) === "cancelled"
                          ? "bg-slate-700/60 text-slate-400 border-slate-600 text-xs"
                          : "bg-yellow-900/40 text-yellow-300 border-yellow-700 text-xs"
                      }
                    >
                      {(e.status as string) === "posted" ? "Posted" : (e.status as string) === "cancelled" ? "Dibatalkan" : "Draft"}
                    </Badge>
                  </TableCell>
                  <TableCell className="text-xs">{e.ref ?? "-"}</TableCell>
                  <TableCell className="text-xs max-w-[180px] truncate">{e.description ?? "-"}</TableCell>
                  <TableCell className="text-right font-mono text-xs">{idr(e.totalDebit)}</TableCell>
                  <TableCell className="text-right font-mono text-xs">{idr(e.totalCredit)}</TableCell>
                  <TableCell className="text-right">
                    <div className="flex flex-col items-end gap-1">
                      <div className="flex gap-1 justify-end">
                        <PostDraftButton entry={e} onDone={refreshEntries} />
                        <ReverseDialog entry={e} onDone={refreshEntries} />
                        <ResetDraftDialog entry={e} onDone={refreshEntries} />
                        <DeleteEntryDialog entry={e} onDone={refreshEntries} />
                      </div>
                      {/* Phase 12: AI Review cross-link — non-blocking, read-only */}
                      <AIReviewSourcePanel
                        source="ACCOUNTING_ENTRY"
                        sourceRecordId={String(e.id)}
                        transactionSnapshot={{
                          id: String(e.id),
                          description: e.description ?? e.entryNumber ?? `Entry #${e.id}`,
                          amount: e.totalDebit || e.totalCredit || 0,
                          direction: e.totalDebit > 0 ? 'DEBIT' : 'CREDIT',
                          referenceNumber: e.ref ?? undefined,
                          transactionDate: new Date(e.date).toISOString(),
                        }}
                      />
                    </div>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent></Card>
      </div>
    </AppShell>
  );
}
