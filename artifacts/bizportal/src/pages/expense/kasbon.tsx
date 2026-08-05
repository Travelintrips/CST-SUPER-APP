import { useState, useCallback, useRef } from "react";
import { Link } from "wouter";
import { DatePicker } from "@/components/ui/date-picker";
import { AppShell } from "@/components/layout/AppShell";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { SearchableSelect } from "@/components/ui/searchable-select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetDescription } from "@/components/ui/sheet";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Command, CommandEmpty, CommandInput, CommandItem, CommandList } from "@/components/ui/command";
import { Separator } from "@/components/ui/separator";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { useToast } from "@/hooks/use-toast";
import { useCompany } from "@/contexts/CompanyContext";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import {
  ArrowLeft, Plus, Loader2, Wallet, RefreshCw, Trash2, ChevronsRight,
  Clock, ShieldCheck, XCircle, CheckCircle, Upload, Scan, Check,
  AlertTriangle, FileText, ChevronRight, History, ChevronsUpDown, User, Search,
  Sparkles, AlertCircle,
} from "lucide-react";
import { cn } from "@/lib/utils";

const idr = (n: number) =>
  new Intl.NumberFormat("id-ID", { style: "currency", currency: "IDR", maximumFractionDigits: 0 }).format(n);
const fmtIDR = (raw: string) => {
  const d = raw.replace(/\D/g, "");
  return d ? Number(d).toLocaleString("id-ID") : "";
};
const parseIDR = (v: string) => { const n = Number(v.replace(/\D/g, "")); return isNaN(n) ? 0 : n; };

const STATUS_COLORS: Record<string, string> = {
  active:           "bg-sky-900/40 text-sky-300 border-sky-600",
  partial:          "bg-amber-900/40 text-amber-300 border-amber-600",
  repaid:           "bg-emerald-900/40 text-emerald-300 border-emerald-600",
  accounted:        "bg-teal-900/40 text-teal-300 border-teal-600",
  pending_approval: "bg-violet-900/40 text-violet-300 border-violet-600",
  rejected:         "bg-red-900/40 text-red-300 border-red-600",
  void:             "bg-gray-900/40 text-gray-300 border-gray-600",
};
const STATUS_LABELS: Record<string, string> = {
  active:           "Aktif",
  partial:          "Sebagian",
  repaid:           "Lunas",
  accounted:        "Dipertanggungjawabkan",
  pending_approval: "Menunggu Approval",
  rejected:         "Ditolak",
  void:             "Void",
};

const CATEGORIES = [
  { value: "Makan & Minum", label: "🍱 Makan & Minum" },
  { value: "Office Supplies", label: "📦 Office Supplies" },
  { value: "Transport", label: "🚗 Transport" },
  { value: "Komunikasi", label: "📱 Komunikasi" },
  { value: "Utilitas", label: "💡 Utilitas" },
  { value: "Lainnya", label: "📋 Lainnya" },
];

// ── Timeline Steps ─────────────────────────────────────────────────────────────
interface TimelineStep { label: string; done: boolean; active: boolean; failed?: boolean; }

function getTimeline(status: string): TimelineStep[] {
  const steps = [
    { label: "Dibuat", key: ["active", "pending_approval", "partial", "repaid", "rejected"] },
    { label: "Disetujui", key: ["active", "partial", "repaid"] },
    { label: "Sebagian", key: ["partial", "repaid"] },
    { label: "Lunas", key: ["repaid"] },
  ];
  return steps.map((s, i) => ({
    label: s.label,
    done: s.key.includes(status),
    active: i === steps.findIndex((x) => !x.key.includes(status)) - 1 || (status === "repaid" && i === steps.length - 1),
    failed: status === "rejected" && i === 0,
  }));
}

function StatusTimeline({ status }: { status: string }) {
  if (status === "rejected") {
    return (
      <div className="flex items-center gap-2 text-sm text-red-400">
        <XCircle size={14} /> Kasbon Ditolak
      </div>
    );
  }
  if (status === "void") {
    return (
      <div className="flex items-center gap-2 text-sm text-gray-400">
        <XCircle size={14} /> Kasbon Di-void (jurnal pembalik telah diposting)
      </div>
    );
  }
  if (status === "accounted") {
    return (
      <div className="flex items-center gap-2 text-sm text-teal-400">
        <Check size={14} /> Kasbon selesai dipertanggungjawabkan (reklas ke Beban)
      </div>
    );
  }
  const steps = getTimeline(status);
  return (
    <div className="flex items-center gap-1 text-xs flex-wrap">
      {steps.map((s, i) => (
        <div key={i} className="flex items-center gap-1">
          <div className={cn(
            "flex items-center gap-1 px-2 py-1 rounded-full border",
            s.done ? "bg-emerald-900/40 text-emerald-300 border-emerald-700" : "bg-muted/30 text-muted-foreground border-border",
            s.active && !s.done ? "border-amber-600 text-amber-300" : "",
          )}>
            {s.done ? <Check size={10} /> : <div className="w-2 h-2 rounded-full bg-current opacity-50" />}
            {s.label}
          </div>
          {i < steps.length - 1 && <ChevronRight size={10} className="text-muted-foreground" />}
        </div>
      ))}
    </div>
  );
}

// ── OCR Confidence Badge ───────────────────────────────────────────────────────
function ConfidenceBadge({ confidence }: { confidence: string }) {
  if (confidence === "high") return <Badge className="text-xs border bg-emerald-900/40 text-emerald-300 border-emerald-700">OCR: Akurat</Badge>;
  if (confidence === "medium") return <Badge className="text-xs border bg-amber-900/40 text-amber-300 border-amber-700">OCR: Perlu Cek</Badge>;
  return <Badge className="text-xs border bg-red-900/40 text-red-300 border-red-700">OCR: Rendah</Badge>;
}

// Repayment / upload-receipt is only valid once cash has actually moved
// (disbursed/outstanding/partially_settled in the unified state machine).
// Legacy rows created before the migration may lack `lifecycleStatus`
// entirely — fall back to the legacy `active`/`partial` status for those.
function isDisbursedStatus(row: any): boolean {
  if (row?.lifecycleStatus) {
    return ["disbursed", "outstanding", "partially_settled"].includes(row.lifecycleStatus);
  }
  return row?.status === "active" || row?.status === "partial";
}

async function apiFetch(url: string, opts?: RequestInit) {
  const r = await fetch(url, { credentials: "include", ...opts });
  const d = await r.json();
  if (!r.ok) throw new Error(d.message ?? "Terjadi kesalahan.");
  return d;
}

export default function KasbonPage() {
  const { toast } = useToast();
  const qc = useQueryClient();
  const { activeCompanyId, isConsolidated } = useCompany();
  const cq = !isConsolidated && activeCompanyId ? `?company=${activeCompanyId}` : "";

  const { data: list = [], isLoading, refetch } = useQuery({
    queryKey: ["advances", "kasbon", activeCompanyId],
    queryFn: () => apiFetch(`/api/advances?type=employee_kasbon${!isConsolidated && activeCompanyId ? `&company=${activeCompanyId}` : ""}`).then((r) => r.data ?? r),
  });
  const { data: paymentAccounts = [] } = useQuery({
    queryKey: ["expense-payment-accounts", activeCompanyId],
    queryFn: () => apiFetch(`/api/expenses/payment-accounts${!isConsolidated && activeCompanyId ? `?company=${activeCompanyId}` : ""}`),
  });
  const { data: userList = [] } = useQuery<any[]>({
    queryKey: ["expense-approvals-users"],
    queryFn: () => apiFetch("/api/expense-approvals/users"),
  });
  const { data: expenseAccounts = [] } = useQuery<any[]>({
    queryKey: ["advance-expense-accounts"],
    queryFn: () => apiFetch("/api/advances/expense-accounts"),
  });

  const [selected, setSelected] = useState<any | null>(null);
  const [detail, setDetail] = useState<any | null>(null);

  // Unified /api/advances/:id detail response is a superset of the list row
  // shape (serializeAdv + settlements/repayments/approvalRequest), so it's
  // safe to also refresh `selected` from it after every lifecycle action —
  // this keeps status/lifecycleStatus-gated UI in sync without needing each
  // mutation response to carry the full advance row (Sprint 2B: PATCH
  // approve/reject/disburse and POST void/repay only return minimal payloads).
  const fetchDetail = useCallback(async (id: number) => {
    const d = await apiFetch(`/api/advances/${id}${cq}`);
    setDetail(d);
    setSelected(d);
    return d;
  }, [cq]);

  const openDetail = async (row: any) => {
    setSelected(row);
    setInlineOcrResult(null);
    await fetchDetail(row.id);
  };

  // ── Create form ──────────────────────────────────────────────────────────────
  const today = new Date().toISOString().slice(0, 10);
  const [showForm, setShowForm] = useState(false);
  const [partyName, setPartyName] = useState("");
  const [selectedUserId, setSelectedUserId] = useState<string>("");
  const [userSearchOpen, setUserSearchOpen] = useState(false);
  const [userSearch, setUserSearch] = useState("");
  const [amountRaw, setAmountRaw] = useState("");
  const [pm, setPm] = useState("bank");
  const [sourceAccountId, setSourceAccountId] = useState("");
  const [date, setDate] = useState(today);
  const [notes, setNotes] = useState("");
  const [category, setCategory] = useState("");

  // OCR scan saat buat kasbon baru
  const createOcrInputRef = useRef<HTMLInputElement>(null);
  const [createOcrLoading, setCreateOcrLoading] = useState(false);
  const [createOcrResult, setCreateOcrResult] = useState<{
    amount: number | null; date: string | null; partyName: string | null; confidence: string;
  } | null>(null);

  const handleCreateOcrScan = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const ext = file.name.split(".").pop()?.toLowerCase() ?? "";
    if (!["jpg", "jpeg", "png", "webp"].includes(ext)) {
      toast({ title: "Gunakan gambar (JPG/PNG) untuk scan OCR.", variant: "destructive" });
      return;
    }
    setCreateOcrLoading(true);
    setCreateOcrResult(null);
    try {
      const fd = new FormData();
      fd.append("file", file);
      const r = await fetch("/api/advances/ocr-preview", { method: "POST", credentials: "include", body: fd });
      const data = await r.json();
      setCreateOcrResult({ amount: data.amount ?? null, date: data.date ?? null, partyName: data.partyName ?? null, confidence: data.confidence ?? "low" });
      if (data.amount && data.amount > 0 && !amountRaw) setAmountRaw(fmtIDR(String(data.amount)));
      if (data.date && !date) setDate(data.date);
    } catch {
      toast({ title: "Scan OCR gagal — isi nominal manual.", variant: "destructive" });
    } finally {
      setCreateOcrLoading(false);
      if (createOcrInputRef.current) createOcrInputRef.current.value = "";
    }
  };

  const createMut = useMutation({
    mutationFn: (body: object) => apiFetch(`/api/advances${cq}`, {
      method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body),
    }),
    onSuccess: (d) => {
      if (d.needsApproval) {
        toast({ title: `⏳ ${d.advanceNumber} — menunggu approval`, description: "Dana belum dicairkan, jurnal belum diposting." });
      } else {
        toast({ title: `✓ ${d.advanceNumber} — ${idr(Number(d.amount))} berhasil dibuat.` });
      }
      qc.invalidateQueries({ queryKey: ["advances", "kasbon"] });
      setShowForm(false); setPartyName(""); setSelectedUserId(""); setUserSearch(""); setAmountRaw(""); setNotes(""); setDate(today); setSourceAccountId(""); setCategory(""); setCreateOcrResult(null);
    },
    onError: (e: Error) => toast({ title: e.message, variant: "destructive" }),
  });

  const handleCreate = () => {
    const amount = parseIDR(amountRaw);
    if (isConsolidated || !activeCompanyId) { toast({ title: "Pilih perusahaan terlebih dahulu.", description: "Kasbon tidak bisa dibuat tanpa memilih perusahaan aktif terlebih dahulu.", variant: "destructive" }); return; }
    if (!partyName.trim()) { toast({ title: "Karyawan wajib dipilih.", variant: "destructive" }); return; }
    if (amount <= 0) { toast({ title: "Nominal harus lebih dari 0.", variant: "destructive" }); return; }
    createMut.mutate({
      advance_type: "EMPLOYEE", party_name: partyName, amount, payment_method: pm, date, notes, category: category || undefined,
      cash_bank_account_id: sourceAccountId ? Number(sourceAccountId) : undefined,
      user_id: selectedUserId || undefined,
    });
  };

  // filtered users for combobox
  const filteredUsers = (userList as any[]).filter((u) =>
    !userSearch || (u.name ?? "").toLowerCase().includes(userSearch.toLowerCase()) ||
    (u.email ?? "").toLowerCase().includes(userSearch.toLowerCase())
  ).slice(0, 50);

  // ── Approve / Reject ─────────────────────────────────────────────────────────
  const [showRejectDialog, setShowRejectDialog] = useState(false);
  const [rejectReason, setRejectReason] = useState("");

  const approveMut = useMutation({
    mutationFn: (id: number) => apiFetch(`/api/advances/${id}/approve${cq}`, { method: "PATCH" }),
    onSuccess: async () => {
      toast({ title: `✅ Kasbon disetujui.`, description: `Dana belum dicairkan — klik "Cairkan Dana" untuk memposting jurnal.` });
      qc.invalidateQueries({ queryKey: ["advances", "kasbon"] });
      if (selected) await fetchDetail(selected.id);
    },
    onError: (e: Error) => toast({ title: e.message, variant: "destructive" }),
  });

  const disburseMut = useMutation({
    mutationFn: (id: number) => apiFetch(`/api/advances/${id}/disburse${cq}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({}) }),
    onSuccess: async () => {
      toast({ title: `✅ Dana dicairkan — jurnal DR/CR telah diposting.` });
      qc.invalidateQueries({ queryKey: ["advances", "kasbon"] });
      if (selected) await fetchDetail(selected.id);
    },
    onError: (e: Error) => toast({ title: e.message, variant: "destructive" }),
  });

  const rejectMut = useMutation({
    mutationFn: ({ id, reason }: { id: number; reason: string }) =>
      apiFetch(`/api/advances/${id}/reject${cq}`, {
        method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ reason }),
      }),
    onSuccess: async () => {
      toast({ title: `Kasbon ditolak.` });
      qc.invalidateQueries({ queryKey: ["advances", "kasbon"] });
      if (selected) await fetchDetail(selected.id);
      setShowRejectDialog(false); setRejectReason("");
    },
    onError: (e: Error) => toast({ title: e.message, variant: "destructive" }),
  });

  // ── Upload Receipt + OCR ─────────────────────────────────────────────────────
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [uploadingReceipt, setUploadingReceipt] = useState(false);
  const [inlineOcrResult, setInlineOcrResult] = useState<{
    amount: number | null; date: string | null; partyName: string | null; description: string | null; bankInfo?: string | null; confidence: string;
  } | null>(null);

  const handleUploadReceipt = async (e: React.ChangeEvent<HTMLInputElement>) => {
    if (!selected || !e.target.files?.[0]) return;
    const file = e.target.files[0];
    setUploadingReceipt(true);
    setInlineOcrResult(null);
    try {
      const formData = new FormData();
      formData.append("receipt", file);
      const r = await fetch(`/api/advances/${selected.id}/upload-receipt`, {
        method: "POST",
        credentials: "include",
        body: formData,
      });
      const d = await r.json();
      if (!r.ok) throw new Error(d.message ?? "Upload gagal");

      const ocr = d.ocr ?? {};
      setInlineOcrResult(ocr);

      // Auto-fill cicilan form jika confidence high dan form masih kosong
      if (ocr.confidence === "high") {
        if (ocr.amount && !repAmtRaw) setRepAmtRaw(fmtIDR(String(ocr.amount)));
        if (ocr.date && !repDate) setRepDate(ocr.date);
        if (ocr.description && !repNotes) setRepNotes(ocr.description);
        toast({ title: "✦ OCR selesai — form cicilan telah diisi otomatis. Periksa sebelum submit." });
      } else {
        toast({ title: "Receipt diupload. Klik 'Pakai nilai ini' untuk mengisi form." });
      }

      await fetchDetail(selected.id);
      qc.invalidateQueries({ queryKey: ["advances", "kasbon"] });
    } catch (err: any) {
      toast({ title: err.message ?? "Upload gagal", variant: "destructive" });
    } finally {
      setUploadingReceipt(false);
      if (fileInputRef.current) fileInputRef.current.value = "";
    }
  };

  const applyOcrToForm = (ocr: typeof inlineOcrResult) => {
    if (!ocr) return;
    if (ocr.amount) setRepAmtRaw(fmtIDR(String(ocr.amount)));
    if (ocr.date) setRepDate(ocr.date);
    if (ocr.description) setRepNotes(ocr.description);
    toast({ title: "Data OCR diterapkan ke form cicilan." });
  };

  // ── Repay form ───────────────────────────────────────────────────────────────
  const [repAmtRaw, setRepAmtRaw] = useState("");
  const [repPm, setRepPm] = useState("bank");
  const [repSourceAccountId, setRepSourceAccountId] = useState("");
  const [repDate, setRepDate] = useState(today);
  const [repNotes, setRepNotes] = useState("");

  const repayMut = useMutation({
    mutationFn: ({ id, body }: { id: number; body: object }) =>
      apiFetch(`/api/advances/${id}/repay${cq}`, {
        method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body),
      }),
    onSuccess: async (d: any, variables) => {
      const amt = (variables.body as any).amount;
      toast({ title: `✓ Cicilan ${idr(amt)} berhasil dicatat.`, description: `Sisa piutang: ${idr(Number(d.remaining_amount))}` });
      qc.invalidateQueries({ queryKey: ["advances", "kasbon"] });
      setRepAmtRaw(""); setRepNotes(""); setRepDate(today); setRepSourceAccountId("");
      if (selected) await fetchDetail(selected.id);
    },
    onError: (e: Error) => toast({ title: e.message, variant: "destructive" }),
  });

  const handleRepay = () => {
    if (!selected) return;
    const amount = parseIDR(repAmtRaw);
    if (amount <= 0) { toast({ title: "Nominal cicilan harus lebih dari 0.", variant: "destructive" }); return; }
    if (!repSourceAccountId) { toast({ title: "Pilih akun sumber dana terlebih dahulu.", variant: "destructive" }); return; }
    repayMut.mutate({
      id: selected.id,
      body: { amount, payment_method: repPm, date: repDate, notes: repNotes, source_account_id: Number(repSourceAccountId) },
    });
  };

  // ── Settle-to-expense (Pertanggungjawaban, no cash movement) ──────────────────
  const [settleExpenseAccountId, setSettleExpenseAccountId] = useState("");
  const [settleAmtRaw, setSettleAmtRaw] = useState("");
  const [settleDate, setSettleDate] = useState(today);
  const [settleNotes, setSettleNotes] = useState("");

  const settleExpenseMut = useMutation({
    mutationFn: ({ id, body }: { id: number; body: object }) =>
      apiFetch(`/api/advances/${id}/settle-expense${cq}`, {
        method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body),
      }),
    onSuccess: async () => {
      toast({ title: "✓ Kasbon ditutup sebagai beban.", description: "Jurnal reklasifikasi telah diposting." });
      qc.invalidateQueries({ queryKey: ["advances", "kasbon"] });
      setSettleAmtRaw(""); setSettleNotes(""); setSettleDate(today); setSettleExpenseAccountId("");
      if (selected) await fetchDetail(selected.id);
    },
    onError: (e: Error) => toast({ title: e.message, variant: "destructive" }),
  });

  const handleSettleExpense = () => {
    if (!selected) return;
    const amount = parseIDR(settleAmtRaw);
    if (amount <= 0) { toast({ title: "Nominal harus lebih dari 0.", variant: "destructive" }); return; }
    if (!settleExpenseAccountId) { toast({ title: "Pilih akun beban terlebih dahulu.", variant: "destructive" }); return; }
    settleExpenseMut.mutate({
      id: selected.id,
      body: { amount, date: settleDate, notes: settleNotes, expense_account_id: Number(settleExpenseAccountId) },
    });
  };

  // ── Delete ───────────────────────────────────────────────────────────────────
  const deleteMut = useMutation({
    mutationFn: (id: number) => apiFetch(`/api/advances/${id}${cq}`, { method: "DELETE" }),
    onSuccess: () => {
      toast({ title: "Kasbon dihapus." });
      qc.invalidateQueries({ queryKey: ["advances", "kasbon"] });
      setSelected(null); setDetail(null);
    },
    onError: (e: Error) => toast({ title: e.message, variant: "destructive" }),
  });

  // ── Void (jurnal sudah posted — buat jurnal pembalik, bukan hapus) ────────────
  const voidMut = useMutation({
    mutationFn: ({ id, reason }: { id: number; reason?: string }) =>
      apiFetch(`/api/advances/${id}/void${cq}`, {
        method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ reason }),
      }),
    onSuccess: async () => {
      toast({ title: "Kasbon di-void — jurnal pembalik telah diposting." });
      qc.invalidateQueries({ queryKey: ["advances", "kasbon"] });
      if (selected) await fetchDetail(selected.id);
    },
    onError: (e: Error) => toast({ title: e.message, variant: "destructive" }),
  });

  const pendingCount = (list as any[]).filter((r: any) => r.status === "pending_approval").length;

  const [listSearch, setListSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState("all");
  const filteredList = (list as any[]).filter((row: any) => {
    if (statusFilter === "outstanding") {
      if (!["active", "partial"].includes(row.status)) return false;
    } else if (statusFilter !== "all" && row.status !== statusFilter) {
      return false;
    }
    if (listSearch) {
      const q = listSearch.toLowerCase();
      const hay = [
        row.party_name ?? row.partyName, row.user?.name, row.advance_number ?? row.advanceNumber, row.category,
      ].filter(Boolean).join(" ").toLowerCase();
      if (!hay.includes(q)) return false;
    }
    return true;
  });

  return (
    <AppShell>
      <div className="p-6 space-y-5 max-w-5xl mx-auto">
        {/* Header */}
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
          <div className="flex items-center gap-3 min-w-0">
            <Link href="/expense/dana-karyawan">
              <Button variant="ghost" size="icon" className="h-8 w-8 shrink-0"><ArrowLeft size={15} /></Button>
            </Link>
            <div className="flex items-center gap-2 min-w-0">
              <Wallet size={20} className="text-amber-400 shrink-0" />
              <div className="min-w-0">
                <h1 className="text-xl font-bold truncate">Kasbon Karyawan</h1>
                <p className="text-sm text-muted-foreground truncate">DR Piutang Karyawan · CR Kas/Bank</p>
              </div>
            </div>
            {pendingCount > 0 && (
              <Link href="/expense/approvals" className="shrink-0">
                <Badge className="bg-violet-900/40 text-violet-300 border-violet-600 border cursor-pointer hover:bg-violet-900/60 whitespace-nowrap">
                  <Clock size={11} className="mr-1" />{pendingCount} menunggu approval
                </Badge>
              </Link>
            )}
          </div>
          <div className="flex items-center gap-2 shrink-0 sm:self-auto self-end">
            <Button variant="outline" size="sm" onClick={() => refetch()}>
              <RefreshCw size={13} className="mr-1" /> Refresh
            </Button>
            <Button size="sm" onClick={() => setShowForm(!showForm)}>
              <Plus size={14} className="mr-1" /> Buat Kasbon
            </Button>
          </div>
        </div>

        {/* Konsolidasi: link ke Dana Karyawan hub */}
        <div className="flex gap-2.5 rounded-lg border border-amber-200 bg-amber-50 px-4 py-2.5 items-center">
          <AlertTriangle className="h-4 w-4 text-amber-500 shrink-0" />
          <p className="text-xs text-amber-800 flex-1">
            Halaman ini adalah bagian dari modul <strong>Dana Karyawan</strong>.
            Kelola semua kasbon & talangan karyawan dari satu tempat.
          </p>
          <Link href="/expense/dana-karyawan">
            <Button variant="outline" size="sm" className="text-xs h-7 border-amber-300 text-amber-700 hover:bg-amber-100 shrink-0 gap-1">
              <ChevronRight size={12} /> Dana Karyawan
            </Button>
          </Link>
        </div>

        {/* Create Form */}
        {showForm && (
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-sm text-muted-foreground">Form Kasbon Baru</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">

              {/* ── Scan Struk OCR (opsional, isi nominal otomatis) ────── */}
              <div className="rounded-lg border border-dashed border-violet-500/40 bg-violet-900/10 px-4 py-3 space-y-2">
                <p className="text-xs font-medium text-violet-300 flex items-center gap-1.5">
                  <Sparkles size={12} /> Scan Struk / Bukti Belanja (Opsional)
                </p>
                <p className="text-xs text-muted-foreground">Upload gambar struk — AI akan membaca nominal & tanggal secara otomatis.</p>
                <input ref={createOcrInputRef} type="file" accept=".jpg,.jpeg,.png,.webp" className="hidden" onChange={handleCreateOcrScan} />
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  className="border-violet-600 text-violet-300 hover:bg-violet-900/30"
                  onClick={() => createOcrInputRef.current?.click()}
                  disabled={createOcrLoading}
                >
                  {createOcrLoading
                    ? <><Loader2 size={12} className="mr-1 animate-spin" />AI sedang membaca…</>
                    : <><Sparkles size={12} className="mr-1" />Pilih Gambar Struk</>}
                </Button>
                {createOcrResult && !createOcrLoading && (
                  <div className={cn(
                    "rounded px-2.5 py-2 text-[10px] space-y-0.5 border",
                    createOcrResult.confidence === "high"
                      ? "bg-emerald-900/20 border-emerald-600/30 text-emerald-300"
                      : createOcrResult.confidence === "medium"
                      ? "bg-amber-900/20 border-amber-600/30 text-amber-300"
                      : "bg-muted/30 border-border text-muted-foreground"
                  )}>
                    <p className="flex items-center gap-1 font-medium">
                      <Sparkles size={9} /> Hasil OCR AI
                      <span className="ml-1 opacity-70">
                        ({createOcrResult.confidence === "high" ? "akurasi tinggi" : createOcrResult.confidence === "medium" ? "akurasi sedang" : "akurasi rendah"})
                      </span>
                    </p>
                    {createOcrResult.amount
                      ? <p>Nominal terdeteksi: <strong className="font-mono">{idr(createOcrResult.amount)}</strong>
                          {parseIDR(amountRaw) === createOcrResult.amount
                            ? <span className="ml-1 opacity-60">✓ sudah diisi</span>
                            : <button className="ml-1.5 underline hover:no-underline" onClick={() => setAmountRaw(fmtIDR(String(createOcrResult!.amount!)))}>→ pakai nilai ini</button>}
                        </p>
                      : <p className="flex items-center gap-1"><AlertCircle size={9} />Nominal tidak terdeteksi — isi manual.</p>}
                    {createOcrResult.date && (
                      <p>Tanggal: <strong>{createOcrResult.date}</strong>
                        {date !== createOcrResult.date
                          ? <button className="ml-1.5 underline hover:no-underline" onClick={() => setDate(createOcrResult!.date!)}>→ pakai tanggal ini</button>
                          : <span className="ml-1 opacity-60">✓ sudah diisi</span>}
                      </p>
                    )}
                    {createOcrResult.partyName && <p>Vendor/Toko: {createOcrResult.partyName}</p>}
                  </div>
                )}
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div className="space-y-1.5">
                  <Label>Karyawan <span className="text-destructive">*</span></Label>
                  <Popover open={userSearchOpen} onOpenChange={setUserSearchOpen}>
                    <PopoverTrigger asChild>
                      <Button
                        variant="outline"
                        role="combobox"
                        className={cn("w-full justify-between font-normal", !partyName && "text-muted-foreground")}
                      >
                        <span className="flex items-center gap-2 truncate">
                          <User size={13} className="shrink-0 text-muted-foreground" />
                          {partyName || "Pilih karyawan..."}
                        </span>
                        <ChevronsUpDown size={13} className="shrink-0 text-muted-foreground" />
                      </Button>
                    </PopoverTrigger>
                    <PopoverContent className="w-72 p-0" align="start">
                      <Command>
                        <CommandInput
                          placeholder="Cari nama atau email..."
                          value={userSearch}
                          onValueChange={setUserSearch}
                        />
                        <CommandList className="max-h-52">
                          <CommandEmpty>
                            {userSearch ? (
                              <div className="p-2 text-center">
                                <p className="text-xs text-muted-foreground mb-2">Karyawan tidak ditemukan.</p>
                                <Button
                                  size="sm"
                                  variant="outline"
                                  className="text-xs"
                                  onClick={() => {
                                    setPartyName(userSearch);
                                    setSelectedUserId("");
                                    setUserSearchOpen(false);
                                  }}
                                >
                                  Gunakan "{userSearch}" sebagai nama
                                </Button>
                              </div>
                            ) : "Tidak ada karyawan."}
                          </CommandEmpty>
                          {filteredUsers.map((u: any) => (
                            <CommandItem
                              key={u.id}
                              value={u.name}
                              onSelect={() => {
                                setPartyName(u.name ?? "");
                                setSelectedUserId(String(u.id));
                                setUserSearchOpen(false);
                                setUserSearch("");
                              }}
                            >
                              <div className="flex flex-col min-w-0">
                                <span className="font-medium text-sm truncate">{u.name}</span>
                                <span className="text-xs text-muted-foreground truncate">
                                  {u.email}
                                  {u.departmentName ? ` · ${u.departmentName}` : ""}
                                  {u.divisionName ? ` · ${u.divisionName}` : ""}
                                </span>
                              </div>
                              {selectedUserId === String(u.id) && (
                                <Check size={13} className="ml-auto text-primary shrink-0" />
                              )}
                            </CommandItem>
                          ))}
                        </CommandList>
                      </Command>
                    </PopoverContent>
                  </Popover>
                  {partyName && !selectedUserId && (
                    <p className="text-xs text-amber-400 flex items-center gap-1">
                      <AlertTriangle size={11} /> Input manual (bukan dari sistem)
                    </p>
                  )}
                  <Select
                    value={selectedUserId}
                    onValueChange={(v) => {
                      setSelectedUserId(v);
                      const u = (userList as any[]).find((u: any) => u.id === v);
                      if (u) setPartyName(u.name ?? "");
                    }}
                  >
                    <SelectTrigger><SelectValue placeholder="Pilih karyawan..." /></SelectTrigger>
                    <SelectContent>
                      {(userList as any[]).map((u: any) => (
                        <SelectItem key={u.id} value={u.id}>{u.name}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <Input placeholder="Atau ketik nama manual..." value={partyName} onChange={(e) => setPartyName(e.target.value)} className="text-xs" />
                </div>
                <div className="space-y-1.5">
                  <Label>Tanggal <span className="text-destructive">*</span></Label>
                  <DatePicker value={date} onChange={(v) => setDate(v)} />
                </div>
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div className="space-y-1.5">
                  <Label>Nominal (IDR) <span className="text-destructive">*</span></Label>
                  <Input placeholder="0" className="font-mono" value={amountRaw} onChange={(e) => setAmountRaw(fmtIDR(e.target.value))} />
                </div>
                <div className="space-y-1.5">
                  <Label>Kategori</Label>
                  <Select value={category || "__none__"} onValueChange={(v) => setCategory(v === "__none__" ? "" : v)}>
                    <SelectTrigger><SelectValue placeholder="Pilih kategori..." /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="__none__">— Tanpa Kategori —</SelectItem>
                      {CATEGORIES.map((c) => (
                        <SelectItem key={c.value} value={c.value}>{c.label}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              </div>
              <div className="space-y-1.5">
                <Label>Sumber Dana <span className="text-destructive">*</span> <span className="text-muted-foreground font-normal text-xs">(Akun COA)</span></Label>
                <SearchableSelect
                  placeholder="Pilih akun COA kas/bank..."
                  searchPlaceholder="Cari kode atau nama akun COA..."
                  emptyText="Akun tidak ditemukan. Pastikan akun Kas/Bank sudah ada di COA."
                  value={sourceAccountId || "__none__"}
                  onValueChange={(v) => {
                    const val = v === "__none__" ? "" : v;
                    setSourceAccountId(val);
                    if (val) {
                      const acc = (paymentAccounts as any[]).find((a: any) => String(a.id) === val);
                      if (acc) setPm(acc.account_class === "kas" ? "cash" : "bank");
                    }
                  }}
                  options={[
                    { value: "__none__", label: "— Default —" },
                    ...(paymentAccounts as any[]).filter((a: any) => a.account_class === "kas").map((a: any) => ({
                      value: String(a.id), label: `${a.code} – ${a.name}`, sublabel: a.code, group: "💵 Kas",
                    })),
                    ...(paymentAccounts as any[]).filter((a: any) => a.account_class === "bank").map((a: any) => ({
                      value: String(a.id), label: `${a.code} – ${a.name}`, sublabel: a.code, group: "🏦 Bank",
                    })),
                  ]}
                />
              </div>
              <div className="space-y-1.5">
                <Label>Keterangan</Label>
                <Textarea rows={2} placeholder="Opsional..." value={notes} onChange={(e) => setNotes(e.target.value)} />
              </div>
              {parseIDR(amountRaw) > 0 && (
                <div className="rounded-md bg-muted/40 border px-4 py-2 text-xs text-muted-foreground">
                  Jurnal: <strong>DR Piutang Karyawan</strong> {idr(parseIDR(amountRaw))} · <strong>CR {
                    sourceAccountId
                      ? ((paymentAccounts as any[]).find((a: any) => String(a.id) === sourceAccountId)?.name ?? (pm === "cash" ? "Kas" : "Bank"))
                      : (pm === "cash" ? "Kas" : "Bank")
                  }</strong> {idr(parseIDR(amountRaw))}
                  <div className="mt-1 text-violet-400">⚡ Jika nominal melebihi limit, akan masuk antrian approval terlebih dahulu.</div>
                </div>
              )}
              <div className="flex gap-2">
                <Button onClick={handleCreate} disabled={createMut.isPending}>
                  {createMut.isPending ? <><Loader2 size={14} className="mr-1 animate-spin" />Menyimpan...</> : "Simpan Kasbon"}
                </Button>
                <Button variant="ghost" onClick={() => { setShowForm(false); setCreateOcrResult(null); }}>Batal</Button>
              </div>
            </CardContent>
          </Card>
        )}

        {/* List */}
        <Card>
          <CardHeader className="pb-3">
            <div className="flex flex-col sm:flex-row gap-2 sm:items-center">
              <div className="relative flex-1 min-w-[200px]">
                <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
                <Input
                  placeholder="Cari nama karyawan, no. kasbon, atau kategori..."
                  className="pl-9 h-9"
                  value={listSearch}
                  onChange={(e) => setListSearch(e.target.value)}
                />
              </div>
              <Select value={statusFilter} onValueChange={setStatusFilter}>
                <SelectTrigger className="h-9 w-full sm:w-[200px]"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">Semua Status</SelectItem>
                  <SelectItem value="outstanding">Outstanding (belum lunas)</SelectItem>
                  <SelectItem value="active">Aktif</SelectItem>
                  <SelectItem value="partial">Sebagian</SelectItem>
                  <SelectItem value="repaid">Lunas</SelectItem>
                  <SelectItem value="pending_approval">Menunggu Approval</SelectItem>
                  <SelectItem value="rejected">Ditolak</SelectItem>
                  <SelectItem value="void">Void</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </CardHeader>
          <CardContent className="p-0">
            <div className="w-full overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>No. Kasbon</TableHead>
                  <TableHead>Tanggal</TableHead>
                  <TableHead>Karyawan</TableHead>
                  <TableHead>Kategori</TableHead>
                  <TableHead className="text-right">Nominal</TableHead>
                  <TableHead className="text-right">Terbayar</TableHead>
                  <TableHead className="text-right">Sisa</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead className="w-8"></TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {isLoading && (
                  <TableRow><TableCell colSpan={9} className="text-center py-10 text-muted-foreground">Memuat...</TableCell></TableRow>
                )}
                {!isLoading && filteredList.length === 0 && (
                  <TableRow><TableCell colSpan={9} className="text-center py-10 text-muted-foreground">
                    {(list as any[]).length === 0 ? "Belum ada kasbon." : "Tidak ada kasbon yang cocok dengan pencarian/filter."}
                  </TableCell></TableRow>
                )}
                {filteredList.map((row: any) => (
                  <TableRow key={row.id} className="cursor-pointer hover:bg-muted/50" onClick={() => openDetail(row)}>
                    <TableCell className="font-mono text-xs text-primary">{row.advance_number ?? row.advanceNumber}</TableCell>
                    <TableCell className="text-sm">{row.date}</TableCell>
                    <TableCell className="text-sm font-medium">{row.party_name ?? row.partyName}</TableCell>
                    <TableCell className="text-sm font-medium">{row.user?.name ?? row.partyName}</TableCell>
                    <TableCell className="text-xs text-muted-foreground">
                      {row.category ? (
                        <Badge variant="outline" className="text-xs font-normal">{row.category}</Badge>
                      ) : <span className="text-muted-foreground/40">—</span>}
                    </TableCell>
                    <TableCell className="text-right font-mono text-sm">{idr(Number(row.amount))}</TableCell>
                    <TableCell className="text-right font-mono text-sm text-emerald-400">
                      {row.status === "pending_approval" ? <span className="text-muted-foreground">—</span> : idr(Number(row.paid_amount ?? row.paidAmount))}
                    </TableCell>
                    <TableCell className="text-right font-mono text-sm text-amber-400">
                      {row.status === "pending_approval" ? <span className="text-muted-foreground">—</span> : idr(Number(row.remaining_amount ?? row.remainingAmount))}
                    </TableCell>
                    <TableCell>
                      <Badge className={cn("text-xs border", STATUS_COLORS[row.status] ?? "")}>
                        {STATUS_LABELS[row.status] ?? row.status}
                      </Badge>
                    </TableCell>
                    <TableCell><ChevronsRight size={14} className="text-muted-foreground" /></TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* ── Detail Sheet ──────────────────────────────────────────────────────── */}
      <Sheet open={!!selected} onOpenChange={(v) => { if (!v) { setSelected(null); setDetail(null); setInlineOcrResult(null); } }}>
        <SheetContent className="w-full sm:w-[460px] md:w-[540px] overflow-y-auto">
          {selected && (
            <>
              <SheetHeader>
                <SheetTitle className="font-mono text-base">{selected.advance_number ?? selected.advanceNumber}</SheetTitle>
                <SheetDescription>{selected.party_name ?? selected.partyName}</SheetDescription>
              </SheetHeader>

              <div className="mt-4 space-y-4">
                {/* Employee info card */}
                {detail?.employee && (
                  <div className="rounded-md border bg-muted/20 px-3 py-2 flex items-start gap-2">
                    <User size={14} className="mt-0.5 text-muted-foreground shrink-0" />
                    <div className="min-w-0">
                      <p className="text-sm font-medium truncate">{detail.employee.name ?? (selected.party_name ?? selected.partyName)}</p>
                      <p className="text-xs text-muted-foreground truncate">{detail.employee.email}</p>
                      {(detail.employee.department || detail.employee.division || detail.employee.section) && (
                        <p className="text-xs text-muted-foreground truncate mt-0.5">
                          {[detail.employee.department, detail.employee.division, detail.employee.section].filter(Boolean).join(" · ")}
                        </p>
                      )}
                    </div>
                  </div>
                )}

                {/* Timeline */}
                <div className="rounded-md bg-muted/20 border px-3 py-2">
                  <StatusTimeline status={selected.status} />
                </div>

                {/* Pending approval banner */}
                {selected.status === "pending_approval" && (
                  <Alert className="border-violet-600 bg-violet-900/20">
                    <Clock size={14} className="text-violet-400" />
                    <AlertDescription className="text-violet-300 text-sm ml-2">
                      Kasbon menunggu approval BD. Dana belum dicairkan, jurnal belum diposting.{" "}
                      <Link href="/expense/approvals" className="underline hover:text-violet-200">Buka Approval →</Link>
                    </AlertDescription>
                  </Alert>
                )}

                {/* Rejected banner */}
                {selected.status === "rejected" && (
                  <Alert className="border-red-600 bg-red-900/20">
                    <XCircle size={14} className="text-red-400" />
                    <AlertDescription className="text-red-300 text-sm ml-2">
                      Kasbon ini ditolak.
                      {(detail?.rejection_reason || detail?.rejectionReason) && ` Alasan: ${detail.rejection_reason ?? detail.rejectionReason}`}
                    </AlertDescription>
                  </Alert>
                )}

                {/* OCR data banner — the unified /api/advances/:id route does not
                    currently project ocr_raw_data (Sprint 2B known gap, see
                    docs/advance-frontend-migration.md); this block silently
                    degrades to hidden rather than breaking. */}
                {(detail?.ocrRawData ?? detail?.ocr_raw_data) && (
                  <div className="rounded-md border border-blue-700 bg-blue-900/20 px-3 py-2 space-y-1">
                    <div className="flex items-center justify-between">
                      <p className="text-xs font-medium flex items-center gap-1 text-blue-300">
                        <Scan size={12} /> Hasil OCR Receipt
                      </p>
                      <ConfidenceBadge confidence={(detail.ocrRawData ?? detail.ocr_raw_data).confidence ?? "low"} />
                    </div>
                    <div className="grid grid-cols-2 gap-1 text-xs text-muted-foreground">
                      {(detail.ocrRawData ?? detail.ocr_raw_data).amount && (
                        <div><span className="text-blue-400">Nominal:</span> {idr((detail.ocrRawData ?? detail.ocr_raw_data).amount)}</div>
                      )}
                      {(detail.ocrRawData ?? detail.ocr_raw_data).date && (
                        <div><span className="text-blue-400">Tanggal:</span> {(detail.ocrRawData ?? detail.ocr_raw_data).date}</div>
                      )}
                      {(detail.ocrRawData ?? detail.ocr_raw_data).partyName && (
                        <div className="col-span-2"><span className="text-blue-400">Vendor:</span> {(detail.ocrRawData ?? detail.ocr_raw_data).partyName}</div>
                      )}
                      {(detail.ocrRawData ?? detail.ocr_raw_data).description && (
                        <div className="col-span-2"><span className="text-blue-400">Deskripsi:</span> {(detail.ocrRawData ?? detail.ocr_raw_data).description}</div>
                      )}
                    </div>
                  </div>
                )}

                {/* Summary */}
                <div className="rounded-lg border bg-muted/30 p-4 space-y-2">
                  <div className="flex justify-between text-sm">
                    <span className="text-muted-foreground">Nominal</span>
                    <span className="font-mono font-semibold">{idr(Number(selected.amount))}</span>
                  </div>
                  {selected.category && (
                    <div className="flex justify-between text-sm">
                      <span className="text-muted-foreground">Kategori</span>
                      <Badge variant="outline" className="text-xs">{selected.category}</Badge>
                    </div>
                  )}
                  {selected.status !== "pending_approval" && (
                    <>
                      <div className="flex justify-between text-sm">
                        <span className="text-muted-foreground">Terbayar</span>
                        <span className="font-mono text-emerald-400">{idr(Number(selected.paid_amount ?? selected.paidAmount))}</span>
                      </div>
                      <Separator />
                      <div className="flex justify-between text-sm font-bold">
                        <span>Sisa Piutang</span>
                        <span className="font-mono text-amber-400">{idr(Number(selected.remaining_amount ?? selected.remainingAmount))}</span>
                      </div>
                    </>
                  )}
                  <div className="flex justify-between text-sm">
                    <span className="text-muted-foreground">Status</span>
                    <Badge className={cn("text-xs border", STATUS_COLORS[selected.status] ?? "")}>
                      {STATUS_LABELS[selected.status] ?? selected.status}
                    </Badge>
                  </div>
                  {(selected.notes || selected.party_name) && (
                    <p className="text-xs text-muted-foreground pt-1">{selected.notes}</p>
                  )}
                </div>

                {/* ── BD Approve / Reject ─────────────────────────────────── */}
                {selected.status === "pending_approval" && (
                  <div className="space-y-2 rounded-lg border border-violet-700 bg-violet-900/10 p-3">
                    <p className="text-sm font-medium flex items-center gap-2 text-violet-300">
                      <ShieldCheck size={14} /> Tindakan BD / Finance
                    </p>
                    <div className="grid grid-cols-2 gap-2">
                      <Button
                        size="sm"
                        className="bg-emerald-700 hover:bg-emerald-600 text-white"
                        onClick={() => approveMut.mutate(selected.id)}
                        disabled={approveMut.isPending}
                      >
                        {approveMut.isPending ? <Loader2 size={13} className="animate-spin mr-1" /> : <CheckCircle size={13} className="mr-1" />}
                        Setujui & Post Jurnal
                      </Button>
                      <Button
                        size="sm"
                        variant="destructive"
                        onClick={() => setShowRejectDialog(true)}
                        disabled={rejectMut.isPending}
                      >
                        <XCircle size={13} className="mr-1" /> Tolak
                      </Button>
                    </div>
                  </div>
                )}

                {/* ── Disburse — separate explicit step after approval in the
                    Unified Advance state machine (approved → disbursed), only
                    then is the DR/CR journal posted. ─────────────────────── */}
                {selected.lifecycleStatus === "approved" && (
                  <div className="space-y-2 rounded-lg border border-sky-700 bg-sky-900/10 p-3">
                    <p className="text-sm font-medium flex items-center gap-2 text-sky-300">
                      <ShieldCheck size={14} /> Kasbon Disetujui — Belum Dicairkan
                    </p>
                    <p className="text-xs text-muted-foreground">Jurnal DR Piutang Karyawan / CR Kas-Bank baru diposting saat dana dicairkan.</p>
                    <Button
                      size="sm"
                      className="w-full bg-sky-700 hover:bg-sky-600 text-white"
                      onClick={() => disburseMut.mutate(selected.id)}
                      disabled={disburseMut.isPending}
                    >
                      {disburseMut.isPending ? <Loader2 size={13} className="animate-spin mr-1" /> : <CheckCircle size={13} className="mr-1" />}
                      Cairkan Dana (Post Jurnal)
                    </Button>
                  </div>
                )}

                {/* Approval trail */}
                {detail?.approvalRequest && (
                  <div className="space-y-2">
                    <p className="text-sm font-medium flex items-center gap-2">
                      <ShieldCheck size={14} className="text-violet-400" /> Alur Approval
                    </p>
                    {detail.approvalRequest.l1_approver_name && (
                      <div className="flex justify-between items-center text-sm rounded border px-3 py-2">
                        <div>
                          <p className="font-medium">L1: {detail.approvalRequest.l1_approver_name}</p>
                          {detail.approvalRequest.l1_notes && (
                            <p className="text-xs text-muted-foreground">{detail.approvalRequest.l1_notes}</p>
                          )}
                        </div>
                        {detail.approvalRequest.l1_status === "approved" ? <CheckCircle size={14} className="text-emerald-400" /> :
                         detail.approvalRequest.l1_status === "rejected" ? <XCircle size={14} className="text-red-400" /> :
                         <Clock size={14} className="text-amber-400" />}
                      </div>
                    )}
                    {detail.approvalRequest.l2_approver_name && (
                      <div className="flex justify-between items-center text-sm rounded border px-3 py-2">
                        <div>
                          <p className="font-medium">L2: {detail.approvalRequest.l2_approver_name}</p>
                          {detail.approvalRequest.l2_notes && (
                            <p className="text-xs text-muted-foreground">{detail.approvalRequest.l2_notes}</p>
                          )}
                        </div>
                        {detail.approvalRequest.l2_status === "approved" ? <CheckCircle size={14} className="text-emerald-400" /> :
                         detail.approvalRequest.l2_status === "rejected" ? <XCircle size={14} className="text-red-400" /> :
                         detail.approvalRequest.l2_status === "skipped" ? <span className="text-xs text-muted-foreground">Skip</span> :
                         <Clock size={14} className="text-amber-400" />}
                      </div>
                    )}
                  </div>
                )}

                {/* Repayment History */}
                {selected.status !== "pending_approval" && selected.status !== "rejected" && (
                  <div>
                    <p className="text-sm font-medium mb-2">Riwayat Pelunasan</p>
                    {!detail?.repayments?.length ? (
                      <p className="text-xs text-muted-foreground">Belum ada cicilan.</p>
                    ) : (
                      <div className="space-y-1">
                        {detail.repayments.map((r: any) => (
                          <div key={r.id} className="flex justify-between items-center rounded border px-3 py-2 text-xs">
                            <div className="text-muted-foreground">
                              {r.date} · {(r.payment_method ?? r.paymentMethod) === "cash" ? "Kas" : "Bank"}
                              {r.notes ? ` · ${r.notes}` : ""}
                            </div>
                            <span className="font-mono text-emerald-400">{idr(Number(r.amount))}</span>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                )}

                {/* ── Upload Receipt + OCR AI ─────────────────────────── */}
                {isDisbursedStatus(selected) && (
                  <div className="border-t pt-4 space-y-2">
                    <p className="text-sm font-medium flex items-center gap-2">
                      <FileText size={14} className="text-blue-400" /> Upload Receipt
                      <span className="flex items-center gap-0.5 text-[10px] text-violet-400 font-normal">
                        <Sparkles size={9} />OCR AI
                      </span>
                    </p>
                    <p className="text-xs text-muted-foreground">Upload struk belanja (JPG/PNG/PDF) — AI akan baca nominal & tanggal otomatis.</p>
                    <input
                      ref={fileInputRef}
                      type="file"
                      accept=".jpg,.jpeg,.png,.pdf,.webp"
                      className="hidden"
                      onChange={handleUploadReceipt}
                    />
                    <Button
                      size="sm"
                      variant="outline"
                      className="w-full border-blue-700 text-blue-300 hover:bg-blue-900/30"
                      onClick={() => fileInputRef.current?.click()}
                      disabled={uploadingReceipt}
                    >
                      {uploadingReceipt
                        ? <><Loader2 size={13} className="mr-1 animate-spin text-violet-400" />AI sedang membaca receipt…</>
                        : detail?.receipt_url
                          ? <><Upload size={13} className="mr-1" />Ganti Receipt</>
                          : <><Sparkles size={13} className="mr-1 text-violet-400" />Pilih File Receipt (OCR AI)</>}
                    </Button>
                    {detail?.receipt_url && (
                      <p className="text-xs text-muted-foreground flex items-center gap-1">
                        <CheckCircle size={11} className="text-emerald-400" />
                        Receipt sudah diupload
                      </p>
                    )}
                    {/* Inline OCR result card */}
                    {inlineOcrResult && !uploadingReceipt && (
                      <div className={cn(
                        "rounded px-2.5 py-2 text-[10px] space-y-1 border",
                        inlineOcrResult.confidence === "high"
                          ? "bg-emerald-900/20 border-emerald-600/30 text-emerald-300"
                          : inlineOcrResult.confidence === "medium"
                          ? "bg-amber-900/20 border-amber-600/30 text-amber-300"
                          : "bg-muted/30 border-border text-muted-foreground"
                      )}>
                        <p className="flex items-center gap-1 font-medium">
                          <Sparkles size={9} />
                          Hasil OCR AI
                          <span className="ml-1 opacity-70">
                            ({inlineOcrResult.confidence === "high" ? "akurasi tinggi" : inlineOcrResult.confidence === "medium" ? "akurasi sedang" : "akurasi rendah"})
                          </span>
                        </p>
                        {inlineOcrResult.amount ? (
                          <p>Nominal: <strong className="font-mono">{idr(inlineOcrResult.amount)}</strong>
                            {parseIDR(repAmtRaw) === inlineOcrResult.amount
                              ? <span className="ml-1 opacity-60">✓ sudah diisi</span>
                              : <button className="ml-1.5 underline hover:no-underline" onClick={() => { setRepAmtRaw(fmtIDR(String(inlineOcrResult.amount!))); toast({ title: "Nominal diisi dari OCR." }); }}>→ pakai nilai ini</button>
                            }
                          </p>
                        ) : <p className="flex items-center gap-1"><AlertCircle size={9} />Nominal tidak terdeteksi — isi manual.</p>}
                        {inlineOcrResult.date && (
                          <p>Tanggal: <strong>{inlineOcrResult.date}</strong>
                            {repDate !== inlineOcrResult.date
                              ? <button className="ml-1.5 underline hover:no-underline" onClick={() => { setRepDate(inlineOcrResult.date!); toast({ title: "Tanggal diisi dari OCR." }); }}>→ pakai tanggal ini</button>
                              : <span className="ml-1 opacity-60">✓ sudah diisi</span>
                            }
                          </p>
                        )}
                        {inlineOcrResult.partyName && <p>Vendor: {inlineOcrResult.partyName}</p>}
                        {inlineOcrResult.description && (
                          <p>Deskripsi: {inlineOcrResult.description}
                            {!repNotes && <button className="ml-1.5 underline hover:no-underline" onClick={() => setRepNotes(inlineOcrResult.description!)}>→ isi keterangan</button>}
                          </p>
                        )}
                        {(inlineOcrResult.amount || inlineOcrResult.date) && parseIDR(repAmtRaw) !== inlineOcrResult.amount && (
                          <button
                            className="mt-0.5 w-full text-center rounded border border-current/30 px-2 py-1 hover:bg-white/5 transition-colors font-medium"
                            onClick={() => applyOcrToForm(inlineOcrResult)}
                          >
                            ↓ Isi semua ke form cicilan
                          </button>
                        )}
                      </div>
                    )}
                  </div>
                )}

                {/* ── Add Repayment ───────────────────────────────────────── */}
                {isDisbursedStatus(selected) && (
                  <div className="space-y-3 border-t pt-4">
                    <p className="text-sm font-medium flex items-center gap-2">
                      <RefreshCw size={14} className="text-primary" />Tambah Cicilan / Reimbursement
                    </p>
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                      <div className="space-y-1.5">
                        <Label className="text-xs">Nominal</Label>
                        <Input placeholder="0" className="font-mono h-8 text-sm" value={repAmtRaw} onChange={(e) => setRepAmtRaw(fmtIDR(e.target.value))} />
                      </div>
                      <div className="space-y-1.5">
                        <Label className="text-xs">Tanggal</Label>
                        <DatePicker value={repDate} onChange={(v) => setRepDate(v)} className="h-8 text-sm" />
                      </div>
                    </div>
                    <div className="space-y-1.5">
                      <Label className="text-xs">Akun Sumber Dana</Label>
                      <SearchableSelect
                        triggerClassName="h-8 text-sm"
                        placeholder="Pilih akun kas/bank..."
                        searchPlaceholder="Cari kode atau nama akun..."
                        emptyText="Akun tidak ditemukan."
                        value={repSourceAccountId}
                        onValueChange={(v) => {
                          setRepSourceAccountId(v);
                          const acc = (paymentAccounts as any[]).find((a) => String(a.id) === v);
                          if (acc) setRepPm(String(acc.type ?? acc.kind ?? "").toLowerCase().includes("cash") ? "cash" : "bank");
                        }}
                        options={(paymentAccounts as any[]).map((a) => ({
                          value: String(a.id),
                          label: `${a.code ? `${a.code} — ` : ""}${a.name}`,
                          sublabel: a.code,
                        }))}
                      />
                    </div>
                    <div className="space-y-1.5">
                      <Label className="text-xs">Keterangan</Label>
                      <Input placeholder="Opsional..." className="h-8 text-sm" value={repNotes} onChange={(e) => setRepNotes(e.target.value)} />
                    </div>
                    {parseIDR(repAmtRaw) > 0 && (
                      <div className="text-xs text-muted-foreground rounded bg-muted/30 px-3 py-1.5">
                        Jurnal: <strong>DR {repPm === "cash" ? "Kas" : "Bank"}</strong> · <strong>CR Piutang Karyawan</strong> {idr(parseIDR(repAmtRaw))}
                      </div>
                    )}
                    <Button size="sm" className="w-full" onClick={handleRepay} disabled={repayMut.isPending}>
                      {repayMut.isPending ? <><Loader2 size={13} className="mr-1 animate-spin" />Menyimpan...</> : "Catat Cicilan"}
                    </Button>
                  </div>
                )}

                {/* ── Pertanggungjawaban (settle-to-expense, no cash movement) ─
                    Reclasses the remaining receivable straight to an expense
                    account (DR Beban / CR Piutang Karyawan) via
                    POST /:id/settle-expense — for when the money was already
                    spent and proven by a receipt, not returned as cash. */}
                {isDisbursedStatus(selected) && (
                  <div className="space-y-3 border-t pt-4">
                    <p className="text-sm font-medium flex items-center gap-2">
                      <FileText size={14} className="text-teal-500" />Pertanggungjawaban (Habis Dibelanjakan)
                    </p>
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                      <div className="space-y-1.5">
                        <Label className="text-xs">Nominal</Label>
                        <Input placeholder="0" className="font-mono h-8 text-sm" value={settleAmtRaw} onChange={(e) => setSettleAmtRaw(fmtIDR(e.target.value))} />
                      </div>
                      <div className="space-y-1.5">
                        <Label className="text-xs">Tanggal</Label>
                        <DatePicker value={settleDate} onChange={(v) => setSettleDate(v)} className="h-8 text-sm" />
                      </div>
                    </div>
                    <div className="space-y-1.5">
                      <Label className="text-xs">Akun Beban</Label>
                      <SearchableSelect
                        triggerClassName="h-8 text-sm"
                        placeholder="Pilih akun beban..."
                        searchPlaceholder="Cari kode atau nama akun..."
                        emptyText="Akun tidak ditemukan."
                        value={settleExpenseAccountId}
                        onValueChange={setSettleExpenseAccountId}
                        options={(expenseAccounts as any[]).map((a) => ({
                          value: String(a.id),
                          label: `${a.code} — ${a.name}`,
                          sublabel: a.code,
                        }))}
                      />
                    </div>
                    <div className="space-y-1.5">
                      <Label className="text-xs">Keterangan</Label>
                      <Input placeholder="Opsional..." className="h-8 text-sm" value={settleNotes} onChange={(e) => setSettleNotes(e.target.value)} />
                    </div>
                    {parseIDR(settleAmtRaw) > 0 && (
                      <div className="text-xs text-muted-foreground rounded bg-muted/30 px-3 py-1.5">
                        Jurnal: <strong>DR Beban</strong> · <strong>CR Piutang Karyawan</strong> {idr(parseIDR(settleAmtRaw))}
                      </div>
                    )}
                    <Button size="sm" variant="secondary" className="w-full" onClick={handleSettleExpense} disabled={settleExpenseMut.isPending}>
                      {settleExpenseMut.isPending ? <><Loader2 size={13} className="mr-1 animate-spin" />Menyimpan...</> : "Tutup sebagai Beban"}
                    </Button>
                  </div>
                )}

                {/* Settlement History */}
                {detail?.settlements?.length > 0 && (
                  <div>
                    <p className="text-sm font-medium mb-2">Riwayat Pertanggungjawaban</p>
                    <div className="space-y-1">
                      {detail.settlements.map((s: any) => (
                        <div key={s.id} className="flex justify-between items-center rounded border px-3 py-2 text-xs">
                          <div className="text-muted-foreground">
                            {s.date}{s.category ? ` · ${s.category}` : ""}{s.notes ? ` · ${s.notes}` : ""}
                          </div>
                          <span className="font-mono text-teal-400">{idr(Number(s.amount))}</span>
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                {/* ── Audit Log ───────────────────────────────────────────── */}
                {detail?.auditLogs?.length > 0 && (
                  <div className="space-y-2 border-t pt-4">
                    <p className="text-sm font-medium flex items-center gap-2 text-muted-foreground">
                      <History size={13} /> Riwayat Aktivitas
                    </p>
                    <div className="space-y-1">
                      {detail.auditLogs.map((log: any, i: number) => (
                        <div key={i} className="flex justify-between text-xs text-muted-foreground rounded border px-2 py-1.5">
                          <span className="font-medium text-foreground/70">{log.action?.replace(/_/g, " ")}</span>
                          <span>{new Date(log.created_at).toLocaleDateString("id-ID", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" })}</span>
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                {/* Delete — hanya jika belum pernah posting jurnal sama sekali */}
                {["pending_approval", "rejected"].includes(selected.status) && !selected.entry_id && !selected.entryId && (
                  <div className="border-t pt-4">
                    <Button variant="destructive" size="sm" className="w-full" onClick={() => deleteMut.mutate(selected.id)} disabled={deleteMut.isPending}>
                      <Trash2 size={13} className="mr-1" /> Hapus Kasbon
                    </Button>
                  </div>
                )}

                {/* Void — jurnal sudah posted (entry_id ada) tapi belum ada cicilan */}
                {selected.status === "active" && (selected.entry_id || selected.entryId) && Number(selected.paid_amount ?? selected.paidAmount) === 0 && (
                  <div className="border-t pt-4 space-y-2">
                    <p className="text-xs text-muted-foreground rounded bg-amber-50 border border-amber-200 px-3 py-2">
                      Kasbon sudah masuk General Ledger. Gunakan Void/Repayment, bukan Delete.
                    </p>
                    <Button
                      variant="destructive"
                      size="sm"
                      className="w-full"
                      onClick={() => {
                        const reason = window.prompt("Alasan void kasbon ini?") ?? undefined;
                        voidMut.mutate({ id: selected.id, reason });
                      }}
                      disabled={voidMut.isPending}
                    >
                      <Trash2 size={13} className="mr-1" /> Void Kasbon (buat jurnal pembalik)
                    </Button>
                  </div>
                )}

                {/* Sudah ada cicilan — tidak bisa void, arahkan ke repayment */}
                {selected.status === "partial" && (
                  <div className="border-t pt-4">
                    <p className="text-xs text-muted-foreground rounded bg-blue-50 border border-blue-200 px-3 py-2">
                      Kasbon ini sudah memiliki cicilan — tidak bisa di-void. Selesaikan melalui pelunasan (Repayment) di atas.
                    </p>
                  </div>
                )}
              </div>
            </>
          )}
        </SheetContent>
      </Sheet>

      {/* ── Reject Dialog ────────────────────────────────────────────────────── */}
      <Dialog open={showRejectDialog} onOpenChange={setShowRejectDialog}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2 text-red-400">
              <AlertTriangle size={16} /> Tolak Kasbon
            </DialogTitle>
          </DialogHeader>
          <div className="space-y-3">
            <p className="text-sm text-muted-foreground">Masukkan alasan penolakan (opsional):</p>
            <Textarea
              rows={3}
              placeholder="Alasan penolakan..."
              value={rejectReason}
              onChange={(e) => setRejectReason(e.target.value)}
            />
          </div>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setShowRejectDialog(false)}>Batal</Button>
            <Button
              variant="destructive"
              onClick={() => selected && rejectMut.mutate({ id: selected.id, reason: rejectReason })}
              disabled={rejectMut.isPending}
            >
              {rejectMut.isPending ? <Loader2 size={13} className="animate-spin mr-1" /> : null}
              Konfirmasi Tolak
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

    </AppShell>
  );
}
