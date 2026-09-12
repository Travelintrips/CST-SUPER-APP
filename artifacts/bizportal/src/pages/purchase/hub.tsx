import { Link } from "wouter";
import { AppShell } from "@/components/layout/AppShell";
import {
  ShoppingCart,
  Users,
  FileText,
  Package,
  BarChart3,
} from "lucide-react";

const SECTIONS = [
  {
    key: "purchase-flow",
    title: "Purchase Flow",
    description: "PR, RFQ, Purchase Order, Goods Receipt, QC, dan Return pembelian.",
    icon: ShoppingCart,
    color: "text-blue-600",
    bg: "bg-blue-50 dark:bg-blue-950",
    border: "border-blue-200 dark:border-blue-800",
  },
  {
    key: "vendor-management",
    title: "Vendor Management",
    description: "Kelola supplier, vendor form, katalog, dan pricing trucking.",
    icon: Users,
    color: "text-purple-600",
    bg: "bg-purple-50 dark:bg-purple-950/30",
    border: "border-purple-200 dark:border-purple-800",
  },
  {
    key: "invoices-docs",
    title: "Invoice & Dokumen",
    description: "Invoice vendor, payment request, dan bills tagihan pembelian.",
    icon: FileText,
    color: "text-green-600",
    bg: "bg-green-50 dark:bg-green-950",
    border: "border-green-200 dark:border-green-800",
  },
  {
    key: "landed-cost",
    title: "Landed Cost",
    description: "Alokasi biaya pengiriman dan penerimaan inventory.",
    icon: Package,
    color: "text-orange-600",
    bg: "bg-orange-50 dark:bg-orange-950",
    border: "border-orange-200 dark:border-orange-800",
  },
  {
    key: "procurement-analytics",
    title: "Procurement Analytics",
    description: "Analitik marketplace, performa vendor, dan laporan pengadaan.",
    icon: BarChart3,
    color: "text-rose-600",
    bg: "bg-rose-50 dark:bg-rose-950/30",
    border: "border-rose-200 dark:border-rose-800",
  },
];

export default function PurchaseHubPage() {
  return (
    <AppShell>
      <div className="flex flex-col gap-6">
        <div>
          <nav className="text-xs text-muted-foreground mb-1">
            <Link href="/" className="hover:underline">Dashboard</Link>
            <span className="mx-1">/</span>
            <span>Procurement</span>
          </nav>
          <h1 className="text-2xl font-bold tracking-tight">Procurement</h1>
          <p className="text-sm text-muted-foreground mt-1">
            Pusat pengadaan — pilih area kerja.
          </p>
        </div>

        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {SECTIONS.map((s) => {
            const Icon = s.icon;
            return (
              <Link key={s.key} href={`/purchase/workspace/${s.key}`}>
                <div
                  className={`group cursor-pointer rounded-xl border p-6 transition-all hover:shadow-md hover:-translate-y-0.5 ${s.bg} ${s.border}`}
                >
                  <div className="flex items-start gap-4">
                    <div className={`rounded-lg p-2.5 bg-white dark:bg-black/20 shadow-sm`}>
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
          <Link href="/purchase/dashboard" className="text-sm text-muted-foreground hover:text-foreground hover:underline">
            → Buka Purchase Dashboard (ringkasan statistik)
          </Link>
        </div>
      </div>
    </AppShell>
  );
}
