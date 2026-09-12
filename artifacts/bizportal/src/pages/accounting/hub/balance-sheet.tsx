import { DatePicker } from "@/components/ui/date-picker";
import { useCallback, useEffect, useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import { RefreshCw, ArrowLeft, ChevronRight, ExternalLink, Loader2 } from "lucide-react";
import { Link } from "wouter";

interface BSRow {
  account_type: string; account_id: number; code: string; name: string;
  company_id: number | null; company_code: string | null; branch_id: number | null;
  total_debit: string; total_credit: string; balance: string;
}

interface Summary { total_assets: number; total_liabilities: number; total_equity: number; balanced: boolean }

interface GLRow {
  line_id: number; entry_id: number; entry_number: string; date: string;
  source_module: string | null; ref: string | null;
  entry_description: string | null; line_description: string | null;
  debit: string | number; credit: string | number;
}

interface AccountDetail {
  data: GLRow[];
  total: number;
  totalDebit: number;
  totalCredit: number;
  openingBalance: number;
  closingBalance: number;
}

const fmt = (v: number | string) =>
  new Intl.NumberFormat("id-ID", { minimumFractionDigits: 0, maximumFractionDigits: 0 }).format(Number(v));

const fmtDate = (value: string) => {
  const date = value.slice(0, 10);
  return date ? new Intl.DateTimeFormat("id-ID", { dateStyle: "medium" }).format(new Date(`${date}T00:00:00`)) : "—";
};

const rowKey = (row: BSRow) => `${row.account_id}:${row.company_id ?? "global"}:${row.branch_id ?? "all"}`;

export default function AccountingHubBalanceSheetPage() {
  const [rows, setRows] = useState<BSRow[]>([]);
  const [summary, setSummary] = useState<Summary | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [filters, setFilters] = useState({ company_id: "", date_to: "", branch_id: "" });
  const [appliedFilters, setAppliedFilters] = useState({ company_id: "", date_to: "", branch_id: "" });
  const [selectedRow, setSelectedRow] = useState<BSRow | null>(null);
  const [detail, setDetail] = useState<AccountDetail | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [detailError, setDetailError] = useState<string | null>(null);
  const [detailOpen, setDetailOpen] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const params = new URLSearchParams();
      Object.entries(appliedFilters).forEach(([k, v]) => { if (v) params.set(k, v); });
      const res = await fetch(`/api/accounting/hub/balance-sheet?${params}`, { credentials: "include" });
      if (!res.ok) {
        const msg = await res.text().catch(() => "");
        setError(`Gagal memuat data: ${res.status}${msg ? ` — ${msg}` : ""}`);
        return;
      }
      const json = await res.json();
      setRows(json.data ?? []);
      setSummary(json.summary ?? null);
    } catch (e: any) {
      setError(e.message ?? "Terjadi kesalahan saat memuat data");
    } finally {
      setLoading(false);
    }
  }, [appliedFilters]);

  useEffect(() => { void load(); }, [load]);

  const openDetails = async (row: BSRow) => {
    setSelectedRow(row);
    setDetail(null);
    setDetailError(null);
    setDetailOpen(true);
    setDetailLoading(true);

    try {
      const params = new URLSearchParams({
        account_id: String(row.account_id),
        page: "1",
        limit: "500",
        sort_by: "date",
        sort_dir: "asc",
        posted_only: "1",
      });
      // The balance-sheet row is scoped by company and branch. Reuse that
      // scope so the detail total always explains the clicked row.
      if (row.company_id != null) params.set("company_id", String(row.company_id));
      if (row.branch_id != null) params.set("branch_id", String(row.branch_id));
      if (appliedFilters.date_to) params.set("date_to", appliedFilters.date_to);

      const res = await fetch(`/api/accounting/hub/general-ledger?${params}`, { credentials: "include" });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(json.error ?? `Gagal memuat detail (${res.status})`);
      setDetail({
        data: json.data ?? [],
        total: Number(json.total ?? 0),
        totalDebit: Number(json.totalDebit ?? 0),
        totalCredit: Number(json.totalCredit ?? 0),
        openingBalance: Number(json.openingBalance ?? 0),
        closingBalance: Number(json.closingBalance ?? 0),
      });
    } catch (e: any) {
      setDetailError(e.message ?? "Terjadi kesalahan saat memuat detail akun");
    } finally {
      setDetailLoading(false);
    }
  };

  const grouped: Record<string, BSRow[]> = {};
  for (const r of rows) {
    if (!grouped[r.account_type]) grouped[r.account_type] = [];
    grouped[r.account_type].push(r);
  }

  const sectionTotal = (type: string) =>
    (grouped[type] ?? []).reduce((s, r) => s + Number(r.balance), 0);

  const typeColors: Record<string, string> = {
    asset:     "text-blue-700 bg-blue-50",
    liability: "text-red-700 bg-red-50",
    equity:    "text-purple-700 bg-purple-50",
  };

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
            <h1 className="text-xl font-bold">Neraca (Balance Sheet)</h1>
            <p className="text-xs text-muted-foreground">Posisi keuangan per tanggal</p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          {summary && (
            <span className={`text-xs font-semibold px-2 py-1 rounded ${summary.balanced ? "bg-green-100 text-green-700" : "bg-red-100 text-red-700"}`}>
              {summary.balanced ? "✓ Seimbang" : "✗ Tidak Seimbang"}
            </span>
          )}
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

      {/* Filters */}
      <Card>
        <CardContent className="pt-4">
          <div className="flex flex-wrap gap-2">
            <Input placeholder="Company ID" value={filters.company_id} onChange={e => setFilters(f => ({...f, company_id: e.target.value}))} className="w-32" />
            <Input placeholder="Branch ID"  value={filters.branch_id}  onChange={e => setFilters(f => ({...f, branch_id:  e.target.value}))} className="w-32" />
            <div className="flex items-center gap-2">
              <label className="text-xs whitespace-nowrap">Per tanggal:</label>
              <DatePicker value={filters.date_to} onChange={v => setFilters(f => ({...f, date_to: v}))} className="w-40" />
            </div>
            <Button size="sm" onClick={() => setAppliedFilters({ ...filters })}>Terapkan</Button>
          </div>
        </CardContent>
      </Card>

      {/* Summary */}
      {summary && (
        <div className="grid grid-cols-3 gap-4">
          {[
            { label: "Total Aset",        value: summary.total_assets,      cls: "text-blue-700" },
            { label: "Total Liabilitas",  value: summary.total_liabilities, cls: "text-red-700"  },
            { label: "Total Ekuitas",     value: summary.total_equity,      cls: "text-purple-700" },
          ].map(s => (
            <Card key={s.label}>
              <CardContent className="pt-4">
                <p className="text-xs text-muted-foreground">{s.label}</p>
                <p className={`text-lg font-bold ${s.cls}`}>{fmt(s.value)}</p>
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      {/* Tables by section */}
      {["asset", "liability", "equity"].map(type => (
        grouped[type]?.length ? (
          <Card key={type}>
            <CardHeader className="pb-2">
              <CardTitle className={`text-base capitalize ${typeColors[type]?.split(" ")[0]}`}>{type === "asset" ? "Aset" : type === "liability" ? "Liabilitas" : "Ekuitas"}</CardTitle>
            </CardHeader>
            <CardContent>
              <table className="w-full text-sm">
                <thead className="text-muted-foreground text-xs">
                  <tr>
                    <th className="text-left pb-1">Kode</th>
                    <th className="text-left pb-1">Perusahaan</th>
                    <th className="text-left pb-1">Nama Akun</th>
                    <th className="text-right pb-1">Saldo</th>
                    <th className="w-8 pb-1" aria-label="Buka detail" />
                  </tr>
                </thead>
                <tbody>
                  {grouped[type].map(r => (
                    <tr
                      key={rowKey(r)}
                      onClick={() => openDetails(r)}
                      onKeyDown={e => {
                        if (e.key === "Enter" || e.key === " ") {
                          e.preventDefault();
                          openDetails(r);
                        }
                      }}
                      tabIndex={0}
                      role="button"
                      aria-label={`Tampilkan detail akun ${r.code} ${r.name}`}
                      className={`border-t cursor-pointer transition-colors hover:bg-muted/60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/50 ${
                        selectedRow && rowKey(selectedRow) === rowKey(r) ? "bg-muted/50" : ""
                      }`}
                    >
                      <td className="py-1.5 font-mono text-xs">{r.code}</td>
                      <td className="py-1.5">
                        <Badge variant="outline" className="font-mono text-[10px]">{r.company_code ?? "GLOBAL"}</Badge>
                      </td>
                      <td className="py-1.5">
                        <span className="font-medium">{r.name}</span>
                        <span className="ml-2 text-[10px] text-muted-foreground">Klik untuk detail</span>
                      </td>
                      <td className={`py-1.5 text-right font-mono font-semibold ${Number(r.balance) < 0 ? "text-red-600" : ""}`}>{fmt(r.balance)}</td>
                      <td className="py-1.5 text-right">
                        <ChevronRight className="ml-auto h-4 w-4 text-muted-foreground" />
                      </td>
                    </tr>
                  ))}
                </tbody>
                <tfoot className="bg-muted text-xs font-semibold">
                  <tr>
                    <td colSpan={4} className="px-0 py-1.5">Total</td>
                    <td className="py-1.5 text-right font-mono">{fmt(sectionTotal(type))}</td>
                  </tr>
                </tfoot>
              </table>
            </CardContent>
          </Card>
        ) : null
      ))}

      {rows.length === 0 && !loading && (
        <p className="text-center text-muted-foreground py-8">Tidak ada data</p>
      )}

      <Dialog open={detailOpen} onOpenChange={setDetailOpen}>
        <DialogContent className="max-w-5xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              Detail Akun
              {selectedRow && <Badge variant="outline" className="font-mono">{selectedRow.code}</Badge>}
            </DialogTitle>
            <DialogDescription>
              {selectedRow?.name ?? "—"} · {selectedRow?.company_code ?? "GLOBAL"}
              {selectedRow?.branch_id != null ? ` · Cabang ${selectedRow.branch_id}` : ""}
              {appliedFilters.date_to ? ` · sampai ${fmtDate(appliedFilters.date_to)}` : " · seluruh periode"}
            </DialogDescription>
          </DialogHeader>

          {detailLoading && (
            <div className="flex items-center justify-center gap-2 py-12 text-sm text-muted-foreground">
              <Loader2 className="h-4 w-4 animate-spin" /> Memuat detail transaksi…
            </div>
          )}

          {detailError && (
            <div className="rounded-md border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
              {detailError}
            </div>
          )}

          {!detailLoading && !detailError && detail && (
            <>
              <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
                <div className="rounded-md border bg-muted/30 p-3">
                  <p className="text-xs text-muted-foreground">Saldo awal</p>
                  <p className="mt-1 font-mono font-semibold">{fmt(detail.openingBalance)}</p>
                </div>
                <div className="rounded-md border bg-muted/30 p-3">
                  <p className="text-xs text-muted-foreground">Total debit</p>
                  <p className="mt-1 font-mono font-semibold text-green-700">{fmt(detail.totalDebit)}</p>
                </div>
                <div className="rounded-md border bg-muted/30 p-3">
                  <p className="text-xs text-muted-foreground">Total kredit</p>
                  <p className="mt-1 font-mono font-semibold text-red-700">{fmt(detail.totalCredit)}</p>
                </div>
                <div className="rounded-md border bg-muted/30 p-3">
                  <p className="text-xs text-muted-foreground">Saldo akhir</p>
                  <p className={`mt-1 font-mono font-semibold ${detail.closingBalance < 0 ? "text-red-600" : ""}`}>
                    {fmt(detail.closingBalance)}
                  </p>
                </div>
              </div>

              <div className="overflow-x-auto rounded-md border">
                <table className="w-full min-w-[760px] text-sm">
                  <thead className="bg-muted/50 text-xs text-muted-foreground">
                    <tr>
                      <th className="px-3 py-2 text-left">Tanggal</th>
                      <th className="px-3 py-2 text-left">No. Jurnal</th>
                      <th className="px-3 py-2 text-left">Sumber / Keterangan</th>
                      <th className="px-3 py-2 text-right">Debit</th>
                      <th className="px-3 py-2 text-right">Kredit</th>
                    </tr>
                  </thead>
                  <tbody>
                    {detail.data.map(row => (
                      <tr key={row.line_id} className="border-t">
                        <td className="whitespace-nowrap px-3 py-2 text-xs">{fmtDate(row.date)}</td>
                        <td className="whitespace-nowrap px-3 py-2 font-mono text-xs">{row.entry_number}</td>
                        <td className="max-w-[320px] px-3 py-2">
                          <div className="truncate">{row.line_description || row.entry_description || "—"}</div>
                          <div className="truncate text-[10px] text-muted-foreground">
                            {row.source_module || "manual"}{row.ref ? ` · ${row.ref}` : ""}
                          </div>
                        </td>
                        <td className="whitespace-nowrap px-3 py-2 text-right font-mono text-green-700">
                          {Number(row.debit) ? fmt(row.debit) : "—"}
                        </td>
                        <td className="whitespace-nowrap px-3 py-2 text-right font-mono text-red-700">
                          {Number(row.credit) ? fmt(row.credit) : "—"}
                        </td>
                      </tr>
                    ))}
                    {detail.data.length === 0 && (
                      <tr>
                        <td colSpan={5} className="px-3 py-8 text-center text-muted-foreground">
                          Belum ada jurnal posted untuk akun ini.
                        </td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>

              <p className="text-xs text-muted-foreground">
                {detail.data.length < detail.total
                  ? `Menampilkan ${detail.data.length} dari ${detail.total} baris jurnal.`
                  : `${detail.total} baris jurnal membentuk saldo akun ini.`}
              </p>
            </>
          )}

          {selectedRow && (
            <DialogFooter>
              <Link href={`/finance/transactions/detail?accountId=${selectedRow.account_id}&accountCode=${encodeURIComponent(selectedRow.code)}&accountName=${encodeURIComponent(selectedRow.name)}${selectedRow.company_id != null ? `&company=${selectedRow.company_id}` : ""}${appliedFilters.date_to ? `&endDate=${appliedFilters.date_to}` : ""}`}>
                <Button variant="outline" className="gap-2">
                  <ExternalLink className="h-4 w-4" /> Buka Buku Besar Lengkap
                </Button>
              </Link>
            </DialogFooter>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}
