import { DatePicker } from "@/components/ui/date-picker";
import { useEffect, useState } from "react";
import { AppShell } from "@/components/layout/AppShell";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Link, useRoute } from "wouter";
import {
  ArrowLeft, ArrowRight,
  Wallet, TrendingUp, Users, Receipt, Activity, FileText,
  AlertTriangle, CheckCircle2, ChevronRight,
  ArrowUpRight, ArrowDownRight,
} from "lucide-react";
import { useCompany } from "@/contexts/CompanyContext";
import {
  AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer,
} from "recharts";

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
  if (!r.ok) throw new Error(`fetch failed: ${r.status}`);
  return r.json();
}

function fmtDate(d: Date) { return d.toISOString().slice(0, 10); }

const KPI_META: Record<string, { title: string; icon: React.ElementType; color: string; desc: string }> = {
  cash:    { title: "Cash Position",       icon: Wallet,     color: "text-blue-400",   desc: "Posisi kas & bank perusahaan" },
  ar:      { title: "Accounts Receivable", icon: Users,      color: "text-green-400",  desc: "Piutang dagang & aging" },
  ap:      { title: "Accounts Payable",    icon: Receipt,    color: "text-red-400",    desc: "Hutang dagang & jadwal bayar" },
  revenue: { title: "Revenue",             icon: TrendingUp, color: "text-purple-400", desc: "Pendapatan per akun COA" },
  profit:  { title: "Net Profit / P&L",   icon: Activity,   color: "text-teal-400",   desc: "Laba rugi periode berjalan" },
  tax:     { title: "Tax Position",        icon: FileText,   color: "text-amber-400",  desc: "Posisi pajak PPN, PPh, WHT" },
};

interface TrialRow { accountId: number; code: string; name: string; type: string; balance: number }
interface MonthPoint { month: string; label: string; saldo: number }
interface PLAccount { accountId: number; code: string; name: string; amount: number }
interface ArItem { id: number; docNumber: string; customerName: string; grandTotal: number; amountPaid: number; amount: number; daysOld: number; bucket: string; confirmedAt: string }
interface ApItem { id: number; docNumber: string; supplierName: string; grandTotal: number; amountPaid: number; amount: number; daysOld: number; bucket: string; confirmedAt: string }
interface TaxItem { id: number; period: string; taxName: string; taxRate: number; cutType: string; transactionType: string; baseAmount: number; taxAmount: number; status: string }

function DateRangeFilter({
  from, to, onFrom, onTo
}: { from: string; to: string; onFrom: (v: string) => void; onTo: (v: string) => void }) {
  return (
    <div className="flex flex-wrap items-end gap-3">
      <div className="flex flex-col gap-1">
        <Label className="text-xs text-muted-foreground">Dari</Label>
        <DatePicker value={from} onChange={(v) => onFrom(v)} className="h-8 text-sm w-36" />
      </div>
      <div className="flex flex-col gap-1">
        <Label className="text-xs text-muted-foreground">Sampai</Label>
        <DatePicker value={to} onChange={(v) => onTo(v)} className="h-8 text-sm w-36" />
      </div>
    </div>
  );
}

function SummaryCard({ title, value, sub, color = "text-foreground" }: { title: string; value: string; sub?: string; color?: string }) {
  return (
    <div className="bg-muted/30 rounded-lg p-4 border border-border">
      <p className="text-xs text-muted-foreground font-medium uppercase tracking-wide mb-1">{title}</p>
      <p className={`text-2xl font-bold ${color}`}>{value}</p>
      {sub && <p className="text-xs text-muted-foreground mt-0.5">{sub}</p>}
    </div>
  );
}

function InsightKPI({
  label, value, sub, trend, badge, badgeColor,
}: {
  label: string;
  value: string;
  sub?: string;
  trend?: { pct: number };
  badge?: string;
  badgeColor?: "green" | "red" | "amber" | "slate";
}) {
  const bc = badgeColor ?? "slate";
  const badgeCls = bc === "green" ? "bg-green-900/50 text-green-300" : bc === "red" ? "bg-red-900/50 text-red-300" : bc === "amber" ? "bg-amber-900/50 text-amber-300" : "bg-muted text-muted-foreground";
  return (
    <div className="bg-card rounded-xl border border-border p-4">
      <p className="text-[11px] font-medium text-muted-foreground uppercase tracking-wide mb-1">{label}</p>
      <p className="text-xl font-bold text-foreground leading-tight">{value}</p>
      <div className="flex items-center gap-1.5 mt-1 flex-wrap">
        {sub && <span className="text-[11px] text-muted-foreground">{sub}</span>}
        {trend && Math.abs(trend.pct) > 0.1 && (
          <span className={`inline-flex items-center gap-0.5 text-[10px] font-semibold px-1.5 py-0.5 rounded-full ${trend.pct > 0 ? "text-emerald-300 bg-emerald-900/50" : "text-rose-300 bg-rose-900/50"}`}>
            {trend.pct > 0 ? <ArrowUpRight className="h-2.5 w-2.5" /> : <ArrowDownRight className="h-2.5 w-2.5" />}
            {Math.abs(trend.pct).toFixed(1)}%
          </span>
        )}
        {badge && <span className={`inline-flex items-center text-[10px] font-semibold px-1.5 py-0.5 rounded-full ${badgeCls}`}>{badge}</span>}
      </div>
    </div>
  );
}

function AgingBar({ label, amount, total, color }: { label: string; amount: number; total: number; color: string }) {
  const pct = total > 0 ? Math.min(100, (amount / total) * 100) : 0;
  return (
    <div className="flex items-center gap-3">
      <span className="text-xs text-muted-foreground w-20 shrink-0">{label}</span>
      <div className="flex-1 bg-muted/50 rounded-full h-2 overflow-hidden">
        <div className="h-full rounded-full" style={{ width: `${pct}%`, backgroundColor: color }} />
      </div>
      <span className="text-xs font-semibold text-foreground w-24 text-right shrink-0">
        {amount > 0 ? idrShort(amount) : "—"}
      </span>
      <span className="text-xs text-muted-foreground w-10 text-right shrink-0">
        {pct > 0 ? `${pct.toFixed(0)}%` : ""}
      </span>
    </div>
  );
}

function AccountRow({ accountId, code, name, amount, type, startDate, endDate, companyId }: {
  accountId: number; code: string; name: string; amount: number; type: string; startDate: string; endDate: string; companyId: number;
}) {
  const params = new URLSearchParams({
    accountId: String(accountId),
    accountName: name,
    accountCode: code,
    startDate,
    endDate,
    company: String(companyId),
  });
  return (
    <Link href={`/finance/transactions/detail?${params}`}>
      <div className="flex items-center gap-3 py-2.5 px-3 rounded-md hover:bg-white/5 transition-colors duration-150 cursor-pointer group border-b border-border last:border-0">
        <span className="text-xs text-muted-foreground font-mono w-16 shrink-0">{code}</span>
        <span className="text-sm text-foreground flex-1 min-w-0 truncate group-hover:text-blue-400">{name}</span>
        <span className={`text-sm font-semibold shrink-0 ${amount < 0 ? "text-red-400" : "text-foreground"}`}>
          {idrShort(amount)}
        </span>
        <ChevronRight className="h-3.5 w-3.5 text-muted-foreground opacity-0 group-hover:opacity-100 transition-opacity shrink-0" />
      </div>
    </Link>
  );
}

// ── Cash View ──────────────────────────────────────────────────────────────
function CashView({ companyId, from, to }: { companyId: number; from: string; to: string }) {
  const [trialRows, setTrialRows] = useState<TrialRow[]>([]);
  const [monthly, setMonthly] = useState<MonthPoint[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    setLoading(true);
    Promise.all([
      apiFetch<{ rows: TrialRow[] }>(`/api/accounting/reports/trial-balance?company=${companyId}`).catch(() => null),
      apiFetch<{ months: MonthPoint[] }>(`/api/accounting/dashboard/monthly-cash?company=${companyId}`).catch(() => null),
    ]).then(([tb, mc]) => {
      if (tb) setTrialRows((tb.rows ?? []).filter((r) => r.type === "asset" && /kas|bank|cash/i.test(r.name)));
      if (mc) setMonthly(mc.months ?? []);
      setLoading(false);
    });
  }, [companyId]);

  const total = trialRows.reduce((s, r) => s + r.balance, 0);
  const chartMin = monthly.length ? Math.min(...monthly.map((d) => d.saldo)) * 0.9 : 0;
  const chartMax = monthly.length ? Math.max(...monthly.map((d) => d.saldo)) * 1.1 : 0;

  const momPct = monthly.length >= 2
    ? monthly[monthly.length - 2].saldo !== 0
      ? ((monthly[monthly.length - 1].saldo - monthly[monthly.length - 2].saldo) / Math.abs(monthly[monthly.length - 2].saldo)) * 100
      : null
    : null;
  const topAccount = [...trialRows].sort((a, b) => b.balance - a.balance)[0];
  const cashStatus = total <= 0 ? "KRITIS" : total < 50_000_000 ? "RENDAH" : "SEHAT";

  return (
    <div className="space-y-5">
      {!loading && (
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          <InsightKPI label="Total Kas & Bank" value={`Rp ${idr(total)}`} sub={`${trialRows.length} rekening`}
            trend={momPct !== null ? { pct: momPct } : undefined} />
          <InsightKPI label="Bulan ke Bulan" value={momPct !== null ? `${momPct >= 0 ? "+" : ""}${momPct.toFixed(1)}%` : "—"}
            sub={monthly.length >= 2 ? `vs ${monthly[monthly.length - 2].label}` : "Belum ada data"}
            trend={momPct !== null ? { pct: momPct } : undefined} />
          <InsightKPI label="Rekening Terbesar"
            value={topAccount ? idrShort(topAccount.balance) : "—"}
            sub={topAccount?.name ?? "Tidak ada"} />
          <InsightKPI label="Status Kas" value={cashStatus}
            badge={cashStatus}
            badgeColor={cashStatus === "SEHAT" ? "green" : cashStatus === "RENDAH" ? "amber" : "red"} />
        </div>
      )}

      <div className="grid grid-cols-2 md:grid-cols-3 gap-4">
        <SummaryCard title="Total Kas & Bank" value={`Rp ${idr(total)}`} sub={`${trialRows.length} rekening`} color="text-blue-400" />
      </div>

      <Card>
        <CardHeader className="py-3 px-5">
          <CardTitle className="text-sm font-semibold">Tren Saldo Kas 12 Bulan</CardTitle>
        </CardHeader>
        <CardContent className="px-2 pb-4">
          {loading ? <div className="h-48 bg-muted/20 rounded animate-pulse" /> : (
            <ResponsiveContainer width="100%" height={180}>
              <AreaChart data={monthly}>
                <defs>
                  <linearGradient id="cg" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%" stopColor="#3b82f6" stopOpacity={0.3} />
                    <stop offset="95%" stopColor="#3b82f6" stopOpacity={0} />
                  </linearGradient>
                </defs>
                <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.07)" />
                <XAxis dataKey="label" tick={{ fontSize: 10, fill: "#94a3b8" }} tickLine={false} axisLine={false} />
                <YAxis tick={{ fontSize: 9, fill: "#94a3b8" }} tickLine={false} axisLine={false} domain={[chartMin, chartMax]}
                  tickFormatter={(v) => idrShort(v).replace("Rp ", "")} width={48} />
                <Tooltip content={({ active, payload, label }) => !active || !payload?.length ? null : (
                  <div className="bg-card border border-border rounded-lg shadow-lg p-3 text-sm">
                    <p className="font-semibold mb-1 text-foreground">{label}</p>
                    <p className="text-blue-400 font-bold">Rp {idr(payload[0].value as number)}</p>
                  </div>
                )} />
                <Area type="monotone" dataKey="saldo" stroke="#3b82f6" strokeWidth={2} fill="url(#cg)" dot={false} />
              </AreaChart>
            </ResponsiveContainer>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="py-3 px-5">
          <CardTitle className="text-sm font-semibold">Saldo per Rekening</CardTitle>
        </CardHeader>
        <CardContent className="px-5 pb-4">
          {loading ? <div className="h-20 bg-muted/20 rounded animate-pulse" /> : (
            <div className="divide-y divide-border">
              {trialRows.map((r) => (
                <div key={r.accountId} className="flex items-center justify-between py-2.5">
                  <div>
                    <span className="text-xs text-muted-foreground font-mono mr-2">{r.code}</span>
                    <span className="text-sm text-foreground">{r.name}</span>
                  </div>
                  <span className="text-sm font-semibold text-blue-400">Rp {idr(r.balance)}</span>
                </div>
              ))}
              {trialRows.length === 0 && <p className="text-sm text-muted-foreground py-4 text-center">Tidak ada data</p>}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

// ── AR View ────────────────────────────────────────────────────────────────
function ArView({ companyId }: { companyId: number }) {
  const [data, setData] = useState<{ total: number; buckets: Record<string, number>; items: ArItem[] } | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    setLoading(true);
    apiFetch<{ total: number; buckets: Record<string, number>; items: ArItem[] }>(`/api/reports/ar-aging?company=${companyId}`)
      .then(setData).catch(() => setData(null)).finally(() => setLoading(false));
  }, [companyId]);

  const total = data?.total ?? 0;
  const buckets = data?.buckets ?? {};
  const AGING_COLORS = ["#22c55e", "#f59e0b", "#f97316", "#ef4444"];
  const AGING_LABELS = [["0-30", "0–30 hari"], ["31-60", "31–60 hari"], ["61-90", "61–90 hari"], ["90+", "> 90 hari"]];

  const arOverdue = (buckets["31-60"] ?? 0) + (buckets["61-90"] ?? 0) + (buckets["90+"] ?? 0);
  const arOverduePct = total > 0 ? (arOverdue / total) * 100 : 0;
  const arRisk = arOverduePct > 30 ? "TINGGI" : arOverduePct > 10 ? "SEDANG" : "RENDAH";
  const topDebtor = data?.items ? [...data.items].sort((a, b) => b.amount - a.amount)[0] : null;

  return (
    <div className="space-y-5">
      {!loading && (
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          <InsightKPI label="Total Piutang" value={idrShort(total)} sub={`${data?.items?.length ?? 0} dokumen aktif`} />
          <InsightKPI label="% Overdue" value={`${arOverduePct.toFixed(1)}%`}
            sub={arOverduePct > 0 ? `= ${idrShort(arOverdue)}` : "Semua on-time"}
            badge={arRisk} badgeColor={arRisk === "RENDAH" ? "green" : arRisk === "SEDANG" ? "amber" : "red"} />
          <InsightKPI label="Debitur Terbesar"
            value={topDebtor ? idrShort(topDebtor.amount) : "—"}
            sub={topDebtor?.customerName ?? "Tidak ada"} />
          <InsightKPI label="Risiko Kolektibilitas" value={arRisk}
            badge={arRisk} badgeColor={arRisk === "RENDAH" ? "green" : arRisk === "SEDANG" ? "amber" : "red"}
            sub={`>90hr: ${idrShort(buckets["90+"] ?? 0)}`} />
        </div>
      )}

      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <SummaryCard title="Total Piutang" value={idrShort(total)} sub={`${data?.items?.length ?? 0} dokumen`} color="text-green-400" />
        <SummaryCard title="Overdue (>30 hr)" value={idrShort((buckets["31-60"] ?? 0) + (buckets["61-90"] ?? 0) + (buckets["90+"] ?? 0))}
          color={(buckets["31-60"] ?? 0) + (buckets["61-90"] ?? 0) + (buckets["90+"] ?? 0) > 0 ? "text-red-400" : "text-green-400"} />
        <SummaryCard title="> 90 Hari" value={idrShort(buckets["90+"] ?? 0)}
          color={(buckets["90+"] ?? 0) > 0 ? "text-red-400" : "text-muted-foreground"} />
        <SummaryCard title="0–30 Hari" value={idrShort(buckets["0-30"] ?? 0)} color="text-green-400" />
      </div>

      <Card>
        <CardHeader className="py-3 px-5"><CardTitle className="text-sm font-semibold">Aging Breakdown</CardTitle></CardHeader>
        <CardContent className="px-5 pb-5 space-y-3">
          {AGING_LABELS.map(([key, label], i) => (
            <AgingBar key={key} label={label} amount={buckets[key] ?? 0} total={total} color={AGING_COLORS[i]} />
          ))}
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="py-3 px-5"><CardTitle className="text-sm font-semibold">Daftar Piutang</CardTitle></CardHeader>
        <CardContent className="px-0 pb-0">
          {loading ? <div className="h-40 bg-muted/20 m-5 rounded animate-pulse" /> : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="bg-muted/30 text-xs text-muted-foreground border-b border-border">
                  <tr>
                    <th className="text-left px-5 py-2.5 font-medium">No. Dok</th>
                    <th className="text-left px-3 py-2.5 font-medium">Customer</th>
                    <th className="text-right px-3 py-2.5 font-medium">Grand Total</th>
                    <th className="text-right px-3 py-2.5 font-medium">Sisa</th>
                    <th className="text-center px-3 py-2.5 font-medium">Umur</th>
                    <th className="text-center px-5 py-2.5 font-medium">Bucket</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border">
                  {(data?.items ?? []).slice(0, 100).map((item) => (
                    <tr key={item.id} className="hover:bg-white/5 transition-colors duration-150">
                      <td className="px-5 py-2.5 font-mono text-xs text-muted-foreground">{item.docNumber}</td>
                      <td className="px-3 py-2.5 text-foreground max-w-xs truncate">{item.customerName}</td>
                      <td className="px-3 py-2.5 text-right text-muted-foreground">{idrShort(item.grandTotal)}</td>
                      <td className="px-3 py-2.5 text-right font-semibold text-foreground">{idrShort(item.amount)}</td>
                      <td className="px-3 py-2.5 text-center">
                        <Badge variant={item.daysOld > 90 ? "destructive" : item.daysOld > 30 ? "secondary" : "outline"} className="text-xs">
                          {item.daysOld}h
                        </Badge>
                      </td>
                      <td className="px-5 py-2.5 text-center text-xs text-muted-foreground">{item.bucket}</td>
                    </tr>
                  ))}
                  {(data?.items ?? []).length === 0 && (
                    <tr><td colSpan={6} className="px-5 py-8 text-center text-muted-foreground text-sm">Tidak ada piutang</td></tr>
                  )}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

// ── AP View ────────────────────────────────────────────────────────────────
function ApView({ companyId }: { companyId: number }) {
  const [data, setData] = useState<{ total: number; buckets: Record<string, number>; items: ApItem[] } | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    setLoading(true);
    apiFetch<{ total: number; buckets: Record<string, number>; items: ApItem[] }>(`/api/reports/ap-aging?company=${companyId}`)
      .then(setData).catch(() => setData(null)).finally(() => setLoading(false));
  }, [companyId]);

  const total = data?.total ?? 0;
  const buckets = data?.buckets ?? {};
  const AGING_COLORS = ["#3b82f6", "#f59e0b", "#f97316", "#ef4444"];
  const AGING_LABELS = [["0-30", "0–30 hari"], ["31-60", "31–60 hari"], ["61-90", "61–90 hari"], ["90+", "> 90 hari"]];

  const apOverdue = (buckets["31-60"] ?? 0) + (buckets["61-90"] ?? 0) + (buckets["90+"] ?? 0);
  const apCurrent = buckets["0-30"] ?? 0;
  const apUrgency = apOverdue > 0 ? "TERLAMBAT" : apCurrent > 0 ? "JATUH TEMPO" : "BERSIH";
  const topCreditor = data?.items ? [...data.items].sort((a, b) => b.amount - a.amount)[0] : null;

  return (
    <div className="space-y-5">
      {!loading && (
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          <InsightKPI label="Total Hutang" value={idrShort(total)} sub={`${data?.items?.length ?? 0} vendor aktif`} />
          <InsightKPI label="Overdue >30 Hari" value={idrShort(apOverdue)}
            sub={apOverdue > 0 ? "Perlu segera dibayar" : "Semua on-time"}
            badge={apOverdue > 0 ? "TERLAMBAT" : "ON-TIME"}
            badgeColor={apOverdue > 0 ? "red" : "green"} />
          <InsightKPI label="Kreditur Terbesar"
            value={topCreditor ? idrShort(topCreditor.amount) : "—"}
            sub={topCreditor?.supplierName ?? "Tidak ada"} />
          <InsightKPI label="Status AP" value={apUrgency}
            badge={apUrgency}
            badgeColor={apUrgency === "BERSIH" ? "green" : apUrgency === "JATUH TEMPO" ? "amber" : "red"}
            sub={`>90hr: ${idrShort(buckets["90+"] ?? 0)}`} />
        </div>
      )}

      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <SummaryCard title="Total Hutang" value={idrShort(total)} sub={`${data?.items?.length ?? 0} dokumen`} color="text-red-400" />
        <SummaryCard title="Overdue (>30 hr)" value={idrShort((buckets["31-60"] ?? 0) + (buckets["61-90"] ?? 0) + (buckets["90+"] ?? 0))}
          color={(buckets["31-60"] ?? 0) + (buckets["61-90"] ?? 0) + (buckets["90+"] ?? 0) > 0 ? "text-red-400" : "text-green-400"} />
        <SummaryCard title="> 90 Hari" value={idrShort(buckets["90+"] ?? 0)}
          color={(buckets["90+"] ?? 0) > 0 ? "text-red-400" : "text-muted-foreground"} />
        <SummaryCard title="0–30 Hari" value={idrShort(buckets["0-30"] ?? 0)} color="text-blue-400" />
      </div>

      <Card>
        <CardHeader className="py-3 px-5"><CardTitle className="text-sm font-semibold">Aging Breakdown</CardTitle></CardHeader>
        <CardContent className="px-5 pb-5 space-y-3">
          {AGING_LABELS.map(([key, label], i) => (
            <AgingBar key={key} label={label} amount={buckets[key] ?? 0} total={total} color={AGING_COLORS[i]} />
          ))}
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="py-3 px-5"><CardTitle className="text-sm font-semibold">Daftar Hutang Vendor</CardTitle></CardHeader>
        <CardContent className="px-0 pb-0">
          {loading ? <div className="h-40 bg-muted/20 m-5 rounded animate-pulse" /> : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="bg-muted/30 text-xs text-muted-foreground border-b border-border">
                  <tr>
                    <th className="text-left px-5 py-2.5 font-medium">No. Dok</th>
                    <th className="text-left px-3 py-2.5 font-medium">Vendor</th>
                    <th className="text-right px-3 py-2.5 font-medium">Grand Total</th>
                    <th className="text-right px-3 py-2.5 font-medium">Sisa</th>
                    <th className="text-center px-3 py-2.5 font-medium">Umur</th>
                    <th className="text-center px-5 py-2.5 font-medium">Bucket</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border">
                  {(data?.items ?? []).slice(0, 100).map((item) => (
                    <tr key={item.id} className="hover:bg-white/5 transition-colors duration-150">
                      <td className="px-5 py-2.5 font-mono text-xs text-muted-foreground">{item.docNumber}</td>
                      <td className="px-3 py-2.5 text-foreground max-w-xs truncate">{item.supplierName}</td>
                      <td className="px-3 py-2.5 text-right text-muted-foreground">{idrShort(item.grandTotal)}</td>
                      <td className="px-3 py-2.5 text-right font-semibold text-foreground">{idrShort(item.amount)}</td>
                      <td className="px-3 py-2.5 text-center">
                        <Badge variant={item.daysOld > 90 ? "destructive" : item.daysOld > 30 ? "secondary" : "outline"} className="text-xs">
                          {item.daysOld}h
                        </Badge>
                      </td>
                      <td className="px-5 py-2.5 text-center text-xs text-muted-foreground">{item.bucket}</td>
                    </tr>
                  ))}
                  {(data?.items ?? []).length === 0 && (
                    <tr><td colSpan={6} className="px-5 py-8 text-center text-muted-foreground text-sm">Tidak ada hutang</td></tr>
                  )}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

// ── Revenue/Profit View ────────────────────────────────────────────────────
function PLView({ companyId, from, to, mode }: { companyId: number; from: string; to: string; mode: "revenue" | "profit" }) {
  const [data, setData] = useState<{ revenues: PLAccount[]; expenses: PLAccount[]; totalRevenue: number; totalExpense: number; netIncome: number } | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    setLoading(true);
    apiFetch<typeof data>(`/api/accounting/reports/profit-loss?company=${companyId}&startDate=${from}&endDate=${to}`)
      .then(setData).catch(() => setData(null)).finally(() => setLoading(false));
  }, [companyId, from, to]);

  const netIncome = data?.netIncome ?? 0;
  const totalRevenue = data?.totalRevenue ?? 0;
  const totalExpense = data?.totalExpense ?? 0;
  const margin = totalRevenue > 0 ? (netIncome / totalRevenue) * 100 : null;
  const efficiency = totalRevenue > 0 ? (totalExpense / totalRevenue) * 100 : null;
  const topRevAcc = data?.revenues ? [...data.revenues].sort((a, b) => b.amount - a.amount)[0] : null;
  const topExpAcc = data?.expenses ? [...data.expenses].sort((a, b) => b.amount - a.amount)[0] : null;

  return (
    <div className="space-y-5">
      {!loading && data && (
        <div className={`grid ${mode === "profit" ? "grid-cols-2 md:grid-cols-4" : "grid-cols-2 md:grid-cols-3"} gap-3`}>
          <InsightKPI label="Total Pendapatan" value={idrShort(totalRevenue)} sub={`${data.revenues.length} akun`} />
          {mode === "profit" && (
            <InsightKPI label="Net Profit" value={idrShort(netIncome)}
              badge={netIncome >= 0 ? "PROFIT" : "RUGI"}
              badgeColor={netIncome >= 0 ? "green" : "red"} />
          )}
          {margin !== null && mode === "profit" && (
            <InsightKPI label="Margin Bersih" value={`${margin.toFixed(1)}%`}
              sub="(Net Profit / Revenue)"
              badge={margin > 20 ? "SEHAT" : margin > 5 ? "CUKUP" : "TIPIS"}
              badgeColor={margin > 20 ? "green" : margin > 5 ? "amber" : "red"} />
          )}
          {topRevAcc && (
            <InsightKPI label="Revenue Terbesar"
              value={idrShort(topRevAcc.amount)}
              sub={topRevAcc.name} />
          )}
          {mode === "profit" && topExpAcc && efficiency !== null && (
            <InsightKPI label="Rasio Beban"
              value={`${efficiency.toFixed(1)}%`}
              sub={`Beban / Revenue · top: ${topExpAcc.name.slice(0, 20)}`}
              badge={efficiency < 70 ? "EFISIEN" : efficiency < 90 ? "NORMAL" : "TINGGI"}
              badgeColor={efficiency < 70 ? "green" : efficiency < 90 ? "amber" : "red"} />
          )}
        </div>
      )}

      <div className="grid grid-cols-3 gap-4">
        <SummaryCard title="Total Pendapatan" value={idrShort(totalRevenue)} color="text-green-400" />
        {mode === "profit" && <>
          <SummaryCard title="Total Beban" value={idrShort(totalExpense)} color="text-red-400" />
          <SummaryCard title="Net Profit" value={idrShort(netIncome)}
            color={netIncome >= 0 ? "text-green-400" : "text-red-400"} />
        </>}
      </div>

      <Card>
        <CardHeader className="py-3 px-5">
          <CardTitle className="text-sm font-semibold text-green-400">
            Pendapatan — Rp {idr(totalRevenue)}
          </CardTitle>
        </CardHeader>
        <CardContent className="px-3 pb-3">
          {loading ? <div className="h-20 bg-muted/20 rounded animate-pulse" /> :
            (data?.revenues ?? []).length === 0
              ? <p className="text-sm text-muted-foreground py-4 text-center">Tidak ada data pendapatan</p>
              : (data?.revenues ?? []).map((a) => (
                <AccountRow key={a.accountId} accountId={a.accountId} code={a.code} name={a.name}
                  amount={a.amount} type="revenue" startDate={from} endDate={to} companyId={companyId} />
              ))
          }
        </CardContent>
      </Card>

      {mode === "profit" && (
        <Card>
          <CardHeader className="py-3 px-5">
            <CardTitle className="text-sm font-semibold text-red-400">
              Beban — Rp {idr(totalExpense)}
            </CardTitle>
          </CardHeader>
          <CardContent className="px-3 pb-3">
            {loading ? <div className="h-20 bg-muted/20 rounded animate-pulse" /> :
              (data?.expenses ?? []).length === 0
                ? <p className="text-sm text-muted-foreground py-4 text-center">Tidak ada data beban</p>
                : (data?.expenses ?? []).map((a) => (
                  <AccountRow key={a.accountId} accountId={a.accountId} code={a.code} name={a.name}
                    amount={a.amount} type="expense" startDate={from} endDate={to} companyId={companyId} />
                ))
            }
          </CardContent>
        </Card>
      )}

      {mode === "profit" && (
        <div className={`rounded-lg border-2 p-4 flex items-center justify-between ${netIncome >= 0 ? "border-green-800/50 bg-green-950/40" : "border-red-800/50 bg-red-950/40"}`}>
          <div className="flex items-center gap-2">
            {netIncome >= 0
              ? <CheckCircle2 className="h-5 w-5 text-green-400" />
              : <AlertTriangle className="h-5 w-5 text-red-400" />}
            <span className={`font-semibold ${netIncome >= 0 ? "text-green-300" : "text-red-300"}`}>
              Net {netIncome >= 0 ? "Profit" : "Loss"}
            </span>
          </div>
          <span className={`text-xl font-bold ${netIncome >= 0 ? "text-green-400" : "text-red-400"}`}>
            {netIncome < 0 ? "- " : ""}{idrShort(Math.abs(netIncome))}
          </span>
        </div>
      )}
    </div>
  );
}

// ── Tax View ───────────────────────────────────────────────────────────────
function TaxView({ companyId, from, to }: { companyId: number; from: string; to: string }) {
  const period = from.slice(0, 7);
  const [data, setData] = useState<{ data: TaxItem[]; total: number } | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    setLoading(true);
    const p = from.slice(0, 7);
    apiFetch<{ data: TaxItem[]; total: number }>(`/api/accounting/tax-transactions?company=${companyId}&period=${p}&limit=100`)
      .then(setData).catch(() => setData(null)).finally(() => setLoading(false));
  }, [companyId, from]);

  const items = data?.data ?? [];
  const totalOut = items.filter((i) => i.cutType === "out").reduce((s, i) => s + i.taxAmount, 0);
  const totalIn = items.filter((i) => i.cutType === "in").reduce((s, i) => s + i.taxAmount, 0);
  const net = totalOut - totalIn;

  return (
    <div className="space-y-5">
      <div className="grid grid-cols-3 gap-4">
        <SummaryCard title="PPN Keluar (Output)" value={idrShort(totalOut)} color="text-red-400" />
        <SummaryCard title="PPN Masuk (Input)" value={idrShort(totalIn)} color="text-green-400" />
        <SummaryCard title="Net Pajak" value={idrShort(net)} color={net > 0 ? "text-red-400" : "text-green-400"} />
      </div>

      <Card>
        <CardHeader className="py-3 px-5"><CardTitle className="text-sm font-semibold">Transaksi Pajak — {period}</CardTitle></CardHeader>
        <CardContent className="px-0 pb-0">
          {loading ? <div className="h-40 bg-muted/20 m-5 rounded animate-pulse" /> : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="bg-muted/30 text-xs text-muted-foreground border-b border-border">
                  <tr>
                    <th className="text-left px-5 py-2.5 font-medium">Periode</th>
                    <th className="text-left px-3 py-2.5 font-medium">Nama Pajak</th>
                    <th className="text-left px-3 py-2.5 font-medium">Tipe</th>
                    <th className="text-right px-3 py-2.5 font-medium">DPP</th>
                    <th className="text-right px-5 py-2.5 font-medium">Pajak</th>
                    <th className="text-center px-3 py-2.5 font-medium">Status</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border">
                  {items.map((item) => (
                    <tr key={item.id} className="hover:bg-white/5 transition-colors duration-150">
                      <td className="px-5 py-2 text-xs text-muted-foreground">{item.period}</td>
                      <td className="px-3 py-2 text-foreground">{item.taxName}</td>
                      <td className="px-3 py-2">
                        <Badge variant={item.cutType === "out" ? "destructive" : "secondary"} className="text-xs">
                          {item.cutType === "out" ? "Keluar" : "Masuk"}
                        </Badge>
                      </td>
                      <td className="px-3 py-2 text-right text-muted-foreground">{idrShort(item.baseAmount)}</td>
                      <td className="px-5 py-2 text-right font-semibold text-foreground">{idrShort(item.taxAmount)}</td>
                      <td className="px-3 py-2 text-center">
                        <Badge variant={item.status === "paid" ? "outline" : "secondary"} className="text-xs">
                          {item.status}
                        </Badge>
                      </td>
                    </tr>
                  ))}
                  {items.length === 0 && (
                    <tr><td colSpan={6} className="px-5 py-8 text-center text-muted-foreground">Tidak ada transaksi pajak untuk periode ini</td></tr>
                  )}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

// ── Main Page ──────────────────────────────────────────────────────────────
export default function KpiDetailPage() {
  const [, params] = useRoute("/finance/kpi/:type");
  const type = (params?.type ?? "cash") as keyof typeof KPI_META;
  const { activeCompanyId } = useCompany();
  const companyId = activeCompanyId ?? 1;

  const now = new Date();
  const defaultFrom = fmtDate(new Date(now.getFullYear(), now.getMonth(), 1));
  const defaultTo = fmtDate(new Date(now.getFullYear(), now.getMonth() + 1, 0));

  const [from, setFrom] = useState(defaultFrom);
  const [to, setTo] = useState(defaultTo);

  const meta = KPI_META[type] ?? KPI_META["cash"];
  const Icon = meta.icon;

  const applyPreset = (preset: string) => {
    const n = new Date();
    if (preset === "thisMonth") {
      setFrom(fmtDate(new Date(n.getFullYear(), n.getMonth(), 1)));
      setTo(fmtDate(new Date(n.getFullYear(), n.getMonth() + 1, 0)));
    } else if (preset === "lastMonth") {
      setFrom(fmtDate(new Date(n.getFullYear(), n.getMonth() - 1, 1)));
      setTo(fmtDate(new Date(n.getFullYear(), n.getMonth(), 0)));
    } else if (preset === "thisYear") {
      setFrom(`${n.getFullYear()}-01-01`);
      setTo(`${n.getFullYear()}-12-31`);
    } else if (preset === "q1") {
      setFrom(`${n.getFullYear()}-01-01`); setTo(`${n.getFullYear()}-03-31`);
    } else if (preset === "q2") {
      setFrom(`${n.getFullYear()}-04-01`); setTo(`${n.getFullYear()}-06-30`);
    } else if (preset === "q3") {
      setFrom(`${n.getFullYear()}-07-01`); setTo(`${n.getFullYear()}-09-30`);
    } else if (preset === "q4") {
      setFrom(`${n.getFullYear()}-10-01`); setTo(`${n.getFullYear()}-12-31`);
    }
  };

  return (
    <AppShell>
      <div className="space-y-5 p-6 max-w-5xl mx-auto">
        <Button variant="ghost" size="sm" className="-ml-2" onClick={() => window.history.back()}>
          <ArrowLeft className="h-4 w-4 mr-1" />Kembali
        </Button>
        {/* Header */}
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <Link href="/finance/cfo-overview">
              <Button variant="ghost" size="sm" className="gap-1.5 text-muted-foreground h-8">
                <ArrowLeft className="h-3.5 w-3.5" />
                CFO Overview
              </Button>
            </Link>
            <div className="w-px h-5 bg-border" />
            <div className="flex items-center gap-2">
              <div className="p-1.5 rounded-md bg-muted/50">
                <Icon className={`h-4 w-4 ${meta.color}`} />
              </div>
              <div>
                <h1 className="text-lg font-bold text-foreground">{meta.title}</h1>
                <p className="text-xs text-muted-foreground">{meta.desc}</p>
              </div>
            </div>
          </div>
        </div>

        {/* Filter Bar */}
        {["revenue", "profit", "tax"].includes(type) && (
          <Card>
            <CardContent className="p-4">
              <div className="flex flex-wrap items-end gap-4">
                <DateRangeFilter from={from} to={to} onFrom={setFrom} onTo={setTo} />
                <div className="flex items-center gap-1 flex-wrap">
                  {[
                    { k: "thisMonth", l: "Bulan Ini" },
                    { k: "lastMonth", l: "Bulan Lalu" },
                    { k: "thisYear", l: "Tahun Ini" },
                    { k: "q1", l: "Q1" },
                    { k: "q2", l: "Q2" },
                    { k: "q3", l: "Q3" },
                    { k: "q4", l: "Q4" },
                  ].map(({ k, l }) => (
                    <Button key={k} variant="outline" size="sm" onClick={() => applyPreset(k)}
                      className="h-7 text-xs px-2">
                      {l}
                    </Button>
                  ))}
                </div>
              </div>
            </CardContent>
          </Card>
        )}

        {/* KPI Content */}
        {type === "cash"    && <CashView companyId={companyId} from={from} to={to} />}
        {type === "ar"      && <ArView companyId={companyId} />}
        {type === "ap"      && <ApView companyId={companyId} />}
        {type === "revenue" && <PLView companyId={companyId} from={from} to={to} mode="revenue" />}
        {type === "profit"  && <PLView companyId={companyId} from={from} to={to} mode="profit" />}
        {type === "tax"     && <TaxView companyId={companyId} from={from} to={to} />}

        {/* KPI Nav */}
        <div className="border-t border-border pt-4">
          <p className="text-xs text-muted-foreground mb-2">Lihat KPI lainnya:</p>
          <div className="flex flex-wrap gap-2">
            {Object.entries(KPI_META).map(([k, m]) => k !== type && (
              <Link key={k} href={`/finance/kpi/${k}`}>
                <Badge variant="outline" className="cursor-pointer hover:bg-white/10 transition-colors duration-150 gap-1 py-1">
                  <m.icon className={`h-3 w-3 ${m.color}`} />
                  {m.title}
                </Badge>
              </Link>
            ))}
          </div>
        </div>
      </div>
    </AppShell>
  );
}
