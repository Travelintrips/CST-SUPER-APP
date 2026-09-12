/**
 * Bank Interest Tax Matcher — Phase 8
 *
 * Deterministic matching rule for bank interest (jasa giro / bunga bank)
 * paired with PPh Final withholding tax deducted by the bank.
 *
 * Rule:
 *   If two bank mutations exist where:
 *   - One is INTEREST_INCOME (bunga bank / jasa giro)
 *   - One has amount ≈ 20% of the interest amount (PPh Final 20%)
 *   - Same date (or same period ±1 day)
 *   - Same bank account reference / identifier
 *   - Tax/pajak keywords in the deduction description
 *   → Recommend: Beban PPh Final atas Bunga Bank
 *
 * Contract:
 * - No DB access. No Math.random(). No Date.now().
 * - Pure deterministic function — same input → identical output.
 * - requiresHumanApproval is always literal true.
 * - jangan auto-post; jangan mengubah jurnal historis.
 */

// ─── Types ─────────────────────────────────────────────────────────────────────

export interface BankMutationInput {
  /** Internal or external ID for this mutation */
  id: string | number;
  /** Mutation date (ISO date string or Date) */
  date: string | Date;
  /** Amount (absolute value, > 0) */
  amount: number;
  /** Raw description from bank statement */
  description: string;
  /** Bank account number or reference identifier (e.g. "16416") */
  accountReference?: string;
  /** Resolved intent from Phase 1 analysis (optional enrichment) */
  intent?: string;
}

export interface BankInterestTaxMatchCandidate {
  /** The interest income mutation */
  interestMutation: BankMutationInput;
  /** The tax deduction mutation */
  taxMutation: BankMutationInput;
  /** Computed ratio: taxMutation.amount / interestMutation.amount */
  taxRatio: number;
  /** Expected PPh Final rate (typically 0.20 for 20%) */
  expectedRate: number;
  /** Difference from expected rate (absolute) */
  rateDelta: number;
  /** True when rateDelta <= tolerance */
  withinTolerance: boolean;
  /** Recommended intent for the tax mutation */
  recommendedIntent: 'INTEREST_TAX_WITHHOLDING';
  /** Recommended COA name (human-readable) */
  recommendedCoaName: string;
  /** Confidence 0–100 */
  confidence: number;
  /** Reasons why this pair was matched */
  reasons: string[];
  /**
   * ALWAYS literal true.
   * Human approval required before posting journal entries.
   */
  requiresHumanApproval: true;
}

// ─── Config ────────────────────────────────────────────────────────────────────

/** Default PPh Final rate for bank interest (Pasal 4 Ayat 2) = 20% */
const BANK_INTEREST_PPH_FINAL_RATE = 0.20;

/**
 * Explicit tolerance around the 20% rate, expressed as a ratio
 * (0.001 = 0.1 percentage point). The matcher also allows 5% of the
 * expected rate, i.e. a practical default range of 18.9%–21.1%.
 */
const DEFAULT_TOLERANCE_PCT = 0.001;

/** Maximum date gap (in days) between interest and tax mutations */
const MAX_DATE_GAP_DAYS = 3;

/** Keywords that indicate an interest income mutation */
const INTEREST_KEYWORDS = [
  'bunga', 'jasa giro', 'jasa-giro', 'interest', 'pendapatan bunga',
  'bunga deposito', 'bunga tabungan', 'kredit bunga',
];

/** Keywords that indicate a tax deduction mutation */
const TAX_DEDUCTION_KEYWORDS = [
  'pajak', 'pph', 'pph final', 'pph 4', 'pasal 4', 'withholding',
  'tax', 'potongan pajak', 'pot pajak', 'debet pajak',
];

// ─── Helpers ───────────────────────────────────────────────────────────────────

function containsAny(text: string, keywords: string[]): boolean {
  const lower = text.toLowerCase();
  return keywords.some((kw) => lower.includes(kw.toLowerCase()));
}

function daysBetween(a: string | Date, b: string | Date): number {
  const da = new Date(a).getTime();
  const db = new Date(b).getTime();
  return Math.abs(da - db) / (1000 * 60 * 60 * 24);
}

/**
 * Determine whether a mutation looks like bank interest income.
 */
function isInterestMutation(m: BankMutationInput): boolean {
  if (m.intent === 'INTEREST_INCOME') return true;
  return containsAny(m.description, INTEREST_KEYWORDS);
}

/**
 * Determine whether a mutation looks like a tax deduction.
 */
function isTaxDeductionMutation(m: BankMutationInput): boolean {
  if (m.intent === 'INTEREST_TAX_WITHHOLDING' || m.intent === 'TAX_PAYMENT') return true;
  return containsAny(m.description, TAX_DEDUCTION_KEYWORDS);
}

// ─── Main matcher ──────────────────────────────────────────────────────────────

/**
 * Scan a list of bank mutations and return candidate pairs where a bank
 * interest income is accompanied by a PPh Final withholding tax deduction.
 *
 * @param mutations      Raw bank mutations (unsorted OK)
 * @param tolerancePct   Acceptable deviation from 20% rate (default 0.001 = 0.1%)
 * @returns              Array of matched candidate pairs (may be empty)
 *
 * Safety rules:
 * - No auto-post. No journal mutation. No DB access.
 * - requiresHumanApproval is always literal true.
 * - Matches are CANDIDATES — human must verify before posting.
 */
export function detectBankInterestTaxPairs(
  mutations: BankMutationInput[],
  tolerancePct: number = DEFAULT_TOLERANCE_PCT,
): BankInterestTaxMatchCandidate[] {
  const results: BankInterestTaxMatchCandidate[] = [];

  const interests = mutations.filter(isInterestMutation);
  const taxes     = mutations.filter(isTaxDeductionMutation);

  for (const interest of interests) {
    for (const tax of taxes) {
      // Skip same mutation (shouldn't happen but guard anyway)
      if (String(interest.id) === String(tax.id)) continue;

      // Date proximity check
      const gap = daysBetween(interest.date, tax.date);
      if (gap > MAX_DATE_GAP_DAYS) continue;

      // Account reference match (if both are set)
      const refMatch =
        !interest.accountReference ||
        !tax.accountReference ||
        interest.accountReference === tax.accountReference;

      // Ratio check
      if (interest.amount <= 0) continue;
      const ratio = tax.amount / interest.amount;
      const delta = Math.abs(ratio - BANK_INTEREST_PPH_FINAL_RATE);
      const withinTolerance = delta <= tolerancePct + BANK_INTEREST_PPH_FINAL_RATE * 0.05; // 5% of rate as slack

      // Fail closed: an invalid tax ratio must never reach proposal review.
      if (!withinTolerance) continue;

      // When both statements identify an account, they must identify the
      // same account. Missing references remain allowed for legacy statements.
      if (
        interest.accountReference &&
        tax.accountReference &&
        interest.accountReference !== tax.accountReference
      ) {
        continue;
      }

      // Build reasons
      const reasons: string[] = [];
      let confidence = 0;

      if (isInterestMutation(interest)) {
        reasons.push(`Mutasi bunga terdeteksi: "${interest.description}" (Rp${interest.amount.toLocaleString('id-ID')})`);
        confidence += 30;
      }
      if (isTaxDeductionMutation(tax)) {
        reasons.push(`Potongan pajak terdeteksi: "${tax.description}" (Rp${tax.amount.toLocaleString('id-ID')})`);
        confidence += 30;
      }
      if (gap <= 1) {
        reasons.push(`Tanggal sama atau berdekatan (selisih ${gap.toFixed(1)} hari)`);
        confidence += 15;
      } else if (gap <= MAX_DATE_GAP_DAYS) {
        reasons.push(`Tanggal dalam periode berdekatan (selisih ${gap.toFixed(1)} hari)`);
        confidence += 8;
      }
      if (refMatch && interest.accountReference) {
        reasons.push(`Referensi rekening sama: ${interest.accountReference}`);
        confidence += 15;
      }
      if (withinTolerance) {
        reasons.push(
          `Rasio pajak/bunga = ${(ratio * 100).toFixed(2)}% ≈ ${(BANK_INTEREST_PPH_FINAL_RATE * 100).toFixed(0)}% (PPh Final Pasal 4 Ayat 2). Delta: ${(delta * 100).toFixed(3)}%.`,
        );
        confidence += 20;
      }

      // Only include pairs with at least minimal confidence. Since ratio and
      // reference checks already passed, every emitted candidate is valid
      // under the documented matching contract.
      if (confidence < 30) continue;

      results.push({
        interestMutation: interest,
        taxMutation: tax,
        taxRatio: ratio,
        expectedRate: BANK_INTEREST_PPH_FINAL_RATE,
        rateDelta: delta,
        withinTolerance,
        recommendedIntent: 'INTEREST_TAX_WITHHOLDING',
        recommendedCoaName: 'Beban PPh Final atas Bunga Bank',
        confidence: Math.min(confidence, 95), // never exceed 95; human always verifies
        reasons,
        requiresHumanApproval: true, // ALWAYS literal true — never remove
      });
    }
  }

  // Sort by confidence descending
  return results.sort((a, b) => b.confidence - a.confidence);
}

/**
 * Quick check: given two amounts (bunga and pajak), does the ratio match
 * PPh Final 20% within the given tolerance?
 *
 * Example:
 *   bunga = 157_676, pajak = 31_535
 *   31_535 / 157_676 ≈ 0.1999… ≈ 20% → true
 *
 * @param bungaAmount    Interest amount (Rp)
 * @param pajakAmount    Tax deduction amount (Rp)
 * @param tolerancePct   Acceptable deviation (default 0.001 = 0.1%)
 */
export function isBankInterestTaxRatio(
  bungaAmount: number,
  pajakAmount: number,
  tolerancePct: number = DEFAULT_TOLERANCE_PCT,
): boolean {
  if (bungaAmount <= 0) return false;
  const ratio = pajakAmount / bungaAmount;
  const delta = Math.abs(ratio - BANK_INTEREST_PPH_FINAL_RATE);
  // Allow 5% slack of the rate itself (i.e. 20% ±1pp = [19%, 21%]) plus explicit tolerance
  return delta <= tolerancePct + BANK_INTEREST_PPH_FINAL_RATE * 0.05;
}
