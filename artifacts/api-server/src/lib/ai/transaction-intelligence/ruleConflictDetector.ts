/**
 * AI Transaction Intelligence — Phase 6
 * Rule Conflict Detector
 *
 * Detects conflicts between:
 *   - recommendations vs. existing rule catalog
 *   - recommendations vs. existing dictionary
 *   - recommendations vs. each other
 *
 * Conflict types: DUPLICATE_RULE, CONTRADICTING_RULE, COMPANY_CONFLICT,
 * DICTIONARY_CONFLICT, COUNTERPARTY_CONFLICT, THRESHOLD_CONFLICT, KEYWORD_OVERLAP
 *
 * Pure function — no side effects, no DB calls.
 */

import type {
  RecommendedRule,
  RecommendedDictionaryEntry,
  RecommendedThresholdChange,
  RecommendedCounterpartyMapping,
  RuleConflict,
} from './adaptiveRuleTypes.js';
import type { ExistingRuleEntry, ExistingDictionaryEntry } from './learningEngineTypes.js';
import type { RuleRiskLevel } from './adaptiveRuleTypes.js';

let _seq = 0;
function nextConflictId(): string { return `conflict-${++_seq}`; }
export function resetConflictSequence(): void { _seq = 0; }

// ─── Helpers ───────────────────────────────────────────────────────────────────

function overlap(a: string, b: string): boolean {
  return a.toLowerCase().includes(b.toLowerCase()) ||
    b.toLowerCase().includes(a.toLowerCase());
}

// ─── Rule vs. existing rules ───────────────────────────────────────────────────

export function detectRuleVsExisting(
  recommendations: RecommendedRule[],
  existing: ExistingRuleEntry[],
): RuleConflict[] {
  const conflicts: RuleConflict[] = [];

  for (const rec of recommendations) {
    for (const ex of existing) {
      if (!ex.isActive) continue;

      // DUPLICATE: same type + same keyword/counterparty + same intent
      if (
        rec.type === ex.type &&
        rec.keyword != null && ex.keyword != null &&
        rec.keyword.toLowerCase() === ex.keyword.toLowerCase() &&
        rec.affectedIntents.includes(ex.intent as any)
      ) {
        conflicts.push({
          id: nextConflictId(),
          type: 'DUPLICATE_RULE',
          description: `Recommended keyword "${rec.keyword}" for intent ${ex.intent} already exists in rule ${ex.id}.`,
          affectedRecommendationIds: [rec.id],
          existingRuleIds: [ex.id],
          severity: 'LOW',
          resolution: 'Review whether the existing rule already covers this pattern; if so, skip this recommendation.',
        });
      }

      // CONTRADICTING: same keyword → different intent
      if (
        rec.keyword != null && ex.keyword != null &&
        rec.keyword.toLowerCase() === ex.keyword.toLowerCase() &&
        rec.affectedIntents.length > 0 &&
        !rec.affectedIntents.includes(ex.intent as any)
      ) {
        conflicts.push({
          id: nextConflictId(),
          type: 'CONTRADICTING_RULE',
          description: `Keyword "${rec.keyword}" maps to ${rec.affectedIntents[0]} in this recommendation but to ${ex.intent} in existing rule ${ex.id}.`,
          affectedRecommendationIds: [rec.id],
          existingRuleIds: [ex.id],
          severity: 'HIGH',
          resolution: 'Investigate which intent is correct for this keyword before applying.',
        });
      }

      // COMPANY_CONFLICT: recommendation is global but existing rule is company-scoped
      if (
        rec.companyId == null && ex.companyId != null &&
        rec.keyword != null && ex.keyword != null &&
        rec.keyword.toLowerCase() === ex.keyword.toLowerCase()
      ) {
        conflicts.push({
          id: nextConflictId(),
          type: 'COMPANY_CONFLICT',
          description: `Global recommendation for keyword "${rec.keyword}" conflicts with company-scoped rule ${ex.id} for company ${ex.companyId}.`,
          affectedRecommendationIds: [rec.id],
          existingRuleIds: [ex.id],
          severity: 'MEDIUM',
          resolution: 'Scope the new recommendation to the specific company, or remove the company-specific rule first.',
        });
      }
    }
  }
  return conflicts;
}

// ─── Dictionary conflicts ──────────────────────────────────────────────────────

export function detectDictionaryConflicts(
  dictEntries: RecommendedDictionaryEntry[],
  existing: ExistingDictionaryEntry[],
): RuleConflict[] {
  const conflicts: RuleConflict[] = [];

  for (const rec of dictEntries) {
    for (const ex of existing) {
      if (!ex.isActive) continue;

      // Same keyword → same intent: duplicate
      if (rec.keyword.toLowerCase() === ex.keyword.toLowerCase() && rec.intent === ex.intent) {
        conflicts.push({
          id: nextConflictId(),
          type: 'DICTIONARY_CONFLICT',
          description: `Dictionary entry for keyword "${rec.keyword}" (intent: ${rec.intent}) already exists with weight ${ex.weight}.`,
          affectedRecommendationIds: [rec.id],
          existingRuleIds: [],
          severity: 'LOW',
          resolution: `Consider updating the existing entry weight to ${rec.suggestedWeight} instead of adding a new entry.`,
        });
      }

      // Same keyword → different intent: contradiction
      if (rec.keyword.toLowerCase() === ex.keyword.toLowerCase() && rec.intent !== ex.intent) {
        conflicts.push({
          id: nextConflictId(),
          type: 'DICTIONARY_CONFLICT',
          description: `Keyword "${rec.keyword}" is recommended for intent ${rec.intent} but existing dictionary maps it to ${ex.intent}.`,
          affectedRecommendationIds: [rec.id],
          existingRuleIds: [],
          severity: 'HIGH',
          resolution: 'Verify the correct intent mapping; the existing dictionary entry may need to be removed or updated.',
        });
      }

      // Keyword overlap (substring match)
      if (
        rec.keyword.toLowerCase() !== ex.keyword.toLowerCase() &&
        overlap(rec.keyword, ex.keyword) &&
        rec.intent === ex.intent
      ) {
        conflicts.push({
          id: nextConflictId(),
          type: 'KEYWORD_OVERLAP',
          description: `New keyword "${rec.keyword}" overlaps with existing keyword "${ex.keyword}" for intent ${ex.intent}.`,
          affectedRecommendationIds: [rec.id],
          existingRuleIds: [],
          severity: 'LOW',
          resolution: 'Ensure the new keyword adds specificity rather than duplicating existing coverage.',
        });
      }
    }
  }
  return conflicts;
}

// ─── Counterparty conflicts ────────────────────────────────────────────────────

export function detectCounterpartyConflicts(
  mappings: RecommendedCounterpartyMapping[],
  existing: ExistingRuleEntry[],
): RuleConflict[] {
  const conflicts: RuleConflict[] = [];

  const existingCounterparty = existing.filter(
    (r) => r.type === 'COUNTERPARTY_MAPPING' && r.counterpartyPattern,
  );

  for (const rec of mappings) {
    for (const ex of existingCounterparty) {
      if (!ex.isActive || !ex.counterpartyPattern) continue;
      if (overlap(rec.counterpartyPattern, ex.counterpartyPattern)) {
        if (rec.suggestedIntent === ex.intent) {
          conflicts.push({
            id: nextConflictId(),
            type: 'COUNTERPARTY_CONFLICT',
            description: `Counterparty pattern "${rec.counterpartyPattern}" already mapped to ${ex.intent} in rule ${ex.id}.`,
            affectedRecommendationIds: [rec.id],
            existingRuleIds: [ex.id],
            severity: 'LOW',
            resolution: 'Existing counterparty mapping may already cover this pattern.',
          });
        } else {
          conflicts.push({
            id: nextConflictId(),
            type: 'COUNTERPARTY_CONFLICT',
            description: `Counterparty pattern "${rec.counterpartyPattern}" is recommended for ${rec.suggestedIntent} but existing rule ${ex.id} maps overlapping pattern to ${ex.intent}.`,
            affectedRecommendationIds: [rec.id],
            existingRuleIds: [ex.id],
            severity: 'HIGH',
            resolution: 'Investigate which intent is correct for this counterparty pattern.',
          });
        }
      }
    }
  }
  return conflicts;
}

// ─── Threshold conflicts ───────────────────────────────────────────────────────

export function detectThresholdConflicts(
  changes: RecommendedThresholdChange[],
): RuleConflict[] {
  const conflicts: RuleConflict[] = [];
  const seen = new Map<string, RecommendedThresholdChange>();

  for (const change of changes) {
    if (seen.has(change.parameter)) {
      const prev = seen.get(change.parameter)!;
      if (Math.abs(prev.suggestedValue - change.suggestedValue) > 0.001) {
        conflicts.push({
          id: nextConflictId(),
          type: 'THRESHOLD_CONFLICT',
          description: `Parameter "${change.parameter}" has conflicting suggested values: ${prev.suggestedValue} vs ${change.suggestedValue}.`,
          affectedRecommendationIds: [prev.id, change.id],
          existingRuleIds: [],
          severity: 'MEDIUM',
          resolution: `Use the higher-confidence suggestion (${prev.confidence >= change.confidence ? prev.suggestedValue : change.suggestedValue}).`,
        });
      }
    } else {
      seen.set(change.parameter, change);
    }
  }
  return conflicts;
}

// ─── Within-recommendation conflicts ──────────────────────────────────────────

export function detectIntraRecommendationConflicts(
  recommendations: RecommendedRule[],
): RuleConflict[] {
  const conflicts: RuleConflict[] = [];

  for (let i = 0; i < recommendations.length; i++) {
    for (let j = i + 1; j < recommendations.length; j++) {
      const a = recommendations[i]!;
      const b = recommendations[j]!;

      // Same keyword → different intents within recommendations
      if (
        a.keyword != null && b.keyword != null &&
        a.keyword.toLowerCase() === b.keyword.toLowerCase() &&
        a.affectedIntents[0] != null && b.affectedIntents[0] != null &&
        a.affectedIntents[0] !== b.affectedIntents[0]
      ) {
        conflicts.push({
          id: nextConflictId(),
          type: 'CONTRADICTING_RULE',
          description: `Two recommendations use keyword "${a.keyword}" for different intents: ${a.affectedIntents[0]} vs ${b.affectedIntents[0]}.`,
          affectedRecommendationIds: [a.id, b.id],
          existingRuleIds: [],
          severity: 'HIGH' as RuleRiskLevel,
          resolution: 'Keep only the higher-confidence recommendation.',
        });
      }
    }
  }
  return conflicts;
}

// ─── Full conflict pass ────────────────────────────────────────────────────────

export interface ConflictDetectionInput {
  rules: RecommendedRule[];
  dictionaryEntries: RecommendedDictionaryEntry[];
  thresholdChanges: RecommendedThresholdChange[];
  counterpartyMappings: RecommendedCounterpartyMapping[];
  existingRules: ExistingRuleEntry[];
  existingDictionary: ExistingDictionaryEntry[];
}

export function detectAllConflicts(input: ConflictDetectionInput): RuleConflict[] {
  return [
    ...detectRuleVsExisting(input.rules, input.existingRules),
    ...detectDictionaryConflicts(input.dictionaryEntries, input.existingDictionary),
    ...detectCounterpartyConflicts(input.counterpartyMappings, input.existingRules),
    ...detectThresholdConflicts(input.thresholdChanges),
    ...detectIntraRecommendationConflicts(input.rules),
  ];
}
