import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useParams } from "wouter";
import { AppShell } from "@/components/layout/AppShell";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import { Textarea } from "@/components/ui/textarea";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Separator } from "@/components/ui/separator";
import { toast } from "@/hooks/use-toast";
import {
  ArrowLeft,
  FileSearch,
  RefreshCw,
  AlertTriangle,
  CheckCircle2,
  XCircle,
  MessageSquare,
  ArrowUpCircle,
  Play,
  UserPlus,
  RotateCcw,
  ChevronDown,
  ChevronUp,
  Info,
  Clock,
  Shield,
  GitCompare,
} from "lucide-react";
import { Link } from "wouter";
import { format, formatDistanceToNow } from "date-fns";
import { id as idLocale } from "date-fns/locale";
import {
  aiReviewApi,
  AIReviewDetail,
  AIReviewSnapshot,
  AIReviewAuditEvent,
  AIReviewDecision,
  AIReviewDecisionPayload,
  AIReviewAssignPayload,
  AIReevaluatePayload,
  AIReviewQueue,
  STATUS_LABELS,
  STATUS_COLORS,
  PRIORITY_LABELS,
  PRIORITY_COLORS,
  QUEUE_LABELS,
  RISK_LEVEL_COLORS,
  REASON_CODE_LABELS,
  AUDIT_EVENT_LABELS,
  maskAccountNumber,
  confidencePct,
  confidenceLabel,
  isTerminalStatus,
} from "@/lib/ai-review-api";

// ── Safe disclaimer ──────────────────────────────────────────────────────────

const JOURNAL_DISCLAIMER =
  "Keputusan ini tidak otomatis memposting jurnal atau merekonsiliasi transaksi.";

const ANOMALY_DISCLAIMER =
  "Pola transaksi memerlukan pemeriksaan tambahan. Ini adalah indikator analitik, bukan konfirmasi pelanggaran.";

// ── Helpers ──────────────────────────────────────────────────────────────────

function formatAmount(amount?: number, currency?: string): string {
  if (amount == null) return "—";
  const cur = currency ?? "IDR";
  try {
    return new Intl.NumberFormat("id-ID", {
      style: "currency",
      currency: cur,
      minimumFractionDigits: 0,
      maximumFractionDigits: 0,
    }).format(amount);
  } catch {
    return `${cur} ${amount.toLocaleString("id-ID")}`;
  }
}

function fmtDate(d?: string | null): string {
  if (!d) return "—";
  try {
    return format(new Date(d), "dd MMM yyyy HH:mm", { locale: idLocale });
  } catch {
    return d;
  }
}

function fmtAgo(d?: string | null): string {
  if (!d) return "—";
  try {
    return formatDistanceToNow(new Date(d), { addSuffix: true, locale: idLocale });
  } catch {
    return d;
  }
}

// ── SLA Indicator ────────────────────────────────────────────────────────────

function SlaChip({ sla }: { sla?: AIReviewDetail["sla"] }) {
  if (!sla) return null;
  const statusColors: Record<string, string> = {
    OVERDUE: "bg-red-100 text-red-800 border-red-200",
    AT_RISK: "bg-orange-100 text-orange-800 border-orange-200",
    COMPLETED: "bg-gray-100 text-gray-600 border-gray-200",
    ON_TRACK: "bg-green-100 text-green-800 border-green-200",
  };
  const label =
    sla.slaStatus === "OVERDUE" ? "Terlambat" :
    sla.slaStatus === "AT_RISK" ? "Berisiko" :
    sla.slaStatus === "COMPLETED" ? "Selesai" : "Tepat Waktu";
  return (
    <Badge className={`text-[10px] px-1.5 py-0 border ${statusColors[sla.slaStatus ?? "ON_TRACK"] ?? ""}`}>
      <Clock className="h-2.5 w-2.5 mr-1" />{label}
      {sla.hoursRemaining != null && sla.slaStatus !== "OVERDUE" && (
        <span className="ml-1">({Math.round(sla.hoursRemaining)}j)</span>
      )}
    </Badge>
  );
}

// ── Field Row ────────────────────────────────────────────────────────────────

function FieldRow({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="flex justify-between items-start gap-4 py-1.5 border-b last:border-0">
      <span className="text-xs text-muted-foreground shrink-0 w-36">{label}</span>
      <span className="text-xs text-right flex-1">{value ?? "—"}</span>
    </div>
  );
}

// ── Confidence Bar ────────────────────────────────────────────────────────────

function ConfidenceBar({ value, label }: { value: number; label?: string }) {
  const pct = value <= 1 ? Math.round(value * 100) : Math.round(value);
  const color = pct >= 90 ? "bg-green-500" : pct >= 75 ? "bg-blue-500" : pct >= 60 ? "bg-yellow-500" : "bg-red-500";
  return (
    <div className="flex items-center gap-2">
      {label && <span className="text-xs text-muted-foreground w-36 shrink-0">{label}</span>}
      <div className="flex-1 bg-muted rounded-full h-2">
        <div className={`h-2 rounded-full ${color} transition-all`} style={{ width: `${pct}%` }} />
      </div>
      <span className="text-xs font-mono w-10 text-right">{pct}%</span>
    </div>
  );
}

// ── Expandable Dev Panel ──────────────────────────────────────────────────────

function DevPanel({ data }: { data: Record<string, unknown> }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="mt-3">
      <button
        className="flex items-center gap-1 text-[11px] text-muted-foreground hover:text-foreground transition-colors"
        onClick={() => setOpen(v => !v)}
      >
        {open ? <ChevronUp className="h-3 w-3" /> : <ChevronDown className="h-3 w-3" />}
        Raw snapshot (developer)
      </button>
      {open && (
        <pre className="mt-2 text-[10px] bg-muted/50 rounded p-3 overflow-auto max-h-80 font-mono">
          {JSON.stringify(data, null, 2)}
        </pre>
      )}
    </div>
  );
}

// ── Action Dialogs ────────────────────────────────────────────────────────────

// Approve Dialog
function ApproveDialog({
  open, onClose, onConfirm, isPending,
}: {
  open: boolean; onClose: () => void;
  onConfirm: (payload: Partial<AIReviewDecisionPayload>) => void;
  isPending: boolean;
}) {
  const [comments, setComments] = useState("");
  const [confidence, setConfidence] = useState("");
  return (
    <Dialog open={open} onOpenChange={v => { if (!v) onClose(); }}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle className="text-green-700 flex items-center gap-2">
            <CheckCircle2 className="h-5 w-5" /> Setujui Rekomendasi AI
          </DialogTitle>
        </DialogHeader>
        <div className="space-y-3 text-sm">
          <div className="rounded-md bg-amber-50 border border-amber-200 p-3 text-xs text-amber-800">
            <Info className="inline h-3.5 w-3.5 mr-1" />
            {JOURNAL_DISCLAIMER}
          </div>
          <div>
            <label className="text-xs font-medium text-muted-foreground mb-1 block">Catatan (opsional)</label>
            <Textarea
              value={comments}
              onChange={e => setComments(e.target.value)}
              placeholder="Catatan keputusan..."
              className="resize-none h-20 text-sm"
            />
          </div>
          <div>
            <label className="text-xs font-medium text-muted-foreground mb-1 block">Tingkat Keyakinan Reviewer (0-1)</label>
            <Input
              type="number" min="0" max="1" step="0.01"
              value={confidence}
              onChange={e => setConfidence(e.target.value)}
              placeholder="0.85"
              className="h-8 text-sm"
            />
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" size="sm" onClick={onClose} disabled={isPending}>Batal</Button>
          <Button size="sm" onClick={() => onConfirm({ comments: comments || undefined, reviewerConfidence: confidence ? parseFloat(confidence) : undefined })} disabled={isPending}>
            {isPending ? "Memproses..." : "Ya, Setujui"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// Change COA Dialog
function ChangeCoaDialog({
  open, onClose, onConfirm, isPending,
}: {
  open: boolean; onClose: () => void;
  onConfirm: (payload: Partial<AIReviewDecisionPayload>) => void;
  isPending: boolean;
}) {
  const [coaCode, setCoaCode] = useState("");
  const [coaName, setCoaName] = useState("");
  const [reasonCode, setReasonCode] = useState("");
  const [comments, setComments] = useState("");
  const [confidence, setConfidence] = useState("");
  const isValid = coaCode.trim() && reasonCode;
  return (
    <Dialog open={open} onOpenChange={v => { if (!v) onClose(); }}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle className="text-blue-700 flex items-center gap-2">
            <GitCompare className="h-5 w-5" /> Ubah COA
          </DialogTitle>
        </DialogHeader>
        <div className="space-y-3 text-sm">
          <div className="rounded-md bg-amber-50 border border-amber-200 p-3 text-xs text-amber-800">
            <Info className="inline h-3.5 w-3.5 mr-1" />
            {JOURNAL_DISCLAIMER}
          </div>
          <div>
            <label className="text-xs font-medium text-muted-foreground mb-1 block">Kode COA <span className="text-red-500">*</span></label>
            <Input value={coaCode} onChange={e => setCoaCode(e.target.value)} placeholder="Mis. 5-1100" className="h-8 text-sm" />
          </div>
          <div>
            <label className="text-xs font-medium text-muted-foreground mb-1 block">Nama COA</label>
            <Input value={coaName} onChange={e => setCoaName(e.target.value)} placeholder="Nama akun..." className="h-8 text-sm" />
          </div>
          <div>
            <label className="text-xs font-medium text-muted-foreground mb-1 block">Alasan <span className="text-red-500">*</span></label>
            <Select value={reasonCode} onValueChange={setReasonCode}>
              <SelectTrigger className="h-8 text-sm">
                <SelectValue placeholder="Pilih alasan..." />
              </SelectTrigger>
              <SelectContent>
                {Object.entries(REASON_CODE_LABELS).map(([k, v]) => (
                  <SelectItem key={k} value={k}>{v}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div>
            <label className="text-xs font-medium text-muted-foreground mb-1 block">Catatan</label>
            <Textarea value={comments} onChange={e => setComments(e.target.value)} placeholder="Catatan perubahan..." className="resize-none h-20 text-sm" />
          </div>
          <div>
            <label className="text-xs font-medium text-muted-foreground mb-1 block">Tingkat Keyakinan Reviewer (0-1)</label>
            <Input type="number" min="0" max="1" step="0.01" value={confidence} onChange={e => setConfidence(e.target.value)} placeholder="0.85" className="h-8 text-sm" />
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" size="sm" onClick={onClose} disabled={isPending}>Batal</Button>
          <Button size="sm" disabled={!isValid || isPending} onClick={() => onConfirm({
            selectedCoaCode: coaCode,
            selectedCoaName: coaName || undefined,
            reasonCode,
            comments: comments || undefined,
            reviewerConfidence: confidence ? parseFloat(confidence) : undefined,
          })}>
            {isPending ? "Memproses..." : "Ubah COA"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// Reject Dialog
function RejectDialog({
  open, onClose, onConfirm, isPending,
}: {
  open: boolean; onClose: () => void;
  onConfirm: (payload: Partial<AIReviewDecisionPayload>) => void;
  isPending: boolean;
}) {
  const [reasonCode, setReasonCode] = useState("");
  const [comments, setComments] = useState("");
  return (
    <Dialog open={open} onOpenChange={v => { if (!v) onClose(); }}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle className="text-red-700 flex items-center gap-2">
            <XCircle className="h-5 w-5" /> Tolak Rekomendasi
          </DialogTitle>
        </DialogHeader>
        <div className="space-y-3 text-sm">
          <div className="rounded-md bg-amber-50 border border-amber-200 p-3 text-xs text-amber-800">
            <Info className="inline h-3.5 w-3.5 mr-1" />
            {JOURNAL_DISCLAIMER}
          </div>
          <div>
            <label className="text-xs font-medium text-muted-foreground mb-1 block">Alasan <span className="text-red-500">*</span></label>
            <Select value={reasonCode} onValueChange={setReasonCode}>
              <SelectTrigger className="h-8 text-sm">
                <SelectValue placeholder="Pilih alasan penolakan..." />
              </SelectTrigger>
              <SelectContent>
                {Object.entries(REASON_CODE_LABELS).map(([k, v]) => (
                  <SelectItem key={k} value={k}>{v}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div>
            <label className="text-xs font-medium text-muted-foreground mb-1 block">Catatan</label>
            <Textarea value={comments} onChange={e => setComments(e.target.value)} placeholder="Keterangan penolakan..." className="resize-none h-20 text-sm" />
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" size="sm" onClick={onClose} disabled={isPending}>Batal</Button>
          <Button variant="destructive" size="sm" disabled={!reasonCode || isPending} onClick={() => onConfirm({ reasonCode, comments: comments || undefined })}>
            {isPending ? "Memproses..." : "Tolak Rekomendasi"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// Request Info Dialog
function RequestInfoDialog({
  open, onClose, onConfirm, isPending,
}: {
  open: boolean; onClose: () => void;
  onConfirm: (payload: Partial<AIReviewDecisionPayload>) => void;
  isPending: boolean;
}) {
  const [comments, setComments] = useState("");
  return (
    <Dialog open={open} onOpenChange={v => { if (!v) onClose(); }}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle className="text-orange-700 flex items-center gap-2">
            <MessageSquare className="h-5 w-5" /> Minta Informasi
          </DialogTitle>
        </DialogHeader>
        <div className="space-y-3 text-sm">
          <div>
            <label className="text-xs font-medium text-muted-foreground mb-1 block">Informasi yang dibutuhkan <span className="text-red-500">*</span></label>
            <Textarea
              value={comments}
              onChange={e => setComments(e.target.value)}
              placeholder="Jelaskan informasi tambahan yang dibutuhkan..."
              className="resize-none h-24 text-sm"
            />
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" size="sm" onClick={onClose} disabled={isPending}>Batal</Button>
          <Button size="sm" disabled={!comments.trim() || isPending} onClick={() => onConfirm({ comments })}>
            {isPending ? "Memproses..." : "Kirim Permintaan"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// Escalate Dialog
function EscalateDialog({
  open, onClose, onConfirm, isPending,
}: {
  open: boolean; onClose: () => void;
  onConfirm: (payload: Partial<AIReviewDecisionPayload>) => void;
  isPending: boolean;
}) {
  const [reasonCode, setReasonCode] = useState("");
  const [comments, setComments] = useState("");
  return (
    <Dialog open={open} onOpenChange={v => { if (!v) onClose(); }}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle className="text-purple-700 flex items-center gap-2">
            <ArrowUpCircle className="h-5 w-5" /> Eskalasi Kasus
          </DialogTitle>
        </DialogHeader>
        <div className="space-y-3 text-sm">
          <div>
            <label className="text-xs font-medium text-muted-foreground mb-1 block">Target Antrian Eskalasi <span className="text-red-500">*</span></label>
            <Select value={reasonCode} onValueChange={setReasonCode}>
              <SelectTrigger className="h-8 text-sm">
                <SelectValue placeholder="Pilih antrian..." />
              </SelectTrigger>
              <SelectContent>
                {(Object.keys(QUEUE_LABELS) as AIReviewQueue[]).map(q => (
                  <SelectItem key={q} value={q}>{QUEUE_LABELS[q]}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div>
            <label className="text-xs font-medium text-muted-foreground mb-1 block">Alasan Eskalasi <span className="text-red-500">*</span></label>
            <Textarea
              value={comments}
              onChange={e => setComments(e.target.value)}
              placeholder="Alasan eskalasi kasus ini..."
              className="resize-none h-20 text-sm"
            />
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" size="sm" onClick={onClose} disabled={isPending}>Batal</Button>
          <Button size="sm" className="bg-purple-600 hover:bg-purple-700" disabled={!reasonCode || !comments.trim() || isPending} onClick={() => onConfirm({ reasonCode, comments })}>
            {isPending ? "Memproses..." : "Eskalasi"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// Assign Dialog
function AssignDialog({
  open, onClose, onConfirm, isPending,
}: {
  open: boolean; onClose: () => void;
  onConfirm: (payload: AIReviewAssignPayload) => void;
  isPending: boolean;
}) {
  const [reviewerId, setReviewerId] = useState("");
  const [reviewerRole, setReviewerRole] = useState("finance");
  return (
    <Dialog open={open} onOpenChange={v => { if (!v) onClose(); }}>
      <DialogContent className="max-w-sm">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <UserPlus className="h-5 w-5" /> Tugaskan Reviewer
          </DialogTitle>
        </DialogHeader>
        <div className="space-y-3 text-sm">
          <div>
            <label className="text-xs font-medium text-muted-foreground mb-1 block">ID Reviewer <span className="text-red-500">*</span></label>
            <Input value={reviewerId} onChange={e => setReviewerId(e.target.value)} placeholder="user-uuid atau email..." className="h-8 text-sm" />
          </div>
          <div>
            <label className="text-xs font-medium text-muted-foreground mb-1 block">Role Reviewer</label>
            <Select value={reviewerRole} onValueChange={setReviewerRole}>
              <SelectTrigger className="h-8 text-sm">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {["admin", "finance", "accounting", "treasury", "tax", "payroll"].map(r => (
                  <SelectItem key={r} value={r}>{r}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" size="sm" onClick={onClose} disabled={isPending}>Batal</Button>
          <Button size="sm" disabled={!reviewerId.trim() || isPending} onClick={() => onConfirm({
            reviewerId: reviewerId.trim(),
            reviewerRole,
            idempotencyKey: crypto.randomUUID(),
          })}>
            {isPending ? "Memproses..." : "Tugaskan"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// Reevaluate Dialog (admin only)
function ReevaluateDialog({
  open, onClose, onConfirm, isPending,
}: {
  open: boolean; onClose: () => void;
  onConfirm: (payload: AIReevaluatePayload) => void;
  isPending: boolean;
}) {
  const [reason, setReason] = useState("");
  return (
    <Dialog open={open} onOpenChange={v => { if (!v) onClose(); }}>
      <DialogContent className="max-w-sm">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <RotateCcw className="h-5 w-5" /> Evaluasi Ulang (Admin)
          </DialogTitle>
        </DialogHeader>
        <div className="space-y-3 text-sm">
          <div>
            <label className="text-xs font-medium text-muted-foreground mb-1 block">Alasan Evaluasi Ulang <span className="text-red-500">*</span></label>
            <Textarea value={reason} onChange={e => setReason(e.target.value)} placeholder="Alasan evaluasi ulang..." className="resize-none h-20 text-sm" />
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" size="sm" onClick={onClose} disabled={isPending}>Batal</Button>
          <Button size="sm" disabled={!reason.trim() || isPending} onClick={() => onConfirm({ reason, idempotencyKey: crypto.randomUUID() })}>
            {isPending ? "Memproses..." : "Evaluasi Ulang"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ── Snapshot Comparison ───────────────────────────────────────────────────────

function SnapshotComparison({ a, b }: { a: AIReviewSnapshot; b: AIReviewSnapshot }) {
  const [left, right] = [a, b].sort((x, y) => x.version - y.version);
  const diffs: Array<{ field: string; before: string; after: string; changed: boolean }> = [
    { field: "Intent", before: left.detectedIntent ?? "—", after: right.detectedIntent ?? "—", changed: left.detectedIntent !== right.detectedIntent },
    { field: "Confidence Intent", before: confidencePct(left.intentConfidence), after: confidencePct(right.intentConfidence), changed: left.intentConfidence !== right.intentConfidence },
    { field: "COA Code", before: left.recommendedCoaCode ?? "—", after: right.recommendedCoaCode ?? "—", changed: left.recommendedCoaCode !== right.recommendedCoaCode },
    { field: "COA Name", before: left.recommendedCoaName ?? "—", after: right.recommendedCoaName ?? "—", changed: left.recommendedCoaName !== right.recommendedCoaName },
    { field: "COA Confidence", before: confidencePct(left.coaConfidence), after: confidencePct(right.coaConfidence), changed: left.coaConfidence !== right.coaConfidence },
    { field: "Anomaly Score", before: left.anomalyScore?.toString() ?? "—", after: right.anomalyScore?.toString() ?? "—", changed: left.anomalyScore !== right.anomalyScore },
    { field: "Queue", before: left.queue ? QUEUE_LABELS[left.queue] : "—", after: right.queue ? QUEUE_LABELS[right.queue] : "—", changed: left.queue !== right.queue },
    { field: "Priority", before: left.priority ? PRIORITY_LABELS[left.priority] : "—", after: right.priority ? PRIORITY_LABELS[right.priority] : "—", changed: left.priority !== right.priority },
    { field: "Policy Version", before: left.policyVersion ?? "—", after: right.policyVersion ?? "—", changed: left.policyVersion !== right.policyVersion },
  ];
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b bg-muted/30">
            <th className="px-3 py-2 text-left text-xs font-medium">Field</th>
            <th className="px-3 py-2 text-left text-xs font-medium">v{left.version}</th>
            <th className="px-3 py-2 text-left text-xs font-medium">v{right.version}</th>
            <th className="px-3 py-2 text-left text-xs font-medium">Delta</th>
          </tr>
        </thead>
        <tbody>
          {diffs.map(d => (
            <tr key={d.field} className={`border-b last:border-0 ${d.changed ? "bg-yellow-50/60" : ""}`}>
              <td className="px-3 py-2 text-xs font-medium">{d.field}</td>
              <td className="px-3 py-2 text-xs text-muted-foreground">{d.before}</td>
              <td className={`px-3 py-2 text-xs ${d.changed ? "font-semibold text-amber-700" : "text-muted-foreground"}`}>{d.after}</td>
              <td className="px-3 py-2 text-xs">
                {d.changed ? <span className="text-amber-600">Berubah</span> : <span className="text-gray-400">Sama</span>}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

// ── Main Page ─────────────────────────────────────────────────────────────────

type DialogType = "approve" | "change_coa" | "reject" | "request_info" | "escalate" | "assign" | "reevaluate" | null;

export default function AiReviewDetailPage() {
  const { id } = useParams<{ id: string }>();
  const qc = useQueryClient();
  const [dialog, setDialog] = useState<DialogType>(null);
  const [idempotencyKey, setIdempotencyKey] = useState<string>("");
  const [cmpSnap1, setCmpSnap1] = useState<string>("");
  const [cmpSnap2, setCmpSnap2] = useState<string>("");

  const { data: detail, isLoading, error, refetch } = useQuery({
    queryKey: ["ai-review-detail", id],
    queryFn: () => aiReviewApi.getCase(id!),
    enabled: !!id,
  });

  const { data: snapshots = [] } = useQuery({
    queryKey: ["ai-review-snapshots", id],
    queryFn: () => aiReviewApi.getSnapshots(id!),
    enabled: !!id,
  });

  const { data: auditEvents = [] } = useQuery({
    queryKey: ["ai-review-audit", id],
    queryFn: () => aiReviewApi.getAudit(id!),
    enabled: !!id,
  });

  const invalidateAll = () => {
    qc.invalidateQueries({ queryKey: ["ai-review-detail", id] });
    qc.invalidateQueries({ queryKey: ["ai-review-snapshots", id] });
    qc.invalidateQueries({ queryKey: ["ai-review-audit", id] });
    qc.invalidateQueries({ queryKey: ["ai-review-cases"] });
  };

  const openDialog = (type: DialogType) => {
    setIdempotencyKey(crypto.randomUUID());
    setDialog(type);
  };

  // Start Review
  const startReviewMut = useMutation({
    mutationFn: () => aiReviewApi.startReview(id!),
    onSuccess: () => {
      toast({ title: "Review dimulai" });
      invalidateAll();
    },
    onError: (e) => toast({ title: "Gagal", description: (e as Error).message, variant: "destructive" }),
  });

  // Assign
  const assignMut = useMutation({
    mutationFn: (payload: AIReviewAssignPayload) => aiReviewApi.assignCase(id!, payload),
    onSuccess: () => {
      toast({ title: "Reviewer berhasil ditugaskan" });
      setDialog(null);
      invalidateAll();
    },
    onError: (e) => toast({ title: "Gagal", description: (e as Error).message, variant: "destructive" }),
  });

  // Decision
  const decisionMut = useMutation({
    mutationFn: (payload: AIReviewDecisionPayload) => aiReviewApi.submitDecision(id!, payload),
    onSuccess: () => {
      toast({ title: "Keputusan berhasil disimpan" });
      setDialog(null);
      invalidateAll();
    },
    onError: (e) => toast({ title: "Gagal", description: (e as Error).message, variant: "destructive" }),
  });

  // Reevaluate
  const reevaluateMut = useMutation({
    mutationFn: (payload: AIReevaluatePayload) => aiReviewApi.reevaluateCase(id!, payload),
    onSuccess: () => {
      toast({ title: "Evaluasi ulang berhasil dijadwalkan" });
      setDialog(null);
      invalidateAll();
    },
    onError: (e) => toast({ title: "Gagal", description: (e as Error).message, variant: "destructive" }),
  });

  const submitDecision = (decision: AIReviewDecision, extra: Partial<AIReviewDecisionPayload> = {}) => {
    decisionMut.mutate({ decision, idempotencyKey, ...extra });
  };

  if (!id) {
    return (
      <AppShell>
        <div className="p-6">
          <p className="text-muted-foreground text-sm">ID kasus tidak ditemukan.</p>
        </div>
      </AppShell>
    );
  }

  if (isLoading) {
    return (
      <AppShell>
        <div className="p-6 flex items-center justify-center min-h-64">
          <div className="text-center">
            <div className="h-8 w-8 animate-spin rounded-full border-2 border-indigo-500 border-t-transparent mx-auto mb-3" />
            <p className="text-sm text-muted-foreground">Memuat detail kasus...</p>
          </div>
        </div>
      </AppShell>
    );
  }

  if (error || !detail) {
    return (
      <AppShell>
        <div className="p-6">
          <div className="flex items-center gap-3 mb-4">
            <Link href="/ai/review">
              <Button variant="ghost" size="icon"><ArrowLeft className="h-4 w-4" /></Button>
            </Link>
          </div>
          <div className="rounded-lg border border-destructive/30 bg-destructive/5 p-6 text-center">
            <AlertTriangle className="h-8 w-8 text-destructive mx-auto mb-3" />
            <p className="text-sm text-destructive">
              {error instanceof Error ? error.message : "Kasus tidak ditemukan."}
            </p>
            <Button variant="outline" size="sm" className="mt-3" onClick={() => refetch()}>
              Coba Lagi
            </Button>
          </div>
        </div>
      </AppShell>
    );
  }

  const isTerminal = isTerminalStatus(detail.status);
  const isInReview = detail.status === "IN_REVIEW";
  const canDecide = isInReview && !isTerminal;
  const canStart = ["QUEUED", "ASSIGNED"].includes(detail.status);

  const compareSnap1 = snapshots.find(s => s.id === cmpSnap1 || String(s.version) === cmpSnap1);
  const compareSnap2 = snapshots.find(s => s.id === cmpSnap2 || String(s.version) === cmpSnap2);

  return (
    <AppShell>
      <div className="p-6 space-y-5 max-w-7xl mx-auto">
        {/* Header */}
        <div className="flex items-start justify-between flex-wrap gap-3">
          <div className="flex items-center gap-3">
            <Link href="/ai/review">
              <Button variant="ghost" size="icon"><ArrowLeft className="h-4 w-4" /></Button>
            </Link>
            <div>
              <div className="flex items-center gap-2 flex-wrap mb-1">
                <h1 className="text-xl font-bold flex items-center gap-2">
                  <FileSearch className="h-5 w-5 text-indigo-500" />
                  Kasus {detail.id.slice(0, 8)}…
                </h1>
                <Badge className={`text-[10px] px-1.5 py-0 border ${STATUS_COLORS[detail.status] ?? ""}`}>
                  {STATUS_LABELS[detail.status] ?? detail.status}
                </Badge>
                {detail.queue && (
                  <Badge variant="outline" className="text-[10px] px-1.5 py-0">
                    {QUEUE_LABELS[detail.queue] ?? detail.queue}
                  </Badge>
                )}
                {detail.priority && (
                  <Badge className={`text-[10px] px-1.5 py-0 border ${PRIORITY_COLORS[detail.priority] ?? ""}`}>
                    {PRIORITY_LABELS[detail.priority] ?? detail.priority}
                  </Badge>
                )}
                <SlaChip sla={detail.sla} />
              </div>
              <p className="text-xs text-muted-foreground">
                Dibuat {fmtAgo(detail.createdAt)} · Transaksi: {detail.transactionId}
              </p>
            </div>
          </div>

          {/* Primary Actions */}
          <div className="flex items-center gap-2 flex-wrap">
            <Button variant="outline" size="sm" onClick={() => refetch()}>
              <RefreshCw className="h-4 w-4 mr-2" /> Refresh
            </Button>
            {canStart && (
              <Button size="sm" onClick={() => startReviewMut.mutate()} disabled={startReviewMut.isPending}>
                <Play className="h-4 w-4 mr-2" />
                {startReviewMut.isPending ? "Memulai..." : "Mulai Review"}
              </Button>
            )}
            <Button variant="outline" size="sm" onClick={() => openDialog("assign")}>
              <UserPlus className="h-4 w-4 mr-2" /> Tugaskan
            </Button>
          </div>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-[1fr_280px] gap-5">
          {/* Main content */}
          <div className="space-y-5">
            <Tabs defaultValue="transaction">
              <TabsList>
                <TabsTrigger value="transaction">Transaksi &amp; AI</TabsTrigger>
                <TabsTrigger value="decision">Keputusan</TabsTrigger>
                <TabsTrigger value="snapshots">Snapshot</TabsTrigger>
                <TabsTrigger value="audit">Audit</TabsTrigger>
              </TabsList>

              {/* ── Tab: Transaction & AI ── */}
              <TabsContent value="transaction" className="mt-4 space-y-4">
                {/* Transaction Summary */}
                <Card>
                  <CardHeader className="pb-3">
                    <CardTitle className="text-sm font-semibold">Ringkasan Transaksi</CardTitle>
                  </CardHeader>
                  <CardContent>
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-8">
                      <FieldRow label="ID Transaksi" value={<span className="font-mono text-xs">{detail.transactionId}</span>} />
                      <FieldRow label="Sumber" value={detail.transactionSource} />
                      <FieldRow label="Tanggal" value={fmtDate(detail.transactionDate)} />
                      <FieldRow label="Deskripsi" value={detail.description} />
                      <FieldRow label="Jumlah" value={formatAmount(detail.amount, detail.currency)} />
                      <FieldRow label="Mata Uang" value={detail.currency} />
                      <FieldRow label="Arah" value={detail.direction === "DEBIT" ? "Debit" : detail.direction === "CREDIT" ? "Kredit" : detail.direction} />
                      <FieldRow label="Counterparty" value={detail.counterparty} />
                      <FieldRow label="No. Rekening" value={maskAccountNumber(detail.accountNumber)} />
                      <FieldRow label="Referensi" value={detail.reference} />
                      <FieldRow label="Perusahaan" value={detail.companyId} />
                      <FieldRow label="Dibuat" value={fmtDate(detail.createdAt)} />
                    </div>
                  </CardContent>
                </Card>

                {/* AI Recommendation */}
                <Card>
                  <CardHeader className="pb-3">
                    <CardTitle className="text-sm font-semibold flex items-center gap-2">
                      <Shield className="h-4 w-4 text-indigo-500" />
                      Rekomendasi AI
                    </CardTitle>
                  </CardHeader>
                  <CardContent className="space-y-4">
                    {/* Intent */}
                    <div>
                      <p className="text-xs font-medium text-muted-foreground mb-2">Intent Terdeteksi</p>
                      <div className="flex items-center gap-3 flex-wrap">
                        <span className="text-sm font-semibold">{detail.detectedIntent ?? "—"}</span>
                        {detail.intentConfidence != null && (
                          <Badge variant="outline" className="text-xs">
                            {confidencePct(detail.intentConfidence)} — {confidenceLabel(detail.intentConfidence)}
                          </Badge>
                        )}
                        {detail.manualReviewFlag && (
                          <Badge variant="destructive" className="text-[10px]">
                            <AlertTriangle className="h-2.5 w-2.5 mr-1" />
                            Perlu Review Manual
                          </Badge>
                        )}
                      </div>
                      {detail.taxSubtype && (
                        <div className="mt-2 flex items-center gap-2">
                          <span className="text-xs text-muted-foreground">Subtype pajak</span>
                          <Badge variant="outline" className="text-xs font-mono">{detail.taxSubtype}</Badge>
                        </div>
                      )}
                      {detail.taxUncertaintyWarning && (
                        <div className="mt-2 rounded-md border border-amber-300 bg-amber-50 px-3 py-2 text-xs text-amber-800">
                          <AlertTriangle className="mr-1 inline h-3.5 w-3.5" />
                          {detail.taxUncertaintyWarning}
                        </div>
                      )}
                    </div>

                    {/* Recommended COA */}
                    <div>
                      <p className="text-xs font-medium text-muted-foreground mb-2">COA Direkomendasikan</p>
                      <div className="flex items-center gap-3 flex-wrap">
                        <span className="font-mono text-sm">{detail.recommendedCoaCode ?? "—"}</span>
                        {detail.recommendedCoaName && (
                          <span className="text-sm text-muted-foreground">{detail.recommendedCoaName}</span>
                        )}
                        {detail.coaConfidence != null && (
                          <Badge variant="outline" className="text-xs">
                            COA: {confidencePct(detail.coaConfidence)}
                          </Badge>
                        )}
                      </div>
                    </div>

                    {/* Confidence Breakdown */}
                    {detail.confidenceBreakdown && detail.confidenceBreakdown.length > 0 && (
                      <div>
                        <p className="text-xs font-medium text-muted-foreground mb-2">Kontribusi Confidence</p>
                        <div className="space-y-2">
                          {detail.confidenceBreakdown.map((f, i) => (
                            <ConfidenceBar key={i} value={f.contribution} label={f.factor} />
                          ))}
                        </div>
                      </div>
                    )}

                    {/* Alternative COAs */}
                    {detail.alternativeCoas && detail.alternativeCoas.length > 0 && (
                      <div>
                        <p className="text-xs font-medium text-muted-foreground mb-2">COA Alternatif</p>
                        <div className="space-y-1">
                          {detail.alternativeCoas.map((c, i) => (
                            <div key={i} className="flex items-center justify-between text-xs border rounded px-2 py-1.5">
                              <span className="font-mono">{c.coaCode}</span>
                              <span className="text-muted-foreground flex-1 mx-2">{c.coaName}</span>
                              <span className="text-muted-foreground">{confidencePct(c.confidence)}</span>
                            </div>
                          ))}
                        </div>
                      </div>
                    )}
                  </CardContent>
                </Card>

                {/* Explainability */}
                {detail.explainability && (
                  <Card>
                    <CardHeader className="pb-3">
                      <CardTitle className="text-sm font-semibold">Explainability AI</CardTitle>
                    </CardHeader>
                    <CardContent className="space-y-3">
                      {detail.explainability.summary && (
                        <p className="text-sm text-muted-foreground">{detail.explainability.summary}</p>
                      )}
                      {detail.explainability.intentReason && (
                        <div>
                          <p className="text-xs font-medium mb-1">Alasan Intent</p>
                          <p className="text-xs text-muted-foreground">{detail.explainability.intentReason}</p>
                        </div>
                      )}
                      {detail.taxSubtype && (
                        <div>
                          <p className="text-xs font-medium mb-1">Jenis/Subtype Pajak</p>
                          <p className="text-xs text-muted-foreground">{detail.taxSubtype}</p>
                        </div>
                      )}
                      {detail.taxUncertaintyWarning && (
                        <p className="rounded-md border border-amber-300 bg-amber-50 px-3 py-2 text-xs text-amber-800">
                          {detail.taxUncertaintyWarning}
                        </p>
                      )}
                      {detail.explainability.matchedKeywords?.length ? (
                        <div>
                          <p className="text-xs font-medium mb-1">Kata Kunci Cocok</p>
                          <div className="flex flex-wrap gap-1">
                            {detail.explainability.matchedKeywords.map((k, i) => (
                              <Badge key={i} variant="outline" className="text-[10px]">{k}</Badge>
                            ))}
                          </div>
                        </div>
                      ) : null}
                      {detail.explainability.counterpartyEvidence?.length ? (
                        <div>
                          <p className="text-xs font-medium mb-1">Bukti Counterparty</p>
                          <ul className="text-xs text-muted-foreground list-disc list-inside space-y-0.5">
                            {detail.explainability.counterpartyEvidence.map((e, i) => (
                              <li key={i}>{e}</li>
                            ))}
                          </ul>
                        </div>
                      ) : null}
                      {detail.explainability.historicalEvidence?.length ? (
                        <div>
                          <p className="text-xs font-medium mb-1">Bukti Historis</p>
                          <ul className="text-xs text-muted-foreground list-disc list-inside space-y-0.5">
                            {detail.explainability.historicalEvidence.map((e, i) => (
                              <li key={i}>{e}</li>
                            ))}
                          </ul>
                        </div>
                      ) : null}
                      {detail.explainability.amountPattern && (
                        <div>
                          <p className="text-xs font-medium mb-1">Pola Jumlah</p>
                          <p className="text-xs text-muted-foreground">{detail.explainability.amountPattern}</p>
                        </div>
                      )}
                      {detail.explainability.ambiguityFlags?.length ? (
                        <div>
                          <p className="text-xs font-medium mb-1 text-orange-600">Indikator Ambiguitas</p>
                          <ul className="text-xs text-orange-600/80 list-disc list-inside space-y-0.5">
                            {detail.explainability.ambiguityFlags.map((f, i) => (
                              <li key={i}>{f}</li>
                            ))}
                          </ul>
                        </div>
                      ) : null}
                      {detail.explainability.policyRulesFired?.length ? (
                        <div>
                          <p className="text-xs font-medium mb-1">Policy Rules Diaktifkan</p>
                          <div className="flex flex-wrap gap-1">
                            {detail.explainability.policyRulesFired.map((r, i) => (
                              <Badge key={i} variant="outline" className="text-[10px] font-mono">{r}</Badge>
                            ))}
                          </div>
                        </div>
                      ) : null}
                      {detail.explainability.confidenceDeductions?.length ? (
                        <div>
                          <p className="text-xs font-medium mb-1">Deductions Confidence</p>
                          <ul className="text-xs text-muted-foreground list-disc list-inside space-y-0.5">
                            {detail.explainability.confidenceDeductions.map((d, i) => (
                              <li key={i}>{d.reason}{d.amount != null ? ` (−${d.amount})` : ""}</li>
                            ))}
                          </ul>
                        </div>
                      ) : null}
                      {/* Raw snapshot (admin) */}
                      {detail.rawSnapshot && <DevPanel data={detail.rawSnapshot} />}
                    </CardContent>
                  </Card>
                )}

                {/* Anomaly Section */}
                {(detail.anomalyScore != null || (detail.anomalyFindings && detail.anomalyFindings.length > 0)) && (
                  <Card>
                    <CardHeader className="pb-3">
                      <CardTitle className="text-sm font-semibold flex items-center gap-2">
                        <AlertTriangle className="h-4 w-4 text-orange-500" />
                        Temuan Anomali
                      </CardTitle>
                    </CardHeader>
                    <CardContent className="space-y-3">
                      <div className="rounded-md bg-orange-50 border border-orange-200 p-3 text-xs text-orange-800">
                        <AlertTriangle className="inline h-3.5 w-3.5 mr-1" />
                        {ANOMALY_DISCLAIMER}
                      </div>
                      {detail.anomalyScore != null && (
                        <div>
                          <p className="text-xs font-medium mb-2">Anomaly Score</p>
                          <ConfidenceBar value={detail.anomalyScore} />
                        </div>
                      )}
                      {detail.riskLevel && detail.riskLevel !== "NONE" && (
                        <div>
                          <span className="text-xs font-medium mr-2">Risk Level:</span>
                          <Badge className={`text-[10px] px-1.5 py-0 border ${RISK_LEVEL_COLORS[detail.riskLevel] ?? ""}`}>
                            {detail.riskLevel}
                          </Badge>
                        </div>
                      )}
                      {detail.anomalyFindings?.map((f, i) => (
                        <div key={i} className="border rounded p-3 space-y-1">
                          <p className="text-xs font-medium">{f.type}</p>
                          {f.description && <p className="text-xs text-muted-foreground">{f.description}</p>}
                          {f.evidence?.length ? (
                            <ul className="text-xs text-muted-foreground list-disc list-inside space-y-0.5">
                              {f.evidence.map((e, j) => <li key={j}>{e}</li>)}
                            </ul>
                          ) : null}
                        </div>
                      ))}
                    </CardContent>
                  </Card>
                )}

                {/* Policy Decision */}
                {detail.policyDecision && (
                  <Card>
                    <CardHeader className="pb-3">
                      <CardTitle className="text-sm font-semibold">Keputusan Kebijakan</CardTitle>
                    </CardHeader>
                    <CardContent>
                      <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-8">
                        <FieldRow label="Review Diperlukan" value={detail.policyDecision.reviewRequired ? "Ya" : "Tidak"} />
                        <FieldRow label="Antrian" value={detail.policyDecision.queue ? QUEUE_LABELS[detail.policyDecision.queue] : undefined} />
                        <FieldRow label="Prioritas" value={detail.policyDecision.priority ? PRIORITY_LABELS[detail.policyDecision.priority] : undefined} />
                        <FieldRow label="Role Reviewer" value={detail.policyDecision.reviewerRole} />
                        <FieldRow label="SLA (jam)" value={detail.policyDecision.slaHours?.toString()} />
                        <FieldRow label="Eskalasi Direkomendasikan" value={detail.policyDecision.escalationRecommended ? "Ya" : "Tidak"} />
                        <FieldRow label="Versi Kebijakan" value={detail.policyDecision.policyVersion} />
                      </div>
                      {detail.policyDecision.rulesFired?.length ? (
                        <div className="mt-3">
                          <p className="text-xs font-medium mb-1">Rules Diaktifkan</p>
                          <div className="flex flex-wrap gap-1">
                            {detail.policyDecision.rulesFired.map((r, i) => (
                              <Badge key={i} variant="outline" className="text-[10px] font-mono">{r}</Badge>
                            ))}
                          </div>
                        </div>
                      ) : null}
                    </CardContent>
                  </Card>
                )}
              </TabsContent>

              {/* ── Tab: Decision ── */}
              <TabsContent value="decision" className="mt-4">
                <Card>
                  <CardHeader className="pb-3">
                    <CardTitle className="text-sm font-semibold">Keputusan Reviewer</CardTitle>
                  </CardHeader>
                  <CardContent className="space-y-4">
                    {isTerminal ? (
                      <div className="space-y-3">
                        <div className="rounded-md bg-muted p-4">
                          <p className="text-sm font-medium mb-2">Kasus sudah dalam status terminal.</p>
                          <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-8">
                            <FieldRow label="Keputusan" value={detail.decision} />
                            <FieldRow label="COA Dipilih" value={detail.selectedCoaCode} />
                            <FieldRow label="Kode Alasan" value={detail.reasonCode} />
                            <FieldRow label="Catatan" value={detail.comments} />
                            <FieldRow label="Reviewer" value={detail.decidedByReviewerId} />
                            <FieldRow label="Waktu Keputusan" value={fmtDate(detail.decidedAt)} />
                          </div>
                        </div>
                      </div>
                    ) : !canDecide ? (
                      <div className="rounded-md bg-muted/50 border p-4 text-center">
                        <Info className="h-6 w-6 text-muted-foreground mx-auto mb-2" />
                        <p className="text-sm text-muted-foreground">
                          {canStart
                            ? 'Klik "Mulai Review" untuk mulai meninjau kasus ini.'
                            : "Kasus ini sedang dalam status " + STATUS_LABELS[detail.status] + "."}
                        </p>
                      </div>
                    ) : (
                      <div className="space-y-3">
                        <div className="rounded-md bg-amber-50 border border-amber-200 p-3 text-xs text-amber-800">
                          <Info className="inline h-3.5 w-3.5 mr-1" />
                          {JOURNAL_DISCLAIMER}
                        </div>
                        <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
                          <Button
                            variant="outline"
                            className="h-auto py-3 flex flex-col gap-1 border-green-300 text-green-700 hover:bg-green-50"
                            onClick={() => openDialog("approve")}
                          >
                            <CheckCircle2 className="h-5 w-5" />
                            <span className="text-xs font-medium">Setujui</span>
                          </Button>
                          <Button
                            variant="outline"
                            className="h-auto py-3 flex flex-col gap-1 border-blue-300 text-blue-700 hover:bg-blue-50"
                            onClick={() => openDialog("change_coa")}
                          >
                            <GitCompare className="h-5 w-5" />
                            <span className="text-xs font-medium">Ubah COA</span>
                          </Button>
                          <Button
                            variant="outline"
                            className="h-auto py-3 flex flex-col gap-1 border-red-300 text-red-700 hover:bg-red-50"
                            onClick={() => openDialog("reject")}
                          >
                            <XCircle className="h-5 w-5" />
                            <span className="text-xs font-medium">Tolak</span>
                          </Button>
                          <Button
                            variant="outline"
                            className="h-auto py-3 flex flex-col gap-1 border-orange-300 text-orange-700 hover:bg-orange-50"
                            onClick={() => openDialog("request_info")}
                          >
                            <MessageSquare className="h-5 w-5" />
                            <span className="text-xs font-medium">Minta Info</span>
                          </Button>
                          <Button
                            variant="outline"
                            className="h-auto py-3 flex flex-col gap-1 border-purple-300 text-purple-700 hover:bg-purple-50"
                            onClick={() => openDialog("escalate")}
                          >
                            <ArrowUpCircle className="h-5 w-5" />
                            <span className="text-xs font-medium">Eskalasi</span>
                          </Button>
                        </div>
                      </div>
                    )}
                  </CardContent>
                </Card>
              </TabsContent>

              {/* ── Tab: Snapshots ── */}
              <TabsContent value="snapshots" className="mt-4 space-y-4">
                <Card>
                  <CardHeader className="pb-3">
                    <CardTitle className="text-sm font-semibold">Riwayat Snapshot</CardTitle>
                  </CardHeader>
                  <CardContent>
                    {snapshots.length === 0 ? (
                      <p className="text-sm text-muted-foreground text-center py-6">Belum ada snapshot.</p>
                    ) : (
                      <div className="space-y-2">
                        {snapshots.map(snap => (
                          <div key={snap.id} className="flex items-center justify-between border rounded p-2.5">
                            <div>
                              <span className="text-xs font-semibold">v{snap.version}</span>
                              <span className="text-xs text-muted-foreground ml-2">{fmtDate(snap.createdAt)}</span>
                              {snap.policyVersion && (
                                <span className="text-xs text-muted-foreground ml-2">· Policy: {snap.policyVersion}</span>
                              )}
                              {snap.checksum && (
                                <span className="text-xs text-muted-foreground ml-2 font-mono">· {snap.checksum.slice(0, 8)}</span>
                              )}
                            </div>
                          </div>
                        ))}
                      </div>
                    )}
                  </CardContent>
                </Card>

                {/* Snapshot Comparison */}
                {snapshots.length >= 2 && (
                  <Card>
                    <CardHeader className="pb-3">
                      <CardTitle className="text-sm font-semibold">Bandingkan Dua Snapshot</CardTitle>
                    </CardHeader>
                    <CardContent className="space-y-3">
                      <div className="flex items-center gap-3 flex-wrap">
                        <div className="w-40">
                          <label className="text-xs font-medium text-muted-foreground mb-1 block">Snapshot A</label>
                          <Select value={cmpSnap1} onValueChange={setCmpSnap1}>
                            <SelectTrigger className="h-8 text-xs">
                              <SelectValue placeholder="Pilih..." />
                            </SelectTrigger>
                            <SelectContent>
                              {snapshots.map(s => (
                                <SelectItem key={s.id} value={s.id}>v{s.version}</SelectItem>
                              ))}
                            </SelectContent>
                          </Select>
                        </div>
                        <div className="w-40">
                          <label className="text-xs font-medium text-muted-foreground mb-1 block">Snapshot B</label>
                          <Select value={cmpSnap2} onValueChange={setCmpSnap2}>
                            <SelectTrigger className="h-8 text-xs">
                              <SelectValue placeholder="Pilih..." />
                            </SelectTrigger>
                            <SelectContent>
                              {snapshots.map(s => (
                                <SelectItem key={s.id} value={s.id}>v{s.version}</SelectItem>
                              ))}
                            </SelectContent>
                          </Select>
                        </div>
                      </div>
                      {compareSnap1 && compareSnap2 && compareSnap1.id !== compareSnap2.id ? (
                        <SnapshotComparison a={compareSnap1} b={compareSnap2} />
                      ) : (
                        <p className="text-xs text-muted-foreground">Pilih dua snapshot berbeda untuk membandingkan.</p>
                      )}
                    </CardContent>
                  </Card>
                )}
              </TabsContent>

              {/* ── Tab: Audit ── */}
              <TabsContent value="audit" className="mt-4">
                <Card>
                  <CardHeader className="pb-3">
                    <CardTitle className="text-sm font-semibold">Timeline Audit</CardTitle>
                  </CardHeader>
                  <CardContent>
                    {auditEvents.length === 0 ? (
                      <p className="text-sm text-muted-foreground text-center py-6">Belum ada catatan audit.</p>
                    ) : (
                      <div className="space-y-3">
                        {[...auditEvents].sort((a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime()).map((event, i) => (
                          <div key={event.id} className="flex gap-3">
                            <div className="flex flex-col items-center">
                              <div className="w-2.5 h-2.5 rounded-full bg-indigo-400 shrink-0 mt-0.5" />
                              {i < auditEvents.length - 1 && (
                                <div className="w-px flex-1 bg-border min-h-4 mt-1" />
                              )}
                            </div>
                            <div className="pb-3 flex-1">
                              <div className="flex items-center gap-2 flex-wrap">
                                <span className="text-xs font-semibold">
                                  {AUDIT_EVENT_LABELS[event.eventType] ?? event.eventType}
                                </span>
                                {event.prevStatus && event.newStatus && (
                                  <span className="text-[10px] text-muted-foreground">
                                    {STATUS_LABELS[event.prevStatus] ?? event.prevStatus}
                                    {" → "}
                                    {STATUS_LABELS[event.newStatus] ?? event.newStatus}
                                  </span>
                                )}
                                <span className="text-[10px] text-muted-foreground">{fmtDate(event.createdAt)}</span>
                              </div>
                              {event.actorName && (
                                <p className="text-xs text-muted-foreground mt-0.5">
                                  oleh {event.actorName}
                                  {event.actorRole && ` (${event.actorRole})`}
                                </p>
                              )}
                              {event.reason && (
                                <p className="text-xs text-muted-foreground mt-0.5">"{event.reason}"</p>
                              )}
                              {/* Sanitized metadata — never show raw objects blindly */}
                              {event.metadata && Object.keys(event.metadata).length > 0 && (
                                <div className="mt-1 flex flex-wrap gap-1">
                                  {Object.entries(event.metadata)
                                    .filter(([k]) => !["password", "token", "secret", "key"].some(s => k.toLowerCase().includes(s)))
                                    .slice(0, 5)
                                    .map(([k, v]) => (
                                      <span key={k} className="text-[10px] bg-muted px-1.5 py-0.5 rounded font-mono">
                                        {k}: {String(v).slice(0, 30)}
                                      </span>
                                    ))}
                                </div>
                              )}
                            </div>
                          </div>
                        ))}
                      </div>
                    )}
                  </CardContent>
                </Card>
              </TabsContent>
            </Tabs>
          </div>

          {/* Side Panel */}
          <div className="space-y-4">
            {/* Assignment */}
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-sm font-semibold">Penugasan</CardTitle>
              </CardHeader>
              <CardContent className="space-y-2">
                <FieldRow
                  label="Reviewer"
                  value={detail.assignedReviewerName ?? (detail.assignedReviewerId ? detail.assignedReviewerId.slice(0, 8) + "…" : "Belum ditugaskan")}
                />
                <FieldRow label="Role" value={detail.assignedReviewerRole} />
                <Button size="sm" variant="outline" className="w-full mt-2" onClick={() => openDialog("assign")}>
                  <UserPlus className="h-3.5 w-3.5 mr-2" /> Tugaskan
                </Button>
              </CardContent>
            </Card>

            {/* Reevaluate (admin) */}
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-sm font-semibold">Admin</CardTitle>
              </CardHeader>
              <CardContent>
                <Button
                  size="sm"
                  variant="outline"
                  className="w-full text-orange-700 border-orange-300 hover:bg-orange-50"
                  onClick={() => openDialog("reevaluate")}
                >
                  <RotateCcw className="h-3.5 w-3.5 mr-2" /> Evaluasi Ulang
                </Button>
              </CardContent>
            </Card>

            {/* Case Metadata */}
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-sm font-semibold">Metadata</CardTitle>
              </CardHeader>
              <CardContent className="space-y-1">
                <FieldRow label="Snapshot" value={`v${detail.snapshotVersion ?? 1}`} />
                <FieldRow label="Policy" value={detail.policyVersion} />
                <FieldRow label="SLA Deadline" value={fmtDate(detail.sla?.deadlineAt ?? detail.sla?.dueAt)} />
                <FieldRow label="Review Dimulai" value={fmtDate(detail.reviewStartedAt)} />
                <FieldRow label="Diputuskan" value={fmtDate(detail.decidedAt)} />
                <FieldRow label="Diperbarui" value={fmtAgo(detail.updatedAt)} />
              </CardContent>
            </Card>
          </div>
        </div>
      </div>

      {/* Dialogs */}
      <ApproveDialog
        open={dialog === "approve"}
        onClose={() => setDialog(null)}
        onConfirm={extra => submitDecision("APPROVE_RECOMMENDATION", extra)}
        isPending={decisionMut.isPending}
      />
      <ChangeCoaDialog
        open={dialog === "change_coa"}
        onClose={() => setDialog(null)}
        onConfirm={extra => submitDecision("CHANGE_COA", extra)}
        isPending={decisionMut.isPending}
      />
      <RejectDialog
        open={dialog === "reject"}
        onClose={() => setDialog(null)}
        onConfirm={extra => submitDecision("REJECT_RECOMMENDATION", extra)}
        isPending={decisionMut.isPending}
      />
      <RequestInfoDialog
        open={dialog === "request_info"}
        onClose={() => setDialog(null)}
        onConfirm={extra => submitDecision("REQUEST_INFORMATION", extra)}
        isPending={decisionMut.isPending}
      />
      <EscalateDialog
        open={dialog === "escalate"}
        onClose={() => setDialog(null)}
        onConfirm={extra => submitDecision("ESCALATE", extra)}
        isPending={decisionMut.isPending}
      />
      <AssignDialog
        open={dialog === "assign"}
        onClose={() => setDialog(null)}
        onConfirm={payload => assignMut.mutate(payload)}
        isPending={assignMut.isPending}
      />
      <ReevaluateDialog
        open={dialog === "reevaluate"}
        onClose={() => setDialog(null)}
        onConfirm={payload => reevaluateMut.mutate(payload)}
        isPending={reevaluateMut.isPending}
      />
    </AppShell>
  );
}
