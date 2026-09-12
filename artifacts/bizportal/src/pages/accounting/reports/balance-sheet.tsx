import { useState, useMemo } from "react";
import { AppShell } from "@/components/layout/AppShell";
import { PageHeader } from "@/components/layout/PageHeader";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { DatePicker } from "@/components/ui/date-picker";
import { Label } from "@/components/ui/label";
import { useQuery } from "@tanstack/react-query";
import { useCompany } from "@/contexts/CompanyContext";
import {
  Wallet, Printer, Download, TrendingUp, TrendingDown,
  ChevronRight, Landmark, Scale, Building2, CalendarDays,
} from "lucide-react";
import { exportXlsx, printWindow } from "@/lib/export";
import { Link, useLocation } from "wouter";
import { BackButton } from "@/components/ui/back-button";

const idr = (n: number) =>
  new Intl.NumberFormat("id-ID", { style: "currency", currency: "IDR", minimumFractionDigits: 0, maximumFractionDigits: 0 }).format(n);

const idrShort = (n: number) => {
  const abs = Math.abs(n);
  const sign = n < 0 ? "-" : "";
  if (abs >= 1_000_000_000) return `${sign}Rp ${(abs / 1_000_000_000).toFixed(1)}M`;
  if (abs >= 1_000_000) return `${sign}Rp ${(abs / 1_000_000).toFixed(1)}jt`;
  return `${sign}Rp ${new Intl.NumberFormat("id-ID").format(abs)}`;
};

interface AccountRow {
  accountId: number;
  companyId?: number | null;
  companyCode?: string | null;
  code: string;
  name: string;
  amount: number;
}

interface BalanceSheetData {
  asOf: string;
  assets: AccountRow[];
  liabilities: AccountRow[];
  equity: AccountRow[];
  netIncomeYTD: number;
  totalAssets: number;
  totalLiabilities: number;
  totalEquity: number;
  totalLiabilitiesAndEquity: number;
}

function KpiCard({
  label, value, sub, color, icon: Icon,
}: { label: string; value: string; sub?: string; color: "blue" | "orange" | "emerald" | "purple"; icon: React.ElementType }) {
  const colorMap = {
    blue:    { bg: "bg-blue-950/60",    border: "border-blue-800/50",    icon: "text-blue-400",    val: "text-blue-100",    sub: "text-blue-500" },
    orange:  { bg: "bg-orange-950/60",  border: "border-orange-800/50",  icon: "text-orange-400",  val: "text-orange-100",  sub: "text-orange-500" },
    emerald: { bg: "bg-emerald-950/60", border: "border-emerald-800/50", icon: "text-emerald-400", val: "text-emerald-100", sub: "text-emerald-500" },
    purple:  { bg: "bg-purple-950/60",  border: "border-purple-800/50",  icon: "text-purple-400",  val: "text-purple-100",  sub: "text-purple-500" },
  };
  const c = colorMap[color];
  return (
    <div className={`rounded-xl border ${c.border} ${c.bg} p-4`}>
      <div className="flex items-center gap-2 mb-2">
        <Icon className={`h-4 w-4 ${c.icon}`} />
        <span className="text-xs text-slate-400 uppercase tracking-wide font-medium">{label}</span>
      </div>
      <p className={`text-2xl font-bold font-mono ${c.val}`}>{value}</p>
      {sub && <p className={`text-xs mt-1 ${c.sub}`}>{sub}</p>}
    </div>
  );
}

function AccountTable({
  rows, totalLabel, total, color,
}: { rows: AccountRow[]; totalLabel: string; total: number; color: "blue" | "orange" | "emerald" }) {
  const [, navigate] = useLocation();
  const totalColorClass = color === "blue" ? "text-blue-400" : color === "orange" ? "text-orange-400" : "text-emerald-400";

  function drilldown(r: AccountRow) {
    if (r.accountId < 0) return;
    const p = new URLSearchParams();
    p.set("accountId", String(r.accountId));
    p.set("accountCode", r.code);
    p.set("accountName", r.name);
    navigate(`/finance/transactions/detail?${p}`);
  }

  return (
    <table className="w-full text-sm">
      <thead>
        <tr className="border-b border-white/8 bg-white/5">
          <th className="text-left px-4 py-2 text-[11px] text-slate-400 font-medium w-20">Perusahaan</th>
          <th className="text-left px-4 py-2 text-[11px] text-slate-400 font-medium w-24">Kode</th>
          <th className="text-left px-2 py-2 text-[11px] text-slate-400 font-medium">Nama Akun</th>
          <th className="text-right px-4 py-2 text-[11px] text-slate-400 font-medium">Jumlah</th>
        </tr>
      </thead>
      <tbody className="divide-y divide-white/5">
        {rows.length === 0 ? (
          <tr><td colSpan={4} className="px-4 py-6 text-center text-slate-400 text-sm">Tidak ada data</td></tr>
        ) : rows.map(r => (
          <tr
            key={r.accountId}
            className={`group hover:bg-white/5 transition-colors duration-150 ${r.accountId >= 0 ? "cursor-pointer" : ""}`}
            onClick={() => drilldown(r)}
          >
            <td className="px-4 py-2.5">
              <span className="inline-flex rounded border border-indigo-400/30 bg-indigo-400/10 px-1.5 py-0.5 font-mono text-[10px] text-indigo-300">
                {r.companyCode ?? "GLOBAL"}
              </span>
            </td>
            <td className="px-4 py-2.5 font-mono text-[11px] text-slate-400">{r.code}</td>
            <td className="px-2 py-2.5 text-slate-300">
              <span className="flex items-center gap-1">
                {r.name}
                {r.accountId >= 0 && (
                  <ChevronRight className="h-3 w-3 text-slate-400 opacity-0 group-hover:opacity-100 transition-opacity ml-auto shrink-0" />
                )}
              </span>
            </td>
            <td className="px-4 py-2.5 text-right font-mono">{idr(r.amount)}</td>
          </tr>
        ))}
      </tbody>
      <tfoot>
        <tr className="border-t-2 bg-white/5 font-semibold">
          <td colSpan={3} className={`px-4 py-2.5 ${totalColorClass}`}>{totalLabel}</td>
          <td className={`px-4 py-2.5 text-right font-bold font-mono ${totalColorClass}`}>{idr(total)}</td>
        </tr>
      </tfoot>
    </table>
  );
}

export default function BalanceSheetPage() {
  const { activeCompanyId, isConsolidated, activeCompany } = useCompany();
  const [asOf, setAsOf] = useState(() => new URLSearchParams(window.location.search).get("endDate") ?? "");

  const params = useMemo(() => {
    const p = new URLSearchParams();
    if (asOf) p.set("to", new Date(asOf + "T23:59:59").toISOString());
    if (!isConsolidated && activeCompanyId) p.set("company", String(activeCompanyId));
    return p.toString();
  }, [asOf, activeCompanyId, isConsolidated]);

  const { data, isLoading } = useQuery<BalanceSheetData>({
    queryKey: ["balance-sheet", params],
    queryFn: async () => {
      const res = await fetch(`/api/accounting/reports/balance-sheet${params ? `?${params}` : ""}`);
      if (!res.ok) throw new Error("Gagal memuat data");
      return res.json();
    },
  });

  const debtRatio = data && data.totalAssets > 0
    ? ((data.totalLiabilities / data.totalAssets) * 100).toFixed(1)
    : null;
  const equityRatio = data && data.totalAssets > 0
    ? ((data.totalEquity / data.totalAssets) * 100).toFixed(1)
    : null;
  const isBalanced = data
    ? Math.abs(data.totalAssets - data.totalLiabilitiesAndEquity) < 1
    : null;

  function buildExportRows() {
    if (!data) return [];
    return [
      ["=== AKTIVA (ASSETS) ===", "", "", ""],
      ...data.assets.map((r) => [r.companyCode ?? "GLOBAL", r.code, r.name, r.amount] as [string, string, string, number]),
      ["", "", "Total Aktiva", data.totalAssets],
      ["", "", "", ""],
      ["=== LIABILITAS ===", "", "", ""],
      ...data.liabilities.map((r) => [r.companyCode ?? "GLOBAL", r.code, r.name, r.amount] as [string, string, string, number]),
      ["", "", "Total Liabilitas", data.totalLiabilities],
      ["", "", "", ""],
      ["=== EKUITAS ===", "", "", ""],
      ...data.equity.map((r) => [r.companyCode ?? "GLOBAL", r.code, r.name, r.amount] as [string, string, string, number]),
      ["", "YTD", "Laba Berjalan (YTD)", data.netIncomeYTD],
      ["", "", "Total Ekuitas", data.totalEquity],
      ["", "", "", ""],
      ["", "", "Total Liabilitas + Ekuitas", data.totalLiabilitiesAndEquity],
    ] as (string | number | null | undefined)[][];
  }

  return (
    <AppShell>
      <BackButton href="/finance/workspace/financial-reports" />
      <div className="space-y-6 p-6">

        <PageHeader
          onBack={() => window.history.back()}
          title="Neraca (Balance Sheet)"
          description="Posisi keuangan per tanggal"
          breadcrumb={[
            { label: "Dashboard", href: "/dashboard" },
            { label: "Finance", href: "/finance" },
            { label: "Laporan Keuangan", href: "/finance/workspace/financial-statements" },
            { label: "Neraca" },
          ]}
          favoriteEnabled
          actions={
            <div className="flex gap-2">
              <Button variant="outline" size="sm"
                onClick={() => printWindow("Neraca (Balance Sheet)", ["Perusahaan", "Kode", "Nama", "Jumlah"], buildExportRows(), [3])}
                disabled={!data}>
                <Printer className="h-4 w-4 mr-1.5" />Print
              </Button>
              <Button variant="outline" size="sm"
                onClick={() => exportXlsx("Neraca", ["Perusahaan", "Kode", "Nama", "Jumlah"], buildExportRows())}
                disabled={!data}>
                <Download className="h-4 w-4 mr-1.5" />XLSX
              </Button>
            </div>
          }
        />

        {/* Filter */}
        <Card>
          <CardContent className="p-4 flex gap-4 items-end">
            <div className="flex-1 max-w-[220px]">
              <Label>Per Tanggal</Label>
              <DatePicker value={asOf} onChange={setAsOf} />
            </div>
            {data && (
              <p className="text-sm text-muted-foreground pb-1">
                Data per {new Date(data.asOf).toLocaleDateString("id-ID", { day: "numeric", month: "long", year: "numeric" })}
              </p>
            )}
          </CardContent>
        </Card>

        {/* ── Filter Summary ── */}
        <div className="flex items-center gap-2 text-xs text-muted-foreground bg-muted/40 rounded-lg px-3 py-2 flex-wrap">
          <CalendarDays className="h-3.5 w-3.5 shrink-0" />
          <span><span className="font-medium text-foreground">Per Tanggal:</span> {asOf ? new Date(asOf).toLocaleDateString("id-ID", { day: "numeric", month: "long", year: "numeric" }) : "Semua Periode"}</span>
          {!isConsolidated && activeCompany && (
            <><span className="text-muted-foreground/40">·</span><span><span className="font-medium text-foreground">Perusahaan:</span> {activeCompany.companyName}</span></>
          )}
        </div>

        {isLoading && (
          <Card><CardContent className="p-6 text-muted-foreground">Memuat data neraca...</CardContent></Card>
        )}

        {data && !isLoading && (
          <>
            {/* ── Dark KPI Panel ── */}
            <div className="rounded-2xl bg-slate-900 p-5 space-y-4">
              <div className="flex items-center justify-between">
                <h2 className="text-xs font-semibold text-slate-400 uppercase tracking-widest">Position Summary</h2>
                {isBalanced !== null && (
                  <span className={`text-xs font-medium px-2.5 py-1 rounded-full ${isBalanced ? "bg-emerald-900/50 text-emerald-400 border border-emerald-800" : "bg-red-900/50 text-red-400 border border-red-800"}`}>
                    {isBalanced ? "✓ Balanced" : "⚠ Not Balanced"}
                  </span>
                )}
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
                <KpiCard label="Total Aktiva" value={idrShort(data.totalAssets)} sub={`${data.assets.length} akun`} color="blue" icon={Wallet} />
                <KpiCard label="Total Liabilitas" value={idrShort(data.totalLiabilities)} sub={debtRatio ? `${debtRatio}% dari aset` : undefined} color="orange" icon={TrendingDown} />
                <KpiCard label="Total Ekuitas" value={idrShort(data.totalEquity)} sub={equityRatio ? `${equityRatio}% dari aset` : undefined} color="emerald" icon={TrendingUp} />
                <KpiCard label="Laba YTD" value={idrShort(data.netIncomeYTD)} sub={data.netIncomeYTD >= 0 ? "Positif" : "Negatif"} color="purple" icon={Building2} />
              </div>

              {data.totalAssets > 0 && (
                <div className="flex items-center gap-3 pt-1">
                  <Scale className="h-4 w-4 text-slate-500 shrink-0" />
                  <div className="flex-1 flex gap-0.5 h-2">
                    <div
                      className="bg-orange-500 rounded-l-full transition-all"
                      style={{ width: `${Math.min(98, (data.totalLiabilities / data.totalAssets) * 100)}%` }}
                    />
                    <div className="bg-emerald-500 rounded-r-full transition-all flex-1" />
                  </div>
                  <div className="flex items-center gap-3 text-xs text-slate-500">
                    <span className="flex items-center gap-1"><span className="inline-block w-2 h-2 rounded-full bg-orange-500" />Liabilitas {debtRatio}%</span>
                    <span className="flex items-center gap-1"><span className="inline-block w-2 h-2 rounded-full bg-emerald-500" />Ekuitas {equityRatio}%</span>
                  </div>
                </div>
              )}
            </div>

            {/* ── Table Breakdown ── */}
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">

              {/* Aktiva */}
              <Card className="overflow-hidden border-blue-900/40">
                <div className="bg-blue-700 px-4 py-3 flex items-center gap-2">
                  <Wallet className="h-4 w-4 text-blue-100" />
                  <span className="font-semibold text-white text-sm">Aktiva (Assets)</span>
                  <span className="ml-auto text-blue-200 font-mono text-sm font-bold">{idrShort(data.totalAssets)}</span>
                </div>
                <CardContent className="p-0">
                  <AccountTable rows={data.assets} totalLabel="Total Aktiva" total={data.totalAssets} color="blue" />
                </CardContent>
              </Card>

              <div className="space-y-6">
                {/* Liabilitas */}
                <Card className="overflow-hidden border-orange-900/40">
                  <div className="bg-orange-700 px-4 py-3 flex items-center gap-2">
                    <TrendingDown className="h-4 w-4 text-orange-100" />
                    <span className="font-semibold text-white text-sm">Liabilitas</span>
                    <span className="ml-auto text-orange-200 font-mono text-sm font-bold">{idrShort(data.totalLiabilities)}</span>
                  </div>
                  <CardContent className="p-0">
                    <AccountTable rows={data.liabilities} totalLabel="Total Liabilitas" total={data.totalLiabilities} color="orange" />
                  </CardContent>
                </Card>

                {/* Ekuitas */}
                <Card className="overflow-hidden border-emerald-900/40">
                  <div className="bg-emerald-700 px-4 py-3 flex items-center gap-2">
                    <TrendingUp className="h-4 w-4 text-emerald-100" />
                    <span className="font-semibold text-white text-sm">Ekuitas</span>
                    <span className="ml-auto text-emerald-200 font-mono text-sm font-bold">{idrShort(data.totalEquity)}</span>
                  </div>
                  <CardContent className="p-0">
                    <AccountTable
                      rows={[
                        ...data.equity,
                        { accountId: -1, code: "YTD", name: "Laba Berjalan (YTD)", amount: data.netIncomeYTD },
                      ]}
                      totalLabel="Total Ekuitas"
                      total={data.totalEquity}
                      color="emerald"
                    />
                  </CardContent>
                </Card>

                {/* Balance check */}
                <Card className={`border-2 ${isBalanced ? "border-emerald-800/50 bg-emerald-950/20" : "border-red-800/50 bg-red-950/20"}`}>
                  <CardContent className="p-4 flex justify-between items-center">
                    <div>
                      <p className="text-sm font-semibold">Total Liabilitas + Ekuitas</p>
                      <p className="text-xs text-muted-foreground">Harus = Total Aktiva</p>
                    </div>
                    <p className="text-xl font-bold font-mono">{idr(data.totalLiabilitiesAndEquity)}</p>
                  </CardContent>
                </Card>
              </div>
            </div>
          </>
        )}
      </div>
    </AppShell>
  );
}
