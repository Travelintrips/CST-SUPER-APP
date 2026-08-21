export type CustomerPortalFinanceEvent = {
  source_project: string;
  source_payment_id: number;
  event_type: string;
  correlation_id: string;
  company_id: number;
  sales_document_id: number | null;
  order_id: number | null;
  amount: string | number;
  currency: string;
  payment_method: string | null;
  payment_provider: string | null;
  provider_reference: string | null;
  paid_at: string | Date;
  confirmed_at: string | Date;
  schema_version: number;
};

export type CustomerPortalFinanceIntake = {
  sourceProject: "customer_portal";
  sourcePaymentId: number;
  eventType: "payment_confirmed";
  correlationId: string;
  companyId: number;
  documentId: number | null;
  orderId: number | null;
  amount: string;
  currency: string;
  paymentMethod: string | null;
  paymentProvider: string | null;
  providerReference: string | null;
  paidAt: string;
  confirmedAt: string;
  schemaVersion: number;
};

function requiredString(value: unknown, field: string): string {
  if (typeof value !== "string" || value.trim() === "") {
    throw new Error(`CUSTOMER_PORTAL_EVENT_INVALID: ${field}`);
  }
  return value;
}

/**
 * Mechanical event translation only. It intentionally performs no database
 * write, accounting post, settlement, reconciliation, or provider call.
 */
export function toCustomerPortalFinanceIntake(
  event: CustomerPortalFinanceEvent,
): CustomerPortalFinanceIntake {
  if (event.source_project !== "customer_portal") {
    throw new Error("CUSTOMER_PORTAL_EVENT_SOURCE_MISMATCH");
  }
  if (event.event_type !== "payment_confirmed") {
    throw new Error("CUSTOMER_PORTAL_EVENT_TYPE_UNSUPPORTED");
  }
  if (!Number.isInteger(event.source_payment_id) || event.source_payment_id <= 0) {
    throw new Error("CUSTOMER_PORTAL_EVENT_PAYMENT_ID_INVALID");
  }
  if (!Number.isInteger(event.company_id) || event.company_id <= 0) {
    throw new Error("CUSTOMER_PORTAL_EVENT_COMPANY_INVALID");
  }
  if (!Number.isFinite(Number(event.amount)) || Number(event.amount) <= 0) {
    throw new Error("CUSTOMER_PORTAL_EVENT_AMOUNT_INVALID");
  }
  const correlationId = requiredString(event.correlation_id, "correlation_id");
  const currency = requiredString(event.currency, "currency").toUpperCase();
  const paidAt = event.paid_at instanceof Date ? event.paid_at.toISOString() : requiredString(event.paid_at, "paid_at");
  const confirmedAt = event.confirmed_at instanceof Date ? event.confirmed_at.toISOString() : requiredString(event.confirmed_at, "confirmed_at");

  return {
    sourceProject: "customer_portal",
    sourcePaymentId: event.source_payment_id,
    eventType: "payment_confirmed",
    correlationId,
    companyId: event.company_id,
    documentId: event.sales_document_id,
    orderId: event.order_id,
    amount: String(event.amount),
    currency,
    paymentMethod: event.payment_method,
    paymentProvider: event.payment_provider,
    providerReference: event.provider_reference,
    paidAt,
    confirmedAt,
    schemaVersion: event.schema_version,
  };
}