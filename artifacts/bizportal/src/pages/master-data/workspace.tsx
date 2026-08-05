import { AppShell } from "@/components/layout/AppShell";
import { Link, useParams } from "wouter";
import { PageHeader } from "@/components/layout/PageHeader";
import { EmptyState } from "@/components/ui/empty-state";
import {
  Database, PackageSearch, FlaskConical, Boxes, Layers, Tags, Package,
  ChevronRight, ArrowLeft,
  Users, Building2, UserCheck, BookOpen, Wrench, Globe,
  LayoutGrid, Cpu, Ruler, FileText, ShoppingBag,
} from "lucide-react";

interface WorkspaceItem {
  label: string;
  description: string;
  href: string;
  icon: React.ElementType;
  badge?: string;
}

interface WorkspaceConfig {
  id: string;
  label: string;
  description: string;
  icon: React.ElementType;
  color: string;
  iconBg: string;
  items: WorkspaceItem[];
}

const CONFIGS: Record<string, WorkspaceConfig> = {
  "products-services": {
    id: "products-services",
    label: "Products & Services",
    description: "Data induk produk, bahan baku, recipe/BOM, dan item penjualan",
    icon: PackageSearch,
    color: "text-blue-600",
    iconBg: "bg-blue-50 border-blue-200",
    items: [
      {
        label: "Products & Services",
        description: "Semua produk, bahan baku, dan material",
        href: "/products/items",
        icon: PackageSearch,
        badge: "Core",
      },
      {
        label: "Recipe / BOM",
        description: "Bill of Materials dan formula produksi",
        href: "/products/recipes",
        icon: FlaskConical,
      },
      {
        label: "Sales Items",
        description: "Layanan dan item yang dijual ke pelanggan",
        href: "/sales/items",
        icon: ShoppingBag,
      },
    ],
  },
  "parties": {
    id: "parties",
    label: "Parties",
    description: "Data induk pelanggan, vendor/supplier, dan pelanggan portal",
    icon: Users,
    color: "text-violet-600",
    iconBg: "bg-violet-50 border-violet-200",
    items: [
      {
        label: "Customers",
        description: "Daftar pelanggan bisnis",
        href: "/sales/customers",
        icon: Users,
        badge: "Core",
      },
      {
        label: "Vendors / Suppliers",
        description: "Daftar vendor dan supplier",
        href: "/purchase/vendors",
        icon: Building2,
        badge: "Core",
      },
      {
        label: "Portal Customers",
        description: "Pelanggan terdaftar di customer portal",
        href: "/portal/customers",
        icon: UserCheck,
      },
    ],
  },
  "templates": {
    id: "templates",
    label: "Templates",
    description: "Template produk, layanan, dan dokumen standar",
    icon: BookOpen,
    color: "text-amber-600",
    iconBg: "bg-amber-50 border-amber-200",
    items: [
      {
        label: "Product Templates",
        description: "Template data induk produk",
        href: "/settings/product-templates",
        icon: BookOpen,
        badge: "Core",
      },
      {
        label: "Service Templates",
        description: "Template layanan standar",
        href: "/settings/service-templates",
        icon: Wrench,
      },
      {
        label: "Document Templates",
        description: "Template dokumen dan surat",
        href: "/settings/document-templates",
        icon: FileText,
      },
    ],
  },
  "catalog": {
    id: "catalog",
    label: "Catalog",
    description: "Katalog terpadu, vendor catalog, dan catalog engine",
    icon: Layers,
    color: "text-emerald-600",
    iconBg: "bg-emerald-50 border-emerald-200",
    items: [
      {
        label: "Katalog Terpadu",
        description: "Gabungan semua katalog produk dan layanan",
        href: "/katalog-terpadu",
        icon: LayoutGrid,
        badge: "Core",
      },
      {
        label: "Vendor Catalog",
        description: "Katalog produk dan harga per vendor",
        href: "/purchase/vendor-catalog",
        icon: Globe,
      },
      {
        label: "Vendor Catalog Engine",
        description: "Engine pencarian dan sinkronisasi katalog vendor",
        href: "/purchase/vendor-catalog-engine",
        icon: Cpu,
      },
    ],
  },
  "references": {
    id: "references",
    label: "References",
    description: "Satuan ukur, satuan pengiriman, dan referensi konfigurasi",
    icon: Tags,
    color: "text-slate-600",
    iconBg: "bg-slate-50 border-slate-200",
    items: [
      {
        label: "UoM / Satuan",
        description: "Satuan ukur yang digunakan dalam transaksi",
        href: "/settings/uom",
        icon: Ruler,
        badge: "Core",
      },
      {
        label: "Logistics Units",
        description: "Satuan khusus perhitungan biaya logistik",
        href: "/settings/logistics-units",
        icon: Package,
      },
      {
        label: "Document Templates",
        description: "Template dokumen dan formulir standar",
        href: "/settings/document-templates",
        icon: FileText,
      },
    ],
  },
};

function NotFound({ section }: { section: string }) {
  return (
    <AppShell>
      <div className="p-6 max-w-5xl mx-auto space-y-6">
        <PageHeader
          breadcrumb={[
            { label: "Dashboard", href: "/dashboard" },
            { label: "Master Data", href: "/master-data" },
          ]}
          title="Section Tidak Ditemukan"
        />
        <EmptyState
          title={`Section "${section}" tidak ditemukan`}
          description="Pilih section yang tersedia dari Master Data Hub."
          actionLabel="Kembali ke Master Data Hub"
          actionHref="/master-data"
        />
      </div>
    </AppShell>
  );
}

export default function MasterDataWorkspacePage() {
  const params = useParams<{ section: string }>();
  const section = params.section ?? "";
  const config = CONFIGS[section];

  if (!config) return <NotFound section={section} />;

  const Icon = config.icon;

  return (
    <AppShell>
      <div className="space-y-6 p-6 max-w-5xl mx-auto">

        <PageHeader
          breadcrumb={[
            { label: "Dashboard", href: "/dashboard" },
            { label: "Master Data", href: "/master-data" },
            { label: config.label },
          ]}
          title={config.label}
          description={config.description}
          actions={
            <Link href="/master-data">
              <button className="rounded-md p-1.5 hover:bg-accent transition-colors" aria-label="Kembali ke Master Data">
                <ArrowLeft className="h-4 w-4" />
              </button>
            </Link>
          }
        />

        {/* Item Grid */}
        {config.items.length === 0 ? (
          <EmptyState title="Tidak ada item" description="Belum ada item pada section ini." />
        ) : (
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {config.items.map((item) => {
            const ItemIcon = item.icon;
            return (
              <Link key={item.href + item.label} href={item.href}>
                <div className="group relative flex flex-col gap-2 rounded-xl border bg-card p-4 cursor-pointer transition-all duration-150 hover:shadow-md hover:-translate-y-0.5 hover:border-primary/40 h-full">
                  <div className="flex items-start justify-between">
                    <div className={`rounded-lg border p-2 ${config.iconBg}`}>
                      <ItemIcon className={`h-4 w-4 ${config.color}`} />
                    </div>
                    <div className="flex items-center gap-1.5">
                      {item.badge && (
                        <span className="text-[10px] font-semibold px-1.5 py-0.5 rounded-full bg-primary/10 text-primary border border-primary/20">
                          {item.badge}
                        </span>
                      )}
                      <ChevronRight className="h-3.5 w-3.5 text-muted-foreground opacity-0 group-hover:opacity-100 transition-opacity" />
                    </div>
                  </div>
                  <div className="mt-1">
                    <p className="text-sm font-semibold leading-tight">{item.label}</p>
                    <p className="text-xs text-muted-foreground mt-0.5 leading-snug">{item.description}</p>
                  </div>
                  <div className="mt-auto pt-2 border-t border-border/50">
                    <span className="text-[11px] font-medium text-primary group-hover:underline">Buka →</span>
                  </div>
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
