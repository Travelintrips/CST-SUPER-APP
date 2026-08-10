import { sql } from "drizzle-orm";
import type { DbClient } from "../accounting.js";

export const SPORT_PAYMENT_ALREADY_IN_CANONICAL_SETTLEMENT =
  "SPORT_PAYMENT_ALREADY_IN_CANONICAL_SETTLEMENT";

/**
 * The reconciliation candidate table is the trigger-owned public mirror.
 * SCPAY-SC-{id} is the stable bridge back to sport_center.sport_payments.id.
 */
export function canonicalSportPaymentIdExpression(
  publicPaymentAlias: string,
): string {
  if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(publicPaymentAlias)) {
    throw new Error("Invalid public Sport Center payment alias");
  }

  return `CASE
    WHEN ${publicPaymentAlias}.payment_number ~ '^SCPAY-SC-[0-9]+$'
    THEN SUBSTRING(${publicPaymentAlias}.payment_number FROM 10)::bigint
    ELSE NULL
  END`;
}

/**
 * Frozen Phase 4C-4 predicate. The payment ID expression must resolve to the
 * canonical sport_center.sport_payments.id, not the public mirror ID.
 */
export function activeCanonicalSettlementPredicate(
  canonicalPaymentIdExpression: string,
): string {
  // This expression is assembled only by canonicalSportPaymentIdExpression()
  // inside this module; it is never copied from request input.
  if (!canonicalPaymentIdExpression.trim().startsWith("CASE")) {
    throw new Error("Invalid canonical Sport Center payment ID expression");
  }

  return `EXISTS (
    SELECT 1
    FROM sport_center.payment_settlement_items psi
    JOIN sport_center.payment_settlement_batches psb
      ON psb.id = psi.settlement_id
    WHERE psi.payment_id = ${canonicalPaymentIdExpression}
      AND psi.item_status = 'active'
      AND psb.status IN ('posted', 'reconciled')
  )`;
}

export function sportPaymentCanonicalSettlementExclusionSql(
  publicPaymentAlias = "sp",
): string {
  return `NOT ${activeCanonicalSettlementPredicate(
    canonicalSportPaymentIdExpression(publicPaymentAlias),
  )}`;
}

/**
 * Revalidate membership inside the caller's approval transaction.
 *
 * The public mirror row is selected with FOR UPDATE so a concurrent local
 * candidate operation cannot change the mirror identity while this check runs.
 * The canonical settlement tables are read-only here.
 */
export async function isSportPaymentInActiveCanonicalSettlement(
  client: DbClient,
  publicSportPaymentId: number,
): Promise<boolean> {
  if (!Number.isSafeInteger(publicSportPaymentId) || publicSportPaymentId <= 0) {
    return false;
  }

  const publicAlias = "sp";
  const canonicalPaymentId = canonicalSportPaymentIdExpression(publicAlias);
  const predicate = activeCanonicalSettlementPredicate(canonicalPaymentId);
  const { rows } = await client.execute(sql.raw(`
    SELECT ${predicate} AS is_excluded
    FROM public.sport_payments ${publicAlias}
    WHERE ${publicAlias}.id = ${publicSportPaymentId}
    FOR UPDATE
  `));

  return Boolean((rows[0] as any)?.is_excluded);
}