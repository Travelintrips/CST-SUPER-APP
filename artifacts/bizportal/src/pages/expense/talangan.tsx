import { useState, useCallback, useRef, useEffect } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
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
import { Separator } from "@/components/ui/separator";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList, CommandSeparator } from "@/components/ui/command";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { useToast } from "@/hooks/use-toast";
import { useCompany } from "@/contexts/CompanyContext";
import {
  ArrowLeft, Plus, Loader2, HandCoins, RefreshCw, Trash2, ChevronsRight, Search, Check,
  Building2, User, ExternalLink, ChevronDown, X, Sparkles, AlertCircle,
  Clock, ShieldCheck, XCircle, CheckCircle, AlertTriangle, History, FileText,
} from "lucide-react";
import { cn } from "@/lib/utils";

const idr = (n: number) =>
  new Intl.NumberFormat("id-ID", { style: "currency", currency: "IDR", maximumFractionDigits: 0 }).format(n);
const fmtIDR = (raw: string) => { const d = raw.replace(/\D/g, ""); return d ? Number(d).toLocaleString("id-ID") : ""; };
const parseIDR = (v: string) => { const n = Number(v.replace(/\D/g, "")); return isNaN(n) ? 0 : n; };

const FUNDING_SOURCE_LABELS: Record<string, string> = {
  kas_perusahaan: "Kas Perusahaan",
  rekening_bank:  "Rekening Bank",
  perusahaan_lain: "Perusahaan Lain",
  bank:           "Dana Bank",
  pribadi:        "Dana Pribadi",
  pihak_lain:     "Pihak Lain",
};
const FUNDING_SOURCE_COLORS: Record<string, string> = {
  kas_perusahaan:  "bg-emerald-900/40 text-emerald-300 border-emerald-600",
  rekening_bank:   "bg-sky-900/40 text-sky-300 border-sky-600",
  perusahaan_lain: "bg-indigo-900/40 text-indigo-300 border-indigo-600",
  bank:            "bg-blue-900/40 text-blue-300 border-blue-600",
  pribadi:         "bg-violet-900/40 text-violet-300 border-violet-600",
  pihak_lain:      "bg-gray-900/40 text-gray-300 border-gray-600",
};
const RESPONSIBLE_PARTY_LABELS: Record<string, string> = {
  perusahaan_aktif: "Perusahaan Aktif",
  perusahaan_lain:  "Perusahaan Lain",
  bank:             "Bank",
  vendor:           "Vendor",
  karyawan:         "Karyawan/Direksi",
  pihak_lain:       "Pihak Lain",
};

const STATUS_COLORS: Record<string, string> = {
  active:           "bg-sky-900/40 text-sky-300 border-sky-600",
  partial:          "bg-amber-900/40 text-amber-300 border-amber-600",
  repaid:           "bg-emerald-900/40 text-emerald-300 border-emerald-600",
  pending_approval: "bg-violet-900/40 text-violet-300 border-violet-600",
  rejected:         "bg-red-900/40 text-red-300 border-red-600",
  void:             "bg-gray-900/40 text-gray-300 border-gray-600",
};
const STATUS_LABELS: Record<string, string> = {
  active:           "Aktif",
  partial:          "Sebagian",
  repaid:           "Lunas",
  pending_approval: "Menunggu Approval",
  rejected:         "Ditolak",
  void:             "Void",
};

// Repayment is only valid once cash has actually moved (disbursed/outstanding/
// partially_settled in the unified state machine). Legacy rows created before
// the migration may lack `lifecycleStatus` entirely — fall back to the legacy
// `active`/`partial` status for those (mirrors kasbon.tsx, Sprint 2B).
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

export default function TalanganPage() {
  const { toast } = useToast();
  const qc = useQueryClient();
  const { activeCompanyId, isConsolidated } = useCompany();
  const cq = !isConsolidated && activeCompanyId ? `?company=${activeCompanyId}` : "";

  // ── Effective company ID (saat mode konsolidasi, derive dari akun kas/bank yang dipilih) ──
  // Ini memungkinkan pembuatan dana talangan bahkan saat user di mode "Holding Consolidated",
  // selama user memilih akun kas/bank perusahaan spesifik sebagai sumber dana.
  // paymentAccounts harus dimuat dulu (lihat query di bawah) sebelum ini bisa dipakai.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const deriveCompanyIdFromAccount = (accountId: string, accounts: any[]): number | null => {
    if (!accountId) return null;
    const acc = accounts.find((a: any) => String(a.id) === accountId);
    return acc?.company_id ? Number(acc.company_id) : null;
  };

  const { data: list = [], isLoading, refetch } = useQuery({
    queryKey: ["advances", "talangan", activeCompanyId],
    queryFn: () => apiFetch(`/api/advances?type=talangan${!isConsolidated && activeCompanyId ? `&company=${activeCompanyId}` : ""}`).then((r) => r.data ?? r),
  });

  const { data: paymentAccounts = [] } = useQuery({
    queryKey: ["expense-payment-accounts", activeCompanyId, isConsolidated],
    queryFn: () => apiFetch(
      isConsolidated
        ? `/api/expenses/payment-accounts?company=all`
        : activeCompanyId
          ? `/api/expenses/payment-accounts?company=${activeCompanyId}`
          : `/api/expenses/payment-accounts`
    ),
  });

  const { data: intercompanyPayables = [] } = useQuery({
    queryKey: ["advance-intercompany-payables", activeCompanyId],
    queryFn: () => apiFetch(`/api/advances/intercompany-payables${activeCompanyId ? `?company=${activeCompanyId}` : ""}`).then((r) => r.data ?? r),
    enabled: !!activeCompanyId,
    staleTime: 30_000,
  });

  const { data: intercompanyReceivables = [] } = useQuery({
    queryKey: ["advance-intercompany-receivables", activeCompanyId],
    queryFn: () => apiFetch(`/api/advances/intercompany-receivables${activeCompanyId ? `?company=${activeCompanyId}` : ""}`).then((r) => r.data ?? r),
    enabled: !!activeCompanyId,
    staleTime: 30_000,
  });

  const { data: vendorList = [] } = useQuery({
    queryKey: ["suppliers", activeCompanyId],
    queryFn: () => apiFetch(`/api/trading/suppliers${!isConsolidated && activeCompanyId ? `?company=${activeCompanyId}` : ""}&limit=1000`).then((r) => r.data ?? r),
  });

  const { data: userList = [] } = useQuery({
    queryKey: ["users-list", activeCompanyId],
    queryFn: () => apiFetch(`/api/users`),
  });

  const { data: expenseAccounts = [] } = useQuery<any[]>({
    queryKey: ["advance-expense-accounts"],
    queryFn: () => apiFetch("/api/advances/expense-accounts"),
  });

  const { data: companiesList = [] } = useQuery({
    queryKey: ["companies-list"],
    queryFn: () => apiFetch("/api/companies/list").then((r) => r.data ?? r).catch(() => []),
    staleTime: 60_000,
  });

  // Task #3: Cek apakah akun kas/bank default sudah dikonfigurasi di accounting settings
  const { data: accountingSettings } = useQuery({
    queryKey: ["accounting-settings", activeCompanyId],
    queryFn: () => apiFetch(`/api/accounting/settings${!isConsolidated && activeCompanyId ? `?company=${activeCompanyId}` : ""}`).catch(() => null),
    staleTime: 60_000,
    enabled: !isConsolidated && !!activeCompanyId,
  });
  const hasCashAccount = !!(accountingSettings as any)?.defaultCashAccountId;
  const hasBankAccount = !!(accountingSettings as any)?.defaultBankAccountId;
  const hasAnyAccount = hasCashAccount || hasBankAccount;

  const [selected, setSelected] = useState<any | null>(null);
  const [detail, setDetail] = useState<any | null>(null);

  // Unified /api/advances/:id detail response is a superset of the list row
  // shape (serializeAdv + settlements/repayments/approvalRequest) — safe to
  // also refresh `selected` from it after every lifecycle action, mirroring
  // kasbon.tsx (Sprint 2B: approve/reject/disburse/void/repay only return
  // minimal payloads, not the full advance row).
  const fetchDetail = useCallback(async (id: number) => {
    const d = await apiFetch(`/api/advances/${id}${cq}`);
    setDetail(d);
    setSelected(d);
    return d;
  }, [cq]);

  const openDetail = async (row: any) => { setSelected(row); await fetchDetail(row.id); };

  const today = new Date().toISOString().slice(0, 10);
  const [showForm, setShowForm] = useState(false);
  const [partyName, setPartyName] = useState("");
  const [amountRaw, setAmountRaw] = useState("");
  const [pm, setPm] = useState("bank");
  const [sourceAccountId, setSourceAccountId] = useState("");
  const [sourceAccountCompanyId, setSourceAccountCompanyId] = useState<number | null>(null);
  const [vendorId, setVendorId] = useState("");
  const [userId, setUserId] = useState("");
  const [date, setDate] = useState(today);
  const [notes, setNotes] = useState("");

  // ── Kategori Dana Talangan (default + custom dari localStorage) ───────────
  const TALANGAN_CATEGORY_KEY = "talangan_custom_categories";
  const DEFAULT_CATEGORIES = [
    "Operasional", "Pembayaran Vendor", "Pembelian Barang",
    "Freight / Pengiriman", "Customs Clearance", "Pajak",
    "Proyek", "Perjalanan Dinas", "Gaji / Karyawan", "Marketing",
  ];
  const [customCategories, setCustomCategories] = useState<string[]>(() => {
    try { return JSON.parse(localStorage.getItem(TALANGAN_CATEGORY_KEY) ?? "[]"); } catch { return []; }
  });
  const [showAddCategoryDialog, setShowAddCategoryDialog] = useState(false);
  const [newCategoryInput, setNewCategoryInput] = useState("");

  const handleAddCategory = () => {
    const trimmed = newCategoryInput.trim();
    if (!trimmed) return;
    const allExisting = [...DEFAULT_CATEGORIES, ...customCategories].map(c => c.toLowerCase());
    if (allExisting.includes(trimmed.toLowerCase())) {
      setCategory(
        [...DEFAULT_CATEGORIES, ...customCategories].find(c => c.toLowerCase() === trimmed.toLowerCase()) ?? trimmed
      );
      setShowAddCategoryDialog(false);
      setNewCategoryInput("");
      return;
    }
    const updated = [...customCategories, trimmed];
    setCustomCategories(updated);
    localStorage.setItem(TALANGAN_CATEGORY_KEY, JSON.stringify(updated));
    setCategory(trimmed);
    setShowAddCategoryDialog(false);
    setNewCategoryInput("");
  };

  const handleDeleteCustomCategory = (cat: string) => {
    const updated = customCategories.filter(c => c !== cat);
    setCustomCategories(updated);
    localStorage.setItem(TALANGAN_CATEGORY_KEY, JSON.stringify(updated));
    if (category === cat) setCategory("");
  };

  // ── State form baru Dana Talangan ─────────────────────────────────────────
  const [category, setCategory] = useState("");
  const [categoryOther, setCategoryOther] = useState("");
  const [purpose, setPurpose] = useState("");
  // Sumber Dana
  const [fundingSourceType, setFundingSourceType] = useState("");
  const [sourceCompanyId, setSourceCompanyId] = useState("");
  const [sourceCompanyManual, setSourceCompanyManual] = useState("");
  const [sourceBankName, setSourceBankName] = useState("");
  const [sourcePartyName, setSourcePartyName] = useState("");
  // Pihak Bertanggung Jawab
  const [responsibleSelectKey, setResponsibleSelectKey] = useState(""); // value yg tampil di Select
  const [responsiblePartyType, setResponsiblePartyType] = useState("");
  const [responsibleCompanyId, setResponsibleCompanyId] = useState("");
  const [responsibleCompanyManual, setResponsibleCompanyManual] = useState("");
  const [responsibleBankName, setResponsibleBankName] = useState("");
  const [responsibleVendorId, setResponsibleVendorId] = useState("");
  const [responsibleEmployeeId, setResponsibleEmployeeId] = useState("");
  const [responsiblePartyName, setResponsiblePartyName] = useState("");
  const [referenceNumber, setReferenceNumber] = useState("");
  const { data: sourceCompanyAccounts = [] } = useQuery({
    queryKey: ["advance-source-company-accounts", sourceCompanyId],
    queryFn: () => apiFetch(`/api/advances/payer-accounts?company_id=${sourceCompanyId}`),
    enabled: fundingSourceType === "perusahaan_lain" && !!sourceCompanyId,
    staleTime: 60_000,
  });

  const resetFormNewFields = () => {
    setCategory(""); setCategoryOther(""); setPurpose("");
    setFundingSourceType(""); setSourceCompanyId(""); setSourceCompanyManual("");
    setSourceBankName(""); setSourcePartyName(""); setSourceAccountCompanyId(null);
    setResponsibleSelectKey(""); setResponsiblePartyType(""); setResponsibleCompanyId(""); setResponsibleCompanyManual("");
    setResponsibleBankName(""); setResponsibleVendorId(""); setResponsibleEmployeeId("");
    setResponsiblePartyName(""); setReferenceNumber("");
  };

  // combobox state
  const [recipientOpen, setRecipientOpen] = useState(false);
  const [recipientQuery, setRecipientQuery] = useState("");

  // OCR scan saat buat talangan baru
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
    mutationFn: ({ body, companyId }: { body: object; companyId: number }) =>
      apiFetch(`/api/advances?company=${companyId}`, {
        method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body),
      }),
    onSuccess: (d) => {
      if (d.needsApproval) {
        toast({ title: `⏳ ${d.advanceNumber} — menunggu approval`, description: "Dana belum dicairkan, jurnal belum diposting." });
      } else {
        toast({ title: `✓ ${d.advanceNumber} — ${idr(Number(d.amount))} berhasil dibuat.` });
      }
      qc.invalidateQueries({ queryKey: ["advances", "talangan"] });
      setShowForm(false); setPartyName(""); setAmountRaw(""); setNotes(""); setDate(today);
      setSourceAccountId(""); setSourceAccountCompanyId(null); setVendorId(""); setUserId(""); setRecipientQuery(""); setCreateOcrResult(null);
      resetFormNewFields();
    },
    onError: (e: Error) => toast({ title: e.message, variant: "destructive" }),
  });

  const handleCreate = () => {
    const amount = parseIDR(amountRaw);

    // ── Resolve effective company ID ─────────────────────────────────────────
    // Saat mode konsolidasi, coba derive dari akun kas/bank yang dipilih,
    // atau dari sourceCompanyId (jika sumber dana dari perusahaan lain).
    // Jika tidak bisa diderive, blokir dan tampilkan pesan yang jelas.
    let effectiveCompanyId: number | null = null;
    if (!isConsolidated && activeCompanyId) {
      effectiveCompanyId = activeCompanyId as number;
    } else {
      // Mode konsolidasi: gunakan company_id yang sudah di-capture saat user pilih akun
      // (lebih reliable daripada lookup ulang di sini karena paymentAccounts bisa belum loaded)
      if (["kas_perusahaan", "rekening_bank"].includes(fundingSourceType) && sourceAccountId) {
        effectiveCompanyId = sourceAccountCompanyId
          ?? deriveCompanyIdFromAccount(sourceAccountId, paymentAccounts as any[]);
      }
      // Fallback: gunakan sourceCompanyId jika sumber dari perusahaan lain
      if (!effectiveCompanyId && fundingSourceType === "perusahaan_lain" && sourceCompanyId) {
        effectiveCompanyId = Number(sourceCompanyId);
      }
      // Fallback terakhir: gunakan responsibleCompanyId jika penanggung adalah perusahaan internal
      if (!effectiveCompanyId && responsiblePartyType === "perusahaan_lain" && responsibleCompanyId) {
        effectiveCompanyId = Number(responsibleCompanyId);
      }
    }

    if (!effectiveCompanyId) {
      toast({
        title: "Pilih perusahaan terlebih dahulu.",
        description: "Pilih perusahaan aktif dari menu di bagian atas halaman, atau pilih Sumber Dana 'Kas Perusahaan' / 'Rekening Bank' dan pilih akun yang spesifik.",
        variant: "destructive",
      });
      return;
    }
    if (!partyName.trim()) { toast({ title: "Nama pihak penerima wajib diisi.", variant: "destructive" }); return; }
    if (amount <= 0) { toast({ title: "Nominal harus lebih dari 0.", variant: "destructive" }); return; }
    if (!category) { toast({ title: "Kategori dana talangan wajib dipilih.", variant: "destructive" }); return; }
    if (category === "lainnya" && !categoryOther.trim()) { toast({ title: "Kategori Lainnya wajib diisi.", variant: "destructive" }); return; }
    if (!purpose.trim()) { toast({ title: "Tujuan / keperluan wajib diisi.", variant: "destructive" }); return; }
    if (!fundingSourceType) { toast({ title: "Sumber dana wajib dipilih.", variant: "destructive" }); return; }
    if (!responsiblePartyType) { toast({ title: "Pihak yang bertanggung jawab wajib dipilih.", variant: "destructive" }); return; }
    // Validasi field kondisional sumber dana
    if (fundingSourceType === "kas_perusahaan" && !sourceAccountId) { toast({ title: "Pilih akun kas terlebih dahulu.", variant: "destructive" }); return; }
    if (fundingSourceType === "rekening_bank" && !sourceAccountId) { toast({ title: "Pilih rekening bank terlebih dahulu.", variant: "destructive" }); return; }
    if (fundingSourceType === "bank" && !sourceBankName.trim()) { toast({ title: "Nama bank wajib diisi.", variant: "destructive" }); return; }
    if (fundingSourceType === "perusahaan_lain" && !sourceCompanyId && !sourceCompanyManual.trim()) { toast({ title: "Pilih atau isi nama perusahaan sumber dana.", variant: "destructive" }); return; }
    if (["pribadi", "pihak_lain"].includes(fundingSourceType) && !sourcePartyName.trim()) { toast({ title: "Nama pemberi dana wajib diisi.", variant: "destructive" }); return; }
    // Validasi field kondisional penanggung
    if (responsiblePartyType === "perusahaan_lain" && !responsibleCompanyId && !responsibleCompanyManual.trim()) { toast({ title: "Pilih atau isi nama perusahaan penanggung.", variant: "destructive" }); return; }
    if (responsiblePartyType === "bank" && !responsibleBankName.trim()) { toast({ title: "Nama bank penanggung wajib diisi.", variant: "destructive" }); return; }
    if (responsiblePartyType === "vendor" && !responsibleVendorId) { toast({ title: "Pilih vendor penanggung terlebih dahulu.", variant: "destructive" }); return; }

    // Hanya kirim cash_bank_account_id jika sumber dana berasal dari kas/bank perusahaan sendiri
    const isOwnFunds = ["kas_perusahaan", "rekening_bank"].includes(fundingSourceType);
    const isInternalCompanyFunds = fundingSourceType === "perusahaan_lain" && !!sourceCompanyId;

    createMut.mutate({
      companyId: effectiveCompanyId,
      body: {
        // Core fields
        advance_type: vendorId ? "VENDOR" : "OPERATIONAL",
        party_name: partyName, amount,
        payment_method: isOwnFunds ? pm : "bank",
        date, notes,
        cash_bank_account_id: (isOwnFunds || isInternalCompanyFunds) && sourceAccountId ? Number(sourceAccountId) : undefined,
        vendor_id: vendorId ? Number(vendorId) : undefined,
        user_id: userId || undefined,
        // Extended Dana Talangan fields
        category,
        category_other: categoryOther || undefined,
        purpose,
        funding_source_type: fundingSourceType,
        source_company_id: sourceCompanyId ? Number(sourceCompanyId) : undefined,
        source_bank_name: sourceBankName || undefined,
        source_party_name: sourceCompanyManual || sourcePartyName || undefined,
        responsible_party_type: responsiblePartyType,
        responsible_company_id: responsibleCompanyId ? Number(responsibleCompanyId) : undefined,
        responsible_bank_name: responsibleBankName || undefined,
        responsible_vendor_id: responsibleVendorId ? Number(responsibleVendorId) : undefined,
        responsible_employee_id: responsibleEmployeeId || undefined,
        responsible_party_name: responsibleCompanyManual || responsiblePartyName || undefined,
        reference_number: referenceNumber || undefined,
      },
    });
  };

  // ── Approve / Reject / Disburse ─────────────────────────────────────────────
  const [showRejectDialog, setShowRejectDialog] = useState(false);
  const [rejectReason, setRejectReason] = useState("");

  const approveMut = useMutation({
    mutationFn: (id: number) => apiFetch(`/api/advances/${id}/approve${cq}`, { method: "PATCH" }),
    onSuccess: async () => {
      toast({ title: `✅ Dana talangan disetujui.`, description: `Dana belum dicairkan — klik "Cairkan Dana" untuk memposting jurnal.` });
      qc.invalidateQueries({ queryKey: ["advances", "talangan"] });
      if (selected) await fetchDetail(selected.id);
    },
    onError: (e: Error) => toast({ title: e.message, variant: "destructive" }),
  });

  const disburseMut = useMutation({
    mutationFn: (id: number) => apiFetch(`/api/advances/${id}/disburse${cq}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({}) }),
    onSuccess: async () => {
      toast({ title: `✅ Dana dicairkan — jurnal DR/CR telah diposting.` });
      qc.invalidateQueries({ queryKey: ["advances", "talangan"] });
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
      toast({ title: `Dana talangan ditolak.` });
      qc.invalidateQueries({ queryKey: ["advances", "talangan"] });
      if (selected) await fetchDetail(selected.id);
      setShowRejectDialog(false); setRejectReason("");
    },
    onError: (e: Error) => toast({ title: e.message, variant: "destructive" }),
  });

  // ── Edit responsible party ──────────────────────────────────────────────────
  const [showEditResponsible, setShowEditResponsible] = useState(false);
  const [editRespSelectKey, setEditRespSelectKey] = useState("");
  const [editRespType, setEditRespType] = useState("");
  const [editRespCompanyId, setEditRespCompanyId] = useState("");
  const [editRespVendorId, setEditRespVendorId] = useState("");
  const [editRespBankName, setEditRespBankName] = useState("");
  const [editRespPartyName, setEditRespPartyName] = useState("");

  const openEditResponsible = () => {
    if (!selected) return;
    // Pre-fill dari data saat ini
    const rpt = selected.responsible_party_type ?? "";
    const rcid = selected.responsible_company_id ? String(selected.responsible_company_id) : "";
    if (rcid) {
      setEditRespSelectKey(`co:${rcid}`);
      setEditRespType("perusahaan_lain");
      setEditRespCompanyId(rcid);
    } else {
      setEditRespSelectKey(rpt);
      setEditRespType(rpt);
      setEditRespCompanyId("");
    }
    setEditRespVendorId(selected.responsible_vendor_id ? String(selected.responsible_vendor_id) : "");
    setEditRespBankName(selected.responsible_bank_name ?? "");
    setEditRespPartyName(selected.responsible_party_name ?? "");
    setShowEditResponsible(true);
  };

  const updateResponsibleMut = useMutation({
    mutationFn: ({ id, body }: { id: number; body: object }) =>
      apiFetch(`/api/advances/${id}/update-responsible${cq}`, {
        method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body),
      }),
    onSuccess: async () => {
      toast({ title: "✅ Penanggung jawab berhasil diperbarui." });
      qc.invalidateQueries({ queryKey: ["advances", "talangan"] });
      if (selected) {
        const updated = await apiFetch(`/api/advances/${selected.id}${cq}`);
        setSelected(updated);
        await fetchDetail(selected.id);
      }
      setShowEditResponsible(false);
    },
    onError: (e: Error) => toast({ title: e.message, variant: "destructive" }),
  });

  const handleUpdateResponsible = () => {
    if (!selected) return;
    if (!editRespType) { toast({ title: "Pilih jenis penanggung jawab.", variant: "destructive" }); return; }
    updateResponsibleMut.mutate({
      id: selected.id,
      body: {
        responsible_party_type:  editRespType,
        responsible_company_id:  editRespCompanyId ? Number(editRespCompanyId) : undefined,
        responsible_vendor_id:   editRespVendorId  ? Number(editRespVendorId)  : undefined,
        responsible_bank_name:   editRespBankName  || undefined,
        responsible_party_name:  editRespPartyName || undefined,
      },
    });
  };

  // ── Repay form (dengan bukti pengembalian per-cicilan) ──────────────────────
  const [repAmtRaw, setRepAmtRaw] = useState("");
  const [repSourceAccountId, setRepSourceAccountId] = useState("");  // receiver (CST) account
  const [repPayerCoaId, setRepPayerCoaId] = useState("");            // payer company's bank/kas account
  const [repRef, setRepRef] = useState("");                          // nomor referensi transfer
  const [repDate, setRepDate] = useState(today);
  const [repNotes, setRepNotes] = useState("");
  const [repFile, setRepFile] = useState<File | null>(null);
  const [repUploading, setRepUploading] = useState(false);
  const [repOcrLoading, setRepOcrLoading] = useState(false);
  const [repOcrResult, setRepOcrResult] = useState<{ amount: number | null; date: string | null; confidence: string; bankInfo: string | null } | null>(null);

  // ── Akun kas/bank perusahaan pengembali (payer company COA) ──────────────
  // payerCompanyId bisa dipilih oleh user — default ke activeCompanyId
  const [payerCompanyId, setPayerCompanyId] = useState<number | null>(null);
  // Saat advance dipilih / form dibuka, reset ke activeCompanyId
  useEffect(() => {
    setPayerCompanyId(activeCompanyId);
    setRepPayerCoaId("");
  }, [selected?.id, activeCompanyId]);

  const { data: payerAccounts = [] } = useQuery({
    queryKey: ["payer-accounts", payerCompanyId],
    queryFn: () => apiFetch(`/api/advances/payer-accounts?company_id=${payerCompanyId}`),
    enabled: !!payerCompanyId,
    staleTime: 30_000,
  });

  // Intercompany flag masih dipakai untuk label jurnal, tapi tidak lagi mengontrol visibilitas field payer
  const INTERNAL_PARTY_TYPES = ["perusahaan_lain", "perusahaan_aktif"];
  const isIntercompanyRepay = !!(
    selected?.responsible_company_id &&
    INTERNAL_PARTY_TYPES.includes(selected?.responsible_party_type ?? "") &&
    selected?.responsible_company_id !== activeCompanyId
  );

  // Nama perusahaan payer untuk display
  const payerCompanyName = payerCompanyId
    ? (companiesList as any[]).find((c: any) => c.id === payerCompanyId)?.company_name ?? `Perusahaan #${payerCompanyId}`
    : null;

  const handleRepFileChange = async (file: File | null) => {
    setRepFile(file);
    setRepOcrResult(null);
    if (!file) return;
    const ext = file.name.split(".").pop()?.toLowerCase() ?? "";
    if (!["jpg", "jpeg", "png", "webp"].includes(ext)) return;
    setRepOcrLoading(true);
    try {
      const fd = new FormData();
      fd.append("file", file);
      const r = await fetch("/api/advances/ocr-preview", { method: "POST", credentials: "include", body: fd });
      const data = await r.json();
      setRepOcrResult({ amount: data.amount ?? null, date: data.date ?? null, confidence: data.confidence ?? "low", bankInfo: data.bankInfo ?? null });
      if (data.amount && data.amount > 0 && !repAmtRaw) {
        setRepAmtRaw(fmtIDR(String(data.amount)));
      }
      if (data.date && !repDate) {
        setRepDate(data.date);
      }
    } catch {
      // OCR gagal — biarkan user isi manual
    } finally {
      setRepOcrLoading(false);
    }
  };

  const repayMut = useMutation({
    mutationFn: ({ id, body }: { id: number; body: object }) =>
      apiFetch(`/api/advances/${id}/repay${cq}`, {
        method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body),
      }),
    onSuccess: async (d: any, variables) => {
      const amt = (variables.body as any).amount;
      // Upload receipt if a file was selected
      if (repFile && d.repayment_id) {
        setRepUploading(true);
        try {
          const fd = new FormData();
          fd.append("receipt", repFile);
          const uploadRes = await fetch(
            `/api/advances/${variables.id}/repayments/${d.repayment_id}/upload-receipt`,
            { method: "POST", credentials: "include", body: fd },
          );
          if (!uploadRes.ok) {
            const errBody = await uploadRes.json().catch(() => ({}));
            toast({ title: `Cicilan berhasil, tapi bukti gagal diupload: ${errBody.message ?? "Coba lagi."}`, variant: "destructive" });
          } else {
            toast({ title: `✓ Cicilan ${idr(amt)} berhasil dicatat beserta bukti.`, description: `Sisa piutang: ${idr(Number(d.remaining_amount))}` });
          }
        } catch {
          toast({ title: "Cicilan tersimpan, tapi gagal mengirim file. Coba upload ulang.", variant: "destructive" });
        } finally {
          setRepUploading(false);
        }
      } else {
        const icDesc = d.intercompany_reference ? ` · Intercompany ${d.intercompany_reference}` : "";
        toast({ title: `✓ Cicilan ${idr(amt)} berhasil dicatat.${icDesc}`, description: `Sisa piutang: ${idr(Number(d.remaining_amount))}` });
      }
      qc.invalidateQueries({ queryKey: ["advances", "talangan"] });
      setRepAmtRaw(""); setRepNotes(""); setRepDate(today); setRepFile(null);
      setRepSourceAccountId(""); setRepPayerCoaId(""); setRepRef(""); setRepOcrResult(null);
      if (selected) await fetchDetail(selected.id);
    },
    onError: (e: Error) => {
      // Terjemahkan kode error ke pesan yang ramah pengguna
      const raw = e.message ?? "";
      let title = "Pengembalian dana gagal dicatat.";
      let description = "Tidak ada saldo, cicilan, atau jurnal yang berubah.";
      if (raw.includes("PERIOD_LOCKED") || raw.includes("periode keuangan")) {
        title = "Periode keuangan sudah ditutup.";
        description = "Pilih tanggal di periode yang masih terbuka, atau hubungi tim keuangan.";
      } else if (raw.includes("ACCOUNTING_CONFIG_MISSING") || raw.includes("konfigurasi akuntansi")) {
        title = "Konfigurasi akuntansi tidak lengkap.";
        description = "Pastikan akun kas/bank dan piutang telah dikonfigurasi.";
      } else if (raw.includes("INVALID_PAYER_ACCOUNT") || raw.includes("INVALID_RECEIVER_ACCOUNT")) {
        title = "Akun kas/bank tidak valid.";
        description = raw;
      } else if (raw.includes("INSUFFICIENT_REMAINING")) {
        title = "Nominal melebihi sisa piutang.";
        description = raw;
      } else if (raw.includes("INVALID_TRANSITION")) {
        title = "Status dana talangan tidak valid untuk repayment.";
        description = raw;
      } else if (raw.length < 200 && !raw.includes("Failed query") && !raw.includes("accounting_entries")) {
        // Pesan pendek yang tidak mengandung SQL — aman ditampilkan
        description = raw;
      }
      toast({ title, description, variant: "destructive" });
    },
  });

  const handleRepay = () => {
    if (!selected) return;
    const amount = parseIDR(repAmtRaw);
    if (amount <= 0) { toast({ title: "Nominal cicilan harus lebih dari 0.", variant: "destructive" }); return; }
    if (!repSourceAccountId) { toast({ title: "Pilih akun COA Bank/Kas Penerima (perusahaan sumber dana talangan).", variant: "destructive" }); return; }
    if (!repPayerCoaId) {
      toast({ title: "Pilih akun COA Bank/Kas perusahaan yang mengembalikan dana.", variant: "destructive" });
      return;
    }
    // Resolve payment method from receiver account
    const acc = (paymentAccounts as any[]).find((a: any) => String(a.id) === repSourceAccountId);
    const paymentMethod = acc ? (acc.account_class === "kas" ? "cash" : "bank") : "bank";
    // Unique key to prevent double-submit on retry
    const idempotencyKey = `RPY-${selected.id}-${Date.now()}`;
    repayMut.mutate({
      id: selected.id,
      body: {
        amount,
        payment_method: paymentMethod,
        source_account_id: Number(repSourceAccountId),   // backward compat
        receiver_coa_account_id: Number(repSourceAccountId),
        payer_company_id: payerCompanyId ?? undefined,
        payer_coa_account_id: repPayerCoaId ? Number(repPayerCoaId) : undefined,
        payment_reference: repRef || undefined,
        date: repDate,
        notes: repNotes,
        idempotency_key: idempotencyKey,
      },
    });
  };

  // ── Settle-to-expense (Pertanggungjawaban, no cash movement) ─────────────────
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
      toast({ title: "✓ Talangan ditutup sebagai beban.", description: "Jurnal reklasifikasi telah diposting." });
      qc.invalidateQueries({ queryKey: ["advances", "talangan"] });
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

  // ── Delete (hanya draft/pending_approval/rejected — belum ada jurnal) ───────
  const deleteMut = useMutation({
    mutationFn: (id: number) => apiFetch(`/api/advances/${id}${cq}`, { method: "DELETE" }),
    onSuccess: () => {
      toast({ title: "Dana talangan dihapus." });
      qc.invalidateQueries({ queryKey: ["advances", "talangan"] });
      setSelected(null); setDetail(null);
    },
    onError: (e: Error) => toast({ title: e.message, variant: "destructive" }),
  });

  // ── Void (jurnal sudah posted — buat jurnal pembalik, bukan hapus) ──────────
  const voidMut = useMutation({
    mutationFn: ({ id, reason }: { id: number; reason?: string }) =>
      apiFetch(`/api/advances/${id}/void${cq}`, {
        method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ reason }),
      }),
    onSuccess: async () => {
      toast({ title: "Dana talangan di-void — jurnal pembalik telah diposting." });
      qc.invalidateQueries({ queryKey: ["advances", "talangan"] });
      if (selected) await fetchDetail(selected.id);
    },
    onError: (e: Error) => toast({ title: e.message, variant: "destructive" }),
  });

  const pendingCount = (list as any[]).filter((r: any) => r.status === "pending_approval").length;

  const [listSearch, setListSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState("all");
  const [responsibleFilter, setResponsibleFilter] = useState("");
  const filteredList = (list as any[]).filter((row: any) => {
    if (statusFilter === "outstanding") {
      if (!["active", "partial"].includes(row.status)) return false;
    } else if (statusFilter !== "all" && row.status !== statusFilter) {
      return false;
    }
    if (listSearch) {
      const q = listSearch.toLowerCase();
      const hay = [row.partyName, row.advanceNumber, row.vendor?.name].filter(Boolean).join(" ").toLowerCase();
      if (!hay.includes(q)) return false;
    }
    if (responsibleFilter) {
      const q = responsibleFilter.toLowerCase();
      const hay = [
        row.responsible_company_name,
        row.responsible_vendor_name,
        row.responsible_bank_name,
        row.responsible_party_name,
      ].filter(Boolean).join(" ").toLowerCase();
      if (!hay.includes(q)) return false;
    }
    return true;
  });

  return (
    <AppShell>
      <div className="p-6 space-y-5 max-w-5xl mx-auto">
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
          <div className="flex items-center gap-3 min-w-0">
            <Link href="/expense">
              <Button variant="ghost" size="icon" className="h-8 w-8 shrink-0"><ArrowLeft size={15} /></Button>
            </Link>
            <div className="flex items-center gap-2 min-w-0">
              <HandCoins size={20} className="text-indigo-400 shrink-0" />
              <div className="min-w-0">
                <h1 className="text-xl font-bold truncate">Dana Talangan</h1>
                <p className="text-sm text-muted-foreground truncate">DR Piutang Dana Talangan · CR Kas/Bank</p>
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
              <Plus size={14} className="mr-1" /> Buat Talangan
            </Button>
          </div>
        </div>

        {/* Konsolidasi: link ke Dana Karyawan hub */}
        <div className="flex gap-2.5 rounded-lg border border-indigo-200 bg-indigo-50 px-4 py-2.5 items-center">
          <AlertTriangle className="h-4 w-4 text-indigo-500 shrink-0" />
          <p className="text-xs text-indigo-800 flex-1">
            Halaman ini adalah bagian dari modul <strong>Dana Karyawan</strong>.
            Kelola semua kasbon & talangan karyawan dari satu tempat.
          </p>
          <Link href="/expense/dana-karyawan">
            <Button variant="outline" size="sm" className="text-xs h-7 border-indigo-300 text-indigo-700 hover:bg-indigo-100 shrink-0 gap-1">
              <ChevronsRight size={12} /> Dana Karyawan
            </Button>
          </Link>
        </div>

        <div className="grid gap-4 lg:grid-cols-2">
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-sm flex items-center gap-2">
                <Building2 size={15} /> Hutang Intercompany
                <Badge variant="outline" className="ml-auto text-[10px]">{(intercompanyPayables as any[]).length}</Badge>
              </CardTitle>
            </CardHeader>
            <CardContent className="pt-0">
              {(intercompanyPayables as any[]).length === 0 ? (
                <p className="text-xs text-muted-foreground">Tidak ada hutang intercompany terbuka.</p>
              ) : (
                <div className="space-y-2">
                  {(intercompanyPayables as any[]).slice(0, 5).map((row: any) => (
                    <button key={row.id} type="button" className="w-full text-left rounded-md border p-2 hover:bg-muted/50" onClick={() => openDetail(row)}>
                      <div className="flex items-center justify-between gap-2">
                        <span className="text-xs font-medium">{row.advance_number}</span>
                        <span className="text-xs font-mono">{idr(Number(row.remaining_amount))}</span>
                      </div>
                      <p className="text-[11px] text-muted-foreground mt-0.5">Kepada {row.funding_company_name ?? "Perusahaan sumber"}</p>
                    </button>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-sm flex items-center gap-2">
                <Building2 size={15} /> Piutang Intercompany
                <Badge variant="outline" className="ml-auto text-[10px]">{(intercompanyReceivables as any[]).length}</Badge>
              </CardTitle>
            </CardHeader>
            <CardContent className="pt-0">
              {(intercompanyReceivables as any[]).length === 0 ? (
                <p className="text-xs text-muted-foreground">Tidak ada piutang intercompany terbuka.</p>
              ) : (
                <div className="space-y-2">
                  {(intercompanyReceivables as any[]).slice(0, 5).map((row: any) => (
                    <button key={row.id} type="button" className="w-full text-left rounded-md border p-2 hover:bg-muted/50" onClick={() => openDetail(row)}>
                      <div className="flex items-center justify-between gap-2">
                        <span className="text-xs font-medium">{row.advance_number}</span>
                        <span className="text-xs font-mono">{idr(Number(row.remaining_amount))}</span>
                      </div>
                      <p className="text-[11px] text-muted-foreground mt-0.5">Dari {row.responsible_company_name ?? "Perusahaan penanggung"}</p>
                    </button>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>
        </div>

        {showForm && (
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-sm text-muted-foreground">Form Dana Talangan Baru</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">

              {/* ── Peringatan mode konsolidasi ──────────────────────────── */}
              {isConsolidated && (
                <Alert className="border-amber-600/40 bg-amber-900/20 py-2.5 px-3">
                  <AlertTriangle size={14} className="text-amber-400 shrink-0 mt-0.5" />
                  <AlertDescription className="text-xs text-amber-300 leading-snug">
                    <span className="font-medium">Mode Konsolidasi aktif.</span> Untuk membuat dana talangan, pilih{" "}
                    <span className="font-medium">Sumber Dana = Kas Perusahaan / Rekening Bank</span> dan pilih akun
                    spesifik — sistem akan otomatis mendeteksi perusahaan dari akun tersebut.
                    Atau, pilih perusahaan dari menu di bagian atas halaman terlebih dahulu.
                  </AlertDescription>
                </Alert>
              )}

              {/* ── Scan Struk OCR (opsional) ────────────────────────────── */}
              <div className="rounded-lg border border-dashed border-violet-500/40 bg-violet-900/10 px-4 py-3 space-y-2">
                <p className="text-xs font-medium text-violet-300 flex items-center gap-1.5">
                  <Sparkles size={12} /> Scan Bukti Transfer / Struk (Opsional)
                </p>
                <p className="text-xs text-muted-foreground">Upload gambar bukti transfer atau struk — AI akan membaca nominal & tanggal otomatis.</p>
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
                    : <><Sparkles size={12} className="mr-1" />Pilih Gambar</>}
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
                    {createOcrResult.partyName && <p>Vendor/Pihak: {createOcrResult.partyName}</p>}
                  </div>
                )}
              </div>

              {/* ── Pihak Penerima — combobox tunggal ── */}
              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-1.5">
                  <Label>Pihak Penerima <span className="text-destructive">*</span></Label>
                  <Popover open={recipientOpen} onOpenChange={setRecipientOpen}>
                    <PopoverTrigger asChild>
                      <Button
                        variant="outline"
                        role="combobox"
                        aria-expanded={recipientOpen}
                        className="w-full justify-between font-normal h-9 px-3 text-sm"
                      >
                        {partyName ? (
                          <span className="flex items-center gap-1.5 truncate">
                            {vendorId ? <Building2 size={13} className="shrink-0 text-muted-foreground" /> :
                             userId   ? <User size={13} className="shrink-0 text-muted-foreground" /> : null}
                            <span className="truncate">{partyName}</span>
                          </span>
                        ) : (
                          <span className="text-muted-foreground">Pilih vendor, karyawan, atau ketik bebas…</span>
                        )}
                        <ChevronDown size={14} className="ml-2 shrink-0 opacity-50" />
                      </Button>
                    </PopoverTrigger>
                    <PopoverContent className="w-[380px] p-0" align="start">
                      <Command shouldFilter={false}>
                        <CommandInput
                          placeholder="Cari vendor atau karyawan…"
                          value={recipientQuery}
                          onValueChange={setRecipientQuery}
                        />
                        <CommandList>
                          {/* ── Vendor group ── */}
                          {(vendorList as any[]).filter((v: any) =>
                            !recipientQuery || v.name?.toLowerCase().includes(recipientQuery.toLowerCase())
                          ).length > 0 && (
                            <CommandGroup heading="Vendor">
                              {(vendorList as any[])
                                .filter((v: any) => !recipientQuery || v.name?.toLowerCase().includes(recipientQuery.toLowerCase()))
                                .slice(0, 8)
                                .map((v: any) => (
                                  <CommandItem
                                    key={`vendor-${v.id}`}
                                    value={`vendor-${v.id}`}
                                    onSelect={() => {
                                      setVendorId(String(v.id));
                                      setUserId("");
                                      setPartyName(v.name ?? "");
                                      setRecipientQuery("");
                                      setRecipientOpen(false);
                                    }}
                                  >
                                    <Building2 size={13} className="mr-2 shrink-0 text-muted-foreground" />
                                    <span className="flex-1 truncate">{v.name}</span>
                                    {vendorId === String(v.id) && <Check size={13} className="ml-auto shrink-0" />}
                                  </CommandItem>
                                ))}
                            </CommandGroup>
                          )}

                          {/* ── Karyawan group ── */}
                          {(userList as any[]).filter((u: any) =>
                            !recipientQuery || u.name?.toLowerCase().includes(recipientQuery.toLowerCase()) || u.email?.toLowerCase().includes(recipientQuery.toLowerCase())
                          ).length > 0 && (
                            <CommandGroup heading="Karyawan">
                              {(userList as any[])
                                .filter((u: any) => !recipientQuery || u.name?.toLowerCase().includes(recipientQuery.toLowerCase()) || u.email?.toLowerCase().includes(recipientQuery.toLowerCase()))
                                .slice(0, 8)
                                .map((u: any) => (
                                  <CommandItem
                                    key={`user-${u.id}`}
                                    value={`user-${u.id}`}
                                    onSelect={() => {
                                      setUserId(String(u.id));
                                      setVendorId("");
                                      setPartyName(u.name ?? u.email ?? "");
                                      setRecipientQuery("");
                                      setRecipientOpen(false);
                                    }}
                                  >
                                    <User size={13} className="mr-2 shrink-0 text-muted-foreground" />
                                    <span className="flex-1 truncate">{u.name ?? u.email}</span>
                                    {u.departmentName && <span className="ml-2 text-xs text-muted-foreground shrink-0">{u.departmentName}</span>}
                                    {userId === String(u.id) && <Check size={13} className="ml-auto shrink-0" />}
                                  </CommandItem>
                                ))}
                            </CommandGroup>
                          )}

                          {/* ── Ketik bebas ── */}
                          {recipientQuery.trim() && (
                            <>
                              <CommandSeparator />
                              <CommandGroup>
                                <CommandItem
                                  value="__free__"
                                  onSelect={() => {
                                    setPartyName(recipientQuery.trim());
                                    setVendorId("");
                                    setUserId("");
                                    setRecipientQuery("");
                                    setRecipientOpen(false);
                                  }}
                                >
                                  <Plus size={13} className="mr-2 shrink-0" />
                                  Gunakan <span className="mx-1 font-medium">"{recipientQuery.trim()}"</span> sebagai nama bebas
                                </CommandItem>
                              </CommandGroup>
                            </>
                          )}

                          {/* ── Tambah vendor baru ── */}
                          <CommandSeparator />
                          <CommandGroup>
                            <CommandItem
                              value="__new_vendor__"
                              className="text-primary"
                              onSelect={() => { setRecipientOpen(false); window.open("/bizportal/purchase/vendors", "_blank"); }}
                            >
                              <ExternalLink size={13} className="mr-2 shrink-0" />
                              Tambah vendor baru di master data…
                            </CommandItem>
                          </CommandGroup>
                        </CommandList>
                      </Command>

                      {/* Clear selection */}
                      {partyName && (
                        <div className="border-t px-3 py-2">
                          <button
                            className="flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground transition-colors"
                            onClick={() => { setPartyName(""); setVendorId(""); setUserId(""); setRecipientOpen(false); }}
                          >
                            <X size={11} /> Hapus pilihan
                          </button>
                        </div>
                      )}
                    </PopoverContent>
                  </Popover>

                  {/* Badge link jika terhubung ke master */}
                  {vendorId && (
                    <p className="text-xs text-muted-foreground flex items-center gap-1">
                      <Building2 size={10} /> Vendor master terhubung
                      <Link href={`/purchase/vendors`} className="text-primary hover:underline ml-1">lihat →</Link>
                    </p>
                  )}
                  {userId && (
                    <p className="text-xs text-muted-foreground flex items-center gap-1">
                      <User size={10} /> Karyawan terhubung
                    </p>
                  )}
                </div>
                <div className="space-y-1.5">
                  <Label>Tanggal <span className="text-destructive">*</span></Label>
                  <DatePicker value={date} onChange={(v) => setDate(v)} />
                </div>
              </div>
              {/* ── 3. Kategori Dana Talangan ────────────────────────── */}
              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-1.5">
                  <Label>Kategori Dana Talangan <span className="text-destructive">*</span></Label>
                  <Select value={category} onValueChange={(v) => {
                    if (v === "__add_new__") { setShowAddCategoryDialog(true); return; }
                    setCategory(v);
                    if (v !== "lainnya") setCategoryOther("");
                  }}>
                    <SelectTrigger className="h-9"><SelectValue placeholder="Pilih kategori…" /></SelectTrigger>
                    <SelectContent>
                      {DEFAULT_CATEGORIES.map((cat) => (
                        <SelectItem key={cat} value={cat}>{cat}</SelectItem>
                      ))}
                      {customCategories.length > 0 && (
                        <>
                          <div className="px-2 py-1 text-[10px] text-muted-foreground uppercase tracking-wide font-medium border-t mt-1 pt-2">Kategori Kustom</div>
                          {customCategories.map((cat) => (
                            <div key={cat} className="flex items-center group">
                              <SelectItem value={cat} className="flex-1">{cat}</SelectItem>
                              <button
                                type="button"
                                className="mr-2 opacity-0 group-hover:opacity-100 text-muted-foreground hover:text-destructive transition-opacity"
                                onMouseDown={(e) => { e.preventDefault(); e.stopPropagation(); handleDeleteCustomCategory(cat); }}
                                title="Hapus kategori ini"
                              >
                                <X size={12} />
                              </button>
                            </div>
                          ))}
                        </>
                      )}
                      <div className="border-t mt-1 pt-1">
                        <SelectItem value="lainnya">Lainnya…</SelectItem>
                        <SelectItem value="__add_new__" className="text-primary font-medium">
                          <span className="flex items-center gap-1.5"><Plus size={13} />Tambah Kategori Baru</span>
                        </SelectItem>
                      </div>
                    </SelectContent>
                  </Select>
                </div>
                {category === "lainnya" && (
                  <div className="space-y-1.5">
                    <Label>Kategori Lainnya <span className="text-destructive">*</span></Label>
                    <Input placeholder="Isi kategori lainnya…" value={categoryOther} onChange={(e) => setCategoryOther(e.target.value)} />
                  </div>
                )}
              </div>

              {/* ── 4. Tujuan / Keperluan ────────────────────────────── */}
              <div className="space-y-1.5">
                <Label>Tujuan / Keperluan Dana Talangan <span className="text-destructive">*</span></Label>
                <Textarea
                  rows={2}
                  placeholder="Pembayaran DP vendor, biaya pengiriman, biaya customs, kebutuhan proyek, atau keperluan operasional lainnya."
                  value={purpose}
                  onChange={(e) => setPurpose(e.target.value)}
                />
              </div>

              {/* ── 5. Nominal ───────────────────────────────────────── */}
              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-1.5">
                  <Label>Nominal (IDR) <span className="text-destructive">*</span></Label>
                  <Input placeholder="0" className="font-mono" value={amountRaw} onChange={(e) => setAmountRaw(fmtIDR(e.target.value))} />
                </div>
              </div>

              {/* ── 7+8. Sumber Dana ─────────────────────────────────── */}
              <div className="space-y-3">
                <div className="grid grid-cols-2 gap-4">
                  <div className="space-y-1.5">
                    <Label>Sumber Dana <span className="text-destructive">*</span></Label>
                    <Select
                      value={fundingSourceType}
                      onValueChange={(v) => {
                        setFundingSourceType(v);
                        setSourceAccountId(""); setSourceAccountCompanyId(null); setSourceCompanyId(""); setSourceCompanyManual("");
                        setSourceBankName(""); setSourcePartyName(""); setPm("bank");
                      }}
                    >
                      <SelectTrigger className="h-9"><SelectValue placeholder="Pilih sumber dana…" /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value="kas_perusahaan">💵 Kas Perusahaan</SelectItem>
                        <SelectItem value="rekening_bank">🏦 Rekening Bank Perusahaan</SelectItem>
                        <SelectItem value="perusahaan_lain">🏢 Dana dari Perusahaan Lain</SelectItem>
                        <SelectItem value="bank">🏛️ Dana dari Bank</SelectItem>
                        <SelectItem value="pribadi">👤 Dana Pribadi Karyawan / Direksi</SelectItem>
                        <SelectItem value="pihak_lain">🤝 Pihak Lain</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="space-y-1.5">
                    {fundingSourceType === "kas_perusahaan" && (
                      <>
                        <Label>Akun Kas <span className="text-destructive">*</span></Label>
                        {!hasCashAccount && (paymentAccounts as any[]).filter((a: any) => a.account_class === "kas").length === 0 ? (
                          <Alert className="border-amber-600/40 bg-amber-900/20 py-2 px-3">
                            <AlertTriangle size={13} className="text-amber-400 shrink-0 mt-0.5" />
                            <AlertDescription className="text-xs text-amber-300 leading-snug">
                              Tidak ada akun kas yang terkonfigurasi. Atur akun kas di{" "}
                              <Link href="/finance/settings" className="underline">Pengaturan Akuntansi</Link>{" "}
                              sebelum melanjutkan.
                            </AlertDescription>
                          </Alert>
                        ) : (
                          <SearchableSelect
                            placeholder="Pilih akun kas…"
                            searchPlaceholder="Cari akun kas…"
                            emptyText="Akun kas tidak ditemukan."
                            value={sourceAccountId}
                            onValueChange={(v) => {
                              setSourceAccountId(v); setPm("cash");
                              const acc = (paymentAccounts as any[]).find((a: any) => String(a.id) === v);
                              setSourceAccountCompanyId(acc?.company_id ? Number(acc.company_id) : null);
                            }}
                            options={(paymentAccounts as any[]).filter((a: any) => a.account_class === "kas").map((a: any) => ({
                              value: String(a.id), label: `${a.code} – ${a.name}`, sublabel: a.code, group: "💵 Kas",
                            }))}
                          />
                        )}
                      </>
                    )}
                    {fundingSourceType === "rekening_bank" && (
                      <>
                        <Label>Rekening Bank <span className="text-destructive">*</span></Label>
                        {!hasBankAccount && (paymentAccounts as any[]).filter((a: any) => a.account_class === "bank").length === 0 ? (
                          <Alert className="border-amber-600/40 bg-amber-900/20 py-2 px-3">
                            <AlertTriangle size={13} className="text-amber-400 shrink-0 mt-0.5" />
                            <AlertDescription className="text-xs text-amber-300 leading-snug">
                              Tidak ada rekening bank yang terkonfigurasi. Atur rekening bank di{" "}
                              <Link href="/finance/settings" className="underline">Pengaturan Akuntansi</Link>{" "}
                              sebelum melanjutkan.
                            </AlertDescription>
                          </Alert>
                        ) : (
                          <SearchableSelect
                            placeholder="Pilih rekening bank…"
                            searchPlaceholder="Cari rekening…"
                            emptyText="Rekening tidak ditemukan."
                            value={sourceAccountId}
                            onValueChange={(v) => {
                              setSourceAccountId(v); setPm("bank");
                              const acc = (paymentAccounts as any[]).find((a: any) => String(a.id) === v);
                              setSourceAccountCompanyId(acc?.company_id ? Number(acc.company_id) : null);
                            }}
                            options={(paymentAccounts as any[]).filter((a: any) => a.account_class === "bank").map((a: any) => ({
                              value: String(a.id), label: `${a.code} – ${a.name}`, sublabel: a.code, group: "🏦 Bank",
                            }))}
                          />
                        )}
                      </>
                    )}
                    {fundingSourceType === "perusahaan_lain" && (
                      <>
                        <Label>Perusahaan Sumber Dana <span className="text-destructive">*</span></Label>
                        <Select value={sourceCompanyId} onValueChange={(v) => { setSourceCompanyId(v); setSourceCompanyManual(""); }}>
                          <SelectTrigger className="h-9"><SelectValue placeholder="Pilih perusahaan…" /></SelectTrigger>
                          <SelectContent>
                            {(companiesList as any[]).map((c: any) => (
                              <SelectItem key={c.id} value={String(c.id)}>{c.name}</SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                        {sourceCompanyId && (
                          <>
                            <Label className="mt-2">Akun kas/bank perusahaan sumber</Label>
                            <SearchableSelect
                              placeholder="Pilih akun kas/bank sumber…"
                              searchPlaceholder="Cari akun…"
                              emptyText="Akun kas/bank tidak ditemukan."
                              value={sourceAccountId}
                              onValueChange={setSourceAccountId}
                              options={(sourceCompanyAccounts as any[]).map((a: any) => ({
                                value: String(a.id), label: `${a.code} – ${a.name}`, sublabel: a.code, group: a.account_class === "kas" ? "Kas" : "Bank",
                              }))}
                            />
                          </>
                        )}
                      </>
                    )}
                    {fundingSourceType === "bank" && (
                      <>
                        <Label>Nama Bank <span className="text-destructive">*</span></Label>
                        <Input placeholder="Contoh: BCA, Mandiri, BNI…" value={sourceBankName} onChange={(e) => setSourceBankName(e.target.value)} />
                      </>
                    )}
                    {["pribadi", "pihak_lain"].includes(fundingSourceType) && (
                      <>
                        <Label>Nama Pemberi Dana <span className="text-destructive">*</span></Label>
                        <Input placeholder="Nama lengkap pemberi dana…" value={sourcePartyName} onChange={(e) => setSourcePartyName(e.target.value)} />
                      </>
                    )}
                  </div>
                </div>
                {fundingSourceType === "perusahaan_lain" && !sourceCompanyId && (
                  <div className="space-y-1.5">
                    <Label className="text-xs text-muted-foreground">Atau isi nama perusahaan secara manual:</Label>
                    <Input placeholder="Nama perusahaan sumber dana (jika belum terdaftar)…" value={sourceCompanyManual} onChange={(e) => setSourceCompanyManual(e.target.value)} />
                  </div>
                )}
                {fundingSourceType === "bank" && (
                  <div className="space-y-1.5">
                    <Label className="text-xs text-muted-foreground">Nomor Referensi / Fasilitas (opsional):</Label>
                    <Input placeholder="No. fasilitas pinjaman atau referensi bank…" value={sourcePartyName} onChange={(e) => setSourcePartyName(e.target.value)} />
                  </div>
                )}
              </div>

              {/* ── 9. Pihak yang Bertanggung Jawab ─────────────────── */}
              <div className="rounded-lg border border-muted bg-muted/20 p-4 space-y-3">
                <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground flex items-center gap-1.5">
                  <ShieldCheck size={12} /> Pihak yang Bertanggung Jawab Membayar
                </p>
                <div className="grid grid-cols-2 gap-4">
                  <div className="space-y-1.5">
                    <Label>Jenis Penanggung <span className="text-destructive">*</span></Label>
                    <SearchableSelect
                      placeholder="Pilih penanggung…"
                      searchPlaceholder="Cari penanggung…"
                      emptyText="Tidak ditemukan."
                      value={responsibleSelectKey}
                      onValueChange={(v) => {
                        setResponsibleSelectKey(v);
                        setResponsibleCompanyId(""); setResponsibleCompanyManual("");
                        setResponsibleBankName(""); setResponsibleVendorId("");
                        setResponsibleEmployeeId(""); setResponsiblePartyName("");
                        if (v.startsWith("co:")) {
                          setResponsiblePartyType("perusahaan_lain");
                          setResponsibleCompanyId(v.slice(3));
                        } else {
                          setResponsiblePartyType(v);
                        }
                      }}
                      options={[
                        ...(companiesList as any[]).map((c: any) => ({
                          value: `co:${c.id}`,
                          label: c.company_name ?? c.name,
                          group: "🏢 Perusahaan",
                        })),
                        { value: "bank",       label: "🏛️ Bank",              group: "Lainnya" },
                        { value: "vendor",     label: "🤝 Vendor",            group: "Lainnya" },
                        { value: "karyawan",   label: "👤 Karyawan / Direksi", group: "Lainnya" },
                        { value: "pihak_lain", label: "👥 Pihak Lain",        group: "Lainnya" },
                      ]}
                    />
                  </div>
                  <div className="space-y-1.5">
                    {responsiblePartyType === "perusahaan_lain" && responsibleCompanyId && (
                      <div className="flex h-9 items-center rounded-md border border-input bg-muted/40 px-3 text-sm text-muted-foreground">
                        ✓ {(companiesList as any[]).find((c: any) => String(c.id) === responsibleCompanyId)?.company_name
                          ?? (companiesList as any[]).find((c: any) => String(c.id) === responsibleCompanyId)?.name
                          ?? "Perusahaan terpilih"}
                      </div>
                    )}
                    {responsiblePartyType === "bank" && (
                      <>
                        <Label>Nama Bank <span className="text-destructive">*</span></Label>
                        <Input placeholder="Contoh: BCA, Mandiri…" value={responsibleBankName} onChange={(e) => setResponsibleBankName(e.target.value)} />
                      </>
                    )}
                    {responsiblePartyType === "vendor" && (
                      <>
                        <Label>Vendor <span className="text-destructive">*</span></Label>
                        <SearchableSelect
                          placeholder="Pilih vendor…"
                          searchPlaceholder="Cari vendor…"
                          emptyText="Vendor tidak ditemukan."
                          value={responsibleVendorId}
                          onValueChange={setResponsibleVendorId}
                          options={(vendorList as any[]).map((v: any) => ({
                            value: String(v.id), label: v.name,
                          }))}
                        />
                      </>
                    )}
                    {responsiblePartyType === "karyawan" && (
                      <>
                        <Label>Karyawan / Direksi</Label>
                        <SearchableSelect
                          placeholder="Pilih karyawan…"
                          searchPlaceholder="Cari nama atau email…"
                          emptyText="Karyawan tidak ditemukan."
                          value={responsibleEmployeeId}
                          onValueChange={setResponsibleEmployeeId}
                          options={(userList as any[]).map((u: any) => ({
                            value: String(u.id), label: u.name ?? u.email, sublabel: u.email,
                          }))}
                        />
                      </>
                    )}
                    {responsiblePartyType === "pihak_lain" && (
                      <>
                        <Label>Nama / Perusahaan <span className="text-destructive">*</span></Label>
                        <Input placeholder="Nama pihak yang bertanggung jawab…" value={responsiblePartyName} onChange={(e) => setResponsiblePartyName(e.target.value)} />
                      </>
                    )}
                  </div>
                </div>
                {responsiblePartyType === "karyawan" && !responsibleEmployeeId && (
                  <div className="space-y-1.5">
                    <Label className="text-xs text-muted-foreground">Atau isi nama secara manual:</Label>
                    <Input placeholder="Nama karyawan / direksi…" value={responsiblePartyName} onChange={(e) => setResponsiblePartyName(e.target.value)} />
                  </div>
                )}
              </div>

              {/* ── 10+11. Referensi + Keterangan ───────────────────── */}
              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-1.5">
                  <Label>Referensi / No. Dokumen</Label>
                  <Input placeholder="No. dokumen, faktur, atau referensi (opsional)…" value={referenceNumber} onChange={(e) => setReferenceNumber(e.target.value)} />
                </div>
                <div className="space-y-1.5">
                  <Label>Keterangan / Memo</Label>
                  <Textarea rows={1} placeholder="Opsional…" value={notes} onChange={(e) => setNotes(e.target.value)} />
                </div>
              </div>

              {/* Preview jurnal — hanya tampil jika sumber dana dari kas/bank sendiri */}
              {parseIDR(amountRaw) > 0 && ["kas_perusahaan", "rekening_bank"].includes(fundingSourceType) && (
                <div className="rounded-md bg-muted/40 border px-4 py-2 text-xs text-muted-foreground">
                  Jurnal: <strong>DR Piutang Dana Talangan</strong> {idr(parseIDR(amountRaw))} · <strong>CR{" "}
                    {sourceAccountId
                      ? ((paymentAccounts as any[]).find((a: any) => String(a.id) === sourceAccountId)?.name ?? (pm === "cash" ? "Kas" : "Bank"))
                      : (pm === "cash" ? "Kas" : "Bank")}
                  </strong> {idr(parseIDR(amountRaw))}
                </div>
              )}
              {parseIDR(amountRaw) > 0 && fundingSourceType && !["kas_perusahaan", "rekening_bank"].includes(fundingSourceType) && (
                <div className="rounded-md bg-amber-900/20 border border-amber-600/30 px-4 py-2 text-xs text-amber-300">
                  ⚠️ Sumber dana eksternal — jurnal akan dibuat manual setelah sumber akun valid dikonfirmasi.
                </div>
              )}

              {/* ── 12+13. Tombol Aksi ───────────────────────────────── */}
              <div className="flex gap-2">
                {/* Disable jika sumber dana internal tapi tidak ada akun terkonfigurasi */}
                {["kas_perusahaan", "rekening_bank"].includes(fundingSourceType) && !hasAnyAccount &&
                  (paymentAccounts as any[]).filter((a: any) =>
                    a.account_class === (fundingSourceType === "kas_perusahaan" ? "kas" : "bank")
                  ).length === 0 ? (
                  <Button disabled title="Konfigurasi akun kas/bank terlebih dahulu di Pengaturan Akuntansi">
                    <AlertTriangle size={14} className="mr-1" /> Konfigurasi Akun Dulu
                  </Button>
                ) : (
                  <Button onClick={handleCreate} disabled={createMut.isPending}>
                    {createMut.isPending ? <><Loader2 size={14} className="mr-1 animate-spin" />Menyimpan...</> : "Simpan Talangan"}
                  </Button>
                )}
                <Button variant="ghost" onClick={() => { setShowForm(false); setCreateOcrResult(null); resetFormNewFields(); }}>Batal</Button>
              </div>
            </CardContent>
          </Card>
        )}

        <Card>
          <CardHeader className="pb-3">
            <div className="flex flex-col gap-2">
              <div className="flex flex-col sm:flex-row gap-2 sm:items-center">
                <div className="relative flex-1 min-w-[200px]">
                  <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
                  <Input
                    placeholder="Cari nama pihak, no. talangan, atau vendor..."
                    className="pl-9 h-9"
                    value={listSearch}
                    onChange={(e) => setListSearch(e.target.value)}
                  />
                </div>
                <div className="relative min-w-[200px]">
                  <Building2 size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
                  <Input
                    placeholder="Filter penanggung jawab..."
                    className="pl-9 h-9"
                    value={responsibleFilter}
                    onChange={(e) => setResponsibleFilter(e.target.value)}
                  />
                  {responsibleFilter && (
                    <button
                      className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
                      onClick={() => setResponsibleFilter("")}
                    ><X size={13} /></button>
                  )}
                </div>
                <Select value={statusFilter} onValueChange={setStatusFilter}>
                  <SelectTrigger className="h-9 w-full sm:w-[200px]"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">Semua Status</SelectItem>
                    <SelectItem value="outstanding">Outstanding (belum lunas)</SelectItem>
                    <SelectItem value="pending_approval">Menunggu Approval</SelectItem>
                    <SelectItem value="active">Aktif</SelectItem>
                    <SelectItem value="partial">Sebagian</SelectItem>
                    <SelectItem value="repaid">Lunas</SelectItem>
                    <SelectItem value="rejected">Ditolak</SelectItem>
                    <SelectItem value="void">Void</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>
          </CardHeader>
          <CardContent className="p-0">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Tanggal</TableHead>
                  <TableHead>Pihak Penerima</TableHead>
                  <TableHead>Kategori</TableHead>
                  <TableHead>Tujuan</TableHead>
                  <TableHead className="text-right">Nominal</TableHead>
                  <TableHead>Sumber Dana</TableHead>
                  <TableHead>Penanggung Jawab</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead className="w-8"></TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {isLoading && <TableRow><TableCell colSpan={9} className="text-center py-10 text-muted-foreground">Memuat...</TableCell></TableRow>}
                {!isLoading && filteredList.length === 0 && (
                  <TableRow><TableCell colSpan={9} className="text-center py-10 text-muted-foreground">
                    {(list as any[]).length === 0 ? "Belum ada dana talangan." : "Tidak ada yang cocok dengan pencarian/filter."}
                  </TableCell></TableRow>
                )}
                {filteredList.map((row: any) => (
                  <TableRow key={row.id} className="cursor-pointer hover:bg-muted/50" onClick={() => openDetail(row)}>
                    <TableCell className="text-sm whitespace-nowrap">{row.date}</TableCell>
                    <TableCell className="text-sm font-medium max-w-[140px]">
                      <p className="truncate">{row.partyName}</p>
                      {row.vendor?.name && <p className="text-xs text-muted-foreground truncate">{row.vendor.name}</p>}
                    </TableCell>
                    <TableCell className="text-xs">
                      {row.category
                        ? <span className="px-1.5 py-0.5 rounded bg-muted text-muted-foreground border text-[10px]">{row.category === "lainnya" ? (row.category_other || "Lainnya") : row.category}</span>
                        : <span className="text-muted-foreground">—</span>}
                    </TableCell>
                    <TableCell className="text-xs text-muted-foreground max-w-[160px]">
                      <p className="truncate" title={row.purpose ?? ""}>{row.purpose ?? "—"}</p>
                    </TableCell>
                    <TableCell className="text-right font-mono text-sm whitespace-nowrap">{idr(row.amount)}</TableCell>
                    <TableCell className="text-xs">
                      {row.funding_source_type
                        ? <Badge className={cn("text-[10px] border whitespace-nowrap", FUNDING_SOURCE_COLORS[row.funding_source_type] ?? "bg-muted text-muted-foreground border-border")}>
                            {FUNDING_SOURCE_LABELS[row.funding_source_type] ?? row.funding_source_type}
                          </Badge>
                        : <span className="text-muted-foreground">{row.cashBankAccount?.name ?? "—"}</span>}
                    </TableCell>
                    <TableCell className="text-xs">
                      {(row.responsible_company_name || row.responsible_vendor_name || row.responsible_bank_name || row.responsible_party_name)
                        ? <span className="text-[11px] text-foreground font-medium truncate max-w-[140px] block">
                            {row.responsible_company_name ?? row.responsible_vendor_name ?? row.responsible_bank_name ?? row.responsible_party_name}
                          </span>
                        : row.responsible_party_type
                          ? <span className="text-muted-foreground text-[11px]">{RESPONSIBLE_PARTY_LABELS[row.responsible_party_type] ?? row.responsible_party_type}</span>
                          : <span className="text-muted-foreground">—</span>}
                    </TableCell>
                    <TableCell>
                      <Badge className={cn("text-xs border", STATUS_COLORS[row.status] ?? "")}>{STATUS_LABELS[row.status] ?? row.status}</Badge>
                    </TableCell>
                    <TableCell><ChevronsRight size={14} className="text-muted-foreground" /></TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      </div>

      <Sheet open={!!selected} onOpenChange={(v) => { if (!v) { setSelected(null); setDetail(null); } }}>
        <SheetContent className="w-[420px] sm:w-[520px] overflow-y-auto">
          {selected && (
            <>
              <SheetHeader>
                <SheetTitle className="font-mono text-base">{selected.advanceNumber}</SheetTitle>
                <SheetDescription>{selected.partyName}</SheetDescription>
              </SheetHeader>
              <div className="mt-4 space-y-4">

                {/* Rejected banner */}
                {selected.status === "rejected" && (
                  <Alert className="border-red-600 bg-red-900/20">
                    <XCircle size={14} className="text-red-400" />
                    <AlertDescription className="text-red-300 text-sm ml-2">
                      Dana talangan ini ditolak.
                      {(detail?.rejection_reason || detail?.rejectionReason) && ` Alasan: ${detail.rejection_reason ?? detail.rejectionReason}`}
                    </AlertDescription>
                  </Alert>
                )}

                {/* Void banner */}
                {selected.status === "void" && (
                  <Alert className="border-gray-600 bg-gray-900/20">
                    <XCircle size={14} className="text-gray-400" />
                    <AlertDescription className="text-gray-300 text-sm ml-2">
                      Dana talangan ini di-void — jurnal pembalik telah diposting.
                    </AlertDescription>
                  </Alert>
                )}

                <div className="rounded-lg border bg-muted/30 p-4 space-y-2">
                  <div className="flex justify-between text-sm">
                    <span className="text-muted-foreground">Nominal</span>
                    <span className="font-mono font-semibold">{idr(Number(selected.amount))}</span>
                  </div>
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
                    <Badge className={cn("text-xs border", STATUS_COLORS[selected.status] ?? "")}>{STATUS_LABELS[selected.status] ?? selected.status}</Badge>
                  </div>
                  {selected.notes && <p className="text-xs text-muted-foreground pt-1">{selected.notes}</p>}
                </div>

                {/* ── Info tambahan: Kategori, Tujuan, Sumber Dana, Penanggung ── */}
                {(selected.category || selected.purpose || selected.funding_source_type || selected.responsible_party_type) && (
                  <div className="rounded-lg border bg-muted/10 p-3 space-y-2 text-sm">
                    {selected.category && (
                      <div className="flex justify-between items-start gap-2">
                        <span className="text-muted-foreground shrink-0">Kategori</span>
                        <span className="text-right text-xs font-medium">
                          {selected.category === "lainnya" ? (selected.category_other || "Lainnya") : selected.category}
                        </span>
                      </div>
                    )}
                    {selected.purpose && (
                      <div className="flex justify-between items-start gap-2">
                        <span className="text-muted-foreground shrink-0">Tujuan</span>
                        <span className="text-right text-xs max-w-[240px]">{selected.purpose}</span>
                      </div>
                    )}
                    {selected.funding_source_type && (
                      <div className="flex justify-between items-center gap-2">
                        <span className="text-muted-foreground shrink-0">Sumber Dana</span>
                        <Badge className={cn("text-[10px] border", FUNDING_SOURCE_COLORS[selected.funding_source_type] ?? "bg-muted border-border")}>
                          {FUNDING_SOURCE_LABELS[selected.funding_source_type] ?? selected.funding_source_type}
                        </Badge>
                      </div>
                    )}
                    {/* Detail sumber dana: prioritas nama resolved dari JOIN, lalu text field */}
                    {(selected.source_company_name || selected.source_bank_name || selected.source_party_name) && (
                      <div className="flex justify-between items-start gap-2">
                        <span className="text-muted-foreground shrink-0">Detail Sumber</span>
                        <span className="text-right text-xs">
                          {selected.source_company_name ?? selected.source_bank_name ?? selected.source_party_name}
                        </span>
                      </div>
                    )}
                    {selected.responsible_party_type && (
                      <div className="flex justify-between items-center gap-2">
                        <span className="text-muted-foreground shrink-0">Penanggung</span>
                        <div className="flex items-center gap-1.5">
                          <span className="text-xs font-medium">
                            {selected.responsible_company_name
                              ?? selected.responsible_vendor_name
                              ?? selected.responsible_employee_name
                              ?? selected.responsible_bank_name
                              ?? selected.responsible_party_name
                              ?? (RESPONSIBLE_PARTY_LABELS[selected.responsible_party_type] ?? selected.responsible_party_type)}
                          </span>
                          {!["void","repaid","settled","reversed"].includes(selected.status) && (
                            <Button
                              variant="ghost"
                              size="icon"
                              className="h-5 w-5 text-muted-foreground hover:text-foreground"
                              title="Edit penanggung jawab"
                              onClick={(e) => { e.stopPropagation(); openEditResponsible(); }}
                            >
                              <FileText size={11} />
                            </Button>
                          )}
                        </div>
                      </div>
                    )}
                    {selected.reference_number && (
                      <div className="flex justify-between items-start gap-2">
                        <span className="text-muted-foreground shrink-0">No. Referensi</span>
                        <span className="text-right text-xs font-mono">{selected.reference_number}</span>
                      </div>
                    )}
                  </div>
                )}

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
                      <ShieldCheck size={14} /> Talangan Disetujui — Belum Dicairkan
                    </p>
                    <p className="text-xs text-muted-foreground">Jurnal DR Piutang Dana Talangan / CR Kas-Bank baru diposting saat dana dicairkan.</p>
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
                        {detail.repayments.map((r: any) => {
                          const payerCoName = r.payer_company_id
                            ? (companiesList as any[]).find((c: any) => c.id === r.payer_company_id)?.company_name ?? `Co #${r.payer_company_id}`
                            : null;
                          const receiverCoName = r.receiver_company_id
                            ? (companiesList as any[]).find((c: any) => c.id === r.receiver_company_id)?.company_name ?? `Co #${r.receiver_company_id}`
                            : null;
                          return (
                          <div key={r.id} className="rounded border px-3 py-2 text-xs space-y-1">
                            <div className="flex justify-between items-center">
                              <div className="text-muted-foreground">
                                {r.date} · {(r.payment_method ?? r.paymentMethod) === "cash" ? "💵 Kas" : "🏦 Bank"}
                                {r.notes ? ` · ${r.notes}` : ""}
                              </div>
                              <span className="font-mono text-emerald-400">{idr(Number(r.amount))}</span>
                            </div>
                            {/* Intercompany metadata */}
                            {(payerCoName || receiverCoName) && (
                              <div className="text-[10px] text-muted-foreground flex flex-wrap gap-2">
                                {payerCoName && (
                                  <span className="flex items-center gap-0.5">
                                    <Building2 size={9} className="text-indigo-400" />
                                    <span>Pengembali: <strong>{payerCoName}</strong></span>
                                  </span>
                                )}
                                {receiverCoName && (
                                  <span className="flex items-center gap-0.5">
                                    <Building2 size={9} className="text-emerald-400" />
                                    <span>Penerima: <strong>{receiverCoName}</strong></span>
                                  </span>
                                )}
                              </div>
                            )}
                            {r.payment_reference && (
                              <div className="text-[10px] text-muted-foreground font-mono">
                                Ref: {r.payment_reference}
                              </div>
                            )}
                            {r.intercompany_reference && (
                              <div className="text-[10px] text-indigo-400 font-mono">
                                IC Ref: {r.intercompany_reference}
                              </div>
                            )}
                            {(r.receiptUrl || r.receipt_url) && (
                              <div className="flex items-center gap-1 text-indigo-400">
                                <ExternalLink size={10} />
                                <a
                                  href={`/api/storage/download?key=${encodeURIComponent(r.receiptUrl ?? r.receipt_url)}`}
                                  target="_blank"
                                  rel="noopener noreferrer"
                                  className="hover:underline"
                                >
                                  Lihat bukti pengembalian
                                </a>
                              </div>
                            )}
                          </div>
                          );
                        })}
                      </div>
                    )}
                  </div>
                )}

                {isDisbursedStatus(selected) && (
                  <div className="space-y-3 border-t pt-4">
                    <p className="text-sm font-medium flex items-center gap-2"><RefreshCw size={14} className="text-primary" />Tambah Cicilan</p>
                    <div className="grid grid-cols-2 gap-3">
                      <div className="space-y-1.5">
                        <Label className="text-xs">Nominal <span className="text-destructive">*</span></Label>
                        <Input placeholder="0" className="font-mono h-8 text-sm" value={repAmtRaw} onChange={(e) => setRepAmtRaw(fmtIDR(e.target.value))} />
                      </div>
                      <div className="space-y-1.5">
                        <Label className="text-xs">Tanggal <span className="text-destructive">*</span></Label>
                        <DatePicker value={repDate} onChange={(v) => setRepDate(v)} className="h-8 text-sm" />
                      </div>
                    </div>

                    {/* Perusahaan yang mengembalikan — bisa dipilih */}
                    <div className="space-y-1.5">
                      <Label className="text-xs">Perusahaan yang Mengembalikan</Label>
                      <SearchableSelect
                        triggerClassName="h-8 text-sm"
                        placeholder="Pilih perusahaan pengembali..."
                        searchPlaceholder="Cari nama perusahaan..."
                        emptyText="Perusahaan tidak ditemukan."
                        value={payerCompanyId ? String(payerCompanyId) : ""}
                        onValueChange={(v) => {
                          setPayerCompanyId(v ? Number(v) : null);
                          setRepPayerCoaId(""); // reset COA saat ganti perusahaan
                        }}
                        options={(companiesList as any[]).map((c: any) => ({
                          value: String(c.id),
                          label: c.company_name ?? c.name ?? `Perusahaan #${c.id}`,
                        }))}
                      />
                    </div>
                    <div className="space-y-1.5">
                      <Label className="text-xs">Akun COA Bank/Kas Pengembali <span className="text-destructive">*</span></Label>
                      <SearchableSelect
                        triggerClassName="h-8 text-sm"
                        placeholder="Pilih akun kas/bank perusahaan pengembali..."
                        searchPlaceholder="Cari kode atau nama akun..."
                        emptyText="Akun tidak ditemukan. Pastikan COA Kas/Bank sudah ada untuk perusahaan ini."
                        value={repPayerCoaId}
                        onValueChange={setRepPayerCoaId}
                        options={[
                          ...(payerAccounts as any[]).filter((a: any) => a.account_class === "kas").map((a: any) => ({
                            value: String(a.id), label: `${a.code} – ${a.name}`, sublabel: a.code, group: "💵 Kas",
                          })),
                          ...(payerAccounts as any[]).filter((a: any) => a.account_class === "bank").map((a: any) => ({
                            value: String(a.id), label: `${a.code} – ${a.name}`, sublabel: a.code, group: "🏦 Bank",
                          })),
                        ]}
                      />
                      <p className="text-[10px] text-muted-foreground">
                        {isIntercompanyRepay
                          ? <>Jurnal: <strong>DR Hutang Intercompany</strong> / <strong>CR Kas/Bank Pengembali</strong> di buku {payerCompanyName}</>
                          : <>Akun kas/bank milik <strong>{payerCompanyName}</strong> yang digunakan untuk mengembalikan dana</>}
                      </p>
                    </div>

                    {/* COA Kas/Bank penerima (perusahaan sumber dana talangan) */}
                    <div className="space-y-1.5">
                      <Label className="text-xs">Akun COA Bank/Kas Penerima <span className="text-destructive">*</span></Label>
                      <SearchableSelect
                        triggerClassName="h-8 text-sm"
                        placeholder="Pilih akun COA kas/bank penerima..."
                        searchPlaceholder="Cari kode atau nama akun COA..."
                        emptyText="Akun tidak ditemukan. Pastikan akun Kas/Bank sudah ada di COA."
                        value={repSourceAccountId}
                        onValueChange={setRepSourceAccountId}
                        options={[
                          ...(paymentAccounts as any[]).filter((a: any) => a.account_class === "kas").map((a: any) => ({
                            value: String(a.id), label: `${a.code} – ${a.name}`, sublabel: a.code, group: "💵 Kas",
                          })),
                          ...(paymentAccounts as any[]).filter((a: any) => a.account_class === "bank").map((a: any) => ({
                            value: String(a.id), label: `${a.code} – ${a.name}`, sublabel: a.code, group: "🏦 Bank",
                          })),
                        ]}
                      />
                      {isIntercompanyRepay && (
                        <p className="text-[10px] text-muted-foreground">
                          Jurnal: <strong>DR Kas/Bank Penerima</strong> / <strong>CR Piutang Dana Talangan</strong> di buku perusahaan ini
                        </p>
                      )}
                    </div>

                    {/* Nomor Referensi Transfer */}
                    <div className="space-y-1.5">
                      <Label className="text-xs">Nomor Referensi Transfer</Label>
                      <Input
                        placeholder="Nomor referensi / nomor transfer (opsional)..."
                        className="h-8 text-sm font-mono"
                        value={repRef}
                        onChange={(e) => setRepRef(e.target.value)}
                      />
                    </div>

                    <Input placeholder="Keterangan (opsional)..." className="h-8 text-sm" value={repNotes} onChange={(e) => setRepNotes(e.target.value)} />

                    {/* Upload bukti pengembalian + OCR AI */}
                    <div className="space-y-1.5">
                      <Label className="text-xs flex items-center gap-1.5">
                        Bukti Pengembalian (opsional)
                        <span className="flex items-center gap-0.5 text-[10px] text-violet-400 font-normal">
                          <Sparkles size={9} />OCR AI
                        </span>
                      </Label>
                      {repFile ? (
                        <div className="space-y-1.5">
                          <div className="flex items-center gap-2 rounded border border-emerald-600/40 bg-emerald-900/20 px-3 py-2 text-xs">
                            {repOcrLoading ? (
                              <Loader2 size={11} className="animate-spin text-violet-400 shrink-0" />
                            ) : repOcrResult ? (
                              <Sparkles size={11} className={cn("shrink-0", repOcrResult.confidence === "high" ? "text-emerald-400" : repOcrResult.confidence === "medium" ? "text-amber-400" : "text-muted-foreground")} />
                            ) : null}
                            <span className="truncate flex-1 text-emerald-300">{repFile.name}</span>
                            <button className="text-muted-foreground hover:text-foreground shrink-0" onClick={() => { setRepFile(null); setRepOcrResult(null); }}>
                              <X size={12} />
                            </button>
                          </div>
                          {repOcrLoading && (
                            <p className="text-[10px] text-violet-400 flex items-center gap-1">
                              <Loader2 size={9} className="animate-spin" />
                              AI sedang membaca bukti transfer…
                            </p>
                          )}
                          {repOcrResult && !repOcrLoading && (
                            <div className={cn(
                              "rounded px-2.5 py-2 text-[10px] space-y-0.5 border",
                              repOcrResult.confidence === "high"
                                ? "bg-emerald-900/20 border-emerald-600/30 text-emerald-300"
                                : repOcrResult.confidence === "medium"
                                ? "bg-amber-900/20 border-amber-600/30 text-amber-300"
                                : "bg-muted/30 border-border text-muted-foreground"
                            )}>
                              <p className="flex items-center gap-1 font-medium">
                                <Sparkles size={9} />
                                Hasil OCR AI
                                <span className="ml-1 opacity-70">
                                  ({repOcrResult.confidence === "high" ? "akurasi tinggi" : repOcrResult.confidence === "medium" ? "akurasi sedang" : "akurasi rendah"})
                                </span>
                              </p>
                              {repOcrResult.amount ? (
                                <p>Nominal terdeteksi: <strong className="font-mono">{idr(repOcrResult.amount)}</strong>
                                  {parseIDR(repAmtRaw) === repOcrResult.amount
                                    ? <span className="ml-1 opacity-60">✓ sudah diisi</span>
                                    : <button className="ml-1.5 underline hover:no-underline" onClick={() => setRepAmtRaw(fmtIDR(String(repOcrResult!.amount!)))}>→ pakai nilai ini</button>
                                  }
                                </p>
                              ) : <p className="flex items-center gap-1"><AlertCircle size={9} />Nominal tidak terdeteksi — isi manual.</p>}
                              {repOcrResult.date && <p>Tanggal: <strong>{repOcrResult.date}</strong>
                                {repDate !== repOcrResult.date
                                  ? <button className="ml-1.5 underline hover:no-underline" onClick={() => setRepDate(repOcrResult!.date!)}>→ pakai tanggal ini</button>
                                  : <span className="ml-1 opacity-60">✓ sudah diisi</span>
                                }
                              </p>}
                              {repOcrResult.bankInfo && <p>Info bank: {repOcrResult.bankInfo}</p>}
                            </div>
                          )}
                        </div>
                      ) : (
                        <label className="flex items-center gap-2 cursor-pointer rounded border border-dashed border-muted-foreground/40 px-3 py-2 text-xs text-muted-foreground hover:border-violet-400/50 hover:text-violet-400 transition-colors group">
                          <Sparkles size={11} className="group-hover:text-violet-400" />
                          Upload bukti transfer — AI akan baca nominal otomatis (JPG, PNG, PDF — maks 15 MB)
                          <input
                            type="file"
                            className="hidden"
                            accept=".jpg,.jpeg,.png,.pdf,.webp"
                            onChange={(e) => handleRepFileChange(e.target.files?.[0] ?? null)}
                          />
                        </label>
                      )}
                    </div>

                    <Button size="sm" className="w-full" onClick={handleRepay} disabled={repayMut.isPending || repUploading}>
                      {(repayMut.isPending || repUploading) ? <><Loader2 size={13} className="mr-1 animate-spin" />{repUploading ? "Mengupload bukti..." : "Menyimpan..."}</> : "Catat Cicilan"}
                    </Button>
                  </div>
                )}

                {/* ── Pertanggungjawaban (settle-to-expense, no cash movement) ─
                    Reclasses the remaining receivable straight to an expense
                    account (DR Beban / CR Piutang Dana Talangan) via
                    POST /:id/settle-expense — for when the money was already
                    spent and proven by a receipt, not returned as cash. */}
                {isDisbursedStatus(selected) && (
                  <div className="space-y-3 border-t pt-4">
                    <p className="text-sm font-medium flex items-center gap-2">
                      <FileText size={14} className="text-teal-500" />Pertanggungjawaban (Habis Dibelanjakan)
                    </p>
                    <div className="grid grid-cols-2 gap-3">
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
                        options={(expenseAccounts as any[]).map((a: any) => ({
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
                        Jurnal: <strong>DR Beban</strong> · <strong>CR Piutang Dana Talangan</strong> {idr(parseIDR(settleAmtRaw))}
                      </div>
                    )}
                    <Button size="sm" variant="secondary" className="w-full" onClick={handleSettleExpense} disabled={settleExpenseMut.isPending}>
                      {settleExpenseMut.isPending ? <><Loader2 size={13} className="mr-1 animate-spin" />Menyimpan...</> : "Tutup sebagai Beban"}
                    </Button>
                  </div>
                )}

                {/* Settlement History */}
                {(detail?.settlements?.length ?? 0) > 0 && (
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
                {(detail?.auditLogs?.length ?? 0) > 0 && (
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
                      <Trash2 size={13} className="mr-1" /> Hapus Talangan
                    </Button>
                  </div>
                )}

                {/* Void — jurnal sudah posted (entry_id ada) tapi belum ada cicilan */}
                {selected.status === "active" && (selected.entry_id || selected.entryId) && Number(selected.paid_amount ?? selected.paidAmount) === 0 && (
                  <div className="border-t pt-4 space-y-2">
                    <p className="text-xs text-muted-foreground rounded bg-amber-50 border border-amber-200 px-3 py-2">
                      Dana talangan sudah masuk General Ledger. Gunakan Void/Repayment, bukan Delete.
                    </p>
                    <Button
                      variant="destructive"
                      size="sm"
                      className="w-full"
                      onClick={() => {
                        const reason = window.prompt("Alasan void dana talangan ini?") ?? undefined;
                        voidMut.mutate({ id: selected.id, reason });
                      }}
                      disabled={voidMut.isPending}
                    >
                      <Trash2 size={13} className="mr-1" /> Void Talangan (buat jurnal pembalik)
                    </Button>
                  </div>
                )}

                {/* Sudah ada cicilan — tidak bisa void, arahkan ke repayment */}
                {selected.status === "partial" && (
                  <div className="border-t pt-4">
                    <p className="text-xs text-muted-foreground rounded bg-blue-50 border border-blue-200 px-3 py-2">
                      Dana talangan ini sudah memiliki cicilan — tidak bisa di-void. Selesaikan melalui pelunasan (Repayment) di atas.
                    </p>
                  </div>
                )}
              </div>
            </>
          )}
        </SheetContent>
      </Sheet>

      {/* ── Edit Penanggung Jawab Dialog ─────────────────────────────────────── */}
      <Dialog open={showEditResponsible} onOpenChange={setShowEditResponsible}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <ShieldCheck size={15} /> Ubah Penanggung Jawab
            </DialogTitle>
          </DialogHeader>
          <div className="space-y-4 py-1">
            <div className="space-y-1.5">
              <Label>Jenis Penanggung <span className="text-destructive">*</span></Label>
              <SearchableSelect
                placeholder="Pilih penanggung…"
                searchPlaceholder="Cari penanggung…"
                emptyText="Tidak ditemukan."
                value={editRespSelectKey}
                onValueChange={(v) => {
                  setEditRespSelectKey(v);
                  setEditRespCompanyId(""); setEditRespVendorId("");
                  setEditRespBankName(""); setEditRespPartyName("");
                  if (v.startsWith("co:")) {
                    setEditRespType("perusahaan_lain");
                    setEditRespCompanyId(v.slice(3));
                  } else {
                    setEditRespType(v);
                  }
                }}
                options={[
                  ...(companiesList as any[]).map((c: any) => ({
                    value: `co:${c.id}`,
                    label: c.company_name ?? c.name,
                    group: "🏢 Perusahaan",
                  })),
                  { value: "bank",       label: "🏛️ Bank",              group: "Lainnya" },
                  { value: "vendor",     label: "🤝 Vendor",            group: "Lainnya" },
                  { value: "karyawan",   label: "👤 Karyawan / Direksi", group: "Lainnya" },
                  { value: "pihak_lain", label: "👥 Pihak Lain",        group: "Lainnya" },
                ]}
              />
            </div>
            {editRespType === "perusahaan_lain" && editRespCompanyId && (
              <div className="flex h-9 items-center rounded-md border border-input bg-muted/40 px-3 text-sm text-muted-foreground">
                ✓ {(companiesList as any[]).find((c: any) => String(c.id) === editRespCompanyId)?.company_name
                   ?? (companiesList as any[]).find((c: any) => String(c.id) === editRespCompanyId)?.name
                   ?? "Perusahaan terpilih"}
              </div>
            )}
            {editRespType === "bank" && (
              <div className="space-y-1.5">
                <Label>Nama Bank <span className="text-destructive">*</span></Label>
                <Input placeholder="Contoh: BCA, Mandiri…" value={editRespBankName} onChange={(e) => setEditRespBankName(e.target.value)} />
              </div>
            )}
            {editRespType === "pihak_lain" && (
              <div className="space-y-1.5">
                <Label>Nama Pihak <span className="text-destructive">*</span></Label>
                <Input placeholder="Nama pihak penanggung…" value={editRespPartyName} onChange={(e) => setEditRespPartyName(e.target.value)} />
              </div>
            )}
          </div>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setShowEditResponsible(false)}>Batal</Button>
            <Button
              onClick={handleUpdateResponsible}
              disabled={updateResponsibleMut.isPending || !editRespType}
            >
              {updateResponsibleMut.isPending ? <Loader2 size={13} className="animate-spin mr-1" /> : null}
              Simpan
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ── Reject Dialog ────────────────────────────────────────────────────── */}
      <Dialog open={showRejectDialog} onOpenChange={setShowRejectDialog}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2 text-red-400">
              <AlertTriangle size={16} /> Tolak Dana Talangan
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

      {/* ── Dialog Tambah Kategori Dana Talangan ──────────────────────────── */}
      <Dialog open={showAddCategoryDialog} onOpenChange={(o) => { setShowAddCategoryDialog(o); if (!o) setNewCategoryInput(""); }}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Plus size={16} className="text-primary" />
              Tambah Kategori Baru
            </DialogTitle>
          </DialogHeader>
          <div className="space-y-3 py-2">
            <div className="space-y-1.5">
              <Label>Nama Kategori</Label>
              <Input
                placeholder="Contoh: Sewa Alat, Biaya Legal…"
                value={newCategoryInput}
                onChange={(e) => setNewCategoryInput(e.target.value)}
                onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); handleAddCategory(); } }}
                autoFocus
              />
            </div>
            {customCategories.length > 0 && (
              <div className="space-y-1">
                <p className="text-xs text-muted-foreground">Kategori kustom yang sudah ada:</p>
                <div className="flex flex-wrap gap-1.5">
                  {customCategories.map((cat) => (
                    <span key={cat} className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-muted border text-xs">
                      {cat}
                      <button
                        type="button"
                        className="text-muted-foreground hover:text-destructive"
                        onClick={() => handleDeleteCustomCategory(cat)}
                      >
                        <X size={10} />
                      </button>
                    </span>
                  ))}
                </div>
              </div>
            )}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => { setShowAddCategoryDialog(false); setNewCategoryInput(""); }}>Batal</Button>
            <Button onClick={handleAddCategory} disabled={!newCategoryInput.trim()}>
              <Plus size={14} className="mr-1" />Tambah & Pilih
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

    </AppShell>
  );
}
