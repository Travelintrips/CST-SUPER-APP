import { AppShell } from "@/components/layout/AppShell";
import { Link } from "wouter";
import {
  FileText, BookOpen, ArrowLeftRight, Landmark, Receipt,
  Package, TrendingUp, ChevronRight, BarChart2,
} from "lucide-react";

interface WorkspaceCard {
  id: string;
  label: string;
  description: string;
  icon: React.ElementType;
  color: string;
  iconBg: string;
  borderColor: string;
  items: string[];
}

const WORKSPACES: WorkspaceCard[] = [
  {
    id: "financial-statements",
    label: "Financial Statements",
    description: "Laporan keuangan utama perusahaan",
    icon: FileText,
    color: "text-blue-700",
    iconBg: "bg-blue-50",
    borderColor: "border-blue-100 hover:border-blue-300",
    items: ["Profit & Loss", "Balance Sheet", "Cash Flow", "Trial Balance"],
  },
  {
    id: "general-ledger",
    label: "General Ledger",
    description: "Buku besar, jurnal, dan sub-ledger",
    icon: BookOpen,
    color: "text-indigo-700",
    iconBg: "bg-indigo-50",
    borderColor: "border-indigo-100 hover:border-indigo-300",
    items: ["GL", "Journal Entries", "Closing Entries", "Sub Ledger"],
  },
  {
    id: "ar-ap",
    label: "AR / AP",
    description: "Piutang dan hutang usaha",
    icon: ArrowLeftRight,
    color: "text-violet-700",
    iconBg: "bg-violet-50",
    borderColor: "border-violet-100 hover:border-violet-300",
    items: ["AR Aging", "AP Aging", "Outstanding Invoices"],
  },
  {
    id: "cash-bank",
    label: "Cash & Bank",
    description: "Rekonsiliasi, mutasi, dan kas",
    icon: Landmark,
    color: "text-emerald-700",
    iconBg: "bg-emerald-50",
    borderColor: "border-emerald-100 hover:border-emerald-300",
    items: ["Bank Reconciliation", "Mutation Import", "Cash Management"],
  },
  {
    id: "tax-center",
    label: "Tax Center",
    description: "PPN, PPh, WHT, dan laporan pajak",
    icon: Receipt,
    color: "text-amber-700",
    iconBg: "bg-amber-50",
    borderColor: "border-amber-100 hover:border-amber-300",
    items: ["Tax Dashboard", "PPN", "PPh", "WHT Reconciliation", "Tax Reports"],
  },
  {
    id: "fixed-assets",
    label: "Fixed Assets",
    description: "Aset tetap, penyusutan, dan disposal",
    icon: Package,
    color: "text-orange-700",
    iconBg: "bg-orange-50",
    borderColor: "border-orange-100 hover:border-orange-300",
    items: ["Asset Register", "Depreciation", "Asset Disposal"],
  },
  {
    id: "profitability",
    label: "Profitability",
    description: "Analisis profitabilitas bisnis",
    icon: TrendingUp,
    color: "text-rose-700",
    iconBg: "bg-rose-50",
    borderColor: "border-rose-100 hover:border-rose-300",
    items: ["Freight Profitability", "Customer Profitability", "Business Unit P&L"],
  },
];

export default function AccountingDashboardPage() {
  return (
    <AppShell>
      <div className="p-6 max-w-6xl mx-auto space-y-6">
        {/* Header */}
        <div className="border-b pb-5">
          <div className="flex items-center gap-3 mb-1">
            <div className="p-2 rounded-lg bg-blue-50">
              <BarChart2 className="h-5 w-5 text-blue-600" />
            </div>
            <div>
              <h1 className="text-xl font-bold text-slate-900">Finance & Accounting</h1>
              <p className="text-sm text-slate-500">Pilih modul untuk membuka Finance Workspace</p>
            </div>
          </div>
        </div>

        {/* 7-card workspace grid */}
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
          {WORKSPACES.map((ws) => {
            const Icon = ws.icon;
            return (
              <Link key={ws.id} href={`/accounting/workspace/${ws.id}`}>
                <div
                  className={`group relative flex flex-col gap-3 p-5 rounded-xl border-2 bg-white cursor-pointer transition-all duration-150 hover:shadow-md ${ws.borderColor}`}
                >
                  {/* Icon + label */}
                  <div className="flex items-start justify-between">
                    <div className={`p-2.5 rounded-lg ${ws.iconBg}`}>
                      <Icon className={`h-5 w-5 ${ws.color}`} />
                    </div>
                    <ChevronRight className={`h-4 w-4 text-slate-300 group-hover:text-slate-500 transition-colors mt-1`} />
                  </div>

                  <div>
                    <p className={`font-semibold text-sm text-slate-800`}>{ws.label}</p>
                    <p className="text-xs text-slate-500 mt-0.5 leading-relaxed">{ws.description}</p>
                  </div>

                  {/* Sub-items */}
                  <div className="flex flex-wrap gap-1 mt-auto pt-1 border-t border-slate-100">
                    {ws.items.slice(0, 3).map((item) => (
                      <span
                        key={item}
                        className="text-[11px] px-2 py-0.5 rounded-full bg-slate-100 text-slate-500 font-medium"
                      >
                        {item}
                      </span>
                    ))}
                    {ws.items.length > 3 && (
                      <span className="text-[11px] px-2 py-0.5 rounded-full bg-slate-100 text-slate-400">
                        +{ws.items.length - 3}
                      </span>
                    )}
                  </div>
                </div>
              </Link>
            );
          })}

          {/* Settings/Config tile — smaller utility card */}
          <Link href="/accounting/accounts">
            <div className="group flex flex-col gap-3 p-5 rounded-xl border-2 border-dashed border-slate-200 bg-slate-50 cursor-pointer transition-all hover:border-slate-300 hover:bg-white hover:shadow-sm">
              <div className="flex items-start justify-between">
                <div className="p-2.5 rounded-lg bg-slate-100">
                  <BookOpen className="h-5 w-5 text-slate-500" />
                </div>
                <ChevronRight className="h-4 w-4 text-slate-300 group-hover:text-slate-500 transition-colors mt-1" />
              </div>
              <div>
                <p className="font-semibold text-sm text-slate-600">Chart of Accounts</p>
                <p className="text-xs text-slate-400 mt-0.5">Kelola bagan akun & pengaturan</p>
              </div>
              <div className="flex flex-wrap gap-1 mt-auto pt-1 border-t border-slate-100">
                {["CoA", "Settings", "Cost Centers"].map((item) => (
                  <span key={item} className="text-[11px] px-2 py-0.5 rounded-full bg-slate-200 text-slate-400 font-medium">
                    {item}
                  </span>
                ))}
              </div>
            </div>
          </Link>
        </div>
      </div>
    </AppShell>
  );
}
