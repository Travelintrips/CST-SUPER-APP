import { Link } from "wouter";
import { AppShell } from "@/components/layout/AppShell";
import { PageHeader } from "@/components/layout/PageHeader";
import { EmptyState } from "@/components/ui/empty-state";
import {
  TrendingUp, FileText, Globe, Bot, ExternalLink,
  LayoutDashboard, Users, ShoppingBag, FileCheck,
  Receipt, Tag, File, Package, Globe2, UserCheck, Brain,
} from "lucide-react";

interface Tab { label: string; href: string; icon: React.ComponentType<{ className?: string }> }
interface Section { key: string; title: string; icon: React.ComponentType<{ className?: string }>; items: Tab[] }

const SECTIONS: Section[] = [
  {
    key: "sales-pipeline",
    title: "Sales Pipeline",
    icon: TrendingUp,
    items: [
      { label: "Dashboard", href: "/sales/dashboard", icon: LayoutDashboard },
      { label: "Customers", href: "/sales/customers", icon: Users },
      { label: "Sales Orders", href: "/sales/orders", icon: ShoppingBag },
    ],
  },
  {
    key: "sales-documents",
    title: "Sales Documents",
    icon: FileText,
    items: [
      { label: "Quotations", href: "/sales/quotations", icon: FileCheck },
      { label: "Sales Invoices", href: "/sales/invoices", icon: Receipt },
      { label: "Sales Items", href: "/sales/items", icon: Tag },
      { label: "Sales Documents", href: "/sales/documents", icon: File },
    ],
  },
  {
    key: "digital-channels",
    title: "Digital Channels",
    icon: Globe,
    items: [
      { label: "Portal Orders", href: "/portal-product-orders", icon: Package },
      { label: "Ecommerce", href: "/ecommerce", icon: Globe2 },
      { label: "Customer Portal", href: "/portal/customers", icon: UserCheck },
    ],
  },
  {
    key: "ai-sales-assistant",
    title: "AI Sales Assistant",
    icon: Bot,
    items: [
      { label: "AI Draft Quotation", href: "/sales/ai-drafts", icon: Brain },
    ],
  },
];

const COLORS: Record<string, { text: string; bg: string; border: string }> = {
  "sales-pipeline":     { text: "text-blue-600",   bg: "bg-blue-50 dark:bg-blue-950",    border: "border-blue-200 dark:border-blue-800" },
  "sales-documents":    { text: "text-green-600",  bg: "bg-green-50 dark:bg-green-950",   border: "border-green-200 dark:border-green-800" },
  "digital-channels":   { text: "text-purple-600", bg: "bg-purple-50 dark:bg-purple-950/30", border: "border-purple-200 dark:border-purple-800" },
  "ai-sales-assistant": { text: "text-amber-600",  bg: "bg-amber-50 dark:bg-amber-950",   border: "border-amber-200 dark:border-amber-800" },
};

export default function SalesWorkspacePage({ section }: { section?: string }) {
  const activeKey = section ?? "sales-pipeline";
  const activeSection = SECTIONS.find((s) => s.key === activeKey) ?? SECTIONS[0];
  const colors = COLORS[activeSection.key] ?? COLORS["sales-pipeline"];

  return (
    <AppShell>
      <div className="flex flex-col gap-6">
        <PageHeader
          breadcrumb={[
            { label: "Dashboard", href: "/" },
            { label: "CRM & Sales", href: "/sales" },
            { label: activeSection.title },
          ]}
          title={activeSection.title}
          description="CRM & Sales · Workspace"
        />

        <div className="flex gap-1 flex-wrap border-b pb-0">
          {SECTIONS.map((s) => {
            const isActive = s.key === activeSection.key;
            const Icon = s.icon;
            return (
              <Link key={s.key} href={`/sales/workspace/${s.key}`}>
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
