import { db } from "@workspace/db";
import { sql } from "drizzle-orm";
import {
  generateQrisMutationBatchCandidates,
  type QrisMutationBatchCandidate,
  type QrisMutationCandidateInput,
  type QrisPaymentCandidateInput,
} from "./qrisCandidateEngine.js";
import {
  normalizeQrisProvider,
  providerRulesByBankAccountFromRows,
  providerRulesFromRows,
} from "./providerSettlementRules.js";

function esc(value: unknown): string {
  return String(value ?? "").replace(/'/g, "''");
}

// ── Canonical settlement schema availability ──────────────────────────────────
// sport_center.payment_settlement_batches / _items may not exist on all DBs
// (they are created by runSportCenterMigration which runs asynchronously).
// We cache the result to avoid repeated to_regclass() calls.
let _canonicalSchemaKnown = false;
let _canonicalSchemaAvailable = false;

async function hasCanonicalSettlementSchema(): Promise<boolean> {
  if (_canonicalSchemaKnown) return _canonicalSchemaAvailable;
  try {
    const { rows } = await db.execute(sql.raw(
      `SELECT to_regclass('sport_center.payment_settlement_items') AS s`,
    ));
    _canonicalSchemaAvailable = (rows[0] as Record<string, unknown>)?.s != null;
  } catch {
    _canonicalSchemaAvailable = false;
  }
  _canonicalSchemaKnown = true;
  return _canonicalSchemaAvailable;
}

// ── Phase 4C column availability for sport_center.sport_payments ──────────────
// Columns added in Phase 4C (settlement_rule_version, payment_provider,
// expected_settlement_date, bank_account_id) may be absent on older DB snapshots.
// Check once and cache; fallback to NULL literals when absent.
let _phase4ColsKnown = false;
let _phase4ColsAvailable = false;

async function hasQrisPaymentPhase4Columns(): Promise<boolean> {
  if (_phase4ColsKnown) return _phase4ColsAvailable;
  try {
    const { rows } = await db.execute(sql.raw(`
      SELECT 1 FROM information_schema.columns
      WHERE table_schema = 'sport_center'
        AND table_name   = 'sport_payments'
        AND column_name  = 'settlement_rule_version'
      LIMIT 1
    `));
    _phase4ColsAvailable = (rows as unknown[]).length > 0;
  } catch {
    _phase4ColsAvailable = false;
  }
  _phase4ColsKnown = true;
  return _phase4ColsAvailable;
}

// SQL fragments for Phase 4C columns — degrade to NULLs when columns are absent.
function makePhase4PaymentFragments(available: boolean) {
  return {
    providerCodeSql:        available ? `LOWER(BTRIM(sp.payment_provider::text))` : `NULL::text`,
    settlementDateSql:      available ? `sp.expected_settlement_date`              : `NULL::date`,
    settlementRuleVerSql:   available ? `sp.settlement_rule_version`               : `NULL::text`,
    paymentBankAccountSql:  available ? `sp.bank_account_id`                       : `NULL::text`,
  };
}

// SQL fragments used when canonical settlement tables exist.
// If the tables are absent these fragments evaluate to empty strings,
// leaving the surrounding SQL structurally valid but without canonical data.
function makeCanonicalFragments(available: boolean) {
  const canonicalSettlementIdSql = available
    ? `(
           SELECT psi.settlement_id
           FROM sport_center.payment_settlement_items psi
           JOIN sport_center.payment_settlement_batches psb
             ON psb.id = psi.settlement_id
           WHERE psi.payment_id = sp.id
             AND psi.item_status = 'active'
           ORDER BY CASE WHEN psb.status IN ('posted', 'reconciled') THEN 0 ELSE 1 END,
                    psi.settlement_id DESC
           LIMIT 1
         )`
    : "NULL::int";

  const alreadyReconciledSql = available
    ? `EXISTS (
           SELECT 1
           FROM sport_center.payment_settlement_items psi
           JOIN sport_center.payment_settlement_batches psb
             ON psb.id = psi.settlement_id
           WHERE psi.payment_id = sp.id
             AND psi.item_status = 'active'
             AND psb.status IN ('posted', 'reconciled')
         )`
    : "FALSE";

  // SUM of net amounts of current canonical settlement batches for these payments
  const currentExpectedAmountSql = available
    ? `COALESCE((
              SELECT SUM(current_settlements.net_amount)
              FROM (
                SELECT DISTINCT psb.id, psb.net_amount
                FROM sport_center.payment_settlement_items psi
                JOIN sport_center.payment_settlement_batches psb
                  ON psb.id = psi.settlement_id
                WHERE psi.item_status = 'active'
                  AND psi.payment_id IN (
                    SELECT (item->>'paymentId')::int
                    FROM jsonb_array_elements(c.payment_items) item
                    WHERE item->>'paymentId' IS NOT NULL
                  )
              ) current_settlements
            ), bm.amount)`
    : "bm.amount";

  // NOT EXISTS for canonical settlement (used in current_payment_ids / current_gross_amount)
  const canonicalSettledExcludeSql = available
    ? `AND NOT EXISTS (
                    SELECT 1
                    FROM sport_center.payment_settlement_items psi
                    JOIN sport_center.payment_settlement_batches psb
                      ON psb.id = psi.settlement_id
                    WHERE psi.payment_id = (item->>'paymentId')::int
                      AND psi.item_status = 'active'
                      AND psb.status IN ('posted', 'reconciled')
                  )`
    : "";

  const canonicalSettledExcludeByIdSql = available
    ? `AND NOT EXISTS (
                    SELECT 1
                    FROM sport_center.payment_settlement_items psi
                    JOIN sport_center.payment_settlement_batches psb
                      ON psb.id = psi.settlement_id
                    WHERE psi.payment_id = sp.id
                      AND psi.item_status = 'active'
                      AND psb.status IN ('posted', 'reconciled')
                  )`
    : "";

  // Current evidence valid: does the canonical settlement total match bm.amount?
  const currentEvidenceValidSql = available
    ? `ABS(COALESCE((
              SELECT SUM(current_settlements.net_amount)
              FROM (
                SELECT DISTINCT psb.id, psb.net_amount
                FROM sport_center.payment_settlement_items psi
                JOIN sport_center.payment_settlement_batches psb
                  ON psb.id = psi.settlement_id
                WHERE psi.item_status = 'active'
                  AND psi.payment_id IN (
                    SELECT (item->>'paymentId')::int
                    FROM jsonb_array_elements(c.payment_items) item
                    WHERE item->>'paymentId' IS NOT NULL
                  )
              ) current_settlements
            ), bm.amount) - bm.amount) <= 0.01`
    : "TRUE";

  // UNION with canonical settlement items in settled_payment_ids
  const canonicalSettledUnionSql = available
    ? `UNION
                SELECT psi.payment_id
                FROM sport_center.payment_settlement_items psi
                JOIN sport_center.payment_settlement_batches psb
                  ON psb.id = psi.settlement_id
                WHERE psi.item_status = 'active'
                  AND psb.status IN ('posted', 'reconciled')
                  AND psi.payment_id IN (
                    SELECT (item->>'paymentId')::int
                    FROM jsonb_array_elements(c.payment_items) item
                    WHERE item->>'paymentId' IS NOT NULL
                  )`
    : "";

  return {
    canonicalSettlementIdSql,
    alreadyReconciledSql,
    currentExpectedAmountSql,
    canonicalSettledExcludeSql,
    canonicalSettledExcludeByIdSql,
    currentEvidenceValidSql,
    canonicalSettledUnionSql,
  };
}

function asDate(value: unknown): string | null {
  const result = String(value ?? "").slice(0, 10);
  return /^\d{4}-\d{2}-\d{2}$/.test(result) ? result : null;
}

export interface QrisCandidateGenerationResult {
  dryRun: boolean;
  generated: number;
  candidates: QrisMutationBatchCandidate[];
}

export async function generateQrisCandidates(options: {
  companyId?: number | null;
  from?: string | null;
  to?: string | null;
  dryRun?: boolean;
} = {}): Promise<QrisCandidateGenerationResult> {
  const companyFilter = options.companyId && Number.isInteger(options.companyId)
    ? `AND sp.company_id = ${Number(options.companyId)}`
    : "";
  const mutationCompanyFilter = options.companyId && Number.isInteger(options.companyId)
    ? `AND bm.company_id = ${Number(options.companyId)}`
    : "";
  const dateFilter = options.from ? `AND bm.transaction_date >= '${esc(options.from)}'` : "";
  const toFilter = options.to ? `AND bm.transaction_date <= '${esc(options.to)}'` : "";

  const [canonicalAvailable, phase4Available] = await Promise.all([
    hasCanonicalSettlementSchema(),
    hasQrisPaymentPhase4Columns(),
  ]);
  const {
    canonicalSettlementIdSql,
    alreadyReconciledSql,
  } = makeCanonicalFragments(canonicalAvailable);
  const {
    providerCodeSql,
    settlementDateSql,
    settlementRuleVerSql,
    paymentBankAccountSql,
  } = makePhase4PaymentFragments(phase4Available);

  const [paymentRows, mutationRows, holidayRows, ruleRows, existingRows] = await Promise.all([
    db.execute(sql.raw(`
      SELECT
        sp.id, sp.company_id, sp.amount, sp.payment_method AS method,
        CASE WHEN LOWER(COALESCE(sp.status::text, '')) = 'confirmed'
          THEN 'paid' ELSE sp.status::text END AS status,
        COALESCE(sp.confirmed_at, sp.created_at) AS paid_at,
        'SCPAY-SC-' || sp.id::text AS payment_number,
        sp.booking_id, sb.order_number AS booking_number,
        sb.customer_name,
        COALESCE(sf.name, '') AS facility_name,
        sb.booking_date,
        sb.start_time::text AS start_time,
        sb.end_time::text AS end_time,
        ${providerCodeSql} AS provider_code,
        ${settlementDateSql} AS settlement_date,
        ${settlementRuleVerSql} AS settlement_rule_version,
        NULL::text AS settlement_reference,
        ${paymentBankAccountSql} AS bank_account_id,
        ${canonicalSettlementIdSql} AS canonical_settlement_id,
        ${alreadyReconciledSql} AS already_reconciled
      FROM sport_center.sport_payments sp
      LEFT JOIN sport_center.sport_bookings sb ON sb.id = sp.booking_id
      LEFT JOIN sport_center.sport_facilities sf ON sf.id = sb.facility_id
      WHERE LOWER(COALESCE(sp.payment_method::text, '')) LIKE '%qris%'
        AND LOWER(COALESCE(sp.status::text, '')) = 'confirmed'
        ${companyFilter}
    `)),
    db.execute(sql.raw(`
      SELECT
        bm.id, bm.company_id,
         bm.mutation_key,
        (
          SELECT CASE WHEN COUNT(*) = 1 THEN MIN(matches.id)::text END
          FROM (
            SELECT cba.id
            FROM company_bank_accounts cba
            WHERE cba.is_active = TRUE
              AND (cba.company_id = bm.company_id OR cba.company_id IS NULL)
              AND (
                (
                  NULLIF(BTRIM(bm.bank_account_id::text), '') IS NOT NULL
                  AND cba.id::text = NULLIF(BTRIM(bm.bank_account_id::text), '')
                )
                OR (
                  NULLIF(BTRIM(bm.bank_account_id::text), '') IS NULL
                  AND bm.source_account IS NOT NULL
                  AND regexp_replace(bm.source_account, '[^0-9]', '', 'g')
                    <> ''
                  AND regexp_replace(bm.source_account, '[^0-9]', '', 'g')
                    = regexp_replace(cba.account_number, '[^0-9]', '', 'g')
                )
                OR (
                  NULLIF(BTRIM(bm.bank_account_id::text), '') IS NULL
                  AND regexp_replace(cba.account_number, '[^0-9]', '', 'g') <> ''
                  AND POSITION(
                    regexp_replace(cba.account_number, '[^0-9]', '', 'g')
                    IN regexp_replace(COALESCE(bm.description, ''), '[^0-9]', '', 'g')
                  ) > 0
                )
              )
          ) matches
        ) AS bank_account_id,
        bm.transaction_date, bm.amount,
        bm.direction, bm.source, bm.source_classification, bm.provider_name,
        bm.provider_order_id, bm.description, bm.status
      FROM bank_mutations bm
      WHERE bm.direction = 'IN'
        AND COALESCE(bm.source_classification, 'unknown') <> 'synthetic'
        AND LOWER(COALESCE(bm.status, 'unmatched')) NOT IN
          ('posted', 'approved', 'approved_pending_posting', 'void')
        ${mutationCompanyFilter}
        ${dateFilter}
        ${toFilter}
      ORDER BY bm.transaction_date, bm.id
    `)),
    db.execute(sql.raw(`
      SELECT holiday_date
      FROM qris_business_calendar_holidays
      WHERE is_active = TRUE
        AND (company_id IS NULL OR company_id = ${options.companyId ? Number(options.companyId) : "0"})
    `)).catch(() => ({ rows: [] as unknown[] })),
    db.execute(sql.raw(`
      SELECT company_id, bank_account_id, provider_code, rule_version,
             settlement_delay_business_days, match_window_business_days,
             max_effective_deduction_rate
      FROM qris_provider_settlement_rules
      WHERE is_active = TRUE
        AND (company_id IS NULL OR company_id = ${options.companyId ? Number(options.companyId) : "0"})
    `)).catch(() => ({ rows: [] as unknown[] })),
    db.execute(sql.raw(`
       SELECT id, mutation_id, status, gross_amount, net_amount, payment_items
      FROM qris_mutation_batch_candidates
       ORDER BY id DESC
    `)).catch(() => ({ rows: [] as unknown[] })),
  ]);

  const holidays = (holidayRows.rows as Array<Record<string, unknown>>)
    .map((row) => asDate(row.holiday_date))
    .filter((value): value is string => Boolean(value));
  const rules = providerRulesFromRows(
    ruleRows.rows as Array<Record<string, unknown>>,
    { includeDefaults: false },
  );
  const accountRules = providerRulesByBankAccountFromRows(
    ruleRows.rows as Array<Record<string, unknown>>,
  );

  const payments: QrisPaymentCandidateInput[] = (paymentRows.rows as Array<Record<string, unknown>>).map((row) => {
    const providerCode = normalizeQrisProvider(String(row.provider_code ?? "unknown"));
    return {
      id: Number(row.id),
      companyId: row.company_id == null ? null : Number(row.company_id),
      bankAccountId: row.bank_account_id == null ? null : Number(row.bank_account_id),
      amount: Number(row.amount ?? 0),
      method: String(row.method ?? ""),
      status: String(row.status ?? ""),
      paidAt: row.paid_at as string | null,
      expectedSettlementDate: asDate(row.settlement_date),
      settlementRuleVersion: row.settlement_rule_version == null
        ? null
        : String(row.settlement_rule_version).trim() || null,
      providerName: providerCode,
      providerReference: row.settlement_reference == null ? null : String(row.settlement_reference),
      paymentNumber: row.payment_number == null ? null : String(row.payment_number),
      bookingId: row.booking_id == null ? null : Number(row.booking_id),
      bookingNumber: row.booking_number == null ? null : String(row.booking_number),
      customerName: row.customer_name == null ? null : String(row.customer_name),
      facilityName: row.facility_name == null ? null : String(row.facility_name),
      bookingDate: row.booking_date == null ? null : String(row.booking_date).slice(0, 10),
      startTime: row.start_time == null ? null : String(row.start_time),
      endTime: row.end_time == null ? null : String(row.end_time),
      paymentDate: row.paid_at == null
        ? null
        : String(row.paid_at),
      alreadyReconciled: Boolean(row.already_reconciled),
       canonicalSettlementId: row.canonical_settlement_id == null
         ? null
         : Number(row.canonical_settlement_id),
    };
  });
  const mutations: QrisMutationCandidateInput[] = (mutationRows.rows as Array<Record<string, unknown>>).map((row) => ({
    id: Number(row.id),
    companyId: row.company_id == null ? null : Number(row.company_id),
    bankAccountId: row.bank_account_id == null ? null : Number(row.bank_account_id),
    transactionDate: asDate(row.transaction_date) ?? "",
    amount: Number(row.amount ?? 0),
    direction: String(row.direction ?? ""),
    source: row.source == null ? null : String(row.source),
    sourceClassification: row.source_classification == null ? null : String(row.source_classification),
    providerName: row.provider_name == null ? null : String(row.provider_name),
    providerOrderId: row.provider_order_id == null ? null : String(row.provider_order_id),
    description: row.description == null ? null : String(row.description),
    status: row.status == null ? null : String(row.status),
  })).filter((row) => row.transactionDate);

  // Recompute existing provisional rows as well. A bank mutation can be
  // imported before the Sport Center payment sync finishes; skipping an
  // existing mutation would permanently preserve an empty/stale candidate.
  // This table is provisional only, so refreshing it does not approve, post,
  // or consume any bank evidence.
  const candidates = generateQrisMutationBatchCandidates({
    payments,
    mutations,
    holidays,
    providerRules: rules,
    accountProviderRules: accountRules,
    requireExplicitSettlementMetadata: true,
  });
  const persistableCandidates = candidates.filter((candidate) =>
    candidate.paymentItems.length > 0
      && Boolean(candidate.estimatedSettlementDate)
      && Boolean(candidate.settlementRuleVersion),
  );
  const persistableMutationIds = new Set(
    persistableCandidates.map((candidate) => candidate.mutationId),
  );

  if (!options.dryRun) {
    for (const candidate of candidates) {
      // qris_mutation_batch_candidates has a non-null estimated date for
      // historical schema compatibility. Do not satisfy that constraint with
      // the bank mutation date when canonical payment metadata is absent.
      // Such an empty candidate is visible in dry-run output but is never
      // persisted or made approvable.
      if (
        candidate.paymentItems.length === 0
        || !candidate.estimatedSettlementDate
        || !candidate.settlementRuleVersion
      ) {
        continue;
      }
      const itemJson = JSON.stringify(candidate.paymentItems);
      const existing = (existingRows.rows as Array<Record<string, unknown>>).find((row) =>
        Number(row.mutation_id) === candidate.mutationId
        && !["approved", "completed", "superseded", "stale", "ineligible"]
          .includes(String(row.status ?? "").toLowerCase()),
      );
      const existingItems = existing?.payment_items == null
        ? []
        : typeof existing.payment_items === "string"
          ? JSON.parse(existing.payment_items)
          : existing.payment_items;
      const normalizeItems = (items: unknown) => JSON.stringify(
        Array.isArray(items)
          ? items.map((item: Record<string, unknown>) => ({
            paymentId: Number(item.paymentId ?? item.payment_id),
            grossAmount: Number(item.grossAmount ?? item.gross_amount ?? 0),
            canonicalSettlementId: item.canonicalSettlementId == null
              ? item.canonical_settlement_id == null
                ? null
                : Number(item.canonical_settlement_id)
              : Number(item.canonicalSettlementId),
          })).sort((a, b) => a.paymentId - b.paymentId)
          : [],
      );
      const evidenceChanged = existing != null && (
        Math.abs(Number(existing.gross_amount ?? 0) - candidate.grossAmount) > 0.01
        || Math.abs(Number(existing.net_amount ?? 0) - candidate.netAmount) > 0.01
        || normalizeItems(existingItems) !== normalizeItems(candidate.paymentItems)
      );
      if (evidenceChanged) {
        await db.execute(sql.raw(`
          UPDATE qris_mutation_batch_candidates
          SET status = 'superseded',
              reconciliation_status = 'UNMATCHED',
              review_reason = 'Kandidat superseded: canonical payment membership/amount/settlement evidence berubah.',
              updated_at = NOW()
          WHERE id = ${Number(existing!.id)}
            AND status NOT IN ('approved', 'completed', 'superseded', 'stale', 'ineligible')
        `));
      }
      if (existing && !evidenceChanged) {
        await db.execute(sql.raw(`
          UPDATE qris_mutation_batch_candidates
          SET candidate_source = 'sport_center.sport_payments',
              mutation_key = (SELECT mutation_key FROM bank_mutations WHERE id = ${candidate.mutationId}),
              payment_items = '${esc(itemJson)}'::jsonb,
              status = 'candidate_review',
              reconciliation_status = '${esc(candidate.status)}',
              gross_amount = ${candidate.grossAmount},
              mdr_amount = ${candidate.observedDeduction},
              net_amount = ${candidate.netAmount},
              observed_deduction = ${candidate.observedDeduction},
              effective_deduction_rate = ${candidate.effectiveDeductionRate == null ? "NULL" : candidate.effectiveDeductionRate},
              review_reason = '${esc(candidate.reason)}',
              generated_at = NOW(),
              updated_at = NOW()
          WHERE id = ${Number(existing.id)}
        `));
        continue;
      }
      await db.execute(sql.raw(`
        INSERT INTO qris_mutation_batch_candidates (
          mutation_id, company_id, candidate_source, mutation_key,
          source_date, estimated_settlement_date,
          bank_account_id, provider_code, provider_detection_source,
          settlement_rule_version, mutation_source_classification, gross_amount,
          mdr_amount, other_fee_amount, net_amount, payment_items, status,
          reconciliation_status, confidence, observed_deduction,
          effective_deduction_rate, review_reason, generated_at, updated_at
        ) VALUES (
          ${candidate.mutationId},
          ${candidate.companyId == null ? "NULL" : candidate.companyId},
          'sport_center.sport_payments',
          (SELECT mutation_key FROM bank_mutations WHERE id = ${candidate.mutationId}),
          '${esc(candidate.sourceDate)}',
          '${esc(candidate.estimatedSettlementDate)}',
          ${candidate.bankAccountId == null ? "NULL" : candidate.bankAccountId},
          '${esc(candidate.providerCode)}',
          '${esc(candidate.providerDetectionSource)}',
          '${esc(candidate.settlementRuleVersion)}',
          '${esc(candidate.mutationSourceClassification)}',
          ${candidate.grossAmount},
          ${candidate.observedDeduction},
          0,
          ${candidate.netAmount},
          '${esc(itemJson)}'::jsonb,
          'candidate_review',
          '${candidate.status}',
          ${candidate.confidence},
          ${candidate.observedDeduction},
          ${candidate.effectiveDeductionRate == null ? "NULL" : candidate.effectiveDeductionRate},
          '${esc(candidate.reason)}',
          NOW(),
          NOW()
        )
      `));
    }

    // A previously generated candidate may contain metadata that was
    // synthesized by the old fallback path. Once the strict regeneration
    // cannot reproduce it, retire that provisional snapshot so it cannot
    // remain approvable merely because the source payment is now unresolved.
    const currentMutationIds = new Set(mutations.map((mutation) => mutation.id));
    for (const existing of existingRows.rows as Array<Record<string, unknown>>) {
      const mutationId = Number(existing.mutation_id);
      const existingStatus = String(existing.status ?? "").toLowerCase();
      if (
        !currentMutationIds.has(mutationId)
        || persistableMutationIds.has(mutationId)
        || ["approved", "completed", "superseded", "stale", "ineligible"].includes(existingStatus)
      ) {
        continue;
      }
      await db.execute(sql.raw(`
        UPDATE qris_mutation_batch_candidates
        SET status = 'stale',
            reconciliation_status = 'UNMATCHED',
            review_reason = 'Kandidat ditutup: metadata QRIS canonical tidak lagi lengkap atau tidak unik; tidak ada fallback sintetis.',
            updated_at = NOW()
        WHERE id = ${Number(existing.id)}
          AND status NOT IN ('approved', 'completed', 'superseded', 'stale', 'ineligible')
      `));
    }
  }

  return { dryRun: options.dryRun !== false, generated: candidates.length, candidates };
}

export async function listQrisCandidates(options: {
  companyId?: number | null;
  status?: string | null;
  limit?: number;
  includeCompleted?: boolean;
} = {}) {
  const companyFilter = options.companyId && Number.isInteger(options.companyId)
    ? `AND c.company_id = ${Number(options.companyId)}`
    : "";
  const statusFilter = options.status && ["MATCHED", "REVIEW", "UNMATCHED"].includes(options.status)
    ? `AND c.reconciliation_status = '${esc(options.status)}'`
    : "";
  const completedFilter = options.includeCompleted
    ? ""
    : "AND c.status NOT IN ('approved', 'completed', 'superseded', 'stale', 'ineligible')";
  const limit = Math.min(Math.max(Number(options.limit ?? 100), 1), 500);

  const canonicalAvailable = await hasCanonicalSettlementSchema();
  const {
    currentExpectedAmountSql,
    canonicalSettledExcludeSql,
    canonicalSettledExcludeByIdSql,
    currentEvidenceValidSql,
    canonicalSettledUnionSql,
  } = makeCanonicalFragments(canonicalAvailable);

  const { rows } = await db.execute(sql.raw(`
     SELECT c.*, bm.description, bm.transaction_date, bm.amount AS bank_amount,
            bm.mutation_key,
           bm.bank_account_id,
           bm.source, bm.provider_name AS bank_provider_name,
            COALESCE(c.candidate_source, 'sport_center.sport_payments') AS candidate_source,
            ${currentExpectedAmountSql} AS current_expected_amount,
            COALESCE((
              SELECT jsonb_agg(current_payment.payment_id ORDER BY current_payment.payment_id)
              FROM (
                SELECT (item->>'paymentId')::int AS payment_id
                FROM jsonb_array_elements(c.payment_items) item
                WHERE item->>'paymentId' IS NOT NULL
                  AND NOT EXISTS (
                    SELECT 1
                    FROM qris_settlement_items qsi
                    WHERE qsi.sport_payment_id = (item->>'paymentId')::int
                  )
                  ${canonicalSettledExcludeSql}
              ) current_payment
            ), '[]'::jsonb) AS current_payment_ids,
            COALESCE((
              SELECT SUM(sp.amount)
              FROM sport_center.sport_payments sp
              WHERE sp.id IN (
                SELECT (item->>'paymentId')::int
                FROM jsonb_array_elements(c.payment_items) item
                WHERE item->>'paymentId' IS NOT NULL
                  AND NOT EXISTS (
                    SELECT 1
                    FROM qris_settlement_items qsi
                    WHERE qsi.sport_payment_id = sp.id
                  )
                  ${canonicalSettledExcludeByIdSql}
              )
            ), 0) AS current_gross_amount,
            ${currentEvidenceValidSql} AS current_evidence_valid,
            COALESCE((
              SELECT jsonb_agg(settled.payment_id ORDER BY settled.payment_id)
              FROM (
                SELECT qsi.sport_payment_id AS payment_id
                FROM qris_settlement_items qsi
                WHERE qsi.sport_payment_id IN (
                  SELECT (item->>'paymentId')::int
                  FROM jsonb_array_elements(c.payment_items) item
                  WHERE item->>'paymentId' IS NOT NULL
                )
                ${canonicalSettledUnionSql}
              ) settled
            ), '[]'::jsonb) AS settled_payment_ids
    FROM qris_mutation_batch_candidates c
    LEFT JOIN bank_mutations bm ON bm.id = c.mutation_id
     WHERE TRUE ${companyFilter} ${statusFilter} ${completedFilter}
    ORDER BY c.source_date DESC, c.id DESC
    LIMIT ${limit}
  `));
  return rows;
}