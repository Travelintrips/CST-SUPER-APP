/**
 * Allocation Center — Sprint 3 Phase 1
 * Dashboard + Outstanding + History dalam satu halaman dengan tabs.
 */
import { useState, useEffect, useCallback } from "react";
import { Link } from "wouter";
import { useCompany } from "@/contexts/CompanyContext";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { toast } from "@/hooks/use-toast";
import {
  Plus,
  RefreshCw,
  Search,
  TrendingUp,
  Clock,
  CheckCircle2,
  DollarSign,
  ArrowLeftRight,
  AlertTriangle,
  Eye,
  RotateCcw,
  FileText,
} from "lucide-react";

// ── Types ──────────────────────────────────────────────────────────────────────

const STATUS_CONFIG: Record<string, { label: string; color: string }> = {
  draft:     { label: "Draft",     color: "bg-gray-100 text-gray-600" },
  submitted: { label: "Submitted", color: "bg-yellow-100 text-yellow-800" },
  approved:  { label: "Approved",  color: "bg-blue-100 text-blue-800" },
  posted:    { label: "Posted",    color: "bg-green-100 text-green-800" },
  closed:    { label: "Closed",    color: "bg-emerald-100 text-emerald-800" },
  reversed:  { label: "Reversed",  color: "bg-red-100 text-red-800" },
};

const ALLOCATION_TYPE_LABELS: Record<string, string> = {
  ADVANCE_PRINCIPAL: "Advance Principal",
  SALES_INVOICE:     "Invoice AR",
  DIRECT_REVENUE:    "Direct Revenue",
  CUSTOMER_DEPOSIT:  "Customer Deposit",
  OTHER_RECEIVABLE:  "Other Receivable",
  ROUNDING:          "Pembulatan",
  ADJUSTMENT:        "Adjustment",
};

interface AllocationHeader {
  id: number;
  allocation_no: string;
  allocation_date: string;
  company_id: number;
  bank_name: string | null;
  received_amount: number;
  allocated_amount: number;
  remaining_amount: number;
  status: string;
  reference_no: string | null;
  notes: string | null;
  created_by: string | null;
  posted_by: string | null;
  journal_entry_id: number | null;
  line_count: number;
  created_at: string;
}

interface DashboardStats {
  outstanding_amount: number;
  pending_count: number;
  pending_amount: number;
  customer_deposit: number;
  recovered_today: number;
  avg_recovery_days: number;
}

interface AllocationDetail {
  id: number;
  allocation_no: string;
  allocation_date: string;
  status: string;
  received_amount: number;
  allocated_amount: number;
  remaining_amount: number;
  bank_name: string | null;
  account_number: string | null;
  reference_no: string | null;
  notes: string | null;
  created_by: string | null;
  approved_by: string | null;
  posted_by: string | null;
  journal_entry_id: number | null;
  lines: Array<{
    id: number;
    allocation_type: string;
    coa_code: string | null;
    coa_name: string | null;
    amount: number;
    remarks: string | null;
    reference_type: string | null;
    reference_id: number | null;
    allocation_status: string;
  }>;
  audit_logs: Array<{
    id: number;
    action: string;
    actor: string | null;
    from_status: string | null;
    to_status: string | null;
    notes: string | null;
    created_at: string;
  }>;
}

// ── Helpers ────────────────────────────────────────────────────────────────────

function fmt(n: number) {
  return new Intl.NumberFormat("id-ID", { style: "decimal", maximumFractionDigits: 0 }).format(n);
}

function StatusBadge({ status }: { status: string }) {
  const cfg = STATUS_CONFIG[status] ?? { label: status, color: "bg-gray-100 text-gray-600" };
  return <Badge className={`${cfg.color} border-0 text-xs`}>{cfg.label}</Badge>;
}

// ── Main Page ──────────────────────────────────────────────────────────────────

export default function AllocationCenterPage() {
  const { activeCompanyId } = useCompany();

  const [tab, setTab] = useState("dashboard");
  const [allocations, setAllocations] = useState<AllocationHeader[]>([]);
  const [stats, setStats] = useState<DashboardStats | null>(null);
  const [loading, setLoading] = useState(false);
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState("all");
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);

  const [detailOpen, setDetailOpen] = useState(false);
  const [selectedDetail, setSelectedDetail] = useState<AllocationDetail | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);

  const [actionLoading, setActionLoading] = useState<number | null>(null);

  const fetchStats = useCallback(async () => {
    try {
      const res = await fetch(`/api/allocation/dashboard-stats`, { credentials: "include" });
      if (!res.ok) return;
      const data = await res.json();
      setStats(data);
    } catch {}
  }, []);

  const fetchAllocations = useCallback(async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams({ page: String(page), limit: "30" });
      if (activeCompanyId) params.set("companyId", String(activeCompanyId));
      if (search) params.set("search", search);
      if (statusFilter !== "all") params.set("status", statusFilter);

      const res = await fetch(`/api/allocation?${params}`, { credentials: "include" });
      if (!res.ok) return;
      const data = await res.json();
      setAllocations(data.data ?? []);
      setTotal(data.total ?? 0);
    } catch {
      toast({ title: "Gagal memuat data alokasi", variant: "destructive" });
    } finally {
      setLoading(false);
    }
  }, [activeCompanyId, search, statusFilter, page]);

  useEffect(() => {
    fetchStats();
    fetchAllocations();
  }, [fetchStats, fetchAllocations]);

  const openDetail = async (id: number) => {
    setDetailOpen(true);
    setDetailLoading(true);
    try {
      const res = await fetch(`/api/allocation/${id}`, { credentials: "include" });
      if (!res.ok) throw new Error();
      const data = await res.json();
      setSelectedDetail(data);
    } catch {
      toast({ title: "Gagal memuat detail", variant: "destructive" });
      setDetailOpen(false);
    } finally {
      setDetailLoading(false);
    }
  };

  const doAction = async (id: number, action: "submit" | "approve" | "reject" | "post" | "reverse", notes?: string) => {
    setActionLoading(id);
    try {
      const res = await fetch(`/api/allocation/${id}/${action}`, {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ notes }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Gagal");
      toast({ title: `Allocation berhasil di-${action}` });
      fetchAllocations();
      fetchStats();
      if (selectedDetail?.id === id) {
        openDetail(id);
      }
    } catch (err: any) {
      toast({ title: err.message ?? `Gagal ${action}`, variant: "destructive" });
    } finally {
      setActionLoading(null);
    }
  };

  const outstandingList = allocations.filter((a) =>
    ["draft", "submitted", "approved"].includes(a.status),
  );
  const historyList = allocations.filter((a) =>
    ["posted", "closed", "reversed"].includes(a.status),
  );

  // ── Render ────────────────────────────────────────────────────────────────

  return (
    <div className="flex flex-col gap-6 p-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-slate-900 dark:text-white">Allocation Center</h1>
          <p className="text-sm text-slate-500 mt-0.5">
            Enterprise Allocation Engine — alokasi penerimaan bank ke advance, invoice, deposit, dan revenue
          </p>
        </div>
        <div className="flex gap-2">
          <Button variant="outline" size="sm" onClick={() => { fetchStats(); fetchAllocations(); }}>
            <RefreshCw className="h-4 w-4 mr-1.5" /> Refresh
          </Button>
          <Button size="sm" asChild>
            <Link href="/finance/allocation/create">
              <Plus className="h-4 w-4 mr-1.5" /> Buat Alokasi
            </Link>
          </Button>
        </div>
      </div>

      <Tabs value={tab} onValueChange={setTab}>
        <TabsList>
          <TabsTrigger value="dashboard">Dashboard</TabsTrigger>
          <TabsTrigger value="outstanding">
            Outstanding
            {outstandingList.length > 0 && (
              <Badge className="ml-1.5 bg-orange-100 text-orange-800 border-0 text-xs">
                {outstandingList.length}
              </Badge>
            )}
          </TabsTrigger>
          <TabsTrigger value="all">Semua</TabsTrigger>
          <TabsTrigger value="history">History</TabsTrigger>
        </TabsList>

        {/* ── Dashboard Tab ── */}
        <TabsContent value="dashboard" className="mt-4">
          <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-4 mb-6">
            <StatCard
              icon={AlertTriangle}
              label="Outstanding Allocation"
              value={`Rp ${fmt(stats?.outstanding_amount ?? 0)}`}
              color="text-orange-500"
            />
            <StatCard
              icon={Clock}
              label="Pending Approval"
              value={`${stats?.pending_count ?? 0} transaksi`}
              sub={`Rp ${fmt(stats?.pending_amount ?? 0)}`}
              color="text-yellow-500"
            />
            <StatCard
              icon={ArrowLeftRight}
              label="Customer Deposit"
              value={`Rp ${fmt(stats?.customer_deposit ?? 0)}`}
              color="text-blue-500"
            />
            <StatCard
              icon={TrendingUp}
              label="Recovered Hari Ini"
              value={`Rp ${fmt(stats?.recovered_today ?? 0)}`}
              color="text-green-500"
            />
            <StatCard
              icon={CheckCircle2}
              label="Rata-rata Recovery"
              value={`${stats?.avg_recovery_days ?? 0} hari`}
              color="text-indigo-500"
            />
            <StatCard
              icon={DollarSign}
              label="Total Alokasi Pending"
              value={`${stats?.pending_count ?? 0}`}
              sub="menunggu posting"
              color="text-purple-500"
            />
          </div>

          {/* Recent allocations */}
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-base">Allocation Terbaru</CardTitle>
            </CardHeader>
            <CardContent>
              <AllocationTable
                rows={allocations.slice(0, 10)}
                loading={loading}
                onView={openDetail}
                onAction={doAction}
                actionLoading={actionLoading}
              />
            </CardContent>
          </Card>
        </TabsContent>

        {/* ── Outstanding Tab ── */}
        <TabsContent value="outstanding" className="mt-4">
          <FilterBar search={search} setSearch={setSearch} statusFilter={statusFilter} setStatusFilter={setStatusFilter} showOutstandingOnly onlyStatuses={["draft","submitted","approved"]} />
          <Card className="mt-3">
            <CardContent className="pt-4">
              <AllocationTable
                rows={outstandingList}
                loading={loading}
                onView={openDetail}
                onAction={doAction}
                actionLoading={actionLoading}
              />
            </CardContent>
          </Card>
        </TabsContent>

        {/* ── All Tab ── */}
        <TabsContent value="all" className="mt-4">
          <FilterBar search={search} setSearch={setSearch} statusFilter={statusFilter} setStatusFilter={setStatusFilter} />
          <Card className="mt-3">
            <CardContent className="pt-4">
              <AllocationTable
                rows={allocations}
                loading={loading}
                onView={openDetail}
                onAction={doAction}
                actionLoading={actionLoading}
              />
              {total > allocations.length && (
                <div className="flex justify-center mt-4">
                  <Button variant="outline" size="sm" onClick={() => setPage((p) => p + 1)}>
                    Muat lebih banyak ({total - allocations.length} lagi)
                  </Button>
                </div>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        {/* ── History Tab ── */}
        <TabsContent value="history" className="mt-4">
          <FilterBar search={search} setSearch={setSearch} statusFilter={statusFilter} setStatusFilter={setStatusFilter} showHistoryOnly onlyStatuses={["posted","closed","reversed"]} />
          <Card className="mt-3">
            <CardContent className="pt-4">
              <AllocationTable
                rows={historyList}
                loading={loading}
                onView={openDetail}
                onAction={doAction}
                actionLoading={actionLoading}
              />
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>

      {/* Detail Dialog */}
      <Dialog open={detailOpen} onOpenChange={setDetailOpen}>
        <DialogContent className="max-w-3xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Detail Allocation</DialogTitle>
          </DialogHeader>
          {detailLoading ? (
            <div className="flex items-center justify-center py-12">
              <RefreshCw className="h-6 w-6 animate-spin text-slate-400" />
            </div>
          ) : selectedDetail ? (
            <AllocationDetailView
              detail={selectedDetail}
              onAction={doAction}
              actionLoading={actionLoading}
            />
          ) : null}
        </DialogContent>
      </Dialog>
    </div>
  );
}

// ── Sub-components ─────────────────────────────────────────────────────────────

function StatCard({
  icon: Icon,
  label,
  value,
  sub,
  color,
}: {
  icon: React.ElementType;
  label: string;
  value: string;
  sub?: string;
  color: string;
}) {
  return (
    <Card className="border border-slate-200">
      <CardContent className="p-4">
        <div className="flex items-center gap-2 mb-2">
          <Icon className={`h-4 w-4 ${color}`} />
          <span className="text-xs text-slate-500">{label}</span>
        </div>
        <p className="text-sm font-bold text-slate-900 dark:text-white">{value}</p>
        {sub && <p className="text-xs text-slate-400 mt-0.5">{sub}</p>}
      </CardContent>
    </Card>
  );
}

function FilterBar({
  search,
  setSearch,
  statusFilter,
  setStatusFilter,
  showOutstandingOnly,
  showHistoryOnly,
  onlyStatuses,
}: {
  search: string;
  setSearch: (v: string) => void;
  statusFilter: string;
  setStatusFilter: (v: string) => void;
  showOutstandingOnly?: boolean;
  showHistoryOnly?: boolean;
  onlyStatuses?: string[];
}) {
  const statuses = onlyStatuses ?? Object.keys(STATUS_CONFIG);
  return (
    <div className="flex gap-2">
      <div className="relative flex-1 max-w-xs">
        <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-slate-400" />
        <Input
          placeholder="Cari nomor, referensi..."
          className="pl-8"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
      </div>
      <Select value={statusFilter} onValueChange={setStatusFilter}>
        <SelectTrigger className="w-36">
          <SelectValue placeholder="Status" />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="all">Semua Status</SelectItem>
          {statuses.map((s) => (
            <SelectItem key={s} value={s}>
              {STATUS_CONFIG[s]?.label ?? s}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  );
}

function AllocationTable({
  rows,
  loading,
  onView,
  onAction,
  actionLoading,
}: {
  rows: AllocationHeader[];
  loading: boolean;
  onView: (id: number) => void;
  onAction: (id: number, action: any, notes?: string) => void;
  actionLoading: number | null;
}) {
  if (loading) {
    return (
      <div className="flex items-center justify-center py-10 text-slate-400">
        <RefreshCw className="h-5 w-5 animate-spin mr-2" /> Memuat...
      </div>
    );
  }
  if (!rows.length) {
    return (
      <div className="text-center py-10 text-slate-400 text-sm">Tidak ada data alokasi</div>
    );
  }

  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead>No. Alokasi</TableHead>
          <TableHead>Tanggal</TableHead>
          <TableHead>Bank</TableHead>
          <TableHead className="text-right">Received</TableHead>
          <TableHead className="text-right">Allocated</TableHead>
          <TableHead>Status</TableHead>
          <TableHead>Lines</TableHead>
          <TableHead>Aksi</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {rows.map((row) => {
          const busy = actionLoading === row.id;
          return (
            <TableRow key={row.id} className="hover:bg-slate-50 dark:hover:bg-slate-800/50">
              <TableCell className="font-mono text-xs font-medium">{row.allocation_no}</TableCell>
              <TableCell className="text-xs text-slate-500">
                {row.allocation_date?.substring(0, 10)}
              </TableCell>
              <TableCell className="text-xs text-slate-500">{row.bank_name ?? "—"}</TableCell>
              <TableCell className="text-right text-xs">Rp {fmt(row.received_amount)}</TableCell>
              <TableCell className="text-right text-xs">Rp {fmt(row.allocated_amount)}</TableCell>
              <TableCell>
                <StatusBadge status={row.status} />
              </TableCell>
              <TableCell className="text-xs text-slate-500">{row.line_count} baris</TableCell>
              <TableCell>
                <div className="flex gap-1">
                  <Button
                    size="icon"
                    variant="ghost"
                    className="h-7 w-7"
                    onClick={() => onView(row.id)}
                    title="Lihat detail"
                  >
                    <Eye className="h-3.5 w-3.5" />
                  </Button>
                  {row.status === "draft" && (
                    <Button
                      size="sm"
                      variant="outline"
                      className="h-7 text-xs"
                      disabled={busy}
                      onClick={() => onAction(row.id, "submit")}
                    >
                      Submit
                    </Button>
                  )}
                  {row.status === "submitted" && (
                    <Button
                      size="sm"
                      className="h-7 text-xs bg-blue-600 hover:bg-blue-700"
                      disabled={busy}
                      onClick={() => onAction(row.id, "approve")}
                    >
                      Approve
                    </Button>
                  )}
                  {row.status === "approved" && (
                    <Button
                      size="sm"
                      className="h-7 text-xs bg-green-600 hover:bg-green-700"
                      disabled={busy}
                      onClick={() => onAction(row.id, "post")}
                    >
                      Post
                    </Button>
                  )}
                </div>
              </TableCell>
            </TableRow>
          );
        })}
      </TableBody>
    </Table>
  );
}

function AllocationDetailView({
  detail,
  onAction,
  actionLoading,
}: {
  detail: AllocationDetail;
  onAction: (id: number, action: any, notes?: string) => void;
  actionLoading: number | null;
}) {
  const busy = actionLoading === detail.id;

  const totalLines = detail.lines.reduce((s, l) => s + l.amount, 0);

  return (
    <div className="flex flex-col gap-4 text-sm">
      {/* Header info */}
      <div className="grid grid-cols-2 gap-3 bg-slate-50 dark:bg-slate-800 rounded-lg p-4">
        <div>
          <p className="text-xs text-slate-500">No. Alokasi</p>
          <p className="font-mono font-semibold">{detail.allocation_no}</p>
        </div>
        <div>
          <p className="text-xs text-slate-500">Status</p>
          <StatusBadge status={detail.status} />
        </div>
        <div>
          <p className="text-xs text-slate-500">Tanggal</p>
          <p>{detail.allocation_date?.substring(0, 10)}</p>
        </div>
        <div>
          <p className="text-xs text-slate-500">Bank</p>
          <p>{detail.bank_name ?? "—"} {detail.account_number ? `(${detail.account_number})` : ""}</p>
        </div>
        <div>
          <p className="text-xs text-slate-500">Received Amount</p>
          <p className="font-semibold text-green-700">Rp {fmt(detail.received_amount)}</p>
        </div>
        <div>
          <p className="text-xs text-slate-500">Allocated</p>
          <p className="font-semibold">Rp {fmt(detail.allocated_amount)}</p>
        </div>
        {detail.reference_no && (
          <div>
            <p className="text-xs text-slate-500">Referensi</p>
            <p>{detail.reference_no}</p>
          </div>
        )}
        {detail.notes && (
          <div className="col-span-2">
            <p className="text-xs text-slate-500">Catatan</p>
            <p>{detail.notes}</p>
          </div>
        )}
        {detail.journal_entry_id && (
          <div>
            <p className="text-xs text-slate-500">Journal Entry</p>
            <p className="font-mono text-blue-600">#{detail.journal_entry_id}</p>
          </div>
        )}
      </div>

      {/* Lines */}
      <div>
        <p className="font-semibold mb-2 text-slate-700">Allocation Lines</p>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Type</TableHead>
              <TableHead>COA</TableHead>
              <TableHead className="text-right">Amount</TableHead>
              <TableHead>Keterangan</TableHead>
              <TableHead>Status</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {detail.lines.map((l) => (
              <TableRow key={l.id}>
                <TableCell className="text-xs">
                  <Badge variant="outline" className="text-xs">
                    {ALLOCATION_TYPE_LABELS[l.allocation_type] ?? l.allocation_type}
                  </Badge>
                </TableCell>
                <TableCell className="text-xs font-mono">
                  {l.coa_code ? `${l.coa_code} — ${l.coa_name}` : "—"}
                </TableCell>
                <TableCell className="text-right text-xs">Rp {fmt(l.amount)}</TableCell>
                <TableCell className="text-xs text-slate-500">{l.remarks ?? "—"}</TableCell>
                <TableCell>
                  <Badge className="text-xs bg-slate-100 text-slate-600 border-0">
                    {l.allocation_status}
                  </Badge>
                </TableCell>
              </TableRow>
            ))}
            <TableRow className="bg-slate-50 font-semibold">
              <TableCell colSpan={2} className="text-xs">Total Alokasi</TableCell>
              <TableCell className="text-right text-xs">Rp {fmt(totalLines)}</TableCell>
              <TableCell colSpan={2} />
            </TableRow>
          </TableBody>
        </Table>
      </div>

      {/* Action buttons */}
      <div className="flex gap-2 flex-wrap">
        {detail.status === "draft" && (
          <>
            <Button size="sm" variant="outline" onClick={() => onAction(detail.id, "submit")} disabled={busy}>
              Submit
            </Button>
            <Button size="sm" variant="outline" asChild>
              <Link href={`/finance/allocation/create?edit=${detail.id}`}>Edit</Link>
            </Button>
          </>
        )}
        {detail.status === "submitted" && (
          <>
            <Button size="sm" className="bg-blue-600 hover:bg-blue-700" onClick={() => onAction(detail.id, "approve")} disabled={busy}>
              Approve
            </Button>
            <Button size="sm" variant="outline" onClick={() => onAction(detail.id, "reject")} disabled={busy}>
              Reject
            </Button>
          </>
        )}
        {detail.status === "approved" && (
          <Button size="sm" className="bg-green-600 hover:bg-green-700" onClick={() => onAction(detail.id, "post")} disabled={busy}>
            Post Journal
          </Button>
        )}
        {detail.status === "posted" && (
          <Button
            size="sm"
            variant="outline"
            className="text-red-600 border-red-200 hover:bg-red-50"
            onClick={() => {
              const reason = window.prompt("Alasan reverse:");
              if (reason !== null) onAction(detail.id, "reverse", reason || "Manual reversal");
            }}
            disabled={busy}
          >
            <RotateCcw className="h-3.5 w-3.5 mr-1" /> Reverse
          </Button>
        )}
      </div>

      {/* Audit Trail */}
      {detail.audit_logs.length > 0 && (
        <div>
          <p className="font-semibold mb-2 text-slate-700 flex items-center gap-1.5">
            <FileText className="h-4 w-4" /> Audit Trail
          </p>
          <div className="flex flex-col gap-1.5">
            {detail.audit_logs.map((log) => (
              <div key={log.id} className="flex items-start gap-2 text-xs text-slate-600">
                <span className="text-slate-400 w-32 shrink-0">
                  {new Date(log.created_at).toLocaleString("id-ID", { dateStyle: "short", timeStyle: "short" })}
                </span>
                <Badge variant="outline" className="text-xs">{log.action}</Badge>
                <span>{log.actor ?? "system"}</span>
                {log.from_status && log.to_status && (
                  <span className="text-slate-400">
                    {log.from_status} → {log.to_status}
                  </span>
                )}
                {log.notes && <span className="text-slate-500 italic">"{log.notes}"</span>}
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
