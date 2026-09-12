import { sql } from "drizzle-orm";
import { recalculateVendorInvoiceBreakdown } from "./invoiceWithholdingCalculation.js";

type SqlExecutor = {
  execute: (query: unknown) => Promise<unknown>;
};

const TERMINAL_WITHHOLDING_STATUSES = new Set(["proof_received", "posted"]);

function rows<T>(result: unknown): T[] {
  if (Array.isArray(result)) return result as T[];
  return (((result as { rows?: T[] } | undefined)?.rows) ?? []) as T[];
}

function numberValue(value: unknown): number {
  const parsed = Number(value ?? 0);
  return Number.isFinite(parsed) ? parsed : 0;
}

function money(value: number): number {
  return Math.round(value * 100) / 100;
}

export function inferVendorInvoiceGrossSettlement(input: {
  paymentAmount: number;
  outstanding: number;
  withholdingAmount: number;
  requestedWithholdingAmount?: number;
}): { grossAmount: number; withholdingAmount: number } {
  const requested = money(input.requestedWithholdingAmount ?? 0);
  const persisted = money(input.withholdingAmount);
  const inferred = requested > 0
    ? requested
    : persisted > 0 && Math.abs(input.paymentAmount - (input.outstanding - persisted)) <= 0.01
      ? persisted
      : 0;
  return { grossAmount: money(input.paymentAmount + inferred), withholdingAmount: inferred };
}

export function deriveVendorInvoicePaymentStatus(input: {
  amountPaid: number;
  grandTotal: number;
  currentStatus: string;
  hasWithholding: boolean;
  withholdingComplete: boolean;
}): "draft" | "posted" | "paid" {
  const fullyPaid = input.grandTotal > 0 && input.amountPaid >= input.grandTotal - 0.01;
  if (fullyPaid && (!input.hasWithholding || input.withholdingComplete)) return "paid";
  return input.currentStatus === "draft" ? "draft" : "posted";
}

function jsonObject(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
}

function legacyWithholding(invoice: Record<string, unknown>): {
  amount: number;
  type: string;
  object: string;
  base: number;
} {
  const breakdown = jsonObject(invoice.invoice_breakdown);
  const withholding = jsonObject(breakdown.withholding_tax);
  const recalculated = recalculateVendorInvoiceBreakdown(
    invoice.invoice_breakdown,
    String(invoice.supplier_name ?? ""),
  );
  const amount = money(
    numberValue(invoice.withholding_tax_amount)
      || numberValue(recalculated?.withholding.amount)
      || numberValue(recalculated?.totals.withholding_tax_amount)
      || numberValue(withholding.amount),
  );
  const type = String(
    invoice.withholding_tax_type
      || recalculated?.withholding.type
      || withholding.type
      || "PPh",
  ).trim() || "PPh";
  const object = String(invoice.tax_object || "legacy_invoice_header").trim() || "legacy_invoice_header";
  const base = money(
    numberValue(recalculated?.withholding.base_amount)
      || numberValue(recalculated?.totals.dpp)
      || numberValue(withholding.base_amount)
      || numberValue(invoice.total_amount),
  );
  return { amount, type, object, base };
}

/**
 * Creates the persisted withholding linkage used by payment and proof review.
 *
 * Existing reviewed/proof rows are never downgraded. Legacy header-only PPh is
 * represented by one explicit line-tax row so a historical invoice can enter
 * the same lifecycle as a newly captured invoice.
 */
export async function ensureVendorWithholdingRecords(
  executor: SqlExecutor,
  companyId: number,
  vendorInvoiceId: number,
): Promise<{ withholdingAmount: number; recordCount: number }> {
  const invoiceRows = rows<Record<string, unknown>>(await executor.execute(sql`
    SELECT id, invoice_number, supplier_name, total_amount, withholding_tax_amount,
           withholding_tax_type, tax_object, invoice_breakdown
    FROM vendor_invoices
    WHERE id = ${vendorInvoiceId} AND company_id = ${companyId}
    LIMIT 1
  `));
  const invoice = invoiceRows[0];
  if (!invoice) return { withholdingAmount: 0, recordCount: 0 };

  const legacy = legacyWithholding(invoice);
  let taxRows = rows<Record<string, unknown>>(await executor.execute(sql`
    SELECT vit.id AS line_tax_id, vit.invoice_line_id, vit.tax_type, vit.tax_object,
           vit.base_amount, vit.tax_amount, vit.liability_account_id
    FROM vendor_invoice_line_taxes vit
    INNER JOIN vendor_invoice_lines vil ON vil.id = vit.invoice_line_id
    WHERE vil.invoice_id = ${vendorInvoiceId}
      AND vit.company_id = ${companyId}
      AND vit.tax_amount > 0
    ORDER BY vit.id
  `));

  // Older imports persisted PPh only in the invoice header/breakdown. Make a
  // single auditable line-tax row instead of silently treating the net transfer
  // as a partial payment.
  if (taxRows.length === 0 && legacy.amount > 0) {
    let lineRows = rows<{ id: number }>(await executor.execute(sql`
      SELECT id
      FROM vendor_invoice_lines
      WHERE invoice_id = ${vendorInvoiceId}
      ORDER BY id
      LIMIT 1
    `));
    let invoiceLineId = Number(lineRows[0]?.id ?? 0);
    if (!invoiceLineId) {
      lineRows = rows<{ id: number }>(await executor.execute(sql`
        INSERT INTO vendor_invoice_lines
          (invoice_id, name, quantity, unit, unit_cost, subtotal, tax_amount,
           coa_resolution_status, notes)
        VALUES
          (${vendorInvoiceId}, ${`PPh withholding — ${String(invoice.invoice_number ?? vendorInvoiceId)}`},
           '1', 'tax', '0', '0', '0', 'confirmed', 'Synthetic legacy header withholding line')
        RETURNING id
      `));
      invoiceLineId = Number(lineRows[0]?.id ?? 0);
    }
    if (invoiceLineId) {
      await executor.execute(sql`
        INSERT INTO vendor_invoice_line_taxes
          (invoice_line_id, company_id, tax_type, tax_object, base_amount, tax_amount,
           resolution_status, review_reason)
        VALUES
          (${invoiceLineId}, ${companyId}, ${legacy.type}, ${legacy.object},
           ${String(legacy.base)}, ${String(legacy.amount)}, 'tax_review',
           'Created from legacy vendor invoice withholding header')
        ON CONFLICT (invoice_line_id, tax_type, tax_object)
        DO UPDATE SET
          base_amount = EXCLUDED.base_amount,
          tax_amount = EXCLUDED.tax_amount,
          updated_at = NOW()
      `);
      taxRows = rows<Record<string, unknown>>(await executor.execute(sql`
        SELECT vit.id AS line_tax_id, vit.invoice_line_id, vit.tax_type, vit.tax_object,
               vit.base_amount, vit.tax_amount, vit.liability_account_id
        FROM vendor_invoice_line_taxes vit
        INNER JOIN vendor_invoice_lines vil ON vil.id = vit.invoice_line_id
        WHERE vil.invoice_id = ${vendorInvoiceId}
          AND vit.company_id = ${companyId}
          AND vit.tax_amount > 0
        ORDER BY vit.id
      `));
    }
  }

  for (const tax of taxRows) {
    const lineTaxId = Number(tax.line_tax_id);
    const invoiceLineId = Number(tax.invoice_line_id);
    if (!lineTaxId || !invoiceLineId) continue;
    await executor.execute(sql`
      INSERT INTO vendor_withholding_records
        (company_id, vendor_invoice_id, invoice_line_id, line_tax_id,
         tax_type, tax_object, base_amount, tax_amount, liability_account_id,
         status)
      VALUES
        (${companyId}, ${vendorInvoiceId}, ${invoiceLineId}, ${lineTaxId},
         ${String(tax.tax_type ?? "PPh")}, ${String(tax.tax_object ?? "")},
         ${String(numberValue(tax.base_amount))}, ${String(numberValue(tax.tax_amount))},
         ${tax.liability_account_id == null ? null : Number(tax.liability_account_id)},
         'proof_pending')
      ON CONFLICT (line_tax_id)
      DO UPDATE SET
        tax_type = EXCLUDED.tax_type,
        tax_object = EXCLUDED.tax_object,
        base_amount = EXCLUDED.base_amount,
        tax_amount = EXCLUDED.tax_amount,
        liability_account_id = COALESCE(EXCLUDED.liability_account_id, vendor_withholding_records.liability_account_id),
        updated_at = NOW()
    `);
  }

  const recordRows = rows<{ status: string; tax_amount: string }>(await executor.execute(sql`
    SELECT status, tax_amount
    FROM vendor_withholding_records
    WHERE company_id = ${companyId} AND vendor_invoice_id = ${vendorInvoiceId}
  `));
  return {
    withholdingAmount: money(recordRows.reduce((sum, record) => sum + numberValue(record.tax_amount), 0)),
    recordCount: recordRows.length,
  };
}

/**
 * Recalculates only the payment status. Three-way match status is deliberately
 * not touched here because it describes PO/GR/Invoice matching, not payment.
 */
export async function recalculateVendorInvoicePaymentStatus(
  executor: SqlExecutor,
  companyId: number,
  vendorInvoiceId: number,
): Promise<{ status: string; amountPaid: number; withholdingComplete: boolean }> {
  const linkage = await ensureVendorWithholdingRecords(executor, companyId, vendorInvoiceId);
  const invoiceRows = rows<Record<string, unknown>>(await executor.execute(sql`
    SELECT amount_paid, grand_total, status, withholding_review_status
    FROM vendor_invoices
    WHERE id = ${vendorInvoiceId} AND company_id = ${companyId}
    FOR UPDATE
  `));
  const invoice = invoiceRows[0];
  if (!invoice) {
    return { status: "missing", amountPaid: 0, withholdingComplete: false };
  }

  const records = rows<{ status: string; resolution_status: string }>(await executor.execute(sql`
    SELECT vwr.status, vit.resolution_status
    FROM vendor_withholding_records vwr
    INNER JOIN vendor_invoice_line_taxes vit ON vit.id = vwr.line_tax_id
    WHERE vwr.company_id = ${companyId} AND vwr.vendor_invoice_id = ${vendorInvoiceId}
  `));
  const hasWithholding = linkage.withholdingAmount > 0 || records.length > 0;
  const withholdingComplete = !hasWithholding
    || (records.length > 0 && records.every((record) =>
      TERMINAL_WITHHOLDING_STATUSES.has(String(record.status))
      && ["confirmed", "approved"].includes(String(record.resolution_status)),
    ));
  const amountPaid = money(numberValue(invoice.amount_paid));
  const grandTotal = money(numberValue(invoice.grand_total));
  let effectiveAmountPaid = amountPaid;

  // Legacy reconciliation records can contain only the cash transferred to
  // the supplier. Promote that amount to gross only when the exact gap is the
  // persisted withholding amount and an approved OUT mutation has accounting
  // evidence. This repairs the payment projection without creating another
  // journal or bank transaction.
  if (amountPaid > 0 && amountPaid < grandTotal - 0.01 && linkage.withholdingAmount > 0) {
    const evidenceRows = rows<{ mutation_id: number; candidate_source: string | null }>(
      await executor.execute(sql`
        SELECT brm.mutation_id, brm.candidate_source::text AS candidate_source
        FROM public.bank_reconciliation_matches brm
        INNER JOIN public.bank_mutations bm ON bm.id = brm.mutation_id
        WHERE brm.candidate_type::text = 'vendor_invoice'
          AND brm.candidate_id::text = ${String(vendorInvoiceId)}
          AND brm.status::text = 'approved'
          AND bm.direction::text = 'OUT'
          AND bm.status::text IN ('approved_pending_posting', 'approved', 'posted', 'reconciled', 'matched')
          AND (
            bm.journal_entry_id IS NOT NULL
            OR brm.candidate_source::text = 'bank_disbursement'
          )
        ORDER BY brm.id DESC
        LIMIT 1
      `),
    );
    const inferredSettlement = inferVendorInvoiceGrossSettlement({
      paymentAmount: amountPaid,
      // amountPaid may be the net cash transferred to the supplier. Compare
      // that cash with the pre-payment invoice balance so persisted
      // withholding can close the remaining gross liability.
      outstanding: grandTotal,
      withholdingAmount: linkage.withholdingAmount,
    });
    if (evidenceRows.length > 0 && inferredSettlement.grossAmount >= grandTotal - 0.01) {
      effectiveAmountPaid = grandTotal;
      await executor.execute(sql`
        UPDATE vendor_invoices
        SET amount_paid = ${String(grandTotal)},
            updated_at = NOW()
        WHERE id = ${vendorInvoiceId}
          AND company_id = ${companyId}
          AND amount_paid = ${String(amountPaid)}
      `);
    }
  }

  const nextStatus = deriveVendorInvoicePaymentStatus({
    amountPaid: effectiveAmountPaid,
    grandTotal,
    currentStatus: String(invoice.status),
    hasWithholding,
    withholdingComplete,
  });
  const nextWithholdingReviewStatus = hasWithholding
    ? withholdingComplete ? "completed" : "required"
    : "not_required";

  await executor.execute(sql`
    UPDATE vendor_invoices
    SET status = ${nextStatus},
        withholding_review_status = ${nextWithholdingReviewStatus},
        withholding_review_completed_at = CASE
          WHEN ${nextWithholdingReviewStatus} = 'completed' THEN COALESCE(withholding_review_completed_at, NOW())
          ELSE NULL
        END,
        updated_at = NOW()
    WHERE id = ${vendorInvoiceId} AND company_id = ${companyId}
  `);
  return { status: nextStatus, amountPaid: effectiveAmountPaid, withholdingComplete };
}
