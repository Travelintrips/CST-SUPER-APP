import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { AppShell } from "@/components/layout/AppShell";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from "@/components/ui/alert-dialog";
import {
  ShieldCheck, ShieldX, RefreshCw, CheckCircle2, XCircle,
  ClipboardList, FileText, Search, ChevronLeft, ChevronRight,
  ToggleLeft, ToggleRight, Loader2, AlertTriangle, Clock,
  ScrollText, PlusCircle, Eye, ArrowLeft,
} from "lucide-react";
import { useCompany } from "@/contexts/CompanyContext";
import { toast } from "sonner";

// ── Helpers ──────────────────────────────────────────────────────────────────

function formatRp(n: number | string) {
  return "Rp " + Math.abs(Math.round(Number(n))).toLocaleString("id-ID");
}

function generatePeriods() {
  const p: string[] = [];
  const now = new Date();
  for (let i = 0; i < 24; i++) {
    const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
    p.push(`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`);
  }
  return p;
}
const PERIODS = generatePeriods();

function currentPeriod() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
}

function fmtDate(s: string | null | undefined) {
  if (!s) return "-";
  return new Date(s).toLocaleString("id-ID", { dateStyle: "short", timeStyle: "short" });
}

// ── Types ─────────────────────────────────────────────────────────────────────

interface SptSummaryRow {
  spt_status: string;
  count: number;
  total_tax: number;
  total_base: number;
}

interface TaxTxRow {
  id: number;
  period: string;
  transaction_ref: string | null;
  tax_name: string;
  tax_rate: number;
  base_amount: number;
  tax_amount: number;
  direction: string;
  partner_name: string | null;
  spt_status: string | null;
  excluded_reason: string | null;
  excluded_by: string | null;
  excluded_at: string | null;
}

interface Adjustment {
  id: string;
  company_id: number;
  transaction_tax_id: number;
  adjustment_type: string;
  status: string;
  old_value: unknown;
  new_value: unknown;
  reason: string;
  created_by: string | null;
  approved_by: string | null;
  rejected_by: string | null;
  rejection_reason: string | null;
  created_at: string;
  applied_at: string | null;
}

interface AuditLog {
  id: string;
  entity_type: string;
  entity_id: string;
  action: string;
  before_data: unknown;
  after_data: unknown;
  performed_by: string | null;
  ip_address: string | null;
  timestamp: string;
}

// ── Badge Helpers ─────────────────────────────────────────────────────────────

const SPT_STATUS_CFG: Record<string, { label: string; cls: string; icon: React.ReactNode }> = {
  INCLUDED: { label: "Included", cls: "bg-emerald-100 text-emerald-700", icon: <ShieldCheck className="h-3 w-3" /> },
  EXCLUDED: { label: "Excluded", cls: "bg-red-100 text-red-700",     icon: <ShieldX className="h-3 w-3" /> },
  PENDING:  { label: "Pending",  cls: "bg-orange-100 text-orange-700", icon: <Clock className="h-3 w-3" /> },
};

function SptBadge({ status }: { status: string | null }) {
  const s = status ?? "PENDING";
  const cfg = SPT_STATUS_CFG[s] ?? SPT_STATUS_CFG["PENDING"];
  return (
    <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[11px] font-medium ${cfg.cls}`}>
      {cfg.icon}{cfg.label}
    </span>
  );
}

const ADJ_STATUS_CFG: Record<string, string> = {
  PENDING:  "bg-orange-100 text-orange-700",
  APPROVED: "bg-emerald-100 text-emerald-700",
  REJECTED: "bg-red-100 text-red-700",
};
const ADJ_TYPE_LABEL: Record<string, string> = {
  CORRECTION: "Koreksi",
  REVERSAL:   "Pembatalan",
  OVERRIDE:   "Override",
};

// ── Summary Cards ─────────────────────────────────────────────────────────────

function SummarySection({ companyId, period }: { companyId: number | null; period: string }) {
  const { data, isLoading } = useQuery<{ summary: SptSummaryRow[] }>({
    queryKey: ["spt-control-summary", companyId, period],
    queryFn: () => {
      const p = new URLSearchParams({ period });
      if (companyId) p.set("companyId", String(companyId));
      return fetch(`/api/tax/spt-control/summary?${p}`, { credentials: "include" }).then((r) => r.json());
    },
    enabled: !!period,
  });

  const rows = data?.summary ?? [];
  const included = rows.find((r) => r.spt_status === "INCLUDED");
  const excluded = rows.find((r) => r.spt_status === "EXCLUDED");
  const pending  = rows.find((r) => r.spt_status === "PENDING");

  const cards = [
    { label: "Included", val: included?.count ?? 0, tax: included?.total_tax ?? 0, cls: "border-emerald-200 bg-emerald-50", icon: <ShieldCheck className="h-5 w-5 text-emerald-600" /> },
    { label: "Excluded", val: excluded?.count ?? 0, tax: excluded?.total_tax ?? 0, cls: "border-red-200 bg-red-50",     icon: <ShieldX className="h-5 w-5 text-red-500" /> },
    { label: "Pending",  val: pending?.count  ?? 0, tax: pending?.total_tax  ?? 0, cls: "border-orange-200 bg-orange-50", icon: <Clock className="h-5 w-5 text-orange-500" /> },
  ];

  if (isLoading) {
    return <div className="grid grid-cols-3 gap-4">{[1,2,3].map((i) => <div key={i} className="h-20 rounded-xl border bg-muted animate-pulse" />)}</div>;
  }

  return (
    <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
      {cards.map((c) => (
        <Card key={c.label} className={`border ${c.cls}`}>
          <CardContent className="p-4 flex items-center gap-3">
            {c.icon}
            <div>
              <p className="text-xs text-muted-foreground">{c.label}</p>
              <p className="text-lg font-bold">{c.val} <span className="text-xs font-normal text-muted-foreground">transaksi</span></p>
              <p className="text-xs text-muted-foreground">{formatRp(c.tax)}</p>
            </div>
          </CardContent>
        </Card>
      ))}
    </div>
  );
}

// ── Transactions Tab ──────────────────────────────────────────────────────────

function TransactionsTab({ companyId, period }: { companyId: number | null; period: string }) {
  const qc = useQueryClient();
  const [sptFilter, setSptFilter] = useState("all");
  const [search, setSearch] = useState("");
  const [searchInput, setSearchInput] = useState("");
  const [page, setPage] = useState(1);
  const [excludeDialog, setExcludeDialog] = useState<TaxTxRow | null>(null);
  const [excludeReason, setExcludeReason] = useState("");
  const [selectedIds, setSelectedIds] = useState<Set<number>>(new Set());
  const [bulkDialog, setBulkDialog] = useState<"INCLUDED" | "EXCLUDED" | null>(null);
  const [bulkReason, setBulkReason] = useState("");

  const params = new URLSearchParams({ period, page: String(page), limit: "50" });
  if (companyId) params.set("companyId", String(companyId));
  if (sptFilter !== "all") params.set("sptStatus", sptFilter);
  if (search) params.set("search", search);

  const { data, isLoading, isFetching, refetch } = useQuery<{ data: TaxTxRow[]; total: number }>({
    queryKey: ["spt-control-txs", companyId, period, sptFilter, search, page],
    queryFn: () => fetch(`/api/tax/transactions?${params}`, { credentials: "include" }).then((r) => r.json()),
    enabled: !!period,
  });

  const toggleMut = useMutation({
    mutationFn: async (id: number) => {
      const p = new URLSearchParams();
      if (companyId) p.set("companyId", String(companyId));
      const r = await fetch(`/api/tax/spt-control/toggle/${id}?${p}`, { method: "POST", credentials: "include" });
      if (!r.ok) { const e = await r.json().catch(() => ({})) as { error?: string }; throw new Error(e.error ?? "Gagal"); }
      return r.json();
    },
    onSuccess: (data: { newStatus?: string }) => {
      toast.success(`Status diubah ke ${data.newStatus ?? "?"}`);
      qc.invalidateQueries({ queryKey: ["spt-control-txs"] });
      qc.invalidateQueries({ queryKey: ["spt-control-summary"] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const excludeMut = useMutation({
    mutationFn: async ({ id, reason }: { id: number; reason: string }) => {
      const p = new URLSearchParams();
      if (companyId) p.set("companyId", String(companyId));
      const r = await fetch(`/api/tax/spt-control/exclude/${id}?${p}`, {
        method: "POST", credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ reason }),
      });
      if (!r.ok) { const e = await r.json().catch(() => ({})) as { error?: string }; throw new Error(e.error ?? "Gagal"); }
      return r.json();
    },
    onSuccess: () => {
      toast.success("Pajak di-exclude dari SPT");
      setExcludeDialog(null);
      setExcludeReason("");
      qc.invalidateQueries({ queryKey: ["spt-control-txs"] });
      qc.invalidateQueries({ queryKey: ["spt-control-summary"] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const bulkMut = useMutation({
    mutationFn: async ({ targetStatus, reason }: { targetStatus: string; reason: string }) => {
      const r = await fetch(`/api/tax/spt-control/bulk-update`, {
        method: "POST", credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ period, ids: Array.from(selectedIds), targetStatus, reason, companyId }),
      });
      if (!r.ok) { const e = await r.json().catch(() => ({})) as { error?: string }; throw new Error(e.error ?? "Gagal"); }
      return r.json();
    },
    onSuccess: (data: { updated?: number }) => {
      toast.success(`${data.updated ?? 0} transaksi diperbarui`);
      setBulkDialog(null);
      setBulkReason("");
      setSelectedIds(new Set());
      qc.invalidateQueries({ queryKey: ["spt-control-txs"] });
      qc.invalidateQueries({ queryKey: ["spt-control-summary"] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const rows = data?.data ?? [];
  const total = data?.total ?? 0;
  const totalPages = Math.ceil(total / 50);

  function toggleSelect(id: number) {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  }

  function selectAll() {
    if (selectedIds.size === rows.length) {
      setSelectedIds(new Set());
    } else {
      setSelectedIds(new Set(rows.map((r) => r.id)));
    }
  }

  return (
    <div className="space-y-3">
      {/* Filters + Bulk actions */}
      <div className="flex flex-wrap gap-2 items-center justify-between">
        <div className="flex flex-wrap gap-2">
          <Select value={sptFilter} onValueChange={(v) => { setSptFilter(v); setPage(1); }}>
            <SelectTrigger className="w-36 h-8 text-xs"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">Semua Status</SelectItem>
              <SelectItem value="INCLUDED">Included</SelectItem>
              <SelectItem value="EXCLUDED">Excluded</SelectItem>
              <SelectItem value="PENDING">Pending</SelectItem>
            </SelectContent>
          </Select>
          <form className="flex gap-1" onSubmit={(e) => { e.preventDefault(); setSearch(searchInput); setPage(1); }}>
            <div className="relative">
              <Search className="h-3.5 w-3.5 absolute left-2.5 top-1/2 -translate-y-1/2 text-muted-foreground" />
              <Input className="pl-8 h-8 text-xs w-44" placeholder="Cari referensi / partner…" value={searchInput} onChange={(e) => setSearchInput(e.target.value)} />
            </div>
            <Button type="submit" size="sm" variant="outline" className="h-8 text-xs">Cari</Button>
          </form>
          <Button variant="outline" size="sm" className="h-8" onClick={() => refetch()} disabled={isFetching}>
            <RefreshCw className={`h-3.5 w-3.5 ${isFetching ? "animate-spin" : ""}`} />
          </Button>
        </div>

        {selectedIds.size > 0 && (
          <div className="flex gap-2">
            <span className="text-xs text-muted-foreground self-center">{selectedIds.size} dipilih</span>
            <Button size="sm" variant="outline" className="h-8 text-xs border-emerald-300 text-emerald-700 hover:bg-emerald-50" onClick={() => setBulkDialog("INCLUDED")}>
              <ShieldCheck className="h-3.5 w-3.5 mr-1" />Include Semua
            </Button>
            <Button size="sm" variant="outline" className="h-8 text-xs border-red-300 text-red-600 hover:bg-red-50" onClick={() => setBulkDialog("EXCLUDED")}>
              <ShieldX className="h-3.5 w-3.5 mr-1" />Exclude Semua
            </Button>
          </div>
        )}
      </div>

      {/* Table */}
      <div className="rounded-xl border overflow-hidden shadow-sm">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-muted/60 text-xs uppercase tracking-wide text-muted-foreground">
              <tr>
                <th className="px-3 py-3 w-8">
                  <input type="checkbox" checked={rows.length > 0 && selectedIds.size === rows.length} onChange={selectAll} className="rounded" />
                </th>
                <th className="px-4 py-3 text-left">Referensi</th>
                <th className="px-4 py-3 text-left">Partner</th>
                <th className="px-4 py-3 text-left">Nama Pajak</th>
                <th className="px-4 py-3 text-right">DPP</th>
                <th className="px-4 py-3 text-right">Pajak</th>
                <th className="px-4 py-3 text-center">SPT Status</th>
                <th className="px-4 py-3 text-center">Aksi</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {isLoading && Array.from({ length: 8 }).map((_, i) => (
                <tr key={i}><td colSpan={8} className="px-4 py-3"><div className="h-4 bg-muted rounded animate-pulse" /></td></tr>
              ))}
              {!isLoading && rows.length === 0 && (
                <tr><td colSpan={8} className="text-center py-12 text-muted-foreground text-sm">Tidak ada data untuk periode ini</td></tr>
              )}
              {rows.map((tx) => (
                <tr key={tx.id} className={`hover:bg-muted/30 transition-colors ${selectedIds.has(tx.id) ? "bg-indigo-50/50" : ""}`}>
                  <td className="px-3 py-3">
                    <input type="checkbox" checked={selectedIds.has(tx.id)} onChange={() => toggleSelect(tx.id)} className="rounded" />
                  </td>
                  <td className="px-4 py-3 font-mono text-xs">{tx.transaction_ref ?? "-"}</td>
                  <td className="px-4 py-3 text-xs">{tx.partner_name ?? <span className="text-muted-foreground/60">-</span>}</td>
                  <td className="px-4 py-3">
                    <div className="text-xs font-medium">{tx.tax_name}</div>
                    <div className="text-xs text-muted-foreground">{Number(tx.tax_rate).toFixed(1)}%</div>
                  </td>
                  <td className="px-4 py-3 text-right text-xs">{formatRp(tx.base_amount)}</td>
                  <td className="px-4 py-3 text-right text-sm font-semibold">{formatRp(tx.tax_amount)}</td>
                  <td className="px-4 py-3 text-center">
                    <div className="flex flex-col items-center gap-1">
                      <SptBadge status={tx.spt_status} />
                      {tx.excluded_reason && (
                        <span className="text-[10px] text-muted-foreground max-w-[120px] truncate" title={tx.excluded_reason}>
                          {tx.excluded_reason}
                        </span>
                      )}
                    </div>
                  </td>
                  <td className="px-4 py-3 text-center">
                    <div className="flex items-center justify-center gap-1">
                      <Button
                        variant="ghost" size="icon" className="h-7 w-7"
                        title={tx.spt_status === "INCLUDED" ? "Klik untuk Exclude" : "Klik untuk Include"}
                        onClick={() => toggleMut.mutate(tx.id)}
                        disabled={toggleMut.isPending}
                      >
                        {tx.spt_status === "INCLUDED"
                          ? <ToggleRight className="h-4 w-4 text-emerald-600" />
                          : <ToggleLeft className="h-4 w-4 text-muted-foreground" />}
                      </Button>
                      {tx.spt_status !== "EXCLUDED" && (
                        <Button
                          variant="ghost" size="icon" className="h-7 w-7 text-red-500 hover:text-red-600 hover:bg-red-50"
                          title="Exclude dengan alasan"
                          onClick={() => { setExcludeDialog(tx); setExcludeReason(""); }}
                        >
                          <ShieldX className="h-3.5 w-3.5" />
                        </Button>
                      )}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {/* Pagination */}
      {totalPages > 1 && (
        <div className="flex items-center justify-between">
          <p className="text-xs text-muted-foreground">{total} total · halaman {page} dari {totalPages}</p>
          <div className="flex gap-1">
            <Button variant="outline" size="icon" className="h-8 w-8" disabled={page <= 1} onClick={() => setPage((p) => p - 1)}>
              <ChevronLeft className="h-4 w-4" />
            </Button>
            <Button variant="outline" size="icon" className="h-8 w-8" disabled={page >= totalPages} onClick={() => setPage((p) => p + 1)}>
              <ChevronRight className="h-4 w-4" />
            </Button>
          </div>
        </div>
      )}

      {/* Exclude Dialog */}
      <Dialog open={!!excludeDialog} onOpenChange={(o) => !o && setExcludeDialog(null)}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2 text-red-600">
              <ShieldX className="h-4 w-4" /> Exclude dari SPT
            </DialogTitle>
          </DialogHeader>
          {excludeDialog && (
            <div className="space-y-3 py-2">
              <div className="rounded-lg bg-muted p-3 text-xs space-y-1">
                <p><span className="text-muted-foreground">Ref:</span> {excludeDialog.transaction_ref ?? "-"}</p>
                <p><span className="text-muted-foreground">Pajak:</span> {excludeDialog.tax_name} ({formatRp(excludeDialog.tax_amount)})</p>
              </div>
              <div className="space-y-1.5">
                <Label>Alasan Exclude <span className="text-red-500">*</span></Label>
                <Textarea
                  rows={3}
                  placeholder="Misal: Sudah terlapor di SPT periode sebelumnya / koreksi ganda / dll."
                  value={excludeReason}
                  onChange={(e) => setExcludeReason(e.target.value)}
                />
              </div>
            </div>
          )}
          <DialogFooter>
            <Button variant="outline" onClick={() => setExcludeDialog(null)}>Batal</Button>
            <Button
              variant="destructive"
              disabled={!excludeReason.trim() || excludeMut.isPending}
              onClick={() => excludeDialog && excludeMut.mutate({ id: excludeDialog.id, reason: excludeReason })}
            >
              {excludeMut.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : "Exclude"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Bulk Dialog */}
      <AlertDialog open={!!bulkDialog} onOpenChange={(o) => !o && setBulkDialog(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              {bulkDialog === "INCLUDED" ? "Bulk Include" : "Bulk Exclude"} {selectedIds.size} Transaksi?
            </AlertDialogTitle>
            <AlertDialogDescription asChild>
              <div className="space-y-3">
                <p className="text-sm text-muted-foreground">
                  Status SPT {selectedIds.size} transaksi akan diubah menjadi <strong>{bulkDialog}</strong> untuk periode <strong>{period}</strong>.
                </p>
                {bulkDialog === "EXCLUDED" && (
                  <div className="space-y-1.5">
                    <Label className="text-foreground">Alasan (opsional)</Label>
                    <Textarea
                      rows={2}
                      placeholder="Alasan bulk exclude…"
                      value={bulkReason}
                      onChange={(e) => setBulkReason(e.target.value)}
                    />
                  </div>
                )}
              </div>
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Batal</AlertDialogCancel>
            <AlertDialogAction
              className={bulkDialog === "EXCLUDED" ? "bg-red-600 hover:bg-red-700" : ""}
              onClick={() => bulkDialog && bulkMut.mutate({ targetStatus: bulkDialog, reason: bulkReason })}
            >
              {bulkMut.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : "Konfirmasi"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

// ── Adjustments Tab ───────────────────────────────────────────────────────────

function AdjustmentsTab({ companyId, period }: { companyId: number | null; period: string }) {
  const qc = useQueryClient();
  const [statusFilter, setStatusFilter] = useState("all");
  const [newDialog, setNewDialog] = useState(false);
  const [rejectDialog, setRejectDialog] = useState<Adjustment | null>(null);
  const [rejectReason, setRejectReason] = useState("");
  const [newForm, setNewForm] = useState({
    transactionTaxId: "",
    adjustmentType: "CORRECTION",
    taxAmount: "",
    baseAmount: "",
    reason: "",
  });

  const pAll = new URLSearchParams();
  if (companyId) pAll.set("companyId", String(companyId));
  if (period) pAll.set("period", period);
  if (statusFilter !== "all") pAll.set("status", statusFilter);

  const { data, isLoading, refetch } = useQuery<{ adjustments: Adjustment[] }>({
    queryKey: ["spt-adjustments", companyId, period, statusFilter],
    queryFn: () => fetch(`/api/tax/spt-control/adjustments?${pAll}`, { credentials: "include" }).then((r) => r.json()),
  });

  const createMut = useMutation({
    mutationFn: async () => {
      const body = {
        companyId,
        transactionTaxId: Number(newForm.transactionTaxId),
        adjustmentType: newForm.adjustmentType,
        newValue: { tax_amount: Number(newForm.taxAmount), base_amount: Number(newForm.baseAmount) },
        reason: newForm.reason,
      };
      const r = await fetch(`/api/tax/spt-control/adjustments`, {
        method: "POST", credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      if (!r.ok) { const e = await r.json().catch(() => ({})) as { error?: string }; throw new Error(e.error ?? "Gagal"); }
      return r.json();
    },
    onSuccess: () => {
      toast.success("Adjustment berhasil dibuat");
      setNewDialog(false);
      setNewForm({ transactionTaxId: "", adjustmentType: "CORRECTION", taxAmount: "", baseAmount: "", reason: "" });
      qc.invalidateQueries({ queryKey: ["spt-adjustments"] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const approveMut = useMutation({
    mutationFn: async (id: string) => {
      const p = new URLSearchParams();
      if (companyId) p.set("companyId", String(companyId));
      const r = await fetch(`/api/tax/spt-control/adjustments/${id}/approve?${p}`, { method: "POST", credentials: "include" });
      if (!r.ok) { const e = await r.json().catch(() => ({})) as { error?: string }; throw new Error(e.error ?? "Gagal"); }
      return r.json();
    },
    onSuccess: () => {
      toast.success("Adjustment di-approve");
      qc.invalidateQueries({ queryKey: ["spt-adjustments"] });
      qc.invalidateQueries({ queryKey: ["spt-control-txs"] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const rejectMut = useMutation({
    mutationFn: async ({ id, rejectionReason }: { id: string; rejectionReason: string }) => {
      const p = new URLSearchParams();
      if (companyId) p.set("companyId", String(companyId));
      const r = await fetch(`/api/tax/spt-control/adjustments/${id}/reject?${p}`, {
        method: "POST", credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ rejectionReason }),
      });
      if (!r.ok) { const e = await r.json().catch(() => ({})) as { error?: string }; throw new Error(e.error ?? "Gagal"); }
      return r.json();
    },
    onSuccess: () => {
      toast.success("Adjustment ditolak");
      setRejectDialog(null);
      setRejectReason("");
      qc.invalidateQueries({ queryKey: ["spt-adjustments"] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const rows = data?.adjustments ?? [];

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap gap-2 items-center justify-between">
        <div className="flex gap-2">
          <Select value={statusFilter} onValueChange={setStatusFilter}>
            <SelectTrigger className="w-36 h-8 text-xs"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">Semua Status</SelectItem>
              <SelectItem value="PENDING">Pending</SelectItem>
              <SelectItem value="APPROVED">Approved</SelectItem>
              <SelectItem value="REJECTED">Rejected</SelectItem>
            </SelectContent>
          </Select>
          <Button variant="outline" size="sm" className="h-8" onClick={() => refetch()}>
            <RefreshCw className="h-3.5 w-3.5" />
          </Button>
        </div>
        <Button size="sm" className="h-8 text-xs" onClick={() => setNewDialog(true)}>
          <PlusCircle className="h-3.5 w-3.5 mr-1" />Buat Adjustment
        </Button>
      </div>

      <div className="rounded-xl border overflow-hidden shadow-sm">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-muted/60 text-xs uppercase tracking-wide text-muted-foreground">
              <tr>
                <th className="px-4 py-3 text-left">ID Tx Pajak</th>
                <th className="px-4 py-3 text-left">Tipe</th>
                <th className="px-4 py-3 text-left">Nilai Baru</th>
                <th className="px-4 py-3 text-left">Alasan</th>
                <th className="px-4 py-3 text-left">Dibuat oleh</th>
                <th className="px-4 py-3 text-center">Status</th>
                <th className="px-4 py-3 text-center">Aksi</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {isLoading && Array.from({ length: 5 }).map((_, i) => (
                <tr key={i}><td colSpan={7} className="px-4 py-3"><div className="h-4 bg-muted rounded animate-pulse" /></td></tr>
              ))}
              {!isLoading && rows.length === 0 && (
                <tr><td colSpan={7} className="text-center py-12 text-muted-foreground text-sm">Belum ada adjustment</td></tr>
              )}
              {rows.map((adj) => {
                const nv = adj.new_value as Record<string, number> | null;
                return (
                  <tr key={adj.id} className="hover:bg-muted/30 transition-colors">
                    <td className="px-4 py-3 font-mono text-xs">{adj.transaction_tax_id}</td>
                    <td className="px-4 py-3 text-xs">{ADJ_TYPE_LABEL[adj.adjustment_type] ?? adj.adjustment_type}</td>
                    <td className="px-4 py-3 text-xs">
                      {nv ? (
                        <div>
                          {nv.tax_amount != null && <div>Pajak: {formatRp(nv.tax_amount)}</div>}
                          {nv.base_amount != null && <div>DPP: {formatRp(nv.base_amount)}</div>}
                        </div>
                      ) : "-"}
                    </td>
                    <td className="px-4 py-3 text-xs max-w-[200px]">
                      <p className="truncate" title={adj.reason}>{adj.reason}</p>
                      {adj.rejection_reason && (
                        <p className="text-red-500 truncate text-[10px]" title={adj.rejection_reason}>Ditolak: {adj.rejection_reason}</p>
                      )}
                    </td>
                    <td className="px-4 py-3 text-xs text-muted-foreground">
                      <div>{adj.created_by ?? "-"}</div>
                      <div className="text-[10px]">{fmtDate(adj.created_at)}</div>
                    </td>
                    <td className="px-4 py-3 text-center">
                      <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[11px] font-medium ${ADJ_STATUS_CFG[adj.status] ?? "bg-muted text-muted-foreground"}`}>
                        {adj.status}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-center">
                      {adj.status === "PENDING" && (
                        <div className="flex items-center justify-center gap-1">
                          <Button variant="ghost" size="icon" className="h-7 w-7 text-emerald-600 hover:bg-emerald-50" title="Approve" onClick={() => approveMut.mutate(adj.id)}>
                            <CheckCircle2 className="h-3.5 w-3.5" />
                          </Button>
                          <Button variant="ghost" size="icon" className="h-7 w-7 text-red-500 hover:bg-red-50" title="Reject" onClick={() => { setRejectDialog(adj); setRejectReason(""); }}>
                            <XCircle className="h-3.5 w-3.5" />
                          </Button>
                        </div>
                      )}
                      {adj.status === "APPROVED" && (
                        <span className="text-[10px] text-emerald-600">{adj.approved_by ?? "Approved"}</span>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>

      {/* New Adjustment Dialog */}
      <Dialog open={newDialog} onOpenChange={(o) => !o && setNewDialog(false)}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <ClipboardList className="h-4 w-4" />Buat Adjustment Pajak
            </DialogTitle>
          </DialogHeader>
          <div className="space-y-3 py-2">
            <div className="space-y-1.5">
              <Label>ID Transaksi Pajak <span className="text-red-500">*</span></Label>
              <Input
                type="number"
                placeholder="ID dari tabel transaksi pajak"
                value={newForm.transactionTaxId}
                onChange={(e) => setNewForm((f) => ({ ...f, transactionTaxId: e.target.value }))}
              />
            </div>
            <div className="space-y-1.5">
              <Label>Tipe Adjustment <span className="text-red-500">*</span></Label>
              <Select value={newForm.adjustmentType} onValueChange={(v) => setNewForm((f) => ({ ...f, adjustmentType: v }))}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="CORRECTION">Koreksi</SelectItem>
                  <SelectItem value="REVERSAL">Pembatalan</SelectItem>
                  <SelectItem value="OVERRIDE">Override</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label>Pajak Baru (Rp)</Label>
                <Input type="number" placeholder="0" value={newForm.taxAmount} onChange={(e) => setNewForm((f) => ({ ...f, taxAmount: e.target.value }))} />
              </div>
              <div className="space-y-1.5">
                <Label>DPP Baru (Rp)</Label>
                <Input type="number" placeholder="0" value={newForm.baseAmount} onChange={(e) => setNewForm((f) => ({ ...f, baseAmount: e.target.value }))} />
              </div>
            </div>
            <div className="space-y-1.5">
              <Label>Alasan <span className="text-red-500">*</span></Label>
              <Textarea
                rows={3}
                placeholder="Jelaskan alasan adjustment ini…"
                value={newForm.reason}
                onChange={(e) => setNewForm((f) => ({ ...f, reason: e.target.value }))}
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setNewDialog(false)}>Batal</Button>
            <Button
              disabled={!newForm.transactionTaxId || !newForm.reason.trim() || createMut.isPending}
              onClick={() => createMut.mutate()}
            >
              {createMut.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : "Simpan"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Reject Dialog */}
      <Dialog open={!!rejectDialog} onOpenChange={(o) => !o && setRejectDialog(null)}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2 text-red-600">
              <XCircle className="h-4 w-4" />Tolak Adjustment
            </DialogTitle>
          </DialogHeader>
          <div className="space-y-3 py-2">
            <div className="space-y-1.5">
              <Label>Alasan Penolakan <span className="text-red-500">*</span></Label>
              <Textarea rows={3} placeholder="Jelaskan alasan penolakan…" value={rejectReason} onChange={(e) => setRejectReason(e.target.value)} />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setRejectDialog(null)}>Batal</Button>
            <Button
              variant="destructive"
              disabled={!rejectReason.trim() || rejectMut.isPending}
              onClick={() => rejectDialog && rejectMut.mutate({ id: rejectDialog.id, rejectionReason: rejectReason })}
            >
              {rejectMut.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : "Tolak"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

// ── Audit Log Tab ─────────────────────────────────────────────────────────────

function AuditLogTab({ companyId }: { companyId: number | null }) {
  const [entityType, setEntityType] = useState("all");
  const [action, setAction] = useState("all");

  const p = new URLSearchParams({ limit: "100" });
  if (companyId) p.set("companyId", String(companyId));
  if (entityType !== "all") p.set("entityType", entityType);
  if (action !== "all") p.set("action", action);

  const { data, isLoading, refetch, isFetching } = useQuery<{ logs: AuditLog[] }>({
    queryKey: ["spt-audit-logs", companyId, entityType, action],
    queryFn: () => fetch(`/api/tax/spt-control/audit-logs?${p}`, { credentials: "include" }).then((r) => r.json()),
  });

  const logs = data?.logs ?? [];

  const ACTION_COLOR: Record<string, string> = {
    TOGGLE_INCLUDED:  "bg-emerald-100 text-emerald-700",
    TOGGLE_EXCLUDED:  "bg-red-100 text-red-700",
    EXCLUDE_WITH_REASON: "bg-red-100 text-red-700",
    BULK_UPDATE:      "bg-blue-100 text-blue-700",
    CREATE_ADJUSTMENT: "bg-violet-100 text-violet-700",
    APPROVE_ADJUSTMENT: "bg-emerald-100 text-emerald-700",
    REJECT_ADJUSTMENT: "bg-red-100 text-red-700",
  };

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap gap-2 items-center">
        <Select value={entityType} onValueChange={setEntityType}>
          <SelectTrigger className="w-40 h-8 text-xs"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">Semua Entitas</SelectItem>
            <SelectItem value="transaction_tax">Transaksi Pajak</SelectItem>
            <SelectItem value="tax_adjustment">Adjustment</SelectItem>
          </SelectContent>
        </Select>
        <Select value={action} onValueChange={setAction}>
          <SelectTrigger className="w-48 h-8 text-xs"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">Semua Aksi</SelectItem>
            <SelectItem value="TOGGLE_INCLUDED">Toggle Included</SelectItem>
            <SelectItem value="TOGGLE_EXCLUDED">Toggle Excluded</SelectItem>
            <SelectItem value="EXCLUDE_WITH_REASON">Exclude + Alasan</SelectItem>
            <SelectItem value="BULK_UPDATE">Bulk Update</SelectItem>
            <SelectItem value="CREATE_ADJUSTMENT">Buat Adjustment</SelectItem>
            <SelectItem value="APPROVE_ADJUSTMENT">Approve Adjustment</SelectItem>
            <SelectItem value="REJECT_ADJUSTMENT">Tolak Adjustment</SelectItem>
          </SelectContent>
        </Select>
        <Button variant="outline" size="sm" className="h-8" onClick={() => refetch()} disabled={isFetching}>
          <RefreshCw className={`h-3.5 w-3.5 ${isFetching ? "animate-spin" : ""}`} />
        </Button>
        <span className="text-xs text-muted-foreground ml-auto">{logs.length} entri</span>
      </div>

      <div className="rounded-xl border overflow-hidden shadow-sm">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-muted/60 text-xs uppercase tracking-wide text-muted-foreground">
              <tr>
                <th className="px-4 py-3 text-left">Waktu</th>
                <th className="px-4 py-3 text-left">Entitas</th>
                <th className="px-4 py-3 text-left">Aksi</th>
                <th className="px-4 py-3 text-left">Dilakukan oleh</th>
                <th className="px-4 py-3 text-left">Perubahan</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {isLoading && Array.from({ length: 8 }).map((_, i) => (
                <tr key={i}><td colSpan={5} className="px-4 py-3"><div className="h-4 bg-muted rounded animate-pulse" /></td></tr>
              ))}
              {!isLoading && logs.length === 0 && (
                <tr><td colSpan={5} className="text-center py-12 text-muted-foreground text-sm">Belum ada log aktivitas</td></tr>
              )}
              {logs.map((log) => {
                const before = log.before_data as Record<string, unknown> | null;
                const after  = log.after_data  as Record<string, unknown> | null;
                return (
                  <tr key={log.id} className="hover:bg-muted/30 transition-colors">
                    <td className="px-4 py-3 text-xs text-muted-foreground whitespace-nowrap">{fmtDate(log.timestamp)}</td>
                    <td className="px-4 py-3 text-xs">
                      <div className="font-mono">{log.entity_type}</div>
                      <div className="text-muted-foreground">#{log.entity_id}</div>
                    </td>
                    <td className="px-4 py-3">
                      <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-[11px] font-medium ${ACTION_COLOR[log.action] ?? "bg-muted text-muted-foreground"}`}>
                        {log.action}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-xs">
                      <div>{log.performed_by ?? "-"}</div>
                      {log.ip_address && <div className="text-muted-foreground font-mono text-[10px]">{log.ip_address}</div>}
                    </td>
                    <td className="px-4 py-3 text-xs font-mono max-w-[200px]">
                      {before && <div className="text-muted-foreground truncate" title={JSON.stringify(before)}>← {JSON.stringify(before)}</div>}
                      {after  && <div className="text-foreground truncate" title={JSON.stringify(after)}>→ {JSON.stringify(after)}</div>}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}

// ── Main Page ─────────────────────────────────────────────────────────────────

export default function TaxSptControlPage() {
  const { selectedCompanyId } = useCompany();
  const [period, setPeriod] = useState(currentPeriod());
  const [tab, setTab] = useState("transactions");

  return (
    <AppShell>
      <div className="p-6 space-y-5 max-w-7xl mx-auto">
        <Button variant="ghost" size="sm" className="-ml-2" onClick={() => window.history.back()}>
          <ArrowLeft className="h-4 w-4 mr-1" />Kembali
        </Button>
        {/* Header */}
        <div className="flex items-start justify-between gap-3 flex-wrap">
          <div>
            <h1 className="text-xl font-bold flex items-center gap-2">
              <ShieldCheck className="h-5 w-5 text-indigo-600" />
              SPT Control
            </h1>
            <p className="text-sm text-muted-foreground">Kelola status include/exclude, adjustment, dan audit log pajak per periode</p>
          </div>
          <Select value={period} onValueChange={setPeriod}>
            <SelectTrigger className="w-40">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {PERIODS.map((p) => <SelectItem key={p} value={p}>{p}</SelectItem>)}
            </SelectContent>
          </Select>
        </div>

        {/* Summary Cards */}
        <SummarySection companyId={selectedCompanyId} period={period} />

        {/* Alert: ada pending */}
        <div className="rounded-lg border border-orange-200 bg-orange-50 px-4 py-2.5 flex items-center gap-2 text-xs text-orange-700">
          <AlertTriangle className="h-3.5 w-3.5 shrink-0" />
          <span>Transaksi dengan status <strong>PENDING</strong> belum dikonfirmasi masuk atau tidak masuk SPT. Pastikan semua sudah dikonfirmasi sebelum submit SPT.</span>
        </div>

        {/* Tabs */}
        <Tabs value={tab} onValueChange={setTab}>
          <TabsList className="h-9">
            <TabsTrigger value="transactions" className="text-xs flex items-center gap-1.5">
              <FileText className="h-3.5 w-3.5" />Transaksi Pajak
            </TabsTrigger>
            <TabsTrigger value="adjustments" className="text-xs flex items-center gap-1.5">
              <ClipboardList className="h-3.5 w-3.5" />Adjustment
            </TabsTrigger>
            <TabsTrigger value="audit" className="text-xs flex items-center gap-1.5">
              <ScrollText className="h-3.5 w-3.5" />Audit Log
            </TabsTrigger>
          </TabsList>

          <TabsContent value="transactions" className="mt-4">
            <TransactionsTab companyId={selectedCompanyId} period={period} />
          </TabsContent>

          <TabsContent value="adjustments" className="mt-4">
            <AdjustmentsTab companyId={selectedCompanyId} period={period} />
          </TabsContent>

          <TabsContent value="audit" className="mt-4">
            <AuditLogTab companyId={selectedCompanyId} />
          </TabsContent>
        </Tabs>
      </div>
    </AppShell>
  );
}
