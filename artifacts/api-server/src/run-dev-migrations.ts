/**
 * Standalone migration runner — runs all startup migrations against dev DB.
 * Execute with: node dist/run-dev-migrations.mjs
 * The DB library auto-selects SUPABASE_DATABASE_URL_DEV in non-production mode.
 */
import { logger } from "./lib/logger.js";
import { db } from "@workspace/db";
import { sql } from "drizzle-orm";

// ── Accounting / Finance migrations ─────────────────────────────────────────
import { runAccountingMigration, repairKasErSportCenterEntries, repairOrphanedEntryLines } from "./lib/accountingMigration.js";
import { runAccountingHubMigration } from "./lib/accountingHubMigration.js";
import { runGuardMigration as runLedgerGuardMigration } from "./lib/accounting/ledgerGuard.js";
import { runFreightAccountingMigration } from "./lib/freightAccountingMigration.js";
import { runBankReconciliationCoreMigration } from "./routes/bankReconciliation.js";
import { runQrisSettlementMigration } from "./lib/reconciliation/qrisSettlementMigration.js";
import { runBankMutationMastersMigration } from "./routes/bankMutationMasters.js";
import { runBankMutationImportMigration } from "./routes/bankMutationImport.js";
import { runFinancialPeriodMigration } from "./lib/financialPeriodMigration.js";
import { runFinancialClosingMigration } from "./lib/financialClosingMigration.js";
import { runSapHardeningMigration } from "./lib/sapHardeningMigration.js";
import { runFinanceGovernanceMigration } from "./lib/financeGovernanceMigration.js";
import { runBankDisbursementMigration, runExpenseDisbursementBridgeMigration } from "./lib/bankDisbursementMigration.js";
import { runVendorPaymentsMigration } from "./lib/vendorPaymentsMigration.js";
import { runKasBankMigration } from "./lib/kasBankMigration.js";
import { runCashBankMigration } from "./lib/cashBankMigration.js";
import { runFinanceCoreMigration } from "./lib/financeCoreMigration.js";
import { runBankReceiptMigration } from "./lib/bankReceiptMigration.js";
import { runAllocationMigration } from "./lib/allocationMigration.js";
import { runTreasuryMigration } from "./lib/treasury/treasuryMigration.js";
import { runBankAllocationMigration } from "./lib/bankAllocationMigration.js";
import { runExpenseRuleMigration } from "./lib/expenseRuleMigration.js";
import { runExpenseClassificationMigration } from "./lib/expenseClassificationMigration.js";
import { runCostCenterMigration } from "./lib/costCenterMigration.js";
import { runFreightAuditMigration } from "./lib/freightAuditMigration.js";
import { runAuditFixMigration } from "./lib/auditFixMigration.js";
import { runMktVendorInvoiceMigration } from "./lib/mktVendorInvoiceMigration.js";
import { runMktApPreparationMigration } from "./lib/mktApPreparationMigration.js";
import { seedAccountingDefaults, seedAdditionalTaxes, backfillExpenseCategoryAccounts } from "./lib/accountingSeed.js";

// ── Core / Org / Auth migrations ─────────────────────────────────────────────
import { runPhase1Migration } from "./lib/phase1Migration.js";
import { runPhase2Migration } from "./lib/phase2Migration.js";
import { runPhase3aRfqVendorLinksFix } from "./lib/phase3aRfqVendorLinksFix.js";
import { runUnifiedViewsMigration } from "./lib/unifiedViewsMigration.js";
import { runOrderLinksMigration } from "./lib/orderLinksMigration.js";
import { runVendorProfileMigration } from "./lib/vendorProfileMigration.js";
import { runPortalMigration } from "./lib/portalMigration.js";
import { runVendorProfileFieldsMigration } from "./lib/vendorProfileFieldsMigration.js";
import { runSupplierEnhancementMigration } from "./lib/supplierEnhancementMigration.js";
import { runOauthStateMigration } from "./lib/oauthStateMigration.js";
import { runKnowledgeBaseMigration } from "./lib/knowledgeBaseMigration.js";
import { runCompaniesMigration } from "./lib/companiesMigration.js";
import { runHoldingMigration } from "./lib/holdingMigration.js";
import { runSessionsMigration } from "./lib/sessionsMigration.js";
import { runCustomRolesMigration } from "./lib/customRolesMigration.js";
import { runUomMigration } from "./lib/uomMigration.js";
import { runOrgFullMigration } from "./lib/orgFullMigration.js";
import { runOrgUniqueCodesMigration } from "./lib/orgUniqueCodesMigration.js";
import { runOrgRoleMigration } from "./lib/orgRoleMigration.js";
import { runUserRoleMigration } from "./lib/userRoleMigration.js";
import { runAuditLogMigration } from "./lib/auditLogMigration.js";
import { runNavPreferencesMigration } from "./lib/navPreferencesMigration.js";
import { runNotificationLogMigration } from "./lib/notificationLogMigration.js";
import { runAdminNotificationsMigration } from "./lib/adminNotificationsMigration.js";
import { runVendorNotificationsMigration } from "./lib/vendorNotificationsMigration.js";
import { runVendorMiniFormMigration } from "./lib/vendorMiniFormMigration.js";
import { runCustomerQuoteFlowMigration } from "./lib/customerQuoteFlowMigration.js";
import { runEnterpriseMigration } from "./lib/enterpriseMigration.js";
import { runShortLinksMigration } from "./lib/shortLinksMigration.js";
import { runGeofenceMigration } from "./lib/geofenceMigration.js";
import { runOrderFulfillmentMigration } from "./routes/orderFulfillment.js";
import { runTrustedDevicesMigration } from "./lib/trustedDevicesMigration.js";
import { runAuditReportsMigration } from "./lib/auditReportsMigration.js";
import { runWaTemplateMigration } from "./lib/orderNotification.js";
import { runRlsMigration } from "./lib/rlsMigration.js";
import { runCommodityTemplateMigration } from "./lib/commodityTemplateMigration.js";
import { migratePushSubscriptions } from "./lib/webPush.js";
import { runPgTrgmMigration } from "./lib/pgTrgmMigration.js";
import { runIntelligenceAlertSettingsMigration } from "./lib/intelligenceAlertSettingsMigration.js";
import { runAiGovernanceMigration } from "./lib/aiGovernanceMigration.js";
import { runPurchaseTemplateMigration } from "./lib/purchaseTemplateMigration.js";
import { runEnterpriseWorkflowMigration } from "./lib/enterpriseWorkflowTemplates.js";
import { runOrderProgressMigration } from "./lib/orderProgress.js";
import { runExceptionEnumMigration, runOrderExceptionsMigration } from "./lib/services/exceptionService.js";
import { runVendorCompanyAssignmentsMigration } from "./lib/vendorCompanyAssignmentsMigration.js";
import { runVendorCatalogSchemaMigration } from "./lib/vendorCatalogSchemaMigration.js";
import { runFeaturedProductMigration } from "./lib/featuredProductMigration.js";
import { runLogisticVendorFulfillmentsMigration } from "./lib/logisticVendorFulfillmentsMigration.js";
import { runProductFirstFlowMigration } from "./lib/productFirstFlowMigration.js";
import { runStep4TemplateMigration } from "./lib/step4TemplateMigration.js";
import { runServiceTemplateMigration } from "./lib/serviceTemplateMigration.js";
import { runPaylabsConfigMigration, runPaylabsPaymentMethodsMigration } from "./routes/payments.js";
import { runSportCenterMigration, runSportCenterAccountCorrection, runSportCenterCompanyInvoiceMigration, runSportExpensesMigration } from "./modules/sport-center/migration.js";
import { runTenantMigration } from "./modules/tenant/migration.js";
import { runBtkiMigration } from "./lib/btkiMigration.js";
import { runTokenSecurityMigration } from "./lib/tokenSecurityMigration.js";
import { runMasterPriceMigration } from "./lib/masterPriceMigration.js";
import { runQaFixtureMigration } from "./lib/qaFixtureMigration.js";
import { runTaxRulesMigration } from "./lib/taxRulesMigration.js";
import { runTaxSptMigration } from "./lib/taxSptMigration.js";
import { runTaxAuditMigration } from "./lib/taxAuditMigration.js";
import { runTaxCoretaxMigration } from "./lib/taxCoretaxMigration.js";
import { runFleetIntelligenceMigration } from "./routes/fleetIntelligence.js";
import { runFreightDocVerifyMigration } from "./routes/freightDocVerify.js";
import { runLogisticsRatesMigration } from "./lib/logisticsRatesMigration.js";
import { runProductVolumeCbmMigration } from "./routes/ecommerce.js";
import { runProductMediaMigration } from "./lib/productMediaMigration.js";
import { runAdvanceMigration } from "./routes/advances.js";
import { runCoaGovernanceMigration } from "./lib/coaGovernanceMigration.js";
import { runCoaProposalMigration } from "./lib/coaProposalMigration.js";
import { syncDevCoaToFixture } from "./lib/coaDevSync.js";

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function runSafe(name: string, fn: () => Promise<unknown>) {
  try {
    await fn();
    console.log(`  ✓ ${name}`);
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error(`  ✗ ${name}: ${msg}`);
  }
}

// Pre-startup: critical schema items (mirrors index.ts logic)
async function runCriticalPreStartMigrations() {
  await runMktApPreparationMigration();
  await db.execute(sql`
    CREATE TABLE IF NOT EXISTS wa_otp_codes (
      id SERIAL PRIMARY KEY, phone TEXT NOT NULL, code_hash TEXT NOT NULL,
      purpose TEXT NOT NULL DEFAULT 'register', attempts INTEGER NOT NULL DEFAULT 0,
      verified BOOLEAN NOT NULL DEFAULT FALSE, verify_token TEXT,
      expires_at TIMESTAMP NOT NULL, created_at TIMESTAMP NOT NULL DEFAULT NOW()
    )
  `).catch(() => {});
  await db.execute(sql`CREATE INDEX IF NOT EXISTS wa_otp_phone_idx ON wa_otp_codes (phone)`).catch(() => {});
  await db.execute(sql`CREATE INDEX IF NOT EXISTS wa_otp_token_idx ON wa_otp_codes (verify_token)`).catch(() => {});
  await db.execute(sql`
    CREATE TABLE IF NOT EXISTS trusted_devices (
      id SERIAL PRIMARY KEY, phone TEXT NOT NULL, device_token TEXT NOT NULL UNIQUE,
      expires_at TIMESTAMP NOT NULL, created_at TIMESTAMP NOT NULL DEFAULT NOW()
    )
  `).catch(() => {});
  console.log("  ✓ wa_otp_codes + trusted_devices");
}

async function main() {
  const isProd = process.env["NODE_ENV"] === "production" || !!process.env["REPLIT_DEPLOYMENT"];
  if (isProd) {
    console.error("ERROR: refusing to run dev migrations in production environment");
    process.exit(1);
  }

  console.log("\n=== Dev DB Migration Runner ===");
  console.log("Connecting to dev database...\n");

  // Quick connectivity check
  try {
    await db.execute(sql`SELECT 1`);
    console.log("  ✓ DB connection OK\n");
  } catch (err) {
    console.error("  ✗ DB connection FAILED:", err);
    process.exit(1);
  }

  console.log("--- Pre-start critical migrations ---");
  await runCriticalPreStartMigrations();

  console.log("\n--- Core/Org migrations ---");
  await runSafe("phase1", runPhase1Migration);
  await runSafe("phase2", runPhase2Migration);
  await runSafe("phase3aRfqVendorLinksFix", runPhase3aRfqVendorLinksFix);
  await runSafe("unifiedViews", runUnifiedViewsMigration);
  await runSafe("orderLinks", runOrderLinksMigration);
  await runSafe("vendorProfile", runVendorProfileMigration);
  await runSafe("portal", runPortalMigration);
  await runSafe("vendorProfileFields", runVendorProfileFieldsMigration);
  await runSafe("supplierEnhancement", runSupplierEnhancementMigration);
  await runSafe("oauthState", runOauthStateMigration);
  await runSafe("knowledgeBase", runKnowledgeBaseMigration);
  await runSafe("companies", runCompaniesMigration);
  await runSafe("holding", runHoldingMigration);
  await runSafe("sessions", runSessionsMigration);
  await runSafe("customRoles", runCustomRolesMigration);
  await runSafe("uom", runUomMigration);
  await runSafe("orgFull", runOrgFullMigration);
  await runSafe("orgUniqueCodes", runOrgUniqueCodesMigration);
  await runSafe("orgRole", runOrgRoleMigration);
  await runSafe("userRole", runUserRoleMigration);
  await runSafe("auditLog", runAuditLogMigration);
  await runSafe("navPreferences", runNavPreferencesMigration);
  await runSafe("notificationLog", runNotificationLogMigration);
  await runSafe("adminNotifications", runAdminNotificationsMigration);
  await runSafe("vendorNotifications", runVendorNotificationsMigration);
  await runSafe("vendorMiniForm", runVendorMiniFormMigration);
  await runSafe("customerQuoteFlow", runCustomerQuoteFlowMigration);
  await runSafe("enterprise", runEnterpriseMigration);
  await runSafe("shortLinks", runShortLinksMigration);
  await runSafe("geofence", runGeofenceMigration);
  await runSafe("orderFulfillment", runOrderFulfillmentMigration);
  await runSafe("trustedDevices", runTrustedDevicesMigration);
  await runSafe("auditReports", runAuditReportsMigration);
  await runSafe("waTemplate", runWaTemplateMigration);
  await runSafe("rls", runRlsMigration);
  await runSafe("commodityTemplate", runCommodityTemplateMigration);
  await runSafe("pushSubscriptions", migratePushSubscriptions);
  await runSafe("pgTrgm", runPgTrgmMigration);
  await runSafe("intelligenceAlertSettings", runIntelligenceAlertSettingsMigration);
  await runSafe("aiGovernance", runAiGovernanceMigration);
  await runSafe("purchaseTemplate", runPurchaseTemplateMigration);
  await runSafe("enterpriseWorkflow", runEnterpriseWorkflowMigration);
  await runSafe("orderProgress", runOrderProgressMigration);
  await runSafe("exceptionEnum", runExceptionEnumMigration);
  await runSafe("orderExceptions", runOrderExceptionsMigration);
  await runSafe("vendorCompanyAssignments", runVendorCompanyAssignmentsMigration);
  await runSafe("vendorCatalogSchema", runVendorCatalogSchemaMigration);
  await runSafe("featuredProduct", runFeaturedProductMigration);
  await runSafe("marketplaceVendorInvoice", runMktVendorInvoiceMigration);
  await runSafe("marketplaceApPreparation", runMktApPreparationMigration);
  await runSafe("logisticVendorFulfillments", runLogisticVendorFulfillmentsMigration);
  await runSafe("productFirstFlow", runProductFirstFlowMigration);
  await runSafe("step4Template", runStep4TemplateMigration);
  await runSafe("serviceTemplate", runServiceTemplateMigration);
  await runSafe("paylabsConfig", runPaylabsConfigMigration);
  await runSafe("paylabsPaymentMethods", runPaylabsPaymentMethodsMigration);
  await runSafe("sportCenter", runSportCenterMigration);
  await runSafe("sportCenterAccountCorrection", runSportCenterAccountCorrection);
  await runSafe("sportCenterCompanyInvoice", runSportCenterCompanyInvoiceMigration);
  await runSafe("sportExpenses", runSportExpensesMigration);
  await runSafe("tenant", runTenantMigration);
  await runSafe("btki", runBtkiMigration);
  await runSafe("tokenSecurity", runTokenSecurityMigration);
  await runSafe("masterPrice", runMasterPriceMigration);
  await runSafe("qaFixture", runQaFixtureMigration);
  await runSafe("taxRules", runTaxRulesMigration);
  await runSafe("taxSpt", runTaxSptMigration);
  await runSafe("taxAudit", runTaxAuditMigration);
  await runSafe("taxCoretax", runTaxCoretaxMigration);
  await runSafe("fleetIntelligence", runFleetIntelligenceMigration);
  await runSafe("freightDocVerify", runFreightDocVerifyMigration);
  await runSafe("logisticsRates", runLogisticsRatesMigration);
  await runSafe("productVolumeCbm", runProductVolumeCbmMigration);
  await runSafe("productMedia", runProductMediaMigration);
  await runSafe("advance", runAdvanceMigration);
  await runSafe("coaGovernance", runCoaGovernanceMigration);
  await runSafe("coaProposal", runCoaProposalMigration);
  await runSafe("freightAudit", runFreightAuditMigration);
  await runSafe("auditFix", runAuditFixMigration);

  console.log("\n--- Accounting / Finance migrations ---");
  await runSafe("accounting (core)", runAccountingMigration);
  await runSafe("accountingHub", runAccountingHubMigration);
  await runSafe("ledgerGuard", runLedgerGuardMigration);
  await runSafe("freightAccounting", runFreightAccountingMigration);
  await runSafe("bankReconciliationCore", runBankReconciliationCoreMigration);
  await runSafe("qrisSettlement", runQrisSettlementMigration);
  await runSafe("bankMutationMasters", runBankMutationMastersMigration);
  await runSafe("bankMutationImport", runBankMutationImportMigration);
  await runSafe("financialPeriod", runFinancialPeriodMigration);
  await runSafe("financialClosing", runFinancialClosingMigration);
  await runSafe("sapHardening", runSapHardeningMigration);
  await runSafe("financeGovernance", runFinanceGovernanceMigration);
  await runSafe("bankDisbursement", runBankDisbursementMigration);
  await runSafe("expenseDisbursementBridge", runExpenseDisbursementBridgeMigration);
  await runSafe("vendorPayments", runVendorPaymentsMigration);
  await runSafe("kasBank", runKasBankMigration);
  await runSafe("cashBank", runCashBankMigration);
  await runSafe("financeCore", runFinanceCoreMigration);
  await runSafe("bankReceipt", runBankReceiptMigration);
  await runSafe("allocation", runAllocationMigration);
  await runSafe("treasury", runTreasuryMigration);
  await runSafe("bankAllocation", runBankAllocationMigration);
  await runSafe("expenseRule", runExpenseRuleMigration);
  await runSafe("expenseClassification", runExpenseClassificationMigration);
  await runSafe("costCenter", runCostCenterMigration);
  await runSafe("repairKasErSportCenter (non-fatal)", repairKasErSportCenterEntries);
  await runSafe("repairOrphanedEntryLines (non-fatal)", repairOrphanedEntryLines);

  console.log("\n--- Accounting seeds ---");
  // Ensure expense_categories has a UNIQUE constraint on code before seeding
  await db.execute(sql`
    CREATE UNIQUE INDEX IF NOT EXISTS expense_categories_code_uniq ON expense_categories (code)
  `).catch(() => {});
  await runSafe("seedAccountingDefaults", () => seedAccountingDefaults());
  await runSafe("syncDevCoaToFixture", () => syncDevCoaToFixture());
  await runSafe("seedAdditionalTaxes", () => seedAdditionalTaxes());
  await runSafe("backfillExpenseCategoryAccounts", () => backfillExpenseCategoryAccounts());

  console.log("\n=== Migration runner complete ===\n");
  process.exit(0);
}

main().catch((err) => {
  console.error("Fatal error in migration runner:", err);
  process.exit(1);
});
