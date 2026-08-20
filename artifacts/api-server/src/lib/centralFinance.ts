import pg from "pg";
import { isCentralFinanceMode, getSportCenterFinanceMode } from "./financeBoundary.js";

type Claim = { id: number; outboxId: number; paymentId: number; correlationId: string };

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

async function ensureProcessingRows(client: pg.Pool): Promise<void> {
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

async function claimBatch(client: pg.Pool): Promise<Claim[]> {
  const tx = await client.connect();
  try {
    await tx.query("BEGIN");
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
    await tx.query("COMMIT");
    return claims;
  } catch (error) {
    await tx.query("ROLLBACK").catch(() => {});
    throw error;
  } finally {
    tx.release();
  }
}

async function finish(client: pg.Pool, claim: Claim, status: "posted" | "failed" | "manual_review", error?: unknown) {
  const message = error == null ? null : String(error instanceof Error ? error.message : error).slice(0, 1000);
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

export async function processCentralFinance(): Promise<{
  claimed: number;
  posted: number;
  retried: number;
  manualReview: number;
}> {
  const db = getPool();
  if (!db || !isCentralFinanceMode() || process.env.NODE_ENV === "production") {
    return { claimed: 0, posted: 0, retried: 0, manualReview: 0 };
  }

  await ensureProcessingRows(db);
  const claims = await claimBatch(db);
  let posted = 0;
  let retried = 0;
  let manualReview = 0;
  for (const claim of claims) {
    try {
      // The database function owns shared config, tax, COA, journal and
      // payment-level idempotency. This layer only orchestrates the durable event.
      await db.query("SELECT sport_center.create_payment_accounting_draft($1)", [claim.paymentId]);
      await finish(db, claim, "posted");
      posted++;
    } catch (error) {
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