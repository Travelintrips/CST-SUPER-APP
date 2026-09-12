/**
 * AI Transaction Intelligence — Phase 7
 * Anomaly Detection — Domain Types
 *
 * Pure type definitions. No side effects, no logic.
 */

import type { TransactionIntent } from './transactionTypes.js';
import type { TransactionAnalysisResult } from './transactionTypes.js';
import type { IntentClassificationResult } from './intentClassificationTypes.js';
import type { CoaPredictionResult } from './coaPredictionTypes.js';
import type { ExplainabilityResult } from './explainabilityTypes.js';

// ─── Anomaly Type ─────────────────────────────────────────────────────────────

export type AnomalyType =
  | 'AMOUNT_OUTLIER'
  | 'FREQUENCY_SPIKE'
  | 'EXACT_DUPLICATE'
  | 'NEAR_DUPLICATE'
  | 'NEW_COUNTERPARTY'
  | 'UNUSUAL_COUNTERPARTY'
  | 'UNUSUAL_TRANSACTION_TIME'
  | 'UNUSUAL_TRANSACTION_DAY'
  | 'UNUSUAL_COA'
  | 'COA_INTENT_MISMATCH'
  | 'SPLIT_TRANSACTION'
  | 'CROSS_COMPANY_PATTERN'
  | 'ROUND_AMOUNT_PATTERN'
  | 'RAPID_REVERSAL'
  | 'DESCRIPTION_MISMATCH'
  | 'REFERENCE_REUSE'
  | 'UNUSUAL_DIRECTION'
  | 'INSUFFICIENT_BASELINE'
  | 'UNKNOWN';

export type AnomalySeverity = 'INFO' | 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL';
export type AnomalyRiskLevel = 'NONE' | 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL';
export type AnomalyRecommendationAction =
  | 'NO_ACTION'
  | 'MONITOR'
  | 'MANUAL_REVIEW'
  | 'ESCALATE'
  | 'HOLD_FOR_REVIEW';
export type BaselineQuality = 'INSUFFICIENT' | 'LIMITED' | 'GOOD' | 'STRONG';

// ─── Evidence ─────────────────────────────────────────────────────────────────

export interface AnomalyEvidence {
  key: string;
  value: string | number | boolean;
  expected?: string | number | boolean;
  /** How much this evidence contributes to the detector score (0–1). */
  contribution: number;
}

// ─── Single-Detector Finding ──────────────────────────────────────────────────

export interface AnomalyDetection {
  type: AnomalyType;
  detected: boolean;
  score: number;
  severity: AnomalySeverity;
  reason: string[];
  evidence: AnomalyEvidence[];
}

// ─── Historical Transaction ───────────────────────────────────────────────────

export interface HistoricalTransactionRecord {
  id?: string | number;
  companyId: string | number;
  description: string;
  normalizedDescription?: string;
  direction?: 'DEBIT' | 'CREDIT' | 'UNKNOWN';
  amount: number;
  currency?: string;
  transactionDate: string | Date;
  bankAccountId?: string | number;
  counterpartyName?: string;
  counterpartyAccount?: string;
  referenceNumber?: string;
  transactionCode?: string;
  intent?: TransactionIntent;
  coaId?: string | number;
  coaCode?: string;
  status?: string;
  approved?: boolean;
  rejected?: boolean;
  metadata?: Record<string, unknown>;
}

// ─── Company Anomaly Baseline ─────────────────────────────────────────────────

export interface CompanyAnomalyBaseline {
  companyId: string | number;
  sampleSize: number;
  amount: {
    mean?: number;
    median?: number;
    standardDeviation?: number;
    p25?: number;
    p75?: number;
    p90?: number;
    p95?: number;
    p99?: number;
    min?: number;
    max?: number;
  };
  frequency?: {
    averagePerDay?: number;
    averagePerWeek?: number;
    averagePerMonth?: number;
  };
  commonCounterparties?: string[];
  commonTransactionCodes?: string[];
  commonIntents?: TransactionIntent[];
  commonCoaCodes?: string[];
  usualHours?: number[];
  usualDaysOfWeek?: number[];
  generatedAt?: string | Date;
}

// ─── Detection Policy ─────────────────────────────────────────────────────────

export interface AnomalyDetectionPolicy {
  minimumHistoricalSample?: number;
  anomalyThreshold?: number;
  reviewThreshold?: number;
  highRiskThreshold?: number;
  criticalRiskThreshold?: number;
  amountZScoreThreshold?: number;
  amountPercentileThreshold?: number;
  duplicateWindowMinutes?: number;
  nearDuplicateAmountTolerance?: number;
  frequencyMultiplier?: number;
  splitTransactionWindowHours?: number;
  splitTransactionMinimumCount?: number;
  splitTransactionAmountTolerance?: number;
  unusualHourStart?: number;
  unusualHourEnd?: number;
  ignoredTransactionCodes?: string[];
  ignoredCounterparties?: string[];
  ignoredCoaCodes?: string[];
  approvalThresholds?: number[];
  enabledDetectors?: {
    amount?: boolean;
    frequency?: boolean;
    duplicate?: boolean;
    counterparty?: boolean;
    timing?: boolean;
    coa?: boolean;
    splitTransaction?: boolean;
    crossCompany?: boolean;
  };
}

// ─── Detection Input ──────────────────────────────────────────────────────────

export interface AnomalyDetectionInput {
  companyId: string | number;
  transaction: {
    id?: string | number;
    description: string;
    normalizedDescription?: string;
    direction?: 'DEBIT' | 'CREDIT' | 'UNKNOWN';
    amount: number;
    currency?: string;
    transactionDate: string | Date;
    bankAccountId?: string | number;
    bankName?: string;
    counterpartyName?: string;
    counterpartyAccount?: string;
    referenceNumber?: string;
    transactionCode?: string;
    coaId?: string | number;
    coaCode?: string;
    coaName?: string;
    createdBy?: string | number;
    approvedBy?: string | number;
    metadata?: Record<string, unknown>;
  };
  phase1Analysis?: TransactionAnalysisResult;
  phase2Classification?: IntentClassificationResult;
  phase3Prediction?: CoaPredictionResult;
  phase4Explanation?: ExplainabilityResult;
  historicalTransactions?: HistoricalTransactionRecord[];
  companyBaseline?: CompanyAnomalyBaseline;
  policy?: AnomalyDetectionPolicy;
  /** ISO string or Date for deterministic time-based detection. */
  evaluationTime?: string | Date;
}

// ─── Dependency Injection ─────────────────────────────────────────────────────

export interface AnomalyDetectionDependencies {
  getHistoricalTransactions?: (
    input: AnomalyDetectionInput,
  ) => HistoricalTransactionRecord[] | Promise<HistoricalTransactionRecord[]>;
  getCompanyBaseline?: (
    companyId: string | number,
  ) => CompanyAnomalyBaseline | null | Promise<CompanyAnomalyBaseline | null>;
  getApprovalThresholds?: (companyId: string | number) => number[] | Promise<number[]>;
  /** Inject current time for deterministic evaluation; defaults to new Date(). */
  now?: () => Date;
}

// ─── Detection Result ─────────────────────────────────────────────────────────

export interface AnomalyDetectionResult {
  companyId: string | number;
  transactionId?: string | number;
  isAnomaly: boolean;
  anomalyScore: number;
  riskLevel: AnomalyRiskLevel;
  anomalyTypes: AnomalyType[];
  detections: AnomalyDetection[];
  explanation: string[];
  recommendation: AnomalyRecommendationAction;
  requiresManualReview: boolean;
  baselineQuality: BaselineQuality;
  confidence: number;
  conflictFlags: string[];
  evaluatedAt: string;
  anomalyVersion: '1.0';
}

// ─── Re-export upstream types for convenience ─────────────────────────────────

export type {
  TransactionAnalysisResult,
  IntentClassificationResult,
  CoaPredictionResult,
  ExplainabilityResult,
};
