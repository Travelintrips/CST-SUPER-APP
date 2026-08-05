/**
 * AI Transaction Intelligence — Phase 5
 * Learning & Feedback Engine
 *
 * Pure engine: no DB, no network, no side effects. Deterministic.
 * Additive: does NOT modify Phase 1–4 engines.
 *
 * Consumes FeedbackRecord[] and produces LearningEngineOutput
 * that Phase 6 (Adaptive Rule Recommendation Engine) uses as its
 * primary input signal.
 */

import type {
  LearningEngineInput,
  LearningEngineOutput,
  LearningSignal,
  FeedbackRecord,
  CorrectionRecord,
  HistoricalStatistics,
} from './learningEngineTypes.js';
import type { TransactionIntent } from './transactionTypes.js';
import { normalizeText } from './transactionUnderstanding.js';

// ─── Constants ─────────────────────────────────────────────────────────────────

const DEFAULT_MIN_OCCURRENCES = 3;
const DEFAULT_MIN_CONSISTENCY = 0.7;

// ─── Aggregation helpers ───────────────────────────────────────────────────────

/**
 * Build CorrectionRecords from raw FeedbackRecords by grouping on
 * (companyId, normalizedDescription).
 */
function aggregateCorrectionRecords(
  feedback: FeedbackRecord[],
  companyId: string | number,
): CorrectionRecord[] {
  const map = new Map<string, {
    records: FeedbackRecord[];
    coaCounts: Map<string, number>;
    intentCounts: Map<string, number>;
    coaIdByCode: Map<string, string | number>;
  }>();

  for (const rec of feedback) {
    if (String(rec.companyId) !== String(companyId)) continue;
    const key = rec.normalizedDescription;
    if (!map.has(key)) {
      map.set(key, {
        records: [],
        coaCounts: new Map(),
        intentCounts: new Map(),
        coaIdByCode: new Map(),
      });
    }
    const entry = map.get(key)!;
    entry.records.push(rec);

    // Count corrected COA
    const coa = rec.correctedCoaCode ?? rec.predictedCoaCode;
    if (coa) {
      entry.coaCounts.set(coa, (entry.coaCounts.get(coa) ?? 0) + 1);
      const coaId = rec.correctedCoaId ?? rec.predictedCoaId;
      if (coaId != null) entry.coaIdByCode.set(coa, coaId);
    }

    // Count confirmed intent
    const intent = rec.correctedIntent ?? rec.predictedIntent;
    entry.intentCounts.set(intent, (entry.intentCounts.get(intent) ?? 0) + 1);
  }

  const results: CorrectionRecord[] = [];
  for (const [normalizedDescription, entry] of map) {
    const { records, coaCounts, intentCounts, coaIdByCode } = entry;
    const total = records.length;
    const accepted = records.filter((r) => r.wasAccepted).length;

    // Most frequent COA
    let topCoaCode: string | undefined;
    let topCoaCount = 0;
    for (const [code, count] of coaCounts) {
      if (count > topCoaCount) { topCoaCount = count; topCoaCode = code; }
    }

    // Most frequent intent
    let topIntent: TransactionIntent | undefined;
    let topIntentCount = 0;
    for (const [intent, count] of intentCounts) {
      if (count > topIntentCount) { topIntentCount = count; topIntent = intent as TransactionIntent; }
    }

    const distinctCoaIds = [...new Set(
      records.map((r) => r.correctedCoaId ?? r.predictedCoaId).filter((id): id is string | number => id != null)
    )];
    const distinctIntents = [...new Set(
      records.map((r) => (r.correctedIntent ?? r.predictedIntent) as TransactionIntent)
    )];

    results.push({
      normalizedDescription,
      companyId,
      occurrenceCount: total,
      acceptedCount: accepted,
      correctedCount: total - accepted,
      mostFrequentCoaCode: topCoaCode,
      mostFrequentCoaId: topCoaCode != null ? coaIdByCode.get(topCoaCode) : undefined,
      mostFrequentIntent: topIntent,
      distinctCoaIds,
      distinctIntents,
    });
  }
  return results;
}

// ─── Signal derivation ─────────────────────────────────────────────────────────

/**
 * Compute signalConfidence from occurrence count and consistency rate.
 * Uses a log-weighted formula so diminishing returns kick in above ~50 occurrences.
 */
function computeSignalConfidence(
  occurrenceCount: number,
  consistencyRate: number,
): number {
  // Scale occurrence count: log10(n+1)/log10(101) gives ~0 at 0, ~1 at 100
  const volumeScore = Math.min(1, Math.log10(occurrenceCount + 1) / Math.log10(101));
  const raw = volumeScore * 0.4 + consistencyRate * 0.6;
  return Math.min(1, Math.max(0, raw));
}

/**
 * Derive learning signals from aggregated correction records.
 */
function deriveSignals(
  corrections: CorrectionRecord[],
  minOccurrences: number,
  minConsistency: number,
): LearningSignal[] {
  const signals: LearningSignal[] = [];

  for (const corr of corrections) {
    if (corr.occurrenceCount < minOccurrences) continue;

    const total = corr.occurrenceCount;
    // We'll derive consistency from distinctCoaIds:
    // if only 1 distinct COA, consistency is very high
    const coaConsistency =
      corr.distinctCoaIds.length === 0
        ? 0
        : corr.distinctCoaIds.length === 1
        ? 0.95
        : corr.distinctCoaIds.length === 2
        ? 0.7
        : 0.4;

    const intentConsistency =
      corr.distinctIntents.length === 0
        ? 0
        : corr.distinctIntents.length === 1
        ? 0.95
        : corr.distinctIntents.length === 2
        ? 0.65
        : 0.35;

    // ── DESCRIPTION_PATTERN signal (always emit if enough occurrences) ──────
    const patternConsistency = Math.max(coaConsistency, intentConsistency);
    if (patternConsistency >= minConsistency) {
      signals.push({
        signalType: 'DESCRIPTION_PATTERN',
        normalizedDescription: corr.normalizedDescription,
        intent: corr.mostFrequentIntent,
        coaCode: corr.mostFrequentCoaCode,
        coaId: corr.mostFrequentCoaId,
        companyId: corr.companyId,
        occurrenceCount: total,
        consistencyRate: patternConsistency,
        signalConfidence: computeSignalConfidence(total, patternConsistency),
      });
    }

    // ── KEYWORD signal — extract tokens from normalizedDescription ──────────
    const tokens = corr.normalizedDescription
      .split(/\s+/)
      .filter((t) => t.length >= 3);

    for (const token of tokens) {
      if (coaConsistency >= minConsistency && corr.mostFrequentCoaCode != null) {
        signals.push({
          signalType: 'KEYWORD',
          normalizedDescription: corr.normalizedDescription,
          keyword: token,
          intent: corr.mostFrequentIntent,
          coaCode: corr.mostFrequentCoaCode,
          coaId: corr.mostFrequentCoaId,
          companyId: corr.companyId,
          occurrenceCount: total,
          consistencyRate: coaConsistency,
          signalConfidence: computeSignalConfidence(total, coaConsistency),
        });
      }
    }

    // ── INTENT_COA signal ────────────────────────────────────────────────────
    if (
      corr.mostFrequentIntent != null &&
      corr.mostFrequentCoaCode != null &&
      coaConsistency >= minConsistency &&
      intentConsistency >= minConsistency
    ) {
      signals.push({
        signalType: 'INTENT_COA',
        normalizedDescription: corr.normalizedDescription,
        intent: corr.mostFrequentIntent,
        coaCode: corr.mostFrequentCoaCode,
        coaId: corr.mostFrequentCoaId,
        companyId: corr.companyId,
        occurrenceCount: total,
        consistencyRate: Math.min(coaConsistency, intentConsistency),
        signalConfidence: computeSignalConfidence(
          total,
          Math.min(coaConsistency, intentConsistency),
        ),
      });
    }
  }

  return signals;
}

/**
 * Derive counterparty signals from raw feedback.
 */
function deriveCounterpartySignals(
  feedback: FeedbackRecord[],
  companyId: string | number,
  minOccurrences: number,
  minConsistency: number,
): LearningSignal[] {
  // Group by counterpartyName
  const groups = new Map<string, FeedbackRecord[]>();
  for (const rec of feedback) {
    if (String(rec.companyId) !== String(companyId)) continue;
    if (!rec.counterpartyName) continue;
    const key = normalizeText(rec.counterpartyName);
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key)!.push(rec);
  }

  const signals: LearningSignal[] = [];
  for (const [counterpartyNorm, recs] of groups) {
    if (recs.length < minOccurrences) continue;

    const coaCounts = new Map<string, number>();
    const coaIdMap = new Map<string, string | number>();
    const intentCounts = new Map<string, number>();
    for (const r of recs) {
      const coa = r.correctedCoaCode ?? r.predictedCoaCode;
      if (coa) {
        coaCounts.set(coa, (coaCounts.get(coa) ?? 0) + 1);
        const id = r.correctedCoaId ?? r.predictedCoaId;
        if (id != null) coaIdMap.set(coa, id);
      }
      const intent = r.correctedIntent ?? r.predictedIntent;
      intentCounts.set(intent, (intentCounts.get(intent) ?? 0) + 1);
    }

    let topCoa = ''; let topCoaCount = 0;
    for (const [c, n] of coaCounts) { if (n > topCoaCount) { topCoaCount = n; topCoa = c; } }
    let topIntent: TransactionIntent | undefined; let topIntentCount = 0;
    for (const [i, n] of intentCounts) { if (n > topIntentCount) { topIntentCount = n; topIntent = i as TransactionIntent; } }

    const consistency = topCoaCount / recs.length;
    if (consistency < minConsistency) continue;

    signals.push({
      signalType: 'COUNTERPARTY',
      normalizedDescription: counterpartyNorm,
      counterpartyName: recs[0]!.counterpartyName,
      intent: topIntent,
      coaCode: topCoa || undefined,
      coaId: topCoa ? coaIdMap.get(topCoa) : undefined,
      companyId,
      occurrenceCount: recs.length,
      consistencyRate: consistency,
      signalConfidence: computeSignalConfidence(recs.length, consistency),
    });
  }
  return signals;
}

// ─── Statistics ────────────────────────────────────────────────────────────────

function computeStatistics(
  feedback: FeedbackRecord[],
  companyId: string | number,
): HistoricalStatistics {
  const company = feedback.filter((r) => String(r.companyId) === String(companyId));
  if (company.length === 0) {
    return {
      companyId,
      totalFeedback: 0,
      overallAcceptanceRate: 0,
      acceptanceRateByIntent: {},
      topCorrectionPairs: [],
      topCoaCorrections: [],
      problematicPatterns: [],
    };
  }

  const accepted = company.filter((r) => r.wasAccepted).length;
  const overallAcceptanceRate = accepted / company.length;

  // Per-intent acceptance
  const intentGroups = new Map<TransactionIntent, { total: number; accepted: number }>();
  for (const r of company) {
    const intent = r.predictedIntent;
    if (!intentGroups.has(intent)) intentGroups.set(intent, { total: 0, accepted: 0 });
    const g = intentGroups.get(intent)!;
    g.total++;
    if (r.wasAccepted) g.accepted++;
  }
  const acceptanceRateByIntent: Partial<Record<TransactionIntent, number>> = {};
  for (const [intent, g] of intentGroups) {
    acceptanceRateByIntent[intent] = g.total > 0 ? g.accepted / g.total : 0;
  }

  // Correction pairs
  const pairCounts = new Map<string, { from: TransactionIntent; to: TransactionIntent; count: number }>();
  for (const r of company) {
    if (!r.wasAccepted && r.correctedIntent && r.correctedIntent !== r.predictedIntent) {
      const key = `${r.predictedIntent}→${r.correctedIntent}`;
      if (!pairCounts.has(key)) {
        pairCounts.set(key, { from: r.predictedIntent, to: r.correctedIntent, count: 0 });
      }
      pairCounts.get(key)!.count++;
    }
  }
  const topCorrectionPairs = [...pairCounts.values()]
    .sort((a, b) => b.count - a.count)
    .slice(0, 10)
    .map((p) => ({ fromIntent: p.from, toIntent: p.to, count: p.count }));

  // COA corrections
  const coaCorrMap = new Map<string, number>();
  for (const r of company) {
    if (!r.wasAccepted && r.correctedCoaCode) {
      const key = `${r.normalizedDescription}||${r.correctedCoaCode}`;
      coaCorrMap.set(key, (coaCorrMap.get(key) ?? 0) + 1);
    }
  }
  const topCoaCorrections = [...coaCorrMap.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 10)
    .map(([key, count]) => {
      const [desc, coaCode] = key.split('||');
      return { normalizedDescription: desc!, coaCode: coaCode!, count };
    });

  // Problematic patterns (acceptance < 50%)
  const patternMap = new Map<string, { total: number; accepted: number }>();
  for (const r of company) {
    const k = r.normalizedDescription;
    if (!patternMap.has(k)) patternMap.set(k, { total: 0, accepted: 0 });
    patternMap.get(k)!.total++;
    if (r.wasAccepted) patternMap.get(k)!.accepted++;
  }
  const problematicPatterns = [...patternMap.entries()]
    .filter(([, g]) => g.total >= DEFAULT_MIN_OCCURRENCES && g.accepted / g.total < 0.5)
    .map(([desc]) => desc);

  return {
    companyId,
    totalFeedback: company.length,
    overallAcceptanceRate,
    acceptanceRateByIntent,
    topCorrectionPairs,
    topCoaCorrections,
    problematicPatterns,
  };
}

// ─── Main Engine ───────────────────────────────────────────────────────────────

/**
 * Run the Phase 5 Learning & Feedback Engine.
 *
 * Pure function — deterministic, no side effects.
 */
export function runLearningEngine(input: LearningEngineInput): LearningEngineOutput {
  const {
    companyId,
    feedbackRecords,
    correctionRecords: suppliedCorrections,
    minOccurrences = DEFAULT_MIN_OCCURRENCES,
    minConsistency = DEFAULT_MIN_CONSISTENCY,
  } = input;

  // 1. Aggregate corrections
  const corrections =
    suppliedCorrections ??
    aggregateCorrectionRecords(feedbackRecords, companyId);

  // 2. Derive signals
  const baseSignals = deriveSignals(corrections, minOccurrences, minConsistency);
  const counterpartySignals = deriveCounterpartySignals(
    feedbackRecords,
    companyId,
    minOccurrences,
    minConsistency,
  );

  const allSignals = [...baseSignals, ...counterpartySignals].sort(
    (a, b) => b.signalConfidence - a.signalConfidence,
  );

  // 3. Partition signals by type
  const keywordSignals = allSignals.filter((s) => s.signalType === 'KEYWORD');
  const cpSignals = allSignals.filter((s) => s.signalType === 'COUNTERPARTY');
  const intentCoaSignals = allSignals.filter((s) => s.signalType === 'INTENT_COA');
  const descPatternSignals = allSignals.filter(
    (s) => s.signalType === 'DESCRIPTION_PATTERN',
  );

  // 4. Strong signals
  const strongSignals = allSignals.filter(
    (s) =>
      s.signalConfidence >= 0.7 &&
      s.occurrenceCount >= minOccurrences * 2,
  );

  // 5. Statistics
  const statistics = computeStatistics(feedbackRecords, companyId);

  return {
    companyId,
    signals: allSignals,
    keywordSignals,
    counterpartySignals: cpSignals,
    intentCoaSignals,
    descriptionPatternSignals: descPatternSignals,
    statistics,
    feedbackProcessed: feedbackRecords.filter(
      (r) => String(r.companyId) === String(companyId),
    ).length,
    strongSignals,
    learningVersion: '5.0',
  };
}

// ─── Batch variant ────────────────────────────────────────────────────────────

/**
 * Run learning engine for multiple companies.
 */
export function runLearningEngineBatch(
  companyIds: (string | number)[],
  feedbackRecords: FeedbackRecord[],
  options?: { minOccurrences?: number; minConsistency?: number },
): LearningEngineOutput[] {
  return companyIds.map((companyId) =>
    runLearningEngine({
      companyId,
      feedbackRecords,
      ...options,
    }),
  );
}
