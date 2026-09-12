import { sql } from "drizzle-orm";
import type { DbClient } from "../accounting.js";

export type CanonicalSettlementRecoveryResult = {
  settlement_id: number;
  public_mutation_id: number;
  canonical_mutation_id: number;
  match_id: number;
  old_net_amount: number;
  recovered_net_amount: number;
  adjustment_amount: number;
  settlement_status: string;
  public_mutation_status: string;
  canonical_mutation_status: string;
  idempotent: boolean;
};

/**
 * Call the database-owned posted-settlement recovery routine.
 *
 * The routine is deliberately not reimplemented in TypeScript: it must lock
 * the batch, payment items, public mutation, canonical mirror, and journal in
 * one transaction so recovery cannot race generic reconciliation.
 */
export async function recoverPostedSettlementFromBankMutation(
  client: DbClient,
  input: {
    settlementId: number;
    publicMutationId: number;
    actor: string;
  },
): Promise<CanonicalSettlementRecoveryResult> {
  if (
    !Number.isSafeInteger(input.settlementId) ||
    input.settlementId <= 0 ||
    !Number.isSafeInteger(input.publicMutationId) ||
    input.publicMutationId <= 0
  ) {
    throw new Error("Settlement dan mutasi bank harus berupa ID positif.");
  }

  const actor = String(input.actor ?? "").trim();
  if (!actor) throw new Error("Actor recovery wajib diisi.");

  const result = await client.execute(sql`
    SELECT *
    FROM sport_center.recover_posted_settlement_from_bank_mutation(
      ${input.settlementId},
      ${input.publicMutationId},
      ${actor}
    )
  `);

  const row = result.rows[0] as Record<string, unknown> | undefined;
  if (!row) {
    throw new Error("Owner recovery tidak mengembalikan hasil.");
  }

  return {
    settlement_id: Number(row.settlement_id),
    public_mutation_id: Number(row.public_mutation_id),
    canonical_mutation_id: Number(row.canonical_mutation_id),
    match_id: Number(row.match_id),
    old_net_amount: Number(row.old_net_amount),
    recovered_net_amount: Number(row.recovered_net_amount),
    adjustment_amount: Number(row.adjustment_amount),
    settlement_status: String(row.settlement_status),
    public_mutation_status: String(row.public_mutation_status),
    canonical_mutation_status: String(row.canonical_mutation_status),
    idempotent: Boolean(row.idempotent),
  };
}