import pg from "pg";
import { isCentralFinanceMode, getSportCenterFinanceMode } from "./financeBoundary.js";

type Claim = { id: number; outboxId: number; paymentId: number; correlationId: string };
type QueryClient = Pick<pg.Pool, "query">;

let pool: pg.Pool | null = null;

function getPool(): pg.Pool | null {
  if (!process.env.SUPABASE_DATABASE_URL_DEV) return null;
  pool ??= new pg.Pool({
    connectionString: process.env.SUPABASE_DATABASE_URL_DEV,
    ssl: { rejectUnauthorized: false },
    max: 2,
  });
  return pool;
}

function isDeterministicConfigError(message: string): boolean {
  return /BLOCKED_CONFIG|COMPANY_|PAYMENT_METHOD_|PROVIDER_|TAX_|COA_|BANK_|AMBIGUOUS|NOT_CONFIRMED|NOT_FOUND/i.test(message);
}

async function ensureProcessingRows(client: QueryClient): Promise<void> {
  await client.query(`
    INSERT INTO sport_center.central_finance_processing
      (source_project, source_payment_id, event_type, correlation_id)
    SELECT o.source_project, o.payment_id, o.event_type,
           COALESCE(o.correlation_id, 'sc_payment_' || o.payment_id::text)
      FROM sport_center.payment_accounting_outbox o
     WHERE o.event_type = 'payment_confirmed'
    ON CONFLICT (source_project, source_payment_id, event_type) DO NOTHING
  `);
}

async function claimBatch(client: QueryClient, transactionClient?: pg.PoolClient): Promise<Claim[]> {
  const clientCanConnect = typeof (client as pg.Pool).connect === "function";
  const tx = transactionClient ??
    (clientCanConnect ? await (client as pg.Pool).connect() : client as pg.PoolClient);
  if (!tx) throw new Error("CENTRAL_FINANCE_CLIENT_INVALID");
  const managesTransaction = transactionClient == null && clientCanConnect;
  try {
    if (managesTransaction) await tx.query("BEGIN");
    const result = await tx.query(`
      SELECT c.id, o.id AS outbox_id, c.source_payment_id,
             c.correlation_id
        FROM sport_center.central_finance_processing c
        JOIN sport_center.payment_accounting_outbox o
          ON o.payment_id = c.source_payment_id
         AND o.event_type = c.event_type
       WHERE c.status IN ('pending', 'failed')
         AND c.available_at <= NOW()
         AND (c.locked_at IS NULL OR c.locked_at < NOW() - INTERVAL '15 minutes')
         AND o.status <> 'posted'
       ORDER BY c.id
       FOR UPDATE OF c SKIP LOCKED
       LIMIT 50
    `);
    const claims: Claim[] = result.rows.map((row) => ({
      id: Number(row.id),
      outboxId: Number(row.outbox_id),
      paymentId: Number(row.source_payment_id),
      correlationId: String(row.correlation_id),
    }));
    if (claims.length) {
      await tx.query(
        `UPDATE sport_center.central_finance_processing
            SET status = 'processing', attempts = attempts + 1,
                locked_at = NOW(), updated_at = NOW()
          WHERE id = ANY($1::int[])`,
        [claims.map((claim) => claim.id)],
      );
      await tx.query(
        `UPDATE sport_center.payment_accounting_outbox
            SET status = 'processing', attempts = attempts + 1,
                locked_at = NOW(), updated_at = NOW()
          WHERE id = ANY($1::int[]) AND status <> 'posted'`,
        [claims.map((claim) => claim.outboxId)],
      );
    }
    if (managesTransaction) await tx.query("COMMIT");
    return claims;
  } catch (error) {
    if (managesTransaction) await tx.query("ROLLBACK").catch(() => {});
    throw error;
  } finally {
    if (managesTransaction) tx.release();
  }
}

async function finish(client: QueryClient, claim: Claim, status: "posted" | "failed" | "manual_review", error?: unknown) {
  const message = error == null ? null : (() => {
    if (!(error instanceof Error)) return String(error).slice(0, 1000);
    const detail = error as Error & {
      detail?: string;
      constraint?: string;
      table?: string;
      column?: string;
      where?: string;
    };
    return [
      detail.message,
      detail.detail && `detail=${detail.detail}`,
      detail.constraint && `constraint=${detail.constraint}`,
      detail.table && `table=${detail.table}`,
      detail.column && `column=${detail.column}`,
      detail.where && `where=${detail.where}`,
    ].filter(Boolean).join(" | ").slice(0, 1000);
  })();
  const retryAt = status === "failed" ? "NOW() + LEAST(INTERVAL '1 hour', INTERVAL '5 minutes' * GREATEST(attempts, 1))" : "NOW()";
  await client.query(
    `UPDATE sport_center.central_finance_processing
        SET status = $2, processed_at = CASE WHEN $2 = 'posted' THEN NOW() ELSE processed_at END,
            available_at = ${retryAt}, locked_at = NULL, last_error = $3,
            updated_at = NOW()
      WHERE id = $1`,
    [claim.id, status, message],
  );
  await client.query(
    `UPDATE sport_center.payment_accounting_outbox
        SET status = $2, processed_at = CASE WHEN $2 = 'posted' THEN NOW() ELSE processed_at END,
            available_at = ${retryAt}, locked_at = NULL, last_error = $3,
            updated_at = NOW()
      WHERE id = $1`,
    [claim.outboxId, status, message],
  );
}

async function createAndFinalizeSettlement(client: QueryClient, claim: Claim): Promise<void> {
  const payment = await client.query<{
    company_id: number;
    payment_method: string;
    provider_code: string | null;
    bank_account_id: string | null;
    settlement_date: string | null;
    settlement_rule_version: string | null;
  }>(
    `SELECT company_id,
            payment_method::text AS payment_method,
            payment_provider::text AS provider_code,
            bank_account_id::text AS bank_account_id,
            expected_settlement_date::text AS settlement_date,
            settlement_rule_version
       FROM sport_center.sport_payments
      WHERE id = $1`,
    [claim.paymentId],
  );
  const row = payment.rows[0];
  if (!row) throw new Error(`SPORT_PAYMENT_NOT_FOUND: ${claim.paymentId}`);
  if (!row.provider_code || !row.bank_account_id || !row.settlement_date) {
    throw new Error(`BLOCKED_CONFIG_MISSING: settlement identity for payment=${claim.paymentId}`);
  }

  let batch;
  await client.query("SAVEPOINT settlement_batch_attempt");
  try {
    batch = await client.query<{ settlement_id: string }>(
      `SELECT sport_center.create_payment_settlement_batch(
         $1, $2, $3, $4, $5::date, $6::integer[], $7
       ) AS settlement_id`,
      [
        claim.correlationId,
        row.company_id,
        row.provider_code,
        row.bank_account_id,
        row.settlement_date,
        [claim.paymentId],
        "central-finance-processor",
      ],
    );
    await client.query("RELEASE SAVEPOINT settlement_batch_attempt");
  } catch (error) {
    const message = String(error instanceof Error ? error.message : error);
    await client.query("ROLLBACK TO SAVEPOINT settlement_batch_attempt");
    if (!/CANONICAL_SETTLEMENT_IDEMPOTENCY_CONFLICT/i.test(message)) throw error;
    if (!row.settlement_rule_version) {
      throw new Error(`SETTLEMENT_RULE_VERSION_MISSING: payment=${claim.paymentId}`);
    }
    batch = await client.query<{ settlement_id: string }>(
      `SELECT sport_center.create_payment_settlement_supplemental_batch(
         $1, $2, $3, $4::date, $5, $6::integer[], $7
       ) AS settlement_id`,
      [
        row.company_id,
        row.provider_code,
        row.bank_account_id,
        row.settlement_date,
        row.settlement_rule_version,
        [claim.paymentId],
        "central-finance-processor",
      ],
    );
    await client.query("RELEASE SAVEPOINT settlement_batch_attempt");
  }
  const settlementId = batch.rows[0]?.settlement_id;
  if (!settlementId) throw new Error(`SETTLEMENT_BATCH_NOT_CREATED: payment=${claim.paymentId}`);

  const config = await client.query<{ receiving_bank_coa_code: string }>(
    `SELECT receiving_bank_coa_code
       FROM sport_center.resolve_shared_finance_config(
         'sport_center', $1, $2, $3, $4::date
       )`,
    [row.company_id, row.payment_method, row.provider_code, row.settlement_date],
  );
  const bankCoaCode = config.rows[0]?.receiving_bank_coa_code;
  if (!bankCoaCode) {
    throw new Error(`BANK_COA_CODE_MISSING: payment=${claim.paymentId}`);
  }
  await client.query(
    `SELECT sport_center.create_settlement_journal_draft($1::bigint, $2, $3)`,
    [settlementId, bankCoaCode, "central-finance-processor"],
  );
  await client.query(
    `SELECT sport_center.finalize_payment_settlement($1::bigint, $2)`,
    [settlementId, "central-finance-processor"],
  );
  await client.query(
    `SELECT sport_center.ensure_canonical_bank_mutation_for_settlement($1::bigint, $2)`,
    [settlementId, "central-finance-processor"],
  );
}

async function promoteCanonicalPaymentJournal(client: QueryClient, paymentId: number): Promise<void> {
  const promoted = await client.query<{ id: number }>(
    `UPDATE sport_center.accounting_journals j
        SET status = 'posted',
            posted_by = COALESCE(j.posted_by, 'central-finance-processor'),
            posted_at = COALESCE(j.posted_at, NOW()),
            updated_at = NOW()
      WHERE j.payment_id = $1
        AND j.journal_type = 'payment_confirmed'
        AND j.is_reversal = FALSE
        AND j.status = 'draft'
        AND j.debit_amount = j.credit_revenue_amount + j.credit_ppn_amount
        AND (
          SELECT COUNT(*)
            FROM sport_center.accounting_journal_lines l
           WHERE l.journal_id = j.id
        ) >= 2
      RETURNING j.id`,
    [paymentId],
  );
  if (!promoted.rows[0]) {
    throw new Error(`ACCOUNTING_JOURNAL_NOT_POSTABLE: payment=${paymentId}`);
  }
}

export async function processCentralFinance(options: { client?: pg.PoolClient } = {}): Promise<{
  claimed: number;
  posted: number;
  retried: number;
  manualReview: number;
}> {
  const db = options.client ?? getPool();
  if (!db || !isCentralFinanceMode() || process.env.NODE_ENV === "production") {
    return { claimed: 0, posted: 0, retried: 0, manualReview: 0 };
  }

  await ensureProcessingRows(db);
  const claims = await claimBatch(db, options.client);
  let posted = 0;
  let retried = 0;
  let manualReview = 0;
  for (const claim of claims) {
    try {
      await db.query("SAVEPOINT central_finance_claim");
      // The database function owns shared config, tax, COA, journal and
      // payment-level idempotency. This layer only orchestrates the durable event.
      await db.query("SELECT sport_center.create_payment_accounting_draft($1)", [claim.paymentId]);
      await promoteCanonicalPaymentJournal(db, claim.paymentId);
      await createAndFinalizeSettlement(db, claim);
      await finish(db, claim, "posted");
      await db.query("RELEASE SAVEPOINT central_finance_claim");
      posted++;
    } catch (error) {
      await db.query("ROLLBACK TO SAVEPOINT central_finance_claim").catch(() => {});
      const status = isDeterministicConfigError(String(error instanceof Error ? error.message : error))
        ? "manual_review"
        : "failed";
      await finish(db, claim, status, error);
      if (status === "manual_review") manualReview++;
      else retried++;
    }
  }
  return { claimed: claims.length, posted, retried, manualReview };
}

export function centralFinanceModeForDiagnostics(): string {
  return getSportCenterFinanceMode();
}

export function startCentralFinanceProcessor(): void {
  if (!isCentralFinanceMode() || process.env.NODE_ENV === "production") return;
  const tick = () => {
    void processCentralFinance().catch(() => {});
  };
  setTimeout(tick, 5_000).unref();
  setInterval(tick, 10_000).unref();
}