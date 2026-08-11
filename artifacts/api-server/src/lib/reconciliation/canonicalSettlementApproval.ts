import { sql } from "drizzle-orm";
import type { DbClient } from "../accounting.js";
import {
  RECONCILIATION_CANDIDATE_SOURCES,
  type ReconciliationCandidateSource,
} from "@workspace/db";

export const CANONICAL_APPROVAL_BANK_MUTATION_STATUS = "approved" as const;
export const CANONICAL_SETTLEMENT_SOURCE =
  RECONCILIATION_CANDIDATE_SOURCES.CANONICAL_SPORT_CENTER;

export const CANONICAL_APPROVAL_CODES = {
  INVALID_MATCH: "INVALID_MATCH",
  SOURCE_REQUIRED: "RECONCILIATION_SOURCE_REQUIRED",
  WRONG_SOURCE: "CANONICAL_SETTLEMENT_SOURCE_REQUIRED",
  SETTLEMENT_NOT_ELIGIBLE: "CANONICAL_SETTLEMENT_NOT_ELIGIBLE",
  JOURNAL_NOT_ELIGIBLE: "CANONICAL_SETTLEMENT_JOURNAL_NOT_ELIGIBLE",
  BANK_MUTATION_NOT_FOUND: "CANONICAL_BANK_MUTATION_NOT_FOUND",
  BANK_MUTATION_NOT_ELIGIBLE: "CANONICAL_BANK_MUTATION_NOT_ELIGIBLE",
  MUTATION_ALREADY_USED: "CANONICAL_BANK_MUTATION_ALREADY_USED",
  SETTLEMENT_ALREADY_USED: "CANONICAL_SETTLEMENT_ALREADY_USED",
  PAYMENT_CONFLICT: "CANONICAL_SETTLEMENT_PAYMENT_RECONCILIATION_CONFLICT",
  INCONSISTENT_STATE: "CANONICAL_APPROVAL_INCONSISTENT_STATE",
  MATCHING_EVIDENCE_INVALID: "CANONICAL_SETTLEMENT_MATCHING_EVIDENCE_INVALID",
} as const;

type CanonicalApprovalCode =
  (typeof CANONICAL_APPROVAL_CODES)[keyof typeof CANONICAL_APPROVAL_CODES];

export class CanonicalSettlementApprovalError extends Error {
  readonly code: CanonicalApprovalCode;

  constructor(code: CanonicalApprovalCode, message: string) {
    super(message);
    this.name = "CanonicalSettlementApprovalError";
    this.code = code;
  }
}

type ApprovalRow = {
  settlement_status?: string | null;
  settlement_bank_mutation_id?: number | string | null;
  match_status?: string | null;
  canonical_mutation_status?: string | null;
  public_mutation_status?: string | null;
  canonical_mutation_id?: number | string | null;
};

export function isCanonicalBankMutationEligible(status: unknown): boolean {
  return ["matched", "auto_matched"].includes(
    String(status ?? "").toLowerCase(),
  );
}

export function isCanonicalApprovalIdempotentState(row: ApprovalRow): boolean {
  return (
    String(row.settlement_status ?? "").toLowerCase() === "reconciled" &&
    row.settlement_bank_mutation_id != null &&
    Number(row.settlement_bank_mutation_id) === Number(row.canonical_mutation_id) &&
    String(row.match_status ?? "").toLowerCase() === "approved" &&
    String(row.canonical_mutation_status ?? "").toLowerCase() === "approved" &&
    String(row.public_mutation_status ?? "").toLowerCase() === "approved"
  );
}

function escapeSql(value: string): string {
  return value.replace(/'/g, "''");
}

function jsonSql(value: Record<string, unknown>): string {
  return `'${JSON.stringify(value).replace(/'/g, "''")}'`;
}

function hasRowCount(result: unknown, expected = 1): boolean {
  const rowCount = Number((result as { rowCount?: number })?.rowCount);
  return Number.isFinite(rowCount) && rowCount === expected;
}

type CanonicalApprovalInput = {
  mutationId: number;
  matchId?: number | null;
  candidateType?: string | null;
  candidateId?: number | null;
  candidateSource?: ReconciliationCandidateSource | null;
  actor: string;
};

export type CanonicalApprovalResult = {
  ok: true;
  idempotent: boolean;
  candidate_type: "qris_settlement";
  candidate_id: number;
  candidate_source: typeof CANONICAL_SETTLEMENT_SOURCE;
  mutation_id: number;
  canonical_mutation_id: number;
  settlement_status: "reconciled";
  bank_mutation_status: "approved";
  match_status: "approved";
  bank_mutation_id: number;
  journal_created: false;
  requiresPosting: false;
  journal_entry_id: null;
};

/**
 * Link an already-posted Sport Center settlement to an eligible canonical
 * bank mutation. This is deliberately separate from approveAndCreateJournal:
 * canonical approval is reconciliation-only and has zero accounting effects.
 *
 * The public bank reconciliation mutation is the UI/API identity. It is
 * deterministically bridged to sport_center.bank_mutations by mutation_key;
 * using a numeric ID fallback would reintroduce the cross-schema collision that
 * candidate_source was added to prevent.
 */
export async function approveCanonicalSettlementLink(
  client: DbClient,
  input: CanonicalApprovalInput,
): Promise<CanonicalApprovalResult> {
  const {
    mutationId,
    matchId = null,
    candidateType = null,
    candidateId = null,
    candidateSource = null,
    actor,
  } = input;

  if (!Number.isSafeInteger(mutationId) || mutationId <= 0) {
    throw new CanonicalSettlementApprovalError(
      CANONICAL_APPROVAL_CODES.INVALID_MATCH,
      "Mutasi rekonsiliasi tidak valid.",
    );
  }

  return client.transaction(async (tx) => {
    // Lock order is stable for every canonical approval:
    // public mutation -> canonical mutation -> source-aware match -> settlement
    // -> settlement journal -> underlying public payment mirrors.
    const { rows: publicMutationRows } = await tx.execute(sql.raw(`
      SELECT id, mutation_key, status, amount, transaction_date, company_id, bank_account_id
      FROM bank_mutations
      WHERE id = ${mutationId}
      FOR UPDATE
    `));
    if (!publicMutationRows.length) {
      throw new CanonicalSettlementApprovalError(
        CANONICAL_APPROVAL_CODES.BANK_MUTATION_NOT_FOUND,
        "Mutasi bank publik tidak ditemukan.",
      );
    }
    const publicMutation = publicMutationRows[0] as Record<string, unknown>;
    const mutationKey = String(publicMutation.mutation_key ?? "");
    if (!mutationKey) {
      throw new CanonicalSettlementApprovalError(
        CANONICAL_APPROVAL_CODES.BANK_MUTATION_NOT_FOUND,
        "Mutasi bank tidak memiliki mutation_key untuk pemetaan canonical.",
      );
    }

    const { rows: canonicalMutationRows } = await tx.execute(sql.raw(`
      SELECT id, mutation_key, status, amount, transaction_date, direction,
             company_id, bank_account_id, provider_name
      FROM sport_center.bank_mutations
      WHERE mutation_key = '${escapeSql(mutationKey)}'
      FOR UPDATE
    `));
    if (canonicalMutationRows.length !== 1) {
      throw new CanonicalSettlementApprovalError(
        CANONICAL_APPROVAL_CODES.BANK_MUTATION_NOT_FOUND,
        canonicalMutationRows.length
          ? "Mutation key memetakan lebih dari satu mutasi Sport Center."
          : "Mutasi bank canonical Sport Center tidak ditemukan untuk mutation_key ini.",
      );
    }
    const canonicalMutation = canonicalMutationRows[0] as Record<string, unknown>;
    const canonicalMutationId = Number(canonicalMutation.id);

    const requestedType = candidateType
      ? String(candidateType)
      : "qris_settlement";
    const requestedId = candidateId != null ? Number(candidateId) : null;
    if (candidateSource == null && matchId == null) {
      throw new CanonicalSettlementApprovalError(
        CANONICAL_APPROVAL_CODES.SOURCE_REQUIRED,
        "candidate_source wajib diisi untuk approval QRIS canonical.",
      );
    }
    if (
      requestedType !== "qris_settlement" ||
      (candidateSource != null && candidateSource !== CANONICAL_SETTLEMENT_SOURCE)
    ) {
      throw new CanonicalSettlementApprovalError(
        CANONICAL_APPROVAL_CODES.WRONG_SOURCE,
        "Approval canonical hanya menerima qris_settlement dari sport_center.payment_settlement_batches.",
      );
    }

    let matchRows: Record<string, unknown>[];
    if (matchId != null) {
      const result = await tx.execute(sql.raw(`
        SELECT id, mutation_id, candidate_type, candidate_id, candidate_source, status
        FROM bank_reconciliation_matches
        WHERE id = ${Number(matchId)} AND mutation_id = ${mutationId}
        FOR UPDATE
      `));
      matchRows = result.rows as Record<string, unknown>[];
    } else {
      if (!requestedId || candidateSource !== CANONICAL_SETTLEMENT_SOURCE) {
        throw new CanonicalSettlementApprovalError(
          CANONICAL_APPROVAL_CODES.INVALID_MATCH,
          "Identitas candidate canonical tidak lengkap.",
        );
      }
      const result = await tx.execute(sql.raw(`
        SELECT id, mutation_id, candidate_type, candidate_id, candidate_source, status
        FROM bank_reconciliation_matches
        WHERE mutation_id = ${mutationId}
          AND candidate_type = 'qris_settlement'
          AND candidate_id = ${requestedId}
          AND candidate_source = '${CANONICAL_SETTLEMENT_SOURCE}'
          AND status IN ('candidate', 'approved')
        ORDER BY id
        LIMIT 2
        FOR UPDATE
      `));
      matchRows = result.rows as Record<string, unknown>[];
      if (matchRows.length > 1) {
        throw new CanonicalSettlementApprovalError(
          CANONICAL_APPROVAL_CODES.INCONSISTENT_STATE,
          "Terdapat lebih dari satu match canonical untuk mutasi ini.",
        );
      }
    }

    if (!matchRows.length) {
      throw new CanonicalSettlementApprovalError(
        CANONICAL_APPROVAL_CODES.INVALID_MATCH,
        "Match reconciliation canonical tidak ditemukan untuk mutasi ini.",
      );
    }
    const match = matchRows[0];
    const settlementId = Number(match.candidate_id);
    if (
      String(match.candidate_type) !== "qris_settlement" ||
      String(match.candidate_source ?? "") !== CANONICAL_SETTLEMENT_SOURCE ||
      !Number.isSafeInteger(settlementId) ||
      settlementId <= 0
    ) {
      if (match.candidate_type === "qris_settlement" && match.candidate_source == null) {
        throw new CanonicalSettlementApprovalError(
          CANONICAL_APPROVAL_CODES.SOURCE_REQUIRED,
          "Sumber QRIS historis tidak dapat diasumsikan sebagai canonical.",
        );
      }
      throw new CanonicalSettlementApprovalError(
        CANONICAL_APPROVAL_CODES.WRONG_SOURCE,
        "Match yang dipilih bukan source-aware canonical settlement.",
      );
    }
    if (requestedId != null && requestedId !== settlementId) {
      throw new CanonicalSettlementApprovalError(
        CANONICAL_APPROVAL_CODES.INVALID_MATCH,
        "candidate_id pada request tidak sama dengan match yang dikunci.",
      );
    }

    const { rows: approvedForMutation } = await tx.execute(sql.raw(`
      SELECT id, candidate_type, candidate_id, candidate_source
      FROM bank_reconciliation_matches
      WHERE mutation_id = ${mutationId}
        AND status = 'approved'
      FOR UPDATE
    `));
    const otherMutationApproval = approvedForMutation.find(
      (row) => Number(row.id) !== Number(match.id),
    );
    if (otherMutationApproval) {
      throw new CanonicalSettlementApprovalError(
        CANONICAL_APPROVAL_CODES.MUTATION_ALREADY_USED,
        "Mutasi bank sudah memiliki approved match lain.",
      );
    }

    const { rows: settlementRows } = await tx.execute(sql.raw(`
      SELECT id, status, bank_mutation_id, settlement_journal_id,
             gross_amount, mdr_amount, provider_fee_amount, fee_tax_amount,
             tax_withheld_amount, adjustment_amount, net_amount,
             company_id, bank_account_id, provider_code, provider_name,
             settlement_date
      FROM sport_center.payment_settlement_batches
      WHERE id = ${settlementId}
      FOR UPDATE
    `));
    if (!settlementRows.length) {
      throw new CanonicalSettlementApprovalError(
        CANONICAL_APPROVAL_CODES.SETTLEMENT_NOT_ELIGIBLE,
        "Settlement canonical tidak ditemukan.",
      );
    }
    const settlement = settlementRows[0] as Record<string, unknown>;

    const { rows: approvedForSettlement } = await tx.execute(sql.raw(`
      SELECT id, mutation_id
      FROM bank_reconciliation_matches
      WHERE candidate_type = 'qris_settlement'
        AND candidate_id = ${settlementId}
        AND candidate_source = '${CANONICAL_SETTLEMENT_SOURCE}'
        AND status = 'approved'
      FOR UPDATE
    `));
    const otherSettlementApproval = approvedForSettlement.find(
      (row) => Number(row.id) !== Number(match.id),
    );
    if (otherSettlementApproval) {
      throw new CanonicalSettlementApprovalError(
        CANONICAL_APPROVAL_CODES.SETTLEMENT_ALREADY_USED,
        "Settlement canonical sudah disetujui terhadap mutasi lain.",
      );
    }

    const settlementStatus = String(settlement.status ?? "").toLowerCase();
    const linkedMutationId = settlement.bank_mutation_id == null
      ? null
      : Number(settlement.bank_mutation_id);
    if (settlementStatus !== "posted") {
      const idempotent = isCanonicalApprovalIdempotentState({
        settlement_status: settlement.status as string,
        settlement_bank_mutation_id: linkedMutationId,
        match_status: match.status as string,
        canonical_mutation_status: canonicalMutation.status as string,
        public_mutation_status: publicMutation.status as string,
        canonical_mutation_id: canonicalMutationId,
      });
      if (idempotent) {
        return buildResult(settlementId, mutationId, canonicalMutationId, true);
      }
      throw new CanonicalSettlementApprovalError(
        CANONICAL_APPROVAL_CODES.SETTLEMENT_NOT_ELIGIBLE,
        "Settlement canonical harus berstatus posted dan belum terhubung.",
      );
    }
    if (
      !isCanonicalBankMutationEligible(canonicalMutation.status) ||
      !isCanonicalBankMutationEligible(publicMutation.status)
    ) {
      throw new CanonicalSettlementApprovalError(
        CANONICAL_APPROVAL_CODES.BANK_MUTATION_NOT_ELIGIBLE,
        "Mutasi bank harus masih berstatus matched/eligible sebelum approval canonical.",
      );
    }
    if (linkedMutationId != null && linkedMutationId !== canonicalMutationId) {
      throw new CanonicalSettlementApprovalError(
        CANONICAL_APPROVAL_CODES.SETTLEMENT_ALREADY_USED,
        "Settlement canonical sudah terhubung ke mutasi bank lain.",
      );
    }
    if (linkedMutationId === canonicalMutationId) {
      throw new CanonicalSettlementApprovalError(
        CANONICAL_APPROVAL_CODES.INCONSISTENT_STATE,
        "Settlement canonical memiliki link sebelum status reconciled.",
      );
    }
    if (settlement.settlement_journal_id == null) {
      throw new CanonicalSettlementApprovalError(
        CANONICAL_APPROVAL_CODES.SETTLEMENT_NOT_ELIGIBLE,
        "Settlement canonical belum memiliki settlement journal.",
      );
    }

    const { rows: journalRows } = await tx.execute(sql.raw(`
      SELECT id, status, journal_type, is_reversal, settlement_batch_id
      FROM sport_center.accounting_journals
      WHERE id = ${Number(settlement.settlement_journal_id)}
      FOR UPDATE
    `));
    const journal = journalRows[0] as Record<string, unknown> | undefined;
    if (
      !journal ||
      String(journal.status ?? "").toLowerCase() !== "posted" ||
      String(journal.journal_type ?? "").toLowerCase() !== "settlement" ||
      journal.is_reversal !== false ||
      Number(journal.settlement_batch_id) !== settlementId
    ) {
      throw new CanonicalSettlementApprovalError(
        CANONICAL_APPROVAL_CODES.JOURNAL_NOT_ELIGIBLE,
        "Settlement journal harus ada, posted, bertipe settlement, bukan reversal, dan menunjuk batch yang sama.",
      );
    }

    // Re-run the canonical read-only finder inside the approval transaction.
    // This revalidates amount/date/company/account/provider/direction against
    // the same canonical mutation that will receive the link.
    const { rows: evidenceRows } = await tx.execute(sql.raw(`
      SELECT candidate_eligible
      FROM sport_center.find_settlement_bank_candidates(${settlementId}, 1)
      WHERE mutation_id = ${canonicalMutationId}
        AND candidate_eligible = TRUE
      LIMIT 1
    `));
    if (!evidenceRows.length) {
      throw new CanonicalSettlementApprovalError(
        CANONICAL_APPROVAL_CODES.MATCHING_EVIDENCE_INVALID,
        "Bukti mutation/date/amount/company/account/provider canonical sudah tidak eligible.",
      );
    }

    // Lock public payment mirrors before checking the individual
    // sport_payment invariant. The SCPAY-SC-{canonical id} bridge is the
    // trigger-owned identity; mirror numeric IDs are never guessed.
    const { rows: paymentRows } = await tx.execute(sql.raw(`
      SELECT sp.id
      FROM sport_center.payment_settlement_items psi
      JOIN sport_center.payment_settlement_batches psb
        ON psb.id = psi.settlement_id
      JOIN public.sport_payments sp
        ON sp.payment_number = 'SCPAY-SC-' || psi.payment_id::text
      WHERE psi.settlement_id = ${settlementId}
        AND psi.item_status = 'active'
        AND psb.status IN ('posted', 'reconciled')
      FOR UPDATE OF sp
    `));
    const publicPaymentIds = paymentRows
      .map((row) => Number((row as Record<string, unknown>).id))
      .filter((id) => Number.isSafeInteger(id) && id > 0);
    if (publicPaymentIds.length) {
      const paymentIdList = publicPaymentIds.join(",");
      const { rows: paymentConflicts } = await tx.execute(sql.raw(`
        SELECT id, candidate_id
        FROM bank_reconciliation_matches
        WHERE candidate_type = 'sport_payment'
          AND candidate_id IN (${paymentIdList})
          AND status IN ('candidate', 'approved')
        FOR UPDATE
      `));
      if (paymentConflicts.length) {
        throw new CanonicalSettlementApprovalError(
          CANONICAL_APPROVAL_CODES.PAYMENT_CONFLICT,
          "Payment Sport Center sudah memiliki reconciliation sport_payment aktif/approved.",
        );
      }
    }

    const auditMeta = {
      mutation_id: mutationId,
      canonical_mutation_id: canonicalMutationId,
      candidate_type: "qris_settlement",
      candidate_id: settlementId,
      candidate_source: CANONICAL_SETTLEMENT_SOURCE,
      settlement_id: settlementId,
      action: "canonical settlement reconciliation approved",
      journal_created: false,
    };

    const settlementUpdate = await tx.execute(sql.raw(`
      UPDATE sport_center.payment_settlement_batches
      SET status = 'reconciled',
          bank_mutation_id = ${canonicalMutationId},
          reconciled_at = NOW(),
          reconciled_by = '${escapeSql(actor)}'
      WHERE id = ${settlementId}
        AND status = 'posted'
        AND bank_mutation_id IS NULL
    `));
    if (!hasRowCount(settlementUpdate)) {
      throw new CanonicalSettlementApprovalError(
        CANONICAL_APPROVAL_CODES.INCONSISTENT_STATE,
        "Settlement berubah saat approval canonical berlangsung.",
      );
    }

    const matchUpdate = await tx.execute(sql.raw(`
      UPDATE bank_reconciliation_matches
      SET status = 'approved'
      WHERE id = ${Number(match.id)}
        AND mutation_id = ${mutationId}
        AND candidate_type = 'qris_settlement'
        AND candidate_id = ${settlementId}
        AND candidate_source = '${CANONICAL_SETTLEMENT_SOURCE}'
    `));
    if (!hasRowCount(matchUpdate)) {
      throw new CanonicalSettlementApprovalError(
        CANONICAL_APPROVAL_CODES.INCONSISTENT_STATE,
        "Match canonical berubah saat approval berlangsung.",
      );
    }

    const canonicalMutationUpdate = await tx.execute(sql.raw(`
      UPDATE sport_center.bank_mutations
      SET status = '${CANONICAL_APPROVAL_BANK_MUTATION_STATUS}',
          approved_by = '${escapeSql(actor)}',
          approved_at = NOW()
      WHERE id = ${canonicalMutationId}
        AND status IN ('matched', 'auto_matched')
    `));
    if (!hasRowCount(canonicalMutationUpdate)) {
      throw new CanonicalSettlementApprovalError(
        CANONICAL_APPROVAL_CODES.INCONSISTENT_STATE,
        "Mutasi bank canonical berubah saat approval berlangsung.",
      );
    }

    const publicMutationUpdate = await tx.execute(sql.raw(`
      UPDATE bank_mutations
      SET status = '${CANONICAL_APPROVAL_BANK_MUTATION_STATUS}',
          approved_by = '${escapeSql(actor)}',
          approved_at = NOW(),
          updated_at = NOW()
      WHERE id = ${mutationId}
        AND status IN ('matched', 'auto_matched')
    `));
    if (!hasRowCount(publicMutationUpdate)) {
      throw new CanonicalSettlementApprovalError(
        CANONICAL_APPROVAL_CODES.INCONSISTENT_STATE,
        "Mutasi bank publik berubah saat approval berlangsung.",
      );
    }

    await tx.execute(sql.raw(`
      INSERT INTO bank_reconciliation_audit (mutation_id, action, actor, meta)
      VALUES (
        ${mutationId},
        'CANONICAL_SETTLEMENT_RECONCILIATION_APPROVED',
        '${escapeSql(actor)}',
        ${jsonSql(auditMeta)}
      )
    `));

    return buildResult(settlementId, mutationId, canonicalMutationId, false);
  });
}

function buildResult(
  settlementId: number,
  mutationId: number,
  canonicalMutationId: number,
  idempotent: boolean,
): CanonicalApprovalResult {
  return {
    ok: true,
    idempotent,
    candidate_type: "qris_settlement",
    candidate_id: settlementId,
    candidate_source: CANONICAL_SETTLEMENT_SOURCE,
    mutation_id: mutationId,
    canonical_mutation_id: canonicalMutationId,
    settlement_status: "reconciled",
    bank_mutation_status: CANONICAL_APPROVAL_BANK_MUTATION_STATUS,
    match_status: "approved",
    bank_mutation_id: canonicalMutationId,
    journal_created: false,
    requiresPosting: false,
    journal_entry_id: null,
  };
}