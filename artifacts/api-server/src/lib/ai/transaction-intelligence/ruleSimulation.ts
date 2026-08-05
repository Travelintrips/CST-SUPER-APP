/**
 * AI Transaction Intelligence — Phase 6
 * Rule Simulation (Dry-Run)
 *
 * Simulates applying a set of recommendations to a transaction sample
 * and reports how many would improve vs. worsen.
 *
 * NEVER modifies any rules, dictionary, or database.
 * Always returns dryRun: true.
 *
 * Pure function — no side effects, no DB calls.
 */

import type {
  RecommendedRule,
  RecommendedDictionaryEntry,
  RecommendedCounterpartyMapping,
  SimulationResult,
} from './adaptiveRuleTypes.js';
import type { TransactionIntent } from './transactionTypes.js';

// ─── Simulation Transaction ────────────────────────────────────────────────────

export interface SimTransaction {
  description: string;
  normalizedDescription: string;
  currentIntent?: TransactionIntent;
  currentCoaCode?: string;
  currentConfidence?: number;
  requiresManualReview?: boolean;
}

// ─── Match helpers ─────────────────────────────────────────────────────────────

function descriptionMatchesRule(desc: string, rule: RecommendedRule): boolean {
  if (rule.keyword != null) {
    return desc.toLowerCase().includes(rule.keyword.toLowerCase());
  }
  if (rule.normalizedDescription) {
    return desc.toLowerCase().includes(rule.normalizedDescription.toLowerCase()) ||
      rule.normalizedDescription.toLowerCase().includes(desc.toLowerCase().slice(0, 10));
  }
  return false;
}

function descriptionMatchesDictEntry(desc: string, entry: RecommendedDictionaryEntry): boolean {
  const kw = entry.keyword.toLowerCase();
  if (desc.toLowerCase().includes(kw)) return true;
  for (const alias of entry.aliases) {
    if (desc.toLowerCase().includes(alias.toLowerCase())) return true;
  }
  return false;
}

function descriptionMatchesCounterparty(
  desc: string,
  mapping: RecommendedCounterpartyMapping,
): boolean {
  return desc.toLowerCase().includes(mapping.counterpartyPattern.toLowerCase()) ||
    desc.toLowerCase().includes(mapping.exampleCounterpartyName.toLowerCase());
}

// ─── Apply simulation ──────────────────────────────────────────────────────────

interface SimulationOutcome {
  wasAffected: boolean;
  newIntent?: TransactionIntent;
  newCoaCode?: string;
  newConfidence: number;
  wouldRemoveManualReview: boolean;
  wouldAddManualReview: boolean;
  improved: boolean;
  worsened: boolean;
}

function simulateTransaction(
  tx: SimTransaction,
  rules: RecommendedRule[],
  dictionaryEntries: RecommendedDictionaryEntry[],
  counterpartyMappings: RecommendedCounterpartyMapping[],
): SimulationOutcome {
  const desc = tx.normalizedDescription || tx.description;
  let affected = false;
  let newIntent = tx.currentIntent;
  let newCoaCode = tx.currentCoaCode;
  let confidenceBoost = 0;
  let wouldRemoveManualReview = false;

  // Check rule matches
  for (const rule of rules) {
    if (descriptionMatchesRule(desc, rule)) {
      affected = true;
      if (rule.affectedIntents.length > 0 && rule.affectedIntents[0] !== tx.currentIntent) {
        newIntent = rule.affectedIntents[0];
      }
      if (rule.coaCode && rule.coaCode !== tx.currentCoaCode) {
        newCoaCode = rule.coaCode;
      }
      confidenceBoost += rule.confidence * 0.1;
    }
  }

  // Check dictionary entry matches
  for (const entry of dictionaryEntries) {
    if (descriptionMatchesDictEntry(desc, entry)) {
      affected = true;
      if (entry.intent !== tx.currentIntent) {
        newIntent = entry.intent;
      }
      confidenceBoost += entry.confidence * 0.08;
    }
  }

  // Check counterparty matches
  for (const mapping of counterpartyMappings) {
    if (descriptionMatchesCounterparty(desc, mapping)) {
      affected = true;
      if (mapping.suggestedIntent !== tx.currentIntent) {
        newIntent = mapping.suggestedIntent;
      }
      if (mapping.suggestedCoaCode && mapping.suggestedCoaCode !== tx.currentCoaCode) {
        newCoaCode = mapping.suggestedCoaCode;
      }
      confidenceBoost += mapping.confidence * 0.12;
    }
  }

  if (!affected) {
    return {
      wasAffected: false,
      newConfidence: tx.currentConfidence ?? 0.5,
      wouldRemoveManualReview: false,
      wouldAddManualReview: false,
      improved: false,
      worsened: false,
    };
  }

  const newConfidence = Math.min(1, (tx.currentConfidence ?? 0.5) + confidenceBoost);

  // Would remove manual review if confidence now above threshold
  if (tx.requiresManualReview && newConfidence >= 0.80) {
    wouldRemoveManualReview = true;
  }

  // Improved = higher confidence OR manual review removed OR same intent but better COA
  const improved =
    newConfidence > (tx.currentConfidence ?? 0.5) + 0.05 ||
    wouldRemoveManualReview ||
    (newCoaCode != null && newCoaCode !== tx.currentCoaCode && newIntent === tx.currentIntent);

  // Worsened = lower confidence (shouldn't happen much) or changed intent without clear gain
  const worsened =
    newConfidence < (tx.currentConfidence ?? 0.5) - 0.05 ||
    (newIntent !== tx.currentIntent && !improved);

  return {
    wasAffected: true,
    newIntent,
    newCoaCode,
    newConfidence,
    wouldRemoveManualReview,
    wouldAddManualReview: !tx.requiresManualReview && newConfidence < 0.6,
    improved,
    worsened: worsened && !improved,
  };
}

// ─── Synthetic simulation data ─────────────────────────────────────────────────

/**
 * Generate synthetic simulation transactions from signal data
 * when no real transactions are provided.
 */
export function generateSyntheticTransactions(
  rules: RecommendedRule[],
  dictionaryEntries: RecommendedDictionaryEntry[],
  counterpartyMappings: RecommendedCounterpartyMapping[],
  sampleSize = 100,
): SimTransaction[] {
  const txs: SimTransaction[] = [];
  const intents: TransactionIntent[] = [
    'BANK_ADMIN_FEE', 'TRANSFER_FEE', 'CUSTOMER_PAYMENT', 'VENDOR_PAYMENT',
    'PAYROLL', 'INTEREST_INCOME', 'TAX_PAYMENT', 'UNKNOWN',
  ];

  // Create transactions that match recommendations (will be affected)
  const allSources = [
    ...rules.map((r) => ({ desc: r.normalizedDescription, kw: r.keyword })),
    ...dictionaryEntries.map((e) => ({ desc: e.keyword, kw: e.keyword })),
    ...counterpartyMappings.map((m) => ({ desc: m.counterpartyPattern, kw: undefined as string | undefined })),
  ];

  const matchingCount = Math.min(Math.floor(sampleSize * 0.4), allSources.length);
  for (let i = 0; i < matchingCount; i++) {
    const src = allSources[i % allSources.length]!;
    const desc = src.desc || src.kw || `transaction ${i}`;
    txs.push({
      description: desc,
      normalizedDescription: desc.toLowerCase(),
      currentIntent: intents[i % intents.length] as TransactionIntent,
      currentCoaCode: `5-${1000 + (i % 50)}`,
      currentConfidence: 0.55 + (i % 10) * 0.03,
      requiresManualReview: i % 3 === 0,
    });
  }

  // Fill rest with non-matching transactions
  for (let i = matchingCount; i < sampleSize; i++) {
    txs.push({
      description: `non matching transaction ${i}`,
      normalizedDescription: `non matching transaction ${i}`,
      currentIntent: intents[i % intents.length] as TransactionIntent,
      currentCoaCode: `4-${2000 + (i % 30)}`,
      currentConfidence: 0.75 + (i % 5) * 0.02,
      requiresManualReview: false,
    });
  }
  return txs;
}

// ─── Main simulation function ──────────────────────────────────────────────────

export function simulateRecommendations(
  rules: RecommendedRule[],
  dictionaryEntries: RecommendedDictionaryEntry[],
  counterpartyMappings: RecommendedCounterpartyMapping[],
  transactions?: SimTransaction[],
): SimulationResult {
  const txs =
    transactions && transactions.length > 0
      ? transactions
      : generateSyntheticTransactions(rules, dictionaryEntries, counterpartyMappings, 100);

  let affected = 0;
  let improved = 0;
  let worsened = 0;
  let precisionSum = 0;
  let oldManualReview = 0;
  let newManualReview = 0;

  for (const tx of txs) {
    const outcome = simulateTransaction(tx, rules, dictionaryEntries, counterpartyMappings);
    precisionSum += tx.currentConfidence ?? 0.5;
    if (tx.requiresManualReview) oldManualReview++;

    if (outcome.wasAffected) {
      affected++;
      if (outcome.improved) improved++;
      if (outcome.worsened) worsened++;
      precisionSum += outcome.newConfidence - (tx.currentConfidence ?? 0.5);
      if (outcome.wouldAddManualReview) newManualReview++;
      if (!outcome.wouldRemoveManualReview && tx.requiresManualReview) newManualReview++;
    } else {
      if (tx.requiresManualReview) newManualReview++;
    }
  }

  const total = txs.length;
  const precisionDelta = total > 0 ? (precisionSum / total) - (txs.reduce((s, t) => s + (t.currentConfidence ?? 0.5), 0) / total) : 0;
  const oldReviewRate = total > 0 ? oldManualReview / total : 0;
  const newReviewRate = total > 0 ? newManualReview / total : 0;
  const manualReviewDelta = newReviewRate - oldReviewRate;

  // Simulation confidence: based on sample size (more is better)
  const simulationConfidence = Math.min(1, Math.log10(Math.max(1, total)) / 4);

  return {
    totalTransactions: total,
    affectedTransactions: affected,
    improvedTransactions: improved,
    worsenedTransactions: worsened,
    precisionDelta: parseFloat(precisionDelta.toFixed(4)),
    manualReviewDelta: parseFloat(manualReviewDelta.toFixed(4)),
    dryRun: true,
    simulationConfidence,
  };
}
