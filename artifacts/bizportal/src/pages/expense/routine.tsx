import { useState, useMemo, useEffect } from "react";
import { Link } from "wouter";
import { DatePicker } from "@/components/ui/date-picker";
import { AppShell } from "@/components/layout/AppShell";
import { AccountCombobox } from "@/components/accounting/AccountCombobox";
import { SearchableSelect } from "@/components/ui/searchable-select";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import {
  Tooltip, TooltipContent, TooltipProvider, TooltipTrigger,
} from "@/components/ui/tooltip";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Command, CommandEmpty, CommandInput, CommandItem, CommandList, CommandGroup, CommandSeparator } from "@/components/ui/command";
import {
  useListTaxes, useListExpenses,
  useListSuppliers,
  getListExpensesQueryKey, getListSuppliersQueryKey,
} from "@workspace/api-client-react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useToast } from "@/hooks/use-toast";
import { useCompany } from "@/contexts/CompanyContext";
import {
  Zap, ArrowLeft, Loader2, Coffee, Home, Cpu, Lightbulb, Smile,
  MoreHorizontal, BookOpen, Receipt, Info, LayoutTemplate, RefreshCw,
  CheckCircle2, AlertCircle, ScanLine, ChevronsUpDown, Check, User, Building2,
} from "lucide-react";
import { ScanDocumentDialog } from "@/components/ScanDocumentDialog";
import { cn } from "@/lib/utils";

const idr = (n: number) =>
  new Intl.NumberFormat("id-ID", { style: "currency", currency: "IDR", maximumFractionDigits: 0 }).format(n);

const formatIDRInput = (raw: string) => {
  const digits = raw.replace(/\D/g, "");
  if (!digits) return "";
  return Number(digits).toLocaleString("id-ID");
};

const parseIDR = (v: string) => {
  const n = Number(v.replace(/\D/g, ""));
  return isNaN(n) ? 0 : n;
};

const PRESET_CODES = [
  { code: "ENTERTAINMENT",  label: "Entertainment",   icon: Smile,         color: "text-purple-400" },
  { code: "MAKAN_MINUM",   label: "Makan & Minum",   icon: Coffee,        color: "text-amber-400" },
  { code: "SEWA_KANTOR",   label: "Sewa Kantor",     icon: Home,          color: "text-blue-400" },
  { code: "UTILITAS",      label: "Utilitas",         icon: Lightbulb,    color: "text-yellow-400" },
  { code: "PERALATAN",     label: "Peralatan & ATK", icon: Cpu,           color: "text-teal-400" },
  { code: "LAIN_LAIN",     label: "Lain-lain",       icon: MoreHorizontal, color: "text-slate-400" },
];

const STATUS_COLORS: Record<string, string> = {
  draft:            "bg-slate-800 text-slate-300 border-slate-600",
  submitted:        "bg-sky-900/40 text-sky-300 border-sky-600",
  approved:         "bg-indigo-900/40 text-indigo-300 border-indigo-600",
  posted:           "bg-emerald-900/40 text-emerald-300 border-emerald-600",
  paid:             "bg-green-900/50 text-green-300 border-green-600",
  rejected:         "bg-red-900/40 text-red-300 border-red-600",
  pending_approval: "bg-orange-900/40 text-orange-300 border-orange-600",
};
const STATUS_LABELS: Record<string, string> = {
  draft: "Draft", submitted: "Diajukan", approved: "Disetujui",
  posted: "Diposting", paid: "Lunas", rejected: "Ditolak",
  pending_approval: "Menunggu Approval",
};

async function postQuickExpense(payload: {
  date: string; categoryId: number; amount: number;
  vendorEmployee?: string; notes?: string;
  taxRateId?: number | null; paymentMethod: "cash" | "bank"; company?: number;
  sourceAccountId?: number | null; debitAccountId?: number | null;
}) {
  const res = await fetch(`/api/expenses/quick${payload.company ? `?company=${payload.company}` : ""}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    credentials: "include",
    body: JSON.stringify(payload),
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.message ?? "Gagal menyimpan expense.");
  return data;
}

async function fetchTemplates(companyId?: number | null) {
  const url = `/api/expense-templates${companyId ? `?company=${companyId}` : ""}`;
  const res = await fetch(url, { credentials: "include" });
  if (!res.ok) return [];
  return res.json() as Promise<any[]>;
}

async function fetchAccounts(companyId?: number | null) {
  const url = `/api/accounting/accounts${companyId ? `?company=${companyId}` : ""}`;
  const res = await fetch(url, { credentials: "include" });
  if (!res.ok) return [];
  return res.json() as Promise<any[]>;
}

export default function ExpenseRoutinePage() {
  const { toast } = useToast();
  const qc = useQueryClient();
  const { activeCompanyId } = useCompany();
  const [seedingCats, setSeedingCats] = useState(false);

  const { data: allCats = [], refetch: refetchCats } = useQuery<any[]>({
    queryKey: ["expenseCategories", activeCompanyId],
    queryFn: async () => {
      const url = `/api/expenses/categories${activeCompanyId ? `?company=${activeCompanyId}` : ""}`;
      const r = await fetch(url, { credentials: "include" });
      if (!r.ok) return [];
      return r.json();
    },
    refetchInterval: false,
    staleTime: 120_000,
  });
  const { data: taxes = [], refetch: refetchTaxes } = useListTaxes({
    query: { refetchInterval: false } as any,
  });
  const { data: accounts = [] } = useQuery<any[]>({
    queryKey: ["accounts", activeCompanyId],
    queryFn: () => fetchAccounts(activeCompanyId),
    refetchInterval: false,
    staleTime: 120_000,
  });
  const { data: recentExpenses = [] } = useListExpenses(
    { expenseType: "routine", company: activeCompanyId } as any
  );
  const { data: templates = [] } = useQuery({
    queryKey: ["expenseTemplates", activeCompanyId],
    queryFn: () => fetchTemplates(activeCompanyId),
    refetchInterval: false,
    staleTime: 120_000,
  });

  // Suppliers + employees for "Tujuan / Vendor / Karyawan" combobox
  // limit:1000 — this combobox needs the full vendor list, not the paginated
  // default (25) the /trading/suppliers endpoint now returns.
  const supplierListParams = { limit: 1000 };
  const { data: suppliersResponse } = useListSuppliers(supplierListParams, {
    query: { queryKey: getListSuppliersQueryKey(supplierListParams), staleTime: 300_000, refetchInterval: false },
  });
  const suppliers = suppliersResponse?.data ?? [];
  const { data: employeeUsers = [] } = useQuery<any[]>({
    queryKey: ["expenseApprovalUsers", activeCompanyId],
    queryFn: async () => {
      const r = await fetch("/api/expense-approvals/users", { credentials: "include" });
      if (!r.ok) return [];
      return r.json();
    },
    staleTime: 300_000,
    refetchInterval: false,
  });

  const presetMap = useMemo(() => {
    const m: Record<string, any> = {};
    for (const cat of allCats) {
      if (PRESET_CODES.some((p) => p.code === cat.code)) {
        m[cat.code] = cat;
      }
    }
    return m;
  }, [allCats]);

  const accountById = useMemo(() => {
    const m = new Map<number, { name: string; code: string }>();
    for (const a of accounts) m.set(a.id, { name: a.name, code: a.code });
    return m;
  }, [accounts]);

  // Combined tujuan options: vendors + employees
  const tujuanOptions = useMemo(() => {
    const vendors = (suppliers ?? []).map((s) => ({
      key: `v-${s.id}`,
      label: s.name,
      sub: s.taxId ? `NPWP: ${s.taxId}` : "Vendor",
      type: "vendor" as const,
    }));
    const employees = (employeeUsers as any[]).map((u: any) => ({
      key: `e-${u.id}`,
      label: u.name ?? u.email,
      sub: u.departmentName ? `${u.departmentName}${u.divisionName ? ` · ${u.divisionName}` : ""}` : u.email,
      type: "employee" as const,
    }));
    return { vendors, employees };
  }, [suppliers, employeeUsers]);

  const today = new Date().toISOString().slice(0, 10);
  const [selectedCode, setSelectedCode] = useState<string | null>(null);
  const [date, setDate] = useState(today);
  const [amountRaw, setAmountRaw] = useState("");
  const [vendorEmployee, setVendorEmployee] = useState("");
  const [tujuanOpen, setTujuanOpen] = useState(false);
  const [tujuanSearch, setTujuanSearch] = useState("");
  const [paymentMethod] = useState<"cash" | "bank">("bank"); // derived below, kept for API compat
  const [taxRateId, setTaxRateId] = useState<string>("none");
  const [taxAutoFilled, setTaxAutoFilled] = useState(false);
  const [amountAutoFilled, setAmountAutoFilled] = useState(false);
  const [debitAccountId, setDebitAccountId] = useState<string>("none");
  const [debitAutoFilled, setDebitAutoFilled] = useState(false);
  const [sourceAccountId, setSourceAccountId] = useState<string>("none");
  const [sourceAutoFilled, setSourceAutoFilled] = useState(false);
  const [notes, setNotes] = useState("");
  const [lastRefresh, setLastRefresh] = useState<Date>(new Date());
  const [scanOpen, setScanOpen] = useState(false);

  // Filtered tujuan options based on search
  const filteredTujuan = useMemo(() => {
    const q = tujuanSearch.toLowerCase();
    const vendors = tujuanOptions.vendors.filter((v) => v.label.toLowerCase().includes(q));
    const employees = tujuanOptions.employees.filter((e) => e.label.toLowerCase().includes(q));
    return { vendors, employees };
  }, [tujuanOptions, tujuanSearch]);

  const selectedCat: any = useMemo(() => {
    if (!selectedCode) return null;
    const fromPreset = presetMap[selectedCode];
    if (fromPreset) return fromPreset;
    return allCats.find((c) => c.code === selectedCode) ?? null;
  }, [selectedCode, presetMap, allCats]);

  // Auto-fill tax, amount, debit account, source account from category
  useEffect(() => {
    setQuickConfigAccountId(null);
    if (!selectedCat) return;

    const defaultTaxId = (selectedCat as any).defaultTaxId as number | null | undefined;
    const taxExists = defaultTaxId ? taxes.some((t) => t.id === defaultTaxId) : false;

    // Fallback: jika defaultTaxId tidak valid/null → cari PPN Masukan 11% dari daftar pajak
    const ppnMasukan = taxes.find((t) => t.name.toLowerCase().includes("ppn masukan 11"))
      ?? taxes.find((t) => t.name.toLowerCase().includes("ppn masukan"));

    const resolvedTaxId = (defaultTaxId && taxExists)
      ? defaultTaxId
      : ppnMasukan?.id ?? null;

    if (resolvedTaxId) {
      setTaxRateId(String(resolvedTaxId));
      setTaxAutoFilled(true);
    } else {
      if (taxAutoFilled) { setTaxRateId("none"); setTaxAutoFilled(false); }
    }

    const defaultAmount = (selectedCat as any).defaultAmount as string | number | null | undefined;
    if (defaultAmount && Number(defaultAmount) > 0) {
      setAmountRaw(formatIDRInput(String(Math.round(Number(defaultAmount)))));
      setAmountAutoFilled(true);
    } else {
      if (amountAutoFilled) { setAmountRaw(""); setAmountAutoFilled(false); }
    }

    const catDebitId = selectedCat.expenseAccountId as number | null | undefined;
    if (catDebitId) {
      setDebitAccountId(String(catDebitId));
      setDebitAutoFilled(true);
    } else {
      if (debitAutoFilled) { setDebitAccountId("none"); setDebitAutoFilled(false); }
    }

    const catCoaId = (selectedCat as any).defaultCoaId as number | null | undefined;
    if (catCoaId) {
      setSourceAccountId(String(catCoaId));
      setSourceAutoFilled(true);
    } else {
      if (sourceAutoFilled) { setSourceAccountId("none"); setSourceAutoFilled(false); }
    }
  }, [selectedCat?.id, taxes.length]);

  const amount = parseIDR(amountRaw);
  const selectedTax = taxes.find((t) => t.id.toString() === taxRateId);
  const taxAmount = selectedTax ? Math.round(amount * Number(selectedTax.rate) / 100) : 0;
  const isWithholding = selectedTax?.kind === "withholding";
  const total = isWithholding ? amount - taxAmount : amount + taxAmount;

  // Account name resolution (use override state if set)
  const effectiveDebitId = debitAccountId !== "none" ? Number(debitAccountId) : (selectedCat?.expenseAccountId ?? null);
  const debitAccName = effectiveDebitId ? (accountById.get(effectiveDebitId)?.name ?? `#${effectiveDebitId}`) : "—";
  const debitAccCode = effectiveDebitId ? (accountById.get(effectiveDebitId)?.code ?? "") : "";
  const effectiveSourceId = sourceAccountId !== "none" ? Number(sourceAccountId) : null;
  const sourceAccName = effectiveSourceId ? (accountById.get(effectiveSourceId)?.name ?? `#${effectiveSourceId}`) : null;
  const sourceAccCode = effectiveSourceId ? (accountById.get(effectiveSourceId)?.code ?? "") : "";
  // Derive cash vs bank from the selected source account name
  const effectivePaymentMethod: "cash" | "bank" = sourceAccName?.toLowerCase().includes("kas") ? "cash" : "bank";

  const [quickConfigAccountId, setQuickConfigAccountId] = useState<number | null>(null);

  const saveCategoryAccountMutation = useMutation({
    mutationFn: async ({ id, expenseAccountId: newAccId }: { id: number; expenseAccountId: number }) => {
      const res = await fetch(`/api/expenses/categories/${id}${activeCompanyId ? `?company=${activeCompanyId}` : ""}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ expenseAccountId: newAccId }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.message ?? "Gagal menyimpan akun biaya.");
      return data;
    },
    onSuccess: async (data) => {
      toast({ title: `Akun biaya untuk "${data.name}" tersimpan.` });
      setQuickConfigAccountId(null);
      await refetchCats();
    },
    onError: (e: Error) => {
      toast({ title: e.message, variant: "destructive" });
    },
  });

  const mutation = useMutation({
    mutationFn: postQuickExpense,
    onSuccess: (data) => {
      const msg = data.needsApproval
        ? `${data.expenseNumber} menunggu approval.`
        : `✓ ${data.expenseNumber} — ${idr(data.total)} diposting ke jurnal.`;
      toast({ title: msg });
      qc.invalidateQueries({ queryKey: getListExpensesQueryKey() });
      setAmountRaw(""); setVendorEmployee(""); setNotes("");
      setTaxRateId("none"); setTaxAutoFilled(false);
      setAmountAutoFilled(false);
      setDebitAccountId("none"); setDebitAutoFilled(false);
      setSourceAccountId("none"); setSourceAutoFilled(false);
      setDate(today); setSelectedCode(null);
    },
    onError: (e: Error) => {
      toast({ title: e.message, variant: "destructive" });
    },
  });

  const handleSubmit = () => {
    if (!selectedCode || !selectedCat) {
      toast({ title: "Pilih kategori terlebih dahulu.", variant: "destructive" }); return;
    }
    if (!selectedCat.expenseAccountId) {
      toast({ title: `Kategori "${selectedCat.name}" belum punya akun biaya. Konfigurasi di halaman Kategori.`, variant: "destructive" }); return;
    }
    if (amount <= 0) {
      toast({ title: "Nominal harus lebih dari 0.", variant: "destructive" }); return;
    }
    if (!date) {
      toast({ title: "Tanggal wajib diisi.", variant: "destructive" }); return;
    }
    mutation.mutate({
      date, categoryId: selectedCat.id, amount,
      vendorEmployee: vendorEmployee || undefined,
      notes: notes || undefined,
      taxRateId: taxRateId !== "none" ? Number(taxRateId) : null,
      paymentMethod: effectivePaymentMethod, company: activeCompanyId ?? undefined,
      debitAccountId: debitAccountId !== "none" ? Number(debitAccountId) : null,
      sourceAccountId: sourceAccountId !== "none" ? Number(sourceAccountId) : null,
    });
  };

  const applyTemplate = (tpl: any) => {
    if (tpl.category_id) {
      const cat = allCats.find((c) => c.id === tpl.category_id);
      if (cat) setSelectedCode(cat.code);
    }
    // paymentMethod now derived from source account, skip
    if (tpl.tax_rate_id) { setTaxRateId(String(tpl.tax_rate_id)); setTaxAutoFilled(false); }
    if (tpl.amount_preset) setAmountRaw(formatIDRInput(String(Math.round(Number(tpl.amount_preset)))));
    if (tpl.default_vendor) setVendorEmployee(tpl.default_vendor);
    toast({ title: `Template "${tpl.name}" diterapkan.` });
  };

  const handleManualRefresh = async () => {
    await Promise.all([refetchCats(), refetchTaxes()]);
    setLastRefresh(new Date());
    toast({ title: "Data kategori & pajak diperbarui." });
  };

  const needSeed = PRESET_CODES.some((p) => !presetMap[p.code]);

  return (
    <AppShell>
      <div className="p-6 space-y-6 max-w-3xl mx-auto">
        <Button variant="ghost" size="sm" className="-ml-2" onClick={() => window.history.back()}>
          <ArrowLeft className="h-4 w-4 mr-1" />Kembali
        </Button>
        {/* Header */}
        <div className="flex items-center justify-between gap-3">
          <div className="flex items-center gap-3">
            <Link href="/expense">
              <Button variant="ghost" size="icon" className="h-8 w-8">
                <ArrowLeft size={15} />
              </Button>
            </Link>
            <div className="flex items-center gap-2">
              <Zap size={20} className="text-amber-400" />
              <div>
                <h1 className="text-xl font-bold">Biaya Rutin</h1>
                <p className="text-sm text-muted-foreground">Catat pengeluaran — jurnal otomatis DR Biaya / CR Kas·Bank</p>
              </div>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <TooltipProvider>
              <Tooltip>
                <TooltipTrigger asChild>
                  <Button variant="ghost" size="icon" className="h-8 w-8" onClick={handleManualRefresh}>
                    <RefreshCw size={14} />
                  </Button>
                </TooltipTrigger>
                <TooltipContent>Perbarui data (otomatis setiap 30 detik)</TooltipContent>
              </Tooltip>
            </TooltipProvider>
            <Link href="/expense/templates">
              <Button variant="outline" size="sm">
                <LayoutTemplate size={13} className="mr-1.5" />
                Template
              </Button>
            </Link>
          </div>
        </div>

        {/* Seed hint */}
        {needSeed && (
          <div className="rounded-md border border-amber-700 bg-amber-950/40 px-4 py-3 text-sm text-amber-300 flex items-center justify-between gap-3">
            <span>Preset kategori rutin belum ada di database.</span>
            <button
              disabled={seedingCats}
              className="shrink-0 underline text-amber-200 hover:text-white disabled:opacity-50 disabled:cursor-wait flex items-center gap-1"
              onClick={async () => {
                setSeedingCats(true);
                try {
                  const seedUrl = `/api/expenses/seed-categories${activeCompanyId ? `?company=${activeCompanyId}` : ""}`;
                  const r = await fetch(seedUrl, { method: "POST", credentials: "include" });
                  const data = await r.json().catch(() => ({}));
                  if (r.ok) {
                    toast({ title: `Kategori berhasil di-seed (${data.seeded ?? 0} kategori).` });
                    await qc.invalidateQueries({ queryKey: ["expenseCategories", activeCompanyId] });
                    await refetchCats();
                  } else {
                    toast({ title: "Gagal seed kategori", description: data.message ?? `HTTP ${r.status}`, variant: "destructive" });
                  }
                } catch (e: any) {
                  toast({ title: "Error", description: e.message, variant: "destructive" });
                } finally {
                  setSeedingCats(false);
                }
              }}
            >
              {seedingCats && <Loader2 size={13} className="animate-spin" />}
              {seedingCats ? "Menyimpan…" : "Seed Sekarang"}
            </button>
          </div>
        )}

        {/* Quick Template Shortcuts */}
        {templates.length > 0 && (
          <Card className="border-dashed border-primary/30">
            <CardHeader className="pb-2 pt-3">
              <CardTitle className="text-xs font-medium text-muted-foreground flex items-center gap-1.5">
                <LayoutTemplate size={13} />
                Template Cepat
              </CardTitle>
            </CardHeader>
            <CardContent className="pb-3">
              <div className="flex flex-wrap gap-2">
                {templates.slice(0, 8).map((tpl) => (
                  <button
                    key={tpl.id}
                    onClick={() => applyTemplate(tpl)}
                    className="flex items-center gap-1.5 rounded-md border border-border bg-muted/30 px-3 py-1.5 text-xs font-medium hover:bg-muted/60 transition-colors"
                  >
                    <Zap size={11} className="text-amber-400" />
                    {tpl.name}
                    {tpl.amount_preset ? (
                      <span className="text-muted-foreground">{idr(Number(tpl.amount_preset))}</span>
                    ) : null}
                  </button>
                ))}
              </div>
            </CardContent>
          </Card>
        )}

        {/* Preset Category Buttons */}
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-sm font-medium text-muted-foreground">Pilih Kategori</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="grid grid-cols-3 sm:grid-cols-6 gap-2">
              {PRESET_CODES.map(({ code, label, icon: Icon, color }) => {
                const cat: any = presetMap[code];
                const inDb = !!cat;
                const active = selectedCode === code;
                const hasAccount = inDb && !!cat?.expenseAccountId;
                return (
                  <button
                    key={code}
                    disabled={!inDb}
                    onClick={() => setSelectedCode(active ? null : code)}
                    className={cn(
                      "flex flex-col items-center gap-1.5 rounded-lg border p-3 text-center transition-all relative",
                      active
                        ? "border-primary bg-primary/10 shadow-sm"
                        : "border-border bg-muted/30 hover:bg-muted/60",
                      !inDb && "opacity-40 cursor-not-allowed",
                    )}
                  >
                    <Icon size={20} className={active ? "text-primary" : color} />
                    <span className="text-xs font-medium leading-tight">{label}</span>
                    {inDb && !hasAccount && (
                      <span className="absolute top-1 right-1 h-2 w-2 rounded-full bg-amber-500" title="Belum ada akun biaya" />
                    )}
                  </button>
                );
              })}
            </div>
            {/* Custom categories */}
            {allCats.filter((c) => !PRESET_CODES.some((p) => p.code === c.code) && c.isActive).length > 0 && (
              <div className="mt-3 pt-3 border-t">
                <p className="text-xs text-muted-foreground mb-2">Kategori lainnya:</p>
                <SearchableSelect
                  triggerClassName="h-8 text-sm"
                  value={selectedCode ?? "none"}
                  onValueChange={(v) => setSelectedCode(v === "none" ? null : v)}
                  placeholder="Pilih kategori lain..."
                  searchPlaceholder="Cari kategori..."
                  emptyText="Kategori tidak ditemukan."
                  options={[
                    { value: "none", label: "—" },
                    ...allCats
                      .filter((c) => !PRESET_CODES.some((p) => p.code === c.code) && c.isActive && c.expenseAccountId)
                      .map((c) => ({ value: c.code, label: c.name })),
                  ]}
                />
              </div>
            )}
          </CardContent>
        </Card>

        {/* Account Mapping Info — shown when category selected */}
        {selectedCat && (
          <div className={cn(
            "rounded-md border px-4 py-3 text-sm",
            selectedCat.expenseAccountId
              ? "border-emerald-700/40 bg-emerald-950/20"
              : "border-amber-700/40 bg-amber-950/20"
          )}>
            {selectedCat.expenseAccountId ? (
              <div className="flex items-start gap-2">
                <CheckCircle2 size={15} className="text-emerald-400 mt-0.5 shrink-0" />
                <div className="space-y-0.5">
                  <p className="font-medium text-emerald-300">Mapping Akun Terdeteksi</p>
                  <p className="text-xs text-muted-foreground">
                    Debit: <span className="text-foreground font-mono">{debitAccCode}</span>{" "}
                    <span className="text-foreground">{debitAccName}</span>
                  </p>
                  <p className="text-xs text-muted-foreground">
                    Kredit: <span className="text-foreground font-mono">{sourceAccCode}</span>{" "}
                    <span className="text-foreground">{sourceAccName ?? (effectivePaymentMethod === "cash" ? "Kas" : "Bank")}</span>
                    {sourceAutoFilled && <span className="text-muted-foreground ml-1">(auto)</span>}
                  </p>
                  {(selectedCat as any).defaultTaxId && taxRateId !== "none" && selectedTax && (
                    <p className="text-xs text-amber-300 flex items-center gap-1">
                      <Info size={11} />
                      Pajak default: {selectedTax.name} ({Number(selectedTax.rate)}%)
                      {taxAutoFilled && <span className="text-muted-foreground">(auto-filled)</span>}
                    </p>
                  )}
                </div>
              </div>
            ) : (
              <div className="space-y-2">
                <div className="flex items-center gap-2 text-amber-300">
                  <AlertCircle size={15} className="shrink-0" />
                  <span>Kategori ini belum punya akun biaya. Pilih sekali, dan berikutnya akan terisi otomatis.</span>
                </div>
                <div className="flex items-center gap-2">
                  <div className="flex-1">
                    <AccountCombobox
                      accounts={accounts}
                      value={quickConfigAccountId}
                      onChange={(v) => setQuickConfigAccountId(v)}
                      placeholder="Pilih akun biaya untuk kategori ini..."
                    />
                  </div>
                  <Button
                    size="sm"
                    disabled={!quickConfigAccountId || saveCategoryAccountMutation.isPending}
                    onClick={() => {
                      if (!quickConfigAccountId || !selectedCat) return;
                      saveCategoryAccountMutation.mutate({ id: selectedCat.id, expenseAccountId: quickConfigAccountId });
                    }}
                  >
                    {saveCategoryAccountMutation.isPending ? <Loader2 size={14} className="animate-spin" /> : "Simpan"}
                  </Button>
                </div>
                <p className="text-xs text-muted-foreground">
                  Atau kelola semua kategori di{" "}
                  <Link href="/expense/categories" className="underline">halaman Kategori →</Link>
                </p>
              </div>
            )}
          </div>
        )}

        {/* Form */}
        <Card>
          <CardHeader className="pb-3">
            <div className="flex items-center justify-between">
              <CardTitle className="text-sm font-medium text-muted-foreground">Detail Pengeluaran</CardTitle>
              <Button type="button" variant="outline" size="sm" className="h-7 text-xs gap-1" onClick={() => setScanOpen(true)}>
                <ScanLine size={12} /> Scan Struk
              </Button>
            </div>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-1.5">
                <Label>Tanggal <span className="text-destructive">*</span></Label>
                <DatePicker value={date} onChange={(v) => setDate(v)} />
              </div>
              <div className="space-y-1.5">
                <Label className="flex items-center gap-1.5">
                  Akun Sumber (Kredit)
                  {sourceAutoFilled && (
                    <Badge variant="outline" className="text-[10px] px-1.5 py-0 h-4 border-sky-600 text-sky-400">
                      auto
                    </Badge>
                  )}
                </Label>
                <Select
                  value={sourceAccountId}
                  onValueChange={(v) => { setSourceAccountId(v); setSourceAutoFilled(false); }}
                >
                  <SelectTrigger>
                    <SelectValue placeholder="Pilih akun kas/bank..." />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="none">— Pilih akun —</SelectItem>
                    {accounts.filter((a) => a.type === "asset" && (a.name.toLowerCase().includes("kas") || a.name.toLowerCase().includes("bank")) && (a.code?.includes("CST") || a.name?.includes("CST"))).map((a) => (
                      <SelectItem key={a.id} value={a.id.toString()}>
                        {a.code} — {a.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>

            <div className="space-y-1.5">
              <Label>Tujuan / Vendor / Karyawan</Label>
              <Popover open={tujuanOpen} onOpenChange={(o) => { setTujuanOpen(o); if (!o) setTujuanSearch(""); }}>
                <PopoverTrigger asChild>
                  <Button
                    variant="outline"
                    role="combobox"
                    className={cn("w-full justify-between font-normal", !vendorEmployee && "text-muted-foreground")}
                  >
                    <span className="flex items-center gap-2 truncate">
                      {vendorEmployee || "Pilih vendor atau karyawan (opsional)"}
                    </span>
                    <ChevronsUpDown size={13} className="shrink-0 text-muted-foreground" />
                  </Button>
                </PopoverTrigger>
                <PopoverContent className="w-80 p-0" align="start">
                  <Command>
                    <CommandInput
                      placeholder="Cari vendor atau karyawan..."
                      value={tujuanSearch}
                      onValueChange={setTujuanSearch}
                    />
                    <CommandList className="max-h-56">
                      <CommandEmpty>
                        {tujuanSearch ? (
                          <div className="p-2 text-center">
                            <p className="text-xs text-muted-foreground mb-2">Tidak ditemukan.</p>
                            <Button
                              size="sm"
                              variant="outline"
                              className="text-xs"
                              onClick={() => {
                                setVendorEmployee(tujuanSearch);
                                setTujuanOpen(false);
                                setTujuanSearch("");
                              }}
                            >
                              Gunakan "{tujuanSearch}" sebagai nama
                            </Button>
                          </div>
                        ) : "Ketik untuk mencari..."}
                      </CommandEmpty>
                      {filteredTujuan.vendors.length > 0 && (
                        <CommandGroup heading="Vendor / Supplier">
                          {filteredTujuan.vendors.map((v) => (
                            <CommandItem
                              key={v.key}
                              value={v.label}
                              onSelect={() => {
                                setVendorEmployee(v.label);
                                setTujuanOpen(false);
                                setTujuanSearch("");
                              }}
                            >
                              <Building2 size={13} className="mr-2 text-muted-foreground shrink-0" />
                              <div className="flex flex-col min-w-0">
                                <span className="text-sm truncate">{v.label}</span>
                                {v.sub && <span className="text-xs text-muted-foreground truncate">{v.sub}</span>}
                              </div>
                              {vendorEmployee === v.label && (
                                <Check size={13} className="ml-auto text-primary shrink-0" />
                              )}
                            </CommandItem>
                          ))}
                        </CommandGroup>
                      )}
                      {filteredTujuan.vendors.length > 0 && filteredTujuan.employees.length > 0 && (
                        <CommandSeparator />
                      )}
                      {filteredTujuan.employees.length > 0 && (
                        <CommandGroup heading="Karyawan">
                          {filteredTujuan.employees.map((e) => (
                            <CommandItem
                              key={e.key}
                              value={e.label}
                              onSelect={() => {
                                setVendorEmployee(e.label);
                                setTujuanOpen(false);
                                setTujuanSearch("");
                              }}
                            >
                              <User size={13} className="mr-2 text-muted-foreground shrink-0" />
                              <div className="flex flex-col min-w-0">
                                <span className="text-sm truncate">{e.label}</span>
                                {e.sub && <span className="text-xs text-muted-foreground truncate">{e.sub}</span>}
                              </div>
                              {vendorEmployee === e.label && (
                                <Check size={13} className="ml-auto text-primary shrink-0" />
                              )}
                            </CommandItem>
                          ))}
                        </CommandGroup>
                      )}
                      {vendorEmployee && (
                        <>
                          <CommandSeparator />
                          <CommandGroup>
                            <CommandItem
                              value="__clear__"
                              onSelect={() => {
                                setVendorEmployee("");
                                setTujuanOpen(false);
                                setTujuanSearch("");
                              }}
                            >
                              <span className="text-xs text-muted-foreground">Hapus pilihan</span>
                            </CommandItem>
                          </CommandGroup>
                        </>
                      )}
                    </CommandList>
                  </Command>
                </PopoverContent>
              </Popover>
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-1.5">
                <Label className="flex items-center gap-1.5">
                  Nominal (IDR) <span className="text-destructive">*</span>
                  {amountAutoFilled && (
                    <Badge variant="outline" className="text-[10px] px-1.5 py-0 h-4 border-sky-600 text-sky-400">
                      auto
                    </Badge>
                  )}
                </Label>
                <Input
                  placeholder="0"
                  value={amountRaw}
                  onChange={(e) => { setAmountRaw(formatIDRInput(e.target.value)); setAmountAutoFilled(false); }}
                  className="font-mono"
                />
              </div>
              <div className="space-y-1.5">
                <Label className="flex items-center gap-1.5">
                  Pajak
                  {taxAutoFilled && (
                    <Badge variant="outline" className="text-[10px] px-1.5 py-0 h-4 border-amber-600 text-amber-400">
                      auto
                    </Badge>
                  )}
                </Label>
                <Select
                  value={taxRateId}
                  onValueChange={(v) => { setTaxRateId(v); setTaxAutoFilled(false); }}
                >
                  <SelectTrigger>
                    <SelectValue placeholder="Tanpa pajak" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="none">Tanpa pajak</SelectItem>
                    {taxes.map((t) => (
                      <SelectItem key={t.id} value={t.id.toString()}>
                        {t.name} ({Number(t.rate)}%)
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>

            {/* Akun Biaya (Debit) — auto-fill dari kategori, bisa diubah */}
            <div className="space-y-1.5">
              <Label className="flex items-center gap-1.5">
                Akun Biaya (Debit)
                {debitAutoFilled && (
                  <Badge variant="outline" className="text-[10px] px-1.5 py-0 h-4 border-emerald-600 text-emerald-400">
                    auto
                  </Badge>
                )}
              </Label>
              <AccountCombobox
                accounts={accounts.filter((a) => a.type === "expense" && (a.code?.includes("CST") || a.name?.includes("CST")))}
                value={debitAccountId !== "none" ? Number(debitAccountId) : null}
                onChange={(id) => { setDebitAccountId(String(id)); setDebitAutoFilled(false); }}
                placeholder="— Pilih akun —"
              />
            </div>

            {/* Jurnal Preview */}
            {amount > 0 && selectedCat && (
              <div className="rounded-md bg-muted/40 border px-4 py-3 space-y-1.5 text-sm">
                <div className="flex justify-between text-muted-foreground">
                  <span>Subtotal</span>
                  <span className="font-mono">{idr(amount)}</span>
                </div>
                {taxAmount > 0 && (
                  <div className="flex justify-between text-muted-foreground">
                    <span>{isWithholding ? `PPh Dipotong (${selectedTax?.name})` : `PPN (${selectedTax?.name})`}</span>
                    <span className="font-mono">{isWithholding ? `−${idr(taxAmount)}` : `+${idr(taxAmount)}`}</span>
                  </div>
                )}
                <div className="flex justify-between font-semibold border-t pt-1.5 mt-0.5">
                  <span>{isWithholding ? "Dibayar ke Vendor" : "Total"}</span>
                  <span className="font-mono text-base">{idr(total)}</span>
                </div>
                <div className="border-t pt-1.5 mt-0.5 space-y-0.5 text-xs text-muted-foreground">
                  <p className="font-medium text-foreground mb-1">Entri Jurnal Otomatis:</p>
                  <div className="flex justify-between">
                    <span className="text-emerald-400">DR {debitAccCode && `[${debitAccCode}]`} {debitAccName}</span>
                    <span className="font-mono">{idr(amount)}</span>
                  </div>
                  {taxAmount > 0 && !isWithholding && (
                    <div className="flex justify-between">
                      <span className="text-emerald-400">DR PPN Masukan</span>
                      <span className="font-mono">{idr(taxAmount)}</span>
                    </div>
                  )}
                  {taxAmount > 0 && isWithholding && (
                    <div className="flex justify-between">
                      <span className="text-rose-400">CR Hutang PPh ({selectedTax?.name})</span>
                      <span className="font-mono">{idr(taxAmount)}</span>
                    </div>
                  )}
                  <div className="flex justify-between">
                    <span className="text-rose-400">
                      CR {sourceAccCode && `[${sourceAccCode}]`} {sourceAccName ?? (effectivePaymentMethod === "cash" ? "Kas (Tunai)" : "Bank")}
                    </span>
                    <span className="font-mono">{idr(total)}</span>
                  </div>
                </div>
              </div>
            )}

            <div className="space-y-1.5">
              <Label>Keterangan</Label>
              <Textarea
                placeholder="Catatan opsional..."
                rows={2}
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
              />
            </div>

            <Button
              className="w-full"
              onClick={handleSubmit}
              disabled={mutation.isPending || !selectedCode || amount <= 0}
            >
              {mutation.isPending ? (
                <><Loader2 size={14} className="mr-2 animate-spin" /> Menyimpan...</>
              ) : (
                <><Zap size={14} className="mr-2" /> Catat & Posting Sekarang</>
              )}
            </Button>
          </CardContent>
        </Card>

        {/* Recent */}
        {recentExpenses.length > 0 && (
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm font-medium text-muted-foreground flex items-center gap-2">
                <BookOpen size={14} />
                Riwayat Biaya Rutin Terkini
                <span className="ml-auto text-[10px] text-muted-foreground/60 font-normal">
                  Refresh {lastRefresh.toLocaleTimeString("id-ID", { hour: "2-digit", minute: "2-digit" })}
                </span>
              </CardTitle>
            </CardHeader>
            <CardContent className="p-0">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="text-xs">No. Expense</TableHead>
                    <TableHead className="text-xs">Tanggal</TableHead>
                    <TableHead className="text-xs">Kategori</TableHead>
                    <TableHead className="text-xs">Tujuan</TableHead>
                    <TableHead className="text-xs text-right">Total</TableHead>
                    <TableHead className="text-xs">Status</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {(recentExpenses as any[]).slice(0, 20).map((exp) => {
                    const cat = allCats.find((c) => c.id === exp.categoryId);
                    return (
                      <TableRow key={exp.id}>
                        <TableCell>
                          <Link href={`/expense/${exp.id}`}>
                            <span className="font-mono text-xs text-primary hover:underline">{exp.expenseNumber}</span>
                          </Link>
                        </TableCell>
                        <TableCell className="text-xs">{exp.date}</TableCell>
                        <TableCell>
                          {cat ? (
                            <Badge variant="secondary" className="text-xs">{cat.name}</Badge>
                          ) : <span className="text-xs text-muted-foreground">—</span>}
                        </TableCell>
                        <TableCell className="text-xs text-muted-foreground">{exp.vendorEmployee ?? "—"}</TableCell>
                        <TableCell className="text-xs text-right font-medium font-mono">{idr(exp.total)}</TableCell>
                        <TableCell>
                          <Badge className={cn("text-xs border", STATUS_COLORS[exp.status] ?? "bg-muted text-muted-foreground")}>
                            {STATUS_LABELS[exp.status] ?? exp.status}
                          </Badge>
                        </TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
            </CardContent>
          </Card>
        )}
        {recentExpenses.length === 0 && (
          <div className="text-center py-8 text-sm text-muted-foreground flex flex-col items-center gap-2">
            <Receipt size={32} className="opacity-30" />
            <p>Belum ada biaya rutin. Isi form di atas untuk memulai.</p>
          </div>
        )}
      </div>

      <ScanDocumentDialog
        open={scanOpen}
        onOpenChange={setScanOpen}
        title="Scan Struk / Bukti Pengeluaran"
        onDataExtracted={(data) => {
          if (data.docDate) setDate(data.docDate.slice(0, 10));
          const cost = data.estimatedCost ?? data.lines?.[0]?.unitPrice ?? null;
          if (cost != null && cost > 0) {
            setAmountRaw(formatIDRInput(String(Math.round(cost))));
            setAmountAutoFilled(false);
          }
          if (data.partyName) setVendorEmployee(data.partyName);
          if (data.notes) setNotes(data.notes);
        }}
      />
    </AppShell>
  );
}
