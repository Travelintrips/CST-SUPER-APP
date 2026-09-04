/**
 * Advance Management — Unified Advance Engine
 * Menggantikan Kasbon (Employee Advance) dan Dana Talangan (Vendor/Operational Advance)
 * dengan satu halaman yang mendukung 8 tipe advance dan lifecycle penuh.
 */
import { useState, useEffect, useCallback, useMemo } from "react";
import { useCompany } from "@/contexts/CompanyContext";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Textarea } from "@/components/ui/textarea";
import {
  Plus, RefreshCw, Filter, ChevronRight, X, TrendingDown,
  Clock, CheckCircle2, AlertTriangle, ArrowUpRight,
  Wallet, Users, Building2, Globe, ShoppingCart, Plane, Settings, HelpCircle, ArrowLeft,
  CalendarClock, CalendarCheck, Banknote, Trash2,
} from "lucide-react";
import { toast } from "@/hooks/use-toast";

// ─── Types ────────────────────────────────────────────────────────────────────
const ADVANCE_TYPES = [
  { value: "EMPLOYEE",    label: "Kasbon Karyawan",       icon: Users,        color: "bg-blue-100 text-blue-800" },
  { value: "VENDOR",      label: "Uang Muka Vendor",      icon: Building2,    color: "bg-purple-100 text-purple-800" },
  { value: "CUSTOMER",    label: "Uang Muka Pelanggan",   icon: Globe,        color: "bg-green-100 text-green-800" },
  { value: "PROJECT",     label: "Dana Proyek",           icon: Settings,     color: "bg-orange-100 text-orange-800" },
  { value: "PURCHASE",    label: "Uang Muka Pembelian",   icon: ShoppingCart, color: "bg-yellow-100 text-yellow-800" },
  { value: "TRAVEL",      label: "Dana Perjalanan",       icon: Plane,        color: "bg-sky-100 text-sky-800" },
  { value: "OPERATIONAL", label: "Dana Talangan",         icon: Wallet,       color: "bg-indigo-100 text-indigo-800" },
  { value: "OTHER",       label: "Lainnya",               icon: HelpCircle,   color: "bg-gray-100 text-gray-800" },
] as const;

const LIFECYCLE_STATUSES = [
  { value: "draft",              label: "Draft",            color: "bg-gray-100 text-gray-600" },
  { value: "pending_approval",   label: "Menunggu Approval",color: "bg-yellow-100 text-yellow-800" },
  { value: "approved",           label: "Disetujui",        color: "bg-blue-100 text-blue-800" },
  { value: "disbursed",          label: "Dicairkan",        color: "bg-cyan-100 text-cyan-800" },
  { value: "outstanding",        label: "Outstanding",      color: "bg-orange-100 text-orange-800" },
  { value: "partially_settled",  label: "Sebagian Lunas",   color: "bg-purple-100 text-purple-800" },
  { value: "settled",            label: "Lunas",            color: "bg-green-100 text-green-800" },
  { value: "closed",             label: "Selesai",          color: "bg-emerald-100 text-emerald-800" },
  { value: "void",               label: "Dibatalkan",       color: "bg-red-100 text-red-800" },
] as const;

const ALLOCATION_TYPES = [
  { value: "ADVANCE_PRINCIPAL", label: "Pokok Advance" },
  { value: "SALES_INVOICE",     label: "Invoice Penjualan" },
  { value: "DIRECT_REVENUE",    label: "Pendapatan Langsung" },
  { value: "CUSTOMER_DEPOSIT",  label: "Deposit Pelanggan" },
  { value: "OTHER_RECEIVABLE",  label: "Piutang Lain" },
  { value: "ROUNDING",          label: "Selisih Pembulatan" },
  { value: "OTHER",             label: "Lainnya" },
] as const;

type AdvanceType   = typeof ADVANCE_TYPES[number]["value"];
type LifecycleStatus = typeof LIFECYCLE_STATUSES[number]["value"];
type AllocationType  = typeof ALLOCATION_TYPES[number]["value"];

interface Advance {
  id: number;
  advance_number: string;
  advance_type: AdvanceType;
  lifecycle_status: LifecycleStatus;
  party_name: string;
  amount: number;
  remaining_amount: number;
  settled_amount: number;
  date: string;
  purpose: string | null;
  notes: string | null;
  receivable_account_code: string | null;
  receivable_account_name: string | null;
  cash_bank_account_code: string | null;
  cash_bank_account_name: string | null;
  employee_name: string | null;
  vendor_name: string | null;
  department_name: string | null;
  entry_id: number | null;
  // Company & intercompany fields
  company_id?: number | null;
  company_name?: string | null;
  source_company_name?: string | null;
  responsible_company_id?: number | null;
  responsible_company_name?: string | null;
  responsible_party_name?: string | null;
  responsible_party_type?: string | null;
  receivable_account_id?: number | null;
  cash_bank_account_id?: number | null;
  settlements?: any[];
  repayments?: any[];
  installment_schedule?: any[];
}

interface CoaAccount { id: number; code: string; name: string; type: string; }

interface AllocationLine {
  allocation_type: AllocationType;
  coa_id: number | null;
  reference_doc_id: number | null;
  reference_doc_type: string | null;
  amount: string;
  remarks: string;
}

// ─── Helpers ──────────────────────────────────────────────────────────────────
const IDR = (n: number) => new Intl.NumberFormat("id-ID", { style: "currency", currency: "IDR", maximumFractionDigits: 0 }).format(n);
const dateStr = (s: string) => s ? new Date(s).toLocaleDateString("id-ID", { day: "2-digit", month: "short", year: "numeric" }) : "-";

function getTypeInfo(type: string) {
  return ADVANCE_TYPES.find(t => t.value === type) ?? ADVANCE_TYPES[ADVANCE_TYPES.length - 1];
}
function getStatusInfo(status: string) {
  return LIFECYCLE_STATUSES.find(s => s.value === status) ?? { label: status, color: "bg-gray-100 text-gray-600" };
}

// ─── Main Page ────────────────────────────────────────────────────────────────
export default function AdvanceManagementPage() {
  const { activeCompanyId } = useCompany();

  // ── State ────────────────────────────────────────────────────────────────
  const [tab, setTab] = useState("list");
  const [advances, setAdvances] = useState<Advance[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(false);
  const [dashboard, setDashboard] = useState<any>(null);
  const [aging, setAging] = useState<any[]>([]);
  const [allAccounts, setAllAccounts] = useState<CoaAccount[]>([]);
  const [advanceAccounts, setAdvanceAccounts] = useState<CoaAccount[]>([]);
  const [bankAccounts, setBankAccounts] = useState<CoaAccount[]>([]);
  const [page, setPage] = useState(1);

  // Filters
  const [filterType, setFilterType] = useState("");
  const [filterStatus, setFilterStatus] = useState("");
  const [filterDateFrom, setFilterDateFrom] = useState("");
  const [filterDateTo, setFilterDateTo] = useState("");
  const [filterParty, setFilterParty] = useState("");

  // Dialogs
  const [createOpen, setCreateOpen] = useState(false);
  const [detailId, setDetailId] = useState<number | null>(null);
  const [detailAdv, setDetailAdv] = useState<any>(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [settleOpen, setSettleOpen] = useState(false);
  const [disburseOpen, setDisburseOpen] = useState(false);
  const [repayOpen, setRepayOpen] = useState(false);
  const [voidOpen, setVoidOpen] = useState(false);
  const [approveLoading, setApproveLoading] = useState(false);

  // ── API helpers ──────────────────────────────────────────────────────────
  const api = useCallback(async (path: string, opts?: RequestInit) => {
    const url = `/api/advances${path}`;
    const res = await fetch(url, { credentials: "include", ...opts });
    if (!res.ok) {
      const body = await res.json().catch(() => ({}));
      throw new Error(body.message ?? body.error ?? `HTTP ${res.status}`);
    }
    return res.json();
  }, []);

  const coaApi = useCallback(async (type?: string, subtype?: string) => {
    const params = new URLSearchParams();
    if (type) params.set("type", type);
    if (subtype) params.set("subtype", subtype);
    const res = await fetch(`/api/accounting/bank-disbursements/meta/accounts?${params}`, { credentials: "include" });
    if (!res.ok) return [];
    return res.json() as Promise<CoaAccount[]>;
  }, []);

  // ── Data loading ──────────────────────────────────────────────────────────
  const loadAdvances = useCallback(async () => {
    if (!activeCompanyId) return;
    setLoading(true);
    try {
      const params = new URLSearchParams({ page: String(page), limit: "50" });
      if (filterType)    params.set("advance_type", filterType);
      if (filterStatus)  params.set("lifecycle_status", filterStatus);
      if (filterDateFrom) params.set("date_from", filterDateFrom);
      if (filterDateTo)   params.set("date_to", filterDateTo);
      if (filterParty)    params.set("party_name", filterParty);
      const data = await api(`/?${params}`);
      setAdvances(data.data ?? []);
      setTotal(data.total ?? 0);
    } catch (err: any) {
      toast({ variant: "destructive", title: "Gagal memuat data", description: err?.message });
    } finally {
      setLoading(false);
    }
  }, [activeCompanyId, page, filterType, filterStatus, filterDateFrom, filterDateTo, filterParty, api]);

  const loadDashboard = useCallback(async () => {
    if (!activeCompanyId) return;
    try { const d = await api("/dashboard"); setDashboard(d); } catch {}
  }, [activeCompanyId, api]);

  const loadAging = useCallback(async () => {
    if (!activeCompanyId) return;
    try { const d = await api("/aging"); setAging(d.data ?? []); } catch {}
  }, [activeCompanyId, api]);

  const loadAccounts = useCallback(async () => {
    const [adv, bank, all] = await Promise.all([
      coaApi("asset"),
      coaApi("asset", "cash_bank"),
      coaApi(),
    ]);
    setAdvanceAccounts(adv.filter((a: CoaAccount) =>
      a.name.toLowerCase().includes("advance") ||
      a.name.toLowerCase().includes("piutang") ||
      a.name.toLowerCase().includes("uang muka") ||
      a.name.toLowerCase().includes("kasbon") ||
      a.name.toLowerCase().includes("talangan") ||
      a.name.toLowerCase().includes("deposit")
    ));
    setBankAccounts(bank);
    setAllAccounts(all);
  }, [coaApi]);

  const loadDetail = useCallback(async (id: number) => {
    setDetailLoading(true);
    try { setDetailAdv(await api(`/${id}`)); } catch (err: any) {
      toast({ variant: "destructive", title: "Gagal memuat detail", description: err?.message });
    } finally { setDetailLoading(false); }
  }, [api]);

  useEffect(() => { loadAdvances(); }, [loadAdvances]);
  useEffect(() => { loadDashboard(); loadAccounts(); }, [loadDashboard, loadAccounts]);

  useEffect(() => {
    if (tab === "aging") loadAging();
  }, [tab, loadAging]);

  useEffect(() => {
    if (detailId != null) loadDetail(detailId);
  }, [detailId, loadDetail]);

  // ── Stats totals ──────────────────────────────────────────────────────────
  const stats = dashboard?.stats ?? {};

  return (
    <div className="p-4 space-y-4 max-w-full overflow-x-hidden">
      {/* Header */}
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div className="flex items-center gap-3">
          <button
            onClick={() => window.history.back()}
            aria-label="Kembali"
            className="rounded-md p-1.5 text-slate-400 hover:text-slate-700 hover:bg-slate-100 transition-colors"
          >
            <ArrowLeft size={18} />
          </button>
          <div>
            <h1 className="text-2xl font-bold text-slate-900">Advance Management</h1>
            <p className="text-sm text-slate-500 mt-0.5">Kelola semua jenis advance — kasbon, talangan, uang muka, dan lainnya</p>
          </div>
        </div>
        <Button onClick={() => setCreateOpen(true)} className="gap-2">
          <Plus className="w-4 h-4" /> Buat Advance
        </Button>
      </div>

      {/* Stats cards */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        <StatCard icon={<Wallet className="w-5 h-5 text-orange-600" />} bg="bg-orange-50"
          label="Total Outstanding" value={IDR(Number(stats.outstanding_amount ?? 0))} sub={`${stats.outstanding_count ?? 0} advance`} />
        <StatCard icon={<Clock className="w-5 h-5 text-yellow-600" />} bg="bg-yellow-50"
          label="Menunggu Approval" value={String(stats.pending_count ?? 0)} sub="advance" />
        <StatCard icon={<CheckCircle2 className="w-5 h-5 text-green-600" />} bg="bg-green-50"
          label="Total Dilunasi" value={IDR(Number(stats.total_settled ?? 0))} sub="kumulatif" />
        <StatCard icon={<TrendingDown className="w-5 h-5 text-blue-600" />} bg="bg-blue-50"
          label="Sisa Terhutang" value={IDR(Number(stats.total_remaining ?? 0))} sub="dari outstanding" />
      </div>

      {/* Tabs */}
      <Tabs value={tab} onValueChange={setTab}>
        <TabsList className="h-9">
          <TabsTrigger value="list" className="text-xs">Daftar Advance</TabsTrigger>
          <TabsTrigger value="aging" className="text-xs">Laporan Aging</TabsTrigger>
          <TabsTrigger value="by_type" className="text-xs">Rekapitulasi</TabsTrigger>
        </TabsList>

        {/* ── LIST TAB ──────────────────────────────────────────────────── */}
        <TabsContent value="list" className="space-y-3">
          {/* Filter bar */}
          <div className="flex flex-wrap gap-2 items-end">
            <div>
              <Label className="text-[11px] text-slate-500 mb-1 block">Tipe</Label>
              <Select value={filterType} onValueChange={v => { setFilterType(v === "__all__" ? "" : v); setPage(1); }}>
                <SelectTrigger className="h-8 text-xs w-36"><SelectValue placeholder="Semua tipe" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="__all__">Semua tipe</SelectItem>
                  {ADVANCE_TYPES.map(t => <SelectItem key={t.value} value={t.value}>{t.label}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label className="text-[11px] text-slate-500 mb-1 block">Status</Label>
              <Select value={filterStatus} onValueChange={v => { setFilterStatus(v === "__all__" ? "" : v); setPage(1); }}>
                <SelectTrigger className="h-8 text-xs w-40"><SelectValue placeholder="Semua status" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="__all__">Semua status</SelectItem>
                  {LIFECYCLE_STATUSES.map(s => <SelectItem key={s.value} value={s.value}>{s.label}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label className="text-[11px] text-slate-500 mb-1 block">Dari</Label>
              <Input type="date" className="h-8 text-xs w-36" value={filterDateFrom} onChange={e => { setFilterDateFrom(e.target.value); setPage(1); }} />
            </div>
            <div>
              <Label className="text-[11px] text-slate-500 mb-1 block">Sampai</Label>
              <Input type="date" className="h-8 text-xs w-36" value={filterDateTo} onChange={e => { setFilterDateTo(e.target.value); setPage(1); }} />
            </div>
            <div>
              <Label className="text-[11px] text-slate-500 mb-1 block">Penerima</Label>
              <Input className="h-8 text-xs w-36" placeholder="Cari nama..." value={filterParty}
                onChange={e => { setFilterParty(e.target.value); setPage(1); }} />
            </div>
            <Button variant="outline" size="sm" className="h-8 gap-1" onClick={loadAdvances}>
              <RefreshCw className="w-3 h-3" />
            </Button>
            {(filterType || filterStatus || filterDateFrom || filterDateTo || filterParty) && (
              <Button variant="ghost" size="sm" className="h-8 text-xs gap-1" onClick={() => {
                setFilterType(""); setFilterStatus(""); setFilterDateFrom(""); setFilterDateTo(""); setFilterParty(""); setPage(1);
              }}><X className="w-3 h-3" /> Reset</Button>
            )}
          </div>

          {/* Table */}
          <div className="border rounded-lg overflow-auto">
            <Table>
              <TableHeader>
                <TableRow className="bg-slate-50">
                  <TableHead className="text-xs font-semibold">Nomor</TableHead>
                  <TableHead className="text-xs font-semibold">Tipe</TableHead>
                  <TableHead className="text-xs font-semibold">Penerima</TableHead>
                  <TableHead className="text-xs font-semibold">Tanggal</TableHead>
                  <TableHead className="text-xs font-semibold text-right">Jumlah</TableHead>
                  <TableHead className="text-xs font-semibold text-right">Sisa</TableHead>
                  <TableHead className="text-xs font-semibold">Status</TableHead>
                  <TableHead className="text-xs font-semibold"></TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {loading && (
                  <TableRow><TableCell colSpan={8} className="text-center py-8 text-slate-400 text-sm">Memuat data…</TableCell></TableRow>
                )}
                {!loading && advances.length === 0 && (
                  <TableRow><TableCell colSpan={8} className="text-center py-12 text-slate-400 text-sm">
                    <Wallet className="w-8 h-8 mx-auto mb-2 opacity-30" />
                    <p>Belum ada advance</p>
                    <Button className="mt-3 text-xs h-8" size="sm" onClick={() => setCreateOpen(true)}>
                      <Plus className="w-3 h-3 mr-1" /> Buat Advance Pertama
                    </Button>
                  </TableCell></TableRow>
                )}
                {advances.map(adv => {
                  const typeInfo = getTypeInfo(adv.advance_type);
                  const statusInfo = getStatusInfo(adv.lifecycle_status);
                  return (
                    <TableRow key={adv.id} className="cursor-pointer hover:bg-slate-50"
                      onClick={() => { setDetailId(adv.id); }}>
                      <TableCell className="text-xs font-mono font-medium">{adv.advance_number}</TableCell>
                      <TableCell>
                        <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded text-[11px] font-medium ${typeInfo.color}`}>
                          <typeInfo.icon className="w-3 h-3" />{typeInfo.label}
                        </span>
                      </TableCell>
                      <TableCell>
                        <div className="text-xs font-medium text-slate-900">{adv.party_name}</div>
                        {adv.employee_name && <div className="text-[10px] text-slate-400">{adv.employee_name}</div>}
                        {adv.vendor_name && <div className="text-[10px] text-slate-400">{adv.vendor_name}</div>}
                      </TableCell>
                      <TableCell className="text-xs text-slate-600">{dateStr(adv.date)}</TableCell>
                      <TableCell className="text-xs text-right font-mono">{IDR(adv.amount)}</TableCell>
                      <TableCell className="text-xs text-right font-mono font-semibold">
                        {adv.remaining_amount > 0 ? <span className="text-orange-700">{IDR(adv.remaining_amount)}</span> : <span className="text-green-600">Lunas</span>}
                      </TableCell>
                      <TableCell>
                        <span className={`inline-block px-2 py-0.5 rounded text-[11px] font-medium ${statusInfo.color}`}>{statusInfo.label}</span>
                      </TableCell>
                      <TableCell>
                        <ChevronRight className="w-4 h-4 text-slate-400" />
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          </div>

          {/* Pagination */}
          {total > 50 && (
            <div className="flex items-center justify-between text-xs text-slate-500">
              <span>{total} total advance</span>
              <div className="flex gap-2">
                <Button variant="outline" size="sm" className="h-7 text-xs" disabled={page <= 1} onClick={() => setPage(p => p - 1)}>←</Button>
                <span className="px-2 py-1">Halaman {page}</span>
                <Button variant="outline" size="sm" className="h-7 text-xs" disabled={advances.length < 50} onClick={() => setPage(p => p + 1)}>→</Button>
              </div>
            </div>
          )}
        </TabsContent>

        {/* ── AGING TAB ──────────────────────────────────────────────────── */}
        <TabsContent value="aging" className="space-y-3">
          <div className="flex justify-between items-center">
            <h3 className="text-sm font-semibold text-slate-700">Aging Report — Outstanding Advances</h3>
            <Button variant="outline" size="sm" className="h-8 text-xs" onClick={loadAging}><RefreshCw className="w-3 h-3 mr-1" />Refresh</Button>
          </div>
          <div className="border rounded-lg overflow-auto">
            <Table>
              <TableHeader>
                <TableRow className="bg-slate-50">
                  <TableHead className="text-xs font-semibold">Advance</TableHead>
                  <TableHead className="text-xs font-semibold">Penerima</TableHead>
                  <TableHead className="text-xs font-semibold">Tanggal</TableHead>
                  <TableHead className="text-xs font-semibold text-right">Sisa</TableHead>
                  <TableHead className="text-xs font-semibold">Bucket</TableHead>
                  <TableHead className="text-xs font-semibold text-right">Umur (Hari)</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {aging.length === 0 && (
                  <TableRow><TableCell colSpan={6} className="text-center py-8 text-slate-400 text-sm">
                    <CheckCircle2 className="w-8 h-8 mx-auto mb-2 opacity-30" />
                    Tidak ada advance yang outstanding
                  </TableCell></TableRow>
                )}
                {aging.map((row: any) => (
                  <TableRow key={row.id} className="cursor-pointer hover:bg-slate-50" onClick={() => setDetailId(row.id)}>
                    <TableCell className="text-xs font-mono">{row.advance_number}</TableCell>
                    <TableCell className="text-xs">{row.party_name}</TableCell>
                    <TableCell className="text-xs text-slate-500">{dateStr(row.date)}</TableCell>
                    <TableCell className="text-xs text-right font-mono text-orange-700 font-semibold">{IDR(Number(row.remaining_amount))}</TableCell>
                    <TableCell>
                      <span className={`px-2 py-0.5 rounded text-[11px] font-medium ${
                        row.age_days > 180 ? "bg-red-100 text-red-800" :
                        row.age_days > 90  ? "bg-orange-100 text-orange-800" :
                        row.age_days > 60  ? "bg-yellow-100 text-yellow-800" :
                        "bg-green-100 text-green-800"
                      }`}>{row.aging_bucket}</span>
                    </TableCell>
                    <TableCell className="text-xs text-right font-semibold">{row.age_days}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        </TabsContent>

        {/* ── REKAPITULASI TAB ──────────────────────────────────────────── */}
        <TabsContent value="by_type" className="space-y-3">
          <h3 className="text-sm font-semibold text-slate-700">Rekapitulasi Per Tipe</h3>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
            {(dashboard?.byType ?? []).map((row: any) => {
              const info = getTypeInfo(row.advance_type);
              return (
                <Card key={row.advance_type} className="border shadow-none">
                  <CardContent className="p-4">
                    <div className="flex items-center gap-2 mb-2">
                      <span className={`p-1.5 rounded-lg ${info.color}`}><info.icon className="w-4 h-4" /></span>
                      <span className="text-xs font-semibold text-slate-700">{info.label}</span>
                    </div>
                    <p className="text-lg font-bold text-slate-900">{IDR(Number(row.remaining))}</p>
                    <p className="text-[11px] text-slate-500">{row.count} advance</p>
                  </CardContent>
                </Card>
              );
            })}
          </div>
          <div className="mt-4">
            <h4 className="text-xs font-semibold text-slate-600 mb-2">Distribusi Status</h4>
            <div className="flex flex-wrap gap-2">
              {(dashboard?.byStatus ?? []).map((row: any) => {
                const s = getStatusInfo(row.status);
                return (
                  <span key={row.status} className={`px-3 py-1 rounded-full text-xs font-medium ${s.color}`}>
                    {s.label}: {row.count}
                  </span>
                );
              })}
            </div>
          </div>
        </TabsContent>
      </Tabs>

      {/* ── DIALOGS ─────────────────────────────────────────────────────── */}
      {createOpen && (
        <CreateAdvanceDialog
          open={createOpen}
          onOpenChange={setCreateOpen}
          advanceAccounts={advanceAccounts}
          bankAccounts={bankAccounts}
          allAccounts={allAccounts}
          onCreated={() => { setCreateOpen(false); loadAdvances(); loadDashboard(); }}
          api={api}
        />
      )}

      {detailId != null && (
        <AdvanceDetailDrawer
          advance={detailAdv}
          loading={detailLoading}
          onClose={() => { setDetailId(null); setDetailAdv(null); }}
          onRefresh={() => loadDetail(detailId)}
          onListRefresh={() => { loadAdvances(); loadDashboard(); }}
          allAccounts={allAccounts}
          bankAccounts={bankAccounts}
          api={api}
        />
      )}
    </div>
  );
}

// ─── Stat Card ────────────────────────────────────────────────────────────────
function StatCard({ icon, bg, label, value, sub }: { icon: React.ReactNode; bg: string; label: string; value: string; sub: string }) {
  return (
    <Card className="border shadow-none">
      <CardContent className="p-4">
        <div className="flex items-start gap-3">
          <div className={`p-2 rounded-lg ${bg}`}>{icon}</div>
          <div className="flex-1 min-w-0">
            <p className="text-[11px] text-slate-500 truncate">{label}</p>
            <p className="text-base font-bold text-slate-900 leading-tight">{value}</p>
            <p className="text-[11px] text-slate-400">{sub}</p>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

// ─── Create Advance Dialog ────────────────────────────────────────────────────
function CreateAdvanceDialog({ open, onOpenChange, advanceAccounts, bankAccounts, allAccounts, onCreated, api }: {
  open: boolean; onOpenChange: (v: boolean) => void;
  advanceAccounts: CoaAccount[]; bankAccounts: CoaAccount[]; allAccounts: CoaAccount[];
  onCreated: () => void;
  api: (path: string, opts?: RequestInit) => Promise<any>;
}) {
  const [advType, setAdvType] = useState<AdvanceType>("EMPLOYEE");
  const [partyName, setPartyName] = useState("");
  const [amount, setAmount] = useState("");
  const [date, setDate] = useState(new Date().toISOString().slice(0, 10));
  const [purpose, setPurpose] = useState("");
  const [notes, setNotes] = useState("");
  const [recvAcctId, setRecvAcctId] = useState("");
  const [bankAcctId, setBankAcctId] = useState("");
  const [autoDisburse, setAutoDisburse] = useState(false);
  const [saving, setSaving] = useState(false);

  const recvAccounts = advanceAccounts.length > 0 ? advanceAccounts : allAccounts.filter(a => a.type === "asset");

  const handleSave = async () => {
    if (!partyName.trim()) { toast({ variant: "destructive", title: "Nama penerima wajib diisi" }); return; }
    if (!amount || Number(amount) <= 0) { toast({ variant: "destructive", title: "Jumlah harus lebih dari 0" }); return; }
    if (!date) { toast({ variant: "destructive", title: "Tanggal wajib diisi" }); return; }
    setSaving(true);
    try {
      await api("/", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          advance_type: advType, party_name: partyName, amount: Number(amount),
          date, purpose, notes,
          receivable_account_id: recvAcctId ? Number(recvAcctId) : null,
          cash_bank_account_id: bankAcctId ? Number(bankAcctId) : null,
          auto_approve: true, auto_disburse: autoDisburse,
        }),
      });
      toast({ title: "Advance berhasil dibuat" });
      onCreated();
    } catch (err: any) {
      toast({ variant: "destructive", title: "Gagal membuat advance", description: err?.message });
    } finally {
      setSaving(false);
    }
  };

  const typeInfo = getTypeInfo(advType);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="text-base">Buat Advance Baru</DialogTitle>
        </DialogHeader>
        <div className="space-y-4">
          {/* Type selector */}
          <div>
            <Label className="text-xs font-semibold text-slate-600 mb-2 block">Tipe Advance</Label>
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
              {ADVANCE_TYPES.map(t => (
                <button key={t.value} type="button"
                  onClick={() => setAdvType(t.value)}
                  className={`flex flex-col items-center gap-1 p-2 rounded-lg border text-[11px] font-medium transition-all ${
                    advType === t.value ? "border-slate-900 bg-slate-900 text-white shadow-sm" : "border-slate-200 hover:border-slate-400 text-slate-600"
                  }`}>
                  <t.icon className="w-4 h-4" />{t.label}
                </button>
              ))}
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div className="col-span-2">
              <Label className="text-xs font-medium text-slate-600 mb-1 block">Nama Penerima <span className="text-red-500">*</span></Label>
              <Input className="h-9 text-sm" placeholder="Nama karyawan / vendor / penerima…"
                value={partyName} onChange={e => setPartyName(e.target.value)} />
            </div>
            <div>
              <Label className="text-xs font-medium text-slate-600 mb-1 block">Jumlah (Rp) <span className="text-red-500">*</span></Label>
              <Input className="h-9 text-sm text-right font-mono" type="number" min="0" step="1000"
                placeholder="0" value={amount} onChange={e => setAmount(e.target.value)} />
            </div>
            <div>
              <Label className="text-xs font-medium text-slate-600 mb-1 block">Tanggal <span className="text-red-500">*</span></Label>
              <Input className="h-9 text-sm" type="date" value={date} onChange={e => setDate(e.target.value)} />
            </div>
          </div>

          <div>
            <Label className="text-xs font-medium text-slate-600 mb-1 block">Tujuan / Keperluan</Label>
            <Input className="h-9 text-sm" placeholder="Keperluan advance…" value={purpose} onChange={e => setPurpose(e.target.value)} />
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label className="text-xs font-medium text-slate-600 mb-1 block">Akun Piutang Advance (DR)</Label>
              <Select value={recvAcctId} onValueChange={setRecvAcctId}>
                <SelectTrigger className="h-9 text-xs"><SelectValue placeholder="Pilih akun…" /></SelectTrigger>
                <SelectContent>
                  {recvAccounts.map(a => (
                    <SelectItem key={a.id} value={String(a.id)}>
                      <span className="font-mono text-[10px] text-slate-400 mr-1">{a.code}</span>{a.name}
                    </SelectItem>
                  ))}
                  {recvAccounts.length === 0 && <SelectItem value="_none" disabled>Tidak ada akun advance</SelectItem>}
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label className="text-xs font-medium text-slate-600 mb-1 block">Akun Bank/Kas (CR)</Label>
              <Select value={bankAcctId} onValueChange={setBankAcctId}>
                <SelectTrigger className="h-9 text-xs"><SelectValue placeholder="Pilih akun…" /></SelectTrigger>
                <SelectContent>
                  {bankAccounts.map(a => (
                    <SelectItem key={a.id} value={String(a.id)}>
                      <span className="font-mono text-[10px] text-slate-400 mr-1">{a.code}</span>{a.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>

          <div>
            <Label className="text-xs font-medium text-slate-600 mb-1 block">Catatan</Label>
            <Textarea className="text-sm resize-none" rows={2} placeholder="Catatan tambahan…" value={notes} onChange={e => setNotes(e.target.value)} />
          </div>

          <div className="flex items-center gap-2 p-3 bg-blue-50 rounded-lg border border-blue-100">
            <input type="checkbox" id="auto_disburse" checked={autoDisburse} onChange={e => setAutoDisburse(e.target.checked)} className="w-4 h-4" />
            <label htmlFor="auto_disburse" className="text-xs text-blue-700 cursor-pointer">
              <span className="font-semibold">Langsung cairkan sekarang</span> — posting jurnal disbursement otomatis
            </label>
          </div>

          {recvAcctId && bankAcctId && amount && (
            <div className="rounded-lg border border-slate-200 bg-slate-50 p-3">
              <p className="text-xs font-semibold text-slate-700 mb-2">Preview Jurnal Pencairan</p>
              <div className="space-y-1 text-xs font-mono">
                <div className="flex justify-between">
                  <span className="text-slate-700">DR {recvAccounts.find(a => String(a.id) === recvAcctId)?.name ?? "Piutang Advance"}</span>
                  <span className="font-semibold">{IDR(Number(amount))}</span>
                </div>
                <div className="flex justify-between border-t border-slate-200 pt-1">
                  <span className="text-slate-500 pl-4">CR {bankAccounts.find(a => String(a.id) === bankAcctId)?.name ?? "Bank/Kas"}</span>
                  <span className="font-semibold">{IDR(Number(amount))}</span>
                </div>
              </div>
            </div>
          )}

          <div className="flex gap-2 justify-end pt-2 border-t">
            <Button variant="outline" size="sm" onClick={() => onOpenChange(false)}>Batal</Button>
            <Button size="sm" onClick={handleSave} disabled={saving}>
              {saving ? "Menyimpan…" : "Buat Advance"}
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

// ─── Detail Drawer ────────────────────────────────────────────────────────────
function AdvanceDetailDrawer({ advance, loading, onClose, onRefresh, onListRefresh, allAccounts, bankAccounts, api }: {
  advance: any; loading: boolean;
  onClose: () => void; onRefresh: () => void; onListRefresh: () => void;
  allAccounts: CoaAccount[]; bankAccounts: CoaAccount[];
  api: (path: string, opts?: RequestInit) => Promise<any>;
}) {
  const [actionTab, setActionTab] = useState("info");
  const [actionLoading, setActionLoading] = useState(false);

  // Settlement form state
  const [stlDate, setStlDate] = useState(new Date().toISOString().slice(0, 10));
  const [stlBankAcctId, setStlBankAcctId] = useState("");
  const [stlAmtReceived, setStlAmtReceived] = useState("");
  const [stlReference, setStlReference] = useState("");
  const [stlNotes, setStlNotes] = useState("");
  const [allocLines, setAllocLines] = useState<AllocationLine[]>([
    { allocation_type: "ADVANCE_PRINCIPAL", coa_id: null, reference_doc_id: null, reference_doc_type: null, amount: "", remarks: "" },
  ]);

  // Repay state
  const [repayDate, setRepayDate] = useState(new Date().toISOString().slice(0, 10));
  const [repayAmt, setRepayAmt] = useState("");
  const [repayBankId, setRepayBankId] = useState("");      // receiver COA (legacy compat)
  const [repayNotes, setRepayNotes] = useState("");
  // Repay intercompany state
  const [repayPayerCoaId, setRepayPayerCoaId] = useState("");
  const [repayReceiverCoaId, setRepayReceiverCoaId] = useState("");
  const [repayReference, setRepayReference] = useState("");
  const [repayPayerAccounts, setRepayPayerAccounts] = useState<CoaAccount[]>([]);
  const [repayPayerAcctsLoading, setRepayPayerAcctsLoading] = useState(false);

  // Void state
  const [voidReason, setVoidReason] = useState("");

  // Disburse state
  const [disbDate, setDisbDate] = useState(new Date().toISOString().slice(0, 10));

  // Cicilan schedule state
  const [schedStartDate, setSchedStartDate] = useState(new Date().toISOString().slice(0, 10));
  const [schedCount, setSchedCount] = useState("3");
  const [schedInterval, setSchedInterval] = useState("1");
  const [schedGenerating, setSchedGenerating] = useState(false);
  const [payingSchedId, setPayingSchedId] = useState<number | null>(null);
  const [payDate, setPayDate] = useState(new Date().toISOString().slice(0, 10));
  const [payBankId, setPayBankId] = useState("");
  // Cicilan intercompany state
  const [payPayerCoaId, setPayPayerCoaId] = useState("");
  const [payPayerAccounts, setPayPayerAccounts] = useState<CoaAccount[]>([]);
  const [payPayerAcctsLoading, setPayPayerAcctsLoading] = useState(false);

  // Auto-fetch payer accounts when advance's responsible_company_id is known
  const advResponsibleCompanyId = advance?.responsible_company_id
    ? String(advance.responsible_company_id) : "";

  useEffect(() => {
    if (!advResponsibleCompanyId) { setRepayPayerAccounts([]); setPayPayerAccounts([]); return; }
    setRepayPayerAcctsLoading(true);
    setPayPayerAcctsLoading(true);
    fetch(`/api/advances/payer-accounts?company_id=${advResponsibleCompanyId}`, { credentials: "include" })
      .then(r => r.ok ? r.json() : [])
      .then((data: CoaAccount[]) => { setRepayPayerAccounts(data); setPayPayerAccounts(data); })
      .catch(() => { setRepayPayerAccounts([]); setPayPayerAccounts([]); })
      .finally(() => { setRepayPayerAcctsLoading(false); setPayPayerAcctsLoading(false); });
  }, [advResponsibleCompanyId]);

  if (!advance && !loading) return null;

  const adv: Advance = advance;

  // Intercompany: responsible company is a different internal company
  const isIntercompanyAdv = Boolean(
    adv?.responsible_company_id &&
    Number(adv.responsible_company_id) !== Number(adv.company_id)
  );

  const canApprove   = ["pending_approval", "draft"].includes(adv?.lifecycle_status ?? "");
  const canDisburse  = ["approved"].includes(adv?.lifecycle_status ?? "");
  const canSettle    = ["outstanding", "partially_settled", "disbursed"].includes(adv?.lifecycle_status ?? "");
  const canRepay     = canSettle;
  const canVoid      = !["settled", "closed", "void"].includes(adv?.lifecycle_status ?? "");

  const allocTotal = allocLines.reduce((s, l) => s + (Number(l.amount) || 0), 0);
  const allocBalance = Number(stlAmtReceived) - allocTotal;

  const action = async (method: string, path: string, body?: any) => {
    setActionLoading(true);
    try {
      await api(path, { method, headers: { "Content-Type": "application/json" }, body: body ? JSON.stringify(body) : undefined });
      toast({ title: "Berhasil" });
      onRefresh();
      onListRefresh();
    } catch (err: any) {
      toast({ variant: "destructive", title: "Gagal", description: err?.message });
    } finally {
      setActionLoading(false);
    }
  };

  const handleSettle = async () => {
    if (!stlAmtReceived || Number(stlAmtReceived) <= 0) {
      toast({ variant: "destructive", title: "Jumlah diterima harus > 0" }); return;
    }
    if (Math.abs(allocBalance) > 0.01) {
      toast({ variant: "destructive", title: `Total alokasi belum balance (selisih ${IDR(Math.abs(allocBalance))})` }); return;
    }
    await action("POST", `/${adv.id}/settle`, {
      date: stlDate, bank_account_id: stlBankAcctId ? Number(stlBankAcctId) : null,
      amount_received: Number(stlAmtReceived), reference: stlReference, notes: stlNotes,
      allocation_lines: allocLines.map(l => ({ ...l, coa_id: l.coa_id ?? undefined, amount: Number(l.amount) })),
    });
  };

  return (
    <Dialog open onOpenChange={() => onClose()}>
      <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto p-0">
        {loading ? (
          <div className="p-8 text-center text-slate-400">Memuat detail…</div>
        ) : (
          <>
            {/* Header */}
            <div className="p-5 border-b bg-slate-50">
              <div className="flex items-start justify-between gap-2">
                <div>
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="font-mono text-sm font-bold text-slate-900">{adv.advance_number}</span>
                    <span className={`px-2 py-0.5 rounded text-[11px] font-medium ${getTypeInfo(adv.advance_type).color}`}>
                      {getTypeInfo(adv.advance_type).label}
                    </span>
                    <span className={`px-2 py-0.5 rounded text-[11px] font-medium ${getStatusInfo(adv.lifecycle_status).color}`}>
                      {getStatusInfo(adv.lifecycle_status).label}
                    </span>
                  </div>
                  <p className="text-lg font-bold text-slate-900 mt-1">{adv.party_name}</p>
                  <p className="text-xs text-slate-500">{dateStr(adv.date)}</p>
                </div>
                <div className="text-right">
                  <p className="text-xs text-slate-400">Jumlah</p>
                  <p className="text-xl font-bold text-slate-900">{IDR(adv.amount)}</p>
                  {adv.remaining_amount > 0 && (
                    <p className="text-xs text-orange-600 font-medium">Sisa: {IDR(adv.remaining_amount)}</p>
                  )}
                </div>
              </div>
            </div>

            {/* Action tabs */}
            <div className="p-4">
              <Tabs value={actionTab} onValueChange={setActionTab}>
                <TabsList className="h-8 text-xs flex-wrap">
                  <TabsTrigger value="info" className="text-xs">Info</TabsTrigger>
                  {canSettle && <TabsTrigger value="settle" className="text-xs">Settlement</TabsTrigger>}
                  {canRepay && <TabsTrigger value="repay" className="text-xs">Repayment</TabsTrigger>}
                  {canDisburse && <TabsTrigger value="disburse" className="text-xs">Cairkan</TabsTrigger>}
                  <TabsTrigger value="cicilan" className="text-xs gap-1">
                    <CalendarClock className="w-3 h-3" />
                    Cicilan
                    {(adv?.installment_schedule ?? []).length > 0 && (
                      <span className="ml-1 bg-blue-100 text-blue-700 rounded-full px-1.5 text-[10px] font-bold">
                        {(adv.installment_schedule ?? []).length}
                      </span>
                    )}
                  </TabsTrigger>
                  <TabsTrigger value="history" className="text-xs">Riwayat</TabsTrigger>
                </TabsList>

                {/* ── INFO TAB ────────────────────────────────────────── */}
                <TabsContent value="info" className="space-y-3 mt-3">
                  <div className="grid grid-cols-2 gap-x-6 gap-y-2 text-xs">
                    <InfoRow label="Tujuan/Keperluan" value={adv.purpose ?? "-"} />
                    <InfoRow label="Akun Piutang (DR)"
                      value={adv.receivable_account_name ? `${adv.receivable_account_code} — ${adv.receivable_account_name}` : "-"} />
                    <InfoRow label="Akun Bank/Kas (CR)"
                      value={adv.cash_bank_account_name ? `${adv.cash_bank_account_code} — ${adv.cash_bank_account_name}` : "-"} />
                    <InfoRow label="Entry Jurnal" value={adv.entry_id ? `#${adv.entry_id}` : "Belum diposting"} />
                    <InfoRow label="Sudah Dilunasi" value={IDR(adv.settled_amount)} />
                    <InfoRow label="Sisa Outstanding" value={IDR(adv.remaining_amount)} />
                    {adv.notes && <InfoRow label="Catatan" value={adv.notes} className="col-span-2" />}
                  </div>

                  {/* Actions */}
                  <div className="flex flex-wrap gap-2 pt-3 border-t">
                    {canApprove && (
                      <Button size="sm" className="h-8 text-xs gap-1 bg-green-600 hover:bg-green-700"
                        disabled={actionLoading}
                        onClick={() => action("PATCH", `/${adv.id}/approve`)}>
                        <CheckCircle2 className="w-3 h-3" /> Approve
                      </Button>
                    )}
                    {canApprove && (
                      <Button size="sm" variant="outline" className="h-8 text-xs gap-1 text-red-600 border-red-200"
                        disabled={actionLoading}
                        onClick={() => action("PATCH", `/${adv.id}/reject`, { reason: "Ditolak" })}>
                        <X className="w-3 h-3" /> Tolak
                      </Button>
                    )}
                    {canDisburse && (
                      <Button size="sm" className="h-8 text-xs gap-1"
                        disabled={actionLoading}
                        onClick={() => setActionTab("disburse")}>
                        <ArrowUpRight className="w-3 h-3" /> Cairkan
                      </Button>
                    )}
                    {canVoid && (
                      <Button size="sm" variant="outline" className="h-8 text-xs gap-1 text-red-500 border-red-200 ml-auto"
                        disabled={actionLoading}
                        onClick={async () => {
                          const reason = prompt("Alasan pembatalan:");
                          if (reason != null) await action("POST", `/${adv.id}/void`, { reason });
                        }}>
                        <AlertTriangle className="w-3 h-3" /> Void
                      </Button>
                    )}
                  </div>
                </TabsContent>

                {/* ── SETTLE TAB ──────────────────────────────────────── */}
                {canSettle && (
                  <TabsContent value="settle" className="space-y-3 mt-3">
                    <p className="text-xs text-slate-600 bg-blue-50 border border-blue-100 rounded p-2">
                      <strong>Alokasi Settlement:</strong> Distribusikan jumlah yang diterima ke pokok advance, invoice, revenue, atau lainnya.
                      Total alokasi HARUS sama dengan jumlah yang diterima.
                    </p>
                    <div className="grid grid-cols-3 gap-3">
                      <div>
                        <Label className="text-xs mb-1 block">Tanggal</Label>
                        <Input type="date" className="h-8 text-xs" value={stlDate} onChange={e => setStlDate(e.target.value)} />
                      </div>
                      <div>
                        <Label className="text-xs mb-1 block">Jumlah Diterima</Label>
                        <Input type="number" className="h-8 text-xs text-right font-mono" placeholder="0"
                          value={stlAmtReceived} onChange={e => setStlAmtReceived(e.target.value)} />
                      </div>
                      <div>
                        <Label className="text-xs mb-1 block">Akun Bank (DR)</Label>
                        <Select value={stlBankAcctId} onValueChange={setStlBankAcctId}>
                          <SelectTrigger className="h-8 text-xs"><SelectValue placeholder="Pilih bank…" /></SelectTrigger>
                          <SelectContent>
                            {bankAccounts.map(a => <SelectItem key={a.id} value={String(a.id)}>
                              <span className="font-mono text-[10px] mr-1 text-slate-400">{a.code}</span>{a.name}
                            </SelectItem>)}
                          </SelectContent>
                        </Select>
                      </div>
                    </div>
                    <div className="grid grid-cols-2 gap-3">
                      <div>
                        <Label className="text-xs mb-1 block">Referensi</Label>
                        <Input className="h-8 text-xs" placeholder="No. bukti / ref…" value={stlReference} onChange={e => setStlReference(e.target.value)} />
                      </div>
                      <div>
                        <Label className="text-xs mb-1 block">Catatan</Label>
                        <Input className="h-8 text-xs" placeholder="Catatan…" value={stlNotes} onChange={e => setStlNotes(e.target.value)} />
                      </div>
                    </div>

                    {/* Allocation lines */}
                    <div>
                      <div className="flex items-center justify-between mb-2">
                        <Label className="text-xs font-semibold">Alokasi Settlement</Label>
                        <Button size="sm" variant="outline" className="h-7 text-[11px]"
                          onClick={() => setAllocLines(l => [...l, { allocation_type: "ADVANCE_PRINCIPAL", coa_id: null, reference_doc_id: null, reference_doc_type: null, amount: "", remarks: "" }])}>
                          + Tambah Baris
                        </Button>
                      </div>
                      <div className="space-y-2">
                        {allocLines.map((line, i) => (
                          <div key={i} className="grid grid-cols-12 gap-2 items-center">
                            <div className="col-span-4">
                              <Select value={line.allocation_type} onValueChange={v => {
                                setAllocLines(ls => ls.map((l, j) => j === i ? { ...l, allocation_type: v as AllocationType } : l));
                              }}>
                                <SelectTrigger className="h-7 text-[11px]"><SelectValue /></SelectTrigger>
                                <SelectContent>
                                  {ALLOCATION_TYPES.map(t => <SelectItem key={t.value} value={t.value} className="text-xs">{t.label}</SelectItem>)}
                                </SelectContent>
                              </Select>
                            </div>
                            <div className="col-span-3">
                              {["DIRECT_REVENUE","OTHER_RECEIVABLE","CUSTOMER_DEPOSIT","ROUNDING","OTHER"].includes(line.allocation_type) && (
                                <Select value={line.coa_id ? String(line.coa_id) : ""} onValueChange={v => {
                                  setAllocLines(ls => ls.map((l, j) => j === i ? { ...l, coa_id: Number(v) } : l));
                                }}>
                                  <SelectTrigger className="h-7 text-[11px]"><SelectValue placeholder="Pilih akun…" /></SelectTrigger>
                                  <SelectContent>
                                    {allAccounts.map(a => <SelectItem key={a.id} value={String(a.id)} className="text-xs">
                                      <span className="font-mono text-[9px] text-slate-400 mr-1">{a.code}</span>{a.name}
                                    </SelectItem>)}
                                  </SelectContent>
                                </Select>
                              )}
                              {!["DIRECT_REVENUE","OTHER_RECEIVABLE","CUSTOMER_DEPOSIT","ROUNDING","OTHER"].includes(line.allocation_type) && (
                                <span className="text-[11px] text-slate-400 pl-1">Akun Advance</span>
                              )}
                            </div>
                            <div className="col-span-3">
                              <Input type="number" className="h-7 text-[11px] text-right font-mono" placeholder="Rp"
                                value={line.amount} onChange={e => {
                                  setAllocLines(ls => ls.map((l, j) => j === i ? { ...l, amount: e.target.value } : l));
                                }} />
                            </div>
                            <div className="col-span-1">
                              <button type="button" className="p-1 text-slate-400 hover:text-red-500"
                                onClick={() => setAllocLines(ls => ls.filter((_, j) => j !== i))}>
                                <X className="w-3 h-3" />
                              </button>
                            </div>
                          </div>
                        ))}
                      </div>
                      {/* Balance indicator */}
                      {stlAmtReceived && (
                        <div className={`mt-2 p-2 rounded text-xs font-mono ${Math.abs(allocBalance) <= 0.01 ? "bg-green-50 text-green-700" : "bg-orange-50 text-orange-700"}`}>
                          Total alokasi: {IDR(allocTotal)} / Diterima: {IDR(Number(stlAmtReceived))}
                          {Math.abs(allocBalance) > 0.01 && <span className="ml-2 font-semibold">Selisih: {IDR(Math.abs(allocBalance))}</span>}
                          {Math.abs(allocBalance) <= 0.01 && <span className="ml-2">✓ Balance</span>}
                        </div>
                      )}
                    </div>

                    <Button size="sm" className="h-8 text-xs w-full" disabled={actionLoading || Math.abs(allocBalance) > 0.01}
                      onClick={handleSettle}>
                      {actionLoading ? "Memproses…" : "Posting Settlement"}
                    </Button>
                  </TabsContent>
                )}

                {/* ── REPAY TAB ──────────────────────────────────────── */}
                {canRepay && (
                  <TabsContent value="repay" className="space-y-3 mt-3">
                    {/* Info banner */}
                    <div className="text-xs bg-slate-50 border border-slate-200 rounded p-2 space-y-1">
                      <p className="text-slate-600">Pengembalian dana. Sisa outstanding: <strong className="text-orange-600">{IDR(adv.remaining_amount)}</strong></p>
                      {isIntercompanyAdv && (
                        <p className="text-blue-600 font-medium flex items-center gap-1">
                          <Building2 className="w-3 h-3" />
                          Transaksi antar-perusahaan — akan membuat jurnal berpasangan di kedua perusahaan.
                        </p>
                      )}
                    </div>

                    {/* Perusahaan yang Mengembalikan (readonly, intercompany only) */}
                    {isIntercompanyAdv && (
                      <div>
                        <Label className="text-xs mb-1 block font-medium">Perusahaan yang Mengembalikan <span className="text-red-500">*</span></Label>
                        <Input
                          className="h-9 text-sm bg-slate-50"
                          value={adv.responsible_company_name ?? adv.responsible_party_name ?? "-"}
                          readOnly
                        />
                        <p className="text-[10px] text-slate-400 mt-0.5">Diisi otomatis dari penanggung dana talangan.</p>
                      </div>
                    )}

                    {/* Nominal + Tanggal */}
                    <div className="grid grid-cols-2 gap-3">
                      <div>
                        <Label className="text-xs mb-1 block font-medium">Nominal Pengembalian <span className="text-red-500">*</span></Label>
                        <Input type="number" className="h-9 text-sm text-right font-mono" placeholder="0"
                          value={repayAmt} onChange={e => setRepayAmt(e.target.value)} />
                      </div>
                      <div>
                        <Label className="text-xs mb-1 block font-medium">Tanggal Pengembalian <span className="text-red-500">*</span></Label>
                        <Input type="date" className="h-9 text-sm" value={repayDate} onChange={e => setRepayDate(e.target.value)} />
                      </div>
                    </div>

                    {/* Akun COA Bank/Kas Pengembali (intercompany only) */}
                    {isIntercompanyAdv && (
                      <div>
                        <Label className="text-xs mb-1 block font-medium">
                          Akun COA Bank/Kas Pengembali <span className="text-red-500">*</span>
                        </Label>
                        <Select value={repayPayerCoaId} onValueChange={setRepayPayerCoaId}>
                          <SelectTrigger className="h-9 text-sm">
                            <SelectValue placeholder={repayPayerAcctsLoading ? "Memuat akun…" : "Pilih akun bank/kas perusahaan pengembali…"} />
                          </SelectTrigger>
                          <SelectContent>
                            {repayPayerAccounts.length === 0 && !repayPayerAcctsLoading && (
                              <SelectItem value="_none" disabled>Tidak ada akun kas/bank ditemukan</SelectItem>
                            )}
                            {repayPayerAccounts.map(a => (
                              <SelectItem key={a.id} value={String(a.id)}>
                                <span className="font-mono text-[10px] mr-1 text-slate-400">{a.code}</span>{a.name}
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                        <p className="text-[10px] text-slate-400 mt-0.5">Hanya akun kas/bank aktif milik {adv.responsible_company_name ?? "perusahaan pengembali"}.</p>
                      </div>
                    )}

                    {/* Akun COA Bank/Kas Penerima */}
                    <div>
                      <Label className="text-xs mb-1 block font-medium">
                        Akun COA Bank/Kas Penerima <span className="text-red-500">*</span>
                      </Label>
                      <Select
                        value={repayReceiverCoaId || repayBankId}
                        onValueChange={v => { setRepayReceiverCoaId(v); setRepayBankId(v); }}
                      >
                        <SelectTrigger className="h-9 text-sm">
                          <SelectValue placeholder="Pilih rekening penerima pengembalian…" />
                        </SelectTrigger>
                        <SelectContent>
                          {bankAccounts.length === 0 && (
                            <SelectItem value="_none" disabled>Tidak ada akun kas/bank</SelectItem>
                          )}
                          {bankAccounts.map(a => (
                            <SelectItem key={a.id} value={String(a.id)}>
                              <span className="font-mono text-[10px] mr-1 text-slate-400">{a.code}</span>{a.name}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                      <p className="text-[10px] text-slate-400 mt-0.5">Rekening penerima milik {adv.source_company_name ?? adv.company_name ?? "perusahaan pemberi dana"}.</p>
                    </div>

                    {/* Nomor Referensi & Keterangan */}
                    <div className="grid grid-cols-2 gap-3">
                      <div>
                        <Label className="text-xs mb-1 block font-medium">Nomor Referensi Transfer</Label>
                        <Input className="h-9 text-sm font-mono" placeholder="TRF-XXXXXXXX" value={repayReference} onChange={e => setRepayReference(e.target.value)} />
                      </div>
                      <div>
                        <Label className="text-xs mb-1 block font-medium">Keterangan</Label>
                        <Input className="h-9 text-sm" placeholder="Catatan opsional…" value={repayNotes} onChange={e => setRepayNotes(e.target.value)} />
                      </div>
                    </div>

                    {/* Preview jurnal singkat */}
                    {repayAmt && (repayReceiverCoaId || repayBankId) && (
                      <div className="rounded border border-slate-200 bg-slate-50 p-2 text-xs font-mono space-y-1">
                        <p className="text-[10px] font-sans text-slate-500 font-semibold mb-1">Preview Jurnal</p>
                        {isIntercompanyAdv && repayPayerCoaId && (
                          <>
                            <div className="text-slate-400 text-[10px] font-sans mb-0.5">{adv.responsible_company_name ?? "Perusahaan Pengembali"}</div>
                            <div className="flex justify-between"><span>DR {repayPayerAccounts.find(a => String(a.id) === repayPayerCoaId)?.name ?? "Kas/Bank Pengembali"}</span><span>{IDR(Number(repayAmt))}</span></div>
                            <div className="flex justify-between text-slate-500 pl-3"><span>CR Hutang Intercompany</span><span>{IDR(Number(repayAmt))}</span></div>
                            <div className="border-t border-dashed border-slate-200 my-1" />
                          </>
                        )}
                        <div className="text-slate-400 text-[10px] font-sans mb-0.5">{adv.source_company_name ?? "Perusahaan Pemberi Dana"}</div>
                        <div className="flex justify-between"><span>DR {bankAccounts.find(a => String(a.id) === (repayReceiverCoaId || repayBankId))?.name ?? "Kas/Bank Penerima"}</span><span>{IDR(Number(repayAmt))}</span></div>
                        <div className="flex justify-between text-slate-500 pl-3"><span>CR Piutang Dana Talangan</span><span>{IDR(Number(repayAmt))}</span></div>
                      </div>
                    )}

                    <Button
                      size="sm" className="h-9 text-sm w-full"
                      disabled={
                        actionLoading || !repayAmt || Number(repayAmt) <= 0 ||
                        !(repayReceiverCoaId || repayBankId) ||
                        (isIntercompanyAdv && !repayPayerCoaId)
                      }
                      onClick={() => action("POST", `/${adv.id}/repay`, {
                        date: repayDate,
                        amount: Number(repayAmt),
                        receiver_coa_account_id: (repayReceiverCoaId || repayBankId) ? Number(repayReceiverCoaId || repayBankId) : undefined,
                        source_account_id: (repayReceiverCoaId || repayBankId) ? Number(repayReceiverCoaId || repayBankId) : undefined,
                        payer_company_id: isIntercompanyAdv ? (adv.responsible_company_id ?? undefined) : undefined,
                        payer_coa_account_id: (isIntercompanyAdv && repayPayerCoaId) ? Number(repayPayerCoaId) : undefined,
                        payment_reference: repayReference || undefined,
                        notes: repayNotes || undefined,
                        payment_method: "bank",
                        idempotency_key: `repay-${adv.id}-${Date.now()}`,
                      })}
                    >
                      {actionLoading ? "Memproses…" : "Posting Pengembalian"}
                    </Button>
                  </TabsContent>
                )}

                {/* ── DISBURSE TAB ──────────────────────────────────── */}
                {canDisburse && (
                  <TabsContent value="disburse" className="space-y-3 mt-3">
                    <p className="text-xs text-slate-600 bg-blue-50 border border-blue-100 rounded p-2">
                      Cairkan advance: posting jurnal DR Piutang Advance / CR Bank.
                    </p>
                    <div>
                      <Label className="text-xs mb-1 block">Tanggal Pencairan</Label>
                      <Input type="date" className="h-9 text-sm" value={disbDate} onChange={e => setDisbDate(e.target.value)} />
                    </div>
                    <Button size="sm" className="h-9 text-sm w-full" disabled={actionLoading}
                      onClick={() => action("PATCH", `/${adv.id}/disburse`, { date: disbDate })}>
                      {actionLoading ? "Mencairkan…" : "Cairkan & Posting Jurnal"}
                    </Button>
                  </TabsContent>
                )}

                {/* ── CICILAN TAB ──────────────────────────────────── */}
                <TabsContent value="cicilan" className="mt-3 space-y-3">
                  {(() => {
                    const schedule: any[] = adv?.installment_schedule ?? [];
                    const hasSchedule = schedule.length > 0;
                    const paidCount  = schedule.filter(s => s.status === "paid").length;
                    const totalCount = schedule.length;
                    const totalPaid  = schedule.reduce((s, r) => s + (r.status === "paid" ? Number(r.amount) : 0), 0);
                    const totalDue   = schedule.reduce((s, r) => s + Number(r.amount), 0);

                    const generateSchedule = async () => {
                      if (!schedCount || Number(schedCount) < 1) {
                        toast({ variant: "destructive", title: "Jumlah cicilan harus ≥ 1" }); return;
                      }
                      setSchedGenerating(true);
                      try {
                        await api(`/${adv.id}/installment-schedule`, {
                          method: "POST",
                          headers: { "Content-Type": "application/json" },
                          body: JSON.stringify({
                            start_date: schedStartDate,
                            installment_count: Number(schedCount),
                            interval_months: Number(schedInterval),
                          }),
                        });
                        toast({ title: "Jadwal cicilan berhasil dibuat" });
                        onRefresh();
                      } catch (err: any) {
                        toast({ variant: "destructive", title: "Gagal membuat jadwal", description: err?.message });
                      } finally {
                        setSchedGenerating(false);
                      }
                    };

                    const deleteSchedule = async () => {
                      if (!confirm("Hapus semua jadwal cicilan yang belum dibayar?")) return;
                      try {
                        await api(`/${adv.id}/installment-schedule`, { method: "DELETE" });
                        toast({ title: "Jadwal dihapus" });
                        onRefresh();
                      } catch (err: any) {
                        toast({ variant: "destructive", title: "Gagal", description: err?.message });
                      }
                    };

                    const payInstallment = async (s: any) => {
                      if (!payBankId) { toast({ variant: "destructive", title: "Pilih rekening bank penerima" }); return; }
                      if (isIntercompanyAdv && !payPayerCoaId) {
                        toast({ variant: "destructive", title: "Pilih akun kas/bank perusahaan pengembali" }); return;
                      }
                      setActionLoading(true);
                      try {
                        await api(`/${adv.id}/installment-schedule/${s.id}/pay`, {
                          method: "PATCH",
                          headers: { "Content-Type": "application/json" },
                          body: JSON.stringify({
                            date: payDate,
                            source_account_id: Number(payBankId),
                            payment_method: "bank",
                            notes: `Cicilan ke-${s.installment_number}`,
                            payer_company_id: isIntercompanyAdv ? (adv.responsible_company_id ?? undefined) : undefined,
                            payer_coa_account_id: (isIntercompanyAdv && payPayerCoaId) ? Number(payPayerCoaId) : undefined,
                          }),
                        });
                        toast({ title: `Cicilan ${s.installment_number} berhasil dibayar` });
                        setPayingSchedId(null);
                        onRefresh(); onListRefresh();
                      } catch (err: any) {
                        toast({ variant: "destructive", title: "Gagal bayar", description: err?.message });
                      } finally {
                        setActionLoading(false);
                      }
                    };

                    return (
                      <>
                        {/* ── Belum ada jadwal: form generate ── */}
                        {!hasSchedule && (
                          <div className="rounded-lg border border-dashed border-slate-300 bg-slate-50 p-4 space-y-3">
                            <div className="flex items-center gap-2">
                              <CalendarClock className="w-4 h-4 text-slate-400" />
                              <p className="text-xs font-semibold text-slate-600">Belum ada jadwal cicilan</p>
                            </div>
                            <p className="text-xs text-slate-500">
                              Buat jadwal cicilan untuk mencatat rencana pembayaran kembali.
                              Sisa outstanding: <strong>{IDR(adv.remaining_amount)}</strong>
                            </p>
                            <div className="grid grid-cols-3 gap-3">
                              <div>
                                <Label className="text-xs mb-1 block">Tanggal Cicilan Pertama</Label>
                                <Input type="date" className="h-8 text-xs" value={schedStartDate} onChange={e => setSchedStartDate(e.target.value)} />
                              </div>
                              <div>
                                <Label className="text-xs mb-1 block">Jumlah Cicilan</Label>
                                <Input type="number" min="1" max="120" className="h-8 text-xs text-center" value={schedCount}
                                  onChange={e => setSchedCount(e.target.value)} />
                              </div>
                              <div>
                                <Label className="text-xs mb-1 block">Interval (bulan)</Label>
                                <Input type="number" min="1" max="12" className="h-8 text-xs text-center" value={schedInterval}
                                  onChange={e => setSchedInterval(e.target.value)} />
                              </div>
                            </div>
                            {schedCount && Number(schedCount) >= 1 && (
                              <div className="text-[11px] text-slate-500 bg-white border rounded p-2 font-mono">
                                Per cicilan ≈ {IDR(Math.floor(adv.remaining_amount / Number(schedCount)))}
                                {" · "}Cicilan terakhir = {IDR(adv.remaining_amount - Math.floor(adv.remaining_amount / Number(schedCount)) * (Number(schedCount) - 1))}
                              </div>
                            )}
                            <Button size="sm" className="h-8 text-xs w-full" disabled={schedGenerating} onClick={generateSchedule}>
                              {schedGenerating ? "Membuat…" : "Buat Jadwal Cicilan"}
                            </Button>
                          </div>
                        )}

                        {/* ── Ada jadwal: tampilkan tabel ── */}
                        {hasSchedule && (
                          <>
                            {/* Progress */}
                            <div className="bg-slate-50 border rounded-lg p-3 space-y-2">
                              <div className="flex justify-between text-xs">
                                <span className="text-slate-500">Progress Pembayaran</span>
                                <span className="font-semibold text-slate-700">{paidCount}/{totalCount} cicilan</span>
                              </div>
                              <div className="w-full bg-slate-200 rounded-full h-2">
                                <div
                                  className="bg-green-500 h-2 rounded-full transition-all"
                                  style={{ width: totalCount > 0 ? `${Math.round((paidCount / totalCount) * 100)}%` : "0%" }}
                                />
                              </div>
                              <div className="flex justify-between text-[11px]">
                                <span className="text-green-600 font-medium">Dibayar: {IDR(totalPaid)}</span>
                                <span className="text-orange-600 font-medium">Sisa: {IDR(totalDue - totalPaid)}</span>
                              </div>
                            </div>

                            {/* Table */}
                            <div className="border rounded-lg overflow-hidden">
                              <table className="w-full text-xs">
                                <thead className="bg-slate-50">
                                  <tr>
                                    <th className="text-left px-3 py-2 font-semibold text-slate-600 w-8">#</th>
                                    <th className="text-left px-3 py-2 font-semibold text-slate-600">Jatuh Tempo</th>
                                    <th className="text-right px-3 py-2 font-semibold text-slate-600">Jumlah</th>
                                    <th className="text-center px-3 py-2 font-semibold text-slate-600">Status</th>
                                    <th className="px-3 py-2"></th>
                                  </tr>
                                </thead>
                                <tbody className="divide-y">
                                  {schedule.map((s: any) => (
                                    <>
                                      <tr key={s.id} className={`${s.status === "overdue" ? "bg-red-50" : s.status === "paid" ? "bg-green-50" : "bg-white"}`}>
                                        <td className="px-3 py-2 font-mono font-bold text-slate-500">{s.installment_number}</td>
                                        <td className="px-3 py-2 text-slate-700">{dateStr(s.due_date)}</td>
                                        <td className="px-3 py-2 text-right font-mono font-semibold">{IDR(Number(s.amount))}</td>
                                        <td className="px-3 py-2 text-center">
                                          {s.status === "paid"    && <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[11px] bg-green-100 text-green-700"><CalendarCheck className="w-3 h-3" />Lunas</span>}
                                          {s.status === "pending" && <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[11px] bg-slate-100 text-slate-600"><Clock className="w-3 h-3" />Belum</span>}
                                          {s.status === "overdue" && <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[11px] bg-red-100 text-red-700"><AlertTriangle className="w-3 h-3" />Terlambat</span>}
                                          {s.status === "waived"  && <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[11px] bg-gray-100 text-gray-500">Diwaive</span>}
                                        </td>
                                        <td className="px-3 py-2 text-right">
                                          {(s.status === "pending" || s.status === "overdue") && (
                                            <Button size="sm" variant="outline" className="h-6 text-[11px] px-2 gap-1 text-green-700 border-green-200"
                                              onClick={() => setPayingSchedId(payingSchedId === s.id ? null : s.id)}>
                                              <Banknote className="w-3 h-3" />Bayar
                                            </Button>
                                          )}
                                          {s.status === "paid" && s.repayment_date && (
                                            <span className="text-[10px] text-green-600">{dateStr(s.repayment_date)}</span>
                                          )}
                                        </td>
                                      </tr>
                                      {/* Inline pay form */}
                                      {payingSchedId === s.id && (
                                        <tr key={`pay-${s.id}`} className="bg-blue-50">
                                          <td colSpan={5} className="px-3 py-3">
                                            <div className="grid grid-cols-3 gap-2 items-end">
                                              <div>
                                                <Label className="text-[10px] mb-1 block">Tanggal Bayar</Label>
                                                <Input type="date" className="h-7 text-xs" value={payDate} onChange={e => setPayDate(e.target.value)} />
                                              </div>
                                              {isIntercompanyAdv && (
                                                <div>
                                                  <Label className="text-[10px] mb-1 block text-blue-700">Akun Pengembali <span className="text-red-500">*</span></Label>
                                                  <Select value={payPayerCoaId} onValueChange={setPayPayerCoaId}>
                                                    <SelectTrigger className="h-7 text-[11px]">
                                                      <SelectValue placeholder={payPayerAcctsLoading ? "Memuat…" : "Pilih akun pengembali…"} />
                                                    </SelectTrigger>
                                                    <SelectContent>
                                                      {payPayerAccounts.map(a => (
                                                        <SelectItem key={a.id} value={String(a.id)} className="text-xs">
                                                          <span className="font-mono text-[9px] text-slate-400 mr-1">{a.code}</span>{a.name}
                                                        </SelectItem>
                                                      ))}
                                                    </SelectContent>
                                                  </Select>
                                                </div>
                                              )}
                                              <div>
                                                <Label className="text-[10px] mb-1 block">Rekening Penerima (DR)</Label>
                                                <Select value={payBankId} onValueChange={setPayBankId}>
                                                  <SelectTrigger className="h-7 text-[11px]"><SelectValue placeholder="Pilih bank…" /></SelectTrigger>
                                                  <SelectContent>
                                                    {bankAccounts.map(a => (
                                                      <SelectItem key={a.id} value={String(a.id)} className="text-xs">
                                                        <span className="font-mono text-[9px] text-slate-400 mr-1">{a.code}</span>{a.name}
                                                      </SelectItem>
                                                    ))}
                                                  </SelectContent>
                                                </Select>
                                              </div>
                                              <div className="flex gap-1">
                                                <Button size="sm" className="h-7 text-xs flex-1 bg-green-600 hover:bg-green-700"
                                                  disabled={actionLoading} onClick={() => payInstallment(s)}>
                                                  {actionLoading ? "…" : "Konfirmasi"}
                                                </Button>
                                                <Button size="sm" variant="outline" className="h-7 text-xs"
                                                  onClick={() => setPayingSchedId(null)}>Batal</Button>
                                              </div>
                                            </div>
                                          </td>
                                        </tr>
                                      )}
                                    </>
                                  ))}
                                </tbody>
                              </table>
                            </div>

                            {/* Delete schedule button (only if no paid) */}
                            {paidCount === 0 && (
                              <Button size="sm" variant="outline" className="h-7 text-[11px] text-red-500 border-red-200 gap-1" onClick={deleteSchedule}>
                                <Trash2 className="w-3 h-3" />Hapus Jadwal
                              </Button>
                            )}
                          </>
                        )}
                      </>
                    );
                  })()}
                </TabsContent>

                {/* ── HISTORY TAB ──────────────────────────────────── */}
                <TabsContent value="history" className="mt-3">
                  <div className="space-y-3">
                    {/* Settlements */}
                    {(adv.settlements ?? []).length > 0 && (
                      <div>
                        <p className="text-xs font-semibold text-slate-700 mb-2">Settlement</p>
                        <div className="space-y-1">
                          {(adv.settlements ?? []).map((s: any) => (
                            <div key={s.id} className="flex justify-between items-center text-xs bg-green-50 border border-green-100 rounded px-3 py-1.5">
                              <div>
                                <span className="font-mono font-medium">{s.settlement_number}</span>
                                <span className="text-slate-500 ml-2">{dateStr(s.date)}</span>
                              </div>
                              <span className="font-semibold text-green-700">{IDR(Number(s.amount_received))}</span>
                            </div>
                          ))}
                        </div>
                      </div>
                    )}
                    {/* Repayments */}
                    {(adv.repayments ?? []).length > 0 && (
                      <div>
                        <p className="text-xs font-semibold text-slate-700 mb-2">Riwayat Pengembalian</p>
                        <div className="space-y-2">
                          {(adv.repayments ?? []).map((r: any) => (
                            <div key={r.id} className="rounded border border-blue-100 bg-blue-50 px-3 py-2 text-xs space-y-1">
                              <div className="flex justify-between items-center">
                                <span className="text-slate-600">{dateStr(r.date)}</span>
                                <span className="font-semibold text-blue-700 font-mono">{IDR(Number(r.amount))}</span>
                              </div>
                              {r.payer_company_name && (
                                <div className="text-slate-500">
                                  <span className="text-slate-400">Dari: </span>
                                  <span className="text-slate-700 font-medium">{r.payer_company_name}</span>
                                  {r.payer_coa_name && (
                                    <span className="text-slate-500"> — <span className="font-mono text-[10px]">{r.payer_coa_code}</span> {r.payer_coa_name}</span>
                                  )}
                                </div>
                              )}
                              {r.receiver_coa_name && (
                                <div className="text-slate-500">
                                  <span className="text-slate-400">Ke: </span>
                                  <span className="text-slate-700 font-medium">{r.receiver_company_name ?? adv.source_company_name}</span>
                                  <span className="text-slate-500"> — <span className="font-mono text-[10px]">{r.receiver_coa_code}</span> {r.receiver_coa_name}</span>
                                </div>
                              )}
                              {r.payment_reference && (
                                <div className="text-slate-500">
                                  <span className="text-slate-400">Ref: </span>
                                  <span className="font-mono font-medium">{r.payment_reference}</span>
                                </div>
                              )}
                              <div className="flex justify-between items-center text-[10px] text-slate-400 pt-0.5 border-t border-blue-100">
                                <span>{r.created_by ?? ""}</span>
                                <span className="flex gap-2 font-mono">
                                  {r.entry_id && <span>Jurnal #{r.entry_id}</span>}
                                  {r.payer_journal_id && <span>· Payer #{r.payer_journal_id}</span>}
                                  {r.intercompany_reference && <span className="text-blue-400">{r.intercompany_reference}</span>}
                                </span>
                              </div>
                            </div>
                          ))}
                        </div>
                      </div>
                    )}
                    {(adv.settlements ?? []).length === 0 && (adv.repayments ?? []).length === 0 && (
                      <p className="text-xs text-slate-400 py-4 text-center">Belum ada riwayat pembayaran</p>
                    )}
                  </div>
                </TabsContent>
              </Tabs>
            </div>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}

// ─── Info Row helper ──────────────────────────────────────────────────────────
function InfoRow({ label, value, className = "" }: { label: string; value: string; className?: string }) {
  return (
    <div className={className}>
      <p className="text-[10px] text-slate-400 uppercase tracking-wide">{label}</p>
      <p className="text-xs text-slate-800 font-medium">{value}</p>
    </div>
  );
}
