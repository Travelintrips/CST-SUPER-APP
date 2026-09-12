import { useState } from "react";
import { AppShell } from "@/components/layout/AppShell";
import { Link, useParams, useLocation } from "wouter";
import { PageHeader } from "@/components/layout/PageHeader";
import { EmptyState } from "@/components/ui/empty-state";
import {
  ChevronRight, FileSpreadsheet, BookOpen, Landmark, Receipt,
  DollarSign, Package, TrendingUp, FileText, LayoutDashboard,
  GitMerge, Upload, Banknote, ShieldCheck, Clock, Layers, Shield,
  BarChart2, Wallet, CalendarDays, Calculator, Zap, ArrowLeftRight, Scale,
} from "lucide-react";
import { cn } from "@/lib/utils";

interface TabItem {
  id: string;
  label: string;
  href: string;
  icon: React.ElementType;
  desc: string;
}

interface SectionConfig {
  label: string;
  desc: string;
  icon: React.ElementType;
  accent: string;
  accentBg: string;
  tabs: TabItem[];
}

const MONTHS = [
  { value: "01", label: "Januari" }, { value: "02", label: "Februari" },
  { value: "03", label: "Maret" }, { value: "04", label: "April" },
  { value: "05", label: "Mei" }, { value: "06", label: "Juni" },
  { value: "07", label: "Juli" }, { value: "08", label: "Agustus" },
  { value: "09", label: "September" }, { value: "10", label: "Oktober" },
  { value: "11", label: "November" }, { value: "12", label: "Desember" },
];
const currentYear = new Date().getFullYear();
const YEARS = Array.from({ length: 6 }, (_, i) => String(currentYear - i));

const REPORT_ITEMS = [
  { id: "profit-loss",    label: "Laba Rugi",       desc: "Pendapatan, HPP, dan laba bersih periode berjalan", icon: TrendingUp,    href: "/accounting/reports/profit-loss" },
  { id: "balance-sheet",  label: "Neraca",           desc: "Aset, liabilitas, dan ekuitas per tanggal penutup", icon: Scale,         href: "/accounting/reports/balance-sheet" },
  { id: "cash-flow",      label: "Arus Kas",         desc: "Arus kas operasi, investasi, dan pendanaan",        icon: ArrowLeftRight, href: "/accounting/reports/cash-flow" },
  { id: "trial-balance",  label: "Trial Balance",    desc: "Neraca percobaan semua akun aktif",                 icon: BarChart2,     href: "/accounting/reports/trial-balance" },
  { id: "general-ledger", label: "General Ledger",   desc: "Buku besar detail semua transaksi per akun",        icon: BookOpen,      href: "/accounting/reports/general-ledger" },
];

const SECTIONS: Record<string, SectionConfig> = {
  "accounting": {
    label: "Accounting",
    desc: "Jurnal, pembayaran keluar, penutupan periode, governance, dan rekonsiliasi keuangan",
    icon: BookOpen,
    accent: "text-indigo-700",
    accentBg: "bg-indigo-500/10",
    tabs: [
      { id: "bank-disbursements", label: "Bank Disbursement", href: "/accounting/bank-disbursements", icon: Banknote, desc: "Pusat semua pembayaran keluar — invoice vendor, pengeluaran, kasbon, talangan, transfer, pajak" },
      { id: "journal-entries", label: "Journal Entries", href: "/accounting/entries", icon: FileText, desc: "Buat dan kelola entri jurnal akuntansi" },
      { id: "journal-items", label: "Journal Items", href: "/accounting/journal-items", icon: Layers, desc: "Item-item jurnal detail per akun" },
      { id: "payments", label: "Payments (Historis)", href: "/accounting/payments", icon: Wallet, desc: "Riwayat pembayaran lama — gunakan Bank Disbursement untuk transaksi baru" },
      { id: "closing-wizard", label: "Closing Wizard", href: "/accounting/closing-wizard", icon: Clock, desc: "Month-end closing checklist — verifikasi & kunci periode" },
      { id: "period-closing", label: "Period Closing", href: "/accounting/period-closing", icon: Clock, desc: "Status dan kontrol penutupan periode" },
      { id: "closing-entries", label: "Closing Entries", href: "/accounting/closing-entries", icon: LayoutDashboard, desc: "Penutupan periode akuntansi" },
      { id: "governance", label: "Governance", href: "/accounting/governance", icon: Shield, desc: "Tata kelola akuntansi dan audit trail" },
      { id: "financial-recon", label: "Financial Reconciliation", href: "/accounting/financial-reconciliation", icon: GitMerge, desc: "Rekonsiliasi saldo lintas modul" },
    ],
  },
  "cash-bank": {
    label: "Cash & Bank",
    desc: "Transaksi kas, rekonsiliasi bank, import mutasi, dan master rekening",
    icon: Landmark,
    accent: "text-emerald-700",
    accentBg: "bg-emerald-500/10",
    tabs: [
      { id: "transactions", label: "Transactions", href: "/accounting/other-transactions", icon: Banknote, desc: "Penerimaan dan pengeluaran di luar operasional utama" },
      { id: "smart-bank-recon", label: "Smart Bank Recon", href: "/accounting/smart-bank-recon", icon: Zap, desc: "Import CSV/Excel/MT940/CAMT.053 + confidence score" },
      { id: "bank-recon", label: "Bank Reconciliation", href: "/accounting/bank-reconciliation", icon: GitMerge, desc: "Auto-match mutasi rekening ke order/payment" },
      { id: "mutation-import", label: "Bank Mutation Import", href: "/accounting/bank-mutation-import", icon: Upload, desc: "Import mutasi bank dari file CSV/XLSX" },
      { id: "bank-accounts", label: "Bank Accounts", href: "/accounting/bank-accounts-master", icon: Landmark, desc: "Master data rekening bank perusahaan" },
    ],
  },
  "tax-center": {
    label: "Tax Center",
    desc: "PPN, PPh, SPT, WHT Reconciliation, dan aturan pajak",
    icon: Receipt,
    accent: "text-amber-700",
    accentBg: "bg-amber-500/10",
    tabs: [
      { id: "dashboard", label: "Tax Dashboard", href: "/tax/dashboard", icon: BarChart2, desc: "Ringkasan kewajiban dan status pajak" },
      { id: "ppn", label: "PPN", href: "/tax/ppn", icon: Receipt, desc: "Faktur pajak masukan dan keluaran" },
      { id: "pph", label: "PPH", href: "/tax/pph", icon: FileText, desc: "Pemotongan pajak penghasilan" },
      { id: "spt", label: "SPT", href: "/tax/spt", icon: FileSpreadsheet, desc: "Laporan SPT masa PPN dan PPh" },
      { id: "spt-builder", label: "SPT Builder", href: "/tax/spt-builder", icon: FileSpreadsheet, desc: "Generate, validasi, dan ekspor SPT ke DJP" },
      { id: "spt-control", label: "SPT Control", href: "/tax/spt-control", icon: ShieldCheck, desc: "Include/exclude transaksi, adjustment, dan audit log SPT" },
      { id: "wht", label: "WHT Reconciliation", href: "/accounting/wht-reconciliation", icon: GitMerge, desc: "Cocokkan hutang withholding tax" },
      { id: "rules", label: "Tax Rules", href: "/tax/rules", icon: Shield, desc: "Konfigurasi tarif dan aturan pajak" },
    ],
  },
  "expense": {
    label: "Expense Management",
    desc: "Dashboard expense, pengeluaran, budget, approval, kasbon, talangan, dan laporan",
    icon: DollarSign,
    accent: "text-orange-700",
    accentBg: "bg-orange-500/10",
    tabs: [
      { id: "dashboard", label: "Dashboard", href: "/expense/dashboard", icon: BarChart2, desc: "Monitor dan analisis biaya operasional" },
      { id: "all-expenses", label: "All Expenses", href: "/expense", icon: Receipt, desc: "Daftar dan kelola semua pengeluaran" },
      { id: "budget", label: "Budget", href: "/expense/budget", icon: Calculator, desc: "Anggaran operasional dan nilai tukar" },
      { id: "approvals", label: "Approvals", href: "/expense/approvals", icon: ShieldCheck, desc: "Persetujuan pengeluaran yang pending" },
      { id: "kasbon", label: "Kasbon", href: "/expense/kasbon", icon: Wallet, desc: "Pinjaman dan kasbon internal karyawan" },
      { id: "talangan", label: "Talangan", href: "/expense/talangan", icon: DollarSign, desc: "Pengeluaran yang ditagihkan kembali" },
      { id: "templates", label: "Templates", href: "/expense/templates", icon: FileText, desc: "Template kategori dan pengeluaran rutin" },
      { id: "reports", label: "Reports", href: "/expense/reports", icon: BarChart2, desc: "Analisis dan laporan biaya operasional" },
    ],
  },
  "assets": {
    label: "Assets",
    desc: "Aset tetap, penyusutan, pinjaman bank, dan cicilan vendor",
    icon: Package,
    accent: "text-rose-700",
    accentBg: "bg-rose-500/10",
    tabs: [
      { id: "fixed-assets", label: "Fixed Assets", href: "/expense/fixed-assets", icon: Package, desc: "Daftar dan registrasi aset tetap perusahaan" },
      { id: "depreciation", label: "Depreciation", href: "/expense/asset-depreciation", icon: TrendingUp, desc: "Perhitungan dan jadwal penyusutan aset" },
      { id: "bank-loans", label: "Bank Loans", href: "/expense/bank-loans", icon: Banknote, desc: "Pinjaman bank dan jadwal angsuran" },
      { id: "vendor-installments", label: "Vendor Installments", href: "/expense/vendor-installments", icon: CalendarDays, desc: "Jadwal cicilan pembayaran ke vendor" },
    ],
  },
};

function FinancialReportsView() {
  const now = new Date();
  const [month, setMonth] = useState(String(now.getMonth() + 1).padStart(2, "0"));
  const [year, setYear] = useState(String(now.getFullYear()));
  const [, navigate] = useLocation();

  const sel = "rounded-md border border-input bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring";

  function buildUrl(base: string) {
    const lastDay = new Date(Number(year), Number(month), 0).getDate();
    const p = new URLSearchParams({
      period: `${year}-${month}`,
      startDate: `${year}-${month}-01`,
      endDate: `${year}-${month}-${String(lastDay).padStart(2, "0")}`,
    });
    return `${base}?${p}`;
  }

  const periodLabel = `${MONTHS.find((m) => m.value === month)?.label ?? ""} ${year}`;

  return (
    <div className="space-y-6">
      {/* Period picker */}
      <div className="rounded-xl border bg-card p-5 space-y-4">
        <div>
          <p className="text-sm font-semibold">Pilih Periode Laporan</p>
          <p className="text-xs text-muted-foreground mt-0.5">Semua laporan di bawah akan dibuka dengan periode yang dipilih</p>
        </div>
        <div className="flex items-center gap-3 flex-wrap">
          <select value={month} onChange={(e) => setMonth(e.target.value)} className={cn(sel, "w-36")}>
            {MONTHS.map((m) => <option key={m.value} value={m.value}>{m.label}</option>)}
          </select>
          <select value={year} onChange={(e) => setYear(e.target.value)} className={cn(sel, "w-24")}>
            {YEARS.map((y) => <option key={y} value={y}>{y}</option>)}
          </select>
          <span className="text-sm text-muted-foreground">→ <strong>{periodLabel}</strong></span>
        </div>
      </div>

      {/* Report cards */}
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {REPORT_ITEMS.map((r) => {
          const Icon = r.icon;
          return (
            <button
              key={r.id}
              onClick={() => navigate(buildUrl(r.href))}
              className="group text-left flex items-start gap-3 rounded-xl border bg-card p-4 hover:shadow-md hover:border-blue-300 hover:-translate-y-0.5 transition-all duration-150"
            >
              <div className="shrink-0 rounded-lg p-2 bg-blue-500/10 transition-colors group-hover:bg-blue-500/20">
                <Icon className="h-4 w-4 text-blue-700" />
              </div>
              <div className="flex-1 min-w-0">
                <p className="text-sm font-semibold leading-tight">{r.label}</p>
                <p className="text-xs text-muted-foreground mt-0.5 leading-snug">{r.desc}</p>
              </div>
              <ChevronRight className="h-3.5 w-3.5 text-muted-foreground shrink-0 mt-0.5 opacity-0 group-hover:opacity-100 transition-opacity" />
            </button>
          );
        })}
      </div>
    </div>
  );
}

function TabbedView({ config }: { config: SectionConfig }) {
  const [activeTab, setActiveTab] = useState(config.tabs[0]?.id ?? "");

  const activeItem = config.tabs.find((t) => t.id === activeTab);

  return (
    <div className="space-y-6">
      <div className="flex gap-1 flex-wrap border-b pb-0">
        {config.tabs.map((tab) => (
          <button
            key={tab.id}
            onClick={() => setActiveTab(tab.id)}
            className={cn(
              "px-3 py-2 text-sm font-medium rounded-t-md transition-colors border-b-2 -mb-px",
              activeTab === tab.id
                ? "border-primary text-primary bg-primary/5"
                : "border-transparent text-muted-foreground hover:text-foreground hover:bg-muted/50"
            )}
          >
            {tab.label}
          </button>
        ))}
      </div>

      {activeItem && (
        <div className="space-y-4">
          <div className="flex items-center justify-between">
            <div>
              <h2 className="text-base font-semibold">{activeItem.label}</h2>
              <p className="text-sm text-muted-foreground">{activeItem.desc}</p>
            </div>
            <Link href={activeItem.href}>
              <button className="inline-flex items-center gap-2 rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90 transition-colors">
                Buka
                <ChevronRight className="h-4 w-4" />
              </button>
            </Link>
          </div>

          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {config.tabs.map((tab) => {
              const Icon = tab.icon;
              return (
                <Link key={tab.id} href={tab.href}>
                  <div className={cn(
                    "group flex items-start gap-3 rounded-xl border p-4 cursor-pointer hover:shadow-md hover:-translate-y-0.5 transition-all duration-150",
                    tab.id === activeTab
                      ? "border-primary/40 bg-primary/5"
                      : "bg-card hover:border-primary/30"
                  )}>
                    <div className={cn("shrink-0 rounded-lg p-2 transition-colors", config.accentBg)}>
                      <Icon className={cn("h-4 w-4", config.accent)} />
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-semibold leading-tight">{tab.label}</p>
                      <p className="text-xs text-muted-foreground mt-0.5 leading-snug">{tab.desc}</p>
                    </div>
                    <ChevronRight className="h-3.5 w-3.5 text-muted-foreground shrink-0 mt-0.5 opacity-0 group-hover:opacity-100 transition-opacity" />
                  </div>
                </Link>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}

export default function FinanceModuleWorkspacePage() {
  const params = useParams<{ section: string }>();
  const section = params.section ?? "";

  if (section === "financial-reports") {
    return (
      <AppShell>
        <div className="p-6 space-y-6 max-w-6xl">
          <PageHeader
            breadcrumb={[
              { label: "Dashboard", href: "/dashboard" },
              { label: "Finance", href: "/finance" },
              { label: "Financial Reports" },
            ]}
            title="Financial Reports"
            description="Pilih periode lalu buka laporan keuangan — Laba Rugi, Neraca, Arus Kas, Trial Balance, General Ledger"
          />
          <FinancialReportsView />
        </div>
      </AppShell>
    );
  }

  const config = SECTIONS[section];

  if (!config) {
    return (
      <AppShell>
        <div className="p-6 max-w-6xl space-y-6">
          <PageHeader
            breadcrumb={[
              { label: "Dashboard", href: "/dashboard" },
              { label: "Finance", href: "/finance" },
            ]}
            title="Workspace Tidak Ditemukan"
          />
          <EmptyState
            title="Workspace tidak ditemukan"
            description="Pilih workspace yang tersedia dari Finance Hub."
            actionLabel="Kembali ke Finance"
            actionHref="/finance"
          />
        </div>
      </AppShell>
    );
  }

  return (
    <AppShell>
      <div className="p-6 space-y-6 max-w-6xl">
        <PageHeader
          breadcrumb={[
            { label: "Dashboard", href: "/dashboard" },
            { label: "Finance", href: "/finance" },
            { label: config.label },
          ]}
          title={config.label}
          description={config.desc}
        />
        <TabbedView config={config} />
      </div>
    </AppShell>
  );
}
