/**
 * COA Master Governance — Task #5
 *
 * 3-tab UI:
 *   Tab 1: Daftar COA       — full COA list with governance fields
 *   Tab 2: Pending Approval — change-request maker-checker workflow
 *   Tab 3: History          — per-account version history
 *
 * Rules enforced in UI (backend is primary enforcement):
 *   - Maker cannot approve/reject their own request
 *   - Approve/reject buttons hidden unless current user is admin
 *   - No hardcoded company — uses companyQueryParam from CompanyContext
 *   - No direct DB access — all via /api/accounting/coa/* endpoints
 */

import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Link } from "wouter";
import { toast } from "sonner";
import { ArrowLeft, RefreshCw, CheckCircle, XCircle, Clock, Archive, AlertCircle, Brain, Lightbulb, BarChart3, BookOpen, ChevronRight, ChevronDown, Building2 } from "lucide-react";

import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter,
} from "@/components/ui/dialog";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";

import { useCompany } from "@/contexts/CompanyContext";
import { useSupabaseAuth } from "@/contexts/SupabaseAuthContext";
import { useGetCurrentUser, getGetCurrentUserQueryKey } from "@workspace/api-client-react";

// ─── Types ────────────────────────────────────────────────────────────────────

interface CoaAccount {
  id: number;
  companyId: number | null;
  code: string;
  name: string;
  type: string | null;
  subtype: string | null;
  parentId: number | null;
  isActive: boolean | null;
  normalBalance: string | null;
  accountCategory: string | null;
  isPostable: boolean | null;
  isHeader: boolean | null;
  effectiveFrom: string | null;
  effectiveTo: string | null;
  status: string | null;
  version: number | null;
  createdBy: string | null;
  updatedBy: string | null;
  approvedBy: string | null;
  approvedAt: string | null;
  rejectedBy: string | null;
  rejectedAt: string | null;
  rejectionReason: string | null;
  createdAt: string;
  updatedAt: string;
}

interface ChangeRequest {
  id: number;
  companyId: number;
  coaId: number | null;
  action: string;
  status: string;
  beforeSnapshotJson: Record<string, unknown> | null;
  afterSnapshotJson: Record<string, unknown>;
  reason: string;
  requestedBy: string;
  requestedAt: string;
  reviewedBy: string | null;
  reviewedAt: string | null;
  reviewComments: string | null;
  idempotencyKey: string;
  createdAt: string;
  updatedAt: string;
}

interface CoaVersion {
  id: number;
  version: number;
  snapshotJson: Record<string, unknown>;
  changeRequestId: number | null;
  effectiveFrom: string | null;
  effectiveTo: string | null;
  createdBy: string | null;
  approvedBy: string | null;
  createdAt: string;
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

async function apiFetch<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(path, { credentials: "include", ...init });
  const json = await res.json() as { message?: string } & T;
  if (!res.ok) throw new Error((json as { message?: string }).message ?? `HTTP ${res.status}`);
  return json as T;
}

function fmtDate(iso: string | null | undefined) {
  if (!iso) return "—";
  return new Date(iso).toLocaleDateString("id-ID", { day: "2-digit", month: "short", year: "numeric" });
}

function fmtDateTime(iso: string | null | undefined) {
  if (!iso) return "—";
  return new Date(iso).toLocaleString("id-ID", { day: "2-digit", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" });
}

// ─── Status Badges ────────────────────────────────────────────────────────────

const STATUS_VARIANTS: Record<string, { variant: "default" | "secondary" | "destructive" | "outline"; icon: React.ReactNode }> = {
  ACTIVE:           { variant: "default",     icon: <CheckCircle className="w-3 h-3" /> },
  DRAFT:            { variant: "secondary",   icon: <Clock className="w-3 h-3" /> },
  INACTIVE:         { variant: "secondary",   icon: <XCircle className="w-3 h-3" /> },
  ARCHIVED:         { variant: "outline",     icon: <Archive className="w-3 h-3" /> },
  PENDING_APPROVAL: { variant: "outline",     icon: <Clock className="w-3 h-3" /> },
  APPROVED:         { variant: "default",     icon: <CheckCircle className="w-3 h-3" /> },
  REJECTED:         { variant: "destructive", icon: <XCircle className="w-3 h-3" /> },
  CANCELLED:        { variant: "secondary",   icon: <XCircle className="w-3 h-3" /> },
};

function StatusBadge({ status }: { status: string | null }) {
  const s = status ?? "UNKNOWN";
  const cfg = STATUS_VARIANTS[s];
  return (
    <Badge variant={cfg?.variant ?? "outline"} className="gap-1 text-xs">
      {cfg?.icon}
      {s.replace(/_/g, " ")}
    </Badge>
  );
}

// ─── Tab 1: Daftar COA ────────────────────────────────────────────────────────

function DaftarCoaTab({ companyQueryParam }: { companyQueryParam: string }) {
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState<string>("ALL");

  const { data, isLoading, error, refetch } = useQuery<CoaAccount[]>({
    queryKey: ["coa-governance-list", companyQueryParam],
    queryFn: () => apiFetch<CoaAccount[]>(`/api/accounting/coa?${companyQueryParam}`),
  });

  const accounts = data ?? [];
  const filtered = accounts.filter(a => {
    const matchSearch =
      a.code.toLowerCase().includes(search.toLowerCase()) ||
      a.name.toLowerCase().includes(search.toLowerCase()) ||
      (a.accountCategory ?? "").toLowerCase().includes(search.toLowerCase());
    const matchStatus = statusFilter === "ALL" || a.status === statusFilter;
    return matchSearch && matchStatus;
  });

  return (
    <div className="space-y-4">
      <div className="flex gap-2 flex-wrap items-center">
        <Input
          placeholder="Cari kode / nama / kategori…"
          value={search}
          onChange={e => setSearch(e.target.value)}
          className="max-w-xs"
        />
        <Select value={statusFilter} onValueChange={setStatusFilter}>
          <SelectTrigger className="w-44">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="ALL">Semua Status</SelectItem>
            <SelectItem value="ACTIVE">ACTIVE</SelectItem>
            <SelectItem value="DRAFT">DRAFT</SelectItem>
            <SelectItem value="INACTIVE">INACTIVE</SelectItem>
            <SelectItem value="ARCHIVED">ARCHIVED</SelectItem>
          </SelectContent>
        </Select>
        <Button variant="outline" size="icon" onClick={() => refetch()}>
          <RefreshCw className={`w-4 h-4 ${isLoading ? "animate-spin" : ""}`} />
        </Button>
        <span className="text-xs text-muted-foreground ml-auto">{filtered.length} akun</span>
      </div>

      {/* Loading */}
      {isLoading && (
        <div className="flex items-center justify-center py-16 text-muted-foreground">
          <RefreshCw className="w-5 h-5 animate-spin mr-2" /> Memuat daftar COA…
        </div>
      )}

      {/* Error */}
      {!isLoading && error && (
        <div className="flex items-center gap-2 bg-red-50 border border-red-200 text-red-800 rounded-md px-4 py-3 text-sm">
          <AlertCircle className="w-4 h-4 shrink-0" />
          {(error as Error).message}
        </div>
      )}

      {/* Empty */}
      {!isLoading && !error && filtered.length === 0 && (
        <div className="text-center py-16 text-muted-foreground text-sm">
          {accounts.length === 0 ? "Belum ada akun COA." : "Tidak ada akun yang cocok dengan filter."}
        </div>
      )}

      {/* Table */}
      {!isLoading && !error && filtered.length > 0 && (
        <div className="border rounded-lg overflow-auto">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="whitespace-nowrap">Kode</TableHead>
                <TableHead>Nama</TableHead>
                <TableHead>Kategori</TableHead>
                <TableHead>Normal Balance</TableHead>
                <TableHead>Status</TableHead>
                <TableHead className="text-center">Ver.</TableHead>
                <TableHead className="text-center">Header</TableHead>
                <TableHead className="text-center">Postable</TableHead>
                <TableHead>Berlaku Sejak</TableHead>
                <TableHead>Berlaku Sampai</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {filtered.map(a => (
                <TableRow key={a.id}>
                  <TableCell className="font-mono text-sm font-medium">{a.code}</TableCell>
                  <TableCell className="text-sm max-w-[200px] truncate" title={a.name}>{a.name}</TableCell>
                  <TableCell>
                    <span className="text-xs bg-slate-100 text-slate-700 px-1.5 py-0.5 rounded font-mono">
                      {a.accountCategory ?? "—"}
                    </span>
                  </TableCell>
                  <TableCell className="text-xs">{a.normalBalance ?? "—"}</TableCell>
                  <TableCell><StatusBadge status={a.status} /></TableCell>
                  <TableCell className="text-center text-xs font-mono">{a.version ?? "—"}</TableCell>
                  <TableCell className="text-center text-xs">
                    {a.isHeader === true ? "✓" : a.isHeader === false ? "—" : "?"}
                  </TableCell>
                  <TableCell className="text-center text-xs">
                    {a.isPostable === true ? "✓" : a.isPostable === false ? "—" : "?"}
                  </TableCell>
                  <TableCell className="text-xs whitespace-nowrap">{fmtDate(a.effectiveFrom)}</TableCell>
                  <TableCell className="text-xs whitespace-nowrap">{fmtDate(a.effectiveTo)}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}
    </div>
  );
}

// ─── Snapshot Diff ────────────────────────────────────────────────────────────

function SnapshotDiff({
  before, after,
}: { before: Record<string, unknown> | null; after: Record<string, unknown> }) {
  const keys = Array.from(new Set([
    ...Object.keys(before ?? {}),
    ...Object.keys(after),
  ])).sort();

  return (
    <div className="border rounded text-xs font-mono overflow-auto max-h-72">
      <table className="w-full text-left">
        <thead className="bg-slate-50 text-slate-500">
          <tr>
            <th className="px-3 py-1.5 font-medium w-40">Field</th>
            <th className="px-3 py-1.5 font-medium text-red-600 w-1/2">Sebelum</th>
            <th className="px-3 py-1.5 font-medium text-green-700 w-1/2">Sesudah</th>
          </tr>
        </thead>
        <tbody>
          {keys.map(k => {
            const bVal = before ? String(before[k] ?? "—") : "—";
            const aVal = String(after[k] ?? "—");
            const changed = bVal !== aVal;
            return (
              <tr key={k} className={changed ? "bg-yellow-50" : ""}>
                <td className="px-3 py-1 text-slate-600 border-t">{k}</td>
                <td className={`px-3 py-1 border-t ${changed ? "text-red-700 line-through opacity-70" : "text-slate-500"}`}>{bVal}</td>
                <td className={`px-3 py-1 border-t ${changed ? "text-green-700 font-semibold" : "text-slate-500"}`}>{aVal}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

// ─── Tab 2: Pending Approval ──────────────────────────────────────────────────

function PendingApprovalTab({
  companyQueryParam,
  currentActorId,
  isAdmin,
}: {
  companyQueryParam: string;
  currentActorId: string | null;
  isAdmin: boolean;
}) {
  const qc = useQueryClient();
  const [statusFilter, setStatusFilter] = useState<string>("PENDING_APPROVAL");
  const [selectedCr, setSelectedCr] = useState<ChangeRequest | null>(null);
  const [diffOpen, setDiffOpen] = useState(false);
  const [comments, setComments] = useState("");
  const [actionMode, setActionMode] = useState<"approve" | "reject" | null>(null);

  const { data, isLoading, error, refetch } = useQuery<ChangeRequest[]>({
    queryKey: ["coa-change-requests", companyQueryParam, statusFilter],
    queryFn: () => {
      const statusParam = statusFilter !== "ALL" ? `&status=${statusFilter}` : "";
      return apiFetch<ChangeRequest[]>(`/api/accounting/coa/change-requests?${companyQueryParam}${statusParam}`);
    },
  });

  const approve = useMutation({
    mutationFn: ({ id, comments }: { id: number; comments: string }) =>
      apiFetch(`/api/accounting/coa/change-requests/${id}/approve`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ comments }),
      }),
    onSuccess: () => {
      toast.success("Change request disetujui. COA master telah diperbarui.");
      qc.invalidateQueries({ queryKey: ["coa-change-requests"] });
      qc.invalidateQueries({ queryKey: ["coa-governance-list"] });
      setDiffOpen(false);
      setComments("");
      setActionMode(null);
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const reject = useMutation({
    mutationFn: ({ id, comments }: { id: number; comments: string }) =>
      apiFetch(`/api/accounting/coa/change-requests/${id}/reject`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ comments }),
      }),
    onSuccess: () => {
      toast.success("Change request ditolak.");
      qc.invalidateQueries({ queryKey: ["coa-change-requests"] });
      setDiffOpen(false);
      setComments("");
      setActionMode(null);
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const cancel = useMutation({
    mutationFn: (id: number) =>
      apiFetch(`/api/accounting/coa/change-requests/${id}/cancel`, { method: "POST" }),
    onSuccess: () => {
      toast.success("Change request dibatalkan.");
      qc.invalidateQueries({ queryKey: ["coa-change-requests"] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const requests = data ?? [];
  const isPending = approve.isPending || reject.isPending;

  function openDiff(cr: ChangeRequest, mode: "approve" | "reject") {
    setSelectedCr(cr);
    setActionMode(mode);
    setComments("");
    setDiffOpen(true);
  }

  function confirmAction() {
    if (!selectedCr || !actionMode) return;
    if (actionMode === "approve") approve.mutate({ id: selectedCr.id, comments });
    else reject.mutate({ id: selectedCr.id, comments });
  }

  return (
    <div className="space-y-4">
      <div className="flex gap-2 flex-wrap items-center">
        <Select value={statusFilter} onValueChange={setStatusFilter}>
          <SelectTrigger className="w-52">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="ALL">Semua Status</SelectItem>
            <SelectItem value="DRAFT">DRAFT</SelectItem>
            <SelectItem value="PENDING_APPROVAL">PENDING APPROVAL</SelectItem>
            <SelectItem value="APPROVED">APPROVED</SelectItem>
            <SelectItem value="REJECTED">REJECTED</SelectItem>
            <SelectItem value="CANCELLED">CANCELLED</SelectItem>
          </SelectContent>
        </Select>
        <Button variant="outline" size="icon" onClick={() => refetch()}>
          <RefreshCw className={`w-4 h-4 ${isLoading ? "animate-spin" : ""}`} />
        </Button>
        <span className="text-xs text-muted-foreground ml-auto">{requests.length} request</span>
      </div>

      {isLoading && (
        <div className="flex items-center justify-center py-16 text-muted-foreground">
          <RefreshCw className="w-5 h-5 animate-spin mr-2" /> Memuat change requests…
        </div>
      )}

      {!isLoading && error && (
        <div className="flex items-center gap-2 bg-red-50 border border-red-200 text-red-800 rounded-md px-4 py-3 text-sm">
          <AlertCircle className="w-4 h-4 shrink-0" />
          {(error as Error).message}
        </div>
      )}

      {!isLoading && !error && requests.length === 0 && (
        <div className="text-center py-16 text-muted-foreground text-sm">
          Tidak ada change request untuk filter ini.
        </div>
      )}

      {!isLoading && !error && requests.length > 0 && (
        <div className="border rounded-lg overflow-auto">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="w-12">#</TableHead>
                <TableHead>Aksi</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Maker</TableHead>
                <TableHead>Diminta</TableHead>
                <TableHead>Checker</TableHead>
                <TableHead>Direview</TableHead>
                <TableHead>Alasan</TableHead>
                <TableHead></TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {requests.map(cr => {
                const isSelfRequest = currentActorId !== null && cr.requestedBy === currentActorId;
                const canApproveReject = isAdmin && !isSelfRequest && cr.status === "PENDING_APPROVAL";
                const canCancel = cr.status === "DRAFT" || cr.status === "PENDING_APPROVAL";

                return (
                  <TableRow key={cr.id}>
                    <TableCell className="font-mono text-xs">{cr.id}</TableCell>
                    <TableCell>
                      <span className="text-xs bg-indigo-50 text-indigo-700 px-1.5 py-0.5 rounded font-mono">
                        {cr.action.replace(/_/g, " ")}
                      </span>
                    </TableCell>
                    <TableCell><StatusBadge status={cr.status} /></TableCell>
                    <TableCell className="text-xs max-w-[120px] truncate" title={cr.requestedBy}>
                      {cr.requestedBy}
                      {isSelfRequest && (
                        <span className="ml-1 text-amber-600 text-xs">(Anda)</span>
                      )}
                    </TableCell>
                    <TableCell className="text-xs whitespace-nowrap">{fmtDateTime(cr.requestedAt)}</TableCell>
                    <TableCell className="text-xs max-w-[120px] truncate" title={cr.reviewedBy ?? ""}>
                      {cr.reviewedBy ?? "—"}
                    </TableCell>
                    <TableCell className="text-xs whitespace-nowrap">{fmtDateTime(cr.reviewedAt)}</TableCell>
                    <TableCell className="text-xs max-w-[160px] truncate" title={cr.reason}>
                      {cr.reason}
                    </TableCell>
                    <TableCell>
                      <div className="flex gap-1 flex-wrap">
                        {/* Diff / detail */}
                        <Button
                          size="sm"
                          variant="outline"
                          className="h-7 px-2 text-xs"
                          onClick={() => { setSelectedCr(cr); setActionMode(null); setDiffOpen(true); }}
                        >
                          Detail
                        </Button>

                        {/* Approve — admin + not self + pending */}
                        {canApproveReject && (
                          <Button
                            size="sm"
                            variant="default"
                            className="h-7 px-2 text-xs bg-green-600 hover:bg-green-700"
                            onClick={() => openDiff(cr, "approve")}
                          >
                            <CheckCircle className="w-3 h-3 mr-1" />Setuju
                          </Button>
                        )}

                        {/* Reject — admin + not self + pending */}
                        {canApproveReject && (
                          <Button
                            size="sm"
                            variant="destructive"
                            className="h-7 px-2 text-xs"
                            onClick={() => openDiff(cr, "reject")}
                          >
                            <XCircle className="w-3 h-3 mr-1" />Tolak
                          </Button>
                        )}

                        {/* Self-approve warning */}
                        {isAdmin && isSelfRequest && cr.status === "PENDING_APPROVAL" && (
                          <span className="text-xs text-amber-600 italic">tidak bisa self-approve</span>
                        )}

                        {/* Cancel */}
                        {canCancel && (
                          <Button
                            size="sm"
                            variant="ghost"
                            className="h-7 px-2 text-xs text-red-600 hover:text-red-700"
                            onClick={() => cancel.mutate(cr.id)}
                            disabled={cancel.isPending}
                          >
                            Batalkan
                          </Button>
                        )}
                      </div>
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        </div>
      )}

      {/* Detail / Approve / Reject Dialog */}
      <Dialog open={diffOpen} onOpenChange={o => { setDiffOpen(o); if (!o) { setActionMode(null); setComments(""); } }}>
        <DialogContent className="max-w-2xl">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              {actionMode === "approve" && <CheckCircle className="w-4 h-4 text-green-600" />}
              {actionMode === "reject"  && <XCircle   className="w-4 h-4 text-red-600"   />}
              {!actionMode             && <AlertCircle className="w-4 h-4 text-slate-500" />}
              {actionMode === "approve" ? "Setujui Change Request" :
               actionMode === "reject"  ? "Tolak Change Request"   :
               `Detail Change Request #${selectedCr?.id}`}
            </DialogTitle>
          </DialogHeader>

          {selectedCr && (
            <div className="space-y-4">
              {/* Meta info */}
              <div className="grid grid-cols-2 gap-x-6 gap-y-1 text-sm">
                <div className="text-muted-foreground">Aksi</div>
                <div className="font-mono text-xs">{selectedCr.action}</div>
                <div className="text-muted-foreground">Status</div>
                <div><StatusBadge status={selectedCr.status} /></div>
                <div className="text-muted-foreground">Maker</div>
                <div className="text-xs">{selectedCr.requestedBy}</div>
                <div className="text-muted-foreground">Alasan</div>
                <div className="text-xs">{selectedCr.reason}</div>
                {selectedCr.reviewedBy && (
                  <>
                    <div className="text-muted-foreground">Checker</div>
                    <div className="text-xs">{selectedCr.reviewedBy}</div>
                    <div className="text-muted-foreground">Komentar Review</div>
                    <div className="text-xs">{selectedCr.reviewComments ?? "—"}</div>
                  </>
                )}
              </div>

              {/* Before / after diff */}
              <div>
                <p className="text-xs font-semibold text-slate-500 uppercase tracking-wide mb-1">Perbandingan Sebelum / Sesudah</p>
                <SnapshotDiff
                  before={selectedCr.beforeSnapshotJson}
                  after={selectedCr.afterSnapshotJson}
                />
              </div>

              {/* Comments field for approve/reject */}
              {actionMode && (
                <div>
                  <label className="text-sm font-medium">
                    Komentar review {actionMode === "reject" ? "(disarankan)" : "(opsional)"}
                  </label>
                  <textarea
                    className="mt-1 w-full rounded-md border border-input bg-background px-3 py-2 text-sm resize-none h-20 focus:outline-none focus:ring-2 focus:ring-ring"
                    placeholder="Tuliskan komentar…"
                    value={comments}
                    onChange={e => setComments(e.target.value)}
                  />
                </div>
              )}
            </div>
          )}

          <DialogFooter>
            <Button variant="outline" onClick={() => { setDiffOpen(false); setActionMode(null); setComments(""); }}>
              {actionMode ? "Batal" : "Tutup"}
            </Button>
            {actionMode === "approve" && (
              <Button
                className="bg-green-600 hover:bg-green-700"
                onClick={confirmAction}
                disabled={isPending}
              >
                <CheckCircle className="w-4 h-4 mr-1" />
                {isPending ? "Menyetujui…" : "Konfirmasi Setuju"}
              </Button>
            )}
            {actionMode === "reject" && (
              <Button
                variant="destructive"
                onClick={confirmAction}
                disabled={isPending}
              >
                <XCircle className="w-4 h-4 mr-1" />
                {isPending ? "Menolak…" : "Konfirmasi Tolak"}
              </Button>
            )}
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

// ─── Tab 4: Tax Hierarchy Tree ────────────────────────────────────────────────

interface TaxTreeNode {
  code: string;
  name: string;
  isHeader: boolean | null;
  isPostable: boolean | null;
  status: string | null;
  accountCategory: string | null;
  normalBalance: string | null;
  children: TaxTreeNode[];
}

function buildTaxTree(accounts: CoaAccount[]): TaxTreeNode[] {
  const byId = new Map(accounts.map((a) => [a.id, a]));
  const byCode = new Map(accounts.map((a) => [a.code, a]));

  // Tax header base codes and their roots
  // NOTE: 2-1060 is occupied by Hutang Intercompany; safe header code is 2-1090
  const TAX_HEADER_PATTERNS = ["2-1090-", "1-1070-", "5-3040-"];

  function toNode(a: CoaAccount, children: TaxTreeNode[]): TaxTreeNode {
    return {
      code: a.code,
      name: a.name,
      isHeader: a.isHeader,
      isPostable: a.isPostable,
      status: a.status,
      accountCategory: a.accountCategory,
      normalBalance: a.normalBalance,
      children,
    };
  }

  // Find children by parentId
  const childrenById = new Map<number, CoaAccount[]>();
  for (const a of accounts) {
    if (a.parentId != null) {
      const arr = childrenById.get(a.parentId) ?? [];
      arr.push(a);
      childrenById.set(a.parentId, arr);
    }
  }

  function buildSubTree(a: CoaAccount): TaxTreeNode {
    const kids = (childrenById.get(a.id) ?? []).sort((x, y) => x.code.localeCompare(y.code));
    return toNode(a, kids.map(buildSubTree));
  }

  // Collect tax headers (accounts whose code starts with a tax header pattern)
  const taxHeaders = accounts.filter((a) =>
    TAX_HEADER_PATTERNS.some((p) => a.code.startsWith(p)) && (a.isHeader === true)
  );

  // Also include existing reparented accounts (2-1030, 5-3020, 1-1050) as tree members
  const allTaxRoots = taxHeaders.sort((a, b) => a.code.localeCompare(b.code));

  return allTaxRoots.map(buildSubTree);
}

function TaxTreeNodeRow({
  node,
  depth = 0,
}: {
  node: TaxTreeNode;
  depth?: number;
}) {
  const [open, setOpen] = useState(true);
  const hasChildren = node.children.length > 0;

  const categoryColor: Record<string, string> = {
    LIABILITY: "bg-purple-50 text-purple-700",
    ASSET: "bg-blue-50 text-blue-700",
    EXPENSE: "bg-orange-50 text-orange-700",
    OTHER_EXPENSE: "bg-red-50 text-red-700",
  };
  const catClass = categoryColor[node.accountCategory ?? ""] ?? "bg-slate-50 text-slate-700";

  return (
    <>
      <TableRow className={node.isHeader ? "bg-slate-50 font-medium" : ""}>
        <TableCell style={{ paddingLeft: `${8 + depth * 20}px` }} className="py-2">
          <div className="flex items-center gap-1">
            {hasChildren ? (
              <button onClick={() => setOpen(!open)} className="text-slate-400 hover:text-slate-700 shrink-0">
                {open ? <ChevronDown className="w-3.5 h-3.5" /> : <ChevronRight className="w-3.5 h-3.5" />}
              </button>
            ) : (
              <span className="w-3.5 shrink-0" />
            )}
            <span className="font-mono text-xs">{node.code}</span>
          </div>
        </TableCell>
        <TableCell className="py-2 text-sm max-w-[200px] truncate" title={node.name}>
          {node.name}
        </TableCell>
        <TableCell className="py-2">
          <span className={`text-xs px-1.5 py-0.5 rounded font-mono ${catClass}`}>
            {node.accountCategory ?? "—"}
          </span>
        </TableCell>
        <TableCell className="py-2 text-center">
          {node.isHeader ? (
            <Badge variant="outline" className="text-xs bg-yellow-50 border-yellow-300 text-yellow-800">HEADER</Badge>
          ) : (
            <Badge variant="secondary" className="text-xs">Postable</Badge>
          )}
        </TableCell>
        <TableCell className="py-2 text-center text-xs">{node.normalBalance ?? "—"}</TableCell>
        <TableCell className="py-2">
          <StatusBadge status={node.status} />
        </TableCell>
      </TableRow>
      {open && node.children.map((child) => (
        <TaxTreeNodeRow key={child.code} node={child} depth={depth + 1} />
      ))}
    </>
  );
}

function TaxHierarchyTab({ companyQueryParam }: { companyQueryParam: string }) {
  const { data, isLoading, error, refetch } = useQuery<CoaAccount[]>({
    queryKey: ["coa-governance-list", companyQueryParam],
    queryFn: () => apiFetch<CoaAccount[]>(`/api/accounting/coa?${companyQueryParam}`),
  });

  const accounts = data ?? [];
  const taxTrees = buildTaxTree(accounts);

  const TAX_GROUP_LABELS: Record<string, string> = {
    "2-1090-": "A. Kewajiban Pajak",
    "1-1070-": "B. Aset Pajak",
    "5-3040-": "C. Beban Pajak",
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-2 flex-wrap">
        <div className="flex items-center gap-2 text-sm text-muted-foreground">
          <Building2 className="w-4 h-4" />
          <span>Tree hierarki akun pajak — header tidak dapat diposting, subakun postable.</span>
        </div>
        <Button variant="outline" size="icon" className="ml-auto" onClick={() => refetch()}>
          <RefreshCw className={`w-4 h-4 ${isLoading ? "animate-spin" : ""}`} />
        </Button>
      </div>

      {isLoading && (
        <div className="flex items-center justify-center py-16 text-muted-foreground">
          <RefreshCw className="w-5 h-5 animate-spin mr-2" /> Memuat hierarki pajak…
        </div>
      )}

      {!isLoading && error && (
        <div className="flex items-center gap-2 bg-red-50 border border-red-200 text-red-800 rounded-md px-4 py-3 text-sm">
          <AlertCircle className="w-4 h-4 shrink-0" />
          {(error as Error).message}
        </div>
      )}

      {!isLoading && !error && taxTrees.length === 0 && (
        <div className="text-center py-16 text-muted-foreground text-sm space-y-2">
          <p>Hierarki pajak belum tersedia untuk perusahaan ini.</p>
          <p className="text-xs">Jalankan <code className="bg-slate-100 px-1 py-0.5 rounded">runCoaTaxMigration()</code> dan setujui change requests di tab Pending Approval.</p>
        </div>
      )}

      {!isLoading && !error && taxTrees.length > 0 && (
        <div className="border rounded-lg overflow-auto">
          <Table>
            <TableHeader>
              <TableRow className="bg-slate-50">
                <TableHead className="whitespace-nowrap">Kode</TableHead>
                <TableHead>Nama</TableHead>
                <TableHead>Kategori</TableHead>
                <TableHead className="text-center">Tipe</TableHead>
                <TableHead className="text-center">Normal Balance</TableHead>
                <TableHead>Status</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {taxTrees.map((tree) => (
                <TaxTreeNodeRow key={tree.code} node={tree} depth={0} />
              ))}
            </TableBody>
          </Table>
        </div>
      )}

      <div className="border rounded-lg p-4 bg-amber-50 border-amber-200 text-sm space-y-1">
        <p className="font-semibold text-amber-800">Catatan Restrukturisasi</p>
        <ul className="text-amber-700 text-xs space-y-1 list-disc list-inside">
          <li>Akun header (badge kuning) tidak dapat digunakan untuk posting jurnal.</li>
          <li>Akun existing (2-1030, 5-3020, 1-1050) hanya di-reparent — kode dan jurnal historis tidak berubah.</li>
          <li>Perubahan parent memerlukan approval checker di tab Pending Approval.</li>
          <li>Untuk pajak bunga bank: gunakan <strong>Beban PPh Final atas Bunga Bank</strong> (5-3044).</li>
        </ul>
      </div>
    </div>
  );
}

// ─── Tab 3: History ───────────────────────────────────────────────────────────

function HistoryTab({ companyQueryParam }: { companyQueryParam: string }) {
  const [selectedId, setSelectedId] = useState<string>("");

  const { data: accounts, isLoading: accountsLoading } = useQuery<CoaAccount[]>({
    queryKey: ["coa-governance-list", companyQueryParam],
    queryFn: () => apiFetch<CoaAccount[]>(`/api/accounting/coa?${companyQueryParam}`),
  });

  const { data: versions, isLoading: versionsLoading, error: versionsError } = useQuery<CoaVersion[]>({
    queryKey: ["coa-history", selectedId],
    queryFn: () => apiFetch<CoaVersion[]>(`/api/accounting/coa/${selectedId}/history`),
    enabled: !!selectedId,
  });

  const accountList = accounts ?? [];

  return (
    <div className="space-y-4">
      <div className="flex gap-2 items-center flex-wrap">
        <Select value={selectedId} onValueChange={setSelectedId}>
          <SelectTrigger className="w-80">
            <SelectValue placeholder="Pilih akun COA untuk melihat history…" />
          </SelectTrigger>
          <SelectContent>
            {accountsLoading && <SelectItem value="__loading" disabled>Memuat…</SelectItem>}
            {accountList.map(a => (
              <SelectItem key={a.id} value={String(a.id)}>
                {a.code} — {a.name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      {!selectedId && (
        <div className="text-center py-16 text-muted-foreground text-sm">
          Pilih akun COA di atas untuk menampilkan riwayat versi.
        </div>
      )}

      {selectedId && versionsLoading && (
        <div className="flex items-center justify-center py-16 text-muted-foreground">
          <RefreshCw className="w-5 h-5 animate-spin mr-2" /> Memuat riwayat…
        </div>
      )}

      {selectedId && !versionsLoading && versionsError && (
        <div className="flex items-center gap-2 bg-red-50 border border-red-200 text-red-800 rounded-md px-4 py-3 text-sm">
          <AlertCircle className="w-4 h-4 shrink-0" />
          {(versionsError as Error).message}
        </div>
      )}

      {selectedId && !versionsLoading && !versionsError && (versions ?? []).length === 0 && (
        <div className="text-center py-12 text-muted-foreground text-sm">
          Belum ada riwayat versi untuk akun ini.
        </div>
      )}

      {selectedId && !versionsLoading && !versionsError && (versions ?? []).length > 0 && (
        <div className="space-y-3">
          {(versions ?? []).map(v => (
            <div key={v.id} className="border rounded-lg p-4 space-y-3">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <span className="text-xs font-mono bg-indigo-50 text-indigo-700 px-2 py-0.5 rounded">
                    v{v.version}
                  </span>
                  {v.changeRequestId && (
                    <span className="text-xs text-muted-foreground">CR #{v.changeRequestId}</span>
                  )}
                </div>
                <span className="text-xs text-muted-foreground">{fmtDateTime(v.createdAt)}</span>
              </div>

              <div className="grid grid-cols-2 gap-x-6 gap-y-0.5 text-xs">
                <div className="text-muted-foreground">Dibuat oleh</div>
                <div>{v.createdBy ?? "—"}</div>
                <div className="text-muted-foreground">Disetujui oleh</div>
                <div>{v.approvedBy ?? "—"}</div>
                {v.effectiveFrom && (
                  <>
                    <div className="text-muted-foreground">Berlaku sejak</div>
                    <div>{fmtDate(v.effectiveFrom)}</div>
                  </>
                )}
                {v.effectiveTo && (
                  <>
                    <div className="text-muted-foreground">Berlaku sampai</div>
                    <div>{fmtDate(v.effectiveTo)}</div>
                  </>
                )}
              </div>

              <details className="text-xs">
                <summary className="cursor-pointer text-muted-foreground hover:text-foreground select-none">
                  Lihat snapshot JSON
                </summary>
                <pre className="mt-2 bg-slate-50 border rounded p-3 overflow-auto max-h-48 text-xs leading-relaxed">
                  {JSON.stringify(v.snapshotJson, null, 2)}
                </pre>
              </details>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ─── Main Page ────────────────────────────────────────────────────────────────

// ─── Tab 4: AI Recommendation ────────────────────────────────────────────────

function AiRecommendationTab() {
  return (
    <div className="space-y-6">
      <p className="text-sm text-muted-foreground">
        Rekomendasi AI untuk COA, rule, dan learning patterns. Klik link di bawah untuk melihat detail.
      </p>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        <a
          href="/ai/review/recommendations"
          className="flex items-start gap-3 p-4 rounded-lg border hover:bg-muted/50 transition-colors group"
        >
          <Lightbulb className="h-5 w-5 text-amber-500 mt-0.5 shrink-0" />
          <div>
            <p className="text-sm font-semibold group-hover:text-indigo-600 transition-colors">
              Rule Recommendation
            </p>
            <p className="text-xs text-muted-foreground mt-0.5">
              Rule yang diusulkan AI dari pola transaksi — perlu persetujuan manusia
            </p>
          </div>
        </a>
        <a
          href="/ai/review/learning"
          className="flex items-start gap-3 p-4 rounded-lg border hover:bg-muted/50 transition-colors group"
        >
          <Brain className="h-5 w-5 text-violet-500 mt-0.5 shrink-0" />
          <div>
            <p className="text-sm font-semibold group-hover:text-indigo-600 transition-colors">
              Learning Recommendation
            </p>
            <p className="text-xs text-muted-foreground mt-0.5">
              Pola yang ditemukan AI dari histori keputusan reviewer
            </p>
          </div>
        </a>
        <a
          href="/ai/review/statistics"
          className="flex items-start gap-3 p-4 rounded-lg border hover:bg-muted/50 transition-colors group"
        >
          <BarChart3 className="h-5 w-5 text-teal-500 mt-0.5 shrink-0" />
          <div>
            <p className="text-sm font-semibold group-hover:text-indigo-600 transition-colors">
              COA Recommendation
            </p>
            <p className="text-xs text-muted-foreground mt-0.5">
              Statistik akurasi AI dan rekomendasi perubahan COA
            </p>
          </div>
        </a>
        <a
          href="/ai/review"
          className="flex items-start gap-3 p-4 rounded-lg border hover:bg-muted/50 transition-colors group"
        >
          <BookOpen className="h-5 w-5 text-indigo-500 mt-0.5 shrink-0" />
          <div>
            <p className="text-sm font-semibold group-hover:text-indigo-600 transition-colors">
              Proposal Recommendation
            </p>
            <p className="text-xs text-muted-foreground mt-0.5">
              AI Review queue — kasus yang memerlukan review manual
            </p>
          </div>
        </a>
      </div>
    </div>
  );
}

export default function CoaGovernancePage() {
  const { companyQueryParam } = useCompany();
  const { user } = useSupabaseAuth();
  const { data: dbUser } = useGetCurrentUser({
    query: {
      enabled: !!user,
      queryKey: getGetCurrentUserQueryKey(),
      staleTime: 5 * 60 * 1000,
      retry: 1,
    },
  });

  // Actor ID for maker-checker UI enforcement (backend is primary)
  const currentActorId = dbUser?.id ?? dbUser?.email ?? user?.email ?? null;
  const isAdmin = dbUser?.role === "admin";

  return (
    <div className="p-6 space-y-5">
      {/* Header */}
      <div className="flex items-center gap-3">
        <Link href="/accounting">
          <Button variant="ghost" size="icon" aria-label="Kembali">
            <ArrowLeft className="h-4 w-4" />
          </Button>
        </Link>
        <div>
          <h1 className="text-2xl font-semibold">COA Master Governance</h1>
          <p className="text-sm text-muted-foreground">
            Task #5 — Maker-checker workflow untuk Chart of Accounts
          </p>
        </div>
      </div>

      {/* Tabs */}
      <Tabs defaultValue="daftar-coa">
        <TabsList>
          <TabsTrigger value="daftar-coa">Daftar COA</TabsTrigger>
          <TabsTrigger value="pending-approval">Pending Approval</TabsTrigger>
          <TabsTrigger value="history">History</TabsTrigger>
          <TabsTrigger value="ai-recommendation" className="gap-1">
            <Brain className="h-3.5 w-3.5" />
            AI Recommendation
          </TabsTrigger>
          <TabsTrigger value="tax-hierarchy">Hierarki Pajak</TabsTrigger>
        </TabsList>

        <TabsContent value="daftar-coa" className="mt-4">
          <DaftarCoaTab companyQueryParam={companyQueryParam} />
        </TabsContent>

        <TabsContent value="pending-approval" className="mt-4">
          <PendingApprovalTab
            companyQueryParam={companyQueryParam}
            currentActorId={currentActorId}
            isAdmin={isAdmin}
          />
        </TabsContent>

        <TabsContent value="history" className="mt-4">
          <HistoryTab companyQueryParam={companyQueryParam} />
        </TabsContent>

        <TabsContent value="ai-recommendation" className="mt-4">
          <AiRecommendationTab />
        </TabsContent>

        <TabsContent value="tax-hierarchy" className="mt-4">
          <TaxHierarchyTab companyQueryParam={companyQueryParam} />
        </TabsContent>
      </Tabs>
    </div>
  );
}
