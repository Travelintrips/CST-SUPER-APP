import { Link } from "wouter";
import { AppShell } from "@/components/layout/AppShell";
import { PageHeader } from "@/components/layout/PageHeader";
import { LayoutGrid, Building2, Settings } from "lucide-react";

const SECTIONS = [
  {
    key: "pos-operations",
    title: "POS Operations",
    description: "Tampilan kasir, produk kasir, produk POS, dan perangkat terminal.",
    icon: LayoutGrid,
    color: "text-blue-600",
    bg: "bg-blue-50 dark:bg-blue-950/30",
    border: "border-blue-200 dark:border-blue-800",
  },
  {
    key: "branch-cashier",
    title: "Branch & Cashier",
    description: "Perusahaan, cabang kasir, pengguna kasir, cabang POS, dan data kasir.",
    icon: Building2,
    color: "text-purple-600",
    bg: "bg-purple-50 dark:bg-purple-950/30",
    border: "border-purple-200 dark:border-purple-800",
  },
  {
    key: "pos-settings",
    title: "POS Settings",
    description: "Role & akses POS dan pengaturan sistem kasir.",
    icon: Settings,
    color: "text-green-600",
    bg: "bg-green-50 dark:bg-green-950/30",
    border: "border-green-200 dark:border-green-800",
  },
];

export default function PosHubPage() {
  return (
    <AppShell>
      <div className="space-y-6">
        <PageHeader
          title="POS Management"
          description="Manajemen kasir, cabang, dan sistem Point of Sale — pilih area kerja."
          breadcrumb={[{ label: "Dashboard", href: "/dashboard" }, { label: "POS Management" }]}
          favoriteEnabled
        />

        <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
          {SECTIONS.map((s) => {
            const Icon = s.icon;
            return (
              <Link key={s.key} href={`/tenant/kasir/workspace/${s.key}`}>
                <div
                  className={`group cursor-pointer rounded-xl border p-6 transition-all hover:shadow-md hover:-translate-y-0.5 ${s.bg} ${s.border}`}
                >
                  <div className="flex items-start gap-4">
                    <div className="rounded-lg p-2.5 bg-white dark:bg-black/20 shadow-sm">
                      <Icon className={`h-6 w-6 ${s.color}`} />
                    </div>
                    <div className="flex-1 min-w-0">
                      <h2 className="font-semibold text-base leading-tight group-hover:underline">
                        {s.title}
                      </h2>
                      <p className="text-sm text-muted-foreground mt-1 leading-snug">
                        {s.description}
                      </p>
                    </div>
                  </div>
                </div>
              </Link>
            );
          })}
        </div>
      </div>
    </AppShell>
  );
}
