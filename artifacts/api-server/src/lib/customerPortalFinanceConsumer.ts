import pg from "pg";
import { getCustomerPortalFinanceMode } from "./financeBoundary.js";
import { postSalesInvoice } from "./accounting.js";
import { resolveFinanceProjectConfigWithClient } from "./financeProjectConfigResolver.js";
import { settleCustomerPortalPayment } from "./customerPortalSettlementAdapter.js";

type QueryClient = Pick<pg.Pool, "query">;

function errorText(error: unknown): string {
  return String(error instanceof Error ? error.message : error).slice(0, 1000);
}

function manualReview(message: string): Error {
  return new Error(`CUSTOMER_PORTAL_MANUAL_REVIEW: ${message}`);
}

export async function processCustomerPortalFinance(options: {
  client: pg.PoolClient;
  limit?: number;
  sourcePaymentIds?: number[];
}): Promise<{ claimed: number; posted: number; manualReview: number; retried: number }> {
  if (getCustomerPortalFinanceMode() !== "central" || (process.env.APP_ENV ?? process.env.NODE_ENV) === "production") {
    return { claimed: 0, posted: 0, manualReview: 0, retried: 0 };
  }
  const client = options.client;
  const limit = options.limit ?? 50;
  const sourcePaymentIds = options.sourcePaymentIds ?? null;
  await client.query(`
    INSERT INTO customer_finance_processing
      (source_project, source_payment_id, event_type, correlation_id)
    SELECT source_project, source_payment_id, event_type, correlation_id
      FROM customer_payment_finance_events e
     WHERE e.event_type = 'payment_confirmed'
           AND ($1::int[] IS NULL OR e.source_payment_id = ANY($1::int[]))
       AND NOT EXISTS (
         SELECT 1 FROM customer_finance_processing p
          WHERE p.source_project=e.source_project
            AND p.source_payment_id=e.source_payment_id
            AND p.event_type=e.event_type
        )
       ON CONFLICT (source_project, source_payment_id, event_type) DO NOTHING
  `, [sourcePaymentIds]);
  const claimed = await client.query(`
    UPDATE customer_finance_processing p
       SET status='processing', attempts=attempts+1, locked_at=NOW(), updated_at=NOW()
     WHERE p.id IN (
       SELECT p2.id FROM customer_finance_processing p2
         WHERE p2.status IN ('pending','failed')
           AND ($2::int[] IS NULL OR p2.source_payment_id = ANY($2::int[]))
          AND p2.available_at <= NOW()
          AND (p2.locked_at IS NULL OR p2.locked_at < NOW() - INTERVAL '15 minutes')
        ORDER BY p2.id
        FOR UPDATE SKIP LOCKED
        LIMIT $1
     )
     RETURNING p.*
  `, [limit, sourcePaymentIds]);
  let posted = 0, manualReviewCount = 0, retried = 0;
  for (const row of claimed.rows as Array<{ id: number; source_payment_id: number }>) {
    try {
      const event = await client.query(`
        SELECT e.*, p.company_id AS payment_company_id, sd.company_id AS document_company_id,
               sd.total_amount, sd.tax_amount AS document_tax_amount,
               sd.grand_total, sd.doc_number, sd.customer_name
          FROM customer_payment_finance_events e
          JOIN payments p ON p.id=e.source_payment_id
          LEFT JOIN sales_documents sd ON sd.id=e.sales_document_id
         WHERE e.source_project='customer_portal'
           AND e.source_payment_id=$1
           AND e.event_type='payment_confirmed'
         LIMIT 1
      `, [row.source_payment_id]);
      const e = event.rows[0];
      if (!e || Number(e.company_id) !== 1 || Number(e.payment_company_id) !== 1 ||
          Number(e.document_company_id) !== 1) {
        throw manualReview("company ownership mismatch");
      }
      if (!["goods", "jasa"].includes(String(e.product_scope))) {
        throw manualReview("product scope missing or unknown");
      }
      if (e.product_scope === "jasa" && !String(e.service_scope ?? "").trim()) {
        throw manualReview("service scope missing");
      }
      if (e.product_scope === "jasa") {
        const mapping = await client.query(`
          SELECT coa_id FROM finance_project_coa_mappings
           WHERE finance_project_config_id=3 AND account_role='REVENUE'
             AND product_scope='jasa' AND service_scope=$1 AND is_active
        `, [String(e.service_scope).trim().toLowerCase()]);
        if (mapping.rows.length !== 1) throw manualReview("service revenue mapping is not deterministic");
        e.service_revenue_coa_id = Number(mapping.rows[0].coa_id);
      }
      if (e.tax_rule_id == null || e.tax_rate == null || e.tax_treatment !== "exclusive") {
        throw manualReview("tax snapshot incomplete or conflicting");
      }
      if (e.doc_number == null) throw manualReview("sales document missing");
      const effectiveDate = new Date(e.paid_at ?? new Date()).toISOString().slice(0, 10);
      const config = await resolveFinanceProjectConfigWithClient(client, {
        projectCode: "customer_portal",
        companyId: 1,
        paymentMethod: String(e.payment_method ?? ""),
        providerCode: String(e.payment_provider ?? ""),
        effectiveDate,
      });
      if (config.taxRuleId !== Number(e.tax_rule_id)) {
        throw manualReview("tax snapshot does not match Customer Portal resolver");
      }
      const taxAccountId = config.accountIds.TAX_OUTPUT;
      if (!taxAccountId) throw manualReview("Customer Portal TAX_OUTPUT mapping missing");
      const accountingPosted = await postSalesInvoice({
        salesDocId: Number(e.sales_document_id),
        docNumber: String(e.doc_number),
        customerName: String(e.customer_name ?? "Customer Portal"),
        netAmount: Number(e.total_amount),
        taxAmount: Number(e.document_tax_amount ?? e.tax_amount ?? 0),
        taxAccountId,
        revenueAccountId: e.service_revenue_coa_id ?? config.accountIds.REVENUE ?? null,
        companyId: 1,
      });
      if (!accountingPosted) throw new Error("CUSTOMER_PORTAL_ACCOUNTING_POST_FAILED");
      await settleCustomerPortalPayment(client, {
        paymentId: Number(row.source_payment_id),
        companyId: 1,
        providerCode: String(e.payment_provider),
        providerReference: e.provider_reference == null ? null : String(e.provider_reference),
        settlementDate: effectiveDate,
        grossAmount: Number(e.amount),
        config,
      });
      await client.query(`
        UPDATE customer_finance_processing
           SET status='posted', processed_at=NOW(), locked_at=NULL, last_error=NULL, updated_at=NOW()
         WHERE id=$1
      `, [row.id]);
      posted++;
    } catch (error) {
      const message = errorText(error);
      const status = message.includes("CUSTOMER_PORTAL_MANUAL_REVIEW") ? "manual_review" : "failed";
      await client.query(`
        UPDATE customer_finance_processing
           SET status=$2, last_error=$3, locked_at=NULL,
               available_at=CASE WHEN $2='failed' THEN NOW()+INTERVAL '5 minutes' ELSE NOW() END,
               updated_at=NOW()
         WHERE id=$1
      `, [row.id, status, message]);
      if (status === "manual_review") manualReviewCount++; else retried++;
    }
  }
  return { claimed: claimed.rows.length, posted, manualReview: manualReviewCount, retried };
}

export function customerPortalFinanceClientShape(client: QueryClient): QueryClient {
  return client;
}