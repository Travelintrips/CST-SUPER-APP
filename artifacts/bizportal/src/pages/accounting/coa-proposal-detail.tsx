/**
 * AI COA Proposal Detail — Task #7 Phase 19
 *
 * Route: /accounting/coa-proposals/:id
 *
 * Shows full proposal context:
 * - Source transaction, detected intent, mapping error
 * - Proposed account: code, name, parent, category, normal balance, header/postable, effective date
 * - AI confidence, reasons, evidence, alternative accounts
 * - Duplicate warning, historical sample, estimated future usage
 * - Trial balance / balance sheet / P&L / tax impact
 * - Audit timeline, version history
 *
 * Action buttons (visible based on status + permissions):
 * - Edit Draft (maker, DRAFT only)
 * - Submit (maker, DRAFT)
 * - Approve (admin only, PENDING_REVIEW — hidden from maker)
 * - Reject (admin only, PENDING_REVIEW)
 * - Cancel (maker, DRAFT or PENDING_REVIEW)
 * - Implement (APPROVED)
 *
 * Backend is the primary enforcement — UI hides/shows buttons as UX convenience only.
 */

import { useState } from "react";
import { useRoute, Link, useLocation } from "wouter";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import {
  Brain,
  ArrowLeft,
  RefreshCw,
  CheckCircle,
  XCircle,
  Clock,
  AlertCircle,
  ShieldAlert,
  Info,
  ChevronDown,
  ChevronRight,
  Loader2,
  History,
} from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter,
} from "@/components/ui/dialog";
import { Textarea } from "@/components/ui/textarea";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import { Separator } from "@/components/ui/separator";

import { useCompany } from "@/contexts/CompanyContext";
import { useSupabaseAuth } from "@/contexts/SupabaseAuthContext";

// ─── Types ────────────────────────────────────────────────────────────────────

interface CoaProposal {
  id: number;
  companyId: number;
  proposalNumber: string;
  status: string;
  sourceType: string;
  sourceRecordId: string | null;
  detectedIntent: string | null;
  normalizedDescription: string | null;
  missingMappingType: string | null;
  proposedCode: string;
  proposedName: string;
  proposedParentId: number | null;
  proposedCategory: string;
  proposedNormalBalance: string;
  proposedIsHeader: boolean;
  proposedIsPostable: boolean;
  proposedEffectiveFrom: string | null;
  financialStatement: string;
  aiConfidence: number | null;
  historicalOccurrences: number | null;
  estimatedMonthlyUsage: number | null;
  reasonJson: string[] | null;
  evidenceJson: unknown[] | null;
  impactAnalysisJson: Record<string, string> | null;
  alternativeAccountsJson: unknown[] | null;
  createdBy: string;
  submittedBy: string | null;
  reviewedBy: string | null;
  approvedBy: string | null;
  implementedBy: string | null;
  rejectionReason: string | null;
  reviewComments: string | null;
  createdAt: string;
  submittedAt: string | null;
  reviewedAt: string | null;
  approvedAt: string | null;
  implementedAt: string | null;
  rejectedAt: string | null;
  cancelledAt: string | null;
}

interface AuditEvent {
  id: number;
  eventType: string;
  actorId: string;
  previousStatus: string | null;
  newStatus: string | null;
  reason: string | null;
  occurredAt: string;
}

interface VersionRecord {
  id: number;
  version: number;
  changeReason: string | null;
  createdBy: string;
  createdAt: string;
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function statusBadge(status: string) {
  const map: Record<string, { label: string; variant: "default" | "secondary" | "destructive" | "outline" }> = {
    DRAFT:          { label: "Draft",           variant: "secondary" },
    PENDING_REVIEW: { label: "Pending Review",  variant: "outline" },
    APPROVED:       { label: "Approved",        variant: "default" },
    REJECTED:       { label: "Rejected",        variant: "destructive" },
    IMPLEMENTED:    { label: "Implemented",     variant: "default" },
    CANCELLED:      { label: "Cancelled",       variant: "secondary" },
  };
  const cfg = map[status] ?? { label: status, variant: "secondary" as const };
  return <Badge variant={cfg.variant}>{cfg.label}</Badge>;
}

function fmtDate(s: string | null) {
  if (!s) return "—";
  return new Date(s).toLocaleString("id-ID", {
    day: "2-digit", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit",
  });
}

function Section({ title, children, defaultOpen = true }: {
  title: string;
  children: React.ReactNode;
  defaultOpen?: boolean;
}) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <div className="border rounded-lg overflow-hidden">
      <button
        className="w-full flex items-center justify-between px-4 py-3 bg-muted/30 hover:bg-muted/50 text-sm font-semibold text-left"
        onClick={() => setOpen(!open)}
      >
        {title}
        {open ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
      </button>
      {open && <div className="p-4 space-y-3">{children}</div>}
    </div>
  );
}

function InfoRow({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="flex gap-3 text-sm">
      <span className="w-44 text-muted-foreground shrink-0">{label}</span>
      <span className="font-medium">{value ?? "—"}</span>
    </div>
  );
}

// ─── API Helpers ──────────────────────────────────────────────────────────────

function useProposal(id: number, companyParam: string) {
  return useQuery<CoaProposal>({
    queryKey: ["coa-proposal", id, companyParam],
    queryFn: async () => {
      const res = await fetch(
        `/api/accounting/coa-proposals/${id}${companyParam ? `?company=${companyParam}` : ""}`,
        { credentials: "include" },
      );
      if (!res.ok) throw new Error("Not found");
      return res.json();
    },
  });
}

function useAudit(id: number, companyParam: string) {
  return useQuery<AuditEvent[]>({
    queryKey: ["coa-proposal-audit", id, companyParam],
    queryFn: async () => {
      const res = await fetch(
        `/api/accounting/coa-proposals/${id}/audit${companyParam ? `?company=${companyParam}` : ""}`,
        { credentials: "include" },
      );
      if (!res.ok) throw new Error("Failed");
      return res.json();
    },
  });
}

function useVersions(id: number, companyParam: string) {
  return useQuery<VersionRecord[]>({
    queryKey: ["coa-proposal-versions", id, companyParam],
    queryFn: async () => {
      const res = await fetch(
        `/api/accounting/coa-proposals/${id}/history${companyParam ? `?company=${companyParam}` : ""}`,
        { credentials: "include" },
      );
      if (!res.ok) throw new Error("Failed");
      return res.json();
    },
  });
}

  async function callAction(id: number, action: string, body: Record<string, unknown> = {}, companyParam: string) {
  const res = await fetch(
    `/api/accounting/coa-proposals/${id}/${action}${companyParam ? `?company=${companyParam}` : ""}`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      credentials: "include",
      body: JSON.stringify(body),
    },
  );
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const error = new Error(data.error ?? res.statusText) as Error & { status?: number };
    error.status = res.status;
    throw error;
  }
  return data;
}

// ─── Main Page ────────────────────────────────────────────────────────────────

export default function CoaProposalDetailPage() {
  const [, params] = useRoute("/accounting/coa-proposals/:id");
  const id = Number(params?.id);

  const { companyQueryParam } = useCompany();
  const { user } = useSupabaseAuth();
  const qc = useQueryClient();
  const [, navigate] = useLocation();

  const { data: proposal, isLoading, error } = useProposal(id, companyQueryParam);
  const auditQ = useAudit(id, companyQueryParam);
  const versionsQ = useVersions(id, companyQueryParam);

  const [rejectDialog, setRejectDialog] = useState(false);
  const [reviewDialog, setReviewDialog] = useState(false);
  const [rejectionReason, setRejectionReason] = useState("");
  const [reviewComments, setReviewComments] = useState("");

  function invalidate() {
    qc.invalidateQueries({ queryKey: ["coa-proposal", id] });
    qc.invalidateQueries({ queryKey: ["coa-proposal-audit", id] });
    qc.invalidateQueries({ queryKey: ["coa-proposal-versions", id] });
    qc.invalidateQueries({ queryKey: ["coa-proposals"] });
  }

  const submitMut = useMutation({
    mutationFn: () => callAction(id, "submit", {}, companyQueryParam),
    onSuccess: () => { toast.success("Proposal disubmit untuk review."); invalidate(); },
    onError: (e: Error) => toast.error(e.message),
  });

  const approveMut = useMutation({
    mutationFn: () => callAction(id, "approve", { reviewComments }, companyQueryParam),
    onSuccess: () => { toast.success("Proposal disetujui."); setReviewDialog(false); invalidate(); },
    onError: (e: Error) => toast.error(e.message),
  });

  const rejectMut = useMutation({
    mutationFn: () => callAction(id, "reject", { rejectionReason }, companyQueryParam),
    onSuccess: () => { toast.success("Proposal ditolak."); setRejectDialog(false); invalidate(); },
    onError: (e: Error) => toast.error(e.message),
  });

  const cancelMut = useMutation({
    mutationFn: () => callAction(id, "cancel", {}, companyQueryParam),
    onSuccess: () => { toast.success("Proposal dibatalkan."); invalidate(); },
    onError: (e: Error) => toast.error(e.message),
  });

  const implementMut = useMutation({
    mutationFn: () => callAction(id, "implement", {}, companyQueryParam),
    onSuccess: (implementedProposal: CoaProposal) => {
      toast.success(
        "Implementasi selesai. Kembali ke Rekonsiliasi Bank.",
      );
      invalidate();
      const sourceRecordId = implementedProposal.sourceRecordId ?? proposal?.sourceRecordId;
      navigate(
        sourceRecordId
          ? `/accounting/bank-reconciliation?search=${encodeURIComponent(sourceRecordId)}`
          : "/accounting/bank-reconciliation",
      );
    },
    onError: (e: Error) => toast.error(e.message),
  });

  if (isLoading) {
    return (
      <div className="flex items-center gap-2 p-8 text-muted-foreground">
        <Loader2 className="h-4 w-4 animate-spin" />
        <span>Loading...</span>
      </div>
    );
  }

  if (error || !proposal) {
    return (
      <div className="p-8 text-center text-muted-foreground">
        <AlertCircle className="h-8 w-8 mx-auto mb-2 opacity-30" />
        <p>Proposal tidak ditemukan.</p>
        <Link href="/accounting/coa-proposals">
          <Button variant="link" className="mt-2 text-xs">← Kembali ke daftar</Button>
        </Link>
      </div>
    );
  }

  const currentUserId = user?.id ?? user?.email ?? "";
  const isAdmin = (user as any)?.role === "admin";
  const isMaker = proposal.createdBy === currentUserId || proposal.submittedBy === currentUserId;
  const canSubmit = proposal.status === "DRAFT";
  const canApprove = proposal.status === "PENDING_REVIEW" && isAdmin;
  const canReject  = proposal.status === "PENDING_REVIEW" && isAdmin;
  const canCancel = ["DRAFT", "PENDING_REVIEW"].includes(proposal.status);
  const canImplement = proposal.status === "APPROVED";

  return (
    <div className="p-6 max-w-4xl mx-auto space-y-4">
      {/* Header */}
      <div className="flex items-center gap-3">
        <Link href="/accounting/coa-proposals">
          <Button variant="ghost" size="sm" className="gap-1.5 text-xs">
            <ArrowLeft className="h-3.5 w-3.5" />
            Kembali
          </Button>
        </Link>
        <div className="flex items-center gap-2">
          <Brain className="h-5 w-5 text-indigo-600" />
          <h1 className="text-lg font-semibold">{proposal.proposalNumber}</h1>
          {statusBadge(proposal.status)}
        </div>
      </div>

      {/* Governance warning */}
      <div className="bg-indigo-50 border border-indigo-200 rounded-lg p-3 flex items-center gap-2">
        <ShieldAlert className="h-4 w-4 text-indigo-600 flex-shrink-0" />
        <p className="text-xs text-indigo-700">
          <strong>AI tidak membuat COA secara otomatis.</strong> Setelah implementasi, Anda langsung kembali ke Rekonsiliasi Bank. Akun COA baru langsung aktif.
        </p>
      </div>

      {/* Action buttons */}
      <div className="flex flex-wrap gap-2">
        {canSubmit && (
          <Button
            size="sm"
            className="gap-1.5 text-xs"
            onClick={() => submitMut.mutate()}
            disabled={submitMut.isPending}
          >
            {submitMut.isPending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Clock className="h-3.5 w-3.5" />}
            Submit untuk Review
          </Button>
        )}
        {canApprove && (
          <Button
            size="sm"
            variant="default"
            className="gap-1.5 text-xs bg-green-600 hover:bg-green-700"
            onClick={() => setReviewDialog(true)}
          >
            <CheckCircle className="h-3.5 w-3.5" />
            Approve
          </Button>
        )}
        {canReject && (
          <Button
            size="sm"
            variant="destructive"
            className="gap-1.5 text-xs"
            onClick={() => setRejectDialog(true)}
          >
            <XCircle className="h-3.5 w-3.5" />
            Reject
          </Button>
        )}
        {canImplement && (
          <Button
            size="sm"
            className="gap-1.5 text-xs bg-blue-600 hover:bg-blue-700"
            onClick={() => implementMut.mutate()}
            disabled={implementMut.isPending}
          >
            {implementMut.isPending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <CheckCircle className="h-3.5 w-3.5" />}
            Implement
          </Button>
        )}
        {canCancel && (
          <Button
            size="sm"
            variant="outline"
            className="gap-1.5 text-xs"
            onClick={() => cancelMut.mutate()}
            disabled={cancelMut.isPending}
          >
            {cancelMut.isPending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <XCircle className="h-3.5 w-3.5" />}
            Batalkan
          </Button>
        )}
      </div>

      {/* Rejection reason display */}
      {proposal.rejectionReason && (
        <div className="bg-red-50 border border-red-300 rounded-lg p-3">
          <p className="text-xs font-semibold text-red-700 mb-1">Alasan Penolakan:</p>
          <p className="text-sm text-red-700">{proposal.rejectionReason}</p>
        </div>
      )}

      {/* Source & AI context */}
      <Section title="Sumber & Konteks AI">
        <InfoRow label="Source Type" value={proposal.sourceType} />
        <InfoRow label="Source Record ID" value={proposal.sourceRecordId} />
        <InfoRow label="Detected Intent" value={
          <span className="font-mono text-sm">{proposal.detectedIntent ?? "—"}</span>
        } />
        <InfoRow label="Normalized Description" value={proposal.normalizedDescription} />
        <InfoRow label="Missing Mapping Type" value={proposal.missingMappingType} />
        <InfoRow label="AI Confidence" value={
          proposal.aiConfidence != null ? `${proposal.aiConfidence}%` : "—"
        } />
        <InfoRow label="Historical Occurrences" value={proposal.historicalOccurrences ?? 0} />
        <InfoRow label="Est. Monthly Usage" value={proposal.estimatedMonthlyUsage ?? 0} />
      </Section>

      {/* Proposed account */}
      <Section title="Akun yang Diusulkan">
        <InfoRow label="Kode Akun" value={<span className="font-mono">{proposal.proposedCode || "—"}</span>} />
        <InfoRow label="Nama Akun" value={proposal.proposedName} />
        <InfoRow label="Parent ID" value={proposal.proposedParentId ?? "—"} />
        <InfoRow label="Kategori" value={proposal.proposedCategory} />
        <InfoRow label="Normal Balance" value={proposal.proposedNormalBalance} />
        <InfoRow label="Is Header" value={proposal.proposedIsHeader ? "Ya" : "Tidak"} />
        <InfoRow label="Is Postable" value={proposal.proposedIsPostable ? "Ya" : "Tidak"} />
        <InfoRow label="Berlaku Mulai" value={fmtDate(proposal.proposedEffectiveFrom)} />
        <InfoRow label="Financial Statement" value={proposal.financialStatement} />
      </Section>

      {/* AI Reasoning */}
      {proposal.reasonJson && proposal.reasonJson.length > 0 && (
        <Section title="Alasan AI">
          <ul className="text-sm space-y-1 list-disc list-inside text-muted-foreground">
            {proposal.reasonJson.map((r, i) => (
              <li key={i}>{r}</li>
            ))}
          </ul>
        </Section>
      )}

      {/* Impact analysis */}
      {proposal.impactAnalysisJson && (
        <Section title="Analisis Dampak" defaultOpen={false}>
          {Object.entries(proposal.impactAnalysisJson).map(([k, v]) => (
            <div key={k} className="text-sm">
              <span className="font-medium capitalize text-muted-foreground text-xs uppercase tracking-wide">
                {k.replace(/([A-Z])/g, " $1")}
              </span>
              <p className="text-sm mt-0.5">{v}</p>
            </div>
          ))}
        </Section>
      )}

      {/* Alternative accounts */}
      {proposal.alternativeAccountsJson && (proposal.alternativeAccountsJson as any[]).length > 0 && (
        <Section title="Akun Alternatif (Pertimbangkan sebelum buat baru)" defaultOpen={false}>
          <div className="text-xs text-amber-700 bg-amber-50 rounded p-2 mb-2">
            Pertimbangkan menggunakan akun existing berikut sebelum membuat akun baru.
          </div>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="text-xs">Kode</TableHead>
                <TableHead className="text-xs">Nama</TableHead>
                <TableHead className="text-xs">Kategori</TableHead>
                <TableHead className="text-xs">Alasan</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {(proposal.alternativeAccountsJson as any[]).map((a: any, i: number) => (
                <TableRow key={i}>
                  <TableCell className="text-xs font-mono">{a.code}</TableCell>
                  <TableCell className="text-xs">{a.name}</TableCell>
                  <TableCell className="text-xs">{a.category}</TableCell>
                  <TableCell className="text-xs text-muted-foreground">{a.reason}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </Section>
      )}

      {/* Workflow actors */}
      <Section title="Workflow" defaultOpen={false}>
        <InfoRow label="Dibuat oleh" value={proposal.createdBy} />
        <InfoRow label="Dibuat pada" value={fmtDate(proposal.createdAt)} />
        <InfoRow label="Disubmit oleh" value={proposal.submittedBy} />
        <InfoRow label="Disubmit pada" value={fmtDate(proposal.submittedAt)} />
        <InfoRow label="Direviewed oleh" value={proposal.reviewedBy} />
        <InfoRow label="Direviewed pada" value={fmtDate(proposal.reviewedAt)} />
        <InfoRow label="Diapprove oleh" value={proposal.approvedBy} />
        <InfoRow label="Diapprove pada" value={fmtDate(proposal.approvedAt)} />
        <InfoRow label="Diimplementasi oleh" value={proposal.implementedBy} />
        <InfoRow label="Diimplementasi pada" value={fmtDate(proposal.implementedAt)} />
        {proposal.reviewComments && (
          <div>
            <span className="text-xs text-muted-foreground">Review Comments:</span>
            <p className="text-sm mt-0.5 bg-muted/30 rounded p-2">{proposal.reviewComments}</p>
          </div>
        )}
      </Section>

      {/* Audit timeline */}
      <Section title="Audit Timeline" defaultOpen={false}>
        {auditQ.isLoading ? (
          <div className="flex items-center gap-2 text-muted-foreground text-sm py-2">
            <Loader2 className="h-3.5 w-3.5 animate-spin" />
            Loading...
          </div>
        ) : auditQ.data?.length === 0 ? (
          <p className="text-sm text-muted-foreground">Tidak ada event audit.</p>
        ) : (
          <div className="space-y-2">
            {auditQ.data?.map((e) => (
              <div key={e.id} className="flex gap-3 text-xs">
                <div className="w-36 text-muted-foreground shrink-0">{fmtDate(e.occurredAt)}</div>
                <div>
                  <span className="font-semibold font-mono">{e.eventType}</span>
                  {(e.previousStatus || e.newStatus) && (
                    <span className="text-muted-foreground ml-1">
                      {e.previousStatus} → {e.newStatus}
                    </span>
                  )}
                  {e.reason && <p className="text-muted-foreground">{e.reason}</p>}
                  <p className="text-muted-foreground">by {e.actorId}</p>
                </div>
              </div>
            ))}
          </div>
        )}
      </Section>

      {/* Version history */}
      <Section title="Version History" defaultOpen={false}>
        {versionsQ.isLoading ? (
          <div className="flex items-center gap-2 text-muted-foreground text-sm py-2">
            <Loader2 className="h-3.5 w-3.5 animate-spin" />
            Loading...
          </div>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="text-xs">Version</TableHead>
                <TableHead className="text-xs">Dibuat oleh</TableHead>
                <TableHead className="text-xs">Alasan</TableHead>
                <TableHead className="text-xs">Tanggal</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {versionsQ.data?.map((v) => (
                <TableRow key={v.id}>
                  <TableCell className="text-xs font-mono">v{v.version}</TableCell>
                  <TableCell className="text-xs">{v.createdBy}</TableCell>
                  <TableCell className="text-xs text-muted-foreground">{v.changeReason ?? "—"}</TableCell>
                  <TableCell className="text-xs">{fmtDate(v.createdAt)}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </Section>

      {/* Approve dialog */}
      <Dialog open={reviewDialog} onOpenChange={setReviewDialog}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <CheckCircle className="h-4 w-4 text-green-600" />
              Approve Proposal
            </DialogTitle>
          </DialogHeader>
          <div className="space-y-3">
            <p className="text-sm text-muted-foreground">
              Approve proposal <strong>{proposal.proposalNumber}</strong>?
              {isMaker && isAdmin && (
                <span className="block mt-1 text-amber-600 font-medium">
                  ⚠ Anda adalah maker proposal ini. Approve dilakukan dengan hak admin.
                </span>
              )}
            </p>
            <div>
              <label className="text-xs font-medium">Review Comments (opsional)</label>
              <Textarea
                className="mt-1 text-sm"
                placeholder="Catatan review..."
                rows={3}
                value={reviewComments}
                onChange={(e) => setReviewComments(e.target.value)}
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" size="sm" onClick={() => setReviewDialog(false)}>Batal</Button>
            <Button
              size="sm"
              className="bg-green-600 hover:bg-green-700 gap-1.5"
              onClick={() => approveMut.mutate()}
              disabled={approveMut.isPending}
            >
              {approveMut.isPending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <CheckCircle className="h-3.5 w-3.5" />}
              Approve
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Reject dialog */}
      <Dialog open={rejectDialog} onOpenChange={setRejectDialog}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <XCircle className="h-4 w-4 text-red-600" />
              Tolak Proposal
            </DialogTitle>
          </DialogHeader>
          <div className="space-y-3">
            <p className="text-sm text-muted-foreground">
              Tolak proposal <strong>{proposal.proposalNumber}</strong>?
            </p>
            <div>
              <label className="text-xs font-medium">
                Alasan Penolakan <span className="text-red-500">*</span>
              </label>
              <Textarea
                className="mt-1 text-sm"
                placeholder="Tuliskan alasan penolakan..."
                rows={3}
                value={rejectionReason}
                onChange={(e) => setRejectionReason(e.target.value)}
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" size="sm" onClick={() => setRejectDialog(false)}>Batal</Button>
            <Button
              size="sm"
              variant="destructive"
              className="gap-1.5"
              onClick={() => rejectMut.mutate()}
              disabled={rejectMut.isPending || !rejectionReason.trim()}
            >
              {rejectMut.isPending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <XCircle className="h-3.5 w-3.5" />}
              Tolak
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
