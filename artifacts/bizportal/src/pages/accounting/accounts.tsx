import { useState, useMemo, useEffect, useCallback } from "react";
import { useCodeCheck } from "@/hooks/useCodeCheck";
import { CodeCheckIndicator } from "@/components/ui/code-check-indicator";
import { AppShell } from "@/components/layout/AppShell";
import { useLanguage } from "@/contexts/LanguageContext";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle, DialogTrigger,
} from "@/components/ui/dialog";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import {
  Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList,
} from "@/components/ui/command";
import {
  Popover, PopoverContent, PopoverTrigger,
} from "@/components/ui/popover";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { useToast } from "@/hooks/use-toast";
import {
  useCreateAccount, useUpdateAccount, useDeleteAccount,
  type Account,
} from "@workspace/api-client-react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useCompany } from "@/contexts/CompanyContext";
import {
  Pencil, Plus, Trash2, Landmark, Search, ChevronRight, ChevronDown,
  ChevronsUpDown, Check, Clock, AlertTriangle, CheckCircle2, ArrowLeft,
  History, ListChecks,
} from "lucide-react";
import { Link } from "wouter";

// ─── Constants ────────────────────────────────────────────────────────────────

const TYPE_LABELS: Record<string, string> = {
  asset: "Aset",
  liability: "Liabilitas",
  equity: "Ekuitas",
  revenue: "Pendapatan",
  expense: "Beban",
};

const TYPE_COLORS: Record<string, string> = {
  asset: "bg-blue-50 text-blue-700 border-blue-200",
  liability: "bg-orange-50 text-orange-700 border-orange-200",
  equity: "bg-purple-50 text-purple-700 border-purple-200",
  revenue: "bg-green-50 text-green-700 border-green-200",
  expense: "bg-red-50 text-red-700 border-red-200",
};

const CR_STATUS_LABELS: Record<string, string> = {
  DRAFT: "Draf",
  PENDING_APPROVAL: "Menunggu Persetujuan",
  APPROVED: "Disetujui",
  REJECTED: "Ditolak",
  CANCELLED: "Dibatalkan",
};

const CR_STATUS_COLORS: Record<string, string> = {
  DRAFT: "bg-slate-100 text-slate-700 border-slate-200",
  PENDING_APPROVAL: "bg-amber-50 text-amber-700 border-amber-200",
  APPROVED: "bg-green-50 text-green-700 border-green-200",
  REJECTED: "bg-red-50 text-red-700 border-red-200",
  CANCELLED: "bg-gray-100 text-gray-500 border-gray-200",
};

const CR_ACTION_LABELS: Record<string, string> = {
  CREATE: "Buat Akun",
  UPDATE: "Perbarui Akun",
  UPDATE_NAME: "Ubah Nama",
  UPDATE_CODE: "Ubah Kode",
  UPDATE_PARENT: "Ubah Induk",
  UPDATE_CATEGORY: "Ubah Kategori",
  UPDATE_NORMAL_BALANCE: "Ubah Saldo Normal",
  UPDATE_POSTABLE: "Ubah Postable",
  ACTIVATE: "Aktifkan",
  DEACTIVATE: "Nonaktifkan",
  ARCHIVE: "Arsipkan",
};

// ─── Types ────────────────────────────────────────────────────────────────────

interface AccountWithCompany extends Account {
  companyCode: string | null;
  companyName?: string | null;
}

interface TreeNode extends AccountWithCompany {
  children: TreeNode[];
  depth: number;
}

interface CompanyOption {
  id: number;
  name: string;
  code: string;
}

interface CoaChangeRequest {
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

interface RekonInfo {
  config: { lastRunDate?: string; enabled?: boolean } | null;
  lastManualRekonAt: string | null;
}

// ─── Tree helpers ─────────────────────────────────────────────────────────────

function buildTree(accounts: AccountWithCompany[]): TreeNode[] {
  const byId = new Map<number, TreeNode>();
  const roots: TreeNode[] = [];

  for (const a of accounts) {
    byId.set(a.id, { ...a, children: [], depth: 0 });
  }

  for (const node of byId.values()) {
    if (node.parentId && byId.has(node.parentId)) {
      byId.get(node.parentId)!.children.push(node);
    } else {
      roots.push(node);
    }
  }

  function setDepth(node: TreeNode, depth: number) {
    node.depth = depth;
    node.children.sort((a, b) => a.code.localeCompare(b.code));
    node.children.forEach((c) => setDepth(c, depth + 1));
  }
  roots.sort((a, b) => a.code.localeCompare(b.code));
  roots.forEach((r) => setDepth(r, 0));

  return roots;
}

function flattenTree(nodes: TreeNode[]): TreeNode[] {
  const result: TreeNode[] = [];
  function walk(ns: TreeNode[]) {
    for (const n of ns) {
      result.push(n);
      if (n.children.length) walk(n.children);
    }
  }
  walk(nodes);
  return result;
}

const OVERDUE_DAYS = 7;
const WARN_DAYS = 3;

function daysSince(dateStr: string | null): number | null {
  if (!dateStr) return null;
  const diff = Date.now() - new Date(dateStr).getTime();
  return Math.floor(diff / (1000 * 60 * 60 * 24));
}

// ─── RekonStatusCard ──────────────────────────────────────────────────────────

function RekonStatusCard() {
  const [info, setInfo] = useState<RekonInfo | null>(null);
  useEffect(() => {
    fetch("/api/accounting/rekon-schedule", { credentials: "include" })
      .then((r) => r.json())
      .then((j) => setInfo(j as RekonInfo))
      .catch(() => {});
  }, []);

  if (!info) return null;

  const autoEnabled = info?.config?.enabled ?? false;

  const manualTs = info.lastManualRekonAt ? new Date(info.lastManualRekonAt).getTime() : 0;
  const autoTs = info.config?.lastRunDate ? new Date(info.config.lastRunDate).getTime() : 0;
  const latestTs = Math.max(manualTs, autoTs);
  const latestDate = latestTs > 0 ? new Date(latestTs) : null;
  const latestSource = latestTs === 0 ? null : latestTs === manualTs ? "manual" : "otomatis";

  const manualDays = daysSince(info.lastManualRekonAt);
  const autoDays = daysSince(info.config?.lastRunDate ?? null);
  const latestDays = latestDate ? Math.floor((Date.now() - latestTs) / (1000 * 60 * 60 * 24)) : null;

  const isOverdue = latestDays === null || latestDays >= OVERDUE_DAYS;
  const isWarn = !isOverdue && latestDays >= WARN_DAYS;

  const fmtDate = (ts: number) => new Date(ts).toLocaleString("id-ID", { day: "2-digit", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" });
  const fmtSimple = (s: string) => new Date(s).toLocaleDateString("id-ID", { day: "2-digit", month: "short", year: "numeric" });

  const cardClass = isOverdue
    ? "border-red-200 bg-red-50/60"
    : isWarn
    ? "border-amber-200 bg-amber-50/60"
    : "border-green-200 bg-green-50/40";

  const iconEl = isOverdue
    ? <AlertTriangle className="h-4 w-4 text-red-500 shrink-0" />
    : isWarn
    ? <AlertTriangle className="h-4 w-4 text-amber-500 shrink-0" />
    : <CheckCircle2 className="h-4 w-4 text-green-600 shrink-0" />;

  const titleColor = isOverdue ? "text-red-800" : isWarn ? "text-amber-800" : "text-green-800";
  const descColor = isOverdue ? "text-red-600" : isWarn ? "text-amber-600" : "text-green-700";

  const alertMsg = isOverdue && latestDate === null
    ? "Belum pernah direkonsiliasi! Segera lakukan rekonsiliasi bank."
    : isOverdue
    ? `Rekonsiliasi terakhir ${latestDays} hari yang lalu — sudah melewati batas ${OVERDUE_DAYS} hari.`
    : isWarn
    ? `Rekonsiliasi terakhir ${latestDays} hari yang lalu — segera lakukan sebelum ${OVERDUE_DAYS} hari.`
    : `Rekonsiliasi terkini — terakhir ${latestDays === 0 ? "hari ini" : `${latestDays} hari lalu`} (${latestSource}).`;

  return (
    <Card className={cardClass}>
      <CardContent className="p-3 space-y-2">
        <div className="flex flex-wrap items-center gap-x-4 gap-y-1">
          <div className={`flex items-center gap-1.5 text-sm font-semibold ${titleColor}`}>
            {iconEl}
            <span>Rekonsiliasi Bank</span>
          </div>
          <span className={`text-xs ${descColor}`}>{alertMsg}</span>
          <Link href="/accounting/reconciliation" className={`ml-auto text-xs font-medium hover:underline ${isOverdue ? "text-red-700" : isWarn ? "text-amber-700" : "text-green-700"}`}>
            {isOverdue ? "⚡ Rekonsiliasi Sekarang →" : "Buka Rekonsiliasi →"}
          </Link>
        </div>
        <div className="flex flex-wrap gap-x-5 gap-y-0.5 text-xs text-slate-500">
          <span className="flex items-center gap-1">
            <Clock className="h-3 w-3" />
            Manual terakhir:{" "}
            <span className="font-medium text-slate-700">
              {manualTs > 0 ? `${fmtDate(manualTs)}${manualDays !== null ? ` (${manualDays === 0 ? "hari ini" : `${manualDays}h lalu`})` : ""}` : "—"}
            </span>
          </span>
          <span className="flex items-center gap-1">
            <Clock className="h-3 w-3" />
            Otomatis terakhir:{" "}
            <span className="font-medium text-slate-700">
              {info.config?.lastRunDate ? `${fmtSimple(info.config.lastRunDate)}${autoDays !== null ? ` (${autoDays === 0 ? "hari ini" : `${autoDays}h lalu`})` : ""}` : "—"}
            </span>
            {autoEnabled
              ? <span className="bg-green-100 text-green-700 px-1 py-0 rounded border border-green-200">Aktif</span>
              : <span className="bg-slate-100 text-slate-500 px-1 py-0 rounded border border-slate-200">Nonaktif</span>}
          </span>
        </div>
      </CardContent>
    </Card>
  );
}

// ─── SnapshotDiff — compact before/after comparison ──────────────────────────

function SnapshotDiff({
  before,
  after,
}: {
  before: Record<string, unknown> | null;
  after: Record<string, unknown>;
}) {
  const keys = Array.from(new Set([
    ...Object.keys(after),
    ...(before ? Object.keys(before) : []),
  ])).filter((k) => k !== "updatedAt" && k !== "createdAt" && k !== "version");

  const changed = keys.filter((k) => {
    const bv = before?.[k] ?? "—";
    const av = after[k] ?? "—";
    return String(bv) !== String(av);
  });

  if (changed.length === 0) {
    return <span className="text-xs text-muted-foreground italic">Tidak ada perubahan</span>;
  }

  return (
    <div className="space-y-1">
      {changed.map((k) => (
        <div key={k} className="flex items-start gap-2 text-xs">
          <span className="font-mono text-slate-500 min-w-[120px] shrink-0">{k}</span>
          <span className="line-through text-red-500">{String(before?.[k] ?? "—")}</span>
          <span className="text-muted-foreground">→</span>
          <span className="text-green-700 font-medium">{String(after[k] ?? "—")}</span>
        </div>
      ))}
    </div>
  );
}

// ─── CoaPendingApprovalTab ────────────────────────────────────────────────────

function CoaPendingApprovalTab({ currentUserActor }: { currentUserActor: string | null }) {
  const { toast } = useToast();
  const [items, setItems] = useState<CoaChangeRequest[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [actionLoading, setActionLoading] = useState<number | null>(null);
  const [rejectDialog, setRejectDialog] = useState<{ open: boolean; id: number | null; comments: string }>({
    open: false, id: null, comments: "",
  });

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/accounting/coa/change-requests", { credentials: "include" });
      if (!res.ok) {
        const msg = await res.text().catch(() => "");
        setError(`Gagal memuat data: ${res.status}${msg ? ` — ${msg}` : ""}`);
        return;
      }
      const all: CoaChangeRequest[] = await res.json();
      setItems(all.filter((r) => r.status === "DRAFT" || r.status === "PENDING_APPROVAL"));
    } catch (e: unknown) {
      setError((e as Error).message ?? "Terjadi kesalahan");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  const doAction = async (
    id: number,
    action: "submit" | "approve" | "cancel",
    comments?: string,
  ) => {
    setActionLoading(id);
    try {
      const res = await fetch(`/api/accounting/coa/change-requests/${id}/${action}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify(comments !== undefined ? { comments } : {}),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) {
        toast({
          title: "Gagal",
          description: (body as { message?: string }).message ?? `Status ${res.status}`,
          variant: "destructive",
        });
        return;
      }
      toast({ title: "Berhasil", description: (body as { message?: string }).message });
      await load();
    } finally {
      setActionLoading(null);
    }
  };

  const doReject = async () => {
    if (rejectDialog.id === null) return;
    setActionLoading(rejectDialog.id);
    try {
      const res = await fetch(`/api/accounting/coa/change-requests/${rejectDialog.id}/reject`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ comments: rejectDialog.comments }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) {
        toast({
          title: "Gagal menolak",
          description: (body as { message?: string }).message ?? `Status ${res.status}`,
          variant: "destructive",
        });
        return;
      }
      toast({ title: "Ditolak", description: (body as { message?: string }).message });
      setRejectDialog({ open: false, id: null, comments: "" });
      await load();
    } finally {
      setActionLoading(null);
    }
  };

  const isMaker = (cr: CoaChangeRequest): boolean =>
    currentUserActor !== null && cr.requestedBy === currentUserActor;

  if (loading) {
    return (
      <Card>
        <CardContent className="p-8 text-center text-sm text-muted-foreground">
          Memuat change request…
        </CardContent>
      </Card>
    );
  }

  if (error) {
    return (
      <Card>
        <CardContent className="p-8">
          <p className="text-sm text-destructive">{error}</p>
          <Button variant="outline" size="sm" className="mt-2" onClick={load}>Coba lagi</Button>
        </CardContent>
      </Card>
    );
  }

  if (items.length === 0) {
    return (
      <Card>
        <CardContent className="p-8 text-center">
          <ListChecks className="h-8 w-8 mx-auto text-muted-foreground mb-2" />
          <p className="text-sm text-muted-foreground">Tidak ada change request yang menunggu persetujuan.</p>
        </CardContent>
      </Card>
    );
  }

  return (
    <>
      <div className="space-y-3">
        {items.map((cr) => (
          <Card key={cr.id} className="overflow-hidden">
            <CardContent className="p-4 space-y-3">
              {/* Header row */}
              <div className="flex flex-wrap items-center gap-2">
                <span className="font-mono text-xs text-muted-foreground">#{cr.id}</span>
                <Badge variant="outline" className={`text-xs ${CR_STATUS_COLORS[cr.status] ?? ""}`}>
                  {CR_STATUS_LABELS[cr.status] ?? cr.status}
                </Badge>
                <Badge variant="outline" className="text-xs">
                  {CR_ACTION_LABELS[cr.action] ?? cr.action}
                </Badge>
                {cr.coaId && (
                  <span className="text-xs text-muted-foreground">COA #{cr.coaId}</span>
                )}
                <span className="ml-auto text-xs text-muted-foreground">
                  {new Date(cr.requestedAt).toLocaleString("id-ID", {
                    day: "2-digit", month: "short", year: "numeric",
                    hour: "2-digit", minute: "2-digit",
                  })}
                </span>
              </div>

              {/* Maker info */}
              <div className="text-xs text-muted-foreground">
                Diajukan oleh: <span className="font-medium text-foreground">{cr.requestedBy}</span>
                {isMaker(cr) && (
                  <Badge variant="outline" className="ml-2 text-xs bg-blue-50 text-blue-700 border-blue-200">
                    Anda
                  </Badge>
                )}
              </div>

              {/* Alasan */}
              <div className="text-xs">
                <span className="text-muted-foreground">Alasan: </span>
                <span>{cr.reason}</span>
              </div>

              {/* Before/After diff */}
              <div className="bg-slate-50 rounded-md p-3 border border-slate-100">
                <p className="text-xs font-medium text-slate-600 mb-1.5">Perubahan yang Diusulkan</p>
                <SnapshotDiff before={cr.beforeSnapshotJson} after={cr.afterSnapshotJson} />
              </div>

              {/* Actions */}
              <div className="flex flex-wrap gap-2 pt-1">
                {/* Submit: only maker on DRAFT */}
                {cr.status === "DRAFT" && isMaker(cr) && (
                  <Button
                    size="sm"
                    variant="default"
                    disabled={actionLoading === cr.id}
                    onClick={() => doAction(cr.id, "submit")}
                  >
                    {actionLoading === cr.id ? "Memproses…" : "Submit untuk Persetujuan"}
                  </Button>
                )}

                {/* Approve / Reject: only admin — not shown to maker (backend still enforces) */}
                {cr.status === "PENDING_APPROVAL" && !isMaker(cr) && (
                  <>
                    <Button
                      size="sm"
                      variant="default"
                      className="bg-green-600 hover:bg-green-700"
                      disabled={actionLoading === cr.id}
                      onClick={() => doAction(cr.id, "approve")}
                    >
                      {actionLoading === cr.id ? "Memproses…" : "Setujui"}
                    </Button>
                    <Button
                      size="sm"
                      variant="outline"
                      className="border-red-300 text-red-600 hover:bg-red-50"
                      disabled={actionLoading === cr.id}
                      onClick={() => setRejectDialog({ open: true, id: cr.id, comments: "" })}
                    >
                      Tolak
                    </Button>
                  </>
                )}

                {/* Cancel: maker on DRAFT or PENDING_APPROVAL */}
                {(cr.status === "DRAFT" || cr.status === "PENDING_APPROVAL") && isMaker(cr) && (
                  <Button
                    size="sm"
                    variant="ghost"
                    className="text-muted-foreground"
                    disabled={actionLoading === cr.id}
                    onClick={() => doAction(cr.id, "cancel")}
                  >
                    Batalkan
                  </Button>
                )}
              </div>
            </CardContent>
          </Card>
        ))}
      </div>

      {/* Reject dialog */}
      <Dialog
        open={rejectDialog.open}
        onOpenChange={(o) => setRejectDialog((prev) => ({ ...prev, open: o }))}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Tolak Change Request</DialogTitle>
          </DialogHeader>
          <div className="space-y-2">
            <Label>Alasan Penolakan (opsional)</Label>
            <Input
              placeholder="Catatan untuk maker…"
              value={rejectDialog.comments}
              onChange={(e) => setRejectDialog((prev) => ({ ...prev, comments: e.target.value }))}
            />
          </div>
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => setRejectDialog({ open: false, id: null, comments: "" })}
            >
              Batal
            </Button>
            <Button
              variant="destructive"
              disabled={actionLoading === rejectDialog.id}
              onClick={doReject}
            >
              {actionLoading === rejectDialog.id ? "Memproses…" : "Tolak"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}

// ─── CoaHistoryTab ────────────────────────────────────────────────────────────

function CoaHistoryTab() {
  const [items, setItems] = useState<CoaChangeRequest[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/accounting/coa/change-requests", { credentials: "include" });
      if (!res.ok) {
        const msg = await res.text().catch(() => "");
        setError(`Gagal memuat histori: ${res.status}${msg ? ` — ${msg}` : ""}`);
        return;
      }
      const all: CoaChangeRequest[] = await res.json();
      setItems(
        all
          .filter((r) => r.status === "APPROVED" || r.status === "REJECTED" || r.status === "CANCELLED")
          .sort((a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime()),
      );
    } catch (e: unknown) {
      setError((e as Error).message ?? "Terjadi kesalahan");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  const fmtDate = (s: string) =>
    new Date(s).toLocaleString("id-ID", {
      day: "2-digit", month: "short", year: "numeric",
      hour: "2-digit", minute: "2-digit",
    });

  if (loading) {
    return (
      <Card>
        <CardContent className="p-8 text-center text-sm text-muted-foreground">
          Memuat histori…
        </CardContent>
      </Card>
    );
  }

  if (error) {
    return (
      <Card>
        <CardContent className="p-8">
          <p className="text-sm text-destructive">{error}</p>
          <Button variant="outline" size="sm" className="mt-2" onClick={load}>Coba lagi</Button>
        </CardContent>
      </Card>
    );
  }

  if (items.length === 0) {
    return (
      <Card>
        <CardContent className="p-8 text-center">
          <History className="h-8 w-8 mx-auto text-muted-foreground mb-2" />
          <p className="text-sm text-muted-foreground">Belum ada histori perubahan COA.</p>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card>
      <CardContent className="p-0 overflow-x-auto">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className="w-16">#</TableHead>
              <TableHead>Aksi</TableHead>
              <TableHead>Status</TableHead>
              <TableHead>Diajukan Oleh</TableHead>
              <TableHead>Waktu Ajuan</TableHead>
              <TableHead>Diperiksa Oleh</TableHead>
              <TableHead>Waktu Periksa</TableHead>
              <TableHead>Catatan Reviewer</TableHead>
              <TableHead>Perubahan</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {items.map((cr) => (
              <TableRow key={cr.id}>
                <TableCell className="font-mono text-xs text-muted-foreground">#{cr.id}</TableCell>
                <TableCell>
                  <Badge variant="outline" className="text-xs">
                    {CR_ACTION_LABELS[cr.action] ?? cr.action}
                  </Badge>
                </TableCell>
                <TableCell>
                  <Badge
                    variant="outline"
                    className={`text-xs ${CR_STATUS_COLORS[cr.status] ?? ""}`}
                  >
                    {CR_STATUS_LABELS[cr.status] ?? cr.status}
                  </Badge>
                </TableCell>
                <TableCell className="text-xs">{cr.requestedBy}</TableCell>
                <TableCell className="text-xs whitespace-nowrap">{fmtDate(cr.requestedAt)}</TableCell>
                <TableCell className="text-xs">{cr.reviewedBy ?? "—"}</TableCell>
                <TableCell className="text-xs whitespace-nowrap">
                  {cr.reviewedAt ? fmtDate(cr.reviewedAt) : "—"}
                </TableCell>
                <TableCell className="text-xs max-w-[200px]">
                  {cr.reviewComments ?? "—"}
                </TableCell>
                <TableCell className="text-xs max-w-[300px]">
                  <SnapshotDiff before={cr.beforeSnapshotJson} after={cr.afterSnapshotJson} />
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
        <p className="text-xs text-muted-foreground px-4 py-2">
          {items.length} histori perubahan
        </p>
      </CardContent>
    </Card>
  );
}

// ─── AccountsPage ─────────────────────────────────────────────────────────────

export default function AccountsPage() {
  const qc = useQueryClient();
  const { toast } = useToast();
  const { t } = useLanguage();
  const { activeCompanyId, isConsolidated } = useCompany();

  const companyId = activeCompanyId ?? 1;

  // Current user actor for maker-checker UI hint
  const [currentUserActor, setCurrentUserActor] = useState<string | null>(null);
  useEffect(() => {
    fetch("/api/auth/user", { credentials: "include" })
      .then((r) => r.ok ? r.json() : null)
      .then((body) => {
        if (!body) return;
        const u = (body as { user?: { id?: string; email?: string } | null }).user;
        if (u) setCurrentUserActor(u.email ?? u.id ?? null);
      })
      .catch(() => {});
  }, []);

  // Active tab
  const [activeTab, setActiveTab] = useState("daftar");

  // Company list for filter dropdown
  const [companies, setCompanies] = useState<CompanyOption[]>([]);
  useEffect(() => {
    fetch("/api/companies/list", { credentials: "include" })
      .then(r => r.json())
      .then(data => setCompanies(Array.isArray(data) ? data : (data.data ?? [])))
      .catch(() => {});
  }, []);

  // filterCompanyId: "all" = semua perusahaan, number string = satu perusahaan
  const [filterCompanyId, setFilterCompanyId] = useState<string>(
    isConsolidated ? "all" : String(companyId)
  );

  // Sync filter when active company changes
  useEffect(() => {
    if (!isConsolidated) setFilterCompanyId(String(companyId));
  }, [companyId, isConsolidated]);

  const queryKey = ["/api/accounting/accounts", filterCompanyId];
  const { data: accounts = [] } = useQuery<AccountWithCompany[]>({
    queryKey,
    queryFn: async ({ signal }) => {
      const params = new URLSearchParams({ company: filterCompanyId });
      const res = await fetch(`/api/accounting/accounts?${params}`, {
        credentials: "include",
        signal,
      });
      if (!res.ok) throw new Error("Gagal memuat akun");
      return res.json();
    },
  });

  const createMut = useCreateAccount();
  const updateMut = useUpdateAccount();
  const deleteMut = useDeleteAccount();

  const [open, setOpen] = useState(false);
  const [parentPopoverOpen, setParentPopoverOpen] = useState(false);
  const [editing, setEditing] = useState<AccountWithCompany | null>(null);
  const [search, setSearch] = useState("");
  const [collapsed, setCollapsed] = useState<Set<number>>(new Set());
  const [form, setForm] = useState({
    code: "", name: "", type: "asset" as Account["type"],
    isActive: true, parentId: null as number | null,
  });

  // Mutations always target the active company (not the filter)
  const mutationCompanyId = companyId;

  const reset = () => {
    setEditing(null);
    setForm({ code: "", name: "", type: "asset", isActive: true, parentId: null });
  };

  const startEdit = (a: AccountWithCompany) => {
    setEditing(a);
    setForm({ code: a.code, name: a.name, type: a.type, isActive: a.isActive, parentId: a.parentId ?? null });
    setOpen(true);
  };

  const toggleCollapse = (id: number) => {
    setCollapsed((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const codeCheckUrl = open && form.code.trim()
    ? `/api/accounting/accounts/check-code?code=${encodeURIComponent(form.code)}&companyId=${mutationCompanyId}${editing ? `&excludeId=${editing.id}` : ""}`
    : null;
  const { checking: codeChecking, taken: codeTaken } = useCodeCheck(codeCheckUrl, form.code);

  const submit = async () => {
    if (!form.code.trim() || !form.name.trim()) {
      toast({ title: t.common.error, variant: "destructive" }); return;
    }
    try {
      const payload = { ...form, companyId: mutationCompanyId, parentId: form.parentId ?? undefined };
      if (editing) {
        await updateMut.mutateAsync({ id: editing.id, data: payload });
        toast({ title: t.common.success });
      } else {
        await createMut.mutateAsync({ data: payload });
        toast({ title: t.common.success });
      }
      qc.invalidateQueries({ queryKey });
      reset(); setOpen(false);
    } catch (e: unknown) {
      toast({ title: t.common.error, description: (e as Error)?.message ?? String(e), variant: "destructive" });
    }
  };

  const remove = async (a: AccountWithCompany) => {
    if (!confirm(t.common.confirmDeleteDesc)) return;
    try {
      await deleteMut.mutateAsync({ id: a.id });
      toast({ title: t.common.success });
      qc.invalidateQueries({ queryKey });
    } catch (e: unknown) {
      toast({ title: t.common.error, description: (e as Error)?.message ?? String(e), variant: "destructive" });
    }
  };

  // Show company column when viewing all companies
  const showCompanyCol = filterCompanyId === "all";

  const { treeFlat, searchFlat } = useMemo(() => {
    const tree = buildTree(accounts);
    const flat = flattenTree(tree);
    const s = search.toLowerCase().trim();
    if (!s) return { treeFlat: flat, searchFlat: null };
    const searchFlat = accounts
      .filter((a) =>
        a.code.toLowerCase().includes(s) ||
        a.name.toLowerCase().includes(s) ||
        (a.companyCode ?? "").toLowerCase().includes(s)
      )
      .map((a) => ({ ...a, children: [], depth: 0 } as TreeNode))
      .sort((a, b) => a.code.localeCompare(b.code));
    return { treeFlat: flat, searchFlat };
  }, [accounts, search]);

  const displayed = search.trim() ? searchFlat! : treeFlat.filter((node) => {
    if (!node.parentId) return true;
    const parentCollapsed = (acc: AccountWithCompany): boolean => {
      if (!acc.parentId) return collapsed.has(acc.id);
      const parent = accounts.find((a) => a.id === acc.parentId);
      return collapsed.has(acc.id) || (parent ? parentCollapsed(parent) : false);
    };
    const parent = accounts.find((a) => a.id === node.parentId);
    return parent ? !parentCollapsed(parent) : true;
  });

  const isParent = (node: TreeNode) => node.children.length > 0;
  // Total columns: Kode + Nama + [Perusahaan?] + Tipe + Status + Aksi
  const colSpan = showCompanyCol ? 6 : 5;

  return (
    <AppShell>
      <div className="space-y-6 p-6">
        {/* Page header */}
        <div className="flex items-center justify-between">
          <div>
            <Link href="/accounting">
              <Button variant="ghost" size="icon" aria-label="Kembali">
                <ArrowLeft className="h-4 w-4" />
              </Button>
            </Link>
            <h1 className="text-2xl font-bold flex items-center gap-2">
              <Landmark className="h-6 w-6" /> Bagan Akun
            </h1>
            <p className="text-sm text-muted-foreground">
              Chart of Accounts (CoA) — hierarki akun buku besar
            </p>
          </div>
          {/* Add account dialog button — only shown on Daftar tab */}
          {activeTab === "daftar" && (
            <div className="flex items-center gap-2">
              <Dialog open={open} onOpenChange={(o) => { setOpen(o); if (!o) reset(); }}>
                <DialogTrigger asChild>
                  <Button data-testid="button-add-account">
                    <Plus className="h-4 w-4 mr-2" />Tambah Akun
                  </Button>
                </DialogTrigger>
                <DialogContent>
                  <DialogHeader>
                    <DialogTitle>{editing ? "Edit Akun" : "Akun Baru"}</DialogTitle>
                  </DialogHeader>
                  <div className="space-y-3">
                    <div>
                      <Label>Kode</Label>
                      <Input
                        data-testid="input-account-code"
                        value={form.code}
                        onChange={(e) => setForm({ ...form, code: e.target.value })}
                        placeholder="5-2010"
                        className={codeTaken === true ? "border-destructive focus-visible:ring-destructive" : ""}
                      />
                      <CodeCheckIndicator checking={codeChecking} taken={codeTaken} />
                    </div>
                    <div>
                      <Label>Nama</Label>
                      <Input
                        data-testid="input-account-name"
                        value={form.name}
                        onChange={(e) => setForm({ ...form, name: e.target.value })}
                        placeholder="Beban Gaji"
                      />
                    </div>
                    <div>
                      <Label>Tipe</Label>
                      <Select
                        value={form.type}
                        onValueChange={(v) => setForm({ ...form, type: v as Account["type"] })}
                      >
                        <SelectTrigger data-testid="select-account-type">
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          {Object.entries(TYPE_LABELS).map(([k, v]) => (
                            <SelectItem key={k} value={k}>{v}</SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>
                    <div>
                      <Label>Akun Induk (opsional)</Label>
                      <Popover open={parentPopoverOpen} onOpenChange={setParentPopoverOpen}>
                        <PopoverTrigger asChild>
                          <Button
                            variant="outline"
                            role="combobox"
                            className="w-full justify-between font-normal"
                          >
                            {form.parentId
                              ? (() => {
                                  const a = accounts.find((x) => x.id === form.parentId);
                                  return a ? `${a.code} — ${a.name}` : "— Tidak ada (akun akar) —";
                                })()
                              : "— Tidak ada (akun akar) —"}
                            <ChevronsUpDown className="ml-2 h-4 w-4 shrink-0 opacity-50" />
                          </Button>
                        </PopoverTrigger>
                        <PopoverContent className="w-[400px] p-0" align="start">
                          <Command>
                            <CommandInput placeholder="Cari kode atau nama akun..." />
                            <CommandList>
                              <CommandEmpty>Akun tidak ditemukan</CommandEmpty>
                              <CommandGroup>
                                <CommandItem
                                  value="none"
                                  onSelect={() => { setForm({ ...form, parentId: null }); setParentPopoverOpen(false); }}
                                >
                                  <Check className={`mr-2 h-4 w-4 ${!form.parentId ? "opacity-100" : "opacity-0"}`} />
                                  — Tidak ada (akun akar) —
                                </CommandItem>
                                {accounts
                                  .filter((a) => a.id !== editing?.id)
                                  .sort((a, b) => a.code.localeCompare(b.code))
                                  .map((a) => (
                                    <CommandItem
                                      key={a.id}
                                      value={`${a.code} ${a.name}`}
                                      onSelect={() => { setForm({ ...form, parentId: a.id }); setParentPopoverOpen(false); }}
                                    >
                                      <Check className={`mr-2 h-4 w-4 ${form.parentId === a.id ? "opacity-100" : "opacity-0"}`} />
                                      {a.code} — {a.name}
                                    </CommandItem>
                                  ))}
                              </CommandGroup>
                            </CommandList>
                          </Command>
                        </PopoverContent>
                      </Popover>
                    </div>
                    <div className="flex items-center gap-2">
                      <input
                        type="checkbox"
                        id="active"
                        checked={form.isActive}
                        onChange={(e) => setForm({ ...form, isActive: e.target.checked })}
                      />
                      <Label htmlFor="active">Aktif</Label>
                    </div>
                  </div>
                  <DialogFooter>
                    <Button variant="outline" onClick={() => { setOpen(false); reset(); }}>Batal</Button>
                    <Button onClick={submit} data-testid="button-save-account">Simpan</Button>
                  </DialogFooter>
                </DialogContent>
              </Dialog>
            </div>
          )}
        </div>

        <RekonStatusCard />

        {/* ── Governance Tabs ── */}
        <Tabs value={activeTab} onValueChange={setActiveTab}>
          <TabsList>
            <TabsTrigger value="daftar">
              <Landmark className="h-4 w-4 mr-1.5" />
              Daftar COA
            </TabsTrigger>
            <TabsTrigger value="pending">
              <ListChecks className="h-4 w-4 mr-1.5" />
              Pending Approval
            </TabsTrigger>
            <TabsTrigger value="history">
              <History className="h-4 w-4 mr-1.5" />
              History
            </TabsTrigger>
          </TabsList>

          {/* ── Tab 1: Daftar COA ── */}
          <TabsContent value="daftar" className="mt-4">
            <Card>
              <CardContent className="p-4">
                {/* Filter bar */}
                <div className="flex flex-wrap gap-2 mb-3">
                  <Select value={filterCompanyId} onValueChange={setFilterCompanyId}>
                    <SelectTrigger className="w-52">
                      <SelectValue placeholder="Semua Perusahaan" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="all">Semua Perusahaan</SelectItem>
                      {companies.map(c => (
                        <SelectItem key={c.id} value={String(c.id)}>
                          {c.code ? `${c.code} – ${c.name}` : c.name}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>

                  <div className="relative flex-1 min-w-[200px]">
                    <Search className="absolute left-2 top-2.5 h-4 w-4 text-muted-foreground" />
                    <Input
                      className="pl-8"
                      placeholder="Cari kode, nama, atau perusahaan..."
                      value={search}
                      onChange={(e) => setSearch(e.target.value)}
                      data-testid="input-search-account"
                    />
                  </div>
                </div>

                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead className="w-36">Kode</TableHead>
                      <TableHead>Nama Akun</TableHead>
                      {showCompanyCol && <TableHead className="w-28">Perusahaan</TableHead>}
                      <TableHead className="w-32">Tipe</TableHead>
                      <TableHead className="w-24">Status</TableHead>
                      <TableHead className="w-24 text-right">Aksi</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {displayed.length === 0 ? (
                      <TableRow>
                        <TableCell colSpan={colSpan} className="text-center text-muted-foreground py-8">
                          {search ? "Tidak ada hasil pencarian" : "Tidak ada akun"}
                        </TableCell>
                      </TableRow>
                    ) : displayed.map((a) => {
                      const isGroup = isParent(a);
                      const isCollapsed = collapsed.has(a.id);
                      const indent = a.depth * 20;

                      return (
                        <TableRow
                          key={a.id}
                          data-testid={`row-account-${a.id}`}
                          className={isGroup && a.depth === 0 ? "bg-muted/40 font-semibold" : isGroup ? "bg-muted/20 font-medium" : ""}
                        >
                          <TableCell className="font-mono text-sm">
                            <div style={{ paddingLeft: indent }} className="flex items-center gap-1">
                              {isGroup && !search.trim() ? (
                                <button
                                  onClick={() => toggleCollapse(a.id)}
                                  className="text-muted-foreground hover:text-foreground"
                                >
                                  {isCollapsed ? <ChevronRight size={14} /> : <ChevronDown size={14} />}
                                </button>
                              ) : (
                                <span className="w-[14px] inline-block" />
                              )}
                              <span>{a.code}</span>
                            </div>
                          </TableCell>
                          <TableCell>
                            <div style={{ paddingLeft: indent }} className="flex items-center gap-1.5">
                              {isGroup && <span className="text-xs text-muted-foreground">[Grup]</span>}
                              {a.name}
                            </div>
                          </TableCell>
                          {showCompanyCol && (
                            <TableCell>
                              {a.companyCode ? (
                                <Badge variant="outline" className="text-xs font-mono">
                                  {a.companyCode}
                                </Badge>
                              ) : (
                                <span className="text-xs text-muted-foreground italic">Global</span>
                              )}
                            </TableCell>
                          )}
                          <TableCell>
                            <span className={`text-xs px-2 py-0.5 rounded border font-medium ${TYPE_COLORS[a.type] ?? ""}`}>
                              {TYPE_LABELS[a.type] ?? a.type}
                            </span>
                          </TableCell>
                          <TableCell>
                            {a.isActive
                              ? <Badge variant="secondary" className="bg-green-100 text-green-700 text-xs">Aktif</Badge>
                              : <Badge variant="secondary" className="text-xs">Non-aktif</Badge>
                            }
                          </TableCell>
                          <TableCell className="text-right">
                            <Button
                              size="icon"
                              variant="ghost"
                              onClick={() => startEdit(a)}
                              data-testid={`button-edit-${a.id}`}
                            >
                              <Pencil className="h-4 w-4" />
                            </Button>
                            <Button
                              size="icon"
                              variant="ghost"
                              onClick={() => remove(a)}
                              data-testid={`button-delete-${a.id}`}
                            >
                              <Trash2 className="h-4 w-4" />
                            </Button>
                          </TableCell>
                        </TableRow>
                      );
                    })}
                  </TableBody>
                </Table>
                <p className="text-xs text-muted-foreground mt-2 px-1">
                  {accounts.length} akun total{showCompanyCol ? " · semua perusahaan" : ""} — klik ikon segitiga untuk buka/tutup grup
                </p>
              </CardContent>
            </Card>
          </TabsContent>

          {/* ── Tab 2: Pending Approval ── */}
          <TabsContent value="pending" className="mt-4">
            <CoaPendingApprovalTab currentUserActor={currentUserActor} />
          </TabsContent>

          {/* ── Tab 3: History ── */}
          <TabsContent value="history" className="mt-4">
            <CoaHistoryTab />
          </TabsContent>
        </Tabs>
      </div>
    </AppShell>
  );
}
