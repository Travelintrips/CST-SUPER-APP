import { sql } from "drizzle-orm";
import type { DbClient } from "../accounting.js";

export type CanonicalSettlementCorrectionInput = {
  settlementId: number;
  expectedBankMutationId: number;
  replacementPaymentIds: number[];
  actor: string;
  reason: string;
};

export type CanonicalSettlementCorrectionResult = {
  ok: true;
  idempotent: boolean;
  settlementId: number;
  reversedSettlementJournalId: number;
  replacementPaymentIds: number[];
  bankMutationId: number | null;
  settlementStatus: "reversed";
  bankMutationStatus: "unmatched" | "unchanged";
};

function quoteIdentifier(identifier: string): string {
  return `"${identifier.replaceAll(`"`, `""`)}"`;
}

function escapeSql(value: string): string {
  return value.replaceAll("'", "''");
}

function asPositiveInt(value: unknown): number {
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed <= 0) {
    throw new Error("ID harus berupa bilangan bulat positif.");
  }
  return parsed;
}

/**
 * Reverse a canonical settlement whose payment membership was wrong.
 *
 * This is deliberately a correction boundary, not a generic "edit posted"
 * helper:
 * - the original posted journal is never updated or deleted;
 * - a balanced reversal journal is copied from its exact lines;
 * - all state changes are serialized in one transaction;
 * - the replacement selection is recorded but not auto-approved.
 *
 * The caller can subsequently run the normal canonical builder and approval
 * workflow with the returned replacement IDs. Keeping those steps separate
 * prevents an incomplete replacement from silently becoming a settlement.
 */
export async function reverseCanonicalSettlementForCorrection(
  client: DbClient,
  input: CanonicalSettlementCorrectionInput,
): Promise<CanonicalSettlementCorrectionResult> {
  const settlementId = asPositiveInt(input.settlementId);
  const expectedBankMutationId = asPositiveInt(input.expectedBankMutationId);
  const rawReplacementPaymentIds = input.replacementPaymentIds.map(asPositiveInt);
  const replacementPaymentIds = [...new Set(rawReplacementPaymentIds)];
  const actor = String(input.actor ?? "").trim();
  const reason = String(input.reason ?? "").trim();

  if (!actor) throw new Error("Actor correction wajib diisi.");
  if (reason.length < 10 || reason.length > 2000) {
    throw new Error("Alasan correction wajib diisi antara 10 dan 2000 karakter.");
  }
  if (replacementPaymentIds.length === 0) {
    throw new Error("Replacement payment wajib diisi.");
  }
  if (replacementPaymentIds.length !== rawReplacementPaymentIds.length) {
    throw new Error("Replacement payment tidak boleh memuat ID duplikat.");
  }

  return client.transaction(async (tx) => {
    const batchResult = await tx.execute(sql`
      SELECT
        id, company_id, status::text AS status, bank_mutation_id,
        canonical_bank_mutation_id, settlement_journal_id
      FROM sport_center.payment_settlement_batches
      WHERE id = ${settlementId}
      FOR UPDATE
    `);
    const batch = batchResult.rows[0] as Record<string, unknown> | undefined;
    if (!batch) throw new Error(`Settlement canonical #${settlementId} tidak ditemukan.`);

    const batchStatus = String(batch.status ?? "").toLowerCase();
    const bankMutationId = batch.bank_mutation_id == null
      ? null
      : asPositiveInt(batch.bank_mutation_id);
    const journalId = asPositiveInt(batch.settlement_journal_id);

    const reversalResult = await tx.execute(sql`
      SELECT id
      FROM sport_center.accounting_journals
      WHERE settlement_batch_id::text = ${String(settlementId)}
        AND journal_type = 'settlement'
        AND is_reversal = TRUE
        AND status = 'posted'
        AND notes LIKE ${`%CANONICAL_MEMBERSHIP_CORRECTION:${settlementId}%`}
      ORDER BY id DESC
      LIMIT 1
      FOR UPDATE
    `);
    const existingReversal = reversalResult.rows[0] as Record<string, unknown> | undefined;
    if (existingReversal) {
      return {
        ok: true,
        idempotent: true,
        settlementId,
        reversedSettlementJournalId: asPositiveInt(existingReversal.id),
        replacementPaymentIds,
        bankMutationId,
        settlementStatus: "reversed",
        bankMutationStatus: bankMutationId == null ? "unchanged" : "unmatched",
      };
    }

    if (batchStatus !== "reconciled") {
      throw new Error(
        "Membership correction hanya boleh dimulai dari batch canonical reconciled; "
        + "batch posted tanpa link memakai workflow historical repair.",
      );
    }
    if (bankMutationId == null || batch.canonical_bank_mutation_id == null) {
      throw new Error("Batch reconciled tidak memiliki link bank canonical yang lengkap.");
    }
    if (bankMutationId !== expectedBankMutationId) {
      throw new Error("mutationId tidak sama dengan link bank canonical settlement.");
    }
    if (asPositiveInt(batch.canonical_bank_mutation_id) !== bankMutationId) {
      throw new Error("Link bank canonical batch tidak konsisten.");
    }

    const journalResult = await tx.execute(sql`
      SELECT *
      FROM sport_center.accounting_journals
      WHERE id = ${journalId}
      FOR UPDATE
    `);
    const journal = journalResult.rows[0] as Record<string, unknown> | undefined;
    if (
      !journal
      || String(journal.status ?? "").toLowerCase() !== "posted"
      || String(journal.journal_type ?? "").toLowerCase() !== "settlement"
      || journal.is_reversal !== false
      || asPositiveInt(journal.settlement_batch_id) !== settlementId
    ) {
      throw new Error(
        "Settlement journal tidak eligible: harus posted, settlement, non-reversal, dan menunjuk batch yang sama.",
      );
    }

    const activeItemsResult = await tx.execute(sql`
      SELECT payment_id
      FROM sport_center.payment_settlement_items
      WHERE settlement_id = ${settlementId}
        AND item_status = 'active'
      ORDER BY payment_id
      FOR UPDATE
    `);
    if (activeItemsResult.rows.length === 0) {
      throw new Error("Batch canonical tidak memiliki active payment item.");
    }

    const paymentIdList = replacementPaymentIds.join(",");
    const replacementResult = await tx.execute(sql.raw(`
      SELECT
        p.id,
        p.company_id,
        p.amount,
        p.status::text AS payment_status,
        p.settlement_status::text AS settlement_status,
        p.payment_method::text AS payment_method,
        p.payment_provider::text AS payment_provider,
        p.bank_account_id::text AS bank_account_id,
        p.paid_at,
        p.expected_settlement_date::text AS expected_settlement_date,
        p.settlement_rule_version
      FROM sport_center.sport_payments p
      WHERE p.id IN (${paymentIdList})
      ORDER BY p.id
      FOR UPDATE
    `));
    if (replacementResult.rows.length !== replacementPaymentIds.length) {
      throw new Error("Satu atau lebih replacement payment tidak ditemukan.");
    }

    const batchCompanyId = Number(batch.company_id);
    const batchDateResult = await tx.execute(sql`
      SELECT settlement_date::text AS settlement_date,
             lower(provider_code) AS provider_code,
             bank_account_id::text AS bank_account_id,
             settlement_rule_version
      FROM sport_center.payment_settlement_batches
      WHERE id = ${settlementId}
    `);
    const identity = batchDateResult.rows[0] as Record<string, unknown> | undefined;
    if (!identity) throw new Error("Identitas settlement tidak ditemukan.");

    for (const row of replacementResult.rows as Array<Record<string, unknown>>) {
      if (
        Number(row.company_id) !== batchCompanyId
        || String(row.payment_status ?? "").toLowerCase() !== "confirmed"
        || !String(row.payment_method ?? "").toLowerCase().includes("qris")
        || String(row.expected_settlement_date ?? "").slice(0, 10)
          !== String(identity.settlement_date ?? "").slice(0, 10)
        || row.paid_at == null
        || String(row.paid_at).slice(0, 10) === ""
        || String(row.settlement_rule_version ?? "") !== String(identity.settlement_rule_version ?? "")
        || String(row.payment_provider ?? "").toLowerCase() !== String(identity.provider_code ?? "").toLowerCase()
        || String(row.bank_account_id ?? "") !== String(identity.bank_account_id ?? "")
      ) {
        throw new Error(
          `Replacement payment ${row.id} tidak cocok dengan company/provider/rekening/tanggal/rule batch.`,
        );
      }
    }
    const hMinusOneResult = await tx.execute(sql.raw(`
      SELECT COUNT(*)::int AS invalid_count
      FROM sport_center.sport_payments
      WHERE id IN (${paymentIdList})
        AND (
          paid_at IS NULL
          OR ((paid_at AT TIME ZONE 'Asia/Jakarta')::date + 1)
             <> (
               SELECT settlement_date::date
               FROM sport_center.payment_settlement_batches
               WHERE id = ${settlementId}
             )
        )
    `));
    if (Number((hMinusOneResult.rows[0] as Record<string, unknown>)?.invalid_count ?? 0) !== 0) {
      throw new Error("Replacement payment harus memenuhi aturan H-1 terhadap settlement batch.");
    }

    const conflictsResult = await tx.execute(sql.raw(`
      SELECT i.payment_id, i.settlement_id
      FROM sport_center.payment_settlement_items i
      JOIN sport_center.payment_settlement_batches b
        ON b.id = i.settlement_id
      WHERE i.payment_id IN (${paymentIdList})
        AND i.item_status = 'active'
        AND i.settlement_id <> ${settlementId}
        AND b.status IN ('draft', 'calculated', 'posted', 'reconciled')
      LIMIT 1
      FOR UPDATE OF i, b
    `));
    if (conflictsResult.rows.length > 0) {
      const conflict = conflictsResult.rows[0] as Record<string, unknown>;
      throw new Error(
        `Replacement payment ${conflict.payment_id} sudah aktif di settlement #${conflict.settlement_id}.`,
      );
    }

    const publicMutationResult = await tx.execute(sql`
      SELECT id, status, journal_entry_id
      FROM public.bank_mutations
      WHERE id = ${bankMutationId}
      FOR UPDATE
    `);
    const publicMutation = publicMutationResult.rows[0] as Record<string, unknown> | undefined;
    if (!publicMutation) throw new Error(`Mutasi bank #${bankMutationId} tidak ditemukan.`);
    if (publicMutation.journal_entry_id != null) {
      throw new Error("Mutasi bank memiliki journal generic; correction dihentikan.");
    }
    if (!["approved", "matched", "auto_matched"].includes(
      String(publicMutation.status ?? "").toLowerCase(),
    )) {
      throw new Error("Status mutasi bank berubah; correction dihentikan.");
    }

    const matchResult = await tx.execute(sql`
      SELECT id, candidate_id, candidate_source, status
      FROM public.bank_reconciliation_matches
      WHERE mutation_id = ${bankMutationId}
        AND candidate_type = 'qris_settlement'
        AND candidate_id::text = ${String(settlementId)}
        AND candidate_source = 'sport_center.payment_settlement_batches'
        AND status IN ('approved', 'candidate')
      ORDER BY id
      LIMIT 2
      FOR UPDATE
    `);
    if (matchResult.rows.length !== 1) {
      throw new Error("Canonical bank match tidak tunggal untuk batch correction.");
    }

    // Clone the journal using the live catalog so this remains compatible with
    // additive columns in the Sport Center accounting schema. The original
    // posted row is never updated.
    const columnsResult = await tx.execute(sql`
      SELECT column_name
      FROM information_schema.columns
      WHERE table_schema = 'sport_center'
        AND table_name = 'accounting_journals'
        AND column_name <> 'id'
        AND is_generated = 'NEVER'
        AND is_identity = 'NO'
      ORDER BY ordinal_position
    `);
    const columns = (columnsResult.rows as Array<Record<string, unknown>>)
      .map((row) => String(row.column_name))
      .filter((column) => column !== "created_at" && column !== "updated_at");
    if (!columns.includes("status") || !columns.includes("is_reversal")) {
      throw new Error("Schema accounting journal tidak memiliki kolom reversal yang diperlukan.");
    }
    const selectExpressions = columns.map((column) => {
      if (column === "status") return `'draft' AS ${quoteIdentifier(column)}`;
      if (column === "is_reversal") return `TRUE AS ${quoteIdentifier(column)}`;
      if (column === "notes") {
        return `COALESCE(${quoteIdentifier(column)}, '') || ' CANONICAL_MEMBERSHIP_CORRECTION:${settlementId}' AS ${quoteIdentifier(column)}`;
      }
      if (column === "created_by") return `'${escapeSql(actor)}' AS ${quoteIdentifier(column)}`;
      return quoteIdentifier(column);
    }).join(", ");
    const columnList = columns.map(quoteIdentifier).join(", ");
    const reversalInsert = await tx.execute(sql.raw(`
      INSERT INTO sport_center.accounting_journals (${columnList})
      SELECT ${selectExpressions}
      FROM sport_center.accounting_journals
      WHERE id = ${journalId}
      RETURNING id
    `));
    const reversalJournalId = asPositiveInt(
      (reversalInsert.rows[0] as Record<string, unknown> | undefined)?.id,
    );

    await tx.execute(sql.raw(`
      INSERT INTO sport_center.accounting_journal_lines
        (journal_id, line_type, account_code, account_name, amount, description)
      SELECT
        ${reversalJournalId},
        CASE WHEN line_type = 'debit' THEN 'credit' ELSE 'debit' END,
        account_code,
        account_name,
        amount,
        'REVERSAL CANONICAL MEMBERSHIP CORRECTION: ' || COALESCE(description, '')
      FROM sport_center.accounting_journal_lines
      WHERE journal_id = ${journalId}
    `));
    await tx.execute(sql`
      SELECT sport_center.validate_accounting_journal(${reversalJournalId})
    `);
    await tx.execute(sql`
      UPDATE sport_center.accounting_journals
      SET status = 'posted'
      WHERE id = ${reversalJournalId}
        AND status = 'draft'
    `);

    await tx.execute(sql`
      UPDATE sport_center.payment_settlement_items
      SET item_status = 'reversed'
      WHERE settlement_id = ${settlementId}
        AND item_status = 'active'
    `);
    await tx.execute(sql`
      UPDATE sport_center.sport_payments p
      SET settlement_status = 'unsettled',
          updated_at = NOW()
      WHERE p.id IN (
        SELECT DISTINCT payment_id
        FROM sport_center.payment_settlement_items
        WHERE settlement_id = ${settlementId}
      )
        AND NOT EXISTS (
          SELECT 1
          FROM sport_center.payment_settlement_items active_item
          JOIN sport_center.payment_settlement_batches active_batch
            ON active_batch.id = active_item.settlement_id
          WHERE active_item.payment_id = p.id
            AND active_item.item_status = 'active'
            AND active_batch.status IN ('draft', 'calculated', 'posted', 'reconciled')
        )
    `);
    await tx.execute(sql`
      UPDATE sport_center.payment_settlement_batches
      SET status = 'reversed',
          bank_mutation_id = NULL,
          canonical_bank_mutation_id = NULL,
          updated_at = NOW()
      WHERE id = ${settlementId}
        AND status = 'reconciled'
        AND bank_mutation_id = ${bankMutationId}
        AND canonical_bank_mutation_id = ${bankMutationId}
    `);
    await tx.execute(sql`
      UPDATE public.bank_reconciliation_matches
      SET status = 'superseded'
      WHERE id = ${(matchResult.rows[0] as Record<string, unknown>).id}
        AND status IN ('approved', 'candidate')
    `);
    await tx.execute(sql`
      UPDATE public.bank_mutations
      SET status = 'unmatched',
          approved_by = NULL,
          approved_at = NULL,
          posted_by = NULL,
          posted_at = NULL,
          updated_at = NOW()
      WHERE id = ${bankMutationId}
        AND status IN ('approved', 'matched', 'auto_matched')
        AND journal_entry_id IS NULL
    `);
    await tx.execute(sql`
      INSERT INTO public.bank_reconciliation_audit (mutation_id, action, actor, meta)
      VALUES (
        ${bankMutationId},
        'CANONICAL_SETTLEMENT_MEMBERSHIP_CORRECTION_REVERSED',
        ${actor},
        jsonb_build_object(
          'settlement_id', ${settlementId},
          'original_settlement_journal_id', ${journalId},
          'reversal_settlement_journal_id', ${reversalJournalId},
          'replacement_payment_ids', ${JSON.stringify(replacementPaymentIds)}::jsonb,
          'reason', ${reason},
          'old_payment_ids', ${JSON.stringify(
            activeItemsResult.rows.map((row) => Number((row as Record<string, unknown>).payment_id)),
          )}::jsonb
        )
      )
    `);

    return {
      ok: true,
      idempotent: false,
      settlementId,
      reversedSettlementJournalId: reversalJournalId,
      replacementPaymentIds,
      bankMutationId,
      settlementStatus: "reversed",
      bankMutationStatus: "unmatched",
    };
  });
}