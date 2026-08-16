import { useState } from "react";
import { Link } from "wouter";
import { AIReviewSourcePanel } from "@/components/ai-review";
import { AppShell } from "@/components/layout/AppShell";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import {
  useListExpenses, useListExpenseCategories, getListExpensesQueryKey,
  useDeleteExpense, useListSalesDocuments, useListFreightShipments,
  getGetExpenseQueryOptions,
  type Expense,
} from "@workspace/api-client-react";
import { useQueryClient, useQuery } from "@tanstack/react-query";
import { usePrefetchOnHover } from "@/hooks/use-prefetch-on-hover";
import { useToast } from "@/hooks/use-toast";
import { useLanguage } from "@/contexts/LanguageContext";
import { useCompany } from "@/contexts/CompanyContext";
import { ShoppingCart, Ship, Plus, Receipt, Search, Trash2, X, CalendarRange, Zap, Wallet, HandCoins, Building2, Landmark, Package, ShieldCheck, LayoutDashboard, Layers, PieChart, Banknote, TrendingDown, TrendingUp, Wrench, ChevronDown, ChevronUp, CheckCircle2, AlertCircle, ArrowRightLeft } from "lucide-react";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";

async function apiFetch(url: string, opts?: RequestInit) {
  const r = await fetch(url, { credentials: "include", ...opts });
  const data = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(data?.message ?? `Request gagal (${r.status})`);
  return data;
}

const idr = (n: number) =>
  new Intl.NumberFormat("id-ID", { style: "currency", currency: "IDR", maximumFractionDigits: 0 }).format(n);

const STATUS_LABELS: Record<string, string> = {
  draft: "Draft",
  submitted: "Diajukan",
  approved: "Disetujui",
  pending_approval: "Menunggu Approval",
  posted: "Diposting",
  paid: "Lunas",
  rejected: "Ditolak",
};

const STATUS_COLORS: Record<string, string> = {
  draft: "bg-slate-800 text-slate-300 border-slate-600",
  submitted: "bg-sky-900/40 text-sky-300 border-sky-600",
  approved: "bg-indigo-900/40 text-indigo-300 border-indigo-600",
  pending_approval: "bg-amber-900/40 text-amber-300 border-amber-600",
  posted: "bg-emerald-900/40 text-emerald-300 border-emerald-600",
  paid: "bg-green-900/50 text-green-300 border-green-600",
  rejected: "bg-red-900/40 text-red-300 border-red-600",
};

const TYPE_LABELS: Record<string, string> = {
  vendor_bill: "Tagihan Vendor",
  reimbursement: "Reimburse",
  internal: "Internal",
  routine: "Rutin / Kas",
  kasbon: "Kasbon",
  talangan: "Dana Talangan",
  fixed_asset: "Aset Tetap",
};

const LS_STATUS_FILTER    = "expense_list_statusFilter";
const LS_TYPE_FILTER      = "expense_list_typeFilter";
const LS_TX_TYPE_FILTER   = "expense_list_txTypeFilter";
const LS_CAT_FILTER       = "expense_list_catFilter";
const LS_SALES_DOC_FILTER = "expense_list_salesDocFilter";
const LS_SHIPMENT_FILTER  = "expense_list_shipmentFilter";

function StatusBadge({ status }: { status: string }) {
  return (
    <Badge className={`text-xs border ${STATUS_COLORS[status] ?? "bg-muted text-muted-foreground"}`}>
      {STATUS_LABELS[status] ?? status}
    </Badge>
  );
}

export default function ExpenseListPage() {
  const qc = useQueryClient();
  const prefetchHover = usePrefetchOnHover();
  const { toast } = useToast();
  const { t } = useLanguage();
  const { activeCompanyId } = useCompany();
  const _urlParams = new URLSearchParams(typeof window !== "undefined" ? window.location.search : "");
  const [search, setSearch] = useState(() => _urlParams.get("search") ?? "");
  const [fromFilter, setFromFilter] = useState(() => _urlParams.get("from") ?? "");
  const [toFilter, setToFilter] = useState(() => _urlParams.get("to") ?? "");
  const [statusFilter, setStatusFilter] = useState(() => {
    try {
      const v = localStorage.getItem(LS_STATUS_FILTER);
      return v && (v === "all" || Object.prototype.hasOwnProperty.call(STATUS_LABELS, v)) ? v : "all";
    } catch { return "all"; }
  });
  const [typeFilter, setTypeFilter] = useState(() => {
    try {
      const v = localStorage.getItem(LS_TYPE_FILTER);
      return v && (v === "all" || Object.prototype.hasOwnProperty.call(TYPE_LABELS, v)) ? v : "all";
    } catch { return "all"; }
  });
  const [catFilter, setCatFilter] = useState(() => {
    const urlCat = _urlParams.get("categoryId");
    if (urlCat && /^\d+$/.test(urlCat)) return urlCat;
    try {
      const v = localStorage.getItem(LS_CAT_FILTER);
      return v && (v === "all" || /^\d+$/.test(v)) ? v : "all";
    } catch { return "all"; }
  });
  const [salesDocFilter, setSalesDocFilter] = useState(() => {
    try {
      const v = localStorage.getItem(LS_SALES_DOC_FILTER);
      return v && (v === "all" || /^\d+$/.test(v)) ? v : "all";
    } catch { return "all"; }
  });
  const [shipmentFilter, setShipmentFilter] = useState(() => {
    try {
      const v = localStorage.getItem(LS_SHIPMENT_FILTER);
      return v && (v === "all" || /^\d+$/.test(v)) ? v : "all";
    } catch { return "all"; }
  });
  const [txTypeFilter, setTxTypeFilter] = useState(() => {
    try {
      const v = localStorage.getItem(LS_TX_TYPE_FILTER);
      return v && ["all", "expense", "income"].includes(v) ? v : "all";
    } catch { return "all"; }
  });

  const [repairOpen, setRepairOpen] = useState(false);
  const [repairing, setRepairing] = useState(false);
  const [repairResult, setRepairResult] = useState<{ total: number; succeeded: number; failed: number; results: { id: number; success: boolean; error?: string }[] } | null>(null);

  const { data: missingJournals, refetch: refetchMissing } = useQuery<{ count: number; items: { id: number; expense_number: string; date: string; description: string; total: string; transaction_type: string; category_name: string }[] }>({
    queryKey: ["expense-missing-journals", activeCompanyId],
    queryFn: async () => {
      const params = new URLSearchParams();
      if (activeCompanyId) params.set("company", String(activeCompanyId));
      const res = await fetch(`/api/expenses/missing-journals?${params}`);
      if (!res.ok) return { count: 0, items: [] };
      return res.json();
    },
    refetchInterval: repairOpen ? 30000 : false,
  });

  const handleBulkRepost = async () => {
    setRepairing(true);
    setRepairResult(null);
    try {
      const params = new URLSearchParams();
      if (activeCompanyId) params.set("company", String(activeCompanyId));
      const res = await fetch(`/api/expenses/bulk-repost?${params}`, { method: "POST" });
      const data = await res.json();
      setRepairResult(data);
      refetchMissing();
      qc.invalidateQueries({ queryKey: getListExpensesQueryKey() });
      toast({ title: `Selesai: ${data.succeeded} jurnal berhasil di-posting` });
    } catch (e: any) {
      toast({ title: e?.message ?? "Gagal", variant: "destructive" });
    } finally {
      setRepairing(false);
    }
  };

  const handleSingleRepost = async (id: number) => {
    try {
      const res = await fetch(`/api/expenses/${id}/repost-journal`, { method: "POST" });
      const data = await res.json();
      if (data.success) {
        toast({ title: `Jurnal expense #${id} berhasil di-posting` });
        refetchMissing();
        qc.invalidateQueries({ queryKey: getListExpensesQueryKey() });
      } else {
        toast({ title: data.message ?? "Gagal", variant: "destructive" });
      }
    } catch (e: any) {
      toast({ title: e?.message ?? "Gagal", variant: "destructive" });
    }
  };

  const { data: expenses = [], isLoading } = useListExpenses({
    status: statusFilter !== "all" ? statusFilter : undefined,
    expenseType: typeFilter !== "all" ? typeFilter : undefined,
    transactionType: txTypeFilter !== "all" ? txTypeFilter : undefined,
    categoryId: catFilter !== "all" ? Number(catFilter) : undefined,
    salesDocId: salesDocFilter !== "all" ? Number(salesDocFilter) : undefined,
    shipmentId: shipmentFilter !== "all" ? Number(shipmentFilter) : undefined,
    search: search || undefined,
    from: fromFilter || undefined,
    to: toFilter || undefined,
    company: activeCompanyId,
  } as any);
  const { data: cats = [] } = useListExpenseCategories();
  const { data: _salesDocsPaginated } = useListSalesDocuments({ kind: "order", limit: 500 });
  const salesDocs = _salesDocsPaginated?.data ?? [];
  const { data: shipments = [] } = useListFreightShipments();
  const deleteMut = useDeleteExpense();
  const [deleteId, setDeleteId] = useState<number | null>(null);

  // ── Bridge: Bayar expense via Bank Disbursement ────────────────────────
  const [payTarget, setPayTarget] = useState<any | null>(null);
  const [payBankAccountId, setPayBankAccountId] = useState<string>("");
  const [payMemo, setPayMemo] = useState("");
  const [paying, setPaying] = useState(false);

  const { data: paymentAccounts = [] } = useQuery({
    queryKey: ["expense-payment-accounts", activeCompanyId],
    queryFn: () => apiFetch(`/api/expenses/payment-accounts${activeCompanyId ? `?company=${activeCompanyId}` : ""}`),
    enabled: !!payTarget,
  });

  const openPayDialog = (exp: any) => {
    setPayTarget(exp);
    setPayBankAccountId("");
    setPayMemo("");
  };

  const handlePay = async () => {
    if (!payTarget || !payBankAccountId) return;
    setPaying(true);
    try {
      const data = await apiFetch(`/api/expenses/${payTarget.id}/pay`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ bankAccountId: Number(payBankAccountId), memo: payMemo || undefined }),
      });
      toast({ title: `Expense berhasil dibayar — Disbursement ${data.disbursementNumber ?? data.disbursementId}` });
      qc.invalidateQueries({ queryKey: getListExpensesQueryKey() });
      setPayTarget(null);
    } catch (e: any) {
      toast({ title: e?.message ?? "Gagal membayar expense", variant: "destructive" });
    } finally {
      setPaying(false);
    }
  };

  const soMap = Object.fromEntries(salesDocs.map((sd) => [sd.id, sd.docNumber]));
  const shipMap = Object.fromEntries(shipments.map((sh) => [sh.id, sh.shipmentNumber]));

  const handleDelete = async () => {
    if (!deleteId) return;
    try {
      await deleteMut.mutateAsync({ id: deleteId });
      qc.invalidateQueries({ queryKey: getListExpensesQueryKey() });
      toast({ title: t.common.success });
    } catch (e: any) {
      toast({ title: e?.message ?? t.common.error, variant: "destructive" });
    } finally { setDeleteId(null); }
  };

  return (
    <AppShell>
      <div className="p-6 space-y-4">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <Receipt size={22} className="text-primary" />
            <div>
              <h1 className="text-xl font-bold">Biaya Operasional</h1>
              <p className="text-sm text-muted-foreground">Kelola seluruh expense & biaya operasional bisnis</p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <Button
              size="sm" variant="outline"
              className="h-8 text-xs border-amber-500/50 text-amber-400 hover:bg-amber-950/40"
              onClick={handleBulkRepost}
              disabled={repairing}
              title="Posting jurnal untuk semua beban yang belum terjurnal (agar muncul di Laba Rugi)"
            >
              <Wrench size={13} className="mr-1" />
              {repairing ? "Memproses..." : "Perbaiki Jurnal"}
            </Button>
            <Link href="/expense/new">
              <Button size="sm">
                <Plus size={14} className="mr-1" />
                Buat Expense
              </Button>
            </Link>
          </div>
        </div>

        {/* ── Panel Perbaiki Jurnal ────────────────────────────────────── */}
        {(missingJournals?.count ?? 0) > 0 && (
          <Card className="border-amber-500/50 bg-amber-950/20">
            <CardContent className="p-3">
              <div className="flex items-center justify-between gap-3">
                <div className="flex items-center gap-2 text-amber-400">
                  <Wrench size={15} className="shrink-0" />
                  <span className="text-sm font-medium">
                    {missingJournals!.count} expense aktif belum punya jurnal akuntansi
                  </span>
                </div>
                <div className="flex items-center gap-2">
                  <Button
                    size="sm" variant="outline"
                    className="h-7 text-xs border-amber-500/50 text-amber-400 hover:bg-amber-950/40"
                    onClick={() => setRepairOpen((v) => !v)}
                  >
                    {repairOpen ? <ChevronUp size={12} className="mr-1" /> : <ChevronDown size={12} className="mr-1" />}
                    {repairOpen ? "Tutup" : "Lihat Detail"}
                  </Button>
                  <Button
                    size="sm"
                    className="h-7 text-xs bg-amber-600 hover:bg-amber-700 text-white"
                    onClick={handleBulkRepost}
                    disabled={repairing}
                  >
                    <Wrench size={12} className="mr-1" />
                    {repairing ? "Memproses..." : "Perbaiki Semua"}
                  </Button>
                </div>
              </div>

              {repairResult && (
                <div className="mt-2 text-xs flex gap-4 text-muted-foreground">
                  <span className="text-emerald-400 flex items-center gap-1"><CheckCircle2 size={11} />{repairResult.succeeded} berhasil</span>
                  {repairResult.failed > 0 && <span className="text-rose-400 flex items-center gap-1"><AlertCircle size={11} />{repairResult.failed} gagal (akun COA belum diset)</span>}
                </div>
              )}

              {repairOpen && (
                <div className="mt-3 border-t border-amber-500/20 pt-3 space-y-1 max-h-56 overflow-y-auto">
                  {missingJournals!.items.map((item) => (
                    <div key={item.id} className="flex items-center justify-between gap-2 text-xs py-1">
                      <div className="flex items-center gap-2 min-w-0">
                        <span className="font-mono text-muted-foreground shrink-0">{item.expense_number}</span>
                        <span className="truncate text-foreground">{item.description || item.category_name || "—"}</span>
                        <Badge variant="outline" className={`text-[10px] shrink-0 ${item.transaction_type === "income" ? "border-emerald-500/40 text-emerald-400" : "border-rose-500/40 text-rose-400"}`}>
                          {item.transaction_type === "income" ? "Penerimaan" : "Expense"}
                        </Badge>
                      </div>
                      <div className="flex items-center gap-2 shrink-0">
                        <span className="font-mono text-muted-foreground">{idr(Number(item.total))}</span>
                        <Button
                          size="sm" variant="ghost"
                          className="h-6 px-2 text-[10px] text-amber-400 hover:text-amber-300"
                          onClick={() => handleSingleRepost(item.id)}
                        >
                          <Wrench size={10} className="mr-0.5" />Post
                        </Button>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>
        )}

        {/* ── Modul Cepat ────────────────────────────────────────────── */}
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
          <Link href="/expense/routine">
            <div className="flex items-center gap-3 rounded-lg border bg-card px-4 py-3 hover:bg-muted/50 transition-colors cursor-pointer">
              <Zap size={18} className="text-yellow-400 shrink-0" />
              <div>
                <p className="text-sm font-medium leading-tight">Expense Rutin</p>
                <p className="text-xs text-muted-foreground">6 preset kategori</p>
              </div>
            </div>
          </Link>
          <Link href="/expense/kasbon">
            <div className="flex items-center gap-3 rounded-lg border bg-card px-4 py-3 hover:bg-muted/50 transition-colors cursor-pointer">
              <Wallet size={18} className="text-amber-400 shrink-0" />
              <div>
                <p className="text-sm font-medium leading-tight">Kasbon Karyawan</p>
                <p className="text-xs text-muted-foreground">Piutang karyawan</p>
              </div>
            </div>
          </Link>
          <Link href="/expense/talangan">
            <div className="flex items-center gap-3 rounded-lg border bg-card px-4 py-3 hover:bg-muted/50 transition-colors cursor-pointer">
              <HandCoins size={18} className="text-indigo-400 shrink-0" />
              <div>
                <p className="text-sm font-medium leading-tight">Dana Talangan</p>
                <p className="text-xs text-muted-foreground">Piutang dana talangan</p>
              </div>
            </div>
          </Link>
          <Link href="/expense/vendor-installments">
            <div className="flex items-center gap-3 rounded-lg border bg-card px-4 py-3 hover:bg-muted/50 transition-colors cursor-pointer">
              <Building2 size={18} className="text-rose-400 shrink-0" />
              <div>
                <p className="text-sm font-medium leading-tight">Cicilan Vendor</p>
                <p className="text-xs text-muted-foreground">Hutang cicilan vendor</p>
              </div>
            </div>
          </Link>
          <Link href="/expense/bank-loans">
            <div className="flex items-center gap-3 rounded-lg border bg-card px-4 py-3 hover:bg-muted/50 transition-colors cursor-pointer">
              <Landmark size={18} className="text-blue-400 shrink-0" />
              <div>
                <p className="text-sm font-medium leading-tight">Hutang Bank</p>
                <p className="text-xs text-muted-foreground">Bank & leasing cicilan</p>
              </div>
            </div>
          </Link>
          <Link href="/expense/fixed-assets">
            <div className="flex items-center gap-3 rounded-lg border bg-card px-4 py-3 hover:bg-muted/50 transition-colors cursor-pointer">
              <Package size={18} className="text-teal-400 shrink-0" />
              <div>
                <p className="text-sm font-medium leading-tight">Aset Tetap</p>
                <p className="text-xs text-muted-foreground">Penyusutan otomatis</p>
              </div>
            </div>
          </Link>
          <Link href="/expense/asset-depreciation">
            <div className="flex items-center gap-3 rounded-lg border bg-card px-4 py-3 hover:bg-muted/50 transition-colors cursor-pointer">
              <TrendingDown size={18} className="text-orange-400 shrink-0" />
              <div>
                <p className="text-sm font-medium leading-tight">Penyusutan Aset</p>
                <p className="text-xs text-muted-foreground">DR Beban / CR Akum.</p>
              </div>
            </div>
          </Link>
          <Link href="/expense/approvals">
            <div className="flex items-center gap-3 rounded-lg border bg-card px-4 py-3 hover:bg-muted/50 transition-colors cursor-pointer">
              <ShieldCheck size={18} className="text-violet-400 shrink-0" />
              <div>
                <p className="text-sm font-medium leading-tight">Approval</p>
                <p className="text-xs text-muted-foreground">Multi-level limit</p>
              </div>
            </div>
          </Link>
          <Link href="/expense/dashboard">
            <div className="flex items-center gap-3 rounded-lg border bg-card px-4 py-3 hover:bg-muted/50 transition-colors cursor-pointer">
              <LayoutDashboard size={18} className="text-cyan-400 shrink-0" />
              <div>
                <p className="text-sm font-medium leading-tight">Dashboard</p>
                <p className="text-xs text-muted-foreground">Monitoring & reminder</p>
              </div>
            </div>
          </Link>
          <Link href="/expense/templates">
            <div className="flex items-center gap-3 rounded-lg border bg-card px-4 py-3 hover:bg-muted/50 transition-colors cursor-pointer">
              <Layers size={18} className="text-emerald-400 shrink-0" />
              <div>
                <p className="text-sm font-medium leading-tight">Template</p>
                <p className="text-xs text-muted-foreground">Preset expense</p>
              </div>
            </div>
          </Link>
          <Link href="/expense/budget">
            <div className="flex items-center gap-3 rounded-lg border bg-card px-4 py-3 hover:bg-muted/50 transition-colors cursor-pointer">
              <PieChart size={18} className="text-pink-400 shrink-0" />
              <div>
                <p className="text-sm font-medium leading-tight">Anggaran</p>
                <p className="text-xs text-muted-foreground">Budget & kurs valuta</p>
              </div>
            </div>
          </Link>
        </div>

        {(fromFilter || toFilter) && (
          <div className="flex items-center gap-2 rounded-md border border-blue-200 bg-blue-50 px-3 py-2 text-sm text-blue-800 dark:border-blue-800 dark:bg-blue-950 dark:text-blue-300">
            <CalendarRange size={14} className="shrink-0" />
            <span>
              Filter dari laporan:{" "}
              <strong>{fromFilter || "—"}</strong>
              {" s/d "}
              <strong>{toFilter || "—"}</strong>
            </span>
            <button
              className="ml-auto rounded hover:bg-blue-100 dark:hover:bg-blue-900 p-0.5"
              onClick={() => { setFromFilter(""); setToFilter(""); }}
              title="Hapus filter tanggal"
            >
              <X size={13} />
            </button>
          </div>
        )}

        <div className="flex flex-wrap gap-2">
          <div className="relative flex-1 min-w-[180px]">
            <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
            <Input
              className="pl-9"
              placeholder="Cari nomor, vendor, deskripsi..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
          </div>
          <Select value={statusFilter} onValueChange={(v) => { setStatusFilter(v); try { localStorage.setItem(LS_STATUS_FILTER, v); } catch {} }}>
            <SelectTrigger className="w-[160px]">
              <SelectValue placeholder="Semua status" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">Semua Status</SelectItem>
              {Object.entries(STATUS_LABELS).map(([k, v]) => (
                <SelectItem key={k} value={k}>{v}</SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Select value={typeFilter} onValueChange={(v) => { setTypeFilter(v); try { localStorage.setItem(LS_TYPE_FILTER, v); } catch {} }}>
            <SelectTrigger className="w-[160px]">
              <SelectValue placeholder="Semua tipe" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">Semua Tipe</SelectItem>
              {Object.entries(TYPE_LABELS).map(([k, v]) => (
                <SelectItem key={k} value={k}>{v}</SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Select value={txTypeFilter} onValueChange={(v) => { setTxTypeFilter(v); try { localStorage.setItem(LS_TX_TYPE_FILTER, v); } catch {} }}>
            <SelectTrigger className="w-[170px]">
              <SelectValue placeholder="Semua Jenis" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">Pengeluaran & Penerimaan</SelectItem>
              <SelectItem value="expense">
                <span className="flex items-center gap-1.5"><TrendingDown size={12} className="text-red-400" />Pengeluaran</span>
              </SelectItem>
              <SelectItem value="income">
                <span className="flex items-center gap-1.5"><TrendingUp size={12} className="text-emerald-400" />Penerimaan</span>
              </SelectItem>
            </SelectContent>
          </Select>
          <Select value={catFilter} onValueChange={(v) => { setCatFilter(v); try { localStorage.setItem(LS_CAT_FILTER, v); } catch {} }}>
            <SelectTrigger className="w-[180px]">
              <SelectValue placeholder="Semua kategori" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">Semua Kategori</SelectItem>
              {cats.map((c) => (
                <SelectItem key={c.id} value={c.id.toString()}>{c.name}</SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Select value={salesDocFilter} onValueChange={(v) => { setSalesDocFilter(v); try { localStorage.setItem(LS_SALES_DOC_FILTER, v); } catch {} }}>
            <SelectTrigger className="w-[200px]">
              <SelectValue placeholder="Semua Sales Order" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">Semua Sales Order</SelectItem>
              {salesDocs.map((sd) => (
                <SelectItem key={sd.id} value={sd.id.toString()}>
                  {sd.docNumber} — {sd.customerName}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Select value={shipmentFilter} onValueChange={(v) => { setShipmentFilter(v); try { localStorage.setItem(LS_SHIPMENT_FILTER, v); } catch {} }}>
            <SelectTrigger className="w-[200px]">
              <SelectValue placeholder="Semua Shipment" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">Semua Shipment</SelectItem>
              {shipments.map((sh) => (
                <SelectItem key={sh.id} value={sh.id.toString()}>
                  {sh.shipmentNumber}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        <Card>
          <CardContent className="p-0">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>No. Expense</TableHead>
                  <TableHead>Tanggal</TableHead>
                  <TableHead>Tipe</TableHead>
                  <TableHead>Vendor/Karyawan</TableHead>
                  <TableHead>Deskripsi</TableHead>
                  <TableHead>Kategori</TableHead>
                  <TableHead>Sumber Dana</TableHead>
                  <TableHead>Job / Referensi</TableHead>
                  <TableHead className="text-right">Total</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead className="w-12"></TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {isLoading && (
                  <TableRow>
                    <TableCell colSpan={11} className="text-center py-10 text-muted-foreground">Memuat data...</TableCell>
                  </TableRow>
                )}
                {!isLoading && expenses.length === 0 && (
                  <TableRow>
                    <TableCell colSpan={11} className="text-center py-10 text-muted-foreground">
                      Belum ada expense. Klik "Buat Expense" untuk memulai.
                    </TableCell>
                  </TableRow>
                )}
                {expenses.map((exp) => {
                  const expAny = exp as any;
                  const cat = cats.find((c) => c.id === exp.categoryId);
                  return (
                    <TableRow key={exp.id} className="cursor-pointer hover:bg-muted/50" {...prefetchHover(getGetExpenseQueryOptions(exp.id))}>
                      <TableCell>
                        <Link href={`/expense/${exp.id}`}>
                          <span className="font-mono text-xs text-primary hover:underline">{exp.expenseNumber}</span>
                        </Link>
                      </TableCell>
                      <TableCell className="text-sm">{exp.date}</TableCell>
                      <TableCell>
                        <div className="flex flex-col gap-0.5">
                          <Badge variant="outline" className="text-xs">{TYPE_LABELS[exp.expenseType] ?? exp.expenseType}</Badge>
                          {(expAny.transactionType === "income") ? (
                            <span className="inline-flex items-center gap-1 text-[11px] font-medium text-emerald-400">
                              <TrendingUp size={10} />Penerimaan
                            </span>
                          ) : (
                            <span className="inline-flex items-center gap-1 text-[11px] font-medium text-red-400">
                              <TrendingDown size={10} />Pengeluaran
                            </span>
                          )}
                        </div>
                      </TableCell>
                      <TableCell className="text-sm">{expAny.vendor?.name ?? expAny.user?.name ?? exp.vendorEmployee ?? "—"}</TableCell>
                      <TableCell className="text-sm text-muted-foreground max-w-[200px] truncate">{exp.description ?? "—"}</TableCell>
                      <TableCell>
                        {expAny.categoryName
                          ? <Badge variant="secondary" className="text-xs">{expAny.categoryName}</Badge>
                          : cat ? <Badge variant="secondary" className="text-xs">{cat.name}</Badge>
                          : <span className="text-xs text-muted-foreground">—</span>}
                      </TableCell>
                      <TableCell className="text-xs text-muted-foreground">
                        {expAny.sourceAccountName ?? expAny.sourceAccount?.name ?? "—"}
                      </TableCell>
                      <TableCell>
                        <div className="flex flex-col gap-0.5">
                          {exp.salesDocId && (
                            <Link href={`/sales/orders/${exp.salesDocId}`}>
                              <span className="inline-flex items-center gap-1 text-xs text-indigo-600 dark:text-indigo-400 hover:underline font-mono">
                                <ShoppingCart size={10} />
                                {soMap[exp.salesDocId] ?? `SO #${exp.salesDocId}`}
                              </span>
                            </Link>
                          )}
                          {exp.shipmentId && (
                            <Link href={`/logistics/freight/${exp.shipmentId}`}>
                              <span className="inline-flex items-center gap-1 text-xs text-teal-600 dark:text-teal-400 hover:underline font-mono">
                                <Ship size={10} />
                                {shipMap[exp.shipmentId] ?? `SHIP #${exp.shipmentId}`}
                              </span>
                            </Link>
                          )}
                          {!exp.salesDocId && !exp.shipmentId && (
                            <span className="text-xs text-muted-foreground">—</span>
                          )}
                        </div>
                      </TableCell>
                      <TableCell className="text-right font-medium">{idr(exp.total)}</TableCell>
                      <TableCell><StatusBadge status={exp.status} /></TableCell>
                      <TableCell>
                        <div className="flex flex-col gap-1">
                          <div className="flex items-center gap-1">
                            {(exp.status as string) === "active" && !expAny.disbursementId && (
                              <Button
                                variant="outline" size="sm"
                                className="h-7 text-xs border-emerald-500/50 text-emerald-400 hover:bg-emerald-950/40"
                                onClick={() => openPayDialog(exp)}
                                title="Bayar expense ini via Bank Disbursement"
                              >
                                <Banknote size={12} className="mr-1" />
                                Bayar
                              </Button>
                            )}
                            {expAny.disbursementId && (
                              <Link href={`/accounting/bank-disbursements?highlight=${expAny.disbursementId}`}>
                                <Badge variant="outline" className="text-[10px] border-green-500/50 text-green-400 cursor-pointer hover:bg-green-950/40">
                                  Sudah Dibayar
                                </Badge>
                              </Link>
                            )}
                            {(exp.status === "draft" || exp.status === "rejected") && (
                              <Button variant="ghost" size="icon" className="h-7 w-7 text-destructive hover:text-destructive"
                                onClick={() => setDeleteId(exp.id)}>
                                <Trash2 size={12} />
                              </Button>
                            )}
                          </div>
                          {/* Phase 12: AI Review cross-link — non-blocking, read-only */}
                          <AIReviewSourcePanel
                            source="EXPENSE"
                            sourceRecordId={String(exp.id)}
                            transactionSnapshot={{
                              id: String(exp.id),
                              description: exp.description ?? exp.expenseNumber ?? `Expense #${exp.id}`,
                              amount: exp.total,
                              direction: 'DEBIT',
                              transactionDate: exp.date,
                            }}
                          />
                        </div>
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
        {/* Deprecated section — menu lama yang sudah digantikan Bank Disbursement */}
        <details className="group">
          <summary className="flex items-center gap-2 text-xs text-muted-foreground cursor-pointer select-none py-1 hover:text-foreground transition-colors list-none">
            <ChevronDown size={13} className="group-open:hidden" />
            <ChevronUp size={13} className="hidden group-open:block" />
            Menu Historis (Deprecated)
          </summary>
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-3 mt-2">
            <Link href="/expense/vendor-payments">
              <div className="flex items-center gap-3 rounded-lg border border-amber-500/30 bg-amber-500/5 px-4 py-3 hover:bg-muted/50 transition-colors cursor-pointer">
                <Banknote size={16} className="text-amber-400/60 shrink-0" />
                <div className="flex-1 min-w-0">
                  <p className="text-xs font-medium flex items-center gap-1.5">
                    Pembayaran Vendor
                    <Badge className="bg-amber-600/20 text-amber-400 border-amber-500 text-[9px] px-1 py-0 h-3.5">DEPRECATED</Badge>
                  </p>
                  <p className="text-[10px] text-muted-foreground">Historis · gunakan Bank Disbursement</p>
                </div>
              </div>
            </Link>
            <Link href="/expense/kas-transfer">
              <div className="flex items-center gap-3 rounded-lg border border-amber-500/30 bg-amber-500/5 px-4 py-3 hover:bg-muted/50 transition-colors cursor-pointer">
                <ArrowRightLeft size={16} className="text-amber-400/60 shrink-0" />
                <div className="flex-1 min-w-0">
                  <p className="text-xs font-medium flex items-center gap-1.5">
                    Transfer Kas
                    <Badge className="bg-amber-600/20 text-amber-400 border-amber-500 text-[9px] px-1 py-0 h-3.5">DEPRECATED</Badge>
                  </p>
                  <p className="text-[10px] text-muted-foreground">Historis · gunakan Bank Disbursement</p>
                </div>
              </div>
            </Link>
          </div>
        </details>
      </div>

      <AlertDialog open={!!deleteId} onOpenChange={(v) => !v && setDeleteId(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Hapus Expense?</AlertDialogTitle>
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
