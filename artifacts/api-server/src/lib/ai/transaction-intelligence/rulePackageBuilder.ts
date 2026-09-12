/**
 * AI Transaction Intelligence — Phase 6
 * Rule Package Builder
 *
 * Groups recommendations into four package types:
 *   RULE_PACKAGE, DICTIONARY_PACKAGE, COUNTERPARTY_PACKAGE, THRESHOLD_PACKAGE
 *
 * Each package has an overall risk level and priority derived from its members.
 * All packages have requiresHumanApproval = true.
 *
 * Pure function — no side effects, no DB calls.
 */

import type {
  RecommendedRule,
  RecommendedDictionaryEntry,
  RecommendedThresholdChange,
  RecommendedCounterpartyMapping,
  RulePackage,
  RuleRiskLevel,
  RulePriority,
} from './adaptiveRuleTypes.js';
import { aggregateRiskLevels } from './ruleRiskAnalyzer.js';
import { aggregatePriorities } from './rulePriority.js';

let _pkgSeq = 0;
function nextPackageId(): string { return `pkg-${++_pkgSeq}`; }
export function resetPackageSequence(): void { _pkgSeq = 0; }

// ─── Helpers ───────────────────────────────────────────────────────────────────

function buildTitle(type: RulePackage['packageType'], count: number): string {
  switch (type) {
    case 'RULE_PACKAGE':         return `Rule Package (${count} rules)`;
    case 'DICTIONARY_PACKAGE':   return `Dictionary Package (${count} entries)`;
    case 'COUNTERPARTY_PACKAGE': return `Counterparty Mapping Package (${count} mappings)`;
    case 'THRESHOLD_PACKAGE':    return `Threshold Change Package (${count} parameters)`;
  }
}

function buildDescription(type: RulePackage['packageType']): string {
  switch (type) {
    case 'RULE_PACKAGE':
      return 'Keyword, alias, and intent-COA mapping rules derived from recurring feedback patterns. Apply after manual review by an administrator.';
    case 'DICTIONARY_PACKAGE':
      return 'New dictionary keywords and aliases suggested by learning signals. Adds coverage for previously unrecognized transaction patterns.';
    case 'COUNTERPARTY_PACKAGE':
      return 'Counterparty-to-intent/COA mappings for frequently occurring counterparty names. Improves accuracy for known trading partners.';
    case 'THRESHOLD_PACKAGE':
      return 'Suggested adjustments to scoring threshold parameters. High-risk: review carefully before applying.';
  }
}

// ─── Rule Package ──────────────────────────────────────────────────────────────

export function buildRulePackage(rules: RecommendedRule[]): RulePackage | null {
  if (rules.length === 0) return null;
  const risk = aggregateRiskLevels(rules.map((r) => r.riskLevel));
  const priority = aggregatePriorities(rules.map((r) => r.priority));
  const estimatedImpact = rules.reduce((s, r) => s + r.supportingOccurrences, 0);
  return {
    packageId: nextPackageId(),
    packageType: 'RULE_PACKAGE',
    title: buildTitle('RULE_PACKAGE', rules.length),
    description: buildDescription('RULE_PACKAGE'),
    rules,
    dictionaryEntries: [],
    counterpartyMappings: [],
    thresholdChanges: [],
    riskLevel: risk,
    priority,
    requiresHumanApproval: true,
    estimatedImpact,
  };
}

// ─── Dictionary Package ────────────────────────────────────────────────────────

export function buildDictionaryPackage(
  entries: RecommendedDictionaryEntry[],
): RulePackage | null {
  if (entries.length === 0) return null;
  const risk = aggregateRiskLevels(entries.map((e) => e.riskLevel));
  const priority = aggregatePriorities(entries.map((e) => e.priority));
  const estimatedImpact = entries.reduce((s, e) => s + e.supportingOccurrences, 0);
  return {
    packageId: nextPackageId(),
    packageType: 'DICTIONARY_PACKAGE',
    title: buildTitle('DICTIONARY_PACKAGE', entries.length),
    description: buildDescription('DICTIONARY_PACKAGE'),
    rules: [],
    dictionaryEntries: entries,
    counterpartyMappings: [],
    thresholdChanges: [],
    riskLevel: risk,
    priority,
    requiresHumanApproval: true,
    estimatedImpact,
  };
}

// ─── Counterparty Package ──────────────────────────────────────────────────────

export function buildCounterpartyPackage(
  mappings: RecommendedCounterpartyMapping[],
): RulePackage | null {
  if (mappings.length === 0) return null;
  const risk = aggregateRiskLevels(mappings.map((m) => m.riskLevel));
  const priority = aggregatePriorities(mappings.map((m) => m.priority));
  const estimatedImpact = mappings.reduce((s, m) => s + m.supportingOccurrences, 0);
  return {
    packageId: nextPackageId(),
    packageType: 'COUNTERPARTY_PACKAGE',
    title: buildTitle('COUNTERPARTY_PACKAGE', mappings.length),
    description: buildDescription('COUNTERPARTY_PACKAGE'),
    rules: [],
    dictionaryEntries: [],
    counterpartyMappings: mappings,
    thresholdChanges: [],
    riskLevel: risk,
    priority,
    requiresHumanApproval: true,
    estimatedImpact,
  };
}

// ─── Threshold Package ────────────────────────────────────────────────────────

export function buildThresholdPackage(
  changes: RecommendedThresholdChange[],
): RulePackage | null {
  if (changes.length === 0) return null;
  const risk = aggregateRiskLevels(changes.map((c) => c.riskLevel));
  const priority = aggregatePriorities(changes.map((c) => c.priority));
  return {
    packageId: nextPackageId(),
    packageType: 'THRESHOLD_PACKAGE',
    title: buildTitle('THRESHOLD_PACKAGE', changes.length),
    description: buildDescription('THRESHOLD_PACKAGE'),
    rules: [],
    dictionaryEntries: [],
    counterpartyMappings: [],
    thresholdChanges: changes,
    riskLevel: risk,
    priority,
    requiresHumanApproval: true,
    estimatedImpact: 0,
  };
}

// ─── Full package builder ──────────────────────────────────────────────────────

export interface PackageBuilderInput {
  rules: RecommendedRule[];
  dictionaryEntries: RecommendedDictionaryEntry[];
  counterpartyMappings: RecommendedCounterpartyMapping[];
  thresholdChanges: RecommendedThresholdChange[];
}

export function buildAllPackages(input: PackageBuilderInput): RulePackage[] {
  const packages: RulePackage[] = [];
  const rp = buildRulePackage(input.rules);
  const dp = buildDictionaryPackage(input.dictionaryEntries);
  const cp = buildCounterpartyPackage(input.counterpartyMappings);
  const tp = buildThresholdPackage(input.thresholdChanges);
  if (rp) packages.push(rp);
  if (dp) packages.push(dp);
  if (cp) packages.push(cp);
  if (tp) packages.push(tp);
  return packages;
}
