export type PaymentAccountingOutboxClassification =
  | "RECOVERED"
  | "ACTIVE_FAILURE"
  | "IGNORE";

export interface PaymentAccountingOutboxEvidence {
  status?: unknown;
  rowText?: unknown;
  hasPostedPaymentJournal: boolean;
  explicitlyResolved?: boolean;
}

function normalized(value: unknown): string {
  return String(value ?? "").trim().toLowerCase();
}

/**
 * A failed outbox row is only an active accounting gap when the canonical
 * payment-confirmed journal is still absent.  The historical failed row is
 * retained as evidence; it must not keep producing an active inconsistency
 * after the approved owner path has recovered the journal.
 */
export function classifyPaymentAccountingOutbox(
  evidence: PaymentAccountingOutboxEvidence,
): PaymentAccountingOutboxClassification {
  const status = normalized(evidence.status);
  const rowText = normalized(evidence.rowText);
  const isFailureState = ["failed", "error", "dead_letter", "dead-letter"].includes(status);
  const isPaymentAccountingIncomplete =
    rowText.includes("payment_accounting_incomplete");

  if (!isFailureState || !isPaymentAccountingIncomplete) {
    return "IGNORE";
  }

  if (evidence.explicitlyResolved === true || evidence.hasPostedPaymentJournal) {
    return "RECOVERED";
  }

  return "ACTIVE_FAILURE";
}