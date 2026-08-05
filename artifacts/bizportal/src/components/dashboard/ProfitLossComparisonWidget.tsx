import { useQuery } from "@tanstack/react-query";
import { useCompany } from "@/contexts/CompanyContext";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { Link } from "wouter";
import { TrendingUp, TrendingDown, Minus, ArrowRight, BarChart3 } from "lucide-react";
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
  ResponsiveContainer,
} from "recharts";

interface KPI {
  monthRevenue: number;
  monthExpense: number;
  monthNetPL: number;
  periodYear: number;
  periodMonth: number;
}

const MONTHS_SHORT = [
  "Jan", "Feb", "Mar", "Apr", "Mei", "Jun",
  "Jul", "Agu", "Sep", "Okt", "Nov", "Des",
];

const idrCompact = (n: number): string => {
  const abs = Math.abs(n);
  if (abs >= 1_000_000_000) return `${(n / 1_000_000_000).toFixed(1)}M`;
  if (abs >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}Jt`;
  if (abs >= 1_000) return `${(n / 1_000).toFixed(0)}Rb`;
  return String(n);
};

const idrFull = (n: number): string =>
  new Intl.NumberFormat("id-ID", {
    style: "currency",
    currency: "IDR",
    maximumFractionDigits: 0,
  }).format(n);

function pctDiff(curr: number, prev: number): number | null {
  if (prev === 0) return null;
  return ((curr - prev) / prev) * 100;
}

function DiffBadge({ curr, prev, inverse = false }: { curr: number; prev: number; inverse?: boolean }) {
  const diff = pctDiff(curr, prev);
  if (diff === null) return <span className="text-[10px] text-muted-foreground">—</span>;
  const positive = inverse ? diff < 0 : diff > 0;
  const color = positive ? "text-emerald-600" : diff === 0 ? "text-muted-foreground" : "text-red-600";
  const Icon = diff > 0 ? TrendingUp : diff < 0 ? TrendingDown : Minus;
  return (
    <span className={`inline-flex items-center gap-0.5 text-[10px] font-medium ${color}`}>
      <Icon className="h-3 w-3" />
      {diff > 0 ? "+" : ""}{diff.toFixed(1)}%
    </span>
  );
}

const CustomTooltip = ({ active, payload, label }: {
  active?: boolean;
  payload?: Array<{ name: string; value: number; color: string }>;
  label?: string;
}) => {
  if (!active || !payload?.length) return null;
  return (
    <div className="rounded-lg border bg-background shadow-md px-3 py-2 text-xs space-y-1">
      <p className="font-semibold text-foreground mb-1">{label}</p>
      {payload.map((p) => (
        <div key={p.name} className="flex items-center justify-between gap-4">
          <span className="flex items-center gap-1.5">
            <span className="inline-block h-2 w-2 rounded-sm" style={{ background: p.color }} />
            <span className="text-muted-foreground">{p.name}</span>
          </span>
          <span className="font-semibold tabular-nums">{idrFull(p.value)}</span>
        </div>
      ))}
    </div>
  );
};

export function ProfitLossComparisonWidget() {
  const { activeCompanyId } = useCompany();

  const now = new Date();
  const curYear = now.getFullYear();
  const curMonth = now.getMonth() + 1;
  const prevMonth = curMonth === 1 ? 12 : curMonth - 1;
  const prevYear = curMonth === 1 ? curYear - 1 : curYear;

  const makeQs = (month: number, year: number) => {
    const qs = new URLSearchParams({ month: String(month), year: String(year) });
    if (activeCompanyId) qs.set("companyId", String(activeCompanyId));
    return qs.toString();
  };

  const { data: curr, isLoading: loadingCurr } = useQuery<KPI>({
    queryKey: ["pl-kpi-curr", activeCompanyId, curYear, curMonth],
    queryFn: async () => {
      const r = await fetch(`/api/accounting/dashboard-kpi?${makeQs(curMonth, curYear)}`, { credentials: "include" });
      if (!r.ok) throw new Error("Gagal memuat data");
      return r.json() as Promise<KPI>;
    },
    refetchInterval: 10 * 60_000,
    retry: 1,
  });

  const { data: prev, isLoading: loadingPrev } = useQuery<KPI>({
    queryKey: ["pl-kpi-prev", activeCompanyId, prevYear, prevMonth],
    queryFn: async () => {
      const r = await fetch(`/api/accounting/dashboard-kpi?${makeQs(prevMonth, prevYear)}`, { credentials: "include" });
      if (!r.ok) throw new Error("Gagal memuat data");
      return r.json() as Promise<KPI>;
    },
    staleTime: 30 * 60_000,
    retry: 1,
  });

  const isLoading = loadingCurr || loadingPrev;

  const labelPrev = `${MONTHS_SHORT[(prevMonth - 1)]} ${prevYear}`;
  const labelCurr = `${MONTHS_SHORT[(curMonth - 1)]} ${curYear}`;

  const chartData = [
    {
      name: "Revenue",
      [labelPrev]: prev?.monthRevenue ?? 0,
      [labelCurr]: curr?.monthRevenue ?? 0,
    },
    {
      name: "Beban",
      [labelPrev]: prev?.monthExpense ?? 0,
      [labelCurr]: curr?.monthExpense ?? 0,
    },
    {
      name: "Laba Bersih",
      [labelPrev]: prev?.monthNetPL ?? 0,
      [labelCurr]: curr?.monthNetPL ?? 0,
    },
  ];

  const netCurr = curr?.monthNetPL ?? 0;
  const netPrev = prev?.monthNetPL ?? 0;
  const netPositive = netCurr >= 0;

  return (
    <Card className="lg:col-span-2 border-border/70">
      <CardHeader className="pb-3">
        <div className="flex items-center justify-between gap-2 flex-wrap">
          <div className="flex items-center gap-2">
            <div className="p-1.5 rounded-lg bg-violet-100 dark:bg-violet-900/40">
              <BarChart3 className="h-4 w-4 text-violet-600 dark:text-violet-400" />
            </div>
            <div>
              <CardTitle className="text-base">Laba Rugi — Bulan Ini vs Bulan Lalu</CardTitle>
              <p className="text-xs text-muted-foreground mt-0.5">
                {labelPrev} dibandingkan {labelCurr}
              </p>
            </div>
          </div>
          <Link href="/accounting/reports/profit-loss" className="text-xs text-muted-foreground hover:text-foreground flex items-center gap-1 transition-colors">
            Detail P&L <ArrowRight className="h-3 w-3" />
          </Link>
        </div>
      </CardHeader>

      <CardContent className="space-y-4">
        {isLoading ? (
          <div className="space-y-3">
            <Skeleton className="h-48 w-full rounded-lg" />
            <div className="grid grid-cols-3 gap-3">
              {[1, 2, 3].map((i) => <Skeleton key={i} className="h-14 rounded-lg" />)}
            </div>
          </div>
        ) : (
          <>
            {/* Bar chart */}
            <ResponsiveContainer width="100%" height={200}>
              <BarChart
                data={chartData}
                margin={{ top: 4, right: 16, left: 8, bottom: 0 }}
                barCategoryGap="28%"
                barGap={4}
              >
                <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="hsl(var(--border))" />
                <XAxis
                  dataKey="name"
                  tick={{ fontSize: 11, fill: "hsl(var(--muted-foreground))" }}
                  axisLine={false}
                  tickLine={false}
                />
                <YAxis
                  tickFormatter={idrCompact}
                  tick={{ fontSize: 10, fill: "hsl(var(--muted-foreground))" }}
                  axisLine={false}
                  tickLine={false}
                  width={52}
                />
                <Tooltip content={<CustomTooltip />} cursor={{ fill: "hsl(var(--accent))", opacity: 0.5 }} />
                <Legend
                  iconType="square"
                  iconSize={8}
                  wrapperStyle={{ fontSize: 11, paddingTop: 8 }}
                />
                <Bar dataKey={labelPrev} fill="#94a3b8" radius={[4, 4, 0, 0]} maxBarSize={48} />
                <Bar dataKey={labelCurr} fill="#8b5cf6" radius={[4, 4, 0, 0]} maxBarSize={48} />
              </BarChart>
            </ResponsiveContainer>

            {/* Summary cards */}
            <div className="grid grid-cols-3 gap-3">
              {/* Revenue */}
              <div className="rounded-lg border border-emerald-200/60 bg-emerald-50 dark:bg-emerald-950/20 dark:border-emerald-800/40 p-3">
                <p className="text-[10px] text-muted-foreground mb-1">Revenue {labelCurr}</p>
                <p className="text-sm font-bold text-emerald-700 dark:text-emerald-400 tabular-nums truncate">
                  {idrFull(curr?.monthRevenue ?? 0)}
                </p>
                <div className="flex items-center gap-1 mt-1">
                  <DiffBadge curr={curr?.monthRevenue ?? 0} prev={prev?.monthRevenue ?? 0} />
                  <span className="text-[10px] text-muted-foreground">vs {labelPrev}</span>
                </div>
              </div>

              {/* Beban */}
              <div className="rounded-lg border border-rose-200/60 bg-rose-50 dark:bg-rose-950/20 dark:border-rose-800/40 p-3">
                <p className="text-[10px] text-muted-foreground mb-1">Beban {labelCurr}</p>
                <p className="text-sm font-bold text-rose-700 dark:text-rose-400 tabular-nums truncate">
                  {idrFull(curr?.monthExpense ?? 0)}
                </p>
                <div className="flex items-center gap-1 mt-1">
                  <DiffBadge curr={curr?.monthExpense ?? 0} prev={prev?.monthExpense ?? 0} inverse />
                  <span className="text-[10px] text-muted-foreground">vs {labelPrev}</span>
                </div>
              </div>

              {/* Net P&L */}
              <div
                className={`rounded-lg border p-3 ${
                  netPositive
                    ? "border-emerald-200/60 bg-emerald-50 dark:bg-emerald-950/20 dark:border-emerald-800/40"
                    : "border-red-200/60 bg-red-50 dark:bg-red-950/20 dark:border-red-800/40"
                }`}
              >
                <p className="text-[10px] text-muted-foreground mb-1">Laba Bersih {labelCurr}</p>
                <p className={`text-sm font-bold tabular-nums truncate ${netPositive ? "text-emerald-700 dark:text-emerald-400" : "text-red-700 dark:text-red-400"}`}>
                  {idrFull(netCurr)}
                </p>
                <div className="flex items-center gap-1 mt-1">
                  <DiffBadge curr={netCurr} prev={netPrev} />
                  <span className="text-[10px] text-muted-foreground">vs {labelPrev}</span>
                </div>
              </div>
            </div>
          </>
        )}
      </CardContent>
    </Card>
  );
}
