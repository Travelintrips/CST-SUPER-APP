import { useState, useMemo } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { AppShell } from "@/components/layout/AppShell";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import {
  Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import {
  AlertTriangle, Plus, RefreshCw, CheckCircle, Clock, XCircle,
  Search, AlertOctagon, Eye, Pencil, Trash2, Loader2, ShieldAlert,
  Package, FileWarning, Banknote, Truck, MessageSquare, FileMinus,
  TrendingDown, RotateCcw,
} from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { useCompany } from "@/contexts/CompanyContext";
import { format } from "date-fns";
import { id as idLocale } from "date-fns/locale";

// ── Types ──────────────────────────────────────────────────────────────────────

type ExType =
  | "order_rejected" | "vendor_reject_rfq" | "vendor_out_of_stock"
  | "price_changed" | "delivery_delayed" | "failed_delivery"
  | "customer_complaint" | "document_missing" | "payment_overdue";

type ExStatus = "open" | "in_progress" | "resolved" | "closed";
type ExSeverity = "low" | "medium" | "high" | "critical";

interface ExceptionRow {
  id: number;
  companyId: number | null;
  exceptionType: ExType;
  severity: ExSeverity;
  status: ExStatus;
  title: string;
  description: string | null;
  refType: string | null;
  refId: string | null;
  refNumber: string | null;
  customerName: string | null;
  supplierName: string | null;
  assignedTo: string | null;
  resolvedBy: string | null;
  resolvedAt: string | null;
  resolutionNotes: string | null;
  createdBy: string | null;
  createdAt: string;
  updatedAt: string;
}

interface Stats {
  total: number;
  open: number;
  in_progress: number;
  resolved: number;
  closed: number;
  critical: number;
  high: number;
}

// ── Constants ─────────────────────────────────────────────────────────────────

const EXCEPTION_TYPE_LABELS: Record<ExType, string> = {
  order_rejected: "Order Ditolak",
  vendor_reject_rfq: "Vendor Tolak RFQ",
  vendor_out_of_stock: "Vendor Stok Habis",
  price_changed: "Harga Berubah",
  delivery_delayed: "Pengiriman Terlambat",
  failed_delivery: "Gagal Kirim",
  customer_complaint: "Komplain Customer",
  document_missing: "Dokumen Tidak Lengkap",
  payment_overdue: "Pembayaran Jatuh Tempo",
};

const EXCEPTION_TYPE_ICONS: Record<ExType, React.ComponentType<{ className?: string }>> = {
  order_rejected: XCircle,
  vendor_reject_rfq: RotateCcw,
  vendor_out_of_stock: Package,
  price_changed: TrendingDown,
  delivery_delayed: Clock,
  failed_delivery: Truck,
  customer_complaint: MessageSquare,
  document_missing: FileMinus,
  payment_overdue: Banknote,
};

const STATUS_LABELS: Record<ExStatus, string> = {
  open: "Terbuka",
  in_progress: "Diproses",
  resolved: "Diselesaikan",
  closed: "Ditutup",
};

const STATUS_COLORS: Record<ExStatus, string> = {
  open: "bg-blue-100 text-blue-700 border-blue-200",
  in_progress: "bg-amber-100 text-amber-700 border-amber-200",
  resolved: "bg-emerald-100 text-emerald-700 border-emerald-200",
  closed: "bg-slate-100 text-slate-600 border-slate-200",
};

const SEVERITY_LABELS: Record<ExSeverity, string> = {
  low: "Rendah",
  medium: "Sedang",
  high: "Tinggi",
  critical: "Kritis",
};

const SEVERITY_COLORS: Record<ExSeverity, string> = {
  low: "bg-gray-100 text-gray-600 border-gray-200",
  medium: "bg-blue-100 text-blue-700 border-blue-200",
  high: "bg-orange-100 text-orange-700 border-orange-200",
  critical: "bg-red-100 text-red-700 border-red-200",
};

// ── API helpers ───────────────────────────────────────────────────────────────

const apiFetch = async (url: string, opts?: RequestInit) => {
  const r = await fetch(url, opts);
  if (!r.ok) {
    const msg = await r.json().then((d: { error?: string }) => d.error).catch(() => "Error");
    throw new Error(msg);
  }
  return r.json();
};

// ── Sub-components ────────────────────────────────────────────────────────────

function TypeIcon({ type, className = "h-4 w-4" }: { type: ExType; className?: string }) {
  const Icon = EXCEPTION_TYPE_ICONS[type] ?? AlertTriangle;
  return <Icon className={className} />;
}

function StatusBadge({ status }: { status: ExStatus }) {
  return (
    <Badge variant="outline" className={`text-xs font-medium ${STATUS_COLORS[status]}`}>
      {STATUS_LABELS[status]}
    </Badge>
  );
}

function SeverityBadge({ severity }: { severity: ExSeverity }) {
  return (
    <Badge variant="outline" className={`text-xs font-medium ${SEVERITY_COLORS[severity]}`}>
      {SEVERITY_LABELS[severity]}
    </Badge>
  );
}

// ── Create/Edit Form ──────────────────────────────────────────────────────────

interface FormData {
  exceptionType: ExType | "";
  severity: ExSeverity;
  title: string;
  description: string;
  refNumber: string;
  customerName: string;
  supplierName: string;
  assignedTo: string;
  refType: string;
}

const EMPTY_FORM: FormData = {
  exceptionType: "",
  severity: "medium",
  title: "",
  description: "",
  refNumber: "",
  customerName: "",
  supplierName: "",
  assignedTo: "",
  refType: "",
};

interface CreateEditDialogProps {
  open: boolean;
  onClose: () => void;
  initial?: ExceptionRow | null;
  onSaved: () => void;
}

function CreateEditDialog({ open, onClose, initial, onSaved }: CreateEditDialogProps) {
  const { toast } = useToast();
  const [form, setForm] = useState<FormData>(() =>
    initial ? {
      exceptionType: initial.exceptionType,
      severity: initial.severity,
      title: initial.title,
      description: initial.description ?? "",
      refNumber: initial.refNumber ?? "",
      customerName: initial.customerName ?? "",
      supplierName: initial.supplierName ?? "",
      assignedTo: initial.assignedTo ?? "",
      refType: initial.refType ?? "",
    } : { ...EMPTY_FORM }
  );
  const [saving, setSaving] = useState(false);

  const set = (k: keyof FormData) => (v: string) => setForm((p) => ({ ...p, [k]: v }));

  const handleSave = async () => {
    if (!form.exceptionType || !form.title.trim()) {
      toast({ variant: "destructive", title: "Lengkapi tipe dan judul exception" }); return;
    }
    setSaving(true);
    try {
      if (initial) {
        await apiFetch(`/api/exceptions/${initial.id}`, {
          method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify(form),
        });
        toast({ title: "Exception diperbarui" });
      } else {
        await apiFetch("/api/exceptions", {
          method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(form),
        });
        toast({ title: "Exception dibuat" });
      }
      onSaved();
      onClose();
    } catch (e: unknown) {
      toast({ variant: "destructive", title: (e as Error).message ?? "Gagal menyimpan" });
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>{initial ? "Edit Exception" : "Buat Exception Baru"}</DialogTitle>
        </DialogHeader>
        <div className="space-y-4 py-2">
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1">
              <Label>Tipe *</Label>
              <Select value={form.exceptionType} onValueChange={set("exceptionType")}>
                <SelectTrigger><SelectValue placeholder="Pilih tipe…" /></SelectTrigger>
                <SelectContent>
                  {(Object.entries(EXCEPTION_TYPE_LABELS) as [ExType, string][]).map(([k, v]) => (
                    <SelectItem key={k} value={k}>{v}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1">
              <Label>Prioritas</Label>
              <Select value={form.severity} onValueChange={set("severity")}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  {(Object.entries(SEVERITY_LABELS) as [ExSeverity, string][]).map(([k, v]) => (
                    <SelectItem key={k} value={k}>{v}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>

          <div className="space-y-1">
            <Label>Judul *</Label>
            <Input value={form.title} onChange={(e) => set("title")(e.target.value)} placeholder="Deskripsi singkat exception…" />
          </div>

          <div className="space-y-1">
            <Label>Detail</Label>
            <Textarea value={form.description} onChange={(e) => set("description")(e.target.value)} rows={3} placeholder="Penjelasan lengkap…" />
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1">
              <Label>No. Dokumen Ref.</Label>
              <Input value={form.refNumber} onChange={(e) => set("refNumber")(e.target.value)} placeholder="SO-2026/001" />
            </div>
            <div className="space-y-1">
              <Label>Jenis Ref.</Label>
              <Input value={form.refType} onChange={(e) => set("refType")(e.target.value)} placeholder="sales_order, rfq, dll." />
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1">
              <Label>Customer</Label>
              <Input value={form.customerName} onChange={(e) => set("customerName")(e.target.value)} placeholder="Nama customer…" />
            </div>
            <div className="space-y-1">
              <Label>Supplier / Vendor</Label>
              <Input value={form.supplierName} onChange={(e) => set("supplierName")(e.target.value)} placeholder="Nama supplier…" />
            </div>
          </div>

          <div className="space-y-1">
            <Label>Ditugaskan Ke</Label>
            <Input value={form.assignedTo} onChange={(e) => set("assignedTo")(e.target.value)} placeholder="Nama / email penanggung jawab…" />
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={saving}>Batal</Button>
          <Button onClick={handleSave} disabled={saving}>
            {saving && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
            {initial ? "Simpan Perubahan" : "Buat Exception"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ── Detail Dialog ─────────────────────────────────────────────────────────────

interface DetailDialogProps {
  exc: ExceptionRow;
  onClose: () => void;
  onUpdated: () => void;
}

const STATUS_FLOW: Record<ExStatus, ExStatus[]> = {
  open: ["in_progress", "closed"],
  in_progress: ["resolved", "open"],
  resolved: ["closed", "in_progress"],
  closed: ["open"],
};

function DetailDialog({ exc, onClose, onUpdated }: DetailDialogProps) {
  const { toast } = useToast();
  const [resolution, setResolution] = useState(exc.resolutionNotes ?? "");
  const [assignedTo, setAssignedTo] = useState(exc.assignedTo ?? "");
  const [saving, setSaving] = useState(false);
  const [editing, setEditing] = useState(false);

  const handleStatusChange = async (newStatus: ExStatus) => {
    setSaving(true);
    try {
      await apiFetch(`/api/exceptions/${exc.id}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          status: newStatus,
          resolutionNotes: resolution || undefined,
          assignedTo: assignedTo || undefined,
        }),
      });
      toast({ title: `Status diubah ke "${STATUS_LABELS[newStatus]}"` });
      onUpdated();
    } catch (e: unknown) {
      toast({ variant: "destructive", title: (e as Error).message ?? "Gagal" });
    } finally {
      setSaving(false);
    }
  };

  const handleSaveNotes = async () => {
    setSaving(true);
    try {
      await apiFetch(`/api/exceptions/${exc.id}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ resolutionNotes: resolution, assignedTo }),
      });
      toast({ title: "Disimpan" });
      onUpdated();
    } catch (e: unknown) {
      toast({ variant: "destructive", title: (e as Error).message ?? "Gagal" });
    } finally {
      setSaving(false);
    }
  };

  const nextStatuses = STATUS_FLOW[exc.status] ?? [];
  const TypeIconComponent = EXCEPTION_TYPE_ICONS[exc.exceptionType] ?? AlertTriangle;

  return (
    <>
      {editing && (
        <CreateEditDialog
          open
          onClose={() => setEditing(false)}
          initial={exc}
          onSaved={() => { setEditing(false); onUpdated(); }}
        />
      )}

      <Dialog open={!editing} onOpenChange={(o) => !o && onClose()}>
        <DialogContent className="max-w-2xl">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <TypeIconComponent className="h-5 w-5 text-slate-500" />
              <span className="flex-1">{exc.title}</span>
            </DialogTitle>
          </DialogHeader>

          <div className="space-y-4 py-1">
            {/* Badges row */}
            <div className="flex flex-wrap gap-2 items-center">
              <Badge variant="outline" className="gap-1">
                <TypeIconComponent className="h-3 w-3" />
                {EXCEPTION_TYPE_LABELS[exc.exceptionType]}
              </Badge>
              <SeverityBadge severity={exc.severity} />
              <StatusBadge status={exc.status} />
              {exc.assignedTo && (
                <Badge variant="secondary" className="text-xs">{exc.assignedTo}</Badge>
              )}
            </div>

            {/* Description */}
            {exc.description && (
              <p className="text-sm text-slate-600 dark:text-slate-300 leading-relaxed whitespace-pre-wrap">
                {exc.description}
              </p>
            )}

            {/* Reference + Party grid */}
            <div className="grid grid-cols-2 gap-x-6 gap-y-2 text-sm">
              {exc.refNumber && (
                <div>
                  <span className="text-slate-500 text-xs">No. Dokumen</span>
                  <p className="font-medium">{exc.refNumber}</p>
                </div>
              )}
              {exc.refType && (
                <div>
                  <span className="text-slate-500 text-xs">Jenis Ref.</span>
                  <p className="font-medium">{exc.refType}</p>
                </div>
              )}
              {exc.customerName && (
                <div>
                  <span className="text-slate-500 text-xs">Customer</span>
                  <p className="font-medium">{exc.customerName}</p>
                </div>
              )}
              {exc.supplierName && (
                <div>
                  <span className="text-slate-500 text-xs">Supplier</span>
                  <p className="font-medium">{exc.supplierName}</p>
                </div>
              )}
              <div>
                <span className="text-slate-500 text-xs">Dibuat oleh</span>
                <p className="font-medium">{exc.createdBy ?? "—"}</p>
              </div>
              <div>
                <span className="text-slate-500 text-xs">Tanggal</span>
                <p className="font-medium">
                  {format(new Date(exc.createdAt), "dd MMM yyyy HH:mm", { locale: idLocale })}
                </p>
              </div>
              {exc.resolvedBy && (
                <div>
                  <span className="text-slate-500 text-xs">Diselesaikan oleh</span>
                  <p className="font-medium">{exc.resolvedBy}</p>
                </div>
              )}
              {exc.resolvedAt && (
                <div>
                  <span className="text-slate-500 text-xs">Tanggal Selesai</span>
                  <p className="font-medium">
                    {format(new Date(exc.resolvedAt), "dd MMM yyyy HH:mm", { locale: idLocale })}
                  </p>
                </div>
              )}
            </div>

            {/* Assign + Resolution notes */}
            <div className="space-y-3 border-t pt-4">
              <div className="space-y-1">
                <Label className="text-sm">Ditugaskan Ke</Label>
                <Input
                  value={assignedTo}
                  onChange={(e) => setAssignedTo(e.target.value)}
                  placeholder="Nama / email penanggung jawab…"
                  className="h-8 text-sm"
                />
              </div>
              <div className="space-y-1">
                <Label className="text-sm">Catatan Resolusi</Label>
                <Textarea
                  value={resolution}
                  onChange={(e) => setResolution(e.target.value)}
                  rows={3}
                  placeholder="Tindakan yang sudah diambil, penyebab, solusi…"
                  className="text-sm"
                />
              </div>
              <Button size="sm" variant="outline" onClick={handleSaveNotes} disabled={saving}>
                {saving ? <Loader2 className="h-3.5 w-3.5 animate-spin mr-1" /> : null}
                Simpan Catatan
              </Button>
            </div>

            {/* Status workflow actions */}
            {nextStatuses.length > 0 && (
              <div className="flex flex-wrap gap-2 border-t pt-4">
                <span className="text-sm text-slate-500 self-center mr-1">Ubah status:</span>
                {nextStatuses.map((ns) => (
                  <Button
                    key={ns}
                    size="sm"
                    variant={ns === "resolved" || ns === "closed" ? "default" : "outline"}
                    className={
                      ns === "resolved" ? "bg-emerald-600 hover:bg-emerald-700 text-white" :
                      ns === "closed" ? "bg-slate-700 hover:bg-slate-800 text-white" :
                      ns === "in_progress" ? "text-amber-600 border-amber-200 hover:bg-amber-50" :
                      "text-blue-600 border-blue-200 hover:bg-blue-50"
                    }
                    onClick={() => handleStatusChange(ns)}
                    disabled={saving}
                  >
                    {saving ? <Loader2 className="h-3.5 w-3.5 animate-spin mr-1" /> : null}
                    {STATUS_LABELS[ns]}
                  </Button>
                ))}
              </div>
            )}
          </div>

          <DialogFooter className="justify-between">
            <Button size="sm" variant="ghost" className="gap-1.5" onClick={() => setEditing(true)}>
              <Pencil className="h-3.5 w-3.5" /> Edit
            </Button>
            <Button variant="outline" onClick={onClose}>Tutup</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}

// ── Main Page ──────────────────────────────────────────────────────────────────

export default function ExceptionsPage() {
  const { toast } = useToast();
  const { activeCompanyId: selectedCompanyId } = useCompany();
  const qc = useQueryClient();

  const [filterStatus, setFilterStatus] = useState<string>("all");
  const [filterType, setFilterType] = useState<string>("all");
  const [filterSeverity, setFilterSeverity] = useState<string>("all");
  const [search, setSearch] = useState("");
  const [debouncedSearch, setDebouncedSearch] = useState("");
  const [createOpen, setCreateOpen] = useState(false);
  const [selected, setSelected] = useState<ExceptionRow | null>(null);
  const [deletingId, setDeletingId] = useState<number | null>(null);

  // debounce search
  const handleSearchChange = (v: string) => {
    setSearch(v);
    clearTimeout((handleSearchChange as { _t?: ReturnType<typeof setTimeout> })._t);
    (handleSearchChange as { _t?: ReturnType<typeof setTimeout> })._t = setTimeout(() => setDebouncedSearch(v), 350);
  };

  const params = useMemo(() => {
    const p = new URLSearchParams();
    if (filterStatus !== "all") p.set("status", filterStatus);
    if (filterType !== "all") p.set("exceptionType", filterType);
    if (filterSeverity !== "all") p.set("severity", filterSeverity);
    if (debouncedSearch.trim()) p.set("search", debouncedSearch.trim());
    if (selectedCompanyId) p.set("companyId", String(selectedCompanyId));
    return p.toString();
  }, [filterStatus, filterType, filterSeverity, debouncedSearch, selectedCompanyId]);

  const { data, isLoading, refetch } = useQuery<{ data: ExceptionRow[] }>({
    queryKey: ["exceptions", params],
    queryFn: () => apiFetch(`/api/exceptions?${params}`),
  });

  const { data: stats } = useQuery<Stats>({
    queryKey: ["exceptions-stats", selectedCompanyId],
    queryFn: () => apiFetch(`/api/exceptions/stats${selectedCompanyId ? `?companyId=${selectedCompanyId}` : ""}`),
    staleTime: 30_000,
  });

  const deleteMut = useMutation({
    mutationFn: (id: number) => apiFetch(`/api/exceptions/${id}`, { method: "DELETE" }),
    onSuccess: () => {
      toast({ title: "Exception dihapus" });
      qc.invalidateQueries({ queryKey: ["exceptions"] });
      qc.invalidateQueries({ queryKey: ["exceptions-stats"] });
    },
    onError: (e: Error) => toast({ variant: "destructive", title: e.message }),
  });

  const handleRefresh = () => {
    qc.invalidateQueries({ queryKey: ["exceptions"] });
    qc.invalidateQueries({ queryKey: ["exceptions-stats"] });
  };

  const handleDelete = async (exc: ExceptionRow) => {
    if (!confirm(`Hapus exception "${exc.title}"?`)) return;
    setDeletingId(exc.id);
    deleteMut.mutate(exc.id, { onSettled: () => setDeletingId(null) });
  };

  const rows = data?.data ?? [];

  return (
    <AppShell>
      <div className="flex flex-col gap-6 p-6">
        {/* ── Header ─────────────────────────────────────────────────── */}
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-bold flex items-center gap-2">
              <AlertTriangle className="h-6 w-6 text-amber-500" />
              Exception Management
            </h1>
            <p className="text-sm text-muted-foreground mt-0.5">
              Kelola & tindak lanjuti semua exception operasional
            </p>
          </div>
          <div className="flex gap-2">
            <Button variant="outline" size="sm" onClick={handleRefresh}>
              <RefreshCw className="h-4 w-4" />
            </Button>
            <Button size="sm" className="gap-2" onClick={() => setCreateOpen(true)}>
              <Plus className="h-4 w-4" /> Buat Exception
            </Button>
          </div>
        </div>

        {/* ── Stat Cards ─────────────────────────────────────────────── */}
        <div className="grid grid-cols-2 sm:grid-cols-3 xl:grid-cols-6 gap-3">
          {[
            { label: "Total", value: stats?.total ?? 0, color: "text-slate-700 dark:text-slate-200", bg: "" },
            { label: "Terbuka", value: stats?.open ?? 0, color: "text-blue-700", bg: "bg-blue-50 dark:bg-blue-950/30" },
            { label: "Diproses", value: stats?.in_progress ?? 0, color: "text-amber-700", bg: "bg-amber-50 dark:bg-amber-950/30" },
            { label: "Selesai", value: stats?.resolved ?? 0, color: "text-emerald-700", bg: "bg-emerald-50 dark:bg-emerald-950/30" },
            { label: "Kritis", value: stats?.critical ?? 0, color: "text-red-700", bg: "bg-red-50 dark:bg-red-950/30" },
            { label: "Tinggi", value: stats?.high ?? 0, color: "text-orange-700", bg: "bg-orange-50 dark:bg-orange-950/30" },
          ].map(({ label, value, color, bg }) => (
            <Card key={label} className={`border ${bg}`}>
              <CardContent className="pt-4 pb-3 px-4">
                <p className="text-xs text-muted-foreground">{label}</p>
                <p className={`text-3xl font-bold mt-0.5 ${color}`}>{value}</p>
              </CardContent>
            </Card>
          ))}
        </div>

        {/* ── Filters ────────────────────────────────────────────────── */}
        <Card>
          <CardContent className="pt-4 pb-4">
            <div className="flex flex-wrap gap-3 items-center">
              <div className="relative flex-1 min-w-[200px]">
                <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
                <Input
                  className="pl-9 h-9"
                  placeholder="Cari judul, customer, supplier, no. dok…"
                  value={search}
                  onChange={(e) => handleSearchChange(e.target.value)}
                />
              </div>

              <Select value={filterType} onValueChange={setFilterType}>
                <SelectTrigger className="h-9 w-52">
                  <SelectValue placeholder="Semua Tipe" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">Semua Tipe</SelectItem>
                  {(Object.entries(EXCEPTION_TYPE_LABELS) as [ExType, string][]).map(([k, v]) => (
                    <SelectItem key={k} value={k}>{v}</SelectItem>
                  ))}
                </SelectContent>
              </Select>

              <Select value={filterSeverity} onValueChange={setFilterSeverity}>
                <SelectTrigger className="h-9 w-36">
                  <SelectValue placeholder="Semua Prioritas" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">Semua Prioritas</SelectItem>
                  {(Object.entries(SEVERITY_LABELS) as [ExSeverity, string][]).map(([k, v]) => (
                    <SelectItem key={k} value={k}>{v}</SelectItem>
                  ))}
                </SelectContent>
              </Select>

              <Select value={filterStatus} onValueChange={setFilterStatus}>
                <SelectTrigger className="h-9 w-36">
                  <SelectValue placeholder="Semua Status" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">Semua Status</SelectItem>
                  {(Object.entries(STATUS_LABELS) as [ExStatus, string][]).map(([k, v]) => (
                    <SelectItem key={k} value={k}>{v}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </CardContent>
        </Card>

        {/* ── Table ──────────────────────────────────────────────────── */}
        <Card>
          <CardHeader className="pb-2 flex-row items-center justify-between">
            <CardTitle className="text-base">
              {isLoading ? "Memuat…" : `${rows.length} Exception`}
            </CardTitle>
          </CardHeader>
          <CardContent className="p-0">
            {isLoading ? (
              <div className="flex items-center justify-center py-16 text-muted-foreground">
                <Loader2 className="h-6 w-6 animate-spin mr-2" /> Memuat data…
              </div>
            ) : rows.length === 0 ? (
              <div className="flex flex-col items-center justify-center py-16 gap-3 text-muted-foreground">
                <ShieldAlert className="h-10 w-10 opacity-30" />
                <p className="text-sm">Tidak ada exception yang ditemukan</p>
                <Button size="sm" variant="outline" onClick={() => setCreateOpen(true)}>
                  <Plus className="h-4 w-4 mr-1" /> Buat Exception
                </Button>
              </div>
            ) : (
              <Table>
                <TableHeader>
                  <TableRow className="text-xs">
                    <TableHead className="w-8">#</TableHead>
                    <TableHead>Tipe</TableHead>
                    <TableHead>Judul</TableHead>
                    <TableHead>Prioritas</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead>Ref. Dokumen</TableHead>
                    <TableHead>Customer / Supplier</TableHead>
                    <TableHead>Ditugaskan</TableHead>
                    <TableHead>Tanggal</TableHead>
                    <TableHead className="w-20" />
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {rows.map((exc) => (
                    <TableRow
                      key={exc.id}
                      className="cursor-pointer hover:bg-muted/50"
                      onClick={() => setSelected(exc)}
                    >
                      <TableCell className="text-xs text-muted-foreground">{exc.id}</TableCell>
                      <TableCell>
                        <div className="flex items-center gap-1.5 text-xs">
                          <TypeIcon type={exc.exceptionType} className="h-3.5 w-3.5 text-slate-500 shrink-0" />
                          <span className="text-slate-600 dark:text-slate-300">
                            {EXCEPTION_TYPE_LABELS[exc.exceptionType]}
                          </span>
                        </div>
                      </TableCell>
                      <TableCell className="max-w-[220px]">
                        <p className="text-sm font-medium truncate">{exc.title}</p>
                        {exc.description && (
                          <p className="text-xs text-muted-foreground truncate">{exc.description}</p>
                        )}
                      </TableCell>
                      <TableCell><SeverityBadge severity={exc.severity} /></TableCell>
                      <TableCell><StatusBadge status={exc.status} /></TableCell>
                      <TableCell className="text-xs text-slate-500">{exc.refNumber ?? "—"}</TableCell>
                      <TableCell className="text-xs">
                        {exc.customerName && <span className="text-blue-600">{exc.customerName}</span>}
                        {exc.customerName && exc.supplierName && <span className="text-muted-foreground"> / </span>}
                        {exc.supplierName && <span className="text-orange-600">{exc.supplierName}</span>}
                        {!exc.customerName && !exc.supplierName && <span className="text-muted-foreground">—</span>}
                      </TableCell>
                      <TableCell className="text-xs text-slate-500">{exc.assignedTo ?? "—"}</TableCell>
                      <TableCell className="text-xs text-slate-500 whitespace-nowrap">
                        {format(new Date(exc.createdAt), "dd MMM yyyy", { locale: idLocale })}
                      </TableCell>
                      <TableCell onClick={(e) => e.stopPropagation()}>
                        <div className="flex gap-1">
                          <Button size="icon" variant="ghost" className="h-7 w-7"
                            onClick={(e) => { e.stopPropagation(); setSelected(exc); }}>
                            <Eye className="h-3.5 w-3.5" />
                          </Button>
                          <Button size="icon" variant="ghost" className="h-7 w-7 text-destructive hover:text-destructive"
                            onClick={(e) => { e.stopPropagation(); handleDelete(exc); }}
                            disabled={deletingId === exc.id}
                          >
                            {deletingId === exc.id
                              ? <Loader2 className="h-3.5 w-3.5 animate-spin" />
                              : <Trash2 className="h-3.5 w-3.5" />}
                          </Button>
                        </div>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            )}
          </CardContent>
        </Card>
      </div>

      {/* ── Dialogs ─────────────────────────────────────────────────── */}
      {createOpen && (
        <CreateEditDialog
          open
          onClose={() => setCreateOpen(false)}
          onSaved={() => {
            qc.invalidateQueries({ queryKey: ["exceptions"] });
            qc.invalidateQueries({ queryKey: ["exceptions-stats"] });
          }}
        />
      )}

      {selected && (
        <DetailDialog
          exc={selected}
          onClose={() => setSelected(null)}
          onUpdated={() => {
            qc.invalidateQueries({ queryKey: ["exceptions"] });
            qc.invalidateQueries({ queryKey: ["exceptions-stats"] });
            setSelected(null);
          }}
        />
      )}
    </AppShell>
  );
}
