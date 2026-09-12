import { AppShell } from "@/components/layout/AppShell";
import { PageHeader } from "@/components/layout/PageHeader";
import { Link } from "wouter";
import { ChevronRight, Home, Truck, Plane, Anchor, Shield, Car, PackageCheck, Bot } from "lucide-react";
import { cn } from "@/lib/utils";

interface SubModule {
  icon: React.ComponentType<{ className?: string }>;
  title: string;
  desc: string;
  features: string[];
  section: string;
  color: string;
  iconBg: string;
  href?: string;
}

const SUBMODULES: SubModule[] = [
  {
    icon: Truck,
    title: "Freight Forwarding",
    desc: "Manajemen pengiriman darat dan ekspedisi",
    features: ["Semua Shipment", "Trucking Orders", "Portal Orders", "RFQ & Quote", "Driver Management", "Rate & Margin", "Internal Tasks"],
    section: "freight-forwarding",
    color: "border-blue-500/30 hover:border-blue-500/60",
    iconBg: "bg-blue-500/10 text-blue-600",
  },
  {
    icon: Plane,
    title: "Air Freight",
    desc: "Pengiriman udara domestik dan internasional",
    features: ["Air Orders", "Air Tracking", "Air RFQ"],
    section: "air-freight",
    color: "border-sky-500/30 hover:border-sky-500/60",
    iconBg: "bg-sky-500/10 text-sky-600",
  },
  {
    icon: Anchor,
    title: "Ocean Freight",
    desc: "Pengiriman laut FCL dan LCL",
    features: ["Ocean Orders", "Ocean Rates"],
    section: "ocean-freight",
    color: "border-cyan-500/30 hover:border-cyan-500/60",
    iconBg: "bg-cyan-500/10 text-cyan-600",
  },
  {
    icon: Shield,
    title: "PPJK / Customs",
    desc: "Pengurusan kepabeanan dan dokumen impor/ekspor",
    features: ["Customs Cases", "Dokumen Bea Cukai"],
    section: "ppjk",
    color: "border-amber-500/30 hover:border-amber-500/60",
    iconBg: "bg-amber-500/10 text-amber-600",
  },
  {
    icon: Car,
    title: "Fleet Intelligence",
    desc: "Pemantauan armada dan analitik driver real-time",
    features: ["Dashboard", "Drivers & Vehicles", "Transactions", "Alerts", "Control Center", "Accounting"],
    section: "fleet-intelligence",
    color: "border-purple-500/30 hover:border-purple-500/60",
    iconBg: "bg-purple-500/10 text-purple-600",
  },
  {
    icon: PackageCheck,
    title: "Vendor Fulfillment",
    desc: "Performa vendor dan pemenuhan orderan",
    features: ["Fulfillments", "Vendor Performance", "Leaderboard", "Recommendations", "Vendor × Komoditas"],
    section: "vendor-fulfillment",
    color: "border-green-500/30 hover:border-green-500/60",
    iconBg: "bg-green-500/10 text-green-600",
  },
  {
    icon: Bot,
    title: "Import Assistant",
    desc: "Asisten AI untuk pengurusan dokumen impor dan kepabeanan",
    features: ["Analisis dokumen impor", "Estimasi biaya & bea", "HS Code lookup", "Checklist kepabeanan", "Chat interaktif"],
    section: "import-assistant",
    href: "/logistics/import-assistant",
    color: "border-rose-500/30 hover:border-rose-500/60",
    iconBg: "bg-rose-500/10 text-rose-600",
  },
];

const AI_MODULES = [
  {
    icon: Bot,
    title: "Import Assistant",
    desc: "AI advisor impor dari China — tarif BTKI 2022, LARTAS, dan kalkulasi landed cost",
    features: ["HS Code lookup", "Tarif BM / ACFTA", "LARTAS & perizinan", "Kalkulasi landed cost", "Rekomendasi vendor"],
    href: "/logistics/import-assistant",
    color: "border-emerald-500/30 hover:border-emerald-500/60",
    iconBg: "bg-emerald-500/10 text-emerald-600",
  },
];

export default function LogisticsHubPage() {
  return (
    <AppShell>
      <div className="space-y-6 p-6">
        <PageHeader
          title="Logistics"
          description="Manajemen pengiriman lengkap — darat, udara, laut, dan kepabeanan"
          breadcrumb={[{ label: "Dashboard", href: "/dashboard" }, { label: "Logistics" }]}
          favoriteEnabled
        />

        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {SUBMODULES.map((mod) => {
            const Icon = mod.icon;
            return (
              <Link key={mod.section} href={mod.href ?? `/logistics/workspace/${mod.section}`}>
                <div className={cn(
                  "group relative flex flex-col gap-3 rounded-xl border bg-card p-5 cursor-pointer transition-all duration-150 hover:shadow-md hover:-translate-y-0.5",
                  mod.color,
                )}>
                  <div className="flex items-start justify-between">
                    <div className={cn("rounded-lg p-2.5", mod.iconBg)}>
                      <Icon className="h-5 w-5" />
                    </div>
                    <ChevronRight className="h-4 w-4 text-muted-foreground opacity-0 group-hover:opacity-100 transition-opacity mt-1" />
                  </div>
                  <div>
                    <h3 className="font-semibold text-sm leading-tight">{mod.title}</h3>
                    <p className="text-xs text-muted-foreground mt-0.5 leading-snug">{mod.desc}</p>
                  </div>
                  <ul className="space-y-0.5">
                    {mod.features.map((f) => (
                      <li key={f} className="text-[11px] text-muted-foreground flex items-center gap-1.5">
                        <span className="h-1 w-1 rounded-full bg-muted-foreground/50 shrink-0" />
                        {f}
                      </li>
                    ))}
                  </ul>
                  <div className="mt-auto pt-2 border-t border-border/50">
                    <span className="text-[11px] font-medium text-primary group-hover:underline">Buka workspace →</span>
                  </div>
                </div>
              </Link>
            );
          })}
        </div>

        {/* AI Tools */}
        <div>
          <h2 className="text-sm font-semibold text-muted-foreground mb-3 flex items-center gap-2">
            <Bot className="h-4 w-4" /> AI Tools
          </h2>
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {AI_MODULES.map((mod) => {
              const Icon = mod.icon;
              return (
                <Link key={mod.href} href={mod.href}>
                  <div className={cn(
                    "group relative flex flex-col gap-3 rounded-xl border bg-card p-5 cursor-pointer transition-all duration-150 hover:shadow-md hover:-translate-y-0.5",
                    mod.color,
                  )}>
                    <div className="flex items-start justify-between">
                      <div className={cn("rounded-lg p-2.5", mod.iconBg)}>
                        <Icon className="h-5 w-5" />
                      </div>
                      <ChevronRight className="h-4 w-4 text-muted-foreground opacity-0 group-hover:opacity-100 transition-opacity mt-1" />
                    </div>
                    <div>
                      <h3 className="font-semibold text-sm leading-tight">{mod.title}</h3>
                      <p className="text-xs text-muted-foreground mt-0.5 leading-snug">{mod.desc}</p>
                    </div>
                    <ul className="space-y-0.5">
                      {mod.features.map((f) => (
                        <li key={f} className="text-[11px] text-muted-foreground flex items-center gap-1.5">
                          <span className="h-1 w-1 rounded-full bg-muted-foreground/50 shrink-0" />
                          {f}
                        </li>
                      ))}
                    </ul>
                    <div className="mt-auto pt-2 border-t border-border/50">
                      <span className="text-[11px] font-medium text-emerald-600 group-hover:underline">Buka →</span>
                    </div>
                  </div>
                </Link>
              );
            })}
          </div>
        </div>
      </div>
    </AppShell>
  );
}
