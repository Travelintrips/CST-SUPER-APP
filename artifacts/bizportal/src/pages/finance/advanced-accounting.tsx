import { AppShell } from "@/components/layout/AppShell";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Link } from "wouter";
import {
  ArrowRight, BookOpen, Landmark, GitMerge, BarChart2, FileText,
  ShieldCheck, Database, Calendar, Receipt, ArrowLeftRight,
  Upload, Users, Settings, Eye, BookLock, Activity, Zap,
} from "lucide-react";

interface AdvancedItem {
  href: string;
  icon: React.ElementType;
  label: string;
  desc: string;
  badge?: string;
  badgeVariant?: "default" | "secondary" | "destructive" | "outline";
}

interface AdvancedSection {
  title: string;
  description: string;
  items: AdvancedItem[];
}

const sections: AdvancedSection[] = [
  {
    title: "Buku Besar & Ledger",
    description: "Data mentah akuntansi — untuk auditor dan akuntan berpengalaman",
    items: [
      { href: "/accounting/reports/general-ledger", icon: BookOpen, label: "General Ledger", desc: "Semua transaksi per akun" },
      { href: "/accounting/reports/trial-balance", icon: BarChart2, label: "Neraca Saldo", desc: "Debit/kredit semua akun" },
      { href: "/accounting/ledger", icon: Database, label: "Immutable Ledger", desc: "Buku besar tidak dapat diubah", badge: "Immutable" },
      { href: "/accounting/journal-items", icon: FileText, label: "Journal Items", desc: "Line-item semua jurnal" },
    ],
  },
  {
    title: "Chart of Accounts & Mapping",
    description: "Konfigurasi struktur akuntansi perusahaan",
    items: [
      { href: "/accounting/accounts", icon: Landmark, label: "Chart of Accounts", desc: "Master akun (CoA)" },
      { href: "/accounting/coa-mapping", icon: GitMerge, label: "COA Mapping", desc: "Pemetaan akun ke modul" },
      { href: "/accounting/tax-mapping", icon: Receipt, label: "Tax Mapping", desc: "Pemetaan pajak ke akun" },
      { href: "/accounting/bank-accounts-master", icon: Database, label: "Master Rekening Bank", desc: "Daftar rekening bank perusahaan" },
      { href: "/accounting/cost-centers", icon: Landmark, label: "Cost Centers", desc: "Pusat biaya / departemen" },
    ],
  },
  {
    title: "Rekonsiliasi & Kontrol",
    description: "Pengecekan konsistensi data keuangan",
    items: [
      { href: "/accounting/smart-bank-recon", icon: Zap, label: "Smart Bank Recon", desc: "Import CSV/Excel/MT940/CAMT.053 + auto-match" },
      { href: "/accounting/bank-reconciliation", icon: ArrowLeftRight, label: "Rekonsiliasi Bank", desc: "Cocokkan mutasi bank otomatis" },
      { href: "/accounting/bank-recon", icon: ArrowLeftRight, label: "Bank Recon (Manual)", desc: "Rekonsiliasi manual" },
      { href: "/accounting/bank-mutation-import", icon: Upload, label: "Import Mutasi Bank", desc: "Upload file mutasi" },
      { href: "/accounting/reconciliation", icon: GitMerge, label: "Rekonsiliasi Akun", desc: "Balance check antar modul" },
      { href: "/accounting/financial-reconciliation", icon: ShieldCheck, label: "Financial Reconciliation", desc: "Rekonsiliasi lintas entitas" },
      { href: "/accounting/wht-reconciliation", icon: Receipt, label: "Rekonsiliasi WHT", desc: "Withholding tax" },
    ],
  },
  {
    title: "Penutupan Periode",
    description: "Proses akhir bulan / akhir tahun",
    items: [
      { href: "/accounting/closing-wizard", icon: BookLock, label: "Closing Wizard", desc: "Month-end closing checklist & lock periode", badge: "New" },
      { href: "/accounting/closing-entries", icon: BookLock, label: "Jurnal Penutup", desc: "Closing entries periode" },
      { href: "/accounting/period-closing", icon: Calendar, label: "Status Periode", desc: "Buka / tutup periode akuntansi" },
      { href: "/accounting/governance", icon: ShieldCheck, label: "Governance & Control", desc: "Kontrol integritas pembukuan", badge: "Admin" },
    ],
  },
  {
    title: "Audit Trail & Monitoring",
    description: "Log perubahan dan monitoring integritas data",
    items: [
      { href: "/accounting/audit-report", icon: Eye, label: "Audit Report", desc: "Laporan perubahan entri" },
      { href: "/accounting/audit-import", icon: Upload, label: "Audit Import", desc: "Import data audit eksternal" },
      { href: "/accounting/entity-review", icon: Users, label: "Review Entitas", desc: "Validasi data entitas keuangan" },
      { href: "/reports/audit-log", icon: Activity, label: "System Audit Log", desc: "Log aktivitas sistem" },
    ],
  },
  {
    title: "Laporan Aging & Analitis",
    description: "AR Aging, AP Aging, dan laporan analitis lanjutan",
    items: [
      { href: "/reports/ar-aging", icon: Users, label: "AR Aging", desc: "Analisis piutang per umur" },
      { href: "/reports/ap-aging", icon: Receipt, label: "AP Aging", desc: "Analisis hutang per umur" },
      { href: "/accounting/pl-by-bu", icon: BarChart2, label: "P&L per Unit Bisnis", desc: "Breakdown profit per cabang" },
      { href: "/accounting/reports/freight-profitability", icon: BarChart2, label: "Profitabilitas Freight", desc: "Margin per shipment logistik" },
      { href: "/holding/dashboard", icon: Database, label: "Holding Dashboard", desc: "Konsolidasi multi-perusahaan" },
      { href: "/holding/pl-report", icon: FileText, label: "Holding P&L", desc: "Laporan P&L konsolidasi" },
      { href: "/holding/cashflow-report", icon: Activity, label: "Holding Cash Flow", desc: "Arus kas konsolidasi" },
      { href: "/accounting/gsheet", icon: FileText, label: "Google Sheets Sync", desc: "Sinkronisasi ke GSheet" },
    ],
  },
  {
    title: "Pengaturan Akuntansi",
    description: "Konfigurasi sistem akuntansi",
    items: [
      { href: "/accounting/settings", icon: Settings, label: "Pengaturan Akuntansi", desc: "Konfigurasi modul akuntansi" },
      { href: "/accounting/taxes", icon: Receipt, label: "Master Pajak", desc: "PPn, PPh, dan kode pajak" },
      { href: "/accounting/payments", icon: Database, label: "Metode Pembayaran", desc: "Konfigurasi payment method" },
      { href: "/accounting/other-transactions", icon: FileText, label: "Transaksi Lainnya", desc: "Entri non-standar" },
    ],
  },
];

function AdvancedLink({ item }: { item: AdvancedItem }) {
  return (
    <Link href={item.href}>
      <div className="flex items-center gap-3 p-3 rounded-lg border hover:border-white/10 hover:bg-white/5 transition-colors duration-150 cursor-pointer group">
        <div className="p-1.5 rounded-md bg-muted/50 group-hover:bg-muted transition-colors shrink-0">
          <item.icon className="h-4 w-4 text-muted-foreground group-hover:text-foreground transition-colors" />
        </div>
        <div className="min-w-0 flex-1">
          <p className="text-sm font-medium text-foreground flex items-center gap-2">
            {item.label}
            {item.badge && (
              <Badge variant={item.badgeVariant ?? "secondary"} className="text-xs py-0 h-4">
                {item.badge}
              </Badge>
            )}
          </p>
          <p className="text-xs text-muted-foreground truncate">{item.desc}</p>
        </div>
        <ArrowRight className="h-3.5 w-3.5 text-muted-foreground shrink-0 opacity-0 group-hover:opacity-100 transition-opacity" />
      </div>
    </Link>
  );
}

export default function AdvancedAccountingPage() {
  return (
    <AppShell>
      <div className="space-y-6 p-6 max-w-6xl mx-auto">
        {/* Header */}
        <div className="flex items-start justify-between">
          <div>
            <div className="flex items-center gap-2 mb-1">
              <h1 className="text-2xl font-bold text-foreground flex items-center gap-2">
                <BookOpen className="h-6 w-6 text-muted-foreground" />
                Akuntansi Lanjutan
              </h1>
              <Badge variant="secondary" className="text-xs">Admin Only</Badge>
            </div>
            <p className="text-sm text-muted-foreground">
              Alat akuntansi teknis untuk akuntan, auditor, dan administrator sistem.
            </p>
          </div>
          <Link href="/finance/cfo-overview">
            <div className="flex items-center gap-1.5 text-sm text-blue-400 hover:text-blue-300 cursor-pointer">
              <ArrowRight className="h-3.5 w-3.5 rotate-180" />
              Kembali ke CFO Overview
            </div>
          </Link>
        </div>

        {/* Warning Banner */}
        <div className="bg-amber-950/40 border border-amber-800/50 rounded-lg p-4 flex items-start gap-3">
          <ShieldCheck className="h-5 w-5 text-amber-400 shrink-0 mt-0.5" />
          <div>
            <p className="text-sm font-semibold text-amber-300">Area Teknis — Gunakan Dengan Hati-Hati</p>
            <p className="text-xs text-amber-400/80 mt-0.5">
              Halaman-halaman di sini mengakses data akuntansi mentah dan dapat mempengaruhi laporan keuangan.
              Hanya untuk pengguna yang memahami sistem double-entry accounting.
            </p>
          </div>
        </div>

        {/* Sections */}
        <div className="space-y-6">
          {sections.map((section) => (
            <Card key={section.title}>
              <CardHeader className="pb-3 pt-4 px-5">
                <CardTitle className="text-base font-semibold text-foreground">{section.title}</CardTitle>
                <p className="text-xs text-muted-foreground mt-0.5">{section.description}</p>
              </CardHeader>
              <CardContent className="px-5 pb-5">
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                  {section.items.map((item) => (
                    <AdvancedLink key={item.href} item={item} />
                  ))}
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      </div>
    </AppShell>
  );
}
