import { AppShell } from "@/components/layout/AppShell";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { useQuery } from "@tanstack/react-query";
import { useCompany } from "@/contexts/CompanyContext";
import { useLocation } from "wouter";
import {
  Store, Users, FileText, DollarSign, Clock, ArrowRight,
  AlertCircle, AlertTriangle, Building2, TrendingUp, Receipt,
  ChevronLeft, BarChart3, CheckCircle2,
} from "lucide-react";

const idr = (n: number) =>
  new Intl.NumberFormat("id-ID", { style: "currency", currency: "IDR", maximumFractionDigits: 0 }).format(n);

type RevenuePerTenant = {
  id: number;
  business_name: string;
  status: string;
  revenue_confirmed: number;
  revenue_pending: number;
  invoices_outstanding: number;
  invoices_overdue: number;
};

type MallUnitSite = {
  site_id: number;
  site_name: string;
  site_code: string;
  total: number;
  occupied: number;
  available: number;
};

type Summary = {
  tenants: { total: number; active: number };
  bookings: { total: number; unpaid: number };
  revenue: number;
  pendingPayments: number;
  invoices: { total: number; paid: number; overdue: number; pending: number; piutang: number; paid_this_month: number; unpaid_count: number };
  units: { total: number; occupied: number; available: number };
  mallUnits?: { total: number; occupied: number; available: number; sites: MallUnitSite[] };
  revenuePerTenant?: RevenuePerTenant[];
};

export default function TenantDashboard() {
  const { activeCompanyId } = useCompany();
  const [, navigate] = useLocation();

  const { data, isLoading } = useQuery<Summary>({
    queryKey: ["tenant-dashboard", activeCompanyId],
    queryFn: async () => {
      const qs = activeCompanyId ? `?companyId=${activeCompanyId}` : "";
      const r = await fetch(`/api/tenant/dashboard${qs}`, { credentials: "include" });
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      return r.json();
    },
    staleTime: 60_000,
    refetchInterval: 120_000,
    refetchOnWindowFocus: false,
  });

  // Gunakan mall_units jika ada, fallback ke tenant_units
  const mallUnits = data?.mallUnits;
  const unitOccupied = mallUnits ? mallUnits.occupied : (data?.units?.occupied ?? 0);
  const unitTotal   = mallUnits ? mallUnits.total    : (data?.units?.total ?? 0);
  const unitAvail   = mallUnits ? mallUnits.available : (data?.units?.available ?? 0);
  const unitPct     = unitTotal > 0 ? Math.round((unitOccupied / unitTotal) * 100) : 0;

  const revPerTenant: RevenuePerTenant[] = data?.revenuePerTenant ?? [];
  const totalRevenue = data?.revenue ?? 0;

  const mainCards = [
    {
      label: "Tenant Aktif",
      value: data?.tenants?.active ?? 0,
      sub: `dari ${data?.tenants?.total ?? 0} terdaftar`,
      icon: Store, color: "text-blue-400", href: "/tenant/tenants",
    },
    {
      label: "Pendapatan Sewa",
      value: idr(totalRevenue),
      sub: "Pembayaran terkonfirmasi",
      icon: DollarSign, color: "text-emerald-400", href: "/tenant/payments",
    },
    {
      label: "Bukti Bayar Pending",
      value: data?.pendingPayments ?? 0,
      sub: "menunggu persetujuan admin",
      icon: Clock, color: "text-yellow-400", href: "/tenant/payments",
      highlight: (data?.pendingPayments ?? 0) > 0,
    },
    {
      label: "Invoice Overdue",
      value: data?.invoices?.overdue ?? 0,
      sub: `+${data?.invoices?.pending ?? 0} belum bayar`,
      icon: AlertTriangle, color: "text-red-400", href: "/tenant/invoices",
      highlight: (data?.invoices?.overdue ?? 0) > 0,
    },
  ];

  const invoiceCards = [
    { label: "Total Invoice", value: data?.invoices?.total ?? 0, sub: `${data?.invoices?.paid ?? 0} lunas`, icon: Receipt, color: "text-violet-400", href: "/tenant/invoices" },
    { label: "Belum Lunas", value: data?.invoices?.unpaid_count ?? 0, sub: "Unpaid + Sebagian + Terkirim", icon: AlertCircle, color: "text-yellow-400", href: "/tenant/invoices?status=unpaid" },
    { label: "Jatuh Tempo", value: data?.invoices?.overdue ?? 0, sub: "Melewati due date", icon: AlertCircle, color: "text-red-400", href: "/tenant/invoices?status=overdue" },
    { label: "Tagihan Bulan Ini", value: idr(data?.invoices?.paid_this_month ?? 0), sub: "Dibayar bulan ini", icon: TrendingUp, color: "text-emerald-400", href: "/tenant/invoices" },
  ];

  const totalOutstanding = data?.invoices?.piutang ?? 0;

  return (
    <AppShell>
      <div className="p-6 space-y-6">
        <button onClick={() => window.history.back()} className="mb-1 inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground transition-colors">
          <ChevronLeft className="h-4 w-4" />Kembali
        </button>
        <div className="flex items-center gap-3">
          <Store className="h-6 w-6 text-blue-400" />
          <div>
            <h1 className="text-2xl font-bold text-foreground">Dashboard Tenant</h1>
            <p className="text-sm text-muted-foreground">Ringkasan operasional tenant &amp; properti</p>
          </div>
        </div>

        {/* Top KPI Cards */}
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
          {mainCards.map((c) => (
            <Card key={c.label}
              className={`border-border/60 cursor-pointer transition-colors ${c.highlight ? "border-red-500/40 bg-red-500/5" : "hover:border-border"}`}
              onClick={() => navigate(c.href)}>
              <CardContent className="p-4">
                <div className="flex items-center justify-between">
                  <c.icon className={`h-5 w-5 ${c.color}`} />
                  <ArrowRight className="h-4 w-4 text-muted-foreground" />
                </div>
                <p className="text-xs text-muted-foreground mt-3">{c.label}</p>
                <p className="text-2xl font-bold text-foreground mt-1">{isLoading ? "…" : c.value}</p>
                <p className="text-xs text-muted-foreground mt-1">{c.sub}</p>
              </CardContent>
            </Card>
          ))}
        </div>

        {/* Mall Unit Status per Site */}
        <Card className="border-border/60">
          <CardContent className="p-4">
            <div className="flex items-center justify-between mb-3">
              <div className="flex items-center gap-2">
                <Building2 className="h-4 w-4 text-teal-400" />
                <span className="text-sm font-medium text-foreground">Status Unit Mall</span>
                <span className="text-xs text-muted-foreground">({unitOccupied} terisi / {unitTotal} total)</span>
              </div>
              <Button size="sm" variant="ghost" className="h-7 text-xs gap-1 text-muted-foreground"
                onClick={() => navigate("/tenant/mall-units")}>
                Kelola Unit <ArrowRight className="h-3.5 w-3.5" />
              </Button>
            </div>

            {/* Overall bar */}
            <div className="w-full h-2.5 rounded-full bg-muted overflow-hidden flex mb-2">
              <div className="h-full bg-blue-500 transition-all" style={{ width: `${unitPct}%` }} />
              <div className="h-full bg-emerald-500 flex-1" />
            </div>
            <div className="flex items-center gap-4 mb-4 text-xs text-muted-foreground">
              <span className="flex items-center gap-1.5"><span className="w-2 h-2 rounded-full bg-blue-500 inline-block" />Terisi — {unitOccupied}</span>
              <span className="flex items-center gap-1.5"><span className="w-2 h-2 rounded-full bg-emerald-500 inline-block" />Tersedia — {unitAvail}</span>
              {unitTotal > 0 && <span className="ml-auto font-medium text-foreground">{unitPct}% terpakai</span>}
            </div>

            {/* Per-site breakdown */}
            {mallUnits && mallUnits.sites && mallUnits.sites.length > 0 && (
              <div className="grid grid-cols-1 md:grid-cols-2 gap-2 mt-1">
                {mallUnits.sites.map((s) => {
                  const pct = s.total > 0 ? Math.round((s.occupied / s.total) * 100) : 0;
                  return (
                    <div key={s.site_id} className="rounded-lg border border-border/40 p-3 bg-muted/20">
                      <div className="flex items-center justify-between mb-1.5">
                        <span className="text-xs font-medium text-foreground">{s.site_name}</span>
                        <Badge variant="outline" className="text-[10px] h-4 px-1.5">{pct}% terisi</Badge>
                      </div>
                      <div className="w-full h-1.5 rounded-full bg-muted overflow-hidden flex">
                        <div className="h-full bg-blue-500" style={{ width: `${pct}%` }} />
                        <div className="h-full bg-emerald-500 flex-1" />
                      </div>
                      <div className="flex gap-3 mt-1.5 text-[10px] text-muted-foreground">
                        <span>{s.occupied} terisi</span>
                        <span>{s.available} tersedia</span>
                        <span className="ml-auto">{s.total} total</span>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </CardContent>
        </Card>

        {/* Revenue per Tenant Table */}
        {revPerTenant.length > 0 && (
          <div>
            <div className="flex items-center justify-between mb-3">
              <h2 className="text-sm font-semibold text-foreground flex items-center gap-2">
                <BarChart3 className="h-4 w-4 text-emerald-400" />
                Rekap Pendapatan per Tenant
              </h2>
              <Button size="sm" variant="ghost" className="h-7 text-xs gap-1 text-muted-foreground"
                onClick={() => navigate("/tenant/payments")}>
                Lihat Semua <ArrowRight className="h-3.5 w-3.5" />
              </Button>
            </div>
            <Card className="border-border/60 overflow-hidden">
              <div className="overflow-x-auto">
                <table className="w-full text-xs">
                  <thead>
                    <tr className="border-b border-border/60 bg-muted/40">
                      <th className="text-left px-4 py-2.5 font-medium text-muted-foreground">Tenant</th>
                      <th className="text-right px-4 py-2.5 font-medium text-muted-foreground">Terkonfirmasi</th>
                      <th className="text-right px-4 py-2.5 font-medium text-muted-foreground">Pending</th>
                      <th className="text-right px-4 py-2.5 font-medium text-muted-foreground">Piutang</th>
                      <th className="text-center px-4 py-2.5 font-medium text-muted-foreground">Status</th>
                    </tr>
                  </thead>
                  <tbody>
                    {revPerTenant.map((t, i) => {
                      const pct = totalRevenue > 0 ? Math.round((t.revenue_confirmed / totalRevenue) * 100) : 0;
                      return (
                        <tr key={t.id} className={`border-b border-border/40 hover:bg-muted/20 transition-colors ${i % 2 === 0 ? "" : "bg-muted/10"}`}>
                          <td className="px-4 py-2.5">
                            <div className="flex items-center gap-2">
                              <div className="font-medium text-foreground">{t.business_name}</div>
                              {pct > 0 && (
                                <div className="flex-1 max-w-[80px] h-1.5 rounded-full bg-muted overflow-hidden">
                                  <div className="h-full bg-emerald-500/70" style={{ width: `${Math.min(pct * 3, 100)}%` }} />
                                </div>
                              )}
                            </div>
                          </td>
                          <td className="px-4 py-2.5 text-right font-medium text-emerald-400">
                            {t.revenue_confirmed > 0 ? idr(t.revenue_confirmed) : <span className="text-muted-foreground">—</span>}
                          </td>
                          <td className="px-4 py-2.5 text-right text-yellow-400">
                            {t.revenue_pending > 0 ? idr(t.revenue_pending) : <span className="text-muted-foreground">—</span>}
                          </td>
                          <td className="px-4 py-2.5 text-right">
                            {t.invoices_outstanding > 0 ? (
                              <span className={t.invoices_overdue > 0 ? "text-red-400 font-medium" : "text-yellow-400"}>
                                {t.invoices_outstanding} invoice
                              </span>
                            ) : (
                              <span className="inline-flex items-center gap-1 text-emerald-400">
                                <CheckCircle2 className="h-3 w-3" /> Lunas
                              </span>
                            )}
                          </td>
                          <td className="px-4 py-2.5 text-center">
                            <Badge
                              variant="outline"
                              className={`text-[10px] h-4 px-1.5 ${t.status === "active" ? "border-emerald-500/40 text-emerald-400" : "border-muted text-muted-foreground"}`}>
                              {t.status === "active" ? "Aktif" : t.status}
                            </Badge>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                  <tfoot>
                    <tr className="border-t border-border/60 bg-muted/30">
                      <td className="px-4 py-2.5 font-semibold text-foreground text-xs">TOTAL</td>
                      <td className="px-4 py-2.5 text-right font-bold text-emerald-400 text-xs">{idr(totalRevenue)}</td>
                      <td className="px-4 py-2.5 text-right text-yellow-400 text-xs">
                        {idr(revPerTenant.reduce((s, t) => s + (t.revenue_pending ?? 0), 0))}
                      </td>
                      <td className="px-4 py-2.5 text-right text-xs text-muted-foreground">
                        {revPerTenant.reduce((s, t) => s + (t.invoices_outstanding ?? 0), 0)} invoice
                      </td>
                      <td />
                    </tr>
                  </tfoot>
                </table>
              </div>
            </Card>
          </div>
        )}

        {/* Invoice Summary Cards */}
        <div>
          <div className="flex items-center justify-between mb-3">
            <h2 className="text-sm font-semibold text-foreground flex items-center gap-2">
              <Receipt className="h-4 w-4 text-violet-400" /> Invoice Penyewa
            </h2>
            {totalOutstanding > 0 && (
              <span className="text-xs text-yellow-400 font-medium">
                Total piutang: {idr(totalOutstanding)}
              </span>
            )}
          </div>
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
            {invoiceCards.map((c) => (
              <Card key={c.label} className="border-border/60 cursor-pointer hover:border-border transition-colors" onClick={() => navigate(c.href)}>
                <CardContent className="p-4">
                  <div className="flex items-center justify-between">
                    <c.icon className={`h-5 w-5 ${c.color}`} />
                    <ArrowRight className="h-4 w-4 text-muted-foreground" />
                  </div>
                  <p className="text-xs text-muted-foreground mt-3">{c.label}</p>
                  <p className="text-2xl font-bold text-foreground mt-1">{isLoading ? "…" : c.value}</p>
                  <p className="text-xs text-muted-foreground mt-1">{c.sub}</p>
                </CardContent>
              </Card>
            ))}
          </div>
        </div>

        {/* Quick Actions */}
        <div className="flex flex-wrap gap-2">
          <Button size="sm" className="gap-1" onClick={() => navigate("/tenant/tenants")}>
            <Users className="h-4 w-4" /> Kelola Tenant
          </Button>
          <Button size="sm" variant="outline" className="gap-1" onClick={() => navigate("/tenant/mall-units")}>
            <Building2 className="h-4 w-4" /> Unit Mall
          </Button>
          <Button size="sm" variant="outline" className="gap-1" onClick={() => navigate("/tenant/invoices")}>
            <Receipt className="h-4 w-4" /> Invoice
          </Button>
          <Button size="sm" variant="outline" className="gap-1" onClick={() => navigate("/tenant/bookings")}>
            <FileText className="h-4 w-4" /> Penyewaan
          </Button>
          <Button size="sm" variant="outline" className="gap-1" onClick={() => navigate("/tenant/payments")}>
            <DollarSign className="h-4 w-4" /> Pembayaran
          </Button>
          <Button size="sm" variant="outline" className="gap-1" onClick={() => navigate("/tenant/laporan-keuangan")}>
            <BarChart3 className="h-4 w-4" /> Laporan
          </Button>
        </div>
      </div>
    </AppShell>
  );
}
