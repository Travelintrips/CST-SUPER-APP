import { AppShell } from "@/components/layout/AppShell";
import { Link, useParams } from "wouter";
import {
  FileText, BookOpen, ArrowLeftRight, Landmark, Receipt,
  Package, TrendingUp, ChevronRight, ArrowLeft, BarChart2,
  PieChart, Scale, GitMerge, Upload, Banknote, LayoutDashboard,
  FileSpreadsheet, CircleDollarSign, Clock, Layers, Trash2, Users, Building2,
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
  accent: string;
  accentLight: string;
  items: WorkspaceItem[];
}

const CONFIGS: Record<string, WorkspaceConfig> = {
  "financial-statements": {
    id: "financial-statements",
    label: "Financial Statements",
    description: "Laporan keuangan utama — Profit & Loss, Neraca, Arus Kas, dan Neraca Percobaan",
    icon: FileText,
    accent: "text-blue-700",
    accentLight: "bg-blue-50 text-blue-700",
    items: [
      {
        label: "Profit & Loss",
        description: "Laporan laba rugi dengan analisis periode",
        href: "/accounting/reports/profit-loss",
        icon: TrendingUp,
        badge: "Core",
      },
      {
        label: "Balance Sheet",
        description: "Neraca — aset, liabilitas, dan ekuitas",
        href: "/accounting/reports/balance-sheet",
        icon: Scale,
        badge: "Core",
      },
      {
        label: "Cash Flow",
        description: "Laporan arus kas operasi, investasi, pendanaan",
        href: "/accounting/reports/cash-flow",
        icon: ArrowLeftRight,
        badge: "Core",
      },
      {
        label: "Trial Balance",
        description: "Neraca percobaan semua akun",
        href: "/accounting/reports/trial-balance",
        icon: BarChart2,
        badge: "Core",
      },
    ],
  },
  "general-ledger": {
    id: "general-ledger",
    label: "General Ledger",
    description: "Buku besar, entri jurnal, closing, dan sub-ledger",
    icon: BookOpen,
    accent: "text-indigo-700",
    accentLight: "bg-indigo-50 text-indigo-700",
    items: [
      {
        label: "General Ledger",
        description: "Buku besar semua akun",
        href: "/accounting/reports/general-ledger",
        icon: BookOpen,
        badge: "Core",
      },
      {
        label: "Journal Entries",
        description: "Buat dan kelola entri jurnal",
        href: "/accounting/entries",
        icon: FileText,
      },
      {
        label: "Closing Wizard",
        description: "Month-end closing wizard dengan checklist",
        href: "/accounting/closing-wizard",
        icon: Clock,
      },
      {
        label: "Closing Entries",
        description: "Penutupan periode akuntansi",
        href: "/accounting/closing-entries",
        icon: Clock,
      },
      {
        label: "Sub Ledger",
        description: "Ledger detail per akun",
        href: "/accounting/journal-items",
        icon: Layers,
      },
      {
        label: "Periode Penutupan",
        description: "Status dan kontrol penutupan periode",
        href: "/accounting/period-closing",
        icon: LayoutDashboard,
      },
      {
        label: "Ledger Immutability",
        description: "Audit trail dan proteksi jurnal",
        href: "/accounting/ledger",
        icon: GitMerge,
      },
    ],
  },
  "ar-ap": {
    id: "ar-ap",
    label: "AR / AP",
    description: "Piutang usaha, hutang usaha, dan outstanding invoices",
    icon: ArrowLeftRight,
    accent: "text-violet-700",
    accentLight: "bg-violet-50 text-violet-700",
    items: [
      {
        label: "AR Aging",
        description: "Umur piutang per customer",
        href: "/reports/ar-aging",
        icon: Users,
        badge: "Core",
      },
      {
        label: "AP Aging",
        description: "Umur hutang per vendor",
        href: "/reports/ap-aging",
        icon: Building2,
        badge: "Core",
      },
      {
        label: "Outstanding Invoices",
        description: "Faktur yang belum lunas",
        href: "/accounting/payments",
        icon: CircleDollarSign,
      },
      {
        label: "Rekonsiliasi Keuangan",
        description: "Rekonsiliasi saldo AR/AP",
        href: "/accounting/financial-reconciliation",
        icon: GitMerge,
      },
    ],
  },
  "cash-bank": {
    id: "cash-bank",
    label: "Cash & Bank",
    description: "Rekonsiliasi bank, import mutasi, dan manajemen kas",
    icon: Landmark,
    accent: "text-emerald-700",
    accentLight: "bg-emerald-50 text-emerald-700",
    items: [
      {
        label: "Treasury Dashboard",
        description: "Ringkasan kas, outstanding, dan disbursement",
        href: "/accounting/bank-disbursements",
        icon: Banknote,
        badge: "New",
      },
      {
        label: "Cash Flow Forecast",
        description: "Proyeksi arus kas 7 / 30 / 90 hari ke depan",
        href: "/accounting/cash-flow-forecast",
        icon: TrendingUp,
        badge: "New",
      },
      {
        label: "Bank Reconciliation",
        description: "Cocokkan mutasi bank vs BizPortal",
        href: "/accounting/bank-reconciliation",
        icon: GitMerge,
        badge: "Core",
      },
      {
        label: "Mutation Import",
        description: "Import mutasi bank dari file CSV/Excel",
        href: "/accounting/bank-mutation-import",
        icon: Upload,
      },
      {
        label: "Cash Management",
        description: "Saldo kas dan arus kas real-time",
        href: "/accounting/reconciliation",
        icon: Banknote,
      },
      {
        label: "Bank Accounts",
        description: "Master data rekening bank",
        href: "/accounting/bank-accounts-master",
        icon: Landmark,
      },
    ],
  },
  "tax-center": {
    id: "tax-center",
    label: "Tax Center",
    description: "PPN, PPh, WHT Reconciliation, dan laporan pajak",
    icon: Receipt,
    accent: "text-amber-700",
    accentLight: "bg-amber-50 text-amber-700",
    items: [
      {
        label: "Tax Dashboard",
        description: "Ringkasan kewajiban pajak",
        href: "/tax/dashboard",
        icon: LayoutDashboard,
        badge: "Core",
      },
      {
        label: "PPN",
        description: "Pajak Pertambahan Nilai",
        href: "/tax/ppn",
        icon: Receipt,
        badge: "Core",
      },
      {
        label: "PPh",
        description: "Pajak Penghasilan",
        href: "/tax/pph",
        icon: FileSpreadsheet,
        badge: "Core",
      },
      {
        label: "WHT Reconciliation",
        description: "Rekonsiliasi withholding tax",
        href: "/accounting/wht-reconciliation",
        icon: GitMerge,
      },
      {
        label: "Tax Reports",
        description: "Laporan pajak dan SPT",
        href: "/accounting/tax-report",
        icon: FileText,
      },
      {
        label: "Tax Rules",
        description: "Aturan dan mapping pajak",
        href: "/tax/rules",
        icon: Scale,
      },
    ],
  },
  "fixed-assets": {
    id: "fixed-assets",
    label: "Fixed Assets",
    description: "Registrasi aset, penyusutan, dan disposal aset tetap",
    icon: Package,
    accent: "text-orange-700",
    accentLight: "bg-orange-50 text-orange-700",
    items: [
      {
        label: "Asset Register",
        description: "Daftar aset tetap perusahaan",
        href: "/expense/fixed-assets",
        icon: Package,
        badge: "Core",
      },
      {
        label: "Depreciation",
        description: "Penyusutan aset per periode",
        href: "/expense/asset-depreciation",
        icon: TrendingUp,
        badge: "Core",
      },
      {
        label: "Asset Disposal",
        description: "Penghapusan dan penjualan aset",
        href: "/expense/fixed-assets",
        icon: Trash2,
      },
    ],
  },
  "profitability": {
    id: "profitability",
    label: "Profitability",
    description: "Analisis profitabilitas freight, customer, dan business unit",
    icon: TrendingUp,
    accent: "text-rose-700",
    accentLight: "bg-rose-50 text-rose-700",
    items: [
      {
        label: "Freight Profitability",
        description: "Margin per shipment dan rute",
        href: "/accounting/reports/freight-profitability",
        icon: TrendingUp,
        badge: "Core",
      },
      {
        label: "Customer Profitability",
        description: "Profitabilitas per customer",
        href: "/accounting/entity-review",
        icon: Users,
      },
      {
        label: "Business Unit P&L",
        description: "Laba rugi per unit bisnis",
        href: "/accounting/pl-by-bu",
        icon: PieChart,
      },
      {
        label: "Holding P&L",
        description: "Laporan konsolidasi grup",
        href: "/holding/pl-report",
        icon: Building2,
      },
    ],
  },
};

export default function FinanceWorkspacePage() {
  const params = useParams<{ module: string }>();
  const module = params.module ?? "";
  const config = CONFIGS[module];

  if (!config) {
    return (
      <AppShell>
        <div className="p-6 max-w-4xl mx-auto">
          <div className="flex items-center gap-2 mb-6">
            <Link href="/accounting">
              <button className="flex items-center gap-1.5 text-sm text-slate-500 hover:text-slate-800 transition-colors">
                <ArrowLeft className="h-4 w-4" />
                Finance & Accounting
              </button>
            </Link>
          </div>
          <p className="text-muted-foreground">Workspace tidak ditemukan.</p>
        </div>
      </AppShell>
    );
  }

  const Icon = config.icon;

  return (
    <AppShell>
      <div className="p-6 max-w-5xl mx-auto space-y-6">
        {/* Breadcrumb */}
        <div className="flex items-center gap-2 text-sm text-slate-500">
          <Link href="/accounting">
            <span className="hover:text-slate-800 transition-colors cursor-pointer">Finance & Accounting</span>
          </Link>
          <ChevronRight className="h-3.5 w-3.5" />
          <span className="text-slate-800 font-medium">{config.label}</span>
        </div>

        {/* Workspace Header */}
        <div className="flex items-start gap-4 pb-5 border-b">
          <div className={`p-3 rounded-xl ${config.accentLight.split(" ")[0]}`}>
            <Icon className={`h-6 w-6 ${config.accent}`} />
          </div>
          <div>
            <h1 className="text-xl font-bold text-slate-900">{config.label}</h1>
            <p className="text-sm text-slate-500 mt-0.5">{config.description}</p>
          </div>
        </div>

        {/* Report / Tool Cards */}
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {config.items.map((item) => {
            const ItemIcon = item.icon;
            return (
              <Link key={item.href} href={item.href}>
                <div className="group flex flex-col gap-3 p-5 rounded-xl border border-slate-200 bg-white hover:border-slate-300 hover:shadow-md transition-all duration-150 cursor-pointer h-full">
                  <div className="flex items-start justify-between">
                    <div className={`p-2 rounded-lg ${config.accentLight.split(" ")[0]}`}>
                      <ItemIcon className={`h-4 w-4 ${config.accent}`} />
                    </div>
                    <div className="flex items-center gap-2">
                      {item.badge && (
                        <span className={`text-[10px] font-bold px-1.5 py-0.5 rounded uppercase tracking-wide ${config.accentLight}`}>
                          {item.badge}
                        </span>
                      )}
                      <ChevronRight className="h-4 w-4 text-slate-300 group-hover:text-slate-500 transition-colors" />
                    </div>
                  </div>
                  <div>
                    <p className="font-semibold text-sm text-slate-800">{item.label}</p>
                    <p className="text-xs text-slate-500 mt-0.5 leading-relaxed">{item.description}</p>
                  </div>
                </div>
              </Link>
            );
          })}
        </div>

        {/* Back link */}
        <div className="pt-2">
          <Link href="/accounting">
            <button className="flex items-center gap-1.5 text-sm text-slate-400 hover:text-slate-700 transition-colors">
              <ArrowLeft className="h-3.5 w-3.5" />
              Kembali ke Finance & Accounting
            </button>
          </Link>
        </div>
      </div>
    </AppShell>
  );
}
