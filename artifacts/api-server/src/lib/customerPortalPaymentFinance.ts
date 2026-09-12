import { db } from "@workspace/db";
import { sql } from "drizzle-orm";
import { customerPortalPaymentCorrelation } from "./customerPortalPaymentContract.js";
import { getCustomerPortalFinanceMode } from "./financeBoundary.js";

type ConfirmationInput = {
  paymentId: number;
  companyId: number;
  paymentMethod?: string | null;
  provider?: string | null;
  providerReference?: string | null;
  raw?: unknown;
  confirmedAt?: Date;
};

type ConfirmationResult = {
  payment: any;
  firstPaidTransition: boolean;
  financeEventId: number | null;
};

/**
 * Customer Portal's transitional finance boundary.
 *
 * The payment row lock is the idempotency gate for both webhook and
 * simulate-paid. The event is written in the same transaction as the
 * canonical paid transition; legacy accounting is deliberately outside this
 * helper and is called only when firstPaidTransition is true.
 */
export async function confirmCustomerPortalPayment(
  input: ConfirmationInput,
): Promise<ConfirmationResult> {
  return db.transaction(async (tx) => {
    const locked = await tx.execute(sql`
      SELECT
        p.*,
        sd.customer_id AS sales_customer_id,
        sd.company_id AS sales_company_id,
        sd.doc_number AS sales_doc_number
      FROM payments p
      LEFT JOIN sales_documents sd
        ON p.ref_kind = 'sales'::payment_ref_kind
       AND sd.id = p.ref_id
      WHERE p.id = ${input.paymentId}
      FOR UPDATE OF p
    `);
    const payment = (locked.rows as any[])[0];
    if (!payment) throw new Error("Payment not found");

    const firstPaidTransition = payment.status !== "paid";
    const paidAt = payment.paid_at ?? input.confirmedAt ?? new Date();
    const provider = input.provider ?? payment.provider ?? "paylabs";
    const paymentMethod = input.paymentMethod ?? payment.payment_method ?? null;
    const raw = input.raw === undefined ? payment.raw : input.raw;

    if (firstPaidTransition) {
      await tx.execute(sql`
        UPDATE payments
           SET status = 'paid',
               paid_at = ${paidAt},
               updated_at = NOW(),
               company_id = ${input.companyId},
               payment_method = ${paymentMethod},
               raw = ${raw}
         WHERE id = ${input.paymentId}
      `);
    } else if (payment.company_id == null || payment.payment_method == null) {
      await tx.execute(sql`
        UPDATE payments
           SET company_id = COALESCE(company_id, ${input.companyId}),
               payment_method = COALESCE(payment_method, ${paymentMethod}),
               updated_at = NOW()
         WHERE id = ${input.paymentId}
      `);
    }

    const correlationId = customerPortalPaymentCorrelation(input.paymentId);
    let financeEventId: number | null = null;
    if (getCustomerPortalFinanceMode() !== "legacy") {
      const event = await tx.execute(sql`
        INSERT INTO customer_payment_finance_events (
          source_project, source_payment_id, event_type, correlation_id,
          company_id, customer_id, sales_document_id, order_id,
          amount, currency, payment_method, payment_provider,
          provider_reference, paid_at, confirmed_at, schema_version,
          product_scope, service_scope, tax_rule_id, tax_rate, tax_amount, tax_treatment
        )
        SELECT
          'customer_portal',
          p.id,
          'payment_confirmed',
          ${correlationId},
          ${input.companyId},
          CASE WHEN p.ref_kind = 'sales'::payment_ref_kind
            THEN sd.customer_id ELSE NULL END,
          CASE WHEN p.ref_kind = 'sales'::payment_ref_kind
            THEN p.ref_id ELSE NULL END,
          CASE WHEN p.ref_kind = 'logistic'::payment_ref_kind
            THEN p.ref_id ELSE NULL END,
          p.amount,
          'IDR',
          p.payment_method,
          ${provider},
          ${input.providerReference ?? payment.provider_merchant_trade_no},
          p.paid_at,
          ${input.confirmedAt ?? new Date()},
          1,
          sd.product_scope,
          (SELECT sdl.service_scope FROM sales_document_lines sdl
            WHERE sdl.document_id = sd.id AND sdl.service_scope IS NOT NULL
            ORDER BY sdl.id LIMIT 1),
          sd.tax_rate_id,
          (SELECT tr.tax_rate FROM tax_rules tr
            WHERE tr.id = sd.tax_rate_id AND tr.company_id = ${input.companyId}
            LIMIT 1),
          sd.tax_amount,
          sd.tax_treatment
        FROM payments p
        LEFT JOIN sales_documents sd
          ON p.ref_kind = 'sales'::payment_ref_kind
         AND sd.id = p.ref_id
        WHERE p.id = ${input.paymentId}
        ON CONFLICT (source_project, source_payment_id, event_type)
        DO UPDATE SET correlation_id = EXCLUDED.correlation_id
        RETURNING id
      `);
      financeEventId = Number((event.rows as any[])[0]?.id ?? 0) || null;
    }

    const current = await tx.execute(sql`
      SELECT * FROM payments WHERE id = ${input.paymentId}
    `);
    return {
      payment: (current.rows as any[])[0],
      firstPaidTransition,
      financeEventId,
    };
  });
}

