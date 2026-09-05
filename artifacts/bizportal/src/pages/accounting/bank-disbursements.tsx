/**
 * Bank Disbursements Page
 *
 * Halaman untuk mencatat pengeluaran uang dari rekening bank perusahaan.
 * Setiap disbursement terdiri dari:
 *   - Header: tanggal, jurnal bank, referensi, memo
 *   - Multi-line items: jenis transaksi + akun tujuan + jumlah
 *
 * Jurnal otomatis:
 *   DR [akun per item]  xxx
 *   CR Bank             total
 *
 * Jenis transaksi:
 *   expense          → Beban (masuk P&L)
 *   supplier_payment → Bayar Hutang Supplier
 *   tax_payment      → Bayar Pajak
 *   employee_advance → Kasbon Karyawan
 *   fund_transfer    → Transfer Dana
 *   other            → Lain-lain
 */

import React, { useState, useEffect, useCallback, useMemo, useRef } from "react";
import { AIReviewSourcePanel } from "@/components/ai-review";
import { useLocation } from "wouter";
import { DatePicker } from "@/components/ui/date-picker";
import { AppShell } from "@/components/layout/AppShell";
import { AccountCombobox } from "@/components/accounting/AccountCombobox";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
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
import {
  Plus, Trash2, ArrowUpRight, Ban, ChevronRight, Loader2, Eye, X, FileText,
  TrendingDown, TrendingUp, Wallet, Building2, Clock, AlertCircle, ArrowRight, RefreshCw,
  CheckCircle2, ReceiptText, FileCheck, Send, PiggyBank, CalendarClock,
  AlertTriangle, ChevronDown, LayoutDashboard, ScanText, CheckCheck, Upload, Paperclip,
  ChevronsUpDown, User, Check, ArrowLeft,
} from "lucide-react";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Command, CommandEmpty, CommandInput, CommandItem, CommandList } from "@/components/ui/command";
import { cn } from "@/lib/utils";
import { Link } from "wouter";
import { useCreateSupplier } from "@workspace/api-client-react";

// ─────────────────────────────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────────────────────────────

interface Disbursement {
  id: number;
  disbursementNumber: string | null;
  journalId: number;
  date: string;
  ref: string | null;
  memo: string | null;
  totalAmount: number;
  status: string;
  entryId: number | null;
  createdAt: string;
  attachmentUrl?: string | null;
  counterpartyName?: string | null;
  counterpartyType?: string | null;
  counterpartyId?: number | null;
  sourceModule?: string | null;
  expenseId?: number | null;
  sourceNumber?: string | null;
}

interface DisbursementItem {
  id?: number;
  seq: number;
  transactionType: string;
  accountId: number | null;
  description: string;
  amount: number | string;
  notes: string;
  partyName?: string;
  ppnAmount?: number;
  ppnAccountId?: number | null;
}

interface CoacAccount {
  id: number;
  code: string;
  name: string;
  type: string;
}

interface Journal {
  id: number;
  code: string;
  name: string;
  type: string;
}

// ─────────────────────────────────────────────────────────────────────────────
// Constants
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Jenis transaksi Bank Disbursement — hanya label/kategori untuk pelaporan.
 * P&L TIDAK ditentukan oleh jenis transaksi, melainkan oleh tipe akun di COA:
 *   • Akun tipe "expense" atau "revenue" → masuk Laba Rugi
 *   • Akun tipe "asset", "liability", "equity" → Neraca (tidak masuk L/R)
 */
const TRANSACTION_TYPES = [
  {
    value: "expense",
    label: "Beban / Expense",
    desc:  "Pengeluaran biaya operasional, sewa, gaji, utilitas, dll.",
    examples: "DR Beban Sewa / DR Beban Gaji",
  },
  {
    value: "supplier_payment",
    label: "Pembayaran Supplier",
    desc:  "Bayar hutang supplier (DR Hutang Usaha) atau langsung ke akun beban.",
    examples: "DR Hutang Usaha — atau — DR Beban Pembelian",
  },
  {
    value: "tax_payment",
    label: "Pembayaran Pajak",
    desc:  "Pilih akun sesuai jenis: Beban Pajak (→ L/R) atau Hutang PPh/PPN (→ Neraca).",
    examples: "DR Beban Pajak — atau — DR Hutang PPh 21",
  },
  {
    value: "employee_advance",
    label: "Kasbon Karyawan",
    desc:  "Uang muka sebelum pertanggungjawaban. DR Piutang Karyawan (Neraca).",
    examples: "DR Piutang Karyawan / Uang Muka Karyawan",
  },
  {
    value: "fund_transfer",
    label: "Transfer Dana",
    desc:  "Pindah dana antar rekening kas/bank. Akun tujuan HARUS rekening Kas atau Bank.",
    examples: "DR Bank BCA — CR Bank Mandiri (pilih akun Kas/Bank saja)",
  },
  {
    value: "loan_payment",
    label: "Cicilan Pinjaman",
    desc:  "Bayar angsuran pinjaman bank, leasing, atau utang lainnya. DR Utang Pinjaman.",
    examples: "DR Utang Bank / Utang Leasing",
  },
  {
    value: "equity_withdrawal",
    label: "Penarikan Modal",
    desc:  "Penarikan dana pemilik atau pembayaran dividen. DR Modal / Saldo Laba.",
    examples: "DR Modal Pemilik / Saldo Laba",
  },
  {
    value: "other",
    label: "Lain-lain",
    desc:  "Jenis transaksi lainnya. Dampak L/R sepenuhnya mengikuti akun yang dipilih.",
    examples: "Pilih akun bebas",
  },
];

/**
 * Metadata tipe akun COA — menentukan apakah akun masuk ke Laba Rugi.
 * Ini adalah sumber kebenaran untuk P&L impact, bukan transaction_type.
 */
const ACCOUNT_TYPE_META: Record<string, { label: string; plImpact: boolean; badgeClass: string }> = {
  expense:   { label: "Beban",      plImpact: true,  badgeClass: "bg-orange-100 text-orange-700 border-orange-200" },
  revenue:   { label: "Pendapatan", plImpact: true,  badgeClass: "bg-green-100 text-green-700 border-green-200" },
  asset:     { label: "Aset",       plImpact: false, badgeClass: "bg-blue-100 text-blue-700 border-blue-200" },
  liability: { label: "Utang",      plImpact: false, badgeClass: "bg-purple-100 text-purple-700 border-purple-200" },
  equity:    { label: "Ekuitas",    plImpact: false, badgeClass: "bg-slate-100 text-slate-600 border-slate-200" },
};

function getAccountMeta(accountType: string | undefined) {
  return accountType ? (ACCOUNT_TYPE_META[accountType] ?? null) : null;
}

function PLImpactBadge({ accountType, size = "sm" }: { accountType?: string; size?: "sm" | "xs" }) {
  const meta = getAccountMeta(accountType);
  if (!meta) return null;
  const sz = size === "xs" ? "text-[10px] px-1 py-0" : "text-xs px-1.5 py-0.5";
  return (
    <span className={`inline-flex items-center rounded border font-medium ${sz} ${meta.badgeClass}`}>
      {meta.label}
      {meta.plImpact && <span className="ml-1 opacity-70">· L/R</span>}
    </span>
  );
}

const fmt = (n: number) =>
  new Intl.NumberFormat("id-ID", { minimumFractionDigits: 0, maximumFractionDigits: 0 }).format(n);

// ─────────────────────────────────────────────────────────────────────────────
// Vendor invoice types
// ─────────────────────────────────────────────────────────────────────────────

interface OutstandingInvoice {
  id: number;
  docNumber: string;
  billNumber: string | null;
  supplierId: number | null;
  supplierName: string;
  grandTotal: number;
  amountPaid: number;
  outstanding: number;
  withholdingTaxAmount: number;
  payableToSupplier: number;
  dueDate: string | null;
  currency: string;
  source: "purchase_document" | "vendor_invoice";
  withholdingLines?: Array<{
    lineTaxId: number;
    invoiceLineId: number;
    taxType: string;
    taxObject: string;
    taxAmount: number;
    liabilityAccountId: number | null;
    status: string;
  }>;
}

interface OutstandingInvoicesResponse {
  apAccountId: number | null;
  apAccountName: string | null;
  invoices: OutstandingInvoice[];
  suppliers?: { id: number; name: string }[];
}

interface InvoicePaymentLine {
  purchaseDocumentId: number | null;
  vendorInvoiceId: number | null;
  lineKey: string;
  docNumber: string;
  supplierName: string;
  outstanding: number;
  paymentAmount: number;
  whtAmount: number;
  whtAccountId: number | null;
  taxTreatment: "bayar_berikut" | "setor_sendiri";
  taxType: string;
  dpp: number;
  taxAmount: number;
  expenseAccountId: number | null;
  withholdingAllocations?: Array<{ lineTaxId: number; invoiceLineId: number; amount: number; liabilityAccountId: number }>;
}

// ─────────────────────────────────────────────────────────────────────────────
// Treasury Dashboard types
// ─────────────────────────────────────────────────────────────────────────────

interface TreasurySummaryData {
  bankBalance: number;
  spendingToday: number;
  spendingWeek: number;
  spendingMonth: number;
}

interface TreasuryOutstanding {
  vendorInvoiceCount: number;
  vendorInvoiceTotal: number;
  overdueCount: number;
  overdueTotal: number;
  kasbonCount: number;
  kasbonTotal: number;
  approvalPendingCount: number;
}

interface TreasuryQueueItem {
  type: "invoice_overdue" | "invoice_today" | "kasbon_overdue";
  id: number;
  label: string;
  sublabel: string;
  amount: number;
  dueDate: string | null;
  priority: number;
  actionMode?: string;
  actionIds?: number[];
  employeeName?: string | null;
}

interface TreasurySummaryResponse {
  summary: TreasurySummaryData;
  outstanding: TreasuryOutstanding;
  queue: TreasuryQueueItem[];
  recentActivity: Disbursement[];
}

// ─────────────────────────────────────────────────────────────────────────────
// Hooks
// ─────────────────────────────────────────────────────────────────────────────

function useApi(companyId: number | null | undefined) {
  const headers = useCallback(() => ({ "Content-Type": "application/json", "x-company-id": String(companyId ?? "") }), [companyId]);
  const base = "/api";
  const cq = companyId ? `company=${companyId}` : "";

  const fetchDisbs = useCallback(async (supplierId?: number | null): Promise<Disbursement[]> => {
    const params = new URLSearchParams({ limit: "100" });
    if (supplierId) params.set("supplierId", String(supplierId));
    if (companyId)  params.set("company",    String(companyId));
    const r = await fetch(`${base}/accounting/bank-disbursements?${params}`, {
      credentials: "include", headers: headers(),
    });
    if (!r.ok) throw new Error(await r.text());
    const data = await r.json();
    return Array.isArray(data) ? data : (data.data ?? []);
  }, [companyId, headers]);

  const fetchVendors = useCallback(async (): Promise<{ id: number; name: string }[]> => {
    const qs = cq ? `?${cq}` : "";
    const r = await fetch(`${base}/accounting/bank-disbursements/vendors${qs}`, {
      credentials: "include", headers: headers(),
    });
    if (!r.ok) return [];
    return r.json();
  }, [cq, headers]);

  const fetchDetail = useCallback(async (id: number) => {
    const qs = cq ? `?${cq}` : "";
    const r = await fetch(`${base}/accounting/bank-disbursements/${id}${qs}`, {
      credentials: "include", headers: headers(),
    });
    if (!r.ok) throw new Error(await r.text());
    return r.json();
  }, [cq, headers]);

  const fetchJournals = useCallback(async (): Promise<Journal[]> => {
    const qs = cq ? `?${cq}` : "";
    const r = await fetch(`${base}/accounting/journals${qs}`, {
      credentials: "include", headers: headers(),
    });
    if (!r.ok) return [];
    const d = await r.json();
    const list: Journal[] = Array.isArray(d) ? d : (d.data ?? []);
    return list.filter((j) => j.type === "bank" || j.type === "cash");
  }, [cq, headers]);

  const fetchAccounts = useCallback(async (type?: string, subtype?: string, forTxType?: string): Promise<CoacAccount[]> => {
    const params = new URLSearchParams();
    if (companyId) params.set("company",  String(companyId));
    if (type)      params.set("type",     type);
    if (subtype)   params.set("subtype",  subtype);
    if (forTxType) params.set("for",      forTxType);
    const qs = params.toString() ? `?${params.toString()}` : "";
    const r = await fetch(`${base}/accounting/bank-disbursements/meta/accounts${qs}`, {
      credentials: "include", headers: headers(),
    });
    if (!r.ok) return [];
    const d = await r.json();
    return Array.isArray(d) ? d : [];
  }, [companyId, headers]);

  const createDisb = useCallback(async (body: object) => {
    const qs = companyId ? `?company=${companyId}` : "";
    const r = await fetch(`${base}/accounting/bank-disbursements${qs}`, {
      method: "POST",
      credentials: "include",
      headers: headers(),
      body: JSON.stringify(body),
    });
    const d = await r.json();
    if (!r.ok) throw new Error(d.message ?? "Gagal menyimpan");
    return d;
  }, [companyId, headers]);

  const voidDisb = useCallback(async (id: number, reason: string) => {
    const qs = companyId ? `?company=${companyId}` : "";
    const r = await fetch(`${base}/accounting/bank-disbursements/${id}/void${qs}`, {
      method: "POST",
      credentials: "include",
      headers: headers(),
      body: JSON.stringify({ reason }),
    });
    const d = await r.json();
    if (!r.ok) throw new Error(d.message ?? "Gagal void");
    return d;
  }, [companyId, headers]);

  const fetchOutstandingInvoices = useCallback(async (): Promise<OutstandingInvoicesResponse> => {
    const qs = cq ? `?${cq}` : "";
    const r = await fetch(`${base}/accounting/bank-disbursements/vendor-invoices/outstanding${qs}`, {
      credentials: "include", headers: headers(),
    });
    if (!r.ok) throw new Error(await r.text());
    return r.json();
  }, [cq, headers]);

  const fetchSummary = useCallback(async (): Promise<TreasurySummaryResponse> => {
    const qs = cq ? `?${cq}` : "";
    const r = await fetch(`${base}/accounting/bank-disbursements/summary${qs}`, {
      credentials: "include", headers: headers(),
    });
    if (!r.ok) throw new Error(await r.text());
    return r.json();
  }, [cq, headers]);

  return useMemo(() => ({ fetchDisbs, fetchDetail, fetchJournals, fetchAccounts, createDisb, voidDisb, fetchOutstandingInvoices, fetchSummary, fetchVendors }), [fetchDisbs, fetchDetail, fetchJournals, fetchAccounts, createDisb, voidDisb, fetchOutstandingInvoices, fetchSummary, fetchVendors]);
}

// ─────────────────────────────────────────────────────────────────────────────
// Sub-components
// ─────────────────────────────────────────────────────────────────────────────

function StatusBadge({ status }: { status: string }) {
  if (status === "posted")
    return <Badge className="bg-green-100 text-green-700 border-green-200">Diposting</Badge>;
  if (status === "voided")
    return <Badge className="bg-red-100 text-red-700 border-red-200">Dibatalkan</Badge>;
  return <Badge variant="outline">{status}</Badge>;
}

/**
 * JournalPreview — menampilkan jurnal compound yang akan dibuat.
 * P&L impact ditentukan dari tipe akun di COA (expense/revenue = masuk L/R).
 * allAccounts digunakan untuk lookup tipe akun setelah user memilih.
 */
function JournalPreview({
  items,
  allAccounts,
}: {
  items: DisbursementItem[];
  allAccounts: CoacAccount[];
}) {
  const validItems = items.filter((it) => it.accountId && Number(it.amount) > 0);
  if (validItems.length === 0) return null;

  const total = validItems.reduce((s, it) => s + Number(it.amount), 0);
  const hasPlImpact = validItems.some((it) => {
    const acct = allAccounts.find((a) => a.id === it.accountId);
    return acct && getAccountMeta(acct.type)?.plImpact;
  });

  return (
    <div className="rounded-lg border border-blue-100 bg-blue-50 p-3 mt-2">
      <div className="flex items-center justify-between mb-2">
        <p className="text-xs font-semibold text-blue-700">Preview Jurnal Otomatis</p>
        {hasPlImpact && (
          <span className="text-[10px] text-orange-600 bg-orange-50 border border-orange-200 rounded px-1.5 py-0.5">
            Sebagian / seluruh masuk Laba Rugi
          </span>
        )}
      </div>
      <div className="space-y-1 text-xs font-mono">
        {validItems.map((it, i) => {
          const acct = allAccounts.find((a) => a.id === it.accountId);
          const meta = getAccountMeta(acct?.type);
          const label = it.description || acct?.name
            || TRANSACTION_TYPES.find((t) => t.value === it.transactionType)?.label
            || "Akun";
          return (
            <div key={i} className="flex items-center justify-between gap-4">
              <div className="flex items-center gap-1.5 min-w-0">
                <span className={meta?.plImpact ? "text-orange-700 font-semibold" : "text-slate-700"}>
                  DR {label}
                </span>
                {acct && <PLImpactBadge accountType={acct.type} size="xs" />}
              </div>
              <span className="font-medium text-slate-800 shrink-0">{fmt(Number(it.amount))}</span>
            </div>
          );
        })}
        <div className="border-t border-blue-200 mt-1 pt-1 flex items-center justify-between gap-4">
          <div className="flex items-center gap-1.5 pl-4">
            <span className="text-slate-500">CR Bank / Kas</span>
            <PLImpactBadge accountType="asset" size="xs" />
          </div>
          <span className="font-semibold text-slate-800">{fmt(total)}</span>
        </div>
      </div>
      <p className="text-[10px] text-slate-400 mt-2">
        * Dampak Laba Rugi ditentukan oleh tipe akun di Chart of Accounts, bukan jenis transaksi.
      </p>
    </div>
  );
}

interface LineItemRowProps {
  item: DisbursementItem;
  idx: number;
  accounts: CoacAccount[];
  allAccounts: CoacAccount[];
  onChange: (idx: number, field: keyof DisbursementItem, value: string | number | null) => void;
  onRemove: (idx: number) => void;
  canRemove: boolean;
  hideTransactionType?: boolean;
}

/**
 * LineItemRow — satu baris item disbursement.
 *
 * `accounts` adalah daftar akun yang disarankan untuk jenis transaksi ini.
 * `allAccounts` adalah semua akun — ditampilkan jika user klik "Tampilkan semua".
 * `hideTransactionType` — sembunyikan dropdown jenis transaksi jika mode sudah menentukan tipe.
 * Dampak P&L ditampilkan berdasarkan tipe akun COA yang dipilih (bukan transaction_type):
 *   • expense / revenue  → badge oranye/hijau + label "· L/R"
 *   • asset / liability  → badge biru/ungu (Neraca)
 */
function LineItemRow({ item, idx, accounts, allAccounts, onChange, onRemove, canRemove, hideTransactionType }: LineItemRowProps) {
  const [showAll, setShowAll] = useState(false);
  const typeInfo = TRANSACTION_TYPES.find((t) => t.value === item.transactionType);
  const selectedAccount = allAccounts.find((a) => a.id === item.accountId);
  const selectedMeta = getAccountMeta(selectedAccount?.type);
  const displayAccounts = showAll ? allAccounts : (accounts.length > 0 ? accounts : allAccounts);
  const isFiltered = !showAll && accounts.length > 0 && accounts.length < allAccounts.length;

  // ── Party name searchable combobox (per item) ────────────────────────────
  const [partyQ, setPartyQ] = useState("");
  const [partyResults, setPartyResults] = useState<{ id: string; name: string; source?: string }[]>([]);
  const [partyOpen, setPartyOpen] = useState(false);
  const [partySearching, setPartySearching] = useState(false);
  const partyRef = useRef<HTMLDivElement>(null);
  const [partySelected, setPartySelected] = useState(false);

  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (partyRef.current && !partyRef.current.contains(e.target as Node)) {
        setPartyOpen(false);
      }
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, []);

  useEffect(() => {
    if (!partyQ.trim() || partySelected) {
      setPartyResults([]);
      setPartyOpen(false);
      return;
    }
    setPartySearching(true);
    const timer = setTimeout(async () => {
      try {
        const r = await fetch(`/api/accounting/bank-disbursements/counterparty-search?q=${encodeURIComponent(partyQ)}`, {
          credentials: "include",
        });
        if (r.ok) {
          const data = await r.json() as { id: string; name: string; source?: string }[];
          setPartyResults(data);
          setPartyOpen(data.length > 0);
        }
      } catch { /* non-fatal */ }
      finally { setPartySearching(false); }
    }, 300);
    return () => clearTimeout(timer);
  }, [partyQ, partySelected]);

  return (
    <div className="space-y-2 p-3 rounded-lg border border-slate-200 bg-slate-50">
      {/* Row 1: seq + jenis + akun */}
      <div className="grid grid-cols-12 gap-2 items-start">
        {/* Seq */}
        <div className="col-span-1 flex items-center justify-center pt-5">
          <span className="text-xs text-slate-400 font-mono">{idx + 1}</span>
        </div>

        {/* Transaction Type — hidden when mode already determines it */}
        {!hideTransactionType && (
          <div className="col-span-4">
            <Label className="text-xs text-slate-500 mb-1 block">Jenis Transaksi</Label>
            <Select
              value={item.transactionType}
              onValueChange={(v) => onChange(idx, "transactionType", v)}
            >
              <SelectTrigger className="h-8 text-xs">
                <SelectValue />
              </SelectTrigger>
              <SelectContent className="max-w-xs">
                {TRANSACTION_TYPES.map((t) => (
                  <SelectItem key={t.value} value={t.value}>
                    <div className="py-0.5">
                      <div className="font-medium text-xs">{t.label}</div>
                      <div className="text-[10px] text-slate-400 leading-tight">{t.desc}</div>
                    </div>
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            {typeInfo && (
              <p className="text-[10px] text-slate-400 mt-0.5 leading-tight">{typeInfo.examples}</p>
            )}
          </div>
        )}

        {/* Account — shows filtered accounts by type; toggle to show all */}
        <div className={hideTransactionType ? "col-span-9" : "col-span-5"}>
          <div className="flex items-center justify-between gap-1 mb-1">
            <div className="flex items-center gap-1">
              <Label className="text-xs text-slate-500">Akun Debit (DR)</Label>
              {selectedAccount && <PLImpactBadge accountType={selectedAccount.type} size="xs" />}
            </div>
            {isFiltered && (
              <button
                type="button"
                className="text-[10px] text-blue-500 hover:underline"
                onClick={() => setShowAll(true)}
              >
                Tampilkan semua akun
              </button>
            )}
            {showAll && (
              <button
                type="button"
                className="text-[10px] text-slate-400 hover:underline"
                onClick={() => setShowAll(false)}
              >
                Filter akun
              </button>
            )}
          </div>
          <Select
            value={item.accountId ? String(item.accountId) : ""}
            onValueChange={(v) => onChange(idx, "accountId", v ? Number(v) : null)}
          >
            <SelectTrigger className="h-8 text-xs">
              <SelectValue placeholder="Pilih akun dari CoA..." />
            </SelectTrigger>
            <SelectContent>
              {displayAccounts.map((a) => {
                const meta = getAccountMeta(a.type);
                return (
                  <SelectItem key={a.id} value={String(a.id)}>
                    <div className="flex items-center gap-2">
                      <span className="font-mono text-[10px] text-slate-400 shrink-0">{a.code}</span>
                      <span className="text-xs">{a.name}</span>
                      {meta && (
                        <span className={`text-[9px] px-1 rounded border shrink-0 ${meta.badgeClass}`}>
                          {meta.label}{meta.plImpact ? " · L/R" : ""}
                        </span>
                      )}
                    </div>
                  </SelectItem>
                );
              })}
            </SelectContent>
          </Select>
          {/* P&L indicator setelah akun dipilih */}
          {selectedMeta && (
            <p className={`text-[10px] mt-0.5 font-medium ${selectedMeta.plImpact ? "text-orange-600" : "text-blue-600"}`}>
              {selectedMeta.plImpact
                ? "⚠ Akun ini masuk Laba Rugi"
                : "✓ Akun ini di Neraca (tidak masuk L/R)"}
            </p>
          )}
        </div>

        {/* Remove */}
        <div className="col-span-2 flex items-end justify-end pb-0.5">
          <Button
            variant="ghost"
            size="icon"
            className="h-8 w-8 text-red-400 hover:text-red-600"
            disabled={!canRemove}
            onClick={() => onRemove(idx)}
          >
            <Trash2 className="h-3.5 w-3.5" />
          </Button>
        </div>
      </div>

      {/* Row 2: description + amount */}
      <div className="grid grid-cols-12 gap-2 items-start pl-5">
        <div className="col-span-7">
          <Label className="text-xs text-slate-500 mb-1 block">Keterangan</Label>
          <Input
            className="h-8 text-xs"
            placeholder="Opsional — deskripsi singkat item ini..."
            value={item.description}
            onChange={(e) => onChange(idx, "description", e.target.value)}
          />
        </div>
        <div className="col-span-5">
          <Label className="text-xs text-slate-500 mb-1 block">Jumlah (Rp)</Label>
          <Input
            className="h-8 text-xs text-right font-mono"
            type="number"
            min="0"
            step="1000"
            placeholder="0"
            value={item.amount === 0 ? "" : item.amount}
            onChange={(e) => onChange(idx, "amount", e.target.value)}
          />
        </div>
      </div>

      {/* Row 3: PPN per item */}
      <div className="grid grid-cols-12 gap-2 items-start pl-5">
        <div className="col-span-5">
          <Label className="text-xs text-slate-500 mb-1 block">PPN Masukan (Rp) <span className="text-slate-400 font-normal">— opsional</span></Label>
          <Input
            className="h-8 text-xs text-right font-mono"
            type="number"
            min="0"
            step="1000"
            placeholder="0"
            value={(item.ppnAmount ?? 0) === 0 ? "" : item.ppnAmount}
            onChange={(e) => onChange(idx, "ppnAmount", e.target.value === "" ? 0 : Number(e.target.value))}
          />
        </div>
        {(item.ppnAmount ?? 0) > 0 && (
          <div className="col-span-7">
            <Label className="text-xs text-slate-500 mb-1 block">Akun PPN Masukan</Label>
            <Select
              value={item.ppnAccountId ? String(item.ppnAccountId) : ""}
              onValueChange={(v) => onChange(idx, "ppnAccountId", v ? Number(v) : null)}
            >
              <SelectTrigger className="h-8 text-xs">
                <SelectValue placeholder="Pilih akun PPN..." />
              </SelectTrigger>
              <SelectContent>
                {allAccounts.map((a) => (
                  <SelectItem key={a.id} value={String(a.id)}>
                    <span className="font-mono text-[10px] text-slate-400 mr-1">{a.code}</span>
                    {a.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        )}
      </div>

      {/* Row 4: partyName per item — searchable combobox */}
      <div className="pl-5" ref={partyRef}>
        <Label className="text-xs text-slate-500 mb-1 block">Nama Pihak (item ini)</Label>
        <div className="relative">
          <Input
            className="h-7 text-xs pr-6"
            placeholder="Ketik nama supplier/karyawan untuk cari..."
            value={item.partyName ?? partyQ}
            autoComplete="off"
            onChange={(e) => {
              const v = e.target.value;
              setPartyQ(v);
              setPartySelected(false);
              onChange(idx, "partyName", v);
              if (!v) { setPartyResults([]); setPartyOpen(false); }
            }}
            onFocus={() => { if (partyResults.length > 0) setPartyOpen(true); }}
          />
          {partySearching && (
            <Loader2 className="absolute right-1.5 top-1.5 h-3.5 w-3.5 animate-spin text-slate-400" />
          )}
          {item.partyName && !partySearching && (
            <button
              type="button"
              className="absolute right-1.5 top-1.5 text-slate-400 hover:text-slate-600"
              onClick={() => {
                onChange(idx, "partyName", "");
                setPartyQ("");
                setPartyResults([]);
                setPartyOpen(false);
                setPartySelected(false);
              }}
            >
              <X className="h-3.5 w-3.5" />
            </button>
          )}
          {partyOpen && partyResults.length > 0 && (
            <div className="absolute z-50 left-0 right-0 mt-0.5 bg-white border border-slate-200 rounded-lg shadow-lg max-h-44 overflow-y-auto">
              {partyResults.map((r) => (
                <button
                  key={`${r.source ?? "s"}-${r.id}`}
                  type="button"
                  className="w-full text-left px-2.5 py-1.5 text-xs hover:bg-orange-50 hover:text-orange-700 transition-colors flex items-center gap-2"
                  onMouseDown={(e) => {
                    e.preventDefault();
                    onChange(idx, "partyName", r.name);
                    setPartyQ("");
                    setPartyResults([]);
                    setPartyOpen(false);
                    setPartySelected(true);
                  }}
                >
                  <span className="text-[9px] text-slate-400 uppercase shrink-0 w-12 text-right font-mono">
                    {r.source === "employee" ? "karyawan" : r.source === "user" ? "user" : "supplier"}
                  </span>
                  <span className="truncate">{r.name}</span>
                </button>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// VendorInvoicePanel — shown when paymentMode = vendor_invoice
// SAP Tax Engine-style: breakdown, tax treatment, payment summary
// ─────────────────────────────────────────────────────────────────────────────

const PPN_RATE = 0.11;

const INVOICE_TAX_TYPES = [
  { value: "none",    label: "Tidak ada pajak" },
  { value: "ppn",     label: "PPN — Pajak Pertambahan Nilai" },
  { value: "pph21",   label: "PPh 21 — Penghasilan Karyawan" },
  { value: "pph22",   label: "PPh 22 — Impor / Pembelian" },
  { value: "pph23",   label: "PPh 23 — Jasa & Modal" },
  { value: "pphf",    label: "PPh Final" },
  { value: "lainnya", label: "Pajak Lainnya" },
];

function computeTaxBreakdown(outstanding: number, taxType: string): { dpp: number; taxAmount: number } {
  if (taxType === "none") return { dpp: outstanding, taxAmount: 0 };
  const dpp = Math.round(outstanding / (1 + PPN_RATE));
  const taxAmount = outstanding - dpp;
  return { dpp, taxAmount };
}

function getTaxLabel(taxType: string): string {
  const t = INVOICE_TAX_TYPES.find((x) => x.value === taxType);
  return t ? t.label.split(" — ")[0] : taxType.toUpperCase();
}

interface VendorInvoicePanelProps {
  allInvoices: OutstandingInvoice[];
  allSuppliers?: { id: number; name: string }[];
  apAccountName: string | null;
  lines: InvoicePaymentLine[];
  onLinesChange: (lines: InvoicePaymentLine[]) => void;
  whtAccounts: CoacAccount[];
  allAccounts: CoacAccount[];
  selectedVendorId?: string | null;
  onSelectedVendorIdChange?: (id: string | null) => void;
  onSupplierCreated?: (supplier: { id: number; name: string }) => void;
}

function VendorInvoicePanel({ allInvoices, allSuppliers, apAccountName, lines, onLinesChange, whtAccounts, allAccounts, selectedVendorId: selectedVendorIdProp, onSelectedVendorIdChange, onSupplierCreated }: VendorInvoicePanelProps) {
  const expenseAccounts = allAccounts.filter((a) => a.type === "expense" || a.type === "asset" || a.type === "liability");
  const [selectedVendorIdLocal, setSelectedVendorIdLocal] = useState<string | null>(null);
  const selectedVendorId = selectedVendorIdProp !== undefined ? selectedVendorIdProp : selectedVendorIdLocal;
  const setSelectedVendorId = (v: string | null) => {
    setSelectedVendorIdLocal(v);
    onSelectedVendorIdChange?.(v);
  };

  // Searchable vendor combobox state
  const [vendorComboOpen, setVendorComboOpen] = useState(false);
  const [vendorSearchQ, setVendorSearchQ] = useState("");
  const [addingVendor, setAddingVendor] = useState(false);
  const { toast } = useToast();

  const createSupplierMut = useCreateSupplier({
    mutation: {
      onSuccess: (data: any) => {
        const newSupplier = { id: data.id, name: data.name };
        onSupplierCreated?.(newSupplier);
        setSelectedVendorId(`id_${data.id}`);
        setVendorSearchQ("");
        setVendorComboOpen(false);
        setAddingVendor(false);
        toast({ title: `Vendor "${data.name}" berhasil ditambahkan` });
      },
      onError: (err: Error) => {
        setAddingVendor(false);
        toast({ title: "Gagal menambah vendor", description: err.message, variant: "destructive" });
      },
    },
  });

  const handleAddVendor = () => {
    const name = vendorSearchQ.trim();
    if (!name) return;
    setAddingVendor(true);
    createSupplierMut.mutate({ data: { name, isActive: true } as any });
  };

  // Build a name→supplier-id lookup so invoices with supplier_id=null can be matched
  // by name to a known supplier (avoids key mismatch: "id_X" vs "name_VendorName").
  const supplierIdByName = useMemo(() => {
    const map = new Map<string, number>();
    for (const s of (allSuppliers ?? [])) {
      map.set(s.name.trim().toLowerCase(), s.id);
    }
    return map;
  }, [allSuppliers]);

  // Resolve the canonical vendor key for an invoice.
  // Prefer supplier_id when present; fall back to name-lookup; finally use raw name.
  const resolveInvoiceKey = (inv: OutstandingInvoice): string => {
    if (inv.supplierId != null) return `id_${inv.supplierId}`;
    const resolvedId = supplierIdByName.get(inv.supplierName.trim().toLowerCase());
    if (resolvedId != null) return `id_${resolvedId}`;
    return `name_${inv.supplierName}`;
  };

  const vendors = useMemo(() => {
    const map = new Map<string, { id: number | null; name: string; key: string }>();
    for (const s of (allSuppliers ?? [])) {
      const key = `id_${s.id}`;
      if (!map.has(key)) map.set(key, { id: s.id, name: s.name, key });
    }
    for (const inv of allInvoices) {
      const key = resolveInvoiceKey(inv);
      if (!map.has(key)) map.set(key, { id: inv.supplierId, name: inv.supplierName, key });
    }
    return Array.from(map.values()).sort((a, b) => a.name.localeCompare(b.name));
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [allInvoices, allSuppliers, supplierIdByName]);

  const vendorInvoices = useMemo(() => {
    if (!selectedVendorId) return [];
    return allInvoices.filter((inv) => resolveInvoiceKey(inv) === selectedVendorId);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [allInvoices, selectedVendorId, supplierIdByName]);

  const makeLineKey = (inv: OutstandingInvoice) => `${inv.source}:${inv.id}`;
  const isChecked = (inv: OutstandingInvoice) => lines.some((l) => l.lineKey === makeLineKey(inv));

  const toggleInvoice = (inv: OutstandingInvoice) => {
    const key = makeLineKey(inv);
    if (isChecked(inv)) {
      onLinesChange(lines.filter((l) => l.lineKey !== key));
    } else {
      const baseBreakdown = computeTaxBreakdown(inv.outstanding, "ppn");
      const storedWhtAmount = inv.source === "vendor_invoice"
        ? Math.min(inv.withholdingTaxAmount, Math.max(0, inv.outstanding - 1))
        : 0;
      const withholdingLines = inv.withholdingLines ?? [];
      const withholdingAmount = withholdingLines.reduce((sum, line) => sum + line.taxAmount, 0);
      const whtAmount = withholdingLines.length > 0 ? withholdingAmount : storedWhtAmount;
      const dpp = withholdingLines.length > 0
        ? Math.max(0, inv.outstanding - withholdingAmount)
        : baseBreakdown.dpp;
      const taxAmount = withholdingLines.length > 0 ? withholdingAmount : baseBreakdown.taxAmount;
      onLinesChange([...lines, {
        purchaseDocumentId: inv.source === "purchase_document" ? inv.id : null,
        vendorInvoiceId: inv.source === "vendor_invoice" ? inv.id : null,
        lineKey: key,
        docNumber: inv.billNumber ?? inv.docNumber,
        supplierName: inv.supplierName,
        outstanding: inv.outstanding,
        paymentAmount: inv.outstanding - whtAmount,
        whtAmount,
        whtAccountId: withholdingLines.length === 1 ? withholdingLines[0]!.liabilityAccountId : null,
        withholdingAllocations: withholdingLines.map((line) => ({
          lineTaxId: line.lineTaxId,
          invoiceLineId: line.invoiceLineId,
          amount: line.taxAmount,
          liabilityAccountId: line.liabilityAccountId ?? 0,
        })),
        taxTreatment: whtAmount > 0 ? "setor_sendiri" : "bayar_berikut",
        taxType: withholdingLines.map((line) => line.taxType).join(", ") || "ppn",
        dpp,
        taxAmount,
        expenseAccountId: null,
      }]);
    }
  };

  const updateLineTaxTreatment = (key: string, treatment: "bayar_berikut" | "setor_sendiri") => {
    onLinesChange(lines.map((l) => {
      if (l.lineKey !== key) return l;
      const whtAmount = treatment === "setor_sendiri" ? l.taxAmount : 0;
      const paymentAmount = treatment === "setor_sendiri" ? l.dpp : l.outstanding;
      return { ...l, taxTreatment: treatment, whtAmount, paymentAmount };
    }));
  };

  const updateLineTaxType = (key: string, taxType: string) => {
    onLinesChange(lines.map((l) => {
      if (l.lineKey !== key) return l;
      const { dpp, taxAmount } = computeTaxBreakdown(l.outstanding, taxType);
      const whtAmount = l.taxTreatment === "setor_sendiri" ? taxAmount : 0;
      const paymentAmount = l.taxTreatment === "setor_sendiri" ? dpp : l.outstanding;
      return { ...l, taxType, dpp, taxAmount, whtAmount, paymentAmount };
    }));
  };

  const updateLine = (key: string, field: string, value: unknown) => {
    onLinesChange(lines.map((l) => l.lineKey !== key ? l : { ...l, [field]: value }));
  };

  const displayInvoices = selectedVendorId ? vendorInvoices : allInvoices;

  return (
    <div className="space-y-3" style={{ color: "#E2E8F0" }}>
      {/* AP Account banner */}
      {apAccountName && (
        <div className="flex items-center gap-2 px-3 py-2 rounded-xl text-xs" style={{ background: "rgba(59,130,246,0.12)", border: "1px solid rgba(59,130,246,0.25)" }}>
          <span style={{ color: "#93C5FD" }} className="font-medium">Akun AP (DR):</span>
          <span style={{ color: "#BFDBFE" }} className="font-mono">{apAccountName}</span>
        </div>
      )}
      {!apAccountName && (
        <div className="px-3 py-2 rounded-xl text-xs" style={{ background: "rgba(245,158,11,0.12)", border: "1px solid rgba(245,158,11,0.25)", color: "#FCD34D" }}>
          ⚠ Akun AP belum dikonfigurasi di Accounting Settings.
        </div>
      )}

      {/* Vendor filter — searchable combobox with inline add */}
      <div>
        <Label className="text-xs font-semibold mb-1.5 block" style={{ color: "#94A3B8" }}>Filter Vendor</Label>
        <Popover open={vendorComboOpen} onOpenChange={setVendorComboOpen}>
          <PopoverTrigger asChild>
            <button
              type="button"
              className="w-full flex items-center justify-between h-9 rounded-md px-3 text-sm text-left transition-colors"
              style={{ background: "#273449", border: "1px solid rgba(255,255,255,0.1)", color: "#E2E8F0" }}
            >
              <span className={selectedVendorId ? "" : "opacity-50"}>
                {selectedVendorId
                  ? (vendors.find((v) => v.key === selectedVendorId)?.name ?? "Semua Vendor")
                  : "— Semua Vendor —"}
              </span>
              <ChevronsUpDown className="h-4 w-4 opacity-50 shrink-0" />
            </button>
          </PopoverTrigger>
          <PopoverContent
            className="p-0 w-[var(--radix-popover-trigger-width)]"
            style={{ background: "#1E293B", border: "1px solid rgba(255,255,255,0.12)" }}
            align="start"
          >
            <Command style={{ background: "transparent" }}>
              <CommandInput
                placeholder="Cari atau ketik nama vendor..."
                value={vendorSearchQ}
                onValueChange={setVendorSearchQ}
                className="text-sm"
                style={{ color: "#E2E8F0", borderBottom: "1px solid rgba(255,255,255,0.08)" }}
              />
              <CommandList style={{ maxHeight: 240 }}>
                {/* All vendors option */}
                <CommandItem
                  value="__all__"
                  onSelect={() => { setSelectedVendorId(null); setVendorSearchQ(""); setVendorComboOpen(false); }}
                  className="text-sm"
                  style={{ color: "#94A3B8" }}
                >
                  <Check className={cn("mr-2 h-4 w-4", selectedVendorId == null ? "opacity-100" : "opacity-0")} />
                  — Semua Vendor —
                </CommandItem>

                {/* Vendor list filtered by search */}
                {vendors
                  .filter((v) => !vendorSearchQ || v.name.toLowerCase().includes(vendorSearchQ.toLowerCase()))
                  .map((v) => (
                    <CommandItem
                      key={v.key}
                      value={v.key}
                      onSelect={() => { setSelectedVendorId(v.key); setVendorSearchQ(""); setVendorComboOpen(false); }}
                      className="text-sm"
                      style={{ color: "#E2E8F0" }}
                    >
                      <Check className={cn("mr-2 h-4 w-4", selectedVendorId === v.key ? "opacity-100" : "opacity-0")} />
                      {v.name}
                    </CommandItem>
                  ))}

                {/* No match — show inline add option */}
                {vendorSearchQ.trim() &&
                  !vendors.some((v) => v.name.toLowerCase() === vendorSearchQ.trim().toLowerCase()) && (
                  <CommandEmpty className="p-0">
                    <button
                      type="button"
                      disabled={addingVendor}
                      onClick={handleAddVendor}
                      className="w-full flex items-center gap-2 px-3 py-2.5 text-sm text-left transition-colors hover:bg-white/5 disabled:opacity-60"
                      style={{ color: "#86EFAC" }}
                    >
                      {addingVendor
                        ? <><Loader2 className="h-4 w-4 animate-spin" />Menambahkan...</>
                        : <><Plus className="h-4 w-4" />Tambah vendor "<strong>{vendorSearchQ.trim()}</strong>"</>}
                    </button>
                  </CommandEmpty>
                )}
              </CommandList>
            </Command>
          </PopoverContent>
        </Popover>
      </div>

      {/* Info banner */}
      <div className="flex flex-col gap-2 rounded-xl px-3 py-2 text-xs" style={{ background: "rgba(59,130,246,0.08)", border: "1px solid rgba(59,130,246,0.2)", color: "#93C5FD" }}>
        <div className="flex items-start gap-2">
          <span className="shrink-0 mt-0.5">ℹ️</span>
          <span>
            Hanya invoice vendor yang sudah <strong style={{ color: "#BFDBFE" }}>diposting</strong> yang muncul di sini.
            {" "}Belum ada invoice? Buat dulu via <strong style={{ color: "#BFDBFE" }}>Vendor Invoice → Import via AI</strong>, lalu klik tombol <strong style={{ color: "#BFDBFE" }}>"Post"</strong> di daftar invoice.
          </span>
        </div>
        <a
          href="/bizportal/purchase/vendor-invoices/import"
          target="_blank"
          rel="noopener noreferrer"
          className="inline-flex items-center gap-1 self-start px-2 py-1 rounded-lg text-xs font-semibold"
          style={{ background: "rgba(99,102,241,0.18)", color: "#A5B4FC", border: "1px solid rgba(99,102,241,0.35)", textDecoration: "none" }}
        >
          + Import Vendor Invoice via AI →
        </a>
      </div>

      {displayInvoices.length === 0 && (
        <p className="text-sm text-center py-6" style={{ color: "#64748B" }}>Tidak ada invoice outstanding{selectedVendorId ? " untuk vendor ini" : ""}.</p>
      )}

      {/* Invoice list */}
      <div className="space-y-2">
        {displayInvoices.map((inv) => {
          const key = makeLineKey(inv);
          const checked = isChecked(inv);
          const line = lines.find((l) => l.lineKey === key);
          const isOverdue = inv.dueDate && new Date(inv.dueDate + "T00:00:00") < new Date();

          const dpp = line?.dpp ?? 0;
          const taxAmount = line?.taxAmount ?? 0;
          const supplierDibayar = line?.paymentAmount ?? inv.outstanding;
          const pajakDipotong = line?.whtAmount ?? 0;
          const isBalanced = Math.abs((supplierDibayar + pajakDipotong) - inv.outstanding) <= 1;

          return (
            <div
              key={key}
              style={{
                background: checked ? "rgba(249,115,22,0.08)" : "#1E293B",
                border: checked ? "1px solid rgba(249,115,22,0.4)" : "1px solid rgba(255,255,255,0.08)",
                borderRadius: "12px",
                transition: "border-color 0.15s",
              }}
            >
              {/* Invoice header row — click to toggle */}
              <div
                className="flex items-center gap-3 p-3 cursor-pointer"
                onClick={() => toggleInvoice(inv)}
              >
                <input
                  type="checkbox"
                  checked={checked}
                  onChange={() => toggleInvoice(inv)}
                  onClick={(e) => e.stopPropagation()}
                  className="h-4 w-4 accent-orange-500 shrink-0"
                />
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="font-mono text-xs font-bold" style={{ color: "#F1F5F9" }}>
                      {inv.billNumber ?? inv.docNumber}
                    </span>
                    <span className="text-xs" style={{ color: "#94A3B8" }}>{inv.supplierName}</span>
                    {inv.source === "vendor_invoice" && (
                      <span className="text-[10px] rounded px-1.5 py-0.5 font-medium" style={{ background: "rgba(59,130,246,0.15)", color: "#93C5FD", border: "1px solid rgba(59,130,246,0.3)" }}>Vendor Invoice</span>
                    )}
                    {isOverdue && <span className="text-[10px] rounded px-1.5 py-0.5 font-medium" style={{ background: "rgba(239,68,68,0.15)", color: "#FCA5A5", border: "1px solid rgba(239,68,68,0.3)" }}>Lewat Jatuh Tempo</span>}
                  </div>
                  <div className="flex items-center gap-3 mt-1 text-[11px]" style={{ color: "#64748B" }}>
                    {inv.dueDate && <span>Jatuh Tempo: {new Date(inv.dueDate + "T00:00:00").toLocaleDateString("id-ID", { day: "2-digit", month: "short", year: "numeric" })}</span>}
                    <span>Sisa: <strong style={{ color: "#F59E0B" }}>Rp {fmt(inv.outstanding)}</strong></span>
                    <span>Total: Rp {fmt(inv.grandTotal)}</span>
                    {inv.source === "vendor_invoice" && inv.withholdingTaxAmount > 0 && (
                      <span>PPh: <strong style={{ color: "#FCA5A5" }}>Rp {fmt(inv.withholdingTaxAmount)}</strong></span>
                    )}
                  </div>
                </div>
              </div>

              {/* SAP Tax Engine Panel — only when checked */}
              {checked && line && (
                <div
                  className="space-y-3 px-3 pb-3"
                  style={{ borderTop: "1px solid rgba(249,115,22,0.2)" }}
                  onClick={(e) => e.stopPropagation()}
                >
                  <div className="pt-3 space-y-3">

                    {/* ── 1. Invoice Breakdown ── */}
                    <div>
                      <p className="text-xs font-bold uppercase tracking-widest mb-2" style={{ color: "#94A3B8", letterSpacing: "0.08em" }}>Invoice Breakdown</p>
                      <div className="rounded-xl overflow-hidden text-xs font-mono" style={{ background: "#273449", border: "1px solid rgba(255,255,255,0.08)" }}>
                        <div className="flex justify-between items-center px-4 py-2.5" style={{ borderBottom: "1px solid rgba(255,255,255,0.06)" }}>
                          <span style={{ color: "#94A3B8" }}>DPP / Subtotal</span>
                          <span style={{ color: "#CBD5E1" }}>Rp {fmt(dpp)}</span>
                        </div>
                        <div className="flex justify-between items-center px-4 py-2.5" style={{ borderBottom: "1px solid rgba(255,255,255,0.06)" }}>
                          <span style={{ color: "#94A3B8" }}>{getTaxLabel(line.taxType)}{line.taxType === "ppn" ? " 11%" : ""}</span>
                          <span style={{ color: "#CBD5E1" }}>Rp {fmt(taxAmount)}</span>
                        </div>
                        <div className="flex justify-between items-center px-4 py-3" style={{ background: "rgba(245,158,11,0.08)" }}>
                          <span className="font-bold" style={{ color: "#E2E8F0" }}>Grand Total</span>
                          <span className="font-bold text-sm" style={{ color: "#F59E0B" }}>Rp {fmt(inv.outstanding)}</span>
                        </div>
                      </div>
                    </div>

                    {/* ── 2. Perlakuan Pajak ── */}
                    <div>
                      <p className="text-xs font-bold uppercase tracking-widest mb-2" style={{ color: "#94A3B8", letterSpacing: "0.08em" }}>Perlakuan Pajak</p>
                      <div className="rounded-xl px-4 py-3 flex gap-6" style={{ background: "#273449", border: "1px solid rgba(255,255,255,0.08)" }}>
                        <label className="flex items-center gap-2.5 cursor-pointer group">
                          <input
                            type="radio"
                            name={`tax-treatment-${key}`}
                            value="bayar_berikut"
                            checked={line.taxTreatment === "bayar_berikut"}
                            onChange={() => updateLineTaxTreatment(key, "bayar_berikut")}
                            className="h-4 w-4 accent-orange-500"
                          />
                          <span className="text-sm font-medium" style={{ color: line.taxTreatment === "bayar_berikut" ? "#F1F5F9" : "#94A3B8" }}>
                            Bayar berikut pajak
                          </span>
                        </label>
                        <label className="flex items-center gap-2.5 cursor-pointer group">
                          <input
                            type="radio"
                            name={`tax-treatment-${key}`}
                            value="setor_sendiri"
                            checked={line.taxTreatment === "setor_sendiri"}
                            onChange={() => updateLineTaxTreatment(key, "setor_sendiri")}
                            className="h-4 w-4 accent-orange-500"
                          />
                          <span className="text-sm font-medium" style={{ color: line.taxTreatment === "setor_sendiri" ? "#F1F5F9" : "#94A3B8" }}>
                            Pajak disetor sendiri
                          </span>
                        </label>
                      </div>
                      {line.taxTreatment === "setor_sendiri" && (
                        <div className="mt-2 flex items-center gap-2 rounded-lg px-3 py-2 text-xs" style={{ background: "rgba(245,158,11,0.08)", border: "1px solid rgba(245,158,11,0.2)", color: "#FCD34D" }}>
                          <AlertTriangle className="h-3.5 w-3.5 shrink-0" style={{ color: "#F59E0B" }} />
                          <span>Supplier hanya menerima DPP. PPN dicatat sebagai kewajiban pajak perusahaan.</span>
                        </div>
                      )}
                    </div>

                    {/* ── 3. Jenis Pajak ── */}
                    <div>
                      <p className="text-xs font-bold uppercase tracking-widest mb-2" style={{ color: "#94A3B8", letterSpacing: "0.08em" }}>Jenis Pajak</p>
                      <Select value={line.taxType} onValueChange={(v) => updateLineTaxType(key, v)}>
                        <SelectTrigger className="h-9 text-sm" style={{ background: "#273449", border: "1px solid rgba(255,255,255,0.1)", color: "#E2E8F0" }}>
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent style={{ background: "#1E293B", border: "1px solid rgba(255,255,255,0.1)" }}>
                          {INVOICE_TAX_TYPES.map((t) => (
                            <SelectItem key={t.value} value={t.value}>{t.label}</SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>

                    {/* ── 4. Ringkasan Pembayaran (SAP-style) ── */}
                    <div>
                      <p className="text-xs font-bold uppercase tracking-widest mb-2" style={{ color: "#94A3B8", letterSpacing: "0.08em" }}>Ringkasan Pembayaran</p>
                      <div className="rounded-xl overflow-hidden" style={{ background: "#273449", border: "1px solid rgba(255,255,255,0.08)" }}>
                        {/* Breakdown rows */}
                        <div className="px-4 py-2.5 text-xs font-mono" style={{ borderBottom: "1px solid rgba(255,255,255,0.06)" }}>
                          <div className="flex justify-between items-center py-1">
                            <span style={{ color: "#64748B" }}>Subtotal / DPP</span>
                            <span style={{ color: "#94A3B8" }}>Rp {fmt(dpp)}</span>
                          </div>
                          <div className="flex justify-between items-center py-1">
                            <span style={{ color: "#64748B" }}>{getTaxLabel(line.taxType)}</span>
                            <span style={{ color: "#94A3B8" }}>Rp {fmt(taxAmount)}</span>
                          </div>
                          <div className="flex justify-between items-center py-1 mt-0.5" style={{ borderTop: "1px solid rgba(255,255,255,0.06)" }}>
                            <span className="font-semibold" style={{ color: "#CBD5E1" }}>Grand Total</span>
                            <span className="font-bold" style={{ color: "#F59E0B" }}>Rp {fmt(inv.outstanding)}</span>
                          </div>
                        </div>
                        {/* Payment result rows */}
                        <div className="px-4 py-3 text-xs font-mono space-y-2">
                          <div className="flex justify-between items-center">
                            <span style={{ color: "#94A3B8" }}>Pajak Dipotong</span>
                            <span className="font-semibold" style={{ color: pajakDipotong > 0 ? "#F59E0B" : "#475569" }}>
                              Rp {fmt(pajakDipotong)}
                            </span>
                          </div>
                          <div className="flex justify-between items-center pt-1.5" style={{ borderTop: "1px solid rgba(255,255,255,0.06)" }}>
                            <span className="font-bold text-sm" style={{ color: "#F1F5F9" }}>Supplier Dibayar</span>
                            <span className="font-bold text-sm" style={{ color: "#F59E0B" }}>Rp {fmt(supplierDibayar)}</span>
                          </div>
                        </div>
                        {/* Balance indicator */}
                        <div
                          className="px-4 py-2.5 flex items-center gap-2 text-xs font-medium"
                          style={isBalanced
                            ? { background: "rgba(34,197,94,0.1)", borderTop: "1px solid rgba(34,197,94,0.2)", color: "#86EFAC" }
                            : { background: "rgba(239,68,68,0.1)", borderTop: "1px solid rgba(239,68,68,0.2)", color: "#FCA5A5" }
                          }
                        >
                          {isBalanced ? (
                            <><CheckCircle2 className="h-3.5 w-3.5 shrink-0" /> Balanced: Supplier Dibayar + Pajak Dipotong = Grand Total</>
                          ) : (
                            <><AlertTriangle className="h-3.5 w-3.5 shrink-0" /> Warning: Supplier Dibayar + Pajak Dipotong ≠ Grand Total</>
                          )}
                        </div>
                      </div>
                    </div>
                  </div>

                  <div className="col-span-2 px-3 pb-3">
                  </div>
                  <div className="col-span-2">
                    <Label className="text-[10px] text-slate-500 mb-0.5 block">Akun Pengeluaran (COA) <span className="text-red-500">*</span></Label>
                    <AccountCombobox
                      accounts={expenseAccounts}
                      value={line.expenseAccountId ?? null}
                      onChange={(id) => updateLine(key, "expenseAccountId", id)}
                      placeholder="Pilih akun COA pengeluaran..."
                    />
                  </div>
                </div>
              )}
            </div>
          );
        })}
      </div>

      {/* Total summary footer */}
      {lines.length > 0 && (
        <div className="rounded-xl p-4 space-y-2" style={{ background: "#1E293B", border: "1px solid rgba(245,158,11,0.3)" }}>
          <div className="flex items-center justify-between mb-1">
            <span className="text-xs font-bold uppercase tracking-widest" style={{ color: "#F59E0B", letterSpacing: "0.08em" }}>
              {lines.length} Invoice Dipilih
            </span>
          </div>
          <div className="text-xs font-mono space-y-1.5">
            <div className="flex justify-between items-center">
              <span style={{ color: "#64748B" }}>Total Pajak Dipotong</span>
              <span style={{ color: "#94A3B8" }}>Rp {fmt(lines.reduce((s, l) => s + l.whtAmount, 0))}</span>
            </div>
            <div className="flex justify-between items-center pt-2" style={{ borderTop: "1px solid rgba(255,255,255,0.07)" }}>
              <span className="text-sm font-bold" style={{ color: "#F1F5F9" }}>Total Supplier Dibayar</span>
              <span className="text-lg font-bold" style={{ color: "#F59E0B" }}>Rp {fmt(lines.reduce((s, l) => s + l.paymentAmount, 0))}</span>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// EmployeeAdvancePanel — paymentMode = employee_advance
// ─────────────────────────────────────────────────────────────────────────────

function EmployeeAdvancePanel({
  accounts, allAccounts, items, onItemsChange, employees, initialRecipientName,
}: {
  accounts: CoacAccount[];
  allAccounts: CoacAccount[];
  items: DisbursementItem[];
  onItemsChange: (items: DisbursementItem[]) => void;
  employees: Array<{ id: string; name: string; email: string; company_id?: string }>;
  initialRecipientName?: string | null;
}) {
  const [recipientName, setRecipientName] = useState(initialRecipientName ?? "");
  const [empSearchOpen, setEmpSearchOpen] = useState(false);

  // Sync pre-filled employee name from queue on first mount
  useEffect(() => {
    if (!initialRecipientName) return;
    setRecipientName(initialRecipientName);
    onItemsChange([{
      ...(items[0] ?? { seq: 1, transactionType: "employee_advance", accountId: null, description: "", amount: "", notes: "" }),
      description: `Kasbon: ${initialRecipientName}`,
      partyName: initialRecipientName,
    }]);
  // Run only once on mount; intentionally omit items/onItemsChange from deps
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  const [empSearch, setEmpSearch] = useState("");
  const [showAll, setShowAll] = useState(false);
  const item: DisbursementItem = items[0] ?? { seq: 1, transactionType: "employee_advance", accountId: null, description: "", amount: "", notes: "" };
  const sync = (overrides: Partial<DisbursementItem>) => onItemsChange([{ ...item, ...overrides }]);
  const displayAccounts = showAll ? allAccounts : (accounts.length > 0 ? accounts : allAccounts);
  const selectedAccount = allAccounts.find((a) => a.id === item.accountId);

  const filteredEmps = useMemo(() => {
    const q = empSearch.toLowerCase();
    return employees.filter((e) => e.name?.toLowerCase().includes(q) || e.email?.toLowerCase().includes(q));
  }, [employees, empSearch]);

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-2 px-3 py-2 rounded-lg bg-purple-50 border border-purple-200 text-xs">
        <span className="text-purple-600 font-medium">👤 Kasbon Karyawan</span>
        <span className="text-purple-400">—</span>
        <span className="text-purple-500">DR Piutang Karyawan → CR Bank</span>
      </div>
      <div className="grid grid-cols-2 gap-3">
        <div>
          <Label className="text-xs font-medium text-slate-600 mb-1 block">Nama Karyawan / Penerima</Label>
          <Popover open={empSearchOpen} onOpenChange={setEmpSearchOpen}>
            <PopoverTrigger asChild>
              <Button
                variant="outline"
                role="combobox"
                className={cn("h-9 w-full justify-between font-normal text-sm", !recipientName && "text-muted-foreground")}
              >
                <span className="flex items-center gap-2 truncate">
                  <User size={13} className="shrink-0 text-muted-foreground" />
                  {recipientName || "Pilih atau ketik nama karyawan..."}
                </span>
                <ChevronsUpDown size={13} className="shrink-0 text-muted-foreground" />
              </Button>
            </PopoverTrigger>
            <PopoverContent className="w-72 p-0" align="start">
              <Command>
                <CommandInput
                  placeholder="Cari nama atau email..."
                  value={empSearch}
                  onValueChange={setEmpSearch}
                />
                <CommandList className="max-h-52">
                  <CommandEmpty>
                    {empSearch ? (
                      <div className="p-2 text-center">
                        <p className="text-xs text-muted-foreground mb-2">Karyawan tidak ditemukan.</p>
                        <Button size="sm" variant="outline" className="text-xs"
                          onClick={() => {
                            setRecipientName(empSearch);
                            sync({ description: empSearch ? `Kasbon: ${empSearch}` : "" });
                            setEmpSearchOpen(false);
                            setEmpSearch("");
                          }}>
                          Gunakan "{empSearch}"
                        </Button>
                      </div>
                    ) : "Tidak ada karyawan."}
                  </CommandEmpty>
                  {filteredEmps.map((u) => (
                    <CommandItem key={u.id} value={u.name}
                      onSelect={() => {
                        setRecipientName(u.name ?? "");
                        sync({ description: u.name ? `Kasbon: ${u.name}` : "", partyName: u.name ?? "" });
                        setEmpSearchOpen(false);
                        setEmpSearch("");
                      }}>
                      <div className="flex flex-col min-w-0">
                        <span className="font-medium text-sm truncate">{u.name}</span>
                        <span className="text-xs text-muted-foreground truncate">{u.email}</span>
                      </div>
                      {recipientName === u.name && <Check size={13} className="ml-auto text-primary shrink-0" />}
                    </CommandItem>
                  ))}
                </CommandList>
              </Command>
            </PopoverContent>
          </Popover>
        </div>
        <div>
          <Label className="text-xs font-medium text-slate-600 mb-1 block">Jumlah Kasbon (Rp)</Label>
          <Input
            className="h-9 text-sm text-right font-mono"
            type="number" min="0" step="1000" placeholder="0"
            value={item.amount === 0 ? "" : item.amount}
            onChange={(e) => sync({ amount: e.target.value })}
          />
        </div>
      </div>
      <div>
        <div className="flex items-center justify-between mb-1">
          <Label className="text-xs font-medium text-slate-600">Akun Kasbon / Piutang Karyawan (DR)</Label>
          {!showAll && accounts.length > 0 && accounts.length < allAccounts.length && (
            <button type="button" className="text-[10px] text-blue-500 hover:underline" onClick={() => setShowAll(true)}>Tampilkan semua</button>
          )}
          {showAll && <button type="button" className="text-[10px] text-slate-400 hover:underline" onClick={() => setShowAll(false)}>Filter akun</button>}
        </div>
        <Select value={item.accountId ? String(item.accountId) : ""} onValueChange={(v) => sync({ accountId: Number(v) })}>
          <SelectTrigger className="h-9"><SelectValue placeholder="Pilih akun kasbon / piutang karyawan..." /></SelectTrigger>
          <SelectContent>
            {displayAccounts.map((a) => (
              <SelectItem key={a.id} value={String(a.id)}>
                <span className="font-mono text-[10px] text-slate-400 mr-1">{a.code}</span>{a.name}
              </SelectItem>
            ))}
            {displayAccounts.length === 0 && <SelectItem value="_none" disabled>Tidak ada akun kasbon — pilih manual</SelectItem>}
          </SelectContent>
        </Select>
        {selectedAccount && <p className="text-[10px] text-blue-600 mt-0.5">✓ {selectedAccount.code} — {selectedAccount.name}</p>}
      </div>
      <div>
        <Label className="text-xs font-medium text-slate-600 mb-1 block">Tujuan / Keterangan Kasbon</Label>
        <Input className="h-9 text-sm" placeholder="Tujuan penggunaan kasbon (opsional)..." value={item.notes} onChange={(e) => sync({ notes: e.target.value })} />
      </div>
      {item.accountId && Number(item.amount) > 0 && (
        <div className="rounded-lg border border-purple-100 bg-purple-50 p-3">
          <p className="text-xs font-semibold text-purple-700 mb-2">Preview Jurnal Otomatis</p>
          <div className="space-y-1 text-xs font-mono">
            <div className="flex justify-between">
              <span className="text-slate-700">DR {selectedAccount?.name ?? "Piutang Karyawan"}{recipientName ? ` (${recipientName})` : ""}</span>
              <span className="font-medium">{fmt(Number(item.amount))}</span>
            </div>
            <div className="flex justify-between border-t border-purple-200 pt-1">
              <span className="text-slate-500 pl-4">CR Bank / Kas</span>
              <span className="font-semibold">{fmt(Number(item.amount))}</span>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// FundAdvancePanel — paymentMode = fund_advance
// ─────────────────────────────────────────────────────────────────────────────

function FundAdvancePanel({
  accounts, allAccounts, items, onItemsChange,
}: {
  accounts: CoacAccount[];
  allAccounts: CoacAccount[];
  items: DisbursementItem[];
  onItemsChange: (items: DisbursementItem[]) => void;
}) {
  const [recipientName, setRecipientName] = useState("");
  const [showAll, setShowAll] = useState(false);
  const item: DisbursementItem = items[0] ?? { seq: 1, transactionType: "fund_advance", accountId: null, description: "", amount: "", notes: "" };
  const sync = (overrides: Partial<DisbursementItem>) => onItemsChange([{ ...item, ...overrides }]);
  const displayAccounts = showAll ? allAccounts : (accounts.length > 0 ? accounts : allAccounts);
  const selectedAccount = allAccounts.find((a) => a.id === item.accountId);

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-2 px-3 py-2 rounded-lg bg-indigo-50 border border-indigo-200 text-xs">
        <span className="text-indigo-600 font-medium">💼 Dana Talangan</span>
        <span className="text-indigo-400">—</span>
        <span className="text-indigo-500">DR Piutang Talangan → CR Bank</span>
      </div>
      <div className="grid grid-cols-2 gap-3">
        <div>
          <Label className="text-xs font-medium text-slate-600 mb-1 block">Nama Penerima Dana</Label>
          <Input
            className="h-9 text-sm"
            placeholder="Nama penerima talangan..."
            value={recipientName}
            onChange={(e) => { setRecipientName(e.target.value); sync({ description: e.target.value ? `Talangan: ${e.target.value}` : "" }); }}
          />
        </div>
        <div>
          <Label className="text-xs font-medium text-slate-600 mb-1 block">Jumlah Talangan (Rp)</Label>
          <Input
            className="h-9 text-sm text-right font-mono"
            type="number" min="0" step="1000" placeholder="0"
            value={item.amount === 0 ? "" : item.amount}
            onChange={(e) => sync({ amount: e.target.value })}
          />
        </div>
      </div>
      <div>
        <div className="flex items-center justify-between mb-1">
          <Label className="text-xs font-medium text-slate-600">Akun Dana Talangan (DR)</Label>
          {!showAll && accounts.length > 0 && accounts.length < allAccounts.length && (
            <button type="button" className="text-[10px] text-blue-500 hover:underline" onClick={() => setShowAll(true)}>Tampilkan semua</button>
          )}
          {showAll && <button type="button" className="text-[10px] text-slate-400 hover:underline" onClick={() => setShowAll(false)}>Filter akun</button>}
        </div>
        <Select value={item.accountId ? String(item.accountId) : ""} onValueChange={(v) => sync({ accountId: Number(v) })}>
          <SelectTrigger className="h-9"><SelectValue placeholder="Pilih akun piutang talangan..." /></SelectTrigger>
          <SelectContent>
            {displayAccounts.map((a) => (
              <SelectItem key={a.id} value={String(a.id)}>
                <span className="font-mono text-[10px] text-slate-400 mr-1">{a.code}</span>{a.name}
              </SelectItem>
            ))}
            {displayAccounts.length === 0 && <SelectItem value="_none" disabled>Tidak ada akun talangan — pilih manual</SelectItem>}
          </SelectContent>
        </Select>
        {selectedAccount && <p className="text-[10px] text-blue-600 mt-0.5">✓ {selectedAccount.code} — {selectedAccount.name}</p>}
      </div>
      <div>
        <Label className="text-xs font-medium text-slate-600 mb-1 block">Keterangan Tujuan</Label>
        <Input className="h-9 text-sm" placeholder="Tujuan dana talangan (opsional)..." value={item.notes} onChange={(e) => sync({ notes: e.target.value })} />
      </div>
      {item.accountId && Number(item.amount) > 0 && (
        <div className="rounded-lg border border-indigo-100 bg-indigo-50 p-3">
          <p className="text-xs font-semibold text-indigo-700 mb-2">Preview Jurnal Otomatis</p>
          <div className="space-y-1 text-xs font-mono">
            <div className="flex justify-between">
              <span className="text-slate-700">DR {selectedAccount?.name ?? "Piutang Talangan"}{recipientName ? ` (${recipientName})` : ""}</span>
              <span className="font-medium">{fmt(Number(item.amount))}</span>
            </div>
            <div className="flex justify-between border-t border-indigo-200 pt-1">
              <span className="text-slate-500 pl-4">CR Bank / Kas</span>
              <span className="font-semibold">{fmt(Number(item.amount))}</span>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// FundTransferPanel — paymentMode = fund_transfer
// ─────────────────────────────────────────────────────────────────────────────

function FundTransferPanel({
  accounts, allAccounts, items, onItemsChange, journals, selectedJournalId,
}: {
  accounts: CoacAccount[];
  allAccounts: CoacAccount[];
  items: DisbursementItem[];
  onItemsChange: (items: DisbursementItem[]) => void;
  journals: Journal[];
  selectedJournalId: string;
}) {
  const item: DisbursementItem = items[0] ?? { seq: 1, transactionType: "fund_transfer", accountId: null, description: "", amount: "", notes: "" };
  const sync = (overrides: Partial<DisbursementItem>) => onItemsChange([{ ...item, ...overrides }]);
  const selectedJournal = journals.find((j) => String(j.id) === selectedJournalId);
  const targetAccount = allAccounts.find((a) => a.id === item.accountId);

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-2 px-3 py-2 rounded-lg bg-green-50 border border-green-200 text-xs">
        <span className="text-green-600 font-medium">🏦 Transfer Dana Antar Rekening</span>
        <span className="text-green-400">—</span>
        <span className="text-green-500">DR Bank Tujuan → CR Bank Sumber</span>
      </div>
      <div className="grid grid-cols-[1fr_auto_1fr] items-center gap-3">
        <div className="rounded-lg border border-slate-200 bg-slate-50 p-3">
          <p className="text-[10px] text-slate-400 font-semibold mb-1 uppercase tracking-wide">Dari (Sumber)</p>
          {selectedJournal ? (
            <>
              <p className="text-sm font-semibold text-slate-700">{selectedJournal.name}</p>
              <p className="text-[10px] font-mono text-slate-400">{selectedJournal.code}</p>
            </>
          ) : (
            <p className="text-xs text-amber-500">↑ Pilih jurnal bank di atas</p>
          )}
        </div>
        <ArrowRight className="h-5 w-5 text-slate-400 shrink-0" />
        <div className="rounded-lg border border-green-200 bg-green-50 p-3">
          <p className="text-[10px] text-green-600 font-semibold mb-1 uppercase tracking-wide">Ke (Tujuan)</p>
          {targetAccount ? (
            <>
              <p className="text-sm font-semibold text-green-800">{targetAccount.name}</p>
              <p className="text-[10px] font-mono text-green-600">{targetAccount.code}</p>
            </>
          ) : (
            <p className="text-xs text-slate-400">Pilih rekening di bawah →</p>
          )}
        </div>
      </div>
      <div>
        <Label className="text-xs font-medium text-slate-600 mb-1 block">Rekening Tujuan (DR Bank/Kas)</Label>
        <Select
          value={item.accountId ? String(item.accountId) : ""}
          onValueChange={(v) => {
            const acctName = allAccounts.find((a) => a.id === Number(v))?.name ?? "";
            sync({ accountId: Number(v), description: `Transfer ke ${acctName}` });
          }}
        >
          <SelectTrigger className="h-9"><SelectValue placeholder="Pilih rekening tujuan (Kas/Bank)..." /></SelectTrigger>
          <SelectContent>
            {accounts.map((a) => (
              <SelectItem key={a.id} value={String(a.id)}>
                <span className="font-mono text-[10px] text-slate-400 mr-1">{a.code}</span>{a.name}
              </SelectItem>
            ))}
            {accounts.length === 0 && <SelectItem value="_none" disabled>Tidak ada akun kas/bank di CoA</SelectItem>}
          </SelectContent>
        </Select>
      </div>
      <div>
        <Label className="text-xs font-medium text-slate-600 mb-1 block">Jumlah Transfer (Rp)</Label>
        <Input
          className="h-9 text-sm text-right font-mono"
          type="number" min="0" step="1000" placeholder="0"
          value={item.amount === 0 ? "" : item.amount}
          onChange={(e) => sync({ amount: e.target.value })}
        />
      </div>
      {item.accountId && Number(item.amount) > 0 && (
        <div className="rounded-lg border border-green-100 bg-green-50 p-3">
          <p className="text-xs font-semibold text-green-700 mb-2">Preview Jurnal Otomatis</p>
          <div className="space-y-1 text-xs font-mono">
            <div className="flex justify-between">
              <span className="text-slate-700">DR {targetAccount?.name ?? "Bank Tujuan"}</span>
              <span className="font-medium">{fmt(Number(item.amount))}</span>
            </div>
            <div className="flex justify-between border-t border-green-200 pt-1">
              <span className="text-slate-500 pl-4">CR {selectedJournal?.name ?? "Bank Sumber"}</span>
              <span className="font-semibold">{fmt(Number(item.amount))}</span>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// TaxPaymentPanel — paymentMode = tax_payment
// ─────────────────────────────────────────────────────────────────────────────

const TAX_TYPES = [
  { value: "pph21",  label: "PPh 21 — Pajak Penghasilan Karyawan" },
  { value: "pph23",  label: "PPh 23 — Jasa & Modal" },
  { value: "pph25",  label: "PPh 25 — Angsuran Bulanan" },
  { value: "pph29",  label: "PPh 29 — Tahunan Badan" },
  { value: "pphf",   label: "PPh Final — Tertentu" },
  { value: "ppn",    label: "PPN — Pajak Pertambahan Nilai" },
  { value: "pbb",    label: "PBB — Pajak Bumi Bangunan" },
  { value: "lain",   label: "Pajak Lainnya" },
];

function TaxPaymentPanel({
  accounts, allAccounts, items, onItemsChange,
}: {
  accounts: CoacAccount[];
  allAccounts: CoacAccount[];
  items: DisbursementItem[];
  onItemsChange: (items: DisbursementItem[]) => void;
}) {
  const [taxType, setTaxType] = useState("");
  const [taxPeriod, setTaxPeriod] = useState("");
  const [sspRef, setSspRef] = useState("");
  const [showAll, setShowAll] = useState(false);
  const item: DisbursementItem = items[0] ?? { seq: 1, transactionType: "tax_payment", accountId: null, description: "", amount: "", notes: "" };

  const buildDesc = (tt: string, tp: string) => {
    const taxLabel = TAX_TYPES.find((t) => t.value === tt)?.label.split(" — ")[0] ?? tt;
    return [taxLabel, tp ? `Masa ${tp}` : ""].filter(Boolean).join(" ");
  };

  const sync = (overrides: Partial<DisbursementItem>, newTT?: string, newTP?: string, newSSP?: string) => {
    const tt = newTT ?? taxType;
    const tp = newTP ?? taxPeriod;
    const sr = newSSP ?? sspRef;
    onItemsChange([{ ...item, ...overrides, description: buildDesc(tt, tp), notes: sr }]);
  };

  const displayAccounts = showAll ? allAccounts : (accounts.length > 0 ? accounts : allAccounts);
  const selectedAccount = allAccounts.find((a) => a.id === item.accountId);
  const isTaxLiability = selectedAccount?.type === "liability";

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-2 px-3 py-2 rounded-lg bg-red-50 border border-red-200 text-xs">
        <span className="text-red-600 font-medium">📋 Pembayaran Pajak</span>
        <span className="text-red-400">—</span>
        <span className="text-red-500">DR Hutang Pajak / Beban Pajak → CR Bank</span>
      </div>
      <div className="grid grid-cols-2 gap-3">
        <div>
          <Label className="text-xs font-medium text-slate-600 mb-1 block">Jenis Pajak</Label>
          <Select value={taxType} onValueChange={(v) => { setTaxType(v); sync({}, v, undefined, undefined); }}>
            <SelectTrigger className="h-9"><SelectValue placeholder="Pilih jenis pajak..." /></SelectTrigger>
            <SelectContent>
              {TAX_TYPES.map((t) => <SelectItem key={t.value} value={t.value}>{t.label}</SelectItem>)}
            </SelectContent>
          </Select>
        </div>
        <div>
          <Label className="text-xs font-medium text-slate-600 mb-1 block">Masa / Periode Pajak</Label>
          <div className="flex gap-1.5">
            <Select
              value={taxPeriod ? taxPeriod.split("-")[1] : ""}
              onValueChange={(m) => {
                const y = taxPeriod ? taxPeriod.split("-")[0] : String(new Date().getFullYear());
                const next = `${y}-${m}`;
                setTaxPeriod(next);
                sync({}, undefined, next, undefined);
              }}
            >
              <SelectTrigger className="h-9 text-sm flex-1"><SelectValue placeholder="Bulan" /></SelectTrigger>
              <SelectContent>
                {["01","02","03","04","05","06","07","08","09","10","11","12"].map((m, i) => (
                  <SelectItem key={m} value={m}>
                    {["Jan","Feb","Mar","Apr","Mei","Jun","Jul","Agu","Sep","Okt","Nov","Des"][i]}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Select
              value={taxPeriod ? taxPeriod.split("-")[0] : ""}
              onValueChange={(y) => {
                const m = taxPeriod ? taxPeriod.split("-")[1] : "01";
                const next = `${y}-${m}`;
                setTaxPeriod(next);
                sync({}, undefined, next, undefined);
              }}
            >
              <SelectTrigger className="h-9 text-sm w-[90px]"><SelectValue placeholder="Tahun" /></SelectTrigger>
              <SelectContent>
                {Array.from({ length: 10 }, (_, i) => String(new Date().getFullYear() - 2 + i)).map((y) => (
                  <SelectItem key={y} value={y}>{y}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </div>
      </div>
      <div>
        <div className="flex items-center justify-between mb-1">
          <Label className="text-xs font-medium text-slate-600">Akun Pajak (DR)</Label>
          {!showAll && accounts.length > 0 && accounts.length < allAccounts.length && (
            <button type="button" className="text-[10px] text-blue-500 hover:underline" onClick={() => setShowAll(true)}>Tampilkan semua</button>
          )}
          {showAll && <button type="button" className="text-[10px] text-slate-400 hover:underline" onClick={() => setShowAll(false)}>Filter akun</button>}
        </div>
        <Select value={item.accountId ? String(item.accountId) : ""} onValueChange={(v) => sync({ accountId: Number(v) })}>
          <SelectTrigger className="h-9"><SelectValue placeholder="Pilih akun hutang pajak atau beban pajak..." /></SelectTrigger>
          <SelectContent>
            {displayAccounts.map((a) => {
              const meta = getAccountMeta(a.type);
              return (
                <SelectItem key={a.id} value={String(a.id)}>
                  <div className="flex items-center gap-2">
                    <span className="font-mono text-[10px] text-slate-400 shrink-0">{a.code}</span>
                    <span>{a.name}</span>
                    {meta && <span className={`text-[9px] px-1 rounded border shrink-0 ${meta.badgeClass}`}>{meta.label}</span>}
                  </div>
                </SelectItem>
              );
            })}
          </SelectContent>
        </Select>
        {selectedAccount && (
          <p className={`text-[10px] mt-0.5 font-medium ${isTaxLiability ? "text-blue-600" : "text-orange-600"}`}>
            {isTaxLiability
              ? "✓ Hutang Pajak (Neraca) — mengurangi saldo hutang pajak"
              : "⚠ Beban Pajak (L/R) — langsung masuk pengeluaran"}
          </p>
        )}
      </div>
      <div className="grid grid-cols-2 gap-3">
        <div>
          <Label className="text-xs font-medium text-slate-600 mb-1 block">Jumlah Pajak (Rp)</Label>
          <Input
            className="h-9 text-sm text-right font-mono"
            type="number" min="0" step="1000" placeholder="0"
            value={item.amount === 0 ? "" : item.amount}
            onChange={(e) => sync({ amount: e.target.value })}
          />
        </div>
        <div>
          <Label className="text-xs font-medium text-slate-600 mb-1 block">No. Referensi SSP / NTPN</Label>
          <Input
            className="h-9 text-sm"
            placeholder="Opsional..."
            value={sspRef}
            onChange={(e) => { setSspRef(e.target.value); sync({}, undefined, undefined, e.target.value); }}
          />
        </div>
      </div>
      {item.accountId && Number(item.amount) > 0 && (
        <div className="rounded-lg border border-red-100 bg-red-50 p-3">
          <p className="text-xs font-semibold text-red-700 mb-2">Preview Jurnal Otomatis</p>
          <div className="space-y-1 text-xs font-mono">
            <div className="flex justify-between">
              <span className={isTaxLiability ? "text-slate-700" : "text-orange-700 font-semibold"}>
                DR {selectedAccount?.name}
              </span>
              <span className="font-medium">{fmt(Number(item.amount))}</span>
            </div>
            <div className="flex justify-between border-t border-red-200 pt-1">
              <span className="text-slate-500 pl-4">CR Bank / Kas</span>
              <span className="font-semibold">{fmt(Number(item.amount))}</span>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// LoanPaymentPanel — paymentMode = loan_payment (NEW)
// ─────────────────────────────────────────────────────────────────────────────

function LoanPaymentPanel({
  accounts, expenseAccounts, allAccounts, items, onItemsChange,
}: {
  accounts: CoacAccount[];
  expenseAccounts: CoacAccount[];
  allAccounts: CoacAccount[];
  items: DisbursementItem[];
  onItemsChange: (items: DisbursementItem[]) => void;
}) {
  const [loanAccountId, setLoanAccountId] = useState<number | null>(null);
  const [principalAmount, setPrincipalAmount] = useState<string>("");
  const [interestAccountId, setInterestAccountId] = useState<number | null>(null);
  const [interestAmount, setInterestAmount] = useState<string>("");

  const buildItems = (la: number | null, pa: string, ia: number | null, ira: string): DisbursementItem[] => {
    const result: DisbursementItem[] = [{
      seq: 1, transactionType: "loan_payment", accountId: la,
      description: "Pokok pinjaman", amount: pa, notes: "",
    }];
    if (Number(ira) > 0 && ia) {
      result.push({ seq: 2, transactionType: "expense", accountId: ia, description: "Bunga pinjaman", amount: ira, notes: "" });
    }
    return result;
  };

  const loanAccount = allAccounts.find((a) => a.id === loanAccountId);
  const interestAccount = allAccounts.find((a) => a.id === interestAccountId);
  const totalAmount = Number(principalAmount) + Number(interestAmount);

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-2 px-3 py-2 rounded-lg bg-blue-50 border border-blue-200 text-xs">
        <span className="text-blue-600 font-medium">🏛 Cicilan Pinjaman</span>
        <span className="text-blue-400">—</span>
        <span className="text-blue-500">DR Utang Pinjaman + DR Bunga → CR Bank</span>
      </div>
      <div>
        <Label className="text-xs font-medium text-slate-600 mb-1 block">Akun Utang / Pinjaman (DR Pokok)</Label>
        <Select
          value={loanAccountId ? String(loanAccountId) : ""}
          onValueChange={(v) => {
            const id = Number(v);
            setLoanAccountId(id);
            onItemsChange(buildItems(id, principalAmount, interestAccountId, interestAmount));
          }}
        >
          <SelectTrigger className="h-9"><SelectValue placeholder="Pilih akun utang bank / leasing / pinjaman..." /></SelectTrigger>
          <SelectContent>
            {accounts.map((a) => (
              <SelectItem key={a.id} value={String(a.id)}>
                <span className="font-mono text-[10px] text-slate-400 mr-1">{a.code}</span>{a.name}
              </SelectItem>
            ))}
            {accounts.length === 0 && <SelectItem value="_none" disabled>Tidak ada akun pinjaman — gunakan mode Lainnya</SelectItem>}
          </SelectContent>
        </Select>
        {loanAccount && <p className="text-[10px] text-blue-600 mt-0.5">✓ {loanAccount.code} — {loanAccount.name}</p>}
      </div>
      <div className="grid grid-cols-2 gap-3">
        <div>
          <Label className="text-xs font-medium text-slate-600 mb-1 block">Jumlah Pokok (Rp)</Label>
          <Input
            className="h-9 text-sm text-right font-mono"
            type="number" min="0" step="1000" placeholder="0"
            value={principalAmount}
            onChange={(e) => {
              setPrincipalAmount(e.target.value);
              onItemsChange(buildItems(loanAccountId, e.target.value, interestAccountId, interestAmount));
            }}
          />
        </div>
        <div>
          <Label className="text-xs font-medium text-slate-600 mb-1 block">Jumlah Bunga (Rp)</Label>
          <Input
            className="h-9 text-sm text-right font-mono"
            type="number" min="0" step="1000" placeholder="0 (opsional)"
            value={interestAmount}
            onChange={(e) => {
              setInterestAmount(e.target.value);
              onItemsChange(buildItems(loanAccountId, principalAmount, interestAccountId, e.target.value));
            }}
          />
        </div>
      </div>
      {Number(interestAmount) > 0 && (
        <div>
          <Label className="text-xs font-medium text-slate-600 mb-1 block">Akun Beban Bunga (DR)</Label>
          <Select
            value={interestAccountId ? String(interestAccountId) : ""}
            onValueChange={(v) => {
              const id = Number(v);
              setInterestAccountId(id);
              onItemsChange(buildItems(loanAccountId, principalAmount, id, interestAmount));
            }}
          >
            <SelectTrigger className="h-9"><SelectValue placeholder="Pilih akun beban bunga..." /></SelectTrigger>
            <SelectContent>
              {expenseAccounts.map((a) => (
                <SelectItem key={a.id} value={String(a.id)}>
                  <span className="font-mono text-[10px] text-slate-400 mr-1">{a.code}</span>{a.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          {interestAccount && <p className="text-[10px] text-orange-600 mt-0.5">⚠ {interestAccount.name} (masuk L/R)</p>}
        </div>
      )}
      {loanAccountId && Number(principalAmount) > 0 && (
        <div className="rounded-lg border border-blue-100 bg-blue-50 p-3">
          <p className="text-xs font-semibold text-blue-700 mb-2">Preview Jurnal Otomatis</p>
          <div className="space-y-1 text-xs font-mono">
            <div className="flex justify-between">
              <span className="text-slate-700">DR {loanAccount?.name ?? "Utang Pinjaman"} (Pokok)</span>
              <span className="font-medium">{fmt(Number(principalAmount))}</span>
            </div>
            {Number(interestAmount) > 0 && interestAccount && (
              <div className="flex justify-between">
                <span className="text-orange-700 font-semibold">DR {interestAccount.name} (Bunga)</span>
                <span className="font-medium">{fmt(Number(interestAmount))}</span>
              </div>
            )}
            <div className="flex justify-between border-t border-blue-200 pt-1">
              <span className="text-slate-500 pl-4">CR Bank / Kas</span>
              <span className="font-semibold">{fmt(totalAmount)}</span>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// EquityWithdrawalPanel — paymentMode = equity_withdrawal (NEW)
// ─────────────────────────────────────────────────────────────────────────────

function EquityWithdrawalPanel({
  accounts, allAccounts, items, onItemsChange,
}: {
  accounts: CoacAccount[];
  allAccounts: CoacAccount[];
  items: DisbursementItem[];
  onItemsChange: (items: DisbursementItem[]) => void;
}) {
  const [ownerName, setOwnerName] = useState("");
  const item: DisbursementItem = items[0] ?? { seq: 1, transactionType: "equity_withdrawal", accountId: null, description: "", amount: "", notes: "" };
  const sync = (overrides: Partial<DisbursementItem>) => onItemsChange([{ ...item, ...overrides }]);
  const selectedAccount = allAccounts.find((a) => a.id === item.accountId);

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-2 px-3 py-2 rounded-lg bg-slate-50 border border-slate-200 text-xs">
        <span className="text-slate-600 font-medium">💰 Penarikan Modal</span>
        <span className="text-slate-400">—</span>
        <span className="text-slate-500">DR Modal / Saldo Laba → CR Bank</span>
      </div>
      <div className="grid grid-cols-2 gap-3">
        <div>
          <Label className="text-xs font-medium text-slate-600 mb-1 block">Nama Pemilik / Partner</Label>
          <Input
            className="h-9 text-sm"
            placeholder="Nama pemilik atau pemegang saham..."
            value={ownerName}
            onChange={(e) => { setOwnerName(e.target.value); sync({ description: e.target.value ? `Penarikan: ${e.target.value}` : "" }); }}
          />
        </div>
        <div>
          <Label className="text-xs font-medium text-slate-600 mb-1 block">Jumlah Penarikan (Rp)</Label>
          <Input
            className="h-9 text-sm text-right font-mono"
            type="number" min="0" step="1000" placeholder="0"
            value={item.amount === 0 ? "" : item.amount}
            onChange={(e) => sync({ amount: e.target.value })}
          />
        </div>
      </div>
      <div>
        <Label className="text-xs font-medium text-slate-600 mb-1 block">Akun Modal / Dividen (DR)</Label>
        <Select value={item.accountId ? String(item.accountId) : ""} onValueChange={(v) => sync({ accountId: Number(v) })}>
          <SelectTrigger className="h-9"><SelectValue placeholder="Pilih akun modal atau saldo laba..." /></SelectTrigger>
          <SelectContent>
            {accounts.map((a) => (
              <SelectItem key={a.id} value={String(a.id)}>
                <span className="font-mono text-[10px] text-slate-400 mr-1">{a.code}</span>{a.name}
              </SelectItem>
            ))}
            {accounts.length === 0 && <SelectItem value="_none" disabled>Tidak ada akun modal di CoA — gunakan mode Lainnya</SelectItem>}
          </SelectContent>
        </Select>
        {selectedAccount && <p className="text-[10px] text-slate-600 mt-0.5">✓ {selectedAccount.code} — {selectedAccount.name} (Ekuitas)</p>}
      </div>
      {item.accountId && Number(item.amount) > 0 && (
        <div className="rounded-lg border border-slate-200 bg-slate-50 p-3">
          <p className="text-xs font-semibold text-slate-700 mb-2">Preview Jurnal Otomatis</p>
          <div className="space-y-1 text-xs font-mono">
            <div className="flex justify-between">
              <span className="text-slate-700">DR {selectedAccount?.name ?? "Modal"}{ownerName ? ` (${ownerName})` : ""}</span>
              <span className="font-medium">{fmt(Number(item.amount))}</span>
            </div>
            <div className="flex justify-between border-t border-slate-300 pt-1">
              <span className="text-slate-500 pl-4">CR Bank / Kas</span>
              <span className="font-semibold">{fmt(Number(item.amount))}</span>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Create Dialog
// ─────────────────────────────────────────────────────────────────────────────

type PaymentMode = "vendor_invoice" | "expense" | "employee_advance" | "fund_transfer" | "tax_payment" | "loan_payment" | "equity_withdrawal" | "other";

const PAYMENT_MODES: { value: PaymentMode; label: string; icon: string; desc: string }[] = [
  { value: "vendor_invoice",    label: "Bayar Invoice Vendor",  icon: "🧾", desc: "Lunasi hutang dagang dari invoice yang sudah diposting" },
  { value: "expense",           label: "Pengeluaran Langsung",  icon: "📤", desc: "Beban operasional, sewa, gaji, utilitas, dan sejenisnya" },
  { value: "employee_advance",  label: "Kasbon Karyawan",       icon: "👤", desc: "Uang muka karyawan sebelum pertanggungjawaban" },
  { value: "fund_transfer",     label: "Transfer Dana",         icon: "🏦", desc: "Pindah dana antar rekening kas atau bank perusahaan" },
  { value: "tax_payment",       label: "Pembayaran Pajak",      icon: "📋", desc: "Bayar PPh, PPN, atau kewajiban pajak lainnya" },
  { value: "loan_payment",      label: "Cicilan Pinjaman",      icon: "🏛", desc: "Bayar angsuran bank, leasing, atau pinjaman lainnya" },
  { value: "equity_withdrawal", label: "Penarikan Modal",       icon: "💰", desc: "Penarikan dana pemilik atau pembayaran dividen" },
  { value: "other",             label: "Lainnya",               icon: "📝", desc: "Pengeluaran yang tidak tercakup oleh kategori di atas" },
];

const MODE_TO_TX_TYPE: Record<string, string> = {
  expense:           "expense",
  employee_advance:  "employee_advance",
  fund_transfer:     "fund_transfer",
  tax_payment:       "tax_payment",
  loan_payment:      "loan_payment",
  equity_withdrawal: "equity_withdrawal",
  other:             "other",
};

interface CreateDisbDialogProps {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  journals: Journal[];
  allAccounts: CoacAccount[];
  accountsByType: Record<string, CoacAccount[]>;
  onCreated: () => void;
  createDisb: (body: object) => Promise<unknown>;
  fetchOutstandingInvoices: () => Promise<OutstandingInvoicesResponse>;
  initialMode?: PaymentMode;
  initialInvoiceIds?: number[];
  initialEmployeeName?: string | null;
}

interface BdOcrResult {
  vendor_name: string | null;
  invoice_number: string | null;
  invoice_date: string | null;
  due_date?: string | null;
  total_amount: number | null;
  description: string | null;
  line_items: Array<{ description: string | null; amount: number | null }>;
  invoice_breakdown?: {
    components?: Array<Record<string, unknown>>;
    withholding_tax?: { amount?: number | null };
    totals?: {
      dpp?: number | null;
      ppn?: number | null;
      gross?: number | null;
      withholding_tax_amount?: number | null;
      payable_amount?: number | null;
    };
  } | null;
  confidence: number;
}

function CreateDisbDialog({
  open, onOpenChange, journals, allAccounts, accountsByType, onCreated, createDisb,
  fetchOutstandingInvoices, initialMode, initialInvoiceIds, initialEmployeeName,
}: CreateDisbDialogProps) {
  const { toast } = useToast();
  const { activeCompanyId } = useCompany();
  const [saving, setSaving] = useState(false);
  const [paymentMode, setPaymentMode] = useState<PaymentMode>(initialMode ?? "expense");
  const [outstandingData, setOutstandingData] = useState<OutstandingInvoicesResponse | null>(null);
  const [loadingInvoices, setLoadingInvoices] = useState(false);
  const [invoiceLines, setInvoiceLines] = useState<InvoicePaymentLine[]>([]);

  // ── Vendor invoice filter (lifted from VendorInvoicePanel for OCR auto-fill) ─
  const [selectedVendorIdForPanel, setSelectedVendorIdForPanel] = useState<string | null>(null);

  // ── OCR state ──────────────────────────────────────────────────────────────
  const ocrFileRef = useRef<HTMLInputElement>(null);
  const [ocrLoading, setOcrLoading] = useState(false);
  const [ocrResult, setOcrResult] = useState<BdOcrResult | null>(null);
  const [ocrApplied, setOcrApplied] = useState(false);
  const [quickCreating, setQuickCreating] = useState(false);

  // Phase 5: attachment / bukti pembayaran
  const [attachmentFile, setAttachmentFile] = useState<File | null>(null);
  const [attachmentPreview, setAttachmentPreview] = useState<string | null>(null);
  const [attachmentUrl, setAttachmentUrl] = useState<string | null>(null);
  const [isUploadingAttachment, setIsUploadingAttachment] = useState(false);
  const attachmentRef = useRef<HTMLInputElement>(null);

  // ── Employee list (untuk combobox Kasbon Karyawan) ─────────────────────────
  const [employees, setEmployees] = useState<Array<{ id: string; name: string; email: string; company_id?: string }>>([]);
  useEffect(() => {
    fetch("/api/expense-approvals/users", { credentials: "include" })
      .then((r) => r.ok ? r.json() : [])
      .then((rows: any[]) => setEmployees(rows.filter((r) => r.name)))
      .catch(() => {});
  }, []);

  const emptyItemForMode = (mode: PaymentMode): DisbursementItem => ({
    seq: 1,
    transactionType: mode === "vendor_invoice" ? "expense" : (MODE_TO_TX_TYPE[mode] ?? "expense"),
    accountId: null,
    description: "",
    amount: "",
    notes: "",
    ppnAmount: 0,
    ppnAccountId: null,
  });

  const [form, setForm] = useState({
    journalId: "",
    date: new Date().toISOString().split("T")[0]!,
    ref: "",
    memo: "",
    counterpartyName: "",
    counterpartyType: "",
    counterpartyId: "",
  });
  const [items, setItems] = useState<DisbursementItem[]>([emptyItemForMode(initialMode ?? "expense")]);

  // ── Counterparty search combobox state ────────────────────────────────────
  const [cpSearchQuery, setCpSearchQuery] = useState("");
  const [cpSearchResults, setCpSearchResults] = useState<{ id: string; name: string }[]>([]);
  const [cpDropdownOpen, setCpDropdownOpen] = useState(false);
  const [cpSearching, setCpSearching] = useState(false);
  const cpSearchRef = useRef<HTMLDivElement>(null);

  // Close dropdown on outside click
  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (cpSearchRef.current && !cpSearchRef.current.contains(e.target as Node)) {
        setCpDropdownOpen(false);
      }
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, []);

  // Debounced search
  useEffect(() => {
    const type = form.counterpartyType;
    if (!cpSearchQuery.trim() || !["supplier", "employee"].includes(type)) {
      setCpSearchResults([]);
      setCpDropdownOpen(false);
      return;
    }
    setCpSearching(true);
    const timer = setTimeout(async () => {
      try {
        const params = new URLSearchParams({ q: cpSearchQuery, type });
        const r = await fetch(`/api/accounting/bank-disbursements/counterparty-search?${params}`, {
          credentials: "include",
        });
        if (r.ok) {
          const data = await r.json() as { id: string; name: string }[];
          setCpSearchResults(data);
          setCpDropdownOpen(data.length > 0);
        }
      } catch { /* non-fatal */ }
      finally { setCpSearching(false); }
    }, 300);
    return () => clearTimeout(timer);
  }, [cpSearchQuery, form.counterpartyType]);

  const resetForm = () => {
    const mode = initialMode ?? "expense";
    setForm({ journalId: "", date: new Date().toISOString().split("T")[0]!, ref: "", memo: "", counterpartyName: "", counterpartyType: "", counterpartyId: "" });
    setCpSearchQuery("");
    setCpSearchResults([]);
    setCpDropdownOpen(false);
    setItems([emptyItemForMode(mode)]);
    setInvoiceLines([]);
    setPaymentMode(mode);
    setOutstandingData(null);
    setSelectedVendorIdForPanel(null);
    setOcrResult(null);
    setOcrApplied(false);
    setAttachmentFile(null);
    if (attachmentPreview) { URL.revokeObjectURL(attachmentPreview); }
    setAttachmentPreview(null);
    setAttachmentUrl(null);
    setIsUploadingAttachment(false);
  };

  const handleOcrFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    e.target.value = "";
    setOcrLoading(true);
    setOcrResult(null);
    setOcrApplied(false);
    try {
      const fd = new FormData();
      fd.append("file", file);
      const r = await fetch("/api/accounting/bank-disbursements/ocr-extract", {
        method: "POST",
        credentials: "include",
        body: fd,
      });
      if (!r.ok) {
        const err = await r.json().catch(() => ({}));
        throw new Error((err as Record<string, string>).error ?? `HTTP ${r.status}`);
      }
      const body = await r.json();
      setOcrResult(body.data as BdOcrResult);
    } catch (err) {
      toast({
        title: "OCR gagal",
        description: err instanceof Error ? err.message : String(err),
        variant: "destructive",
      });
    } finally {
      setOcrLoading(false);
    }
  };

  // ── Attachment helpers ──────────────────────────────────────────────────────

  /** Kompres gambar client-side pakai Canvas API sebelum upload (max 1200px, quality 0.82) */
  const compressImage = (file: File): Promise<Blob> =>
    new Promise((resolve) => {
      if (!file.type.startsWith("image/")) { resolve(file); return; }
      const img = new Image();
      const url = URL.createObjectURL(file);
      img.onload = () => {
        URL.revokeObjectURL(url);
        const MAX = 1200;
        let { width, height } = img;
        if (width > MAX || height > MAX) {
          if (width > height) { height = Math.round((height * MAX) / width); width = MAX; }
          else { width = Math.round((width * MAX) / height); height = MAX; }
        }
        const canvas = document.createElement("canvas");
        canvas.width = width; canvas.height = height;
        canvas.getContext("2d")!.drawImage(img, 0, 0, width, height);
        canvas.toBlob((blob) => resolve(blob ?? file), "image/jpeg", 0.82);
      };
      img.onerror = () => { URL.revokeObjectURL(url); resolve(file); };
      img.src = url;
    });

  const handleAttachmentChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;

    // Local preview
    if (attachmentPreview) URL.revokeObjectURL(attachmentPreview);
    setAttachmentPreview(file.type.startsWith("image/") ? URL.createObjectURL(file) : null);
    setAttachmentFile(file);
    setAttachmentUrl(null);

    // Compress + upload
    setIsUploadingAttachment(true);
    try {
      const toUpload = await compressImage(file);
      const fd = new FormData();
      fd.append("file", toUpload, file.name);
      const r = await fetch("/api/accounting/bank-disbursements/upload-attachment", {
        method: "POST",
        credentials: "include",
        body: fd,
      });
      if (!r.ok) {
        const err = await r.json().catch(() => ({}));
        throw new Error((err as Record<string, string>).message ?? `HTTP ${r.status}`);
      }
      const { url } = await r.json();
      setAttachmentUrl(url);
    } catch (err) {
      toast({
        title: "Upload bukti gagal",
        description: err instanceof Error ? err.message : String(err),
        variant: "destructive",
      });
      setAttachmentFile(null);
      setAttachmentPreview(null);
    } finally {
      setIsUploadingAttachment(false);
    }
  };

  const handleApplyOcr = () => {
    if (!ocrResult) return;

    // Auto-fill counterparty fields from OCR vendor_name
    const ocrVendorName = ocrResult.vendor_name?.trim() ?? "";
    let autoCounterpartyName = "";
    let autoCounterpartyType = "";
    let autoCounterpartyId = "";
    if (ocrVendorName) {
      autoCounterpartyName = ocrVendorName;
      autoCounterpartyType = "supplier";
      // Try to match to a known supplier ID
      const suppliers = outstandingData?.suppliers ?? [];
      const matched = suppliers.find(
        (s) => s.name.trim().toLowerCase() === ocrVendorName.toLowerCase()
      );
      if (matched) autoCounterpartyId = String(matched.id);
    }

    // Auto-set Filter Vendor in VendorInvoicePanel when mode is vendor_invoice
    if (paymentMode === "vendor_invoice" && ocrVendorName) {
      const suppliers = outstandingData?.suppliers ?? [];
      const invoices = outstandingData?.invoices ?? [];
      const ocrLower = ocrVendorName.toLowerCase();

      // 1. Exact match against known suppliers (id_* key)
      const matched = suppliers.find((s) => s.name.trim().toLowerCase() === ocrLower);
      if (matched) {
        setSelectedVendorIdForPanel(`id_${matched.id}`);
      } else {
        // 2. Exact match against invoice supplier names (covers name_* keys when supplier_id is null)
        const invoiceNameMatch = invoices.find(
          (inv) => inv.supplierName.trim().toLowerCase() === ocrLower && inv.supplierId == null
        );
        if (invoiceNameMatch) {
          setSelectedVendorIdForPanel(`name_${invoiceNameMatch.supplierName}`);
        } else {
          // 3. Fuzzy partial match against suppliers
          const fuzzy = suppliers.find((s) =>
            s.name.toLowerCase().includes(ocrLower) || ocrLower.includes(s.name.toLowerCase())
          );
          if (fuzzy) {
            setSelectedVendorIdForPanel(`id_${fuzzy.id}`);
          } else {
            // 4. No match — clear stale filter to avoid wrong vendor being shown
            setSelectedVendorIdForPanel(null);
          }
        }
      }
    }

    setForm((prev) => ({
      ...prev,
      ...(ocrResult.invoice_date ? { date: ocrResult.invoice_date } : {}),
      ...(ocrResult.invoice_number ? { ref: ocrResult.invoice_number } : {}),
      ...(ocrResult.vendor_name
        ? { memo: `${ocrResult.vendor_name}${ocrResult.description ? ` — ${ocrResult.description}` : ""}` }
        : ocrResult.description ? { memo: ocrResult.description } : {}),
      ...(autoCounterpartyName && !prev.counterpartyName ? { counterpartyName: autoCounterpartyName } : {}),
      ...(autoCounterpartyType && !prev.counterpartyType ? { counterpartyType: autoCounterpartyType } : {}),
      ...(autoCounterpartyId && !prev.counterpartyId ? { counterpartyId: autoCounterpartyId } : {}),
    }));

    // Sync the counterparty search input box to the vendor name
    if (autoCounterpartyName && !form.counterpartyName) {
      setCpSearchQuery(autoCounterpartyName);
    }

    if (paymentMode !== "vendor_invoice") {
      const lineItems = ocrResult.line_items?.filter((li) => li.amount != null && li.amount > 0) ?? [];
      if (lineItems.length > 0) {
        setItems(
          lineItems.map((li, idx) => ({
            seq: idx + 1,
            transactionType: MODE_TO_TX_TYPE[paymentMode] ?? "expense",
            accountId: null,
            description: li.description ?? "",
            amount: String(li.amount ?? ""),
            notes: "",
            ppnAmount: 0,
            ppnAccountId: null,
          })),
        );
      } else if (ocrResult.total_amount != null && ocrResult.total_amount > 0) {
        setItems([{
          seq: 1,
          transactionType: MODE_TO_TX_TYPE[paymentMode] ?? "expense",
          accountId: null,
          description: ocrResult.description ?? (ocrResult.vendor_name ? `Pembayaran ke ${ocrResult.vendor_name}` : ""),
          amount: String(ocrResult.total_amount),
          notes: "",
          ppnAmount: 0,
          ppnAccountId: null,
        }]);
      }
    }

    setOcrApplied(true);
    toast({ title: "Data OCR berhasil diterapkan ke form" });
  };

  // ── Quick-create vendor invoice from OCR data ──────────────────────────────
  const handleQuickCreateVendorInvoice = async () => {
    if (!ocrResult || !activeCompanyId) return;

    // Prefer explicit header totals from the OCR breakdown; fall back to the
    // legacy header total for invoices that do not have the new structure.
    const positiveLines = (ocrResult.line_items ?? []).filter((li) => (li.amount ?? 0) > 0);
    const derivedFromLines = positiveLines.reduce((s, li) => s + (li.amount ?? 0), 0);
    const breakdownTotals = ocrResult.invoice_breakdown?.totals;
    const grossTotal = (breakdownTotals?.gross != null && breakdownTotals.gross > 0)
      ? breakdownTotals.gross
      : (ocrResult.total_amount != null && ocrResult.total_amount > 0)
        ? ocrResult.total_amount
        : derivedFromLines;
    const headerVat = breakdownTotals?.ppn != null ? breakdownTotals.ppn : 0;
    const headerNet = breakdownTotals?.dpp != null ? breakdownTotals.dpp : grossTotal;
    const withholdingTaxAmount =
      ocrResult.invoice_breakdown?.withholding_tax?.amount ??
      breakdownTotals?.withholding_tax_amount ??
      0;

    if (grossTotal <= 0) {
      toast({ title: "Total invoice tidak ditemukan", description: "OCR tidak berhasil membaca jumlah invoice. Upload ulang file atau buat invoice manual.", variant: "destructive" });
      return;
    }

    setQuickCreating(true);
    try {
      const lines = positiveLines.map((li, idx) => ({
        name: li.description?.trim() || `Item ${idx + 1}`,
        quantity: 1,
        unit: "ls",
        unitCost: li.amount ?? 0,
        taxAmount: 0,
      }));

      const payload = {
        supplierName: ocrResult.vendor_name?.trim() || "Vendor tidak diketahui",
        vendorInvoiceRef: ocrResult.invoice_number ?? undefined,
        invoiceDate: ocrResult.invoice_date ?? new Date().toISOString().split("T")[0],
        paymentTermDays: 30,
        companyId: activeCompanyId,
        // Header values remain the accounting source of truth; OCR breakdown is
        // stored as supporting evidence for review and reminders.
        headerGross: grossTotal,
        headerVat,
        headerNet,
        dueDate: ocrResult.due_date ?? undefined,
        withholdingTaxAmount,
        invoiceBreakdown: ocrResult.invoice_breakdown ?? null,
        lines,
      };
      const createRes = await fetch("/api/purchase-workflow/vendor-invoices", {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      if (!createRes.ok) {
        const err = await createRes.json().catch(() => ({}));
        throw new Error((err as Record<string, string>).error ?? "Gagal membuat vendor invoice");
      }
      const vi = (await createRes.json()) as { id: number };
      const postRes = await fetch(`/api/purchase-workflow/vendor-invoices/${vi.id}/post?company=${activeCompanyId}`, {
        method: "POST",
        credentials: "include",
      });
      if (!postRes.ok) {
        const err = await postRes.json().catch(() => ({}));
        throw new Error((err as Record<string, string>).error ?? "Invoice dibuat tapi gagal diposting");
      }
      toast({ title: "Vendor invoice berhasil dibuat & diposting!", description: "Daftar invoice sedang diperbarui..." });
      // Refresh outstanding list
      setLoadingInvoices(true);
      const fresh = await fetchOutstandingInvoices();
      setOutstandingData(fresh);
    } catch (e) {
      toast({ title: "Gagal", description: e instanceof Error ? e.message : "Terjadi kesalahan", variant: "destructive" });
    } finally {
      setQuickCreating(false);
      setLoadingInvoices(false);
    }
  };

  useEffect(() => {
    if (!open) return;
    const mode = initialMode ?? "expense";
    setPaymentMode(mode);
    setItems([emptyItemForMode(mode)]);
  }, [open, initialMode]);

  useEffect(() => {
    if (paymentMode === "vendor_invoice") return;
    setItems([emptyItemForMode(paymentMode)]);
  }, [paymentMode]);

  useEffect(() => {
    if (!open || paymentMode !== "vendor_invoice") return;
    setLoadingInvoices(true);
    fetchOutstandingInvoices()
      .then((data) => {
        setOutstandingData(data);
        if (initialInvoiceIds && initialInvoiceIds.length > 0) {
          const preSelected: InvoicePaymentLine[] = data.invoices
            .filter((inv) => initialInvoiceIds.includes(inv.id) && inv.source === "purchase_document")
            .map((inv) => {
              const { dpp, taxAmount } = computeTaxBreakdown(inv.outstanding, "ppn");
              return {
                purchaseDocumentId: inv.id,
                vendorInvoiceId: null,
                lineKey: `purchase_document:${inv.id}`,
                docNumber: inv.billNumber ?? inv.docNumber,
                supplierName: inv.supplierName,
                outstanding: inv.outstanding,
                paymentAmount: inv.outstanding,
                whtAmount: 0,
                whtAccountId: null,
                taxTreatment: "bayar_berikut" as const,
                taxType: "ppn",
                dpp,
                taxAmount,
                expenseAccountId: null,
              };
            });
          setInvoiceLines(preSelected);
        }
      })
      .catch((e) => toast({ title: "Gagal memuat invoice outstanding", description: String(e), variant: "destructive" }))
      .finally(() => setLoadingInvoices(false));
  }, [open, paymentMode, fetchOutstandingInvoices, initialInvoiceIds, toast]);

  const handleItemChange = (idx: number, field: keyof DisbursementItem, value: string | number | null) => {
    setItems((prev) => {
      const next = [...prev];
      const updated = { ...next[idx]!, [field]: value };
      if (field === "transactionType") updated.accountId = null;
      next[idx] = updated;
      return next;
    });

    // Auto-fill header counterparty name from first line item's partyName
    // Only fills if: field is partyName, idx is 0, and header counterpartyName is still empty
    if (field === "partyName" && idx === 0 && typeof value === "string" && value.trim()) {
      setForm((prev) => {
        if (prev.counterpartyName) return prev; // don't overwrite if already set
        return { ...prev, counterpartyName: value };
      });
      // Also sync the cp search query display
      setCpSearchQuery("");
    }
  };

  const addItem = () => setItems((prev) => [...prev, { ...emptyItemForMode(paymentMode), seq: prev.length + 1 }]);
  const removeItem = (idx: number) => setItems((prev) => prev.filter((_, i) => i !== idx));

  const totalAmount = paymentMode === "vendor_invoice"
    ? invoiceLines.reduce((s, l) => s + l.paymentAmount, 0)
    : items.reduce((s, it) => s + Number(it.amount || 0), 0);

  const totalPPN = paymentMode === "vendor_invoice"
    ? 0
    : items.reduce((s, it) => s + (it.ppnAmount ?? 0), 0);

  const totalBayar = totalAmount + totalPPN;

  const whtAccounts = accountsByType["tax_payment"]?.filter((a) => a.type === "liability") ?? [];

  const handleSubmit = async () => {
    if (!form.journalId) { toast({ title: "Pilih jurnal bank/kas", variant: "destructive" }); return; }
    if (!form.date) { toast({ title: "Tanggal wajib diisi", variant: "destructive" }); return; }

    if (paymentMode === "vendor_invoice") {
      if (invoiceLines.length === 0) { toast({ title: "Pilih minimal satu invoice", variant: "destructive" }); return; }
      if (invoiceLines.some((l) => l.paymentAmount <= 0)) { toast({ title: "Jumlah bayar ke supplier setiap invoice harus > 0", variant: "destructive" }); return; }
      const imbalanced = invoiceLines.find((l) => Math.abs((l.paymentAmount + l.whtAmount) - l.outstanding) > 1);
      if (imbalanced) { toast({ title: `Invoice ${imbalanced.docNumber}: Supplier Dibayar + Pajak Dipotong ≠ Grand Total`, variant: "destructive" }); return; }
      if (invoiceLines.some((l) => l.paymentAmount <= 0)) { toast({ title: "Jumlah bayar setiap invoice harus > 0", variant: "destructive" }); return; }
       if (invoiceLines.some((l) => l.whtAmount > 0 && (!l.withholdingAllocations?.length || l.withholdingAllocations.some((allocation) => !allocation.liabilityAccountId)))) {
         toast({ title: "PPh harus memiliki alokasi liability per line", variant: "destructive" });
         return;
       }
    } else {
      if (items.some((it) => !it.accountId)) { toast({ title: "Semua item harus memilih akun", variant: "destructive" }); return; }
      if (items.some((it) => Number(it.amount) <= 0)) { toast({ title: "Jumlah setiap item harus > 0", variant: "destructive" }); return; }
    }

    setSaving(true);
    try {
      const counterpartyFields = {
        counterpartyName: form.counterpartyName || undefined,
        counterpartyType: form.counterpartyType || undefined,
        counterpartyId: form.counterpartyId ? Number(form.counterpartyId) : undefined,
      };

      if (paymentMode === "vendor_invoice") {
        await createDisb({
          journalId: Number(form.journalId),
          date: form.date,
          ref: form.ref || undefined,
          memo: form.memo || undefined,
          paymentType: "vendor_invoice",
          ...counterpartyFields,
          attachmentUrl: attachmentUrl || undefined,
          invoicePayments: invoiceLines.map((l) => ({
            purchaseDocumentId: l.purchaseDocumentId || undefined,
            vendorInvoiceId: l.vendorInvoiceId || undefined,
            paymentAmount: l.paymentAmount,
            whtAmount: l.whtAmount || undefined,
            whtAccountId: l.whtAccountId || undefined,
             withholdingAllocations: l.withholdingAllocations?.map((allocation) => ({
               lineTaxId: allocation.lineTaxId,
               invoiceLineId: allocation.invoiceLineId,
               amount: allocation.amount,
               liabilityAccountId: allocation.liabilityAccountId,
             })),
          })),
        });
      } else {
        await createDisb({
          journalId: Number(form.journalId),
          date: form.date,
          ref: form.ref || undefined,
          memo: form.memo || undefined,
          paymentType: "direct",
          ...counterpartyFields,
          attachmentUrl: attachmentUrl || undefined,
          items: items.map((it, i) => ({
            seq: i + 1,
            // loan_payment items already have per-item transactionType (loan_payment + expense for interest)
            transactionType: paymentMode === "loan_payment" ? it.transactionType : (MODE_TO_TX_TYPE[paymentMode] ?? it.transactionType),
            accountId: it.accountId,
            description: it.description || undefined,
            amount: Number(it.amount),
            notes: it.notes || undefined,
            partyName: it.partyName || undefined,
            ppnAmount: (it.ppnAmount ?? 0) > 0 ? it.ppnAmount : undefined,
            ppnAccountId: (it.ppnAmount ?? 0) > 0 ? it.ppnAccountId : undefined,
          })),
        });
      }
      toast({ title: "Bank Disbursement berhasil dibuat" });
      onCreated();
      onOpenChange(false);
      resetForm();
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : "Gagal menyimpan";
      toast({ title: msg, variant: "destructive" });
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={(v) => { if (!saving) { onOpenChange(v); if (!v) resetForm(); } }}>
      <DialogContent className="max-w-4xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <div className="flex items-center justify-between gap-3">
            <DialogTitle className="flex items-center gap-2">
              <ArrowUpRight className="h-5 w-5 text-orange-500" />
              Buat Bank Disbursement
            </DialogTitle>
            {/* OCR Import button */}
            <button
              type="button"
              disabled={ocrLoading || saving}
              onClick={() => ocrFileRef.current?.click()}
              className="flex items-center gap-1.5 rounded-lg border border-violet-300 bg-violet-50 px-3 py-1.5 text-xs font-medium text-violet-700 hover:bg-violet-100 disabled:opacity-50 transition-colors shrink-0"
            >
              {ocrLoading
                ? <><Loader2 className="h-3.5 w-3.5 animate-spin" />Menganalisis...</>
                : <><ScanText className="h-3.5 w-3.5" />Import via AI OCR</>}
            </button>
            <input
              ref={ocrFileRef}
              type="file"
              accept="image/*,.pdf"
              className="hidden"
              onChange={handleOcrFileChange}
            />
          </div>
        </DialogHeader>

        <div className="space-y-4">
          {/* OCR Result Preview Panel */}
          {ocrResult && (
            <div className={`rounded-xl border p-4 space-y-3 ${ocrApplied ? "border-green-300 bg-green-50" : "border-violet-300 bg-violet-50"}`}>
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <ScanText className={`h-4 w-4 ${ocrApplied ? "text-green-600" : "text-violet-600"}`} />
                  <span className={`text-sm font-semibold ${ocrApplied ? "text-green-700" : "text-violet-700"}`}>
                    {ocrApplied ? "Data OCR Diterapkan" : "Hasil Ekstraksi AI"}
                  </span>
                  {ocrResult.confidence != null && (
                    <span className="text-[10px] rounded-full bg-white border px-1.5 py-0.5 text-slate-500">
                      {Math.round(ocrResult.confidence * 100)}% yakin
                    </span>
                  )}
                </div>
                <div className="flex items-center gap-2">
                  {!ocrApplied && (
                    <button
                      type="button"
                      onClick={handleApplyOcr}
                      className="flex items-center gap-1 rounded-lg bg-violet-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-violet-700 transition-colors"
                    >
                      <CheckCheck className="h-3.5 w-3.5" />
                      Terapkan ke Form
                    </button>
                  )}
                  {ocrApplied && (
                    <span className="flex items-center gap-1 text-xs text-green-600 font-medium">
                      <CheckCheck className="h-3.5 w-3.5" />Diterapkan
                    </span>
                  )}
                  <button
                    type="button"
                    onClick={() => { setOcrResult(null); setOcrApplied(false); }}
                    className="rounded p-1 hover:bg-white/60 text-slate-400 hover:text-slate-600"
                  >
                    <X className="h-3.5 w-3.5" />
                  </button>
                </div>
              </div>

              {/* Extracted fields */}
              <div className="grid grid-cols-2 gap-x-6 gap-y-1.5 text-xs">
                {ocrResult.vendor_name && (
                  <div className="flex gap-2">
                    <span className="text-slate-400 shrink-0">Vendor</span>
                    <span className="font-medium text-slate-700 truncate">{ocrResult.vendor_name}</span>
                  </div>
                )}
                {ocrResult.invoice_number && (
                  <div className="flex gap-2">
                    <span className="text-slate-400 shrink-0">No. Dokumen</span>
                    <span className="font-mono font-medium text-slate-700">{ocrResult.invoice_number}</span>
                  </div>
                )}
                {ocrResult.invoice_date && (
                  <div className="flex gap-2">
                    <span className="text-slate-400 shrink-0">Tanggal</span>
                    <span className="font-medium text-slate-700">{ocrResult.invoice_date}</span>
                  </div>
                )}
                {ocrResult.total_amount != null && (
                  <div className="flex gap-2">
                    <span className="text-slate-400 shrink-0">Total</span>
                    <span className="font-semibold text-slate-800">
                      Rp {new Intl.NumberFormat("id-ID").format(ocrResult.total_amount)}
                    </span>
                  </div>
                )}
                {ocrResult.description && (
                  <div className="col-span-2 flex gap-2">
                    <span className="text-slate-400 shrink-0">Keterangan</span>
                    <span className="text-slate-600 truncate">{ocrResult.description}</span>
                  </div>
                )}
              </div>

              {/* Line items preview */}
              {ocrResult.line_items && ocrResult.line_items.length > 0 && (
                <div className="rounded-lg border border-white/60 bg-white/50 divide-y divide-slate-100">
                  {ocrResult.line_items.slice(0, 6).map((li, i) => (
                    <div key={i} className="flex items-center justify-between px-3 py-1.5 text-xs">
                      <span className="text-slate-600 truncate flex-1 mr-4">{li.description ?? `Item ${i + 1}`}</span>
                      {li.amount != null && (
                        <span className="font-mono font-medium text-slate-700 shrink-0">
                          Rp {new Intl.NumberFormat("id-ID").format(li.amount)}
                        </span>
                      )}
                    </div>
                  ))}
                  {ocrResult.line_items.length > 6 && (
                    <div className="px-3 py-1 text-[10px] text-slate-400">
                      +{ocrResult.line_items.length - 6} item lainnya
                    </div>
                  )}
                </div>
              )}
            </div>
          )}

          {/* Payment mode selector */}
          <div>
            <p className="text-xs font-semibold text-slate-500 mb-2 uppercase tracking-wide">Pilih Jenis Pembayaran</p>
            <div className="grid grid-cols-4 gap-2">
              {PAYMENT_MODES.map((pm) => (
                <button
                  key={pm.value}
                  type="button"
                  onClick={() => setPaymentMode(pm.value)}
                  className={`rounded-lg border p-2.5 text-left transition-colors ${paymentMode === pm.value ? "border-orange-400 bg-orange-50 shadow-sm" : "border-slate-200 hover:border-orange-200 hover:bg-orange-50/30"}`}
                >
                  <div className="flex items-center gap-1.5 mb-1">
                    <span className="text-base">{pm.icon}</span>
                    <span className={`text-xs font-semibold leading-tight ${paymentMode === pm.value ? "text-orange-700" : "text-slate-700"}`}>{pm.label}</span>
                  </div>
                  <p className="text-[10px] text-slate-400 leading-snug">{pm.desc}</p>
                </button>
              ))}
            </div>
          </div>

          {/* P1: Warning banner — redirect ke modul sumber untuk jenis pembayaran karyawan */}
          {paymentMode === "employee_advance" && (
            <div className="rounded-lg border border-violet-300 bg-violet-50 px-4 py-3 space-y-2">
              <div className="flex gap-2.5">
                <AlertTriangle className="h-4 w-4 text-violet-600 shrink-0 mt-0.5" />
                <div className="space-y-0.5 flex-1">
                  <p className="text-xs font-semibold text-violet-800">
                    Gunakan Modul Dana Karyawan untuk kasbon & talangan
                  </p>
                  <p className="text-[11px] text-violet-700 leading-relaxed">
                    Pencairan kasbon dan dana talangan dikelola melalui modul <strong>Dana Karyawan</strong>.
                    Dari sana Anda dapat membuat pengajuan, menyetujui, dan mencairkan dana — jurnal akuntansi
                    terbuat otomatis dan terintegrasi dengan saldo karyawan.
                  </p>
                </div>
              </div>
              <div className="flex items-center gap-2 pl-6">
                <Link href="/expense/dana-karyawan">
                  <Button size="sm" className="h-7 text-xs bg-violet-600 hover:bg-violet-700 text-white gap-1.5">
                    Buka Dana Karyawan
                    <ArrowUpRight className="h-3 w-3" />
                  </Button>
                </Link>
                <Link href="/expense/kasbon">
                  <Button variant="outline" size="sm" className="h-7 text-xs border-violet-300 text-violet-700 hover:bg-violet-100 gap-1">
                    Kasbon Karyawan
                  </Button>
                </Link>
                <Link href="/expense/talangan">
                  <Button variant="outline" size="sm" className="h-7 text-xs border-violet-300 text-violet-700 hover:bg-violet-100 gap-1">
                    Dana Talangan
                  </Button>
                </Link>
              </div>
            </div>
          )}

          {/* P0: Warning banner untuk jenis pembayaran lain yang restricted */}
          {(paymentMode === "expense" || paymentMode === "loan_payment" || paymentMode === "tax_payment") && (
            <div className="flex gap-2.5 rounded-lg border border-amber-300 bg-amber-50 px-4 py-3">
              <AlertTriangle className="h-4 w-4 text-amber-600 shrink-0 mt-0.5" />
              <div className="space-y-0.5">
                <p className="text-xs font-semibold text-amber-800">
                  {paymentMode === "expense" && "Gunakan modul Expense untuk membayar biaya yang sudah diajukan"}
                  {paymentMode === "loan_payment" && "Gunakan modul Pinjaman untuk membayar cicilan pinjaman"}
                  {paymentMode === "tax_payment" && "Disarankan: gunakan modul Pajak untuk membayar kewajiban pajak"}
                </p>
                <p className="text-[11px] text-amber-700 leading-relaxed">
                  {paymentMode === "expense" && "Bank Disbursement langsung untuk expense akan ditolak API jika tidak memiliki referensi expense yang disetujui. Buka menu Expense → Bayar untuk membayar."}
                  {paymentMode === "loan_payment" && "Bank Disbursement langsung untuk cicilan akan ditolak API jika tidak memiliki referensi pinjaman. Buka menu Pinjaman → Bayar Cicilan untuk membayar."}
                  {paymentMode === "tax_payment" && "Untuk akurasi SPT dan rekonsiliasi pajak, gunakan modul Pajak. Bank Disbursement langsung diperbolehkan selama P0."}
                </p>
              </div>
            </div>
          )}

          {/* Header fields */}
          <div className="grid grid-cols-2 gap-4">
            <div>
              <Label className="text-sm font-medium">Jurnal Bank/Kas <span className="text-red-500">*</span></Label>
              <Select value={form.journalId} onValueChange={(v) => setForm((p) => ({ ...p, journalId: v }))}>
                <SelectTrigger className="mt-1">
                  <SelectValue placeholder="Pilih jurnal..." />
                </SelectTrigger>
                <SelectContent>
                  {journals.map((j) => (
                    <SelectItem key={j.id} value={String(j.id)}>
                      <span className="font-mono text-xs text-slate-500 mr-2">{j.code}</span>
                      {j.name}
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
              <Input
                className="mt-1"
                placeholder="Opsional..."
                value={form.ref}
                onChange={(e) => setForm((p) => ({ ...p, ref: e.target.value }))}
              />
            </div>

            <div>
              <Label className="text-sm font-medium">Keterangan (Memo)</Label>
              <Input
                className="mt-1"
                placeholder="Catatan singkat..."
                value={form.memo}
                onChange={(e) => setForm((p) => ({ ...p, memo: e.target.value }))}
              />
            </div>
          </div>

          {/* Counterparty fields */}
          <div className="rounded-lg border border-slate-200 bg-slate-50 p-3 space-y-3">
            <p className="text-xs font-semibold text-slate-500 uppercase tracking-wide">Pihak Lawan Transaksi (Opsional)</p>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label className="text-xs font-medium text-slate-600 mb-1 block">Kategori Pihak</Label>
                <Select
                  value={form.counterpartyType}
                  onValueChange={(v) => {
                    setForm((p) => ({ ...p, counterpartyType: v, counterpartyName: "", counterpartyId: "" }));
                    setCpSearchQuery("");
                    setCpSearchResults([]);
                    setCpDropdownOpen(false);
                  }}
                >
                  <SelectTrigger className="h-8 text-sm"><SelectValue placeholder="Pilih kategori..." /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="supplier">Supplier / Vendor</SelectItem>
                    <SelectItem value="employee">Karyawan</SelectItem>
                    <SelectItem value="bank">Bank / Lembaga Keuangan</SelectItem>
                    <SelectItem value="government">Pemerintah / Pajak</SelectItem>
                    <SelectItem value="shareholder">Pemegang Saham</SelectItem>
                    <SelectItem value="other">Lainnya</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div ref={cpSearchRef} className="relative">
                <Label className="text-xs font-medium text-slate-600 mb-1 block">Nama / Perusahaan</Label>
                {(form.counterpartyType === "supplier" || form.counterpartyType === "employee") ? (
                  <>
                    <div className="relative">
                      <Input
                        className="h-8 text-sm pr-7"
                        placeholder={form.counterpartyType === "supplier" ? "Cari nama supplier..." : "Cari nama karyawan..."}
                        value={form.counterpartyName || cpSearchQuery}
                        onChange={(e) => {
                          const v = e.target.value;
                          setCpSearchQuery(v);
                          setForm((p) => ({ ...p, counterpartyName: v, counterpartyId: "" }));
                          if (!v) { setCpSearchResults([]); setCpDropdownOpen(false); }
                        }}
                        onFocus={() => {
                          if (cpSearchResults.length > 0) setCpDropdownOpen(true);
                        }}
                        autoComplete="off"
                      />
                      {cpSearching && (
                        <Loader2 className="absolute right-2 top-1.5 h-4 w-4 animate-spin text-slate-400" />
                      )}
                      {form.counterpartyName && !cpSearching && (
                        <button
                          type="button"
                          className="absolute right-2 top-1.5 text-slate-400 hover:text-slate-600"
                          onClick={() => {
                            setForm((p) => ({ ...p, counterpartyName: "", counterpartyId: "" }));
                            setCpSearchQuery("");
                            setCpSearchResults([]);
                            setCpDropdownOpen(false);
                          }}
                        >
                          <X className="h-4 w-4" />
                        </button>
                      )}
                    </div>
                    {cpDropdownOpen && cpSearchResults.length > 0 && (
                      <div className="absolute z-50 left-0 right-0 mt-1 bg-white border border-slate-200 rounded-lg shadow-lg max-h-52 overflow-y-auto">
                        {cpSearchResults.map((item) => (
                          <button
                            key={item.id}
                            type="button"
                            className="w-full text-left px-3 py-2 text-sm hover:bg-orange-50 hover:text-orange-700 transition-colors flex items-center gap-2"
                            onMouseDown={(e) => {
                              e.preventDefault();
                              setForm((p) => ({ ...p, counterpartyName: item.name, counterpartyId: item.id }));
                              setCpSearchQuery("");
                              setCpSearchResults([]);
                              setCpDropdownOpen(false);
                            }}
                          >
                            <span className="text-slate-400 text-xs">#</span>
                            {item.name}
                          </button>
                        ))}
                      </div>
                    )}
                    {form.counterpartyId && (
                      <p className="text-[10px] text-green-600 mt-0.5 flex items-center gap-1">
                        <CheckCircle2 className="h-3 w-3" /> Dipilih dari data Supabase
                      </p>
                    )}
                  </>
                ) : (
                  <Input
                    className="h-8 text-sm"
                    placeholder="Nama vendor, karyawan, bank..."
                    value={form.counterpartyName}
                    onChange={(e) => setForm((p) => ({ ...p, counterpartyName: e.target.value }))}
                  />
                )}
              </div>
            </div>
          </div>

          {/* Vendor invoice panel */}
          {paymentMode === "vendor_invoice" && (
            <div>
              <Label className="text-sm font-semibold mb-2 block">Invoice Vendor Outstanding</Label>

              {/* Quick-create from OCR — only shown when OCR data is already applied */}
              {ocrApplied && ocrResult && (outstandingData?.invoices ?? []).length === 0 && !loadingInvoices && (
                <div className="mb-3 flex items-center gap-3 rounded-xl px-4 py-3 bg-indigo-50 border border-indigo-200">
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-semibold text-indigo-800">Data OCR sudah tersedia — buat Vendor Invoice langsung?</p>
                    <p className="text-xs text-indigo-600 mt-0.5 truncate">
                      {ocrResult.vendor_name ?? "Vendor"} · {ocrResult.invoice_number ?? "—"} · Rp {(ocrResult.total_amount ?? 0).toLocaleString("id-ID")}
                    </p>
                  </div>
                  <button
                    type="button"
                    disabled={quickCreating}
                    onClick={handleQuickCreateVendorInvoice}
                    className="shrink-0 inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-semibold text-white bg-indigo-600 hover:bg-indigo-700 disabled:opacity-60 transition-colors"
                  >
                    {quickCreating ? (
                      <><Loader2 className="h-3.5 w-3.5 animate-spin" />Membuat...</>
                    ) : (
                      <><Send className="h-3.5 w-3.5" />Buat &amp; Post Invoice</>
                    )}
                  </button>
                </div>
              )}

              {loadingInvoices ? (
                <div className="flex justify-center py-8"><Loader2 className="h-5 w-5 animate-spin text-slate-400" /></div>
              ) : (
                <VendorInvoicePanel
                  allInvoices={outstandingData?.invoices ?? []}
                  allSuppliers={outstandingData?.suppliers}
                  apAccountName={outstandingData?.apAccountName ?? null}
                  lines={invoiceLines}
                  onLinesChange={setInvoiceLines}
                  whtAccounts={whtAccounts}
                  allAccounts={allAccounts}
                  selectedVendorId={selectedVendorIdForPanel}
                  onSelectedVendorIdChange={setSelectedVendorIdForPanel}
                  onSupplierCreated={(s) => {
                    // Inject new supplier into outstanding data so the combobox shows it immediately
                    setOutstandingData((prev) =>
                      prev ? { ...prev, suppliers: [...(prev.suppliers ?? []), s] } : prev
                    );
                    setSelectedVendorIdForPanel(`id_${s.id}`);
                  }}
                />
              )}
            </div>
          )}

          {/* Smart panel — Kasbon Karyawan */}
          {paymentMode === "employee_advance" && (
            <div>
              <Label className="text-sm font-semibold mb-3 block">Kasbon Karyawan</Label>
              <EmployeeAdvancePanel
                key="employee_advance"
                accounts={accountsByType.employee_advance ?? []}
                allAccounts={allAccounts}
                items={items}
                onItemsChange={setItems}
                employees={employees}
                initialRecipientName={initialEmployeeName}
              />
            </div>
          )}

          {/* Smart panel — Transfer Dana */}
          {paymentMode === "fund_transfer" && (
            <div>
              <Label className="text-sm font-semibold mb-3 block">Transfer Dana Antar Rekening</Label>
              <FundTransferPanel
                key="fund_transfer"
                accounts={accountsByType.fund_transfer ?? []}
                allAccounts={allAccounts}
                items={items}
                onItemsChange={setItems}
                journals={journals}
                selectedJournalId={form.journalId}
              />
            </div>
          )}

          {/* Smart panel — Pembayaran Pajak */}
          {paymentMode === "tax_payment" && (
            <div>
              <Label className="text-sm font-semibold mb-3 block">Pembayaran Pajak</Label>
              <TaxPaymentPanel
                key="tax_payment"
                accounts={accountsByType.tax_payment ?? []}
                allAccounts={allAccounts}
                items={items}
                onItemsChange={setItems}
              />
            </div>
          )}

          {/* Smart panel — Cicilan Pinjaman */}
          {paymentMode === "loan_payment" && (
            <div>
              <Label className="text-sm font-semibold mb-3 block">Cicilan Pinjaman</Label>
              <LoanPaymentPanel
                key="loan_payment"
                accounts={accountsByType.loan_payment ?? []}
                expenseAccounts={accountsByType.expense ?? []}
                allAccounts={allAccounts}
                items={items}
                onItemsChange={setItems}
              />
            </div>
          )}

          {/* Smart panel — Penarikan Modal */}
          {paymentMode === "equity_withdrawal" && (
            <div>
              <Label className="text-sm font-semibold mb-3 block">Penarikan Modal</Label>
              <EquityWithdrawalPanel
                key="equity_withdrawal"
                accounts={accountsByType.equity_withdrawal ?? []}
                allAccounts={allAccounts}
                items={items}
                onItemsChange={setItems}
              />
            </div>
          )}

          {/* Generic line items — expense + other only */}
          {(paymentMode === "expense" || paymentMode === "other") && (
            <div>
              <div className="flex items-center justify-between mb-2">
                <Label className="text-sm font-semibold">
                  {PAYMENT_MODES.find((m) => m.value === paymentMode)?.label ?? "Item Pengeluaran"}
                </Label>
                <Button variant="outline" size="sm" onClick={addItem} className="h-7 text-xs gap-1">
                  <Plus className="h-3.5 w-3.5" /> Tambah Item
                </Button>
              </div>

              <div className="space-y-2">
                {items.map((item, idx) => (
                  <LineItemRow
                    key={idx}
                    item={item}
                    idx={idx}
                    accounts={accountsByType[MODE_TO_TX_TYPE[paymentMode] ?? item.transactionType] ?? accountsByType[item.transactionType] ?? []}
                    allAccounts={allAccounts}
                    onChange={handleItemChange}
                    onRemove={removeItem}
                    canRemove={items.length > 1}
                    hideTransactionType={paymentMode !== "other"}
                  />
                ))}
              </div>

              <JournalPreview items={items} allAccounts={allAccounts} />
            </div>
          )}

          {/* Total */}
          <div className="flex justify-end pr-2">
            <div className="text-right space-y-0.5">
              {totalPPN > 0 ? (
                <>
                  <p className="text-xs text-slate-500">DPP: <span className="font-medium text-slate-700">Rp {fmt(totalAmount)}</span></p>
                  <p className="text-xs text-slate-500">PPN: <span className="font-medium text-blue-700">Rp {fmt(totalPPN)}</span></p>
                  <div className="border-t border-slate-200 pt-0.5 mt-0.5">
                    <p className="text-[10px] text-slate-400">Total Bayar (incl. PPN)</p>
                    <p className="text-xl font-bold text-slate-800">Rp {fmt(totalBayar)}</p>
                  </div>
                </>
              ) : (
                <>
                  <p className="text-xs text-slate-500">Total Pengeluaran</p>
                  <p className="text-xl font-bold text-slate-800">Rp {fmt(totalAmount)}</p>
                </>
              )}
            </div>
          </div>
        </div>

        {/* ── Bukti Pembayaran Upload ── */}
        <div className="border rounded-lg p-4 space-y-3 bg-slate-50">
          <p className="text-sm font-semibold text-slate-700">Bukti Pembayaran <span className="font-normal text-slate-400">(opsional)</span></p>
          <div className="flex items-start gap-3">
            <button
              type="button"
              onClick={() => attachmentRef.current?.click()}
              disabled={isUploadingAttachment}
              className="flex items-center gap-2 px-3 py-2 text-sm rounded-md border border-dashed border-slate-300 hover:border-orange-400 hover:bg-orange-50 transition-colors text-slate-600 disabled:opacity-50"
            >
              {isUploadingAttachment ? (
                <><Loader2 className="h-4 w-4 animate-spin" />Mengupload...</>
              ) : (
                <><FileText className="h-4 w-4" />{attachmentFile ? "Ganti File" : "Pilih File (PDF/Gambar)"}</>
              )}
            </button>
            {attachmentFile && !isUploadingAttachment && (
              <button
                type="button"
                onClick={() => {
                  setAttachmentFile(null);
                  if (attachmentPreview) URL.revokeObjectURL(attachmentPreview);
                  setAttachmentPreview(null);
                  setAttachmentUrl(null);
                }}
                className="p-1.5 rounded hover:bg-red-50 text-slate-400 hover:text-red-500 transition-colors"
              >
                <X className="h-4 w-4" />
              </button>
            )}
          </div>
          <input
            ref={attachmentRef}
            type="file"
            accept="image/jpeg,image/png,image/webp,application/pdf"
            className="hidden"
            onChange={handleAttachmentChange}
          />
          {/* Preview */}
          {attachmentFile && (
            <div className="flex items-center gap-3">
              {attachmentPreview ? (
                <img
                  src={attachmentPreview}
                  alt="Preview bukti"
                  className="h-24 w-24 object-cover rounded-md border shadow-sm"
                />
              ) : (
                <div className="flex items-center gap-2 p-3 rounded-md border bg-white text-sm text-slate-600">
                  <FileText className="h-5 w-5 text-orange-400" />
                  <span className="truncate max-w-[200px]">{attachmentFile.name}</span>
                </div>
              )}
              <div className="text-xs text-slate-500">
                {attachmentUrl ? (
                  <span className="text-green-600 font-medium flex items-center gap-1">
                    <CheckCircle2 className="h-3.5 w-3.5" />Upload berhasil
                  </span>
                ) : isUploadingAttachment ? (
                  <span className="text-orange-500">Mengupload...</span>
                ) : (
                  <span className="text-red-500">Upload gagal</span>
                )}
              </div>
            </div>
          )}
        </div>

        <DialogFooter className="gap-2">
          <Button variant="outline" onClick={() => { onOpenChange(false); resetForm(); }} disabled={saving}>
            Batal
          </Button>
          <Button onClick={handleSubmit} disabled={saving || isUploadingAttachment} className="bg-orange-500 hover:bg-orange-600">
            {saving ? <><Loader2 className="h-4 w-4 mr-2 animate-spin" />Menyimpan...</> : "Simpan & Post Jurnal"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Detail Drawer
// ─────────────────────────────────────────────────────────────────────────────

interface DisbDetailItem {
  id: number; seq: number; transactionType: string; accountId: number | null;
  description: string | null; amount: number; notes: string | null;
}

interface DisbDetail extends Disbursement {
  items?: DisbDetailItem[];
  entry?: {
    id: number; description: string | null; date: string;
    lines?: Array<{ id: number; accountId: number; debit: string; credit: string; description: string | null }>;
  };
  voidReason?: string | null;
  attachmentUrl?: string | null;
}

function DisbDetailDialog({
  disbId, onClose, fetchDetail, onVoid,
}: {
  disbId: number | null;
  onClose: () => void;
  fetchDetail: (id: number) => Promise<DisbDetail>;
  onVoid: (id: number) => void;
}) {
  const [data, setData] = useState<DisbDetail | null>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!disbId) { setData(null); return; }
    setLoading(true);
    fetchDetail(disbId).then(setData).catch(console.error).finally(() => setLoading(false));
  }, [disbId, fetchDetail]);

  if (!disbId) return null;

  return (
    <Dialog open={!!disbId} onOpenChange={(v) => { if (!v) onClose(); }}>
      <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <ArrowUpRight className="h-5 w-5 text-orange-500" />
            Detail Disbursement {data?.disbursementNumber ?? `#${disbId}`}
          </DialogTitle>
        </DialogHeader>

        {loading && (
          <div className="flex justify-center py-8">
            <Loader2 className="h-6 w-6 animate-spin text-slate-400" />
          </div>
        )}

        {data && (
          <div className="space-y-4">
            {/* Header */}
            <div className="grid grid-cols-2 gap-3 text-sm">
              <div><span className="text-slate-500">Tanggal:</span> <strong>{data.date}</strong></div>
              <div><span className="text-slate-500">Status:</span> <StatusBadge status={data.status} /></div>
              <div><span className="text-slate-500">Referensi:</span> {data.ref ?? "-"}</div>
              <div><span className="text-slate-500">Total:</span> <strong>Rp {fmt(data.totalAmount)}</strong></div>
              {data.memo && <div className="col-span-2"><span className="text-slate-500">Memo:</span> {data.memo}</div>}
              {data.voidReason && (
                <div className="col-span-2 text-red-600 text-xs bg-red-50 rounded p-2">
                  Alasan void: {data.voidReason}
                </div>
              )}
            </div>

            {/* Bukti Pembayaran */}
            {data.attachmentUrl && (
              <div className="border rounded-lg p-3 space-y-2">
                <p className="text-sm font-semibold text-slate-700">Bukti Pembayaran</p>
                {/\.(jpe?g|png|webp|gif)(\?|$)/i.test(data.attachmentUrl) ? (
                  <a href={data.attachmentUrl} target="_blank" rel="noopener noreferrer">
                    <img
                      src={data.attachmentUrl}
                      alt="Bukti pembayaran"
                      className="max-h-64 rounded-md border object-contain cursor-zoom-in hover:opacity-90 transition-opacity"
                    />
                  </a>
                ) : (
                  <a
                    href={data.attachmentUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="flex items-center gap-2 p-3 rounded-md border bg-slate-50 text-sm text-orange-600 hover:bg-orange-50 transition-colors"
                  >
                    <FileText className="h-5 w-5 flex-shrink-0" />
                    <span className="truncate">Buka Dokumen (PDF)</span>
                    <ArrowUpRight className="h-4 w-4 flex-shrink-0 ml-auto" />
                  </a>
                )}
              </div>
            )}

            {/* Items */}
            {data.items && data.items.length > 0 && (
              <div>
                <p className="text-sm font-semibold mb-2">Item Pengeluaran</p>
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead className="w-8">#</TableHead>
                      <TableHead>Jenis</TableHead>
                      <TableHead>Keterangan</TableHead>
                      <TableHead className="text-right">Jumlah</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {data.items.map((it) => {
                      const typeInfo = TRANSACTION_TYPES.find((t) => t.value === it.transactionType);
                      return (
                        <TableRow key={it.id}>
                          <TableCell className="text-xs text-slate-400">{it.seq}</TableCell>
                          <TableCell>
                            <div className="text-xs font-medium">{typeInfo?.label ?? it.transactionType}</div>
                            <div className="text-xs text-slate-400">{typeInfo?.desc}</div>
                          </TableCell>
                          <TableCell className="text-sm">{it.description ?? "-"}</TableCell>
                          <TableCell className="text-right font-mono text-sm">Rp {fmt(it.amount)}</TableCell>
                        </TableRow>
                      );
                    })}
                    <TableRow className="bg-slate-50 font-semibold">
                      <TableCell colSpan={3} className="text-right text-sm">Total</TableCell>
                      <TableCell className="text-right font-mono text-sm">Rp {fmt(data.totalAmount)}</TableCell>
                    </TableRow>
                  </TableBody>
                </Table>
              </div>
            )}

            {/* Journal Entry */}
            {data.entry && (
              <div>
                <p className="text-sm font-semibold mb-2">Jurnal Akuntansi (Entry #{data.entry.id})</p>
                <div className="rounded-lg border bg-slate-50 p-3">
                  <p className="text-xs text-slate-500 mb-2">{data.entry.description}</p>
                  <div className="space-y-1 font-mono text-xs">
                    {data.entry.lines?.map((l) => (
                      <div key={l.id} className="flex justify-between gap-4">
                        <span className={Number(l.debit) > 0 ? "text-slate-700" : "text-slate-400 pl-6"}>
                          {Number(l.debit) > 0 ? "DR" : "CR"} {l.description}
                        </span>
                        <span className="text-slate-700">
                          {Number(l.debit) > 0 ? fmt(Number(l.debit)) : fmt(Number(l.credit))}
                        </span>
                      </div>
                    ))}
                  </div>
                </div>
              </div>
            )}
          </div>
        )}

        {/* Phase 12: AI Review cross-link — non-blocking read-only panel */}
        {data && (
          <div className="px-1 pb-1">
            <AIReviewSourcePanel
              source="VENDOR_PAYMENT"
              sourceRecordId={String(disbId)}
              transactionSnapshot={{
                id: String(disbId),
                description: data.memo ?? data.ref ?? `Disbursement #${disbId}`,
                amount: data.totalAmount,
                direction: 'DEBIT',
                transactionDate: data.date,
                referenceNumber: data.ref ?? undefined,
              }}
            />
          </div>
        )}
        <DialogFooter className="gap-2">
          {data?.status === "posted" && (
            <Button
              variant="outline"
              className="border-red-200 text-red-600 hover:bg-red-50"
              onClick={() => { onVoid(disbId); onClose(); }}
            >
              <Ban className="h-4 w-4 mr-2" /> Void
            </Button>
          )}
          <Button variant="outline" onClick={onClose}>Tutup</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Void Dialog
// ─────────────────────────────────────────────────────────────────────────────

function VoidDialog({
  disbId, onClose, onConfirm,
}: { disbId: number | null; onClose: () => void; onConfirm: (reason: string) => void }) {
  const [reason, setReason] = useState("");
  const [loading, setLoading] = useState(false);

  const handleConfirm = async () => {
    if (!reason.trim()) return;
    setLoading(true);
    try { await onConfirm(reason); } finally { setLoading(false); setReason(""); }
  };

  return (
    <Dialog open={!!disbId} onOpenChange={(v) => { if (!v) { onClose(); setReason(""); } }}>
      <DialogContent className="max-w-sm">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 text-red-600">
            <Ban className="h-5 w-5" /> Void Disbursement
          </DialogTitle>
        </DialogHeader>
        <p className="text-sm text-slate-600">Tindakan ini akan membuat jurnal pembalik dan tidak bisa dibatalkan.</p>
        <div>
          <Label className="text-sm font-medium">Alasan Void <span className="text-red-500">*</span></Label>
          <Textarea
            className="mt-1"
            placeholder="Tuliskan alasan void..."
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            rows={3}
          />
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={loading}>Batal</Button>
          <Button
            className="bg-red-600 hover:bg-red-700"
            disabled={!reason.trim() || loading}
            onClick={handleConfirm}
          >
            {loading ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : null}
            Konfirmasi Void
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Treasury Dashboard — widget sub-components
// ─────────────────────────────────────────────────────────────────────────────

function SummaryCard({
  icon: Icon,
  label,
  value,
  sub,
  color = "slate",
  loading,
}: {
  icon: React.ElementType;
  label: string;
  value: string;
  sub?: string;
  color?: "slate" | "green" | "orange" | "red" | "blue";
  loading?: boolean;
}) {
  const colorMap = {
    slate: "bg-slate-50 text-slate-600 border-slate-200",
    green: "bg-green-50 text-green-700 border-green-200",
    orange: "bg-orange-50 text-orange-700 border-orange-200",
    red: "bg-red-50 text-red-700 border-red-200",
    blue: "bg-blue-50 text-blue-700 border-blue-200",
  };
  const iconColor = {
    slate: "text-slate-400",
    green: "text-green-500",
    orange: "text-orange-500",
    red: "text-red-500",
    blue: "text-blue-500",
  };
  return (
    <Card className={`border ${colorMap[color]}`}>
      <CardContent className="p-4">
        <div className="flex items-start justify-between gap-2 mb-2">
          <p className="text-xs font-medium text-current opacity-70">{label}</p>
          <Icon className={`h-4 w-4 shrink-0 ${iconColor[color]}`} />
        </div>
        {loading ? (
          <div className="h-7 w-24 bg-current/10 rounded animate-pulse" />
        ) : (
          <p className="text-xl font-bold font-mono leading-tight">{value}</p>
        )}
        {sub && <p className="text-[11px] opacity-60 mt-1">{sub}</p>}
      </CardContent>
    </Card>
  );
}

function OutstandingCard({
  icon: Icon,
  label,
  count,
  total,
  badgeColor = "orange",
  loading,
  onClick,
}: {
  icon: React.ElementType;
  label: string;
  count: number;
  total: number;
  badgeColor?: "orange" | "red" | "blue" | "yellow";
  loading?: boolean;
  onClick?: () => void;
}) {
  const badgeClass = {
    orange: "bg-orange-100 text-orange-700 border-orange-200",
    red: "bg-red-100 text-red-700 border-red-200",
    blue: "bg-blue-100 text-blue-700 border-blue-200",
    yellow: "bg-yellow-100 text-yellow-700 border-yellow-200",
  }[badgeColor];

  return (
    <Card
      className={`border-slate-200 hover:border-slate-300 transition-all ${onClick ? "cursor-pointer hover:shadow-sm" : ""}`}
      onClick={onClick}
    >
      <CardContent className="p-4">
        <div className="flex items-center gap-2 mb-3">
          <div className="p-1.5 bg-slate-100 rounded-md">
            <Icon className="h-4 w-4 text-slate-500" />
          </div>
          <p className="text-xs font-medium text-slate-600">{label}</p>
        </div>
        {loading ? (
          <div className="space-y-1.5">
            <div className="h-6 w-16 bg-slate-100 rounded animate-pulse" />
            <div className="h-4 w-28 bg-slate-100 rounded animate-pulse" />
          </div>
        ) : (
          <>
            <div className="flex items-end gap-2 mb-1">
              <span className={`text-xs font-semibold px-2 py-0.5 rounded-full border ${badgeClass}`}>
                {count} item
              </span>
            </div>
            <p className="text-sm font-bold text-slate-800 font-mono">Rp {fmt(total)}</p>
          </>
        )}
      </CardContent>
    </Card>
  );
}

const QUICK_ACTIONS = [
  {
    mode: "vendor_invoice" as PaymentMode,
    icon: Building2,
    label: "Bayar Invoice Vendor",
    desc: "Pembayaran hutang ke supplier",
    color: "border-blue-200 hover:bg-blue-50 hover:border-blue-300",
    iconColor: "text-blue-600",
    bgColor: "bg-blue-50",
  },
  {
    mode: "expense" as PaymentMode,
    icon: ReceiptText,
    label: "Pengeluaran Langsung",
    desc: "Beban operasional, utilitas, dll",
    color: "border-orange-200 hover:bg-orange-50 hover:border-orange-300",
    iconColor: "text-orange-600",
    bgColor: "bg-orange-50",
  },
  {
    mode: "employee_advance" as PaymentMode,
    icon: PiggyBank,
    label: "Kasbon",
    desc: "Uang muka karyawan",
    color: "border-purple-200 hover:bg-purple-50 hover:border-purple-300",
    iconColor: "text-purple-600",
    bgColor: "bg-purple-50",
  },
  {
    mode: "fund_transfer" as PaymentMode,
    icon: Send,
    label: "Transfer Dana",
    desc: "Pindah antar rekening",
    color: "border-green-200 hover:bg-green-50 hover:border-green-300",
    iconColor: "text-green-600",
    bgColor: "bg-green-50",
  },
  {
    mode: "tax_payment" as PaymentMode,
    icon: FileCheck,
    label: "Pembayaran Pajak",
    desc: "PPh, PPN, dan pajak lainnya",
    color: "border-red-200 hover:bg-red-50 hover:border-red-300",
    iconColor: "text-red-600",
    bgColor: "bg-red-50",
  },
];

// ─────────────────────────────────────────────────────────────────────────────
// Main Page
// ─────────────────────────────────────────────────────────────────────────────

export default function BankDisbursementsPage() {
  const { toast } = useToast();
  const { activeCompanyId } = useCompany();
  const [location] = useLocation();
  const api = useApi(activeCompanyId);

  const [journals, setJournals] = useState<Journal[]>([]);
  const [allAccounts, setAllAccounts] = useState<CoacAccount[]>([]);
  const [accountsByType, setAccountsByType] = useState<Record<string, CoacAccount[]>>({});

  const [loading, setLoading] = useState(false);
  const [dashLoading, setDashLoading] = useState(true);
  const [createOpen, setCreateOpen] = useState(false);
  const [detailId, setDetailId] = useState<number | null>(null);
  const [voidId, setVoidId] = useState<number | null>(null);
  const [initialMode, setInitialMode] = useState<PaymentMode | undefined>(undefined);
  const [initialInvoiceIds, setInitialInvoiceIds] = useState<number[]>([]);
  const [initialEmployeeName, setInitialEmployeeName] = useState<string | null | undefined>(undefined);

  const [treasury, setTreasury] = useState<TreasurySummaryResponse | null>(null);
  const [showAllQueue, setShowAllQueue] = useState(false);

  // ── Vendor filter (list disbursements) ────────────────────────────────────
  const [vendors, setVendors] = useState<{ id: number; name: string }[]>([]);
  const [filterVendorId, setFilterVendorId] = useState<number | null>(null);
  const [disbList, setDisbList] = useState<Disbursement[]>([]);
  const [disbLoading, setDisbLoading] = useState(false);

  // ── Load treasury summary ──────────────────────────────────────────────
  const loadTreasury = useCallback(async () => {
    if (!activeCompanyId) return;
    setDashLoading(true);
    try {
      const data = await api.fetchSummary();
      setTreasury(data);
    } catch (err) {
      console.error("Treasury summary error:", err);
    } finally {
      setDashLoading(false);
    }
  }, [api, activeCompanyId]);

  // ── Load form data (journals, accounts) ──────────────────────────────────
  const loadFormData = useCallback(async () => {
    if (!activeCompanyId) return;
    setLoading(true);
    try {
      const [jrnls, accts] = await Promise.all([
        api.fetchJournals(),
        api.fetchAccounts(),
      ]);
      setJournals(jrnls);
      setAllAccounts(accts);

      const [expenseAccts, kasbonAccts, cashBankAccts, supplierPaymentAccts, taxPaymentAccts, loanAccts, equityAccts] = await Promise.all([
        api.fetchAccounts("expense"),
        api.fetchAccounts(undefined, undefined, "employee_advance"),
        api.fetchAccounts("asset", "cash_bank"),
        api.fetchAccounts(undefined, undefined, "supplier_payment"),
        api.fetchAccounts(undefined, undefined, "tax_payment"),
        api.fetchAccounts(undefined, undefined, "loan_payment"),
        api.fetchAccounts(undefined, undefined, "equity_withdrawal"),
      ]);
      setAccountsByType({
        expense: expenseAccts,
        supplier_payment: supplierPaymentAccts,
        tax_payment: taxPaymentAccts,
        employee_advance: kasbonAccts,
        fund_transfer: cashBankAccts,
        loan_payment: loanAccts,
        equity_withdrawal: equityAccts,
        other: accts,
      });
    } catch (err) {
      console.error(err);
    } finally {
      setLoading(false);
    }
  }, [api, activeCompanyId]);

  useEffect(() => {
    if (activeCompanyId) {
      loadTreasury();
      loadFormData();
      api.fetchVendors().then(setVendors).catch(() => {});
    }
  }, [activeCompanyId, api, loadFormData, loadTreasury]);

  // ── Load disbursements list (dengan filter vendor) ────────────────────────
  const loadDisbList = useCallback(async () => {
    if (!activeCompanyId) return;
    setDisbLoading(true);
    try {
      const data = await api.fetchDisbs(filterVendorId);
      setDisbList(data);
    } catch (err) {
      console.error(err);
    } finally {
      setDisbLoading(false);
    }
  }, [api, activeCompanyId, filterVendorId]);

  useEffect(() => {
    if (activeCompanyId) loadDisbList();
  }, [activeCompanyId, filterVendorId, loadDisbList]);

  // ── URL params: auto-open create dialog ───────────────────────────────────
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const mode = params.get("mode") as PaymentMode | null;
    const invoiceIdsRaw = params.getAll("invoiceIds").concat(params.getAll("invoiceIds[]"));
    const invoiceIds = invoiceIdsRaw.map(Number).filter(Boolean);
    const validModes: PaymentMode[] = ["vendor_invoice", "expense", "employee_advance", "fund_transfer", "tax_payment", "loan_payment", "equity_withdrawal", "other"];
    if (mode && validModes.includes(mode)) {
      setInitialMode(mode);
      setInitialInvoiceIds(invoiceIds);
      setCreateOpen(true);
      window.history.replaceState({}, "", window.location.pathname);
    }
  }, [location]);

  // ── Void ────────────────────────────────────────────────────────────────
  const handleVoid = async (reason: string) => {
    if (!voidId) return;
    try {
      await api.voidDisb(voidId, reason);
      toast({ title: "Disbursement berhasil di-void" });
      setVoidId(null);
      loadTreasury();
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : "Gagal void";
      toast({ title: msg, variant: "destructive" });
    }
  };

  const handleCreateSuccess = () => {
    loadTreasury();
    loadDisbList();
  };

  const openAction = (mode: PaymentMode, ids?: number[], employeeName?: string | null) => {
    setInitialMode(mode);
    setInitialInvoiceIds(ids ?? []);
    setInitialEmployeeName(employeeName);
    setCreateOpen(true);
  };

  const summary = treasury?.summary;
  const outstanding = treasury?.outstanding;
  const queue = treasury?.queue ?? [];
  const visibleQueue = showAllQueue ? queue : queue.slice(0, 5);

  const fmtRp = (n: number) => `Rp ${fmt(n)}`;

  return (
    <AppShell>
      <div className="max-w-7xl mx-auto px-4 py-6 space-y-6">
        <Button variant="ghost" size="sm" className="-ml-2" onClick={() => window.history.back()}>
          <ArrowLeft className="h-4 w-4 mr-1" />Kembali
        </Button>

        {/* ── Header ──────────────────────────────────────────────────── */}
        <div className="flex items-center justify-between flex-wrap gap-3">
          <div>
            <h1 className="text-2xl font-black text-slate-900 flex items-center gap-2">
              <LayoutDashboard className="h-6 w-6 text-orange-500" />
              Treasury Dashboard
            </h1>
            <p className="text-slate-500 text-sm mt-0.5">
              Pusat kontrol keuangan — semua pembayaran keluar diproses dari sini
            </p>
          </div>
          <div className="flex items-center gap-2 flex-wrap">
            <Link href="/accounting/cash-flow-forecast">
              <Button variant="outline" size="sm" className="gap-1.5 text-emerald-700 border-emerald-200 hover:bg-emerald-50">
                <TrendingUp className="h-3.5 w-3.5" />
                Cash Flow Forecast
              </Button>
            </Link>
            <Button
              variant="outline"
              size="sm"
              className="gap-1.5 text-slate-600"
              onClick={() => { loadTreasury(); loadFormData(); }}
              disabled={dashLoading}
            >
              <RefreshCw className={`h-3.5 w-3.5 ${dashLoading ? "animate-spin" : ""}`} />
              Refresh
            </Button>
            <Button
              className="bg-orange-500 hover:bg-orange-600 gap-2"
              onClick={() => { setInitialMode(undefined); setInitialInvoiceIds([]); setCreateOpen(true); }}
            >
              <Plus className="h-4 w-4" /> Buat Disbursement
            </Button>
          </div>
        </div>

        {/* ── Section 1: Ringkasan ────────────────────────────────────── */}
        <div>
          <p className="text-xs font-semibold text-slate-400 uppercase tracking-widest mb-3">Ringkasan</p>
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
            <SummaryCard
              icon={Wallet}
              label="Saldo Bank Hari Ini"
              value={summary ? fmtRp(summary.bankBalance) : "—"}
              color="green"
              loading={dashLoading}
            />
            <SummaryCard
              icon={TrendingDown}
              label="Pengeluaran Hari Ini"
              value={summary ? fmtRp(summary.spendingToday) : "—"}
              color={summary && summary.spendingToday > 0 ? "orange" : "slate"}
              loading={dashLoading}
            />
            <SummaryCard
              icon={CalendarClock}
              label="Pengeluaran Minggu Ini"
              value={summary ? fmtRp(summary.spendingWeek) : "—"}
              color="slate"
              loading={dashLoading}
            />
            <SummaryCard
              icon={TrendingDown}
              label="Pengeluaran Bulan Ini"
              value={summary ? fmtRp(summary.spendingMonth) : "—"}
              color="slate"
              loading={dashLoading}
            />
          </div>
        </div>

        {/* ── Section 2: Outstanding ──────────────────────────────────── */}
        <div>
          <p className="text-xs font-semibold text-slate-400 uppercase tracking-widest mb-3">Outstanding</p>
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
            <OutstandingCard
              icon={FileText}
              label="Vendor Invoice Outstanding"
              count={outstanding?.vendorInvoiceCount ?? 0}
              total={outstanding?.vendorInvoiceTotal ?? 0}
              badgeColor="orange"
              loading={dashLoading}
              onClick={() => openAction("vendor_invoice")}
            />
            <OutstandingCard
              icon={AlertTriangle}
              label="Invoice Overdue"
              count={outstanding?.overdueCount ?? 0}
              total={outstanding?.overdueTotal ?? 0}
              badgeColor="red"
              loading={dashLoading}
              onClick={() => openAction("vendor_invoice")}
            />
            <OutstandingCard
              icon={PiggyBank}
              label="Kasbon Belum Dipertanggungjawabkan"
              count={outstanding?.kasbonCount ?? 0}
              total={outstanding?.kasbonTotal ?? 0}
              badgeColor="blue"
              loading={dashLoading}
              onClick={() => openAction("employee_advance")}
            />
            <Card className="border-slate-200">
              <CardContent className="p-4">
                <div className="flex items-center gap-2 mb-3">
                  <div className="p-1.5 bg-slate-100 rounded-md">
                    <Clock className="h-4 w-4 text-slate-500" />
                  </div>
                  <p className="text-xs font-medium text-slate-600">Approval Menunggu Persetujuan</p>
                </div>
                {dashLoading ? (
                  <div className="h-6 w-16 bg-slate-100 rounded animate-pulse" />
                ) : (
                  <>
                    <span className={`text-xs font-semibold px-2 py-0.5 rounded-full border ${
                      (outstanding?.approvalPendingCount ?? 0) > 0
                        ? "bg-yellow-100 text-yellow-700 border-yellow-200"
                        : "bg-slate-100 text-slate-500 border-slate-200"
                    }`}>
                      {outstanding?.approvalPendingCount ?? 0} item
                    </span>
                    <p className="text-[11px] text-slate-400 mt-2">
                      <Link href="/expense/kasbon" className="text-blue-500 hover:underline">
                        Lihat di Kasbon →
                      </Link>
                    </p>
                  </>
                )}
              </CardContent>
            </Card>
          </div>
        </div>

        {/* ── Section 3: Quick Action ─────────────────────────────────── */}
        <div>
          <p className="text-xs font-semibold text-slate-400 uppercase tracking-widest mb-3">Quick Action</p>
          <div className="grid grid-cols-2 sm:grid-cols-5 gap-2">
            {QUICK_ACTIONS.map((qa) => (
              <button
                key={qa.mode}
                onClick={() => openAction(qa.mode)}
                className={`flex flex-col items-start gap-2 p-3 rounded-xl border bg-white transition-all text-left ${qa.color}`}
              >
                <div className={`p-2 rounded-lg ${qa.bgColor}`}>
                  <qa.icon className={`h-4 w-4 ${qa.iconColor}`} />
                </div>
                <div>
                  <p className="text-xs font-semibold text-slate-800 leading-tight">{qa.label}</p>
                  <p className="text-[11px] text-slate-400 leading-tight mt-0.5">{qa.desc}</p>
                </div>
              </button>
            ))}
          </div>
        </div>

        {/* ── Section 4: Priority Queue ───────────────────────────────── */}
        <div>
          <div className="flex items-center justify-between mb-3">
            <p className="text-xs font-semibold text-slate-400 uppercase tracking-widest">Antrian Prioritas</p>
            {queue.length > 5 && (
              <button
                className="text-xs text-blue-500 hover:underline flex items-center gap-1"
                onClick={() => setShowAllQueue((v) => !v)}
              >
                {showAllQueue ? "Tampilkan lebih sedikit" : `Tampilkan semua (${queue.length})`}
                <ChevronDown className={`h-3 w-3 transition-transform ${showAllQueue ? "rotate-180" : ""}`} />
              </button>
            )}
          </div>

          {dashLoading ? (
            <Card>
              <CardContent className="p-0">
                {[...Array(3)].map((_, i) => (
                  <div key={i} className="flex items-center gap-3 px-4 py-3 border-b last:border-0">
                    <div className="h-8 w-8 bg-slate-100 rounded-lg animate-pulse shrink-0" />
                    <div className="flex-1 space-y-1.5">
                      <div className="h-3.5 w-48 bg-slate-100 rounded animate-pulse" />
                      <div className="h-3 w-32 bg-slate-100 rounded animate-pulse" />
                    </div>
                    <div className="h-4 w-24 bg-slate-100 rounded animate-pulse" />
                  </div>
                ))}
              </CardContent>
            </Card>
          ) : queue.length === 0 ? (
            <Card className="border-dashed">
              <CardContent className="py-8 flex flex-col items-center gap-2 text-slate-400">
                <CheckCircle2 className="h-8 w-8 text-green-400" />
                <p className="text-sm font-medium text-slate-500">Tidak ada item mendesak</p>
                <p className="text-xs">Semua invoice dan kasbon dalam kondisi baik</p>
              </CardContent>
            </Card>
          ) : (
            <Card>
              <CardContent className="p-0">
                {visibleQueue.map((item, idx) => {
                  const isOverdue = item.type === "invoice_overdue" || item.type === "kasbon_overdue";
                  const isToday = item.type === "invoice_today";
                  const typeConfig = {
                    invoice_overdue: { label: "Invoice Overdue", icon: AlertCircle, iconCls: "text-red-500 bg-red-50", badgeCls: "bg-red-100 text-red-700 border-red-200" },
                    invoice_today: { label: "Jatuh Tempo Hari Ini", icon: Clock, iconCls: "text-orange-500 bg-orange-50", badgeCls: "bg-orange-100 text-orange-700 border-orange-200" },
                    kasbon_overdue: { label: "Kasbon Overdue", icon: AlertTriangle, iconCls: "text-purple-500 bg-purple-50", badgeCls: "bg-purple-100 text-purple-700 border-purple-200" },
                  }[item.type];
                  const TypeIcon = typeConfig.icon;

                  return (
                    <div
                      key={`${item.type}-${item.id}`}
                      className={`flex items-center gap-3 px-4 py-3 border-b last:border-0 hover:bg-slate-50/60 transition-colors ${idx === 0 && isOverdue ? "bg-red-50/30" : ""}`}
                    >
                      {/* Priority badge */}
                      <div className={`flex items-center justify-center h-8 w-8 rounded-lg shrink-0 ${typeConfig.iconCls}`}>
                        <TypeIcon className="h-4 w-4" />
                      </div>

                      {/* Info */}
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 flex-wrap">
                          <p className="text-sm font-semibold text-slate-800 truncate">{item.label}</p>
                          <span className={`text-[10px] px-1.5 py-0.5 rounded border font-medium shrink-0 ${typeConfig.badgeCls}`}>
                            {typeConfig.label}
                          </span>
                        </div>
                        <div className="flex items-center gap-3 mt-0.5">
                          <p className="text-xs text-slate-400 font-mono truncate">{item.sublabel}</p>
                          {item.dueDate && (
                            <p className={`text-xs shrink-0 ${isOverdue ? "text-red-500 font-semibold" : isToday ? "text-orange-500 font-semibold" : "text-slate-400"}`}>
                              {isOverdue ? "⚠ " : ""}
                              {new Date(item.dueDate + "T00:00:00").toLocaleDateString("id-ID", { day: "2-digit", month: "short", year: "numeric" })}
                            </p>
                          )}
                        </div>
                      </div>

                      {/* Amount + action */}
                      <div className="flex items-center gap-3 shrink-0">
                        <p className="text-sm font-bold text-slate-700 font-mono text-right">Rp {fmt(item.amount)}</p>
                        {item.actionMode && (
                          <Button
                            size="sm"
                            variant="outline"
                            className="h-7 text-xs gap-1 border-orange-200 text-orange-600 hover:bg-orange-50"
                            onClick={() => openAction(item.actionMode as PaymentMode, item.actionIds, item.employeeName)}
                          >
                            Bayar <ArrowRight className="h-3 w-3" />
                          </Button>
                        )}
                      </div>
                    </div>
                  );
                })}
              </CardContent>
            </Card>
          )}
        </div>

        {/* ── Section 5: Daftar Disbursement ──────────────────────────── */}
        <div>
          <div className="flex items-center justify-between mb-3 flex-wrap gap-2">
            <p className="text-xs font-semibold text-slate-400 uppercase tracking-widest">Daftar Disbursement</p>
            <div className="flex items-center gap-2">
              {/* Filter vendor — terhubung ke data supplier di Supabase */}
              <Select
                value={filterVendorId != null ? String(filterVendorId) : "__all__"}
                onValueChange={(v) => setFilterVendorId(v === "__all__" ? null : Number(v))}
              >
                <SelectTrigger className="h-8 text-xs w-[200px] bg-white">
                  <SelectValue placeholder="Semua Vendor" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="__all__">— Semua Vendor —</SelectItem>
                  {vendors.map((v) => (
                    <SelectItem key={v.id} value={String(v.id)}>{v.name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
              {filterVendorId != null && (
                <Button
                  variant="ghost"
                  size="sm"
                  className="h-8 px-2 text-xs text-slate-500 hover:text-slate-700"
                  onClick={() => setFilterVendorId(null)}
                >
                  <X className="h-3 w-3 mr-1" /> Reset
                </Button>
              )}
              <Button
                variant="outline"
                size="sm"
                className="h-8 px-2.5 text-xs gap-1.5 text-slate-600"
                onClick={loadDisbList}
                disabled={disbLoading}
              >
                <RefreshCw className={`h-3 w-3 ${disbLoading ? "animate-spin" : ""}`} />
              </Button>
            </div>
          </div>

          {disbLoading ? (
            <Card>
              <CardContent className="p-0">
                {[...Array(3)].map((_, i) => (
                  <div key={i} className="flex items-center gap-3 px-4 py-3 border-b last:border-0">
                    <div className="h-8 w-8 bg-slate-100 rounded animate-pulse shrink-0" />
                    <div className="flex-1 space-y-1.5">
                      <div className="h-3.5 w-40 bg-slate-100 rounded animate-pulse" />
                      <div className="h-3 w-28 bg-slate-100 rounded animate-pulse" />
                    </div>
                    <div className="h-4 w-20 bg-slate-100 rounded animate-pulse" />
                  </div>
                ))}
              </CardContent>
            </Card>
          ) : disbList.length === 0 ? (
            <Card className="border-dashed">
              <CardContent className="py-8 flex flex-col items-center gap-2 text-slate-400">
                <ArrowUpRight className="h-8 w-8 text-slate-300" />
                <p className="text-sm">{filterVendorId ? "Tidak ada transaksi untuk vendor ini" : "Belum ada transaksi"}</p>
              </CardContent>
            </Card>
          ) : (
            <Card>
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead className="border-b bg-slate-50">
                    <tr>
                      <th className="text-left px-4 py-2.5 text-xs font-semibold text-slate-500">No. Disbursement</th>
                      <th className="text-left px-4 py-2.5 text-xs font-semibold text-slate-500">Tanggal</th>
                      <th className="text-left px-4 py-2.5 text-xs font-semibold text-slate-500">Memo / Ref</th>
                      <th className="text-left px-4 py-2.5 text-xs font-semibold text-slate-500">Vendor / Pihak</th>
                      <th className="text-left px-4 py-2.5 text-xs font-semibold text-slate-500">Status</th>
                      <th className="text-right px-4 py-2.5 text-xs font-semibold text-slate-500">Jumlah</th>
                      <th className="px-4 py-2.5 w-8 text-center text-xs font-semibold text-slate-500" title="Bukti Pembayaran">
                        <Paperclip className="h-3 w-3 inline-block" />
                      </th>
                      <th className="px-4 py-2.5 w-12" />
                    </tr>
                  </thead>
                  <tbody>
                    {disbList.map((d) => (
                      <tr key={d.id} className="border-t hover:bg-slate-50 transition-colors">
                        <td className="px-4 py-2.5 font-mono text-xs text-slate-600">
                          <div className="flex flex-col gap-0.5">
                            <span>{d.disbursementNumber ?? `BD-${d.id}`}</span>
                            {d.sourceModule === "expense" && d.expenseId && (
                              <a
                                href={`/expense/${d.expenseId}`}
                                onClick={(e) => e.stopPropagation()}
                                className="inline-flex items-center gap-1 text-[9px] font-semibold uppercase tracking-wide bg-violet-50 text-violet-600 border border-violet-200 rounded-full px-1.5 py-0.5 w-fit hover:bg-violet-100 transition-colors"
                              >
                                <FileText className="h-2.5 w-2.5" />
                                Dari Expense
                              </a>
                            )}
                          </div>
                        </td>
                        <td className="px-4 py-2.5 text-xs text-slate-500">
                          {new Date(d.date + "T00:00:00").toLocaleDateString("id-ID", { day: "2-digit", month: "short", year: "numeric" })}
                        </td>
                        <td className="px-4 py-2.5 text-xs text-slate-500 max-w-[200px] truncate">
                          {d.memo ?? d.ref ?? <span className="text-slate-300">—</span>}
                        </td>
                        <td className="px-4 py-2.5 max-w-[180px]">
                          {d.counterpartyName ? (
                            <div className="flex flex-col gap-0.5">
                              <span className="text-xs text-slate-700 font-medium truncate">{d.counterpartyName}</span>
                              {d.counterpartyType && (
                                <span className={`text-[9px] font-semibold uppercase tracking-wide w-fit px-1.5 py-0.5 rounded-full ${
                                  d.counterpartyType === "supplier" ? "bg-blue-50 text-blue-600" :
                                  d.counterpartyType === "employee" ? "bg-purple-50 text-purple-600" :
                                  d.counterpartyType === "bank" ? "bg-green-50 text-green-600" :
                                  d.counterpartyType === "government" ? "bg-orange-50 text-orange-600" :
                                  d.counterpartyType === "shareholder" ? "bg-yellow-50 text-yellow-700" :
                                  "bg-slate-100 text-slate-500"
                                }`}>
                                  {d.counterpartyType === "supplier" ? "Supplier" :
                                   d.counterpartyType === "employee" ? "Karyawan" :
                                   d.counterpartyType === "bank" ? "Bank" :
                                   d.counterpartyType === "government" ? "Pajak" :
                                   d.counterpartyType === "shareholder" ? "Pemegang Saham" :
                                   d.counterpartyType}
                                </span>
                              )}
                            </div>
                          ) : (
                            <span className="text-slate-300 text-xs">—</span>
                          )}
                        </td>
                        <td className="px-4 py-2.5">
                          <StatusBadge status={d.status} />
                        </td>
                        <td className="px-4 py-2.5 text-right font-mono font-semibold text-sm text-slate-800">
                          Rp {fmt(d.totalAmount)}
                        </td>
                        <td className="px-4 py-2.5 text-center">
                          {d.attachmentUrl ? (
                            /\.(jpe?g|png|webp|gif)(\?|$)/i.test(d.attachmentUrl) ? (
                              <a href={d.attachmentUrl} target="_blank" rel="noopener noreferrer" title="Lihat bukti pembayaran" onClick={(e) => e.stopPropagation()}>
                                <img
                                  src={d.attachmentUrl}
                                  alt="bukti"
                                  className="h-7 w-7 object-cover rounded border border-slate-200 inline-block hover:opacity-80 transition-opacity"
                                />
                              </a>
                            ) : (
                              <a href={d.attachmentUrl} target="_blank" rel="noopener noreferrer" title="Lihat dokumen bukti" onClick={(e) => e.stopPropagation()}>
                                <Paperclip className="h-3.5 w-3.5 text-blue-500 hover:text-blue-700 inline-block" />
                              </a>
                            )
                          ) : (
                            <span className="text-slate-200">—</span>
                          )}
                        </td>
                        <td className="px-4 py-2.5 text-right">
                          <Button
                            variant="ghost"
                            size="icon"
                            className="h-7 w-7 text-slate-400 hover:text-slate-600"
                            onClick={() => setDetailId(d.id)}
                          >
                            <Eye className="h-3.5 w-3.5" />
                          </Button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </Card>
          )}
        </div>

      </div>

      {/* ── Dialogs ──────────────────────────────────────────────────── */}

      {loading ? null : (
        <CreateDisbDialog
          open={createOpen}
          onOpenChange={(v) => { setCreateOpen(v); if (!v) { setInitialMode(undefined); setInitialInvoiceIds([]); setInitialEmployeeName(undefined); } }}
          journals={journals}
          allAccounts={allAccounts}
          accountsByType={accountsByType}
          fetchOutstandingInvoices={api.fetchOutstandingInvoices}
          onCreated={() => {
            handleCreateSuccess();
            setCreateOpen(false);
            setInitialMode(undefined);
            setInitialInvoiceIds([]);
            setInitialEmployeeName(undefined);
          }}
          createDisb={api.createDisb}
          initialMode={initialMode}
          initialInvoiceIds={initialInvoiceIds}
          initialEmployeeName={initialEmployeeName}
        />
      )}

      <DisbDetailDialog
        disbId={detailId}
        onClose={() => setDetailId(null)}
        fetchDetail={api.fetchDetail}
        onVoid={(id) => { setDetailId(null); setVoidId(id); }}
      />

      <VoidDialog
        disbId={voidId}
        onClose={() => setVoidId(null)}
        onConfirm={handleVoid}
      />
    </AppShell>
  );
}
