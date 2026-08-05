/**
 * AI Transaction Intelligence — Phase 2
 * Intent Classification Types
 *
 * Additive to Phase 1 — does not modify any Phase 1 type.
 * No DB calls. No network. Deterministic.
 */

import type { TransactionIntent, TransactionAnalysisResult } from './transactionTypes.js';

// ─── Input ────────────────────────────────────────────────────────────────────

/**
 * Structured input for the Phase 2 Intent Classification Engine.
 * Only `description` is required; all other fields are optional context
 * that improves classification accuracy when present.
 */
export interface TransactionClassificationInput {
  /** Raw bank mutation description (required). */
  description: string;

  /** Transaction direction. UNKNOWN means direction is unavailable. */
  direction?: 'DEBIT' | 'CREDIT' | 'UNKNOWN';

  /** Transaction amount in the account's base currency. Should be positive. */
  amount?: number;

  /** ISO 8601 date string or Date object. */
  transactionDate?: string | Date;

  /** Internal bank account ID (string or integer). */
  bankAccountId?: string | number;

  /** Name of the bank holding this account. */
  bankName?: string;

  /** Name of the counterparty (payer or payee). */
  counterpartyName?: string;

  /** Account number of the counterparty. */
  counterpartyAccount?: string;

  /** Bank-assigned reference number or payment reference. */
  referenceNumber?: string;

  /**
   * Bank transaction code (e.g. "RTGS", "BI-FAST", "KLIRING", "SWIFT", "SKN").
   * Provided by some banks in structured mutation exports.
   */
  transactionCode?: string;

  /** ISO 4217 currency code, e.g. "IDR", "USD". */
  currency?: string;
}

// ─── Dependency injection ──────────────────────────────────────────────────────

/**
 * Optional dependency injection for context lookups.
 * The default engine works without any dependencies — they are enhancement only.
 *
 * NEVER query the database directly from within the pure classifier.
 * If DB lookups are needed, resolve them BEFORE calling classifyTransactionIntent()
 * and pass the results via these callbacks.
 */
export interface IntentClassifierDependencies {
  /**
   * Returns true if the given account number belongs to a bank account
   * owned by the same company (i.e. an internal account).
   * Used to confirm INTERNAL_TRANSFER intent.
   */
  isInternalAccount?: (accountNumber: string) => boolean | Promise<boolean>;

  /**
   * Classifies a counterparty name into a business role.
   * Used to disambiguate CUSTOMER_PAYMENT vs VENDOR_PAYMENT vs other intents.
   */
  classifyCounterparty?: (
    name: string,
  ) =>
    | CounterpartyRole
    | Promise<CounterpartyRole>;
}

/** Counterparty classification result. */
export type CounterpartyRole =
  | 'CUSTOMER'
  | 'VENDOR'
  | 'EMPLOYEE'
  | 'GOVERNMENT'
  | 'BANK'
  | 'UNKNOWN';

// ─── Evidence ──────────────────────────────────────────────────────────────────

/** A single piece of evidence that influenced the classification. */
export interface IntentClassificationEvidence {
  /** Evidence source type. */
  type:
    | 'DIRECTION'
    | 'DESCRIPTION'
    | 'COUNTERPARTY'
    | 'TRANSACTION_CODE'
    | 'REFERENCE_NUMBER'
    | 'INTERNAL_ACCOUNT'
    | 'PHASE1_MATCH'
    | 'AMOUNT_PATTERN'
    | 'BANK_NAME';
  /** Human-readable value of this evidence. */
  value: string;
  /** Contribution weight (0.0 – 1.0). */
  weight: number;
}

// ─── Alternative candidate ────────────────────────────────────────────────────

export interface IntentClassificationAlternative {
  intent: TransactionIntent;
  /** Normalized confidence 0.00 – 1.00. */
  confidence: number;
}

// ─── Output ───────────────────────────────────────────────────────────────────

/**
 * Full result of Phase 2 intent classification.
 * Includes Phase 1 analysis for full traceability.
 */
export interface IntentClassificationResult {
  /** Primary classified intent. */
  primaryIntent: TransactionIntent;

  /** Normalized confidence 0.00 – 1.00. */
  confidence: number;

  /** Normalized description used internally for matching. */
  normalizedDescription: string;

  /** Up to 4 alternative intent candidates with their confidence scores. */
  alternatives: IntentClassificationAlternative[];

  /** Evidence items used in this classification decision. */
  evidence: IntentClassificationEvidence[];

  /**
   * Ordered list of human-readable reasons for the classification.
   * Suitable for audit trails and UI display.
   */
  reason: string[];

  /** Full Phase 1 analysis result (for traceability and debugging). */
  phase1Analysis: TransactionAnalysisResult;

  /**
   * True when the classification confidence is low, there is a collision,
   * or the direction conflicts with the primary intent.
   */
  requiresManualReview: boolean;
}
