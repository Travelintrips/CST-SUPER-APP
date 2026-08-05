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
  detail, onSelect, onConfirm, onReject, actionLoading,
}: {
  detail: MutationDetail;
  onSelect: (matchId: number) => void;
  onConfirm: (matchId: number) => void;
  onReject: (matchId: number) => void;
  actionLoading: number | null;
}) {
  const m = detail.mutation;
  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 gap-3 text-sm">
        <div><span className="text-slate-500">Tanggal:</span> {fmtDate(m.transaction_date)}</div>
        <div><span className="text-slate-500">Nominal:</span> Rp {fmt(m.amount)}</div>
        <div className="col-span-2"><span className="text-slate-500">Deskripsi:</span> {m.description ?? m.normalized_description ?? "-"}</div>
      </div>

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
