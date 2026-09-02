/**
 * Bank Allocation & Auto-Matching — Sprint 4 Phase 2
 *
 * AI/rule engine hanya MEREKOMENDASIKAN kandidat pencocokan (skor deterministik
 * Amount 40% + Reference 25% + Invoice 15% + Customer 10% + Date 5% + Company 5%).
 * Tidak pernah auto-posting — semua konfirmasi tetap butuh aksi finance secara
 * eksplisit, dan posting jurnal sesungguhnya baru terjadi lewat Allocation Center
 * (submit → approve → post) yang sudah ada, tidak diubah oleh modul ini.
 */
import { useState, useEffect, useCallback } from "react";
import { Link } from "wouter";
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
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Textarea } from "@/components/ui/textarea";
import { Input } from "@/components/ui/input";
import { toast } from "@/hooks/use-toast";
import {
  RefreshCw,
  Sparkles,
  CheckCircle2,
  Eye,
  XCircle,
  AlertTriangle,
  ArrowLeftRight,
  Wand2,
  Link2,
  Plus,
  Trash2,
} from "lucide-react";

// ── Types ──────────────────────────────────────────────────────────────────────

interface UnmatchedRow {
  bank_mutation_id: number;
  amount: string | number;
  description: string | null;
  transaction_date: string;
  company_id: number | null;
  status: string;
}

interface MatchRow {
  id: number;
  bank_mutation_id: number;
  candidate_type: "invoice" | "advance";
  candidate_id: number;
  candidate_ref: string | null;
  candidate_name: string | null;
  candidate_amount: string | number;
  match_score: string | number;
  status: string;
  is_auto_suggested: boolean;
  mutation_amount: string | number;
  mutation_description: string | null;
  transaction_date: string;
  allocation_status: string | null;
  allocation_no: string | null;
}

interface PreviousMutationAllocation {
  id: number;
  transactionDate: string;
  description: string;
  amount: number;
  allocatedAmount: number;
  remainingAmount: number;
  allocationStatus: "UNMATCHED" | "PARTIALLY_MATCHED" | "FULLY_MATCHED";
  allocations: Array<{
    id: number;
    invoiceId: number;
    invoiceRef: string | null;
    amount: number;
    remainingAmount: number;
    groupId: number | null;
    isLinked: boolean;
  }>;
}

interface ExceptionRow {
  id: number;
  bank_mutation_id: number;
  exception_type: string;
  details: Record<string, any> | null;
  status: string;
  mutation_amount: string | number;
  mutation_description: string | null;
  transaction_date: string;
}

interface MutationDetail {
  mutation: any;
  candidates: MatchRow[];
  logs: Array<{ id: number; action: string; actor: string | null; from_status: string | null; to_status: string | null; notes: string | null; created_at: string }>;
}

interface ReportSummary {
  match_rate: number;
  manual_rate: number;
  auto_suggest_rate: number;
  exception_rate: number;
  recovery_time_hours: number | null;
  allocation_accuracy: number;
  open_exceptions: number;
}

const TABS = [
  { key: "unmatched", label: "Unmatched" },
  { key: "suggested", label: "Suggested" },
  { key: "matched", label: "Matched" },
  { key: "posted", label: "Posted" },
  { key: "exceptions", label: "Exceptions" },
] as const;

const EXCEPTION_LABELS: Record<string, string> = {
  NO_CANDIDATE: "Tidak ada kandidat",
  OVERPAYMENT: "Kelebihan bayar",
  UNDERPAYMENT: "Kekurangan bayar",
};

// ── Helpers ────────────────────────────────────────────────────────────────────

function fmt(n: number | string) {
  return new Intl.NumberFormat("id-ID", { style: "decimal", maximumFractionDigits: 0 }).format(Number(n));
}

function fmtDate(d: string) {
  if (!d) return "-";
  try {
    return new Date(d).toLocaleDateString("id-ID", { day: "2-digit", month: "short", year: "numeric" });
  } catch {
    return d;
  }
}

function ScoreBadge({ score, autoSuggested }: { score: number; autoSuggested?: boolean }) {
  const color =
    score >= 95 ? "bg-green-100 text-green-800" :
    score >= 75 ? "bg-blue-100 text-blue-800" :
    score >= 50 ? "bg-yellow-100 text-yellow-800" :
    "bg-gray-100 text-gray-600";
  return (
    <div className="flex items-center gap-1">
      <Badge className={`${color} border-0 text-xs font-semibold`}>{Number(score).toFixed(0)}</Badge>
      {autoSuggested && <Sparkles className="h-3.5 w-3.5 text-amber-500" aria-label="Auto-suggested" />}
    </div>
  );
}

// ── Main Page ──────────────────────────────────────────────────────────────────

export default function BankAllocationPage() {
  const [tab, setTab] = useState<(typeof TABS)[number]["key"]>("unmatched");
  const [rows, setRows] = useState<any[]>([]);
  const [loading, setLoading] = useState(false);
  const [running, setRunning] = useState(false);
  const [summary, setSummary] = useState<ReportSummary | null>(null);

  const [detailOpen, setDetailOpen] = useState(false);
  const [detail, setDetail] = useState<MutationDetail | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [actionLoading, setActionLoading] = useState<number | null>(null);

  const [rejectTarget, setRejectTarget] = useState<number | null>(null);
  const [rejectReason, setRejectReason] = useState("");

  const fetchTab = useCallback(async (t: string) => {
    setLoading(true);
    try {
      const res = await fetch(`/api/bank-allocation/tabs/${t}`, { credentials: "include" });
      if (!res.ok) throw new Error();
      const data = await res.json();
      setRows(data.rows ?? []);
    } catch {
      toast({ title: "Gagal memuat data", variant: "destructive" });
    } finally {
      setLoading(false);
    }
  }, []);

  const fetchSummary = useCallback(async () => {
    try {
      const res = await fetch(`/api/bank-allocation/reports/summary`, { credentials: "include" });
      if (!res.ok) return;
      setSummary(await res.json());
    } catch {}
  }, []);

  useEffect(() => {
    fetchTab(tab);
  }, [tab, fetchTab]);

  useEffect(() => {
    fetchSummary();
  }, [fetchSummary]);

  const runMatching = async () => {
    setRunning(true);
    try {
      const res = await fetch(`/api/bank-allocation/run`, {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({}),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Gagal");
      toast({
        title: "Matching engine selesai",
        description: `${data.scored} mutasi diproses, ${data.auto_suggest} auto-suggest, ${data.exceptions} exception baru.`,
      });
      fetchTab(tab);
      fetchSummary();
    } catch (err: any) {
      toast({ title: err.message ?? "Gagal menjalankan matching", variant: "destructive" });
    } finally {
      setRunning(false);
    }
  };

  const openDetail = async (mutationId: number) => {
    setDetailOpen(true);
    setDetailLoading(true);
    try {
      const res = await fetch(`/api/bank-allocation/mutation/${mutationId}`, { credentials: "include" });
      if (!res.ok) throw new Error();
      setDetail(await res.json());
    } catch {
      toast({ title: "Gagal memuat detail mutasi", variant: "destructive" });
      setDetailOpen(false);
    } finally {
      setDetailLoading(false);
    }
  };

  const doMatchAction = async (matchId: number, action: "select" | "confirm" | "reject", body?: Record<string, any>) => {
    setActionLoading(matchId);
    try {
      const res = await fetch(`/api/bank-allocation/match/${matchId}/${action}`, {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body ?? {}),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Gagal");
      toast({ title: `Berhasil: ${action}`, description: data.allocation_no ? `Alokasi ${data.allocation_no} dibuat (draft)` : undefined });
      fetchTab(tab);
      fetchSummary();
      if (detail?.mutation?.id) openDetail(detail.mutation.id);
      if (action === "reject") {
        setRejectTarget(null);
        setRejectReason("");
      }
    } catch (err: any) {
      toast({ title: err.message ?? `Gagal ${action}`, variant: "destructive" });
    } finally {
      setActionLoading(null);
    }
  };

  const allocateMutation = async (
    mutationId: number,
    allocations: Array<{
      invoiceId: number;
      invoiceRef?: string | null;
      amount: number;
      previousAllocationId?: number | null;
    }>,
  ) => {
    setDetailLoading(true);
    try {
      const res = await fetch(`/api/bank-allocation/mutation/${mutationId}/allocate`, {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ allocations }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Gagal menyimpan allocation");
      toast({
        title: "Allocation tersimpan",
        description: `${data.result?.status ?? "MATCHED"} — sisa mutasi Rp ${fmt(data.result?.remainingAmount ?? 0)}`,
      });
      await fetchTab(tab);
      await fetchSummary();
      await openDetail(mutationId);
    } catch (err: any) {
      toast({ title: err.message ?? "Gagal menyimpan allocation", variant: "destructive" });
    } finally {
      setDetailLoading(false);
    }
  };

  return (
    <div className="flex flex-col gap-6 p-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-slate-900 dark:text-white">Bank Allocation</h1>
          <p className="text-sm text-slate-500 mt-0.5">
            Auto-matching mutasi bank ke invoice/advance — rekomendasi skor, finance tetap memutuskan. Tidak ada posting otomatis.
          </p>
        </div>
        <div className="flex gap-2">
          <Button variant="outline" size="sm" onClick={() => { fetchTab(tab); fetchSummary(); }}>
            <RefreshCw className="h-4 w-4 mr-1.5" /> Refresh
          </Button>
          <Button size="sm" onClick={runMatching} disabled={running}>
            <Wand2 className={`h-4 w-4 mr-1.5 ${running ? "animate-spin" : ""}`} />
            {running ? "Memproses..." : "Jalankan Matching"}
          </Button>
        </div>
      </div>

      {/* Report summary strip */}
      {summary && (
        <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-4">
          <StatCard label="Match Rate" value={`${summary.match_rate}%`} color="text-blue-500" />
          <StatCard label="Manual Rate" value={`${summary.manual_rate}%`} color="text-yellow-500" />
          <StatCard label="Auto-Suggest Rate" value={`${summary.auto_suggest_rate}%`} color="text-amber-500" />
          <StatCard label="Exception Rate" value={`${summary.exception_rate}%`} color="text-red-500" />
          <StatCard label="Recovery Time" value={summary.recovery_time_hours != null ? `${summary.recovery_time_hours} jam` : "-"} color="text-indigo-500" />
          <StatCard label="Allocation Accuracy" value={`${summary.allocation_accuracy}%`} color="text-green-500" />
        </div>
      )}

      <Tabs value={tab} onValueChange={(v) => setTab(v as any)}>
        <TabsList>
          {TABS.map((t) => (
            <TabsTrigger key={t.key} value={t.key}>{t.label}</TabsTrigger>
          ))}
        </TabsList>

        {TABS.map((t) => (
          <TabsContent key={t.key} value={t.key} className="mt-4">
            <Card>
              <CardContent className="pt-4">
                {t.key === "exceptions" ? (
                  <ExceptionTable rows={rows as ExceptionRow[]} loading={loading} onView={openDetail} />
                ) : t.key === "unmatched" ? (
                  <UnmatchedTable rows={rows as UnmatchedRow[]} loading={loading} onView={openDetail} />
                ) : (
                  <MatchTable
                    rows={rows as MatchRow[]}
                    loading={loading}
                    tab={t.key}
                    onView={openDetail}
                    onSelect={(id) => doMatchAction(id, "select")}
                    onConfirm={(id) => doMatchAction(id, "confirm")}
                    onReject={(id) => setRejectTarget(id)}
                    actionLoading={actionLoading}
                  />
                )}
              </CardContent>
            </Card>
          </TabsContent>
        ))}
      </Tabs>

      {/* Detail Dialog */}
      <Dialog open={detailOpen} onOpenChange={setDetailOpen}>
        <DialogContent className="max-w-3xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Detail Mutasi & Kandidat</DialogTitle>
          </DialogHeader>
          {detailLoading ? (
            <div className="flex items-center justify-center py-12">
              <RefreshCw className="h-6 w-6 animate-spin text-slate-400" />
            </div>
          ) : detail ? (
            <MutationDetailView
              detail={detail}
              onSelect={(id) => doMatchAction(id, "select")}
              onConfirm={(id) => doMatchAction(id, "confirm")}
              onReject={(id) => setRejectTarget(id)}
              onAllocate={(allocations) => allocateMutation(detail.mutation.id, allocations)}
              actionLoading={actionLoading}
            />
          ) : null}
        </DialogContent>
      </Dialog>

      {/* Reject reason dialog */}
      <Dialog open={rejectTarget != null} onOpenChange={(o) => !o && setRejectTarget(null)}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Reject Kandidat</DialogTitle>
          </DialogHeader>
          <div className="space-y-3">
            <Textarea
              placeholder="Alasan reject (wajib)..."
              value={rejectReason}
              onChange={(e) => setRejectReason(e.target.value)}
            />
            <div className="flex justify-end gap-2">
              <Button variant="outline" size="sm" onClick={() => setRejectTarget(null)}>Batal</Button>
              <Button
                size="sm"
                variant="destructive"
                disabled={!rejectReason.trim() || actionLoading === rejectTarget}
                onClick={() => rejectTarget != null && doMatchAction(rejectTarget, "reject", { reason: rejectReason })}
              >
                Reject
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}

// ── Sub-components ─────────────────────────────────────────────────────────────

function StatCard({ label, value, color }: { label: string; value: string; color: string }) {
  return (
    <Card className="border border-slate-200">
      <CardContent className="p-4">
        <p className="text-xs text-slate-500 mb-1">{label}</p>
        <p className={`text-lg font-bold ${color}`}>{value}</p>
      </CardContent>
    </Card>
  );
}

function UnmatchedTable({ rows, loading, onView }: { rows: UnmatchedRow[]; loading: boolean; onView: (id: number) => void }) {
  if (loading) return <EmptyState loading />;
  if (!rows.length) return <EmptyState text="Tidak ada mutasi unmatched" />;
  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead>Tanggal</TableHead>
          <TableHead>Deskripsi</TableHead>
          <TableHead className="text-right">Nominal</TableHead>
          <TableHead className="text-right">Aksi</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {rows.map((r) => (
          <TableRow key={r.bank_mutation_id}>
            <TableCell className="text-sm">{fmtDate(r.transaction_date)}</TableCell>
            <TableCell className="text-sm max-w-xs truncate">{r.description ?? "-"}</TableCell>
            <TableCell className="text-right text-sm font-medium">Rp {fmt(r.amount)}</TableCell>
            <TableCell className="text-right">
              <Button variant="ghost" size="sm" onClick={() => onView(r.bank_mutation_id)}>
                <Eye className="h-4 w-4 mr-1" /> Lihat
              </Button>
            </TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  );
}

function MatchTable({
  rows, loading, tab, onView, onSelect, onConfirm, onReject, actionLoading,
}: {
  rows: MatchRow[];
  loading: boolean;
  tab: string;
  onView: (mutationId: number) => void;
  onSelect: (matchId: number) => void;
  onConfirm: (matchId: number) => void;
  onReject: (matchId: number) => void;
  actionLoading: number | null;
}) {
  if (loading) return <EmptyState loading />;
  if (!rows.length) return <EmptyState text={`Tidak ada data di tab ${tab}`} />;
  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead>Tanggal</TableHead>
          <TableHead>Mutasi</TableHead>
          <TableHead>Kandidat</TableHead>
          <TableHead>Skor</TableHead>
          <TableHead>Status</TableHead>
          {tab === "posted" && <TableHead>No. Alokasi</TableHead>}
          <TableHead className="text-right">Aksi</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {rows.map((r) => (
          <TableRow key={r.id}>
            <TableCell className="text-sm">{fmtDate(r.transaction_date)}</TableCell>
            <TableCell className="text-sm">
              <div className="max-w-[180px] truncate">{r.mutation_description ?? "-"}</div>
              <div className="text-xs text-slate-500">Rp {fmt(r.mutation_amount)}</div>
            </TableCell>
            <TableCell className="text-sm">
              <div>{r.candidate_ref ?? r.candidate_name ?? `#${r.candidate_id}`}</div>
              <div className="text-xs text-slate-500 capitalize">{r.candidate_type} — Rp {fmt(r.candidate_amount)}</div>
            </TableCell>
            <TableCell><ScoreBadge score={Number(r.match_score)} autoSuggested={r.is_auto_suggested} /></TableCell>
            <TableCell><Badge variant="outline" className="text-xs">{r.status}</Badge></TableCell>
            {tab === "posted" && <TableCell className="text-sm">{r.allocation_no ?? "-"}</TableCell>}
            <TableCell className="text-right">
              <div className="flex justify-end gap-1">
                <Button variant="ghost" size="sm" onClick={() => onView(r.bank_mutation_id)}>
                  <Eye className="h-4 w-4" />
                </Button>
                {tab === "suggested" && (
                  <Button size="sm" variant="outline" disabled={actionLoading === r.id} onClick={() => onSelect(r.id)}>
                    Pilih
                  </Button>
                )}
                {(tab === "suggested" || tab === "matched") && r.status !== "CONFIRMED" && (
                  <>
                    <Button size="sm" disabled={actionLoading === r.id} onClick={() => onConfirm(r.id)}>
                      <CheckCircle2 className="h-4 w-4 mr-1" /> Confirm
                    </Button>
                    <Button size="sm" variant="ghost" className="text-red-600" disabled={actionLoading === r.id} onClick={() => onReject(r.id)}>
                      <XCircle className="h-4 w-4" />
                    </Button>
                  </>
                )}
              </div>
            </TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  );
}

function ExceptionTable({ rows, loading, onView }: { rows: ExceptionRow[]; loading: boolean; onView: (id: number) => void }) {
  if (loading) return <EmptyState loading />;
  if (!rows.length) return <EmptyState text="Tidak ada exception terbuka" />;
  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead>Tanggal</TableHead>
          <TableHead>Deskripsi</TableHead>
          <TableHead>Tipe</TableHead>
          <TableHead className="text-right">Nominal</TableHead>
          <TableHead className="text-right">Aksi</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {rows.map((r) => (
          <TableRow key={r.id}>
            <TableCell className="text-sm">{fmtDate(r.transaction_date)}</TableCell>
            <TableCell className="text-sm max-w-xs truncate">{r.mutation_description ?? "-"}</TableCell>
            <TableCell>
              <Badge className="bg-red-100 text-red-800 border-0 text-xs">
                <AlertTriangle className="h-3 w-3 mr-1" />
                {EXCEPTION_LABELS[r.exception_type] ?? r.exception_type}
              </Badge>
            </TableCell>
            <TableCell className="text-right text-sm font-medium">Rp {fmt(r.mutation_amount)}</TableCell>
            <TableCell className="text-right">
              <Button variant="ghost" size="sm" onClick={() => onView(r.bank_mutation_id)}>
                <Eye className="h-4 w-4 mr-1" /> Lihat
              </Button>
            </TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  );
}

function MutationDetailView({
  detail, onSelect, onConfirm, onReject, onAllocate, actionLoading,
}: {
  detail: MutationDetail;
  onSelect: (matchId: number) => void;
  onConfirm: (matchId: number) => void;
  onReject: (matchId: number) => void;
  onAllocate: (allocations: Array<{
    invoiceId: number;
    invoiceRef?: string | null;
    amount: number;
    previousAllocationId?: number | null;
  }>) => Promise<void>;
  actionLoading: number | null;
}) {
  const m = detail.mutation;
  const [previousDate, setPreviousDate] = useState(String(m.transaction_date ?? "").slice(0, 10));
  const [previousDescription, setPreviousDescription] = useState("");
  const [previousRows, setPreviousRows] = useState<PreviousMutationAllocation[]>([]);
  const [previousLoading, setPreviousLoading] = useState(false);
  const [allocationLines, setAllocationLines] = useState<Array<{
    invoiceId: number;
    invoiceRef: string;
    amount: string;
    previousAllocationId?: number | null;
  }>>([]);
  const [allocationSaving, setAllocationSaving] = useState(false);

  useEffect(() => {
    setPreviousDate(String(m.transaction_date ?? "").slice(0, 10));
    setPreviousDescription("");
    setPreviousRows([]);
    setAllocationLines([]);
  }, [m.id, m.transaction_date]);

  const searchPrevious = async () => {
    if (!previousDate || !previousDescription.trim()) {
      toast({ title: "Tanggal dan nama/deskripsi wajib diisi", variant: "destructive" });
      return;
    }
    setPreviousLoading(true);
    try {
      const params = new URLSearchParams({
        date: previousDate,
        description: previousDescription.trim(),
      });
      const res = await fetch(`/api/bank-allocation/mutation/${m.id}/previous-allocations?${params}`, {
        credentials: "include",
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Gagal mencari allocation sebelumnya");
      setPreviousRows(data.rows ?? []);
      if (!data.rows?.length) {
        toast({ title: "Tidak ada allocation sebelumnya yang cocok" });
      }
    } catch (err: any) {
      toast({ title: err.message ?? "Gagal mencari allocation sebelumnya", variant: "destructive" });
    } finally {
      setPreviousLoading(false);
    }
  };

  const addAllocationLine = (line: {
    invoiceId: number;
    invoiceRef?: string | null;
    amount?: number;
    previousAllocationId?: number | null;
  }) => {
    if (allocationLines.some((existing) => existing.invoiceId === line.invoiceId)) {
      toast({ title: "Invoice sudah ada di batch allocation", variant: "destructive" });
      return;
    }
    const currentAmount = allocationLines.reduce((sum, existing) => sum + Number(existing.amount || 0), 0);
    const availableMutationAmount = Math.max(0, Number(m.amount ?? 0) - currentAmount);
    const requestedAmount = Math.min(
      availableMutationAmount,
      Math.max(0, Number(line.amount ?? 0)),
    );
    setAllocationLines((existing) => [
      ...existing,
      {
        invoiceId: line.invoiceId,
        invoiceRef: String(line.invoiceRef ?? `#${line.invoiceId}`),
        amount: String(requestedAmount || availableMutationAmount || ""),
        previousAllocationId: line.previousAllocationId ?? null,
      },
    ]);
  };

  const submitAllocations = async () => {
    const payload = allocationLines.map((line) => ({
      invoiceId: line.invoiceId,
      invoiceRef: line.invoiceRef,
      amount: Number(line.amount),
      previousAllocationId: line.previousAllocationId ?? null,
    }));
    const total = payload.reduce((sum, line) => sum + line.amount, 0);
    if (!payload.length || payload.some((line) => !Number.isFinite(line.amount) || line.amount <= 0)) {
      toast({ title: "Isi nominal allocation yang valid", variant: "destructive" });
      return;
    }
    if (total > Number(m.amount ?? 0) + 0.01) {
      toast({ title: "Total allocation melebihi nominal mutasi", variant: "destructive" });
      return;
    }
    setAllocationSaving(true);
    try {
      await onAllocate(payload);
      setAllocationLines([]);
      setPreviousRows([]);
    } finally {
      setAllocationSaving(false);
    }
  };

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 gap-3 text-sm">
        <div><span className="text-slate-500">Tanggal:</span> {fmtDate(m.transaction_date)}</div>
        <div><span className="text-slate-500">Nominal:</span> Rp {fmt(m.amount)}</div>
        <div className="col-span-2"><span className="text-slate-500">Deskripsi:</span> {m.description ?? m.normalized_description ?? "-"}</div>
        <div className="col-span-2 flex items-center gap-2">
          <span className="text-slate-500">Status allocation:</span>
          <Badge variant="outline">{m.allocation_status ?? "UNMATCHED"}</Badge>
          <span className="text-xs text-muted-foreground">
            Rp {fmt(m.allocation_amount ?? 0)} dialokasikan · sisa Rp {fmt(m.allocation_remaining_amount ?? m.amount ?? 0)}
          </span>
        </div>
      </div>

      <section className="rounded-lg border border-indigo-200 bg-indigo-50/60 p-3 space-y-3 dark:border-indigo-800 dark:bg-indigo-950/30">
        <div className="flex items-start gap-2">
          <Link2 className="h-4 w-4 mt-0.5 text-indigo-600 shrink-0" />
          <div>
            <h3 className="text-sm font-semibold text-indigo-950 dark:text-indigo-100">Multi-allocation & Link DP Lama</h3>
            <p className="text-xs text-indigo-800/80 dark:text-indigo-200/80">
              Pilih beberapa invoice untuk satu mutasi. Untuk pelunasan, cari mutasi sebelumnya hanya dengan tanggal dan nama/deskripsi pengirim.
            </p>
          </div>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-[10rem_1fr_auto] gap-2">
          <Input
            type="date"
            value={previousDate}
            onChange={(event) => setPreviousDate(event.target.value)}
            aria-label="Tanggal mutasi sebelumnya"
          />
          <Input
            placeholder="Nama/deskripsi pengirim"
            value={previousDescription}
            onChange={(event) => setPreviousDescription(event.target.value)}
            onKeyDown={(event) => { if (event.key === "Enter") searchPrevious(); }}
            aria-label="Nama atau deskripsi pengirim"
          />
          <Button size="sm" variant="outline" onClick={searchPrevious} disabled={previousLoading}>
            <RefreshCw className={`h-3.5 w-3.5 mr-1.5 ${previousLoading ? "animate-spin" : ""}`} />
            Cari mutasi lama
          </Button>
        </div>

        {previousRows.length > 0 && (
          <div className="space-y-2">
            <p className="text-xs font-semibold text-indigo-950 dark:text-indigo-100">Hasil pencarian — pilih allocation yang akan dikaitkan</p>
            {previousRows.map((previous) => (
              <div key={previous.id} className="rounded border bg-background p-2.5 space-y-2">
                <div className="flex items-start justify-between gap-2 text-xs">
                  <div className="min-w-0">
                    <p className="font-medium truncate">{fmtDate(previous.transactionDate)} · {previous.description || "-"}</p>
                    <p className="text-muted-foreground">
                      Mutasi Rp {fmt(previous.amount)} · sudah dialokasikan Rp {fmt(previous.allocatedAmount)} · sisa Rp {fmt(previous.remainingAmount)}
                    </p>
                  </div>
                  <Badge variant="outline" className="shrink-0 text-[10px]">{previous.allocationStatus}</Badge>
                </div>
                {previous.allocations.map((allocation) => (
                  <div key={allocation.id} className="flex items-center justify-between gap-2 rounded bg-muted/40 px-2 py-1.5 text-xs">
                    <div className="min-w-0">
                      <p className="font-medium truncate">{allocation.invoiceRef ?? `Invoice #${allocation.invoiceId}`}</p>
                      <p className="text-muted-foreground">
                        Allocation Rp {fmt(allocation.amount)} · outstanding invoice Rp {fmt(allocation.remainingAmount)}
                        {allocation.isLinked ? " · sudah dikaitkan" : ""}
                      </p>
                    </div>
                    <Button
                      size="sm"
                      variant="outline"
                      disabled={allocation.isLinked || allocationLines.some((line) => line.invoiceId === allocation.invoiceId)}
                      onClick={() => addAllocationLine({
                        invoiceId: allocation.invoiceId,
                        invoiceRef: allocation.invoiceRef,
                        amount: allocation.remainingAmount,
                        previousAllocationId: allocation.id,
                      })}
                    >
                      <Plus className="h-3.5 w-3.5 mr-1" /> Kaitkan
                    </Button>
                  </div>
                ))}
              </div>
            ))}
          </div>
        )}

        {detail.candidates.filter((candidate) => candidate.candidate_type === "invoice").length > 0 && (
          <div className="space-y-2">
            <p className="text-xs font-semibold text-indigo-950 dark:text-indigo-100">Tambah invoice lain dari kandidat mutasi ini</p>
            <div className="flex flex-wrap gap-2">
              {detail.candidates
                .filter((candidate) => candidate.candidate_type === "invoice")
                .map((candidate) => (
                  <Button
                    key={candidate.id}
                    size="sm"
                    variant="outline"
                    disabled={allocationLines.some((line) => line.invoiceId === candidate.candidate_id)}
                    onClick={() => addAllocationLine({
                      invoiceId: candidate.candidate_id,
                      invoiceRef: candidate.candidate_ref ?? candidate.candidate_name,
                      amount: Math.min(Number(m.amount ?? 0), Number(candidate.candidate_amount ?? 0)),
                    })}
                  >
                    <Plus className="h-3.5 w-3.5 mr-1" />
                    {candidate.candidate_ref ?? `Invoice #${candidate.candidate_id}`}
                  </Button>
                ))}
            </div>
          </div>
        )}

        {allocationLines.length > 0 && (
          <div className="rounded border bg-background p-2.5 space-y-2">
            <div className="flex items-center justify-between text-xs">
              <p className="font-semibold">Allocation baru dari mutasi ini</p>
              <p className="text-muted-foreground">
                Total Rp {fmt(allocationLines.reduce((sum, line) => sum + Number(line.amount || 0), 0))} / Rp {fmt(m.amount)}
              </p>
            </div>
            {allocationLines.map((line, index) => (
              <div key={`${line.invoiceId}-${line.previousAllocationId ?? "new"}`} className="grid grid-cols-[1fr_8rem_auto] items-center gap-2">
                <div className="min-w-0 text-xs truncate">
                  {line.invoiceRef} {line.previousAllocationId ? <span className="text-indigo-600">(link DP #{line.previousAllocationId})</span> : null}
                </div>
                <Input
                  type="number"
                  min="0.01"
                  value={line.amount}
                  onChange={(event) => setAllocationLines((existing) => existing.map((item, itemIndex) => (
                    itemIndex === index ? { ...item, amount: event.target.value } : item
                  )))}
                  aria-label={`Nominal allocation ${line.invoiceRef}`}
                />
                <Button
                  size="icon"
                  variant="ghost"
                  className="text-red-600"
                  onClick={() => setAllocationLines((existing) => existing.filter((_, itemIndex) => itemIndex !== index))}
                  aria-label={`Hapus allocation ${line.invoiceRef}`}
                >
                  <Trash2 className="h-4 w-4" />
                </Button>
              </div>
            ))}
            <Button className="w-full" size="sm" onClick={submitAllocations} disabled={allocationSaving}>
              {allocationSaving ? <RefreshCw className="h-3.5 w-3.5 mr-1.5 animate-spin" /> : <CheckCircle2 className="h-3.5 w-3.5 mr-1.5" />}
              Simpan multi-allocation
            </Button>
            <p className="text-[11px] text-muted-foreground">
              Sisa mutasi boleh tetap ada untuk status PARTIALLY_MATCHED. Allocation lama tidak dipindahkan dan tidak dihitung dua kali.
            </p>
          </div>
        )}
      </section>

      <div>
        <h3 className="text-sm font-semibold mb-2 flex items-center gap-1.5">
          <ArrowLeftRight className="h-4 w-4" /> Kandidat Pencocokan
        </h3>
        {!detail.candidates.length ? (
          <p className="text-sm text-slate-400">Belum ada kandidat — jalankan matching engine.</p>
        ) : (
          <div className="space-y-2">
            {detail.candidates.map((c) => (
              <div key={c.id} className="border rounded-md p-3 flex items-center justify-between">
                <div>
                  <div className="text-sm font-medium">{c.candidate_ref ?? c.candidate_name ?? `#${c.candidate_id}`}</div>
                  <div className="text-xs text-slate-500 capitalize">{c.candidate_type} — Rp {fmt(c.candidate_amount)} — {c.status}</div>
                </div>
                <div className="flex items-center gap-2">
                  <ScoreBadge score={Number(c.match_score)} autoSuggested={c.is_auto_suggested} />
                  {c.status === "CANDIDATE" && (
                    <Button size="sm" variant="outline" disabled={actionLoading === c.id} onClick={() => onSelect(c.id)}>Pilih</Button>
                  )}
                  {(c.status === "CANDIDATE" || c.status === "MATCHED") && (
                    <>
                      <Button size="sm" disabled={actionLoading === c.id} onClick={() => onConfirm(c.id)}>Confirm</Button>
                      <Button size="sm" variant="ghost" className="text-red-600" disabled={actionLoading === c.id} onClick={() => onReject(c.id)}>
                        <XCircle className="h-4 w-4" />
                      </Button>
                    </>
                  )}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {!!detail.logs.length && (
        <div>
          <h3 className="text-sm font-semibold mb-2">Audit Log</h3>
          <div className="space-y-1 text-xs text-slate-500">
            {detail.logs.map((l) => (
              <div key={l.id}>
                {fmtDate(l.created_at)} — <strong>{l.action}</strong> oleh {l.actor ?? "system"} ({l.from_status ?? "-"} → {l.to_status ?? "-"})
                {l.notes ? ` — ${l.notes}` : ""}
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

function EmptyState({ loading, text }: { loading?: boolean; text?: string }) {
  return (
    <div className="flex items-center justify-center py-12 text-sm text-slate-400">
      {loading ? <RefreshCw className="h-5 w-5 animate-spin" /> : text ?? "Tidak ada data"}
    </div>
  );
}
