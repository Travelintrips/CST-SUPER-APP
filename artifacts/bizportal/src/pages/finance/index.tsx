import { AppShell } from "@/components/layout/AppShell";
import { ModuleHub } from "@/components/layout/ModuleHub";
import { PageHeader } from "@/components/layout/PageHeader";
import {
  BookOpen, Landmark, Receipt, DollarSign, Package, Banknote, FileSpreadsheet, Brain,
} from "lucide-react";

export default function FinanceHubPage() {
  return (
    <AppShell>
      <PageHeader
        title="Finance"
        description="Akuntansi, laporan keuangan, kas & bank, pajak, expense, dan aset"
        breadcrumb={[{ label: "Dashboard", href: "/dashboard" }, { label: "Finance" }]}
        favoriteEnabled
      />
      <ModuleHub
        showHeader={false}
        moduleIcon={BookOpen}
        moduleName="Finance"
        moduleDesc="Akuntansi, laporan keuangan, kas & bank, pajak, expense, dan aset"
        cards={[
          {
            href: "/accounting/bank-disbursements",
            icon: Banknote,
            title: "Bank Disbursement",
            desc: "Pusat semua pembayaran keluar — invoice vendor, pengeluaran, kasbon, talangan, transfer dana, pajak",
            accent: "bg-emerald-500/10 text-emerald-600 group-hover:bg-emerald-500/20",
          },
          {
            href: "/finance/workspace/accounting",
            icon: BookOpen,
            title: "Accounting",
            desc: "Journal Entries, Period Closing, Governance, Rekonsiliasi",
            accent: "bg-indigo-500/10 text-indigo-600 group-hover:bg-indigo-500/20",
          },
          {
            href: "/finance/workspace/financial-reports",
            icon: FileSpreadsheet,
            title: "Financial Reports",
            desc: "Laba Rugi, Neraca, Arus Kas, Trial Balance, General Ledger — dengan period picker",
            accent: "bg-blue-500/10 text-blue-600 group-hover:bg-blue-500/20",
          },
          {
            href: "/finance/workspace/cash-bank",
            icon: Landmark,
            title: "Cash & Bank",
            desc: "Transaksi, Rekonsiliasi Bank, Import Mutasi, Bank Accounts",
            accent: "bg-emerald-500/10 text-emerald-600 group-hover:bg-emerald-500/20",
          },
          {
            href: "/finance/workspace/tax-center",
            icon: Receipt,
            title: "Tax Center",
            desc: "PPN, PPH, SPT, WHT Reconciliation, Tax Rules",
            accent: "bg-amber-500/10 text-amber-600 group-hover:bg-amber-500/20",
          },
          {
            href: "/finance/workspace/expense",
            icon: DollarSign,
            title: "Expense Management",
            desc: "Dashboard, Pengeluaran, Budget, Approvals, Kasbon, Talangan",
            accent: "bg-orange-500/10 text-orange-600 group-hover:bg-orange-500/20",
          },
          {
            href: "/finance/workspace/assets",
            icon: Package,
            title: "Assets",
            desc: "Fixed Assets, Penyusutan, Pinjaman Bank, Cicilan Vendor",
            accent: "bg-rose-500/10 text-rose-600 group-hover:bg-rose-500/20",
          },
          {
            href: "/ai/review",
            icon: Brain,
            title: "AI Center",
            desc: "Learning patterns, recommendations, statistics — semua insight AI dalam satu tempat",
            accent: "bg-violet-500/10 text-violet-600 group-hover:bg-violet-500/20",
          },
        ]}
      />
    </AppShell>
  );
}
