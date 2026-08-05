import { Link } from "wouter";
import { AppShell } from "@/components/layout/AppShell";
import { PageHeader } from "@/components/layout/PageHeader";
import { EmptyState } from "@/components/ui/empty-state";
import {
  Users, Building2, Banknote, Trophy, ExternalLink,
  LayoutDashboard, CalendarDays, ClipboardList, Shield,
  MapPin, Wrench, Settings, Receipt, DollarSign, BarChart2,
  ArrowLeftRight, Star, FlaskConical, Tags, CreditCard, TrendingUp,
  BookOpen, Activity, ChevronLeft,
} from "lucide-react";

interface Tab { label: string; href: string; icon: React.ComponentType<{ className?: string }> }
interface Section { key: string; title: string; icon: React.ComponentType<{ className?: string }>; items: Tab[] }

const SECTIONS: Section[] = [
  {
    key: "tenant-management",
    title: "Tenant Management",
    icon: Users,
    items: [
      { label: "Dashboard", href: "/tenant/dashboard", icon: LayoutDashboard },
      { label: "Data Tenant", href: "/tenant/tenants", icon: Users },
      { label: "Booking Tenant", href: "/tenant/bookings", icon: CalendarDays },
      { label: "Rekap Tenant", href: "/tenant/rekap", icon: ClipboardList },
      { label: "Audit Log Tenant", href: "/tenant/audit-log", icon: Shield },
    ],
  },
  {
    key: "property-operations",
    title: "Property Operations",
    icon: Building2,
    items: [
      { label: "Mall Units", href: "/tenant/mall-units", icon: MapPin },
      { label: "Unit Kantin", href: "/tenant/units", icon: Building2 },
      { label: "Perbandingan Lokasi", href: "/tenant/perbandingan-lokasi", icon: ArrowLeftRight },
      { label: "Pengaturan Tenant", href: "/tenant/pengaturan", icon: Settings },
    ],
  },
  {
    key: "billing-finance",
    title: "Billing & Finance",
    icon: Banknote,
    items: [
      { label: "Invoice Tenant", href: "/tenant/invoices", icon: Receipt },
      { label: "Pembayaran Sewa", href: "/tenant/payments", icon: DollarSign },
      { label: "Laporan Keuangan Tenant", href: "/tenant/laporan-keuangan", icon: BarChart2 },
      { label: "Rekonsiliasi Tenant", href: "/tenant/rekonsiliasi", icon: ArrowLeftRight },
    ],
  },
  {
    key: "sport-center",
    title: "Sport Center",
    icon: Trophy,
    items: [
      { label: "SC Dashboard", href: "/sport-center/dashboard", icon: LayoutDashboard },
      { label: "Bookings", href: "/sport-center/bookings", icon: CalendarDays },
      { label: "Fasilitas", href: "/sport-center/facilities", icon: Wrench },
      { label: "Members", href: "/sport-center/members", icon: Star },
      { label: "Customers", href: "/sport-center/customers", icon: Users },
      { label: "Pricing Rules", href: "/sport-center/pricing-rules", icon: Tags },
      { label: "Pembayaran", href: "/sport-center/payments", icon: CreditCard },
      { label: "Laporan SC", href: "/sport-center/reports", icon: TrendingUp },
      { label: "Daftar Produk SC", href: "/sport-center/products", icon: FlaskConical },
      { label: "Jurnal SC", href: "/sport-center/journals", icon: BookOpen },
      { label: "Log Aktivitas SC", href: "/sport-center/activity-log", icon: Activity },
    ],
  },
];

const COLORS: Record<string, { text: string; bg: string; border: string }> = {
  "tenant-management":  { text: "text-blue-600",   bg: "bg-blue-50 dark:bg-blue-950/30",    border: "border-blue-200 dark:border-blue-800" },
  "property-operations":{ text: "text-purple-600", bg: "bg-purple-50 dark:bg-purple-950/30", border: "border-purple-200 dark:border-purple-800" },
  "billing-finance":    { text: "text-green-600",  bg: "bg-green-50 dark:bg-green-950/30",   border: "border-green-200 dark:border-green-800" },
  "sport-center":       { text: "text-orange-600", bg: "bg-orange-50 dark:bg-orange-950/30", border: "border-orange-200 dark:border-orange-800" },
};

export default function TenantWorkspacePage({ section }: { section?: string }) {
  const activeKey = section ?? "tenant-management";
  const activeSection = SECTIONS.find((s) => s.key === activeKey) ?? SECTIONS[0];
  const colors = COLORS[activeSection.key] ?? COLORS["tenant-management"];

  return (
    <AppShell>
      <div className="flex flex-col gap-6">
        <button onClick={() => window.history.back()} className="mb-1 inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground transition-colors w-fit">
          <ChevronLeft className="h-4 w-4" />
          Kembali
        </button>
        <PageHeader
          breadcrumb={[
            { label: "Dashboard", href: "/" },
            { label: "Tenant & Property", href: "/tenant" },
            { label: activeSection.title },
          ]}
          title={activeSection.title}
          description="Tenant & Property · Workspace"
        />

        <div className="flex gap-1 flex-wrap border-b pb-0">
          {SECTIONS.map((s) => {
            const isActive = s.key === activeSection.key;
            const Icon = s.icon;
            return (
              <Link key={s.key} href={`/tenant/workspace/${s.key}`}>
                <button
                  className={`flex items-center gap-1.5 px-3 py-2 text-sm font-medium rounded-t-md border-b-2 transition-colors ${
                    isActive
                      ? "border-primary text-primary"
                      : "border-transparent text-muted-foreground hover:text-foreground hover:border-muted-foreground/40"
                  }`}
                >
                  <Icon className="h-3.5 w-3.5" />
                  {s.title}
                </button>
              </Link>
            );
          })}
        </div>

        {activeSection.items.length === 0 ? (
          <EmptyState
            title="Tidak ada menu"
            description="Belum ada item pada section ini."
          />
        ) : (
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {activeSection.items.map((item) => {
              const Icon = item.icon;
              return (
                <Link key={item.href} href={item.href}>
                  <div
                    className={`group flex items-center gap-3 rounded-lg border p-4 cursor-pointer transition-all hover:shadow-sm hover:-translate-y-0.5 ${colors.border} ${colors.bg}`}
                  >
                    <div className="rounded-md p-2 bg-white dark:bg-black/20 shadow-sm shrink-0">
                      <Icon className={`h-4 w-4 ${colors.text}`} />
                    </div>
                    <span className="text-sm font-medium group-hover:underline flex-1">{item.label}</span>
                    <ExternalLink className="h-3 w-3 text-muted-foreground opacity-0 group-hover:opacity-100 transition-opacity shrink-0" />
                  </div>
                </Link>
              );
            })}
          </div>
        )}
      </div>
    </AppShell>
  );
}
