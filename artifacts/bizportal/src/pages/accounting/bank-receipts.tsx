/**
 * Bank Receipts Page
 *
 * Halaman untuk mencatat penerimaan uang ke rekening bank/kas perusahaan.
 * Smart mode per jenis penerimaan — akun kredit dipilih/divalidasi otomatis.
 */

import { DatePicker } from "@/components/ui/date-picker";
import React, { useState, useEffect, useCallback, useRef, useMemo } from "react";
import { AIReviewSourcePanel } from "@/components/ai-review";
import { AppShell } from "@/components/layout/AppShell";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { useToast } from "@/hooks/use-toast";
import { useCompany } from "@/contexts/CompanyContext";
import { BackButton } from "@/components/ui/back-button";
import {
  Plus, Trash2, ArrowDownLeft, Ban, Loader2, Eye, X,
  TrendingUp, Wallet, CheckCircle2, AlertTriangle, ScanText, CheckCheck,
  Info, User, DollarSign, Building2, Landmark, Receipt, ArrowLeft,
} from "lucide-react";

// ─────────────────────────────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────────────────────────────

interface Receipt {
  id: number;
  receiptNumber: string | null;
  journalId: number;
  date: string;
  ref: string | null;
  memo: string | null;
  totalAmount: number;
  status: string;
  entryId: number | null;
  createdAt: string;
}

interface ReceiptItem {
  id?: number;
  seq: number;
  receiptType: string;
  accountId: number | null;
  arInvoiceId: number | null;
  description: string;
  amount: number | string;
  notes: string;
  partyName?: string;
}

interface Account {
  id: number;
  code: string;
  name: string;
  type: string;
  subtype?: string | null;
}

interface Journal {
  id: number;
  code: string;
  name: string;
  type: string;
}

interface BrOcrResult {
  vendor_name: string | null;
  invoice_number: string | null;
  invoice_date: string | null;
  total_amount: number | null;
  description: string | null;
  line_items: Array<{ description: string | null; amount: number | null }>;
  confidence: number;
}

interface KasbonEmployee {
  name: string;
  accountId: number | null;
  accountName: string | null;
  accountCode: string | null;
  outstandingBalance: number;
}

interface ArCustomerInvoice {
  id: number;
  invoiceId: number | null;
  invoiceNumber: string;
  grossAmount: number;
  outstandingAmount: number;
  paidAmount: number;
  status: string;
  dueDate: string | null;
}

interface ArCustomer {
  customerName: string;
  totalOutstanding: number;
  invoices: ArCustomerInvoice[];
}

// ─────────────────────────────────────────────────────────────────────────────
// Constants
// ─────────────────────────────────────────────────────────────────────────────

const RECEIPT_MODES = [
  { value: "customer_payment", icon: "🧾", label: "Penerimaan Pelanggan", desc: "Pelunasan piutang usaha dari pelanggan", forType: "customer_payment" },
  { value: "kasbon_return",    icon: "👤", label: "Pengembalian Kasbon",  desc: "Karyawan mengembalikan uang muka/kasbon", forType: "kasbon_return" },
  { value: "other_income",     icon: "💰", label: "Pendapatan Lain-lain", desc: "Penerimaan dari sumber pendapatan lain", forType: "other_income" },
  { value: "equity_injection", icon: "🏛️", label: "Setoran Modal",       desc: "Setoran modal dari pemilik atau investor", forType: "equity_injection" },
  { value: "loan_receipt",     icon: "🏦", label: "Penerimaan Pinjaman",  desc: "Pencairan pinjaman dari bank atau kreditur", forType: "loan_receipt" },
  { value: "other",            icon: "📋", label: "Lainnya",              desc: "Penerimaan lain yang tidak masuk kategori di atas", forType: "other" },
] as const;

type ReceiptMode = typeof RECEIPT_MODES[number]["value"];

const OTHER_RECEIPT_KINDS = [
  { value: "refund",         label: "Refund" },
  { value: "klaim_asuransi", label: "Klaim Asuransi" },
  { value: "hibah",          label: "Hibah" },
  { value: "penyesuaian",    label: "Penyesuaian" },
  { value: "lainnya",        label: "Lainnya" },
];

const ACCOUNT_TYPE_META: Record<string, { label: string; badgeClass: string }> = {
  asset:     { label: "Aset",       badgeClass: "bg-blue-100 text-blue-700 border-blue-200" },
  liability: { label: "Utang",      badgeClass: "bg-purple-100 text-purple-700 border-purple-200" },
  equity:    { label: "Ekuitas",    badgeClass: "bg-slate-100 text-slate-600 border-slate-200" },
  revenue:   { label: "Pendapatan", badgeClass: "bg-green-100 text-green-700 border-green-200" },
  expense:   { label: "Beban",      badgeClass: "bg-orange-100 text-orange-700 border-orange-200" },
};

const fmt = (n: number) =>
  new Intl.NumberFormat("id-ID", { minimumFractionDigits: 0, maximumFractionDigits: 0 }).format(n);

const idr = (n: number) =>
  new Intl.NumberFormat("id-ID", { style: "currency", currency: "IDR", maximumFractionDigits: 0 }).format(n);

// ─────────────────────────────────────────────────────────────────────────────
// useApi hook
// ─────────────────────────────────────────────────────────────────────────────

function useApi(companyId: number | null | undefined) {
  const headers = useCallback(() => ({ "Content-Type": "application/json", "x-company-id": String(companyId ?? "") }), [companyId]);
  const base = "/api";
  const cq = companyId ? `company=${companyId}` : "";

  const fetchReceipts = useCallback(async (): Promise<Receipt[]> => {
    const params = new URLSearchParams({ limit: "100" });
    if (companyId) params.set("company", String(companyId));
    const r = await fetch(`${base}/accounting/bank-receipts?${params}`, { credentials: "include", headers: headers() });
    if (!r.ok) throw new Error(await r.text());
    const d = await r.json();
    return Array.isArray(d) ? d : (d.data ?? []);
  }, [companyId, headers]);

  const fetchDetail = useCallback(async (id: number) => {
    const qs = cq ? `?${cq}` : "";
    const r = await fetch(`${base}/accounting/bank-receipts/${id}${qs}`, { credentials: "include", headers: headers() });
    if (!r.ok) throw new Error(await r.text());
    return r.json();
  }, [cq, headers]);

  const fetchJournals = useCallback(async (): Promise<Journal[]> => {
    const qs = cq ? `?${cq}` : "";
    const r = await fetch(`${base}/accounting/journals${qs}`, { credentials: "include", headers: headers() });
    if (!r.ok) return [];
    const d = await r.json();
    const list: Journal[] = Array.isArray(d) ? d : (d.data ?? []);
    return list.filter((j) => j.type === "bank" || j.type === "cash");
  }, [cq, headers]);

  const fetchAccounts = useCallback(async (forType?: string): Promise<Account[]> => {
    const params = new URLSearchParams();
    if (companyId) params.set("company", String(companyId));
    if (forType)   params.set("for",     forType);
    const qs = params.toString() ? `?${params.toString()}` : "";
    const r = await fetch(`${base}/accounting/bank-receipts/meta/accounts${qs}`, { credentials: "include", headers: headers() });
    if (!r.ok) return [];
    const d = await r.json();
    return Array.isArray(d) ? d : [];
  }, [companyId, headers]);

  const fetchSummary = useCallback(async () => {
    const qs = cq ? `?${cq}` : "";
    const r = await fetch(`${base}/accounting/bank-receipts/summary${qs}`, { credentials: "include", headers: headers() });
    if (!r.ok) return { receiptToday: 0, receiptWeek: 0, receiptMonth: 0 };
    return r.json();
  }, [cq, headers]);

  const fetchKasbonEmployees = useCallback(async (): Promise<KasbonEmployee[]> => {
    const qs = cq ? `?${cq}` : "";
    const r = await fetch(`${base}/accounting/bank-receipts/meta/kasbon-employees${qs}`, { credentials: "include", headers: headers() });
    if (!r.ok) return [];
    const d = await r.json();
    return Array.isArray(d) ? d : [];
  }, [cq, headers]);

  const fetchArCustomers = useCallback(async (): Promise<ArCustomer[]> => {
    const qs = cq ? `?${cq}` : "";
    const r = await fetch(`${base}/accounting/bank-receipts/meta/ar-customers${qs}`, { credentials: "include", headers: headers() });
    if (!r.ok) return [];
    const d = await r.json();
    return Array.isArray(d) ? d : [];
  }, [cq, headers]);

  const createReceipt = useCallback(async (body: object) => {
    const r = await fetch(`${base}/accounting/bank-receipts`, {
      method: "POST", credentials: "include", headers: headers(), body: JSON.stringify(body),
    });
    if (!r.ok) {
      const e = await r.json().catch(() => ({}));
      throw new Error((e as Record<string, string>).message ?? `HTTP ${r.status}`);
    }
    return r.json();
  }, [headers]);

  const voidReceipt = useCallback(async (id: number, reason: string) => {
    const r = await fetch(`${base}/accounting/bank-receipts/${id}/void`, {
      method: "POST", credentials: "include", headers: headers(), body: JSON.stringify({ reason }),
    });
    if (!r.ok) {
      const e = await r.json().catch(() => ({}));
      throw new Error((e as Record<string, string>).message ?? `HTTP ${r.status}`);
    }
    return r.json();
  }, [headers]);

  return useMemo(() => ({
    fetchReceipts, fetchDetail, fetchJournals, fetchAccounts, fetchSummary,
    fetchKasbonEmployees, fetchArCustomers, createReceipt, voidReceipt,
  }), [fetchReceipts, fetchDetail, fetchJournals, fetchAccounts, fetchSummary, fetchKasbonEmployees, fetchArCustomers, createReceipt, voidReceipt]);
}

// ─────────────────────────────────────────────────────────────────────────────
// Shared sub-components
// ─────────────────────────────────────────────────────────────────────────────

function JournalAutoInfo({ lines }: { lines: Array<{ label: string; amount: number; side: "dr" | "cr" }> }) {
  return (
    <div className="rounded-lg bg-slate-50 border border-slate-200 p-3 text-xs space-y-1">
      <p className="font-semibold text-slate-500 mb-1.5">Preview Jurnal Otomatis</p>
      {lines.map((ln, i) => (
        <div key={i} className={`flex justify-between ${ln.side === "cr" ? "pl-5 text-slate-500" : "text-slate-700 font-medium"}`}>
          <span>{ln.side === "dr" ? "DR" : "CR"} {ln.label}</span>
          <span className="font-mono">{ln.amount > 0 ? `Rp ${fmt(ln.amount)}` : "—"}</span>
        </div>
      ))}
    </div>
  );
}

function AccountSelect({
  accounts, value, onChange, placeholder, className,
}: {
  accounts: Account[]; value: number | null;
  onChange: (id: number) => void; placeholder?: string; className?: string;
}) {
  return (
    <Select value={value ? String(value) : ""} onValueChange={(v) => onChange(Number(v))}>
      <SelectTrigger className={className ?? "h-9"}>
        <SelectValue placeholder={placeholder ?? "Pilih akun..."} />
      </SelectTrigger>
      <SelectContent className="max-h-60">
        {accounts.map((a) => (
          <SelectItem key={a.id} value={String(a.id)}>
            <span className="font-mono text-[10px] text-slate-400 mr-1.5">{a.code}</span>
            {a.name}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// LineItemRow — untuk mode "other" saja
// ─────────────────────────────────────────────────────────────────────────────

function LineItemRow({
  item, idx, accounts, onChange, onRemove, canRemove,
}: {
  item: ReceiptItem; idx: number; accounts: Account[];
  onChange: (idx: number, field: keyof ReceiptItem, value: string | number | null) => void;
  onRemove: (idx: number) => void; canRemove: boolean;
}) {
  const acct = accounts.find((a) => a.id === item.accountId);
  const meta = acct ? (ACCOUNT_TYPE_META[acct.type] ?? null) : null;

  return (
    <div className="rounded-lg border border-slate-200 bg-slate-50 p-3 space-y-2">
      <div className="flex items-center gap-2">
        <span className="text-xs font-mono text-slate-400 shrink-0">#{idx + 1}</span>
        <div className="flex-1 grid grid-cols-2 gap-2">
          <div>
            <Label className="text-xs mb-1 block">Akun Kredit <span className="text-red-500">*</span></Label>
            <AccountSelect accounts={accounts} value={item.accountId}
              onChange={(v) => onChange(idx, "accountId", v)} className="h-8 text-xs" />
            {meta && (
              <span className={`mt-0.5 inline-flex items-center rounded border text-[10px] px-1 py-0 ${meta.badgeClass}`}>
                {meta.label}
              </span>
            )}
          </div>
          <div>
            <Label className="text-xs mb-1 block">Jumlah (IDR) <span className="text-red-500">*</span></Label>
            <Input type="number" min="0" step="1000" className="h-8 text-xs"
              value={String(item.amount)}
              onChange={(e) => onChange(idx, "amount", e.target.value)} />
            {Number(item.amount) > 0 && (
              <p className="text-[10px] text-slate-400 mt-0.5">{idr(Number(item.amount))}</p>
            )}
          </div>
        </div>
        {canRemove && (
          <button type="button" onClick={() => onRemove(idx)}
            className="shrink-0 rounded p-1 text-slate-400 hover:text-red-500 hover:bg-red-50">
            <Trash2 className="h-3.5 w-3.5" />
          </button>
        )}
      </div>
      <div className="grid grid-cols-2 gap-2">
        <div>
          <Label className="text-xs mb-1 block">Keterangan</Label>
          <Input className="h-7 text-xs" placeholder="Deskripsi singkat..."
            value={item.description} onChange={(e) => onChange(idx, "description", e.target.value)} />
        </div>
        <div>
          <Label className="text-xs mb-1 block">Catatan</Label>
          <Input className="h-7 text-xs" placeholder="Opsional..."
            value={item.notes} onChange={(e) => onChange(idx, "notes", e.target.value)} />
        </div>
      </div>
      <div>
        <Label className="text-xs mb-1 block">Nama Pihak (item ini)</Label>
        <Input className="h-7 text-xs" placeholder="Opsional — nama pengirim spesifik untuk baris ini..."
          value={item.partyName ?? ""} onChange={(e) => onChange(idx, "partyName", e.target.value)} />
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// CreateReceiptDialog
// ─────────────────────────────────────────────────────────────────────────────

function CreateReceiptDialog({
  open, onOpenChange, journals, fetchAccounts, fetchKasbonEmployees, fetchArCustomers, createReceipt, onCreated,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  journals: Journal[];
  fetchAccounts: (forType?: string) => Promise<Account[]>;
  fetchKasbonEmployees: () => Promise<KasbonEmployee[]>;
  fetchArCustomers: () => Promise<ArCustomer[]>;
  createReceipt: (body: object) => Promise<unknown>;
  onCreated: () => void;
}) {
  const { toast } = useToast();
  const [saving, setSaving] = useState(false);
  const [mode, setMode] = useState<ReceiptMode>("customer_payment");
  const [form, setForm] = useState({ journalId: "", date: new Date().toISOString().split("T")[0]!, ref: "", memo: "", counterpartyName: "", counterpartyType: "" });

  // OCR state
  const ocrFileRef = useRef<HTMLInputElement>(null);
  const [ocrLoading, setOcrLoading] = useState(false);
  const [ocrResult, setOcrResult] = useState<BrOcrResult | null>(null);
  const [ocrApplied, setOcrApplied] = useState(false);

  // ── Kasbon Return state ────────────────────────────────────────────────────
  const [kasbonEmployees, setKasbonEmployees] = useState<KasbonEmployee[]>([]);
  const [kasbonLoading, setKasbonLoading] = useState(false);
  const [selectedEmployee, setSelectedEmployee] = useState<KasbonEmployee | null>(null);
  const [kasbonReturnAmount, setKasbonReturnAmount] = useState("");

  // ── Other Income state ─────────────────────────────────────────────────────
  const [incomeAccounts, setIncomeAccounts] = useState<Account[]>([]);
  const [selectedIncomeAccId, setSelectedIncomeAccId] = useState<number | null>(null);
  const [incomeAmount, setIncomeAmount] = useState("");
  const [incomeDesc, setIncomeDesc] = useState("");

  // ── Loan Receipt state ─────────────────────────────────────────────────────
  const [loanAccounts, setLoanAccounts] = useState<Account[]>([]);
  const [selectedLoanAccId, setSelectedLoanAccId] = useState<number | null>(null);
  const [loanAmount, setLoanAmount] = useState("");
  const [loanDesc, setLoanDesc] = useState("");

  // ── Equity Injection state ─────────────────────────────────────────────────
  const [equityAccounts, setEquityAccounts] = useState<Account[]>([]);
  const [selectedEquityAccId, setSelectedEquityAccId] = useState<number | null>(null);
  const [equityAmount, setEquityAmount] = useState("");
  const [equityDesc, setEquityDesc] = useState("");

  // ── Customer Payment state ─────────────────────────────────────────────────
  const [arCustomers, setArCustomers] = useState<ArCustomer[]>([]);
  const [arLoading, setArLoading] = useState(false);
  const [selectedCustomerName, setSelectedCustomerName] = useState<string | null>(null);
  const [invoicePayments, setInvoicePayments] = useState<Record<number, string>>({});
  const [cpAccounts, setCpAccounts] = useState<Account[]>([]);
  const [cpAccountId, setCpAccountId] = useState<number | null>(null);

  // ── Other (multi-line) state ───────────────────────────────────────────────
  const emptyItem = (): ReceiptItem => ({ seq: 1, receiptType: "other", accountId: null, arInvoiceId: null, description: "", amount: "", notes: "" });
  const [items, setItems] = useState<ReceiptItem[]>([emptyItem()]);
  const [otherAccounts, setOtherAccounts] = useState<Account[]>([]);
  const [otherKind, setOtherKind] = useState("");

  // ── Load data per mode ─────────────────────────────────────────────────────
  useEffect(() => {
    if (!open) return;
    switch (mode) {
      case "kasbon_return":
        setKasbonLoading(true);
        fetchKasbonEmployees().then(setKasbonEmployees).finally(() => setKasbonLoading(false));
        break;
      case "other_income":
        fetchAccounts("other_income").then(setIncomeAccounts);
        break;
      case "loan_receipt":
        fetchAccounts("loan_receipt").then(setLoanAccounts);
        break;
      case "equity_injection":
        fetchAccounts("equity_injection").then(setEquityAccounts);
        break;
      case "customer_payment":
        setArLoading(true);
        Promise.all([fetchArCustomers(), fetchAccounts("customer_payment")])
          .then(([customers, accts]) => {
            setArCustomers(customers);
            setCpAccounts(accts);
            const auto = accts.find((a) => /piutang.*(usaha|dagang)/i.test(a.name))
              ?? accts.find((a) => /piutang/i.test(a.name));
            if (auto) setCpAccountId(auto.id);
          })
          .finally(() => setArLoading(false));
        break;
      case "other":
        fetchAccounts().then(setOtherAccounts);
        break;
    }
  }, [open, mode, fetchAccounts, fetchArCustomers, fetchKasbonEmployees]);

  // ── Reset smart state on mode change ──────────────────────────────────────
  useEffect(() => {
    setSelectedEmployee(null); setKasbonReturnAmount("");
    setSelectedIncomeAccId(null); setIncomeAmount(""); setIncomeDesc("");
    setSelectedLoanAccId(null); setLoanAmount(""); setLoanDesc("");
    setSelectedEquityAccId(null); setEquityAmount(""); setEquityDesc("");
    setSelectedCustomerName(null); setInvoicePayments({});
    setItems([emptyItem()]); setOtherKind("");
  }, [mode]);

  // ── Reset entire form ──────────────────────────────────────────────────────
  const resetForm = () => {
    setForm({ journalId: "", date: new Date().toISOString().split("T")[0]!, ref: "", memo: "", counterpartyName: "", counterpartyType: "" });
    setMode("customer_payment");
    setOcrResult(null); setOcrApplied(false);
    setSelectedEmployee(null); setKasbonReturnAmount("");
    setSelectedIncomeAccId(null); setIncomeAmount(""); setIncomeDesc("");
    setSelectedLoanAccId(null); setLoanAmount(""); setLoanDesc("");
    setSelectedEquityAccId(null); setEquityAmount(""); setEquityDesc("");
    setSelectedCustomerName(null); setInvoicePayments({});
    setItems([emptyItem()]); setOtherKind("");
  };

  // ── Computed total ─────────────────────────────────────────────────────────
  const totalAmount = useMemo(() => {
    switch (mode) {
      case "kasbon_return":    return Number(kasbonReturnAmount) || 0;
      case "other_income":     return Number(incomeAmount) || 0;
      case "loan_receipt":     return Number(loanAmount) || 0;
      case "equity_injection": return Number(equityAmount) || 0;
      case "customer_payment": return Object.values(invoicePayments).reduce((s, v) => s + (Number(v) || 0), 0);
      case "other":            return items.reduce((s, it) => s + (Number(it.amount) || 0), 0);
    }
  }, [mode, kasbonReturnAmount, incomeAmount, loanAmount, equityAmount, invoicePayments, items]);

  // ── Build submission items ─────────────────────────────────────────────────
  function buildSubmissionItems(): { items: object[]; error?: string } {
    switch (mode) {
      case "kasbon_return": {
        if (!selectedEmployee) return { items: [], error: "Pilih karyawan terlebih dahulu" };
        if (!selectedEmployee.accountId) return { items: [], error: "Karyawan tidak memiliki akun piutang kasbon. Pastikan kasbon tercatat dengan akun piutang." };
        const amt = Number(kasbonReturnAmount);
        if (amt <= 0) return { items: [], error: "Jumlah pengembalian harus lebih dari 0" };
        if (amt > selectedEmployee.outstandingBalance) return { items: [], error: "Jumlah pengembalian tidak boleh melebihi saldo kasbon." };
        return { items: [{ seq: 1, receiptType: "kasbon_return", accountId: selectedEmployee.accountId, arInvoiceId: null, description: `Pengembalian Kasbon — ${selectedEmployee.name}`, amount: amt, notes: "" }] };
      }
      case "other_income": {
        if (!selectedIncomeAccId) return { items: [], error: "Pilih kategori pendapatan" };
        const amt = Number(incomeAmount);
        if (amt <= 0) return { items: [], error: "Jumlah harus lebih dari 0" };
        return { items: [{ seq: 1, receiptType: "other_income", accountId: selectedIncomeAccId, arInvoiceId: null, description: incomeDesc || "Pendapatan Lain-lain", amount: amt, notes: "" }] };
      }
      case "loan_receipt": {
        if (!selectedLoanAccId) return { items: [], error: "Pilih pemberi pinjaman" };
        const amt = Number(loanAmount);
        if (amt <= 0) return { items: [], error: "Jumlah harus lebih dari 0" };
        return { items: [{ seq: 1, receiptType: "loan_receipt", accountId: selectedLoanAccId, arInvoiceId: null, description: loanDesc || "Penerimaan Pinjaman", amount: amt, notes: "" }] };
      }
      case "equity_injection": {
        if (!selectedEquityAccId) return { items: [], error: "Pilih investor / pemilik modal" };
        const amt = Number(equityAmount);
        if (amt <= 0) return { items: [], error: "Jumlah harus lebih dari 0" };
        return { items: [{ seq: 1, receiptType: "equity_injection", accountId: selectedEquityAccId, arInvoiceId: null, description: equityDesc || "Setoran Modal", amount: amt, notes: "" }] };
      }
      case "customer_payment": {
        if (!selectedCustomerName) return { items: [], error: "Pilih pelanggan terlebih dahulu" };
        if (!cpAccountId) return { items: [], error: "Pilih akun piutang usaha" };
        const paid = Object.entries(invoicePayments).filter(([, v]) => Number(v) > 0);
        if (paid.length === 0) return { items: [], error: "Masukkan jumlah bayar untuk minimal satu invoice" };
        const customer = arCustomers.find((c) => c.customerName === selectedCustomerName);
        return {
          items: paid.map(([arId, amt], i) => {
            const inv = customer?.invoices.find((inv) => inv.id === Number(arId));
            return { seq: i + 1, receiptType: "customer_payment", accountId: cpAccountId, arInvoiceId: Number(arId), description: `Pelunasan ${inv?.invoiceNumber ?? `AR-${arId}`} — ${selectedCustomerName}`, amount: Number(amt), notes: "" };
          }),
        };
      }
      case "other": {
        if (items.some((it) => !it.accountId)) return { items: [], error: "Semua item harus memilih akun kredit" };
        if (items.some((it) => Number(it.amount) <= 0)) return { items: [], error: "Jumlah setiap item harus lebih dari 0" };
        const kindLabel = OTHER_RECEIPT_KINDS.find((k) => k.value === otherKind)?.label;
        return { items: items.map((it, i) => ({ ...it, seq: i + 1, receiptType: "other", amount: Number(it.amount), description: it.description || kindLabel || "Penerimaan Lainnya", notes: it.notes })) };
      }
    }
  }

  // ── Other mode item helpers ────────────────────────────────────────────────
  const handleItemChange = (idx: number, field: keyof ReceiptItem, value: string | number | null) => {
    setItems((prev) => { const next = [...prev]; next[idx] = { ...next[idx]!, [field]: value }; return next; });
  };
  const addItem = () => setItems((prev) => [...prev, { ...emptyItem(), seq: prev.length + 1 }]);
  const removeItem = (idx: number) => setItems((prev) => prev.filter((_, i) => i !== idx));

  // ── OCR ───────────────────────────────────────────────────────────────────
  const handleOcrFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    e.target.value = "";
    setOcrLoading(true); setOcrResult(null); setOcrApplied(false);
    try {
      const fd = new FormData();
      fd.append("file", file);
      const r = await fetch("/api/accounting/bank-disbursements/ocr-extract", { method: "POST", credentials: "include", body: fd });
      if (!r.ok) throw new Error((await r.json().catch(() => ({}))).error ?? `HTTP ${r.status}`);
      setOcrResult((await r.json()).data as BrOcrResult);
    } catch (err) {
      toast({ title: "OCR gagal", description: String(err), variant: "destructive" });
    } finally { setOcrLoading(false); }
  };

  const handleApplyOcr = () => {
    if (!ocrResult) return;
    setForm((prev) => ({
      ...prev,
      ...(ocrResult.invoice_date ? { date: ocrResult.invoice_date } : {}),
      ...(ocrResult.invoice_number ? { ref: ocrResult.invoice_number } : {}),
      ...(ocrResult.vendor_name ? { memo: `${ocrResult.vendor_name}${ocrResult.description ? ` — ${ocrResult.description}` : ""}` } : {}),
    }));
    if (ocrResult.total_amount != null && ocrResult.total_amount > 0) {
      if (mode === "other_income") setIncomeAmount(String(ocrResult.total_amount));
      else if (mode === "loan_receipt") setLoanAmount(String(ocrResult.total_amount));
      else if (mode === "equity_injection") setEquityAmount(String(ocrResult.total_amount));
      else if (mode === "kasbon_return") setKasbonReturnAmount(String(ocrResult.total_amount));
    }
    setOcrApplied(true);
    toast({ title: "Data OCR berhasil diterapkan ke form" });
  };

  // ── Submit ────────────────────────────────────────────────────────────────
  const handleSubmit = async () => {
    if (!form.journalId) { toast({ title: "Pilih jurnal bank/kas", variant: "destructive" }); return; }
    if (!form.date) { toast({ title: "Tanggal wajib diisi", variant: "destructive" }); return; }
    const { items: submissionItems, error } = buildSubmissionItems();
    if (error) { toast({ title: error, variant: "destructive" }); return; }
    if (submissionItems.length === 0) { toast({ title: "Tidak ada item valid", variant: "destructive" }); return; }
    setSaving(true);
    try {
      await createReceipt({ journalId: Number(form.journalId), date: form.date, ref: form.ref || undefined, memo: form.memo || undefined, counterpartyName: form.counterpartyName || undefined, counterpartyType: form.counterpartyType || undefined, items: submissionItems });
      toast({ title: "Bank Receipt berhasil dibuat & jurnal diposting" });
      onCreated();
      onOpenChange(false);
      resetForm();
    } catch (err) {
      toast({ title: err instanceof Error ? err.message : "Gagal menyimpan", variant: "destructive" });
    } finally { setSaving(false); }
  };

  // ── Derived: journal preview lines ────────────────────────────────────────
  const previewLines = useMemo(() => {
    const dr = { label: "Bank/Kas (jurnal terpilih)", amount: totalAmount, side: "dr" as const };
    switch (mode) {
      case "kasbon_return": {
        const label = selectedEmployee
          ? `${selectedEmployee.accountCode ? selectedEmployee.accountCode + " — " : ""}${selectedEmployee.accountName ?? "Piutang Kasbon"} — ${selectedEmployee.name}`
          : "Piutang Kasbon — (pilih karyawan)";
        return [dr, { label, amount: totalAmount, side: "cr" as const }];
      }
      case "other_income": {
        const acct = incomeAccounts.find((a) => a.id === selectedIncomeAccId);
        return [dr, { label: acct ? `${acct.code} — ${acct.name}` : "(pilih akun pendapatan)", amount: totalAmount, side: "cr" as const }];
      }
      case "loan_receipt": {
        const acct = loanAccounts.find((a) => a.id === selectedLoanAccId);
        return [dr, { label: acct ? `${acct.code} — ${acct.name}` : "(pilih pemberi pinjaman)", amount: totalAmount, side: "cr" as const }];
      }
      case "equity_injection": {
        const acct = equityAccounts.find((a) => a.id === selectedEquityAccId);
        return [dr, { label: acct ? `${acct.code} — ${acct.name}` : "(pilih investor)", amount: totalAmount, side: "cr" as const }];
      }
      case "customer_payment": {
        const acct = cpAccounts.find((a) => a.id === cpAccountId);
        const crs = Object.entries(invoicePayments).filter(([, v]) => Number(v) > 0).map(([arId, v]) => {
          const customer = arCustomers.find((c) => c.customerName === selectedCustomerName);
          const inv = customer?.invoices.find((i) => i.id === Number(arId));
          return { label: `${acct?.name ?? "Piutang Usaha"} — ${inv?.invoiceNumber ?? arId}`, amount: Number(v), side: "cr" as const };
        });
        return [dr, ...crs.length ? crs : [{ label: acct?.name ?? "(pilih akun piutang)", amount: 0, side: "cr" as const }]];
      }
      case "other": {
        const crs = items.map((it) => {
          const acct = otherAccounts.find((a) => a.id === it.accountId);
          return { label: acct ? `${acct.code} — ${acct.name}` : "(pilih akun)", amount: Number(it.amount) || 0, side: "cr" as const };
        });
        return [dr, ...crs];
      }
    }
  }, [mode, totalAmount, selectedEmployee, incomeAccounts, selectedIncomeAccId, loanAccounts, selectedLoanAccId, equityAccounts, selectedEquityAccId, cpAccounts, cpAccountId, arCustomers, selectedCustomerName, invoicePayments, items, otherAccounts]);

  return (
    <Dialog open={open} onOpenChange={(v) => { if (!saving) { onOpenChange(v); if (!v) resetForm(); } }}>
      <DialogContent className="max-w-3xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <div className="flex items-center justify-between gap-3">
            <DialogTitle className="flex items-center gap-2">
              <ArrowDownLeft className="h-5 w-5 text-green-500" />
              Buat Bank Receipt
            </DialogTitle>
            <div className="flex items-center gap-2">
              <button type="button" disabled={ocrLoading || saving} onClick={() => ocrFileRef.current?.click()}
                className="flex items-center gap-1.5 rounded-lg border border-violet-300 bg-violet-50 px-3 py-1.5 text-xs font-medium text-violet-700 hover:bg-violet-100 disabled:opacity-50 transition-colors">
                {ocrLoading ? <><Loader2 className="h-3.5 w-3.5 animate-spin" />Menganalisis...</> : <><ScanText className="h-3.5 w-3.5" />Import via AI OCR</>}
              </button>
              <input ref={ocrFileRef} type="file" accept="image/*,.pdf" className="hidden" onChange={handleOcrFileChange} />
            </div>
          </div>
        </DialogHeader>

        <div className="space-y-5">
          {/* OCR preview */}
          {ocrResult && (
            <div className={`rounded-xl border p-3 space-y-2 text-xs ${ocrApplied ? "border-green-300 bg-green-50" : "border-violet-300 bg-violet-50"}`}>
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <ScanText className={`h-4 w-4 ${ocrApplied ? "text-green-600" : "text-violet-600"}`} />
                  <span className={`font-semibold ${ocrApplied ? "text-green-700" : "text-violet-700"}`}>
                    {ocrApplied ? "Data OCR Diterapkan" : "Hasil Ekstraksi AI"}
                  </span>
                  <span className="rounded-full bg-white border px-1.5 py-0.5 text-slate-500">
                    {Math.round((ocrResult.confidence ?? 0) * 100)}% yakin
                  </span>
                </div>
                <div className="flex items-center gap-2">
                  {!ocrApplied && (
                    <button type="button" onClick={handleApplyOcr}
                      className="flex items-center gap-1 rounded-lg bg-violet-600 px-2.5 py-1 text-xs font-medium text-white hover:bg-violet-700">
                      <CheckCheck className="h-3.5 w-3.5" />Terapkan ke Form
                    </button>
                  )}
                  <button type="button" onClick={() => { setOcrResult(null); setOcrApplied(false); }}
                    className="rounded p-1 hover:bg-white/60 text-slate-400 hover:text-slate-600">
                    <X className="h-3.5 w-3.5" />
                  </button>
                </div>
              </div>
              <div className="grid grid-cols-2 gap-x-4 gap-y-1">
                {ocrResult.vendor_name && <div className="flex gap-2"><span className="text-slate-400">Dari</span><span className="font-medium truncate">{ocrResult.vendor_name}</span></div>}
                {ocrResult.invoice_number && <div className="flex gap-2"><span className="text-slate-400">No.</span><span className="font-mono font-medium">{ocrResult.invoice_number}</span></div>}
                {ocrResult.invoice_date && <div className="flex gap-2"><span className="text-slate-400">Tanggal</span><span>{ocrResult.invoice_date}</span></div>}
                {ocrResult.total_amount != null && <div className="flex gap-2"><span className="text-slate-400">Total</span><span className="font-semibold">Rp {fmt(ocrResult.total_amount)}</span></div>}
              </div>
            </div>
          )}

          {/* Mode selector */}
          <div>
            <p className="text-xs font-semibold text-slate-500 mb-2 uppercase tracking-wide">Pilih Jenis Penerimaan</p>
            <div className="grid grid-cols-3 gap-2">
              {RECEIPT_MODES.map((rm) => (
                <button key={rm.value} type="button" onClick={() => setMode(rm.value)}
                  className={`rounded-lg border p-2.5 text-left transition-colors ${mode === rm.value ? "border-green-400 bg-green-50 shadow-sm" : "border-slate-200 hover:border-green-200 hover:bg-green-50/30"}`}>
                  <div className="flex items-center gap-1.5 mb-1">
                    <span className="text-base">{rm.icon}</span>
                    <span className={`text-xs font-semibold leading-tight ${mode === rm.value ? "text-green-700" : "text-slate-700"}`}>{rm.label}</span>
                  </div>
                  <p className="text-[10px] text-slate-400 leading-snug">{rm.desc}</p>
                </button>
              ))}
            </div>
          </div>

          {/* Header fields */}
          <div className="grid grid-cols-2 gap-4">
            <div>
              <Label className="text-sm font-medium">Jurnal Bank/Kas <span className="text-red-500">*</span></Label>
              <Select value={form.journalId} onValueChange={(v) => setForm((p) => ({ ...p, journalId: v }))}>
                <SelectTrigger className="mt-1"><SelectValue placeholder="Pilih jurnal..." /></SelectTrigger>
                <SelectContent>
                  {journals.map((j) => (
                    <SelectItem key={j.id} value={String(j.id)}>
                      <span className="font-mono text-xs text-slate-500 mr-2">{j.code}</span>{j.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label className="text-sm font-medium">Tanggal <span className="text-red-500">*</span></Label>
              <DatePicker value={form.date} onChange={(v) => setForm((p) => ({ ...p, date: v }))} className="mt-1" />
            </div>
            <div>
              <Label className="text-sm font-medium">Referensi / No. Dokumen</Label>
              <Input className="mt-1" placeholder="Opsional..." value={form.ref} onChange={(e) => setForm((p) => ({ ...p, ref: e.target.value }))} />
            </div>
            <div>
              <Label className="text-sm font-medium">Keterangan (Memo)</Label>
              <Input className="mt-1" placeholder="Catatan singkat..." value={form.memo} onChange={(e) => setForm((p) => ({ ...p, memo: e.target.value }))} />
            </div>
          </div>

          {/* Counterparty fields */}
          <div className="rounded-lg border border-slate-200 bg-slate-50 p-3 space-y-3">
            <p className="text-xs font-semibold text-slate-500 uppercase tracking-wide">Pihak Pengirim / Lawan Transaksi (Opsional)</p>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label className="text-xs font-medium text-slate-600 mb-1 block">Nama / Perusahaan</Label>
                <Input
                  className="h-8 text-sm"
                  placeholder="Nama pelanggan, investor, bank..."
                  value={form.counterpartyName}
                  onChange={(e) => setForm((p) => ({ ...p, counterpartyName: e.target.value }))}
                />
              </div>
              <div>
                <Label className="text-xs font-medium text-slate-600 mb-1 block">Kategori Pihak</Label>
                <Select value={form.counterpartyType} onValueChange={(v) => setForm((p) => ({ ...p, counterpartyType: v }))}>
                  <SelectTrigger className="h-8 text-sm"><SelectValue placeholder="Pilih kategori..." /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="customer">Pelanggan</SelectItem>
                    <SelectItem value="shareholder">Pemegang Saham / Investor</SelectItem>
                    <SelectItem value="bank">Bank / Kreditur</SelectItem>
                    <SelectItem value="employee">Karyawan</SelectItem>
                    <SelectItem value="government">Pemerintah</SelectItem>
                    <SelectItem value="other">Lainnya</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>
          </div>

          {/* ── Smart panels per mode ─────────────────────────────────────── */}
          <div className="rounded-xl border border-slate-200 bg-white p-4 space-y-4">
            <p className="text-xs font-semibold text-slate-500 uppercase tracking-wide flex items-center gap-1.5">
              {mode === "kasbon_return" && <User className="h-3.5 w-3.5" />}
              {mode === "other_income" && <DollarSign className="h-3.5 w-3.5" />}
              {mode === "loan_receipt" && <Landmark className="h-3.5 w-3.5" />}
              {mode === "equity_injection" && <Building2 className="h-3.5 w-3.5" />}
              {mode === "customer_payment" && <Receipt className="h-3.5 w-3.5" />}
              {RECEIPT_MODES.find((m) => m.value === mode)?.label}
            </p>

            {/* ── KASBON RETURN ──────────────────────────────────────────── */}
            {mode === "kasbon_return" && (
              <div className="space-y-4">
                <div>
                  <Label className="text-sm">Karyawan <span className="text-red-500">*</span></Label>
                  {kasbonLoading ? (
                    <div className="mt-1 flex items-center gap-2 text-xs text-slate-400"><Loader2 className="h-3.5 w-3.5 animate-spin" />Memuat data karyawan...</div>
                  ) : kasbonEmployees.length === 0 ? (
                    <div className="mt-1 flex items-center gap-1.5 rounded-lg border border-dashed border-slate-300 px-3 py-2 text-xs text-slate-400">
                      <Info className="h-3.5 w-3.5" />Tidak ada karyawan dengan saldo kasbon outstanding
                    </div>
                  ) : (
                    <Select value={selectedEmployee?.name ?? ""} onValueChange={(name) => {
                      const emp = kasbonEmployees.find((e) => e.name === name) ?? null;
                      setSelectedEmployee(emp);
                      setKasbonReturnAmount("");
                    }}>
                      <SelectTrigger className="mt-1"><SelectValue placeholder="Pilih karyawan..." /></SelectTrigger>
                      <SelectContent>
                        {kasbonEmployees.map((emp) => (
                          <SelectItem key={emp.name} value={emp.name}>
                            <span className="font-medium">{emp.name}</span>
                            <span className="ml-2 text-slate-400 text-[10px]">Outstanding: Rp {fmt(emp.outstandingBalance)}</span>
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  )}
                </div>

                {selectedEmployee && (
                  <>
                    <div className="rounded-lg bg-amber-50 border border-amber-200 p-3 flex items-center justify-between">
                      <div>
                        <p className="text-xs text-amber-600 font-medium">Saldo Kasbon Outstanding</p>
                        {selectedEmployee.accountName && (
                          <p className="text-[10px] text-amber-500 mt-0.5">
                            {selectedEmployee.accountCode} — {selectedEmployee.accountName}
                          </p>
                        )}
                        {!selectedEmployee.accountId && (
                          <p className="text-[10px] text-red-500 mt-0.5">
                            ⚠ Akun piutang tidak terdefinisi pada kasbon karyawan ini
                          </p>
                        )}
                      </div>
                      <p className="text-xl font-bold text-amber-700">{idr(selectedEmployee.outstandingBalance)}</p>
                    </div>

                    <div>
                      <Label className="text-sm">Jumlah Pengembalian <span className="text-red-500">*</span></Label>
                      <Input
                        type="number" min="0" step="1000" className={`mt-1 ${Number(kasbonReturnAmount) > selectedEmployee.outstandingBalance ? "border-red-400 focus:ring-red-300" : ""}`}
                        placeholder={`Maks. Rp ${fmt(selectedEmployee.outstandingBalance)}`}
                        value={kasbonReturnAmount}
                        onChange={(e) => setKasbonReturnAmount(e.target.value)}
                      />
                      {Number(kasbonReturnAmount) > 0 && (
                        <p className="text-xs text-slate-400 mt-0.5">{idr(Number(kasbonReturnAmount))}</p>
                      )}
                      {Number(kasbonReturnAmount) > selectedEmployee.outstandingBalance && (
                        <div className="mt-1.5 flex items-center gap-1.5 rounded-lg border border-red-200 bg-red-50 px-2.5 py-1.5 text-xs text-red-600">
                          <AlertTriangle className="h-3.5 w-3.5 shrink-0" />
                          Jumlah pengembalian tidak boleh melebihi saldo kasbon.
                        </div>
                      )}
                    </div>
                  </>
                )}
              </div>
            )}

            {/* ── OTHER INCOME ───────────────────────────────────────────── */}
            {mode === "other_income" && (
              <div className="space-y-4">
                <div>
                  <Label className="text-sm">Kategori Pendapatan <span className="text-red-500">*</span></Label>
                  {incomeAccounts.length === 0 ? (
                    <div className="mt-1 flex items-center gap-1.5 rounded-lg border border-dashed border-slate-300 px-3 py-2 text-xs text-slate-400">
                      <Info className="h-3.5 w-3.5" />Tidak ada akun pendapatan di Chart of Accounts
                    </div>
                  ) : (
                    <AccountSelect accounts={incomeAccounts} value={selectedIncomeAccId}
                      onChange={setSelectedIncomeAccId} placeholder="Pilih akun pendapatan..." className="mt-1" />
                  )}
                  <p className="text-[10px] text-slate-400 mt-1">Pilih akun pendapatan dari Chart of Accounts (Pendapatan Bunga, Sewa, Komisi, dll.)</p>
                </div>
                <div>
                  <Label className="text-sm">Jumlah <span className="text-red-500">*</span></Label>
                  <Input type="number" min="0" step="1000" className="mt-1" value={incomeAmount}
                    onChange={(e) => setIncomeAmount(e.target.value)} />
                  {Number(incomeAmount) > 0 && <p className="text-xs text-slate-400 mt-0.5">{idr(Number(incomeAmount))}</p>}
                </div>
                <div>
                  <Label className="text-sm">Keterangan</Label>
                  <Input className="mt-1" placeholder="Deskripsi singkat pendapatan..." value={incomeDesc}
                    onChange={(e) => setIncomeDesc(e.target.value)} />
                </div>
              </div>
            )}

            {/* ── LOAN RECEIPT ───────────────────────────────────────────── */}
            {mode === "loan_receipt" && (
              <div className="space-y-4">
                <div>
                  <Label className="text-sm">Pemberi Pinjaman <span className="text-red-500">*</span></Label>
                  {loanAccounts.length === 0 ? (
                    <div className="mt-1 flex items-center gap-1.5 rounded-lg border border-dashed border-slate-300 px-3 py-2 text-xs text-slate-400">
                      <Info className="h-3.5 w-3.5" />Tidak ada akun utang di Chart of Accounts
                    </div>
                  ) : (
                    <AccountSelect accounts={loanAccounts} value={selectedLoanAccId}
                      onChange={setSelectedLoanAccId} placeholder="Pilih pemberi pinjaman..." className="mt-1" />
                  )}
                  <p className="text-[10px] text-slate-400 mt-1">
                    Pilih akun utang sesuai sumber pinjaman — Bank, Kreditur, Perusahaan, Direktur, Pemegang Saham, dll.
                  </p>
                </div>
                <div>
                  <Label className="text-sm">Jumlah Pinjaman <span className="text-red-500">*</span></Label>
                  <Input type="number" min="0" step="1000" className="mt-1" value={loanAmount}
                    onChange={(e) => setLoanAmount(e.target.value)} />
                  {Number(loanAmount) > 0 && <p className="text-xs text-slate-400 mt-0.5">{idr(Number(loanAmount))}</p>}
                </div>
                <div>
                  <Label className="text-sm">Keterangan</Label>
                  <Input className="mt-1" placeholder="Nama kreditur, no. kontrak, tenor, dll..." value={loanDesc}
                    onChange={(e) => setLoanDesc(e.target.value)} />
                </div>
              </div>
            )}

            {/* ── EQUITY INJECTION ──────────────────────────────────────── */}
            {mode === "equity_injection" && (
              <div className="space-y-4">
                <div>
                  <Label className="text-sm">Investor / Pemilik Modal <span className="text-red-500">*</span></Label>
                  {equityAccounts.length === 0 ? (
                    <div className="mt-1 flex items-center gap-1.5 rounded-lg border border-dashed border-slate-300 px-3 py-2 text-xs text-slate-400">
                      <Info className="h-3.5 w-3.5" />Tidak ada akun modal di Chart of Accounts
                    </div>
                  ) : (
                    <AccountSelect accounts={equityAccounts} value={selectedEquityAccId}
                      onChange={setSelectedEquityAccId} placeholder="Pilih akun modal investor..." className="mt-1" />
                  )}
                  <p className="text-[10px] text-slate-400 mt-1">
                    Pilih akun modal sesuai nama investor/pemilik. Jurnal: CR Modal Disetor — nama pemilik.
                  </p>
                </div>
                <div>
                  <Label className="text-sm">Jumlah Setoran <span className="text-red-500">*</span></Label>
                  <Input type="number" min="0" step="1000" className="mt-1" value={equityAmount}
                    onChange={(e) => setEquityAmount(e.target.value)} />
                  {Number(equityAmount) > 0 && <p className="text-xs text-slate-400 mt-0.5">{idr(Number(equityAmount))}</p>}
                </div>
                <div>
                  <Label className="text-sm">Keterangan</Label>
                  <Input className="mt-1" placeholder="Keterangan setoran modal..." value={equityDesc}
                    onChange={(e) => setEquityDesc(e.target.value)} />
                </div>
              </div>
            )}

            {/* ── CUSTOMER PAYMENT ──────────────────────────────────────── */}
            {mode === "customer_payment" && (
              <div className="space-y-4">
                <div>
                  <Label className="text-sm">Pelanggan <span className="text-red-500">*</span></Label>
                  {arLoading ? (
                    <div className="mt-1 flex items-center gap-2 text-xs text-slate-400"><Loader2 className="h-3.5 w-3.5 animate-spin" />Memuat data piutang...</div>
                  ) : arCustomers.length === 0 ? (
                    <div className="mt-1 flex items-center gap-1.5 rounded-lg border border-dashed border-slate-300 px-3 py-2 text-xs text-slate-400">
                      <Info className="h-3.5 w-3.5" />Tidak ada piutang outstanding
                    </div>
                  ) : (
                    <Select value={selectedCustomerName ?? ""} onValueChange={(name) => {
                      setSelectedCustomerName(name);
                      setInvoicePayments({});
                    }}>
                      <SelectTrigger className="mt-1"><SelectValue placeholder="Pilih pelanggan..." /></SelectTrigger>
                      <SelectContent>
                        {arCustomers.map((c) => (
                          <SelectItem key={c.customerName} value={c.customerName}>
                            <span className="font-medium">{c.customerName}</span>
                            <span className="ml-2 text-slate-400 text-[10px]">Outstanding: Rp {fmt(c.totalOutstanding)}</span>
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  )}
                </div>

                {selectedCustomerName && (() => {
                  const customer = arCustomers.find((c) => c.customerName === selectedCustomerName);
                  if (!customer) return null;
                  return (
                    <div className="space-y-3">
                      <p className="text-xs font-medium text-slate-600">Invoice Outstanding — {customer.customerName}</p>
                      {customer.invoices.map((inv) => {
                        const payAmt = invoicePayments[inv.id] ?? "";
                        const isOverpay = Number(payAmt) > inv.outstandingAmount && Number(payAmt) > 0;
                        return (
                          <div key={inv.id} className={`rounded-lg border p-3 space-y-2 ${payAmt && Number(payAmt) > 0 ? "border-green-300 bg-green-50/40" : "border-slate-200"}`}>
                            <div className="flex items-center justify-between">
                              <div className="flex items-center gap-2">
                                <span className="text-xs font-mono font-semibold text-slate-700">{inv.invoiceNumber}</span>
                                <span className={`text-[10px] px-1.5 py-0.5 rounded-full font-medium ${inv.status === "OVERDUE" ? "bg-red-100 text-red-600" : inv.status === "PARTIAL" ? "bg-amber-100 text-amber-600" : "bg-blue-100 text-blue-600"}`}>
                                  {inv.status}
                                </span>
                                {inv.dueDate && <span className="text-[10px] text-slate-400">Jatuh tempo: {inv.dueDate}</span>}
                              </div>
                              <span className="text-xs font-semibold text-slate-700">
                                Outstanding: <span className="text-green-700">Rp {fmt(inv.outstandingAmount)}</span>
                              </span>
                            </div>
                            <div className="flex gap-2 items-start">
                              <div className="flex-1">
                                <Label className="text-xs mb-1 block">Jumlah Bayar</Label>
                                <Input
                                  type="number" min="0" step="1000"
                                  className={`h-8 text-xs ${isOverpay ? "border-amber-300" : ""}`}
                                  placeholder={`Maks. Rp ${fmt(inv.outstandingAmount)}`}
                                  value={payAmt}
                                  onChange={(e) => setInvoicePayments((prev) => ({ ...prev, [inv.id]: e.target.value }))}
                                />
                                {Number(payAmt) > 0 && (
                                  <p className="text-[10px] text-slate-400 mt-0.5">{idr(Number(payAmt))}</p>
                                )}
                                {isOverpay && (
                                  <p className="text-[10px] text-amber-600 mt-1 flex items-center gap-1">
                                    <AlertTriangle className="h-3 w-3" />Melebihi outstanding — akan terjadi uang muka pembayaran
                                  </p>
                                )}
                              </div>
                              <Button variant="outline" size="sm" type="button"
                                className="h-8 text-xs shrink-0 mt-5"
                                onClick={() => setInvoicePayments((prev) => ({ ...prev, [inv.id]: String(inv.outstandingAmount) }))}>
                                Lunas
                              </Button>
                              {payAmt && (
                                <button type="button"
                                  className="h-8 mt-5 rounded p-1.5 text-slate-400 hover:text-red-500 hover:bg-red-50"
                                  onClick={() => setInvoicePayments((prev) => { const n = { ...prev }; delete n[inv.id]; return n; })}>
                                  <X className="h-3.5 w-3.5" />
                                </button>
                              )}
                            </div>
                          </div>
                        );
                      })}

                      <div>
                        <Label className="text-xs font-medium">Akun Piutang Usaha <span className="text-red-500">*</span></Label>
                        <p className="text-[10px] text-slate-400 mb-1">Akun yang akan dikredit (CR) — biasanya dipilih otomatis</p>
                        <AccountSelect
                          accounts={cpAccounts.filter((a) => a.type === "asset")}
                          value={cpAccountId} onChange={setCpAccountId}
                          placeholder="Pilih akun piutang usaha..." className="h-8 text-xs" />
                      </div>
                    </div>
                  );
                })()}
              </div>
            )}

            {/* ── OTHER (LAINNYA) ───────────────────────────────────────── */}
            {mode === "other" && (
              <div className="space-y-4">
                <div>
                  <Label className="text-sm">Jenis Penerimaan <span className="text-xs text-slate-400 font-normal">(opsional)</span></Label>
                  <Select value={otherKind} onValueChange={setOtherKind}>
                    <SelectTrigger className="mt-1"><SelectValue placeholder="Pilih jenis penerimaan..." /></SelectTrigger>
                    <SelectContent>
                      {OTHER_RECEIPT_KINDS.map((k) => (
                        <SelectItem key={k.value} value={k.value}>{k.label}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>

                <div>
                  <div className="flex items-center justify-between mb-2">
                    <Label className="text-sm font-semibold">Item Penerimaan</Label>
                    <Button variant="outline" size="sm" onClick={addItem} className="h-7 text-xs gap-1">
                      <Plus className="h-3.5 w-3.5" /> Tambah Item
                    </Button>
                  </div>
                  <div className="space-y-2">
                    {items.map((item, idx) => (
                      <LineItemRow key={idx} item={item} idx={idx} accounts={otherAccounts}
                        onChange={handleItemChange} onRemove={removeItem} canRemove={items.length > 1} />
                    ))}
                  </div>
                </div>
              </div>
            )}
          </div>

          {/* Journal preview */}
          <JournalAutoInfo lines={previewLines} />

          {/* Total */}
          <div className="flex justify-end">
            <div className="text-right">
              <p className="text-xs text-slate-500">Total Penerimaan</p>
              <p className="text-2xl font-black text-green-700">Rp {fmt(totalAmount)}</p>
            </div>
          </div>
        </div>

        <DialogFooter className="gap-2">
          <Button variant="outline" onClick={() => { onOpenChange(false); resetForm(); }} disabled={saving}>Batal</Button>
          <Button onClick={handleSubmit} disabled={saving || totalAmount <= 0} className="bg-green-600 hover:bg-green-700 text-white">
            {saving ? <><Loader2 className="h-4 w-4 mr-2 animate-spin" />Menyimpan...</> : "Simpan & Post Jurnal"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Detail Dialog
// ─────────────────────────────────────────────────────────────────────────────

function DetailDialog({ receiptId, onClose, fetchDetail, onVoid }: {
  receiptId: number | null; onClose: () => void;
  fetchDetail: (id: number) => Promise<any>; onVoid: (id: number) => void;
}) {
  const [data, setData] = useState<any>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!receiptId) return;
    setLoading(true);
    fetchDetail(receiptId).then(setData).catch(() => {}).finally(() => setLoading(false));
  }, [receiptId, fetchDetail]);

  if (!receiptId) return null;

  return (
    <Dialog open={!!receiptId} onOpenChange={(v) => { if (!v) onClose(); }}>
      <DialogContent className="max-w-2xl max-h-[85vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <ArrowDownLeft className="h-5 w-5 text-green-500" />
            Detail Receipt {data?.receiptNumber ?? `#${receiptId}`}
          </DialogTitle>
        </DialogHeader>
        {loading && <div className="flex justify-center py-8"><Loader2 className="h-5 w-5 animate-spin text-slate-400" /></div>}
        {data && (
          <div className="space-y-4">
            <div className="grid grid-cols-2 gap-3 text-sm">
              <div><span className="text-slate-500">No. Receipt</span><p className="font-mono font-semibold">{data.receiptNumber ?? "-"}</p></div>
              <div><span className="text-slate-500">Tanggal</span><p className="font-medium">{data.date}</p></div>
              <div><span className="text-slate-500">Referensi</span><p>{data.ref ?? "-"}</p></div>
              <div><span className="text-slate-500">Memo</span><p>{data.memo ?? "-"}</p></div>
              <div><span className="text-slate-500">Status</span>
                <p><Badge className={data.status === "void" ? "bg-red-100 text-red-700" : "bg-green-100 text-green-700"}>{data.status}</Badge></p>
              </div>
              <div><span className="text-slate-500">Total</span><p className="font-bold text-green-700 text-base">Rp {fmt(data.totalAmount)}</p></div>
            </div>
            {data.voidReason && (
              <div className="rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-700">
                <AlertTriangle className="h-4 w-4 inline mr-1" />Void: {data.voidReason}
              </div>
            )}
            {data.items && data.items.length > 0 && (
              <div>
                <p className="text-xs font-semibold text-slate-500 uppercase mb-2">Line Items</p>
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead className="text-xs">Jenis</TableHead>
                      <TableHead className="text-xs">Keterangan</TableHead>
                      <TableHead className="text-xs text-right">Jumlah</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {data.items.map((it: any) => (
                      <TableRow key={it.id}>
                        <TableCell className="text-xs">
                          <Badge variant="outline" className="text-[10px]">
                            {RECEIPT_MODES.find((m) => m.value === it.receiptType)?.label ?? it.receiptType}
                          </Badge>
                        </TableCell>
                        <TableCell className="text-xs">{it.description ?? "-"}</TableCell>
                        <TableCell className="text-xs text-right font-semibold text-green-700">Rp {fmt(it.amount)}</TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            )}
          </div>
        )}
        {/* Phase 12: AI Review cross-link — non-blocking read-only panel */}
        {data && (
          <AIReviewSourcePanel
            source="CUSTOMER_PAYMENT"
            sourceRecordId={String(receiptId)}
            transactionSnapshot={{
              id: String(receiptId),
              description: data.memo ?? data.ref ?? `Receipt #${receiptId}`,
              amount: data.totalAmount,
              direction: 'CREDIT',
              transactionDate: data.date,
              referenceNumber: data.ref ?? undefined,
            }}
          />
        )}
        <DialogFooter>
          {data && data.status === "posted" && (
            <Button variant="destructive" size="sm" onClick={() => { onVoid(receiptId); onClose(); }}>
              <Ban className="h-4 w-4 mr-1" />Void
            </Button>
          )}
          <Button variant="outline" onClick={onClose}>Tutup</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Main Page
// ─────────────────────────────────────────────────────────────────────────────

export default function BankReceiptsPage() {
  const { toast } = useToast();
  const { activeCompanyId } = useCompany();
  const api = useApi(activeCompanyId);

  const [receipts, setReceipts] = useState<Receipt[]>([]);
  const [journals, setJournals] = useState<Journal[]>([]);
  const [loading, setLoading] = useState(true);
  const [summary, setSummary] = useState({ receiptToday: 0, receiptWeek: 0, receiptMonth: 0 });
  const [createOpen, setCreateOpen] = useState(false);
  const [detailId, setDetailId] = useState<number | null>(null);
  const [voidId, setVoidId] = useState<number | null>(null);
  const [voidReason, setVoidReason] = useState("");
  const [voiding, setVoiding] = useState(false);
  const [search, setSearch] = useState("");

  const loadAll = useCallback(async () => {
    setLoading(true);
    try {
      const [recs, jrnls, summ] = await Promise.all([api.fetchReceipts(), api.fetchJournals(), api.fetchSummary()]);
      setReceipts(recs);
      setJournals(jrnls);
      setSummary(summ);
    } catch (err) {
      toast({ title: "Gagal memuat data", description: String(err), variant: "destructive" });
    } finally { setLoading(false); }
  }, [api, toast]);

  useEffect(() => { loadAll(); }, [loadAll]);

  const handleVoid = async () => {
    if (!voidId || !voidReason.trim()) return;
    setVoiding(true);
    try {
      await api.voidReceipt(voidId, voidReason);
      toast({ title: "Receipt berhasil di-void" });
      setVoidId(null); setVoidReason("");
      loadAll();
    } catch (err) {
      toast({ title: "Gagal void", description: String(err), variant: "destructive" });
    } finally { setVoiding(false); }
  };

  const filtered = receipts.filter((r) => {
    const q = search.toLowerCase();
    return !q || (r.receiptNumber ?? "").toLowerCase().includes(q)
      || (r.ref ?? "").toLowerCase().includes(q)
      || (r.memo ?? "").toLowerCase().includes(q);
  });

  return (
    <AppShell>
      <BackButton href="/accounting" />
      <div className="p-6 space-y-6 max-w-6xl mx-auto">
        <Button variant="ghost" size="sm" className="-ml-2" onClick={() => window.history.back()}>
          <ArrowLeft className="h-4 w-4 mr-1" />Kembali
        </Button>
        {/* Header */}
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-bold text-slate-900 flex items-center gap-2">
              <ArrowDownLeft className="h-6 w-6 text-green-600" />
              Bank Receipt
            </h1>
            <p className="text-sm text-slate-500 mt-0.5">
              Catat penerimaan uang masuk ke rekening bank/kas — pelanggan, kasbon, setoran modal, pinjaman
            </p>
          </div>
          <Button onClick={() => setCreateOpen(true)} className="bg-green-600 hover:bg-green-700 text-white gap-2">
            <Plus className="h-4 w-4" /> Buat Bank Receipt
          </Button>
        </div>

        {/* Stats */}
        <div className="grid grid-cols-3 gap-4">
          {[
            { label: "Penerimaan Hari Ini", value: summary.receiptToday, icon: TrendingUp },
            { label: "Penerimaan Minggu Ini", value: summary.receiptWeek, icon: Wallet },
            { label: "Penerimaan Bulan Ini", value: summary.receiptMonth, icon: CheckCircle2 },
          ].map(({ label, value, icon: Icon }) => (
            <div key={label} className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
              <div className="flex items-center gap-2 text-slate-500 mb-1">
                <Icon className="h-4 w-4 text-green-500" />
                <span className="text-xs font-medium">{label}</span>
              </div>
              <p className="text-xl font-bold text-slate-900">Rp {fmt(value)}</p>
            </div>
          ))}
        </div>

        {/* Table */}
        <div className="rounded-xl border border-slate-200 bg-white shadow-sm">
          <div className="flex items-center justify-between px-4 py-3 border-b border-slate-100">
            <h2 className="text-sm font-semibold text-slate-700">Daftar Bank Receipt</h2>
            <Input placeholder="Cari no. receipt, referensi..." className="h-8 w-56 text-xs"
              value={search} onChange={(e) => setSearch(e.target.value)} />
          </div>

          {loading ? (
            <div className="flex justify-center py-12"><Loader2 className="h-5 w-5 animate-spin text-slate-400" /></div>
          ) : filtered.length === 0 ? (
            <div className="flex flex-col items-center py-12 text-slate-400 gap-2">
              <ArrowDownLeft className="h-8 w-8" />
              <p className="text-sm font-medium">Belum ada bank receipt</p>
              <p className="text-xs">Klik "Buat Bank Receipt" untuk mencatat penerimaan</p>
            </div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow className="bg-slate-50">
                  <TableHead className="text-xs">No. Receipt</TableHead>
                  <TableHead className="text-xs">Tanggal</TableHead>
                  <TableHead className="text-xs">Referensi</TableHead>
                  <TableHead className="text-xs">Memo</TableHead>
                  <TableHead className="text-xs">Pihak</TableHead>
                  <TableHead className="text-xs text-right">Total</TableHead>
                  <TableHead className="text-xs text-center">Status</TableHead>
                  <TableHead className="text-xs text-center">Aksi</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {filtered.map((r) => (
                  <TableRow key={r.id} className="hover:bg-slate-50">
                    <TableCell className="text-xs font-mono font-medium text-green-700">
                      {r.receiptNumber ?? `BR-${r.id}`}
                    </TableCell>
                    <TableCell className="text-xs">{r.date}</TableCell>
                    <TableCell className="text-xs text-slate-500">{r.ref ?? "-"}</TableCell>
                    <TableCell className="text-xs text-slate-500 max-w-[180px] truncate">{r.memo ?? "-"}</TableCell>
                    <TableCell className="text-xs text-slate-500 max-w-[140px] truncate">
                      {(r as any).counterpartyName ?? <span className="text-slate-300">—</span>}
                    </TableCell>
                    <TableCell className="text-xs text-right font-semibold text-green-700">
                      Rp {fmt(r.totalAmount)}
                    </TableCell>
                    <TableCell className="text-center">
                      <Badge className={r.status === "void"
                        ? "bg-red-100 text-red-700 border-red-200"
                        : "bg-green-100 text-green-700 border-green-200"}>
                        {r.status === "void" ? "Void" : "Posted"}
                      </Badge>
                    </TableCell>
                    <TableCell className="text-center">
                      <div className="flex items-center justify-center gap-1">
                        <button type="button" onClick={() => setDetailId(r.id)}
                          className="rounded p-1.5 hover:bg-slate-100 text-slate-500 hover:text-slate-700">
                          <Eye className="h-3.5 w-3.5" />
                        </button>
                        {r.status === "posted" && (
                          <button type="button" onClick={() => setVoidId(r.id)}
                            className="rounded p-1.5 hover:bg-red-50 text-slate-400 hover:text-red-600">
                            <Ban className="h-3.5 w-3.5" />
                          </button>
                        )}
                      </div>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </div>
      </div>

      {/* Create Dialog */}
      <CreateReceiptDialog
        open={createOpen}
        onOpenChange={setCreateOpen}
        journals={journals}
        fetchAccounts={api.fetchAccounts}
        fetchKasbonEmployees={api.fetchKasbonEmployees}
        fetchArCustomers={api.fetchArCustomers}
        createReceipt={api.createReceipt}
        onCreated={loadAll}
      />

      {/* Detail Dialog */}
      <DetailDialog
        receiptId={detailId}
        onClose={() => setDetailId(null)}
        fetchDetail={api.fetchDetail}
        onVoid={(id) => setVoidId(id)}
      />

      {/* Void Dialog */}
      <Dialog open={!!voidId} onOpenChange={(v) => { if (!v) { setVoidId(null); setVoidReason(""); } }}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2 text-red-600">
              <Ban className="h-5 w-5" /> Void Bank Receipt
            </DialogTitle>
          </DialogHeader>
          <div className="space-y-3 py-2">
            <p className="text-sm text-slate-600">
              Void akan membuat jurnal pembalik otomatis. Tindakan ini tidak dapat dibatalkan.
            </p>
            <div>
              <Label className="text-sm">Alasan Void <span className="text-red-500">*</span></Label>
              <Input className="mt-1" placeholder="Masukkan alasan pembatalan..."
                value={voidReason} onChange={(e) => setVoidReason(e.target.value)} />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => { setVoidId(null); setVoidReason(""); }}>Batal</Button>
            <Button variant="destructive" disabled={!voidReason.trim() || voiding} onClick={handleVoid}>
              {voiding ? <><Loader2 className="h-4 w-4 mr-2 animate-spin" />Memproses...</> : "Konfirmasi Void"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </AppShell>
  );
}
