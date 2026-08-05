import { DatePicker } from "@/components/ui/date-picker";
import { useEffect, useState } from "react";
import { Link } from "wouter";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { RefreshCw, TrendingUp, TrendingDown, ArrowLeft, AlertTriangle } from "lucide-react";

interface PLRow {
  account_type: string; account_id: number; code: string; name: string;
  company_id: number; branch_id: number | null; division_id: number | null;
  source_module: string; period: string;
  total_debit: string; total_credit: string; net_amount: string;
}

interface Summary { total_revenue: number; total_expense: number; net_profit: number }

const fmt = (v: number | string) =>
  new Intl.NumberFormat("id-ID", { minimumFractionDigits: 0, maximumFractionDigits: 0 }).format(Number(v));

const MODULES = ["manual","sales","purchase","tenant","sport_center","pos","logistics","expense","hrd","ecommerce"];

export default function AccountingHubPLPage() {
  const [rows, setRows] = useState<PLRow[]>([]);
  const [summary, setSummary] = useState<Summary | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [filters, setFilters] = useState({ company_id: "", date_from: "", date_to: "", source_module: "", branch_id: "" });

  const load = async () => {
    setLoading(true);
    setError(null);
    try {
      const params = new URLSearchParams();
      Object.entries(filters).forEach(([k, v]) => { if (v) params.set(k, v); });
      const res = await fetch(`/api/accounting/hub/profit-loss?${params}`, { credentials: "include" });
      if (!res.ok) { setRows([]); setSummary(null); setError(`Gagal memuat data (${res.status})`); return; }
      const json = await res.json();
      setRows(json.data ?? []);
      setSummary(json.summary ?? null);
    } catch (err) {
      setRows([]);
      setSummary(null);
      setError("Tidak dapat terhubung ke server. Coba refresh halaman.");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { load(); }, []);

  const revenues = rows.filter(r => r.account_type === "revenue");
  const expenses  = rows.filter(r => r.account_type === "expense");

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
            <h1 className="text-xl font-bold">Laba Rugi (Profit &amp; Loss)</h1>
            <p className="text-xs text-muted-foreground">Multi-perusahaan · Multi-modul</p>
          </div>
        </div>
        <Button variant="outline" size="sm" onClick={load} disabled={loading}>
          <RefreshCw className={`h-4 w-4 mr-2 ${loading ? "animate-spin" : ""}`} />Refresh
        </Button>
      </div>

      {/* Filters */}
      <Card>
        <CardContent className="pt-4">
          <div className="flex flex-wrap gap-2">
            <Input placeholder="Company ID" value={filters.company_id} onChange={e => setFilters(f => ({...f, company_id: e.target.value}))} className="w-32" />
            <Input placeholder="Branch ID"  value={filters.branch_id}  onChange={e => setFilters(f => ({...f, branch_id:  e.target.value}))} className="w-32" />
            <DatePicker value={filters.date_from} onChange={v => setFilters(f => ({...f, date_from: v}))} className="w-40" />
            <DatePicker value={filters.date_to}   onChange={v => setFilters(f => ({...f, date_to:   v}))} className="w-40" />
            <Select value={filters.source_module || "__all"} onValueChange={v => setFilters(f => ({...f, source_module: v === "__all" ? "" : v}))}>
              <SelectTrigger className="w-36"><SelectValue placeholder="Modul" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="__all">Semua Modul</SelectItem>
                {MODULES.map(m => <SelectItem key={m} value={m}>{m}</SelectItem>)}
              </SelectContent>
            </Select>
            <Button size="sm" onClick={load}>Terapkan</Button>
          </div>
        </CardContent>
      </Card>

      {/* Error / empty state */}
      {!loading && error && (
        <Card className="border-red-300 bg-red-50">
          <CardContent className="pt-4 flex items-center gap-3">
            <AlertTriangle className="h-5 w-5 text-red-500 shrink-0" />
            <span className="text-sm text-red-700">{error}</span>
          </CardContent>
        </Card>
      )}

      {/* Summary cards */}
      {summary && (
        <div className="grid grid-cols-3 gap-4">
          <Card>
            <CardContent className="pt-4">
              <div className="flex items-center gap-2">
                <TrendingUp className="h-5 w-5 text-green-600" />
                <div>
                  <p className="text-xs text-muted-foreground">Total Pendapatan</p>
                  <p className="text-lg font-bold text-green-700">{fmt(summary.total_revenue)}</p>
                </div>
              </div>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="pt-4">
              <div className="flex items-center gap-2">
                <TrendingDown className="h-5 w-5 text-red-600" />
                <div>
                  <p className="text-xs text-muted-foreground">Total Beban</p>
                  <p className="text-lg font-bold text-red-700">{fmt(summary.total_expense)}</p>
                </div>
              </div>
            </CardContent>
          </Card>
          <Card className={summary.net_profit >= 0 ? "border-green-400" : "border-red-400"}>
            <CardContent className="pt-4">
              <p className="text-xs text-muted-foreground">Laba / Rugi Bersih</p>
              <p className={`text-lg font-bold ${summary.net_profit >= 0 ? "text-green-700" : "text-red-700"}`}>
                {fmt(summary.net_profit)}
              </p>
            </CardContent>
          </Card>
        </div>
      )}

      {/* Revenue */}
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-base text-green-700">Pendapatan</CardTitle>
        </CardHeader>
        <CardContent>
          <PLTable rows={revenues} />
        </CardContent>
      </Card>

      {/* Expense */}
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-base text-orange-700">Beban</CardTitle>
        </CardHeader>
        <CardContent>
          <PLTable rows={expenses} />
        </CardContent>
      </Card>
    </div>
  );
}

function PLTable({ rows }: { rows: PLRow[] }) {
  const fmt2 = (v: string | number) =>
    new Intl.NumberFormat("id-ID", { minimumFractionDigits: 0, maximumFractionDigits: 0 }).format(Number(v));

  if (!rows.length) return <p className="text-sm text-muted-foreground">Tidak ada data</p>;

  return (
    <table className="w-full text-sm">
      <thead className="text-muted-foreground text-xs">
        <tr>
          <th className="text-left pb-1">Kode</th>
          <th className="text-left pb-1">Nama Akun</th>
          <th className="text-left pb-1">Modul</th>
          <th className="text-left pb-1">Periode</th>
          <th className="text-right pb-1">Net</th>
        </tr>
      </thead>
      <tbody>
        {rows.map((r, i) => (
          <tr key={i} className="border-t">
            <td className="py-1.5 font-mono text-xs">{r.code}</td>
            <td className="py-1.5">{r.name}</td>
            <td className="py-1.5"><Badge variant="outline" className="text-xs">{r.source_module}</Badge></td>
            <td className="py-1.5 text-xs">{r.period}</td>
            <td className="py-1.5 text-right font-mono font-semibold">{fmt2(r.net_amount)}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}
