import { useState } from "react";
import { Link } from "wouter";
import { AppShell } from "@/components/layout/AppShell";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter,
} from "@/components/ui/dialog";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useCompany } from "@/contexts/CompanyContext";
import { useToast } from "@/hooks/use-toast";

async function apiFetch(url: string, opts?: RequestInit) {
  const r = await fetch(url, { credentials: "include", ...opts });
  const d = await r.json();
  if (!r.ok) throw new Error(d.message ?? "Terjadi kesalahan.");
  return d;
}
import {
  useListExpenseCategories, useListTaxes,
} from "@workspace/api-client-react";
import {
  ArrowLeft, Plus, Pencil, Trash2, Loader2, Layers, Wand2,
} from "lucide-react";

const idr = (n: number) =>
  new Intl.NumberFormat("id-ID", { style: "currency", currency: "IDR", maximumFractionDigits: 0 }).format(n);

interface Template {
  id: number;
  name: string;
  description?: string;
  category_id?: number;
  category_name?: string;
  expense_account_id?: number;
  expense_account_name?: string;
  expense_account_code?: string;
  tax_rate_id?: number;
  tax_name?: string;
  tax_rate?: number;
  payment_method: string;
  default_vendor?: string;
  amount_preset?: string;
  is_active: boolean;
  sort_order: number;
}

const PM_LABELS: Record<string, string> = { cash: "Kas", bank: "Transfer Bank", other: "Lainnya" };

export default function ExpenseTemplatesPage() {
  const { activeCompanyId } = useCompany();
  const { toast } = useToast();
  const qc = useQueryClient();

  const companyParam = activeCompanyId ? `?companyId=${activeCompanyId}` : "";

  const { data: templates = [], isLoading } = useQuery<Template[]>({
    queryKey: ["expense-templates-all", activeCompanyId],
    queryFn: () => apiFetch(`/api/expense-templates/all${companyParam}`),
    staleTime: 30_000,
  });

  const { data: categoriesRaw } = useListExpenseCategories({ companyId: activeCompanyId ?? undefined } as any);
  const categories = (categoriesRaw as any)?.data ?? categoriesRaw ?? [];

  const { data: taxesRaw } = useListTaxes({ companyId: activeCompanyId ?? undefined } as any);
  const taxes = (taxesRaw as any)?.data ?? taxesRaw ?? [];

  const { data: accounts = [] } = useQuery<any[]>({
    queryKey: ["chart-of-accounts", activeCompanyId],
    queryFn: () => apiFetch(`/api/accounting/accounts${activeCompanyId ? `?companyId=${activeCompanyId}` : ""}`),
    staleTime: 5 * 60_000,
  });

  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<Template | null>(null);
  const [form, setForm] = useState({
    name: "", description: "", categoryId: "", expenseAccountId: "",
    taxRateId: "", paymentMethod: "bank", defaultVendor: "", amountPreset: "", isActive: true, sortOrder: "0",
  });
  const [deleteId, setDeleteId] = useState<number | null>(null);

  function openNew() {
    setEditing(null);
    setForm({ name: "", description: "", categoryId: "", expenseAccountId: "", taxRateId: "", paymentMethod: "bank", defaultVendor: "", amountPreset: "", isActive: true, sortOrder: "0" });
    setOpen(true);
  }

  function openEdit(t: Template) {
    setEditing(t);
    setForm({
      name: t.name, description: t.description ?? "", categoryId: String(t.category_id ?? ""),
      expenseAccountId: String(t.expense_account_id ?? ""), taxRateId: String(t.tax_rate_id ?? ""),
      paymentMethod: t.payment_method, defaultVendor: t.default_vendor ?? "",
      amountPreset: t.amount_preset ? String(t.amount_preset) : "", isActive: t.is_active,
      sortOrder: String(t.sort_order),
    });
    setOpen(true);
  }

  const saveMut = useMutation({
    mutationFn: (body: any) =>
      editing
        ? apiFetch(`/api/expense-templates/${editing.id}`, { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) })
        : apiFetch("/api/expense-templates", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["expense-templates-all"] });
      setOpen(false);
      toast({ title: editing ? "Template diperbarui." : "Template ditambahkan." });
    },
    onError: (e: any) => toast({ title: "Error", description: e?.message ?? "Gagal menyimpan.", variant: "destructive" }),
  });

  const deleteMut = useMutation({
    mutationFn: (id: number) => apiFetch(`/api/expense-templates/${id}`, { method: "DELETE" }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["expense-templates-all"] });
      setDeleteId(null);
      toast({ title: "Template dihapus." });
    },
  });

  const seedMut = useMutation({
    mutationFn: () => apiFetch("/api/expense-templates/seed", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({}) }),
    onSuccess: (d: any) => {
      qc.invalidateQueries({ queryKey: ["expense-templates-all"] });
      toast({ title: `${d?.seeded ?? 0} template standar ditambahkan.` });
    },
  });

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!form.name.trim()) return;
    saveMut.mutate({
      name: form.name.trim(), description: form.description || undefined,
      categoryId: form.categoryId || undefined, expenseAccountId: form.expenseAccountId || undefined,
      taxRateId: form.taxRateId || undefined, paymentMethod: form.paymentMethod,
      defaultVendor: form.defaultVendor || undefined,
      amountPreset: form.amountPreset ? parseFloat(form.amountPreset.replace(/\D/g, "")) : undefined,
      isActive: form.isActive, sortOrder: parseInt(form.sortOrder) || 0,
    });
  }

  const expenseAccounts = accounts.filter((a: any) => a.type === "expense" || a.code?.startsWith("6"));

  return (
    <AppShell>
      <div className="max-w-5xl mx-auto px-4 py-6 space-y-5">
        <div className="flex items-center justify-between gap-4 flex-wrap">
          <div className="flex items-center gap-3">
            <Link href="/expense"><Button variant="ghost" size="icon"><ArrowLeft size={16} /></Button></Link>
            <div>
              <h1 className="text-2xl font-bold flex items-center gap-2"><Layers size={22} />Template Expense</h1>
              <p className="text-sm text-muted-foreground">Preset otomatis mengisi kategori, akun, pajak, dan metode pembayaran.</p>
            </div>
          </div>
          <div className="flex gap-2">
            <Button variant="outline" size="sm" onClick={() => seedMut.mutate()} disabled={seedMut.isPending}>
              <Wand2 size={14} className="mr-1" />{seedMut.isPending ? "Menambah…" : "Tambah Template Standar"}
            </Button>
            <Button size="sm" onClick={openNew}><Plus size={14} className="mr-1" />Tambah</Button>
          </div>
        </div>

        <Card>
          <CardContent className="p-0">
            {isLoading ? (
              <div className="py-16 flex justify-center text-muted-foreground"><Loader2 size={20} className="animate-spin" /></div>
            ) : templates.length === 0 ? (
              <div className="py-16 text-center text-muted-foreground">
                <Layers size={32} className="mx-auto mb-3 opacity-30" />
                <p>Belum ada template.</p>
                <p className="text-xs mt-1">Klik "Tambah Template Standar" untuk memulai.</p>
              </div>
            ) : (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>#</TableHead>
                    <TableHead>Nama Template</TableHead>
                    <TableHead>Kategori</TableHead>
                    <TableHead>Akun Expense</TableHead>
                    <TableHead>Pajak</TableHead>
                    <TableHead>Metode</TableHead>
                    <TableHead>Preset Nominal</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead className="w-16"></TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {templates.map((t) => (
                    <TableRow key={t.id}>
                      <TableCell className="text-muted-foreground text-xs">{t.sort_order}</TableCell>
                      <TableCell>
                        <p className="font-medium">{t.name}</p>
                        {t.description && <p className="text-xs text-muted-foreground">{t.description}</p>}
                        {t.default_vendor && <p className="text-xs text-muted-foreground">Vendor: {t.default_vendor}</p>}
                      </TableCell>
                      <TableCell className="text-sm">{t.category_name ?? <span className="text-muted-foreground">—</span>}</TableCell>
                      <TableCell className="text-xs">
                        {t.expense_account_code && <span className="font-mono">{t.expense_account_code} </span>}
                        {t.expense_account_name ?? <span className="text-muted-foreground">—</span>}
                      </TableCell>
                      <TableCell className="text-xs">
                        {t.tax_name ? `${t.tax_name} (${t.tax_rate}%)` : <span className="text-muted-foreground">—</span>}
                      </TableCell>
                      <TableCell><Badge variant="outline" className="text-xs">{PM_LABELS[t.payment_method] ?? t.payment_method}</Badge></TableCell>
                      <TableCell className="text-right text-sm font-medium">
                        {t.amount_preset ? idr(parseFloat(t.amount_preset)) : <span className="text-muted-foreground">—</span>}
                      </TableCell>
                      <TableCell>
                        <Badge className={t.is_active ? "bg-emerald-700 text-white" : "bg-slate-700 text-slate-300"}>
                          {t.is_active ? "Aktif" : "Nonaktif"}
                        </Badge>
                      </TableCell>
                      <TableCell>
                        <div className="flex gap-1">
                          <Button variant="ghost" size="icon" className="h-7 w-7" aria-label="Edit" onClick={() => openEdit(t)}><Pencil size={12} /></Button>
                          <Button variant="ghost" size="icon" className="h-7 w-7 text-destructive hover:text-destructive" aria-label="Hapus" onClick={() => setDeleteId(t.id)}><Trash2 size={12} /></Button>
                        </div>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            )}
          </CardContent>
        </Card>

        {/* Form Dialog */}
        <Dialog open={open} onOpenChange={setOpen}>
          <DialogContent className="max-w-lg">
            <DialogHeader>
              <DialogTitle>{editing ? "Edit Template" : "Tambah Template"}</DialogTitle>
            </DialogHeader>
            <form onSubmit={handleSubmit} className="space-y-3">
              <div>
                <Label>Nama Template *</Label>
                <Input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} required placeholder="Contoh: Makan Tim" />
              </div>
              <div>
                <Label>Deskripsi</Label>
                <Input value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} placeholder="Keterangan singkat" />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <Label>Kategori</Label>
                  <Select value={form.categoryId} onValueChange={(v) => setForm({ ...form, categoryId: v })}>
                    <SelectTrigger><SelectValue placeholder="Pilih kategori" /></SelectTrigger>
                    <SelectContent>
                      {(categories as any[]).map((c: any) => (
                        <SelectItem key={c.id} value={String(c.id)}>{c.name}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div>
                  <Label>Metode Pembayaran</Label>
                  <Select value={form.paymentMethod} onValueChange={(v) => setForm({ ...form, paymentMethod: v })}>
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="cash">Kas</SelectItem>
                      <SelectItem value="bank">Transfer Bank</SelectItem>
                      <SelectItem value="other">Lainnya</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <Label>Akun Expense</Label>
                  <Select value={form.expenseAccountId} onValueChange={(v) => setForm({ ...form, expenseAccountId: v })}>
                    <SelectTrigger><SelectValue placeholder="Pilih akun" /></SelectTrigger>
                    <SelectContent>
                      {expenseAccounts.map((a: any) => (
                        <SelectItem key={a.id} value={String(a.id)}>{a.code} — {a.name}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div>
                  <Label>Tarif Pajak</Label>
                  <Select value={form.taxRateId || "none"} onValueChange={(v) => setForm({ ...form, taxRateId: v === "none" ? "" : v })}>
                    <SelectTrigger><SelectValue placeholder="Tanpa pajak" /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="none">Tanpa pajak</SelectItem>
                      {(taxes as any[]).map((t: any) => (
                        <SelectItem key={t.id} value={String(t.id)}>{t.name} ({t.rate}%)</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <Label>Vendor Default</Label>
                  <Input value={form.defaultVendor} onChange={(e) => setForm({ ...form, defaultVendor: e.target.value })} placeholder="Nama vendor" />
                </div>
                <div>
                  <Label>Preset Nominal (IDR)</Label>
                  <Input value={form.amountPreset} onChange={(e) => setForm({ ...form, amountPreset: e.target.value })} placeholder="0" type="number" min="0" />
                </div>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <Label>Urutan</Label>
                  <Input value={form.sortOrder} onChange={(e) => setForm({ ...form, sortOrder: e.target.value })} type="number" min="0" />
                </div>
                <div className="flex items-center gap-2 pt-6">
                  <Switch checked={form.isActive} onCheckedChange={(v) => setForm({ ...form, isActive: v })} />
                  <Label>Aktif</Label>
                </div>
              </div>
              <DialogFooter>
                <Button type="button" variant="outline" onClick={() => setOpen(false)}>Batal</Button>
                <Button type="submit" disabled={saveMut.isPending}>
                  {saveMut.isPending && <Loader2 size={14} className="mr-1 animate-spin" />}
                  {editing ? "Simpan" : "Tambah"}
                </Button>
              </DialogFooter>
            </form>
          </DialogContent>
        </Dialog>

        {/* Delete Dialog */}
        <Dialog open={!!deleteId} onOpenChange={(v) => !v && setDeleteId(null)}>
          <DialogContent>
            <DialogHeader><DialogTitle>Hapus Template?</DialogTitle></DialogHeader>
            <p className="text-sm text-muted-foreground">Tindakan ini tidak dapat dibatalkan.</p>
            <DialogFooter>
              <Button variant="outline" onClick={() => setDeleteId(null)}>Batal</Button>
              <Button variant="destructive" onClick={() => deleteId && deleteMut.mutate(deleteId)} disabled={deleteMut.isPending}>
                {deleteMut.isPending && <Loader2 size={14} className="mr-1 animate-spin" />}Hapus
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </div>
    </AppShell>
  );
}
