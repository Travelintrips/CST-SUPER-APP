import { AppShell } from "@/components/layout/AppShell";
import { ModuleHub } from "@/components/layout/ModuleHub";
import { PageHeader } from "@/components/layout/PageHeader";
import {
  BarChart2, TrendingUp, ShoppingBag, PackageSearch,
  Receipt, FileText, Shield, ShieldCheck, AlertTriangle,
  Activity, GitMerge, BookOpen, Wallet, FileSpreadsheet,
  DollarSign, LayoutDashboard,
} from "lucide-react";

export default function ReportsIndexPage() {
  return (
    <AppShell>
      <PageHeader
        title="Reports & Analytics"
        description="Laporan operasional, keuangan, audit, dan analitik bisnis"
        breadcrumb={[{ label: "Dashboard", href: "/dashboard" }, { label: "Reports & Analytics" }]}
        favoriteEnabled
      />
      <ModuleHub
        showHeader={false}
        moduleIcon={BarChart2}
        moduleName="Reports & Analytics"
        moduleDesc="Laporan operasional, keuangan, audit, dan analitik bisnis"
        sections={[
          {
            label: "Operational Reports",
            cards: [
              {
                href: "/reports/sales",
                icon: TrendingUp,
                title: "Laporan Penjualan",
                desc: "Analisis omzet, pelanggan teratas, dan produk terlaris",
                accent: "bg-blue-500/10 text-blue-600 group-hover:bg-blue-500/20",
              },
              {
                href: "/reports/purchase",
                icon: ShoppingBag,
                title: "Laporan Pembelian",
                desc: "Analisis pengeluaran, vendor teratas, dan frekuensi pembelian",
              },
              {
                href: "/reports/inventory-valuation",
                icon: PackageSearch,
                title: "Valuasi Persediaan",
                desc: "Nilai stok per gudang berdasarkan harga pokok",
              },
              {
                href: "/reports/ar-aging",
                icon: Receipt,
                title: "AR Aging",
                desc: "Umur piutang pelanggan per kategori jatuh tempo",
              },
              {
                href: "/reports/ap-aging",
                icon: FileText,
                title: "AP Aging",
                desc: "Umur hutang ke vendor per kategori jatuh tempo",
              },
              {
                href: "/logistics/profitability",
                icon: TrendingUp,
                title: "Profitabilitas Logistik",
                desc: "Margin dan analisis profit per shipment",
              },
            ],
          },
          {
            label: "Financial Reports",
            cards: [
              {
                href: "/accounting/reports/trial-balance",
                icon: FileSpreadsheet,
                title: "Neraca Percobaan",
                desc: "Trial balance semua akun",
                accent: "bg-green-500/10 text-green-600 group-hover:bg-green-500/20",
              },
              {
                href: "/accounting/reports/profit-loss",
                icon: TrendingUp,
                title: "Laba Rugi",
                desc: "Laporan profit & loss periode berjalan",
              },
              {
                href: "/accounting/reports/balance-sheet",
                icon: Wallet,
                title: "Neraca",
                desc: "Balance sheet perusahaan",
              },
              {
                href: "/accounting/reports/general-ledger",
                icon: BookOpen,
                title: "Buku Besar",
                desc: "General ledger semua transaksi",
              },
              {
                href: "/accounting/reports/freight-profitability",
                icon: LayoutDashboard,
                title: "Freight Profitability",
                desc: "Laporan laba rugi freight forwarding",
              },
              {
                href: "/expense/reports",
                icon: DollarSign,
                title: "Laporan Expense",
                desc: "Analisis dan laporan biaya operasional",
              },
            ],
          },
          {
            label: "Audit & Compliance",
            cards: [
              {
                href: "/reports/audit-log",
                icon: Shield,
                title: "Audit Log Keamanan",
                desc: "Riwayat aktivitas dan perubahan data sistem",
                accent: "bg-amber-500/10 text-amber-600 group-hover:bg-amber-500/20",
              },
              {
                href: "/accounting/audit-report",
                icon: AlertTriangle,
                title: "Audit Akuntansi",
                desc: "Laporan temuan dan audit trail akuntansi",
              },
              {
                href: "/accounting/period-closing",
                icon: ShieldCheck,
                title: "Status Closing Periode",
                desc: "Kelola open/closed periode — snapshot SHA256",
              },
              {
                href: "/accounting/wht-reconciliation",
                icon: GitMerge,
                title: "Rekonsiliasi WHT",
                desc: "Cocokkan hutang withholding tax",
              },
              {
                href: "/tax/missing-compliance",
                icon: Shield,
                title: "Kepatuhan Pajak",
                desc: "Transaksi yang belum memenuhi compliance pajak",
              },
            ],
          },
          {
            label: "Analytics",
            cards: [
              {
                href: "/vendors",
                icon: Activity,
                title: "Vendor Performance",
                desc: "Evaluasi performa vendor berdasarkan data transaksi",
                accent: "bg-purple-500/10 text-purple-600 group-hover:bg-purple-500/20",
              },
              {
                href: "/vendors",
                icon: TrendingUp,
                title: "Vendor Leaderboard",
                desc: "Peringkat vendor berdasarkan performa",
              },
              {
                href: "/analytics",
                icon: BarChart2,
                title: "Advanced Analytics",
                desc: "Analitik mendalam dengan filter dan drill-down",
              },
            ],
          },
        ]}
      />
    </AppShell>
  );
}
