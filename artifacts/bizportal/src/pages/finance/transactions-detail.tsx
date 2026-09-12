import { DatePicker } from "@/components/ui/date-picker";
import { useEffect, useState } from "react";
import { AppShell } from "@/components/layout/AppShell";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Link, useLocation } from "wouter";
import { ArrowLeft, ChevronRight, Search, RefreshCw, Layers } from "lucide-react";
import { useCompany } from "@/contexts/CompanyContext";

const idr = (n: number) =>
  new Intl.NumberFormat("id-ID", { minimumFractionDigits: 0, maximumFractionDigits: 0 }).format(Math.abs(n));

const idrShort = (n: number) => {
  const abs = Math.abs(n);
  const sign = n < 0 ? "-" : "";
  if (abs >= 1_000_000_000) return `${sign}Rp ${(abs / 1_000_000_000).toFixed(1)}M`;
  if (abs >= 1_000_000) return `${sign}Rp ${(abs / 1_000_000).toFixed(1)}jt`;
  return `${sign}Rp ${idr(abs)}`;
};

async function apiFetch<T>(url: string): Promise<T> {
  const r = await fetch(url, { credentials: "include" });
  if (!r.ok) throw new Error("fetch failed");
  return r.json();
}

interface LedgerRow {
  date: string;
  entryNumber: string;
  ref: string | null;
  description: string | null;
  debit: number;
  credit: number;
  balance: number;
}

interface LedgerAccount {
  accountId: number;
  code: string;
  name: string;
  type: string;
  rows: LedgerRow[];
  totalDebit: number;
  totalCredit: number;
  endingBalance: number;
}

interface FlatRow extends LedgerRow {
  accountCode: string;
  accountName: string;
  accountId: number;
}

const PAGE_SIZE = 50;

function getSearchParams() {
  return new URLSearchParams(typeof window !== "undefined" ? window.location.search : "");
}

export default function TransactionsDetailPage() {
  const { activeCompanyId } = useCompany();

  const sp = getSearchParams();
  const accountId      = sp.get("accountId") ? Number(sp.get("accountId")) : null;
  const accountName    = sp.get("accountName") ?? "Semua Akun";
  const accountCode    = sp.get("accountCode") ?? "";
  const accountGroup   = sp.get("accountGroup") ?? "";
  const initFrom       = sp.get("startDate") ?? "";
  const initTo         = sp.get("endDate") ?? "";
  const spCompany      = sp.get("company") ? Number(sp.get("company")) : null;
  const costCenter     = sp.get("costCenter") ?? "";
  const companyId      = spCompany ?? activeCompanyId ?? 1;

  const now = new Date();
  const defaultFrom = initFrom || `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-01`;
  const defaultTo   = initTo   || new Date(now.getFullYear(), now.getMonth() + 1, 0).toISOString().slice(0, 10);

  const [from, setFrom] = useState(defaultFrom);
  const [to, setTo]     = useState(defaultTo);
  const [search, setSearch] = useState("");
  const [loading, setLoading] = useState(true);
  const [page, setPage] = useState(1);
  const [refreshed, setRefreshed] = useState(0);

  const [account, setAccount] = useState<LedgerAccount | null>(null);
  const [groupAccounts, setGroupAccounts] = useState<LedgerAccount[]>([]);

  const isGroupMode = !!accountGroup && !accountId;

  useEffect(() => {
    setLoading(true);
    setPage(1);

    if (isGroupMode) {
      const params = new URLSearchParams({ company: String(companyId), startDate: from, endDate: to });
      if (costCenter) params.set("cost_center_id", costCenter);
      apiFetch<{ accounts: LedgerAccount[] }>(`/api/accounting/reports/general-ledger?${params}`)
        .then((d) => {
          const matched = (d.accounts ?? []).filter((a) => a.type === accountGroup);
          setGroupAccounts(matched);
          setAccount(null);
        })
        .catch(() => setGroupAccounts([]))
        .finally(() => setLoading(false));
    } else if (accountId) {
      const params = new URLSearchParams({ company: String(companyId), startDate: from, endDate: to, accountId: String(accountId) });
      if (costCenter) params.set("cost_center_id", costCenter);
      apiFetch<{ accounts: LedgerAccount[] }>(`/api/accounting/reports/general-ledger?${params}`)
        .then((d) => { setAccount(d.accounts?.[0] ?? null); setGroupAccounts([]); })
        .catch(() => setAccount(null))
        .finally(() => setLoading(false));
    } else {
      setLoading(false);
    }
  }, [accountId, accountGroup, isGroupMode, companyId, from, to, costCenter, refreshed]);

  const flatRows: FlatRow[] = isGroupMode
    ? groupAccounts
        .flatMap((a) => a.rows.map((r) => ({ ...r, accountCode: a.code, accountName: a.name, accountId: a.accountId })))
        .sort((a, b) => a.date === b.date ? a.entryNumber.localeCompare(b.entryNumber) : b.date.localeCompare(a.date))
    : (account?.rows ?? []).map((r) => ({ ...r, accountCode, accountName, accountId: accountId ?? 0 }));

  const filtered: FlatRow[] = search
    ? flatRows.filter((r) =>
        [r.entryNumber, r.ref, r.description, r.accountName, r.accountCode]
          .some((v) => v?.toLowerCase().includes(search.toLowerCase()))
      )
    : flatRows;

  const totalPages = Math.ceil(filtered.length / PAGE_SIZE);
  const paged = filtered.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE);

  const totalDebit   = isGroupMode
    ? groupAccounts.reduce((s, a) => s + a.totalDebit, 0)
    : (account?.totalDebit ?? 0);
  const totalCredit  = isGroupMode
    ? groupAccounts.reduce((s, a) => s + a.totalCredit, 0)
    : (account?.totalCredit ?? 0);
  const endingBalance = isGroupMode
    ? groupAccounts.reduce((s, a) => s + a.endingBalance, 0)
    : (account?.endingBalance ?? 0);

  const fmtDate = (d: string) =>
    new Date(d).toLocaleDateString("id-ID", { day: "2-digit", month: "short", year: "numeric" });

  const groupLabel = accountGroup === "revenue" ? "Semua Akun Pendapatan" : accountGroup === "expense" ? "Semua Akun Beban" : accountGroup;
  const displayTitle = isGroupMode ? groupLabel : accountName;
  const displayCode  = isGroupMode ? "" : accountCode;
  const totalEntries = isGroupMode ? groupAccounts.reduce((s, a) => s + a.rows.length, 0) : (account?.rows.length ?? 0);
  const accountsCount = isGroupMode ? groupAccounts.length : null;

  return (
    <AppShell>
      <div className="space-y-5 p-6 max-w-6xl mx-auto">
        {/* Header */}
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <Button variant="ghost" size="sm" className="gap-1.5 text-muted-foreground h-8"
              onClick={() => window.history.back()}>
              <ArrowLeft className="h-3.5 w-3.5" />
              Kembali
            </Button>
            <div className="w-px h-5 bg-border" />
            <div>
              <h1 className="text-lg font-bold text-foreground flex items-center gap-2">
                {isGroupMode && <Layers className={`h-4 w-4 ${accountGroup === "revenue" ? "text-emerald-400" : "text-rose-400"}`} />}
                {displayCode && <span className="font-mono text-sm text-muted-foreground">{displayCode}</span>}
                {displayTitle}
              </h1>
              <p className="text-xs text-muted-foreground">
                {from} s/d {to}
                {!loading && ` · ${totalEntries} entri`}
                {!loading && accountsCount !== null && ` · ${accountsCount} akun`}
                {costCenter && ` · CC: ${costCenter}`}
              </p>
            </div>
          </div>
          <Button variant="outline" size="sm" onClick={() => setRefreshed((x) => x + 1)} disabled={loading} className="gap-1.5">
            <RefreshCw className={`h-3.5 w-3.5 ${loading ? "animate-spin" : ""}`} />
          </Button>
        </div>

        {/* Filters */}
        <Card>
          <CardContent className="p-4">
            <div className="flex flex-wrap items-end gap-4">
              <div className="flex flex-col gap-1">
                <Label className="text-xs text-muted-foreground">Dari</Label>
                <DatePicker value={from} onChange={(v) => setFrom(v)} className="h-8 text-sm w-36" />
              </div>
              <div className="flex flex-col gap-1">
                <Label className="text-xs text-muted-foreground">Sampai</Label>
                <DatePicker value={to} onChange={(v) => setTo(v)} className="h-8 text-sm w-36" />
              </div>
              <div className="flex flex-col gap-1 flex-1 min-w-48">
                <Label className="text-xs text-muted-foreground">Cari</Label>
                <div className="relative">
                  <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
                  <Input value={search} onChange={(e) => { setSearch(e.target.value); setPage(1); }}
                    placeholder={isGroupMode ? "Akun, no. jurnal, referensi..." : "No. jurnal, referensi, deskripsi..."}
                    className="h-8 text-sm pl-8" />
                </div>
              </div>
            </div>
          </CardContent>
        </Card>

        {/* Summary */}
        {!loading && (account || groupAccounts.length > 0) && (
          <div className="grid grid-cols-3 gap-4">
            <div className="bg-green-950/40 border border-green-800/50 rounded-lg p-4">
              <p className="text-xs text-muted-foreground font-medium uppercase tracking-wide mb-1">Total Debit</p>
              <p className="text-xl font-bold text-green-400">Rp {idr(totalDebit)}</p>
            </div>
            <div className="bg-red-950/40 border border-red-800/50 rounded-lg p-4">
              <p className="text-xs text-muted-foreground font-medium uppercase tracking-wide mb-1">Total Kredit</p>
              <p className="text-xl font-bold text-red-400">Rp {idr(totalCredit)}</p>
            </div>
            <div className="bg-muted/30 border border-border rounded-lg p-4">
              <p className="text-xs text-muted-foreground font-medium uppercase tracking-wide mb-1">Net</p>
              <p className={`text-xl font-bold ${endingBalance < 0 ? "text-red-400" : "text-foreground"}`}>
                {endingBalance < 0 ? "- " : ""}Rp {idr(Math.abs(endingBalance))}
              </p>
            </div>
          </div>
        )}

        {/* Group-mode: per-account breakdown */}
        {isGroupMode && !loading && groupAccounts.length > 0 && (
          <Card>
            <CardHeader className="py-3 px-5">
              <CardTitle className="text-sm font-semibold">
                Breakdown per Akun ({groupAccounts.length})
              </CardTitle>
            </CardHeader>
            <CardContent className="px-0 pb-0">
              <table className="w-full text-sm">
                <thead className="bg-muted/30 text-xs text-muted-foreground border-b border-border">
                  <tr>
                    <th className="text-left px-5 py-2 font-medium">Kode</th>
                    <th className="text-left px-3 py-2 font-medium">Nama Akun</th>
                    <th className="text-right px-3 py-2 font-medium">Debit</th>
                    <th className="text-right px-3 py-2 font-medium">Kredit</th>
                    <th className="text-right px-5 py-2 font-medium">Net</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border">
                  {groupAccounts.map((a) => {
                    const sp2 = new URLSearchParams({
                      accountId: String(a.accountId), accountName: a.name, accountCode: a.code,
                      startDate: from, endDate: to, company: String(companyId),
                      ...(costCenter ? { costCenter } : {}),
                    });
                    return (
                      <Link key={a.accountId} href={`/finance/transactions/detail?${sp2}`}>
                        <tr className="hover:bg-white/5 cursor-pointer transition-colors group">
                          <td className="px-5 py-2.5 font-mono text-xs text-muted-foreground">{a.code}</td>
                          <td className="px-3 py-2.5 text-foreground group-hover:text-blue-400">{a.name}
                            <span className="ml-2 text-xs text-muted-foreground">({a.rows.length} entri)</span>
                          </td>
                          <td className="px-3 py-2.5 text-right text-green-400">{a.totalDebit > 0 ? idrShort(a.totalDebit) : "—"}</td>
                          <td className="px-3 py-2.5 text-right text-red-400">{a.totalCredit > 0 ? idrShort(a.totalCredit) : "—"}</td>
                          <td className="px-5 py-2.5 text-right font-semibold text-foreground">{idrShort(a.endingBalance)}</td>
                        </tr>
                      </Link>
                    );
                  })}
                </tbody>
              </table>
            </CardContent>
          </Card>
        )}

        {/* Main Transaction Table */}
        <Card>
          <CardHeader className="py-3 px-5 flex flex-row items-center justify-between">
            <CardTitle className="text-sm font-semibold">
              {filtered.length} Transaksi
              {isGroupMode && <Badge variant="outline" className={`ml-2 text-xs ${accountGroup === "revenue" ? "border-emerald-600 text-emerald-400" : "border-rose-600 text-rose-400"}`}>
                {accountGroup === "revenue" ? "Pendapatan" : "Beban"}
              </Badge>}
              {search && ` (filter: "${search}")`}
            </CardTitle>
            {totalPages > 1 && (
              <div className="flex items-center gap-2 text-xs text-muted-foreground">
                <Button variant="ghost" size="sm" className="h-7 px-2" onClick={() => setPage((p) => Math.max(1, p - 1))} disabled={page === 1}>‹</Button>
                <span>Hal. {page} / {totalPages}</span>
                <Button variant="ghost" size="sm" className="h-7 px-2" onClick={() => setPage((p) => Math.min(totalPages, p + 1))} disabled={page === totalPages}>›</Button>
              </div>
            )}
          </CardHeader>
          <CardContent className="px-0 pb-0">
            {loading ? (
              <div className="h-48 bg-muted/20 m-5 rounded animate-pulse" />
            ) : (!accountId && !isGroupMode) ? (
              <div className="py-16 text-center text-muted-foreground text-sm">
                Pilih akun COA untuk melihat transaksi
              </div>
            ) : paged.length === 0 ? (
              <div className="py-16 text-center text-muted-foreground text-sm">Tidak ada transaksi untuk periode ini</div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead className="bg-muted/30 text-xs text-muted-foreground border-b border-border">
                    <tr>
                      <th className="text-left px-5 py-2.5 font-medium">Tanggal</th>
                      <th className="text-left px-3 py-2.5 font-medium">No. Jurnal</th>
                      {isGroupMode && <th className="text-left px-3 py-2.5 font-medium">Akun</th>}
                      <th className="text-left px-3 py-2.5 font-medium">Referensi</th>
                      <th className="text-left px-3 py-2.5 font-medium">Deskripsi</th>
                      <th className="text-right px-3 py-2.5 font-medium">Debit</th>
                      <th className="text-right px-3 py-2.5 font-medium">Kredit</th>
                      {!isGroupMode && <th className="text-right px-5 py-2.5 font-medium">Saldo</th>}
                      <th className="px-3 py-2.5" />
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-border">
                    {paged.map((row, i) => (
                      <tr key={i} className="hover:bg-white/5 transition-colors duration-150 group">
                        <td className="px-5 py-2.5 text-xs text-foreground whitespace-nowrap">
                          {fmtDate(row.date)}
                        </td>
                        <td className="px-3 py-2.5 font-mono text-xs text-foreground whitespace-nowrap">
                          {row.entryNumber}
                        </td>
                        {isGroupMode && (
                          <td className="px-3 py-2.5 text-xs max-w-[160px]">
                            <span className="font-mono text-muted-foreground mr-1">{row.accountCode}</span>
                            <span className="text-foreground truncate">{row.accountName}</span>
                          </td>
                        )}
                        <td className="px-3 py-2.5 text-xs text-foreground max-w-[120px] truncate">
                          {row.ref ?? "—"}
                        </td>
                        <td className="px-3 py-2.5 text-foreground max-w-[200px] truncate">
                          {row.description ?? "—"}
                        </td>
                        <td className="px-3 py-2.5 text-right text-green-400 font-medium whitespace-nowrap">
                          {row.debit > 0 ? `Rp ${idr(row.debit)}` : "—"}
                        </td>
                        <td className="px-3 py-2.5 text-right text-red-400 font-medium whitespace-nowrap">
                          {row.credit > 0 ? `Rp ${idr(row.credit)}` : "—"}
                        </td>
                        {!isGroupMode && (
                          <td className="px-5 py-2.5 text-right font-semibold text-foreground whitespace-nowrap">
                            {row.balance !== 0 ? `Rp ${idr(row.balance)}` : "0"}
                          </td>
                        )}
                        <td className="px-3 py-2.5">
                          <Link href={`/accounting/entries?search=${encodeURIComponent(row.entryNumber)}`}>
                            <ChevronRight className="h-3.5 w-3.5 text-muted-foreground opacity-0 group-hover:opacity-100 transition-opacity" />
                          </Link>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                  <tfoot className="bg-muted/30 text-sm font-semibold border-t-2 border-border">
                    <tr>
                      <td colSpan={isGroupMode ? 5 : 4} className="px-5 py-2.5 text-foreground">Total ({filtered.length})</td>
                      <td className="px-3 py-2.5 text-right text-green-400">Rp {idr(totalDebit)}</td>
                      <td className="px-3 py-2.5 text-right text-red-400">Rp {idr(totalCredit)}</td>
                      {!isGroupMode && (
                        <td className="px-5 py-2.5 text-right text-foreground">
                          {endingBalance < 0 ? "- " : ""}Rp {idr(Math.abs(endingBalance))}
                        </td>
                      )}
                      <td />
                    </tr>
                  </tfoot>
                </table>
              </div>
            )}
          </CardContent>
        </Card>

        {/* Pagination */}
        {totalPages > 1 && (
          <div className="flex items-center justify-center gap-2">
            <Button variant="outline" size="sm" onClick={() => setPage(1)} disabled={page === 1}>«</Button>
            <Button variant="outline" size="sm" onClick={() => setPage((p) => Math.max(1, p - 1))} disabled={page === 1}>‹</Button>
            <span className="text-sm text-muted-foreground px-3">
              Hal. {page} / {totalPages} ({filtered.length} transaksi)
            </span>
            <Button variant="outline" size="sm" onClick={() => setPage((p) => Math.min(totalPages, p + 1))} disabled={page === totalPages}>›</Button>
            <Button variant="outline" size="sm" onClick={() => setPage(totalPages)} disabled={page === totalPages}>»</Button>
          </div>
        )}
      </div>
    </AppShell>
  );
}
