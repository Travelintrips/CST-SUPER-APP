import { useState, useMemo } from "react";
import { Link } from "wouter";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent } from "@/components/ui/card";
import { ArrowLeft, CheckCircle2, XCircle, AlertCircle, Download, Search, Map } from "lucide-react";

type ApiStatus = "yes" | "partial" | "no";

interface AuditRow {
  group: string;
  menu: string;
  route: string;
  componentFile: string;
  apiStatus: ApiStatus;
  dbStatus: boolean;
  permissions: string[];
  productionReady: boolean;
  devOnly?: boolean;
}

const NAV_AUDIT_DATA: AuditRow[] = [
  // ── DASHBOARD ──────────────────────────────────────────────────────────────
  { group: "Dashboard", menu: "Dashboard Utama", route: "/dashboard", componentFile: "pages/dashboard.tsx", apiStatus: "yes", dbStatus: true, permissions: ["admin", "owner", "manager", "logistics", "ecommerce", "trading"], productionReady: true },
  { group: "Dashboard", menu: "Approvals", route: "/approvals", componentFile: "pages/approvals/index.tsx", apiStatus: "yes", dbStatus: true, permissions: ["admin", "owner", "manager", "logistics", "ecommerce", "trading"], productionReady: true },
  { group: "Dashboard", menu: "Analytics", route: "/analytics", componentFile: "pages/analytics-dashboard.tsx", apiStatus: "yes", dbStatus: true, permissions: ["admin", "owner"], productionReady: true },

  // ── MASTER DATA ────────────────────────────────────────────────────────────
  { group: "Master Data", menu: "Produk / Bahan Baku", route: "/products/items", componentFile: "pages/products/items.tsx", apiStatus: "yes", dbStatus: true, permissions: ["manager", "admin", "owner"], productionReady: true },
  { group: "Master Data", menu: "Recipe / BOM", route: "/products/recipes", componentFile: "pages/products/recipes.tsx", apiStatus: "yes", dbStatus: true, permissions: ["manager", "admin", "owner"], productionReady: true },
  { group: "Master Data", menu: "Item Penjualan", route: "/sales/items", componentFile: "pages/sales/items.tsx", apiStatus: "yes", dbStatus: true, permissions: ["manager", "admin", "owner"], productionReady: true },
  { group: "Master Data", menu: "Katalog Terpadu", route: "/katalog-terpadu", componentFile: "pages/katalog-terpadu.tsx", apiStatus: "yes", dbStatus: true, permissions: ["admin", "owner"], productionReady: true },
  { group: "Master Data", menu: "Satuan (UOM)", route: "/settings/uom", componentFile: "pages/settings/uom.tsx", apiStatus: "yes", dbStatus: true, permissions: ["manager", "admin", "owner"], productionReady: true },
  { group: "Master Data", menu: "Satuan Pengiriman", route: "/settings/logistics-units", componentFile: "pages/settings/logistics-units.tsx", apiStatus: "yes", dbStatus: true, permissions: ["admin", "owner"], productionReady: true },
  { group: "Master Data", menu: "Product Templates", route: "/product-templates", componentFile: "pages/product-templates/index.tsx", apiStatus: "yes", dbStatus: true, permissions: ["admin", "owner"], productionReady: true },

  // ── CRM & SALES ────────────────────────────────────────────────────────────
  { group: "CRM & Sales", menu: "Dashboard Penjualan", route: "/sales", componentFile: "pages/sales/dashboard.tsx", apiStatus: "yes", dbStatus: true, permissions: ["admin", "owner"], productionReady: true },
  { group: "CRM & Sales", menu: "Pelanggan", route: "/sales/customers", componentFile: "pages/sales/customers.tsx", apiStatus: "yes", dbStatus: true, permissions: ["admin", "owner"], productionReady: true },
  { group: "CRM & Sales", menu: "Penawaran (Quotation)", route: "/sales/quotations", componentFile: "pages/sales/documents-list.tsx", apiStatus: "yes", dbStatus: true, permissions: ["admin", "owner"], productionReady: true },
  { group: "CRM & Sales", menu: "Sales Order", route: "/sales/orders", componentFile: "pages/sales/documents-list.tsx", apiStatus: "yes", dbStatus: true, permissions: ["admin", "owner"], productionReady: true },
  { group: "CRM & Sales", menu: "Invoice Penjualan", route: "/sales/invoices", componentFile: "pages/sales/invoices.tsx", apiStatus: "yes", dbStatus: true, permissions: ["admin", "owner"], productionReady: true },
  { group: "CRM & Sales", menu: "AI Draft Quotation", route: "/sales/ai-drafts", componentFile: "pages/sales/ai-drafts.tsx", apiStatus: "yes", dbStatus: true, permissions: ["admin", "owner"], productionReady: true },
  { group: "CRM & Sales", menu: "Portal Product Orders", route: "/portal-product-orders", componentFile: "pages/portal-product-orders.tsx", apiStatus: "yes", dbStatus: true, permissions: ["admin", "owner"], productionReady: true },

  // ── PROCUREMENT ────────────────────────────────────────────────────────────
  { group: "Procurement", menu: "Dashboard Pembelian", route: "/purchase", componentFile: "pages/purchase/dashboard.tsx", apiStatus: "yes", dbStatus: true, permissions: ["admin", "owner"], productionReady: true },
  { group: "Procurement", menu: "Purchase Request (PR)", route: "/purchase/pr", componentFile: "pages/purchase/pr-list.tsx", apiStatus: "yes", dbStatus: true, permissions: ["admin", "owner"], productionReady: true },
  { group: "Procurement", menu: "RFQ Pembelian", route: "/purchase/rfq", componentFile: "pages/purchase/documents-list.tsx", apiStatus: "yes", dbStatus: true, permissions: ["admin", "owner"], productionReady: true },
  { group: "Procurement", menu: "Purchase Order (PO)", route: "/purchase/orders", componentFile: "pages/purchase/po-orders.tsx", apiStatus: "yes", dbStatus: true, permissions: ["admin", "owner"], productionReady: true },
  { group: "Procurement", menu: "Terima Barang (GRN)", route: "/purchase/gr", componentFile: "pages/purchase/gr-list.tsx", apiStatus: "yes", dbStatus: true, permissions: ["admin", "owner"], productionReady: true },
  { group: "Procurement", menu: "QC Inspection", route: "/purchase/qc", componentFile: "pages/purchase/qc-list.tsx", apiStatus: "yes", dbStatus: true, permissions: ["admin", "owner"], productionReady: true },
  { group: "Procurement", menu: "Purchase Return", route: "/purchase/returns", componentFile: "pages/purchase/purchase-returns.tsx", apiStatus: "yes", dbStatus: true, permissions: ["admin", "owner"], productionReady: true },
  { group: "Procurement", menu: "Vendor Invoice (AP)", route: "/purchase/vendor-invoices", componentFile: "pages/purchase/vendor-invoices.tsx", apiStatus: "yes", dbStatus: true, permissions: ["admin", "owner"], productionReady: true },
  { group: "Procurement", menu: "Payment Request", route: "/purchase/payment-requests", componentFile: "pages/purchase/payment-requests.tsx", apiStatus: "yes", dbStatus: true, permissions: ["admin", "owner"], productionReady: true },
  { group: "Procurement", menu: "Landed Cost", route: "/purchase/landed-costs", componentFile: "pages/purchase/landed-costs.tsx", apiStatus: "yes", dbStatus: true, permissions: ["admin", "owner"], productionReady: true },
  { group: "Procurement", menu: "Vendor / Supplier", route: "/purchase/vendors", componentFile: "pages/purchase/vendors.tsx", apiStatus: "yes", dbStatus: true, permissions: ["admin", "owner"], productionReady: true },
  { group: "Procurement", menu: "Vendor Forms (VMF)", route: "/purchase/vendor-forms", componentFile: "pages/purchase/vendor-forms.tsx", apiStatus: "yes", dbStatus: true, permissions: ["admin", "owner"], productionReady: true },
  { group: "Procurement", menu: "Audit Trail VMF", route: "/purchase/vmf-audit-trail", componentFile: "pages/purchase/vmf-audit-trail.tsx", apiStatus: "yes", dbStatus: true, permissions: ["admin", "owner"], productionReady: true },
  { group: "Procurement", menu: "Thai Tea Procurement", route: "/purchase/thai-tea", componentFile: "pages/purchase/thai-tea.tsx", apiStatus: "yes", dbStatus: true, permissions: ["admin", "owner"], productionReady: true },
  { group: "Procurement", menu: "Vendor Comparison", route: "/purchase/rfq/:rfqId/compare", componentFile: "pages/purchase/vendor-comparison.tsx", apiStatus: "yes", dbStatus: true, permissions: ["admin", "owner"], productionReady: true },
  { group: "Procurement", menu: "Terima Barang (Quick)", route: "/purchase/receive", componentFile: "pages/purchase/receive.tsx", apiStatus: "yes", dbStatus: true, permissions: ["admin", "owner"], productionReady: true },

  // ── LOGISTICS ──────────────────────────────────────────────────────────────
  { group: "Logistics", menu: "Shipment / Pengiriman", route: "/logistics", componentFile: "pages/logistics.tsx", apiStatus: "yes", dbStatus: true, permissions: ["admin", "owner", "logistics"], productionReady: true },
  { group: "Logistics", menu: "Freight Forwarding", route: "/logistics/freight", componentFile: "pages/logistics-freight.tsx", apiStatus: "yes", dbStatus: true, permissions: ["admin", "owner", "logistics"], productionReady: true },
  { group: "Logistics", menu: "RFQ Vendor Logistik", route: "/logistics/rfq", componentFile: "pages/logistics-rfq-list.tsx", apiStatus: "yes", dbStatus: true, permissions: ["admin", "owner", "logistics"], productionReady: true },
  { group: "Logistics", menu: "Request Quote", route: "/logistics/quote-requests", componentFile: "pages/logistics-quote-requests.tsx", apiStatus: "yes", dbStatus: true, permissions: ["admin", "owner", "logistics"], productionReady: true },
  { group: "Logistics", menu: "Portal Orders Logistik", route: "/logistics/portal-orders", componentFile: "pages/logistics-portal-orders.tsx", apiStatus: "yes", dbStatus: true, permissions: ["admin", "owner", "logistics"], productionReady: true },
  { group: "Logistics", menu: "Performa Driver", route: "/logistics/driver-performance", componentFile: "pages/logistics/vendor-performance.tsx", apiStatus: "yes", dbStatus: true, permissions: ["admin", "owner", "logistics"], productionReady: true },
  { group: "Logistics", menu: "Balasan Quotation WA", route: "/logistics/quotation-reply", componentFile: "pages/logistics-quotation-reply.tsx", apiStatus: "yes", dbStatus: true, permissions: ["admin", "owner"], productionReady: true },
  { group: "Logistics", menu: "Margin Rules", route: "/logistics/margin-rules", componentFile: "pages/logistics-margin-rules.tsx", apiStatus: "yes", dbStatus: true, permissions: ["admin", "owner"], productionReady: true },
  { group: "Logistics", menu: "Internal Tasks", route: "/logistics/internal-tasks", componentFile: "pages/logistics/internal-tasks.tsx", apiStatus: "yes", dbStatus: true, permissions: ["admin", "owner", "logistics"], productionReady: true },
  { group: "Logistics", menu: "Pelanggan Portal", route: "/portal/customers", componentFile: "pages/portal-customers.tsx", apiStatus: "yes", dbStatus: true, permissions: ["admin", "owner"], productionReady: true },
  { group: "Logistics", menu: "Persetujuan Onboarding", route: "/portal/onboarding-approvals", componentFile: "pages/portal-onboarding-approvals.tsx", apiStatus: "yes", dbStatus: true, permissions: ["admin", "owner"], productionReady: true },
  { group: "Logistics", menu: "Bill of Lading (BL)", route: "/logistics/freight/:id/bl", componentFile: "pages/logistics-freight-bl.tsx", apiStatus: "yes", dbStatus: true, permissions: ["admin", "owner", "logistics"], productionReady: true },
  { group: "Logistics", menu: "Vendor Performance", route: "/logistics/vendor-performance", componentFile: "pages/logistics/vendor-performance.tsx", apiStatus: "yes", dbStatus: true, permissions: ["admin", "owner"], productionReady: true },

  // ── OPERATIONS ─────────────────────────────────────────────────────────────
  { group: "Operations", menu: "Daftar Biaya (Expense)", route: "/expense", componentFile: "pages/expense/index.tsx", apiStatus: "yes", dbStatus: true, permissions: ["admin", "owner"], productionReady: true },
  { group: "Operations", menu: "Kategori Biaya", route: "/expense/categories", componentFile: "pages/expense/categories.tsx", apiStatus: "yes", dbStatus: true, permissions: ["admin", "owner"], productionReady: true },
  { group: "Operations", menu: "Laporan Biaya", route: "/expense/reports", componentFile: "pages/expense/reports.tsx", apiStatus: "yes", dbStatus: true, permissions: ["admin", "owner"], productionReady: true },
  { group: "Operations", menu: "Trading", route: "/trading", componentFile: "pages/trading.tsx", apiStatus: "yes", dbStatus: true, permissions: ["admin", "owner", "trading"], productionReady: true },
  { group: "Operations", menu: "Dashboard Thai Tea", route: "/thai-tea/dashboard", componentFile: "pages/thai-tea/dashboard.tsx", apiStatus: "yes", dbStatus: true, permissions: ["admin", "owner"], productionReady: true },
  { group: "Operations", menu: "Stok Bahan Baku Thai Tea", route: "/thai-tea/stock", componentFile: "pages/thai-tea/stock.tsx", apiStatus: "yes", dbStatus: true, permissions: ["admin", "owner"], productionReady: true },
  { group: "Operations", menu: "Monitoring Cabang", route: "/thai-tea/branches", componentFile: "pages/thai-tea/branches.tsx", apiStatus: "yes", dbStatus: true, permissions: ["admin", "owner"], productionReady: true },
  { group: "Operations", menu: "Produksi / Racikan", route: "/thai-tea/production", componentFile: "pages/thai-tea/production.tsx", apiStatus: "yes", dbStatus: true, permissions: ["admin", "owner"], productionReady: true },
  { group: "Operations", menu: "Laporan Thai Tea", route: "/thai-tea/reports", componentFile: "pages/thai-tea/reports.tsx", apiStatus: "yes", dbStatus: true, permissions: ["admin", "owner"], productionReady: true },
  { group: "Operations", menu: "Ecommerce", route: "/ecommerce", componentFile: "pages/ecommerce.tsx", apiStatus: "yes", dbStatus: true, permissions: ["admin", "owner", "ecommerce"], productionReady: true },

  // ── FINANCE ────────────────────────────────────────────────────────────────
  { group: "Finance", menu: "Chart of Accounts", route: "/accounting/accounts", componentFile: "pages/accounting/accounts.tsx", apiStatus: "yes", dbStatus: true, permissions: ["admin", "owner"], productionReady: true },
  { group: "Finance", menu: "Jurnal", route: "/accounting/journals", componentFile: "pages/accounting/journals.tsx", apiStatus: "yes", dbStatus: true, permissions: ["admin", "owner"], productionReady: true },
  { group: "Finance", menu: "Jurnal Entry", route: "/accounting/entries", componentFile: "pages/accounting/entries.tsx", apiStatus: "yes", dbStatus: true, permissions: ["admin", "owner"], productionReady: true },
  { group: "Finance", menu: "Pembayaran (Accounting)", route: "/accounting/payments", componentFile: "pages/accounting/payments.tsx", apiStatus: "yes", dbStatus: true, permissions: ["admin", "owner"], productionReady: true },
  { group: "Finance", menu: "Pajak", route: "/accounting/taxes", componentFile: "pages/accounting/taxes.tsx", apiStatus: "yes", dbStatus: true, permissions: ["admin", "owner"], productionReady: true },
  { group: "Finance", menu: "Neraca Saldo (Trial Balance)", route: "/accounting/reports/trial-balance", componentFile: "pages/accounting/reports/trial-balance.tsx", apiStatus: "yes", dbStatus: true, permissions: ["admin", "owner"], productionReady: true },
  { group: "Finance", menu: "Buku Besar (GL)", route: "/accounting/reports/general-ledger", componentFile: "pages/accounting/reports/general-ledger.tsx", apiStatus: "yes", dbStatus: true, permissions: ["admin", "owner"], productionReady: true },
  { group: "Finance", menu: "Laba Rugi (P&L)", route: "/accounting/reports/profit-loss", componentFile: "pages/accounting/reports/profit-loss.tsx", apiStatus: "yes", dbStatus: true, permissions: ["admin", "owner"], productionReady: true },
  { group: "Finance", menu: "Neraca (Balance Sheet)", route: "/accounting/reports/balance-sheet", componentFile: "pages/accounting/reports/balance-sheet.tsx", apiStatus: "yes", dbStatus: true, permissions: ["admin", "owner"], productionReady: true },
  { group: "Finance", menu: "Profitabilitas Freight", route: "/accounting/reports/freight-profitability", componentFile: "pages/accounting/reports/freight-profitability.tsx", apiStatus: "partial", dbStatus: true, permissions: ["admin", "owner"], productionReady: true },
  { group: "Finance", menu: "Rekonsiliasi", route: "/accounting/reconciliation", componentFile: "pages/accounting/reconciliation.tsx", apiStatus: "partial", dbStatus: true, permissions: ["admin", "owner"], productionReady: false, devOnly: true },
  { group: "Finance", menu: "Pengaturan Akuntansi", route: "/accounting/settings", componentFile: "pages/accounting/settings.tsx", apiStatus: "yes", dbStatus: true, permissions: ["admin", "owner"], productionReady: false, devOnly: true },
  { group: "Finance", menu: "Laporan WA Harian", route: "/accounting/wa-report-settings", componentFile: "pages/accounting/wa-report-settings.tsx", apiStatus: "yes", dbStatus: true, permissions: ["admin", "owner"], productionReady: true },
  { group: "Finance", menu: "Overview Holding", route: "/holding", componentFile: "pages/HoldingPage.tsx", apiStatus: "partial", dbStatus: true, permissions: ["admin", "owner"], productionReady: false, devOnly: true },
  { group: "Finance", menu: "Dashboard Holding", route: "/holding/dashboard", componentFile: "pages/accounting/holding-dashboard.tsx", apiStatus: "partial", dbStatus: true, permissions: ["admin", "owner"], productionReady: false, devOnly: true },
  { group: "Finance", menu: "Laporan L/R Holding", route: "/holding/pl-report", componentFile: "pages/accounting/holding-pl-report.tsx", apiStatus: "partial", dbStatus: true, permissions: ["admin", "owner"], productionReady: false, devOnly: true },
  { group: "Finance", menu: "Laporan Arus Kas Holding", route: "/holding/cashflow-report", componentFile: "pages/accounting/holding-cashflow-report.tsx", apiStatus: "partial", dbStatus: true, permissions: ["admin", "owner"], productionReady: false, devOnly: true },
  { group: "Finance", menu: "Item Jurnal", route: "/accounting/journal-items", componentFile: "pages/accounting/journal-items.tsx", apiStatus: "yes", dbStatus: true, permissions: ["admin", "owner"], productionReady: true },

  // ── AI CENTER ──────────────────────────────────────────────────────────────
  { group: "AI Center", menu: "Intelligence Alerts", route: "/intelligence-alerts", componentFile: "pages/intelligence-alerts.tsx", apiStatus: "yes", dbStatus: true, permissions: ["admin", "owner"], productionReady: true },
  { group: "AI Center", menu: "AI Approval Queue", route: "/ai-approvals", componentFile: "pages/ai-approvals.tsx", apiStatus: "yes", dbStatus: true, permissions: ["admin", "owner"], productionReady: true },
  { group: "AI Center", menu: "Decision Memory", route: "/ai/decision-memory", componentFile: "pages/ai-decision-memory.tsx", apiStatus: "yes", dbStatus: true, permissions: ["admin", "owner"], productionReady: true },
  { group: "AI Center", menu: "Operational Context", route: "/operational-context", componentFile: "pages/operational-context.tsx", apiStatus: "yes", dbStatus: true, permissions: ["admin", "owner"], productionReady: true },
  { group: "AI Center", menu: "AI Chatbot Settings", route: "/settings/ai-chatbot", componentFile: "pages/ai-chatbot-settings.tsx", apiStatus: "yes", dbStatus: true, permissions: ["admin", "owner"], productionReady: true },
  { group: "AI Center", menu: "AI Knowledge Base", route: "/settings/ai-chatbot/knowledge", componentFile: "pages/ai-chatbot-knowledge.tsx", apiStatus: "yes", dbStatus: true, permissions: ["admin", "owner"], productionReady: true },
  { group: "AI Center", menu: "AI Scan Settings", route: "/settings/ai-scan", componentFile: "pages/ai-scan-settings.tsx", apiStatus: "yes", dbStatus: true, permissions: ["admin", "owner"], productionReady: true },

  // ── LAPORAN ────────────────────────────────────────────────────────────────
  { group: "Laporan", menu: "Laporan Penjualan B2B", route: "/reports/sales", componentFile: "pages/reports/sales.tsx", apiStatus: "yes", dbStatus: true, permissions: ["manager", "admin", "owner"], productionReady: true },
  { group: "Laporan", menu: "Laporan Pembelian", route: "/reports/purchase", componentFile: "pages/reports/purchase.tsx", apiStatus: "yes", dbStatus: true, permissions: ["admin", "owner"], productionReady: true },
  { group: "Laporan", menu: "AR Aging", route: "/reports/ar-aging", componentFile: "pages/reports/ar-aging.tsx", apiStatus: "yes", dbStatus: true, permissions: ["admin", "owner"], productionReady: true },
  { group: "Laporan", menu: "AP Aging", route: "/reports/ap-aging", componentFile: "pages/reports/ap-aging.tsx", apiStatus: "yes", dbStatus: true, permissions: ["admin", "owner"], productionReady: true },
  { group: "Laporan", menu: "Valuasi Persediaan", route: "/reports/inventory-valuation", componentFile: "pages/reports/inventory-valuation.tsx", apiStatus: "yes", dbStatus: true, permissions: ["admin", "owner"], productionReady: true },
  { group: "Laporan", menu: "Audit ERP", route: "/audit", componentFile: "pages/audit/index.tsx", apiStatus: "yes", dbStatus: true, permissions: ["admin", "owner"], productionReady: true },
  { group: "Laporan", menu: "Audit Log Keamanan", route: "/reports/audit-log", componentFile: "pages/reports/audit-log.tsx", apiStatus: "yes", dbStatus: true, permissions: ["admin", "owner"], productionReady: true },
  { group: "Laporan", menu: "Vendor Leaderboard", route: "/vendors", componentFile: "pages/vendor-leaderboard.tsx", apiStatus: "yes", dbStatus: true, permissions: ["manager", "admin", "owner"], productionReady: true },

  // ── ADMINISTRATION ─────────────────────────────────────────────────────────
  { group: "Administration", menu: "Pengguna", route: "/users", componentFile: "pages/users.tsx", apiStatus: "yes", dbStatus: true, permissions: ["admin", "owner"], productionReady: true },
  { group: "Administration", menu: "Manajemen Role", route: "/settings/roles", componentFile: "pages/settings-roles.tsx", apiStatus: "yes", dbStatus: true, permissions: ["admin", "owner"], productionReady: true },
  { group: "Administration", menu: "Aturan Approval", route: "/settings/approval-rules", componentFile: "pages/settings-approval-rules.tsx", apiStatus: "yes", dbStatus: true, permissions: ["admin", "owner"], productionReady: true },
  { group: "Administration", menu: "Struktur Organisasi", route: "/org", componentFile: "pages/OrgManagementPage.tsx", apiStatus: "yes", dbStatus: true, permissions: ["admin", "owner"], productionReady: true },
  { group: "Administration", menu: "Pengaturan Umum", route: "/settings", componentFile: "pages/settings.tsx", apiStatus: "yes", dbStatus: true, permissions: ["admin", "owner"], productionReady: true },
  { group: "Administration", menu: "Korespondensi", route: "/correspondences", componentFile: "pages/correspondences.tsx", apiStatus: "yes", dbStatus: true, permissions: ["admin", "owner"], productionReady: true },
  { group: "Administration", menu: "Email Inbox", route: "/email-inbox", componentFile: "pages/email-inbox.tsx", apiStatus: "yes", dbStatus: true, permissions: ["admin", "owner"], productionReady: true },
  { group: "Administration", menu: "Riwayat Notifikasi WA", route: "/notification-history", componentFile: "pages/wa-notification-history.tsx", apiStatus: "yes", dbStatus: true, permissions: ["admin", "owner"], productionReady: true },
  { group: "Administration", menu: "Notifikasi", route: "/notifications", componentFile: "pages/notifications.tsx", apiStatus: "yes", dbStatus: true, permissions: ["admin", "owner"], productionReady: true },
  { group: "Administration", menu: "WA Templates Logistik", route: "/settings/wa-templates", componentFile: "pages/settings/wa-templates.tsx", apiStatus: "yes", dbStatus: true, permissions: ["admin", "owner"], productionReady: true },
  { group: "Administration", menu: "Enterprise WA Templates", route: "/settings/enterprise-wa-templates", componentFile: "pages/settings/enterprise-wa-templates.tsx", apiStatus: "yes", dbStatus: true, permissions: ["admin", "owner"], productionReady: true },
  { group: "Administration", menu: "Image Manager", route: "/media", componentFile: "pages/media-manager.tsx", apiStatus: "yes", dbStatus: true, permissions: ["admin", "owner"], productionReady: true },
  { group: "Administration", menu: "Short Links", route: "/settings/short-links", componentFile: "pages/settings/short-links.tsx", apiStatus: "yes", dbStatus: true, permissions: ["admin", "owner"], productionReady: true },
  { group: "Administration", menu: "Konfigurasi Menu", route: "/settings/nav-company-config", componentFile: "pages/settings/nav-company-config.tsx", apiStatus: "yes", dbStatus: true, permissions: ["admin", "owner"], productionReady: true },
  { group: "Administration", menu: "Nav Audit", route: "/admin/nav-audit", componentFile: "pages/admin/nav-audit.tsx", apiStatus: "no", dbStatus: false, permissions: ["admin", "owner"], productionReady: true, devOnly: true },
];

type FilterKey = "all" | "ready" | "not-ready" | "no-api" | "no-db";

const FILTERS: { key: FilterKey; label: string }[] = [
  { key: "all", label: "Semua" },
  { key: "ready", label: "Siap Produksi" },
  { key: "not-ready", label: "Belum Siap" },
  { key: "no-api", label: "API Tidak Ada" },
  { key: "no-db", label: "DB Tidak Ada" },
];

const API_BADGE: Record<ApiStatus, { label: string; className: string; icon: typeof CheckCircle2 }> = {
  yes: { label: "Ada", className: "bg-emerald-100 text-emerald-700 border-emerald-200", icon: CheckCircle2 },
  partial: { label: "Partial", className: "bg-amber-100 text-amber-700 border-amber-200", icon: AlertCircle },
  no: { label: "Tidak Ada", className: "bg-red-100 text-red-700 border-red-200", icon: XCircle },
};

function exportCsv(rows: AuditRow[]) {
  const header = ["Grup", "Menu", "Route", "Component File", "API Status", "DB Status", "Permissions", "Siap Produksi", "Dev Only"];
  const lines = [
    header.join(","),
    ...rows.map((r) =>
      [
        r.group,
        `"${r.menu}"`,
        r.route,
        r.componentFile,
        r.apiStatus,
        r.dbStatus ? "Ya" : "Tidak",
        `"${r.permissions.join(", ")}"`,
        r.productionReady ? "Ya" : "Tidak",
        r.devOnly ? "Ya" : "Tidak",
      ].join(",")
    ),
  ];
  const blob = new Blob([lines.join("\n")], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `nav-audit-${new Date().toISOString().slice(0, 10)}.csv`;
  a.click();
  URL.revokeObjectURL(url);
}

export default function NavAuditPage() {
  const [filter, setFilter] = useState<FilterKey>("all");
  const [search, setSearch] = useState("");

  const filtered = useMemo(() => {
    let rows = NAV_AUDIT_DATA;
    if (filter === "ready") rows = rows.filter((r) => r.productionReady);
    else if (filter === "not-ready") rows = rows.filter((r) => !r.productionReady);
    else if (filter === "no-api") rows = rows.filter((r) => r.apiStatus === "no");
    else if (filter === "no-db") rows = rows.filter((r) => !r.dbStatus);
    if (search.trim()) {
      const q = search.toLowerCase();
      rows = rows.filter(
        (r) =>
          r.menu.toLowerCase().includes(q) ||
          r.route.toLowerCase().includes(q) ||
          r.componentFile.toLowerCase().includes(q) ||
          r.group.toLowerCase().includes(q)
      );
    }
    return rows;
  }, [filter, search]);

  const total = NAV_AUDIT_DATA.length;
  const readyCount = NAV_AUDIT_DATA.filter((r) => r.productionReady).length;
  const missingApi = NAV_AUDIT_DATA.filter((r) => r.apiStatus === "no").length;
  const missingDb = NAV_AUDIT_DATA.filter((r) => !r.dbStatus).length;
  const readyPct = Math.round((readyCount / total) * 100);

  return (
    <div className="flex flex-col gap-6 p-4 md:p-6">
      {/* Header */}
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div>
          <div className="flex items-center gap-2">
            <Map className="h-6 w-6 text-primary" />
            <Link href="/settings"><Button variant="ghost" size="icon" aria-label="Kembali"><ArrowLeft className="h-4 w-4" /></Button></Link>

            <h1 className="text-2xl font-bold tracking-tight">Nav Audit Report</h1>
          </div>
          <p className="mt-1 text-sm text-muted-foreground">
            Cakupan navigasi BizPortal — API, database, permission, dan kesiapan produksi setiap menu.
          </p>
        </div>
        <Button variant="outline" size="sm" onClick={() => exportCsv(filtered)}>
          <Download className="mr-1.5 h-4 w-4" />
          Export CSV
        </Button>
      </div>

      {/* Summary stats */}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <Card>
          <CardContent className="p-4">
            <p className="text-xs text-muted-foreground">Total Menu</p>
            <p className="text-2xl font-bold mt-0.5">{total}</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4">
            <p className="text-xs text-muted-foreground">Siap Produksi</p>
            <p className="text-2xl font-bold text-emerald-600 mt-0.5">{readyPct}%</p>
            <p className="text-xs text-muted-foreground">{readyCount} dari {total}</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4">
            <p className="text-xs text-muted-foreground">API Tidak Ada</p>
            <p className="text-2xl font-bold text-red-500 mt-0.5">{missingApi}</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4">
            <p className="text-xs text-muted-foreground">DB Tidak Ada</p>
            <p className="text-2xl font-bold text-amber-500 mt-0.5">{missingDb}</p>
          </CardContent>
        </Card>
      </div>

      {/* Filters + Search */}
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex flex-wrap gap-1.5">
          {FILTERS.map((f) => (
            <button
              key={f.key}
              onClick={() => setFilter(f.key)}
              className={`rounded-full px-3 py-1 text-xs font-medium border transition-colors ${
                filter === f.key
                  ? "bg-primary text-primary-foreground border-primary"
                  : "border-border bg-background text-muted-foreground hover:bg-muted"
              }`}
            >
              {f.label}
            </button>
          ))}
        </div>
        <div className="relative w-full sm:w-64">
          <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
          <Input
            placeholder="Cari menu, route, component..."
            className="pl-8 h-8 text-xs"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </div>
      </div>

      {/* Table */}
      <div className="rounded-lg border overflow-x-auto">
        <table className="w-full text-xs">
          <thead>
            <tr className="border-b bg-muted/50">
              <th className="px-3 py-2.5 text-left font-semibold text-muted-foreground w-6">#</th>
              <th className="px-3 py-2.5 text-left font-semibold text-muted-foreground min-w-[100px]">Grup</th>
              <th className="px-3 py-2.5 text-left font-semibold text-muted-foreground min-w-[160px]">Menu</th>
              <th className="px-3 py-2.5 text-left font-semibold text-muted-foreground min-w-[180px]">Route</th>
              <th className="px-3 py-2.5 text-left font-semibold text-muted-foreground min-w-[200px]">Component</th>
              <th className="px-3 py-2.5 text-center font-semibold text-muted-foreground w-20">API</th>
              <th className="px-3 py-2.5 text-center font-semibold text-muted-foreground w-16">DB</th>
              <th className="px-3 py-2.5 text-left font-semibold text-muted-foreground min-w-[140px]">Permission</th>
              <th className="px-3 py-2.5 text-center font-semibold text-muted-foreground w-20">Siap</th>
            </tr>
          </thead>
          <tbody>
            {filtered.length === 0 ? (
              <tr>
                <td colSpan={9} className="py-10 text-center text-muted-foreground">
                  Tidak ada item yang cocok
                </td>
              </tr>
            ) : (
              filtered.map((row, idx) => {
                const apiCfg = API_BADGE[row.apiStatus];
                const ApiIcon = apiCfg.icon;
                return (
                  <tr key={`${row.route}-${idx}`} className="border-b last:border-0 hover:bg-muted/30 transition-colors">
                    <td className="px-3 py-2 text-muted-foreground">{idx + 1}</td>
                    <td className="px-3 py-2">
                      <Badge variant="outline" className="text-[10px] font-normal whitespace-nowrap">
                        {row.group}
                      </Badge>
                    </td>
                    <td className="px-3 py-2 font-medium">
                      {row.menu}
                      {row.devOnly && (
                        <span className="ml-1.5 rounded bg-slate-100 px-1 py-0.5 text-[9px] text-slate-500 font-normal">DEV</span>
                      )}
                    </td>
                    <td className="px-3 py-2">
                      <Link href={row.route.includes(":") ? "#" : row.route}>
                        <span className="font-mono text-[10px] text-primary hover:underline cursor-pointer">
                          {row.route}
                        </span>
                      </Link>
                    </td>
                    <td className="px-3 py-2 font-mono text-[10px] text-muted-foreground">{row.componentFile}</td>
                    <td className="px-3 py-2 text-center">
                      <span className={`inline-flex items-center gap-0.5 rounded border px-1.5 py-0.5 font-medium ${apiCfg.className}`}>
                        <ApiIcon className="h-2.5 w-2.5 shrink-0" />
                        {apiCfg.label}
                      </span>
                    </td>
                    <td className="px-3 py-2 text-center">
                      {row.dbStatus ? (
                        <CheckCircle2 className="h-4 w-4 text-emerald-500 mx-auto" />
                      ) : (
                        <XCircle className="h-4 w-4 text-red-500 mx-auto" />
                      )}
                    </td>
                    <td className="px-3 py-2">
                      <div className="flex flex-wrap gap-0.5">
                        {row.permissions.map((p) => (
                          <span key={p} className="rounded bg-slate-100 px-1 py-0.5 text-[10px] text-slate-600">
                            {p}
                          </span>
                        ))}
                      </div>
                    </td>
                    <td className="px-3 py-2 text-center">
                      {row.productionReady ? (
                        <CheckCircle2 className="h-4 w-4 text-emerald-500 mx-auto" />
                      ) : (
                        <XCircle className="h-4 w-4 text-red-400 mx-auto" />
                      )}
                    </td>
                  </tr>
                );
              })
            )}
          </tbody>
        </table>
      </div>

      <p className="text-xs text-muted-foreground text-right">
        Menampilkan {filtered.length} dari {total} item · Data statis per {new Date().toLocaleDateString("id-ID", { day: "numeric", month: "long", year: "numeric" })}
      </p>
    </div>
  );
}
