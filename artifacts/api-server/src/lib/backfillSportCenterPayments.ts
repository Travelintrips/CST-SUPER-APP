import { db } from "@workspace/db";
import { sql } from "drizzle-orm";
import { logger } from "./logger";
import { ingestModulePayment } from "./ingestModulePayment.js";

export interface BackfillSportCenterResult {
  total: number;
  posted: number;
  skipped: number;
  errors: number;
  entriesLinked: number;
  entriesMissing: number;
}

/**
 * Backfill accounting_payments for sport_payments that were confirmed (status='paid')
 * but never got an accounting_payments row — typically because cash_journal_id / bank_journal_id
 * was null in accounting_settings at the time of payment.
 *
 * Covers ALL payment_type values (booking + membership + other).
 * Does NOT filter on posting_status — a payment can be incorrectly marked 'posted'
 * while no accounting_payments row was ever created (the exact pre-fix bug).
 * The authoritative guard is: NOT EXISTS (accounting_payments WHERE source_doc_id = sp.id).
 *
 * Idempotent — safe to run multiple times.
 */
export async function backfillSportCenterAccountingPayments(): Promise<BackfillSportCenterResult> {
  const missing = await db.execute(sql`
    SELECT
      sp.id            AS sport_payment_id,
      sp.company_id,
      sp.payment_number,
      sp.amount,
      sp.method,
      sp.payment_type,
      sp.paid_at,
      sp.member_id,
      sb.booking_number,
      sb.customer_name  AS booking_customer_name,
      sm.name           AS member_name,
      sb.booking_date
    FROM sport_payments sp
    LEFT JOIN sport_bookings sb ON sb.id = sp.booking_id
    LEFT JOIN sport_members  sm ON sm.id = sp.member_id
    WHERE sp.status = 'paid'
      AND NOT EXISTS (
        SELECT 1 FROM accounting_payments ap
        WHERE ap.source_type = 'sport_center'
          AND ap.source_doc_id = sp.id
      )
    ORDER BY sp.id
  `);

  const rows = missing.rows as Array<Record<string, unknown>>;
  if (rows.length === 0) {
    logger.info("[backfill] Sport Center: no missing accounting_payments — nothing to do");
    return { total: 0, posted: 0, skipped: 0, errors: 0, entriesLinked: 0, entriesMissing: 0 };
  }

  logger.info(`[backfill] Found ${rows.length} sport_payment(s) without accounting_payment — backfilling...`);

  let posted = 0;
  let skipped = 0;
  let errors = 0;

  for (const row of rows) {
    const sportPaymentId = Number(row["sport_payment_id"]);
    try {
      const companyId = Number(row["company_id"] ?? 1);
      const amount = Number(row["amount"] ?? 0);
      const method = String(row["method"] ?? "cash");
      const paymentType = String(row["payment_type"] ?? "booking");

      // Resolve best display name: booking customer > member name > fallback
      const partnerName =
        String(row["booking_customer_name"] ?? row["member_name"] ?? "").trim() || null;

      // Resolve best ref code
      const ref = String(row["booking_number"] ?? row["payment_number"] ?? "").trim() || null;

      // Resolve date: paid_at preferred, then booking_date, then today
      const payDate = row["paid_at"]
        ? String(row["paid_at"]).slice(0, 10)
        : row["booking_date"]
        ? String(row["booking_date"]).slice(0, 10)
        : new Date().toISOString().slice(0, 10);

      const isMembership = paymentType === "membership";
      const description = isMembership
        ? `Sport Center membership: ${ref ?? sportPaymentId}`
        : `Sport Center booking: ${ref ?? sportPaymentId}`;

      const result = await ingestModulePayment({
        moduleType: "sport_center",
        sourceDocId: sportPaymentId,
        companyId,
        amount,
        method,
        partnerName,
        date: payDate,
        ref: ref ?? String(sportPaymentId),
        description,
        actorId: "SYSTEM_BACKFILL",
      });

      if (result.alreadyPosted) {
        skipped++;
        logger.debug(`[backfill] SKIP sp.id=${sportPaymentId}: already posted`);
      } else if (result.ok) {
        posted++;
        logger.info(
          `[backfill] CREATED accounting_payment | sp.id=${sportPaymentId} | type=${paymentType} | amount=${amount}`,
        );
      } else {
        errors++;
        logger.warn(`[backfill] FAILED sp.id=${sportPaymentId}: ${result.error}`);
      }
    } catch (err) {
      errors++;
      logger.warn(
        { err, sportPaymentId },
        "[backfill] Failed to backfill one sport_payment — skipping",
      );
    }
  }

  // ── Verification: count accounting_payments that still lack accounting_entries linkage ───
  const verifyRes = await db.execute(sql`
    SELECT
      COUNT(*) FILTER (WHERE ap.entry_id IS NOT NULL)::int AS linked,
      COUNT(*) FILTER (WHERE ap.entry_id IS NULL)::int     AS missing
    FROM accounting_payments ap
    WHERE ap.source_type = 'sport_center'
  `);
  const verRow = verifyRes.rows[0] as Record<string, unknown> | undefined;
  const entriesLinked = Number(verRow?.["linked"] ?? 0);
  const entriesMissing = Number(verRow?.["missing"] ?? 0);

  if (entriesMissing > 0) {
    logger.warn(
      { entriesMissing },
      "[backfill] Some accounting_payments still have no linked accounting_entry " +
        "(entry_id IS NULL). These need journal settings (cash_journal_id / bank_journal_id) " +
        "configured in Accounting → Settings before the entry can be created.",
    );
  } else {
    logger.info(
      { entriesLinked },
      "[backfill] Verification: all sport_center accounting_payments have linked accounting_entries ✓",
    );
  }

  const result: BackfillSportCenterResult = {
    total: rows.length,
    posted,
    skipped,
    errors,
    entriesLinked,
    entriesMissing,
  };

  logger.info(result, "[backfill] Sport Center accounting payments backfill complete");
  return result;
}
