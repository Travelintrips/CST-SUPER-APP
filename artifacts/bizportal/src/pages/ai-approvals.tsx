import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { AppShell } from "@/components/layout/AppShell";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import { toast } from "@/hooks/use-toast";
import {
  ArrowLeft,
  Bot,
  CheckCircle2,
  XCircle,
  Clock,
  ShieldCheck,
  AlertTriangle,
  RotateCcw,
  RefreshCw,
  ChevronDown,
  ChevronUp,
  Cpu,
  Sparkles,
} from "lucide-react";
import { Link } from "wouter";
import { formatDistanceToNow, format } from "date-fns";
import { id as idLocale } from "date-fns/locale";

// ── Types ──────────────────────────────────────────────────────────────────────

interface ApprovalItem {
  id: number;
  execution_id: number | null;
  agent_type: string;
  action: string;
  action_description: string;
  context_data: Record<string, unknown> | null;
  priority: "low" | "medium" | "high" | "critical";
  amount: string | null;
  order_id: number | null;
  rfq_id: number | null;
  status: "pending" | "approved" | "rejected" | "expired" | "auto_approved";
  expires_at: string;
  auto_approve_at: string | null;
  decided_by: string | null;
  decided_at: string | null;
  decision_reason: string | null;
  undo_deadline: string | null;
  was_undone: boolean;
  undone_by: string | null;
  undone_at: string | null;
  requested_at: string;
  reasoning: string | null;
  confidence: string | null;
  model_used: string | null;
  input_summary: string | null;
}

interface ApprovalListResponse {
  items: ApprovalItem[];
  total: number;
}

interface Stats {
  pending: number;
  approvedToday: number;
  rejectedToday: number;
  expired: number;
  pendingCritical: number;
  pendingHigh: number;
}

// ── Helpers ────────────────────────────────────────────────────────────────────

const PRIORITY_CONFIG = {
  critical: { label: "Kritis",    bg: "bg-red-50 border-red-300",    badge: "destructive" as const,  dot: "bg-red-500"    },
  high:     { label: "Tinggi",    bg: "bg-orange-50 border-orange-300", badge: "secondary" as const, dot: "bg-orange-500" },
  medium:   { label: "Sedang",    bg: "bg-yellow-50 border-yellow-200", badge: "outline" as const,   dot: "bg-yellow-500" },
  low:      { label: "Rendah",    bg: "bg-gray-50 border-gray-200",   badge: "outline" as const,     dot: "bg-gray-400"   },
};

const AGENT_TYPE_LABELS: Record<string, string> = {
  customer: "Customer Agent",
  vendor:   "Vendor Agent",
  ops:      "Ops Agent",
  customs:  "Customs Agent",
  finance:  "Finance Agent",
  intake:   "Intake Agent",
  ocr:      "OCR Agent",
  document: "Document Agent",
};

const STATUS_CONFIG = {
  pending:      { label: "Menunggu",      color: "bg-yellow-100 text-yellow-800 border-yellow-200" },
  approved:     { label: "Disetujui",     color: "bg-green-100 text-green-800 border-green-200"   },
  rejected:     { label: "Ditolak",       color: "bg-red-100 text-red-800 border-red-200"          },
  expired:      { label: "Kedaluwarsa",   color: "bg-gray-100 text-gray-600 border-gray-200"       },
  auto_approved:{ label: "Auto-Approve",  color: "bg-blue-100 text-blue-800 border-blue-200"       },
};

function confidencePct(val: string | null): string | null {
  if (!val) return null;
  const n = parseFloat(val);
  if (isNaN(n)) return null;
  return `${Math.round(n * 100)}%`;
}

function canUndo(item: ApprovalItem): boolean {
  if (item.status !== "approved") return false;
  if (item.was_undone) return false;
  if (!item.undo_deadline) return false;
  return new Date(item.undo_deadline) > new Date();
}

// ── API calls ─────────────────────────────────────────────────────────────────

async function fetchApprovals(status: string, priority: string): Promise<ApprovalListResponse> {
  const params = new URLSearchParams({ limit: "100" });
  if (status !== "all") params.set("status", status);
  if (priority !== "all") params.set("priority", priority);
  const res = await fetch(`/api/ai-approvals?${params}`);
  if (!res.ok) throw new Error("Gagal memuat approval queue");
  return res.json();
}

async function fetchStats(): Promise<Stats> {
  const res = await fetch("/api/ai-approvals/stats");
  if (!res.ok) throw new Error("Gagal memuat statistik");
  return res.json();
}

async function resolve(id: number, decision: "approved" | "rejected", reason?: string): Promise<void> {
  const res = await fetch(`/api/ai-approvals/${id}/resolve`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ decision, reason }),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({})) as { error?: string };
    throw new Error(err.error ?? "Gagal memproses");
  }
}

async function undoApproval(id: number): Promise<void> {
  const res = await fetch(`/api/ai-approvals/${id}/undo`, { method: "POST" });
  if (!res.ok) {
    const err = await res.json().catch(() => ({})) as { error?: string };
    throw new Error(err.error ?? "Gagal undo");
  }
}

// ── Context Viewer ─────────────────────────────────────────────────────────────

function ContextViewer({ data }: { data: Record<string, unknown> }) {
  const [open, setOpen] = useState(false);
  const keys = Object.keys(data);
  if (keys.length === 0) return null;
  return (
    <div className="mt-2">
      <button
        className="flex items-center gap-1 text-[11px] text-muted-foreground hover:text-foreground transition-colors"
        onClick={() => setOpen(v => !v)}
      >
        {open ? <ChevronUp className="h-3 w-3" /> : <ChevronDown className="h-3 w-3" />}
        Context data ({keys.length} field)
      </button>
      {open && (
        <pre className="mt-1 text-[10px] bg-muted/50 rounded p-2 overflow-auto max-h-32 font-mono">
          {JSON.stringify(data, null, 2)}
        </pre>
      )}
    </div>
  );
}

// ── Resolve Dialog ─────────────────────────────────────────────────────────────

function ResolveDialog({
  item,
  decision,
  open,
  onClose,
  onConfirm,
  isPending,
}: {
  item: ApprovalItem;
  decision: "approved" | "rejected";
  open: boolean;
  onClose: () => void;
  onConfirm: (reason: string) => void;
  isPending: boolean;
}) {
  const [reason, setReason] = useState("");
  return (
    <Dialog open={open} onOpenChange={v => { if (!v) onClose(); }}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle className={decision === "approved" ? "text-green-700" : "text-red-700"}>
            {decision === "approved" ? "Setujui" : "Tolak"} AI Action
          </DialogTitle>
        </DialogHeader>
        <div className="space-y-3 text-sm">
          <p className="text-muted-foreground">{item.action_description}</p>
          <div>
            <label className="text-xs font-medium text-muted-foreground mb-1 block">
              Catatan (opsional)
            </label>
            <Textarea
              value={reason}
              onChange={e => setReason(e.target.value)}
              placeholder="Alasan keputusan..."
              className="resize-none h-20 text-sm"
            />
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" size="sm" onClick={onClose} disabled={isPending}>
            Batal
          </Button>
          <Button
            size="sm"
            variant={decision === "approved" ? "default" : "destructive"}
            onClick={() => onConfirm(reason)}
            disabled={isPending}
          >
            {isPending ? "Memproses..." : decision === "approved" ? "Ya, Setujui" : "Ya, Tolak"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ── Approval Card ──────────────────────────────────────────────────────────────

function ApprovalCard({
  item,
  onApprove,
  onReject,
  onUndo,
}: {
  item: ApprovalItem;
  onApprove: (id: number) => void;
  onReject: (id: number) => void;
  onUndo: (id: number) => void;
}) {
  const prio = PRIORITY_CONFIG[item.priority] ?? PRIORITY_CONFIG.medium;
  const statusCfg = STATUS_CONFIG[item.status] ?? STATUS_CONFIG.pending;
  const conf = confidencePct(item.confidence);
  const timeAgo = formatDistanceToNow(new Date(item.requested_at), { addSuffix: true, locale: idLocale });
  const expiresAt = format(new Date(item.expires_at), "dd MMM HH:mm", { locale: idLocale });
  const undoable = canUndo(item);

  return (
    <div className={`rounded-lg border p-4 space-y-3 ${prio.bg}`}>
      {/* Header */}
      <div className="flex items-start justify-between gap-3">
        <div className="flex items-start gap-3 flex-1 min-w-0">
          <div className={`mt-1 w-2 h-2 rounded-full shrink-0 ${prio.dot}`} />
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2 flex-wrap mb-1">
              <span className="font-medium text-sm">{item.action_description}</span>
            </div>
            <div className="flex items-center gap-2 flex-wrap">
              <Badge variant={prio.badge} className="text-[10px] px-1.5 py-0">{prio.label}</Badge>
              <Badge variant="outline" className="text-[10px] px-1.5 py-0 bg-white">
                <Bot className="h-2.5 w-2.5 mr-1" />
                {AGENT_TYPE_LABELS[item.agent_type] ?? item.agent_type}
              </Badge>
              <Badge variant="outline" className={`text-[10px] px-1.5 py-0 ${statusCfg.color}`}>
                {statusCfg.label}
              </Badge>
              {item.order_id && (
                <span className="text-[10px] text-muted-foreground">Order #{item.order_id}</span>
              )}
              {item.amount && (
                <span className="text-[10px] text-muted-foreground font-mono">
                  Rp {parseFloat(item.amount).toLocaleString("id-ID")}
                </span>
              )}
            </div>
          </div>
        </div>
        <div className="flex flex-col items-end gap-1 shrink-0">
          <span className="text-[11px] text-muted-foreground whitespace-nowrap">{timeAgo}</span>
          {item.status === "pending" && (
            <span className="text-[10px] text-muted-foreground/70">Exp: {expiresAt}</span>
          )}
        </div>
      </div>

      {/* AI Reasoning */}
      {(item.reasoning || item.input_summary) && (
        <div className="bg-white/70 rounded p-2.5 text-xs space-y-1 border border-white">
          {item.input_summary && (
            <p className="text-muted-foreground">
              <span className="font-medium text-foreground/70">Input:</span> {item.input_summary}
            </p>
          )}
          {item.reasoning && (
            <p className="text-muted-foreground">
              <span className="font-medium text-foreground/70">Reasoning AI:</span> {item.reasoning}
            </p>
          )}
          <div className="flex items-center gap-3 pt-0.5">
            {conf && (
              <span className="flex items-center gap-1 text-[10px] text-muted-foreground">
                <Sparkles className="h-2.5 w-2.5" /> Confidence: {conf}
              </span>
            )}
            {item.model_used && (
              <span className="flex items-center gap-1 text-[10px] text-muted-foreground">
                <Cpu className="h-2.5 w-2.5" /> {item.model_used}
              </span>
            )}
          </div>
        </div>
      )}

      {/* Context Data */}
      {item.context_data && <ContextViewer data={item.context_data} />}

      {/* Decision info (resolved) */}
      {item.decided_by && (
        <p className="text-[11px] text-muted-foreground/70">
          {item.status === "approved" ? "Disetujui" : "Ditolak"} oleh {item.decided_by}
          {item.decided_at && ` — ${format(new Date(item.decided_at), "dd MMM HH:mm", { locale: idLocale })}`}
          {item.decision_reason && ` — "${item.decision_reason}"`}
        </p>
      )}
      {item.was_undone && (
        <p className="text-[11px] text-orange-600">
          Di-undo oleh {item.undone_by ?? "-"}
          {item.undone_at && ` pada ${format(new Date(item.undone_at), "dd MMM HH:mm", { locale: idLocale })}`}
        </p>
      )}

      {/* Actions */}
      {item.status === "pending" && (
        <div className="flex gap-2 pt-1">
          <Button
            size="sm"
            variant="outline"
            className="h-7 text-xs px-3 bg-white text-green-700 border-green-300 hover:bg-green-50"
            onClick={() => onApprove(item.id)}
          >
            <CheckCircle2 className="h-3 w-3 mr-1" /> Setujui
          </Button>
          <Button
            size="sm"
            variant="outline"
            className="h-7 text-xs px-3 bg-white text-red-700 border-red-300 hover:bg-red-50"
            onClick={() => onReject(item.id)}
          >
            <XCircle className="h-3 w-3 mr-1" /> Tolak
          </Button>
        </div>
      )}
      {undoable && (
        <div className="flex gap-2 pt-1">
          <Button
            size="sm"
            variant="outline"
            className="h-7 text-xs px-3 bg-white text-orange-700 border-orange-300 hover:bg-orange-50"
            onClick={() => onUndo(item.id)}
          >
            <RotateCcw className="h-3 w-3 mr-1" /> Undo
            {item.undo_deadline && (
              <span className="ml-1 text-[10px] text-muted-foreground">
                ({formatDistanceToNow(new Date(item.undo_deadline), { locale: idLocale })})
              </span>
            )}
          </Button>
        </div>
      )}
    </div>
  );
}

// ── Main Page ──────────────────────────────────────────────────────────────────

type TabValue = "pending" | "all";

export default function AiApprovalsPage() {
  const qc = useQueryClient();
  const [tab, setTab] = useState<TabValue>("pending");
  const [priority, setPriority] = useState("all");

  const [resolveDialog, setResolveDialog] = useState<{
    item: ApprovalItem;
    decision: "approved" | "rejected";
  } | null>(null);

  const status = tab === "pending" ? "pending" : "all";

  const { data: stats, refetch: refetchStats } = useQuery({
    queryKey: ["ai-approval-stats"],
    queryFn: fetchStats,
    refetchInterval: 30_000,
  });

  const { data, isLoading, refetch } = useQuery({
    queryKey: ["ai-approvals", status, priority],
    queryFn: () => fetchApprovals(status, priority),
    refetchInterval: 30_000,
  });

  const invalidate = () => {
    qc.invalidateQueries({ queryKey: ["ai-approvals"] });
    qc.invalidateQueries({ queryKey: ["ai-approval-stats"] });
  };

  const resolveMut = useMutation({
    mutationFn: ({ id, decision, reason }: { id: number; decision: "approved" | "rejected"; reason: string }) =>
      resolve(id, decision, reason),
    onSuccess: (_, vars) => {
      toast({ title: vars.decision === "approved" ? "AI action disetujui" : "AI action ditolak" });
      setResolveDialog(null);
      invalidate();
    },
    onError: (e) => toast({ title: "Gagal", description: (e as Error).message, variant: "destructive" }),
  });

  const undoMut = useMutation({
    mutationFn: undoApproval,
    onSuccess: () => {
      toast({ title: "Approval berhasil di-undo" });
      invalidate();
    },
    onError: (e) => toast({ title: "Gagal undo", description: (e as Error).message, variant: "destructive" }),
  });

  const items = data?.items ?? [];
  const s = stats ?? { pending: 0, approvedToday: 0, rejectedToday: 0, expired: 0, pendingCritical: 0, pendingHigh: 0 };

  return (
    <AppShell>
      <div className="p-6 space-y-6 max-w-5xl mx-auto">
        {/* Header */}
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <Link href="/approvals"><Button variant="ghost" size="icon" aria-label="Kembali"><ArrowLeft className="h-4 w-4" /></Button></Link>
            <div>
            <h1 className="text-2xl font-bold tracking-tight flex items-center gap-2">
              <ShieldCheck className="h-6 w-6 text-indigo-500" />
              AI Approval Queue
            </h1>
            <p className="text-muted-foreground text-sm mt-1">
              Tinjau dan setujui tindakan AI yang membutuhkan keputusan manusia.
            </p>
          </div>
          </div>
          <Button variant="outline" size="sm" onClick={() => { refetch(); refetchStats(); }}>
            <RefreshCw className="h-4 w-4 mr-2" /> Refresh
          </Button>
        </div>

        {/* Stats */}
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
          <Card>
            <CardContent className="pt-4 pb-4">
              <div className="flex items-center gap-3">
                <div className="rounded-full bg-yellow-100 p-2">
                  <Clock className="h-4 w-4 text-yellow-600" />
                </div>
                <div>
                  <p className="text-2xl font-bold">{s.pending}</p>
                  <p className="text-xs text-muted-foreground">Menunggu</p>
                </div>
              </div>
              {(s.pendingCritical > 0 || s.pendingHigh > 0) && (
                <div className="mt-2 flex gap-2">
                  {s.pendingCritical > 0 && (
                    <Badge variant="destructive" className="text-[10px]">{s.pendingCritical} Kritis</Badge>
                  )}
                  {s.pendingHigh > 0 && (
                    <Badge className="text-[10px] bg-orange-100 text-orange-800 border border-orange-200">{s.pendingHigh} Tinggi</Badge>
                  )}
                </div>
              )}
            </CardContent>
          </Card>
          <Card>
            <CardContent className="pt-4 pb-4">
              <div className="flex items-center gap-3">
                <div className="rounded-full bg-green-100 p-2">
                  <CheckCircle2 className="h-4 w-4 text-green-600" />
                </div>
                <div>
                  <p className="text-2xl font-bold">{s.approvedToday}</p>
                  <p className="text-xs text-muted-foreground">Disetujui Hari Ini</p>
                </div>
              </div>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="pt-4 pb-4">
              <div className="flex items-center gap-3">
                <div className="rounded-full bg-red-100 p-2">
                  <XCircle className="h-4 w-4 text-red-600" />
                </div>
                <div>
                  <p className="text-2xl font-bold">{s.rejectedToday}</p>
                  <p className="text-xs text-muted-foreground">Ditolak Hari Ini</p>
                </div>
              </div>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="pt-4 pb-4">
              <div className="flex items-center gap-3">
                <div className="rounded-full bg-gray-100 p-2">
                  <AlertTriangle className="h-4 w-4 text-gray-500" />
                </div>
                <div>
                  <p className="text-2xl font-bold">{s.expired}</p>
                  <p className="text-xs text-muted-foreground">Kedaluwarsa</p>
                </div>
              </div>
            </CardContent>
          </Card>
        </div>

        {/* List */}
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-base font-semibold">Daftar Approval</CardTitle>
          </CardHeader>
          <CardContent>
            <Tabs value={tab} onValueChange={v => setTab(v as TabValue)}>
              <div className="flex items-center justify-between mb-4 flex-wrap gap-3">
                <TabsList>
                  <TabsTrigger value="pending">
                    Menunggu
                    {s.pending > 0 && (
                      <span className="ml-1.5 rounded-full bg-yellow-500 text-white text-[10px] px-1.5 py-0.5">
                        {s.pending}
                      </span>
                    )}
                  </TabsTrigger>
                  <TabsTrigger value="all">Semua</TabsTrigger>
                </TabsList>
                <div className="w-36">
                  <Select value={priority} onValueChange={setPriority}>
                    <SelectTrigger className="h-8 text-xs">
                      <SelectValue placeholder="Semua Prioritas" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="all">Semua Prioritas</SelectItem>
                      <SelectItem value="critical">Kritis</SelectItem>
                      <SelectItem value="high">Tinggi</SelectItem>
                      <SelectItem value="medium">Sedang</SelectItem>
                      <SelectItem value="low">Rendah</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
              </div>

              {(["pending", "all"] as const).map(t => (
                <TabsContent key={t} value={t} className="mt-0 space-y-3">
                  {isLoading && (
                    <p className="text-sm text-muted-foreground py-6 text-center">Memuat...</p>
                  )}
                  {!isLoading && items.length === 0 && (
                    <div className="text-center py-12 text-muted-foreground">
                      <Bot className="h-10 w-10 mx-auto mb-3 text-indigo-300" />
                      <p className="text-sm">
                        {t === "pending" ? "Tidak ada AI action yang menunggu persetujuan." : "Belum ada data approval."}
                      </p>
                    </div>
                  )}
                  {items.map(item => (
                    <ApprovalCard
                      key={item.id}
                      item={item}
                      onApprove={id => {
                        const found = items.find(i => i.id === id);
                        if (found) setResolveDialog({ item: found, decision: "approved" });
                      }}
                      onReject={id => {
                        const found = items.find(i => i.id === id);
                        if (found) setResolveDialog({ item: found, decision: "rejected" });
                      }}
                      onUndo={id => undoMut.mutate(id)}
                    />
                  ))}
                </TabsContent>
              ))}
            </Tabs>
          </CardContent>
        </Card>

        {/* Resolve Dialog */}
        {resolveDialog && (
          <ResolveDialog
            item={resolveDialog.item}
            decision={resolveDialog.decision}
            open={true}
            onClose={() => setResolveDialog(null)}
            onConfirm={reason =>
              resolveMut.mutate({ id: resolveDialog.item.id, decision: resolveDialog.decision, reason })
            }
            isPending={resolveMut.isPending}
          />
        )}
      </div>
    </AppShell>
  );
}
