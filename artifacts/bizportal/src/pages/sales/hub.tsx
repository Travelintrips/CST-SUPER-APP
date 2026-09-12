import { Link } from "wouter";
import { AppShell } from "@/components/layout/AppShell";
import { PageHeader } from "@/components/layout/PageHeader";
import { TrendingUp, FileText, Globe, Bot, ChevronRight } from "lucide-react";
import { cn } from "@/lib/utils";

interface HubCard {
  icon: React.ComponentType<{ className?: string }>;
  title: string;
  desc: string;
  section: string;
  color: string;
  iconBg: string;
}

const CARDS: HubCard[] = [
  {
    icon: TrendingUp,
    title: "Sales Pipeline",
    desc: "Dashboard, pelanggan, dan manajemen pesanan penjualan",
    section: "sales-pipeline",
    color: "border-blue-500/30 hover:border-blue-500/60",
    iconBg: "bg-blue-500/10 text-blue-600",
  },
  {
    icon: FileText,
    title: "Sales Documents",
    desc: "Penawaran, faktur penjualan, item penjualan, dan dokumen",
    section: "sales-documents",
    color: "border-green-500/30 hover:border-green-500/60",
    iconBg: "bg-green-500/10 text-green-600",
  },
  {
    icon: Globe,
    title: "Digital Channels",
    desc: "Order portal, ecommerce, dan manajemen pelanggan portal",
    section: "digital-channels",
    color: "border-purple-500/30 hover:border-purple-500/60",
    iconBg: "bg-purple-500/10 text-purple-600",
  },
  {
    icon: Bot,
    title: "AI Sales Assistant",
    desc: "Draft penawaran otomatis dengan kecerdasan buatan",
    section: "ai-sales-assistant",
    color: "border-amber-500/30 hover:border-amber-500/60",
    iconBg: "bg-amber-500/10 text-amber-600",
  },
];

export default function SalesHubPage() {
  return (
    <AppShell>
      <div className="space-y-6 p-6">
        <PageHeader
          title="CRM & Sales"
          description="Pipeline, dokumen, channel digital, dan asisten AI penjualan"
          breadcrumb={[{ label: "Dashboard", href: "/dashboard" }, { label: "CRM & Sales" }]}
          favoriteEnabled
        />

        <div className="grid gap-4 sm:grid-cols-2">
          {CARDS.map((card) => {
            const Icon = card.icon;
            return (
              <Link key={card.section} href={`/sales/workspace/${card.section}`}>
                <div className={cn(
                  "group relative flex flex-col gap-3 rounded-xl border bg-card p-5 cursor-pointer transition-all duration-150 hover:shadow-md hover:-translate-y-0.5",
                  card.color,
                )}>
                  <div className="flex items-start justify-between">
                    <div className={cn("rounded-lg p-2.5", card.iconBg)}>
                      <Icon className="h-5 w-5" />
                    </div>
                    <ChevronRight className="h-4 w-4 text-muted-foreground opacity-0 group-hover:opacity-100 transition-opacity mt-1" />
                  </div>
                  <div>
                    <h3 className="font-semibold text-sm leading-tight">{card.title}</h3>
                    <p className="text-xs text-muted-foreground mt-0.5 leading-snug">{card.desc}</p>
                  </div>
                  <div className="mt-auto pt-2 border-t border-border/50">
                    <span className="text-[11px] font-medium text-primary group-hover:underline">Buka workspace →</span>
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
