/**
 * AI Transaction Intelligence — Phase 6
 * Rule Clusterer
 *
 * Groups learning signals into FeedbackClusters by dimension:
 *   intent, counterparty, normalized description, COA,
 *   company, keyword, alias, transaction code.
 *
 * Pure function — no side effects, no DB calls.
 */

import type { LearningSignal } from './learningEngineTypes.js';
import type { FeedbackCluster } from './adaptiveRuleTypes.js';
import type { TransactionIntent } from './transactionTypes.js';

let _clusterSeq = 0;
function nextClusterId(): string {
  return `cluster-${++_clusterSeq}`;
}

/** Reset sequence (used in tests). */
export function resetClustererSequence(): void {
  _clusterSeq = 0;
}

// ─── Helpers ───────────────────────────────────────────────────────────────────

function dominantIntent(signals: LearningSignal[]): TransactionIntent | undefined {
  const counts = new Map<string, number>();
  for (const s of signals) {
    if (s.intent) counts.set(s.intent, (counts.get(s.intent) ?? 0) + s.occurrenceCount);
  }
  let best: string | undefined;
  let bestCount = 0;
  for (const [k, n] of counts) {
    if (n > bestCount) { bestCount = n; best = k; }
  }
  return best as TransactionIntent | undefined;
}

function dominantCoaCode(signals: LearningSignal[]): string | undefined {
  const counts = new Map<string, number>();
  for (const s of signals) {
    if (s.coaCode) counts.set(s.coaCode, (counts.get(s.coaCode) ?? 0) + s.occurrenceCount);
  }
  let best: string | undefined; let bestCount = 0;
  for (const [k, n] of counts) { if (n > bestCount) { bestCount = n; best = k; } }
  return best;
}

function dominantCoaId(signals: LearningSignal[], code: string | undefined): string | number | undefined {
  if (!code) return undefined;
  for (const s of signals) {
    if (s.coaCode === code && s.coaId != null) return s.coaId;
  }
  return undefined;
}

function avgConsistency(signals: LearningSignal[]): number {
  if (signals.length === 0) return 0;
  return signals.reduce((sum, s) => sum + s.consistencyRate, 0) / signals.length;
}

function avgConfidence(signals: LearningSignal[]): number {
  if (signals.length === 0) return 0;
  return signals.reduce((sum, s) => sum + s.signalConfidence, 0) / signals.length;
}

function buildCluster(
  clusterType: FeedbackCluster['clusterType'],
  clusterKey: string,
  signals: LearningSignal[],
  companyId?: string | number,
): FeedbackCluster {
  const code = dominantCoaCode(signals);
  return {
    clusterId: nextClusterId(),
    clusterKey,
    clusterType,
    memberCount: signals.reduce((s, r) => s + r.occurrenceCount, 0),
    dominantIntent: dominantIntent(signals),
    dominantCoaCode: code,
    dominantCoaId: dominantCoaId(signals, code),
    consistencyRate: avgConsistency(signals),
    confidence: avgConfidence(signals),
    signals,
    companyId,
  };
}

// ─── Cluster by intent ─────────────────────────────────────────────────────────

export function clusterByIntent(signals: LearningSignal[]): FeedbackCluster[] {
  const groups = new Map<string, LearningSignal[]>();
  for (const s of signals) {
    const key = s.intent ?? 'UNKNOWN';
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key)!.push(s);
  }
  return [...groups.entries()]
    .map(([key, sigs]) => buildCluster('INTENT', key, sigs))
    .filter((c) => c.memberCount > 0);
}

// ─── Cluster by counterparty ───────────────────────────────────────────────────

export function clusterByCounterparty(signals: LearningSignal[]): FeedbackCluster[] {
  const cpSignals = signals.filter((s) => s.counterpartyName != null);
  const groups = new Map<string, LearningSignal[]>();
  for (const s of cpSignals) {
    const key = s.counterpartyName!;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key)!.push(s);
  }
  return [...groups.entries()]
    .map(([key, sigs]) => buildCluster('COUNTERPARTY', key, sigs))
    .filter((c) => c.memberCount > 0);
}

// ─── Cluster by normalized description ────────────────────────────────────────

export function clusterByNormalizedDescription(signals: LearningSignal[]): FeedbackCluster[] {
  const groups = new Map<string, LearningSignal[]>();
  for (const s of signals) {
    const key = s.normalizedDescription;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key)!.push(s);
  }
  return [...groups.entries()]
    .map(([key, sigs]) => buildCluster('NORMALIZED_DESCRIPTION', key, sigs))
    .filter((c) => c.memberCount > 0);
}

// ─── Cluster by COA ────────────────────────────────────────────────────────────

export function clusterByCoa(signals: LearningSignal[]): FeedbackCluster[] {
  const coaSignals = signals.filter((s) => s.coaCode != null);
  const groups = new Map<string, LearningSignal[]>();
  for (const s of coaSignals) {
    const key = s.coaCode!;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key)!.push(s);
  }
  return [...groups.entries()]
    .map(([key, sigs]) => buildCluster('COA', key, sigs))
    .filter((c) => c.memberCount > 0);
}

// ─── Cluster by company ────────────────────────────────────────────────────────

export function clusterByCompany(signals: LearningSignal[]): FeedbackCluster[] {
  const groups = new Map<string, LearningSignal[]>();
  for (const s of signals) {
    const key = String(s.companyId ?? 'GLOBAL');
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key)!.push(s);
  }
  return [...groups.entries()]
    .map(([key, sigs]) => buildCluster('COMPANY', key, sigs, sigs[0]?.companyId))
    .filter((c) => c.memberCount > 0);
}

// ─── Cluster by keyword ────────────────────────────────────────────────────────

export function clusterByKeyword(signals: LearningSignal[]): FeedbackCluster[] {
  const kwSignals = signals.filter((s) => s.signalType === 'KEYWORD' && s.keyword != null);
  const groups = new Map<string, LearningSignal[]>();
  for (const s of kwSignals) {
    const key = s.keyword!;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key)!.push(s);
  }
  return [...groups.entries()]
    .map(([key, sigs]) => buildCluster('KEYWORD', key, sigs))
    .filter((c) => c.memberCount > 0);
}

// ─── Cluster by transaction code ──────────────────────────────────────────────

export function clusterByTransactionCode(signals: LearningSignal[]): FeedbackCluster[] {
  const tcSignals = signals.filter((s) => s.transactionCode != null);
  const groups = new Map<string, LearningSignal[]>();
  for (const s of tcSignals) {
    const key = s.transactionCode!;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key)!.push(s);
  }
  return [...groups.entries()]
    .map(([key, sigs]) => buildCluster('TRANSACTION_CODE', key, sigs))
    .filter((c) => c.memberCount > 0);
}

// ─── Full cluster pass ─────────────────────────────────────────────────────────

/**
 * Run all clustering dimensions and return a merged flat list.
 * Deduplication is intentionally not applied — clusters are overlapping views.
 */
export function clusterAllDimensions(signals: LearningSignal[]): FeedbackCluster[] {
  return [
    ...clusterByIntent(signals),
    ...clusterByCounterparty(signals),
    ...clusterByNormalizedDescription(signals),
    ...clusterByCoa(signals),
    ...clusterByCompany(signals),
    ...clusterByKeyword(signals),
    ...clusterByTransactionCode(signals),
  ];
}
