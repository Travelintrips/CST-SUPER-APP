import { AppShell } from "@/components/layout/AppShell";
import { PageHeader } from "@/components/layout/PageHeader";
import { Link } from "wouter";
import {
  Database, PackageSearch, Users, BookOpen, Layers, Tags,
  ChevronRight, Home,
} from "lucide-react";
import { cn } from "@/lib/utils";

interface HubCard {
  icon: React.ComponentType<{ className?: string }>;
  title: string;
  desc: string;
  features: string[];
  section: string;
  color: string;
  iconBg: string;
}

const CARDS: HubCard[] = [
  {
    icon: PackageSearch,
    title: "Products & Services",
    desc: "Data induk produk, bahan baku, recipe/BOM, dan item penjualan",
    features: ["Products & Services", "Recipe / BOM", "Sales Items"],
    section: "products-services",
    color: "border-blue-500/30 hover:border-blue-500/60",
    iconBg: "bg-blue-500/10 text-blue-600",
  },
  {
    icon: Users,
    title: "Parties",
    desc: "Pelanggan, vendor/supplier, dan pelanggan portal",
    features: ["Customers", "Vendors / Suppliers", "Portal Customers"],
    section: "parties",
    color: "border-violet-500/30 hover:border-violet-500/60",
    iconBg: "bg-violet-500/10 text-violet-600",
  },
  {
    icon: BookOpen,
    title: "Templates",
    desc: "Template produk, layanan, dan dokumen standar",
    features: ["Product Templates", "Service Templates", "Document Templates"],
    section: "templates",
    color: "border-amber-500/30 hover:border-amber-500/60",
    iconBg: "bg-amber-500/10 text-amber-600",
  },
  {
    icon: Layers,
    title: "Catalog",
    desc: "Katalog terpadu, vendor catalog, dan catalog engine",
    features: ["Katalog Terpadu", "Vendor Catalog", "Vendor Catalog Engine"],
    section: "catalog",
    color: "border-emerald-500/30 hover:border-emerald-500/60",
    iconBg: "bg-emerald-500/10 text-emerald-600",
  },
  {
    icon: Tags,
    title: "References",
    desc: "Satuan ukur, satuan pengiriman, dan referensi konfigurasi",
    features: ["UoM / Satuan", "Logistics Units", "Document Templates"],
    section: "references",
    color: "border-slate-500/30 hover:border-slate-500/60",
    iconBg: "bg-slate-500/10 text-slate-600",
  },
];

export default function MasterDataHubPage() {
  return (
    <AppShell>
      <div className="space-y-6 p-6">
        <PageHeader
          title="Master Data"
          description="Data induk produk, pihak, katalog, template, dan referensi"
          breadcrumb={[{ label: "Dashboard", href: "/dashboard" }, { label: "Master Data" }]}
          favoriteEnabled
        />

        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {CARDS.map((card) => {
            const Icon = card.icon;
            return (
              <Link key={card.section} href={`/master-data/workspace/${card.section}`}>
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
                  <ul className="space-y-0.5">
                    {card.features.map((f) => (
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
      </div>
    </AppShell>
  );
}
