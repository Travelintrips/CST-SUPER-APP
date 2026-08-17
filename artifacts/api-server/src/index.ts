import app from "./app";
import { logger } from "./lib/logger";
import { bootstrapConfigFromSupabase } from "./lib/configBootstrap";
import { runTranslationsMigration } from "./lib/translationsMigration";
import { seedAccountingDefaults, seedAdditionalTaxes, backfillExpenseCategoryAccounts, backfillMdrExpenseCategory } from "./lib/accountingSeed";
import { syncDevCoaToFixture } from "./lib/coaDevSync";
import { seedLogisticsServiceItems } from "./lib/seedLogisticsItems";
import { seedCatalogProducts } from "./lib/seedCatalogProducts";
import { seedDemoData, seedDemoDrivers, seedAirFreightRates } from "./lib/seedDemoData";
import { startImapPoller } from "./lib/imapPoller";
import { startOcrTempCleanup } from "./lib/ocrTempCleanup";
import { startVmfGapNotifier, runVmfGapCheck } from "./lib/vmfGapNotifier";
import { startFulfillmentExpiryNotifier } from "./lib/fulfillmentExpiryNotifier";
import { startVendorInvitationApprovalReminder } from "./lib/vendorInvitationApprovalReminder";
import { runPhase1Migration } from "./lib/phase1Migration";
import { runPhase2Migration } from "./lib/phase2Migration";
import { runPhase3aRfqVendorLinksFix } from "./lib/phase3aRfqVendorLinksFix";
import { runUnifiedViewsMigration } from "./lib/unifiedViewsMigration";
import { runOrderLinksMigration } from "./lib/orderLinksMigration";
import { runVendorProfileMigration } from "./lib/vendorProfileMigration";
import { startWorkflowWorker } from "./lib/workflowWorker";
import { startDriverJobWorker } from "./lib/driverJobWorker.js";
import { startWaRetryWorker } from "./lib/waRetryWorker";
import { remediateOrphanProducts } from "./lib/remediateOrphanProducts";
import { seedProductTemplates } from "./routes/productTemplates.js";
import { runPortalMigration } from "./lib/portalMigration";
import { runVendorProfileFieldsMigration } from "./lib/vendorProfileFieldsMigration";
import { runSupplierEnhancementMigration } from "./lib/supplierEnhancementMigration";
import { runAccountingMigration, repairKasErSportCenterEntries, repairOrphanedEntryLines, syncAccountingSequences, checkSequenceDesync } from "./lib/accountingMigration";
import { runCoaGovernanceMigration } from "./lib/coaGovernanceMigration";
import { runCoaProposalMigration } from "./lib/coaProposalMigration.js";
import { runAccountingHubMigration } from "./lib/accountingHubMigration";
import { runGuardMigration as runLedgerGuardMigration } from "./lib/accounting/ledgerGuard.js";
import { runOauthStateMigration } from "./lib/oauthStateMigration";
import { enableRealtimeTables } from "./lib/enableRealtimeTables";
import { runKnowledgeBaseMigration } from "./lib/knowledgeBaseMigration";
import { runCompaniesMigration } from "./lib/companiesMigration";
import { runHoldingMigration } from "./lib/holdingMigration";

import { runSessionsMigration } from "./lib/sessionsMigration";
import { runCustomRolesMigration } from "./lib/customRolesMigration";
import { runUomMigration } from "./lib/uomMigration";
import { runFreightAuditMigration } from "./lib/freightAuditMigration";
import { runAuditFixMigration } from "./lib/auditFixMigration";
import { seedUom } from "./lib/uomSeed";
import { runOrgFullMigration } from "./lib/orgFullMigration";
import { runOrgUniqueCodesMigration } from "./lib/orgUniqueCodesMigration";
import { runOrgRoleMigration } from "./lib/orgRoleMigration";
import { runUserRoleMigration } from "./lib/userRoleMigration";
import { runAuditLogMigration } from "./lib/auditLogMigration";

import { runNavPreferencesMigration } from "./lib/navPreferencesMigration";
import { runNotificationLogMigration } from "./lib/notificationLogMigration";
import { runAdminNotificationsMigration } from "./lib/adminNotificationsMigration";
import { runVendorNotificationsMigration } from "./lib/vendorNotificationsMigration.js";

import { runVendorMiniFormMigration } from "./lib/vendorMiniFormMigration";
import { runCustomerQuoteFlowMigration } from "./lib/customerQuoteFlowMigration";
import { runEnterpriseMigration } from "./lib/enterpriseMigration";
import { runShortLinksMigration } from "./lib/shortLinksMigration";
import { runGeofenceMigration } from "./lib/geofenceMigration";
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
import { runMktVendorInvoiceMigration } from "./lib/mktVendorInvoiceMigration.js";
import { runMktApPreparationMigration } from "./lib/mktApPreparationMigration.js";
import { runMktPaymentHandoffMigration } from "./lib/mktPaymentHandoffMigration.js";
import { runMktAccountingHandoffMigration } from "./lib/mktAccountingHandoffMigration.js";
import { runMktReconciliationLinkMigration } from "./lib/mktReconciliationLinkMigration.js";
import { startFeaturedProductExpiryWorker } from "./lib/services/featuredProductExpiryWorker.js";
import { runLogisticVendorFulfillmentsMigration } from "./lib/logisticVendorFulfillmentsMigration.js";
import { runProductFirstFlowMigration } from "./lib/productFirstFlowMigration.js";
import { runStep4TemplateMigration } from "./lib/step4TemplateMigration.js";
import { runServiceTemplateMigration } from "./lib/serviceTemplateMigration.js";
import { runPaylabsConfigMigration, runPaylabsPaymentMethodsMigration } from "./routes/payments.js";
import { expireStaleApprovals } from "./lib/aiGovernance.js";
import { startDbBackupScheduler } from "./lib/dbBackup.js";
import { registerWorker, startAll } from "./lib/startupOrchestrator.js";
import { startTokenCleanupWorker } from "./workers/tokenCleanupWorker.js";
import { initAlertsBroadcast } from "./lib/alertsBroadcast.js";
import { warmupMailer } from "./lib/mailer.js";
import { ensureSportPaymentMirrorTrigger, runLedgerEventsEntryIdMigration, runSportCenterMigration, runSportCenterAccountCorrection, runSportCenterCompanyInvoiceMigration, runSportExpensesMigration } from "./modules/sport-center/migration.js";
import { runTenantMigration } from "./modules/tenant/migration.js";
import { startRecurringExpenseWorker } from "./modules/sport-center/recurringExpenseWorker.js";
import { startMemberReminderWorker } from "./modules/sport-center/memberReminderWorker.js";
import { startSportCenterPaymentSyncWorker } from "./modules/sport-center/sportCenterPaymentSyncWorker.js";
import { startIncrementalSyncWorker } from "./modules/sport-center/incrementalSyncWorker.js";
import { startExpenseReminderWorker } from "./lib/expenseReminderWorker.js";
import { startWhtReminderWorker } from "./lib/whtReminderWorker.js";
import { startProductFirstReminderWorker } from "./lib/productFirstReminderWorker.js";
import { startProductFirstExceptionWorker } from "./lib/productFirstExceptionWorker.js";
import { startRekonsiliasiWorker } from "./lib/rekonsiliasiWorker.js";
import { startLedgerConsistencyWorker } from "./lib/jobs/ledgerConsistencyCheck.js";
import { startOutboxProcessor } from "./lib/accounting/outboxProcessor.js";
import { startFinancialEventBusWorker } from "./lib/financialEventBus.js";
import { startFailedJobReplayWorker } from "./lib/financial/failedJobSystem.js";
import { startDualWriteRetryWorker, startDualWriteIntegrityWorker } from "./lib/services/dualWriteReliabilityService.js";
import { startDualWriteCleanupWorker } from "./lib/services/marketplaceDualWriteCleanupWorker.js";
import { startMarketplaceNotificationWorker } from "./lib/services/marketplaceNotificationWorker.js";
import { startIdempotencyCleanup } from "./lib/financial/idempotency.js";
import { startFleetNotificationWorker } from "./lib/fleetNotificationWorker.js";
import { startSheetSyncWorker } from "./lib/sheetSyncService.js";
import { startTaxLedgerSyncWorker } from "./lib/taxLedgerSyncService.js";
import { startTaxQueueMonitor } from "./lib/taxQueueMonitor.js";
import { startDbSyncWorker } from "./lib/dbSyncWorker.js";
import { startDailyReportWorker } from "./lib/dailyReportWorker.js";
import { startGsheetSyncWorker } from "./lib/workers/gsheetSyncWorker.js";
import { startIntegrationHealthWorker } from "./lib/integrationHealthWorker.js";
import { runCostCenterMigration } from "./lib/costCenterMigration.js";
// driver migrations are lazy-loaded to avoid startup crash-loop amplification
// (large route file parsed at module init time was a source of OOM on rapid restart)
let runDriverPodMigration: () => Promise<void>;
let runDriverAssignmentMigration: () => Promise<void>;
import { runLogisticsRatesMigration } from "./lib/logisticsRatesMigration.js";
import { runProductVolumeCbmMigration } from "./routes/ecommerce.js";
import { db, getPoolConfig } from "@workspace/db";
import { sql } from "drizzle-orm";
import { runStartupValidation } from "./lib/startupValidator.js";
import { backfillVendorPerformance } from "./routes/vendorPerformance.js";
import {
  installSafeDevOutboundGuard,
  logSafeDevStartupBanner,
} from "./lib/safeDev.js";
import { checkE2ESafety, assertE2ESafetyOrDie, registerE2ESafetyEndpoint } from "./lib/e2eSafetyGuard.js";
import { runProductMediaMigration } from "./lib/productMediaMigration.js";
import { runTaxRulesMigration } from "./lib/taxRulesMigration.js";
import { runTaxSptMigration } from "./lib/taxSptMigration.js";
import { runTaxAuditMigration } from "./lib/taxAuditMigration.js";
import { runTaxCoretaxMigration } from "./lib/taxCoretaxMigration.js";
import { runFreightAccountingMigration } from "./lib/freightAccountingMigration.js";
import { runBankReconciliationCoreMigration } from "./routes/bankReconciliation.js";
import { runQrisSettlementMigration } from "./lib/reconciliation/qrisSettlementMigration.js";
import { runUsageTrackingMigration } from "./lib/usageTrackingService.js";
import { runBankMutationMastersMigration } from "./routes/bankMutationMasters.js";
import { runBankMutationImportMigration } from "./routes/bankMutationImport.js";
import { runFleetIntelligenceMigration } from "./routes/fleetIntelligence.js";
import { runFreightDocVerifyMigration } from "./routes/freightDocVerify.js";
import { runBtkiMigration } from "./lib/btkiMigration.js";
import { runFinancialPeriodMigration } from "./lib/financialPeriodMigration.js";
import { runFinancialClosingMigration } from "./lib/financialClosingMigration.js";
import { runSapHardeningMigration } from "./lib/sapHardeningMigration.js";
import { runFinanceGovernanceMigration } from "./lib/financeGovernanceMigration.js";
import { startDriftMonitorWorker } from "./lib/monitoring/dataDriftDetector.js";
import { runBankDisbursementMigration, runExpenseDisbursementBridgeMigration } from "./lib/bankDisbursementMigration.js";
import { runVendorPaymentsMigration } from "./lib/vendorPaymentsMigration.js";
import { runKasBankMigration } from "./lib/kasBankMigration.js";
import { runCashBankMigration } from "./lib/cashBankMigration.js";
import { runFinanceCoreMigration } from "./lib/financeCoreMigration.js";
import { runBankReceiptMigration } from "./lib/bankReceiptMigration.js";
import { runAdvanceMigration } from "./routes/advances.js";
import { runAllocationMigration } from "./lib/allocationMigration.js";
import { runTreasuryMigration } from "./lib/treasury/treasuryMigration.js";
import { runBankAllocationMigration } from "./lib/bankAllocationMigration.js";
import { runExpenseRuleMigration } from "./lib/expenseRuleMigration.js";
import { runExpenseClassificationMigration } from "./lib/expenseClassificationMigration.js";
import { runTokenSecurityMigration } from "./lib/tokenSecurityMigration.js";
import { runMasterPriceMigration } from "./lib/masterPriceMigration.js";
import { runQaFixtureMigration } from "./lib/qaFixtureMigration.js";
import { runDeferredStartupTasks } from "./lib/deferredStartupTasks.js";
import {
  isStartupMigrationComplete,
  markStartupMigrationComplete,
  runStartupMigrationStage,
} from "./lib/startupMigrationState.js";
import {
  STARTUP_MIGRATION_REGISTRY,
  getStartupStageDefinition,
} from "./lib/startupMigrationRegistry.js";

// Port resolution order (deterministic, no ambiguity):
// 1. REPLIT_API_PORT — set by Replit deployment infra
// 2. PORT           — set by workflow command (our start-dev.sh sets PORT=$API_PORT)
// 3. API_PORT       — explicit override from workflow env
// 4. 8080           — stable default (never 5000 which is the Gateway port)
const rawPort = process.env["REPLIT_API_PORT"] ?? process.env["PORT"] ?? process.env["API_PORT"] ?? "8080";

// Security: PORTAL_ADMIN_EMAILS should be set in production.
if (process.env["NODE_ENV"] === "production" && !process.env["PORTAL_ADMIN_EMAILS"]?.trim()) {
  console.warn(
    "[WARN] PORTAL_ADMIN_EMAILS is not set. Portal admin access will rely on DB role only."
  );
}

const port = Number(rawPort);

if (Number.isNaN(port) || port <= 0) {
  throw new Error(`Invalid PORT value: "${rawPort}"`);
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

type StartupTiming = {
  name: string;
  duration_ms: number;
  status: "complete" | "failed";
  attempts?: number;
};

const startupTimings: StartupTiming[] = [];
const startupStageSummary = {
  total: STARTUP_MIGRATION_REGISTRY.length,
  executed: 0,
  skipped: 0,
  failed: 0,
};
const processMonotonicStartedAt = performance.now();

function startupElapsedMs(): number {
  return Math.round(performance.now() - processMonotonicStartedAt);
}

function logStartupStageSummary(): void {
  logger.info(
    {
      total: startupStageSummary.total,
      executed: startupStageSummary.executed,
      skipped: startupStageSummary.skipped,
      failed: startupStageSummary.failed,
      duration_ms: migrationStartedAt != null
        ? (migrationCompletedAt ?? Date.now()) - migrationStartedAt
        : null,
    },
    "Startup stage summary",
  );
}

function recordStartupTiming(
  name: string,
  startedAt: number,
  status: StartupTiming["status"],
  attempts?: number,
): number {
  const duration_ms = Math.max(0, Math.round(performance.now() - startedAt));
  startupTimings.push({ name, duration_ms, status, ...(attempts ? { attempts } : {}) });
  return duration_ms;
}

async function timeStartupStage<T>(name: string, fn: () => Promise<T>): Promise<T> {
  return runGatedStartupStage(name, async () => {
    const startedAt = performance.now();
    logger.info({ startup_elapsed_ms: startupElapsedMs() }, `${name}: timing start`);
    try {
      const result = await fn();
      const duration_ms = recordStartupTiming(name, startedAt, "complete");
      logger.info({ duration_ms, startup_elapsed_ms: startupElapsedMs() }, `${name}: timing complete`);
      return result;
    } catch (err) {
      const duration_ms = recordStartupTiming(name, startedAt, "failed");
      logger.error({ err, duration_ms }, `${name}: timing failed`);
      throw err;
    }
  });
}

function isTransientDbError(err: unknown): boolean {
  if (!(err instanceof Error)) return false;
  const TRANSIENT = ["ECIRCUITBREAKER", "password authentication failed", "timeout exceeded", "ECONNREFUSED", "ETIMEDOUT", "temporarily blocked"];
  const causeMsg = (err as unknown as { cause?: { message?: string } }).cause?.message ?? "";
  const fullMsg = err.message + " " + causeMsg;
  return TRANSIENT.some((t) => fullMsg.includes(t));
}

async function runWithRetry<T>(
  name: string,
  fn: () => Promise<T>,
  maxAttempts = 5,
  delayMs = 15_000
): Promise<void> {
  await runGatedStartupStage(name, async () => {
    const stageStartedAt = performance.now();
    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
      const attemptStartedAt = performance.now();
      try {
        logger.info(
          { attempt, maxAttempts, startup_elapsed_ms: startupElapsedMs() },
          `${name}: starting`,
        );
        await fn();
        const duration_ms = recordStartupTiming(name, stageStartedAt, "complete", attempt);
        logger.info({ attempt, duration_ms, startup_elapsed_ms: startupElapsedMs() }, `${name}: complete`);
        return;
      } catch (err: unknown) {
        const attempt_duration_ms = Math.max(0, Math.round(performance.now() - attemptStartedAt));
        const isTransient = isTransientDbError(err);
        if (isTransient && attempt < maxAttempts) {
          const backoff = delayMs * attempt;
          logger.warn(
            { attempt, maxAttempts, backoff, attempt_duration_ms },
            `${name}: transient DB error, retrying after ${backoff}ms...`
          );
          await sleep(backoff);
        } else {
          const duration_ms = recordStartupTiming(name, stageStartedAt, "failed", attempt);
          logger.error({ err, duration_ms }, `${name} failed (giving up after ${attempt} attempts)`);
          throw err;
        }
      }
    }
  });
}

async function runGatedStartupStage<T>(
  displayName: string,
  fn: () => Promise<T>,
): Promise<T> {
  const stage = getStartupStageDefinition(displayName);
  try {
    const result = await runStartupMigrationStage(stage, fn);
    if (result.status === "skipped") {
      startupStageSummary.skipped++;
      return undefined as T;
    }
    startupStageSummary.executed++;
    return result.value as T;
  } catch (error) {
    startupStageSummary.failed++;
    throw error;
  }
}

// ── Pre-startup critical schema migrations (run BEFORE accepting requests) ────
// These ensure Drizzle ORM columns exist before any query can be executed.
const PRE_START_SCHEMA_BOOTSTRAP_VERSION = "schema-bootstrap-v1";

async function runCriticalPreStartMigrations() {
  if (await isStartupMigrationComplete("api_pre_start_schema", PRE_START_SCHEMA_BOOTSTRAP_VERSION)) {
    logger.info("Pre-start schema bootstrap already provisioned; repeated DDL/backfill skipped");
    return;
  }

  // Accounting posting emits a non-fatal audit event. Upgrade legacy
  // ledger_events before any authenticated posting can be accepted.
  logger.info("Pre-start migration: ledger events entry_id starting");
  await runLedgerEventsEntryIdMigration();
  logger.info("Pre-start migration: ledger events entry_id complete");

  // Install the canonical Sport Center payment resolver before the long
  // startup migration chain. This is the same idempotent runtime installer
  // used by runSportCenterMigration; it does not post accounting or create
  // settlement records.
  try {
    logger.info("Pre-start migration: Sport Center mirror trigger starting");
    await ensureSportPaymentMirrorTrigger();
    logger.info("Sport Center canonical payment metadata resolver ready");
  } catch (err) {
    logger.error({ err }, "Sport Center canonical payment resolver installation failed");
    throw err;
  }

  // Sprint 8B AP handoff must be available before the API accepts lifecycle
  // writes. Run it first so unrelated legacy DDL cannot delay this scope.
  try {
    logger.info("Pre-start migration: marketplace AP preparation starting");
    await runMktApPreparationMigration();
    logger.info("Pre-start migration: marketplace AP preparation complete");
  } catch (err) {
    logger.error({ err }, "Marketplace AP preparation migration failed");
    throw err;
  }
  try {
    logger.info("Pre-start migration: marketplace handoff chain starting");
    await runMktPaymentHandoffMigration();
    await runMktAccountingHandoffMigration();
    // Sprint 09E development-only verification schema. Production schema
    // changes are applied through the publish flow, never startup DDL.
    const isDevelopment = process.env["NODE_ENV"] !== "production"
      && !process.env["REPLIT_DEPLOYMENT"];
    if (isDevelopment) {
      await runMktReconciliationLinkMigration();
    }
    logger.info("Pre-start migration: marketplace handoff chain complete");
  } catch (err) {
    logger.error({ err }, "Marketplace payment handoff migration failed");
    throw err;
  }

  // Buat wa_otp_codes dan trusted_devices PERTAMA — diperlukan untuk WA OTP login
  // Gunakan try/catch terpisah agar tidak menghalangi migrasi lain
  try {
    await db.execute(sql`
      CREATE TABLE IF NOT EXISTS wa_otp_codes (
        id          SERIAL PRIMARY KEY,
        phone       TEXT NOT NULL,
        code_hash   TEXT NOT NULL,
        purpose     TEXT NOT NULL DEFAULT 'register',
        attempts    INTEGER NOT NULL DEFAULT 0,
        verified    BOOLEAN NOT NULL DEFAULT FALSE,
        verify_token TEXT,
        expires_at  TIMESTAMP NOT NULL,
        created_at  TIMESTAMP NOT NULL DEFAULT NOW()
      )
    `);
    await db.execute(sql`CREATE INDEX IF NOT EXISTS wa_otp_phone_idx ON wa_otp_codes (phone)`);
    await db.execute(sql`CREATE INDEX IF NOT EXISTS wa_otp_token_idx ON wa_otp_codes (verify_token)`);
    await db.execute(sql`
      CREATE TABLE IF NOT EXISTS trusted_devices (
        id           SERIAL PRIMARY KEY,
        phone        TEXT NOT NULL,
        device_token TEXT NOT NULL UNIQUE,
        expires_at   TIMESTAMP NOT NULL,
        created_at   TIMESTAMP NOT NULL DEFAULT NOW()
      )
    `);
    logger.info("wa_otp_codes & trusted_devices tables ready");
  } catch (err) {
    logger.warn({ err }, "wa_otp_codes creation failed (non-fatal, will retry via portal migration)");
  }

  // Add grir_account_id column without FK (FK is added later in accountingMigration when COA exists)
  await db.execute(sql`
    DO $$ BEGIN
      IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'accounting_settings') THEN
        IF NOT EXISTS (
          SELECT 1 FROM information_schema.columns
          WHERE table_name = 'accounting_settings' AND column_name = 'grir_account_id'
        ) THEN
          ALTER TABLE accounting_settings ADD COLUMN grir_account_id INTEGER;
        END IF;
      END IF;
    END $$;
  `);

  // Add condition column to wh_return_lines for "kondisi barang" (layak / rusak / hilang)
  await db.execute(sql`
    DO $$ BEGIN
      IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'wh_return_lines') THEN
        IF NOT EXISTS (
          SELECT 1 FROM information_schema.columns
          WHERE table_name = 'wh_return_lines' AND column_name = 'condition'
        ) THEN
          ALTER TABLE wh_return_lines ADD COLUMN condition TEXT NOT NULL DEFAULT 'layak';
        END IF;
      END IF;
    END $$;
  `);

  // Add is_commodity_tag to vendor_catalog_items for blast auto-matching
  await db.execute(sql`
    DO $$ BEGIN
      IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'vendor_catalog_items') THEN
        IF NOT EXISTS (
          SELECT 1 FROM information_schema.columns
          WHERE table_name = 'vendor_catalog_items' AND column_name = 'is_commodity_tag'
        ) THEN
          ALTER TABLE vendor_catalog_items ADD COLUMN is_commodity_tag BOOLEAN NOT NULL DEFAULT FALSE;
        END IF;
      END IF;
    END $$;
  `);

  // Ensure wh_returns has company_id column (older installs may lack it)
  await db.execute(sql`
    DO $$ BEGIN
      IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'wh_returns') THEN
        IF NOT EXISTS (
          SELECT 1 FROM information_schema.columns
          WHERE table_name = 'wh_returns' AND column_name = 'company_id'
        ) THEN
          ALTER TABLE wh_returns ADD COLUMN company_id INTEGER;
        END IF;
      END IF;
    END $$;
  `);

  // Add order_type to logistic_orders (Drizzle schema field missing from older DB installs)
  await db.execute(sql`
    DO $$ BEGIN
      IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_name = 'logistic_orders' AND column_name = 'order_type'
      ) THEN
        ALTER TABLE logistic_orders ADD COLUMN order_type TEXT NOT NULL DEFAULT 'shipment';
      END IF;
    END $$;
  `);

  // Add version column to logistic_orders (optimistic locking)
  await db.execute(sql`
    DO $$ BEGIN
      IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_name = 'logistic_orders' AND column_name = 'version'
      ) THEN
        ALTER TABLE logistic_orders ADD COLUMN version INTEGER NOT NULL DEFAULT 1;
      END IF;
    END $$;
  `);

  // Add vendor_accept_token and vendor_accepted_at to purchase_documents (Vendor PO Accept feature)
  await db.execute(sql`
    DO $$ BEGIN
      IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'purchase_documents') THEN
        IF NOT EXISTS (
          SELECT 1 FROM information_schema.columns
          WHERE table_name = 'purchase_documents' AND column_name = 'vendor_accept_token'
        ) THEN
          ALTER TABLE purchase_documents ADD COLUMN vendor_accept_token TEXT UNIQUE;
        END IF;
        IF NOT EXISTS (
          SELECT 1 FROM information_schema.columns
          WHERE table_name = 'purchase_documents' AND column_name = 'vendor_accepted_at'
        ) THEN
          ALTER TABLE purchase_documents ADD COLUMN vendor_accepted_at TIMESTAMP;
        END IF;
        IF NOT EXISTS (
          SELECT 1 FROM information_schema.columns
          WHERE table_name = 'purchase_documents' AND column_name = 'vendor_accept_notes'
        ) THEN
          ALTER TABLE purchase_documents ADD COLUMN vendor_accept_notes TEXT;
        END IF;
      END IF;
    END $$;
  `);

  // Add volume_cbm to products (CBM langsung untuk item kapas)
  await db.execute(sql`
    DO $$ BEGIN
      IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_name = 'products' AND column_name = 'volume_cbm'
      ) THEN
        ALTER TABLE products ADD COLUMN volume_cbm NUMERIC(12,4);
      END IF;
    END $$;
  `);

  // Add missing columns to logistic_orders (multi-mode, product, AI, truck fields)
  await db.execute(sql`
    DO $$ BEGIN
      IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'logistic_orders') THEN
        IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='logistic_orders' AND column_name='transport_mode') THEN
          ALTER TABLE logistic_orders ADD COLUMN transport_mode TEXT;
        END IF;
        IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='logistic_orders' AND column_name='origin_district') THEN
          ALTER TABLE logistic_orders ADD COLUMN origin_district TEXT;
        END IF;
        IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='logistic_orders' AND column_name='dest_district') THEN
          ALTER TABLE logistic_orders ADD COLUMN dest_district TEXT;
        END IF;
        IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='logistic_orders' AND column_name='etd') THEN
          ALTER TABLE logistic_orders ADD COLUMN etd TIMESTAMPTZ;
        END IF;
        IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='logistic_orders' AND column_name='eta') THEN
          ALTER TABLE logistic_orders ADD COLUMN eta TIMESTAMPTZ;
        END IF;
        IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='logistic_orders' AND column_name='origin_port') THEN
          ALTER TABLE logistic_orders ADD COLUMN origin_port TEXT;
        END IF;
        IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='logistic_orders' AND column_name='dest_port') THEN
          ALTER TABLE logistic_orders ADD COLUMN dest_port TEXT;
        END IF;
        IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='logistic_orders' AND column_name='options_token') THEN
          ALTER TABLE logistic_orders ADD COLUMN options_token TEXT UNIQUE;
        END IF;
        IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='logistic_orders' AND column_name='options_sent_at') THEN
          ALTER TABLE logistic_orders ADD COLUMN options_sent_at TIMESTAMPTZ;
        END IF;
        IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='logistic_orders' AND column_name='direction') THEN
          ALTER TABLE logistic_orders ADD COLUMN direction TEXT;
        END IF;
        IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='logistic_orders' AND column_name='is_dangerous_good') THEN
          ALTER TABLE logistic_orders ADD COLUMN is_dangerous_good BOOLEAN DEFAULT FALSE;
        END IF;
        IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='logistic_orders' AND column_name='service_category') THEN
          ALTER TABLE logistic_orders ADD COLUMN service_category TEXT;
        END IF;
        IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='logistic_orders' AND column_name='cargo_special_tags') THEN
          ALTER TABLE logistic_orders ADD COLUMN cargo_special_tags TEXT[];
        END IF;
        IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='logistic_orders' AND column_name='required_docs') THEN
          ALTER TABLE logistic_orders ADD COLUMN required_docs TEXT[];
        END IF;
        IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='logistic_orders' AND column_name='truck_vendor_id') THEN
          ALTER TABLE logistic_orders ADD COLUMN truck_vendor_id INTEGER;
        END IF;
        IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='logistic_orders' AND column_name='truck_price') THEN
          ALTER TABLE logistic_orders ADD COLUMN truck_price NUMERIC(14,2);
        END IF;
        IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='logistic_orders' AND column_name='truck_source') THEN
          ALTER TABLE logistic_orders ADD COLUMN truck_source TEXT;
        END IF;
        IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='logistic_orders' AND column_name='product_price') THEN
          ALTER TABLE logistic_orders ADD COLUMN product_price NUMERIC(14,2);
        END IF;
        IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='logistic_orders' AND column_name='ai_session_token') THEN
          ALTER TABLE logistic_orders ADD COLUMN ai_session_token TEXT;
        END IF;
        IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='logistic_orders' AND column_name='payment_type') THEN
          ALTER TABLE logistic_orders ADD COLUMN payment_type TEXT;
        END IF;
        IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='logistic_orders' AND column_name='payment_method') THEN
          ALTER TABLE logistic_orders ADD COLUMN payment_method TEXT;
        END IF;
        IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='logistic_orders' AND column_name='nama_penerima') THEN
          ALTER TABLE logistic_orders ADD COLUMN nama_penerima TEXT;
        END IF;
        IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='logistic_orders' AND column_name='nomor_penerima') THEN
          ALTER TABLE logistic_orders ADD COLUMN nomor_penerima TEXT;
        END IF;
        IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='logistic_orders' AND column_name='pickup_date') THEN
          ALTER TABLE logistic_orders ADD COLUMN pickup_date TEXT;
        END IF;
        IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='logistic_orders' AND column_name='pickup_time') THEN
          ALTER TABLE logistic_orders ADD COLUMN pickup_time TEXT;
        END IF;
        IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='logistic_orders' AND column_name='truck_type') THEN
          ALTER TABLE logistic_orders ADD COLUMN truck_type TEXT;
        END IF;
        IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='logistic_orders' AND column_name='markup_percent') THEN
          ALTER TABLE logistic_orders ADD COLUMN markup_percent NUMERIC(5,2) DEFAULT 20;
        END IF;
        IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='logistic_orders' AND column_name='final_price') THEN
          ALTER TABLE logistic_orders ADD COLUMN final_price NUMERIC(14,2);
        END IF;
        IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='logistic_orders' AND column_name='final_selling_price') THEN
          ALTER TABLE logistic_orders ADD COLUMN final_selling_price NUMERIC(14,2);
        END IF;
        IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='logistic_orders' AND column_name='quotation_sent_at') THEN
          ALTER TABLE logistic_orders ADD COLUMN quotation_sent_at TIMESTAMP;
        END IF;
        IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='logistic_orders' AND column_name='customer_confirm_token') THEN
          ALTER TABLE logistic_orders ADD COLUMN customer_confirm_token TEXT UNIQUE;
        END IF;
        IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='logistic_orders' AND column_name='customer_confirm_status') THEN
          ALTER TABLE logistic_orders ADD COLUMN customer_confirm_status TEXT DEFAULT 'pending';
        END IF;
        IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='logistic_orders' AND column_name='customer_confirmed_at') THEN
          ALTER TABLE logistic_orders ADD COLUMN customer_confirmed_at TIMESTAMP;
        END IF;
        IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='logistic_orders' AND column_name='approved_quote_id') THEN
          ALTER TABLE logistic_orders ADD COLUMN approved_quote_id INTEGER;
        END IF;
        IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='logistic_orders' AND column_name='admin_approval_status') THEN
          ALTER TABLE logistic_orders ADD COLUMN admin_approval_status TEXT DEFAULT 'pending';
        END IF;
        IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='logistic_orders' AND column_name='approved_at') THEN
          ALTER TABLE logistic_orders ADD COLUMN approved_at TIMESTAMP;
        END IF;
        IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='logistic_orders' AND column_name='approved_vendor_id') THEN
          ALTER TABLE logistic_orders ADD COLUMN approved_vendor_id INTEGER;
        END IF;
        IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='logistic_orders' AND column_name='source') THEN
          ALTER TABLE logistic_orders ADD COLUMN source TEXT NOT NULL DEFAULT 'manual';
        END IF;
        IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='logistic_orders' AND column_name='jam_order') THEN
          ALTER TABLE logistic_orders ADD COLUMN jam_order TEXT;
        END IF;
        IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='logistic_orders' AND column_name='required_date') THEN
          ALTER TABLE logistic_orders ADD COLUMN required_date TEXT;
        END IF;
        IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='logistic_orders' AND column_name='jumlah_koli') THEN
          ALTER TABLE logistic_orders ADD COLUMN jumlah_koli INTEGER;
        END IF;
        IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='logistic_orders' AND column_name='cargo_description') THEN
          ALTER TABLE logistic_orders ADD COLUMN cargo_description TEXT;
        END IF;
        IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='logistic_orders' AND column_name='sender_name') THEN
          ALTER TABLE logistic_orders ADD COLUMN sender_name TEXT;
        END IF;
      END IF;
    END $$;
  `);

  // Add missing columns to drivers table
  await db.execute(sql`
    DO $$ BEGIN
      IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'drivers') THEN
        IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='drivers' AND column_name='company_id') THEN
          ALTER TABLE drivers ADD COLUMN company_id INTEGER;
        END IF;
      END IF;
    END $$;
  `);

  // Add kategori to vendor_catalog_items
  await db.execute(sql`
    DO $$ BEGIN
      IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'vendor_catalog_items') THEN
        IF NOT EXISTS (
          SELECT 1 FROM information_schema.columns
          WHERE table_name = 'vendor_catalog_items' AND column_name = 'kategori'
        ) THEN
          ALTER TABLE vendor_catalog_items ADD COLUMN kategori TEXT;
        END IF;
      END IF;
    END $$;
  `);

  // Add lead_time_days and stock_availability to rfq_vendor_links
  await db.execute(sql`
    DO $$ BEGIN
      IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'rfq_vendor_links') THEN
        IF NOT EXISTS (
          SELECT 1 FROM information_schema.columns
          WHERE table_name = 'rfq_vendor_links' AND column_name = 'lead_time_days'
        ) THEN
          ALTER TABLE rfq_vendor_links ADD COLUMN lead_time_days INTEGER;
        END IF;
        IF NOT EXISTS (
          SELECT 1 FROM information_schema.columns
          WHERE table_name = 'rfq_vendor_links' AND column_name = 'stock_availability'
        ) THEN
          ALTER TABLE rfq_vendor_links ADD COLUMN stock_availability TEXT DEFAULT 'unknown';
        END IF;
      END IF;
    END $$;
  `);

  // Add template columns to logistic_order_rfqs
  await db.execute(sql`
    DO $$ BEGIN
      IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'logistic_order_rfqs') THEN
        IF NOT EXISTS (
          SELECT 1 FROM information_schema.columns
          WHERE table_name = 'logistic_order_rfqs' AND column_name = 'template_id'
        ) THEN
          ALTER TABLE logistic_order_rfqs ADD COLUMN template_id INTEGER;
        END IF;
        IF NOT EXISTS (
          SELECT 1 FROM information_schema.columns
          WHERE table_name = 'logistic_order_rfqs' AND column_name = 'template_version'
        ) THEN
          ALTER TABLE logistic_order_rfqs ADD COLUMN template_version TEXT;
        END IF;
        IF NOT EXISTS (
          SELECT 1 FROM information_schema.columns
          WHERE table_name = 'logistic_order_rfqs' AND column_name = 'template_snapshot'
        ) THEN
          ALTER TABLE logistic_order_rfqs ADD COLUMN template_snapshot JSONB;
        END IF;
        IF NOT EXISTS (
          SELECT 1 FROM information_schema.columns
          WHERE table_name = 'logistic_order_rfqs' AND column_name = 'created_by_user_id'
        ) THEN
          ALTER TABLE logistic_order_rfqs ADD COLUMN created_by_user_id TEXT;
        END IF;
        IF NOT EXISTS (
          SELECT 1 FROM information_schema.columns
          WHERE table_name = 'logistic_order_rfqs' AND column_name = 'created_by_user_name'
        ) THEN
          ALTER TABLE logistic_order_rfqs ADD COLUMN created_by_user_name TEXT;
        END IF;
        IF NOT EXISTS (
          SELECT 1 FROM information_schema.columns
          WHERE table_name = 'logistic_order_rfqs' AND column_name = 'opened_vendor_ids'
        ) THEN
          ALTER TABLE logistic_order_rfqs ADD COLUMN opened_vendor_ids INTEGER[] NOT NULL DEFAULT '{}';
        END IF;
        IF NOT EXISTS (
          SELECT 1 FROM information_schema.columns
          WHERE table_name = 'logistic_order_rfqs' AND column_name = 'vendor_ids'
        ) THEN
          ALTER TABLE logistic_order_rfqs ADD COLUMN vendor_ids INTEGER[] NOT NULL DEFAULT '{}';
        END IF;
      END IF;
    END $$;
  `);

  // Ensure sessions table exists (critical for login)
  await db.execute(sql`
    CREATE TABLE IF NOT EXISTS sessions (
      sid    TEXT PRIMARY KEY,
      sess   JSONB NOT NULL,
      expire TIMESTAMPTZ NOT NULL
    )
  `);
  await db.execute(sql`
    CREATE INDEX IF NOT EXISTS "IDX_session_expire" ON sessions (expire)
  `);

  // Add missing users columns (login query selects these)
  await db.execute(sql`
    DO $$ BEGIN
      IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'users') THEN
        IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='users' AND column_name='division') THEN
          ALTER TABLE users ADD COLUMN division TEXT;
        END IF;
        IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='users' AND column_name='system_role') THEN
          ALTER TABLE users ADD COLUMN system_role TEXT;
        END IF;
        IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='users' AND column_name='default_branch_id') THEN
          ALTER TABLE users ADD COLUMN default_branch_id INTEGER;
        END IF;
      END IF;
    END $$;
  `);

  // Add missing accounting_settings columns (portal and BizPortal queries select these)
  await db.execute(sql`
    DO $$ BEGIN
      IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'accounting_settings') THEN
        IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='accounting_settings' AND column_name='cogs_account_id') THEN
          ALTER TABLE accounting_settings ADD COLUMN cogs_account_id INTEGER;
        END IF;
        IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='accounting_settings' AND column_name='inventory_account_id') THEN
          ALTER TABLE accounting_settings ADD COLUMN inventory_account_id INTEGER;
        END IF;
        IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='accounting_settings' AND column_name='company_name') THEN
          ALTER TABLE accounting_settings ADD COLUMN company_name TEXT;
        END IF;
        IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='accounting_settings' AND column_name='company_address') THEN
          ALTER TABLE accounting_settings ADD COLUMN company_address TEXT;
        END IF;
        IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='accounting_settings' AND column_name='company_npwp') THEN
          ALTER TABLE accounting_settings ADD COLUMN company_npwp TEXT;
        END IF;
        IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='accounting_settings' AND column_name='company_logo_url') THEN
          ALTER TABLE accounting_settings ADD COLUMN company_logo_url TEXT;
        END IF;
        IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='accounting_settings' AND column_name='meta') THEN
          ALTER TABLE accounting_settings ADD COLUMN meta JSONB;
        END IF;
        IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='accounting_settings' AND column_name='updated_at') THEN
          ALTER TABLE accounting_settings ADD COLUMN updated_at TIMESTAMPTZ DEFAULT NOW();
        END IF;
      END IF;
    END $$;
  `);

  // Create logistics rate tables (needed before first request, not deferrable)
  await runLogisticsRatesMigration();

  // Buat tabel wa_otp_codes (diperlukan untuk WA OTP login BizPortal)
  await db.execute(sql`
    CREATE TABLE IF NOT EXISTS wa_otp_codes (
      id          SERIAL PRIMARY KEY,
      phone       TEXT NOT NULL,
      code_hash   TEXT NOT NULL,
      purpose     TEXT NOT NULL DEFAULT 'register',
      attempts    INTEGER NOT NULL DEFAULT 0,
      verified    BOOLEAN NOT NULL DEFAULT FALSE,
      verify_token TEXT,
      expires_at  TIMESTAMP NOT NULL,
      created_at  TIMESTAMP NOT NULL DEFAULT NOW()
    )
  `);
  await db.execute(sql`CREATE INDEX IF NOT EXISTS wa_otp_phone_idx ON wa_otp_codes (phone)`);
  await db.execute(sql`CREATE INDEX IF NOT EXISTS wa_otp_token_idx ON wa_otp_codes (verify_token)`);
  await db.execute(sql`
    CREATE TABLE IF NOT EXISTS trusted_devices (
      id           SERIAL PRIMARY KEY,
      phone        TEXT NOT NULL,
      device_token TEXT NOT NULL UNIQUE,
      expires_at   TIMESTAMP NOT NULL,
      created_at   TIMESTAMP NOT NULL DEFAULT NOW()
    )
  `);

  // sport_bookings: dedup + UNIQUE constraint on booking_number.
  // Must run here (before workers fire) so ON CONFLICT upsert in
  // sport-center-incremental-sync works on first cycle.
  try {
    if (
      (
        await db.execute(sql`
          SELECT 1 FROM information_schema.tables
          WHERE table_name = 'sport_bookings'
        `)
      ).rows.length > 0
    ) {
      // Remove duplicate rows — keep the row with the highest id per booking_number
      await db.execute(sql`
        DELETE FROM sport_bookings a
        USING sport_bookings b
        WHERE a.id < b.id
          AND a.booking_number = b.booking_number;
      `);
      // Add UNIQUE constraint idempotently
      await db.execute(sql`
        DO $$
        BEGIN
          IF NOT EXISTS (
            SELECT 1 FROM pg_constraint
            WHERE conrelid = 'sport_bookings'::regclass
              AND contype   = 'u'
              AND conname   = 'sport_bookings_booking_number_key'
          ) THEN
            ALTER TABLE sport_bookings
              ADD CONSTRAINT sport_bookings_booking_number_key UNIQUE (booking_number);
          END IF;
        END $$;
      `);
    }
  } catch (err) {
    logger.warn({ err }, "sport_bookings unique constraint: failed (non-fatal, will retry via sport center migration)");
  }

  // Add portal_order_id to ppjk_orders — links customer portal order to PPJK order
  // Use ADD COLUMN IF NOT EXISTS (pgBouncer transaction-mode safe — avoids DO $ block)
  await db.execute(sql`ALTER TABLE ppjk_orders ADD COLUMN IF NOT EXISTS portal_order_id INTEGER`).catch((err: any) => {
    const code = err?.cause?.code ?? err?.code ?? "";
    // 42701 = duplicate_column (already exists), 42P01 = table does not exist — both safe to ignore
    if (!["42701", "42P01"].includes(code)) throw err;
  });

  // ── PPJK Phase 2 Enterprise Migrations ────────────────────────────────────
  // Migration safety helper: only ignore duplicate-object PG errors; throw all others.
  async function runPpjkMigration(name: string, stmt: ReturnType<typeof sql>): Promise<void> {
    try {
      await db.execute(stmt);
    } catch (err: any) {
      const pgCode: string = err?.cause?.code ?? err?.code ?? "";
      // Idempotent codes: duplicate_column, duplicate_table, duplicate_object, duplicate_schema
      if (["42701", "42P07", "42710", "42P16"].includes(pgCode)) {
        logger.debug(`[ppjk-migration:${name}] Already exists (${pgCode}), skipping`);
        return;
      }
      logger.error(`[ppjk-migration:${name}] FAILED — startup blocked:`, err);
      throw new Error(`PPJK migration '${name}' failed: ${err?.message ?? err}`);
    }
  }

  // Phase 2: workflow_validated column
  await runPpjkMigration("workflow_validated", sql`ALTER TABLE ppjk_orders ADD COLUMN IF NOT EXISTS workflow_validated TEXT NOT NULL DEFAULT 'no'`);

  // Phase 7: SLA columns
  await runPpjkMigration("sla_deadline",     sql`ALTER TABLE ppjk_orders ADD COLUMN IF NOT EXISTS sla_deadline TIMESTAMPTZ`);
  await runPpjkMigration("is_overdue",       sql`ALTER TABLE ppjk_orders ADD COLUMN IF NOT EXISTS is_overdue TEXT NOT NULL DEFAULT 'no'`);
  await runPpjkMigration("status_entered_at", sql`ALTER TABLE ppjk_orders ADD COLUMN IF NOT EXISTS status_entered_at TIMESTAMPTZ DEFAULT NOW()`);

  // Phase 8: assignment columns
  await runPpjkMigration("assigned_officer_name", sql`ALTER TABLE ppjk_orders ADD COLUMN IF NOT EXISTS assigned_officer_name TEXT`);
  await runPpjkMigration("assigned_officer_id",   sql`ALTER TABLE ppjk_orders ADD COLUMN IF NOT EXISTS assigned_officer_id TEXT`);
  await runPpjkMigration("assigned_team",         sql`ALTER TABLE ppjk_orders ADD COLUMN IF NOT EXISTS assigned_team TEXT`);
  await runPpjkMigration("assigned_supervisor",   sql`ALTER TABLE ppjk_orders ADD COLUMN IF NOT EXISTS assigned_supervisor TEXT`);
  await runPpjkMigration("assigned_at",           sql`ALTER TABLE ppjk_orders ADD COLUMN IF NOT EXISTS assigned_at TIMESTAMPTZ`);

  // Phase 9: extended financial columns
  await runPpjkMigration("bmtp",          sql`ALTER TABLE ppjk_orders ADD COLUMN IF NOT EXISTS bmtp TEXT`);
  await runPpjkMigration("bmad",          sql`ALTER TABLE ppjk_orders ADD COLUMN IF NOT EXISTS bmad TEXT`);
  await runPpjkMigration("storage_fee",   sql`ALTER TABLE ppjk_orders ADD COLUMN IF NOT EXISTS storage_fee TEXT`);
  await runPpjkMigration("handling_fee",  sql`ALTER TABLE ppjk_orders ADD COLUMN IF NOT EXISTS handling_fee TEXT`);
  await runPpjkMigration("thc",           sql`ALTER TABLE ppjk_orders ADD COLUMN IF NOT EXISTS thc TEXT`);
  await runPpjkMigration("do_fee",        sql`ALTER TABLE ppjk_orders ADD COLUMN IF NOT EXISTS do_fee TEXT`);
  await runPpjkMigration("forwarding_fee", sql`ALTER TABLE ppjk_orders ADD COLUMN IF NOT EXISTS forwarding_fee TEXT`);
  await runPpjkMigration("trucking_fee",  sql`ALTER TABLE ppjk_orders ADD COLUMN IF NOT EXISTS trucking_fee TEXT`);
  await runPpjkMigration("misc_fee",      sql`ALTER TABLE ppjk_orders ADD COLUMN IF NOT EXISTS misc_fee TEXT`);

  // Phase 2 R2: Idempotency — unique constraint on portal_order_id
  await runPpjkMigration("portal_order_id_uniq", sql`
    CREATE UNIQUE INDEX IF NOT EXISTS ppjk_portal_order_id_uniq
    ON ppjk_orders (portal_order_id)
    WHERE portal_order_id IS NOT NULL
  `);

  // Phase 4: ppjk_status_logs table
  await runPpjkMigration("ppjk_status_logs", sql`
    CREATE TABLE IF NOT EXISTS ppjk_status_logs (
      id             SERIAL PRIMARY KEY,
      ppjk_order_id  INTEGER NOT NULL REFERENCES ppjk_orders(id) ON DELETE CASCADE,
      old_status     TEXT,
      new_status     TEXT NOT NULL,
      changed_by     TEXT NOT NULL,
      changed_by_id  TEXT,
      changed_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      notes          TEXT,
      ip_address     TEXT,
      user_agent     TEXT
    )
  `);
  await runPpjkMigration("ppjk_sl_order_idx",      sql`CREATE INDEX IF NOT EXISTS ppjk_sl_order_idx ON ppjk_status_logs (ppjk_order_id)`);
  await runPpjkMigration("ppjk_sl_changed_at_idx", sql`CREATE INDEX IF NOT EXISTS ppjk_sl_changed_at_idx ON ppjk_status_logs (changed_at)`);

  // Phase 5: ppjk_document_checklist table
  await runPpjkMigration("ppjk_document_checklist", sql`
    CREATE TABLE IF NOT EXISTS ppjk_document_checklist (
      id               SERIAL PRIMARY KEY,
      ppjk_order_id    INTEGER NOT NULL REFERENCES ppjk_orders(id) ON DELETE CASCADE,
      doc_type         TEXT NOT NULL,
      doc_label        TEXT NOT NULL,
      status           TEXT NOT NULL DEFAULT 'pending',
      is_required      BOOLEAN NOT NULL DEFAULT FALSE,
      file_url         TEXT,
      file_name        TEXT,
      rejection_reason TEXT,
      verified_by      TEXT,
      verified_at      TIMESTAMPTZ,
      uploaded_by      TEXT,
      uploaded_at      TIMESTAMPTZ,
      created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at       TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);
  await runPpjkMigration("ppjk_dc_order_idx",       sql`CREATE INDEX IF NOT EXISTS ppjk_dc_order_idx ON ppjk_document_checklist (ppjk_order_id)`);
  await runPpjkMigration("ppjk_dc_order_type_uniq", sql`CREATE UNIQUE INDEX IF NOT EXISTS ppjk_dc_order_type_uniq ON ppjk_document_checklist (ppjk_order_id, doc_type)`);

  // Phase 2 R2: Migrate legacy statuses BEFORE adding CHECK constraints
  await db.execute(sql`UPDATE ppjk_orders SET status = 'waiting_documents' WHERE status = 'confirmed'`);
  await db.execute(sql`UPDATE ppjk_orders SET status = 'document_review'   WHERE status = 'processing'`);
  await db.execute(sql`UPDATE ppjk_orders SET status = 'submitted_ceisa'   WHERE status = 'submitted'`);
  await db.execute(sql`UPDATE ppjk_orders SET status = 'inspection'        WHERE status = 'examining'`);
  await db.execute(sql`UPDATE ppjk_orders SET status = 'sppb'              WHERE status = 'approved'`);
  await db.execute(sql`UPDATE ppjk_orders SET status = 'hold'              WHERE status = 'on_hold'`);
  await db.execute(sql`UPDATE ppjk_orders SET workflow_validated = 'yes' WHERE workflow_validated = 'no'`);

  // Phase 2 R2: DB-level CHECK constraints (NOT VALID = no existing-row scan)
  await runPpjkMigration("ppjk_status_check", sql`
    ALTER TABLE ppjk_orders ADD CONSTRAINT ppjk_status_check CHECK (status IN (
      'draft','waiting_documents','document_review','document_completed',
      'quotation','waiting_customer','customer_approved',
      'preparing_pib','preparing_peb','submitted_ceisa','inspection',
      'red_lane','yellow_lane','green_lane','hold',
      'sppb','released','completed','cancelled'
    )) NOT VALID
  `);
  await runPpjkMigration("ppjk_customs_status_check", sql`
    ALTER TABLE ppjk_orders ADD CONSTRAINT ppjk_customs_status_check CHECK (
      customs_status IS NULL OR customs_status IN (
        'pending','submitted','examining','approved','rejected','hold','released','completed'
      )
    ) NOT VALID
  `);

  // Phase 2 R2: Verification — ensure critical tables, columns, and indexes exist
  {
    const checks = await db.execute(sql`
      SELECT
        to_regclass('ppjk_orders')                   AS ppjk_orders,
        to_regclass('ppjk_status_logs')              AS ppjk_status_logs,
        to_regclass('ppjk_document_checklist')       AS ppjk_document_checklist,
        to_regclass('ppjk_portal_order_id_uniq')     AS portal_order_id_uniq,
        to_regclass('ppjk_dc_order_type_uniq')       AS dc_order_type_uniq
    `);
    const row = (checks.rows ?? [])[0] as Record<string, unknown> | undefined;
    const missing = row
      ? Object.entries(row).filter(([, v]) => v == null).map(([k]) => k)
      : ["all (query returned nothing)"];
    if (missing.length > 0) {
      throw new Error(`[ppjk-migration] Verification FAILED — missing objects: ${missing.join(", ")}`);
    }
    logger.info("[ppjk-phase2] Boot migrations + verification complete");
  }

  // Brand rename migration: replace old "CST Logistics" / "PT CST Logistik" / domain references
  // in portal_content JSONB values with new "B2B Marketplace and Logistic" brand.
  // Uses text replacement on the serialized JSON — safe for string values inside JSONB.
  try {
    await db.execute(sql`
      DO $$ BEGIN
        IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'portal_content') THEN
          UPDATE portal_content
          SET value = REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(
            value::text,
            'CST LOGISTICS',       'B2B MARKETPLACE AND LOGISTIC'),
            'CST Logistics',       'B2B Marketplace and Logistic'),
            'PT CST Logistik Indonesia', 'PT B2B Marketplace and Logistic'),
            'PT CST Logistik',     'PT B2B Marketplace and Logistic'),
            'PT. CST Logistik',    'PT. B2B Marketplace and Logistic'),
            'cstlogistic.co.id',   'b2bmarketplace.co.id'),
            'cstlogistics.id',     'b2bmarketplace.id'
          )::jsonb
          WHERE value::text ILIKE ANY(ARRAY[
            '%CST Logistics%', '%CST LOGISTICS%',
            '%PT CST Logistik%', '%cstlogistic%'
          ]);
        END IF;
      END $$;
    `);
    logger.info("Brand rename migration: portal_content updated");
  } catch (err) {
    logger.warn({ err }, "Brand rename migration: portal_content update failed (non-fatal)");
  }

  // Brand rename migration: accounting_settings company name
  try {
    await db.execute(sql`
      DO $$ BEGIN
        IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'accounting_settings') THEN
          UPDATE accounting_settings
          SET company_name = 'PT B2B Marketplace and Logistic'
          WHERE company_name ILIKE '%CST%' OR company_name ILIKE '%cstlogistik%';
        END IF;
      END $$;
    `);
    logger.info("Brand rename migration: accounting_settings updated");
  } catch (err) {
    logger.warn({ err }, "Brand rename migration: accounting_settings update failed (non-fatal)");
  }

  // Brand rename migration: companies table (if exists)
  try {
    await db.execute(sql`
      DO $$ BEGIN
        IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'companies') THEN
          UPDATE companies
          SET name = REPLACE(REPLACE(REPLACE(
            name,
            'PT CST Logistik Indonesia', 'PT B2B Marketplace and Logistic'),
            'PT CST Logistik',           'PT B2B Marketplace and Logistic'),
            'CST Logistics',             'B2B Marketplace and Logistic'
          )
          WHERE name ILIKE '%CST%';
        END IF;
      END $$;
    `);
    logger.info("Brand rename migration: companies updated");
  } catch (err) {
    logger.warn({ err }, "Brand rename migration: companies update failed (non-fatal)");
  }

  // ── Vendor lifecycle bridge — additive columns on vendor_profiles ──────────
  // Columns added as part of onboarding → marketplace supplier bridge feature.
  // Each ALTER is split into a separate execute() because pgBouncer transaction
  // mode rejects multi-statement SQL in a single call.
  try {
    await db.execute(sql`
      DO $$ BEGIN
        IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'vendor_profiles') THEN
          IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='vendor_profiles' AND column_name='supplier_id') THEN
            ALTER TABLE vendor_profiles ADD COLUMN supplier_id INTEGER;
          END IF;
        END IF;
      END $$;
    `);
    await db.execute(sql`
      DO $$ BEGIN
        IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'vendor_profiles') THEN
          IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='vendor_profiles' AND column_name='catalog_submission_link_id') THEN
            ALTER TABLE vendor_profiles ADD COLUMN catalog_submission_link_id INTEGER;
          END IF;
        END IF;
      END $$;
    `);
    await db.execute(sql`
      DO $$ BEGIN
        IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'vendor_profiles') THEN
          IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='vendor_profiles' AND column_name='verification_status') THEN
            ALTER TABLE vendor_profiles ADD COLUMN verification_status TEXT NOT NULL DEFAULT 'unverified';
          END IF;
        END IF;
      END $$;
    `);
    await db.execute(sql`
      DO $$ BEGIN
        IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'vendor_profiles') THEN
          IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='vendor_profiles' AND column_name='approved_at') THEN
            ALTER TABLE vendor_profiles ADD COLUMN approved_at TIMESTAMP;
          END IF;
        END IF;
      END $$;
    `);
    logger.info("vendor_profiles bridge columns ready (supplier_id, catalog_submission_link_id, verification_status, approved_at)");
  } catch (err) {
    logger.warn({ err }, "vendor_profiles bridge columns migration failed (non-fatal)");
  }

  // ── vendor_profiles — full schema additive migration ──────────────────────
  // Adds all fields defined in Drizzle schema that may be absent from older DB
  // instances. Each ALTER is split (pgBouncer transaction mode restriction).
  const vpExtraColumns: Array<[string, string]> = [
    ["business_type",      "TEXT"],
    ["company_logo",       "TEXT"],
    ["company_description","TEXT"],
    ["siup",               "TEXT"],
    ["tdp",                "TEXT"],
    ["pic_name",           "TEXT"],
    ["pic_position",       "TEXT"],
    ["phone",              "TEXT"],
    ["whatsapp",           "TEXT"],
    ["email",              "TEXT"],
    ["province",           "TEXT"],
    ["city",               "TEXT"],
    ["district",           "TEXT"],
    ["postal_code",        "TEXT"],
    ["full_address",       "TEXT"],
    ["bank_name",          "TEXT"],
    ["bank_account_name",  "TEXT"],
    ["bank_account_number","TEXT"],
  ];
  for (const [col, colType] of vpExtraColumns) {
    await db.execute(
      sql.raw(`
        DO $$ BEGIN
          IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'vendor_profiles') THEN
            IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='vendor_profiles' AND column_name='${col}') THEN
              ALTER TABLE vendor_profiles ADD COLUMN ${col} ${colType};
            END IF;
          END IF;
        END $$;
      `)
    ).catch((e: unknown) => logger.warn({ err: e }, `vendor_profiles ADD COLUMN ${col} failed (non-fatal)`));
  }
  logger.info("vendor_profiles full schema additive migration done");

  // ── CREATE vendor_catalog_submission_links (if not exists) ─────────────────
  try {
    await db.execute(sql`
      CREATE TABLE IF NOT EXISTS vendor_catalog_submission_links (
        id               SERIAL PRIMARY KEY,
        token            TEXT NOT NULL UNIQUE,
        supplier_id      INTEGER NOT NULL REFERENCES suppliers(id) ON DELETE CASCADE,
        vendor_name      TEXT,
        title            TEXT,
        notes            TEXT,
        category_key     TEXT,
        service_type     TEXT,
        template_kind    TEXT,
        template_id      TEXT,
        template_version TEXT,
        template_snapshot JSONB,
        is_active        BOOLEAN NOT NULL DEFAULT TRUE,
        expires_at       TIMESTAMP,
        max_submissions  INTEGER,
        submission_count INTEGER NOT NULL DEFAULT 0,
        created_at       TIMESTAMP NOT NULL DEFAULT NOW(),
        created_by       TEXT
      )
    `);
    await db.execute(sql`CREATE INDEX IF NOT EXISTS vcsl_supplier_idx ON vendor_catalog_submission_links (supplier_id)`);
    logger.info("vendor_catalog_submission_links table ready");
  } catch (err) {
    logger.warn({ err }, "vendor_catalog_submission_links table migration failed (non-fatal)");
  }

  // ── CREATE vendor_catalog_submissions (if not exists) ─────────────────────
  try {
    await db.execute(sql`
      CREATE TABLE IF NOT EXISTS vendor_catalog_submissions (
        id               SERIAL PRIMARY KEY,
        link_id          INTEGER REFERENCES vendor_catalog_submission_links(id) ON DELETE SET NULL,
        token            TEXT NOT NULL UNIQUE,
        supplier_id      INTEGER REFERENCES suppliers(id) ON DELETE SET NULL,
        vendor_name      TEXT,
        category_key     TEXT,
        service_type     TEXT,
        template_kind    TEXT,
        template_id      TEXT,
        template_version TEXT,
        template_snapshot JSONB,
        spec_values      JSONB,
        name             TEXT NOT NULL,
        description      TEXT,
        unit             TEXT,
        media_assets     JSONB NOT NULL DEFAULT '[]',
        price_base       NUMERIC(15,2) NOT NULL DEFAULT 0,
        currency         TEXT NOT NULL DEFAULT 'IDR',
        stock_status     TEXT,
        stock_qty        NUMERIC(15,3),
        lead_time        TEXT,
        validity_date    TEXT,
        location         TEXT,
        origin           TEXT,
        status           TEXT NOT NULL DEFAULT 'submitted',
        catalog_item_id  INTEGER,
        reviewed_by      TEXT,
        reviewed_at      TIMESTAMP,
        review_notes     TEXT,
        submitted_at     TIMESTAMP NOT NULL DEFAULT NOW(),
        created_at       TIMESTAMP NOT NULL DEFAULT NOW(),
        updated_at       TIMESTAMP
      )
    `);
    await db.execute(sql`CREATE INDEX IF NOT EXISTS vcs_supplier_idx ON vendor_catalog_submissions (supplier_id)`);
    await db.execute(sql`CREATE INDEX IF NOT EXISTS vcs_status_idx   ON vendor_catalog_submissions (status)`);
    await db.execute(sql`CREATE INDEX IF NOT EXISTS vcs_link_idx     ON vendor_catalog_submissions (link_id)`);
    logger.info("vendor_catalog_submissions table ready");
  } catch (err) {
    logger.warn({ err }, "vendor_catalog_submissions table migration failed (non-fatal)");
  }

  // ── Phase 2D — Vendor Quote Submission: header fields on mkt_vendor_quotes ──
  // KEPUTUSAN #3-#6: quotation_number (non-unique), quotation_date, payment_terms,
  // incoterm (free text, no enum), delivery_location.
  try {
    await db.execute(sql`
      DO $$ BEGIN
        IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'mkt_vendor_quotes') THEN
          IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'mkt_vendor_quotes' AND column_name = 'quotation_number') THEN
            ALTER TABLE mkt_vendor_quotes ADD COLUMN quotation_number TEXT;
          END IF;
          IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'mkt_vendor_quotes' AND column_name = 'quotation_date') THEN
            ALTER TABLE mkt_vendor_quotes ADD COLUMN quotation_date DATE;
          END IF;
          IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'mkt_vendor_quotes' AND column_name = 'payment_terms') THEN
            ALTER TABLE mkt_vendor_quotes ADD COLUMN payment_terms TEXT;
          END IF;
          IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'mkt_vendor_quotes' AND column_name = 'incoterm') THEN
            ALTER TABLE mkt_vendor_quotes ADD COLUMN incoterm TEXT;
          END IF;
          IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'mkt_vendor_quotes' AND column_name = 'delivery_location') THEN
            ALTER TABLE mkt_vendor_quotes ADD COLUMN delivery_location TEXT;
          END IF;
        END IF;
      END $$;
    `);
    logger.info("mkt_vendor_quotes Phase 2D header columns ready");
  } catch (err) {
    logger.warn({ err }, "mkt_vendor_quotes Phase 2D header columns migration failed (non-fatal)");
  }

  // ── Phase 2D — Vendor Quote Submission: per-line fields on mkt_vendor_quote_lines ──
  // KEPUTUSAN #7-#9: currency (ISO 4217 text), minimum_order_qty (optional),
  // valid_until (per-line, required at submit, >= quotation_date).
  try {
    await db.execute(sql`
      DO $$ BEGIN
        IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'mkt_vendor_quote_lines') THEN
          IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'mkt_vendor_quote_lines' AND column_name = 'currency') THEN
            ALTER TABLE mkt_vendor_quote_lines ADD COLUMN currency TEXT;
          END IF;
          IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'mkt_vendor_quote_lines' AND column_name = 'minimum_order_qty') THEN
            ALTER TABLE mkt_vendor_quote_lines ADD COLUMN minimum_order_qty NUMERIC(12,3);
          END IF;
          IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'mkt_vendor_quote_lines' AND column_name = 'valid_until') THEN
            ALTER TABLE mkt_vendor_quote_lines ADD COLUMN valid_until DATE;
          END IF;
        END IF;
      END $$;
    `);
    logger.info("mkt_vendor_quote_lines Phase 2D line columns ready");
  } catch (err) {
    logger.warn({ err }, "mkt_vendor_quote_lines Phase 2D line columns migration failed (non-fatal)");
  }

  // ── P0.1 — Token hash columns (Security Hardening) ────────────────────────
  // Adds token_hash TEXT (nullable) to all token tables for HMAC-SHA256 storage.
  // Also enriches token_access_log with P2.1 audit fields.
  // Uses ALTER TABLE IF EXISTS … ADD COLUMN IF NOT EXISTS (no DO blocks needed,
  // avoids the Drizzle param-in-DO-block issue where $N binds are rejected).
  try {
    const tokenTables = [
      "admin_action_links",
      "rfq_vendor_links",
      "vendor_fulfillment_links",
      "customer_quote_links",
      "order_task_links",
      "customer_order_links",
      "order_fulfillment_links",
      "customer_feedback_links",
      "purchase_mini_forms",
      "vendor_mini_form_links",
      "customer_approvals",
      "customer_invoice_links",
      "vendor_catalog_submission_links",
      "mkt_vendor_quotes",
    ];
    for (const table of tokenTables) {
      // ALTER TABLE IF EXISTS … ADD COLUMN IF NOT EXISTS — fully idempotent, Postgres 9.6+
      await db.execute(sql.raw(`ALTER TABLE IF EXISTS "${table}" ADD COLUMN IF NOT EXISTS token_hash TEXT`))
        .catch((e: unknown) => logger.warn({ e, table }, "token_hash column migration (non-fatal)"));
    }
    // Partial indexes on token_hash for fast hash lookup
    for (const table of ["admin_action_links", "rfq_vendor_links", "vendor_fulfillment_links"]) {
      const idxName = `${table}_token_hash_idx`;
      await db.execute(sql.raw(
        `CREATE INDEX IF NOT EXISTS "${idxName}" ON "${table}" (token_hash) WHERE token_hash IS NOT NULL`
      )).catch((e: unknown) => logger.warn({ e, table }, "token_hash index creation (non-fatal)"));
    }
    logger.info("P0.1 token_hash columns ready");
  } catch (err) {
    logger.warn({ err }, "P0.1 token_hash migration failed (non-fatal)");
  }

  // ── P2.1 — Enrich token_access_log ────────────────────────────────────────
  try {
    const auditCols: { col: string; type: string }[] = [
      { col: "request_id",      type: "TEXT" },
      { col: "response_status", type: "INTEGER" },
      { col: "latency_ms",      type: "INTEGER" },
      { col: "request_method",  type: "TEXT" },
      { col: "route",           type: "TEXT" },
    ];
    for (const { col, type } of auditCols) {
      await db.execute(sql.raw(`ALTER TABLE IF EXISTS token_access_log ADD COLUMN IF NOT EXISTS "${col}" ${type}`))
        .catch((e: unknown) => logger.warn({ e, col }, "token_access_log enrichment (non-fatal)"));
    }
    logger.info("P2.1 token_access_log enrichment ready");
  } catch (err) {
    logger.warn({ err }, "P2.1 token_access_log enrichment failed (non-fatal)");
  }

  // ── Phase 1 — Critical Company Isolation + Token Security + Index Hardening ──
  // Additive, backward-compatible. Nullable company_id (NOT NULL enforced after backfill).
  // Token hash columns: new writes use hash-first; legacy rows retain plaintext for fallback.
  try {
    // A. Company isolation columns
    await db.execute(sql.raw(`ALTER TABLE IF EXISTS payments    ADD COLUMN IF NOT EXISTS company_id INTEGER`)).catch(() => {});
    await db.execute(sql.raw(`ALTER TABLE IF EXISTS transactions ADD COLUMN IF NOT EXISTS company_id INTEGER`)).catch(() => {});
    await db.execute(sql.raw(`ALTER TABLE IF EXISTS stocks      ADD COLUMN IF NOT EXISTS company_id INTEGER`)).catch(() => {});
    await db.execute(sql.raw(`ALTER TABLE IF EXISTS driver_jobs  ADD COLUMN IF NOT EXISTS company_id INTEGER`)).catch(() => {});

    // B. Backfill driver_jobs.company_id from logistic_orders where possible
    await db.execute(sql.raw(`
      UPDATE driver_jobs dj
      SET company_id = lo.company_id
      FROM logistic_orders lo
      WHERE dj.logistic_order_id = lo.id
        AND dj.company_id IS NULL
        AND lo.company_id IS NOT NULL
    `)).catch(() => {});

    // C. Backfill payments.company_id from sales_documents / logistic_orders via ref_id
    await db.execute(sql.raw(`
      UPDATE payments p
      SET company_id = sd.company_id
      FROM sales_documents sd
      WHERE p.ref_kind = 'sales' AND p.ref_id = sd.id
        AND p.company_id IS NULL AND sd.company_id IS NOT NULL
    `)).catch(() => {});
    await db.execute(sql.raw(`
      UPDATE payments p
      SET company_id = lo.company_id
      FROM logistic_orders lo
      WHERE p.ref_kind = 'logistic' AND p.ref_id = lo.id
        AND p.company_id IS NULL AND lo.company_id IS NOT NULL
    `)).catch(() => {});

    // D. Indexes for company isolation
    await db.execute(sql.raw(`CREATE INDEX IF NOT EXISTS payments_company_idx     ON payments    (company_id) WHERE company_id IS NOT NULL`)).catch(() => {});
    await db.execute(sql.raw(`CREATE INDEX IF NOT EXISTS transactions_company_idx ON transactions (company_id) WHERE company_id IS NOT NULL`)).catch(() => {});
    await db.execute(sql.raw(`CREATE INDEX IF NOT EXISTS stocks_company_idx       ON stocks      (company_id) WHERE company_id IS NOT NULL`)).catch(() => {});
    await db.execute(sql.raw(`CREATE INDEX IF NOT EXISTS driver_jobs_company_idx  ON driver_jobs  (company_id) WHERE company_id IS NOT NULL`)).catch(() => {});

    // E. Missing indexes on payments ref columns and line-item parent FKs
    await db.execute(sql.raw(`CREATE INDEX IF NOT EXISTS payments_ref_idx                  ON payments               (ref_kind, ref_id)`)).catch(() => {});
    await db.execute(sql.raw(`CREATE INDEX IF NOT EXISTS logistic_order_items_order_idx    ON logistic_order_items   (order_id)`)).catch(() => {});
    await db.execute(sql.raw(`CREATE INDEX IF NOT EXISTS sales_doc_lines_doc_idx           ON sales_document_lines   (document_id)`)).catch(() => {});
    await db.execute(sql.raw(`CREATE INDEX IF NOT EXISTS driver_jobs_driver_idx            ON driver_jobs            (driver_id)    WHERE driver_id IS NOT NULL`)).catch(() => {});
    await db.execute(sql.raw(`CREATE INDEX IF NOT EXISTS driver_jobs_logistic_order_idx    ON driver_jobs            (logistic_order_id) WHERE logistic_order_id IS NOT NULL`)).catch(() => {});
    await db.execute(sql.raw(`CREATE INDEX IF NOT EXISTS admin_action_links_order_idx      ON admin_action_links     (order_id)`)).catch(() => {});

    // F. Token security: hash columns
    await db.execute(sql.raw(`ALTER TABLE IF EXISTS mkt_rfqs        ADD COLUMN IF NOT EXISTS guest_token_hash     TEXT`)).catch(() => {});
    await db.execute(sql.raw(`ALTER TABLE IF EXISTS mkt_rfqs        ADD COLUMN IF NOT EXISTS guest_token_expires_at TIMESTAMPTZ`)).catch(() => {});
    await db.execute(sql.raw(`ALTER TABLE IF EXISTS trusted_devices  ADD COLUMN IF NOT EXISTS device_token_hash   TEXT`)).catch(() => {});
    await db.execute(sql.raw(`ALTER TABLE IF EXISTS wa_otp_codes     ADD COLUMN IF NOT EXISTS verify_token_hash   TEXT`)).catch(() => {});

    // G. Indexes for token hashes — partial (WHERE NOT NULL) for efficiency
    await db.execute(sql.raw(`CREATE INDEX IF NOT EXISTS mkt_rfqs_guest_token_hash_idx        ON mkt_rfqs        (guest_token_hash)   WHERE guest_token_hash IS NOT NULL`)).catch(() => {});
    await db.execute(sql.raw(`CREATE INDEX IF NOT EXISTS trusted_devices_token_hash_idx       ON trusted_devices  (device_token_hash) WHERE device_token_hash IS NOT NULL`)).catch(() => {});
    await db.execute(sql.raw(`CREATE INDEX IF NOT EXISTS wa_otp_verify_token_hash_idx         ON wa_otp_codes     (verify_token_hash) WHERE verify_token_hash IS NOT NULL`)).catch(() => {});
    await db.execute(sql.raw(`CREATE INDEX IF NOT EXISTS admin_action_links_token_hash_idx    ON admin_action_links (token_hash)      WHERE token_hash IS NOT NULL`)).catch(() => {});

    // H. Set guest_token_expires_at for existing mkt_rfqs that have a guest_token but no expiry
    await db.execute(sql.raw(`
      UPDATE mkt_rfqs
      SET guest_token_expires_at = created_at + INTERVAL '30 days'
      WHERE guest_token IS NOT NULL
        AND guest_token_expires_at IS NULL
    `)).catch(() => {});

    logger.info("[Phase 1] Company isolation + token security + index hardening applied");
  } catch (err) {
    logger.warn({ err }, "[Phase 1] Migration failed (non-fatal)");
  }

  // ── RC2.1 DEV schema sync — Blocker 4 ────────────────────────────────────────
  // purchase_documents.mkt_purchase_order_id exists in PROD (verified RC1) but was
  // missing in DEV, causing GET /purchase/documents → 500. This migration is
  // idempotent (ADD COLUMN IF NOT EXISTS) and safe to run on PROD (no-op there).
  try {
    await db.execute(sql.raw(
      `ALTER TABLE IF EXISTS purchase_documents ADD COLUMN IF NOT EXISTS mkt_purchase_order_id INTEGER REFERENCES mkt_purchase_orders(id) ON DELETE SET NULL`,
    )).catch(() => {});
    await db.execute(sql.raw(
      `CREATE INDEX IF NOT EXISTS purchase_documents_mkt_po_idx ON purchase_documents (mkt_purchase_order_id) WHERE mkt_purchase_order_id IS NOT NULL`,
    )).catch(() => {});
    logger.info("[RC2.1] purchase_documents.mkt_purchase_order_id sync applied");
  } catch (err) {
    logger.warn({ err }, "[RC2.1] purchase_documents sync migration failed (non-fatal)");
  }

  // portal_content.locale column — schema.ts (portalContentTable) has declared
  // this column + a (key, locale) unique index for a while, and several call
  // sites (portalContentService.updateContent/getContent, adminWa.ts,
  // aiOrderIntake.ts, vmfGapNotifier.ts) already read/write it via Drizzle.
  // But this DB was missing the column entirely, so every one of those writes
  // threw "column locale does not exist" — caught by the route's try/catch
  // and returned as a 500, while the CMS admin UI's local state had already
  // been optimistically updated. That is why saving a new hero background
  // (or any CMS field) appeared to work for a moment and then reverted after
  // a refresh: the save never actually persisted. Backfill existing rows to
  // the default locale so they keep matching un-suffixed reads, and keep the
  // original key-only unique constraint intact (many other features still
  // rely on plain key uniqueness) — the new composite index is additive.
  try {
    await db.execute(sql.raw(
      `ALTER TABLE IF EXISTS portal_content ADD COLUMN IF NOT EXISTS locale TEXT NOT NULL DEFAULT 'id-ID'`,
    )).catch(() => {});
    await db.execute(sql.raw(
      `CREATE UNIQUE INDEX IF NOT EXISTS portal_content_key_locale_unique ON portal_content (key, locale)`,
    )).catch(() => {});
    logger.info("[CMS] portal_content.locale column ready");
  } catch (err) {
    logger.warn({ err }, "[CMS] portal_content.locale migration failed (non-fatal)");
  }

  // ── Vendor bookmarks table ─────────────────────────────────────────────────
  try {
    await db.execute(sql`
      CREATE TABLE IF NOT EXISTS vendor_bookmarks (
        id          SERIAL PRIMARY KEY,
        customer_id INTEGER NOT NULL,
        vendor_id   INTEGER NOT NULL,
        created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )
    `);
    await db.execute(sql`
      CREATE UNIQUE INDEX IF NOT EXISTS vendor_bookmarks_customer_vendor_uidx
      ON vendor_bookmarks (customer_id, vendor_id)
    `);
    await db.execute(sql`
      CREATE INDEX IF NOT EXISTS vendor_bookmarks_vendor_idx ON vendor_bookmarks (vendor_id)
    `);
    logger.info("vendor_bookmarks table ready");
  } catch (err) {
    logger.warn({ err }, "vendor_bookmarks migration failed (non-fatal)");
  }

  // ── Vendor contact inquiries table ─────────────────────────────────────────
  try {
    await db.execute(sql`
      CREATE TABLE IF NOT EXISTS vendor_contact_inquiries (
        id                 SERIAL PRIMARY KEY,
        inquiry_number     TEXT NOT NULL UNIQUE,
        vendor_id          INTEGER NOT NULL,
        customer_id        INTEGER,
        name               TEXT NOT NULL,
        company            TEXT,
        email              TEXT,
        phone              TEXT NOT NULL,
        country            TEXT,
        product_interested TEXT,
        quantity           TEXT,
        message            TEXT,
        attachment_url     TEXT,
        status             TEXT NOT NULL DEFAULT 'new',
        created_at         TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )
    `);
    await db.execute(sql`
      CREATE INDEX IF NOT EXISTS vendor_contact_inquiries_vendor_idx
      ON vendor_contact_inquiries (vendor_id)
    `);
    logger.info("vendor_contact_inquiries table ready");
  } catch (err) {
    logger.warn({ err }, "vendor_contact_inquiries migration failed (non-fatal)");
  }

  // ── is_internal_vendor — internal company vendor flag ─────────────────────
  // Platform tidak mengambil markup dari vendor internal (perusahaan sendiri).
  // Column + seed data untuk vendors dengan company_id = 1 (PT Cahaya Sejati Teknologi).
  try {
    await db.execute(sql`
      ALTER TABLE suppliers
      ADD COLUMN IF NOT EXISTS is_internal_vendor BOOLEAN NOT NULL DEFAULT FALSE
    `);
    // Seed: semua supplier yang linked ke company_id = 1 (perusahaan induk CST)
    // dianggap internal. Tidak hardcode nama — pakai company_id constraint saja.
    await db.execute(sql`
      UPDATE suppliers
      SET is_internal_vendor = TRUE
      WHERE company_id = 1
        AND is_internal_vendor = FALSE
    `);
    logger.info("suppliers.is_internal_vendor column ready; internal vendors seeded");
  } catch (err) {
    logger.warn({ err }, "suppliers.is_internal_vendor migration failed (non-fatal)");
  }

  // ── journal_sequences — atomic entry number counter ───────────────────────
  // Diperlukan oleh _nextEntryNumber (accounting.ts) untuk setiap posting jurnal.
  // Harus dibuat di sini (critical pre-start) bukan di financialClosingMigration
  // yang dijalankan belakangan, agar tidak ada race di mana user sudah bisa
  // mencatat transaksi sebelum tabel ini siap (menyebabkan error toast di UI).
  try {
    await db.execute(sql`
      CREATE TABLE IF NOT EXISTS journal_sequences (
        journal_prefix  TEXT    NOT NULL,
        company_id      INTEGER NOT NULL DEFAULT 0,
        year            INTEGER NOT NULL,
        next_seq        INTEGER NOT NULL DEFAULT 1,
        PRIMARY KEY (journal_prefix, company_id, year)
      )
    `);
    // Seed dari data accounting_entries yang sudah ada agar nomor tidak tabrakan
    await db.execute(sql`
      INSERT INTO journal_sequences (journal_prefix, company_id, year, next_seq)
      SELECT
        SPLIT_PART(entry_number, '/', 1)               AS journal_prefix,
        COALESCE(company_id, 0)                        AS company_id,
        SPLIT_PART(entry_number, '/', 2)::int          AS year,
        MAX(SPLIT_PART(entry_number, '/', 3)::int) + 1 AS next_seq
      FROM accounting_entries
      WHERE entry_number ~ '^[A-Za-z-]+/[0-9]{4}/[0-9]+$'
        AND SPLIT_PART(entry_number, '/', 3) ~ '^[0-9]+$'
      GROUP BY 1, 2, 3
      ON CONFLICT (journal_prefix, company_id, year) DO UPDATE
        SET next_seq = GREATEST(journal_sequences.next_seq, EXCLUDED.next_seq)
    `);
    logger.info("journal_sequences table ready and seeded");
  } catch (err) {
    logger.warn({ err }, "journal_sequences migration failed (non-fatal)");
  }

  await markStartupMigrationComplete(
    "api_pre_start_schema",
    PRE_START_SCHEMA_BOOTSTRAP_VERSION,
    "Critical API pre-start schema bootstrap and legacy compatibility columns",
  );
}

// Flag set to true once the full migration + seed chain completes.
// Exposed via GET /api/health/ready so tests and clients can poll before
// triggering write operations that touch migrating tables.
let migrationsComplete = false;
const processStartedAt = Date.now();
let migrationStartedAt: number | null = null;
let migrationCompletedAt: number | null = null;

async function startServer() {
  const poolConfig = getPoolConfig();
  logger.info(
    {
      poolMax: poolConfig.max,
      poolConnectionTimeoutMs: poolConfig.connectionTimeoutMs,
      poolIdleTimeoutMs: poolConfig.idleTimeoutMs,
      startupMigrationConcurrency: 1,
      startupMigrationStrategy: "serial-on-shared-pool",
    },
    "Database pool ready for interactive requests",
  );

  // Health-ready endpoint — must be registered before server.listen so it is
  // available as soon as the socket is open.
  app.get("/api/health/ready", (_req, res) => {
    // The browser polls this endpoint during development startup. Do not let
    // a proxy or browser cache serve a stale "starting" response after the
    // migration chain has completed.
    res.set("Cache-Control", "no-store, no-cache, must-revalidate");
    res.set("Pragma", "no-cache");
    const ready = migrationsComplete;
    res.json({
      ready,
      status: ready ? "ready" : "starting",
      phase: ready ? "ready" : migrationStartedAt == null ? "waiting_to_start" : "migrating",
      uptime_seconds: Math.floor((Date.now() - processStartedAt) / 1000),
      migration_started_at: migrationStartedAt ? new Date(migrationStartedAt).toISOString() : null,
      migration_completed_at: migrationCompletedAt ? new Date(migrationCompletedAt).toISOString() : null,
      migration_elapsed_ms: migrationStartedAt
        ? (migrationCompletedAt ?? Date.now()) - migrationStartedAt
        : null,
    });
  });

  // E2E safety status — only exposed when SAFE_DEV_TEST_MODE or E2E_TEST_MODE active
  registerE2ESafetyEndpoint(app);

  // Listen on port FIRST so Replit's startup health-check passes immediately.
  // All migrations & seeds run in the background after the server is ready.
  const server = app.listen(port, (err?: Error) => {
    if (err) {
      logger.error({ err }, "Error listening on port");
      process.exit(1);
    }

    process.stdout.write(`[PORT CHECK] PID=${process.pid} PORT=${port} SERVICE=api-server\n`);
    logger.info({ port }, "Server listening");
  });

  // Attach WebSocket server for real-time Intelligence Alerts
  initAlertsBroadcast(server);
  warmupMailer().catch(() => {});

  // Startup dependency validation — non-blocking, results cached for /api/system/runtime-check
  runStartupValidation().catch((err) => {
    logger.warn({ err }, "[startupValidator] validation error (non-fatal)");
  });

  // Also bind on secondary gateway port if REPLIT_API_GATEWAY_PORT is set.
  // Set SKIP_GATEWAY=1 to disable this secondary binding.
  const GATEWAY_PORT = process.env.REPLIT_API_GATEWAY_PORT ? Number(process.env.REPLIT_API_GATEWAY_PORT) : null;
  let gatewayServer: ReturnType<typeof app.listen> | null = null;
  if (GATEWAY_PORT && port !== GATEWAY_PORT && !process.env.SKIP_GATEWAY) {
    gatewayServer = app.listen(GATEWAY_PORT, () => {
      logger.info({ port: GATEWAY_PORT }, "Also listening on gateway port");
    });
  }

  // Graceful shutdown on SIGTERM / SIGINT — close BOTH servers so ports release immediately
  const shutdown = () => {
    gatewayServer?.close();
    server.close(() => process.exit(0));
    setTimeout(() => process.exit(0), 3_000).unref();
  };
  process.once("SIGTERM", shutdown);
  process.once("SIGINT", shutdown);

  // ── Background workers — staggered via startupOrchestrator ──────────────────
  // Urutan delay mencegah burst koneksi ke pgBouncer yang memicu ECIRCUITBREAKER.
  // Workers yang membuat DB query langsung (tanpa internal delay) diberi delay lebih besar.
  //
  // Delay slot (ms) — efektif setelah dikali STARTUP_WORKER_STAGGER_MS / 1000:
  //   0s   : No-DB workers (IMAP, OCR cleanup, DB backup scheduler)
  //   10s  : Workers with long internal initial delay (vmf, fulfillment expiry)
  //   15s  : Driver job worker
  //   20s  : WA retry worker — hits DB immediately (fixRelativeMediaUrls)
  //   30s  : Workflow worker — hits DB immediately (initInvoiceReminderTable)
  //   35s  : Recurring expense worker (has 10min internal delay, just registering here)
  //   40s  : Member reminder worker
  //   45s  : Expense reminder worker
  //   50s  : WHT reminder worker
  //   55s  : Product-first reminder worker
  //   58s  : Product-first exception worker
  //   62s  : Rekonsiliasi worker
  //   68s  : AI governance expire (setInterval)

  registerWorker("imap-poller", () => startImapPoller(3 * 60 * 1000), 0);
  registerWorker("ocr-temp-cleanup", startOcrTempCleanup, 0);
  registerWorker("db-backup-scheduler", startDbBackupScheduler, 0);
  registerWorker("vmf-gap-notifier", startVmfGapNotifier, 10_000);
  registerWorker("fulfillment-expiry-notifier", startFulfillmentExpiryNotifier, 12_000);
  registerWorker("vendor-invitation-approval-reminder", startVendorInvitationApprovalReminder, 13_000);
  registerWorker("driver-job-worker", startDriverJobWorker, 15_000);
  registerWorker("wa-retry-worker", startWaRetryWorker, 20_000);
  registerWorker("workflow-worker", startWorkflowWorker, 30_000);
  registerWorker("recurring-expense-worker", startRecurringExpenseWorker, 35_000);
  registerWorker("member-reminder-worker", startMemberReminderWorker, 40_000);
  registerWorker("expense-reminder-worker", startExpenseReminderWorker, 45_000);
  registerWorker("wht-reminder-worker", startWhtReminderWorker, 50_000);
  registerWorker("product-first-reminder", startProductFirstReminderWorker, 55_000);
  registerWorker("product-first-exception", startProductFirstExceptionWorker, 58_000);
  registerWorker("rekonsiliasi-worker", startRekonsiliasiWorker, 62_000);
  registerWorker("sheet-sync-worker", startSheetSyncWorker, 65_000);
  registerWorker("tax-ledger-sync", startTaxLedgerSyncWorker, 67_000);
  registerWorker("recon-drift-monitor", startDriftMonitorWorker, 70_000);
  registerWorker("fleet-notification-worker", startFleetNotificationWorker, 75_000);
  registerWorker("sport-center-payment-sync", startSportCenterPaymentSyncWorker, 72_000);
  registerWorker("sport-center-incremental-sync", startIncrementalSyncWorker, 8_000);
  registerWorker("db-sync-check", startDbSyncWorker, 90_000);
  registerWorker("daily-report-wa", startDailyReportWorker, 95_000);
  registerWorker("ledger-consistency-check", startLedgerConsistencyWorker, 95_000);
  registerWorker("financial-outbox-processor", startOutboxProcessor, 3_000);
  registerWorker("financial-event-bus", startFinancialEventBusWorker, 5_000);
  registerWorker("failed-job-replay", startFailedJobReplayWorker, 110_000);
  // Phase 2A.2 — Dual Write Reliability workers
  registerWorker("mkt-dual-write-retry", startDualWriteRetryWorker, 115_000);
  registerWorker("mkt-dual-write-integrity", startDualWriteIntegrityWorker, 130_000);
  registerWorker("mkt-dual-write-cleanup", startDualWriteCleanupWorker, 145_000);
  // Phase 2E.1 — Marketplace Notification Reliability Queue worker
  registerWorker("mkt-notification-queue", startMarketplaceNotificationWorker, 160_000);
  registerWorker("featured-product-expiry", startFeaturedProductExpiryWorker, 175_000);
  registerWorker("idempotency-cleanup", startIdempotencyCleanup, 120_000);
  registerWorker("tax-queue-monitor", startTaxQueueMonitor, 165_000);
  registerWorker("ai-governance-expire", () => {
    setInterval(() => {
      expireStaleApprovals().catch((err: unknown) => {
        logger.warn({ err }, "expireStaleApprovals background tick failed (non-fatal)");
      });
    }, 5 * 60 * 1000).unref();
  }, 68_000);
  // P1.3 — Token cleanup worker (expired/revoked tokens > 90 days)
  registerWorker("token-cleanup", startTokenCleanupWorker, 170_000);
  // Nightly GSheet sync — 01:00 WIB (18:00 UTC); long delay so DB pool fully settled
  registerWorker("gsheet-nightly-sync", startGsheetSyncWorker, 180_000);
  // Integration health check — every 6h, alerts on pass→fail flips via Fonnte WA
  registerWorker("integration-health-check", startIntegrationHealthWorker, 190_000);

  // Run all migrations + seeds in one serial promise chain with an initial
  // delay to let the DB pool stabilize before hammering pgBouncer with DDL.
  // The dev workflow provides four bounded pool clients, so this single
  // migration lane cannot occupy the whole pool and starve login requests.
  console.log("[startup] Registering serial migration chain");
  sleep(8_000)
    .then(() => {
      migrationStartedAt = Date.now();
      return timeStartupStage("Pre-start schema migrations", async () => {
      console.log("[startup] Serial migration chain delay elapsed");
      for (let attempt = 1; attempt <= 10; attempt++) {
        try {
          await runCriticalPreStartMigrations();
          await runTranslationsMigration();
          logger.info("Pre-start schema migrations applied");
          return;
        } catch (err: unknown) {
          if (isTransientDbError(err) && attempt < 10) {
            const backoff = Math.min(attempt * 15_000, 120_000);
            logger.warn(
              { attempt, backoff },
              `Pre-start migration: transient DB error, retrying after ${backoff}ms...`
            );
            await sleep(backoff);
          } else {
            logger.warn({ err }, "Pre-start migrations failed (non-fatal)");
            return;
          }
        }
      }
      });
    })
    .then(() => runWithRetry("Sessions migration", runSessionsMigration))
    .then(() => runWithRetry("Companies migration", runCompaniesMigration))
    .then(() => runWithRetry("Holding migration", runHoldingMigration))
    .then(() => runWithRetry("Portal migration", runPortalMigration))
    .then(() => runWithRetry("Accounting migration", runAccountingMigration))
    .then(() => runWithRetry("COA governance migration", runCoaGovernanceMigration))
    .then(() => runWithRetry("COA proposal migration", runCoaProposalMigration))
    .then(() => runWithRetry("Accounting Hub migration", runAccountingHubMigration))
    .then(() => runWithRetry("Ledger Guard migration (P0 period-lock + immutability hardening)", runLedgerGuardMigration))
    .then(() => runWithRetry("OAuth state migration", runOauthStateMigration))
    .then(() => runWithRetry("Knowledge base migration", runKnowledgeBaseMigration))
    .then(() => runWithRetry("Custom roles migration", runCustomRolesMigration))
    .then(() => runWithRetry("UOM migration", runUomMigration))
    .then(() => runWithRetry("Freight audit log migration", runFreightAuditMigration))
    .then(() => runWithRetry("Audit fix migration", runAuditFixMigration))
    .then(() => runWithRetry("Org full migration", runOrgFullMigration))
    .then(() => runWithRetry("Org unique codes migration", runOrgUniqueCodesMigration))
    .then(() => runWithRetry("Org/role migration", runOrgRoleMigration))
    .then(() => runWithRetry("User role enum migration", runUserRoleMigration))
    .then(() => runWithRetry("Audit log migration", runAuditLogMigration))
    .then(() => runWithRetry("Notification log migration", runNotificationLogMigration))
    .then(() => runWithRetry("Admin notifications migration", runAdminNotificationsMigration))
    .then(() => runWithRetry("Vendor notifications migration", runVendorNotificationsMigration))
    .then(() => runWithRetry("Vendor profile fields migration", runVendorProfileFieldsMigration))
    .then(() => runWithRetry("Supplier enhancement migration (status/marketplace/documents/reviews)", runSupplierEnhancementMigration))
    .then(() => runWithRetry("Nav preferences migration", runNavPreferencesMigration))
    .then(() => runWithRetry("Vendor mini form migration", runVendorMiniFormMigration))
    .then(() => runWithRetry("Product-first flow migration", runProductFirstFlowMigration))
    .then(() => runWithRetry("Customer quote flow migration", runCustomerQuoteFlowMigration))
    .then(() => runWithRetry("Enterprise migration", runEnterpriseMigration))
    .then(() => runWithRetry("Short links migration", runShortLinksMigration))
    .then(() => runWithRetry("Geofence migration", runGeofenceMigration))
    .then(() => runWithRetry("Order fulfillment migration", runOrderFulfillmentMigration))
    .then(() => runWithRetry("Trusted devices migration", runTrustedDevicesMigration))
    .then(() => runWithRetry("ERP audit reports migration", runAuditReportsMigration))
    .then(() => runWithRetry("WA template migration", runWaTemplateMigration))
    .then(() => runWithRetry("RLS migration", runRlsMigration))
    .then(() => runWithRetry("Commodity template migration", runCommodityTemplateMigration))
    .then(() => runWithRetry("Phase 1 migration", runPhase1Migration))
    .then(() => runWithRetry("Phase 2 migration", runPhase2Migration))
    .then(() => runWithRetry("Phase 3A RFQ vendor links FK fix", runPhase3aRfqVendorLinksFix))
    .then(() => runWithRetry("Unified orders/quotes views migration (Phase 3B)", runUnifiedViewsMigration))
    .then(() => runWithRetry("Order links cross-reference migration (Phase 3C)", runOrderLinksMigration))
    .then(() => runWithRetry("Push subscriptions migration", migratePushSubscriptions))
    .then(() => runWithRetry("pg_trgm indexes migration", runPgTrgmMigration))
    .then(() => runWithRetry("Intelligence alert settings migration", runIntelligenceAlertSettingsMigration))
    .then(() => runWithRetry("AI governance migration", runAiGovernanceMigration))
    .then(() => runWithRetry("Purchase template migration", runPurchaseTemplateMigration))
    .then(() => runWithRetry("Enterprise workflow template migration", runEnterpriseWorkflowMigration))
    .then(() => runWithRetry("Order progress migration", runOrderProgressMigration))
    .then(() => runWithRetry("Exception enum migration", runExceptionEnumMigration))
    .then(() => runWithRetry("Order exceptions migration", runOrderExceptionsMigration))
    .then(() => runWithRetry("Step 4 template snapshot migration", runStep4TemplateMigration))
    .then(() => runWithRetry("Service template migration", runServiceTemplateMigration))
    .then(() => runWithRetry("Paylabs config migration", runPaylabsConfigMigration))
    .then(() => runWithRetry("Paylabs payment methods migration", runPaylabsPaymentMethodsMigration))
    .then(() => runWithRetry("Cost Center migration", runCostCenterMigration))
    .then(() => runWithRetry("Sport Center migration", runSportCenterMigration))
    .then(() => runWithRetry("Sport Center account correction", runSportCenterAccountCorrection))
    .then(() => runWithRetry("Sport Center company invoice migration", runSportCenterCompanyInvoiceMigration))
    .then(() => runWithRetry("Sport Expenses migration", runSportExpensesMigration))
    .then(() => runWithRetry("Tenant migration", runTenantMigration))
    .then(() => timeStartupStage("Driver migration module load", async () => {
      // Lazy-load driver route to avoid startup OOM on rapid crash-loop restarts
      const driverMod = await import("./routes/driver.js");
      runDriverPodMigration = driverMod.runDriverPodMigration;
      runDriverAssignmentMigration = driverMod.runDriverAssignmentMigration;
    }))
    .then(() => runWithRetry("Driver POD migration", runDriverPodMigration))
    .then(() => runWithRetry("Driver assignment migration", runDriverAssignmentMigration))
    .then(() => runWithRetry("Vendor company assignments migration", runVendorCompanyAssignmentsMigration))
    .then(() => runWithRetry("Vendor catalog schema migration", runVendorCatalogSchemaMigration))
    .then(() => runWithRetry("Vendor profile hardening migration (Phase Final)", runVendorProfileMigration))
    .then(() => runWithRetry("Featured product migration", runFeaturedProductMigration))
       .then(() => runWithRetry("Marketplace vendor invoice migration", runMktVendorInvoiceMigration))
       .then(() => runWithRetry("Marketplace AP preparation migration", runMktApPreparationMigration))
    .then(() => runWithRetry("Logistic vendor fulfillments migration", runLogisticVendorFulfillmentsMigration))
    .then(() => runWithRetry("Product media migration", runProductMediaMigration))
    .then(() => runWithRetry("Tax rules migration", runTaxRulesMigration))
    .then(() => runWithRetry("Tax SPT migration", runTaxSptMigration))
    .then(() => runWithRetry("Tax audit migration (Fase 1)", runTaxAuditMigration))
    .then(() => runWithRetry("Tax Coretax C7 migration (Fase 4)", runTaxCoretaxMigration))
    .then(() => runWithRetry("Freight accounting migration", runFreightAccountingMigration))
    .then(() => runWithRetry("Logistics rates migration", runLogisticsRatesMigration))
    .then(() => runWithRetry("Bank reconciliation core migration", runBankReconciliationCoreMigration))
    .then(() => runWithRetry("QRIS settlement migration", runQrisSettlementMigration))
    .then(() => runWithRetry("Usage tracking migration", runUsageTrackingMigration))
    .then(() => runWithRetry("Bank mutation masters migration", runBankMutationMastersMigration))
    .then(() => runWithRetry("Bank mutation import migration", runBankMutationImportMigration))
    .then(() => runWithRetry("Freight doc verify migration", runFreightDocVerifyMigration))
    .then(() => runWithRetry("Financial period migration", runFinancialPeriodMigration))
    .then(() => runWithRetry("Financial closing migration", runFinancialClosingMigration))
    .then(() => runWithRetry("Ledger events entry_id migration", runLedgerEventsEntryIdMigration))
    .then(() => runWithRetry("SAP hardening migration", runSapHardeningMigration))
    .then(() => runWithRetry("Finance governance migration", runFinanceGovernanceMigration))
    .then(() => runWithRetry("Bank disbursement migration", runBankDisbursementMigration))
    .then(() => runWithRetry("Expense-Disbursement bridge migration", runExpenseDisbursementBridgeMigration))
    .then(() => runWithRetry("Vendor payments migration (historical)", runVendorPaymentsMigration))
    .then(() => runWithRetry("Kas Bank migration", runKasBankMigration))
    .then(() => runWithRetry("Cash Bank enterprise migration", runCashBankMigration))
    .then(() => runWithRetry("Finance core migration", runFinanceCoreMigration))
    .then(() => runWithRetry("Bank receipt migration", runBankReceiptMigration))
    .then(() => runWithRetry("Advance Management migration", runAdvanceMigration))
    .then(() => runWithRetry("Allocation Engine migration", runAllocationMigration))
    .then(() => runWithRetry("Treasury Batch 4 migration", runTreasuryMigration))
    .then(() => runWithRetry("Bank Allocation Phase 2 migration", runBankAllocationMigration))
    .then(() => runWithRetry("Expense Rule Engine migration (Phase 3)", runExpenseRuleMigration))
    .then(() => runWithRetry("Expense Classification columns migration (Phase 6D)", runExpenseClassificationMigration))
    .then(() => runWithRetry("ASK logistics_payments migration", async () => {
      await db.execute(sql`
        CREATE TABLE IF NOT EXISTS logistics_payments (
          id                    SERIAL PRIMARY KEY,
          company_id            INTEGER,
          logistic_order_id     INTEGER,
          payment_number        TEXT NOT NULL UNIQUE,
          amount                NUMERIC(14,2) NOT NULL DEFAULT 0,
          method                TEXT NOT NULL DEFAULT 'transfer',
          status                TEXT NOT NULL DEFAULT 'pending',
          customer_name         TEXT,
          notes                 TEXT,
          proof_image_url       TEXT,
          paid_at               TIMESTAMPTZ,
          posting_status        TEXT NOT NULL DEFAULT 'unposted',
          accounting_payment_id INTEGER,
          created_by            TEXT,
          created_at            TIMESTAMPTZ NOT NULL DEFAULT NOW(),
          updated_at            TIMESTAMPTZ NOT NULL DEFAULT NOW()
        )
      `).catch(() => {});
      await db.execute(sql`CREATE INDEX IF NOT EXISTS idx_logistics_payments_order ON logistics_payments(logistic_order_id)`).catch(() => {});
      await db.execute(sql`CREATE INDEX IF NOT EXISTS idx_logistics_payments_status ON logistics_payments(status)`).catch(() => {});
      await db.execute(sql`CREATE INDEX IF NOT EXISTS idx_logistics_payments_posting ON logistics_payments(posting_status)`).catch(() => {});
      await db.execute(sql`ALTER TABLE sport_payments ADD COLUMN IF NOT EXISTS posting_error TEXT`).catch(() => {});
      await db.execute(sql`ALTER TABLE tenant_payments ADD COLUMN IF NOT EXISTS posting_error TEXT`).catch(() => {});
      await db.execute(sql`ALTER TABLE logistics_payments ADD COLUMN IF NOT EXISTS posting_error TEXT`).catch(() => {});
      // Backfill posting_status for sport & tenant existing rows
      await db.execute(sql`UPDATE sport_payments  SET posting_status = 'unposted' WHERE posting_status IS NULL`).catch(() => {});
      await db.execute(sql`UPDATE tenant_payments SET posting_status = 'unposted' WHERE posting_status IS NULL`).catch(() => {});
      // Mark sport_payments already in accounting_payments as posted
      await db.execute(sql`
        UPDATE sport_payments sp
        SET posting_status = 'posted',
            accounting_payment_id = ap.id
        FROM accounting_payments ap
        WHERE ap.source_type = 'sport_center'
          AND ap.source_doc_id = sp.id
          AND (sp.posting_status IS NULL OR sp.posting_status = 'unposted')
      `).catch(() => {});
      // Mark tenant_payments already in accounting_payments as posted
      await db.execute(sql`
        UPDATE tenant_payments tp
        SET posting_status = 'posted',
            accounting_payment_id = ap.id
        FROM accounting_payments ap
        WHERE ap.source_type = 'tenant'
          AND ap.source_doc_id = tp.id
          AND (tp.posting_status IS NULL OR tp.posting_status = 'unposted')
      `).catch(() => {});
    }))
    // enableRealtimeTables uses Supabase Management API — only run in production.
    // In dev, Supabase realtime is configured once at project level; re-running
    // on every restart causes unnecessary API calls and potential throttling.
    .then(() => timeStartupStage("Supabase realtime enable", async () => {
      if (process.env["REPLIT_DEPLOYMENT"] === "1" || process.env["ENABLE_REALTIME_TABLES"] === "1") {
        await enableRealtimeTables().catch((err) => {
          logger.warn({ err }, "Supabase Realtime table enable failed (non-fatal)");
        });
      }
    }))
    .then(() => timeStartupStage("Accounting defaults seed", () => seedAccountingDefaults().catch((err) => {
      logger.error({ err }, "Accounting seed failed");
    })))
    .then(() => timeStartupStage("Development COA sync", () => syncDevCoaToFixture().catch((err) => {
      logger.warn({ err }, "COA dev sync failed (non-fatal)");
    })))
    .then(() => timeStartupStage("Additional tax seed", () => seedAdditionalTaxes().catch((err) => {
      logger.warn({ err }, "Additional tax seed failed (non-fatal)");
    })))
    .then(() => timeStartupStage("Expense category account backfill", () => backfillExpenseCategoryAccounts().catch((err) => {
      logger.warn({ err }, "Expense category account backfill failed (non-fatal)");
    })))
    .then(() => timeStartupStage("MDR expense category backfill", () => backfillMdrExpenseCategory().catch((err) => {
      logger.warn({ err }, "MDR expense category backfill failed (non-fatal)");
    })))
    .then(() => timeStartupStage("UOM seed", () => seedUom().catch((err) => {
      logger.warn({ err }, "UOM seed failed (non-fatal)");
    })))
    .then(() => timeStartupStage("Product templates seed", () => seedProductTemplates().catch((err) => {
      logger.warn({ err }, "Product templates seed failed (non-fatal)");
    })))
    .then(() => timeStartupStage("Logistics/catalog/demo seed chain", () =>
      seedLogisticsServiceItems()
        .then(() => seedCatalogProducts())
        .then(() => {
          // Demo fixtures are dev-only — skip in production deployments to keep
          // the production database free of synthetic test data.
          if (process.env["REPLIT_DEPLOYMENT"] !== "1") {
            return seedDemoData().then(() => seedDemoDrivers());
          }
        })
        .then(() => seedAirFreightRates())
        .then(() => remediateOrphanProducts())
        .catch((seedErr) => {
          logger.error({ err: seedErr }, "Logistics/demo seed failed");
        })
    ))
    .then(() => {
      migrationsComplete = true;
      migrationCompletedAt = Date.now();
      // Do not let background workers compete with the startup migration chain
      // for the small development session-pooler connection budget.
      startAll();
      logger.info(
        {
          migration_elapsed_ms: migrationStartedAt != null
            ? migrationCompletedAt - migrationStartedAt
            : null,
          startup_elapsed_ms: startupElapsedMs(),
          migration_count: startupTimings.length,
          migration_timings: startupTimings,
        },
        "Startup migration timing summary",
      );
      logStartupStageSummary();
      logger.info("All startup migrations complete — /api/health/ready → true");
      void runDeferredStartupTasks();
    })
    // Post-start maintenance is intentionally detached from readiness. These
    // repairs are non-critical and may perform long-running DB discovery; they
    // must not keep a healthy API reporting ready=false indefinitely.
    .then(() =>
      backfillVendorPerformance().catch((err) => {
        logger.warn({ err }, "Vendor performance backfill failed (non-fatal)");
      })
    )
    .then(() =>
      syncAccountingSequences().catch((err) => {
        logger.warn({ err }, "Accounting sequence sync failed (non-fatal)");
      })
    )
    .then(() =>
      checkSequenceDesync().catch((err) => {
        logger.warn({ err }, "Post-sync sequence desync check failed (non-fatal)");
      })
    )
    .then(() =>
      repairKasErSportCenterEntries().catch((err) => {
        logger.warn({ err }, "Repair Kas ER sport center entries failed (non-fatal)");
      })
    )
    .then(() =>
      repairOrphanedEntryLines().catch((err) => {
        logger.warn({ err }, "Repair orphaned entry lines failed (non-fatal)");
      })
    )
    .then(() =>
      runBtkiMigration().catch((err) => {
        logger.warn({ err }, "BTKI tariff migration failed (non-fatal)");
      })
    )
    .then(() =>
      runTokenSecurityMigration().catch((err) => {
        logger.warn({ err }, "Token security migration failed (non-fatal)");
      })
    )
    .then(() =>
      runMasterPriceMigration().catch((err) => {
        logger.warn({ err }, "Master price migration failed (non-fatal)");
      })
    )
    .then(() =>
      runQaFixtureMigration().catch((err) => {
        logger.warn({ err }, "QA fixture migration failed (non-fatal)");
      })
    )
    .then(() => {
      // Fleet intelligence migration runs AFTER the main chain + 5-minute delay
      // to avoid hammering pgBouncer during the critical startup window.
      sleep(5 * 60_000).then(async () => {
        for (let attempt = 1; attempt <= 8; attempt++) {
          try {
            await runFleetIntelligenceMigration();
            logger.info("[fleet] Background migration complete");
            return;
          } catch (err: unknown) {
            if (isTransientDbError(err) && attempt < 8) {
              const backoff = Math.min(attempt * 30_000, 180_000);
              logger.warn({ attempt, backoff }, `[fleet] Migration transient error, retry in ${backoff}ms`);
              await sleep(backoff);
            } else {
              logger.error({ err }, "[fleet] Background migration failed (giving up)");
              return;
            }
          }
        }
      }).catch((err) => logger.error({ err }, "[fleet] Background migration runner failed"));
    })
    .catch((err) => {
      logStartupStageSummary();
      logger.error({ err }, "Startup migration/seed chain failed");
    });
}

export default app;

// ── Global exception / rejection guards ─────────────────────────────────────
// Registered BEFORE startServer() so they cover all async startup code.
// unhandledRejection: log + let process continue (most are non-fatal worker errors)
// uncaughtException:  log + exit so the process-manager (dev.mjs) can restart cleanly
process.on("unhandledRejection", (reason: unknown) => {
  logger.error({ reason }, "[process] Unhandled Promise Rejection (non-fatal)");
});

process.on("uncaughtException", (err: Error) => {
  logger.error({ err }, "[process] Uncaught Exception — restarting process");
  process.exit(1);
});

// ── Environment Safety Banner ─────────────────────────────────────────────────
// Displayed at startup so operators can verify environment wiring at a glance.
// NEVER prints passwords, tokens, or full connection strings.
{
  const nodeEnv = process.env["NODE_ENV"] ?? "development";
  const isDeployment = !!process.env["REPLIT_DEPLOYMENT"];
  const isDevEnv = nodeEnv !== "production" && !isDeployment;

  const activeDbUrl =
    (!isDeployment ? process.env["SUPABASE_DATABASE_URL_DEV"] : undefined) ??
    process.env["SUPABASE_DATABASE_URL"] ??
    process.env["DATABASE_URL"] ??
    "";

  const dbHostMatch = activeDbUrl.match(/@([^/?:]+)/);
  const dbHost = dbHostMatch ? dbHostMatch[1] : "unknown";
  const dbProvider = activeDbUrl.includes("supabase") ? "Supabase" : "PostgreSQL";
  const dbMode = isDeployment ? "production" : isDevEnv ? "development" : "production";

  // Detect: dev env using prod DB (no _DEV secret but prod secret is present)
  const prodDbUrl = process.env["SUPABASE_DATABASE_URL"] ?? "";
  const devDbUrl  = process.env["SUPABASE_DATABASE_URL_DEV"] ?? "";
  const usingProdDbInDev = isDevEnv && !!prodDbUrl && !devDbUrl;

  const pad = (s: string, n: number) => s.slice(0, n).padEnd(n);
  console.log("┌─────────────────────────────────────────────────────────┐");
  console.log(`│  Application Environment : ${pad(nodeEnv, 27)}│`);
  console.log(`│  Database Provider       : ${pad(dbProvider, 27)}│`);
  console.log(`│  Database Host           : ${pad(dbHost, 27)}│`);
  console.log(`│  Database Mode           : ${pad(dbMode, 27)}│`);
  console.log(`│  Prod DB in Dev allowed  : ${pad(usingProdDbInDev ? (process.env["ALLOW_PRODUCTION_DB_IN_DEVELOPMENT"] === "true" ? "YES (override active)" : "BLOCKED") : "N/A", 27)}│`);
  console.log("└─────────────────────────────────────────────────────────┘");

  if (usingProdDbInDev && process.env["ALLOW_PRODUCTION_DB_IN_DEVELOPMENT"] !== "true") {
    console.error("╔══════════════════════════════════════════════════════════╗");
    console.error("║  FATAL: NODE_ENV=development but PRODUCTION DB detected. ║");
    console.error("║  Risk: writes from dev will mutate production data.       ║");
    console.error("║  Fix A: Set SUPABASE_DATABASE_URL_DEV in Secrets.        ║");
    console.error("║  Fix B: Set ALLOW_PRODUCTION_DB_IN_DEVELOPMENT=true      ║");
    console.error("║         to explicitly acknowledge this risk.              ║");
    console.error("╚══════════════════════════════════════════════════════════╝");
    process.exit(1);
  }

  if (usingProdDbInDev && process.env["ALLOW_PRODUCTION_DB_IN_DEVELOPMENT"] === "true") {
    console.warn("⚠️  [ENV GUARD] WARNING: Using PRODUCTION database in DEVELOPMENT mode!");
    console.warn("   ALLOW_PRODUCTION_DB_IN_DEVELOPMENT=true — proceeding with caution.");
  }
}

if (!process.env.VERCEL) {
  // Bootstrap config dari Supabase app_config tabel sebelum server start.
  // Hanya butuh SUPABASE_DATABASE_URL di env — semua key lain di-inject otomatis.
  bootstrapConfigFromSupabase()
    .then(() => {
      checkE2ESafety();
      logSafeDevStartupBanner();
      assertE2ESafetyOrDie();
      installSafeDevOutboundGuard();
      return startServer();
    })
    .catch((err) => {
      logger.error({ err }, "Fatal startup error");
      process.exit(1);
    });
}
