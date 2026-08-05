import { DatePicker } from "@/components/ui/date-picker";
import { useEffect, useState } from "react";
import { Link } from "wouter";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { RefreshCw, ArrowLeft } from "lucide-react";

interface BSRow {
  account_type: string; account_id: number; code: string; name: string;
  company_id: number; company_code: string | null; branch_id: number | null;
  total_debit: string; total_credit: string; balance: string;
}

interface Summary { total_assets: number; total_liabilities: number; total_equity: number; balanced: boolean }

const fmt = (v: number | string) =>
  new Intl.NumberFormat("id-ID", { minimumFractionDigits: 0, maximumFractionDigits: 0 }).format(Number(v));

export default function AccountingHubBalanceSheetPage() {
  const [rows, setRows] = useState<BSRow[]>([]);
  const [summary, setSummary] = useState<Summary | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [filters, setFilters] = useState({ company_id: "", date_to: "", branch_id: "" });

  const load = async () => {
    setLoading(true);
    setError(null);
    try {
      const params = new URLSearchParams();
      Object.entries(filters).forEach(([k, v]) => { if (v) params.set(k, v); });
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
  };

  useEffect(() => { load(); }, []);

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
            <Button size="sm" onClick={load}>Terapkan</Button>
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
                  </tr>
                </thead>
                <tbody>
                  {grouped[type].map(r => (
                    <tr key={r.account_id} className="border-t">
                      <td className="py-1.5 font-mono text-xs">{r.code}</td>
                      <td className="py-1.5">
                        <Badge variant="outline" className="font-mono text-[10px]">{r.company_code ?? "GLOBAL"}</Badge>
                      </td>
                      <td className="py-1.5">{r.name}</td>
                      <td className={`py-1.5 text-right font-mono font-semibold ${Number(r.balance) < 0 ? "text-red-600" : ""}`}>{fmt(r.balance)}</td>
                    </tr>
                  ))}
                </tbody>
                <tfoot className="bg-muted text-xs font-semibold">
                  <tr>
                    <td colSpan={3} className="px-0 py-1.5">Total</td>
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
    </div>
  );
}
