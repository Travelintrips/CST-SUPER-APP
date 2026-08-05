import { useState, useEffect, useMemo } from "react";
import { useRoute, useLocation } from "wouter";
import { QueryState } from "@/components/ui/query-state";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { useToast } from "@/hooks/use-toast";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { ArrowLeft, AlertTriangle, CheckCircle2, Loader2, BookOpen, SkipForward, BarChart3, Building2, Zap, XCircle, Ban, RotateCcw, Link2, ShieldAlert, Layers, RefreshCw, Trash2 } from "lucide-react";

interface Company { id: number; name: string; }

const VALID_CLASSES = [
  "INCOME",
  "EXPENSE",
  "INTERNAL_TRANSFER",
  "EMPLOYEE_ADVANCE",
  "INTERCOMPANY_LOAN",
  "TAX_PAYMENT",
  "REIMBURSEMENT",
];

const CLASS_LABELS: Record<string, string> = {
  INCOME:               "Income",
  EXPENSE:              "Expense",
  ASSET:                "Asset",
  LIABILITY:            "Liability",
  LIABILITY_SETTLEMENT: "Liability Settlement",
  EQUITY:               "Equity",
  TRANSFER:             "Transfer",
  TAX:                  "Tax",
  NEED_REVIEW:          "Need Review",
  // backward compat
  REVENUE:              "Revenue (lama)",
  INTERNAL_TRANSFER:    "Internal Transfer (lama)",
  EMPLOYEE_ADVANCE:     "Employee Advance (lama)",
  INTERCOMPANY_LOAN:    "Intercompany Loan (lama)",
  TAX_PAYMENT:          "Tax Payment (lama)",
  REIMBURSEMENT:        "Reimbursement (lama)",
  LOAN_RECEIVABLE:      "Loan Receivable (lama)",
};

const POSTABLE_CLASSES = new Set([
  "INCOME", "EXPENSE", "ASSET", "LIABILITY", "LIABILITY_SETTLEMENT",
  "EQUITY", "TRANSFER", "TAX",
  "REVENUE", "INTERNAL_TRANSFER", "EMPLOYEE_ADVANCE",
  "INTERCOMPANY_LOAN", "TAX_PAYMENT", "REIMBURSEMENT", "LOAN_RECEIVABLE",
]);

type ImportRow = {
  id: number;
  transaction_date: string | null;
  description: string | null;
  debit: string | null;
  credit: string | null;
  balance: string | null;
  erp_category: string | null;
  accounting_class: string | null;
  status: string;
  journal_entry_id: number | null;
  journal_entry_number: string | null;
  unique_key: string | null;
  used_fallback_coa: boolean | null;
  reconciliation_status: string | null;
  linked_transaction_type: string | null;
  linked_transaction_id: number | null;
  rejection_reason: string | null;
  rejected_by: string | null;
  // FASE 1/2/4/6
  coa_status: string | null;
  subledger_status: string | null;
  company_id: number | null;
  revenue_company_id: number | null;
  collecting_company_id: number | null;
  transaction_pair_id: string | null;
};

type SkippedRow = {
  id: number;
  row_index: number;
  date: string | null;
  description: string | null;
  debit: string | null;
  credit: string | null;
  unique_key: string | null;
  skip_reason: string | null;
};

type NormalizedEntry = {
  id: number;
  batch_id: number;
  row_id: number | null;
  transaction_date: string | null;
  description: string | null;
  amount: string | null;
  direction: string;
  erp_category: string | null;
  accounting_class: string | null;
  cost_center_id: string | null;
  coa_debit: string | null;
  coa_credit: string | null;
  status: string;
  used_fallback_coa: boolean | null;
  coa_drift: boolean | null;
  version: number | null;
  journal_entry_id: number | null;
  journal_entry_number: string | null;
};

type NormalizedSummary = {
  total: string; ready: string; need_review: string;
  posted: string; matched: string; duplicate: string;
  fallback_coa_count: string; coa_drift_count: string;
  superseded_count: string; version_max: string;
};

type Batch = {
  id: number;
  filename: string;
  status: string;
  row_count: number;
  company_id: number | null;
  import_mode: string | null;
  created_at: string;
};

type RowStatus = "IMPORTED" | "MATCHED" | "READY" | "NEED_REVIEW" | "REJECTED" | "DUPLICATE" | "SKIPPED_ALREADY_POSTED" | "NEED_COA_MAPPING" | "NO_CLASS" | "UNKNOWN";

function getRowStatus(row: ImportRow): RowStatus {
  if (row.status === "REJECTED")               return "REJECTED";
  if (row.status === "DUPLICATE")              return "DUPLICATE";
  if (row.status === "SKIPPED_ALREADY_POSTED") return "SKIPPED_ALREADY_POSTED";
  if (row.status === "NEED_COA_MAPPING" || row.coa_status === "MISSING") return "NEED_COA_MAPPING";
  if (row.status === "MATCHED" || (row.reconciliation_status === "MATCHED" && !row.journal_entry_id))
    return "MATCHED";
  if (row.journal_entry_id || row.status === "IMPORTED") return "IMPORTED";
  if (row.status === "NEED_REVIEW") return "NEED_REVIEW";
  // Tidak ada accounting_class → akan di-skip saat posting (bukan blocker)
  if (!row.accounting_class) return "NO_CLASS";
  if (!VALID_CLASSES.includes(row.accounting_class)) return "UNKNOWN";
  return "READY";
}


function StatusBadge({ status }: { status: RowStatus | string }) {
  switch (status) {
    case "IMPORTED":
      return <Badge className="bg-green-100 text-green-700 border-green-200 gap-1"><CheckCircle2 className="w-3 h-3" />Imported</Badge>;
    case "MATCHED":
      return <Badge className="bg-emerald-100 text-emerald-700 border-emerald-200 gap-1"><Link2 className="w-3 h-3" />Matched</Badge>;
    case "READY":
      return <Badge className="bg-blue-100 text-blue-700 border-blue-200">Ready</Badge>;
    case "NEED_REVIEW":
      return <Badge className="bg-orange-100 text-orange-700 border-orange-200 gap-1"><AlertTriangle className="w-3 h-3" />Need Review</Badge>;
    case "NEED_COA_MAPPING":
      return <Badge className="bg-purple-100 text-purple-700 border-purple-300 gap-1"><AlertTriangle className="w-3 h-3" />No COA</Badge>;
    case "REJECTED":
      return <Badge className="bg-red-100 text-red-700 border-red-200 gap-1"><XCircle className="w-3 h-3" />Rejected</Badge>;
    case "DUPLICATE":
      return <Badge className="bg-amber-100 text-amber-700 border-amber-200 gap-1"><Ban className="w-3 h-3" />Duplicate</Badge>;
    case "SKIPPED_ALREADY_POSTED":
      return <Badge className="bg-gray-100 text-gray-500 border-gray-200 gap-1"><SkipForward className="w-3 h-3" />Skip Posted</Badge>;
    default:
      return <Badge className="bg-orange-100 text-orange-700 border-orange-200">Need Review</Badge>;
  }
}

function fmt(val: string | null) {
  if (!val) return "–";
  const n = Number(val);
  if (isNaN(n)) return val;
  return n.toLocaleString("id-ID", { minimumFractionDigits: 0, maximumFractionDigits: 2 });
}

function fmtDate(val: string | null) {
  if (!val) return "–";
  const d = new Date(val);
  if (isNaN(d.getTime())) return val;
  return d.toLocaleDateString("id-ID", { day: "2-digit", month: "short", year: "numeric" });
}

export default function BankMutationImportDetailPage() {
  const [, params] = useRoute("/accounting/bank-mutation-import/:id");
  const [, navigate] = useLocation();
  const { toast } = useToast();
  const batchId = params?.id ? parseInt(params.id, 10) : null;

  const [batch, setBatch] = useState<Batch | null>(null);
  const [rows, setRows] = useState<ImportRow[]>([]);
  const [skippedRows, setSkippedRows] = useState<SkippedRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [posting, setPosting] = useState(false);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [deleteConfirmOpen, setDeleteConfirmOpen] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [editingRow, setEditingRow] = useState<number | null>(null);
  const [showClassBreakdown, setShowClassBreakdown] = useState(false);
  const [classFilter, setClassFilter] = useState<string>("ALL");
  const [companies, setCompanies] = useState<Company[]>([]);
  const [savingCompany, setSavingCompany] = useState(false);
  const [savingMode, setSavingMode] = useState(false);
  const [pollIntervalRef, setPollIntervalRef] = useState<ReturnType<typeof setInterval> | null>(null);
  const [jobProgress, setJobProgress] = useState<{ posted: number; total: number; failed: number } | null>(null);
  const [actioningRow, setActioningRow] = useState<number | null>(null);
  const [batchActioning, setBatchActioning] = useState(false);
  const [rejectOpen, setRejectOpen] = useState<{ rowId: number } | null>(null);
  const [rejectReason, setRejectReason] = useState("");
  const [batchRejectOpen, setBatchRejectOpen] = useState(false);
  const [batchRejectReason, setBatchRejectReason] = useState("");
  const [bulkClass, setBulkClass] = useState("EXPENSE");
  const [bulkClassifying, setBulkClassifying] = useState(false);
  const [unpostConfirmOpen, setUnpostConfirmOpen] = useState(false);
  const [unposting, setUnposting] = useState(false);
  const [deleteRowConfirm, setDeleteRowConfirm] = useState<{ rowId: number; journalId: number | null } | null>(null);
  const [deletingRow, setDeletingRow] = useState(false);
  const [reprocessing, setReprocessing] = useState(false);

  // ── Normalized Entries tab ────────────────────────────────────────────────
  const [activeTab, setActiveTab] = useState<"raw" | "normalized">("raw");
  const [normalizedEntries, setNormalizedEntries] = useState<NormalizedEntry[]>([]);
  const [normalizedSummary, setNormalizedSummary] = useState<NormalizedSummary | null>(null);
  const [normalizedLoading, setNormalizedLoading] = useState(false);
  const [normalizedFilter, setNormalizedFilter] = useState<string>("ALL");
  const [retriggeringNorm, setRetriggeringNorm] = useState(false);
  const [editingNormId, setEditingNormId] = useState<number | null>(null);

  async function loadData() {
    if (!batchId) return;
    setLoading(true);
    try {
      const res = await fetch(`/api/bank-mutation-import/${batchId}/preview`);
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Gagal memuat data");
      setBatch(data.batch);
      setRows(data.rows ?? []);
      setSkippedRows(data.skipped_rows ?? []);
    } catch (e: any) {
      toast({ title: "Error", description: e.message, variant: "destructive" });
    } finally {
      setLoading(false);
    }
  }

  async function loadNormalized() {
    if (!batchId) return;
    setNormalizedLoading(true);
    try {
      const res = await fetch(`/api/bank-mutation-import/${batchId}/normalized`);
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Gagal memuat normalized entries");
      setNormalizedEntries(data.rows ?? []);
      setNormalizedSummary(data.summary ?? null);
    } catch (e: any) {
      toast({ title: "Error", description: e.message, variant: "destructive" });
    } finally {
      setNormalizedLoading(false);
    }
  }

  async function retriggerNormalization() {
    if (!batchId) return;
    setRetriggeringNorm(true);
    try {
      const res = await fetch(`/api/bank-mutation-import/${batchId}/normalize`, { method: "POST" });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Gagal normalisasi");
      const s = data.summary ?? {};
      const parts = [
        `Total: ${s.total ?? 0}`,
        s.ready   ? `${s.ready} ready`         : null,
        s.need_review ? `${s.need_review} need review` : null,
        s.coa_drift_count > 0 ? `⚠ ${s.coa_drift_count} COA drift` : null,
      ].filter(Boolean).join(" · ");
      toast({
        title: `Normalisasi selesai — v${data.version ?? 1}`,
        description: parts || "Tidak ada entries baru.",
        variant: Number(s.coa_drift_count) > 0 ? "destructive" : "default",
      });
      await loadNormalized();
    } catch (e: any) {
      toast({ title: "Error", description: e.message, variant: "destructive" });
    } finally {
      setRetriggeringNorm(false);
    }
  }

  async function updateNormalizedEntry(entryId: number, fields: Record<string, string>) {
    setEditingNormId(entryId);
    try {
      const res = await fetch(`/api/bank-mutation-import/normalized/${entryId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(fields),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Gagal update");
      setNormalizedEntries(prev => prev.map(e => e.id === entryId ? { ...e, ...data.entry } : e));
    } catch (e: any) {
      toast({ title: "Error", description: e.message, variant: "destructive" });
    } finally {
      setEditingNormId(null);
    }
  }

  async function loadCompanies() {
    try {
      const r = await fetch("/api/companies/list", { credentials: "include" });
      if (!r.ok) return;
      const data = await r.json();
      const list = Array.isArray(data) ? data : (data.companies ?? []);
      setCompanies(list.map((c: any) => ({ id: c.id, name: c.name ?? c.companyName ?? String(c.id) })));
    } catch { /* non-fatal */ }
  }

  async function updateImportMode(mode: string) {
    if (!batchId) return;
    setSavingMode(true);
    try {
      const res = await fetch(`/api/bank-mutation-import/${batchId}/mode`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ import_mode: mode }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Gagal mengupdate mode");
      setBatch(prev => prev ? { ...prev, import_mode: mode } : prev);
      toast({ title: "Mode disimpan", description: mode === "HISTORICAL_IMPORT" ? "Historical Import — jurnal akan dibuat" : "Reconciliation Only — tidak membuat jurnal baru" });
    } catch (e: any) {
      toast({ title: "Error", description: e.message, variant: "destructive" });
    } finally {
      setSavingMode(false);
    }
  }

  async function updateBatchCompany(companyId: number) {
    if (!batchId) return;
    setSavingCompany(true);
    try {
      const res = await fetch(`/api/bank-mutation-import/${batchId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ company_id: companyId }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Gagal mengupdate perusahaan");
      setBatch(prev => prev ? { ...prev, company_id: companyId } : prev);
      toast({ title: "Perusahaan disimpan", description: companies.find(c => c.id === companyId)?.name });
    } catch (e: any) {
      toast({ title: "Error", description: e.message, variant: "destructive" });
    } finally {
      setSavingCompany(false);
    }
  }

  useEffect(() => { loadData(); loadCompanies(); }, [batchId]);

  // Cleanup polling saat component unmount
  useEffect(() => () => { if (pollIntervalRef) clearInterval(pollIntervalRef); }, [pollIntervalRef]);

  // Auto-resume polling jika batch sedang PROCESSING saat page dimuat
  useEffect(() => {
    if (batch?.status === "PROCESSING" && !pollIntervalRef && batchId) {
      setPosting(true);
      startPolling(batchId);
    }
  }, [batch?.status]);

  async function updateRow(rowId: number, field: "accounting_class" | "status", value: string) {
    setEditingRow(rowId);
    try {
      const res = await fetch(`/api/bank-mutation-import/imports/${rowId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ [field]: value }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Gagal update");
      setRows(prev => prev.map(r => r.id === rowId ? { ...r, [field]: value } : r));
    } catch (e: any) {
      toast({ title: "Error", description: e.message, variant: "destructive" });
    } finally {
      setEditingRow(null);
    }
  }

  async function doRowAction(rowId: number, action: "reject" | "duplicate" | "reset", reason?: string) {
    if (!batchId) return;
    setActioningRow(rowId);
    try {
      const res = await fetch(`/api/bank-mutation-import/${batchId}/rows/${rowId}/${action}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ reason: reason ?? "" }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Gagal melakukan aksi");
      setRows(prev => prev.map(r => r.id === rowId
        ? { ...r, status: data.status, rejection_reason: reason ?? null }
        : r
      ));
      toast({ title: action === "reject" ? "Baris ditolak" : action === "duplicate" ? "Baris ditandai duplikat" : "Baris di-reset", description: `ID: ${rowId}` });
    } catch (e: any) {
      toast({ title: "Error", description: e.message, variant: "destructive" });
    } finally {
      setActioningRow(null);
      setRejectOpen(null);
      setRejectReason("");
    }
  }

  async function doBatchAction(action: "reject" | "reopen", reason?: string) {
    if (!batchId) return;
    setBatchActioning(true);
    try {
      const res = await fetch(`/api/bank-mutation-import/${batchId}/${action}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ reason: reason ?? "" }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Gagal melakukan aksi");
      setBatch(prev => prev ? { ...prev, status: data.status } : prev);
      toast({ title: action === "reject" ? "Batch ditolak" : "Batch dibuka kembali", description: `Status: ${data.status}` });
      await loadData();
    } catch (e: any) {
      toast({ title: "Error", description: e.message, variant: "destructive" });
    } finally {
      setBatchActioning(false);
      setBatchRejectOpen(false);
      setBatchRejectReason("");
    }
  }

  async function doDelete() {
    if (!batchId) return;
    setDeleting(true);
    setDeleteConfirmOpen(false);
    try {
      const res = await fetch(`/api/bank-mutation-import/${batchId}`, { method: "DELETE" });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Gagal menghapus batch");
      toast({ title: "Batch dihapus", description: "Silakan upload file baru." });
      navigate("/accounting/bank-mutation-import");
    } catch (e: any) {
      toast({ title: "Error", description: e.message, variant: "destructive" });
    } finally {
      setDeleting(false);
    }
  }

  function stopPolling() {
    setPollIntervalRef(prev => {
      if (prev) clearInterval(prev);
      return null;
    });
  }

  function startPolling(bId: number) {
    stopPolling();
    setJobProgress(null);
    let attempts = 0;
    const iv = setInterval(async () => {
      attempts++;
      try {
        const statusRes = await fetch(`/api/bank-mutation-import/${bId}/post/status`);
        const statusData = await statusRes.json();

        // Update progress real-time dari job tracker
        if (statusData.running && (statusData.posted > 0 || statusData.total > 0)) {
          setJobProgress({ posted: statusData.posted ?? 0, total: statusData.total ?? 0, failed: statusData.failed ?? 0 });
        }

        if (statusData.done || !statusData.running) {
          stopPolling();
          setPosting(false);
          setJobProgress(null);
          // Reload data setelah selesai
          await loadData();
          const posted  = statusData.posted  ?? 0;
          const matched = statusData.matched ?? 0;
          const failed  = statusData.failed  ?? 0;
          const skipped = statusData.skipped ?? 0;
          const errors: { id: number; reason: string }[] = statusData.errors ?? [];
          const isRecon = batch?.import_mode === "RECONCILIATION_ONLY";

          // Jika batch di-reset (stuck recovery), beri tahu user
          if (statusData.status === 'DRAFT_IMPORT' && posted === 0 && failed === 0) {
            toast({
              title: "Import bisa dilanjutkan",
              description: "Proses sebelumnya dihentikan. Klik tombol Import untuk melanjutkan.",
            });
            return;
          }

          if (posted === 0 && !isRecon && errors.length > 0) {
            toast({
              title: "Import gagal",
              description: errors[0].reason,
              variant: "destructive",
            });
          } else if (isRecon) {
            const needReview = posted - matched;
            toast({
              title: "Reconciliation selesai",
              description: [
                matched > 0 ? `${matched} transaksi matched` : null,
                needReview > 0 ? `${needReview} perlu review manual` : null,
                failed > 0 ? `${failed} gagal` : null,
              ].filter(Boolean).join(" · ") || "Tidak ada baris diproses",
              variant: needReview > 0 ? "default" : "default",
            });
          } else {
            toast({
              title: posted > 0 ? "Import selesai" : "Tidak ada baris diproses",
              description: [
                `${posted} jurnal dibuat`,
                skipped > 0 ? `${skipped} dilewati` : null,
                failed > 0 ? `${failed} gagal` : null,
                failed > 0 && errors.length > 0
                  ? `Alasan: ${errors.slice(0, 2).map(e => e.reason).join("; ")}`
                  : null,
              ].filter(Boolean).join(" · "),
              variant: posted === 0 ? "destructive" : "default",
            });
          }
        }
        // Safety: stop setelah 30 menit
        if (attempts > 600) { stopPolling(); setPosting(false); setJobProgress(null); }
      } catch {
        // Non-fatal — lanjut polling
      }
    }, 3000);
    setPollIntervalRef(iv);
  }

  async function doDeleteRow() {
    if (!batchId || !deleteRowConfirm) return;
    setDeletingRow(true);
    try {
      const res = await fetch(`/api/bank-mutation-import/${batchId}/rows/${deleteRowConfirm.rowId}`, {
        method: "DELETE",
        credentials: "include",
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Gagal menghapus transaksi");
      toast({
        title: "Transaksi dihapus",
        description: deleteRowConfirm.journalId
          ? `Jurnal #${deleteRowConfirm.journalId} dibatalkan dan baris direset ke READY.`
          : "Baris direset ke READY.",
      });
      setDeleteRowConfirm(null);
      await loadData();
    } catch (e: any) {
      toast({ title: "Error", description: e.message, variant: "destructive" });
    } finally {
      setDeletingRow(false);
    }
  }

  async function doUnpost() {
    if (!batchId) return;
    setUnposting(true);
    setUnpostConfirmOpen(false);
    try {
      const res = await fetch(`/api/bank-mutation-import/${batchId}/unpost`, {
        method: "POST",
        credentials: "include",
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Gagal membatalkan jurnal");
      toast({ title: "Jurnal dibatalkan", description: `${data.deleted ?? 0} jurnal dihapus. Batch direset ke DRAFT.` });
      await loadData();
    } catch (e: any) {
      toast({ title: "Error", description: e.message, variant: "destructive" });
    } finally {
      setUnposting(false);
    }
  }

  async function doReprocessBs() {
    if (!batchId) return;
    setReprocessing(true);
    try {
      const res = await fetch(`/api/bank-mutation-import/${batchId}/reprocess-bs`, {
        method: "POST",
        credentials: "include",
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Gagal reprocess batch");
      toast({
        title: data.promoted > 0 ? `${data.promoted} baris dipromote ke READY` : "Tidak ada perubahan",
        description: data.message,
      });
      await loadData();
      if (activeTab === "normalized") await loadNormalized();
    } catch (e: any) {
      toast({ title: "Error", description: e.message, variant: "destructive" });
    } finally {
      setReprocessing(false);
    }
  }

  async function doBulkClassify() {
    if (!batchId) return;
    setBulkClassifying(true);
    try {
      const res = await fetch(`/api/bank-mutation-import/${batchId}/bulk-classify`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ accounting_class: bulkClass }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Gagal bulk classify");
      toast({ title: `${data.updated} baris di-set ke ${bulkClass}`, description: "Baris sekarang berstatus READY dan siap dipost." });
      await loadData();
    } catch (e: any) {
      toast({ title: "Error", description: e.message, variant: "destructive" });
    } finally {
      setBulkClassifying(false);
    }
  }

  async function doPost() {
    if (!batchId) return;
    setPosting(true);
    setConfirmOpen(false);
    try {
      const res = await fetch(`/api/bank-mutation-import/${batchId}/post`, { method: "POST" });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Gagal membuat jurnal");

      const parts: string[] = [`${data.posted} jurnal dibuat`];
      if (data.failed > 0) parts.push(`${data.failed} gagal (CoA tidak ditemukan)`);
      if (data.skipped_no_class > 0) parts.push(`${data.skipped_no_class} di-skip (belum ada Accounting Class)`);

      toast({
        title: data.failed > 0 || data.skipped_no_class > 0 ? "Import selesai dengan peringatan" : "Jurnal berhasil dibuat",
        description: parts.join(" · "),
        variant: data.failed > 0 || data.skipped_no_class > 0 ? "destructive" : "default",
      });
      await loadData();
      if (data.accepted) {
        // Async mode — polling dimulai
        toast({
          title: "Import dimulai",
          description: `Memproses baris di background. Halaman akan update otomatis setiap 3 detik.`,
        });
        startPolling(batchId);
      } else {
        // Sync result (legacy / edge case)
        setPosting(false);
        const posted  = data.posted  ?? 0;
        const failed  = data.failed  ?? 0;
        const errors: { id: number; reason: string }[] = data.errors ?? [];
        toast({
          title: posted > 0 ? "Import selesai" : "Tidak ada baris diproses",
          description: `${posted} jurnal dibuat · ${data.skipped ?? 0} dilewati${failed > 0 ? ` · ${failed} gagal` : ""}${failed > 0 && errors.length > 0 ? ` — ${errors[0].reason}` : ""}`,
          variant: posted === 0 ? "destructive" : "default",
        });
        await loadData();
      }
    } catch (e: any) {
      setPosting(false);
      toast({ title: "Error", description: e.message, variant: "destructive" });
    }
  }

  const statuses = rows.map(getRowStatus);
  const needReviewCount   = statuses.filter(s => s === "NEED_REVIEW").length;
  const needCoaMappingCount = statuses.filter(s => s === "NEED_COA_MAPPING").length;
  const importedCount     = statuses.filter(s => s === "IMPORTED").length;
  const matchedCount      = statuses.filter(s => s === "MATCHED").length;
  const readyCount        = statuses.filter(s => s === "READY").length;
  const rejectedCount     = statuses.filter(s => s === "REJECTED").length;
  const duplicateCount    = statuses.filter(s => s === "DUPLICATE").length;
  const noClassCount      = statuses.filter(s => s === "NO_CLASS").length;
  const blockedCount      = statuses.filter(s => s === "UNKNOWN").length;
  const fallbackCount     = rows.filter(r => r.used_fallback_coa).length;
  const subledgerMissingCount = rows.filter(r => r.subledger_status === "MISSING" && getRowStatus(r) !== "IMPORTED").length;

  // Breakdown accounting_class distinct
  const classBreakdown = useMemo(() => {
    const map: Record<string, { total: number; ready: number; needReview: number; imported: number }> = {};
    rows.forEach(row => {
      const cls = row.accounting_class ?? "(kosong)";
      const st  = getRowStatus(row);
      if (!map[cls]) map[cls] = { total: 0, ready: 0, needReview: 0, imported: 0 };
      map[cls].total++;
      if (st === "READY")       map[cls].ready++;
      if (st === "NEED_REVIEW") map[cls].needReview++;
      if (st === "IMPORTED")    map[cls].imported++;
    });
    return Object.entries(map).sort((a, b) => b[1].total - a[1].total);
  }, [rows]);

  // Filter rows untuk tabel
  const filteredRows = useMemo(() => {
    if (classFilter === "ALL") return rows;
    const statusFilters = ["READY","NEED_REVIEW","IMPORTED","MATCHED","REJECTED","DUPLICATE","SKIPPED_ALREADY_POSTED"];
    if (statusFilters.includes(classFilter))
      return rows.filter(r => getRowStatus(r) === classFilter);
    return rows.filter(r => (r.accounting_class ?? "(kosong)") === classFilter);
  }, [rows, classFilter]);

  if (loading) {
    return <QueryState loading skeletonRows={6} className="p-6">{null}</QueryState>;
  }

  return (
    <div className="space-y-6 p-6">
      {/* Header */}
      <div className="flex items-center gap-3">
        <Button variant="ghost" size="icon" onClick={() => navigate("/accounting/bank-mutation-import")}>
          <ArrowLeft className="h-4 w-4" />
        </Button>
        <div>
          <h1 className="text-xl font-semibold">Preview Batch Import</h1>
          <p className="text-sm text-muted-foreground">{batch?.filename}</p>
        </div>
      </div>

      {/* Company selector — tampil jika company_id kosong ATAU selalu sebagai info */}
      {batch && (
        <div className={`rounded-lg border px-4 py-3 flex items-center gap-3 flex-wrap ${!batch.company_id ? "border-red-300 bg-red-50" : "border-border bg-muted/30"}`}>
          <Building2 className={`h-4 w-4 shrink-0 ${!batch.company_id ? "text-red-500" : "text-muted-foreground"}`} />
          <span className={`text-sm font-medium ${!batch.company_id ? "text-red-700" : "text-muted-foreground"}`}>
            {!batch.company_id ? "Perusahaan belum dipilih — wajib diset sebelum import" : "Perusahaan:"}
          </span>
          <Select
            value={batch.company_id ? String(batch.company_id) : ""}
            onValueChange={val => updateBatchCompany(Number(val))}
            disabled={savingCompany}
          >
            <SelectTrigger className={`w-64 h-8 text-sm ${!batch.company_id ? "border-red-400" : ""}`}>
              <SelectValue placeholder="Pilih perusahaan…">
                {batch.company_id
                  ? (companies.find(c => c.id === batch.company_id)?.name ?? `ID ${batch.company_id}`)
                  : <span className="text-muted-foreground">Pilih perusahaan…</span>}
              </SelectValue>
            </SelectTrigger>
            <SelectContent>
              {companies.map(c => (
                <SelectItem key={c.id} value={String(c.id)} className="text-sm">{c.name}</SelectItem>
              ))}
            </SelectContent>
          </Select>
          {savingCompany && <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />}
        </div>
      )}

      {/* Import Mode Selector */}
      {batch && (
        <div className={`rounded-lg border px-4 py-3 flex items-center gap-3 flex-wrap ${batch.import_mode === "RECONCILIATION_ONLY" ? "border-purple-300 bg-purple-50" : "border-border bg-muted/30"}`}>
          <BookOpen className={`h-4 w-4 shrink-0 ${batch.import_mode === "RECONCILIATION_ONLY" ? "text-purple-600" : "text-muted-foreground"}`} />
          <span className="text-sm font-medium text-muted-foreground">Mode Import:</span>
          <Select
            value={batch.import_mode ?? "HISTORICAL_IMPORT"}
            onValueChange={updateImportMode}
            disabled={savingMode || batch.status === "IMPORTED" || batch.status === "PROCESSING"}
          >
            <SelectTrigger className="w-64 h-8 text-sm">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="HISTORICAL_IMPORT" className="text-sm">
                📋 Historical Import — buat jurnal baru
              </SelectItem>
              <SelectItem value="RECONCILIATION_ONLY" className="text-sm">
                🔗 Reconciliation Only — cocokkan transaksi existing
              </SelectItem>
            </SelectContent>
          </Select>
          {savingMode && <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />}
          {batch.import_mode === "RECONCILIATION_ONLY" && (
            <span className="text-xs text-purple-600 ml-1">
              Tidak akan membuat jurnal baru — hanya mencocokkan ke transaksi yang sudah ada di aplikasi
            </span>
          )}
        </div>
      )}

      {/* Stats + Actions */}
      <div className="flex flex-wrap gap-3 items-center justify-between">
        <div className="flex gap-3 flex-wrap">
          <div className="rounded-lg border px-4 py-2 text-center min-w-[80px]">
            <div className="text-2xl font-bold text-blue-600">{readyCount}</div>
            <div className="text-xs text-muted-foreground">Ready</div>
          </div>
          <div className="rounded-lg border px-4 py-2 text-center min-w-[80px]">
            <div className="text-2xl font-bold text-green-600">{importedCount}</div>
            <div className="text-xs text-muted-foreground">Imported</div>
          </div>
          {noClassCount > 0 && (
            <div className="rounded-lg border border-gray-200 px-4 py-2 text-center min-w-[80px] bg-gray-50">
              <div className="text-2xl font-bold text-gray-400">{noClassCount}</div>
              <div className="text-xs text-gray-400">Di-skip</div>
            </div>
          )}
          {blockedCount > 0 && (
            <div className="rounded-lg border border-red-200 px-4 py-2 text-center min-w-[80px] bg-red-50">
              <div className="text-2xl font-bold text-red-600">{blockedCount}</div>
              <div className="text-xs text-red-500">Diblokir</div>
            </div>
          )}
          {matchedCount > 0 && (
            <div className="rounded-lg border border-emerald-200 px-4 py-2 text-center min-w-[80px] bg-emerald-50">
              <div className="text-2xl font-bold text-emerald-600">{matchedCount}</div>
              <div className="text-xs text-emerald-600">Matched</div>
            </div>
          )}
          {needReviewCount > 0 && (
            <div className="rounded-lg border border-orange-200 px-4 py-2 text-center min-w-[80px] bg-orange-50">
              <div className="text-2xl font-bold text-orange-600">{needReviewCount}</div>
              <div className="text-xs text-orange-500">Need Review</div>
            </div>
          )}
          {rejectedCount > 0 && (
            <div className="rounded-lg border border-red-200 px-4 py-2 text-center min-w-[80px] bg-red-50">
              <div className="text-2xl font-bold text-red-600">{rejectedCount}</div>
              <div className="text-xs text-red-500">Rejected</div>
            </div>
          )}
          {duplicateCount > 0 && (
            <div className="rounded-lg border border-amber-200 px-4 py-2 text-center min-w-[80px] bg-amber-50">
              <div className="text-2xl font-bold text-amber-600">{duplicateCount}</div>
              <div className="text-xs text-amber-500">Duplicate</div>
            </div>
          )}
          <div className="rounded-lg border px-4 py-2 text-center min-w-[80px]">
            <div className="text-2xl font-bold text-muted-foreground">{rows.length}</div>
            <div className="text-xs text-muted-foreground">Total</div>
          </div>
        </div>

        <div className="flex items-center gap-2 flex-wrap">
          <Button
            variant="outline"
            size="sm"
            onClick={() => setShowClassBreakdown(v => !v)}
            className="gap-1.5"
          >
            <BarChart3 className="h-4 w-4" />
            Breakdown
          </Button>
          {rows.length === 0 && skippedRows.length > 0 && (
            <Button
              variant="destructive"
              onClick={() => setDeleteConfirmOpen(true)}
              disabled={deleting}
              className="gap-2"
            >
              {deleting ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
              Hapus & Upload Ulang
            </Button>
          )}
          {batch?.status === "IMPORTED" && (
            <Button
              variant="outline"
              size="sm"
              className="gap-1.5 text-red-600 border-red-300 hover:bg-red-50"
              onClick={() => setUnpostConfirmOpen(true)}
              disabled={unposting}
            >
              {unposting ? <Loader2 className="h-4 w-4 animate-spin" /> : <RotateCcw className="h-4 w-4" />}
              Batalkan Semua Jurnal
            </Button>
          )}
          {needReviewCount > 0 && batch?.status !== "IMPORTED" && batch?.status !== "REJECTED" && (
            <Button
              variant="outline"
              size="sm"
              className="gap-1.5 text-orange-600 border-orange-300 hover:bg-orange-50"
              onClick={doReprocessBs}
              disabled={reprocessing}
              title="Promote NEED_REVIEW entries dengan pl_flag=BALANCE_SHEET atau INTERNAL_TRANSFER multi-company Diva ke READY"
            >
              {reprocessing ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />}
              Re-process BS/Diva ({needReviewCount})
            </Button>
          )}
          {batch?.status !== "IMPORTED" && batch?.status !== "REJECTED" && (
            <Button
              variant="outline"
              size="sm"
              className="gap-1.5 text-red-600 border-red-300 hover:bg-red-50"
              onClick={() => setBatchRejectOpen(true)}
              disabled={batchActioning}
            >
              <ShieldAlert className="h-4 w-4" />
              Tolak Batch
            </Button>
          )}
          {batch?.status === "REJECTED" && (
            <Button
              variant="outline"
              size="sm"
              className="gap-1.5 text-green-700 border-green-300 hover:bg-green-50"
              onClick={() => doBatchAction("reopen")}
              disabled={batchActioning}
            >
              {batchActioning ? <Loader2 className="h-4 w-4 animate-spin" /> : <RotateCcw className="h-4 w-4" />}
              Buka Kembali
            </Button>
          )}
          <Button
            onClick={() => setConfirmOpen(true)}
            disabled={readyCount === 0 || posting || batch?.status === "PROCESSING" || batch?.status === "REJECTED"}
            className="gap-2"
          >
            {(posting || batch?.status === "PROCESSING") ? <Loader2 className="h-4 w-4 animate-spin" /> : <BookOpen className="h-4 w-4" />}
            {batch?.status === "PROCESSING"
              ? jobProgress && jobProgress.total > 0
                ? `Memproses ${jobProgress.posted}/${jobProgress.total}…`
                : "Memproses..."
              : posting
              ? "Memulai..."
              : `Import ${readyCount} Baris READY`}
          </Button>
        </div>
      </div>

      {/* ── Tab Bar ─────────────────────────────────────────────────────────── */}
      <div className="flex items-center gap-0 border-b">
        {([
          { key: "raw",        label: "Raw Import",          icon: <BarChart3 className="w-3.5 h-3.5" /> },
          { key: "normalized", label: "Normalized Entries",  icon: <Layers    className="w-3.5 h-3.5" /> },
        ] as const).map(tab => (
          <button
            key={tab.key}
            type="button"
            onClick={() => {
              setActiveTab(tab.key);
              if (tab.key === "normalized" && normalizedEntries.length === 0) loadNormalized();
            }}
            className={`flex items-center gap-1.5 px-4 py-2.5 text-sm border-b-2 transition-colors ${
              activeTab === tab.key
                ? "border-primary text-primary font-semibold"
                : "border-transparent text-muted-foreground hover:text-foreground"
            }`}
          >
            {tab.icon}
            {tab.label}
            {tab.key === "normalized" && normalizedSummary && (
              <span className="ml-1 rounded-full bg-primary/10 text-primary text-[10px] px-1.5 py-0.5 font-medium">
                {Number(normalizedSummary.total)}
              </span>
            )}
          </button>
        ))}
      </div>

      {/* ── Raw Import Tab ───────────────────────────────────────────────────── */}
      {activeTab === "raw" && <>
      {/* Info need review + bulk classify */}
      {needReviewCount > 0 && (
        <div className="rounded-lg border border-orange-200 bg-orange-50 p-4 text-sm text-orange-800 space-y-3">
          <div className="flex items-start gap-2">
            <AlertTriangle className="h-4 w-4 mt-0.5 shrink-0" />
            <span>
              <strong>{needReviewCount} baris</strong> berstatus <strong>NEED_REVIEW</strong> — tidak akan diimport sampai Accounting Class-nya diubah.{" "}
              <strong>{readyCount} baris READY</strong> tetap bisa diimport sekarang dengan tombol di atas.
            </span>
          </div>
          <div className="flex items-center gap-2 flex-wrap pl-6">
            <span className="text-xs font-medium text-orange-700">Tandai semua NEED_REVIEW sebagai:</span>
            <Select value={bulkClass} onValueChange={setBulkClass} disabled={bulkClassifying}>
              <SelectTrigger className="h-7 w-52 text-xs bg-white border-orange-300">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {[
                  { v: "INCOME",               l: "Income" },
                  { v: "EXPENSE",              l: "Expense" },
                  { v: "ASSET",                l: "Asset" },
                  { v: "LIABILITY",            l: "Liability" },
                  { v: "LIABILITY_SETTLEMENT", l: "Liability Settlement" },
                  { v: "EQUITY",               l: "Equity" },
                  { v: "TRANSFER",             l: "Transfer" },
                  { v: "TAX",                  l: "Tax" },
                ].map(({ v, l }) => (
                  <SelectItem key={v} value={v} className="text-xs">{l}</SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Button
              size="sm"
              variant="outline"
              className="h-7 text-xs border-orange-400 text-orange-800 hover:bg-orange-100 gap-1.5"
              onClick={doBulkClassify}
              disabled={bulkClassifying}
            >
              {bulkClassifying ? <Loader2 className="h-3 w-3 animate-spin" /> : null}
              Terapkan ke {needReviewCount} baris
            </Button>
          </div>
        </div>
      )}

      {/* FASE 1/8: No COA Mapping warning — HARD BLOCK */}
      {needCoaMappingCount > 0 && (
        <div className="rounded-lg border border-purple-300 bg-purple-50 p-3 text-sm text-purple-800 flex items-start gap-2">
          <AlertTriangle className="h-4 w-4 mt-0.5 shrink-0 text-purple-600" />
          <div>
            <span className="font-semibold">{needCoaMappingCount} baris tidak punya COA mapping</span>{" "}
            — ERP Category ini belum dikonfigurasi di Master COA Mapping.
            Baris ini <strong>tidak akan diposting</strong> sampai mapping ditambahkan di halaman COA Mapping.
            <span className="block text-xs text-purple-700 mt-0.5">
              Ditandai dengan badge ungu <span className="font-mono bg-purple-100 px-1 rounded">No COA</span> di tabel di bawah.
            </span>
          </div>
        </div>
      )}

      {/* FASE 6: Subledger missing — WARNING ONLY (tidak blokir posting) */}
      {subledgerMissingCount > 0 && (
        <div className="rounded-lg border border-sky-200 bg-sky-50 p-3 text-sm text-sky-800 flex items-start gap-2">
          <AlertTriangle className="h-4 w-4 mt-0.5 shrink-0 text-sky-500" />
          <div>
            <span className="font-semibold">{subledgerMissingCount} baris belum punya subledger link</span>{" "}
            — ini hanya peringatan, baris tetap bisa diposting.
            Lengkapi entitas AR/AP setelah posting jika diperlukan.
          </div>
        </div>
      )}

      {/* Fallback COA warning */}
      {fallbackCount > 0 && (
        <div className="rounded-lg border border-yellow-300 bg-yellow-50 p-3 text-sm text-yellow-800 flex items-start gap-2">
          <Zap className="h-4 w-4 mt-0.5 shrink-0 text-yellow-600" />
          <div>
            <span className="font-semibold">{fallbackCount} baris memakai Fallback COA</span> — ERP_CATEGORY belum punya master COA mapping spesifik, sistem memakai COA default.{" "}
            <span className="font-medium">Periksa COA Mapping sebelum posting final.</span>
            <span className="block text-xs text-yellow-700 mt-0.5">
              Baris dengan badge <span className="font-mono bg-yellow-100 px-1 rounded">Fallback COA</span> ditandai di tabel di bawah.
            </span>
          </div>
        </div>
      )}

      {skippedRows.length > 0 && rows.length > 0 && (
        <div className="rounded-lg border border-yellow-300 bg-yellow-50 p-3 text-sm text-yellow-800 flex items-start gap-2">
          <SkipForward className="h-4 w-4 mt-0.5 shrink-0 text-yellow-600" />
          <span>
            <strong>{skippedRows.length} baris di-skip</strong> (duplikat / tanggal tidak valid) — tidak diimport.{" "}
            <strong>{readyCount} baris valid</strong> siap diimport.
          </span>
        </div>
      )}

      {/* Breakdown Panel */}
      {showClassBreakdown && (
        <div className="rounded-lg border overflow-hidden">
          <div className="bg-muted/40 px-4 py-3 flex items-center gap-2 border-b">
            <BarChart3 className="h-4 w-4 text-muted-foreground" />
            <span className="text-sm font-medium">Breakdown Accounting Class</span>
            <span className="text-xs text-muted-foreground ml-1">({classBreakdown.length} distinct class)</span>
          </div>
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow className="bg-muted/20">
                  <TableHead className="text-xs">Accounting Class</TableHead>
                  <TableHead className="text-xs text-right w-20">Total</TableHead>
                  <TableHead className="text-xs text-right w-20">Ready</TableHead>
                  <TableHead className="text-xs text-right w-24">Need Review</TableHead>
                  <TableHead className="text-xs text-right w-24">Imported</TableHead>
                  <TableHead className="text-xs w-24"></TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {classBreakdown.map(([cls, counts]) => (
                  <TableRow key={cls} className="hover:bg-muted/10">
                    <TableCell className="text-sm font-mono">
                      {cls === "(kosong)" ? (
                        <span className="text-muted-foreground italic">kosong</span>
                      ) : (
                        <span className={counts.needReview > 0 && counts.ready === 0 ? "text-orange-600" : ""}>{cls}</span>
                      )}
                    </TableCell>
                    <TableCell className="text-right text-sm font-medium">{counts.total}</TableCell>
                    <TableCell className="text-right text-sm text-blue-600">{counts.ready || "–"}</TableCell>
                    <TableCell className="text-right text-sm text-orange-600">{counts.needReview || "–"}</TableCell>
                    <TableCell className="text-right text-sm text-green-600">{counts.imported || "–"}</TableCell>
                    <TableCell>
                      <Button
                        variant="ghost"
                        size="sm"
                        className="h-6 text-xs px-2"
                        onClick={() => setClassFilter(cls)}
                      >
                        Filter
                      </Button>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        </div>
      )}

      {/* Batch REJECTED banner */}
      {batch?.status === "REJECTED" && (
        <div className="rounded-lg border border-red-300 bg-red-50 p-3 text-sm text-red-800 flex items-center gap-2">
          <ShieldAlert className="h-4 w-4 shrink-0" />
          <span><strong>Batch ini ditolak (REJECTED).</strong> Tidak bisa diimport sampai dibuka kembali.</span>
        </div>
      )}

      {/* Filter Bar */}
      <div className="flex items-center gap-2 flex-wrap">
        <span className="text-sm text-muted-foreground">Filter:</span>
        {[
          { value: "ALL",              label: `Semua (${rows.length})` },
          { value: "READY",            label: `Ready (${readyCount})` },
          { value: "NEED_REVIEW",      label: `Need Review (${needReviewCount})` },
          ...(needCoaMappingCount > 0 ? [{ value: "NEED_COA_MAPPING", label: `No COA (${needCoaMappingCount})` }] : []),
          { value: "IMPORTED",         label: `Imported (${importedCount})` },
          ...(matchedCount   > 0 ? [{ value: "MATCHED",   label: `Matched (${matchedCount})` }]   : []),
          ...(rejectedCount  > 0 ? [{ value: "REJECTED",  label: `Rejected (${rejectedCount})` }]  : []),
          ...(duplicateCount > 0 ? [{ value: "DUPLICATE", label: `Duplicate (${duplicateCount})` }] : []),
        ].map(opt => (
          <Button
            key={opt.value}
            variant={classFilter === opt.value ? "default" : "outline"}
            size="sm"
            className="h-7 text-xs"
            onClick={() => setClassFilter(opt.value)}
          >
            {opt.label}
          </Button>
        ))}
        {classFilter !== "ALL" && !["READY","NEED_REVIEW","NEED_COA_MAPPING","IMPORTED","MATCHED","REJECTED","DUPLICATE","SKIPPED_ALREADY_POSTED"].includes(classFilter) && (
          <Badge variant="secondary" className="text-xs gap-1">
            {classFilter}
            <button onClick={() => setClassFilter("ALL")} className="ml-1 hover:text-destructive">×</button>
          </Badge>
        )}
      </div>

      {/* Main Table */}
      <div className="rounded-lg border overflow-hidden">
        <Table>
          <TableHeader>
            <TableRow className="bg-muted/40">
              <TableHead className="w-28">Tanggal</TableHead>
              <TableHead>Deskripsi</TableHead>
              <TableHead className="text-right w-32">Debit</TableHead>
              <TableHead className="text-right w-32">Credit</TableHead>
              <TableHead className="w-40">ERP Category</TableHead>
              <TableHead className="w-48">Accounting Class</TableHead>
              <TableHead className="w-32 text-center">Status</TableHead>
              <TableHead className="w-32 text-center">Recon Status</TableHead>
              <TableHead className="w-32">Linked Type</TableHead>
              <TableHead className="w-24">Linked ID</TableHead>
              <TableHead className="w-36">No. Jurnal</TableHead>
              <TableHead className="w-28 text-center">Aksi</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {filteredRows.length === 0 && skippedRows.length === 0 && (
              <TableRow>
                <TableCell colSpan={12} className="text-center text-muted-foreground py-8">
                  Tidak ada data
                </TableCell>
              </TableRow>
            )}
            {filteredRows.length === 0 && skippedRows.length > 0 && rows.length === 0 && (
              <TableRow>
                <TableCell colSpan={12} className="text-center text-muted-foreground py-8">
                  Semua baris di-skip — lihat tabel di bawah untuk detailnya
                </TableCell>
              </TableRow>
            )}
            {filteredRows.map(row => {
              const rowStatus = getRowStatus(row);
              const rowBg = rowStatus === "NEED_COA_MAPPING"      ? "bg-purple-50/60 hover:bg-purple-100/40"
                          : rowStatus === "NEED_REVIEW"           ? "bg-orange-50/60 hover:bg-orange-100/40"
                          : rowStatus === "REJECTED"              ? "bg-red-50/60 hover:bg-red-100/40"
                          : rowStatus === "DUPLICATE"             ? "bg-amber-50/60 hover:bg-amber-100/40"
                          : rowStatus === "MATCHED"               ? "bg-emerald-50/40 hover:bg-emerald-100/30"
                          : rowStatus === "SKIPPED_ALREADY_POSTED"? "bg-gray-50/60 hover:bg-white/5"
                          : undefined;
              const isLocked = rowStatus === "IMPORTED" || rowStatus === "MATCHED" || rowStatus === "SKIPPED_ALREADY_POSTED";
              return (
                <TableRow key={row.id} className={rowBg}>
                  <TableCell className="text-sm">{fmtDate(row.transaction_date)}</TableCell>
                  <TableCell className="text-sm max-w-[240px]">
                    <div className="truncate" title={row.description ?? ""}>{row.description ?? "–"}</div>
                    {(rowStatus === "REJECTED" || rowStatus === "DUPLICATE") && row.rejection_reason && (
                      <div className="text-[10px] text-muted-foreground truncate mt-0.5 italic" title={row.rejection_reason}>
                        {row.rejection_reason}
                      </div>
                    )}
                  </TableCell>
                  <TableCell className="text-right text-sm font-mono">
                    {Number(row.debit || 0) > 0 ? fmt(row.debit) : "–"}
                  </TableCell>
                  <TableCell className="text-right text-sm font-mono">
                    {Number(row.credit || 0) > 0 ? fmt(row.credit) : "–"}
                  </TableCell>
                  <TableCell className="text-xs text-muted-foreground">
                    <div className="flex flex-col gap-0.5">
                      <span>{row.erp_category ?? "–"}</span>
                      {row.used_fallback_coa && (
                        <span className="inline-flex items-center gap-1 bg-yellow-100 text-yellow-700 border border-yellow-300 rounded px-1.5 py-0.5 text-[10px] font-medium w-fit"
                          title="Fallback COA — belum ada master mapping spesifik">
                          <Zap className="w-2.5 h-2.5" /> Fallback COA
                        </span>
                      )}
                      {(rowStatus === "MATCHED" || row.reconciliation_status === "MATCHED") && row.linked_transaction_type && (
                        <span className="inline-flex items-center gap-1 bg-emerald-100 text-emerald-700 rounded px-1.5 py-0.5 text-[10px] font-medium w-fit">
                          <Link2 className="w-2.5 h-2.5" /> {row.linked_transaction_type}
                          {row.linked_transaction_id ? ` #${row.linked_transaction_id}` : ""}
                        </span>
                      )}
                    </div>
                  </TableCell>
                  <TableCell>
                    {isLocked ? (
                      <span className="text-sm text-muted-foreground">
                        {CLASS_LABELS[row.accounting_class ?? ""] ?? row.accounting_class ?? "–"}
                      </span>
                    ) : (
                      <Select
                        value={row.accounting_class ?? ""}
                        onValueChange={val => updateRow(row.id, "accounting_class", val)}
                        disabled={editingRow === row.id || rowStatus === "REJECTED" || rowStatus === "DUPLICATE"}
                      >
                        <SelectTrigger className={`h-8 text-xs ${rowStatus === "NEED_REVIEW" ? "border-orange-300" : ""}`}>
                          <SelectValue>
                            {row.accounting_class
                              ? (CLASS_LABELS[row.accounting_class] ?? row.accounting_class)
                              : <span className="text-muted-foreground">Pilih class…</span>}
                          </SelectValue>
                        </SelectTrigger>
                        <SelectContent>
                          {VALID_CLASSES.map(c => (
                            <SelectItem key={c} value={c} className="text-xs">{CLASS_LABELS[c] ?? c}</SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    )}
                  </TableCell>
                  <TableCell className="text-center">
                    <StatusBadge status={rowStatus} />
                  </TableCell>
                  <TableCell className="text-center">
                    {row.reconciliation_status ? (
                      <span className={`inline-block text-[10px] font-medium px-1.5 py-0.5 rounded-full border ${
                        row.reconciliation_status === "MATCHED"               ? "bg-emerald-100 text-emerald-700 border-emerald-300"
                        : row.reconciliation_status === "NEED_REVIEW"         ? "bg-orange-100 text-orange-700 border-orange-300"
                        : row.reconciliation_status === "DUPLICATE"           ? "bg-amber-100 text-amber-700 border-amber-300"
                        : row.reconciliation_status === "REJECTED"            ? "bg-red-100 text-red-700 border-red-300"
                        : row.reconciliation_status === "SKIPPED_ALREADY_POSTED" ? "bg-gray-100 text-gray-600 border-gray-300"
                        : "bg-muted text-muted-foreground border-border"
                      }`}>
                        {row.reconciliation_status}
                      </span>
                    ) : <span className="text-muted-foreground">–</span>}
                  </TableCell>
                  <TableCell className="text-xs text-muted-foreground">
                    {row.linked_transaction_type ? (
                      <span className="inline-flex items-center gap-1">
                        <Link2 className="w-3 h-3 shrink-0" />
                        {row.linked_transaction_type}
                      </span>
                    ) : <span>–</span>}
                  </TableCell>
                  <TableCell className="text-xs font-mono text-muted-foreground">
                    {row.linked_transaction_id ?? "–"}
                  </TableCell>
                  <TableCell className="text-xs font-mono text-muted-foreground">
                    {row.journal_entry_number ? (
                      <span className="flex items-center gap-1 text-green-700">
                        <CheckCircle2 className="h-3 w-3" />
                        {row.journal_entry_number}
                      </span>
                    ) : "–"}
                  </TableCell>
                  <TableCell className="text-center">
                    {isLocked && rowStatus === "IMPORTED" ? (
                      <Button
                        variant="ghost" size="sm"
                        className="h-7 px-1.5 text-xs text-red-500 hover:text-red-700 hover:bg-red-50"
                        onClick={() => setDeleteRowConfirm({ rowId: row.id, journalId: row.journal_entry_id ? Number(row.journal_entry_id) : null })}
                        disabled={deletingRow}
                        title="Hapus transaksi ini (void jurnal)"
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                      </Button>
                    ) : isLocked ? null : rowStatus === "REJECTED" || rowStatus === "DUPLICATE" ? (
                      <Button
                        variant="ghost" size="sm"
                        className="h-7 px-2 text-xs gap-1 text-green-700 hover:text-green-800"
                        onClick={() => doRowAction(row.id, "reset")}
                        disabled={actioningRow === row.id}
                        title="Reset ke NEED_REVIEW"
                      >
                        {actioningRow === row.id ? <Loader2 className="w-3 h-3 animate-spin" /> : <RotateCcw className="w-3 h-3" />}
                      </Button>
                    ) : (
                      <div className="flex items-center justify-center gap-0.5">
                        <Button
                          variant="ghost" size="sm"
                          className="h-7 px-1.5 text-xs text-red-600 hover:text-red-700 hover:bg-red-50"
                          onClick={() => { setRejectOpen({ rowId: row.id }); setRejectReason(""); }}
                          disabled={actioningRow === row.id}
                          title="Tolak baris ini"
                        >
                          <XCircle className="w-3.5 h-3.5" />
                        </Button>
                        <Button
                          variant="ghost" size="sm"
                          className="h-7 px-1.5 text-xs text-amber-600 hover:text-amber-700 hover:bg-amber-50"
                          onClick={() => doRowAction(row.id, "duplicate")}
                          disabled={actioningRow === row.id}
                          title="Tandai sebagai duplikat"
                        >
                          <Ban className="w-3.5 h-3.5" />
                        </Button>
                      </div>
                    )}
                  </TableCell>
                </TableRow>
              );
            })}
          </TableBody>
        </Table>
      </div>

      {/* Skipped Rows Table */}
      {skippedRows.length > 0 && (
        <div className="rounded-lg border border-zinc-700 overflow-hidden">
          <div className="bg-black px-4 py-3 flex items-center gap-2 border-b border-zinc-700">
            <SkipForward className="h-4 w-4 text-zinc-400" />
            <span className="text-sm font-medium text-zinc-100">
              {skippedRows.length} baris di-skip (tidak diimport)
            </span>
          </div>
          <Table>
            <TableHeader>
              <TableRow className="bg-zinc-900 hover:bg-zinc-900 border-zinc-700">
                <TableHead className="w-8 text-xs text-zinc-400">#</TableHead>
                <TableHead className="w-28 text-xs text-zinc-400">Tanggal</TableHead>
                <TableHead className="text-xs text-zinc-400">Deskripsi</TableHead>
                <TableHead className="text-right w-32 text-xs text-zinc-400">Debit</TableHead>
                <TableHead className="text-right w-32 text-xs text-zinc-400">Credit</TableHead>
                <TableHead className="w-44 text-xs text-zinc-400">Alasan Skip</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {skippedRows.map(row => (
                <TableRow key={row.id} className="bg-zinc-950 hover:bg-zinc-900 border-zinc-800">
                  <TableCell className="text-xs text-zinc-500">{row.row_index + 1}</TableCell>
                  <TableCell className="text-xs text-zinc-300">{fmtDate(row.date)}</TableCell>
                  <TableCell className="text-xs max-w-[260px] truncate text-zinc-400" title={row.description ?? ""}>
                    {row.description ?? "–"}
                  </TableCell>
                  <TableCell className="text-right text-xs font-mono text-zinc-300">
                    {Number(row.debit || 0) > 0 ? fmt(row.debit) : "–"}
                  </TableCell>
                  <TableCell className="text-right text-xs font-mono text-zinc-300">
                    {Number(row.credit || 0) > 0 ? fmt(row.credit) : "–"}
                  </TableCell>
                  <TableCell>
                    {row.skip_reason === "DUPLICATE" ? (
                      <Badge className="bg-orange-100 text-orange-700 border-orange-200 text-xs">Duplikat</Badge>
                    ) : row.skip_reason === "INVALID_DATE" ? (
                      <Badge className="bg-red-100 text-red-700 border-red-200 text-xs">Tanggal tidak valid</Badge>
                    ) : (
                      <Badge className="bg-gray-100 text-gray-600 text-xs">{row.skip_reason ?? "–"}</Badge>
                    )}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}

      </> /* end raw tab */}

      {/* ── Normalized Entries Tab ───────────────────────────────────────────── */}
      {activeTab === "normalized" && (
        <div className="space-y-4">
          {/* Toolbar */}
          <div className="flex items-center justify-between flex-wrap gap-2">
            <div className="flex items-center gap-2 flex-wrap">
              {normalizedSummary && (
                <>
                  {[
                    { key: "ALL",         label: `Semua (${normalizedSummary.total})` },
                    { key: "READY",       label: `Ready (${normalizedSummary.ready})` },
                    { key: "NEED_REVIEW", label: `Need Review (${normalizedSummary.need_review})` },
                    { key: "POSTED",      label: `Posted (${normalizedSummary.posted})` },
                    ...(Number(normalizedSummary.duplicate) > 0
                      ? [{ key: "DUPLICATE", label: `Duplikat (${normalizedSummary.duplicate})` }] : []),
                  ].map(opt => (
                    <Button
                      key={opt.key}
                      variant={normalizedFilter === opt.key ? "default" : "outline"}
                      size="sm" className="h-7 text-xs"
                      onClick={() => setNormalizedFilter(opt.key)}
                    >{opt.label}</Button>
                  ))}
                </>
              )}
            </div>
            <div className="flex items-center gap-2 flex-wrap">
              {normalizedSummary && Number(normalizedSummary.version_max) > 1 && (
                <span className="flex items-center gap-1 text-xs text-purple-700 bg-purple-50 border border-purple-200 rounded px-2 py-1">
                  v{normalizedSummary.version_max}
                  {Number(normalizedSummary.superseded_count) > 0 && (
                    <span className="text-purple-500 ml-0.5">· {normalizedSummary.superseded_count} superseded</span>
                  )}
                </span>
              )}
              {normalizedSummary && Number(normalizedSummary.coa_drift_count) > 0 && (
                <span className="flex items-center gap-1 text-xs text-red-700 bg-red-50 border border-red-200 rounded px-2 py-1" title="COA Drift: same unique_key, berbeda COA di batch lain">
                  <ShieldAlert className="w-3 h-3" /> {normalizedSummary.coa_drift_count} COA Drift
                </span>
              )}
              {normalizedSummary && Number(normalizedSummary.fallback_coa_count) > 0 && (
                <span className="flex items-center gap-1 text-xs text-yellow-700 bg-yellow-50 border border-yellow-200 rounded px-2 py-1">
                  <Zap className="w-3 h-3" /> {normalizedSummary.fallback_coa_count} Fallback COA
                </span>
              )}
              <Button
                size="sm" variant="outline" className="gap-1.5 h-8"
                onClick={retriggerNormalization}
                disabled={retriggeringNorm || normalizedLoading}
              >
                {retriggeringNorm ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <RefreshCw className="w-3.5 h-3.5" />}
                Re-Normalisasi
              </Button>
            </div>
          </div>

          {/* Normalized table */}
          {normalizedLoading ? (
            <div className="flex items-center justify-center py-16 gap-2 text-muted-foreground">
              <Loader2 className="w-5 h-5 animate-spin" />
              <span className="text-sm">Memuat normalized entries…</span>
            </div>
          ) : normalizedEntries.length === 0 ? (
            <div className="rounded-lg border border-dashed p-12 text-center">
              <Layers className="w-10 h-10 mx-auto mb-3 text-muted-foreground/40" />
              <p className="text-sm text-muted-foreground font-medium">Belum ada normalized entries</p>
              <p className="text-xs text-muted-foreground mt-1">Klik "Re-Normalisasi" untuk generate entries dari batch ini.</p>
              <Button size="sm" className="mt-4 gap-1.5" onClick={retriggerNormalization} disabled={retriggeringNorm}>
                {retriggeringNorm ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Layers className="w-3.5 h-3.5" />}
                Generate Normalized Entries
              </Button>
            </div>
          ) : (
            <div className="rounded-lg border overflow-hidden">
              <Table>
                <TableHeader>
                  <TableRow className="bg-muted/40">
                    <TableHead className="w-28 text-xs">Tanggal</TableHead>
                    <TableHead className="text-xs">Deskripsi</TableHead>
                    <TableHead className="text-right w-28 text-xs">Jumlah</TableHead>
                    <TableHead className="w-14 text-center text-xs">Dir</TableHead>
                    <TableHead className="w-36 text-xs">ERP Category</TableHead>
                    <TableHead className="w-32 text-xs">Cost Center</TableHead>
                    <TableHead className="w-28 text-xs">COA Debit</TableHead>
                    <TableHead className="w-28 text-xs">COA Credit</TableHead>
                    <TableHead className="w-28 text-center text-xs">Status</TableHead>
                    <TableHead className="w-28 text-xs">No. Jurnal</TableHead>
                    <TableHead className="w-24 text-xs text-center">Aksi</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {normalizedEntries
                    .filter(ne => normalizedFilter === "ALL" || ne.status === normalizedFilter)
                    .map(ne => {
                      const rowBg = ne.status === "NEED_REVIEW" ? "bg-orange-50/60"
                                  : ne.status === "DUPLICATE"   ? "bg-amber-50/60"
                                  : ne.status === "POSTED"      ? "bg-green-50/40"
                                  : ne.status === "MATCHED"     ? "bg-emerald-50/40"
                                  : undefined;
                      return (
                        <TableRow key={ne.id} className={rowBg}>
                          <TableCell className="text-xs">{fmtDate(ne.transaction_date)}</TableCell>
                          <TableCell className="text-xs max-w-[200px]">
                            <div className="truncate" title={ne.description ?? ""}>{ne.description ?? "–"}</div>
                          </TableCell>
                          <TableCell className="text-right text-xs font-mono">
                            {Number(ne.amount || 0).toLocaleString("id-ID")}
                          </TableCell>
                          <TableCell className="text-center">
                            <span className={`text-[10px] font-bold px-1.5 py-0.5 rounded-full ${
                              ne.direction === "IN"
                                ? "bg-green-100 text-green-700"
                                : "bg-red-100 text-red-700"
                            }`}>
                              {ne.direction}
                            </span>
                          </TableCell>
                          <TableCell className="text-xs text-muted-foreground">
                            <div className="flex flex-col gap-0.5">
                              <span>{ne.erp_category ?? "–"}</span>
                              {ne.coa_drift && (
                                <span className="inline-flex items-center gap-1 bg-red-100 text-red-700 border border-red-300 rounded px-1 py-0.5 text-[10px] w-fit" title="COA Drift — same unique_key, berbeda COA di batch lain">
                                  <ShieldAlert className="w-2 h-2" /> COA Drift
                                </span>
                              )}
                              {ne.used_fallback_coa && (
                                <span className="inline-flex items-center gap-1 bg-yellow-100 text-yellow-700 border border-yellow-300 rounded px-1 py-0.5 text-[10px] w-fit">
                                  <Zap className="w-2 h-2" /> Fallback
                                </span>
                              )}
                            </div>
                          </TableCell>
                          <TableCell className="text-xs font-medium">
                            {ne.cost_center_id ? (
                              <span className="bg-blue-50 text-blue-700 border border-blue-200 rounded px-1.5 py-0.5 text-[10px]">
                                {ne.cost_center_id}
                              </span>
                            ) : "–"}
                          </TableCell>
                          <TableCell className="text-xs font-mono text-muted-foreground">{ne.coa_debit ?? "–"}</TableCell>
                          <TableCell className="text-xs font-mono text-muted-foreground">{ne.coa_credit ?? "–"}</TableCell>
                          <TableCell className="text-center">
                            {ne.status === "READY" && <Badge className="bg-blue-100 text-blue-700 border-blue-200 text-[10px]">Ready</Badge>}
                            {ne.status === "NEED_REVIEW" && <Badge className="bg-orange-100 text-orange-700 border-orange-200 text-[10px] gap-1"><AlertTriangle className="w-2.5 h-2.5" />Review</Badge>}
                            {ne.status === "POSTED" && <Badge className="bg-green-100 text-green-700 border-green-200 text-[10px] gap-1"><CheckCircle2 className="w-2.5 h-2.5" />Posted</Badge>}
                            {ne.status === "MATCHED" && <Badge className="bg-emerald-100 text-emerald-700 border-emerald-200 text-[10px] gap-1"><Link2 className="w-2.5 h-2.5" />Matched</Badge>}
                            {ne.status === "DUPLICATE" && <Badge className="bg-amber-100 text-amber-700 border-amber-200 text-[10px] gap-1"><Ban className="w-2.5 h-2.5" />Duplikat</Badge>}
                          </TableCell>
                          <TableCell className="text-xs font-mono text-muted-foreground">
                            {ne.journal_entry_number
                              ? <span className="flex items-center gap-1 text-green-700"><CheckCircle2 className="w-2.5 h-2.5" />{ne.journal_entry_number}</span>
                              : "–"}
                          </TableCell>
                          <TableCell className="text-center">
                            {(ne.status === "NEED_REVIEW" || ne.status === "DUPLICATE") && (
                              <Button
                                variant="ghost" size="sm"
                                className="h-6 px-2 text-[10px] text-blue-700 hover:bg-blue-50 gap-1"
                                disabled={editingNormId === ne.id}
                                onClick={() => updateNormalizedEntry(ne.id, { status: "READY" })}
                                title="Set ke READY"
                              >
                                {editingNormId === ne.id ? <Loader2 className="w-2.5 h-2.5 animate-spin" /> : <CheckCircle2 className="w-2.5 h-2.5" />}
                                Set Ready
                              </Button>
                            )}
                          </TableCell>
                        </TableRow>
                      );
                    })
                  }
                </TableBody>
              </Table>
            </div>
          )}
        </div>
      )}

      {/* Row Reject Dialog */}
      <AlertDialog open={!!rejectOpen} onOpenChange={open => { if (!open) { setRejectOpen(null); setRejectReason(""); } }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Tolak Baris Import</AlertDialogTitle>
            <AlertDialogDescription>
              Masukkan alasan penolakan (opsional). Baris yang ditolak tidak akan diimport ke jurnal.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <div className="px-1 py-2">
            <textarea
              className="w-full border rounded-md px-3 py-2 text-sm min-h-[72px] resize-none focus:outline-none focus:ring-2 focus:ring-ring"
              placeholder="Alasan penolakan…"
              value={rejectReason}
              onChange={e => setRejectReason(e.target.value)}
            />
          </div>
          <AlertDialogFooter>
            <AlertDialogCancel>Batal</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              onClick={() => rejectOpen && doRowAction(rejectOpen.rowId, "reject", rejectReason)}
            >
              Ya, Tolak Baris
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Batch Reject Dialog */}
      <AlertDialog open={batchRejectOpen} onOpenChange={open => { if (!open) { setBatchRejectOpen(false); setBatchRejectReason(""); } }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Tolak Seluruh Batch?</AlertDialogTitle>
            <AlertDialogDescription>
              Batch ini akan ditandai <strong>REJECTED</strong> dan tidak bisa diimport sampai dibuka kembali. Masukkan alasan (opsional).
            </AlertDialogDescription>
          </AlertDialogHeader>
          <div className="px-1 py-2">
            <textarea
              className="w-full border rounded-md px-3 py-2 text-sm min-h-[72px] resize-none focus:outline-none focus:ring-2 focus:ring-ring"
              placeholder="Alasan penolakan batch…"
              value={batchRejectReason}
              onChange={e => setBatchRejectReason(e.target.value)}
            />
          </div>
          <AlertDialogFooter>
            <AlertDialogCancel>Batal</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              onClick={() => doBatchAction("reject", batchRejectReason)}
            >
              Ya, Tolak Batch
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Unpost Batch Dialog */}
      <AlertDialog open={unpostConfirmOpen} onOpenChange={setUnpostConfirmOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Batalkan Semua Jurnal?</AlertDialogTitle>
            <AlertDialogDescription>
              Semua jurnal akuntansi dari batch <strong>{batch?.filename}</strong> akan dihapus permanen dan batch akan direset ke status <strong>DRAFT</strong> agar bisa dipost ulang. Tindakan ini tidak bisa di-undo.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Batal</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              onClick={doUnpost}
            >
              Ya, Batalkan Semua Jurnal
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Confirm Import Dialog */}
      <AlertDialog open={confirmOpen} onOpenChange={setConfirmOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Konfirmasi Import ke ERP</AlertDialogTitle>
            <AlertDialogDescription>
              Akan dibuat <strong>{readyCount}</strong> jurnal akuntansi dari baris berstatus{" "}
              <strong>READY</strong>.
              {needReviewCount > 0 && (
                <span className="block mt-1 text-orange-700">
                  {needReviewCount} baris <strong>NEED_REVIEW</strong> tidak akan diimport dan bisa diproses terpisah setelah review.
                </span>
              )}
              Aksi ini tidak dapat dibatalkan. Lanjutkan?
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Batal</AlertDialogCancel>
            <AlertDialogAction onClick={doPost}>Ya, Import {readyCount} Baris Sekarang</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Delete Row (per-transaksi) Dialog */}
      <AlertDialog open={!!deleteRowConfirm} onOpenChange={open => { if (!open) setDeleteRowConfirm(null); }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Hapus Transaksi Ini?</AlertDialogTitle>
            <AlertDialogDescription>
              {deleteRowConfirm?.journalId
                ? <>Jurnal akuntansi <strong>#{deleteRowConfirm.journalId}</strong> akan dihapus permanen dan baris ini direset ke status <strong>READY</strong> agar bisa diposting ulang.</>
                : <>Baris ini akan direset ke status <strong>READY</strong>.</>
              }
              {" "}Tindakan ini tidak dapat di-undo.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={deletingRow}>Batal</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              onClick={doDeleteRow}
              disabled={deletingRow}
            >
              {deletingRow ? <Loader2 className="h-4 w-4 animate-spin mr-1" /> : null}
              Ya, Hapus Transaksi
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Confirm Delete Dialog */}
      <AlertDialog open={deleteConfirmOpen} onOpenChange={setDeleteConfirmOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Hapus Batch Import?</AlertDialogTitle>
            <AlertDialogDescription>
              Batch <strong>{batch?.filename}</strong> akan dihapus permanen. Anda bisa upload ulang file yang sama atau file baru setelahnya.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Batal</AlertDialogCancel>
            <AlertDialogAction onClick={doDelete} className="bg-destructive text-destructive-foreground hover:bg-destructive/90">
              Ya, Hapus Batch
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
