import { sql } from "drizzle-orm";
import type { DbClient } from "../accounting.js";

export const SPORT_PAYMENT_ALREADY_IN_CANONICAL_SETTLEMENT =
  "SPORT_PAYMENT_ALREADY_IN_CANONICAL_SETTLEMENT";

/**
 * A candidate snapshot may have been written before the canonical source
 * cutover.  In that case its numeric paymentId is the public mirror ID, while
 * paymentNumber still carries the stable SCPAY-SC-{canonical id} bridge.
 */
export function canonicalSportPaymentIdFromPaymentNumber(
  paymentNumber: unknown,
): number | null {
  const value = String(paymentNumber ?? "").trim();
  const match = /^SCPAY-SC-([0-9]+)$/.exec(value);
  if (!match) return null;
  const id = Number(match[1]);
  return Number.isSafeInteger(id) && id > 0 ? id : null;
}

export type CandidatePaymentIdentity = {
  paymentId: number;
  paymentNumber?: unknown;
};

export type PublicSportPaymentIdentity = {
  id: number;
  paymentNumber?: unknown;
};

/**
 * Resolve candidate payment identities before any canonical settlement query.
 *
 * The bridge in paymentNumber is authoritative. A public mirror lookup is only
 * a compatibility fallback for older snapshots that did not persist the
 * payment number. Missing or conflicting bridges fail closed instead of
 * allowing a mirror ID to select an unrelated canonical payment.
 */
export function resolveCanonicalCandidatePaymentIds(
  items: readonly CandidatePaymentIdentity[],
  publicMirrorRows: readonly PublicSportPaymentIdentity[] = [],
): number[] {
  const publicMirrorById = new Map(
    publicMirrorRows.map((row) => [row.id, row.paymentNumber]),
  );
  const resolved = items.map((item) => {
    if (!Number.isSafeInteger(item.paymentId) || item.paymentId <= 0) {
      throw new Error("Candidate payment ID is not a positive safe integer.");
    }

    const persistedPaymentNumber = String(item.paymentNumber ?? "").trim();
    const bridgeValue = persistedPaymentNumber || String(
      publicMirrorById.get(item.paymentId) ?? "",
    ).trim();
    const canonicalId = canonicalSportPaymentIdFromPaymentNumber(bridgeValue);

    if (!canonicalId) {
      throw new Error(
        `Canonical payment bridge is missing for candidate payment ${item.paymentId}.`,
      );
    }

    return canonicalId;
  });

  if (new Set(resolved).size !== resolved.length) {
    throw new Error("Candidate payment items resolve to duplicate canonical payments.");
  }
  return resolved;
}

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