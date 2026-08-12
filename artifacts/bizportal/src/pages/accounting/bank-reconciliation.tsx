import React, { useState, useCallback, useEffect, useRef } from "react";
import { DatePicker } from "@/components/ui/date-picker";
import { AppShell } from "@/components/layout/AppShell";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from "@/components/ui/alert-dialog";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Separator } from "@/components/ui/separator";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { useToast } from "@/hooks/use-toast";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import {
  Upload, Play, RefreshCw, CheckCircle2, XCircle, AlertTriangle,
  Search, Trash2, ArrowLeft, CloudDownload,
  Wifi, WifiOff, Loader2, ShieldAlert, Plus, Settings2, Building2,
  ChevronDown, ChevronUp, ArrowUpRight, ArrowDownLeft, Zap, Eye,
  BookOpen, TrendingUp, Clock, FileText, CreditCard, Users,
  CircleCheck, CircleDot, ReceiptText, X, Undo2, RotateCcw,
  Paperclip, ImageIcon, ExternalLink,
} from "lucide-react";
import { Link, useLocation } from "wouter";
import { AIReviewSourcePanel } from "@/components/ai-review";
import { useCompany } from "@/contexts/CompanyContext";

// ─────────────────────────────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────────────────────────────

interface SheetConfig {
  id: number;
  company_id: number | null;
  company_name: string | null;
  label: string;
  sheet_id: string;
  tab_name: string;
  is_active: boolean;
  last_synced_at: string | null;
  last_sync_status: string | null;
  last_sync_error: string | null;
}

interface Company {
  id: number;
  companyName: string;
}

interface TestResult {
  ok: boolean;
  stage?: string;
  error?: string;
  hint?: string;
  message?: string;
  spreadsheetTitle?: string;
  availableTabs?: string[];
  tabExists?: boolean;
  serviceAccountEmail?: string | null;
}

// ── Mapping-Required Error (Task #6: Fail-Closed Journal Mapping) ─────────────
interface MappingRequiredError {
  code: string;
  message: string;
  manual_review_required: true;
}

// Real statuses from bank_mutations.status (backend contract):
//   unmatched             → mutation synced but no candidate found
//   matched               → candidate(s) found by matching engine
//   duplicate_need_review → derived from bmi.status=NEED_REVIEW (import flow)
//   approved_pending_posting → approve done, draft journal created, awaiting POST /post
//   posted                → journal promoted to posted by POST /post
//   rejected              → manually rejected
//   void                  → journal voided via POST /void-journal

// ── Sheet Config Manager ──────────────────────────────────────────────────────

function SheetConfigManager() {
  const { toast } = useToast();
  const qc = useQueryClient();
  const [showForm, setShowForm] = useState(false);
  const [editTarget, setEditTarget] = useState<SheetConfig | null>(null);
  const [testResults, setTestResults] = useState<Record<number, TestResult>>({});
  const [testing, setTesting] = useState<Record<number, boolean>>({});
  const [syncing, setSyncing] = useState<Record<number, boolean>>({});

  const [form, setForm] = useState({
    company_id: "",
    label: "",
    sheet_id: "",
    tab_name: "Mutasi_Bank",
  });

  const { data: configsData, isLoading } = useQuery({
    queryKey: ["sheet-configs"],
    queryFn: () => fetch("/api/bank-reconciliation/sheet-configs", { credentials: "include" }).then(r => r.json()),
  });

  const { data: companiesData } = useQuery({
    queryKey: ["companies-list"],
    queryFn: () => fetch("/api/accounting/companies", { credentials: "include" }).then(r => r.json()),
  });

  const configs: SheetConfig[] = configsData?.configs ?? [];
  const companies: Company[] = Array.isArray(companiesData) ? companiesData : (companiesData?.companies ?? []);

  const openCreate = () => {
    setEditTarget(null);
    setForm({ company_id: "", label: "", sheet_id: "", tab_name: "Mutasi_Bank" });
    setShowForm(true);
  };

  const openEdit = (cfg: SheetConfig) => {
    setEditTarget(cfg);
    setForm({
      company_id: cfg.company_id ? String(cfg.company_id) : "",
      label: cfg.label,
      sheet_id: cfg.sheet_id,
      tab_name: cfg.tab_name,
    });
    setShowForm(true);
  };

  const saveConfig = async () => {
    if (!form.label || !form.sheet_id) {
      toast({ title: "Label dan Sheet ID wajib diisi", variant: "destructive" });
      return;
    }
    const body = {
      company_id: form.company_id ? Number(form.company_id) : null,
      label: form.label,
      sheet_id: form.sheet_id,
      tab_name: form.tab_name || "Mutasi_Bank",
    };
    const url  = editTarget
      ? `/api/bank-reconciliation/sheet-configs/${editTarget.id}`
      : "/api/bank-reconciliation/sheet-configs";
    const method = editTarget ? "PUT" : "POST";
    const r = await fetch(url, {
      method, credentials: "include",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    const data = await r.json();
    if (!r.ok) { toast({ title: data.error ?? "Gagal simpan", variant: "destructive" }); return; }
    toast({ title: editTarget ? "Config diperbarui" : "Config ditambahkan" });
    qc.invalidateQueries({ queryKey: ["sheet-configs"] });
    setShowForm(false);
  };

  const toggleActive = async (cfg: SheetConfig) => {
    await fetch(`/api/bank-reconciliation/sheet-configs/${cfg.id}`, {
      method: "PUT", credentials: "include",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ is_active: !cfg.is_active }),
    });
    qc.invalidateQueries({ queryKey: ["sheet-configs"] });
  };

  const deleteConfig = async (cfg: SheetConfig) => {
    if (!confirm(`Hapus config "${cfg.label}"?`)) return;
    await fetch(`/api/bank-reconciliation/sheet-configs/${cfg.id}`, {
      method: "DELETE", credentials: "include",
    });
    qc.invalidateQueries({ queryKey: ["sheet-configs"] });
    toast({ title: "Config dihapus" });
  };

  const testOne = async (cfg: SheetConfig) => {
    setTesting(prev => ({ ...prev, [cfg.id]: true }));
    try {
      const r = await fetch(`/api/bank-reconciliation/sheet-configs/${cfg.id}/test`, {
        method: "POST", credentials: "include",
      });
      const data = await r.json() as TestResult;
      setTestResults(prev => ({ ...prev, [cfg.id]: data }));
    } catch (e: any) {
      setTestResults(prev => ({ ...prev, [cfg.id]: { ok: false, error: e.message } }));
    } finally {
      setTesting(prev => ({ ...prev, [cfg.id]: false }));
    }
  };

  const syncOne = async (cfg: SheetConfig) => {
    setSyncing(prev => ({ ...prev, [cfg.id]: true }));
    try {
      const r = await fetch(`/api/bank-reconciliation/sheet-configs/${cfg.id}/sync`, {
        method: "POST", credentials: "include",
      });
      const data = await r.json();
      if (data.ok) {
        toast({ title: `${cfg.label}: ${data.message}` });
      } else {
        toast({ title: data.error ?? "Sync gagal", variant: "destructive" });
      }
      qc.invalidateQueries({ queryKey: ["sheet-configs"] });
    } catch (e: any) {
      toast({ title: e.message ?? "Sync gagal", variant: "destructive" });
    } finally {
      setSyncing(prev => ({ ...prev, [cfg.id]: false }));
    }
  };

  const fmtDate = (d: string | null) => {
    if (!d) return "—";
    const dt = new Date(d);
    if (isNaN(dt.getTime())) return d;
    return dt.toLocaleString("id-ID");
  };

  return (
    <Card>
      <CardHeader className="pb-3">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Settings2 className="w-4 h-4 text-muted-foreground" />
            <CardTitle className="text-base">Koneksi Google Sheet</CardTitle>
            <Badge variant="secondary">{configs.length} config</Badge>
          </div>
          <Button size="sm" onClick={openCreate} className="gap-1">
            <Plus className="w-3 h-3" /> Tambah Sheet
          </Button>
        </div>
        <p className="text-xs text-muted-foreground mt-1">
          Setiap perusahaan dapat memiliki Google Sheet sumber mutasi bank tersendiri.
          Auto-sync berjalan setiap menit.
        </p>
      </CardHeader>
      <CardContent className="pt-0">
        {isLoading && (
          <div className="flex items-center gap-2 text-sm text-muted-foreground py-4">
            <Loader2 className="w-4 h-4 animate-spin" /> Memuat...
          </div>
        )}

        {!isLoading && configs.length === 0 && (
          <div className="text-center py-8 text-muted-foreground">
            <Wifi className="w-8 h-8 mx-auto mb-2 opacity-40" />
            <p className="text-sm">Belum ada koneksi Google Sheet.</p>
            <p className="text-xs mt-1">Klik <strong>Tambah Sheet</strong> untuk menambahkan.</p>
          </div>
        )}

        {configs.length > 0 && (
          <div className="space-y-3">
            {configs.map(cfg => {
              const tr = testResults[cfg.id];
              return (
                <div key={cfg.id} className={`rounded-lg border p-3 space-y-2 ${cfg.is_active ? "bg-white" : "bg-muted/30 opacity-70"}`}>
                  {/* Header row */}
                  <div className="flex items-start justify-between gap-2 flex-wrap">
                    <div className="flex items-center gap-2 min-w-0">
                      <Building2 className="w-4 h-4 text-muted-foreground shrink-0" />
                      <div className="min-w-0">
                        <p className="font-medium text-sm leading-none">{cfg.label}</p>
                        {cfg.company_name && (
                          <p className="text-xs text-muted-foreground mt-0.5">{cfg.company_name}</p>
                        )}
                      </div>
                    </div>
                    <div className="flex items-center gap-1.5 shrink-0">
                      <Badge
                        variant={cfg.is_active ? "outline" : "secondary"}
                        className={cfg.is_active ? "border-green-300 text-green-700 bg-green-50 text-xs" : "text-xs"}
                      >
                        {cfg.is_active ? "Aktif" : "Nonaktif"}
                      </Badge>
                      {cfg.last_sync_status === "ok" && <CheckCircle2 className="w-3.5 h-3.5 text-green-500" />}
                      {cfg.last_sync_status === "error" && <AlertTriangle className="w-3.5 h-3.5 text-orange-500" />}
                    </div>
                  </div>

                  {/* Sheet info */}
                  <div className="text-xs text-muted-foreground flex flex-wrap gap-x-4 gap-y-0.5">
                    <span>Sheet: <code className="bg-muted px-1 rounded">{cfg.sheet_id.slice(0, 24)}…</code></span>
                    <span>Tab: <code className="bg-muted px-1 rounded">{cfg.tab_name}</code></span>
                    {cfg.last_synced_at && <span>Sync terakhir: {fmtDate(cfg.last_synced_at)}</span>}
                  </div>

                  {/* Error info */}
                  {cfg.last_sync_status === "error" && cfg.last_sync_error && (
                    <div className="text-xs text-orange-700 bg-orange-50 border border-orange-200 rounded px-2 py-1">
                      ⚠️ {cfg.last_sync_error.slice(0, 120)}
                    </div>
                  )}

                  {/* Test result */}
                  {tr && (
                    <div className={`text-xs rounded px-2 py-1 ${tr.ok ? "bg-green-50 border border-green-200 text-green-800" : "bg-red-50 border border-red-200 text-red-800"}`}>
                      {tr.ok ? (
                        <>✅ {tr.message}</>
                      ) : (
                        <div className="space-y-0.5">
                          <div className="flex items-start gap-1"><ShieldAlert className="w-3 h-3 mt-0.5 shrink-0" />{tr.error}</div>
                          {tr.hint && <div className="ml-4">💡 {tr.hint}</div>}
                        </div>
                      )}
                    </div>
                  )}

                  {/* Actions */}
                  <div className="flex items-center gap-1.5 flex-wrap pt-0.5">
                    <Button
                      size="sm" variant="outline" className="h-7 text-xs gap-1"
                      onClick={() => testOne(cfg)} disabled={testing[cfg.id]}
                    >
                      {testing[cfg.id] ? <Loader2 className="w-3 h-3 animate-spin" /> : <Wifi className="w-3 h-3" />}
                      Test
                    </Button>
                    <Button
                      size="sm" variant="outline" className="h-7 text-xs gap-1"
                      onClick={() => syncOne(cfg)} disabled={syncing[cfg.id] || !cfg.is_active}
                    >
                      {syncing[cfg.id] ? <Loader2 className="w-3 h-3 animate-spin" /> : <RefreshCw className="w-3 h-3" />}
                      Sync Sekarang
                    </Button>
                    <Button
                      size="sm" variant="ghost" className="h-7 text-xs"
                      onClick={() => openEdit(cfg)}
                    >
                      Edit
                    </Button>
                    <Button
                      size="sm" variant="ghost" className="h-7 text-xs"
                      onClick={() => toggleActive(cfg)}
                    >
                      {cfg.is_active ? "Nonaktifkan" : "Aktifkan"}
                    </Button>
                    <Button
                      size="sm" variant="ghost" className="h-7 text-xs text-red-600 hover:text-red-700"
                      onClick={() => deleteConfig(cfg)}
                    >
                      <Trash2 className="w-3 h-3" />
                    </Button>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </CardContent>

      {/* Form dialog */}
      <Dialog open={showForm} onOpenChange={setShowForm}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>{editTarget ? "Edit Config Sheet" : "Tambah Koneksi Google Sheet"}</DialogTitle>
          </DialogHeader>
          <div className="space-y-4 py-2">
            <div className="space-y-1.5">
              <label className="text-sm font-medium">Perusahaan</label>
              <Select
                value={form.company_id || "none"}
                onValueChange={v => setForm(f => ({ ...f, company_id: v === "none" ? "" : v }))}
              >
                <SelectTrigger>
                  <SelectValue placeholder="Pilih perusahaan (opsional)" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="none">— Semua / Global —</SelectItem>
                  {companies.map(c => (
                    <SelectItem key={c.id} value={String(c.id)}>{c.companyName}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <p className="text-xs text-muted-foreground">Mutasi dari sheet ini akan ditag dengan perusahaan yang dipilih.</p>
            </div>
            <div className="space-y-1.5">
              <label className="text-sm font-medium">Label <span className="text-red-500">*</span></label>
              <Input
                placeholder="Contoh: CST Group - BCA Operasional"
                value={form.label}
                onChange={e => setForm(f => ({ ...f, label: e.target.value }))}
              />
            </div>
            <div className="space-y-1.5">
              <label className="text-sm font-medium">Google Sheet ID <span className="text-red-500">*</span></label>
              <Input
                placeholder="1VcbUujz6WHRgj5Fa1QkWja..."
                value={form.sheet_id}
                onChange={e => setForm(f => ({ ...f, sheet_id: e.target.value }))}
              />
              <p className="text-xs text-muted-foreground">
                Dari URL: docs.google.com/spreadsheets/d/<strong>[ID INI]</strong>/edit
              </p>
            </div>
            <div className="space-y-1.5">
              <label className="text-sm font-medium">Nama Tab</label>
              <Input
                placeholder="Mutasi_Bank"
                value={form.tab_name}
                onChange={e => setForm(f => ({ ...f, tab_name: e.target.value }))}
              />
              <p className="text-xs text-muted-foreground">Nama tab di Google Sheet yang berisi data mutasi. Default: Mutasi_Bank</p>
            </div>
            <div className="rounded-md bg-blue-50 border border-blue-200 p-3 text-xs text-blue-800 space-y-1">
              <p className="font-medium">Pastikan sheet sudah di-share ke Service Account:</p>
              <p>Buka spreadsheet → Share → Tambahkan email SA (<code className="bg-blue-100 px-1 rounded">GOOGLE_SERVICE_ACCOUNT_JSON</code>) → Editor.</p>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowForm(false)}>Batal</Button>
            <Button onClick={saveConfig}>{editTarget ? "Simpan Perubahan" : "Tambahkan"}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </Card>
  );
}

type MutationStatus =
  | "unmatched"
  | "matched"
  | "duplicate_need_review"
  | "approved_pending_posting"
  | "approved"
  | "posted"
  | "rejected"
  | "void";

interface Candidate {
  id: number;
  mutation_id: number;
  candidate_type: string;
  candidate_id: number;
  candidate_source?: string | null;
  match_score: number;
  match_reason: string;
  amount_match: boolean;
  date_match: boolean;
  name_match: boolean;
  order_id_match: boolean;
  proof_match: boolean;
  status: string;
  customer_name?: string | null;
  details?: CandidateDetails | null;
}

interface CandidateDetails {
  amount?: number | string | null;
  date?: string | null;
  name?: string | null;
  reference?: string | null;
  paymentNumber?: string | null;
  memo?: string | null;
  method?: string | null;
  status?: string | null;
  paymentType?: string | null;
  sourceType?: string | null;
  bookingId?: number | null;
  documentType?: string | null;
  grossAmount?: number | string | null;
  mdrAmount?: number | string | null;
  taxWithheldAmount?: number | string | null;
  otherFeeAmount?: number | string | null;
  netAmount?: number | string | null;
  settlementDate?: string | null;
  settlementReference?: string | null;
  settlementStatus?: string | null;
  settlementPartial?: boolean;
  settlementItemCount?: number | null;
  expectedAmount?: number | string | null;
  actualBankAmount?: number | string | null;
  amountDifference?: number | string | null;
  varianceAmount?: number | string | null;
  variancePercent?: number | string | null;
  varianceStatus?: string | null;
  varianceReason?: string | null;
  settlementRuleVersion?: string | null;
  settlementItems?: Array<{
    id?: number;
    sportPaymentId?: number;
    paymentNumber?: string | null;
    bookingId?: number | null;
    grossAmount?: number | string | null;
    mdrAmount?: number | string | null;
    taxWithheldAmount?: number | string | null;
    otherFeeAmount?: number | string | null;
    netAmount?: number | string | null;
  }>;
}

interface JournalLine {
  id: number;
  accountId: number;
  accountCode?: string;
  accountName?: string;
  debit: string;
  credit: string;
  description?: string | null;
}

interface BankMutation {
  id: number;
  company_id: number | null;
  transaction_date: string;
  description: string;
  credit_amount: string;
  debit_amount: string;
  amount: string;
  direction: "IN" | "OUT";
  mutation_key: string;
  normalized_description: string;
  provider_name: string | null;
  provider_order_id: string | null;
  status: MutationStatus;
  matched_payment_id: number | null;
  matched_order_id: number | null;
  candidates: Candidate[] | null;
  /** Provider-aware QRIS candidate. Audit-only; never used by approve/post. */
  qris_candidate_audit?: QrisCandidateAudit | null;
  uploaded_proof_url?: string | null;
  source?: string;
  import_batch_id?: number | null;
  reconciliation_status?: string | null;
  linked_transaction_type?: string | null;
  linked_transaction_id?: number | null;
  journal_entry_id?: number | null;
  posted_at?: string | null;
  posted_by?: string | null;
}

const CANONICAL_SETTLEMENT_SOURCE = "sport_center.payment_settlement_batches";

interface QrisCandidateAudit {
  id?: number;
  mutation_id: number;
  company_id?: number | null;
  provider_code: string;
  mutation_source_classification: string;
  source_date: string;
  estimated_settlement_date: string;
  gross_amount: number | string;
  net_amount: number | string;
  observed_deduction: number | string;
  effective_deduction_rate: number | string | null;
  reconciliation_status: string;
  confidence: number | string;
  review_reason?: string | null;
  payment_items?: QrisPaymentItem[];
  description?: string | null;
  status?: string | null;
}

interface QrisPaymentItem {
  paymentId?: number;
  payment_id?: number;
  grossAmount?: number | string | null;
  gross_amount?: number | string | null;
  expectedSettlementDate?: string | null;
  settlementRuleVersion?: string | null;
  bookingNumber?: string | null;
  paymentNumber?: string | null;
  paymentDate?: string | null;
  payment_number?: string | null;
  booking_id?: number | null;
  booking_number?: string | null;
  paid_at?: string | null;
}

// ─────────────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────────────

const idr = (n: number | string) =>
  "Rp " + new Intl.NumberFormat("id-ID").format(Number(n) || 0);

const fmtDate = (d: string) => {
  if (!d) return "-";
  try { return new Date(d).toLocaleDateString("id-ID", { day: "numeric", month: "short", year: "numeric" }); } catch { return d; }
};

const fmtDateTime = (d: string | null) => {
  if (!d) return "—";
  try { return new Date(d).toLocaleString("id-ID"); } catch { return d; }
};

const CANDIDATE_TYPE_LABELS: Record<string, string> = {
  accounting_payment: "Pembayaran",
  logistic_order: "Logistik",
  invoice: "Invoice",
  expense: "Expense",
  sport_payment: "Sport",
  qris_settlement: "QRIS Settlement",
  tenant_invoice: "Tenant Invoice",
  vendor_payment: "Vendor Payment",
  kasbon: "Kasbon",
  talangan: "Dana Talangan",
  transfer: "Transfer Internal",
};

// Backend status → Indonesian UI label mapping
// SOURCE: bank_mutations.status values from bankReconciliation.ts routes
const STATUS_LABELS: Record<string, string> = {
  unmatched:               "Belum Dicocokkan",
  matched:                 "Kandidat Ditemukan",
  duplicate_need_review:   "Perlu Review",
  approved_pending_posting:"Menunggu Posting",
  approved:                "Disetujui",
  posted:                  "Sudah Diposting",
  rejected:                "Ditolak",
  void:                    "Dibatalkan",
};

const STATUS_COLORS: Record<string, string> = {
  unmatched:               "bg-amber-50 text-amber-700 border-amber-200 dark:bg-amber-950/30 dark:text-amber-400",
  matched:                 "bg-blue-50 text-blue-700 border-blue-200 dark:bg-blue-950/30 dark:text-blue-400",
  duplicate_need_review:   "bg-orange-50 text-orange-700 border-orange-200 dark:bg-orange-950/30 dark:text-orange-400",
  approved_pending_posting:"bg-yellow-50 text-yellow-700 border-yellow-200 dark:bg-yellow-950/30 dark:text-yellow-400",
  approved:                "bg-green-50 text-green-700 border-green-200 dark:bg-green-950/30 dark:text-green-400",
  posted:                  "bg-green-50 text-green-700 border-green-200 dark:bg-green-950/30 dark:text-green-400",
  rejected:                "bg-red-50 text-red-600 border-red-200 dark:bg-red-950/30 dark:text-red-400",
  void:                    "bg-gray-100 text-gray-500 border-gray-200 dark:bg-gray-900/30 dark:text-gray-400",
};

const QRIS_AUDIT_STATUS_LABELS: Record<string, string> = {
  MATCHED: "Ada kecocokan",
  REVIEW: "Perlu verifikasi",
  UNMATCHED: "Belum cocok",
};

const CARD_BORDER: Record<string, string> = {
  unmatched:               "border-l-4 border-l-amber-400",
  matched:                 "border-l-4 border-l-blue-400",
  duplicate_need_review:   "border-l-4 border-l-orange-400",
  approved_pending_posting:"border-l-4 border-l-yellow-400",
  approved:                "border-l-4 border-l-green-400",
  posted:                  "border-l-4 border-l-green-400",
  rejected:                "border-l-4 border-l-red-400",
  void:                    "border-l-4 border-l-gray-300",
};

// ─────────────────────────────────────────────────────────────────────────────
// Action Guards  — explicit per-action helpers, no single canAct
// ─────────────────────────────────────────────────────────────────────────────

/** Approve → draft journal. Only valid before posting. */
const canApprove = (m: BankMutation) =>
  m.status === "unmatched" || m.status === "matched" || m.status === "duplicate_need_review";

/** Post ke Accounting → promotes draft journal to posted. */
const canPost = (m: BankMutation) =>
  m.status === "approved_pending_posting" &&
  !m.candidates?.some(c => c.candidate_source === CANONICAL_SETTLEMENT_SOURCE);

/** Reject → hanya sebelum posted. */
const canReject = (m: BankMutation) =>
  m.status === "unmatched" || m.status === "matched" ||
  m.status === "duplicate_need_review" || m.status === "approved_pending_posting";

/** Reverse/Void → hanya setelah posted. */
const canReverse = (m: BankMutation) =>
  m.status === "posted";

/** Reopen → hanya setelah di-void, untuk matching ulang. */
const canReopen = (m: BankMutation) =>
  m.status === "void";

/** Delete → jangan hapus yang sudah posted. */
const canDelete = (m: BankMutation) =>
  m.status !== "posted" && m.source !== "bank_import";

function isCanonicalSettlementMutation(m: BankMutation): boolean {
  return m.candidates?.some(
    c => c.candidate_type === "qris_settlement" &&
      c.candidate_source === CANONICAL_SETTLEMENT_SOURCE,
  ) ?? false;
}

function statusLabel(m: BankMutation): string {
  if (m.status === "approved" && isCanonicalSettlementMutation(m)) {
    return "Approved / Reconciled";
  }
  return STATUS_LABELS[m.status] ?? m.status;
}

function statusColor(m: BankMutation): string {
  return STATUS_COLORS[m.status] ?? "";
}

// ─────────────────────────────────────────────────────────────────────────────
// ScoreBadge
// ─────────────────────────────────────────────────────────────────────────────

function ScoreBadge({ score }: { score: number }) {
  const color =
    score >= 95 ? "bg-green-500" :
    score >= 80 ? "bg-blue-500" :
    score >= 60 ? "bg-amber-500" :
    "bg-red-400";
  return (
    <span className={`inline-flex items-center px-1.5 py-0.5 rounded text-white text-xs font-bold ${color}`}>
      {score}%
    </span>
  );
}

function CandidateDetailsBlock({
  candidate,
  compact = false,
}: {
  candidate: Candidate;
  compact?: boolean;
}) {
  const d = candidate.details;
  if (!d) return null;
  const isCanonicalSettlement =
    candidate.candidate_type === "qris_settlement" &&
    candidate.candidate_source === CANONICAL_SETTLEMENT_SOURCE;
  const hasVarianceEvidence =
    isCanonicalSettlement &&
    d.expectedAmount != null &&
    d.actualBankAmount != null &&
    Math.abs(Number(d.varianceAmount ?? 0)) >= 0.01;

  const rows = [
    { label: "Nominal", value: d.amount != null ? idr(d.amount) : null },
    { label: "Gross payment", value: d.grossAmount != null ? idr(d.grossAmount) : null },
    { label: "MDR", value: d.mdrAmount != null ? idr(d.mdrAmount) : null },
    { label: "Pajak provider", value: d.taxWithheldAmount != null ? idr(d.taxWithheldAmount) : null },
    { label: "Potongan provider lain", value: d.otherFeeAmount != null ? idr(d.otherFeeAmount) : null },
    { label: "Net settlement", value: d.netAmount != null ? idr(d.netAmount) : null },
    { label: "Tanggal", value: d.date ? fmtDate(String(d.date)) : null },
    { label: "Tanggal settlement", value: d.settlementDate ? fmtDate(String(d.settlementDate)) : null },
    { label: "Status settlement", value: d.settlementStatus },
    { label: "Nama / Partner", value: d.name },
    { label: "No. Pembayaran", value: d.paymentNumber },
    { label: "Referensi", value: d.reference },
    { label: "Referensi settlement", value: d.settlementReference },
    { label: "Jumlah transaksi settlement", value: d.settlementItemCount },
    { label: "Metode", value: d.method },
    { label: "Tipe", value: d.paymentType ?? d.documentType },
    { label: "Status", value: d.status },
    { label: "Memo / Catatan", value: d.memo },
  ].filter(row => row.value != null && String(row.value).trim() !== "");

  if (rows.length === 0) return null;

  return (
    <div className={`rounded-md bg-muted/35 border border-dashed space-y-1 ${compact ? "p-2 mt-1.5" : "p-2.5 mt-2"}`}>
      <p className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
        Detail transaksi sumber
      </p>
      {d.settlementPartial && (
        <p className="text-[10px] font-medium text-amber-700 bg-amber-50 border border-amber-200 rounded px-2 py-1">
          Settlement QRIS PARTIAL — hanya sebagian dana/provider batch yang sudah tersettle; perlu review sebelum dianggap lunas.
        </p>
      )}
      {hasVarianceEvidence && (
        <div className="rounded-md border border-amber-300 bg-amber-50 px-2.5 py-2 text-[11px] text-amber-950 dark:border-amber-800 dark:bg-amber-950/30 dark:text-amber-100">
          <div className="flex items-center justify-between gap-2">
            <p className="font-semibold">Variance settlement QRIS</p>
            <Badge variant="outline" className="border-amber-400 bg-amber-100 text-amber-900 dark:border-amber-700 dark:bg-amber-950/50 dark:text-amber-200">
              Perlu Review
            </Badge>
          </div>
          <div className="mt-1 grid grid-cols-1 gap-0.5 sm:grid-cols-2">
            <span>Expected Settlement: <b>{idr(d.expectedAmount ?? 0)}</b></span>
            <span>Mutasi Bank: <b>{idr(d.actualBankAmount ?? 0)}</b></span>
            <span>Selisih: <b>{Number(d.varianceAmount) >= 0 ? "+" : ""}{idr(d.varianceAmount ?? 0)}</b></span>
            <span>Variance: <b>{Number(d.variancePercent ?? 0).toFixed(2)}%</b></span>
          </div>
          <p className="mt-1 text-[10px]">
            Status: <b>need_review</b> · reason: <b>amount_variance</b>
            {d.settlementRuleVersion ? <> · rule {d.settlementRuleVersion}</> : null}
          </p>
          <p className="mt-1 text-[10px] text-amber-800 dark:text-amber-200">
            Kandidat ini tidak auto-match dan tidak auto-approve.
          </p>
        </div>
      )}
      {d.settlementItems && d.settlementItems.length > 0 && (
        <div className="border-t pt-1.5 mt-1.5 space-y-1.5">
          <p className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
            Rincian payment settlement
          </p>
          <div className="space-y-1">
            {d.settlementItems.map((item, index) => (
              <div
                key={item.id ?? item.sportPaymentId ?? index}
                className="rounded border bg-background/70 px-2 py-1.5 text-[10px]"
              >
                <div className="flex items-center justify-between gap-2">
                  <span className="font-medium">
                    {item.paymentNumber ?? `Payment #${item.sportPaymentId ?? "—"}`}
                  </span>
                  {item.bookingId != null && (
                    <span className="text-muted-foreground">Booking #{item.bookingId}</span>
                  )}
                </div>
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-x-2 gap-y-0.5 mt-1 text-muted-foreground">
                  <span>Gross: <b className="text-foreground">{item.grossAmount != null ? idr(item.grossAmount) : "—"}</b></span>
                  <span>MDR: <b className="text-foreground">{item.mdrAmount != null ? idr(item.mdrAmount) : "—"}</b></span>
                  <span>Pajak/fee: <b className="text-foreground">
                    {idr(Number(item.taxWithheldAmount ?? 0) + Number(item.otherFeeAmount ?? 0))}
                  </b></span>
                  <span>Net: <b className="text-foreground">{item.netAmount != null ? idr(item.netAmount) : "—"}</b></span>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
      <div className={`grid ${compact ? "grid-cols-1" : "grid-cols-[auto_1fr]"} gap-x-3 gap-y-1`}>
        {rows.map(row => (
          <React.Fragment key={row.label}>
            <span className="text-[10px] text-muted-foreground">{row.label}</span>
            <span className={`text-xs font-medium ${compact ? "" : "text-right"} break-words`}>
              {String(row.value)}
            </span>
          </React.Fragment>
        ))}
      </div>
    </div>
  );
}

function QrisPaymentItemsSummary({
  items,
  compact = false,
}: {
  items?: QrisPaymentItem[];
  compact?: boolean;
}) {
  const [open, setOpen] = useState(false);
  if (!items?.length) return null;

  const visibleItems = open ? items : items.slice(0, 4);
  const remainingCount = items.length - visibleItems.length;
  const hasBookingDetails = items.some(item => item.bookingNumber || item.paymentNumber || item.paymentDate);

  return (
    <Collapsible open={open} onOpenChange={setOpen} className={compact ? "mt-1.5" : "mt-2"}>
      <CollapsibleTrigger asChild>
        <button
          type="button"
          className="flex w-full items-center justify-between gap-2 rounded border border-amber-200 bg-amber-100/70 px-2 py-1.5 text-left text-[11px] font-medium text-amber-950 transition-colors hover:bg-amber-100 dark:border-amber-800 dark:bg-amber-950/40 dark:text-amber-100"
          onClick={event => event.stopPropagation()}
          onKeyDown={event => event.stopPropagation()}
          aria-label={`${open ? "Sembunyikan" : "Lihat"} daftar booking QRIS`}
        >
          <span>
            {open ? "Sembunyikan detail booking" : `Lihat ${items.length} booking / payment`}
          </span>
          {open ? <ChevronUp className="h-3.5 w-3.5 shrink-0" /> : <ChevronDown className="h-3.5 w-3.5 shrink-0" />}
        </button>
      </CollapsibleTrigger>
      <CollapsibleContent onClick={event => event.stopPropagation()}>
        <div className="mt-1 space-y-1 rounded border border-amber-200/80 bg-background/70 p-1.5 dark:border-amber-800/70">
          {!hasBookingDetails && (
            <p className="px-1 text-[10px] text-muted-foreground">
              Metadata booking belum tersedia
            </p>
          )}
          {visibleItems.map((item, index) => (
            <div key={`${item.paymentId ?? item.payment_id ?? "payment"}-${index}`} className="rounded bg-muted/40 px-1.5 py-1 text-[10px]">
              <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5">
                <span className="font-semibold">
                  Booking: {item.bookingNumber ?? item.booking_number ?? "—"}
                </span>
                <span className="text-muted-foreground">
                  Payment: {item.paymentNumber ?? item.payment_number ?? `#${item.paymentId ?? item.payment_id ?? "—"}`}
                </span>
              </div>
              {(item.paymentDate ?? item.paid_at) && (
                <span className="text-muted-foreground">
                  Dibayar {fmtDate(String(item.paymentDate ?? item.paid_at))}
                </span>
              )}
            </div>
          ))}
          {remainingCount > 0 && (
            <p className="px-1 pt-0.5 text-[10px] text-muted-foreground">
              +{remainingCount} booking/payment lainnya
            </p>
          )}
        </div>
      </CollapsibleContent>
    </Collapsible>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// JournalEntryLines — fetches real journal entry lines when entry ID is known
// ─────────────────────────────────────────────────────────────────────────────

function JournalEntryLines({ entryId, onStatusLoaded }: { entryId: number; onStatusLoaded?: (status: string) => void }) {
  const { data, isLoading, error } = useQuery({
    queryKey: ["accounting-entry", entryId],
    queryFn: async () => {
      const r = await fetch(`/api/accounting/entries/${entryId}`, { credentials: "include" });
      if (!r.ok) throw new Error(await r.text());
      return r.json() as Promise<{ status: string; ref?: string; totalDebit: string; totalCredit: string; lines: JournalLine[] }>;
    },
    staleTime: 0,
  });

  React.useEffect(() => {
    if (data?.status) onStatusLoaded?.(data.status);
  }, [data?.status]); // eslint-disable-line react-hooks/exhaustive-deps

  if (isLoading) return <p className="text-xs text-muted-foreground animate-pulse">Memuat journal entry…</p>;
  if (error || !data) return <p className="text-xs text-red-500">Gagal memuat journal entry</p>;

  const balance = Math.abs(Number(data.totalDebit) - Number(data.totalCredit));
  const balanced = balance < 0.01;

  return (
    <div className="rounded-lg border bg-muted/40 p-3 space-y-2 text-sm">
      <div className="flex items-center justify-between">
        <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">Journal Entry #{entryId}</p>
        <span className={`text-[10px] px-2 py-0.5 rounded-full border font-medium ${
          data.status === "posted" ? "bg-green-50 text-green-700 border-green-200" : "bg-yellow-50 text-yellow-700 border-yellow-200"
        }`}>{data.status === "posted" ? "POSTED" : "DRAFT"}</span>
      </div>
      {data.lines.length === 0 ? (
        <p className="text-xs text-muted-foreground text-center py-2">Tidak ada baris jurnal</p>
      ) : (
        <div className="space-y-1">
          <div className="grid grid-cols-[1fr_auto_auto] gap-x-3 text-[10px] font-semibold text-muted-foreground uppercase pb-1 border-b">
            <span>Akun</span><span className="text-right">Debit</span><span className="text-right">Kredit</span>
          </div>
          {data.lines.map((l, i) => (
            <div key={l.id ?? i} className="grid grid-cols-[1fr_auto_auto] gap-x-3 text-xs">
              <span className="truncate font-medium">
                {l.accountName ?? l.accountCode ?? `Akun #${l.accountId}`}
                {l.description && <span className="text-muted-foreground ml-1 text-[10px]">({l.description})</span>}
              </span>
              <span className="font-mono text-right tabular-nums">
                {Number(l.debit) > 0 ? idr(l.debit) : "—"}
              </span>
              <span className="font-mono text-right tabular-nums">
                {Number(l.credit) > 0 ? idr(l.credit) : "—"}
              </span>
            </div>
          ))}
          <div className="grid grid-cols-[1fr_auto_auto] gap-x-3 text-xs font-bold border-t pt-1 mt-1">
            <span>Total</span>
            <span className="font-mono text-right tabular-nums">{idr(data.totalDebit)}</span>
            <span className="font-mono text-right tabular-nums">{idr(data.totalCredit)}</span>
          </div>
          {!balanced && (
            <p className="text-[10px] text-red-600 flex items-center gap-1 pt-0.5">
              <AlertTriangle className="w-3 h-3" /> Journal tidak balance (selisih {idr(balance)})
            </p>
          )}
        </div>
      )}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// JournalPreview
//   Phase 4: no more hardcoded IN=DebitBank/OUT=DebitExpense
//   Priority: journalEntryId (real) > candidate (estimated) > placeholder
// ─────────────────────────────────────────────────────────────────────────────

function JournalPreview({
  mutation,
  candidate,
  journalEntryId,
}: {
  mutation: BankMutation;
  candidate?: Candidate;
  journalEntryId?: number | null;
}) {
  // Case 1: real journal entry exists → show actual lines
  if (journalEntryId) {
    return <JournalEntryLines entryId={journalEntryId} />;
  }

  // Case 2: candidate from matching API → show candidate-based estimate
  if (candidate) {
    const t = candidate.candidate_type;
    const isIN = mutation.direction === "IN";
    const amt = idr(mutation.amount);

    // Mapping derived from candidate_type (from matching engine, not raw IN/OUT)
    let debitLabel = "—";
    let creditLabel = "—";

    if (isIN) {
      debitLabel = "Rekening Bank";
      creditLabel =
        t === "invoice"            ? "Piutang Usaha" :
        t === "accounting_payment" ? "Piutang / Pendapatan" :
        t === "kasbon"             ? "Kasbon Karyawan" :
        t === "talangan"           ? "Dana Talangan" :
        t === "sport_payment"      ? "Pendapatan Sport" :
        t === "tenant_invoice"     ? "Piutang Tenant" : "Pendapatan";
    } else {
      debitLabel =
        t === "expense"        ? "Beban Operasional" :
        t === "vendor_payment" ? "Hutang Usaha" :
        t === "kasbon"         ? "Kasbon Karyawan" :
        t === "talangan"       ? "Dana Talangan" :
        t === "logistic_order" ? "Beban Logistik" : "Beban / Hutang";
      creditLabel = "Rekening Bank";
    }

    return (
      <div className="rounded-lg border bg-muted/40 p-3 space-y-2 text-sm">
        <div className="flex items-center justify-between">
          <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">Estimasi Journal Entry</p>
          <span className="text-[10px] text-amber-600 bg-amber-50 border border-amber-200 px-2 py-0.5 rounded-full">Estimasi</span>
        </div>
        <div className="space-y-1">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <span className="w-14 text-xs font-bold text-green-700">DEBIT</span>
              <span className="font-medium">{debitLabel}</span>
            </div>
            <span className="font-mono text-xs tabular-nums">{amt}</span>
          </div>
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <span className="w-14 text-xs font-bold text-red-600">KREDIT</span>
              <span className="font-medium text-muted-foreground ml-3">{creditLabel}</span>
            </div>
            <span className="font-mono text-xs tabular-nums">{amt}</span>
          </div>
        </div>
        <p className="text-[10px] text-muted-foreground border-t pt-1.5">
          Berdasarkan kandidat: {CANDIDATE_TYPE_LABELS[t] ?? t} #{candidate.candidate_id}
          {candidate.match_reason && <> · {candidate.match_reason}</>}
        </p>
        <p className="text-[10px] text-amber-600">
          ⚠ Estimasi — akun COA final ditentukan saat approve
        </p>
      </div>
    );
  }

  // Case 3: nothing available
  return (
    <div className="rounded-lg border border-dashed bg-muted/20 p-4 text-center text-sm text-muted-foreground">
      <FileText className="w-6 h-6 mx-auto mb-2 opacity-40" />
      Preview jurnal belum tersedia. Pilih kandidat atau akun COA terlebih dahulu.
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Step Progress Bar
// ─────────────────────────────────────────────────────────────────────────────

const STEPS = [
  { id: 1, label: "Sync Mutasi",        icon: CloudDownload },
  { id: 2, label: "AI Matching",         icon: Zap },
  { id: 3, label: "Review",             icon: Eye },
  { id: 4, label: "Approve",            icon: CheckCircle2 },
  { id: 5, label: "Posting Accounting", icon: ReceiptText },
  { id: 6, label: "Selesai",            icon: CircleCheck },
];

function StepProgressBar({ summaryMap }: { summaryMap: Record<string, { count: number; amount: number }> }) {
  const totalMutations =
    (summaryMap.unmatched?.count ?? 0) +
    (summaryMap.matched?.count ?? 0) +
    (summaryMap.duplicate_need_review?.count ?? 0) +
    (summaryMap.approved_pending_posting?.count ?? 0) +
    (summaryMap.posted?.count ?? 0) +
    (summaryMap.rejected?.count ?? 0) +
    (summaryMap.void?.count ?? 0);

  const hasAny     = totalMutations > 0;
  const hasMatched = (summaryMap.matched?.count ?? 0) + (summaryMap.approved_pending_posting?.count ?? 0) + (summaryMap.posted?.count ?? 0) > 0;
  const hasReviewNeeded = (summaryMap.duplicate_need_review?.count ?? 0) > 0;
  const hasPendingPost  = (summaryMap.approved_pending_posting?.count ?? 0) > 0;
  const hasPosted       = (summaryMap.posted?.count ?? 0) > 0;
  const allProcessed    = hasAny &&
    (summaryMap.unmatched?.count ?? 0) === 0 &&
    (summaryMap.matched?.count ?? 0) === 0 &&
    (summaryMap.approved_pending_posting?.count ?? 0) === 0;

  const activeStep =
    !hasAny          ? 1 :
    !hasMatched      ? 2 :
    hasReviewNeeded  ? 3 :
    !hasPendingPost && !hasPosted ? 3 :
    hasPendingPost   ? 5 :
    allProcessed     ? 6 : 5;

  return (
    <Card className="overflow-hidden">
      <CardContent className="p-4">
        <div className="flex items-center gap-0 overflow-x-auto">
          {STEPS.map((step, i) => {
            const done   = step.id < activeStep;
            const active = step.id === activeStep;
            const Icon   = step.icon;
            return (
              <div key={step.id} className="flex items-center flex-1 min-w-[80px]">
                <div className="flex flex-col items-center gap-1 flex-1">
                  <div className={`flex items-center justify-center w-8 h-8 rounded-full border-2 transition-all ${
                    done   ? "bg-green-500 border-green-500 text-white" :
                    active ? "bg-primary border-primary text-primary-foreground shadow-md" :
                             "bg-muted border-muted-foreground/20 text-muted-foreground"
                  }`}>
                    {done ? <CheckCircle2 className="w-4 h-4" /> : <Icon className="w-4 h-4" />}
                  </div>
                  <span className={`text-[10px] font-medium text-center leading-tight ${
                    done   ? "text-green-600 dark:text-green-400" :
                    active ? "text-primary font-semibold" :
                             "text-muted-foreground"
                  }`}>{step.label}</span>
                </div>
                {i < STEPS.length - 1 && (
                  <div className={`h-0.5 flex-1 mx-1 rounded-full transition-all ${
                    step.id < activeStep ? "bg-green-400" : "bg-muted"
                  }`} />
                )}
              </div>
            );
          })}
        </div>
      </CardContent>
    </Card>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Summary Cards
// ─────────────────────────────────────────────────────────────────────────────

function SummaryCards({
  summaryMap,
  activeFilter,
  onFilter,
}: {
  summaryMap: Record<string, { count: number; amount: number }>;
  activeFilter: string;
  onFilter: (k: string) => void;
}) {
  const cards = [
    {
      key: "unmatched",
      icon: AlertTriangle,
      label: "Belum Dicocokkan",
      count: summaryMap.unmatched?.count ?? 0,
      iconClass: "text-amber-500",
      bg: "hover:bg-amber-50 dark:hover:bg-amber-950/20",
    },
    {
      key: "matched",
      icon: CircleDot,
      label: "Kandidat Ditemukan",
      count: summaryMap.matched?.count ?? 0,
      iconClass: "text-blue-500",
      bg: "hover:bg-blue-50 dark:hover:bg-blue-950/20",
    },
    {
      key: "approved_pending_posting",
      icon: Clock,
      label: "Menunggu Posting",
      count: summaryMap.approved_pending_posting?.count ?? 0,
      iconClass: "text-yellow-500",
      bg: "hover:bg-yellow-50 dark:hover:bg-yellow-950/20",
    },
    {
      key: "posted",
      icon: CheckCircle2,
      label: "Sudah Diposting",
      count: summaryMap.posted?.count ?? 0,
      iconClass: "text-green-500",
      bg: "hover:bg-green-50 dark:hover:bg-green-950/20",
    },
    {
      key: "_total_value",
      icon: TrendingUp,
      label: "Total Nilai Mutasi",
      count: null,
      amount:
        (summaryMap.unmatched?.amount ?? 0) +
        (summaryMap.matched?.amount ?? 0) +
        (summaryMap.approved_pending_posting?.amount ?? 0) +
        (summaryMap.posted?.amount ?? 0),
      iconClass: "text-purple-500",
      bg: "hover:bg-purple-50 dark:hover:bg-purple-950/20",
    },
  ];

  return (
    <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-3">
      {cards.map(({ key, icon: Icon, label, count, amount, iconClass, bg }) => (
        <Card
          key={key}
          className={`cursor-pointer transition-all hover:shadow-md ${bg} ${
            activeFilter === key ? "ring-2 ring-primary shadow-md" : ""
          }`}
          onClick={() => key !== "_total_value" && onFilter(activeFilter === key ? "all" : key)}
          tabIndex={key !== "_total_value" ? 0 : undefined}
          role={key !== "_total_value" ? "button" : undefined}
          onKeyDown={e => key !== "_total_value" && e.key === "Enter" && onFilter(activeFilter === key ? "all" : key)}
        >
          <CardContent className="p-4">
            <div className="flex items-center gap-2 mb-2">
              <Icon className={`w-4 h-4 ${iconClass}`} aria-hidden="true" />
              <span className="text-xs text-muted-foreground leading-tight">{label}</span>
            </div>
            {count !== null ? (
              <div className="text-2xl font-bold tabular-nums">{count}</div>
            ) : (
              <div className="text-base font-bold tabular-nums leading-tight">
                {idr(amount ?? 0)}
              </div>
            )}
            {count !== null && (
              <p className="text-xs text-muted-foreground mt-0.5">transaksi</p>
            )}
          </CardContent>
        </Card>
      ))}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// AI Action Center
// ─────────────────────────────────────────────────────────────────────────────

function AIActionCenter({
  summaryMap,
  onRunMatching,
  onApproveAll,
  onPostAll,
  onSyncSheet,
  matchingPending,
  syncPending,
}: {
  summaryMap: Record<string, { count: number; amount: number }>;
  onRunMatching: () => void;
  onApproveAll: () => void;
  onPostAll: () => void;
  onSyncSheet: () => void;
  matchingPending: boolean;
  syncPending: boolean;
}) {
  const unmatched     = summaryMap.unmatched?.count ?? 0;
  const matched       = summaryMap.matched?.count ?? 0;
  const needReview    = summaryMap.duplicate_need_review?.count ?? 0;
  const pendingPost   = summaryMap.approved_pending_posting?.count ?? 0;

  if (unmatched === 0 && matched === 0 && needReview === 0 && pendingPost === 0) {
    return (
      <Card className="border-green-200 bg-green-50/50 dark:bg-green-950/20 dark:border-green-800">
        <CardContent className="p-4 flex items-center gap-3">
          <CheckCircle2 className="w-8 h-8 text-green-500 shrink-0" />
          <div>
            <p className="font-semibold text-green-800 dark:text-green-300">Semua mutasi sudah diproses! 🎉</p>
            <p className="text-sm text-green-600 dark:text-green-400">Tidak ada pekerjaan yang perlu dilakukan saat ini.</p>
          </div>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card className="border-primary/20 bg-gradient-to-r from-primary/5 to-background">
      <CardHeader className="pb-2 pt-4 px-4">
        <div className="flex items-center gap-2">
          <Zap className="w-4 h-4 text-primary" />
          <CardTitle className="text-sm font-semibold">Yang Perlu Anda Kerjakan Hari Ini</CardTitle>
        </div>
      </CardHeader>
      <CardContent className="px-4 pb-4">
        <div className="flex flex-col sm:flex-row gap-3">
          {/* Step 1: belum match */}
          {unmatched > 0 && (
            <div className="flex-1 rounded-lg border bg-background p-3 space-y-2">
              <div className="flex items-start gap-2">
                <AlertTriangle className="w-4 h-4 text-amber-500 mt-0.5 shrink-0" />
                <div>
                  <p className="text-sm font-semibold">{unmatched} Mutasi Belum Dicocokkan</p>
                  <p className="text-xs text-muted-foreground">Jalankan AI untuk mencocokkan otomatis</p>
                </div>
              </div>
              <Button size="sm" className="w-full gap-1.5" onClick={onRunMatching} disabled={matchingPending}>
                {matchingPending ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Zap className="w-3.5 h-3.5" />}
                {matchingPending ? "Mencocokkan..." : "Jalankan AI Matching"}
              </Button>
            </div>
          )}

          {/* Step 2: siap approve */}
          {matched > 0 && (
            <div className="flex-1 rounded-lg border bg-background p-3 space-y-2">
              <div className="flex items-start gap-2">
                <CircleDot className="w-4 h-4 text-blue-500 mt-0.5 shrink-0" />
                <div>
                  <p className="text-sm font-semibold">{matched} Transaksi Siap Diapprove</p>
                  <p className="text-xs text-muted-foreground">Match sudah ditemukan, tinggal konfirmasi</p>
                </div>
              </div>
              <Button size="sm" variant="outline" className="w-full gap-1.5" onClick={onApproveAll}>
                <CheckCircle2 className="w-3.5 h-3.5" />
                Review &amp; Approve
              </Button>
            </div>
          )}

          {/* Step 3: menunggu posting */}
          {pendingPost > 0 && (
            <div className="flex-1 rounded-lg border border-yellow-200 bg-yellow-50/50 dark:bg-yellow-950/20 dark:border-yellow-800 p-3 space-y-2">
              <div className="flex items-start gap-2">
                <Clock className="w-4 h-4 text-yellow-600 mt-0.5 shrink-0" />
                <div>
                  <p className="text-sm font-semibold text-yellow-800 dark:text-yellow-300">{pendingPost} Draft Jurnal Menunggu Posting</p>
                  <p className="text-xs text-yellow-600 dark:text-yellow-400">Jurnal sudah dibuat, siap diposting ke accounting</p>
                </div>
              </div>
              <Button size="sm" className="w-full gap-1.5 bg-yellow-600 hover:bg-yellow-700" onClick={onPostAll}>
                <ReceiptText className="w-3.5 h-3.5" />
                Post ke Accounting
              </Button>
            </div>
          )}

          {/* Step 4: duplikat */}
          {needReview > 0 && (
            <div className="flex-1 rounded-lg border border-orange-200 bg-orange-50/50 dark:bg-orange-950/20 dark:border-orange-800 p-3 space-y-2">
              <div className="flex items-start gap-2">
                <AlertTriangle className="w-4 h-4 text-orange-500 mt-0.5 shrink-0" />
                <div>
                  <p className="text-sm font-semibold text-orange-800 dark:text-orange-300">{needReview} Duplikat Perlu Diperiksa</p>
                  <p className="text-xs text-orange-600 dark:text-orange-400">Transaksi ini perlu review manual</p>
                </div>
              </div>
            </div>
          )}

          {/* Sync shortcut */}
          <div className="flex-none flex flex-col gap-2 sm:w-auto">
            <Button size="sm" variant="outline" className="gap-1.5 whitespace-nowrap" onClick={onSyncSheet} disabled={syncPending}>
              {syncPending ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <CloudDownload className="w-3.5 h-3.5" />}
              Sync Google Sheet
            </Button>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Quick Filter Chips
// ─────────────────────────────────────────────────────────────────────────────

type QuickFilter = {
  label: string;
  status?: string;
  direction?: string;
};

// Endpoint filter values must match bank_mutations.status values (backend contract)
const QUICK_FILTERS: QuickFilter[] = [
  { label: "Belum Dicocokkan",   status: "unmatched" },
  { label: "Siap Approve",       status: "matched" },
  { label: "Perlu Review",       status: "duplicate_need_review" },
  { label: "Menunggu Posting",   status: "approved_pending_posting" },
  { label: "Sudah Diposting",    status: "posted" },
  { label: "Dibatalkan",         status: "void" },
  { label: "Uang Masuk (IN)",    direction: "IN" },
  { label: "Uang Keluar (OUT)",  direction: "OUT" },
];

function QuickFilterBar({
  activeStatus,
  activeDir,
  onStatus,
  onDir,
  onReset,
}: {
  activeStatus: string;
  activeDir: string;
  onStatus: (v: string) => void;
  onDir: (v: string) => void;
  onReset: () => void;
}) {
  const hasActive = activeStatus !== "all" || activeDir !== "all";
  return (
    <div className="flex flex-wrap gap-1.5 items-center">
      <span className="text-xs text-muted-foreground font-medium mr-1">Filter Cepat:</span>
      {QUICK_FILTERS.map(f => {
        const isActive =
          (f.status    && activeStatus === f.status) ||
          (f.direction && activeDir    === f.direction);
        return (
          <button
            key={f.label}
            className={`px-2.5 py-1 rounded-full text-xs font-medium border transition-all ${
              isActive
                ? "bg-primary text-primary-foreground border-primary shadow-sm"
                : "bg-background text-muted-foreground border-border hover:border-primary/50 hover:text-foreground"
            }`}
            onClick={() => {
              if (f.status)    onStatus(isActive ? "all" : f.status);
              if (f.direction) onDir(isActive ? "all" : f.direction);
            }}
          >
            {f.label}
          </button>
        );
      })}
      {hasActive && (
        <button
          className="px-2 py-1 rounded-full text-xs text-muted-foreground hover:text-foreground flex items-center gap-1"
          onClick={onReset}
        >
          <X className="w-3 h-3" /> Reset
        </button>
      )}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Proof Upload Button — self-contained, used in MutationCard row
// ─────────────────────────────────────────────────────────────────────────────

function ProofUploadButton({ mutationId, proofUrl }: { mutationId: number; proofUrl: string | null }) {
  const qc          = useQueryClient();
  const fileRef     = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const { toast }   = useToast();

  async function handleFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    setBusy(true);
    try {
      const fd = new FormData();
      fd.append("file", file);
      const r = await fetch(`/api/bank-reconciliation/${mutationId}/upload-proof`, {
        method: "POST", credentials: "include", body: fd,
      });
      const body = await r.json();
      if (!r.ok) throw new Error(body.error ?? "Gagal upload");
      toast({ title: "Bukti berhasil diupload" });
      qc.invalidateQueries({ queryKey: ["bank-reconciliation"] });
    } catch (err: any) {
      toast({ title: "Upload gagal", description: err.message, variant: "destructive" });
    } finally {
      setBusy(false);
      if (fileRef.current) fileRef.current.value = "";
    }
  }

  return (
    <>
      <input
        ref={fileRef} type="file" className="hidden"
        accept="image/jpeg,image/png,image/webp,image/gif,application/pdf"
        onChange={handleFile}
      />
      <Button
        size="sm" variant="ghost"
        className={`h-7 w-7 p-0 relative ${proofUrl ? "text-green-600 hover:text-green-700" : "text-muted-foreground hover:text-foreground"}`}
        title={proofUrl ? "Bukti sudah diupload — klik untuk ganti" : "Upload bukti transfer (opsional)"}
        disabled={busy}
        onClick={e => { e.stopPropagation(); fileRef.current?.click(); }}
      >
        {busy
          ? <Loader2 className="w-3.5 h-3.5 animate-spin" />
          : <Paperclip className="w-3.5 h-3.5" />}
        {proofUrl && !busy && (
          <span className="absolute top-0.5 right-0.5 w-1.5 h-1.5 bg-green-500 rounded-full" />
        )}
      </Button>
    </>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Mutation Card
// ─────────────────────────────────────────────────────────────────────────────

function MutationCard({
  m,
  onApprove,
  onPost,
  onReject,
  onReverse,
  onReopen,
  onDelete,
  onDetail,
  onApproveQris,
  mappingError,
}: {
  m: BankMutation;
  onApprove: (m: BankMutation) => void;
  onPost:    (m: BankMutation) => void;
  onReject:  (m: BankMutation) => void;
  onReverse: (m: BankMutation) => void;
  onReopen:  (m: BankMutation) => void;
  onDelete:  (id: number) => void;
  onDetail:  (m: BankMutation) => void;
  onApproveQris: (m: BankMutation) => void;
  mappingError?: MappingRequiredError;
}) {
  const cands  = m.candidates ?? [];
  const qrisAudit = m.qris_candidate_audit;
  const best   = cands[0];
  const amount = Number(m.amount) || 0;
  const isIN   = m.direction === "IN";

  return (
    <Card
      className={`transition-all hover:shadow-md ${CARD_BORDER[m.status] ?? ""} cursor-pointer group`}
      onClick={() => onDetail(m)}
      tabIndex={0}
      onKeyDown={e => e.key === "Enter" && onDetail(m)}
      role="article"
      aria-label={`Mutasi: ${m.description}`}
    >
      <CardContent className="p-4">
        <div className="flex items-start gap-3">
          {/* Direction icon */}
          <div className={`mt-0.5 shrink-0 w-9 h-9 rounded-full flex items-center justify-center ${
            isIN ? "bg-green-100 text-green-600 dark:bg-green-950/40" : "bg-red-100 text-red-600 dark:bg-red-950/40"
          }`}>
            {isIN ? <ArrowDownLeft className="w-4 h-4" /> : <ArrowUpRight className="w-4 h-4" />}
          </div>

          {/* Main content */}
          <div className="flex-1 min-w-0">
            <div className="flex items-start justify-between gap-2 flex-wrap">
              <div className="min-w-0">
                <p className="font-semibold text-sm truncate">{m.description}</p>
                <p className="text-xs text-muted-foreground mt-0.5">
                  {fmtDate(m.transaction_date)}
                  {m.provider_name && <> · <Badge variant="secondary" className="text-[10px] px-1 py-0 h-4">{m.provider_name}</Badge></>}
                  {m.provider_order_id && <> · <span className="font-mono">{m.provider_order_id}</span></>}
                </p>
              </div>
              <div className="text-right shrink-0">
                <p className={`text-base font-bold tabular-nums ${isIN ? "text-green-600" : "text-red-600"}`}>
                  {isIN ? "+" : "-"}{idr(amount)}
                </p>
                <span className={`text-[10px] px-1.5 py-0.5 rounded-full border font-medium ${statusColor(m)}`}>
                  {statusLabel(m)}
                </span>
              </div>
            </div>

            {/* Candidate info */}
            {best && (
              <div className="mt-2 flex items-center gap-2 flex-wrap">
                <div className="flex items-center gap-1.5 text-xs bg-muted/60 rounded-md px-2 py-1">
                  <ScoreBadge score={best.match_score} />
                  <span className="font-medium">
                    {CANDIDATE_TYPE_LABELS[best.candidate_type] ?? best.candidate_type} #{best.candidate_id}
                  </span>
                  {cands.length > 1 && (
                    <span className="text-muted-foreground">+{cands.length - 1} kandidat lain</span>
                  )}
                </div>
                <div className="flex gap-1">
                  {best.amount_match   && <span className="text-[10px] text-green-600 bg-green-50 dark:bg-green-950/30 px-1.5 py-0.5 rounded">✓ Nominal</span>}
                  {best.date_match     && <span className="text-[10px] text-green-600 bg-green-50 dark:bg-green-950/30 px-1.5 py-0.5 rounded">✓ Tanggal</span>}
                  {best.name_match     && <span className="text-[10px] text-green-600 bg-green-50 dark:bg-green-950/30 px-1.5 py-0.5 rounded">✓ Nama</span>}
                  {best.order_id_match && <span className="text-[10px] text-green-600 bg-green-50 dark:bg-green-950/30 px-1.5 py-0.5 rounded">✓ Order ID</span>}
                </div>
              </div>
            )}

            {qrisAudit && (
              <div className="mt-2 rounded-md border border-amber-300 bg-amber-50 px-2.5 py-2 text-xs dark:border-amber-800 dark:bg-amber-950/20">
                <div className="flex items-center gap-2 flex-wrap">
                  <span className="font-semibold text-slate-900 dark:text-slate-100">
                    Pemeriksaan QRIS
                  </span>
                  <Badge variant="outline" className="border-amber-400 bg-amber-100 text-amber-900 dark:border-amber-700 dark:bg-amber-950/50 dark:text-amber-200">
                    {QRIS_AUDIT_STATUS_LABELS[qrisAudit.reconciliation_status] ?? qrisAudit.reconciliation_status}
                  </Badge>
                  <span className="text-slate-700 dark:text-slate-300">
                    Provider: {qrisAudit.provider_code || "belum dikenali"}
                  </span>
                </div>
                <p className="mt-1 font-medium text-amber-950 dark:text-amber-100">
                  {qrisAudit.review_reason ?? "Kandidat QRIS tersedia untuk review."}
                </p>
                <p className="mt-1 text-slate-700 dark:text-slate-300">
                  Gross {idr(qrisAudit.gross_amount)} · Dana masuk {idr(qrisAudit.net_amount)} ·{" "}
                  {qrisAudit.payment_items?.length ?? 0} payment teridentifikasi
                </p>
                <QrisPaymentItemsSummary items={qrisAudit.payment_items} compact />
                <p className="mt-1 text-[11px] text-slate-600 dark:text-slate-400">
                  Audit ini hanya membantu verifikasi. Tidak melakukan approve, posting, atau membuat jurnal.
                </p>
                {qrisAudit.id && qrisAudit.status !== "approved" && (
                  <Button
                    size="sm"
                    variant="outline"
                    className="mt-2 h-7 text-xs border-amber-400 text-amber-900 hover:bg-amber-100 dark:text-amber-200"
                    onClick={() => onApproveQris(m)}
                  >
                    <CheckCircle2 className="w-3.5 h-3.5 mr-1" />
                    Approve batch QRIS
                  </Button>
                )}
              </div>
            )}

            {!best && m.status === "unmatched" && (
              <div className="mt-2 text-xs text-amber-600 dark:text-amber-400 flex items-center gap-1">
                <AlertTriangle className="w-3 h-3" />
                Belum ada kandidat match — jalankan AI Matching
              </div>
            )}

            {m.status === "approved_pending_posting" && m.journal_entry_id && (
              <div className="mt-2 text-xs text-yellow-700 dark:text-yellow-400 flex items-center gap-1">
                <FileText className="w-3 h-3" />
                Draft jurnal #{m.journal_entry_id} sudah dibuat — siap diposting
              </div>
            )}

            {/* AI Review status — Phase 12 */}
            <div className="mt-2" onClick={e => e.stopPropagation()}>
              <AIReviewSourcePanel
                source="bank_mutation"
                sourceRecordId={m.mutation_key}
                variant="compact"
                transactionSnapshot={{
                  id: m.mutation_key,
                  description: m.description,
                  amount: Number(m.amount) || undefined,
                  direction: m.direction === "IN" ? "CREDIT" : "DEBIT",
                  transactionDate: m.transaction_date,
                  counterpartyName: m.provider_name ?? undefined,
                  referenceNumber: m.provider_order_id ?? undefined,
                }}
              />
            </div>
          </div>
        </div>

        {/* Mapping-Required Warning (Task #6) */}
        {mappingError && (
          <Alert
            className="mt-3 border-orange-300 bg-orange-50 text-orange-900 dark:bg-orange-950/30 dark:border-orange-700 dark:text-orange-200"
            onClick={e => e.stopPropagation()}
          >
            <AlertTriangle className="h-4 w-4 text-orange-500 shrink-0" />
            <AlertDescription className="text-xs space-y-1">
              <p className="font-semibold">COA spesifik belum tersedia. Jurnal belum dibuat.</p>
              <p>{mappingError.message}</p>
              <p className="font-mono text-[10px] text-orange-600 dark:text-orange-400">
                {mappingError.code} · Review manual diperlukan
              </p>
            </AlertDescription>
          </Alert>
        )}

        {/* Actions row */}
        <div
          className="mt-3 pt-3 border-t flex items-center justify-between gap-2"
          onClick={e => e.stopPropagation()}
        >
          <div className="flex gap-1.5 flex-wrap">
            {/* Approve — only before posting; disabled when mapping-required */}
            {canApprove(m) && (
              <Button
                size="sm"
                className="h-7 text-xs gap-1 bg-green-600 hover:bg-green-700 disabled:opacity-50"
                disabled={!!mappingError}
                title={mappingError ? "COA spesifik belum tersedia — selesaikan pemetaan COA terlebih dahulu" : undefined}
                onClick={() => onApprove(m)}
              >
                <CheckCircle2 className="w-3.5 h-3.5" />
                Approve
              </Button>
            )}
            {/* Post ke Accounting — only for approved_pending_posting; disabled when mapping-required */}
            {canPost(m) && (
              <Button
                size="sm"
                className="h-7 text-xs gap-1 bg-yellow-600 hover:bg-yellow-700 disabled:opacity-50"
                disabled={!!mappingError}
                title={mappingError ? "COA spesifik belum tersedia — selesaikan pemetaan COA terlebih dahulu" : undefined}
                onClick={() => onPost(m)}
              >
                <ReceiptText className="w-3.5 h-3.5" />
                Post ke Accounting
              </Button>
            )}
            {/* Reject — only before posted */}
            {canReject(m) && (
              <Button
                size="sm"
                variant="outline"
                className="h-7 text-xs gap-1 text-red-600 hover:text-red-700 border-red-200 hover:bg-red-50"
                onClick={() => onReject(m)}
              >
                <XCircle className="w-3.5 h-3.5" />
                Reject
              </Button>
            )}
            {/* Reverse/Void — only for posted */}
            {canReverse(m) && (
              <Button
                size="sm"
                variant="outline"
                className="h-7 text-xs gap-1 text-gray-600 hover:text-gray-700 border-gray-200 hover:bg-gray-50"
                onClick={() => onReverse(m)}
              >
                <RotateCcw className="w-3.5 h-3.5" />
                Reverse
              </Button>
            )}
            {/* Reopen — only for void mutations */}
            {canReopen(m) && (
              <Button
                size="sm"
                variant="outline"
                className="h-7 text-xs gap-1 text-blue-600 hover:text-blue-700 border-blue-200 hover:bg-blue-50"
                onClick={() => onReopen(m)}
              >
                <RefreshCw className="w-3.5 h-3.5" />
                Buka Ulang
              </Button>
            )}
            {/* Status badges for terminal states */}
            {m.status === "posted" && !canReverse(m) && (
              <Badge variant="outline" className="text-green-600 border-green-300 h-7 px-2 text-xs">
                <CheckCircle2 className="w-3 h-3 mr-1" /> Sudah Diposting
              </Badge>
            )}
            {m.status === "void" && !canReopen(m) && (
              <Badge variant="outline" className="text-gray-500 border-gray-300 h-7 px-2 text-xs">
                <Undo2 className="w-3 h-3 mr-1" /> Dibatalkan
              </Badge>
            )}
            {m.source === "bank_import" && m.import_batch_id && (
              <a
                href={`/accounting/bank-mutation-imports/${m.import_batch_id}`}
                className="text-xs text-blue-600 hover:underline flex items-center gap-1 h-7"
                onClick={e => e.stopPropagation()}
              >
                Batch #{m.import_batch_id}
              </a>
            )}
          </div>
          <div className="flex gap-1 items-center">
            <ProofUploadButton mutationId={m.id} proofUrl={m.uploaded_proof_url ?? null} />
            <Button
              size="sm" variant="ghost"
              className="h-7 w-7 p-0 text-muted-foreground hover:text-foreground"
              title="Lihat Detail"
              onClick={() => onDetail(m)}
            >
              <Eye className="w-3.5 h-3.5" />
            </Button>
            {canDelete(m) && (
              <Button
                size="sm" variant="ghost"
                className="h-7 w-7 p-0 text-muted-foreground hover:text-destructive"
                title="Hapus Mutasi"
                onClick={() => { if (confirm("Hapus mutasi ini?")) onDelete(m.id); }}
              >
                <Trash2 className="w-3.5 h-3.5" />
              </Button>
            )}
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Proof Section — used inside MutationDetailPanel
// ─────────────────────────────────────────────────────────────────────────────

function ProofSection({ mutationId, initialUrl }: { mutationId: number; initialUrl: string | null }) {
  const qc             = useQueryClient();
  const fileRef        = useRef<HTMLInputElement>(null);
  const [url, setUrl]  = useState<string | null>(initialUrl);
  const [busy, setBusy] = useState(false);
  const { toast }      = useToast();

  const isImage = url ? /\.(jpe?g|png|webp|gif)(\?|$)/i.test(url) : false;
  const isPdf   = url ? /\.pdf(\?|$)/i.test(url) : false;

  async function handleFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    setBusy(true);
    try {
      const fd = new FormData();
      fd.append("file", file);
      const r = await fetch(`/api/bank-reconciliation/${mutationId}/upload-proof`, {
        method: "POST", credentials: "include", body: fd,
      });
      const body = await r.json();
      if (!r.ok) throw new Error(body.error ?? "Gagal upload");
      setUrl(body.url);
      toast({ title: "Bukti berhasil diupload" });
      qc.invalidateQueries({ queryKey: ["bank-reconciliation"] });
    } catch (err: any) {
      toast({ title: "Upload gagal", description: err.message, variant: "destructive" });
    } finally {
      setBusy(false);
      if (fileRef.current) fileRef.current.value = "";
    }
  }

  async function handleRemove() {
    if (!confirm("Hapus bukti transfer ini?")) return;
    setBusy(true);
    try {
      const r = await fetch(`/api/bank-reconciliation/${mutationId}/upload-proof`, {
        method: "DELETE", credentials: "include",
      });
      if (!r.ok) throw new Error("Gagal hapus");
      setUrl(null);
      toast({ title: "Bukti dihapus" });
      qc.invalidateQueries({ queryKey: ["bank-reconciliation"] });
    } catch (err: any) {
      toast({ title: "Hapus gagal", description: err.message, variant: "destructive" });
    } finally {
      setBusy(false);
    }
  }

  return (
    <div>
      <div className="flex items-center justify-between mb-2">
        <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">
          Bukti Transfer
        </p>
        <div className="flex items-center gap-1">
          {url && (
            <Button size="sm" variant="ghost"
              className="h-6 text-xs px-2 text-red-500 hover:text-red-700 hover:bg-red-50"
              disabled={busy} onClick={handleRemove}
            >
              <Trash2 className="w-3 h-3 mr-1" />Hapus
            </Button>
          )}
          <Button size="sm" variant="outline"
            className="h-6 text-xs px-2 gap-1"
            disabled={busy}
            onClick={() => fileRef.current?.click()}
          >
            {busy
              ? <Loader2 className="w-3 h-3 animate-spin" />
              : <Paperclip className="w-3 h-3" />}
            {url ? "Ganti" : "Upload Bukti"}
          </Button>
          <input ref={fileRef} type="file" className="hidden"
            accept="image/jpeg,image/png,image/webp,image/gif,application/pdf"
            onChange={handleFile}
          />
        </div>
      </div>

      {url ? (
        <div className="rounded-lg border overflow-hidden bg-muted/20">
          {isImage ? (
            <a href={url} target="_blank" rel="noopener noreferrer">
              <img
                src={url} alt="Bukti Transfer"
                className="w-full max-h-60 object-contain bg-white"
                onError={e => { (e.target as HTMLImageElement).style.display = "none"; }}
              />
              <div className="px-3 py-1.5 flex items-center gap-1 text-xs text-blue-600 border-t">
                <ExternalLink className="w-3 h-3 shrink-0" />
                Buka di tab baru
              </div>
            </a>
          ) : isPdf ? (
            <a href={url} target="_blank" rel="noopener noreferrer"
              className="flex items-center gap-2 px-3 py-2.5 text-sm text-blue-600 hover:bg-blue-50"
            >
              <FileText className="w-4 h-4 shrink-0" />
              <span className="truncate">Lihat PDF</span>
              <ExternalLink className="w-3 h-3 shrink-0 ml-auto" />
            </a>
          ) : (
            <a href={url} target="_blank" rel="noopener noreferrer"
              className="flex items-center gap-2 px-3 py-2.5 text-sm text-blue-600 hover:bg-blue-50"
            >
              <FileText className="w-4 h-4 shrink-0" />
              <span className="text-xs break-all">{url}</span>
              <ExternalLink className="w-3 h-3 shrink-0 ml-auto" />
            </a>
          )}
        </div>
      ) : (
        <div
          className="rounded-lg border-2 border-dashed border-muted-foreground/20 py-5 flex flex-col items-center justify-center gap-1.5 text-muted-foreground cursor-pointer hover:border-muted-foreground/40 hover:bg-muted/30 transition-colors"
          onClick={() => fileRef.current?.click()}
        >
          <ImageIcon className="w-6 h-6 opacity-40" />
          <p className="text-xs">Klik untuk upload bukti transfer</p>
          <p className="text-[10px] opacity-60">JPG, PNG, WEBP, GIF, atau PDF · maks. 10 MB</p>
        </div>
      )}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Detail Side Panel
// ─────────────────────────────────────────────────────────────────────────────

// Lifecycle steps driven by real backend status values
const LIFECYCLE_STEPS = [
  { label: "Belum Dicocokkan", status: "unmatched" },
  { label: "Kandidat Ditemukan", status: "matched" },
  { label: "Menunggu Posting", status: "approved_pending_posting" },
  { label: "Sudah Diposting", status: "posted" },
  { label: "Dibatalkan", status: "void" },
];

function getLifecycleIndex(status: string): number {
  const idx = LIFECYCLE_STEPS.findIndex(s => s.status === status);
  return idx >= 0 ? idx : 0;
}

function MutationDetailPanel({
  mutation,
  open,
  onClose,
  onApprove,
  onPost,
  onReject,
  onReverse,
  onReopen,
  onApproveQris,
  mappingError,
  onApproveQrisBatch,
}: {
  mutation: BankMutation | null;
  open: boolean;
  onClose: () => void;
  onApprove: (m: BankMutation) => void;
  onPost:    (m: BankMutation) => void;
  onReject:  (m: BankMutation) => void;
  onReverse: (m: BankMutation) => void;
  onReopen:  (m: BankMutation) => void;
  onApproveQris: (m: BankMutation) => void;
  mappingError?: MappingRequiredError;
  onApproveQrisBatch?: (candidateId: number, mutationId: number, candidate: QrisCandidateAudit) => void;
}) {
  if (!mutation) return null;
  const m     = mutation;
  const cands = m.candidates ?? [];
  const qrisAudit = m.qris_candidate_audit;
  const isIN  = m.direction === "IN";
  const currentStep = getLifecycleIndex(m.status);

  return (
    <Sheet open={open} onOpenChange={onClose}>
      <SheetContent side="right" className="w-full sm:max-w-lg p-0 flex flex-col">
        <SheetHeader className="px-4 py-4 border-b shrink-0">
          <div className="flex items-start justify-between gap-2">
            <div className="min-w-0">
              <SheetTitle className="text-base leading-tight truncate">{m.description}</SheetTitle>
              <p className="text-xs text-muted-foreground mt-1">
                {fmtDate(m.transaction_date)} · {isIN ? "Uang Masuk" : "Uang Keluar"}
              </p>
            </div>
            <span className={`shrink-0 text-xs px-2 py-1 rounded-full border font-medium ${statusColor(m)}`}>
              {statusLabel(m)}
            </span>
          </div>
        </SheetHeader>

        <ScrollArea className="flex-1 overflow-auto">
          <div className="px-4 py-4 space-y-4">
            {/* Nominal */}
            <div className="rounded-lg bg-muted/40 p-3 text-center">
              <p className={`text-2xl font-bold tabular-nums ${isIN ? "text-green-600" : "text-red-600"}`}>
                {isIN ? "+" : "-"}{idr(m.amount)}
              </p>
              <p className="text-xs text-muted-foreground mt-0.5">
                {isIN ? "Kredit" : "Debit"} Rekening
              </p>
            </div>

            {/* Info rows */}
            <div className="space-y-2 text-sm">
              {[
                { label: "Tanggal Transaksi", value: fmtDate(m.transaction_date) },
                { label: "Arah", value: isIN ? "Masuk (IN)" : "Keluar (OUT)" },
                { label: "Provider", value: m.provider_name ?? "—" },
                { label: "Order ID Provider", value: m.provider_order_id ?? "—" },
                { label: "Kunci Mutasi", value: <code className="text-xs bg-muted px-1.5 py-0.5 rounded font-mono break-all">{m.mutation_key}</code> },
                { label: "Sumber", value: m.source ?? "—" },
                ...(m.posted_at ? [{ label: "Diposting", value: fmtDateTime(m.posted_at) }] : []),
                ...(m.posted_by ? [{ label: "Oleh", value: m.posted_by }] : []),
              ].map(({ label, value }) => (
                <div key={label} className="flex items-start justify-between gap-2">
                  <span className="text-muted-foreground shrink-0 w-36">{label}</span>
                  <span className="text-right font-medium">{value}</span>
                </div>
              ))}
            </div>

            <Separator />

            {/* Candidate matches */}
            <div>
              <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-2">
                Kandidat Match ({cands.length})
              </p>
              {cands.length === 0 ? (
                <div className="text-sm text-muted-foreground bg-muted/40 rounded p-3 text-center">
                  Belum ada kandidat
                </div>
              ) : (
                <div className="space-y-2">
                  {cands.map(c => (
                    <div key={c.id} className="rounded-lg border p-3 space-y-1.5">
                      <div className="flex items-center justify-between">
                        <Badge variant="outline" className="text-xs capitalize">
                          {CANDIDATE_TYPE_LABELS[c.candidate_type] ?? c.candidate_type} #{c.candidate_id}
                        </Badge>
                        <ScoreBadge score={c.match_score} />
                      </div>
                      {/* Identitas kandidat — selalu tampil jika ada */}
                      {(c.details?.name || c.customer_name || c.details?.reference || c.details?.date) && (
                        <div className="text-xs rounded bg-muted/50 px-2 py-1.5 space-y-0.5">
                          {(c.details?.name || c.customer_name) && (
                            <p className="font-semibold text-foreground">{c.details?.name ?? c.customer_name}</p>
                          )}
                          <div className="flex flex-wrap gap-x-3 gap-y-0.5 text-muted-foreground">
                            {c.details?.date      && <span>📅 {fmtDate(String(c.details.date))}</span>}
                            {c.details?.reference && <span>🔖 {c.details.reference}</span>}
                            {c.details?.amount != null && <span>💰 {idr(c.details.amount)}</span>}
                          </div>
                        </div>
                      )}
                      <p className="text-xs text-muted-foreground">{c.match_reason}</p>
                      <div className="flex flex-wrap gap-1">
                        {c.amount_match   && <span className="text-[10px] text-green-600 bg-green-50 dark:bg-green-950/30 px-1.5 py-0.5 rounded">✓ Nominal</span>}
                        {c.date_match     && <span className="text-[10px] text-green-600 bg-green-50 dark:bg-green-950/30 px-1.5 py-0.5 rounded">✓ Tanggal</span>}
                        {c.name_match     && <span className="text-[10px] text-green-600 bg-green-50 dark:bg-green-950/30 px-1.5 py-0.5 rounded">✓ Nama</span>}
                        {c.order_id_match && <span className="text-[10px] text-green-600 bg-green-50 dark:bg-green-950/30 px-1.5 py-0.5 rounded">✓ Order ID</span>}
                        {c.proof_match    && <span className="text-[10px] text-green-600 bg-green-50 dark:bg-green-950/30 px-1.5 py-0.5 rounded">✓ Bukti Transfer</span>}
                      </div>
                       <CandidateDetailsBlock candidate={c} />
                    </div>
                  ))}
                </div>
              )}
            </div>

            {qrisAudit && (
              <>
                <Separator />
                <div className="space-y-2">
                  {/* Header */}
                  <div className="flex items-center justify-between gap-2">
                    <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                      QRIS Batch Candidates
                    </p>
                    {qrisAudit.status === "approved" ? (
                      <Badge className="bg-green-600 text-white text-xs gap-1">
                        <CheckCircle2 className="w-3 h-3" /> Disetujui
                      </Badge>
                    ) : (
                      <Badge variant="outline" className="border-amber-400 bg-amber-100 text-amber-900 dark:border-amber-700 dark:bg-amber-950/50 dark:text-amber-200 text-xs">
                        {QRIS_AUDIT_STATUS_LABELS[qrisAudit.reconciliation_status] ?? qrisAudit.reconciliation_status}
                      </Badge>
                    )}
                  </div>

                  {/* Summary */}
                  <div className="rounded-lg border border-indigo-200 bg-indigo-50 p-3 space-y-2 dark:border-indigo-800 dark:bg-indigo-950/20">
                    <div className="grid grid-cols-2 gap-x-3 gap-y-1 text-xs">
                      <span className="text-slate-600 dark:text-slate-400">Provider</span>
                      <span className="font-medium text-right">{qrisAudit.provider_code || "Belum dikenali"}</span>
                      <span className="text-slate-600 dark:text-slate-400">Perkiraan settlement</span>
                      <span className="font-medium text-right">{fmtDate(qrisAudit.estimated_settlement_date)}</span>
                      <span className="text-slate-600 dark:text-slate-400">Total bruto</span>
                      <span className="font-medium text-right">{idr(qrisAudit.gross_amount)}</span>
                      <span className="text-slate-600 dark:text-slate-400">Dana masuk (netto)</span>
                      <span className="font-medium text-right text-green-700">{idr(qrisAudit.net_amount)}</span>
                      <span className="text-slate-600 dark:text-slate-400">Potongan MDR</span>
                      <span className="font-medium text-right text-red-600">{idr(qrisAudit.observed_deduction)}</span>
                    </div>

                    {/* Payment items list */}
                    {(qrisAudit.payment_items?.length ?? 0) > 0 && (
                      <div className="mt-1">
                        <p className="text-[10px] font-semibold uppercase tracking-wide text-slate-500 mb-1">
                          {qrisAudit.payment_items!.length} Sport Payment dalam Batch
                        </p>
                        <div className="rounded border divide-y text-xs max-h-48 overflow-y-auto bg-white dark:bg-slate-900">
                          {qrisAudit.payment_items!.map((item, idx) => {
                            const pid = item.paymentId ?? item.payment_id ?? 0;
                            const gross = item.grossAmount ?? item.gross_amount ?? 0;
                            const paymentNo = item.payment_number;
                            const bookingNo = item.booking_number;
                            const paidAt = item.paid_at;
                            return (
                              <div key={idx} className="px-2 py-1.5 space-y-0.5">
                                <div className="flex items-center justify-between gap-2">
                                  <span className="font-mono text-[10px] text-slate-500">
                                    {paymentNo ? paymentNo : `#${pid}`}
                                  </span>
                                  {Number(gross) > 0 && (
                                    <span className="font-semibold text-right">{idr(gross)}</span>
                                  )}
                                </div>
                                {bookingNo && (
                                  <p className="text-[10px] text-slate-500 truncate">
                                    Booking: <span className="font-medium text-slate-700 dark:text-slate-300">{bookingNo}</span>
                                  </p>
                                )}
                                {paidAt && (
                                  <p className="text-[10px] text-slate-400">
                                    Bayar: {fmtDate(paidAt)}
                                  </p>
                                )}
                              </div>
                            );
                          })}
                        </div>
                      </div>
                    )}

                    {qrisAudit.review_reason && (
                      <p className="rounded border border-amber-300 bg-amber-50 px-2 py-1.5 text-[11px] font-medium leading-relaxed text-slate-950 dark:border-amber-700 dark:bg-amber-950/60 dark:text-amber-50">
                        {qrisAudit.review_reason}
                      </p>
                    )}
                  </div>

                  {/* Approve button — only for MATCHED, gated for REVIEW/UNMATCHED */}
                  {qrisAudit.status !== "approved" && qrisAudit.id != null && onApproveQrisBatch && (() => {
                    const isMatched = String(qrisAudit.reconciliation_status ?? "").toUpperCase() === "MATCHED";
                    return isMatched ? (
                      <Button
                        size="sm"
                        className="w-full gap-1.5 bg-indigo-600 hover:bg-indigo-700 text-white"
                        onClick={() => onApproveQrisBatch(qrisAudit.id!, qrisAudit.mutation_id, qrisAudit)}
                      >
                        <CheckCircle2 className="w-3.5 h-3.5" />
                        Setujui Batch — Buat QRIS Settlement
                      </Button>
                    ) : (
                      <div className="rounded border border-amber-300 bg-amber-50 px-3 py-2 text-xs text-amber-800 dark:border-amber-700 dark:bg-amber-950/30 dark:text-amber-200 space-y-1">
                        <p className="font-semibold flex items-center gap-1">
                          <AlertTriangle className="w-3 h-3 shrink-0" />
                          Tidak dapat disetujui — verifikasi manual diperlukan
                        </p>
                        <p>
                          Status <strong>{qrisAudit.reconciliation_status}</strong>: provider belum dikenali,
                          partisi payment ambigu, atau potongan MDR di luar toleransi.
                          Periksa dan perbaiki data sebelum membuat settlement.
                        </p>
                      </div>
                    );
                  })()}
                  {qrisAudit.status === "approved" && (
                    <p className="text-[11px] text-green-700 dark:text-green-400 text-center">
                      Batch ini sudah disetujui. Settlement QRIS telah dibuat dan siap dicocokkan ke mutasi bank.
                    </p>
                  )}
                </div>
              </>
            )}

            <Separator />

            {/* Journal Preview — real or estimated */}
            <div>
              <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-2">
                Journal Entry
              </p>
              <JournalPreview
                mutation={m}
                candidate={cands[0]}
                journalEntryId={m.journal_entry_id}
              />
            </div>

            {/* Proof — upload, preview, remove */}
            <Separator />
            <ProofSection mutationId={m.id} initialUrl={m.uploaded_proof_url ?? null} />

            {/* Lifecycle steps — driven by real backend statuses */}
            <Separator />
            <div>
              <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-2">Status Alur</p>
              <div className="flex items-center gap-1 text-xs overflow-x-auto pb-1">
                {LIFECYCLE_STEPS.map((step, i, arr) => {
                  const active = i === currentStep;
                  const done   = i < currentStep;
                  const isVoid = m.status === "void" && step.status === "void";
                  return (
                    <div key={step.status} className="flex items-center gap-1 shrink-0">
                      <span className={`px-2 py-0.5 rounded-full border text-[10px] font-medium ${
                        isVoid  ? "bg-gray-100 text-gray-500 border-gray-300" :
                        active  ? "bg-primary text-primary-foreground border-primary" :
                        done    ? "bg-green-100 text-green-700 border-green-200 dark:bg-green-950/30 dark:text-green-400" :
                                  "bg-muted text-muted-foreground border-muted"
                      }`}>{step.label}</span>
                      {i < arr.length - 1 && <span className="text-muted-foreground">→</span>}
                    </div>
                  );
                })}
              </div>
              {m.status === "rejected" && (
                <p className="text-xs text-red-600 flex items-center gap-1 mt-1.5">
                  <XCircle className="w-3 h-3" /> Mutasi ini telah ditolak
                </p>
              )}
            </div>
          </div>
        </ScrollArea>

        {/* Mapping-Required Warning (Task #6) */}
        {mappingError && (
          <div className="px-4 pb-2 shrink-0">
            <Alert className="border-orange-300 bg-orange-50 text-orange-900 dark:bg-orange-950/30 dark:border-orange-700 dark:text-orange-200">
              <AlertTriangle className="h-4 w-4 text-orange-500 shrink-0" />
              <AlertDescription className="text-xs space-y-1">
                <p className="font-semibold">COA spesifik belum tersedia. Jurnal belum dibuat.</p>
                <p>{mappingError.message}</p>
                <p className="font-mono text-[10px] text-orange-600 dark:text-orange-400">
                  {mappingError.code} · Review manual diperlukan
                </p>
              </AlertDescription>
            </Alert>
          </div>
        )}

        {/* Footer actions — explicit per-status */}
        <div className="px-4 py-3 border-t shrink-0 flex gap-2 flex-wrap">
          {canApprove(m) && (
            <Button
              className="flex-1 gap-1.5 bg-green-600 hover:bg-green-700 min-w-[120px] disabled:opacity-50"
              disabled={!!mappingError}
              title={mappingError ? "COA spesifik belum tersedia — selesaikan pemetaan COA terlebih dahulu" : undefined}
              onClick={() => { onClose(); onApprove(m); }}>
              <CheckCircle2 className="w-4 h-4" />
              Approve
            </Button>
          )}
          {canPost(m) && (
            <Button
              className="flex-1 gap-1.5 bg-yellow-600 hover:bg-yellow-700 min-w-[140px] disabled:opacity-50"
              disabled={!!mappingError}
              title={mappingError ? "COA spesifik belum tersedia — selesaikan pemetaan COA terlebih dahulu" : undefined}
              onClick={() => { onClose(); onPost(m); }}>
              <ReceiptText className="w-4 h-4" />
              Post ke Accounting
            </Button>
          )}
          {canReject(m) && (
            <Button variant="outline" className="flex-1 gap-1.5 text-red-600 hover:text-red-700 border-red-200 hover:bg-red-50 min-w-[100px]"
              onClick={() => { onClose(); onReject(m); }}>
              <XCircle className="w-4 h-4" />
              Reject
            </Button>
          )}
          {canReverse(m) && (
            <Button variant="outline" className="flex-1 gap-1.5 text-gray-600 hover:text-gray-800 border-gray-300 hover:bg-gray-50 min-w-[120px]"
              onClick={() => { onClose(); onReverse(m); }}>
              <RotateCcw className="w-4 h-4" />
              Reverse / Void
            </Button>
          )}
          {canReopen(m) && (
            <Button
              className="flex-1 gap-1.5 bg-blue-600 hover:bg-blue-700 min-w-[140px]"
              onClick={() => { onClose(); onReopen(m); }}>
              <RefreshCw className="w-4 h-4" />
              Buka Ulang &amp; Cocokkan Lagi
            </Button>
          )}
          {m.status === "void" && (
            <p className="text-xs text-muted-foreground bg-gray-50 border border-gray-200 rounded px-2 py-1.5 w-full text-center">
              Jurnal reversal sudah dibuat. Klik <strong>Buka Ulang</strong> untuk cocokkan mutasi ini kembali.
            </p>
          )}
          {!canApprove(m) && !canPost(m) && !canReject(m) && !canReverse(m) && !canReopen(m) && (
            <p className="text-xs text-muted-foreground py-1 w-full text-center">Tidak ada aksi tersedia untuk status ini</p>
          )}
        </div>
      </SheetContent>
    </Sheet>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Google Sheet Collapsed Card (unchanged)
// ─────────────────────────────────────────────────────────────────────────────

function SheetConfigCollapsed() {
  const { toast } = useToast();
  const qc = useQueryClient();
  const [expanded, setExpanded] = useState(false);
  const [showForm, setShowForm] = useState(false);
  const [editTarget, setEditTarget] = useState<SheetConfig | null>(null);
  const [testResults, setTestResults] = useState<Record<number, TestResult>>({});
  const [testing, setTesting] = useState<Record<number, boolean>>({});
  const [syncing, setSyncing] = useState<Record<number, boolean>>({});
  const [form, setForm] = useState({ company_id: "", label: "", sheet_id: "", tab_name: "Mutasi_Bank" });

  const { data: configsData, isLoading } = useQuery({
    queryKey: ["sheet-configs"],
    queryFn: () => fetch("/api/bank-reconciliation/sheet-configs", { credentials: "include" }).then(r => r.json()),
  });
  const { data: companiesData } = useQuery({
    queryKey: ["companies-list"],
    queryFn: () => fetch("/api/accounting/companies", { credentials: "include" }).then(r => r.json()),
    enabled: expanded || showForm,
  });

  const configs: SheetConfig[]  = configsData?.configs ?? [];
  const companies: Company[]    = Array.isArray(companiesData) ? companiesData : (companiesData?.companies ?? []);
  const activeConfigs            = configs.filter(c => c.is_active);
  const lastSyncOk               = activeConfigs.every(c => c.last_sync_status === "ok" || !c.last_sync_status);

  const testOne = async (cfg: SheetConfig) => {
    setTesting(p => ({ ...p, [cfg.id]: true }));
    try {
      const r      = await fetch(`/api/bank-reconciliation/sheet-configs/${cfg.id}/test`, { method: "POST", credentials: "include" });
      const result = await r.json();
      setTestResults(p => ({ ...p, [cfg.id]: result }));
    } catch (e: any) {
      setTestResults(p => ({ ...p, [cfg.id]: { ok: false, error: e.message } }));
    } finally {
      setTesting(p => ({ ...p, [cfg.id]: false }));
    }
  };

  const syncOne = async (cfg: SheetConfig) => {
    setSyncing(p => ({ ...p, [cfg.id]: true }));
    try {
      const r = await fetch(`/api/bank-reconciliation/sheet-configs/${cfg.id}/sync`, { method: "POST", credentials: "include" });
      const d = await r.json();
      toast({ title: d.ok ? `${cfg.label}: ${d.message}` : (d.error ?? "Sync gagal"), variant: d.ok ? "default" : "destructive" });
      qc.invalidateQueries({ queryKey: ["sheet-configs"] });
    } catch (e: any) {
      toast({ title: e.message, variant: "destructive" });
    } finally {
      setSyncing(p => ({ ...p, [cfg.id]: false }));
    }
  };

  const openCreate = () => {
    setEditTarget(null);
    setForm({ company_id: "", label: "", sheet_id: "", tab_name: "Mutasi_Bank" });
    setShowForm(true);
  };
  const openEdit = (cfg: SheetConfig) => {
    setEditTarget(cfg);
    setForm({ company_id: cfg.company_id ? String(cfg.company_id) : "", label: cfg.label, sheet_id: cfg.sheet_id, tab_name: cfg.tab_name });
    setShowForm(true);
  };
  const saveConfig = async () => {
    if (!form.label || !form.sheet_id) { toast({ title: "Label dan Sheet ID wajib diisi", variant: "destructive" }); return; }
    const body = { company_id: form.company_id ? Number(form.company_id) : null, label: form.label, sheet_id: form.sheet_id, tab_name: form.tab_name || "Mutasi_Bank" };
    const url  = editTarget ? `/api/bank-reconciliation/sheet-configs/${editTarget.id}` : "/api/bank-reconciliation/sheet-configs";
    const r    = await fetch(url, { method: editTarget ? "PUT" : "POST", credentials: "include", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
    const d    = await r.json();
    if (!r.ok) { toast({ title: d.error ?? "Gagal simpan", variant: "destructive" }); return; }
    toast({ title: editTarget ? "Config diperbarui" : "Config ditambahkan" });
    qc.invalidateQueries({ queryKey: ["sheet-configs"] });
    setShowForm(false);
  };
  const deleteConfig = async (cfg: SheetConfig) => {
    if (!confirm(`Hapus config "${cfg.label}"?`)) return;
    await fetch(`/api/bank-reconciliation/sheet-configs/${cfg.id}`, { method: "DELETE", credentials: "include" });
    qc.invalidateQueries({ queryKey: ["sheet-configs"] });
    toast({ title: "Config dihapus" });
  };
  const toggleActive = async (cfg: SheetConfig) => {
    await fetch(`/api/bank-reconciliation/sheet-configs/${cfg.id}`, { method: "PUT", credentials: "include", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ is_active: !cfg.is_active }) });
    qc.invalidateQueries({ queryKey: ["sheet-configs"] });
  };

  return (
    <>
      <Card>
        <CardContent className="p-3">
          <button className="w-full flex items-center justify-between gap-3 text-left" onClick={() => setExpanded(e => !e)} aria-expanded={expanded}>
            <div className="flex items-center gap-2">
              {isLoading ? <Loader2 className="w-4 h-4 animate-spin text-muted-foreground" /> :
               lastSyncOk ? <Wifi className="w-4 h-4 text-green-500" /> : <WifiOff className="w-4 h-4 text-orange-500" />}
              <span className="text-sm font-medium">Google Sheet</span>
              <Badge variant="secondary" className="text-xs">{configs.length} koneksi</Badge>
              {activeConfigs.length > 0 && (
                <span className="text-xs text-muted-foreground hidden sm:inline">
                  · Sync terakhir: {fmtDateTime(activeConfigs[0]?.last_synced_at)}
                </span>
              )}
            </div>
            <div className="flex items-center gap-2">
              <Button size="sm" variant="outline" className="h-6 text-xs gap-1" onClick={e => { e.stopPropagation(); openCreate(); }}>
                <Plus className="w-3 h-3" /> Tambah
              </Button>
              {expanded ? <ChevronUp className="w-4 h-4 text-muted-foreground" /> : <ChevronDown className="w-4 h-4 text-muted-foreground" />}
            </div>
          </button>

          {expanded && (
            <div className="mt-3 space-y-2 border-t pt-3">
              {configs.length === 0 ? (
                <p className="text-sm text-muted-foreground text-center py-4">
                  Belum ada koneksi. Klik <strong>Tambah</strong> untuk menambahkan.
                </p>
              ) : configs.map(cfg => {
                const tr = testResults[cfg.id];
                return (
                  <div key={cfg.id} className={`rounded-lg border p-3 space-y-2 ${cfg.is_active ? "" : "opacity-60"}`}>
                    <div className="flex items-center justify-between gap-2">
                      <div className="flex items-center gap-2 min-w-0">
                        <Building2 className="w-3.5 h-3.5 text-muted-foreground shrink-0" />
                        <div className="min-w-0">
                          <p className="text-sm font-medium truncate">{cfg.label}</p>
                          {cfg.company_name && <p className="text-xs text-muted-foreground">{cfg.company_name}</p>}
                        </div>
                      </div>
                      <div className="flex items-center gap-1.5 shrink-0">
                        <Badge variant={cfg.is_active ? "outline" : "secondary"} className={cfg.is_active ? "border-green-300 text-green-700 text-xs" : "text-xs"}>
                          {cfg.is_active ? "Aktif" : "Nonaktif"}
                        </Badge>
                        {cfg.last_sync_status === "ok"    && <CheckCircle2 className="w-3.5 h-3.5 text-green-500" />}
                        {cfg.last_sync_status === "error" && <AlertTriangle className="w-3.5 h-3.5 text-orange-500" />}
                      </div>
                    </div>
                    <div className="text-xs text-muted-foreground">
                      Tab: <code className="bg-muted px-1 rounded">{cfg.tab_name}</code>
                      {cfg.last_synced_at && <> · {fmtDateTime(cfg.last_synced_at)}</>}
                    </div>
                    {cfg.last_sync_status === "error" && cfg.last_sync_error && (
                      <p className="text-xs text-orange-700 bg-orange-50 border border-orange-200 rounded px-2 py-1">
                        ⚠️ {cfg.last_sync_error.slice(0, 100)}
                      </p>
                    )}
                    {tr && (
                      <div className={`text-xs rounded px-2 py-1 ${tr.ok ? "bg-green-50 border border-green-200 text-green-800" : "bg-red-50 border border-red-200 text-red-800"}`}>
                        {tr.ok ? <>✅ {tr.message}</> : <><ShieldAlert className="inline w-3 h-3 mr-1" />{tr.error}{tr.hint && <div className="ml-4 mt-0.5">💡 {tr.hint}</div>}</>}
                      </div>
                    )}
                    <div className="flex flex-wrap gap-1">
                      <Button size="sm" variant="outline" className="h-6 text-xs gap-1" onClick={() => testOne(cfg)} disabled={testing[cfg.id]}>
                        {testing[cfg.id] ? <Loader2 className="w-2.5 h-2.5 animate-spin" /> : <Wifi className="w-2.5 h-2.5" />} Test
                      </Button>
                      <Button size="sm" variant="outline" className="h-6 text-xs gap-1" onClick={() => syncOne(cfg)} disabled={syncing[cfg.id] || !cfg.is_active}>
                        {syncing[cfg.id] ? <Loader2 className="w-2.5 h-2.5 animate-spin" /> : <RefreshCw className="w-2.5 h-2.5" />} Sync
                      </Button>
                      <Button size="sm" variant="ghost" className="h-6 text-xs" onClick={() => openEdit(cfg)}>Edit</Button>
                      <Button size="sm" variant="ghost" className="h-6 text-xs" onClick={() => toggleActive(cfg)}>{cfg.is_active ? "Nonaktifkan" : "Aktifkan"}</Button>
                      <Button size="sm" variant="ghost" className="h-6 text-xs text-red-600" onClick={() => deleteConfig(cfg)}><Trash2 className="w-2.5 h-2.5" /></Button>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </CardContent>
      </Card>

      <Dialog open={showForm} onOpenChange={setShowForm}>
        <DialogContent className="max-w-lg">
          <DialogHeader><DialogTitle>{editTarget ? "Edit Config Sheet" : "Tambah Koneksi Google Sheet"}</DialogTitle></DialogHeader>
          <div className="space-y-4 py-2">
            <div className="space-y-1.5">
              <label className="text-sm font-medium">Perusahaan</label>
              <Select value={form.company_id || "none"} onValueChange={v => setForm(f => ({ ...f, company_id: v === "none" ? "" : v }))}>
                <SelectTrigger><SelectValue placeholder="Pilih perusahaan (opsional)" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="none">— Semua / Global —</SelectItem>
                  {companies.map(c => <SelectItem key={c.id} value={String(c.id)}>{c.companyName}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <label className="text-sm font-medium">Label <span className="text-red-500">*</span></label>
              <Input placeholder="Contoh: CST Group - BCA Operasional" value={form.label} onChange={e => setForm(f => ({ ...f, label: e.target.value }))} />
            </div>
            <div className="space-y-1.5">
              <label className="text-sm font-medium">Google Sheet ID <span className="text-red-500">*</span></label>
              <Input placeholder="1VcbUujz6WHRgj5Fa1QkWja..." value={form.sheet_id} onChange={e => setForm(f => ({ ...f, sheet_id: e.target.value }))} />
              <p className="text-xs text-muted-foreground">Dari URL: docs.google.com/spreadsheets/d/<strong>[ID INI]</strong>/edit</p>
            </div>
            <div className="space-y-1.5">
              <label className="text-sm font-medium">Nama Tab</label>
              <Input placeholder="Mutasi_Bank" value={form.tab_name} onChange={e => setForm(f => ({ ...f, tab_name: e.target.value }))} />
            </div>
            <div className="rounded-md bg-blue-50 border border-blue-200 p-3 text-xs text-blue-800">
              <p className="font-medium">Pastikan sheet sudah di-share ke Service Account.</p>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowForm(false)}>Batal</Button>
            <Button onClick={saveConfig}>{editTarget ? "Simpan Perubahan" : "Tambahkan"}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Onboarding Modal
// ─────────────────────────────────────────────────────────────────────────────

const ONBOARDING_KEY = "biz_bank_recon_onboarding_v1";

function OnboardingModal() {
  const [open, setOpen] = useState(false);
  useEffect(() => { if (!localStorage.getItem(ONBOARDING_KEY)) setOpen(true); }, []);
  const dismiss = (permanent: boolean) => {
    if (permanent) localStorage.setItem(ONBOARDING_KEY, "1");
    setOpen(false);
  };
  return (
    <Dialog open={open} onOpenChange={() => dismiss(false)}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <BookOpen className="w-5 h-5 text-primary" />
            Selamat datang di Rekonsiliasi Bank
          </DialogTitle>
        </DialogHeader>
        <div className="space-y-3 py-2">
          <p className="text-sm text-muted-foreground">Ikuti 5 langkah sederhana ini untuk menyelesaikan rekonsiliasi:</p>
          {[
            { n: 1, icon: CloudDownload, label: "Sync Google Sheet",     desc: "Tarik data mutasi bank dari Google Sheet Anda." },
            { n: 2, icon: Zap,           label: "Jalankan AI Matching",  desc: "AI akan mencocokkan mutasi ke invoice, expense, dan transaksi lain." },
            { n: 3, icon: Eye,           label: "Review Hasil",          desc: "Periksa hasil matching dan tangani duplikat." },
            { n: 4, icon: CheckCircle2,  label: "Approve",               desc: "Konfirmasi mutasi yang sudah benar — draft jurnal dibuat otomatis." },
            { n: 5, icon: ReceiptText,   label: "Post ke Accounting",    desc: "Promosikan draft jurnal ke status posted." },
          ].map(({ n, icon: Icon, label, desc }) => (
            <div key={n} className="flex items-start gap-3">
              <div className="flex items-center justify-center w-7 h-7 rounded-full bg-primary/10 text-primary text-sm font-bold shrink-0">{n}</div>
              <div>
                <div className="flex items-center gap-1.5">
                  <Icon className="w-3.5 h-3.5 text-primary" />
                  <p className="text-sm font-semibold">{label}</p>
                </div>
                <p className="text-xs text-muted-foreground">{desc}</p>
              </div>
            </div>
          ))}
        </div>
        <DialogFooter className="flex-col sm:flex-row gap-2">
          <Button variant="ghost" size="sm" className="text-xs" onClick={() => dismiss(true)}>Jangan tampilkan lagi</Button>
          <Button onClick={() => dismiss(false)}>Mulai Sekarang</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Main Page
// ─────────────────────────────────────────────────────────────────────────────

// Endpoint contract documentation:
//   Sync sheet:       POST /api/bank-reconciliation/sheet-configs/:id/sync
//   Run matching:     POST /api/bank-reconciliation/run-matching
//   Approve:          POST /api/bank-reconciliation/:id/approve  → status: approved_pending_posting
//   Post accounting:  POST /api/bank-reconciliation/:id/post     → status: posted
//   Reject:           POST /api/bank-reconciliation/:id/reject   → status: rejected
//   Reverse/Void:     POST /api/bank-reconciliation/:id/void-journal  → status: void
//   Mutations list:   GET  /api/bank-reconciliation/mutations
//   Summary:          GET  /api/bank-reconciliation/summary
//   Import:           POST /api/bank-reconciliation/import

type DialogMode = "approve" | "post" | "reject" | "reverse";

export default function BankReconciliationPage() {
  const { toast }  = useToast();
  const qc         = useQueryClient();
  const [, setLocation] = useLocation();
  const { activeCompanyId } = useCompany();
  const qrisCompanyId =
    typeof activeCompanyId === "number" && Number.isInteger(activeCompanyId) && activeCompanyId > 0
      ? activeCompanyId
      : null;

  // ── Filters ──────────────────────────────────────────────────────────────
  const [filterStatus,   setFilterStatus]   = useState("all");
  const [filterDir,      setFilterDir]      = useState("all");
  const [filterProvider, setFilterProvider] = useState("all");
  const [filterFrom,     setFilterFrom]     = useState("");
  const [filterTo,       setFilterTo]       = useState("");
  const [filterSearch,   setFilterSearch]   = useState(
    () => new URLSearchParams(window.location.search).get("search") ?? "",
  );
  const [page,           setPage]           = useState(0);
  const [showAdvancedFilters, setShowAdvancedFilters] = useState(false);
  const PAGE_SIZE = 20;

  // ── UI state ──────────────────────────────────────────────────────────────
  const [detailMutation,      setDetailMutation]      = useState<BankMutation | null>(null);
  const [actionDialog,        setActionDialog]        = useState<{ mutation: BankMutation; mode: DialogMode } | null>(null);
  const [qrisDetailLoadingId, setQrisDetailLoadingId] = useState<number | null>(null);
  const [selectedCandidateId, setSelectedCandidateId] = useState<number | null>(null);
  const [reverseReason,       setReverseReason]       = useState("");
  const [showDeleteAll,       setShowDeleteAll]       = useState(false);
  /** Populated when backend returns manual_review_required:true on approve */
  const [manualReviewWarning, setManualReviewWarning] = useState<{
    error: string;
    code: string;
    mutId: number;
  } | null>(null);
  // Task #6: mapping-required errors per mutation ID — set when backend returns 422 + manual_review_required
  const [mappingRequiredErrors, setMappingRequiredErrors] = useState<Map<number, MappingRequiredError>>(new Map());
  const [postDialogJournalStatus, setPostDialogJournalStatus] = useState<string | null>(null);

  // ── Queries ──────────────────────────────────────────────────────────────
  const queryKey = ["bank-reconciliation", filterStatus, filterDir, filterProvider, filterFrom, filterTo, filterSearch, page];

  const { data, isLoading, refetch } = useQuery({
    queryKey,
    queryFn: async () => {
      const params = new URLSearchParams({ limit: String(PAGE_SIZE), offset: String(page * PAGE_SIZE) });
      if (filterStatus !== "all")   params.set("status",    filterStatus);
      if (filterDir    !== "all")   params.set("direction", filterDir);
      if (filterProvider !== "all") params.set("provider",  filterProvider);
      if (filterFrom) params.set("from", filterFrom);
      if (filterTo)   params.set("to",   filterTo);
      if (filterSearch) params.set("search", filterSearch);
      const r = await fetch(`/api/bank-reconciliation/mutations?${params}`, { credentials: "include" });
      if (!r.ok) throw new Error(await r.text());
      return r.json() as Promise<{ mutations: BankMutation[]; total: number }>;
    },
  });

  const { data: summary } = useQuery({
    queryKey: ["bank-reconciliation-summary"],
    queryFn: async () => {
      const r = await fetch("/api/bank-reconciliation/summary", { credentials: "include" });
      return r.json() as Promise<{ summary: { status: string; count: string; total_amount: string }[] }>;
    },
    refetchInterval: 30_000,
  });

  const { data: qrisAuditData, isLoading: qrisAuditLoading } = useQuery({
    queryKey: ["qris-candidate-audit", qrisCompanyId],
    queryFn: async () => {
      const params = new URLSearchParams({ limit: "50", companyId: String(qrisCompanyId) });
      const r = await fetch(`/api/bank-reconciliation/qris-candidates?${params}`, { credentials: "include" });
      if (!r.ok) throw new Error(await r.text());
      return r.json() as Promise<{
        mode: string;
        automaticFinalReconciliation: boolean;
        candidates: QrisCandidateAudit[];
      }>;
    },
    enabled: qrisCompanyId != null,
    refetchInterval: 30_000,
  });

  const qrisDryRunMut = useMutation({
    mutationFn: async () => {
      if (qrisCompanyId == null) {
        throw new Error("Pilih satu perusahaan aktif sebelum membuat kandidat review QRIS.");
      }
      const r = await fetch("/api/bank-reconciliation/qris-candidates/generate", {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        // Persist only the candidate/review row. This is not final
        // reconciliation and does not create a journal or consume evidence.
        body: JSON.stringify({ dryRun: false, companyId: qrisCompanyId }),
      });
      if (!r.ok) throw new Error(await r.text());
      return r.json() as Promise<{ generated: number; candidates: QrisCandidateAudit[] }>;
    },
    onSuccess: (result) => {
      toast({ title: `Dry-run QRIS selesai: ${result.generated} kandidat` });
      qc.invalidateQueries({ queryKey: ["qris-candidate-audit", qrisCompanyId] });
    },
    onError: (e: Error) => toast({ title: "Dry-run QRIS gagal", description: e.message, variant: "destructive" }),
  });

  const [qrisBatchConfirm, setQrisBatchConfirm] = useState<{
    candidateId: number;
    mutationId: number;
    companyId: number;
    providerCode: string;
    netAmount: number | string;
    paymentCount: number;
  } | null>(null);

  const handleApproveQrisBatch = (
    candidateId: number,
    mutationId: number,
    candidate: QrisCandidateAudit,
  ) => {
    const companyId = Number(candidate.company_id ?? null);
    if (!Number.isInteger(companyId) || companyId <= 0) {
      toast({
        title: "Company context tidak tersedia",
        description: "Kandidat QRIS tidak memiliki company yang valid.",
        variant: "destructive",
      });
      return;
    }
    setQrisBatchConfirm({
      candidateId,
      mutationId,
      companyId,
      providerCode: candidate.provider_code || "belum dikenali",
      netAmount: candidate.net_amount,
      paymentCount: candidate.payment_items?.length ?? 0,
    });
  };

  const handleConfirmQrisBatch = () => {
    if (!qrisBatchConfirm) return;
    approveQrisBatchMut.mutate(qrisBatchConfirm);
    setQrisBatchConfirm(null);
  };

  const summaryMap: Record<string, { count: number; amount: number }> = {};
  for (const s of summary?.summary ?? []) {
    summaryMap[s.status] = { count: Number(s.count), amount: Number(s.total_amount) };
  }

  // ── Task #7: COA proposals by source — checks for an existing proposal
  //    tied to the current bank mutation; shown in the manual_review_required banner.
  const COA_GAP_CODES = ["SPECIFIC_COA_REQUIRED", "JOURNAL_MAPPING_REQUIRED", "COA_NOT_FOUND", "COA_MAPPING_AMBIGUOUS"] as const;
  const sourceKey = actionDialog?.mutation?.mutation_key ?? null;
  // Enable as soon as the approve dialog opens — do NOT gate on manualReviewWarning.
  // This way the proposal data is always fresh when the banner appears, and stale
  // React Query cache (e.g. from a previous session) cannot show the wrong code.
  const shouldQueryBySource = !!(sourceKey && actionDialog?.mode === "approve");
  const {
    data: existingSourceProposals,
    isLoading: isSourceProposalLoading,
    isError: isSourceProposalError,
  } = useQuery({
    queryKey: ["coa-proposals-by-source", "BANK_MUTATION", sourceKey],
    queryFn: async () => {
      const r = await fetch(
        `/api/accounting/coa-proposals/by-source?sourceType=BANK_MUTATION&sourceRecordId=${encodeURIComponent(sourceKey!)}`,
        { credentials: "include" },
      );
      if (!r.ok) return [] as { id: number; proposalNumber: string; status: string; proposedCode?: string; proposedName?: string }[];
      return r.json() as Promise<{ id: number; proposalNumber: string; status: string; proposedCode?: string; proposedName?: string }[]>;
    },
    enabled: shouldQueryBySource,
    staleTime: 0,          // always fetch fresh — proposal code may change after implementation
    refetchOnMount: true,  // re-fetch whenever the approve dialog mounts
  });
  const latestSourceProposal = existingSourceProposals?.[0] ?? null;

  // When a JOURNAL_MAPPING_REQUIRED error is active but an IMPLEMENTED proposal
  // already has the COA ready, surface that code so the footer button can re-enable
  // and pass it directly — no need to hunt for the small "↻" button.
  const resolvedManualCoaCode = (
    manualReviewWarning &&
    latestSourceProposal?.status === "IMPLEMENTED" &&
    latestSourceProposal?.proposedCode
  ) ? latestSourceProposal.proposedCode : null;

  // ── Invalidate helper ────────────────────────────────────────────────────
  const invalidate = () => {
    qc.invalidateQueries({ queryKey: ["bank-reconciliation"] });
    qc.invalidateQueries({ queryKey: ["bank-reconciliation-summary"] });
  };

  const refreshMutationDetail = async (mutationId: number) => {
    await qc.invalidateQueries({ queryKey: ["bank-reconciliation"] });
    const refreshed = await refetch();
    const next = refreshed.data?.mutations.find((item) => item.id === mutationId);
    if (next) setDetailMutation(next);
  };

  // ── Mutation hooks ────────────────────────────────────────────────────────

  const importMut = useMutation({
    mutationFn: async (file: File) => {
      const fd = new FormData();
      fd.append("file", file);
      const r = await fetch("/api/bank-reconciliation/import", { method: "POST", credentials: "include", body: fd });
      if (!r.ok) throw new Error(await r.text());
      return r.json();
    },
    onSuccess: (d) => { toast({ title: `Import selesai: ${d.imported} baris, ${d.duplicates} duplikat` }); invalidate(); },
    onError: (e: Error) => toast({ title: "Gagal import", description: e.message, variant: "destructive" }),
  });

  const matchMut = useMutation({
    mutationFn: async () => {
      const r = await fetch("/api/bank-reconciliation/run-matching", {
        method: "POST", credentials: "include", headers: { "Content-Type": "application/json" }, body: "{}",
      });
      if (!r.ok) throw new Error(await r.text());
      return r.json();
    },
    onSuccess: (d) => { toast({ title: `AI Matching selesai: ${d.processed} mutasi diproses` }); invalidate(); },
    onError: (e: Error) => toast({ title: "Gagal matching", description: e.message, variant: "destructive" }),
  });

  const approveQrisBatchMut = useMutation({
    mutationFn: async ({
      candidateId,
      mutationId,
      companyId,
    }: { candidateId: number; mutationId: number; companyId: number }) => {
      const r = await fetch(`/api/bank-reconciliation/qris-candidates/${candidateId}/approve`, {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ mutationId, companyId }),
      });
      const body = await r.json().catch(() => ({ error: "Unknown error" }));
      if (!r.ok) throw new Error(body.error ?? r.statusText);
      return body as { mutationId: number; matching?: { status?: string } | null };
    },
    onSuccess: async (result) => {
      toast({
        title: result.matching?.status === "auto_matched" || result.matching?.status === "manual_review"
          ? "Batch QRIS disetujui — mutasi sudah di-matching ✓"
          : "Batch QRIS disetujui ✓",
      });
      await refreshMutationDetail(result.mutationId);
      qc.invalidateQueries({ queryKey: ["bank-reconciliation-summary"] });
    },
    onError: (e: Error) => toast({ title: "Gagal approve batch QRIS", description: e.message, variant: "destructive" }),
  });

  const sheetSyncMut = useMutation({
    mutationFn: async () => {
      const r = await fetch("/api/bank-reconciliation/sheet-sync", { method: "POST", credentials: "include" });
      if (!r.ok) throw new Error(await r.text());
      return r.json();
    },
    onSuccess: (d) => { toast({ title: d.message ?? "Sync dari Google Sheet selesai" }); invalidate(); },
    onError: (e: Error) => toast({ title: "Sync gagal", description: e.message, variant: "destructive" }),
  });

  // Approve → POST /:id/approve → legacy becomes approved_pending_posting;
  // canonical settlement becomes terminal approved/reconciled.
  const approveMut = useMutation({
    mutationFn: async ({
      mutId, matchId, candidateType, candidateId, candidateSource, manualCoaCode,
    }: {
      mutId: number;
      matchId?: number;
      candidateType?: string;
      candidateId?: number;
      candidateSource?: string | null;
      manualCoaCode?: string;
    }) => {
      const r = await fetch(`/api/bank-reconciliation/${mutId}/approve`, {
        method: "POST", credentials: "include", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          match_id: matchId,
          candidate_type: candidateType,
          candidate_id: candidateId,
          candidate_source: candidateSource ?? null,
          manual_coa_code: manualCoaCode,
        }),
      });
      const body = await r.json().catch(() => ({ error: "Unknown error" }));
      if (!r.ok) {
        // 422 + manual_review_required → surface as data, not a thrown error,
        // so onSuccess can set the warning banner without closing the dialog.
        if (r.status === 422 && body.manual_review_required) {
          return { __manualReview: true as const, error: body.error as string, code: body.code as string, mutId };
        }
        throw new Error(body.error ?? r.statusText);
      }
      return body as Record<string, unknown>;
    },
    onSuccess: (d: any) => {
      if (d?.__manualReview) {
        // Show warning in-dialog; do NOT close or invalidate — mapping not done.
        setManualReviewWarning({ error: d.error, code: d.code, mutId: d.mutId });
        // Invalidate all by-source proposal caches so the next render uses fresh data from the DB.
        // This prevents stale proposed_code (e.g. from a previous session) from being re-used.
        qc.invalidateQueries({ queryKey: ["coa-proposals-by-source"] });
        return;
      }
      setManualReviewWarning(null);
      toast({
        title: d?.candidate_source === CANONICAL_SETTLEMENT_SOURCE
          ? "Settlement disetujui dan direconcile ✓"
          : "Approve berhasil — draft jurnal dibuat ✓",
      });
      setActionDialog(null);
      invalidate();
    },
    onError: (e: Error) => toast({ title: "Gagal approve", description: e.message, variant: "destructive" }),
  });

  // Post Accounting → POST /:id/post → status becomes posted
  const postMut = useMutation({
    mutationFn: async (mutId: number) => {
      const r = await fetch(`/api/bank-reconciliation/${mutId}/post`, {
        method: "POST", credentials: "include", headers: { "Content-Type": "application/json" }, body: "{}",
      });
      if (!r.ok) {
        const body = await r.json().catch(() => ({ error: "Unknown error" }));
        // 409 = concurrent action or double-post
        throw new Error(body.error ?? r.statusText);
      }
      return r.json();
    },
    onSuccess: () => { toast({ title: "Jurnal berhasil diposting ke Accounting ✓" }); setActionDialog(null); invalidate(); },
    onError: (e: Error) => toast({ title: "Gagal posting", description: e.message, variant: "destructive" }),
  });

  const rejectMut = useMutation({
    mutationFn: async (mutId: number) => {
      const r = await fetch(`/api/bank-reconciliation/${mutId}/reject`, {
        method: "POST", credentials: "include", headers: { "Content-Type": "application/json" }, body: "{}",
      });
      if (!r.ok) throw new Error(await r.text());
      return r.json();
    },
    onSuccess: () => { toast({ title: "Mutasi ditandai Ditolak" }); setActionDialog(null); invalidate(); },
    onError: (e: Error) => toast({ title: "Gagal reject", description: e.message, variant: "destructive" }),
  });

  // Reopen void → POST /:id/reopen → resets status to 'unmatched' so re-matching can run
  const reopenMut = useMutation({
    mutationFn: async (mutId: number) => {
      const r = await fetch(`/api/bank-reconciliation/${mutId}/reopen`, {
        method: "POST", credentials: "include", headers: { "Content-Type": "application/json" }, body: "{}",
      });
      if (!r.ok) {
        const body = await r.json().catch(() => ({ error: "Unknown error" }));
        throw new Error(body.error ?? r.statusText);
      }
      return r.json();
    },
    onSuccess: () => {
      toast({ title: "Mutasi dibuka ulang — jalankan Cocokkan Otomatis untuk mencari kandidat baru." });
      setActionDialog(null);
      setDetailMutation(null);
      invalidate();
    },
    onError: (e: Error) => toast({ title: "Gagal buka ulang", description: e.message, variant: "destructive" }),
  });

  // Void/Reverse → POST /:id/void-journal → status becomes void (creates reversal entry)
  const voidMut = useMutation({
    mutationFn: async ({ mutId, reason }: { mutId: number; reason: string }) => {
      const r = await fetch(`/api/bank-reconciliation/${mutId}/void-journal`, {
        method: "POST", credentials: "include", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ reason: reason || null }),
      });
      if (!r.ok) {
        const body = await r.json().catch(() => ({ error: "Unknown error" }));
        throw new Error(body.error ?? r.statusText);
      }
      return r.json();
    },
    onSuccess: (d) => {
      toast({ title: `Journal berhasil di-void. Reversal entry #${d.void_entry_id} dibuat.` });
      setActionDialog(null);
      setReverseReason("");
      invalidate();
    },
    onError: (e: Error) => toast({ title: "Gagal void journal", description: e.message, variant: "destructive" }),
  });

  const deleteAllMut = useMutation({
    mutationFn: async () => {
      const r = await fetch("/api/bank-reconciliation/delete-all", { method: "DELETE", credentials: "include" });
      if (!r.ok) throw new Error(await r.text());
      return r.json();
    },
    onSuccess: (d) => { toast({ title: `${d.deleted ?? 0} mutasi dihapus` }); invalidate(); },
    onError: (e: Error) => toast({ title: "Gagal hapus semua", description: e.message, variant: "destructive" }),
  });

  const deleteMut = useMutation({
    mutationFn: async (mutId: number) => {
      const r = await fetch(`/api/bank-reconciliation/${mutId}`, { method: "DELETE", credentials: "include" });
      if (!r.ok) throw new Error(await r.text());
      return r.json();
    },
    onSuccess: () => { toast({ title: "Mutasi dihapus" }); invalidate(); },
    onError: (e: Error) => toast({ title: "Gagal hapus", description: e.message, variant: "destructive" }),
  });

  // ── Handlers ──────────────────────────────────────────────────────────────

  const handleFileUpload = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) importMut.mutate(file);
    e.target.value = "";
  }, [importMut]);

  const handleOpenApprove  = (m: BankMutation) => { setSelectedCandidateId(null); setManualReviewWarning(null); setActionDialog({ mutation: m, mode: "approve" }); };
  const handleOpenPost     = (m: BankMutation) => { setPostDialogJournalStatus(null); setActionDialog({ mutation: m, mode: "post" }); };
  const handleOpenReject   = (m: BankMutation) => setActionDialog({ mutation: m, mode: "reject" });
  const handleOpenReverse  = (m: BankMutation) => { setReverseReason(""); setActionDialog({ mutation: m, mode: "reverse" }); };
  const handleOpenReopen   = (m: BankMutation) => reopenMut.mutate(m.id);
  const handleApproveQris = (m: BankMutation) => {
    const candidateId = m.qris_candidate_audit?.id;
    if (!candidateId) {
      toast({ title: "Kandidat QRIS tidak tersedia", variant: "destructive" });
      return;
    }
    const companyId = Number(m.qris_candidate_audit?.company_id ?? m.company_id ?? null);
    if (!Number.isInteger(companyId) || companyId <= 0) {
      toast({
        title: "Company context tidak tersedia",
        description: "Mutasi bank tidak memiliki company yang valid.",
        variant: "destructive",
      });
      return;
    }
    approveQrisBatchMut.mutate({ candidateId, mutationId: m.id, companyId });
  };

  const handleConfirmApprove = () => {
    if (!actionDialog) return;
    const m      = actionDialog.mutation;
    const chosen = (m.candidates ?? []).find(c => c.id === selectedCandidateId);
    approveMut.mutate({
      mutId: m.id,
      matchId: chosen?.id,
      candidateType: chosen?.candidate_type,
      candidateId: chosen?.candidate_id,
      candidateSource: chosen?.candidate_source ?? null,
      // When a JOURNAL_MAPPING_REQUIRED error is active but an IMPLEMENTED COA proposal
      // is ready, pass the code so the backend bypasses resolveContraAccount.
      manualCoaCode: resolvedManualCoaCode ?? undefined,
    });
  };

  const handleApproveAllMatched = () => { setFilterStatus("matched"); setPage(0); };
  const handlePostAllPending    = () => { setFilterStatus("approved_pending_posting"); setPage(0); };

  const resetFilters = () => {
    setFilterStatus("all"); setFilterDir("all"); setFilterProvider("all");
    setFilterFrom(""); setFilterTo(""); setFilterSearch(""); setPage(0);
  };

  const mutations   = data?.mutations ?? [];
  const total       = data?.total ?? 0;
  const totalPages  = Math.ceil(total / PAGE_SIZE);

  const handleOpenQrisMutation = async (candidate: QrisCandidateAudit) => {
    const mutationId = Number(candidate.mutation_id);
    if (!Number.isInteger(mutationId) || mutationId <= 0 || qrisCompanyId == null) {
      toast({
        title: "Mutasi QRIS tidak valid",
        description: "Company atau ID mutasi tidak tersedia.",
        variant: "destructive",
      });
      return;
    }

    const currentMutation = mutations.find((mutation) => mutation.id === mutationId);
    if (currentMutation) {
      setDetailMutation(currentMutation);
      return;
    }

    setQrisDetailLoadingId(mutationId);
    try {
      const params = new URLSearchParams({
        company_id: String(qrisCompanyId),
        mutation_id: String(mutationId),
        limit: "1",
      });
      const response = await fetch(`/api/bank-reconciliation/mutations?${params}`, {
        credentials: "include",
      });
      const result = await response.json().catch(() => null);
      if (!response.ok) {
        throw new Error(result?.error ?? "Gagal mengambil detail mutasi");
      }
      const mutation = result?.mutations?.[0] as BankMutation | undefined;
      if (!mutation) {
        throw new Error(`Mutasi #${mutationId} tidak ditemukan pada perusahaan aktif`);
      }
      setDetailMutation(mutation);
    } catch (error) {
      toast({
        title: "Gagal membuka verifikasi",
        description: error instanceof Error ? error.message : "Detail mutasi tidak dapat dimuat.",
        variant: "destructive",
      });
    } finally {
      setQrisDetailLoadingId(null);
    }
  };

  const approveDialogCands    = actionDialog?.mutation.candidates ?? [];
  const approveSelectedCand   = approveDialogCands.find(c => c.id === selectedCandidateId);

  return (
    <AppShell>
      <OnboardingModal />

      <div className="p-4 sm:p-6 space-y-4 max-w-7xl mx-auto">
        {/* ── Page Header ──────────────────────────────────────── */}
        <div className="flex items-start justify-between flex-wrap gap-3">
          <div className="flex items-start gap-2">
            <Link href="/accounting">
              <Button variant="ghost" size="icon" aria-label="Kembali"><ArrowLeft className="h-4 w-4" /></Button>
            </Link>
            <div>
              <h1 className="text-xl sm:text-2xl font-bold">Rekonsiliasi Bank</h1>
              <p className="text-sm text-muted-foreground">Cocokkan mutasi rekening dengan transaksi di sistem</p>
            </div>
          </div>
          <div className="flex gap-2 flex-wrap items-center">
            <label>
              <input type="file" accept=".xlsx,.xls,.csv" className="hidden" onChange={handleFileUpload} />
              <Button variant="outline" size="sm" asChild>
                <span className="cursor-pointer gap-1.5 flex items-center">
                  <Upload className="w-3.5 h-3.5" />
                  {importMut.isPending ? "Importing..." : "Import Excel"}
                </span>
              </Button>
            </label>
            <Button variant="ghost" size="icon" onClick={() => refetch()} title="Refresh" className="h-8 w-8">
              <RefreshCw className="w-4 h-4" />
            </Button>
            <Button variant="ghost" size="sm" className="text-red-600 hover:text-red-700 h-8 text-xs" onClick={() => setShowDeleteAll(true)}>
              <Trash2 className="w-3.5 h-3.5 mr-1" /> Hapus Semua
            </Button>
          </div>
        </div>

        {/* ── Step Progress ─────────────────────────────────── */}
        <StepProgressBar summaryMap={summaryMap} />

        {/* ── AI Action Center ──────────────────────────────── */}
        <AIActionCenter
          summaryMap={summaryMap}
          onRunMatching={() => matchMut.mutate()}
          onApproveAll={handleApproveAllMatched}
          onPostAll={handlePostAllPending}
          onSyncSheet={() => sheetSyncMut.mutate()}
          matchingPending={matchMut.isPending}
          syncPending={sheetSyncMut.isPending}
        />

        {/* ── Summary Cards ─────────────────────────────────── */}
        <SummaryCards summaryMap={summaryMap} activeFilter={filterStatus} onFilter={v => { setFilterStatus(v); setPage(0); }} />

        {/* ── QRIS provider-aware audit: candidate/review only ── */}
         <Card className="border-indigo-200/70 dark:border-indigo-900/70">
          <CardHeader className="pb-3">
            <div className="flex items-start justify-between gap-3 flex-wrap">
              <div>
                <CardTitle className="text-base flex items-center gap-2">
                  <CreditCard className="w-4 h-4 text-indigo-600" />
                  QRIS Settlement Audit
                </CardTitle>
                 <p className="text-xs text-slate-600 dark:text-slate-400 mt-1">
                   Pemeriksaan awal untuk menjelaskan kemungkinan settlement QRIS. Tidak membuat jurnal dan tidak menandai settlement final.
                </p>
              </div>
              <Button
                variant="outline"
                size="sm"
                className="gap-1.5"
                onClick={() => qrisDryRunMut.mutate()}
                disabled={qrisDryRunMut.isPending || qrisCompanyId == null}
                title={qrisCompanyId == null ? "Pilih satu perusahaan aktif terlebih dahulu" : undefined}
              >
                {qrisDryRunMut.isPending
                  ? <Loader2 className="w-3.5 h-3.5 animate-spin" />
                  : <Play className="w-3.5 h-3.5" />}
                {qrisDryRunMut.isPending ? "Menganalisis..." : "Buat Kandidat Review"}
              </Button>
            </div>
          </CardHeader>
          <CardContent className="pt-0">
            {qrisCompanyId == null ? (
              <div className="rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800 dark:border-amber-800 dark:bg-amber-950/30 dark:text-amber-200">
                Pilih satu perusahaan aktif terlebih dahulu. Analisis QRIS tidak dijalankan dalam mode semua perusahaan agar data tidak tercampur.
              </div>
            ) : qrisAuditLoading ? (
               <div className="text-xs text-slate-600 dark:text-slate-400 py-2">Memuat pemeriksaan QRIS...</div>
            ) : (qrisAuditData?.candidates?.length ?? 0) === 0 ? (
              <div className="rounded-md border border-slate-200 bg-slate-50 px-3 py-2 text-xs text-slate-700 dark:border-slate-800 dark:bg-slate-900/50 dark:text-slate-300">
                Belum ada hasil pemeriksaan QRIS. Jalankan analisis setelah mutasi bank aktual diimpor.
              </div>
            ) : (
              <div className="space-y-2">
                <div className="flex gap-2 flex-wrap text-xs">
                  {(["MATCHED", "REVIEW", "UNMATCHED"] as const).map((status) => {
                    const count = qrisAuditData?.candidates.filter(c => c.reconciliation_status === status).length ?? 0;
                    return (
                      <Badge key={status} variant="outline" className={
                        status === "MATCHED"
                           ? "border-green-300 bg-green-50 text-green-800 dark:border-green-800 dark:bg-green-950/30 dark:text-green-300"
                          : status === "REVIEW"
                             ? "border-amber-300 bg-amber-50 text-amber-800 dark:border-amber-800 dark:bg-amber-950/30 dark:text-amber-300"
                             : "border-slate-300 bg-slate-50 text-slate-700 dark:border-slate-700 dark:bg-slate-900/40 dark:text-slate-300"
                      }>
                         {QRIS_AUDIT_STATUS_LABELS[status]}: {count}
                      </Badge>
                    );
                  })}
                </div>
                <div className="divide-y rounded-md border text-xs">
                  {qrisAuditData?.candidates.slice(0, 10).map((candidate) => {
                    const isApproved = candidate.status === "approved";
                    const isApprovingThis = approveQrisBatchMut.isPending &&
                      approveQrisBatchMut.variables?.candidateId === candidate.id;
                    return (
                      <div key={`${candidate.mutation_id}-${candidate.id ?? "candidate"}`} className="p-2.5 space-y-2">
                        <div className="flex items-start justify-between gap-3 flex-wrap">
                          <div className="min-w-0 flex-1">
                            <div className="flex items-center gap-2 flex-wrap">
                              <Badge variant="outline" className="border-slate-300 bg-white text-slate-800 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-200">
                                {candidate.provider_code || "Provider belum dikenali"}
                              </Badge>
                              {isApproved ? (
                                <Badge className="bg-green-600 text-white gap-1 text-[10px]">
                                  <CheckCircle2 className="w-2.5 h-2.5" /> Disetujui
                                </Badge>
                              ) : (
                                <Badge variant="outline" className="border-amber-300 bg-amber-50 text-amber-800 dark:border-amber-800 dark:bg-amber-950/30 dark:text-amber-300">
                                  {QRIS_AUDIT_STATUS_LABELS[candidate.reconciliation_status] ?? candidate.reconciliation_status}
                                </Badge>
                              )}
                              <span className="text-slate-600 dark:text-slate-400">Mutasi #{candidate.mutation_id}</span>
                            </div>
                            <p className="mt-1 truncate max-w-[400px] font-medium text-slate-900 dark:text-slate-100">
                              {candidate.review_reason ?? candidate.description ?? "Belum ada alasan tambahan."}
                            </p>
                            <p className="text-slate-600 dark:text-slate-400 mt-0.5">
                              Settlement {fmtDate(candidate.estimated_settlement_date)} · {candidate.payment_items?.length ?? 0} payment · Netto {idr(candidate.net_amount)}
                            </p>
                            <Button
                              size="sm"
                              variant="outline"
                              className="mt-2 h-7 gap-1 border-indigo-300 text-[11px] text-indigo-700 hover:bg-indigo-50 dark:border-indigo-700 dark:text-indigo-300 dark:hover:bg-indigo-950/40"
                              disabled={qrisDetailLoadingId === candidate.mutation_id}
                              onClick={() => void handleOpenQrisMutation(candidate)}
                            >
                              {qrisDetailLoadingId === candidate.mutation_id
                                ? <Loader2 className="h-3 w-3 animate-spin" />
                                : <Eye className="h-3 w-3" />}
                              {qrisDetailLoadingId === candidate.mutation_id ? "Membuka..." : "Lihat & Verifikasi Mutasi"}
                            </Button>
                          </div>
                          <div className="text-right shrink-0 space-y-1">
                            <p className="font-semibold text-slate-950 dark:text-white">{idr(candidate.gross_amount)}</p>
                            <p className="text-slate-500 dark:text-slate-400">
                              MDR {idr(candidate.observed_deduction)}
                              {candidate.effective_deduction_rate != null
                                ? ` (${(Number(candidate.effective_deduction_rate) * 100).toFixed(2)}%)`
                                : ""}
                            </p>
                            {!isApproved && candidate.id != null && (() => {
                              const isMatched = String(candidate.reconciliation_status ?? "").toUpperCase() === "MATCHED";
                              return isMatched ? (
                                <Button
                                  size="sm"
                                  variant="outline"
                                  className="h-7 text-[11px] gap-1 border-indigo-400 text-indigo-700 hover:bg-indigo-50"
                                  disabled={isApprovingThis || approveQrisBatchMut.isPending}
                                  onClick={() => handleApproveQrisBatch(candidate.id!, candidate.mutation_id, candidate)}
                                >
                                  {isApprovingThis
                                    ? <><Loader2 className="w-3 h-3 animate-spin" /> Menyetujui...</>
                                    : <><CheckCircle2 className="w-3 h-3" /> Setujui Batch</>}
                                </Button>
                              ) : (
                                <span
                                  title={`Status ${candidate.reconciliation_status}: verifikasi manual diperlukan sebelum dapat disetujui`}
                                  className="text-[10px] text-amber-700 dark:text-amber-400 flex items-center gap-0.5 cursor-help"
                                >
                                  <AlertTriangle className="w-3 h-3 shrink-0" />
                                  Perlu verifikasi
                                </span>
                              );
                            })()}
                          </div>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            )}
          </CardContent>
        </Card>
        
        {/* ── Google Sheet (collapsed) ──────────────────────── */}
        <SheetConfigCollapsed />

        {/* ── Filters ──────────────────────────────────────── */}
        <div className="space-y-2">
          <div className="flex gap-2">
            <div className="relative flex-1">
              <Search className="absolute left-2.5 top-2.5 w-4 h-4 text-muted-foreground" />
              <Input
                placeholder="Cari keterangan, mutation key, order ID..."
                className="pl-9"
                value={filterSearch}
                onChange={e => { setFilterSearch(e.target.value); setPage(0); }}
                aria-label="Cari mutasi"
              />
            </div>
            <Button variant="outline" size="sm" className="gap-1.5 shrink-0" onClick={() => setShowAdvancedFilters(v => !v)}>
              <Settings2 className="w-3.5 h-3.5" />
              Filter
              {showAdvancedFilters ? <ChevronUp className="w-3.5 h-3.5" /> : <ChevronDown className="w-3.5 h-3.5" />}
            </Button>
          </div>

          <QuickFilterBar
            activeStatus={filterStatus}
            activeDir={filterDir}
            onStatus={v => { setFilterStatus(v); setPage(0); }}
            onDir={v => { setFilterDir(v); setPage(0); }}
            onReset={resetFilters}
          />

          {showAdvancedFilters && (
            <Card>
              <CardContent className="p-3">
                <div className="flex flex-wrap gap-2 items-end">
                  <Select value={filterProvider} onValueChange={v => { setFilterProvider(v); setPage(0); }}>
                    <SelectTrigger className="w-[140px] h-8 text-xs"><SelectValue placeholder="Provider" /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="all">Semua Provider</SelectItem>
                      <SelectItem value="GOPAY">GoPay / DAB</SelectItem>
                      <SelectItem value="OVO">OVO</SelectItem>
                      <SelectItem value="DANA">DANA</SelectItem>
                      <SelectItem value="QRIS">QRIS</SelectItem>
                      <SelectItem value="SHOPEEPAY">ShopeePay</SelectItem>
                    </SelectContent>
                  </Select>
                  <div className="flex items-center gap-1.5">
                    <DatePicker value={filterFrom} onChange={v => { setFilterFrom(v); setPage(0); }} className="w-[130px]" placeholder="Dari tanggal" />
                    <span className="text-muted-foreground text-sm">–</span>
                    <DatePicker value={filterTo} onChange={v => { setFilterTo(v); setPage(0); }} className="w-[130px]" placeholder="Sampai" />
                  </div>
                </div>
              </CardContent>
            </Card>
          )}
        </div>

        {/* ── Mutation Cards List ───────────────────────────── */}
        <div>
          <div className="flex items-center justify-between mb-3">
            <p className="text-sm text-muted-foreground">
              {isLoading ? "Memuat..." : `${total} mutasi`}
            </p>
          </div>

          {isLoading ? (
            <div className="space-y-3">
              {[1, 2, 3].map(i => (
                <Card key={i} className="animate-pulse"><CardContent className="p-4 h-24" /></Card>
              ))}
            </div>
          ) : mutations.length === 0 ? (
            <Card>
              <CardContent className="py-16 flex flex-col items-center gap-3 text-muted-foreground">
                <Search className="w-10 h-10 opacity-30" />
                <div className="text-center">
                  <p className="font-medium">Tidak ada data ditemukan</p>
                  <p className="text-sm">
                    {filterStatus !== "all" || filterDir !== "all" || filterSearch
                      ? "Coba ubah filter atau reset pencarian"
                      : "Import mutasi bank atau sync Google Sheet untuk memulai"}
                  </p>
                </div>
                {(filterStatus !== "all" || filterDir !== "all" || filterSearch) && (
                  <Button variant="outline" size="sm" onClick={resetFilters}>Reset Filter</Button>
                )}
              </CardContent>
            </Card>
          ) : (
            <div className="space-y-2" role="list" aria-label="Daftar mutasi bank">
              {mutations.map(m => (
                <MutationCard
                  key={m.id}
                  m={m}
                  onApprove={handleOpenApprove}
                  onPost={handleOpenPost}
                  onReject={handleOpenReject}
                  onReverse={handleOpenReverse}
                  onReopen={handleOpenReopen}
                  onDelete={id => deleteMut.mutate(id)}
                  onDetail={setDetailMutation}
                  onApproveQris={handleApproveQris}
                  mappingError={mappingRequiredErrors.get(m.id)}
                />
              ))}
            </div>
          )}

          {totalPages > 1 && (
            <div className="flex items-center justify-between mt-4 text-sm text-muted-foreground">
              <span>{total} mutasi total</span>
              <div className="flex items-center gap-2">
                <Button variant="outline" size="sm" disabled={page === 0} onClick={() => setPage(p => p - 1)}>← Prev</Button>
                <span className="px-2">{page + 1} / {totalPages}</span>
                <Button variant="outline" size="sm" disabled={page >= totalPages - 1} onClick={() => setPage(p => p + 1)}>Next →</Button>
              </div>
            </div>
          )}
        </div>
      </div>

      {/* ── Detail Side Panel ─────────────────────────────────── */}
      <MutationDetailPanel
        mutation={detailMutation}
        open={!!detailMutation}
        onClose={() => setDetailMutation(null)}
        onApprove={handleOpenApprove}
        onPost={handleOpenPost}
        onReject={handleOpenReject}
        onReverse={handleOpenReverse}
        onReopen={handleOpenReopen}
        onApproveQris={handleApproveQris}
        mappingError={detailMutation ? mappingRequiredErrors.get(detailMutation.id) : undefined}
        onApproveQrisBatch={handleApproveQrisBatch}
      />

      {/* ── Approve Dialog ────────────────────────────────────── */}
      <Dialog open={actionDialog?.mode === "approve"} onOpenChange={o => !o && setActionDialog(null)}>
        <DialogContent className="max-w-lg max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Approve Mutasi — Buat Draft Jurnal</DialogTitle>
          </DialogHeader>
          {actionDialog?.mode === "approve" && (
            <div className="space-y-4">
              <div className="bg-muted/40 rounded-lg p-3 space-y-1 text-sm">
                <p className="font-semibold">{actionDialog.mutation.description}</p>
                <p className="text-muted-foreground">
                  {fmtDate(actionDialog.mutation.transaction_date)}
                  · {idr(actionDialog.mutation.amount)}
                  · {actionDialog.mutation.direction === "IN" ? "Uang Masuk" : "Uang Keluar"}
                </p>
              </div>

              {/* Candidate selection */}
              {approveDialogCands.length > 0 ? (
                <div className="space-y-2">
                  <p className="text-sm font-medium">Pilih kandidat yang cocok:</p>
                  {approveDialogCands.map(c => (
                    <div
                      key={c.id}
                      className={`border rounded-lg p-3 cursor-pointer transition-all ${selectedCandidateId === c.id ? "border-primary bg-primary/5 ring-1 ring-primary" : "hover:bg-muted/40"}`}
                      onClick={() => setSelectedCandidateId(c.id)}
                      role="radio"
                      aria-checked={selectedCandidateId === c.id}
                      tabIndex={0}
                      onKeyDown={e => (e.key === "Enter" || e.key === " ") && setSelectedCandidateId(c.id)}
                    >
                      <div className="flex items-center justify-between mb-1">
                        <span className="text-sm font-medium">
                          {CANDIDATE_TYPE_LABELS[c.candidate_type] ?? c.candidate_type} #{c.candidate_id}
                        </span>
                        <ScoreBadge score={c.match_score} />
                      </div>
                      {/* Identitas kandidat — selalu tampil jika ada */}
                      {(c.details?.name || c.customer_name || c.details?.reference || c.details?.date) && (
                        <div className="text-xs rounded bg-muted/50 px-2 py-1.5 space-y-0.5">
                          {(c.details?.name || c.customer_name) && (
                            <p className="font-semibold text-foreground">{c.details?.name ?? c.customer_name}</p>
                          )}
                          <div className="flex flex-wrap gap-x-3 gap-y-0.5 text-muted-foreground">
                            {c.details?.date      && <span>📅 {fmtDate(String(c.details.date))}</span>}
                            {c.details?.reference && <span>🔖 {c.details.reference}</span>}
                            {c.details?.amount != null && <span>💰 {idr(c.details.amount)}</span>}
                          </div>
                        </div>
                      )}
                      <p className="text-xs text-muted-foreground">{c.match_reason}</p>
                      <div className="flex gap-1.5 mt-1 flex-wrap">
                        {c.amount_match   && <span className="text-[10px] text-green-600 bg-green-50 dark:bg-green-950/30 px-1.5 py-0.5 rounded">✓ Nominal</span>}
                        {c.date_match     && <span className="text-[10px] text-green-600 bg-green-50 dark:bg-green-950/30 px-1.5 py-0.5 rounded">✓ Tanggal</span>}
                        {c.name_match     && <span className="text-[10px] text-green-600 bg-green-50 dark:bg-green-950/30 px-1.5 py-0.5 rounded">✓ Nama</span>}
                        {c.order_id_match && <span className="text-[10px] text-green-600 bg-green-50 dark:bg-green-950/30 px-1.5 py-0.5 rounded">✓ Order ID</span>}
                        {c.proof_match    && <span className="text-[10px] text-green-600 bg-green-50 dark:bg-green-950/30 px-1.5 py-0.5 rounded">✓ Bukti Transfer</span>}
                      </div>
                       <CandidateDetailsBlock candidate={c} compact />
                    </div>
                  ))}
                  <div
                    className={`border rounded-lg p-3 cursor-pointer transition-all ${selectedCandidateId === -1 ? "border-primary bg-primary/5 ring-1 ring-primary" : "hover:bg-muted/40"}`}
                    onClick={() => setSelectedCandidateId(-1)}
                    role="radio"
                    aria-checked={selectedCandidateId === -1}
                    tabIndex={0}
                    onKeyDown={e => (e.key === "Enter" || e.key === " ") && setSelectedCandidateId(-1)}
                  >
                    <span className="text-sm text-muted-foreground">Approve tanpa kandidat (manual)</span>
                  </div>
                </div>
              ) : (
                <div className="space-y-2">
                  <div className="text-sm text-muted-foreground bg-amber-50 border border-amber-200 rounded-lg p-3">
                    Tidak ada kandidat. Mutasi akan di-approve tanpa pencocokan ke transaksi.
                  </div>
                  {/* COA Proposal section — shown proactively when no candidates exist.
                      Same logic as the manualReviewWarning section, but triggered upfront
                      so the user doesn't need to attempt-and-fail first. */}
                  {!manualReviewWarning && (
                    <div className="border rounded-lg p-3 space-y-2">
                      <p className="text-sm font-medium">Pilih akun COA untuk jurnal ini:</p>
                      {isSourceProposalLoading ? (
                        <span className="inline-flex items-center gap-1 text-xs text-muted-foreground">
                          <Loader2 className="w-3 h-3 animate-spin" />
                          Memeriksa proposal…
                        </span>
                      ) : isSourceProposalError ? (
                        <button
                          type="button"
                          onClick={() => {
                            const url = [
                              "/accounting/coa-proposals?new=1",
                              `sourceType=BANK_MUTATION`,
                              `sourceRecordId=${encodeURIComponent(actionDialog?.mutation?.mutation_key ?? "")}`,
                              `intent=COA_NOT_FOUND`,
                              `description=${encodeURIComponent(actionDialog?.mutation?.description ?? "")}`,
                              `direction=${encodeURIComponent(actionDialog?.mutation?.direction ?? "")}`,
                            ].join("&");
                            setActionDialog(null);
                            setLocation(url);
                          }}
                          className="inline-flex items-center gap-1 text-xs font-medium text-indigo-700 hover:text-indigo-900 bg-indigo-50 border border-indigo-200 rounded px-2 py-1"
                        >
                          ✦ Buat Proposal COA
                        </button>
                      ) : latestSourceProposal?.status === "IMPLEMENTED" ? (
                        <button
                          type="button"
                          disabled={approveMut.isPending || !latestSourceProposal.proposedCode}
                          onClick={() => {
                            const m = actionDialog?.mutation;
                            if (!m || !latestSourceProposal.proposedCode) return;
                            approveMut.mutate({
                              mutId: m.id,
                              manualCoaCode: latestSourceProposal.proposedCode,
                            });
                          }}
                          className="inline-flex items-center gap-1 text-xs font-medium text-green-700 hover:text-green-900 bg-green-50 border border-green-200 rounded px-2 py-1 disabled:opacity-50"
                        >
                          ↻ Approve dengan akun {latestSourceProposal.proposedCode || "—"}
                        </button>
                      ) : latestSourceProposal?.status === "APPROVED" ? (
                        <button
                          type="button"
                          onClick={() => {
                            setActionDialog(null);
                            setLocation(`/accounting/coa-proposals/${latestSourceProposal.id}`);
                          }}
                          className="inline-flex items-center gap-1 text-xs font-medium text-orange-700 hover:text-orange-900 bg-orange-50 border border-orange-200 rounded px-2 py-1"
                        >
                          ⚡ Terapkan Proposal #{latestSourceProposal.proposalNumber}
                        </button>
                      ) : latestSourceProposal ? (
                        <button
                          type="button"
                          onClick={() => {
                            setActionDialog(null);
                            setLocation(`/accounting/coa-proposals/${latestSourceProposal.id}`);
                          }}
                          className="inline-flex items-center gap-1 text-xs font-medium text-indigo-700 hover:text-indigo-900 bg-indigo-50 border border-indigo-200 rounded px-2 py-1"
                        >
                          ✦ Lihat Proposal COA #{latestSourceProposal.proposalNumber}
                        </button>
                      ) : (
                        <button
                          type="button"
                          onClick={() => {
                            const url = [
                              "/accounting/coa-proposals?new=1",
                              `sourceType=BANK_MUTATION`,
                              `sourceRecordId=${encodeURIComponent(actionDialog?.mutation?.mutation_key ?? "")}`,
                              `intent=COA_NOT_FOUND`,
                              `description=${encodeURIComponent(actionDialog?.mutation?.description ?? "")}`,
                              `direction=${encodeURIComponent(actionDialog?.mutation?.direction ?? "")}`,
                            ].join("&");
                            setActionDialog(null);
                            setLocation(url);
                          }}
                          className="inline-flex items-center gap-1 text-xs font-medium text-indigo-700 hover:text-indigo-900 bg-indigo-50 border border-indigo-200 rounded px-2 py-1"
                        >
                          ✦ Buat Proposal COA
                        </button>
                      )}
                      {!isSourceProposalLoading && (
                        <p className="text-xs text-muted-foreground">
                          {latestSourceProposal
                            ? latestSourceProposal.status === "IMPLEMENTED"
                              ? `Akun ${latestSourceProposal.proposedCode || "dari proposal"} sudah aktif — klik tombol di atas untuk approve.`
                              : latestSourceProposal.status === "APPROVED"
                                ? `Proposal #${latestSourceProposal.proposalNumber} sudah disetujui tapi akun belum dibuat. Klik ⚡ untuk terapkan, lalu kembali dan approve.`
                                : `Proposal ${latestSourceProposal.status.toLowerCase()} — butuh approval maker-checker.`
                            : "Belum ada proposal COA. Klik tombol di atas untuk mengusulkan akun baru."}
                        </p>
                      )}
                    </div>
                  )}
                </div>
              )}

              {/* Journal Preview (candidate-based estimate) */}
              <JournalPreview
                mutation={actionDialog.mutation}
                candidate={approveSelectedCand}
              />

              <p className="text-xs text-muted-foreground bg-blue-50 border border-blue-200 rounded p-2">
                ℹ Approve akan membuat <strong>draft jurnal</strong>. Jurnal belum diposting sampai Anda klik "Post ke Accounting".
              </p>
              {/* Phase 12: AI Review cross-link — compact, read-only, non-blocking */}
              {actionDialog?.mutation?.id && (
                <AIReviewSourcePanel
                  source="BANK_MUTATION"
                  sourceRecordId={String(actionDialog.mutation.id)}
                  transactionSnapshot={{
                    id: String(actionDialog.mutation.id),
                    description: actionDialog.mutation.description ?? '',
                    amount: Number(actionDialog.mutation.amount),
                    direction: Number(actionDialog.mutation.amount) > 0 ? 'CREDIT' : 'DEBIT',
                    transactionDate: actionDialog.mutation.transaction_date,
                  }}
                />
              )}

              {/* Task #6: manual_review_required banner — shown when backend
                  returns 422 because no specific COA mapping is available.
                  Approve and Post are disabled until the mapping is configured.
                  Task #7 Phase 20: adds "Buat Proposal COA" action for gap error codes.
                  User must click explicitly — never auto-created. */}
              {manualReviewWarning && (
                <div className="bg-amber-50 border border-amber-400 rounded-lg p-3 space-y-2">
                  <div className="flex items-center gap-2 font-semibold text-amber-800">
                    <ShieldAlert className="w-4 h-4" />
                    Review Manual Diperlukan
                  </div>
                  <p className="text-sm text-amber-700">{manualReviewWarning.error}</p>
                  <p className="text-xs text-amber-600 font-mono">Kode: {manualReviewWarning.code}</p>
                  <p className="text-xs text-amber-600">
                    Konfigurasikan mapping COA spesifik di Accounting Settings, lalu coba approve kembali.
                  </p>
                  {/* Task #7: COA proposal action — only for gap-triggering codes.
                      Shows "Lihat Proposal COA" if an existing proposal is already linked
                      to this source record; otherwise shows "Buat Proposal COA" with
                      pre-filled query params so the create form is pre-populated.
                      User must click explicitly — no auto-creation. */}
                  {(COA_GAP_CODES as readonly string[]).includes(manualReviewWarning.code ?? "") && (
                    <div className="pt-1.5 border-t border-amber-300 flex items-center gap-2 flex-wrap">
                      {/* Loading state while checking for existing proposal */}
                      {isSourceProposalLoading ? (
                        <span className="inline-flex items-center gap-1 text-xs text-amber-600">
                          <Loader2 className="w-3 h-3 animate-spin" />
                          Memeriksa proposal…
                        </span>
                      ) : isSourceProposalError ? (
                        /* Error state — fail open: allow user to create */
                        <button
                          type="button"
                          onClick={() => {
                            const url = [
                              "/accounting/coa-proposals?new=1",
                              `sourceType=BANK_MUTATION`,
                              `sourceRecordId=${encodeURIComponent(actionDialog?.mutation?.mutation_key ?? "")}`,
                              `intent=${encodeURIComponent(manualReviewWarning.code ?? "")}`,
                              `description=${encodeURIComponent(actionDialog?.mutation?.description ?? "")}`,
                              `mappingError=${encodeURIComponent(manualReviewWarning.error ?? "")}`,
                              `direction=${encodeURIComponent(actionDialog?.mutation?.direction ?? "")}`,
                            ].join("&");
                            setActionDialog(null);
                            setLocation(url);
                          }}
                          className="inline-flex items-center gap-1 text-xs font-medium text-indigo-700 hover:text-indigo-900 bg-indigo-50 border border-indigo-200 rounded px-2 py-1"
                        >
                          ✦ Buat Proposal COA
                        </button>
                      ) : latestSourceProposal ? (
                        /* Proposal exists — behaviour depends on its status.
                           IMPLEMENTED = COA sudah ada di DB, bisa langsung approve.
                           APPROVED    = COA belum dibuat, harus implement dulu.
                           lainnya     = masih butuh maker-checker. */
                        latestSourceProposal.status === "IMPLEMENTED" ? (
                          /* COA sudah dibuat — tombol ini melewati resolveContraAccount
                             dan menggunakan akun dari proposal secara langsung. */
                          <button
                            type="button"
                            disabled={approveMut.isPending || !latestSourceProposal.proposedCode}
                            onClick={() => {
                              const m = actionDialog?.mutation;
                              if (!m) return;
                              if (!latestSourceProposal.proposedCode) {
                                toast({
                                  title: "Kode COA tidak ditemukan",
                                  description: `Proposal #${latestSourceProposal.proposalNumber} tidak memiliki kode akun. Buka halaman proposal dan pastikan kode COA terisi.`,
                                  variant: "destructive",
                                });
                                return;
                              }
                              const chosen = (m.candidates ?? []).find(c => c.id === selectedCandidateId);
                              approveMut.mutate({
                                mutId: m.id,
                                matchId: chosen?.id,
                                candidateType: chosen?.candidate_type,
                                candidateId: chosen?.candidate_id,
                                candidateSource: chosen?.candidate_source ?? null,
                                manualCoaCode: latestSourceProposal.proposedCode,
                              });
                            }}
                            className="inline-flex items-center gap-1 text-xs font-medium text-green-700 hover:text-green-900 bg-green-50 border border-green-200 rounded px-2 py-1 disabled:opacity-50"
                          >
                            ↻ Approve dengan akun {latestSourceProposal.proposedCode || "—"}
                          </button>
                        ) : latestSourceProposal.status === "APPROVED" ? (
                          /* Proposal disetujui tapi COA belum dibuat — arahkan ke halaman
                             proposal untuk klik Terapkan, baru bisa approve mutasi. */
                          <button
                            type="button"
                            onClick={() => {
                              setActionDialog(null);
                              setLocation(`/accounting/coa-proposals/${latestSourceProposal.id}`);
                            }}
                            className="inline-flex items-center gap-1 text-xs font-medium text-orange-700 hover:text-orange-900 bg-orange-50 border border-orange-200 rounded px-2 py-1"
                          >
                            ⚡ Terapkan Proposal #{latestSourceProposal.proposalNumber}
                          </button>
                        ) : (
                          <button
                            type="button"
                            onClick={() => {
                              setActionDialog(null);
                              setLocation(`/accounting/coa-proposals/${latestSourceProposal.id}`);
                            }}
                            className="inline-flex items-center gap-1 text-xs font-medium text-indigo-700 hover:text-indigo-900 bg-indigo-50 border border-indigo-200 rounded px-2 py-1"
                          >
                            ✦ Lihat Proposal COA #{latestSourceProposal.proposalNumber}
                          </button>
                        )
                      ) : (
                        <button
                          type="button"
                          onClick={() => {
                            const url = [
                              "/accounting/coa-proposals?new=1",
                              `sourceType=BANK_MUTATION`,
                              `sourceRecordId=${encodeURIComponent(actionDialog?.mutation?.mutation_key ?? "")}`,
                              `intent=${encodeURIComponent(manualReviewWarning.code ?? "")}`,
                              `description=${encodeURIComponent(actionDialog?.mutation?.description ?? "")}`,
                              `mappingError=${encodeURIComponent(manualReviewWarning.error ?? "")}`,
                              `direction=${encodeURIComponent(actionDialog?.mutation?.direction ?? "")}`,
                            ].join("&");
                            setActionDialog(null);
                            setLocation(url);
                          }}
                          className="inline-flex items-center gap-1 text-xs font-medium text-indigo-700 hover:text-indigo-900 bg-indigo-50 border border-indigo-200 rounded px-2 py-1"
                        >
                          ✦ Buat Proposal COA
                        </button>
                      )}
                      {!isSourceProposalLoading && (
                        <span className="text-xs text-amber-600">
                          {latestSourceProposal
                            ? latestSourceProposal.status === "IMPLEMENTED"
                              ? `Akun ${latestSourceProposal.proposedCode || "dari proposal"} sudah aktif — tombol Approve di bawah sudah siap digunakan.`
                              : latestSourceProposal.status === "APPROVED"
                                ? `Proposal #${latestSourceProposal.proposalNumber} sudah disetujui tapi akun belum dibuat. Klik ⚡ untuk terapkan proposal (buat akun), lalu kembali ke sini dan approve mutasi.`
                                : `Proposal ${latestSourceProposal.status.toLowerCase()} — butuh approval maker-checker sebelum bisa diterapkan.`
                            : "AI akan mengusulkan akun baru — membutuhkan approval maker-checker."}
                        </span>
                      )}
                    </div>
                  )}
                </div>
              )}
            </div>
          )}
          <DialogFooter>
            <Button variant="outline" onClick={() => { setActionDialog(null); setManualReviewWarning(null); }}>Batal</Button>
            <Button
              className="gap-1.5 bg-green-600 hover:bg-green-700"
              onClick={handleConfirmApprove}
              disabled={
                approveMut.isPending ||
                (approveDialogCands.length > 0 && selectedCandidateId === null) ||
                // Keep disabled only when a review error exists AND no ready COA to resolve it.
                // When resolvedManualCoaCode is set, the button re-enables and passes that code.
                (!!manualReviewWarning && !resolvedManualCoaCode)
              }
              title={
                manualReviewWarning && !resolvedManualCoaCode
                  ? "Selesaikan review manual sebelum approve"
                  : resolvedManualCoaCode
                    ? `Approve mutasi menggunakan akun ${resolvedManualCoaCode}`
                    : undefined
              }
            >
              {approveMut.isPending ? <Loader2 className="w-4 h-4 animate-spin" /> : <CheckCircle2 className="w-4 h-4" />}
              {approveMut.isPending
                ? "Menyimpan..."
                : resolvedManualCoaCode
                  ? `Approve dengan akun ${resolvedManualCoaCode}`
                  : "Approve & Buat Draft Jurnal"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ── Post Accounting Dialog ────────────────────────────── */}
      <Dialog open={actionDialog?.mode === "post"} onOpenChange={o => !o && setActionDialog(null)}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <ReceiptText className="w-5 h-5 text-yellow-600" />
              Post ke Accounting
            </DialogTitle>
          </DialogHeader>
          {actionDialog?.mode === "post" && (
            <div className="space-y-4">
              <div className="bg-muted/40 rounded-lg p-3 text-sm space-y-1">
                <p className="font-semibold">{actionDialog.mutation.description}</p>
                <p className="text-muted-foreground">
                  {fmtDate(actionDialog.mutation.transaction_date)} · {idr(actionDialog.mutation.amount)}
                </p>
                {actionDialog.mutation.journal_entry_id && (
                  <p className="text-yellow-700 text-xs mt-1">
                    Draft Jurnal #{actionDialog.mutation.journal_entry_id} akan dipromosikan ke status <strong>posted</strong>.
                  </p>
                )}
              </div>

              {/* Show actual draft journal lines */}
              {actionDialog.mutation.journal_entry_id && (
                <JournalEntryLines
                  entryId={actionDialog.mutation.journal_entry_id}
                  onStatusLoaded={setPostDialogJournalStatus}
                />
              )}

              {postDialogJournalStatus === "posted" ? (
                <p className="text-sm text-amber-700 bg-amber-50 border border-amber-200 rounded-md px-3 py-2 flex items-center gap-2">
                  <AlertTriangle className="w-4 h-4 shrink-0" />
                  Jurnal ini sudah berstatus <strong>posted</strong> — tidak perlu diposting ulang.
                </p>
              ) : (
                <p className="text-sm text-muted-foreground">
                  Tindakan ini akan <strong>memposting jurnal ke buku besar</strong>. Setelah diposting, jurnal tidak dapat diedit — hanya bisa di-reverse.
                </p>
              )}
            </div>
          )}
          <DialogFooter>
            <Button variant="outline" onClick={() => setActionDialog(null)}>Batal</Button>
            {postDialogJournalStatus === "posted" ? (
              <Button variant="outline" className="gap-1.5 cursor-not-allowed opacity-60" disabled>
                <CheckCircle2 className="w-4 h-4 text-green-600" />
                Sudah Diposting
              </Button>
            ) : (
              <Button
                className="gap-1.5 bg-yellow-600 hover:bg-yellow-700"
                onClick={() => actionDialog && postMut.mutate(actionDialog.mutation.id)}
                disabled={postMut.isPending || postDialogJournalStatus === null}
              >
                {postMut.isPending ? <Loader2 className="w-4 h-4 animate-spin" /> : <ReceiptText className="w-4 h-4" />}
                {postMut.isPending ? "Memposting..." : "Post ke Accounting"}
              </Button>
            )}
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ── Reject Dialog ─────────────────────────────────────── */}
      <Dialog open={actionDialog?.mode === "reject"} onOpenChange={o => !o && setActionDialog(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Tolak Mutasi</DialogTitle>
          </DialogHeader>
          {actionDialog?.mode === "reject" && (
            <div className="space-y-3">
              <div className="bg-muted/40 rounded-lg p-3 text-sm space-y-1">
                <p className="font-medium">{actionDialog.mutation.description}</p>
                <p className="text-muted-foreground">
                  {fmtDate(actionDialog.mutation.transaction_date)} · {idr(actionDialog.mutation.amount)}
                </p>
              </div>
              <p className="text-sm text-muted-foreground">
                Mutasi ini akan ditandai sebagai <strong>Ditolak</strong>. Semua kandidat match akan diabaikan dan tidak ada journal yang dibuat.
              </p>
            </div>
          )}
          <DialogFooter>
            <Button variant="outline" onClick={() => setActionDialog(null)}>Batal</Button>
            <Button
              variant="destructive"
              className="gap-1.5"
              onClick={() => actionDialog && rejectMut.mutate(actionDialog.mutation.id)}
              disabled={rejectMut.isPending}
            >
              {rejectMut.isPending ? <Loader2 className="w-4 h-4 animate-spin" /> : <XCircle className="w-4 h-4" />}
              {rejectMut.isPending ? "Menyimpan..." : "Tolak Mutasi"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ── Reverse / Void Dialog ─────────────────────────────── */}
      <Dialog open={actionDialog?.mode === "reverse"} onOpenChange={o => { if (!o) { setActionDialog(null); setReverseReason(""); } }}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <RotateCcw className="w-5 h-5 text-gray-600" />
              Reverse / Void Journal
            </DialogTitle>
          </DialogHeader>
          {actionDialog?.mode === "reverse" && (
            <div className="space-y-4">
              <div className="bg-muted/40 rounded-lg p-3 text-sm space-y-1">
                <p className="font-semibold">{actionDialog.mutation.description}</p>
                <p className="text-muted-foreground">
                  {fmtDate(actionDialog.mutation.transaction_date)} · {idr(actionDialog.mutation.amount)}
                </p>
                {actionDialog.mutation.journal_entry_id && (
                  <p className="text-xs text-gray-600 mt-1">Journal Entry #{actionDialog.mutation.journal_entry_id}</p>
                )}
              </div>

              <div className="space-y-1.5">
                <label className="text-sm font-medium">Alasan Pembatalan <span className="text-red-500">*</span></label>
                <Textarea
                  placeholder="Contoh: Kesalahan pencatatan, double entry, dll."
                  value={reverseReason}
                  onChange={e => setReverseReason(e.target.value)}
                  rows={3}
                  className="resize-none"
                />
              </div>

              <div className="rounded-md bg-red-50 border border-red-200 p-3 text-xs text-red-800 space-y-1">
                <p className="font-semibold">⚠ Perhatian</p>
                <p>Tindakan ini akan membuat <strong>journal entry reversal</strong> baru yang membalik semua entry jurnal asli.</p>
                <p>Journal asli tidak dihapus. Mutasi akan berstatus <strong>Dibatalkan</strong>.</p>
              </div>
            </div>
          )}
          <DialogFooter>
            <Button variant="outline" onClick={() => { setActionDialog(null); setReverseReason(""); }}>Batal</Button>
            <Button
              variant="destructive"
              className="gap-1.5"
              onClick={() => actionDialog && voidMut.mutate({ mutId: actionDialog.mutation.id, reason: reverseReason })}
              disabled={voidMut.isPending || !reverseReason.trim()}
            >
              {voidMut.isPending ? <Loader2 className="w-4 h-4 animate-spin" /> : <RotateCcw className="w-4 h-4" />}
              {voidMut.isPending ? "Memproses..." : "Reverse Journal"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ── QRIS Batch Approval Confirmation ─────────────────── */}
      <AlertDialog open={!!qrisBatchConfirm} onOpenChange={open => { if (!open) setQrisBatchConfirm(null); }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle className="flex items-center gap-2">
              <CheckCircle2 className="w-5 h-5 text-indigo-600" />
              Setujui QRIS Batch Settlement?
            </AlertDialogTitle>
            <AlertDialogDescription asChild>
              <div className="space-y-2 text-sm">
                <p>
                  Anda akan membuat settlement QRIS untuk{" "}
                  <strong>{qrisBatchConfirm?.paymentCount ?? 0} sport payment</strong>{" "}
                  dengan total netto{" "}
                  <strong>{qrisBatchConfirm ? idr(qrisBatchConfirm.netAmount) : "—"}</strong>{" "}
                  dari provider <strong>{qrisBatchConfirm?.providerCode}</strong>.
                </p>
                <p className="text-orange-700 dark:text-orange-400 font-medium">
                  Tindakan ini tidak dapat dibatalkan. Setelah disetujui, settlement akan
                  terhubung ke mutasi bank dan muncul sebagai kandidat rekonsiliasi.
                </p>
              </div>
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel onClick={() => setQrisBatchConfirm(null)}>Batal</AlertDialogCancel>
            <AlertDialogAction
              className="bg-indigo-600 hover:bg-indigo-700 text-white"
              onClick={handleConfirmQrisBatch}
              disabled={approveQrisBatchMut.isPending}
            >
              {approveQrisBatchMut.isPending ? "Menyetujui..." : "Ya, Setujui Batch"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* ── Delete All Confirmation ───────────────────────────── */}
      <AlertDialog open={showDeleteAll} onOpenChange={setShowDeleteAll}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Hapus Semua Mutasi?</AlertDialogTitle>
            <AlertDialogDescription>
              Semua data mutasi bank yang sudah di-sync akan dihapus permanen, termasuk hasil matching dan audit log-nya. Tindakan ini tidak bisa dibatalkan.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Batal</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              onClick={() => { setShowDeleteAll(false); deleteAllMut.mutate(); }}
              disabled={deleteAllMut.isPending}
            >
              {deleteAllMut.isPending ? "Menghapus..." : "Hapus Semua"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </AppShell>
  );
}
