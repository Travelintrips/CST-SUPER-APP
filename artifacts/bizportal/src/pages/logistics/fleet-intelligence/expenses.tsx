import { DatePicker } from "@/components/ui/date-picker";
import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { AppShell } from "@/components/layout/AppShell";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Textarea } from "@/components/ui/textarea";
import {
  Wallet, PlusCircle, Edit2, Trash2, Download, AlertTriangle,
  RefreshCw, TrendingUp, Target, CheckCircle2, XCircle, ArrowLeft,
} from "lucide-react";
import { toast } from "sonner";
import { Link } from "wouter";
import { BackButton } from "@/components/ui/back-button";

// ─── Helpers ─────────────────────────────────────────────────────────────────
function fmtIdr(v: unknown) {
  return new Intl.NumberFormat("id-ID", { style: "currency", currency: "IDR", maximumFractionDigits: 0 }).format(
    parseFloat(String(v ?? 0)) || 0
  );
}
function fmtDate(v: unknown) {
  if (!v) return "-";
  return new Date(String(v)).toLocaleDateString("id-ID", { dateStyle: "medium" });
}
function todayYearMonth() {
  return new Date().toISOString().slice(0, 7);
}

const EXPENSE_TYPES = ["Ban", "Perbaikan", "Service Rutin", "Asuransi", "Bahan Bakar", "Parkir", "Tilang", "Oli", "Spare Part", "Lainnya"];
const HIGHLIGHT_THRESHOLD = 5_000_000;

// ─── Types ────────────────────────────────────────────────────────────────────
type Expense = {
  id: number;
  expense_date: string;
  expense_type: string;
  description: string | null;
  amount: string;
  vehicle_id: number | null;
  vehicle_plate: string | null;
  created_by: string | null;
  created_at: string;
  updated_by: string | null;
};

type BudgetRow = {
  id: number | null;
  expense_type: string;
  budget_month: string;
  budget_amount: number;
  actual_amount: number;
  tx_count: number;
  pct_used: number | null;
  is_over: boolean;
  is_warning: boolean;
  has_budget: boolean;
};

type FormState = {
  expense_date: string;
  expense_type: string;
  description: string;
  amount: string;
  vehicle_id: string;
};
const EMPTY_FORM: FormState = {
  expense_date: new Date().toISOString().slice(0, 10),
  expense_type: "",
  description: "",
  amount: "",
  vehicle_id: "",
};

// ─── Sub-components ───────────────────────────────────────────────────────────
function typeBadgeClass(type: string): string {
  const map: Record<string, string> = {
    "Ban": "bg-blue-500/20 text-blue-300 border-blue-600",
    "Perbaikan": "bg-red-500/20 text-red-300 border-red-600",
    "Service Rutin": "bg-emerald-500/20 text-emerald-300 border-emerald-600",
    "Asuransi": "bg-purple-500/20 text-purple-300 border-purple-600",
    "Bahan Bakar": "bg-yellow-500/20 text-yellow-300 border-yellow-600",
    "Parkir": "bg-slate-500/20 text-slate-300 border-slate-600",
    "Tilang": "bg-orange-500/20 text-orange-300 border-orange-600",
    "Oli": "bg-cyan-500/20 text-cyan-300 border-cyan-600",
    "Spare Part": "bg-indigo-500/20 text-indigo-300 border-indigo-600",
  };
  return map[type] ?? "bg-slate-500/20 text-slate-300 border-slate-600";
}

function ProgressBar({ pct, isOver, isWarning }: { pct: number | null; isOver: boolean; isWarning: boolean }) {
  if (pct === null) return <div className="h-2 rounded-full bg-slate-700 w-full" />;
  const capped = Math.min(pct, 100);
  const color = isOver ? "bg-red-500" : isWarning ? "bg-amber-400" : "bg-emerald-500";
  return (
    <div className="relative h-2 rounded-full bg-slate-700 w-full overflow-hidden">
      <div
        className={`absolute left-0 top-0 h-full rounded-full transition-all ${color}`}
        style={{ width: `${capped}%` }}
      />
    </div>
  );
}

// ─── Main Component ───────────────────────────────────────────────────────────
export default function FleetExpensesPage() {
  const qc = useQueryClient();
  const [activeTab, setActiveTab] = useState<"expenses" | "budget">("expenses");

  // -- Expenses state --
  const [dateFrom, setDateFrom]     = useState("");
  const [dateTo, setDateTo]         = useState("");
  const [filterType, setFilterType] = useState("all");
  const [filterVehicle, setFilterVehicle] = useState("all");
  const [page, setPage]             = useState(1);

  const [modalOpen, setModalOpen]   = useState(false);
  const [editing, setEditing]       = useState<Expense | null>(null);
  const [form, setForm]             = useState<FormState>(EMPTY_FORM);
  const [deleteConfirm, setDeleteConfirm] = useState<Expense | null>(null);

  // -- Budget state --
  const [budgetMonth, setBudgetMonth] = useState(todayYearMonth());
  const [budgetModal, setBudgetModal] = useState<{ type: string; id: number | null; amount: string } | null>(null);
  const [deleteBudgetId, setDeleteBudgetId] = useState<number | null>(null);

  // ── Queries ─────────────────────────────────────────────────────────────────
  const expParams = new URLSearchParams({ page: String(page), limit: "50" });
  if (dateFrom)               expParams.set("date_from", dateFrom);
  if (dateTo)                 expParams.set("date_to", dateTo);
  if (filterType !== "all")   expParams.set("expense_type", filterType);
  if (filterVehicle !== "all") expParams.set("vehicle_id", filterVehicle);

  const { data: expData, isLoading: expLoading, refetch: refetchExp } = useQuery({
    queryKey: ["fleet-expenses", dateFrom, dateTo, filterType, filterVehicle, page],
    queryFn: async () => {
      const r = await fetch(`/api/logistics/fleet/expenses?${expParams}`, { credentials: "include" });
      if (!r.ok) throw new Error("Gagal mengambil data");
      return r.json() as Promise<{
        expenses: Expense[];
        total: number;
        page: number;
        limit: number;
        summary: { total_all: number; total_this_month: number; by_type: { expense_type: string; total: number }[] };
      }>;
    },
  });

  const { data: vehiclesData } = useQuery({
    queryKey: ["fleet-vehicles-minimal"],
    queryFn: async () => {
      const r = await fetch("/api/logistics/fleet/vehicles?limit=200", { credentials: "include" });
      if (!r.ok) return { vehicles: [] };
      return r.json() as Promise<{ vehicles: { id: number; plate: string; vehicle_type: string }[] }>;
    },
  });

  const { data: budgetData, isLoading: budgetLoading, refetch: refetchBudget } = useQuery({
    queryKey: ["fleet-budgets", budgetMonth],
    queryFn: async () => {
      const r = await fetch(`/api/logistics/fleet/expenses/budgets?month=${budgetMonth}`, { credentials: "include" });
      if (!r.ok) throw new Error("Gagal mengambil data anggaran");
      return r.json() as Promise<{
        month: string;
        budgets: BudgetRow[];
        summary: { total_budget: number; total_actual: number; over_count: number; warning_count: number };
      }>;
    },
    enabled: activeTab === "budget",
  });

  // ── Mutations ────────────────────────────────────────────────────────────────
  const saveMutation = useMutation({
    mutationFn: async (body: Record<string, unknown>) => {
      const url = editing ? `/api/logistics/fleet/expenses/${editing.id}` : "/api/logistics/fleet/expenses";
      const r = await fetch(url, { method: editing ? "PUT" : "POST", credentials: "include", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
      const json = await r.json();
      if (!r.ok) throw new Error(json.error ?? "Gagal menyimpan");
      return json;
    },
    onSuccess: () => { toast.success(editing ? "Pengeluaran diperbarui" : "Pengeluaran disimpan"); closeExpModal(); qc.invalidateQueries({ queryKey: ["fleet-expenses"] }); },
    onError: (e: Error) => toast.error(e.message),
  });

  const deleteMutation = useMutation({
    mutationFn: async (id: number) => {
      const r = await fetch(`/api/logistics/fleet/expenses/${id}`, { method: "DELETE", credentials: "include" });
      const json = await r.json();
      if (!r.ok) throw new Error(json.error ?? "Gagal menghapus");
    },
    onSuccess: () => { toast.success("Pengeluaran dihapus"); setDeleteConfirm(null); qc.invalidateQueries({ queryKey: ["fleet-expenses"] }); },
    onError: (e: Error) => toast.error(e.message),
  });

  const saveBudgetMutation = useMutation({
    mutationFn: async (body: { expense_type: string; budget_month: string; budget_amount: number }) => {
      const r = await fetch("/api/logistics/fleet/expenses/budgets", { method: "POST", credentials: "include", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
      const json = await r.json();
      if (!r.ok) throw new Error(json.error ?? "Gagal menyimpan anggaran");
      return json;
    },
    onSuccess: () => { toast.success("Anggaran disimpan"); setBudgetModal(null); qc.invalidateQueries({ queryKey: ["fleet-budgets"] }); },
    onError: (e: Error) => toast.error(e.message),
  });

  const deleteBudgetMutation = useMutation({
    mutationFn: async (id: number) => {
      const r = await fetch(`/api/logistics/fleet/expenses/budgets/${id}`, { method: "DELETE", credentials: "include" });
      const json = await r.json();
      if (!r.ok) throw new Error(json.error ?? "Gagal menghapus anggaran");
    },
    onSuccess: () => { toast.success("Anggaran dihapus"); setDeleteBudgetId(null); qc.invalidateQueries({ queryKey: ["fleet-budgets"] }); },
    onError: (e: Error) => toast.error(e.message),
  });

  // ── Handlers ─────────────────────────────────────────────────────────────────
  function closeExpModal() { setModalOpen(false); setEditing(null); setForm(EMPTY_FORM); }

  function openAdd() { setEditing(null); setForm(EMPTY_FORM); setModalOpen(true); }
  function openEdit(exp: Expense) {
    setEditing(exp);
    setForm({ expense_date: String(exp.expense_date ?? "").slice(0, 10), expense_type: exp.expense_type, description: exp.description ?? "", amount: String(parseFloat(String(exp.amount)) || ""), vehicle_id: exp.vehicle_id ? String(exp.vehicle_id) : "" });
    setModalOpen(true);
  }
  function handleSave() {
    if (!form.expense_date) { toast.error("Tanggal wajib diisi"); return; }
    if (!form.expense_type) { toast.error("Jenis pengeluaran wajib diisi"); return; }
    if (!form.amount || parseFloat(form.amount) <= 0) { toast.error("Nominal harus > 0"); return; }
    saveMutation.mutate({ expense_date: form.expense_date, expense_type: form.expense_type, description: form.description || null, amount: parseFloat(form.amount), vehicle_id: form.vehicle_id ? parseInt(form.vehicle_id) : null });
  }
  function handleExport() {
    const p = new URLSearchParams();
    if (dateFrom) p.set("date_from", dateFrom);
    if (dateTo) p.set("date_to", dateTo);
    if (filterType !== "all") p.set("expense_type", filterType);
    if (filterVehicle !== "all") p.set("vehicle_id", filterVehicle);
    window.open(`/api/logistics/fleet/expenses/export?${p}`, "_blank");
  }
  function handleSaveBudget() {
    if (!budgetModal) return;
    const amt = parseFloat(budgetModal.amount);
    if (!amt || amt <= 0) { toast.error("Nominal anggaran harus > 0"); return; }
    saveBudgetMutation.mutate({ expense_type: budgetModal.type, budget_month: budgetMonth, budget_amount: amt });
  }

  // ── Derived ───────────────────────────────────────────────────────────────────
  const expenses  = expData?.expenses ?? [];
  const total     = expData?.total ?? 0;
  const summary   = expData?.summary;
  const limit     = expData?.limit ?? 50;
  const totalPages = Math.ceil(total / limit);
  const vehicles  = vehiclesData?.vehicles ?? [];
  const budgets   = budgetData?.budgets ?? [];
  const bSummary  = budgetData?.summary;

  // ─── Render ──────────────────────────────────────────────────────────────────
  return (
    <AppShell>
      <BackButton href="/logistics" />
      <div className="space-y-6">
        <div className="p-6 pb-0">
          <Button variant="ghost" size="sm" className="-ml-2" onClick={() => window.history.back()}>
            <ArrowLeft className="h-4 w-4 mr-1" />Kembali
          </Button>
        </div>
        {/* Header */}
        <div className="flex items-center justify-between flex-wrap gap-3">
          <div>
            <div className="flex items-center gap-2 mb-1">
              <Link href="/logistics/fleet-intelligence">
                <span className="text-slate-400 text-sm hover:text-white cursor-pointer">Fleet Intelligence</span>
              </Link>
              <span className="text-slate-600">/</span>
              <span className="text-white text-sm font-medium">Pengeluaran</span>
            </div>
            <h1 className="text-2xl font-bold text-white flex items-center gap-2">
              <Wallet className="w-6 h-6 text-orange-400" />
              Fleet Expenses
            </h1>
            <p className="text-slate-400 text-sm mt-1">Pencatatan & anggaran pengeluaran operasional armada</p>
          </div>
          <div className="flex items-center gap-2">
            <Button variant="outline" size="sm" onClick={() => { refetchExp(); refetchBudget(); }} className="gap-2 border-slate-600 text-slate-300 hover:bg-slate-700">
              <RefreshCw className="w-4 h-4" /> Refresh
            </Button>
            {activeTab === "expenses" && (
              <>
                <Button variant="outline" size="sm" onClick={handleExport} className="gap-2 border-slate-600 text-slate-300 hover:bg-slate-700">
                  <Download className="w-4 h-4" /> Export Excel
                </Button>
                <Button size="sm" className="bg-orange-600 hover:bg-orange-700 gap-2" onClick={openAdd}>
                  <PlusCircle className="w-4 h-4" /> Tambah Pengeluaran
                </Button>
              </>
            )}
          </div>
        </div>

        {/* Tabs */}
        <div className="flex gap-1 bg-slate-800/60 p-1 rounded-lg w-fit border border-slate-700">
          {(["expenses", "budget"] as const).map((t) => (
            <button
              key={t}
              onClick={() => setActiveTab(t)}
              className={`px-4 py-2 rounded-md text-sm font-medium transition-colors ${activeTab === t ? "bg-orange-600 text-white" : "text-slate-400 hover:text-white"}`}
            >
              {t === "expenses" ? "📋 Daftar Pengeluaran" : "🎯 Anggaran (Budget)"}
            </button>
          ))}
        </div>

        {/* ── TAB: EXPENSES ──────────────────────────────────────────────────── */}
        {activeTab === "expenses" && (
          <>
            {/* Summary Cards */}
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
              <Card className="bg-slate-800/60 border-slate-700">
                <CardContent className="p-4">
                  <div className="w-9 h-9 rounded-lg bg-orange-400/10 flex items-center justify-center mb-3">
                    <Wallet className="w-4 h-4 text-orange-400" />
                  </div>
                  <div className="text-lg font-bold text-white">{fmtIdr(summary?.total_all ?? 0)}</div>
                  <div className="text-xs text-slate-400">Total (Filter Aktif)</div>
                </CardContent>
              </Card>
              <Card className="bg-slate-800/60 border-slate-700">
                <CardContent className="p-4">
                  <div className="w-9 h-9 rounded-lg bg-blue-400/10 flex items-center justify-center mb-3">
                    <TrendingUp className="w-4 h-4 text-blue-400" />
                  </div>
                  <div className="text-lg font-bold text-white">{fmtIdr(summary?.total_this_month ?? 0)}</div>
                  <div className="text-xs text-slate-400">Bulan Ini</div>
                </CardContent>
              </Card>
              <Card className="bg-slate-800/60 border-slate-700">
                <CardContent className="p-4">
                  <div className="w-9 h-9 rounded-lg bg-purple-400/10 flex items-center justify-center mb-3">
                    <AlertTriangle className="w-4 h-4 text-purple-400" />
                  </div>
                  <div className="text-sm font-semibold text-white mb-1">Per Jenis</div>
                  <div className="space-y-1">
                    {(summary?.by_type ?? []).slice(0, 3).map((t) => (
                      <div key={t.expense_type} className="flex justify-between text-xs">
                        <span className="text-slate-400 truncate">{t.expense_type}</span>
                        <span className="text-slate-300 font-medium ml-2 shrink-0">{fmtIdr(t.total)}</span>
                      </div>
                    ))}
                    {(summary?.by_type ?? []).length === 0 && <div className="text-xs text-slate-500">Belum ada data</div>}
                  </div>
                </CardContent>
              </Card>
            </div>

            {/* Filters */}
            <Card className="bg-slate-800/60 border-slate-700">
              <CardContent className="p-4">
                <div className="flex flex-wrap gap-3 items-end">
                  <div className="flex flex-col gap-1">
                    <Label className="text-slate-400 text-xs">Dari Tanggal</Label>
                    <DatePicker value={dateFrom} onChange={(v) => { setDateFrom(v); setPage(1); }} className="bg-slate-700 border-slate-600 text-white w-40" />
                  </div>
                  <div className="flex flex-col gap-1">
                    <Label className="text-slate-400 text-xs">Sampai Tanggal</Label>
                    <DatePicker value={dateTo} onChange={(v) => { setDateTo(v); setPage(1); }} className="bg-slate-700 border-slate-600 text-white w-40" />
                  </div>
                  <div className="flex flex-col gap-1">
                    <Label className="text-slate-400 text-xs">Jenis</Label>
                    <Select value={filterType} onValueChange={(v) => { setFilterType(v); setPage(1); }}>
                      <SelectTrigger className="w-44 bg-slate-700 border-slate-600 text-white">
                        <SelectValue placeholder="Semua Jenis" />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="all">Semua Jenis</SelectItem>
                        {EXPENSE_TYPES.map((t) => <SelectItem key={t} value={t}>{t}</SelectItem>)}
                      </SelectContent>
                    </Select>
                  </div>
                  {vehicles.length > 0 && (
                    <div className="flex flex-col gap-1">
                      <Label className="text-slate-400 text-xs">Kendaraan</Label>
                      <Select value={filterVehicle} onValueChange={(v) => { setFilterVehicle(v); setPage(1); }}>
                        <SelectTrigger className="w-40 bg-slate-700 border-slate-600 text-white">
                          <SelectValue placeholder="Semua" />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="all">Semua Kendaraan</SelectItem>
                          {vehicles.map((v) => <SelectItem key={v.id} value={String(v.id)}>{v.plate}</SelectItem>)}
                        </SelectContent>
                      </Select>
                    </div>
                  )}
                  {(dateFrom || dateTo || filterType !== "all" || filterVehicle !== "all") && (
                    <Button variant="ghost" size="sm" className="text-slate-400 hover:text-white" onClick={() => { setDateFrom(""); setDateTo(""); setFilterType("all"); setFilterVehicle("all"); setPage(1); }}>
                      Reset Filter
                    </Button>
                  )}
                </div>
              </CardContent>
            </Card>

            {/* Highlight Notice */}
            <div className="flex items-center gap-2 text-xs text-amber-400 bg-amber-900/20 border border-amber-700/30 rounded-lg px-4 py-2">
              <AlertTriangle className="w-4 h-4 shrink-0" />
              Pengeluaran di atas <strong className="mx-1">{fmtIdr(HIGHLIGHT_THRESHOLD)}</strong> ditandai dengan latar kuning.
            </div>

            {/* Table */}
            <Card className="bg-slate-800/60 border-slate-700">
              <CardHeader className="pb-2">
                <CardTitle className="text-white text-base flex items-center justify-between">
                  <span>Daftar Pengeluaran</span>
                  <span className="text-slate-400 text-sm font-normal">{total} record</span>
                </CardTitle>
              </CardHeader>
              <CardContent className="p-0">
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="border-b border-slate-700 bg-slate-900/40">
                        <th className="text-left px-4 py-3 text-slate-400 font-medium">Tanggal</th>
                        <th className="text-left px-4 py-3 text-slate-400 font-medium">Jenis</th>
                        <th className="text-left px-4 py-3 text-slate-400 font-medium">Kendaraan</th>
                        <th className="text-left px-4 py-3 text-slate-400 font-medium">Deskripsi</th>
                        <th className="text-right px-4 py-3 text-slate-400 font-medium">Nominal</th>
                        <th className="text-left px-4 py-3 text-slate-400 font-medium">Dibuat Oleh</th>
                        <th className="text-center px-4 py-3 text-slate-400 font-medium w-24">Aksi</th>
                      </tr>
                    </thead>
                    <tbody>
                      {expLoading ? (
                        Array.from({ length: 8 }).map((_, i) => (
                          <tr key={i} className="border-b border-slate-700/50">
                            <td colSpan={7} className="px-4 py-3"><div className="h-4 bg-slate-700 rounded animate-pulse" /></td>
                          </tr>
                        ))
                      ) : expenses.length === 0 ? (
                        <tr>
                          <td colSpan={7} className="px-4 py-12 text-center text-slate-500">
                            Belum ada pengeluaran. Klik "Tambah Pengeluaran" untuk mulai.
                          </td>
                        </tr>
                      ) : (
                        expenses.map((exp) => {
                          const amount = parseFloat(String(exp.amount)) || 0;
                          const isHigh = amount >= HIGHLIGHT_THRESHOLD;
                          return (
                            <tr key={exp.id} className={`border-b border-slate-700/50 hover:bg-slate-700/30 transition-colors ${isHigh ? "bg-amber-900/10" : ""}`}>
                              <td className="px-4 py-3 text-slate-300 whitespace-nowrap">{fmtDate(exp.expense_date)}</td>
                              <td className="px-4 py-3">
                                <Badge className={`text-xs border ${typeBadgeClass(exp.expense_type)}`}>{exp.expense_type}</Badge>
                              </td>
                              <td className="px-4 py-3 text-slate-400 text-xs">{exp.vehicle_plate ?? "-"}</td>
                              <td className="px-4 py-3 text-slate-400 max-w-xs truncate">{exp.description || "-"}</td>
                              <td className="px-4 py-3 text-right whitespace-nowrap">
                                <span className={`font-semibold ${isHigh ? "text-amber-400" : "text-emerald-400"}`}>{fmtIdr(exp.amount)}</span>
                                {isHigh && <AlertTriangle className="inline w-3 h-3 ml-1 text-amber-400" />}
                              </td>
                              <td className="px-4 py-3 text-slate-500 text-xs">{exp.created_by || "-"}</td>
                              <td className="px-4 py-3">
                                <div className="flex items-center justify-center gap-1">
                                  <Button variant="ghost" size="icon" className="h-7 w-7 text-slate-400 hover:text-white hover:bg-slate-700" onClick={() => openEdit(exp)}>
                                    <Edit2 className="w-3.5 h-3.5" />
                                  </Button>
                                  <Button variant="ghost" size="icon" className="h-7 w-7 text-slate-400 hover:text-red-400 hover:bg-red-900/30" onClick={() => setDeleteConfirm(exp)}>
                                    <Trash2 className="w-3.5 h-3.5" />
                                  </Button>
                                </div>
                              </td>
                            </tr>
                          );
                        })
                      )}
                    </tbody>
                  </table>
                </div>
                {totalPages > 1 && (
                  <div className="flex items-center justify-between px-4 py-3 border-t border-slate-700">
                    <span className="text-xs text-slate-400">Hal {page} / {totalPages} — {total} total</span>
                    <div className="flex gap-2">
                      <Button variant="outline" size="sm" className="border-slate-600 text-slate-300 hover:bg-slate-700" disabled={page <= 1} onClick={() => setPage(p => p - 1)}>Sebelumnya</Button>
                      <Button variant="outline" size="sm" className="border-slate-600 text-slate-300 hover:bg-slate-700" disabled={page >= totalPages} onClick={() => setPage(p => p + 1)}>Berikutnya</Button>
                    </div>
                  </div>
                )}
              </CardContent>
            </Card>
          </>
        )}

        {/* ── TAB: BUDGET ────────────────────────────────────────────────────── */}
        {activeTab === "budget" && (
          <>
            {/* Month Picker + Summary */}
            <div className="flex flex-wrap items-end gap-4">
              <div className="flex flex-col gap-1">
                <Label className="text-slate-400 text-xs">Bulan Anggaran</Label>
                <div className="flex gap-1.5">
                  <select className="h-10 rounded-md border border-slate-600 bg-slate-700 text-white px-3 py-2 text-sm"
                    value={budgetMonth ? budgetMonth.slice(5, 7) : ""}
                    onChange={(e) => { const y = budgetMonth ? budgetMonth.slice(0, 4) : String(new Date().getFullYear()); setBudgetMonth(`${y}-${e.target.value}`); }}>
                    <option value="">Bulan</option>
                    {["01","02","03","04","05","06","07","08","09","10","11","12"].map((m, i) => (
                      <option key={m} value={m}>{["Jan","Feb","Mar","Apr","Mei","Jun","Jul","Agu","Sep","Okt","Nov","Des"][i]}</option>
                    ))}
                  </select>
                  <select className="h-10 rounded-md border border-slate-600 bg-slate-700 text-white px-3 py-2 text-sm w-[80px]"
                    value={budgetMonth ? budgetMonth.slice(0, 4) : ""}
                    onChange={(e) => { const m = budgetMonth ? budgetMonth.slice(5, 7) : "01"; setBudgetMonth(`${e.target.value}-${m}`); }}>
                    <option value="">Tahun</option>
                    {Array.from({ length: 6 }, (_, i) => String(new Date().getFullYear() - 2 + i)).map((y) => (
                      <option key={y} value={y}>{y}</option>
                    ))}
                  </select>
                </div>
              </div>
              {bSummary && (
                <div className="flex gap-3 flex-wrap">
                  <div className="bg-slate-800/60 border border-slate-700 rounded-lg px-4 py-2 text-center">
                    <div className="text-xs text-slate-400">Total Anggaran</div>
                    <div className="text-sm font-bold text-white">{fmtIdr(bSummary.total_budget)}</div>
                  </div>
                  <div className="bg-slate-800/60 border border-slate-700 rounded-lg px-4 py-2 text-center">
                    <div className="text-xs text-slate-400">Total Realisasi</div>
                    <div className={`text-sm font-bold ${bSummary.total_actual > bSummary.total_budget && bSummary.total_budget > 0 ? "text-red-400" : "text-emerald-400"}`}>
                      {fmtIdr(bSummary.total_actual)}
                    </div>
                  </div>
                  {bSummary.over_count > 0 && (
                    <div className="bg-red-900/30 border border-red-700/50 rounded-lg px-4 py-2 flex items-center gap-2">
                      <XCircle className="w-4 h-4 text-red-400 shrink-0" />
                      <div>
                        <div className="text-xs text-red-300">Melewati Anggaran</div>
                        <div className="text-sm font-bold text-red-400">{bSummary.over_count} jenis</div>
                      </div>
                    </div>
                  )}
                  {bSummary.warning_count > 0 && (
                    <div className="bg-amber-900/30 border border-amber-700/50 rounded-lg px-4 py-2 flex items-center gap-2">
                      <AlertTriangle className="w-4 h-4 text-amber-400 shrink-0" />
                      <div>
                        <div className="text-xs text-amber-300">Mendekati Batas</div>
                        <div className="text-sm font-bold text-amber-400">{bSummary.warning_count} jenis</div>
                      </div>
                    </div>
                  )}
                  {bSummary.over_count === 0 && bSummary.warning_count === 0 && bSummary.total_budget > 0 && (
                    <div className="bg-emerald-900/30 border border-emerald-700/50 rounded-lg px-4 py-2 flex items-center gap-2">
                      <CheckCircle2 className="w-4 h-4 text-emerald-400" />
                      <span className="text-xs text-emerald-300 font-medium">Semua dalam anggaran</span>
                    </div>
                  )}
                </div>
              )}
            </div>

            {/* Budget Table */}
            <Card className="bg-slate-800/60 border-slate-700">
              <CardHeader className="pb-2">
                <CardTitle className="text-white text-base flex items-center gap-2">
                  <Target className="w-4 h-4 text-orange-400" />
                  Anggaran per Jenis Pengeluaran — {budgetMonth}
                </CardTitle>
              </CardHeader>
              <CardContent className="p-0">
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="border-b border-slate-700 bg-slate-900/40">
                        <th className="text-left px-4 py-3 text-slate-400 font-medium">Jenis</th>
                        <th className="text-right px-4 py-3 text-slate-400 font-medium">Anggaran</th>
                        <th className="text-right px-4 py-3 text-slate-400 font-medium">Realisasi</th>
                        <th className="text-right px-4 py-3 text-slate-400 font-medium">Sisa</th>
                        <th className="px-4 py-3 text-slate-400 font-medium w-48">Progress</th>
                        <th className="text-center px-4 py-3 text-slate-400 font-medium w-24">Aksi</th>
                      </tr>
                    </thead>
                    <tbody>
                      {budgetLoading ? (
                        Array.from({ length: 10 }).map((_, i) => (
                          <tr key={i} className="border-b border-slate-700/50">
                            <td colSpan={6} className="px-4 py-3"><div className="h-4 bg-slate-700 rounded animate-pulse" /></td>
                          </tr>
                        ))
                      ) : (
                        budgets.map((row) => {
                          const sisa = row.budget_amount > 0 ? row.budget_amount - row.actual_amount : null;
                          const statusColor = row.is_over ? "text-red-400" : row.is_warning ? "text-amber-400" : "text-emerald-400";
                          return (
                            <tr key={row.expense_type} className={`border-b border-slate-700/50 hover:bg-slate-700/20 transition-colors ${row.is_over ? "bg-red-900/10" : row.is_warning ? "bg-amber-900/10" : ""}`}>
                              <td className="px-4 py-3">
                                <div className="flex items-center gap-2">
                                  <Badge className={`text-xs border ${typeBadgeClass(row.expense_type)}`}>{row.expense_type}</Badge>
                                  {row.is_over && <XCircle className="w-3.5 h-3.5 text-red-400 shrink-0" />}
                                  {row.is_warning && <AlertTriangle className="w-3.5 h-3.5 text-amber-400 shrink-0" />}
                                </div>
                                {row.tx_count > 0 && <div className="text-xs text-slate-500 mt-0.5">{row.tx_count} transaksi</div>}
                              </td>
                              <td className="px-4 py-3 text-right">
                                {row.has_budget ? (
                                  <span className="text-slate-300 font-medium">{fmtIdr(row.budget_amount)}</span>
                                ) : (
                                  <span className="text-slate-600 italic text-xs">Belum diset</span>
                                )}
                              </td>
                              <td className="px-4 py-3 text-right">
                                {row.actual_amount > 0 ? (
                                  <span className={`font-medium ${statusColor}`}>{fmtIdr(row.actual_amount)}</span>
                                ) : (
                                  <span className="text-slate-600">—</span>
                                )}
                              </td>
                              <td className="px-4 py-3 text-right">
                                {sisa !== null ? (
                                  <span className={`font-medium ${sisa < 0 ? "text-red-400" : "text-slate-300"}`}>
                                    {sisa < 0 ? `−${fmtIdr(Math.abs(sisa))}` : fmtIdr(sisa)}
                                  </span>
                                ) : (
                                  <span className="text-slate-600">—</span>
                                )}
                              </td>
                              <td className="px-4 py-3">
                                {row.has_budget ? (
                                  <div className="space-y-1">
                                    <ProgressBar pct={row.pct_used} isOver={row.is_over} isWarning={row.is_warning} />
                                    <div className="text-xs text-right text-slate-400">{row.pct_used ?? 0}%</div>
                                  </div>
                                ) : (
                                  <div className="text-xs text-slate-600 italic">—</div>
                                )}
                              </td>
                              <td className="px-4 py-3">
                                <div className="flex items-center justify-center gap-1">
                                  <Button
                                    variant="ghost" size="sm"
                                    className="h-7 px-2 text-xs text-slate-400 hover:text-white hover:bg-slate-700"
                                    onClick={() => setBudgetModal({ type: row.expense_type, id: row.id, amount: row.budget_amount > 0 ? String(row.budget_amount) : "" })}
                                  >
                                    {row.has_budget ? <Edit2 className="w-3 h-3" /> : <PlusCircle className="w-3 h-3" />}
                                    <span className="ml-1">{row.has_budget ? "Ubah" : "Set"}</span>
                                  </Button>
                                  {row.has_budget && row.id !== null && (
                                    <Button
                                      variant="ghost" size="icon"
                                      className="h-7 w-7 text-slate-600 hover:text-red-400 hover:bg-red-900/30"
                                      onClick={() => setDeleteBudgetId(row.id!)}
                                    >
                                      <Trash2 className="w-3 h-3" />
                                    </Button>
                                  )}
                                </div>
                              </td>
                            </tr>
                          );
                        })
                      )}
                    </tbody>
                  </table>
                </div>
                <div className="px-4 py-3 border-t border-slate-700 text-xs text-slate-500">
                  💡 Warna <span className="text-amber-400 font-medium">kuning</span> = 80–99% terpakai &nbsp;|&nbsp; <span className="text-red-400 font-medium">merah</span> = melebihi anggaran
                </div>
              </CardContent>
            </Card>
          </>
        )}

        {/* ── Modal: Add/Edit Expense ─────────────────────────────────────────── */}
        <Dialog open={modalOpen} onOpenChange={(open) => { if (!open) closeExpModal(); }}>
          <DialogContent className="bg-slate-900 border-slate-700 text-white max-w-md">
            <DialogHeader>
              <DialogTitle className="text-white">{editing ? "Edit Pengeluaran" : "Tambah Pengeluaran Baru"}</DialogTitle>
            </DialogHeader>
            <div className="space-y-4 pt-2">
              <div className="space-y-1.5">
                <Label className="text-slate-300">Tanggal <span className="text-red-400">*</span></Label>
                <DatePicker value={form.expense_date} onChange={(v) => setForm(f => ({ ...f, expense_date: v }))} className="bg-slate-800 border-slate-600 text-white" />
              </div>
              <div className="space-y-1.5">
                <Label className="text-slate-300">Jenis Pengeluaran <span className="text-red-400">*</span></Label>
                <Select value={form.expense_type} onValueChange={(v) => setForm(f => ({ ...f, expense_type: v }))}>
                  <SelectTrigger className="bg-slate-800 border-slate-600 text-white">
                    <SelectValue placeholder="Pilih jenis..." />
                  </SelectTrigger>
                  <SelectContent>
                    {EXPENSE_TYPES.map((t) => <SelectItem key={t} value={t}>{t}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
              {vehicles.length > 0 && (
                <div className="space-y-1.5">
                  <Label className="text-slate-300">Kendaraan <span className="text-slate-500 text-xs">(opsional)</span></Label>
                  <Select value={form.vehicle_id || "none"} onValueChange={(v) => setForm(f => ({ ...f, vehicle_id: v === "none" ? "" : v }))}>
                    <SelectTrigger className="bg-slate-800 border-slate-600 text-white">
                      <SelectValue placeholder="Pilih kendaraan..." />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="none">— Tidak terkait kendaraan —</SelectItem>
                      {vehicles.map((v) => <SelectItem key={v.id} value={String(v.id)}>{v.plate} ({v.vehicle_type})</SelectItem>)}
                    </SelectContent>
                  </Select>
                </div>
              )}
              <div className="space-y-1.5">
                <Label className="text-slate-300">Deskripsi <span className="text-slate-500 text-xs">(opsional)</span></Label>
                <Textarea value={form.description} onChange={(e) => setForm(f => ({ ...f, description: e.target.value }))} placeholder="Misal: Ganti ban depan merk Michelin..." className="bg-slate-800 border-slate-600 text-white resize-none" rows={2} />
              </div>
              <div className="space-y-1.5">
                <Label className="text-slate-300">Nominal (Rp) <span className="text-red-400">*</span></Label>
                <Input type="number" min="1" step="1000" value={form.amount} onChange={(e) => setForm(f => ({ ...f, amount: e.target.value }))} placeholder="500000" className="bg-slate-800 border-slate-600 text-white" />
                {form.amount && parseFloat(form.amount) > 0 && <p className="text-xs text-slate-400">{fmtIdr(parseFloat(form.amount))}</p>}
              </div>
              <div className="flex justify-end gap-2 pt-2">
                <Button variant="outline" className="border-slate-600 text-slate-300 hover:bg-slate-700" onClick={closeExpModal}>Batal</Button>
                <Button className="bg-orange-600 hover:bg-orange-700" onClick={handleSave} disabled={saveMutation.isPending}>
                  {saveMutation.isPending ? "Menyimpan..." : editing ? "Simpan Perubahan" : "Simpan"}
                </Button>
              </div>
            </div>
          </DialogContent>
        </Dialog>

        {/* ── Modal: Delete Expense ───────────────────────────────────────────── */}
        <Dialog open={!!deleteConfirm} onOpenChange={(open) => { if (!open) setDeleteConfirm(null); }}>
          <DialogContent className="bg-slate-900 border-slate-700 text-white max-w-sm">
            <DialogHeader>
              <DialogTitle className="text-white flex items-center gap-2">
                <Trash2 className="w-5 h-5 text-red-400" /> Hapus Pengeluaran
              </DialogTitle>
            </DialogHeader>
            <div className="space-y-4">
              <p className="text-slate-300 text-sm">Apakah Anda yakin ingin menghapus pengeluaran ini?</p>
              {deleteConfirm && (
                <div className="bg-slate-800 rounded-lg p-3 text-sm space-y-1">
                  <div className="flex justify-between"><span className="text-slate-400">Tanggal:</span><span className="text-white">{fmtDate(deleteConfirm.expense_date)}</span></div>
                  <div className="flex justify-between"><span className="text-slate-400">Jenis:</span><span className="text-white">{deleteConfirm.expense_type}</span></div>
                  <div className="flex justify-between"><span className="text-slate-400">Nominal:</span><span className="text-red-400 font-semibold">{fmtIdr(deleteConfirm.amount)}</span></div>
                </div>
              )}
              <div className="flex justify-end gap-2">
                <Button variant="outline" className="border-slate-600 text-slate-300 hover:bg-slate-700" onClick={() => setDeleteConfirm(null)}>Batal</Button>
                <Button className="bg-red-600 hover:bg-red-700" onClick={() => deleteConfirm && deleteMutation.mutate(deleteConfirm.id)} disabled={deleteMutation.isPending}>
                  {deleteMutation.isPending ? "Menghapus..." : "Ya, Hapus"}
                </Button>
              </div>
            </div>
          </DialogContent>
        </Dialog>

        {/* ── Modal: Set Budget ───────────────────────────────────────────────── */}
        <Dialog open={!!budgetModal} onOpenChange={(open) => { if (!open) setBudgetModal(null); }}>
          <DialogContent className="bg-slate-900 border-slate-700 text-white max-w-sm">
            <DialogHeader>
              <DialogTitle className="text-white flex items-center gap-2">
                <Target className="w-5 h-5 text-orange-400" />
                {budgetModal?.id ? "Ubah Anggaran" : "Set Anggaran"}
              </DialogTitle>
            </DialogHeader>
            <div className="space-y-4">
              <div className="bg-slate-800 rounded-lg p-3 text-sm space-y-1">
                <div className="flex justify-between"><span className="text-slate-400">Jenis:</span><span className="text-white font-medium">{budgetModal?.type}</span></div>
                <div className="flex justify-between"><span className="text-slate-400">Bulan:</span><span className="text-white">{budgetMonth}</span></div>
              </div>
              <div className="space-y-1.5">
                <Label className="text-slate-300">Nominal Anggaran (Rp) <span className="text-red-400">*</span></Label>
                <Input
                  type="number" min="1" step="100000"
                  value={budgetModal?.amount ?? ""}
                  onChange={(e) => setBudgetModal(b => b ? { ...b, amount: e.target.value } : null)}
                  placeholder="5000000"
                  className="bg-slate-800 border-slate-600 text-white"
                />
                {budgetModal?.amount && parseFloat(budgetModal.amount) > 0 && (
                  <p className="text-xs text-slate-400">{fmtIdr(parseFloat(budgetModal.amount))}</p>
                )}
              </div>
              <div className="flex justify-end gap-2">
                <Button variant="outline" className="border-slate-600 text-slate-300 hover:bg-slate-700" onClick={() => setBudgetModal(null)}>Batal</Button>
                <Button className="bg-orange-600 hover:bg-orange-700" onClick={handleSaveBudget} disabled={saveBudgetMutation.isPending}>
                  {saveBudgetMutation.isPending ? "Menyimpan..." : "Simpan Anggaran"}
                </Button>
              </div>
            </div>
          </DialogContent>
        </Dialog>

        {/* ── Modal: Delete Budget ────────────────────────────────────────────── */}
        <Dialog open={deleteBudgetId !== null} onOpenChange={(open) => { if (!open) setDeleteBudgetId(null); }}>
          <DialogContent className="bg-slate-900 border-slate-700 text-white max-w-sm">
            <DialogHeader>
              <DialogTitle className="text-white flex items-center gap-2">
                <Trash2 className="w-5 h-5 text-red-400" /> Hapus Anggaran
              </DialogTitle>
            </DialogHeader>
            <div className="space-y-4">
              <p className="text-slate-300 text-sm">Anggaran untuk bulan ini akan dihapus. Transaksi tidak terpengaruh.</p>
              <div className="flex justify-end gap-2">
                <Button variant="outline" className="border-slate-600 text-slate-300 hover:bg-slate-700" onClick={() => setDeleteBudgetId(null)}>Batal</Button>
                <Button className="bg-red-600 hover:bg-red-700" onClick={() => deleteBudgetId !== null && deleteBudgetMutation.mutate(deleteBudgetId)} disabled={deleteBudgetMutation.isPending}>
                  {deleteBudgetMutation.isPending ? "Menghapus..." : "Ya, Hapus"}
                </Button>
              </div>
            </div>
          </DialogContent>
        </Dialog>
      </div>
    </AppShell>
  );
}
