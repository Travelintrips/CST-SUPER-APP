import { DatePicker } from "@/components/ui/date-picker";
import { useState, useEffect, useRef } from "react";
import { useLocation, useParams } from "wouter";
import { useQuery } from "@tanstack/react-query";
import { AppShell } from "@/components/layout/AppShell";
import { AccountCombobox } from "@/components/accounting/AccountCombobox";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import {
  Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import {
  useGetExpense, useCreateExpense, useUpdateExpense, useExpenseAction,
  useAddExpenseAttachment, useDeleteExpenseAttachment,
  useListExpenseCategories, useListAccounts, useListTaxes,
  useListSalesDocuments, useListFreightShipments,
  useListCustomers,
  getListExpensesQueryKey, getGetExpenseQueryKey,
  type ExpenseAttachment,
} from "@workspace/api-client-react";
import { useUpload } from "@workspace/object-storage-web";
import { useQueryClient } from "@tanstack/react-query";
import { useToast } from "@/hooks/use-toast";
import { useLanguage } from "@/contexts/LanguageContext";
import { useCompany } from "@/contexts/CompanyContext";
import { useVendors } from "@/hooks/useVendors";
import {
  ArrowLeft, Save, Send, CheckCircle, XCircle, FileText, Banknote,
  RotateCcw, Info, Paperclip, Upload, Trash2, Loader2, AlertTriangle, X,
  ChevronsUpDown, Check, ExternalLink, MessageSquare, TrendingDown, TrendingUp,
  ScanLine,
} from "lucide-react";
import { ScanDocumentDialog } from "@/components/ScanDocumentDialog";
import { CorrespondenceTab } from "@/components/CorrespondenceTab";
import {
  Popover, PopoverContent, PopoverTrigger,
} from "@/components/ui/popover";
import {
  Command, CommandEmpty, CommandInput, CommandItem, CommandList,
} from "@/components/ui/command";
import { Link } from "wouter";

async function apiFetch(url: string, opts?: RequestInit) {
  const r = await fetch(url, { credentials: "include", ...opts });
  const d = await r.json();
  if (!r.ok) throw new Error(d.message ?? "Terjadi kesalahan.");
  return d;
}

const idr = (n: number) =>
  new Intl.NumberFormat("id-ID", { style: "currency", currency: "IDR", maximumFractionDigits: 0 }).format(n);

function getServeUrl(objectPath: string) {
  if (objectPath.startsWith("/objects/")) return `/api/storage${objectPath}`;
  return objectPath;
}

function errMsg(e: unknown, fallback: string) {
  return e instanceof Error ? e.message : (e as { message?: string })?.message ?? fallback;
}

function AttachmentItem({
  att,
  onDelete,
  deleting,
}: {
  att: ExpenseAttachment;
  onDelete: (id: number) => void;
  deleting: boolean;
}) {
  const url = getServeUrl(att.objectPath);
  const isImage = (att.contentType ?? "").startsWith("image/");
  return (
    <div className="flex items-center gap-3 rounded-lg border border-border bg-background p-3 hover:bg-muted/30 transition-colors">
      <a href={url} target="_blank" rel="noreferrer" className="shrink-0">
        {isImage ? (
          <img src={url} alt={att.fileName} className="h-12 w-12 rounded border object-cover" />
        ) : (
          <div className="flex h-12 w-12 items-center justify-center rounded border bg-muted">
            <FileText className="h-5 w-5 text-muted-foreground" />
          </div>
        )}
      </a>
      <div className="min-w-0 flex-1">
        <a href={url} target="_blank" rel="noreferrer"
          className="block truncate text-sm font-medium hover:underline text-foreground">
          {att.fileName}
        </a>
        <p className="text-xs text-muted-foreground">
          {new Date(att.createdAt).toLocaleDateString("id-ID", { day: "numeric", month: "short", year: "numeric" })}
        </p>
      </div>
      <Button variant="ghost" size="icon" className="shrink-0 text-destructive hover:text-destructive h-8 w-8"
        onClick={() => onDelete(att.id)} disabled={deleting}>
        {deleting ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Trash2 className="h-3.5 w-3.5" />}
      </Button>
    </div>
  );
}

function ReferenceCombobox<T extends { id: number }>({
  value,
  onChange,
  items,
  getLabel,
  placeholder,
  disabled,
}: {
  value: number | null;
  onChange: (v: number | null) => void;
  items: T[];
  getLabel: (item: T) => string;
  placeholder: string;
  disabled?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const selected = value ? items.find((i) => i.id === value) : null;

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          variant="outline"
          role="combobox"
          disabled={disabled}
          className="w-full justify-between font-normal truncate"
        >
          <span className="truncate">
            {selected ? getLabel(selected) : <span className="text-muted-foreground">{placeholder}</span>}
          </span>
          <ChevronsUpDown size={13} className="ml-2 shrink-0 opacity-50" />
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-[360px] p-0" align="start">
        <Command>
          <CommandInput placeholder="Cari..." />
          <CommandList>
            <CommandEmpty>Tidak ditemukan.</CommandEmpty>
            <CommandItem
              value="__clear__"
              onSelect={() => { onChange(null); setOpen(false); }}
              className="text-muted-foreground"
            >
              — Tidak dipilih —
            </CommandItem>
            {items.slice(0, 100).map((item) => (
              <CommandItem
                key={item.id}
                value={`${item.id} ${getLabel(item)}`}
                onSelect={() => { onChange(item.id); setOpen(false); }}
              >
                <Check size={13} className={`mr-2 shrink-0 ${value === item.id ? "opacity-100" : "opacity-0"}`} />
                {getLabel(item)}
              </CommandItem>
            ))}
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  );
}

const UNIT_OPTIONS = [
  "pcs", "unit", "set", "box", "carton", "pack", "bag",
  "kg", "gram", "ton",
  "liter", "ml",
  "meter", "cm", "m²", "m³",
  "sheet", "roll", "rim",
  "trip", "jam", "hari", "bulan",
];

function VendorEmployeeCombobox({
  value,
  onChange,
  suppliers,
  customers,
  disabled,
}: {
  value: string;
  onChange: (v: string) => void;
  suppliers: { id: number; name: string }[];
  customers: { id: number; name: string }[];
  disabled?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState("");

  const filteredSuppliers = suppliers.filter((s) =>
    s.name.toLowerCase().includes(search.toLowerCase())
  );
  const filteredCustomers = customers.filter((c) =>
    c.name.toLowerCase().includes(search.toLowerCase())
  );

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          variant="outline"
          role="combobox"
          disabled={disabled}
          className="w-full justify-between font-normal"
        >
          <span className="truncate">
            {value || <span className="text-muted-foreground">Pilih atau ketik nama vendor/karyawan...</span>}
          </span>
          <ChevronsUpDown size={13} className="ml-2 shrink-0 opacity-50" />
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-[360px] p-0" align="start">
        <Command shouldFilter={false}>
          <CommandInput
            placeholder="Cari atau ketik nama..."
            value={search}
            onValueChange={setSearch}
          />
          <CommandList>
            {search && (
              <CommandItem
                value="__custom__"
                onSelect={() => { onChange(search); setOpen(false); setSearch(""); }}
                className="text-primary font-medium"
              >
                <Check size={13} className={`mr-2 shrink-0 ${value === search ? "opacity-100" : "opacity-0"}`} />
                Gunakan: "{search}"
              </CommandItem>
            )}
            {filteredSuppliers.length > 0 && (
              <>
                <p className="px-3 py-1.5 text-xs text-muted-foreground font-medium">Pemasok</p>
                {filteredSuppliers.map((s) => (
                  <CommandItem
                    key={`sup-${s.id}`}
                    value={`sup-${s.id}-${s.name}`}
                    onSelect={() => { onChange(s.name); setOpen(false); setSearch(""); }}
                  >
                    <Check size={13} className={`mr-2 shrink-0 ${value === s.name ? "opacity-100" : "opacity-0"}`} />
                    {s.name}
                  </CommandItem>
                ))}
              </>
            )}
            {filteredCustomers.length > 0 && (
              <>
                <p className="px-3 py-1.5 text-xs text-muted-foreground font-medium">Pelanggan</p>
                {filteredCustomers.map((c) => (
                  <CommandItem
                    key={`cus-${c.id}`}
                    value={`cus-${c.id}-${c.name}`}
                    onSelect={() => { onChange(c.name); setOpen(false); setSearch(""); }}
                  >
                    <Check size={13} className={`mr-2 shrink-0 ${value === c.name ? "opacity-100" : "opacity-0"}`} />
                    {c.name}
                  </CommandItem>
                ))}
              </>
            )}
            {filteredSuppliers.length === 0 && filteredCustomers.length === 0 && !search && (
              <p className="px-3 py-4 text-center text-sm text-muted-foreground">
                Ketik nama untuk mencari atau mengisi manual.
              </p>
            )}
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  );
}

function UnitCombobox({
  value,
  onChange,
  disabled,
}: {
  value: string;
  onChange: (v: string) => void;
  disabled?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState("");

  const filtered = UNIT_OPTIONS.filter((u) =>
    u.toLowerCase().includes(search.toLowerCase())
  );

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          variant="outline"
          role="combobox"
          disabled={disabled}
          className="w-full justify-between font-normal"
        >
          <span className="truncate">
            {value || <span className="text-muted-foreground">Pilih satuan...</span>}
          </span>
          <ChevronsUpDown size={13} className="ml-2 shrink-0 opacity-50" />
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-[220px] p-0" align="start">
        <Command shouldFilter={false}>
          <CommandInput
            placeholder="Cari atau ketik satuan..."
            value={search}
            onValueChange={setSearch}
          />
          <CommandList>
            {search && !UNIT_OPTIONS.includes(search) && (
              <CommandItem
                value="__custom__"
                onSelect={() => { onChange(search); setOpen(false); setSearch(""); }}
                className="text-primary font-medium"
              >
                <Check size={13} className={`mr-2 shrink-0 opacity-0`} />
                Gunakan: "{search}"
              </CommandItem>
            )}
            {filtered.map((u) => (
              <CommandItem
                key={u}
                value={u}
                onSelect={() => { onChange(u); setOpen(false); setSearch(""); }}
              >
                <Check size={13} className={`mr-2 shrink-0 ${value === u ? "opacity-100" : "opacity-0"}`} />
                {u}
              </CommandItem>
            ))}
            {filtered.length === 0 && !search && (
              <CommandEmpty>Ketik nama satuan.</CommandEmpty>
            )}
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  );
}

const STATUS_LABELS: Record<string, string> = {
  draft: "Draft",
  submitted: "Diajukan",
  approved: "Disetujui",
  pending_approval: "Menunggu Approval",
  posted: "Diposting",
  paid: "Lunas",
  rejected: "Ditolak",
};
const STATUS_COLORS: Record<string, string> = {
  draft: "bg-slate-800 text-slate-300 border-slate-600",
  submitted: "bg-sky-900/40 text-sky-300 border-sky-600",
  approved: "bg-indigo-900/40 text-indigo-300 border-indigo-600",
  pending_approval: "bg-amber-900/40 text-amber-300 border-amber-600",
  posted: "bg-emerald-900/40 text-emerald-300 border-emerald-600",
  paid: "bg-green-900/50 text-green-300 border-green-600",
  rejected: "bg-red-900/40 text-red-300 border-red-600",
};

const EMPTY_FORM = {
  date: new Date().toISOString().slice(0, 10),
  vendorEmployee: "",
  vendorId: null as number | null,
  expenseType: "vendor_bill" as "vendor_bill" | "reimbursement" | "internal",
  transactionType: "expense" as "expense" | "income",
  categoryId: null as number | null,
  description: "",
  qty: 1,
  unit: "",
  unitPrice: 0,
  taxRateId: null as number | null,
  currency: "IDR",
  notes: "",
  expenseAccountId: null as number | null,
  payableAccountId: null as number | null,
  sourceAccountId: null as number | null,
  salesDocId: null as number | null,
  shipmentId: null as number | null,
};

export default function ExpenseEditorPage() {
  const { id } = useParams<{ id?: string }>();
  const isNew = !id || id === "new";
  const [, navigate] = useLocation();
  const qc = useQueryClient();
  const { toast } = useToast();
  const { t } = useLanguage();
  const { activeCompanyId } = useCompany();

  const expId = isNew ? 0 : Number(id);
  const { data: expense, isLoading } = useGetExpense(
    expId,
    { query: { enabled: !isNew, queryKey: getGetExpenseQueryKey(expId) } },
  );
  const { data: cats = [] } = useListExpenseCategories();
  const { data: accounts = [] } = useListAccounts();
  const { data: taxes = [] } = useListTaxes();
  const { data: suppliers = [] } = useVendors();
  const { data: customers = [] } = useListCustomers();
  const { data: paymentAccounts = [] } = useQuery({
    queryKey: ["expense-payment-accounts", activeCompanyId],
    queryFn: () => apiFetch(`/api/expenses/payment-accounts${activeCompanyId ? `?company=${activeCompanyId}` : ""}`),
  });

  const { data: userList = [] } = useQuery({
    queryKey: ["users-list"],
    queryFn: () => apiFetch("/api/users"),
  });

  const createMut = useCreateExpense();
  const updateMut = useUpdateExpense();
  const actionMut = useExpenseAction();
  const addAttachmentMut = useAddExpenseAttachment();
  const deleteAttachmentMut = useDeleteExpenseAttachment();

  const [form, setForm] = useState({ ...EMPTY_FORM });
  const [sourceAccountId, setSourceAccountId] = useState<number | null>(null);
  const [vendorId, setVendorId] = useState<number | null>(null);
  const [userId, setUserId] = useState<string | null>(null);
  const [scanOpen, setScanOpen] = useState(false);
  const [rejectOpen, setRejectOpen] = useState(false);
  const [rejectReason, setRejectReason] = useState("");
  const [payOpen, setPayOpen] = useState(false);
  const [payMethod, setPayMethod] = useState<"bank" | "cash">("bank");
  const [autoFilled, setAutoFilled] = useState<Set<string>>(new Set());
  const [pendingFile, setPendingFile] = useState<File | null>(null);
  const [uploading, setUploading] = useState(false);
  const [deletingAttId, setDeletingAttId] = useState<number | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const { uploadFile } = useUpload({
    onError: (err) => {
      toast({ title: t.common.error, variant: "destructive" });
      setUploading(false);
    },
  });

  useEffect(() => {
    if (isNew) {
      const sp = new URLSearchParams(window.location.search);
      const qSalesDocId = sp.get("salesDocId");
      const qShipmentId = sp.get("shipmentId");

      const parseId = (v: string | null): number | null => {
        if (!v) return null;
        const n = Number(v);
        return Number.isFinite(n) && n > 0 ? n : null;
      };

      if (qSalesDocId || qShipmentId) {
        const salesDocId = parseId(qSalesDocId);
        const shipmentId = parseId(qShipmentId);

        if (salesDocId) sessionStorage.setItem("expense_new_salesDocId", String(salesDocId));
        else sessionStorage.removeItem("expense_new_salesDocId");
        if (shipmentId) sessionStorage.setItem("expense_new_shipmentId", String(shipmentId));
        else sessionStorage.removeItem("expense_new_shipmentId");

        setForm((f) => ({
          ...f,
          salesDocId: salesDocId ?? f.salesDocId,
          shipmentId: shipmentId ?? f.shipmentId,
        }));
      } else {
        const salesDocId = parseId(sessionStorage.getItem("expense_new_salesDocId"));
        const shipmentId = parseId(sessionStorage.getItem("expense_new_shipmentId"));
        if (salesDocId || shipmentId) {
          setForm((f) => ({
            ...f,
            salesDocId: salesDocId ?? f.salesDocId,
            shipmentId: shipmentId ?? f.shipmentId,
          }));
        }
      }
    }
  }, [isNew]);

  useEffect(() => {
    if (expense && !isNew) {
      const expAny = expense as any;
      setForm({
        date: expense.date,
        vendorEmployee: expense.vendorEmployee ?? "",
        vendorId: expense.vendorId ?? null,
        expenseType: expense.expenseType as any,
        transactionType: (expAny.transactionType ?? "expense") as "expense" | "income",
        categoryId: expense.categoryId ?? null,
        description: expense.description ?? "",
        qty: expense.qty,
        unit: expense.unit ?? "",
        unitPrice: expense.unitPrice,
        taxRateId: expense.taxRateId ?? null,
        currency: expense.currency,
        notes: expense.notes ?? "",
        expenseAccountId: expense.expenseAccountId ?? null,
        payableAccountId: expense.payableAccountId ?? null,
        sourceAccountId: expense.sourceAccountId ?? null,
        salesDocId: expense.salesDocId ?? null,
        shipmentId: expense.shipmentId ?? null,
      });
      setSourceAccountId(expAny.sourceAccountId ?? null);
      setVendorId(expAny.vendorId ?? null);
      setUserId(expAny.userId ?? null);
    }
  }, [expense]);

  const purchaseTaxes = taxes.filter((t) => t.kind === "purchase" && t.isActive);
  const selectedTax = taxes.find((t) => t.id === form.taxRateId);
  const subtotal = Math.round(form.qty * form.unitPrice * 100) / 100;
  const taxAmount = selectedTax ? Math.round(subtotal * selectedTax.rate / 100 * 100) / 100 : 0;
  const isWithholdingTax = selectedTax?.kind === "withholding";
  const total = isWithholdingTax ? subtotal - taxAmount : subtotal + taxAmount;

  const canEdit = isNew || (expense?.status === "draft") || (expense?.status === "rejected");
  const locked = !canEdit;

  const onCategoryChange = (catId: number | null) => {
    const cat = cats.find((c) => c.id === catId);
    const filled = new Set<string>();
    if (cat) {
      if (cat.expenseAccountId) filled.add("expenseAccountId");
      if (cat.payableAccountId) filled.add("payableAccountId");
      if ((cat as any).defaultTaxId) filled.add("taxRateId");
    }
    setAutoFilled(filled);
    setForm((f) => ({
      ...f,
      categoryId: catId,
      expenseAccountId: cat ? (cat.expenseAccountId ?? null) : f.expenseAccountId,
      payableAccountId: cat ? (cat.payableAccountId ?? null) : f.payableAccountId,
      taxRateId: cat ? ((cat as any).defaultTaxId ?? null) : f.taxRateId,
    }));
  };

  const { data: _salesDocsPaginated } = useListSalesDocuments({ kind: "order", limit: 500 });
  const salesDocs = _salesDocsPaginated?.data ?? [];
  const { data: shipments = [] } = useListFreightShipments();

  const save = async () => {
    if (!form.date) { toast({ title: t.common.error, variant: "destructive" }); return; }
    const body: any = {
      date: form.date,
      vendorEmployee: form.vendorEmployee || undefined,
      expenseType: form.expenseType,
      transactionType: form.transactionType,
      categoryId: form.categoryId || undefined,
      description: form.description || undefined,
      qty: form.qty,
      unit: form.unit || undefined,
      unitPrice: form.unitPrice,
      taxRateId: form.taxRateId || undefined,
      currency: form.currency,
      notes: form.notes || undefined,
      expenseAccountId: form.expenseAccountId || undefined,
      payableAccountId: form.payableAccountId || undefined,
      salesDocId: form.salesDocId || undefined,
      shipmentId: form.shipmentId || undefined,
      sourceAccountId: sourceAccountId ?? undefined,
      vendorId: vendorId ?? undefined,
      userId: userId ?? undefined,
    };
    try {
      if (isNew) {
        const created = await createMut.mutateAsync({ data: body });
        sessionStorage.removeItem("expense_new_salesDocId");
        sessionStorage.removeItem("expense_new_shipmentId");
        qc.invalidateQueries({ queryKey: getListExpensesQueryKey() });
        toast({ title: t.common.success });
        navigate(`/expense/${created.id}`);
      } else {
        await updateMut.mutateAsync({ id: Number(id), data: body });
        qc.invalidateQueries({ queryKey: getListExpensesQueryKey() });
        toast({ title: t.common.success });
      }
    } catch (e: any) {
      toast({ title: e?.message ?? t.common.error, variant: "destructive" });
    }
  };

  const doAction = async (action: string, reason?: string) => {
    try {
      await actionMut.mutateAsync({
        id: Number(id),
        data: { action: action as any, reason },
      });
      qc.invalidateQueries({ queryKey: getListExpensesQueryKey() });
      toast({ title: t.common.success });
    } catch (e: any) {
      toast({ title: e?.message ?? t.common.error, variant: "destructive" });
    }
  };

  const handleUpload = async () => {
    if (!pendingFile || isNew) return;
    setUploading(true);
    const result = await uploadFile(pendingFile);
    if (!result) return;
    addAttachmentMut.mutate(
      {
        id: expId,
        data: {
          objectPath: result.objectPath,
          fileName: pendingFile.name,
          contentType: pendingFile.type || "application/octet-stream",
        },
      },
      {
        onSuccess: () => {
          toast({ title: t.common.success });
          setPendingFile(null);
          setUploading(false);
          qc.invalidateQueries({ queryKey: getGetExpenseQueryKey(expId) });
        },
        onError: (e: unknown) => {
          toast({ title: errMsg(e, t.common.error), variant: "destructive" });
          setUploading(false);
        },
      },
    );
  };

  const handleDeleteAttachment = async (attId: number) => {
    setDeletingAttId(attId);
    deleteAttachmentMut.mutate(
      { id: expId, attId },
      {
        onSuccess: () => {
          toast({ title: t.common.success });
          qc.invalidateQueries({ queryKey: getGetExpenseQueryKey(expId) });
        },
        onError: (e: unknown) => {
          toast({ title: errMsg(e, t.common.error), variant: "destructive" });
        },
        onSettled: () => setDeletingAttId(null),
      },
    );
  };

  if (!isNew && isLoading) {
    return <AppShell><div className="p-8 text-muted-foreground">Memuat data...</div></AppShell>;
  }

  const status = expense?.status ?? "draft";

  const _attachments = expense?.attachments ?? [];
  const _selectedCat = cats.find((c) => c.id === form.categoryId);
  const missingRequired = (_selectedCat?.requiresAttachment === true) && _attachments.length === 0;

  return (
    <AppShell>
      <div className="p-6 space-y-5 max-w-4xl mx-auto">
        {/* Header */}
        <div className="flex items-center gap-3">
          <Button variant="ghost" size="icon" onClick={() => navigate("/expense")}>
            <ArrowLeft size={18} />
          </Button>
          <div className="flex-1">
            <div className="flex items-center gap-2">
              <h1 className="text-xl font-bold">
                {isNew ? "Buat Expense Baru" : expense?.expenseNumber}
              </h1>
              {!isNew && (
                <Badge className={`text-xs border ${STATUS_COLORS[status] ?? ""}`}>
                  {STATUS_LABELS[status] ?? status}
                </Badge>
              )}
            </div>
            {!isNew && <p className="text-sm text-muted-foreground">Dibuat {expense?.createdAt?.slice(0, 10)}</p>}
          </div>
          <div className="flex gap-2 flex-wrap justify-end">
            {canEdit && (
              <Button onClick={save} disabled={createMut.isPending || updateMut.isPending}>
                <Save size={14} className="mr-1" />
                Simpan
              </Button>
            )}
            {!isNew && status === "draft" && (
              <span
                className={missingRequired ? "cursor-not-allowed" : undefined}
                title={missingRequired ? "Harap unggah lampiran bukti sebelum mengajukan" : undefined}
              >
                <Button
                  variant="secondary"
                  onClick={() => doAction("submit")}
                  disabled={actionMut.isPending || missingRequired}
                >
                  <Send size={14} className="mr-1" />
                  Ajukan
                </Button>
              </span>
            )}
            {!isNew && status === "submitted" && (
              <>
                <Button className="bg-emerald-700 hover:bg-emerald-600" onClick={() => doAction("approve")} disabled={actionMut.isPending}>
                  <CheckCircle size={14} className="mr-1" />
                  Setujui
                </Button>
                <Button variant="destructive" onClick={() => setRejectOpen(true)} disabled={actionMut.isPending}>
                  <XCircle size={14} className="mr-1" />
                  Tolak
                </Button>
              </>
            )}
            {!isNew && status === "approved" && (
              <Button className="bg-indigo-700 hover:bg-indigo-600" onClick={() => doAction("post")} disabled={actionMut.isPending}>
                <FileText size={14} className="mr-1" />
                Posting
              </Button>
            )}
            {!isNew && status === "posted" && (
              <Button className="bg-green-700 hover:bg-green-600" onClick={() => setPayOpen(true)} disabled={actionMut.isPending}>
                <Banknote size={14} className="mr-1" />
                Tandai Lunas
              </Button>
            )}
            {!isNew && (status === "submitted" || status === "rejected") && (
              <Button variant="outline" onClick={() => doAction("reset")} disabled={actionMut.isPending}>
                <RotateCcw size={14} className="mr-1" />
                Reset ke Draft
              </Button>
            )}
          </div>
        </div>

        {/* Rejection reason banner */}
        {!isNew && expense?.rejectionReason && (
          <div className="flex items-start gap-2 rounded-lg border border-red-800 bg-red-950/30 p-3 text-sm text-red-300">
            <Info size={15} className="mt-0.5 shrink-0" />
            <div><span className="font-medium">Alasan penolakan: </span>{expense.rejectionReason}</div>
          </div>
        )}

        {/* Transaction Type Toggle */}
        <div className="flex items-center gap-2 rounded-lg border bg-card p-1">
          <button
            type="button"
            onClick={() => !locked && setForm((f) => ({ ...f, transactionType: "expense", categoryId: null }))}
            disabled={locked}
            className={`flex flex-1 items-center justify-center gap-2 rounded-md py-2 px-4 text-sm font-medium transition-colors
              ${form.transactionType === "expense"
                ? "bg-red-900/60 text-red-200 border border-red-700 shadow-sm"
                : "text-muted-foreground hover:bg-muted/60"}`}
          >
            <TrendingDown size={15} />
            Pengeluaran
          </button>
          <button
            type="button"
            onClick={() => !locked && setForm((f) => ({ ...f, transactionType: "income", categoryId: null }))}
            disabled={locked}
            className={`flex flex-1 items-center justify-center gap-2 rounded-md py-2 px-4 text-sm font-medium transition-colors
              ${form.transactionType === "income"
                ? "bg-emerald-900/60 text-emerald-200 border border-emerald-700 shadow-sm"
                : "text-muted-foreground hover:bg-muted/60"}`}
          >
            <TrendingUp size={15} />
            Penerimaan
          </button>
        </div>

        <div className="grid grid-cols-1 gap-5 md:grid-cols-2">
          {/* Left column */}
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm">Informasi Dasar</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="space-y-1.5">
                <Label>Tanggal <span className="text-destructive">*</span></Label>
                <DatePicker value={form.date} onChange={(v) => setForm((f) => ({ ...f, date: v }))} disabled={locked} />
              </div>
              <div className="space-y-1.5">
                <Label>Tipe Expense</Label>
                <Select value={form.expenseType} disabled={locked}
                  onValueChange={(v) => setForm((f) => ({ ...f, expenseType: v as any }))}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="vendor_bill">Tagihan Vendor</SelectItem>
                    <SelectItem value="reimbursement">Reimburse Karyawan</SelectItem>
                    <SelectItem value="internal">Internal</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1.5">
                <Label>Vendor Master (Link)</Label>
                <Select
                  value={form.vendorId?.toString() ?? "none"}
                  disabled={locked}
                  onValueChange={(v) => {
                    if (v === "none") {
                      setForm((f) => ({ ...f, vendorId: null }));
                    } else {
                      const sup = suppliers.find((s) => s.id.toString() === v);
                      setForm((f) => ({
                        ...f,
                        vendorId: Number(v),
                        vendorEmployee: sup?.name ?? f.vendorEmployee,
                      }));
                    }
                  }}
                >
                  <SelectTrigger><SelectValue placeholder="Pilih vendor dari master…" /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="none">— Tidak dipilih —</SelectItem>
                    {suppliers.map((s) => (
                      <SelectItem key={s.id} value={s.id.toString()}>{s.name}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1.5">
                <Label>Vendor / Karyawan</Label>
                <VendorEmployeeCombobox
                  value={form.vendorEmployee}
                  onChange={(v) => setForm((f) => ({ ...f, vendorEmployee: v, vendorId: v ? f.vendorId : null }))}
                  suppliers={suppliers}
                  customers={customers}
                  disabled={locked}
                />
              </div>
              <div className="space-y-1.5">
                <Label>Vendor (Master)</Label>
                <Select
                  value={vendorId ? String(vendorId) : "__none__"}
                  onValueChange={(v) => {
                    if (v === "__none__") { setVendorId(null); return; }
                    const id = Number(v);
                    setVendorId(id);
                    const s = (suppliers as any[]).find((s: any) => s.id === id);
                    if (s && !form.vendorEmployee.trim()) setForm((f) => ({ ...f, vendorEmployee: s.name ?? "" }));
                  }}
                  disabled={locked}
                >
                  <SelectTrigger><SelectValue placeholder="Pilih vendor master..." /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="__none__">— Tidak dipilih —</SelectItem>
                    {(suppliers as any[]).map((s: any) => (
                      <SelectItem key={s.id} value={String(s.id)}>{s.name}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1.5">
                <Label>Karyawan (User Master)</Label>
                <Select
                  value={userId ?? "__none__"}
                  onValueChange={(v) => {
                    if (v === "__none__") { setUserId(null); return; }
                    setUserId(v);
                    const u = (userList as any[]).find((u: any) => u.id === v);
                    if (u && !form.vendorEmployee.trim()) setForm((f) => ({ ...f, vendorEmployee: u.name ?? "" }));
                  }}
                  disabled={locked}
                >
                  <SelectTrigger><SelectValue placeholder="Pilih karyawan..." /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="__none__">— Tidak dipilih —</SelectItem>
                    {(userList as any[]).map((u: any) => (
                      <SelectItem key={u.id} value={u.id}>{u.name}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1.5">
                <Label>Sumber Dana (Akun)</Label>
                <Select
                  value={sourceAccountId ? String(sourceAccountId) : "__none__"}
                  onValueChange={(v) => setSourceAccountId(v === "__none__" ? null : Number(v))}
                  disabled={locked}
                >
                  <SelectTrigger><SelectValue placeholder="Pilih akun kas/bank..." /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="__none__">— Tidak dipilih —</SelectItem>
                    {(paymentAccounts as any[]).filter((a: any) => a.account_class === "kas").length > 0 && (
                      <>
                        <div className="px-2 py-1 text-xs font-semibold text-muted-foreground">💵 Kas</div>
                        {(paymentAccounts as any[]).filter((a: any) => a.account_class === "kas").map((a: any) => (
                          <SelectItem key={a.id} value={String(a.id)}>{a.code} – {a.name}</SelectItem>
                        ))}
                      </>
                    )}
                    {(paymentAccounts as any[]).filter((a: any) => a.account_class === "bank").length > 0 && (
                      <>
                        <div className="px-2 py-1 text-xs font-semibold text-muted-foreground">🏦 Bank</div>
                        {(paymentAccounts as any[]).filter((a: any) => a.account_class === "bank").map((a: any) => (
                          <SelectItem key={a.id} value={String(a.id)}>{a.code} – {a.name}</SelectItem>
                        ))}
                      </>
                    )}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1.5">
                <Label>Kategori</Label>
                <Select
                  value={form.categoryId?.toString() ?? "none"}
                  disabled={locked}
                  onValueChange={(v) => onCategoryChange(v === "none" ? null : Number(v))}
                >
                  <SelectTrigger><SelectValue placeholder="Pilih kategori..." /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="none">— Tidak dipilih —</SelectItem>
                    {cats.filter((c) => c.isActive && ((c as any).categoryType === form.transactionType || (c as any).categoryType === "both" || !(c as any).categoryType)).map((c) => (
                      <SelectItem key={c.id} value={c.id.toString()}>{c.name}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1.5">
                <Label>Deskripsi</Label>
                <Input placeholder="Deskripsi singkat biaya" value={form.description}
                  disabled={locked}
                  onChange={(e) => setForm((f) => ({ ...f, description: e.target.value }))} />
              </div>
              <div className="space-y-1.5">
                <Label>Catatan Internal</Label>
                <Textarea placeholder="Catatan tambahan..." value={form.notes}
                  disabled={locked}
                  onChange={(e) => setForm((f) => ({ ...f, notes: e.target.value }))} />
              </div>
            </CardContent>
          </Card>

          {/* Right column */}
          <div className="space-y-5">
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-sm">Nominal & Pajak</CardTitle>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="grid grid-cols-2 gap-4">
                  <div className="space-y-1.5">
                    <Label>Qty</Label>
                    <Input type="number" min="0" step="any" value={form.qty} disabled={locked}
                      onChange={(e) => setForm((f) => ({ ...f, qty: Number(e.target.value) }))} />
                  </div>
                  <div className="space-y-1.5">
                    <Label>Satuan</Label>
                    <UnitCombobox
                      value={form.unit}
                      onChange={(v) => setForm((f) => ({ ...f, unit: v }))}
                      disabled={locked}
                    />
                  </div>
                </div>
                <div className="space-y-1.5">
                  <Label>Harga Satuan (IDR)</Label>
                  <Input type="number" min="0" step="any" value={form.unitPrice} disabled={locked}
                    onChange={(e) => setForm((f) => ({ ...f, unitPrice: Number(e.target.value) }))} />
                </div>
                <div className="space-y-1.5">
                  <Label className="flex items-center gap-1.5">
                    Pajak
                    {autoFilled.has("taxRateId") && (
                      <span className="text-xs font-normal text-sky-400 bg-sky-950 border border-sky-800 px-1.5 py-0.5 rounded">auto</span>
                    )}
                  </Label>
                  <Select
                    value={form.taxRateId?.toString() ?? "none"}
                    disabled={locked}
                    onValueChange={(v) => {
                      setAutoFilled((s) => { const n = new Set(s); n.delete("taxRateId"); return n; });
                      setForm((f) => ({ ...f, taxRateId: v === "none" ? null : Number(v) }));
                    }}
                  >
                    <SelectTrigger><SelectValue placeholder="Tidak ada pajak" /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="none">Tidak ada pajak</SelectItem>
                      {purchaseTaxes.map((t) => (
                        <SelectItem key={t.id} value={t.id.toString()}>
                          {t.name} ({t.rate}%)
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>

                <Separator />
                <div className="space-y-1 text-sm">
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">Subtotal</span>
                    <span>{idr(subtotal)}</span>
                  </div>
                  {taxAmount > 0 && (
                    <div className="flex justify-between">
                      <span className="text-muted-foreground">Pajak ({selectedTax?.rate}%)</span>
                      <span>{idr(taxAmount)}</span>
                    </div>
                  )}
                  <div className="flex justify-between font-bold text-base pt-1">
                    <span>Total</span>
                    <span className="text-primary">{idr(total)}</span>
                  </div>
                </div>
              </CardContent>
            </Card>

            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-sm">Akun Biaya & Hutang</CardTitle>
              </CardHeader>
              <CardContent className="space-y-4">
                <p className="text-xs text-muted-foreground">
                  Terisi otomatis dari kategori. Bisa diubah manual jika perlu.
                </p>
                <div className="space-y-1.5">
                  <Label className="flex items-center gap-1.5">
                    Akun Biaya (Debit)
                    {autoFilled.has("expenseAccountId") && (
                      <span className="text-xs font-normal text-sky-400 bg-sky-950 border border-sky-800 px-1.5 py-0.5 rounded">auto</span>
                    )}
                  </Label>
                  <AccountCombobox
                    accounts={accounts.filter((a) => a.type === "expense" || a.type === "asset")}
                    value={form.expenseAccountId ?? null}
                    disabled={locked}
                    onChange={(id) => {
                      setAutoFilled((s) => { const n = new Set(s); n.delete("expenseAccountId"); return n; });
                      setForm((f) => ({ ...f, expenseAccountId: id }));
                    }}
                    placeholder="Dari kategori / default"
                  />
                </div>
                <div className="space-y-1.5">
                  <Label className="flex items-center gap-1.5">
                    Akun Hutang (Kredit)
                    {autoFilled.has("payableAccountId") && (
                      <span className="text-xs font-normal text-sky-400 bg-sky-950 border border-sky-800 px-1.5 py-0.5 rounded">auto</span>
                    )}
                  </Label>
                  <Select
                    value={form.payableAccountId?.toString() ?? "none"}
                    disabled={locked}
                    onValueChange={(v) => {
                      setAutoFilled((s) => { const n = new Set(s); n.delete("payableAccountId"); return n; });
                      setForm((f) => ({ ...f, payableAccountId: v === "none" ? null : Number(v) }));
                    }}
                  >
                    <SelectTrigger><SelectValue placeholder="Dari kategori / default" /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="none">— Dari kategori / default —</SelectItem>
                      {accounts.filter((a) => a.type === "liability").map((a) => (
                        <SelectItem key={a.id} value={a.id.toString()}>{a.code} — {a.name}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-1.5">
                  <Label>Sumber Dana (Bank/Kas)</Label>
                  <p className="text-xs text-muted-foreground">Akun kas/bank sebagai sumber pembayaran.</p>
                  <Select
                    value={form.sourceAccountId?.toString() ?? "none"}
                    disabled={locked}
                    onValueChange={(v) => setForm((f) => ({ ...f, sourceAccountId: v === "none" ? null : Number(v) }))}
                  >
                    <SelectTrigger><SelectValue placeholder="Dari pengaturan default" /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="none">— Dari pengaturan default —</SelectItem>
                      {accounts.filter((a) => (a.type as string) === "asset" || (a.type as string) === "bank" || (a.type as string) === "cash").map((a) => (
                        <SelectItem key={a.id} value={a.id.toString()}>{a.code} — {a.name}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              </CardContent>
            </Card>

            {/* Accounting entry info */}
            {!isNew && expense?.entryId && (
              <Card className="border-emerald-800">
                <CardContent className="pt-4 flex items-start gap-2 text-sm">
                  <Info size={15} className="text-emerald-400 mt-0.5 shrink-0" />
                  <div>
                    <p className="text-emerald-300 font-medium">Jurnal telah dibuat</p>
                    <Link href={`/accounting/entries/${expense.entryId}`} className="text-xs text-primary hover:underline flex items-center gap-1 mt-0.5">
                      <ExternalLink size={11} /> Lihat Jurnal Entry #{expense.entryId}
                    </Link>
                  </div>
                </CardContent>
              </Card>
            )}
          </div>
        </div>

        {/* Referensi / Job linking */}
        <Card>
          <CardHeader className="pb-2">
            <div className="flex items-center gap-2">
              <ExternalLink size={14} className="text-muted-foreground" />
              <CardTitle className="text-sm">Referensi / Job</CardTitle>
            </div>
          </CardHeader>
          <CardContent className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label>Sales Order</Label>
              <ReferenceCombobox
                value={form.salesDocId}
                onChange={(v) => setForm((f) => ({ ...f, salesDocId: v }))}
                items={salesDocs}
                getLabel={(d) => `${d.docNumber} — ${d.customerName}`}
                placeholder="Pilih sales order…"
                disabled={locked}
              />
              {form.salesDocId && (
                <Link href={`/sales/orders/${form.salesDocId}`} className="text-xs text-primary hover:underline flex items-center gap-1">
                  <ExternalLink size={11} /> Buka sales order
                </Link>
              )}
            </div>
            <div className="space-y-1.5">
              <Label>Pengiriman (Shipment)</Label>
              <ReferenceCombobox
                value={form.shipmentId}
                onChange={(v) => setForm((f) => ({ ...f, shipmentId: v }))}
                items={shipments}
                getLabel={(s) => `${s.shipmentNumber} — ${s.consigneeName}`}
                placeholder="Pilih pengiriman…"
                disabled={locked}
              />
              {form.shipmentId && (
                <Link href={`/logistics/freight/${form.shipmentId}`} className="text-xs text-primary hover:underline flex items-center gap-1">
                  <ExternalLink size={11} /> Buka pengiriman
                </Link>
              )}
            </div>
          </CardContent>
        </Card>

        {/*
          Attachment panel — only shown for saved expenses.
          Upload/delete are intentionally allowed in all statuses including posted/paid:
          Finance staff may need to add documents retroactively, and the backend does
          not restrict attachment mutations by status.
        */}
        {!isNew && (() => {
          const attachments = expense?.attachments ?? [];
          const selectedCat = cats.find((c) => c.id === form.categoryId);
          const attachmentRequired = selectedCat?.requiresAttachment === true;
          const missingRequired = attachmentRequired && attachments.length === 0;

          return (
            <Card className={missingRequired ? "border-amber-600" : undefined}>
              <CardHeader className="pb-2">
                <div className="flex items-center gap-2">
                  <Paperclip size={14} className="text-muted-foreground" />
                  <CardTitle className="text-sm">
                    Lampiran
                    {attachmentRequired && (
                      <Badge variant="outline" className="ml-2 text-amber-400 border-amber-500 text-xs">Wajib</Badge>
                    )}
                  </CardTitle>
                  <span className="ml-auto text-xs text-muted-foreground">{attachments.length} file</span>
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    className="h-7 text-xs gap-1"
                    onClick={() => setScanOpen(true)}
                  >
                    <ScanLine size={12} />
                    Scan OCR
                  </Button>
                </div>
              </CardHeader>
              <CardContent className="space-y-3">
                {missingRequired && (
                  <div className="flex items-start gap-2 rounded-lg border border-amber-700 bg-amber-950/30 p-3 text-sm text-amber-300">
                    <AlertTriangle size={14} className="mt-0.5 shrink-0" />
                    <span>Kategori <strong>{selectedCat?.name}</strong> mewajibkan lampiran bukti. Harap unggah dokumen pendukung sebelum mengajukan expense.</span>
                  </div>
                )}

                {/* Existing attachments */}
                {attachments.length > 0 && (
                  <div className="space-y-2">
                    {attachments.map((att) => (
                      <AttachmentItem
                        key={att.id}
                        att={att}
                        onDelete={handleDeleteAttachment}
                        deleting={deletingAttId === att.id}
                      />
                    ))}
                  </div>
                )}

                {/* Upload zone */}
                <input
                  ref={fileInputRef}
                  type="file"
                  accept="image/*,application/pdf,.pdf,.doc,.docx,.xls,.xlsx"
                  className="sr-only"
                  onChange={(e) => {
                    const f = e.target.files?.[0];
                    if (f) setPendingFile(f);
                    e.target.value = "";
                  }}
                />
                {pendingFile ? (
                  <div className="rounded-lg border border-border bg-muted/20 p-3 space-y-3">
                    <div className="flex items-center gap-2">
                      <FileText size={14} className="text-primary shrink-0" />
                      <span className="flex-1 truncate text-sm">{pendingFile.name}</span>
                      <Button variant="ghost" size="icon" className="h-6 w-6 shrink-0"
                        onClick={() => setPendingFile(null)} disabled={uploading}>
                        <X size={12} />
                      </Button>
                    </div>
                    <Button size="sm" onClick={handleUpload} disabled={uploading} className="w-full">
                      {uploading
                        ? <><Loader2 size={13} className="mr-1.5 animate-spin" />Mengunggah...</>
                        : <><Upload size={13} className="mr-1.5" />Upload Lampiran</>}
                    </Button>
                  </div>
                ) : (
                  <Button variant="outline" size="sm" className="w-full"
                    onClick={() => fileInputRef.current?.click()}>
                    <Upload size={13} className="mr-1.5" />
                    Pilih File (Gambar / PDF / Dokumen)
                  </Button>
                )}
              </CardContent>
            </Card>
          );
        })()}

        {!isNew && (
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2 text-sm">
                <MessageSquare className="h-4 w-4" /> Korespondensi Email
              </CardTitle>
            </CardHeader>
            <CardContent>
              <CorrespondenceTab linkedType="expense" linkedId={expId} />
            </CardContent>
          </Card>
        )}
      </div>

      {/* OCR Scan dialog */}
      <ScanDocumentDialog
        open={scanOpen}
        onOpenChange={setScanOpen}
        title="Scan Bukti Pengeluaran (OCR)"
        onDataExtracted={(data) => {
          setForm((f) => {
            const next = { ...f };
            if (data.docDate) next.date = data.docDate.slice(0, 10);
            const cost = data.estimatedCost ?? data.lines?.[0]?.unitPrice ?? null;
            if (cost != null && cost > 0) next.unitPrice = cost;
            if (data.partyName) next.vendorEmployee = data.partyName;
            if (data.notes) next.description = data.notes;
            return next;
          });
        }}
      />

      {/* Reject dialog */}
      <Dialog open={rejectOpen} onOpenChange={setRejectOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Tolak Expense</DialogTitle>
          </DialogHeader>
          <div className="space-y-2 py-2">
            <Label>Alasan Penolakan</Label>
            <Textarea placeholder="Jelaskan alasan penolakan..." value={rejectReason}
              onChange={(e) => setRejectReason(e.target.value)} rows={3} />
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setRejectOpen(false)}>Batal</Button>
            <Button variant="destructive" onClick={async () => {
              await doAction("reject", rejectReason);
              setRejectOpen(false);
              setRejectReason("");
            }}>Tolak</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Pay dialog */}
      <Dialog open={payOpen} onOpenChange={setPayOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Konfirmasi Pembayaran</DialogTitle>
          </DialogHeader>
          <div className="space-y-3 py-2">
            <p className="text-sm text-muted-foreground">
              Jurnal pembayaran akan dibuat: <span className="font-medium text-foreground">DR Hutang Usaha / CR Kas atau Bank</span>
            </p>
            <div className="space-y-1.5">
              <Label>Metode Pembayaran</Label>
              <Select value={payMethod} onValueChange={(v) => setPayMethod(v as "bank" | "cash")}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="bank">Transfer Bank</SelectItem>
                  <SelectItem value="cash">Tunai / Kas</SelectItem>
                </SelectContent>
              </Select>
            </div>
            {expense && (
              <div className="rounded-md border bg-muted/30 px-3 py-2 text-sm">
                <span className="text-muted-foreground">Total dibayar: </span>
                <span className="font-semibold">{idr(expense.total)}</span>
              </div>
            )}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setPayOpen(false)}>Batal</Button>
            <Button className="bg-green-700 hover:bg-green-600" onClick={async () => {
              await actionMut.mutateAsync({
                id: Number(id),
                data: { action: "pay" as any, paymentMethod: payMethod },
              });
              setPayOpen(false);
              qc.invalidateQueries({ queryKey: getListExpensesQueryKey() });
              toast({ title: t.common.success });
            }} disabled={actionMut.isPending}>
              <Banknote size={14} className="mr-1" />
              Konfirmasi Lunas
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </AppShell>
  );
}
