import { db } from "@workspace/db";
import { sql } from "drizzle-orm";

/**
 * Canonical Sport Center settlement builder.
 *
 * This module is intentionally an orchestration boundary only.  It never
 * inserts settlement rows, journal rows/lines, or payment-state updates
 * directly.  Those writes remain owned by the canonical SECURITY DEFINER
 * functions in sport_center.
 */

export const CANONICAL_SETTLEMENT_BANK_COA = {
  code: "1-1023-CST",
  name: "Bank Mandiri - Sport Center",
  accountType: "asset",
} as const;

export const CANONICAL_SETTLEMENT_BUILDER_CODES = {
  SOURCE_PAYMENT_REQUIRED: "CANONICAL_SOURCE_PAYMENT_REQUIRED",
  PAYMENT_NOT_FOUND: "CANONICAL_PAYMENT_NOT_FOUND",
  PAYMENT_NOT_ELIGIBLE: "CANONICAL_PAYMENT_NOT_ELIGIBLE",
  PAYMENT_JOURNAL_NOT_POSTED: "CANONICAL_PAYMENT_JOURNAL_NOT_POSTED",
  PAYMENT_JOURNAL_BRIDGE_UNRESOLVED:
    "CANONICAL_PAYMENT_JOURNAL_BRIDGE_UNRESOLVED",
  SETTLEMENT_CONFIG_UNRESOLVED: "CANONICAL_SETTLEMENT_CONFIG_UNRESOLVED",
  SETTLEMENT_CONFIG_AMBIGUOUS: "CANONICAL_SETTLEMENT_CONFIG_AMBIGUOUS",
  SETTLEMENT_GROUP_INVALID: "CANONICAL_SETTLEMENT_GROUP_INVALID",
  BANK_COA_UNRESOLVED: "CANONICAL_SETTLEMENT_BANK_COA_UNRESOLVED",
  BATCH_CONFLICT: "CANONICAL_SETTLEMENT_BATCH_CONFLICT",
  JOURNAL_NOT_POSTED: "CANONICAL_SETTLEMENT_JOURNAL_NOT_POSTED",
  JOURNAL_NOT_BALANCED: "CANONICAL_SETTLEMENT_JOURNAL_NOT_BALANCED",
  PAYMENT_STATE_CONFLICT: "CANONICAL_PAYMENT_SETTLEMENT_STATE_CONFLICT",
  IDEMPOTENCY_CONFLICT: "CANONICAL_SETTLEMENT_IDEMPOTENCY_CONFLICT",
  CONCURRENCY_CONFLICT: "CANONICAL_SETTLEMENT_CONCURRENCY_CONFLICT",
} as const;

export type CanonicalSettlementBuilderCode =
  (typeof CANONICAL_SETTLEMENT_BUILDER_CODES)[keyof typeof CANONICAL_SETTLEMENT_BUILDER_CODES];

export class CanonicalSettlementBuilderError extends Error {
  readonly code: CanonicalSettlementBuilderCode;

  constructor(code: CanonicalSettlementBuilderCode, message: string) {
    super(message);
    this.name = "CanonicalSettlementBuilderError";
    this.code = code;
  }
}

export interface CanonicalSettlementBuildOptions {
  /**
   * An explicit source is required by design.  This prevents a broad call
   * from accidentally selecting a different group or recovering payment 22.
   */
  sourcePaymentId?: number;
  sourceEventId?: string;
  actor: string;
}

export interface CanonicalSettlementBuildResult {
  ok: true;
  idempotent: boolean;
  batchIds: number[];
  itemIds: number[];
  journalIds: number[];
}

type QueryClient = typeof db;
type Row = Record<string, unknown>;

type PaymentIdentity = {
  id: number;
  company_id: number | null;
  provider_id: string | null;
  provider_name: string | null;
  provider_code: string | null;
  bank_account_id: string | null;
  expected_settlement_date: string | null;
  settlement_rule_version: string | null;
  settlement_status: string | null;
  payment_status: string | null;
};

type GroupIdentity = {
  companyId: number;
  providerCode: string;
  bankAccountId: string;
  settlementDate: string;
  ruleVersion: string;
};

function textOrNull(value: unknown): string | null {
  if (value === null || value === undefined) return null;
  const text = String(value).trim();
  return text || null;
}

function numberOrNull(value: unknown): number | null {
  if (value === null || value === undefined || value === "") return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function normalizeProvider(value: unknown): string | null {
  const text = textOrNull(value);
  return text ? text.toLowerCase() : null;
}

/**
 * The database owner uses this same canonical tuple for its advisory lock.
 * Keeping this helper pure makes the serialization contract testable without
 * contacting the database.
 */
export function canonicalSettlementGroupSerialization(
  group: GroupIdentity,
): string {
  const provider = group.providerCode.trim().toLowerCase();
  const bank = group.bankAccountId.trim();
  const rule = group.ruleVersion.trim();
  return (
    `${group.companyId}|${provider}|${bank}|` +
    `${group.settlementDate}|${rule}`
  );
}

function assertGroup(payment: PaymentIdentity): GroupIdentity {
  const companyId = numberOrNull(payment.company_id);
  const providerCode = normalizeProvider(payment.provider_code);
  const bankAccountId = textOrNull(payment.bank_account_id);
  const settlementDate = textOrNull(payment.expected_settlement_date)?.slice(0, 10);
  const ruleVersion = textOrNull(payment.settlement_rule_version);

  if (
    companyId === null ||
    providerCode === null ||
    bankAccountId === null ||
    settlementDate === null ||
    ruleVersion === null
  ) {
    throw new CanonicalSettlementBuilderError(
      CANONICAL_SETTLEMENT_BUILDER_CODES.SETTLEMENT_GROUP_INVALID,
      `Payment ${payment.id} does not have a complete canonical settlement group.`,
    );
  }

  return {
    companyId,
    providerCode,
    bankAccountId,
    settlementDate,
    ruleVersion,
  };
}

function assertSameGroup(
  expected: GroupIdentity,
  payment: PaymentIdentity,
): void {
  const actual = assertGroup(payment);
  if (
    actual.companyId !== expected.companyId ||
    actual.providerCode !== expected.providerCode ||
    actual.bankAccountId !== expected.bankAccountId ||
    actual.settlementDate !== expected.settlementDate ||
    actual.ruleVersion !== expected.ruleVersion
  ) {
    throw new CanonicalSettlementBuilderError(
      CANONICAL_SETTLEMENT_BUILDER_CODES.SETTLEMENT_GROUP_INVALID,
      `Payment ${payment.id} does not belong to the source payment's complete group.`,
    );
  }
}

function assertSource(options: CanonicalSettlementBuildOptions): void {
  if (
    !Number.isSafeInteger(options.sourcePaymentId) &&
    !options.sourceEventId
  ) {
    throw new CanonicalSettlementBuilderError(
      CANONICAL_SETTLEMENT_BUILDER_CODES.SOURCE_PAYMENT_REQUIRED,
      "An explicit sourcePaymentId or sourceEventId is required.",
    );
  }
  if (!textOrNull(options.actor)) {
    throw new CanonicalSettlementBuilderError(
      CANONICAL_SETTLEMENT_BUILDER_CODES.PAYMENT_NOT_ELIGIBLE,
      "An actor is required.",
    );
  }
}

function rows(result: { rows: unknown[] }): Row[] {
  return result.rows as Row[];
}

function rowOrThrow(result: { rows: unknown[] }, code: CanonicalSettlementBuilderCode, message: string): Row {
  const value = rows(result)[0];
  if (!value) throw new CanonicalSettlementBuilderError(code, message);
  return value;
}

function dbErrorCode(error: unknown): string | null {
  const value = error as { code?: unknown; cause?: { code?: unknown } };
  return textOrNull(value?.code) ?? textOrNull(value?.cause?.code);
}

async function resolveCanonicalBankCoa(
  client: QueryClient,
  group: GroupIdentity,
): Promise<string> {
  /*
   * The public coa_id is deliberately not used as a cross-schema foreign key.
   * The resolver proves the public bank-master/chart mapping by business
   * identity, then requires the exact active row in the canonical namespace.
   */
  const result = await client.execute(sql`
    SELECT
      sc.id,
      sc.code,
      sc.name,
      sc.account_type::text AS account_type,
      sc.is_active,
      cba.id AS internal_bank_id,
      cba.account_number::text AS external_account,
      ca.id AS public_coa_id
    FROM public.company_bank_accounts cba
    JOIN public.chart_of_accounts ca
      ON ca.id = cba.coa_id
     AND ca.code = ${CANONICAL_SETTLEMENT_BANK_COA.code}
     AND ca.name = ${CANONICAL_SETTLEMENT_BANK_COA.name}
     AND ca.account_type::text = ${CANONICAL_SETTLEMENT_BANK_COA.accountType}
     AND ca.is_active = TRUE
    JOIN sport_center.coa_accounts sc
      ON sc.code = ca.code
     AND sc.name = ca.name
     AND sc.account_type::text = ca.account_type::text
     AND sc.code = ${CANONICAL_SETTLEMENT_BANK_COA.code}
     AND sc.name = ${CANONICAL_SETTLEMENT_BANK_COA.name}
     AND sc.account_type::text = ${CANONICAL_SETTLEMENT_BANK_COA.accountType}
     AND sc.is_active = TRUE
    WHERE cba.company_id = ${group.companyId}
      AND cba.account_number::text = ${group.bankAccountId}
      AND cba.is_active = TRUE
    FOR UPDATE OF cba, ca, sc
  `);

  const matches = rows(result);
  if (matches.length !== 1) {
    throw new CanonicalSettlementBuilderError(
      CANONICAL_SETTLEMENT_BUILDER_CODES.BANK_COA_UNRESOLVED,
      `Expected exactly one active canonical bank COA for company=${group.companyId}, bank=${group.bankAccountId}; found ${matches.length}.`,
    );
  }

  const match = matches[0];
  if (
    textOrNull(match.code) !== CANONICAL_SETTLEMENT_BANK_COA.code ||
    textOrNull(match.name) !== CANONICAL_SETTLEMENT_BANK_COA.name ||
    textOrNull(match.account_type) !== CANONICAL_SETTLEMENT_BANK_COA.accountType ||
    match.is_active !== true
  ) {
    throw new CanonicalSettlementBuilderError(
      CANONICAL_SETTLEMENT_BUILDER_CODES.BANK_COA_UNRESOLVED,
      "The resolved canonical bank COA does not satisfy the active asset contract.",
    );
  }

  return CANONICAL_SETTLEMENT_BANK_COA.code;
}

async function resolveOwnerApprovedConfig(
  client: QueryClient,
  group: GroupIdentity,
): Promise<Row> {
  const result = await client.execute(sql`
    SELECT
      id, company_id, provider_code, bank_account_id,
      effective_from, effective_until, is_active, source,
      mdr_rate, fixed_provider_fee, fee_tax_rate, fee_tax_inclusive,
      rule_version, currency_code, calculation_method,
      rounding_scale, rounding_method
    FROM sport_center.payment_settlement_configs
    WHERE company_id = ${group.companyId}
      AND lower(btrim(provider_code)) = ${group.providerCode}
      AND bank_account_id = ${group.bankAccountId}
      AND is_active = TRUE
      AND source = 'OWNER_APPROVED'
      AND rule_version = ${group.ruleVersion}
      AND effective_from <= ${group.settlementDate}::date
      AND (effective_until IS NULL OR ${group.settlementDate}::date < effective_until)
    FOR UPDATE
  `);

  const matches = rows(result);
  if (matches.length === 0) {
    throw new CanonicalSettlementBuilderError(
      CANONICAL_SETTLEMENT_BUILDER_CODES.SETTLEMENT_CONFIG_UNRESOLVED,
      `No active OWNER_APPROVED settlement config matches the complete group.`,
    );
  }
  if (matches.length !== 1) {
    throw new CanonicalSettlementBuilderError(
      CANONICAL_SETTLEMENT_BUILDER_CODES.SETTLEMENT_CONFIG_AMBIGUOUS,
      `Multiple active OWNER_APPROVED settlement configs match the complete group.`,
    );
  }

  const config = matches[0];
  if (
    textOrNull(config.calculation_method) === null ||
    numberOrNull(config.rounding_scale) === null ||
    textOrNull(config.rounding_method) === null ||
    numberOrNull(config.fixed_provider_fee) === null ||
    numberOrNull(config.fee_tax_rate) === null
  ) {
    throw new CanonicalSettlementBuilderError(
      CANONICAL_SETTLEMENT_BUILDER_CODES.SETTLEMENT_CONFIG_UNRESOLVED,
      "The owner-approved settlement config has incomplete financial columns.",
    );
  }

  return config;
}

async function lockPaymentJournals(
  client: QueryClient,
  paymentIds: number[],
): Promise<Map<number, Row>> {
  const result = await client.execute(sql`
    SELECT
      j.id, j.payment_id, j.status, j.journal_type, j.is_reversal,
      j.gross_amount, j.source_event_id
    FROM sport_center.accounting_journals j
    WHERE j.payment_id IN (${sql.join(paymentIds.map((id) => sql`${id}`), sql`, `)})
      AND j.journal_type = 'payment_confirmed'
      AND j.is_reversal = FALSE
    ORDER BY j.id
    FOR UPDATE
  `);

  const journalMap = new Map<number, Row>();
  for (const journal of rows(result)) {
    const paymentId = numberOrNull(journal.payment_id);
    if (paymentId === null || journalMap.has(paymentId)) {
      throw new CanonicalSettlementBuilderError(
        CANONICAL_SETTLEMENT_BUILDER_CODES.PAYMENT_JOURNAL_BRIDGE_UNRESOLVED,
        "Each canonical payment must map to exactly one payment_confirmed journal.",
      );
    }
    if (textOrNull(journal.status) !== "posted") {
      throw new CanonicalSettlementBuilderError(
        CANONICAL_SETTLEMENT_BUILDER_CODES.PAYMENT_JOURNAL_NOT_POSTED,
        `Payment journal ${journal.id} is not posted.`,
      );
    }
    journalMap.set(paymentId, journal);
  }

  if (journalMap.size !== paymentIds.length) {
    throw new CanonicalSettlementBuilderError(
      CANONICAL_SETTLEMENT_BUILDER_CODES.PAYMENT_JOURNAL_BRIDGE_UNRESOLVED,
      "One or more canonical payments has no unique posted payment journal.",
    );
  }
  return journalMap;
}

async function assertActiveItemsAbsent(
  client: QueryClient,
  paymentIds: number[],
): Promise<void> {
  const result = await client.execute(sql`
    SELECT payment_id, settlement_id
    FROM sport_center.payment_settlement_items
    WHERE item_status = 'active'
      AND payment_id IN (${sql.join(paymentIds.map((id) => sql`${id}`), sql`, `)})
    FOR UPDATE
  `);
  if (rows(result).length) {
    throw new CanonicalSettlementBuilderError(
      CANONICAL_SETTLEMENT_BUILDER_CODES.BATCH_CONFLICT,
      `At least one source payment already belongs to an active canonical settlement.`,
    );
  }
}

async function assertBatchResult(
  client: QueryClient,
  batchId: number,
  group: GroupIdentity,
  paymentIds: number[],
  expectedStatus: "posted" | "reconciled",
): Promise<{ itemIds: number[]; journalId: number; idempotent: boolean }> {
  const batch = rowOrThrow(
    await client.execute(sql`
      SELECT id, company_id, provider_code, bank_account_id, settlement_date,
             settlement_rule_version, status, bank_mutation_id,
             gross_amount, mdr_amount, provider_fee_amount, fee_tax_amount,
             tax_withheld_amount, adjustment_amount, net_amount,
             settlement_journal_id, source, correlation_id
      FROM sport_center.payment_settlement_batches
      WHERE id = ${batchId}
      FOR UPDATE
    `),
    CANONICAL_SETTLEMENT_BUILDER_CODES.BATCH_CONFLICT,
    `Canonical settlement batch ${batchId} was not found after owner execution.`,
  );

  if (
    numberOrNull(batch.company_id) !== group.companyId ||
    normalizeProvider(batch.provider_code) !== group.providerCode ||
    textOrNull(batch.bank_account_id) !== group.bankAccountId ||
    textOrNull(batch.settlement_date)?.slice(0, 10) !== group.settlementDate ||
    textOrNull(batch.settlement_rule_version) !== group.ruleVersion ||
    textOrNull(batch.source) !== "SPORT_CENTER" ||
    batch.bank_mutation_id != null ||
    ![expectedStatus].includes(textOrNull(batch.status) as "posted" | "reconciled")
  ) {
    throw new CanonicalSettlementBuilderError(
      CANONICAL_SETTLEMENT_BUILDER_CODES.BATCH_CONFLICT,
      `Canonical settlement batch ${batchId} does not satisfy the builder contract.`,
    );
  }

  const itemResult = await client.execute(sql`
    SELECT id, payment_id, payment_journal_id, gross_amount, item_status
    FROM sport_center.payment_settlement_items
    WHERE settlement_id = ${batchId}
      AND item_status = 'active'
    ORDER BY payment_id
    FOR UPDATE
  `);
  const itemRows = rows(itemResult);
  const actualPaymentIds = itemRows.map((row) => numberOrNull(row.payment_id));
  if (
    itemRows.length !== paymentIds.length ||
    actualPaymentIds.some((id, index) => id !== paymentIds[index])
  ) {
    throw new CanonicalSettlementBuilderError(
      CANONICAL_SETTLEMENT_BUILDER_CODES.IDEMPOTENCY_CONFLICT,
      `Canonical settlement batch ${batchId} has a different active payment set.`,
    );
  }

  const journalId = numberOrNull(batch.settlement_journal_id);
  if (journalId === null) {
    throw new CanonicalSettlementBuilderError(
      CANONICAL_SETTLEMENT_BUILDER_CODES.JOURNAL_NOT_POSTED,
      `Canonical settlement batch ${batchId} has no settlement journal.`,
    );
  }
  const journal = rowOrThrow(
    await client.execute(sql`
      SELECT id, settlement_batch_id, journal_type, status, is_reversal,
             gross_amount
      FROM sport_center.accounting_journals
      WHERE id = ${journalId}
      FOR UPDATE
    `),
    CANONICAL_SETTLEMENT_BUILDER_CODES.JOURNAL_NOT_POSTED,
    `Settlement journal ${journalId} was not found.`,
  );
  if (
    textOrNull(journal.status) !== "posted" ||
    textOrNull(journal.journal_type) !== "settlement" ||
    journal.is_reversal === true ||
    numberOrNull(journal.settlement_batch_id) !== batchId
  ) {
    throw new CanonicalSettlementBuilderError(
      CANONICAL_SETTLEMENT_BUILDER_CODES.JOURNAL_NOT_POSTED,
      `Settlement journal ${journalId} is not a posted non-reversal journal for this batch.`,
    );
  }

  const balance = rowOrThrow(
    await client.execute(sql`
      SELECT
        round(coalesce(sum(amount) FILTER (WHERE line_type = 'debit'), 0), 2) AS debit,
        round(coalesce(sum(amount) FILTER (WHERE line_type = 'credit'), 0), 2) AS credit
      FROM sport_center.accounting_journal_lines
      WHERE journal_id = ${journalId}
    `),
    CANONICAL_SETTLEMENT_BUILDER_CODES.JOURNAL_NOT_BALANCED,
    `Settlement journal ${journalId} has no readable lines.`,
  );
  if (Number(balance.debit) !== Number(balance.credit)) {
    throw new CanonicalSettlementBuilderError(
      CANONICAL_SETTLEMENT_BUILDER_CODES.JOURNAL_NOT_BALANCED,
      `Settlement journal ${journalId} is not balanced.`,
    );
  }

  const paymentStateResult = await client.execute(sql`
    SELECT id, settlement_status
    FROM sport_center.sport_payments
    WHERE id IN (${sql.join(paymentIds.map((id) => sql`${id}`), sql`, `)})
    ORDER BY id
    FOR UPDATE
  `);
  for (const payment of rows(paymentStateResult)) {
    if (textOrNull(payment.settlement_status) !== "settled") {
      throw new CanonicalSettlementBuilderError(
        CANONICAL_SETTLEMENT_BUILDER_CODES.PAYMENT_STATE_CONFLICT,
        `Payment ${payment.id} is not settled after canonical finalization.`,
      );
    }
  }

  return {
    itemIds: itemRows.map((row) => Number(row.id)),
    journalId,
    idempotent: true,
  };
}

async function buildInTransaction(
  client: QueryClient,
  options: CanonicalSettlementBuildOptions,
): Promise<CanonicalSettlementBuildResult> {
  assertSource(options);

  const sourceFilters = [
    options.sourcePaymentId != null
      ? sql`p.id = ${options.sourcePaymentId}`
      : sql`TRUE`,
    options.sourceEventId
      ? sql`EXISTS (
          SELECT 1
          FROM sport_center.accounting_journals source_j
          WHERE source_j.payment_id = p.id
            AND source_j.source_event_id = ${options.sourceEventId}::uuid
        )`
      : sql`TRUE`,
  ];
  const sourceResult = await client.execute(sql`
    SELECT
      p.id, p.company_id, p.provider_id, p.provider_name,
      lower(btrim(p.payment_provider::text)) AS provider_code,
      p.bank_account_id::text AS bank_account_id,
      p.expected_settlement_date::text AS expected_settlement_date,
      p.settlement_rule_version,
      p.settlement_status,
      p.status::text AS payment_status
    FROM sport_center.sport_payments p
    WHERE ${sql.join(sourceFilters, sql` AND `)}
    FOR UPDATE
  `);
  const sourceRow = rowOrThrow(
    sourceResult,
    CANONICAL_SETTLEMENT_BUILDER_CODES.PAYMENT_NOT_FOUND,
    "The explicit canonical source payment was not found.",
  );
  const source: PaymentIdentity = {
    id: Number(sourceRow.id),
    company_id: numberOrNull(sourceRow.company_id),
    provider_id: textOrNull(sourceRow.provider_id),
    provider_name: textOrNull(sourceRow.provider_name),
    provider_code: normalizeProvider(sourceRow.provider_code),
    bank_account_id: textOrNull(sourceRow.bank_account_id),
    expected_settlement_date: textOrNull(sourceRow.expected_settlement_date),
    settlement_rule_version: textOrNull(sourceRow.settlement_rule_version),
    settlement_status: textOrNull(sourceRow.settlement_status),
    payment_status: textOrNull(sourceRow.payment_status),
  };
  const group = assertGroup(source);

  const groupResult = await client.execute(sql`
    SELECT
      p.id, p.company_id, p.provider_id, p.provider_name,
      lower(btrim(p.payment_provider::text)) AS provider_code,
      p.bank_account_id::text AS bank_account_id,
      p.expected_settlement_date::text AS expected_settlement_date,
      p.settlement_rule_version,
      p.settlement_status,
      p.status::text AS payment_status
    FROM sport_center.sport_payments p
    WHERE p.status::text = 'confirmed'
      AND p.company_id = ${group.companyId}
      AND lower(btrim(p.payment_provider::text)) = ${group.providerCode}
      AND p.bank_account_id::text = ${group.bankAccountId}
      AND p.expected_settlement_date::date = ${group.settlementDate}::date
      AND p.settlement_rule_version = ${group.ruleVersion}
    ORDER BY p.id
    FOR UPDATE
  `);
  const payments = rows(groupResult).map((row): PaymentIdentity => ({
    id: Number(row.id),
    company_id: numberOrNull(row.company_id),
    provider_id: textOrNull(row.provider_id),
    provider_name: textOrNull(row.provider_name),
    provider_code: normalizeProvider(row.provider_code),
    bank_account_id: textOrNull(row.bank_account_id),
    expected_settlement_date: textOrNull(row.expected_settlement_date),
    settlement_rule_version: textOrNull(row.settlement_rule_version),
    settlement_status: textOrNull(row.settlement_status),
    payment_status: textOrNull(row.payment_status),
  }));
  if (!payments.some((payment) => payment.id === source.id)) {
    throw new CanonicalSettlementBuilderError(
      CANONICAL_SETTLEMENT_BUILDER_CODES.PAYMENT_NOT_ELIGIBLE,
      `Source payment ${source.id} is not a confirmed member of its canonical group.`,
    );
  }
  for (const payment of payments) assertSameGroup(group, payment);
  if (payments.some((payment) => payment.payment_status !== "confirmed")) {
    throw new CanonicalSettlementBuilderError(
      CANONICAL_SETTLEMENT_BUILDER_CODES.PAYMENT_NOT_ELIGIBLE,
      "Every payment in the canonical group must be confirmed.",
    );
  }

  await resolveOwnerApprovedConfig(client, group);
  const bankCoaCode = await resolveCanonicalBankCoa(client, group);
  const paymentIds = payments.map((payment) => payment.id);
  const journals = await lockPaymentJournals(client, paymentIds);

  /*
   * Existing posted/reconciled batches are checked before the unsettled
   * requirement so exact retries are idempotent.  A partial active item set
   * is never treated as success.
   */
  const groupLock = canonicalSettlementGroupSerialization(group);
  await client.execute(sql`
    SELECT pg_advisory_xact_lock(hashtext(${groupLock}))
  `);
  const existingResult = await client.execute(sql`
    SELECT id, status
    FROM sport_center.payment_settlement_batches
    WHERE company_id = ${group.companyId}
      AND lower(provider_code) = ${group.providerCode}
      AND bank_account_id = ${group.bankAccountId}
      AND settlement_date = ${group.settlementDate}::date
      AND settlement_rule_version = ${group.ruleVersion}
      AND status IN ('draft', 'calculated', 'posted', 'reconciled')
    FOR UPDATE
  `);
  const existing = rows(existingResult);
  if (existing.length > 1) {
    throw new CanonicalSettlementBuilderError(
      CANONICAL_SETTLEMENT_BUILDER_CODES.CONCURRENCY_CONFLICT,
      "More than one active canonical batch exists for the complete group.",
    );
  }

  if (existing.length === 1) {
    const batchId = Number(existing[0].id);
    const status = textOrNull(existing[0].status);
    const itemResult = await client.execute(sql`
      SELECT id, payment_id
      FROM sport_center.payment_settlement_items
      WHERE settlement_id = ${batchId}
        AND item_status = 'active'
      ORDER BY payment_id
      FOR UPDATE
    `);
    const itemRows = rows(itemResult);
    const actualIds = itemRows.map((row) => Number(row.payment_id));
    if (
      actualIds.length !== paymentIds.length ||
      actualIds.some((id, index) => id !== paymentIds[index])
    ) {
      throw new CanonicalSettlementBuilderError(
        CANONICAL_SETTLEMENT_BUILDER_CODES.IDEMPOTENCY_CONFLICT,
        `Existing canonical batch ${batchId} has a different active payment set.`,
      );
    }

    if (status === "posted" || status === "reconciled") {
      const verified = await assertBatchResult(
        client,
        batchId,
        group,
        paymentIds,
        status,
      );
      return {
        ok: true,
        idempotent: true,
        batchIds: [batchId],
        itemIds: verified.itemIds,
        journalIds: [verified.journalId],
      };
    }
    if (status !== "calculated") {
      throw new CanonicalSettlementBuilderError(
        CANONICAL_SETTLEMENT_BUILDER_CODES.BATCH_CONFLICT,
        `Existing canonical batch ${batchId} is not safely resumable from calculated state.`,
      );
    }
  } else {
    if (
      payments.some(
        (payment) => payment.settlement_status !== "unsettled",
      )
    ) {
      throw new CanonicalSettlementBuilderError(
        CANONICAL_SETTLEMENT_BUILDER_CODES.PAYMENT_NOT_ELIGIBLE,
        "A new canonical settlement requires every payment to be unsettled.",
      );
    }
    await assertActiveItemsAbsent(client, paymentIds);
  }

  const batchResult = await client.execute(sql`
    SELECT sport_center.create_payment_settlement_batch(
      ${`SCB1-${groupLock}`},
      ${group.companyId},
      ${group.providerCode},
      ${group.bankAccountId},
      ${group.settlementDate}::date,
      ARRAY[${sql.join(paymentIds.map((id) => sql`${id}`), sql`, `)}]::integer[],
      ${options.actor}
    ) AS id
  `);
  const batchId = Number(
    rowOrThrow(
      batchResult,
      CANONICAL_SETTLEMENT_BUILDER_CODES.BATCH_CONFLICT,
      "The canonical batch owner did not return a batch ID.",
    ).id,
  );
  const batchAfterCreate = rowOrThrow(
    await client.execute(sql`
      SELECT id, status, bank_mutation_id, gross_amount, mdr_amount,
             provider_fee_amount, fee_tax_amount, tax_withheld_amount,
             adjustment_amount, net_amount, settlement_rule_version
      FROM sport_center.payment_settlement_batches
      WHERE id = ${batchId}
      FOR UPDATE
    `),
    CANONICAL_SETTLEMENT_BUILDER_CODES.BATCH_CONFLICT,
    `Canonical batch ${batchId} was not created by its owner.`,
  );
  if (
    textOrNull(batchAfterCreate.status) !== "calculated" ||
    batchAfterCreate.bank_mutation_id != null ||
    textOrNull(batchAfterCreate.settlement_rule_version) !== group.ruleVersion
  ) {
    throw new CanonicalSettlementBuilderError(
      CANONICAL_SETTLEMENT_BUILDER_CODES.BATCH_CONFLICT,
      `Canonical batch ${batchId} is not a valid calculated batch.`,
    );
  }

  const draftResult = await client.execute(sql`
    SELECT sport_center.create_settlement_journal_draft(
      ${batchId}::bigint,
      ${bankCoaCode},
      ${options.actor}
    ) AS id
  `);
  const journalId = Number(
    rowOrThrow(
      draftResult,
      CANONICAL_SETTLEMENT_BUILDER_CODES.JOURNAL_NOT_POSTED,
      "The canonical settlement journal owner did not return a journal ID.",
    ).id,
  );
  await client.execute(sql`
    SELECT sport_center.finalize_payment_settlement(
      ${batchId}::bigint,
      ${options.actor}
    ) AS id
  `);

  const verified = await assertBatchResult(
    client,
    batchId,
    group,
    paymentIds,
    "posted",
  );
  if (verified.journalId !== journalId) {
    throw new CanonicalSettlementBuilderError(
      CANONICAL_SETTLEMENT_BUILDER_CODES.IDEMPOTENCY_CONFLICT,
      `Canonical journal owner returned ${journalId} but batch points to ${verified.journalId}.`,
    );
  }

  return {
    ok: true,
    idempotent: false,
    batchIds: [batchId],
    itemIds: verified.itemIds,
    journalIds: [journalId],
  };
}

export async function buildCanonicalSportCenterSettlements(
  options: CanonicalSettlementBuildOptions,
  client: QueryClient = db,
): Promise<CanonicalSettlementBuildResult> {
  try {
    return await client.transaction((tx) =>
      buildInTransaction(tx as QueryClient, options),
    );
  } catch (error) {
    if (error instanceof CanonicalSettlementBuilderError) throw error;

    const pgCode = dbErrorCode(error);
    if (pgCode === "23505") {
      throw new CanonicalSettlementBuilderError(
        CANONICAL_SETTLEMENT_BUILDER_CODES.CONCURRENCY_CONFLICT,
        "A canonical settlement uniqueness backstop rejected a concurrent or duplicate build.",
      );
    }
    throw error;
  }
}