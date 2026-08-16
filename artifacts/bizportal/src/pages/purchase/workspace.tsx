import { Link, useLocation } from "wouter";
import { AppShell } from "@/components/layout/AppShell";
import { PageHeader } from "@/components/layout/PageHeader";
import { EmptyState } from "@/components/ui/empty-state";
import {
  ShoppingCart,
  Users,
  FileText,
  Package,
  BarChart3,
  ExternalLink,
  LayoutDashboard,
  ClipboardList,
  FileCheck,
  ShoppingBag,
  Truck,
  FlaskConical,
  RotateCcw,
  Store,
  FormInput,
  ListChecks,
  BookOpen,
  Settings2,
  Gauge,
  Receipt,
  Banknote,
  DollarSign,
  PackageCheck,
  TrendingUp,
  Star,
  BarChart2,
  ArrowUpRight,
} from "lucide-react";

interface WorkspaceItem {
  label: string;
  href: string;
  icon: React.ComponentType<{ className?: string }>;
  isCta?: boolean;
  ctaDesc?: string;
}

interface WorkspaceSection {
  key: string;
  title: string;
  icon: React.ComponentType<{ className?: string }>;
  items: WorkspaceItem[];
}

const SECTIONS: WorkspaceSection[] = [
  {
    key: "purchase-flow",
    title: "Purchase Flow",
    icon: ShoppingCart,
    items: [
      { label: "Dashboard", href: "/purchase/dashboard", icon: LayoutDashboard },
      { label: "Purchase Requests", href: "/purchase/pr", icon: ClipboardList },
      { label: "RFQ / Penawaran", href: "/purchase/rfq", icon: FileCheck },
      { label: "Purchase Orders", href: "/purchase/orders", icon: ShoppingBag },
      { label: "Goods Receipt", href: "/purchase/gr", icon: Truck },
      { label: "QC Inspection", href: "/purchase/qc", icon: FlaskConical },
      { label: "Purchase Returns", href: "/purchase/returns", icon: RotateCcw },
    ],
  },
  {
    key: "vendor-management",
    title: "Vendor Management",
    icon: Users,
    items: [
      { label: "Vendors / Suppliers", href: "/purchase/vendors", icon: Store },
      { label: "Vendor Forms", href: "/purchase/vendor-forms", icon: FormInput },
      { label: "VMF Audit Trail", href: "/purchase/vmf-audit-trail", icon: ListChecks },
      { label: "Vendor Catalog", href: "/purchase/vendor-catalog", icon: BookOpen },
      { label: "Vendor Catalog Engine", href: "/purchase/vendor-catalog-engine", icon: Settings2 },
      { label: "Trucking Pricing", href: "/purchase/trucking-pricing", icon: Gauge },
    ],
  },
  {
    key: "invoices-docs",
    title: "Vendor Invoice",
    icon: FileText,
    items: [
      { label: "Vendor Invoice", href: "/purchase/vendor-invoices", icon: Receipt },
      {
        label: "Buat Bank Disbursement",
        href: "/accounting/bank-disbursements?mode=vendor_invoice",
        icon: Banknote,
        isCta: true,
        ctaDesc: "Bayar invoice vendor → semua pembayaran keluar via Bank Disbursement",
      },
    ],
  },
  {
    key: "landed-cost",
    title: "Landed Cost",
    icon: Package,
    items: [
      { label: "Landed Costs", href: "/purchase/landed-costs", icon: DollarSign },
      { label: "Receive Inventory", href: "/purchase/receive", icon: PackageCheck },
    ],
  },
  {
    key: "procurement-analytics",
    title: "Procurement Analytics",
    icon: BarChart3,
    items: [
      { label: "Marketplace Analytics", href: "/purchase/marketplace-analytics", icon: TrendingUp },
      { label: "Vendor Performance", href: "/logistics/vendor-performance", icon: Star },
      { label: "Procurement Reports", href: "/reports/purchase", icon: BarChart2 },
    ],
  },
];

const SECTION_COLORS: Record<string, { text: string; bg: string; border: string; activeBg: string }> = {
  "purchase-flow":         { text: "text-blue-600",   bg: "bg-blue-50 dark:bg-blue-950",   border: "border-blue-200 dark:border-blue-800",   activeBg: "bg-blue-100 dark:bg-blue-900/50" },
  "vendor-management":     { text: "text-purple-600", bg: "bg-purple-50 dark:bg-purple-950/30", border: "border-purple-200 dark:border-purple-800", activeBg: "bg-purple-100 dark:bg-purple-900/50" },
  "invoices-docs":         { text: "text-green-600",  bg: "bg-green-50 dark:bg-green-950",  border: "border-green-200 dark:border-green-800",  activeBg: "bg-green-100 dark:bg-green-900/50" },
  "landed-cost":           { text: "text-orange-600", bg: "bg-orange-50 dark:bg-orange-950", border: "border-orange-200 dark:border-orange-800", activeBg: "bg-orange-100 dark:bg-orange-900/50" },
  "procurement-analytics": { text: "text-rose-600",   bg: "bg-rose-50 dark:bg-rose-950/30",   border: "border-rose-200 dark:border-rose-800",   activeBg: "bg-rose-100 dark:bg-rose-900/50" },
};

export default function PurchaseWorkspacePage({ section }: { section?: string }) {
  const [location] = useLocation();
  const activeKey = section ?? location.split("/purchase/workspace/")[1] ?? "purchase-flow";
  const activeSection = SECTIONS.find((s) => s.key === activeKey) ?? SECTIONS[0];
  const colors = SECTION_COLORS[activeSection.key] ?? SECTION_COLORS["purchase-flow"];
  const SectionIcon = activeSection.icon;

  return (
    <AppShell>
      <div className="flex flex-col gap-6">
        <PageHeader
          breadcrumb={[
            { label: "Dashboard", href: "/" },
            { label: "Procurement", href: "/purchase" },
            { label: activeSection.title },
          ]}
          title={activeSection.title}
          description="Procurement · Workspace"
        />

        <div className="flex gap-1 flex-wrap border-b pb-0">
          {SECTIONS.map((s) => {
            const isActive = s.key === activeSection.key;
            const Icon = s.icon;
            return (
              <Link key={s.key} href={`/purchase/workspace/${s.key}`}>
                <button
                  className={`flex items-center gap-1.5 px-3 py-2 text-sm font-medium rounded-t-md border-b-2 transition-colors ${
                    isActive
                      ? `border-primary text-primary`
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
              if (item.isCta) {
                return (
                  <Link key={item.href} href={item.href}>
                    <div className="group flex items-center gap-3 rounded-lg border-2 border-dashed border-emerald-400 dark:border-emerald-600 p-4 cursor-pointer transition-all hover:shadow-md hover:-translate-y-0.5 hover:border-emerald-500 hover:bg-emerald-50 dark:hover:bg-emerald-950/30">
                      <div className="rounded-md p-2 bg-emerald-100 dark:bg-emerald-900/40 shadow-sm shrink-0">
                        <Icon className="h-4 w-4 text-emerald-600 dark:text-emerald-400" />
                      </div>
                      <div className="flex-1 min-w-0">
                        <span className="text-sm font-semibold text-emerald-700 dark:text-emerald-400 group-hover:underline block leading-tight">{item.label}</span>
                        {item.ctaDesc && (
                          <span className="text-xs text-emerald-600/70 dark:text-emerald-500/70 leading-tight">{item.ctaDesc}</span>
                        )}
                      </div>
                      <ArrowUpRight className="h-4 w-4 text-emerald-500 shrink-0 opacity-60 group-hover:opacity-100 transition-opacity" />
                    </div>
                  </Link>
                );
              }
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
