import { AppShell } from "@/components/layout/AppShell";
import { Link, useParams } from "wouter";
import { PageHeader } from "@/components/layout/PageHeader";
import { EmptyState } from "@/components/ui/empty-state";
import {
  Truck, Plane, Anchor, FileText, Car, PackageCheck,
  ChevronRight, ArrowLeft,
  Package, MapPin, ClipboardList, BarChart2, Users,
  DollarSign, ListChecks, Radio, Gauge, AlertTriangle,
  Settings, BookOpen, Star, Brain, Layers, Shield,
  Navigation, Banknote, Activity, TrendingUp,
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
  "freight-forwarding": {
    id: "freight-forwarding",
    label: "Freight Forwarding",
    description: "Manajemen pengiriman darat dan ekspedisi — shipment, trucking, portal, RFQ, driver, dan rate",
    icon: Truck,
    color: "text-blue-600",
    iconBg: "bg-blue-50 border-blue-200",
    items: [
      {
        label: "All Shipments",
        description: "Seluruh shipment freight forwarding",
        href: "/logistics/freight",
        icon: Package,
        badge: "Core",
      },
      {
        label: "Trucking Orders",
        description: "Pesanan trucking darat",
        href: "/logistics/trucking-orders",
        icon: Truck,
        badge: "Core",
      },
      {
        label: "Portal Orders",
        description: "Order masuk dari customer portal",
        href: "/logistics/portal-orders",
        icon: ClipboardList,
      },
      {
        label: "RFQ & Quotes",
        description: "Request for Quotation dan penawaran vendor",
        href: "/logistics/rfq",
        icon: FileText,
      },
      {
        label: "Drivers",
        description: "Manajemen driver dan analitik performa",
        href: "/logistics/drivers",
        icon: Users,
      },
      {
        label: "Rates & Margins",
        description: "Rate management dan aturan margin",
        href: "/logistics/rate-management",
        icon: DollarSign,
      },
      {
        label: "Internal Tasks",
        description: "Tugas internal tim logistik",
        href: "/logistics/internal-tasks",
        icon: ListChecks,
      },
    ],
  },
  "air-freight": {
    id: "air-freight",
    label: "Air Freight",
    description: "Pengiriman udara domestik dan internasional — orders, tracking, dan RFQ",
    icon: Plane,
    color: "text-sky-600",
    iconBg: "bg-sky-50 border-sky-200",
    items: [
      {
        label: "Orders",
        description: "Semua air freight order",
        href: "/air-freight/orders",
        icon: Package,
        badge: "Core",
      },
      {
        label: "RFQ",
        description: "Request for Quotation air freight",
        href: "/logistics/rfq",
        icon: FileText,
      },
      {
        label: "Tracking",
        description: "Lacak status pengiriman udara via order detail",
        href: "/air-freight/orders",
        icon: MapPin,
      },
    ],
  },
  "ocean-freight": {
    id: "ocean-freight",
    label: "Ocean Freight",
    description: "Pengiriman laut FCL dan LCL — orders dan rate management",
    icon: Anchor,
    color: "text-cyan-600",
    iconBg: "bg-cyan-50 border-cyan-200",
    items: [
      {
        label: "Orders",
        description: "Semua ocean freight order",
        href: "/logistics/ocean-freight-orders",
        icon: Package,
        badge: "Core",
      },
      {
        label: "Rates",
        description: "Tarif pengiriman laut",
        href: "/logistics/ocean-freight-rates",
        icon: DollarSign,
      },
    ],
  },
  "ppjk": {
    id: "ppjk",
    label: "PPJK / Customs",
    description: "Pengurusan kepabeanan, dokumen impor/ekspor, dan clearance",
    icon: Shield,
    color: "text-amber-600",
    iconBg: "bg-amber-50 border-amber-200",
    items: [
      {
        label: "Customs Cases",
        description: "Daftar kasus kepabeanan aktif",
        href: "/logistics/ppjk",
        icon: FileText,
        badge: "Core",
      },
      {
        label: "Documents",
        description: "PIB, PEB, dan dokumen bea cukai",
        href: "/logistics/ppjk",
        icon: ClipboardList,
      },
    ],
  },
  "fleet-intelligence": {
    id: "fleet-intelligence",
    label: "Fleet Intelligence",
    description: "Pemantauan armada dan analitik driver real-time — dashboard, transaksi, alerts, dan akuntansi",
    icon: Car,
    color: "text-purple-600",
    iconBg: "bg-purple-50 border-purple-200",
    items: [
      {
        label: "Dashboard",
        description: "Ringkasan performa armada",
        href: "/logistics/fleet-intelligence",
        icon: Gauge,
        badge: "Core",
      },
      {
        label: "Drivers",
        description: "Manajemen driver armada",
        href: "/logistics/fleet-intelligence/drivers",
        icon: Users,
      },
      {
        label: "Vehicles",
        description: "Inventaris kendaraan",
        href: "/logistics/fleet-intelligence/vehicles",
        icon: Truck,
      },
      {
        label: "Transactions",
        description: "Transaksi keuangan armada",
        href: "/logistics/fleet-intelligence/transactions",
        icon: Banknote,
      },
      {
        label: "Outstanding",
        description: "Tagihan dan saldo outstanding",
        href: "/logistics/fleet-intelligence/outstanding",
        icon: Activity,
      },
      {
        label: "Alerts",
        description: "Peringatan dan anomali armada",
        href: "/logistics/fleet-intelligence/alerts",
        icon: AlertTriangle,
      },
      {
        label: "Control Center",
        description: "Pusat kontrol operasional armada",
        href: "/logistics/fleet-intelligence/control-center",
        icon: Radio,
      },
      {
        label: "Accounting",
        description: "Rekonsiliasi dan akuntansi armada",
        href: "/logistics/fleet-intelligence/accounting",
        icon: BookOpen,
      },
    ],
  },
  "vendor-fulfillment": {
    id: "vendor-fulfillment",
    label: "Vendor Fulfillment",
    description: "Performa vendor, pemenuhan orderan, dan analitik komoditas",
    icon: PackageCheck,
    color: "text-green-600",
    iconBg: "bg-green-50 border-green-200",
    items: [
      {
        label: "Fulfillments",
        description: "Semua vendor fulfillment order",
        href: "/logistics/vendor-fulfillments",
        icon: PackageCheck,
        badge: "Core",
      },
      {
        label: "Vendor Performance",
        description: "Analitik performa vendor",
        href: "/logistics/vendor-performance",
        icon: BarChart2,
      },
      {
        label: "Vendor Leaderboard",
        description: "Ranking vendor berdasarkan performa",
        href: "/vendors",
        icon: Star,
      },
      {
        label: "Vendor Recommendation",
        description: "Rekomendasi vendor berbasis AI",
        href: "/logistics/vendor-recommendation",
        icon: Brain,
      },
      {
        label: "Vendor × Commodity",
        description: "Analitik vendor per komoditas",
        href: "/logistics/vendor-commodity-intelligence",
        icon: Layers,
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
            { label: "Logistics", href: "/logistics" },
          ]}
          title="Section Tidak Ditemukan"
        />
        <EmptyState
          title={`Section "${section}" tidak ditemukan`}
          description="Pilih section yang tersedia dari Logistics Hub."
          actionLabel="Kembali ke Logistics Hub"
          actionHref="/logistics"
        />
      </div>
    </AppShell>
  );
}

export default function LogisticsWorkspacePage() {
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
            { label: "Logistics", href: "/logistics" },
            { label: config.label },
          ]}
          title={config.label}
          description={config.description}
          actions={
            <Link href="/logistics">
              <button className="rounded-md p-1.5 hover:bg-accent transition-colors" aria-label="Kembali ke Logistics">
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
