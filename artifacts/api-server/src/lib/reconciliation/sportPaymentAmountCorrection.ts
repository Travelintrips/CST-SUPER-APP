import { sql } from "drizzle-orm";
import { ensureAccountingSettings } from "../accountingSeed.js";
import {
  postEntryWithClient,
  resolveCostCenterId,
  type DbClient,
} from "../accounting.js";
import {
  assessSportPaymentAmountCorrection,
  buildSportPaymentAmountCorrectionLines,
  parseSportPaymentCorrectionAmount,
  roundSportPaymentMoney,
} from "./sportPaymentAmountCorrectionPolicy.js";

export class SportPaymentAmountCorrectionError extends Error {
  constructor(
    message: string,
    readonly statusCode: number,
    readonly code: string,
    readonly details?: Record<string, unknown>,
  ) {
    super(message);
    this.name = "SportPaymentAmountCorrectionError";
  }
}

function numberValue(value: unknown): number {
  const parsed = Number(value ?? 0);
  return Number.isFinite(parsed) ? parsed : 0;
}

function fail(message: string, code: string, statusCode = 409, details?: Record<string, unknown>): never {
  throw new SportPaymentAmountCorrectionError(message, statusCode, code, details);
}

type CorrectionInput = {
  paymentId: number;
  companyId: number;
  requestedAmount: unknown;
  reason: string;
  actor?: string;
};

type SportJournalLine = {
  line_type: string;
  account_code: string;
  account_name: string;
  amount: number;
  description: string | null;
};

function roundMoney(value: number): number {
  return Math.round((value + Number.EPSILON) * 100) / 100;
}

function journalCorrectionLines(
  lines: SportJournalLine[],
  delta: number,
  originalGross: number,
): Array<{
  lineType: "debit" | "credit";
  accountCode: string;
  accountName: string;
  amount: number;
  description: string;
}> {
  const absoluteDelta = roundMoney(Math.abs(delta));
  const debitLines = lines.filter((line) => line.line_type === "debit");
  const creditLines = lines.filter((line) => line.line_type === "credit");
  const debitTotal = debitLines.reduce((sum, line) => sum + line.amount, 0);
  const creditTotal = creditLines.reduce((sum, line) => sum + line.amount, 0);
  if (
    absoluteDelta <= 0
    || originalGross <= 0
    || debitLines.length === 0
    || creditLines.length === 0
    || Math.abs(debitTotal - originalGross) > 0.01
    || Math.abs(creditTotal - originalGross) > 0.01
  ) {
    throw new SportPaymentAmountCorrectionError(
      "Jurnal Sport Center tidak memiliki line gross yang balance untuk koreksi additive",
      409,
      "SPORT_JOURNAL_LINES_NOT_BALANCED",
    );
  }

  const buildSide = (
    sourceLines: SportJournalLine[],
    sourceTotal: number,
    targetType: "debit" | "credit",
  ) => {
    let allocated = 0;
    return sourceLines.map((line, index) => {
      const amount = index === sourceLines.length - 1
        ? roundMoney(absoluteDelta - allocated)
        : roundMoney(absoluteDelta * line.amount / sourceTotal);
      allocated = roundMoney(allocated + amount);
      return {
        lineType: delta < 0
          ? (targetType === "debit" ? "credit" : "debit")
          : targetType,
        accountCode: line.account_code,
        accountName: line.account_name,
        amount,
        description: `KOREKSI GROSS PAYMENT: ${line.description ?? line.account_name}`,
      };
    });
  };

  return [
    ...buildSide(debitLines, debitTotal, "debit"),
    ...buildSide(creditLines, creditTotal, "credit"),
  ];
}

async function createSportCenterPaymentAmountCorrection(
  tx: DbClient,
  input: {
    paymentId: number;
    journalDelta: number;
    actor: string;
    reason: string;
  },
): Promise<number | null> {
  if (Math.abs(input.journalDelta) <= 0.01) return null;

  const journalResult = await tx.execute(sql`
    SELECT *
    FROM sport_center.accounting_journals
    WHERE payment_id = ${input.paymentId}
      AND journal_type = 'payment_confirmed'
      AND is_reversal = FALSE
      AND status = 'posted'
    ORDER BY id
    LIMIT 2
    FOR UPDATE
  `);
  if (journalResult.rows.length !== 1) {
    fail(
      "Jurnal payment Sport Center harus tepat satu sebelum koreksi gross",
      journalResult.rows.length === 0
        ? "SPORT_JOURNAL_NOT_FOUND"
        : "SPORT_JOURNAL_IDENTITY_AMBIGUOUS",
    );
  }
  const journal = journalResult.rows[0] as Record<string, unknown>;
  const journalId = Number(journal.id);
  const originalGross = numberValue(journal.gross_amount);
  if (!Number.isSafeInteger(journalId) || journalId <= 0 || originalGross <= 0) {
    fail("Gross jurnal payment Sport Center tidak valid", "SPORT_JOURNAL_GROSS_INVALID");
  }

  const marker = `SPORT_PAYMENT_AMOUNT_CORRECTION:${input.paymentId}`;
  const existingResult = await tx.execute(sql`
    SELECT id
    FROM sport_center.accounting_journals
    WHERE payment_id = ${input.paymentId}
      AND journal_type = 'payment_amount_correction'
      AND is_reversal = FALSE
      AND status = 'posted'
      AND notes LIKE ${`%${marker}%`}
    ORDER BY id DESC
    LIMIT 1
    FOR UPDATE
  `);
  if (existingResult.rows.length > 0) {
    return Number((existingResult.rows[0] as Record<string, unknown>).id);
  }

  const lineResult = await tx.execute(sql`
    SELECT line_type, account_code, account_name, amount, description
    FROM sport_center.accounting_journal_lines
    WHERE journal_id = ${journalId}
    ORDER BY id
  `);
  const sourceLines = (lineResult.rows as Array<Record<string, unknown>>).map((line) => ({
    line_type: String(line.line_type ?? "").toLowerCase(),
    account_code: String(line.account_code ?? ""),
    account_name: String(line.account_name ?? ""),
    amount: numberValue(line.amount),
    description: line.description == null ? null : String(line.description),
  })) as SportJournalLine[];
  const correctionLines = journalCorrectionLines(
    sourceLines,
    input.journalDelta,
    originalGross,
  );
  const originalTax = numberValue(journal.tax_amount);
  const taxRatio = originalGross > 0 ? originalTax / originalGross : 0;
  const correctionTax = roundMoney(Math.abs(input.journalDelta) * taxRatio)
    * (input.journalDelta < 0 ? -1 : 1);
  const correctionDpp = roundMoney(input.journalDelta - correctionTax);

  // Use the live catalog for optional/additive columns while keeping the
  // original posted journal untouched. The correction is a normal draft-first
  // Sport Center journal and is promoted only after its lines validate.
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
  const requiredColumns = [
    "payment_id", "journal_type", "status", "gross_amount", "dpp_amount",
    "tax_amount", "is_reversal", "reversal_of_id", "notes", "created_by",
  ];
  if (requiredColumns.some((column) => !columns.includes(column))) {
    fail("Schema jurnal Sport Center tidak mendukung koreksi additive", "SPORT_JOURNAL_SCHEMA_UNSUPPORTED");
  }
  const quoteIdentifier = (identifier: string) => `"${identifier.replaceAll(`"`, `""`)}"`;
  const escapeSql = (value: string) => value.replaceAll("'", "''");
  const selectExpressions = columns.map((column) => {
    if (column === "status") return "'draft' AS " + quoteIdentifier(column);
    if (column === "journal_type") return "'payment_amount_correction' AS " + quoteIdentifier(column);
    if (column === "is_reversal") return "FALSE AS " + quoteIdentifier(column);
    if (column === "reversal_of_id") return `${journalId} AS ${quoteIdentifier(column)}`;
    if (column === "gross_amount") return `${input.journalDelta} AS ${quoteIdentifier(column)}`;
    if (column === "dpp_amount") return `${correctionDpp} AS ${quoteIdentifier(column)}`;
    if (column === "tax_amount") return `${correctionTax} AS ${quoteIdentifier(column)}`;
    if (column === "notes") {
      return `COALESCE(${quoteIdentifier(column)}, '') || ' ${marker} REASON:${escapeSql(input.reason)}' AS ${quoteIdentifier(column)}`;
    }
    if (column === "created_by") return `'${escapeSql(input.actor)}' AS ${quoteIdentifier(column)}`;
    if (column === "source_event_id") return "gen_random_uuid() AS " + quoteIdentifier(column);
    if (column === "correlation_id") return `'${escapeSql(marker)}' AS ${quoteIdentifier(column)}`;
    return quoteIdentifier(column);
  }).join(", ");
  const columnList = columns.map(quoteIdentifier).join(", ");
  const insertResult = await tx.execute(sql.raw(`
    INSERT INTO sport_center.accounting_journals (${columnList})
    SELECT ${selectExpressions}
    FROM sport_center.accounting_journals
    WHERE id = ${journalId}
    RETURNING id
  `));
  const correctionJournalId = Number(
    (insertResult.rows[0] as Record<string, unknown> | undefined)?.id,
  );
  if (!Number.isSafeInteger(correctionJournalId) || correctionJournalId <= 0) {
    fail("Jurnal koreksi Sport Center tidak terbentuk", "SPORT_JOURNAL_CORRECTION_FAILED");
  }

  const lineValues = correctionLines.map((line) => sql`(
    ${correctionJournalId},
    ${line.lineType},
    ${line.accountCode},
    ${line.accountName},
    ${line.amount},
    ${line.description}
  )`);
  await tx.execute(sql`
    INSERT INTO sport_center.accounting_journal_lines
      (journal_id, line_type, account_code, account_name, amount, description)
    VALUES ${sql.join(lineValues, sql`, `)}
  `);
  await tx.execute(sql`
    SELECT sport_center.validate_accounting_journal(${correctionJournalId})
  `);
  await tx.execute(sql`
    UPDATE sport_center.accounting_journals
    SET status = 'posted'
    WHERE id = ${correctionJournalId}
      AND status = 'draft'
  `);
  return correctionJournalId;
}

export async function correctPostedSportPaymentAmount(
  tx: DbClient,
  input: CorrectionInput,
): Promise<{
  changed: boolean;
  idempotent: boolean;
  paymentId: number;
  bookingId: number;
  previousAmount: number;
  amount: number;
  correctionEntryId: number | null;
  source: Record<string, unknown>;
  mirror: Record<string, unknown>;
  accountingPaymentId: number;
}> {
  const requestedAmount = parseSportPaymentCorrectionAmount(input.requestedAmount);
  const reason = input.reason.trim();
  if (reason.length < 5 || reason.length > 500) {
    fail("Alasan koreksi wajib diisi (5–500 karakter)", "INVALID_REASON", 400);
  }
  // A booking can legitimately have more than one payment.  The correction
  // identity therefore belongs to the canonical payment, not only to the
  // booking that owns it.
  const correctionSourceEventId = `sport-payment-amount-correction:${input.paymentId}`;

  const sourceResult = await tx.execute(sql`
    SELECT
      sp.id,
      sp.booking_id,
      sp.company_id,
      sp.amount::numeric AS source_amount,
      COALESCE(sp.mdr_rate, 0)::numeric AS mdr_rate,
      COALESCE(sp.mdr_amount, 0)::numeric AS mdr_amount,
      COALESCE(sp.tax_withheld_amount, 0)::numeric AS tax_withheld_amount,
      COALESCE(sp.other_fee_amount, 0)::numeric AS other_fee_amount,
      COALESCE(sp.net_amount, 0)::numeric AS net_amount,
      sp.status::text AS source_status,
      COALESCE(sp.settlement_status, 'unsettled')::text AS settlement_status,
      sp.payment_method::text AS payment_method,
      COALESCE(
        NULLIF(to_jsonb(sp)->>'payment_number', ''),
        'SCPAY-SC-' || sp.id::text
      ) AS payment_number,
      b.company_id AS booking_company_id,
      COALESCE(
        NULLIF(to_jsonb(b)->>'order_number', ''),
        NULLIF(to_jsonb(b)->>'booking_number', ''),
        'SC-' || LPAD(b.id::text, 4, '0')
      ) AS booking_number,
      COALESCE(
        NULLIF(to_jsonb(b)->>'grand_total', '')::numeric,
        NULLIF(to_jsonb(b)->>'total_price', '')::numeric,
        NULLIF(to_jsonb(b)->>'total_amount', '')::numeric,
        0
      ) AS booking_total_amount,
      COALESCE(NULLIF(to_jsonb(b)->>'tax_rate', '')::numeric, 0) AS booking_tax_rate,
      COALESCE(NULLIF(to_jsonb(b)->>'tax_amount', '')::numeric, 0) AS booking_tax_amount,
      COALESCE(NULLIF(to_jsonb(b)->>'booking_date', ''), CURRENT_DATE::text) AS booking_date,
      COALESCE(to_jsonb(b)->>'customer_name', '') AS customer_name,
      COALESCE(to_jsonb(b)->>'facility_name', '') AS facility_name,
      COALESCE(
        sp.company_id,
        b.company_id,
        CASE WHEN mapping.company_count = 1 THEN mapping.company_id END
      ) AS resolved_company_id
    FROM sport_center.sport_payments sp
    JOIN sport_center.sport_bookings b ON b.id = sp.booking_id
    LEFT JOIN LATERAL (
      SELECT COUNT(*)::integer AS company_count, MIN(fcm.company_id)::integer AS company_id
      FROM sport_center.facility_company_mappings fcm
      WHERE fcm.facility_id = b.facility_id
        AND fcm.is_active = TRUE
        AND fcm.approval_status = 'OWNER_APPROVED'
    ) mapping ON TRUE
    WHERE sp.id = ${input.paymentId}
    FOR UPDATE OF sp
  `);
  const source = sourceResult.rows[0] as Record<string, unknown> | undefined;
  if (!source) fail("Payment Sport Center tidak ditemukan", "PAYMENT_NOT_FOUND", 404);
  if (Number(source.resolved_company_id) !== input.companyId) {
    fail("Payment bukan milik perusahaan aktif", "COMPANY_ACCESS_DENIED", 403);
  }

  const mirrorResult = await tx.execute(sql`
    SELECT
      id,
      source_payment_id,
      payment_number,
      amount::numeric AS mirror_amount,
      COALESCE(mdr_amount, 0)::numeric AS mirror_mdr_amount,
      COALESCE(net_amount, 0)::numeric AS mirror_net_amount,
      posting_status,
      posting_error,
      accounting_payment_id,
      entry_id
    FROM public.sport_payments
    WHERE source_schema = 'sport_center'
      AND source_table = 'sport_payments'
      AND source_payment_id = ${input.paymentId}
    FOR UPDATE
  `);
  if (mirrorResult.rows.length !== 1) {
    fail(
      "Mirror public payment harus tepat satu sebelum koreksi",
      mirrorResult.rows.length === 0 ? "MIRROR_NOT_FOUND" : "MIRROR_IDENTITY_AMBIGUOUS",
    );
  }
  const mirror = mirrorResult.rows[0] as Record<string, unknown>;

  const accountingResult = await tx.execute(sql`
    SELECT
      ap.id AS accounting_payment_id,
      ap.amount::numeric AS accounting_payment_amount,
      ap.status::text AS accounting_payment_status,
      ap.entry_id,
      ae.id AS journal_id,
      ae.company_id AS journal_company_id,
      ae.status::text AS journal_status,
      ae.source::text AS journal_source,
      ae.source_id AS journal_source_id,
      ae.total_debit::numeric AS journal_total_debit,
      ae.total_credit::numeric AS journal_total_credit
    FROM public.accounting_payments ap
    JOIN public.accounting_entries ae ON ae.id = ap.entry_id
    WHERE ap.source_type = 'sport_center'
      AND ap.source_doc_id = ${input.paymentId}
    ORDER BY ap.id
    FOR UPDATE OF ap, ae
  `);
  if (accountingResult.rows.length !== 1) {
    fail(
      "Accounting payment harus memiliki tepat satu jurnal linked",
      accountingResult.rows.length === 0
        ? "ACCOUNTING_PAYMENT_NOT_FOUND"
        : "ACCOUNTING_PAYMENT_IDENTITY_AMBIGUOUS",
    );
  }
  const accounting = accountingResult.rows[0] as Record<string, unknown>;
  if (String(accounting.journal_status).toLowerCase() !== "posted") {
    fail("Workflow ini hanya untuk jurnal payment yang sudah posted", "JOURNAL_NOT_POSTED");
  }
  if (
    Number(accounting.journal_source_id) !== Number(source.booking_id)
    && Number((accounting as Record<string, unknown>).source_payment_id ?? 0) !== input.paymentId
  ) {
    fail("Jurnal tidak terhubung ke booking/payment canonical", "JOURNAL_IDENTITY_MISMATCH");
  }
  if (Number(accounting.journal_company_id) !== input.companyId) {
    fail("Company jurnal tidak sesuai dengan company payment", "JOURNAL_COMPANY_MISMATCH");
  }

  const sportJournalResult = await tx.execute(sql`
    SELECT id, gross_amount, status, journal_type, is_reversal
    FROM sport_center.accounting_journals
    WHERE payment_id = ${input.paymentId}
      AND journal_type = 'payment_confirmed'
      AND is_reversal = FALSE
    ORDER BY id
    LIMIT 2
    FOR UPDATE
  `);
  if (sportJournalResult.rows.length !== 1) {
    fail(
      "Jurnal payment Sport Center harus tepat satu",
      sportJournalResult.rows.length === 0
        ? "SPORT_JOURNAL_NOT_FOUND"
        : "SPORT_JOURNAL_IDENTITY_AMBIGUOUS",
    );
  }
  const sportJournal = sportJournalResult.rows[0] as Record<string, unknown>;
  if (String(sportJournal.status ?? "").toLowerCase() !== "posted") {
    fail("Workflow ini hanya untuk jurnal Sport Center yang sudah posted", "JOURNAL_NOT_POSTED");
  }

  const correctionResult = await tx.execute(sql`
    SELECT id
    FROM public.accounting_entries
    WHERE company_id = ${input.companyId}
      AND source = 'sport_center_amount_correction'
      AND source_id = ${input.paymentId}
      AND source_event_id = ${correctionSourceEventId}
      AND status IN ('draft', 'pending_approval', 'approved', 'posted')
    ORDER BY id DESC
    LIMIT 1
    FOR UPDATE
  `);
  const existingCorrectionId = Number(
    (correctionResult.rows[0] as Record<string, unknown> | undefined)?.id ?? 0,
  ) || null;

  const activeSettlementResult = await tx.execute(sql`
    SELECT i.id
    FROM sport_center.payment_settlement_items i
    JOIN sport_center.payment_settlement_batches b ON b.id = i.settlement_id
    WHERE i.payment_id = ${input.paymentId}
      AND i.item_status = 'active'
    FOR UPDATE OF i, b
  `);

  let decision;
  try {
    decision = assessSportPaymentAmountCorrection(
      {
        sourceAmount: numberValue(source.source_amount),
        mirrorAmount: numberValue(mirror.mirror_amount),
        accountingPaymentAmount: numberValue(accounting.accounting_payment_amount),
        journalTotalDebit: numberValue(accounting.journal_total_debit),
        journalTotalCredit: numberValue(accounting.journal_total_credit),
        canonicalJournalGrossAmount: numberValue(sportJournal.gross_amount),
        settlementStatus: String(source.settlement_status ?? "unsettled"),
        activeSettlementCount: activeSettlementResult.rows.length,
        sourceStatus: String(source.source_status ?? ""),
        existingCorrectionId,
      },
      requestedAmount,
    );
  } catch (error) {
    const code = error instanceof Error ? error.message : "PAYMENT_CORRECTION_BLOCKED";
    const messages: Record<string, string> = {
      PAYMENT_SETTLED: "Payment sudah settled atau masih menjadi anggota batch settlement aktif",
      PAYMENT_STATUS_NOT_EDITABLE: "Status payment tidak dapat dikoreksi",
      PAYMENT_FINANCIAL_IDENTITY_DRIFT: "Source, mirror, accounting payment, dan jurnal sudah drift; koreksi manual ini diblokir",
    };
    fail(messages[code] ?? "Koreksi nominal payment diblokir", code);
  }

  if (decision.kind === "already_corrected") {
    fail(
      "Payment ini sudah memiliki jurnal koreksi nominal; tidak membuat koreksi kedua",
      "PAYMENT_ALREADY_CORRECTED",
      409,
      { correctionEntryId: decision.correctionId },
    );
  }

  if (decision.kind === "noop") {
    return {
      changed: false,
      idempotent: true,
      paymentId: input.paymentId,
      bookingId: Number(source.booking_id),
      previousAmount: numberValue(source.source_amount),
      amount: decision.amount,
      correctionEntryId: null,
      source,
      mirror,
      accountingPaymentId: Number(accounting.accounting_payment_id),
    };
  }

  const settings = await ensureAccountingSettings(input.companyId);
  const journalId = settings.cashJournalId ?? settings.bankJournalId;
  if (decision.delta !== 0 && !journalId) {
    fail("Jurnal kas/bank perusahaan belum dikonfigurasi", "ACCOUNTING_JOURNAL_NOT_CONFIGURED");
  }

  const linesResult = decision.delta !== 0
    ? await tx.execute(sql`
    SELECT
      ael.account_id,
      COALESCE(ael.debit, 0)::numeric AS debit,
      COALESCE(ael.credit, 0)::numeric AS credit,
      coa.type::text AS account_type,
      coa.code,
      coa.name
    FROM public.accounting_entry_lines ael
    JOIN public.chart_of_accounts coa ON coa.id = ael.account_id
    WHERE ael.entry_id = ${Number(accounting.journal_id)}
    ORDER BY ael.id
  `)
    : { rows: [] };
  const lines = linesResult.rows as Array<Record<string, unknown>>;
  const bankLine = lines.find((line) => {
    const type = String(line.account_type ?? "").toLowerCase();
    const identity = `${String(line.code ?? "")} ${String(line.name ?? "")}`.toLowerCase();
    return type === "asset" && (identity.includes("bank") || identity.includes("kas") || String(line.code ?? "").startsWith("1-10"));
  });
  const revenueLine = lines.find((line) => String(line.account_type ?? "").toLowerCase() === "revenue");
  const taxLine = lines.find((line) => {
    const identity = `${String(line.code ?? "")} ${String(line.name ?? "")}`.toLowerCase();
    return String(line.account_type ?? "").toLowerCase() === "liability"
      && (identity.includes("ppn") || Number(line.account_id) === Number(settings.ppnOutputAccountId));
  });
  if (decision.delta !== 0 && !bankLine) fail("Akun bank/kas pada jurnal posted tidak dapat diidentifikasi", "BANK_ACCOUNT_NOT_FOUND");
  if (decision.delta !== 0 && !revenueLine) fail("Akun pendapatan pada jurnal posted tidak dapat diidentifikasi", "REVENUE_ACCOUNT_NOT_FOUND");

  const bookingTotal = numberValue(source.booking_total_amount);
  const storedTax = numberValue(source.booking_tax_amount);
  const derivedTaxRate = numberValue(source.booking_tax_rate) > 0
    ? numberValue(source.booking_tax_rate)
    : storedTax > 0 && bookingTotal > storedTax
      ? storedTax / (bookingTotal - storedTax) * 100
      : 0;
  const correctionLines = decision.delta !== 0
    ? buildSportPaymentAmountCorrectionLines({
        delta: decision.delta,
        bankAccountId: Number(bankLine!.account_id),
        revenueAccountId: Number(revenueLine!.account_id),
        taxAccountId: taxLine ? Number(taxLine.account_id) : settings.ppnOutputAccountId,
        taxRate: derivedTaxRate,
        bookingNumber: String(source.booking_number),
      })
    : [];

  const correctionEntry = decision.delta !== 0
    ? await postEntryWithClient(
        tx,
        {
          journalId: Number(journalId),
          date: new Date(`${String(source.booking_date).slice(0, 10)}T00:00:00Z`),
          ref: `${String(source.booking_number)}-AMOUNT-CORRECTION-${input.paymentId}`,
          description: `[KOREKSI NOMINAL PAYMENT] ${String(source.booking_number)} ${String(source.customer_name ?? "")}: ${reason}`,
          source: "sport_center_amount_correction",
          sourceId: input.paymentId,
          sourceEventId: correctionSourceEventId,
          sourceModule: "sport_center_payment",
          companyId: input.companyId,
          costCenterId: await resolveCostCenterId("SPORT_CENTER", input.companyId, tx),
          lines: correctionLines,
        },
        settings.cashJournalId ? "CSH" : "BNK",
      )
    : null;

  const sportCorrectionJournalId = await createSportCenterPaymentAmountCorrection(
    tx,
    {
      paymentId: input.paymentId,
      journalDelta: decision.journalDelta,
      actor: input.actor?.trim() || "bank-reconciliation",
      reason,
    },
  );

  const oldAmount = numberValue(source.source_amount);
  const oldMdrRate = numberValue(source.mdr_rate);
  const oldMdrAmount = numberValue(source.mdr_amount);
  const oldTaxWithheld = numberValue(source.tax_withheld_amount);
  const oldOtherFee = numberValue(source.other_fee_amount);
  const mdrAmount = oldMdrRate > 0
    ? roundSportPaymentMoney(decision.amount * oldMdrRate / 100)
    : oldAmount > 0
      ? roundSportPaymentMoney(oldMdrAmount * decision.amount / oldAmount)
      : 0;
  const netAmount = Math.max(
    0,
    roundSportPaymentMoney(decision.amount - mdrAmount - oldTaxWithheld - oldOtherFee),
  );
  const updatedSourceResult = decision.delta === 0
    ? { rows: [{
        id: Number(source.id),
        amount: numberValue(source.source_amount),
        mdr_amount: numberValue(source.mdr_amount),
        net_amount: numberValue(source.net_amount),
        status: String(source.source_status ?? ""),
      }] }
    : await tx.execute(sql`
    UPDATE sport_center.sport_payments
    SET amount = ${decision.amount},
        mdr_amount = ${mdrAmount},
        net_amount = ${netAmount},
        updated_at = NOW()
    WHERE id = ${input.paymentId}
      AND amount = ${oldAmount}
      AND settlement_status = 'unsettled'
    RETURNING id, amount::numeric AS amount, mdr_amount::numeric AS mdr_amount,
              net_amount::numeric AS net_amount, status::text AS status
  `);
  const updatedSource = updatedSourceResult.rows[0] as Record<string, unknown> | undefined;
  if (!updatedSource) {
    fail("Payment berubah saat dikoreksi; ulangi setelah memuat data terbaru", "PAYMENT_CONCURRENT_CHANGE");
  }

  const refreshedMirrorResult = await tx.execute(sql`
    SELECT id, source_payment_id, payment_number, amount::numeric AS amount,
           mdr_amount::numeric AS mdr_amount, net_amount::numeric AS net_amount,
           posting_status, posting_error, accounting_payment_id, entry_id
    FROM public.sport_payments
    WHERE source_schema = 'sport_center'
      AND source_table = 'sport_payments'
      AND source_payment_id = ${input.paymentId}
    LIMIT 1
  `);
  const refreshedMirror = refreshedMirrorResult.rows[0] as Record<string, unknown> | undefined;
  if (!refreshedMirror) fail("Mirror payment hilang setelah koreksi source", "MIRROR_UPDATE_FAILED");

  return {
    changed: true,
    idempotent: false,
    paymentId: input.paymentId,
    bookingId: Number(source.booking_id),
    previousAmount: oldAmount,
    amount: decision.amount,
    correctionEntryId: correctionEntry ? Number(correctionEntry.id) : sportCorrectionJournalId,
    source: updatedSource,
    mirror: refreshedMirror,
    accountingPaymentId: Number(accounting.accounting_payment_id),
  };
}
