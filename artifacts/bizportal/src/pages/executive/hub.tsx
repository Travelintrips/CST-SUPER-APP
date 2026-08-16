import { Link } from "wouter";
import { AppShell } from "@/components/layout/AppShell";
import { Trophy, Building2, BarChart3, Truck } from "lucide-react";

const SECTIONS = [
  {
    key: "executive-overview",
    title: "Executive Overview",
    description: "Dashboard eksekutif, ringkasan konsolidasi keuangan, dan persetujuan pending.",
    icon: Trophy,
    color: "text-amber-600",
    bg: "bg-amber-50 dark:bg-amber-950",
    border: "border-amber-200 dark:border-amber-800",
  },
  {
    key: "holding-group",
    title: "Holding Group",
    description: "Dashboard holding, P&L konsolidasi, arus kas, dan laporan grup.",
    icon: Building2,
    color: "text-blue-600",
    bg: "bg-blue-50 dark:bg-blue-950",
    border: "border-blue-200 dark:border-blue-800",
  },
  {
    key: "analytics",
    title: "Analytics",
    description: "Dashboard analitik, profitabilitas komoditi, dan profitabilitas rute.",
    icon: BarChart3,
    color: "text-green-600",
    bg: "bg-green-50 dark:bg-green-950",
    border: "border-green-200 dark:border-green-800",
  },
  {
    key: "executive-logistics",
    title: "Executive Logistics",
    description: "Dashboard logistik, profitabilitas, dan fleet intelligence untuk manajemen.",
    icon: Truck,
    color: "text-purple-600",
    bg: "bg-purple-50 dark:bg-purple-950/30",
    border: "border-purple-200 dark:border-purple-800",
  },
];

export default function ExecutiveHubPage() {
  return (
    <AppShell>
      <div className="flex flex-col gap-6">
        <div>
          <nav className="text-xs text-muted-foreground mb-1">
            <Link href="/" className="hover:underline">Dashboard</Link>
            <span className="mx-1">/</span>
            <span>Executive</span>
          </nav>
          <div className="flex items-center gap-3">
            <div className="rounded-lg p-2 bg-amber-50 dark:bg-amber-950 border border-amber-200 dark:border-amber-800">
              <Trophy className="h-5 w-5 text-amber-600" />
            </div>
            <div>
              <h1 className="text-2xl font-bold tracking-tight">Executive</h1>
              <p className="text-sm text-muted-foreground mt-0.5">
                Dashboard konsolidasi, analitik holding, dan wawasan strategis.
              </p>
            </div>
          </div>
        </div>

        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          {SECTIONS.map((s) => {
            const Icon = s.icon;
            return (
              <Link key={s.key} href={`/executive/workspace/${s.key}`}>
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
          <Link href="/executive/overview" className="text-sm text-muted-foreground hover:text-foreground hover:underline">
            → Buka Executive Dashboard
          </Link>
        </div>
      </div>
    </AppShell>
  );
}
