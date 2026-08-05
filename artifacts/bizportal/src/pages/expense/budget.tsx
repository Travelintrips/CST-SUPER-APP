import { useState } from "react";
import { Link } from "wouter";
import { AppShell } from "@/components/layout/AppShell";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter,
} from "@/components/ui/dialog";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useCompany } from "@/contexts/CompanyContext";
import { useToast } from "@/hooks/use-toast";

async function apiFetch(url: string, opts?: RequestInit) {
  const r = await fetch(url, { credentials: "include", ...opts });
  const d = await r.json();
  if (!r.ok) throw new Error(d.message ?? "Terjadi kesalahan.");
  return d;
}
import { useListExpenseCategories } from "@workspace/api-client-react";
import { ArrowLeft, Plus, Pencil, Trash2, Loader2, DollarSign, PieChart, RefreshCw } from "lucide-react";

const idr = (n: number) =>
  new Intl.NumberFormat("id-ID", { style: "currency", currency: "IDR", maximumFractionDigits: 0 }).format(n);

const MONTHS = [
  "Januari", "Februari", "Maret", "April", "Mei", "Juni",
  "Juli", "Agustus", "September", "Oktober", "November", "Desember",
];

interface Budget {
  id: number;
  year: number;
  month?: number;
  category_id?: number;
  category_name?: string;
  department?: string;
  project?: string;
  budget_amount: string;
  notes?: string;
}

interface CurrencyRate {
  id: number;
  currency_code: string;
  currency_name: string;
  rate_to_idr: string;
  symbol?: string;
  is_active: boolean;
  updated_at: string;
}

export default function ExpenseBudgetPage() {
  const { activeCompanyId } = useCompany();
  const { toast } = useToast();
  const qc = useQueryClient();

  const thisYear = new Date().getFullYear();
  const thisMonth = new Date().getMonth() + 1;
  const [year, setYear] = useState(thisYear);
  const [tab, setTab] = useState("budget");

  const companyParam = activeCompanyId ? `&companyId=${activeCompanyId}` : "";

  const { data: budgets = [], isLoading: budgetLoading } = useQuery<Budget[]>({
    queryKey: ["expense-budgets", activeCompanyId, year],
    queryFn: () => apiFetch(`/api/expense-config/budgets?year=${year}${companyParam}`),
    staleTime: 30_000,
  });

  const { data: currencies = [], isLoading: currencyLoading, refetch: refetchCurrencies } = useQuery<CurrencyRate[]>({
    queryKey: ["currency-rates"],
    queryFn: () => apiFetch("/api/expense-config/currencies"),
    staleTime: 5 * 60_000,
  });

  const { data: categoriesRaw } = useListExpenseCategories({ companyId: activeCompanyId ?? undefined } as any);
  const categories = (categoriesRaw as any)?.data ?? categoriesRaw ?? [];

  // Budget form
  const [budgetOpen, setBudgetOpen] = useState(false);
  const [editingBudget, setEditingBudget] = useState<Budget | null>(null);
  const [budgetForm, setBudgetForm] = useState({
    year: String(thisYear), month: "", categoryId: "", department: "", project: "", budgetAmount: "", notes: "",
  });

  // Currency rate edit
  const [editingRate, setEditingRate] = useState<CurrencyRate | null>(null);
  const [rateValue, setRateValue] = useState("");

  function openNewBudget() {
    setEditingBudget(null);
    setBudgetForm({ year: String(year), month: String(thisMonth), categoryId: "", department: "", project: "", budgetAmount: "", notes: "" });
    setBudgetOpen(true);
  }
  function openEditBudget(b: Budget) {
    setEditingBudget(b);
    setBudgetForm({
      year: String(b.year), month: b.month ? String(b.month) : "",
      categoryId: b.category_id ? String(b.category_id) : "",
      department: b.department ?? "", project: b.project ?? "",
      budgetAmount: b.budget_amount ? String(b.budget_amount) : "",
      notes: b.notes ?? "",
    });
    setBudgetOpen(true);
  }

  const saveBudgetMut = useMutation({
    mutationFn: (body: any) =>
      editingBudget
        ? apiFetch(`/api/expense-config/budgets/${editingBudget.id}`, { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) })
        : apiFetch("/api/expense-config/budgets", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["expense-budgets"] });
      setBudgetOpen(false);
      toast({ title: editingBudget ? "Anggaran diperbarui." : "Anggaran ditambahkan." });
    },
    onError: (e: any) => toast({ title: "Error", description: e?.message ?? "Gagal.", variant: "destructive" }),
  });

  const deleteBudgetMut = useMutation({
    mutationFn: (id: number) => apiFetch(`/api/expense-config/budgets/${id}`, { method: "DELETE" }),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["expense-budgets"] }); toast({ title: "Anggaran dihapus." }); },
  });

  const updateRateMut = useMutation({
    mutationFn: ({ code, ratToIdr }: { code: string; ratToIdr: number }) =>
      apiFetch(`/api/expense-config/currencies/${code}`, { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ ratToIdr }) }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["currency-rates"] });
      setEditingRate(null);
      toast({ title: "Kurs diperbarui." });
    },
    onError: (e: any) => toast({ title: "Error", description: e?.message, variant: "destructive" }),
  });

  function handleBudgetSubmit(e: React.FormEvent) {
    e.preventDefault();
    const amt = parseFloat(budgetForm.budgetAmount.replace(/[^\d.]/g, ""));
    if (!budgetForm.year || isNaN(amt) || amt <= 0) return;
    saveBudgetMut.mutate({
      year: parseInt(budgetForm.year), month: budgetForm.month ? parseInt(budgetForm.month) : undefined,
      categoryId: budgetForm.categoryId || undefined, department: budgetForm.department || undefined,
      project: budgetForm.project || undefined, budgetAmount: amt, notes: budgetForm.notes || undefined,
    });
  }

  // Group budgets by category
  const totalBudget = budgets.reduce((s, b) => s + parseFloat(b.budget_amount), 0);

  return (
    <AppShell>
      <div className="max-w-5xl mx-auto px-4 py-6 space-y-5">
        <div className="flex items-center justify-between gap-4 flex-wrap">
          <div className="flex items-center gap-3">
            <Link href="/expense"><Button variant="ghost" size="icon"><ArrowLeft size={16} /></Button></Link>
            <div>
              <h1 className="text-2xl font-bold flex items-center gap-2"><PieChart size={22} />Anggaran & Multi-Mata Uang</h1>
              <p className="text-sm text-muted-foreground">Budget per kategori/departemen dan manajemen kurs valuta asing.</p>
            </div>
          </div>
        </div>

        <Tabs value={tab} onValueChange={setTab}>
          <TabsList>
            <TabsTrigger value="budget">Anggaran</TabsTrigger>
            <TabsTrigger value="currency">Kurs Mata Uang</TabsTrigger>
          </TabsList>

          {/* ── BUDGET TAB ── */}
          <TabsContent value="budget" className="space-y-4 mt-4">
            <div className="flex items-center justify-between gap-3 flex-wrap">
              <div className="flex items-center gap-2">
                <Label>Tahun</Label>
                <Select value={String(year)} onValueChange={(v) => setYear(parseInt(v))}>
                  <SelectTrigger className="w-24"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {[thisYear - 1, thisYear, thisYear + 1].map((y) => (
                      <SelectItem key={y} value={String(y)}>{y}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <Button size="sm" onClick={openNewBudget}><Plus size={14} className="mr-1" />Tambah Anggaran</Button>
            </div>

            {/* Budget summary */}
            {totalBudget > 0 && (
              <Card>
                <CardContent className="p-4">
                  <div className="flex items-center justify-between mb-2">
                    <span className="text-sm font-medium">Total Anggaran {year}</span>
                    <span className="text-lg font-bold text-emerald-400">{idr(totalBudget)}</span>
                  </div>
                  <p className="text-xs text-muted-foreground">{budgets.length} entry anggaran</p>
                </CardContent>
              </Card>
            )}

            <Card>
              <CardContent className="p-0">
                {budgetLoading ? (
                  <div className="py-16 flex justify-center"><Loader2 size={20} className="animate-spin" /></div>
                ) : budgets.length === 0 ? (
                  <div className="py-16 text-center text-muted-foreground">
                    <DollarSign size={32} className="mx-auto mb-3 opacity-30" />
                    <p>Belum ada anggaran untuk tahun {year}.</p>
                    <p className="text-xs mt-1">Klik "Tambah Anggaran" untuk mulai menentukan batas pengeluaran.</p>
                  </div>
                ) : (
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Kategori</TableHead>
                        <TableHead>Bulan</TableHead>
                        <TableHead>Departemen</TableHead>
                        <TableHead>Proyek</TableHead>
                        <TableHead className="text-right">Anggaran</TableHead>
                        <TableHead>Keterangan</TableHead>
                        <TableHead className="w-16"></TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {budgets.map((b) => {
                        const amt = parseFloat(b.budget_amount);
                        return (
                          <TableRow key={b.id}>
                            <TableCell>
                              {b.category_name
                                ? <Badge variant="outline" className="text-xs">{b.category_name}</Badge>
                                : <span className="text-muted-foreground text-xs">Semua Kategori</span>}
                            </TableCell>
                            <TableCell className="text-sm">
                              {b.month ? MONTHS[b.month - 1] : <span className="text-muted-foreground">Tahunan</span>}
                            </TableCell>
                            <TableCell className="text-sm">{b.department ?? <span className="text-muted-foreground">—</span>}</TableCell>
                            <TableCell className="text-sm">{b.project ?? <span className="text-muted-foreground">—</span>}</TableCell>
                            <TableCell className="text-right font-semibold">{idr(amt)}</TableCell>
                            <TableCell className="text-xs text-muted-foreground">{b.notes ?? "—"}</TableCell>
                            <TableCell>
                              <div className="flex gap-1">
                                <Button variant="ghost" size="icon" className="h-7 w-7" aria-label="Edit" onClick={() => openEditBudget(b)}><Pencil size={12} /></Button>
                                <Button variant="ghost" size="icon" className="h-7 w-7 text-destructive hover:text-destructive" aria-label="Hapus" onClick={() => deleteBudgetMut.mutate(b.id)}><Trash2 size={12} /></Button>
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
          </TabsContent>

          {/* ── CURRENCY TAB ── */}
          <TabsContent value="currency" className="space-y-4 mt-4">
            <div className="flex items-center justify-between flex-wrap gap-3">
              <p className="text-sm text-muted-foreground">Kurs manual ke IDR. Dipakai saat mencatat expense dalam mata uang asing.</p>
              <Button variant="outline" size="sm" onClick={() => refetchCurrencies()}><RefreshCw size={14} className="mr-1" />Refresh</Button>
            </div>
            <Card>
              <CardContent className="p-0">
                {currencyLoading ? (
                  <div className="py-16 flex justify-center"><Loader2 size={20} className="animate-spin" /></div>
                ) : (
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Kode</TableHead>
                        <TableHead>Nama</TableHead>
                        <TableHead>Simbol</TableHead>
                        <TableHead className="text-right">Kurs ke IDR</TableHead>
                        <TableHead>Terakhir Update</TableHead>
                        <TableHead className="w-20"></TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {currencies.map((c) => (
                        <TableRow key={c.currency_code}>
                          <TableCell className="font-mono font-bold">{c.currency_code}</TableCell>
                          <TableCell>{c.currency_name}</TableCell>
                          <TableCell className="text-lg">{c.symbol ?? "—"}</TableCell>
                          <TableCell className="text-right font-semibold">
                            {editingRate?.currency_code === c.currency_code ? (
                              <Input
                                className="w-28 ml-auto text-right h-7 text-sm"
                                value={rateValue}
                                onChange={(e) => setRateValue(e.target.value)}
                                type="number" min="0.0001" step="0.01" autoFocus
                              />
                            ) : (
                              idr(parseFloat(c.rate_to_idr))
                            )}
                          </TableCell>
                          <TableCell className="text-xs text-muted-foreground">
                            {new Date(c.updated_at).toLocaleDateString("id-ID")}
                          </TableCell>
                          <TableCell>
                            {editingRate?.currency_code === c.currency_code ? (
                              <div className="flex gap-1">
                                <Button size="sm" className="h-7 px-2 text-xs" disabled={updateRateMut.isPending}
                                  onClick={() => updateRateMut.mutate({ code: c.currency_code, ratToIdr: parseFloat(rateValue) })}>
                                  {updateRateMut.isPending ? <Loader2 size={10} className="animate-spin" /> : "Simpan"}
                                </Button>
                                <Button size="sm" variant="outline" className="h-7 px-2 text-xs" onClick={() => setEditingRate(null)}>Batal</Button>
                              </div>
                            ) : c.currency_code !== "IDR" && (
                              <Button variant="ghost" size="icon" className="h-7 w-7"
                                onClick={() => { setEditingRate(c); setRateValue(c.rate_to_idr); }}>
                                <Pencil size={12} />
                              </Button>
                            )}
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                )}
              </CardContent>
            </Card>
            <p className="text-xs text-muted-foreground">
              * Kurs ini dipakai sebagai default. Saat mencatat expense luar negeri, Anda bisa override kurs di form expense.
            </p>
          </TabsContent>
        </Tabs>

        {/* Budget Form Dialog */}
        <Dialog open={budgetOpen} onOpenChange={setBudgetOpen}>
          <DialogContent className="max-w-lg">
            <DialogHeader>
              <DialogTitle>{editingBudget ? "Edit Anggaran" : "Tambah Anggaran"}</DialogTitle>
            </DialogHeader>
            <form onSubmit={handleBudgetSubmit} className="space-y-3">
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <Label>Tahun *</Label>
                  <Input value={budgetForm.year} onChange={(e) => setBudgetForm({ ...budgetForm, year: e.target.value })} type="number" required />
                </div>
                <div>
                  <Label>Bulan (kosong = tahunan)</Label>
                  <Select value={budgetForm.month || "__annual__"} onValueChange={(v) => setBudgetForm({ ...budgetForm, month: v === "__annual__" ? "" : v })}>
                    <SelectTrigger><SelectValue placeholder="Semua bulan" /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="__annual__">Tahunan</SelectItem>
                      {MONTHS.map((m, i) => <SelectItem key={i + 1} value={String(i + 1)}>{m}</SelectItem>)}
                    </SelectContent>
                  </Select>
                </div>
              </div>
              <div>
                <Label>Kategori (kosong = semua kategori)</Label>
                <Select value={budgetForm.categoryId || "__all__"} onValueChange={(v) => setBudgetForm({ ...budgetForm, categoryId: v === "__all__" ? "" : v })}>
                  <SelectTrigger><SelectValue placeholder="Semua kategori" /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="__all__">Semua Kategori</SelectItem>
                    {(categories as any[]).map((c: any) => (
                      <SelectItem key={c.id} value={String(c.id)}>{c.name}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <Label>Departemen</Label>
                  <Input value={budgetForm.department} onChange={(e) => setBudgetForm({ ...budgetForm, department: e.target.value })} placeholder="Contoh: Logistik" />
                </div>
                <div>
                  <Label>Proyek</Label>
                  <Input value={budgetForm.project} onChange={(e) => setBudgetForm({ ...budgetForm, project: e.target.value })} placeholder="Contoh: Proj X" />
                </div>
              </div>
              <div>
                <Label>Batas Anggaran (IDR) *</Label>
                <Input
                  value={budgetForm.budgetAmount}
                  onChange={(e) => setBudgetForm({ ...budgetForm, budgetAmount: e.target.value })}
                  type="number" min="1" required placeholder="0"
                />
              </div>
              <div>
                <Label>Keterangan</Label>
                <Input value={budgetForm.notes} onChange={(e) => setBudgetForm({ ...budgetForm, notes: e.target.value })} placeholder="Opsional" />
              </div>
              <DialogFooter>
                <Button type="button" variant="outline" onClick={() => setBudgetOpen(false)}>Batal</Button>
                <Button type="submit" disabled={saveBudgetMut.isPending}>
                  {saveBudgetMut.isPending && <Loader2 size={14} className="mr-1 animate-spin" />}
                  {editingBudget ? "Simpan" : "Tambah"}
                </Button>
              </DialogFooter>
            </form>
          </DialogContent>
        </Dialog>
      </div>
    </AppShell>
  );
}
