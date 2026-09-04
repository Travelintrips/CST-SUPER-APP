import { DatePicker } from "@/components/ui/date-picker";
import { useCallback, useEffect, useRef, useState } from "react";
import { Link, useSearch } from "wouter";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import {
  RefreshCw, ChevronLeft, ChevronRight, ArrowLeft, X, Trash2,
  AlertTriangle, CalendarRange, ChevronUp, ChevronDown, ChevronsUpDown,
} from "lucide-react";
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";

interface GLRow {
  line_id: number; entry_id: number; entry_number: string;
  company_id: number; branch_id: number | null; division_id: number | null;
  date: string; source_module: string; source_schema: string; source_table: string | null;
  source_id: number | null; ref: string | null; entry_description: string | null;
  line_description: string | null; status: string;
  journal_name: string; journal_type: string;
  account_id: number; account_code: string; account_name: string; account_type: string;
  normal_balance: "DEBIT" | "CREDIT";
  debit: string; credit: string; created_at: string; posted_at: string | null;
  partner_name: string | null;
  source_doc_number: string | null;
  payment_method: string | null;
  /** Running balance after this row (chronological). Null for non-posted entries. */
  running_balance: string | null;
  /** Opening balance of this account before the filter period. */
  account_opening_balance: string;
}

interface GLSummary {
  openingBalance: number | null;
  closingBalance: number | null;
  totalDebit: number;
  totalCredit: number;
}

const fmt = (v: string | number) =>
  new Intl.NumberFormat("id-ID", { minimumFractionDigits: 0, maximumFractionDigits: 0 }).format(Number(v));

/** Format running balance with Rp prefix and minus sign for negatives */
const fmtBalance = (v: number) => {
  const abs = new Intl.NumberFormat("id-ID", { minimumFractionDigits: 0, maximumFractionDigits: 0 }).format(Math.abs(v));
  return v < 0 ? `-Rp ${abs}` : `Rp ${abs}`;
};

const MODULES = ["manual","sales","purchase","tenant","sport_center","pos","logistics","expense","hrd","ecommerce","bank_reconciliation"];

const PAYMENT_METHODS: { value: string; label: string }[] = [
  { value: "cash",        label: "Cash / Tunai" },
  { value: "bank",        label: "Transfer Bank" },
  { value: "qris",        label: "QRIS" },
  { value: "credit_card", label: "Kartu Kredit" },
  { value: "debit_card",  label: "Kartu Debit" },
  { value: "cheque",      label: "Cek / Giro" },
  { value: "other",       label: "Lainnya" },
];

const MODULE_LABELS: Record<string, string> = {
  manual:                       "Jurnal Manual",
  sales:                        "Penjualan",
  purchase:                     "Pembelian",
  tenant:                       "Sewa Tenant",
  tenant_payment:               "Pembayaran Tenant",
  sport_center:                 "Sport Center",
  pos:                          "Point of Sale",
  logistics:                    "Logistik",
  expense:                      "Pengeluaran/Biaya",
  hrd:                          "HRD / Penggajian",
  ecommerce:                    "E-Commerce",
  consolidated_invoice_payment: "Pembayaran Invoice Konsolidasi",
  direct_invoice_payment:       "Pembayaran Invoice Langsung",
  ocr_payment_approval:         "Persetujuan Pembayaran (Bank)",
  bank_reconciliation:          "Rekonsiliasi Bank",
  cash_advance:                 "Kas Bon / Cash Advance",
  fleet:                        "Armada / Fleet",
  sport_center_booking:         "Booking Sport Center",
  sport_center_membership:      "Membership Sport Center",
  asset:                        "Aset Tetap",
  reversal:                     "Jurnal Pembalik",
};

const moduleLabel = (m: string) => MODULE_LABELS[m] ?? m;

/** Detail row: label + value side by side */
function Row({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="flex items-start gap-2">
      <span className="text-xs text-muted-foreground w-36 shrink-0">{label}</span>
      <span className="text-xs font-medium break-all">{value}</span>
    </div>
  );
}

const MONTH_NAMES = [
  "Januari", "Februari", "Maret", "April", "Mei", "Juni",
  "Juli", "Agustus", "September", "Oktober", "November", "Desember",
];
const CURRENT_YEAR = new Date().getFullYear();
const YEAR_OPTIONS = Array.from({ length: 6 }, (_, i) => CURRENT_YEAR + 1 - i);

// ── Sort types ────────────────────────────────────────────────────────────────
type SortCol =
  | "date" | "month" | "entry_number" | "source_module"
  | "account_code" | "account_type" | "partner_name"
  | "ref" | "debit" | "credit" | "status";

type SortDir = "asc" | "desc";

const DEFAULT_SORT_COL: SortCol = "date";
const DEFAULT_SORT_DIR: SortDir = "desc";

// ── Sort indicator icon ───────────────────────────────────────────────────────
function SortIcon({ col, sortBy, sortDir }: { col: SortCol; sortBy: SortCol; sortDir: SortDir }) {
  if (col !== sortBy) return <ChevronsUpDown className="h-3 w-3 ml-1 text-muted-foreground/50 inline" />;
  return sortDir === "asc"
    ? <ChevronUp   className="h-3 w-3 ml-1 text-primary inline" />
    : <ChevronDown className="h-3 w-3 ml-1 text-primary inline" />;
}

export default function AccountingHubGLPage() {
  const search = useSearch();
  const urlParams = new URLSearchParams(search);

  const [rows, setRows] = useState<GLRow[]>([]);
  const [total, setTotal] = useState(0);
  const [summary, setSummary] = useState<GLSummary>({ openingBalance: null, closingBalance: null, totalDebit: 0, totalCredit: 0 });
  const [loading, setLoading] = useState(false);
  const [page, setPage] = useState(1);
  const [filters, setFilters] = useState({
    company_id:     urlParams.get("company_id")     ?? "",
    date_from:      urlParams.get("date_from")      ?? "",
    date_to:        urlParams.get("date_to")        ?? "",
    source_module:  urlParams.get("source_module")  ?? "",
    account_id:     urlParams.get("account_id")     ?? "",
    account_name:   urlParams.get("account_name")   ?? "",
    payment_method: urlParams.get("payment_method") ?? "",
  });
  const [appliedFilters, setAppliedFilters] = useState({
    company_id:     urlParams.get("company_id")     ?? "",
    date_from:      urlParams.get("date_from")      ?? "",
    date_to:        urlParams.get("date_to")        ?? "",
    source_module:  urlParams.get("source_module")  ?? "",
    account_id:     urlParams.get("account_id")     ?? "",
    account_name:   urlParams.get("account_name")   ?? "",
    payment_method: urlParams.get("payment_method") ?? "",
  });
  const [month, setMonth] = useState(urlParams.get("month") ?? "");
  const [sortBy,  setSortBy]  = useState<SortCol>(DEFAULT_SORT_COL);
  const [sortDir, setSortDir] = useState<SortDir>(DEFAULT_SORT_DIR);

  // Keep the previous Trial Balance step scoped to the same company and
  // period when the user drills down into General Ledger and goes back.
  const trialBalanceParams = new URLSearchParams();
  for (const key of ["company_id", "date_from", "date_to"]) {
    const value = filters[key as "company_id" | "date_from" | "date_to"];
    if (value) trialBalanceParams.set(key, value);
  }
  const trialBalanceHref = `/accounting/hub/trial-balance${trialBalanceParams.toString() ? `?${trialBalanceParams}` : ""}`;

  // ── Rows per page ─────────────────────────────────────────────────────────
  const LS_RPP_KEY = "gl_hub_rows_per_page";
  const RPP_OPTIONS = [10, 25, 50, 100, 250, 500, "all"] as const;
  type RppOption = typeof RPP_OPTIONS[number];

  const [rowsPerPage, setRowsPerPage] = useState<RppOption>(() => {
    const saved = localStorage.getItem(LS_RPP_KEY);
    if (saved === "all") return "all";
    const n = Number(saved);
    if (RPP_OPTIONS.includes(n as RppOption)) return n as RppOption;
    return 50;
  });

  const effectiveLimit = rowsPerPage === "all" ? 999999 : rowsPerPage;
  const queryOptionsRef = useRef({ sortBy, sortDir, rowsPerPage });
  queryOptionsRef.current = { sortBy, sortDir, rowsPerPage };

  const applyMonthFilter = (m: string) => {
    setMonth(m);
    if (!m) {
      setFilters(f => ({ ...f, date_from: "", date_to: "" }));
      return;
    }
    const [y, mo] = m.split("-").map(Number);
    const firstDay = `${m}-01`;
    const lastDayNum = new Date(y, mo, 0).getDate();
    const lastDay = `${m}-${String(lastDayNum).padStart(2, "0")}`;
    setFilters(f => ({ ...f, date_from: firstDay, date_to: lastDay }));
  };

  const [voidDialog, setVoidDialog] = useState<{ open: boolean; entryId: number; entryNumber: string; description: string; date: string } | null>(null);
  const [voidLoading, setVoidLoading] = useState(false);
  const [voidError, setVoidError] = useState<string | null>(null);
  const [successMsg, setSuccessMsg] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [detailRow, setDetailRow] = useState<GLRow | null>(null);

  const load = useCallback(async (p: number, sb: SortCol, sd: SortDir, rpp: RppOption) => {
    const lim = rpp === "all" ? 999999 : rpp;
    setLoading(true);
    setError(null);
    try {
      const params = new URLSearchParams({
        page: String(p),
        limit: String(lim),
        sort_by: sb,
        sort_dir: sd,
      });
      Object.entries(appliedFilters).forEach(([k, v]) => {
        if (v && k !== "account_name") params.set(k, v);
      });
      // payment_method is already included via the loop above
      const res = await fetch(`/api/accounting/hub/general-ledger?${params}`, { credentials: "include" });
      if (!res.ok) {
        const msg = await res.text().catch(() => "");
        setError(`Gagal memuat data: ${res.status}${msg ? ` — ${msg}` : ""}`);
        return;
      }
      const json = await res.json();
      setRows(json.data ?? []);
      setTotal(json.total ?? 0);
      setSummary({
        openingBalance: json.openingBalance ?? 0,
        closingBalance: json.closingBalance ?? 0,
        totalDebit:     json.totalDebit     ?? 0,
        totalCredit:    json.totalCredit    ?? 0,
      });
    } catch (e: any) {
      setError(e.message ?? "Terjadi kesalahan saat memuat data");
    } finally {
      setLoading(false);
    }
  }, [appliedFilters]);

  useEffect(() => {
    const { sortBy: currentSortBy, sortDir: currentSortDir, rowsPerPage: currentRowsPerPage } = queryOptionsRef.current;
    void load(1, currentSortBy, currentSortDir, currentRowsPerPage);
    setPage(1);
  }, [load]);

  const applyFilters = () => { setPage(1); setAppliedFilters({ ...filters }); };

  // Toggle sort: same col → flip dir; new col → default desc (except entry_number → asc)
  const handleSort = (col: SortCol) => {
    let newDir: SortDir;
    if (col === sortBy) {
      newDir = sortDir === "asc" ? "desc" : "asc";
    } else {
      newDir = col === "entry_number" ? "asc" : "desc";
    }
    setSortBy(col);
    setSortDir(newDir);
    setPage(1);
    load(1, col, newDir, rowsPerPage);
  };

  const clearAccountFilter = () => {
    setFilters(f => ({ ...f, account_id: "", account_name: "" }));
  };

  const openVoidDialog = (row: GLRow) => {
    setVoidError(null);
    setVoidDialog({
      open: true,
      entryId: row.entry_id,
      entryNumber: row.entry_number,
      description: row.entry_description ?? row.line_description ?? "-",
      date: row.date,
    });
  };

  const handleVoid = async () => {
    if (!voidDialog) return;
    setVoidLoading(true);
    setVoidError(null);
    try {
      const res = await fetch(`/api/accounting/entries/${voidDialog.entryId}/reverse`, {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          reason: "Dibatalkan oleh admin — entry tidak valid",
          // gunakan hari ini (bukan tanggal entri asli) agar reversal diposting
          // di periode berjalan — bukan periode yang mungkin sudah ditutup
          date: new Date().toISOString().split("T")[0],
        }),
      });
      const json = await res.json();
      if (!res.ok) {
        setVoidError(json.message ?? "Gagal membatalkan entry");
        return;
      }
      setVoidDialog(null);
      setSuccessMsg(`Entry ${voidDialog.entryNumber} berhasil dibatalkan. Jurnal pembalik telah dibuat.`);
      setTimeout(() => setSuccessMsg(null), 5000);
      load(page, sortBy, sortDir, rowsPerPage);
    } catch (e: any) {
      setVoidError(e.message ?? "Terjadi kesalahan");
    } finally {
      setVoidLoading(false);
    }
  };

  const typeColor = (t: string) =>
    t === "asset" ? "bg-blue-100 text-blue-700" :
    t === "liability" ? "bg-red-100 text-red-700" :
    t === "equity" ? "bg-purple-100 text-purple-700" :
    t === "revenue" ? "bg-green-100 text-green-700" :
    "bg-orange-100 text-orange-700";

  const drillAccountName = filters.account_name || (rows[0] ? `${rows[0].account_code} – ${rows[0].account_name}` : "");

  const seenEntries = new Set<number>();

  // ── Sortable header helper ────────────────────────────────────────────────
  const Th = ({
    col, children, className = "",
  }: { col: SortCol; children: React.ReactNode; className?: string }) => (
    <th
      className={`px-3 py-2 text-left select-none cursor-pointer hover:bg-muted/70 transition-colors ${className}`}
      onClick={() => handleSort(col)}
    >
      <span className="inline-flex items-center gap-0.5 whitespace-nowrap">
        {children}
        <SortIcon col={col} sortBy={sortBy} sortDir={sortDir} />
      </span>
    </th>
  );

  const ThRight = ({
    col, children,
  }: { col: SortCol; children: React.ReactNode }) => (
    <th
      className="px-3 py-2 text-right select-none cursor-pointer hover:bg-muted/70 transition-colors"
      onClick={() => handleSort(col)}
    >
      <span className="inline-flex items-center justify-end gap-0.5 w-full whitespace-nowrap">
        {children}
        <SortIcon col={col} sortBy={sortBy} sortDir={sortDir} />
      </span>
    </th>
  );

  return (
    <div className="p-6 space-y-4">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <Link href={trialBalanceHref}>
            <Button variant="ghost" size="sm" className="h-8 w-8 p-0" title="Kembali ke Trial Balance">
              <ArrowLeft className="h-4 w-4" />
            </Button>
          </Link>
          <div>
            <h1 className="text-xl font-bold">Buku Besar (General Ledger)</h1>
            <div className="flex items-center gap-2 flex-wrap">
              {filters.account_id && (
                <span className="text-xs bg-primary/10 text-primary px-2 py-0.5 rounded-full font-medium flex items-center gap-1">
                  Akun: {drillAccountName || `ID ${filters.account_id}`}
                  <button onClick={clearAccountFilter} className="hover:text-red-500 ml-0.5">
                    <X className="h-3 w-3" />
                  </button>
                </span>
              )}
              <p className="text-xs text-muted-foreground">Multi-perusahaan · {total.toLocaleString("id-ID")} baris</p>
            </div>
          </div>
        </div>
        <Button variant="outline" size="sm" onClick={() => load(page, sortBy, sortDir, rowsPerPage)} disabled={loading}>
          <RefreshCw className={`h-4 w-4 mr-2 ${loading ? "animate-spin" : ""}`} />Refresh
        </Button>
      </div>

      {error && (
        <div className="bg-red-50 border border-red-300 text-red-800 rounded-md px-4 py-3 text-sm flex items-center gap-2">
          <span>⚠</span> {error}
        </div>
      )}

      {successMsg && (
        <div className="bg-green-50 border border-green-300 text-green-800 rounded-md px-4 py-3 text-sm flex items-center gap-2">
          <span>✓</span> {successMsg}
        </div>
      )}

      {/* Filters */}
      <Card>
        <CardContent className="pt-4">
          <div className="flex flex-wrap gap-2 items-center">
            <Input placeholder="Company ID" value={filters.company_id} onChange={e => setFilters(f => ({...f, company_id: e.target.value}))} className="w-32" />
            <div className="flex items-center gap-1.5 rounded-md border border-input bg-background pl-2.5 pr-1 py-1">
              <CalendarRange className="h-4 w-4 text-muted-foreground shrink-0" />
              <label className="text-xs text-muted-foreground whitespace-nowrap mr-0.5">Bulan Pembayaran</label>
              <Select
                value={month ? month.split("-")[1] : "__none"}
                onValueChange={(v) => {
                  const y = month ? month.split("-")[0] : String(CURRENT_YEAR);
                  applyMonthFilter(v === "__none" ? "" : `${y}-${v}`);
                }}
              >
                <SelectTrigger className="w-32 h-8" data-testid="select-gl-month">
                  <SelectValue placeholder="Bulan" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="__none">Semua Bulan</SelectItem>
                  {MONTH_NAMES.map((name, i) => (
                    <SelectItem key={name} value={String(i + 1).padStart(2, "0")}>{name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <Select
                value={month ? month.split("-")[0] : "__none"}
                onValueChange={(v) => {
                  const mo = month ? month.split("-")[1] : String(new Date().getMonth() + 1).padStart(2, "0");
                  applyMonthFilter(v === "__none" ? "" : `${v}-${mo}`);
                }}
              >
                <SelectTrigger className="w-24 h-8" data-testid="select-gl-year">
                  <SelectValue placeholder="Tahun" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="__none">Tahun</SelectItem>
                  {YEAR_OPTIONS.map((y) => (
                    <SelectItem key={y} value={String(y)}>{y}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
              {month && (
                <button
                  type="button"
                  onClick={() => applyMonthFilter("")}
                  className="text-muted-foreground hover:text-foreground shrink-0"
                  title="Hapus filter bulan"
                >
                  <X className="h-3.5 w-3.5" />
                </button>
              )}
            </div>
            <DatePicker value={filters.date_from} onChange={v => { setMonth(""); setFilters(f => ({...f, date_from: v})); }} className="w-40" />
            <DatePicker value={filters.date_to} onChange={v => { setMonth(""); setFilters(f => ({...f, date_to: v})); }} className="w-40" />
            <Select value={filters.source_module || "__all"} onValueChange={v => setFilters(f => ({...f, source_module: v === "__all" ? "" : v}))}>
              <SelectTrigger className="w-44"><SelectValue placeholder="Modul" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="__all">Semua Modul</SelectItem>
                {MODULES.map(m => <SelectItem key={m} value={m}>{moduleLabel(m)}</SelectItem>)}
              </SelectContent>
            </Select>
            <Input
              placeholder="Account ID"
              value={filters.account_id}
              onChange={e => setFilters(f => ({...f, account_id: e.target.value, account_name: ""}))}
              className="w-32"
            />
            <Select value={filters.payment_method || "__all"} onValueChange={v => setFilters(f => ({...f, payment_method: v === "__all" ? "" : v}))}>
              <SelectTrigger className="w-44"><SelectValue placeholder="Metode Pembayaran" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="__all">Semua Metode</SelectItem>
                {PAYMENT_METHODS.map(pm => <SelectItem key={pm.value} value={pm.value}>{pm.label}</SelectItem>)}
              </SelectContent>
            </Select>
            <Button size="sm" onClick={applyFilters}>Terapkan</Button>
            {(filters.account_id || filters.date_from || filters.date_to || filters.source_module || filters.company_id || filters.payment_method || month || sortBy !== DEFAULT_SORT_COL || sortDir !== DEFAULT_SORT_DIR) && (
              <Button size="sm" variant="ghost" onClick={() => {
                setMonth("");
                setFilters({ company_id: "", date_from: "", date_to: "", source_module: "", account_id: "", account_name: "", payment_method: "" });
                setSortBy(DEFAULT_SORT_COL);
                setSortDir(DEFAULT_SORT_DIR);
                setPage(1);
                setAppliedFilters({ company_id: "", date_from: "", date_to: "", source_module: "", account_id: "", account_name: "", payment_method: "" });
              }}>
                <X className="h-3.5 w-3.5 mr-1" />Reset
              </Button>
            )}
          </div>
          {/* Active sort indicator */}
          {(sortBy !== DEFAULT_SORT_COL || sortDir !== DEFAULT_SORT_DIR) && (
            <div className="mt-2 flex items-center gap-1.5 text-xs text-muted-foreground">
              <span>Urut:</span>
              <span className="inline-flex items-center gap-0.5 bg-primary/10 text-primary rounded px-1.5 py-0.5 font-medium">
                {sortBy.replace(/_/g, " ")}
                {sortDir === "asc" ? <ChevronUp className="h-3 w-3" /> : <ChevronDown className="h-3 w-3" />}
              </span>
              <button
                className="text-muted-foreground hover:text-foreground"
                title="Reset urutan"
                onClick={() => {
                  setSortBy(DEFAULT_SORT_COL);
                  setSortDir(DEFAULT_SORT_DIR);
                  setPage(1);
                  load(1, DEFAULT_SORT_COL, DEFAULT_SORT_DIR, rowsPerPage);
                }}
              >
                <X className="h-3 w-3" />
              </button>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Summary card — account-scoped balance / period totals */}
      {(total > 0 || summary.openingBalance !== null) && (
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
          <div className="rounded-lg border bg-card px-4 py-3">
            <div className="text-xs text-muted-foreground mb-1">Saldo Awal{!filters.account_id && " (per akun)"}</div>
            <div className={`font-mono text-sm font-semibold ${summary.openingBalance !== null && summary.openingBalance < 0 ? "text-red-600" : "text-foreground"}`}>
              {summary.openingBalance !== null ? fmtBalance(summary.openingBalance) : "—"}
            </div>
          </div>
          <div className="rounded-lg border bg-card px-4 py-3">
            <div className="text-xs text-muted-foreground mb-1">Total Debit</div>
            <div className="font-mono text-sm font-semibold text-foreground">Rp {fmt(summary.totalDebit)}</div>
          </div>
          <div className="rounded-lg border bg-card px-4 py-3">
            <div className="text-xs text-muted-foreground mb-1">Total Kredit</div>
            <div className="font-mono text-sm font-semibold text-foreground">Rp {fmt(summary.totalCredit)}</div>
          </div>
          <div className="rounded-lg border bg-card px-4 py-3">
            <div className="text-xs text-muted-foreground mb-1">Saldo Akhir{!filters.account_id && " (per akun)"}</div>
            <div className={`font-mono text-sm font-semibold ${summary.closingBalance !== null && summary.closingBalance < 0 ? "text-red-600" : "text-primary"}`}>
              {summary.closingBalance !== null ? fmtBalance(summary.closingBalance) : "—"}
            </div>
          </div>
        </div>
      )}

      {total > 0 && !filters.account_id && (
        <div className="text-xs text-muted-foreground bg-blue-50 border border-blue-200 rounded px-3 py-2">
          <strong>Catatan saldo:</strong> Saldo awal/akhir tidak dijumlahkan lintas akun karena setiap COA memiliki saldo normal berbeda.
          Pilih <em>Account ID</em> untuk melihat saldo awal, saldo berjalan, dan saldo akhir yang valid untuk satu akun.
          Total Debit dan Kredit di atas tetap merupakan total seluruh baris yang ditampilkan.
        </div>
      )}

      {/* Filter policy notice when source_module filter is active */}
      {filters.source_module && (
        <div className="text-xs text-muted-foreground bg-amber-50 border border-amber-200 rounded px-3 py-2">
          <strong>Catatan:</strong> Kolom Saldo menunjukkan saldo berjalan berdasarkan <em>seluruh transaksi akun</em> dalam periode (termasuk modul lain), bukan hanya transaksi yang ditampilkan. Filter modul hanya menyaring baris yang ditampilkan.
        </div>
      )}

      {/* Table */}
      <div className="rounded-md border overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="bg-muted text-muted-foreground text-xs">
            <tr>
              <Th col="date">Tanggal</Th>
              <Th col="month">Bulan</Th>
              <Th col="entry_number">No. Jurnal</Th>
              <Th col="source_module">Jenis Transaksi</Th>
              <Th col="account_code">Akun</Th>
              <Th col="account_type">Tipe</Th>
              <Th col="partner_name">Sumber / Entitas</Th>
              <Th col="ref">Ref / Keterangan</Th>
              <th className="px-3 py-2 text-left text-xs select-none whitespace-nowrap">Metode Bayar</th>
              <ThRight col="debit">Debit</ThRight>
              <ThRight col="credit">Kredit</ThRight>
              <th className="px-3 py-2 text-right text-xs select-none whitespace-nowrap">Saldo</th>
              <Th col="status">Status</Th>
              <th className="px-3 py-2 text-left">Aksi</th>
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 ? (
              <tr><td colSpan={14} className="text-center py-8 text-muted-foreground">{loading ? "Memuat..." : "Tidak ada data"}</td></tr>
            ) : rows.map((r) => {
              const isFirstLineOfEntry = !seenEntries.has(r.entry_id);
              if (isFirstLineOfEntry) seenEntries.add(r.entry_id);
              const canVoid = r.status === "posted" && r.source_module !== "reversal";
              const rowMonthIdx = Number(r.date?.slice(5, 7)) - 1;
              const rowMonthLabel = rowMonthIdx >= 0 && rowMonthIdx < 12 ? MONTH_NAMES[rowMonthIdx] : "-";

              // Running balance display & color
              const rb = r.running_balance !== null && r.running_balance !== undefined
                ? Number(r.running_balance)
                : null;
              // Abnormal = balance in wrong direction for the account's normal balance
              // For DEBIT-normal: positive is healthy; negative is abnormal.
              // For CREDIT-normal: positive means credit > debit which is healthy; negative is abnormal.
              // In both cases: negative running_balance → abnormal → red.
              const rbAbnormal = rb !== null && rb < 0;

              return (
                <tr
                  key={r.line_id}
                  className={`border-t hover:bg-muted/40 cursor-pointer ${r.status === "voided" ? "opacity-50" : ""}`}
                  onClick={(e) => {
                    // Don't open detail if clicking the void button
                    if ((e.target as HTMLElement).closest("button")) return;
                    setDetailRow(r);
                  }}
                >
                  <td className="px-3 py-2 whitespace-nowrap text-xs">{r.date}</td>
                  <td className="px-3 py-2 whitespace-nowrap text-xs">{rowMonthLabel} {r.date?.slice(0, 4)}</td>
                  <td className="px-3 py-2 font-mono text-xs whitespace-nowrap">{r.entry_number}</td>

                  {/* Jenis Transaksi (readable label) */}
                  <td className="px-3 py-2">
                    <span className="text-xs font-medium text-foreground">{moduleLabel(r.source_module)}</span>
                    <div className="text-[10px] text-muted-foreground">{r.journal_name}</div>
                  </td>

                  <td className="px-3 py-2">
                    <span className="font-mono text-xs">{r.account_code}</span>
                    <span className="text-muted-foreground ml-1 text-xs">{r.account_name}</span>
                  </td>
                  <td className="px-3 py-2">
                    <span className={`text-xs px-1.5 py-0.5 rounded font-medium ${typeColor(r.account_type)}`}>{r.account_type}</span>
                  </td>

                  {/* Sumber / Entitas — nama customer/vendor/tenant + nomor dokumen */}
                  <td className="px-3 py-2 max-w-[200px]">
                    {r.partner_name ? (
                      <div>
                        <div className="text-xs font-semibold text-foreground truncate">{r.partner_name}</div>
                        {r.source_doc_number && r.source_doc_number !== r.source_module && (
                          <div className="text-[10px] text-muted-foreground font-mono truncate">{r.source_doc_number}</div>
                        )}
                      </div>
                    ) : r.entry_description && !r.entry_description.startsWith("[") ? (
                      <div className="text-xs text-muted-foreground truncate">{r.entry_description}</div>
                    ) : (
                      <span className="text-xs text-muted-foreground/50">—</span>
                    )}
                  </td>

                  {/* Ref / Keterangan */}
                  <td className="px-3 py-2 text-xs text-muted-foreground max-w-[180px]">
                    {r.ref && <div className="font-mono truncate">{r.ref}</div>}
                    {(r.line_description) && (
                      <div className="truncate text-foreground/60 mt-0.5">{r.line_description}</div>
                    )}
                  </td>

                  {/* Metode Pembayaran */}
                  <td className="px-3 py-2 whitespace-nowrap">
                    {r.payment_method ? (
                      <span className={`text-xs px-1.5 py-0.5 rounded font-medium ${
                        r.payment_method === "cash"        ? "bg-emerald-100 text-emerald-700" :
                        r.payment_method === "bank"        ? "bg-blue-100 text-blue-700" :
                        r.payment_method === "qris"        ? "bg-violet-100 text-violet-700" :
                        r.payment_method === "credit_card" ? "bg-orange-100 text-orange-700" :
                        r.payment_method === "debit_card"  ? "bg-sky-100 text-sky-700" :
                        r.payment_method === "cheque"      ? "bg-amber-100 text-amber-700" :
                        "bg-slate-100 text-slate-600"
                      }`}>
                        {PAYMENT_METHODS.find(pm => pm.value === r.payment_method)?.label ?? r.payment_method}
                      </span>
                    ) : (
                      <span className="text-xs text-muted-foreground/40">—</span>
                    )}
                  </td>

                  <td className="px-3 py-2 text-right font-mono text-xs">{Number(r.debit) ? fmt(r.debit) : "—"}</td>
                  <td className={`px-3 py-2 text-right font-mono text-xs font-semibold ${Number(r.credit) > 0 ? "text-red-600" : ""}`}>
                    {Number(r.credit) ? fmt(r.credit) : "—"}
                  </td>

                  {/* Saldo berjalan */}
                  <td
                    className={`px-3 py-2 text-right font-mono text-xs font-semibold whitespace-nowrap ${
                      rb === null
                        ? "text-muted-foreground/40"
                        : rbAbnormal
                          ? "text-red-600"
                          : "text-foreground"
                    }`}
                    title={rb !== null ? "Saldo berjalan setelah transaksi ini" : "Tidak tersedia untuk entri non-posted"}
                  >
                    {rb !== null ? fmtBalance(rb) : "—"}
                  </td>

                  <td className="px-3 py-2">
                    <Badge variant={r.status === "posted" ? "default" : "secondary"} className="text-xs">{r.status}</Badge>
                  </td>
                  <td className="px-3 py-2">
                    {isFirstLineOfEntry && canVoid && (
                      <Button
                        size="sm"
                        variant="ghost"
                        className="h-7 px-2 text-red-600 hover:bg-red-50 hover:text-red-700"
                        title="Batalkan entry ini (buat jurnal pembalik)"
                        onClick={() => openVoidDialog(r)}
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                      </Button>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {/* Summary row — page totals + closing balance pointer */}
      {rows.length > 0 && (
        <div className="flex flex-wrap items-center gap-x-6 gap-y-1 text-xs text-muted-foreground border rounded px-4 py-2 bg-muted/30">
          <span>Total halaman ini:</span>
          <span>Debit <span className="font-mono font-semibold text-foreground">{fmt(rows.reduce((s, r) => s + Number(r.debit), 0))}</span></span>
          <span>Kredit <span className="font-mono font-semibold text-red-600">{fmt(rows.reduce((s, r) => s + Number(r.credit), 0))}</span></span>
          <span className="ml-auto">
            {summary.closingBalance !== null ? (
              <>
                Saldo Akhir Periode:{" "}
                <span className={`font-mono font-semibold ${summary.closingBalance < 0 ? "text-red-600" : "text-primary"}`}>
                  {fmtBalance(summary.closingBalance)}
                </span>
              </>
            ) : (
              "Saldo berjalan ditampilkan per akun"
            )}
          </span>
        </div>
      )}

      {/* Warning: all rows + large dataset */}
      {rowsPerPage === "all" && total > 5000 && (
        <div className="flex items-center gap-2 text-xs text-amber-700 bg-amber-50 border border-amber-200 rounded-md px-3 py-2">
          <AlertTriangle className="h-4 w-4 shrink-0" />
          <span>Menampilkan seluruh data mungkin memerlukan waktu lebih lama ({total.toLocaleString("id-ID")} baris).</span>
        </div>
      )}

      {/* Pagination */}
      <div className="flex flex-wrap items-center justify-between gap-3 text-sm text-muted-foreground">
        {/* Rows-per-page selector */}
        <div className="flex items-center gap-2">
          <span className="text-xs whitespace-nowrap">Baris per halaman:</span>
          <Select
            value={String(rowsPerPage)}
            onValueChange={(v) => {
              const val: RppOption = v === "all" ? "all" : (Number(v) as RppOption);
              localStorage.setItem(LS_RPP_KEY, String(val));
              setRowsPerPage(val);
              setPage(1);
              load(1, sortBy, sortDir, val);
            }}
          >
            <SelectTrigger className="h-8 w-24 text-xs">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {RPP_OPTIONS.map((opt) => (
                <SelectItem key={String(opt)} value={String(opt)} className="text-xs">
                  {opt === "all" ? "Semua" : opt}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        {/* Page info + nav */}
        <div className="flex items-center gap-3">
          <span className="text-xs">
            {rowsPerPage === "all" || total <= effectiveLimit
              ? `1–${total} dari ${total}`
              : `Halaman ${page} · ${Math.min((page - 1) * effectiveLimit + 1, total)}–${Math.min(page * effectiveLimit, total)} dari ${total}`}
          </span>
          {rowsPerPage !== "all" && total > effectiveLimit && (
            <div className="flex gap-1">
              <Button variant="outline" size="sm" disabled={page <= 1} onClick={() => { setPage(p => p - 1); load(page - 1, sortBy, sortDir, rowsPerPage); }}>
                <ChevronLeft className="h-4 w-4" />
              </Button>
              <Button variant="outline" size="sm" disabled={page * effectiveLimit >= total} onClick={() => { setPage(p => p + 1); load(page + 1, sortBy, sortDir, rowsPerPage); }}>
                <ChevronRight className="h-4 w-4" />
              </Button>
            </div>
          )}
        </div>
      </div>

      {/* Row Detail Dialog */}
      <Dialog open={!!detailRow} onOpenChange={(open) => { if (!open) setDetailRow(null); }}>
        <DialogContent className="max-w-2xl max-h-[80vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="font-mono text-base">{detailRow?.entry_number}</DialogTitle>
            <DialogDescription asChild>
              <div className="text-xs text-muted-foreground">{detailRow?.date} · {detailRow && moduleLabel(detailRow.source_module)}</div>
            </DialogDescription>
          </DialogHeader>
          {detailRow && (
            <div className="space-y-4 text-sm">
              {/* Status & Type */}
              <div className="flex items-center gap-2 flex-wrap">
                <Badge variant={detailRow.status === "posted" ? "default" : "secondary"} className="text-xs">{detailRow.status}</Badge>
                <span className={`text-xs px-1.5 py-0.5 rounded font-medium ${typeColor(detailRow.account_type)}`}>{detailRow.account_type}</span>
              </div>

              {/* Jurnal / Modul */}
              <div className="rounded-md border bg-muted/30 p-3 space-y-2">
                <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">Jurnal</p>
                <Row label="No. Jurnal" value={<span className="font-mono">{detailRow.entry_number}</span>} />
                <Row label="Tanggal" value={detailRow.date} />
                <Row label="Nama Jurnal" value={detailRow.journal_name} />
                <Row label="Tipe Jurnal" value={detailRow.journal_type} />
                <Row label="Modul" value={moduleLabel(detailRow.source_module)} />
                <Row label="Skema Sumber" value={detailRow.source_schema} />
                {detailRow.source_table && <Row label="Tabel Sumber" value={detailRow.source_table} />}
                {detailRow.source_id != null && <Row label="ID Sumber" value={String(detailRow.source_id)} />}
              </div>

              {/* Akun */}
              <div className="rounded-md border bg-muted/30 p-3 space-y-2">
                <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">Akun</p>
                <Row label="Kode Akun" value={<span className="font-mono">{detailRow.account_code}</span>} />
                <Row label="Nama Akun" value={detailRow.account_name} />
                <Row label="Tipe" value={detailRow.account_type} />
                <Row label="Normal Balance" value={detailRow.normal_balance} />
              </div>

              {/* Entitas */}
              {(detailRow.partner_name || detailRow.source_doc_number || detailRow.payment_method) && (
                <div className="rounded-md border bg-muted/30 p-3 space-y-2">
                  <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">Sumber / Entitas</p>
                  {detailRow.partner_name && <Row label="Nama" value={detailRow.partner_name} />}
                  {detailRow.source_doc_number && <Row label="No. Dokumen" value={<span className="font-mono">{detailRow.source_doc_number}</span>} />}
                  {detailRow.payment_method && (
                    <Row
                      label="Metode Pembayaran"
                      value={
                        <span className={`text-xs px-1.5 py-0.5 rounded font-medium ${
                          detailRow.payment_method === "cash"        ? "bg-emerald-100 text-emerald-700" :
                          detailRow.payment_method === "bank"        ? "bg-blue-100 text-blue-700" :
                          detailRow.payment_method === "qris"        ? "bg-violet-100 text-violet-700" :
                          detailRow.payment_method === "credit_card" ? "bg-orange-100 text-orange-700" :
                          detailRow.payment_method === "debit_card"  ? "bg-sky-100 text-sky-700" :
                          detailRow.payment_method === "cheque"      ? "bg-amber-100 text-amber-700" :
                          "bg-slate-100 text-slate-600"
                        }`}>
                          {PAYMENT_METHODS.find(pm => pm.value === detailRow.payment_method)?.label ?? detailRow.payment_method}
                        </span>
                      }
                    />
                  )}
                </div>
              )}

              {/* Keterangan */}
              {(detailRow.ref || detailRow.entry_description || detailRow.line_description) && (
                <div className="rounded-md border bg-muted/30 p-3 space-y-2">
                  <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">Keterangan</p>
                  {detailRow.ref && <Row label="Ref" value={<span className="font-mono">{detailRow.ref}</span>} />}
                  {detailRow.entry_description && <Row label="Keterangan Entry" value={detailRow.entry_description} />}
                  {detailRow.line_description && <Row label="Keterangan Baris" value={detailRow.line_description} />}
                </div>
              )}

              {/* Nominal */}
              <div className="rounded-md border bg-muted/30 p-3 space-y-2">
                <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">Nominal</p>
                <Row label="Debit" value={<span className="font-mono font-semibold">{Number(detailRow.debit) ? `Rp ${fmt(detailRow.debit)}` : "—"}</span>} />
                <Row label="Kredit" value={<span className={`font-mono font-semibold ${Number(detailRow.credit) > 0 ? "text-red-600" : ""}`}>{Number(detailRow.credit) ? `Rp ${fmt(detailRow.credit)}` : "—"}</span>} />
                {detailRow.running_balance !== null && (
                  <Row
                    label="Saldo Berjalan"
                    value={
                      <span className={`font-mono font-semibold ${Number(detailRow.running_balance) < 0 ? "text-red-600" : "text-primary"}`}>
                        {fmtBalance(Number(detailRow.running_balance))}
                      </span>
                    }
                  />
                )}
              </div>

              {/* Metadata */}
              <div className="rounded-md border bg-muted/30 p-3 space-y-2">
                <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">Metadata</p>
                <Row label="Company ID" value={String(detailRow.company_id)} />
                {detailRow.branch_id != null && <Row label="Branch ID" value={String(detailRow.branch_id)} />}
                {detailRow.division_id != null && <Row label="Division ID" value={String(detailRow.division_id)} />}
                <Row label="Dibuat" value={new Date(detailRow.created_at).toLocaleString("id-ID")} />
                {detailRow.posted_at && <Row label="Diposting" value={new Date(detailRow.posted_at).toLocaleString("id-ID")} />}
                <Row label="Line ID" value={<span className="font-mono text-xs text-muted-foreground">{detailRow.line_id}</span>} />
                <Row label="Entry ID" value={<span className="font-mono text-xs text-muted-foreground">{detailRow.entry_id}</span>} />
              </div>
            </div>
          )}
          <DialogFooter>
            <Button variant="outline" size="sm" onClick={() => setDetailRow(null)}>Tutup</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Void Confirmation Dialog */}
      <Dialog open={!!voidDialog?.open} onOpenChange={(open) => { if (!open) setVoidDialog(null); }}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2 text-red-600">
              <AlertTriangle className="h-5 w-5" />
              Batalkan Entry Jurnal
            </DialogTitle>
            <DialogDescription className="space-y-2 pt-1">
              <p>Anda akan membatalkan entry berikut:</p>
              <div className="bg-muted rounded-md p-3 text-sm space-y-1">
                <div><span className="text-muted-foreground">No. Jurnal:</span> <span className="font-mono font-semibold">{voidDialog?.entryNumber}</span></div>
                <div><span className="text-muted-foreground">Keterangan:</span> <span>{voidDialog?.description}</span></div>
              </div>
              <p className="text-amber-600 text-xs">
                Sistem akan membuat <strong>jurnal pembalik</strong> secara otomatis. Entry asli tetap tersimpan sebagai audit trail. Saldo akun di Trial Balance akan menjadi nol setelah pembatalan.
              </p>
              {voidError && (
                <div className="bg-red-50 border border-red-300 text-red-700 rounded px-3 py-2 text-xs">
                  {voidError}
                </div>
              )}
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setVoidDialog(null)} disabled={voidLoading}>
              Batal
            </Button>
            <Button variant="destructive" onClick={handleVoid} disabled={voidLoading}>
              {voidLoading ? "Memproses..." : "Ya, Batalkan Entry"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
