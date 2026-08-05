import { useState } from "react";
import { Link } from "wouter";
import { AppShell } from "@/components/layout/AppShell";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useCompany } from "@/contexts/CompanyContext";
import { useToast } from "@/hooks/use-toast";

async function apiFetch(url: string, opts?: RequestInit) {
  const r = await fetch(url, { credentials: "include", ...opts });
  const d = await r.json();
  if (!r.ok) throw new Error(d.message ?? "Terjadi kesalahan.");
  return d;
}
import {
  ArrowLeft, AlertTriangle, CheckCircle2, Clock, Bell, BellOff,
  TrendingDown, HandCoins, Landmark, Building2, Package,
  DownloadCloud, RefreshCw, ChevronRight, ShieldAlert,
} from "lucide-react";
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, PieChart, Pie, Cell, Legend,
  ResponsiveContainer,
} from "recharts";

const idr = (n: number) =>
  new Intl.NumberFormat("id-ID", { style: "currency", currency: "IDR", maximumFractionDigits: 0 }).format(n);

const idrShort = (n: number) => {
  if (n >= 1_000_000_000) return `Rp ${(n / 1_000_000_000).toFixed(1)}M`;
  if (n >= 1_000_000) return `Rp ${(n / 1_000_000).toFixed(0)}jt`;
  if (n >= 1_000) return `Rp ${(n / 1_000).toFixed(0)}rb`;
  return `Rp ${n}`;
};

const CHART_COLORS = [
  "hsl(var(--chart-1))", "hsl(var(--chart-2))", "hsl(var(--chart-3))",
  "hsl(var(--chart-4))", "hsl(var(--chart-5))",
];

const SEV_COLORS: Record<string, string> = {
  danger:  "border-red-600 bg-red-900/30 text-red-300",
  warning: "border-amber-600 bg-amber-900/30 text-amber-300",
  info:    "border-sky-600 bg-sky-900/30 text-sky-300",
};

const SEV_ICONS: Record<string, React.ReactNode> = {
  danger:  <ShieldAlert size={14} className="text-red-400" />,
  warning: <AlertTriangle size={14} className="text-amber-400" />,
  info:    <Bell size={14} className="text-sky-400" />,
};

function StatCard({
  label, value, sub, icon, color = "text-foreground",
}: { label: string; value: string; sub?: string; icon: React.ReactNode; color?: string }) {
  return (
    <Card>
      <CardContent className="p-4 flex gap-3 items-start">
        <div className="mt-0.5 shrink-0">{icon}</div>
        <div className="flex-1 min-w-0">
          <p className="text-xs text-muted-foreground">{label}</p>
          <p className={`text-xl font-bold truncate ${color}`}>{value}</p>
          {sub && <p className="text-xs text-muted-foreground">{sub}</p>}
        </div>
      </CardContent>
    </Card>
  );
}

export default function ExpenseDashboardPage() {
  const { activeCompanyId } = useCompany();
  const { toast } = useToast();
  const qc = useQueryClient();
  const [year] = useState(new Date().getFullYear());

  const companyParam = activeCompanyId ? `?companyId=${activeCompanyId}` : "";

  const { data: dash, isLoading, refetch } = useQuery({
    queryKey: ["expense-dashboard", activeCompanyId],
    queryFn: () => apiFetch(`/api/expense-dashboard${companyParam}`),
    staleTime: 2 * 60 * 1000,
  });

  const { data: reminders = [] } = useQuery({
    queryKey: ["expense-reminders", activeCompanyId],
    queryFn: () => apiFetch(`/api/expense-dashboard/reminders${companyParam}`),
    staleTime: 60 * 1000,
  });

  const dismissMut = useMutation({
    mutationFn: (id: number) => apiFetch(`/api/expense-dashboard/reminders/${id}/dismiss`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({}) }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["expense-reminders"] });
      toast({ title: "Reminder diabaikan." });
    },
  });

  const handleSptExport = () => {
    window.open(`/api/expense-dashboard/spt-export?year=${year}${activeCompanyId ? `&companyId=${activeCompanyId}` : ""}`, "_blank");
  };

  // Expense by category grouped
  const catData = (() => {
    if (!dash?.expenseByCategory) return [];
    const map = new Map<string, number>();
    for (const row of dash.expenseByCategory) {
      if (!["draft", "rejected"].includes(row.status)) {
        map.set(row.category, (map.get(row.category) ?? 0) + row.total);
      }
    }
    return Array.from(map.entries())
      .sort((a, b) => b[1] - a[1])
      .slice(0, 8)
      .map(([name, total]) => ({ name, total }));
  })();

  const approvalStats = dash?.approvalStats ?? {};
  const reminderStats = dash?.reminders ?? {};

  const totalKasbon   = dash?.cashAdvances.kasbon.remaining ?? 0;
  const totalTalangan = dash?.cashAdvances.talangan.remaining ?? 0;
  const totalBankLoan = dash?.bankLoans.bank.outstanding ?? 0;
  const totalLeasing  = dash?.bankLoans.leasing.outstanding ?? 0;
  const totalInst     = dash?.vendorInstallments.remaining ?? 0;

  const dangerCount  = reminderStats.danger  ?? 0;
  const warningCount = reminderStats.warning ?? 0;

  return (
    <AppShell>
      <div className="max-w-7xl mx-auto px-4 py-6 space-y-6">
        <Button variant="ghost" size="sm" className="-ml-2" onClick={() => window.history.back()}>
          <ArrowLeft className="h-4 w-4 mr-1" />Kembali
        </Button>
        {/* Header */}
        <div className="flex items-center justify-between gap-4 flex-wrap">
          <div className="flex items-center gap-3">
            <Link href="/expense"><Button variant="ghost" size="icon"><ArrowLeft size={16} /></Button></Link>
            <div>
              <h1 className="text-2xl font-bold">Dashboard Expense</h1>
              <p className="text-sm text-muted-foreground">Monitoring kewajiban keuangan & pengeluaran — {year}</p>
            </div>
          </div>
          <div className="flex gap-2">
            <Button variant="outline" size="sm" onClick={() => refetch()}><RefreshCw size={14} className="mr-1" />Refresh</Button>
            <Button variant="outline" size="sm" onClick={handleSptExport}><DownloadCloud size={14} className="mr-1" />Export SPT CSV</Button>
          </div>
        </div>

        {/* Reminder Alerts */}
        {(dangerCount > 0 || warningCount > 0) && (
          <Card className="border-red-600/40 bg-red-950/20">
            <CardHeader className="py-3 px-4">
              <CardTitle className="text-sm flex items-center gap-2 text-red-400">
                <ShieldAlert size={16} />
                {dangerCount + warningCount} Reminder Aktif
                {dangerCount > 0 && <Badge className="bg-red-700 text-red-100 text-xs">{dangerCount} Kritis</Badge>}
                {warningCount > 0 && <Badge className="bg-amber-700 text-amber-100 text-xs">{warningCount} Peringatan</Badge>}
              </CardTitle>
            </CardHeader>
            <CardContent className="px-4 pb-4 space-y-2">
              {(reminders as any[]).slice(0, 5).map((r: any) => (
                <div key={r.id} className={`flex items-start gap-3 rounded-lg border p-3 text-xs ${SEV_COLORS[r.severity] ?? SEV_COLORS.info}`}>
                  <div className="mt-0.5 shrink-0">{SEV_ICONS[r.severity] ?? SEV_ICONS.info}</div>
                  <div className="flex-1 min-w-0">
                    <p className="font-medium">{r.ref_number ?? `#${r.ref_id}`} — {r.party_name ?? ""}</p>
                    <p className="opacity-80 whitespace-pre-line line-clamp-2">{r.message?.split("\n").slice(0, 2).join(" · ")}</p>
                  </div>
                  <Button variant="ghost" size="icon" className="h-6 w-6 shrink-0 opacity-60 hover:opacity-100"
                    onClick={() => dismissMut.mutate(r.id)}>
                    <BellOff size={12} />
                  </Button>
                </div>
              ))}
              {reminders.length > 5 && (
                <p className="text-xs text-muted-foreground text-center">{reminders.length - 5} reminder lainnya…</p>
              )}
            </CardContent>
          </Card>
        )}

        {/* Summary Cards */}
        <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-5 gap-3">
          <StatCard label="Kasbon Aktif" value={idrShort(totalKasbon)} sub={`${dash?.cashAdvances.kasbon.count ?? 0} transaksi`} icon={<HandCoins size={18} className="text-amber-400" />} color="text-amber-400" />
          <StatCard label="Talangan Aktif" value={idrShort(totalTalangan)} sub={`${dash?.cashAdvances.talangan.count ?? 0} transaksi`} icon={<HandCoins size={18} className="text-orange-400" />} color="text-orange-400" />
          <StatCard label="Hutang Bank" value={idrShort(totalBankLoan)} sub={`${dash?.bankLoans.bank.count ?? 0} pinjaman`} icon={<Landmark size={18} className="text-blue-400" />} color="text-blue-400" />
          <StatCard label="Leasing" value={idrShort(totalLeasing)} sub={`${dash?.bankLoans.leasing.count ?? 0} kontrak`} icon={<Building2 size={18} className="text-purple-400" />} color="text-purple-400" />
          <StatCard label="Cicilan Vendor" value={idrShort(totalInst)} sub={`${dash?.vendorInstallments.count ?? 0} hutang`} icon={<Package size={18} className="text-teal-400" />} color="text-teal-400" />
        </div>

        {/* Charts Row */}
        <div className="grid md:grid-cols-2 gap-4">
          {/* Monthly Trend */}
          <Card>
            <CardHeader className="py-3 px-4">
              <CardTitle className="text-sm flex items-center gap-2"><TrendingDown size={14} />Trend Expense 6 Bulan</CardTitle>
            </CardHeader>
            <CardContent className="px-2 pb-4">
              {isLoading ? (
                <div className="h-44 flex items-center justify-center text-muted-foreground text-sm">Memuat…</div>
              ) : (
                <ResponsiveContainer width="100%" height={180}>
                  <BarChart data={dash?.monthlyTrend ?? []} margin={{ top: 4, right: 8, left: 0, bottom: 0 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
                    <XAxis dataKey="month" tick={{ fontSize: 10 }} stroke="hsl(var(--muted-foreground))" />
                    <YAxis tickFormatter={idrShort} tick={{ fontSize: 10 }} stroke="hsl(var(--muted-foreground))" width={56} />
                    <Tooltip formatter={(v: number) => idr(v)} labelStyle={{ color: "hsl(var(--foreground))" }} />
                    <Bar dataKey="total" name="Total Expense" fill="hsl(var(--chart-1))" radius={[4, 4, 0, 0]} />
                  </BarChart>
                </ResponsiveContainer>
              )}
            </CardContent>
          </Card>

          {/* Expense by Category */}
          <Card>
            <CardHeader className="py-3 px-4">
              <CardTitle className="text-sm flex items-center gap-2"><TrendingDown size={14} />Expense per Kategori (YTD)</CardTitle>
            </CardHeader>
            <CardContent className="pb-4">
              {isLoading ? (
                <div className="h-44 flex items-center justify-center text-muted-foreground text-sm">Memuat…</div>
              ) : catData.length === 0 ? (
                <div className="h-44 flex items-center justify-center text-muted-foreground text-sm">Belum ada data</div>
              ) : (
                <ResponsiveContainer width="100%" height={180}>
                  <PieChart>
                    <Pie data={catData} dataKey="total" nameKey="name" cx="45%" cy="50%" outerRadius={72} label={false}>
                      {catData.map((_, i) => <Cell key={i} fill={CHART_COLORS[i % CHART_COLORS.length]} />)}
                    </Pie>
                    <Tooltip formatter={(v: number) => idr(v)} />
                    <Legend iconSize={10} wrapperStyle={{ fontSize: 11 }} />
                  </PieChart>
                </ResponsiveContainer>
              )}
            </CardContent>
          </Card>
        </div>

        {/* Approval Status + Quick Links */}
        <div className="grid md:grid-cols-2 gap-4">
          {/* Approval Stats */}
          <Card>
            <CardHeader className="py-3 px-4">
              <CardTitle className="text-sm flex items-center gap-2"><Clock size={14} />Status Approval</CardTitle>
            </CardHeader>
            <CardContent className="px-4 pb-4 space-y-2">
              {[
                { key: "pending",     label: "Menunggu Approval",  color: "text-amber-400" },
                { key: "l1_approved", label: "Sudah L1, Menunggu L2", color: "text-blue-400" },
                { key: "approved",    label: "Disetujui",          color: "text-green-400" },
                { key: "rejected",    label: "Ditolak",            color: "text-red-400" },
              ].map(({ key, label, color }) => (
                <div key={key} className="flex items-center justify-between py-1 border-b border-border last:border-0">
                  <span className="text-sm">{label}</span>
                  <Badge className={`text-xs font-bold ${color}`}>{approvalStats[key] ?? 0}</Badge>
                </div>
              ))}
              {(dash?.pendingApprovals ?? 0) > 0 && (
                <Link href="/expense/approvals">
                  <Button variant="outline" size="sm" className="w-full mt-2 text-amber-400 border-amber-600">
                    <Clock size={12} className="mr-1" />
                    {dash?.pendingApprovals} Approval Perlu Diproses
                    <ChevronRight size={12} className="ml-auto" />
                  </Button>
                </Link>
              )}
            </CardContent>
          </Card>

          {/* Quick Links */}
          <Card>
            <CardHeader className="py-3 px-4">
              <CardTitle className="text-sm flex items-center gap-2"><CheckCircle2 size={14} />Aksi Cepat</CardTitle>
            </CardHeader>
            <CardContent className="px-4 pb-4 space-y-2">
              {[
                { href: "/expense/templates", label: "Kelola Template Expense", icon: "📋" },
                { href: "/expense/budget",    label: "Anggaran & Multi-Mata Uang", icon: "💰" },
                { href: "/expense/approvals", label: "Approval Expense", icon: "✅" },
                { href: "/expense/kasbon",            label: "Kasbon Karyawan",       icon: "👤" },
                { href: "/expense/bank-loans",         label: "Hutang Bank / Leasing",  icon: "🏦" },
                { href: "/accounting/bank-disbursements", label: "Bank Disbursement",   icon: "🏧" },
                { href: "/expense/asset-depreciation", label: "Penyusutan Aset Tetap",  icon: "📉" },
              ].map(({ href, label, icon }) => (
                <Link key={href} href={href}>
                  <div className="flex items-center gap-3 rounded-lg border border-border hover:bg-muted/50 px-3 py-2 cursor-pointer transition-colors text-sm">
                    <span>{icon}</span>
                    <span className="flex-1">{label}</span>
                    <ChevronRight size={14} className="text-muted-foreground" />
                  </div>
                </Link>
              ))}
            </CardContent>
          </Card>
        </div>
      </div>
    </AppShell>
  );
}
