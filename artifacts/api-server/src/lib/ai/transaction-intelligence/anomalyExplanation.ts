/**
 * AI Transaction Intelligence — Phase 7
 * Anomaly Explanation Builder
 *
 * Generates human-readable, audit-ready explanation strings from
 * individual detector findings.
 *
 * Privacy: account numbers in evidence are automatically redacted.
 * Pure function — no side effects.
 */

import type { AnomalyDetection, AnomalyRiskLevel, BaselineQuality } from './anomalyTypes.js';
import { redactAccountNumber } from './anomalyRules.js';

// ─── Explanation builder ──────────────────────────────────────────────────────

/**
 * Build a flat list of explanation strings from all active detections.
 * Ordered by score descending (most significant first).
 */
export function buildExplanations(
  detections: AnomalyDetection[],
  riskLevel: AnomalyRiskLevel,
  baselineQuality: BaselineQuality,
): string[] {
  const active = detections
    .filter(d => d.detected)
    .sort((a, b) => b.score - a.score);

  if (active.length === 0) {
    const qualityNote = baselineQuality === 'INSUFFICIENT'
      ? ' Baseline is insufficient for high-confidence assessment.'
      : '';
    return [`No material anomalies detected (risk level: ${riskLevel}).${qualityNote}`];
  }

  const lines: string[] = [];

  for (const detection of active) {
    const severityLabel = detection.severity === 'CRITICAL' ? '🔴 CRITICAL'
      : detection.severity === 'HIGH' ? '🟠 HIGH'
      : detection.severity === 'MEDIUM' ? '🟡 MEDIUM'
      : detection.severity === 'LOW' ? '🔵 LOW'
      : 'ℹ️ INFO';

    lines.push(`[${severityLabel}] ${formatTypeName(detection.type)}: ${detection.reason.join('; ')}`);

    // Redact sensitive account fields in evidence
    for (const ev of detection.evidence) {
      if (isAccountField(ev.key) && typeof ev.value === 'string' && /\d{5,}/.test(ev.value)) {
        lines.push(`  Evidence: ${ev.key} = ${redactAccountNumber(ev.value)}`);
      }
    }
  }

  if (baselineQuality === 'INSUFFICIENT') {
    lines.push('Note: Baseline data is insufficient — detection confidence is limited. Consider providing more historical transactions.');
  } else if (baselineQuality === 'LIMITED') {
    lines.push('Note: Baseline data is limited — some detectors may produce conservative results.');
  }

  return lines;
}

// ─── Conflict flags ───────────────────────────────────────────────────────────

/**
 * Identify logical conflicts in the detection set.
 * Example: BANK_REVERSAL intent + RAPID_REVERSAL detection → conflict flag.
 */
export function buildConflictFlags(
  detections: AnomalyDetection[],
  phase2Intent?: string,
): string[] {
  const flags: string[] = [];
  const detected = new Set(detections.filter(d => d.detected).map(d => d.type));

  // Known-valid reversal intent reduces the concern for rapid reversal
  if (
    detected.has('RAPID_REVERSAL') &&
    (phase2Intent === 'BANK_REVERSAL' || phase2Intent === 'REVERSAL')
  ) {
    flags.push(
      'RAPID_REVERSAL detected but Phase 2 classifies intent as BANK_REVERSAL — risk may be overstated; verify with additional context',
    );
  }

  // Exact duplicate + reference reuse → likely same issue
  if (detected.has('EXACT_DUPLICATE') && detected.has('REFERENCE_REUSE')) {
    flags.push('EXACT_DUPLICATE and REFERENCE_REUSE both triggered — likely the same underlying event; review once');
  }

  // New counterparty only — don't over-alarm
  if (detected.has('NEW_COUNTERPARTY') && detected.size === 1) {
    flags.push('Only NEW_COUNTERPARTY triggered — standalone new counterparty is low risk; verify identity before flagging further');
  }

  return flags;
}

// ─── Rapid reversal helper ─────────────────────────────────────────────────────

/**
 * Detect rapid reversal pattern from historical records.
 * Returns a detection result.
 */
export function buildRapidReversalDetection(input: {
  amount: number;
  direction?: string;
  transactionDate: string | Date;
  description: string;
  referenceNumber?: string;
  companyId: string | number;
  historical: Array<{
    amount: number;
    direction?: string;
    transactionDate: string | Date;
    description: string;
    referenceNumber?: string;
    companyId: string | number;
    intent?: string;
  }>;
  windowHours?: number;
  phase2Intent?: string;
}): AnomalyDetection {
  const windowHours = input.windowHours ?? 24;
  const companyStr = String(input.companyId);

  const txDate = (() => {
    const d = input.transactionDate instanceof Date
      ? input.transactionDate
      : new Date(input.transactionDate);
    return isNaN(d.getTime()) ? null : d;
  })();

  if (!txDate || !input.direction || input.direction === 'UNKNOWN') {
    return noRapidReversal();
  }

  const oppositeDirection = input.direction === 'DEBIT' ? 'CREDIT' : 'DEBIT';
  const sameCompany = input.historical.filter(h => String(h.companyId) === companyStr);

  // Look for a matching opposing transaction within window
  let bestMatch: typeof sameCompany[number] | null = null;
  let matchScore = 0;

  for (const h of sameCompany) {
    if (h.direction !== oppositeDirection) continue;

    const hDate = h.transactionDate instanceof Date
      ? h.transactionDate
      : new Date(h.transactionDate);
    if (isNaN(hDate.getTime())) continue;

    const diffHours = Math.abs(txDate.getTime() - hDate.getTime()) / 3600000;
    if (diffHours > windowHours) continue;

    const amountTol = Math.abs(h.amount - input.amount) / Math.max(1, input.amount);
    if (amountTol > 0.05) continue; // amounts must be within 5%

    let score = 0.40; // base for opposite-direction near-amount match
    if (amountTol === 0) score += 0.15;
    if (input.referenceNumber && h.referenceNumber &&
      input.referenceNumber.toLowerCase() === h.referenceNumber.toLowerCase()) {
      score += 0.20;
    }
    if (diffHours <= 1) score += 0.10;
    if (diffHours <= 6) score += 0.05;

    if (score > matchScore) {
      matchScore = score;
      bestMatch = h;
    }
  }

  if (!bestMatch || matchScore < 0.40) {
    return noRapidReversal();
  }

  // If Phase 2 classified as BANK_REVERSAL, this may be a valid reversal
  const isLegitimateReversal = input.phase2Intent === 'BANK_REVERSAL';
  const effectiveScore = isLegitimateReversal ? matchScore * 0.50 : matchScore;

  const severity = effectiveScore >= 0.65 ? 'HIGH'
    : effectiveScore >= 0.45 ? 'MEDIUM'
    : 'LOW';

  const reasons = [
    `Rapid reversal pattern: ${input.direction} of ${input.amount.toLocaleString()} followed by opposing ${oppositeDirection} within ${windowHours}h`,
  ];
  if (isLegitimateReversal) {
    reasons.push('Phase 2 intent is BANK_REVERSAL — this may be a legitimate reversal; anomaly retained for audit trail');
  }

  return {
    type: 'RAPID_REVERSAL',
    detected: true,
    score: parseFloat(Math.min(0.90, effectiveScore).toFixed(4)),
    severity,
    reason: reasons,
    evidence: [
      { key: 'matchScore', value: parseFloat(matchScore.toFixed(2)), contribution: matchScore },
      { key: 'isLegitimateReversal', value: isLegitimateReversal, contribution: 0 },
      { key: 'oppositeDirection', value: oppositeDirection, contribution: 0 },
    ],
  };
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function formatTypeName(type: string): string {
  return type.replace(/_/g, ' ');
}

function isAccountField(key: string): boolean {
  return /account|rekening|rek/i.test(key);
}

function noRapidReversal(): AnomalyDetection {
  return { type: 'RAPID_REVERSAL', detected: false, score: 0, severity: 'INFO', reason: [], evidence: [] };
}
