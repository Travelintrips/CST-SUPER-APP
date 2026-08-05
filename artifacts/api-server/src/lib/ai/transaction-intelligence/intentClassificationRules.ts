/**
 * AI Transaction Intelligence — Phase 2
 * Direction-Aware & Context Rules
 *
 * Defines how transaction direction, transaction codes, and other context
 * signals map to intent boosts or suppression.
 *
 * All rules are ADDITIVE — they boost or reduce candidate scores,
 * never force-set an intent without evidence.
 *
 * Deterministic. No DB calls. No network. No Math.random().
 */

import type { TransactionIntent } from './transactionTypes.js';
import type { TransactionClassificationInput, CounterpartyRole } from './intentClassificationTypes.js';

// ─── Direction rules ──────────────────────────────────────────────────────────

/**
 * For each intent, whether it is "natural" on a DEBIT, CREDIT, or both.
 *   'DEBIT'  — money leaves the account
 *   'CREDIT' — money enters the account
 *   'BOTH'   — intent is valid in both directions (e.g., INTERNAL_TRANSFER)
 *   'NONE'   — direction has no bearing (e.g., UNKNOWN)
 */
export type NaturalDirection = 'DEBIT' | 'CREDIT' | 'BOTH' | 'NONE';

export const INTENT_NATURAL_DIRECTION: Record<TransactionIntent, NaturalDirection> = {
  BANK_ADMIN_FEE:   'DEBIT',    // Bank debits fee from account
  TRANSFER_FEE:     'DEBIT',    // Bank debits transfer fee
  INTEREST_INCOME:  'CREDIT',   // Bank credits interest to account
  CUSTOMER_PAYMENT: 'CREDIT',   // Customer pays → money comes IN
  VENDOR_PAYMENT:   'DEBIT',    // Company pays vendor → money goes OUT
  PAYROLL:          'DEBIT',    // Company pays employees → money goes OUT
  LOAN_PAYMENT:     'DEBIT',    // Paying off loan → money goes OUT
  TAX_PAYMENT:      'DEBIT',    // Paying tax → money goes OUT
  VAT_PAYMENT:      'DEBIT',
  INCOME_TAX:       'DEBIT',
  IMPORT_DUTY:      'DEBIT',
  CUSTOMS_DUTY:     'DEBIT',
  STAMP_DUTY:       'DEBIT',
  TAX_PENALTY:      'DEBIT',
  TAX_REFUND:       'CREDIT',
  TAX_INTEREST:     'DEBIT',
  EXCISE_TAX:       'DEBIT',
  LOCAL_TAX:        'DEBIT',
  VEHICLE_TAX:      'DEBIT',
  INTERNAL_TRANSFER:'BOTH',     // Can be debit (source) or credit (destination)
  REFUND:           'BOTH',     // Giving refund = DEBIT, receiving refund = CREDIT
  CASHBACK:         'CREDIT',   // Bank credits cashback to account
  BANK_CHARGE:      'DEBIT',    // Bank debits charge
  BANK_REVERSAL:    'BOTH',     // Reversals can go either way
  CHEQUE:           'BOTH',     // Issuing cheque = DEBIT, receiving = CREDIT
  GIRO:             'BOTH',     // Issuing giro = DEBIT, receiving = CREDIT
  INTEREST_TAX_WITHHOLDING: 'DEBIT', // PPh Final atas bunga bank — always a debit (expense)
  UNKNOWN:          'NONE',
};

/**
 * Boost applied to an intent's score when direction is consistent with INTENT_NATURAL_DIRECTION.
 * Penalty when direction conflicts.
 */
export const DIRECTION_BOOST  =  0.20;
export const DIRECTION_PENALTY = -0.15;

/**
 * Given an intent and the observed direction, compute a direction signal delta.
 * Returns: +BOOST if consistent, -PENALTY if conflict, 0 if BOTH/NONE or direction UNKNOWN.
 */
export function directionDelta(
  intent: TransactionIntent,
  direction: 'DEBIT' | 'CREDIT' | 'UNKNOWN' | undefined,
): number {
  if (!direction || direction === 'UNKNOWN') return 0;
  const natural = INTENT_NATURAL_DIRECTION[intent];
  if (natural === 'BOTH' || natural === 'NONE') return 0;
  if (natural === direction) return DIRECTION_BOOST;
  return DIRECTION_PENALTY;
}

/**
 * Returns true when the observed direction conflicts with the expected direction for an intent.
 */
export function directionConflicts(
  intent: TransactionIntent,
  direction: 'DEBIT' | 'CREDIT' | 'UNKNOWN' | undefined,
): boolean {
  if (!direction || direction === 'UNKNOWN') return false;
  const natural = INTENT_NATURAL_DIRECTION[intent];
  if (natural === 'BOTH' || natural === 'NONE') return false;
  return natural !== direction;
}

// ─── Transaction code rules ───────────────────────────────────────────────────

/**
 * Maps well-known bank transaction codes to the intent they most strongly imply.
 * Codes are uppercase. Matched case-insensitively against input.transactionCode.
 */
export const TRANSACTION_CODE_MAP: Record<string, TransactionIntent> = {
  'BI-FAST':  'TRANSFER_FEE',    // BI-FAST fees usually coded this way
  'BIFAST':   'TRANSFER_FEE',
  'RTGS':     'TRANSFER_FEE',
  'SKNBI':    'TRANSFER_FEE',
  'SKN':      'TRANSFER_FEE',
  'KLIRING':  'TRANSFER_FEE',
  'SWIFT':    'TRANSFER_FEE',
  'GIRO':     'GIRO',
  'BG':       'GIRO',
  'CEK':      'CHEQUE',
  'PAYROLL':  'PAYROLL',
  'SAL':      'PAYROLL',         // "SAL" = salary code used by some Indonesian banks
  'SALARY':   'PAYROLL',
  'INT':      'INTEREST_INCOME', // "INT" = interest credit
  'INTR':     'INTEREST_INCOME',
  'ADM':      'BANK_ADMIN_FEE',
  'ADMIN':    'BANK_ADMIN_FEE',
  'FEE':      'BANK_ADMIN_FEE',  // Generic fee code
  'TAX':      'TAX_PAYMENT',
  'PAJAK':    'TAX_PAYMENT',
  'REVERSAL': 'BANK_REVERSAL',
  'REV':      'BANK_REVERSAL',
};

export const TRANSACTION_CODE_BOOST = 0.10;

/** Returns intent boost delta for a given transaction code (0 if no match). */
export function transactionCodeBoost(
  intent: TransactionIntent,
  code: string | undefined,
): number {
  if (!code) return 0;
  const mapped = TRANSACTION_CODE_MAP[code.toUpperCase()];
  return mapped === intent ? TRANSACTION_CODE_BOOST : 0;
}

// ─── Counterparty rules ───────────────────────────────────────────────────────

export const COUNTERPARTY_BOOST = 0.20;

/**
 * Given a resolved counterparty role and an intent, return a boost delta.
 * DEBIT + VENDOR → high confidence for VENDOR_PAYMENT
 * CREDIT + CUSTOMER → high confidence for CUSTOMER_PAYMENT
 * etc.
 */
export function counterpartyBoost(
  intent: TransactionIntent,
  role: CounterpartyRole | undefined,
  direction: 'DEBIT' | 'CREDIT' | 'UNKNOWN' | undefined,
): number {
  if (!role || role === 'UNKNOWN') return 0;

  switch (intent) {
    case 'VENDOR_PAYMENT':
      return role === 'VENDOR' ? COUNTERPARTY_BOOST : 0;
    case 'CUSTOMER_PAYMENT':
      return role === 'CUSTOMER' ? COUNTERPARTY_BOOST : 0;
    case 'PAYROLL':
      return role === 'EMPLOYEE' ? COUNTERPARTY_BOOST : 0;
    case 'TAX_PAYMENT':
      return role === 'GOVERNMENT' ? COUNTERPARTY_BOOST : 0;
    case 'BANK_ADMIN_FEE':
    case 'TRANSFER_FEE':
    case 'INTEREST_INCOME':
    case 'CASHBACK':
    case 'BANK_CHARGE':
    case 'BANK_REVERSAL':
      return role === 'BANK' ? COUNTERPARTY_BOOST : 0;
    default:
      return 0;
  }
}

// ─── Internal account rules ───────────────────────────────────────────────────

export const INTERNAL_ACCOUNT_BOOST = 0.10;

/** Boost INTERNAL_TRANSFER if counterparty account is confirmed internal. */
export function internalAccountBoost(
  intent: TransactionIntent,
  isInternal: boolean,
): number {
  if (!isInternal) return 0;
  return intent === 'INTERNAL_TRANSFER' ? INTERNAL_ACCOUNT_BOOST : 0;
}

// ─── Collision resolution helpers ────────────────────────────────────────────

/**
 * Known collision groups — pairs of intents that commonly appear ambiguous
 * from description alone.
 *
 * When two intents in the same collision group are within MANUAL_REVIEW_GAP,
 * requiresManualReview is set to true even if the primary intent has high
 * confidence, unless direction or counterparty has resolved the tie.
 */
export const COLLISION_GROUPS: Array<[TransactionIntent, TransactionIntent]> = [
  ['TRANSFER_FEE',   'BANK_ADMIN_FEE'],   // "TRANSFER ADM"
  ['REFUND',         'VENDOR_PAYMENT'],   // "REFUND VENDOR"
  ['GIRO',           'INTEREST_INCOME'],  // "GIRO BUNGA"
  ['CUSTOMER_PAYMENT','VENDOR_PAYMENT'],  // "TRANSFER PT ABC" (direction resolves)
  ['BANK_REVERSAL',  'BANK_ADMIN_FEE'],   // "REVERSAL BIAYA ADMIN"
];

/**
 * Returns the collision partner for a given intent, if any.
 * Used to check if two top candidates form a known collision pair.
 */
export function findCollisionPartner(
  primary: TransactionIntent,
  secondary: TransactionIntent,
): boolean {
  return COLLISION_GROUPS.some(
    ([a, b]) =>
      (a === primary && b === secondary) ||
      (b === primary && a === secondary),
  );
}

// ─── Manual review triggers ───────────────────────────────────────────────────

/** All conditions that trigger requiresManualReview in Phase 2. */
export const MANUAL_REVIEW_TRIGGERS = {
  /**
   * Primary confidence below this → manual review.
   */
  MIN_CONFIDENCE: 0.70,

  /**
   * Gap between top two candidates below this → manual review (ambiguous).
   */
  MIN_GAP: 0.10,

  /**
   * INTERNAL_TRANSFER without confirmed internal account → manual review.
   */
  UNVERIFIED_INTERNAL_TRANSFER: true,

  /**
   * CUSTOMER_PAYMENT and VENDOR_PAYMENT simultaneously plausible (BOTH in direction)
   * without counterparty resolution → manual review.
   */
  UNRESOLVED_PAYMENT_DIRECTION: true,
} as const;

/**
 * Given the classification context, determine if manual review is needed.
 */
export function shouldRequireManualReviewP2(opts: {
  primaryIntent: TransactionIntent;
  primaryConfidence: number;
  secondaryConfidence: number;
  directionConflict: boolean;
  phase1IsUnknown: boolean;
  internalTransferVerified: boolean;
  counterpartyRole: CounterpartyRole | undefined;
  direction: 'DEBIT' | 'CREDIT' | 'UNKNOWN' | undefined;
}): boolean {
  const {
    primaryIntent,
    primaryConfidence,
    secondaryConfidence,
    directionConflict,
    phase1IsUnknown,
    internalTransferVerified,
    counterpartyRole,
    direction,
  } = opts;

  if (primaryConfidence < MANUAL_REVIEW_TRIGGERS.MIN_CONFIDENCE) return true;
  if (primaryConfidence - secondaryConfidence < MANUAL_REVIEW_TRIGGERS.MIN_GAP) return true;
  if (directionConflict) return true;
  if (phase1IsUnknown) return true;
  if (
    primaryIntent === 'INTERNAL_TRANSFER' &&
    MANUAL_REVIEW_TRIGGERS.UNVERIFIED_INTERNAL_TRANSFER &&
    !internalTransferVerified
  ) return true;

  // CUSTOMER_PAYMENT vs VENDOR_PAYMENT when direction is BOTH/UNKNOWN and no counterparty
  if (
    MANUAL_REVIEW_TRIGGERS.UNRESOLVED_PAYMENT_DIRECTION &&
    (primaryIntent === 'CUSTOMER_PAYMENT' || primaryIntent === 'VENDOR_PAYMENT') &&
    (!direction || direction === 'UNKNOWN') &&
    (!counterpartyRole || counterpartyRole === 'UNKNOWN')
  ) return true;

  return false;
}
