import { DatePicker } from "@/components/ui/date-picker";
import { useState } from "react";
import { useRoute, useLocation } from "wouter";
import { useQuery } from "@tanstack/react-query";
import { AppShell } from "@/components/layout/AppShell";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  TrendingUp, TrendingDown, Banknote, Receipt, CreditCard,
  Layers, RefreshCw, Download, ArrowLeft, Building2,
  ArrowUpRight, ArrowDownRight, Wallet, Scale,
} from "lucide-react";

// ─── formatters ──────────────────────────────────────────────────────────────
function fmt(n: number) {
  return new Intl.NumberFormat("id-ID", { style: "currency", currency: "IDR", maximumFractionDigits: 0 }).format(n);
}
function fmtShort(n: number) {
  if (Math.abs(n) >= 1_000_000_000) return `${(n / 1_000_000_000).toFixed(1)}M`;
  if (Math.abs(n) >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}jt`;
  if (Math.abs(n) >= 1_000) return `${(n / 1_000).toFixed(0)}rb`;
  return String(Math.round(n));
}

// ─── types ───────────────────────────────────────────────────────────────────
interface CompanyMeta { companyId: number; companyName: string; companyCode: string; }
interface AccRow { accountId: number; code: string; name: string; amount: number; }

interface GroupDetail {
  id: number; holding_name: string; holding_code: string; description: string | null;
  members: (CompanyMeta & { memberId: number; ownershipPercentage: string | null; consolidationMethod: string | null })[];
}

interface PLData {
  from: string | null; to: string | null;
  companies: CompanyMeta[];
  perCompany: Record<number, { revenues: AccRow[]; expenses: AccRow[]; totalRevenue: number; totalExpense: number; netIncome: number }>;
  consolidated: { revenues: AccRow[]; expenses: AccRow[]; totalRevenue: number; totalExpense: number; netIncome: number };
}

interface BSData {
  asOf: string;
  companies: CompanyMeta[];
  perCompany: Record<number, { assets: AccRow[]; liabilities: AccRow[]; equity: AccRow[]; netIncomeYTD: number; totalAssets: number; totalLiabilities: number; totalEquity: number; totalLiabilitiesAndEquity: number }>;
  consolidated: { assets: AccRow[]; liabilities: AccRow[]; equity: AccRow[]; netIncomeYTD: number; totalAssets: number; totalLiabilities: number; totalEquity: number; totalLiabilitiesAndEquity: number };
}

interface CFRow { opInflow: number; opOutflow: number; opNet: number; invNet: number; finNet: number; cashChange: number; }
interface CFData {
  from: string | null; to: string | null;
  companies: CompanyMeta[];
  perCompany: Record<number, CFRow>;
  consolidated: CFRow;
}

interface SummaryData {
  revenue: number; expense: number; netPL: number; cashBalance: number; receivable: number; payable: number;
}

// ─── palette ─────────────────────────────────────────────────────────────────
const PALETTE = [
  { bg: "bg-indigo-500/10", text: "text-indigo-400", border: "border-indigo-500/30" },
  { bg: "bg-emerald-500/10", text: "text-emerald-400", border: "border-emerald-500/30" },
  { bg: "bg-amber-500/10", text: "text-amber-400", border: "border-amber-500/30" },
  { bg: "bg-rose-500/10", text: "text-rose-400", border: "border-rose-500/30" },
  { bg: "bg-sky-500/10", text: "text-sky-400", border: "border-sky-500/30" },
  { bg: "bg-purple-500/10", text: "text-purple-400", border: "border-purple-500/30" },
];
function palette(idx: number) { return PALETTE[idx % PALETTE.length]!; }

function CodeBadge({ code, idx }: { code: string; idx: number }) {
  const p = palette(idx);
  return (
    <span className={`inline-flex items-center rounded px-1.5 py-0.5 text-xs font-mono font-semibold border ${p.bg} ${p.text} ${p.border}`}>
      {code}
    </span>
  );
}

// ─── fetchers ─────────────────────────────────────────────────────────────────
async function fetchGroup(id: number): Promise<GroupDetail> {
  const r = await fetch(`/api/accounting/holding/groups/${id}`, { credentials: "include" });
  if (!r.ok) throw new Error("Gagal memuat grup");
  return r.json();
}
async function fetchSummary(id: number, from: string, to: string): Promise<SummaryData> {
  const p = new URLSearchParams({ holdingId: String(id), from, to });
  const r = await fetch(`/api/accounting/holding/summary?${p}`, { credentials: "include" });
  if (!r.ok) throw new Error("Gagal memuat summary");
  return r.json();
}
async function fetchPL(id: number, from: string, to: string): Promise<PLData> {
  const p = new URLSearchParams({ from, to });
  const r = await fetch(`/api/accounting/holding/groups/${id}/pl?${p}`, { credentials: "include" });
  if (!r.ok) throw new Error("Gagal memuat P&L");
  return r.json();
}
async function fetchBS(id: number, to: string): Promise<BSData> {
  const p = new URLSearchParams({ to });
  const r = await fetch(`/api/accounting/holding/groups/${id}/balance-sheet?${p}`, { credentials: "include" });
  if (!r.ok) throw new Error("Gagal memuat neraca");
  return r.json();
}
async function fetchCF(id: number, from: string, to: string): Promise<CFData> {
  const p = new URLSearchParams({ from, to });
  const r = await fetch(`/api/accounting/holding/groups/${id}/cashflow?${p}`, { credentials: "include" });
  if (!r.ok) throw new Error("Gagal memuat arus kas");
  return r.json();
}

// ─── sub-components ──────────────────────────────────────────────────────────
type Tab = "ringkasan" | "pl" | "neraca" | "cashflow";

function TabBar({ active, onChange }: { active: Tab; onChange: (t: Tab) => void }) {
  const tabs: { key: Tab; label: string; icon: React.ReactNode }[] = [
    { key: "ringkasan", label: "Ringkasan", icon: <Layers className="h-3.5 w-3.5" /> },
    { key: "pl", label: "Laba Rugi", icon: <TrendingUp className="h-3.5 w-3.5" /> },
    { key: "neraca", label: "Neraca", icon: <Scale className="h-3.5 w-3.5" /> },
    { key: "cashflow", label: "Arus Kas", icon: <Wallet className="h-3.5 w-3.5" /> },
  ];
  return (
    <div className="flex gap-1 rounded-lg border border-border bg-muted/30 p-1 w-fit">
      {tabs.map((t) => (
        <button
          key={t.key}
          onClick={() => onChange(t.key)}
          className={`flex items-center gap-1.5 rounded-md px-3 py-1.5 text-sm font-medium transition-colors ${
            active === t.key
              ? "bg-background text-foreground shadow-sm"
              : "text-muted-foreground hover:text-foreground"
          }`}
        >
          {t.icon}{t.label}
        </button>
      ))}
    </div>
  );
}

// ── Ringkasan Tab ─────────────────────────────────────────────────────────────
function RingkasanTab({ groupId, from, to, members }: { groupId: number; from: string; to: string; members: CompanyMeta[] }) {
  const { data: sum, isLoading } = useQuery({
    queryKey: ["hg-summary", groupId, from, to],
    queryFn: () => fetchSummary(groupId, from, to),
  });

  const kpis = [
    { label: "Total Revenue", value: sum?.revenue, icon: TrendingUp, color: "text-emerald-400", bg: "bg-emerald-500/10" },
    { label: "Total Expense", value: sum?.expense, icon: TrendingDown, color: "text-rose-400", bg: "bg-rose-500/10" },
    {
      label: "Net Profit / Loss",
      value: sum?.netPL,
      icon: Banknote,
      color: (sum?.netPL ?? 0) >= 0 ? "text-emerald-400" : "text-rose-400",
      bg: (sum?.netPL ?? 0) >= 0 ? "bg-emerald-500/10" : "bg-rose-500/10",
    },
    { label: "Kas & Bank", value: sum?.cashBalance, icon: Banknote, color: "text-sky-400", bg: "bg-sky-500/10" },
    { label: "Piutang Usaha", value: sum?.receivable, icon: Receipt, color: "text-amber-400", bg: "bg-amber-500/10" },
    { label: "Utang Usaha", value: sum?.payable, icon: CreditCard, color: "text-orange-400", bg: "bg-orange-500/10" },
  ];

  return (
    <div className="space-y-5">
      <div className="grid gap-4 grid-cols-2 lg:grid-cols-3">
        {kpis.map((k) => {
          const Icon = k.icon;
          return (
            <Card key={k.label} className="border-border">
              <CardContent className="p-4 flex items-center gap-3">
                <div className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-xl ${k.bg}`}>
                  <Icon className={`h-5 w-5 ${k.color}`} />
                </div>
                <div className="min-w-0">
                  <p className="text-xs text-muted-foreground">{k.label}</p>
                  {isLoading
                    ? <div className="h-5 w-28 rounded bg-muted animate-pulse mt-1" />
                    : <p className={`text-base font-bold truncate ${k.color}`}>{k.value !== undefined ? fmt(k.value) : "—"}</p>
                  }
                </div>
              </CardContent>
            </Card>
          );
        })}
      </div>

      {/* Members list */}
      <Card className="border-border">
        <CardHeader className="pb-3">
          <CardTitle className="text-base flex items-center gap-2">
            <Building2 className="h-4 w-4 text-muted-foreground" />
            Entitas Anggota Grup
          </CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          <div className="divide-y divide-border">
            {members.map((m, idx) => (
              <div key={m.companyId} className="flex items-center gap-3 px-4 py-3">
                <CodeBadge code={m.companyCode} idx={idx} />
                <span className="font-medium text-sm">{m.companyName}</span>
              </div>
            ))}
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

// ── P&L Tab ───────────────────────────────────────────────────────────────────
function PLTab({ groupId, from, to }: { groupId: number; from: string; to: string }) {
  const { data: pl, isLoading } = useQuery({
    queryKey: ["hg-pl", groupId, from, to],
    queryFn: () => fetchPL(groupId, from, to),
  });

  if (isLoading) return <SkeletonTable rows={8} cols={3} />;
  if (!pl) return null;

  const { companies, perCompany, consolidated } = pl;

  return (
    <div className="space-y-5">
      {/* Consolidated totals */}
      <div className="grid gap-4 grid-cols-3">
        <Card className="border-border">
          <CardContent className="p-4">
            <p className="text-xs text-muted-foreground">Pendapatan Konsolidasi</p>
            <p className="text-lg font-bold text-emerald-400 mt-1">{fmt(consolidated.totalRevenue)}</p>
          </CardContent>
        </Card>
        <Card className="border-border">
          <CardContent className="p-4">
            <p className="text-xs text-muted-foreground">Beban Konsolidasi</p>
            <p className="text-lg font-bold text-rose-400 mt-1">{fmt(consolidated.totalExpense)}</p>
          </CardContent>
        </Card>
        <Card className="border-border">
          <CardContent className="p-4">
            <p className="text-xs text-muted-foreground">Laba Bersih Konsolidasi</p>
            <p className={`text-lg font-bold mt-1 ${consolidated.netIncome >= 0 ? "text-emerald-400" : "text-rose-400"}`}>
              {fmt(consolidated.netIncome)}
            </p>
          </CardContent>
        </Card>
      </div>

      {/* Comparison table */}
      <Card className="border-border">
        <CardHeader className="pb-3">
          <CardTitle className="text-base">Perbandingan Laba Rugi per Perusahaan</CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border">
                  <th className="text-left px-4 py-3 text-xs font-medium text-muted-foreground">Perusahaan</th>
                  <th className="text-right px-4 py-3 text-xs font-medium text-muted-foreground">Pendapatan</th>
                  <th className="text-right px-4 py-3 text-xs font-medium text-muted-foreground">Beban</th>
                  <th className="text-right px-4 py-3 text-xs font-medium text-muted-foreground">Laba Bersih</th>
                  <th className="text-right px-4 py-3 text-xs font-medium text-muted-foreground">Margin</th>
                </tr>
              </thead>
              <tbody>
                {companies.map((c, idx) => {
                  const d = perCompany[c.companyId];
                  if (!d) return null;
                  const margin = d.totalRevenue > 0 ? (d.netIncome / d.totalRevenue) * 100 : 0;
                  return (
                    <tr key={c.companyId} className="border-b border-border last:border-0 hover:bg-muted/30">
                      <td className="px-4 py-3">
                        <div className="flex items-center gap-2">
                          <CodeBadge code={c.companyCode} idx={idx} />
                          <span className="font-medium">{c.companyName}</span>
                        </div>
                      </td>
                      <td className="px-4 py-3 text-right font-mono text-emerald-400">{fmt(d.totalRevenue)}</td>
                      <td className="px-4 py-3 text-right font-mono text-rose-400">{fmt(d.totalExpense)}</td>
                      <td className={`px-4 py-3 text-right font-mono font-semibold ${d.netIncome >= 0 ? "text-emerald-400" : "text-rose-400"}`}>
                        {fmt(d.netIncome)}
                      </td>
                      <td className="px-4 py-3 text-right text-xs text-muted-foreground font-mono">
                        {d.totalRevenue > 0 ? `${margin.toFixed(1)}%` : "—"}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
              <tfoot>
                <tr className="border-t-2 border-border bg-muted/40">
                  <td className="px-4 py-3 font-semibold text-xs uppercase tracking-wide text-muted-foreground">Total Konsolidasi</td>
                  <td className="px-4 py-3 text-right font-mono font-bold text-emerald-400">{fmt(consolidated.totalRevenue)}</td>
                  <td className="px-4 py-3 text-right font-mono font-bold text-rose-400">{fmt(consolidated.totalExpense)}</td>
                  <td className={`px-4 py-3 text-right font-mono font-bold ${consolidated.netIncome >= 0 ? "text-emerald-400" : "text-rose-400"}`}>
                    {fmt(consolidated.netIncome)}
                  </td>
                  <td className="px-4 py-3 text-right text-xs text-muted-foreground font-mono">
                    {consolidated.totalRevenue > 0 ? `${((consolidated.netIncome / consolidated.totalRevenue) * 100).toFixed(1)}%` : "—"}
                  </td>
                </tr>
              </tfoot>
            </table>
          </div>
        </CardContent>
      </Card>

      {/* Detail per company */}
      <div className="grid gap-5 md:grid-cols-2">
        {companies.map((c, idx) => {
          const d = perCompany[c.companyId];
          if (!d) return null;
          return (
            <Card key={c.companyId} className="border-border">
              <CardHeader className="pb-2">
                <div className="flex items-center gap-2">
                  <CodeBadge code={c.companyCode} idx={idx} />
                  <CardTitle className="text-sm font-semibold">{c.companyName}</CardTitle>
                </div>
              </CardHeader>
              <CardContent className="space-y-3">
                <div>
                  <p className="text-xs font-semibold text-emerald-400 uppercase tracking-wide mb-1.5">Pendapatan</p>
                  {d.revenues.length === 0
                    ? <p className="text-xs text-muted-foreground italic">Tidak ada data</p>
                    : d.revenues.map((r) => (
                      <div key={r.accountId} className="flex justify-between text-xs py-0.5">
                        <span className="text-muted-foreground truncate mr-2">{r.code} {r.name}</span>
                        <span className="font-mono text-emerald-400 shrink-0">{fmtShort(r.amount)}</span>
                      </div>
                    ))
                  }
                  <div className="flex justify-between text-xs font-semibold pt-1.5 border-t border-border mt-1">
                    <span>Total Pendapatan</span>
                    <span className="font-mono text-emerald-400">{fmt(d.totalRevenue)}</span>
                  </div>
                </div>
                <div>
                  <p className="text-xs font-semibold text-rose-400 uppercase tracking-wide mb-1.5">Beban</p>
                  {d.expenses.length === 0
                    ? <p className="text-xs text-muted-foreground italic">Tidak ada data</p>
                    : d.expenses.map((r) => (
                      <div key={r.accountId} className="flex justify-between text-xs py-0.5">
                        <span className="text-muted-foreground truncate mr-2">{r.code} {r.name}</span>
                        <span className="font-mono text-rose-400 shrink-0">{fmtShort(r.amount)}</span>
                      </div>
                    ))
                  }
                  <div className="flex justify-between text-xs font-semibold pt-1.5 border-t border-border mt-1">
                    <span>Total Beban</span>
                    <span className="font-mono text-rose-400">{fmt(d.totalExpense)}</span>
                  </div>
                </div>
                <div className={`flex justify-between text-sm font-bold pt-2 border-t-2 border-border ${d.netIncome >= 0 ? "text-emerald-400" : "text-rose-400"}`}>
                  <span>Laba Bersih</span>
                  <span className="font-mono">{fmt(d.netIncome)}</span>
                </div>
              </CardContent>
            </Card>
          );
        })}
      </div>
    </div>
  );
}

// ── Neraca Tab ────────────────────────────────────────────────────────────────
function NeracaTab({ groupId, to }: { groupId: number; to: string }) {
  const { data: bs, isLoading } = useQuery({
    queryKey: ["hg-bs", groupId, to],
    queryFn: () => fetchBS(groupId, to),
  });

  if (isLoading) return <SkeletonTable rows={10} cols={2} />;
  if (!bs) return null;
  const { companies, perCompany, consolidated } = bs;

  return (
    <div className="space-y-5">
      {/* Consolidated summary */}
      <div className="grid gap-4 grid-cols-3">
        <Card className="border-border">
          <CardContent className="p-4">
            <p className="text-xs text-muted-foreground">Total Aset</p>
            <p className="text-lg font-bold text-sky-400 mt-1">{fmt(consolidated.totalAssets)}</p>
          </CardContent>
        </Card>
        <Card className="border-border">
          <CardContent className="p-4">
            <p className="text-xs text-muted-foreground">Total Liabilitas</p>
            <p className="text-lg font-bold text-orange-400 mt-1">{fmt(consolidated.totalLiabilities)}</p>
          </CardContent>
        </Card>
        <Card className="border-border">
          <CardContent className="p-4">
            <p className="text-xs text-muted-foreground">Total Ekuitas</p>
            <p className={`text-lg font-bold mt-1 ${consolidated.totalEquity >= 0 ? "text-emerald-400" : "text-rose-400"}`}>
              {fmt(consolidated.totalEquity)}
            </p>
          </CardContent>
        </Card>
      </div>

      {/* Balance check */}
      <div className={`flex items-center gap-2 rounded-lg border px-4 py-2.5 text-sm ${
        Math.abs(consolidated.totalAssets - consolidated.totalLiabilitiesAndEquity) < 1
          ? "border-emerald-500/30 bg-emerald-500/10 text-emerald-400"
          : "border-amber-500/30 bg-amber-500/10 text-amber-400"
      }`}>
        <Scale className="h-4 w-4 shrink-0" />
        <span>
          Neraca {Math.abs(consolidated.totalAssets - consolidated.totalLiabilitiesAndEquity) < 1 ? "seimbang ✓" : "tidak seimbang — selisih: " + fmt(consolidated.totalAssets - consolidated.totalLiabilitiesAndEquity)}
        </span>
        <span className="ml-auto text-xs font-mono">
          Aset {fmt(consolidated.totalAssets)} = Liabilitas + Ekuitas {fmt(consolidated.totalLiabilitiesAndEquity)}
        </span>
      </div>

      {/* Per-company comparison */}
      <Card className="border-border">
        <CardHeader className="pb-3">
          <CardTitle className="text-base">Perbandingan Neraca per Perusahaan</CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border">
                  <th className="text-left px-4 py-3 text-xs font-medium text-muted-foreground">Perusahaan</th>
                  <th className="text-right px-4 py-3 text-xs font-medium text-muted-foreground">Total Aset</th>
                  <th className="text-right px-4 py-3 text-xs font-medium text-muted-foreground">Total Liabilitas</th>
                  <th className="text-right px-4 py-3 text-xs font-medium text-muted-foreground">Laba YTD</th>
                  <th className="text-right px-4 py-3 text-xs font-medium text-muted-foreground">Total Ekuitas</th>
                </tr>
              </thead>
              <tbody>
                {companies.map((c, idx) => {
                  const d = perCompany[c.companyId];
                  if (!d) return null;
                  return (
                    <tr key={c.companyId} className="border-b border-border last:border-0 hover:bg-muted/30">
                      <td className="px-4 py-3">
                        <div className="flex items-center gap-2">
                          <CodeBadge code={c.companyCode} idx={idx} />
                          <span className="font-medium">{c.companyName}</span>
                        </div>
                      </td>
                      <td className="px-4 py-3 text-right font-mono text-sky-400">{fmt(d.totalAssets)}</td>
                      <td className="px-4 py-3 text-right font-mono text-orange-400">{fmt(d.totalLiabilities)}</td>
                      <td className={`px-4 py-3 text-right font-mono ${d.netIncomeYTD >= 0 ? "text-emerald-400" : "text-rose-400"}`}>{fmt(d.netIncomeYTD)}</td>
                      <td className={`px-4 py-3 text-right font-mono font-semibold ${d.totalEquity >= 0 ? "text-emerald-400" : "text-rose-400"}`}>{fmt(d.totalEquity)}</td>
                    </tr>
                  );
                })}
              </tbody>
              <tfoot>
                <tr className="border-t-2 border-border bg-muted/40">
                  <td className="px-4 py-3 font-semibold text-xs uppercase tracking-wide text-muted-foreground">Konsolidasi</td>
                  <td className="px-4 py-3 text-right font-mono font-bold text-sky-400">{fmt(consolidated.totalAssets)}</td>
                  <td className="px-4 py-3 text-right font-mono font-bold text-orange-400">{fmt(consolidated.totalLiabilities)}</td>
                  <td className={`px-4 py-3 text-right font-mono font-bold ${consolidated.netIncomeYTD >= 0 ? "text-emerald-400" : "text-rose-400"}`}>{fmt(consolidated.netIncomeYTD)}</td>
                  <td className={`px-4 py-3 text-right font-mono font-bold ${consolidated.totalEquity >= 0 ? "text-emerald-400" : "text-rose-400"}`}>{fmt(consolidated.totalEquity)}</td>
                </tr>
              </tfoot>
            </table>
          </div>
        </CardContent>
      </Card>

      {/* Detail per company */}
      <div className="grid gap-5 md:grid-cols-2">
        {companies.map((c, idx) => {
          const d = perCompany[c.companyId];
          if (!d) return null;
          return (
            <Card key={c.companyId} className="border-border">
              <CardHeader className="pb-2">
                <div className="flex items-center gap-2">
                  <CodeBadge code={c.companyCode} idx={idx} />
                  <CardTitle className="text-sm font-semibold">{c.companyName}</CardTitle>
                </div>
              </CardHeader>
              <CardContent className="space-y-3 text-xs">
                <SectionAccounts label="Aset" color="text-sky-400" accounts={d.assets} total={d.totalAssets} />
                <SectionAccounts label="Liabilitas" color="text-orange-400" accounts={d.liabilities} total={d.totalLiabilities} />
                <SectionAccounts label="Ekuitas" color="text-emerald-400" accounts={[
                  ...d.equity,
                  { accountId: -1, code: "", name: "Laba Bersih YTD", amount: d.netIncomeYTD },
                ]} total={d.totalEquity} />
              </CardContent>
            </Card>
          );
        })}
      </div>
    </div>
  );
}

function SectionAccounts({ label, color, accounts, total }: { label: string; color: string; accounts: AccRow[]; total: number }) {
  return (
    <div>
      <p className={`text-xs font-semibold uppercase tracking-wide mb-1.5 ${color}`}>{label}</p>
      {accounts.length === 0
        ? <p className="text-xs text-muted-foreground italic">Tidak ada data</p>
        : accounts.map((a) => (
          <div key={a.accountId} className="flex justify-between py-0.5">
            <span className="text-muted-foreground truncate mr-2">{a.code ? `${a.code} ` : ""}{a.name}</span>
            <span className={`font-mono shrink-0 ${color}`}>{fmtShort(a.amount)}</span>
          </div>
        ))
      }
      <div className={`flex justify-between font-semibold pt-1.5 border-t border-border mt-1 ${color}`}>
        <span>Total {label}</span>
        <span className="font-mono">{fmt(total)}</span>
      </div>
    </div>
  );
}

// ── Cashflow Tab ──────────────────────────────────────────────────────────────
function CashflowTab({ groupId, from, to }: { groupId: number; from: string; to: string }) {
  const { data: cf, isLoading } = useQuery({
    queryKey: ["hg-cf", groupId, from, to],
    queryFn: () => fetchCF(groupId, from, to),
  });

  if (isLoading) return <SkeletonTable rows={6} cols={4} />;
  if (!cf) return null;
  const { companies, perCompany, consolidated } = cf;

  const cfKpis = [
    { label: "Arus Operasi (Net)", value: consolidated.opNet, icon: TrendingUp },
    { label: "Arus Investasi", value: consolidated.invNet, icon: ArrowUpRight },
    { label: "Arus Pendanaan", value: consolidated.finNet, icon: ArrowDownRight },
    { label: "Perubahan Kas Bersih", value: consolidated.cashChange, icon: Wallet },
  ];

  return (
    <div className="space-y-5">
      {/* KPI cards */}
      <div className="grid gap-4 grid-cols-2 lg:grid-cols-4">
        {cfKpis.map((k) => {
          const Icon = k.icon;
          const pos = k.value >= 0;
          return (
            <Card key={k.label} className="border-border">
              <CardContent className="p-4">
                <div className="flex items-center gap-2 mb-2">
                  <div className={`flex h-8 w-8 items-center justify-center rounded-lg ${pos ? "bg-emerald-500/10" : "bg-rose-500/10"}`}>
                    <Icon className={`h-4 w-4 ${pos ? "text-emerald-400" : "text-rose-400"}`} />
                  </div>
                  <p className="text-xs text-muted-foreground leading-tight">{k.label}</p>
                </div>
                <p className={`text-base font-bold ${pos ? "text-emerald-400" : "text-rose-400"}`}>{fmt(k.value)}</p>
              </CardContent>
            </Card>
          );
        })}
      </div>

      {/* Comparison table */}
      <Card className="border-border">
        <CardHeader className="pb-3">
          <CardTitle className="text-base">Perbandingan Arus Kas per Perusahaan</CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border">
                  <th className="text-left px-4 py-3 text-xs font-medium text-muted-foreground">Perusahaan</th>
                  <th className="text-right px-4 py-3 text-xs font-medium text-muted-foreground">Penerimaan Operasi</th>
                  <th className="text-right px-4 py-3 text-xs font-medium text-muted-foreground">Pengeluaran Operasi</th>
                  <th className="text-right px-4 py-3 text-xs font-medium text-muted-foreground">Net Operasi</th>
                  <th className="text-right px-4 py-3 text-xs font-medium text-muted-foreground">Investasi</th>
                  <th className="text-right px-4 py-3 text-xs font-medium text-muted-foreground">Pendanaan</th>
                  <th className="text-right px-4 py-3 text-xs font-medium text-muted-foreground">Δ Kas</th>
                </tr>
              </thead>
              <tbody>
                {companies.map((c, idx) => {
                  const d = perCompany[c.companyId];
                  if (!d) return null;
                  return (
                    <tr key={c.companyId} className="border-b border-border last:border-0 hover:bg-muted/30">
                      <td className="px-4 py-3">
                        <div className="flex items-center gap-2">
                          <CodeBadge code={c.companyCode} idx={idx} />
                          <span className="font-medium">{c.companyName}</span>
                        </div>
                      </td>
                      <td className="px-4 py-3 text-right font-mono text-emerald-400">{fmt(d.opInflow)}</td>
                      <td className="px-4 py-3 text-right font-mono text-rose-400">{fmt(d.opOutflow)}</td>
                      <td className={`px-4 py-3 text-right font-mono font-semibold ${d.opNet >= 0 ? "text-emerald-400" : "text-rose-400"}`}>{fmt(d.opNet)}</td>
                      <td className={`px-4 py-3 text-right font-mono ${d.invNet >= 0 ? "text-sky-400" : "text-amber-400"}`}>{fmt(d.invNet)}</td>
                      <td className={`px-4 py-3 text-right font-mono ${d.finNet >= 0 ? "text-purple-400" : "text-orange-400"}`}>{fmt(d.finNet)}</td>
                      <td className={`px-4 py-3 text-right font-mono font-semibold ${d.cashChange >= 0 ? "text-emerald-400" : "text-rose-400"}`}>{fmt(d.cashChange)}</td>
                    </tr>
                  );
                })}
              </tbody>
              <tfoot>
                <tr className="border-t-2 border-border bg-muted/40">
                  <td className="px-4 py-3 font-semibold text-xs uppercase tracking-wide text-muted-foreground">Konsolidasi</td>
                  <td className="px-4 py-3 text-right font-mono font-bold text-emerald-400">{fmt(consolidated.opInflow)}</td>
                  <td className="px-4 py-3 text-right font-mono font-bold text-rose-400">{fmt(consolidated.opOutflow)}</td>
                  <td className={`px-4 py-3 text-right font-mono font-bold ${consolidated.opNet >= 0 ? "text-emerald-400" : "text-rose-400"}`}>{fmt(consolidated.opNet)}</td>
                  <td className={`px-4 py-3 text-right font-mono font-bold ${consolidated.invNet >= 0 ? "text-sky-400" : "text-amber-400"}`}>{fmt(consolidated.invNet)}</td>
                  <td className={`px-4 py-3 text-right font-mono font-bold ${consolidated.finNet >= 0 ? "text-purple-400" : "text-orange-400"}`}>{fmt(consolidated.finNet)}</td>
                  <td className={`px-4 py-3 text-right font-mono font-bold ${consolidated.cashChange >= 0 ? "text-emerald-400" : "text-rose-400"}`}>{fmt(consolidated.cashChange)}</td>
                </tr>
              </tfoot>
            </table>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

// ── Skeleton ──────────────────────────────────────────────────────────────────
function SkeletonTable({ rows, cols }: { rows: number; cols: number }) {
  return (
    <Card className="border-border">
      <CardContent className="p-0">
        <table className="w-full">
          <tbody>
            {Array.from({ length: rows }).map((_, i) => (
              <tr key={i} className="border-b border-border">
                {Array.from({ length: cols }).map((_, j) => (
                  <td key={j} className="px-4 py-3">
                    <div className="h-4 rounded bg-muted animate-pulse" style={{ width: j === 0 ? "60%" : "80%" }} />
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </CardContent>
    </Card>
  );
}

// ─── Main Page ────────────────────────────────────────────────────────────────
export default function HoldingGroupDetailPage() {
  const [, params] = useRoute("/holding/groups/:id");
  const [, navigate] = useLocation();
  const groupId = Number(params?.id ?? 1);

  const currentYear = new Date().getFullYear();
  const [from, setFrom] = useState(`${currentYear}-01-01`);
  const [to, setTo] = useState(`${currentYear}-12-31`);
  const [appliedFrom, setAppliedFrom] = useState(from);
  const [appliedTo, setAppliedTo] = useState(to);
  const [activeTab, setActiveTab] = useState<Tab>("ringkasan");

  const { data: group, isLoading: loadingGroup } = useQuery({
    queryKey: ["hg-detail", groupId],
    queryFn: () => fetchGroup(groupId),
    enabled: !isNaN(groupId),
  });

  function applyFilter() {
    setAppliedFrom(from);
    setAppliedTo(to);
  }

  const members: CompanyMeta[] = (group?.members ?? []).map((m) => ({
    companyId: m.companyId,
    companyName: m.companyName,
    companyCode: m.companyCode,
  }));

  return (
    <AppShell>
      <div className="max-w-7xl mx-auto space-y-6">
        {/* Header */}
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
          <div className="flex items-center gap-4">
            <Button variant="ghost" size="icon" className="h-9 w-9 shrink-0" onClick={() => navigate("/holding")}>
              <ArrowLeft className="h-4 w-4" />
            </Button>
            <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-indigo-600/20 border border-indigo-500/30 shrink-0">
              <Layers className="h-6 w-6 text-indigo-400" />
            </div>
            <div>
              {loadingGroup ? (
                <div className="space-y-1.5">
                  <div className="h-6 w-48 rounded bg-muted animate-pulse" />
                  <div className="h-4 w-32 rounded bg-muted animate-pulse" />
                </div>
              ) : (
                <>
                  <div className="flex items-center gap-2 flex-wrap">
                    <h1 className="text-2xl font-bold tracking-tight">
                      {group?.holding_name ?? "Detail Grup Holding"}
                    </h1>
                    <Badge className="bg-indigo-600/20 text-indigo-300 border border-indigo-500/40 text-xs font-mono">
                      {group?.holding_code}
                    </Badge>
                    <Badge variant="outline" className="text-xs text-muted-foreground">
                      {members.length} entitas
                    </Badge>
                  </div>
                  <p className="text-muted-foreground text-sm mt-0.5">
                    {group?.description ?? "Laporan keuangan konsolidasi per grup holding"}
                  </p>
                </>
              )}
            </div>
          </div>
          <Button variant="outline" size="sm" onClick={() => {
            setAppliedFrom(from);
            setAppliedTo(to);
          }}>
            <RefreshCw className="h-3.5 w-3.5 mr-1.5" />
            Refresh
          </Button>
        </div>

        {/* Filter */}
        <div className="flex flex-wrap items-end gap-3 rounded-lg border border-border bg-card p-4">
          <div className="space-y-1">
            <Label className="text-xs text-muted-foreground">Dari Tanggal</Label>
            <DatePicker value={from} onChange={(v) => setFrom(v)} className="h-8 text-sm w-40" />
          </div>
          <div className="space-y-1">
            <Label className="text-xs text-muted-foreground">Sampai Tanggal</Label>
            <DatePicker value={to} onChange={(v) => setTo(v)} className="h-8 text-sm w-40" />
          </div>
          <Button size="sm" onClick={applyFilter} className="h-8">Terapkan Filter</Button>
          <div className="ml-auto flex items-center gap-1.5 text-xs text-muted-foreground">
            <span>Periode:</span>
            <span className="font-mono font-medium text-foreground">{appliedFrom}</span>
            <span>s/d</span>
            <span className="font-mono font-medium text-foreground">{appliedTo}</span>
          </div>
        </div>

        {/* Tabs */}
        <TabBar active={activeTab} onChange={setActiveTab} />

        {/* Tab content */}
        {activeTab === "ringkasan" && (
          <RingkasanTab groupId={groupId} from={appliedFrom} to={appliedTo} members={members} />
        )}
        {activeTab === "pl" && (
          <PLTab groupId={groupId} from={appliedFrom} to={appliedTo} />
        )}
        {activeTab === "neraca" && (
          <NeracaTab groupId={groupId} to={appliedTo} />
        )}
        {activeTab === "cashflow" && (
          <CashflowTab groupId={groupId} from={appliedFrom} to={appliedTo} />
        )}

        <p className="text-xs text-muted-foreground text-center pb-2">
          Data konsolidasi dari {members.length} entitas anggota grup · Hanya transaksi berstatus "Diposting" yang dihitung
        </p>
      </div>
    </AppShell>
  );
}
