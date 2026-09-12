import { Link } from "wouter";
import { AppShell } from "@/components/layout/AppShell";
import { PageHeader } from "@/components/layout/PageHeader";
import { Users, Building2, Banknote, Trophy, ChevronLeft } from "lucide-react";

const SECTIONS = [
  {
    key: "tenant-management",
    title: "Tenant Management",
    description: "Data tenant, booking, rekap, dan audit log penyewa.",
    icon: Users,
    color: "text-blue-600",
    bg: "bg-blue-50 dark:bg-blue-950",
    border: "border-blue-200 dark:border-blue-800",
  },
  {
    key: "property-operations",
    title: "Property Operations",
    description: "Mall units, unit kantin, perbandingan lokasi, dan pengaturan properti.",
    icon: Building2,
    color: "text-purple-600",
    bg: "bg-purple-50 dark:bg-purple-950/30",
    border: "border-purple-200 dark:border-purple-800",
  },
  {
    key: "billing-finance",
    title: "Billing & Finance",
    description: "Invoice, pembayaran sewa, laporan keuangan, dan rekonsiliasi tenant.",
    icon: Banknote,
    color: "text-green-600",
    bg: "bg-green-50 dark:bg-green-950",
    border: "border-green-200 dark:border-green-800",
  },
  {
    key: "sport-center",
    title: "Sport Center",
    description: "Booking lapangan, members, fasilitas, pembayaran, dan laporan SC.",
    icon: Trophy,
    color: "text-orange-600",
    bg: "bg-orange-50 dark:bg-orange-950",
    border: "border-orange-200 dark:border-orange-800",
  },
];

export default function TenantHubPage() {
  return (
    <AppShell>
      <div className="space-y-6">
        <button onClick={() => window.history.back()} className="mb-1 inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground transition-colors"><ChevronLeft className="h-4 w-4" />Kembali</button>
        <PageHeader
          title="Tenant & Property"
          description="Pusat manajemen properti & sport center — pilih area kerja."
          breadcrumb={[{ label: "Dashboard", href: "/dashboard" }, { label: "Tenant & Property" }]}
          favoriteEnabled
        />

        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          {SECTIONS.map((s) => {
            const Icon = s.icon;
            return (
              <Link key={s.key} href={`/tenant/workspace/${s.key}`}>
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

        <div className="pt-2 border-t">
          <Link href="/tenant/dashboard" className="text-sm text-muted-foreground hover:text-foreground hover:underline">
            → Buka Tenant Dashboard (ringkasan statistik)
          </Link>
        </div>
      </div>
    </AppShell>
  );
}
