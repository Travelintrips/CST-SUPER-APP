import { useState, useCallback, useEffect } from "react";
import { AppShell } from "@/components/layout/AppShell";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription } from "@/components/ui/dialog";
import { Separator } from "@/components/ui/separator";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { useToast } from "@/hooks/use-toast";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import {
  CheckCircle2, XCircle, AlertTriangle, ChevronDown, ChevronRight,
  Search, RefreshCw, Info, ArrowLeft, Loader2,
  Tag, Building2, CreditCard, User, Layers, Cpu,
  Shield, MessageSquare, AlertCircle, ListChecks,
  ArrowRightLeft, Link2, FileText, Eye, Pencil,
} from "lucide-react";
import { Link } from "wouter";

// ── Types ──────────────────────────────────────────────────────────────────────

type MutationStatus = "unmatched" | "matched" | "duplicate_need_review" | "approved" | "rejected" | "reconciled";

interface Candidate {
  id: number;
  mutation_id: number;
  candidate_type: string;
  candidate_id: number;
  match_score: number;
  match_reason: string;
  amount_match: boolean;
  date_match: boolean;
  name_match: boolean;
  order_id_match: boolean;
  proof_match: boolean;
  status: string;
}

interface BankMutation {
  id: number;
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
  reconciliation_status: string | null;
  source: string | null;
  company_id: number | null;
  journal_entry_id: number | null;
  linked_transaction_type: string | null;
  linked_transaction_id: number | null;
  import_batch_id: number | null;
  candidates: Candidate[] | null;
  raw_payload?: any;
  // Classification fields (may come from backend classification workflow)
  expense_purpose?: string | null;
  category?: string | null;
  coa_debit?: string | null;
  coa_credit?: string | null;
  vendor_id?: number | null;
  vendor_name?: string | null;
  cost_center_id?: string | null;
  cost_center_name?: string | null;
  detection_method?: string | null;
  confidence_score?: number | null;
  warnings?: string[] | null;
  reason_codes?: string[] | null;
  review_status?: string | null;
}

interface AuditEntry {
  id: number;
  mutation_id: number;
  action: string;
  actor: string;
  meta: any;
  created_at: string;
}

interface ExpenseCategory {
  id: number;
  name: string;
  code: string;
}

interface ExpenseItem {
  id: number;
  date: string;
  description: string;
  amount: string;
  status: string;
  categoryName?: string;
}

// ── Helpers ────────────────────────────────────────────────────────────────────

const idr = (n: number | string) =>
  new Intl.NumberFormat("id-ID").format(Number(n) || 0);

const fmtDate = (d: string) => {
  if (!d) return "—";
  try { return new Date(d).toLocaleDateString("id-ID"); } catch { return d; }
};

const fmtDateTime = (d: string) => {
  if (!d) return "—";
  try { return new Date(d).toLocaleString("id-ID"); } catch { return d; }
};

// Derive detection method from source
function deriveDetectionMethod(m: BankMutation): string {
  if (m.detection_method) return m.detection_method;
  const src = (m.source ?? "").toLowerCase();
  if (src.includes("mt940")) return "MT940 Parser";
  if (src.includes("camt")) return "CAMT.053 Parser";
  if (src.includes("csv")) return "CSV Import";
  if (src.includes("excel")) return "Excel Import";
  if (src.includes("sheet") || src.includes("gsheet")) return "Google Sheet Sync";
  if (src.includes("bank_import")) return "Bank Import";
  if (m.provider_name) return `Provider: ${m.provider_name}`;
  return src || "Manual";
}

// Derive confidence from candidates
function deriveConfidence(m: BankMutation): number | null {
  if (m.confidence_score != null) return m.confidence_score;
  const cands = m.candidates ?? [];
  if (cands.length > 0) return cands[0].match_score;
  return null;
}

// Derive reason codes from candidates
function deriveReasonCodes(m: BankMutation): string[] {
  if (m.reason_codes?.length) return m.reason_codes;
  const cands = m.candidates ?? [];
  if (!cands.length) return [];
  const best = cands[0];
  const codes: string[] = [];
  if (best.match_reason) codes.push(...best.match_reason.split(/[,;•\n]+/).map(s => s.trim()).filter(Boolean));
  if (best.amount_match) codes.push("nominal_match");
  if (best.date_match) codes.push("date_match");
  if (best.name_match) codes.push("name_match");
  if (best.order_id_match) codes.push("order_id_match");
  if (best.proof_match) codes.push("proof_match");
  return [...new Set(codes)];
}

// Derive warnings
function deriveWarnings(m: BankMutation): string[] {
  if (m.warnings?.length) return m.warnings;
  const warns: string[] = [];
  if (m.status === "duplicate_need_review") warns.push("Terdeteksi duplikat — perlu review");
  if (!m.candidates?.length && m.status === "unmatched") warns.push("Tidak ada kandidat cocok ditemukan");
  const conf = deriveConfidence(m);
  if (conf !== null && conf < 65) warns.push(`Confidence rendah (${conf}%) — butuh verifikasi manual`);
  if (m.linked_transaction_type === "internal_transfer") warns.push("Ditandai sebagai internal transfer");
  return warns;
}

// Derive review status label
function deriveReviewStatus(m: BankMutation): { label: string; variant: "default" | "secondary" | "destructive" | "outline" } {
  const rs = m.review_status ?? m.status;
  switch (rs) {
    case "approved":      return { label: "Disetujui", variant: "default" };
    case "reconciled":    return { label: "Terrekonsiliasi", variant: "default" };
    case "rejected":      return { label: "Ditolak", variant: "destructive" };
    case "matched":       return { label: "Cocok Ditemukan", variant: "secondary" };
    case "duplicate_need_review": return { label: "Duplikat - Review", variant: "outline" };
    case "unmatched":     return { label: "Belum Cocok", variant: "outline" };
    default:              return { label: rs ?? "—", variant: "secondary" };
  }
}

const STATUS_BG: Record<string, string> = {
  approved:              "bg-green-50 hover:bg-green-100/60",
  reconciled:            "bg-green-50 hover:bg-green-100/60",
  matched:               "bg-blue-50 hover:bg-blue-100/60",
  duplicate_need_review: "bg-orange-50 hover:bg-orange-100/60",
  rejected:              "bg-red-50 hover:bg-red-100/60",
  unmatched:             "bg-yellow-50/60 hover:bg-yellow-100/40",
};

// ── Sub-components ─────────────────────────────────────────────────────────────

function ConfidenceBadge({ score }: { score: number | null }) {
  if (score === null) return <span className="text-muted-foreground text-xs">—</span>;
  if (score >= 95) return <Badge className="bg-green-600 text-white text-xs gap-1"><Shield className="h-3 w-3" />{score}% Tinggi</Badge>;
  if (score >= 80) return <Badge className="bg-yellow-500 text-white text-xs">{score}% Sedang</Badge>;
  if (score >= 65) return <Badge className="bg-orange-500 text-white text-xs">{score}% Rendah</Badge>;
  return <Badge className="bg-red-500 text-white text-xs gap-1"><AlertTriangle className="h-3 w-3" />{score}% Sangat Rendah</Badge>;
}

function ClassificationGrid({ m }: { m: BankMutation }) {
  const confidence = deriveConfidence(m);
  const reasonCodes = deriveReasonCodes(m);
  const warnings = deriveWarnings(m);
  const reviewStatus = deriveReviewStatus(m);
  const detectionMethod = deriveDetectionMethod(m);

  const field = (icon: React.ReactNode, label: string, value: React.ReactNode) => (
    <div className="space-y-1">
      <div className="flex items-center gap-1.5 text-xs font-medium text-muted-foreground">
        {icon} {label}
      </div>
      <div className="text-sm font-medium text-foreground">{value ?? "—"}</div>
    </div>
  );

  return (
    <div className="bg-slate-50/80 rounded-lg border p-4 space-y-4">
      <div className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">
        Detail Klasifikasi
      </div>

      {/* Row 1: Purpose, Category, COA */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        {field(
          <Tag className="h-3.5 w-3.5" />,
          "Tujuan Pengeluaran",
          (m.expense_purpose
            ?? m.category
            ?? (m.raw_payload?.erp_category)
            ?? m.normalized_description?.slice(0, 40)) || "—"
        )}
        {field(
          <Layers className="h-3.5 w-3.5" />,
          "Kategori",
          m.category ?? (m.raw_payload?.accounting_class) ?? (m.candidates?.[0]?.candidate_type ? (
            <Badge variant="secondary" className="text-xs">{m.candidates[0].candidate_type}</Badge>
          ) : "—")
        )}
        {field(
          <CreditCard className="h-3.5 w-3.5" />,
          "COA",
          m.coa_debit || m.coa_credit
            ? <span className="font-mono text-xs">{[m.coa_debit, m.coa_credit].filter(Boolean).join(" / ")}</span>
            : "—"
        )}
      </div>

      <Separator />

      {/* Row 2: Vendor, Cost Center, Detection Method */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        {field(
          <User className="h-3.5 w-3.5" />,
          "Vendor",
          m.vendor_name ?? m.provider_name ?? "—"
        )}
        {field(
          <Building2 className="h-3.5 w-3.5" />,
          "Cost Center",
          m.cost_center_name ?? m.cost_center_id ?? "—"
        )}
        {field(
          <Cpu className="h-3.5 w-3.5" />,
          "Metode Deteksi",
          <span className="font-mono text-xs bg-slate-100 rounded px-1.5 py-0.5">{detectionMethod}</span>
        )}
      </div>

      <Separator />

      {/* Row 3: Confidence, Status Review */}
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        {field(
          <Shield className="h-3.5 w-3.5" />,
          "Confidence",
          <ConfidenceBadge score={confidence} />
        )}
        {field(
          <ListChecks className="h-3.5 w-3.5" />,
          "Status Review",
          <Badge variant={reviewStatus.variant} className="text-xs">{reviewStatus.label}</Badge>
        )}
      </div>

      {/* Warnings */}
      {warnings.length > 0 && (
        <div className="space-y-1.5">
          <div className="flex items-center gap-1.5 text-xs font-medium text-orange-700">
            <AlertCircle className="h-3.5 w-3.5" /> Peringatan
          </div>
          <div className="space-y-1">
            {warnings.map((w, i) => (
              <div key={i} className="flex items-start gap-2 text-xs bg-orange-50 border border-orange-200 rounded px-2 py-1.5 text-orange-800">
                <AlertTriangle className="h-3 w-3 mt-0.5 shrink-0" /> {w}
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Reason Codes */}
      {reasonCodes.length > 0 && (
        <div className="space-y-1.5">
          <div className="flex items-center gap-1.5 text-xs font-medium text-muted-foreground">
            <MessageSquare className="h-3.5 w-3.5" /> Reason Codes
          </div>
          <div className="flex flex-wrap gap-1">
            {reasonCodes.map((rc, i) => (
              <span key={i} className="text-[10px] bg-blue-50 text-blue-800 border border-blue-200 rounded px-2 py-0.5 font-mono">
                {rc}
              </span>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

// ── Correction Dialog ──────────────────────────────────────────────────────────

function CorrectDialog({
  mutation,
  open,
  onClose,
  onSuccess,
}: {
  mutation: BankMutation | null;
  open: boolean;
  onClose: () => void;
  onSuccess: () => void;
}) {
  const { toast } = useToast();
  const [form, setForm] = useState({ erp_category: "", accounting_class: "", cost_center_id: "", coa_debit: "", coa_credit: "", note: "" });
  const [saving, setSaving] = useState(false);

  // Pre-fill from mutation
  const resetForm = useCallback(() => {
    if (!mutation) return;
    setForm({
      erp_category: mutation.expense_purpose ?? mutation.category ?? "",
      accounting_class: mutation.category ?? "",
      cost_center_id: mutation.cost_center_id ?? "",
      coa_debit: mutation.coa_debit ?? "",
      coa_credit: mutation.coa_credit ?? "",
      note: "",
    });
  }, [mutation]);

  // Reset when dialog opens (useEffect, not useState)
  useEffect(() => { if (open) resetForm(); }, [open, resetForm]);

  if (!mutation) return null;

  const handleSave = async () => {
    setSaving(true);
    try {
      if (mutation.import_batch_id) {
        // Path 1: mutasi dari import batch → bulk-classify endpoint
        const body = {
          row_ids: [mutation.id],
          erp_category: form.erp_category || undefined,
          accounting_class: form.accounting_class || undefined,
          cost_center_id: form.cost_center_id || undefined,
          coa_debit: form.coa_debit || undefined,
          coa_credit: form.coa_credit || undefined,
        };
        const r = await fetch(`/api/bank-mutation-import/${mutation.import_batch_id}/bulk-classify`, {
          method: "PATCH",
          credentials: "include",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body),
        });
        const data = await r.json();
        if (!r.ok) throw new Error(data.error ?? "Gagal menyimpan koreksi");
      } else {
        // Path 2: mutasi langsung (tidak ada import batch) → reject dengan pesan jelas
        // Backend belum memiliki endpoint PATCH /api/bank-reconciliation/:id/classify.
        // Tampilkan error yang informatif alih-alih toast sukses palsu.
        throw new Error(
          "Mutasi ini tidak berasal dari import batch sehingga belum dapat dikoreksi secara langsung. " +
          "Hubungi administrator atau gunakan aksi 'Hubungkan ke Expense' sebagai alternatif."
        );
      }
      // Coba unapprove agar reviewer bisa re-approve dengan data baru
      if (mutation.status === "approved" || mutation.status === "reconciled") {
        await fetch(`/api/bank-reconciliation/${mutation.id}/unapprove`, {
          method: "POST", credentials: "include",
          headers: { "Content-Type": "application/json" }, body: "{}",
        }).catch(() => {});
      }
      toast({ title: "Koreksi tersimpan", description: "Klasifikasi mutasi telah diperbarui." });
      onSuccess();
      onClose();
    } catch (e: any) {
      toast({ title: "Gagal menyimpan", description: e.message, variant: "destructive" });
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={v => !v && onClose()}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Pencil className="h-4 w-4" /> Koreksi Klasifikasi
          </DialogTitle>
          <DialogDescription>
            Perbarui klasifikasi untuk: <em>{mutation.description.slice(0, 60)}</em>
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-4 py-2">
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label className="text-xs">Tujuan Pengeluaran / ERP Category</Label>
              <Input
                placeholder="e.g. operasional, marketing"
                value={form.erp_category}
                onChange={e => setForm(f => ({ ...f, erp_category: e.target.value }))}
              />
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs">Kategori Akuntansi</Label>
              <Input
                placeholder="e.g. expense, cogs"
                value={form.accounting_class}
                onChange={e => setForm(f => ({ ...f, accounting_class: e.target.value }))}
              />
            </div>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label className="text-xs">COA Debit</Label>
              <Input
                placeholder="e.g. 6-1001"
                value={form.coa_debit}
                onChange={e => setForm(f => ({ ...f, coa_debit: e.target.value }))}
              />
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs">COA Kredit</Label>
              <Input
                placeholder="e.g. 1-1001"
                value={form.coa_credit}
                onChange={e => setForm(f => ({ ...f, coa_credit: e.target.value }))}
              />
            </div>
          </div>
          <div className="space-y-1.5">
            <Label className="text-xs">Cost Center ID</Label>
            <Input
              placeholder="e.g. CC-OPS-01"
              value={form.cost_center_id}
              onChange={e => setForm(f => ({ ...f, cost_center_id: e.target.value }))}
            />
          </div>
          <div className="space-y-1.5">
            <Label className="text-xs">Catatan Koreksi</Label>
            <Textarea
              placeholder="Alasan koreksi..."
              rows={2}
              value={form.note}
              onChange={e => setForm(f => ({ ...f, note: e.target.value }))}
            />
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>Batal</Button>
          <Button onClick={handleSave} disabled={saving} className="gap-2">
            {saving && <Loader2 className="h-4 w-4 animate-spin" />}
            Simpan Koreksi
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ── Reasons Dialog ─────────────────────────────────────────────────────────────

function ReasonsDialog({
  mutation,
  open,
  onClose,
}: {
  mutation: BankMutation | null;
  open: boolean;
  onClose: () => void;
}) {
  const { data: auditData, isLoading } = useQuery({
    queryKey: ["bank-recon-audit", mutation?.id],
    queryFn: async () => {
      if (!mutation) return { audit: [] };
      const r = await fetch(`/api/bank-reconciliation/audit/${mutation.id}`, { credentials: "include" });
      return r.json() as Promise<{ audit: AuditEntry[] }>;
    },
    enabled: open && !!mutation,
  });

  if (!mutation) return null;

  const reasonCodes = deriveReasonCodes(mutation);
  const warnings = deriveWarnings(mutation);
  const candidates = mutation.candidates ?? [];
  const bestCand = candidates[0];
  const auditEntries: AuditEntry[] = auditData?.audit ?? [];

  return (
    <Dialog open={open} onOpenChange={v => !v && onClose()}>
      <DialogContent className="max-w-2xl max-h-[80vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Eye className="h-4 w-4" /> Lihat Alasan Klasifikasi
          </DialogTitle>
          <DialogDescription className="text-xs truncate">
            {mutation.description}
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          {/* Confidence & Match Factors */}
          {bestCand && (
            <div className="space-y-2">
              <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">Match Terbaik</p>
              <div className="bg-blue-50 border border-blue-200 rounded-lg p-3 space-y-2">
                <div className="flex items-center justify-between">
                  <span className="text-sm font-medium text-blue-900">
                    {bestCand.candidate_type} #{bestCand.candidate_id}
                  </span>
                  <ConfidenceBadge score={bestCand.match_score} />
                </div>
                <div className="flex flex-wrap gap-1">
                  {bestCand.amount_match && <span className="text-[10px] bg-green-100 text-green-800 rounded px-1.5 py-0.5 border border-green-200">✓ Nominal</span>}
                  {bestCand.date_match   && <span className="text-[10px] bg-blue-100 text-blue-800 rounded px-1.5 py-0.5 border border-blue-200">✓ Tanggal</span>}
                  {bestCand.name_match   && <span className="text-[10px] bg-purple-100 text-purple-800 rounded px-1.5 py-0.5 border border-purple-200">✓ Nama</span>}
                  {bestCand.order_id_match && <span className="text-[10px] bg-amber-100 text-amber-800 rounded px-1.5 py-0.5 border border-amber-200">✓ Order ID</span>}
                  {bestCand.proof_match  && <span className="text-[10px] bg-cyan-100 text-cyan-800 rounded px-1.5 py-0.5 border border-cyan-200">✓ Bukti</span>}
                </div>
                {bestCand.match_reason && (
                  <p className="text-xs text-blue-800">{bestCand.match_reason}</p>
                )}
              </div>
            </div>
          )}

          {/* All Candidates */}
          {candidates.length > 1 && (
            <div className="space-y-2">
              <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">
                Semua Kandidat ({candidates.length})
              </p>
              <div className="space-y-1.5 max-h-48 overflow-y-auto">
                {candidates.map((c, i) => (
                  <div key={c.id} className="flex items-center justify-between text-xs bg-gray-50 border rounded px-3 py-2">
                    <span className="text-gray-700">#{i + 1} {c.candidate_type} #{c.candidate_id}</span>
                    <ConfidenceBadge score={c.match_score} />
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Reason Codes */}
          {reasonCodes.length > 0 && (
            <div className="space-y-2">
              <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">Reason Codes</p>
              <div className="flex flex-wrap gap-1.5">
                {reasonCodes.map((rc, i) => (
                  <span key={i} className="text-xs bg-slate-100 text-slate-700 border rounded px-2 py-0.5 font-mono">{rc}</span>
                ))}
              </div>
            </div>
          )}

          {/* Warnings */}
          {warnings.length > 0 && (
            <div className="space-y-2">
              <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">Peringatan</p>
              <div className="space-y-1">
                {warnings.map((w, i) => (
                  <div key={i} className="text-xs flex items-start gap-2 bg-orange-50 border border-orange-200 rounded px-2 py-1.5 text-orange-800">
                    <AlertTriangle className="h-3 w-3 mt-0.5 shrink-0" /> {w}
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Audit Trail */}
          <div className="space-y-2">
            <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">Riwayat Aksi</p>
            {isLoading ? (
              <div className="flex items-center gap-2 text-xs text-muted-foreground py-2">
                <Loader2 className="h-3 w-3 animate-spin" /> Memuat...
              </div>
            ) : auditEntries.length === 0 ? (
              <p className="text-xs text-muted-foreground">Belum ada riwayat aksi.</p>
            ) : (
              <div className="space-y-1.5 max-h-48 overflow-y-auto">
                {auditEntries.map(a => (
                  <div key={a.id} className="text-xs bg-gray-50 border rounded px-3 py-2 space-y-0.5">
                    <div className="flex items-center justify-between">
                      <span className="font-medium">{a.action}</span>
                      <span className="text-muted-foreground">{fmtDateTime(a.created_at)}</span>
                    </div>
                    <div className="text-muted-foreground">oleh {a.actor}</div>
                    {a.meta && typeof a.meta === "object" && Object.keys(a.meta).length > 0 && (
                      <div className="font-mono text-[10px] text-gray-500 truncate">{JSON.stringify(a.meta)}</div>
                    )}
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={onClose}>Tutup</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ── Link Expense Dialog ────────────────────────────────────────────────────────

function LinkExpenseDialog({
  mutation,
  open,
  onClose,
  onSuccess,
}: {
  mutation: BankMutation | null;
  open: boolean;
  onClose: () => void;
  onSuccess: () => void;
}) {
  const { toast } = useToast();
  const [search, setSearch] = useState("");
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [linking, setLinking] = useState(false);

  const { data: expenseData, isLoading } = useQuery({
    queryKey: ["expenses-search", search],
    queryFn: async () => {
      const params = new URLSearchParams({ limit: "20" });
      if (search) params.set("search", search);
      const r = await fetch(`/api/expenses?${params}`, { credentials: "include" });
      if (!r.ok) return { expenses: [] };
      return r.json() as Promise<{ expenses: ExpenseItem[] }>;
    },
    enabled: open,
  });

  const expenses: ExpenseItem[] = expenseData?.expenses ?? [];

  const handleLink = async () => {
    if (!mutation || !selectedId) return;
    setLinking(true);
    try {
      // Link via approve with expense candidate
      const r = await fetch(`/api/bank-reconciliation/${mutation.id}/approve`, {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ candidate_type: "expense", candidate_id: selectedId }),
      });
      const data = await r.json();
      if (!r.ok) throw new Error(data.error ?? "Gagal menghubungkan");
      toast({ title: "Berhasil dihubungkan ke expense" });
      onSuccess();
      onClose();
    } catch (e: any) {
      toast({ title: "Gagal", description: e.message, variant: "destructive" });
    } finally {
      setLinking(false);
    }
  };

  if (!mutation) return null;

  return (
    <Dialog open={open} onOpenChange={v => !v && onClose()}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Link2 className="h-4 w-4" /> Hubungkan ke Expense
          </DialogTitle>
          <DialogDescription>
            Pilih expense yang sesuai dengan mutasi ini (Rp {idr(mutation.amount)})
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-3">
          <div className="relative">
            <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
            <Input
              className="pl-9"
              placeholder="Cari expense..."
              value={search}
              onChange={e => setSearch(e.target.value)}
            />
          </div>
          {isLoading ? (
            <div className="flex items-center gap-2 text-sm text-muted-foreground py-4">
              <Loader2 className="h-4 w-4 animate-spin" /> Memuat...
            </div>
          ) : expenses.length === 0 ? (
            <p className="text-sm text-muted-foreground py-4 text-center">Tidak ada expense ditemukan.</p>
          ) : (
            <div className="space-y-1 max-h-64 overflow-y-auto">
              {expenses.map(e => (
                <div
                  key={e.id}
                  className={`flex items-center justify-between rounded border px-3 py-2 cursor-pointer transition-colors text-sm ${
                    selectedId === e.id ? "bg-primary/10 border-primary" : "hover:bg-muted/40"
                  }`}
                  onClick={() => setSelectedId(e.id)}
                >
                  <div>
                    <p className="font-medium">{e.description?.slice(0, 50) || `Expense #${e.id}`}</p>
                    <p className="text-xs text-muted-foreground">{fmtDate(e.date)} · {e.categoryName ?? "—"}</p>
                  </div>
                  <div className="text-right shrink-0">
                    <p className="font-semibold text-sm">Rp {idr(e.amount)}</p>
                    <Badge variant="outline" className="text-[10px]">{e.status}</Badge>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>Batal</Button>
          <Button onClick={handleLink} disabled={!selectedId || linking} className="gap-2">
            {linking && <Loader2 className="h-4 w-4 animate-spin" />}
            Hubungkan
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ── Create Expense Draft Dialog ────────────────────────────────────────────────

function CreateExpenseDraftDialog({
  mutation,
  open,
  onClose,
  onSuccess,
}: {
  mutation: BankMutation | null;
  open: boolean;
  onClose: () => void;
  onSuccess: () => void;
}) {
  const { toast } = useToast();
  const [creating, setCreating] = useState(false);
  const [form, setForm] = useState({ description: "", date: "", amount: "", categoryId: "", note: "" });

  // Pre-fill form ketika dialog dibuka (useEffect, bukan render-time setState)
  useEffect(() => {
    if (open && mutation) {
      setForm({
        description: mutation.description,
        date: mutation.transaction_date,
        amount: mutation.amount,
        categoryId: "",
        note: "",
      });
    }
  }, [open, mutation]);

  const { data: catData } = useQuery({
    queryKey: ["expense-categories"],
    queryFn: () => fetch("/api/expenses/categories", { credentials: "include" }).then(r => r.json()),
    enabled: open,
  });
  const categories: ExpenseCategory[] = catData?.categories ?? catData ?? [];

  const handleCreate = async () => {
    if (!mutation) return;
    setCreating(true);
    try {
      const body = {
        date: form.date,
        description: form.description,
        amount: Number(form.amount),
        qty: 1,
        unitPrice: Number(form.amount),
        categoryId: form.categoryId ? Number(form.categoryId) : undefined,
        expenseType: "general",
        notes: form.note || `Dibuat dari mutasi bank #${mutation.id}`,
      };
      const r = await fetch("/api/expenses", {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const data = await r.json();
      if (!r.ok) throw new Error(data.message ?? data.error ?? "Gagal membuat expense");
      toast({ title: "Expense draft berhasil dibuat", description: `ID: ${data.id ?? data.expense?.id ?? "—"}` });
      onSuccess();
      onClose();
    } catch (e: any) {
      toast({ title: "Gagal membuat expense", description: e.message, variant: "destructive" });
    } finally {
      setCreating(false);
    }
  };

  if (!mutation) return null;

  return (
    <Dialog open={open} onOpenChange={v => !v && onClose()}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <FileText className="h-4 w-4" /> Buat Expense Draft
          </DialogTitle>
          <DialogDescription>
            Data pre-filled dari mutasi bank. Status akan DRAFT.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-3 py-2">
          <div className="space-y-1.5">
            <Label className="text-xs">Deskripsi</Label>
            <Input value={form.description} onChange={e => setForm(f => ({ ...f, description: e.target.value }))} />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label className="text-xs">Tanggal</Label>
              <Input type="date" value={form.date} onChange={e => setForm(f => ({ ...f, date: e.target.value }))} />
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs">Nominal (Rp)</Label>
              <Input type="number" value={form.amount} onChange={e => setForm(f => ({ ...f, amount: e.target.value }))} />
            </div>
          </div>
          <div className="space-y-1.5">
            <Label className="text-xs">Kategori</Label>
            <Select value={form.categoryId || "none"} onValueChange={v => setForm(f => ({ ...f, categoryId: v === "none" ? "" : v }))}>
              <SelectTrigger>
                <SelectValue placeholder="Pilih kategori (opsional)" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="none">— Tidak ada —</SelectItem>
                {categories.map((c: ExpenseCategory) => (
                  <SelectItem key={c.id} value={String(c.id)}>{c.name}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1.5">
            <Label className="text-xs">Catatan</Label>
            <Textarea
              rows={2}
              placeholder="Catatan tambahan..."
              value={form.note}
              onChange={e => setForm(f => ({ ...f, note: e.target.value }))}
            />
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>Batal</Button>
          <Button onClick={handleCreate} disabled={creating} className="gap-2">
            {creating && <Loader2 className="h-4 w-4 animate-spin" />}
            Buat Draft
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ── Action Bar ─────────────────────────────────────────────────────────────────

function ActionBar({
  mutation,
  onAccept,
  onCorrect,
  onInternalTransfer,
  onLinkExpense,
  onCreateDraft,
  onViewReasons,
  accepting,
  markingTransfer,
}: {
  mutation: BankMutation;
  onAccept: () => void;
  onCorrect: () => void;
  onInternalTransfer: () => void;
  onLinkExpense: () => void;
  onCreateDraft: () => void;
  onViewReasons: () => void;
  accepting: boolean;
  markingTransfer: boolean;
}) {
  const isApproved = mutation.status === "approved" || mutation.status === "reconciled";

  return (
    <div className="flex flex-wrap items-center gap-2 pt-2">
      {/* Terima Rekomendasi */}
      <Button
        size="sm"
        className="gap-1.5 bg-green-600 hover:bg-green-700 text-white"
        onClick={onAccept}
        disabled={accepting || isApproved}
        title={isApproved ? "Sudah disetujui" : "Terima rekomendasi klasifikasi"}
      >
        {accepting ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <CheckCircle2 className="h-3.5 w-3.5" />}
        {isApproved ? "Sudah Disetujui" : "Terima Rekomendasi"}
      </Button>

      {/* Koreksi */}
      <Button
        size="sm"
        variant="outline"
        className="gap-1.5"
        onClick={onCorrect}
        title="Koreksi klasifikasi manual"
      >
        <Pencil className="h-3.5 w-3.5" />
        Koreksi
      </Button>

      {/* Tandai Internal Transfer */}
      <Button
        size="sm"
        variant="outline"
        className="gap-1.5 border-purple-300 text-purple-700 hover:bg-purple-50"
        onClick={onInternalTransfer}
        disabled={markingTransfer}
        title="Tandai sebagai transaksi internal antar rekening"
      >
        {markingTransfer ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <ArrowRightLeft className="h-3.5 w-3.5" />}
        Internal Transfer
      </Button>

      {/* Hubungkan ke Expense */}
      <Button
        size="sm"
        variant="outline"
        className="gap-1.5 border-blue-300 text-blue-700 hover:bg-blue-50"
        onClick={onLinkExpense}
        title="Hubungkan ke expense yang sudah ada"
      >
        <Link2 className="h-3.5 w-3.5" />
        Link Expense
      </Button>

      {/* Buat Expense Draft */}
      <Button
        size="sm"
        variant="outline"
        className="gap-1.5 border-amber-300 text-amber-700 hover:bg-amber-50"
        onClick={onCreateDraft}
        title="Buat expense draft baru dari mutasi ini"
      >
        <FileText className="h-3.5 w-3.5" />
        Buat Draft
      </Button>

      {/* Lihat Alasan */}
      <Button
        size="sm"
        variant="ghost"
        className="gap-1.5 text-muted-foreground"
        onClick={onViewReasons}
        title="Lihat semua alasan dan riwayat"
      >
        <Eye className="h-3.5 w-3.5" />
        Lihat Alasan
      </Button>
    </div>
  );
}

// ── Main Page ──────────────────────────────────────────────────────────────────

export default function BankReconClassificationPage() {
  const { toast } = useToast();
  const qc = useQueryClient();

  // ── Filters ──────────────────────────────────────────────────────────────────
  const [filterStatus, setFilterStatus] = useState("all");
  const [filterDir, setFilterDir] = useState("all");
  const [filterSearch, setFilterSearch] = useState("");
  const [filterFrom, setFilterFrom] = useState("");
  const [filterTo, setFilterTo] = useState("");
  const [page, setPage] = useState(0);
  const PAGE_SIZE = 30;

  // ── Expand / Actions ──────────────────────────────────────────────────────────
  const [expanded, setExpanded] = useState<Set<number>>(new Set());
  const toggleExpand = (id: number) => setExpanded(s => { const n = new Set(s); n.has(id) ? n.delete(id) : n.add(id); return n; });

  // ── Dialog state ──────────────────────────────────────────────────────────────
  const [correctTarget, setCorrectTarget] = useState<BankMutation | null>(null);
  const [reasonTarget, setReasonTarget] = useState<BankMutation | null>(null);
  const [linkExpenseTarget, setLinkExpenseTarget] = useState<BankMutation | null>(null);
  const [createDraftTarget, setCreateDraftTarget] = useState<BankMutation | null>(null);

  // ── Per-row loading states ────────────────────────────────────────────────────
  const [accepting, setAccepting] = useState<Record<number, boolean>>({});
  const [markingTransfer, setMarkingTransfer] = useState<Record<number, boolean>>({});

  const invalidate = () => {
    qc.invalidateQueries({ queryKey: ["bank-recon-classification"] });
    qc.invalidateQueries({ queryKey: ["bank-recon-summary-cls"] });
  };

  // ── Query: mutations ──────────────────────────────────────────────────────────
  const queryKey = ["bank-recon-classification", filterStatus, filterDir, filterSearch, filterFrom, filterTo, page];
  const { data, isLoading, refetch } = useQuery({
    queryKey,
    queryFn: async () => {
      const params = new URLSearchParams({ limit: String(PAGE_SIZE), offset: String(page * PAGE_SIZE) });
      if (filterStatus !== "all") params.set("status", filterStatus);
      if (filterDir !== "all") params.set("direction", filterDir);
      if (filterSearch) params.set("search", filterSearch);
      if (filterFrom) params.set("from", filterFrom);
      if (filterTo) params.set("to", filterTo);
      const r = await fetch(`/api/bank-reconciliation/mutations?${params}`, { credentials: "include" });
      if (!r.ok) throw new Error(await r.text());
      return r.json() as Promise<{ mutations: BankMutation[]; total: number }>;
    },
  });

  // ── Query: summary ────────────────────────────────────────────────────────────
  const { data: summary } = useQuery({
    queryKey: ["bank-recon-summary-cls"],
    queryFn: () =>
      fetch("/api/bank-reconciliation/summary", { credentials: "include" }).then(r => r.json()) as Promise<{
        summary: { status: string; count: string; total_amount: string }[];
      }>,
  });

  const mutations = data?.mutations ?? [];
  const total = data?.total ?? 0;
  const totalPages = Math.ceil(total / PAGE_SIZE);

  const summaryMap: Record<string, { count: number; amount: number }> = {};
  for (const s of summary?.summary ?? []) {
    summaryMap[s.status] = { count: Number(s.count), amount: Number(s.total_amount) };
  }

  // ── Actions ───────────────────────────────────────────────────────────────────

  const handleAccept = async (m: BankMutation) => {
    setAccepting(s => ({ ...s, [m.id]: true }));
    try {
      const cands = m.candidates ?? [];
      const best = cands[0];
      const r = await fetch(`/api/bank-reconciliation/${m.id}/approve`, {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          match_id: best?.id,
          candidate_type: best?.candidate_type,
          candidate_id: best?.candidate_id,
        }),
      });
      const data = await r.json();
      if (!r.ok) throw new Error(data.error ?? "Gagal approve");
      toast({ title: "Rekomendasi diterima", description: "Mutasi telah disetujui." });
      invalidate();
    } catch (e: any) {
      toast({ title: "Gagal menerima rekomendasi", description: e.message, variant: "destructive" });
    } finally {
      setAccepting(s => ({ ...s, [m.id]: false }));
    }
  };

  const handleInternalTransfer = async (m: BankMutation) => {
    if (!confirm(`Tandai "${m.description.slice(0, 60)}" sebagai internal transfer?`)) return;
    setMarkingTransfer(s => ({ ...s, [m.id]: true }));
    try {
      // Approve with internal_transfer candidate_type to mark it
      const r = await fetch(`/api/bank-reconciliation/${m.id}/approve`, {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ candidate_type: "internal_transfer", candidate_id: 0 }),
      });
      const data = await r.json();
      if (!r.ok) {
        // If approve fails (no candidate), try reject with note
        await fetch(`/api/bank-reconciliation/${m.id}/reject`, {
          method: "POST",
          credentials: "include",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ note: "internal_transfer" }),
        });
      }
      toast({ title: "Ditandai sebagai internal transfer" });
      invalidate();
    } catch (e: any) {
      toast({ title: "Gagal", description: e.message, variant: "destructive" });
    } finally {
      setMarkingTransfer(s => ({ ...s, [m.id]: false }));
    }
  };

  // ── Render ────────────────────────────────────────────────────────────────────

  const summaryCards = [
    { key: "unmatched",             label: "Belum Cocok",    icon: AlertTriangle, color: "text-yellow-600" },
    { key: "matched",               label: "Match Ditemukan", icon: Info,          color: "text-blue-600"   },
    { key: "duplicate_need_review", label: "Duplikat",        icon: AlertCircle,   color: "text-orange-600" },
    { key: "approved",              label: "Disetujui",       icon: CheckCircle2,  color: "text-green-600"  },
    { key: "rejected",              label: "Ditolak",         icon: XCircle,       color: "text-red-500"    },
  ];

  return (
    <AppShell>
      {/* Dialogs */}
      <CorrectDialog
        mutation={correctTarget}
        open={!!correctTarget}
        onClose={() => setCorrectTarget(null)}
        onSuccess={invalidate}
      />
      <ReasonsDialog
        mutation={reasonTarget}
        open={!!reasonTarget}
        onClose={() => setReasonTarget(null)}
      />
      <LinkExpenseDialog
        mutation={linkExpenseTarget}
        open={!!linkExpenseTarget}
        onClose={() => setLinkExpenseTarget(null)}
        onSuccess={invalidate}
      />
      <CreateExpenseDraftDialog
        mutation={createDraftTarget}
        open={!!createDraftTarget}
        onClose={() => setCreateDraftTarget(null)}
        onSuccess={invalidate}
      />

      <div className="p-6 max-w-full space-y-5">
        {/* Header */}
        <div className="flex items-center justify-between flex-wrap gap-3">
          <div className="flex items-start gap-3">
            <Link href="/accounting">
              <Button variant="ghost" size="icon" aria-label="Kembali">
                <ArrowLeft className="h-4 w-4" />
              </Button>
            </Link>
            <div>
              <h1 className="text-2xl font-black text-foreground flex items-center gap-2">
                <Tag className="h-6 w-6 text-blue-600" />
                Review Klasifikasi Rekonsiliasi
              </h1>
              <p className="text-sm text-muted-foreground mt-0.5">
                Tinjau tujuan pengeluaran, kategori, COA, vendor, cost center, dan ambil aksi per mutasi bank
              </p>
            </div>
          </div>
          <Button variant="outline" size="sm" onClick={() => refetch()} className="gap-2">
            <RefreshCw className="h-4 w-4" /> Refresh
          </Button>
        </div>

        {/* Summary Cards */}
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-3">
          {summaryCards.map(({ key, label, icon: Icon, color }) => (
            <Card
              key={key}
              className={`cursor-pointer transition-all hover:shadow-md ${filterStatus === key ? "ring-2 ring-primary" : ""}`}
              onClick={() => { setFilterStatus(p => p === key ? "all" : key); setPage(0); }}
            >
              <CardContent className="p-4">
                <div className="flex items-center gap-2 mb-1">
                  <Icon className={`w-4 h-4 ${color}`} />
                  <span className="text-xs text-muted-foreground">{label}</span>
                </div>
                <div className="text-2xl font-bold">{summaryMap[key]?.count ?? 0}</div>
                <div className="text-xs text-muted-foreground mt-0.5">Rp {idr(summaryMap[key]?.amount ?? 0)}</div>
              </CardContent>
            </Card>
          ))}
        </div>

        {/* Filters */}
        <Card>
          <CardContent className="p-4">
            <div className="flex flex-wrap gap-3 items-end">
              <div className="flex-1 min-w-[200px]">
                <div className="relative">
                  <Search className="absolute left-2.5 top-2.5 w-4 h-4 text-muted-foreground" />
                  <Input
                    placeholder="Cari deskripsi, mutation key, provider..."
                    className="pl-9"
                    value={filterSearch}
                    onChange={e => { setFilterSearch(e.target.value); setPage(0); }}
                  />
                </div>
              </div>
              <Select value={filterStatus} onValueChange={v => { setFilterStatus(v); setPage(0); }}>
                <SelectTrigger className="w-[170px]"><SelectValue placeholder="Status" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">Semua Status</SelectItem>
                  <SelectItem value="unmatched">Belum Cocok</SelectItem>
                  <SelectItem value="matched">Match Ditemukan</SelectItem>
                  <SelectItem value="duplicate_need_review">Duplikat</SelectItem>
                  <SelectItem value="approved">Disetujui</SelectItem>
                  <SelectItem value="rejected">Ditolak</SelectItem>
                </SelectContent>
              </Select>
              <Select value={filterDir} onValueChange={v => { setFilterDir(v); setPage(0); }}>
                <SelectTrigger className="w-[130px]"><SelectValue placeholder="Arah" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">Semua Arah</SelectItem>
                  <SelectItem value="IN">IN (Masuk)</SelectItem>
                  <SelectItem value="OUT">OUT (Keluar)</SelectItem>
                </SelectContent>
              </Select>
              <div className="flex items-center gap-2">
                <Input type="date" className="w-[140px]" placeholder="Dari" value={filterFrom} onChange={e => { setFilterFrom(e.target.value); setPage(0); }} />
                <span className="text-muted-foreground">–</span>
                <Input type="date" className="w-[140px]" placeholder="Sampai" value={filterTo} onChange={e => { setFilterTo(e.target.value); setPage(0); }} />
              </div>
              <Button variant="ghost" size="sm" onClick={() => { setFilterStatus("all"); setFilterDir("all"); setFilterSearch(""); setFilterFrom(""); setFilterTo(""); setPage(0); }}>
                Reset
              </Button>
            </div>
          </CardContent>
        </Card>

        {/* Legend */}
        <div className="bg-blue-50/60 border border-blue-100 rounded-lg px-4 py-3">
          <div className="flex flex-wrap items-center gap-x-5 gap-y-1.5 text-xs text-blue-800">
            <span className="font-semibold">Klik baris untuk melihat detail klasifikasi & aksi:</span>
            <span className="flex items-center gap-1"><CheckCircle2 className="h-3 w-3 text-green-600" /> Terima rekomendasi</span>
            <span className="flex items-center gap-1"><Pencil className="h-3 w-3 text-blue-600" /> Koreksi manual</span>
            <span className="flex items-center gap-1"><ArrowRightLeft className="h-3 w-3 text-purple-600" /> Tandai internal transfer</span>
            <span className="flex items-center gap-1"><Link2 className="h-3 w-3 text-blue-600" /> Hubungkan ke expense</span>
            <span className="flex items-center gap-1"><FileText className="h-3 w-3 text-amber-600" /> Buat expense draft</span>
          </div>
        </div>

        {/* Table */}
        <Card>
          <CardContent className="p-0">
            {isLoading ? (
              <div className="flex items-center justify-center py-16 gap-2 text-muted-foreground">
                <Loader2 className="h-5 w-5 animate-spin" /> Memuat data...
              </div>
            ) : mutations.length === 0 ? (
              <div className="flex flex-col items-center justify-center py-16 gap-3 text-muted-foreground">
                <Tag className="h-10 w-10 opacity-30" />
                <p>Tidak ada mutasi ditemukan.</p>
              </div>
            ) : (
              <div className="overflow-x-auto">
                <Table>
                  <TableHeader>
                    <TableRow className="bg-muted/30">
                      <TableHead className="w-8"></TableHead>
                      <TableHead>Tanggal</TableHead>
                      <TableHead>Deskripsi</TableHead>
                      <TableHead className="text-right">Kredit</TableHead>
                      <TableHead className="text-right">Debit</TableHead>
                      <TableHead>Arah</TableHead>
                      <TableHead>Kategori</TableHead>
                      <TableHead>Vendor</TableHead>
                      <TableHead>Confidence</TableHead>
                      <TableHead>Status</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {mutations.map(m => {
                      const isExp = expanded.has(m.id);
                      const conf = deriveConfidence(m);
                      const rs = deriveReviewStatus(m);
                      const warns = deriveWarnings(m);
                      return (
                        <>
                          <TableRow
                            key={m.id}
                            className={`cursor-pointer transition-colors ${STATUS_BG[m.status] ?? ""}`}
                            onClick={() => toggleExpand(m.id)}
                          >
                            <TableCell className="pl-4 pr-2">
                              {isExp
                                ? <ChevronDown className="h-4 w-4 text-muted-foreground" />
                                : <ChevronRight className="h-4 w-4 text-muted-foreground" />}
                            </TableCell>
                            <TableCell className="whitespace-nowrap text-sm font-mono">
                              {fmtDate(m.transaction_date)}
                            </TableCell>
                            <TableCell className="max-w-[220px]">
                              <div className="truncate text-sm font-medium" title={m.description}>{m.description}</div>
                              {m.provider_order_id && (
                                <div className="text-[10px] text-muted-foreground font-mono">{m.provider_order_id}</div>
                              )}
                              {warns.length > 0 && (
                                <div className="flex items-center gap-1 mt-0.5">
                                  <AlertTriangle className="h-3 w-3 text-orange-500" />
                                  <span className="text-[10px] text-orange-600">{warns[0]}</span>
                                </div>
                              )}
                            </TableCell>
                            <TableCell className="text-right text-sm text-green-700 font-medium">
                              {Number(m.credit_amount) > 0 ? idr(m.credit_amount) : "—"}
                            </TableCell>
                            <TableCell className="text-right text-sm text-red-600 font-medium">
                              {Number(m.debit_amount) > 0 ? idr(m.debit_amount) : "—"}
                            </TableCell>
                            <TableCell>
                              <Badge variant="outline" className={m.direction === "IN" ? "text-green-700 border-green-300 text-xs" : "text-red-600 border-red-300 text-xs"}>
                                {m.direction}
                              </Badge>
                            </TableCell>
                            <TableCell className="text-xs text-muted-foreground">
                              {m.category ?? m.expense_purpose ?? (m.candidates?.[0]?.candidate_type ? (
                                <Badge variant="secondary" className="text-[10px]">{m.candidates[0].candidate_type}</Badge>
                              ) : "—")}
                            </TableCell>
                            <TableCell className="text-xs">
                              {m.vendor_name ?? m.provider_name
                                ? <span className="truncate max-w-[80px] inline-block">{m.vendor_name ?? m.provider_name}</span>
                                : <span className="text-muted-foreground">—</span>}
                            </TableCell>
                            <TableCell>
                              <ConfidenceBadge score={conf} />
                            </TableCell>
                            <TableCell>
                              <Badge variant={rs.variant} className="text-xs whitespace-nowrap">{rs.label}</Badge>
                            </TableCell>
                          </TableRow>

                          {/* Expanded Classification Panel */}
                          {isExp && (
                            <TableRow key={`${m.id}-expanded`} className="bg-slate-50/50">
                              <TableCell colSpan={10} className="px-6 py-4">
                                <ClassificationGrid m={m} />
                                <ActionBar
                                  mutation={m}
                                  onAccept={() => handleAccept(m)}
                                  onCorrect={() => setCorrectTarget(m)}
                                  onInternalTransfer={() => handleInternalTransfer(m)}
                                  onLinkExpense={() => setLinkExpenseTarget(m)}
                                  onCreateDraft={() => setCreateDraftTarget(m)}
                                  onViewReasons={() => setReasonTarget(m)}
                                  accepting={accepting[m.id] ?? false}
                                  markingTransfer={markingTransfer[m.id] ?? false}
                                />
                              </TableCell>
                            </TableRow>
                          )}
                        </>
                      );
                    })}
                  </TableBody>
                </Table>
              </div>
            )}

            {/* Pagination */}
            {totalPages > 1 && (
              <div className="flex items-center justify-between px-4 py-3 border-t text-sm">
                <span className="text-muted-foreground">
                  {page * PAGE_SIZE + 1}–{Math.min((page + 1) * PAGE_SIZE, total)} dari {total} mutasi
                </span>
                <div className="flex gap-2">
                  <Button size="sm" variant="outline" disabled={page === 0} onClick={() => setPage(p => p - 1)}>
                    Sebelumnya
                  </Button>
                  <Button size="sm" variant="outline" disabled={page >= totalPages - 1} onClick={() => setPage(p => p + 1)}>
                    Berikutnya
                  </Button>
                </div>
              </div>
            )}
          </CardContent>
        </Card>
      </div>
    </AppShell>
  );
}
