/**
 * AI COA Proposals — Task #7 Phase 18
 *
 * List page: /accounting/coa-proposals
 *   ?new=1            → auto-open create dialog
 *   &sourceType=...   → pre-fill (BANK_MUTATION mapped → BANK_RECONCILIATION)
 *   &sourceRecordId=  → pre-fill
 *   &intent=          → detectedIntent
 *   &description=     → normalizedDescription
 *   &mappingError=    → mappingErrorCode
 *
 * Tabs: Draft | Pending Review | Approved | Implemented | Rejected | All
 */

import { useState, useEffect, useCallback, useRef } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Link, useSearch, useLocation } from "wouter";
import {
  Brain,
  RefreshCw,
  CheckCircle,
  XCircle,
  Clock,
  Archive,
  AlertCircle,
  PlusCircle,
  ExternalLink,
  Info,
  Sparkles,
  ChevronsUpDown,
  Check,
  Pencil,
  ArrowLeft,
} from "lucide-react";

import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
  CommandSeparator,
} from "@/components/ui/command";
import { cn } from "@/lib/utils";

import { useCompany } from "@/contexts/CompanyContext";
import { useToast } from "@/hooks/use-toast";

// ─── Types ────────────────────────────────────────────────────────────────────

interface CoaProposal {
  id: number;
  companyId: number;
  proposalNumber: string;
  status: string;
  proposedCode: string;
  proposedName: string;
  proposedCategory: string;
  proposedNormalBalance: string;
  proposedParentId: number | null;
  detectedIntent: string | null;
  aiConfidence: number | null;
  historicalOccurrences: number | null;
  createdBy: string;
  submittedBy: string | null;
  reviewedBy: string | null;
  approvedBy: string | null;
  financialStatement: string;
  sourceType: string;
  createdAt: string;
  updatedAt: string;
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

/** BANK_MUTATION (used in bank recon UI) → BANK_RECONCILIATION (API enum) */
function mapSourceType(raw: string): string {
  if (raw === "BANK_MUTATION") return "BANK_RECONCILIATION";
  return raw;
}

function statusBadge(status: string) {
  const map: Record<string, { label: string; variant: "default" | "secondary" | "destructive" | "outline" }> = {
    DRAFT:          { label: "Draft",           variant: "secondary" },
    PENDING_REVIEW: { label: "Pending Review",  variant: "outline" },
    APPROVED:       { label: "Approved",        variant: "default" },
    REJECTED:       { label: "Rejected",        variant: "destructive" },
    IMPLEMENTED:    { label: "Implemented",     variant: "default" },
    CANCELLED:      { label: "Cancelled",       variant: "secondary" },
  };
  const cfg = map[status] ?? { label: status, variant: "secondary" as const };
  return <Badge variant={cfg.variant}>{cfg.label}</Badge>;
}

function confidenceBadge(confidence: number | null) {
  if (confidence == null) return <span className="text-muted-foreground text-xs">—</span>;
  const color =
    confidence >= 80 ? "text-green-700 bg-green-50"
    : confidence >= 60 ? "text-yellow-700 bg-yellow-50"
    : "text-red-700 bg-red-50";
  return (
    <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${color}`}>
      {confidence}%
    </span>
  );
}

function fmtDate(s: string) {
  if (!s) return "—";
  return new Date(s).toLocaleDateString("id-ID", { day: "2-digit", month: "short", year: "numeric" });
}

// ─── Fetch helper ─────────────────────────────────────────────────────────────

function useFetchProposals(companyParam: string, status?: string) {
  const url = status
    ? `/api/accounting/coa-proposals?status=${encodeURIComponent(status)}${companyParam ? `&company=${companyParam}` : ""}`
    : `/api/accounting/coa-proposals${companyParam ? `?company=${companyParam}` : ""}`;

  return useQuery<CoaProposal[]>({
    queryKey: ["coa-proposals", companyParam, status],
    queryFn: async () => {
      const res = await fetch(url, { credentials: "include" });
      if (!res.ok) throw new Error("Failed to load proposals");
      return res.json();
    },
    staleTime: 30_000,
  });
}

// ─── Create Proposal Dialog ───────────────────────────────────────────────────

interface CreateProposalDialogProps {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  defaults: {
    intent: string;
    description: string;
    sourceType: string;
    sourceRecordId: string;
    mappingError: string;
  };
  companyParam: string;
  onCreated: (id: number) => void;
  /** Direction hint dari sumber transaksi: "IN" = uang masuk (CREDIT), "OUT" = uang keluar (DEBIT) */
  directionHint?: "IN" | "OUT" | "";
}

const CATEGORY_OPTIONS = [
  { value: "ASSET",             label: "Aset (Asset)" },
  { value: "LIABILITY",         label: "Liabilitas (Liability)" },
  { value: "EQUITY",            label: "Ekuitas (Equity)" },
  { value: "REVENUE",           label: "Pendapatan (Revenue)" },
  { value: "EXPENSE",           label: "Beban (Expense)" },
  { value: "COST_OF_GOODS_SOLD",label: "HPP (COGS)" },
  { value: "OTHER_INCOME",      label: "Pendapatan Lain-lain" },
  { value: "OTHER_EXPENSE",     label: "Beban Lain-lain" },
];

const FS_OPTIONS = [
  { value: "PROFIT_AND_LOSS", label: "Laba Rugi (P&L)" },
  { value: "BALANCE_SHEET",   label: "Neraca (Balance Sheet)" },
  { value: "CASH_FLOW_SUPPORT", label: "Arus Kas" },
  { value: "OFF_STATEMENT",   label: "Off-Statement" },
];

interface AiSuggestion {
  proposedName: string;
  proposedCode: string;
  proposedCategory: string;
  proposedNormalBalance: "DEBIT" | "CREDIT";
  financialStatement: string;
  confidence: number;
  reason: string[];
}

interface ExistingCoa {
  id: number;
  code: string;
  name: string;
  type?: string | null;
  accountCategory?: string | null;
  normalBalance?: string | null;
  isActive?: boolean | null;
  isHeader?: boolean | null;
}

/**
 * Infer normalBalance from Indonesian COA code prefix when the DB field is null.
 * Convention: 1=Asset(D), 2=Liability(C), 3=Equity(C), 4=Revenue(C), 5=Expense(D), 6=COGS(D)
 */
function inferNormalBalanceFromCode(code: string): "DEBIT" | "CREDIT" | null {
  const prefix = code.trim().split("-")[0];
  if (["1", "5", "6"].includes(prefix)) return "DEBIT";
  if (["2", "3", "4"].includes(prefix)) return "CREDIT";
  return null;
}

/**
 * Infer accountCategory from Indonesian COA code prefix when the DB field is null.
 * Convention: 1=ASSET, 2=LIABILITY, 3=EQUITY, 4=REVENUE, 5=EXPENSE, 6=COST_OF_GOODS_SOLD
 */
function inferCategoryFromCode(code: string): string | null {
  const prefix = code.trim().split("-")[0];
  const map: Record<string, string> = {
    "1": "ASSET",
    "2": "LIABILITY",
    "3": "EQUITY",
    "4": "REVENUE",
    "5": "EXPENSE",
    "6": "COST_OF_GOODS_SOLD",
  };
  return map[prefix] ?? null;
}

/**
 * Derive which COA account types are relevant from the mapping-error message.
 * Returns an empty array when no hint can be inferred (= show all).
 */
function deriveAllowedTypesFromError(mappingError: string): string[] {
  const lower = mappingError.toLowerCase();
  const types: string[] = [];
  if (/beban|expense/.test(lower))                   types.push("expense");
  if (/utang|hutang|payable|liability|liabilit/.test(lower)) types.push("liability");
  if (/pendapatan|revenue|income/.test(lower))        types.push("revenue");
  if (/aset|asset|kas|bank|piutang|receivable/.test(lower))  types.push("asset");
  if (/ekuitas|equity/.test(lower))                   types.push("equity");
  return types;
}

function CreateProposalDialog({
  open,
  onOpenChange,
  defaults,
  companyParam,
  onCreated,
  directionHint = "",
}: CreateProposalDialogProps) {
  const { toast } = useToast();
  const qc = useQueryClient();

  const [intent,       setIntent]       = useState(defaults.intent);
  const [description,  setDescription]  = useState(defaults.description);
  const [proposedCode, setProposedCode] = useState("");
  const [proposedName, setProposedName] = useState("");
  const [category,     setCategory]     = useState("");
  const [normalBal,    setNormalBal]    = useState<"DEBIT" | "CREDIT" | "">("");
  const [fsType,       setFsType]       = useState("");
  const [aiSuggestion, setAiSuggestion] = useState<AiSuggestion | null>(null);
  const [aiLoading,    setAiLoading]    = useState(false);
  const autoFetchedRef = useRef<string>("");

  // COA combobox state
  const [acctOpen,        setAcctOpen]        = useState(false);
  const [selectedAcct,    setSelectedAcct]    = useState<ExistingCoa | null>(null);
  const [isNewAcctMode,   setIsNewAcctMode]   = useState(false); // false = select existing, true = create new
  const [showAllCoaTypes, setShowAllCoaTypes] = useState(false);

  // Fetch existing COA accounts
  const { data: coaAccounts = [] } = useQuery<ExistingCoa[]>({
    queryKey: ["/api/accounting/accounts", companyParam],
    queryFn: async () => {
      const params = new URLSearchParams({ limit: "500" });
      if (companyParam) params.set("company", companyParam);
      const res = await fetch(`/api/accounting/accounts?${params}`, { credentials: "include" });
      if (!res.ok) return [];
      const json = await res.json();
      // API may return { data: [...] } or [...] directly
      return Array.isArray(json) ? json : (json.data ?? []);
    },
    enabled: open,
    staleTime: 60_000,
  });

  const activeCoaAccounts = coaAccounts.filter((a) => a.isActive !== false && !a.isHeader);

  // Direction hint → normalBalance filter
  // OUT (uang keluar: biaya/pembayaran) → DEBIT normal balance (ASSET, EXPENSE, COGS)
  // IN  (uang masuk: penerimaan)        → CREDIT normal balance (REVENUE, LIABILITY, EQUITY)
  const directionNormalBalance = directionHint === "OUT" ? "DEBIT"
    : directionHint === "IN"  ? "CREDIT"
    : null;

  // Derive allowed account category types from mapping-error description (lowercase)
  const allowedCoaTypes = deriveAllowedTypesFromError(defaults.mappingError ?? "");

  const filteredCoaAccounts = showAllCoaTypes
    ? activeCoaAccounts
    : activeCoaAccounts.filter((a) => {
        // 1. normalBalance filter (direction-based) — primary signal
        //    Falls back to code-prefix inference when DB field is null so accounts
        //    without a stored normalBalance are still filtered correctly.
        if (directionNormalBalance) {
          const effectiveNb = a.normalBalance || inferNormalBalanceFromCode(a.code);
          if (effectiveNb && effectiveNb !== directionNormalBalance) return false;
        }
        // 2. accountCategory filter (error-text-based) — secondary signal, only when no direction
        if (!directionNormalBalance && allowedCoaTypes.length > 0) {
          if (!allowedCoaTypes.includes((a.accountCategory ?? "").toLowerCase())) return false;
        }
        // 3. User-selected category — filter by accountCategory when user has explicitly chosen one.
        //    Falls back to code-prefix inference; only excludes if category is definitively wrong.
        if (category) {
          const effectiveCat = a.accountCategory || inferCategoryFromCode(a.code);
          if (effectiveCat && effectiveCat !== category) return false;
          // If neither stored nor inferred category is available, keep the account (fail open).
        }
        return true;
      });

  const isFilterActive = !showAllCoaTypes && (directionNormalBalance != null || allowedCoaTypes.length > 0 || !!category);
  const directionLabel = directionHint === "OUT" ? "Beban / Aset (DEBIT)"
    : directionHint === "IN"  ? "Pendapatan / Kewajiban (CREDIT)"
    : null;

  // Reset form when defaults change (e.g. navigating from a new mutation)
  useEffect(() => {
    setIntent(defaults.intent);
    setDescription(defaults.description);
    setProposedCode("");
    setProposedName("");
    setCategory("");
    setNormalBal("");
    setFsType("");
    setAiSuggestion(null);
    setSelectedAcct(null);
    setIsNewAcctMode(false);
    autoFetchedRef.current = "";
  }, [defaults.intent, defaults.description, defaults.sourceRecordId]);

  // Handle selecting an existing COA account
  function handleSelectExistingAcct(acct: ExistingCoa) {
    setSelectedAcct(acct);
    setProposedCode(acct.code);
    setProposedName(acct.name);
    // Also fill category/normalBalance from the account if available
    if (acct.accountCategory) setCategory(acct.accountCategory);
    if (acct.normalBalance === "DEBIT" || acct.normalBalance === "CREDIT") setNormalBal(acct.normalBalance);
    setAcctOpen(false);
    setIsNewAcctMode(false);
  }

  // Handle switching to "create new" mode
  function handleNewAcctMode() {
    setSelectedAcct(null);
    setIsNewAcctMode(true);
    setAcctOpen(false);
    // Keep AI-suggested values in inputs
  }

  // Auto-fetch AI suggestion when dialog opens
  useEffect(() => {
    const key = `${defaults.intent}|${defaults.description}|${defaults.sourceRecordId}`;
    if (!open || !defaults.intent || autoFetchedRef.current === key) return;
    autoFetchedRef.current = key;

    setAiLoading(true);
    const url = `/api/accounting/coa-proposals/suggest${companyParam ? `?company=${companyParam}` : ""}`;
    fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      credentials: "include",
      body: JSON.stringify({
        detectedIntent: defaults.intent,
        normalizedDescription: defaults.description,
        mappingErrorCode: defaults.mappingError || undefined,
        aiConfidence: 50,
        historicalOccurrences: 0,
      }),
    })
      .then((r) => r.ok ? r.json() : Promise.reject(r))
      .then((data: AiSuggestion) => {
        setAiSuggestion(data);
        // Auto-fill all fields with AI suggestions — but only if user hasn't manually selected an account
        setProposedName((prev) => prev || data.proposedName);
        setProposedCode((prev) => prev || data.proposedCode);
        if (data.proposedCategory)      setCategory((prev) => prev || data.proposedCategory);
        if (data.proposedNormalBalance) setNormalBal((prev) => prev || data.proposedNormalBalance);
        if (data.financialStatement)    setFsType((prev) => prev || data.financialStatement);
        // Switch to new mode if AI provided suggestions (unless user already selected an account)
        setIsNewAcctMode((prev) => prev || Boolean(data.proposedCode || data.proposedName));
      })
      .catch(() => {
        // silently fail — user can fill manually
      })
      .finally(() => setAiLoading(false));
  }, [open, defaults.intent, defaults.description, defaults.mappingError, defaults.sourceRecordId, companyParam]);

  const createMut = useMutation({
    mutationFn: async () => {
      const idempotencyKey = `${defaults.sourceType}-${defaults.sourceRecordId}-${Date.now()}`;
      const body: Record<string, unknown> = {
        detectedIntent:        intent.trim(),
        normalizedDescription: description.trim(),
        idempotencyKey,
        sourceType:    defaults.sourceType ? mapSourceType(defaults.sourceType) : "MANUAL",
        sourceRecordId: defaults.sourceRecordId || undefined,
        mappingErrorCode: defaults.mappingError || undefined,
        proposedCode:   proposedCode.trim() || undefined,
        proposedName:   proposedName.trim() || undefined,
        proposedCategory: category || undefined,
        proposedNormalBalance: normalBal || undefined,
        financialStatement: fsType || undefined,
      };
      const url = `/api/accounting/coa-proposals${companyParam ? `?company=${companyParam}` : ""}`;
      const res = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify(body),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error((err as any).error ?? "Gagal membuat proposal");
      }
      return res.json() as Promise<CoaProposal>;
    },
    onSuccess: (data) => {
      toast({ title: "Proposal berhasil dibuat ✓", description: `Draft ${data.proposalNumber}` });
      qc.invalidateQueries({ queryKey: ["coa-proposals"] });
      onOpenChange(false);
      onCreated(data.id);
    },
    onError: (err: Error) => {
      toast({ title: "Gagal membuat proposal", description: err.message, variant: "destructive" });
    },
  });

  const canSubmit = intent.trim().length > 0;

  const aiFilledAny = aiSuggestion !== null;
  const confidenceColor =
    (aiSuggestion?.confidence ?? 0) >= 80 ? "text-green-700 bg-green-50 border-green-200"
    : (aiSuggestion?.confidence ?? 0) >= 60 ? "text-yellow-700 bg-yellow-50 border-yellow-200"
    : "text-red-700 bg-red-50 border-red-200";

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg flex flex-col max-h-[90vh]">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Brain className="h-5 w-5 text-indigo-600" />
            Buat Proposal COA Baru
          </DialogTitle>
        </DialogHeader>

        <div className="space-y-4 py-1 overflow-y-auto flex-1 pr-1">
          {/* Context info from source */}
          {(defaults.sourceRecordId || defaults.mappingError) && (
            <div className="bg-amber-50 border border-amber-200 rounded-lg p-3 space-y-1">
              <p className="text-xs font-semibold text-amber-800 flex items-center gap-1">
                <Info className="h-3.5 w-3.5" />
                Konteks dari Bank Rekonsiliasi
              </p>
              {defaults.sourceRecordId && (
                <p className="text-xs text-amber-700">
                  <span className="font-medium">Mutasi:</span>{" "}
                  <span className="font-mono">{defaults.sourceRecordId}</span>
                </p>
              )}
              {defaults.mappingError && (
                <p className="text-xs text-amber-700">
                  <span className="font-medium">Error:</span> {defaults.mappingError}
                </p>
              )}
            </div>
          )}

          {/* AI suggestion status bar */}
          {aiLoading && (
            <div className="flex items-center gap-2 text-xs text-indigo-600 bg-indigo-50 border border-indigo-200 rounded-lg px-3 py-2">
              <Sparkles className="h-3.5 w-3.5 animate-pulse" />
              <span>AI sedang menganalisis transaksi dan mengisi field…</span>
            </div>
          )}
          {!aiLoading && aiFilledAny && (
            <div className={`flex items-center gap-2 text-xs rounded-lg px-3 py-2 border ${confidenceColor}`}>
              <Sparkles className="h-3.5 w-3.5 shrink-0" />
              <span>
                Field diisi otomatis oleh AI dengan kepercayaan{" "}
                <strong>{aiSuggestion!.confidence}%</strong>.{" "}
                Periksa dan koreksi bila perlu.
              </span>
            </div>
          )}

          {/* Intent (required) */}
          <div className="space-y-1.5">
            <Label className="text-xs font-medium">
              Detected Intent <span className="text-red-500">*</span>
            </Label>
            <Input
              value={intent}
              onChange={(e) => setIntent(e.target.value)}
              placeholder="misal: JOURNAL_MAPPING_REQUIRED, biaya pajak, dll."
              className="h-8 text-sm"
              // eslint-disable-next-line jsx-a11y/no-autofocus
              autoFocus
            />
            <p className="text-[11px] text-muted-foreground">
              Kode error atau intent transaksi yang menjadi alasan pembuatan COA baru.
            </p>
          </div>

          {/* Description */}
          <div className="space-y-1.5">
            <Label className="text-xs font-medium">Deskripsi Transaksi</Label>
            <Textarea
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="Deskripsi mutasi/transaksi asal..."
              className="text-sm resize-none"
              rows={2}
            />
          </div>

          {/* Akun COA — pilih dari daftar atau buat baru */}
          <div className="space-y-1.5">
            <div className="flex items-center justify-between">
              <Label className="text-xs font-medium flex items-center gap-1">
                Akun COA (opsional)
                {!aiLoading && aiFilledAny && (proposedCode || proposedName) && !selectedAcct && (
                  <Sparkles className="h-3 w-3 text-indigo-400" />
                )}
              </Label>
              {/* Toggle between modes */}
              {isNewAcctMode ? (
                <button
                  type="button"
                  className="text-[11px] text-indigo-600 hover:underline flex items-center gap-1"
                  onClick={() => { setIsNewAcctMode(false); setProposedCode(""); setProposedName(""); setSelectedAcct(null); }}
                >
                  ← Pilih dari daftar
                </button>
              ) : (
                <button
                  type="button"
                  className="text-[11px] text-indigo-600 hover:underline flex items-center gap-1"
                  onClick={handleNewAcctMode}
                >
                  <PlusCircle className="h-3 w-3" /> Buat akun baru
                </button>
              )}
            </div>

            {!isNewAcctMode ? (
              /* ── Combobox: select existing account ── */
              <Popover open={acctOpen} onOpenChange={setAcctOpen} modal={true}>
                <PopoverTrigger asChild>
                  <Button
                    variant="outline"
                    role="combobox"
                    aria-expanded={acctOpen}
                    className="w-full justify-between font-normal h-9 text-sm"
                  >
                    {selectedAcct ? (
                      <span className="flex items-center gap-2 truncate">
                        <span className="font-mono text-xs text-muted-foreground">{selectedAcct.code}</span>
                        <span className="truncate">{selectedAcct.name}</span>
                      </span>
                    ) : (
                      <span className="text-muted-foreground">Pilih akun yang sudah ada…</span>
                    )}
                    <ChevronsUpDown className="ml-2 h-4 w-4 shrink-0 opacity-50" />
                  </Button>
                </PopoverTrigger>
                <PopoverContent className="w-[440px] p-0" align="start" side="bottom" avoidCollisions>
                  <Command>
                    <CommandInput placeholder="Cari kode atau nama akun…" className="h-9" />
                    {/* Filter badge — visible when direction, type hint, or category is active */}
                    {(directionNormalBalance != null || allowedCoaTypes.length > 0 || !!category) && (
                      <div className="flex items-center justify-between px-3 py-1.5 border-b bg-amber-50">
                        <span className="text-[11px] text-amber-700 flex items-center gap-1 flex-wrap">
                          <span>Filter:</span>
                          {directionLabel && (
                            <span className="font-medium">{directionLabel}</span>
                          )}
                          {category && (
                            <span className="font-medium">
                              {CATEGORY_OPTIONS.find((o) => o.value === category)?.label ?? category}
                            </span>
                          )}
                          {!directionLabel && !category && allowedCoaTypes.map((t) => (
                            <span key={t} className="font-medium capitalize">{t}</span>
                          )).reduce((acc: React.ReactNode[], el, i) => i === 0 ? [el] : [...acc, <span key={`sep-${i}`} className="text-amber-400">·</span>, el], [])}
                          {showAllCoaTypes && <span className="text-amber-400 ml-1">(dinonaktifkan)</span>}
                        </span>
                        <button
                          type="button"
                          className="text-[11px] text-indigo-600 hover:underline"
                          onClick={() => setShowAllCoaTypes((v) => !v)}
                        >
                          {showAllCoaTypes ? "Aktifkan filter" : "Tampilkan semua"}
                        </button>
                      </div>
                    )}
                    <CommandList className="max-h-56">
                      <CommandEmpty>
                        <div className="flex flex-col items-center gap-1 py-2">
                          <span className="text-xs text-muted-foreground">Akun tidak ditemukan.</span>
                          {isFilterActive && (
                            <button
                              type="button"
                              className="text-[11px] text-indigo-600 hover:underline"
                              onClick={() => setShowAllCoaTypes(true)}
                            >
                              Tampilkan semua akun
                            </button>
                          )}
                        </div>
                      </CommandEmpty>
                      <CommandGroup heading={
                        isFilterActive
                          ? `Akun relevan (${filteredCoaAccounts.length})`
                          : "Akun yang ada"
                      }>
                        {filteredCoaAccounts.map((a) => (
                          <CommandItem
                            key={a.id}
                            value={`${a.code} ${a.name}`}
                            onSelect={() => handleSelectExistingAcct(a)}
                            className="text-sm"
                          >
                            <Check
                              className={cn(
                                "mr-2 h-4 w-4 shrink-0",
                                selectedAcct?.id === a.id ? "opacity-100" : "opacity-0",
                              )}
                            />
                            <span className="font-mono text-xs text-muted-foreground mr-2 shrink-0">{a.code}</span>
                            <span className="truncate">{a.name}</span>
                          </CommandItem>
                        ))}
                      </CommandGroup>
                      <CommandSeparator />
                      <CommandGroup>
                        <CommandItem
                          value="__new__"
                          onSelect={handleNewAcctMode}
                          className="text-sm text-indigo-600"
                        >
                          <PlusCircle className="mr-2 h-4 w-4" />
                          Buat Akun COA Baru…
                        </CommandItem>
                      </CommandGroup>
                    </CommandList>
                  </Command>
                </PopoverContent>
              </Popover>
            ) : (
              /* ── New account mode: code + name text inputs ── */
              <div className="space-y-2">
                <div className="grid grid-cols-2 gap-2">
                  <div className="space-y-1">
                    <Label className="text-[11px] text-muted-foreground">Kode Akun</Label>
                    <Input
                      value={proposedCode}
                      onChange={(e) => setProposedCode(e.target.value)}
                      placeholder="misal: 6-1234"
                      className="h-8 text-sm font-mono"
                    />
                  </div>
                  <div className="space-y-1">
                    <Label className="text-[11px] text-muted-foreground">Nama Akun</Label>
                    <Input
                      value={proposedName}
                      onChange={(e) => setProposedName(e.target.value)}
                      placeholder="misal: Beban Pajak Lain-lain"
                      className="h-8 text-sm"
                    />
                  </div>
                </div>
                <p className="text-[11px] text-muted-foreground">
                  Kode dan nama akan diusulkan ke admin untuk persetujuan sebelum dibuat.
                </p>
              </div>
            )}

            {/* Show selected account detail */}
            {selectedAcct && !isNewAcctMode && (
              <div className="flex items-center justify-between bg-muted/50 rounded px-2.5 py-1.5 text-xs">
                <div className="flex items-center gap-2 min-w-0">
                  <span className="font-mono text-muted-foreground shrink-0">{selectedAcct.code}</span>
                  <span className="truncate font-medium">{selectedAcct.name}</span>
                </div>
                <button
                  type="button"
                  className="ml-2 shrink-0 text-muted-foreground hover:text-foreground"
                  onClick={() => setAcctOpen(true)}
                >
                  <Pencil className="h-3 w-3" />
                </button>
              </div>
            )}
          </div>

          {/* Category + Normal Balance */}
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label className="text-xs font-medium flex items-center gap-1">
                Kategori
                {!aiLoading && aiFilledAny && category && (
                  <Sparkles className="h-3 w-3 text-indigo-400" />
                )}
              </Label>
              <Select value={category} onValueChange={setCategory}>
                <SelectTrigger className="h-8 text-sm">
                  <SelectValue placeholder="Pilih kategori" />
                </SelectTrigger>
                <SelectContent>
                  {CATEGORY_OPTIONS.map((o) => (
                    <SelectItem key={o.value} value={o.value} className="text-sm">
                      {o.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs font-medium flex items-center gap-1">
                Normal Balance
                {!aiLoading && aiFilledAny && normalBal && (
                  <Sparkles className="h-3 w-3 text-indigo-400" />
                )}
              </Label>
              <Select value={normalBal} onValueChange={(v) => setNormalBal(v as "DEBIT" | "CREDIT")}>
                <SelectTrigger className="h-8 text-sm">
                  <SelectValue placeholder="Debit / Kredit" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="DEBIT" className="text-sm">Debit</SelectItem>
                  <SelectItem value="CREDIT" className="text-sm">Kredit (Credit)</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>

          {/* Financial Statement */}
          <div className="space-y-1.5">
            <Label className="text-xs font-medium flex items-center gap-1">
              Laporan Keuangan
              {!aiLoading && aiFilledAny && fsType && (
                <Sparkles className="h-3 w-3 text-indigo-400" />
              )}
            </Label>
            <Select value={fsType} onValueChange={setFsType}>
              <SelectTrigger className="h-8 text-sm">
                <SelectValue placeholder="Pilih laporan" />
              </SelectTrigger>
              <SelectContent>
                {FS_OPTIONS.map((o) => (
                  <SelectItem key={o.value} value={o.value} className="text-sm">
                    {o.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          {/* AI reasoning (collapsed, show when filled) */}
          {!aiLoading && aiSuggestion?.reason?.length ? (
            <p className="text-[11px] text-muted-foreground bg-muted/40 rounded px-2 py-1.5">
              <strong>Alasan AI:</strong> {aiSuggestion.reason.slice(0, 2).join(" · ")}
            </p>
          ) : null}

          <p className="text-[11px] text-muted-foreground border-t pt-2">
            Proposal akan tersimpan sebagai <strong>Draft</strong>. Anda perlu men-submit dan mendapatkan
            approval dari admin sebelum akun COA baru dibuat.
          </p>
        </div>

        <DialogFooter>
          <Button variant="outline" size="sm" onClick={() => onOpenChange(false)} disabled={createMut.isPending}>
            Batal
          </Button>
          <Button
            size="sm"
            onClick={() => createMut.mutate()}
            disabled={!canSubmit || createMut.isPending || aiLoading}
            className="gap-1.5"
          >
            {createMut.isPending ? (
              <RefreshCw className="h-3.5 w-3.5 animate-spin" />
            ) : (
              <PlusCircle className="h-3.5 w-3.5" />
            )}
            Simpan sebagai Draft
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ─── Proposal Table ───────────────────────────────────────────────────────────

function ProposalTable({ proposals, loading }: { proposals: CoaProposal[]; loading: boolean }) {
  const [search, setSearch] = useState("");

  const filtered = proposals.filter(
    (p) =>
      !search ||
      p.proposedName.toLowerCase().includes(search.toLowerCase()) ||
      p.proposedCode.toLowerCase().includes(search.toLowerCase()) ||
      p.proposalNumber.toLowerCase().includes(search.toLowerCase()) ||
      (p.detectedIntent ?? "").toLowerCase().includes(search.toLowerCase()),
  );

  if (loading) {
    return (
      <div className="flex items-center gap-2 text-muted-foreground py-8 justify-center">
        <RefreshCw className="h-4 w-4 animate-spin" />
        <span>Loading...</span>
      </div>
    );
  }

  return (
    <div className="space-y-3">
      <Input
        placeholder="Cari proposal, kode, intent..."
        value={search}
        onChange={(e) => setSearch(e.target.value)}
        className="max-w-sm text-sm"
      />

      {filtered.length === 0 ? (
        <div className="text-center py-12 text-muted-foreground text-sm">
          <Brain className="h-8 w-8 mx-auto mb-2 opacity-30" />
          <p>Tidak ada proposal ditemukan.</p>
        </div>
      ) : (
        <div className="rounded-md border overflow-x-auto">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="text-xs">Nomor Proposal</TableHead>
                <TableHead className="text-xs">Kode</TableHead>
                <TableHead className="text-xs">Nama Akun</TableHead>
                <TableHead className="text-xs">Kategori</TableHead>
                <TableHead className="text-xs">Normal Bal.</TableHead>
                <TableHead className="text-xs">Intent</TableHead>
                <TableHead className="text-xs">Confidence</TableHead>
                <TableHead className="text-xs">Historis</TableHead>
                <TableHead className="text-xs">Status</TableHead>
                <TableHead className="text-xs">Maker</TableHead>
                <TableHead className="text-xs">Dibuat</TableHead>
                <TableHead className="text-xs">Aksi</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {filtered.map((p) => (
                <TableRow key={p.id} className="hover:bg-muted/30">
                  <TableCell className="text-xs font-mono">{p.proposalNumber}</TableCell>
                  <TableCell className="text-xs font-mono">{p.proposedCode || "—"}</TableCell>
                  <TableCell className="text-xs font-medium max-w-[200px] truncate">{p.proposedName}</TableCell>
                  <TableCell className="text-xs">{p.proposedCategory}</TableCell>
                  <TableCell className="text-xs">{p.proposedNormalBalance}</TableCell>
                  <TableCell className="text-xs text-muted-foreground max-w-[120px] truncate">
                    {p.detectedIntent ?? "—"}
                  </TableCell>
                  <TableCell>{confidenceBadge(p.aiConfidence)}</TableCell>
                  <TableCell className="text-xs">{p.historicalOccurrences ?? 0}x</TableCell>
                  <TableCell>{statusBadge(p.status)}</TableCell>
                  <TableCell className="text-xs text-muted-foreground max-w-[100px] truncate">
                    {p.createdBy}
                  </TableCell>
                  <TableCell className="text-xs text-muted-foreground">{fmtDate(p.createdAt)}</TableCell>
                  <TableCell>
                    <Link href={`/accounting/coa-proposals/${p.id}`}>
                      <Button variant="ghost" size="sm" className="h-7 px-2 text-xs gap-1">
                        <ExternalLink className="h-3 w-3" />
                        Detail
                      </Button>
                    </Link>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}
    </div>
  );
}

// ─── Main Page ────────────────────────────────────────────────────────────────

export default function CoaProposalsPage() {
  const { companyQueryParam } = useCompany();
  const qc = useQueryClient();
  const search = useSearch();
  const [, setLocation] = useLocation();

  // Parse URL search params
  const params = new URLSearchParams(search);
  const isNew         = params.get("new") === "1";
  const urlIntent     = params.get("intent")        ?? "";
  const urlDesc       = params.get("description")   ?? "";
  const urlSourceType = params.get("sourceType")    ?? "";
  const urlSourceId   = params.get("sourceRecordId")  ?? "";
  const urlMappingErr = params.get("mappingError")  ?? "";
  const urlDirection  = (params.get("direction") ?? "") as "IN" | "OUT" | "";

  const [showCreate, setShowCreate] = useState(false);

  // Auto-open create dialog when ?new=1 is present
  useEffect(() => {
    if (isNew) setShowCreate(true);
  }, [isNew]);

  const allQ      = useFetchProposals(companyQueryParam);
  const draftQ    = useFetchProposals(companyQueryParam, "DRAFT");
  const pendingQ  = useFetchProposals(companyQueryParam, "PENDING_REVIEW");
  const approvedQ = useFetchProposals(companyQueryParam, "APPROVED");
  const implQ     = useFetchProposals(companyQueryParam, "IMPLEMENTED");
  const rejQ      = useFetchProposals(companyQueryParam, "REJECTED");

  function refresh() {
    qc.invalidateQueries({ queryKey: ["coa-proposals"] });
  }

  const handleCreated = useCallback((id: number) => {
    // Navigate to the new proposal's detail page
    setLocation(`/accounting/coa-proposals/${id}`);
  }, [setLocation]);

  const handleCreateOpenChange = useCallback((v: boolean) => {
    setShowCreate(v);
    // Remove ?new=1 and other create params from URL when dialog closes
    if (!v && isNew) {
      setLocation("/accounting/coa-proposals");
    }
  }, [isNew, setLocation]);

  return (
    <div className="p-6 space-y-4">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <Button
            variant="ghost"
            size="sm"
            onClick={() =>
              setLocation(urlSourceId ? "/accounting/bank-reconciliation" : "/accounting")
            }
            className="gap-1.5 text-muted-foreground hover:text-foreground"
          >
            <ArrowLeft className="h-4 w-4" />
            Back
          </Button>
          <Brain className="h-6 w-6 text-indigo-600" />
          <div>
            <h1 className="text-xl font-semibold">AI COA Proposals</h1>
            <p className="text-sm text-muted-foreground">
              Proposal akun baru yang diusulkan AI — membutuhkan approval sebelum dibuat
            </p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <Button variant="outline" size="sm" onClick={refresh} className="gap-1.5">
            <RefreshCw className="h-3.5 w-3.5" />
            Refresh
          </Button>
          <Button size="sm" onClick={() => setShowCreate(true)} className="gap-1.5">
            <PlusCircle className="h-3.5 w-3.5" />
            Buat Proposal
          </Button>
        </div>
      </div>

      {/* Info banner */}
      <div className="bg-indigo-50 border border-indigo-200 rounded-lg p-3 flex items-start gap-2">
        <AlertCircle className="h-4 w-4 text-indigo-600 flex-shrink-0 mt-0.5" />
        <div className="text-xs text-indigo-700 space-y-0.5">
          <p className="font-semibold">Governance: AI tidak membuat COA secara otomatis</p>
          <p>
            Setiap proposal membutuhkan <strong>maker → submit → admin approve → implement</strong>.
            Implementasi proposal tetap melewati flow Task #5 (COA change request).
          </p>
        </div>
      </div>

      {/* Tabs */}
      <Tabs defaultValue="all">
        <TabsList className="text-xs">
          <TabsTrigger value="draft" className="text-xs gap-1.5">
            <Clock className="h-3.5 w-3.5" />
            Draft
            {draftQ.data && draftQ.data.length > 0 && (
              <Badge variant="secondary" className="text-xs px-1 py-0">{draftQ.data.length}</Badge>
            )}
          </TabsTrigger>
          <TabsTrigger value="pending" className="text-xs gap-1.5">
            <AlertCircle className="h-3.5 w-3.5 text-amber-500" />
            Pending Review
            {pendingQ.data && pendingQ.data.length > 0 && (
              <Badge variant="outline" className="text-xs px-1 py-0 text-amber-700 border-amber-400">
                {pendingQ.data.length}
              </Badge>
            )}
          </TabsTrigger>
          <TabsTrigger value="approved" className="text-xs gap-1.5">
            <CheckCircle className="h-3.5 w-3.5 text-green-600" />
            Approved
          </TabsTrigger>
          <TabsTrigger value="implemented" className="text-xs gap-1.5">
            <Archive className="h-3.5 w-3.5 text-blue-600" />
            Implemented
          </TabsTrigger>
          <TabsTrigger value="rejected" className="text-xs gap-1.5">
            <XCircle className="h-3.5 w-3.5 text-red-500" />
            Rejected
          </TabsTrigger>
          <TabsTrigger value="all" className="text-xs">All</TabsTrigger>
        </TabsList>

        <TabsContent value="draft" className="mt-4">
          <ProposalTable proposals={draftQ.data ?? []} loading={draftQ.isLoading} />
        </TabsContent>
        <TabsContent value="pending" className="mt-4">
          <ProposalTable proposals={pendingQ.data ?? []} loading={pendingQ.isLoading} />
        </TabsContent>
        <TabsContent value="approved" className="mt-4">
          <ProposalTable proposals={approvedQ.data ?? []} loading={approvedQ.isLoading} />
        </TabsContent>
        <TabsContent value="implemented" className="mt-4">
          <ProposalTable proposals={implQ.data ?? []} loading={implQ.isLoading} />
        </TabsContent>
        <TabsContent value="rejected" className="mt-4">
          <ProposalTable proposals={rejQ.data ?? []} loading={rejQ.isLoading} />
        </TabsContent>
        <TabsContent value="all" className="mt-4">
          <ProposalTable proposals={allQ.data ?? []} loading={allQ.isLoading} />
        </TabsContent>
      </Tabs>

      {/* Create Proposal Dialog */}
      <CreateProposalDialog
        open={showCreate}
        onOpenChange={handleCreateOpenChange}
        defaults={{
          intent:       urlIntent,
          description:  urlDesc,
          sourceType:   urlSourceType,
          sourceRecordId: urlSourceId,
          mappingError: urlMappingErr,
        }}
        companyParam={companyQueryParam}
        onCreated={handleCreated}
        directionHint={urlDirection}
      />
    </div>
  );
}
