import { Link } from "wouter";
import { AppShell } from "@/components/layout/AppShell";
import { PageHeader } from "@/components/layout/PageHeader";
import { EmptyState } from "@/components/ui/empty-state";
import {
  LayoutGrid, Building2, Settings, ExternalLink,
  Monitor, ShoppingBag, Package, Cpu,
  Layers, Users, UserCircle, Shield,
} from "lucide-react";

interface Tab { label: string; href: string; icon: React.ComponentType<{ className?: string }> }
interface Section { key: string; title: string; icon: React.ComponentType<{ className?: string }>; items: Tab[] }

const SECTIONS: Section[] = [
  {
    key: "pos-operations",
    title: "POS Operations",
    icon: LayoutGrid,
    items: [
      { label: "POS Tenant View", href: "/tenant/pos-tenant", icon: Monitor },
      { label: "Produk Kasir", href: "/tenant/kasir/products", icon: ShoppingBag },
      { label: "Produk POS", href: "/tenant/pos/products", icon: Package },
      { label: "Perangkat", href: "/tenant/kasir/devices", icon: Cpu },
    ],
  },
  {
    key: "branch-cashier",
    title: "Branch & Cashier",
    icon: Building2,
    items: [
      { label: "Perusahaan", href: "/tenant/kasir/companies", icon: Building2 },
      { label: "Cabang Kasir", href: "/tenant/kasir/branches", icon: Layers },
      { label: "Pengguna Kasir", href: "/tenant/kasir/users", icon: Users },
      { label: "Cabang POS", href: "/tenant/pos/branches", icon: Building2 },
      { label: "Kasir", href: "/tenant/pos/cashiers", icon: UserCircle },
    ],
  },
  {
    key: "pos-settings",
    title: "POS Settings",
    icon: Settings,
    items: [
      { label: "Role & Akses POS", href: "/tenant/pos/roles", icon: Shield },
      { label: "Pengaturan POS", href: "/tenant/pos/settings", icon: Settings },
    ],
  },
];

const COLORS: Record<string, { text: string; bg: string; border: string }> = {
  "pos-operations": { text: "text-blue-600",   bg: "bg-blue-50 dark:bg-blue-950/30",    border: "border-blue-200 dark:border-blue-800" },
  "branch-cashier": { text: "text-purple-600", bg: "bg-purple-50 dark:bg-purple-950/30", border: "border-purple-200 dark:border-purple-800" },
  "pos-settings":   { text: "text-green-600",  bg: "bg-green-50 dark:bg-green-950/30",   border: "border-green-200 dark:border-green-800" },
};

export default function PosWorkspacePage({ section }: { section?: string }) {
  const activeKey = section ?? "pos-operations";
  const activeSection = SECTIONS.find((s) => s.key === activeKey) ?? SECTIONS[0];
  const colors = COLORS[activeSection.key] ?? COLORS["pos-operations"];

  return (
    <AppShell>
      <div className="flex flex-col gap-6">
        <PageHeader
          breadcrumb={[
            { label: "Dashboard", href: "/" },
            { label: "POS", href: "/tenant/kasir" },
            { label: activeSection.title },
          ]}
          title={activeSection.title}
          description="POS · Workspace"
        />

        <div className="flex gap-1 flex-wrap border-b pb-0">
          {SECTIONS.map((s) => {
            const isActive = s.key === activeSection.key;
            const Icon = s.icon;
            return (
              <Link key={s.key} href={`/tenant/kasir/workspace/${s.key}`}>
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
