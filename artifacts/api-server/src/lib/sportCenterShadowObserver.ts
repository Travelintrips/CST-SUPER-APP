import pg from "pg";
import { getSportCenterFinanceMode } from "./financeBoundary.js";
import type { FinanceProjectConfig } from "./financeProjectConfigResolver.js";

type QueryClient = Pick<pg.Pool, "query">;
type ObserverOptions = {
  client?: pg.PoolClient;
  fixturePaymentIds?: number[];
  shadowStartedAt?: string | Date | null;
  allowHistoricalBackfill?: boolean;
  comparisonVersion?: string;
};

type Payment = {
  id: number;
  company_id: number;
  amount: string | number;
  payment_method: string;
  provider_code: string;
  confirmed_at: string | null;
  expected_settlement_date: string | null;
  payment_type: string | null;
  mdr_amount: string | number | null;
};

type Expected = {
  companyId: number;
  gross: number;
  dpp: number;
  tax: number;
  mdr: number;
  netSettlement: number;
  settlementDate: string;
  revenueCoa: string | null;
  revenueAccountName: string | null;
  taxOutputCoa: string | null;
  taxOutputAccountName: string | null;
  bankCoa: string | null;
  bankAccountName: string | null;
  accountingIdentity: Record<string, unknown>;
};

const VERSION = "1";
const ZERO_EFFECT_TABLES = [
  "accounting_entries", "accounting_journals", "accounting_entry_lines",
  "payment_settlement_batches", "payment_settlement_items", "bank_mutations",
  "reconciliation_matches",
] as const;

let pool: pg.Pool | null = null;

function getPool(): pg.Pool | null {
  const isProduction =
    process.env.APP_ENV === "production" ||
    process.env.NODE_ENV === "production" ||
    !!process.env.REPLIT_DEPLOYMENT;
  const connectionString = isProduction
    ? process.env.SUPABASE_DATABASE_URL
    : process.env.SUPABASE_DATABASE_URL_DEV;
  if (!connectionString) return null;
  pool ??= new pg.Pool({
    connectionString,
    ssl: { rejectUnauthorized: false },
    max: 2,
  });
  return pool;
}

function round(value: number): number {
  return Math.round((value + Number.EPSILON) * 100) / 100;
}

function asError(error: unknown): string {
  return (error instanceof Error ? error.message : String(error)).slice(0, 1000);
}

function isoTimestamp(value: string | Date): string {
  return value instanceof Date ? value.toISOString() : value;
}

function equivalentAccountLabel(actual: string | null, code: string | null, name: string | null): boolean {
  const normalize = (value: string) => value
    .toLowerCase()
    .replace(/\bbooking\b/g, "")
    .replace(/\bcst\b/g, "")
    .replace(/[^a-z0-9]+/g, "");
  const normalizedActual = normalize(actual ?? "");
  return [code, name].some((value) => value != null && normalizedActual === normalize(String(value)));
}

function configuredStart(options: ObserverOptions): string | null {
  if (options.shadowStartedAt instanceof Date) return options.shadowStartedAt.toISOString();
  if (typeof options.shadowStartedAt === "string") return options.shadowStartedAt;
  return process.env.SPORT_CENTER_SHADOW_STARTED_AT ?? null;
}

async function claim(
  client: QueryClient,
  options: ObserverOptions,
): Promise<Array<{ id: number; paymentId: number; eventType: string; correlationId: string }>> {
  const version = options.comparisonVersion ?? VERSION;
  const ids = options.fixturePaymentIds?.length ? options.fixturePaymentIds : null;
  const start = configuredStart(options);
  const result = await client.query(
    `WITH candidates AS (
       SELECT o.payment_id, o.event_type,
              COALESCE(o.correlation_id, 'sc_payment_' || o.payment_id::text) AS correlation_id
         FROM sport_center.payment_accounting_outbox o
         JOIN sport_center.sport_payments p ON p.id = o.payment_id
        WHERE o.event_type = 'payment_confirmed'
          AND ($1::int[] IS NULL OR o.payment_id = ANY($1::int[]))
          AND ($2::timestamptz IS NULL OR p.confirmed_at >= $2::timestamptz)
          AND ($3::boolean OR $2::timestamptz IS NULL OR p.confirmed_at >= $2::timestamptz)
        FOR UPDATE OF o SKIP LOCKED
     )
     INSERT INTO sport_center.shadow_observer_comparisons
       (project_code, source_payment_id, event_type, correlation_id,
        comparison_version, comparison_status, shadow_started_at)
     SELECT 'sport_center', c.payment_id, c.event_type, c.correlation_id,
            $4, 'processing', $2::timestamptz
       FROM candidates c
      ON CONFLICT (project_code, source_payment_id, event_type, comparison_version)
      DO UPDATE SET comparison_status = 'processing', updated_at = NOW()
        WHERE sport_center.shadow_observer_comparisons.comparison_status IN
          ('pending','failed','MANUAL_REVIEW','NOT_OBSERVED')
     RETURNING id, source_payment_id AS payment_id, event_type, correlation_id`,
    [ids, start, options.allowHistoricalBackfill === true, version],
  );
  return result.rows.map((row) => ({
    id: Number(row.id),
    paymentId: Number(row.payment_id),
    eventType: String(row.event_type),
    correlationId: String(row.correlation_id),
  }));
}

async function readPayment(client: QueryClient, paymentId: number): Promise<Payment> {
  const result = await client.query<Payment>(
    `SELECT id, company_id, amount, payment_method::text AS payment_method,
            COALESCE(payment_provider::text, 'unknown') AS provider_code,
            confirmed_at, expected_settlement_date, payment_type::text AS payment_type,
            NULL::numeric AS mdr_amount
       FROM sport_center.sport_payments
     WHERE id = $1`,
    [paymentId],
  );
  const payment = result.rows[0];
  if (!payment) throw new Error(`SPORT_PAYMENT_NOT_FOUND: ${paymentId}`);
  if (!payment.confirmed_at) throw new Error(`SPORT_PAYMENT_NOT_CONFIRMED: ${paymentId}`);
  if (!payment.company_id) throw new Error(`SHARED_CONFIG_COMPANY_INVALID: ${paymentId}`);
  return payment;
}

function expectedResult(payment: Payment, config: FinanceProjectConfig): Expected {
  const gross = round(Number(payment.amount));
  if (!Number.isFinite(gross) || gross <= 0) throw new Error(`INVALID_PAYMENT_AMOUNT: ${payment.id}`);
  const dpp = config.taxRate > 0 ? round(gross / (1 + config.taxRate / 100)) : gross;
  const tax = round(gross - dpp);
  const mdr = round(gross * config.mdrRate / 100 + config.fixedProviderFee);
  const settlementDate = payment.expected_settlement_date ??
    payment.confirmed_at!.slice(0, 10);
  return {
    companyId: payment.company_id,
    gross, dpp, tax, mdr,
    netSettlement: round(gross - mdr),
    settlementDate,
    revenueCoa: config.accountCodes.REVENUE ?? null,
    revenueAccountName: config.accountNames.REVENUE ?? null,
    taxOutputCoa: config.accountCodes.TAX_OUTPUT ?? null,
    taxOutputAccountName: config.accountNames.TAX_OUTPUT ?? null,
    bankCoa: config.accountCodes.RECEIVING_BANK ?? null,
    bankAccountName: config.accountNames.RECEIVING_BANK ?? null,
    accountingIdentity: {
      projectCode: "sport_center",
      sourcePaymentId: payment.id,
      eventType: "payment_confirmed",
      companyId: payment.company_id,
    },
  };
}

async function readLegacyActual(client: QueryClient, paymentId: number) {
  const result = await client.query<{
    journal_id: number; debit_account: string | null; revenue_account: string | null;
    tax_account: string | null; gross_amount: string | number; dpp_amount: string | number;
    tax_amount: string | number; payment_provider: string | null; bank_account_id: string | null;
    journal_date: string | null;
  }>(
    `SELECT j.id AS journal_id, j.debit_account, j.credit_revenue_account AS revenue_account,
            j.credit_ppn_account AS tax_account, j.gross_amount, j.dpp_amount, j.tax_amount,
            j.payment_provider, j.bank_account_id::text AS bank_account_id,
            j.journal_date::text AS journal_date
       FROM sport_center.accounting_journals j
      WHERE j.payment_id = $1
        AND j.journal_type = 'payment_confirmed'
        AND COALESCE(j.is_reversal, FALSE) = FALSE
      ORDER BY j.id DESC
      LIMIT 1`,
    [paymentId],
  );
  return result.rows[0] ?? null;
}

function classify(expected: Expected, actual: Awaited<ReturnType<typeof readLegacyActual>>) {
  if (!actual) return { status: "NOT_OBSERVED", comparisonClass: "legacy_result_missing" };
  const coreMatch =
    round(Number(actual.gross_amount)) === expected.gross &&
    round(Number(actual.dpp_amount)) === expected.dpp &&
    round(Number(actual.tax_amount)) === expected.tax &&
    equivalentAccountLabel(actual.revenue_account, expected.revenueCoa, expected.revenueAccountName) &&
    equivalentAccountLabel(actual.tax_account, expected.taxOutputCoa, expected.taxOutputAccountName);
  if (coreMatch && equivalentAccountLabel(actual.debit_account, expected.bankCoa, expected.bankAccountName)) {
    return { status: "MATCH", comparisonClass: "exact" };
  }
  if (coreMatch) return { status: "ALLOWED_DIFFERENCE", comparisonClass: "legacy_bank_identity" };
  return { status: "MISMATCH", comparisonClass: "accounting_or_amount" };
}

async function finish(client: QueryClient, id: number, data: Record<string, unknown>) {
  await client.query(
    `UPDATE sport_center.shadow_observer_comparisons
        SET comparison_status = $2, comparison_class = $3,
            comparison_evidence = $4::jsonb,
            expected_accounting_identity = $5::jsonb,
            actual_accounting_identity = $6::jsonb,
            expected_revenue_coa = $7, actual_revenue_coa = $8,
            expected_tax_output_coa = $9, actual_tax_output_coa = $10,
            expected_bank_coa = $11, actual_bank_coa = $12,
            expected_mdr = $13, actual_mdr = $14,
            expected_net_settlement = $15, actual_net_settlement = $16,
            expected_settlement_date = $17, actual_settlement_date = $18,
            last_error = $19, compared_at = NOW(), updated_at = NOW()
      WHERE id = $1`,
    [
      id, data.status, data.comparisonClass, JSON.stringify(data.evidence ?? {}),
      JSON.stringify(data.expectedIdentity ?? null), JSON.stringify(data.actualIdentity ?? null),
      data.expectedRevenue, data.actualRevenue, data.expectedTax, data.actualTax,
      data.expectedBank, data.actualBank, data.expectedMdr, data.actualMdr,
      data.expectedNet, data.actualNet, data.expectedDate, data.actualDate, data.error ?? null,
    ],
  );
}

export async function observeSportCenterShadow(
  options: ObserverOptions = {},
): Promise<{ claimed: number; compared: number; manualReview: number; notObserved: number }> {
  if (getSportCenterFinanceMode() !== "shadow") {
    return { claimed: 0, compared: 0, manualReview: 0, notObserved: 0 };
  }
  const client = options.client;
  if (!client) throw new Error("SHADOW_OBSERVER_CLIENT_REQUIRED");
  const claims = await claim(client, options);
  let compared = 0; let manualReview = 0; let notObserved = 0;
  for (const item of claims) {
    try {
      const payment = await readPayment(client, item.paymentId);
      const { resolveFinanceProjectConfigWithClient } = await import("./financeProjectConfigResolver.js");
      const config = await resolveFinanceProjectConfigWithClient(client, {
        projectCode: "sport_center",
        companyId: payment.company_id,
        paymentMethod: payment.payment_method,
        providerCode: payment.provider_code,
        effectiveDate: isoTimestamp(payment.confirmed_at!).slice(0, 10),
      });
      const expected = expectedResult(payment, config);
      const actual = await readLegacyActual(client, item.paymentId);
      const result = classify(expected, actual);
      if (result.status === "NOT_OBSERVED") notObserved++;
      await finish(client, item.id, {
        ...result,
        expectedIdentity: expected.accountingIdentity,
        actualIdentity: actual ? { journalId: actual.journal_id, sourcePaymentId: item.paymentId } : null,
        expectedRevenue: expected.revenueCoa, actualRevenue: actual?.revenue_account ?? null,
        expectedTax: expected.taxOutputCoa, actualTax: actual?.tax_account ?? null,
        expectedBank: expected.bankCoa, actualBank: actual?.debit_account ?? null,
        expectedMdr: expected.mdr, actualMdr: payment.mdr_amount,
        expectedNet: expected.netSettlement, actualNet: actual ? round(Number(actual.gross_amount) - Number(payment.mdr_amount ?? 0)) : null,
        expectedDate: expected.settlementDate, actualDate: actual?.journal_date ?? null,
        evidence: { projectCode: "sport_center", eventType: item.eventType, paymentType: payment.payment_type, gross: expected.gross },
      });
      compared++;
    } catch (error) {
      const message = asError(error);
      const deterministic = /BLOCKED_CONFIG|COMPANY_|PAYMENT_METHOD_|PROVIDER_|TAX_|COA_|BANK_|AMBIGUOUS|NOT_CONFIRMED|NOT_FOUND|INVALID_PAYMENT/i.test(message);
      if (deterministic) {
        manualReview++;
        await finish(client, item.id, {
          status: "MANUAL_REVIEW", comparisonClass: "deterministic_observer_failure",
          error: message, evidence: { paymentId: item.paymentId, eventType: item.eventType },
        });
      } else {
        await client.query(
          `UPDATE sport_center.shadow_observer_comparisons
              SET comparison_status = 'pending', last_error = $2, updated_at = NOW()
            WHERE id = $1`,
          [item.id, message],
        );
      }
    }
  }
  return { claimed: claims.length, compared, manualReview, notObserved };
}

export function shadowObserverZeroEffectContract(): readonly string[] {
  return ZERO_EFFECT_TABLES;
}

export function startSportCenterShadowObserver(): void {
  if (getSportCenterFinanceMode() !== "shadow") return;
  // A shadow window must always have a real activation cutoff. Without an
  // explicit timestamp, treating the cutoff as null would replay every
  // historical payment on the first tick. Capture the process activation
  // time once and reuse it for every retry in this window.
  const activationTimestamp = configuredStart({}) ?? new Date().toISOString();
  const tick = async () => {
    const db = getPool();
    if (!db) return;
    const client = await db.connect();
    try {
      await observeSportCenterShadow({
        client,
        shadowStartedAt: activationTimestamp,
      });
    } catch {
      // Pending/failed comparison metadata is retried on the next tick.
    } finally {
      client.release();
    }
  };
  setTimeout(() => void tick(), 5_000).unref();
  setInterval(() => void tick(), 10_000).unref();
}