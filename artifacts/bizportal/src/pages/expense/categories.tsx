import { useState } from "react";
import { useCodeCheck } from "@/hooks/useCodeCheck";
import { CodeCheckIndicator } from "@/components/ui/code-check-indicator";
import { AppShell } from "@/components/layout/AppShell";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import {
  Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { useToast } from "@/hooks/use-toast";
import { useLanguage } from "@/contexts/LanguageContext";
import {
  useListExpenseCategories,
  useCreateExpenseCategory,
  useUpdateExpenseCategory,
  useDeleteExpenseCategory,
  useSeedExpenseCategories,
  useListAccounts,
  useListTaxes,
  getListExpenseCategoriesQueryKey,
  type ExpenseCategory,
} from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { ArrowLeft, Pencil, Plus, Trash2, Tags, RefreshCw } from "lucide-react";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Link } from "wouter";

const EMPTY_FORM = {
  name: "",
  code: "",
  categoryType: "both" as "expense" | "income" | "both",
  expenseAccountId: null as number | null,
  payableAccountId: null as number | null,
  defaultTaxId: null as number | null,
  defaultAmount: "" as string,
  defaultCoaId: null as number | null,
  requiresAttachment: false,
  isActive: true,
};

export default function ExpenseCategoriesPage() {
  const qc = useQueryClient();
  const { toast } = useToast();
  const { t } = useLanguage();
  const { data: cats = [] } = useListExpenseCategories();
  const { data: accounts = [] } = useListAccounts();
  const { data: taxes = [] } = useListTaxes();
  const createMut = useCreateExpenseCategory();
  const updateMut = useUpdateExpenseCategory();
  const deleteMut = useDeleteExpenseCategory();
  const seedMut = useSeedExpenseCategories();

  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<ExpenseCategory | null>(null);
  const [form, setForm] = useState({ ...EMPTY_FORM });
  const [deleteId, setDeleteId] = useState<number | null>(null);

  const reset = () => { setEditing(null); setForm({ ...EMPTY_FORM }); };

  const codeCheckUrl = open && form.code.trim()
    ? `/api/expenses/categories/check-code?code=${encodeURIComponent(form.code)}${editing ? `&excludeId=${editing.id}` : ""}`
    : null;
  const { checking: codeChecking, taken: codeTaken } = useCodeCheck(codeCheckUrl, form.code);

  const startEdit = (c: ExpenseCategory) => {
    setEditing(c);
    setForm({
      name: c.name,
      code: c.code,
      categoryType: ((c as any).categoryType ?? "both") as "expense" | "income" | "both",
      expenseAccountId: c.expenseAccountId ?? null,
      payableAccountId: c.payableAccountId ?? null,
      defaultTaxId: (c as any).defaultTaxId ?? null,
      defaultAmount: (c as any).defaultAmount ? String(Number((c as any).defaultAmount)) : "",
      defaultCoaId: (c as any).defaultCoaId ?? null,
      requiresAttachment: c.requiresAttachment,
      isActive: c.isActive,
    });
    setOpen(true);
  };

  const submit = async () => {
    if (!form.name.trim() || !form.code.trim()) {
      toast({ title: t.common.error, variant: "destructive" }); return;
    }
    try {
      const body = {
        name: form.name,
        code: form.code.toUpperCase(),
        categoryType: form.categoryType,
        expenseAccountId: form.expenseAccountId || undefined,
        payableAccountId: form.payableAccountId || undefined,
        defaultTaxId: form.defaultTaxId || undefined,
        defaultAmount: form.defaultAmount ? Number(form.defaultAmount) : undefined,
        defaultCoaId: form.defaultCoaId || undefined,
        requiresAttachment: form.requiresAttachment,
        isActive: form.isActive,
      };
      if (editing) {
        await updateMut.mutateAsync({ id: editing.id, data: body });
        toast({ title: t.common.success });
      } else {
        await createMut.mutateAsync({ data: body });
        toast({ title: t.common.success });
      }
      qc.invalidateQueries({ queryKey: getListExpenseCategoriesQueryKey() });
      reset(); setOpen(false);
    } catch (e: any) {
      toast({ title: e?.message ?? t.common.error, variant: "destructive" });
    }
  };

  const handleSeed = async () => {
    try {
      const res = await seedMut.mutateAsync();
      qc.invalidateQueries({ queryKey: getListExpenseCategoriesQueryKey() });
      toast({ title: t.common.success });
    } catch (e: any) {
      toast({ title: e?.message ?? t.common.error, variant: "destructive" });
    }
  };

  const handleDelete = async () => {
    if (!deleteId) return;
    try {
      await deleteMut.mutateAsync({ id: deleteId });
      qc.invalidateQueries({ queryKey: getListExpenseCategoriesQueryKey() });
      toast({ title: t.common.success });
    } catch (e: any) {
      toast({ title: e?.message ?? t.common.error, variant: "destructive" });
    } finally { setDeleteId(null); }
  };

  const getAccountName = (id: number | null | undefined) =>
    id ? (accounts.find((a) => a.id === id)?.name ?? `#${id}`) : "—";

  return (
    <AppShell>
      <div className="p-6 space-y-4">
        <div className="flex items-center justify-between gap-4">
          <div className="flex items-center gap-3">
            <Tags size={22} className="text-primary" />
            <div>
              <Link href="/expense"><Button variant="ghost" size="icon"><ArrowLeft className="h-4 w-4" /></Button></Link>

              <h1 className="text-xl font-bold">Kategori Biaya</h1>
              <p className="text-sm text-muted-foreground">Kelola kategori pengelompokan biaya operasional</p>
            </div>
          </div>
          <div className="flex gap-2">
            <Button variant="outline" size="sm" onClick={handleSeed} disabled={seedMut.isPending}>
              <RefreshCw size={14} className="mr-1" />
              Seed Default
            </Button>
            <Button size="sm" onClick={() => { reset(); setOpen(true); }}>
              <Plus size={14} className="mr-1" />
              Tambah Kategori
            </Button>
          </div>
        </div>

        <Card>
          <CardContent className="p-0">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Kode</TableHead>
                  <TableHead>Nama</TableHead>
                  <TableHead>Jenis</TableHead>
                  <TableHead>Akun Biaya (DR)</TableHead>
                  <TableHead>Pajak Default</TableHead>
                  <TableHead>Lampiran</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead className="w-20"></TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {cats.length === 0 && (
                  <TableRow>
                    <TableCell colSpan={7} className="text-center text-muted-foreground py-10">
                      Belum ada kategori. Klik "Seed Default" untuk memulai.
                    </TableCell>
                  </TableRow>
                )}
                {cats.map((c) => {
                  const defaultTax = taxes.find((t) => t.id === (c as any).defaultTaxId);
                  return (
                  <TableRow key={c.id}>
                    <TableCell className="font-mono text-xs">{c.code}</TableCell>
                    <TableCell className="font-medium">{c.name}</TableCell>
                    <TableCell>
                      {(c as any).categoryType === "income"
                        ? <Badge className="bg-emerald-900/40 text-emerald-300 border-emerald-700 text-xs">Penerimaan</Badge>
                        : (c as any).categoryType === "expense"
                        ? <Badge className="bg-red-900/40 text-red-300 border-red-700 text-xs">Pengeluaran</Badge>
                        : <Badge variant="outline" className="text-muted-foreground text-xs">Keduanya</Badge>}
                    </TableCell>
                    <TableCell className="text-sm text-muted-foreground">{getAccountName(c.expenseAccountId)}</TableCell>
                    <TableCell className="text-sm text-muted-foreground">
                      {defaultTax
                        ? <span className="text-amber-400 text-xs">{defaultTax.name} ({Number(defaultTax.rate)}%)</span>
                        : <span className="text-xs text-muted-foreground">—</span>}
                    </TableCell>
                    <TableCell>
                      {c.requiresAttachment
                        ? <Badge variant="outline" className="text-amber-400 border-amber-500 text-xs">Wajib</Badge>
                        : <span className="text-xs text-muted-foreground">—</span>}
                    </TableCell>
                    <TableCell>
                      {c.isActive
                        ? <Badge className="bg-emerald-900/40 text-emerald-300 border-emerald-700 text-xs">Aktif</Badge>
                        : <Badge variant="outline" className="text-muted-foreground text-xs">Non-aktif</Badge>}
                    </TableCell>
                    <TableCell>
                      <div className="flex gap-1">
                        <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => startEdit(c)}>
                          <Pencil size={13} />
                        </Button>
                        <Button variant="ghost" size="icon" className="h-7 w-7 text-destructive hover:text-destructive" onClick={() => setDeleteId(c.id)}>
                          <Trash2 size={13} />
                        </Button>
                      </div>
                    </TableCell>
                  </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      </div>

      <Dialog open={open} onOpenChange={(v) => { if (!v) reset(); setOpen(v); }}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>{editing ? "Edit Kategori" : "Tambah Kategori"}</DialogTitle>
          </DialogHeader>
          <div className="grid gap-4 py-2">
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-1.5">
                <Label>Nama <span className="text-destructive">*</span></Label>
                <Input placeholder="Biaya Trucking" value={form.name}
                  onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))} />
              </div>
              <div className="space-y-1.5">
                <Label>Kode <span className="text-destructive">*</span></Label>
                <Input placeholder="TRUCKING" value={form.code}
                  onChange={(e) => setForm((f) => ({ ...f, code: e.target.value.toUpperCase() }))}
                  className={codeTaken === true ? "border-destructive focus-visible:ring-destructive" : ""} />
                <CodeCheckIndicator checking={codeChecking} taken={codeTaken} />
              </div>
            </div>
            <div className="space-y-1.5">
              <Label>Jenis Transaksi</Label>
              <Select
                value={form.categoryType}
                onValueChange={(v) => setForm((f) => ({ ...f, categoryType: v as any }))}
              >
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="both">Pengeluaran & Penerimaan</SelectItem>
                  <SelectItem value="expense">Pengeluaran saja</SelectItem>
                  <SelectItem value="income">Penerimaan saja</SelectItem>
                </SelectContent>
              </Select>
              <p className="text-xs text-muted-foreground">Tentukan apakah kategori ini muncul di form Pengeluaran, Penerimaan, atau keduanya.</p>
            </div>
            <div className="space-y-1.5">
              <Label>Akun Biaya (Debit)</Label>
              <Select
                value={form.expenseAccountId?.toString() ?? "none"}
                onValueChange={(v) => setForm((f) => ({ ...f, expenseAccountId: v === "none" ? null : Number(v) }))}
              >
                <SelectTrigger><SelectValue placeholder="Pilih akun..." /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="none">— Tidak dipilih —</SelectItem>
                  {accounts.filter((a) => a.type === "expense" || a.type === "asset").map((a) => (
                    <SelectItem key={a.id} value={a.id.toString()}>
                      {a.code} — {a.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label>Akun Hutang (Kredit)</Label>
              <Select
                value={form.payableAccountId?.toString() ?? "none"}
                onValueChange={(v) => setForm((f) => ({ ...f, payableAccountId: v === "none" ? null : Number(v) }))}
              >
                <SelectTrigger><SelectValue placeholder="Pilih akun..." /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="none">— Tidak dipilih —</SelectItem>
                  {accounts.filter((a) => a.type === "liability").map((a) => (
                    <SelectItem key={a.id} value={a.id.toString()}>
                      {a.code} — {a.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label>Akun Sumber Pembayaran Default</Label>
              <Select
                value={form.defaultCoaId?.toString() ?? "none"}
                onValueChange={(v) => setForm((f) => ({ ...f, defaultCoaId: v === "none" ? null : Number(v) }))}
              >
                <SelectTrigger><SelectValue placeholder="Pilih akun kas/bank..." /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="none">— Tidak dipilih —</SelectItem>
                  {accounts.filter((a) => a.type === "asset" && (a.name.toLowerCase().includes("kas") || a.name.toLowerCase().includes("bank"))).map((a) => (
                    <SelectItem key={a.id} value={a.id.toString()}>
                      {a.code} — {a.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <p className="text-xs text-muted-foreground">Akun kas/bank yang otomatis terpilih saat membuat biaya dari kategori ini.</p>
            </div>
            <div className="space-y-1.5">
              <Label>Pajak Default (Auto-fill)</Label>
              <Select
                value={form.defaultTaxId?.toString() ?? "none"}
                onValueChange={(v) => setForm((f) => ({ ...f, defaultTaxId: v === "none" ? null : Number(v) }))}
              >
                <SelectTrigger><SelectValue placeholder="Tanpa pajak default" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="none">— Tanpa pajak default —</SelectItem>
                  {taxes.map((t) => (
                    <SelectItem key={t.id} value={t.id.toString()}>
                      {t.name} ({Number(t.rate)}%)
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <p className="text-xs text-muted-foreground">Saat kategori ini dipilih di form Biaya Rutin, pajak akan ter-isi otomatis.</p>
            </div>
            <div className="space-y-1.5">
              <Label>Harga Default (Auto-fill Nominal)</Label>
              <Input
                type="number"
                min="0"
                step="any"
                placeholder="0 (kosong = tidak ada default)"
                value={form.defaultAmount}
                onChange={(e) => setForm((f) => ({ ...f, defaultAmount: e.target.value }))}
              />
              <p className="text-xs text-muted-foreground">Saat kategori ini dipilih di form Biaya Rutin, nominal akan ter-isi otomatis dengan nilai ini.</p>
            </div>
            <div className="flex items-center justify-between rounded-lg border border-border px-4 py-3">
              <div>
                <p className="text-sm font-medium">Wajib Lampiran</p>
                <p className="text-xs text-muted-foreground">Expense dengan kategori ini wajib melampirkan bukti</p>
              </div>
              <Switch checked={form.requiresAttachment}
                onCheckedChange={(v) => setForm((f) => ({ ...f, requiresAttachment: v }))} />
            </div>
            <div className="flex items-center justify-between rounded-lg border border-border px-4 py-3">
              <div>
                <p className="text-sm font-medium">Aktif</p>
              </div>
              <Switch checked={form.isActive}
                onCheckedChange={(v) => setForm((f) => ({ ...f, isActive: v }))} />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => { reset(); setOpen(false); }}>Batal</Button>
            <Button onClick={submit} disabled={createMut.isPending || updateMut.isPending}>
              {editing ? "Simpan Perubahan" : "Tambah"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <AlertDialog open={!!deleteId} onOpenChange={(v) => !v && setDeleteId(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Hapus Kategori?</AlertDialogTitle>
            <AlertDialogDescription>Tindakan ini tidak dapat dibatalkan.</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Batal</AlertDialogCancel>
            <AlertDialogAction onClick={handleDelete} className="bg-destructive text-destructive-foreground hover:bg-destructive/90">
              Hapus
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </AppShell>
  );
}
