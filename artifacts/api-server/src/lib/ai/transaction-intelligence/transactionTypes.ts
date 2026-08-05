/**
 * AI Transaction Intelligence — Phase 1
 * Transaction Types & Core Interfaces
 *
 * Pure types: no DB deps, no side effects, no network calls.
 * Deterministic at all times — no Math.random() anywhere in this module.
 */

// ─── Transaction Intent ────────────────────────────────────────────────────────

/**
 * Semantic intent of a bank mutation description.
 * TAX_PAYMENT remains valid for legacy callers. Specific tax intents are
 * additive so new descriptions can be routed without breaking old payloads.
 */
export type TransactionIntent =
  | 'BANK_ADMIN_FEE'      // Biaya administrasi rekening, maintenance fee
  | 'TRANSFER_FEE'        // Biaya transfer: BI-FAST, RTGS, SWIFT, SKNBI
  | 'INTEREST_INCOME'     // Pendapatan bunga, jasa giro
  | 'CUSTOMER_PAYMENT'    // Pembayaran masuk dari pelanggan
  | 'VENDOR_PAYMENT'      // Pembayaran keluar ke vendor/supplier
  | 'PAYROLL'             // Gaji karyawan, THR, honor
  | 'LOAN_PAYMENT'        // Cicilan/angsuran pinjaman
  | 'TAX_PAYMENT'         // Legacy umbrella for an unspecified tax payment
  | 'VAT_PAYMENT'         // PPN / VAT payment
  | 'INCOME_TAX'          // PPh payment when the article is known
  | 'IMPORT_DUTY'         // Bea masuk / import duty
  | 'CUSTOMS_DUTY'        // Customs duty / kepabeanan
  | 'STAMP_DUTY'          // Bea materai / e-meterai
  | 'TAX_PENALTY'         // Denda / sanksi / bunga pajak
  | 'TAX_REFUND'          // Tax refund / restitusi pajak
  | 'TAX_INTEREST'        // Bunga pajak
  | 'EXCISE_TAX'          // Cukai
  | 'LOCAL_TAX'           // Pajak daerah / retribusi
  | 'VEHICLE_TAX'         // Pajak kendaraan / Samsat
  | 'INTERNAL_TRANSFER'   // Transfer antar rekening milik perusahaan sendiri
  | 'REFUND'              // Pengembalian dana ke pihak lain
  | 'CASHBACK'            // Cashback, reward, bonus dari bank
  | 'BANK_CHARGE'         // Denda, penalti, service charge bank
  | 'BANK_REVERSAL'       // Reversal / koreksi / storno transaksi sebelumnya
  | 'INTEREST_TAX_WITHHOLDING' // PPh Final atas bunga bank (pajak dipotong bank)
  | 'CHEQUE'              // Pembayaran via cek / warkat cek
  | 'GIRO'                // Pembayaran via bilyet giro / warkat giro
  | 'UNKNOWN';            // Tidak dapat diklasifikasikan

/** All valid intents as a constant array (useful for iteration / validation). */
export const ALL_INTENTS: readonly TransactionIntent[] = [
  'BANK_ADMIN_FEE',
  'TRANSFER_FEE',
  'INTEREST_INCOME',
  'INTEREST_TAX_WITHHOLDING',
  'CUSTOMER_PAYMENT',
  'VENDOR_PAYMENT',
  'PAYROLL',
  'LOAN_PAYMENT',
  'TAX_PAYMENT',
  'VAT_PAYMENT',
  'INCOME_TAX',
  'IMPORT_DUTY',
  'CUSTOMS_DUTY',
  'STAMP_DUTY',
  'TAX_PENALTY',
  'TAX_REFUND',
  'TAX_INTEREST',
  'EXCISE_TAX',
  'LOCAL_TAX',
  'VEHICLE_TAX',
  'INTERNAL_TRANSFER',
  'REFUND',
  'CASHBACK',
  'BANK_CHARGE',
  'BANK_REVERSAL',
  'CHEQUE',
  'GIRO',
  'UNKNOWN',
] as const;

/** Specific tax intents used by the tax audit and reviewer contract. */
export const TAX_INTENTS: readonly TransactionIntent[] = [
  'TAX_PAYMENT',
  'VAT_PAYMENT',
  'INCOME_TAX',
  'INTEREST_TAX_WITHHOLDING',
  'IMPORT_DUTY',
  'CUSTOMS_DUTY',
  'STAMP_DUTY',
  'TAX_PENALTY',
  'TAX_REFUND',
  'TAX_INTEREST',
  'EXCISE_TAX',
  'LOCAL_TAX',
  'VEHICLE_TAX',
] as const;

export type TaxIntent = typeof TAX_INTENTS[number];

export type TaxSubtype =
  | 'VAT_INPUT'
  | 'VAT_OUTPUT'
  | 'VAT_UNSPECIFIED'
  | 'PPh21'
  | 'PPh22'
  | 'PPh23'
  | 'PPh25'
  | 'PPh26'
  | 'PPh_FINAL'
  | 'INCOME_TAX_UNSPECIFIED'
  | 'STAMP_DUTY'
  | 'IMPORT_DUTY'
  | 'CUSTOMS_DUTY'
  | 'EXCISE'
  | 'TAX_PENALTY'
  | 'TAX_INTEREST'
  | 'TAX_REFUND'
  | 'LOCAL_TAX'
  | 'VEHICLE_TAX'
  | 'UNKNOWN_TAX';

export function isTaxIntent(intent: TransactionIntent): intent is TaxIntent {
  return TAX_INTENTS.includes(intent);
}

/** Legacy descriptions whose public intent must remain TAX_PAYMENT. */
export function isLegacyTaxDescription(normalizedDescription: string): boolean {
  return (
    /\bsetoran\s+pajak\s+pph\s+\d+\b/.test(normalizedDescription) ||
    /\bpembayaran\s+ppn\b/.test(normalizedDescription) ||
    /\bsurat\s+setoran\s+pajak\b/.test(normalizedDescription)
  );
}

// ─── Keyword matching ──────────────────────────────────────────────────────────

/** A single keyword that contributed to the match. */
export interface KeywordMatch {
  /** The term from the dictionary (lowercase). */
  keyword: string;
  /** The actual token / substring from the description that triggered the match. */
  matchedToken: string;
  /** Contribution weight of this keyword (0.0 – 1.0). */
  weight: number;
}

/** An intent candidate with its accumulated raw score and matching evidence. */
export interface IntentCandidate {
  intent: TransactionIntent;
  /** Raw accumulated score before normalization (0.0 – 1.0+). */
  score: number;
  /** All keywords that contributed to this candidate's score. */
  matchedKeywords: KeywordMatch[];
}

// ─── Explanation ──────────────────────────────────────────────────────────────

/**
 * Human-readable explanation of why the engine chose a particular intent.
 * Designed for audit trails and UI display.
 */
export interface Explanation {
  /** Top-level reason for the primary intent selection. */
  primaryReason: string;
  /** Additional factors that increased or decreased confidence. */
  supportingFactors: string[];
  /** List of keywords from the description that matched dictionary entries. */
  keywordsMatched: string[];
  /** Reasons why confidence is below the high-confidence threshold. */
  lowConfidenceReasons: string[];
}

// ─── Analysis result ──────────────────────────────────────────────────────────

/**
 * Full result of Phase 1 transaction understanding.
 * This is the input to Phase 2 IntentClassificationEngine.
 */
export interface TransactionAnalysisResult {
  /** Winning intent. */
  intent: TransactionIntent;
  /** Normalized confidence 0.00 – 1.00. */
  confidence: number;
  /** Lowercased, normalised description used for matching. */
  normalizedDescription: string;
  /** All scored candidates (sorted descending by score). */
  candidates: IntentCandidate[];
  /** Explainability details. */
  explanation: Explanation;
  /**
   * True when confidence is below threshold or other review triggers apply.
   * Use this flag to route transactions to manual review queues.
   */
  requiresManualReview: boolean;
  /** Tax subtype inferred from matched evidence, when applicable. */
  taxSubtype?: TaxSubtype;
}
