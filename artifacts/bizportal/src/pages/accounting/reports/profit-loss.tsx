import { useState, useMemo } from "react";
import { AppShell } from "@/components/layout/AppShell";
import { PageHeader } from "@/components/layout/PageHeader";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { DatePicker } from "@/components/ui/date-picker";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useGetProfitLoss, getGetProfitLossQueryKey } from "@workspace/api-client-react";
import { useQuery } from "@tanstack/react-query";
import { useCompany } from "@/contexts/CompanyContext";
import {
  TrendingUp, Printer, Download, BarChart3, List,
  ChevronRight, ChevronDown, CalendarDays,
  ArrowUpRight, ArrowDownRight, Minus, Sparkles,
} from "lucide-react";
import { exportXlsx, printWindow } from "@/lib/export";
import { Link, useLocation } from "wouter";
import { BackButton } from "@/components/ui/back-button";
import {
  ComposedChart, Bar, Line, XAxis, YAxis, CartesianGrid, Tooltip,
  Legend, ResponsiveContainer,
} from "recharts";

/* ── formatters ─────────────────────────────────────────────────────────── */
const idr = (n: number) =>
  new Intl.NumberFormat("id-ID", { style: "currency", currency: "IDR", minimumFractionDigits: 0, maximumFractionDigits: 0 }).format(n);

const idrShort = (n: number) => {
  const abs = Math.abs(n);
  const sign = n < 0 ? "-" : "";
  if (abs >= 1_000_000_000) return `${sign}Rp ${(abs / 1_000_000_000).toFixed(1)}M`;
  if (abs >= 1_000_000) return `${sign}Rp ${(abs / 1_000_000).toFixed(1)}jt`;
  if (abs >= 1_000) return `${sign}${(abs / 1_000).toFixed(0)}rb`;
  return `${sign}${abs}`;
};

const fmtPct = (n: number) => `${n >= 0 ? "+" : ""}${n.toFixed(1)}%`;

const MONTH_NAMES = ["Jan","Feb","Mar","Apr","Mei","Jun","Jul","Agu","Sep","Okt","Nov","Des"];
const fmtMonth = (ym: string) => {
  const [y, m] = ym.split("-");
  return `${MONTH_NAMES[parseInt(m, 10) - 1]} ${y}`;
};

/* ── types ──────────────────────────────────────────────────────────────── */
interface CostCenter { id: number; code: string; name: string; isActive: boolean }
interface PLAccount { accountId: number; code: string; name: string; amount: number }
interface PLData {
  revenues: PLAccount[];
  expenses: PLAccount[];
  totalRevenue: number;
  totalExpense: number;
  netIncome: number;
}

/* ── drilldown URL builder ───────────────────────────────────────────────── */
function buildTxUrl({
  accountId, accountCode, accountName, accountGroup, from, to, companyId, costCenterId,
}: {
  accountId?: number; accountCode?: string; accountName?: string; accountGroup?: string;
  from: string; to: string; companyId: number | null; costCenterId: string;
}) {
  const p = new URLSearchParams();
  if (accountId) p.set("accountId", String(accountId));
  if (accountCode) p.set("accountCode", accountCode);
  if (accountName) p.set("accountName", accountName);
  if (accountGroup) p.set("accountGroup", accountGroup);
  if (from) p.set("startDate", from);
  if (to) p.set("endDate", to);
  if (companyId) p.set("company", String(companyId));
  if (costCenterId !== "all") p.set("costCenter", costCenterId);
  return `/finance/transactions/detail?${p}`;
}

/* ── TrendBadge ──────────────────────────────────────────────────────────── */
function TrendBadge({ current, prev }: { current: number; prev: number | undefined }) {
  if (prev === undefined) return null;
  if (prev === 0 && current === 0) return null;
  if (prev === 0 && current !== 0) {
    return (
      <span className="inline-flex items-center gap-0.5 text-[10px] font-semibold text-emerald-400 bg-emerald-950/40 px-1.5 py-0.5 rounded-full whitespace-nowrap">
        <Sparkles className="h-2.5 w-2.5" />New
      </span>
    );
  }
  const pct = ((current - prev) / Math.abs(prev)) * 100;
  if (Math.abs(pct) < 0.1) {
    return (
      <span className="inline-flex items-center gap-0.5 text-[10px] font-medium text-zinc-400 bg-white/5 px-1.5 py-0.5 rounded-full whitespace-nowrap">
        <Minus className="h-2.5 w-2.5" />0%
      </span>
    );
  }
  const isUp = pct > 0;
  return (
    <span className={`inline-flex items-center gap-0.5 text-[10px] font-semibold px-1.5 py-0.5 rounded-full whitespace-nowrap ${isUp ? "text-emerald-400 bg-emerald-950/40" : "text-rose-400 bg-rose-950/40"}`}>
      {isUp ? <ArrowUpRight className="h-2.5 w-2.5" /> : <ArrowDownRight className="h-2.5 w-2.5" />}
      {fmtPct(Math.abs(pct))}
    </span>
  );
}

/* ── InsightPanel ────────────────────────────────────────────────────────── */
function InsightPanel({
  curr, prev, from, to,
}: { curr: PLData; prev: PLData | undefined; from: string; to: string }) {
  const revChg = prev && prev.totalRevenue !== 0
    ? ((curr.totalRevenue - prev.totalRevenue) / Math.abs(prev.totalRevenue)) * 100 : null;
  const expChg = prev && prev.totalExpense !== 0
    ? ((curr.totalExpense - prev.totalExpense) / Math.abs(prev.totalExpense)) * 100 : null;
  const netChg = prev && prev.netIncome !== 0
    ? ((curr.netIncome - prev.netIncome) / Math.abs(prev.netIncome)) * 100 : null;
  const margin = curr.totalRevenue > 0 ? (curr.netIncome / curr.totalRevenue) * 100 : null;

  const top3Rev = [...curr.revenues].sort((a, b) => b.amount - a.amount).slice(0, 3);
  const top3Exp = [...curr.expenses].sort((a, b) => b.amount - a.amount).slice(0, 3);

  // Largest single movement
  const prevRevMap = new Map((prev?.revenues ?? []).map((r) => [r.accountId, r.amount]));
  const prevExpMap = new Map((prev?.expenses ?? []).map((r) => [r.accountId, r.amount]));
  type Movement = { name: string; current: number; prev: number; pct: number; type: "rev" | "exp" };
  const movements: Movement[] = [];
  curr.revenues.forEach((r) => {
    const p = prevRevMap.get(r.accountId);
    if (p !== undefined && p !== 0) {
      movements.push({ name: r.name, current: r.amount, prev: p, pct: ((r.amount - p) / Math.abs(p)) * 100, type: "rev" });
    }
  });
  curr.expenses.forEach((r) => {
    const p = prevExpMap.get(r.accountId);
    if (p !== undefined && p !== 0) {
      movements.push({ name: r.name, current: r.amount, prev: p, pct: ((r.amount - p) / Math.abs(p)) * 100, type: "exp" });
    }
  });
  const largestMove = movements.sort((a, b) => Math.abs(b.pct) - Math.abs(a.pct))[0];

  return (
    <div className="space-y-3">
      {/* KPI row — dark panel */}
      <div className="rounded-2xl bg-slate-900 p-5">
        <h2 className="text-xs font-semibold text-slate-400 uppercase tracking-widest mb-4">P&L Summary</h2>
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
          {[
            {
              label: "Net Profit", value: idrShort(curr.netIncome),
              chg: netChg, color: curr.netIncome >= 0 ? "emerald" : "rose",
              sub: margin !== null ? `Margin ${margin.toFixed(1)}%` : undefined,
            },
            {
              label: "Revenue", value: idrShort(curr.totalRevenue),
              chg: revChg, color: "emerald",
              sub: `${curr.revenues.length} akun`,
            },
            {
              label: "Total Beban", value: idrShort(curr.totalExpense),
              chg: expChg !== null ? -expChg : null, color: expChg !== null && expChg > 5 ? "rose" : "slate",
              sub: `${curr.expenses.length} akun`,
            },
            {
              label: "Gross Margin", value: margin !== null ? `${margin.toFixed(1)}%` : "N/A",
              chg: null, color: margin !== null ? (margin > 20 ? "emerald" : margin > 5 ? "amber" : "rose") : "slate",
              sub: "Revenue − Beban",
            },
          ].map((item) => {
            const valColor = item.color === "emerald" ? "text-emerald-400"
              : item.color === "rose" ? "text-rose-400"
              : item.color === "amber" ? "text-amber-400"
              : "text-slate-300";
            const borderColor = item.color === "emerald" ? "border-emerald-800/50"
              : item.color === "rose" ? "border-rose-800/50"
              : item.color === "amber" ? "border-amber-800/50"
              : "border-slate-700/50";
            const bgColor = item.color === "emerald" ? "bg-emerald-950/40"
              : item.color === "rose" ? "bg-rose-950/40"
              : item.color === "amber" ? "bg-amber-950/40"
              : "bg-slate-800/40";
            return (
              <div key={item.label} className={`rounded-xl p-4 border ${borderColor} ${bgColor}`}>
                <p className="text-[11px] text-slate-400 font-medium uppercase tracking-wide mb-1">{item.label}</p>
                <p className={`text-xl font-bold ${valColor}`}>{item.value}</p>
                <div className="flex items-center gap-2 mt-1">
                  {item.sub && <p className="text-[11px] text-slate-500">{item.sub}</p>}
                  {item.chg !== null && Math.abs(item.chg) > 0.05 && (
                    <span className={`inline-flex items-center gap-0.5 text-[10px] font-semibold px-1.5 py-0.5 rounded-full ${item.chg > 0 ? "text-emerald-400 bg-emerald-900/50" : "text-rose-400 bg-rose-900/50"}`}>
                      {item.chg > 0 ? <ArrowUpRight className="h-2.5 w-2.5" /> : <ArrowDownRight className="h-2.5 w-2.5" />}
                      {fmtPct(Math.abs(item.chg))} vs prev
                    </span>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      </div>

    </div>
  );
}

/* ── CollapsibleAccountSection ───────────────────────────────────────────── */
interface CollapsibleAccountSectionProps {
  label: string;
  total: number;
  accounts: PLAccount[];
  prevMap: Map<number, number>;
  top3Ids: Set<number>;
  color: "emerald" | "rose";
  onRowClick: (r: PLAccount) => void;
  onTotalClick: () => void;
  defaultOpen?: boolean;
}

function CollapsibleAccountSection({
  label, total, accounts, prevMap, top3Ids, color, onRowClick, onTotalClick, defaultOpen = false,
}: CollapsibleAccountSectionProps) {
  const [open, setOpen] = useState(defaultOpen);
  const isEmerald = color === "emerald";

  const borderColor = isEmerald ? "border-emerald-800/25" : "border-rose-800/25";
  const bgColor = isEmerald ? "bg-emerald-950/20" : "bg-rose-950/20";
  const headerHover = isEmerald ? "hover:bg-emerald-950/30" : "hover:bg-rose-950/30";
  const totalColor = isEmerald ? "text-emerald-400" : "text-rose-400";
  const rowHover = isEmerald ? "hover:bg-emerald-950/20" : "hover:bg-rose-950/20";
  const rowHoverText = isEmerald ? "group-hover:text-emerald-400" : "group-hover:text-rose-400";
  const chevronColor = isEmerald ? "text-emerald-500" : "text-rose-500";
  const top3Border = isEmerald ? "border-l-4 border-emerald-500" : "border-l-4 border-rose-500";
  const top3Bg = isEmerald ? "bg-emerald-950/25" : "bg-rose-950/25";

  return (
    <div className={`rounded-xl border ${borderColor} overflow-hidden`}>
      {/* Section Header — always visible, click to toggle */}
      <div
        className={`flex items-center justify-between px-5 py-3.5 cursor-pointer select-none transition-colors ${headerHover} ${bgColor}`}
        onClick={() => setOpen((o) => !o)}
      >
        <div className="flex items-center gap-2.5">
          {open ? <ChevronDown className={`h-4 w-4 ${totalColor}`} /> : <ChevronRight className={`h-4 w-4 ${totalColor}`} />}
          <span className={`font-semibold text-sm ${totalColor}`}>{label}</span>
          <Badge variant="outline" className={`text-xs px-2 py-0 h-5 ${isEmerald ? "border-emerald-800/30 text-emerald-400" : "border-rose-800/30 text-rose-400"}`}>
            {accounts.length} akun
          </Badge>
        </div>
        <div className="flex items-center gap-3">
          <span
            className={`font-bold text-base font-mono ${totalColor} cursor-pointer hover:underline`}
            onClick={(e) => { e.stopPropagation(); onTotalClick(); }}
            title="Klik untuk lihat semua transaksi"
          >
            {idr(total)}
          </span>
          <span
            className={`h-3.5 w-3.5 ${totalColor} opacity-50 hover:opacity-100 transition-opacity cursor-pointer inline-flex`}
            onClick={(e) => { e.stopPropagation(); onTotalClick(); }}
            title="Lihat semua transaksi"
            role="button"
          >
            <ChevronRight className="h-3.5 w-3.5" />
          </span>
        </div>
      </div>

      {/* Rows — only visible when open */}
      {open && (
        <div className="border-t border-white/8">
          {accounts.length === 0 ? (
            <p className="px-5 py-4 text-sm text-muted-foreground text-center">Tidak ada data</p>
          ) : (
            <table className="w-full text-sm">
              <thead className="bg-white/5 text-[11px] text-muted-foreground">
                <tr>
                  <th className="text-left px-5 py-2 font-medium w-24">Kode</th>
                  <th className="text-left px-2 py-2 font-medium">Nama Akun</th>
                  <th className="text-right px-4 py-2 font-medium w-44">Jumlah</th>
                  <th className="text-right px-5 py-2 font-medium w-28">vs Prev</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-white/5">
                {accounts.map((r) => {
                  const isTop3 = top3Ids.has(r.accountId);
                  return (
                    <tr
                      key={r.accountId}
                      className={`cursor-pointer transition-colors group ${rowHover} ${isTop3 ? `${top3Border} ${top3Bg}` : ""}`}
                      onClick={() => onRowClick(r)}
                    >
                      <td className="px-5 py-2.5 font-mono text-[11px] text-muted-foreground">{r.code}</td>
                      <td className={`px-2 py-2.5 ${rowHoverText} transition-colors`}>
                        <div className="flex items-center gap-1.5">
                          {isTop3 && (
                            <span className={`text-[9px] font-bold px-1.5 py-0.5 rounded ${isEmerald ? "bg-emerald-600 text-white" : "bg-rose-600 text-white"}`}>
                              TOP
                            </span>
                          )}
                          <span className="truncate max-w-[280px]">{r.name}</span>
                          <ChevronRight className={`h-3 w-3 ${chevronColor} opacity-0 group-hover:opacity-100 transition-opacity ml-auto shrink-0`} />
                        </div>
                      </td>
                      <td className={`px-4 py-2.5 text-right font-mono font-medium ${totalColor}`}>{idr(r.amount)}</td>
                      <td className="px-5 py-2.5 text-right">
                        <TrendBadge current={r.amount} prev={prevMap.get(r.accountId)} />
                      </td>
                    </tr>
                  );
                })}
              </tbody>
              {/* Subtotal */}
              <tfoot className={`border-t ${isEmerald ? "border-emerald-800/25 bg-emerald-950/20" : "border-rose-800/25 bg-rose-950/20"}`}>
                <tr
                  className="cursor-pointer hover:opacity-80 transition-opacity group"
                  onClick={onTotalClick}
                >
                  <td colSpan={2} className={`px-5 py-2.5 font-semibold text-sm ${totalColor}`}>
                    <span className="flex items-center gap-1">
                      Total {label}
                      <ChevronRight className="h-3.5 w-3.5 opacity-0 group-hover:opacity-100 transition-opacity" />
                    </span>
                  </td>
                  <td className={`px-4 py-2.5 text-right font-bold font-mono ${totalColor}`}>{idr(total)}</td>
                  <td className="px-5 py-2.5 text-right">
                    <TrendBadge
                      current={total}
                      prev={accounts.reduce((s, r) => s + (prevMap.get(r.accountId) ?? 0), 0) || undefined}
                    />
                  </td>
                </tr>
              </tfoot>
            </table>
          )}
        </div>
      )}
    </div>
  );
}

/* ── Main Page ───────────────────────────────────────────────────────────── */
export default function ProfitLossPage() {
  const { activeCompanyId, isConsolidated, activeCompany } = useCompany();
  const [, navigate] = useLocation();
  const [from, setFrom] = useState(() => {
    const s = new URLSearchParams(window.location.search);
    const startDate = s.get("startDate");
    if (startDate) return startDate;
    const period = s.get("period");
    if (period && /^\d{4}-\d{2}$/.test(period)) {
      const [y, m] = period.split("-").map(Number);
      return new Date(y, m - 1, 1).toISOString().slice(0, 10);
    }
    return "";
  });
  const [to, setTo] = useState(() => {
    const s = new URLSearchParams(window.location.search);
    const endDate = s.get("endDate");
    if (endDate) return endDate;
    const period = s.get("period");
    if (period && /^\d{4}-\d{2}$/.test(period)) {
      const [y, m] = period.split("-").map(Number);
      return new Date(y, m, 0).toISOString().slice(0, 10);
    }
    return "";
  });
  const [costCenterId, setCostCenterId] = useState<string>(() => {
    const s = new URLSearchParams(window.location.search);
    return s.get("costCenterId") ?? s.get("costCenter") ?? "all";
  });
  const [view, setView] = useState<"summary" | "monthly">("summary");

  const { data: costCenters } = useQuery<CostCenter[]>({
    queryKey: ["accounting-cost-centers", activeCompanyId],
    queryFn: async () => {
      const params = new URLSearchParams();
      if (!isConsolidated && activeCompanyId) params.set("company", String(activeCompanyId));
      const res = await fetch(`/api/accounting/cost-centers?${params}`);
      if (!res.ok) return [];
      return res.json();
    },
  });

  /* Current period params */
  const params = useMemo(() => ({
    ...(from ? { from: new Date(from).toISOString() } : {}),
    ...(to ? { to: new Date(to + "T23:59:59").toISOString() } : {}),
    company: (isConsolidated ? "all" : activeCompanyId) as unknown as number,
    ...(costCenterId !== "all" ? { cost_center_id: Number(costCenterId) as unknown as number } : {}),
  }), [from, to, activeCompanyId, isConsolidated, costCenterId]);

  /* Previous period — auto-calculated */
  const prevDates = useMemo(() => {
    const now = new Date();
    if (!from && !to) {
      // No filter → prev month
      const ps = new Date(now.getFullYear(), now.getMonth() - 1, 1);
      const pe = new Date(now.getFullYear(), now.getMonth(), 0);
      return { from: ps.toISOString().slice(0, 10), to: pe.toISOString().slice(0, 10) };
    }
    if (from && to) {
      const f = new Date(from), t = new Date(to + "T23:59:59");
      const dur = t.getTime() - f.getTime();
      const prevTo = new Date(f.getTime() - 24 * 3600_000);
      const prevFrom = new Date(prevTo.getTime() - dur);
      return { from: prevFrom.toISOString().slice(0, 10), to: prevTo.toISOString().slice(0, 10) };
    }
    if (from) {
      const f = new Date(from);
      return {
        from: new Date(f.getFullYear(), f.getMonth() - 1, 1).toISOString().slice(0, 10),
        to: new Date(f.getFullYear(), f.getMonth(), 0).toISOString().slice(0, 10),
      };
    }
    return null;
  }, [from, to]);

  const prevParams = useMemo(() => !prevDates ? null : ({
    from: new Date(prevDates.from).toISOString(),
    to: new Date(prevDates.to + "T23:59:59").toISOString(),
    company: (isConsolidated ? "all" : activeCompanyId) as unknown as number,
    ...(costCenterId !== "all" ? { cost_center_id: Number(costCenterId) as unknown as number } : {}),
  }), [prevDates, activeCompanyId, isConsolidated, costCenterId]);

  const { data, isLoading } = useGetProfitLoss(params, { query: { queryKey: getGetProfitLossQueryKey(params) } });

  const { data: prevData } = useGetProfitLoss(
    prevParams ?? params,
    { query: { queryKey: getGetProfitLossQueryKey(prevParams ?? params), enabled: !!prevParams } }
  );

  /* Monthly trend */
  const monthlyQp = new URLSearchParams();
  if (from) monthlyQp.set("from", new Date(from).toISOString());
  if (to) monthlyQp.set("to", new Date(to + "T23:59:59").toISOString());
  if (!isConsolidated && activeCompanyId) monthlyQp.set("company", String(activeCompanyId));

  const { data: monthlyData, isLoading: isMonthlyLoading } = useQuery<{ months: { month: string; revenue: number; expense: number; netIncome: number }[] }>({
    queryKey: ["pl-monthly", from, to, activeCompanyId, isConsolidated],
    queryFn: async () => {
      const res = await fetch(`/api/accounting/reports/profit-loss-monthly?${monthlyQp}`);
      if (!res.ok) return { months: [] };
      return res.json();
    },
  });

  /* Derived data */
  const prevRevMap = useMemo(() =>
    new Map((prevData?.revenues ?? []).map((r) => [r.accountId, r.amount])),
    [prevData]);
  const prevExpMap = useMemo(() =>
    new Map((prevData?.expenses ?? []).map((r) => [r.accountId, r.amount])),
    [prevData]);

  const top3RevIds = useMemo(() => new Set(
    [...(data?.revenues ?? [])].sort((a, b) => b.amount - a.amount).slice(0, 3).map((r) => r.accountId)
  ), [data]);
  const top3ExpIds = useMemo(() => new Set(
    [...(data?.expenses ?? [])].sort((a, b) => b.amount - a.amount).slice(0, 3).map((r) => r.accountId)
  ), [data]);

  const companyIdForTx = isConsolidated ? null : (activeCompanyId ?? null);

  const selectedCCName = costCenterId === "all"
    ? "Semua Cost Center"
    : costCenters?.find((c) => String(c.id) === costCenterId)?.name ?? costCenterId;

  function buildExportRows() {
    if (!data) return [];
    return [
      ["=== PENDAPATAN ===", "", ""],
      ...data.revenues.map((r) => [r.code, r.name, r.amount]),
      ["", "Total Pendapatan", data.totalRevenue],
      ["", "", ""],
      ["=== BEBAN ===", "", ""],
      ...data.expenses.map((r) => [r.code, r.name, r.amount]),
      ["", "Total Beban", data.totalExpense],
      ["", "", ""],
      ["", "LABA (RUGI) BERSIH", data.netIncome],
    ] as (string | number | null | undefined)[][];
  }

  function buildMonthlyExportRows() {
    return (monthlyData?.months ?? []).map((m) => [fmtMonth(m.month), m.revenue, m.expense, m.netIncome]);
  }

  const hasData = !!data;
  const hasMonthly = (monthlyData?.months ?? []).length > 0;
  const periodLabel = from || to
    ? `${from || "—"} s/d ${to || "—"}`
    : "Semua periode";
  const prevLabel = prevDates
    ? `${prevDates.from} s/d ${prevDates.to}`
    : null;

  return (
    <AppShell>
      <BackButton href="/finance/workspace/financial-reports" />
      <div className="space-y-5 p-6 max-w-5xl mx-auto">
        <PageHeader
          onBack={() => window.history.back()}
          title="Laporan Laba Rugi"
          description={periodLabel}
          breadcrumb={[
            { label: "Dashboard", href: "/dashboard" },
            { label: "Finance", href: "/finance" },
            { label: "Laporan Keuangan", href: "/finance/workspace/financial-statements" },
            { label: "Laba Rugi" },
          ]}
          favoriteEnabled
          actions={
            <div className="flex gap-2">
              {view === "summary" && (
                <>
                  <Button variant="outline" size="sm" onClick={() => printWindow("Laporan Laba Rugi", ["Kode","Nama","Jumlah"], buildExportRows(), [2])} disabled={!hasData}>
                    <Printer className="h-4 w-4 mr-1.5" />Print
                  </Button>
                  <Button variant="outline" size="sm" onClick={() => exportXlsx("Laba_Rugi", ["Kode","Nama","Jumlah"], buildExportRows())} disabled={!hasData}>
                    <Download className="h-4 w-4 mr-1.5" />XLSX
                  </Button>
                </>
              )}
              {view === "monthly" && (
                <Button variant="outline" size="sm" onClick={() => exportXlsx("Laba_Rugi_Bulanan", ["Bulan","Pendapatan","Beban","Laba/Rugi"], buildMonthlyExportRows())} disabled={!hasMonthly}>
                  <Download className="h-4 w-4 mr-1.5" />XLSX Bulanan
                </Button>
              )}
            </div>
          }
        />

        {/* ── Filter Bar ── */}
        <Card>
          <CardContent className="p-4 flex flex-wrap gap-4">
            <div className="flex-1 min-w-[130px]">
              <Label className="text-xs text-muted-foreground">Dari</Label>
              <DatePicker value={from} onChange={setFrom} />
            </div>
            <div className="flex-1 min-w-[130px]">
              <Label className="text-xs text-muted-foreground">Sampai</Label>
              <DatePicker value={to} onChange={setTo} />
            </div>
            <div className="flex-1 min-w-[170px]">
              <Label className="text-xs text-muted-foreground">Cost Center</Label>
              <Select value={costCenterId} onValueChange={setCostCenterId}>
                <SelectTrigger><SelectValue placeholder="Semua Cost Center" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">Semua Cost Center</SelectItem>
                  {(costCenters ?? []).filter((c) => c.isActive).map((c) => (
                    <SelectItem key={c.id} value={String(c.id)}>{c.code} — {c.name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="flex items-end gap-1 min-w-fit">
              <Button variant={view === "summary" ? "default" : "outline"} size="sm" onClick={() => setView("summary")}>
                <List className="h-3.5 w-3.5 mr-1" />Ringkasan
              </Button>
              <Button variant={view === "monthly" ? "default" : "outline"} size="sm" onClick={() => setView("monthly")}>
                <BarChart3 className="h-3.5 w-3.5 mr-1" />Tren Bulanan
              </Button>
            </div>
          </CardContent>
        </Card>

        {/* ── Filter Summary ── */}
        <div className="flex items-center gap-2 text-xs text-muted-foreground bg-muted/40 rounded-lg px-3 py-2 flex-wrap">
          <CalendarDays className="h-3.5 w-3.5 shrink-0" />
          <span><span className="font-medium text-foreground">Periode:</span> {from || to ? `${from || "—"} s/d ${to || "—"}` : "Semua Periode"}</span>
          {!isConsolidated && activeCompany && (
            <><span className="text-muted-foreground/40">·</span><span><span className="font-medium text-foreground">Perusahaan:</span> {activeCompany.companyName}</span></>
          )}
          {costCenterId !== "all" && (
            <><span className="text-muted-foreground/40">·</span><span><span className="font-medium text-foreground">Cost Center:</span> {selectedCCName}</span></>
          )}
        </div>

        {/* ───── VIEW: RINGKASAN ───── */}
        {view === "summary" && (
          isLoading ? (
            <div className="space-y-3">
              <div className="grid grid-cols-4 gap-3">{Array(4).fill(0).map((_,i) => <div key={i} className="h-20 bg-white/10 rounded-xl animate-pulse" />)}</div>
              <div className="h-40 bg-white/5 rounded-xl animate-pulse" />
            </div>
          ) : !data ? (
            <Card><CardContent className="p-8 text-center text-muted-foreground text-sm">Tidak ada data untuk periode ini</CardContent></Card>
          ) : (
            <div className="space-y-4">
              {/* ── Insight Panel ── */}
              <InsightPanel curr={data as PLData} prev={prevData as PLData | undefined} from={from} to={to} />

              {/* ── Revenue Section ── */}
              <CollapsibleAccountSection
                label="Pendapatan"
                total={data.totalRevenue}
                accounts={data.revenues as PLAccount[]}
                prevMap={prevRevMap}
                top3Ids={top3RevIds}
                color="emerald"
                defaultOpen={data.revenues.length <= 10}
                onRowClick={(r) => navigate(buildTxUrl({ accountId: r.accountId, accountCode: r.code, accountName: r.name, from, to, companyId: companyIdForTx, costCenterId }))}
                onTotalClick={() => navigate(buildTxUrl({ accountGroup: "revenue", from, to, companyId: companyIdForTx, costCenterId, accountName: "Semua Pendapatan" }))}
              />

              {/* ── Expense Section ── */}
              <CollapsibleAccountSection
                label="Beban"
                total={data.totalExpense}
                accounts={data.expenses as PLAccount[]}
                prevMap={prevExpMap}
                top3Ids={top3ExpIds}
                color="rose"
                defaultOpen={data.expenses.length <= 10}
                onRowClick={(r) => navigate(buildTxUrl({ accountId: r.accountId, accountCode: r.code, accountName: r.name, from, to, companyId: companyIdForTx, costCenterId }))}
                onTotalClick={() => navigate(buildTxUrl({ accountGroup: "expense", from, to, companyId: companyIdForTx, costCenterId, accountName: "Semua Beban" }))}
              />

              {/* ── Net Profit Bar ── */}
              <div className={`rounded-xl border-2 p-5 flex items-center justify-between ${data.netIncome >= 0 ? "border-emerald-800/40 bg-emerald-950/25" : "border-rose-800/40 bg-rose-950/25"}`}>
                <div>
                  <p className="text-xs text-muted-foreground font-medium uppercase tracking-wide mb-0.5">Laba (Rugi) Bersih</p>
                  <p className={`text-3xl font-bold font-mono ${data.netIncome >= 0 ? "text-emerald-400" : "text-rose-400"}`} data-testid="text-net-income">
                    {idr(data.netIncome)}
                  </p>
                  {data.totalRevenue > 0 && (
                    <p className="text-xs text-muted-foreground mt-1">
                      Margin {((data.netIncome / data.totalRevenue) * 100).toFixed(1)}%
                    </p>
                  )}
                </div>
                <div className="flex flex-col items-end gap-1">
                  {prevData && prevData.netIncome !== 0 && (
                    <TrendBadge current={data.netIncome} prev={prevData.netIncome} />
                  )}
                  {prevData && (
                    <p className="text-xs text-muted-foreground">Prev: {idrShort(prevData.netIncome)}</p>
                  )}
                </div>
              </div>
            </div>
          )
        )}

        {/* ───── VIEW: TREN BULANAN ───── */}
        {view === "monthly" && (
          isMonthlyLoading ? (
            <Card><CardContent className="p-4 text-muted-foreground text-sm">Memuat data bulanan...</CardContent></Card>
          ) : !hasMonthly ? (
            <Card><CardContent className="p-4 text-center text-muted-foreground text-sm py-8">
              Tidak ada data jurnal dalam periode ini.<br />Pilih rentang tanggal atau pastikan jurnal sudah ter-posting.
            </CardContent></Card>
          ) : (
            <>
              <Card>
                <CardContent className="p-4">
                  <p className="font-semibold text-sm mb-4">Grafik Laba Rugi per Bulan</p>
                  <ResponsiveContainer width="100%" height={320}>
                    <ComposedChart data={monthlyData!.months} margin={{ top: 4, right: 20, left: 0, bottom: 4 }}>
                      <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
                      <XAxis dataKey="month" tickFormatter={fmtMonth} tick={{ fontSize: 11 }} />
                      <YAxis tickFormatter={idrShort} tick={{ fontSize: 11 }} width={70} />
                      <Tooltip
                        formatter={(v: number, name: string) => [idr(v), name === "revenue" ? "Pendapatan" : name === "expense" ? "Beban" : "Laba/Rugi"]}
                        labelFormatter={fmtMonth}
                      />
                      <Legend formatter={(v) => v === "revenue" ? "Pendapatan" : v === "expense" ? "Beban" : "Laba/Rugi Bersih"} />
                      <Bar dataKey="revenue" fill="#10b981" radius={[3,3,0,0]} />
                      <Bar dataKey="expense" fill="#f43f5e" radius={[3,3,0,0]} />
                      <Line dataKey="netIncome" stroke="#6366f1" strokeWidth={2.5} dot={{ r: 4 }} activeDot={{ r: 6 }} />
                    </ComposedChart>
                  </ResponsiveContainer>
                </CardContent>
              </Card>

              <Card>
                <CardContent className="p-0">
                  <table className="w-full text-sm">
                    <thead className="bg-white/5 text-xs text-muted-foreground">
                      <tr>
                        <th className="text-left px-5 py-2.5 font-medium">Bulan</th>
                        <th className="text-right px-4 py-2.5 font-medium text-emerald-700">Pendapatan</th>
                        <th className="text-right px-4 py-2.5 font-medium text-rose-700">Beban</th>
                        <th className="text-right px-5 py-2.5 font-medium">Laba / Rugi</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y">
                      {monthlyData!.months.map((m) => (
                        <tr key={m.month} className="hover:bg-white/5 transition-colors duration-150">
                          <td className="px-5 py-2.5 font-medium">{fmtMonth(m.month)}</td>
                          <td className="px-4 py-2.5 text-right font-mono text-emerald-700">{idr(m.revenue)}</td>
                          <td className="px-4 py-2.5 text-right font-mono text-rose-700">{idr(m.expense)}</td>
                          <td className={`px-5 py-2.5 text-right font-mono font-semibold ${m.netIncome >= 0 ? "text-emerald-700" : "text-rose-700"}`}>
                            {idr(m.netIncome)}
                          </td>
                        </tr>
                      ))}
                      {(() => {
                        const ms = monthlyData!.months;
                        const totRev = ms.reduce((s, m) => s + m.revenue, 0);
                        const totExp = ms.reduce((s, m) => s + m.expense, 0);
                        const totNet = totRev - totExp;
                        return (
                          <tr className="font-bold border-t-2 bg-white/5">
                            <td className="px-5 py-2.5">Total</td>
                            <td className="px-4 py-2.5 text-right font-mono text-emerald-700">{idr(totRev)}</td>
                            <td className="px-4 py-2.5 text-right font-mono text-rose-700">{idr(totExp)}</td>
                            <td className={`px-5 py-2.5 text-right font-mono ${totNet >= 0 ? "text-emerald-700" : "text-rose-700"}`}>{idr(totNet)}</td>
                          </tr>
                        );
                      })()}
                    </tbody>
                  </table>
                </CardContent>
              </Card>
            </>
          )
        )}
      </div>
    </AppShell>
  );
}
