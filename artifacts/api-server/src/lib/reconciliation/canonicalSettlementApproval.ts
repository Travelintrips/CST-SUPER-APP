import { sql } from "drizzle-orm";
import type { DbClient } from "../accounting.js";
import {
  RECONCILIATION_CANDIDATE_SOURCES,
  type ReconciliationCandidateSource,
} from "@workspace/db";
import {
  checkQrisApprovalRule,
  QRIS_APPROVAL_REASON_CODES,
} from "./qrisApprovalRule.js";

export const CANONICAL_APPROVAL_BANK_MUTATION_STATUS = "approved" as const;
export const CANONICAL_REOPEN_BANK_MUTATION_STATUS = "unmatched" as const;
export const CANONICAL_REOPEN_SETTLEMENT_STATUS = "posted" as const;
export const CANONICAL_REOPEN_MATCH_STATUS = "candidate" as const;
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
  GENERIC_JOURNAL_ALREADY_EXISTS: "CANONICAL_GENERIC_JOURNAL_ALREADY_EXISTS",
  INCONSISTENT_STATE: "CANONICAL_APPROVAL_INCONSISTENT_STATE",
  MATCHING_EVIDENCE_INVALID: "CANONICAL_SETTLEMENT_MATCHING_EVIDENCE_INVALID",
  HISTORICAL_REPAIR_CONFIRMATION_REQUIRED: "CANONICAL_HISTORICAL_REPAIR_CONFIRMATION_REQUIRED",
  REOPEN_NOT_ELIGIBLE: "CANONICAL_SETTLEMENT_REOPEN_NOT_ELIGIBLE",
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
  public_mutation_status?: string | null;
  mutation_id?: number | string | null;
};

export function isCanonicalBankMutationEligible(status: unknown): boolean {
  return ["unmatched", "matched", "auto_matched"].includes(
    String(status ?? "").toLowerCase(),
  );
}

export function isCanonicalApprovalIdempotentState(row: ApprovalRow): boolean {
  return (
    String(row.settlement_status ?? "").toLowerCase() === "reconciled" &&
    row.settlement_bank_mutation_id != null &&
    Number(row.settlement_bank_mutation_id) === Number(row.mutation_id) &&
    String(row.match_status ?? "").toLowerCase() === "approved" &&
    String(row.public_mutation_status ?? "").toLowerCase() === "approved"
  );
}

export function isCanonicalReopenIdempotentState(row: ApprovalRow): boolean {
  return (
    String(row.settlement_status ?? "").toLowerCase() === "posted" &&
    row.settlement_bank_mutation_id == null &&
    String(row.match_status ?? "").toLowerCase() === "candidate" &&
    String(row.public_mutation_status ?? "").toLowerCase() === "unmatched"
  );
}

export type HistoricalSettlementRepairEvidence = {
  settlementStatus: unknown;
  linkedMutationId: unknown;
  linkedCanonicalMutationId: unknown;
  mutationDirection: unknown;
  mutationCompanyId: unknown;
  settlementCompanyId: unknown;
  mutationDate: unknown;
  settlementDate: unknown;
  mutationAmount: unknown;
  settlementNetAmount: unknown;
  accountMatched: boolean;
  journalEligible: boolean;
  paymentMethods: unknown[];
  paymentStatuses: unknown[];
};

export function validateHistoricalSettlementRepairEvidence(
  evidence: HistoricalSettlementRepairEvidence,
): { ok: true } | { ok: false; reason: string } {
  if (String(evidence.settlementStatus ?? "").toLowerCase() !== "posted") {
    return { ok: false, reason: "Settlement harus berstatus posted." };
  }
  if (evidence.linkedMutationId != null || evidence.linkedCanonicalMutationId != null) {
    return { ok: false, reason: "Settlement sudah tertaut ke mutasi bank." };
  }
  if (String(evidence.mutationDirection ?? "").toUpperCase() !== "IN") {
    return { ok: false, reason: "Mutasi harus berupa uang masuk." };
  }
  if (
    Number(evidence.mutationCompanyId) <= 0
    || Number(evidence.mutationCompanyId) !== Number(evidence.settlementCompanyId)
  ) {
    return { ok: false, reason: "Company settlement dan mutasi tidak sama." };
  }
  if (
    String(evidence.mutationDate ?? "").slice(0, 10)
    !== String(evidence.settlementDate ?? "").slice(0, 10)
  ) {
    return { ok: false, reason: "Tanggal settlement dan mutasi tidak sama." };
  }
  if (
    Math.abs(
      Number(evidence.mutationAmount ?? 0) - Number(evidence.settlementNetAmount ?? 0),
    ) > 0.001
  ) {
    return { ok: false, reason: "Net settlement dan nominal mutasi tidak sama." };
  }
  if (!evidence.accountMatched) {
    return { ok: false, reason: "Rekening settlement dan mutasi tidak sama." };
  }
  if (!evidence.journalEligible) {
    return { ok: false, reason: "Journal settlement tidak eligible." };
  }
  if (
    evidence.paymentMethods.length === 0
    || evidence.paymentMethods.some(
      (method) => !String(method ?? "").toLowerCase().includes("qris"),
    )
  ) {
    return { ok: false, reason: "Settlement harus memiliki payment QRIS aktif." };
  }
  if (
    evidence.paymentStatuses.length !== evidence.paymentMethods.length
    || evidence.paymentStatuses.some(
      (status) => String(status ?? "").toLowerCase() !== "confirmed",
    )
  ) {
    return { ok: false, reason: "Semua payment settlement harus berstatus confirmed." };
  }
  return { ok: true };
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
  manualOverride?: boolean;
  overrideReason?: string | null;
  historicalRepair?: boolean;
};

export type CanonicalApprovalResult = {
  ok: true;
  idempotent: boolean;
  manual_override: boolean;
  historical_repair: boolean;
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

export type CanonicalReopenResult = {
  ok: true;
  idempotent: boolean;
  action: "canonical_settlement_link_removed";
  candidate_type: "qris_settlement";
  candidate_id: number;
  candidate_source: typeof CANONICAL_SETTLEMENT_SOURCE;
  mutation_id: number;
  canonical_mutation_id: number;
  settlement_status: "posted";
  bank_mutation_status: "unmatched";
  match_status: "candidate";
  bank_mutation_id: null;
  journal_created: false;
  journal_reversed: false;
  settlement_journal_id: number;
};

/**
 * Link an already-posted Sport Center settlement to an eligible canonical
 * bank mutation. This is deliberately separate from approveAndCreateJournal:
 * canonical approval is reconciliation-only and has zero accounting effects.
 *
 * public.bank_mutations.id is the sole bank-mutation identity. The settlement
 * batch's additive bank_mutation_id column stores that public ID directly.
 * candidate_source remains the settlement-evidence boundary.
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
    manualOverride = false,
    overrideReason = null,
    historicalRepair = false,
  } = input;

  if (!Number.isSafeInteger(mutationId) || mutationId <= 0) {
    throw new CanonicalSettlementApprovalError(
      CANONICAL_APPROVAL_CODES.INVALID_MATCH,
      "Mutasi rekonsiliasi tidak valid.",
    );
  }
  if (historicalRepair && (!manualOverride || !overrideReason?.trim())) {
    throw new CanonicalSettlementApprovalError(
      CANONICAL_APPROVAL_CODES.HISTORICAL_REPAIR_CONFIRMATION_REQUIRED,
      "Repair settlement historis membutuhkan konfirmasi dan alasan reviewer.",
    );
  }

  return client.transaction(async (tx) => {
     // Lock order is stable for every canonical approval:
     // public mutation -> source-aware match -> settlement
    // -> settlement journal -> underlying public payment mirrors.
    const { rows: publicMutationRows } = await tx.execute(sql.raw(`
      SELECT id, status, journal_entry_id, amount, transaction_date, direction,
             company_id, bank_account_id
      FROM public.bank_mutations
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
    if (publicMutation.journal_entry_id != null) {
      throw new CanonicalSettlementApprovalError(
        CANONICAL_APPROVAL_CODES.GENERIC_JOURNAL_ALREADY_EXISTS,
        "Mutasi bank sudah memiliki journal generic; approval canonical link-only dihentikan.",
      );
    }
    // Kept in the response/audit shape for backwards-compatible clients. It is
    // not a cross-schema identity: it is always public.bank_mutations.id.
    const canonicalMutationId = mutationId;

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

    if (!matchRows.length && historicalRepair && requestedId) {
      const inserted = await tx.execute(sql.raw(`
        INSERT INTO bank_reconciliation_matches (
          mutation_id,
          candidate_type,
          candidate_id,
          candidate_source,
          match_score,
          match_reason,
          amount_match,
          date_match,
          status,
          is_manual
        )
        SELECT
          ${mutationId},
          'qris_settlement',
          ${requestedId},
          '${CANONICAL_SETTLEMENT_SOURCE}',
          100,
          'Historical posted-settlement repair; final evidence validated transactionally',
          TRUE,
          TRUE,
          'candidate',
          TRUE
        WHERE NOT EXISTS (
          SELECT 1
          FROM bank_reconciliation_matches existing
          WHERE existing.mutation_id = ${mutationId}
            AND existing.candidate_type = 'qris_settlement'
            AND existing.candidate_id = ${requestedId}
            AND existing.candidate_source = '${CANONICAL_SETTLEMENT_SOURCE}'
            AND existing.status IN ('candidate', 'approved')
        )
        RETURNING id, mutation_id, candidate_type, candidate_id, candidate_source, status
      `));
      matchRows = inserted.rows as Record<string, unknown>[];
      if (!matchRows.length) {
        const concurrent = await tx.execute(sql.raw(`
          SELECT id, mutation_id, candidate_type, candidate_id, candidate_source, status
          FROM bank_reconciliation_matches
          WHERE mutation_id = ${mutationId}
            AND candidate_type = 'qris_settlement'
            AND candidate_id = ${requestedId}
            AND candidate_source = '${CANONICAL_SETTLEMENT_SOURCE}'
            AND status IN ('candidate', 'approved')
          ORDER BY CASE WHEN status = 'approved' THEN 0 ELSE 1 END, id
          LIMIT 1
          FOR UPDATE
        `));
        matchRows = concurrent.rows as Record<string, unknown>[];
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
    let supersededHistoricalMatchId: number | null = null;
    if (otherMutationApproval) {
      // An interrupted canonical approval can leave the mutation approved
      // against the old sport-payment snapshot after its posted canonical
      // batch was created. Historical repair may replace only that exact
      // snapshot; unrelated approved matches must remain fail-closed.
      if (historicalRepair) {
        const { rows: equivalentRows } = await tx.execute(sql.raw(`
          SELECT legacy.id
          FROM bank_reconciliation_matches legacy
          JOIN qris_mutation_batch_candidates snapshot
            ON snapshot.id = legacy.candidate_id
          JOIN sport_center.payment_settlement_batches canonical
            ON canonical.id = ${settlementId}
          WHERE legacy.id = ${Number(otherMutationApproval.id)}
            AND legacy.mutation_id = ${mutationId}
            AND legacy.candidate_type = 'qris_settlement'
            AND legacy.candidate_source = 'sport_center.sport_payments'
            AND snapshot.company_id = canonical.company_id
            AND snapshot.gross_amount = canonical.gross_amount
            AND snapshot.net_amount = canonical.net_amount
            AND snapshot.estimated_settlement_date::date = canonical.settlement_date::date
            AND (
              SELECT COUNT(*)
              FROM sport_center.payment_settlement_items canonical_item
              WHERE canonical_item.settlement_id = canonical.id
                AND canonical_item.item_status = 'active'
            ) = jsonb_array_length(COALESCE(snapshot.payment_items, '[]'::jsonb))
            AND NOT EXISTS (
              SELECT 1
              FROM sport_center.payment_settlement_items canonical_extra
              WHERE canonical_extra.settlement_id = canonical.id
                AND canonical_extra.item_status = 'active'
                AND NOT EXISTS (
                  SELECT 1
                  FROM jsonb_array_elements(COALESCE(snapshot.payment_items, '[]'::jsonb)) snapshot_item
                  WHERE (snapshot_item->>'paymentId')::int = canonical_extra.payment_id
                )
            )
            AND NOT EXISTS (
              SELECT 1
              FROM jsonb_array_elements(COALESCE(snapshot.payment_items, '[]'::jsonb)) snapshot_item
              WHERE NOT EXISTS (
                SELECT 1
                FROM sport_center.payment_settlement_items canonical_missing
                WHERE canonical_missing.settlement_id = canonical.id
                  AND canonical_missing.item_status = 'active'
                  AND canonical_missing.payment_id = (snapshot_item->>'paymentId')::int
              )
            )
          LIMIT 2
        `));
        if (equivalentRows.length === 1) {
          supersededHistoricalMatchId = Number((equivalentRows[0] as Record<string, unknown>).id);
          const supersedeResult = await tx.execute(sql.raw(`
            UPDATE bank_reconciliation_matches
            SET status = 'superseded'
            WHERE id = ${supersededHistoricalMatchId}
              AND mutation_id = ${mutationId}
              AND status = 'approved'
          `));
          if (!hasRowCount(supersedeResult)) {
            throw new CanonicalSettlementApprovalError(
              CANONICAL_APPROVAL_CODES.INCONSISTENT_STATE,
              "Match lama berubah saat historical repair berlangsung.",
            );
          }
        }
      }
      if (supersededHistoricalMatchId == null) {
        throw new CanonicalSettlementApprovalError(
          CANONICAL_APPROVAL_CODES.MUTATION_ALREADY_USED,
          "Mutasi bank sudah memiliki approved match lain.",
        );
      }
    }

    const { rows: settlementRows } = await tx.execute(sql.raw(`
      SELECT id, status, bank_mutation_id, canonical_bank_mutation_id,
             settlement_journal_id,
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
    const linkedCanonicalMutationId = settlement.canonical_bank_mutation_id == null
      ? null
      : Number(settlement.canonical_bank_mutation_id);
    if (settlementStatus !== "posted") {
      const idempotent = isCanonicalApprovalIdempotentState({
        settlement_status: settlement.status as string,
        settlement_bank_mutation_id: linkedMutationId,
        match_status: match.status as string,
        public_mutation_status: publicMutation.status as string,
         mutation_id: mutationId,
      });
      if (idempotent && linkedCanonicalMutationId === mutationId) {
        return buildResult(
          settlementId,
          mutationId,
          canonicalMutationId,
          true,
          manualOverride,
          historicalRepair,
        );
      }
      throw new CanonicalSettlementApprovalError(
        CANONICAL_APPROVAL_CODES.SETTLEMENT_NOT_ELIGIBLE,
        "Settlement canonical harus berstatus posted dan belum terhubung.",
      );
    }
    if (
       !isCanonicalBankMutationEligible(publicMutation.status)
    ) {
      throw new CanonicalSettlementApprovalError(
        CANONICAL_APPROVAL_CODES.BANK_MUTATION_NOT_ELIGIBLE,
        "Mutasi bank sudah tidak eligible untuk approval canonical.",
      );
    }
    if (String(publicMutation.direction ?? "").toUpperCase() !== "IN") {
      throw new CanonicalSettlementApprovalError(
        CANONICAL_APPROVAL_CODES.MATCHING_EVIDENCE_INVALID,
        "Settlement QRIS hanya boleh ditautkan ke mutasi uang masuk.",
      );
    }
    if (
      String(settlement.settlement_date ?? "").slice(0, 10)
      !== String(publicMutation.transaction_date ?? "").slice(0, 10)
    ) {
      throw new CanonicalSettlementApprovalError(
        CANONICAL_APPROVAL_CODES.MATCHING_EVIDENCE_INVALID,
        "Tanggal settlement harus sama persis dengan tanggal mutasi bank.",
      );
    }
    if (
      Math.abs(
        Number(settlement.net_amount ?? 0) - Number(publicMutation.amount ?? 0),
      ) > 0.001
    ) {
      throw new CanonicalSettlementApprovalError(
        CANONICAL_APPROVAL_CODES.MATCHING_EVIDENCE_INVALID,
        "Nominal net settlement harus sama persis dengan nominal mutasi bank.",
      );
    }
    // A previous attempt can have written one of the two compatibility link
    // columns before the status update was interrupted. Treat that exact same
    // mutation as a recoverable partial link; a link to any other mutation is
    // still a hard conflict.
    const conflictingLinkId = [linkedMutationId, linkedCanonicalMutationId]
      .find((linkedId) => linkedId != null && linkedId !== mutationId);
    if (conflictingLinkId != null) {
      throw new CanonicalSettlementApprovalError(
        CANONICAL_APPROVAL_CODES.SETTLEMENT_ALREADY_USED,
        "Settlement canonical sudah terhubung ke mutasi bank lain.",
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
    const publicCompanyId = Number(publicMutation.company_id);
    const settlementCompanyId = Number(settlement.company_id);
    if (
      !Number.isSafeInteger(publicCompanyId)
      || publicCompanyId <= 0
      || settlementCompanyId !== publicCompanyId
    ) {
      throw new CanonicalSettlementApprovalError(
        CANONICAL_APPROVAL_CODES.MATCHING_EVIDENCE_INVALID,
        "Company payment tidak sama dengan mutasi bank",
      );
    }
    const { rows: accountRows } = await tx.execute(sql.raw(`
      SELECT COUNT(*)::integer AS account_count, MIN(id)::integer AS account_id
      FROM company_bank_accounts
      WHERE company_id = ${publicCompanyId}
        AND is_active = TRUE
        AND (
          id::text = NULLIF(BTRIM('${escapeSql(String(settlement.bank_account_id ?? ""))}'), '')
          OR account_number::text = NULLIF(BTRIM('${escapeSql(String(settlement.bank_account_id ?? ""))}'), '')
        )
    `));
    const accountResolution = accountRows[0] as Record<string, unknown> | undefined;
    if (
      Number(accountResolution?.account_count) !== 1
      || Number(accountResolution?.account_id) !== Number(publicMutation.bank_account_id)
    ) {
      throw new CanonicalSettlementApprovalError(
        CANONICAL_APPROVAL_CODES.MATCHING_EVIDENCE_INVALID,
        "Rekening settlement tidak sama dengan rekening mutasi bank",
      );
    }

    const { rows: strictPaymentRows } = await tx.execute(sql.raw(`
      SELECT p.id,
             p.company_id,
             p.amount,
             p.status::text AS payment_status,
             p.payment_method::text AS payment_method,
             (
               COALESCE(p.paid_at, p.confirmed_at, p.created_at)
               AT TIME ZONE 'Asia/Jakarta'
             )::date::text AS payment_date
      FROM sport_center.payment_settlement_items i
      JOIN sport_center.sport_payments p ON p.id = i.payment_id
      WHERE i.settlement_id = ${settlementId}
        AND i.item_status = 'active'
      ORDER BY p.id
      FOR UPDATE OF i, p
    `));
    const settlementGross = Number(settlement.gross_amount ?? 0);
    const settlementNet = Number(settlement.net_amount ?? 0);
    if (historicalRepair) {
      const repairEvidence = validateHistoricalSettlementRepairEvidence({
        settlementStatus: settlement.status,
        linkedMutationId,
        linkedCanonicalMutationId,
        mutationDirection: publicMutation.direction,
        mutationCompanyId: publicCompanyId,
        settlementCompanyId: settlementCompanyId,
        mutationDate: publicMutation.transaction_date,
        settlementDate: settlement.settlement_date,
        mutationAmount: publicMutation.amount,
        settlementNetAmount: settlement.net_amount,
        accountMatched: Number(accountResolution?.account_count) === 1
          && Number(accountResolution?.account_id) === Number(publicMutation.bank_account_id),
        journalEligible: true,
        paymentMethods: (strictPaymentRows as Array<Record<string, unknown>>)
          .map((payment) => payment.payment_method),
        paymentStatuses: (strictPaymentRows as Array<Record<string, unknown>>)
          .map((payment) => payment.payment_status),
      });
      if (!repairEvidence.ok) {
        throw new CanonicalSettlementApprovalError(
          CANONICAL_APPROVAL_CODES.MATCHING_EVIDENCE_INVALID,
          repairEvidence.reason,
        );
      }
    }
    const strictApproval = checkQrisApprovalRule({
      companyId: publicCompanyId,
      mutationDate: String(publicMutation.transaction_date ?? ""),
      mutationAmount: Number(publicMutation.amount ?? 0),
      payments: (strictPaymentRows as Array<Record<string, unknown>>).map((payment, index) => ({
        id: Number(payment.id),
        paymentMethod: payment.payment_method == null
          ? null
          : String(payment.payment_method),
        paymentDate: payment.payment_date == null ? null : String(payment.payment_date),
        grossAmount: Number(payment.amount ?? 0),
        companyId: payment.company_id == null ? null : Number(payment.company_id),
        canonicalMdrAmount: index === 0 ? settlementGross - settlementNet : 0,
        alreadyReconciled: false,
      })),
    });
    if (historicalRepair) {
      const mutationDate = String(publicMutation.transaction_date ?? "").slice(0, 10);
      const expectedDate = new Date(`${mutationDate}T00:00:00.000Z`);
      expectedDate.setUTCDate(expectedDate.getUTCDate() - 1);
      const expectedHMinusOne = expectedDate.toISOString().slice(0, 10);
      const coreApproval = checkQrisApprovalRule({
        companyId: publicCompanyId,
        mutationDate,
        mutationAmount: Number(publicMutation.amount ?? 0),
        payments: (strictPaymentRows as Array<Record<string, unknown>>).map((payment, index) => ({
          id: Number(payment.id),
          paymentMethod: payment.payment_method == null
            ? null
            : String(payment.payment_method),
          paymentDate: expectedHMinusOne,
          grossAmount: Number(payment.amount ?? 0),
          companyId: payment.company_id == null ? null : Number(payment.company_id),
          canonicalMdrAmount: index === 0 ? settlementGross - settlementNet : 0,
          alreadyReconciled: false,
        })),
      });
      if (!coreApproval.ok) {
        throw new CanonicalSettlementApprovalError(
          CANONICAL_APPROVAL_CODES.MATCHING_EVIDENCE_INVALID,
          coreApproval.reason,
        );
      }
      if (
        !strictApproval.ok
        && strictApproval.code !== QRIS_APPROVAL_REASON_CODES.PAYMENT_DATE_NOT_H_MINUS_ONE
      ) {
        throw new CanonicalSettlementApprovalError(
          CANONICAL_APPROVAL_CODES.MATCHING_EVIDENCE_INVALID,
          strictApproval.reason,
        );
      }
    }
    if (strictPaymentRows.length === 0) {
      throw new CanonicalSettlementApprovalError(
        CANONICAL_APPROVAL_CODES.MATCHING_EVIDENCE_INVALID,
        "Settlement canonical tidak memiliki payment aktif.",
      );
    }
    if (
      (strictPaymentRows as Array<Record<string, unknown>>).some(
        (payment) => !String(payment.payment_method ?? "").toLowerCase().includes("qris"),
      )
    ) {
      throw new CanonicalSettlementApprovalError(
        CANONICAL_APPROVAL_CODES.MATCHING_EVIDENCE_INVALID,
        "Repair settlement historis hanya boleh memuat payment QRIS.",
      );
    }
    if (!strictApproval.ok && !manualOverride) {
      throw new CanonicalSettlementApprovalError(
        CANONICAL_APPROVAL_CODES.MATCHING_EVIDENCE_INVALID,
        strictApproval.reason,
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
      manual_override: manualOverride,
      historical_repair: historicalRepair,
      override_reason: manualOverride ? (overrideReason?.trim() || "Override manual oleh reviewer") : null,
      matching_evidence: strictApproval.ok ? "valid" : "overridden",
      superseded_historical_match_id: supersededHistoricalMatchId,
    };

    const settlementUpdate = await tx.execute(sql.raw(`
      UPDATE sport_center.payment_settlement_batches
      SET status = 'reconciled',
          bank_mutation_id = ${mutationId},
          canonical_bank_mutation_id = ${mutationId},
          reconciled_at = NOW(),
          reconciled_by = '${escapeSql(actor)}'
      WHERE id = ${settlementId}
        AND LOWER(status) = 'posted'
        AND (bank_mutation_id IS NULL OR bank_mutation_id = ${mutationId})
        AND (canonical_bank_mutation_id IS NULL OR canonical_bank_mutation_id = ${mutationId})
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

    const publicMutationUpdate = await tx.execute(sql.raw(`
      UPDATE public.bank_mutations
      SET status = '${CANONICAL_APPROVAL_BANK_MUTATION_STATUS}',
          approved_by = '${escapeSql(actor)}',
          approved_at = NOW(),
          updated_at = NOW()
      WHERE id = ${mutationId}
        AND status IN ('unmatched', 'matched', 'auto_matched')
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

    return buildResult(
      settlementId,
      mutationId,
      canonicalMutationId,
      false,
      manualOverride,
      historicalRepair,
    );
  });
}

/**
 * Remove a canonical reconciliation link without touching accounting.
 *
 * This is intentionally not routed through the generic void-journal flow:
 * canonical settlement journals remain posted and the bank mutation is simply
 * returned to the unmatched candidate lifecycle.
 */
export async function reopenCanonicalSettlementLink(
  client: DbClient,
  input: CanonicalApprovalInput,
): Promise<CanonicalReopenResult> {
  const { mutationId, actor } = input;

  if (!Number.isSafeInteger(mutationId) || mutationId <= 0) {
    throw new CanonicalSettlementApprovalError(
      CANONICAL_APPROVAL_CODES.INVALID_MATCH,
      "Mutasi rekonsiliasi tidak valid.",
    );
  }

  return client.transaction(async (tx) => {
    const { rows: publicRows } = await tx.execute(sql.raw(`
      SELECT id, status, journal_entry_id
      FROM public.bank_mutations
      WHERE id = ${mutationId}
      FOR UPDATE
    `));
    if (!publicRows.length) {
      throw new CanonicalSettlementApprovalError(
        CANONICAL_APPROVAL_CODES.BANK_MUTATION_NOT_FOUND,
        "Mutasi bank publik tidak ditemukan.",
      );
    }
    const publicMutation = publicRows[0] as Record<string, unknown>;
    if (publicMutation.journal_entry_id != null) {
      throw new CanonicalSettlementApprovalError(
        CANONICAL_APPROVAL_CODES.GENERIC_JOURNAL_ALREADY_EXISTS,
        "Mutasi bank memiliki journal generic; link canonical tidak boleh dibuka melalui jalur accounting.",
      );
    }
    const canonicalMutationId = mutationId;

    const { rows: matchRows } = await tx.execute(sql.raw(`
      SELECT id, candidate_id, candidate_type, candidate_source, status
      FROM bank_reconciliation_matches
      WHERE mutation_id = ${mutationId}
        AND candidate_type = 'qris_settlement'
        AND candidate_source = '${CANONICAL_SETTLEMENT_SOURCE}'
        AND status IN ('approved', 'candidate')
      ORDER BY id
      LIMIT 2
      FOR UPDATE
    `));
    if (matchRows.length !== 1) {
      throw new CanonicalSettlementApprovalError(
        matchRows.length > 1
          ? CANONICAL_APPROVAL_CODES.INCONSISTENT_STATE
          : CANONICAL_APPROVAL_CODES.REOPEN_NOT_ELIGIBLE,
        matchRows.length > 1
          ? "Terdapat lebih dari satu match canonical untuk mutasi ini."
          : "Match reconciliation canonical tidak ditemukan untuk mutasi ini.",
      );
    }
    const match = matchRows[0] as Record<string, unknown>;
    const settlementId = Number(match.candidate_id);
    if (!Number.isSafeInteger(settlementId) || settlementId <= 0) {
      throw new CanonicalSettlementApprovalError(
        CANONICAL_APPROVAL_CODES.INVALID_MATCH,
        "Identitas candidate canonical tidak lengkap.",
      );
    }

    const { rows: settlementRows } = await tx.execute(sql.raw(`
      SELECT id, status, bank_mutation_id, canonical_bank_mutation_id,
             settlement_journal_id
      FROM sport_center.payment_settlement_batches
      WHERE id = ${settlementId}
      FOR UPDATE
    `));
    if (!settlementRows.length) {
      throw new CanonicalSettlementApprovalError(
        CANONICAL_APPROVAL_CODES.REOPEN_NOT_ELIGIBLE,
        "Settlement canonical tidak ditemukan.",
      );
    }
    const settlement = settlementRows[0] as Record<string, unknown>;
    const settlementJournalId = Number(settlement.settlement_journal_id);
    if (!Number.isSafeInteger(settlementJournalId) || settlementJournalId <= 0) {
      throw new CanonicalSettlementApprovalError(
        CANONICAL_APPROVAL_CODES.JOURNAL_NOT_ELIGIBLE,
        "Settlement canonical tidak memiliki settlement journal.",
      );
    }

    const { rows: journalRows } = await tx.execute(sql.raw(`
      SELECT id, status, journal_type, is_reversal, settlement_batch_id
      FROM sport_center.accounting_journals
      WHERE id = ${settlementJournalId}
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
        "Settlement journal harus tetap posted, bertipe settlement, bukan reversal, dan menunjuk batch yang sama.",
      );
    }

    const state = {
      settlement_status: settlement.status as string,
      settlement_bank_mutation_id: settlement.bank_mutation_id as number | null,
      match_status: match.status as string,
      public_mutation_status: publicMutation.status as string,
    };
    if (isCanonicalReopenIdempotentState(state)) {
      return buildReopenResult(
        settlementId,
        mutationId,
        canonicalMutationId,
        settlementJournalId,
        true,
      );
    }

    if (
      String(settlement.status ?? "").toLowerCase() !== "reconciled" ||
      Number(settlement.bank_mutation_id) !== mutationId ||
      Number(settlement.canonical_bank_mutation_id) !== mutationId ||
      String(match.status ?? "").toLowerCase() !== "approved" ||
      String(publicMutation.status ?? "").toLowerCase() !== "approved"
    ) {
      throw new CanonicalSettlementApprovalError(
        CANONICAL_APPROVAL_CODES.REOPEN_NOT_ELIGIBLE,
        "Canonical link hanya dapat dibuka dari state reconciled/approved yang lengkap.",
      );
    }

    const settlementUpdate = await tx.execute(sql.raw(`
      UPDATE sport_center.payment_settlement_batches
      SET status = 'posted',
          bank_mutation_id = NULL,
          canonical_bank_mutation_id = NULL,
          reconciled_at = NULL,
          reconciled_by = NULL,
          updated_at = NOW()
      WHERE id = ${settlementId}
        AND status = 'reconciled'
        AND bank_mutation_id = ${mutationId}
        AND canonical_bank_mutation_id = ${mutationId}
    `));
    if (!hasRowCount(settlementUpdate)) {
      throw new CanonicalSettlementApprovalError(
        CANONICAL_APPROVAL_CODES.INCONSISTENT_STATE,
        "Settlement berubah saat membuka link canonical.",
      );
    }

    const matchUpdate = await tx.execute(sql.raw(`
      UPDATE bank_reconciliation_matches
      SET status = 'candidate'
      WHERE id = ${Number(match.id)}
        AND mutation_id = ${mutationId}
        AND candidate_type = 'qris_settlement'
        AND candidate_id = ${settlementId}
        AND candidate_source = '${CANONICAL_SETTLEMENT_SOURCE}'
        AND status = 'approved'
    `));
    if (!hasRowCount(matchUpdate)) {
      throw new CanonicalSettlementApprovalError(
        CANONICAL_APPROVAL_CODES.INCONSISTENT_STATE,
        "Match canonical berubah saat membuka link.",
      );
    }

    const publicUpdate = await tx.execute(sql.raw(`
      UPDATE public.bank_mutations
      SET status = 'unmatched',
          journal_entry_id = NULL,
          approved_by = NULL,
          approved_at = NULL,
          posted_by = NULL,
          posted_at = NULL,
          updated_at = NOW()
      WHERE id = ${mutationId}
        AND status = 'approved'
    `));
    if (!hasRowCount(publicUpdate)) {
      throw new CanonicalSettlementApprovalError(
        CANONICAL_APPROVAL_CODES.INCONSISTENT_STATE,
        "Mutasi bank publik berubah saat membuka link.",
      );
    }

    await tx.execute(sql.raw(`
      INSERT INTO bank_reconciliation_audit (mutation_id, action, actor, meta)
      VALUES (
        ${mutationId},
        'CANONICAL_SETTLEMENT_LINK_REMOVED',
        '${escapeSql(actor)}',
        ${jsonSql({
          mutation_id: mutationId,
          canonical_mutation_id: canonicalMutationId,
          candidate_type: "qris_settlement",
          candidate_id: settlementId,
          candidate_source: CANONICAL_SETTLEMENT_SOURCE,
          settlement_journal_id: settlementJournalId,
          journal_reversed: false,
        })}
      )
    `));

    return buildReopenResult(
      settlementId,
      mutationId,
      canonicalMutationId,
      settlementJournalId,
      false,
    );
  });
}

function buildResult(
  settlementId: number,
  mutationId: number,
  canonicalMutationId: number,
  idempotent: boolean,
  manualOverride: boolean,
  historicalRepair = false,
): CanonicalApprovalResult {
  return {
    ok: true,
    idempotent,
    manual_override: manualOverride,
    historical_repair: historicalRepair,
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

function buildReopenResult(
  settlementId: number,
  mutationId: number,
  canonicalMutationId: number,
  settlementJournalId: number,
  idempotent: boolean,
): CanonicalReopenResult {
  return {
    ok: true,
    idempotent,
    action: "canonical_settlement_link_removed",
    candidate_type: "qris_settlement",
    candidate_id: settlementId,
    candidate_source: CANONICAL_SETTLEMENT_SOURCE,
    mutation_id: mutationId,
    canonical_mutation_id: canonicalMutationId,
    settlement_status: CANONICAL_REOPEN_SETTLEMENT_STATUS,
    bank_mutation_status: CANONICAL_REOPEN_BANK_MUTATION_STATUS,
    match_status: CANONICAL_REOPEN_MATCH_STATUS,
    bank_mutation_id: null,
    journal_created: false,
    journal_reversed: false,
    settlement_journal_id: settlementJournalId,
  };
}