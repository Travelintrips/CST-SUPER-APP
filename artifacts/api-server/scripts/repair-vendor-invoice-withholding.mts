import { db } from "@workspace/db";
import { sql } from "drizzle-orm";
import { postEntryWithClient } from "../src/lib/accounting.js";
import { recalculateVendorInvoicePaymentStatus } from "../src/lib/vendorInvoicePaymentStatus.js";

const INVOICE_NUMBER = "VI/2026/00004";
const COMPANY_ID = 1;
const ACTOR = "replit-agent-guarded-repair";
const CORRECTION_REF = `${INVOICE_NUMBER}-WHT-CORR`;
const EXPECTED = {
  gross: 26_852_296,
  net: 23_783_170,
  withholding: 3_069_126,
  pph23: 1_950_000,
  pph42: 1_119_126,
  pph23Base: 13_000_000,
  pph42Base: 11_191_258,
};

type Row = Record<string, unknown>;

function rows<T extends Row>(result: unknown): T[] {
  return (((result as { rows?: T[] } | undefined)?.rows) ?? []) as T[];
}

function money(value: unknown): number {
  const parsed = Number(value ?? 0);
  return Number.isFinite(parsed) ? Math.round(parsed * 100) / 100 : 0;
}

function integerMoney(value: unknown): number {
  return Math.round(money(value));
}

function jsonRecord(value: unknown): Row {
  if (typeof value === "string") {
    try {
      return jsonRecord(JSON.parse(value));
    } catch {
      return {};
    }
  }
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Row
    : {};
}

function fail(message: string): never {
  throw new Error(`GUARDED_REPAIR_BLOCKED: ${message}`);
}

async function run() {
  const apply = process.argv.includes("--apply");
  const result = await db.transaction(async (tx) => {
    const invoiceRows = rows(await tx.execute(sql`
      SELECT id, company_id, invoice_number, supplier_name, grand_total,
             amount_paid, withholding_tax_amount, invoice_breakdown, status
      FROM vendor_invoices
      WHERE company_id = ${COMPANY_ID}
        AND invoice_number = ${INVOICE_NUMBER}
      FOR UPDATE
    `));
    if (invoiceRows.length !== 1) fail(`invoice ${INVOICE_NUMBER} harus tepat satu row`);
    const invoice = invoiceRows[0]!;
    const invoiceId = Number(invoice.id);
    if (Number(invoice.company_id) !== COMPANY_ID) fail("company context invoice tidak cocok");
    if (integerMoney(invoice.grand_total) !== EXPECTED.gross) fail("grand_total invoice berubah");
    const amountPaidBeforeRepair = integerMoney(invoice.amount_paid);
    if (amountPaidBeforeRepair !== EXPECTED.net && amountPaidBeforeRepair !== EXPECTED.gross) {
      fail(`amount_paid harus net ${EXPECTED.net} atau gross ${EXPECTED.gross}, aktual ${invoice.amount_paid}`);
    }
    if (integerMoney(invoice.withholding_tax_amount) !== EXPECTED.withholding) {
      fail("withholding_tax_amount invoice berubah");
    }

    const breakdown = jsonRecord(invoice.invoice_breakdown);
    const components = Array.isArray(breakdown.components) ? breakdown.components as Row[] : [];
    const pph23 = components
      .filter((component) => String(component.withholding_tax_type ?? "").toLowerCase().includes("pph 23"))
      .reduce((sum, component) => sum + integerMoney(component.withholding_tax_amount), 0);
    const pph42 = components
      .filter((component) => String(component.withholding_tax_type ?? "").toLowerCase().includes("pph 4(2)"))
      .reduce((sum, component) => sum + integerMoney(component.withholding_tax_amount), 0);
    if (pph23 !== EXPECTED.pph23 || pph42 !== EXPECTED.pph42) {
      fail(`breakdown PPh tidak cocok: pph23=${pph23}, pph4(2)=${pph42}`);
    }

    const taxRows = rows(await tx.execute(sql`
      SELECT vit.id, vit.invoice_line_id, vit.tax_type, vit.tax_object,
             vit.base_amount, vit.tax_amount, vit.liability_account_id,
             vit.resolution_status
      FROM vendor_invoice_line_taxes vit
      INNER JOIN vendor_invoice_lines vil ON vil.id = vit.invoice_line_id
      WHERE vil.invoice_id = ${invoiceId}
        AND vit.company_id = ${COMPANY_ID}
      ORDER BY vit.id
      FOR UPDATE OF vit
    `));
    if (taxRows.length !== 1) fail(`tax row legacy harus tepat satu sebelum repair, aktual ${taxRows.length}`);
    const legacyTax = taxRows[0]!;
    if (integerMoney(legacyTax.tax_amount) !== EXPECTED.withholding) fail("nominal legacy tax row berubah");

    const matches = rows(await tx.execute(sql`
      SELECT brm.id AS match_id, brm.mutation_id, brm.candidate_id::text AS candidate_id,
             brm.status, brm.candidate_source, bm.amount, bm.direction,
             bm.status AS mutation_status, bm.journal_entry_id, bm.transaction_date
      FROM bank_reconciliation_matches brm
      INNER JOIN bank_mutations bm ON bm.id = brm.mutation_id
      WHERE brm.candidate_type::text = 'vendor_invoice'
        AND brm.candidate_id::text = ${String(invoiceId)}
        AND brm.status::text = 'approved'
        AND brm.candidate_source = 'vendor_invoice_batch'
      ORDER BY brm.id
      FOR UPDATE OF brm, bm
    `));
    if (matches.length !== 2) fail(`approved vendor_invoice_batch match harus dua, aktual ${matches.length}`);
    const totalBank = matches.reduce((sum, match) => sum + integerMoney(match.amount), 0);
    if (totalBank !== EXPECTED.net) fail(`total mutasi bank harus ${EXPECTED.net}, aktual ${totalBank}`);
    if (matches.some((match) => String(match.direction).toUpperCase() !== "OUT"
      || String(match.mutation_status) !== "posted"
      || match.journal_entry_id == null)) {
      fail("semua mutasi harus OUT, posted, dan memiliki jurnal");
    }

    const paymentEntryIds = matches.map((match) => Number(match.journal_entry_id));
    const paymentLines = rows(await tx.execute(sql`
      SELECT ae.id AS entry_id, ae.status, ae.source::text AS source,
             ae.source_module, ae.company_id, ael.account_id,
             ael.debit, ael.credit, coa.code, coa.name, coa.type
      FROM accounting_entries ae
      INNER JOIN accounting_entry_lines ael ON ael.entry_id = ae.id
      INNER JOIN chart_of_accounts coa ON coa.id = ael.account_id
      WHERE ae.id IN (${sql.join(paymentEntryIds.map((id) => sql`${id}`), sql`, `)})
      ORDER BY ae.id, ael.id
      FOR UPDATE OF ae, ael
    `));
    if (paymentLines.length !== 4) fail(`dua jurnal pembayaran harus masing-masing dua line, aktual ${paymentLines.length}`);
    if (paymentLines.some((line) => String(line.status) !== "posted"
      || String(line.source) !== "bank_reconciliation"
      || Number(line.company_id) !== COMPANY_ID)) {
      fail("jurnal pembayaran tidak memenuhi source/company/status invariant");
    }
    const paymentEntrySet = new Set(paymentEntryIds);
    for (const entryId of paymentEntrySet) {
      const lines = paymentLines.filter((line) => Number(line.entry_id) === entryId);
      const apDebit = lines.filter((line) => money(line.debit) > 0);
      const bankCredit = lines.filter((line) => money(line.credit) > 0);
      if (apDebit.length !== 1 || bankCredit.length !== 1
        || !String(apDebit[0]!.name).toLowerCase().includes("hutang pemasok")
        || String(bankCredit[0]!.type).toLowerCase() !== "asset") {
        fail(`struktur jurnal pembayaran ${entryId} tidak sesuai`);
      }
    }

    const coaRows = rows(await tx.execute(sql`
      SELECT id, code, name, type, company_id, is_active
      FROM chart_of_accounts
      WHERE company_id = ${COMPANY_ID}
        AND code IN ('2-1094-CST', '2-1098-CST')
      ORDER BY code
      FOR UPDATE
    `));
    const pph23Account = coaRows.find((row) => row.code === "2-1094-CST");
    const pph42Account = coaRows.find((row) => row.code === "2-1098-CST");
    if (!pph23Account || !pph42Account
      || pph23Account.type !== "liability" || pph42Account.type !== "liability"
      || pph23Account.is_active !== true || pph42Account.is_active !== true) {
      fail("COA Hutang PPh PROD tidak lengkap/aktif");
    }

    const existingCorrection = rows(await tx.execute(sql`
      SELECT ae.id, ae.status, ae.total_debit, ae.total_credit
      FROM accounting_entries ae
      WHERE ae.company_id = ${COMPANY_ID}
        AND ae.ref = ${CORRECTION_REF}
      ORDER BY ae.id
    `));
    if (existingCorrection.length > 1) fail("duplicate correction journal terdeteksi");
    if (existingCorrection.length === 1) {
      if (amountPaidBeforeRepair !== EXPECTED.gross) {
        fail("correction journal ada tetapi amount_paid belum gross");
      }
      if (integerMoney(existingCorrection[0]!.total_debit) !== EXPECTED.withholding
        || integerMoney(existingCorrection[0]!.total_credit) !== EXPECTED.withholding
        || String(existingCorrection[0]!.status) !== "posted") {
        fail("existing correction journal tidak seimbang/posted");
      }
      return {
        dryRun: !apply,
        idempotent: true,
        invoiceId,
        correctionEntryId: Number(existingCorrection[0]!.id),
        amountPaidBefore: amountPaidBeforeRepair,
        note: "Correction journal sudah ada; tidak membuat jurnal kedua.",
      };
    }
    if (amountPaidBeforeRepair !== EXPECTED.net) {
      fail("amount_paid sudah gross tetapi correction journal belum ada");
    }

    const apAccount = paymentLines.find((line) => money(line.debit) > 0);
    if (!apAccount) fail("COA Hutang Vendor dari jurnal pembayaran tidak ditemukan");
    const journalIdRows = rows(await tx.execute(sql`
      SELECT id, code
      FROM accounting_journals
      WHERE id = (SELECT journal_id FROM accounting_entries WHERE id = ${paymentEntryIds[0]})
        AND company_id = ${COMPANY_ID}
      LIMIT 1
    `));
    const journal = journalIdRows[0];
    if (!journal) fail("jurnal bank pembayaran tidak ditemukan");

    if (!apply) {
      return {
        dryRun: true,
        idempotent: false,
        invoiceId,
        approvedMatchIds: matches.map((match) => Number(match.match_id)),
        paymentEntryIds,
        correction: {
          debitAccountId: Number(apAccount.account_id),
          debitAmount: EXPECTED.withholding,
          creditPph23AccountId: Number(pph23Account.id),
          creditPph23Amount: EXPECTED.pph23,
          creditPph42AccountId: Number(pph42Account.id),
          creditPph42Amount: EXPECTED.pph42,
        },
        amountPaidBefore: amountPaidBeforeRepair,
        amountPaidAfter: EXPECTED.gross,
      };
    }

    const invoiceLineId = Number(legacyTax.invoice_line_id);
    const taxObject = String(legacyTax.tax_object ?? "legacy_invoice_header");
    await tx.execute(sql`
      UPDATE vendor_invoice_line_taxes
      SET tax_type = 'PPh 23',
          base_amount = ${String(EXPECTED.pph23Base)},
          tax_amount = ${String(EXPECTED.pph23)},
          liability_account_id = ${Number(pph23Account.id)},
          resolution_status = 'tax_review',
          review_reason = 'Split from legacy PPh 23 + PPh 4(2) during guarded production correction',
          updated_at = NOW()
      WHERE id = ${Number(legacyTax.id)}
        AND company_id = ${COMPANY_ID}
    `);
    await tx.execute(sql`
      INSERT INTO vendor_invoice_line_taxes
        (invoice_line_id, company_id, tax_type, tax_object, base_amount, tax_amount,
         liability_account_id, resolution_status, review_reason)
      VALUES
        (${invoiceLineId}, ${COMPANY_ID}, 'PPh 4(2)', ${taxObject},
         ${String(EXPECTED.pph42Base)}, ${String(EXPECTED.pph42)},
         ${Number(pph42Account.id)}, 'tax_review',
         'Split from legacy PPh 23 + PPh 4(2) during guarded production correction')
      ON CONFLICT (invoice_line_id, tax_type, tax_object)
      DO UPDATE SET
        base_amount = EXCLUDED.base_amount,
        tax_amount = EXCLUDED.tax_amount,
        liability_account_id = EXCLUDED.liability_account_id,
        resolution_status = 'tax_review',
        review_reason = EXCLUDED.review_reason,
        updated_at = NOW()
    `);
    await tx.execute(sql`
      UPDATE vendor_withholding_records
      SET tax_type = 'PPh 23',
          base_amount = ${String(EXPECTED.pph23Base)},
          tax_amount = ${String(EXPECTED.pph23)},
          liability_account_id = ${Number(pph23Account.id)},
          updated_at = NOW()
      WHERE vendor_invoice_id = ${invoiceId}
        AND line_tax_id = ${Number(legacyTax.id)}
        AND company_id = ${COMPANY_ID}
    `);
    const newTaxRows = rows(await tx.execute(sql`
      SELECT id
      FROM vendor_invoice_line_taxes
      WHERE invoice_line_id = ${invoiceLineId}
        AND company_id = ${COMPANY_ID}
        AND tax_type = 'PPh 4(2)'
        AND tax_object = ${taxObject}
      LIMIT 1
    `));
    const pph42TaxId = Number(newTaxRows[0]?.id ?? 0);
    if (!pph42TaxId) fail("tax row PPh 4(2) tidak berhasil dibuat");
    await tx.execute(sql`
      INSERT INTO vendor_withholding_records
        (company_id, vendor_invoice_id, invoice_line_id, line_tax_id,
         tax_type, tax_object, base_amount, tax_amount, liability_account_id, status)
      VALUES
        (${COMPANY_ID}, ${invoiceId}, ${invoiceLineId}, ${pph42TaxId},
         'PPh 4(2)', ${taxObject}, ${String(EXPECTED.pph42Base)}, ${String(EXPECTED.pph42)},
         ${Number(pph42Account.id)}, 'proof_pending')
      ON CONFLICT (line_tax_id)
      DO UPDATE SET
        tax_type = EXCLUDED.tax_type,
        base_amount = EXCLUDED.base_amount,
        tax_amount = EXCLUDED.tax_amount,
        liability_account_id = EXCLUDED.liability_account_id,
        updated_at = NOW()
    `);

    const correction = await postEntryWithClient(
      tx,
      {
        journalId: Number(journal.id),
        date: new Date(String(matches[0]!.transaction_date)),
        ref: CORRECTION_REF,
        description: `Koreksi PPh pembayaran vendor ${INVOICE_NUMBER}`,
        source: "bank_reconciliation",
        sourceModule: "vendor_invoice_payment_correction",
        sourceId: invoiceId,
        sourceEventId: `vendor-invoice-withholding-correction:${invoiceId}`,
        createdById: ACTOR,
        companyId: COMPANY_ID,
        lines: [
          {
            accountId: Number(apAccount.account_id),
            debit: EXPECTED.withholding,
            credit: 0,
            description: `Koreksi Hutang Vendor — ${INVOICE_NUMBER}`,
          },
          {
            accountId: Number(pph23Account.id),
            debit: 0,
            credit: EXPECTED.pph23,
            description: `Hutang PPh 23 — ${INVOICE_NUMBER}`,
          },
          {
            accountId: Number(pph42Account.id),
            debit: 0,
            credit: EXPECTED.pph42,
            description: `Hutang PPh 4(2) — ${INVOICE_NUMBER}`,
          },
        ],
      },
      String(journal.code ?? "BANK"),
      "posted",
    );

    for (const match of matches) {
      await tx.execute(sql`
        INSERT INTO bank_reconciliation_audit (mutation_id, action, actor, meta)
        VALUES (
          ${Number(match.mutation_id)},
          'VENDOR_WITHHOLDING_CORRECTION',
          ${ACTOR},
          ${JSON.stringify({
            invoice_number: INVOICE_NUMBER,
            invoice_id: invoiceId,
            correction_entry_id: correction.id,
            debit_ap: EXPECTED.withholding,
            credit_pph23: EXPECTED.pph23,
            credit_pph42: EXPECTED.pph42,
            original_payment_entry_ids: paymentEntryIds,
            reason: "Historical vendor invoice payment journals captured net cash without PPh liability lines",
          })}::jsonb
        )
      `);
    }

    const paymentStatus = await recalculateVendorInvoicePaymentStatus(
      tx,
      COMPANY_ID,
      invoiceId,
    );

    return {
      dryRun: false,
      idempotent: false,
      invoiceId,
      correctionEntryId: correction.id,
      paymentStatus,
      amountPaidBefore: amountPaidBeforeRepair,
      amountPaidAfter: EXPECTED.gross,
      paymentEntryIds,
      approvedMatchIds: matches.map((match) => Number(match.match_id)),
    };
  });

  console.log(JSON.stringify(result, null, 2));
}

run()
  .catch((error) => {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await db.$client.end();
  });