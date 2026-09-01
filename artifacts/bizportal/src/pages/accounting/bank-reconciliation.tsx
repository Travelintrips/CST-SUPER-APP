import React, { useState, useCallback, useEffect, useRef } from "react";
import { DatePicker } from "@/components/ui/date-picker";
import { AppShell } from "@/components/layout/AppShell";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from "@/components/ui/dialog";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from "@/components/ui/alert-dialog";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Separator } from "@/components/ui/separator";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { Checkbox } from "@/components/ui/checkbox";
import { useToast } from "@/hooks/use-toast";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import {
  Upload, Play, RefreshCw, CheckCircle2, XCircle, AlertTriangle,
  Search, Trash2, ArrowLeft, CloudDownload,
  Wifi, WifiOff, Loader2, ShieldAlert, Plus, Settings2, Building2,
  ChevronDown, ChevronUp, ArrowUpRight, ArrowDownLeft, Zap, Eye,
  BookOpen, TrendingUp, Clock, FileText, CreditCard, Users,
  CircleCheck, CircleDot, ReceiptText, X, Undo2, RotateCcw,
  Paperclip, ImageIcon, ExternalLink, Pencil,
} from "lucide-react";
import { Link, useLocation } from "wouter";
import { AIReviewSourcePanel } from "@/components/ai-review";
import { useCompany } from "@/contexts/CompanyContext";
import {
  getAvailableQrisPaymentIds as getAvailableQrisPaymentIdsFromCandidate,
  getQrisCandidatePresentationState,
  getUnconfirmedQrisPaymentIds,
} from "@/lib/qrisCandidatePresentation";
import {
  classifyBankMutationPaymentType,
  isInhouseBankTransferDescription,
  isQrisBankApprovalAllowed,
} from "@/lib/bankMutationPaymentType";

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
  bank_account_number: string | null;
  bank_name: string | null;
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

type WorkflowStage = "sync" | "matching" | "candidates" | "review";

// ── Mapping-Required Error (Task #6: Fail-Closed Journal Mapping) ─────────────
interface MappingRequiredError {
  code: string;
  message: string;
  manual_review_required: true;
}

// Real statuses from bank_mutations.status (backend contract):
//   unmatched             → mutation synced but no candidate found
//   matched               → candidate(s) found by matching engine
//   manual_review         → match found but journal safeguard requires a reviewer
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
    bank_account_number: "",
    bank_name: "",
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
    setForm({ company_id: "", label: "", sheet_id: "", bank_account_number: "", bank_name: "", tab_name: "Mutasi_Bank" });
    setShowForm(true);
  };

  const openEdit = (cfg: SheetConfig) => {
    setEditTarget(cfg);
    setForm({
      company_id: cfg.company_id ? String(cfg.company_id) : "",
      label: cfg.label,
      sheet_id: cfg.sheet_id,
      bank_account_number: cfg.bank_account_number ?? "",
      bank_name: cfg.bank_name ?? "",
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
      bank_account_number: form.bank_account_number.trim() || null,
      bank_name: form.bank_name.trim() || null,
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
      // Sync inserts into bank_mutations, so refresh both the mutation list
      // and its status summary. Without this, the page keeps showing the
      // cached "0 mutasi" result until a full browser reload.
      qc.invalidateQueries({ queryKey: ["bank-reconciliation"] });
      qc.invalidateQueries({ queryKey: ["bank-reconciliation-summary"] });
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
                    {cfg.bank_name && <span>Bank: <code className="bg-muted px-1 rounded">{cfg.bank_name}</code></span>}
                    {cfg.bank_account_number && <span>No. Rek: <code className="bg-muted px-1 rounded">{cfg.bank_account_number}</code></span>}
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
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <label className="text-sm font-medium">Nama Bank</label>
                <Input
                  placeholder="Contoh: BCA"
                  value={form.bank_name}
                  onChange={e => setForm(f => ({ ...f, bank_name: e.target.value }))}
                />
              </div>
              <div className="space-y-1.5">
                <label className="text-sm font-medium">Nomor Rekening</label>
                <Input
                  inputMode="numeric"
                  placeholder="Contoh: 1234567890"
                  value={form.bank_account_number}
                  onChange={e => setForm(f => ({ ...f, bank_account_number: e.target.value }))}
                />
              </div>
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
  | "manual_review"
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
  paymentMethod?: string | null;
  status?: string | null;
  paymentType?: string | null;
  paymentProvider?: string | null;
  sportPaymentType?: "bank_transfer" | "qris" | "paylabs" | null;
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
  sport_payment_type?: "bank_transfer" | "qris" | "paylabs" | null;
  provider_order_id: string | null;
  status: MutationStatus;
  matched_payment_id: number | null;
  matched_order_id: number | null;
  candidates: Candidate[] | null;
  /** Provider-aware QRIS candidate. Audit-only; never used by approve/post. */
  qris_candidate_audit?: QrisCandidateAudit | null;
  /** All provider-aware QRIS candidates for this mutation, ordered by live evidence. */
  qris_candidate_audits?: QrisCandidateAudit[] | null;
  /** Latest QRIS candidate retained for diagnostics, even when it is outside the reviewable H-1 cohort. */
  qris_candidate_diagnostic?: QrisCandidateAudit | null;
  uploaded_proof_url?: string | null;
  source?: string;
  import_batch_id?: number | null;
  reconciliation_status?: string | null;
  linked_transaction_type?: string | null;
  linked_transaction_id?: number | null;
  journal_entry_id?: number | null;
  posted_at?: string | null;
  posted_by?: string | null;
  review_reason?: string | null;
  review_code?: string | null;
}

interface CoaAccountReference {
  id: number;
  code: string;
  name: string;
  type: string;
  isActive: boolean;
  isPostable?: boolean;
  isHeader?: boolean;
  parentId?: number | null;
  normalBalance?: "DEBIT" | "CREDIT" | string;
  companyId?: number | null;
}

const CANONICAL_SETTLEMENT_SOURCE = "sport_center.payment_settlement_batches";

interface QrisCandidateAudit {
  id?: number;
  mutation_id: number;
  company_id?: number | null;
  provider_code: string;
  mutation_source_classification: string;
  source_date: string;
  estimated_settlement_date: string | null;
  gross_amount: number | string;
  net_amount: number | string;
  observed_deduction: number | string;
  effective_deduction_rate: number | string | null;
  reconciliation_status: string;
  confidence: number | string;
  review_reason?: string | null;
  payment_items?: QrisPaymentItem[];
  settled_payment_ids?: Array<number | string> | null;
  current_payment_ids?: Array<number | string> | null;
  unconfirmed_payment_ids?: Array<number | string> | null;
  current_payment_amounts?: Record<string, number | string> | null;
  current_gross_amount?: number | string | null;
  current_expected_amount?: number | string | null;
  current_evidence_valid?: boolean | null;
  /** Exact posted canonical batch left unlinked by an interrupted approval. */
  recoverable_settlement_id?: number | string | null;
  candidate_source?: string | null;
  description?: string | null;
  status?: string | null;
  diagnostic_bank_date?: string | null;
  diagnostic_payment_count?: number | null;
  diagnostic_has_expected_dates?: boolean | null;
  diagnostic_date_match?: boolean | null;
  diagnostic_amount_difference?: number | string | null;
}

interface QrisPaymentItem {
  paymentId?: number;
  payment_id?: number;
  providerName?: string | null;
  provider_name?: string | null;
  grossAmount?: number | string | null;
  gross_amount?: number | string | null;
  expectedSettlementDate?: string | null;
  settlementRuleVersion?: string | null;
  bookingNumber?: string | null;
  paymentNumber?: string | null;
  paymentDate?: string | null;
  paidAt?: string | null;
  paid_at?: string | null;
  confirmedAt?: string | null;
  confirmed_at?: string | null;
  payment_number?: string | null;
  booking_id?: number | null;
  booking_number?: string | null;
  customerName?: string | null;
  customer_name?: string | null;
  facilityName?: string | null;
  facility_name?: string | null;
  bookingDate?: string | null;
  booking_date?: string | null;
  date?: string | null;
  expected_settlement_date?: string | null;
  startTime?: string | null;
  start_time?: string | null;
  endTime?: string | null;
  end_time?: string | null;
}

type QrisApprovalSelection = {
  candidate: QrisCandidateAudit;
  paymentIds: number[];
};

const QRIS_SELECTION_CONFLICT_MESSAGE =
  "Sebagian transaksi yang dipilih sudah masuk settlement sebelumnya. Daftar kandidat sudah diperbarui.";

type QrisSelectionConflictError = Error & {
  code?: string;
  alreadySettledPaymentIds?: number[];
  conflictingPaymentIds?: number[];
  eligiblePaymentIds?: number[];
  staleCandidateId?: number;
  currentPaymentIds?: number[];
  currentExpectedAmount?: number;
};

// ─────────────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────────────

const idr = (n: number | string) =>
  "Rp " + new Intl.NumberFormat("id-ID").format(Number(n) || 0);

const idrWhole = (n: number | string) =>
  idr(Math.round(Number(n) || 0));

const JAKARTA_TIMEZONE = "Asia/Jakarta";

const calendarDateInJakarta = (value: string | Date | null | undefined): string => {
  if (value == null) return "";
  const raw = value instanceof Date ? "" : String(value).trim();
  if (/^\d{4}-\d{2}-\d{2}$/.test(raw)) return raw;
  const parsed = value instanceof Date ? value : new Date(raw);
  if (Number.isNaN(parsed.getTime())) return "";
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: JAKARTA_TIMEZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(parsed);
  const byType = new Map(parts.map(part => [part.type, part.value]));
  return `${byType.get("year")}-${byType.get("month")}-${byType.get("day")}`;
};

const fmtDate = (d: string) => {
  if (!d) return "-";
  const calendarDate = calendarDateInJakarta(d);
  if (!calendarDate) return d;
  try {
    return new Date(`${calendarDate}T12:00:00.000Z`).toLocaleDateString("id-ID", {
      day: "numeric",
      month: "short",
      year: "numeric",
      timeZone: JAKARTA_TIMEZONE,
    });
  } catch {
    return d;
  }
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

type SportPaymentType = "bank_transfer" | "qris" | "paylabs";

const SPORT_PAYMENT_TYPE_LABELS: Record<SportPaymentType, string> = {
  bank_transfer: "Transfer Bank",
  qris: "QRIS",
  paylabs: "Paylabs",
};

const SPORT_PAYMENT_TYPE_STYLES: Record<SportPaymentType, string> = {
  bank_transfer: "border-slate-300 bg-slate-50 text-slate-700 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-300",
  qris: "border-indigo-300 bg-indigo-50 text-indigo-700 dark:border-indigo-800 dark:bg-indigo-950 dark:text-indigo-300",
  paylabs: "border-violet-300 bg-violet-50 text-violet-700 dark:border-violet-800 dark:bg-violet-950 dark:text-violet-300",
};

function sportPaymentTypeLabel(type: SportPaymentType | null | undefined): string | null {
  return type ? SPORT_PAYMENT_TYPE_LABELS[type] : null;
}

// Backend status → Indonesian UI label mapping
// SOURCE: bank_mutations.status values from bankReconciliation.ts routes
const STATUS_LABELS: Record<string, string> = {
  unmatched:               "Transaksi Belum Lengkap",
  matched:                 "Cocok",
  manual_review:           "Review Manual",
  duplicate_need_review:   "Perlu Diperiksa",
  approved_pending_posting:"Sudah Dicocokkan",
  approved:                "Sudah Dicocokkan",
  posted:                  "Sudah Diposting",
  rejected:                "Ditolak",
  void:                    "Dibatalkan",
};

const STATUS_COLORS: Record<string, string> = {
  unmatched:               "bg-amber-50 text-amber-800 border-amber-200 dark:bg-amber-950 dark:text-amber-300",
  matched:                 "bg-green-50 text-green-700 border-green-200 dark:bg-green-950 dark:text-green-400",
  manual_review:            "bg-orange-50 text-orange-800 border-orange-300 dark:bg-orange-950 dark:text-orange-300",
  duplicate_need_review:   "bg-amber-50 text-amber-800 border-amber-200 dark:bg-amber-950 dark:text-amber-300",
  approved_pending_posting:"bg-yellow-50 text-yellow-700 border-yellow-200 dark:bg-yellow-950 dark:text-yellow-400",
  approved:                "bg-green-50 text-green-700 border-green-200 dark:bg-green-950 dark:text-green-400",
  posted:                  "bg-green-50 text-green-700 border-green-200 dark:bg-green-950 dark:text-green-400",
  rejected:                "bg-red-50 text-red-600 border-red-200 dark:bg-red-950 dark:text-red-400",
  void:                    "bg-gray-100 text-gray-500 border-gray-200 dark:bg-gray-900/30 dark:text-gray-400",
};

const QRIS_AUDIT_STATUS_LABELS: Record<string, string> = {
  MATCHED: "Cocok",
  REVIEW: "Perlu Diperiksa",
  UNMATCHED: "Transaksi Belum Lengkap",
};

const CARD_BORDER: Record<string, string> = {
  unmatched:               "border-l-4 border-l-amber-400",
  matched:                 "border-l-4 border-l-blue-400",
  manual_review:            "border-l-4 border-l-orange-500",
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
  m.status === "unmatched" || m.status === "matched" ||
  m.status === "manual_review" || m.status === "duplicate_need_review";

/** Post ke Accounting → promotes draft journal to posted. */
const canPost = (m: BankMutation) =>
  m.status === "approved_pending_posting" &&
  !m.candidates?.some(c => c.candidate_source === CANONICAL_SETTLEMENT_SOURCE);

/** Reject → hanya sebelum posted. */
const canReject = (m: BankMutation) =>
  m.status === "unmatched" || m.status === "matched" ||
  m.status === "manual_review" || m.status === "duplicate_need_review" ||
  m.status === "approved_pending_posting";

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

function canonicalSettlementCandidateForMutation(m: BankMutation): Candidate | undefined {
  return visibleCandidates(m).find(candidate =>
    candidate.candidate_type === "qris_settlement"
    && candidate.candidate_source === CANONICAL_SETTLEMENT_SOURCE,
  );
}

function isCanonicalSettlementManualOverrideEligible(m: BankMutation): boolean {
  const candidate = canonicalSettlementCandidateForMutation(m);
  const settlementStatus = String(candidate?.details?.settlementStatus ?? "").toLowerCase();
  return canApprove(m)
    && candidate != null
    && settlementStatus === "posted";
}

function isCanonicalSettlementApprovalEligible(m: BankMutation): boolean {
  const candidate = canonicalSettlementCandidateForMutation(m);
  if (!candidate || !isCanonicalSettlementManualOverrideEligible(m)) return false;
  return candidate.amount_match && candidate.date_match;
}

function qrisAuditsForMutation(m: BankMutation): QrisCandidateAudit[] {
  // Candidate metadata is not allowed to turn an InhouseTrf transfer into a
  // QRIS approval. Other Mandiri statement markers, including SA/KR, are
  // enrichment only and remain eligible for resolver-based approval.
  const bankEvidence = [
    m.provider_name,
    m.provider_order_id,
    m.description,
    m.normalized_description,
  ];
  if (bankEvidence.some(value => isInhouseBankTransferDescription(value))) {
    return [];
  }
  const audits = Array.isArray(m.qris_candidate_audits) && m.qris_candidate_audits.length > 0
    ? m.qris_candidate_audits
    : m.qris_candidate_audit
      ? [m.qris_candidate_audit]
      : [];
  // Once the candidate has been generated from QRIS payments, provider
  // labels in the bank description are enrichment only. In particular,
  // Mandiri's SA/KR markers must not hide an approvable H-1 candidate.
  return audits.filter((audit) =>
    !["stale", "superseded", "ineligible"].includes(String(audit.status ?? "").toLowerCase())
    // H-1 is an exact settlement cohort: candidate expected settlement date
    // must be the same calendar date as the bank mutation.
    && isSameCalendarDate(m.transaction_date, audit.estimated_settlement_date)
    && (audit.payment_items ?? []).every((item) =>
      isSameCalendarDate(
        m.transaction_date,
        item.expectedSettlementDate ?? item.expected_settlement_date,
      ),
    ),
  );
}

function QrisCandidateDiagnosticBlock({
  mutation,
  diagnostic,
  compact = false,
}: {
  mutation: BankMutation;
  diagnostic?: QrisCandidateAudit | null;
  compact?: boolean;
}) {
  const bankDate = String(diagnostic?.diagnostic_bank_date ?? mutation.transaction_date ?? "").slice(0, 10);
  const expectedDate = diagnostic?.estimated_settlement_date
    ? String(diagnostic.estimated_settlement_date).slice(0, 10)
    : null;
  const items = diagnostic?.payment_items ?? [];
  const itemCount = Number(diagnostic?.diagnostic_payment_count ?? items.length);
  const hasProvider = Boolean(
    diagnostic?.provider_code
      && !["unknown", "unidentified"].includes(String(diagnostic.provider_code).toLowerCase()),
  );
  const hasExpectedDates = diagnostic?.diagnostic_has_expected_dates
    ?? items.every(item => Boolean(item.expectedSettlementDate ?? item.expected_settlement_date));
  const dateMatches = diagnostic?.diagnostic_date_match
    ?? Boolean(expectedDate && bankDate && expectedDate === bankDate && items.every(item =>
      isSameCalendarDate(bankDate, item.expectedSettlementDate ?? item.expected_settlement_date),
    ));
  const bankAmount = numericValue(mutation.amount) ?? 0;
  const candidateNet = numericValue(diagnostic?.net_amount);
  const amountDifference = diagnostic?.diagnostic_amount_difference != null
    ? numericValue(diagnostic.diagnostic_amount_difference)
    : candidateNet == null ? null : bankAmount - candidateNet;
  const amountMatches = amountDifference == null || Math.abs(amountDifference) < 1;
  const status = String(diagnostic?.reconciliation_status ?? "UNMATCHED").toUpperCase();

  const checks = [
    {
      label: "Payment sumber",
      ok: itemCount > 0,
      detail: itemCount > 0 ? `${itemCount} payment QRIS ditemukan` : "Tidak ada payment QRIS yang ditemukan",
    },
    {
      label: "Tanggal settlement",
      ok: dateMatches && hasExpectedDates,
      detail: !expectedDate
        ? "Belum ada tanggal settlement"
        : !hasExpectedDates
          ? `Sebagian payment belum memiliki expected settlement date (mutasi ${fmtDate(bankDate)})`
          : dateMatches
            ? `Sesuai mutasi bank: ${fmtDate(expectedDate)}`
            : `Kandidat ${fmtDate(expectedDate)} ≠ mutasi bank ${fmtDate(bankDate)}`,
    },
    {
      label: "Provider",
      ok: hasProvider,
      detail: hasProvider ? String(diagnostic?.provider_code) : "Provider belum dikenali",
    },
    {
      label: "Nominal netto",
      ok: amountMatches,
      detail: candidateNet == null
        ? "Belum tersedia"
        : `${idr(candidateNet)} vs mutasi ${idr(bankAmount)}`
          + (!amountMatches ? ` (selisih ${idr(Math.abs(amountDifference ?? 0))})` : ""),
    },
  ];
  const failedChecks = checks.filter(check => !check.ok);

  return (
    <div className={`mt-2 rounded-md border border-indigo-300 bg-indigo-950 px-3 py-2.5 text-xs text-white dark:border-indigo-700 ${compact ? "space-y-1.5" : "space-y-2"}`}>
      <div className="flex items-start gap-2">
        <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0 text-indigo-200" />
        <div className="min-w-0">
          <p className="font-semibold text-white">
            {diagnostic ? "Kenapa belum dapat diselesaikan?"
              : "Detail kandidat QRIS belum tersedia"}
          </p>
          <p className="mt-0.5 leading-relaxed text-white">
            {diagnostic
              ? failedChecks.length > 0
                ? `${failedChecks.length} syarat belum terpenuhi. Status pemeriksaan: ${status}.`
                : "Kandidat ada, tetapi belum masuk cohort settlement yang dapat direview."
              : "Sistem belum menyimpan hasil pemeriksaan untuk mutasi ini. Jalankan pencarian kandidat QRIS terlebih dahulu."}
          </p>
        </div>
      </div>
      {diagnostic && (
        <div className="space-y-1 rounded border border-indigo-700/80 bg-slate-950/40 px-2 py-1.5">
          {checks.map(check => (
            <div key={check.label} className="flex items-start gap-1.5">
              <span className={check.ok ? "text-emerald-300" : "text-amber-300"} aria-hidden="true">
                {check.ok ? "✓" : "!"}
              </span>
              <span className="min-w-0">
                <span className="font-medium text-white">{check.label}:</span>{" "}
                <span className="text-white">{check.detail}</span>
              </span>
            </div>
          ))}
          {diagnostic.review_reason && (
            <p className="border-t border-indigo-700/70 pt-1 text-white">
              Alasan sistem: <span className="font-medium text-white">{diagnostic.review_reason}</span>
            </p>
          )}
        </div>
      )}
    </div>
  );
}

function statusLabel(m: BankMutation): string {
  if (m.status === "approved") return STATUS_LABELS.approved;
  if (m.status === "posted") return STATUS_LABELS.posted;
  if (m.status === "rejected") return STATUS_LABELS.rejected;
  if (m.status === "void") return STATUS_LABELS.void;
  if (m.status === "approved_pending_posting") return STATUS_LABELS.approved_pending_posting;
  if (m.status === "manual_review") return STATUS_LABELS.manual_review;
  if (isCanonicalSettlementApprovalEligible(m)) return "Siap Direconcile";
  if (isCanonicalSettlementManualOverrideEligible(m)) return "Override Manual Tersedia";
  if (isQrisMutation(m) && qrisAuditsForMutation(m).length === 0) return "Perlu Kandidat QRIS";
  if (m.status === "duplicate_need_review" || hasUnresolvedVariance(m)) return "Perlu Diperiksa";
  if (m.status === "unmatched" && visibleCandidates(m).length > 0) return "Perlu Diperiksa";
  if (m.status === "unmatched" || !m.candidates?.length) return "Transaksi Belum Lengkap";
  return isExactMatch(m) ? "Cocok" : "Perlu Diperiksa";
}

function statusColor(m: BankMutation): string {
  if (m.status === "rejected" || m.status === "void") return STATUS_COLORS[m.status] ?? "";
  if (m.status === "approved_pending_posting") return STATUS_COLORS.approved_pending_posting;
  if (m.status === "approved" || m.status === "posted") return STATUS_COLORS.approved;
  if (m.status === "manual_review") return STATUS_COLORS.manual_review;
  if (isCanonicalSettlementApprovalEligible(m)) return STATUS_COLORS.matched;
  if (isCanonicalSettlementManualOverrideEligible(m)) return STATUS_COLORS.manual_review;
  if (isQrisMutation(m) && qrisAuditsForMutation(m).length === 0) return STATUS_COLORS.duplicate_need_review;
  if (m.status === "duplicate_need_review" || hasUnresolvedVariance(m)) return STATUS_COLORS.duplicate_need_review;
  if (m.status === "unmatched" && visibleCandidates(m).length > 0) return STATUS_COLORS.duplicate_need_review;
  if (m.status === "unmatched" || !m.candidates?.length) return STATUS_COLORS.unmatched;
  return isExactMatch(m) ? STATUS_COLORS.matched : STATUS_COLORS.duplicate_need_review;
}

interface ReconciliationEvidence {
  bankAmount: number;
  foundAmount: number;
  deduction: number;
  expectedAmount: number;
  missingAmount: number;
  transactions: Array<{
    label: string;
    amount: number;
    date?: string | null;
    customer?: string | null;
    facility?: string | null;
  }>;
}

const numericValue = (value: number | string | null | undefined): number | null => {
  if (value == null || value === "") return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
};

function qrisPaymentGross(
  item: QrisPaymentItem,
  liveAmounts?: Record<string, number | string> | null,
): number {
  const paymentId = item.paymentId ?? item.payment_id;
  const liveAmount = paymentId == null
    ? null
    : numericValue(liveAmounts?.[String(paymentId)]);
  return liveAmount
    ?? numericValue(item.grossAmount ?? item.gross_amount)
    ?? 0;
}

/**
 * Canonical payment-date presentation for QRIS candidates.
 * `paid_at` remains the preferred source. Historical confirmed payments may
 * legitimately have `paid_at` empty, so fall back to `confirmed_at` instead
 * of making the candidate appear undated. Persisted backfill/mirror sync is
 * still handled by the API/database layer; this helper only keeps every UI
 * path consistent while that canonicalization is applied.
 */
function qrisPaymentDateValue(item: QrisPaymentItem): string | null {
  const value = item.paymentDate
    ?? item.paidAt
    ?? item.paid_at
    ?? item.confirmedAt
    ?? item.confirmed_at
    ?? item.date
    ?? null;
  if (value == null || String(value).trim() === "") return null;
  return String(value);
}

function hasUnresolvedVariance(m: BankMutation): boolean {
  const candidate = visibleCandidates(m)[0];
  const d = candidate?.details;
  const qrisAudit = qrisAuditsForMutation(m)[0];
  const variance = numericValue(d?.varianceAmount ?? d?.amountDifference);
  return Boolean(
    d?.settlementPartial ||
    (variance != null && Math.abs(variance) >= 0.01) ||
    qrisAuditsForMutation(m).some((audit) =>
      ["REVIEW", "UNMATCHED"].includes(String(audit.reconciliation_status ?? "").toUpperCase()),
    ) ||
    ["REVIEW", "UNMATCHED"].includes(String(qrisAudit?.reconciliation_status ?? "").toUpperCase()),
  );
}

function isExactMatch(m: BankMutation): boolean {
  const candidate = visibleCandidates(m)[0];
  if (!candidate || m.status !== "matched" || hasUnresolvedVariance(m)) return false;
  // A same-day, same-amount bank transfer is selectable for reviewer
  // confirmation even when it has no reference/proof bonus. The backend still
  // validates the selected match and COA mapping inside its transaction.
  return Boolean(candidate.amount_match && candidate.date_match);
}

function isUiApprovalEligible(m: BankMutation): boolean {
  // This is deliberately stricter than the backend action guard. The server
  // remains the final authority; the UI only avoids offering an unsafe action.
  // QRIS must use the canonical batch settlement flow. The generic bank
  // mutation approval creates a normal draft journal and must never be shown
  // for a QRIS mutation, even when its legacy sport_payment candidate happens
  // to look like an exact match.
  return canApprove(m) && isExactMatch(m) && !isQrisMutation(m);
}

/**
 * Manual-review mutations use the generic journal endpoint, but must never
 * enter the QRIS/canonical settlement flow. The COA dialog is the explicit
 * reviewer action for this state.
 */
function isManualReviewActionable(m: BankMutation): boolean {
  return m.status === "manual_review"
    && !isQrisMutation(m)
    && !isCanonicalSettlementMutation(m);
}

const LEGACY_REFERENCE_COA_ATTEMPT_NOT_RECORDED = "REFERENCE_COA_ATTEMPT_NOT_RECORDED";

function isLegacyReferenceCoaRetryable(m: BankMutation): boolean {
  return m.status === "manual_review"
    && m.review_code === LEGACY_REFERENCE_COA_ATTEMPT_NOT_RECORDED
    && !isQrisMutation(m)
    && !isCanonicalSettlementMutation(m);
}

function isRuleAutoPostRetryable(m: BankMutation, candidates: Candidate[]): boolean {
  return m.status === "manual_review"
    && m.review_code === "AUTO_POST_GUARD"
    && !isQrisMutation(m)
    && !isCanonicalSettlementMutation(m)
    && candidates.some(candidate =>
      candidate.candidate_type === "recon_rule"
      && Number(candidate.match_score) >= 100
      && String(candidate.status).toLowerCase() !== "approved"
    );
}

function mutationHeading(m: BankMutation): string {
  return `${m.direction === "IN" ? "Uang Masuk" : "Uang Keluar"} ${idr(m.amount)}`;
}

function mutationSourceLabel(m: BankMutation): string {
  const hasQrisCandidate = qrisAuditsForMutation(m).length > 0 || m.candidates?.some(c =>
    c.candidate_type === "qris_settlement" || c.candidate_type === "sport_payment"
  );
  const bankPaymentType = classifyBankMutationPaymentType({
    providerName: m.provider_name,
    providerOrderId: m.provider_order_id,
    description: m.description,
    normalizedDescription: m.normalized_description,
  });
  if (bankPaymentType === "bank_transfer") {
    return m.direction === "IN" ? "Transfer Bank" : "Bank";
  }
  if (hasQrisCandidate && bankPaymentType === "qris") {
    return "QRIS Sport Center";
  }
  if (bankPaymentType === "qris") return m.provider_name || "QRIS";
  if (bankPaymentType === "paylabs") return m.provider_name || "Paylabs";
  return m.provider_name || (m.direction === "IN" ? "Rekening Bank" : "Bank");
}

function isPaylabsMutation(m: BankMutation): boolean {
  return classifyBankMutationPaymentType({
    providerName: m.provider_name,
    providerOrderId: m.provider_order_id,
    description: m.description,
    normalizedDescription: m.normalized_description,
  }) === "paylabs";
}

function isInhouseBankTransferMutation(m: BankMutation): boolean {
  return [m.description, m.normalized_description]
    .some(isInhouseBankTransferDescription);
}

function isQrisMutation(m: BankMutation): boolean {
  if (qrisAuditsForMutation(m).length > 0) return true;
  return classifyBankMutationPaymentType({
    providerName: m.provider_name,
    providerOrderId: m.provider_order_id,
    description: m.description,
    normalizedDescription: m.normalized_description,
  }) === "qris";
}

function sportPaymentTypeFromDetails(details?: CandidateDetails | null): SportPaymentType | null {
  if (!details) return null;
  const paymentMethod = String(details.paymentMethod ?? details.method ?? "").toLowerCase();
  // The payment method is the rail. Prefer it over a stale derived
  // sportPaymentType/paymentType value from an older candidate snapshot.
  if (paymentMethod.includes("transfer") || paymentMethod.includes("bank")) {
    return "bank_transfer";
  }
  if (paymentMethod.includes("qris")) {
    return /paylabs/i.test(String(details.paymentProvider ?? ""))
      ? "paylabs"
      : "qris";
  }
  if (details.sportPaymentType) return details.sportPaymentType;
  if (/paylabs/i.test(String(details.paymentProvider ?? ""))) return "paylabs";
  if (/paylabs/i.test(String(details.paymentType ?? "")) || /paylabs/i.test(String(details.method ?? ""))) return "paylabs";
  if (/qris/i.test(String(details.paymentType ?? "")) || /qris/i.test(String(details.method ?? ""))) return "qris";
  if (details.sourceType === "sport_center") return "bank_transfer";
  return null;
}

function candidateSportPaymentType(candidate: Candidate | undefined, mutation: BankMutation): SportPaymentType | null {
  if (!candidate) return mutation.sport_payment_type ?? (isPaylabsMutation(mutation) ? "paylabs" : isQrisMutation(mutation) ? "qris" : null);
  if (candidate.candidate_type === "qris_settlement") return "qris";
  if (candidate.candidate_type !== "sport_payment") return null;
  return sportPaymentTypeFromDetails(candidate.details) ?? mutation.sport_payment_type ?? null;
}

function mutationSportPaymentType(mutation: BankMutation): SportPaymentType | null {
  const best = visibleCandidates(mutation)[0];
  const paymentType = candidateSportPaymentType(best, mutation) ?? mutation.sport_payment_type ?? null;
  if (paymentType) return paymentType;
  return isInhouseBankTransferMutation(mutation) ? "bank_transfer" : null;
}

function hasQrisCandidateEvidenceMismatch(mutation: BankMutation): boolean {
  const best = visibleCandidates(mutation)[0];
  return candidateSportPaymentType(best, mutation) === "qris"
    && !isQrisBankApprovalAllowed({
      providerName: mutation.provider_name,
      providerOrderId: mutation.provider_order_id,
      description: mutation.description,
      normalizedDescription: mutation.normalized_description,
    });
}

function isSameCalendarDate(left: string | null | undefined, right: string | null | undefined): boolean {
  if (!left || !right) return false;
  return calendarDateInJakarta(left) === calendarDateInJakarta(right);
}

function isQrisCandidate(candidate: Candidate, mutation: BankMutation): boolean {
  if (candidate.candidate_type === "qris_settlement") return true;
  if (candidate.candidate_type !== "sport_payment") return false;

  // `sport_payment` identifies the source table, not the payment method.
  // Canonical Sport Center payments can be QRIS or ordinary bank transfers.
  // Prefer the persisted payment method; fall back to the bank mutation for
  // older candidate rows that were saved before method was included in details.
  return candidateSportPaymentType(candidate, mutation) === "qris";
}

function isBankTransferCandidate(candidate: Candidate, mutation: BankMutation): boolean {
  if (candidate.candidate_type !== "sport_payment") return true;
  return candidateSportPaymentType(candidate, mutation) === "bank_transfer";
}

function normalizeCandidateBusinessReference(reference: string): string {
  return reference
    .trim()
    .toUpperCase()
    .replace(/^(?:INV-|TENANT-)/, "");
}

function candidateBusinessIdentity(candidate: Candidate): string | null {
  const details = candidate.details;
  const reference = details?.paymentNumber ?? details?.reference;
  if (!reference) return null;

  const normalizedReference = normalizeCandidateBusinessReference(String(reference));
  if (!normalizedReference) return null;

  if (
    (candidate.candidate_type === "sport_payment" || candidate.candidate_type === "accounting_payment") &&
    /^(?:SCPAY-|SPORT-)/.test(normalizedReference)
  ) {
    return `sport-payment:${normalizedReference}`;
  }

  if (
    (candidate.candidate_type === "invoice" || candidate.candidate_type === "tenant_invoice") &&
    /^PAY-/.test(normalizedReference)
  ) {
    return `payment-document:${normalizedReference}`;
  }

  return null;
}

function candidateBusinessPriority(candidate: Candidate): number {
  switch (candidate.candidate_type) {
    case "sport_payment": return 100;
    case "qris_settlement": return 90;
    case "tenant_invoice": return 60;
    case "invoice": return 50;
    case "accounting_payment": return 40;
    default: return 0;
  }
}

/** Candidates shown to reviewers and used for approval.
 *
 * QRIS is the only flow whose candidate visibility is gated by settlement
 * date. For non-QRIS/manual-rule candidates, amount and date are evidence
 * shown to the reviewer, not hard requirements that hide the candidate.
 * `sport_payment` is not automatically QRIS: its payment method decides
 * which contract applies.
 */
function visibleCandidates(m: BankMutation): Candidate[] {
  const seen = new Set<string>();
  const eligible = (m.candidates ?? [])
    .filter(candidate => {
      const requiresQrisEvidence = isQrisCandidate(candidate, m);
      const candidateDate = candidate.details?.settlementDate ?? candidate.details?.date;
      // Only QRIS keeps the settlement-date visibility gate. Generic bank
      // transfers and manual-rule candidates remain reviewable even when
      // amount/date flags are false.
      const dateEligible = !requiresQrisEvidence
        || isSameCalendarDate(m.transaction_date, candidateDate);
      const identity = [
        candidate.candidate_type,
        candidate.candidate_id,
        candidate.candidate_source ?? "<historical-null>",
      ].join(":");
      if (!dateEligible || seen.has(identity)) return false;
      seen.add(identity);
      return true;
    });

  const seenBusiness = new Map<string, Candidate>();
  for (const candidate of eligible) {
    const businessIdentity = candidateBusinessIdentity(candidate);
    if (!businessIdentity) continue;
    const existing = seenBusiness.get(businessIdentity);
    if (!existing || candidateBusinessPriority(candidate) > candidateBusinessPriority(existing)) {
      seenBusiness.set(businessIdentity, candidate);
    }
  }

  return eligible.filter(candidate => {
    const businessIdentity = candidateBusinessIdentity(candidate);
    return !businessIdentity || seenBusiness.get(businessIdentity) === candidate;
  });
}

function reconciliationEvidence(m: BankMutation): ReconciliationEvidence {
  const candidate = visibleCandidates(m)[0];
  const d = candidate?.details;
  const audit = m.qris_candidate_audit ?? qrisAuditsForMutation(m)[0];
  const bankAmount = numericValue(d?.actualBankAmount) ?? numericValue(m.amount) ?? 0;
  const expectedAmount =
    numericValue(d?.expectedAmount) ??
    numericValue(d?.netAmount) ??
    numericValue(audit?.net_amount) ??
    numericValue(candidate?.details?.amount) ??
    0;
  const foundAmount =
    numericValue(d?.expectedAmount) ??
    numericValue(d?.netAmount) ??
    numericValue(audit?.net_amount) ??
    numericValue(d?.amount) ??
    0;
  const deduction =
    numericValue(d?.mdrAmount) ??
    numericValue(audit?.observed_deduction) ??
    (numericValue(d?.taxWithheldAmount) ?? 0) + (numericValue(d?.otherFeeAmount) ?? 0);
  const authoritativeVariance = numericValue(d?.varianceAmount ?? d?.amountDifference);
  const missingAmount = Math.abs(authoritativeVariance ?? Math.max(0, bankAmount - expectedAmount));

  const settlementItems = d?.settlementItems ?? [];
  const auditItems = audit?.payment_items ?? [];
  const transactions: ReconciliationEvidence["transactions"] = settlementItems.length > 0
    ? settlementItems.map((item, index) => ({
        label: item.paymentNumber ?? `Booking ${item.bookingId != null ? `SC-${String(item.bookingId).padStart(4, "0")}` : `#${index + 1}`}`,
        amount: numericValue(item.netAmount ?? item.grossAmount) ?? 0,
        date: null,
        customer: null,
        facility: "Sport Center",
      }))
    : auditItems.map((item, index) => ({
        label: item.bookingNumber ?? item.booking_number ?? item.paymentNumber ?? item.payment_number ?? `Transaksi #${index + 1}`,
        amount: numericValue(item.grossAmount ?? item.gross_amount) ?? 0,
        date: qrisPaymentDateValue(item),
        customer: null,
        facility: "Sport Center",
      }));
  if (transactions.length === 0 && candidate) {
    transactions.push({
      label: `${CANDIDATE_TYPE_LABELS[candidate.candidate_type] ?? candidate.candidate_type} #${candidate.candidate_id}`,
      amount: numericValue(d?.amount ?? d?.netAmount ?? d?.expectedAmount) ?? 0,
      date: d?.date,
      customer: d?.name ?? candidate.customer_name,
      facility: d?.sourceType === "sport_center" ? "Sport Center" : null,
    });
  }

  return { bankAmount, foundAmount, deduction, expectedAmount, missingAmount, transactions };
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
    { label: "Jenis payment", value: sportPaymentTypeLabel(d.sportPaymentType) },
    { label: "Metode", value: d.paymentMethod ?? d.method },
    { label: "Tipe", value: d.paymentType ?? d.documentType },
    { label: "Provider", value: d.paymentProvider },
    { label: "Status", value: d.status },
    { label: "Memo / Catatan", value: d.memo },
  ].filter(row => row.value != null && String(row.value).trim() !== "");

  if (rows.length === 0) return null;

  return (
    <div className={`min-w-0 rounded-md bg-muted/35 border border-dashed space-y-1 ${compact ? "p-2 mt-1.5" : "p-2.5 mt-2"}`}>
      <p className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
        Detail transaksi sumber
      </p>
      {d.settlementPartial && (
        <p className="text-[10px] font-medium text-amber-700 bg-amber-50 border border-amber-200 rounded px-2 py-1">
          Settlement QRIS PARTIAL — hanya sebagian dana/provider batch yang sudah tersettle; perlu review sebelum dianggap lunas.
        </p>
      )}
      {hasVarianceEvidence && (
        <div className="rounded-md border border-amber-300 bg-amber-50 px-2.5 py-2 text-[11px] text-amber-950 dark:border-amber-800 dark:bg-amber-950 dark:text-amber-100">
          <div className="flex items-center justify-between gap-2">
            <p className="font-semibold">Variance settlement QRIS</p>
            <Badge variant="outline" className="border-amber-400 bg-amber-100 text-amber-900 dark:border-amber-700 dark:bg-amber-950 dark:text-amber-200">
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
      <div className={`min-w-0 grid ${compact ? "grid-cols-1" : "grid-cols-1 sm:grid-cols-[minmax(0,auto)_minmax(0,1fr)]"} gap-x-3 gap-y-1`}>
        {rows.map(row => (
          <React.Fragment key={row.label}>
            <span className="min-w-0 text-[10px] text-muted-foreground">{row.label}</span>
            <span className={`min-w-0 text-xs font-medium ${compact ? "" : "sm:text-right"} break-all`}>
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
  const hasPaymentDetails = items.some(item =>
    item.bookingNumber
    || item.paymentNumber
    || qrisPaymentDateValue(item),
  );

  return (
    <Collapsible open={open} onOpenChange={setOpen} className={compact ? "mt-1.5" : "mt-2"}>
      <CollapsibleTrigger asChild>
        <button
          type="button"
          className="flex w-full items-center justify-between gap-2 rounded border border-amber-200 bg-amber-100/70 px-2 py-1.5 text-left text-[11px] font-medium text-amber-950 transition-colors hover:bg-amber-100 dark:border-amber-800 dark:bg-amber-950 dark:text-amber-100"
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
          {!hasPaymentDetails && (
            <p className="px-1 text-[10px] text-muted-foreground">
              Metadata payment belum tersedia
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
              {qrisPaymentDateValue(item) && (
                <span className="text-muted-foreground">
                  Dibayar {fmtDate(qrisPaymentDateValue(item)!)}
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

function JournalEntryLines({
  entryId,
  companyId,
  onStatusLoaded,
}: {
  entryId: number;
  companyId?: number | null;
  onStatusLoaded?: (status: string) => void;
}) {
  const { data, isLoading, error } = useQuery({
    queryKey: ["accounting-entry", entryId, companyId],
    queryFn: async () => {
      const params = new URLSearchParams();
      if (Number.isInteger(companyId) && Number(companyId) > 0) {
        params.set("companyId", String(companyId));
      }
      const query = params.toString();
      const r = await fetch(`/api/accounting/entries/${entryId}${query ? `?${query}` : ""}`, { credentials: "include" });
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
    return <JournalEntryLines entryId={journalEntryId} companyId={mutation.company_id} />;
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
  { id: 3, label: "Kandidat QRIS",      icon: CreditCard },
  { id: 4, label: "Review / Approve",   icon: CheckCircle2 },
  { id: 5, label: "Posting Accounting", icon: ReceiptText },
  { id: 6, label: "Selesai",            icon: CircleCheck },
];

function StepProgressBar({
  summaryMap,
  workflowStage,
}: {
  summaryMap: Record<string, { count: number; amount: number }>;
  workflowStage: WorkflowStage;
}) {
  const totalMutations =
    (summaryMap.unmatched?.count ?? 0) +
    (summaryMap.matched?.count ?? 0) +
    (summaryMap.manual_review?.count ?? 0) +
    (summaryMap.duplicate_need_review?.count ?? 0) +
    (summaryMap.approved_pending_posting?.count ?? 0) +
    (summaryMap.posted?.count ?? 0) +
    (summaryMap.rejected?.count ?? 0) +
    (summaryMap.void?.count ?? 0);

  const hasAny     = totalMutations > 0;
  const hasMatched = (summaryMap.matched?.count ?? 0) + (summaryMap.approved_pending_posting?.count ?? 0) + (summaryMap.posted?.count ?? 0) > 0;
  const hasPendingPost  = (summaryMap.approved_pending_posting?.count ?? 0) > 0;
  const hasPosted       = (summaryMap.posted?.count ?? 0) > 0;
  const hasApproved     = (summaryMap.approved?.count ?? 0) > 0;
  const allProcessed    = hasAny &&
    (summaryMap.unmatched?.count ?? 0) === 0 &&
    (summaryMap.matched?.count ?? 0) === 0 &&
    (summaryMap.manual_review?.count ?? 0) === 0 &&
    (summaryMap.duplicate_need_review?.count ?? 0) === 0 &&
    (summaryMap.approved_pending_posting?.count ?? 0) === 0;

  const activeStep =
    hasPendingPost ? 5 :
    allProcessed && (hasApproved || hasPosted) ? 6 :
    workflowStage === "sync" ? 1 :
    workflowStage === "matching" ? 2 :
    workflowStage === "candidates" ? 3 :
    !hasAny ? 1 :
    !hasMatched ? 2 :
    !hasPendingPost && !hasPosted ? 4 :
    allProcessed ? 6 : 4;

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
      icon: CheckCircle2,
      label: "Siap Disetujui",
      count: summaryMap.matched?.count ?? 0,
      iconClass: "text-green-500",
      bg: "hover:bg-green-50 dark:hover:bg-green-950/20",
    },
    {
      key: "manual_review",
      icon: ShieldAlert,
      label: "Review Manual",
      count: summaryMap.manual_review?.count ?? 0,
      iconClass: "text-orange-500",
      bg: "hover:bg-orange-50 dark:hover:bg-orange-950/20",
    },
    {
      key: "duplicate_need_review",
      icon: AlertTriangle,
      label: "Perlu Diperiksa",
      count: summaryMap.duplicate_need_review?.count ?? 0,
      iconClass: "text-amber-500",
      bg: "hover:bg-amber-50 dark:hover:bg-amber-950/20",
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
      label: "Selesai",
      count: (summaryMap.posted?.count ?? 0) + (summaryMap.approved?.count ?? 0),
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
        (summaryMap.manual_review?.amount ?? 0) +
        (summaryMap.duplicate_need_review?.amount ?? 0) +
        (summaryMap.approved_pending_posting?.amount ?? 0) +
        (summaryMap.posted?.amount ?? 0) +
        (summaryMap.approved?.amount ?? 0),
      iconClass: "text-purple-500",
      bg: "hover:bg-purple-50 dark:hover:bg-purple-950/20",
    },
  ];

  return (
    <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3">
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
  onGenerateQrisCandidates,
  onApproveAll,
  onPostAll,
  onSyncSheet,
  matchingPending,
  matchingBackgroundPending,
  qrisGenerationPending,
  syncPending,
  workflowStage,
}: {
  summaryMap: Record<string, { count: number; amount: number }>;
  onRunMatching: (mode?: "new" | "retry_unmatched" | "rematch_non_final") => void;
  onGenerateQrisCandidates?: () => void;
  onApproveAll: () => void;
  onPostAll: () => void;
  onSyncSheet: () => void;
  matchingPending: boolean;
  matchingBackgroundPending: boolean;
  qrisGenerationPending: boolean;
  syncPending: boolean;
  workflowStage: WorkflowStage;
}) {
  const unmatched     = summaryMap.unmatched?.count ?? 0;
  const matched       = summaryMap.matched?.count ?? 0;
  const manualReview  = summaryMap.manual_review?.count ?? 0;
  const needReview    = (summaryMap.duplicate_need_review?.count ?? 0) + manualReview;
  const pendingPost   = summaryMap.approved_pending_posting?.count ?? 0;

  if (unmatched === 0 && matched === 0 && needReview === 0 && pendingPost === 0 && !onGenerateQrisCandidates) {
    return (
      <Card className="border-green-200 bg-green-50/50 dark:bg-green-950 dark:border-green-800">
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
        <div className="mb-3 rounded-md border border-indigo-200 bg-indigo-50/70 px-3 py-2 text-xs text-indigo-950 dark:border-indigo-800 dark:bg-indigo-950/40 dark:text-indigo-100">
          <p className="font-semibold">Urutan operasional aman</p>
          <p className="mt-0.5 text-indigo-800/80 dark:text-indigo-200/80">
            1. Sync mutasi bank <span className="mx-1">→</span>
            2. Tunggu matching selesai <span className="mx-1">→</span>
            3. Generate kandidat QRIS <span className="mx-1">→</span>
            4. Review / approve QRIS
          </p>
        </div>
        <div className="flex flex-col sm:flex-row gap-3">
          {/* Step 2: belum match / review historis yang aman dievaluasi ulang */}
          {(unmatched > 0 || manualReview > 0) && (
            <div className="flex-1 rounded-lg border bg-background p-3 space-y-2">
              <div className="flex items-start gap-2">
                <AlertTriangle className="w-4 h-4 text-amber-500 mt-0.5 shrink-0" />
                <div>
                  <p className="text-sm font-semibold">
                    {unmatched > 0
                      ? `${unmatched} Mutasi Belum Dicocokkan`
                      : `${manualReview} Review Manual Perlu Dievaluasi Ulang`}
                  </p>
                  <p className="text-xs text-muted-foreground">
                    {unmatched === 0
                      ? "Jalankan ulang matching untuk mengevaluasi rule terbaru. Safeguard jurnal tetap berlaku."
                      : workflowStage === "sync"
                      ? "Sync mutasi bank terlebih dahulu"
                      : matchingBackgroundPending
                        ? "Matching sedang berjalan di background"
                        : "Jalankan AI untuk mencocokkan otomatis"}
                  </p>
                </div>
              </div>
              <Button
                size="sm"
                className="w-full gap-1.5"
                onClick={() => onRunMatching(unmatched > 0 ? "new" : "rematch_non_final")}
                disabled={matchingPending || matchingBackgroundPending || workflowStage !== "matching"}
              >
                {matchingPending || matchingBackgroundPending
                  ? <Loader2 className="w-3.5 h-3.5 animate-spin" />
                  : <Zap className="w-3.5 h-3.5" />}
                {matchingPending || matchingBackgroundPending
                  ? "Menunggu matching selesai..."
                  : workflowStage === "sync"
                    ? "Sync mutasi terlebih dahulu"
                    : unmatched > 0
                      ? "Jalankan AI Matching"
                      : "Jalankan Ulang Matching"}
              </Button>
              <div className="flex gap-2">
                {unmatched > 0 && (
                  <Button
                    size="sm"
                    variant="ghost"
                    className="flex-1 text-xs"
                    onClick={() => onRunMatching("retry_unmatched")}
                    disabled={matchingPending || matchingBackgroundPending || workflowStage !== "matching"}
                  >
                    Coba Lagi Unmatched
                  </Button>
                )}
                <Button
                  size="sm"
                  variant="ghost"
                  className="flex-1 text-xs"
                  onClick={() => onRunMatching("rematch_non_final")}
                  disabled={matchingPending || matchingBackgroundPending || workflowStage !== "matching"}
                >
                  {unmatched > 0 ? "Re-match Belum Final" : "Evaluasi Rule Terbaru"}
                </Button>
              </div>
            </div>
          )}

          {/* Step 3: generate QRIS candidates */}
          {onGenerateQrisCandidates && (
            <div className="flex-1 rounded-lg border border-indigo-200 bg-indigo-50/40 dark:border-indigo-800 dark:bg-indigo-950/20 p-3 space-y-2">
              <div className="flex items-start gap-2">
                <CreditCard className="w-4 h-4 text-indigo-600 mt-0.5 shrink-0" />
                <div>
                  <p className="text-sm font-semibold">Kandidat QRIS</p>
                  <p className="text-xs text-muted-foreground">
                    {workflowStage === "candidates"
                      ? "Matching selesai, kandidat siap dibuat untuk direview"
                      : "Tombol aktif setelah matching selesai"}
                  </p>
                </div>
              </div>
              <Button
                size="sm"
                variant="outline"
                className="w-full gap-1.5 border-indigo-300 text-indigo-700 hover:bg-indigo-100 dark:border-indigo-700 dark:text-indigo-300"
                onClick={onGenerateQrisCandidates}
                disabled={qrisGenerationPending || matchingPending || matchingBackgroundPending || workflowStage !== "candidates"}
              >
                {qrisGenerationPending
                  ? <Loader2 className="w-3.5 h-3.5 animate-spin" />
                  : <CreditCard className="w-3.5 h-3.5" />}
                {qrisGenerationPending ? "Membuat kandidat..." : "Generate Kandidat QRIS"}
              </Button>
            </div>
          )}

          {/* Step 4: siap approve */}
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

          {/* Step 5: menunggu posting */}
          {pendingPost > 0 && (
            <div className="flex-1 rounded-lg border border-yellow-200 bg-yellow-50/50 dark:bg-yellow-950 dark:border-yellow-800 p-3 space-y-2">
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

          {/* Review manual */}
          {needReview > 0 && (
            <div className="flex-1 rounded-lg border border-orange-200 bg-orange-50/50 dark:bg-orange-950 dark:border-orange-800 p-3 space-y-2">
              <div className="flex items-start gap-2">
                <AlertTriangle className="w-4 h-4 text-orange-500 mt-0.5 shrink-0" />
                <div>
                  <p className="text-sm font-semibold text-orange-800 dark:text-orange-300">
                    {needReview} Transaksi Perlu Review
                  </p>
                  <p className="text-xs text-orange-600 dark:text-orange-400">Transaksi ini perlu review manual</p>
                </div>
              </div>
            </div>
          )}

          {/* Sync shortcut */}
          <div className="flex-none flex flex-col gap-2 sm:w-auto">
            <Button
              size="sm"
              variant="outline"
              className="gap-1.5 whitespace-nowrap"
              onClick={onSyncSheet}
              disabled={syncPending || matchingPending || matchingBackgroundPending || qrisGenerationPending}
            >
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
  { label: "Siap Disetujui",     status: "matched" },
  { label: "Review Manual",      status: "manual_review" },
  { label: "Perlu Diperiksa",    status: "duplicate_need_review" },
  { label: "Menunggu Posting",   status: "approved_pending_posting" },
  { label: "Selesai",            status: "posted" },
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

// ── COA Reference Dialog ──────────────────────────────────────────────────────
// A bank mutation can create a reusable manual rule. This keeps the selected
// account useful for the current review and for future mutations with the same
// bank description, without silently changing the chart of accounts.
function CoaReferenceDialog({
  mutation,
  open,
  activeCompanyId,
  onClose,
  onSaved,
}: {
  mutation: BankMutation | null;
  open: boolean;
  activeCompanyId: number | null;
  onClose: () => void;
  onSaved: () => void | Promise<void>;
}) {
  const { toast } = useToast();
  const qc = useQueryClient();
  const [search, setSearch] = useState("");
  const [selectedCode, setSelectedCode] = useState("");
  const [conditionValue, setConditionValue] = useState("");
  const [saving, setSaving] = useState<"rule" | "current" | null>(null);
  const [creatingCoa, setCreatingCoa] = useState(false);
  const [creating, setCreating] = useState(false);
  const [newCoaRole, setNewCoaRole] = useState<"parent" | "child">("child");
  const [parentSearch, setParentSearch] = useState("");
  const [newCoaForm, setNewCoaForm] = useState({
    code: "",
    name: "",
    type: "asset",
    parentId: null as number | null,
  });

  const companyId = mutation?.company_id ?? activeCompanyId;
  // The bank account is the opposite side of the selected COA:
  // IN = bank debit, so the contra account is credit;
  // OUT = bank credit, so the contra account is debit.
  const contraNormalBalance = mutation?.direction === "IN" ? "CREDIT" : "DEBIT";
  const { data: accountData, isLoading: accountsLoading, refetch: refetchAccounts } = useQuery({
    queryKey: ["coa-reference-accounts", companyId],
    queryFn: async () => {
      const params = new URLSearchParams({
        companyId: String(companyId),
        postableOnly: "true",
      });
      const response = await fetch(`/api/accounting/accounts?${params.toString()}`, { credentials: "include" });
      if (!response.ok) throw new Error("Daftar COA tidak dapat dimuat");
      return response.json() as Promise<CoaAccountReference[]>;
    },
    enabled: open && companyId != null,
    staleTime: 60_000,
  });
  const {
    data: parentAccountData,
    isLoading: parentAccountsLoading,
    refetch: refetchParentAccounts,
  } = useQuery({
    queryKey: ["coa-reference-parent-accounts", companyId],
    queryFn: async () => {
      const params = new URLSearchParams({ companyId: String(companyId) });
      params.set("includeHeaders", "true");
      const response = await fetch(`/api/accounting/accounts?${params.toString()}`, { credentials: "include" });
      if (!response.ok) throw new Error("Daftar parent COA tidak dapat dimuat");
      return response.json() as Promise<CoaAccountReference[]>;
    },
    enabled: creatingCoa && companyId != null,
    staleTime: 60_000,
  });

  useEffect(() => {
    if (!open || !mutation) return;
    setSearch("");
    setSelectedCode("");
    setConditionValue(mutation.normalized_description || mutation.description || "");
    setSaving(null);
    setCreatingCoa(false);
    setCreating(false);
    setNewCoaRole("child");
    setParentSearch("");
    setNewCoaForm({
      code: "",
      name: "",
      type: mutation.direction === "IN" ? "liability" : "asset",
      parentId: null,
    });
  }, [open, mutation]);

  const accounts = (accountData ?? [])
    // The API already excludes headers. Keep this guard for older API
    // responses/cached data so parent COAs never become selectable references.
    .filter(account => account.isActive !== false && account.isPostable !== false)
    .sort((a, b) => a.code.localeCompare(b.code));
  const visibleAccounts = accounts.filter(account => {
    const query = search.trim().toLowerCase();
    return !query || `${account.code} ${account.name} ${account.type}`.toLowerCase().includes(query);
  });
  const selectedAccount = accounts.find(account => account.code === selectedCode) ?? null;
  const allowedNewCoaTypes = contraNormalBalance === "CREDIT"
    ? [
        { value: "liability", label: "Liabilitas" },
        { value: "equity", label: "Ekuitas" },
        { value: "revenue", label: "Pendapatan" },
      ]
    : [
        { value: "asset", label: "Aset" },
        { value: "expense", label: "Beban" },
      ];
  const parentAccounts = (parentAccountData ?? [])
    .filter(account =>
      account.isActive !== false &&
      account.type === newCoaForm.type &&
      (account.companyId == null || account.companyId === companyId),
    )
    .sort((a, b) => a.code.localeCompare(b.code));
  const filteredParentAccounts = parentAccounts.filter(account => {
    const query = parentSearch.trim().toLowerCase();
    return !query || `${account.code} ${account.name}`.toLowerCase().includes(query);
  });
  const canApplyCurrent =
    !!mutation &&
    canApprove(mutation) &&
    !isQrisMutation(mutation) &&
    !isCanonicalSettlementMutation(mutation) &&
    (mutation.status === "manual_review" || visibleCandidates(mutation).length === 0);

  const startCreateCoa = () => {
    setCreatingCoa(true);
    setNewCoaRole("child");
    setParentSearch("");
    setNewCoaForm(form => ({
      ...form,
      name: search.trim() || "",
      parentId: null,
    }));
  };

  const nextSequentialCoaCode = (account: CoaAccountReference): string => {
    const match = account.code.match(/^(.*?)(\d+)([^0-9]*)$/);
    if (!match) return "";

    const [, prefix, digits, suffix] = match;
    const usedSiblingNumbers = new Set(
      accounts
      .map(candidate => candidate.code.match(/^(.*?)(\d+)([^0-9]*)$/))
      .filter((candidate): candidate is RegExpMatchArray =>
        !!candidate && candidate[1] === prefix && candidate[3] === suffix,
      )
      .map(candidate => Number(candidate[2]))
      .filter(Number.isFinite),
    );
    let nextNumber = Number(digits) + 1;
    while (usedSiblingNumbers.has(nextNumber)) nextNumber += 1;
    return `${prefix}${String(nextNumber).padStart(digits.length, "0")}${suffix}`;
  };

  const startCreateCoaFromAccount = (account: CoaAccountReference) => {
    const code = nextSequentialCoaCode(account);
    setCreatingCoa(true);
    setNewCoaRole("child");
    setParentSearch("");
    setNewCoaForm({
      code,
      name: account.name,
      type: account.type,
      parentId: account.id,
    });
  };

  const createCoa = async () => {
    if (!companyId) {
      toast({ title: "Perusahaan aktif belum dipilih", variant: "destructive" });
      return;
    }
    const code = newCoaForm.code.trim();
    const name = newCoaForm.name.trim();
    if (!code || !name) {
      toast({ title: "Kode dan nama COA wajib diisi", variant: "destructive" });
      return;
    }
    if (newCoaRole === "child" && !newCoaForm.parentId) {
      toast({ title: "Pilih parent untuk COA child", variant: "destructive" });
      return;
    }

    setCreating(true);
    try {
      const response = await fetch("/api/accounting/accounts", {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          companyId,
          code,
          name,
          type: newCoaForm.type,
          parentId: newCoaRole === "child" ? newCoaForm.parentId : null,
          isActive: true,
          accountCategory: newCoaForm.type.toUpperCase(),
          normalBalance: contraNormalBalance,
          isHeader: newCoaRole === "parent",
          isPostable: newCoaRole !== "parent",
        }),
      });
      const body = await response.json().catch(() => ({}));
      if (!response.ok) {
        throw new Error(body.message ?? body.error ?? "Gagal membuat COA baru");
      }

      const created = body as CoaAccountReference;
      await refetchAccounts();
      await refetchParentAccounts();
      setSelectedCode(created.code ?? code);
      setSearch("");
      setCreatingCoa(false);
      toast({
        title: "COA baru berhasil dibuat",
        description: `${created.code ?? code} — ${created.name ?? name} siap dipakai sebagai referensi.`,
      });
    } catch (error) {
      toast({
        title: "Gagal membuat COA baru",
        description: error instanceof Error ? error.message : String(error),
        variant: "destructive",
      });
    } finally {
      setCreating(false);
    }
  };

  const save = async (applyCurrent: boolean) => {
    if (!mutation) return;
    if (!companyId) {
      toast({ title: "Perusahaan aktif belum dipilih", variant: "destructive" });
      return;
    }
    if (!selectedAccount) {
      toast({ title: "Pilih akun COA terlebih dahulu", variant: "destructive" });
      return;
    }
    const condition = conditionValue.trim();
    if (!condition) {
      toast({ title: "Referensi aturan belum diisi", variant: "destructive" });
      return;
    }

    setSaving(applyCurrent ? "current" : "rule");
    try {
      const ruleResponse = await fetch("/api/bank-reconciliation/rules", {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          company_id: companyId,
          name: `COA ${mutation.direction === "IN" ? "Uang Masuk" : "Uang Keluar"} — ${condition.slice(0, 60)}`,
          description: `Dibuat dari referensi mutasi bank #${mutation.id}: ${mutation.description}`,
          priority: 120,
          is_active: true,
          direction: mutation.direction,
          condition_field: "description",
          condition_operator: "contains",
          condition_value: condition,
          target_type: mutation.direction === "IN" ? "income" : "expense",
          target_coa_code: selectedAccount.code,
          confidence_score: 100,
          stop_processing: true,
        }),
      });
      const ruleBody = await ruleResponse.json().catch(() => ({}));
      if (!ruleResponse.ok) {
        throw new Error(ruleBody.error ?? "Gagal menyimpan referensi COA");
      }

      if (applyCurrent) {
        const approveResponse = await fetch(`/api/bank-reconciliation/${mutation.id}/approve`, {
          method: "POST",
          credentials: "include",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            manual_coa_code: selectedAccount.code,
            note: `COA dipetakan dari referensi manual: ${selectedAccount.code}`,
          }),
        });
        const approveBody = await approveResponse.json().catch(() => ({}));
        if (!approveResponse.ok) {
          throw new Error(
            approveBody.error ??
            "Referensi tersimpan, tetapi draft jurnal untuk mutasi ini belum berhasil dibuat.",
          );
        }
        toast({
          title: "COA dipetakan dan draft jurnal dibuat",
          description: `${selectedAccount.code} — ${selectedAccount.name}`,
        });
      } else {
        toast({
          title: "Referensi COA tersimpan",
          description: `Mutasi berikutnya dengan referensi ini akan diarahkan ke ${selectedAccount.code}.`,
        });
      }
      // A saved rule changes the server-side candidate recommendation. The
      // mutation list and QRIS candidate audit use different React Query keys,
      // so invalidating only bank-reconciliation leaves the candidate/approval
      // view stale until its polling interval or a hard refresh.
      qc.invalidateQueries({ queryKey: ["qris-candidate-audit"] });
      qc.invalidateQueries({ queryKey: ["coa-proposals-by-source"] });
      await onSaved();
      onClose();
    } catch (error) {
      toast({
        title: "Gagal menyimpan pemetaan COA",
        description: error instanceof Error ? error.message : String(error),
        variant: "destructive",
      });
    } finally {
      setSaving(null);
    }
  };

  if (!mutation) return null;

  return (
    <Dialog open={open} onOpenChange={value => !value && onClose()}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <BookOpen className="h-4 w-4 text-indigo-600" />
            Referensi COA
          </DialogTitle>
          <DialogDescription>
            Pilih akun tujuan untuk {mutation.direction === "IN" ? "uang masuk" : "uang keluar"} ini.
            Aturan akan dipakai lagi untuk mutasi dengan keterangan yang sama.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-3">
          <div className="rounded-md border bg-muted/30 p-3 text-sm">
            <p className="font-medium">{mutation.description}</p>
            <p className="mt-1 text-xs text-muted-foreground">
              {fmtDate(mutation.transaction_date)} · {idr(mutation.amount)} ·{" "}
              {mutation.direction === "IN" ? "Uang Masuk" : "Uang Keluar"}
            </p>
          </div>

          <div className="space-y-1.5">
            <label className="text-xs font-medium">Referensi untuk transaksi berikutnya</label>
            <Input
              value={conditionValue}
              onChange={event => setConditionValue(event.target.value)}
              placeholder="Contoh: BUNGA, ADMIN BANK, TRANSFER DARI..."
            />
            <p className="text-[11px] text-muted-foreground">
              Sistem mencocokkan teks ini pada keterangan mutasi, dengan arah{" "}
              <strong>{mutation.direction}</strong>.
            </p>
          </div>

          <div className="space-y-1.5">
            <label className="text-xs font-medium">
              Pilih akun COA debit atau kredit
            </label>
            <div className="relative">
              <Search className="pointer-events-none absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
              <Input
                className="pl-9"
                value={search}
                onChange={event => setSearch(event.target.value)}
                placeholder="Cari kode atau nama akun..."
              />
            </div>
            <p className="text-[11px] text-muted-foreground">
              Semua akun aktif yang dapat diposting ditampilkan. Saldo normal akun ditandai sebagai debit atau kredit.
            </p>
            {creatingCoa ? (
              <div className="space-y-3 rounded-md border border-indigo-200 bg-indigo-50/40 p-3 dark:bg-indigo-950/20">
                <div className="flex items-center justify-between gap-2">
                  <div>
                    <p className="text-sm font-semibold">Buat COA baru</p>
                    <p className="text-[11px] text-muted-foreground">
                      COA akan langsung ditambahkan ke perusahaan aktif.
                    </p>
                  </div>
                  <Button type="button" variant="ghost" size="sm" onClick={() => setCreatingCoa(false)}>
                    Kembali
                  </Button>
                </div>

                <div className="space-y-1.5">
                  <label className="text-xs font-medium">Jenis akun</label>
                  <Select
                    value={newCoaRole}
                    onValueChange={value => {
                      const role = value as "parent" | "child";
                      setNewCoaRole(role);
                      if (role === "parent") {
                           setParentSearch("");
                        setNewCoaForm(form => ({ ...form, parentId: null }));
                      }
                    }}
                  >
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="parent">Parent / akun grup</SelectItem>
                      <SelectItem value="child">Child / akun detail</SelectItem>
                    </SelectContent>
                  </Select>
                  <p className="text-[11px] text-muted-foreground">
                    Parent dibuat sebagai akun header. Child harus ditempatkan di bawah parent yang sesuai.
                  </p>
                </div>

                <div className="grid grid-cols-2 gap-2">
                  <div className="space-y-1.5">
                    <label className="text-xs font-medium">Kode COA</label>
                    <Input
                      value={newCoaForm.code}
                      onChange={event => setNewCoaForm(form => ({ ...form, code: event.target.value }))}
                      placeholder="Contoh: 2-1200"
                    />
                  </div>
                  <div className="space-y-1.5">
                    <label className="text-xs font-medium">Nama COA</label>
                    <Input
                      value={newCoaForm.name}
                      onChange={event => setNewCoaForm(form => ({ ...form, name: event.target.value }))}
                      placeholder="Contoh: Pendapatan Jasa"
                    />
                  </div>
                </div>

                <div className="space-y-1.5">
                  <label className="text-xs font-medium">Kelompok akun</label>
                  <Select
                    value={newCoaForm.type}
                    onValueChange={value => setNewCoaForm(form => ({ ...form, type: value, parentId: null }))}
                  >
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {allowedNewCoaTypes.map(option => (
                        <SelectItem key={option.value} value={option.value}>{option.label}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <p className="text-[11px] text-muted-foreground">
                    Saldo normal otomatis: {contraNormalBalance === "CREDIT" ? "kredit" : "debit"}.
                  </p>
                </div>

                {newCoaRole === "child" && (
                  <div className="space-y-1.5">
                    <label className="text-xs font-medium">Parent akun</label>
                     <div className="relative">
                       <Search className="pointer-events-none absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
                       <Input
                         className="pl-9"
                         value={parentSearch}
                         onChange={event => setParentSearch(event.target.value)}
                         placeholder="Cari parent berdasarkan kode atau nama..."
                       />
                     </div>
                    <Select
                      value={newCoaForm.parentId ? String(newCoaForm.parentId) : "__none"}
                      onValueChange={value => setNewCoaForm(form => ({
                        ...form,
                        parentId: value === "__none" ? null : Number(value),
                      }))}
                    >
                      <SelectTrigger>
                        <SelectValue placeholder="Pilih parent akun..." />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="__none">Pilih parent akun...</SelectItem>
                         {filteredParentAccounts.map(account => (
                          <SelectItem key={account.id} value={String(account.id)}>
                            {account.code} — {account.name}
                          </SelectItem>
                        ))}
                         {filteredParentAccounts.length === 0 && (
                           <SelectItem value="__no_parent_results" disabled>
                             Parent tidak ditemukan
                           </SelectItem>
                         )}
                      </SelectContent>
                    </Select>
                     {parentSearch.trim() && filteredParentAccounts.length === 0 && (
                       <p className="text-[11px] text-amber-700">
                         Tidak ada parent yang cocok dengan pencarian.
                       </p>
                     )}
                    {parentAccountsLoading && (
                      <p className="flex items-center gap-1 text-[11px] text-muted-foreground">
                        <Loader2 className="h-3 w-3 animate-spin" /> Memuat parent...
                      </p>
                    )}
                    {!parentAccountsLoading && parentAccounts.length === 0 && (
                      <p className="text-[11px] text-amber-700">
                        Belum ada parent dengan kelompok akun ini. Buat parent terlebih dahulu.
                      </p>
                    )}
                  </div>
                )}

                <Button
                  type="button"
                  className="w-full gap-1.5 bg-indigo-600 text-white hover:bg-indigo-700"
                  onClick={createCoa}
                  disabled={creating || (newCoaRole === "child" && parentAccounts.length === 0)}
                >
                  {creating && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
                  Buat & Pilih COA
                </Button>
              </div>
            ) : (
              <>
                <div className="max-h-52 overflow-y-auto rounded-md border">
                  {accountsLoading ? (
                    <div className="flex items-center gap-2 p-3 text-xs text-muted-foreground">
                      <Loader2 className="h-3.5 w-3.5 animate-spin" /> Memuat daftar COA...
                    </div>
                  ) : visibleAccounts.length === 0 ? (
                    <div className="space-y-2 p-3 text-xs text-muted-foreground">
                      <p>Akun COA tidak ditemukan untuk pencarian atau saldo normal ini.</p>
                      <Button type="button" size="sm" variant="outline" className="gap-1.5" onClick={startCreateCoa}>
                        <Plus className="h-3.5 w-3.5" /> Buat COA baru
                      </Button>
                    </div>
                  ) : (
                    visibleAccounts.map(account => (
                      <div
                        key={account.id}
                        className={`flex w-full items-center gap-1 border-b last:border-b-0 ${
                          selectedCode === account.code
                            ? "bg-indigo-50 text-indigo-900 dark:bg-indigo-950 dark:text-indigo-100"
                            : "hover:bg-muted/50"
                        }`}
                      >
                        <button
                          type="button"
                          className="flex min-w-0 flex-1 items-center gap-2 px-3 py-2 text-left"
                          onClick={() => setSelectedCode(account.code)}
                        >
                          <span className="w-20 shrink-0 font-mono text-xs font-semibold">{account.code}</span>
                          <span className="min-w-0 flex-1 truncate text-xs">{account.name}</span>
                          <span className="shrink-0 text-[10px] text-muted-foreground">{account.type}</span>
                          <span
                            className={`shrink-0 rounded px-1.5 py-0.5 text-[9px] font-semibold ${
                              account.normalBalance === "CREDIT"
                                ? "bg-emerald-100 text-emerald-700 dark:bg-emerald-950/50 dark:text-emerald-300"
                                : "bg-sky-100 text-sky-700 dark:bg-sky-950/50 dark:text-sky-300"
                            }`}
                          >
                            {account.normalBalance === "CREDIT" ? "KREDIT" : "DEBIT"}
                          </span>
                        </button>
                        <Button
                          type="button"
                          variant="ghost"
                          size="icon"
                          className="mr-1 h-7 w-7 shrink-0 text-indigo-600 hover:bg-indigo-100 hover:text-indigo-800 dark:hover:bg-indigo-900"
                          title={`Tambah COA sejajar setelah ${account.code}`}
                          aria-label={`Tambah COA sejajar setelah ${account.code}`}
                          onClick={() => startCreateCoaFromAccount(account)}
                        >
                          <Plus className="h-4 w-4" />
                        </Button>
                      </div>
                    ))
                  )}
                </div>
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  className="mt-1 w-full gap-1.5 text-indigo-700 hover:bg-indigo-50 hover:text-indigo-800"
                  onClick={startCreateCoa}
                >
                  <Plus className="h-3.5 w-3.5" /> Tambah COA baru sebagai parent atau child
                </Button>
              </>
            )}
            {selectedAccount && (
              <p className="text-xs text-indigo-700 dark:text-indigo-300">
                Terpilih: <strong>{selectedAccount.code} — {selectedAccount.name}</strong>
              </p>
            )}
          </div>

          {!canApplyCurrent && canApprove(mutation) && visibleCandidates(mutation).length > 0 && (
            <p className="rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800">
              Mutasi ini memiliki kandidat transaksi. Simpan aturan COA untuk transaksi berikutnya,
              lalu gunakan alur review untuk memilih kandidat yang benar.
            </p>
          )}
          {isQrisMutation(mutation) && canApprove(mutation) && (
            <p className="rounded-md border border-indigo-200 bg-indigo-50 px-3 py-2 text-xs text-indigo-800">
              Untuk QRIS, referensi COA disimpan sebagai aturan berikutnya. Approval saat ini tetap
              mengikuti alur settlement QRIS agar jurnal settlement tidak terduplikasi.
            </p>
          )}
        </div>

        <DialogFooter className="flex-col gap-2 sm:flex-row">
          <Button variant="outline" onClick={onClose}>Batal</Button>
          <Button
            className="gap-1.5 bg-indigo-600 text-white hover:bg-indigo-700"
            onClick={() => save(canApplyCurrent)}
            disabled={saving !== null || !selectedAccount}
          >
            {(saving === "rule" || saving === "current") && (
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
            )}
            {canApplyCurrent ? "Simpan Referensi & Buat Draft" : "Simpan Referensi COA"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Mutation Card
// ─────────────────────────────────────────────────────────────────────────────

function QrisMutationCard({
  m,
  audit,
  onMapCoa,
  onReject,
  onDetail,
  onDelete,
  onEditPaymentDate,
  onApproveQrisBatch,
  onManualOverrideCandidate,
  onRecoverQrisSettlement,
  approveQrisPending,
  recoverQrisPending,
  selectedQrisPaymentIds,
  onToggleQrisPayment,
  onToggleAllQrisPayments,
  onRunMatching,
  onGenerateQrisCandidates,
  qrisGenerationPending,
  mappingError,
}: {
  m: BankMutation;
  audit: QrisCandidateAudit;
  onMapCoa: (m: BankMutation) => void;
  onReject: (m: BankMutation) => void;
  onDetail: (m: BankMutation) => void;
  onDelete: (id: number) => void;
  onEditPaymentDate?: (target: {
    paymentId: number;
    paymentNumber: string;
    paymentDate: string;
  }) => void;
  onApproveQrisBatch?: (candidateId: number, mutationId: number, candidate: QrisCandidateAudit, paymentIds?: number[]) => void;
  onManualOverrideCandidate?: (m: BankMutation, candidate: Candidate) => void;
  onRecoverQrisSettlement?: (mutationId: number, settlementId: number) => void;
  approveQrisPending?: boolean;
  recoverQrisPending?: boolean;
  selectedQrisPaymentIds: number[];
  onToggleQrisPayment?: (candidateId: number, paymentId: number, checked: boolean) => void;
  onToggleAllQrisPayments?: (candidate: QrisCandidateAudit, checked: boolean) => void;
  onRunMatching: (mode?: "new" | "retry_unmatched" | "rematch_non_final") => void;
  onGenerateQrisCandidates?: (mutationId?: number) => void;
  qrisGenerationPending?: boolean;
  mappingError?: MappingRequiredError;
}) {
  const allItems = audit.payment_items ?? [];
  const auditStatus = String(audit.status ?? "").toLowerCase();
  const isReadOnlyEvidence = ["stale", "superseded", "ineligible"].includes(auditStatus);
  const settledPaymentIds = new Set((audit.settled_payment_ids ?? []).map(Number));
  const unconfirmedPaymentIds = new Set(getUnconfirmedQrisPaymentIds(audit));
  const currentPaymentIds = Array.isArray(audit.current_payment_ids)
    ? new Set(audit.current_payment_ids.map(Number))
    : null;
  const currentPaymentAmounts = audit.current_payment_amounts ?? {};
  const availableItems = allItems.filter((item) => {
    const paymentId = item.paymentId ?? item.payment_id;
    return paymentId != null
      && (currentPaymentIds
        ? currentPaymentIds.has(Number(paymentId))
        : !settledPaymentIds.has(Number(paymentId)));
  });
  const items = availableItems;
  const availablePaymentIds = availableItems
    .map((item) => Number(item.paymentId ?? item.payment_id))
    .filter((id) => Number.isInteger(id) && id > 0);
  // A stale candidate is deliberately not approvable, but its last snapshot is
  // still useful evidence for correcting the source payment before regeneration.
  const displayItems = isReadOnlyEvidence ? allItems : availableItems;
  const selectedPaymentIds = selectedQrisPaymentIds.filter((id) => availablePaymentIds.includes(id));
  const allPaymentsSelected = availablePaymentIds.length > 0
    && availablePaymentIds.every((id) => selectedPaymentIds.includes(id));
  const isIN = m.direction === "IN";
  const isMatched = String(audit.reconciliation_status ?? "").toUpperCase() === "MATCHED";
  const isReview = String(audit.reconciliation_status ?? "").toUpperCase() === "REVIEW";
  const qrisPresentationState = getQrisCandidatePresentationState(audit);
  const isDepleted = qrisPresentationState === "depleted";
  const isEmptyMatchedCandidate = qrisPresentationState === "empty";
  const isStaleMatchedCandidate = qrisPresentationState === "stale";
  const recoverableSettlementId = numericValue(audit.recoverable_settlement_id);
  const canRecoverSettlement = isDepleted
    && recoverableSettlementId != null
    && onRecoverQrisSettlement != null;
  const isCanonicalReconciled = isCanonicalSettlementMutation(m)
    && ["approved", "posted"].includes(String(m.status ?? "").toLowerCase());
  const canonicalSettlementCandidate = (m.candidates ?? []).find(candidate =>
    candidate.candidate_type === "qris_settlement"
    && candidate.candidate_source === CANONICAL_SETTLEMENT_SOURCE,
  );
  const canonicalOverrideReady = isCanonicalSettlementManualOverrideEligible(m);
  const canonicalApprovalReady = isCanonicalSettlementApprovalEligible(m);
  const canonicalSettlementDetails = canonicalSettlementCandidate?.details;
  const hasCanonicalSettlementCandidate = canonicalSettlementCandidate != null;
  const isApproved = isCanonicalReconciled
    || ["approved", "posted"].includes(String(m.status ?? "").toLowerCase())
    || String(audit.status ?? "").toLowerCase() === "approved";
  // REVIEW candidates are explicitly approvable through the existing override
  // flow, so they must be selectable in the card as well as in the batch toolbar.
  const bankAmount = numericValue(m.amount) ?? 0;
  const snapshotGross = numericValue(audit.gross_amount)
    ?? allItems.reduce(
      (total, item) => total + (numericValue(item.grossAmount ?? item.gross_amount) ?? 0),
      0,
    );
  const hasLiveScope = currentPaymentIds !== null;
  const isPartialSettlement = !isReadOnlyEvidence && hasLiveScope && availablePaymentIds.length < allItems.length;
  const candidateGross = isReadOnlyEvidence
    ? snapshotGross
    : hasLiveScope
      ? (numericValue(audit.current_gross_amount) ?? 0)
      : snapshotGross;
  const hasLiveSettlementProposal = !isReadOnlyEvidence
    && (isMatched || isReview)
    && allItems.length > 0;
  const canonicalExpectedNet = numericValue(canonicalSettlementDetails?.expectedAmount)
    ?? numericValue(canonicalSettlementDetails?.netAmount);
  const auditExpectedNet = numericValue(audit.net_amount);
  const originalExpectedNet = canonicalExpectedNet
    ?? (hasLiveSettlementProposal ? auditExpectedNet : null);
  const hasIdentifiedSettlement = originalExpectedNet != null;
  const expectedNet = hasLiveScope && !isReadOnlyEvidence
    ? (numericValue(audit.current_expected_amount)
      ?? (snapshotGross > 0 && originalExpectedNet != null
        ? candidateGross * originalExpectedNet / snapshotGross
        : null))
    : originalExpectedNet;
  const mdr = canonicalSettlementDetails?.mdrAmount != null
    ? numericValue(canonicalSettlementDetails.mdrAmount)
    : hasLiveScope && !isReadOnlyEvidence && expectedNet != null
      ? Math.max(0, candidateGross - expectedNet)
      : hasLiveSettlementProposal
        ? numericValue(audit.observed_deduction)
        : null;
  const difference = originalExpectedNet == null ? null : bankAmount - originalExpectedNet;
  const differenceAbs = difference == null ? null : Math.abs(difference);
  const differenceExplanation = differenceAbs != null && differenceAbs < 0.5
    ? "Tidak ada selisih nominal pada snapshot kandidat. Kandidat tetap perlu diregenerasi karena bukti canonical-nya sudah stale."
    : differenceAbs == null
      ? "Belum dapat dihitung karena belum ada settlement candidate yang valid dipilih atau teridentifikasi."
      : difference != null && difference > 0
      ? `Bank lebih besar ${idrWhole(difference)} daripada netto payment. Periksa payment yang belum masuk, tanggal settlement, atau biaya MDR.`
      : `Netto payment lebih besar ${idrWhole(differenceAbs)} daripada mutasi bank. Periksa nominal payment, provider, dan potongan MDR.`;
  const canSelect = audit.id != null
    && (isMatched || isReview)
    && !isApproved
    && unconfirmedPaymentIds.size === 0
    && availablePaymentIds.length > 0
    && m.direction?.toUpperCase() === "IN"
    && differenceAbs != null
    && differenceAbs < 0.5;
  const metricScopeLabel = isPartialSettlement ? " tersisa" : "";
  const differenceLabel = isPartialSettlement ? "Selisih Batch Awal" : "Selisih Bank vs Netto";
  const liveGrossForItem = (item: QrisPaymentItem) => {
    const paymentId = item.paymentId ?? item.payment_id;
    const liveAmount = paymentId == null ? undefined : currentPaymentAmounts[String(paymentId)];
    return isReadOnlyEvidence
      ? numericValue(item.grossAmount ?? item.gross_amount) ?? 0
      : numericValue(liveAmount) ?? numericValue(item.grossAmount ?? item.gross_amount) ?? 0;
  };
  const isApprovedItem = (item: QrisPaymentItem) => {
    const paymentId = item.paymentId ?? item.payment_id;
    if (paymentId == null) return false;
    // A missing live scope is not by itself proof of approval. Only the
    // settlement evidence returned by the API can justify this green metric;
    // otherwise a stale/inconsistent candidate would look fully approved.
    return settledPaymentIds.has(Number(paymentId));
  };
  const approvedItems = allItems.filter(isApprovedItem);
  const approvedGross = approvedItems.reduce(
    (total, item) => total + (numericValue(item.grossAmount ?? item.gross_amount) ?? 0),
    0,
  );
  const approvedPaymentCount = approvedItems.length;
  const remainingPaymentCount = isReadOnlyEvidence ? availablePaymentIds.length : items.length;
  const displayedPaymentCount = isReadOnlyEvidence ? allItems.length : remainingPaymentCount;
  const statusText = isCanonicalReconciled
    ? "Sudah Direkonsiliasi"
    : hasCanonicalSettlementCandidate
      ? "Settlement Canonical — Perlu Review"
    : isApproved
      ? "Sudah Disetujui"
      : isDepleted
        ? "Sudah Diproses"
        : isReadOnlyEvidence
          ? "Bukti Stale — Revisi"
          : isEmptyMatchedCandidate || isStaleMatchedCandidate
            ? "Perlu Diperbarui"
            : isMatched
              ? "Cocok"
              : "Perlu Diperiksa";
  const positiveStatus = isCanonicalReconciled
    || isApproved
    || isDepleted
    || (isMatched && !isEmptyMatchedCandidate && !isStaleMatchedCandidate
      && !hasCanonicalSettlementCandidate);

  return (
    <Card
      className={`transition-all hover:shadow-md ${CARD_BORDER[m.status] ?? ""} cursor-pointer group`}
      onClick={() => onDetail(m)}
      tabIndex={0}
      onKeyDown={e => e.key === "Enter" && onDetail(m)}
      role="article"
      aria-label={`Mutasi QRIS: ${m.description}`}
    >
      <CardContent className="p-3 sm:p-4">
        <div className="flex items-start gap-3">
          <div className={`mt-0.5 shrink-0 w-9 h-9 rounded-full flex items-center justify-center ${
            isIN ? "bg-green-100 text-green-600 dark:bg-green-950" : "bg-red-100 text-red-600 dark:bg-red-950"
          }`}>
            {isIN ? <ArrowDownLeft className="w-4 h-4" /> : <ArrowUpRight className="w-4 h-4" />}
          </div>

          <div className="min-w-0 flex-1">
            <div className="flex items-start justify-between gap-2">
              <div className="min-w-0">
                <p className="font-semibold text-base leading-tight truncate">{mutationHeading(m)}</p>
                <p className="text-xs text-muted-foreground mt-0.5">
                  {fmtDate(m.transaction_date)} · QRIS Sport Center
                </p>
                <Badge variant="outline" className={`mt-1 text-[10px] ${SPORT_PAYMENT_TYPE_STYLES.qris}`}>
                  Jenis payment: QRIS
                </Badge>
                <p className="mt-1 text-[11px] text-muted-foreground break-words">
                  Mutasi: {m.description}
                  {m.provider_order_id && <span> · Ref: {m.provider_order_id}</span>}
                </p>
              </div>
              <Badge
                variant="outline"
                 className={`shrink-0 text-[10px] ${positiveStatus ? "border-green-300 bg-green-50 text-green-700 dark:border-green-800 dark:bg-green-950 dark:text-green-300" : "border-amber-300 bg-amber-50 text-amber-800 dark:border-amber-800 dark:bg-amber-950 dark:text-amber-300"}`}
              >
                {statusText}
              </Badge>
            </div>

            <div className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-3 xl:grid-cols-6">
              {[
                { label: "Total Uang Masuk", value: idr(bankAmount), tone: "text-foreground" },
                { label: isReadOnlyEvidence ? "Payment pada Snapshot" : "Payment Disetujui", value: isReadOnlyEvidence ? `${allItems.length} payment` : `${approvedPaymentCount} payment${approvedGross > 0 ? ` · ${idr(approvedGross)}` : ""}`, tone: isReadOnlyEvidence ? "text-amber-600" : "text-green-600" },
                { label: isReadOnlyEvidence ? "Siap Di-approve" : "Payment Belum Disetujui", value: isReadOnlyEvidence ? `${availablePaymentIds.length} payment` : `${remainingPaymentCount} payment`, tone: remainingPaymentCount > 0 ? "text-amber-600" : "text-green-600" },
                { label: canonicalSettlementDetails?.mdrAmount != null ? "MDR Canonical" : `MDR (Estimasi${metricScopeLabel})`, value: mdr == null ? "Belum dapat dihitung" : idrWhole(mdr), tone: "text-foreground" },
                { label: isReadOnlyEvidence ? "Gross Snapshot" : "Sisa Payment", value: `${idr(candidateGross)} · ${displayedPaymentCount} payment`, tone: "text-foreground" },
                { label: canonicalSettlementDetails?.expectedAmount != null ? "Selisih Bank vs Netto Canonical" : differenceLabel, value: differenceAbs == null ? "Belum dapat dihitung" : idrWhole(differenceAbs), tone: differenceAbs != null && differenceAbs < 0.5 ? "text-green-600" : "text-red-600" },
              ].map(metric => (
                <div key={metric.label} className="min-w-0 rounded-md border bg-muted/20 px-2.5 py-2">
                  <p className="text-[10px] leading-tight text-muted-foreground">{metric.label}</p>
                  <p className={`mt-1 truncate text-sm font-semibold tabular-nums ${metric.tone}`}>{metric.value}</p>
                </div>
              ))}
            </div>
            {hasCanonicalSettlementCandidate && canonicalSettlementDetails && (
              <div className="mt-3 rounded-md border border-indigo-300 bg-indigo-50 px-3 py-2.5 text-xs text-white dark:border-indigo-800 dark:bg-indigo-950">
                <div className="flex items-start gap-2">
                  <ShieldAlert className="mt-0.5 h-4 w-4 shrink-0 text-indigo-600 dark:text-indigo-300" />
                  <div className="min-w-0 flex-1 space-y-1">
                    <p className="font-semibold">Existing settlement canonical</p>
                    <p className="leading-relaxed">
                      Batch canonical ditampilkan sebagai satu settlement-level candidate.
                      Payment yang sudah masuk batch ini tidak dikembalikan sebagai fresh candidate.
                    </p>
                    <div className="grid gap-x-4 gap-y-1 sm:grid-cols-2">
                      <span>Referensi: <strong>{canonicalSettlementDetails.settlementReference ?? `Batch #${canonicalSettlementCandidate?.candidate_id}`}</strong></span>
                      <span>Status: <strong>{canonicalSettlementDetails.settlementStatus ?? "posted"}</strong></span>
                      <span>Gross: <strong>{idr(canonicalSettlementDetails.grossAmount ?? 0)}</strong></span>
                      <span>MDR: <strong>{idr(canonicalSettlementDetails.mdrAmount ?? 0)}</strong></span>
                      <span>Expected netto: <strong>{idr(canonicalSettlementDetails.expectedAmount ?? canonicalSettlementDetails.netAmount ?? 0)}</strong></span>
                      <span>Mutasi bank: <strong>{idr(bankAmount)}</strong></span>
                      <span className="sm:col-span-2">
                        Selisih bank − netto: <strong>{difference == null ? "Belum dapat dihitung" : idrWhole(difference)}</strong>
                      </span>
                    </div>
                    <p className="leading-relaxed">
                      Variance canonical adalah bukti review, bukan sinyal auto-approve. Approval tetap link-only.
                    </p>
                  </div>
                </div>
              </div>
            )}
            {unconfirmedPaymentIds.size > 0 && (
              <div className="mt-3 rounded-md border border-amber-300 bg-amber-50 px-3 py-2.5 text-xs text-amber-900 dark:border-amber-800 dark:bg-amber-950 dark:text-amber-200">
                <p className="font-semibold">Menunggu konfirmasi payment</p>
                <p className="mt-1 leading-relaxed">
                  Payment {Array.from(unconfirmedPaymentIds).join(", ")} belum berstatus confirmed.
                  Konfirmasi payment di Sport Center sebelum memilih dan menyetujui batch QRIS ini.
                </p>
              </div>
            )}
            {(isReadOnlyEvidence || (differenceAbs != null && differenceAbs >= 0.5) || (!hasIdentifiedSettlement && differenceAbs == null)) && (
              <div className="mt-3 rounded-md border border-amber-300 bg-amber-50 px-3 py-2.5 text-xs text-white dark:border-amber-800 dark:bg-amber-950">
                <div className="flex items-start gap-2">
                  <ShieldAlert className="mt-0.5 h-4 w-4 shrink-0 text-amber-600 dark:text-amber-300" />
                  <div className="min-w-0 flex-1 space-y-2">
                    <p className="font-semibold">
                      {isReadOnlyEvidence ? "Sumber kandidat dan langkah revisi" : "Dari mana selisih ini berasal?"}
                    </p>
                    <div className="grid gap-x-4 gap-y-1 sm:grid-cols-2">
                      <span>Mutasi bank: <strong>{idr(bankAmount)}</strong></span>
                      <span>Gross payment: <strong>{idr(snapshotGross)}</strong></span>
                       <span>Potongan MDR/biaya: <strong>{mdr == null ? "Belum dapat dihitung" : idr(mdr)}</strong></span>
                       <span>Netto yang diharapkan: <strong>{originalExpectedNet == null ? "Belum dapat dihitung" : idr(originalExpectedNet)}</strong></span>
                       <span className="sm:col-span-2">Selisih bank − netto: <strong>{difference == null ? "Belum dapat dihitung" : idrWhole(difference)}</strong></span>
                    </div>
                    <p className="leading-relaxed">{differenceExplanation}</p>
                    <p className="leading-relaxed">
                      Sumber bukti: <strong>{audit.candidate_source ?? "Sport Center payment"}</strong>
                      {" · "}provider <strong>{audit.provider_code || "—"}</strong>
                      {" · "}status <strong>{auditStatus.toUpperCase() || "—"}</strong>.
                    </p>
                    <ol className="list-decimal space-y-0.5 pl-4 leading-relaxed">
                      <li>Revisi data sumber payment di Sport Center (nominal, provider, tanggal, atau metadata QRIS), bukan mengubah nominal mutasi bank.</li>
                      <li>Jalankan <strong>AI Matching</strong> ulang agar bukti live terbaca.</li>
                      <li>Setelah kandidat baru berstatus <strong>MATCHED</strong> atau <strong>REVIEW</strong>, pilih payment lalu approve.</li>
                    </ol>
                  </div>
                </div>
              </div>
            )}
            {isPartialSettlement && (
              <p className="mt-2 rounded-md border border-amber-200 bg-amber-50 px-2.5 py-2 text-[10px] leading-relaxed text-amber-900 dark:border-amber-800 dark:bg-amber-950 dark:text-amber-200">
                Stat menunjukkan total bank, status payment, MDR sisa, nominal sisa payment, dan selisih batch.
                Selisih Batch Awal membandingkan mutasi bank dengan netto batch sebelum sebagian payment disetujui.
              </p>
            )}

            {displayItems.length > 0 ? (
              <div className="mt-3 overflow-hidden rounded-md border" onClick={e => e.stopPropagation()}>
                <div className="flex items-center justify-between gap-2 border-b bg-muted/30 px-2.5 py-2">
                  <div>
                    <p className="text-xs font-semibold">{isReadOnlyEvidence ? "Bukti Kandidat Terakhir (Read-only)" : "Kandidat Transaksi Sport Center"}</p>
                    <p className="text-[10px] text-muted-foreground">
                      {isReadOnlyEvidence
                        ? "Snapshot ini membantu menemukan sumber selisih. Perbaiki sumbernya lalu buat kandidat baru."
                        : "Pilih transaksi yang akan diproses sebagai satu batch QRIS."}
                    </p>
                  </div>
                  {canSelect && audit.id != null && onToggleAllQrisPayments && (
                    <label className="flex shrink-0 cursor-pointer items-center gap-1.5 text-[10px] font-medium">
                      <Checkbox
                        checked={allPaymentsSelected}
                        onCheckedChange={checked => onToggleAllQrisPayments(audit, checked === true)}
                        onClick={e => e.stopPropagation()}
                        aria-label={`Pilih semua kandidat QRIS pada mutasi ${m.id}`}
                      />
                      Pilih Semua ({availablePaymentIds.length})
                    </label>
                  )}
                </div>
                <div className="overflow-x-auto">
                    <div className="min-w-[680px]">
                     <div className="grid grid-cols-[1.1fr_1.35fr_1fr_1.2fr_0.9fr_1fr_44px] gap-2 border-b bg-muted/15 px-2.5 py-1.5 text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
                      <span>Booking</span>
                      <span>Pelanggan / Payment</span>
                      <span>Provider Payment</span>
                      <span>Payment / Settlement</span>
                      <span>Metode Bayar</span>
                      <span className="text-right">Nominal (Gross)</span>
                      <span className="text-center">Pilih</span>
                    </div>
                    {displayItems.map((item, index) => {
                      const paymentId = item.paymentId ?? item.payment_id;
                      const booking = item.bookingNumber ?? item.booking_number ?? (item.booking_id != null ? `SC-${String(item.booking_id).padStart(4, "0")}` : "—");
                      const payment = item.paymentNumber ?? item.payment_number ?? (paymentId != null ? `#${paymentId}` : "—");
                      const paymentDate = qrisPaymentDateValue(item);
                      const paymentDateIso = calendarDateInJakarta(paymentDate);
                      const canEditPaymentDate = Number.isInteger(Number(paymentId))
                        && Number(paymentId) > 0
                        && onEditPaymentDate != null;
                      const expectedSettlementDate =
                        item.expectedSettlementDate ?? item.expected_settlement_date;
                       const gross = liveGrossForItem(item);
                      return (
                          <div key={`${paymentId ?? index}-${booking}`} className="grid grid-cols-[1.1fr_1.35fr_1fr_1.2fr_0.9fr_1fr_44px] items-center gap-2 border-b px-2.5 py-2 last:border-b-0">
                          <span className="truncate text-xs font-medium">{booking}</span>
                          <span className="min-w-0 truncate text-xs text-muted-foreground">{payment}</span>
                           <span className="min-w-0 truncate text-xs font-medium text-foreground">
                             {item.providerName ?? item.provider_name ?? audit.provider_code ?? "Belum dikenali"}
                           </span>
                           <span className="min-w-0 text-xs text-muted-foreground">
                             <span className="flex min-w-0 items-center gap-1">
                               <span className="truncate">
                                 Payment: {paymentDate ? fmtDate(paymentDateIso) : "—"}
                               </span>
                               {canEditPaymentDate && (
                                 <button
                                   type="button"
                                   className="inline-flex shrink-0 items-center rounded p-0.5 text-indigo-600 hover:bg-indigo-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 dark:text-indigo-300 dark:hover:bg-indigo-950"
                                   aria-label={`Edit tanggal payment ${payment}`}
                                   title="Edit tanggal payment"
                                   onClick={(event) => {
                                     event.stopPropagation();
                                     onEditPaymentDate({
                                       paymentId: Number(paymentId),
                                       paymentNumber: payment,
                                       paymentDate: paymentDateIso,
                                     });
                                   }}
                                 >
                                   <Pencil className="h-3 w-3" />
                                 </button>
                               )}
                             </span>
                             <span className="block truncate font-medium text-indigo-600 dark:text-indigo-400">
                               Settlement H-1: {expectedSettlementDate ? fmtDate(String(expectedSettlementDate)) : "—"}
                             </span>
                           </span>
                           <span className="truncate text-xs text-muted-foreground">QRIS</span>
                          <span className="text-right text-xs font-medium tabular-nums">{idr(gross)}</span>
                          <span className="flex justify-center">
                            {paymentId != null && unconfirmedPaymentIds.has(Number(paymentId)) ? (
                              <Badge
                                variant="outline"
                                className="text-[9px] border-amber-300 text-amber-700 dark:border-amber-700 dark:text-amber-300"
                              >
                                Belum confirmed
                              </Badge>
                            ) : canSelect && audit.id != null && paymentId != null && onToggleQrisPayment ? (
                              <Checkbox
                                checked={selectedPaymentIds.includes(Number(paymentId))}
                                disabled={currentPaymentIds
                                  ? !currentPaymentIds.has(Number(paymentId))
                                  : settledPaymentIds.has(Number(paymentId))}
                                onCheckedChange={checked => onToggleQrisPayment(audit.id!, Number(paymentId), checked === true)}
                                onClick={e => e.stopPropagation()}
                                aria-label={`Pilih ${booking} ${payment}`}
                              />
                            ) : settledPaymentIds.has(Number(paymentId)) ? (
                              <Badge variant="outline" className="text-[9px] border-green-300 text-green-700">Tersettle</Badge>
                            ) : isReadOnlyEvidence ? (
                              <Badge variant="outline" className="text-[9px] border-amber-300 text-amber-700">Audit</Badge>
                            ) : (
                              <span className="text-muted-foreground">—</span>
                            )}
                          </span>
                        </div>
                      );
                    })}
                  </div>
                </div>
                <p className="border-t bg-muted/15 px-2.5 py-1.5 text-[10px] text-muted-foreground">
                   {isReadOnlyEvidence
                     ? "Audit = bukti snapshot, bukan persetujuan. Revisi sumber payment lalu buat kandidat baru."
                     : "Legenda: MDR (Estimasi) = Total potongan QRIS · Approval hanya memproses payment yang dipilih."}
                </p>
              </div>
            ) : isCanonicalReconciled ? (
              <div className="mt-3 rounded-md border border-green-300 bg-green-50 px-3 py-3 text-xs text-green-900 dark:border-green-800 dark:bg-green-950 dark:text-green-100">
                <p className="font-semibold">Settlement canonical sudah direkonsiliasi.</p>
                <p className="mt-1 leading-relaxed">
                  Payment pada batch ini sudah ditautkan ke mutasi bank melalui owner recovery.
                  Tidak perlu menjalankan AI Matching atau approval ulang.
                </p>
              </div>
            ) : isDepleted ? (
              <div className="mt-3 rounded-md border border-green-300 bg-green-50 px-3 py-3 text-xs text-green-900 dark:border-green-800 dark:bg-green-950 dark:text-green-100">
                <p className="font-semibold">Semua payment pada batch ini sudah diproses.</p>
                <p className="mt-1 leading-relaxed">
                  {canRecoverSettlement
                    ? "Settlement sudah terbentuk, tetapi link ke mutasi bank belum selesai."
                    : "Kandidat MATCHED tidak memiliki payment tersisa. Tidak perlu approval atau matching ulang."}
                </p>
                {canRecoverSettlement && (
                  <Button
                    size="sm"
                    variant="outline"
                    className="mt-3 gap-1.5 border-indigo-300 bg-white text-xs text-indigo-700 hover:bg-indigo-50 dark:border-indigo-700 dark:bg-slate-950 dark:text-indigo-300"
                    disabled={recoverQrisPending}
                    onClick={event => {
                      event.stopPropagation();
                      onRecoverQrisSettlement?.(m.id, recoverableSettlementId);
                    }}
                  >
                    {recoverQrisPending
                      ? <Loader2 className="h-3.5 w-3.5 animate-spin" />
                      : <CheckCircle2 className="h-3.5 w-3.5" />}
                    {recoverQrisPending ? "Menyelesaikan link..." : "Selesaikan Settlement Tertunda"}
                  </Button>
                )}
              </div>
            ) : isEmptyMatchedCandidate ? (
              <div className="mt-3 rounded-md border border-amber-300 bg-amber-50 px-3 py-3 text-xs text-amber-950 dark:border-amber-800 dark:bg-amber-950 dark:text-amber-100">
                <p className="font-semibold">Kandidat MATCHED belum memiliki payment item.</p>
                <p className="mt-1 leading-relaxed">
                  Kandidat ini tidak dapat di-approve. Jalankan matching lalu buat kandidat QRIS baru setelah payment canonical tersedia.
                </p>
              </div>
            ) : isStaleMatchedCandidate ? (
              <div className="mt-3 rounded-md border border-amber-300 bg-amber-50 px-3 py-3 text-xs text-amber-950 dark:border-amber-800 dark:bg-amber-950 dark:text-amber-100">
                <p className="font-semibold">Kandidat MATCHED sudah stale.</p>
                <p className="mt-1 leading-relaxed">
                  Tidak ada payment aktif yang bisa diproses dan bukti settlement tidak lengkap. Regenerasi kandidat; approval tetap dikunci.
                </p>
              </div>
            ) : (
              <div className="mt-3 rounded-md border border-dashed px-3 py-4 text-center">
                <p className="text-sm font-medium">Belum ada kandidat match</p>
                <p className="mt-1 text-xs text-muted-foreground">Jalankan AI Matching untuk mencari transaksi Sport Center.</p>
              </div>
            )}

            {audit.review_reason && !isMatched && (
              <p className="mt-2 rounded-md border border-amber-200 bg-amber-50 px-2.5 py-2 text-xs text-white dark:border-amber-800 dark:bg-amber-950">
                {audit.review_reason}
              </p>
            )}

            {mappingError && (
              <Alert className="mt-3 border-orange-300 bg-orange-50 text-orange-900 dark:border-orange-700 dark:bg-orange-950 dark:text-orange-200" onClick={e => e.stopPropagation()}>
                <AlertTriangle className="h-4 w-4 text-orange-500 shrink-0" />
                <AlertDescription className="text-xs space-y-1">
                  <p className="font-semibold">COA spesifik belum tersedia. Jurnal belum dibuat.</p>
                  <p>{mappingError.message}</p>
                </AlertDescription>
              </Alert>
            )}

            <div className="mt-3 flex flex-wrap items-center gap-1.5 border-t pt-3" onClick={e => e.stopPropagation()}>
              <Button
                size="sm"
                variant="outline"
                className="h-8 gap-1.5 border-indigo-300 text-xs text-indigo-700 hover:bg-indigo-50 dark:border-indigo-800 dark:text-indigo-300"
                onClick={() => onMapCoa(m)}
              >
                <BookOpen className="h-3.5 w-3.5" />
                Referensi COA
              </Button>
              {!isApproved && !isDepleted && !isMatched && (
                <Button
                  size="sm"
                  variant="outline"
                  className="h-8 gap-1.5 text-xs border-blue-300 text-blue-700 hover:bg-blue-50 dark:border-blue-800 dark:text-blue-300"
                  onClick={() => onRunMatching("retry_unmatched")}
                >
                  <Zap className="h-3.5 w-3.5" />
                  Jalankan AI Matching
                </Button>
              )}
              {!isApproved && !isDepleted && (isEmptyMatchedCandidate || isStaleMatchedCandidate) && onGenerateQrisCandidates && (
                <Button
                  size="sm"
                  variant="outline"
                  className="h-8 gap-1.5 border-amber-400 text-xs text-amber-800 hover:bg-amber-50 dark:border-amber-700 dark:text-amber-200"
                  disabled={qrisGenerationPending}
                  onClick={(event) => {
                    event.stopPropagation();
                    onGenerateQrisCandidates(m.id);
                  }}
                >
                  {qrisGenerationPending
                    ? <Loader2 className="h-3.5 w-3.5 animate-spin" />
                    : <RotateCcw className="h-3.5 w-3.5" />}
                  {qrisGenerationPending ? "Memuat kandidat..." : "Buat Kandidat Baru"}
                </Button>
              )}
              {canReject(m) && (
                <Button
                  size="sm"
                  variant="outline"
                  className="h-8 gap-1.5 text-xs text-red-600 hover:bg-red-50 hover:text-red-700 border-red-200"
                  onClick={() => onReject(m)}
                >
                  <XCircle className="h-3.5 w-3.5" />
                  Reject
                </Button>
              )}
              {!isApproved && audit.id != null && onApproveQrisBatch && canSelect && (
                <Button
                  size="sm"
                  className="ml-auto h-8 gap-1.5 bg-green-600 text-xs text-white hover:bg-green-700 disabled:cursor-not-allowed disabled:opacity-50"
                  disabled={!canSelect || selectedPaymentIds.length === 0 || !!mappingError || approveQrisPending}
                  title={selectedPaymentIds.length === 0 ? "Pilih minimal satu payment terlebih dahulu" : undefined}
                  onClick={() => onApproveQrisBatch(audit.id!, audit.mutation_id, audit, selectedPaymentIds)}
                >
                  {approveQrisPending
                    ? <Loader2 className="h-3.5 w-3.5 animate-spin" />
                    : <CheckCircle2 className="h-3.5 w-3.5" />}
                  {approveQrisPending ? "Memproses approval QRIS..." : `Approve QRIS Terpilih (${selectedPaymentIds.length})`}
                </Button>
              )}
              {!isApproved
                && canonicalOverrideReady
                && !canonicalApprovalReady
                && canonicalSettlementCandidate
                && onManualOverrideCandidate && (
                <Button
                  size="sm"
                  variant="outline"
                  className="ml-auto h-8 gap-1.5 border-orange-400 text-xs text-orange-800 hover:bg-orange-50 dark:border-orange-700 dark:text-orange-200"
                  onClick={() => onManualOverrideCandidate(m, canonicalSettlementCandidate)}
                >
                  <ShieldAlert className="h-3.5 w-3.5" />
                  Selesaikan Manual (Override)
                </Button>
              )}
              {!isApproved && audit.id != null && !canSelect && (
                <div className="ml-auto flex flex-wrap items-center justify-end gap-1.5">
                  <span className="text-[11px] text-amber-700 dark:text-amber-300">
                    {isReadOnlyEvidence
                      ? "Revisi sumber dan buat kandidat baru sebelum approve."
                      : isDepleted
                        ? "Semua payment sudah diproses; approval ulang dikunci."
                        : isEmptyMatchedCandidate || isStaleMatchedCandidate
                          ? "Kandidat perlu diregenerasi sebelum approve."
                      : `Status ${audit.reconciliation_status || "UNMATCHED"} belum eligible.`}
                  </span>
                  {isReadOnlyEvidence && onGenerateQrisCandidates && (
                    <Button
                      size="sm"
                      variant="outline"
                      className="h-8 gap-1.5 border-amber-400 text-xs text-amber-800 hover:bg-amber-50 dark:border-amber-700 dark:text-amber-200"
                      disabled={qrisGenerationPending}
                      onClick={(event) => {
                        event.stopPropagation();
                        onGenerateQrisCandidates(m.id);
                      }}
                    >
                      {qrisGenerationPending
                        ? <Loader2 className="h-3.5 w-3.5 animate-spin" />
                        : <RotateCcw className="h-3.5 w-3.5" />}
                      {qrisGenerationPending ? "Memuat kandidat..." : "Buat Kandidat Baru"}
                    </Button>
                  )}
                </div>
              )}
              {isApproved && (
                <Badge className="ml-auto bg-green-600 text-white">
                  <CheckCircle2 className="mr-1 h-3 w-3" />
                  {isCanonicalReconciled ? "Settlement Canonical Direkonsiliasi" : "Batch QRIS Disetujui"}
                </Badge>
              )}
              <Button
                size="sm"
                variant="ghost"
                className="h-8 w-8 p-0 text-muted-foreground"
                title="Lihat detail"
                onClick={() => onDetail(m)}
              >
                <Eye className="h-3.5 w-3.5" />
              </Button>
              {canDelete(m) && (
                <Button
                  size="sm"
                  variant="ghost"
                  className="h-8 w-8 p-0 text-muted-foreground hover:text-destructive"
                  title="Hapus mutasi"
                  onClick={() => { if (confirm("Hapus mutasi ini?")) onDelete(m.id); }}
                >
                  <Trash2 className="h-3.5 w-3.5" />
                </Button>
              )}
            </div>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

function MutationCard({
  m,
  onMapCoa,
  onRetryReferenceCoa,
  onApprove,
  onPost,
  onReject,
  onReverse,
  onReopen,
  onDelete,
  onDetail,
  onEditQrisPaymentDate,
  onApproveQris,
  onApproveQrisBatch,
  onRecoverQrisSettlement,
  selectedCandidateId,
  onToggleCandidate,
  onApproveCandidate,
  onManualOverrideCandidate,
  approveQrisPending,
  recoverQrisPending,
  selectedQrisPaymentIds,
  onToggleQrisPayment,
  onToggleAllQrisPayments,
  onRunMatching,
  onRetryMatching,
  onGenerateQrisCandidates,
  qrisGenerationPending,
  retryReferenceCoaPending,
  retryMatchingPending,
  mappingError,
}: {
  m: BankMutation;
  onMapCoa: (m: BankMutation) => void;
  onRetryReferenceCoa?: (m: BankMutation) => void;
  onApprove: (m: BankMutation) => void;
  onPost:    (m: BankMutation) => void;
  onReject:  (m: BankMutation) => void;
  onReverse: (m: BankMutation) => void;
  onReopen:  (m: BankMutation) => void;
  onDelete:  (id: number) => void;
  onDetail:  (m: BankMutation) => void;
  onEditQrisPaymentDate?: (target: {
    paymentId: number;
    paymentNumber: string;
    paymentDate: string;
  }) => void;
  onApproveQris: (m: BankMutation) => void;
  onApproveQrisBatch?: (candidateId: number, mutationId: number, candidate: QrisCandidateAudit, paymentIds?: number[]) => void;
  onRecoverQrisSettlement?: (mutationId: number, settlementId: number) => void;
  selectedCandidateId?: number | null;
  onToggleCandidate?: (mutationId: number, candidateId: number, checked: boolean) => void;
  onApproveCandidate?: (m: BankMutation, candidate: Candidate) => void;
  onManualOverrideCandidate?: (m: BankMutation, candidate: Candidate) => void;
  approveQrisPending?: boolean;
  recoverQrisPending?: boolean;
  selectedQrisPaymentIds: Record<number, number[]>;
  onToggleQrisPayment?: (candidateId: number, paymentId: number, checked: boolean) => void;
  onToggleAllQrisPayments?: (candidate: QrisCandidateAudit, checked: boolean) => void;
  onRunMatching: (mode?: "new" | "retry_unmatched" | "rematch_non_final") => void;
  onRetryMatching?: (m: BankMutation) => void;
  onGenerateQrisCandidates?: (mutationId?: number) => void;
  qrisGenerationPending?: boolean;
  retryReferenceCoaPending?: boolean;
  retryMatchingPending?: boolean;
  mappingError?: MappingRequiredError;
}) {
  const cands  = visibleCandidates(m);
  const qrisAudits = qrisAuditsForMutation(m);
  const canonicalApprovalCandidate = canonicalSettlementCandidateForMutation(m);
  const canonicalApprovalReady = isCanonicalSettlementApprovalEligible(m);
  const canonicalOverrideReady = isCanonicalSettlementManualOverrideEligible(m);
  const best   = cands[0];
  const evidence = reconciliationEvidence(m);
  // Amount/date are hard visibility requirements only for QRIS. For other
  // candidates (including manual recon rules), they remain reviewer evidence
  // and must not prevent the candidate from being selected.
  const matchingCandidates = cands.filter(candidate =>
    isQrisCandidate(candidate, m)
      ? candidate.amount_match && candidate.date_match
      : true,
  );
  const amount = Number(m.amount) || 0;
  const isIN   = m.direction === "IN";
  const isQris = isQrisMutation(m);
  const bestPaymentType = candidateSportPaymentType(best, m);
  const hasBankTransferCandidate = bestPaymentType === "bank_transfer";
  const canRematchHistoricalReview = m.status === "manual_review"
    && (
      m.review_code === "MANUAL_REVIEW_REASON_NOT_RECORDED"
      || (
        m.review_code === "AUTO_POST_GUARD"
        && m.review_reason === "Jurnal untuk mutasi ini sudah ada. Silakan refresh halaman."
      )
      || !m.review_code
    );
  const canRetryRuleAutoPost = isRuleAutoPostRetryable(m, cands);

  if (qrisAudits.length > 0) {
    return (
      <div className="space-y-2">
        {qrisAudits.map((audit, index) => (
          <QrisMutationCard
            key={`${m.id}-qris-${audit.id ?? index}`}
            m={m}
            audit={audit}
            onMapCoa={onMapCoa}
            onReject={onReject}
            onDetail={onDetail}
            onDelete={onDelete}
            onEditPaymentDate={onEditQrisPaymentDate}
            onApproveQrisBatch={onApproveQrisBatch}
            onRecoverQrisSettlement={onRecoverQrisSettlement}
            recoverQrisPending={recoverQrisPending}
            onManualOverrideCandidate={onManualOverrideCandidate}
            approveQrisPending={approveQrisPending}
            selectedQrisPaymentIds={audit.id != null ? selectedQrisPaymentIds[audit.id] ?? [] : []}
            onToggleQrisPayment={onToggleQrisPayment}
            onToggleAllQrisPayments={onToggleAllQrisPayments}
            onRunMatching={onRunMatching}
            onGenerateQrisCandidates={onGenerateQrisCandidates}
            qrisGenerationPending={qrisGenerationPending}
            mappingError={mappingError}
          />
        ))}
      </div>
    );
  }

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
            isIN ? "bg-green-100 text-green-600 dark:bg-green-950" : "bg-red-100 text-red-600 dark:bg-red-950"
          }`}>
            {isIN ? <ArrowDownLeft className="w-4 h-4" /> : <ArrowUpRight className="w-4 h-4" />}
          </div>

          {/* Main content */}
          <div className="flex-1 min-w-0">
            <div className="flex items-start justify-between gap-2 flex-wrap">
              <div className="min-w-0">
                <p className="font-semibold text-base leading-tight truncate">{mutationHeading(m)}</p>
                <p className="text-xs text-muted-foreground mt-0.5">
                  {fmtDate(m.transaction_date)}
                  {" · "}{mutationSourceLabel(m)}
                </p>
                 {(() => {
                   const paymentType = mutationSportPaymentType(m);
                   return paymentType ? (
                     <Badge variant="outline" className={`mt-1 text-[10px] ${SPORT_PAYMENT_TYPE_STYLES[paymentType]}`}>
                       Jenis payment: {SPORT_PAYMENT_TYPE_LABELS[paymentType]}
                     </Badge>
                   ) : null;
                 })()}
                {hasQrisCandidateEvidenceMismatch(m) && (
                  <Badge
                    variant="outline"
                    className="mt-1 ml-1 text-[10px] border-amber-300 bg-amber-50 text-amber-800 dark:border-amber-800 dark:bg-amber-950 dark:text-amber-300"
                  >
                    Mismatch: sumber QRIS, mutasi Transfer Bank
                  </Badge>
                )}
                <div
                  className="mt-1 text-[11px] text-muted-foreground break-words"
                  onClick={e => e.stopPropagation()}
                >
                  <span className="font-medium text-foreground/80">Keterangan bank:</span>{" "}
                  {m.description}
                  {m.provider_order_id && <span className="ml-1">· Ref: {m.provider_order_id}</span>}
                </div>
              </div>
              <div className="text-right shrink-0">
                <span className={`text-[10px] px-1.5 py-0.5 rounded-full border font-medium ${statusColor(m)}`}>
                  {statusLabel(m)}
                </span>
              </div>
            </div>

            {/* Friendly matching summary — scoring details live in the detail panel. */}
            {best && isExactMatch(m) && (!isQris || qrisAudits.length > 0) && (
              <div className="mt-2 rounded-md border border-green-200 bg-green-50 px-3 py-2 text-xs dark:border-green-800 dark:bg-green-950">
                <p className="font-semibold text-green-800 dark:text-green-300">
                  Cocok dengan transaksi {best.candidate_type === "sport_payment" || best.candidate_type === "qris_settlement" ? "Sport Center" : "di sistem"}
                </p>
                <div className="mt-1 flex flex-wrap gap-x-4 gap-y-0.5 text-green-700 dark:text-green-400">
                  <span>Uang masuk bank {idr(amount)}</span>
                  <span>Seharusnya diterima {idr(reconciliationEvidence(m).expectedAmount || amount)}</span>
                </div>
              </div>
            )}

             {isQris && qrisAudits.length === 0 && !canonicalApprovalReady && (
              <div>
                <QrisCandidateDiagnosticBlock
                  mutation={m}
                  diagnostic={m.qris_candidate_diagnostic}
                  compact
                />
                {evidence.transactions.length > 0 && (
                  <div className="mt-2 rounded-md border border-amber-800/60 bg-card px-3 py-2 text-xs">
                    <div className="flex items-center justify-between gap-2">
                      <p className="font-semibold text-amber-300">
                        {hasBankTransferCandidate
                          ? `Kandidat Transfer Bank ditemukan untuk review (${evidence.transactions.length})`
                          : `Transaksi ditemukan untuk review (${evidence.transactions.length})`}
                      </p>
                      <span className="text-[10px] text-amber-400">
                        {hasBankTransferCandidate ? "Bukan kandidat QRIS" : "Belum kandidat QRIS valid"}
                      </span>
                    </div>
                    <p className="mt-1 text-[11px] text-muted-foreground">
                      {hasBankTransferCandidate
                        ? "Payment sumber ini tercatat Transfer Bank. Sistem menampilkannya hanya sebagai kandidat matching umum; kandidat ini tidak boleh dimasukkan atau di-approve sebagai settlement QRIS."
                        : "Transaksi tetap ditampilkan sebagai bukti pencocokan, tetapi belum dapat di-approve otomatis sebagai settlement QRIS."}
                    </p>
                    <div className="mt-1.5 max-h-44 space-y-1 overflow-y-auto">
                      {evidence.transactions.map((transaction, index) => (
                        <div
                          key={`${transaction.label}-${index}`}
                          className="flex items-center justify-between gap-3 rounded border border-border/70 bg-background/60 px-2 py-1.5"
                        >
                          <div className="min-w-0">
                            <p className="truncate font-medium text-foreground">{transaction.label}</p>
                            <p className="truncate text-[10px] text-muted-foreground">
                              {[transaction.customer, transaction.facility, transaction.date ? fmtDate(String(transaction.date)) : null]
                                .filter(Boolean)
                                .join(" · ") || "Detail tersedia di sistem"}
                            </p>
                          </div>
                          <p className="shrink-0 font-semibold tabular-nums text-foreground">{idr(transaction.amount)}</p>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
                {onGenerateQrisCandidates && (
                  <Button
                    size="sm"
                    variant="outline"
                    className="mt-2 h-7 gap-1 border-indigo-300 bg-indigo-950 text-[11px] text-indigo-50 hover:bg-indigo-900 dark:border-indigo-700"
                    disabled={qrisGenerationPending}
                    onClick={event => {
                      event.stopPropagation();
                      onGenerateQrisCandidates();
                    }}
                  >
                    {qrisGenerationPending
                      ? <Loader2 className="h-3 w-3 animate-spin" />
                      : <CreditCard className="h-3 w-3" />}
                    {qrisGenerationPending ? "Membuat kandidat..." : "Cari Kandidat QRIS"}
                  </Button>
                )}
              </div>
            )}

            {m.status === "matched" && !isExactMatch(m) && (
              <div className="mt-2 rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-900 dark:border-amber-800 dark:bg-amber-950 dark:text-amber-200">
                <p className="font-semibold">Perlu Diperiksa</p>
                <p className="mt-0.5">Sistem menemukan transaksi, tetapi nominal atau bukti belum sepenuhnya cocok.</p>
              </div>
            )}

            {m.status === "manual_review" && (
              <div className="mt-2 rounded-md border border-orange-200 bg-orange-50 px-3 py-2 text-xs text-orange-900 dark:border-orange-800 dark:bg-orange-950 dark:text-orange-200">
                <p className="font-semibold">Alasan review manual</p>
                <p className="mt-0.5">
                  {m.review_reason ??
                    "Mutasi ini memerlukan review manual, tetapi alasan historisnya belum tercatat. Jalankan ulang matching untuk mengevaluasi rule terbaru."}
                </p>
                {m.review_code && <p className="mt-1 font-mono text-[10px] opacity-75">Kode: {m.review_code}</p>}
              </div>
            )}

            {best && m.status === "unmatched" && !isExactMatch(m) && (
              <div className="mt-2 rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-900 dark:border-amber-800 dark:bg-amber-950 dark:text-amber-200">
                <p className="font-semibold">Kandidat ditemukan — perlu diperiksa</p>
                <p className="mt-0.5">
                  Sistem menemukan transaksi yang mungkin terkait, tetapi pencocokan belum dikonfirmasi.
                </p>
                <div className="mt-1 flex flex-wrap gap-x-4 gap-y-0.5 text-amber-800 dark:text-amber-300">
                  <span>
                    {best.candidate_type === "sport_payment" ? "Sport Center" : "Transaksi sistem"}
                  </span>
                   {candidateSportPaymentType(best, m) && (
                     <span>Jenis payment {SPORT_PAYMENT_TYPE_LABELS[candidateSportPaymentType(best, m)!]}</span>
                   )}
                   {(best.details?.paymentMethod ?? best.details?.method) && (
                     <span>Metode {best.details?.paymentMethod ?? best.details?.method}</span>
                   )}
                  {best.details?.settlementDate && (
                    <span>Settlement {fmtDate(String(best.details.settlementDate))}</span>
                  )}
                  {best.details?.amount != null && (
                    <span>Nominal {idr(Number(best.details.amount))}</span>
                  )}
                </div>
              </div>
            )}

            {!isQris && matchingCandidates.length > 0 && (
              <div
                className="mt-2 rounded-md border border-green-800/60 bg-card px-3 py-2"
                onClick={e => e.stopPropagation()}
              >
                <div className="flex items-center justify-between gap-2">
                  <p className="text-xs font-semibold text-green-300">
                    Kandidat yang cocok
                  </p>
                  <span className="text-[10px] text-green-400">
                    Pilih satu kandidat
                  </span>
                </div>
                <div className="mt-1.5 space-y-1.5">
                  {matchingCandidates.map(candidate => {
                    const candidateDetails = candidate.details;
                    const checked = selectedCandidateId === candidate.id;
                    const candidateName = candidateDetails?.name ?? candidate.customer_name;
                    const candidateReference =
                      candidateDetails?.paymentNumber
                      ?? candidateDetails?.reference
                      ?? `#${candidate.candidate_id}`;
                    return (
                      <label
                        key={candidate.id}
                        className={`flex cursor-pointer items-start gap-2 rounded border px-2 py-1.5 transition-colors ${
                          checked
                            ? "border-green-400 bg-muted shadow-sm"
                            : "border-border bg-background/70 hover:bg-muted"
                        }`}
                      >
                        <Checkbox
                          checked={checked}
                          onCheckedChange={value => onToggleCandidate?.(m.id, candidate.id, value === true)}
                          onClick={e => e.stopPropagation()}
                          aria-label={`Pilih kandidat ${candidateReference}`}
                          className="mt-0.5"
                        />
                        <span className="min-w-0 flex-1">
                          <span className="flex items-center justify-between gap-2">
                            <span className="truncate text-xs font-medium text-foreground">
                              {candidateName || `${CANDIDATE_TYPE_LABELS[candidate.candidate_type] ?? candidate.candidate_type} #${candidate.candidate_id}`}
                            </span>
                            <ScoreBadge score={candidate.match_score} />
                          </span>
                          <span className="mt-0.5 flex flex-wrap gap-x-3 gap-y-0.5 text-[10px] text-muted-foreground">
                            <span>{candidateReference}</span>
                            {candidateDetails?.date && <span>{fmtDate(String(candidateDetails.date))}</span>}
                            {candidateDetails?.amount != null && <span>{idr(candidateDetails.amount)}</span>}
                          </span>
                        </span>
                      </label>
                    );
                  })}
                </div>
              </div>
            )}

            {!best && m.status === "unmatched" && (
              <div className="mt-2 flex flex-wrap items-center gap-2 text-xs text-amber-600 dark:text-amber-400">
                <span className="flex items-center gap-1">
                  <AlertTriangle className="w-3 h-3" />
                  {isQris ? "Belum ada kandidat QRIS" : "Belum ada kandidat match"}
                </span>
                {isQris && onGenerateQrisCandidates && (
                  <Button
                    size="sm"
                    variant="outline"
                    className="h-7 gap-1 border-indigo-300 text-[11px] text-indigo-700 hover:bg-indigo-50 dark:border-indigo-700 dark:text-indigo-300 dark:hover:bg-indigo-950/40"
                    disabled={qrisGenerationPending}
                     onClick={(event) => {
                       event.stopPropagation();
                       onGenerateQrisCandidates(m.id);
                     }}
                  >
                    {qrisGenerationPending
                      ? <Loader2 className="h-3 w-3 animate-spin" />
                      : <CreditCard className="h-3 w-3" />}
                    {qrisGenerationPending ? "Membuat kandidat..." : "Cari Kandidat QRIS"}
                  </Button>
                )}
                {!isQris && <span>— jalankan AI Matching</span>}
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
            className="mt-3 border-orange-300 bg-orange-50 text-orange-900 dark:bg-orange-950 dark:border-orange-700 dark:text-orange-200"
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
            <Button
              size="sm"
              variant="outline"
              className="h-7 gap-1 border-indigo-300 text-xs text-indigo-700 hover:bg-indigo-50 dark:border-indigo-800 dark:text-indigo-300"
              onClick={() => onMapCoa(m)}
            >
              <BookOpen className="h-3.5 w-3.5" />
              Referensi COA
            </Button>
            {canRematchHistoricalReview && (
              <Button
                size="sm"
                variant="outline"
                className="h-7 gap-1 border-amber-300 text-xs text-amber-900 hover:bg-amber-50 dark:border-amber-700 dark:text-amber-200"
                onClick={() => onRunMatching("rematch_non_final")}
                title="Evaluasi ulang transaksi ini dengan Rule AI dan Referensi COA terbaru."
              >
                <RotateCcw className="h-3.5 w-3.5" />
                Jalankan Ulang Matching
              </Button>
            )}
            {canRetryRuleAutoPost && onRetryMatching && (
              <Button
                size="sm"
                variant="outline"
                className="h-7 gap-1 border-amber-400 bg-amber-50 text-xs text-amber-900 hover:bg-amber-100 dark:border-amber-700 dark:bg-amber-950 dark:text-amber-200 dark:hover:bg-amber-900"
                disabled={retryMatchingPending}
                onClick={() => onRetryMatching(m)}
                title="Evaluasi ulang Rule AI untuk mutasi ini saja. Jurnal hanya dibuat bila seluruh safeguard lulus."
              >
                {retryMatchingPending
                  ? <Loader2 className="h-3.5 w-3.5 animate-spin" />
                  : <RotateCcw className="h-3.5 w-3.5" />}
                {retryMatchingPending ? "Recon ulang..." : "Recon Ulang"}
              </Button>
            )}
            {isLegacyReferenceCoaRetryable(m) && onRetryReferenceCoa && (
              <Button
                size="sm"
                variant="outline"
                className="h-7 gap-1 border-indigo-300 text-xs text-indigo-700 hover:bg-indigo-50 dark:border-indigo-800 dark:text-indigo-300"
                disabled={retryReferenceCoaPending}
                onClick={() => onRetryReferenceCoa(m)}
                title="Menjalankan ulang Referensi COA. Jurnal hanya dibuat bila semua safeguard lulus."
              >
                {retryReferenceCoaPending
                  ? <Loader2 className="h-3.5 w-3.5 animate-spin" />
                  : <RotateCcw className="h-3.5 w-3.5" />}
                {retryReferenceCoaPending ? "Memproses..." : "Proses Ulang COA"}
              </Button>
            )}
            {/* One clear primary action per mutation. Backend remains the final guard. */}
            {isManualReviewActionable(m) && (
              <Button
                size="sm"
                className="h-7 text-xs gap-1 bg-orange-600 hover:bg-orange-700 disabled:opacity-50"
                onClick={() => onMapCoa(m)}
                title="Pilih atau ganti COA lalu buat draft jurnal"
              >
                <BookOpen className="w-3.5 h-3.5" />
                Pilih COA &amp; Buat Draft
              </Button>
            )}
            {!mappingError && isUiApprovalEligible(m) && (
              <Button
                size="sm"
                className="h-7 text-xs gap-1 bg-green-600 hover:bg-green-700 disabled:opacity-50"
                disabled={matchingCandidates.length > 0 && selectedCandidateId == null}
                title={matchingCandidates.length > 0 && selectedCandidateId == null ? "Pilih kandidat yang cocok terlebih dahulu" : undefined}
                onClick={() => {
                  const selected = matchingCandidates.find(candidate => candidate.id === selectedCandidateId);
                  if (selected && onApproveCandidate) {
                    onApproveCandidate(m, selected);
                  } else {
                    onApprove(m);
                  }
                }}
              >
                <CheckCircle2 className="w-3.5 h-3.5" />
                Setujui
              </Button>
            )}
            {canonicalApprovalReady && canonicalApprovalCandidate && onApproveCandidate && (
              <Button
                size="sm"
                className="h-7 text-xs gap-1 bg-green-600 hover:bg-green-700 disabled:opacity-50"
                onClick={(event) => {
                  event.stopPropagation();
                  onApproveCandidate(m, canonicalApprovalCandidate);
                }}
              >
                <CheckCircle2 className="w-3.5 h-3.5" />
                Tautkan &amp; Approve Settlement
              </Button>
            )}
            {canonicalOverrideReady
              && !canonicalApprovalReady
              && canonicalApprovalCandidate
              && onManualOverrideCandidate && (
              <Button
                size="sm"
                variant="outline"
                className="h-7 gap-1 border-orange-400 text-xs text-orange-800 hover:bg-orange-50 dark:border-orange-700 dark:text-orange-200"
                onClick={(event) => {
                  event.stopPropagation();
                  onManualOverrideCandidate(m, canonicalApprovalCandidate);
                }}
              >
                <ShieldAlert className="h-3.5 w-3.5" />
                Selesaikan Manual (Override)
              </Button>
            )}
             {!isManualReviewActionable(m) && !isUiApprovalEligible(m) && !canonicalApprovalReady && matchingCandidates.length === 0 && (m.status === "unmatched" || m.status === "matched" || m.status === "duplicate_need_review") && (
              <Button
                size="sm"
                variant="outline"
                className="h-7 text-xs gap-1 border-amber-300 text-amber-800 hover:bg-amber-50 dark:text-amber-300"
                 onClick={(event) => {
                   event.stopPropagation();
                   // QRIS must first go through candidate generation. It cannot
                   // be approved through the generic manual journal flow.
                   if (isQris && onGenerateQrisCandidates) {
                     onGenerateQrisCandidates(m.id);
                   } else if (cands.length > 0 && !isQris) {
                     onApprove(m);
                   } else {
                     onDetail(m);
                   }
                }}
              >
                 {isQris && onGenerateQrisCandidates
                   ? <CreditCard className="w-3.5 h-3.5" />
                   : cands.length > 0 && !isQrisMutation(m)
                  ? <CheckCircle2 className="w-3.5 h-3.5" />
                  : <Eye className="w-3.5 h-3.5" />}
                 {isQris && onGenerateQrisCandidates
                   ? "Cari Kandidat QRIS"
                   : cands.length > 0 && !isQrisMutation(m)
                  ? "Pilih Kandidat & Approve"
                  : "Lengkapi & Approve Manual"}
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
            {(m.status === "approved" || m.status === "posted") && (
              <Button size="sm" variant="outline" className="h-7 text-xs gap-1" onClick={() => onDetail(m)}>
                <Eye className="w-3.5 h-3.5" />
                Lihat Detail
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
  onMapCoa,
  onApprove,
  onPost,
  onReject,
  onReverse,
  onReopen,
  onApproveQris,
  onApproveCandidate,
  onManualOverrideCandidate,
  onFindMissing,
  onGenerateQrisCandidates,
  matchingPending,
  mappingError,
  onApproveQrisBatch,
  approveQrisPending,
  selectedQrisPaymentIds,
  onToggleQrisPayment,
  onToggleAllQrisPayments,
}: {
  mutation: BankMutation | null;
  open: boolean;
  onClose: () => void;
  onMapCoa: (m: BankMutation) => void;
  onApprove: (m: BankMutation) => void;
  onPost:    (m: BankMutation) => void;
  onReject:  (m: BankMutation) => void;
  onReverse: (m: BankMutation) => void;
  onReopen:  (m: BankMutation) => void;
  onApproveQris: (m: BankMutation) => void;
  onApproveCandidate?: (m: BankMutation, candidate: Candidate) => void;
  onManualOverrideCandidate?: (m: BankMutation, candidate: Candidate) => void;
  onFindMissing: () => void;
  onGenerateQrisCandidates?: (mutationId?: number) => void;
  matchingPending: boolean;
  mappingError?: MappingRequiredError;
  onApproveQrisBatch?: (candidateId: number, mutationId: number, candidate: QrisCandidateAudit, paymentIds?: number[]) => void;
  approveQrisPending?: boolean;
  selectedQrisPaymentIds: number[];
  onToggleQrisPayment?: (candidateId: number, paymentId: number, checked: boolean) => void;
  onToggleAllQrisPayments?: (candidate: QrisCandidateAudit, checked: boolean) => void;
}) {
  if (!mutation) return null;
  const m     = mutation;
  const cands = visibleCandidates(m);
  const qrisAudit = m.qris_candidate_audit ?? qrisAuditsForMutation(m)[0];
  const qrisGrossAmount = numericValue(qrisAudit?.gross_amount) ?? 0;
  const qrisNetAmount = numericValue(qrisAudit?.net_amount) ?? 0;
  const qrisStoredDeduction = numericValue(qrisAudit?.observed_deduction) ?? 0;
  const qrisImpliedDeduction = Math.max(0, qrisGrossAmount - qrisNetAmount);
  const qrisDeductionMetadataMismatch =
    qrisAudit != null && Math.abs(qrisStoredDeduction - qrisImpliedDeduction) >= 0.5;
  const qrisDiagnostic = m.qris_candidate_diagnostic ?? null;
  const canonicalApprovalCandidate = canonicalSettlementCandidateForMutation(m);
  const canonicalApprovalReady = isCanonicalSettlementApprovalEligible(m);
  const canonicalOverrideReady = isCanonicalSettlementManualOverrideEligible(m);
  const canGenerateQrisForMutation = isQrisMutation(m)
    && qrisAudit == null
    && onGenerateQrisCandidates != null;
  const settledQrisPaymentIds = new Set((qrisAudit?.settled_payment_ids ?? []).map(Number));
  const currentQrisPaymentIds = Array.isArray(qrisAudit?.current_payment_ids)
    ? new Set(qrisAudit.current_payment_ids.map(Number))
    : null;
  const currentQrisPaymentAmounts = qrisAudit?.current_payment_amounts ?? {};
  const availableQrisItems = (qrisAudit?.payment_items ?? []).filter((item) => {
    const id = Number(item.paymentId ?? item.payment_id);
    return Number.isInteger(id)
      && id > 0
      && (currentQrisPaymentIds
        ? currentQrisPaymentIds.has(id)
        : !settledQrisPaymentIds.has(id));
  });
  const availableQrisPaymentIds = availableQrisItems.map((item) =>
    Number(item.paymentId ?? item.payment_id),
  );
  const selectedQrisPayments = selectedQrisPaymentIds.filter((id) => availableQrisPaymentIds.includes(id));
  const allQrisPaymentsSelected = availableQrisPaymentIds.length > 0
    && availableQrisPaymentIds.every((id) => selectedQrisPayments.includes(id));
  const qrisPaymentIdsForApproval = selectedQrisPayments;
  const isIN  = m.direction === "IN";
  const currentStep = getLifecycleIndex(m.status);

  return (
    <Sheet open={open} onOpenChange={onClose}>
      <SheetContent side="right" className="!w-screen !max-w-none sm:!w-[32rem] sm:!max-w-[32rem] overflow-hidden p-0 flex flex-col">
        <SheetHeader className="px-4 py-4 border-b shrink-0">
          <div className="flex items-start justify-between gap-2">
            <div className="min-w-0">
              <SheetTitle className="text-base leading-tight truncate">{mutationHeading(m)}</SheetTitle>
              <p className="text-xs text-muted-foreground mt-1">
                {fmtDate(m.transaction_date)} · {mutationSourceLabel(m)}
              </p>
            </div>
            <span className={`shrink-0 text-xs px-2 py-1 rounded-full border font-medium ${statusColor(m)}`}>
              {statusLabel(m)}
            </span>
          </div>
        </SheetHeader>

        <ScrollArea className="flex-1 overflow-auto">
          <div className="min-w-0 px-4 py-4 space-y-4">
            {(() => {
              const evidence = reconciliationEvidence(m);
              const incomplete = !isExactMatch(m) && (m.status === "unmatched" || m.status === "matched" || m.status === "duplicate_need_review" || hasUnresolvedVariance(m));
              return (
                <>
                  <section aria-labelledby="review-summary-title" className="space-y-3">
                    {m.status === "manual_review" && (
                      <Alert className="border-amber-300 bg-amber-50 text-amber-950 dark:border-amber-800 dark:bg-amber-950 dark:text-amber-100">
                        <ShieldAlert className="h-4 w-4" />
                        <AlertDescription className="space-y-1">
                          <p className="font-semibold">Review Manual Diperlukan</p>
                          <p>
                            {m.review_reason ??
                              "Mutasi ini memerlukan review manual, tetapi alasan historisnya belum tercatat. Jalankan ulang matching untuk mengevaluasi rule terbaru."}
                          </p>
                          {m.review_code && <p className="font-mono text-[11px] opacity-80">Kode: {m.review_code}</p>}
                          <p className="text-xs">
                            Periksa COA dan gunakan “Referensi COA” atau “Pilih COA & Buat Draft” setelah transaksi dipastikan benar.
                          </p>
                        </AlertDescription>
                      </Alert>
                    )}
                    <div className="rounded-xl border bg-muted/20 p-4">
                      <p id="review-summary-title" className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Ringkasan</p>
                      <div className="mt-3 grid grid-cols-2 gap-x-4 gap-y-3 text-sm">
                        <div><p className="text-xs text-muted-foreground">Uang masuk bank</p><p className="font-semibold tabular-nums">{idr(evidence.bankAmount)}</p></div>
                        <div><p className="text-xs text-muted-foreground">Transaksi ditemukan</p><p className="font-semibold tabular-nums">{idr(evidence.foundAmount)}</p></div>
                        <div><p className="text-xs text-muted-foreground">MDR / potongan</p><p className="font-semibold tabular-nums">{idr(evidence.deduction)}</p></div>
                        <div><p className="text-xs text-muted-foreground">Seharusnya diterima</p><p className="font-semibold tabular-nums">{idr(evidence.expectedAmount)}</p></div>
                      </div>
                    </div>
                    {incomplete && evidence.missingAmount > 0 && (
                      <div className="rounded-lg border border-amber-300 bg-amber-50 px-3 py-3 text-amber-950 dark:border-amber-800 dark:bg-amber-950 dark:text-amber-100">
                        <p className="font-semibold">Masih ada {idr(evidence.missingAmount)} yang belum ditemukan.</p>
                        <p className="mt-1 text-xs leading-relaxed">Sistem belum menemukan transaksi Sport Center yang menjelaskan seluruh uang masuk bank ini.</p>
                        <Button
                          size="sm"
                          variant="outline"
                          className="mt-3 gap-1.5 border-amber-400 text-amber-900 hover:bg-amber-100 dark:text-amber-100"
                          onClick={() => { onClose(); onFindMissing(); }}
                          disabled={matchingPending}
                        >
                          {matchingPending && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
                          {matchingPending ? "Mencari transaksi..." : "Cari Transaksi yang Hilang"}
                        </Button>
                      </div>
                    )}
                  </section>

                  <section aria-labelledby="found-transactions-title">
                    <div className="flex items-center justify-between gap-2">
                      <p id="found-transactions-title" className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Transaksi yang Ditemukan</p>
                      {evidence.transactions.length > 0 && <span className="text-xs text-muted-foreground">{evidence.transactions.length} transaksi</span>}
                    </div>
                    {evidence.transactions.length > 0 ? (
                      <div className="mt-2 divide-y rounded-lg border">
                        {evidence.transactions.map((transaction, index) => (
                          <div key={`${transaction.label}-${index}`} className="flex items-center justify-between gap-3 px-3 py-2.5">
                            <div className="min-w-0">
                              <p className="truncate text-sm font-medium">{transaction.label}</p>
                              <p className="text-xs text-muted-foreground">
                                {[transaction.customer, transaction.facility, transaction.date ? fmtDate(String(transaction.date)) : null].filter(Boolean).join(" · ") || "Detail transaksi tersedia di sistem"}
                              </p>
                            </div>
                            <p className="shrink-0 text-sm font-semibold tabular-nums">{idr(transaction.amount)}</p>
                          </div>
                        ))}
                      </div>
                    ) : (
                      <p className="mt-2 rounded-lg border border-dashed px-3 py-4 text-center text-sm text-muted-foreground">Belum ada transaksi yang dapat ditampilkan.</p>
                    )}
                  </section>

                  <Collapsible>
                    <CollapsibleTrigger asChild>
                      <button type="button" className="flex w-full items-center justify-between rounded-lg border px-3 py-2.5 text-left text-sm font-medium hover:bg-muted/40">
                        Detail Teknis
                        <ChevronDown className="h-4 w-4 text-muted-foreground" />
                      </button>
                    </CollapsibleTrigger>
                    <CollapsibleContent className="pt-3 space-y-4">
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
                <div key={label} className="flex min-w-0 flex-col gap-0.5 sm:flex-row sm:items-start sm:justify-between sm:gap-2">
                  <span className="text-muted-foreground sm:shrink-0 sm:w-36">{label}</span>
                  <span className="min-w-0 flex-1 font-medium break-all sm:text-right">{value}</span>
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
                        {c.amount_match   && <span className="text-[10px] text-green-600 bg-green-50 dark:bg-green-950 px-1.5 py-0.5 rounded">✓ Nominal</span>}
                        {c.date_match     && <span className="text-[10px] text-green-600 bg-green-50 dark:bg-green-950 px-1.5 py-0.5 rounded">✓ Tanggal</span>}
                        {c.name_match     && <span className="text-[10px] text-green-600 bg-green-50 dark:bg-green-950 px-1.5 py-0.5 rounded">✓ Nama</span>}
                        {c.order_id_match && <span className="text-[10px] text-green-600 bg-green-50 dark:bg-green-950 px-1.5 py-0.5 rounded">✓ Order ID</span>}
                        {c.proof_match    && <span className="text-[10px] text-green-600 bg-green-50 dark:bg-green-950 px-1.5 py-0.5 rounded">✓ Bukti Transfer</span>}
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
                    <div className="flex items-center gap-2">
                      {qrisAudit.status !== "approved"
                        && qrisAudit.id != null
                        && onToggleAllQrisPayments
                        && availableQrisPaymentIds.length > 0 && (
                        <label className="flex cursor-pointer items-center gap-1.5 text-[10px] font-medium normal-case tracking-normal text-indigo-700 dark:text-indigo-300">
                           <Checkbox
                            checked={allQrisPaymentsSelected}
                            onCheckedChange={(checked) => onToggleAllQrisPayments(qrisAudit, checked === true)}
                            onClick={e => e.stopPropagation()}
                            aria-label="Pilih semua payment QRIS yang belum tersettle"
                          />
                          Pilih semua payment ({availableQrisPaymentIds.length})
                        </label>
                      )}
                      {qrisAudit.status === "approved" ? (
                        <Badge className="bg-green-600 text-white text-xs gap-1">
                          <CheckCircle2 className="w-3 h-3" /> Disetujui
                        </Badge>
                      ) : (
                        <Badge variant="outline" className="border-amber-400 bg-amber-100 text-amber-900 dark:border-amber-700 dark:bg-amber-950 dark:text-amber-200 text-xs">
                          {QRIS_AUDIT_STATUS_LABELS[qrisAudit.reconciliation_status] ?? qrisAudit.reconciliation_status}
                        </Badge>
                      )}
                    </div>
                  </div>

                  {/* Summary */}
                  <div className="rounded-lg border border-indigo-200 bg-indigo-50 p-3 space-y-2 dark:border-indigo-800 dark:bg-indigo-950">
                    <div className="min-w-0 grid grid-cols-1 gap-y-1 text-xs sm:grid-cols-2 sm:gap-x-3">
                      <span className="min-w-0 text-slate-600 dark:text-slate-400">Provider</span>
                      <span className="min-w-0 font-medium break-all sm:text-right">{qrisAudit.provider_code || "Belum dikenali"}</span>
                      <span className="text-slate-600 dark:text-slate-400">Perkiraan settlement</span>
                      <span className="min-w-0 font-medium break-words sm:text-right">
                        {qrisAudit.estimated_settlement_date
                          ? fmtDate(qrisAudit.estimated_settlement_date)
                          : "Belum tersedia"}
                      </span>
                      <span className="text-slate-600 dark:text-slate-400">Total bruto</span>
                      <span className="min-w-0 font-medium break-words sm:text-right">{idr(qrisAudit.gross_amount)}</span>
                      <span className="text-slate-600 dark:text-slate-400">Dana masuk (netto)</span>
                      <span className="min-w-0 font-medium break-words text-green-700 sm:text-right">{idr(qrisAudit.net_amount)}</span>
                      <span className="text-slate-600 dark:text-slate-400">Potongan MDR</span>
                      <span className="min-w-0 font-medium break-words text-red-600 sm:text-right">{idr(qrisAudit.observed_deduction)}</span>
                      {qrisDeductionMetadataMismatch && (
                        <>
                          <span className="text-slate-600 dark:text-slate-400">MDR tersirat gross − netto</span>
                          <span className="min-w-0 font-medium break-words text-amber-700 sm:text-right">
                            {idr(qrisImpliedDeduction)}
                          </span>
                          <p className="sm:col-span-2 rounded border border-amber-300 bg-amber-50 px-2 py-1 text-[11px] leading-relaxed text-amber-900 dark:border-amber-700 dark:bg-amber-950 dark:text-amber-200">
                            Data kandidat lama menyimpan MDR {idr(qrisStoredDeduction)}, tetapi gross − netto menunjukkan {idr(qrisImpliedDeduction)}.
                            Regenerasi kandidat atau gunakan override manual setelah memastikan bukti bank.
                          </p>
                        </>
                      )}
                    </div>

                    {/* Payment items list */}
                    {(qrisAudit.payment_items?.length ?? 0) > 0 && (
                      <div className="mt-1">
                         <p className="text-[10px] font-semibold uppercase tracking-wide text-slate-500 mb-1">
                           {availableQrisItems.length} Sport Payment tersisa dalam Batch
                        </p>
                        <div className="rounded border divide-y text-xs max-h-48 overflow-y-auto bg-white dark:bg-slate-900">
                           {availableQrisItems.map((item, idx) => {
                            const pid = item.paymentId ?? item.payment_id ?? 0;
                             const paymentAmount = currentQrisPaymentAmounts[String(pid)];
                             const gross = paymentAmount ?? item.grossAmount ?? item.gross_amount ?? 0;
                            const paymentNo = item.payment_number;
                            const bookingNo = item.booking_number;
                            const paidAt = qrisPaymentDateValue(item);
                            return (
                              <div key={idx} className="flex items-start gap-2 px-2 py-1.5 space-y-0.5">
                                {qrisAudit.id != null && onToggleQrisPayment && (
                                  <Checkbox
                                    checked={selectedQrisPayments.includes(Number(pid))}
                                    disabled={String(qrisAudit.status ?? "").toLowerCase() === "approved"
                                      || (currentQrisPaymentIds
                                        ? !currentQrisPaymentIds.has(Number(pid))
                                        : settledQrisPaymentIds.has(Number(pid)))}
                                    onCheckedChange={(checked) => onToggleQrisPayment(qrisAudit.id!, Number(pid), checked === true)}
                                    onClick={e => e.stopPropagation()}
                                    aria-label={`Pilih payment ${paymentNo || `#${pid}`}`}
                                    className="mt-0.5"
                                  />
                                )}
                                <div className="min-w-0 flex-1">
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
                              </div>
                            );
                          })}
                        </div>
                      </div>
                    )}

                    {qrisAudit.review_reason && (
                      <p className="rounded border border-amber-300 bg-amber-50 px-2 py-1.5 text-[11px] font-medium leading-relaxed text-slate-950 dark:border-amber-700 dark:bg-amber-950 dark:text-amber-50">
                        {qrisAudit.review_reason}
                      </p>
                    )}
                  </div>

                  {/* Approve button — MATCHED = normal, REVIEW = force-approve with warning */}
                  {String(qrisAudit.status ?? "").toLowerCase() !== "approved" && qrisAudit.id != null && onApproveQrisBatch && (() => {
                    const recoStatus = String(qrisAudit.reconciliation_status ?? "").toUpperCase();
                    const isMatched = recoStatus === "MATCHED";
                    const isReview  = recoStatus === "REVIEW";
                    if (isMatched) {
                      return (
                        <Button
                          size="sm"
                          className="w-full gap-1.5 bg-indigo-600 hover:bg-indigo-700 text-white"
                          disabled={qrisPaymentIdsForApproval.length === 0 || approveQrisPending}
                          onClick={() => onApproveQrisBatch(qrisAudit.id!, qrisAudit.mutation_id, qrisAudit, qrisPaymentIdsForApproval)}
                        >
                          {approveQrisPending
                            ? <Loader2 className="w-3.5 h-3.5 animate-spin" />
                            : <CheckCircle2 className="w-3.5 h-3.5" />}
                          {approveQrisPending ? "Memproses approval QRIS..." : "Setujui Payment Terpilih — Buat QRIS Settlement"}
                        </Button>
                      );
                    }
                    if (isReview) {
                      return (
                        <div className="space-y-2">
                          <div className="rounded border border-amber-300 bg-amber-50 px-3 py-2 text-xs text-amber-800 dark:border-amber-700 dark:bg-amber-950 dark:text-amber-200 space-y-1">
                            <p className="font-semibold flex items-center gap-1">
                              <AlertTriangle className="w-3 h-3 shrink-0" />
                              Perlu verifikasi — provider atau MDR belum cocok
                            </p>
                            <p>
                              Approve tetap bisa dilakukan, namun pastikan data payment sudah benar.
                            </p>
                          </div>
                          <Button
                            size="sm"
                            variant="outline"
                            className="w-full gap-1.5 border-amber-400 text-amber-900 hover:bg-amber-50 dark:border-amber-600 dark:text-amber-300 dark:hover:bg-amber-950/40"
                            disabled={qrisPaymentIdsForApproval.length === 0 || approveQrisPending}
                            onClick={() => onApproveQrisBatch(qrisAudit.id!, qrisAudit.mutation_id, qrisAudit, qrisPaymentIdsForApproval)}
                          >
                            {approveQrisPending
                              ? <Loader2 className="w-3.5 h-3.5 animate-spin" />
                              : <AlertTriangle className="w-3.5 h-3.5" />}
                            {approveQrisPending ? "Memproses approval QRIS..." : "Setujui Payment Terpilih (Override REVIEW)"}
                          </Button>
                        </div>
                      );
                    }
                    // UNMATCHED or unknown — fully blocked
                    return (
                      <div className="rounded border border-slate-200 bg-slate-50 px-3 py-2 text-xs text-slate-600 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-400 space-y-1">
                        <p className="font-semibold flex items-center gap-1">
                          <AlertTriangle className="w-3 h-3 shrink-0" />
                          Tidak dapat disetujui
                        </p>
                        <p>Status <strong>{qrisAudit.reconciliation_status || "UNMATCHED"}</strong>: jalankan AI Matching terlebih dahulu.</p>
                      </div>
                    );
                  })()}
                  {String(qrisAudit.status ?? "").toLowerCase() === "approved" && (
                    <p className="text-[11px] text-green-700 dark:text-green-400 text-center">
                      Payment terpilih sudah disetujui. Settlement QRIS telah dibuat dan siap dicocokkan ke mutasi bank.
                    </p>
                  )}
                </div>
              </>
            )}
            {!qrisAudit && qrisDiagnostic && (
              <>
                <Separator />
                <QrisCandidateDiagnosticBlock
                  mutation={m}
                  diagnostic={qrisDiagnostic}
                />
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
                        done    ? "bg-green-100 text-green-700 border-green-200 dark:bg-green-950 dark:text-green-400" :
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
                    </CollapsibleContent>
                  </Collapsible>
                </>
              );
            })()}
          </div>
        </ScrollArea>

        {/* Mapping-Required Warning (Task #6) */}
        {mappingError && (
          <div className="px-4 pb-2 shrink-0">
            <Alert className="border-orange-300 bg-orange-50 text-orange-900 dark:bg-orange-950 dark:border-orange-700 dark:text-orange-200">
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
          {isManualReviewActionable(m) && (
            <Button
              className="flex-1 gap-1.5 bg-orange-600 hover:bg-orange-700 min-w-[180px]"
              onClick={() => { onClose(); onMapCoa(m); }}
              title="Pilih atau ganti COA lalu buat draft jurnal"
            >
              <BookOpen className="w-4 h-4" />
              Pilih COA &amp; Buat Draft
            </Button>
          )}
          {!mappingError && isUiApprovalEligible(m) && (
            <Button
              className="flex-1 gap-1.5 bg-green-600 hover:bg-green-700 min-w-[120px] disabled:opacity-50"
              onClick={() => { onClose(); onApprove(m); }}>
              <CheckCircle2 className="w-4 h-4" />
              Setujui Pencocokan
            </Button>
          )}
          {!mappingError
            && !isUiApprovalEligible(m)
            && m.status !== "manual_review"
            && canApprove(m)
            && cands.length > 0
            && !isQrisMutation(m)
            && (
              <Button
                className="flex-1 gap-1.5 bg-indigo-600 hover:bg-indigo-700 min-w-[170px]"
                onClick={() => { onClose(); onApprove(m); }}
              >
                <CheckCircle2 className="w-4 h-4" />
                Pilih Kandidat &amp; Approve
              </Button>
            )}
          {canGenerateQrisForMutation && (
            <Button
              variant="outline"
              className="flex-1 gap-1.5 border-indigo-300 text-indigo-700 hover:bg-indigo-50 dark:border-indigo-800 dark:text-indigo-300 min-w-[170px]"
              disabled={matchingPending}
              onClick={() => {
                onClose();
                onGenerateQrisCandidates(m.id);
              }}
            >
              {matchingPending
                ? <Loader2 className="w-4 h-4 animate-spin" />
                : <CreditCard className="w-4 h-4" />}
              {matchingPending ? "Mencari kandidat..." : "Cari Kandidat QRIS"}
            </Button>
          )}
          {canonicalApprovalReady && canonicalApprovalCandidate && onApproveCandidate && (
            <Button
              className="flex-1 gap-1.5 bg-green-600 hover:bg-green-700 min-w-[190px]"
              onClick={() => {
                onClose();
                onApproveCandidate(m, canonicalApprovalCandidate);
              }}
            >
              <CheckCircle2 className="w-4 h-4" />
              Tautkan &amp; Approve Settlement
            </Button>
          )}
          {canonicalOverrideReady
            && !canonicalApprovalReady
            && canonicalApprovalCandidate
            && onManualOverrideCandidate && (
            <Button
              variant="outline"
              className="flex-1 gap-1.5 border-orange-400 text-orange-800 hover:bg-orange-50 dark:border-orange-700 dark:text-orange-200 min-w-[190px]"
              onClick={() => onManualOverrideCandidate(m, canonicalApprovalCandidate)}
            >
              <ShieldAlert className="w-4 h-4" />
              Selesaikan Manual (Override)
            </Button>
          )}
          {!canGenerateQrisForMutation
            && !canonicalApprovalReady
            && !canonicalOverrideReady
            && !isUiApprovalEligible(m)
            && m.status !== "manual_review"
            && (m.status === "unmatched" || m.status === "matched" || m.status === "duplicate_need_review") && (
            <Button
              variant="outline"
              className="flex-1 gap-1.5 border-amber-300 text-amber-800 hover:bg-amber-50 dark:text-amber-300 min-w-[150px]"
              onClick={() => {
                if (canApprove(m) && cands.length === 0 && !isQrisMutation(m)) {
                  onClose();
                  onApprove(m);
                  return;
                }
                onClose();
              }}
            >
              {canApprove(m) && cands.length === 0 && !isQrisMutation(m)
                ? <CheckCircle2 className="w-4 h-4" />
                : <Search className="w-4 h-4" />}
              {canApprove(m) && cands.length === 0 && !isQrisMutation(m)
                ? "Lengkapi & Approve Manual"
                : "Periksa Transaksi"}
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
          {!isUiApprovalEligible(m) && !canPost(m) && !canReject(m) && !canReverse(m) && !canReopen(m) && (
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
  const [form, setForm] = useState({ company_id: "", label: "", sheet_id: "", bank_account_number: "", bank_name: "", tab_name: "Mutasi_Bank" });

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
    setForm({ company_id: "", label: "", sheet_id: "", bank_account_number: "", bank_name: "", tab_name: "Mutasi_Bank" });
    setShowForm(true);
  };
  const openEdit = (cfg: SheetConfig) => {
    setEditTarget(cfg);
    setForm({
      company_id: cfg.company_id ? String(cfg.company_id) : "",
      label: cfg.label,
      sheet_id: cfg.sheet_id,
      bank_account_number: cfg.bank_account_number ?? "",
      bank_name: cfg.bank_name ?? "",
      tab_name: cfg.tab_name,
    });
    setShowForm(true);
  };
  const saveConfig = async () => {
    if (!form.label || !form.sheet_id) { toast({ title: "Label dan Sheet ID wajib diisi", variant: "destructive" }); return; }
    const body = {
      company_id: form.company_id ? Number(form.company_id) : null,
      label: form.label,
      sheet_id: form.sheet_id,
      bank_account_number: form.bank_account_number.trim() || null,
      bank_name: form.bank_name.trim() || null,
      tab_name: form.tab_name || "Mutasi_Bank",
    };
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
                      {cfg.bank_name && <>Bank: <code className="bg-muted px-1 rounded">{cfg.bank_name}</code> · </>}
                      {cfg.bank_account_number && <>No. Rek: <code className="bg-muted px-1 rounded">{cfg.bank_account_number}</code> · </>}
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
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <label className="text-sm font-medium">Nama Bank</label>
                <Input placeholder="Contoh: BCA" value={form.bank_name} onChange={e => setForm(f => ({ ...f, bank_name: e.target.value }))} />
              </div>
              <div className="space-y-1.5">
                <label className="text-sm font-medium">Nomor Rekening</label>
                <Input inputMode="numeric" placeholder="Contoh: 1234567890" value={form.bank_account_number} onChange={e => setForm(f => ({ ...f, bank_account_number: e.target.value }))} />
              </div>
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
            { n: 3, icon: CheckCircle2,  label: "Pilih & Approve",        desc: "Pilih kandidat yang benar lalu setujui batch yang dipilih." },
            { n: 4, icon: ReceiptText,   label: "Post ke Accounting",    desc: "Promosikan draft jurnal ke status posted." },
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
  const [filterPaymentType, setFilterPaymentType] = useState<"all" | SportPaymentType>("all");
  const [filterFrom,     setFilterFrom]     = useState("");
  const [filterTo,       setFilterTo]       = useState("");
  const [filterSearch,   setFilterSearch]   = useState(
    () => new URLSearchParams(window.location.search).get("search") ?? "",
  );
  const [page,           setPage]           = useState(0);
  const [showAdvancedFilters, setShowAdvancedFilters] = useState(false);
  const [showQrisAuditList, setShowQrisAuditList] = useState(false);
  const PAGE_SIZE = 20;

  // ── UI state ──────────────────────────────────────────────────────────────
  const [workflowStage, setWorkflowStage] = useState<WorkflowStage>("sync");
  const [matchingBackgroundPending, setMatchingBackgroundPending] = useState(false);
  const [detailMutation,      setDetailMutation]      = useState<BankMutation | null>(null);
  const [coaReferenceTarget,  setCoaReferenceTarget]  = useState<BankMutation | null>(null);
  const [actionDialog,        setActionDialog]        = useState<{ mutation: BankMutation; mode: DialogMode } | null>(null);
  const [qrisDetailLoadingId, setQrisDetailLoadingId] = useState<number | null>(null);
  const [selectedQrisCandidateIds, setSelectedQrisCandidateIds] = useState<number[]>([]);
  const [selectedQrisPaymentIds, setSelectedQrisPaymentIds] = useState<Record<number, number[]>>({});
  const [selectedCandidateByMutation, setSelectedCandidateByMutation] = useState<Record<number, number | null>>({});
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
  const [qrisDateTarget, setQrisDateTarget] = useState<{
    paymentId: number;
    paymentNumber: string;
    paymentDate: string;
  } | null>(null);
  const [qrisPaymentDate, setQrisPaymentDate] = useState("");

  // ── Queries ──────────────────────────────────────────────────────────────
  const queryKey = ["bank-reconciliation", filterStatus, filterDir, filterProvider, filterPaymentType, filterFrom, filterTo, filterSearch, page];

  const { data, isLoading, refetch } = useQuery({
    queryKey,
    queryFn: async () => {
      const params = new URLSearchParams({ limit: String(PAGE_SIZE), offset: String(page * PAGE_SIZE) });
      if (filterStatus !== "all")   params.set("status",    filterStatus);
      if (filterDir    !== "all")   params.set("direction", filterDir);
      if (filterProvider !== "all") params.set("provider",  filterProvider);
       if (filterPaymentType !== "all") params.set("payment_type", filterPaymentType);
      if (filterFrom) params.set("from", filterFrom);
      if (filterTo)   params.set("to",   filterTo);
      if (filterSearch) params.set("search", filterSearch);
      const r = await fetch(`/api/bank-reconciliation/mutations?${params}`, { credentials: "include" });
      if (!r.ok) throw new Error(await r.text());
      return r.json() as Promise<{ mutations: BankMutation[]; total: number }>;
    },
    // Keep the primary mutation list in sync with approvals performed by
    // another tab/admin. The QRIS audit query polls separately, but this list
    // used to stay stale until a hard reload.
    refetchInterval: 30_000,
    refetchOnWindowFocus: true,
  });

  const { data: summary } = useQuery({
    queryKey: ["bank-reconciliation-summary"],
    queryFn: async () => {
      const r = await fetch("/api/bank-reconciliation/summary", { credentials: "include" });
      return r.json() as Promise<{ summary: { status: string; count: string; total_amount: string }[] }>;
    },
    refetchInterval: 30_000,
  });

  const {
    data: qrisAuditData,
    isLoading: qrisAuditLoading,
    refetch: refetchQrisAudit,
  } = useQuery({
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
    mutationFn: async (mutationId?: number) => {
      if (qrisCompanyId == null) {
        throw new Error("Pilih satu perusahaan aktif sebelum membuat kandidat review QRIS.");
      }
      const r = await fetch("/api/bank-reconciliation/qris-candidates/generate", {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        // Persist only the candidate/review row. This is not final
        // reconciliation and does not create a journal or consume evidence.
        body: JSON.stringify({
          dryRun: false,
          companyId: qrisCompanyId,
          ...(mutationId != null ? { mutationId } : {}),
        }),
      });
      if (!r.ok) throw new Error(await r.text());
      return r.json() as Promise<{
        generated: number;
        persisted: number;
        reviewable: number;
        candidates: QrisCandidateAudit[];
      }>;
    },
    onSuccess: async (result) => {
      toast({
        title: `${result.persisted} pemeriksaan QRIS ditampilkan`,
        description: result.reviewable > 0
          ? `${result.reviewable} kandidat memiliki pasangan payment untuk direview.`
          : "Belum ada pasangan payment yang dapat diverifikasi; hasil ditampilkan sebagai UNMATCHED dan tidak dapat disetujui.",
      });
      setWorkflowStage("review");
      await Promise.all([refetchQrisAudit(), refetch()]);
      qc.invalidateQueries({ queryKey: ["bank-reconciliation"] });
    },
    onError: (e: Error) => toast({ title: "Gagal membuat kandidat QRIS", description: e.message, variant: "destructive" }),
  });

  const qrisPaymentDateMut = useMutation({
    mutationFn: async ({ paymentId, paymentDate }: { paymentId: number; paymentDate: string }) => {
      const response = await fetch(`/api/bank-reconciliation/qris-candidates/payments/${paymentId}/date`, {
        method: "PATCH",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ paymentDate, companyId: qrisCompanyId }),
      });
      const body = await response.json().catch(() => null);
      if (!response.ok) throw new Error(body?.error ?? "Gagal memperbarui tanggal payment");
      return body as {
        accounting?: { requiresCorrectionWorkflow?: boolean };
        message?: string;
      };
    },
    onSuccess: (result, variables) => {
      setQrisDateTarget(null);
      toast({
        title: "Tanggal payment berhasil disimpan",
        description: result.accounting?.requiresCorrectionWorkflow
          ? "Mirror sudah diperbarui. Jurnal posted tetap immutable dan memerlukan workflow koreksi."
          : "Data payment dan akunting yang masih mutable sudah disinkronkan. Kandidat QRIS diperbarui di latar belakang.",
      });
      // The date mutation has already committed successfully. Refresh the
      // visible lists without keeping the save mutation in a pending state;
      // candidate regeneration on the API is also intentionally asynchronous.
      void (async () => {
        const retryDelays = [0, 750, 1500, 3000, 5000];
        let candidateUpdated = false;

        for (const delay of retryDelays) {
          if (delay > 0) {
            await new Promise(resolve => setTimeout(resolve, delay));
          }
          try {
            const refreshed = await refetchQrisAudit();
            candidateUpdated = (refreshed.data?.candidates ?? []).some(candidate =>
              (candidate.payment_items ?? []).some(item => {
                const itemPaymentId = Number(item.payment_id ?? item.paymentId);
                const itemPaymentDate = String(
                  qrisPaymentDateValue(item) ?? "",
                ).slice(0, 10);
                return itemPaymentId === variables.paymentId
                  && itemPaymentDate === variables.paymentDate;
              }),
            );
            if (candidateUpdated) break;
          } catch {
            // The next poll can still observe the background regeneration.
          }
        }

        await Promise.allSettled([refetch()]);
        void qc.invalidateQueries({ queryKey: ["bank-reconciliation"] });
        toast({
          title: candidateUpdated
            ? "Kandidat QRIS sudah diperbarui"
            : "Kandidat QRIS masih diproses",
          description: candidateUpdated
            ? `Tanggal payment sudah menjadi ${variables.paymentDate}.`
            : "Data sumber sudah tersimpan. Kandidat akan diperbarui otomatis pada refresh berikutnya.",
        });
      })().catch(() => {
        void qc.invalidateQueries({ queryKey: ["bank-reconciliation"] });
      });
    },
    onError: (error: Error) => {
      toast({ title: "Gagal menyimpan tanggal payment", description: error.message, variant: "destructive" });
    },
  });

  const [qrisBatchConfirm, setQrisBatchConfirm] = useState<{
    selections: QrisApprovalSelection[];
    manualOverride?: boolean;
    overrideReason?: string;
  } | null>(null);

  const waitForMatchingCompletion = async () => {
    const deadline = Date.now() + 5 * 60 * 1000;
    while (Date.now() < deadline) {
      const response = await fetch("/api/bank-reconciliation/run-matching/status", {
        credentials: "include",
      });
      if (!response.ok) throw new Error("Status matching tidak dapat dibaca");
      const status = await response.json() as { running?: boolean };
      if (!status.running) return;
      await new Promise(resolve => window.setTimeout(resolve, 1000));
    }
    throw new Error("Matching belum selesai setelah 5 menit. Periksa status lalu coba lagi.");
  };

  const qrisCandidates = (qrisAuditData?.candidates ?? []).filter((candidate) =>
    !["approved", "completed", "superseded", "stale", "ineligible"].includes(
      String(candidate.status ?? "").toLowerCase(),
    ),
  );
  const getAvailableQrisPaymentIds = (candidate: QrisCandidateAudit): number[] =>
    getAvailableQrisPaymentIdsFromCandidate(candidate);
  const isQrisCandidateEligible = (candidate: QrisCandidateAudit): boolean =>
    candidate.id != null
    && ["MATCHED", "REVIEW"].includes(String(candidate.reconciliation_status ?? "").toUpperCase())
    && String(candidate.status ?? "").toLowerCase() !== "approved"
    && candidate.current_evidence_valid !== false
    && getUnconfirmedQrisPaymentIds(candidate).length === 0
    && getAvailableQrisPaymentIds(candidate).length > 0;
  const qrisApprovableCandidates = qrisCandidates.filter(isQrisCandidateEligible);
  const selectedQrisCandidates = qrisApprovableCandidates.filter((candidate) =>
    selectedQrisCandidateIds.includes(candidate.id!),
  );
  const allQrisCandidatesSelected =
    qrisApprovableCandidates.length > 0
    && qrisApprovableCandidates.every((candidate) => selectedQrisCandidateIds.includes(candidate.id!));

  const toggleQrisCandidate = (candidateId: number, checked: boolean) => {
    setSelectedQrisCandidateIds((current) =>
      checked
        ? Array.from(new Set([...current, candidateId]))
        : current.filter((id) => id !== candidateId),
    );
  };

  const toggleAllQrisCandidates = (checked: boolean) => {
    setSelectedQrisCandidateIds(checked ? qrisApprovableCandidates.map((candidate) => candidate.id!) : []);
  };

  const selectedPaymentIdsForCandidate = (candidate: QrisCandidateAudit): number[] => {
    if (candidate.id == null) return [];
    const available = new Set(getAvailableQrisPaymentIds(candidate));
    return (selectedQrisPaymentIds[candidate.id] ?? []).filter((id) => available.has(id));
  };

  const selectedPaymentIdsByMutation = (mutation: BankMutation): Record<number, number[]> =>
    Object.fromEntries(
      qrisAuditsForMutation(mutation)
        .filter((candidate): candidate is QrisCandidateAudit & { id: number } => candidate.id != null)
        .map((candidate) => [candidate.id, selectedPaymentIdsForCandidate(candidate)]),
    );

  const toggleQrisPayment = (candidateId: number, paymentId: number, checked: boolean) => {
    setSelectedQrisPaymentIds((current) => {
      const existing = current[candidateId] ?? [];
      const next = checked
        ? Array.from(new Set([...existing, paymentId]))
        : existing.filter((id) => id !== paymentId);
      return { ...current, [candidateId]: next };
    });
  };

  const toggleAllQrisPayments = (candidate: QrisCandidateAudit, checked: boolean) => {
    if (candidate.id == null) return;
    setSelectedQrisPaymentIds((current) => ({
      ...current,
      [candidate.id!]: checked ? getAvailableQrisPaymentIds(candidate) : [],
    }));
  };

  const handleApproveQrisBatch = (
    _candidateId: number,
    _mutationId: number,
    candidate: QrisCandidateAudit,
    paymentIds?: number[],
  ) => {
    const isReview = String(candidate.reconciliation_status ?? "").toUpperCase() === "REVIEW";
    if (!isReview) {
      openQrisBatchApprovalConfirmation([candidate], paymentIds);
      return;
    }
    const confirmed = window.confirm(
      "Kandidat ini masih REVIEW karena provider atau MDR belum terverifikasi.\n\n" +
      "Lanjutkan sebagai override manual? Payment tetap wajib confirmed, QRIS, H-1, " +
      "dan berada pada company/rekening yang sama.",
    );
    if (!confirmed) return;
    const overrideReason = window.prompt(
      "Alasan override manual (wajib untuk audit):",
      "Reviewer mengonfirmasi settlement QRIS sesuai dengan mutasi bank.",
    )?.trim();
    if (!overrideReason) {
      toast({
        title: "Override dibatalkan",
        description: "Alasan override wajib diisi agar keputusan dapat diaudit.",
        variant: "destructive",
      });
      return;
    }
    openQrisBatchApprovalConfirmation([candidate], paymentIds, {
      manualOverride: true,
      overrideReason,
    });
  };

  const openQrisBatchApprovalConfirmation = (
    candidates: QrisCandidateAudit[],
    paymentIdsForSingleCandidate?: number[],
    override?: { manualOverride: boolean; overrideReason: string },
  ) => {
    const eligibleCandidates = candidates.filter((candidate) =>
      candidate.id != null
      && ["MATCHED", "REVIEW"].includes(String(candidate.reconciliation_status ?? "").toUpperCase())
      && candidate.status !== "approved"
      && candidate.current_evidence_valid !== false
      && getUnconfirmedQrisPaymentIds(candidate).length === 0
      && getAvailableQrisPaymentIds(candidate).length > 0
    );
    if (eligibleCandidates.length === 0) {
      toast({
        title: "Tidak ada kandidat QRIS yang dapat disetujui",
        description: "Kandidat harus MATCHED/REVIEW dan seluruh payment harus sudah confirmed.",
        variant: "destructive",
      });
      return;
    }

    const invalidCompany = eligibleCandidates.find((candidate) => {
      const companyId = Number(candidate.company_id ?? null);
      return !Number.isInteger(companyId) || companyId <= 0;
    });
    if (invalidCompany) {
      toast({
        title: "Company context tidak tersedia",
        description: "Salah satu kandidat QRIS tidak memiliki company yang valid.",
        variant: "destructive",
      });
      return;
    }

    const selections = eligibleCandidates.map((candidate) => ({
      candidate,
      paymentIds: candidate.id === eligibleCandidates[0]?.id && paymentIdsForSingleCandidate?.length
        ? paymentIdsForSingleCandidate
        : selectedPaymentIdsForCandidate(candidate).length > 0
          ? selectedPaymentIdsForCandidate(candidate)
          : getAvailableQrisPaymentIds(candidate),
    }));
    setQrisBatchConfirm({ selections, ...override });
  };

  const handleApproveSelectedQris = () => {
    const hasReview = selectedQrisCandidates.some(
      (candidate) => String(candidate.reconciliation_status ?? "").toUpperCase() === "REVIEW",
    );
    if (!hasReview) {
      openQrisBatchApprovalConfirmation(selectedQrisCandidates);
      return;
    }
    const confirmed = window.confirm(
      "Pilihan berisi kandidat REVIEW. Lanjutkan seluruh batch sebagai override manual?\n\n" +
      "Keputusan ini akan dicatat di audit dan payment tetap melalui validasi keamanan.",
    );
    if (!confirmed) return;
    const overrideReason = window.prompt(
      "Alasan override manual (wajib untuk audit):",
      "Reviewer mengonfirmasi settlement QRIS sesuai dengan mutasi bank.",
    )?.trim();
    if (!overrideReason) {
      toast({
        title: "Override dibatalkan",
        description: "Alasan override wajib diisi agar keputusan dapat diaudit.",
        variant: "destructive",
      });
      return;
    }
    openQrisBatchApprovalConfirmation(selectedQrisCandidates, undefined, {
      manualOverride: true,
      overrideReason,
    });
  };

  const handleConfirmQrisBatch = async () => {
    if (!qrisBatchConfirm) return;
    const selections = qrisBatchConfirm.selections;
    setQrisBatchConfirm(null);
    toast({
      title: "Approval QRIS sedang diproses...",
      description: "Pembuatan settlement dan pencocokan mutasi sedang berjalan.",
    });
    const selectedCandidateIdsAtStart = [...selectedQrisCandidateIds];
    const selectedPaymentIdsAtStart = { ...selectedQrisPaymentIds };

    let approvedCount = 0;
    let failedCount = 0;
    let conflictCount = 0;
    let staleCount = 0;
    let firstError = "";
    const conflictedCandidateIds: number[] = [];
    const approvedCandidateIds: number[] = [];
    let latestQrisCandidates: QrisCandidateAudit[] | null = null;

    for (const { candidate, paymentIds } of selections) {
      try {
        await approveQrisBatchMut.mutateAsync({
          candidateId: candidate.id!,
          mutationId: candidate.mutation_id,
          companyId: Number(candidate.company_id),
          paymentIds,
          manualOverride: qrisBatchConfirm.manualOverride,
          overrideReason: qrisBatchConfirm.overrideReason,
          silent: true,
        });
        approvedCount += 1;
        approvedCandidateIds.push(candidate.id!);
      } catch (error) {
        const conflict = error as QrisSelectionConflictError;
        if (conflict.code === "CANONICAL_SETTLEMENT_SELECTION_CONFLICT") {
          conflictCount += 1;
          conflictedCandidateIds.push(candidate.id!);
          if (!firstError) firstError = conflict.message;
          const refreshed = await refetchQrisAudit();
          latestQrisCandidates = refreshed.data?.candidates ?? [];
          const refreshedCandidate = refreshed.data?.candidates.find(
            (item) => item.id === candidate.id,
          );
          const settled = new Set(
            (refreshedCandidate?.settled_payment_ids ?? []).map(Number),
          );
          const eligible = Array.isArray(conflict.eligiblePaymentIds)
            ? new Set(conflict.eligiblePaymentIds.map(Number))
            : null;
          setSelectedQrisPaymentIds((current) => ({
            ...current,
            [candidate.id!]: (current[candidate.id!] ?? []).filter(
              (paymentId) => !settled.has(paymentId)
                && (eligible == null || eligible.has(paymentId)),
            ),
          }));
          continue;
        }
        if (conflict.code === "CANONICAL_CANDIDATE_STALE") {
          staleCount += 1;
          const refreshed = await refetchQrisAudit();
          latestQrisCandidates = refreshed.data?.candidates ?? [];
          continue;
        }
        failedCount += 1;
        if (!firstError) {
          firstError = conflict.message || "Approval QRIS tidak dapat diselesaikan. Muat ulang daftar kandidat dan coba lagi.";
        }
      }
    }

    const needsSelectionReconcile = conflictCount > 0 || staleCount > 0 || failedCount > 0;
    if (!needsSelectionReconcile) {
      setSelectedQrisCandidateIds([]);
      setSelectedQrisPaymentIds({});
    } else {
      const refreshed = latestQrisCandidates == null
        ? await refetchQrisAudit()
        : { data: { candidates: latestQrisCandidates } };
      const refreshedCandidates = refreshed.data?.candidates ?? [];
      const refreshedById = new Map(
        refreshedCandidates
          .filter((candidate) => candidate.id != null)
          .map((candidate) => [candidate.id!, candidate]),
      );
      const preservedCandidateIds = selectedCandidateIdsAtStart.filter((candidateId) => {
        const candidate = refreshedById.get(candidateId);
        return candidate != null && isQrisCandidateEligible(candidate);
      });
      setSelectedQrisCandidateIds(preservedCandidateIds);
      setSelectedQrisPaymentIds(() => {
        const next: Record<number, number[]> = {};
        for (const candidateId of preservedCandidateIds) {
          const candidate = refreshedById.get(candidateId);
          if (!candidate) continue;
          const available = new Set(getAvailableQrisPaymentIds(candidate));
          const configured = selectedPaymentIdsAtStart[candidateId];
          const selection = selections.find((item) => item.candidate.id === candidateId);
          const requested = configured?.length
            ? configured
            : selection?.paymentIds ?? getAvailableQrisPaymentIds(candidate);
          next[candidateId] = requested.filter((paymentId) => available.has(paymentId));
        }
        return next;
      });
    }
    // Refresh once after the whole batch. The mutation hook intentionally
    // skips its per-item refresh when `silent` is set above.
    await Promise.all([refetchQrisAudit(), refetch()]);
    qc.invalidateQueries({ queryKey: ["bank-reconciliation-summary"] });

    if (conflictCount > 0 || staleCount > 0) {
      toast({
        title: "Daftar kandidat QRIS diperbarui",
        description: staleCount > 0
          ? "Data kandidat sudah berubah. Kandidat lama disembunyikan dan daftar terbaru dimuat."
          : firstError || QRIS_SELECTION_CONFLICT_MESSAGE,
        variant: "destructive",
      });
    }
    if (failedCount > 0) {
      toast({
        title: `${approvedCount} approval QRIS berhasil, ${failedCount} gagal`,
        description: firstError || "Approval QRIS tidak dapat diselesaikan.",
        variant: "destructive",
      });
    } else if (!needsSelectionReconcile) {
      toast({
        title: qrisBatchConfirm?.manualOverride
          ? `${approvedCount} settlement QRIS diselesaikan dengan override manual ✓`
          : `${approvedCount} approval QRIS berhasil disetujui ✓`,
      });
    }
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
  const invalidate = async () => {
    await Promise.all([
      qc.invalidateQueries({ queryKey: ["bank-reconciliation"] }),
      qc.invalidateQueries({ queryKey: ["bank-reconciliation-summary"] }),
      qc.invalidateQueries({ queryKey: ["qris-candidate-audit"] }),
      qc.invalidateQueries({ queryKey: ["coa-proposals-by-source"] }),
    ]);
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
    onSuccess: (d) => {
      setWorkflowStage("matching");
      toast({ title: `Import selesai: ${d.imported} baris, ${d.duplicates} duplikat` });
      invalidate();
    },
    onError: (e: Error) => toast({ title: "Gagal import", description: e.message, variant: "destructive" }),
  });

  const matchMut = useMutation({
    mutationFn: async (mode: "new" | "retry_unmatched" | "rematch_non_final" = "new") => {
      const r = await fetch("/api/bank-reconciliation/run-matching", {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ matching_mode: mode }),
      });
      if (!r.ok) throw new Error(await r.text());
      return r.json();
    },
    onSuccess: async (d) => {
      setWorkflowStage("matching");
      setMatchingBackgroundPending(Boolean(d.queued));
      toast({
        title: d.queued
          ? "AI Matching sedang berjalan di background"
          : `AI Matching selesai: ${d.processed} mutasi diproses`,
        description: d.queued
          ? "Tunggu sampai proses selesai, lalu buat kandidat QRIS secara terpisah."
          : "Tahap berikutnya adalah membuat kandidat QRIS secara eksplisit.",
      });
      invalidate();
      try {
        if (d.queued) await waitForMatchingCompletion();
        setWorkflowStage("candidates");
        toast({ title: "AI Matching selesai", description: "Sekarang Anda dapat membuat kandidat QRIS." });
        invalidate();
      } catch (e) {
        toast({
          title: "Gagal memantau matching",
          description: e instanceof Error ? e.message : String(e),
          variant: "destructive",
        });
      } finally {
        setMatchingBackgroundPending(false);
      }
    },
    onError: (e: Error) => toast({ title: "Gagal matching", description: e.message, variant: "destructive" }),
  });

  const retryMatchingMut = useMutation({
    mutationFn: async (mutationId: number) => {
      const r = await fetch("/api/bank-reconciliation/run-matching", {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ids: [mutationId],
          matching_mode: "rematch_non_final",
        }),
      });
      if (!r.ok) throw new Error(await r.text());
      return r.json() as Promise<{
        processed: number;
        auto_matched: number;
        manual_review: number;
        unmatched: number;
      }>;
    },
    onSuccess: async (result, mutationId) => {
      await invalidate();
      await refreshMutationDetail(mutationId);
      if (result.auto_matched > 0) {
        toast({
          title: "Recon ulang berhasil",
          description: "Rule AI berhasil membuat dan mem-posting jurnal setelah seluruh safeguard lulus.",
        });
      } else if (result.manual_review > 0) {
        toast({
          title: "Recon ulang selesai",
          description: "Rule AI tetap cocok, tetapi safeguard jurnal masih menahan transaksi untuk review manual.",
          variant: "destructive",
        });
      } else {
        toast({
          title: "Recon ulang selesai",
          description: "Mutasi tidak berubah. Periksa kembali rule AI dan konfigurasi accounting.",
          variant: "destructive",
        });
      }
    },
    onError: (e: Error) => toast({
      title: "Gagal recon ulang",
      description: e.message,
      variant: "destructive",
    }),
  });

  const retryReferenceCoaMut = useMutation({
    mutationFn: async (mutationId: number) => {
      const r = await fetch("/api/bank-reconciliation/run-matching", {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ids: [mutationId],
          legacy_reference_coa_retry: true,
        }),
      });
      if (!r.ok) throw new Error(await r.text());
      return r.json() as Promise<{
        processed: number;
        auto_matched: number;
        manual_review: number;
      }>;
    },
    onSuccess: async (result, mutationId) => {
      await invalidate();
      await refreshMutationDetail(mutationId);
      if (result.auto_matched > 0) {
        toast({
          title: "Referensi COA berhasil diproses",
          description: "Jurnal dibuat otomatis setelah seluruh safeguard lulus.",
        });
      } else if (result.manual_review > 0) {
        toast({
          title: "Masih perlu review manual",
          description: "Safeguard jurnal menahan transaksi. Alasan terbaru sudah ditampilkan.",
          variant: "destructive",
        });
      } else {
        toast({
          title: "Tidak dapat diproses ulang",
          description: "Transaksi ini bukan kasus Referensi COA legacy yang dapat dicoba ulang.",
          variant: "destructive",
        });
      }
    },
    onError: (e: Error) => toast({
      title: "Gagal memproses ulang Referensi COA",
      description: e.message,
      variant: "destructive",
    }),
  });

  const approveQrisBatchMut = useMutation({
    mutationFn: async ({
      candidateId,
      mutationId,
      companyId,
      paymentIds,
      manualOverride,
      overrideReason,
    }: {
      candidateId: number;
      mutationId: number;
      companyId: number;
      paymentIds?: number[];
      manualOverride?: boolean;
      overrideReason?: string;
      silent?: boolean;
    }) => {
      const controller = new AbortController();
      const timeoutId = window.setTimeout(() => controller.abort(), 120_000);
      let r: Response;
      try {
        r = await fetch(`/api/bank-reconciliation/qris-candidates/${candidateId}/approve`, {
          method: "POST",
          credentials: "include",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            mutationId,
            companyId,
            paymentIds,
            manual_override: manualOverride === true,
            override_reason: overrideReason,
          }),
          signal: controller.signal,
        });
      } catch (error) {
        if (error instanceof DOMException && error.name === "AbortError") {
          throw Object.assign(
            new Error("Approval QRIS terlalu lama diproses. Periksa status kandidat setelah memuat ulang."),
            { code: "QRIS_APPROVAL_TIMEOUT" },
          ) as QrisSelectionConflictError;
        }
        throw error;
      } finally {
        window.clearTimeout(timeoutId);
      }
      const body = await r.json().catch(() => ({ error: "Unknown error" }));
      if (!r.ok) {
        if (body.code === "CANONICAL_SETTLEMENT_SELECTION_CONFLICT") {
          throw Object.assign(
            new Error(
              typeof body.error === "string" && body.error.trim()
                ? body.error
                : QRIS_SELECTION_CONFLICT_MESSAGE,
            ),
            {
              code: body.code,
              alreadySettledPaymentIds: body.already_settled_payment_ids,
              conflictingPaymentIds: body.conflicting_payment_ids,
              eligiblePaymentIds: body.eligible_payment_ids,
            },
          ) as QrisSelectionConflictError;
        }
        if (body.code === "CANONICAL_CANDIDATE_STALE") {
          throw Object.assign(
            new Error("Data kandidat sudah berubah. Daftar kandidat telah diperbarui."),
            {
              code: body.code,
              staleCandidateId: body.stale_candidate_id,
              currentPaymentIds: body.current_payment_ids,
              currentExpectedAmount: body.current_expected_amount,
            },
          ) as QrisSelectionConflictError;
        }
        throw Object.assign(
          new Error(
            typeof body.error === "string" && body.error.trim()
              ? body.error
              : "Approval QRIS tidak dapat diselesaikan. Coba lagi setelah memuat ulang kandidat.",
          ),
          { code: body.code },
        ) as QrisSelectionConflictError;
      }
      return body as {
        mutationId: number;
        itemCount?: number;
        partial?: boolean;
        remainingItemCount?: number;
        matching?: { status?: string } | null;
      };
    },
    onSuccess: async (result, variables) => {
      // A batch approval owns the refresh lifecycle. Refetching here for
      // every candidate makes a multi-candidate approval perform redundant
      // network round-trips while the next approval is waiting.
      if (variables.silent) return;

      if (!variables.silent) {
        toast({
          title: result.matching?.status === "auto_matched" || result.matching?.status === "manual_review"
            ? result.partial
              ? `QRIS ${result.itemCount ?? 0} payment disetujui — ${result.remainingItemCount ?? 0} tersisa ✓`
              : "Batch QRIS disetujui — mutasi sudah di-matching ✓"
            : result.partial
              ? `QRIS ${result.itemCount ?? 0} payment disetujui — ${result.remainingItemCount ?? 0} tersisa ✓`
              : "Batch QRIS disetujui ✓",
        });
      }
      // Refresh both datasets: the QRIS candidate status and the primary
      // bank-mutation card are maintained by different queries.
      await Promise.all([refetchQrisAudit(), refetch()]);
      if (detailMutation?.id === result.mutationId) {
        await refreshMutationDetail(result.mutationId);
      }
      qc.invalidateQueries({ queryKey: ["bank-reconciliation-summary"] });
    },
    onError: (e: Error, variables) => {
      if (!variables?.silent && (e as QrisSelectionConflictError).code !== "CANONICAL_SETTLEMENT_SELECTION_CONFLICT") {
        toast({
          title: "Gagal approve batch QRIS",
          description: e.message || "Approval QRIS tidak dapat diselesaikan. Periksa konfigurasi lalu coba lagi.",
          variant: "destructive",
        });
      }
      // Keep the screen aligned with the server even when approval is rejected
      // by a governance/configuration guard (for example, a missing bank COA).
      // The mutation must remain visible in that case, but its latest status
      // and eligibility should not depend on a hard browser reload.
      void Promise.all([refetchQrisAudit(), refetch()]);
      qc.invalidateQueries({ queryKey: ["bank-reconciliation-summary"] });
    },
  });

  const recoverQrisSettlementMut = useMutation({
    mutationFn: async ({
      mutationId,
      settlementId,
      reason,
    }: {
      mutationId: number;
      settlementId: number;
      reason: string;
    }) => {
      const response = await fetch(
        `/api/bank-reconciliation/${mutationId}/link-historical-settlement`,
        {
          method: "POST",
          credentials: "include",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            settlement_id: settlementId,
            confirm_historical_repair: true,
            reason,
          }),
        },
      );
      const body = await response.json().catch(() => null);
      if (!response.ok) {
        throw new Error(body?.error ?? "Settlement canonical gagal ditautkan.");
      }
      return body as {
        mutation_id?: number;
        candidate_id?: number;
        settlement_status?: string;
        bank_mutation_status?: string;
      };
    },
    onSuccess: async () => {
      toast({
        title: "Settlement canonical selesai ditautkan",
        description: "Batch posted sudah direkonsiliasi dan mutasi dipindahkan ke Selesai.",
      });
      await Promise.all([refetchQrisAudit(), refetch()]);
      qc.invalidateQueries({ queryKey: ["bank-reconciliation-summary"] });
      qc.invalidateQueries({ queryKey: ["bank-reconciliation"] });
    },
    onError: (error: Error) => {
      toast({
        title: "Gagal menyelesaikan settlement",
        description: error.message,
        variant: "destructive",
      });
      void Promise.all([refetchQrisAudit(), refetch()]);
      qc.invalidateQueries({ queryKey: ["bank-reconciliation-summary"] });
    },
  });

  const sheetSyncMut = useMutation({
    mutationFn: async () => {
      const r = await fetch("/api/bank-reconciliation/sheet-sync", { method: "POST", credentials: "include" });
      if (!r.ok) throw new Error(await r.text());
      return r.json();
    },
    onSuccess: (d) => {
      setWorkflowStage("matching");
      toast({ title: d.message ?? "Sync dari Google Sheet selesai" });
      invalidate();
    },
    onError: (e: Error) => toast({ title: "Sync gagal", description: e.message, variant: "destructive" }),
  });

  // Approve → POST /:id/approve → legacy becomes approved_pending_posting;
  // canonical settlement becomes terminal approved/reconciled.
  const approveMut = useMutation({
    mutationFn: async ({
      mutId, matchId, candidateType, candidateId, candidateSource, manualCoaCode,
      manualOverride, overrideReason,
    }: {
      mutId: number;
      matchId?: number;
      candidateType?: string;
      candidateId?: number;
      candidateSource?: string | null;
      manualCoaCode?: string;
      manualOverride?: boolean;
      overrideReason?: string;
    }) => {
      const r = await fetch(`/api/bank-reconciliation/${mutId}/approve`, {
        method: "POST", credentials: "include", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          match_id: matchId,
          candidate_type: candidateType,
          candidate_id: candidateId,
          candidate_source: candidateSource ?? null,
          manual_coa_code: manualCoaCode,
          manual_override: manualOverride === true,
          override_reason: overrideReason,
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
          ? d?.manual_override
            ? "Settlement diselesaikan dengan override manual ✓"
            : "Settlement disetujui dan direconcile ✓"
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

  const handleRecoverQrisSettlement = (mutationId: number, settlementId: number) => {
    const confirmed = window.confirm(
      "Settlement canonical sudah posted dan payment-nya sudah diproses. " +
      "Tautkan batch ini ke mutasi bank sekarang?",
    );
    if (!confirmed) return;

    const reason = window.prompt(
      "Alasan historical repair (minimal 10 karakter):",
      "Batch canonical posted identik dengan match lama; menyelesaikan link mutasi bank.",
    )?.trim();
    if (!reason || reason.length < 10) {
      toast({
        title: "Recovery dibatalkan",
        description: "Alasan historical repair minimal 10 karakter wajib diisi.",
        variant: "destructive",
      });
      return;
    }

    recoverQrisSettlementMut.mutate({ mutationId, settlementId, reason });
  };

  const handleConfirmApprove = () => {
    if (!actionDialog) return;
    const m      = actionDialog.mutation;
    // Use the same same-day candidate set rendered by the dialog. The raw
    // mutation payload can still contain a historical H+1 candidate from a
    // previous matching run, which must never be approved accidentally.
    const chosen = approveDialogCands.find(c => c.id === selectedCandidateId);
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

  const toggleCandidate = (mutationId: number, candidateId: number, checked: boolean) => {
    setSelectedCandidateByMutation(current => ({
      ...current,
      [mutationId]: checked ? candidateId : null,
    }));
  };

  const handleDirectApproveCandidate = (m: BankMutation, candidate: Candidate) => {
    approveMut.mutate({
      mutId: m.id,
      matchId: candidate.id,
      candidateType: candidate.candidate_type,
      candidateId: candidate.candidate_id,
      candidateSource: candidate.candidate_source ?? null,
    });
  };

  const handleManualOverrideCandidate = (m: BankMutation, candidate: Candidate) => {
    const settlementReference =
      candidate.details?.settlementReference
      ?? `Settlement #${candidate.candidate_id}`;
    const confirmed = window.confirm(
      `Selesaikan ${settlementReference} secara manual?\n\n` +
      "Pemeriksaan nominal/tanggal/provider akan dilewati. " +
      "Settlement yang sudah posted akan ditautkan ke mutasi ini dan dicatat sebagai override manual.",
    );
    if (!confirmed) return;

    const overrideReason = window.prompt(
      "Alasan override manual (opsional):",
      "Reviewer mengonfirmasi settlement ini sesuai dengan mutasi bank.",
    )?.trim() || "Reviewer mengonfirmasi settlement secara manual.";

    approveMut.mutate({
      mutId: m.id,
      matchId: candidate.id,
      candidateType: candidate.candidate_type,
      candidateId: candidate.candidate_id,
      candidateSource: candidate.candidate_source ?? null,
      manualOverride: true,
      overrideReason,
    });
  };

  const handleApproveAllMatched = () => { setFilterStatus("matched"); setPage(0); };
  const handlePostAllPending    = () => { setFilterStatus("approved_pending_posting"); setPage(0); };

  const resetFilters = () => {
    setFilterStatus("all"); setFilterDir("all"); setFilterProvider("all"); setFilterPaymentType("all");
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

  const approveDialogCands    = actionDialog ? visibleCandidates(actionDialog.mutation) : [];
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
        <StepProgressBar summaryMap={summaryMap} workflowStage={workflowStage} />

        {/* ── AI Action Center ──────────────────────────────── */}
        <AIActionCenter
          summaryMap={summaryMap}
           onRunMatching={(mode = "new") => {
            if (workflowStage !== "matching") {
              toast({ title: "Sync mutasi bank terlebih dahulu", description: "Urutan aman dimulai dari sync mutasi bank." });
              return;
            }
             matchMut.mutate(mode);
          }}
           onGenerateQrisCandidates={qrisCompanyId != null ? () => qrisDryRunMut.mutate(undefined) : undefined}
          onApproveAll={handleApproveAllMatched}
          onPostAll={handlePostAllPending}
          onSyncSheet={() => sheetSyncMut.mutate()}
          matchingPending={matchMut.isPending}
          matchingBackgroundPending={matchingBackgroundPending}
          qrisGenerationPending={qrisDryRunMut.isPending}
          syncPending={sheetSyncMut.isPending}
          workflowStage={workflowStage}
        />

        {/* ── Summary Cards ─────────────────────────────────── */}
        <SummaryCards summaryMap={summaryMap} activeFilter={filterStatus} onFilter={v => { setFilterStatus(v); setPage(0); }} />

        {/* QRIS candidates are shown directly inside each bank mutation card.
            Keep the legacy audit block unreachable while the endpoint contract
            remains available for the batch selection toolbar below. */}
        {false && (
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
                 onClick={() => qrisDryRunMut.mutate(undefined)}
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
              <div className="rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800 dark:border-amber-800 dark:bg-amber-950 dark:text-amber-200">
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
                 <div className="grid grid-cols-3 gap-2">
                  {(["MATCHED", "REVIEW", "UNMATCHED"] as const).map((status) => {
                    const count = qrisAuditData?.candidates.filter(c => c.reconciliation_status === status).length ?? 0;
                    return (
                       <div key={status} className={`rounded-lg border px-2.5 py-2 ${
                        status === "MATCHED"
                            ? "border-green-300 bg-green-50 text-green-800 dark:border-green-800 dark:bg-green-950 dark:text-green-300"
                          : status === "REVIEW"
                             ? "border-amber-300 bg-amber-50 text-amber-800 dark:border-amber-800 dark:bg-amber-950 dark:text-amber-300"
                             : "border-slate-300 bg-slate-50 text-slate-700 dark:border-slate-700 dark:bg-slate-900/40 dark:text-slate-300"
                       }`}>
                         <p className="text-[11px] font-medium leading-tight">{QRIS_AUDIT_STATUS_LABELS[status]}</p>
                         <p className="mt-1 text-xl font-bold tabular-nums">{count}</p>
                       </div>
                    );
                  })}
                </div>
                  <Button variant="outline" size="sm" className="w-full gap-1.5 text-xs" onClick={() => setShowQrisAuditList(value => !value)}>
                   <Eye className="h-3.5 w-3.5" />
                   {showQrisAuditList ? "Sembunyikan Pemeriksaan" : "Lihat Semua Pemeriksaan"}
                 </Button>
                  {showQrisAuditList && qrisApprovableCandidates.length > 0 && (
                    <div className="flex flex-col gap-2 rounded-md border border-indigo-200 bg-indigo-50/60 px-3 py-2.5 text-xs dark:border-indigo-800 dark:bg-indigo-950 sm:flex-row sm:items-center sm:justify-between">
                      <label className="flex min-w-0 cursor-pointer items-center gap-2">
                        <Checkbox
                          checked={
                            allQrisCandidatesSelected
                              ? true
                              : selectedQrisCandidates.length > 0
                                ? "indeterminate"
                                : false
                          }
                          onCheckedChange={(checked) => toggleAllQrisCandidates(checked === true)}
                          aria-label="Pilih semua kandidat QRIS yang cocok"
                        />
                        <span className="font-medium text-indigo-950 dark:text-indigo-100">
                          Pilih semua batch yang cocok ({qrisApprovableCandidates.length})
                        </span>
                      </label>
                      <Button
                        size="sm"
                        className="h-8 gap-1.5 bg-indigo-600 text-xs text-white hover:bg-indigo-700"
                        disabled={selectedQrisCandidates.length === 0 || approveQrisBatchMut.isPending}
                        onClick={handleApproveSelectedQris}
                      >
                        {approveQrisBatchMut.isPending
                          ? <Loader2 className="h-3 w-3 animate-spin" />
                          : <CheckCircle2 className="h-3 w-3" />}
                        Setujui yang dipilih ({selectedQrisCandidates.length})
                      </Button>
                    </div>
                  )}
                 {showQrisAuditList && <div className="divide-y rounded-md border text-xs">
                   {qrisCandidates.map((candidate) => {
                    const isApproved = candidate.status === "approved";
                     const isMatched = String(candidate.reconciliation_status ?? "").toUpperCase() === "MATCHED";
                      const isSelectable = isQrisCandidateEligible(candidate);
                     const isSelected = candidate.id != null && selectedQrisCandidateIds.includes(candidate.id);
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
                                <Badge variant="outline" className="border-amber-300 bg-amber-50 text-amber-800 dark:border-amber-800 dark:bg-amber-950 dark:text-amber-300">
                                  {QRIS_AUDIT_STATUS_LABELS[candidate.reconciliation_status] ?? candidate.reconciliation_status}
                                </Badge>
                              )}
                              <span className="text-slate-600 dark:text-slate-400">Mutasi #{candidate.mutation_id}</span>
                            </div>
                            <p className="mt-1 truncate max-w-[400px] font-medium text-slate-900 dark:text-slate-100">
                              {candidate.review_reason ?? candidate.description ?? "Belum ada alasan tambahan."}
                            </p>
                            <p className="text-slate-600 dark:text-slate-400 mt-0.5">
                               Settlement {candidate.estimated_settlement_date ? fmtDate(candidate.estimated_settlement_date) : "belum tersedia"} · {getAvailableQrisPaymentIds(candidate).length} payment · Netto {idr(candidate.current_expected_amount ?? candidate.net_amount)}
                            </p>
                             {(candidate.payment_items?.length ?? 0) > 0 && (
                               <div className="mt-2 rounded border bg-slate-50/80 px-2 py-1.5 text-[10px] dark:bg-slate-900/60">
                                <p className="mb-1 font-semibold uppercase tracking-wide text-slate-500">
                                  Detail booking/payment
                                  {(candidate.payment_items?.length ?? 0) > 1
                                    ? ` · Satu settlement group (${candidate.payment_items!.length} booking/payment)`
                                    : ""}
                                </p>
                                <div className="grid gap-1.5">
                                   {candidate.payment_items!.map((item, index) => {
                                     const paymentNumber = item.payment_number ?? item.paymentNumber;
                                     const bookingNumber = item.booking_number ?? item.bookingNumber;
                                     const paymentId = item.payment_id ?? item.paymentId;
                                     const grossAmount = item.gross_amount ?? item.grossAmount;
                                    const customer = item.customer_name ?? item.customerName;
                                    const facility = item.facility_name ?? item.facilityName;
                                     const paymentDate = qrisPaymentDateValue(item);
                                      const paymentDateIso = paymentDate ? String(paymentDate).slice(0, 10) : "";
                                      const canEditPaymentDate = Number.isInteger(Number(paymentId)) && Number(paymentId) > 0;
                                     return (
                                      <div key={`${candidate.id}-${paymentId ?? index}`} className="rounded border border-slate-200/80 bg-white/70 px-2 py-1.5 dark:border-slate-700 dark:bg-slate-950/30">
                                        <div className="flex min-w-0 items-center justify-between gap-2">
                                          <span className="min-w-0 truncate font-semibold text-slate-700 dark:text-slate-300">
                                            {bookingNumber || `Booking SC-${String(item.booking_id ?? "—").padStart(4, "0")}`}
                                          </span>
                                          <span className="shrink-0 font-medium text-slate-800 dark:text-slate-200">
                                            {idr(grossAmount ?? 0)}
                                          </span>
                                        </div>
                                        <div className="mt-0.5 grid gap-x-3 gap-y-0.5 text-[10px] text-slate-500 dark:text-slate-400 sm:grid-cols-2">
                                          <span>Customer: {customer || "—"}</span>
                                          <span>Fasilitas: {facility || "—"}</span>
                                           <span className="flex items-center gap-1">
                                             <span>Payment: {paymentDate ? fmtDate(paymentDateIso) : "—"}</span>
                                             {canEditPaymentDate && (
                                               <button
                                                 type="button"
                                                 className="inline-flex items-center rounded p-0.5 text-indigo-600 hover:bg-indigo-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 dark:text-indigo-300 dark:hover:bg-indigo-950"
                                                 aria-label={`Edit tanggal payment ${paymentNumber || paymentId}`}
                                                 title="Edit tanggal payment"
                                                 onClick={(event) => {
                                                   event.stopPropagation();
                                                   setQrisDateTarget({
                                                     paymentId: Number(paymentId),
                                                     paymentNumber: paymentNumber || `SCPAY-SC-${paymentId}`,
                                                     paymentDate: paymentDateIso,
                                                   });
                                                   setQrisPaymentDate(paymentDateIso);
                                                 }}
                                               >
                                                 <Pencil className="h-3 w-3" />
                                               </button>
                                             )}
                                           </span>
                                          <span className="sm:col-span-2">No. Payment: {paymentNumber || `SCPAY-SC-${paymentId ?? "—"}`}</span>
                                        </div>
                                       </div>
                                     );
                                   })}
                                 </div>
                               </div>
                             )}
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
                           <div className="flex shrink-0 items-start gap-3 text-right">
                              <div className="space-y-1">
                                <p className="font-semibold text-slate-950 dark:text-white">{idr(candidate.current_gross_amount ?? candidate.gross_amount)}</p>
                               <p className="text-slate-500 dark:text-slate-400">
                                  MDR {idr(Number(candidate.current_gross_amount ?? candidate.gross_amount) - Number(candidate.current_expected_amount ?? candidate.net_amount))}
                                 {candidate.effective_deduction_rate != null
                                   ? ` (${(Number(candidate.effective_deduction_rate) * 100).toFixed(2)}%)`
                                   : ""}
                               </p>
                             </div>
                             {isSelectable && (
                               <Checkbox
                                 checked={isSelected}
                                 onCheckedChange={(checked) => toggleQrisCandidate(candidate.id!, checked === true)}
                                 aria-label={`Pilih batch QRIS mutasi ${candidate.mutation_id}`}
                                 className="mt-0.5"
                               />
                             )}
                            {!isApproved && candidate.id != null && (() => {
                               const isReviewStatus = String(candidate.reconciliation_status ?? "").toUpperCase() === "REVIEW";
                               const canApprove = isQrisCandidateEligible(candidate);
                              if (!canApprove) return (
                                <span
                                  title={`Status ${candidate.reconciliation_status}: jalankan AI Matching terlebih dahulu`}
                                  className="text-[10px] text-slate-500 dark:text-slate-400 flex items-center gap-0.5 cursor-help"
                                >
                                  <AlertTriangle className="w-3 h-3 shrink-0" />
                                  Belum bisa
                                </span>
                              );
                              return (
                                <Button
                                  size="sm"
                                  variant="outline"
                                  className={isMatched
                                    ? "h-7 text-[11px] gap-1 border-indigo-400 text-indigo-700 hover:bg-indigo-50 dark:border-indigo-700 dark:text-indigo-300"
                                    : "h-7 text-[11px] gap-1 border-amber-400 text-amber-800 hover:bg-amber-50 dark:border-amber-700 dark:text-amber-300"}
                                  disabled={isApprovingThis || approveQrisBatchMut.isPending}
                                  onClick={() => handleApproveQrisBatch(candidate.id!, candidate.mutation_id, candidate)}
                                >
                                  {isApprovingThis
                                    ? <><Loader2 className="w-3 h-3 animate-spin" /> Menyetujui...</>
                                    : isMatched
                                      ? <><CheckCircle2 className="w-3 h-3" /> Setujui Batch</>
                                     : <><AlertTriangle className="w-3 h-3" /> Tidak dapat disetujui</>}
                                </Button>
                              );
                             })()}
                           </div>
                        </div>
                      </div>
                    );
                   })}
                 </div>}
              </div>
            )}
          </CardContent>
        </Card>
        )}

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
                  <Select value={filterPaymentType} onValueChange={v => { setFilterPaymentType(v as "all" | SportPaymentType); setPage(0); }}>
                    <SelectTrigger className="w-[165px] h-8 text-xs"><SelectValue placeholder="Jenis payment" /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="all">Semua Jenis Payment</SelectItem>
                      <SelectItem value="bank_transfer">Transfer Bank</SelectItem>
                      <SelectItem value="qris">QRIS</SelectItem>
                      <SelectItem value="paylabs">Paylabs</SelectItem>
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
          {selectedQrisCandidates.length > 0 && (
            <div className="mb-3 flex flex-wrap items-center justify-between gap-2 rounded-md border border-indigo-200 bg-indigo-50/70 px-3 py-2.5 text-xs dark:border-indigo-800 dark:bg-indigo-950">
              <p className="font-medium text-indigo-950 dark:text-indigo-100">
                {selectedQrisCandidates.length} batch QRIS dipilih
              </p>
              <Button
                size="sm"
                className="h-8 gap-1.5 bg-indigo-600 text-xs text-white hover:bg-indigo-700"
                disabled={approveQrisBatchMut.isPending}
                onClick={handleApproveSelectedQris}
              >
                <CheckCircle2 className="h-3.5 w-3.5" />
                Setujui Batch Terpilih ({selectedQrisCandidates.length})
              </Button>
            </div>
          )}

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
                     {filterStatus !== "all" || filterDir !== "all" || filterPaymentType !== "all" || filterSearch
                      ? "Coba ubah filter atau reset pencarian"
                      : "Import mutasi bank atau sync Google Sheet untuk memulai"}
                  </p>
                </div>
                {(filterStatus !== "all" || filterDir !== "all" || filterPaymentType !== "all" || filterSearch) && (
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
                  onMapCoa={setCoaReferenceTarget}
                  onRetryReferenceCoa={mutation => retryReferenceCoaMut.mutate(mutation.id)}
                  onApprove={handleOpenApprove}
                  onPost={handleOpenPost}
                  onReject={handleOpenReject}
                  onReverse={handleOpenReverse}
                  onReopen={handleOpenReopen}
                  onDelete={id => deleteMut.mutate(id)}
                  onDetail={setDetailMutation}
                  onEditQrisPaymentDate={(target) => {
                    setQrisDateTarget(target);
                    setQrisPaymentDate(target.paymentDate);
                  }}
                  onApproveQris={handleApproveQris}
                  onApproveQrisBatch={handleApproveQrisBatch}
                  onRecoverQrisSettlement={handleRecoverQrisSettlement}
                  recoverQrisPending={recoverQrisSettlementMut.isPending}
                  onManualOverrideCandidate={handleManualOverrideCandidate}
                  selectedCandidateId={selectedCandidateByMutation[m.id] ?? null}
                  onToggleCandidate={toggleCandidate}
                  onApproveCandidate={handleDirectApproveCandidate}
                  approveQrisPending={approveQrisBatchMut.isPending}
                  selectedQrisPaymentIds={selectedPaymentIdsByMutation(m)}
                  onToggleQrisPayment={toggleQrisPayment}
                  onToggleAllQrisPayments={toggleAllQrisPayments}
                  onRetryMatching={mutation => retryMatchingMut.mutate(mutation.id)}
                  retryMatchingPending={retryMatchingMut.isPending}
                  onRunMatching={(mode = "new") => {
                      if (workflowStage !== "matching") {
                        toast({ title: "Sync mutasi bank terlebih dahulu", description: "Urutan aman dimulai dari sync mutasi bank." });
                        return;
                      }
                       matchMut.mutate(mode);
                    }}
          onGenerateQrisCandidates={qrisCompanyId != null && workflowStage !== "matching"
                       ? (mutationId) => qrisDryRunMut.mutate(mutationId)
                      : undefined}
                   qrisGenerationPending={qrisDryRunMut.isPending}
                  retryReferenceCoaPending={retryReferenceCoaMut.isPending}
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

      <Dialog
        open={qrisDateTarget != null}
        onOpenChange={(open) => {
          if (!open && !qrisPaymentDateMut.isPending) setQrisDateTarget(null);
        }}
      >
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Edit tanggal payment Sport Center</DialogTitle>
            <DialogDescription>
              Perubahan disimpan ke sumber canonical Sport Center. Settlement QRIS akan dihitung ulang sebagai H+1.
            </DialogDescription>
          </DialogHeader>
          {qrisDateTarget && (
            <div className="space-y-4">
              <div className="rounded-md bg-muted/40 px-3 py-2 text-sm">
                <p className="font-medium">{qrisDateTarget.paymentNumber}</p>
                <p className="text-xs text-muted-foreground">
                  Mirror publik dan data akunting yang masih mutable akan ikut disinkronkan.
                </p>
              </div>
              <div className="space-y-2">
                <label htmlFor="qris-payment-date" className="text-sm font-medium">
                  Tanggal pembayaran
                </label>
                <Input
                  id="qris-payment-date"
                  type="date"
                  value={qrisPaymentDate}
                  onChange={(event) => setQrisPaymentDate(event.target.value)}
                  disabled={qrisPaymentDateMut.isPending}
                />
              </div>
              <p className="text-xs text-muted-foreground">
                Jika jurnal sudah posted, tanggal jurnal tidak diubah langsung. Sistem akan menandai payment untuk workflow reversal/correction.
              </p>
            </div>
          )}
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => setQrisDateTarget(null)}
              disabled={qrisPaymentDateMut.isPending}
            >
              Batal
            </Button>
            <Button
              className="gap-1.5"
              onClick={() => {
                if (qrisDateTarget && qrisPaymentDate) {
                  qrisPaymentDateMut.mutate({
                    paymentId: qrisDateTarget.paymentId,
                    paymentDate: qrisPaymentDate,
                  });
                }
              }}
              disabled={
                !qrisDateTarget
                || !/^\d{4}-\d{2}-\d{2}$/.test(qrisPaymentDate)
                || qrisPaymentDateMut.isPending
              }
            >
              {qrisPaymentDateMut.isPending && <Loader2 className="h-4 w-4 animate-spin" />}
              {qrisPaymentDateMut.isPending ? "Menyimpan..." : "Simpan tanggal"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <CoaReferenceDialog
        mutation={coaReferenceTarget}
        open={!!coaReferenceTarget}
        activeCompanyId={qrisCompanyId}
        onClose={() => setCoaReferenceTarget(null)}
        onSaved={invalidate}
      />

      {/* ── Detail Side Panel ─────────────────────────────────── */}
      <MutationDetailPanel
        mutation={detailMutation}
        open={!!detailMutation}
        onClose={() => setDetailMutation(null)}
        onMapCoa={setCoaReferenceTarget}
        onApprove={handleOpenApprove}
        onPost={handleOpenPost}
        onReject={handleOpenReject}
        onReverse={handleOpenReverse}
        onReopen={handleOpenReopen}
        onApproveQris={handleApproveQris}
        onApproveCandidate={handleDirectApproveCandidate}
        onGenerateQrisCandidates={qrisCompanyId != null && workflowStage !== "matching"
          ? (mutationId) => qrisDryRunMut.mutate(mutationId)
          : undefined}
         onFindMissing={() => {
          if (workflowStage !== "matching") {
            toast({ title: "Sync mutasi bank terlebih dahulu", description: "Urutan aman dimulai dari sync mutasi bank." });
            return;
          }
           matchMut.mutate("retry_unmatched");
        }}
        matchingPending={matchMut.isPending || matchingBackgroundPending}
        mappingError={detailMutation ? mappingRequiredErrors.get(detailMutation.id) : undefined}
        onApproveQrisBatch={handleApproveQrisBatch}
        onManualOverrideCandidate={handleManualOverrideCandidate}
        approveQrisPending={approveQrisBatchMut.isPending}
        selectedQrisPaymentIds={
          detailMutation?.qris_candidate_audit?.id != null
            ? selectedPaymentIdsForCandidate(detailMutation.qris_candidate_audit)
            : []
        }
        onToggleQrisPayment={toggleQrisPayment}
        onToggleAllQrisPayments={toggleAllQrisPayments}
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
                        {c.amount_match   && <span className="text-[10px] text-green-600 bg-green-50 dark:bg-green-950 px-1.5 py-0.5 rounded">✓ Nominal</span>}
                        {c.date_match     && <span className="text-[10px] text-green-600 bg-green-50 dark:bg-green-950 px-1.5 py-0.5 rounded">✓ Tanggal</span>}
                        {c.name_match     && <span className="text-[10px] text-green-600 bg-green-50 dark:bg-green-950 px-1.5 py-0.5 rounded">✓ Nama</span>}
                        {c.order_id_match && <span className="text-[10px] text-green-600 bg-green-50 dark:bg-green-950 px-1.5 py-0.5 rounded">✓ Order ID</span>}
                        {c.proof_match    && <span className="text-[10px] text-green-600 bg-green-50 dark:bg-green-950 px-1.5 py-0.5 rounded">✓ Bukti Transfer</span>}
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
                  companyId={actionDialog.mutation.company_id}
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
                {(() => {
                  const selections = qrisBatchConfirm?.selections ?? [];
                  const candidates = selections.map((selection) => selection.candidate);
                  const reviewCandidates = candidates.filter(
                    (c) => String(c.reconciliation_status ?? "").toUpperCase() === "REVIEW",
                  );
                  const paymentCount = selections.reduce((total, selection) => total + selection.paymentIds.length, 0);
                  const netAmount = selections.reduce((total, selection) => {
                    const selected = new Set(selection.paymentIds);
                    const gross = (selection.candidate.payment_items ?? [])
                      .filter((item) => selected.has(Number(item.paymentId ?? item.payment_id)))
                      .reduce((sum, item) => sum + Number(item.grossAmount ?? item.gross_amount ?? 0), 0);
                    const candidateGross = Number(selection.candidate.gross_amount ?? 0);
                    const candidateNet = Number(selection.candidate.net_amount ?? 0);
                    return total + (candidateGross > 0 ? gross * candidateNet / candidateGross : 0);
                  }, 0);
                  const providers = Array.from(new Set(candidates.map((candidate) => candidate.provider_code).filter(Boolean)));
                  return (
                    <>
                      <p>
                        Anda akan membuat settlement QRIS untuk{" "}
                        <strong>{candidates.length} batch</strong> dengan{" "}
                        <strong>{paymentCount} sport payment</strong>, total netto{" "}
                        <strong>{idr(netAmount)}</strong>, dari provider{" "}
                        <strong>{providers.join(", ") || "belum dikenali"}</strong>.
                      </p>
                      {reviewCandidates.length > 0 && (
                        <div className="rounded border border-amber-300 bg-amber-50 px-3 py-2 text-xs text-amber-900 dark:border-amber-700 dark:bg-amber-950 dark:text-amber-200 space-y-1">
                          <p className="font-semibold flex items-center gap-1">
                            <AlertTriangle className="w-3.5 h-3.5 shrink-0" />
                            Peringatan: {reviewCandidates.length} batch berstatus REVIEW
                          </p>
                          <p>
                            Kandidat REVIEW belum sepenuhnya diverifikasi — provider atau potongan MDR mungkin belum cocok.
                            Approve tetap bisa dilakukan, namun pastikan data payment sudah benar sebelum melanjutkan.
                          </p>
                        </div>
                      )}
                    </>
                  );
                })()}
                <p className="text-orange-700 dark:text-orange-400 font-medium">
                  Tindakan ini membuat settlement untuk payment yang dipilih.
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
              {approveQrisBatchMut.isPending
                ? "Menyetujui..."
                : `Ya, Setujui ${qrisBatchConfirm?.selections.length ?? 0} Approval`}
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

