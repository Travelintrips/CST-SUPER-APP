import React from "react";
import { Switch, Route, Redirect } from "wouter";
import { withErrorBoundary } from "@/components/ErrorBoundary";
import { ProtectedRoute } from "@/components/ProtectedRoute";

// ── Lazy-loaded page chunks (each route is its own JS chunk) ─────────────
const NotFound = React.lazy(() => import("@/pages/not-found"));
const AuthCallbackPage = React.lazy(() => import("@/pages/auth-callback"));
const DashboardPage = React.lazy(() => import("@/pages/dashboard"));
const MasterDataHubPage = React.lazy(() => import("@/pages/master-data/index"));
const MasterDataWorkspacePage = React.lazy(() => import("@/pages/master-data/workspace"));
const FinanceHubPage = React.lazy(() => import("@/pages/finance/index"));
const FinanceModuleWorkspacePage = React.lazy(() => import("@/pages/finance/workspace"));
const CfoOverviewPage = React.lazy(() => import("@/pages/finance/cfo-overview"));
const LogisticsHubPage = React.lazy(() => import("@/pages/logistics/hub"));
const LogisticsWorkspacePage = React.lazy(() => import("@/pages/logistics/workspace"));
const TenantHubPage = React.lazy(() => import("@/pages/tenant/hub"));
const TenantWorkspacePage = React.lazy(() => import("@/pages/tenant/workspace"));
const PosHubPage = React.lazy(() => import("@/pages/pos/index"));
const PosWorkspacePage = React.lazy(() => import("@/pages/pos/workspace"));
const AdministrationHubPage = React.lazy(() => import("@/pages/administration/index"));
const AdministrationWorkspacePage = React.lazy(() => import("@/pages/administration/workspace"));
const CrossCompanyAccessPage = React.lazy(() => import("@/pages/administration/cross-company-access"));
const ExecutiveHubPage = React.lazy(() => import("@/pages/executive/hub"));
const ExecutiveWorkspacePage = React.lazy(() => import("@/pages/executive/workspace"));
const FinanceTransactionsPage = React.lazy(() => import("@/pages/finance/transactions"));
const AdvancedAccountingPage = React.lazy(() => import("@/pages/finance/advanced-accounting"));
const KpiDetailPage = React.lazy(() => import("@/pages/finance/kpi-detail"));
const TransactionsDetailPage = React.lazy(() => import("@/pages/finance/transactions-detail"));
const JournalEntryDetailPage = React.lazy(() => import("@/pages/finance/journal-entry-detail"));
const AiCenterHubPage = React.lazy(() => import("@/pages/ai-center/index"));
const HrHubPage = React.lazy(() => import("@/pages/hr/index"));
const EcommercePage = React.lazy(() => import("@/pages/ecommerce"));
const TradingPage = React.lazy(() => import("@/pages/trading"));
const WelcomePage = React.lazy(() => import("@/pages/welcome"));
const ApprovalsPage = React.lazy(() => import("@/pages/approvals/index"));
const KatalogTerpaduPage = React.lazy(() => import("@/pages/katalog-terpadu"));
const LogisticsPage = React.lazy(() => import("@/pages/logistics"));
const LogisticsFreightPage = React.lazy(() => import("@/pages/logistics-freight"));
const LogisticsFreightEditorPage = React.lazy(() => import("@/pages/logistics-freight-editor"));
const LogisticsFreightDetailPage = React.lazy(() => import("@/pages/logistics-freight-detail"));
const LogisticsFreightBLPage = React.lazy(() => import("@/pages/logistics-freight-bl"));
const LogisticsPortalOrdersPage = React.lazy(() => import("@/pages/logistics-portal-orders"));
const LogisticsPortalOrderDetailPage = React.lazy(() => import("@/pages/logistics-portal-order-detail"));
const ServiceRequestsPage = React.lazy(() => import("@/pages/service-requests"));
const ServiceRequestDetailPage = React.lazy(() => import("@/pages/service-request-detail"));
const LogisticsDriversPage = React.lazy(() => import("@/pages/logistics-drivers"));
const LogisticsDriverPerformancePage = React.lazy(() => import("@/pages/logistics-driver-performance"));
const DriverAnalyticsDashboardPage = React.lazy(() => import("@/pages/logistics/drivers-analytics"));
const TruckingOrdersPage = React.lazy(() => import("@/pages/logistics/trucking-orders"));
const LogisticsQuoteRequestsPage = React.lazy(() => import("@/pages/logistics-quote-requests"));
const LogisticsVendorsPage = React.lazy(() => import("@/pages/logistics-vendors"));
const LogisticsQuotationReplyPage = React.lazy(() => import("@/pages/logistics-quotation-reply"));
const LogisticsVendorQuotePage = React.lazy(() => import("@/pages/logistics-vendor-quote"));
const LogisticsMarginRulesPage = React.lazy(() => import("@/pages/logistics-margin-rules"));
const LogisticsRateManagementPage = React.lazy(() => import("@/pages/logistics/rate-management"));
const PortalProductOrdersPage = React.lazy(() => import("@/pages/portal-product-orders"));
const SalesHubPage = React.lazy(() => import("@/pages/sales/hub"));
const SalesWorkspacePage = React.lazy(() => import("@/pages/sales/workspace"));
const SalesDashboardPage = React.lazy(() => import("@/pages/sales/dashboard"));
const SalesDocumentsListPage = React.lazy(() => import("@/pages/sales/documents-list"));
const SalesDocumentEditorPage = React.lazy(() => import("@/pages/sales/quotation-editor"));
const SalesDocumentDetailPage = React.lazy(() => import("@/pages/sales/document-detail"));
const AiDraftsPage = React.lazy(() => import("@/pages/sales/ai-drafts"));
const CustomersPage = React.lazy(() => import("@/pages/sales/customers"));
const SalesInvoicesPage = React.lazy(() => import("@/pages/sales/invoices"));
const SalesItemsPage = React.lazy(() => import("@/pages/sales/items"));
const PurchaseHubPage = React.lazy(() => import("@/pages/purchase/hub"));
const PurchaseWorkspacePage = React.lazy(() => import("@/pages/purchase/workspace"));
const PurchaseDashboardPage = React.lazy(() => import("@/pages/purchase/dashboard"));
const PurchaseDocumentsListPage = React.lazy(() => import("@/pages/purchase/documents-list"));
const PurchaseDocumentEditorPage = React.lazy(() => import("@/pages/purchase/rfq-editor"));
const PurchaseRequestListPage = React.lazy(() => import("@/pages/purchase/pr-list"));
const PurchaseRequestEditorPage = React.lazy(() => import("@/pages/purchase/pr-editor"));
const VendorsPage = React.lazy(() => import("@/pages/purchase/vendors"));
const VendorDetailPage = React.lazy(() => import("@/pages/purchase/vendor-detail"));
const VendorCompletionPage = React.lazy(() => import("@/pages/purchase/vendor-completion"));
const PurchaseBillsPage = React.lazy(() => import("@/pages/purchase/bills"));
const GoodsReceiptListPage = React.lazy(() => import("@/pages/purchase/gr-list"));
const GoodsReceiptEditorPage = React.lazy(() => import("@/pages/purchase/gr-editor"));
const QcListPage = React.lazy(() => import("@/pages/purchase/qc-list"));
const QcEditorPage = React.lazy(() => import("@/pages/purchase/qc-editor"));
const PurchaseReturnsListPage = React.lazy(() => import("@/pages/purchase/purchase-returns").then(m => ({ default: m.PurchaseReturnsListPage })));
const PurchaseReturnEditorPage = React.lazy(() => import("@/pages/purchase/purchase-returns").then(m => ({ default: m.PurchaseReturnEditorPage })));
const TaxDashboardPage = React.lazy(() => import("@/pages/tax/dashboard"));
const TaxReconciliationPage = React.lazy(() => import("@/pages/tax/reconciliation"));
const TaxRulesPage = React.lazy(() => import("@/pages/tax/rules"));
const TaxTransactionsPage = React.lazy(() => import("@/pages/tax/transactions"));
const TaxPpnPage = React.lazy(() => import("@/pages/tax/ppn"));
const TaxPphPage = React.lazy(() => import("@/pages/tax/pph"));
const TaxSptPage = React.lazy(() => import("@/pages/tax/spt"));
const TaxSptBuilderPage = React.lazy(() => import("@/pages/tax/spt-builder"));
const TaxExportDjpPage = React.lazy(() => import("@/pages/tax/export-djp"));
const TaxAuditPage = React.lazy(() => import("@/pages/tax/audit"));
const TaxSptControlPage = React.lazy(() => import("@/pages/tax/spt-control"));
const ProductTemplatesPage = React.lazy(() => import("@/pages/product-templates/index"));
const ProductTemplateDetailPage = React.lazy(() => import("@/pages/product-templates/detail"));
const VendorInvoicesListPage = React.lazy(() => import("@/pages/purchase/vendor-invoices").then(m => ({ default: m.VendorInvoicesListPage })));
const VendorInvoiceEditorPage = React.lazy(() => import("@/pages/purchase/vendor-invoices").then(m => ({ default: m.VendorInvoiceEditorPage })));
const InvoiceOcrImportPage = React.lazy(() => import("@/pages/purchase/InvoiceOcrImport"));
const PaymentRequestsListPage = React.lazy(() => import("@/pages/purchase/payment-requests").then(m => ({ default: m.PaymentRequestsListPage })));
const PaymentRequestEditorPage = React.lazy(() => import("@/pages/purchase/payment-requests").then(m => ({ default: m.PaymentRequestEditorPage })));
const LandedCostsListPage = React.lazy(() => import("@/pages/purchase/landed-costs").then(m => ({ default: m.LandedCostsListPage })));
const LandedCostEditorPage = React.lazy(() => import("@/pages/purchase/landed-costs").then(m => ({ default: m.LandedCostEditorPage })));
const VendorComparisonPage = React.lazy(() => import("@/pages/purchase/vendor-comparison"));
const PurchaseReceivePage = React.lazy(() => import("@/pages/purchase/receive"));
const VendorCatalogPage = React.lazy(() => import("@/pages/purchase/vendor-catalog"));
const VendorCatalogEnginePage = React.lazy(() => import("@/pages/purchase/vendor-catalog-engine"));
const TruckingPricingPage = React.lazy(() => import("@/pages/purchase/trucking-pricing"));
const MarketplaceAiImagesPage = React.lazy(() => import("@/pages/marketplace-ai-images"));
const MarketplaceAnalyticsPage = React.lazy(() => import("@/pages/purchase/marketplace-analytics"));
const MktRfqListPage = React.lazy(() => import("@/pages/marketplace/rfq-list"));
const MktRfqDetailPage = React.lazy(() => import("@/pages/marketplace/rfq-detail"));
const MktRfqComparisonPage = React.lazy(() => import("@/pages/marketplace/rfq-comparison"));
const MktPoListPage = React.lazy(() => import("@/pages/marketplace/po-list"));
const MktPoDetailPage = React.lazy(() => import("@/pages/marketplace/po-detail"));
const FeaturedMaintenancePage = React.lazy(() => import("@/pages/marketplace/featured-maintenance"));
const ProdukUnggulanPage = React.lazy(() => import("@/pages/marketplace/produk-unggulan"));
const MasterPricePage = React.lazy(() => import("@/pages/marketplace/master-price"));
const QaFixtureManagerPage = React.lazy(() => import("@/pages/marketplace/qa-fixture-manager"));
const ReportsIndexPage = React.lazy(() => import("@/pages/reports/index"));
const ReportsSalesPage = React.lazy(() => import("@/pages/reports/sales"));
const ReportsPurchasePage = React.lazy(() => import("@/pages/reports/purchase"));
const ReportsArAgingPage = React.lazy(() => import("@/pages/reports/ar-aging"));
const ReportsApAgingPage = React.lazy(() => import("@/pages/reports/ap-aging"));
const ReportsMainPage = React.lazy(() => import("@/pages/reports/main"));
const AuditLogPage = React.lazy(() => import("@/pages/reports/audit-log"));
const InventoryValuationPage = React.lazy(() => import("@/pages/reports/inventory-valuation"));
const FinanceWorkspacePage = React.lazy(() => import("@/pages/accounting/finance-workspace"));
const AccountingDashboardPage = React.lazy(() => import("@/pages/accounting/dashboard"));
const AccountingAccountsPage = React.lazy(() => import("@/pages/accounting/accounts"));
const AccountingJournalsPage = React.lazy(() => import("@/pages/accounting/journals"));
const AccountingTaxesPage = React.lazy(() => import("@/pages/accounting/taxes"));
const AccountingEntriesPage = React.lazy(() => import("@/pages/accounting/entries"));
const AccountingEntryDetailPage = React.lazy(() => import("@/pages/accounting/entry-detail"));
const AccountingJournalItemsPage = React.lazy(() => import("@/pages/accounting/journal-items"));
const AccountingPaymentsPage = React.lazy(() => import("@/pages/accounting/payments"));
const AccountingOtherTransactionsPage = React.lazy(() => import("@/pages/accounting/other-transactions"));
const BankDisbursementsPage = React.lazy(() => import("@/pages/accounting/bank-disbursements"));
const BankReceiptsPage = React.lazy(() => import("@/pages/accounting/bank-receipts"));
const KasBankPage = React.lazy(() => import("@/pages/accounting/kas-bank"));
const CashFlowForecastPage = React.lazy(() => import("@/pages/accounting/cash-flow-forecast"));
const CashBankDashboardPage = React.lazy(() => import("@/pages/cash-bank/dashboard"));
const CashBankAccountsPage = React.lazy(() => import("@/pages/cash-bank/accounts"));
const CashBankMutationsPage = React.lazy(() => import("@/pages/cash-bank/mutations"));
const CashBankImportsPage = React.lazy(() => import("@/pages/cash-bank/imports"));
const CashBankTransfersPage = React.lazy(() => import("@/pages/cash-bank/transfers"));
const CashBankForecastPage = React.lazy(() => import("@/pages/cash-bank/forecast"));
const CashBankPettyCashPage = React.lazy(() => import("@/pages/cash-bank/petty-cash"));
const CashBankSettingsPage = React.lazy(() => import("@/pages/cash-bank/settings"));
const AccountingSettingsPage = React.lazy(() => import("@/pages/accounting/settings"));
const WaReportSettingsPage = React.lazy(() => import("@/pages/accounting/wa-report-settings"));
const CostCentersPage = React.lazy(() => import("@/pages/accounting/cost-centers"));
const AccountingFreightProfitabilityPage = React.lazy(() => import("@/pages/accounting/reports/freight-profitability"));
const AccountingCashFlowPage = React.lazy(() => import("@/pages/accounting/reports/cash-flow"));
const AccountingReconciliationPage = React.lazy(() => import("@/pages/accounting/reconciliation"));
const AccountingHubIndexPage = React.lazy(() => import("@/pages/accounting/hub/index"));
const AccountingHubGLPage = React.lazy(() => import("@/pages/accounting/hub/general-ledger"));
const AccountingHubTrialBalancePage = React.lazy(() => import("@/pages/accounting/hub/trial-balance"));
const AccountingHubPLPage = React.lazy(() => import("@/pages/accounting/hub/profit-loss"));
const AccountingHubBalanceSheetPage = React.lazy(() => import("@/pages/accounting/hub/balance-sheet"));
const AccountingHubPaymentsPage = React.lazy(() => import("@/pages/accounting/hub/payments"));
const AccountingHubPostingErrorsPage = React.lazy(() => import("@/pages/accounting/hub/posting-errors"));
const AccountingHubCOAMappingPage = React.lazy(() => import("@/pages/accounting/hub/coa-mapping"));
const BankReconciliationPage = React.lazy(() => import("@/pages/accounting/bank-reconciliation"));
const BankReconPage = React.lazy(() => import("@/pages/accounting/bank-recon"));
const BankMutationImportPage = React.lazy(() => import("@/pages/accounting/bank-mutation-import"));
const BankMutationImportDetailPage = React.lazy(() => import("@/pages/accounting/bank-mutation-import-detail"));
const SmartBankReconPage = React.lazy(() => import("@/pages/accounting/smart-bank-recon"));
const BankReconClassificationPage = React.lazy(() => import("@/pages/accounting/bank-recon-classification"));
const CoaMappingPage = React.lazy(() => import("@/pages/accounting/coa-mapping"));
const TaxMappingPage = React.lazy(() => import("@/pages/accounting/tax-mapping"));
const BankAccountsMasterPage = React.lazy(() => import("@/pages/accounting/bank-accounts-master"));
const EntityReviewPage = React.lazy(() => import("@/pages/accounting/entity-review"));
const PlByBuPage = React.lazy(() => import("@/pages/accounting/pl-by-bu"));
const AuditImportPage = React.lazy(() => import("@/pages/accounting/audit-import"));
const AccountingGSheetPage = React.lazy(() => import("@/pages/accounting/gsheet"));
const WhtReconciliationPage = React.lazy(() => import("@/pages/accounting/wht-reconciliation"));
const TaxReportPage = React.lazy(() => import("@/pages/accounting/tax-report"));
const AccountingAuditReportPage = React.lazy(() => import("@/pages/accounting/audit-report"));
const ClosingEntriesPage = React.lazy(() => import("@/pages/accounting/closing-entries"));
const ClosingWizardPage = React.lazy(() => import("@/pages/accounting/closing-wizard"));
const LedgerImmutablePage = React.lazy(() => import("@/pages/accounting/ledger-immutable"));
const GovernancePage = React.lazy(() => import("@/pages/accounting/governance"));
const CoaGovernancePage = React.lazy(() => import("@/pages/accounting/coa-governance"));
const CoaProposalsPage = React.lazy(() => import("@/pages/accounting/coa-proposals"));
const CoaProposalDetailPage = React.lazy(() => import("@/pages/accounting/coa-proposal-detail"));
const PostingMonitorPage = React.lazy(() => import("@/pages/accounting/posting-monitor"));
const ResetTransactionsPage = React.lazy(() => import("@/pages/accounting/reset-transactions"));
const FinancialReconciliationPage = React.lazy(() => import("@/pages/accounting/financial-reconciliation"));
const PeriodClosingStatusPage = React.lazy(() => import("@/pages/accounting/period-closing-status"));
const TaxMissingCompliancePage = React.lazy(() => import("@/pages/tax/missing-compliance"));
const HoldingPage = React.lazy(() => import("@/pages/HoldingPage"));
const ExecutiveDashboardPage = React.lazy(() => import("@/pages/executive/dashboard"));
const ExecutiveLogisticsDashboardPage = React.lazy(() => import("@/pages/executive/logistics-dashboard"));
const HoldingDashboardPage = React.lazy(() => import("@/pages/accounting/holding-dashboard"));
const HoldingPLReportPage = React.lazy(() => import("@/pages/accounting/holding-pl-report"));
const HoldingCashflowReportPage = React.lazy(() => import("@/pages/accounting/holding-cashflow-report"));
const HoldingGroupDetailPage = React.lazy(() => import("@/pages/accounting/holding-group-detail"));
const ExpenseListPage = React.lazy(() => import("@/pages/expense/index"));
const ExpenseEditorPage = React.lazy(() => import("@/pages/expense/editor"));
const ExpenseCategoriesPage = React.lazy(() => import("@/pages/expense/categories"));
const ExpenseReportsPage = React.lazy(() => import("@/pages/expense/reports"));
const ExpenseRoutinePage = React.lazy(() => import("@/pages/expense/routine"));
const KasbonPage = React.lazy(() => import("@/pages/expense/kasbon"));
const TalanganPage = React.lazy(() => import("@/pages/expense/talangan"));
const DanaKaryawanPage = React.lazy(() => import("@/pages/expense/dana-karyawan"));
const AdvanceManagementPage = React.lazy(() => import("@/pages/finance/advance-management"));
const AllocationCenterPage = React.lazy(() => import("@/pages/finance/allocation-center"));
const AllocationCreatePage = React.lazy(() => import("@/pages/finance/allocation-create"));
const BankAllocationPage = React.lazy(() => import("@/pages/finance/bank-allocation"));
const VendorInstallmentsPage = React.lazy(() => import("@/pages/expense/vendor-installments"));
const BankLoansPage = React.lazy(() => import("@/pages/expense/bank-loans"));
const FixedAssetsPage = React.lazy(() => import("@/pages/expense/fixed-assets"));
const AuditDanaTalanganPage = React.lazy(() => import("@/pages/expense/audit-dana-talangan"));
const AuditDisbursementPage = React.lazy(() => import("@/pages/expense/audit-disbursement"));
const VendorPaymentsPage = React.lazy(() => import("@/pages/expense/vendor-payments"));
const AssetDepreciationPage = React.lazy(() => import("@/pages/expense/asset-depreciation"));
const ExpenseApprovalsPage = React.lazy(() => import("@/pages/expense/approvals"));
const KasTransferPage = React.lazy(() => import("@/pages/expense/kas-transfer"));
const ExpenseDashboardPage = React.lazy(() => import("@/pages/expense/dashboard"));
const ExpenseTemplatesPage = React.lazy(() => import("@/pages/expense/templates"));
const ExpenseBudgetPage = React.lazy(() => import("@/pages/expense/budget"));
const CorrespondencesPage = React.lazy(() => import("@/pages/correspondences"));
const EmailInboxPage = React.lazy(() => import("@/pages/email-inbox"));
const SettingsPage = React.lazy(() => import("@/pages/settings"));
const AiChatbotSettingsPage = React.lazy(() => import("@/pages/ai-chatbot-settings"));
const AiChatbotKnowledgePage = React.lazy(() => import("@/pages/ai-chatbot-knowledge"));
const AiScanSettingsPage = React.lazy(() => import("@/pages/ai-scan-settings"));
const UomPage = React.lazy(() => import("@/pages/settings/uom"));
const ServiceTemplatesSettingsPage = React.lazy(() => import("@/pages/settings/service-templates"));
const NavCompanyConfigPage = React.lazy(() => import("@/pages/settings/nav-company-config"));
const CompanyProfilePage = React.lazy(() => import("@/pages/settings/company-profile"));
const ShortLinksPage = React.lazy(() => import("@/pages/settings/short-links"));
const WaTemplatesPage = React.lazy(() => import("@/pages/settings/wa-templates"));
const EnterpriseWaTemplatesPage = React.lazy(() => import("@/pages/settings/enterprise-wa-templates"));
const LogisticsUnitsPage = React.lazy(() => import("@/pages/settings/logistics-units"));
const TruckingRatesPage = React.lazy(() => import("@/pages/settings/trucking-rates"));
const VehicleImagesPage = React.lazy(() => import("@/pages/settings/vehicle-images"));
const SettingsRolesPage = React.lazy(() => import("@/pages/settings-roles"));
const SettingsApprovalRulesPage = React.lazy(() => import("@/pages/settings-approval-rules"));
const ApprovalMatrixPage = React.lazy(() => import("@/pages/approval-matrix"));
const UsersPage = React.lazy(() => import("@/pages/users"));
const MediaManagerPage = React.lazy(() => import("@/pages/media-manager"));
const OrgManagementPage = React.lazy(() => import("@/pages/OrgManagementPage"));
const AuditReportListPage = React.lazy(() => import("@/pages/audit/index"));
const AuditReportFormPage = React.lazy(() => import("@/pages/audit/form"));
const AuditComparePage = React.lazy(() => import("@/pages/audit/compare"));
const WaNotificationLogsPage = React.lazy(() => import("@/pages/settings/wa-notification-logs"));
const DocumentTemplatesPage = React.lazy(() => import("@/pages/settings/document-templates"));
const AppSecretsPage = React.lazy(() => import("@/pages/settings/app-secrets"));

const SecurityCenterPage = React.lazy(() => import("@/pages/settings/security-center"));
const SystemHealthPage = React.lazy(() => import("@/pages/system-health"));
const ObservabilityErrorsPage = React.lazy(() => import("@/pages/system/observability-errors"));
const DbSyncPage = React.lazy(() => import("@/pages/admin/db-sync"));
const AdminPortalPage = React.lazy(() => import("@/pages/admin/portal"));
const ProductItemsPage = React.lazy(() => import("@/pages/products/items"));
const ProductRecipesPage = React.lazy(() => import("@/pages/products/recipes"));
const PortalCustomersPage = React.lazy(() => import("@/pages/portal-customers"));
const PortalOnboardingApprovalsPage = React.lazy(() => import("@/pages/portal-onboarding-approvals"));
const PortalCustomerVerificationPage = React.lazy(() => import("@/pages/portal-customer-verification"));
const PortalQuickQuotesPage = React.lazy(() => import("@/pages/portal-quick-quotes"));
const LogisticsRfqListPage = React.lazy(() => import("@/pages/logistics-rfq-list"));
const LogisticsRfqDetailPage = React.lazy(() => import("@/pages/logistics-rfq-detail"));
const LogisticsRfqComparisonPage = React.lazy(() => import("@/pages/logistics-rfq-comparison"));
const LogisticOrderDetailPage = React.lazy(() => import("@/pages/logistics/order-detail"));
const OrderAuditTrailPage = React.lazy(() => import("@/pages/logistics/order-audit-trail"));
const VendorPerformancePage = React.lazy(() => import("@/pages/logistics/vendor-performance"));
const VendorRecommendationPage = React.lazy(() => import("@/pages/logistics/vendor-recommendation"));
const VendorCommodityIntelligencePage = React.lazy(() => import("@/pages/logistics/vendor-commodity-intelligence"));
const InternalTasksPage = React.lazy(() => import("@/pages/logistics/internal-tasks"));
const FleetIntelligenceDashboard = React.lazy(() => import("@/pages/logistics/fleet-intelligence/index"));
const FleetUploadPage = React.lazy(() => import("@/pages/logistics/fleet-intelligence/upload"));
const FleetDriversPage = React.lazy(() => import("@/pages/logistics/fleet-intelligence/drivers"));
const FleetVehiclesPage = React.lazy(() => import("@/pages/logistics/fleet-intelligence/vehicles"));
const FleetTransactionsPage = React.lazy(() => import("@/pages/logistics/fleet-intelligence/transactions"));
const FleetOutstandingPage = React.lazy(() => import("@/pages/logistics/fleet-intelligence/outstanding"));
const FleetAnalyticsPage = React.lazy(() => import("@/pages/logistics/fleet-intelligence/analytics"));
const FleetAlertsPage = React.lazy(() => import("@/pages/logistics/fleet-intelligence/alerts"));
const FleetAccountingPage = React.lazy(() => import("@/pages/logistics/fleet-intelligence/accounting"));
const FleetValidationPage = React.lazy(() => import("@/pages/logistics/fleet-intelligence/validation"));
const FleetExpensesPage = React.lazy(() => import("@/pages/logistics/fleet-intelligence/expenses"));
const FleetControlCenterPage = React.lazy(() => import("@/pages/logistics/fleet-intelligence/control-center"));
const FleetDLQPage = React.lazy(() => import("@/pages/logistics/fleet-intelligence/dlq"));
const LedgerExplorerPage = React.lazy(() => import("@/pages/logistics/fleet-intelligence/ledger-explorer"));
const FleetReconciliationPage = React.lazy(() => import("@/pages/logistics/fleet-intelligence/reconciliation"));
const PipelineMonitorPage = React.lazy(() => import("@/pages/logistics/fleet-intelligence/pipeline-monitor"));
const FleetDriverDetailPage = React.lazy(() => import("@/pages/logistics/fleet-intelligence/driver-detail"));
const DriverMacetPage = React.lazy(() => import("@/pages/logistics/fleet-intelligence/driver-macet"));
const FleetCashPaymentsPage = React.lazy(() => import("@/pages/logistics/fleet-intelligence/cash-payments"));
const LogisticsVendorFulfillmentsPage = React.lazy(() => import("@/pages/logistics-vendor-fulfillments"));
const LogisticsVendorFulfillmentDetailPage = React.lazy(() => import("@/pages/logistics-vendor-fulfillment-detail"));
const ProductFirstAnalyticsPage = React.lazy(() => import("@/pages/logistics/product-first-analytics"));
const ProductFirstAuditPage = React.lazy(() => import("@/pages/logistics/product-first-audit"));
const FreightDocVerifyPage = React.lazy(() => import("@/pages/logistics/freight-doc-verify"));
const LogisticsImportAssistantPage = React.lazy(() => import("@/pages/logistics-import-assistant"));
const AirFreightVendorFormPage = React.lazy(() => import("@/pages/air-freight-vendor-form"));
const OceanFreightOrdersPage = React.lazy(() => import("@/pages/logistics/ocean-freight-orders"));
const OceanFreightOrderDetailPage = React.lazy(() => import("@/pages/logistics/ocean-freight-order-detail"));
const OceanFreightRatesPage = React.lazy(() => import("@/pages/logistics/ocean-freight-rates"));
const OceanFreightMasterDataPage = React.lazy(() => import("@/pages/logistics/ocean-freight-master-data"));
const ExceptionsPage = React.lazy(() => import("@/pages/exceptions/index"));
const NotificationsPage = React.lazy(() => import("@/pages/notifications"));
const IntelligenceAlertsPage = React.lazy(() => import("@/pages/intelligence-alerts"));
const AiApprovalsPage = React.lazy(() => import("@/pages/ai-approvals"));
const OperationalContextPage = React.lazy(() => import("@/pages/operational-context"));
const AiReviewIndexPage = React.lazy(() => import("@/pages/ai-review/index"));
const AiReviewQueuePage = React.lazy(() => import("@/pages/ai-review/queue"));
const AiReviewDetailPage = React.lazy(() => import("@/pages/ai-review/detail"));
const AiReviewObservabilityPage = React.lazy(() => import("@/pages/ai-review/observability"));
const AiLearningPage = React.lazy(() => import("@/pages/ai-review/learning"));
const AiRecommendationsPage = React.lazy(() => import("@/pages/ai-review/recommendations"));
const AiStatisticsPage = React.lazy(() => import("@/pages/ai-review/statistics"));
const AiLearningDetailPage = React.lazy(() => import("@/pages/ai-review/learning-detail"));
const AiRecommendationDetailPage = React.lazy(() => import("@/pages/ai-review/recommendation-detail"));
const AiDecisionMemoryPage = React.lazy(() => import("@/pages/ai-decision-memory"));
const WaNotificationHistoryPage = React.lazy(() => import("@/pages/wa-notification-history"));
const VendorLeaderboardPage = React.lazy(() => import("@/pages/vendor-leaderboard"));
const AnalyticsDashboardPage = React.lazy(() => import("@/pages/analytics-dashboard"));
const ProfitabilityAnalyticsPage = React.lazy(() => import("@/pages/analytics/profitability"));
const RouteProfitabilityPage = React.lazy(() => import("@/pages/analytics/route-profitability"));
const CommodityProfitabilityPage = React.lazy(() => import("@/pages/analytics/commodity-profitability"));
const CeoDashboardPage = React.lazy(() => import("@/pages/ceo-dashboard"));
const EnterpriseDashboardPage = React.lazy(() => import("@/pages/enterprise-dashboard"));
const OperationalDashboardPage = React.lazy(() => import("@/pages/operational-dashboard"));
const POOrdersPage = React.lazy(() => import("@/pages/purchase/po-orders"));
const VendorFormsPage = React.lazy(() => import("@/pages/purchase/vendor-forms"));
const VmfAuditTrailPage = React.lazy(() => import("@/pages/purchase/vmf-audit-trail"));
const SapAuditTrailPage = React.lazy(() => import("@/pages/purchase/sap-audit-trail"));
const SportCenterDashboard = React.lazy(() => import("@/pages/sport-center/dashboard"));
const SportCenterBookings = React.lazy(() => import("@/pages/sport-center/bookings"));
const SportCenterFacilities = React.lazy(() => import("@/pages/sport-center/facilities"));
const SportCenterCustomers = React.lazy(() => import("@/pages/sport-center/customers"));
const SportCenterMembers = React.lazy(() => import("@/pages/sport-center/members"));
const SportCenterPricingRules = React.lazy(() => import("@/pages/sport-center/pricing-rules"));
const SportCenterPayments = React.lazy(() => import("@/pages/sport-center/payments"));
const SportCenterCompanyInvoices = React.lazy(() => import("@/pages/sport-center/company-invoices"));
const SportCenterReports = React.lazy(() => import("@/pages/sport-center/reports"));
const SportCenterSettings = React.lazy(() => import("@/pages/sport-center/settings"));
const SportCenterProfitability = React.lazy(() => import("@/pages/sport-center/profitability"));
const SportCenterExpenses = React.lazy(() => import("@/pages/sport-center/expenses"));
const TenantDashboard = React.lazy(() => import("@/pages/tenant/dashboard"));
const TenantList = React.lazy(() => import("@/pages/tenant/tenants"));
const TenantUnits = React.lazy(() => import("@/pages/tenant/units"));
const TenantBookings = React.lazy(() => import("@/pages/tenant/bookings"));
const TenantPayments = React.lazy(() => import("@/pages/tenant/payments"));
const TenantInvoices = React.lazy(() => import("@/pages/tenant/invoices"));
const TenantMallUnits = React.lazy(() => import("@/pages/tenant/mall-units"));
const PosTenant = React.lazy(() => import("@/pages/tenant/pos-tenant"));
const KasirCompanies = React.lazy(() => import("@/pages/tenant/kasir-companies"));
const KasirBranches = React.lazy(() => import("@/pages/tenant/kasir-branches"));
const KasirUsers = React.lazy(() => import("@/pages/tenant/kasir-users"));
const KasirProducts = React.lazy(() => import("@/pages/tenant/kasir-products"));
const KasirDevices = React.lazy(() => import("@/pages/tenant/kasir-devices"));
const PosBranches = React.lazy(() => import("@/pages/tenant/pos-branches"));
const PosCashiers = React.lazy(() => import("@/pages/tenant/pos-cashiers"));
const PosProducts = React.lazy(() => import("@/pages/tenant/pos-products"));
const PosRoles = React.lazy(() => import("@/pages/tenant/pos-roles"));
const PosSettings = React.lazy(() => import("@/pages/tenant/pos-settings"));
const TenantRekap = React.lazy(() => import("@/pages/tenant/rekap"));
const TenantLaporanKeuangan = React.lazy(() => import("@/pages/tenant/laporan-keuangan"));
const TenantRekonsiliasi = React.lazy(() => import("@/pages/tenant/rekonsiliasi"));
const TenantPerbandinganLokasi = React.lazy(() => import("@/pages/tenant/perbandingan-lokasi"));
const TenantKirimWa = React.lazy(() => import("@/pages/tenant/kirim-wa"));
const TenantAuditLog = React.lazy(() => import("@/pages/tenant/audit-log"));
const TenantPengaturan = React.lazy(() => import("@/pages/tenant/pengaturan"));
const AirFreightNewOrdersPage = React.lazy(() => import("@/pages/air-freight/orders"));
const AirFreightRatesPage = React.lazy(() => import("@/pages/air-freight/rates"));
const AirFreightNewOrderDetailPage = React.lazy(() => import("@/pages/air-freight/order-detail"));
const AirFreightApprovalPage = React.lazy(() => import("@/pages/air-freight/approval"));
const AirFreightTrackPage = React.lazy(() => import("@/pages/air-freight/track"));
const PpjkPage = React.lazy(() => import("@/pages/logistics/ppjk"));
const PpjkDetailPage = React.lazy(() => import("@/pages/logistics/ppjk-detail"));
const UnifiedShipmentsPage = React.lazy(() => import("@/pages/logistics/shipments"));

// Loading fallback shown while a page chunk is fetching
function PageLoadingFallback() {
  return (
    <div className="flex h-screen items-center justify-center bg-slate-950">
      <div className="h-8 w-8 animate-spin rounded-full border-4 border-indigo-500 border-t-transparent" />
    </div>
  );
}
const PR = (C: React.ComponentType) => () => <ProtectedRoute component={C} />;

// Fleet Intelligence — wrapped at module level (not inline) to keep stable component refs
const FleetUploadPageEB = withErrorBoundary(FleetUploadPage, "Fleet Intelligence – Upload");
const FleetDriversPageEB = withErrorBoundary(FleetDriversPage, "Fleet Intelligence – Drivers");
const FleetVehiclesPageEB = withErrorBoundary(FleetVehiclesPage, "Fleet Intelligence – Vehicles");
const FleetTransactionsPageEB = withErrorBoundary(FleetTransactionsPage, "Fleet Intelligence – Transactions");
const FleetOutstandingPageEB = withErrorBoundary(FleetOutstandingPage, "Fleet Intelligence – Outstanding");
const FleetAnalyticsPageEB = withErrorBoundary(FleetAnalyticsPage, "Fleet Intelligence – Analytics");
const FleetAlertsPageEB = withErrorBoundary(FleetAlertsPage, "Fleet Intelligence – Alerts");
const FleetAccountingPageEB = withErrorBoundary(FleetAccountingPage, "Fleet Intelligence – Accounting");
const FleetValidationPageEB = withErrorBoundary(FleetValidationPage, "Fleet Intelligence – Validation");
const FleetExpensesPageEB = withErrorBoundary(FleetExpensesPage, "Fleet Intelligence – Expenses");
const FleetControlCenterEB = withErrorBoundary(FleetControlCenterPage, "Fleet Intelligence – Control Center");
const FleetDashboardEB = withErrorBoundary(FleetIntelligenceDashboard, "Fleet Intelligence – Dashboard");
const FleetDLQPageEB = withErrorBoundary(FleetDLQPage, "Fleet Intelligence – DLQ Retry Panel");
const LedgerExplorerPageEB = withErrorBoundary(LedgerExplorerPage, "Fleet Intelligence – Ledger Explorer");
const FleetReconciliationEB = withErrorBoundary(FleetReconciliationPage, "Fleet Intelligence – Rekonsiliasi Pipeline");
const PipelineMonitorEB = withErrorBoundary(PipelineMonitorPage, "Fleet Intelligence – Pipeline Monitor");
const FleetDriverDetailEB = withErrorBoundary(FleetDriverDetailPage, "Fleet Intelligence – Driver Detail");
const DriverMacetPageEB = withErrorBoundary(DriverMacetPage, "Fleet Intelligence – Driver Macet");
const FleetCashPaymentsPageEB = withErrorBoundary(FleetCashPaymentsPage, "Fleet Intelligence – Cash Payments");

export function AppRoutes({ rootGuard }: { rootGuard?: React.ComponentType }) {
  return (
    <React.Suspense fallback={<PageLoadingFallback />}>
      <Switch>
      {rootGuard && <Route path="/" component={rootGuard} />}

      {/* ── Auth callback (Supabase OAuth popup) ───────────────────────── */}
      <Route path="/auth/callback" component={AuthCallbackPage} />

      {/* ── Welcome / Dashboard ────────────────────────────────────────── */}
      <Route path="/welcome" component={WelcomePage} />
      <Route path="/dashboard" component={PR(DashboardPage)} />
      <Route path="/ceo-dashboard" component={PR(CeoDashboardPage)} />
      <Route path="/ai/decision-memory" component={PR(AiDecisionMemoryPage)} />
      <Route path="/approvals" component={PR(ApprovalsPage)} />
      <Route path="/ecommerce" component={PR(EcommercePage)} />
      <Route path="/trading" component={PR(TradingPage)} />

      {/* ── Logistics ──────────────────────────────────────────────────── */}
      <Route path="/katalog-terpadu" component={PR(KatalogTerpaduPage)} />
      <Route path="/products/items" component={PR(ProductItemsPage)} />
      <Route path="/products/recipes" component={PR(ProductRecipesPage)} />
      <Route path="/logistics" component={PR(LogisticsHubPage)} />
      <Route path="/logistics/workspace/:section" component={PR(LogisticsWorkspacePage)} />
      <Route path="/logistics/freight/new" component={PR(LogisticsFreightEditorPage)} />
      <Route path="/logistics/freight/:id/bl" component={PR(LogisticsFreightBLPage)} />
      <Route path="/logistics/freight/:id/edit" component={PR(LogisticsFreightEditorPage)} />
      <Route path="/logistics/freight/:id" component={PR(LogisticsFreightDetailPage)} />
      <Route path="/logistics/freight" component={PR(LogisticsFreightPage)} />
      <Route path="/logistics/service-requests/:id" component={PR(ServiceRequestDetailPage)} />
      <Route path="/logistics/service-requests" component={PR(ServiceRequestsPage)} />
      <Route path="/logistics/portal-orders/:id" component={PR(LogisticsPortalOrderDetailPage)} />
      <Route path="/logistics/portal-orders" component={PR(LogisticsPortalOrdersPage)} />
      <Route path="/logistics/trucking-orders" component={PR(TruckingOrdersPage)} />
      <Route path="/logistics/drivers/analytics" component={PR(DriverAnalyticsDashboardPage)} />
      <Route path="/logistics/drivers/:id/performance" component={PR(LogisticsDriverPerformancePage)} />
      <Route path="/logistics/drivers" component={PR(LogisticsDriversPage)} />
      <Route path="/logistics/driver-performance" component={PR(LogisticsDriverPerformancePage)} />
      <Route path="/logistics/quote-requests" component={PR(LogisticsQuoteRequestsPage)} />
      <Route path="/logistics/vendor-quote/:token" component={LogisticsVendorQuotePage} />
      <Route path="/logistics/quotation-reply" component={PR(LogisticsQuotationReplyPage)} />
      <Route path="/logistics/quotation-reply/:token" component={LogisticsQuotationReplyPage} />
      <Route path="/logistics/rate-management" component={PR(LogisticsRateManagementPage)} />
      <Route path="/logistics/margin-rules" component={PR(LogisticsMarginRulesPage)} />
      <Route path="/logistics/rfq/:rfqId/comparison" component={PR(LogisticsRfqComparisonPage)} />
      <Route path="/logistics/rfq/:rfqId/detail" component={PR(LogisticsRfqDetailPage)} />
      <Route path="/logistics/rfq" component={PR(LogisticsRfqListPage)} />
      <Route path="/logistics/orders/:orderId/audit-trail" component={PR(OrderAuditTrailPage)} />
      <Route path="/logistics/orders/:orderId" component={PR(LogisticOrderDetailPage)} />
      <Route path="/logistics/vendor-performance" component={PR(VendorPerformancePage)} />
      <Route path="/logistics/vendor-recommendation" component={PR(VendorRecommendationPage)} />
      <Route path="/logistics/vendor-commodity-intelligence" component={PR(VendorCommodityIntelligencePage)} />
      <Route path="/logistics/vendor-fulfillments/:id" component={PR(LogisticsVendorFulfillmentDetailPage)} />
      <Route path="/logistics/vendor-fulfillments" component={PR(LogisticsVendorFulfillmentsPage)} />
      <Route path="/logistics/internal-tasks" component={PR(InternalTasksPage)} />
      <Route path="/logistics/product-first/analytics" component={PR(ProductFirstAnalyticsPage)} />
      <Route path="/logistics/product-first/audit" component={PR(ProductFirstAuditPage)} />
      <Route path="/logistics/import-assistant" component={PR(LogisticsImportAssistantPage)} />
      <Route path="/logistics/doc-verify" component={PR(FreightDocVerifyPage)} />
      <Route path="/air-freight-form/:token" component={AirFreightVendorFormPage} />

      {/* ── Logistics clean-URL aliases ────────────────────────────────── */}
      <Route path="/logistics/dashboard" component={PR(OperationalDashboardPage)} />
      <Route path="/logistics/shipments" component={PR(LogisticsPage)} />
      <Route path="/logistics/trucking" component={PR(TruckingOrdersPage)} />
      <Route path="/logistics/air-freight" component={PR(AirFreightNewOrdersPage)} />
      <Route path="/logistics/ocean-freight" component={PR(OceanFreightOrdersPage)} />
      <Route path="/logistics/vendor-fulfillment" component={PR(LogisticsVendorFulfillmentsPage)} />
      <Route path="/logistics/profitability" component={PR(AccountingFreightProfitabilityPage)} />
      <Route path="/logistics/settings" component={PR(LogisticsMarginRulesPage)} />

      <Route path="/portal-product-orders" component={PR(PortalProductOrdersPage)} />
      <Route path="/portal/customers" component={PR(PortalCustomersPage)} />
      <Route path="/portal/quick-quotes" component={PR(PortalQuickQuotesPage)} />
      <Route path="/portal/onboarding-approvals" component={PR(PortalOnboardingApprovalsPage)} />
      <Route path="/portal/customer-verification/:id" component={PR(PortalCustomerVerificationPage)} />
      <Route path="/portal/customer-verification" component={PR(PortalCustomerVerificationPage)} />

      {/* ── Sales ──────────────────────────────────────────────────────── */}
      <Route path="/sales/documents/new" component={PR(SalesDocumentEditorPage)} />
      <Route path="/sales/documents/:id/edit" component={PR(SalesDocumentEditorPage)} />
      <Route path="/sales/documents/:id" component={PR(SalesDocumentDetailPage)} />
      <Route path="/sales/documents" component={PR(SalesDocumentsListPage)} />
      <Route path="/sales/quotations/new" component={PR(SalesDocumentEditorPage)} />
      <Route path="/sales/quotations/:id/edit" component={PR(SalesDocumentEditorPage)} />
      <Route path="/sales/quotations/:id" component={PR(SalesDocumentDetailPage)} />
      <Route path="/sales/quotations" component={PR(SalesDocumentsListPage)} />
      <Route path="/sales/orders/new" component={() => <ProtectedRoute component={() => <SalesDocumentEditorPage kind="order" />} />} />
      <Route path="/sales/orders/:id" component={PR(SalesDocumentDetailPage)} />
      <Route path="/sales/orders" component={() => <ProtectedRoute component={() => <SalesDocumentsListPage kind="order" />} />} />
      <Route path="/sales/ai-drafts" component={PR(AiDraftsPage)} />
      <Route path="/sales/customers" component={PR(CustomersPage)} />
      <Route path="/sales/invoices" component={PR(SalesInvoicesPage)} />
      <Route path="/sales/items" component={PR(SalesItemsPage)} />
      <Route path="/sales/dashboard" component={PR(SalesDashboardPage)} />
      <Route path="/sales/workspace/:section" component={({ params }) => <ProtectedRoute component={() => <SalesWorkspacePage section={params.section} />} />} />
      <Route path="/sales/workspace" component={PR(SalesWorkspacePage)} />
      <Route path="/sales" component={PR(SalesHubPage)} />

      {/* ── Purchase ───────────────────────────────────────────────────── */}
      <Route path="/purchase/pr/new" component={PR(PurchaseRequestEditorPage)} />
      <Route path="/purchase/pr/:id" component={PR(PurchaseRequestEditorPage)} />
      <Route path="/purchase/pr" component={PR(PurchaseRequestListPage)} />
      <Route path="/purchase/documents/new" component={PR(PurchaseDocumentEditorPage)} />
      <Route path="/purchase/documents/:id/edit" component={PR(PurchaseDocumentEditorPage)} />
      <Route path="/purchase/documents/:id" component={PR(PurchaseDocumentEditorPage)} />
      <Route path="/purchase/documents" component={PR(PurchaseDocumentsListPage)} />
      <Route path="/purchase/rfq/new" component={PR(PurchaseDocumentEditorPage)} />
      <Route path="/purchase/rfq/:rfqId/compare" component={PR(VendorComparisonPage)} />
      <Route path="/purchase/rfq/:id" component={PR(PurchaseDocumentEditorPage)} />
      <Route path="/purchase/rfq" component={() => <ProtectedRoute component={() => <PurchaseDocumentsListPage kind="rfq" />} />} />
      <Route path="/purchase/orders/:id" component={PR(PurchaseDocumentEditorPage)} />
      <Route path="/purchase/orders" component={PR(POOrdersPage)} />
      <Route path="/purchase/vendor-forms" component={PR(VendorFormsPage)} />
      <Route path="/purchase/vmf-audit-trail" component={PR(VmfAuditTrailPage)} />
      <Route path="/purchase/sap-audit-trail" component={PR(SapAuditTrailPage)} />
      <Route path="/purchase/vendor-completion" component={PR(VendorCompletionPage)} />
      <Route path="/purchase/vendors/:id" component={PR(VendorDetailPage)} />
      <Route path="/purchase/vendors" component={PR(VendorsPage)} />
      <Route path="/purchase/bills" component={PR(PurchaseBillsPage)} />
      <Route path="/purchase/gr/new" component={PR(GoodsReceiptEditorPage)} />
      <Route path="/purchase/gr/:id" component={PR(GoodsReceiptEditorPage)} />
      <Route path="/purchase/gr" component={PR(GoodsReceiptListPage)} />
      <Route path="/purchase/qc/new" component={PR(QcEditorPage)} />
      <Route path="/purchase/qc/:id" component={PR(QcEditorPage)} />
      <Route path="/purchase/qc" component={PR(QcListPage)} />
      <Route path="/purchase/returns/new" component={PR(PurchaseReturnEditorPage)} />
      <Route path="/purchase/returns/:id" component={PR(PurchaseReturnEditorPage)} />
      <Route path="/purchase/returns" component={PR(PurchaseReturnsListPage)} />
      <Route path="/purchase/vendor-invoices/import" component={PR(InvoiceOcrImportPage)} />
      <Route path="/purchase/vendor-invoices/new" component={PR(VendorInvoiceEditorPage)} />
      <Route path="/purchase/vendor-invoices/:id" component={PR(VendorInvoiceEditorPage)} />
      <Route path="/purchase/vendor-invoices" component={PR(VendorInvoicesListPage)} />
      <Route path="/purchase/payment-requests/new" component={PR(PaymentRequestEditorPage)} />
      <Route path="/purchase/payment-requests/:id" component={PR(PaymentRequestEditorPage)} />
      <Route path="/purchase/payment-requests" component={PR(PaymentRequestsListPage)} />
      <Route path="/purchase/landed-costs/new" component={PR(LandedCostEditorPage)} />
      <Route path="/purchase/landed-costs/:id" component={PR(LandedCostEditorPage)} />
      <Route path="/purchase/landed-costs" component={PR(LandedCostsListPage)} />
      <Route path="/purchase/receive" component={PR(PurchaseReceivePage)} />
      <Route path="/purchase/vendor-catalog" component={PR(VendorCatalogPage)} />
      <Route path="/purchase/vendor-catalog-engine" component={PR(VendorCatalogEnginePage)} />
      <Route path="/purchase/trucking-pricing" component={PR(TruckingPricingPage)} />
      <Route path="/purchase/marketplace-analytics" component={PR(MarketplaceAnalyticsPage)} />
      <Route path="/marketplace/ai-images" component={PR(MarketplaceAiImagesPage)} />
      <Route path="/marketplace/rfqs/:rfqId/comparison" component={PR(MktRfqComparisonPage)} />
      <Route path="/marketplace/rfqs/:rfqId" component={PR(MktRfqDetailPage)} />
      <Route path="/marketplace/rfqs" component={PR(MktRfqListPage)} />
      <Route path="/marketplace/purchase-orders/:poId" component={PR(MktPoDetailPage)} />
      <Route path="/marketplace/purchase-orders" component={PR(MktPoListPage)} />
      <Route path="/marketplace/featured-maintenance" component={PR(FeaturedMaintenancePage)} />
      <Route path="/marketplace/produk-unggulan" component={PR(ProdukUnggulanPage)} />
      <Route path="/marketplace/master-price" component={PR(MasterPricePage)} />
      {import.meta.env.DEV && <Route path="/marketplace/qa-fixture-manager" component={PR(QaFixtureManagerPage)} />}
      <Route path="/purchase/workspace/:section" component={({ params }) => <ProtectedRoute component={() => <PurchaseWorkspacePage section={params.section} />} />} />
      <Route path="/purchase/workspace" component={PR(PurchaseWorkspacePage)} />
      <Route path="/purchase/dashboard" component={PR(PurchaseDashboardPage)} />
      <Route path="/purchase" component={PR(PurchaseHubPage)} />

      {/* ── Reports ────────────────────────────────────────────────────── */}
      <Route path="/reports" component={PR(ReportsIndexPage)} />
      <Route path="/reports/sales" component={PR(ReportsSalesPage)} />
      <Route path="/reports/purchase" component={PR(ReportsPurchasePage)} />
      <Route path="/reports/ar-aging" component={PR(ReportsArAgingPage)} />
      <Route path="/reports/ap-aging" component={PR(ReportsApAgingPage)} />
      <Route path="/reports/operasional" component={PR(ReportsMainPage)} />
      <Route path="/reports/audit-log" component={PR(AuditLogPage)} />
      <Route path="/reports/inventory-valuation" component={PR(InventoryValuationPage)} />

      {/* ── Finance CFO ────────────────────────────────────────────────── */}
      <Route path="/finance/allocation/create" component={PR(AllocationCreatePage)} />
      <Route path="/finance/allocation" component={PR(AllocationCenterPage)} />
      <Route path="/finance/bank-allocation" component={PR(BankAllocationPage)} />
      <Route path="/finance/advances" component={PR(AdvanceManagementPage)} />
      <Route path="/finance/workspace/:section" component={PR(FinanceModuleWorkspacePage)} />
      <Route path="/finance/cfo-overview" component={PR(CfoOverviewPage)} />
      <Route path="/finance/kpi/:type" component={PR(KpiDetailPage)} />
      <Route path="/finance/transactions" component={PR(FinanceTransactionsPage)} />
      <Route path="/finance/transactions/detail" component={PR(TransactionsDetailPage)} />
      <Route path="/finance/journal-entry/:id" component={PR(JournalEntryDetailPage)} />
      <Route path="/advanced-accounting" component={PR(AdvancedAccountingPage)} />

      {/* ── Accounting ─────────────────────────────────────────────────── */}
      <Route path="/accounting"><Redirect to="/accounting/dashboard" /></Route>
      <Route path="/accounting/dashboard" component={PR(AccountingDashboardPage)} />
      <Route path="/accounting/workspace/:module" component={PR(FinanceWorkspacePage)} />
      <Route path="/accounting/accounts" component={PR(AccountingAccountsPage)} />
      <Route path="/accounting/journals" component={PR(AccountingJournalsPage)} />
      <Route path="/accounting/taxes" component={PR(AccountingTaxesPage)} />
      <Route path="/accounting/entries/:id" component={PR(AccountingEntryDetailPage)} />
      <Route path="/accounting/entries" component={PR(AccountingEntriesPage)} />
      <Route path="/accounting/journal-items" component={PR(AccountingJournalItemsPage)} />
      <Route path="/accounting/payments" component={PR(AccountingPaymentsPage)} />
      <Route path="/accounting/other-transactions" component={PR(AccountingOtherTransactionsPage)} />
      <Route path="/accounting/bank-disbursements" component={PR(BankDisbursementsPage)} />
      <Route path="/accounting/bank-receipts" component={PR(BankReceiptsPage)} />
      <Route path="/accounting/kas-bank" component={PR(KasBankPage)} />
      <Route path="/accounting/cash-flow-forecast" component={PR(CashFlowForecastPage)} />
      <Route path="/accounting/settings" component={PR(AccountingSettingsPage)} />
      <Route path="/accounting/wa-report-settings" component={PR(WaReportSettingsPage)} />
      <Route path="/accounting/cost-centers" component={PR(CostCentersPage)} />
      <Route path="/accounting/reconciliation" component={PR(AccountingReconciliationPage)} />
      <Route path="/accounting/bank-reconciliation" component={PR(BankReconciliationPage)} />
      <Route path="/accounting/bank-recon" component={PR(BankReconPage)} />
      <Route path="/accounting/smart-bank-recon" component={PR(SmartBankReconPage)} />
      <Route path="/accounting/bank-recon-classification" component={PR(BankReconClassificationPage)} />
      <Route path="/accounting/bank-mutation-import/:id" component={PR(BankMutationImportDetailPage)} />
      <Route path="/accounting/bank-mutation-import" component={PR(BankMutationImportPage)} />
      <Route path="/accounting/coa-mapping" component={PR(CoaMappingPage)} />
      <Route path="/accounting/tax-mapping" component={PR(TaxMappingPage)} />
      <Route path="/accounting/bank-accounts-master" component={PR(BankAccountsMasterPage)} />
      <Route path="/accounting/entity-review" component={PR(EntityReviewPage)} />
      <Route path="/accounting/pl-by-bu" component={PR(PlByBuPage)} />
      <Route path="/accounting/audit-import" component={PR(AuditImportPage)} />
      <Route path="/accounting/wht-reconciliation" component={PR(WhtReconciliationPage)} />
      <Route path="/accounting/gsheet" component={PR(AccountingGSheetPage)} />
      <Route path="/accounting/tax-report" component={PR(TaxReportPage)} />
      <Route path="/accounting/audit-report" component={PR(AccountingAuditReportPage)} />
      <Route path="/accounting/closing-entries" component={PR(ClosingEntriesPage)} />
      <Route path="/accounting/closing-wizard" component={PR(ClosingWizardPage)} />
      <Route path="/accounting/ledger" component={PR(LedgerImmutablePage)} />
      <Route path="/accounting/governance" component={PR(GovernancePage)} />
      <Route path="/accounting/coa-governance" component={PR(CoaGovernancePage)} />
      <Route path="/accounting/coa-proposals/:id" component={PR(CoaProposalDetailPage)} />
      <Route path="/accounting/coa-proposals" component={PR(CoaProposalsPage)} />
      <Route path="/accounting/posting-monitor" component={PR(PostingMonitorPage)} />
      <Route path="/accounting/hub" component={PR(AccountingHubIndexPage)} />
      <Route path="/accounting/hub/general-ledger" component={PR(AccountingHubGLPage)} />
      <Route path="/accounting/hub/trial-balance" component={PR(AccountingHubTrialBalancePage)} />
      <Route path="/accounting/hub/profit-loss" component={PR(AccountingHubPLPage)} />
      <Route path="/accounting/hub/balance-sheet" component={PR(AccountingHubBalanceSheetPage)} />
      <Route path="/accounting/hub/payments" component={PR(AccountingHubPaymentsPage)} />
      <Route path="/accounting/hub/posting-errors" component={PR(AccountingHubPostingErrorsPage)} />
      <Route path="/accounting/hub/coa-mapping" component={PR(AccountingHubCOAMappingPage)} />
      <Route path="/accounting/reset-transactions" component={PR(ResetTransactionsPage)} />
      <Route path="/accounting/financial-reconciliation" component={PR(FinancialReconciliationPage)} />
      <Route path="/accounting/period-closing" component={PR(PeriodClosingStatusPage)} />
      <Route path="/accounting/reports/trial-balance"><Redirect to="/accounting/hub/trial-balance" /></Route>
      <Route path="/accounting/reports/general-ledger"><Redirect to="/accounting/hub/general-ledger" /></Route>
      <Route path="/accounting/reports/profit-loss"><Redirect to="/accounting/hub/profit-loss" /></Route>
      <Route path="/accounting/reports/balance-sheet"><Redirect to="/accounting/hub/balance-sheet" /></Route>
      <Route path="/accounting/reports/freight-profitability" component={PR(AccountingFreightProfitabilityPage)} />
      <Route path="/accounting/reports/cash-flow" component={PR(AccountingCashFlowPage)} />
      <Route path="/executive/logistics" component={PR(ExecutiveLogisticsDashboardPage)} />
      <Route path="/executive/overview" component={PR(ExecutiveDashboardPage)} />
      <Route path="/executive/workspace/:section" component={({ params }) => <ProtectedRoute component={() => <ExecutiveWorkspacePage section={params.section} />} />} />
      <Route path="/executive/workspace" component={PR(ExecutiveWorkspacePage)} />
      <Route path="/executive" component={PR(ExecutiveHubPage)} />
      <Route path="/holding/groups/:id" component={PR(HoldingGroupDetailPage)} />
      <Route path="/holding/dashboard" component={PR(HoldingDashboardPage)} />
      <Route path="/holding/pl-report" component={PR(HoldingPLReportPage)} />
      <Route path="/holding/cashflow-report" component={PR(HoldingCashflowReportPage)} />
      <Route path="/holding" component={PR(HoldingPage)} />

      {/* ── Expenses ───────────────────────────────────────────────────── */}
      <Route path="/expense/new" component={PR(ExpenseEditorPage)} />
      <Route path="/expense/categories" component={PR(ExpenseCategoriesPage)} />
      <Route path="/expense/reports" component={PR(ExpenseReportsPage)} />
      <Route path="/expense/routine" component={PR(ExpenseRoutinePage)} />
      <Route path="/expense/dana-karyawan" component={PR(DanaKaryawanPage)} />
      <Route path="/expense/kasbon" component={PR(KasbonPage)} />
      <Route path="/expense/talangan" component={PR(TalanganPage)} />
      <Route path="/expense/vendor-installments" component={PR(VendorInstallmentsPage)} />
      <Route path="/expense/bank-loans" component={PR(BankLoansPage)} />
      <Route path="/expense/fixed-assets" component={PR(FixedAssetsPage)} />
      <Route path="/expense/audit-dana-talangan" component={PR(AuditDanaTalanganPage)} />
      <Route path="/expense/audit-disbursement" component={PR(AuditDisbursementPage)} />
      <Route path="/expense/vendor-payments" component={PR(VendorPaymentsPage)} />
      <Route path="/expense/asset-depreciation" component={PR(AssetDepreciationPage)} />
      <Route path="/expense/approvals" component={PR(ExpenseApprovalsPage)} />
      <Route path="/expense/kas-transfer" component={PR(KasTransferPage)} />
      <Route path="/expense/dashboard" component={PR(ExpenseDashboardPage)} />
      <Route path="/expense/templates" component={PR(ExpenseTemplatesPage)} />
      <Route path="/expense/budget" component={PR(ExpenseBudgetPage)} />
      <Route path="/expense/:id/edit" component={PR(ExpenseEditorPage)} />
      <Route path="/expense/:id" component={PR(ExpenseEditorPage)} />
      <Route path="/expense" component={PR(ExpenseListPage)} />

      {/* ── Correspondence ─────────────────────────────────────────────── */}
      <Route path="/correspondences" component={PR(CorrespondencesPage)} />
      <Route path="/email-inbox" component={PR(EmailInboxPage)} />
      <Route path="/notification-history" component={PR(WaNotificationHistoryPage)} />

      {/* ── Settings ───────────────────────────────────────────────────── */}
      <Route path="/settings/nav-company-config" component={PR(NavCompanyConfigPage)} />
      <Route path="/settings/uom" component={PR(UomPage)} />
      <Route path="/settings/short-links" component={PR(ShortLinksPage)} />
      <Route path="/settings/wa-templates" component={PR(WaTemplatesPage)} />
      <Route path="/settings/enterprise-wa-templates" component={PR(EnterpriseWaTemplatesPage)} />
      <Route path="/settings/logistics-units" component={PR(LogisticsUnitsPage)} />
      <Route path="/settings/trucking-rates" component={PR(TruckingRatesPage)} />
      <Route path="/settings/vehicle-images" component={PR(VehicleImagesPage)} />
      <Route path="/settings/ai-chatbot/knowledge" component={PR(AiChatbotKnowledgePage)} />
      <Route path="/settings/ai-chatbot" component={PR(AiChatbotSettingsPage)} />
      <Route path="/settings/ai-scan" component={PR(AiScanSettingsPage)} />
      <Route path="/settings/company-profile" component={PR(CompanyProfilePage)} />
      <Route path="/settings/roles" component={PR(SettingsRolesPage)} />
      <Route path="/settings/approval-rules" component={PR(SettingsApprovalRulesPage)} />
      <Route path="/settings/approval-matrix" component={PR(ApprovalMatrixPage)} />
      <Route path="/settings/product-templates" component={PR(ProductTemplatesPage)} />
      <Route path="/settings/service-templates" component={PR(ServiceTemplatesSettingsPage)} />

      <Route path="/settings/app" component={PR(SettingsPage)} />
      <Route path="/settings/security-center" component={PR(SecurityCenterPage)} />
      <Route path="/administration/cross-company-access" component={PR(CrossCompanyAccessPage)} />
      <Route path="/settings/workspace/:section" component={({ params }) => <ProtectedRoute component={() => <AdministrationWorkspacePage section={params.section} />} />} />
      <Route path="/settings/workspace" component={PR(AdministrationWorkspacePage)} />
      <Route path="/settings" component={PR(AdministrationHubPage)} />

      {/* ── Users & Org ────────────────────────────────────────────────── */}
      <Route path="/users" component={PR(UsersPage)} />
      <Route path="/media" component={PR(MediaManagerPage)} />
      <Route path="/org" component={PR(OrgManagementPage)} />


      {/* ── Products ───────────────────────────────────────────────────── */}
      <Route path="/products/items" component={PR(ProductItemsPage)} />
      <Route path="/products/recipes" component={PR(ProductRecipesPage)} />

      {/* ── Product Template Engine ─────────────────────────────────────── */}
      <Route path="/product-templates/:id" component={PR(ProductTemplateDetailPage)} />
      <Route path="/product-templates" component={PR(ProductTemplatesPage)} />



      {/* ── Vendor Leaderboard ─────────────────────────────────────────── */}
      <Route path="/vendors" component={PR(VendorLeaderboardPage)} />

      {/* ── WA Monitoring ──────────────────────────────────────────────── */}
      <Route path="/settings/wa-notification-logs" component={PR(WaNotificationLogsPage)} />
      <Route path="/settings/document-templates" component={PR(DocumentTemplatesPage)} />
      <Route path="/settings/secrets" component={PR(AppSecretsPage)} />

      {/* ── System Health ──────────────────────────────────────────────── */}
      <Route path="/system-health" component={PR(SystemHealthPage)} />
      <Route path="/system/observability/errors" component={PR(ObservabilityErrorsPage)} />
      <Route path="/admin/db-sync" component={PR(DbSyncPage)} />
      <Route path="/admin/portal" component={PR(AdminPortalPage)} />

      {/* ── Notifications & Analytics ──────────────────────────────────── */}
      <Route path="/notifications" component={PR(NotificationsPage)} />
      <Route path="/exceptions" component={PR(ExceptionsPage)} />
      <Route path="/intelligence-alerts" component={PR(IntelligenceAlertsPage)} />
      <Route path="/ai-approvals" component={PR(AiApprovalsPage)} />
      <Route path="/operational-context" component={PR(OperationalContextPage)} />
      <Route path="/ai/review/observability" component={PR(AiReviewObservabilityPage)} />
      <Route path="/ai/review/learning/:id" component={PR(AiLearningDetailPage)} />
      <Route path="/ai/review/learning" component={PR(AiLearningPage)} />
      <Route path="/ai/review/recommendations/:id" component={PR(AiRecommendationDetailPage)} />
      <Route path="/ai/review/recommendations" component={PR(AiRecommendationsPage)} />
      <Route path="/ai/review/statistics" component={PR(AiStatisticsPage)} />
      <Route path="/ai/review/:id" component={PR(AiReviewDetailPage)} />
      <Route path="/ai/review" component={PR(AiReviewIndexPage)} />
      <Route path="/analytics" component={PR(AnalyticsDashboardPage)} />
      <Route path="/analytics/profitability" component={PR(ProfitabilityAnalyticsPage)} />
      <Route path="/analytics/route-profitability" component={PR(RouteProfitabilityPage)} />
      <Route path="/analytics/commodity-profitability" component={PR(CommodityProfitabilityPage)} />
      <Route path="/enterprise-dashboard" component={PR(EnterpriseDashboardPage)} />
      <Route path="/operational-dashboard" component={PR(OperationalDashboardPage)} />

      {/* ── Audit ERP ──────────────────────────────────────────────────── */}
      <Route path="/audit/compare" component={PR(AuditComparePage)} />
      <Route path="/audit/:id" component={PR(AuditReportFormPage)} />
      <Route path="/audit" component={PR(AuditReportListPage)} />

      {/* ── Sport Center ───────────────────────────────────────────────── */}
      <Route path="/sport-center/dashboard" component={PR(SportCenterDashboard)} />
      <Route path="/sport-center/bookings" component={PR(SportCenterBookings)} />
      <Route path="/sport-center/facilities" component={PR(SportCenterFacilities)} />
      <Route path="/sport-center/customers" component={PR(SportCenterCustomers)} />
      <Route path="/sport-center/members" component={PR(SportCenterMembers)} />
      <Route path="/sport-center/pricing-rules" component={PR(SportCenterPricingRules)} />
      <Route path="/sport-center/payments" component={PR(SportCenterPayments)} />
      <Route path="/sport-center/company-invoices" component={PR(SportCenterCompanyInvoices)} />
      <Route path="/sport-center/reports" component={PR(SportCenterReports)} />
      <Route path="/sport-center/profitability" component={PR(SportCenterProfitability)} />
      <Route path="/sport-center/expenses" component={PR(SportCenterExpenses)} />
      <Route path="/sport-center/settings" component={PR(SportCenterSettings)} />
      <Route path="/sport-center" component={PR(SportCenterDashboard)} />
      <Route path="/tenant/dashboard" component={PR(TenantDashboard)} />
      <Route path="/tenant/tenants" component={PR(TenantList)} />
      <Route path="/tenant/units" component={PR(TenantUnits)} />
      <Route path="/tenant/bookings" component={PR(TenantBookings)} />
      <Route path="/tenant/payments" component={PR(TenantPayments)} />
      <Route path="/tenant/invoices" component={PR(TenantInvoices)} />
      <Route path="/tenant/mall-units" component={PR(TenantMallUnits)} />
      <Route path="/tenant/pos-tenant" component={PR(PosTenant)} />
      <Route path="/tenant/kasir/companies" component={PR(KasirCompanies)} />
      <Route path="/tenant/kasir/branches" component={PR(KasirBranches)} />
      <Route path="/tenant/kasir/users" component={PR(KasirUsers)} />
      <Route path="/tenant/kasir/products" component={PR(KasirProducts)} />
      <Route path="/tenant/kasir/devices" component={PR(KasirDevices)} />
      <Route path="/tenant/kasir/workspace/:section" component={({ params }) => <ProtectedRoute component={() => <PosWorkspacePage section={params.section} />} />} />
      <Route path="/tenant/kasir/workspace" component={PR(PosWorkspacePage)} />
      <Route path="/tenant/kasir" component={PR(PosHubPage)} />
      <Route path="/tenant/pos/branches" component={PR(PosBranches)} />
      <Route path="/tenant/pos/cashiers" component={PR(PosCashiers)} />
      <Route path="/tenant/pos/products" component={PR(PosProducts)} />
      <Route path="/tenant/pos/roles" component={PR(PosRoles)} />
      <Route path="/tenant/pos/settings" component={PR(PosSettings)} />
      <Route path="/tenant/rekap" component={PR(TenantRekap)} />
      <Route path="/tenant/laporan-keuangan" component={PR(TenantLaporanKeuangan)} />
      <Route path="/tenant/rekonsiliasi" component={PR(TenantRekonsiliasi)} />
      <Route path="/tenant/perbandingan-lokasi" component={PR(TenantPerbandinganLokasi)} />
      <Route path="/tenant/kirim-wa" component={PR(TenantKirimWa)} />
      <Route path="/tenant/audit-log" component={PR(TenantAuditLog)} />
      <Route path="/tenant/pengaturan" component={PR(TenantPengaturan)} />
      <Route path="/tenant/workspace/:section" component={({ params }) => <ProtectedRoute component={() => <TenantWorkspacePage section={params.section} />} />} />
      <Route path="/tenant/workspace" component={PR(TenantWorkspacePage)} />
      <Route path="/tenant" component={PR(TenantHubPage)} />

      {/* ── Ocean Freight ───────────────────────────────────────────────── */}
      <Route path="/logistics/ocean-freight-orders" component={PR(OceanFreightOrdersPage)} />
      <Route path="/logistics/ocean-freight/:id" component={PR(OceanFreightOrderDetailPage)} />
      <Route path="/logistics/ocean-freight-rates" component={PR(OceanFreightRatesPage)} />
      <Route path="/ocean-freight-master-data" component={PR(OceanFreightMasterDataPage)} />
      {/* Legacy redirects — canonical path is /logistics/ocean-freight-* */}
      <Route path="/ocean-freight/orders/:id" component={({ params }: { params: { id: string } }) => <Redirect to={`/logistics/ocean-freight/${params.id}`} />} />
      <Route path="/ocean-freight/orders" component={() => <Redirect to="/logistics/ocean-freight-orders" />} />
      <Route path="/ocean-freight/rates" component={() => <Redirect to="/logistics/ocean-freight-rates" />} />

      {/* ── Air Freight ─────────────────────────────────────────────────── */}
      {/* Canonical: /air-freight/orders (newer, more complete) */}
      <Route path="/air-freight/orders/:id" component={PR(AirFreightNewOrderDetailPage)} />
      <Route path="/air-freight/orders" component={PR(AirFreightNewOrdersPage)} />
      <Route path="/air-freight/rates" component={PR(AirFreightRatesPage)} />
      {/* public — no auth */}
      <Route path="/air-freight/approval/:token" component={AirFreightApprovalPage} />
      <Route path="/air-freight/track/:orderNumber" component={AirFreightTrackPage} />
      {/* Legacy redirect — /logistics/air-freight → /air-freight/orders */}
      <Route path="/logistics/air-freight/:id" component={({ params }: { params: { id: string } }) => <Redirect to={`/air-freight/orders/${params.id}`} />} />
      <Route path="/logistics/air-freight" component={() => <Redirect to="/air-freight/orders" />} />

      {/* ── PPJK — Dokumen Kepabeanan ────────────────────────────────────── */}
      <Route path="/logistics/ppjk/:id" component={PR(PpjkDetailPage)} />
      <Route path="/logistics/ppjk" component={PR(PpjkPage)} />

      {/* ── Unified Shipments ────────────────────────────────────────────── */}
      <Route path="/logistics/shipments" component={PR(UnifiedShipmentsPage)} />

      {/* ── Gojek Fleet Intelligence ────────────────────────────────────── */}
      <Route path="/logistics/fleet-intelligence/upload" component={PR(FleetUploadPageEB)} />
      <Route path="/logistics/fleet-intelligence/drivers/:extId/detail" component={PR(FleetDriverDetailEB)} />
      <Route path="/logistics/fleet-intelligence/drivers" component={PR(FleetDriversPageEB)} />
      <Route path="/logistics/fleet-intelligence/vehicles" component={PR(FleetVehiclesPageEB)} />
      <Route path="/logistics/fleet-intelligence/transactions" component={PR(FleetTransactionsPageEB)} />
      <Route path="/logistics/fleet-intelligence/macet" component={PR(DriverMacetPageEB)} />
      <Route path="/logistics/fleet-intelligence/outstanding" component={PR(FleetOutstandingPageEB)} />
      <Route path="/logistics/fleet-intelligence/analytics" component={PR(FleetAnalyticsPageEB)} />
      <Route path="/logistics/fleet-intelligence/alerts" component={PR(FleetAlertsPageEB)} />
      <Route path="/logistics/fleet-intelligence/accounting" component={PR(FleetAccountingPageEB)} />
      <Route path="/logistics/fleet-intelligence/validation" component={PR(FleetValidationPageEB)} />
      <Route path="/logistics/fleet-intelligence/expenses" component={PR(FleetExpensesPageEB)} />
      <Route path="/logistics/fleet-intelligence/control-center" component={PR(FleetControlCenterEB)} />
      <Route path="/logistics/fleet-intelligence/dlq" component={PR(FleetDLQPageEB)} />
      <Route path="/logistics/fleet-intelligence/ledger-explorer" component={PR(LedgerExplorerPageEB)} />
      <Route path="/logistics/fleet-intelligence/reconciliation" component={PR(FleetReconciliationEB)} />
      <Route path="/logistics/fleet-intelligence/pipeline-monitor" component={PR(PipelineMonitorEB)} />
      <Route path="/logistics/fleet-intelligence/driver-macet" component={PR(DriverMacetPageEB)} />
      <Route path="/logistics/fleet-intelligence/cash-payments" component={PR(FleetCashPaymentsPageEB)} />
      <Route path="/logistics/fleet-intelligence" component={PR(FleetDashboardEB)} />

      {/* ── Tax Management ─────────────────────────────────────────────── */}
      <Route path="/tax/dashboard" component={PR(TaxDashboardPage)} />
      <Route path="/tax/rules" component={PR(TaxRulesPage)} />
      <Route path="/tax/transactions" component={PR(TaxTransactionsPage)} />
      <Route path="/tax/ppn" component={PR(TaxPpnPage)} />
      <Route path="/tax/pph" component={PR(TaxPphPage)} />
      <Route path="/tax/spt" component={PR(TaxSptPage)} />
      <Route path="/tax/spt-builder" component={PR(TaxSptBuilderPage)} />
      <Route path="/tax/export-djp" component={PR(TaxExportDjpPage)} />
      <Route path="/tax/reconciliation" component={PR(TaxReconciliationPage)} />
      <Route path="/tax/missing-compliance" component={PR(TaxMissingCompliancePage)} />
      <Route path="/tax/audit" component={PR(TaxAuditPage)} />
      <Route path="/tax/spt-control" component={PR(TaxSptControlPage)} />
      <Route path="/tax" component={PR(TaxDashboardPage)} />

      {/* ── Module Hub Pages ───────────────────────────────────────────── */}
      <Route path="/master-data" component={PR(MasterDataHubPage)} />
      <Route path="/master-data/workspace/:section" component={PR(MasterDataWorkspacePage)} />
      <Route path="/master-data/workspace" component={PR(MasterDataWorkspacePage)} />
      {/* ── Cash & Bank ─────────────────────────────────────────────── */}
      <Route path="/cash-bank/dashboard" component={PR(CashBankDashboardPage)} />
      <Route path="/cash-bank/accounts" component={PR(CashBankAccountsPage)} />
      <Route path="/cash-bank/mutations" component={PR(CashBankMutationsPage)} />
      <Route path="/cash-bank/imports" component={PR(CashBankImportsPage)} />
      <Route path="/cash-bank/transfers" component={PR(CashBankTransfersPage)} />
      <Route path="/cash-bank/reconciliation"><Redirect to="/accounting/bank-reconciliation" /></Route>
      <Route path="/cash-bank/forecast" component={PR(CashBankForecastPage)} />
      <Route path="/cash-bank/petty-cash" component={PR(CashBankPettyCashPage)} />
      <Route path="/cash-bank/settings" component={PR(CashBankSettingsPage)} />
      <Route path="/cash-bank"><Redirect to="/cash-bank/dashboard" /></Route>

      <Route path="/finance" component={PR(FinanceHubPage)} />
      <Route path="/finance/workspace" component={PR(FinanceModuleWorkspacePage)} />
      <Route path="/logistics/workspace" component={PR(LogisticsWorkspacePage)} />
      <Route path="/ai-center" component={PR(AiCenterHubPage)} />
      <Route path="/hr" component={PR(HrHubPage)} />

      {/* ── Legacy redirects ───────────────────────────────────────────── */}
      <Route path="/expenses/new" component={() => <Redirect to="/expense/new" />} />
      <Route path="/expenses/categories" component={() => <Redirect to="/expense/categories" />} />
      <Route path="/expenses/reports" component={() => <Redirect to="/expense/reports" />} />
      <Route path="/expenses/:id" component={({ params }: { params: { id: string } }) => <Redirect to={`/expense/${params.id}/edit`} />} />
      <Route path="/expenses" component={() => <Redirect to="/expense" />} />
      <Route path="/logistics/vendors" component={() => <Redirect to="/purchase/vendors" />} />

      <Route component={NotFound} />
    </Switch>
    </React.Suspense>
  );
}
