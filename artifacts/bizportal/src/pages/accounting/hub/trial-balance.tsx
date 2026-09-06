import { DatePicker } from "@/components/ui/date-picker";
import { useCallback, useEffect, useRef, useState } from "react";
import type { ReactNode } from "react";
import { Link, useLocation, useSearch } from "wouter";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { RefreshCw, ArrowLeft, ExternalLink, ChevronDown, ChevronRight, Plus, Loader2 } from "lucide-react";

interface TBRow {
  account_id: number; code: string; name: string; type: string;
  parent_id: number | null; is_header: boolean; is_postable: boolean;
  company_id: number; branch_id: number | null; division_id: number | null;
  company_name: string | null; company_code: string | null;
  total_debit: string; total_credit: string; balance: string;
  counterparty_companies: string | null;
}

interface CompanyOption {
  id: number;
  name: string;
  code: string;
}

const fmt = (v: string | number) =>
  new Intl.NumberFormat("id-ID", { minimumFractionDigits: 0, maximumFractionDigits: 0 }).format(Number(v));

const typeColor: Record<string, string> = {
  asset:     "text-blue-300",
  liability: "text-red-300",
  equity:    "text-purple-300",
  revenue:   "text-green-300",
  expense:   "text-orange-300",
};

export default function AccountingHubTrialBalancePage() {
  const search = useSearch();
  const urlParams = new URLSearchParams(search);
  const [rows, setRows] = useState<TBRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [companies, setCompanies] = useState<CompanyOption[]>([]);
  const [filters, setFilters] = useState(() => ({
    company_id: urlParams.get("company_id") ?? "",
    date_from: urlParams.get("date_from") ?? "",
    date_to: urlParams.get("date_to") ?? "",
  }));
  const [expandedRows, setExpandedRows] = useState<Set<string>>(new Set());
  const [, navigate] = useLocation();
  const requestVersion = useRef(0);
  const [childParent, setChildParent] = useState<TBRow | null>(null);
  const [childName, setChildName] = useState("");
  const [childSaving, setChildSaving] = useState(false);
  const [childError, setChildError] = useState<string | null>(null);

  // Load company list for dropdown
  useEffect(() => {
    fetch("/api/companies/list", { credentials: "include" })
      .then(r => r.json())
      .then(data => setCompanies(Array.isArray(data) ? data : (data.data ?? [])))
      .catch(() => {});
  }, []);

  const load = useCallback(async () => {
    const version = ++requestVersion.current;
    setLoading(true);
    setError(null);
    setRows([]);   // bersihkan data lama agar tidak tampil stale saat ganti filter
    setExpandedRows(new Set());
    try {
      const params = new URLSearchParams();
      Object.entries(filters).forEach(([k, v]) => { if (v) params.set(k, v); });
      const res = await fetch(`/api/accounting/hub/trial-balance?${params}`, { credentials: "include" });
      if (!res.ok) {
        const msg = await res.text().catch(() => "");
        if (version === requestVersion.current) {
          setError(`Gagal memuat data: ${res.status}${msg ? ` — ${msg}` : ""}`);
        }
        return;
      }
      const json = await res.json();
      // A slower all-company request must not overwrite a newer company
      // selection that finished first.
      if (version !== requestVersion.current) return;
      setRows(json.data ?? []);
    } catch (e: unknown) {
      if (version === requestVersion.current) {
        setError(e instanceof Error ? e.message : "Terjadi kesalahan saat memuat data");
      }
    } finally {
      if (version === requestVersion.current) setLoading(false);
    }
  }, [filters]);

  useEffect(() => { void load(); }, [load]);

  const totDebit  = rows.reduce((s, r) => s + Number(r.total_debit), 0);
  const totCredit = rows.reduce((s, r) => s + Number(r.total_credit), 0);
  const totBal    = rows.reduce((s, r) => s + Number(r.balance), 0);
  const balanced  = Math.abs(totDebit - totCredit) < 1;

  // Find account codes that appear more than once (same account, different companies)
  const codeCounts: Record<string, number> = {};
  for (const r of rows) codeCounts[r.code] = (codeCounts[r.code] ?? 0) + 1;

  // The API returns rolled-up parent rows as well as their descendants. Keep
  // the expansion key scoped to the same company/branch/division so that
  // expanding one company's account does not expand its counterpart elsewhere.
  const contextKey = (r: TBRow) =>
    `${r.company_id ?? "global"}-${r.branch_id ?? "all"}-${r.division_id ?? "all"}`;
  const rowKey = (r: TBRow) => `${contextKey(r)}-${r.account_id}`;

  const rowKeys = new Set(rows.map(rowKey));
  const childrenByParentKey = new Map<string, TBRow[]>();
  for (const r of rows) {
    if (r.parent_id == null) continue;
    const parentKey = `${contextKey(r)}-${r.parent_id}`;
    const children = childrenByParentKey.get(parentKey) ?? [];
    children.push(r);
    childrenByParentKey.set(parentKey, children);
  }

  // Only roots (parents, or accounts whose parent is not present in the
  // filtered result) are rendered at first. Descendants are rendered
  // recursively after their parent is expanded.
  const grouped: Record<string, TBRow[]> = {};
  for (const r of rows) {
    const parentKey = r.parent_id == null ? null : `${contextKey(r)}-${r.parent_id}`;
    if (parentKey && rowKeys.has(parentKey)) continue;
    if (!grouped[r.type]) grouped[r.type] = [];
    grouped[r.type].push(r);
  }

  const toggleExpanded = (r: TBRow) => {
    const key = rowKey(r);
    setExpandedRows(current => {
      const next = new Set(current);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  };

  function drillDown(r: TBRow) {
    if (r.is_header) return;
    const params = new URLSearchParams({ account_id: String(r.account_id) });
    if (filters.company_id) params.set("company_id", filters.company_id);
    if (filters.date_from)  params.set("date_from",  filters.date_from);
    if (filters.date_to)    params.set("date_to",    filters.date_to);
    navigate(`/accounting/hub/general-ledger?${params}`);
  }

  async function addChildAccount() {
    const name = childName.trim();
    if (!childParent || !name) {
      setChildError("Deskripsi akun wajib diisi.");
      return;
    }
    setChildSaving(true);
    setChildError(null);
    try {
      const response = await fetch(`/api/accounting/accounts/${childParent.account_id}/child`, {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name }),
      });
      const body = await response.json().catch(() => ({}));
      if (!response.ok) {
        throw new Error(body.message ?? body.error ?? "Gagal menambahkan COA.");
      }
      const parentForRefresh = childParent;
      setChildParent(null);
      setChildName("");
      await load();
      setExpandedRows(new Set([rowKey(parentForRefresh)]));
    } catch (error) {
      setChildError(error instanceof Error ? error.message : "Gagal menambahkan COA.");
    } finally {
      setChildSaving(false);
    }
  }

  function renderAccountRows(r: TBRow, depth = 0): ReactNode[] {
    const key = rowKey(r);
    const children = childrenByParentKey.get(key) ?? [];
    const canExpand = children.length > 0;
    const canAddChild = r.is_header || canExpand;
    const isExpanded = expandedRows.has(key);

    return [
      <tr
        key={key}
        className={`border-t bg-black group ${canExpand || !r.is_header ? "cursor-pointer" : ""}`}
        onClick={() => {
          if (canExpand) toggleExpanded(r);
          else drillDown(r);
        }}
        title={canExpand
          ? `${isExpanded ? "Sembunyikan" : "Tampilkan"} akun child ${r.code} – ${r.name}`
          : r.is_header
            ? `Saldo akumulasi akun child ${r.code} – ${r.name}`
            : `Klik untuk lihat detail transaksi akun ${r.code} – ${r.name}`}
        aria-expanded={canExpand ? isExpanded : undefined}
      >
        <td className="px-3 py-2 font-mono text-xs group-hover:text-primary">
          <div className="flex items-center" style={{ paddingLeft: `${depth * 20}px` }}>
            {canExpand ? (
              <button
                type="button"
                className="mr-1 inline-flex h-5 w-5 items-center justify-center rounded hover:bg-white/10"
                aria-label={`${isExpanded ? "Sembunyikan" : "Tampilkan"} child ${r.code}`}
                onClick={(event) => {
                  event.stopPropagation();
                  toggleExpanded(r);
                }}
              >
                {isExpanded
                  ? <ChevronDown className="h-3.5 w-3.5" />
                  : <ChevronRight className="h-3.5 w-3.5" />}
              </button>
            ) : (
              <span className="mr-1 inline-block h-5 w-5" aria-hidden="true" />
            )}
            <span>{r.code}</span>
          </div>
        </td>
        <td className={`px-3 py-2 group-hover:text-primary ${r.is_header ? "font-bold" : "font-medium"}`}>
          <span>{r.name}</span>
          {r.is_header && (
            <span className="ml-2 text-[10px] font-semibold uppercase tracking-wide text-emerald-700">
              Total child
            </span>
          )}
          {/* Tampilkan badge company hanya saat mode "Semua Perusahaan" (tidak ada filter company)
              supaya parent account yang muncul untuk banyak company bisa dibedakan.
              Saat filter company aktif, semua baris sudah milik company yang sama — badge tidak relevan. */}
          {!filters.company_id && codeCounts[r.code] > 1 && r.company_name && (
            <span className="ml-2 text-xs font-normal text-muted-foreground bg-muted px-1.5 py-0.5 rounded">
              {r.company_name}
            </span>
          )}
          {r.counterparty_companies && (
            <span
              className="ml-2 text-xs font-normal text-blue-600 bg-blue-50 border border-blue-200 px-1.5 py-0.5 rounded"
              title={r.code === '2-2098' ? `Pemberi dana (CST): ${r.counterparty_companies}` : `Counterparty intercompany: ${r.counterparty_companies}`}
            >
              {r.counterparty_companies}
            </span>
          )}
        </td>
        <td className={`px-3 py-2 text-xs font-medium ${typeColor[r.type]}`}>{r.type}</td>
        <td className="px-3 py-2 text-right font-mono text-xs">{fmt(r.total_debit)}</td>
        <td className="px-3 py-2 text-right font-mono text-xs">{fmt(r.total_credit)}</td>
        <td className={`px-3 py-2 text-right font-mono text-xs font-semibold ${Number(r.balance) < 0 ? "text-red-600" : ""}`}>{fmt(r.balance)}</td>
        <td className="px-3 py-2 text-center">
          <div className="flex items-center justify-center gap-1">
            {canAddChild && filters.company_id && (
              <button
                type="button"
                className="inline-flex h-6 w-6 items-center justify-center rounded border border-emerald-300 text-emerald-700 hover:bg-emerald-50"
                title={`Tambah COA di bawah ${r.code} — ${r.name}`}
                aria-label={`Tambah COA di bawah ${r.code}`}
                onClick={(event) => {
                  event.stopPropagation();
                  setChildError(null);
                  setChildName("");
                  setChildParent(r);
                }}
              >
                <Plus className="h-3.5 w-3.5" />
              </button>
            )}
            {canExpand
              ? (isExpanded
                ? <ChevronDown className="h-3.5 w-3.5 text-muted-foreground" />
                : <ChevronRight className="h-3.5 w-3.5 text-muted-foreground" />)
              : <ExternalLink className="h-3.5 w-3.5 text-muted-foreground group-hover:text-primary" />}
          </div>
        </td>
      </tr>,
      ...(canExpand && isExpanded
        ? children.flatMap(child => renderAccountRows(child, depth + 1))
        : []),
    ];
  }

  return (
    <div className="p-6 space-y-4">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <Link href="/accounting/hub">
            <Button variant="ghost" size="sm" className="h-8 w-8 p-0">
              <ArrowLeft className="h-4 w-4" />
            </Button>
          </Link>
          <div>
            <h1 className="text-xl font-bold">Neraca Saldo (Trial Balance)</h1>
            <p className="text-xs text-muted-foreground">{rows.length} akun · klik parent untuk tampilkan child, klik akun detail untuk lihat transaksi</p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <span className={`text-xs font-semibold px-2 py-1 rounded ${balanced ? "bg-green-100 text-green-700" : "bg-red-100 text-red-700"}`}>
            {balanced ? "✓ Seimbang" : "✗ Tidak Seimbang"}
          </span>
          <Button variant="outline" size="sm" onClick={load} disabled={loading}>
            <RefreshCw className={`h-4 w-4 mr-2 ${loading ? "animate-spin" : ""}`} />Refresh
          </Button>
        </div>
      </div>

      {error && (
        <div className="bg-red-50 border border-red-300 text-red-800 rounded-md px-4 py-3 text-sm flex items-center gap-2">
          <span>⚠</span> {error}
        </div>
      )}

      <Dialog
        open={childParent !== null}
        onOpenChange={(open) => {
          if (!open && !childSaving) {
            setChildParent(null);
            setChildName("");
            setChildError(null);
          }
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Tambah COA di bawah parent</DialogTitle>
          </DialogHeader>
          <div className="space-y-3">
            <div className="rounded-md border bg-muted/30 px-3 py-2 text-sm">
              <div className="text-xs text-muted-foreground">Parent</div>
              <div className="font-mono font-semibold">
                {childParent?.code} — {childParent?.name}
              </div>
              <div className="mt-1 text-xs text-muted-foreground">
                Nomor COA dibuat otomatis dan mengikuti urutan child yang sudah ada.
              </div>
            </div>
            <div className="space-y-1.5">
              <label htmlFor="trial-balance-child-name" className="text-sm font-medium">
                Deskripsi / Nama COA
              </label>
              <Input
                id="trial-balance-child-name"
                value={childName}
                onChange={(event) => setChildName(event.target.value)}
                placeholder="Contoh: Beban Internet"
                autoFocus
                disabled={childSaving}
                onKeyDown={(event) => {
                  if (event.key === "Enter") void addChildAccount();
                }}
              />
            </div>
            {childError && <p className="text-sm text-destructive">{childError}</p>}
          </div>
          <DialogFooter>
            <Button
              variant="outline"
              disabled={childSaving}
              onClick={() => setChildParent(null)}
            >
              Batal
            </Button>
            <Button disabled={childSaving || !childName.trim()} onClick={() => void addChildAccount()}>
              {childSaving && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              Simpan COA
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Filters */}
      <Card>
        <CardContent className="pt-4">
          <div className="flex flex-wrap gap-2 items-center">
            {/* Company / Perusahaan dropdown */}
            <Select
              value={filters.company_id || "all"}
              onValueChange={v => setFilters(f => ({ ...f, company_id: v === "all" ? "" : v }))}
            >
              <SelectTrigger className="w-48">
                <SelectValue placeholder="Semua Perusahaan" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">Semua Perusahaan</SelectItem>
                {companies.map(c => (
                  <SelectItem key={c.id} value={String(c.id)}>
                    {c.code ? `${c.code} – ${c.name}` : c.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>

            <DatePicker value={filters.date_from} onChange={v => setFilters(f => ({...f, date_from: v}))} className="w-40" />
            <DatePicker value={filters.date_to}   onChange={v => setFilters(f => ({...f, date_to:   v}))} className="w-40" />
            <Button size="sm" onClick={load}>Terapkan</Button>
          </div>
        </CardContent>
      </Card>

      {/* Table */}
      <div className="rounded-md border bg-black overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="bg-black text-muted-foreground text-xs">
            <tr>
              <th className="px-3 py-2 text-left">Kode</th>
              <th className="px-3 py-2 text-left">Nama Akun</th>
              <th className="px-3 py-2 text-left">Tipe</th>
              <th className="px-3 py-2 text-right">Total Debit</th>
              <th className="px-3 py-2 text-right">Total Kredit</th>
              <th className="px-3 py-2 text-right">Saldo</th>
              <th className="px-3 py-2 text-center w-12">Audit</th>
            </tr>
          </thead>
          <tbody>
            {Object.entries(grouped).map(([type, rws]) => (
              <>
                <tr key={`hdr-${type}`} className="bg-black">
                  <td colSpan={7} className={`px-3 py-1.5 font-semibold text-xs uppercase tracking-wide ${typeColor[type]}`}>{type}</td>
                </tr>
                {rws.flatMap(r => renderAccountRows(r))}
              </>
            ))}
          </tbody>
          <tfoot className="bg-black font-semibold text-xs">
            <tr>
              <td colSpan={3} className="px-3 py-2">TOTAL</td>
              <td className="px-3 py-2 text-right font-mono">{fmt(totDebit)}</td>
              <td className="px-3 py-2 text-right font-mono">{fmt(totCredit)}</td>
              <td className={`px-3 py-2 text-right font-mono ${Math.abs(totBal) > 1 ? "text-red-600" : ""}`}>{fmt(totBal)}</td>
              <td />
            </tr>
          </tfoot>
        </table>
      </div>
    </div>
  );
}
