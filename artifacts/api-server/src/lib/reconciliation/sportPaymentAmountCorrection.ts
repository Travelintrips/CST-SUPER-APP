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
};

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

  const correctionResult = await tx.execute(sql`
    SELECT id
    FROM public.accounting_entries
    WHERE company_id = ${input.companyId}
      AND source = 'sport_center_amount_correction'
      AND source_id = ${Number(source.booking_id)}
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
  if (!journalId) fail("Jurnal kas/bank perusahaan belum dikonfigurasi", "ACCOUNTING_JOURNAL_NOT_CONFIGURED");

  const linesResult = await tx.execute(sql`
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
  `);
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
  if (!bankLine) fail("Akun bank/kas pada jurnal posted tidak dapat diidentifikasi", "BANK_ACCOUNT_NOT_FOUND");
  if (!revenueLine) fail("Akun pendapatan pada jurnal posted tidak dapat diidentifikasi", "REVENUE_ACCOUNT_NOT_FOUND");

  const bookingTotal = numberValue(source.booking_total_amount);
  const storedTax = numberValue(source.booking_tax_amount);
  const derivedTaxRate = numberValue(source.booking_tax_rate) > 0
    ? numberValue(source.booking_tax_rate)
    : storedTax > 0 && bookingTotal > storedTax
      ? storedTax / (bookingTotal - storedTax) * 100
      : 0;
  const correctionLines = buildSportPaymentAmountCorrectionLines({
    delta: decision.delta,
    bankAccountId: Number(bankLine.account_id),
    revenueAccountId: Number(revenueLine.account_id),
    taxAccountId: taxLine ? Number(taxLine.account_id) : settings.ppnOutputAccountId,
    taxRate: derivedTaxRate,
    bookingNumber: String(source.booking_number),
  });

  const correctionEntry = await postEntryWithClient(
    tx,
    {
      journalId: Number(journalId),
      date: new Date(`${String(source.booking_date).slice(0, 10)}T00:00:00Z`),
      ref: `${String(source.booking_number)}-AMOUNT-CORRECTION-${input.paymentId}`,
      description: `[KOREKSI NOMINAL PAYMENT] ${String(source.booking_number)} ${String(source.customer_name ?? "")}: ${reason}`,
      source: "sport_center_amount_correction",
      sourceId: Number(source.booking_id),
      sourceEventId: `sport-payment-amount-correction:${input.paymentId}:${decision.amount.toFixed(2)}`,
      sourceModule: "sport_center_payment",
      companyId: input.companyId,
      costCenterId: await resolveCostCenterId("SPORT_CENTER", input.companyId, tx),
      lines: correctionLines,
    },
    settings.cashJournalId ? "CSH" : "BNK",
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
  const updatedSourceResult = await tx.execute(sql`
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
    correctionEntryId: Number(correctionEntry.id),
    source: updatedSource,
    mirror: refreshedMirror,
    accountingPaymentId: Number(accounting.accounting_payment_id),
  };
}
