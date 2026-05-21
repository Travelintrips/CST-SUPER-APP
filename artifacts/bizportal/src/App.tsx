import React from "react";
import { Router as WouterRouter, Switch, Route, Redirect } from "wouter";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
import { SupabaseAuthProvider, useSupabaseAuth } from "@/contexts/SupabaseAuthContext";
import { LanguageProvider } from "@/contexts/LanguageContext";
import { CompanyProvider } from "@/contexts/CompanyContext";
import { useGetCurrentUser, getGetCurrentUserQueryKey } from "@workspace/api-client-react";
import { AppRoutes } from "@/routes";
import { OrderNotificationsProvider } from "@/contexts/OrderNotificationsContext";
import { ProtectedRoute } from "@/components/ProtectedRoute";
import NotFound from "@/pages/not-found";
import ApprovalsPage from "@/pages/approvals/index";
import DashboardPage from "@/pages/dashboard";
import EcommercePage from "@/pages/ecommerce";
import TradingPage from "@/pages/trading";
import KatalogTerpaduPage from "@/pages/katalog-terpadu";
import LogisticsPage from "@/pages/logistics";
import LogisticsFreightPage from "@/pages/logistics-freight";
import LogisticsFreightEditorPage from "@/pages/logistics-freight-editor";
import LogisticsFreightDetailPage from "@/pages/logistics-freight-detail";
import LogisticsFreightBLPage from "@/pages/logistics-freight-bl";
import LogisticsPortalOrdersPage from "@/pages/logistics-portal-orders";
import LogisticsPortalOrderDetailPage from "@/pages/logistics-portal-order-detail";
import LogisticsDriversPage from "@/pages/logistics-drivers";
import LogisticsDriverPerformancePage from "@/pages/logistics-driver-performance";
import LogisticsQuoteRequestsPage from "@/pages/logistics-quote-requests";
import LogisticsVendorsPage from "@/pages/logistics-vendors";
import PosPage from "@/pages/pos";
import SettingsPage from "@/pages/settings";
import NavCompanyConfigPage from "@/pages/settings/nav-company-config";
import AiChatbotSettingsPage from "@/pages/ai-chatbot-settings";
import AiChatbotKnowledgePage from "@/pages/ai-chatbot-knowledge";
import AiScanSettingsPage from "@/pages/ai-scan-settings";
import UsersPage from "@/pages/users";
import MediaManagerPage from "@/pages/media-manager";
import WelcomePage from "@/pages/welcome";
import SalesDashboardPage from "@/pages/sales/dashboard";
import SalesDocumentsListPage from "@/pages/sales/documents-list";
import SalesDocumentEditorPage from "@/pages/sales/quotation-editor";
import AiDraftsPage from "@/pages/sales/ai-drafts";
import CustomersPage from "@/pages/sales/customers";
import SalesInvoicesPage from "@/pages/sales/invoices";
import SalesItemsPage from "@/pages/sales/items";
import PurchaseDashboardPage from "@/pages/purchase/dashboard";
import PurchaseDocumentsListPage from "@/pages/purchase/documents-list";
import POOrdersPage from "@/pages/purchase/po-orders";
import PurchaseDocumentEditorPage from "@/pages/purchase/rfq-editor";
import VendorsPage from "@/pages/purchase/vendors";
import VendorDetailPage from "@/pages/purchase/vendor-detail";
import PurchaseBillsPage from "@/pages/purchase/bills";
import ReportsSalesPage from "@/pages/reports/sales";
import ReportsPurchasePage from "@/pages/reports/purchase";
import ReportsArAgingPage from "@/pages/reports/ar-aging";
import ReportsApAgingPage from "@/pages/reports/ap-aging";
import ReportsMainPage from "@/pages/reports/main";
import AuditLogPage from "@/pages/reports/audit-log";
import AccountingAccountsPage from "@/pages/accounting/accounts";
import AccountingJournalsPage from "@/pages/accounting/journals";
import AccountingTaxesPage from "@/pages/accounting/taxes";
import AccountingEntriesPage from "@/pages/accounting/entries";
import AccountingEntryDetailPage from "@/pages/accounting/entry-detail";
import AccountingJournalItemsPage from "@/pages/accounting/journal-items";
import AccountingPaymentsPage from "@/pages/accounting/payments";
import AccountingSettingsPage from "@/pages/accounting/settings";
import AccountingTrialBalancePage from "@/pages/accounting/reports/trial-balance";
import AccountingGeneralLedgerPage from "@/pages/accounting/reports/general-ledger";
import AccountingProfitLossPage from "@/pages/accounting/reports/profit-loss";
import AccountingBalanceSheetPage from "@/pages/accounting/reports/balance-sheet";
import AccountingReconciliationPage from "@/pages/accounting/reconciliation";
import CorrespondencesPage from "@/pages/correspondences";
import EmailInboxPage from "@/pages/email-inbox";
import ExpenseListPage from "@/pages/expense/index";
import ExpenseEditorPage from "@/pages/expense/editor";
import ExpenseCategoriesPage from "@/pages/expense/categories";
import ExpenseReportsPage from "@/pages/expense/reports";
import PortalProductOrdersPage from "@/pages/portal-product-orders";
import PortalOnboardingApprovalsPage from "@/pages/portal-onboarding-approvals";
import PortalCustomersPage from "@/pages/portal-customers";
import LogisticsQuotationReplyPage from "@/pages/logistics-quotation-reply";
import LogisticsVendorQuotePage from "@/pages/logistics-vendor-quote";
import LogisticsRfqComparisonPage from "@/pages/logistics-rfq-comparison"; // [NEW-RFQ-FLOW]
import LogisticsRfqListPage from "@/pages/logistics-rfq-list"; // [NEW-RFQ-FLOW]
import LogisticsRfqDetailPage from "@/pages/logistics-rfq-detail"; // [NEW-RFQ-FLOW]
import LogisticOrderDetailPage from "@/pages/logistics/order-detail";
import HoldingPage from "@/pages/HoldingPage";
import HoldingDashboardPage from "@/pages/accounting/holding-dashboard";
import HoldingPLReportPage from "@/pages/accounting/holding-pl-report";
import HoldingCashflowReportPage from "@/pages/accounting/holding-cashflow-report";
import OrgManagementPage from "@/pages/OrgManagementPage";
import PosKasirAdminPage from "@/pages/pos-kasir-admin";
import PurchaseReceivePage from "@/pages/purchase/receive";
import ThaiTeaPurchasePage from "@/pages/purchase/thai-tea";
import ThaiTeaDashboardPage from "@/pages/thai-tea/dashboard";
import ThaiTeaRecipesPage from "@/pages/thai-tea/recipes";
import ThaiTeaStockPage from "@/pages/thai-tea/stock";
import ThaiTeaBranchesPage from "@/pages/thai-tea/branches";
import ThaiTeaProductionPage from "@/pages/thai-tea/production";
import ThaiTeaReportsPage from "@/pages/thai-tea/reports";
import PosInventoryDashboardPage from "@/pages/pos-inventory-dashboard";
import PosInventoryItemsPage from "@/pages/pos-inventory-items";
import PosInventoryStocksPage from "@/pages/pos-inventory-stocks";
import PosStockLossesPage from "@/pages/pos-stock-losses";
import PosStockMutationsPage from "@/pages/pos-stock-mutations";
import PosStockOpnamePage from "@/pages/pos-stock-opname";
import PosStockReturnsPage from "@/pages/pos-stock-returns";
import PosStockTransfersPage from "@/pages/pos-stock-transfers";
import PosBranchesPage from "@/pages/pos-branches";
import PosWarehousesPage from "@/pages/pos-warehouses";
import PosRacksPage from "@/pages/pos-racks";
import PosRecipesPage from "@/pages/pos-recipes";
import ProductItemsPage from "@/pages/products/items";
import ProductRecipesPage from "@/pages/products/recipes";
import PosQrGeneratorPage from "@/pages/pos-qr-generator";
import PosQrScannerPage from "@/pages/pos-qr-scanner";
import SettingsRolesPage from "@/pages/settings-roles";
import SettingsApprovalRulesPage from "@/pages/settings-approval-rules";
import PurchaseRequestListPage from "@/pages/purchase/pr-list";
import PurchaseRequestEditorPage from "@/pages/purchase/pr-editor";
import GoodsReceiptListPage from "@/pages/purchase/gr-list";
import GoodsReceiptEditorPage from "@/pages/purchase/gr-editor";
import QcListPage from "@/pages/purchase/qc-list";
import QcEditorPage from "@/pages/purchase/qc-editor";
import { VendorInvoicesListPage, VendorInvoiceEditorPage } from "@/pages/purchase/vendor-invoices";
import { PaymentRequestsListPage, PaymentRequestEditorPage } from "@/pages/purchase/payment-requests";
import { PurchaseReturnsListPage, PurchaseReturnEditorPage } from "@/pages/purchase/purchase-returns";
import { LandedCostsListPage, LandedCostEditorPage } from "@/pages/purchase/landed-costs";
import VendorComparisonPage from "@/pages/purchase/vendor-comparison";
import SportCenterDashboard from "@/pages/sport-center/index";
import SportCenterBookingsPage from "@/pages/sport-center/bookings";
import SportCenterServicesPage from "@/pages/sport-center/services";
import SportCenterPurchaseRequestsPage from "@/pages/sport-center/purchase-requests";
import InventoryValuationPage from "@/pages/reports/inventory-valuation";
import SportCenterSchedulePage from "@/pages/sport-center-schedule";
import SportCenterReportPage from "@/pages/sport-center-report";
import NotificationsPage from "@/pages/notifications";
import VendorFormsPage from "@/pages/purchase/vendor-forms";
import AnalyticsDashboardPage from "@/pages/analytics-dashboard";
import VendorPerformancePage from "@/pages/logistics/vendor-performance";
import InternalTasksPage from "@/pages/logistics/internal-tasks";

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 2 * 60 * 1000,
      gcTime: 10 * 60 * 1000,
      retry: 1,
      refetchOnWindowFocus: false,
    },
  },
});
const basePath = import.meta.env.BASE_URL.replace(/\/$/, "");

const ROLE_CACHE_KEY = "biz_user_role_v1";
function readRoleCache() {
  try {
    return sessionStorage.getItem(ROLE_CACHE_KEY);
  } catch {
    return null;
  }
}
function writeRoleCache(role: string | null) {
  try {
    if (role) sessionStorage.setItem(ROLE_CACHE_KEY, role);
    else sessionStorage.removeItem(ROLE_CACHE_KEY);
  } catch {}
}

function roleToPath(role?: string | null) {
  switch (role) {
    case "admin":
      return "/dashboard";
    case "ecommerce":
      return "/ecommerce";
    case "trading":
      return "/trading";
    case "logistics":
      return "/logistics";
    case "pos":
      return "/pos";
    default:
      return "/welcome";
  }
}
function LoadingSpinner() {
  return (
    <div className="flex h-screen items-center justify-center bg-slate-950">
      <div className="h-8 w-8 animate-spin rounded-full border-4 border-indigo-500 border-t-transparent" />
    </div>
  );
}

const IS_DEV = import.meta.env.DEV;

function LoginScreen() {
  const { signInWithGoogle } = useSupabaseAuth();
  const [devEmail, setDevEmail] = React.useState("elmiraratuabadi@gmail.com");

  return (
    <div className="flex h-screen flex-col items-center justify-center gap-6 bg-slate-950 text-white">
      <div className="flex flex-col items-center gap-2">
        <div className="flex h-14 w-14 items-center justify-center rounded-2xl bg-indigo-600 text-2xl font-bold shadow-lg">
          B
        </div>
        <h1 className="text-2xl font-semibold tracking-tight">BizPortal</h1>
        <p className="text-sm text-slate-400">
          Sistem ERP Internal CST Logistics
        </p>
      </div>
      <div className="flex flex-col gap-3 w-72">
        <button
          onClick={signInWithGoogle}
          className="flex items-center justify-center gap-3 rounded-lg bg-white px-6 py-2.5 text-sm font-medium text-slate-800 shadow hover:bg-slate-100 active:scale-95 transition-all"
        >
          <svg className="h-5 w-5" viewBox="0 0 24 24">
            <path
              fill="#4285F4"
              d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"
            />
            <path
              fill="#34A853"
              d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"
            />
            <path
              fill="#FBBC05"
              d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l3.66-2.84z"
            />
            <path
              fill="#EA4335"
              d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"
            />
          </svg>
          Masuk dengan Google
        </button>
        {IS_DEV && (
          <>
            <div className="flex items-center gap-3">
              <div className="flex-1 h-px bg-slate-700" />
              <span className="text-xs text-amber-400 font-mono">DEV ONLY</span>
              <div className="flex-1 h-px bg-slate-700" />
            </div>
            <form
              method="post"
              action={`/api/dev-login?redirect=/bizportal/`}
              className="flex flex-col gap-2"
            >
              <input
                type="email"
                name="email"
                placeholder="Email (dev bypass)"
                value={devEmail}
                onChange={(e) => setDevEmail(e.target.value)}
                required
                className="rounded-lg bg-slate-800 border border-amber-600/40 px-4 py-2.5 text-sm text-white placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-amber-500"
              />
              <button
                type="submit"
                className="rounded-lg bg-amber-600 px-6 py-2.5 text-sm font-medium text-white shadow hover:bg-amber-500 active:scale-95 transition-all"
              >
                Dev Login (tanpa Google)
              </button>
            </form>
          </>
        )}
      </div>
    </div>
  );
}

function AuthRouteGuard() {
  const { isAuthenticated, isLoading } = useSupabaseAuth();
  const cachedRole = readRoleCache();
  const { data: dbUser, isLoading: dbLoading } = useGetCurrentUser({
    query: {
      enabled: isAuthenticated,
      queryKey: getGetCurrentUserQueryKey(),
      staleTime: 5 * 60 * 1000,
      retry: 1,
    },
  });
  React.useEffect(() => {
    if (dbUser?.role) writeRoleCache(dbUser.role);
  }, [dbUser?.role]);
  if (isLoading) return <LoadingSpinner />;
  if (!isAuthenticated) {
    writeRoleCache(null);
    return <LoginScreen />;
  }
  if (dbLoading) return <LoadingSpinner />;
  return <Redirect to={roleToPath(dbUser?.role ?? cachedRole)} />;
}

function Router() {
  return (
    <WouterRouter base={basePath}>
      <Switch>
        <Route path="/" component={AuthRouteGuard} />
        <Route path="/welcome" component={() => <ProtectedRoute component={WelcomePage} />} />
        <Route path="/dashboard" component={() => <ProtectedRoute component={DashboardPage} />} />
        <Route path="/approvals" component={() => <ProtectedRoute component={ApprovalsPage} />} />
        <Route path="/ecommerce" component={() => <ProtectedRoute component={EcommercePage} />} />
        <Route path="/trading" component={() => <ProtectedRoute component={TradingPage} />} />
        <Route path="/katalog-terpadu" component={() => <ProtectedRoute component={KatalogTerpaduPage} />} />
        <Route path="/pos" component={() => <ProtectedRoute component={PosPage} />} />
        {/* Logistics */}
        <Route path="/logistics" component={() => <ProtectedRoute component={LogisticsPage} />} />
        <Route path="/logistics/freight" component={() => <ProtectedRoute component={LogisticsFreightPage} />} />
        <Route path="/logistics/freight/new" component={() => <ProtectedRoute component={LogisticsFreightEditorPage} />} />
        <Route path="/logistics/freight/:id/edit" component={() => <ProtectedRoute component={LogisticsFreightEditorPage} />} />
        <Route path="/logistics/freight/:id/bl" component={() => <ProtectedRoute component={LogisticsFreightBLPage} />} />
        <Route path="/logistics/freight/:id" component={() => <ProtectedRoute component={LogisticsFreightDetailPage} />} />
        <Route path="/logistics/portal-orders" component={() => <ProtectedRoute component={LogisticsPortalOrdersPage} />} />
        <Route path="/portal/customers" component={() => <ProtectedRoute component={PortalCustomersPage} />} />
        <Route path="/logistics/portal-orders/:id" component={() => <ProtectedRoute component={LogisticsPortalOrderDetailPage} />} />
        <Route path="/logistics/drivers" component={() => <ProtectedRoute component={LogisticsDriversPage} />} />
        <Route path="/logistics/drivers/:id/performance" component={() => <ProtectedRoute component={LogisticsDriverPerformancePage} />} />
        <Route path="/logistics/driver-performance" component={() => <ProtectedRoute component={LogisticsDriverPerformancePage} />} />
        <Route path="/logistics/quote-requests" component={() => <ProtectedRoute component={LogisticsQuoteRequestsPage} />} />
        <Route path="/logistics/vendors" component={() => <ProtectedRoute component={LogisticsVendorsPage} />} />
        <Route path="/logistics/quotation-reply/:token" component={LogisticsQuotationReplyPage} />
        <Route path="/logistics/vendor-quote/:token" component={LogisticsVendorQuotePage} />
        <Route path="/logistics/rfq" component={() => <ProtectedRoute component={LogisticsRfqListPage} />} />
        <Route path="/logistics/rfq/:rfqId/detail" component={() => <ProtectedRoute component={LogisticsRfqDetailPage} />} />
        <Route path="/logistics/rfq/:rfqId/comparison" component={() => <ProtectedRoute component={LogisticsRfqComparisonPage} />} />
        <Route path="/logistics/orders/:orderId" component={() => <ProtectedRoute component={LogisticOrderDetailPage} />} />
        <Route path="/portal-product-orders" component={() => <ProtectedRoute component={PortalProductOrdersPage} />} />
        <Route path="/portal/onboarding-approvals" component={() => <ProtectedRoute component={PortalOnboardingApprovalsPage} />} />
        {/* Sales */}
        <Route path="/sales" component={() => <ProtectedRoute component={SalesDashboardPage} />} />
        <Route path="/sales/documents" component={() => <ProtectedRoute component={SalesDocumentsListPage} />} />
        <Route path="/sales/documents/new" component={() => <ProtectedRoute component={SalesDocumentEditorPage} />} />
        <Route path="/sales/documents/:id/edit" component={() => <ProtectedRoute component={SalesDocumentEditorPage} />} />
        <Route path="/sales/documents/:id" component={() => <ProtectedRoute component={SalesDocumentEditorPage} />} />
        <Route path="/sales/quotations" component={() => <ProtectedRoute component={SalesDocumentsListPage} />} />
        <Route path="/sales/quotations/new" component={() => <ProtectedRoute component={SalesDocumentEditorPage} />} />
        <Route path="/sales/quotations/:id/edit" component={() => <ProtectedRoute component={SalesDocumentEditorPage} />} />
        <Route path="/sales/quotations/:id" component={() => <ProtectedRoute component={SalesDocumentEditorPage} />} />
        <Route path="/sales/orders" component={() => <ProtectedRoute component={() => <SalesDocumentsListPage kind="order" />} />} />
        <Route path="/sales/orders/new" component={() => <ProtectedRoute component={() => <SalesDocumentEditorPage kind="order" />} />} />
        <Route path="/sales/orders/:id" component={() => <ProtectedRoute component={() => <SalesDocumentEditorPage kind="order" />} />} />
        <Route path="/sales/ai-drafts" component={() => <ProtectedRoute component={AiDraftsPage} />} />
        <Route path="/sales/customers" component={() => <ProtectedRoute component={CustomersPage} />} />
        <Route path="/sales/invoices" component={() => <ProtectedRoute component={SalesInvoicesPage} />} />
        <Route path="/sales/items" component={() => <ProtectedRoute component={SalesItemsPage} />} />
        {/* Purchase */}
        <Route path="/purchase" component={() => <ProtectedRoute component={PurchaseDashboardPage} />} />
        <Route path="/purchase/documents" component={() => <ProtectedRoute component={() => <PurchaseDocumentsListPage kind="order" />} />} />
        <Route path="/purchase/documents/new" component={() => <ProtectedRoute component={PurchaseDocumentEditorPage} />} />
        <Route path="/purchase/documents/:id/edit" component={() => <ProtectedRoute component={PurchaseDocumentEditorPage} />} />
        <Route path="/purchase/documents/:id" component={() => <ProtectedRoute component={PurchaseDocumentEditorPage} />} />
        <Route path="/purchase/rfq" component={() => <ProtectedRoute component={() => <PurchaseDocumentsListPage kind="rfq" />} />} />
        <Route path="/purchase/rfq/new" component={() => <ProtectedRoute component={PurchaseDocumentEditorPage} />} />
        <Route path="/purchase/rfq/:id" component={() => <ProtectedRoute component={PurchaseDocumentEditorPage} />} />
        <Route path="/purchase/orders" component={() => <ProtectedRoute component={POOrdersPage} />} />
        <Route path="/purchase/orders/:id" component={() => <ProtectedRoute component={PurchaseDocumentEditorPage} />} />
        <Route path="/purchase/vendors" component={() => <ProtectedRoute component={VendorsPage} />} />
        <Route path="/purchase/vendors/:id" component={() => <ProtectedRoute component={VendorDetailPage} />} />
        <Route path="/purchase/vendor-forms" component={() => <ProtectedRoute component={VendorFormsPage} />} />
        <Route path="/purchase/bills" component={() => <ProtectedRoute component={PurchaseBillsPage} />} />
        {/* Purchase Workflow */}
        <Route path="/purchase/pr" component={() => <ProtectedRoute component={PurchaseRequestListPage} />} />
        <Route path="/purchase/pr/new" component={() => <ProtectedRoute component={PurchaseRequestEditorPage} />} />
        <Route path="/purchase/pr/:id" component={() => <ProtectedRoute component={PurchaseRequestEditorPage} />} />
        <Route path="/purchase/gr" component={() => <ProtectedRoute component={GoodsReceiptListPage} />} />
        <Route path="/purchase/gr/new" component={() => <ProtectedRoute component={GoodsReceiptEditorPage} />} />
        <Route path="/purchase/gr/:id" component={() => <ProtectedRoute component={GoodsReceiptEditorPage} />} />
        <Route path="/purchase/qc" component={() => <ProtectedRoute component={QcListPage} />} />
        <Route path="/purchase/qc/new" component={() => <ProtectedRoute component={QcEditorPage} />} />
        <Route path="/purchase/qc/:id" component={() => <ProtectedRoute component={QcEditorPage} />} />
        <Route path="/purchase/vendor-invoices" component={() => <ProtectedRoute component={VendorInvoicesListPage} />} />
        <Route path="/purchase/vendor-invoices/new" component={() => <ProtectedRoute component={VendorInvoiceEditorPage} />} />
        <Route path="/purchase/vendor-invoices/:id" component={() => <ProtectedRoute component={VendorInvoiceEditorPage} />} />
        <Route path="/purchase/payment-requests" component={() => <ProtectedRoute component={PaymentRequestsListPage} />} />
        <Route path="/purchase/payment-requests/new" component={() => <ProtectedRoute component={PaymentRequestEditorPage} />} />
        <Route path="/purchase/payment-requests/:id" component={() => <ProtectedRoute component={PaymentRequestEditorPage} />} />
        <Route path="/purchase/returns" component={() => <ProtectedRoute component={PurchaseReturnsListPage} />} />
        <Route path="/purchase/returns/new" component={() => <ProtectedRoute component={PurchaseReturnEditorPage} />} />
        <Route path="/purchase/returns/:id" component={() => <ProtectedRoute component={PurchaseReturnEditorPage} />} />
        <Route path="/purchase/landed-costs" component={() => <ProtectedRoute component={LandedCostsListPage} />} />
        <Route path="/purchase/landed-costs/new" component={() => <ProtectedRoute component={LandedCostEditorPage} />} />
        <Route path="/purchase/landed-costs/:id" component={() => <ProtectedRoute component={LandedCostEditorPage} />} />
        <Route path="/purchase/rfq/:rfqId/compare" component={() => <ProtectedRoute component={VendorComparisonPage} />} />
        {/* Reports */}
        <Route path="/reports/sales" component={() => <ProtectedRoute component={ReportsSalesPage} />} />
        <Route path="/reports/purchase" component={() => <ProtectedRoute component={ReportsPurchasePage} />} />
        <Route path="/reports/ar-aging" component={() => <ProtectedRoute component={ReportsArAgingPage} />} />
        <Route path="/reports/ap-aging" component={() => <ProtectedRoute component={ReportsApAgingPage} />} />
        <Route path="/reports/operasional" component={() => <ProtectedRoute component={ReportsMainPage} />} />
        <Route path="/reports/audit-log" component={() => <ProtectedRoute component={AuditLogPage} />} />
        <Route path="/reports/inventory-valuation" component={() => <ProtectedRoute component={InventoryValuationPage} />} />
        {/* Accounting */}
        <Route path="/accounting/accounts" component={() => <ProtectedRoute component={AccountingAccountsPage} />} />
        <Route path="/accounting/journals" component={() => <ProtectedRoute component={AccountingJournalsPage} />} />
        <Route path="/accounting/taxes" component={() => <ProtectedRoute component={AccountingTaxesPage} />} />
        <Route path="/accounting/entries" component={() => <ProtectedRoute component={AccountingEntriesPage} />} />
        <Route path="/accounting/entries/:id" component={() => <ProtectedRoute component={AccountingEntryDetailPage} />} />
        <Route path="/accounting/journal-items" component={() => <ProtectedRoute component={AccountingJournalItemsPage} />} />
        <Route path="/accounting/payments" component={() => <ProtectedRoute component={AccountingPaymentsPage} />} />
        <Route path="/accounting/reconciliation" component={() => <ProtectedRoute component={AccountingReconciliationPage} />} />
        <Route path="/accounting/settings" component={() => <ProtectedRoute component={AccountingSettingsPage} />} />
        <Route path="/accounting/reports/trial-balance" component={() => <ProtectedRoute component={AccountingTrialBalancePage} />} />
        <Route path="/accounting/reports/general-ledger" component={() => <ProtectedRoute component={AccountingGeneralLedgerPage} />} />
        <Route path="/accounting/reports/profit-loss" component={() => <ProtectedRoute component={AccountingProfitLossPage} />} />
        <Route path="/accounting/reports/balance-sheet" component={() => <ProtectedRoute component={AccountingBalanceSheetPage} />} />
        {/* Expenses */}
        <Route path="/expense" component={() => <ProtectedRoute component={ExpenseListPage} />} />
        <Route path="/expense/new" component={() => <ProtectedRoute component={ExpenseEditorPage} />} />
        <Route path="/expense/categories" component={() => <ProtectedRoute component={ExpenseCategoriesPage} />} />
        <Route path="/expense/reports" component={() => <ProtectedRoute component={ExpenseReportsPage} />} />
        <Route path="/expense/:id/edit" component={() => <ProtectedRoute component={ExpenseEditorPage} />} />
        {/* Correspondence & Email */}
        <Route path="/correspondences" component={() => <ProtectedRoute component={CorrespondencesPage} />} />
        <Route path="/email-inbox" component={() => <ProtectedRoute component={EmailInboxPage} />} />
        {/* Settings & Users */}
        <Route path="/settings" component={() => <ProtectedRoute component={SettingsPage} />} />
        <Route path="/settings/nav-company-config" component={() => <ProtectedRoute component={NavCompanyConfigPage} />} />
        <Route path="/settings/ai-chatbot" component={() => <ProtectedRoute component={AiChatbotSettingsPage} />} />
        <Route path="/settings/ai-chatbot/knowledge" component={() => <ProtectedRoute component={AiChatbotKnowledgePage} />} />
        <Route path="/settings/ai-scan" component={() => <ProtectedRoute component={AiScanSettingsPage} />} />
        <Route path="/settings/roles" component={() => <ProtectedRoute component={SettingsRolesPage} />} />
        <Route path="/settings/approval-rules" component={() => <ProtectedRoute component={SettingsApprovalRulesPage} />} />
        <Route path="/users" component={() => <ProtectedRoute component={UsersPage} />} />
        <Route path="/media" component={() => <ProtectedRoute component={MediaManagerPage} />} />
        {/* Holding */}
        <Route path="/holding/dashboard" component={() => <ProtectedRoute component={HoldingDashboardPage} />} />
        <Route path="/holding/pl-report" component={() => <ProtectedRoute component={HoldingPLReportPage} />} />
        <Route path="/holding/cashflow-report" component={() => <ProtectedRoute component={HoldingCashflowReportPage} />} />
        <Route path="/holding" component={() => <ProtectedRoute component={HoldingPage} />} />
        <Route path="/org" component={() => <ProtectedRoute component={OrgManagementPage} />} />
        {/* POS Kasir Thai Tea */}
        <Route path="/pos-kasir" component={() => <ProtectedRoute component={PosKasirAdminPage} />} />
        {/* Purchase Receive */}
        <Route path="/purchase/receive" component={() => <ProtectedRoute component={PurchaseReceivePage} />} />
        {/* Thai Tea Purchase */}
        <Route path="/purchase/thai-tea" component={() => <ProtectedRoute component={ThaiTeaPurchasePage} />} />
        {/* Thai Tea CST */}
        <Route path="/thai-tea/dashboard" component={() => <ProtectedRoute component={ThaiTeaDashboardPage} />} />
        <Route path="/thai-tea/recipes" component={() => <ProtectedRoute component={ThaiTeaRecipesPage} />} />
        <Route path="/thai-tea/stock" component={() => <ProtectedRoute component={ThaiTeaStockPage} />} />
        <Route path="/thai-tea/branches" component={() => <ProtectedRoute component={ThaiTeaBranchesPage} />} />
        <Route path="/thai-tea/production" component={() => <ProtectedRoute component={ThaiTeaProductionPage} />} />
        <Route path="/thai-tea/reports" component={() => <ProtectedRoute component={ThaiTeaReportsPage} />} />
        {/* Products & BOM */}
        <Route path="/products/items" component={() => <ProtectedRoute component={ProductItemsPage} />} />
        <Route path="/products/recipes" component={() => <ProtectedRoute component={ProductRecipesPage} />} />
        {/* POS Inventory */}
        <Route path="/pos-inventory/dashboard" component={() => <ProtectedRoute component={PosInventoryDashboardPage} />} />
        <Route path="/pos-inventory/branches" component={() => <ProtectedRoute component={PosBranchesPage} />} />
        <Route path="/pos-inventory/warehouses" component={() => <ProtectedRoute component={PosWarehousesPage} />} />
        <Route path="/pos-inventory/racks" component={() => <ProtectedRoute component={PosRacksPage} />} />
        <Route path="/pos-inventory/items" component={() => <ProtectedRoute component={PosInventoryItemsPage} />} />
        <Route path="/pos-inventory/stocks" component={() => <ProtectedRoute component={PosInventoryStocksPage} />} />
        <Route path="/pos-inventory/recipes" component={() => <ProtectedRoute component={PosRecipesPage} />} />
        <Route path="/pos-inventory/losses" component={() => <ProtectedRoute component={PosStockLossesPage} />} />
        <Route path="/pos-inventory/mutations" component={() => <ProtectedRoute component={PosStockMutationsPage} />} />
        <Route path="/pos-inventory/opname" component={() => <ProtectedRoute component={PosStockOpnamePage} />} />
        <Route path="/pos-inventory/returns" component={() => <ProtectedRoute component={PosStockReturnsPage} />} />
        <Route path="/pos-inventory/transfers" component={() => <ProtectedRoute component={PosStockTransfersPage} />} />
        <Route path="/pos-inventory/qr-generator" component={() => <ProtectedRoute component={PosQrGeneratorPage} />} />
        <Route path="/pos-inventory/qr-scanner" component={() => <ProtectedRoute component={PosQrScannerPage} />} />
        {/* Sport Center */}
        <Route path="/sport-center" component={() => <ProtectedRoute component={SportCenterDashboard} />} />
        <Route path="/sport-center/bookings" component={() => <ProtectedRoute component={SportCenterBookingsPage} />} />
        <Route path="/sport-center/schedule" component={() => <ProtectedRoute component={SportCenterSchedulePage} />} />
        <Route path="/sport-center/services" component={() => <ProtectedRoute component={SportCenterServicesPage} />} />
        <Route path="/sport-center/purchase-requests" component={() => <ProtectedRoute component={SportCenterPurchaseRequestsPage} />} />
        <Route path="/sport-center/reports" component={() => <ProtectedRoute component={SportCenterReportPage} />} />
        <Route path="/notifications" component={() => <ProtectedRoute component={NotificationsPage} />} />
        {/* Analytics & Performance */}
        <Route path="/analytics" component={() => <ProtectedRoute component={AnalyticsDashboardPage} />} />
        <Route path="/logistics/vendor-performance" component={() => <ProtectedRoute component={VendorPerformancePage} />} />
        <Route path="/logistics/internal-tasks" component={() => <ProtectedRoute component={InternalTasksPage} />} />
        {/* Legacy /expenses/* → /expense/* */}
        <Route path="/expenses" component={() => <Redirect to="/expense" />} />
        <Route path="/expenses/new" component={() => <Redirect to="/expense/new" />} />
        <Route path="/expenses/categories" component={() => <Redirect to="/expense/categories" />} />
        <Route path="/expenses/reports" component={() => <Redirect to="/expense/reports" />} />
        <Route path="/expenses/:id" component={({ params }: { params: { id: string } }) => <Redirect to={`/expense/${params.id}/edit`} />} />
        {/* Legacy /warehouse/* → /pos-inventory/* */}
        <Route path="/warehouse/stock" component={() => <Redirect to="/pos-inventory/stocks" />} />
        <Route path="/warehouse/movements" component={() => <Redirect to="/pos-inventory/mutations" />} />
        <Route path="/warehouse/transfers" component={() => <Redirect to="/pos-inventory/transfers" />} />
        <Route path="/warehouse/damage" component={() => <Redirect to="/pos-inventory/losses" />} />
        <Route path="/warehouse/returns" component={() => <Redirect to="/pos-inventory/returns" />} />
        <Route path="/warehouse/recipes" component={() => <Redirect to="/pos-inventory/recipes" />} />
        <Route path="/warehouse/opname" component={() => <Redirect to="/pos-inventory/opname" />} />
        {/* Legacy /inventory/* → /pos-inventory/* */}
        <Route path="/inventory/warehouses" component={() => <Redirect to="/pos-inventory/warehouses" />} />
        <Route path="/inventory/racks" component={() => <Redirect to="/pos-inventory/racks" />} />
        <Route path="/inventory/stock" component={() => <Redirect to="/pos-inventory/stocks" />} />
        <Route path="/inventory/transfers" component={() => <Redirect to="/pos-inventory/transfers" />} />
        <Route path="/inventory/returns" component={() => <Redirect to="/pos-inventory/returns" />} />
        <Route path="/inventory/damage" component={() => <Redirect to="/pos-inventory/losses" />} />
        <Route path="/inventory/opname" component={() => <Redirect to="/pos-inventory/opname" />} />
        <Route path="/inventory/movements" component={() => <Redirect to="/pos-inventory/mutations" />} />
        <Route component={NotFound} />
      </Switch>
      <AppRoutes rootGuard={AuthRouteGuard} />
    </WouterRouter>
  );
}

export default function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <SupabaseAuthProvider>
        <LanguageProvider>
          <CompanyProvider>
          <OrderNotificationsProvider>
            <TooltipProvider>
              <Router />
              <Toaster />
            </TooltipProvider>
          </OrderNotificationsProvider>
          </CompanyProvider>
        </LanguageProvider>
      </SupabaseAuthProvider>
    </QueryClientProvider>
  );
}
