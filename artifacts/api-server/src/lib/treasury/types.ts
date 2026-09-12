/**
 * Treasury Batch 4 — Type Definitions
 * All types for Cash Position, Forecast, Variance, Liquidity, Risk.
 */

// ── Cash Position ─────────────────────────────────────────────────────────────

export interface BankAccountPosition {
  accountId: number;
  accountName: string;
  bankName: string | null;
  accountNumber: string | null;
  currency: string;
  openingBalance: number;
  netMutations: number;
  currentBalance: number;
  isRestricted: boolean;
}

export interface CashPosition {
  companyId: number;
  asOf: string; // ISO date
  currency: string;
  currentCash: number;
  availableCash: number;
  restrictedCash: number;
  outstandingReceivable: number;
  outstandingPayable: number;
  expectedIncoming: number;
  expectedOutgoing: number;
  netPosition: number;
  bankAccounts: BankAccountPosition[];
  computedAt: string; // ISO datetime
  latencyMs: number;
}

export interface CashPositionByBank {
  bankAccountId: number;
  bankName: string | null;
  accountNumber: string | null;
  currency: string;
  position: CashPosition;
}

// ── Cash Forecast ──────────────────────────────────────────────────────────────

export type ForecastHorizon = 0 | 7 | 30 | 60 | 90;

export interface ForecastBucket {
  horizonDays: ForecastHorizon;
  horizonDate: string;  // ISO date
  currency: string;
  expectedInflow: number;
  expectedOutflow: number;
  netForecast: number;
  openingBalance: number;
  closingBalance: number;
  arComponent: number;
  apComponent: number;
  mutationInflow: number;
  mutationOutflow: number;
}

export interface CashForecast {
  companyId: number;
  forecastDate: string; // ISO date — when this forecast was generated
  currency: string;
  buckets: ForecastBucket[];
  computedAt: string;
  latencyMs: number;
}

// ── Variance ──────────────────────────────────────────────────────────────────

export interface VarianceRow {
  periodDate: string;
  currency: string;
  expectedAmount: number;
  actualAmount: number;
  varianceAmount: number;
  variancePct: number | null;
  varianceType: 'inflow' | 'outflow' | 'balance';
  tracedItems?: VarianceTraceItem[];
}

export interface VarianceTraceItem {
  source: string; // 'ar' | 'ap' | 'bank_mutation'
  referenceId: number;
  referenceNumber: string | null;
  expectedAmount: number;
  actualAmount: number;
  dueDate: string | null;
}

export interface VarianceReport {
  companyId: number;
  fromDate: string;
  toDate: string;
  currency: string;
  rows: VarianceRow[];
  summary: {
    totalExpected: number;
    totalActual: number;
    totalVariance: number;
    avgVariancePct: number | null;
  };
  computedAt: string;
  latencyMs: number;
}

// ── Liquidity ─────────────────────────────────────────────────────────────────

export interface LiquidityMetrics {
  companyId: number;
  periodDate: string;
  currency: string;

  /** (Cash + AR) / Current Liabilities */
  quickRatio: number | null;
  /** Current Assets / Current Liabilities */
  currentRatio: number | null;
  /** Cash / Monthly Operating Expenses */
  cashCoverage: number | null;
  /** Operating Cash Flow / Monthly Expenses */
  operatingCashCoverage: number | null;
  /** Collected / Invoiced (%) */
  collectionEfficiency: number | null;
  /** Paid on time / Total Payable (%) */
  paymentEfficiency: number | null;
  /** Days Sales Outstanding = (AR / Revenue_30d) × 30 */
  dso: number | null;
  /** Days Payable Outstanding = (AP / Expenses_30d) × 30 */
  dpo: number | null;

  // Supporting figures
  currentAssets: number;
  currentLiabilities: number;
  cashAndEquivalents: number;
  totalRevenue30d: number;
  totalExpenses30d: number;

  computedAt: string;
  latencyMs: number;
}

// ── Risk Detection ────────────────────────────────────────────────────────────

export type AlertSeverity = 'INFO' | 'WARNING' | 'CRITICAL';

export type AlertType =
  | 'NEGATIVE_CASH'
  | 'NEAR_NEGATIVE_CASH'
  | 'LARGE_VARIANCE'
  | 'LATE_COLLECTION'
  | 'LATE_PAYMENT'
  | 'OUTSTANDING_AGING'
  | 'CASH_CONCENTRATION'
  | 'SINGLE_CUSTOMER_RISK'
  | 'SINGLE_VENDOR_RISK';

export interface TreasuryAlert {
  alertType: AlertType;
  severity: AlertSeverity;
  title: string;
  message: string;
  value: number | null;
  threshold: number | null;
  currency: string;
  bankAccountId?: number | null;
  metadata?: Record<string, unknown>;
}

export interface RiskReport {
  companyId: number;
  asOf: string;
  currency: string;
  alerts: TreasuryAlert[];
  riskScore: number; // 0-100, 100 = highest risk
  computedAt: string;
  latencyMs: number;
}

// ── Dashboard ─────────────────────────────────────────────────────────────────

export interface TreasuryDashboard {
  companyId: number;
  asOf: string;
  cashPosition: CashPosition;
  forecast: CashForecast;
  liquidity: LiquidityMetrics;
  alerts: TreasuryAlert[];
  computedAt: string;
  latencyMs: number;
}

// ── Query params ──────────────────────────────────────────────────────────────

export interface TreasuryQueryParams {
  companyId: number;
  asOf?: string;       // ISO date, defaults to today
  currency?: string;   // defaults to all
  fromDate?: string;   // for variance/history
  toDate?: string;
  page?: number;
  pageSize?: number;
}
