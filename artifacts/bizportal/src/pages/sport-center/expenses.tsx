import { useState } from "react";
import { DatePicker } from "@/components/ui/date-picker";
import { AppShell } from "@/components/layout/AppShell";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter,
} from "@/components/ui/dialog";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel,
  AlertDialogContent, AlertDialogDescription, AlertDialogFooter,
  AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useCompany } from "@/contexts/CompanyContext";
import { useToast } from "@/hooks/use-toast";
import {
  Plus, Search, Receipt, CheckCircle2, XCircle,
  Pencil, Trash2, RefreshCw, BarChart3, ChevronDown, ChevronLeft,
} from "lucide-react";
import { Link } from "wouter";

const idr = (n: number | string) =>
  new Intl.NumberFormat("id-ID", { style: "currency", currency: "IDR", maximumFractionDigits: 0 })
    .format(Number(n));

const fmtDate = (s: string | null | undefined) =>
  s ? new Date(s).toLocaleDateString("id-ID", { day: "2-digit", month: "short", year: "numeric" }) : "—";

const CATEGORIES = [
  "listrik", "air", "gaji", "perlengkapan", "perawatan", "kebersihan",
  "keamanan", "internet", "perlengkapan-olahraga", "lain-lain",
];

const PAYMENT_METHOD_LABEL: Record<string, string> = {
  cash: "Tunai", transfer: "Transfer Bank", hutang: "Hutang",
};

const STATUS_BADGE: Record<string, { label: string; variant: "default" | "secondary" | "destructive" | "outline" }> = {
  draft:  { label: "Draft",   variant: "secondary" },
  posted: { label: "Posted",  variant: "default" },
  void:   { label: "Void",    variant: "destructive" },
};

type Facility = { id: number; name: string };
type Expense = {
  id: number;
  expense_number: string;
  facility_id: number | null;
  facility_name: string | null;
  date: string;
  category: string;
  description: string | null;
  amount: number;
  payment_method: string;
  status: string;
  entry_id: number | null;
  notes: string | null;
  created_at: string;
};
type SummaryRow = {
  facility_id: number | null;
  facility_name: string | null;
  category: string;
  month: string;
  total_amount: number;
  expense_count: number;
};

const EMPTY_FORM = {
  facility_id: "",
  date: new Date().toISOString().slice(0, 10),
  category: "lain-lain",
  description: "",
  amount: "",
  payment_method: "cash",
  notes: "",
  status: "draft",
};

export default function SportCenterExpenses() {
  const qc = useQueryClient();
  const { activeCompanyId } = useCompany();
  const { toast } = useToast();
  const cId = typeof activeCompanyId === "number" && activeCompanyId > 0 ? activeCompanyId : null;

  const [tab, setTab] = useState<"list" | "summary">("list");
  const [statusFilter, setStatusFilter] = useState("all");
  const [categoryFilter, setCategoryFilter] = useState("all");
  const [facilityFilter, setFacilityFilter] = useState("all");
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");
  const [search, setSearch] = useState("");

  const [showForm, setShowForm] = useState(false);
  const [editing, setEditing] = useState<Expense | null>(null);
  const [form, setForm] = useState(EMPTY_FORM);
  const [deleteId, setDeleteId] = useState<number | null>(null);
  const [voidId, setVoidId] = useState<number | null>(null);

  // ── Facilities ──────────────────────────────────────────────────────────────
  const { data: facilities = [] } = useQuery<Facility[]>({
    enabled: cId != null,
    queryKey: ["sc-facilities", cId],
    queryFn: async () => {
      const r = await fetch(`/api/sport-center/facilities?companyId=${cId}`, { credentials: "include" });
      return r.json();
    },
  });

  // ── Expenses list ──────────────────────────────────────────────────────────
  const { data: expenses = [], isLoading, refetch } = useQuery<Expense[]>({
    enabled: cId != null,
    queryKey: ["sc-expenses", cId, statusFilter, categoryFilter, facilityFilter, dateFrom, dateTo],
    queryFn: async () => {
      const qs = new URLSearchParams({ companyId: String(cId) });
      if (statusFilter !== "all") qs.set("status", statusFilter);
      if (categoryFilter !== "all") qs.set("category", categoryFilter);
      if (facilityFilter !== "all") qs.set("facilityId", facilityFilter);
      if (dateFrom) qs.set("from", dateFrom);
      if (dateTo) qs.set("to", dateTo);
      const r = await fetch(`/api/sport-center/expenses?${qs}`, { credentials: "include" });
      return r.json();
    },
  });

  // ── Summary ─────────────────────────────────────────────────────────────────
  const { data: summary = [], isLoading: summaryLoading } = useQuery<SummaryRow[]>({
    enabled: cId != null,
    queryKey: ["sc-expenses-summary", cId, facilityFilter, dateFrom, dateTo],
    queryFn: async () => {
      const qs = new URLSearchParams({ companyId: String(cId) });
      if (facilityFilter !== "all") qs.set("facilityId", facilityFilter);
      if (dateFrom) qs.set("from", dateFrom);
      if (dateTo) qs.set("to", dateTo);
      const r = await fetch(`/api/sport-center/expenses/summary?${qs}`, { credentials: "include" });
      return r.json();
    },
    enabled: tab === "summary",
  });

  const filtered = expenses.filter((e) => {
    if (!search) return true;
    const q = search.toLowerCase();
    return (
      e.expense_number.toLowerCase().includes(q) ||
      (e.description ?? "").toLowerCase().includes(q) ||
      (e.facility_name ?? "").toLowerCase().includes(q) ||
      e.category.toLowerCase().includes(q)
    );
  });

  // ── Mutations ───────────────────────────────────────────────────────────────
  const saveMutation = useMutation({
    mutationFn: async (data: typeof form) => {
      const url = editing
        ? `/api/sport-center/expenses/${editing.id}`
        : "/api/sport-center/expenses";
      const method = editing ? "PUT" : "POST";
      const r = await fetch(url, {
        method,
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({
          ...data,
          company_id: cId,
          facility_id: data.facility_id ? Number(data.facility_id) : undefined,
          amount: Number(data.amount),
        }),
      });
      if (!r.ok) {
        const j = await r.json();
        throw new Error(j.error ?? "Gagal menyimpan expense");
      }
      return r.json();
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["sc-expenses"] });
      qc.invalidateQueries({ queryKey: ["sc-expenses-summary"] });
      toast({ title: editing ? "Expense diperbarui" : "Expense dibuat" });
      setShowForm(false);
      setEditing(null);
      setForm(EMPTY_FORM);
    },
    onError: (e: Error) => toast({ title: "Gagal", description: e.message, variant: "destructive" }),
  });

  const postMutation = useMutation({
    mutationFn: async (id: number) => {
      const r = await fetch(`/api/sport-center/expenses/${id}/post`, {
        method: "PATCH",
        credentials: "include",
      });
      if (!r.ok) {
        const j = await r.json();
        throw new Error(j.error ?? "Gagal posting");
      }
      return r.json();
    },
    onSuccess: (data) => {
      qc.invalidateQueries({ queryKey: ["sc-expenses"] });
      toast({ title: `Expense ${data.expense_number} berhasil diposting ke jurnal akuntansi` });
    },
    onError: (e: Error) => toast({ title: "Gagal posting", description: e.message, variant: "destructive" }),
  });

  const voidMutation = useMutation({
    mutationFn: async (id: number) => {
      const r = await fetch(`/api/sport-center/expenses/${id}/void`, {
        method: "PATCH",
        credentials: "include",
      });
      if (!r.ok) {
        const j = await r.json();
        throw new Error(j.error ?? "Gagal void");
      }
      return r.json();
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["sc-expenses"] });
      toast({ title: "Expense divoid" });
      setVoidId(null);
    },
    onError: (e: Error) => toast({ title: "Gagal void", description: e.message, variant: "destructive" }),
  });

  const deleteMutation = useMutation({
    mutationFn: async (id: number) => {
      const r = await fetch(`/api/sport-center/expenses/${id}`, {
        method: "DELETE",
        credentials: "include",
      });
      if (!r.ok) {
        const j = await r.json();
        throw new Error(j.error ?? "Gagal hapus");
      }
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["sc-expenses"] });
      toast({ title: "Expense dihapus" });
      setDeleteId(null);
    },
    onError: (e: Error) => toast({ title: "Gagal hapus", description: e.message, variant: "destructive" }),
  });

  function openCreate() {
    setEditing(null);
    setForm(EMPTY_FORM);
    setShowForm(true);
  }

  function openEdit(e: Expense) {
    setEditing(e);
    setForm({
      facility_id: e.facility_id ? String(e.facility_id) : "",
      date: e.date,
      category: e.category,
      description: e.description ?? "",
      amount: String(e.amount),
      payment_method: e.payment_method,
      notes: e.notes ?? "",
      status: "draft",
    });
    setShowForm(true);
  }

  const totalAmount = filtered
    .filter((e) => e.status !== "void")
    .reduce((s, e) => s + Number(e.amount), 0);

  // ── Summary grouping ────────────────────────────────────────────────────────
  const summaryByCategory = summary.reduce<Record<string, number>>((acc, r) => {
    acc[r.category] = (acc[r.category] ?? 0) + Number(r.total_amount);
    return acc;
  }, {});

  const totalSummary = Object.values(summaryByCategory).reduce((s, v) => s + v, 0);

  return (
    <AppShell>
      <div className="p-6 space-y-4">
        <Link href="/tenant/workspace/sport-center">
          <button className="mb-1 inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground transition-colors">
            <ChevronLeft className="h-4 w-4" />
            Kembali
          </button>
        </Link>
        {/* Header */}
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-bold flex items-center gap-2">
              <Receipt className="h-6 w-6 text-primary" />
              Beban Operasional Sport Center
            </h1>
            <p className="text-sm text-muted-foreground mt-0.5">
              Manajemen pengeluaran operasional fasilitas olahraga
            </p>
          </div>
          <div className="flex gap-2">
            <Button variant="outline" size="sm" onClick={() => refetch()}>
              <RefreshCw className="h-4 w-4" />
            </Button>
            <Button size="sm" onClick={openCreate}>
              <Plus className="h-4 w-4 mr-1" />
              Tambah Expense
            </Button>
          </div>
        </div>

        {/* Filter bar */}
        <Card>
          <CardContent className="p-3">
            <div className="flex flex-wrap gap-2 items-center">
              <div className="relative flex-1 min-w-[180px]">
                <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
                <Input
                  className="pl-8 h-9"
                  placeholder="Cari nomor, deskripsi..."
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                />
              </div>

              <Select value={facilityFilter} onValueChange={setFacilityFilter}>
                <SelectTrigger className="h-9 w-[160px]">
                  <SelectValue placeholder="Semua Fasilitas" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">Semua Fasilitas</SelectItem>
                  {facilities.map((f) => (
                    <SelectItem key={f.id} value={String(f.id)}>{f.name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>

              <Select value={categoryFilter} onValueChange={setCategoryFilter}>
                <SelectTrigger className="h-9 w-[150px]">
                  <SelectValue placeholder="Semua Kategori" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">Semua Kategori</SelectItem>
                  {CATEGORIES.map((c) => (
                    <SelectItem key={c} value={c}>{c}</SelectItem>
                  ))}
                </SelectContent>
              </Select>

              <Select value={statusFilter} onValueChange={setStatusFilter}>
                <SelectTrigger className="h-9 w-[130px]">
                  <SelectValue placeholder="Semua Status" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">Semua Status</SelectItem>
                  <SelectItem value="draft">Draft</SelectItem>
                  <SelectItem value="posted">Posted</SelectItem>
                  <SelectItem value="void">Void</SelectItem>
                </SelectContent>
              </Select>

              <DatePicker value={dateFrom} onChange={(v) => setDateFrom(v)} className="h-9 w-[140px]" placeholder="Dari" />
              <DatePicker value={dateTo} onChange={(v) => setDateTo(v)} className="h-9 w-[140px]" placeholder="Sampai" />
            </div>
          </CardContent>
        </Card>

        {/* Summary cards */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          <Card>
            <CardContent className="p-4">
              <p className="text-xs text-muted-foreground">Total Expense</p>
              <p className="text-xl font-bold mt-1">{filtered.length}</p>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="p-4">
              <p className="text-xs text-muted-foreground">Total Nilai</p>
              <p className="text-xl font-bold mt-1 text-red-600">{idr(totalAmount)}</p>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="p-4">
              <p className="text-xs text-muted-foreground">Draft</p>
              <p className="text-xl font-bold mt-1 text-yellow-600">
                {filtered.filter((e) => e.status === "draft").length}
              </p>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="p-4">
              <p className="text-xs text-muted-foreground">Posted</p>
              <p className="text-xl font-bold mt-1 text-green-600">
                {filtered.filter((e) => e.status === "posted").length}
              </p>
            </CardContent>
          </Card>
        </div>

        {/* Tabs */}
        <Tabs value={tab} onValueChange={(v) => setTab(v as "list" | "summary")}>
          <TabsList>
            <TabsTrigger value="list">Daftar Expense</TabsTrigger>
            <TabsTrigger value="summary">
              <BarChart3 className="h-4 w-4 mr-1" />
              Ringkasan
            </TabsTrigger>
          </TabsList>

          {/* LIST TAB */}
          <TabsContent value="list">
            <Card>
              <CardContent className="p-0">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead className="w-[150px]">No. Expense</TableHead>
                      <TableHead>Tanggal</TableHead>
                      <TableHead>Fasilitas</TableHead>
                      <TableHead>Kategori</TableHead>
                      <TableHead>Deskripsi</TableHead>
                      <TableHead className="text-right">Jumlah</TableHead>
                      <TableHead>Pembayaran</TableHead>
                      <TableHead>Status</TableHead>
                      <TableHead className="text-right w-[140px]">Aksi</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {isLoading ? (
                      <TableRow>
                        <TableCell colSpan={9} className="text-center py-10 text-muted-foreground">
                          <RefreshCw className="h-5 w-5 animate-spin inline mr-2" />
                          Memuat...
                        </TableCell>
                      </TableRow>
                    ) : filtered.length === 0 ? (
                      <TableRow>
                        <TableCell colSpan={9} className="text-center py-10 text-muted-foreground">
                          Belum ada data expense
                        </TableCell>
                      </TableRow>
                    ) : (
                      filtered.map((e) => {
                        const sb = STATUS_BADGE[e.status] ?? STATUS_BADGE.draft;
                        return (
                          <TableRow key={e.id}>
                            <TableCell className="font-mono text-xs">{e.expense_number}</TableCell>
                            <TableCell className="whitespace-nowrap">{fmtDate(e.date)}</TableCell>
                            <TableCell>{e.facility_name ?? "—"}</TableCell>
                            <TableCell>
                              <span className="capitalize">{e.category}</span>
                            </TableCell>
                            <TableCell className="max-w-[200px] truncate text-sm text-muted-foreground">
                              {e.description ?? "—"}
                            </TableCell>
                            <TableCell className="text-right font-semibold text-red-600">
                              {idr(e.amount)}
                            </TableCell>
                            <TableCell className="text-sm">
                              {PAYMENT_METHOD_LABEL[e.payment_method] ?? e.payment_method}
                            </TableCell>
                            <TableCell>
                              <Badge variant={sb.variant}>{sb.label}</Badge>
                            </TableCell>
                            <TableCell>
                              <div className="flex gap-1 justify-end">
                                {e.status === "draft" && (
                                  <>
                                    <Button
                                      size="icon"
                                      variant="ghost"
                                      className="h-7 w-7"
                                      title="Edit"
                                      onClick={() => openEdit(e)}
                                    >
                                      <Pencil className="h-3.5 w-3.5" />
                                    </Button>
                                    <Button
                                      size="icon"
                                      variant="ghost"
                                      className="h-7 w-7 text-green-600 hover:text-green-700"
                                      title="Post ke Jurnal"
                                      onClick={() => postMutation.mutate(e.id)}
                                      disabled={postMutation.isPending}
                                    >
                                      <CheckCircle2 className="h-3.5 w-3.5" />
                                    </Button>
                                    <Button
                                      size="icon"
                                      variant="ghost"
                                      className="h-7 w-7 text-destructive hover:text-destructive"
                                      title="Hapus"
                                      onClick={() => setDeleteId(e.id)}
                                    >
                                      <Trash2 className="h-3.5 w-3.5" />
                                    </Button>
                                  </>
                                )}
                                {e.status === "posted" && (
                                  <Button
                                    size="icon"
                                    variant="ghost"
                                    className="h-7 w-7 text-orange-500 hover:text-orange-600"
                                    title="Void"
                                    onClick={() => setVoidId(e.id)}
                                  >
                                    <XCircle className="h-3.5 w-3.5" />
                                  </Button>
                                )}
                              </div>
                            </TableCell>
                          </TableRow>
                        );
                      })
                    )}
                  </TableBody>
                </Table>
              </CardContent>
            </Card>
          </TabsContent>

          {/* SUMMARY TAB */}
          <TabsContent value="summary">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              {/* Per category */}
              <Card>
                <CardContent className="p-4">
                  <h3 className="font-semibold mb-3 flex items-center gap-2">
                    <BarChart3 className="h-4 w-4" />
                    Total per Kategori
                  </h3>
                  {summaryLoading ? (
                    <div className="text-center py-4 text-muted-foreground">Memuat...</div>
                  ) : Object.keys(summaryByCategory).length === 0 ? (
                    <div className="text-center py-4 text-muted-foreground">Belum ada data</div>
                  ) : (
                    <div className="space-y-2">
                      {Object.entries(summaryByCategory)
                        .sort(([, a], [, b]) => b - a)
                        .map(([cat, total]) => (
                          <div key={cat} className="flex items-center justify-between">
                            <span className="capitalize text-sm">{cat}</span>
                            <div className="flex items-center gap-3">
                              <div className="w-32 h-2 bg-muted rounded-full overflow-hidden">
                                <div
                                  className="h-full bg-red-500 rounded-full"
                                  style={{ width: `${Math.round((total / totalSummary) * 100)}%` }}
                                />
                              </div>
                              <span className="text-sm font-semibold tabular-nums">{idr(total)}</span>
                            </div>
                          </div>
                        ))}
                      <div className="border-t pt-2 flex items-center justify-between">
                        <span className="text-sm font-semibold">Total</span>
                        <span className="text-sm font-bold text-red-600">{idr(totalSummary)}</span>
                      </div>
                    </div>
                  )}
                </CardContent>
              </Card>

              {/* Per fasilitas */}
              <Card>
                <CardContent className="p-4">
                  <h3 className="font-semibold mb-3 flex items-center gap-2">
                    <ChevronDown className="h-4 w-4" />
                    Total per Fasilitas
                  </h3>
                  {summaryLoading ? (
                    <div className="text-center py-4 text-muted-foreground">Memuat...</div>
                  ) : (
                    <div className="space-y-2">
                      {Object.entries(
                        summary.reduce<Record<string, number>>((acc, r) => {
                          const key = r.facility_name ?? "Tanpa Fasilitas";
                          acc[key] = (acc[key] ?? 0) + Number(r.total_amount);
                          return acc;
                        }, {}),
                      )
                        .sort(([, a], [, b]) => b - a)
                        .map(([name, total]) => (
                          <div key={name} className="flex items-center justify-between">
                            <span className="text-sm">{name}</span>
                            <span className="text-sm font-semibold tabular-nums">{idr(total)}</span>
                          </div>
                        ))}
                    </div>
                  )}
                </CardContent>
              </Card>

              {/* Detail per bulan */}
              <Card className="md:col-span-2">
                <CardContent className="p-0">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Bulan</TableHead>
                        <TableHead>Fasilitas</TableHead>
                        <TableHead>Kategori</TableHead>
                        <TableHead className="text-right">Jumlah Transaksi</TableHead>
                        <TableHead className="text-right">Total</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {summaryLoading ? (
                        <TableRow>
                          <TableCell colSpan={5} className="text-center py-6 text-muted-foreground">Memuat...</TableCell>
                        </TableRow>
                      ) : summary.length === 0 ? (
                        <TableRow>
                          <TableCell colSpan={5} className="text-center py-6 text-muted-foreground">Belum ada data</TableCell>
                        </TableRow>
                      ) : (
                        summary.map((r, i) => (
                          <TableRow key={i}>
                            <TableCell>{r.month}</TableCell>
                            <TableCell>{r.facility_name ?? "—"}</TableCell>
                            <TableCell className="capitalize">{r.category}</TableCell>
                            <TableCell className="text-right">{Number(r.expense_count)}</TableCell>
                            <TableCell className="text-right font-semibold text-red-600">{idr(r.total_amount)}</TableCell>
                          </TableRow>
                        ))
                      )}
                    </TableBody>
                  </Table>
                </CardContent>
              </Card>
            </div>
          </TabsContent>
        </Tabs>
      </div>

      {/* Form Dialog */}
      <Dialog open={showForm} onOpenChange={(o) => { if (!o) { setShowForm(false); setEditing(null); } }}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>{editing ? "Edit Expense" : "Tambah Expense Baru"}</DialogTitle>
          </DialogHeader>
          <div className="space-y-3 py-2">
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1">
                <Label>Tanggal *</Label>
                <DatePicker value={form.date} onChange={(v) => setForm({ ...form, date: v })} />
              </div>
              <div className="space-y-1">
                <Label>Fasilitas *</Label>
                <Select value={form.facility_id} onValueChange={(v) => setForm({ ...form, facility_id: v })}>
                  <SelectTrigger>
                    <SelectValue placeholder="Pilih fasilitas" />
                  </SelectTrigger>
                  <SelectContent>
                    {facilities.map((f) => (
                      <SelectItem key={f.id} value={String(f.id)}>{f.name}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1">
                <Label>Kategori *</Label>
                <Select value={form.category} onValueChange={(v) => setForm({ ...form, category: v })}>
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {CATEGORIES.map((c) => (
                      <SelectItem key={c} value={c}>{c}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1">
                <Label>Cara Bayar *</Label>
                <Select value={form.payment_method} onValueChange={(v) => setForm({ ...form, payment_method: v })}>
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="cash">Tunai</SelectItem>
                    <SelectItem value="transfer">Transfer Bank</SelectItem>
                    <SelectItem value="hutang">Hutang</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>

            <div className="space-y-1">
              <Label>Jumlah (IDR) *</Label>
              <Input
                type="number"
                placeholder="0"
                value={form.amount}
                onChange={(e) => setForm({ ...form, amount: e.target.value })}
              />
            </div>

            <div className="space-y-1">
              <Label>Deskripsi</Label>
              <Input
                placeholder="Deskripsi singkat pengeluaran"
                value={form.description}
                onChange={(e) => setForm({ ...form, description: e.target.value })}
              />
            </div>

            <div className="space-y-1">
              <Label>Catatan</Label>
              <Textarea
                rows={2}
                placeholder="Catatan tambahan..."
                value={form.notes}
                onChange={(e) => setForm({ ...form, notes: e.target.value })}
              />
            </div>

            {!editing && (
              <div className="space-y-1">
                <Label>Simpan sebagai</Label>
                <Select value={form.status} onValueChange={(v) => setForm({ ...form, status: v })}>
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="draft">Draft (belum posting jurnal)</SelectItem>
                    <SelectItem value="posted">Langsung Posted (buat jurnal otomatis)</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            )}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => { setShowForm(false); setEditing(null); }}>
              Batal
            </Button>
            <Button
              onClick={() => saveMutation.mutate(form)}
              disabled={
                saveMutation.isPending ||
                !form.date ||
                !form.facility_id ||
                !form.amount ||
                Number(form.amount) <= 0
              }
            >
              {saveMutation.isPending ? "Menyimpan..." : editing ? "Simpan Perubahan" : "Buat Expense"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Delete confirmation */}
      <AlertDialog open={deleteId !== null} onOpenChange={(o) => { if (!o) setDeleteId(null); }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Hapus Expense?</AlertDialogTitle>
            <AlertDialogDescription>
              Expense draft ini akan dihapus permanen. Tindakan ini tidak bisa dibatalkan.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Batal</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive hover:bg-destructive/90"
              onClick={() => deleteId !== null && deleteMutation.mutate(deleteId)}
            >
              Hapus
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Void confirmation */}
      <AlertDialog open={voidId !== null} onOpenChange={(o) => { if (!o) setVoidId(null); }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Void Expense?</AlertDialogTitle>
            <AlertDialogDescription>
              Expense akan ditandai void. Jurnal akuntansi yang sudah dibuat tidak akan otomatis dibatalkan.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Batal</AlertDialogCancel>
            <AlertDialogAction
              className="bg-orange-500 hover:bg-orange-600"
              onClick={() => voidId !== null && voidMutation.mutate(voidId)}
            >
              Void
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </AppShell>
  );
}
