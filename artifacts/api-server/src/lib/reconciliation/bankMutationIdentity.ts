/**
 * Canonical identity helpers for bank-reconciliation accounting entries.
 *
 * A bank mutation is its own economic event. Date, amount, bank account,
 * description, and Rule AI are matching evidence, not an idempotency key.
 */

export interface BankMutationIdentityInput {
  mutationId: number;
  bankReference?: unknown;
  canonicalKey?: unknown;
  providerOrderId?: unknown;
  mutationKey?: unknown;
}

function firstNonEmpty(...values: unknown[]): string | null {
  for (const value of values) {
    const text = String(value ?? "").trim();
    if (text) return text;
  }
  return null;
}

function compactReference(value: string): string {
  return value.replace(/\s+/g, " ").trim();
}

/**
 * Stable source-event identity. The mutation id is mandatory even when a
 * statement has no external bank reference, so two otherwise identical rows
 * can never share a journal identity.
 */
export function buildBankMutationSourceEventId(input: BankMutationIdentityInput): string {
  if (!Number.isSafeInteger(input.mutationId) || input.mutationId <= 0) {
    throw new Error("bank mutation id must be a positive integer");
  }

  const reference = firstNonEmpty(
    input.bankReference,
    input.canonicalKey,
    input.providerOrderId,
    input.mutationKey,
  );
  return `bank_mutation:${input.mutationId}:${reference == null ? "id-only" : encodeURIComponent(compactReference(reference))}`;
}

/**
 * Human-readable journal ref that remains mutation-scoped. The mutation id is
 * deliberately placed before the optional statement reference and is never
 * derived from description or Rule AI text.
 */
export function buildBankMutationJournalRef(input: BankMutationIdentityInput): string {
  const sourceEventId = buildBankMutationSourceEventId(input);
  const reference = firstNonEmpty(
    input.bankReference,
    input.canonicalKey,
    input.providerOrderId,
    input.mutationKey,
  );
  const suffix = reference == null ? "" : `/${compactReference(reference)}`;
  return `BRM/${input.mutationId}${suffix}`.slice(0, 100);
}